import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { ApiError } from './errors';
import * as db from './db';
import * as gh from './github';
import type { Env, UserRow } from './types';

const SESSION_COOKIE = 'bg_session';
const STATE_COOKIE = 'bg_state';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const app = new Hono<{ Bindings: Env }>();

type Ctx = Context<{ Bindings: Env }>;

function isHttps(url: string): boolean {
  return new URL(url).protocol === 'https:';
}

// ---------------------------------------------------------------- 会话

async function currentUser(c: Ctx): Promise<UserRow | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  return db.getSessionUser(c.env, token);
}

async function requireUser(c: Ctx): Promise<UserRow> {
  const user = await currentUser(c);
  if (!user) throw new ApiError(401, '请先使用 GitHub 登录');
  return user;
}

// ---------------------------------------------------------------- 鉴权

app.get('/api/auth/login', (c) => {
  const state = crypto.randomUUID();
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 600,
    secure: isHttps(c.req.url),
  });

  const callbackUrl = `${new URL(c.req.url).origin}/api/auth/callback`;
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', c.env.GITHUB_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', callbackUrl);
  authorize.searchParams.set('state', state);

  return c.redirect(authorize.toString());
});

app.get('/api/auth/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const expected = getCookie(c, STATE_COOKIE);

  if (!code) throw new ApiError(400, '缺少授权码 code');
  if (!expected || expected !== state) {
    // 从「Install App」按钮发起的授权不会带我们下发的 state cookie。
    // 这种回调不换 token，直接回首页让用户点击正常登录。
    if (c.req.query('setup_action')) return c.redirect('/');
    throw new ApiError(400, 'state 校验失败，请重新登录');
  }
  deleteCookie(c, STATE_COOKIE, { path: '/' });

  const userToken = await gh.exchangeCode(c.env, code);
  const viewer = await gh.getViewer(userToken);

  // id 是 GitHub 分配的不可变数字 ID，即"真实 ID"，用它做身份主键
  const user = await db.upsertUser(c.env, viewer);

  // App 是按组织安装的：普通协作者不会出现在自己的 /user/installations 里，
  // 所以这里用 App 身份去查组织安装，而不是用用户 token。
  let installationId: number | null = null;
  try {
    installationId = await gh.resolveInstallationIdForRepo(c.env);
  } catch (e) {
    console.warn('resolve installation failed:', e);
    installationId = null;
  }
  await db.setInstallationId(c.env, user.github_id, installationId);

  const session = await db.createSession(c.env, user.github_id, SESSION_TTL_MS);
  setCookie(c, SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: isHttps(c.req.url),
  });

  return c.redirect('/');
});

app.post('/api/auth/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await db.deleteSession(c.env, token);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- 状态

app.get('/api/me', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ loggedIn: false });

  // 安装可能发生在登录之后（安装回调不换 token），此时库里还没有 installation_id。
  // 这里惰性补解析一次，用户刷新页面即可，不必重新登录。
  let installationId = user.installation_id;
  if (installationId == null) {
    try {
      installationId = await gh.resolveInstallationIdForRepo(c.env);
      await db.setInstallationId(c.env, user.github_id, installationId);
    } catch (e) {
      console.warn('resolve installation failed:', e);
    }
  }

  const ns = await db.getNamespaceByOwner(c.env, user.github_id);
  return c.json({
    loggedIn: true,
    user: {
      githubId: user.github_id,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatar_url,
      appInstalled: installationId != null,
    },
    namespace: ns
      ? {
          name: ns.namespace,
          baseBranch: ns.base_branch,
          protected: ns.protected === 1,
          updatedAt: ns.updated_at,
        }
      : null,
    repo: {
      owner: c.env.TARGET_REPO_OWNER,
      name: c.env.TARGET_REPO_NAME,
      baseBranch: c.env.BASE_BRANCH,
    },
  });
});

// ---------------------------------------------------------------- 注册

const NAMESPACE_ALLOWED = /^[A-Za-z0-9._-]+$/;

function assertValidNamespace(name: string): void {
  if (!name) throw new ApiError(400, '命名空间不能为空');
  if (name.length > 100) throw new ApiError(400, '命名空间最长 100 个字符');
  if (!NAMESPACE_ALLOWED.test(name)) {
    throw new ApiError(400, '命名空间只能包含字母、数字与 . _ -');
  }
  if (name.startsWith('.') || name.startsWith('-')) {
    throw new ApiError(400, '命名空间不能以 . 或 - 开头');
  }
  if (name.includes('..') || name.endsWith('.') || name.endsWith('.lock')) {
    throw new ApiError(400, '命名空间不合法');
  }
}

/**
 * 注册：领取自己的命名空间。
 * 1) 加为协作者（push 权限）→ 用户可直接 git push/pull/PR
 * 2) 从 base 切出 {namespace} 根分支
 * 3) 创建分支保护规则：{namespace}、{namespace}/*、{namespace}/**\/* 只允许该用户推送
 *    → 其他人无法推送到你的命名空间下的任何分支
 * 4) 写 D1
 */
app.post('/api/register', async (c) => {
  const user = await requireUser(c);

  const body = (await c.req.json().catch(() => ({}))) as { namespace?: string };
  const namespace = (body.namespace ?? user.login).trim();
  assertValidNamespace(namespace);

  if (!user.installation_id) {
    throw new ApiError(
      403,
      `尚未检测到你对 ${c.env.TARGET_REPO_OWNER}/${c.env.TARGET_REPO_NAME} 的 GitHub App 安装授权，请先安装并授权该仓库`
    );
  }

  // 1) 重名检测：这个名字已经被别人占了 → 直接拒绝
  const existing = await db.getNamespaceByName(c.env, namespace);
  if (existing && existing.github_id !== user.github_id) {
    const owner = await db.getUser(c.env, existing.github_id);
    throw new ApiError(
      409,
      `该命名空间已被占用：「${namespace}」已属于 @${owner?.login ?? existing.github_id}`
    );
  }

  const t0 = Date.now();
  const token = await gh.getInstallationToken(c.env, user.installation_id);
  console.log(`[register] token ${Date.now() - t0}ms`);
  const repoNodeId = await gh.getRepoNodeId(c.env, token);
  console.log(`[register] repoNodeId ${Date.now() - t0}ms`);
  const rules = await gh.listProtectionRules(token, repoNodeId);
  console.log(`[register] listRules ${Date.now() - t0}ms, count=${rules.length}`);

  // 1) 先上保护规则：分支即使还不存在，GitHub 也会先记住，分支一出现就生效。
  //    顺序很关键——先有规则再给权限，中间不存在"能推但没人管"的窗口。
  let protectionApplied = false;
  try {
    for (const pattern of [namespace, `${namespace}/*`, `${namespace}/**/*`]) {
      const tp = Date.now();
      await gh.upsertProtectionRule(token, repoNodeId, rules, pattern, [user.node_id]);
      console.log(`[register] rule ${pattern} ${Date.now() - tp}ms`);
    }
    // 基准分支同样纳入保护：只允许管理员直推。管理员自身是否再受额外约束
    // 由别的规则决定，这里只是补一条缺失的默认规则，已有的不覆盖。
    if (!rules.some((r) => r.pattern === c.env.BASE_BRANCH)) {
      const tp = Date.now();
      await gh.createBranchProtectionRule(token, repoNodeId, c.env.BASE_BRANCH, []);
      console.log(`[register] rule ${c.env.BASE_BRANCH} ${Date.now() - tp}ms`);
    }
    protectionApplied = true;
  } catch (e) {
    console.warn('[register] branch protection failed:', e);
  }
  console.log(`[register] protection done ${Date.now() - t0}ms, applied=${protectionApplied}`);

  // 2) 落库 + 建分支（仅当远端不存在时才创建，已存在就复用）
  let ns = existing;
  let reused = false;
  if (!ns) {
    // 远端已有同名分支 → 直接复用，不重复创建
    const exists = await gh.branchExists(c.env, token, namespace);
    console.log(`[register] branchExists=${exists} ${Date.now() - t0}ms`);
    const sha = exists ? null : await gh.createBranch(c.env, token, namespace);
    console.log(`[register] createBranch sha=${sha ? sha.slice(0, 8) : null} ${Date.now() - t0}ms`);
    try {
      ns = await db.insertNamespace(c.env, {
        namespace,
        githubId: user.github_id,
        repoOwner: c.env.TARGET_REPO_OWNER,
        repoName: c.env.TARGET_REPO_NAME,
        baseBranch: c.env.BASE_BRANCH,
        headSha: sha,
      });
    } catch {
      throw new ApiError(409, '该命名空间刚被别人占用，请换一个名字');
    }
  } else {
    reused = true;
  }
  if (!ns) throw new ApiError(500, '命名空间写入异常');
  console.log(`[register] ns inserted ${Date.now() - t0}ms`);

  // 3) 最后才授予写权限：前面任何一步失败都拿不到 push，重试即可自愈
  await gh.addCollaborator(c.env, token, user.login);
  console.log(`[register] addCollaborator ${Date.now() - t0}ms`);

  await db.refreshNamespaceGrant(c.env, namespace, protectionApplied);

  return c.json({
    ok: true,
    reused,
    namespace: {
      name: ns.namespace,
      baseBranch: ns.base_branch,
      protected: protectionApplied,
    },
    message: reused
      ? `命名空间「${namespace}」本已属于你，已刷新权限`
      : `已为你创建命名空间「${namespace}」，只有你能推送到该命名空间下的分支`,
  });
});

// ---------------------------------------------------------------- 权限重新同步
// 由目标仓库的 GitHub Actions（branch-watch）在「分支被创建/删除」时调用，
// 也支持手动触发兜底。密钥放在仓库 Secret BRANCH_GATE_RESYNC_SECRET。

interface RuleDiff {
  created: string[];
  updated: string[];
  deleted: string[];
  orphans: string[];
  skipped: string[];
  errors: string[];
}

app.post('/api/resync', async (c) => {
  const auth = c.req.header('Authorization') ?? '';
  if (!c.env.RESYNC_SECRET || auth !== `Bearer ${c.env.RESYNC_SECRET}`) {
    throw new ApiError(401, 'resync 密钥校验失败');
  }

  const token = await gh.getInstallationToken(
    c.env,
    await gh.resolveInstallationIdForRepo(c.env)
  );

  const repoNodeId = await gh.getRepoNodeId(c.env, token);
  const branches = await gh.listBranches(c.env, token);
  const namespaces = await db.listNamespaces(c.env);

  // 命名空间所有者 github_id -> node_id（保护规则要认 node_id）
  const nodeIds = new Map<number, string>();
  for (const ns of namespaces) {
    if (nodeIds.has(ns.github_id)) continue;
    const u = await db.getUser(c.env, ns.github_id);
    if (u) nodeIds.set(u.github_id, u.node_id);
  }

  const inAnyNamespace = (b: string) =>
    namespaces.some((ns) => b === ns.namespace || b.startsWith(`${ns.namespace}/`));

  // 期望的规则集：pattern -> 允许推送的人（空数组 = 无主分支锁死，仅管理员可推）
  const desired = new Map<string, string[]>();
  const diff: RuleDiff = { created: [], updated: [], deleted: [], orphans: [], skipped: [], errors: [] };

  for (const ns of namespaces) {
    const actor = nodeIds.get(ns.github_id);
    if (!actor) {
      diff.skipped.push(ns.namespace);
      continue;
    }
    desired.set(ns.namespace, [actor]);
    desired.set(`${ns.namespace}/*`, [actor]);
    desired.set(`${ns.namespace}/**/*`, [actor]);
  }

  for (const b of branches) {
    if (b === c.env.BASE_BRANCH || inAnyNamespace(b)) continue;
    diff.orphans.push(b);
    desired.set(b, []);
  }

  const existing = await gh.listProtectionRules(token, repoNodeId);

  // 基准分支也纳入保护：默认只允许管理员直推。管理员已经配过规则时保持原样。
  if (!existing.some((r) => r.pattern === c.env.BASE_BRANCH)) {
    desired.set(c.env.BASE_BRANCH, []);
  }

  for (const [pattern, actors] of desired) {
    try {
      const action = await gh.upsertProtectionRule(token, repoNodeId, existing, pattern, actors);
      (action === 'created' ? diff.created : diff.updated).push(pattern);
    } catch (e) {
      diff.errors.push(`写入规则 ${pattern} 失败：${(e as Error).message}`);
    }
  }

  // 只清理确属本系统创建过的陈旧规则：无通配符、非基准分支、对应分支已不存在。
  // 管理员手工建的规则（如 main 上要求 review）一律不动。
  for (const r of existing) {
    if (desired.has(r.pattern)) continue;
    if (r.pattern.includes('*')) continue;
    if (r.pattern === c.env.BASE_BRANCH) continue;
    if (branches.includes(r.pattern)) continue;
    try {
      await gh.deleteBranchProtectionRule(token, r.id);
      diff.deleted.push(r.pattern);
    } catch (e) {
      diff.errors.push(`清理规则 ${r.pattern} 失败：${(e as Error).message}`);
    }
  }

  return c.json({
    ok: diff.errors.length === 0,
    branches: branches.length,
    namespaces: namespaces.length,
    ...diff,
  });
});

// ---------------------------------------------------------------- 静态资源兜底
// Pages _worker.js 模式下，所有请求都经过 Worker。
// 未匹配 /api/* 的请求交给 ASSETS（即 public/ 下的静态文件）。
app.all('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// ---------------------------------------------------------------- 兜底

app.notFound((c) => c.json({ error: '接口不存在' }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.message }, err.status as 400);
  console.error('=== UNHANDLED ERROR ===', err && err.stack ? err.stack : err);
  return c.json({ error: '服务器内部错误' }, 500);
});

export default app;
