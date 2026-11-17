// Keeps the #boot loader (index.html) visible until the main process and renderer are ready, with a safety timeout so it never hangs.
let hidden = false;
let guardTimer: number | null = null;
let bootLastLongTaskAt = 0;
let bootPo: PerformanceObserver | null = null;

export type ReadyInfo = { ok?: boolean; indexStarted?: boolean; mainQuietMs?: number };

export function setBootStatus(text: string) {
  if (hidden) return;
  const sub = document.querySelector<HTMLElement>("#boot .boot-sub");
  if (sub && text) sub.textContent = text;
}

export function startBootGuard(timeoutMs = 20000) {
  if (hidden || guardTimer !== null) return;
  if (!bootPo && typeof PerformanceObserver !== "undefined") {
    try {
      bootPo = new PerformanceObserver(list => {
        for (const e of list.getEntries()) if (e.duration > 50) bootLastLongTaskAt = Math.max(bootLastLongTaskAt, e.startTime + e.duration);
      });
      bootPo.observe({ entryTypes: ["longtask"] });
    } catch {}
  }
  guardTimer = window.setTimeout(() => hideBoot(), timeoutMs);
}

export function hideBoot() {
  if (hidden) return;
  hidden = true;
  if (guardTimer !== null) { window.clearTimeout(guardTimer); guardTimer = null; }
  if (bootPo) { try { bootPo.disconnect(); } catch {} bootPo = null; }
  const el = document.getElementById("boot");
  if (!el) return;
  const done = () => { el.classList.add("done"); window.setTimeout(() => el.remove(), 400); };
  requestAnimationFrame(() => requestAnimationFrame(done));
}

/**
 * Waits until main-process startup work is done/deferred AND both main and renderer have been quiet
 * (no renderer long task > 50 ms, main event-loop lag < 50 ms, IPC round-trip < 50 ms) for ~1 s continuously.
 */
export function waitForResponsive(opts: {
  ready?: () => Promise<ReadyInfo>;
  onStatus?: (text: string) => void;
  quietMs?: number;
  maxLagMs?: number;
  pollMs?: number;
  timeoutMs?: number;
}): { promise: Promise<boolean>; cancel: () => void } {
  const quietMs = opts.quietMs ?? 1000;
  const maxLagMs = opts.maxLagMs ?? 50;
  const pollMs = opts.pollMs ?? 150;
  const timeoutMs = opts.timeoutMs ?? 20000;

  let done = false;
  let pollTimer: number | null = null;
  let guard: number | null = null;
  let driftTimer: number | null = null;
  let po: PerformanceObserver | null = null;
  let resolveFn!: (ok: boolean) => void;

  const cleanup = () => {
    if (pollTimer !== null) { window.clearTimeout(pollTimer); pollTimer = null; }
    if (guard !== null) { window.clearTimeout(guard); guard = null; }
    if (driftTimer !== null) { window.clearInterval(driftTimer); driftTimer = null; }
    if (po) { try { po.disconnect(); } catch {} po = null; }
  };

  const finish = (ok: boolean) => {
    if (done) return;
    done = true;
    cleanup();
    resolveFn(ok);
  };

  const promise = new Promise<boolean>(resolve => {
    resolveFn = resolve;
    if (!opts.ready) { finish(true); return; }

    let lastRendererBusyAt = bootLastLongTaskAt;
    let lastTick = performance.now();
    let quietSince = lastTick;

    if (typeof PerformanceObserver !== "undefined") {
      try {
        po = new PerformanceObserver(list => {
          for (const e of list.getEntries()) {
            if (e.duration > maxLagMs) lastRendererBusyAt = Math.max(lastRendererBusyAt, e.startTime + e.duration);
          }
        });
        po.observe({ entryTypes: ["longtask"] });
      } catch {}
    }

    driftTimer = window.setInterval(() => {
      const now = performance.now();
      const drift = now - lastTick - 100;
      lastTick = now;
      if (drift >= maxLagMs) lastRendererBusyAt = now;
    }, 100);

    guard = window.setTimeout(() => finish(false), timeoutMs);

    const probe = async () => {
      if (done) return;
      const t0 = performance.now();
      let res: ReadyInfo = {};
      try { res = await opts.ready!(); } catch {}
      if (done) return;
      const now = performance.now();
      const rtt = now - t0;
      const indexOk = res?.indexStarted !== false;
      const mainOk = (res?.mainQuietMs ?? quietMs) >= quietMs;
      const rttOk = rtt < maxLagMs;
      const rendererOk = now - lastRendererBusyAt >= quietMs;

      if (!indexOk) {
        opts.onStatus?.("Starting code index");
        quietSince = now;
      } else if (!rttOk) {
        opts.onStatus?.("Waiting for app to settle");
        quietSince = now;
      } else if (mainOk && rendererOk && now - quietSince >= quietMs) {
        finish(true);
        return;
      } else {
        opts.onStatus?.("Waiting for app to settle");
      }

      pollTimer = window.setTimeout(probe, pollMs);
    };

    void probe();
  });

  return { promise, cancel: () => finish(false) };
}

/** Run heavy, non-visible work (Monaco, three.js scenes, terminals) after the first paint and when the thread is idle. */
export function afterFirstPaint(fn: () => void, timeout = 1500): () => void {
  let off = false;
  const run = () => { if (off) return; const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, o: { timeout: number }) => void); if (ric) ric(fn, { timeout }); else window.setTimeout(fn, 50); };
  requestAnimationFrame(() => requestAnimationFrame(run));
  return () => { off = true; };
}
