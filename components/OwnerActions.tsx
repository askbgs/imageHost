"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteMyImage } from "@/app/actions/account";
import { IconTrash } from "./Icons";
import { useToast } from "./Toast";

export function OwnerDelete({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn danger-quiet small"
      disabled={pending}
      onClick={() => {
        if (!confirm("Delete this image? Its links will stop working. This can't be undone.")) return;
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
