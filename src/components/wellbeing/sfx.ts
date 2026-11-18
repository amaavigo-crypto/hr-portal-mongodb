/** Small WebAudio sound kit. No files to download: every sound is made on the spot. A mute switch is remembered in this browser. */
const KEY = 'wb_sound';
let ctx: AudioContext | null = null;
let muted = (() => { try { return localStorage.getItem(KEY) === 'off'; } catch { return false; } })();
const listeners = new Set<() => void>();

export const isMuted = () => muted;
export const subscribeMute = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function setMuted(v: boolean) {
  muted = v;
  try { localStorage.setItem(KEY, v ? 'off' : 'on'); } catch { /* private mode */ }
  listeners.forEach((l) => l());
}

/** Browsers only allow sound after a tap; call this from a click handler (every Start button does). */
export function unlockAudio() {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* no audio */ }
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.18, delay = 0, slideTo?: number) {
  if (muted || !ctx) return;
  try {
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  } catch { /* ignore */ }
}

function noise(dur: number, vol = 0.2, delay = 0, lowpass = 900) {
  if (muted || !ctx) return;
  try {
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(ctx.destination);
    src.start(t0);
  } catch { /* ignore */ }
}

/** Pentatonic pad notes for Echo Beats, so any order sounds pleasant. */
const PAD_HZ = [261.63, 329.63, 392.0, 523.25];
export const sfx = {
  pad: (i: number, dur = 0.32) => { tone(PAD_HZ[i % 4], dur, 'triangle', 0.22); tone(PAD_HZ[i % 4] * 2, dur * 0.7, 'sine', 0.06); },
  pop: (combo = 0) => { tone(520 + Math.min(combo, 10) * 40, 0.13, 'triangle', 0.2, 0, 900 + Math.min(combo, 10) * 50); noise(0.08, 0.08, 0, 4000); },
  dodge: () => tone(300, 0.1, 'sine', 0.08, 0, 380),
  boom: () => { noise(0.45, 0.35, 0, 700); tone(130, 0.4, 'sawtooth', 0.14, 0, 40); },
  miss: () => tone(220, 0.18, 'sine', 0.1, 0, 150),
  tick: () => tone(660, 0.07, 'square', 0.07),
  go: () => { tone(880, 0.25, 'triangle', 0.2); tone(1320, 0.25, 'sine', 0.1, 0.02); },
  good: () => { tone(660, 0.1, 'triangle', 0.18); tone(990, 0.16, 'triangle', 0.16, 0.09); },
  bad: () => { tone(200, 0.22, 'sawtooth', 0.12, 0, 110); },
  stamp: () => { noise(0.12, 0.28, 0, 500); tone(110, 0.14, 'square', 0.1, 0, 70); },
  win: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, 'triangle', 0.17, i * 0.1)); },
  best: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.32, 'triangle', 0.17, i * 0.09)); tone(1568, 0.6, 'sine', 0.1, 0.5); },
};
