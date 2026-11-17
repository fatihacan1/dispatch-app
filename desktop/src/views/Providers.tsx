import React, { useEffect, useRef, useState } from "react";
import localIcons from "../../electron/local-icons.json";
import { ChevronDownIcon, FolderIcon, PlusIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { Button, Console, StatusDot, type Tone } from "../components/common";
import { Dialog } from "../components/Dialog";
import { ask } from "../components/ask";
import { UsageDetails } from "../components/Usage";
import { useUsage } from "../lib/usage";
import type { Account } from "../lib/types";

const SUPPORTS_USAGE = ["claude", "codex", "antigravity"];
const MULTI_ACCOUNT_PROVIDERS = ["claude", "codex"];

type Status = { id: string; name: string; installed: boolean; version?: string; path?: string; auth: string; detail?: string; models?: string[]; canLogout?: boolean; canRepair?: boolean; update?: string; latest?: string };
const api = () => (window as any).army.providers;
const CHIP: Record<string, [string, Tone]> = {
  "signed-in": ["Ready", "working"], "signed-out": ["Signed out", "waiting"], error: ["Error", "error"], unknown: ["Installed", "idle"], "n/a": ["Not installed", "idle"],
};
const VERB: Record<string, string> = { update: "Updating", install: "Installing", uninstall: "Uninstalling", login: "Signing in to", logout: "Signing out of" };

export function Providers({ focus = "" }: { focus?: string }) {
  const [rows, setRows] = useState<Status[]>([]);
  const { usage, loading: usageLoading, refresh: refreshUsage, now } = useUsage();
  const [details, setDetails] = useState<Record<string, boolean>>(focus ? { [focus]: true } : {});
  useEffect(() => { if (!focus) return; setDetails(d => ({ ...d, [focus]: true })); setTimeout(() => document.querySelector(`[data-prov="${focus}"]`)?.scrollIntoView({ block: "nearest" }), 120); }, [focus]);
  const [localFormOpen, setLocalFormOpen] = useState(false);
  const [local, setLocal] = useState<{ baseURL: string; model: string; name: string; icon: string; apiKey?: string; hasKey?: boolean; clearKey?: boolean }>({ baseURL: "http://127.0.0.1:8080/v1", model: "local-qwen", name: "", icon: "default" });
  const [localStatus, setLocalStatus] = useState("");
  const [localItems, setLocalItems] = useState<{ baseURL: string; model: string; icon: string; name: string; hasKey?: boolean }[]>([]);
  const [deletingLocal, setDeletingLocal] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [detectedModels, setDetectedModels] = useState<string[]>([]);
  const [iconPicker, setIconPicker] = useState(false);
  const [iconSearch, setIconSearch] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!iconPicker) return;
    const dismiss = (event: MouseEvent) => { if (!pickerRef.current?.contains(event.target as Node)) setIconPicker(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setIconPicker(false); };
    document.addEventListener("mousedown", dismiss); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", dismiss); document.removeEventListener("keydown", escape); };
  }, [iconPicker]);
  const selectedIcon = localIcons.find(icon => icon.id === local.icon);
  const iconSource = local.icon?.startsWith("data:image/png;") ? local.icon : selectedIcon?.src || "./providers/local.svg";
  const localApi = (window as any).army.localAI;
  const localAvailable = !!localApi && typeof localApi.save === "function" && typeof localApi.check === "function" && typeof localApi.list === "function" && typeof localApi.remove === "function";
  useEffect(() => { if (localAvailable) { localApi.get().then((config: any) => { if (config) setLocal(config); }).catch((e: unknown) => setLocalStatus(String(e))); if (localApi.list) localApi.list().then(setLocalItems).catch((e: unknown) => setLocalStatus(String(e))); } }, []);
  const chooseIcon = async () => {
    if (!localApi?.chooseIcon) { setLocalStatus("Quit and restart Dispatch to enable icon selection."); return; }
    try { const icon = await localApi.chooseIcon(); if (icon) { setLocal(v => ({ ...v, icon })); setIconPicker(false); } } catch (e) { setLocalStatus(String(e)); }
  };
  const saveLocal = async () => { if (!localAvailable) { setLocalStatus("Quit and restart Dispatch to enable Local AI settings."); return; } try { const saved = await localApi.save(local); setLocal(v => ({ ...v, apiKey: "", clearKey: false, hasKey: saved.hasKey })); const items = await localApi.list(); if (!items.some((item: any) => item.model === local.model)) throw new Error("Saved provider could not be verified. Restart Dispatch and try again."); setLocalItems(items); setLocalStatus(""); setSavedNotice(true); } catch (e) { setLocalStatus(String(e)); } };
  const removeLocal = async () => { if (!deletingLocal) return; try { setLocalItems(await localApi.remove(deletingLocal)); setDeletingLocal(null); setSavedNotice(false); } catch (e) { setLocalStatus(String(e)); setDeletingLocal(null); } };
  const testLocal = async () => { if (!localAvailable) { setLocalStatus("Quit and restart Dispatch to enable Local AI settings."); return; } setLocalBusy(true); try { const result = await localApi.check(local); setDetectedModels(result.ok ? result.models : []); setLocalStatus(result.ok ? result.matches ? `Connected · ${local.model}` : "Connected. Choose a detected model below." : `Could not connect: ${result.error}`); } catch (e) { setLocalStatus(String(e)); } finally { setLocalBusy(false); } };
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [task, setTask] = useState<{ id: string; kind: string; name: string; done?: boolean; code?: number } | null>(null);
  const [accounts, setAccounts] = useState<Record<string, Account[]>>({});
  const [accountModal, setAccountModal] = useState<string | null>(null);
  const [newAccountLabel, setNewAccountLabel] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [accountError, setAccountError] = useState("");

  const loadAccounts = async (provider?: string) => {
    const accApi = window.army.accounts;
    if (!accApi) return;
    try {
      const list = await accApi.list(provider);
      if (provider) {
        setAccounts(prev => ({ ...prev, [provider]: list }));
      } else {
        const grouped: Record<string, Account[]> = {};
        for (const a of list) (grouped[a.provider] ||= []).push(a);
        setAccounts(grouped);
      }
    } catch {}
  };

  const check = async (id: string) => {
    setBusy(b => ({ ...b, [id]: true }));
    const s: Status = await api().check(id);
    setRows(r => r.map(x => (x.id === id ? s : x)));
    if (s.installed) api().updateInfo(id, s.version).then((u: any) => setRows(r => r.map(x => (x.id === id ? { ...x, ...u } : x))));
    setBusy(b => ({ ...b, [id]: false }));
  };
  useEffect(() => {
    api().list().then((list: { id: string; name: string }[]) => {
      setRows(list.map(p => ({ ...p, installed: false, auth: "checking" })));
      list.forEach(p => check(p.id));
    });
    void loadAccounts();
    const offDone = (window as any).army.on("provider:done", (e: any) => {
      setTask(t => (t && t.name === e.name ? { ...t, done: true, code: e.exitCode } : t));
      if (e.exitCode === 0 && e.kind === "login") api().models(e.id).then(() => check(e.id));
      else check(e.id);
    });
    const offAcc = (window as any).army.on("accounts-changed", (provider?: string) => {
      void loadAccounts(typeof provider === "string" ? provider : undefined);
    });
    return () => { offDone(); offAcc(); };
  }, []);

  const act = async (id: string, kind: string) => {
    if (kind === "repair" && !(await ask.confirm("Reset OpenCode data?", { description: "Back up and reset OpenCode's data directory? This includes local sessions and credentials; you may need to sign in again. Close OpenCode first.", action: "Reset", danger: true }))) return;
    if (kind === "uninstall" && !(await ask.confirm("Uninstall this CLI?", { action: "Uninstall", danger: true }))) return;
    if (task && !task.done) await api().close(task.name);
    const name = await api().action(id, kind);
    setTask({ id, kind, name });
  };
  const refreshModels = async (id: string) => {
    setBusy(b => ({ ...b, [id]: true }));
    const models = await api().models(id);
    setRows(r => r.map(x => (x.id === id ? { ...x, models } : x)));
    setBusy(b => ({ ...b, [id]: false }));
  };
  const closeTask = async () => { if (task) await api().close(task.name); setTask(null); };
  const taskRow = task && rows.find(r => r.id === task.id);
  const modalRow = accountModal ? rows.find(r => r.id === accountModal) : null;
  const modalAccounts = accountModal ? (accounts[accountModal] || []) : [];

  const openAccountModal = (provider: string) => {
    setAccountModal(provider);
    setNewAccountLabel("");
    setRenamingId(null);
    setRenameValue("");
    setAccountError("");
    void loadAccounts(provider);
  };

  const activateAccount = async (provider: string, id: string) => {
    const accApi = window.army.accounts;
    if (!accApi) return;
    try {
      const list = await accApi.activate(provider, id);
      setAccounts(prev => ({ ...prev, [provider]: list }));
      setAccountError("");
      void check(provider);
    } catch (e) { setAccountError(String((e as Error)?.message || e).replace(/^.*?Error invoking remote method '[^']+': (?:Error: )?/, "")); }
  };

  const addAccount = async () => {
    if (!accountModal || !window.army.accounts) return;
    setAddingAccount(true);
    setAccountError("");
    try {
      if (task && !task.done) await api().close(task.name);
      const res = await window.army.accounts.add(accountModal, newAccountLabel.trim());
      setAccounts(prev => ({ ...prev, [accountModal]: res.list }));
      setNewAccountLabel("");
      setAccountModal(null);
      setTask({ id: accountModal, kind: "login", name: res.terminal });
    } catch (e) {
      setAccountError(String(e));
    } finally {
      setAddingAccount(false);
    }
  };

  const saveRename = async (provider: string, id: string) => {
    if (!window.army.accounts) return;
    try {
      const list = await window.army.accounts.rename(provider, id, renameValue);
      setAccounts(prev => ({ ...prev, [provider]: list }));
      setRenamingId(null);
      setAccountError("");
    } catch (e) { setAccountError(String(e)); }
  };

  const removeAccount = async (provider: string, id: string) => {
    if (!window.army.accounts) return;
    try {
      const list = await window.army.accounts.remove(provider, id);
      setAccounts(prev => ({ ...prev, [provider]: list }));
      setAccountError("");
      void check(provider);
    } catch (e) { setAccountError(String(e)); }
  };

  return (
    <div className={"page prov-page" + (task ? " with-task" : "")}>
      {deletingLocal && <Dialog title="Remove this provider?" onClose={() => setDeletingLocal(null)} description={`${deletingLocal} will be removed from Dispatch.`} footer={<><Button className="ghost" autoFocus onClick={() => setDeletingLocal(null)}>Cancel</Button><Button className="danger" onClick={() => void removeLocal()}>Remove</Button></>} />}
      {accountModal && (
        <Dialog
          title={`${modalRow?.name || accountModal} accounts`}
          size="md"
          onClose={() => setAccountModal(null)}
          description="Click an account to make it active for new agents and usage meters."
          footer={<>
            <input
              aria-label="New account label"
              placeholder="Account label (e.g. Work)"
              value={newAccountLabel}
              disabled={modalAccounts.length >= 10 || addingAccount}
              onChange={e => setNewAccountLabel(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && modalAccounts.length < 10 && !addingAccount) void addAccount(); }}
              style={{ flex: 1, minWidth: 0 }}
            />
            <Button className="primary" disabled={modalAccounts.length >= 10 || addingAccount} onClick={() => void addAccount()}>
              {addingAccount ? "Opening…" : "+ Add account"}
            </Button>
          </>}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 340, overflowY: "auto" }}>
            {modalAccounts.map(acc => (
              <div
                key={acc.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 10px",
                  borderRadius: 8,
                  border: acc.active ? "1px solid var(--accent)" : "1px solid var(--line)",
                  background: acc.active ? "var(--surface-2)" : "transparent",
                }}
              >
                {renamingId === acc.id ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                    <input
                      autoFocus
                      aria-label="Rename account"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") void saveRename(accountModal, acc.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <Button className="primary" onClick={() => void saveRename(accountModal, acc.id)}>Save</Button>
                    <Button className="ghost" onClick={() => setRenamingId(null)}>Cancel</Button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void activateAccount(accountModal, acc.id)}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        padding: 0,
                        color: "inherit",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <b>{acc.label}</b>
                        {acc.active && <span className="tag">Active</span>}
                      </span>
                      {(acc.email || acc.plan) && (
                        <small style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {[acc.email, acc.plan].filter(Boolean).join(" · ")}
                        </small>
                      )}
                    </button>
                    <Button className="ghost" onClick={() => { setRenamingId(acc.id); setRenameValue(acc.label); }}>Rename</Button>
                    {acc.id !== "default" && (
                      <Button className="danger-ghost" onClick={() => void removeAccount(accountModal, acc.id)}>Remove</Button>
                    )}
                  </>
                )}
              </div>
            ))}
            {modalAccounts.length >= 10 && <small style={{ color: "var(--muted)" }}>Maximum of 10 accounts reached.</small>}
            {accountError && <small role="alert" style={{ color: "var(--danger, #e5534b)" }}>{accountError}</small>}
          </div>
        </Dialog>
      )}
      <div className="view-heading"><h1>Providers</h1><span className="grow" /><button className="button secondary local-add-toggle" type="button" aria-label={localFormOpen ? "Close custom AI form" : "Add custom AI"} aria-expanded={localFormOpen} onClick={() => setLocalFormOpen(v => !v)}>{localFormOpen ? <XMarkIcon aria-hidden="true" /> : <PlusIcon aria-hidden="true" />}<span>{localFormOpen ? "Close" : "Custom AI"}</span></button></div>
      <div className="prov-list">
        <div className={"local-form-collapse " + (localFormOpen ? "open" : "")} aria-hidden={!localFormOpen} inert={!localFormOpen}><div className="local-form-inner">
        <section className="local-provider"><div className="local-provider-head"><div><h2>Custom AI</h2><p>Any OpenAI-compatible server through OpenCode: a local one (llama.cpp, LM Studio, Ollama) or a hosted one with an API key (EVREN, OpenRouter, Groq…). Saved for all workspaces.</p></div></div><div className="local-provider-fields"><label>Provider name<input aria-label="Local provider name" value={local.name || ""} onChange={e => setLocal(v => ({ ...v, name: e.target.value }))} placeholder="Ornith" /></label><label>Server URL<input aria-label="Local server URL" value={local.baseURL} onChange={e => setLocal(v => ({ ...v, baseURL: e.target.value }))} placeholder="http://127.0.0.1:8080/v1 or https://…/v1" /></label><label>API key<input aria-label="API key" type="password" autoComplete="off" value={local.apiKey || ""} onChange={e => setLocal(v => ({ ...v, apiKey: e.target.value, clearKey: false }))} placeholder={local.hasKey && !local.clearKey ? "Saved · leave empty to keep" : "Only for hosted servers"} /></label><label>Model ID<input aria-label="Local model ID" value={local.model} onChange={e => setLocal(v => ({ ...v, model: e.target.value }))} placeholder="local-qwen" /></label></div><div className="local-icon-row"><span>Icon</span><div className="icon-picker-wrap" ref={pickerRef}><button type="button" className="icon-picker-trigger" aria-label="Choose icon" aria-expanded={iconPicker} onClick={() => { setIconPicker(v => !v); setIconSearch(""); }}><img src={iconSource} alt="" /><span>{selectedIcon?.label || "Custom"}</span><ChevronDownIcon aria-hidden="true" /></button>{iconPicker && <div className="icon-picker-panel" role="dialog" aria-label="Choose icon"><input autoFocus aria-label="Search icons" placeholder="Search icons…" value={iconSearch} onChange={e => setIconSearch(e.target.value)} /><div className="icon-picker-grid">{localIcons.filter(icon => icon.label.toLowerCase().includes(iconSearch.trim().toLowerCase())).map(icon => <button type="button" key={icon.id} title={icon.label} aria-label={icon.label} aria-pressed={local.icon === icon.id} className="icon-picker-item" onClick={() => { setLocal(v => ({ ...v, icon: icon.id })); setIconPicker(false); }}><img src={icon.src} alt="" /></button>)}{!localIcons.some(icon => icon.label.toLowerCase().includes(iconSearch.trim().toLowerCase())) && <p>No icons found.</p>}</div><button type="button" className="icon-picker-upload" onClick={() => void chooseIcon()}><FolderIcon aria-hidden="true" />Choose</button></div>}</div></div><div className="local-provider-actions"><Button className="primary" onClick={() => void saveLocal()}>Save provider</Button><Button className="secondary" disabled={localBusy} onClick={() => void testLocal()}>{localBusy ? "Checking…" : "Test connection"}</Button>{localStatus && <span role="status">{localStatus}</span>}</div>{savedNotice && <div className="local-save-notice" role="status"><span><strong>Saved globally</strong><small>This provider is available in every workspace. API keys are stored encrypted on this computer.</small></span><button type="button" className="icon-button" aria-label="Dismiss notification" onClick={() => setSavedNotice(false)}><XMarkIcon /></button></div>}{!localAvailable && <p className="local-provider-notice" role="status">Quit and restart Dispatch to enable Local AI settings. Closing the window may leave it running in the system tray.</p>}{detectedModels.length > 0 && <div className="local-models"><span className="local-models-label">Detected</span>{detectedModels.map(model => <button type="button" className={"local-model-choice " + (local.model === model ? "selected" : "")} aria-pressed={local.model === model} key={model} onClick={() => { setLocal(v => ({ ...v, model })); setLocalStatus("Model selected. Save to apply."); }}>{model}</button>)}</div>}</section>
        </div></div>

        {rows.map(p => {
          const [label, tone]: [string, Tone] = p.auth === "checking" || busy[p.id] ? ["Checking…", "idle"] as [string, Tone] : CHIP[p.auth] || ["Unknown", "idle"] as [string, Tone];
          return (
            <div className="prov-row prov-wrap" key={p.id} data-prov={p.id}>
              <img className="prov-icon" src={`./providers/${p.id}.svg`} alt="" />
              <div className="prov-main">
                <div className="prov-title"><b>{p.name}</b><StatusDot tone={tone} label={label} /></div>
                <small>{p.installed ? [p.version && `v${p.version}`, p.detail].filter(Boolean).join(" · ") || "Installed" : "Not found on this computer"}
                  {p.update === "current" && <span className="prov-upd"> · Up to date</span>}
                  {p.update === "available" && <span className="prov-upd new"> · Update available v{p.latest}</span>}
                </small>
                {p.installed && p.models && p.models.length > 0 && (
                  <div className="prov-models">
                    {p.models.slice(0, 5).map(m => <span key={m}>{m}</span>)}
                    {p.models.length > 5 && <span className="more">+{p.models.length - 5}</span>}
                  </div>
                )}
              </div>
              <div className="prov-actions">
                {!p.installed && p.auth !== "checking" && <Button className="primary" onClick={() => act(p.id, "install")}>Install</Button>}
                {p.installed && p.auth === "signed-out" && <Button className="primary" onClick={() => act(p.id, "login")}>Sign in</Button>}
                {p.installed && p.auth === "unknown" && <Button className="secondary" onClick={() => act(p.id, "login")}>Open to sign in</Button>}
                {p.installed && p.auth === "signed-in" && p.canLogout && <Button className="ghost" onClick={() => act(p.id, "logout")}>Sign out</Button>}
                {p.canRepair && <Button className="primary" onClick={() => act(p.id, "repair")}>Repair</Button>}
                {p.update === "available" && <Button className="primary" onClick={() => act(p.id, "update")}>Update</Button>}
                {p.update === "manual" && <Button className="ghost" onClick={() => act(p.id, "update")}>Check for updates</Button>}
                {p.installed && <Button className="secondary" onClick={() => refreshModels(p.id)} disabled={busy[p.id]}>Refresh models</Button>}
                {p.installed && SUPPORTS_USAGE.includes(p.id) && <Button className="secondary" aria-expanded={!!details[p.id]} onClick={() => setDetails(d => ({ ...d, [p.id]: !d[p.id] }))}>{details[p.id] ? "Hide details" : "Show details"}</Button>}
                {p.installed && MULTI_ACCOUNT_PROVIDERS.includes(p.id) && (
                  <Button className="secondary" onClick={() => openAccountModal(p.id)}>
                    Switch account · {(accounts[p.id]?.find(a => a.active)?.label) || "Default"}
                  </Button>
                )}
                {p.installed && <Button className="danger-ghost" title="Uninstall" onClick={() => act(p.id, "uninstall")}>Uninstall</Button>}
              </div>
              {p.installed && details[p.id] && <UsageDetails u={usage[p.id]} now={now} loading={usageLoading[p.id]} refresh={() => void refreshUsage(p.id)} manual={p.id === "antigravity"} />}
            </div>
          );
        })}
        {localItems.map(item => <div className="prov-row local-saved-row" key={item.model}><img className="prov-icon" src={item.icon?.startsWith("data:image/png;") ? item.icon : localIcons.find(icon => icon.id === item.icon)?.src || "./providers/local.svg"} alt="" /><div className="prov-main"><div className="prov-title"><b>{item.name || item.model}</b><span className="tag">{/^http:/.test(item.baseURL) ? "Local" : "Remote"}</span>{item.hasKey && <span className="tag">Key</span>}</div><small>{item.model} · {item.baseURL}</small></div><div className="prov-actions"><Button className="secondary" onClick={() => { setLocal({ ...item, apiKey: "", clearKey: false }); setSavedNotice(false); setLocalFormOpen(true); document.querySelector('.prov-list')?.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</Button><Button className="danger-ghost" aria-label={`Remove ${item.model}`} onClick={() => setDeletingLocal(item.model)}>Remove</Button></div></div>)}

      </div>
      {task && (
        <div className="prov-task">
          <div className="prov-task-head">
            <span>{task.done ? (task.code === 0 ? "Finished" : `Exited with code ${task.code}`) : `${VERB[task.kind] || "Running"} ${taskRow?.name || task.id}…`}</span>
            <small>Follow the prompts below. Click the terminal and press Ctrl+Shift+V to paste. Browser sign-in opens your default browser when supported.</small>
            <Button className="ghost" onClick={closeTask}>{task.done ? "Close" : "Cancel"}</Button>
          </div>
          <Console key={task.name} name={task.name} />
        </div>
      )}
    </div>
  );
}
