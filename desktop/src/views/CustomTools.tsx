import { useEffect, useState } from "react";
import { CommandLineIcon, FolderIcon, PencilSquareIcon, TrashIcon, WrenchScrewdriverIcon } from "@heroicons/react/16/solid";
import { Button, StatusDot } from "../components/common";
import { Dialog } from "../components/Dialog";
import type { CustomTool } from "../lib/types";

type Draft = { id?: string; name: string; command: string; cwd: string; note: string; autostart: boolean; agents: boolean };
const EMPTY: Draft = { name: "", command: "", cwd: "", note: "", autostart: false, agents: true };
const clean = (e: unknown) => String(e).replace(/^Error:\s*(Error invoking remote method '[^']+':\s*)?(Error:\s*)?/, "");

export function useCustomTools() {
  const [items, setItems] = useState<CustomTool[]>([]);
  const load = () => window.army.customTools?.list().then(setItems).catch(() => {});
  useEffect(() => { void load(); return window.army.on("custom-tools-changed", () => void load()); }, []);
  return { items, load };
}

/** The add / edit form, folded open under the page heading like Custom AI in Providers. */
export function CustomToolForm({ open, draft, setDraft, close, saved }: { open: boolean; draft: Draft; setDraft: (fn: (d: Draft) => Draft) => void; close: () => void; saved: (t: CustomTool, started: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) setError(""); }, [open]);
  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));
  const pickFile = async () => { const f = await window.army.customTools.chooseFile(); if (f) setDraft(d => ({ ...d, command: f.command, cwd: f.cwd, name: d.name || f.name })); };
  const pickFolder = async () => { const f = await window.army.customTools.chooseFolder(); if (f) set({ cwd: f }); };
  const save = async (start: boolean) => {
    setBusy(true); setError("");
    try {
      const t = await window.army.customTools.save(draft);
      if (start && t.command) await window.army.customTools.start(t.id);
      saved(t, start && !!t.command);
    } catch (e) { setError(clean(e)); } finally { setBusy(false); }
  };
  return (
    <div className={"local-form-collapse " + (open ? "open" : "")} aria-hidden={!open} inert={!open}><div className="local-form-inner">
      <section className="local-provider custom-tool-form" aria-label={draft.id ? "Edit tool" : "Add a tool"}>
        <div className="local-provider-head"><div><h2>{draft.id ? `Edit ${draft.name || "tool"}` : "Add a tool"}</h2><p>Any program or API your agents should know about. Dispatch runs its command in a terminal of its own (anything it asks, such as a sign-in, you answer there) and tells every agent your note.</p></div></div>
        <div className="custom-tool-fields">
          <label>Name<input aria-label="Tool name" value={draft.name} onChange={e => set({ name: e.target.value })} placeholder="Image API" /></label>
          <label><span className="lbl">Command to run <small>optional</small></span>
            <span className="input-with-button"><input aria-label="Command to run" value={draft.command} onChange={e => set({ command: e.target.value })} placeholder="start-api.bat · npm start · python server.py" spellCheck={false} />
              <Button className="secondary" onClick={() => void pickFile()}>Choose file</Button></span>
          </label>
          <label><span className="lbl">Folder <small>optional, where the command runs</small></span>
            <span className="input-with-button"><input aria-label="Folder" value={draft.cwd} onChange={e => set({ cwd: e.target.value })} placeholder="The command's own folder" spellCheck={false} />
              <button type="button" className="icon-button lg" aria-label="Choose folder" title="Choose folder" onClick={() => void pickFolder()}><FolderIcon /></button></span>
          </label>
          <label className="wide">Note for the agents
            <textarea aria-label="Note for the agents" rows={4} value={draft.note} onChange={e => set({ note: e.target.value })}
              placeholder={"What it does and how to use it. For example: Image and video API at http://127.0.0.1:3210. Read GET /help first. Send Authorization: Bearer <token>; the token is in C:\\tools\\image-api\\data\\settings.json."} />
          </label>
        </div>
        <div className="custom-tool-checks">
          <label className="check"><input type="checkbox" checked={draft.autostart} disabled={!draft.command.trim()} onChange={e => set({ autostart: e.target.checked })} />Start with Dispatch</label>
          <label className="check"><input type="checkbox" checked={draft.agents} onChange={e => set({ agents: e.target.checked })} />Tell agents about it</label>
        </div>
        <div className="local-provider-actions">
          <Button className="primary" disabled={busy || !draft.name.trim()} onClick={() => void save(!!draft.command.trim())}>{draft.command.trim() ? "Save and start" : "Save tool"}</Button>
          {draft.command.trim() && <Button className="secondary" disabled={busy || !draft.name.trim()} onClick={() => void save(false)}>Save</Button>}
          <Button className="ghost" onClick={close}>Cancel</Button>
          {error && <span role="alert" className="tpl-error">{error}</span>}
        </div>
      </section>
    </div></div>
  );
}

/** One row per tool the user added, in the same list as the built-in tools. */
export function CustomToolRows({ items, edit, openTerminal, onError }: { items: CustomTool[]; edit: (t: CustomTool) => void; openTerminal: (t: CustomTool) => void; onError: (text: string) => void }) {
  const [removing, setRemoving] = useState<CustomTool | null>(null);
  const [busy, setBusy] = useState<string>("");
  const act = async (id: string, fn: () => Promise<unknown>) => { setBusy(id); try { await fn(); } catch (e) { onError(clean(e)); } finally { setBusy(""); } };
  return <>
    {removing && <Dialog title={`Remove ${removing.name}?`} onClose={() => setRemoving(null)} description={removing.running ? "It is running; Dispatch stops it first. Its files stay where they are." : "Agents stop hearing about it. Its files stay where they are."}
      footer={<><Button className="ghost" autoFocus onClick={() => setRemoving(null)}>Cancel</Button><Button className="danger" onClick={() => { const t = removing; setRemoving(null); void act(t.id, () => window.army.customTools.remove(t.id)); }}>Remove</Button></>} />}
    {items.map(t => {
      const state: [string, "working" | "idle" | "needs"] = !t.command ? ["Note only", "idle"] : t.running ? ["Running", "working"] : t.exitCode != null && t.exitCode !== 0 ? [`Stopped (code ${t.exitCode})`, "needs"] : ["Stopped", "idle"];
      return (
        <div className="prov-row custom-tool-row" key={t.id} data-tool={t.id}>
          <span className="prov-icon tool-glyph"><WrenchScrewdriverIcon aria-hidden="true" /></span>
          <div className="prov-main">
            <div className="prov-title"><b>{t.name}</b><StatusDot tone={state[1]} label={state[0]} /></div>
            {t.command && <small className="custom-tool-cmd" title={t.cwd ? `${t.command}  ·  in ${t.cwd}` : t.command}>{t.command}{t.cwd ? ` · ${t.cwd}` : ""}</small>}
            <small>{t.note || "No note: agents only see its name."}{t.agents ? "" : " · Agents are not told about it."}{t.autostart ? " · Starts with Dispatch." : ""}</small>
          </div>
          <div className="prov-actions">
            {t.command && !t.running && <Button className="primary" disabled={busy === t.id} onClick={() => void act(t.id, async () => { await window.army.customTools.start(t.id); openTerminal(t); })}>Start</Button>}
            {t.command && t.running && <Button className="danger-ghost" disabled={busy === t.id} onClick={() => void act(t.id, () => window.army.customTools.stop(t.id))}>Stop</Button>}
            {t.command && (t.running || t.exitCode != null) && <Button className="secondary" onClick={() => openTerminal(t)}><CommandLineIcon aria-hidden="true" />Terminal</Button>}
            <button type="button" className="icon-button lg" aria-label={`Edit ${t.name}`} title="Edit" onClick={() => edit(t)}><PencilSquareIcon /></button>
            <button type="button" className="icon-button lg" aria-label={`Remove ${t.name}`} title="Remove" onClick={() => setRemoving(t)}><TrashIcon /></button>
          </div>
        </div>
      );
    })}
  </>;
}

export { EMPTY as EMPTY_TOOL };
export type { Draft as ToolDraft };
