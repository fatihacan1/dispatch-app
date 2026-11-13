import React, { useEffect, useRef, useState } from "react";
import { PlusIcon, ServerStackIcon, PencilSquareIcon, TrashIcon, PhotoIcon, KeyIcon, XMarkIcon, CommandLineIcon } from "@heroicons/react/16/solid";
import { Button, Console } from "../components/common";
import { Dialog } from "../components/Dialog";
import { ask } from "../components/ask";
import type { Server, ServerCall } from "../lib/types";

const army = () => window.army;
const errText = (e: unknown) => String((e as any)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
type Shell = { name: string; title: string; cwd: string; exited: boolean; server: string | null };

export function useServers() {
  const [list, setList] = useState<Server[]>([]);
  useEffect(() => { const load = () => army().servers.list().then(setList).catch(() => {}); void load(); return army().on("servers-changed", load); }, []);
  return [list, setList] as const;
}

/** A server's picture: the user's image, or its initial on a solid tile. */
export function ServerBadge({ server, size = 28 }: { server: Pick<Server, "name" | "icon">; size?: number }) {
  return server.icon ? <img className="server-badge" src={server.icon} alt="" width={size} height={size} />
    : <span className="server-badge letter" style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">{(server.name || "?").slice(0, 1).toUpperCase()}</span>;
}

/** Drag to reorder: the list moves live under the pointer, saved on drop. */
function useReorder(list: Server[], setList: (l: Server[]) => void) {
  const drag = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  return {
    dragging,
    props: (id: string) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => { drag.current = id; setDragging(id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/x-dispatch-server", id); },
      onDragEnter: () => { const from = drag.current; if (!from || from === id) return; const next = [...list]; const a = next.findIndex(s => s.id === from), b = next.findIndex(s => s.id === id); next.splice(b, 0, next.splice(a, 1)[0]); setList(next); },
      onDragOver: (e: React.DragEvent) => { if (drag.current) e.preventDefault(); },
      onDragEnd: () => { drag.current = null; setDragging(null); void army().servers.order(list.map(s => s.id)); },
    }),
  };
}

/** Rail: a line, then the saved servers (click opens a terminal, drag to reorder). */
export function RailServers({ open }: { open: (id: string) => void }) {
  const [list, setList] = useServers();
  const { dragging, props } = useReorder(list, setList);
  if (!list.length) return null;
  return <div className="rail-servers" aria-label="Servers">
    <span className="rail-servers-label">Servers</span>
    {list.map(s => <button type="button" key={s.id} className={"rail-server" + (dragging === s.id ? " dragging" : "")} title={`${s.name} · ${s.user ? s.user + "@" : ""}${s.host}`} aria-label={`Open ${s.name}`} onClick={() => open(s.id)} {...props(s.id)}><ServerBadge server={s} size={20} /><span>{s.name}</span></button>)}
  </div>;
}

const ACCESS: [Server["access"], string, string][] = [["off", "Off", "Agents do not see this server."], ["ask", "Ask me", "Agents can use it; every command waits for your OK."], ["on", "Allowed", "Agents run commands without asking."]];

function ServerForm({ initial, onClose }: { initial: Partial<Server> | null; onClose: (saved?: Server) => void }) {
  const [s, setS] = useState<Partial<Server>>({ port: 22, access: "off", ...initial });
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; output: string } | null>(null);
  const [error, setError] = useState("");
  const set = (patch: Partial<Server>) => { setS(v => ({ ...v, ...patch })); setTest(null); };
  const save = async () => { setBusy(true); setError(""); try { onClose(await army().servers.save(s)); } catch (e) { setError(errText(e)); } finally { setBusy(false); } };
  return <Dialog title={initial?.id ? `Edit ${initial.name}` : "Add server"} size="md" onClose={() => onClose()} footer={<>
    <Button className="ghost" disabled={busy || !s.host} onClick={async () => { setBusy(true); setTest(null); try { setTest(await army().servers.test(s)); } catch (e) { setTest({ ok: false, output: errText(e) }); } finally { setBusy(false); } }}>{busy && !test ? "Testing…" : "Test connection"}</Button>
    <span className="grow" />
    <Button className="ghost" onClick={() => onClose()}>Cancel</Button>
    <Button className="primary" disabled={busy || !s.name?.trim() || !s.host?.trim()} onClick={() => void save()}>{initial?.id ? "Save" : "Add server"}</Button>
  </>}>
    <div className="server-form">
      <div className="server-form-head">
        <button type="button" className="server-icon-pick" title="Choose an image" aria-label="Choose an image" onClick={async () => { try { const icon = await army().servers.chooseIcon(); if (icon) set({ icon }); } catch (e) { setError(errText(e)); } }}>
          <ServerBadge server={{ name: s.name || "?", icon: s.icon || "" }} size={56} /><span className="server-icon-hint"><PhotoIcon aria-hidden="true" /></span>
        </button>
        <label className="field grow">Name<input autoFocus value={s.name || ""} placeholder="Production" onChange={e => set({ name: e.target.value })} /></label>
        {s.icon && <Button className="ghost" onClick={() => set({ icon: "" })}>Remove image</Button>}
      </div>
      <div className="server-form-row">
        <label className="field grow">Host<input value={s.host || ""} placeholder="192.168.1.10 or example.com" onChange={e => set({ host: e.target.value })} /></label>
        <label className="field server-port">Port<input inputMode="numeric" value={s.port ?? 22} onChange={e => set({ port: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></label>
      </div>
      <label className="field">User<input value={s.user || ""} placeholder="root" onChange={e => set({ user: e.target.value })} /></label>
      <div className="field">Password<div className="server-key"><input type="password" aria-label="Password" autoComplete="new-password" value={s.password ?? ""} placeholder={s.hasPassword && s.password === undefined ? "Saved (type to change)" : "Optional: stored encrypted by your system"} onChange={e => set({ password: e.target.value })} />{(s.hasPassword || s.password) && <Button className="ghost" onClick={() => set({ password: "", hasPassword: false })}>Clear</Button>}</div>
        <small className="field-hint">Typed for you in the terminal and used by agents. Leave empty to use an SSH key.</small></div>
      <div className="field">Key file<div className="server-key"><input aria-label="Key file" value={s.key || ""} placeholder="Optional: uses ssh-agent and ~/.ssh by default" onChange={e => set({ key: e.target.value })} /><Button className="secondary" onClick={async () => { const k = await army().servers.chooseKey(); if (k) set({ key: k }); }}><KeyIcon aria-hidden="true" />Choose</Button></div></div>
      <label className="field">What is on it<textarea rows={2} value={s.note || ""} placeholder="Agents read this. e.g. Ubuntu 24, runs the shop API in /srv/shop with docker compose" onChange={e => set({ note: e.target.value })} /></label>
      <div className="field">Agents<div className="seg" role="radiogroup" aria-label="Agent access">{ACCESS.map(([id, label]) => <button type="button" key={id} role="radio" aria-checked={s.access === id} className={s.access === id ? "on" : ""} onClick={() => set({ access: id })}>{label}</button>)}</div>
        <small className="field-hint">{ACCESS.find(a => a[0] === s.access)?.[2]}</small></div>
      {test && <p className={"server-test " + (test.ok ? "ok" : "bad")} role="status">{test.ok ? "Connected. Agents can use this server." : `Could not connect: ${test.output.split("\n").filter(Boolean).pop() || "no answer"}`}</p>}
      {error && <p className="setting-note error" role="alert">{error}</p>}
    </div>
  </Dialog>;
}

const ago = (t: number) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? "now" : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`; };

/** Servers page: the list (drag to reorder), and the selected server's terminals and agent activity. */
export function Servers({ focus }: { focus: { id: string; n: number } | null }) {
  const [list, setList] = useServers();
  const { dragging, props } = useReorder(list, setList);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Server> | null | false>(false);
  const [shells, setShells] = useState<Shell[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [calls, setCalls] = useState<ServerCall[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const load = () => army().shells.list().then((v: any) => setShells(v)).catch(() => {});
    void load(); void army().servers.log().then(setCalls).catch(() => {});
    const offs = [army().on("shells-changed", load), army().on("servers-log", (c: ServerCall) => setCalls(v => [...v.filter(x => x.id !== c.id), c].slice(-100)))];
    return () => offs.forEach(f => f());
  }, []);
  const connect = async (id: string) => { setError(""); setSelected(id); try { const name = await army().servers.connect(id); setActive(name); } catch (e) { setError(errText(e)); } };
  useEffect(() => {
    if (!focus) return;
    setSelected(focus.id);
    const open = shells.find(sh => sh.server === focus.id && !sh.exited);
    if (open) setActive(open.name); else void connect(focus.id);
  }, [focus?.n]);
  const current = list.find(s => s.id === selected) || list[0];
  const mine = shells.filter(sh => current && sh.server === current.id);
  const shown = mine.find(sh => sh.name === active) || mine[mine.length - 1];
  const activity = calls.filter(c => current && c.serverId === current.id).slice(-30).reverse();

  return <div className="page servers">
    <aside className="server-list">
      <div className="server-list-head"><h1>Servers</h1><Button className="secondary" onClick={() => setEditing({})}><PlusIcon aria-hidden="true" />Add</Button></div>
      {list.length === 0 ? <div className="server-empty"><ServerStackIcon aria-hidden="true" /><p>Save the servers you use. Open them as terminals, and let agents work on them if you want.</p></div>
        : <div className="rows" role="listbox" aria-label="Servers">{list.map(s => <div key={s.id} role="option" aria-selected={current?.id === s.id} tabIndex={0} className={"list-row server-row" + (current?.id === s.id ? " selected" : "") + (dragging === s.id ? " dragging" : "")} {...props(s.id)}
          onClick={() => setSelected(s.id)} onDoubleClick={() => void connect(s.id)} onKeyDown={e => { if (e.key === "Enter") void connect(s.id); }}>
          <ServerBadge server={s} />
          <span className="row-text"><b>{s.name}</b><small>{s.user ? s.user + "@" : ""}{s.host}{s.port !== 22 ? ":" + s.port : ""}</small></span>
          {s.access !== "off" && <span className="server-access" title={ACCESS.find(a => a[0] === s.access)?.[2]}>{s.access === "ask" ? "Agents ask" : "Agents"}</span>}
          {shells.some(sh => sh.server === s.id && !sh.exited) && <span className="server-live" title="Terminal open" />}
        </div>)}</div>}
      {list.length > 1 && <p className="setting-note">Drag to reorder. The same order shows in the left bar.</p>}
    </aside>
    <section className="server-main">
      {!current ? <div className="empty"><h2>No servers yet</h2><p>Add one with its host and user. Passwords are typed in the terminal and never saved.</p><Button className="primary" onClick={() => setEditing({})}>Add server</Button></div> : <>
        <header className="server-head">
          <ServerBadge server={current} size={40} />
          <div className="server-title"><h2>{current.name}</h2><small>{current.user ? current.user + "@" : ""}{current.host}{current.port !== 22 ? ":" + current.port : ""}{current.note ? " · " + current.note : ""}</small></div>
          <span className="grow" />
          <button type="button" className="icon-button" title="Edit" aria-label={`Edit ${current.name}`} onClick={() => setEditing(current)}><PencilSquareIcon /></button>
          <button type="button" className="icon-button" title="Delete" aria-label={`Delete ${current.name}`} onClick={async () => { if (await ask.confirm(`Delete ${current.name}?`, { description: "Only the saved entry is removed. Nothing changes on the server.", action: "Delete", danger: true })) { await army().servers.remove(current.id); setSelected(null); } }}><TrashIcon /></button>
          <Button className="primary" onClick={() => void connect(current.id)}><CommandLineIcon aria-hidden="true" />{mine.some(sh => !sh.exited) ? "New terminal" : "Connect"}</Button>
        </header>
        {error && <p className="setting-note error" role="alert">{error}</p>}
        {mine.length > 0 ? <div className="server-term">
          <div className="term-bar" role="tablist" aria-label="Terminals">
            {mine.map(sh => <div key={sh.name} role="tab" aria-selected={sh.name === shown?.name} className={"term-tab" + (sh.name === shown?.name ? " active" : "") + (sh.exited ? " exited" : "")} onClick={() => setActive(sh.name)}>
              <CommandLineIcon aria-hidden="true" /><span>{sh.title}{sh.exited ? " (closed)" : ""}</span>
              <button type="button" className="ide-tab-x" aria-label={`Close ${sh.title}`} onClick={e => { e.stopPropagation(); void army().shells.close(sh.name); }}><XMarkIcon /></button>
            </div>)}
          </div>
          <div className="term-body">{shown && <Console key={shown.name} name={shown.name} />}</div>
        </div> : <div className="server-idle"><p>Not connected. Connect opens an SSH terminal here; if the server asks for a password, type it in the terminal.</p></div>}
        <div className="server-activity">
          <h3 className="label">Agent activity</h3>
          {current.access === "off" ? <p className="empty-line">Agents cannot use this server. Turn it on under Edit, Agents.</p>
            : activity.length === 0 ? <p className="empty-line">No agent commands yet.</p>
            : <div className="server-calls">{activity.map(c => <div className="server-call" key={c.id}><span className={"call-status " + c.status}>{c.status}</span><b>{c.agent}</b><code title={c.action}>{c.action}</code><time>{ago(c.time)}</time></div>)}</div>}
        </div>
      </>}
    </section>
    {editing !== false && <ServerForm initial={editing} onClose={saved => { setEditing(false); if (saved) setSelected(saved.id); }} />}
  </div>;
}

/** Approval prompt for agent commands on servers set to "Ask me"; mounted once at the app root. */
export function ServerApprovals() {
  const [queue, setQueue] = useState<ServerCall[]>([]);
  useEffect(() => {
    void army().servers.pending().then(setQueue).catch(() => {});
    return army().on("servers-log", (c: ServerCall) => setQueue(q => c.status === "waiting" ? [...q.filter(x => x.id !== c.id), c] : q.filter(x => x.id !== c.id)));
  }, []);
  const c = queue[0];
  if (!c) return null;
  const answer = (ok: boolean) => { void army().servers.approve(c.id, ok); setQueue(q => q.slice(1)); };
  return <Dialog title={`${c.agent} wants to use ${c.server}`} size="md" onClose={() => answer(false)} footer={<>
    {queue.length > 1 && <small className="grow">{queue.length - 1} more waiting</small>}
    <Button className="ghost" onClick={() => answer(false)}>Deny</Button>
    <Button className="primary" onClick={() => answer(true)}>Allow</Button>
  </>}>
    <p className="setting-note">{c.tool === "server_run" ? "Command to run over SSH:" : "File copy:"}</p>
    <pre className="server-approve-cmd">{c.action}</pre>
  </Dialog>;
}
