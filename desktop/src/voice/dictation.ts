// Live dictation: the mic at 16 kHz, a simple energy VAD, and repeated decodes of the current segment so text shows
// up word by word. A segment is committed after a short silence; the next one starts empty.

const RATE = 16000;
const TICK_MS = 650;          // how often the open segment is re-decoded
const SILENCE_MS = 650;       // quiet this long after speech = segment done
const MAX_SEGMENT_S = 25;     // force a commit on very long speech
const MIN_SPEECH_S = 0.35;

const WORKLET = `class Tap extends AudioWorkletProcessor { process(inputs) { const c = inputs[0] && inputs[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; } } registerProcessor('dispatch-tap', Tap);`;

export type DictationEvents = {
  /** Text of the open segment, replaced on every decode. */
  partial?: (text: string) => void;
  /** A finished segment, appended once. */
  commit?: (text: string) => void;
  error?: (message: string) => void;
};

function wav(samples: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return buf;
}

export class Dictation {
  analyser: AnalyserNode | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  private length = 0;
  private speech = 0;          // samples above the noise gate in this segment
  private lastVoice = 0;
  private noise = 0.004;       // running noise floor
  private busy: Promise<void> | null = null;
  private timer = 0;
  private stopped = false;
  private lastPartial = "";
  private startedAt = performance.now();
  /** ms since the last speech (or since start if nothing was said); heard = any speech so far. */
  quiet() { return { ms: performance.now() - (this.lastVoice || this.startedAt), heard: this.lastVoice > 0 }; }
  constructor(private on: DictationEvents, private deviceId = "") {}

  async start() {
    this.stream = await openMic(this.deviceId);
    this.ctx = new AudioContext({ sampleRate: RATE });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    try { await this.ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const source = this.ctx.createMediaStreamSource(this.stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 256; analyser.minDecibels = -85; analyser.maxDecibels = -25; analyser.smoothingTimeConstant = 0.35;
    source.connect(analyser); this.analyser = analyser;
    this.node = new AudioWorkletNode(this.ctx, "dispatch-tap");
    this.node.port.onmessage = e => this.push(e.data as Float32Array);
    source.connect(this.node);
    // Keeps the graph pulling audio without playing it back.
    const mute = this.ctx.createGain(); mute.gain.value = 0; this.node.connect(mute); mute.connect(this.ctx.destination);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    void window.army.voice.warm().catch(e => this.on.error?.(clean(e)));
  }

  private push(frame: Float32Array) {
    let sum = 0; for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    const gate = Math.max(0.012, this.noise * 3);
    if (rms > gate) { this.speech += frame.length; this.lastVoice = performance.now(); }
    else this.noise = this.noise * 0.995 + rms * 0.005;
    this.chunks.push(frame); this.length += frame.length;
    // Long silence before any speech: keep only the last half second as lead-in.
    if (!this.speech && this.length > RATE * 2) this.trim(RATE / 2);
  }

  private trim(keep: number) {
    const all = this.samples(); const tail = all.slice(Math.max(0, all.length - keep));
    this.chunks = [tail]; this.length = tail.length;
  }

  private samples() {
    const out = new Float32Array(this.length); let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  private async decode(audio: Float32Array) {
    return window.army.voice.transcribe(wav(audio));
  }

  private tick() {
    if (this.busy || this.stopped) return;
    const hasSpeech = this.speech >= RATE * MIN_SPEECH_S;
    if (!hasSpeech) return;
    const quiet = performance.now() - this.lastVoice > SILENCE_MS;
    if (quiet || this.length > RATE * MAX_SEGMENT_S) { this.busy = this.finish().finally(() => { this.busy = null; }); return; }
    const audio = this.samples();
    this.busy = this.decode(audio).then(text => { if (!this.stopped && text !== this.lastPartial) { this.lastPartial = text; this.on.partial?.(text); } })
      .catch(e => this.on.error?.(clean(e))).finally(() => { this.busy = null; });
  }

  /** Commit the open segment. */
  private async finish() {
    const audio = this.samples();
    const enough = this.speech >= RATE * MIN_SPEECH_S;
    this.chunks = []; this.length = 0; this.speech = 0;
    if (!enough) { if (this.lastPartial) { this.lastPartial = ""; this.on.partial?.(""); } return; }
    try { const text = await this.decode(audio); this.lastPartial = ""; this.on.partial?.(""); if (text) this.on.commit?.(text); }
    catch (e) { this.on.error?.(clean(e)); }
  }

  private stopping: Promise<void> | null = null;
  /** Stop the mic and commit what was said last. Every caller waits for the same finish. */
  stop() { return this.stopping ??= this.doStop(); }
  private async doStop() {
    this.stopped = true;
    window.clearInterval(this.timer);
    this.node?.port.close();
    this.stream?.getTracks().forEach(t => t.stop());
    if (this.busy) await this.busy.catch(() => {});
    await this.finish();
    void this.ctx?.close().catch(() => {});
    this.analyser = null;
  }

  /** Stop without committing anything still open. */
  cancel() {
    this.stopped = true; window.clearInterval(this.timer);
    this.stream?.getTracks().forEach(t => t.stop()); void this.ctx?.close().catch(() => {});
    this.analyser = null;
  }
}

/** The chosen mic (Settings > Voice), or the system default when it is unplugged or none was chosen. */
export async function openMic(deviceId = "") {
  const base = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (deviceId) {
    try { return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: deviceId } } }); }
    catch (e: any) { if (!/Overconstrained|NotFound/i.test(String(e?.name || e))) throw e; }
  }
  return navigator.mediaDevices.getUserMedia({ audio: base });
}

const clean = (e: unknown) => String(e).replace(/^Error: Error invoking remote method '[^']+': (Error: )?/, "");

/** Joins dictated text onto what is already there with one space where needed. */
export function joinSpoken(before: string, spoken: string) {
  if (!spoken) return "";
  return before && !/[\s(\[{"'“]$/.test(before) ? " " + spoken : spoken;
}
