import React, { useState } from "react";
import { BookmarkIcon, ChevronRightIcon, CommandLineIcon, EllipsisHorizontalIcon, PlusIcon } from "@heroicons/react/16/solid";
import { Button, ProviderIcon, StatusDot, type Tone } from "../components/common";
import type { Message } from "../lib/types";
import { UsageChips } from "../components/Usage";
import { TelegramMark, useTelegramOwner } from "./ToolsExtra";

export type AgentInfo = { name: string; provider: string; model: string; template?: string; enlistedBy?: string; tone: Tone; status: string };
type Props = {
  agents: AgentInfo[];
  selected: string;
  activeView: boolean;
  menu: string | null;
  setMenu: (name: string | null) => void;
  select: (name: string) => void;
  act: (name: string, action: string) => void;
  openTerminal: (name: string) => void;
  changeBoss: () => void;
  enlist: () => void;
  saveTeam?: () => void;
  files: { path: string; add: number; del: number }[] | null;
  openFile?: (path: string) => void;
  shells?: { name: string; title: string; cwd: string; exited: boolean }[];
  openShell?: (name?: string) => void;
  feed: (Message & { time?: number })[];
  color: (name: string) => string;
  outputs: Output[];
  openProvider?: (provider: string) => void;
};
export type Output = { key: string; kind: "file" | "model" | "download" | "job"; tool: string; agent?: string; time: number; file?: string; files?: string[]; size?: number; bytes?: number; total?: number; done?: boolean; status?: string };
const bytes = (n = 0) => n > 1e9 ? (n / 1e9).toFixed(2) + " GB" : n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : n > 1e3 ? Math.round(n / 1e3) + " KB" : n + " B";
const base = (f = "") => f.split(/[\\/]/).pop() || f;
const IMG = /\.(png|jpe?g|webp|gif)$/i;
function Thumb({ file }: { file: string }) {
  const [src, setSrc] = useState("");
  React.useEffect(() => { let on = true; if (IMG.test(file)) (window as any).army.outputs?.preview(file).then((v: string | null) => { if (on && v) setSrc(v); }).catch(() => {}); return () => { on = false; }; }, [file]);
  return src ? <img className="out-thumb" src={src} alt="" /> : <span className="out-thumb out-ext">{(file.split(".").pop() || "").slice(0, 4)}</span>;
}
// Live progress and preview frames of running ComfyUI jobs (main process listens to ComfyUI; see electron/comfy-live.cjs).
type Live = { value?: number; max?: number; preview?: string; done?: boolean };
const liveJobs = new Map<string, Live>(), liveSubs = new Set<() => void>();
let liveOff: (() => void) | null = null;
function useComfyLive(id?: string) {
  const [, force] = useState(0);
  React.useEffect(() => {
    if (!id) return;
    if (!liveOff) liveOff = (window as any).army?.on?.("comfy:live", (e: Live & { id: string }) => { liveJobs.set(e.id, { ...liveJobs.get(e.id), ...e }); liveSubs.forEach(f => f()); }) || null;
    const f = () => force(n => n + 1); liveSubs.add(f); return () => { liveSubs.delete(f); };
  }, [id]);
  return id ? liveJobs.get(id) : undefined;
}
function RunningJob({ o, who }: { o: Output; who: React.ReactNode }) {
  const live = useComfyLive(o.key.slice(4));
  const [open, setOpen] = useState(false);
  const pct = live?.max ? Math.min(100, Math.round((live.value || 0) / live.max * 100)) : null;
  if (live?.done) return <li className="out-row"><span className="out-thumb out-live">{live.preview && <img src={live.preview} alt="" />}</span><span className="row-text"><b>Workflow finished</b><small>{who} · ComfyUI · saving files</small></span></li>;
  const toggle = () => setOpen(v => !v);
  return <>
    <li className="out-row out-running" role="button" tabIndex={0} aria-expanded={open} aria-label="Running ComfyUI workflow, show the live preview" onClick={toggle} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}>
      <span className="out-thumb out-live">{live?.preview && <img src={live.preview} alt="" />}<span className="out-spin" aria-hidden="true" /></span>
      <span className="row-text"><b>Workflow running{pct != null ? ` · ${pct}%` : ""}</b><small>{who} · ComfyUI{live?.max ? ` · step ${live.value || 0} of ${live.max}` : ""}</small>{pct != null && <span className="progress"><i style={{ width: pct + "%" }} /></span>}</span>
    </li>
    {open && <li className="out-live-big">{live?.preview ? <img src={live.preview} alt="Live preview of the running workflow" /> : <p className="empty-line">No preview yet. ComfyUI sends one while it samples, if previews are on in its settings.</p>}</li>}
  </>;
}
function OutputRow({ o, color }: { o: Output; color: (n: string) => string }) {
  const target = o.kind === "job" ? o.files?.[0] : o.file;
  const reveal = { role: "button", tabIndex: 0, "aria-label": `Show ${base(target) || "outputs"} in folder`, onClick: () => (window as any).army.outputs.reveal(target), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (window as any).army.outputs.reveal(target); } } };
  const who = o.agent ? <b className={`who c-${color(o.agent)}`}>{o.agent}</b> : <b className="who">{o.tool === "comfyui" ? "ComfyUI" : o.tool}</b>;
  if (o.kind === "download") {
    const pct = o.total ? Math.min(100, Math.round((o.bytes || 0) / o.total * 100)) : 0;
    return <li className="out-row" title={o.file} {...reveal}><span className="out-thumb out-ext">{o.done ? "✓" : pct + "%"}</span><span className="row-text"><b>{base(o.file)}</b><small>{who} · {o.done ? `model downloaded · ${bytes(o.total)}` : `downloading ${bytes(o.bytes)} of ${o.total ? bytes(o.total) : "?"}`}</small>{!o.done && <span className="progress"><i style={{ width: pct + "%" }} /></span>}</span></li>;
  }
  if (o.kind === "job" && o.status === "queued") return <RunningJob o={o} who={who} />;
  if (o.kind === "job") return <li className="out-row" {...reveal}><span className="out-thumb out-ext">{o.status === "queued" ? "…" : o.status === "success" ? "✓" : "!"}</span><span className="row-text"><b>{o.status === "queued" ? "Workflow running" : o.status === "success" ? `Workflow finished · ${o.files?.length || 0} files` : `Workflow ${o.status}`}</b><small>{who} · ComfyUI</small></span></li>;
  return <li className="out-row" title={o.file} {...reveal}><Thumb file={o.file || ""} /><span className="row-text"><b>{base(o.file)}</b><small>{who} · {o.kind === "model" ? "new model" : "generated"}{o.size ? ` · ${bytes(o.size)}` : ""}</small></span></li>;
}

function Section({ title, meta, action, children, defaultOpen = true }: { title: string; meta?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return <section className={"side-section " + (open ? "open" : "")}>
    <div className="side-head">
      <button type="button" className="side-toggle" aria-expanded={open} onClick={() => setOpen(!open)}><ChevronRightIcon className="chev" aria-hidden="true" /><span>{title}</span></button>
      {meta !== undefined && <span className="side-meta">{meta}</span>}
      {action}
    </div>
    <div className="collapse" inert={!open}><div className="collapse-inner">{children}</div></div>
  </section>;
}
const clock = (t?: number) => t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
const short = (text: string) => text.replace(/\s+/g, " ").slice(0, 140);

export function Sidebar(p: Props) {
  const [pickedTab, setTab] = useState<"files" | "outputs" | "terminals">("files");
  const tab = pickedTab === "files" && !p.files ? "outputs" : pickedTab;
  const outputs = p.outputs;
  const active = outputs.filter(o => o.kind === "download" && !o.done || o.kind === "job" && o.status === "queued").length;
  // Fixed position: the Team section clips overflow, so an absolute menu would be cut off.
  const [menuPos, setMenuPos] = useState<React.CSSProperties>({});
  const [tgOwner, setTgOwner] = useTelegramOwner();
  const openMenu = (name: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect(); const right = window.innerWidth - r.right;
    setMenuPos(r.bottom + 175 > window.innerHeight ? { position: "fixed", top: "auto", bottom: window.innerHeight - r.top + 4, right, transformOrigin: "bottom right" } : { position: "fixed", top: r.bottom + 4, right });
    p.setMenu(name);
  };
  return <aside className="sidebar" id="agent-activity" aria-label="Team and activity">
    <UsageChips open={id => p.openProvider?.(id)} />
    <div className="side-main">
    <Section title="Team" meta={p.agents.length} action={<button type="button" className="icon-button" aria-label="+ Enlist agent" title="Enlist agent" onClick={p.enlist}><PlusIcon /></button>}>
      <div className="team">
        {p.agents.map(a => (
          <div className="team-row" key={a.name} onContextMenu={e => { e.preventDefault(); openMenu(a.name, e.currentTarget.querySelector(".row-more") || e.currentTarget); }} onKeyDown={e => { if (e.key === "Delete" && a.name !== "boss") { e.preventDefault(); p.act(a.name, "dismiss"); } }}>
            <Button className={"list-row agent " + (p.activeView && p.selected === a.name ? "selected" : "")} onClick={() => p.select(a.name)} aria-label={`${a.name} · ${a.model} · ${a.status.toLowerCase()}`} title={a.status}>
              <ProviderIcon className="provider-icon row-icon" provider={a.provider} alt="" />
              <span className="row-text"><b>{a.name}{tgOwner === a.name && <TelegramMark title="Answers Telegram" />}</b><small>{a.enlistedBy ? `by ${a.enlistedBy} · ` : ""}{a.model}</small></span>
              <StatusDot tone={a.tone} label={a.status} />
            </Button>
            <button type="button" className="icon-button row-more" aria-label={`Actions for ${a.name}`} aria-expanded={p.menu === a.name} onClick={e => p.menu === a.name ? p.setMenu(null) : openMenu(a.name, e.currentTarget)}><EllipsisHorizontalIcon /></button>
            {p.menu === a.name && <div className="popover row-menu" role="menu" style={menuPos}>
              <Button className="menu-item" onClick={() => p.openTerminal(a.name)}>Open terminal</Button>
              <Button className="menu-item" onClick={() => p.act(a.name, "model")}>Change model…</Button>
              <Button className="menu-item" onClick={() => p.act(a.name, "template")}>Save as template…</Button>
              {tgOwner !== null && tgOwner !== a.name && <Button className="menu-item" onClick={() => { p.setMenu(null); void setTgOwner(a.name); }}><TelegramMark />Answer Telegram here</Button>}
              <Button className="menu-item" onClick={() => p.act(a.name, a.status === "Stopped" ? "restart" : "stop")}>{a.status === "Stopped" ? "Restart" : "Stop"}</Button>
              {a.name !== "boss" ? <Button className="menu-item danger" onClick={() => p.act(a.name, "dismiss")}>Dismiss</Button> : <Button className="menu-item" onClick={p.changeBoss}>Change boss…</Button>}
            </div>}
          </div>
        ))}
      </div>
      {p.saveTeam && <Button className="ghost save-team" onClick={p.saveTeam} title="Keep this boss and these agents as a team you can start again"><BookmarkIcon aria-hidden="true" />Save as team template</Button>}
    </Section>
    <Section title="Activity" meta={p.feed.length || undefined}>
      {p.feed.length ? <ol className="feed">{p.feed.slice(-30).reverse().map((m, i) => <li key={m.id + i}>
        <time>{clock(m.time)}</time>
        <p><b className={`who c-${p.color(m.from)}`}>{m.from}</b> <span className="to">→ {m.to}</span> {short(m.text)}</p>
      </li>)}</ol> : <p className="empty-line">Messages between agents show up here.</p>}
    </Section>
    </div>
    <div className="side-files">
      <div className="side-tabs" role="tablist">
        {p.files && <button type="button" role="tab" aria-selected={tab === "files"} onClick={() => setTab("files")} title="Changed files">Changes{p.files.length ? <span className="side-meta">{p.files.length}</span> : null}</button>}
        <button type="button" role="tab" aria-selected={tab === "outputs"} onClick={() => setTab("outputs")}>Outputs{active ? <span className="tab-spin" role="img" aria-label={`${active} running`} title={`${active} running`} /> : outputs.length ? <span className="side-meta">{outputs.length}</span> : null}</button>
        {p.shells && <button type="button" role="tab" aria-selected={tab === "terminals"} onClick={() => setTab("terminals")}>Terminals{p.shells.length ? <span className="side-meta">{p.shells.length}</span> : null}</button>}
      </div>
      <div className="side-tab-body">
        {tab === "terminals" ? <div className="term-grid">
          {p.agents.map(a => <button type="button" key={a.name} className="term-tile" title={`${a.name} · ${a.provider} CLI`} aria-label={`Open ${a.name} terminal`} onClick={() => p.openTerminal(a.name)}>
            <span className={"term-tag prov-" + String(a.provider).replace(/^local.*/, "local")}>{a.name}</span>
            <ProviderIcon className="term-tile-icon" provider={a.provider} alt="" />
          </button>)}
          {p.shells?.map(s => <button type="button" key={s.name} className={"term-tile" + (s.exited ? " exited" : "")} title={s.cwd} aria-label={`Open ${s.title}`} onClick={() => p.openShell?.(s.name)}>
            <span className="term-tag">{s.title.replace(/^Terminal /, "#")}</span>
            <CommandLineIcon className="term-tile-icon" aria-hidden="true" />
          </button>)}
          <button type="button" className="term-tile add" title="New terminal in this folder" aria-label="New terminal" onClick={() => p.openShell?.()}>
            <span className="term-tag">new</span>
            <PlusIcon className="term-tile-icon" aria-hidden="true" />
          </button>
        </div> : tab === "files" ? (p.files && p.files.length ? <ul className="files">{p.files.map(f => { const i = f.path.lastIndexOf("/"); const open = () => p.openFile?.(f.path); return <li key={f.path} title={p.openFile ? `${f.path} · open diff` : f.path} className={p.openFile ? "clickable" : undefined} role={p.openFile ? "button" : undefined} tabIndex={p.openFile ? 0 : undefined} onClick={open} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}><span className="file-path"><span className="file-dir">{f.path.slice(0, i + 1)}</span>{f.path.slice(i + 1)}</span><span className="diff"><span className="add">+{f.add}</span><span className="del">−{f.del}</span></span></li>; })}</ul> : <p className="empty-line">No file changes yet.</p>)
          : outputs.length ? <ul className="outputs">{outputs.map(o => <OutputRow key={o.key} o={o} color={p.color} />)}</ul> : <p className="empty-line">Files agents finish (in .dispatch/outputs/&lt;agent&gt;), and what tools generate or download, show up here.</p>}
      </div>
    </div>
  </aside>;
}
