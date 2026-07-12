"use client";

import { useEffect, useState } from "react";

type CommandCopyProps = {
  command: string;
  copiedLabel: string;
  copyLabel: string;
};

export function CommandCopy({
  command,
  copiedLabel,
  copyLabel,
}: CommandCopyProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
  }

  return (
    <button
      className="copy-command"
      type="button"
      onClick={copy}
      aria-label={`${copyLabel}: ${command}`}
    >
      <span className="copy-command-label" aria-live="polite">
        {copied ? copiedLabel : copyLabel}
      </span>
      <span className="copy-icon" aria-hidden="true">
        {copied ? "✓" : "↗"}
      </span>
    </button>
  );
}
