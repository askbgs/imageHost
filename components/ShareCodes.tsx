"use client";

import { useState } from "react";
import { IconCopy } from "./Icons";
import { useCopy } from "./Toast";

export type Codes = {
  viewer: string;
  direct: string;
  html_full: string;
  html_thumb: string;
  bbcode_full: string;
  bbcode_thumb: string;
  markdown: string;
};

export const FORMATS: { key: keyof Codes; label: string; what: string }[] = [
  { key: "direct", label: "Direct link", what: "Direct link" },
  { key: "viewer", label: "Viewer page", what: "Viewer link" },
  { key: "html_thumb", label: "HTML", what: "HTML code" },
  { key: "html_full", label: "HTML full", what: "HTML code" },
  { key: "bbcode_thumb", label: "BBCode", what: "BBCode" },
  { key: "bbcode_full", label: "BBCode full", what: "BBCode" },
  { key: "markdown", label: "Markdown", what: "Markdown" },
];

export function ShareCodes({ codes, initial = "direct" }: { codes: Codes; initial?: keyof Codes }) {
  const [tab, setTab] = useState<keyof Codes>(initial);
  const copy = useCopy();
  const format = FORMATS.find((f) => f.key === tab)!;
  const value = codes[tab];

  return (
    <div className="codes">
      <div className="segmented" role="group" aria-label="Link format">
        {FORMATS.map((f) => (
          <button key={f.key} type="button" aria-pressed={tab === f.key} onClick={() => setTab(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="code-field">
        <input type="text" readOnly value={value} aria-label={format.label} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn secondary small" onClick={() => copy(value, format.what)}>
          <IconCopy size={15} /> Copy
        </button>
      </div>
    </div>
  );
}
