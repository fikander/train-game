// Tiny synthesised sound effects (no audio files needed).

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try { muted = localStorage.getItem('choo.muted') === '1'; } catch { /* ignore */ }

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function isMuted() { return muted; }
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem('choo.muted', m ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.value = m ? 0 : 0.6;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, endFreq?: number, delay = 0) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

let noiseBuf: AudioBuffer | null = null;
function noise(dur: number, freq: number, q = 1, vol = 0.3, delay = 0) {
  if (!ctx || !master) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

export const sfx = {
  whistle() {
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    for (const [f, v] of [[740, 0.12], [932, 0.1], [1109, 0.08]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 6; lg.gain.value = 8;
      lfo.connect(lg).connect(o.frequency);
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.06);
      g.gain.setValueAtTime(v, t + 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      g.gain.exponentialRampToValueAtTime(v, t + 0.5);
      g.gain.setValueAtTime(v, t + 1.0);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      o.connect(g).connect(master);
      o.start(t); lfo.start(t);
      o.stop(t + 1.3); lfo.stop(t + 1.3);
    }
    noise(1.1, 2500, 0.8, 0.04);
  },
  chuff() { noise(0.12, 700, 0.7, 0.18); },
  clunk() { tone(180, 0.18, 'square', 0.12, 60); noise(0.08, 400, 1, 0.25); },
  clack() { tone(620, 0.06, 'triangle', 0.25, 300); noise(0.04, 2500, 2, 0.2); },
  kachunk() { noise(0.06, 1500, 2, 0.3); tone(220, 0.1, 'square', 0.1, 90, 0.08); noise(0.08, 500, 1, 0.3, 0.1); },
  boop() { tone(500, 0.18, 'sine', 0.3, 900); },
  boing() { tone(220, 0.35, 'sine', 0.35, 700); tone(330, 0.3, 'triangle', 0.15, 900, 0.05); noise(0.06, 900, 1, 0.2); },
  wobble() { tone(300, 0.25, 'sine', 0.25, 200); },
  pop() { tone(400, 0.12, 'sine', 0.3, 1400); },
  oops() { tone(500, 0.2, 'triangle', 0.25, 350); tone(350, 0.3, 'triangle', 0.25, 250, 0.22); },
  tada() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, 'triangle', 0.25, undefined, i * 0.12)); },
  moo() { tone(160, 0.8, 'sawtooth', 0.08, 120); },
  quack() { tone(700, 0.12, 'sawtooth', 0.1, 400); tone(700, 0.12, 'sawtooth', 0.1, 400, 0.18); },
  tweet() { tone(2000, 0.08, 'sine', 0.2, 3000); tone(2200, 0.1, 'sine', 0.2, 3200, 0.12); },
};

