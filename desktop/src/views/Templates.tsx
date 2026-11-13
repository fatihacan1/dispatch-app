import React, { useEffect, useMemo, useState } from "react";
import { ChevronRightIcon, FolderArrowDownIcon, MagnifyingGlassIcon, PlusIcon, TrashIcon } from "@heroicons/react/16/solid";
import { Button, ProviderIcon } from "../components/common";
import { Dialog } from "../components/Dialog";
import { ask } from "../components/ask";
import { labels } from "../lib/data";
import { Teams } from "./Teams";

type BossProvider = { enabled: boolean; plan: string; note: string };
type Tpl = {
  file?: string; scope: string; readonly?: boolean; name: string; description: string;
  provider: string; model: string; effort?: string; body: string; extra?: Record<string, string>;
};
const api = () => (window as any).army.templates;
const PROVIDERS = ["claude", "codex", "antigravity", "opencode", "qoder", "gemini", "local"];
const SCOPE_LABEL: Record<string, string> = { project: "Project", global: "Global", claude: "Claude Code", "built-in": "Built-in" };
const blank = (): Tpl => ({ scope: "project", name: "", description: "", provider: "claude", model: "claude-opus-5-5", body: "You are a focused specialist. Report back with dispatch send when you finish." });

function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return <section className="tpl-section"><header><h2>{title}</h2>{help && <p>{help}</p>}</header><div className="tpl-section-body">{children}</div></section>;
}

export function Templates({ hasBoss, activeBossFile, onReloadBoss }: { hasBoss: boolean; activeBossFile?: string; onReloadBoss: (template: Tpl) => Promise<void> }) {
  const [items, setItems] = useState<Tpl[]>([]);
  const [localProviders, setLocalProviders] = useState<{id:string;name:string;model:string}[]>([]);
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [efforts, setEfforts] = useState<Record<string, string[]>>({});
  const [draft, setDraft] = useState<Tpl>(blank());
  const [saved, setSaved] = useState<string>(JSON.stringify(blank()));
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ "built-in": true });
  const [visibleToBoss, setVisibleToBoss] = useState<string[] | null>(null);
  const [visibilityLoaded, setVisibilityLoaded] = useState(false);
  const [showBuiltInAgents, setShowBuiltInAgents] = useState(true);
  const [providerSettings, setProviderSettings] = useState<Record<string, BossProvider>>({});
  const [providerHealth, setProviderHealth] = useState<Record<string, string>>({});
  const [providerReady, setProviderReady] = useState(false);
  const [mcpStatus, setMcpStatus] = useState<Record<string, boolean> | null>(null);
  const [providersExpanded, setProvidersExpanded] = useState(false);
  const [mode, setMode] = useState<"agents" | "teams">("agents");

  const load = async (selectFile?: string) => {
    const r = await api().list();
    setItems(r.items); setModels(r.models); setEfforts(r.efforts || {}); setLocalProviders(r.localProviders || []);
    const pick = r.items.find((t: Tpl) => t.file === selectFile);
    if (pick) { setDraft(pick); setSaved(JSON.stringify(pick)); }
  };
  useEffect(() => {
    void load().catch((e: unknown) => setError(String(e)));
    const bridge = (window as any).army;
    if (bridge.mcpStatus) bridge.mcpStatus().then(setMcpStatus).catch(() => {});
    if (bridge.bossProviders) {
      bridge.bossProviders.get().then((value: Record<string, BossProvider>) => { setProviderSettings(value); setProviderReady(true); }).catch((e: unknown) => setError(String(e)));
    }
    for (const id of PROVIDERS) {
      const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("Timed out")), 15000));
      Promise.race([bridge.providers.check(id), timeout]).then((result: any) => setProviderHealth(v => ({ ...v, [id]: result.installed ? result.auth === "signed-in" ? "Ready" : result.auth === "signed-out" ? "Signed out" : result.auth === "error" ? "Unavailable" : "Installed" : "Not installed" }))).catch(() => setProviderHealth(v => ({ ...v, [id]: "Status unknown" })));
    }
    if (typeof api().getVisibility === "function") {
      api().getVisibility().then((value: string[] | null) => { setVisibleToBoss(value); setVisibilityLoaded(true); }).catch((e: unknown) => setError(String(e)));
    } else {
      setError("Restart Dispatch to enable boss visibility settings.");
    }
    return window.army.on("templates-changed", () => { void load().catch((e: unknown) => setError(String(e))); });
  }, []);
  const toggleVisibility = async (file: string, enabled: boolean) => {
    const current = visibleToBoss ?? items.filter(t => t.extra?.role !== "boss").map(t => t.file).filter((value): value is string => !!value);
    const next = enabled ? [...new Set([...current, file])] : current.filter(value => value !== file);
    setVisibleToBoss(next);
    try { await api().setVisibility(next); setStatus("Boss visibility saved. Restart the boss to update its catalogue."); setError(""); }
    catch (e) { setVisibleToBoss(visibleToBoss); setError(String(e)); }
  };

  const updateProvider = async (id: string, patch: Partial<BossProvider>) => {
    const next = { ...providerSettings, [id]: { ...(providerSettings[id] || { enabled: true, plan: "unknown", note: "" }), ...patch } };
    setProviderSettings(next);
    try { await (window as any).army.bossProviders.save(next); setStatus("Provider settings saved. Restart the boss to update its instructions."); }
    catch (e) { setError(String(e)); }
  };
  const dirty = JSON.stringify(draft) !== saved;
  const set = (patch: Partial<Tpl>) => { setDraft(d => ({ ...d, ...patch })); setStatus(""); setError(""); };
  const modelOptions = useMemo(() => {
    const list = models[draft.provider] || ["default"];
    return draft.model && !list.includes(draft.model) ? [...list, draft.model] : list;
  }, [models, draft.provider, draft.model]);
  const filteredModels = useMemo(() => modelOptions.filter(m => m.toLowerCase().includes(modelSearch.trim().toLowerCase())), [modelOptions, modelSearch]);

  const open = async (t: Tpl) => {
    if (dirty && !(await ask.confirm("Discard unsaved changes?", { action: "Discard", danger: true }))) return;
    setDraft(t); setSaved(JSON.stringify(t)); setStatus(""); setError(""); setModelSearch("");
  };
  const save = async (reloadBoss = false) => {
    try {
      const target = draft.readonly ? { ...draft, scope: "project", file: undefined, readonly: false } : draft;
      const file = await api().save(target);
      await load(file);
      if (reloadBoss) {
        const result = await api().list();
        const savedTemplate = result.items.find((t: Tpl) => t.file === file);
        if (!savedTemplate) throw new Error("Template was saved, but could not be loaded for the boss.");
        try { await onReloadBoss(savedTemplate); } catch (e) { throw new Error(`Template was saved, but the boss could not be reloaded: ${String(e)}`); }
        setStatus("Saved and boss reloaded with a new chat.");
      } else setStatus("Saved to " + file);
    } catch (e: any) { setError(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); }
  };
  const remove = async () => {
    if (!draft.file) return;
    setConfirmDelete(false);
    try { await api().remove(draft.file); setDraft(blank()); setSaved(JSON.stringify(blank())); await load(); setStatus("Deleted."); }
    catch (e: any) { setError(String(e?.message || e)); }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  });

  const matches = (t: Tpl) => [t.name, t.description, t.model, t.provider].some(value => value?.toLowerCase().includes(search.trim().toLowerCase()));
  const groups = [["boss", items.filter(t => t.extra?.role === "boss" && matches(t))] as const, ...["project", "global", "claude", "built-in"].map(s => [s, items.filter(t => t.scope === s && t.extra?.role !== "boss" && matches(t))] as const)].filter(([, l]) => l.length);

  const tabs = <div className="tabs tpl-tabs" role="tablist" aria-label="Template kind" data-active={mode}>
    <button type="button" role="tab" className="tab" aria-selected={mode === "agents"} onClick={() => setMode("agents")}>Agents</button>
    <button type="button" role="tab" className="tab" aria-selected={mode === "teams"} onClick={() => setMode("teams")}>Teams</button>
    <span className="tab-indicator" aria-hidden="true" />
  </div>;
  if (mode === "teams") return <div className="page tpl-page"><Teams tabs={tabs} templates={items} models={models} editTemplate={file => { const t = items.find(x => x.file === file); setMode("agents"); if (t) void open(t); }} /></div>;

  return (
    <div className="page tpl-page">
      {confirmReload && <Dialog title="Save and reload boss?" onClose={() => setConfirmReload(false)} description="The current boss will stop and restart with this template in a new chat. Its current work will be interrupted. The previous chat and workspace files remain available." footer={<><Button className="ghost" autoFocus onClick={() => setConfirmReload(false)}>Cancel</Button><Button className="primary" onClick={() => { setConfirmReload(false); void save(true); }}>Save and reload</Button></>} />}
      {confirmDelete && <Dialog title="Delete template?" onClose={() => setConfirmDelete(false)} description={`${draft.name}.md will be deleted.`} footer={<><Button className="ghost" autoFocus onClick={() => setConfirmDelete(false)}>Cancel</Button><Button className="danger" onClick={remove}>Delete template</Button></>} />}
      <div className="tpl-list">
        <div className="tpl-list-head">{tabs}</div>
        <div className="tpl-list-head">
          <label className="field-search"><MagnifyingGlassIcon aria-hidden="true" /><input aria-label="Search templates" placeholder="Search templates" value={search} onChange={e => setSearch(e.target.value)} /></label>
          <button type="button" className="icon-button" aria-label="New template" title="New template" onClick={() => open(blank())}><PlusIcon /></button>
        </div>
        {groups.length === 0 && <p className="tpl-visibility-help">No matching templates.</p>}
        {groups.map(([scope, list]) => {
          const expanded = search.trim() ? true : !collapsed[scope];
          return <div key={scope} className="tpl-group">
            <button className="tpl-group-toggle" aria-expanded={expanded} onClick={() => setCollapsed(v => ({ ...v, [scope]: expanded }))}><span>{SCOPE_LABEL[scope] || "Boss"}</span><span className="tpl-group-meta"><small>{list.length}</small><ChevronRightIcon className="chev" aria-hidden="true" /></span></button>
            <div className="collapse" aria-hidden={!expanded} inert={!expanded}><div className="collapse-inner">{list.map(t => (
              <Button key={t.file} className={"list-row " + (draft.file === t.file ? "selected" : "")} onClick={() => open(t)}><ProviderIcon className="row-icon" provider={t.provider} alt="" /><span className="row-text"><b>{t.name}</b><small>{t.model || "default"}{scope === "boss" ? ` · ${SCOPE_LABEL[t.scope] || t.scope}` : ""}{scope === "boss" && t.file === activeBossFile ? " · Active" : ""}</small></span></Button>
            ))}</div></div>
          </div>;
        })}
      </div>

      <div className="tpl-form">
        <div className="tpl-head">
          <div className="tpl-title">
            <h1>{draft.name || "New template"}{dirty && <i className="dirty" title="Unsaved changes" />}</h1>
            <small>{draft.extra?.role === "boss" ? "Boss" : "Agent"} · {draft.readonly ? "Built-in, saving creates an editable project copy" : SCOPE_LABEL[draft.scope] || draft.scope}</small>
          </div>
          <span className="grow" />
          {draft.file && <button type="button" className="icon-button lg" aria-label="Show file" title="Show file" onClick={() => api().reveal(draft.file)}><FolderArrowDownIcon /></button>}
          {draft.file && !draft.readonly && <button type="button" className="icon-button lg danger" aria-label="Delete" title="Delete template" onClick={() => setConfirmDelete(true)}><TrashIcon /></button>}
        </div>
        <div className="tpl-scroll">
          <Section title="Identity" help="How this template is named and when the boss should pick it.">
            <div className="tpl-fields two">
              <label className="field">Name<input value={draft.name} onChange={e => set({ name: e.target.value })} placeholder="reviewer" /></label>
              <label className="field">Template type
                <select aria-label="Template type" value={draft.extra?.role === "boss" ? "boss" : "agent"} disabled={!!draft.readonly || (!!draft.file && draft.extra?.role === "boss")} onChange={e => set({ extra: { ...draft.extra, role: e.target.value === "boss" ? "boss" : "agent" } })}><option value="agent">Agent</option><option value="boss">Boss</option></select>
              </label>
              <label className="field wide">Description<input value={draft.description} onChange={e => set({ description: e.target.value })} placeholder="When should the boss use this agent?" /></label>
              <label className="field">Saved in
                <select value={draft.readonly ? "project" : draft.scope} onChange={e => set({ scope: e.target.value })}>
                  <option value="project">This workspace</option>
                  <option value="global">All workspaces</option>
                  {draft.scope === "claude" && <option value="claude">Claude Code agents</option>}
                </select>
              </label>
            </div>
          </Section>
          <Section title="Model" help="Which CLI runs this agent and with which model.">
            <div className="tpl-fields two">
              <label className="field">Provider
                <select aria-label="Provider" value={draft.provider} onChange={e => { setModelSearch(""); set({ provider: e.target.value, model: (models[e.target.value] || ["default"])[0], effort: (efforts[e.target.value] || []).includes(draft.effort || "") ? draft.effort : "" }); }}>
                  {PROVIDERS.filter(p => p !== "local").map(p => <option key={p} value={p}>{labels[p] || p}</option>)}{localProviders.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}{draft.provider === "local" && <option value="local">Local AI (legacy)</option>}
                </select>
              </label>
              <div className="field">Model
                <div className="model-pick">
                  <input aria-label="Search models" value={modelSearch} onChange={e => setModelSearch(e.target.value)} placeholder="Filter" />
                  <select aria-label="Model" value={draft.model} onChange={async e => { if (e.target.value !== "__custom") { set({ model: e.target.value }); return; } const id = await ask.prompt("Custom model", "Model id", draft.model); if (id) set({ model: id }); }}>
                    {!filteredModels.includes(draft.model) && <option value={draft.model}>{draft.model} (selected)</option>}
                    {filteredModels.map(m => <option key={m} value={m}>{m}</option>)}
                    <option value="__custom">Custom…</option>
                  </select>
                </div>
                {modelSearch && filteredModels.length === 0 && <small className="tpl-model-hint">No matching models. Refresh models in Providers or enter a custom ID.</small>}
              </div>
              {(efforts[draft.provider] || []).length > 0 && <label className="field">Effort
                <select aria-label="Effort" value={draft.effort || ""} onChange={e => set({ effort: e.target.value })}>
                  <option value="">Default</option>
                  {efforts[draft.provider].map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>}
            </div>
          </Section>
          <Section title="Instructions" help="The role prompt the agent starts with.">
            <label className="field prompt"><span className="sr-only">Role prompt</span><textarea aria-label="Role prompt" value={draft.body} onChange={e => set({ body: e.target.value })} spellCheck={false} /></label>
          </Section>
          <Section title="Tools" help="MCP servers available after the agent starts. Supported with Claude, Codex and OpenCode.">
            <div className="option-list" aria-label="Agent tools">{[{ id: "rustxng", name: "RustXNG", description: "Web search and page reading" }, { id: "ddgs", name: "DDGS", description: "Images, videos and news" }, { id: "comfyui", name: "ComfyUI", description: "Generate images, video, audio, music and 3D with local workflows" }, { id: "voicestudio", name: "VoiceStudio", description: "Clone voices, generate speech, transcribe audio" }, { id: "blender", name: "Blender", description: "Clean up, texture and export 3D models in Blender" }, { id: "unreal", name: "Unreal Engine", description: "Work in the open Unreal editor: Blueprints, actors, levels, C++ and tests" }].map(tool => { const enabled = (draft.extra?.dispatch_mcp || "").split(",").includes(tool.id); return <label className="option-row" key={tool.id}><input type="checkbox" aria-label={`Enable ${tool.name}`} checked={enabled} onChange={e => { const ids = (draft.extra?.dispatch_mcp || "").split(",").filter(Boolean).filter(id => id !== tool.id); if (e.target.checked) ids.push(tool.id); set({ extra: { ...draft.extra, dispatch_mcp: ids.join(",") } }); }} /><span className="tool-copy"><b>{tool.name}</b><small>{tool.description}</small></span><em>{mcpStatus === null ? "Restart Dispatch to check" : mcpStatus[tool.id] ? "Installed" : "Not installed"}</em></label>; })}</div>
            <div className="option-list" aria-label="Approvals"><label className="option-row"><input type="checkbox" aria-label="Auto-approve commands" checked={draft.extra?.dispatch_approve === "auto"} onChange={e => { const extra = { ...draft.extra }; if (e.target.checked) extra.dispatch_approve = "auto"; else delete extra.dispatch_approve; set({ extra }); }} /><span className="tool-copy"><b>Auto-approve commands</b><small>The agent runs commands and edits files without stopping for a yes/no in its terminal. Claude Code, Codex, Antigravity and Gemini CLI.</small></span></label></div>
          </Section>
          {draft.extra?.role === "boss" && <Section title="Agents visible to boss" help="Agents this boss can enlist. Project setting, applies after the boss restarts.">
            <label className="boss-built-in-toggle"><input type="checkbox" checked={showBuiltInAgents} onChange={e => setShowBuiltInAgents(e.target.checked)} /> Show built-in agents in this list</label>
            <div className="boss-visibility-list">{items.filter(t => t.extra?.role !== "boss" && (showBuiltInAgents || t.scope !== "built-in")).map(t => <label className="boss-visibility-option" key={t.file}><input type="checkbox" disabled={!visibilityLoaded || !t.file} aria-label={`Show ${t.name} (${SCOPE_LABEL[t.scope] || t.scope}) to boss`} checked={visibleToBoss === null || !!t.file && visibleToBoss.includes(t.file)} onChange={e => t.file && void toggleVisibility(t.file, e.target.checked)} /><span><b>{t.name}</b><small>{SCOPE_LABEL[t.scope] || t.scope} · {localProviders.find(p => p.id === t.provider)?.name || labels[t.provider] || t.provider}</small></span></label>)}</div>
          </Section>}
          {draft.extra?.role === "boss" && <Section title="Providers available to boss" help="CLIs the boss may use for new agents, with plan and notes. Applies after restart.">
            <div className="boss-provider-list">{PROVIDERS.map(id => { const settings = providerSettings[id] || { enabled: true, plan: "unknown", note: "" }; return <div className="boss-provider-row" key={id}><label className="boss-provider-name"><input type="checkbox" disabled={!providerReady} checked={settings.enabled} onChange={e => void updateProvider(id, { enabled: e.target.checked })} /><ProviderIcon provider={id} alt="" /><strong>{labels[id] || id}</strong><span>{providerHealth[id] || "Checking…"}</span></label><select aria-label={`${labels[id] || id} plan`} disabled={!providerReady} value={settings.plan} onChange={e => void updateProvider(id, { plan: e.target.value })}><option value="unknown">Plan not set</option><option value="free">Free tier</option><option value="paid">Paid</option></select><input aria-label={`${labels[id] || id} note`} disabled={!providerReady} placeholder="Usage note (optional)" defaultValue={settings.note} key={`${id}-note-${providerReady}`} onBlur={e => { if (e.target.value !== settings.note) void updateProvider(id, { note: e.target.value }); }} maxLength={500} /></div>; })}</div>
          </Section>}
        </div>
        <div className="tpl-actions">
          <Button className="primary" onClick={() => void save()} disabled={!draft.name.trim()}>Save</Button>
          {hasBoss && draft.extra?.role === "boss" && <Button className="secondary" disabled={!draft.name.trim()} onClick={() => setConfirmReload(true)}>Save and reload boss</Button>}
          <kbd>Ctrl S</kbd>
          <span className="grow" />
          {error ? <span className="tpl-error">{error}</span> : status && <span className="tpl-status">{status}</span>}
        </div>
      </div>
    </div>
  );
}