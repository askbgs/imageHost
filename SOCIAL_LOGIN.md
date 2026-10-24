# Sign in with GitHub, Google and Facebook

Each provider shows up on the sign-in and sign-up pages as soon as its client ID and secret are set. Set up any combination. Add the variables to the **web** service only; the worker doesn't need them.

Every provider needs a callback (redirect) URL. Use your real `SITE_URL`, exactly:

| Provider | Callback URL |
| --- | --- |
| GitHub | `https://yoursite.com/auth/github/callback` |
| Google | `https://yoursite.com/auth/google/callback` |
| Facebook | `https://yoursite.com/auth/facebook/callback` |

On Railway before you add a custom domain, use the Railway domain, for example `https://imghost-production.up.railway.app/auth/github/callback`. When you switch domains, update the URL at each provider as well as `SITE_URL`.

## GitHub

1. On GitHub, open **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Fill in **Application name**, **Homepage URL** (`https://yoursite.com`) and **Authorization callback URL** (from the table).
3. Choose **Register application**, then **Generate a new client secret**.
4. Set:

```
GITHUB_CLIENT_ID=<Client ID>
GITHUB_CLIENT_SECRET=<client secret>
```

The app asks for read-only access to the profile and email addresses. It uses the account's verified primary email.

## Google

1. In the [Google Cloud console](https://console.cloud.google.com/), create or pick a project and open **Google Auth Platform**.
2. If asked, register the app: app name, support email, and **Audience: External**. Under **Branding**, add your domain to **Authorized domains** and link your `/privacy` and `/terms` pages.
3. Open **Clients → Create client**, choose **Web application**, and add the callback URL under **Authorized redirect URIs**.
4. Copy the client secret straight away; it's only shown once.
5. Under **Audience**, choose **Publish app** so anyone with a Google account can sign in, not only test users. The app asks only for name and email, so Google doesn't need to review it.
6. Set:

```
GOOGLE_CLIENT_ID=<Client ID>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<client secret>
```

Redirect URI changes at Google can take a few minutes to apply. A `redirect_uri_mismatch` error means the URL doesn't match exactly.

## Facebook

1. On [Meta for Developers](https://developers.facebook.com/), choose **My Apps → Create App**, and pick the use case **Authenticate and request data from users with Facebook Login**.
2. In the use case's **Customize** settings, make sure the `email` permission is added. Under **Settings**, put the callback URL in **Valid OAuth Redirect URIs** and save.
3. Under **App settings → Basic**, copy the **App ID** and **App Secret**, and fill in:
   - **Privacy Policy URL:** `https://yoursite.com/privacy`
   - **Terms of Service URL:** `https://yoursite.com/terms`
   - **User data deletion:** choose the instructions URL and enter `https://yoursite.com/privacy` (it explains how to delete an account, which people can do themselves in Settings)
   - An app icon and category
4. **Publish** the app (switch it to Live). Until then only people with a role on the app can sign in.
5. Set:

```
FACEBOOK_CLIENT_ID=<App ID>
FACEBOOK_CLIENT_SECRET=<App Secret>
```

The Graph API version defaults to `v26.0`; set `FACEBOOK_GRAPH_VERSION` to change it.

## How accounts are matched

- **First sign-in** with a provider creates an account using that provider's email and name.
- **Same email as an existing account:** GitHub (verified primary email) and Google (verified email) sign people into the existing account and connect the provider to it. Facebook doesn't say whether an email is confirmed, so it never joins an existing account. The person gets a message to sign in with their password and connect Facebook under **Settings**.
- **No email from the provider** (for example a Facebook account registered with a phone number): sign-in stops with a message asking them to use email and password instead.
- **Admins:** an email in `ADMIN_EMAILS` gets admin rights through GitHub or Google only, because only they confirm the email.
- **Settings → Sign-in methods** lets people connect and disconnect providers. The last remaining way to sign in can't be disconnected; people who signed up with a provider can set a password there.

## Security

- The flow uses `state` against cross-site request forgery and PKCE (S256) on the code exchange, with the client secret.
- The state and PKCE verifier live in an httpOnly cookie for 10 minutes, scoped to `/auth`.
- Callback errors show fixed messages chosen by an error code, so a crafted link can't put arbitrary text on the sign-in page.
- Provider access tokens are used once to read the profile and are not stored.

## Buttons

The buttons use plain lettermarks. If you'd like each provider's official button artwork, download it from their brand resources and follow their guidelines (Google's in particular sets rules for its sign-in button).
