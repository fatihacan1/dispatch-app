import React, { useEffect, useRef } from "react";
import localIcons from "../../electron/local-icons.json";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { labels } from "../lib/data";

export function Button({ children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={"button " + className} {...props}>{children}</button>;
}
export const models: Record<string, string> = {
  claude: "Opus 5.5",
  codex: "GPT-6.1 Terra",
  antigravity: "Default model",
  opencode: "Default model",
  qoder: "Default model",
};
export function ProviderIcon({ provider, ...props }: { provider: string } & React.ImgHTMLAttributes<HTMLImageElement>) {
  const [icon, setIcon] = React.useState("default");
  React.useEffect(() => {
    if (provider !== "local" && !provider.startsWith("local:")) return;
    const api = (window as any).army.localAI;
    const refresh = () => { if (provider.startsWith("local:") && api?.list) api.list().then((items: any[]) => setIcon(items.find(item => item.model === decodeURIComponent(provider.slice(6)))?.icon || "default")).catch(() => {}); else if (api?.get) api.get().then((config: any) => setIcon(config?.icon || "default")).catch(() => {}); };
    refresh(); return window.army.on("local-ai-changed", refresh);
  }, [provider]);
  const src = provider !== "local" && !provider.startsWith("local:") ? `./providers/${provider}.svg` : icon.startsWith("data:image/png;") ? icon : localIcons.find(item => item.id === icon)?.src || "./providers/local.svg";
  return <img {...props} src={src} />;
}
export function Mark({ provider }: { provider: string; model?: string }) {
  return <span className="mark" title={labels[provider]}><ProviderIcon className="provider-icon" provider={provider} alt={labels[provider]} /></span>;
}
export type Tone = "working" | "waiting" | "needs" | "idle" | "error";
export function StatusDot({ tone, label }: { tone: Tone; label?: string }) {
  return <span className={"status status-" + tone}><i aria-hidden="true" />{label && <span>{label}</span>}</span>;
}
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export function Console({ name, mini = false }: { name: string; mini?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const term = new Terminal({
      fontFamily: token("--font-mono") || "monospace",
      fontSize: mini ? 11 : 13,
      lineHeight: 1.25,
      cursorBlink: false,
      theme: { background: token("--term-bg"), foreground: token("--term-fg"), cursor: token("--term-cursor"), selectionBackground: token("--term-selection") },
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el.current);
    const resize = () => { try { fit.fit(); if (!mini) window.army.resize(name, term.cols, term.rows); } catch {} };
    const observer = new ResizeObserver(resize);
    observer.observe(el.current);
    resize();
    window.army.output(name).then(data => term.write(data));
    const off = window.army.on("terminal", e => { if (e.name === name) term.write(e.data); });
    if (!mini) term.onData(data => window.army.input(name, data));
    // Copy and paste like Windows Terminal: Ctrl+C copies when text is selected (otherwise it is the usual interrupt),
    // Ctrl+Shift+C copies, Ctrl+V / Ctrl+Shift+V paste, right-click copies a selection or pastes.
    const copy = () => { const s = term.getSelection(); if (!s) return false; void navigator.clipboard.writeText(s); term.clearSelection(); return true; };
    const paste = () => { if (!mini) void navigator.clipboard.readText().then(t => { if (t) term.paste(t); }); };
    term.attachCustomKeyEventHandler(e => {
      if (e.type !== "keydown" || !e.ctrlKey || e.altKey) return true;
      const k = e.key.toLowerCase();
      if (k === "c" && (e.shiftKey || term.hasSelection())) { e.preventDefault(); copy(); return false; }
      if (k === "v") { e.preventDefault(); paste(); return false; }
      return true;
    });
    const onMenu = (e: MouseEvent) => { e.preventDefault(); if (!copy()) paste(); };
    el.current.addEventListener("contextmenu", onMenu);
    const host = el.current;
    return () => { host.removeEventListener("contextmenu", onMenu); off(); observer.disconnect(); term.dispose(); };
  }, [name, mini]);
  return <div className="terminal" ref={el} />;
}
