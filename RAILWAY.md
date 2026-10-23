# Deploy on Railway

You'll create five things in one Railway project: a **web** service and a **worker** service (both from this repo), plus **Postgres**, **Redis** and a **Bucket**. Railway builds both services from the `Dockerfile`; they differ only in their start command.

Railway buckets are private and have no public URLs, so this setup:

- uploads through the app (`UPLOAD_MODE=server`), which needs no bucket CORS, and
- serves images by redirecting `/i/...` links to short-lived signed bucket URLs (`IMAGE_DELIVERY=redirect`). Bucket egress is free on Railway, while service egress is $0.05/GB, so image bytes never pass through your service.

Direct links stay permanent (`https://yoursite.com/i/{id}/photo.jpg`); only the redirect target changes.

## 1. Push the code to GitHub

Create a private repository and push this folder to it.

## 2. Create the project and the databases

1. In Railway, choose **New Project → Deploy from GitHub repo** and pick the repository. Railway detects the `Dockerfile`. Rename this service to `web`.
2. In the project canvas, choose **+ New → Database → PostgreSQL**. Leave its name as `Postgres`.
3. Choose **+ New → Database → Redis**. Leave its name as `Redis`.
4. Choose **+ New → Bucket**. Name it `Bucket`. Pick the region closest to your users; it can't be changed later.

If you use different names, change the names inside `${{...}}` below to match.

## 3. Set the web service's variables

Open **web → Variables → Raw Editor** and paste this, then set your own `ADMIN_EMAILS` and `ABUSE_EMAIL`:

```
SITE_NAME=imghost
SITE_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
ABUSE_EMAIL=abuse@yoursite.com
ADMIN_EMAILS=you@yoursite.com
ALLOW_SIGNUP=true
REQUIRE_LOGIN_TO_UPLOAD=true

DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}

S3_ENDPOINT=${{Bucket.ENDPOINT}}
S3_PUBLIC_ENDPOINT=${{Bucket.ENDPOINT}}
S3_BUCKET=${{Bucket.BUCKET}}
S3_ACCESS_KEY_ID=${{Bucket.ACCESS_KEY_ID}}
S3_SECRET_ACCESS_KEY=${{Bucket.SECRET_ACCESS_KEY}}
S3_REGION=${{Bucket.REGION}}
S3_FORCE_PATH_STYLE=false

UPLOAD_MODE=server
IMAGE_DELIVERY=redirect
CLIENT_IP_HEADER=x-real-ip

MAX_UPLOAD_MB=32
USER_UPLOADS_PER_HOUR=200
REPORTS_PER_HOUR=10
```

Notes:
- `S3_FORCE_PATH_STYLE=false` matches Railway's default virtual-hosted URLs. If your bucket's **Credentials** tab says to use path-style URLs, set it to `true`.
- `CLIENT_IP_HEADER=x-real-ip` makes rate limits use the client address that Railway's edge sets, rather than `X-Forwarded-For`, which callers can supply themselves.

## 4. Configure the web service

In **web → Settings**:

| Setting | Value |
| --- | --- |
| Networking → Public Networking | **Generate Domain** (or add your custom domain) |
| Deploy → Pre-deploy command | `node dist/migrate.js` |
| Deploy → Healthcheck path | `/api/health` |
| Deploy → Serverless (app sleeping) | Off |

The pre-deploy command applies `db/schema.sql` before each release; it's safe to run repeatedly.

Don't add a `railway.json`: Railway's config-as-code files are deprecated and stop being read on 1 December 2026, so set these in the dashboard.

## 5. Add the worker service

1. Choose **+ New → GitHub Repo** and pick the same repository. Rename the service to `worker`.
2. In **worker → Settings → Deploy**, set **Custom Start Command** to `node dist/worker.js`, and keep Serverless off.
3. Don't generate a domain; the worker has no web traffic.
4. In **worker → Variables → Raw Editor**, paste:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
S3_ENDPOINT=${{Bucket.ENDPOINT}}
S3_PUBLIC_ENDPOINT=${{Bucket.ENDPOINT}}
S3_BUCKET=${{Bucket.BUCKET}}
S3_ACCESS_KEY_ID=${{Bucket.ACCESS_KEY_ID}}
S3_SECRET_ACCESS_KEY=${{Bucket.SECRET_ACCESS_KEY}}
S3_REGION=${{Bucket.REGION}}
S3_FORCE_PATH_STYLE=false
WORKER_CONCURRENCY=2
```

Add `MODERATION_WEBHOOK_URL` here too if you use NSFW scoring (it runs in the worker).

## 6. Deploy and check

Deploy both services (Railway prompts you to deploy the staged changes). Then:

1. Open `https://<your-domain>/api/health`; it should return `{"ok":true}`.
2. Create an account, upload an image on the home page, and open its direct link.
3. Watch **worker → Deployments → Logs** for lines like `[process] aB3xK9pQ → active`.

## 7. Create your admin account

Open the site and choose **Create account** with the email you put in `ADMIN_EMAILS`. That account gets the **Moderation** link in its menu. Everyone else creates API keys themselves under **API keys** in their account.

To issue a key from the command line instead, install the [Railway CLI](https://docs.railway.com/cli), run `railway login` and `railway link` in this folder, then:

```bash
railway ssh --service web -- node dist/create-api-key.js you@example.com "n8n automations" 500
```

## Custom domain

In **web → Settings → Networking**, add your domain and create the CNAME record Railway shows. Then change `SITE_URL` to `https://yoursite.com` and redeploy. Existing links keep working on the Railway domain as long as it stays attached.

## Optional: direct browser uploads

Uploading straight to the bucket saves the app from handling 32 MB request bodies. To try it, run:

```bash
railway ssh --service web -- node dist/setup-bucket.js
```

If it prints `CORS set`, change `UPLOAD_MODE` to `direct` on the web service and redeploy, then test an upload in the browser. If uploads fail with a CORS error, switch back to `server`.

## Costs to expect

| Item | Rate |
| --- | --- |
| Bucket storage | $0.015 per GB-month |
| Bucket egress (image downloads via redirects) | Free |
| Bucket API operations | Free |
| Service egress (pages, API responses, redirects) | $0.05 per GB |
| Compute for web, worker, Postgres, Redis | Per Railway's usage pricing |

Image processing with sharp is memory-hungry on large images; give the worker at least 1 GB of memory.

## Differences from the Docker Compose setup

- Railway has no bucket lifecycle rules, so the worker's cleanup job (every 10 minutes) removes abandoned uploads and expired images itself.
- There's no Caddy or separate image hostname; images are served from `SITE_URL/i/...`.
- Cloudflare in front of a redirect only caches the redirect, not the image. That's fine here, since bucket egress is free.

Sources: [Railway Storage Buckets](https://docs.railway.com/storage-buckets), [Uploading and serving files](https://docs.railway.com/guides/storage-buckets-guide), [Understanding your bill](https://docs.railway.com/pricing/understanding-your-bill), [Config as Code deprecation](https://docs.railway.com/config-as-code/reference), [railway ssh](https://docs.railway.com/cli/ssh).
