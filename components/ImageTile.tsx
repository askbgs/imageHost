"use client";

import { useState, useTransition } from "react";
import { deleteMyImage } from "@/app/actions/account";
import { IconClock, IconCopy, IconOpen, IconTrash } from "./Icons";
import { useCopy, useToast } from "./Toast";

export type TileData = {
  id: string;
  title: string;
  thumb: string;
  direct: string;
  viewer: string;
  meta: string;
  flagged: boolean;
  expires: string | null;
  frame: string;
};

export function ImageTile({ img }: { img: TileData }) {
  const copy = useCopy();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);

  if (gone) return null;

  function onDelete() {
    if (!confirm(`Delete "${img.title}"? Its links will stop working. This can't be undone.`)) return;
    start(async () => {
      const r = await deleteMyImage(img.id);
      if (r.ok) {
        setGone(true);
        toast("Image deleted");
      } else {
        toast(r.error || "Could not delete the image", "error");
      }
    });
  }

  return (
    <article className="tile" aria-busy={pending}>
      <a className="shot-img checker" href={img.viewer} target="_blank" rel="noreferrer" title="Open viewer page">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.thumb} alt={img.title} loading="lazy" />
        <span className="frame-no">{img.frame}</span>
        {img.flagged && <span className="badge">Sensitive</span>}
        {!img.flagged && img.expires && (
          <span className="badge time">
            <IconClock size={12} /> {img.expires}
          </span>
        )}
      </a>
      <div className="cap">
        <strong title={img.title}>{img.title}</strong>
        <span>{img.meta}</span>
      </div>
      <div className="tile-actions">
        <button type="button" className="btn ghost small" onClick={() => copy(img.direct, "Direct link")}>
          <IconCopy size={15} /> Copy link
        </button>
        <a className="btn ghost small icon" href={img.viewer} target="_blank" rel="noreferrer" aria-label="Open viewer page" title="Open">
          <IconOpen size={15} />
        </a>
        <button
          type="button"
          className="btn danger-quiet small icon"
          onClick={onDelete}
          disabled={pending}
          aria-label={`Delete ${img.title}`}
          title="Delete"
          style={{ marginLeft: "auto" }}
        >
          <IconTrash size={15} />
        </button>
      </div>
    </article>
  );
}
