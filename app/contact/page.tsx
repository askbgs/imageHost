import { ContactForm } from "@/components/ContactForm";
import { currentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { isTopic } from "@/lib/contact";

export const metadata = {
  title: "Contact",
  description:
    "Questions about PinPicX, your account, plans or the API? Send us a message.",
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const [user, { topic }] = await Promise.all([currentUser(), searchParams]);
  return (
    <div className="contact">
      <div className="page-head" style={{ paddingBottom: 12 }}>
        <div>
          <h1>Contact us</h1>
          <p>
            Questions about your account, plans, the API or anything else. We
            read every message.
          </p>
        </div>
      </div>
      <ContactForm
        name={user?.display_name ?? undefined}
        email={user?.email}
        topic={isTopic(topic) ? topic : "general"}
        contactEmail={config.contactEmail}
        abuseEmail={config.abuseEmail}
      />
    </div>
  );
}
