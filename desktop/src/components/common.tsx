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
export function Console({ name, mini = false, focusNonce }: { name: string; mini?: boolean; focusNonce?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  useEffect(() => {
    if (!el.current) return;
    const term = new Terminal({
      fontFamily: '"Geist Mono", "Cascadia Mono", Consolas, monospace',
      fontSize: mini ? 11 : 13,
      lineHeight: 1.25,
      cursorBlink: false,
      theme: { background: token("--term-bg"), foreground: token("--term-fg"), cursor: token("--term-cursor"), selectionBackground: token("--term-selection") },
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el.current);
    termRef.current = term;

    // One fit per frame at most: a panel sliding open fires the observer on every frame.
    let frame = 0, cols = 0, rows = 0;
    const resize = () => { if (frame) return; frame = requestAnimationFrame(() => { frame = 0; try { fit.fit(); if (!mini && (term.cols !== cols || term.rows !== rows)) { cols = term.cols; rows = term.rows; window.army.resize(name, cols, rows); } } catch {} }); };
    const observer = new ResizeObserver(resize);
    observer.observe(el.current);
    resize();
    // xterm measures the cell and draws glyphs when it opens. If Geist Mono was not loaded yet, letters came out in a
    // proportional fallback font inside monospace cells: big gaps after i, t, r. Redo both once the font is in.
    // DOM renderer on purpose: the WebGL one drew letters in a proportional font inside monospace cells (big gaps
    // after i, t, r), even with Geist Mono loaded. Once the font is in, measure the cells again.
    let disposed = false;
    void document.fonts.load(`${mini ? 11 : 13}px "Geist Mono"`).then(() => document.fonts.ready).then(() => { if (!disposed) { term.options.fontFamily = `${term.options.fontFamily}`.replace(/^"Geist Mono"/, "'Geist Mono'"); resize(); } }).catch(() => {});
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
    return () => { disposed = true; termRef.current = null; cancelAnimationFrame(frame); host.removeEventListener("contextmenu", onMenu); off(); observer.disconnect(); term.dispose(); };
  }, [name, mini]);
  useEffect(() => {
    if (!focusNonce) return;
    const frame = requestAnimationFrame(() => termRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusNonce, name]);
  return <div className="terminal" ref={el} />;
}
