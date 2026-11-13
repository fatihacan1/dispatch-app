import React, { useEffect, useState } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/16/solid";
import { Button, ProviderIcon, StatusDot } from "./common";
import { Dialog } from "./Dialog";
import { labels } from "../lib/data";

type Template = { file: string; name: string; provider: string; model: string; description: string; body: string; scope?: string };
const SCOPE: Record<string, string> = { project: "Project", global: "Global", claude: "Claude Code", "built-in": "Built-in" };

export function EnlistDialog({ agents, close, enlist, openProviders }: { agents: string[]; close(): void; enlist(name: string, template: Template, task: string): void; openProviders?(): void }) {
  const [health, setHealth] = useState<Record<string, { installed: boolean; auth: string; name: string } | "checking">>({});
  const [items, setItems] = useState<Template[]>([]);
  const [choice, setChoice] = useState<Template>();
  const [name, setName] = useState("");
  const [task, setTask] = useState("");
  const [query, setQuery] = useState("");

  function pick(t: Template) {
    setChoice(t);
    setHealth(h => {
      if (h[t.provider]) return h;
      (window as any).army.providers.check(t.provider).then((s: any) => setHealth(x => ({ ...x, [t.provider]: s })));
      return { ...h, [t.provider]: "checking" };
    });
    let i = 1; while (agents.includes(`${t.name}-${i}`)) i++;
    setName(`${t.name}-${i}`);
  }
  useEffect(() => {
    (window as any).army.templates.list().then((r: any) => { setItems(r.items); if (r.items[0]) pick(r.items[0]); });
  }, []);

  const shown = items.filter(t => (t.name + " " + t.description + " " + t.provider).toLowerCase().includes(query.toLowerCase()));
  const submit = () => { if (choice && name.trim()) enlist(name.trim(), choice, task); };
  const h = choice ? health[choice.provider] : undefined;
  const blocked = !choice || !name.trim() || (typeof h === "object" && !h.installed);

  return (
    <Dialog title="Enlist agent" onClose={close} size="lg" className="enlist-dialog" footer={<>
      <Button className="ghost" onClick={close}>Cancel</Button>
      <Button className="primary" disabled={blocked} onClick={submit}>Enlist</Button>
    </>}>
      <div className="enlist-body">
        <div className="enlist-pick">
          <label className="field-search"><MagnifyingGlassIcon aria-hidden="true" /><input aria-label="Filter templates" placeholder="Filter templates" value={query} onChange={e => setQuery(e.target.value)} /></label>
          <div className="enlist-list">
            {shown.map(t => (
              <Button key={t.file} className={"list-row " + (choice?.file === t.file ? "selected" : "")} onClick={() => pick(t)} title={t.description}>
                <ProviderIcon className="row-icon" provider={t.provider} alt="" />
                <span className="row-text"><b>{t.name}</b><small>{t.description || "No description"}</small></span>
              </Button>
            ))}
            {shown.length === 0 && <p className="empty-line">No templates match.</p>}
          </div>
        </div>
        <div className="enlist-form">
          {choice ? (
            <>
              <div className="enlist-summary">
                <ProviderIcon className="row-icon lg" provider={choice.provider} alt="" />
                <div><b>{choice.name}</b><small>{labels[choice.provider] || choice.provider} · {choice.model || "default"}{choice.scope ? ` · ${SCOPE[choice.scope] || choice.scope}` : ""}</small></div>
              </div>
              {choice.description && <p className="enlist-desc">{choice.description}</p>}
              <div className="enlist-health">
                {!h || h === "checking" ? <StatusDot tone="idle" label={`Checking ${labels[choice.provider] || choice.provider}…`} />
                  : !h.installed ? <><StatusDot tone="error" label={`${h.name} is not installed on this computer.`} />{openProviders && <Button className="secondary" onClick={openProviders}>Install</Button>}</>
                  : h.auth === "signed-out" ? <><StatusDot tone="waiting" label={`${h.name} is not signed in. The agent will stop at the sign-in screen.`} />{openProviders && <Button className="secondary" onClick={openProviders}>Sign in</Button>}</>
                  : h.auth === "unknown" ? <StatusDot tone="idle" label={`${h.name} is installed. If it asks you to sign in, open its Terminal.`} />
                  : <StatusDot tone="working" label={`${h.name} is ready`} />}
              </div>
              <label className="field">Agent name<input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submit(); }} /></label>
              <label className="field grow">First task <span className="field-hint">optional</span><textarea value={task} onChange={e => setTask(e.target.value)} placeholder="What should this agent start with?" /></label>
            </>
          ) : <p className="empty-line">Pick a template.</p>}
        </div>
      </div>
    </Dialog>
  );
}
