import { config } from "@/lib/config";

export const metadata = { title: "Privacy" };

// Starting template only. Have it reviewed for your jurisdiction before launch.
export default function Privacy() {
  return (
    <div className="prose">
      <h1>Privacy</h1>
      <p>This page explains what {config.siteName} stores about you and how to delete it.</p>

      <h2>What we store</h2>
      <ul>
        <li>Your email address, the name you give, and a hash of your password if you set one.</li>
        <li>
          If you sign in with GitHub, Google or Facebook: that account&apos;s ID, email address and name, used only to
          sign you in. We don&apos;t post anything or read your contacts.
        </li>
        <li>The images you upload, with location and camera data removed, and their upload time and size.</li>
        <li>Your API keys, stored as hashes, and the devices you&apos;re signed in on.</li>
        <li>The network address an upload or report came from, kept to fight abuse.</li>
      </ul>

      <h2>Who can see it</h2>
      <p>
        Images are public to anyone with the link. Your email, name and account details are not shown to other people.
        We don&apos;t sell your data or use it for advertising.
      </p>

      <h2>Payments</h2>
      <p>
        If you buy a paid plan, the payment is handled by Paddle.com, our reseller and Merchant of Record. Paddle
        collects your payment details, billing address and tax information under its own privacy policy, and we never
        see your card details. We keep the subscription details Paddle sends us: your plan, its status and renewal
        date, and your Paddle customer ID.
      </p>

      <h2>Deleting your data</h2>
      <p>
        Delete single images from My images. To delete everything, open{" "}
        <a href="/account/settings#delete">Settings → Delete account</a>. This removes your account, all your images
        and their links, your API keys and any connected GitHub, Google or Facebook sign-in at once. Copies cached by
        browsers or the CDN expire shortly after.
      </p>
      <p>
        You can also remove {config.siteName} from your GitHub, Google or Facebook account settings at any time, or
        email <a href={`mailto:${config.abuseEmail}`}>{config.abuseEmail}</a> to ask us to delete your data.
      </p>
    </div>
  );
}
