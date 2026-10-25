# Contact form and email addresses

PinPicX uses two addresses:

| Address | Used for | Setting |
|---|---|---|
| `info@pinpicx.app` | The contact form at **/contact** sends here. Shown for billing, refunds and sales questions. | `CONTACT_EMAIL` |
| `abuse@pinpicx.app` | Abuse reports, copyright and legal notices. Shown on **/abuse**, the terms and the privacy page. | `ABUSE_EMAIL` |

These are the defaults. If Railway still has `ABUSE_EMAIL` or `CONTACT_EMAIL` set to an old value such as
`abuse@example.com`, change or delete it there.

Every contact message is saved and listed under **Moderation → Messages**, even before email is set up, so nothing
is lost.

## 1. Receive mail at info@ and abuse@

The addresses need a mailbox behind them. If `pinpicx.app` is on Cloudflare, **Email Routing** is free and forwards
both to the inbox you already use:

1. Cloudflare dashboard → `pinpicx.app` → **Email → Email Routing → Get started**, and let it add its DNS records.
2. Add a destination address (for example your Gmail) and confirm it from the email Cloudflare sends.
3. Create routing rules: `info@pinpicx.app` → your inbox, and `abuse@pinpicx.app` → your inbox.

## 2. Send the contact form's emails (Resend)

Railway blocks outgoing SMTP on its Free, Trial and Hobby plans, so PinPicX sends through Resend's HTTPS API, which
works on every plan. Its free tier is plenty for a contact form.

1. Create an account at <https://resend.com>.
2. **Domains → Add domain** → `pinpicx.app`. Add the DNS records Resend shows (SPF and DKIM) in Cloudflare, and wait
   until the domain shows **Verified**. Email Routing and Resend can be used on the same domain.
3. **API Keys → Create API key**, with **Sending access** for `pinpicx.app`.
4. In Railway, on the **web** service, add:

   ```env
   RESEND_API_KEY=re_...
   MAIL_FROM=PinPicX <noreply@pinpicx.app>
   ```

5. Redeploy, send yourself a message from **/contact**, and check it arrives at `info@pinpicx.app`.

Each email comes **from** `noreply@pinpicx.app`, with **Reply-To** set to the person who wrote, so pressing Reply in
your inbox answers them directly.

## Spam protection

- A hidden field that people never see but bots fill in, and a minimum time to fill in the form. Bots that trip
  either get a normal "thanks" and nothing is saved or sent.
- At most 5 messages an hour from one IP address.
- Length limits on every field, and no confirmation email is sent to the address typed in, so the form can't be
  used to send mail to other people.

## If a message wasn't emailed

**Moderation → Messages** shows *"Not emailed"* with the reason, for example a missing key or an unverified domain.
Reply from there with the email link, then fix the setting.
