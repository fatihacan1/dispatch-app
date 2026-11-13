import React, { useState } from "react";
import { CommandLineIcon, PlusIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { Console } from "../components/common";

export type Shell = { name: string; title: string; cwd: string; exited: boolean };

/** Terminal area under the editor: one row of shell tabs, the active shell below. */
export function Terminals({ shells, active, setActive, onClose, height, setHeight }: { shells: Shell[]; active: string | null; setActive: (name: string) => void; onClose: () => void; height: number; setHeight: (h: number) => void }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const open = async () => { const name = await window.army.shells.open(); setActive(name); };
  const close = async (name: string) => { await window.army.shells.close(name); if (active === name) { const rest = shells.filter(s => s.name !== name); if (rest.length) setActive(rest[rest.length - 1].name); else onClose(); } };
  const resize = (e: React.PointerEvent<HTMLDivElement>) => {
    const startY = e.clientY, start = height, box = (e.currentTarget.parentElement?.parentElement as HTMLElement).getBoundingClientRect();
    const move = (ev: PointerEvent) => setHeight(Math.round(Math.min(box.height - 120, Math.max(120, start - (ev.clientY - startY)))));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.classList.remove("resizing"); };
    document.body.classList.add("resizing"); window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const current = shells.find(s => s.name === active) || shells[shells.length - 1];
  return <div className="term-pane" style={{ height }}>
    <div className="term-splitter" role="separator" aria-orientation="horizontal" aria-label="Resize terminal" onPointerDown={resize} />
    <div className="term-bar" role="tablist" aria-label="Terminals">
      {shells.map(s => <div key={s.name} role="tab" aria-selected={s.name === current?.name} className={"term-tab" + (s.name === current?.name ? " active" : "") + (s.exited ? " exited" : "")} title={s.cwd} onClick={() => setActive(s.name)} onDoubleClick={() => setRenaming(s.name)}>
        <CommandLineIcon aria-hidden="true" />
        {renaming === s.name
          ? <input autoFocus aria-label="Terminal name" defaultValue={s.title} onBlur={e => { void window.army.shells.rename(s.name, e.target.value); setRenaming(null); }} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(null); }} onClick={e => e.stopPropagation()} />
          : <span>{s.title}{s.exited ? " (exited)" : ""}</span>}
        <button type="button" className="ide-tab-x" aria-label={`Close ${s.title}`} onClick={e => { e.stopPropagation(); void close(s.name); }}><XMarkIcon /></button>
      </div>)}
      <button type="button" className="icon-button" aria-label="New terminal" title="New terminal" onClick={() => void open()}><PlusIcon /></button>
      <span className="grow" />
      <button type="button" className="icon-button" aria-label="Hide terminal" title="Hide terminal (Ctrl `)" onClick={onClose}><XMarkIcon /></button>
    </div>
    <div className="term-body">{current ? <Console key={current.name} name={current.name} /> : <div className="ide-blank"><p>No terminal open</p></div>}</div>
  </div>;
}
