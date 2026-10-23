/** 効果音（WebAudioでその場合成するオリジナル音。外部音源は使わない） */
import { MaterialId } from '@kinggnu/shared';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let noiseBuf: AudioBuffer | null = null;

try {
  muted = localStorage.getItem('kinggnu.muted') === '1';
} catch {
  /* ignore */
}

export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.55;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem('kinggnu.muted', m ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (master) master.gain.value = m ? 0 : 0.55;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, freq: number, q = 1, type: BiquadFilterType = 'bandpass', delay = 0) {
  if (!ctx || !master || !noiseBuf) return;
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random() * 0.3);
  s.stop(t + dur + 0.02);
}

export const sfx = {
  click() {
    tone(660, 0.06, 'square', 0.08);
  },
  charge(level: number) {
    tone(200 + level * 400, 0.05, 'sine', 0.05);
  },
  swing(power: number) {
    noise(0.18 + power * 0.1, 0.12 + power * 0.15, 900 + power * 900, 0.8, 'bandpass');
  },
  hit(dmg: number, mat: MaterialId, whip: boolean) {
    const p = Math.min(1, dmg / 200);
    tone(120 - p * 40, 0.18 + p * 0.15, 'sine', 0.35 + p * 0.3, 0.5);
    noise(0.12 + p * 0.1, 0.25 + p * 0.3, 600, 0.6, 'lowpass');
    if (whip) noise(0.08, 0.35, 4000, 2, 'highpass');
    if (mat === 'glass') tone(2400, 0.15, 'triangle', 0.08, 1.2);
    if (mat === 'wood') tone(420, 0.08, 'square', 0.06, 0.7);
    if (mat === 'rubber') tone(180, 0.2, 'sine', 0.12, 2.2);
    if (mat === 'azuki') tone(900, 0.06, 'square', 0.05, 0.5);
    if (mat === 'iron') {
      tone(1250, 0.35, 'triangle', 0.1, 0.98);
      tone(1870, 0.25, 'sine', 0.06, 0.99);
    }
    if (mat === 'gold') tone(980, 0.3, 'sine', 0.09, 0.97);
    if (mat === 'coral') noise(0.07, 0.25, 2200, 2, 'bandpass');
    if (mat === 'fire') noise(0.25, 0.25, 700, 0.5, 'lowpass');
  },
  recoil() {
    tone(90, 0.12, 'sawtooth', 0.1, 0.6);
  },
  clash(power: number) {
    tone(800 + power * 600, 0.12, 'triangle', 0.15 + power * 0.2, 0.6);
    noise(0.08, 0.2, 2500, 1.5);
  },
  crack() {
    noise(0.06, 0.35, 3000, 3, 'highpass');
    tone(1600, 0.05, 'square', 0.05, 0.4);
  },
  shatter() {
    for (let i = 0; i < 6; i++) tone(2000 + Math.random() * 3000, 0.25, 'triangle', 0.06, 0.8, i * 0.03);
    noise(0.4, 0.4, 5000, 0.7, 'highpass');
  },
  snap() {
    noise(0.15, 0.5, 900, 1.5);
    tone(140, 0.2, 'square', 0.1, 0.5);
  },
  burn() {
    noise(0.22, 0.12, 500 + Math.random() * 300, 0.6, 'lowpass');
    noise(0.05, 0.08, 3500, 2, 'highpass', 0.05);
  },
  bend() {
    tone(220, 0.35, 'sawtooth', 0.06, 0.7);
    tone(330, 0.3, 'triangle', 0.05, 0.75);
  },
  drip() {
    tone(1200 + Math.random() * 400, 0.06, 'sine', 0.05, 0.6);
  },
  countdown(final: boolean) {
    tone(final ? 880 : 440, final ? 0.4 : 0.15, 'square', 0.1);
  },
  ko() {
    tone(300, 0.9, 'sawtooth', 0.15, 0.25);
    noise(0.6, 0.3, 300, 0.7, 'lowpass');
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'square', 0.08, 1, i * 0.12));
  },
  lose() {
    [392, 330, 262].forEach((f, i) => tone(f, 0.35, 'triangle', 0.1, 1, i * 0.18));
  },
};
