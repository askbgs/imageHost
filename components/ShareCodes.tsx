"use client";

import { useState } from "react";

export type Codes = {
  viewer: string;
  direct: string;
  html_full: string;
  html_thumb: string;
  bbcode_full: string;
  bbcode_thumb: string;
  markdown: string;
};

const TABS: { key: keyof Codes; label: string }[] = [
  { key: "viewer", label: "Viewer link" },
  { key: "direct", label: "Direct link" },
  { key: "html_thumb", label: "HTML thumbnail" },
  { key: "html_full", label: "HTML full" },
  { key: "bbcode_thumb", label: "BBCode thumbnail" },
  { key: "bbcode_full", label: "BBCode full" },
  { key: "markdown", label: "Markdown" },
];

export function ShareCodes({ codes, initial = "direct" }: { codes: Codes; initial?: keyof Codes }) {
  const [tab, setTab] = useState<keyof Codes>(initial);
  const [copied, setCopied] = useState(false);
  const value = codes[tab];

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="codes">
      <div className="code-tabs" role="group" aria-label="Link format">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => {
              setTab(t.key);
              setCopied(false);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="code-field">
        <input type="text" readOnly value={value} aria-label={TABS.find((t) => t.key === tab)!.label} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn small" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
