"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  addToAlbum,
  createAlbum,
  deleteAlbum,
  updateAlbum,
} from "@/app/actions/albums";
import { useConfirm } from "./ConfirmDialog";
import {
  IconAlbum,
  IconCopy,
  IconGlobe,
  IconLink,
  IconLock,
  IconPencil,
  IconPlus,
  IconTrash,
  IconX,
} from "./Icons";
import { useCopy, useToast } from "./Toast";

export type Visibility = "public" | "unlisted" | "private";
export type AlbumOption = { id: string; title: string; visibility: Visibility };

const VIS: Record<
  Visibility,
  { label: string; hint: string; Icon: typeof IconGlobe }
> = {
  public: {
    label: "Public",
    hint: "Anyone with the link can view it, and it's shown on your profile.",
    Icon: IconGlobe,
  },
  unlisted: {
    label: "Unlisted",
    hint: "Only people you share the link with can view it.",
    Icon: IconLink,
  },
  private: {
    label: "Private",
    hint: "Only you can open the album page.",
    Icon: IconLock,
  },
};

export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const { label, Icon } = VIS[visibility];
  return (
    <span className={`vis-badge vis-${visibility}`}>
      <Icon size={13} /> {label}
    </span>
  );
}

/** A <dialog> that opens and closes with `open`. */
function Modal({
  open,
  onClose,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="confirm album-dialog"
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {open && children}
    </dialog>
  );
}

/** Create or edit an album. */
export function AlbumDialog({
  open,
  onClose,
  album,
  canPrivate,
  imageIds,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Editing this album; omit to create one. */
  album?: {
    id: string;
    title: string;
    description: string | null;
    visibility: Visibility;
  };
  canPrivate: boolean;
  /** Images to put in a new album straight away. */
  imageIds?: string[];
  onSaved?: (id: string) => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Visibility>(
    album?.visibility ?? "unlisted",
  );

  useEffect(() => {
    if (open) {
      setError(null);
      setVisibility(album?.visibility ?? "unlisted");
    }
  }, [open, album?.visibility]);

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const input = {
      title: String(data.get("title") ?? ""),
      description: String(data.get("description") ?? ""),
      visibility,
    };
    start(async () => {
      const res = album
        ? await updateAlbum(album.id, input)
        : await createAlbum({ ...input, imageIds });
      if (res.error) return setError(res.error);
      toast(res.ok ?? "Saved");
      onClose();
      router.refresh();
      onSaved?.(res.id ?? album!.id);
    });
  }

  // Private stays selectable on an album that is already private, even on Free.
  const privateLocked = !canPrivate && album?.visibility !== "private";
  const titleId = album ? "album-edit-title" : "album-new-title";

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId}>
      <form
        className="confirm-body album-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
      >
        <h2 id={titleId}>
          {album
            ? "Edit album"
            : imageIds?.length
              ? `New album with ${imageIds.length} image${imageIds.length === 1 ? "" : "s"}`
              : "New album"}
        </h2>
        <div className="field">
          <label htmlFor="album-title">Name</label>
          <input
            id="album-title"
            name="title"
            type="text"
            maxLength={100}
            required
            defaultValue={album?.title}
            autoFocus
            placeholder="For example: Trip to Jaffna"
          />
        </div>
        <div className="field">
          <label htmlFor="album-description">
            Description <span className="optional">optional</span>
          </label>
          <textarea
            id="album-description"
            name="description"
            rows={2}
            maxLength={500}
            defaultValue={album?.description ?? ""}
          />
        </div>
        <fieldset className="vis-picker">
          <legend>Who can see it</legend>
          {(Object.keys(VIS) as Visibility[]).map((v) => {
            const { label, hint, Icon } = VIS[v];
            const locked = v === "private" && privateLocked;
            return (
              <label
                key={v}
                className={`vis-option${visibility === v ? " is-on" : ""}${locked ? " is-locked" : ""}`}
              >
                <input
                  type="radio"
                  name="visibility"
                  value={v}
                  checked={visibility === v}
                  disabled={locked}
                  onChange={() => setVisibility(v)}
                />
                <Icon size={18} />
                <span>
                  <strong>
                    {label}
                    {v === "private" && <span className="pro-pill">Pro</span>}
                  </strong>
                  <span className="vis-hint">
                    {locked ? (
                      <>
                        Private albums come with Pro and Business.{" "}
                        <Link href="/pricing">See plans</Link>
                      </>
                    ) : (
                      hint
                    )}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
        {visibility === "private" && (
          <p className="field-hint">
            Private hides the album page. Each image keeps its own link, so
            anyone you&apos;ve already sent an image link to can still open that
            image.
          </p>
        )}
        {error && (
          <p
            className="alert error"
            role="alert"
            style={{ width: "100%", margin: 0 }}
          >
            {error}
          </p>
        )}
        <div className="confirm-actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={pending}>
            {pending ? "Saving…" : album ? "Save" : "Create album"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** "New album" button for the albums page. Opens the new album when it's created. */
export function NewAlbumButton({
  canPrivate,
  autoOpen = false,
}: {
  canPrivate: boolean;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        className="btn primary"
        onClick={() => setOpen(true)}
      >
        <IconPlus size={16} /> New album
      </button>
      <AlbumDialog
        open={open}
        onClose={() => setOpen(false)}
        canPrivate={canPrivate}
        onSaved={(id) => router.push(`/account/albums/${id}`)}
      />
    </>
  );
}

/** Pick an album for the selected images, or make a new one with them. */
export function AddToAlbumDialog({
  open,
  onClose,
  imageIds,
  albums,
  canPrivate,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  imageIds: string[];
  albums: AlbumOption[];
  canPrivate: boolean;
  onDone?: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (open) setCreating(albums.length === 0);
  }, [open, albums.length]);

  if (creating) {
    return (
      <AlbumDialog
        open={open}
        onClose={onClose}
        canPrivate={canPrivate}
        imageIds={imageIds}
        onSaved={() => onDone?.()}
      />
    );
  }

  const n = imageIds.length;
  return (
    <Modal open={open} onClose={onClose} labelledBy="add-album-title">
      <div className="confirm-body album-form">
        <div className="dialog-head">
          <h2 id="add-album-title">
            Add {n} image{n === 1 ? "" : "s"} to an album
          </h2>
          <button
            type="button"
            className="btn ghost small icon"
            onClick={onClose}
            aria-label="Close"
          >
            <IconX size={16} />
          </button>
        </div>
        <ul className="album-pick">
          {albums.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setBusyId(a.id);
                  start(async () => {
                    const res = await addToAlbum(a.id, imageIds);
                    setBusyId(null);
                    if (res.error) return toast(res.error, "error");
                    toast(res.ok ?? "Added");
                    onClose();
                    onDone?.();
                    router.refresh();
                  });
                }}
              >
                <IconAlbum size={18} />
                <span className="album-pick-title">{a.title}</span>
                {busyId === a.id ? (
                  <span className="vis-hint">Adding…</span>
                ) : (
                  <VisibilityBadge visibility={a.visibility} />
                )}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn secondary"
          onClick={() => setCreating(true)}
          disabled={pending}
        >
          <IconPlus size={16} /> New album
        </button>
      </div>
    </Modal>
  );
}

/** Share link, edit and delete for the owner's album page. */
export function AlbumOwnerBar({
  album,
  shareUrl,
  canPrivate,
}: {
  album: {
    id: string;
    title: string;
    description: string | null;
    visibility: Visibility;
  };
  shareUrl: string;
  canPrivate: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const copy = useCopy();
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();

  async function onDelete() {
    const ok = await confirm({
      tone: "danger",
      title: `Delete “${album.title}”?`,
      message:
        "The album and its link go away. The images in it stay in My images, with their links.",
      confirmLabel: "Delete album",
      cancelLabel: "Keep",
    });
    if (!ok) return;
    start(async () => {
      const res = await deleteAlbum(album.id);
      if (res.error) return toast(res.error, "error");
      toast(res.ok ?? "Album deleted");
      router.push("/account/albums");
    });
  }

  return (
    <>
      <div className="share-row">
        {album.visibility === "private" ? (
          <p className="detail" style={{ margin: 0 }}>
            <IconLock size={14} /> Only you can open this album. Make it
            Unlisted or Public to share it.
          </p>
        ) : (
          <>
            <label htmlFor="album-link" className="sr-only">
              Album link
            </label>
            <input
              id="album-link"
              type="text"
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              className="btn primary"
              onClick={() => copy(shareUrl, "Album link")}
            >
              <IconCopy size={16} /> Copy link
            </button>
          </>
        )}
        <Link className="btn secondary" href={`/?album=${album.id}`}>
          Upload to album
        </Link>
        <a
          className="btn secondary"
          href={shareUrl}
          target="_blank"
          rel="noreferrer"
        >
          View album
        </a>
        <button
          type="button"
          className="btn secondary"
          onClick={() => setEditing(true)}
        >
          <IconPencil size={16} /> Edit
        </button>
        <button
          type="button"
          className="btn danger-quiet"
          onClick={onDelete}
          disabled={pending}
        >
          <IconTrash size={16} /> Delete album
        </button>
      </div>
      <AlbumDialog
        open={editing}
        onClose={() => setEditing(false)}
        album={album}
        canPrivate={canPrivate}
      />
    </>
  );
}

/** One-click copy of the album link, for the public album page. */
export function CopyAlbumLink({ url }: { url: string }) {
  const copy = useCopy();
  return (
    <button
      type="button"
      className="btn secondary small"
      onClick={() => copy(url, "Album link")}
    >
      <IconCopy size={15} /> Copy link
    </button>
  );
}
