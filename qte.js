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
    document.getElementById('qteKey').textContent = keyLabel || 'Press SPACE';
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

function cleanup() {
  if (rafId) { try { cancelAnimationFrame(rafId); } catch (e) { /* ignore */ } rafId = 0; }
  if (active) {
    try { document.removeEventListener('keydown', active.onKey, true); } catch (e) { /* ignore */ }
    try { document.removeEventListener('keyup', active.onKeyUp, true); } catch (e) { /* ignore */ }
    const el = document.getElementById('qtePrompt');
    if (el) {
      try { el.removeEventListener('pointerdown', active.onDown); } catch (e) { /* ignore */ }
      try { el.removeEventListener('pointerup', active.onUp); } catch (e) { /* ignore */ }
      try { el.removeEventListener('pointerleave', active.onUp); } catch (e) { /* ignore */ }
    }
    active = null;
  }
  hidePrompt();
}

function finish(success) {
  if (!active) return;
  const a = active;
  active = null;
  cleanup();
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
  const el = showPrompt(o.label || 'NOW!', o.sub || '', o.keyLabel || 'Press SPACE');
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
  const el = showPrompt(o.label || 'HOLD IT', o.sub || '', o.keyLabel || 'Hold SPACE');
  if (!el) { try { if (o.onDone) o.onDone(false); } catch (e) { /* ignore */ } return false; }
  const key = (o.key || ' ').toLowerCase();
  const holdMs = o.holdMs || 1200;
  const windowMs = o.windowMs || 8000;
  const deadline = Date.now() + windowMs;
  const bar = document.getElementById('qteBar');
  let progress = 0, held = false, lastT = Date.now();
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
  try { el.addEventListener('pointerleave', state.onUp); } catch (e) { /* ignore */ }
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
