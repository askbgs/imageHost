import { config } from "@/lib/config";

export const metadata = { title: "Report abuse" };

export default function Abuse() {
  return (
    <div className="prose">
      <h1>Report abuse</h1>
      <p>
        The fastest way to report an image is the <strong>Report this image</strong> button on its page. A moderator
        reviews every report.
      </p>
      <p>
        For copyright notices, legal requests, or many images at once, email{" "}
        <a href={`mailto:${config.abuseEmail}`}>{config.abuseEmail}</a> with the image links and the reason.
      </p>
      <p>
        If an image shows a child being abused, report it to us and also to your national hotline or to the{" "}
        <a href="https://www.inhope.org/EN" target="_blank" rel="noreferrer">
          INHOPE network
        </a>
        . Do not download or share it.
      </p>
    </div>
  );
}
