import { config } from "@/lib/config";

export const metadata = { title: "Terms of service" };

// Starting template only. Have a lawyer review it for your jurisdiction before launch.
export default function Terms() {
  return (
    <div className="prose">
      <h1>Terms of service</h1>
      <p>By uploading to {config.siteName} you agree to these terms.</p>

      <h2>What you may upload</h2>
      <p>
        Upload only images you own or have permission to share. Do not upload images that are illegal, that sexualise
        minors in any way, that show non-consensual intimate content, that promote violence or terrorism, that harass
        someone, or that infringe copyright.
      </p>

      <h2>What we do with uploads</h2>
      <p>
        Images are public to anyone who has the link. We remove location and camera data from every upload. We scan
        uploads to detect prohibited content and may remove any image, or block any uploader, without notice. Where
        the law requires it, we report illegal content to the authorities.
      </p>

      <h2>Deleting images</h2>
      <p>
        You can delete your images at any time from My images. Each upload also comes with a delete link. Images
        with an expiry are deleted automatically when it passes.
      </p>

      <h2>No warranty</h2>
      <p>
        The service is provided as is. Keep your own copies of anything important; we do not guarantee that images
        stay available.
      </p>

      <h2>Contact</h2>
      <p>
        Report abuse or send legal notices to <a href={`mailto:${config.abuseEmail}`}>{config.abuseEmail}</a>.
      </p>
    </div>
  );
}
