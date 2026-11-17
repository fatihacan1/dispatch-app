// Monaco, bundled locally (no CDN). Loaded only when the IDE panel opens.
import * as monaco from "monaco-editor";
// Package exports map "monaco-editor/x" to esm/vs/x.js.
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";

(self as any).MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new CssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
    if (label === "typescript" || label === "javascript") return new TsWorker();
    return new EditorWorker();
  },
};

const ts = monaco.typescript;
for (const d of [ts.typescriptDefaults, ts.javascriptDefaults]) {
  // Type errors on, minus what only a full project could answer: unresolved imports and their types (2307, 2792,
  // 7016), JSX without React types (7026, 2875) and missing globals from @types packages (2580, 2591, 2304 kept).
  d.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, diagnosticCodesToIgnore: [2307, 2792, 7016, 7026, 2875, 2580, 2591, 2503] });
  d.setCompilerOptions({ jsx: ts.JsxEmit.Preserve, allowJs: true, target: ts.ScriptTarget.ESNext, allowNonTsExtensions: true });
}

// .env files: .env, .env.local, .env.production, frontend.env, *.env
monaco.languages.register({ id: "dotenv", extensions: [".env"], filenames: [".env"], filenamePatterns: [".env.*", "*.env"], aliases: ["Env", "dotenv"] });
monaco.languages.setLanguageConfiguration("dotenv", { comments: { lineComment: "#" }, brackets: [["${", "}"]], autoClosingPairs: [{ open: '"', close: '"' }, { open: "'", close: "'" }, { open: "${", close: "}" }] });
monaco.languages.setMonarchTokensProvider("dotenv", {
  tokenizer: {
    root: [
      [/^\s*#.*$/, "comment"],
      [/^(\s*export\s+)?([A-Za-z_][\w.\-]*)(\s*)(=)/, ["keyword", "variable.name", "", { token: "delimiter", next: "@value" }]],
    ],
    value: [
      [/\s+#.*$/, { token: "comment", next: "@pop" }],
      [/\$\{[^}]*\}|\$[A-Za-z_]\w*/, "variable"],
      [/"/, { token: "string", next: "@dq" }],
      [/'[^']*'/, "string"],
      [/$/, { token: "", next: "@pop" }],
      [/[^\s$"']+/, "string.value"],
      [/\s+/, ""],
    ],
    dq: [
      [/\$\{[^}]*\}|\$[A-Za-z_]\w*/, "variable"],
      [/\./, "string.escape"],
      [/[^"\$]+/, "string"],
      [/\$/, "string"],
      [/"/, { token: "string", next: "@pop" }],
    ],
  },
});

const h2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
/** Monaco only takes #rrggbb / #rrggbbaa. Themes (Frosted Glass) use rgba(), so normalize any CSS color to hex. */
export function toHex(value: string, fallback = "#000000"): string {
  const s = value.trim();
  let m = /^#([0-9a-f]{3,4})$/i.exec(s);
  if (m) return "#" + [...m[1]].map(c => c + c).join("").toLowerCase();
  if (/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s.toLowerCase();
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
    return "#" + h2(+m[1]) + h2(+m[2]) + h2(+m[3]) + (a < 1 ? h2(a * 255) : "");
  }
  return fallback;
}

/** Theme built from tokens.css so the editor matches the app. */
export function applyTheme() {
  try { defineDispatchTheme(); monaco.editor.setTheme("dispatch"); }
  // A color Monaco cannot read must never take the app down: fall back to the stock dark theme.
  catch (e) { console.error("Editor theme failed", e); monaco.editor.setTheme("vs-dark"); }
}
function defineDispatchTheme() {
  const css = getComputedStyle(document.documentElement);
  // Colors may keep their alpha; token colors (rules) cannot, so `t` drops it and the leading #.
  const v = (name: string) => toHex(css.getPropertyValue(name));
  const t = (name: string) => v(name).slice(1, 7);
  const rgb = (name: string) => v(name).slice(0, 7);
  monaco.editor.defineTheme("dispatch", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: t("--text-3"), fontStyle: "italic" },
      { token: "keyword", foreground: t("--agent-2") },
      { token: "string", foreground: t("--agent-3") },
      { token: "number", foreground: t("--agent-0") },
      { token: "type", foreground: t("--agent-1") },
      { token: "type.identifier", foreground: t("--agent-1") },
      { token: "regexp", foreground: t("--agent-4") },
      { token: "tag", foreground: t("--agent-1") },
      { token: "attribute.name", foreground: t("--agent-5") },
      { token: "variable.name", foreground: t("--agent-1") },
      { token: "variable", foreground: t("--agent-4") },
      { token: "string.value", foreground: t("--agent-3") },
      { token: "string.escape", foreground: t("--agent-0") },
      { token: "delimiter", foreground: t("--text-2") },
    ],
    colors: {
      "editor.background": v("--bg"),
      "editor.foreground": v("--text"),
      "editorLineNumber.foreground": v("--text-3"),
      "editorLineNumber.activeForeground": v("--text-2"),
      "editor.lineHighlightBackground": v("--surface"),
      "editor.lineHighlightBorder": v("--surface"),
      "editor.selectionBackground": v("--selected"),
      "editor.inactiveSelectionBackground": v("--raised"),
      "editorCursor.foreground": v("--term-cursor"),
      "editorIndentGuide.background1": v("--line"),
      "editorIndentGuide.activeBackground1": v("--line-strong"),
      "editorWidget.background": v("--overlay"),
      "editorWidget.border": v("--line-strong"),
      "editorGutter.background": v("--bg"),
      "scrollbarSlider.background": v("--line-strong"),
      "scrollbarSlider.hoverBackground": v("--selected-line"),
      "scrollbarSlider.activeBackground": v("--selected-line"),
      "diffEditor.insertedTextBackground": rgb("--diff-add") + "33",
      "diffEditor.removedTextBackground": rgb("--diff-del") + "33",
      "diffEditor.insertedLineBackground": rgb("--diff-add") + "1a",
      "diffEditor.removedLineBackground": rgb("--diff-del") + "1a",
      "focusBorder": v("--focus"),
      // Suggest list, hovers and other dropdowns in the app's colors instead of Monaco's blue.
      "editorSuggestWidget.background": v("--overlay"),
      "editorSuggestWidget.border": v("--line-strong"),
      "editorSuggestWidget.foreground": v("--text-2"),
      "editorSuggestWidget.selectedBackground": v("--selected"),
      "editorSuggestWidget.selectedForeground": v("--text"),
      "editorSuggestWidget.highlightForeground": v("--text"),
      "editorSuggestWidget.focusHighlightForeground": v("--text"),
      "editorHoverWidget.background": v("--overlay"),
      "editorHoverWidget.border": v("--line-strong"),
      "list.activeSelectionBackground": v("--selected"),
      "list.activeSelectionForeground": v("--text"),
      "list.focusBackground": v("--selected"),
      "list.hoverBackground": v("--hover"),
      "list.highlightForeground": v("--text"),
      "quickInput.background": v("--overlay"),
    },
  });
}

export { monaco };
