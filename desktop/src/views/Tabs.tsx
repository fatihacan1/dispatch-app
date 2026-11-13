import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FolderIcon, PlusIcon, XMarkIcon, PaperAirplaneIcon } from "@heroicons/react/16/solid";
import { ask } from "../components/ask";

type Tab = { id: number; name: string; path: string; active: boolean; running?: number; needs?: number; working?: number };
type State = { max: number; from: number | null; telegram: number | null; tabs: Tab[] };
const api = () => (window as any).army.tabs;

/** Project tabs in the top bar. Every tab is a project whose agents keep working while another tab is in front. */
export function ProjectTabs({ recent, onError }: { recent: string[]; onError: (e: string) => void }) {
  const [state, setState] = useState<State | null>(null);
  const [menu, setMenu] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const glider = useRef<HTMLSpanElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!api()) return;
    api().list().then(setState).catch(() => {});
    return (window as any).army.on("tabs", (s: State) => setState(s));
  }, []);
  // Ctrl+Tab / Ctrl+Shift+Tab, like a browser.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.ctrlKey && e.key === "Tab") { e.preventDefault(); void api()?.step(e.shiftKey ? -1 : 1); } };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [menu]);
  // The pill behind the active tab glides to it. Arriving from another tab, it starts where that tab was.
  useLayoutEffect(() => {
    const g = glider.current, s = strip.current; if (!g || !s || !state) return;
    const items = s.querySelectorAll<HTMLElement>(".ptab");
    const i = state.tabs.findIndex(t => t.active), el = items[i]; if (!el) return;
    const place = (x: HTMLElement) => { g.style.transform = `translateX(${x.offsetLeft}px)`; g.style.width = `${x.offsetWidth}px`; };
    const from = state.from != null ? items[state.from] : null;
    if (from && from !== el) { g.style.transition = "none"; place(from); void g.offsetWidth; g.style.transition = ""; }
    place(el);
  }, [state]);
  if (!state) return null;
  const open = state.tabs;
  const full = open.length >= state.max;
  const closeTab = async (t: Tab) => {
    if ((t.running || 0) > 0 && !(await ask.confirm(`Close ${t.name}?`, { description: `Its ${t.running} ${t.running === 1 ? "agent stops" : "agents stop"}. Chats stay; open the folder again to continue where it left off.`, action: "Close tab", danger: true }))) return;
    try { await api().close(t.id); } catch (e) { onError(String(e)); }
  };
  const openFolder = async (folder?: string) => { setMenu(false); try { await api().open(folder); } catch (e) { onError(String(e)); } };
  const others = recent.filter(w => !open.some(t => t.path && t.path.toLowerCase() === w.toLowerCase())).slice(0, 8);
  return (
    <div className="ptabs" ref={wrap}>
      <div className="ptab-strip" ref={strip} role="tablist" aria-label="Projects">
        <span className="ptab-glider" ref={glider} aria-hidden="true" />
        {open.map(t => {
          const tone = t.needs ? "needs" : t.working ? "working" : t.running ? "running" : "idle";
          const label = t.needs ? `${t.needs} need you` : t.working ? `${t.working} working` : t.running ? `${t.running} running` : "No agents running";
          return (
            <div key={t.id} className={"ptab" + (t.active ? " active" : "")} title={`${t.path || t.name} · ${label}`}
              onMouseDown={e => { if (e.button === 1 && open.length > 1) { e.preventDefault(); void closeTab(t); } }}>
              <button type="button" role="tab" aria-selected={t.active} className="ptab-main" onClick={() => void api().switch(t.id)}>
                <span className={"ptab-dot " + tone} aria-label={label} />
                <span className="ptab-name">{t.name}</span>
                {state.telegram === t.id && open.length > 1 && <PaperAirplaneIcon className="ptab-tg" aria-label="Telegram messages without @name come here" />}
              </button>
              {open.length > 1 && <button type="button" className="ptab-close" aria-label={`Close ${t.name}`} onClick={() => void closeTab(t)}><XMarkIcon aria-hidden="true" /></button>}
            </div>
          );
        })}
      </div>
      <button type="button" className="ptab-add" aria-label="Open a project in a new tab" aria-expanded={menu} disabled={full} title={full ? `Up to ${state.max} projects can be open` : "Open a project in a new tab (Ctrl+Tab switches)"} onClick={() => setMenu(v => !v)}><PlusIcon aria-hidden="true" /></button>
      {menu && <div className="popover ptab-menu" role="menu">
        <button type="button" className="button menu-item" role="menuitem" onClick={() => void openFolder()}><FolderIcon aria-hidden="true" />Open folder…</button>
        {others.length > 0 && <div className="menu-sep" />}
        {others.map(w => <button type="button" key={w} className="button menu-item" role="menuitem" onClick={() => void openFolder(w)} title={w}><span className="menu-main">{w.split(/[\\/]/).pop()}</span><small>{w}</small></button>)}
      </div>}
    </div>
  );
}
