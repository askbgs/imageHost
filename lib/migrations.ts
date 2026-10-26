// Database migrations, embedded in code so they run wherever the app runs (no SQL files
// to copy). They are applied automatically when the web app or worker starts, and by
// `node dist/migrate.js`. Each one runs once, in order, inside a transaction; all of them
// are also written to be safe on databases created by earlier versions of the app.
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
  {
    id: 4,
    name: "upload source and default plan",
    sql: `
ALTER TABLE images ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web';  -- web | api
UPDATE images SET source = 'api' WHERE api_key_id IS NOT NULL AND source <> 'api';
CREATE INDEX IF NOT EXISTS idx_images_user_source ON images (user_id, source, created_at DESC);
ALTER TABLE users ALTER COLUMN plan SET DEFAULT 'free';
UPDATE users SET plan = 'free' WHERE plan IS NULL OR plan NOT IN ('free', 'pro', 'business');
`,
  },
  {
    id: 5,
    name: "paddle billing",
    sql: `
ALTER TABLE users ADD COLUMN IF NOT EXISTS paddle_customer_id TEXT UNIQUE;

-- One row per Paddle subscription, kept in sync by the webhook.
CREATE TABLE IF NOT EXISTS subscriptions (
  id                  TEXT PRIMARY KEY,               -- Paddle sub_...
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  customer_id         TEXT NOT NULL,                  -- Paddle ctm_...
  status              TEXT NOT NULL,                  -- active | trialing | past_due | paused | canceled
  plan                TEXT NOT NULL,                  -- pro | business
  price_id            TEXT,
  billing_interval    TEXT,                           -- month | year
  currency            TEXT,
  current_period_end  TIMESTAMPTZ,
  next_billed_at      TIMESTAMPTZ,
  scheduled_change    TEXT,                           -- cancel | pause | resume
  scheduled_change_at TIMESTAMPTZ,
  canceled_at         TIMESTAMPTZ,
  paddle_updated_at   TIMESTAMPTZ NOT NULL,           -- ignore events older than this
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions (customer_id);

-- Webhook events already handled, so retries are processed once.
CREATE TABLE IF NOT EXISTS paddle_events (
  id          TEXT PRIMARY KEY,                       -- evt_...
  type        TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`,
  },
  {
    id: 6,
    name: "storage quota",
    sql: `
-- Bytes kept in storage for an image: the original plus its thumbnails. Set when processing finishes.
ALTER TABLE images ADD COLUMN IF NOT EXISTS stored_bytes BIGINT;
-- Size received or declared at upload. Holds the space while the image is still being processed.
ALTER TABLE images ADD COLUMN IF NOT EXISTS upload_bytes BIGINT;
UPDATE images i
   SET stored_bytes = COALESCE(i.size_bytes, 0)
                    + COALESCE((SELECT sum(v.size_bytes) FROM image_variants v WHERE v.image_id = i.id), 0)
 WHERE i.stored_bytes IS NULL AND i.status IN ('active', 'flagged');
CREATE INDEX IF NOT EXISTS idx_images_user_status ON images (user_id, status);
`,
  },
  {
    id: 7,
    name: "albums",
    sql: `
-- The first schema created a placeholder albums table (id, user_id, title, privacy, created_at)
-- and images.album_id, which nothing used. Upgrade that table in place, keeping any rows.
ALTER TABLE albums ADD COLUMN IF NOT EXISTS description    TEXT;
ALTER TABLE albums ADD COLUMN IF NOT EXISTS visibility     TEXT NOT NULL DEFAULT 'unlisted';
ALTER TABLE albums ADD COLUMN IF NOT EXISTS cover_image_id TEXT REFERENCES images(id) ON DELETE SET NULL;
ALTER TABLE albums ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT now();
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'albums' AND column_name = 'privacy') THEN
    UPDATE albums SET visibility = privacy WHERE privacy IN ('public', 'unlisted', 'private');
    ALTER TABLE albums DROP COLUMN privacy;
  END IF;
END $$;
ALTER TABLE albums DROP CONSTRAINT IF EXISTS albums_visibility_check;
ALTER TABLE albums ADD CONSTRAINT albums_visibility_check CHECK (visibility IN ('public', 'unlisted', 'private'));
CREATE INDEX IF NOT EXISTS idx_albums_user ON albums (user_id, updated_at DESC);

-- An image can be in several albums.
CREATE TABLE IF NOT EXISTS album_images (
  album_id  TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  image_id  TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  position  INT NOT NULL DEFAULT 0,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (album_id, image_id)
);
CREATE INDEX IF NOT EXISTS idx_album_images_image ON album_images (image_id);
CREATE INDEX IF NOT EXISTS idx_album_images_order ON album_images (album_id, position);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'images' AND column_name = 'album_id') THEN
    INSERT INTO album_images (album_id, image_id, position)
      SELECT album_id, id, row_number() OVER (PARTITION BY album_id ORDER BY created_at)
        FROM images WHERE album_id IS NOT NULL
      ON CONFLICT DO NOTHING;
    ALTER TABLE images DROP COLUMN album_id;
  END IF;
END $$;
`,
  },
  {
    id: 8,
    name: "automatic screening",
    sql: `
-- What automatic screening found for each image: labels like {adult} and the provider's scores.
ALTER TABLE images ADD COLUMN IF NOT EXISTS moderation_labels TEXT[];
ALTER TABLE images ADD COLUMN IF NOT EXISTS moderation_scores JSONB;
-- 64-bit perceptual hash (dHash): near-identical images (resized, re-saved) have hashes a few bits apart.
ALTER TABLE images ADD COLUMN IF NOT EXISTS phash BIGINT;
CREATE INDEX IF NOT EXISTS idx_images_blocked ON images (created_at DESC) WHERE fail_reason LIKE 'blocked%';

-- Blocking a removed image now also blocks look-alikes, by perceptual hash.
ALTER TABLE blocked_hashes ADD COLUMN IF NOT EXISTS phash BIGINT;

-- Accounts whose uploads were paused after repeated blocked uploads, until an admin resumes them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS uploads_paused_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS uploads_resumed_at TIMESTAMPTZ;
`,
  },
  {
    id: 9,
    name: "contact messages",
    sql: `
-- Messages from the contact form. Saved even when email isn't set up, and listed in /admin.
CREATE TABLE IF NOT EXISTS contact_messages (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  topic       TEXT NOT NULL,
  message     TEXT NOT NULL,
  ip          TEXT,
  status      TEXT NOT NULL DEFAULT 'new',   -- new | done
  emailed_at  TIMESTAMPTZ,
  email_error TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_messages_new ON contact_messages (status, created_at DESC);
`,
  },
  {
    id: 10,
    name: "password resets",
    sql: `
-- One row per "forgot password" email. Only a SHA-256 of the link's token is stored, like a password,
-- so a database leak doesn't hand out working reset links.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id, created_at DESC);
`,
  },
];
