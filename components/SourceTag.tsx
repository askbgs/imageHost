import { IconCode, IconUpload } from "./Icons";

/** Small tag showing how an image was uploaded: on the website or with an API key. */
export function SourceTag({ source, title }: { source: "web" | "api"; title?: string }) {
  return (
    <span className={`source-tag source-${source}`} title={title ?? (source === "api" ? "Uploaded with the API" : "Uploaded on the website")}>
      {source === "api" ? <IconCode size={12} /> : <IconUpload size={12} />}
      {source === "api" ? "API" : "Web"}
    </span>
  );
}
