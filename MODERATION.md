# Automatic screening of uploads

Every image uploaded to PinPicX, from the website or the API, is checked while it's processed. Nothing goes live,
and nothing is stored, until the checks are done.

| Check | Catches | What happens |
|---|---|---|
| Exact file | The same file as one an admin removed with **Remove and block file** | Blocked |
| Look-alike | A resized, re-saved or slightly edited copy of a blocked image | Blocked |
| Content | Adult images | Marked sensitive (default), or blocked with `MODERATION_ADULT=block` |
| | Graphic violence | Marked sensitive (default), or blocked with `MODERATION_GORE=block` |
| | Self-harm | Marked sensitive |
| | File names with hate, threats or harassment | Marked sensitive |
| Repeat uploads | An account with 3 blocked uploads in 24 hours | Its uploads are paused until an admin resumes them. Guests: their IP is paused for a day. |

**Marked sensitive** means the image goes live but is blurred until opened, hidden from search engines and link
previews, and listed under **Moderation → Flagged** for you to review (**Mark safe** or **Remove**).

**Blocked** means the uploader sees *"This image was blocked by our automatic safety check because it appears to
break our content rules"*, the API returns `blocked_content` (422), and the file is never stored.
**Moderation → Blocked uploads** lists who tried, when and why.

## Turn it on

Content screening uses OpenAI's moderation endpoint, which is free to use.

1. Create an API key at <https://platform.openai.com/api-keys>. A project key with access to the **Moderations**
   endpoint is enough.
2. In Railway, on the **web** service (and the **worker**, if you run one), add:

   ```env
   OPENAI_API_KEY=sk-...
   ```

3. Redeploy. **Moderation** in PinPicX now shows *"Automatic screening is on"*.

The exact-file, look-alike and repeat-upload checks work without a key.

### Settings

| Variable | Default | Meaning |
|---|---|---|
| `MODERATION_ADULT` | `flag` | Adult images: `flag` (mark sensitive), `block` or `allow` |
| `MODERATION_GORE` | `flag` | Graphic violence: `flag`, `block` or `allow` |
| `MODERATION_THRESHOLD` | `0.8` | How sure the classifier must be (0–1). Lower catches more, with more false alarms |
| `MODERATION_ON_ERROR` | `allow` | If the screening service can't be reached: `allow` (go live) or `flag` (hold as sensitive for review) |
| `MODERATION_PAUSE_AFTER` | `3` | Blocked uploads in 24 hours before uploads are paused. `0` turns pausing off |
| `MODERATION_LOOKALIKE_BITS` | `6` | How different (bits out of 64) an image can be from a blocked one and still count as a copy |
| `MODERATION_PROVIDER` | automatic | `openai`, `webhook` or `off` |

If your terms don't allow adult content at all, set `MODERATION_ADULT=block`.

### Using your own classifier instead

Set `MODERATION_WEBHOOK_URL` (and leave `OPENAI_API_KEY` unset, or set `MODERATION_PROVIDER=webhook`). PinPicX POSTs
a JPEG of each image, with the file name in an `X-File-Name` header, and expects:

```json
{ "adult": 0.0, "graphic_violence": 0.0, "self_harm": 0.0, "block": false }
```

The older answer `{ "nsfw": 0.93 }` still works and counts as `adult`.

## Child sexual abuse material: also turn on Cloudflare's CSAM Scanning Tool

Content classifiers, OpenAI's included, are **not** a reliable way to detect child sexual abuse material (CSAM).
That's done by matching images against hash lists of known material kept by child-safety organisations such as
NCMEC. Cloudflare runs this for sites that serve content through its cache, and your images on R2 do.

1. In the Cloudflare dashboard, open the zone that serves your images (your R2 custom domain, or your site's domain
   if images go through the app).
2. Go to **Caching → Configuration → CSAM Scanning Tool → Configure**.
3. Enter an email address you read. Cloudflare blocks matched URLs and emails you a daily summary with their paths.

When you get a notification: remove the image in PinPicX with **Remove and block file**, suspend the account, and
follow the reporting obligations that apply to you (in the US, reporting to NCMEC; Cloudflare's notice explains the
process). Don't download or forward the material.

## What screening can't do

- Classifiers make mistakes both ways. Keep an eye on **Flagged**, and use **Mark safe** for false alarms.
- Screening looks at the image and its name. It can't judge context: a news photo and a glorifying post look the
  same to it. User reports (**Report** on every image) remain the backstop.
- Images uploaded before you turned screening on aren't rescanned.

Sources: [OpenAI moderation guide](https://developers.openai.com/api/docs/guides/moderation),
[Cloudflare CSAM Scanning Tool](https://developers.cloudflare.com/cache/reference/csam-scanning/).
