import React, { useEffect, useState } from "react";
import { EDITABLE, THEMES, loadTheme, saveTheme, token, type EditKey, type ThemeState } from "./theme";
import { Button } from "../components/common";

// Settings > Appearance: pick a theme and override its accent, background, surface and text colors.
function toHex(value: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const m = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (m) return "#" + m[1] + m[1] + m[2] + m[2] + m[3] + m[3];
  const r = value.match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i);
  if (r) return "#" + [r[1], r[2], r[3]].map(n => Number(n).toString(16).padStart(2, "0")).join("");
  return "#000000";
}
const VAR_OF: Record<EditKey, string> = { accent: "--primary", background: "--bg", surface: "--surface", text: "--text" };

export function ThemeSettings() {
  const [state, setState] = useState<ThemeState>(loadTheme);
  const [, bump] = useState(0);
  useEffect(() => { const h = () => bump(n => n + 1); window.addEventListener("dispatch-theme", h); return () => window.removeEventListener("dispatch-theme", h); }, []);
  const update = (next: ThemeState) => { setState(next); saveTheme(next); };
  const own = state.colors[state.theme] || {};
  const setColor = (key: EditKey, value: string) => update({ ...state, colors: { ...state.colors, [state.theme]: { ...own, [key]: value } } });
  const reset = () => { const colors = { ...state.colors }; delete colors[state.theme]; update({ ...state, colors }); };
  return <>
    <div className="setting-row"><div><b>Theme</b><p>Frosted Glass blurs what is behind the window. It uses the native window material where the system has one and a CSS blur elsewhere.</p></div>
      <select aria-label="Theme" value={state.theme} onChange={e => update({ ...state, theme: e.target.value as ThemeState["theme"] })}>{THEMES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
    <div className="setting-row"><div><b>Colors</b><p>Changes apply to the selected theme only.</p></div>
      <div className="theme-colors">
        {EDITABLE.map(e => <label key={e.key} className="theme-color"><span>{e.label}</span>
          <input type="color" aria-label={e.label + " color"} value={toHex(own[e.key] || token(VAR_OF[e.key]))} onChange={ev => setColor(e.key, ev.target.value)} /></label>)}
        <Button className="secondary" onClick={reset} disabled={!Object.keys(own).length}>Reset</Button>
      </div></div>
  </>;
}
