// Fades the #boot loader (index.html) out once the app has painted. Two animation frames = the React tree was committed and painted;
// the loader's own animation uses transform/opacity only, so it keeps running on the compositor while the main thread builds the UI.
export function hideBoot() {
  const el = document.getElementById("boot");
  if (!el) return;
  const done = () => { el.classList.add("done"); window.setTimeout(() => el.remove(), 400); };
  requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(done, 120)));
}

/** Run heavy, non-visible work (Monaco, three.js scenes, terminals) after the first paint and when the thread is idle. */
export function afterFirstPaint(fn: () => void, timeout = 1500): () => void {
  let off = false;
  const run = () => { if (off) return; const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, o: { timeout: number }) => void); if (ric) ric(fn, { timeout }); else window.setTimeout(fn, 50); };
  requestAnimationFrame(() => requestAnimationFrame(run));
  return () => { off = true; };
}
