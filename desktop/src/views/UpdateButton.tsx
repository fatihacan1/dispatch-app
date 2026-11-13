import { useEffect, useState } from "react";
import { ArrowPathIcon } from "@heroicons/react/16/solid";
import { ask } from "../components/ask";

type Update = { current: string; available: string; ready: boolean; progress: number; checking: boolean; checked: number; error: string; enabled: boolean };
const army = () => (window as any).army;

/**
 * Far right of the bottom bar: the app version as plain text. While a new version downloads it shows the
 * progress; once it is ready the text turns into a pulsing blue Update button.
 */
export function VersionBadge() {
  const [u, setU] = useState<Update | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    army().update?.status().then(setU).catch(() => {});
    return army().on("update", (v: Update) => setU(v));
  }, []);
  if (!u) return null;
  if (u.ready) return <button type="button" className="version-update" title={`Dispatch ${u.available} is ready (you have ${u.current})`} onClick={async () => {
    const ok = await ask.confirm(`Update to Dispatch ${u.available}?`, { description: "Dispatch restarts to install it. Running agents stop and resume afterwards; your chats, templates and settings stay.", action: "Restart and update" });
    if (ok) await army().update.install();
  }}><ArrowPathIcon aria-hidden="true" />Update to {u.available}</button>;
  const busy = u.available && !u.ready ? `downloading ${u.available} · ${u.progress}%` : u.checking ? "checking…" : note;
  return <button type="button" className="version-text" disabled={!u.enabled || u.checking} title={u.error ? `Update check failed: ${u.error}` : u.enabled ? "Check for updates" : "Updates work in the installed app"} onClick={async () => {
    const s: Update = await army().update.check();
    if (!s.available && !s.error) { setNote("up to date"); setTimeout(() => setNote(""), 4000); }
  }}>v{u.current}{busy ? ` · ${busy}` : ""}</button>;
}
