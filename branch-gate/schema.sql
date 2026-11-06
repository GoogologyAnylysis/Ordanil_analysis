-- 【旧库迁移】如果 users 表是早期版本建的（没有 node_id 列），
-- 下面这条 CREATE 不会补列，需要先手工执行一次：
--   ALTER TABLE users ADD COLUMN node_id TEXT NOT NULL DEFAULT '';
-- （全新库直接用本文件建表，不需要执行这句）
-- 更彻底的做法是重建：DROP TABLE users; 再跑本文件。
-- 早期版本的 branches 表本文件已不再使用，可执行 DROP TABLE branches; 清掉。

-- 用户表
-- github_id 是 GitHub 的不可变数字 ID（真实 ID），不是 login。
-- login 可以被改名、被释放后被他人抢注，所以绝对不能拿它当主键。
-- node_id 是 GraphQL 用的全局 ID，创建分支保护规则时需要。
CREATE TABLE IF NOT EXISTS users (
  github_id       INTEGER PRIMARY KEY,
  node_id         TEXT    NOT NULL,
  login           TEXT    NOT NULL,
  name            TEXT,
  avatar_url      TEXT,
  installation_id INTEGER,
  created_at      TEXT    NOT NULL,
  last_login_at   TEXT    NOT NULL
);

-- 命名空间归属表
-- namespace 即用户在仓库里的分支前缀（默认取 GitHub login）。
-- 例如 namespace = "alice" 时，alice 可推 alice、alice/foo、alice/foo/bar，
-- 其他人推不动。namespace 做主键：一个名字只能被一个人占用。
CREATE TABLE IF NOT EXISTS namespaces (
  namespace   TEXT    PRIMARY KEY,
  github_id   INTEGER NOT NULL,
  repo_owner  TEXT    NOT NULL,
  repo_name   TEXT    NOT NULL,
  base_branch TEXT    NOT NULL,
  head_sha    TEXT,
  protected   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

-- 一个用户只能拥有一个命名空间
CREATE UNIQUE INDEX IF NOT EXISTS idx_namespaces_owner ON namespaces (github_id);

-- 会话表：浏览器只拿到随机 token，真实 ID 只存在服务端
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  github_id  INTEGER NOT NULL,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (github_id);
