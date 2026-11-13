import { useEffect, useState } from "react";
import { ArrowDownTrayIcon } from "@heroicons/react/16/solid";
import { ask } from "../components/ask";

type Update = { current: string; available: string; ready: boolean; progress: number; error: string };
const army = () => (window as any).army;

/** Blue rail button, shown only when a new version is downloaded and ready to install. */
export function UpdateRailButton() {
  const [u, setU] = useState<Update | null>(null);
  useEffect(() => {
    army().update?.status().then(setU).catch(() => {});
    return army().on("update", (v: Update) => setU(v));
  }, []);
  if (!u?.ready) return null;
  return <button type="button" className="rail-item rail-update" aria-label={`Update to ${u.available}`} title={`Dispatch ${u.available} is ready (you have ${u.current})`} onClick={async () => {
    const ok = await ask.confirm(`Update to Dispatch ${u.available}?`, { description: "Dispatch restarts to install it. Running agents stop and resume afterwards; your chats, templates and settings stay.", action: "Restart and update" });
    if (ok) await army().update.install();
  }}><ArrowDownTrayIcon aria-hidden="true" /><span>Update</span></button>;
}
