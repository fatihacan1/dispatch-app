import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuItem = { label: string; hint?: string; action: () => void } | "sep";

/** Compact native-feeling menu. Arrow keys move, Enter runs, Esc or an outside click closes; stays inside the window. */
export function TreeMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const actions = items.map((it, i) => (it === "sep" ? -1 : i)).filter(i => i >= 0);
  const [cur, setCur] = useState(actions[0] ?? -1);
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect(); if (!r) return;
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
    box.current?.focus();
  }, [x, y]);
  useEffect(() => {
    const off = (e: Event) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener("mousedown", off, true); window.addEventListener("blur", onClose); window.addEventListener("resize", onClose);
    return () => { window.removeEventListener("mousedown", off, true); window.removeEventListener("blur", onClose); window.removeEventListener("resize", onClose); };
  }, [onClose]);
  const run = (i: number) => { const it = items[i]; if (it && it !== "sep") { onClose(); it.action(); } };
  const onKey = (e: React.KeyboardEvent) => {
    const at = actions.indexOf(cur);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setCur(actions[(at + 1) % actions.length]); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCur(actions[(at - 1 + actions.length) % actions.length]); }
    else if (e.key === "Home") { e.preventDefault(); setCur(actions[0]); }
    else if (e.key === "End") { e.preventDefault(); setCur(actions[actions.length - 1]); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); run(cur); }
    else if (e.key === "Tab") e.preventDefault();
  };
  return <div className="tree-menu" role="menu" tabIndex={-1} ref={box} style={pos} onKeyDown={onKey} onContextMenu={e => e.preventDefault()}>
    {items.map((it, i) => it === "sep" ? <div key={i} className="tree-menu-sep" role="separator" /> :
      <div key={i} role="menuitem" className={"tree-menu-item" + (i === cur ? " active" : "")} onMouseEnter={() => setCur(i)} onClick={() => run(i)}>
        <span>{it.label}</span>{it.hint && <kbd>{it.hint}</kbd>}
      </div>)}
  </div>;
}

/** Delete confirmation: lists what goes to the trash. Enter confirms, Esc cancels. */
export function DeleteDialog({ paths, onConfirm, onCancel }: { paths: string[]; onConfirm: () => void; onCancel: () => void }) {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => { ok.current?.focus(); }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
    else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement && e.target !== ok.current)) { e.preventDefault(); e.stopPropagation(); onConfirm(); }
  };
  const mac = /Mac/i.test(navigator.platform);
  return <div className="tree-confirm-back" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }} onKeyDown={onKey}>
    <div className="tree-confirm" role="alertdialog" aria-modal="true" aria-labelledby="tree-confirm-title">
      <h3 id="tree-confirm-title">{paths.length === 1 ? "Delete this item?" : `Delete these ${paths.length} items?`}</h3>
      <p>{mac ? "They move to the Trash." : "They move to the Recycle Bin."} Folders include everything inside.</p>
      <ul>{paths.slice(0, 8).map(p => <li key={p} title={p}>{p}</li>)}{paths.length > 8 && <li className="more">and {paths.length - 8} more</li>}</ul>
      <div className="tree-confirm-actions">
        <button type="button" className="button secondary" onClick={onCancel}>Cancel <kbd>Esc</kbd></button>
        <button type="button" className="button danger" ref={ok} onClick={onConfirm}>Delete <kbd>Enter</kbd></button>
      </div>
    </div>
  </div>;
}
