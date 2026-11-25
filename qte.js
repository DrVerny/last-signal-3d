// THE LAST SIGNAL - quick-time prompts (timed key presses).
// A short on-screen prompt: press the key in the window, or hold it to
// fill the bar. A well-timed press gives a small bonus; a miss just
// continues the scene - never a fail state, never blocks progress.
// Everything is guarded: if the prompt element cannot be created, or
// the game is in a state where a prompt makes no sense, the callback
// runs as a miss and the scene carries on.

import { sfxQteGood, sfxQteMiss } from './sound.js';

let active = null; // the one running prompt, if any
let rafId = 0;

function ensurePromptEl() {
  let el = document.getElementById('qtePrompt');
  if (el) return el;
  try {
    el = document.createElement('div');
    el.id = 'qtePrompt';
    el.className = 'hidden';
    el.innerHTML = '<div id="qteLabel"></div><div id="qteSub"></div>' +
      '<div id="qteBarWrap"><div id="qteBar"></div></div>' +
      '<div id="qteKey"></div>';
    document.body.appendChild(el);
    return el;
  } catch (e) { return null; }
}

function showPrompt(label, sub, keyLabel) {
  const el = ensurePromptEl();
  if (!el) return null;
  try {
    document.getElementById('qteLabel').textContent = label;
    document.getElementById('qteSub').textContent = sub || '';
    document.getElementById('qteKey').textContent = keyLabel || 'Press SPACE or tap here';
    document.getElementById('qteBar').style.width = '100%';
    el.classList.remove('hidden');
  } catch (e) { /* prompt is best effort */ }
  return el;
}

function hidePrompt() {
  try {
    const el = document.getElementById('qtePrompt');
    if (el) el.classList.add('hidden');
  } catch (e) { /* ignore */ }
}

function cleanup(st) {
  if (rafId) { try { cancelAnimationFrame(rafId); } catch (e) { /* ignore */ } rafId = 0; }
  // The state to clean MUST be passed in: finish() clears `active`
  // first, so reading `active` here used to see null and skip every
  // removeEventListener - stale document handlers then stayed attached
  // for the rest of the session, calling preventDefault() on every
  // later pointerdown/touchstart. That leak is live on the site now.
  const a = st || active;
  if (a) {
    try { document.removeEventListener('keydown', a.onKey, true); } catch (e) { /* ignore */ }
    try { document.removeEventListener('keyup', a.onKeyUp, true); } catch (e) { /* ignore */ }
    try { document.removeEventListener('pointerdown', a.onDown, true); } catch (e) { /* ignore */ }
    try { document.removeEventListener('pointerup', a.onUp, true); } catch (e) { /* ignore */ }
    try { document.removeEventListener('pointercancel', a.onUp, true); } catch (e) { /* ignore */ }
    try { document.removeEventListener('touchstart', a.onDown, true); } catch (e) { /* ignore */ }
    try { document.removeEventListener('touchend', a.onUp, true); } catch (e) { /* ignore */ }
    try { document.removeEventListener('touchcancel', a.onUp, true); } catch (e) { /* ignore */ }
    const el = document.getElementById('qtePrompt');
    if (el) {
      try { el.removeEventListener('pointerdown', a.onDown); } catch (e) { /* ignore */ }
      try { el.removeEventListener('pointerup', a.onUp); } catch (e) { /* ignore */ }
    }
    if (active === a) active = null;
  }
  hidePrompt();
}

function finish(success) {
  if (!active) return;
  const a = active;
  active = null;
  cleanup(a);
  try {
    if (success) { try { sfxQteGood(); } catch (e) { /* ignore */ } if (a.onHit) a.onHit(); }
    else { try { sfxQteMiss(); } catch (e) { /* ignore */ } if (a.onMiss) a.onMiss(); }
  } catch (e) { /* callbacks must never break the game */ }
  try { if (a.onDone) a.onDone(success); } catch (e) { /* ignore */ }
}

// Prompt mode: press the key once inside the window. Returns false if a
// prompt is already running (the caller carries on as if it missed).
export function runQTE(opts) {
  const o = opts || {};
  if (active) return false;
  const el = showPrompt(o.label || 'NOW!', o.sub || '', o.keyLabel || 'Press SPACE or tap here');
  if (!el) { try { if (o.onMiss) o.onMiss(); if (o.onDone) o.onDone(false); } catch (e) { /* ignore */ } return false; }
  const key = (o.key || ' ').toLowerCase();
  const windowMs = o.windowMs || 2500;
  const deadline = Date.now() + windowMs;
  const bar = document.getElementById('qteBar');
  const state = { onHit: o.onHit, onMiss: o.onMiss, onDone: o.onDone, onKey: null, onDown: null, onUp: null, onKeyUp: null };
  active = state;
  const hit = () => { if (active === state) finish(true); };
  state.onKey = (e) => {
    try {
      if ((e.key || '').toLowerCase() === key) { e.preventDefault(); e.stopPropagation(); hit(); }
    } catch (err) { /* ignore */ }
  };
  state.onDown = (e) => { try { e.preventDefault(); } catch (err) { /* ignore */ } hit(); };
  state.onUp = null;
  state.onKeyUp = null;
  try { document.addEventListener('keydown', state.onKey, true); } catch (e) { /* ignore */ }
  try { el.addEventListener('pointerdown', state.onDown); } catch (e) { /* ignore */ }
  // Touch: a tap anywhere on screen counts as the press, so a finger
  // does not have to land exactly on the prompt box.
  try { document.addEventListener('pointerdown', state.onDown, true); } catch (e) { /* ignore */ }
  try { document.addEventListener('touchstart', state.onDown, true); } catch (e) { /* ignore */ }
  const tick = () => {
    if (active !== state) return;
    const left = deadline - Date.now();
    if (left <= 0) { finish(false); return; }
    try { if (bar) bar.style.width = (left / windowMs * 100) + '%'; } catch (e) { /* ignore */ }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return true;
}

// Hold mode: hold the key (or hold the prompt with pointer/finger) until
// the bar fills. Releasing pauses the fill and it drains slowly. If the
// window runs out, it resolves as a miss and the scene carries on - the
// player can simply try again by triggering the moment a second time.
// onDone(success) always runs.
export function runHoldQTE(opts) {
  const o = opts || {};
  if (active) return false;
  const el = showPrompt(o.label || 'HOLD IT', o.sub || '', o.keyLabel || 'Hold SPACE or press and hold here');
  if (!el) { try { if (o.onDone) o.onDone(false); } catch (e) { /* ignore */ } return false; }
  const key = (o.key || ' ').toLowerCase();
  const holdMs = o.holdMs || 1200;
  const windowMs = o.windowMs || 8000;
  const deadline = Date.now() + windowMs;
  const bar = document.getElementById('qteBar');
  // startHeld: the finger/key that triggered this prompt is already
  // down (a press-and-hold on the catwalk planks starts the climb
  // directly). That press fired before these listeners were added,
  // so without this the hold would only start on the NEXT press.
  let progress = 0, held = !!o.startHeld, lastT = Date.now();
  const state = { onHit: null, onMiss: null, onDone: o.onDone, onKey: null, onDown: null, onUp: null, onKeyUp: null };
  active = state;
  const setBar = () => { try { if (bar) bar.style.width = (progress * 100) + '%'; } catch (e) { /* ignore */ } };
  state.onKey = (e) => {
    try {
      if ((e.key || '').toLowerCase() === key) { e.preventDefault(); e.stopPropagation(); held = true; }
    } catch (err) { /* ignore */ }
  };
  state.onKeyUp = (e) => {
    try { if ((e.key || '').toLowerCase() === key) held = false; } catch (err) { /* ignore */ }
  };
  state.onDown = (e) => { try { e.preventDefault(); } catch (err) { /* ignore */ } held = true; };
  state.onUp = () => { held = false; };
  try { document.addEventListener('keydown', state.onKey, true); } catch (e) { /* ignore */ }
  try { document.addEventListener('keyup', state.onKeyUp, true); } catch (e) { /* ignore */ }
  try { el.addEventListener('pointerdown', state.onDown); } catch (e) { /* ignore */ }
  try { el.addEventListener('pointerup', state.onUp); } catch (e) { /* ignore */ }
  // No pointerleave cancel: a finger held on the prompt drifts a
  // little, and drifting off the edge of the small prompt box used to
  // end the hold and drain the bar - on a phone that read as the
  // climb slipping back for no reason. Only lifting the finger ends it.
  // Touch: press and hold anywhere on screen counts, so a finger does
  // not have to stay exactly on the prompt box to keep climbing.
  try { document.addEventListener('pointerdown', state.onDown, true); } catch (e) { /* ignore */ }
  try { document.addEventListener('pointerup', state.onUp, true); } catch (e) { /* ignore */ }
  try { document.addEventListener('pointercancel', state.onUp, true); } catch (e) { /* ignore */ }
  // passive:false so preventDefault() actually stops the long-press
  // callout / scroll that a 1.2 s finger hold triggers on a phone;
  // a document touchstart listener is passive by default on mobile
  // Chrome, and the cancelled touch used to end the hold mid-climb.
  try { document.addEventListener('touchstart', state.onDown, { capture: true, passive: false }); } catch (e) { /* ignore */ }
  try { document.addEventListener('touchend', state.onUp, true); } catch (e) { /* ignore */ }
  try { document.addEventListener('touchcancel', state.onUp, true); } catch (e) { /* ignore */ }
  const tick = () => {
    if (active !== state) return;
    const now = Date.now();
    const dt = now - lastT;
    lastT = now;
    if (held) progress += dt / holdMs;
    else progress -= dt / (holdMs * 2); // drains half as fast as it fills
    if (progress < 0) progress = 0;
    if (progress >= 1) { setBar(); finish(true); return; }
    if (now >= deadline) { finish(false); return; }
    setBar();
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return true;
}

export function isQTEActive() { return !!active; }
