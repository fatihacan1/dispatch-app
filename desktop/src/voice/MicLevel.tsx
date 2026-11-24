import { useEffect, useRef, useState } from "react";
import "./mic-level.css";

const SEGMENTS = 40;
const SOUND_HOLD_MS = 1500;
const SOUND_THRESHOLD = 0.22; // about -47 dB: above a room's hum, below quiet speech

/** Discord-style segmented microphone level meter with 1.5 s speech detection. */
export function MicLevel({ analyser }: { analyser: AnalyserNode }) {
  const meterRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [heard, setHeard] = useState(false);
  const heardRef = useRef(false);

  useEffect(() => {
    const meter = meterRef.current;
    const canvas = canvasRef.current;
    if (!meter || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const styles = getComputedStyle(document.documentElement);
    const colTrack = styles.getPropertyValue("--line-strong").trim() || "#30333a";
    const colGreen = styles.getPropertyValue("--status-working").trim() || "#4cc38a";
    const colYellow = styles.getPropertyValue("--status-waiting").trim() || "#e2a336";
    const colRed = styles.getPropertyValue("--status-error").trim() || "#e5484d";

    const buf = new Float32Array(analyser.fftSize);
    let level = 0;
    let lastSoundAt = -Infinity;
    let lastAriaAt = 0;
    let raf = 0;

    const syncSize = () => {
      const ratio = window.devicePixelRatio || 1;
      const w = meter.clientWidth || 320;
      const h = meter.clientHeight || 18;
      if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);
      }
      return { w, h, ratio };
    };

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      analyser.getFloatTimeDomainData(buf);

      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -100;
      const raw = Math.max(0, Math.min(1, (db + 60) / 60));

      if (reducedMotion) {
        level = raw;
      } else {
        level += (raw - level) * (raw > level ? 0.55 : 0.14);
      }

      if (raw > SOUND_THRESHOLD) lastSoundAt = now;
      const nextHeard = now - lastSoundAt <= SOUND_HOLD_MS;
      if (nextHeard !== heardRef.current) {
        heardRef.current = nextHeard;
        setHeard(nextHeard);
      }

      if (now - lastAriaAt >= 250) {
        lastAriaAt = now;
        meter.setAttribute("aria-valuenow", String(Math.round(level * 100)));
      }

      const { w, h, ratio } = syncSize();
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const gap = 3;
      const segW = Math.max(2, (w - (SEGMENTS - 1) * gap) / SEGMENTS);
      const filled = Math.round(level * SEGMENTS);
      const yellowStart = Math.floor(SEGMENTS * 0.75);
      const redStart = SEGMENTS - 3;

      for (let i = 0; i < SEGMENTS; i++) {
        if (i >= filled) {
          ctx.fillStyle = colTrack;
        } else if (i >= redStart) {
          ctx.fillStyle = colRed;
        } else if (i >= yellowStart) {
          ctx.fillStyle = colYellow;
        } else {
          ctx.fillStyle = colGreen;
        }
        const x = i * (segW + gap);
        ctx.beginPath();
        ctx.roundRect(x, 0, segW, h, 2);
        ctx.fill();
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  return (
    <div className="mic-level">
      <div
        ref={meterRef}
        className="mic-level-meter"
        role="meter"
        aria-label="Microphone input level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
      >
        <canvas ref={canvasRef} aria-hidden="true" />
      </div>
      <span className={"mic-level-status" + (heard ? " heard" : "")}>
        {heard ? "We hear you" : "No sound yet. Speak into the microphone"}
      </span>
    </div>
  );
}
