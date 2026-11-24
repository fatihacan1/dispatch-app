import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeftIcon, ChevronRightIcon, XMarkIcon } from "@heroicons/react/16/solid";

export type StripImage = { key: string; name: string; src: string; large?: () => Promise<string | null> };

/**
 * Any number of images in one row. They overlap like pages once they no longer fit; the one under the pointer opens up
 * and grows, its neighbours turn aside. A click shows it in full. Positions are written straight to the elements.
 */
export function ImageStrip({ images, width, height, grow = 1.4, onRemove }: { images: StripImage[]; width: number; height: number; grow?: number; onRemove?: (key: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const now = useRef<{ x: number; g: number; r: number }[]>([]);
  const raf = useRef(0);
  const [open, setOpen] = useState<number | null>(null);
  const gap = 6, n = images.length, natural = n * width + Math.max(0, n - 1) * gap;

  const target = () => {
    const w = box.current?.clientWidth || natural, step = n > 1 ? Math.min(width + gap, (w - width) / (n - 1)) : 0;
    const p = pointer.current, tight = step < width;
    // Closeness to the pointer, 0..1, over the resting places: hovering never moves the ground under the mouse.
    const near = images.map((_, i) => { if (p === null) return 0; const mid = i * step + (i === n - 1 ? width : Math.min(step, width)) / 2, d = Math.abs(p - mid) / Math.max(step, 30); return Math.exp(-d * d / 1.1); });
    const top = Math.max(...near, 0);
    // The hovered page shows its whole width; the rest share what is left.
    const show = near.map((g, i) => i === n - 1 ? 0 : step + (Math.max(step, width + gap) - step) * g);
    const sum = show.reduce((a, b) => a + b, 0), room = w - width;
    const k = sum > room && sum > 0 ? room / sum : 1;
    let x = 0;
    return near.map((g, i) => {
      const mid = i * step + width / 2, side = p === null || !tight ? 0 : Math.max(-1, Math.min(1, (p - mid) / (step * 2.5 || 1)));
      const out = { x, g, r: side * 16 * (top > 0 ? 1 - g : 0) };
      x += show[i] * k; return out;
    });
  };
  const paint = () => {
    const el = box.current; if (!el) return;
    Array.from(el.children).forEach((c, i) => {
      const s = now.current[i]; if (!s) return; const st = (c as HTMLElement).style;
      st.transform = `translateX(${s.x.toFixed(2)}px) rotateY(${s.r.toFixed(2)}deg) scale(${(1 + (grow - 1) * s.g).toFixed(4)})`;
      st.zIndex = String(Math.round(s.g * 100) + (s.g > 0.5 ? 100 : 0));
    });
  };
  const run = () => {
    cancelAnimationFrame(raf.current);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let last = performance.now();
    const step = (t: number) => {
      const goal = target(), f = still ? 1 : 1 - Math.exp(-Math.min(50, t - last) / 70); last = t;
      let moving = false;
      now.current = goal.map((g, i) => {
        const c = now.current[i] || g;
        const nx = { x: c.x + (g.x - c.x) * f, g: c.g + (g.g - c.g) * f, r: c.r + (g.r - c.r) * f };
        if (Math.abs(nx.x - g.x) > 0.2 || Math.abs(nx.g - g.g) > 0.003 || Math.abs(nx.r - g.r) > 0.1) moving = true; else return g;
        return nx;
      });
      paint();
      if (moving) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };
  useLayoutEffect(() => { now.current = target(); paint(); }, [n, width]);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => { now.current = target(); paint(); }); ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(raf.current); };
  }, [n, width]);
  const move = (x: number | null) => { pointer.current = x; run(); };
  return <>
    <div className="img-strip" ref={box} style={{ width: natural, height }} role="list" aria-label={`${n} ${n === 1 ? "image" : "images"}`}
      onPointerMove={e => move(e.clientX - e.currentTarget.getBoundingClientRect().left)} onPointerLeave={() => move(null)}>
      {images.map((img, i) => <div className="img-card" key={img.key} role="listitem" style={{ width, height }}>
        <button type="button" className="img-open" aria-label={`Open ${img.name}`} title={img.name} onClick={() => setOpen(i)}
          onFocus={e => { if (e.currentTarget.matches(":focus-visible")) move(now.current[i] ? now.current[i].x + width / 2 : 0); }} onBlur={() => move(null)}>
          <img src={img.src} alt={img.name} draggable={false} />
        </button>
        {onRemove && <button type="button" className="img-remove" aria-label={`Remove ${img.name}`} title="Remove" onClick={() => onRemove(img.key)}><XMarkIcon aria-hidden="true" /></button>}
      </div>)}
    </div>
    {open !== null && images[open] && <Lightbox images={images} at={open} setAt={setOpen} close={() => setOpen(null)} />}
  </>;
}

export function Lightbox({ images, at, setAt, close }: { images: StripImage[]; at: number; setAt: (i: number) => void; close: () => void }) {
  const img = images[at], n = images.length;
  const [big, setBig] = useState<{ key: string; src: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { let on = true; if (img.large) void img.large().then(src => { if (on && src) setBig({ key: img.key, src }); }).catch(() => {}); return () => { on = false; }; }, [img.key]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null; root.current?.focus();
    return () => before?.focus?.();
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === "ArrowRight" && n > 1) { e.preventDefault(); setAt((at + 1) % n); }
      else if (e.key === "ArrowLeft" && n > 1) { e.preventDefault(); setAt((at - 1 + n) % n); }
    };
    window.addEventListener("keydown", key, true); return () => window.removeEventListener("keydown", key, true);
  }, [at, n]);
  return createPortal(
    <div className="lightbox" ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={img.name} onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="lightbox-bar"><span>{img.name}</span>{n > 1 && <small>{at + 1} / {n}</small>}<button type="button" className="icon-button" aria-label="Close preview" onClick={close}><XMarkIcon aria-hidden="true" /></button></div>
      {n > 1 && <button type="button" className="lightbox-step prev" aria-label="Previous image" onClick={() => setAt((at - 1 + n) % n)}><ChevronLeftIcon aria-hidden="true" /></button>}
      <img key={img.key} src={big?.key === img.key ? big.src : img.src} alt={img.name} />
      {n > 1 && <button type="button" className="lightbox-step next" aria-label="Next image" onClick={() => setAt((at + 1) % n)}><ChevronRightIcon aria-hidden="true" /></button>}
    </div>, document.body);
}
