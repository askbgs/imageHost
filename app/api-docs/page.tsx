import { config } from "@/lib/config";
import { PLANS, PLAN_IDS } from "@/lib/plans";

export const metadata = { title: "API" };

export default function ApiDocs() {
  const base = config.siteUrl;
  return (
    <div className="prose">
      <h1>Upload API</h1>
      <p>
        <a href="/account/keys">Get an API key</a> from your account, then send images from any app.
      </p>
      <p>
        One endpoint uploads an image from a file, a base64 string or a public URL, and returns its links and embed
        codes as JSON. It works with ShareX custom uploaders, n8n HTTP Request nodes, and any tool that can send a
        form upload.
      </p>

      <h2>Upload an image</h2>
      <pre>{`POST ${base}/v1/upload

key         required  your API key (or ?key=, X-API-Key header, or Bearer token)
image       required  a file, a base64 string, or an http(s) URL
name        optional  file name
expiration  optional  delete after N seconds (60 to 15552000)
album       optional  ID of one of your albums to put the image in
                      (the last part of the album link, /a/AbC12345)`}</pre>

      <pre>{`curl -X POST "${base}/v1/upload?key=YOUR_KEY" \\
  -F "image=@photo.jpg" \\
  -F "expiration=86400"`}</pre>

      <p>A successful upload returns HTTP 200:</p>
      <pre>{`{
  "data": {
    "id": "aB3xK9pQ",
    "title": "photo",
    "url_viewer": "${base}/aB3xK9pQ",
    "url": "${config.imageBaseUrl}/aB3xK9pQ/photo.jpg",
    "display_url": "${config.imageBaseUrl}/aB3xK9pQ/m/photo.jpg",
    "width": 1920, "height": 1080, "size": 482113,
    "time": 1761235200, "expiration": 86400,
    "image":  { "filename": "photo.jpg", "mime": "image/jpeg", "url": "…" },
    "thumb":  { "filename": "photo.jpg", "mime": "image/jpeg", "url": "…/t/photo.jpg" },
    "medium": { "filename": "photo.jpg", "mime": "image/jpeg", "url": "…/m/photo.jpg" },
    "delete_url": "${base}/aB3xK9pQ/delete/…",
    "embed": { "html": "…", "html_full": "…", "bbcode": "…", "bbcode_full": "…", "markdown": "…" }
  },
  "success": true,
  "status": 200
}`}</pre>
      <p>
        If processing takes longer than a minute the response is HTTP 202 with the image&apos;s id; poll{" "}
        <code>GET /v1/images/&#123;id&#125;</code> until it returns 200.
      </p>

      <h2>Other endpoints</h2>
      <table>
        <thead>
          <tr>
            <th>Method and path</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>GET /v1/images</code></td>
            <td>Your uploads, newest first. Query: <code>page</code>, <code>per_page</code> (max 100).</td>
          </tr>
          <tr>
            <td><code>GET /v1/images/&#123;id&#125;</code></td>
            <td>One image&apos;s links and details.</td>
          </tr>
          <tr>
            <td><code>DELETE /v1/images/&#123;id&#125;</code></td>
            <td>Delete with your key, or with <code>?delete_token=…</code> for a guest upload.</td>
          </tr>
          <tr>
            <td><code>POST /v1/reports</code></td>
            <td>Report an image. Body: <code>image_id</code>, <code>reason</code> (illegal, nsfw, copyright, spam, other), <code>details</code>.</td>
          </tr>
        </tbody>
      </table>

      <h2>Errors</h2>
      <p>
        Errors return <code>{`{ "success": false, "status": 413, "error": { "code": "file_too_large", "message": "…" } }`}</code>.
      </p>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Code</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>400</td><td><code>invalid_image</code></td><td>The file could not be read as an image.</td></tr>
          <tr><td>400</td><td><code>invalid_expiration</code></td><td>Expiration is outside 60 to 15552000 seconds.</td></tr>
          <tr><td>401</td><td><code>invalid_key</code></td><td>The API key is missing, unknown or revoked.</td></tr>
          <tr><td>413</td><td><code>file_too_large</code></td><td>The image is over {config.maxUploadBytes / 1024 / 1024} MB.</td></tr>
          <tr><td>415</td><td><code>unsupported_type</code></td><td>Not JPG, PNG, GIF, WebP, AVIF, BMP or TIFF. SVG and HEIC are not accepted.</td></tr>
          <tr><td>422</td><td><code>blocked_content</code></td><td>This file was removed before and cannot be uploaded again.</td></tr>
          <tr><td>404</td><td><code>not_found</code></td><td>The <code>album</code> doesn&apos;t exist or isn&apos;t yours.</td></tr>
          <tr><td>403</td><td><code>storage_full</code></td><td>Your account has used its plan&apos;s storage. Delete images or upgrade, then try again.</td></tr>
          <tr><td>429</td><td><code>rate_limited</code></td><td>Your account is over its plan&apos;s hourly upload limit; see the <code>Retry-After</code> header.</td></tr>
          <tr><td>502</td><td><code>url_fetch_failed</code></td><td>The image URL could not be downloaded.</td></tr>
        </tbody>
      </table>

      <h2>Limits</h2>
      <p>Upload limits count across all of an account&apos;s keys and reset on a rolling one-hour window.</p>
      <table>
        <thead>
          <tr>
            <th>Plan</th>
            <th>API keys</th>
            <th>API uploads per hour</th>
          </tr>
        </thead>
        <tbody>
          {PLAN_IDS.map((p) => (
            <tr key={p}>
              <td>{PLANS[p].label}</td>
              <td>{PLANS[p].maxApiKeys}</td>
              <td>{PLANS[p].apiUploadsPerHour.toLocaleString("en")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Versions</h2>
      <p>
        Every API path starts with its version: <code>/v1/</code> is the current one. Changes that could break your
        code, such as renamed fields or a different response format, only ever come in a new version (<code>/v2/</code>),
        and <code>/v1/</code> keeps working when it arrives. New optional fields may be added to <code>/v1/</code> at any
        time, so ignore fields you don&apos;t use.
      </p>
      <p>
        Integrations set up with the earlier <code>/1/</code> paths (for example <code>/1/upload</code>) still work: they
        are the same as <code>/v1/</code>.
      </p>

      <h2>Get a key</h2>
      <p>
        <a href="/signup">Create an account</a>, then open <a href="/account/keys">API keys</a> and create a key for each app.
        Images uploaded with your key appear in My images.
      </p>
    </div>
  );
}
