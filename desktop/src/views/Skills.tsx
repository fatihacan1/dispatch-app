import { useCallback, useEffect, useState } from "react";
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, ChevronDownIcon, ChevronRightIcon, FolderArrowDownIcon, FolderIcon, MagnifyingGlassIcon, TrashIcon } from "@heroicons/react/16/solid";
import { Button } from "../components/common";
import { ask } from "../components/ask";

type Scope = "project" | "global";
type Source = { kind: "github" | "folder" | "pack"; owner?: string; repo?: string; ref?: string; sub?: string; url?: string; path?: string; pack?: string; author?: string };
type Installed = { name: string; scope: Scope; enabled: boolean; description: string; source: (Source & { installedAt?: string; skillPath?: string }) | null };
type Found = { name: string; path: string; description: string; files: number; scripts: number; installed: Record<Scope, boolean> };
type Preview = { id: string; source: Source; blocked?: string[]; skills: Found[] };

const army = () => (window as any).army;
const clean = (e: unknown) => String(e).replace(/^Error: Error invoking remote method '[^']+': (Error: )?/, "");
const where = (s: (Source & { skillPath?: string }) | null) => {
  if (!s) return "Added by hand";
  if (s.kind === "pack") return `From the pack "${s.pack}"${s.author ? ` by ${s.author}` : ""}`;
  const inner = s.skillPath && s.skillPath !== "." ? "/" + s.skillPath : "";
  return s.kind === "folder" ? `${s.path}${inner.replace(/\//g, "\\")}` : `${s.owner}/${s.repo}${s.sub ? "/" + s.sub : ""}${inner}${s.ref ? " @ " + s.ref : ""}`;
};

type ClaudeSkill = { id: string; name: string; provider: "claude" | "codex"; kind: "user" | "project" | "plugin"; plugin?: string; created: number; description: string; removable: boolean };
const KIND: Record<string, string> = { user: "Personal", project: "This project", plugin: "Plugin" };
const day = (ms: number) => ms ? new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

/** Skills Claude Code and Codex already load by themselves, outside Dispatch: browse, read, show, delete. */
function ClaudeSkills() {
  const [items, setItems] = useState<ClaudeSkill[] | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [provider, setProvider] = useState("all");
  const [newest, setNewest] = useState(true);
  const [open, setOpen] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const load = useCallback(() => army().skills.claude().then(setItems).catch((e: unknown) => setError(clean(e))), []);
  useEffect(() => { void load(); const f = () => void load(); window.addEventListener("focus", f); return () => window.removeEventListener("focus", f); }, [load]);
  if (!items) return null;
  const q = query.trim().toLowerCase();
  const byProvider = items.filter(s => provider === "all" || s.provider === provider);
  const rows = byProvider.filter(s => (kind === "all" || s.kind === kind) && (!q || `${s.name} ${s.description} ${s.plugin || ""}`.toLowerCase().includes(q)))
    .sort((a, b) => (newest ? b.created - a.created : a.created - b.created) || a.name.localeCompare(b.name));
  const counts = (k: string) => byProvider.filter(s => s.kind === k).length;
  const pcount = (p: string) => items.filter(s => s.provider === p).length;
  const toggle = async (s: ClaudeSkill) => {
    if (open[s.id] !== undefined) { const { [s.id]: _, ...rest } = open; setOpen(rest); return; }
    try { setOpen({ ...open, [s.id]: await army().skills.claudeRead(s.id) }); } catch (e) { setError(clean(e)); }
  };
  const remove = async (s: ClaudeSkill) => {
    if (!await ask.confirm(`Delete ${s.name}?`, { description: "Its folder goes to the Recycle Bin, so you can restore it. Claude Code stops loading it from the next session.", action: "Delete", danger: true })) return;
    try { await army().skills.claudeRemove(s.id); await load(); } catch (e) { setError(clean(e)); }
  };
  return <>
    <h2 className="label skill-label">Already in Claude Code and Codex <span className="skill-count">{items.length}</span>
      <button type="button" className="icon-button" title="Refresh" aria-label="Refresh skill list" onClick={() => void load()}><ArrowPathIcon /></button></h2>
    <p className="skill-hint skill-note">Claude Code and Codex load these by themselves, including skills they wrote on their own. The list refreshes when you come back to Dispatch. Plugin skills are managed with /plugin in Claude Code.</p>
    <div className="skill-filter">
      <div className="field-search"><MagnifyingGlassIcon aria-hidden="true" /><input aria-label="Filter Claude Code skills" placeholder="Filter" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <div className="mem-seg" role="tablist" aria-label="Skill agent">
        {[["all", "All", items.length], ["claude", "Claude", pcount("claude")], ["codex", "Codex", pcount("codex")]].map(([id, label, n]) => <button key={id} role="tab" aria-selected={provider === id} onClick={() => setProvider(String(id))}>{label} <span>{n}</span></button>)}
      </div>
      <div className="mem-seg" role="tablist" aria-label="Skill source">
        {[["all", "All", byProvider.length], ["user", "Personal", counts("user")], ["project", "This project", counts("project")], ["plugin", "Plugins", counts("plugin")]].map(([id, label, n]) => <button key={id} role="tab" aria-selected={kind === id} onClick={() => setKind(String(id))}>{label} <span>{n}</span></button>)}
      </div>
      <select aria-label="Sort skills" value={newest ? "new" : "old"} onChange={e => setNewest(e.target.value === "new")}><option value="new">Newest first</option><option value="old">Oldest first</option></select>
    </div>
    {error && <p className="tpl-error">{error}</p>}
    <div className="skill-claude-list">
      {rows.map(s => <div className="skill-item" key={s.id}>
        <div className="prov-row skill-row compact">
          <button type="button" className="icon-button" aria-label={open[s.id] !== undefined ? `Hide ${s.name}` : `Show ${s.name}`} onClick={() => void toggle(s)}>{open[s.id] !== undefined ? <ChevronDownIcon /> : <ChevronRightIcon />}</button>
          <div className="prov-main">
            <div className="prov-title"><b>{s.name}</b><span className="mem-pin">{s.provider === "codex" ? "Codex" : "Claude"} · {s.kind === "plugin" ? `Plugin: ${s.plugin}` : KIND[s.kind]}</span>{s.created > 0 && <span className="skill-date">{day(s.created)}</span>}</div>
            <small className={open[s.id] !== undefined ? "" : "skill-clamp"}>{s.description || "No description"}</small>
          </div>
          <div className="prov-actions">
            <button type="button" className="icon-button lg" title="Show in folder" aria-label={`Show ${s.name} in folder`} onClick={() => army().skills.claudeReveal(s.id)}><FolderArrowDownIcon /></button>
            {s.removable && <button type="button" className="icon-button lg danger" title="Delete" aria-label={`Delete ${s.name}`} onClick={() => void remove(s)}><TrashIcon /></button>}
          </div>
        </div>
        {open[s.id] !== undefined && <pre className="mem-index skill-body">{open[s.id]}</pre>}
      </div>)}
      {!rows.length && <p className="skill-hint">{items.length ? "No skills match." : "Claude Code has no skills installed."}</p>}
    </div>
  </>;
}

/** Claude Code skills for the boss, installed from GitHub links or local folders. */
export function Skills() {
  const [items, setItems] = useState<Installed[] | null>(null);
  const [claudeAgents, setClaudeAgents] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [scope, setScope] = useState<Scope>("global");
  const [open, setOpen] = useState<Record<string, string>>({});
  const load = useCallback(() => army().skills.list().then((r: any) => { setItems(r.skills); setClaudeAgents(!!r.settings.claudeAgents); }).catch((e: unknown) => setError(clean(e))), []);
  useEffect(() => { void load(); }, [load]);

  const act = async (label: string, fn: () => Promise<unknown>) => { setBusy(label); setError(""); try { await fn(); } catch (e) { setError(clean(e)); } finally { setBusy(""); void load(); } };
  const show = (p: Preview | null) => { if (!p) return; setPreview(p); setPicked(p.skills.length <= 3 ? p.skills.map(s => s.name) : []); };
  const lookUp = () => act("lookup", async () => show(await army().skills.preview(link)));
  const cancel = () => { if (preview) void army().skills.discard(preview.id); setPreview(null); };
  const install = () => preview && act("install", async () => { await army().skills.install(preview.id, picked, scope); setPreview(null); setLink(""); });
  const toggle = async (s: Installed) => {
    const key = `${s.scope}:${s.name}`;
    if (open[key] !== undefined) { const { [key]: _, ...rest } = open; setOpen(rest); return; }
    setOpen({ ...open, [key]: await army().skills.read(s.name, s.scope) });
  };
  const scripts = preview?.skills.filter(s => picked.includes(s.name)).reduce((n, s) => n + s.scripts, 0) || 0;

  return (
    <div className="page prov-page skills-page">
      <div className="view-heading"><h1>Skills</h1></div>
      <div className="prov-list">
        <p className="page-lead">Claude Code skills give the boss ready instructions and scripts for a kind of work. Paste a GitHub link to a repository or to a folder inside it; Dispatch shows the skills it finds before anything is installed. Skills work with Claude only.</p>

        <form className="skill-add" onSubmit={e => { e.preventDefault(); if (link.trim()) void lookUp(); }}>
          <input aria-label="GitHub link" placeholder="https://github.com/owner/repo/tree/main/skills/name" value={link} onChange={e => setLink(e.target.value)} disabled={!!preview} />
          <Button className="primary" type="submit" disabled={!link.trim() || !!busy || !!preview}>{busy === "lookup" ? "Looking up…" : "Look up"}</Button>
          <button type="button" className="icon-button lg" title="Add from a folder on this computer" aria-label="Add from a folder" disabled={!!busy || !!preview} onClick={() => act("lookup", async () => show(await army().skills.chooseFolder()))}><FolderIcon /></button>
        </form>
        {!preview && !items?.length && <p className="skill-hint">Example: <button type="button" className="link-button" onClick={() => setLink("https://github.com/anthropics/skills")}>github.com/anthropics/skills</button>, Anthropic's public skill collection.</p>}
        {error && <p className="tpl-error">{error}</p>}

        {preview && <section className="skill-preview" aria-label="Skills found">
          <div className="skill-preview-head">
            <div><b>{preview.skills.length === 1 ? "1 skill found" : `${preview.skills.length} skills found`}</b><small>{where(preview.source)}</small></div>
            {preview.source.url && <Button className="ghost" onClick={() => window.open(preview.source.url + (preview.source.ref ? `/tree/${preview.source.ref}${preview.source.sub ? "/" + preview.source.sub : ""}` : ""), "_blank")}><ArrowTopRightOnSquareIcon aria-hidden="true" />View on GitHub</Button>}
          </div>
          {preview.skills.length > 3 && <div className="skill-select"><Button className="ghost" onClick={() => setPicked(preview.skills.map(s => s.name))}>Select all</Button><Button className="ghost" onClick={() => setPicked([])}>Select none</Button></div>}
          <div className="option-list skill-found">
            {preview.skills.map(s => <label className="option-row" key={s.name + s.path}>
              <input type="checkbox" aria-label={`Install ${s.name}`} checked={picked.includes(s.name)} onChange={e => setPicked(p => e.target.checked ? [...p, s.name] : p.filter(n => n !== s.name))} />
              <span className="row-text skill-text"><b>{s.name}{s.installed[scope] && <em className="mem-pin">Installed, will update</em>}</b><small>{s.description || "No description"}</small></span>
              <span className="mem-meta">{s.files} files{s.scripts ? ` · ${s.scripts} scripts` : ""}</span>
            </label>)}
          </div>
          {!!preview.blocked?.length && <p className="skill-warn">Left out {preview.blocked.length === 1 ? "1 skill" : `${preview.blocked.length} skills`} Windows could not open, usually because the antivirus removed a file it flagged: {preview.blocked.slice(0, 6).join(", ")}{preview.blocked.length > 6 ? ", …" : ""}</p>}
          {scripts > 0 && <p className="skill-warn">The selected skills include {scripts} script{scripts === 1 ? "" : "s"} the boss may run. Install only from sources you trust.</p>}
          <div className="skill-preview-foot">
            <label className="field skill-scope">Install for<select value={scope} onChange={e => setScope(e.target.value as Scope)}><option value="global">Every workspace</option><option value="project">This workspace only</option></select></label>
            <span className="mem-spacer" />
            <Button className="ghost" onClick={cancel}>Cancel</Button>
            <Button className="primary" disabled={!picked.length || !!busy} onClick={() => void install()}>{busy === "install" ? "Installing…" : picked.length > 1 ? `Install ${picked.length} skills` : "Install"}</Button>
          </div>
        </section>}

        <h2 className="label skill-label">Installed</h2>
        {items?.map(s => {
          const key = `${s.scope}:${s.name}`;
          return <div className="skill-item" key={key}>
            <div className="prov-row skill-row">
              <button type="button" className="icon-button" aria-label={open[key] !== undefined ? `Hide ${s.name}` : `Show ${s.name}`} onClick={() => void toggle(s)}>{open[key] !== undefined ? <ChevronDownIcon /> : <ChevronRightIcon />}</button>
              <div className="prov-main">
                <div className="prov-title"><b className={s.enabled ? "" : "skill-off"}>{s.name}</b><span className="mem-pin">{s.scope === "global" ? "Every workspace" : "This workspace"}</span></div>
                <small>{s.description || "No description"}</small>
                <small className="skill-src">{where(s.source)}</small>
              </div>
              <div className="prov-actions">
                <label className="skill-on"><input type="checkbox" aria-label={`Use ${s.name}`} checked={s.enabled} onChange={e => { const on = e.target.checked; setItems(v => v && v.map(x => x.name === s.name && x.scope === s.scope ? { ...x, enabled: on } : x)); void act("toggle", () => army().skills.enabled(s.name, s.scope, on)); }} />On</label>
                {s.source?.kind === "github" && <button type="button" className="icon-button lg" title="Update from GitHub" aria-label={`Update ${s.name}`} disabled={!!busy} onClick={() => void act("update", () => army().skills.update(s.name, s.scope))}><ArrowPathIcon className={busy === "update" ? "spin" : ""} /></button>}
                <button type="button" className="icon-button lg" title="Show in folder" aria-label={`Show ${s.name} in folder`} onClick={() => army().skills.reveal(s.name, s.scope)}><FolderArrowDownIcon /></button>
                <button type="button" className="icon-button lg danger" title="Remove" aria-label={`Remove ${s.name}`} onClick={async () => { if (await ask.confirm(`Remove ${s.name}?`, { description: "Its folder is deleted.", action: "Remove", danger: true })) void act("remove", () => army().skills.remove(s.name, s.scope)); }}><TrashIcon /></button>
              </div>
            </div>
            {open[key] !== undefined && <pre className="mem-index skill-body">{open[key]}</pre>}
          </div>;
        })}
        {items && !items.length && <p className="skill-hint">No skills yet.</p>}

        <ClaudeSkills />

        <h2 className="label skill-label">Who gets skills</h2>
        <label className="setting-row skill-who">
          <div><b>Other Claude agents too</b><p>The boss always gets every skill that is on. Turn this on to give them to every agent that runs on Claude. Takes effect when an agent starts.</p></div>
          <input type="checkbox" aria-label="Give skills to other Claude agents" checked={claudeAgents} onChange={e => { setClaudeAgents(e.target.checked); void act("settings", () => army().skills.settings({ claudeAgents: e.target.checked })); }} />
        </label>
      </div>
    </div>
  );
}
