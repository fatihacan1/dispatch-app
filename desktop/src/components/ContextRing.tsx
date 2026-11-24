import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentContext } from "../lib/types";
import { resetIn } from "../lib/usage";
import { Button } from "./common";
import "../context.css";

const tokens = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 2).replace(/\.?0+$/, "")}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, "")}k` : String(n);
const exact = (n: number) => n.toLocaleString("en-US");
const span = (ms: number) => { const m = Math.round(ms / 60000); return m < 1 ? `${Math.round(ms / 1000)} s` : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const level = (p: number | null) => p === null ? "none" : p >= 85 ? "high" : p >= 65 ? "mid" : "low";

/** The agent's context window as a ring in the chat header; a click opens every number its CLI reports. */
export function ContextRing({ name, context, model, canCompact, busy, onError }: { name: string; context?: AgentContext; model: string; canCompact: boolean; busy: boolean; onError: (e: string) => void }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [compacting, setCompacting] = useState(false);
  useEffect(() => setAt(null), [name]);
  useEffect(() => {
    if (!at) return;
    const away = (e: MouseEvent) => { const t = e.target as Node; if (!panel.current?.contains(t) && !button.current?.contains(t)) setAt(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setAt(null); button.current?.focus(); } };
    const gone = () => setAt(null);
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc); window.addEventListener("resize", gone);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); window.removeEventListener("resize", gone); };
  }, [at]);
  // The header can sit low in the window (a tall scene above it): the panel moves up until all of it shows.
  useLayoutEffect(() => {
    const el = panel.current; if (!at || !el) return;
    const top = Math.max(52, Math.min(at.y, window.innerHeight - el.offsetHeight - 12));
    if (top !== at.y) setAt({ ...at, y: top });
  }, [at, context]);
  const toggle = () => { if (at) { setAt(null); return; } const r = button.current!.getBoundingClientRect(); setAt({ x: Math.max(8, Math.min(r.right - 320, window.innerWidth - 328)), y: r.bottom + 6 }); };
  const compact = async () => { setCompacting(true); try { await window.army.context.compact(name); setAt(null); } catch (e) { onError(String(e).replace(/^Error: Error invoking remote method '[^']+': (Error: )?/, "")); } finally { setCompacting(false); } };
  const c = context, p = c?.percent ?? null, R = 8, L = 2 * Math.PI * R;
  const label = !c ? "Context: nothing reported yet" : p === null ? `Context: ${tokens(c.used)} tokens` : `Context: ${Math.round(p)}% of ${tokens(c.window!)} used`;
  const part = (n: number) => c?.window ? `${Math.max(n ? 0.6 : 0, n / c.window * 100)}%` : `${c && c.used ? n / c.used * 100 : 0}%`;
  return <>
    <button type="button" ref={button} className={`ctx-ring ${level(p)}`} aria-label={label} aria-expanded={!!at} title={label} onClick={toggle}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r={R} /><circle className="ctx-fill" cx="10" cy="10" r={R} strokeDasharray={L} strokeDashoffset={L * (1 - Math.min(100, p ?? 0) / 100)} transform="rotate(-90 10 10)" /></svg>
      <span>{!c ? "–" : p === null ? tokens(c.used) : `${Math.round(p)}%`}</span>
    </button>
    {at && createPortal(<div className="ctx-panel" ref={panel} role="dialog" aria-label={`Context of ${name}`} style={{ left: at.x, top: at.y }}>
      <div className="ctx-head"><b>Context</b><small>{c?.modelName || c?.model || model}{c?.effort ? `, ${c.effort} effort` : ""}</small></div>
      {!c ? <p className="ctx-note">Nothing yet. The numbers show up after the first reply, for CLIs that report them.</p> : <>
        <p className="ctx-big"><b>{exact(c.used)}</b>{c.window ? <> of {exact(c.window)} tokens</> : " tokens"}{p !== null && <span className={level(p)}>{p < 10 ? p.toFixed(1) : Math.round(p)}%</span>}</p>
        <div className={`ctx-bar ${level(p)}`} role="progressbar" aria-label="Context used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p ?? 0)}>
          <i className="cached" style={{ width: part(Math.min(c.cached, c.used)) }} /><i className="fresh" style={{ width: part(Math.max(0, c.used - c.cached)) }} />
        </div>
        <dl className="ctx-list">
          <div><dt><i className="key cached" aria-hidden="true" />From cache</dt><dd>{exact(Math.min(c.cached, c.used))}</dd></div>
          <div><dt><i className="key fresh" aria-hidden="true" />New input</dt><dd>{exact(Math.max(0, c.used - c.cached))}</dd></div>
          {c.window && <div><dt><i className="key" aria-hidden="true" />Free</dt><dd>{exact(Math.max(0, c.window - c.used))}</dd></div>}
          <div><dt>Last reply</dt><dd>{exact(c.output)} out</dd></div>
          {typeof c.cacheHit === "number" && <div><dt>Cache hits</dt><dd>{c.cacheHit}%{c.cacheUntil && +new Date(c.cacheUntil) > Date.now() ? `, warm for ${resetIn(c.cacheUntil, Date.now())}` : ""}</dd></div>}
          {c.session && (c.session.input > 0 || c.session.output > 0) && <div><dt>Session</dt><dd>{tokens(c.session.input)} in, {tokens(c.session.output)} out</dd></div>}
          {!!c.cost && <div><dt>Session cost (API price)</dt><dd>${c.cost.toFixed(2)}</dd></div>}
          {!!c.durationMs && <div><dt>Session time</dt><dd>{span(c.durationMs)}{c.apiMs ? `, model ${span(c.apiMs)}` : ""}</dd></div>}
          {!!(c.linesAdded || c.linesRemoved) && <div><dt>Lines changed</dt><dd>+{exact(c.linesAdded || 0)} −{exact(c.linesRemoved || 0)}</dd></div>}
        </dl>
        {!!c.limits?.length && <div className="ctx-limits">{c.limits.map(l => <div key={l.label}>
          <div className="ctx-limit-head"><span>{l.label}</span><b>{l.usedPercent}%</b></div>
          <div className={`ctx-bar thin ${level(l.usedPercent)}`} role="progressbar" aria-label={l.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={l.usedPercent}><i className="fresh" style={{ width: `${l.usedPercent}%` }} /></div>
          {l.resetsAt && <small>resets in {resetIn(l.resetsAt, Date.now())}</small>}
        </div>)}</div>}
        {c.guessed && <p className="ctx-note">The size of the window is assumed; this CLI did not report it.</p>}
        {canCompact && <div className="ctx-foot"><Button className="secondary" disabled={busy || compacting} title={busy ? "Available when the agent is idle" : "Shortens the conversation with the CLI's own /compact"} onClick={() => void compact()}>Compact conversation</Button></div>}
      </>}
    </div>, document.body)}
  </>;
}
