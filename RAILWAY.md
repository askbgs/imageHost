# Deploy on Railway

You'll create four things in one Railway project: a **web** service and a **worker** service (both from this repo), plus **Postgres** and **Redis**. Images are stored in **Cloudflare R2**, so set up the bucket first by following [R2.md](R2.md) steps 1 to 4.

Railway builds both services from the `Dockerfile`; they differ only in their start command. Browsers upload straight to R2 and Cloudflare serves the images from your R2 domain, so image bytes never pass through Railway, where service egress costs $0.05/GB.

## 1. Push the code to GitHub

Create a private repository and push this folder to it.

## 2. Create the project and the databases

1. In Railway, choose **New Project → Deploy from GitHub repo** and pick the repository. Railway detects the `Dockerfile`. Rename this service to `web`.
2. In the project canvas, choose **+ New → Database → PostgreSQL**. Leave its name as `Postgres`.
3. Choose **+ New → Database → Redis**. Leave its name as `Redis`.
If you use different names, change the names inside `${{...}}` below to match.

## 3. Set the web service's variables

Open **web → Variables → Raw Editor** and paste this, then set your own `ADMIN_EMAILS` and `ABUSE_EMAIL`:

```
SITE_NAME=PinPicX
SITE_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
ABUSE_EMAIL=abuse@yoursite.com
ADMIN_EMAILS=you@yoursite.com
ALLOW_SIGNUP=true
REQUIRE_LOGIN_TO_UPLOAD=true

DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}

R2_ACCOUNT_ID=${{shared.R2_ACCOUNT_ID}}
R2_ACCESS_KEY_ID=${{shared.R2_ACCESS_KEY_ID}}
R2_SECRET_ACCESS_KEY=${{shared.R2_SECRET_ACCESS_KEY}}
R2_BUCKET=${{shared.R2_BUCKET}}
R2_PUBLIC_URL=${{shared.R2_PUBLIC_URL}}
CLOUDFLARE_ZONE_ID=${{shared.CLOUDFLARE_ZONE_ID}}
CLOUDFLARE_API_TOKEN=${{shared.CLOUDFLARE_API_TOKEN}}

UPLOAD_MODE=direct
CLIENT_IP_HEADER=x-real-ip

# Social sign-in (optional, see SOCIAL_LOGIN.md); leave out any you don't use
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
FACEBOOK_CLIENT_ID=
FACEBOOK_CLIENT_SECRET=

MAX_UPLOAD_MB=32
FREE_API_KEYS=1
FREE_API_UPLOADS_PER_HOUR=10
FREE_WEB_UPLOADS_PER_HOUR=50
REPORTS_PER_HOUR=10
```

First add the R2 values once as **shared variables** (Project → **Settings → Shared Variables**): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`, and, if you set up cache purging, `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN`. Both services then reference them, as above.

Notes:
- `CLIENT_IP_HEADER=x-real-ip` makes rate limits use the client address that Railway's edge sets, rather than `X-Forwarded-For`, which callers can supply themselves.

## 4. Configure the web service

In **web → Settings**:

| Setting | Value |
| --- | --- |
| Networking → Public Networking | **Generate Domain** (or add your custom domain) |
| Deploy → Healthcheck path | `/api/health` |
| Deploy → Serverless (app sleeping) | Off |

You don't need a pre-deploy command. The web app and the worker create and upgrade the database tables themselves when they start. If you added `node dist/migrate.js` as a pre-deploy command earlier, you can keep it; it's harmless.

Don't add a `railway.json`: Railway's config-as-code files are deprecated and stop being read on 1 December 2026, so set these in the dashboard.

## 5. Add the worker service

1. Choose **+ New → GitHub Repo** and pick the same repository. Rename the service to `worker`.
2. In **worker → Settings → Deploy**, set **Custom Start Command** to `node dist/worker.js`, and keep Serverless off.
3. Don't generate a domain; the worker has no web traffic.
4. In **worker → Variables → Raw Editor**, paste:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
R2_ACCOUNT_ID=${{shared.R2_ACCOUNT_ID}}
R2_ACCESS_KEY_ID=${{shared.R2_ACCESS_KEY_ID}}
R2_SECRET_ACCESS_KEY=${{shared.R2_SECRET_ACCESS_KEY}}
R2_BUCKET=${{shared.R2_BUCKET}}
R2_PUBLIC_URL=${{shared.R2_PUBLIC_URL}}
CLOUDFLARE_ZONE_ID=${{shared.CLOUDFLARE_ZONE_ID}}
CLOUDFLARE_API_TOKEN=${{shared.CLOUDFLARE_API_TOKEN}}
WORKER_CONCURRENCY=2
```

Add `MODERATION_WEBHOOK_URL` here too if you use NSFW scoring (it runs in the worker).

## 6. Deploy and check

Deploy both services (Railway prompts you to deploy the staged changes). Then:

1. Open `https://<your-domain>/api/health`. It should return `"ok": true` with `"schema": {"latest": 3, "applied": 3}`. If it says `tables missing or out of date`, check the web service's deploy logs for lines starting with `[migrate]`. The `browser_uploads` line should say `direct to storage`; if not, see [R2.md → Troubleshooting uploads](R2.md#troubleshooting-uploads).
2. Prepare the bucket (CORS for browser uploads, cleanup of raw uploads): `railway ssh --service web -- node dist/setup-bucket.js`. See [R2.md](R2.md) step 5 if it can't change the settings.
3. Create an account, upload an image on the home page, and open its direct link; it should start with your R2 domain.
4. Watch **worker → Deployments → Logs** for lines like `[process] aB3xK9pQ → active`.

## 7. Create your admin account

Open the site and choose **Create account** with the email you put in `ADMIN_EMAILS`. That account gets the **Moderation** link in its menu. Everyone else creates API keys themselves under **API keys** in their account.

To issue a key from the command line instead, install the [Railway CLI](https://docs.railway.com/cli), run `railway login` and `railway link` in this folder, then:

```bash
railway ssh --service web -- node dist/create-api-key.js you@example.com "n8n automations" 500
```

## If uploads stay on "Processing"

Images are processed (location data removed, thumbnails made) by the **worker** service. The app now processes them itself when no worker picks them up within a few seconds, so uploads finish either way. Open `/api/health` and check `image_workers`:

- **1 connected** (or more): the worker is running. Nothing to do.
- **none connected:** the web app is doing the processing. Either fix the worker, or run it inside the web service (below).

Common reasons the worker isn't running: the service was never created, its start command isn't `node dist/worker.js`, it's missing the `R2_*` variables (its deploy log then shows `Missing required environment variable`), or its `REDIS_URL` points at a different Redis than the web service's.

**Simpler setup: one service.** Set `RUN_WORKER=true` on the web service and delete the worker service. The web app then processes images in the background itself. This suits small and medium sites; split them again if uploads get heavy, so image processing doesn't slow page loads. Give the web service at least 1 GB of memory either way.

## If tables are missing

Earlier versions only created tables through the pre-deploy command, so a deploy without it left the database empty. This version creates them on startup. After redeploying, the deploy logs show:

```
[migrate] applied 1: initial schema
[migrate] applied 2: accounts and sessions
[migrate] applied 3: social sign-in
```

Existing data is kept: every step only adds what's missing. To run it by hand: `railway ssh --service web -- node dist/migrate.js`.

## Custom domain

In **web → Settings → Networking**, add your domain and create the CNAME record Railway shows. Then change `SITE_URL` to `https://yoursite.com`, update the callback URLs at GitHub, Google and Facebook (see [SOCIAL_LOGIN.md](SOCIAL_LOGIN.md)) and redeploy. Existing links keep working on the Railway domain as long as it stays attached.

## Moving from a Railway bucket

If you deployed an earlier version with a Railway bucket, copy its images into R2 with the migration in [R2.md](R2.md#moving-existing-images-to-r2), using the old bucket's **Credentials** tab as the `SOURCE_S3_*` values (`SOURCE_S3_FORCE_PATH_STYLE=false` unless the tab says path-style). Then remove the old `S3_*` variables and the bucket.

## Costs to expect

| Item | Rate |
| --- | --- |
| R2 storage | $0.015 per GB-month, first 10 GB free |
| Image downloads (R2 and Cloudflare CDN) | Free |
| Railway service egress (pages and API responses) | $0.05 per GB |
| Compute for web, worker, Postgres, Redis | Per Railway's usage pricing |

Image processing with sharp is memory-hungry on large images; give the worker at least 1 GB of memory.

## Differences from the Docker Compose setup

- There's no Caddy; Railway provides HTTPS for the site, and Cloudflare serves the images.
- Old site links (`https://yoursite.com/i/...`) forward to the R2 domain.

Sources: [Understanding your bill](https://docs.railway.com/pricing/understanding-your-bill), [Config as Code deprecation](https://docs.railway.com/config-as-code/reference), [railway ssh](https://docs.railway.com/cli/ssh).
