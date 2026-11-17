import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDownTrayIcon, ArrowUpTrayIcon, MagnifyingGlassIcon } from "@heroicons/react/16/solid";
import { Button } from "../components/common";

type Agent = { id: string; name: string; description: string; provider: string; model: string; role: string; scope: string };
type Team = { id: string; name: string; description: string; scope: string; members: number; uses?: string[] };
type Skill = { id: string; name: string; description: string; scope: string; files: number; scripts: number };
type Inventory = { name: string; workspace: string; agents: Agent[]; teams: Team[]; skills: Skill[]; memory: Record<"project" | "global", { entities: number; relations: number }>; settings: string[]; outputs: { files: number; bytes: number } };
type PackItem = { path: string; name: string; description?: string; exists?: boolean; provider?: string; model?: string; members?: number; files?: number; scripts?: number };
type Opened = { id: string; file: string; manifest: { name: string; description: string; author: string; created: string; kind: string }; agents: PackItem[]; teams: PackItem[]; skills: PackItem[]; memory: Record<string, { entities: number; relations: number }>; settings: string[]; outputs: { files: number; bytes: number } | null; warnings: string[] };

const army = () => (window as any).army;
const clean = (e: unknown) => String(e).replace(/^Error: Error invoking remote method '[^']+': (Error: )?/, "");
const SCOPE: Record<string, string> = { project: "This workspace", global: "Every workspace", "claude-project": "Claude Code, this project", "claude-user": "Claude Code, personal", "dispatch-project": "Dispatch, this workspace", "dispatch-global": "Dispatch, every workspace" };
const size = (n: number) => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** One step of the page: what it is on the left, the controls on the right. */
function Section({ title, hint, tools, children }: { title: string; hint?: ReactNode; tools?: ReactNode; children: ReactNode }) {
  return <section className="share-section">
    <header><h2>{title}</h2>{hint && <p>{hint}</p>}{tools && <div className="share-tools">{tools}</div>}</header>
    <div className="share-body">{children}</div>
  </section>;
}

function Group<T extends { id: string; name: string; description?: string }>({ title, hint, items, picked, setPicked, meta, empty }: { title: string; hint: string; items: T[]; picked: Set<string>; setPicked: (s: Set<string>) => void; meta: (x: T) => string; empty: string }) {
  const [q, setQ] = useState("");
  if (!items.length) return <Section title={title} hint={hint}><p className="share-empty">{empty}</p></Section>;
  const query = q.trim().toLowerCase();
  const rows = items.filter(x => !query || `${x.name} ${x.description || ""}`.toLowerCase().includes(query));
  const set = (ids: string[], on: boolean) => { const next = new Set(picked); for (const id of ids) on ? next.add(id) : next.delete(id); setPicked(next); };
  const count = items.filter(x => picked.has(x.id)).length;
  return <Section title={title} hint={hint} tools={<>
    <span className="share-count">{count} of {items.length} selected</span>
    {items.length > 1 && <span className="share-all"><Button className="ghost" onClick={() => set(rows.map(x => x.id), true)}>All</Button><Button className="ghost" onClick={() => set(rows.map(x => x.id), false)}>None</Button></span>}
  </>}>
    {items.length > 8 && <div className="field-search share-filter"><MagnifyingGlassIcon aria-hidden="true" /><input aria-label={`Filter ${title}`} placeholder={`Filter ${items.length} ${title.toLowerCase()}`} value={q} onChange={e => setQ(e.target.value)} /></div>}
    <div className="share-list">
      {rows.map(x => <label className="option-row" key={x.id}>
        <input type="checkbox" aria-label={`Export ${x.name}`} checked={picked.has(x.id)} onChange={e => set([x.id], e.target.checked)} />
        <span className="row-text"><b>{x.name}</b><small>{x.description || "No description"}</small></span>
        <span className="mem-meta">{meta(x)}</span>
      </label>)}
      {rows.length === 0 && <p className="share-empty">Nothing matches "{q}".</p>}
    </div>
  </Section>;
}

function Export() {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [memory, setMemory] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState(true);
  const [outputs, setOutputs] = useState(false);
  const [meta, setMeta] = useState({ name: "", description: "", author: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ file: string; size: number } | null>(null);
  useEffect(() => {
    army().packs.inventory().then((i: Inventory) => {
      setInv(i);
      setMeta(m => ({ ...m, name: m.name || i.name }));
      // A trained workspace by default: what lives in this workspace. Personal and global things stay off.
      setPicked(new Set([...i.agents.filter(a => a.scope === "project" || a.scope === "claude-project"), ...i.teams.filter(t => t.scope === "project"), ...i.skills.filter(s => s.scope === "dispatch-project" || s.scope === "claude-project")].map(x => x.id)));
      setMemory(new Set(i.memory.project.entities ? ["project"] : []));
    }).catch((e: unknown) => setError(clean(e)));
  }, []);
  if (!inv) return <div className="prov-list">{error && <p className="tpl-error">{error}</p>}</div>;
  const sub = <T extends { id: string }>(list: T[]) => list.filter(x => picked.has(x.id)).map(x => x.id);
  const total = sub(inv.agents).length + sub(inv.teams).length + sub(inv.skills).length + memory.size + (settings && inv.settings.length ? 1 : 0) + (outputs ? 1 : 0);
  const scripts = inv.skills.filter(s => picked.has(s.id)).reduce((n, s) => n + s.scripts, 0);
  const run = async () => {
    setBusy(true); setError(""); setDone(null);
    try {
      const r = await army().packs.export({ agents: sub(inv.agents), teams: sub(inv.teams), skills: sub(inv.skills), memory: [...memory], settings: settings && inv.settings.length > 0, outputs }, meta);
      if (r) setDone(r);
    } catch (e) { setError(clean(e)); } finally { setBusy(false); }
  };
  const mem = (scope: "project" | "global", label: string, note: string) => {
    const m = inv.memory[scope];
    return <label className="option-row">
      <input type="checkbox" aria-label={`Export ${label}`} disabled={!m.entities} checked={memory.has(scope)} onChange={e => { const n = new Set(memory); e.target.checked ? n.add(scope) : n.delete(scope); setMemory(n); }} />
      <span className="row-text"><b>{label}</b><small>{note}</small></span>
      <span className="mem-meta">{m.entities ? `${plural(m.entities, "entry", "entries")} · ${plural(m.relations, "link")}` : "Empty"}</span>
    </label>;
  };
  // Empty kinds get one quiet line instead of three sections that each say "nothing here".
  const missing = [!inv.agents.length && "agent templates", !inv.teams.length && "teams", !inv.skills.length && "skills"].filter(Boolean) as string[];
  return <>
    <div className="prov-list">
      <p className="page-lead">Pack what this workspace has learned into one <b>.dispatch</b> file. Whoever opens it gets the same setup. Chats, logs and sign-ins are never included.</p>
      <Section title="About the pack" hint="Shown to whoever opens the file, before anything is added.">
        <div className="share-fields">
          <label className="field">Name<input aria-label="Pack name" value={meta.name} maxLength={120} onChange={e => setMeta({ ...meta, name: e.target.value })} /></label>
          <label className="field">Author<input aria-label="Pack author" placeholder="Optional" value={meta.author} maxLength={120} onChange={e => setMeta({ ...meta, author: e.target.value })} /></label>
          <label className="field wide">Description<textarea aria-label="Pack description" rows={2} placeholder="What this setup does and how to use it, for example: makes one YouTube video a day in my format." value={meta.description} onChange={e => setMeta({ ...meta, description: e.target.value })} /></label>
        </div>
      </Section>
      {inv.agents.length > 0 && <Group title="Agents" hint="Agent templates: role, provider and model." items={inv.agents} picked={picked} setPicked={setPicked} empty="" meta={a => `${a.role === "boss" ? "Boss · " : ""}${a.provider} · ${SCOPE[a.scope] || a.scope}`} />}
      {inv.teams.length > 0 && <Group title="Teams" hint="A boss with its members. Turning a team on also turns on the agents it is built from." items={inv.teams} picked={picked} setPicked={next => {
        // The pack carries snapshots anyway; adding the templates keeps them editable on the other side.
        for (const t of inv.teams) if (next.has(t.id) && !picked.has(t.id)) for (const a of t.uses || []) next.add(a);
        setPicked(next);
      }} empty="" meta={t => `${plural(t.members, "member")} · ${SCOPE[t.scope]}`} />}
      {inv.skills.length > 0 && <Group title="Skills" hint="Skills installed in Dispatch or in Claude Code." items={inv.skills} picked={picked} setPicked={setPicked} empty="" meta={s => `${SCOPE[s.scope] || s.scope}${s.scripts ? ` · ${plural(s.scripts, "script")}` : ""}`} />}
      {missing.length > 0 && <Section title="Not here yet" hint="Make them under Agent templates and Skills; they show up here.">
        <p className="share-missing">This workspace has no {missing.length > 1 ? `${missing.slice(0, -1).join(", ")} or ${missing[missing.length - 1]}` : missing[0]} to pack.</p>
      </Section>}
      <Section title="Memory and extras" hint="What the boss knows, and optional workspace files.">
        <div className="share-list">
          {mem("project", "Workspace memory", "What the boss learned in this workspace.")}
          {mem("global", "Global memory", "Facts kept for every workspace. Often about you, so check it before you share.")}
          {inv.settings.length > 0 && <label className="option-row">
            <input type="checkbox" aria-label="Export workspace settings" checked={settings} onChange={e => setSettings(e.target.checked)} />
            <span className="row-text"><b>Workspace settings</b><small>Boss provider choice, which templates the boss sees, memory switches and schedules (they arrive paused).</small></span>
            <span className="mem-meta">{plural(inv.settings.length, "file")}</span>
          </label>}
          {inv.outputs.files > 0 && <label className="option-row">
            <input type="checkbox" aria-label="Export outputs" checked={outputs} onChange={e => setOutputs(e.target.checked)} />
            <span className="row-text"><b>Outputs</b><small>Files the agents produced, as examples of the result. Up to 200 MB.</small></span>
            <span className="mem-meta">{plural(inv.outputs.files, "file")} · {size(inv.outputs.bytes)}</span>
          </label>}
        </div>
      </Section>
    </div>
    <footer className="share-bar">
      <div className="share-sum">
        {error ? <span className="tpl-error">{error}</span>
          : done ? <><b>Saved · {size(done.size)}</b><small title={done.file}>{done.file}</small></>
          : <><b>{total ? `${plural(total, "item")} in this pack` : "Nothing selected yet"}</b>{scripts > 0 && <small>Includes {plural(scripts, "script")}. People who import the pack are warned.</small>}</>}
      </div>
      {done && !error && <Button className="ghost" onClick={() => army().packs.reveal(done.file)}>Show in folder</Button>}
      <Button className="primary" disabled={!total || busy || !meta.name.trim()} onClick={() => void run()}><ArrowUpTrayIcon aria-hidden="true" />{busy ? "Exporting…" : "Export pack"}</Button>
    </footer>
  </>;
}

function Import({ workspace, openFile, clearFile, openWorkspace }: { workspace: string; openFile: string | null; clearFile: () => void; openWorkspace: (t: string) => Promise<void> }) {
  const [pack, setPack] = useState<Opened | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [memory, setMemory] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState(true);
  const [replace, setReplace] = useState(false);
  const [takeOutputs, setTakeOutputs] = useState(true);
  const [scope, setScope] = useState("project");
  const [target, setTarget] = useState<"here" | "new">("here");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);
  const [over, setOver] = useState(false);
  const show = useCallback((p: Opened | null) => {
    if (!p) return;
    setPack(p); setSkip(new Set()); setResult(null); setError("");
    setMemory(Object.fromEntries(Object.keys(p.memory).map(k => [k, k === "project" ? "project" : ""])));
  }, []);
  useEffect(() => { if (openFile) { army().packs.open(openFile).then(show).catch((e: unknown) => setError(clean(e))); clearFile(); } }, [openFile, show, clearFile]);
  const choose = async () => { setError(""); try { show(await army().packs.choose()); } catch (e) { setError(clean(e)); } };
  const close = () => { if (pack) void army().packs.discard(pack.id); setPack(null); };
  const items = useMemo(() => pack ? [...pack.agents.map(x => ({ ...x, kind: "Agent" })), ...pack.teams.map(x => ({ ...x, kind: "Team" })), ...pack.skills.map(x => ({ ...x, kind: "Skill" }))] : [], [pack]);
  const run = async () => {
    if (!pack) return;
    setBusy(true); setError("");
    const keep = (list: PackItem[]) => list.filter(x => !skip.has(x.path)).map(x => x.path);
    try {
      const r = await army().packs.import(pack.id, { agents: keep(pack.agents), teams: keep(pack.teams), skills: keep(pack.skills), memory: Object.fromEntries(Object.entries(memory).map(([k, v]) => [k, v || null])), settings, scope, replace, outputs: takeOutputs }, target === "new");
      if (!r) return;
      setResult(r); setPack(null);
      if (target === "new" && r.workspace && r.workspace.toLowerCase() !== workspace.toLowerCase()) await openWorkspace(r.workspace);
    } catch (e) { setError(clean(e)); } finally { setBusy(false); }
  };
  const conflicts = items.filter(x => x.exists && !skip.has(x.path)).length;
  const taking = items.length - skip.size;
  const extras = pack ? pack.settings.length > 0 || !!pack.outputs || Object.keys(pack.memory).length > 0 : false;
  const drop = (e: React.DragEvent) => {
    e.preventDefault(); setOver(false); setError("");
    const f = e.dataTransfer.files[0]; const file = f ? (window as any).army.pathFor(f) : "";
    if (!file || !/\.dispatch$/i.test(file)) { setError("Drop a .dispatch file."); return; }
    army().packs.open(file).then(show).catch((err: unknown) => setError(clean(err)));
  };
  if (!pack) return <div className="prov-list">
    <p className="page-lead">Open a <b>.dispatch</b> file someone shared. You see everything inside before anything is added.</p>
    {result && <div className="share-result"><b>Imported</b><small>{[plural(result.agents, "agent"), plural(result.teams, "team"), plural(result.skills, "skill"), result.memory ? plural(result.memory, "memory entry", "memory entries") : "", result.schedules ? plural(result.schedules, "paused schedule") : "", result.outputs ? plural(result.outputs, "output") : ""].filter(Boolean).join(" · ")}{result.skipped.length ? ` · skipped ${result.skipped.join(", ")}` : ""}</small></div>}
    <div className={"share-drop" + (over ? " over" : "")} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
      <ArrowDownTrayIcon aria-hidden="true" />
      <b>Drop a .dispatch file here</b>
      <small>or double-click one in your folders, it opens here too</small>
      <Button className="primary" onClick={() => void choose()}>Choose a file…</Button>
      {error && <p className="tpl-error">{error}</p>}
    </div>
  </div>;
  return <>
    <div className="prov-list" aria-label="Pack contents">
      <div className="share-packhead">
        <b>{pack.manifest.name}</b>
        <small>{[pack.manifest.author && `by ${pack.manifest.author}`, pack.manifest.created && new Date(pack.manifest.created).toLocaleDateString()].filter(Boolean).join(" · ")}</small>
        {pack.manifest.description && <p>{pack.manifest.description}</p>}
      </div>
      {pack.warnings.map(w => <p className="skill-warn" key={w}>{w}</p>)}
      {items.length > 0 && <Section title="What comes in" hint="Turn off anything you do not want." tools={<span className="share-count">{taking} of {items.length} selected</span>}>
        <div className="share-list">
          {items.map(x => <label className="option-row" key={x.path}>
            <input type="checkbox" aria-label={`Import ${x.name}`} checked={!skip.has(x.path)} onChange={e => { const n = new Set(skip); e.target.checked ? n.delete(x.path) : n.add(x.path); setSkip(n); }} />
            <span className="row-text"><b>{x.name}{x.exists && <em className="mem-pin">{replace ? "Replaces yours" : "You have one, skipped"}</em>}</b><small>{x.description || "No description"}</small></span>
            <span className="mem-meta">{x.kind}{x.provider ? ` · ${x.provider}` : ""}{x.members !== undefined ? ` · ${plural(x.members, "member")}` : ""}{x.scripts ? ` · ${plural(x.scripts, "script")}` : ""}</span>
          </label>)}
        </div>
      </Section>}
      {extras && <Section title="Memory and extras" hint="What their boss knew, and optional workspace files.">
        <div className="share-list">
          {Object.entries(pack.memory).map(([k, m]) => <div className="option-row share-memrow" key={k}>
            <span className="row-text"><b>{k === "project" ? "Their workspace memory" : "Their global memory"}</b><small>{plural(m.entities, "entry", "entries")}</small></span>
            <select aria-label={`Import ${k} memory`} value={memory[k] || ""} onChange={e => setMemory({ ...memory, [k]: e.target.value })}>
              <option value="project">Add to this workspace's memory</option>
              <option value="global">Add to my global memory</option>
              <option value="">Do not import</option>
            </select>
          </div>)}
          {pack.settings.length > 0 && <label className="option-row"><input type="checkbox" aria-label="Import workspace settings" checked={settings} onChange={e => setSettings(e.target.checked)} /><span className="row-text"><b>Workspace settings</b><small>Boss provider choice, visible templates, memory switches.</small></span></label>}
          {pack.outputs && <label className="option-row"><input type="checkbox" aria-label="Import outputs" checked={takeOutputs} onChange={e => setTakeOutputs(e.target.checked)} /><span className="row-text"><b>Outputs</b><small>Example results, copied to .dispatch/outputs.</small></span><span className="mem-meta">{plural(pack.outputs.files, "file")} · {size(pack.outputs.bytes)}</span></label>}
        </div>
      </Section>}
      <Section title="Where it goes" hint="Nothing of yours is overwritten unless you say so.">
        <div className="share-fields">
          <label className="field">Import into<select aria-label="Import target" value={target} onChange={e => setTarget(e.target.value as "here" | "new")}><option value="here">This workspace</option><option value="new">A new folder…</option></select></label>
          <label className="field">Agents, teams and skills for<select aria-label="Import scope" value={scope} onChange={e => setScope(e.target.value)}><option value="project">That workspace only</option><option value="global">Every workspace</option></select></label>
        </div>
        <div className="share-list">
          <label className="option-row"><input type="checkbox" aria-label="Replace items with the same name" checked={replace} onChange={e => setReplace(e.target.checked)} /><span className="row-text"><b>Replace mine</b><small>{conflicts ? `${plural(conflicts, "item")} with a name you already have ${replace ? "will be replaced" : "will be skipped"}.` : "Nothing in this pack has a name you already use."}</small></span></label>
        </div>
      </Section>
    </div>
    <footer className="share-bar">
      <div className="share-sum">{error ? <span className="tpl-error">{error}</span> : <><b>{plural(taking, "item")} to import</b><small title={pack.file}>{pack.file}</small></>}</div>
      <Button className="ghost" onClick={close}>Cancel</Button>
      <Button className="primary" disabled={busy} onClick={() => void run()}><ArrowDownTrayIcon aria-hidden="true" />{busy ? "Importing…" : "Import"}</Button>
    </footer>
  </>;
}

/** Share a trained workspace as a .dispatch pack, or bring one in. */
export function Share({ workspace, openFile, clearFile, openWorkspace }: { workspace: string; openFile: string | null; clearFile: () => void; openWorkspace: (t: string) => Promise<void> }) {
  const [tab, setTab] = useState<"export" | "import">(openFile ? "import" : "export");
  useEffect(() => { if (openFile) setTab("import"); }, [openFile]);
  return (
    <div className="page prov-page share-page">
      <div className="view-heading"><h1>Share</h1>
        <div className="mem-seg" role="tablist" aria-label="Share">
          <button role="tab" aria-selected={tab === "export"} onClick={() => setTab("export")}>Export</button>
          <button role="tab" aria-selected={tab === "import"} onClick={() => setTab("import")}>Import</button>
        </div>
      </div>
      {tab === "export" ? <Export key={workspace} /> : <Import workspace={workspace} openFile={openFile} clearFile={clearFile} openWorkspace={openWorkspace} />}
    </div>
  );
}
