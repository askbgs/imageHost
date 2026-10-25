import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { IMAGE_ID_RE, tokenMatches } from "@/lib/ids";
import { getImage, mayUseToken, removeImage } from "@/lib/images";
import { links } from "@/lib/links";

type Props = { params: Promise<{ id: string; token: string }>; searchParams: Promise<{ done?: string }> };

export const metadata = { robots: { index: false } };

/**
 * The delete link returned with every upload.
 * Guest uploads: anyone with the link can delete. Images in an account: only that account, signed in.
 */
async function deleteAction(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  const token = String(formData.get("token") || "");
  const img = IMAGE_ID_RE.test(id) ? await getImage(id) : null;
  // Checked again here: the form can be posted without loading the page.
  if (!img || img.status === "removed" || !(await mayUseToken(img, token))) notFound();
  await removeImage(img);
  redirect(`/${id}/delete/${encodeURIComponent(token)}?done=1`);
}

export default async function DeletePage({ params, searchParams }: Props) {
  const { id, token } = await params;
  const { done } = await searchParams;

  if (done) {
    return (
      <div className="prose">
        <h1>Image deleted</h1>
        <p>The image and its links no longer work. Cached copies may take a few minutes to clear.</p>
      </div>
    );
  }

  const img = IMAGE_ID_RE.test(id) ? await getImage(id) : null;
  if (!img || img.status === "removed" || !tokenMatches(token, img.delete_token)) notFound();

  if (img.user_id) {
    const user = await currentUser();
    if (!user) {
      // The link is right, but the image belongs to an account: its owner has to sign in.
      const next = `/${id}/delete/${encodeURIComponent(token)}`;
      return (
        <div className="prose">
          <h1>Sign in to delete this image</h1>
          <p>This image belongs to an account. Only its owner can delete it, so sign in with that account first.</p>
          <p>
            <Link className="btn primary" href={`/login?next=${encodeURIComponent(next)}`}>
              Sign in
            </Link>
          </p>
        </div>
      );
    }
    // Signed in as someone else: behave as if the link didn't exist.
    if (user.id !== img.user_id) notFound();
  }

  const l = links(img);
  return (
    <div className="prose">
      <h1>Delete this image?</h1>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {img.status === "active" && <img src={l.thumb} alt="" width={180} height={180} style={{ borderRadius: 6 }} />}
      <p>Deleting removes the image, its thumbnails and every link to it. This cannot be undone.</p>
      <form action={deleteAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="btn danger">
          Delete image
        </button>
      </form>
    </div>
  );
}
