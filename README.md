# imghost

Self-hosted image hosting: drag and drop anywhere on the page (or paste, pick files, or give a URL), and get a viewer page, a direct link, and HTML, BBCode and Markdown embeds. Includes an ImgBB-compatible upload API with keys and rate limits, and a moderation queue.

This is Phase 1 and Phase 2 of the spec: core upload, the public API, and the safety tooling needed before a public launch. Accounts, albums and paid plans (Phases 3 and 4) are not built yet.

## What's included

| Area | Details |
| --- | --- |
| Web uploader | Full-window drop target, clipboard paste, file picker, URL import, expiry choice, 3 parallel uploads with progress, copy buttons for every format |
| Upload pipeline | Browser uploads go straight to S3 storage with presigned URLs; a worker re-encodes each image with sharp (strips EXIF and GPS, applies orientation, neutralises hidden payloads) and makes a 180 px square thumbnail and a 640 px medium size |
| Viewer page | `/{id}` with Open Graph tags for link previews, share codes, download, and a report form; flagged images are blurred |
| API | `POST /1/upload` (file, base64 or URL), `GET /1/images`, `GET` and `DELETE /1/images/{id}`, `POST /1/reports`; docs at `/api-docs` |
| Delete links | Every upload gets a secret delete link, so guests can remove their images |
| Expiry | 5 minutes to 6 months; a worker job removes expired and abandoned uploads every 10 minutes |
| Safety | Magic-byte type checks (SVG and HEIC rejected), 32 MB and 100-megapixel caps, SSRF protection for URL uploads, per-IP and per-key rate limits, exact-hash block list, optional NSFW scoring hook |
| Moderation | `/admin` (password protected): open reports, flagged images, recent uploads; remove, remove and block the file, dismiss, mark safe |

Stack: Next.js 16, Postgres, Redis with BullMQ, S3-compatible storage (MinIO in Docker, or Cloudflare R2), sharp, Caddy for HTTPS.

## Deploy on Railway

See [RAILWAY.md](RAILWAY.md): web and worker services from this repo, plus Railway Postgres, Redis and a Bucket, set up in the dashboard in about 15 minutes.

## Deploy on a VPS with Docker Compose

You need a server with Docker, ports 80 and 443 open, and three DNS records pointing at it: `yoursite.com`, `i.yoursite.com` (images) and `s3.yoursite.com` (browser uploads to storage).

```bash
cp .env.example .env
# Edit .env: domains, POSTGRES_PASSWORD, S3 keys, ADMIN_PASSWORD, ABUSE_EMAIL
docker compose up -d --build
docker compose logs -f app worker
```

Caddy gets HTTPS certificates automatically on first request. The database schema is applied when Postgres first starts. After an upgrade that changes `db/schema.sql`, run:

```bash
docker compose exec app node dist/migrate.js
```

### Issue an API key

```bash
docker compose exec app node dist/create-api-key.js you@example.com "n8n automations" 500
```

Arguments: email, a name for the key, uploads per hour. The key is printed once; only its hash is stored.

```bash
curl -X POST "https://yoursite.com/1/upload?key=YOUR_KEY" -F "image=@photo.jpg"
```

Tools that support ImgBB (ShareX, WordPress plugins, an n8n HTTP Request node) work by replacing `https://api.imgbb.com` with `https://yoursite.com` and using your key.

### Use Cloudflare R2 instead of MinIO

1. Create an R2 bucket and an API token with read and write access to it.
2. Add a CORS rule on the bucket allowing `PUT` from your `SITE_URL` with the `Content-Type` header.
3. In `.env`, use the R2 block from `.env.example` (endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=false`).
4. Remove the `minio` and `minio-init` services from `docker-compose.yml` (and their `depends_on` entries), and the `{$S3_HOST}` block from `deploy/Caddyfile`.
5. Add an R2 lifecycle rule deleting objects under `uploads/` after 1 day.

### Put Cloudflare in front

Proxy `i.yoursite.com` through Cloudflare to cache images at the edge; responses carry long-lived cache headers (shorter for images that expire). If all traffic reaches the server through Cloudflare, set `TRUST_CLOUDFLARE=true` so rate limits use the real client IP. Purge the cache for an image's URLs after removing it in `/admin`.

## Before you open public uploads

Abuse handling is the biggest risk for a public image host. Do these first:

1. **CSAM detection.** The built-in block list only matches exact files you've removed. Enable Cloudflare's CSAM Scanning Tool on the image domain, or apply for Microsoft PhotoDNA, and follow its reporting duties.
2. **NSFW scoring.** Set `MODERATION_WEBHOOK_URL` to an endpoint that takes image bytes and returns `{"nsfw": 0.0–1.0}`. Images at or above `MODERATION_THRESHOLD` are flagged: blurred on the viewer page and listed in `/admin`. An n8n workflow calling a classifier works well here.
3. **Legal.** Review `/terms` and `/abuse` (templates in `app/terms` and `app/abuse`) with a lawyer, including Sri Lanka's Online Safety Act, and set a monitored `ABUSE_EMAIL`.
4. **Watch the queue.** Check `/admin` daily.

## Local development

Needs Node 20+, Postgres, Redis and an S3-compatible store (the simplest is `docker compose up -d postgres redis minio minio-init` with the ports published).

```bash
npm install
export DATABASE_URL=postgres://imghost:imghost@localhost:5432/imghost
export REDIS_URL=redis://localhost:6379
export S3_ENDPOINT=http://localhost:9000 S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... S3_BUCKET=imghost
export ADMIN_PASSWORD=dev TRUST_PROXY=false
npm run migrate
npm run dev          # web app on http://localhost:3000
npm run worker:dev   # image processing worker, in a second terminal
npx tsx scripts/create-api-key.ts you@example.com dev 1000
```

## Upload and delivery modes

| Variable | Values | Use |
| --- | --- | --- |
| `UPLOAD_MODE` | `direct` (default) | Browsers upload straight to storage with presigned URLs. Needs CORS on the bucket; `node dist/setup-bucket.js` tries to set it. |
| | `server` | Browsers send the file to the app, which stores it. Works with any storage. |
| `IMAGE_DELIVERY` | `proxy` (default) | `/i/...` streams image bytes through the app. Best with a CDN in front. |
| | `redirect` | `/i/...` redirects to a signed storage URL (re-signed hourly, valid a day). Best where storage egress is free, such as Railway buckets. |
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
  admin/              moderation queue (Basic auth via proxy.ts)
  api/1/              public API
  api/internal/       browser upload flow
components/         Uploader, ShareCodes, ReportForm
lib/                config, db, s3, queue, rate limit, processing, moderation, links
worker/worker.ts    BullMQ worker: processing and cleanup
scripts/            migrate, create-api-key, setup-bucket
db/schema.sql       database schema (idempotent)
deploy/Caddyfile    HTTPS reverse proxy for the three hostnames
```

## Not built yet

- User accounts, sign-up and login; albums and private images (schema has the tables)
- Self-service API key dashboard (keys are issued with the script for now)
- Client-side resize before upload, HEIC support
- Paid plans, custom domains, viewer-page ads, usage analytics
