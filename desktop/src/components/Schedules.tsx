import { useEffect, useRef, useState } from "react";
import { ClockIcon, PauseIcon, PlayIcon, TrashIcon, CheckIcon } from "@heroicons/react/16/solid";
import { ask } from "./ask";

type Schedule = { id: string; title: string; why: string; task: string; to: string; by: string; when: string; next: number; last: number; lastNote: string; status: "active" | "paused" | "pending" | "done"; runs: number };

const army = () => (window as any).army;
const until = (t: number) => {
  if (!t) return "";
  const s = Math.round((t - Date.now()) / 1000);
  if (s <= 60) return "in a minute";
  if (s < 3600) return `in ${Math.round(s / 60)} min`;
  if (s < 86400) return `in ${Math.round(s / 3600)} h`;
  return new Date(t).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
const STATUS: Record<string, string> = { pending: "Waits for approval", paused: "Paused", done: "Done" };

/** Small clock in the title bar: what the boss and team leads scheduled. Hover or click for the cards. */
export function Schedules() {
  const [items, setItems] = useState<Schedule[]>([]);
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  const close = useRef<number | undefined>(undefined);
  useEffect(() => {
    const load = () => army().schedules?.list().then(setItems).catch(() => {});
    void load();
    const off = army().on("schedules", (v: Schedule[]) => setItems(v));
    const timer = window.setInterval(() => { tick(n => n + 1); void load(); }, 60000);
    return () => { off(); clearInterval(timer); };
  }, []);
  const live = items.filter(s => s.status !== "done");
  if (!live.length) return null;
  const pending = live.filter(s => s.status === "pending").length;
  const act = async (fn: () => Promise<Schedule[]>) => { try { setItems(await fn()); } catch {} };
  const show = () => { clearTimeout(close.current); setOpen(true); };
  const hide = () => { close.current = window.setTimeout(() => setOpen(false), 250); };
  return <div className="sched" onMouseEnter={show} onMouseLeave={hide}>
    <button type="button" className={"sched-trigger" + (pending ? " needs" : "")} aria-label={`${live.length} schedules${pending ? `, ${pending} waiting for approval` : ""}`} aria-expanded={open} onClick={() => setOpen(!open)} onFocus={show}>
      <ClockIcon aria-hidden="true" /><span>{live.length}</span>
    </button>
    {open && <div className="popover sched-pop" role="dialog" aria-label="Schedules">
      <p className="sched-head">Schedules <small>Set by the boss and team leads</small></p>
      {live.map(s => <article className="sched-card" key={s.id}>
        <div className="sched-title"><b>{s.title}</b>{STATUS[s.status] && <span className={"mem-pin" + (s.status === "pending" ? " sched-pending" : "")}>{STATUS[s.status]}</span>}</div>
        <p>{s.why}</p>
        <small className="sched-when">{s.when}{s.status === "active" && s.next ? ` · next ${until(s.next)}` : ""} · to {s.to}{s.by !== s.to ? `, set by ${s.by}` : ""}</small>
        {s.lastNote && <small className="sched-last">Last: {s.lastNote}</small>}
        <div className="sched-actions">
          {s.status === "pending" && <button type="button" className="icon-button" title="Approve" aria-label={`Approve ${s.title}`} onClick={() => void act(() => army().schedules.status(s.id, "active"))}><CheckIcon /></button>}
          {s.status === "active" && <button type="button" className="icon-button" title="Pause" aria-label={`Pause ${s.title}`} onClick={() => void act(() => army().schedules.status(s.id, "paused"))}><PauseIcon /></button>}
          {s.status === "paused" && <button type="button" className="icon-button" title="Resume" aria-label={`Resume ${s.title}`} onClick={() => void act(() => army().schedules.status(s.id, "active"))}><PlayIcon /></button>}
          <button type="button" className="icon-button danger" title="Delete" aria-label={`Delete ${s.title}`} onClick={async () => { if (await ask.confirm(`Delete "${s.title}"?`, { description: "It will not run again.", action: "Delete", danger: true })) void act(() => army().schedules.remove(s.id)); }}><TrashIcon /></button>
        </div>
      </article>)}
      <p className="sched-note">Schedules run CLI agents on their own, with nobody at the keyboard. Check your providers' terms (Anthropic, OpenAI, Google): for unattended runs they may expect an API key rather than a personal subscription sign-in. Which one you use is up to you.</p>
    </div>}
  </div>;
}
