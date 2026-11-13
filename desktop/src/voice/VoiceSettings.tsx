import { useEffect, useRef, useState } from "react";
import { Button } from "../components/common";
import { openMic } from "./dictation";
import { Visualizer } from "./Visualizer";

const LANGS: [string, string][] = [["tr", "Turkish"], ["en", "English"], ["auto", "Detect automatically"]];
type Mic = { id: string; label: string };

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
        {test ? <button type="button" className="button secondary voice-test on" aria-label="Stop microphone test" onClick={() => test.stop()}><Visualizer analyser={test.analyser} width={60} height={18} /></button>
          : <Button className="secondary voice-test" onClick={() => void startTest(current)}>Test</Button>}
      </div></div>
    <div className="setting-row"><div><b>Spoken language</b><p>Fixing the language is faster and more accurate than detecting it.</p></div>
      <select aria-label="Spoken language" style={{ width: 200 }} value={s?.lang || "tr"} onChange={e => void set({ voiceLang: e.target.value })}>{LANGS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
    <div className="setting-row"><div><b>Shortcut</b><p>{s && !s.shortcutOk ? "Another app already uses this shortcut. Pick a different one." : "In Dispatch it turns the chat mic on and off. From any other app it opens a small recorder; press it again and the text is sent to the selected agent."}</p></div>
      <select aria-label="Voice shortcut" style={{ width: 200 }} value={s?.shortcut || "Control+Alt+Space"} onChange={e => void set({ voiceShortcut: e.target.value })}>{(s?.shortcuts || ["Control+Alt+Space"]).map(k => <option key={k} value={k}>{k.replace(/Control/g, "Ctrl").replace(/\+/g, " ")}</option>)}</select></div>
  </section>;
}
