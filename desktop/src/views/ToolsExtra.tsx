import { useEffect, useState } from "react";
import telegramSvg from "../../public/tools/telegram.svg?raw";
import { ArrowTopRightOnSquareIcon, CheckIcon, ClockIcon, PauseIcon, PlayIcon, TrashIcon, BoltIcon } from "@heroicons/react/16/solid";
import { Button, StatusDot } from "../components/common";
import { ask } from "../components/ask";

const army = () => (window as any).army;
const clean = (e: unknown) => String(e).replace(/^Error: Error invoking remote method '[^']+': (Error: )?/, "");

type Schedule = { id: string; title: string; why: string; task: string; to: string; by: string; when: string; next: number; lastNote: string; status: "active" | "paused" | "pending" | "done"; runs: number };
const until = (t: number) => {
  const s = Math.round((t - Date.now()) / 1000);
  if (s <= 60) return "in a minute";
  if (s < 3600) return `in ${Math.round(s / 60)} min`;
  if (s < 86400) return `in ${Math.round(s / 3600)} h`;
  return new Date(t).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

/** Tools > Schedules: everything the boss and team leads scheduled, with run now / pause / approve / delete. */
export function ScheduleTool() {
  const [items, setItems] = useState<Schedule[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const load = () => army().schedules?.list().then(setItems).catch(() => {});
    void load();
    const off = army().on("schedules", (v: Schedule[]) => setItems(v));
    const t = window.setInterval(load, 30000);
    return () => { off(); clearInterval(t); };
  }, []);
  const live = items.filter(s => s.status !== "done");
  const pending = live.filter(s => s.status === "pending").length;
  const next = live.filter(s => s.status === "active" && s.next).sort((a, b) => a.next - b.next)[0];
  const act = async (fn: () => Promise<Schedule[]>) => { setError(""); try { setItems(await fn()); } catch (e) { setError(clean(e)); } };
  return <>
    <div className="prov-row">
      <span className="prov-icon tool-glyph"><ClockIcon aria-hidden="true" /></span>
      <div className="prov-main">
        <div className="prov-title"><b>Schedules</b><StatusDot tone={live.length ? "working" : "idle"} label={live.length ? `${live.length} active${pending ? `, ${pending} waiting` : ""}` : "None yet"} /></div>
        <small>{next ? `Next: ${next.title} ${until(next.next)}, to ${next.to}` : "Recurring and timed work. Ask the boss, e.g. \"every morning at 9 make a summary and send it to Telegram\"."}</small>
        <small>The boss creates schedules by itself; team leads' schedules wait for approval. Missed runs (Dispatch closed) run once when it opens.</small>
      </div>
      <div className="prov-actions">{live.length > 0 && <Button className="secondary" onClick={() => setOpen(!open)}>{open ? "Hide" : "Manage"}</Button>}</div>
    </div>
    {open && live.length > 0 && <div className="tool-sched-list">
      {live.map(s => <article className="sched-card" key={s.id}>
        <div className="sched-title"><b>{s.title}</b>{s.status !== "active" && <span className={"mem-pin" + (s.status === "pending" ? " sched-pending" : "")}>{s.status === "pending" ? "Waits for approval" : "Paused"}</span>}</div>
        <p>{s.why}</p>
        <small className="sched-when">{s.when}{s.status === "active" && s.next ? ` · next ${until(s.next)}` : ""} · to {s.to}{s.by !== s.to ? `, set by ${s.by}` : ""} · ran {s.runs}×</small>
        <small className="sched-last">Task: {s.task}</small>
        {s.lastNote && <small className="sched-last">Last: {s.lastNote}</small>}
        <div className="sched-actions">
          {s.status === "pending" && <button type="button" className="icon-button" title="Approve" aria-label={`Approve ${s.title}`} onClick={() => void act(() => army().schedules.status(s.id, "active"))}><CheckIcon /></button>}
          {s.status !== "pending" && <button type="button" className="icon-button" title="Run now" aria-label={`Run ${s.title} now`} onClick={() => void act(() => army().schedules.runNow(s.id))}><BoltIcon /></button>}
          {s.status === "active" && <button type="button" className="icon-button" title="Pause" aria-label={`Pause ${s.title}`} onClick={() => void act(() => army().schedules.status(s.id, "paused"))}><PauseIcon /></button>}
          {s.status === "paused" && <button type="button" className="icon-button" title="Resume" aria-label={`Resume ${s.title}`} onClick={() => void act(() => army().schedules.status(s.id, "active"))}><PlayIcon /></button>}
          <button type="button" className="icon-button danger" title="Delete" aria-label={`Delete ${s.title}`} onClick={async () => { if (await ask.confirm(`Delete "${s.title}"?`, { description: "It will not run again.", action: "Delete", danger: true })) void act(() => army().schedules.remove(s.id)); }}><TrashIcon /></button>
        </div>
      </article>)}
      {error && <p className="tpl-error">{error}</p>}
    </div>}
  </>;
}

type Tg = { configured: boolean; bot: { username: string; name: string } | null; linked: boolean; chatName: string; polling: boolean; error: string };

/** Tools > Telegram: BotFather in one click, paste the token, tap Start in the bot. */
export function TelegramTool() {
  const [s, setS] = useState<Tg | null>(null);
  const [token, setToken] = useState("");
  const [fromClipboard, setFromClipboard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const peek = async () => { const t = await army().telegram.clipboardToken().catch(() => null); if (t) { setToken(v => v || t); setFromClipboard(true); } };
  useEffect(() => {
    army().telegram.status().then(setS).catch(() => {});
    const off = army().on("telegram", (v: Tg) => { setS(v); if (v.linked) setWaiting(false); });
    // Coming back from Telegram with the token copied: fill it in.
    const onFocus = () => { void peek(); };
    window.addEventListener("focus", onFocus); void peek();
    return () => { off(); window.removeEventListener("focus", onFocus); };
  }, []);
  const run = async (fn: () => Promise<any>) => { setBusy(true); setError(""); setNote(""); try { const r = await fn(); if (r && typeof r === "object" && "configured" in r) setS(r); } catch (e) { setError(clean(e)); } finally { setBusy(false); } };
  const label = !s ? "Checking…" : s.linked ? (s.error ? "Offline" : "Connected") : s.configured ? "Waiting for your chat" : "Not connected";
  return <div className="prov-row tool-tg">
    <span className="prov-icon tool-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: telegramSvg.replace("<svg", '<svg fill="currentColor"') }} />
    <div className="prov-main">
      <div className="prov-title"><b>Telegram</b><StatusDot tone={s?.linked && !s.error ? "working" : "idle"} label={label} /></div>
      {!s?.configured && <>
        <small>Talk to the boss from your phone, and get schedule results and "needs you" notices there. Works while Dispatch runs; no server.</small>
        <ol className="tg-steps">
          <li>Open BotFather, send <b>/newbot</b>, pick a name. It replies with a token.</li>
          <li>Copy the token and come back. Dispatch fills it in.</li>
        </ol>
        <div className="tg-token">
          <input type="password" placeholder="Bot token, 123456789:AA…" value={token} onChange={e => { setToken(e.target.value); setFromClipboard(false); }} onKeyDown={e => { if (e.key === "Enter" && token) void run(() => army().telegram.setToken(token)); }} aria-label="Bot token" />
          <Button className="primary" disabled={busy || !token} onClick={() => run(() => army().telegram.setToken(token))}>Connect</Button>
        </div>
        {fromClipboard && token && <small>Token found on the clipboard.</small>}
      </>}
      {s?.configured && !s.linked && <>
        <small>Bot @{s.bot?.username} is ready. Press Link chat, then <b>Start</b> in Telegram. Only that chat can talk to your boss.</small>
        {waiting && <small>Waiting for Start in Telegram…</small>}
      </>}
      {s?.linked && <>
        <small>@{s.bot?.username} · chat with {s.chatName || "you"}. Messages there go to the boss and its answers come back.</small>
        <small>The boss can also send files and schedule results with dispatch telegram send.</small>
      </>}
      {s?.error && <small className="tpl-error">{s.error}</small>}
      {note && <small>{note}</small>}
      {error && <small className="tpl-error">{error}</small>}
    </div>
    <div className="prov-actions">
      {!s?.configured && <Button className="primary" onClick={() => void army().telegram.botfather()}><ArrowTopRightOnSquareIcon aria-hidden="true" />Open BotFather</Button>}
      {s?.configured && !s.linked && <Button className="primary" disabled={busy} onClick={() => run(async () => { await army().telegram.link(); setWaiting(true); })}><ArrowTopRightOnSquareIcon aria-hidden="true" />Link chat</Button>}
      {s?.linked && <Button className="secondary" disabled={busy} onClick={() => run(async () => { await army().telegram.test(); setNote("Test sent. Check Telegram."); })}>Send test</Button>}
      {s?.linked && <Button className="ghost" disabled={busy} onClick={() => run(() => army().telegram.unlink())}>Unlink chat</Button>}
      {s?.configured && <Button className="danger-ghost" disabled={busy} onClick={async () => { if (await ask.confirm("Remove the Telegram bot?", { description: "Dispatch forgets the token. The bot itself stays in Telegram; delete it in BotFather if you want.", action: "Remove", danger: true })) void run(() => army().telegram.disconnect()); }}>Remove</Button>}
    </div>
  </div>;
}
