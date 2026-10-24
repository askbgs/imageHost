"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteMyImage } from "@/app/actions/account";
import { useConfirm } from "./ConfirmDialog";
import { IconTrash } from "./Icons";
import { useToast } from "./Toast";

export function OwnerDelete({ id, title, thumb }: { id: string; title: string; thumb: string }) {
  const confirm = useConfirm();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn danger-quiet small"
      disabled={pending}
      onClick={async () => {
        const ok = await confirm({
          tone: "danger",
          title: "Delete this image?",
          message: `“${title}” and all its links will stop working. This can't be undone.`,
          previews: [thumb],
          confirmLabel: "Delete image",
          cancelLabel: "Keep",
        });
        if (!ok) return;
        start(async () => {
          const r = await deleteMyImage(id);
          if (r.ok) {
            toast("Image deleted");
            router.push("/account");
          } else toast(r.error || "Could not delete the image", "error");
        });
      }}
    >
      <IconTrash size={15} /> Delete
    </button>
  );
}
