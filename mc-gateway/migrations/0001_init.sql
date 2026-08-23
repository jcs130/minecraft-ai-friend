-- 0001_init: mc-gateway 门户主库（PostgreSQL + pgvector）权威 schema
-- 依赖：C:\Python314\python.exe 跑 migrate.py 执行；需在库上创建 pgvector/pgcrypto。
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 角色
CREATE TABLE roles(
  id SMALLSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  perms JSONB NOT NULL DEFAULT '{}'
);
INSERT INTO roles(name, perms) VALUES
  ('owner','{"admin":true,"mod":true}'),
  ('admin','{"admin":true,"mod":true}'),
  ('member','{"admin":false,"mod":false}'),
  ('guest','{"admin":false,"mod":false}')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE users(
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{3,24}$'),
  password_hash TEXT NOT NULL,
  nickname TEXT,
  avatar TEXT,
  role_id SMALLINT NOT NULL DEFAULT 3 REFERENCES roles(id),
  status TEXT NOT NULL DEFAULT 'active',
  server_tag INTEGER DEFAULT 0,
  mc_uuid UUID,
  email TEXT, verified_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS users_role_idx ON users(role_id);

CREATE TABLE sessions(
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ip INET, user_agent TEXT,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE device_bindings(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  machine_key_hash TEXT NOT NULL,
  platform TEXT,
  bound_at TIMESTAMPTZ DEFAULT now(),
  last_seen TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(user_id, machine_key_hash)
);

CREATE TABLE login_attempts(
  id BIGSERIAL PRIMARY KEY,
  username TEXT, ip INET, success BOOLEAN,
  reason TEXT, at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE profiles(
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT, bio TEXT,
  preferences JSONB NOT NULL DEFAULT '{}',
  data JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE skins(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  texture_url TEXT, model TEXT DEFAULT 'classic',
  sha256 TEXT, is_active BOOLEAN DEFAULT false,
  uploaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE characters(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT, class TEXT, stats JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE spells(
  id BIGSERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL, category TEXT,
  description TEXT, chant TEXT, tier TEXT, rarity TEXT,
  is_public BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_spells(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  spell_id BIGINT REFERENCES spells(id) ON DELETE CASCADE,
  learned_at TIMESTAMPTZ DEFAULT now(),
  source TEXT,
  proficiency SMALLINT DEFAULT 1, is_active BOOLEAN DEFAULT true,
  UNIQUE(user_id, spell_id)
);

CREATE TABLE spell_embeddings(
  id BIGSERIAL PRIMARY KEY,
  spell_id BIGINT REFERENCES spells(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dim INT NOT NULL,
  embedding vector(1024) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(spell_id, model)
);
CREATE INDEX IF NOT EXISTS spell_emb_hnsw ON spell_embeddings
  USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);

CREATE TABLE chant_log(
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  session_id TEXT, raw_text TEXT,
  matched_spell_id BIGINT REFERENCES spells(id),
  method TEXT, confidence REAL, consumed_mana INT,
  outcome TEXT, at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE audit_log(
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_type TEXT,
  actor_id BIGINT, actor_name TEXT,
  ip INET,
  action TEXT NOT NULL,
  object_type TEXT, object_id TEXT,
  old_data JSONB, new_data JSONB,
  reason TEXT, request_id TEXT
);
CREATE OR REPLACE FUNCTION forbid_audit_change() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_log;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_audit_change();
DROP TRIGGER IF EXISTS trg_audit_no_delete ON audit_log;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_audit_change();
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_log(at);
CREATE INDEX IF NOT EXISTS audit_obj_idx ON audit_log(object_type, object_id);
CREATE INDEX IF NOT EXISTS audit_actor_idx ON audit_log(actor_id);

CREATE TABLE schema_migrations(
  version INT PRIMARY KEY,
  name TEXT,
  applied_at TIMESTAMPTZ DEFAULT now(),
  applied_by TEXT, checksum TEXT, duration_ms INT
);
