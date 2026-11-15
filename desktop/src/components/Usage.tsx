import React, { useEffect, useState } from "react";
import { ProviderIcon } from "./common";
import { ago, levelOf, live, remaining, resetClock, resetIn, tightest, useUsage, type ProviderUsage, type UsageMap } from "../lib/usage";
import "../usage.css";

const NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity" };

/** Compact chips for the sidebar: provider icon + remaining % of the tightest window; hover shows every window. */
export function UsageChips({ open }: { open: (provider: string) => void }) {
  const { usage, now } = useUsage();
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const items = Object.values(usage).filter(u => u.windows.length).map(u => ({ ...u, windows: u.windows.map(w => live(w, now)) }));
  if (!items.length) return null;
  const show = (id: string, el: HTMLElement) => { const r = el.getBoundingClientRect(); setTip({ id, x: Math.max(8, Math.min(r.left, window.innerWidth - 268)), y: r.bottom + 6 }); };
  const shown = tip && items.find(u => u.provider === tip.id);
  return <div className="usage-bar" role="group" aria-label="Usage limits" onMouseLeave={() => setTip(null)}>
    {items.map(u => {
      // Same number as the tooltip: % used of the tightest window.
      const w = tightest(u)!; const left = remaining(w), used = Math.round(w.usedPercent);
      return <button type="button" key={u.provider} className={`usage-chip ${levelOf(left)}${u.stale ? " stale" : ""}`} data-provider={u.provider}
        aria-label={`${NAMES[u.provider] || u.provider}: ${used}% used, ${w.label}. Open in Providers`} title={`${w.label}: ${used}% used`}
        onMouseEnter={e => show(u.provider, e.currentTarget)} onFocus={e => show(u.provider, e.currentTarget)} onBlur={() => setTip(null)} onClick={() => open(u.provider)}>
        <ProviderIcon className="usage-icon" provider={u.provider} alt="" /><span>{used}%</span>
      </button>;
    })}
    {tip && shown && <div className="usage-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
      <div className="usage-tip-title"><b>{NAMES[shown.provider] || shown.provider}</b>{shown.plan && <span className="tag">{shown.plan}</span>}</div>
      {shown.windows.map(w => <div className="usage-tip-row" key={w.id}>
        <span>{w.label}</span><b>{w.usedPercent}% used</b>
        <small>{w.resetsAt ? `resets in ${resetIn(w.resetsAt, now)}` : "no reset time"}</small>
      </div>)}
      {shown.stale && <small className="usage-warn">Last reading kept: {shown.error}</small>}
    </div>}
  </div>;
}

/** Full detail for the Providers view: every window with a progress bar, reset time, source and refresh. */
export function UsageDetails({ u, now, loading, refresh, manual }: { u?: ProviderUsage; now: number; loading?: boolean; refresh: () => void; manual?: boolean }) {
  return <div className="usage-details">
    {manual && <div className="usage-details-head">
      <b>Antigravity limits</b>
      {u?.errorCode !== "off" && <button type="button" className="button secondary usage-refresh" disabled={loading} onClick={refresh} title="Read the Antigravity limit now. It costs one model turn.">{loading ? "Refreshing…" : "Refresh"}</button>}
    </div>}
    {!u ? <p className="usage-note">Loading usage…</p> : <>
      {u.error && <p className="usage-note usage-error" role="status">{u.error}</p>}
      {u.windows.map(raw => {
        const w = live(raw, now), left = remaining(w);
        return <div className="usage-win" key={w.id}>
          <div className="usage-win-head"><b>{w.label}</b><span>{w.usedPercent}% used · {left}% left</span></div>
          <div className={`usage-meter ${levelOf(left)}`} role="progressbar" aria-label={`${w.label} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w.usedPercent)}><i style={{ width: `${Math.min(100, w.usedPercent)}%` }} /></div>
          <small>{w.resetsAt ? `Resets in ${resetIn(w.resetsAt, now)} · ${resetClock(w.resetsAt, now)}` : w.note || "No reset time reported"}</small>
        </div>;
      })}
      <div className="usage-foot"><small>{u.windows.length ? `${u.plan ? `Plan ${u.plan} · ` : ""}Source: ${u.source} · updated ${ago(u.updatedAt, now)}${manual ? " · refreshes only when you press Refresh" : ""}` : ""}</small>
        {!manual && <button type="button" className="button secondary" disabled={loading} onClick={refresh}>{loading ? "Refreshing…" : "Refresh"}</button>}</div>
    </>}
  </div>;
}
/** Home: live usage is off until the user turns it on (for Claude it uses the Claude Code sign-in to ask Anthropic). */
export function UsageSwitch() {
  const [on, setOn] = useState<boolean | null>(null);
  const army = () => (window as any).army;
  useEffect(() => { army()?.ui?.get().then((u: any) => setOn(u?.usageTracking === true)).catch(() => setOn(false)); }, []);
  if (on === null) return null;
  const flip = async (next: boolean) => {
    setOn(next);
    try { await army().ui.set({ usageTracking: next }); await army().usage?.refresh(); } catch { setOn(!next); }
  };
  return <label className="usage-switch">
    <span className="usage-switch-text"><b>Track my live usage</b><small>Show the session and weekly limits left on Claude Code and Codex. Antigravity's limit is read only when you press Refresh in its section, because reading it spends one model turn. For Claude, Dispatch asks Anthropic with your Claude Code sign-in. Off until you turn it on.</small>
      <span className="usage-preview" aria-hidden="true" title="Example: how the limits show next to your agents">
        {([["claude", 38, "ok"], ["codex", 78, "warn"], ["antigravity", 12, "ok"]] as const).map(([id, used, lvl]) => <span key={id} className={`usage-chip ${lvl}`}><ProviderIcon className="usage-icon" provider={id} alt="" /><span>{used}%</span></span>)}
        <small>Example</small>
      </span></span>
    <input type="checkbox" role="switch" aria-checked={on} checked={on} onChange={e => void flip(e.target.checked)} />
  </label>;
}
export type { UsageMap };
