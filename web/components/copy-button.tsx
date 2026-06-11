"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // clipboard unavailable (http, permissions) — leave the button as-is
        }
      }}
      className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 transition-colors"
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
