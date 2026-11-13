import { useEffect, useRef } from "react";

/** FoneCue's level meter: 10 bars mirrored from the center, breathing gently when it is quiet so it never looks dead. */
export function Visualizer({ analyser, width = 75, height = 20, color }: { analyser: AnalyserNode | null; width?: number; height?: number; color?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0, t = 0;
    const ratio = window.devicePixelRatio || 1;
    const c = canvas.current!; c.width = width * ratio; c.height = height * ratio;
    const g = c.getContext("2d")!; g.scale(ratio, ratio);
    const fill = color || getComputedStyle(document.documentElement).getPropertyValue("--voice-bar").trim() || "#ebe7dc";
    const data = new Uint8Array(analyser ? analyser.frequencyBinCount : 0);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      g.clearRect(0, 0, width, height);
      const bars = 10, bw = 3, gap = 3, x0 = (width - (bars * bw + (bars - 1) * gap)) / 2;
      let max = 0;
      if (analyser) { analyser.getByteFrequencyData(data); for (let i = 0; i < data.length; i++) if (data[i] > max) max = data[i]; }
      const live = max > 15;
      t += 0.08;
      g.fillStyle = fill;
      for (let i = 0; i < bars; i++) {
        let h: number;
        if (live) {
          const bin = i < bars / 2 ? i * 2 + 1 : (bars - 1 - i) * 2 + 1;
          const gain = Math.min(1, ((data[bin] || 0) / 255) * 1.5);
          h = Math.min(height - 2, Math.max(3.5, 3.5 + gain * (height - 5.5)));
        } else {
          h = Math.max(3.5, (Math.sin(t + i * 0.6) * 0.5 + 0.5) * (height * 0.65));
        }
        const x = x0 + i * (bw + gap), y = (height - h) / 2;
        g.beginPath(); g.roundRect(x, y, bw, h, 1.5); g.fill();
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser, width, height, color]);
  return <canvas ref={canvas} className="voice-viz" style={{ width, height }} aria-hidden="true" />;
}
