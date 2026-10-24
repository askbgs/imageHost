"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { deleteMyImages } from "@/app/actions/account";
import { removeFromAlbum, setAlbumCover } from "@/app/actions/albums";
import { AddToAlbumDialog, type AlbumOption } from "./Albums";
import { useConfirm } from "./ConfirmDialog";
import {
  IconAlbum,
  IconCheck,
  IconClock,
  IconCopy,
  IconImages,
  IconTrash,
  IconX,
} from "./Icons";
import { Lightbox, type GalleryImage } from "./Lightbox";
import { SourceTag } from "./SourceTag";
import { useCopy, useToast } from "./Toast";

export function ImageGallery({
  initial,
  albums,
  canPrivate = false,
  album,
}: {
  initial: GalleryImage[];
  /** My images: the account's albums, for "Add to album". */
  albums?: AlbumOption[];
  canPrivate?: boolean;
  /** An album's page: adds "Remove from album" and "Set as cover". */
  album?: { id: string; coverId: string | null };
}) {
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
  const [picking, setPicking] = useState<string[] | null>(null);

  // New data from the server (search, paging, refresh after delete).
  useEffect(() => {
    setImages(initial);
    setSelected(
      (s) => new Set([...s].filter((id) => initial.some((i) => i.id === id))),
    );
  }, [initial]);

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
    lastClicked.current = null;
  }, []);

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && open === null && exitSelection();
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

  const allSelected =
    images.length > 0 && images.every((i) => selected.has(i.id));

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
        setOpen((o) =>
          o === null
            ? null
            : next.length === 0
              ? null
              : Math.min(o, next.length - 1),
        );
        return next;
      });
      setSelected((s) => new Set([...s].filter((id) => !gone.has(id))));
      if (r.error) toast(r.error, "error");
      else
        toast(
          r.deleted.length === 1
            ? "Image deleted"
            : `${r.deleted.length} images deleted`,
        );
      if (gone.size === targets.length && selecting) exitSelection();
      router.refresh();
    });
  }

  function takeOut(targets: GalleryImage[]) {
    if (!album) return;
    startBusy(async () => {
      const r = await removeFromAlbum(
        album.id,
        targets.map((t) => t.id),
      );
      if (r.error) return toast(r.error, "error");
      const gone = new Set(targets.map((t) => t.id));
      setImages((list) => list.filter((i) => !gone.has(i.id)));
      setSelected(new Set());
      toast(r.ok ?? "Removed");
      exitSelection();
      router.refresh();
    });
  }

  function makeCover(img: GalleryImage) {
    if (!album) return;
    startBusy(async () => {
      const r = await setAlbumCover(album.id, img.id);
      if (r.error) toast(r.error, "error");
      else {
        toast(r.ok ?? "Cover updated");
        router.refresh();
      }
    });
  }

  if (images.length === 0) {
    return album ? (
      <div className="panel empty">
        <span className="empty-icon" aria-hidden="true">
          <IconImages size={26} />
        </span>
        <h2>No images in this album yet</h2>
        <p>
          Select images in <a href="/account">My images</a> and choose Add to
          album, or pick this album when you upload.
        </p>
      </div>
    ) : (
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
                onChange={() =>
                  setSelected(
                    allSelected ? new Set() : new Set(images.map((i) => i.id)),
                  )
                }
              />
              {allSelected ? "Deselect all" : "Select all on this page"}
            </label>
            <button
              type="button"
              className="btn ghost small"
              onClick={exitSelection}
            >
              Done
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn secondary small"
            onClick={() => setSelecting(true)}
          >
            <IconCheck size={15} /> Select
          </button>
        )}
      </div>

      <div className={`grid${selecting ? " selecting" : ""}`} aria-busy={busy}>
        {images.map((img, i) => {
          const isSel = selected.has(img.id);
          return (
            <article
              className={`tile${isSel ? " is-selected" : ""}`}
              key={img.id}
            >
              <button
                type="button"
                className="shot-img checker"
                onClick={(e) =>
                  selecting ? toggle(i, e.shiftKey) : setOpen(i)
                }
                aria-label={
                  selecting
                    ? `${isSel ? "Deselect" : "Select"} ${img.title}`
                    : `Open ${img.title}`
                }
                aria-pressed={selecting ? isSel : undefined}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.thumb} alt="" loading="lazy" />
                <span className="frame-no">{img.frame}</span>
                {img.flagged && <span className="badge">Sensitive</span>}
                {album?.coverId === img.id && (
                  <span className="badge cover-badge">Cover</span>
                )}
                {!img.flagged && img.expires && (
                  <span className="badge time">
                    <IconClock size={12} /> {img.expires}
                  </span>
                )}
              </button>
              <label
                className="tile-check"
                title={isSel ? "Deselect" : "Select"}
              >
                <input
                  type="checkbox"
                  checked={isSel}
                  onChange={(e) =>
                    toggle(i, (e.nativeEvent as MouseEvent).shiftKey)
                  }
                  aria-label={`Select ${img.title}`}
                />
                <span aria-hidden="true">
                  <IconCheck size={14} />
                </span>
              </label>
              <div className="cap">
                <div className="cap-title">
                  <strong title={img.title}>{img.title}</strong>
                  <SourceTag
                    source={img.source}
                    title={
                      img.source === "api" && img.keyName
                        ? `API key: ${img.keyName}`
                        : undefined
                    }
                  />
                </div>
                <span>
                  {img.width} × {img.height} · {img.size} · {img.uploaded}
                </span>
              </div>
              <div className="tile-actions">
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => copy(img.direct, "Direct link")}
                >
                  <IconCopy size={15} /> Copy link
                </button>
                {album && album.coverId !== img.id && (
                  <button
                    type="button"
                    className="btn ghost small icon"
                    onClick={() => makeCover(img)}
                    disabled={busy}
                    aria-label={`Use ${img.title} as the album cover`}
                    title="Use as cover"
                  >
                    <IconAlbum size={15} />
                  </button>
                )}
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
            {selected.size === 0
              ? "Select images"
              : `${selected.size} selected`}
          </span>
          {selected.size > 0 && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
          )}
          {albums && (
            <button
              type="button"
              className="btn secondary small"
              disabled={selected.size === 0 || busy}
              onClick={() => setPicking(chosen.map((c) => c.id))}
            >
              <IconAlbum size={15} /> Add to album
            </button>
          )}
          {album && (
            <button
              type="button"
              className="btn secondary small"
              disabled={selected.size === 0 || busy}
              onClick={() => takeOut(chosen)}
              title="Take the images out of this album. They stay in My images."
            >
              <IconX size={15} /> Remove from album
            </button>
          )}
          <button
            type="button"
            className="btn danger small"
            disabled={selected.size === 0 || busy}
            onClick={() => remove(chosen)}
          >
            <IconTrash size={15} />{" "}
            {busy
              ? "Deleting…"
              : `Delete${selected.size ? ` ${selected.size}` : ""}`}
          </button>
        </div>
      )}

      {albums && (
        <AddToAlbumDialog
          open={picking !== null}
          onClose={() => setPicking(null)}
          imageIds={picking ?? []}
          albums={albums}
          canPrivate={canPrivate}
          onDone={exitSelection}
        />
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
