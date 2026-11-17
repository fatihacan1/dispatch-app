import React from "react";
import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/700.css";
import "./theme/tokens.css";
import "./style.css";
import { App } from "./views/App";
import { DictationOverlay } from "./voice/DictationOverlay";
import { RemoteGate } from "./views/Remote";
import { startI18n } from "./lib/i18n";
import { applyTheme, loadTheme, syncThemeFromMain } from "./theme/theme";
import { hideBoot } from "./theme/boot";

// The same bundle serves the voice overlay window (#overlay) opened by the global shortcut.
const overlay = window.location.hash === "#overlay";
if (overlay) document.documentElement.classList.add("overlay-window");
startI18n();
applyTheme(loadTheme());
void syncThemeFromMain();
createRoot(document.getElementById("root")!).render(overlay ? <DictationOverlay /> : <RemoteGate><App /></RemoteGate>);

// The loader stays up until the first real paint of the app, then fades out.
if (!overlay) hideBoot();
