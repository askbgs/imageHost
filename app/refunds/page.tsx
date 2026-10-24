import Link from "next/link";
import { config } from "@/lib/config";

export const metadata = { title: "Refund policy" };

// Starting template only. Make sure it matches what you're willing to offer, and keep REFUND_DAYS in line with it.
export default function Refunds() {
  const days = config.refundDays;
  return (
    <div className="prose">
      <h1>Refund policy</h1>
      <p>
        Payments for {config.siteName} are processed by Paddle.com, our reseller and Merchant of Record, so refunds are
        issued by Paddle back to the payment method you used.
      </p>

      <h2>Full refund within {days} days</h2>
      <p>
        If {config.siteName} isn&apos;t right for you, ask for a refund within {days} days of any payment, a first
        subscription or a renewal, and you&apos;ll get the whole payment back. Your account then moves to the Free plan;
        your images stay.
      </p>

      <h2>How to ask</h2>
      <p>
        Email <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a> from your account&apos;s address, or
        reply to the receipt Paddle sent you. You can also contact Paddle directly through{" "}
        <a href="https://paddle.net" target="_blank" rel="noopener">
          paddle.net
        </a>
        . Refunds usually reach you within 5 to 10 business days, depending on your bank.
      </p>

      <h2>Cancelling</h2>
      <p>
        You can cancel at any time in <Link href="/account/billing">Account → Billing</Link>. You won&apos;t be charged
        again and you keep your plan until the end of the period you&apos;ve paid for. Cancelling on its own
        doesn&apos;t refund the current period; ask for a refund as described above if you&apos;re within {days} days.
      </p>

      <h2>When we may refuse</h2>
      <p>
        We may refuse a refund for accounts closed for breaking our <Link href="/terms">terms</Link>, or where refunds
        are clearly being abused. This doesn&apos;t affect your rights under consumer law.
      </p>
    </div>
  );
}
