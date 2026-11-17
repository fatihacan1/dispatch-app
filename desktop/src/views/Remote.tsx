import React, { useEffect, useRef, useState } from "react";
import { ArrowUturnLeftIcon, SignalIcon } from "@heroicons/react/24/outline";
import { FileIcon } from "../components/FileIcon";
import { Button } from "../components/common";
import { Dialog } from "../components/Dialog";
import { ask } from "../components/ask";
import type { RemoteDialog, RemoteState, RemoteStatus } from "../lib/types";

const remote = () => window.army.remote;
const errText = (e: unknown) => String((e as any)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

export function useRemoteState() {
  const [s, setS] = useState<RemoteState>(() => remote().state());
  useEffect(() => remote().onState(setS), []);
  return s;
}

async function leaveRemote() { await remote().disconnect(); window.location.reload(); }

/** Holds the app back until the other computer answers; shows what to do when it does not (like VS Code Remote-SSH). */
export function RemoteGate({ children }: { children: React.ReactNode }) {
  const s = useRemoteState();
  const wasLost = useRef(false);
  useEffect(() => {
    if (s.state === "lost") wasLost.current = true;
    // Back after a drop: reload so every view picks up the other computer's current state.
    if (s.state === "connected" && wasLost.current) window.location.reload();
  }, [s.state]);
  const name = s.target?.name || "the other computer";
  if (s.state === "local" || s.state === "connected") return <>{children}<RemotePicker /></>;
  if (s.state === "lost") return <>{children}<div className="remote-lost" role="alert"><SignalIcon aria-hidden="true" /><span>Lost the connection to <b>{name}</b>. Reconnecting…</span><Button className="ghost" onClick={() => void leaveRemote()}>Use this computer</Button></div></>;
  return <div className="remote-screen">
    <div className="remote-card">
      <SignalIcon className="remote-glyph" aria-hidden="true" />
      {s.state === "connecting" ? <>
        <h1>Connecting to {name}…</h1>
        <p>{s.target?.hosts[0]}</p>
      </> : <>
        <h1>Could not connect to {name}</h1>
        <p>{s.error ? s.error.replace(/([^.!?])$/, "$1.") : "It did not answer."} Check that it is on, on the same network, and that Dispatch is running there with sharing turned on.</p>
        <div className="remote-actions">
          <Button className="primary" onClick={() => void remote().retry()}>Try again</Button>
          <Button className="secondary" onClick={() => void leaveRemote()}>Use this computer</Button>
        </div>
      </>}
    </div>
  </div>;
}

/** Rail button shown while connected: the other computer's name and a way back. */
export function RemoteRailButton() {
  const s = useRemoteState();
  if (!s.target) return null;
  const name = s.target.name;
  return <button type="button" className="rail-item rail-remote" aria-label={`Connected to ${name}`} title={`Working on ${name}`} onClick={async () => {
    const choice = await ask.choose(`Connected to ${name}`, { description: `Agents, files and tools run on ${name} (${s.target!.hosts[0]}). Disconnecting brings you back to this computer; ${name} keeps running.`, options: [{ id: "stay", label: "Stay connected" }, { id: "leave", label: "Disconnect", primary: true }] });
    if (choice === "leave") await leaveRemote();
  }}><SignalIcon aria-hidden="true" /><span>{name.length > 8 ? name.slice(0, 7) + "…" : name}</span></button>;
}

/** Settings > Other computers: share this one, or connect to one that is shared. */
export function RemoteSettings() {
  const [st, setSt] = useState<RemoteStatus | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const s = useRemoteState();
  const load = () => remote().status().then(setSt).catch(() => {});
  useEffect(() => { void load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, []);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(""); try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(false); void load(); } };
  if (!st) return null;
  const connected = !!s.target;
  return <section className="settings-group">
    <h2 className="label">Other computers</h2>
    {connected ? <div className="setting-row"><div><b>Connected to {s.target!.name}</b><p>Everything you do here runs on {s.target!.name}. Your own computer is not touched.</p></div><Button className="secondary" onClick={() => void leaveRemote()}>Disconnect</Button></div> : <>
      <label className="setting-row"><div><b>Share on my network</b><p>Another computer on the same network can use this one: its agents, files, ComfyUI and voice typing. Leave this computer on.</p></div>
        <input type="checkbox" aria-label="Share on my network" checked={st.share} disabled={busy} onChange={e => void run(() => remote().share(e.target.checked))} /></label>
      {st.share && <>
        <div className="setting-row remote-link-row"><div><b>Link</b><p>Paste it on the other computer under Connect to a computer. Anyone with the link on this network can use this computer.{st.clients > 0 ? ` ${st.clients} connected now.` : ""}</p><code className="remote-link">{st.link}</code></div>
          <div className="remote-actions"><Button className="secondary" onClick={() => { void navigator.clipboard.writeText(st.link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy"}</Button>
            <Button className="ghost" disabled={busy} onClick={async () => { if (await ask.confirm("Make a new link?", { description: "The old link stops working and connected computers are dropped.", action: "New link" })) void run(() => remote().newLink()); }}>New link</Button></div></div>
        <label className="setting-row"><div><b>Start Dispatch when this computer starts</b><p>So the other computer can connect after a restart.</p></div>
          <input type="checkbox" aria-label="Start Dispatch when this computer starts" checked={st.loginItem} disabled={busy} onChange={e => void run(() => remote().loginItem(e.target.checked))} /></label>
      </>}
      <div className="setting-row"><div><b>Connect to a computer</b><p>Paste the link from the other computer's Settings. Dispatch reconnects to it every time it starts until you disconnect.</p></div>
        <form className="remote-connect" onSubmit={e => { e.preventDefault(); if (link.trim()) void run(async () => { await remote().connect(link.trim()); window.location.reload(); }); }}>
          <input aria-label="Link" placeholder="dispatch://…" value={link} onChange={e => setLink(e.target.value)} />
          <Button className="primary" type="submit" disabled={busy || !link.trim()}>{busy ? "Connecting…" : "Connect"}</Button>
        </form></div>
    </>}
    {error && <p className="setting-note error" role="alert">{error}</p>}
  </section>;
}

/** Folder and file picker over the other computer's disk, used when one of its handlers opens a dialog. */
function RemotePicker() {
  const [req, setReq] = useState<RemoteDialog | null>(null);
  const [dir, setDir] = useState<Awaited<ReturnType<typeof window.army.remote.list>> | null>(null);
  const [pick, setPick] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  useEffect(() => remote().onDialog(r => { setReq(r); setPick(""); setError(""); const d = r.options.defaultPath || ""; setName(r.mode === "save" ? d.split(/[\\/]/).pop() || "" : ""); void go(r.mode === "save" ? undefined : d || undefined); }), []);
  const go = async (path?: string) => { try { setDir(await remote().list(path)); setPick(""); setError(""); } catch (e) { setError(errText(e)); if (path) setDir(await remote().list().catch(() => null)); } };
  if (!req) return null;
  const props = req.options.properties || [];
  const wantDir = req.mode === "open" && props.includes("openDirectory");
  const exts = (req.options.filters || []).flatMap(f => f.extensions).filter(x => x !== "*");
  const fits = (n: string) => !exts.length || exts.some(x => n.toLowerCase().endsWith("." + x.toLowerCase()));
  const close = (result: { canceled: boolean; filePaths?: string[]; filePath?: string }) => { void remote().answerDialog(req.id, result); setReq(null); };
  const join = (n: string) => dir!.path.replace(/[\\/]$/, "") + dir!.sep + n;
  const chosen = req.mode === "save" ? (name.trim() && dir ? join(name.trim()) : "") : wantDir ? (pick ? join(pick) : dir?.path || "") : pick ? join(pick) : "";
  const done = () => { if (!chosen) return; close(req.mode === "save" ? { canceled: false, filePath: chosen } : { canceled: false, filePaths: [chosen] }); };
  const entries = (dir?.entries || []).filter(e => e.dir || (!wantDir && fits(e.name)));
  return <Dialog title={req.options.title || (wantDir ? "Choose a folder" : req.mode === "save" ? "Save as" : "Choose a file")} size="md" description={`On ${remote().state().target?.name || "the other computer"}`} onClose={() => close({ canceled: true, filePaths: [] })} footer={<>
    <Button className="ghost" onClick={() => close({ canceled: true, filePaths: [] })}>Cancel</Button>
    <Button className="primary" disabled={!chosen} onClick={done}>{req.mode === "save" ? "Save" : wantDir ? (pick ? `Open ${pick}` : "Choose this folder") : "Open"}</Button>
  </>}>
    <div className="remote-picker">
      <div className="remote-path"><button type="button" className="icon-button" aria-label="Up one folder" title="Up one folder" disabled={!dir?.parent} onClick={() => void go(dir!.parent!)}><ArrowUturnLeftIcon /></button><code title={dir?.path}>{dir?.path || "…"}</code><Button className="ghost" onClick={() => void go(dir?.home)}>Home</Button></div>
      <div className="rows remote-entries" role="listbox" aria-label="Files">
        {entries.length === 0 && <p className="empty-line">{wantDir ? "No folders here." : "Nothing here."}</p>}
        {entries.map(e => <button type="button" role="option" aria-selected={pick === e.name} key={e.name} className={"list-row" + (pick === e.name ? " selected" : "")}
          onClick={() => setPick(e.name)} onDoubleClick={() => { if (e.dir) void go(join(e.name)); else { setPick(e.name); close({ canceled: false, filePaths: [join(e.name)] }); } }}>
          <FileIcon name={e.name} dir={e.dir} className="row-glyph" /><span className="row-text"><b>{e.name}</b></span></button>)}
      </div>
      {req.mode === "save" && <label className="field">File name<input value={name} onChange={e => setName(e.target.value)} /></label>}
      {error && <p className="setting-note error" role="alert">{error}</p>}
      <p className="setting-note">Double-click a folder to open it.</p>
    </div>
  </Dialog>;
}
