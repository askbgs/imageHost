"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EXPIRY_OPTIONS } from "@/lib/constants";
import { IconCheck, IconCopy, IconOpen, IconUpload, IconX } from "./Icons";
import { FORMATS, ShareCodes, type Codes } from "./ShareCodes";
import { useCopy } from "./Toast";

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
    // Status 0 with no response: blocked by the browser (usually a missing CORS rule on the
    // bucket) or the connection dropped. The caller falls back to uploading through the site.
    xhr.onerror = () => reject(new DirectUploadBlocked());
    xhr.send(file);
  });
}

class DirectUploadBlocked extends Error {
  constructor() {
    super("Direct upload to storage was blocked");
  }
}

// Once a direct upload has been blocked, send the rest of this visit's uploads through the site.
let directBlocked = false;

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
    xhr.onerror = () =>
      reject(new Error("Couldn't reach the server. Check your connection and try again."));
    xhr.ontimeout = xhr.onerror;
    xhr.send(form);
  });
}

async function pollUntilDone(id: string, token: string): Promise<UploadData> {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const body = await readJson(await fetch(`/api/internal/uploads/${id}?token=${encodeURIComponent(token)}`));
    if (body.status === 200) return body.data;
  }
  throw new Error("Processing is taking too long. Try again; if it keeps happening, the site's image worker may be down.");
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
  const copy = useCopy();
  const [batchFormat, setBatchFormat] = useState<keyof Codes>("direct");

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
        } else {
          const file = item.file!;
          const viaSite = async () => {
            patch(item.key, { state: "uploading", progress: 0 });
            const done = await postWithProgress(file, item.expiration, (progress) =>
              patch(item.key, { progress, ...(progress >= 1 ? { state: "processing" } : {}) }),
            );
            if (done.status === 202) {
              const token = done.data.delete_url?.split("/").pop() ?? "";
              return pollUntilDone(done.data.id, token);
            }
            return done.data;
          };

          if (mode === "server" || directBlocked) {
            data = await viaSite();
          } else {
            const presign = await readJson(
              await fetch("/api/internal/uploads/presign", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: file.name, size: file.size, type: file.type, expiration: item.expiration }),
              }),
            );
            const p = presign.data as unknown as { id: string; token: string; upload_url: string };
            try {
              await putWithProgress(p.upload_url, file, file.type, (progress) => patch(item.key, { progress }));
            } catch (err) {
              if (!(err instanceof DirectUploadBlocked)) throw err;
              directBlocked = true;
              console.warn(
                "Direct upload to storage was blocked; uploading through the site instead. " +
                  "Add a CORS rule on the bucket for this site's address (see R2.md, step 5).",
              );
              p.upload_url = "";
            }
            if (p.upload_url) {
              patch(item.key, { state: "processing", progress: 1 });
              const done = await readJson(
                await fetch(`/api/internal/uploads/${p.id}/complete`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ token: p.token }),
                }),
              );
              data = done.status === 202 ? await pollUntilDone(p.id, p.token) : done.data;
            } else {
              data = await viaSite();
            }
          }
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

  const done = items.filter((i) => i.state === "done" && i.data);
  const busy = items.some((i) => i.state === "queued" || i.state === "uploading" || i.state === "processing");

  function copyAll() {
    const f = FORMATS.find((x) => x.key === batchFormat)!;
    copy(done.map((i) => toCodes(i.data!)[batchFormat]).join("\n"), `${done.length} × ${f.what}`);
  }

  function retry(it: Item) {
    if (!it.file && !it.url) return;
    patch(it.key, { state: "queued", progress: 0, error: undefined });
  }

  function remove(key: string) {
    setItems((list) => list.filter((i) => i.key !== key));
  }

  return (
    <>
      <section className="frame" aria-label="Upload images">
        <span className="marks" aria-hidden="true" />
        <span className="drop-icon" aria-hidden="true">
          <IconUpload size={26} />
        </span>
        <p className="hint">Drop images anywhere on this page</p>
        <p className="sub">
          Or paste with <kbd>Ctrl</kbd> <kbd>V</kbd>. JPG, PNG, GIF, WebP, AVIF up to {formatBytes(maxBytes)} each.
        </p>
        <div className="controls">
          <button type="button" className="btn primary" onClick={() => fileInput.current?.click()}>
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
        <div className="divider-or">or import from a link</div>
        <form className="url-row" onSubmit={addUrl}>
          <label htmlFor="image-url" className="sr-only">
            Image URL
          </label>
          <input
            id="image-url"
            type="url"
            placeholder="https://example.com/photo.jpg"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit" className="btn secondary" disabled={!/^https?:\/\/./i.test(url.trim())}>
            Import
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
        <section className="sheet" aria-label="Your uploads">
          <div className="sheet-head">
            <h2>
              {busy ? "Uploading…" : `${done.length} image${done.length === 1 ? "" : "s"} ready`}
            </h2>
            <div className="sheet-tools">
              {done.length > 1 && (
                <>
                  <label className="sr-only" htmlFor="batch-format">
                    Format for copying all
                  </label>
                  <select id="batch-format" value={batchFormat} onChange={(e) => setBatchFormat(e.target.value as keyof Codes)}>
                    {FORMATS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn secondary small" onClick={copyAll}>
                    <IconCopy size={15} /> Copy all {done.length}
                  </button>
                </>
              )}
              {!busy && (
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => setItems((l) => l.filter((i) => i.state !== "done" && i.state !== "error"))}
                >
                  Clear list
                </button>
              )}
            </div>
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
                <div className="shot-top">
                  <div style={{ minWidth: 0 }}>
                    <div className="name">{it.data?.title || it.name}</div>
                    <Status it={it} />
                  </div>
                  <div className="shot-actions">
                    {it.data && (
                      <>
                        <button type="button" className="btn primary small" onClick={() => copy(it.data!.url, "Direct link")}>
                          <IconCopy size={15} /> Copy link
                        </button>
                        <a className="btn secondary small icon" href={it.data.url_viewer} target="_blank" rel="noreferrer" aria-label="Open viewer page" title="Open viewer page">
                          <IconOpen size={16} />
                        </a>
                      </>
                    )}
                    {it.state === "error" && (it.file || it.url) && (
                      <button type="button" className="btn secondary small" onClick={() => retry(it)}>
                        Try again
                      </button>
                    )}
                    {(it.state === "error" || it.state === "done") && (
                      <button type="button" className="btn ghost small icon" onClick={() => remove(it.key)} aria-label="Remove from list" title="Remove from list">
                        <IconX size={16} />
                      </button>
                    )}
                  </div>
                </div>
                {(it.state === "queued" || it.state === "uploading") && (
                  <div className="progress" aria-label="Upload progress">
                    <span style={{ width: `${Math.round(it.progress * 100)}%` }} />
                  </div>
                )}
                {it.data && (
                  <>
                    <ShareCodes codes={toCodes(it.data)} />
                    {it.data.delete_url && (
                      <div className="delete-note">
                        <span>Delete link:</span>
                        <code>{it.data.delete_url}</code>
                        <button type="button" className="btn ghost small" onClick={() => copy(it.data!.delete_url!, "Delete link")}>
                          Copy
                        </button>
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

function Status({ it }: { it: Item }) {
  const size = it.data ? `${it.data.width} × ${it.data.height} · ${formatBytes(it.data.size)}` : it.size ? formatBytes(it.size) : "From a link";
  switch (it.state) {
    case "queued":
      return <span className="status">Waiting · {size}</span>;
    case "uploading":
      return (
        <span className="status">
          <span className="spinner" aria-hidden="true" /> Uploading {Math.round(it.progress * 100)}% · {size}
        </span>
      );
    case "processing":
      return (
        <span className="status">
          <span className="spinner" aria-hidden="true" /> Processing · {size}
        </span>
      );
    case "error":
      return <span className="status err">{it.error}</span>;
    case "done":
      return it.data?.status === "flagged" ? (
        <span className="status warn">Flagged as sensitive: blurred on its page · {size}</span>
      ) : (
        <span className="status ok">
          <IconCheck size={15} /> Ready · {size}
        </span>
      );
  }
}
