import type { Env, GitHubViewer, NamespaceRow, UserRow } from './types';

export async function upsertUser(env: Env, viewer: GitHubViewer): Promise<UserRow> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (github_id, node_id, login, name, avatar_url, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(github_id) DO UPDATE SET
       node_id       = excluded.node_id,
       login         = excluded.login,
       name          = excluded.name,
       avatar_url    = excluded.avatar_url,
       last_login_at = excluded.last_login_at`
  )
    .bind(viewer.id, viewer.node_id, viewer.login, viewer.name, viewer.avatar_url, now, now)
    .run();

  const row = await getUser(env, viewer.id);
  if (!row) throw new Error('用户写入后读取失败');
  return row;
}

export async function getUser(env: Env, githubId: number): Promise<UserRow | null> {
  return await env.DB.prepare(`SELECT * FROM users WHERE github_id = ?`)
    .bind(githubId)
    .first<UserRow>();
}

export async function setInstallationId(
  env: Env,
  githubId: number,
  installationId: number | null
): Promise<void> {
  await env.DB.prepare(`UPDATE users SET installation_id = ? WHERE github_id = ?`)
    .bind(installationId, githubId)
    .run();
}

export async function createSession(
  env: Env,
  githubId: number,
  ttlMs: number
): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  await env.DB.prepare(
    `INSERT INTO sessions (token, github_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
  )
    .bind(token, githubId, now.toISOString(), expiresAt.toISOString())
    .run();
  return { token, expiresAt };
}

export async function getSessionUser(env: Env, token: string): Promise<UserRow | null> {
  return await env.DB.prepare(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.github_id = s.github_id
     WHERE s.token = ? AND s.expires_at > ?`
  )
    .bind(token, new Date().toISOString())
    .first<UserRow>();
}

export async function deleteSession(env: Env, token: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
}

/** 按命名空间（即 login）查归属——判断这个名字是否已被占用。 */
export async function getNamespaceByName(env: Env, namespace: string): Promise<NamespaceRow | null> {
  return await env.DB.prepare(`SELECT * FROM namespaces WHERE namespace = ?`)
    .bind(namespace)
    .first<NamespaceRow>();
}

/** 按真实 ID 查这个人的命名空间。 */
export async function getNamespaceByOwner(env: Env, githubId: number): Promise<NamespaceRow | null> {
  return await env.DB.prepare(`SELECT * FROM namespaces WHERE github_id = ?`)
    .bind(githubId)
    .first<NamespaceRow>();
}

export async function insertNamespace(
  env: Env,
  input: {
    namespace: string;
    githubId: number;
    repoOwner: string;
    repoName: string;
    baseBranch: string;
    headSha?: string | null;
  }
): Promise<NamespaceRow> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO namespaces
       (namespace, github_id, repo_owner, repo_name, base_branch, head_sha, protected, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
  )
    .bind(
      input.namespace,
      input.githubId,
      input.repoOwner,
      input.repoName,
      input.baseBranch,
      input.headSha ?? null,
      now,
      now
    )
    .run();

  const row = await getNamespaceByName(env, input.namespace);
  if (!row) throw new Error('命名空间写入后读取失败');
  return row;
}

/** 列出全部命名空间（resync 用，量级小不分页）。 */
export async function listNamespaces(env: Env): Promise<NamespaceRow[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM namespaces ORDER BY namespace`)
    .all<NamespaceRow>();
  return results ?? [];
}

/** 刷新该命名空间的保护状态。 */
export async function refreshNamespaceGrant(
  env: Env,
  namespace: string,
  isProtected: boolean
): Promise<void> {
  await env.DB.prepare(
    `UPDATE namespaces SET protected = ?, updated_at = ? WHERE namespace = ?`
  )
    .bind(isProtected ? 1 : 0, new Date().toISOString(), namespace)
    .run();
}
