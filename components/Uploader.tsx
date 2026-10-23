"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EXPIRY_OPTIONS } from "@/lib/constants";
import { ShareCodes, type Codes } from "./ShareCodes";

type UploadData = {
  id: string;
  title: string;
  url_viewer: string;
  url: string;
  width: number;
  height: number;
  size: number;
  status: string;
  thumb: { url: string };
  delete_url?: string;
  embed: { html: string; html_full: string; bbcode: string; bbcode_full: string; markdown: string };
};

type Item = {
  key: string;
  name: string;
  size: number;
  preview: string | null;
  state: "queued" | "uploading" | "processing" | "done" | "error";
  progress: number;
  error?: string;
  data?: UploadData;
  file?: File;
  url?: string;
  expiration: number;
};

const ACCEPT = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/bmp", "image/tiff"];
const PARALLEL = 3;

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  const mb = n / 1024 / 1024;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

function toCodes(d: UploadData): Codes {
  return {
    viewer: d.url_viewer,
    direct: d.url,
    html_thumb: d.embed.html,
    html_full: d.embed.html_full,
    bbcode_thumb: d.embed.bbcode,
    bbcode_full: d.embed.bbcode_full,
    markdown: d.embed.markdown,
  };
}

async function readJson(res: Response) {
  const body = await res.json().catch(() => null);
  if (!res.ok && res.status !== 202) {
    throw new Error(body?.error?.message || `Upload failed (HTTP ${res.status})`);
  }
  return body as { data: UploadData; status: number };
}

function putWithProgress(url: string, file: File, contentType: string, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage rejected the upload (HTTP ${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Network error while uploading"));
    xhr.send(file);
  });
}

/** UPLOAD_MODE=server: send the file to the app, reporting progress; resolves with the JSON body. */
function postWithProgress(file: File, expiration: number, onProgress: (p: number) => void) {
  return new Promise<{ data: UploadData; status: number }>((resolve, reject) => {
    const form = new FormData();
    form.append("image", file, file.name || "image");
    form.append("expiration", String(expiration));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/internal/uploads/file");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const body = xhr.response;
      if (xhr.status === 200 || xhr.status === 202) resolve(body);
      else reject(new Error(body?.error?.message || `Upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error while uploading"));
    xhr.send(form);
  });
}

async function pollUntilDone(id: string, token: string): Promise<UploadData> {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const body = await readJson(await fetch(`/api/internal/uploads/${id}?token=${encodeURIComponent(token)}`));
    if (body.status === 200) return body.data;
  }
  throw new Error("Processing is taking longer than expected. Check the viewer link in a minute.");
}

export function Uploader({ maxBytes, mode }: { maxBytes: number; mode: "direct" | "server" }) {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [expiration, setExpiration] = useState(0);
  const [url, setUrl] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const active = useRef(0);
  const expirationRef = useRef(0);
  expirationRef.current = expiration;

  const patch = useCallback((key: string, p: Partial<Item>) => {
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...p } : it)));
  }, []);

  const runOne = useCallback(
    async (item: Item) => {
      try {
        patch(item.key, { state: "uploading", progress: 0 });
        let data: UploadData;
        if (item.url) {
          patch(item.key, { state: "processing" });
          const body = await readJson(
            await fetch("/api/internal/uploads/url", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: item.url, expiration: item.expiration }),
            }),
          );
          data = body.data;
        } else if (mode === "server") {
          const file = item.file!;
          const done = await postWithProgress(file, item.expiration, (progress) =>
            patch(item.key, { progress, ...(progress >= 1 ? { state: "processing" } : {}) }),
          );
          if (done.status === 202) {
            const token = done.data.delete_url?.split("/").pop() ?? "";
            data = await pollUntilDone(done.data.id, token);
          } else {
            data = done.data;
          }
        } else {
          const file = item.file!;
          const presign = await readJson(
            await fetch("/api/internal/uploads/presign", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: file.name, size: file.size, type: file.type, expiration: item.expiration }),
            }),
          );
          const p = presign.data as unknown as { id: string; token: string; upload_url: string };
          await putWithProgress(p.upload_url, file, file.type, (progress) => patch(item.key, { progress }));
          patch(item.key, { state: "processing", progress: 1 });
          const done = await readJson(
            await fetch(`/api/internal/uploads/${p.id}/complete`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: p.token }),
            }),
          );
          data = done.status === 202 ? await pollUntilDone(p.id, p.token) : done.data;
        }
        patch(item.key, { state: "done", data, file: undefined });
      } catch (err) {
        patch(item.key, { state: "error", error: err instanceof Error ? err.message : "Upload failed" });
      }
    },
    [patch, mode],
  );

  // Start queued items, PARALLEL at a time.
  useEffect(() => {
    const queued = items.filter((i) => i.state === "queued");
    while (active.current < PARALLEL && queued.length) {
      const next = queued.shift()!;
      active.current++;
      patch(next.key, { state: "uploading" });
      runOne(next).finally(() => {
        active.current--;
        setItems((l) => [...l]); // nudge the effect to pick up the next item
      });
    }
  }, [items, patch, runOne]);

  const addFiles = useCallback(
    (files: Iterable<File>) => {
      const next: Item[] = [];
      for (const file of files) {
        const base: Item = {
          key: crypto.randomUUID(),
          name: file.name || "pasted-image",
          size: file.size,
          preview: null,
          state: "queued",
          progress: 0,
          expiration: expirationRef.current,
        };
        if (!ACCEPT.includes(file.type)) {
          next.push({ ...base, state: "error", error: "Not a supported image (JPG, PNG, GIF, WebP, AVIF, BMP, TIFF)." });
        } else if (file.size > maxBytes) {
          next.push({ ...base, state: "error", error: `Over the ${formatBytes(maxBytes)} limit.` });
        } else {
          next.push({ ...base, file, preview: URL.createObjectURL(file) });
        }
      }
      if (next.length) setItems((list) => [...next.reverse(), ...list]);
    },
    [maxBytes],
  );

  // Drag and drop anywhere on the page, and paste from the clipboard.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
    };
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, [addFiles]);

  function addUrl(e: React.FormEvent) {
    e.preventDefault();
    const value = url.trim();
    if (!/^https?:\/\//i.test(value)) return;
    setItems((list) => [
      {
        key: crypto.randomUUID(),
        name: value.split("/").pop() || value,
        size: 0,
        preview: null,
        state: "queued",
        progress: 0,
        url: value,
        expiration,
      },
      ...list,
    ]);
    setUrl("");
  }

  const doneCount = items.filter((i) => i.state === "done").length;

  async function copyAll() {
    const lines = items.filter((i) => i.data).map((i) => i.data!.url);
    await navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
  }

  return (
    <>
      <section className="frame" aria-label="Upload images">
        <span className="marks" aria-hidden="true" />
        <p className="hint">Drop images here, or anywhere on the page</p>
        <p className="sub">You can also paste with Ctrl+V or ⌘V. Up to {formatBytes(maxBytes)} per image.</p>
        <div className="controls">
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            Choose images
          </button>
          <label className="inline">
            Delete after
            <select value={expiration} onChange={(e) => setExpiration(Number(e.target.value))}>
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.seconds} value={o.seconds}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <form className="url-row" onSubmit={addUrl}>
          <label htmlFor="image-url" className="sr-only">
            Image URL
          </label>
          <input
            id="image-url"
            type="url"
            placeholder="Or paste an image URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit" className="btn secondary">
            Upload URL
          </button>
        </form>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT.join(",")}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </section>

      {items.length > 0 && (
        <section className="sheet" aria-live="polite">
          <div className="sheet-head">
            <h2>Your uploads</h2>
            {doneCount > 1 && (
              <button type="button" className="btn secondary small" onClick={copyAll}>
                Copy all direct links
              </button>
            )}
          </div>
          {items.map((it, idx) => (
            <article className="shot" key={it.key}>
              <div className="thumb checker">
                {it.data ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.data.thumb.url} alt="" />
                ) : it.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.preview} alt="" />
                ) : null}
                <span className="frame-no">{String(items.length - idx).padStart(2, "0")}</span>
              </div>
              <div className="meta">
                <div>
                  <div className="name">{it.data?.title || it.name}</div>
                  <div className="detail">
                    {it.data
                      ? `${it.data.width} × ${it.data.height} · ${formatBytes(it.data.size)}`
                      : it.size
                        ? formatBytes(it.size)
                        : "From URL"}
                  </div>
                </div>
                {(it.state === "queued" || it.state === "uploading") && (
                  <div className="progress" aria-label="Upload progress">
                    <span style={{ width: `${Math.round(it.progress * 100)}%` }} />
                  </div>
                )}
                {it.state === "queued" && <div className="detail">Waiting to upload</div>}
                {it.state === "processing" && <div className="detail">Processing image…</div>}
                {it.state === "error" && <div className="error">{it.error}</div>}
                {it.data && (
                  <>
                    {it.data.status === "flagged" && (
                      <div className="detail">This image was flagged as sensitive and is blurred on its viewer page.</div>
                    )}
                    <ShareCodes codes={toCodes(it.data)} />
                    {it.data.delete_url && (
                      <div className="detail">
                        Delete link (save it; it is shown only now):{" "}
                        <a href={it.data.delete_url} target="_blank" rel="noreferrer">
                          {it.data.delete_url}
                        </a>
                      </div>
                    )}
                  </>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="frame">
            <span className="marks" />
            <p className="hint">Release to upload</p>
          </div>
        </div>
      )}
    </>
  );
}
