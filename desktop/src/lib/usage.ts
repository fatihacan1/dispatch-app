import { useCallback, useEffect, useState } from "react";

export type UsageWindow = { id: string; label: string; usedPercent: number; resetsAt: string | null; windowMinutes?: number; note?: string };
export type ProviderUsage = { provider: string; plan?: string; windows: UsageWindow[]; updatedAt: string; source: string; error?: string; errorCode?: string; stale?: boolean };
export type UsageMap = Record<string, ProviderUsage>;
export type Level = "ok" | "warn" | "crit";

export const remaining = (w: UsageWindow) => Math.max(0, Math.min(100, Math.round(100 - w.usedPercent)));
/** The most constraining window: the one with the least capacity left. */
/** A window whose reset time has passed is empty again, even before the next reading arrives. */
export const live = (w: UsageWindow, now = Date.now()): UsageWindow => (w.resetsAt && Date.parse(w.resetsAt) <= now ? { ...w, usedPercent: 0, resetsAt: null, note: "window reset since the last reading" } : w);
export const tightest = (u?: ProviderUsage) => (u?.windows || []).reduce<UsageWindow | null>((a, w) => (!a || w.usedPercent > a.usedPercent ? w : a), null);
export const levelOf = (left: number): Level => (left < 10 ? "crit" : left < 25 ? "warn" : "ok");

/** "3 h 12 m", "2 d 4 h", "now". */
export function resetIn(iso: string | null, now = Date.now()) {
  if (!iso) return "";
  const ms = Date.parse(iso) - now; if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "now";
  const m = Math.round(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  if (d) return `${d} d ${h} h`;
  return h ? `${h} h ${m % 60} m` : `${m} m`;
}
export function resetClock(iso: string | null, now = Date.now()) {
  if (!iso) return "";
  const t = Date.parse(iso); if (!Number.isFinite(t)) return "";
  const sameDay = new Date(t).toDateString() === new Date(now).toDateString();
  return new Date(t).toLocaleString([], sameDay ? { hour: "2-digit", minute: "2-digit" } : { weekday: "short", hour: "2-digit", minute: "2-digit" });
}
export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
}

/** Usage for all enabled providers; refreshes on demand and when the main process pushes an update. */
export function useUsage() {
  const [usage, setUsage] = useState<UsageMap>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(Date.now());
  const api = () => (window as any).army?.usage;
  useEffect(() => {
    let on = true;
    api()?.get().then((u: UsageMap) => on && setUsage(u)).catch(() => {});
    const off = (window as any).army?.on?.("usage:update", (u: UsageMap) => setUsage(prev => ({ ...prev, ...u })));
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => { on = false; off?.(); clearInterval(tick); };
  }, []);
  const refresh = useCallback(async (id?: string) => {
    const key = id || "*"; setLoading(l => ({ ...l, [key]: true }));
    try { const u = await api()?.refresh(id); if (u) setUsage(prev => ({ ...prev, ...u })); } catch {} finally { setLoading(l => ({ ...l, [key]: false })); }
  }, []);
  return { usage, loading, refresh, now };
}
