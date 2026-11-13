import React, { useEffect, useMemo, useState } from "react";
import { ChevronRightIcon, PencilSquareIcon, PlusIcon, TrashIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { Button, ProviderIcon } from "../components/common";
import { ask } from "../components/ask";
import { labels } from "../lib/data";

type Tpl = { file?: string; scope: string; name: string; description: string; provider: string; model: string; extra?: Record<string, string> };
export type Team = {
  file?: string; scope: string; name: string; description: string;
  boss: { template: string; provider: string; model: string; notes: string };
  members: { name: string; template: string }[];
};
const PROVIDERS = ["claude", "codex", "antigravity", "opencode", "qoder", "gemini"];
const blank = (boss = ""): Team => ({ scope: "global", name: "", description: "", boss: { template: boss, provider: "", model: "", notes: "" }, members: [] });
const clean = (e: unknown) => String((e as any)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return <section className="tpl-section"><header><h2>{title}</h2>{help && <p>{help}</p>}</header><div className="tpl-section-body">{children}</div></section>;
}

/** Saved teams: a boss setup plus members, started together from Home or New chat. */
export function Teams({ tabs, templates, models, editTemplate }: { tabs: React.ReactNode; templates: Tpl[]; models: Record<string, string[]>; editTemplate: (file: string) => void }) {
  const army = (window as any).army;
  const bosses = templates.filter(t => t.extra?.role === "boss");
  const agents = templates.filter(t => t.extra?.role !== "boss");
  const [items, setItems] = useState<Team[]>([]);
  const [draft, setDraft] = useState<Team>(blank(bosses[0]?.name));
  const [saved, setSaved] = useState(JSON.stringify(draft));
  const [status, setStatus] = useState(""); const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const load = async (select?: string) => {
    const list: Team[] = await army.teams.list(); setItems(list);
    const pick = list.find(t => t.file === select); if (pick) { setDraft(pick); setSaved(JSON.stringify(pick)); }
  };
  useEffect(() => { void load().catch(e => setError(clean(e))); return army.on("teams-changed", () => void load()); }, []);
  const dirty = JSON.stringify(draft) !== saved;
  const set = (patch: Partial<Team>) => { setDraft(d => ({ ...d, ...patch })); setStatus(""); setError(""); };
  const setBoss = (patch: Partial<Team["boss"]>) => set({ boss: { ...draft.boss, ...patch } });
  const setMember = (i: number, patch: Partial<Team["members"][number]>) => set({ members: draft.members.map((m, j) => j === i ? { ...m, ...patch } : m) });
  const bossTpl = bosses.find(t => t.name === draft.boss.template);
  const bossProvider = draft.boss.provider || bossTpl?.provider || "claude";
  const bossModels = useMemo(() => models[bossProvider] || ["default"], [models, bossProvider]);

  const open = async (t: Team) => {
    if (dirty && !(await ask.confirm("Discard unsaved changes?", { action: "Discard", danger: true }))) return;
    setDraft(t); setSaved(JSON.stringify(t)); setStatus(""); setError("");
  };
  const save = async () => { try { const file = await army.teams.save(draft); await load(file); setStatus("Team saved."); } catch (e) { setError(clean(e)); } };
  const remove = async () => {
    if (!draft.file || !(await ask.confirm(`Delete ${draft.name}?`, { description: "The team is removed. Its agent templates stay.", action: "Delete team", danger: true }))) return;
    try { await army.teams.remove(draft.file); const b = blank(bosses[0]?.name); setDraft(b); setSaved(JSON.stringify(b)); setStatus("Deleted."); } catch (e) { setError(clean(e)); }
  };
  const addMember = () => {
    const tpl = agents[0]; if (!tpl) return;
    let name = tpl.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-"); for (let i = 2; draft.members.some(m => m.name === name); i++) name = `${tpl.name.toLowerCase()}-${i}`;
    set({ members: [...draft.members, { name, template: tpl.name }] });
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  });
  const groups = (["global", "project"] as const).map(s => [s, items.filter(t => t.scope === s)] as const).filter(([, l]) => l.length);

  return <>
    <div className="tpl-list">
      <div className="tpl-list-head">{tabs}<button type="button" className="icon-button" aria-label="New team" title="New team" onClick={() => open(blank(bosses[0]?.name))}><PlusIcon /></button></div>
      {groups.length === 0 && <p className="tpl-visibility-help">No teams yet. A team is a boss plus the agents it starts with, ready in any folder with one click.</p>}
      {groups.map(([scope, list]) => {
        const expanded = !collapsed[scope];
        return <div key={scope} className="tpl-group">
          <button className="tpl-group-toggle" aria-expanded={expanded} onClick={() => setCollapsed(v => ({ ...v, [scope]: expanded }))}><span>{scope === "global" ? "All workspaces" : "This workspace"}</span><span className="tpl-group-meta"><small>{list.length}</small><ChevronRightIcon className="chev" aria-hidden="true" /></span></button>
          <div className="collapse" inert={!expanded}><div className="collapse-inner">{list.map(t => (
            <Button key={t.file} className={"list-row " + (draft.file === t.file ? "selected" : "")} onClick={() => open(t)}>
              <span className="team-stack" aria-hidden="true">{[t.boss, ...t.members].slice(0, 3).map((m: any, i) => <ProviderIcon key={i} provider={(m.provider || templates.find(x => x.name === m.template)?.provider || "claude")} alt="" />)}</span>
              <span className="row-text"><b>{t.name}</b><small>Boss + {t.members.length} agent{t.members.length === 1 ? "" : "s"}</small></span>
            </Button>))}</div></div>
        </div>;
      })}
    </div>

    <div className="tpl-form">
      <div className="tpl-head">
        <div className="tpl-title"><h1>{draft.name || "New team"}{dirty && <i className="dirty" title="Unsaved changes" />}</h1><small>Team · {draft.scope === "global" ? "All workspaces" : "This workspace"}</small></div>
        <span className="grow" />
        {draft.file && <button type="button" className="icon-button lg danger" aria-label="Delete team" title="Delete team" onClick={remove}><TrashIcon /></button>}
      </div>
      <div className="tpl-scroll">
        <Section title="Identity" help="Pick this team when you start a new operation.">
          <div className="tpl-fields two">
            <label className="field">Name<input value={draft.name} onChange={e => set({ name: e.target.value })} placeholder="Game studio" /></label>
            <label className="field">Saved in<select value={draft.scope} onChange={e => set({ scope: e.target.value })}><option value="global">All workspaces</option><option value="project">This workspace</option></select></label>
            <label className="field wide">Description<input value={draft.description} onChange={e => set({ description: e.target.value })} placeholder="What this team builds" /></label>
          </div>
        </Section>
        <Section title="Boss" help="Leads this team. Model and notes apply only when the boss runs with this team.">
          <div className="tpl-fields two">
            <div className="field">Boss template
              <div className="model-pick">
                <select aria-label="Boss template" value={draft.boss.template} onChange={e => setBoss({ template: e.target.value, provider: "", model: "" })}>{bosses.map(b => <option key={b.file} value={b.name}>{b.name}</option>)}</select>
                {bossTpl?.file && <button type="button" className="icon-button" title="Edit boss template" aria-label="Edit boss template" onClick={() => editTemplate(bossTpl.file!)}><PencilSquareIcon /></button>}
              </div>
            </div>
            <span />
            <label className="field">Provider<select aria-label="Boss provider" value={bossProvider} onChange={e => setBoss({ provider: e.target.value, model: (models[e.target.value] || ["default"])[0] })}>{PROVIDERS.map(p => <option key={p} value={p}>{labels[p] || p}{p === bossTpl?.provider ? " (template)" : ""}</option>)}</select></label>
            <label className="field">Model<select aria-label="Boss model" value={draft.boss.model || bossTpl?.model || bossModels[0]} onChange={e => setBoss({ model: e.target.value, provider: bossProvider })}>{[...new Set([...(draft.boss.model ? [draft.boss.model] : []), ...(bossProvider === bossTpl?.provider && bossTpl.model ? [bossTpl.model] : []), ...bossModels])].map(m => <option key={m} value={m}>{m}</option>)}</select></label>
            <label className="field wide prompt">Notes for the boss<textarea aria-label="Notes for the boss" value={draft.boss.notes} onChange={e => setBoss({ notes: e.target.value })} placeholder="How this team works: who owns what, conventions, the definition of done." spellCheck={false} /></label>
          </div>
        </Section>
        <Section title="Members" help="Started with the boss. Each name is how the boss addresses the agent.">
          <div className="member-list">
            {draft.members.map((m, i) => {
              const tpl = agents.find(t => t.name === m.template);
              return <div className="member-row" key={i}>
                <ProviderIcon provider={tpl?.provider || "claude"} alt="" />
                <input aria-label={`Member ${i + 1} name`} value={m.name} onChange={e => setMember(i, { name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
                <select aria-label={`Member ${i + 1} template`} value={m.template} onChange={e => setMember(i, { template: e.target.value })}>{!tpl && <option value={m.template}>{m.template} (saved copy)</option>}{agents.map(t => <option key={t.file} value={t.name}>{t.name}{t.description ? ` · ${t.description.slice(0, 48)}` : ""}</option>)}</select>
                <button type="button" className="icon-button" aria-label={`Remove ${m.name}`} title="Remove" onClick={() => set({ members: draft.members.filter((_, j) => j !== i) })}><XMarkIcon /></button>
              </div>;
            })}
            <Button className="ghost add-member" disabled={!agents.length} onClick={addMember}><PlusIcon aria-hidden="true" />Add member</Button>
          </div>
        </Section>
      </div>
      <div className="tpl-actions">
        <Button className="primary" onClick={() => void save()} disabled={!draft.name.trim() || !draft.boss.template}>Save team</Button>
        <kbd>Ctrl S</kbd><span className="grow" />
        {error ? <span className="tpl-error">{error}</span> : status && <span className="tpl-status">{status}</span>}
      </div>
    </div>
  </>;
}
