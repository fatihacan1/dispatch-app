// Music scene: a now-playing screen (cover, title, artist, progress, controls) for whatever Windows is playing,
// with a visualizer fed by the system sound. Same contract as the other scenes; agents are not shown here.
import type { OfficeScene, SceneOptions } from "./OfficeScene";

type Track = { none?: boolean; unsupported?: boolean; error?: string; app?: string; title?: string; artist?: string; album?: string; status?: string; position?: number; duration?: number; updated?: number; cover?: string; track?: boolean; canNext?: boolean; canPrev?: boolean };

const army = () => (window as any).army;
const ICON = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9.5 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l10.5-7z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15L19.5 12z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5h4.5v15H6zM13.5 4.5H18v15h-4.5z"/></svg>',
};
const APPS: [RegExp, string][] = [[/spotify/i, "Spotify"], [/msedge/i, "Edge"], [/chrome/i, "Chrome"], [/firefox/i, "Firefox"], [/opera/i, "Opera"], [/brave/i, "Brave"], [/zune|music/i, "Media Player"]];
const appName = (id = "") => APPS.find(([re]) => re.test(id))?.[1] || id.split(/[\\/!.]/).filter(Boolean).pop() || "";
const clock = (s: number) => { if (!Number.isFinite(s) || s < 0) s = 0; const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`; };
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => { const e = document.createElement(tag); e.className = cls; parent?.appendChild(e); return e; };

/** Average colour of the cover, lifted so bars stay visible on the dark backdrop. */
function tint(img: HTMLImageElement): [number, number, number] {
  try {
    const c = document.createElement("canvas"); c.width = c.height = 16; const g = c.getContext("2d")!; g.drawImage(img, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data; let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { const lum = d[i] + d[i + 1] + d[i + 2]; if (lum < 60 || lum > 720) continue; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
    if (!n) return [140, 180, 255];
    const k = 200 / Math.max(r / n, gg / n, b / n, 1); return [Math.min(255, (r / n) * k), Math.min(255, (gg / n) * k), Math.min(255, (b / n) * k)];
  } catch { return [140, 180, 255]; }
}

export function createOfficeScene(container: HTMLElement, _options?: SceneOptions): OfficeScene {
  const root = el("div", "music-scene", container);
  const backdrop = el("div", "music-backdrop", root);
  const main = el("div", "music-main", root);
  const art = el("div", "music-art", main);
  const cover = el("img", "", art); cover.alt = ""; cover.hidden = true;
  // Shown while there is no cover: a record instead of the browser's broken-image icon.
  art.insertAdjacentHTML("beforeend", '<svg class="music-art-empty" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="38" fill="var(--raised)"/><circle cx="50" cy="50" r="30" fill="none" stroke="var(--line)"/><circle cx="50" cy="50" r="22" fill="none" stroke="var(--line)"/><circle cx="50" cy="50" r="11" fill="var(--selected)"/><circle cx="50" cy="50" r="2.5" fill="var(--bg)"/></svg>');
  cover.onerror = () => { cover.hidden = true; cover.removeAttribute("src"); };
  const info = el("div", "music-info", main);
  const source = el("p", "music-source", info);
  const title = el("p", "music-title", info);
  const artist = el("p", "music-artist", info);
  const bar = el("div", "music-progress", info); const fill = el("i", "", bar);
  const times = el("div", "music-times", info); const at = el("span", "", times); const total = el("span", "", times);
  const controls = el("div", "music-controls", info);
  const btn = (name: keyof typeof ICON, label: string, cmd: string) => { const b = el("button", "music-btn", controls); b.type = "button"; b.innerHTML = ICON[name]; b.setAttribute("aria-label", label); b.title = label; b.onclick = () => void army()?.media?.control(cmd); return b; };
  const prev = btn("prev", "Previous", "prev"); const play = btn("play", "Play", "toggle"); play.classList.add("main"); const next = btn("next", "Next", "next");
  const canvas = el("canvas", "music-viz", root); canvas.setAttribute("aria-hidden", "true");

  let track: Track = {}, color: [number, number, number] = [140, 180, 255], raf = 0, alive = true;
  let analyser: AnalyserNode | null = null, audio: AudioContext | null = null, stream: MediaStream | null = null;

  const position = () => {
    if (!track.duration) return 0;
    const base = track.position || 0;
    const moved = track.status === "Playing" && track.updated ? (Date.now() - track.updated) / 1000 : 0;
    return Math.min(track.duration, base + Math.max(0, moved));
  };
  const render = () => {
    const empty = !track.title;
    root.classList.toggle("idle", empty);
    source.textContent = track.unsupported ? "Now playing works on Windows" : empty ? "Nothing playing" : `Playing on ${appName(track.app)}`;
    title.textContent = empty ? "Play something in Spotify, YouTube or YouTube Music" : track.title!;
    artist.textContent = empty ? "It shows up here by itself, with the cover and controls." : [track.artist, track.album].filter(Boolean).join(" · ");
    const playing = track.status === "Playing";
    play.innerHTML = playing ? ICON.pause : ICON.play; play.setAttribute("aria-label", playing ? "Pause" : "Play"); play.title = playing ? "Pause" : "Play";
    prev.disabled = empty || track.canPrev === false; next.disabled = empty || track.canNext === false; play.disabled = empty;
    bar.hidden = times.hidden = empty || !track.duration;
  };
  const setCover = (src?: string) => {
    if (!src) { cover.hidden = true; cover.removeAttribute("src"); backdrop.style.backgroundImage = ""; color = [140, 180, 255]; return; }
    cover.onload = () => { cover.hidden = false; color = tint(cover); };
    cover.src = src; backdrop.style.backgroundImage = `url("${src}")`;
  };

  const off = army()?.on?.("media:update", (u: Track) => {
    if (u.error) return;
    const changed = u.track || (u.title !== track.title);
    track = { ...u, cover: undefined };
    if (u.cover) setCover(u.cover); else if (changed && !u.title) setCover();
    render();
  });
  void army()?.media?.watch(true);
  render();

  // System sound for the visualizer. If capture is not allowed, the bars idle softly instead.
  (async () => {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (!alive) { s.getTracks().forEach(t => t.stop()); return; }
      s.getVideoTracks().forEach(t => t.stop());
      if (!s.getAudioTracks().length) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s; audio = new AudioContext(); analyser = audio.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.8;
      audio.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(analyser);
    } catch { /* idle bars */ }
  })();

  const BARS = 64; const levels = new Float32Array(BARS); const data = new Uint8Array(128);
  const frame = (t: number) => {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const g = canvas.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const playing = track.status === "Playing";
    if (analyser) analyser.getByteFrequencyData(data);
    for (let i = 0; i < BARS; i++) {
      let v: number;
      if (analyser) { const idx = Math.floor(Math.pow(i / BARS, 1.6) * 100) + 1; v = data[idx] / 255; }
      else v = playing ? 0.18 + 0.14 * Math.sin(t / 420 + i * 0.45) * Math.sin(t / 900 + i * 0.13) + 0.1 * Math.sin(t / 260 + i) : 0.04;
      levels[i] += (Math.max(0.02, v) - levels[i]) * 0.25;
    }
    const gap = 3, bw = Math.max(2, (w - gap * (BARS - 1)) / BARS), [r, gg, b] = color;
    for (let i = 0; i < BARS; i++) {
      if (levels[i] < 0.035) continue; // silent bands draw nothing (a row of stubs reads as a dashed line)
      const bh = levels[i] * h * 0.95, x = i * (bw + gap);
      const grad = g.createLinearGradient(0, h, 0, h - bh); grad.addColorStop(0, `rgba(${r},${gg},${b},0.9)`); grad.addColorStop(1, `rgba(${r},${gg},${b},0.25)`);
      g.fillStyle = grad; g.beginPath(); g.roundRect(x, h - bh, bw, bh, Math.min(3, bw / 2)); g.fill();
    }
    if (track.duration) { const p = position(); fill.style.width = `${(p / track.duration) * 100}%`; at.textContent = clock(p); total.textContent = clock(track.duration); }
  };
  raf = requestAnimationFrame(frame);

  return {
    setBoss() {}, setAgents() {}, visit() {},
    setWorking() {},
    destroy() {
      alive = false; cancelAnimationFrame(raf); off?.(); void army()?.media?.watch(false);
      stream?.getTracks().forEach(t => t.stop()); void audio?.close().catch(() => {}); root.remove();
    },
  };
}
