// @ts-nocheck
// 3D "Studio" scene: Kenney Furniture Kit + Kenney Mini Characters (both CC0, see THIRD_PARTY_LICENSES.md).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { createFlyCamera } from "./FlyCamera";
import type { OfficeScene, SceneOptions } from "./OfficeScene";

const BASE = "./scenes/studio/";
const FS = 2.4; // furniture scale (kit models are about one meter)
const CHAR_H = 2.5; // character height in scene units
const CHARS = ["male-a", "female-a", "male-b", "female-b", "male-c", "female-c", "male-d", "female-d"];
const COLORS = ["#e9a46a", "#7fb4ff", "#c79cf2", "#6fd0b0", "#f08fb0", "#d6c66a", "#7fd0e0", "#e5846a"];
const loader = new GLTFLoader();
const cache = new Map<string, Promise<any>>();
const load = (url: string) => { if (!cache.has(url)) cache.set(url, loader.loadAsync(url)); return cache.get(url)!; };

type Agent = {
  name: string; role: string; slot: number; color: string;
  root: THREE.Group; mixer?: THREE.AnimationMixer; actions: Record<string, THREE.AnimationAction>;
  label: THREE.Sprite; lamp: THREE.Mesh;
  state: "sitting" | "walking"; path: THREE.Vector3[]; onArrive?: () => void; wait: number; queue: (() => void)[]; busy: boolean; current?: string;
};

function labelTexture(name: string, role: string, color: string) {
  const W = 512, H = 112, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const x = cv.getContext("2d")!;
  x.font = "600 34px Geist, system-ui, sans-serif"; const nw = x.measureText(name).width;
  x.font = "400 24px Geist, system-ui, sans-serif"; const rw = role ? x.measureText(role).width : 0;
  const w = Math.min(W - 8, Math.max(nw, rw) + 76), h = role ? 100 : 64, l = (W - w) / 2, t = (H - h) / 2;
  x.fillStyle = "#131417"; x.strokeStyle = "#30333a"; x.lineWidth = 2;
  x.beginPath(); x.roundRect(l, t, w, h, 18); x.fill(); x.stroke();
  const cy = t + (role ? 34 : h / 2);
  x.fillStyle = color; x.beginPath(); x.arc(l + 30, cy, 8, 0, Math.PI * 2); x.fill();
  x.textAlign = "left"; x.textBaseline = "middle"; x.fillStyle = "#ebecee"; x.font = "600 34px Geist, system-ui, sans-serif"; x.fillText(name, l + 50, cy + 1, w - 62);
  if (role) { x.fillStyle = "#a3a6ad"; x.font = "400 24px Geist, system-ui, sans-serif"; x.fillText(role, l + 50, t + 72, w - 62); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
function bubbleTexture(text: string) {
  const W = 640, H = 170, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const x = cv.getContext("2d")!;
  x.font = "500 38px Geist, system-ui, sans-serif";
  const words = text.split(/\s+/); const lines: string[] = []; let cur = "";
  for (const w of words) { const t = cur ? cur + " " + w : w; if (x.measureText(t).width > W - 70 && cur) { lines.push(cur); cur = w; } else cur = t; }
  lines.push(cur); const shown = lines.slice(0, 2); if (lines.length > 2) shown[1] = shown[1].replace(/.{0,2}$/, "…");
  x.fillStyle = "#ebecee"; x.strokeStyle = "#30333a"; x.lineWidth = 3;
  x.beginPath(); x.roundRect(8, 8, W - 16, H - 40, 22); x.fill(); x.stroke();
  x.beginPath(); x.moveTo(W / 2 - 16, H - 33); x.lineTo(W / 2, H - 6); x.lineTo(W / 2 + 16, H - 33); x.fill();
  x.fillStyle = "#131417"; x.textAlign = "center"; x.textBaseline = "middle";
  shown.forEach((l, i) => x.fillText(l, W / 2, 8 + (H - 40) / 2 + (i - (shown.length - 1) / 2) * 44));
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

export function createOfficeScene(container: HTMLElement, options: SceneOptions = {}): OfficeScene {
  let disposed = false;
  const bg = options.background ?? 0x0d0e10;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(bg);
  const camera = new THREE.PerspectiveCamera(38, container.clientWidth / Math.max(1, container.clientHeight), 0.1, 500);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b2a8, 1.5));
  const sun = new THREE.DirectionalLight(0xfff4e6, 2.2); sun.position.set(10, 22, 14); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20 }); sun.shadow.bias = -0.0008;
  scene.add(sun);

  const world = new THREE.Group(); scene.add(world);
  const ROOM = { cols: 10, rows: 9 }; // tiles
  const T = FS; const W = ROOM.cols * T, D = ROOM.rows * T;
  const originX = -W / 2, originZ = -D / 2;

  /** Load a kit model, put its bottom center at the origin and scale it. */
  async function model(file: string, folder = "furniture/") {
    const gltf = await load(BASE + folder + file + ".glb");
    const obj = cloneSkinned(gltf.scene) as THREE.Object3D;
    return { obj, gltf };
  }
  async function place(file: string, x: number, z: number, rotY = 0, scale = FS, y = 0, centered = true) {
    const { obj } = await model(file);
    obj.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const box = new THREE.Box3().setFromObject(obj); const c = box.getCenter(new THREE.Vector3());
    const holder = new THREE.Group();
    if (centered) obj.position.set(-c.x, -box.min.y, -c.z);
    holder.add(obj); holder.scale.setScalar(scale); holder.rotation.y = rotY; holder.position.set(x, y, z);
    world.add(holder); return holder;
  }

  // Floor and walls (tiles hang off the corner at 0,0 of each piece)
  const floorTasks: Promise<unknown>[] = [];
  for (let i = 0; i < ROOM.cols; i++) for (let j = 0; j < ROOM.rows; j++)
    floorTasks.push(place("floorFull", originX + i * T + T / 2, originZ + j * T + T / 2, 0, T, 0, false).then(h => { h.position.set(originX + i * T, 0, originZ + (j + 1) * T); h.traverse((o: any) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.set((i + j) % 2 ? 0x8e949e : 0x838993); } }); }));
  const wallTasks: Promise<unknown>[] = [];
  for (let i = 0; i < ROOM.cols; i++) {
    const file = i === 2 || i === 6 ? "wallWindow" : "wall";
    wallTasks.push(place(file, 0, 0, 0, T, 0, false).then(h => { h.position.set(originX + i * T, 0, originZ); }));
  }
  for (let j = 0; j < ROOM.rows; j++)
    wallTasks.push(place(j === 3 ? "wallWindow" : "wall", 0, 0, Math.PI / 2, T, 0, false).then(h => { h.position.set(originX, 0, originZ + (j + 1) * T); }));

  // Desks: two rows of four, seats behind the desks (facing -z toward the monitor)
  type Desk = { x: number; z: number; seat: THREE.Vector3; side: THREE.Vector3 };
  const desks: Desk[] = [];
  const colX = [-7.8, -2.6, 2.6, 7.8], rowZ = [-7.4, -1.6];
  for (const z of rowZ) for (const x of colX) desks.push({ x, z, seat: new THREE.Vector3(x, 0, z + 1.9), side: new THREE.Vector3(x + 1.9, 0, z + 2.3) });
  const lamps: THREE.Mesh[] = [];
  for (const d of desks) {
    (async () => {
      const desk = await place("desk", d.x, d.z, 0, FS * 1.6);
      const top = new THREE.Box3().setFromObject(desk).max.y;
      place("computerScreen", d.x, d.z - 0.15, 0, FS * 1.5, top);
      place("computerKeyboard", d.x, d.z + 0.5, 0, FS * 1.5, top);
    })();
    place("chairDesk", d.x, d.z + 1.9, Math.PI, FS * 1.3);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshBasicMaterial({ color: 0x4cc38a }));
    lamp.position.set(d.x + 1.5, 3.1, d.z - 0.2); lamp.visible = false; world.add(lamp); lamps.push(lamp);
  }
  // Reception (boss) corner, lounge corner and details
  const bossSpot = new THREE.Vector3(-8.4, 0, 8.4);
  place("desk", -8.4, 6.9, Math.PI, FS * 1.6); place("laptop", -8.4, 6.9, Math.PI, FS, 0.88 * FS * 0.62 * 1.3 + 0.1);
  place("coatRack", -11.2, 6.2, 0, FS); place("pottedPlant", -11.2, 9.8, 0, FS * 1.4);
  place("rugRectangle", 7.8, 6.6, 0, FS * 1.7); place("loungeSofa", 7.8, 9.4, Math.PI, FS * 1.5); place("loungeSofaCorner", 10.8, 6.8, -Math.PI / 2, FS * 1.5);
  place("tableCoffee", 7.8, 6.8, 0, FS * 1.4); place("lampRoundFloor", 11.0, 9.8, 0, FS * 1.2); place("pottedPlant", 3.6, 9.8, 0, FS * 1.5);
  for (let i = 0; i < 3; i++) place(i === 1 ? "bookcaseOpen" : "bookcaseClosed", -5 + i * 2.6, originZ + 0.75, 0, FS * 1.4);
  place("kitchenCoffeeMachine", 7, originZ + 0.8, 0, FS * 1.2); place("sideTable", 6.2, originZ + 0.8, 0, FS * 1.2);
  place("televisionModern", 10.6, originZ + 0.8, 0, FS * 1.4); place("trashcan", -11.2, -1.6, 0, FS);

  // Characters
  const agents = new Map<string, Agent>();
  const slots: (Agent | undefined)[] = Array(8).fill(undefined);
  let boss: Agent | undefined; let bossLoading = false; let bossName = "boss", bossRole = "Boss";
  const speech: { sprite: THREE.Sprite; t: number; follow?: Agent }[] = [];

  async function makeChar(file: string, name: string, role: string, color: string): Promise<Agent> {
    const { obj, gltf } = await model("character-" + file, "characters/");
    const holder = new THREE.Group();
    const box = new THREE.Box3().setFromObject(obj); const k = CHAR_H / (box.max.y - box.min.y);
    obj.scale.setScalar(k); obj.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; } });
    holder.add(obj);
    const mixer = new THREE.AnimationMixer(obj); const actions: Record<string, THREE.AnimationAction> = {};
    for (const n of ["idle", "walk", "sit"]) { const clip = THREE.AnimationClip.findByName(gltf.animations, n); if (clip) actions[n] = mixer.clipAction(clip); }
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(name, role, color), depthTest: false, transparent: true, sizeAttenuation: false }));
    label.scale.set(0.2, 0.2 * 112 / 512, 1); label.position.y = CHAR_H + 0.6; label.renderOrder = 10; holder.add(label);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.01), new THREE.MeshBasicMaterial()); lamp.visible = false; holder.add(lamp);
    world.add(holder);
    return { name, role, slot: -1, color, root: holder, mixer, actions, label, lamp, state: "sitting", path: [], wait: 0, queue: [], busy: false };
  }
  function play(a: Agent, n: string) {
    if (a.current === n) return; const next = a.actions[n] || a.actions.idle; const prev = a.current && a.actions[a.current];
    if (!next) return; next.reset().fadeIn(0.2).play(); if (prev && prev !== next) prev.fadeOut(0.2); a.current = n;
  }
  const seatOf = (a: Agent) => desks[a.slot].seat;
  function sit(a: Agent) {
    a.state = "sitting"; a.root.position.copy(seatOf(a)).add(new THREE.Vector3(0, -0.25, -0.15)); a.root.rotation.y = Math.PI; play(a, "sit");
  }
  function walkTo(a: Agent, pts: THREE.Vector3[], done?: () => void) {
    a.state = "walking"; a.path = pts.map(p => p.clone()); a.onArrive = done; play(a, "walk");
    if (a.root.position.y < 0) a.root.position.y = 0;
  }
  function speak(a: Agent, text: string) {
    const t = text.replace(/\s+/g, " ").trim().slice(0, 90);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture(t), depthTest: false, transparent: true, sizeAttenuation: false }));
    sprite.scale.set(0.3, 0.3 * 170 / 640, 1); sprite.renderOrder = 11; world.add(sprite); speech.push({ sprite, t: 4, follow: a });
  }
  function runQueue(a: Agent) { if (a.busy) return; const n = a.queue.shift(); if (n) { a.busy = true; n(); } }
  function done(a: Agent) { a.busy = false; runQueue(a); }

  const spawn = () => bossSpot.clone().add(new THREE.Vector3(1.6, 0, 1.2));
  const byName = (n: string) => n === bossName || n === "boss" ? boss : agents.get(n);

  const api: OfficeScene = {
    setBoss(name, role) {
      bossName = name; bossRole = role || "Boss";
      if (boss) { (boss.label.material as THREE.SpriteMaterial).map = labelTexture(name, bossRole, "#ebe7dc"); boss.name = name; return; }
      if (bossLoading) return; bossLoading = true;
      makeChar("worker", name, bossRole, "#ebe7dc").then(a => {
        if (disposed) return; boss = a; a.root.position.copy(bossSpot); a.root.rotation.y = Math.PI; a.state = "sitting"; play(a, "idle");
        (a.label.material as THREE.SpriteMaterial).map = labelTexture(bossName, bossRole, "#ebe7dc");
      });
    },
    setAgents(list) {
      const names = new Set(list.map(a => a.name));
      for (const [n, a] of agents) if (!names.has(n)) { world.remove(a.root); slots[a.slot] = undefined; agents.delete(n); }
      list.slice(0, 8).forEach(item => {
        if (agents.has(item.name)) return;
        const slot = slots.findIndex(s => !s); if (slot < 0) return;
        const reserved = { name: item.name, slot } as Agent; slots[slot] = reserved;
        makeChar(CHARS[slot], item.name, item.role || "", COLORS[slot]).then(a => {
          if (disposed || slots[slot] !== reserved) { world.remove(a.root); return; }
          a.slot = slot; slots[slot] = a; agents.set(item.name, a);
          a.root.position.copy(spawn()); a.busy = true;
          const seat = seatOf(a);
          walkTo(a, [new THREE.Vector3(seat.x, 0, seat.z + 2.6), seat], () => { sit(a); done(a); });
        });
      });
    },
    visit(from, to, text) {
      const a = byName(from), b = byName(to);
      if (!a) return;
      const target = b ? (b === boss ? bossSpot.clone().add(new THREE.Vector3(1.8, 0, 1.4)) : desks[(b as Agent).slot].side.clone()) : null;
      if (!target || a === b) { speak(a, text); return; }
      a.queue.push(() => {
        const home = a === boss ? bossSpot.clone() : seatOf(a);
        const lane = new THREE.Vector3(a.root.position.x, 0, a.root.position.z + (a === boss ? 0 : 1.6));
        walkTo(a, [lane, new THREE.Vector3(target.x, 0, lane.z), target], () => {
          a.root.rotation.y = Math.atan2((b === boss ? bossSpot.x : desks[(b as Agent).slot].x) - target.x, (b === boss ? bossSpot.z : desks[(b as Agent).slot].z) - target.z);
          play(a, "idle"); speak(a, text); a.wait = 3.2;
          a.onArrive = () => walkTo(a, [new THREE.Vector3(target.x, 0, lane.z), new THREE.Vector3(home.x, 0, lane.z), home], () => { if (a === boss) { a.root.rotation.y = Math.PI; play(a, "idle"); } else sit(a); done(a); });
        });
      });
      runQueue(a);
    },
    setWorking(name, on) { const a = agents.get(name); if (a) lamps[a.slot].visible = on; },
    destroy() {
      disposed = true; ro.disconnect(); fly.dispose(); renderer.dispose();
      scene.traverse((o: any) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x: any) => { x.map?.dispose?.(); x.dispose?.(); }); });
      renderer.domElement.remove();
    },
  };

  const fly = createFlyCamera(camera, renderer.domElement, {
    position: new THREE.Vector3(0, 23, 25), target: new THREE.Vector3(0, 0.5, 1.5),
    getFocus: i => { const list: { point: THREE.Vector3; radius: number }[] = []; if (boss) list.push({ point: boss.root.position.clone().setY(1.2), radius: 1.5 }); agents.forEach(a => list.push({ point: a.root.position.clone().setY(1.2), radius: 1.5 })); return list.length ? list[i % list.length] : undefined; },
  });

  const clock = new THREE.Clock(); const speed = 4.2;
  const all = () => [...(boss ? [boss] : []), ...agents.values()];
  function frame() {
    if (disposed) return; requestAnimationFrame(frame);
    // Hidden (another page, or the office folded away): no work at all until it is shown again.
    if (!container.offsetParent) { clock.getDelta(); return; }
    const dt = Math.min(clock.getDelta(), 0.05);
    fly.update(dt);
    for (const a of all()) {
      a.mixer?.update(dt);
      if (a.state === "walking") {
        if (a.wait > 0) { a.wait -= dt; if (a.wait <= 0) { const f = a.onArrive; a.onArrive = undefined; f?.(); } }
        else if (a.path.length) {
          const p = a.path[0], d = p.clone().sub(a.root.position); d.y = 0; const dist = d.length();
          if (dist < 0.12) { a.path.shift(); if (!a.path.length) { const f = a.onArrive; a.onArrive = undefined; if (a.wait > 0) play(a, "idle"); f?.(); } }
          else { d.normalize(); a.root.position.addScaledVector(d, Math.min(dist, speed * dt)); const want = Math.atan2(d.x, d.z); let diff = want - a.root.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff)); a.root.rotation.y += diff * Math.min(1, dt * 12); }
        }
      }
    }
    for (let i = speech.length - 1; i >= 0; i--) {
      const s = speech[i]; s.t -= dt;
      if (s.follow) s.sprite.position.copy(s.follow.root.position).add(new THREE.Vector3(0, CHAR_H + 1.5, 0));
      if (s.t < 0.5) (s.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, s.t / 0.5);
      if (s.t <= 0) { world.remove(s.sprite); s.sprite.material.map?.dispose(); s.sprite.material.dispose(); speech.splice(i, 1); }
    }
    renderer.render(scene, camera);
  }
  frame();
  const ro = new ResizeObserver(() => {
    if (!container.clientWidth || !container.clientHeight) return;
    camera.aspect = container.clientWidth / container.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(container.clientWidth, container.clientHeight);
  });
  ro.observe(container);
  void floorTasks; void wallTasks;
  return api;
}
