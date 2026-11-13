import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./common";

/** Promise-based confirm/prompt that use the app's Dialog instead of native browser popups. */
type Request =
  | { kind: "confirm"; title: string; description?: string; action?: string; danger?: boolean; resolve: (ok: boolean) => void }
  | { kind: "prompt"; title: string; label: string; value?: string; action?: string; resolve: (value: string | null) => void }
  | { kind: "choose"; title: string; description?: string; options: { id: string; label: string; primary?: boolean; danger?: boolean }[]; resolve: (id: string | null) => void };
let push: ((r: Request) => void) | null = null;

export const ask = {
  confirm: (title: string, opts: { description?: string; action?: string; danger?: boolean } = {}) =>
    new Promise<boolean>(resolve => push ? push({ kind: "confirm", title, ...opts, resolve }) : resolve(false)),
  prompt: (title: string, label: string, value = "", action = "Save") =>
    new Promise<string | null>(resolve => push ? push({ kind: "prompt", title, label, value, action, resolve }) : resolve(null)),
  /** Several actions; resolves with the chosen id, or null on Cancel. */
  choose: (title: string, opts: { description?: string; options: { id: string; label: string; primary?: boolean; danger?: boolean }[] }) =>
    new Promise<string | null>(resolve => push ? push({ kind: "choose", title, ...opts, resolve }) : resolve(null)),
};

export function AskHost() {
  const [req, setReq] = useState<Request | null>(null);
  const [value, setValue] = useState("");
  useEffect(() => { push = r => { setValue(r.kind === "prompt" ? r.value || "" : ""); setReq(r); }; return () => { push = null; }; }, []);
  if (!req) return null;
  if (req.kind === "choose") {
    const pick = (id: string | null) => { req.resolve(id); setReq(null); };
    return <Dialog title={req.title} onClose={() => pick(null)} description={req.description} footer={<>
      <Button className="ghost" onClick={() => pick(null)}>Cancel</Button>
      {req.options.map(o => <Button key={o.id} className={o.danger ? "danger" : o.primary ? "primary" : "secondary"} autoFocus={o.primary} onClick={() => pick(o.id)}>{o.label}</Button>)}
    </>} />;
  }
  const done = (result: boolean) => {
    if (req.kind === "confirm") req.resolve(result);
    else req.resolve(result && value.trim() ? value.trim() : null);
    setReq(null);
  };
  return <Dialog title={req.title} onClose={() => done(false)} description={req.kind === "confirm" ? req.description : undefined} footer={<>
    <Button className="ghost" onClick={() => done(false)}>Cancel</Button>
    <Button className={req.kind === "confirm" && req.danger ? "danger" : "primary"} autoFocus={req.kind === "confirm"} onClick={() => done(true)}>{req.action || "Confirm"}</Button>
  </>}>
    {req.kind === "prompt" && <label className="field">{req.label}<input autoFocus value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") done(true); }} /></label>}
  </Dialog>;
}
