// THE LAST SIGNAL - procedural sound design (Web Audio API).
// Zero cost, no API key, no audio files: every sound is generated in code
// from oscillators and filtered noise. The game plays exactly as before if
// audio is unavailable or blocked: browsers only allow audio after a user
// gesture, so the AudioContext is created on the first click or key press,
// and every public function is guarded and no-ops silently when there is
// no context. The voice (speechSynthesis) is a separate layer with its
// own button; this module is ambient sound, effects and score only, kept
// quiet enough that it never drowns the voices.

const SOUND_MUTE_KEY = 'lastSignalSoundMuted';
let soundMuted = false;
try { soundMuted = localStorage.getItem(SOUND_MUTE_KEY) === '1'; } catch (e) { soundMuted = false; }

let ctx = null, master = null, ambientBus = null, sfxBus = null, musicBus = null;
let noiseBuf = null;
let currentAmbient = null, activeAmbient = null;
let scoreNodes = null, tensionTarget = 0.2;
let tickTime = 0, lastBeat = 0, stepTimer = 0, chirpTimer = 3, blipTimer = 5, lastShutter = 0;

// Ambient recipes: layers of oscillator or filtered noise. gain is the
// layer's steady level (0 to 1, kept low); lfo wobbles gain, filter or
// frequency so the sound breathes instead of sitting flat.
const AMBIENTS = {
  train: [
    { src: 'noise', filter: { type: 'lowpass', freq: 120 }, gain: 0.14, lfo: { rate: 0.6, depth: 0.05, param: 'gain' } },
    { src: 'sine', freq: 48, gain: 0.05 },
    { src: 'noise', filter: { type: 'bandpass', freq: 500, q: 0.6 }, gain: 0.05, lfo: { rate: 0.13, depth: 0.03, param: 'gain' } }
  ],
  tunnel: [
    { src: 'noise', filter: { type: 'bandpass', freq: 320, q: 0.5 }, gain: 0.06, lfo: { rate: 0.09, depth: 0.04, param: 'gain' } },
    { src: 'sine', freq: 42, gain: 0.04 },
    { src: 'noise', filter: { type: 'lowpass', freq: 90 }, gain: 0.06, lfo: { rate: 0.4, depth: 0.03, param: 'gain' } }
  ],
  field: [
    { src: 'noise', filter: { type: 'bandpass', freq: 700, q: 0.4 }, gain: 0.045, lfo: { rate: 0.11, depth: 0.03, param: 'gain' } },
    { src: 'sine', freq: 55, gain: 0.02 }
  ],
  substation: [
    { src: 'sine', freq: 60, gain: 0.05 },
    { src: 'sine', freq: 120, gain: 0.02 },
    { src: 'sine', freq: 2400, gain: 0.008 },
    { src: 'noise', filter: { type: 'highpass', freq: 3000 }, gain: 0.012 }
  ],
  bridge: [
    { src: 'noise', filter: { type: 'bandpass', freq: 450, q: 0.4 }, gain: 0.09, lfo: { rate: 0.07, depth: 0.05, param: 'gain' } },
    { src: 'sine', freq: 50, gain: 0.03 }
  ],
  control: [
    { src: 'sine', freq: 55, gain: 0.03 },
    { src: 'noise', filter: { type: 'bandpass', freq: 900, q: 2 }, gain: 0.012 }
  ],
  court: [
    { src: 'noise', filter: { type: 'bandpass', freq: 400, q: 0.8 }, gain: 0.05, lfo: { rate: 0.23, depth: 0.03, param: 'gain' } },
    { src: 'sine', freq: 48, gain: 0.03 }
  ],
  chase: [
    { src: 'saw', freq: 70, filter: { type: 'lowpass', freq: 300 }, gain: 0.07, lfo: { rate: 0.8, depth: 20, param: 'freq' } },
    { src: 'noise', filter: { type: 'lowpass', freq: 500 }, gain: 0.08 },
    { src: 'sine', freq: 800, gain: 0.025, lfo: { rate: 0.45, depth: 160, param: 'freq' } }
  ],
  room: [
    { src: 'sine', freq: 50, gain: 0.025 },
    { src: 'noise', filter: { type: 'lowpass', freq: 200 }, gain: 0.03 }
  ],
  press: [
    { src: 'noise', filter: { type: 'bandpass', freq: 500, q: 0.7 }, gain: 0.055, lfo: { rate: 0.19, depth: 0.03, param: 'gain' } },
    { src: 'sine', freq: 52, gain: 0.025 }
  ],
  dawn: [
    { src: 'noise', filter: { type: 'bandpass', freq: 600, q: 0.4 }, gain: 0.035, lfo: { rate: 0.1, depth: 0.02, param: 'gain' } },
    { src: 'sine', freq: 55, gain: 0.018 }
  ]
};

function getNoiseBuf() {
  if (noiseBuf) return noiseBuf;
  try {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { noiseBuf = null; }
  return noiseBuf;
}

function buildLayer(spec, dest) {
  const g = ctx.createGain();
  g.gain.value = spec.gain;
  let src;
  if (spec.src === 'noise') {
    src = ctx.createBufferSource();
    src.buffer = getNoiseBuf();
    src.loop = true;
  } else {
    src = ctx.createOscillator();
    src.type = spec.src;
    src.frequency.value = spec.freq || 440;
  }
  let node = src;
  let filterNode = null;
  if (spec.filter) {
    filterNode = ctx.createBiquadFilter();
    filterNode.type = spec.filter.type;
    filterNode.frequency.value = spec.filter.freq;
    if (spec.filter.q) filterNode.Q.value = spec.filter.q;
    node.connect(filterNode);
    node = filterNode;
  }
  node.connect(g);
  g.connect(dest);
  const lfos = [];
  if (spec.lfo) {
    try {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = spec.lfo.rate;
      const lg = ctx.createGain();
      lg.gain.value = spec.lfo.depth;
      lfo.connect(lg);
      if (spec.lfo.param === 'gain') lg.connect(g.gain);
      else if (spec.lfo.param === 'freq' && src.frequency) lg.connect(src.frequency);
      else if (spec.lfo.param === 'filter' && filterNode) lg.connect(filterNode.frequency);
      lfo.start();
      lfos.push(lfo);
    } catch (e) { /* LFO is decoration, never fatal */ }
  }
  try { src.start(); } catch (e) { /* ignore */ }
  return { src, gain: g, lfos };
}

function stopAmbient(a) {
  try {
    for (const l of a.layers) {
      try { l.src.stop(); } catch (e) { /* already stopped */ }
      for (const o of l.lfos) { try { o.stop(); } catch (e) { /* ignore */ } }
      try { l.gain.disconnect(); } catch (e) { /* ignore */ }
    }
    try { a.gain.disconnect(); } catch (e) { /* ignore */ }
  } catch (e) { /* cleanup is best effort */ }
}

export function isSoundAvailable() {
  try {
    return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  } catch (e) { return false; }
}

// Create (or resume) the AudioContext. Returns true only when audio is
// actually running. Safe to call on every user gesture.
export function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } }
    return ctx.state === 'running';
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = soundMuted ? 0 : 0.9;
    master.connect(ctx.destination);
    ambientBus = ctx.createGain(); ambientBus.gain.value = 0.6; ambientBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.6; musicBus.connect(master);
    getNoiseBuf();
    ensureScore();
    if (currentAmbient) { const n = currentAmbient; currentAmbient = null; setAmbient(n); }
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } }
    return ctx.state === 'running';
  } catch (e) { ctx = null; return false; }
}

// Crossfade to a named ambient (see AMBIENTS), or 'off' to silence it.
// Safe to call before audio exists: the name is remembered and applied
// when the context unlocks on the first user gesture.
export function setAmbient(name) {
  if (name === currentAmbient) return;
  currentAmbient = name || null;
  if (!ctx) return;
  try {
    const old = activeAmbient;
    if (old) {
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      setTimeout(() => stopAmbient(old), 1500);
    }
    if (!name || !AMBIENTS[name]) { activeAmbient = null; return; }
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(ambientBus);
    const layers = AMBIENTS[name].map(spec => buildLayer(spec, g));
    g.gain.setTargetAtTime(1, ctx.currentTime, 0.6);
    activeAmbient = { name, gain: g, layers };
  } catch (e) { /* ambient is decoration, never fatal */ }
}

// The procedural score: two detuned low sines beating against each other
// plus a quiet saw pad through a lowpass. Tension (0 to 1) raises the
// pitch, opens the filter and lifts the level, all eased, never jumping.
function ensureScore() {
  if (scoreNodes || !ctx) return;
  try {
    const g = ctx.createGain();
    g.gain.value = 0.05;
    g.connect(musicBus);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    f.connect(g);
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 55.6;
    const o3 = ctx.createOscillator(); o3.type = 'sawtooth'; o3.frequency.value = 110;
    const g3 = ctx.createGain(); g3.gain.value = 0.25;
    o1.connect(f); o2.connect(f); o3.connect(g3); g3.connect(f);
    o1.start(); o2.start(); o3.start();
    scoreNodes = { gain: g, filter: f, o1, o2, o3 };
    setTension(tensionTarget);
  } catch (e) { scoreNodes = null; }
}

export function setTension(v) {
  tensionTarget = Math.max(0, Math.min(1, v || 0));
  if (!ctx || !scoreNodes) { if (ctx) ensureScore(); if (!scoreNodes) return; }
  try {
    const t = ctx.currentTime;
    const base = 55 + tensionTarget * 16;
    scoreNodes.o1.frequency.setTargetAtTime(base, t, 1.2);
    scoreNodes.o2.frequency.setTargetAtTime(base * 1.011, t, 1.2);
    scoreNodes.o3.frequency.setTargetAtTime(base * 2, t, 1.2);
    scoreNodes.filter.frequency.setTargetAtTime(220 + tensionTarget * 700, t, 1.2);
    scoreNodes.gain.gain.setTargetAtTime(0.035 + tensionTarget * 0.05, t, 1.2);
  } catch (e) { /* score is decoration */ }
}

// ---------- One-shot effects ----------
function blip(type, f0, f1, dur, gain, when) {
  if (!ctx || ctx.state !== 'running') return;
  try {
    const t0 = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(sfxBus);
    o.start(t0); o.stop(t0 + dur + 0.05);
  } catch (e) { /* effect is best effort */ }
}

function noiseHit(dur, gain, filterType, filterFreq, sweepTo, when) {
  if (!ctx || ctx.state !== 'running') return;
  try {
    const t0 = ctx.currentTime + (when || 0);
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuf();
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType || 'lowpass';
    f.frequency.setValueAtTime(filterFreq || 400, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(sfxBus);
    src.start(t0); src.stop(t0 + dur + 0.05);
  } catch (e) { /* effect is best effort */ }
}

export function sfxClick() { blip('square', 1200, 900, 0.05, 0.1); }
export function sfxRepair() { blip('triangle', 1900, 1500, 0.06, 0.14); noiseHit(0.04, 0.08, 'highpass', 2500); }
export function sfxDoor() { noiseHit(0.25, 0.28, 'lowpass', 300); blip('sine', 90, 50, 0.25, 0.28); }
export function sfxStep() { noiseHit(0.07, 0.16, 'lowpass', 240 + Math.random() * 90); }
export function sfxThud() { blip('sine', 75, 40, 0.3, 0.38); noiseHit(0.15, 0.22, 'lowpass', 200); }
export function sfxWhoosh() { noiseHit(0.4, 0.14, 'bandpass', 400, 1200); }
export function sfxTick() { blip('square', 1500, 1500, 0.04, 0.09); }
export function sfxPowerRestored() { blip('sine', 523, 523, 0.12, 0.16); blip('sine', 784, 784, 0.18, 0.16, 0.12); }
export function sfxBoom() { blip('sine', 120, 30, 0.8, 0.45); noiseHit(0.7, 0.35, 'lowpass', 150); }
export function sfxGavel() { blip('sine', 200, 80, 0.08, 0.28); blip('sine', 200, 80, 0.08, 0.28, 0.18); }
export function sfxShutter() {
  const now = Date.now();
  if (now - lastShutter < 350) return;
  lastShutter = now;
  noiseHit(0.05, 0.18, 'highpass', 2000);
}
export function sfxRev() {
  if (!ctx || ctx.state !== 'running') return;
  try {
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(60, t0);
    o.frequency.exponentialRampToValueAtTime(180, t0 + 0.7);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.75);
    o.connect(f); f.connect(g); g.connect(sfxBus);
    o.start(t0); o.stop(t0 + 0.8);
  } catch (e) { /* ignore */ }
}
export function sfxTrainPass() { noiseHit(1.2, 0.11, 'bandpass', 300, 900); }
export function sfxAlert() { blip('square', 880, 880, 0.14, 0.12); blip('square', 660, 660, 0.14, 0.12, 0.16); }
export function sfxQteGood() { blip('sine', 880, 880, 0.1, 0.16); blip('sine', 1320, 1320, 0.16, 0.16, 0.09); }
export function sfxQteMiss() { blip('sine', 180, 120, 0.2, 0.18); }
export function sfxChirp() {
  const base = 2200 + Math.random() * 1000;
  blip('sine', base, base * 1.3, 0.07, 0.05);
  blip('sine', base * 1.2, base, 0.06, 0.04, 0.09);
}
export function sfxBlip() { blip('sine', 1000, 1000, 0.08, 0.05); }

function heartbeatThump() {
  blip('sine', 55, 40, 0.14, 0.32);
  blip('sine', 50, 38, 0.12, 0.22, 0.15);
}

// Per-frame audio: heartbeat at the given bpm, footsteps while moving,
// and the occasional bird chirp or control-room blip for the current
// ambient. Call once per frame from the act's animate loop. opts:
// { moving: boolean, heartbeatBpm: number (0 = off) }.
export function soundTick(dt, opts) {
  if (!ctx || ctx.state !== 'running') return;
  const o = opts || {};
  tickTime += dt || 0.016;
  const bpm = o.heartbeatBpm || 0;
  if (bpm > 0) {
    const interval = 60 / bpm;
    if (tickTime - lastBeat >= interval) { lastBeat = tickTime; heartbeatThump(); }
  } else {
    lastBeat = tickTime;
  }
  if (o.moving) {
    stepTimer -= dt || 0.016;
    if (stepTimer <= 0) { sfxStep(); stepTimer = 0.42 + Math.random() * 0.08; }
  } else {
    stepTimer = 0.15;
  }
  if (currentAmbient === 'field' || currentAmbient === 'dawn') {
    chirpTimer -= dt || 0.016;
    if (chirpTimer <= 0) { sfxChirp(); chirpTimer = 4 + Math.random() * 7; }
  }
  if (currentAmbient === 'control') {
    blipTimer -= dt || 0.016;
    if (blipTimer <= 0) { sfxBlip(); blipTimer = 6 + Math.random() * 8; }
  }
}

// ---------- Mute + HUD button ----------
export function isSoundMuted() { return soundMuted; }

export function setSoundMuted(m) {
  soundMuted = !!m;
  try { localStorage.setItem(SOUND_MUTE_KEY, soundMuted ? '1' : '0'); } catch (e) { /* private mode */ }
  try {
    if (ctx && master) master.gain.setTargetAtTime(soundMuted ? 0 : 0.9, ctx.currentTime, 0.1);
  } catch (e) { /* ignore */ }
  updateSoundButton();
}

export function toggleSoundMuted() {
  setSoundMuted(!soundMuted);
  return soundMuted;
}

function updateSoundButton() {
  try {
    const b = document.getElementById('soundBtn');
    if (!b) return;
    if (!isSoundAvailable()) {
      b.textContent = '🔇 Sound off';
      b.classList.add('sound-off');
      b.title = 'Procedural sound is not supported in this browser';
      b.disabled = true;
      return;
    }
    b.disabled = false;
    b.textContent = soundMuted ? '🔇 Sound off' : '🔊 Sound on';
    b.classList.toggle('sound-off', soundMuted);
    b.title = soundMuted
      ? 'Ambient sound, effects and score are off - click to turn them on'
      : 'Ambient sound, effects and score are on - click to mute';
  } catch (e) { /* button is best effort */ }
}

// Wire the HUD sound button, unlock audio on the first user gesture, and
// give every button a soft click sound. Call once at boot in each act.
export function initSoundUI() {
  updateSoundButton();
  try {
    const b = document.getElementById('soundBtn');
    if (b) b.onclick = () => toggleSoundMuted();
    const unlock = () => { ensureAudio(); };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    document.addEventListener('click', e => {
      try {
        if (e.target && e.target.closest && e.target.closest('button')) sfxClick();
      } catch (err) { /* ignore */ }
    }, true);
  } catch (e) { /* sound UI is best effort */ }
}
