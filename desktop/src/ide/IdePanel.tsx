import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDoubleLeftIcon, ChevronDoubleRightIcon, ChevronRightIcon, DocumentIcon, FolderIcon, FolderOpenIcon, MagnifyingGlassIcon, XMarkIcon, ArrowsRightLeftIcon, ArrowPathIcon, CommandLineIcon, CodeBracketIcon } from "@heroicons/react/16/solid";
import { monaco, applyTheme } from "./monaco";

type Entry = { name: string; path: string; dir: boolean; ignored?: boolean };
type Tab = { path: string; model: monaco.editor.ITextModel | null; dirty: boolean; diff: boolean; note?: string; saved: string };
export type OpenRequest = { path: string; diff?: boolean; line?: number; nonce: number };
type GitFile = { path: string; status?: string };

const uriFor = (rel: string) => monaco.Uri.from({ scheme: "file", path: "/ws/" + rel });
const base = (p: string) => p.split("/").pop() || p;
// Go: gopls behind the main process gives suggestions, hovers, signature help and problems. Registered once.
const relOf = (uri: monaco.Uri) => uri.path.replace(/^\/ws\//, "");
const lspPos = (p: monaco.Position) => ({ line: p.lineNumber - 1, character: p.column - 1 });
const KIND: Record<number, monaco.languages.CompletionItemKind> = { 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 7, 9: 8, 10: 9, 13: 15, 14: 17, 21: 14, 22: 6, 25: 24 } as any;
const mdText = (c: any) => typeof c === "string" ? c : c?.value || "";
let goReady = false;
function registerGo() {
  if (goReady) return; goReady = true;
  monaco.languages.registerCompletionItemProvider("go", { triggerCharacters: ["."], async provideCompletionItems(model, position) {
    const res = await window.army.files.lsp.request("go", "textDocument/completion", relOf(model.uri), lspPos(position)).catch(() => null);
    const items: any[] = Array.isArray(res) ? res : res?.items || [];
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
    return { suggestions: items.map(it => ({ label: it.label, kind: KIND[it.kind] ?? monaco.languages.CompletionItemKind.Text, detail: it.detail, documentation: it.documentation ? { value: mdText(it.documentation) } : undefined,
      insertText: (it.textEdit?.newText ?? it.insertText ?? it.label), insertTextRules: it.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined, sortText: it.sortText, filterText: it.filterText, range })) };
  } });
  monaco.languages.registerHoverProvider("go", { async provideHover(model, position) {
    const res = await window.army.files.lsp.request("go", "textDocument/hover", relOf(model.uri), lspPos(position)).catch(() => null);
    if (!res?.contents) return null;
    const parts = Array.isArray(res.contents) ? res.contents : [res.contents];
    return { contents: parts.map((c: any) => ({ value: typeof c === "string" ? c : c.language ? "```" + c.language + "\n" + c.value + "\n```" : c.value })) };
  } });
  monaco.languages.registerSignatureHelpProvider("go", { signatureHelpTriggerCharacters: ["(", ","], async provideSignatureHelp(model, position) {
    const res = await window.army.files.lsp.request("go", "textDocument/signatureHelp", relOf(model.uri), lspPos(position)).catch(() => null);
    if (!res?.signatures?.length) return null;
    return { value: { signatures: res.signatures.map((s: any) => ({ label: s.label, documentation: s.documentation ? { value: mdText(s.documentation) } : undefined, parameters: (s.parameters || []).map((p: any) => ({ label: p.label, documentation: p.documentation ? { value: mdText(p.documentation) } : undefined })) })), activeSignature: res.activeSignature || 0, activeParameter: res.activeParameter || 0 }, dispose() {} };
  } });
  window.army.on("lsp-diagnostics", (d: { rel: string; diagnostics: any[] }) => {
    const model = monaco.editor.getModel(uriFor(d.rel)); if (!model) return;
    monaco.editor.setModelMarkers(model, "gopls", d.diagnostics.map(x => ({ startLineNumber: x.range.start.line + 1, startColumn: x.range.start.character + 1, endLineNumber: x.range.end.line + 1, endColumn: x.range.end.character + 1, message: x.message, severity: x.severity === 1 ? monaco.MarkerSeverity.Error : x.severity === 2 ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info, source: "gopls" })));
  });
}
const parent = (p: string) => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";

// editorOnFile (Settings > Appearance): with no file open the panel is only the tree, the editor appears with the first file.
// treeToggle: a button that folds the tree away so the editor gets the whole panel.
export function IdePanel({ workspace, open, request, gitFiles, terminal, terminalOpen, toggleTerminal, close, editorOnFile, treeToggle, onCompact }: { close?: () => void; workspace: string; open: boolean; request: OpenRequest | null; gitFiles: GitFile[] | null; terminal?: React.ReactNode; terminalOpen?: boolean; toggleTerminal?: () => void; editorOnFile?: boolean; treeToggle?: boolean; onCompact?: (compact: boolean) => void }) {
  const [children, setChildren] = useState<Record<string, Entry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [side, setSide] = useState<"files" | "search">("files");
  const [quick, setQuick] = useState<{ query: string; files: string[]; index: number } | null>(null);
  const [search, setSearch] = useState({ query: "", results: [] as { path: string; line: number; col: number; text: string }[], busy: false, done: false });
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const diffEditor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const originals = useRef(new Map<string, monaco.editor.ITextModel>());
  const views = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>());
  const tabsRef = useRef(tabs); tabsRef.current = tabs;
  const activeRef = useRef(active); activeRef.current = active;
  const panel = useRef<HTMLDivElement>(null);
  // Two stacked panes: the editor and the diff editor; only one is shown.
  const editPane = useRef<HTMLDivElement | null>(null), diffPane = useRef<HTMLDivElement | null>(null);
  const showPane = (diff: boolean) => { if (editPane.current) editPane.current.style.display = diff ? "none" : ""; if (diffPane.current) diffPane.current.style.display = diff ? "" : "none"; };

  const gitStatus = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of gitFiles || []) {
      const st = f.status || "modified";
      map.set(f.path, st);
      for (let p = parent(f.path); p; p = parent(p)) if (!map.has(p + "/")) map.set(p + "/", "modified");
    }
    return map;
  }, [gitFiles]);

  const loadDir = useCallback(async (rel: string) => {
    const items = await window.army.files.list(rel).catch(() => []);
    setChildren(c => ({ ...c, [rel]: items }));
  }, []);

  // New workspace: start over.
  useEffect(() => {
    for (const t of tabsRef.current) t.model?.dispose();
    for (const m of originals.current.values()) m.dispose();
    originals.current.clear(); views.current.clear();
    setTabs([]); setActive(null); setChildren({}); setExpanded(new Set([""]));
    void loadDir("");
  }, [workspace, loadDir]);

  // Watch the folder only while the panel is open.
  useEffect(() => {
    if (!open) return;
    void window.army.files.watch(true);
    void loadDir("");
    return () => { void window.army.files.watch(false); };
  }, [open, workspace, loadDir]);

  // Monaco instances live as long as the panel.
  useEffect(() => {
    applyTheme();
    const options: monaco.editor.IEditorOptions = {
      automaticLayout: true, fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono"), fontSize: 13, lineHeight: 20,
      minimap: { enabled: false }, scrollBeyondLastLine: false, renderLineHighlight: "line", smoothScrolling: true, padding: { top: 8 },
      bracketPairColorization: { enabled: true }, stickyScroll: { enabled: false }, fixedOverflowWidgets: true,
    };
    const editHolder = document.createElement("div"); editHolder.className = "ide-edit"; host.current!.appendChild(editHolder); editPane.current = editHolder;
    const ed = monaco.editor.create(editHolder, { ...options, model: null });
    editor.current = ed;
    const save = () => void saveActive();
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
    return () => { ed.dispose(); diffEditor.current?.dispose(); diffEditor.current = null; };
  }, []);

  const saveActive = async () => {
    const tab = tabsRef.current.find(t => t.path === activeRef.current);
    if (!tab?.model) return;
    const text = tab.model.getValue();
    try { await window.army.files.write(tab.path, text); setTabs(ts => ts.map(t => t.path === tab.path ? { ...t, dirty: false, saved: text } : t)); }
    catch (e) { setTabs(ts => ts.map(t => t.path === tab.path ? { ...t, note: "Could not save: " + String(e).replace(/^Error: Error invoking remote method '[^']+': (Error: )?/, "") } : t)); }
  };

  const showTab = useCallback(async (tab: Tab | undefined, line?: number) => {
    const ed = editor.current; if (!ed || !host.current) return;
    const prev = activeRef.current;
    if (prev && ed.getModel()) views.current.set(prev, ed.saveViewState());
    if (!tab || !tab.model) { ed.setModel(null); showPane(false); return; }
    if (tab.diff) {
      let original = originals.current.get(tab.path);
      if (!original) {
        const headText = await window.army.files.head(tab.path).catch(() => null);
        original = monaco.editor.createModel(headText ?? "", undefined, monaco.Uri.from({ scheme: "head", path: "/ws/" + tab.path }));
        monaco.editor.setModelLanguage(original, tab.model.getLanguageId());
        originals.current.set(tab.path, original);
      }
      if (!diffEditor.current) {
        const holder = document.createElement("div"); holder.className = "ide-diff"; host.current.appendChild(holder); diffPane.current = holder;
        diffEditor.current = monaco.editor.createDiffEditor(holder, { automaticLayout: true, renderSideBySide: (panel.current?.clientWidth || 0) > 900, minimap: { enabled: false }, fontSize: 13, lineHeight: 20, scrollBeyondLastLine: false, originalEditable: false, fixedOverflowWidgets: true });
        diffEditor.current.getModifiedEditor().addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveActive());
      }
      diffEditor.current.setModel({ original, modified: tab.model });
      showPane(true);
      if (line) diffEditor.current.getModifiedEditor().revealLineInCenter(line);
      return;
    }
    showPane(false);
    ed.setModel(tab.model);
    const state = views.current.get(tab.path); if (state) ed.restoreViewState(state);
    if (line) { ed.revealLineInCenter(line); ed.setPosition({ lineNumber: line, column: 1 }); }
    ed.focus();
  }, []);

  const openFile = useCallback(async (rel: string, opts: { diff?: boolean; line?: number } = {}) => {
    const existing = tabsRef.current.find(t => t.path === rel);
    if (existing) {
      const next = opts.diff === undefined ? existing : { ...existing, diff: opts.diff };
      if (next !== existing) setTabs(ts => ts.map(t => t.path === rel ? next : t));
      setActive(rel); await showTab(next, opts.line); return;
    }
    const file = await window.army.files.read(rel).catch(e => ({ error: String(e) } as any));
    let tab: Tab;
    if (file.text === undefined) {
      const note = file.binary ? "Binary file, not shown." : file.tooLarge ? `File is too large to open here (${Math.round((file.size || 0) / 1048576)} MB).` : "Could not open this file.";
      tab = { path: rel, model: null, dirty: false, diff: false, note, saved: "" };
    } else {
      const model = monaco.editor.getModel(uriFor(rel)) || monaco.editor.createModel(file.text, undefined, uriFor(rel));
      tab = { path: rel, model, dirty: false, diff: !!opts.diff, saved: file.text };
      model.onDidChangeContent(() => setTabs(ts => ts.map(t => t.path === rel ? { ...t, dirty: model.getValue() !== t.saved } : t)));
      if (/\.go$/i.test(rel)) {
        registerGo(); let version = 1, timer = 0;
        void window.army.files.lsp.open("go", rel, model.getValue()).catch(() => {});
        model.onDidChangeContent(() => { window.clearTimeout(timer); timer = window.setTimeout(() => void window.army.files.lsp.change("go", rel, ++version, model.getValue()).catch(() => {}), 200); });
        model.onWillDispose(() => void window.army.files.lsp.close("go", rel).catch(() => {}));
      }
      // Python: Ruff checks the text as it is typed (half a second after the last key), problems show as squiggles.
      if (/\.pyi?$/i.test(rel)) {
        let timer = 0;
        const run = () => { const text = model.getValue(); window.army.files.lint(rel, text).then(items => {
          if (model.isDisposed() || model.getValue() !== text) return;
          monaco.editor.setModelMarkers(model, "ruff", (items || []).map(d => ({ startLineNumber: d.line, startColumn: d.col, endLineNumber: d.endLine, endColumn: Math.max(d.endCol, d.col + 1), message: d.message, severity: d.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning, source: "ruff" })));
        }).catch(() => {}); };
        run(); model.onDidChangeContent(() => { window.clearTimeout(timer); timer = window.setTimeout(run, 500); });
      }
    }
    setTabs(ts => [...ts, tab]); setActive(rel);
    // Expand the folders down to the file so the tree shows where it is.
    const dirs: string[] = []; for (let p = parent(rel); p; p = parent(p)) dirs.unshift(p);
    setExpanded(s => { const n = new Set(s); dirs.forEach(d => n.add(d)); return n; });
    for (const d of dirs) if (!children[d]) void loadDir(d);
    await showTab(tab, opts.line);
  }, [showTab, loadDir, children]);

  const closeTab = (rel: string) => {
    const i = tabsRef.current.findIndex(t => t.path === rel); if (i < 0) return;
    const tab = tabsRef.current[i];
    const rest = tabsRef.current.filter(t => t.path !== rel);
    if (active === rel) { const next = rest[i] || rest[i - 1]; setActive(next?.path || null); void showTab(next); }
    if (diffEditor.current && tab.model && diffEditor.current.getModel()?.modified === tab.model) diffEditor.current.setModel(null);
    tab.model?.dispose(); originals.current.get(rel)?.dispose(); originals.current.delete(rel); views.current.delete(rel);
    setTabs(rest);
  };

  // Requests from outside (Changed files in the side panel).
  useEffect(() => { if (request) void openFile(request.path, { diff: request.diff, line: request.line }); }, [request?.nonce]);

  // Disk changes: refresh the tree, reload clean tabs silently. A dirty tab keeps the user's text; saving overwrites.
  useEffect(() => window.army.on("files-changed", async (batch: { path: string; kind: string }[]) => {
    const dirs = new Set<string>();
    for (const c of batch) if (c.kind !== "change") dirs.add(parent(c.path));
    for (const d of dirs) if (children[d] || d === "") void loadDir(d);
    for (const c of batch) {
      const tab = tabsRef.current.find(t => t.path === c.path); if (!tab?.model || tab.dirty) continue;
      if (c.kind === "unlink") { setTabs(ts => ts.map(t => t.path === c.path ? { ...t, note: "Deleted on disk." } : t)); continue; }
      const file = await window.army.files.read(c.path).catch(() => null);
      if (!file || file.text === undefined || file.text === tab.model.getValue()) continue;
      const ed = activeRef.current === c.path && !tab.diff ? editor.current : null;
      const view = ed?.saveViewState();
      tab.model.pushEditOperations([], [{ range: tab.model.getFullModelRange(), text: file.text }], () => null);
      setTabs(ts => ts.map(t => t.path === c.path ? { ...t, saved: file.text!, dirty: false, note: undefined } : t));
      if (ed && view) ed.restoreViewState(view);
      const orig = originals.current.get(c.path); if (orig) { orig.dispose(); originals.current.delete(c.path); if (tab.diff && activeRef.current === c.path) void showTab({ ...tab }); }
    }
  }), [children, loadDir, showTab]);

  // Panel shortcuts: Ctrl P quick open, Ctrl Shift F search, Ctrl W close tab.
  useEffect(() => {
    if (!open) return;
    const key = async (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === "p" && !e.shiftKey) { e.preventDefault(); setQuick({ query: "", files: [], index: 0 }); const files = await window.army.files.all().catch(() => []); setQuick(q => q ? { ...q, files } : q); }
      if (k === "f" && e.shiftKey) { e.preventDefault(); setSide("search"); setTimeout(() => panel.current?.querySelector<HTMLInputElement>(".ide-search input")?.focus(), 30); }
      if (k === "w" && panel.current?.contains(document.activeElement) && activeRef.current) { e.preventDefault(); closeTab(activeRef.current); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, active]);

  const quickMatches = useMemo(() => {
    if (!quick) return [];
    const q = quick.query.toLowerCase().replace(/\\/g, "/");
    if (!q) return quick.files.slice(0, 60);
    const scored: [number, string][] = [];
    for (const f of quick.files) {
      const lower = f.toLowerCase(); const name = base(lower);
      const score = name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : lower.includes(q) ? 3 : -1;
      if (score >= 0) scored.push([score * 1000 + f.length, f]);
    }
    return scored.sort((a, b) => a[0] - b[0]).slice(0, 60).map(x => x[1]);
  }, [quick?.query, quick?.files]);

  const runSearch = async () => {
    if (!search.query.trim()) return;
    setSearch(s => ({ ...s, busy: true }));
    const results = await window.army.files.search(search.query).catch(() => []);
    setSearch(s => ({ ...s, results, busy: false, done: true }));
  };

  const toggleDir = (rel: string) => {
    setExpanded(s => { const n = new Set(s); if (n.has(rel)) n.delete(rel); else { n.add(rel); if (!children[rel]) void loadDir(rel); } return n; });
  };

  const renderDir = (rel: string, depth: number): React.ReactNode => (children[rel] || []).map(e => {
    const st = gitStatus.get(e.dir ? e.path + "/" : e.path);
    const isOpen = e.dir && expanded.has(e.path);
    return <React.Fragment key={e.path}>
      <button type="button" data-dir={e.dir ? e.path : e.path.includes("/") ? e.path.slice(0, e.path.lastIndexOf("/")) : ""} className={"ide-row" + (e.dir && dropDir === e.path ? " drop" : "") + (active === e.path ? " selected" : "") + (e.ignored ? " ignored" : "") + (st ? " git-" + st : "")} style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => e.dir ? toggleDir(e.path) : void openFile(e.path)} title={e.path}
        onContextMenu={async ev => {
          ev.preventDefault(); ev.stopPropagation();
          const r = await window.army.files.context?.(e.path, !!e.dir).catch(() => null);
          if (r === "open") void openFile(e.path);
          if (r === "deleted") { const parent = e.path.includes("/") ? e.path.slice(0, e.path.lastIndexOf("/")) : ""; if (tabs.some(t => t.path === e.path || t.path.startsWith(e.path + "/"))) for (const t of tabs) if (t.path === e.path || t.path.startsWith(e.path + "/")) closeTab(t.path); void loadDir(parent); }
        }}>
        {e.dir ? <ChevronRightIcon className={"ide-chev" + (isOpen ? " open" : "")} aria-hidden="true" /> : <span className="ide-chev-space" />}
        {e.dir ? (isOpen ? <FolderOpenIcon className="ide-ico" aria-hidden="true" /> : <FolderIcon className="ide-ico" aria-hidden="true" />) : <DocumentIcon className="ide-ico" aria-hidden="true" />}
        <span className="ide-name">{e.name}</span>
        {st && !e.dir && <span className="ide-git">{st === "new" ? "U" : st === "deleted" ? "D" : "M"}</span>}
      </button>
      {isOpen && renderDir(e.path, depth + 1)}
    </React.Fragment>;
  });

  // Drop files/folders from the OS onto the tree: copied into the folder under the pointer (VS Code style).
  const [dropDir, setDropDir] = useState<string | null>(null);
  const dirAt = (el: EventTarget | null) => (el as HTMLElement | null)?.closest?.("[data-dir]")?.getAttribute("data-dir") ?? "";
  const onTreeDragOver = (e: React.DragEvent) => { if (!e.dataTransfer.types.includes("Files")) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; const d = dirAt(e.target); if (d !== dropDir) setDropDir(d); };
  const onTreeDrop = async (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault(); const dir = dirAt(e.target); setDropDir(null);
    const items: { name: string; data: ArrayBuffer | null }[] = [];
    const walk = async (entry: any, prefix: string): Promise<void> => {
      if (entry.isFile) { const f: File = await new Promise((res, rej) => entry.file(res, rej)); items.push({ name: prefix + f.name, data: await f.arrayBuffer() }); return; }
      items.push({ name: prefix + entry.name, data: null });
      const reader = entry.createReader(); let batch: any[];
      do { batch = await new Promise((res, rej) => reader.readEntries(res, rej)); for (const c of batch) await walk(c, prefix + entry.name + "/"); } while (batch.length);
    };
    const entries = Array.from(e.dataTransfer.items).map(i => i.webkitGetAsEntry()).filter(Boolean);
    for (const en of entries) await walk(en, "");
    if (!items.length) return;
    try { await window.army.files.import(dir, items); void loadDir(dir); if (dir) setExpanded(s => new Set(s).add(dir)); } catch (err) { console.error(err); }
  };

  const activeTab = tabs.find(t => t.path === active);
  const rootName = workspace.split(/[\\/]/).pop() || workspace;
  const compact = !!editorOnFile && tabs.length === 0 && !terminalOpen;
  const [treeHidden, setTreeHidden] = useState(false);
  const hideTree = !!treeToggle && treeHidden && !compact;
  useEffect(() => { onCompact?.(compact); }, [compact]);
  const closeButton = close && <button type="button" className="button ghost ide-toggle on" aria-pressed="true" aria-label="Hide files" title="Hide files (Ctrl E)" onClick={close}><CodeBracketIcon aria-hidden="true" />Files</button>;

  return <div className={"ide" + (compact ? " compact" : "") + (hideTree ? " tree-hidden" : "")} ref={panel} onDragOver={e => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.stopPropagation(); } }} onDrop={e => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}>
    <div className="ide-side">
      <div className="ide-side-head">
        <div className="ide-seg" role="tablist" aria-label="Explorer">
          <button type="button" role="tab" aria-selected={side === "files"} onClick={() => setSide("files")}>Files</button>
          <button type="button" role="tab" aria-selected={side === "search"} onClick={() => setSide("search")}>Search</button>
        </div>
        <span className="grow" />
        <button type="button" className="icon-button" title="Quick open (Ctrl P)" aria-label="Quick open" onClick={async () => { setQuick({ query: "", files: [], index: 0 }); const files = await window.army.files.all().catch(() => []); setQuick(q => q ? { ...q, files } : q); }}><MagnifyingGlassIcon /></button>
        <button type="button" className="icon-button" title="Refresh" aria-label="Refresh files" onClick={() => { for (const d of Object.keys(children)) void loadDir(d); }}><ArrowPathIcon /></button>
        {treeToggle && !compact && <button type="button" className="icon-button" title="Hide the file tree" aria-label="Hide the file tree" onClick={() => setTreeHidden(true)}><ChevronDoubleLeftIcon /></button>}
        {compact && closeButton}
      </div>
      {side === "files" ? <div className={"ide-tree" + (dropDir === "" ? " drop" : "")} role="tree" aria-label={rootName} data-dir="" onDragOver={onTreeDragOver} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropDir(null); }} onDrop={e => void onTreeDrop(e)}>
        <div className="ide-root" title={workspace}>{rootName}</div>
        {renderDir("", 0)}
        {children[""]?.length === 0 && <p className="empty-line ide-empty">This folder is empty.</p>}
      </div> : <div className="ide-search">
        <form onSubmit={e => { e.preventDefault(); void runSearch(); }}><input aria-label="Search in files" placeholder="Search in files…" value={search.query} onChange={e => setSearch(s => ({ ...s, query: e.target.value, done: false }))} /></form>
        <div className="ide-results">
          {search.busy ? <p className="empty-line">Searching…</p> : search.done && !search.results.length ? <p className="empty-line">No results.</p> : search.results.map((r, i) =>
            <button type="button" key={i} className="ide-result" onClick={() => void openFile(r.path, { line: r.line, diff: false })} title={`${r.path}:${r.line}`}>
              <span className="ide-result-file">{base(r.path)}<small>{r.line}</small></span>
              <span className="ide-result-text">{r.text.trim()}</span>
            </button>)}
          {search.results.length >= 300 && <p className="empty-line">Showing the first 300 matches.</p>}
        </div>
      </div>}
    </div>
    <div className="ide-main">
      <div className="ide-tabs" role="tablist" aria-label="Open files">
        {hideTree && <button type="button" className="icon-button" title="Show the file tree" aria-label="Show the file tree" onClick={() => setTreeHidden(false)}><ChevronDoubleRightIcon /></button>}
        {tabs.map(t => <div key={t.path} role="tab" aria-selected={t.path === active} className={"ide-tab" + (t.path === active ? " active" : "")} title={t.path}
          onMouseDown={e => { if (e.button === 1) { e.preventDefault(); closeTab(t.path); } }} onClick={() => { setActive(t.path); void showTab(t); }}>
          <span>{base(t.path)}</span>
          {t.dirty ? <span className="ide-dirty" aria-label="Unsaved" /> : null}
          <button type="button" className="ide-tab-x" aria-label={`Close ${base(t.path)}`} onClick={e => { e.stopPropagation(); closeTab(t.path); }}><XMarkIcon /></button>
        </div>)}
        <span className="grow" />
        {closeButton}
        {toggleTerminal && <button type="button" className={"icon-button" + (terminalOpen ? " on" : "")} aria-pressed={!!terminalOpen} title="Terminal (Ctrl `)" aria-label="Toggle terminal" onClick={toggleTerminal}><CommandLineIcon /></button>}
        {activeTab?.model && <button type="button" className={"icon-button" + (activeTab.diff ? " on" : "")} aria-pressed={activeTab.diff} title={activeTab.diff ? "Back to editor" : "Compare with last commit"} aria-label="Toggle diff" onClick={() => void openFile(activeTab.path, { diff: !activeTab.diff })}><ArrowsRightLeftIcon /></button>}
      </div>
      {activeTab && <div className="ide-path"><span>{activeTab.path.split("/").join(" / ")}</span>{activeTab.diff && <span className="tag">HEAD ↔ working tree</span>}{activeTab.note && <span className="ide-note">{activeTab.note}</span>}</div>}
      <div className="ide-editor" ref={host}>
        {!activeTab && <div className="ide-blank"><p>Open a file from the tree</p><p className="ide-keys">{[["Ctrl P", "quick open"], ["Ctrl Shift F", "search"], ["Ctrl S", "save"], ["Ctrl `", "terminal"]].map(([k, l]) => <span key={k}><kbd>{k}</kbd> {l}</span>)}</p></div>}
      </div>
      {terminalOpen && terminal}
    </div>
    {quick && <div className="ide-quick-wrap" onMouseDown={e => { if (e.target === e.currentTarget) setQuick(null); }}>
      <div className="ide-quick" role="dialog" aria-label="Quick open">
        <input autoFocus aria-label="File name" placeholder={quick.files.length ? "Go to file…" : "Loading files…"} value={quick.query}
          onChange={e => setQuick({ ...quick, query: e.target.value, index: 0 })}
          onKeyDown={e => {
            if (e.key === "Escape") setQuick(null);
            if (e.key === "ArrowDown") { e.preventDefault(); setQuick({ ...quick, index: Math.min(quickMatches.length - 1, quick.index + 1) }); }
            if (e.key === "ArrowUp") { e.preventDefault(); setQuick({ ...quick, index: Math.max(0, quick.index - 1) }); }
            if (e.key === "Enter" && quickMatches[quick.index]) { setQuick(null); void openFile(quickMatches[quick.index]); }
          }} />
        <div className="ide-quick-list">{quickMatches.map((f, i) => <button type="button" key={f} className={"ide-quick-row" + (i === quick.index ? " selected" : "")} onMouseEnter={() => setQuick({ ...quick, index: i })} onClick={() => { setQuick(null); void openFile(f); }}><b>{base(f)}</b><small>{parent(f)}</small></button>)}</div>
      </div>
    </div>}
  </div>;
}
export default IdePanel;
