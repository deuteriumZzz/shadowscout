// Stadium sound, synthesized with Web Audio so the prototype ships no audio
// files. Off by default; the context is only created from a user gesture.

let ctx: AudioContext | null = null;
let ambient: { stop: () => void } | null = null;
let noise: AudioBuffer | null = null;

function getCtx() {
  if (typeof window === "undefined" || !window.AudioContext) return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function noiseBuffer(c: AudioContext) {
  if (noise) return noise;
  noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

function crowd(c: AudioContext, level: number) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 900;
  band.Q.value = 0.6;
  const gain = c.createGain();
  gain.gain.value = level;
  src.connect(band).connect(gain).connect(c.destination);
  src.start();
  return { src, gain };
}

export function whistle(long = false) {
  const c = getCtx();
  if (!c) return;
  const blasts = long ? [0, 0.34, 0.68] : [0];
  for (const at of blasts) {
    const t = c.currentTime + at;
    const osc = c.createOscillator();
    const wobble = c.createOscillator();
    const wobbleGain = c.createGain();
    const gain = c.createGain();
    osc.frequency.value = 2900;
    wobble.frequency.value = 42;
    wobbleGain.gain.value = 90;
    wobble.connect(wobbleGain).connect(osc.frequency);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    gain.gain.setValueAtTime(0.12, t + 0.24);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    wobble.start(t);
    osc.stop(t + 0.32);
    wobble.stop(t + 0.32);
  }
}

export function roar(strength = 1) {
  const c = getCtx();
  if (!c) return;
  const { src, gain } = crowd(c, 0.0001);
  const t = c.currentTime;
  gain.gain.exponentialRampToValueAtTime(0.28 * strength, t + 0.35);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
  src.stop(t + 2.9);
}

export function thud() {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.frequency.setValueAtTime(170, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.09);
  gain.gain.setValueAtTime(0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.12);
}

export function startAmbient() {
  const c = getCtx();
  if (!c || ambient) return;
  const { src } = crowd(c, 0.025);
  ambient = { stop: () => src.stop() };
}

export function stopAmbient() {
  ambient?.stop();
  ambient = null;
}
