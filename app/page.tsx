import { Uploader } from "@/components/Uploader";
import { config } from "@/lib/config";

export default function Home() {
  return (
    <>
      <section className="hero">
        <h1>
          Drop an image.
          <br />
          Get a link.
        </h1>
        <p className="lede">
          Direct links, HTML and BBCode thumbnails, and Markdown, ready to paste into forums, sites and chats. No
          account needed.
        </p>
      </section>
      <Uploader maxBytes={config.maxUploadBytes} mode={config.uploadMode} />
    </>
  );
}
