# PinPicX

Self-hosted image hosting: drag and drop anywhere on the page (or paste, pick files, or give a URL), and get a viewer page, a direct link, and HTML, BBCode and Markdown embeds. Includes an upload API with keys and rate limits, and a moderation queue.

This covers Phases 1 to 2 of the spec and most of Phase 3: core upload, the public API, safety tooling, and user accounts with a personal image library and self-service API keys. Albums and paid plans are not built yet.

## What's included

| Area | Details |
| --- | --- |
| Web uploader | Full-window drop target, clipboard paste, file picker, URL import, expiry choice, 3 parallel uploads with progress, copy buttons for every format |
| Storage | Cloudflare R2. Images are served from your R2 custom domain through Cloudflare's CDN, with free egress; deletions purge the CDN cache when a Cloudflare token is set. See [R2.md](R2.md) |
| Upload pipeline | Browser uploads go straight to R2 with signed URLs; a worker re-encodes each image with sharp (strips EXIF and GPS, applies orientation, neutralises hidden payloads) and makes a 180 px square thumbnail and a 640 px medium size |
| Viewer page | `/{id}` with Open Graph tags for link previews, share codes, download, and a report form; flagged images are blurred |
| API | `POST /v1/upload` (file, base64 or URL), `GET /v1/images`, `GET` and `DELETE /v1/images/{id}`, `POST /v1/reports`; docs at `/api-docs` |
| Delete links | Every upload gets a secret delete link, so guests can remove their images |
| Expiry | 5 minutes to 6 months; a worker job removes expired and abandoned uploads every 10 minutes |
| Safety | Magic-byte type checks (SVG and HEIC rejected), 32 MB and 100-megapixel caps, SSRF protection for URL uploads, per-IP and per-key rate limits, block list for removed images and their look-alikes, automatic screening of every upload for adult content, graphic violence and self-harm (OpenAI moderation, free), pausing of repeat offenders. See [MODERATION.md](MODERATION.md) |
| Social sign-in | GitHub, Google and Facebook, each enabled by setting its client ID and secret. See [SOCIAL_LOGIN.md](SOCIAL_LOGIN.md) |
| Albums | Group images into albums and share each with one link (/a/{id}). Public (also listed on /u/{username}), unlisted, or private on Pro and Business. Upload straight into an album from the website or with the API `album` field |
| Plans and payments | Free, Pro and Business plans with their own storage (1 GB / 50 GB / 500 GB by default), API and upload limits. Monthly or yearly subscriptions through Paddle: checkout, upgrades, cancellation and invoices. See [PADDLE.md](PADDLE.md) |
| Accounts | Sign up and sign in with email and password (scrypt hashes, server-side sessions in httpOnly cookies, lockout after repeated wrong passwords). Uploading from the website requires an account by default |
| My images | Every upload is saved to the uploader's library: search, copy links, open, delete |
| API keys | Users create and revoke their own keys (shown once, stored hashed). Images uploaded with a key land in the owner's library. Limits depend on the plan: Free has 1 key and 10 API uploads per hour, counted across the account; admins change plans under Moderation → Users |
| Settings | Change name and password (signs out other devices), connect or disconnect GitHub, Google and Facebook, sign out everywhere, delete the account and all its images |
| Moderation | `/admin` for admin accounts: open reports, flagged images, recent uploads, users; remove, remove and block the file, dismiss, mark safe, suspend a user (which also revokes their keys and sessions) |

Stack: Next.js 16, Postgres, Redis with BullMQ, Cloudflare R2, sharp, Caddy for HTTPS. Any S3-compatible service (for example MinIO for local development) also works.

## Deploy on Railway

First set up the R2 bucket with [R2.md](R2.md), then follow [RAILWAY.md](RAILWAY.md): web and worker services from this repo, plus Railway Postgres and Redis, set up in the dashboard.

## Deploy on a VPS with Docker Compose

Set up the R2 bucket and its image domain first ([R2.md](R2.md)). Then you need a server with Docker, ports 80 and 443 open, and a DNS record for `yoursite.com` pointing at it.

```bash
cp .env.example .env
# Edit .env: SITE_URL, SITE_HOST, POSTGRES_PASSWORD, the R2_* values, ADMIN_EMAILS, ABUSE_EMAIL
docker compose up -d --build
docker compose exec app node dist/setup-bucket.js
docker compose logs -f app worker
```

Caddy gets HTTPS certificates automatically on first request. The app and worker create and upgrade the database tables themselves on startup (look for `[migrate]` in the logs). `docker compose exec app node dist/migrate.js` does the same by hand.

### Accounts and API keys

Create an account on the site with an email listed in `ADMIN_EMAILS`; that account can open `/admin`. Other people sign up themselves and create API keys under **API keys**. To close sign-ups, set `ALLOW_SIGNUP=false`. To let people upload without an account, set `REQUIRE_LOGIN_TO_UPLOAD=false` (the API always needs a key).

You can also issue a key from the command line:

```bash
docker compose exec app node dist/create-api-key.js you@example.com "n8n automations" 500
```

Arguments: email, a name for the key, uploads per hour. The key is printed once; only its hash is stored.

```bash
curl -X POST "https://yoursite.com/v1/upload?key=YOUR_KEY" -F "image=@photo.jpg"
```

Use it from ShareX (custom uploader), WordPress plugins that accept a custom upload endpoint, or an n8n HTTP Request node: send `POST https://yoursite.com/v1/upload` with your key and an `image` field.

### Moving existing images to R2

If an earlier version stored images in MinIO, a Railway bucket or another S3 service, copy them with `node dist/migrate-storage.js` (see [R2.md](R2.md#moving-existing-images-to-r2)). Old links on your site forward to the R2 domain.

### Cloudflare in front of the site

If all traffic to `yoursite.com` also goes through Cloudflare's proxy, set `TRUST_CLOUDFLARE=true` so rate limits use the real client IP.

## Before you open public uploads

Abuse handling is the biggest risk for a public image host. Do these first:

1. **CSAM detection.** The built-in block list only matches exact files you've removed. Enable Cloudflare's CSAM Scanning Tool on the zone of your R2 image domain, or apply for Microsoft PhotoDNA, and follow its reporting duties.
2. **Automatic screening.** Set `OPENAI_API_KEY` and every upload is screened before it goes live: adult images and graphic violence are marked sensitive (or blocked, if you choose), self-harm is marked sensitive, and accounts with repeated blocked uploads are paused for review. Also turn on Cloudflare's CSAM Scanning Tool for the image domain. Details in [MODERATION.md](MODERATION.md).
3. **Legal.** Review `/terms` and `/abuse` (templates in `app/terms` and `app/abuse`) with a lawyer, including Sri Lanka's Online Safety Act, and set a monitored `ABUSE_EMAIL`.
4. **Watch the queue.** Check `/admin` daily.

## Local development

Needs Node 20+, Postgres and Redis, plus either an R2 bucket for development or local MinIO (`docker compose --profile local-storage up -d minio`, then create the bucket with `node dist/setup-bucket.js`).

```bash
npm install
export DATABASE_URL=postgres://pinpicx:pinpicx@localhost:5432/pinpicx
export REDIS_URL=redis://localhost:6379
# R2: export R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=pinpicx-dev
# or MinIO:
export S3_ENDPOINT=http://localhost:9000 S3_ACCESS_KEY_ID=minio-admin S3_SECRET_ACCESS_KEY=change-me-at-least-8-chars S3_BUCKET=pinpicx
export ADMIN_EMAILS=you@example.com TRUST_PROXY=false
npm run dev          # web app on http://localhost:3000
npm run worker:dev   # image processing worker, in a second terminal
npx tsx scripts/create-api-key.ts you@example.com dev 1000
```

## Upload and delivery modes

| Variable | Values | Use |
| --- | --- | --- |
| `UPLOAD_MODE` | `direct` (default) | Browsers upload straight to the bucket with signed URLs. Needs the CORS rule; `node dist/setup-bucket.js` sets it. |
| | `server` | Browsers send the file to the app, which stores it. No CORS needed. |
| `IMAGE_DELIVERY` | `public` (default with `R2_PUBLIC_URL`) | Links point at the R2 custom domain; Cloudflare serves and caches them. Old `/i/...` links forward there. |
| | `redirect` (default with R2 and no public domain) | `/i/...` links redirect to signed R2 URLs (re-signed hourly, valid a day). |
| | `proxy` | `/i/...` streams image bytes through the app. |
| `CLIENT_IP_HEADER` | header name | Read the client IP from this one header, for example `x-real-ip` on Railway. |

## How an upload flows

1. The browser asks `POST /api/internal/uploads/presign` for a signed URL, sending name, size and type. The server checks the size, type and guest rate limit, and creates an `images` row with status `pending`.
2. The browser PUTs the file directly to storage. The signature pins the size and type, so it can't upload something else.
3. The browser calls `/complete`. The server confirms the object exists and queues processing.
4. The worker downloads the raw upload, checks magic bytes and the block list, re-encodes the original, writes thumb and medium sizes, optionally scores it, and marks the row `active` or `flagged`.
5. The browser receives the links. If processing takes over a minute it gets HTTP 202 and polls.

API uploads skip step 2: the server stores the bytes itself and waits for the worker.

## Project layout

```
app/                Next.js routes
  page.tsx            uploader
  [id]/               viewer page and delete page
  i/[id]/[...path]/   serves image bytes (original, t/ thumb, m/ medium)
  login/, signup/     sign-in and sign-up pages
  auth/[provider]/    GitHub, Google and Facebook sign-in and callbacks
  privacy/            privacy page (also the data-deletion page Facebook asks for)
  account/            My images, API keys, settings
  actions/            server actions for auth and account changes
  admin/              moderation queue (admin accounts only)
  api/v1/             public API, version 1
  api/internal/       browser upload flow
components/         Uploader, ShareCodes, ImageTile, KeyCreator, AccountMenu, Toast and forms
lib/                config, db, s3, queue, rate limit, processing, moderation, links, auth, password
worker/worker.ts    worker service entry point (processing and cleanup, see lib/worker-runtime.ts)
scripts/            migrate, create-api-key, setup-bucket, migrate-storage
lib/migrations.ts   database schema as numbered migrations, applied on startup
instrumentation.ts  runs the migrations when the web app starts
deploy/Caddyfile    HTTPS reverse proxy for the site
```

## Not built yet

- Email verification and password reset by email (needs an email provider; an admin can suspend accounts meanwhile)
- Albums and private images (the schema has the tables)
- Client-side resize before upload, HEIC support
- Paid plans, custom domains, viewer-page ads, usage analytics
