import Link from "next/link";
import { IconCode, IconLink, IconShield, IconUpload } from "@/components/Icons";
import { StorageNotice } from "@/components/StorageMeter";
import { Uploader } from "@/components/Uploader";
import { currentUser, displayName } from "@/lib/auth";
import { config } from "@/lib/config";
import { query } from "@/lib/db";
import { storageUsage } from "@/lib/quota";

function Features() {
  const mb = config.maxUploadBytes / 1024 / 1024;
  return (
    <section className="features" aria-label="What you get">
      <div className="feature">
        <span className="ico">
          <IconLink size={22} />
        </span>
        <h3>Links for anywhere</h3>
        <p>
          Every upload comes with a direct link, a viewer page, and HTML, BBCode
          and Markdown embeds.
        </p>
      </div>
      <div className="feature">
        <span className="ico">
          <IconCode size={22} />
        </span>
        <h3>Upload from your apps</h3>
        <p>
          Create API keys in your account and upload from scripts, ShareX,
          WordPress or n8n.
        </p>
      </div>
      <div className="feature">
        <span className="ico">
          <IconShield size={22} />
        </span>
        <h3>Private by default</h3>
        <p>
          Location and camera data are removed from every image. Files up to{" "}
          {mb} MB, kept until you delete them.
        </p>
      </div>
    </section>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string; album?: string }>;
}) {
  const { deleted, album } = await searchParams;
  const user = await currentUser();
  const canUpload = !!user || !config.requireLoginToUpload;

  if (!canUpload) {
    return (
      <>
        {deleted && (
          <p className="alert ok" role="status" style={{ marginTop: 24 }}>
            Your account and images were deleted.
          </p>
        )}
        <section className="hero">
          <h1>
            Drop an image.
            <br />
            Get a link.
          </h1>
          <p className="lede">
            Host images for forums, sites and chats. Direct links, thumbnails
            and embed codes, ready to paste.
          </p>
        </section>
        <section className="frame" aria-label="Sign in to upload">
          <span className="marks" aria-hidden="true" />
          <span className="drop-icon" aria-hidden="true">
            <IconUpload size={26} />
          </span>
          <p className="hint">Sign in to start uploading</p>
          <p className="sub">
            An account keeps your images in one place and gives you API keys.
          </p>
          <div className="controls">
            {config.allowSignup && (
              <Link href="/signup" className="btn primary">
                Create a free account
              </Link>
            )}
            <Link href="/login" className="btn secondary">
              Sign in
            </Link>
          </div>
          <p className="sub">
            Free forever for personal use.{" "}
            <Link href="/pricing">See plans</Link>
          </p>
        </section>
        <Features />
      </>
    );
  }

  const [usage, albums, paused] = user
    ? await Promise.all([
        storageUsage(user.id).catch(() => null),
        query<{ id: string; title: string }>(
          `SELECT id, title FROM albums WHERE user_id = $1 ORDER BY updated_at DESC`,
          [user.id],
        ),
        query<{ p: boolean }>(
          `SELECT uploads_paused_at IS NOT NULL AS p FROM users WHERE id = $1`,
          [user.id],
        ).then((r) => r[0]?.p ?? false),
      ])
    : [null, [], false];

  return (
    <>
      <section className="hero compact">
        <h1>
          {user
            ? `Upload images, ${displayName(user)}`
            : "Drop an image. Get a link."}
        </h1>
        <p className="lede">
          {user ? (
            <>
              Everything you upload is saved in{" "}
              <Link href="/account">My images</Link>.
            </>
          ) : (
            "Direct links, HTML and BBCode thumbnails, and Markdown, ready to paste."
          )}
        </p>
      </section>
      {paused && (
        <div className="alert error storage-notice" role="alert">
          <strong>Uploads from your account are paused</strong> while we review
          images that our automatic safety check blocked. Your existing images
          and links keep working. If you think this is a mistake, email{" "}
          <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>.
        </div>
      )}
      {usage && <StorageNotice usage={usage} />}
      <Uploader
        maxBytes={config.maxUploadBytes}
        mode={config.uploadMode}
        albums={user ? albums : undefined}
        initialAlbum={album}
      />
      {!user && <Features />}
    </>
  );
}
