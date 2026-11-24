import { useEffect, useRef, useState } from "react";
import type { OfficeScene, SceneOptions } from "./OfficeScene";
import type { Message } from "../lib/types";

type Props = { boss?: string; agents: { name: string; role?: string }[]; messages: Message[]; working: Record<string, boolean>; onReady?: () => void; /** The chat page is in front. */ active?: boolean; /** Opened by a click just now: load the scene at once. */ load?: boolean };
type Factory = (container: HTMLElement, options?: SceneOptions) => OfficeScene;

const FLY_HINT = "RMB + WASD to fly · Q/E down/up · wheel dolly · MMB pan · Alt + drag orbit · F focus · Home reset";
const SCENES = [
  { id: "office", label: "Office", hint: FLY_HINT, load: (): Promise<{ createOfficeScene: Factory }> => import("./OfficeScene") },
  { id: "studio", label: "Studio", hint: FLY_HINT, load: (): Promise<{ createOfficeScene: Factory }> => import("./StudioScene") },
  { id: "pixel", label: "Pixel", hint: "Drag to pan · wheel zoom · WASD pan · F focus · Home reset", load: (): Promise<{ createOfficeScene: Factory }> => import("./PixelScene") },
  { id: "music", label: "Music", hint: "Plays what Windows is playing: Spotify, YouTube, YouTube Music. The bars follow your system sound.", load: (): Promise<{ createOfficeScene: Factory }> => import("./MusicScene") },
] as const;
type SceneId = (typeof SCENES)[number]["id"];

const ui = () => (window as any).army?.ui as { get(): Promise<{ scene?: string; hintSeen?: boolean }>; set(p: object): Promise<unknown> } | undefined;

/** Office view above the chat: boss at reception, other agents at desks; messages make the sender walk to the recipient. The scene is chosen by the user. */
export function Office({ boss = "boss", agents, messages, working, onReady, active = true, load = false }: Props) {
  const onReadyRef = useRef(onReady); onReadyRef.current = onReady;
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<OfficeScene | null>(null);
  const seen = useRef(new Set<string>());
  const latest = useRef({ boss, agents, working });
  latest.current = { boss, agents, working };
  const [kind, setKind] = useState<SceneId | null>(null);
  // A 3D or pixel scene runs only after a click, and is taken down when the user goes elsewhere: another page, another
  // project, or the window out of focus for a while. The music scene is light and comes by itself.
  const [clicked, setClicked] = useState(load);
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => { const see = () => setVisible(!document.hidden); document.addEventListener("visibilitychange", see); return () => document.removeEventListener("visibilitychange", see); }, []);
  useEffect(() => { if (!active || !visible) setClicked(false); }, [active, visible]);
  useEffect(() => {
    let timer = 0;
    const blur = () => { clearTimeout(timer); timer = window.setTimeout(() => { if (!document.hasFocus()) setClicked(false); }, 30000); };
    const focus = () => clearTimeout(timer);
    window.addEventListener("blur", blur); window.addEventListener("focus", focus);
    return () => { clearTimeout(timer); window.removeEventListener("blur", blur); window.removeEventListener("focus", focus); };
  }, []);
  const running = !!kind && active && visible && (kind === "music" || clicked);
  const [hint, setHint] = useState(false);
  const [hintFading, setHintFading] = useState(false);

  useEffect(() => {
    messages.forEach(m => seen.current.add(m.id));
    let live = true;
    const api = ui();
    if (!api) { setKind("office"); return; }
    api.get().then(s => { if (!live) return; setKind(SCENES.some(x => x.id === s?.scene) ? (s.scene as SceneId) : "office"); if (!s?.hintSeen) setHint(true); }).catch(() => live && setKind("office"));
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!kind) return;
    if (!running || !host.current) { onReadyRef.current?.(); return; }
    let cancelled = false; let made: OfficeScene | null = null;
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim().replace("#", "");
    SCENES.find(s => s.id === kind)!.load().then(mod => {
      if (cancelled || !host.current) return;
      made = mod.createOfficeScene(host.current, { driven: true, background: parseInt(bg || "0d0e10", 16) });
      scene.current = made;
      const l = latest.current;
      made.setBoss(l.boss, "Boss"); made.setAgents(l.agents.slice(0, 8));
      for (const [name, on] of Object.entries(l.working)) made.setWorking(name, on);
      onReadyRef.current?.();
    }).catch(() => onReadyRef.current?.());
    return () => { cancelled = true; made?.destroy(); if (scene.current === made) scene.current = null; };
  }, [kind, running]);

  useEffect(() => {
    if (!hint || !running) return;
    const fade = setTimeout(() => setHintFading(true), 9000);
    const hide = setTimeout(() => dismiss(), 10000);
    return () => { clearTimeout(fade); clearTimeout(hide); };
  }, [hint, running]);
  const dismiss = () => { setHint(false); setHintFading(false); ui()?.set({ hintSeen: true }).catch(() => {}); };

  const key = agents.map(a => a.name).join("|");
  useEffect(() => { scene.current?.setAgents(agents.slice(0, 8)); }, [key, kind]);
  useEffect(() => { scene.current?.setBoss(boss, "Boss"); }, [boss]);
  useEffect(() => {
    for (const m of messages) {
      if (seen.current.has(m.id) || m.id.startsWith("pending-")) continue;
      seen.current.add(m.id);
      if (m.from !== "you" && m.to !== "you" && m.from !== "dispatch") scene.current?.visit(m.from, m.to, m.text);
    }
  }, [messages]);
  useEffect(() => { for (const [name, on] of Object.entries(working)) scene.current?.setWorking(name, on); }, [working]);

  const pick = (id: SceneId) => { setClicked(true); if (id === kind) return; setKind(id); ui()?.set({ scene: id }).catch(() => {}); };
  const current = SCENES.find(s => s.id === kind);
  return (
    <div className="office-wrap">
      <div className="office" ref={host} aria-label="Office view" role="img" />
      {kind && kind !== "music" && !running && <button type="button" className="office-load" onClick={() => setClicked(true)}><span>{current?.label}</span><small>Click to load the scene</small></button>}
      {/* One quiet pill with the current scene; pointing at it (or tabbing in) slides the other scenes out. */}
      <div className="office-bar" role="group" aria-label="Office scene">
        {SCENES.map(s => <button key={s.id} type="button" className={"office-seg" + (s.id === kind ? " on" : "")} aria-pressed={s.id === kind} title={s.id === kind ? s.hint : undefined} onClick={() => pick(s.id)}>{s.label}</button>)}
      </div>
      {hint && running && current && (
        <div className={"office-hint" + (hintFading ? " fading" : "")} role="status">
          <span>{current.hint}</span>
          <button type="button" className="office-hint-x" aria-label="Hide controls hint" onClick={dismiss}>Got it</button>
        </div>
      )}
    </div>
  );
}
