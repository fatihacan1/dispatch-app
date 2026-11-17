import React, { useEffect, useRef, useState } from "react";
import { PlusIcon, ServerStackIcon, PencilSquareIcon, TrashIcon, PhotoIcon, KeyIcon, XMarkIcon, CommandLineIcon, ShieldCheckIcon, DocumentArrowUpIcon } from "@heroicons/react/16/solid";
import { Button, Console } from "../components/common";
import { Dialog } from "../components/Dialog";
import { ask } from "../components/ask";
import { TreeMenu } from "../ide/TreeMenu";
import type { Server, ServerCall, Vpn } from "../lib/types";
import { VersionBadge } from "./UpdateButton";

const army = () => window.army;
const errText = (e: unknown) => String((e as any)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
type Shell = { name: string; title: string; cwd: string; exited: boolean; server: string | null };

export function useServers() {
  const [list, setList] = useState<Server[]>([]);
  useEffect(() => { const load = () => army().servers.list().then(setList).catch(() => {}); void load(); return army().on("servers-changed", load); }, []);
  return [list, setList] as const;
}

export function useVpns() {
  const [list, setList] = useState<Vpn[]>([]);
  useEffect(() => { const load = () => army().vpns.list().then(setList).catch(() => {}); void load(); return army().on("vpns-changed", load); }, []);
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
  return <div className="rail-servers" aria-label="Servers and version">
    {list.length > 0 && <span className="rail-servers-label">Servers</span>}
    {list.map(s => <button type="button" key={s.id} className={"rail-server" + (dragging === s.id ? " dragging" : "")} title={`${s.name} · ${s.user ? s.user + "@" : ""}${s.host}`} aria-label={`Open ${s.name}`} onClick={() => open(s.id)} {...props(s.id)}><ServerBadge server={s} size={20} /><span>{s.name}</span></button>)}
    <span className="bar-grow" />
    <VersionBadge />
  </div>;
}

const ACCESS: [Server["access"], string, string][] = [["off", "Off", "Agents do not see this server."], ["ask", "Ask me", "Agents can use it; every command waits for your OK."], ["on", "Allowed", "Agents run commands without asking."]];
const VPN_TYPES: [Vpn["type"], string][] = [["wireguard", "WireGuard"], ["proxy", "SOCKS5 / HTTP"], ["jump", "SSH jump host"]];
const VPN_TYPE_LABEL: Record<Vpn["type"], string> = { wireguard: "WireGuard", proxy: "Proxy", jump: "Jump host" };
const vpnSubtitle = (v: Vpn) => v.type === "wireguard" ? "WireGuard" : v.type === "proxy" ? `${(v.protocol || "socks5").toUpperCase()} · ${v.host}:${v.port}` : `Jump · ${v.user ? v.user + "@" : ""}${v.host}${v.port && v.port !== 22 ? ":" + v.port : ""}`;

function VpnForm({ initial, onClose }: { initial: Partial<Vpn> | null; onClose: (saved?: Vpn) => void }) {
  const [v, setV] = useState<Partial<Vpn>>({ type: "wireguard", protocol: "socks5", port: 1080, ...initial });
  const [targetHost, setTargetHost] = useState("");
  const [targetPort, setTargetPort] = useState(22);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; output: string } | null>(null);
  const [error, setError] = useState("");
  const set = (patch: Partial<Vpn>) => { setV(x => ({ ...x, ...patch })); setTest(null); };
  const switchType = (type: Vpn["type"]) => {
    const port = type === "proxy" ? (v.protocol === "http" ? 8080 : 1080) : type === "jump" ? 22 : v.port;
    set({ type, port });
  };
  const canSave = !!v.name?.trim() && (v.type === "wireguard" ? !!v.config?.trim() : !!v.host?.trim());
  const canTest = v.type === "wireguard" ? !!v.config?.trim() : !!v.host?.trim();
  const save = async () => { setBusy(true); setError(""); try { onClose(await army().vpns.save(v)); } catch (e) { setError(errText(e)); } finally { setBusy(false); } };
  const runTest = async () => {
    setBusy(true); setTest(null); setError("");
    try { setTest(await army().vpns.test(v, targetHost, targetPort)); }
    catch (e) { setTest({ ok: false, output: errText(e) }); }
    finally { setBusy(false); }
  };

  return <Dialog title={initial?.id ? `Edit ${initial.name}` : "Add VPN"} size="md" onClose={() => onClose()} footer={<>
    <Button className="ghost" disabled={busy || !canTest} onClick={() => void runTest()}>{busy && !test ? "Testing…" : "Test connection"}</Button>
    <span className="grow" />
    <Button className="ghost" onClick={() => onClose()}>Cancel</Button>
    <Button className="primary" disabled={busy || !canSave} onClick={() => void save()}>{initial?.id ? "Save" : "Add VPN"}</Button>
  </>}>
    <div className="server-form">
      <label className="field">Name<input autoFocus value={v.name || ""} placeholder="Office WireGuard" onChange={e => set({ name: e.target.value })} /></label>
      <div className="field">Type
        <div className="seg" role="radiogroup" aria-label="VPN type">
          {VPN_TYPES.map(([id, label]) => <button type="button" key={id} role="radio" aria-checked={v.type === id} className={v.type === id ? "on" : ""} onClick={() => switchType(id)}>{label}</button>)}
        </div>
        <small className="field-hint">Only selected servers route through this VPN. OpenVPN is not in this version (requires a TUN/TAP driver and admin rights).</small>
      </div>

      {v.type === "wireguard" && <>
        <div className="field">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span>WireGuard config (.conf)</span>
            <Button className="secondary" onClick={async () => { const f = await army().vpns.chooseConf(); if (f) set({ config: f.text, name: v.name || f.name, clearKey: false }); }}><DocumentArrowUpIcon aria-hidden="true" />Import .conf</Button>
          </div>
          <textarea rows={7} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }} value={v.config || ""} placeholder={"[Interface]\nPrivateKey = ...\nAddress = 10.0.0.2/32\n\n[Peer]\nPublicKey = ...\nEndpoint = vpn.example.com:51820"} onChange={e => set({ config: e.target.value })} />
          {v.hasKey && <small className="field-hint">Private key is saved encrypted. Paste or import a new config to replace it.</small>}
        </div>
      </>}

      {v.type === "proxy" && <>
        <div className="field">Protocol
          <div className="seg" role="radiogroup" aria-label="Proxy protocol">
            {([["socks5", "SOCKS5"], ["http", "HTTP CONNECT"]] as const).map(([id, label]) => <button type="button" key={id} role="radio" aria-checked={(v.protocol || "socks5") === id} className={(v.protocol || "socks5") === id ? "on" : ""} onClick={() => set({ protocol: id, port: v.port === 1080 && id === "http" ? 8080 : v.port === 8080 && id === "socks5" ? 1080 : v.port })}>{label}</button>)}
          </div>
        </div>
        <div className="server-form-row">
          <label className="field grow">Proxy host<input value={v.host || ""} placeholder="127.0.0.1 or proxy.example.com" onChange={e => set({ host: e.target.value })} /></label>
          <label className="field server-port">Port<input inputMode="numeric" value={v.port ?? 1080} onChange={e => set({ port: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></label>
        </div>
        <label className="field">User (optional)<input value={v.user || ""} placeholder="Optional" onChange={e => set({ user: e.target.value })} /></label>
        <div className="field">Password (optional)<div className="server-key"><input type="password" aria-label="Proxy password" autoComplete="new-password" value={v.password ?? ""} placeholder={v.hasPassword && v.password === undefined ? "Saved (type to change)" : "Optional: stored encrypted by your system"} onChange={e => set({ password: e.target.value })} />{(v.hasPassword || v.password) && <Button className="ghost" onClick={() => set({ password: "", hasPassword: false })}>Clear</Button>}</div></div>
      </>}

      {v.type === "jump" && <>
        <div className="server-form-row">
          <label className="field grow">Jump host<input value={v.host || ""} placeholder="bastion.example.com" onChange={e => set({ host: e.target.value })} /></label>
          <label className="field server-port">Port<input inputMode="numeric" value={v.port ?? 22} onChange={e => set({ port: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></label>
        </div>
        <label className="field">Jump user (optional)<input value={v.user || ""} placeholder="ubuntu" onChange={e => set({ user: e.target.value })} /></label>
        <small className="field-hint">Uses ssh -J with your local SSH keys / ssh-agent.</small>
      </>}

      {v.type !== "jump" && <div className="server-form-row">
        <label className="field grow">Test target host (optional)<input value={targetHost} placeholder="e.g. 10.0.0.5" onChange={e => setTargetHost(e.target.value)} /></label>
        <label className="field server-port">Port<input inputMode="numeric" value={targetPort} onChange={e => setTargetPort(Number(e.target.value.replace(/\D/g, "")) || 22)} /></label>
      </div>}

      {test && <p className={"server-test " + (test.ok ? "ok" : "bad")} role="status">{test.output}</p>}
      {error && <p className="setting-note error" role="alert">{error}</p>}
    </div>
  </Dialog>;
}

function ServerForm({ initial, vpns, onClose }: { initial: Partial<Server> | null; vpns: Vpn[]; onClose: (saved?: Server) => void }) {
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
      <label className="field">VPN
        <select value={s.vpnId || ""} onChange={e => set({ vpnId: e.target.value })}>
          <option value="">None</option>
          {vpns.map(v => <option key={v.id} value={v.id}>{v.name} ({VPN_TYPE_LABEL[v.type]})</option>)}
        </select>
      </label>
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
  const [vpns] = useVpns();
  const { dragging, props } = useReorder(list, setList);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Server> | null | false>(false);
  const [editingVpn, setEditingVpn] = useState<Partial<Vpn> | null | false>(false);
  const [menu, setMenu] = useState<{ x: number; y: number; server: Server } | null>(null);
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
  const removeServer = async (s: Server) => {
    if (await ask.confirm(`Delete ${s.name}?`, { description: "Only the saved entry is removed. Nothing changes on the server.", action: "Delete", danger: true })) {
      await army().servers.remove(s.id);
      if (selected === s.id) setSelected(null);
    }
  };
  const removeVpn = async (v: Vpn) => {
    const usedBy = list.filter(s => s.vpnId === v.id);
    const description = usedBy.length
      ? `Used by ${usedBy.length} server${usedBy.length > 1 ? "s" : ""} (${usedBy.map(s => s.name).join(", ")}). Removing it will clear their VPN setting.`
      : "Only the saved VPN is removed.";
    if (await ask.confirm(`Delete ${v.name}?`, { description, action: "Delete", danger: true })) {
      await army().vpns.remove(v.id);
    }
  };
  useEffect(() => {
    if (!focus) return;
    setSelected(focus.id);
    const open = shells.find(sh => sh.server === focus.id && !sh.exited);
    if (open) setActive(open.name); else void connect(focus.id);
  }, [focus?.n]);
  const current = list.find(s => s.id === selected) || list[0];
  const currentVpn = current?.vpnId ? vpns.find(v => v.id === current.vpnId) : undefined;
  const mine = shells.filter(sh => current && sh.server === current.id);
  const shown = mine.find(sh => sh.name === active) || mine[mine.length - 1];
  const activity = calls.filter(c => current && c.serverId === current.id).slice(-30).reverse();

  return <div className="page servers">
    <aside className="server-list">
      <div className="server-list-head"><h1>Servers</h1><Button className="secondary" onClick={() => setEditing({})}><PlusIcon aria-hidden="true" />Add</Button></div>
      {list.length === 0 ? <div className="server-empty"><ServerStackIcon aria-hidden="true" /><p>Save the servers you use. Open them as terminals, and let agents work on them if you want.</p></div>
        : <div className="rows" role="listbox" aria-label="Servers" title={list.length > 1 ? "Drag to reorder. The same order shows in the bottom bar." : undefined}>{list.map(s => {
          const vpn = s.vpnId ? vpns.find(v => v.id === s.vpnId) : undefined;
          const tags = [vpn && "VPN", s.access === "ask" ? "Agents ask" : s.access === "on" ? "Agents allowed" : ""].filter(Boolean).join(" · ");
          return <div key={s.id} role="option" aria-selected={current?.id === s.id} tabIndex={0} className={"list-row server-row" + (current?.id === s.id ? " selected" : "") + (dragging === s.id ? " dragging" : "")} {...props(s.id)}
            onClick={() => setSelected(s.id)} onDoubleClick={() => void connect(s.id)} onContextMenu={e => { e.preventDefault(); setSelected(s.id); setMenu({ x: e.clientX, y: e.clientY, server: s }); }} onKeyDown={e => { if (e.key === "Enter") void connect(s.id); }}>
            <ServerBadge server={s} size={32} />
            <span className="row-text"><b>{s.name}{shells.some(sh => sh.server === s.id && !sh.exited) && <span className="server-live" title="Terminal open" />}</b><small>{s.user ? s.user + "@" : ""}{s.host}{s.port !== 22 ? ":" + s.port : ""}</small>{tags && <small className="server-tags" title={[vpn && `VPN: ${vpn.name}`, ACCESS.find(a => a[0] === s.access)?.[2]].filter(Boolean).join(" ")}>{tags}</small>}</span>
          </div>;
        })}</div>}
      <div className="server-list-head server-vpn-head">
        <h2 className="label">VPNs</h2>
        <Button className="ghost" onClick={() => setEditingVpn({ type: "wireguard" })}><PlusIcon aria-hidden="true" />Add</Button>
      </div>
      {vpns.length === 0
        ? <p className="setting-note">WireGuard, a SOCKS5/HTTP proxy or an SSH jump host. Pick one per server.</p>
        : <div className="rows" role="list" aria-label="VPNs">{vpns.map(v => <div key={v.id} role="listitem" className="list-row server-row vpn-row" onClick={() => setEditingVpn(v)}>
          <ShieldCheckIcon className="vpn-glyph" aria-hidden="true" />
          <span className="row-text"><b>{v.name}</b><small>{vpnSubtitle(v)}</small></span>
          <button type="button" className="icon-button" title={`Edit ${v.name}`} aria-label={`Edit ${v.name}`} onClick={e => { e.stopPropagation(); setEditingVpn(v); }}><PencilSquareIcon /></button>
          <button type="button" className="icon-button" title={`Delete ${v.name}`} aria-label={`Delete ${v.name}`} onClick={e => { e.stopPropagation(); void removeVpn(v); }}><TrashIcon /></button>
        </div>)}</div>}
    </aside>
    <section className="server-main">
      {!current ? <div className="empty"><h2>No servers yet</h2><p>Add one with its host and user. Passwords are typed in the terminal and never saved.</p><Button className="primary" onClick={() => setEditing({})}>Add server</Button></div> : <>
        <header className="server-head">
          <ServerBadge server={current} size={40} />
          <div className="server-title"><h2>{current.name}</h2><small>{current.user ? current.user + "@" : ""}{current.host}{current.port !== 22 ? ":" + current.port : ""}{currentVpn ? " · VPN: " + currentVpn.name : ""}{current.note ? " · " + current.note : ""}</small></div>
          <span className="grow" />
          <button type="button" className="icon-button" title="Edit" aria-label={`Edit ${current.name}`} onClick={() => setEditing(current)}><PencilSquareIcon /></button>
          <button type="button" className="icon-button" title="Delete" aria-label={`Delete ${current.name}`} onClick={() => void removeServer(current)}><TrashIcon /></button>
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
        </div> : <div className="server-idle">
          <div>
            <CommandLineIcon aria-hidden="true" />
            <h3>Not connected</h3>
            <p>Connect opens an SSH terminal here. If {current.name} asks for a password, type it in the terminal{current.hasPassword ? " (Dispatch types the saved one for you)" : ""}.</p>
            <Button className="secondary" onClick={() => void connect(current.id)}>Connect to {current.name}</Button>
          </div>
        </div>}
        <div className="server-activity">
          <h3 className="label">Agent activity</h3>
          {current.access === "off" ? <p className="empty-line">Agents cannot use this server. Turn it on under Edit, Agents.</p>
            : activity.length === 0 ? <p className="empty-line">No agent commands yet.</p>
            : <div className="server-calls">{activity.map(c => <div className="server-call" key={c.id}><span className={"call-status " + c.status}>{c.status}</span><b>{c.agent}</b><code title={c.action}>{c.action}</code><time>{ago(c.time)}</time></div>)}</div>}
        </div>
      </>}
    </section>
    {editing !== false && <ServerForm initial={editing} vpns={vpns} onClose={saved => { setEditing(false); if (saved) setSelected(saved.id); }} />}
    {editingVpn !== false && <VpnForm initial={editingVpn} onClose={() => setEditingVpn(false)} />}
    {menu && <TreeMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
      { label: shells.some(sh => sh.server === menu.server.id && !sh.exited) ? "New terminal" : "Connect", action: () => void connect(menu.server.id) },
      { label: "Edit", action: () => setEditing(menu.server) },
      { label: "Duplicate", action: () => { const { id: _id, hasPassword: _hp, password: _pw, ...rest } = menu.server; setEditing({ ...rest, name: `${menu.server.name} copy` }); } },
      "sep",
      { label: "Delete", action: () => void removeServer(menu.server) },
    ]} />}
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
