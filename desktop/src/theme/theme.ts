// Theme state: which theme is active and the user's color overrides. Colors themselves live in tokens.css.
// Persisted in ~/.dispatch/ui.json (main process reads it for the window material) and mirrored in
// localStorage so the very first paint already has the right colors.
export type ThemeId = "dark" | "light" | "frosted";
export const THEMES: { id: ThemeId; label: string }[] = [
  { id: "dark", label: "Graphite (dark)" },
  { id: "light", label: "Light" },
  { id: "frosted", label: "Frosted Glass" },
];
/** The four user-editable tokens. The rest of the palette derives from the theme. */
export const EDITABLE = [
  { key: "accent", label: "Accent", vars: ["--primary", "--primary-hover", "--voice-bar", "--term-cursor", "--loader-bar"] },
  { key: "background", label: "Background", vars: ["--bg"] },
  { key: "surface", label: "Surface", vars: ["--surface"] },
  { key: "text", label: "Text", vars: ["--text"] },
] as const;
export type EditKey = (typeof EDITABLE)[number]["key"];
export type ThemeState = { theme: ThemeId; colors: Partial<Record<ThemeId, Partial<Record<EditKey, string>>>> };

const KEY = "dispatch-theme";
const HEX = /^#[0-9a-fA-F]{6}$/;

export function loadTheme(): ThemeState {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && THEMES.some(t => t.id === v.theme)) return { theme: v.theme, colors: v.colors && typeof v.colors === "object" ? v.colors : {} };
  } catch {}
  return { theme: "dark", colors: {} };
}

export function applyTheme(state: ThemeState) {
  const root = document.documentElement;
  root.dataset.theme = state.theme;
  const own = state.colors[state.theme] || {};
  for (const e of EDITABLE) {
    const c = own[e.key];
    for (const v of e.vars) {
      if (c && HEX.test(c)) root.style.setProperty(v, c); else root.style.removeProperty(v);
    }
  }
  // Hover shade of a custom accent: same color; the primary button already changes on :hover through opacity-free tokens.
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  window.dispatchEvent(new Event("dispatch-theme"));
}

/** Current computed value of a token, for canvas and terminal code that cannot use CSS variables. */
export const token = (name: string, fallback = "") => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** Persist to the main process (window material follows the theme) and re-apply everywhere. */
export function saveTheme(state: ThemeState) {
  applyTheme(state);
  void (window as any).army?.ui?.set({ theme: state.theme, themeColors: state.colors }).catch?.(() => {});
}

/** Pull the saved state from ui.json once at start (covers a cleared localStorage). */
export async function syncThemeFromMain() {
  try {
    const u = await (window as any).army?.ui?.get();
    setMaterial(!!u?.material);
    if (u?.theme && THEMES.some(t => t.id === u.theme)) applyTheme({ theme: u.theme, colors: u.themeColors || {} });
    (window as any).army?.on?.("material", (on: boolean) => setMaterial(!!on));
  } catch {}
}

/** Colors for canvas and WebGL scenes, read from the tokens at call time so a theme change is picked up. */
export const agentColors = () => [0, 1, 2, 3, 4, 5, 6, 7].map(i => token("--agent-" + i));
export const sceneColor = (name: string) => token("--" + name);

/** The main process tells whether the window has a native blur behind it (acrylic / vibrancy). */
function setMaterial(on: boolean) { if (on) document.documentElement.dataset.material = "1"; else delete document.documentElement.dataset.material; }
