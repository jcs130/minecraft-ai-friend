-- 0001_init (sqlite): mc-gateway 嵌入式兜底库（零依赖；无 HNSW/向量索引，embedding 存 JSON）
CREATE TABLE IF NOT EXISTS roles(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  perms TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO roles(name,perms) VALUES
  ('owner','{"admin":true,"mod":true}'),
  ('admin','{"admin":true,"mod":true}'),
  ('member','{"admin":false,"mod":false}'),
  ('guest','{"admin":false,"mod":false}')
ON CONFLICT(name) DO NOTHING;

CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT, avatar TEXT,
  role_id INTEGER NOT NULL DEFAULT 3 REFERENCES roles(id),
  status TEXT NOT NULL DEFAULT 'active',
  server_tag INTEGER DEFAULT 0,
  mc_uuid TEXT, email TEXT, verified_at TEXT,
  password_changed_at TEXT,
  created_at TEXT, updated_at TEXT, last_login TEXT
);
CREATE INDEX IF NOT EXISTS users_role_idx ON users(role_id);

CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT, expires_at TEXT NOT NULL,
  ip TEXT, user_agent TEXT, revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS device_bindings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  machine_key_hash TEXT NOT NULL, platform TEXT,
  bound_at TEXT, last_seen TEXT, is_active INTEGER DEFAULT 1,
  UNIQUE(user_id, machine_key_hash)
);

CREATE TABLE IF NOT EXISTS login_attempts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT, ip TEXT, success INTEGER, reason TEXT, at TEXT
);

CREATE TABLE IF NOT EXISTS profiles(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT, bio TEXT,
  preferences TEXT NOT NULL DEFAULT '{}',
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS skins(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  texture_url TEXT, model TEXT DEFAULT 'classic', sha256 TEXT,
  is_active INTEGER DEFAULT 0, uploaded_at TEXT
);

CREATE TABLE IF NOT EXISTS characters(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name TEXT, class TEXT, stats TEXT DEFAULT '{}',
  is_active INTEGER DEFAULT 0, created_at TEXT
);

CREATE TABLE IF NOT EXISTS spells(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, category TEXT,
  description TEXT, chant TEXT, tier TEXT, rarity TEXT,
  is_public INTEGER DEFAULT 1, created_at TEXT
);

CREATE TABLE IF NOT EXISTS user_spells(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  spell_id INTEGER REFERENCES spells(id) ON DELETE CASCADE,
  learned_at TEXT, source TEXT, proficiency INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1, UNIQUE(user_id, spell_id)
);

CREATE TABLE IF NOT EXISTS spell_embeddings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spell_id INTEGER REFERENCES spells(id) ON DELETE CASCADE,
  model TEXT NOT NULL, dim INTEGER NOT NULL,
  embedding TEXT NOT NULL,             -- sqlite 兜底存 JSON 数组；PG 版用 vector(1024)
  updated_at TEXT, UNIQUE(spell_id, model)
);

CREATE TABLE IF NOT EXISTS chant_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  session_id TEXT, raw_text TEXT,
  matched_spell_id INTEGER REFERENCES spells(id),
  method TEXT, confidence REAL, consumed_mana INTEGER,
  outcome TEXT, at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_type TEXT, actor_id INTEGER, actor_name TEXT,
  ip TEXT, action TEXT NOT NULL,
  object_type TEXT, object_id TEXT,
  old_data TEXT, new_data TEXT, reason TEXT, request_id TEXT
);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_log(at);
CREATE INDEX IF NOT EXISTS audit_obj_idx ON audit_log(object_type, object_id);
CREATE INDEX IF NOT EXISTS audit_actor_idx ON audit_log(actor_id);

CREATE TABLE IF NOT EXISTS schema_migrations(
  version INTEGER PRIMARY KEY,
  name TEXT, applied_at TEXT, applied_by TEXT, checksum TEXT, duration_ms INTEGER
);
