import React, { useEffect, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, PlayIcon, PlusIcon, TrashIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { Button } from "../components/common";
import { ask } from "../components/ask";

type Tpl = { file?: string; name: string; description: string; extra?: Record<string, string> };
export type Workflow = { file?: string; scope: string; name: string; description: string; notes: string; steps: { template: string; instruction: string }[] };
const blank = (): Workflow => ({ scope: "project", name: "", description: "", notes: "", steps: [{ template: "", instruction: "" }] });
const clean = (e: unknown) => String((e as any)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return <section className="tpl-section"><header><h2>{title}</h2>{help && <p>{help}</p>}</header><div className="tpl-section-body">{children}</div></section>;
}

/** Saved workflows: ordered playbooks the boss follows, optionally mounted on agent templates. */
export function Workflows({ tabs, templates, hasBoss }: { tabs: React.ReactNode; templates: Tpl[]; hasBoss: boolean }) {
  const army = (window as any).army;
  const agents = templates.filter(t => t.extra?.role !== "boss");
  const [items, setItems] = useState<Workflow[]>([]);
  const [draft, setDraft] = useState<Workflow>(blank());
  const [saved, setSaved] = useState(JSON.stringify(blank()));
  const [status, setStatus] = useState(""); const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const load = async (select?: string) => {
    const list: Workflow[] = await army.workflows.list(); setItems(list);
    const pick = list.find(w => w.file === select); if (pick) { setDraft(pick); setSaved(JSON.stringify(pick)); }
  };
  useEffect(() => { void load().catch(e => setError(clean(e))); return army.on("workflows-changed", () => void load()); }, []);
  const dirty = JSON.stringify(draft) !== saved;
  const set = (patch: Partial<Workflow>) => { setDraft(d => ({ ...d, ...patch })); setStatus(""); setError(""); };
  const setStep = (i: number, patch: Partial<Workflow["steps"][number]>) => set({ steps: draft.steps.map((s, j) => j === i ? { ...s, ...patch } : s) });
  const move = (i: number, by: number) => { const steps = [...draft.steps]; const j = i + by; if (j < 0 || j >= steps.length) return; [steps[i], steps[j]] = [steps[j], steps[i]]; set({ steps }); };

  const open = async (w: Workflow) => {
    if (dirty && !(await ask.confirm("Discard unsaved changes?", { action: "Discard", danger: true }))) return;
    setDraft(w); setSaved(JSON.stringify(w)); setStatus(""); setError("");
  };
  const save = async () => { try { const file = await army.workflows.save(draft); await load(file); setStatus("Workflow saved."); } catch (e) { setError(clean(e)); } };
  const remove = async () => {
    if (!draft.file || !(await ask.confirm(`Delete ${draft.name}?`, { description: "The workflow file is removed. Templates that list it simply skip it.", action: "Delete workflow", danger: true }))) return;
    try { await army.workflows.remove(draft.file); const b = blank(); setDraft(b); setSaved(JSON.stringify(b)); await load(); setStatus("Deleted."); } catch (e) { setError(clean(e)); }
  };
  const run = async () => {
    if (dirty && !(await ask.confirm("Run the saved version?", { description: "Unsaved changes are not included.", action: "Run" }))) return;
    try { await army.send("boss", `Run workflow ${draft.name}`); setStatus("Sent to the boss."); } catch (e) { setError(clean(e)); }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  });
  const groups = (["project", "global"] as const).map(s => [s, items.filter(w => w.scope === s)] as const).filter(([, l]) => l.length);

  return <>
    <div className="tpl-list">
      <div className="tpl-list-head">{tabs}</div>
      <div className="tpl-list-head"><span className="grow" /><button type="button" className="icon-button" aria-label="New workflow" title="New workflow" onClick={() => open(blank())}><PlusIcon /></button></div>
      {groups.length === 0 && <p className="tpl-visibility-help">No workflows yet. A workflow is a saved playbook of steps the boss follows, like review, test, release.</p>}
      {groups.map(([scope, list]) => {
        const expanded = !collapsed[scope];
        return <div key={scope} className="tpl-group">
          <button className="tpl-group-toggle" aria-expanded={expanded} onClick={() => setCollapsed(v => ({ ...v, [scope]: expanded }))}><span>{scope === "global" ? "All workspaces" : "This workspace"}</span><span className="tpl-group-meta"><small>{list.length}</small><ChevronRightIcon className="chev" aria-hidden="true" /></span></button>
          <div className="collapse" inert={!expanded}><div className="collapse-inner">{list.map(w => (
            <Button key={w.file} className={"list-row " + (draft.file === w.file ? "selected" : "")} onClick={() => open(w)}>
              <span className="row-text"><b>{w.name}</b><small>{w.steps.length} step{w.steps.length === 1 ? "" : "s"} · {w.scope === "global" ? "Global" : "Project"}</small></span>
            </Button>))}</div></div>
        </div>;
      })}
    </div>

    <div className="tpl-form">
      <div className="tpl-head">
        <div className="tpl-title"><h1>{draft.name || "New workflow"}{dirty && <i className="dirty" title="Unsaved changes" />}</h1><small>Workflow · {draft.scope === "global" ? "Global" : "Project"}</small></div>
        <span className="grow" />
        {draft.file && <button type="button" className="icon-button lg danger" aria-label="Delete workflow" title="Delete workflow" onClick={remove}><TrashIcon /></button>}
      </div>
      <div className="tpl-scroll">
        <Section title="Identity" help="The boss sees the name and description in its catalogue.">
          <div className="tpl-fields two">
            <label className="field">Name<input value={draft.name} onChange={e => set({ name: e.target.value })} placeholder="Release" /></label>
            <label className="field">Saved in<select value={draft.scope} onChange={e => set({ scope: e.target.value })}><option value="project">This workspace</option><option value="global">All workspaces</option></select></label>
            <label className="field wide">Description<input value={draft.description} onChange={e => set({ description: e.target.value })} placeholder="When should this workflow run?" /></label>
          </div>
        </Section>
        <Section title="Steps" help="Followed in order. Pick an agent template for a step, or leave it open for the lead to decide.">
          <div className="member-list">
            {draft.steps.map((s, i) => <div className="step-row" key={i}>
              <span className="step-no">{i + 1}.</span>
              <select aria-label={`Step ${i + 1} agent template`} value={s.template} onChange={e => setStep(i, { template: e.target.value })}>
                <option value="">Any agent</option>
                {s.template && !agents.some(t => t.name === s.template) && <option value={s.template}>{s.template} (not found)</option>}
                {agents.map(t => <option key={t.file} value={t.name}>{t.name}</option>)}
              </select>
              <textarea aria-label={`Step ${i + 1} instruction`} value={s.instruction} onChange={e => setStep(i, { instruction: e.target.value })} placeholder="What happens in this step, and when to continue" spellCheck={false} />
              <span className="step-tools">
                <button type="button" className="icon-button" aria-label={`Move step ${i + 1} up`} title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUpIcon /></button>
                <button type="button" className="icon-button" aria-label={`Move step ${i + 1} down`} title="Move down" disabled={i === draft.steps.length - 1} onClick={() => move(i, 1)}><ArrowDownIcon /></button>
                <button type="button" className="icon-button" aria-label={`Remove step ${i + 1}`} title="Remove" onClick={() => set({ steps: draft.steps.filter((_, j) => j !== i) })}><XMarkIcon /></button>
              </span>
            </div>)}
            <Button className="ghost add-member" onClick={() => set({ steps: [...draft.steps, { template: "", instruction: "" }] })}><PlusIcon aria-hidden="true" />Add step</Button>
          </div>
        </Section>
        <Section title="Notes" help="Optional text shown before the steps.">
          <label className="field prompt"><span className="sr-only">Notes</span><textarea aria-label="Notes" value={draft.notes} onChange={e => set({ notes: e.target.value })} spellCheck={false} /></label>
        </Section>
      </div>
      <div className="tpl-actions">
        <Button className="primary" onClick={() => void save()} disabled={!draft.name.trim()}>Save workflow</Button>
        <Button className="secondary" onClick={() => void run()} disabled={!hasBoss || !draft.file}><PlayIcon aria-hidden="true" />Run</Button>
        <kbd>Ctrl S</kbd><span className="grow" />
        {error ? <span className="tpl-error">{error}</span> : status && <span className="tpl-status">{status}</span>}
      </div>
    </div>
  </>;
}
