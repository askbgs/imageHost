"use client";

import { useState } from "react";
import { REPORT_LABELS, REPORT_REASONS, type ReportReason } from "@/lib/constants";

export function ReportForm({ imageId }: { imageId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("illegal");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const res = await fetch("/api/1/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_id: imageId, reason, details }),
    }).catch(() => null);
    if (res?.ok) {
      setState("sent");
    } else {
      const body = await res?.json().catch(() => null);
      setError(body?.error?.message || "The report could not be sent. Try again.");
      setState("error");
    }
  }

  if (state === "sent") return <p className="detail">Report sent. A moderator will review this image.</p>;

  if (!open) {
    return (
      <div>
        <button type="button" className="btn ghost small" onClick={() => setOpen(true)}>
          Report this image
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
      <label className="inline">
        Reason
        <select value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
          {REPORT_REASONS.map((r) => (
            <option key={r} value={r}>
              {REPORT_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="report-details" className="sr-only">
        Details
      </label>
      <textarea
        id="report-details"
        rows={3}
        placeholder="Details (optional)"
        maxLength={2000}
        value={details}
        onChange={(e) => setDetails(e.target.value)}
      />
      {state === "error" && <p className="error">{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn small" disabled={state === "sending"}>
          Send report
        </button>
        <button type="button" className="btn secondary small" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
