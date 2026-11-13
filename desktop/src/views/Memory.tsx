import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderArrowDownIcon, MagnifyingGlassIcon, PlusIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { Button } from "../components/common";
import { ask } from "../components/ask";

type Entity = { name: string; entityType: string; observations: string[]; summary: string; pinned: boolean; updatedAt: string };
type Relation = { from: string; to: string; relationType: string };
type Scope = "project" | "global";
type Snapshot = {
  settings: { projectEnabled: boolean; globalEnabled: boolean; includeGlobal: boolean; autoInject: boolean; bossCanWrite: boolean; budgetTokens: number; disableProviderMemory: boolean };
  scopes: Record<Scope, { file: string; enabled: boolean; entities: Entity[]; relations: Relation[]; tokens: number }>;
  overview: { text: string; shown: number; total: number; tokens: number };
  activity: { t: string; by: string; tool: string; scope: string; detail?: string; ok: boolean; tokens?: number; results?: number; error?: string }[];
};
type Draft = { name: string; entityType: string; summary: string; pinned: boolean; observations: string; isNew: boolean };

const army = () => (window as any).army;
const clean = (e: unknown) => String(e).replace(/^Error: Error invoking remote method '[^']+': (Error: )?/, "");
const TOOL_LABEL: Record<string, string> = { memory_search: "Searched", memory_open: "Opened", memory_overview: "Read index", create_entities: "Created", add_observations: "Added facts", update_entity: "Updated", create_relations: "Linked", delete_observations: "Removed facts", delete_entities: "Deleted", delete_relations: "Unlinked" };

function useMemory() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => army().memory.get().then(setData).catch((e: unknown) => setError(clean(e))), []);
  useEffect(() => { void load(); return army().on("memory-changed", () => void load()); }, [load]);
  return { data, setData, error, setError, load };
}

/** Settings > Memory: switches and what the boss receives. */
export function MemorySettings({ open }: { open: () => void }) {
  const { data, setData, error, setError, load } = useMemory();
  if (!data) return null;
  const s = data.settings;
  const set = (patch: Partial<Snapshot["settings"]>) => { setData({ ...data, settings: { ...data.settings, ...patch } }); return army().memory.settings(patch).then(load).catch((e: unknown) => setError(clean(e))); };
  const rows: [keyof Snapshot["settings"], string, string][] = [
    ["projectEnabled", "Project memory", "Facts about this workspace, stored in .dispatch/memory/project.jsonl"],
    ["globalEnabled", "Global memory", "Facts true in every workspace, such as your preferences"],
    ["includeGlobal", "Use global memory in this workspace", "Turn off to keep this workspace separate"],
    ["autoInject", "Give the boss the index at start", "Names and one-line summaries; the boss searches for the rest"],
    ["bossCanWrite", "Boss can write", "Off makes memory read-only for the boss"],
    ["disableProviderMemory", "Turn off Claude's own memory for the boss", "So facts are kept in one place you can see"],
  ];
  return (
    <section className="settings-group">
      <h2 className="label">Memory</h2>
      <p className="setting-note">Only the boss uses memory. Other agents get the facts they need inside their task.</p>
      {rows.map(([key, label, hint]) => (
        <label className="setting-row" key={key}>
          <div><b>{label}</b><p>{hint}</p></div>
          <input type="checkbox" aria-label={label} checked={!!s[key]} disabled={key === "includeGlobal" && !s.globalEnabled} onChange={e => void set({ [key]: e.target.checked })} />
        </label>
      ))}
      <label className="setting-row">
        <div><b>Index budget</b><p>Most tokens the start index may use. Pinned entries come first.</p></div>
        <span className="mem-budget"><input type="number" min={0} max={20000} step={100} aria-label="Index budget in tokens" defaultValue={s.budgetTokens} onBlur={e => void set({ budgetTokens: Number(e.target.value) })} /> tokens</span>
      </label>
      <div className="setting-row">
        <div><b>Now</b><p>{data.overview.total ? `${data.scopes.project.entities.length} project and ${data.scopes.global.entities.length} global entries. The boss starts with ${data.overview.shown} of ${data.overview.total} entries, about ${data.overview.tokens} tokens.` : "Memory is empty. The boss fills it while it works, or add entries yourself."}</p></div>
        <Button className="secondary" onClick={open}>Open memory</Button>
      </div>
      {error && <p className="tpl-error">{error}</p>}
    </section>
  );
}

/** Memory view: browse and edit both graphs, see what the boss did and what it receives. */
export function Memory() {
  const { data, error, setError, load } = useMemory();
  const [scope, setScope] = useState<Scope>("project");
  const [tab, setTab] = useState<"entries" | "activity" | "index">("entries");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [link, setLink] = useState({ to: "", relationType: "" });

  const current = data?.scopes[scope];
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...(current?.entities || [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return q ? list.filter(e => [e.name, e.entityType, e.summary, ...e.observations].join(" ").toLowerCase().includes(q)) : list;
  }, [current, query]);

  const pick = (e: Entity) => setDraft({ name: e.name, entityType: e.entityType, summary: e.summary, pinned: e.pinned, observations: e.observations.join("\n"), isNew: false });
  const run = (fn: () => Promise<unknown>) => { setError(""); return fn().then(load).catch((e: unknown) => setError(clean(e))); };
  const save = () => draft && run(async () => {
    await army().memory.save(scope, { ...draft, observations: draft.observations.split("\n") }, draft.isNew);
    setDraft(d => d && { ...d, isNew: false });
  });
  const remove = async () => { if (draft && await ask.confirm(`Delete "${draft.name}"?`, { description: "Its facts and relations are removed from memory.", action: "Delete", danger: true })) { await run(() => army().memory.remove(scope, draft.name)); setDraft(null); } };

  if (!data || !current) return <div className="page prov-page"><div className="view-heading"><h1>Memory</h1></div></div>;
  const relations = draft && !draft.isNew ? current.relations.filter(r => r.from === draft.name || r.to === draft.name) : [];
  const others = current.entities.filter(e => e.name !== draft?.name);

  return (
    <div className="page prov-page mem-page">
      <div className="view-heading">
        <h1>Memory</h1>
        <span className="mem-spacer" />
        <button type="button" className="icon-button lg" title={`Show ${current.file}`} aria-label="Show memory file in folder" onClick={() => army().memory.reveal(scope)}><FolderArrowDownIcon /></button>
      </div>
      <p className="page-lead mem-lead">
        {!current.enabled ? `${scope === "project" ? "Project" : "Global"} memory is off, so the boss cannot see these entries. Turn it on in Settings.` : `Only the boss reads and writes this. ${data.scopes[scope].entities.length} entries, about ${current.tokens} tokens in full; the boss starts with about ${data.overview.tokens} tokens and searches for the rest.`}
      </p>
      <div className="mem-toolbar">
        <div className="mem-seg" role="tablist" aria-label="Memory scope">
          {(["project", "global"] as Scope[]).map(s => <button key={s} role="tab" aria-selected={scope === s} onClick={() => { setScope(s); setDraft(null); }}>{s === "project" ? "Project" : "Global"} <span>{data.scopes[s].entities.length}</span></button>)}
        </div>
        <div className="mem-seg" role="tablist" aria-label="Memory section">
          {([["entries", "Entries"], ["activity", "Activity"], ["index", "Boss index"]] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
        </div>
      </div>
      {error && <p className="tpl-error mem-lead">{error}</p>}

      {tab === "entries" && <div className="mem-body">
        <div className="mem-list">
          <div className="mem-list-head">
            <div className="field-search"><MagnifyingGlassIcon aria-hidden="true" /><input aria-label="Filter entries" placeholder="Filter" value={query} onChange={e => setQuery(e.target.value)} /></div>
            <button type="button" className="icon-button lg" title="New entry" aria-label="New entry" onClick={() => setDraft({ name: "", entityType: "note", summary: "", pinned: false, observations: "", isNew: true })}><PlusIcon /></button>
          </div>
          {rows.map(e => (
            <button key={e.name} className={"list-row mem-row" + (draft && !draft.isNew && draft.name === e.name ? " selected" : "")} onClick={() => pick(e)}>
              <span className="row-text"><b>{e.name}{e.pinned && <em className="mem-pin">Pinned</em>}</b><small>{e.summary || e.observations[0] || "No facts yet"}</small></span>
              <span className="mem-meta">{e.entityType} · {e.observations.length}</span>
            </button>
          ))}
          {!rows.length && <p className="mem-empty">{query ? "No entries match." : "No entries yet. The boss adds them while it works."}</p>}
        </div>

        {draft ? <div className="mem-editor">
          <div className="mem-grid">
            <label className="field">Name<input value={draft.name} disabled={!draft.isNew} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="build-system" /></label>
            <label className="field">Type<input value={draft.entityType} onChange={e => setDraft({ ...draft, entityType: e.target.value })} placeholder="decision, preference, gotcha…" /></label>
          </div>
          <label className="field">Summary <span className="field-hint">One line. This is what the boss sees at start.</span><input value={draft.summary} maxLength={200} onChange={e => setDraft({ ...draft, summary: e.target.value })} /></label>
          <label className="field">Facts <span className="field-hint">One per line. The boss gets matching lines when it searches.</span><textarea className="mem-facts" value={draft.observations} onChange={e => setDraft({ ...draft, observations: e.target.value })} /></label>
          <label className="option-row mem-pinrow"><input type="checkbox" checked={draft.pinned} onChange={e => setDraft({ ...draft, pinned: e.target.checked })} />Pin: give the boss every fact of this entry at start</label>
          {!draft.isNew && <div className="field">Relations
            <div className="mem-rel-list">
              {relations.map(r => <div className="mem-rel" key={`${r.from}|${r.relationType}|${r.to}`}><span><b>{r.from}</b> {r.relationType} <b>{r.to}</b></span><button type="button" className="icon-button" aria-label="Remove relation" onClick={() => void run(() => army().memory.relation(scope, r, true))}><XMarkIcon /></button></div>)}
              {!relations.length && <span className="field-hint">None</span>}
            </div>
            {others.length > 0 && <div className="mem-rel-add">
              <input aria-label="Relation" placeholder="depends on" value={link.relationType} onChange={e => setLink({ ...link, relationType: e.target.value })} />
              <select aria-label="Related entry" value={link.to} onChange={e => setLink({ ...link, to: e.target.value })}><option value="">Choose entry</option>{others.map(o => <option key={o.name}>{o.name}</option>)}</select>
              <Button className="secondary" disabled={!link.to || !link.relationType.trim()} onClick={() => void run(() => army().memory.relation(scope, { from: draft.name, to: link.to, relationType: link.relationType })).then(() => setLink({ to: "", relationType: "" }))}>Link</Button>
            </div>}
          </div>}
          <div className="mem-actions">
            {!draft.isNew && <Button className="danger-ghost" onClick={() => void remove()}>Delete</Button>}
            <span className="mem-spacer" />
            <Button className="ghost" onClick={() => setDraft(null)}>Close</Button>
            <Button className="primary" disabled={!draft.name.trim()} onClick={() => void save()}>{draft.isNew ? "Create" : "Save"}</Button>
          </div>
        </div> : <div className="mem-editor mem-empty">Choose an entry to see and edit its facts.</div>}
      </div>}

      {tab === "activity" && <div className="mem-activity">
        <div className="mem-list-head"><span className="field-hint">What the boss and you did with memory in this workspace, newest first. "Gave" is the size of what memory returned to the boss.</span><span className="mem-spacer" />{data.activity.length > 0 && <Button className="ghost" onClick={() => void run(() => army().memory.clearActivity())}>Clear</Button>}</div>
        <table className="mem-table">
          <thead><tr><th>Time</th><th>Who</th><th>Action</th><th>Scope</th><th>Details</th><th>Gave</th></tr></thead>
          <tbody>{data.activity.map((a, i) => <tr key={i} className={a.ok ? "" : "mem-failed"}>
            <td>{new Date(a.t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
            <td>{a.by}</td><td>{TOOL_LABEL[a.tool] || a.tool}</td><td>{a.scope}</td>
            <td className="mem-detail">{a.ok ? a.detail : `Failed: ${a.error}`}{a.results !== undefined && a.ok ? ` · ${a.results} results` : ""}</td>
            <td>{a.tokens ? `~${a.tokens} tokens` : ""}</td>
          </tr>)}</tbody>
        </table>
        {!data.activity.length && <p className="mem-empty">Nothing yet.</p>}
      </div>}

      {tab === "index" && <div className="mem-activity">
        <p className="field-hint">Exactly what is added to the boss prompt when it starts: {data.overview.shown} of {data.overview.total} entries, about {data.overview.tokens} tokens.{data.settings.autoInject ? "" : " Giving the index at start is off, so the boss gets none of this."}</p>
        <pre className="mem-index">{data.overview.text.trim() || "Memory is empty."}</pre>
      </div>}
    </div>
  );
}
