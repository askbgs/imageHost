// Database migrations, embedded in code so they run wherever the app runs (no SQL files
// to copy). They are applied automatically when the web app or worker starts, and by
// `node dist/migrate.js`. Each one runs once, in order, inside a transaction; all of them
// are also written to be safe on databases created by earlier versions of imghost.
//
// To change the schema, append a new migration. Never edit one that has shipped.

export type Migration = { id: number; name: string; sql: string };

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "initial schema",
    sql: `
-- gen_random_uuid() is built into Postgres 13+; only older versions need pgcrypto.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'gen_random_uuid') THEN
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  plan          TEXT NOT NULL DEFAULT 'free',     -- free | pro
  storage_used  BIGINT NOT NULL DEFAULT 0,        -- bytes
  status        TEXT NOT NULL DEFAULT 'active',   -- active | suspended
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash     TEXT UNIQUE NOT NULL,              -- SHA-256 of the raw key
  key_prefix   TEXT NOT NULL,                     -- first 8 chars, for display
  name         TEXT,
  rate_limit   INT NOT NULL DEFAULT 100,          -- uploads per hour
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS albums (
  id         TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  privacy    TEXT NOT NULL DEFAULT 'public',      -- public | unlisted | private
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS images (
  id            TEXT PRIMARY KEY,                 -- 8-char base62
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  album_id      TEXT REFERENCES albums(id) ON DELETE SET NULL,
  api_key_id    UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  original_name TEXT,
  title         TEXT,
  slug          TEXT NOT NULL,                    -- safe file name used in URLs, e.g. photo.jpg
  storage_key   TEXT NOT NULL,                    -- key of the processed original
  upload_key    TEXT NOT NULL,                    -- key of the raw upload (deleted after processing)
  mime_type     TEXT,
  size_bytes    BIGINT,
  width         INT,
  height        INT,
  sha256        TEXT,
  privacy       TEXT NOT NULL DEFAULT 'public',
  delete_token  TEXT UNIQUE NOT NULL,
  expires_at    TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | active | flagged | failed | removed
  fail_reason   TEXT,
  views         BIGINT NOT NULL DEFAULT 0,
  uploader_ip   INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS image_variants (
  image_id    TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  variant     TEXT NOT NULL,                      -- thumb | medium
  storage_key TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  width       INT NOT NULL,
  height      INT NOT NULL,
  size_bytes  BIGINT NOT NULL,
  PRIMARY KEY (image_id, variant)
);

CREATE TABLE IF NOT EXISTS reports (
  id          BIGSERIAL PRIMARY KEY,
  image_id    TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,                      -- illegal | nsfw | copyright | spam | other
  details     TEXT,
  reporter_ip INET,
  status      TEXT NOT NULL DEFAULT 'open',       -- open | actioned | dismissed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blocked_hashes (
  sha256     TEXT PRIMARY KEY,
  reason     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_images_user    ON images (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_images_apikey  ON images (api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_images_expires ON images (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_images_sha256  ON images (sha256);
CREATE INDEX IF NOT EXISTS idx_images_stale   ON images (created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_reports_open   ON reports (status, created_at) WHERE status = 'open';
`,
  },
  {
    id: 2,
    name: "accounts and sessions",
    sql: `
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';   -- user | admin
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,                  -- SHA-256 of the cookie token
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
`,
  },
  {
    id: 3,
    name: "social sign-in",
    sql: `
CREATE TABLE IF NOT EXISTS oauth_accounts (
  provider         TEXT NOT NULL,                 -- github | google | facebook
  provider_user_id TEXT NOT NULL,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email            TEXT,
  display_name     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at     TIMESTAMPTZ,
  PRIMARY KEY (provider, provider_user_id),
  UNIQUE (user_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts (user_id);
`,
  },
];
