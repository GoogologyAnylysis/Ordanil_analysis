import { ApiError } from './errors';
import type { Env, GitHubViewer } from './types';

const API = 'https://api.github.com';

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'branch-gate',
  };
}

function b64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

/** GitHub App 身份 JWT（RS256），有效期上限 10 分钟。 */
async function createAppJwt(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID })
  )}`;

  // .dev.vars 里私钥是单行写的，换行被转义成了字面量 \n
  const pem = env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n');
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned)
  );
  return `${unsigned}.${b64url(signature)}`;
}

/** 用 App JWT 换某个安装的 installation token（1 小时有效）。这个 token 绝不下发给浏览器。 */
export async function getInstallationToken(env: Env, installationId: number): Promise<string> {
  const res = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: ghHeaders(await createAppJwt(env)),
  });
  const data = (await res.json()) as { token?: string; message?: string };
  if (!res.ok || !data.token) {
    throw new ApiError(502, `获取安装令牌失败：${data.message ?? res.status}`);
  }
  return data.token;
}

/** GraphQL 通用调用：失败抛 ApiError。 */
async function gql<T>(token: string, query: string, variables: unknown): Promise<T> {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const data = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (!res.ok || data.errors?.length) {
    throw new ApiError(502, `GitHub GraphQL 调用失败：${data.errors?.[0]?.message ?? res.status}`);
  }
  return data.data as T;
}

/** 用授权码换用户 access token（仅用于读取真实 ID，读完即丢，不落库）。 */
export async function exchangeCode(env: Env, code: string): Promise<string> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const data = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new ApiError(401, `GitHub 授权失败：${data.error_description ?? res.status}`);
  }
  return data.access_token;
}

/** 读取当前用户，重点是 id（不可变数字 ID）和 node_id（GraphQL 用）。 */
export async function getViewer(userToken: string): Promise<GitHubViewer> {
  const res = await fetch(`${API}/user`, { headers: ghHeaders(userToken) });
  if (!res.ok) throw new ApiError(401, `读取 GitHub 用户信息失败 (${res.status})`);
  return (await res.json()) as GitHubViewer;
}

/** 以 App 身份找目标仓库属主（组织/个人）的安装，不依赖任何用户会话。 */
export async function resolveInstallationIdForRepo(env: Env): Promise<number> {
  const res = await fetch(`${API}/app/installations?per_page=100`, {
    headers: ghHeaders(await createAppJwt(env)),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new ApiError(502, `读取 App 安装列表失败 (${res.status})：${raw.slice(0, 120)}`);
  }
  // 这个接口直接返回顶层数组，没有 installations 包装
  let list: Array<{ id: number; account?: { login?: string } }> = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) list = parsed;
  } catch {
    list = [];
  }
  const hit = list.find(
    (i) => i.account?.login?.toLowerCase() === env.TARGET_REPO_OWNER.toLowerCase()
  );
  if (!hit) {
    const accounts = list.map((i) => i.account?.login).filter(Boolean).join(', ') || '无';
    throw new ApiError(
      502,
      `找不到 ${env.TARGET_REPO_OWNER} 的 App 安装（当前已安装账户：${accounts}），请先把 GitHub App 安装到该组织并选中目标仓库`
    );
  }
  return hit.id;
}

export async function branchExists(
  env: Env,
  token: string,
  branch: string
): Promise<boolean> {
  const res = await fetch(
    `${API}/repos/${env.TARGET_REPO_OWNER}/${env.TARGET_REPO_NAME}/branches/${encodeURIComponent(branch)}`,
    { headers: ghHeaders(token) }
  );
  if (res.status === 404) return false;
  if (res.ok) return true;
  throw new ApiError(502, `查询分支失败 (${res.status})`);
}

/** 列出仓库全部分支（自动翻页）。 */
export async function listBranches(env: Env, token: string): Promise<string[]> {
  const repo = `${API}/repos/${env.TARGET_REPO_OWNER}/${env.TARGET_REPO_NAME}`;
  const names: string[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${repo}/branches?per_page=100&page=${page}`, {
      headers: ghHeaders(token),
    });
    if (!res.ok) throw new ApiError(502, `读取分支列表失败 (${res.status})`);
    const items = (await res.json()) as Array<{ name: string }>;
    names.push(...items.map((i) => i.name));
    if (items.length < 100) break;
  }
  return names;
}

/** 从 base 分支切出新分支，返回新分支的 head sha。 */
export async function createBranch(
  env: Env,
  token: string,
  branch: string
): Promise<string> {
  const repo = `${API}/repos/${env.TARGET_REPO_OWNER}/${env.TARGET_REPO_NAME}`;

  const baseRes = await fetch(`${repo}/git/ref/heads/${env.BASE_BRANCH}`, {
    headers: ghHeaders(token),
  });
  if (!baseRes.ok) {
    throw new ApiError(502, `读取基准分支 ${env.BASE_BRANCH} 失败 (${baseRes.status})`);
  }
  const baseRef = (await baseRes.json()) as { object: { sha: string } };

  const res = await fetch(`${repo}/git/refs`, {
    method: 'POST',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha }),
  });
  const data = (await res.json()) as { object?: { sha: string }; message?: string };
  if (!res.ok || !data.object) {
    throw new ApiError(502, `创建分支失败：${data.message ?? res.status}`);
  }
  return data.object.sha;
}

/** 把用户加为仓库协作者，授予 push 权限。这样用户可以直接 git push/pull/PR。 */
export async function addCollaborator(
  env: Env,
  token: string,
  login: string
): Promise<void> {
  const res = await fetch(
    `${API}/repos/${env.TARGET_REPO_OWNER}/${env.TARGET_REPO_NAME}/collaborators/${encodeURIComponent(login)}`,
    {
      method: 'PUT',
      headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission: 'push' }),
    }
  );
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(502, `添加协作者失败：${data.message ?? res.status}`);
  }
}

/** 取仓库的 node_id（GraphQL 操作需要）。 */
export async function getRepoNodeId(env: Env, token: string): Promise<string> {
  const res = await fetch(
    `${API}/repos/${env.TARGET_REPO_OWNER}/${env.TARGET_REPO_NAME}`,
    { headers: ghHeaders(token) }
  );
  if (!res.ok) throw new ApiError(502, `读取仓库信息失败 (${res.status})`);
  const data = (await res.json()) as { node_id?: string };
  if (!data.node_id) throw new ApiError(502, '仓库 node_id 缺失');
  return data.node_id;
}

/**
 * 用 GraphQL 创建一条分支保护规则。
 * pattern 支持 fnmatch 通配符（如 alice、alice/*、alice/**\/*）。
 * pushActorIds 是允许推送的用户 node_id 列表——其他人一律被拒（管理员默认可绕过）。
 * 默认行为已包含：禁 force push、禁删分支，所以不用显式传这两个开关。
 */
export async function createBranchProtectionRule(
  token: string,
  repoNodeId: string,
  pattern: string,
  pushActorIds: string[]
): Promise<string> {
  const data = await gql<{
    createBranchProtectionRule: { branchProtectionRule: { id: string } };
  }>(
    token,
    `mutation($input: CreateBranchProtectionRuleInput!) {
      createBranchProtectionRule(input: $input) {
        branchProtectionRule { id }
      }
    }`,
    {
      input: {
        repositoryId: repoNodeId,
        pattern,
        restrictsPushes: true,
        pushActorIds,
        isAdminEnforced: false,
      },
    }
  );
  return data.createBranchProtectionRule.branchProtectionRule.id;
}

/** 更新已有规则（按 pattern 定位到的 rule id）。 */
export async function updateBranchProtectionRule(
  token: string,
  ruleId: string,
  pattern: string,
  pushActorIds: string[]
): Promise<void> {
  await gql(
    token,
    `mutation($input: UpdateBranchProtectionRuleInput!) {
      updateBranchProtectionRule(input: $input) {
        branchProtectionRule { id }
      }
    }`,
    {
      input: {
        branchProtectionRuleId: ruleId,
        pattern,
        restrictsPushes: true,
        pushActorIds,
        isAdminEnforced: false,
      },
    }
  );
}

export async function deleteBranchProtectionRule(token: string, ruleId: string): Promise<void> {
  await gql(
    token,
    `mutation($input: DeleteBranchProtectionRuleInput!) {
      deleteBranchProtectionRule(input: $input) { clientMutationId }
    }`,
    { input: { branchProtectionRuleId: ruleId } }
  );
}

/** 列出仓库现有的全部旧式分支保护规则（id + pattern，自动翻页）。 */
export async function listProtectionRules(
  token: string,
  repoNodeId: string
): Promise<Array<{ id: string; pattern: string }>> {
  const rules: Array<{ id: string; pattern: string }> = [];
  let cursor: string | null = null;
  type RulesPage = {
    node: {
      branchProtectionRules: {
        nodes: Array<{ id: string; pattern: string }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } | null;
  };
  do {
    const after: string | null = cursor;
    const data: RulesPage = await gql<RulesPage>(
      token,
      `query($id: ID!, $after: String) {
        node(id: $id) {
          ... on Repository {
            branchProtectionRules(first: 100, after: $after) {
              nodes { id pattern }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }`,
      { id: repoNodeId, after }
    );
    const conn = data.node?.branchProtectionRules;
    rules.push(...(conn?.nodes ?? []));
    cursor = conn?.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);
  return rules;
}

/**
 * 按 pattern 建或改一条规则：已存在就更新（把允许推送的人换成新的），
 * 不存在就新建。这样命名空间被回收后再分配时也不会撞「pattern 已存在」。
 */
export async function upsertProtectionRule(
  token: string,
  repoNodeId: string,
  existing: Array<{ id: string; pattern: string }>,
  pattern: string,
  pushActorIds: string[]
): Promise<'created' | 'updated'> {
  const rule = existing.find((r) => r.pattern === pattern);
  if (rule) {
    await updateBranchProtectionRule(token, rule.id, pattern, pushActorIds);
    return 'updated';
  }
  await createBranchProtectionRule(token, repoNodeId, pattern, pushActorIds);
  return 'created';
}
