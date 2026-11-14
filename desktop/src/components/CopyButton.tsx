import { useEffect, useRef, useState } from "react";
import { CheckIcon, ClipboardDocumentIcon } from "@heroicons/react/16/solid";

/** Copy to clipboard: the clipboard icon turns into a green check (and "Copied" when labelled) for a moment. */
export function CopyButton({ text, label = "Copy", showLabel = false, className = "" }: { text: string; label?: string; showLabel?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch { return; }
    setCopied(true); window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };
  return <button type="button" className={"copy-button" + (copied ? " copied" : "") + (className ? " " + className : "")} title={copied ? "Copied" : label} aria-label={copied ? "Copied" : label} onClick={() => void copy()}>
    <span className="copy-icons" aria-hidden="true"><ClipboardDocumentIcon className="copy-clip" /><CheckIcon className="copy-check" /></span>
    {showLabel && <span className="copy-label"><span className="copy-label-idle">Copy</span><span className="copy-label-done">Copied</span></span>}
  </button>;
}
