import { useEffect, useRef } from "react";
import { DocumentIcon, FolderIcon } from "@heroicons/react/16/solid";

/** A workspace path offered after "@" in the message box. Folders end with "/". */
export type MentionItem = { path: string; dir: boolean };

/** Files plus every folder above them, folders first in a stable order. */
export function mentionItems(files: string[]): MentionItem[] {
  const dirs = new Set<string>();
  for (const f of files) { let i = f.lastIndexOf("/"); while (i > 0) { const d = f.slice(0, i); if (dirs.has(d)) break; dirs.add(d); i = d.lastIndexOf("/"); } }
  return [...[...dirs].sort().map(d => ({ path: d + "/", dir: true })), ...files.map(f => ({ path: f, dir: false }))];
}

/** Best matches for what was typed after "@": name starts with it, then name contains it, then the path does. */
export function rankMentions(items: MentionItem[], query: string, limit = 8): MentionItem[] {
  const q = query.toLowerCase().replace(/\\/g, "/");
  if (!q) return items.filter(i => !i.path.slice(0, -1).includes("/")).slice(0, limit);
  const scored: [number, MentionItem][] = [];
  for (const item of items) {
    const p = item.path.toLowerCase(), name = (item.dir ? p.slice(0, -1) : p).split("/").pop() || "";
    const score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : p.includes(q) ? 2 : -1;
    if (score >= 0) scored.push([score * 1000 + Math.min(p.length, 999), item]);
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, i]) => i);
}

function Highlight({ text, query }: { text: string; query: string }) {
  const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + query.length)}</mark>{text.slice(i + query.length)}</>;
}

/** The list that opens above the message box while an "@path" is being typed. */
export function MentionMenu({ items, index, query, loading, pick, hover }: { items: MentionItem[]; index: number; query: string; loading: boolean; pick: (item: MentionItem) => void; hover: (i: number) => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: "nearest" }); }, [index]);
  return (
    <div className="mention-menu" role="listbox" aria-label="Files and folders" ref={list} onMouseDown={e => e.preventDefault()}>
      {items.length === 0 && <div className="mention-empty">{loading ? "Reading the workspace…" : query ? `Nothing matches “${query}”` : "No files in this workspace"}</div>}
      {items.map((item, i) => {
        const clean = item.dir ? item.path.slice(0, -1) : item.path, slash = clean.lastIndexOf("/");
        const name = clean.slice(slash + 1), parent = slash > 0 ? clean.slice(0, slash) : "";
        return (
          <div key={item.path} data-i={i} role="option" aria-selected={i === index} className={"mention-row" + (i === index ? " active" : "") + (item.dir ? " dir" : "")}
            onMouseEnter={() => hover(i)} onClick={() => pick(item)}>
            {item.dir ? <FolderIcon aria-hidden="true" /> : <DocumentIcon aria-hidden="true" />}
            <span className="mention-name"><Highlight text={name + (item.dir ? "/" : "")} query={query} /></span>
            {parent && <span className="mention-parent">{parent}</span>}
          </div>
        );
      })}
      <div className="mention-foot"><span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>Enter</kbd> insert</span><span><kbd>Esc</kbd> close</span></div>
    </div>
  );
}
