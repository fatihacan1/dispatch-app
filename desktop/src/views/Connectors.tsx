import { useEffect, useMemo, useState } from "react";
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, CheckIcon, MagnifyingGlassIcon, PlusIcon } from "@heroicons/react/16/solid";
import { Button } from "../components/common";
import { Dialog } from "../components/Dialog";
import { ask } from "../components/ask";
import { MCP_ICONS } from "../lib/mcpIcons";
import "../connectors.css";

type Item = { id: string; name: string; group: string; desc: string; url?: string; auth: "oauth" | "none" | "token" | "local"; icon?: string; tokenHelp?: string; tokenUrl?: string };
type Group = { id: string; name: string; desc: string };
type Conn = { id: string; name: string; url: string; auth: string; icon: string; custom: boolean; status: "connected" | "expired" | "error"; tools: number | null; error: string; addedAt: number };

const army = () => (window as any).army;
const clean = (e: unknown) => String((e as any)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const AUTH_NOTE: Record<string, string> = { oauth: "Signs in with your browser", none: "No sign-in", token: "Needs a token", local: "Runs on this computer" };

/** A brand mark in its own colour, or the initial on a neutral tile when there is no mark. */
function Logo({ id, icon, name }: { id: string; icon?: string; name: string }) {
  const mark = MCP_ICONS[icon || id];
  if (mark && "svg" in mark) return <span className="mcp-logo" aria-hidden="true" dangerouslySetInnerHTML={{ __html: mark.svg }} />;
  if (mark && "src" in mark) return <span className="mcp-logo" aria-hidden="true"><img src={mark.src} alt="" /></span>;
  return <span className="mcp-logo" aria-hidden="true">
    {mark ? <svg viewBox="0 0 24 24" style={mark.color ? { color: mark.color } : undefined}><path d={mark.d} fill="currentColor" /></svg> : <b>{name.slice(0, 1).toUpperCase()}</b>}
  </span>;
}

function useConnections() {
  const [state, setState] = useState<{ connections: Conn[]; pending: string[] }>({ connections: [], pending: [] });
  useEffect(() => { const load = () => army().connectors.list().then(setState).catch(() => {}); void load(); return army().on("connectors-changed", load); }, []);
  return state;
}

function TokenDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => { setBusy(true); setError(""); try { await army().connectors.connect({ name: item.name, url: item.url, token, catalog: item.id }); onClose(); } catch (e) { setError(clean(e)); } finally { setBusy(false); } };
  return <Dialog title={`Connect ${item.name}`} size="sm" onClose={onClose} footer={<>
    <span className="grow" />
    <Button className="ghost" onClick={onClose}>Cancel</Button>
    <Button className="primary" disabled={busy || !token.trim()} onClick={() => void save()}>{busy ? "Checking…" : "Connect"}</Button>
  </>}>
    <div className="server-form">
      <label className="field">Token<input autoFocus type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && token.trim()) void save(); }} /></label>
      <small className="field-hint">{item.tokenHelp}. It is stored encrypted on this computer and never shown to agents.</small>
      {item.tokenUrl && <a className="mcp-link" href={item.tokenUrl} target="_blank" rel="noreferrer">Create a token<ArrowTopRightOnSquareIcon aria-hidden="true" /></a>}
      {error && <p className="setting-note error" role="alert">{error}</p>}
    </div>
  </Dialog>;
}

function CustomDialog({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState({ name: "", url: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => { setBusy(true); setError(""); try { await army().connectors.connect(v); onClose(); } catch (e) { setError(clean(e)); } finally { setBusy(false); } };
  return <Dialog title="Add an MCP server" size="sm" onClose={onClose} footer={<>
    <span className="grow" />
    <Button className="ghost" onClick={() => { if (busy) void army().connectors.cancel("custom"); onClose(); }}>Cancel</Button>
    <Button className="primary" disabled={busy || !v.name.trim() || !v.url.trim()} onClick={() => void save()}>{busy ? "Waiting for the browser…" : "Connect"}</Button>
  </>}>
    <div className="server-form">
      <label className="field">Name<input autoFocus value={v.name} placeholder="My company tools" onChange={e => setV({ ...v, name: e.target.value })} /></label>
      <label className="field">Address<input value={v.url} placeholder="https://example.com/mcp" onChange={e => setV({ ...v, url: e.target.value })} /></label>
      <small className="field-hint">A remote MCP server (Streamable HTTP). If it needs a sign-in, your browser opens.</small>
      {error && <p className="setting-note error" role="alert">{error}</p>}
    </div>
  </Dialog>;
}

/** Plugins page: a catalogue of apps to connect with one click, and the ones already connected. */
export function Connectors() {
  const { connections, pending } = useConnections();
  const [cat, setCat] = useState<{ groups: Group[]; items: Item[] } | null>(null);
  const [tab, setTab] = useState<"browse" | "connected">("browse");
  const [q, setQ] = useState("");
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [tokenFor, setTokenFor] = useState<Item | null>(null);
  const [custom, setCustom] = useState(false);
  useEffect(() => { army().connectors.catalog().then(setCat).catch((e: unknown) => setError({ id: "", text: clean(e) })); }, []);
  const byId = useMemo(() => new Map(connections.map(c => [c.id, c])), [connections]);
  const items = cat?.items || [];
  const query = q.trim().toLowerCase();
  const shown = items.filter(x => !query || `${x.name} ${x.desc}`.toLowerCase().includes(query));

  const add = async (x: Item) => {
    if (x.auth === "token") return setTokenFor(x);
    setError(null);
    try { await army().connectors.connect(x.id); }
    catch (e) { const text = clean(e); if (text !== "cancelled") setError({ id: x.id, text }); }
  };
  const logout = async (c: Conn) => {
    if (await ask.confirm(`Log out of ${c.name}?`, { description: "Dispatch forgets the sign-in. Agents lose these tools the next time they start.", action: "Log out", danger: true })) await army().connectors.remove(c.id);
  };
  const reconnect = async (c: Conn) => {
    setError(null);
    const item = items.find(x => x.id === c.id);
    try { if (item?.auth === "token") setTokenFor(item); else await army().connectors.connect(item ? item.id : { name: c.name, url: c.url }); }
    catch (e) { const text = clean(e); if (text !== "cancelled") setError({ id: c.id, text }); }
  };

  const action = (x: Item) => {
    const c = byId.get(x.id);
    if (pending.includes(x.id)) return <span className="mcp-wait">Finish in your browser<Button className="ghost" onClick={() => void army().connectors.cancel(x.id)}>Cancel</Button></span>;
    if (c?.status === "connected") return <button type="button" className="mcp-state" onClick={() => setTab("connected")} title="Connected. Manage it under Connected."><CheckIcon aria-hidden="true" />Connected</button>;
    if (c) return <button type="button" className="mcp-state" onClick={() => void reconnect(c)} title={c.error || "Try the connection again"}>Reconnect</button>;
    return <button type="button" className="icon-button lg" aria-label={`Connect ${x.name}`} title={AUTH_NOTE[x.auth]} onClick={() => void add(x)}><PlusIcon /></button>;
  };

  return <div className="page prov-page mcp-page">
    <div className="view-heading"><h1>Plugins</h1>
      <div className="mem-seg" role="tablist" aria-label="Plugins">
        <button role="tab" aria-selected={tab === "browse"} onClick={() => setTab("browse")}>Browse</button>
        <button role="tab" aria-selected={tab === "connected"} onClick={() => setTab("connected")}>Connected{connections.length > 0 && <span>{connections.length}</span>}</button>
      </div>
      <span className="grow" />
      <Button className="secondary" onClick={() => setCustom(true)}><PlusIcon aria-hidden="true" />Add by address</Button>
    </div>
    <div className="prov-list">
      {tab === "browse" ? <>
        <div className="mcp-top">
          <p className="page-lead">Connect an app once and every agent can use it. Click +, sign in in the browser that opens, done. Claude, Codex and OpenCode agents get the tools when they start.</p>
          <div className="field-search mcp-search"><MagnifyingGlassIcon aria-hidden="true" /><input aria-label="Search apps" placeholder={`Search ${items.length} apps`} value={q} onChange={e => setQ(e.target.value)} /></div>
        </div>
        {error && !error.id && <p className="tpl-error">{error.text}</p>}
        {(cat?.groups || []).map(g => {
          const list = shown.filter(x => x.group === g.id);
          if (!list.length) return null;
          return <section className="mcp-group" key={g.id} aria-label={g.name}>
            <header><h2>{g.name}</h2><p>{g.desc}</p></header>
            <div className="mcp-grid">
              {list.map(x => <div className="mcp-item" key={x.id}>
                <Logo id={x.id} icon={x.icon} name={x.name} />
                <span className="mcp-text"><b>{x.name}</b><small title={error?.id === x.id ? error.text : x.desc}>{error?.id === x.id ? <span className="mcp-error">{error.text}</span> : x.desc}</small></span>
                {action(x)}
              </div>)}
            </div>
          </section>;
        })}
        {cat && shown.length === 0 && <p className="empty-line">Nothing matches "{q}". Add it by address if it has a remote MCP server.</p>}
        <p className="mcp-foot">Gmail, Google Calendar and Google Drive only allow Google's own apps, so they are not listed.</p>
      </> : <>
        {connections.length === 0 ? <div className="mcp-empty"><h2>Nothing connected yet</h2><p>Pick an app under Browse. After you sign in it shows up here, where you can reconnect or log out.</p><Button className="primary" onClick={() => setTab("browse")}>Browse apps</Button></div>
          : <div className="mcp-connected">{connections.map(c => <div className="mcp-row" key={c.id}>
            <Logo id={c.id} icon={c.icon} name={c.name} />
            <span className="mcp-text">
              <b>{c.name}</b>
              <small>{pending.includes(c.id) ? "Waiting for the browser…"
                : error?.id === c.id ? <span className="mcp-error">{error.text}</span>
                : c.status === "connected" ? [c.tools != null ? `${c.tools} tools` : "Connected", c.custom ? c.url : "", `added ${new Date(c.addedAt).toLocaleDateString()}`].filter(Boolean).join(" · ")
                : <span className="mcp-error">{c.status === "expired" ? "Sign-in expired. Agents do not get it until you reconnect." : c.error || "Could not reach it"}</span>}</small>
            </span>
            {c.status !== "connected" ? <Button className="secondary" disabled={pending.includes(c.id)} onClick={() => void reconnect(c)}>Reconnect</Button>
              : <button type="button" className="icon-button lg" title="Check the connection" aria-label={`Check ${c.name}`} onClick={() => void army().connectors.check(c.id)}><ArrowPathIcon /></button>}
            <Button className="ghost" onClick={() => void logout(c)}>Log out</Button>
          </div>)}</div>}
        {connections.length > 0 && <p className="mcp-foot">Agents that are already running get changes the next time they start. Antigravity, Gemini and Qoder agents do not get Plugins yet.</p>}
      </>}
    </div>
    {tokenFor && <TokenDialog item={tokenFor} onClose={() => setTokenFor(null)} />}
    {custom && <CustomDialog onClose={() => setCustom(false)} />}
  </div>;
}
