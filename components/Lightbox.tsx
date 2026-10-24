"use client";

import { useEffect, useRef, useState } from "react";
import { IconChevron, IconCopy, IconOpen, IconTrash, IconX } from "./Icons";
import { ShareCodes, type Codes } from "./ShareCodes";
import { SourceTag } from "./SourceTag";
import { useCopy } from "./Toast";

export type GalleryImage = {
  id: string;
  title: string;
  slug: string;
  thumb: string;
  medium: string;
  direct: string;
  viewer: string;
  width: number;
  height: number;
  size: string;
  uploaded: string;
  flagged: boolean;
  expires: string | null;
  frame: string;
  source: "web" | "api";
  keyName: string | null;
  codes: Codes;
};

type Props = {
  images: GalleryImage[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onDelete: (img: GalleryImage) => void;
};

export function Lightbox({ images, index, onIndex, onClose, onDelete }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const copy = useCopy();
  const img = images[index];
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  // Arrow keys move between images; Escape is handled by the dialog's cancel event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight" && index < images.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, images.length, onIndex]);

  // Preload the neighbours so moving between images feels instant.
  useEffect(() => {
    for (const n of [images[index - 1], images[index + 1]]) {
      if (n) new window.Image().src = n.direct;
    }
  }, [index, images]);

  if (!img) return null;
  const hidden = img.flagged && !revealed[img.id];

  return (
    <dialog
      ref={dialog}
      className="lightbox"
      aria-label={img.title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="lb-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {/* The medium size shows at once; the full image fades in over it when it arrives. */}
        <div
          className={`lb-image checker${hidden ? " lb-blur" : ""}`}
          key={img.id}
          style={
            img.width && img.height
              ? {
                  aspectRatio: `${img.width} / ${img.height}`,
                  // As large as fits, never bigger than the image itself.
                  width: `min(100%, ${img.width}px, calc(var(--lb-h) * ${(img.width / img.height).toFixed(4)}))`,
                }
              : undefined
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.medium} alt="" aria-hidden="true" className="lb-placeholder" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.direct}
            alt={img.title}
            className={loaded[img.id] ? "lb-full loaded" : "lb-full"}
            onLoad={() => setLoaded((l) => ({ ...l, [img.id]: true }))}
          />
          {hidden && (
            <button type="button" className="btn secondary lb-reveal" onClick={() => setRevealed((r) => ({ ...r, [img.id]: true }))}>
              Show sensitive image
            </button>
          )}
        </div>

        {index > 0 && (
          <button type="button" className="lb-nav lb-prev" onClick={() => onIndex(index - 1)} aria-label="Previous image">
            <IconChevron size={22} />
          </button>
        )}
        {index < images.length - 1 && (
          <button type="button" className="lb-nav lb-next" onClick={() => onIndex(index + 1)} aria-label="Next image">
            <IconChevron size={22} />
          </button>
        )}
      </div>

      <aside className="lb-panel">
        <div className="lb-head">
          <span className="lb-count">
            {index + 1} of {images.length}
          </span>
          <button type="button" className="btn ghost small icon" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <IconX size={18} />
          </button>
        </div>

        <div className="lb-title">
          <h2>{img.title}</h2>
          <p className="detail">
            {img.width} × {img.height} · {img.size} · {img.uploaded}
            {img.expires ? ` · deletes in ${img.expires}` : ""}
          </p>
          <p className="lb-source">
            <SourceTag source={img.source} />
            <span className="detail">
              {img.source === "api"
                ? `Uploaded with the API${img.keyName ? ` using the key “${img.keyName}”` : ""}`
                : "Uploaded on the website"}
            </span>
          </p>
        </div>

        <button type="button" className="btn primary block" onClick={() => copy(img.direct, "Direct link")}>
          <IconCopy size={16} /> Copy direct link
        </button>

        <ShareCodes codes={img.codes} key={img.id} />

        <div className="lb-actions">
          <a className="btn secondary small" href={img.direct} target="_blank" rel="noreferrer">
            <IconOpen size={15} /> Full size
          </a>
          <a className="btn secondary small" href={img.viewer} target="_blank" rel="noreferrer">
            <IconOpen size={15} /> Public page
          </a>
          <a className="btn secondary small" href={img.direct} download={img.slug}>
            Download
          </a>
        </div>

        <div className="lb-foot">
          <button type="button" className="btn danger-quiet small" onClick={() => onDelete(img)}>
            <IconTrash size={15} /> Delete image
          </button>
          <span className="lb-keys" aria-hidden="true">
            <kbd>←</kbd> <kbd>→</kbd> to browse · <kbd>Esc</kbd> to close
          </span>
        </div>
      </aside>
    </dialog>
  );
}
