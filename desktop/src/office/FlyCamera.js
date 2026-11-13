// @ts-nocheck
// Unity Scene View style free camera for a three.js PerspectiveCamera.
//   RMB held: mouse look, WASD move, Q/E down/up, Shift x3, wheel changes fly speed
//   Wheel: dolly. MMB drag: pan. Alt+LMB drag: orbit around a pivot in front of the camera. Alt+RMB drag: zoom.
//   F: frame the focus target (boss, then each agent). Home: back to the default view.
// Everything is damped with exp(-k*dt), so it behaves the same at any frame rate.
import * as THREE from 'three';

const MAX_DISTANCE = 400;
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

export function createFlyCamera(camera, dom, { position, target, getFocus } = {}) {
  const home = { position: position.clone(), target: target.clone() };
  const pos = new THREE.Vector3(), posT = new THREE.Vector3();
  let yaw = 0, pitch = 0, yawT = 0, pitchT = 0;
  let pivotDist = 20, speed = 8;
  let button = -1, alt = false, hover = false, last = { x: 0, y: 0 };
  const keys = new Set();
  let focusIndex = -1;

  function lookFrom(p, t) {
    const d = t.clone().sub(p);
    pivotDist = Math.max(2, d.length());
    yawT = Math.atan2(-d.x, -d.z); pitchT = Math.asin(THREE.MathUtils.clamp(d.y / d.length(), -1, 1));
    posT.copy(p);
  }
  function setView(p, t, snap) { lookFrom(p, t); if (snap) { pos.copy(posT); yaw = yawT; pitch = pitchT; apply(); } }
  function basis() {
    _e.set(pitchT, yawT, 0, 'YXZ');
    _f.set(0, 0, -1).applyEuler(_e); _r.set(1, 0, 0).applyEuler(_e); _u.set(0, 1, 0);
  }
  function apply() { camera.position.copy(pos); camera.rotation.set(pitch, yaw, 0, 'YXZ'); }
  setView(position, target, true);

  const typing = el => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  const active = () => hover || document.activeElement === dom;

  function onDown(e) {
    dom.focus({ preventScroll: true });
    button = e.button; alt = e.altKey; last = { x: e.clientX, y: e.clientY };
    dom.setPointerCapture?.(e.pointerId);
    if (button === 1) e.preventDefault();
  }
  function onMove(e) {
    if (button < 0) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y; last = { x: e.clientX, y: e.clientY };
    basis();
    if (button === 2 && alt) { // Alt + RMB: zoom
      posT.addScaledVector(_f, (dx - dy) * 0.01 * Math.max(1, pivotDist * 0.35));
      pivotDist = Math.max(1, pivotDist - (dx - dy) * 0.01 * pivotDist * 0.35);
    } else if (button === 2) { // mouse look
      yawT -= dx * 0.004; pitchT = THREE.MathUtils.clamp(pitchT - dy * 0.004, -1.55, 1.55);
    } else if (button === 0 && alt) { // orbit around the pivot in front of the camera
      const pivot = posT.clone().addScaledVector(_f, pivotDist);
      yawT -= dx * 0.005; pitchT = THREE.MathUtils.clamp(pitchT - dy * 0.005, -1.5, 1.5);
      basis(); posT.copy(pivot).addScaledVector(_f, -pivotDist);
    } else if (button === 1) { // pan
      const k = Math.max(0.5, pivotDist) * 0.0016;
      posT.addScaledVector(_r, -dx * k).addScaledVector(_u, dy * k);
    }
    if (posT.length() > MAX_DISTANCE) posT.setLength(MAX_DISTANCE);
  }
  function onUp(e) { if (button >= 0) { button = -1; dom.releasePointerCapture?.(e.pointerId); } }
  function onWheel(e) {
    e.preventDefault();
    if (button === 2) { speed = THREE.MathUtils.clamp(speed * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 0.5, 120); return; }
    basis();
    const step = -Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.008 * Math.max(1, pivotDist * 0.12);
    posT.addScaledVector(_f, step); pivotDist = Math.max(1, pivotDist - step);
    if (posT.length() > MAX_DISTANCE) posT.setLength(MAX_DISTANCE);
  }
  function frame(point, radius = 3) {
    basis();
    const dist = Math.max(5, radius * 3.2);
    pivotDist = dist; posT.copy(point).addScaledVector(_f, -dist);
  }
  function onKey(e) {
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey || typing(e.target)) return;
    if (!active() && button < 0) return;
    if (['w', 'a', 's', 'd', 'q', 'e', 'shift'].includes(k)) { keys.add(k); }
    else if (k === 'f') { const t = getFocus?.(++focusIndex); if (t) frame(t.point, t.radius); }
    else if (k === 'home') { focusIndex = -1; lookFrom(home.position, home.target); e.preventDefault(); }
  }
  function onKeyUp(e) { keys.delete(e.key.toLowerCase()); }
  const onBlur = () => { keys.clear(); button = -1; };
  const noMenu = e => e.preventDefault();
  const enter = () => { hover = true; }, leave = () => { hover = false; };

  dom.tabIndex = 0; dom.style.outline = 'none';
  dom.addEventListener('pointerdown', onDown); dom.addEventListener('pointermove', onMove);
  dom.addEventListener('pointerup', onUp); dom.addEventListener('pointercancel', onUp);
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('contextmenu', noMenu);
  dom.addEventListener('pointerenter', enter); dom.addEventListener('pointerleave', leave);
  addEventListener('keydown', onKey); addEventListener('keyup', onKeyUp); addEventListener('blur', onBlur);

  return {
    update(dt) {
      if (button === 2 && !alt && keys.size) {
        basis();
        const v = new THREE.Vector3();
        if (keys.has('w')) v.add(_f); if (keys.has('s')) v.sub(_f);
        if (keys.has('d')) v.add(_r); if (keys.has('a')) v.sub(_r);
        if (keys.has('e')) v.add(_u); if (keys.has('q')) v.sub(_u);
        if (v.lengthSq()) { posT.addScaledVector(v.normalize(), speed * (keys.has('shift') ? 3 : 1) * dt); if (posT.length() > MAX_DISTANCE) posT.setLength(MAX_DISTANCE); }
      }
      const k = 1 - Math.exp(-dt * 14);
      pos.lerp(posT, k); yaw += (yawT - yaw) * k; pitch += (pitchT - pitch) * k;
      apply();
    },
    setView, frame, reset() { focusIndex = -1; lookFrom(home.position, home.target); },
    dispose() {
      dom.removeEventListener('pointerdown', onDown); dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerup', onUp); dom.removeEventListener('pointercancel', onUp);
      dom.removeEventListener('wheel', onWheel); dom.removeEventListener('contextmenu', noMenu);
      dom.removeEventListener('pointerenter', enter); dom.removeEventListener('pointerleave', leave);
      removeEventListener('keydown', onKey); removeEventListener('keyup', onKeyUp); removeEventListener('blur', onBlur);
    },
  };
}
