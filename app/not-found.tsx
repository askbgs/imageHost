import Link from "next/link";

export default function NotFound() {
  return (
    <div className="prose">
      <h1>This image isn&apos;t here</h1>
      <p>It may have been deleted by its uploader, expired, or been removed for breaking the rules.</p>
      <p>
        <Link href="/" className="btn">
          Upload an image
        </Link>
      </p>
    </div>
  );
}
