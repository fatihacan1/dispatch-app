import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDoubleLeftIcon, ChevronDoubleRightIcon, ChevronRightIcon, MagnifyingGlassIcon, XMarkIcon, ArrowsRightLeftIcon, ArrowPathIcon, CommandLineIcon, CodeBracketIcon } from "@heroicons/react/16/solid";
import { FileIcon } from "../components/FileIcon";
import { monaco, applyTheme } from "./monaco";
import { TreeMenu, DeleteDialog, type MenuItem } from "./TreeMenu";
import { ask as dialogs } from "../components/ask";

const MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

type Entry = { name: string; path: string; dir: boolean; ignored?: boolean };
type Tab = { path: string; model: monaco.editor.ITextModel | null; dirty: boolean; diff: boolean; note?: string; saved: string; media?: Media };
type Media = { kind: "image" | "video" | "audio"; url: string; size: number };
export type OpenRequest = { path: string; diff?: boolean; line?: number; nonce: number };
type GitFile = { path: string; status?: string };

const uriFor = (rel: string) => monaco.Uri.from({ scheme: "file", path: "/ws/" + rel });
const base = (p: string) => p.split("/").pop() || p;
// Language servers behind the main process give suggestions, hovers, signature help and problems.
const relOf = (uri: monaco.Uri) => uri.path.replace(/^\/ws\//, "");
const lspPos = (p: monaco.Position) => ({ line: p.lineNumber - 1, character: p.column - 1 });
const extOf = (rel: string) => /\.([^./]+)$/.exec(rel)?.[1].toLowerCase() || "";
/** Which server a file goes to ("" = none). */
const LANG: Record<string, string> = { go: "go", rs: "rust", cs: "csharp", c: "cpp", h: "cpp", cc: "cpp", cpp: "cpp", cxx: "cpp", hh: "cpp", hpp: "cpp", hxx: "cpp", ino: "cpp", ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript", js: "typescript", jsx: "typescript", mjs: "typescript", cjs: "typescript" };
const langOf = (rel: string) => LANG[extOf(rel)] || "";
const LANG_NAME: Record<string, string> = { go: "Go", rust: "Rust", csharp: "C#", cpp: "C and C++", typescript: "TypeScript and JavaScript" };
const TRIGGERS: Record<string, string[]> = { go: ["."], rust: [".", ":"], csharp: [".", ":"], cpp: [".", ">", ":", "<", "\"", "/"], typescript: [".", "\"", "'", "/", "@", "<"], javascript: [".", "\"", "'", "/", "@", "<"], c: [".", ">", "<", "\"", "/"] };
const KIND: Record<number, monaco.languages.CompletionItemKind> = { 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 7, 9: 8, 10: 9, 13: 15, 14: 17, 21: 14, 22: 6, 25: 24 } as any;
const mdText = (c: any) => typeof c === "string" ? c : c?.value || "";
// Edits reach the server in batches, 200 ms after the last key. A question about the text has to send them first: asked
// right after a "." it still had the text without it and answered with nothing, so no list ever opened.
const unsent = new Map<string, () => Promise<unknown>>();
const serving = new Set<string>(); // files a server has open; others keep what the editor itself knows
const ask = (method: string, model: monaco.editor.ITextModel, position: monaco.Position) => {
  const rel = relOf(model.uri); if (!serving.has(rel)) return Promise.resolve(null); void unsent.get(rel)?.();
  return window.army.files.lsp.request(langOf(rel), "textDocument/" + method, rel, lspPos(position)).catch(() => null);
};
const toRange = (r: any) => new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1);
const extraEdits = (edits: any[] | undefined) => edits?.map(x => ({ range: toRange(x.range), text: x.newText }));
const parts = (contents: any): { value: string }[] => (Array.isArray(contents) ? contents : [contents]).map((c: any) => ({ value: typeof c === "string" ? c : c.language ? "```" + c.language + "\n" + c.value + "\n```" : c.value }));
const registered = new Set<string>();
function registerServer(id: string) {
  if (!registered.size) window.army.on("lsp-diagnostics", (d: { lang: string; rel: string; diagnostics: any[] }) => {
    const model = monaco.editor.getModel(uriFor(d.rel)); if (!model) return;
    monaco.editor.setModelMarkers(model, "lsp", d.diagnostics.map(x => ({ startLineNumber: x.range.start.line + 1, startColumn: x.range.start.character + 1, endLineNumber: x.range.end.line + 1, endColumn: x.range.end.character + 1, message: x.message, severity: x.severity === 1 ? monaco.MarkerSeverity.Error : x.severity === 2 ? monaco.MarkerSeverity.Warning : x.severity === 4 ? monaco.MarkerSeverity.Hint : monaco.MarkerSeverity.Info, source: x.source || d.lang })));
  });
  if (registered.has(id)) return; registered.add(id);
  monaco.languages.registerCompletionItemProvider(id, { triggerCharacters: TRIGGERS[id] || ["."], async provideCompletionItems(model, position) {
    const res = await ask("completion", model, position);
    const items: any[] = Array.isArray(res) ? res : res?.items || [];
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
    return { incomplete: !!res?.isIncomplete, suggestions: items.map(it => {
      // A server may replace more than the word ("<vec" in an include, ".foo" turned into "?.foo"): only on this line.
      const edit = it.textEdit?.range || it.textEdit?.insert, own = edit && edit.start.line === edit.end.line && edit.start.line === position.lineNumber - 1 && edit.start.character <= position.column - 1 ? new monaco.Range(position.lineNumber, edit.start.character + 1, position.lineNumber, Math.max(position.column, edit.end.character + 1)) : range;
      // clangd marks a name that also adds an include with a dot or a space before it.
      const label = String(it.label).replace(/^[\s\u2022]+/, "");
      return { label, kind: KIND[it.kind] ?? monaco.languages.CompletionItemKind.Text, detail: it.detail, documentation: it.documentation ? { value: mdText(it.documentation) } : undefined,
        insertText: (it.textEdit?.newText ?? it.insertText ?? label), insertTextRules: it.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined, sortText: it.sortText, filterText: it.filterText, preselect: it.preselect, range: own, additionalTextEdits: extraEdits(it.additionalTextEdits), lsp: { rel: relOf(model.uri), item: it } };
    }) };
  }, async resolveCompletionItem(item: any) {
    const { rel, item: raw } = item.lsp || {}; if (!rel || raw.data === undefined) return item;
    const r = await window.army.files.lsp.resolve(langOf(rel), rel, raw).catch(() => null); if (!r) return item;
    return { ...item, detail: r.detail || item.detail, documentation: r.documentation ? { value: mdText(r.documentation) } : item.documentation, additionalTextEdits: extraEdits(r.additionalTextEdits) || item.additionalTextEdits };
  } });
  monaco.languages.registerHoverProvider(id, { async provideHover(model, position) {
    const res = await ask("hover", model, position);
    return res?.contents ? { contents: parts(res.contents) } : null;
  } });
  monaco.languages.registerSignatureHelpProvider(id, { signatureHelpTriggerCharacters: ["(", ","], async provideSignatureHelp(model, position) {
    const res = await ask("signatureHelp", model, position);
    if (!res?.signatures?.length) return null;
    return { value: { signatures: res.signatures.map((s: any) => ({ label: s.label, documentation: s.documentation ? { value: mdText(s.documentation) } : undefined, parameters: (s.parameters || []).map((p: any) => ({ label: p.label, documentation: p.documentation ? { value: mdText(p.documentation) } : undefined })) })), activeSignature: res.activeSignature || 0, activeParameter: res.activeParameter || 0 }, dispose() {} };
  } });
}
// The TypeScript server knows the project's packages; the editor's own checker does not, so it steps back once it runs.
let ownTs = true;
function tsToServer() {
  if (!ownTs) return; ownTs = false;
  const off = { completionItems: false, hovers: false, signatureHelp: false, diagnostics: false };
  for (const d of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) d.setModeConfiguration({ ...d.modeConfiguration, ...off });
}
const parent = (p: string) => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";

const sizeText = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
/** Image, video or audio file in the editor area. An image fits the panel; a click shows it in its real size. */
function MediaView({ media, name, onDims }: { media: Media; name: string; onDims: (text: string) => void }) {
  const [actual, setActual] = useState(false), [failed, setFailed] = useState(false);
  if (failed) return <div className="ide-media"><p>{name} cannot be shown here. Right-click it in the tree and choose Open with default app.</p></div>;
  return <div className={"ide-media" + (actual ? " actual" : "")}>
    {media.kind === "image" ? <img src={media.url} alt={name} title={actual ? "Fit to the panel" : "Show in real size"} draggable={false} onError={() => setFailed(true)} onLoad={e => onDims(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)} onClick={() => setActual(v => !v)} />
      : media.kind === "video" ? <video src={media.url} controls preload="metadata" onError={() => setFailed(true)} onLoadedMetadata={e => onDims(`${e.currentTarget.videoWidth} × ${e.currentTarget.videoHeight}`)} />
      : <audio src={media.url} controls preload="metadata" onError={() => setFailed(true)} />}
  </div>;
}

// editorOnFile (Settings > Appearance): with no file open the panel is only the tree, the editor appears with the first file.
// treeToggle: a button that folds the tree away so the editor gets the whole panel.
export function IdePanel({ workspace, open, request, gitFiles, terminal, terminalOpen, toggleTerminal, openTerminal, close, editorOnFile, treeToggle, onCompact, onReady }: { close?: () => void; workspace: string; open: boolean; request: OpenRequest | null; gitFiles: GitFile[] | null; terminal?: React.ReactNode; terminalOpen?: boolean; toggleTerminal?: () => void; openTerminal?: (cwd?: string) => void; editorOnFile?: boolean; treeToggle?: boolean; onCompact?: (compact: boolean) => void; onReady?: () => void }) {
  const onReadyRef = useRef(onReady); onReadyRef.current = onReady;
  const [children, setChildren] = useState<Record<string, Entry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; paths: string[] } | null>(null);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string[] | null>(null);
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
  }, [workspace]);

  // Watch the folder and load the first level only while the panel is open.
  useEffect(() => {
    if (!open) { onReadyRef.current?.(); return; }
    void window.army.files.watch(true);
    void loadDir("").finally(() => onReadyRef.current?.());
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
    const media = await window.army.files.media?.(rel).catch(() => null);
    const file = media ? {} as any : await window.army.files.read(rel).catch(e => ({ error: String(e) } as any));
    let tab: Tab;
    if (media) tab = { path: rel, model: null, dirty: false, diff: false, saved: "", media };
    else if (file.text === undefined) {
      const note = file.binary ? "Binary file, not shown." : file.tooLarge ? `File is too large to open here (${Math.round((file.size || 0) / 1048576)} MB).` : "Could not open this file.";
      tab = { path: rel, model: null, dirty: false, diff: false, note, saved: "" };
    } else {
      const model = monaco.editor.getModel(uriFor(rel)) || monaco.editor.createModel(file.text, undefined, uriFor(rel));
      tab = { path: rel, model, dirty: false, diff: !!opts.diff, saved: file.text };
      model.onDidChangeContent(() => setTabs(ts => ts.map(t => t.path === rel ? { ...t, dirty: model.getValue() !== t.saved } : t)));
      const lang = langOf(rel);
      if (lang) {
        registerServer(model.getLanguageId()); let version = 1, timer = 0;
        // Without the server say why there are no suggestions instead of staying silent.
        void window.army.files.lsp.open(lang, rel, model.getValue()).then(() => { if (model.isDisposed()) return; serving.add(rel); if (lang === "typescript") tsToServer(); if (version === 1 && model.getValue() !== file.text) void flush(true); })
          .catch(e => { const why = String(e).replace(/^Error: Error invoking remote method '[^']+': (Error: )?/, ""); if (/are off for this project|Replaced/.test(why)) return; setTabs(ts => ts.map(t => t.path === rel ? { ...t, note: lang === "typescript" ? undefined : `${LANG_NAME[lang]} suggestions are off: ${why}` } : t)); });
        const flush = async (now = false) => { if (!timer && !now) return; window.clearTimeout(timer); timer = 0; await window.army.files.lsp.change(lang, rel, ++version, model.getValue()).catch(() => {}); };
        unsent.set(rel, flush);
        model.onDidChangeContent(() => { window.clearTimeout(timer); timer = window.setTimeout(() => void flush(), 200); });
        model.onWillDispose(() => { window.clearTimeout(timer); timer = 0; unsent.delete(rel); serving.delete(rel); void window.army.files.lsp.close(lang, rel).catch(() => {}); });
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

  const closeTabs = async (paths: string[], force = false) => {
    const list = tabsRef.current.filter(t => paths.includes(t.path));
    if (!list.length) return;
    if (!force) {
      const dirty = list.filter(t => t.dirty);
      if (dirty.length) {
        const title = dirty.length === 1 ? `Discard unsaved changes in ${base(dirty[0].path)}?` : `Discard unsaved changes in ${dirty.length} files?`;
        if (!(await dialogs.confirm(title, { description: "Your edits will be lost.", action: "Discard", danger: true }))) return;
      }
    }
    const closing = new Set(list.map(t => t.path));
    const cur = tabsRef.current;
    const activeIdx = activeRef.current ? cur.findIndex(t => t.path === activeRef.current) : -1;
    const rest = cur.filter(t => !closing.has(t.path));
    if (activeRef.current && closing.has(activeRef.current)) {
      const next = cur.slice(activeIdx + 1).find(t => !closing.has(t.path)) || rest[rest.length - 1];
      setActive(next?.path || null);
      void showTab(next);
    }
    for (const tab of list) {
      if (diffEditor.current && tab.model && diffEditor.current.getModel()?.modified === tab.model) diffEditor.current.setModel(null);
      tab.model?.dispose();
      originals.current.get(tab.path)?.dispose();
      originals.current.delete(tab.path);
      views.current.delete(tab.path);
    }
    setTabs(rest);
  };

  const closeTab = (rel: string, force = false) => { void closeTabs([rel], force); };

  const tabMenuItems = (path: string): MenuItem[] => {
    const cur = tabsRef.current;
    const idx = cur.findIndex(t => t.path === path);
    const right = idx >= 0 ? cur.slice(idx + 1).map(t => t.path) : [];
    const others = cur.filter(t => t.path !== path).map(t => t.path);
    const saved = cur.filter(t => !t.dirty).map(t => t.path);
    const all = cur.map(t => t.path);
    return [
      { label: "Close", action: () => void closeTabs([path]) },
      { label: "Close Others", action: () => void closeTabs(others) },
      { label: "Close to the Right", action: () => void closeTabs(right) },
      "sep",
      { label: "Close Saved", action: () => void closeTabs(saved, true) },
      { label: "Close All", action: () => void closeTabs(all) },
    ];
  };

  // Requests from outside (Changed files in the side panel).
  useEffect(() => { if (request) void openFile(request.path, { diff: request.diff, line: request.line }); }, [request?.nonce]);

  // Disk changes: refresh the tree, reload clean tabs silently. A dirty tab keeps the user's text; saving overwrites.
  useEffect(() => window.army.on("files-changed", async (batch: { path: string; kind: string }[]) => {
    const dirs = new Set<string>();
    for (const c of batch) if (c.kind !== "change") dirs.add(parent(c.path));
    for (const d of dirs) if (children[d] || d === "") void loadDir(d);
    for (const c of batch) {
      const tab = tabsRef.current.find(t => t.path === c.path);
      // An image or video an agent wrote again: show the new one.
      if (tab?.media) {
        const media = c.kind === "unlink" ? null : await window.army.files.media?.(c.path).catch(() => null);
        setTabs(ts => ts.map(t => t.path === c.path ? media ? { ...t, media, note: undefined } : { ...t, note: "Deleted on disk." } : t)); continue;
      }
      if (!tab?.model || tab.dirty) continue;
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

  const visible = (rel = ""): string[] => (children[rel] || []).flatMap(e => e.dir && expanded.has(e.path) ? [e.path, ...visible(e.path)] : [e.path]);
  const isDirPath = (p: string) => Object.values(children).some(l => l.some(e => e.path === p && e.dir));
  const doDelete = async (paths: string[]) => {
    setConfirmDel(null);
    const failed = await window.army.files.act("trash", paths).catch(() => paths);
    const done = paths.filter(p => !failed.includes(p));
    for (const t of tabs) if (done.some(p => t.path === p || t.path.startsWith(p + "/"))) closeTab(t.path, true);
    for (const d of new Set(done.map(parent))) void loadDir(d);
    setPicked(new Set());
  };
  const menuItems = (paths: string[]): MenuItem[] => {
    const one = paths.length === 1; const file = one && !isDirPath(paths[0]);
    const act = (a: "reveal" | "open" | "copy-path" | "copy-rel" | "copy-name") => () => void window.army.files.act(a, paths);
    const termCwd = one ? (isDirPath(paths[0]) ? paths[0] : parent(paths[0]) || ".") : ".";
    return [
      ...(file ? [{ label: "Open", action: () => void openFile(paths[0]) }, "sep" as const] : []),
      ...(one ? [{ label: MAC ? "Reveal in Finder" : "Reveal in File Explorer", hint: MAC ? "\u2325\u2318R" : "Shift+Alt+R", action: act("reveal") }] : []),
      { label: "Open with default app", action: act("open") },
      ...(one && openTerminal ? [{ label: "Open terminal here", action: () => openTerminal(termCwd) }] : []),
      "sep" as const,
      { label: one ? "Copy path" : "Copy paths", hint: MAC ? "\u2325\u2318C" : "Shift+Alt+C", action: act("copy-path") },
      { label: one ? "Copy relative path" : "Copy relative paths", action: act("copy-rel") },
      { label: one ? "Copy name" : "Copy names", action: act("copy-name") },
      "sep" as const,
      { label: one ? "Delete" : `Delete ${paths.length} items`, hint: MAC ? "\u2318\u232B" : "Del", action: () => setConfirmDel(paths) },
    ];
  };

  const renderDir = (rel: string, depth: number): React.ReactNode => (children[rel] || []).map(e => {
    const st = gitStatus.get(e.dir ? e.path + "/" : e.path);
    const isOpen = e.dir && expanded.has(e.path);
    return <React.Fragment key={e.path}>
      <button type="button" data-dir={e.dir ? e.path : e.path.includes("/") ? e.path.slice(0, e.path.lastIndexOf("/")) : ""} className={"ide-row" + (e.dir && dropDir === e.path ? " drop" : "") + (picked.has(e.path) ? " picked" : "") + (active === e.path && !picked.size ? " selected" : "") + (e.ignored ? " ignored" : "") + (st ? " git-" + st : "")} style={{ paddingLeft: 8 + depth * 12 }}
        onClick={ev => {
          if (ev.shiftKey && anchor.current) { const o = visible(); const a = o.indexOf(anchor.current), b = o.indexOf(e.path); if (a >= 0 && b >= 0) { setPicked(new Set(o.slice(Math.min(a, b), Math.max(a, b) + 1))); return; } }
          if (ev.ctrlKey || ev.metaKey) { anchor.current = e.path; setPicked(p => { const n = new Set(p.size ? p : active ? [active] : []); if (n.has(e.path)) n.delete(e.path); else n.add(e.path); return n; }); return; }
          anchor.current = e.path; setPicked(new Set([e.path]));
          if (e.dir) toggleDir(e.path); else void openFile(e.path);
        }} title={e.path}
        // Drag a row onto the message box to put "@path" into the message.
        draggable onDragStart={ev => { const p = e.dir ? e.path + "/" : e.path; ev.dataTransfer.setData("application/x-dispatch-path", p); ev.dataTransfer.setData("text/plain", "@" + p); ev.dataTransfer.effectAllowed = "copyLink"; }}
        onContextMenu={ev => {
          ev.preventDefault(); ev.stopPropagation();
          const paths = picked.has(e.path) ? [...picked] : [e.path];
          if (!picked.has(e.path)) { setPicked(new Set([e.path])); anchor.current = e.path; }
          setMenu({ x: ev.clientX, y: ev.clientY, paths });
        }}>
        {e.dir ? <ChevronRightIcon className={"ide-chev" + (isOpen ? " open" : "")} aria-hidden="true" /> : <span className="ide-chev-space" />}
        <FileIcon name={e.name} dir={e.dir} open={isOpen} className="ide-ico" />
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
  // C and C++: where the include folders and flags come from, like the picker in VS Code's status bar.
  const [cSource, setCSource] = useState<{ rel: string; value: string; using: string; options: { id: string; label: string }[] } | null>(null);
  const [lspNote, setLspNote] = useState<Record<string, string>>({});
  const cRel = activeTab?.model && langOf(activeTab.path) === "cpp" ? activeTab.path : "";
  useEffect(() => { let on = true; setCSource(null); if (cRel) void window.army.files.lsp.cOptions?.(cRel).then(o => { if (on) setCSource({ rel: cRel, ...o }); }).catch(() => {}); return () => { on = false; }; }, [cRel, workspace]);
  useEffect(() => window.army.on("lsp-status", (s: { lang: string; text: string }) => setLspNote(n => ({ ...n, [s.lang]: s.text }))), []);
  const chooseC = async (value: string) => {
    if (!cSource) return; const rel = cSource.rel; setCSource({ ...cSource, value });
    const tell = (note?: string) => setTabs(ts => ts.map(t => t.path === rel ? { ...t, note } : t));
    tell();
    try { await window.army.files.lsp.cChoose(rel, value); serving.add(rel); } catch (e) { tell("C and C++ suggestions are off: " + String(e).replace(/^Error: Error invoking remote method '[^']+': (Error: )?/, "")); }
    const o = await window.army.files.lsp.cOptions?.(rel).catch(() => null); if (o) setCSource(c => c?.rel === rel ? { rel, ...o } : c);
  };
  const busyNote = activeTab?.model ? lspNote[langOf(activeTab.path)] : "";
  const rootName = workspace.split(/[\\/]/).pop() || workspace;
  const compact = !!editorOnFile && tabs.length === 0 && !terminalOpen;
  const [mediaDims, setMediaDims] = useState<Record<string, string>>({});
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
        {compact && close && <button type="button" className="icon-button ide-toggle on" aria-pressed="true" aria-label="Hide files" title="Hide files (Ctrl E)" onClick={close}><CodeBracketIcon aria-hidden="true" /></button>}
      </div>
      {side === "files" ? <div className={"ide-tree" + (dropDir === "" ? " drop" : "")} role="tree" tabIndex={0} aria-label={rootName} data-dir="" onKeyDown={ev => { if (!picked.size) return; if (MAC ? (ev.metaKey && ev.key === "Backspace") : (ev.key === "Delete")) { ev.preventDefault(); setConfirmDel([...picked]); } else if (ev.key === "Escape") setPicked(new Set()); }} onDragOver={onTreeDragOver} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropDir(null); }} onDrop={e => void onTreeDrop(e)}>
        <div className="ide-root" title={workspace}>{rootName}</div>
        {menu && <TreeMenu x={menu.x} y={menu.y} items={menuItems(menu.paths)} onClose={() => setMenu(null)} />}
        {confirmDel && <DeleteDialog paths={confirmDel} onConfirm={() => void doDelete(confirmDel)} onCancel={() => setConfirmDel(null)} />}
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
          onMouseDown={e => { if (e.button === 1) { e.preventDefault(); closeTab(t.path); } }}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setTabMenu({ x: e.clientX, y: e.clientY, path: t.path }); }}
          onClick={() => { setActive(t.path); void showTab(t); }}>
          <span>{base(t.path)}</span>
          {t.dirty ? <span className="ide-dirty" aria-label="Unsaved" /> : null}
          <button type="button" className="ide-tab-x" aria-label={`Close ${base(t.path)}`} onClick={e => { e.stopPropagation(); closeTab(t.path); }}><XMarkIcon /></button>
        </div>)}
        {tabs.length > 0 && tabMenu && <TreeMenu x={tabMenu.x} y={tabMenu.y} items={tabMenuItems(tabMenu.path)} onClose={() => setTabMenu(null)} />}
        <span className="grow" />
        {closeButton}
        {toggleTerminal && <button type="button" className={"icon-button" + (terminalOpen ? " on" : "")} aria-pressed={!!terminalOpen} title="Terminal (Ctrl `)" aria-label="Toggle terminal" onClick={toggleTerminal}><CommandLineIcon /></button>}
        {activeTab?.model && <button type="button" className={"icon-button" + (activeTab.diff ? " on" : "")} aria-pressed={activeTab.diff} title={activeTab.diff ? "Back to editor" : "Compare with last commit"} aria-label="Toggle diff" onClick={() => void openFile(activeTab.path, { diff: !activeTab.diff })}><ArrowsRightLeftIcon /></button>}
      </div>
      {activeTab && <div className="ide-path"><span>{activeTab.path.split("/").join(" / ")}</span>{activeTab.media && <span>{[mediaDims[activeTab.media.url], sizeText(activeTab.media.size)].filter(Boolean).join(" · ")}</span>}{activeTab.diff && <span className="tag">HEAD ↔ working tree</span>}{(busyNote || activeTab.note) && <span className="ide-note" title={busyNote || activeTab.note}>{busyNote || activeTab.note}</span>}{cSource && <><span className="grow" /><select className="ide-source" aria-label="Project settings for C and C++" title="Where include folders and compiler flags come from" value={cSource.value} onChange={e => void chooseC(e.target.value)}>{cSource.options.map(o => <option key={o.id} value={o.id}>{o.id === "auto" && cSource.using !== "auto" ? `Automatic: ${(cSource.options.find(x => x.id === cSource.using)?.label || cSource.using)}` : o.label}</option>)}</select></>}</div>}
      <div className="ide-editor" ref={host}>
        {activeTab?.media && <MediaView key={activeTab.media.url} media={activeTab.media} name={base(activeTab.path)} onDims={d => setMediaDims(m => ({ ...m, [activeTab.media!.url]: d }))} />}
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
