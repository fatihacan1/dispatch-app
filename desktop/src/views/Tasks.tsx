import { useEffect, useState } from "react";
import type { TaskCard } from "../lib/types";

// Task board: work a lead handed an agent, one card per task. Cards come from the main process (electron/tasks.cjs).
const COLUMNS: { id: string; label: string; statuses: TaskCard["status"][]; empty: string }[] = [
  { id: "working", label: "Working", statuses: ["working"], empty: "No agent is on a task." },
  { id: "waiting", label: "Waiting", statuses: ["waiting"], empty: "Nobody is waiting for you." },
  { id: "stalled", label: "Stalled", statuses: ["stalled"], empty: "No stalled agents." },
  { id: "done", label: "Done", statuses: ["done", "stopped"], empty: "Finished tasks show up here." },
];
const DONE_SHOWN = 60;

export function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Waiting + stalled: what the nav badge counts. */
export const needsLook = (tasks: TaskCard[]) => tasks.filter(t => t.status === "waiting" || t.status === "stalled").length;

export function Tasks({ tasks, openAgent }: { tasks: TaskCard[]; openAgent: (name: string) => void }) {
  const [now, setNow] = useState(Date.now());
  const live = tasks.some(t => !t.endedAt);
  useEffect(() => { if (!live) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [live]);
  return (
    <div className="page prov-page tasks-page">
      <div className="view-heading"><h1>Tasks</h1></div>
      <p className="page-lead tasks-lead">Work the boss and team leads handed out. A card moves to Done when the agent reports back to its lead.</p>
      <div className="task-board">
        {COLUMNS.map(col => {
          let cards = tasks.filter(t => col.statuses.includes(t.status));
          cards = col.id === "done" ? cards.sort((a, b) => (b.endedAt || "").localeCompare(a.endedAt || "")).slice(0, DONE_SHOWN) : cards.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
          const total = tasks.filter(t => col.statuses.includes(t.status)).length;
          return (
            <section className={"task-col task-col-" + col.id} key={col.id} aria-label={col.label}>
              <h2 className="task-col-head"><span className="label">{col.label}</span><span className="task-col-count">{total}</span></h2>
              <div className="task-list">
                {cards.length ? cards.map(t => {
                  const end = t.endedAt ? Date.parse(t.endedAt) : now;
                  const note = t.status === "waiting" ? t.waitReason : t.status === "stalled" ? "No progress" : t.status === "stopped" ? t.reason || "Stopped" : t.reason;
                  return (
                    <button type="button" key={t.id} className={"task-card task-" + t.status} title={t.text} onClick={() => openAgent(t.agent)}>
                      <span className="task-top"><b>{t.agent}</b>{note && <span className="task-note">{note}</span>}<time className="task-time" dateTime={t.startedAt}>{elapsed(end - Date.parse(t.startedAt))}</time></span>
                      <span className="task-title">{t.title}</span>
                      <small className="task-lead">from {t.lead}</small>
                    </button>
                  );
                }) : <p className="task-empty">{col.empty}</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
