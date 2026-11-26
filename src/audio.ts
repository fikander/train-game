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

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const vary = (x: number, amt = 0.08) => x * (1 + (Math.random() * 2 - 1) * amt);

/** A steam whistle: a few detuned triangle voices with a little warble, shaped by a list of [start, end] blasts. */
function steamWhistle(freqs: number[], blasts: [number, number][], vol = 0.1) {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const end = blasts[blasts.length - 1][1];
  for (const f of freqs) {
    const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = vary(6, 0.2); lg.gain.value = f * 0.01;
    lfo.connect(lg).connect(o.frequency);
    o.type = 'triangle';
    o.frequency.setValueAtTime(f * 0.94, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    g.gain.setValueAtTime(0.0001, t);
    for (const [a, b] of blasts) {
      g.gain.setValueAtTime(0.0001, t + a);
      g.gain.exponentialRampToValueAtTime(vol, t + a + 0.05);
      g.gain.setValueAtTime(vol, t + b - 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t + b);
    }
    o.connect(g).connect(master);
    o.start(t); lfo.start(t); o.stop(t + end + 0.1); lfo.stop(t + end + 0.1);
  }
  for (const [a, b] of blasts) noise(b - a, 2600, 0.8, 0.035, a);
}

let chuffN = 0;

export const sfx = {
  /** The big departure whistle: a different one each time. */
  whistle() {
    const base = vary(1, 0.06);
    pick([
      () => steamWhistle([740, 932, 1109].map(f => f * base), [[0, 0.4], [0.5, 1.2]]),
      () => steamWhistle([622, 784, 932].map(f => f * base), [[0, 1.0]]),
      () => steamWhistle([831, 1047].map(f => f * base), [[0, 0.22], [0.3, 0.52], [0.62, 1.3]]),
      () => steamWhistle([554, 698, 831, 1109].map(f => f * base), [[0, 0.3], [0.4, 0.7]], 0.08),
    ])();
  },
  /** A short, friendly toot when Go is pressed. */
  toot() {
    const base = vary(1, 0.05);
    pick([
      () => steamWhistle([880 * base, 1109 * base], [[0, 0.25]], 0.09),
      () => steamWhistle([784 * base, 988 * base], [[0, 0.14], [0.2, 0.36]], 0.09),
    ])();
  },
  /** Station bell at the start of a level. */
  bell() {
    const f = pick([1318, 1175, 1397]);
    for (const d of [0, 0.28]) { tone(f, 0.6, 'sine', 0.12, undefined, d); tone(f * 2.76, 0.25, 'sine', 0.03, undefined, d); }
  },
  /** One steam chuff; alternates strong and soft beats and never sounds quite the same twice. */
  chuff() {
    const strong = chuffN++ % 2 === 0;
    noise(vary(strong ? 0.14 : 0.09, 0.2), vary(strong ? 650 : 950, 0.25), 0.7, strong ? 0.2 : 0.11);
    if (strong) tone(vary(90, 0.1), 0.09, 'sine', 0.12, 50);
  },
  clunk() { pick([() => { tone(180, 0.18, 'square', 0.12, 60); noise(0.08, 400, 1, 0.25); }, () => { tone(140, 0.2, 'square', 0.1, 50); noise(0.06, 600, 1.5, 0.22); noise(0.05, 300, 1, 0.18, 0.07); }])(); },
  clack() { tone(vary(620, 0.06), 0.06, 'triangle', 0.25, 300); noise(0.04, 2500, 2, 0.2); },
  kachunk() { noise(0.06, 1500, 2, 0.3); tone(220, 0.1, 'square', 0.1, 90, 0.08); noise(0.08, 500, 1, 0.3, 0.1); },
  boop() { tone(vary(500, 0.1), 0.18, 'sine', 0.3, 900); },
  boing() { tone(220, 0.35, 'sine', 0.35, 700); tone(330, 0.3, 'triangle', 0.15, 900, 0.05); noise(0.06, 900, 1, 0.2); },
  wobble() { tone(300, 0.25, 'sine', 0.25, 200); },
  pop() { tone(vary(400, 0.1), 0.12, 'sine', 0.3, 1400); },
  oops() { tone(500, 0.2, 'triangle', 0.25, 350); tone(350, 0.3, 'triangle', 0.25, 250, 0.22); },
  /** Win jingle: one of a few little tunes. */
  tada() {
    const tunes: [number, number][][] = [
      [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36]],
      [[784, 0], [659, 0.1], [784, 0.2], [1047, 0.34], [988, 0.5], [1047, 0.62]],
      [[587, 0], [740, 0.13], [880, 0.26], [740, 0.39], [880, 0.5], [1175, 0.64]],
      [[523, 0], [523, 0.1], [784, 0.22], [659, 0.36], [1047, 0.5]],
    ];
    for (const [f, d] of pick(tunes)) { tone(f, 0.32, 'triangle', 0.22, undefined, d); tone(f * 2, 0.15, 'sine', 0.05, undefined, d); }
  },
  tweet() { tone(2000, 0.08, 'sine', 0.2, 3000); tone(2200, 0.1, 'sine', 0.2, 3200, 0.12); },
};
