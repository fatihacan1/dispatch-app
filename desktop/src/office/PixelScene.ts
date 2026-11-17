// 2D pixel "Hall" scene on a canvas 2D renderer. Art: Kenney Roguelike Indoors + Roguelike Characters (CC0, see THIRD_PARTY_LICENSES.md).
import type { OfficeScene, SceneOptions } from "./OfficeScene";
import { agentColors, sceneColor } from "../theme/theme";

const TS = 16, STRIDE = 17;
const W = 24, H = 18, WALL = 3;
const ZOOMS = [1, 1.5, 2, 3, 4, 5, 6, 8];
// [column, row] of the front-facing character sprites in the characters sheet
const SPRITES: [number, number][] = [[0, 5], [1, 5], [0, 6], [1, 6], [0, 7], [1, 7], [0, 8], [1, 8], [0, 9], [1, 9], [0, 10], [1, 10]];
const BOSS_SPRITE: [number, number] = [1, 10];
const DESK_X = [2, 7, 12, 17], DESK_Y = [5, 11];
const SPEED = 46; // px per second
const BOSS = { x: 11.5 * TS, y: 15.3 * TS };

type P = { x: number; y: number };
type Leg = { pos: P; out: P[]; gapx: number; aisle: number };
type Walker = {
  name: string; role: string; slot: number; sprite: [number, number]; color: string; home: Leg; pos: P;
  path: P[]; onArrive?: () => void; wait: number; walking: boolean; flip: boolean; queue: (() => void)[]; busy: boolean; seated: boolean; phase: number;
};
type Bubble = { who: Walker; lines: string[]; t: number };

const img = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

export function createOfficeScene(container: HTMLElement, options: SceneOptions = {}): OfficeScene {
  let disposed = false;
  const bgHex = "#" + (options.background ?? 0x0d0e10).toString(16).padStart(6, "0");
  const canvas = document.createElement("canvas"); canvas.tabIndex = 0; canvas.style.cssText = "display:block;width:100%;height:100%;outline:none;cursor:grab;touch-action:none";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  let indoor: HTMLImageElement | undefined, chars: HTMLImageElement | undefined;
  let backdrop: HTMLCanvasElement | undefined;
  Promise.all([img("./scenes/pixel/indoor.png"), img("./scenes/pixel/characters.png")]).then(([a, b]) => { if (disposed) return; indoor = a; chars = b; backdrop = buildBackdrop(a); });

  // ---- camera ----
  let cam = { x: (W * TS) / 2, y: (H * TS) / 2, z: 3 }, camT = { ...cam };
  let cw = 1, ch = 1, dpr = 1;
  const fitZoom = () => { const f = Math.min(cw / (W * TS + 8), ch / (H * TS + 8)); return Math.max(0.5, f); };
  let fitted = false;
  function resize() {
    cw = Math.max(1, container.clientWidth); ch = Math.max(1, container.clientHeight); dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    if (!fitted) { cam.z = camT.z = fitZoom(); fitted = true; }
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();
  const reset = () => { camT = { x: (W * TS) / 2, y: (H * TS) / 2, z: fitZoom() }; };

  // ---- agents ----
  const walkers = new Map<string, Walker>();
  const slots: (Walker | undefined)[] = Array(8).fill(undefined);
  let boss: Walker | undefined;
  let bossName = "boss", bossRole = "Boss";
  const working = new Set<string>();
  const bubbles: Bubble[] = [];
  let focusIdx = -1;

  const deskOf = (slot: number) => ({ tx: DESK_X[slot % 4], ty: DESK_Y[Math.floor(slot / 4)] });
  function seatLeg(slot: number): Leg {
    const { tx, ty } = deskOf(slot);
    const gapx = (tx + 3.5) * TS, outY = (ty - 0.25) * TS;
    return { pos: { x: (tx + 1.5) * TS, y: (ty + 0.45) * TS }, out: [{ x: (tx + 1.5) * TS, y: outY }, { x: gapx, y: outY }], gapx, aisle: (ty + 3.2) * TS };
  }
  function visitLeg(w: Walker): Leg {
    if (w === boss) return { pos: { x: BOSS.x + 1.6 * TS, y: BOSS.y }, out: [], gapx: BOSS.x + 1.6 * TS, aisle: 14.6 * TS };
    const { tx, ty } = deskOf(w.slot); const gapx = (tx + 3.5) * TS;
    return { pos: { x: gapx, y: (ty + 1.6) * TS }, out: [], gapx, aisle: (ty + 3.2) * TS };
  }
  function bossLeg(): Leg { return { pos: { ...BOSS }, out: [{ x: BOSS.x, y: 14.6 * TS }], gapx: BOSS.x, aisle: 14.6 * TS }; }
  /** Path from the current position, out of the seat, along the aisle and into the target leg. */
  function route(from: Leg | undefined, here: P, to: Leg): P[] {
    const pts: P[] = [];
    if (from) pts.push(...from.out, { x: from.gapx, y: from.aisle });
    else pts.push({ x: here.x, y: to.aisle });
    pts.push({ x: to.gapx, y: from ? from.aisle : to.aisle }, { x: to.gapx, y: to.aisle }, ...[...to.out].reverse(), to.pos);
    return pts;
  }

  function make(name: string, role: string, slot: number, sprite: [number, number], color: string, home: Leg): Walker {
    return { name, role, slot, sprite, color, home, pos: { ...home.pos }, path: [], wait: 0, walking: false, flip: false, queue: [], busy: false, seated: true, phase: Math.random() * 6 };
  }
  const runQueue = (w: Walker) => { if (w.busy) return; const n = w.queue.shift(); if (n) { w.busy = true; n(); } };
  const finish = (w: Walker) => { w.busy = false; runQueue(w); };
  function walk(w: Walker, pts: P[], done?: () => void) { w.walking = true; w.seated = false; w.path = pts; w.onArrive = done; }
  const find = (n: string) => n === bossName || n === "boss" ? boss : walkers.get(n);

  const api: OfficeScene = {
    setBoss(name, role) {
      bossName = name; bossRole = role || "Boss";
      if (boss) { boss.name = name; boss.role = bossRole; return; }
      boss = make(name, bossRole, -1, BOSS_SPRITE, sceneColor("boss"), bossLeg()); boss.role = bossRole; boss.seated = false;
    },
    setAgents(list) {
      const names = new Set(list.map(a => a.name));
      for (const [n, w] of walkers) if (!names.has(n)) { walkers.delete(n); slots[w.slot] = undefined; }
      list.slice(0, 8).forEach(item => {
        if (walkers.has(item.name)) return;
        const slot = slots.findIndex(s => !s); if (slot < 0) return;
        const seat = seatLeg(slot);
        const w = make(item.name, item.role || "", slot, SPRITES[slot], agentColors()[slot], seat);
        w.pos = { x: BOSS.x + 1.6 * TS, y: BOSS.y + 0.8 * TS }; w.busy = true; slots[slot] = w; walkers.set(item.name, w);
        walk(w, route({ pos: w.pos, out: [], gapx: w.pos.x, aisle: 14.6 * TS }, w.pos, seat), () => { w.seated = true; w.walking = false; finish(w); });
      });
    },
    visit(from, to, text) {
      const a = find(from), b = find(to);
      if (!a) return;
      const say = (t: string) => bubbles.push({ who: a, lines: wrapText(t), t: 4.2 });
      if (!b || a === b) { say(text); return; }
      a.queue.push(() => {
        const home = a === boss ? bossLeg() : a.home, target = visitLeg(b);
        walk(a, route(home, a.pos, target), () => {
          a.walking = false; a.flip = b === boss ? false : true; say(text); a.wait = 3.6;
          const back = route(target, a.pos, home);
          const go = () => walk(a, back, () => { a.walking = false; a.seated = a !== boss; a.flip = false; finish(a); });
          a.onArrive = go; a.walking = true;
        });
      });
      runQueue(a);
    },
    setWorking(name, on) { if (on) working.add(name); else working.delete(name); },
    destroy() { disposed = true; ro.disconnect(); removeEventListener("keydown", onKey); removeEventListener("keyup", onKeyUp); canvas.remove(); },
  };
  function wrapText(t: string): string[] {
    ctx.font = "500 13px Geist, system-ui, sans-serif";
    const words = t.replace(/\s+/g, " ").trim().split(" "); const lines: string[] = []; let cur = "";
    for (const w of words) { const n = cur ? cur + " " + w : w; if (ctx.measureText(n).width > 210 && cur) { lines.push(cur); cur = w; } else cur = n; }
    lines.push(cur); const out = lines.slice(0, 3); if (lines.length > 3) out[2] = out[2].replace(/.{0,2}$/, "…"); return out;
  }

  // ---- static backdrop ----
  const tile = (g: CanvasRenderingContext2D, im: HTMLImageElement, c: number, r: number, x: number, y: number, flip = false) => {
    if (flip) { g.save(); g.translate(x + TS, y); g.scale(-1, 1); g.drawImage(im, c * STRIDE, r * STRIDE, TS, TS, 0, 0, TS, TS); g.restore(); }
    else g.drawImage(im, c * STRIDE, r * STRIDE, TS, TS, x, y, TS, TS);
  };
  function buildBackdrop(im: HTMLImageElement) {
    const cv = document.createElement("canvas"); cv.width = W * TS; cv.height = H * TS; const g = cv.getContext("2d")!; g.imageSmoothingEnabled = false;
    // floor planks (palette taken from the pack's sample scene)
    for (let y = WALL; y < H; y++) for (let x = 0; x < W; x++) {
      g.fillStyle = (x + y) % 2 ? sceneColor("office-floor-a") : sceneColor("office-floor-b"); g.fillRect(x * TS, y * TS, TS, TS);
      g.fillStyle = sceneColor("office-floor-edge"); g.fillRect(x * TS, y * TS + TS - 1, TS, 1);
    }
    // wall
    g.fillStyle = sceneColor("office-wall"); g.fillRect(0, 0, W * TS, WALL * TS);
    g.fillStyle = sceneColor("office-wall-edge"); g.fillRect(0, WALL * TS - 4, W * TS, 4); g.fillRect(0, 0, W * TS, 3);
    g.fillStyle = sceneColor("office-wall-line"); for (let x = 0; x < W; x += 1) g.fillRect(x * TS + 15, 3, 1, WALL * TS - 7);


    // wall decor
    tile(g, im, 19, 12, 3 * TS, 0.4 * TS); tile(g, im, 19, 13, 3 * TS, 1.4 * TS);
    tile(g, im, 20, 12, 6 * TS, 0.4 * TS); tile(g, im, 21, 12, 7 * TS, 0.4 * TS); tile(g, im, 20, 13, 6 * TS, 1.4 * TS); tile(g, im, 21, 13, 7 * TS, 1.4 * TS);
    tile(g, im, 22, 14, 11 * TS, 0.3 * TS); tile(g, im, 22, 15, 11 * TS, 1.3 * TS);
    tile(g, im, 19, 14, 14 * TS, 0.4 * TS); tile(g, im, 19, 15, 14 * TS, 1.4 * TS);
    tile(g, im, 20, 14, 17 * TS, 0.4 * TS); tile(g, im, 21, 14, 18 * TS, 0.4 * TS); tile(g, im, 20, 15, 17 * TS, 1.4 * TS); tile(g, im, 21, 15, 18 * TS, 1.4 * TS);
    return cv;
  }

  // ---- input ----
  let drag: { x: number; y: number } | null = null, hover = false;
  const keys = new Set<string>();
  canvas.addEventListener("pointerdown", e => { canvas.focus({ preventScroll: true }); drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = "grabbing"; });
  canvas.addEventListener("pointermove", e => { if (!drag) return; camT.x -= (e.clientX - drag.x) / camT.z; camT.y -= (e.clientY - drag.y) / camT.z; cam.x = camT.x; cam.y = camT.y; drag = { x: e.clientX, y: e.clientY }; });
  const up = (e: PointerEvent) => { drag = null; canvas.style.cursor = "grab"; canvas.releasePointerCapture?.(e.pointerId); };
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("pointerenter", () => { hover = true; }); canvas.addEventListener("pointerleave", () => { hover = false; });
  canvas.addEventListener("contextmenu", e => e.preventDefault());
  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect(); const mx = e.clientX - rect.left - cw / 2, my = e.clientY - rect.top - ch / 2;
    const i = ZOOMS.reduce((best, z, k) => Math.abs(z - camT.z) < Math.abs(ZOOMS[best] - camT.z) ? k : best, 0);
    const ni = Math.max(0, Math.min(ZOOMS.length - 1, i + (e.deltaY < 0 ? 1 : -1))); const nz = ZOOMS[ni];
    // keep the world point under the cursor fixed
    camT.x += mx / camT.z - mx / nz; camT.y += my / camT.z - my / nz; camT.z = nz;
  }, { passive: false });
  const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    if (!hover && document.activeElement !== canvas) return;
    const k = e.key.toLowerCase();
    if ("wasd".includes(k) && k.length === 1) keys.add(k);
    else if (k === "shift") keys.add("shift");
    else if (k === "home") { focusIdx = -1; reset(); e.preventDefault(); }
    else if (k === "f") {
      const list = [boss, ...walkers.values()].filter(Boolean) as Walker[]; if (!list.length) return;
      const w = list[++focusIdx % list.length]; camT.x = w.pos.x; camT.y = w.pos.y - 8; camT.z = Math.max(camT.z, 4);
    }
  }
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  addEventListener("keydown", onKey); addEventListener("keyup", onKeyUp);

  // ---- loop ----
  let last = performance.now(), time = 0;
  function frame(now: number) {
    if (disposed) return; requestAnimationFrame(frame);
    // Hidden (another page, or the office folded away): no work at all until it is shown again.
    if (!container.offsetParent) { last = now; return; }
    const dt = Math.min((now - last) / 1000, 0.05); last = now; time += dt;
    if (keys.size) { const s = (keys.has("shift") ? 3 : 1) * 160 / camT.z * dt; if (keys.has("a")) camT.x -= s; if (keys.has("d")) camT.x += s; if (keys.has("w")) camT.y -= s; if (keys.has("s")) camT.y += s; }
    const k = 1 - Math.exp(-dt * 14);
    cam.x += (camT.x - cam.x) * k; cam.y += (camT.y - cam.y) * k; cam.z += (camT.z - cam.z) * k;
    for (const w of [boss, ...walkers.values()]) if (w) {
      if (!w.walking) continue;
      if (w.wait > 0) { w.wait -= dt; if (w.wait <= 0) { const f = w.onArrive; w.onArrive = undefined; f?.(); } continue; }
      let budget = SPEED * dt;
      while (budget > 0 && w.path.length) {
        const p = w.path[0], dx = p.x - w.pos.x, dy = p.y - w.pos.y, d = Math.hypot(dx, dy);
        if (d < 0.01) { w.path.shift(); continue; }
        if (Math.abs(dx) > 0.5) w.flip = dx < 0;
        const m = Math.min(d, budget); w.pos.x += (dx / d) * m; w.pos.y += (dy / d) * m; budget -= m;
        if (m >= d) w.path.shift();
      }
      if (!w.path.length) { const f = w.onArrive; w.onArrive = undefined; if (w.wait > 0) continue; f?.(); }
    }
    for (let i = bubbles.length - 1; i >= 0; i--) { bubbles[i].t -= dt; if (bubbles[i].t <= 0) bubbles.splice(i, 1); }
    draw();
  }
  requestAnimationFrame(frame);

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = bgHex; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!indoor || !chars || !backdrop) return;
    const z = cam.z * dpr; const ox = Math.round(canvas.width / 2 - cam.x * z), oy = Math.round(canvas.height / 2 - cam.y * z);
    ctx.setTransform(z, 0, 0, z, ox, oy); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(backdrop, 0, 0);
    type Item = { y: number; draw: () => void };
    const items: Item[] = [];
    // static furniture
    const add = (y: number, draw: () => void) => items.push({ y, draw });
    const used = new Set(slots.map((s, i) => s ? i : -1));
    for (let slot = 0; slot < 8; slot++) {
      const { tx, ty } = deskOf(slot);
      add(ty - 1, () => tile(ctx, indoor!, 0, 2, (tx + 1) * TS, (ty - 1.15) * TS)); // chair
      add(ty + 2, () => {
        for (let c = 0; c < 3; c++) { tile(ctx, indoor!, c, 0, (tx + c) * TS, ty * TS); tile(ctx, indoor!, c, 1, (tx + c) * TS, (ty + 1) * TS); }
        const w = slots[slot]; if (w && working.has(w.name)) tile(ctx, indoor!, 16, 6, (tx + 2) * TS - 4, (ty - 0.55) * TS);
        else if (used.has(slot)) tile(ctx, indoor!, 17, 3, (tx + 0.1) * TS, (ty - 0.3) * TS);
      });
    }
    // reception counter, bookshelves, plants, sofa
    for (let c = 0; c < 5; c++) add(16.9, () => tile(ctx, indoor!, [0, 1, 2, 1, 0][c], 14, (9 + c) * TS, 16 * TS));
    for (let c = 0; c < 4; c++) add(WALL, () => tile(ctx, indoor!, 5 + c, 15, (19 + c) * TS, 2 * TS));
    add(WALL + 1, () => { tile(ctx, indoor!, 23, 8, 12 * TS + 0, 2 * TS); tile(ctx, indoor!, 24, 8, 13 * TS, 2 * TS); tile(ctx, indoor!, 23, 9, 12 * TS, 3 * TS); tile(ctx, indoor!, 24, 9, 13 * TS, 3 * TS); });
    for (const [x, y] of [[1, 3], [22, 17], [0, 17], [11, 8.8]] as [number, number][]) add(y + 1, () => tile(ctx, indoor!, 16, 0, x * TS, y * TS));
    add(16.5, () => { tile(ctx, indoor!, 3, 0, 3 * TS, 15 * TS); tile(ctx, indoor!, 4, 0, 4 * TS, 15 * TS); tile(ctx, indoor!, 3, 1, 3 * TS, 16 * TS); tile(ctx, indoor!, 4, 1, 4 * TS, 16 * TS); });
    add(16.2, () => tile(ctx, indoor!, 2, 2, 2 * TS, 15.2 * TS)); add(16.2, () => tile(ctx, indoor!, 3, 2, 5 * TS, 15.2 * TS));
    // people
    const people = [boss, ...walkers.values()].filter(Boolean) as Walker[];
    for (const w of people) add(w.pos.y / TS, () => {
      const [c, r] = w.sprite; const bob = w.walking && w.wait <= 0 ? Math.abs(Math.sin(time * 9 + w.phase)) * -1.5 : w.seated ? 0 : Math.sin(time * 2 + w.phase) * -0.4;
      const x = Math.round(w.pos.x - TS / 2), y = Math.round(w.pos.y - TS + bob);
      ctx.fillStyle = sceneColor("office-shadow"); ctx.fillRect(x + 3, Math.round(w.pos.y) - 1, 10, 2);
      if (w.flip) { ctx.save(); ctx.translate(x + TS, y); ctx.scale(-1, 1); ctx.drawImage(chars!, c * STRIDE, r * STRIDE, TS, TS, 0, 0, TS, TS); ctx.restore(); }
      else ctx.drawImage(chars!, c * STRIDE, r * STRIDE, TS, TS, x, y, TS, TS);
    });
    items.sort((a, b) => a.y - b.y).forEach(i => i.draw());
    // screen-space overlays: name tags and bubbles
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const toScreen = (p: P) => ({ x: (p.x - cam.x) * cam.z + cw / 2, y: (p.y - cam.y) * cam.z + ch / 2 });
    for (const w of people) {
      const s = toScreen({ x: w.pos.x, y: w.pos.y - TS - 1 });
      const nameW = (ctx.font = "600 12px Geist, system-ui, sans-serif", ctx.measureText(w.name).width);
      const bw = nameW + 24, bh = 20, bx = Math.round(s.x - bw / 2), by = Math.round(s.y - bh - 4);
      ctx.fillStyle = sceneColor("surface"); ctx.strokeStyle = sceneColor("line-strong"); ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = w.color; ctx.beginPath(); ctx.arc(bx + 10, by + bh / 2, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = sceneColor("text"); ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText(w.name, bx + 19, by + bh / 2 + 0.5);
    }
    for (const b of bubbles) {
      const s = toScreen({ x: b.who.pos.x, y: b.who.pos.y - TS - 1 });
      ctx.font = "500 13px Geist, system-ui, sans-serif";
      const tw = Math.max(...b.lines.map(l => ctx.measureText(l).width)), bw = tw + 20, bh = b.lines.length * 17 + 12;
      const bx = Math.round(s.x - bw / 2), by = Math.round(s.y - 30 - bh);
      ctx.globalAlpha = Math.min(1, b.t / 0.4);
      ctx.fillStyle = sceneColor("text"); ctx.strokeStyle = sceneColor("line-strong"); ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 8); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.x - 6, by + bh - 0.5); ctx.lineTo(s.x, by + bh + 7); ctx.lineTo(s.x + 6, by + bh - 0.5); ctx.fill();
      ctx.fillStyle = sceneColor("surface"); ctx.textAlign = "left"; ctx.textBaseline = "middle";
      b.lines.forEach((l, i) => ctx.fillText(l, bx + 10, by + 6 + 8.5 + i * 17));
      ctx.globalAlpha = 1;
    }
  }
  return api;
}
