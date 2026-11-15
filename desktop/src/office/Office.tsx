import { useEffect, useRef, useState } from "react";
import type { OfficeScene, SceneOptions } from "./OfficeScene";
import type { Message } from "../lib/types";

type Props = { boss?: string; agents: { name: string; role?: string }[]; messages: Message[]; working: Record<string, boolean> };
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
export function Office({ boss = "boss", agents, messages, working }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<OfficeScene | null>(null);
  const seen = useRef(new Set<string>());
  const latest = useRef({ boss, agents, working });
  latest.current = { boss, agents, working };
  const [kind, setKind] = useState<SceneId | null>(null);
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
    if (!kind || !host.current) return;
    let cancelled = false; let made: OfficeScene | null = null;
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim().replace("#", "");
    SCENES.find(s => s.id === kind)!.load().then(mod => {
      if (cancelled || !host.current) return;
      made = mod.createOfficeScene(host.current, { driven: true, background: parseInt(bg || "0d0e10", 16) });
      scene.current = made;
      const l = latest.current;
      made.setBoss(l.boss, "Boss"); made.setAgents(l.agents.slice(0, 8));
      for (const [name, on] of Object.entries(l.working)) made.setWorking(name, on);
    });
    return () => { cancelled = true; made?.destroy(); if (scene.current === made) scene.current = null; };
  }, [kind]);

  useEffect(() => {
    if (!hint) return;
    const fade = setTimeout(() => setHintFading(true), 9000);
    const hide = setTimeout(() => dismiss(), 10000);
    return () => { clearTimeout(fade); clearTimeout(hide); };
  }, [hint]);
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

  const pick = (id: SceneId) => { if (id === kind) return; setKind(id); ui()?.set({ scene: id }).catch(() => {}); };
  const current = SCENES.find(s => s.id === kind);
  return (
    <div className="office-wrap">
      <div className="office" ref={host} aria-label="Office view" role="img" />
      {/* One quiet pill with the current scene; pointing at it (or tabbing in) slides the other scenes out. */}
      <div className="office-bar" role="group" aria-label="Office scene">
        {SCENES.map(s => <button key={s.id} type="button" className={"office-seg" + (s.id === kind ? " on" : "")} aria-pressed={s.id === kind} title={s.id === kind ? s.hint : undefined} onClick={() => pick(s.id)}>{s.label}</button>)}
      </div>
      {hint && current && (
        <div className={"office-hint" + (hintFading ? " fading" : "")} role="status">
          <span>{current.hint}</span>
          <button type="button" className="office-hint-x" aria-label="Hide controls hint" onClick={dismiss}>Got it</button>
        </div>
      )}
    </div>
  );
}
