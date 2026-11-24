import { useEffect, useRef, useState } from "react";
import { Button } from "../components/common";
import { openMic } from "./dictation";
import { MicLevel } from "./MicLevel";

const LANGS: [string, string][] = [["tr", "Turkish"], ["en", "English"], ["auto", "Detect automatically"]];
type Mic = { id: string; label: string };
// A pressed key as Electron names it. null: a lone modifier, still waiting for the key.
const NAMED: Record<string, string> = { Space: "Space", Tab: "Tab", CapsLock: "Capslock", NumLock: "Numlock", ScrollLock: "Scrolllock", Backspace: "Backspace", Delete: "Delete", Insert: "Insert", Enter: "Return", NumpadEnter: "Return", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", PrintScreen: "PrintScreen", NumpadDecimal: "numdec", NumpadAdd: "numadd", NumpadSubtract: "numsub", NumpadMultiply: "nummult", NumpadDivide: "numdiv", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", IntlBackslash: "\\", Backquote: "`", MediaPlayPause: "MediaPlayPause", MediaTrackNext: "MediaNextTrack", MediaTrackPrevious: "MediaPreviousTrack", MediaStop: "MediaStop" };
export function accelerator(e: { code: string; key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string | null {
  if (["Control", "Alt", "AltGraph", "Shift", "Meta"].includes(e.key)) return null;
  // A letter by what it types (a Turkish or French layout moves them), digits and the rest by their place.
  const key = /^[a-z]$/i.test(e.key) ? e.key.toUpperCase() : /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : /^Numpad\d$/.test(e.code) ? "num" + e.code.slice(6) : /^F\d{1,2}$/.test(e.code) ? e.code : NAMED[e.code];
  if (!key) return "";
  return [e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super", key].filter(Boolean).join("+");
}
const pretty = (k: string) => k.replace("Control", "Ctrl").replace("Super", "Win").replace("Return", "Enter").replace(/\bnum(\d)/, "Num $1").split("+").join(" + ");

/** Settings > Voice: microphone, spoken language and the global shortcut. */
export function VoiceSettings({ openTools }: { openTools: () => void }) {
  const [s, setS] = useState<Awaited<ReturnType<typeof window.army.voice.status>> | null>(null);
  const [mics, setMics] = useState<Mic[]>([]);
  const [named, setNamed] = useState(true);
  const [test, setTest] = useState<{ analyser: AnalyserNode; stop: () => void } | null>(null);
  const testRef = useRef(test); testRef.current = test;
  const load = () => window.army.voice.status().then(setS).catch(() => {});
  const listMics = async () => {
    const all = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications");
    setNamed(all.every(d => d.label));
    setMics(all.map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` })));
  };
  useEffect(() => {
    void load(); void listMics();
    navigator.mediaDevices.addEventListener("devicechange", listMics);
    return () => { navigator.mediaDevices.removeEventListener("devicechange", listMics); testRef.current?.stop(); };
  }, []);
  const set = async (patch: Record<string, string>) => { await window.army.ui.set(patch); setTimeout(load, 150); };
  // Device names stay hidden until the mic has been allowed once.
  const allow = async () => { try { const st = await openMic(); st.getTracks().forEach(t => t.stop()); } catch {} void listMics(); };
  const startTest = async (id: string) => {
    test?.stop();
    try {
      const stream = await openMic(id); const ctx = new AudioContext(); const analyser = ctx.createAnalyser();
      analyser.fftSize = 256; analyser.minDecibels = -85; analyser.maxDecibels = -25; analyser.smoothingTimeConstant = 0.35;
      ctx.createMediaStreamSource(stream).connect(analyser);
      void listMics();
      setTest({ analyser, stop: () => { stream.getTracks().forEach(t => t.stop()); void ctx.close(); setTest(null); } });
    } catch { setTest(null); }
  };
  const chooseMic = (id: string) => { void set({ voiceMic: id }); if (test) void startTest(id); };
  // Press any key or combination; while listening the old shortcut is off, so pressing it is not taken as "record".
  const [listening, setListening] = useState(false);
  const [badKey, setBadKey] = useState(false);
  useEffect(() => {
    if (!listening) return;
    void window.army.voice.capture(true);
    const down = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") { setListening(false); return; }
      const k = accelerator(e); if (k === null) return;
      if (!k) { setBadKey(true); return; }
      setBadKey(false); setListening(false); void set({ voiceShortcut: k });
    };
    const stop = () => setListening(false);
    window.addEventListener("keydown", down, true); window.addEventListener("blur", stop);
    return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("blur", stop); void window.army.voice.capture(false).then(() => setTimeout(load, 200)); };
  }, [listening]);
  const plain = !!s && /^(?:[A-Z0-9]|Space|Tab|Backspace|Delete|Return|Up|Down|Left|Right|[-=[\];',.\/\\`])$/.test(s.shortcut);
  const current = s?.mic && mics.some(m => m.id === s.mic) ? s.mic : "";

  return <section className="settings-group">
    <h2 className="label">Voice</h2>
    {s && !s.installed && <div className="setting-row"><div><b>Voice typing is not installed</b><p>It runs on this computer. Install it once under Tools.</p></div><Button className="secondary" onClick={openTools}>Open Tools</Button></div>}
    <div className="setting-row"><div><b>Microphone</b><p>{s?.mic && !current && mics.length ? "The microphone you chose is not connected; the system default is used." : "Used by the chat mic and the shortcut recorder. Test shows the live level."}</p></div>
      <div className="voice-mic">
        <select aria-label="Microphone" value={current} onChange={e => chooseMic(e.target.value)}>
          <option value="">System default</option>
          {mics.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        {!named && <Button className="ghost" onClick={() => void allow()}>Show names</Button>}
        <Button
          className={"secondary voice-test" + (test ? " on" : "")}
          aria-label={test ? "Stop microphone test" : undefined}
          onClick={() => (test ? test.stop() : void startTest(current))}
        >
          {test ? "Stop test" : "Test"}
        </Button>
      </div></div>
    {test && <MicLevel analyser={test.analyser} />}
    <div className="setting-row"><div><b>Spoken language</b><p>Fixing the language is faster and more accurate than detecting it.</p></div>
      <select aria-label="Spoken language" style={{ width: 200 }} value={s?.lang || "tr"} onChange={e => void set({ voiceLang: e.target.value })}>{LANGS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
    <div className="setting-row"><div><b>Shortcut</b><p>{badKey ? "That key cannot be a shortcut. Try another one." : listening ? "Press the key or combination you want. Esc cancels." : s && !s.shortcutOk ? `Another app already uses ${pretty(s.shortcut)}. Pick a different key.` : plain ? "Works everywhere, also when Dispatch is not in front. In other apps this key no longer types its own character." : "Works everywhere. In Dispatch it turns the chat mic on and off; from any other app it opens a small recorder, press it again and the text lands in the chat box."}</p></div>
      <div className="voice-mic">
        <button type="button" className={"button secondary voice-key" + (listening ? " on" : "")} aria-label="Voice shortcut" aria-pressed={listening} onClick={() => { setBadKey(false); setListening(v => !v); }}>{listening ? "Press a key" : pretty(s?.shortcut || "Control+Alt+Space")}</button>
        {s && s.shortcut !== "Control+Alt+Space" && !listening && <Button className="ghost" onClick={() => void set({ voiceShortcut: "Control+Alt+Space" })}>Reset</Button>}
      </div></div>
  </section>;
}
