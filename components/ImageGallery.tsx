"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { deleteMyImages } from "@/app/actions/account";
import { useConfirm } from "./ConfirmDialog";
import { IconCheck, IconClock, IconCopy, IconTrash } from "./Icons";
import { Lightbox, type GalleryImage } from "./Lightbox";
import { useCopy, useToast } from "./Toast";

export function ImageGallery({ initial }: { initial: GalleryImage[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const copy = useCopy();
  const [images, setImages] = useState(initial);
  const [open, setOpen] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, startBusy] = useTransition();
  const lastClicked = useRef<number | null>(null);

  // New data from the server (search, paging, refresh after delete).
  useEffect(() => {
    setImages(initial);
    setSelected((s) => new Set([...s].filter((id) => initial.some((i) => i.id === id))));
  }, [initial]);

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
    lastClicked.current = null;
  }, []);

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && open === null && exitSelection();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, open, exitSelection]);

  function toggle(index: number, range: boolean) {
    const id = images[index]!.id;
    // Read it now: the state updater below runs later, after lastClicked has moved on.
    const anchor = lastClicked.current;
    setSelecting(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (range && anchor !== null) {
        // Shift-click selects everything between the last click and this one.
        const [a, b] = [anchor, index].sort((x, y) => x - y);
        for (let i = a!; i <= b!; i++) next.add(images[i]!.id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastClicked.current = index;
  }

  const allSelected = images.length > 0 && images.every((i) => selected.has(i.id));

  async function remove(targets: GalleryImage[]) {
    const n = targets.length;
    const ok = await confirm({
      tone: "danger",
      title: n === 1 ? "Delete this image?" : `Delete ${n} images?`,
      message:
        n === 1
          ? `“${targets[0]!.title}” and all its links will stop working. This can't be undone.`
          : `These images and all their links will stop working. This can't be undone.`,
      previews: targets.slice(0, 5).map((t) => t.thumb),
      previewCount: n,
      confirmLabel: n === 1 ? "Delete image" : `Delete ${n} images`,
      cancelLabel: "Keep",
    });
    if (!ok) return;

    startBusy(async () => {
      const r = await deleteMyImages(targets.map((t) => t.id));
      const gone = new Set(r.deleted);
      setImages((list) => {
        const next = list.filter((i) => !gone.has(i.id));
        // Keep the viewer open on the next image, or close it when none are left.
        setOpen((o) => (o === null ? null : next.length === 0 ? null : Math.min(o, next.length - 1)));
        return next;
      });
      setSelected((s) => new Set([...s].filter((id) => !gone.has(id))));
      if (r.error) toast(r.error, "error");
      else toast(r.deleted.length === 1 ? "Image deleted" : `${r.deleted.length} images deleted`);
      if (gone.size === targets.length && selecting) exitSelection();
      router.refresh();
    });
  }

  if (images.length === 0) {
    return (
      <div className="panel empty">
        <h2>All images deleted</h2>
        <p>Upload new images and they&apos;ll appear here.</p>
      </div>
    );
  }

  const chosen = images.filter((i) => selected.has(i.id));

  return (
    <>
      <div className="gallery-bar">
        {selecting ? (
          <>
            <label className="check-all">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(images.map((i) => i.id)))}
              />
              {allSelected ? "Deselect all" : "Select all on this page"}
            </label>
            <button type="button" className="btn ghost small" onClick={exitSelection}>
              Done
            </button>
          </>
        ) : (
          <button type="button" className="btn secondary small" onClick={() => setSelecting(true)}>
            <IconCheck size={15} /> Select
          </button>
        )}
      </div>

      <div className={`grid${selecting ? " selecting" : ""}`} aria-busy={busy}>
        {images.map((img, i) => {
          const isSel = selected.has(img.id);
          return (
            <article className={`tile${isSel ? " is-selected" : ""}`} key={img.id}>
              <button
                type="button"
                className="shot-img checker"
                onClick={(e) => (selecting ? toggle(i, e.shiftKey) : setOpen(i))}
                aria-label={selecting ? `${isSel ? "Deselect" : "Select"} ${img.title}` : `Open ${img.title}`}
                aria-pressed={selecting ? isSel : undefined}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.thumb} alt="" loading="lazy" />
                <span className="frame-no">{img.frame}</span>
                {img.flagged && <span className="badge">Sensitive</span>}
                {!img.flagged && img.expires && (
                  <span className="badge time">
                    <IconClock size={12} /> {img.expires}
                  </span>
                )}
              </button>
              <label className="tile-check" title={isSel ? "Deselect" : "Select"}>
                <input
                  type="checkbox"
                  checked={isSel}
                  onChange={(e) => toggle(i, (e.nativeEvent as MouseEvent).shiftKey)}
                  aria-label={`Select ${img.title}`}
                />
                <span aria-hidden="true">
                  <IconCheck size={14} />
                </span>
              </label>
              <div className="cap">
                <strong title={img.title}>{img.title}</strong>
                <span>
                  {img.width} × {img.height} · {img.size} · {img.uploaded}
                </span>
              </div>
              <div className="tile-actions">
                <button type="button" className="btn ghost small" onClick={() => copy(img.direct, "Direct link")}>
                  <IconCopy size={15} /> Copy link
                </button>
                <button
                  type="button"
                  className="btn danger-quiet small icon"
                  onClick={() => remove([img])}
                  disabled={busy}
                  aria-label={`Delete ${img.title}`}
                  title="Delete"
                  style={{ marginLeft: "auto" }}
                >
                  <IconTrash size={15} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {selecting && (
        <div className="bulk-bar" role="toolbar" aria-label="Selected images">
          <span className="bulk-count">
            {selected.size === 0 ? "Select images to delete" : `${selected.size} selected`}
          </span>
          {selected.size > 0 && (
            <button type="button" className="btn ghost small" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          )}
          <button
            type="button"
            className="btn danger small"
            disabled={selected.size === 0 || busy}
            onClick={() => remove(chosen)}
          >
            <IconTrash size={15} /> {busy ? "Deleting…" : `Delete${selected.size ? ` ${selected.size}` : ""}`}
          </button>
        </div>
      )}

      {open !== null && images[open] && (
        <Lightbox
          images={images}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          onDelete={(img) => remove([img])}
        />
      )}
    </>
  );
}
