import { config } from "@/lib/config";

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
      <pre>{`POST ${base}/1/upload

key         required  your API key (or ?key=, X-API-Key header, or Bearer token)
image       required  a file, a base64 string, or an http(s) URL
name        optional  file name
expiration  optional  delete after N seconds (60 to 15552000)`}</pre>

      <pre>{`curl -X POST "${base}/1/upload?key=YOUR_KEY" \\
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
        <code>GET /1/images/&#123;id&#125;</code> until it returns 200.
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
            <td><code>GET /1/images</code></td>
            <td>Your uploads, newest first. Query: <code>page</code>, <code>per_page</code> (max 100).</td>
          </tr>
          <tr>
            <td><code>GET /1/images/&#123;id&#125;</code></td>
            <td>One image&apos;s links and details.</td>
          </tr>
          <tr>
            <td><code>DELETE /1/images/&#123;id&#125;</code></td>
            <td>Delete with your key, or with <code>?delete_token=…</code> for a guest upload.</td>
          </tr>
          <tr>
            <td><code>POST /1/reports</code></td>
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
          <tr><td>429</td><td><code>rate_limited</code></td><td>Your key is over its hourly limit; see the <code>Retry-After</code> header.</td></tr>
          <tr><td>502</td><td><code>url_fetch_failed</code></td><td>The image URL could not be downloaded.</td></tr>
        </tbody>
      </table>

      <h2>Get a key</h2>
      <p>
        <a href="/signup">Create an account</a>, then open <a href="/account/keys">API keys</a> and create a key for each app.
        Each key can upload {config.limits.userUploadsPerHour} images per hour. Images uploaded with your key appear in My images.
      </p>
    </div>
  );
}
