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

/** Theme built from tokens.css so the editor matches the app. */
export function applyTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  monaco.editor.defineTheme("dispatch", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: v("--text-3").slice(1), fontStyle: "italic" },
      { token: "keyword", foreground: v("--agent-2").slice(1) },
      { token: "string", foreground: v("--agent-3").slice(1) },
      { token: "number", foreground: v("--agent-0").slice(1) },
      { token: "type", foreground: v("--agent-1").slice(1) },
      { token: "type.identifier", foreground: v("--agent-1").slice(1) },
      { token: "regexp", foreground: v("--agent-4").slice(1) },
      { token: "tag", foreground: v("--agent-1").slice(1) },
      { token: "attribute.name", foreground: v("--agent-5").slice(1) },
      { token: "variable.name", foreground: v("--agent-1").slice(1) },
      { token: "variable", foreground: v("--agent-4").slice(1) },
      { token: "string.value", foreground: v("--agent-3").slice(1) },
      { token: "string.escape", foreground: v("--agent-0").slice(1) },
      { token: "delimiter", foreground: v("--text-2").slice(1) },
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
      "diffEditor.insertedTextBackground": v("--diff-add") + "33",
      "diffEditor.removedTextBackground": v("--diff-del") + "33",
      "diffEditor.insertedLineBackground": v("--diff-add") + "1a",
      "diffEditor.removedLineBackground": v("--diff-del") + "1a",
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
  monaco.editor.setTheme("dispatch");
}

export { monaco };
