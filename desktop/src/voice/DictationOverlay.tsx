import { useEffect, useRef, useState } from "react";
import { Dictation, joinSpoken } from "./dictation";
import { Visualizer } from "./Visualizer";

type State = "idle" | "recording" | "transcribing" | "success" | "error";

/** The small black pill the global shortcut shows when Dispatch is not focused (FoneCue's design). */
export function DictationOverlay() {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");
  const [fading, setFading] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const dictation = useRef<Dictation | null>(null);
  const text = useRef("");
  const stateRef = useRef(state); stateRef.current = state;
  const timers = useRef<number[]>([]);

  const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const close = (done?: string) => { setFading(true); later(300, () => { if (done !== undefined) window.army.voice.overlayDone(done); else window.army.voice.overlayClose(); setState("idle"); setFading(false); }); };

  const start = async () => {
    clearTimers(); dictation.current?.cancel();
    text.current = ""; setFading(false); setMessage(""); setState("recording");
    const mic = await window.army.voice.status().then(s => s.mic).catch(() => "");
    const d = new Dictation({
      // Live: the chat box in Dispatch fills while you speak, like dictating with Dispatch focused.
      partial: t => window.army.voice.overlayLive(text.current + joinSpoken(text.current, t)),
      commit: t => { text.current += joinSpoken(text.current, t); window.army.voice.overlayLive(text.current); },
      error: m => { setMessage(/not installed/i.test(m) ? "Not installed" : "Engine error"); setState("error"); d.cancel(); later(2500, () => close()); },
    }, mic);
    dictation.current = d;
    try {
      await d.start(); setAnalyser(d.analyser);
      // Stops by itself: 2 s of quiet after speaking, or 8 s with nothing said.
      const watch = window.setInterval(() => { if (dictation.current !== d || stateRef.current !== "recording") return window.clearInterval(watch); const q = d.quiet(); if ((q.heard && q.ms > 2000) || (!q.heard && q.ms > 8000)) { window.clearInterval(watch); void finish(); } }, 250);
      timers.current.push(watch);
    }
    catch (e) { const m = String(e); setMessage(/permission|denied|notallowed/i.test(m) ? "Mic permission" : /notfound|device/i.test(m) ? "Mic not found" : "Mic error"); setState("error"); later(2500, () => close()); }
  };
  const finish = async () => {
    // Pressed while nothing records: never stay open as an empty window.
    if (stateRef.current === "idle") { window.army.voice.overlayClose(); return; }
    if (stateRef.current !== "recording") return;
    setState("transcribing");
    await dictation.current?.stop();
    setAnalyser(null);
    const result = text.current.trim();
    if (!result) { setMessage("Nothing heard"); setState("error"); later(1500, () => close()); return; }
    setState("success");
    later(600, () => close(result));
  };
  const cancel = () => { dictation.current?.cancel(); setAnalyser(null); close(); };

  useEffect(() => {
    for (const el of [document.documentElement, document.body]) el.style.background = "transparent";
    const offStart = window.army.on("overlay-start", () => void start());
    const offStop = window.army.on("overlay-stop", () => void finish());
    window.army.voice.overlayReady?.();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); else if ((e.key === "Enter" || e.key === " ") && stateRef.current === "recording") void finish(); };
    window.addEventListener("keydown", key);
    return () => { offStart(); offStop(); window.removeEventListener("keydown", key); clearTimers(); dictation.current?.cancel(); };
  }, []);

  if (state === "idle") return null;
  return <div className={`dictation-capsule state-${state}${fading ? " fade-out" : ""}`} onClick={() => state === "recording" ? void finish() : cancel()} title={state === "recording" ? "Click or press the shortcut again to finish" : "Click to dismiss"}>
    <img className="dictation-logo" src="./logo-dispatch.png" alt="" />
    <div className="dictation-content">
      {state === "recording" && <Visualizer analyser={analyser} width={75} height={20} />}
      {state === "transcribing" && <span className="dictation-wait"><span className="dictation-dots">••••</span>
        <svg className="sun-spinner" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">{[[12, 5, 12, 7], [12, 17, 12, 19], [5, 12, 7, 12], [17, 12, 19, 12], [7.05, 7.05, 8.46, 8.46], [15.54, 15.54, 16.95, 16.95], [7.05, 16.95, 8.46, 15.54], [15.54, 7.05, 16.95, 8.46]].map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />)}</svg></span>}
      {state === "success" && <span className="dictation-status ok"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>Done</span>}
      {state === "error" && <span className="dictation-status err">{message || "Mic error"}</span>}
    </div>
  </div>;
}
