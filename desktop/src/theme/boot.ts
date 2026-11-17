// Keeps the #boot loader (index.html) visible until the main process and renderer are ready, with a safety timeout so it never hangs.
let hidden = false;
let guardTimer: number | null = null;

export function setBootStatus(text: string) {
  if (hidden) return;
  const sub = document.querySelector<HTMLElement>("#boot .boot-sub");
  if (sub && text) sub.textContent = text;
}

export function startBootGuard(timeoutMs = 20000) {
  if (hidden || guardTimer !== null) return;
  guardTimer = window.setTimeout(() => hideBoot(), timeoutMs);
}

export function hideBoot() {
  if (hidden) return;
  hidden = true;
  if (guardTimer !== null) { window.clearTimeout(guardTimer); guardTimer = null; }
  const el = document.getElementById("boot");
  if (!el) return;
  const done = () => { el.classList.add("done"); window.setTimeout(() => el.remove(), 400); };
  requestAnimationFrame(() => requestAnimationFrame(done));
}

/** Run heavy, non-visible work (Monaco, three.js scenes, terminals) after the first paint and when the thread is idle. */
export function afterFirstPaint(fn: () => void, timeout = 1500): () => void {
  let off = false;
  const run = () => { if (off) return; const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, o: { timeout: number }) => void); if (ric) ric(fn, { timeout }); else window.setTimeout(fn, 50); };
  requestAnimationFrame(() => requestAnimationFrame(run));
  return () => { off = true; };
}
