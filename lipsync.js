// THE LAST SIGNAL - lip-sync (procedural jaw morph).
// Why this file exists: the four human models are static MakeHuman /
// Innerscene scans (CC0) with no skeleton, no facial rig and no morph
// targets, so their mouths cannot move. Re-exporting the same characters
// with a rig was not possible: there are no MakeHuman source files (.mhm)
// for these four, only the finished GLBs, and the faces were picked from
// Innerscene's library, so they cannot be rebuilt exactly. The rigged
// models Innerscene does offer are a generic grey mannequin with a
// 53-bone body rig and explicitly no face rig, so they would change the
// look and still give no jaw. Mixamo body rigs likewise have no jaw bone,
// and Ready Player Me is stylised, not the game's realistic look.
// So the jaw is built here, at load time, from the models themselves:
// the separate teeth mesh marks the mouth, and a jaw-open morph target is
// generated on the face meshes by moving the lower lip and chin down.
// The mouth is driven by the dialogue line (word timing), not by true
// phoneme analysis, and it moves even when the voice is muted. The
// characters, look, positions, story and gameplay are unchanged, and if
// the morph cannot be built for a character that character simply keeps
// the old static face and the game plays as before.

import * as THREE from './three.module.js';
import { characterKey } from './gestures.js';

// How far the jaw drops at full open, and how far the chin juts forward,
// in metres. A real open mouth drops the chin about 2 cm.
const OPEN_DIST = 0.020;
const FWD_DIST = 0.004;

// Smoothstep that works for a rising edge (a < b) and a falling edge
// (a > b). Returns 0 at a and 1 at b.
export function smoothstep(a, b, x) {
  if (a === b) return x <= a ? 1 : 0;
  let t = (x - a) / (b - a);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

// Build a mouth-open track for one dialogue line: one open-close pulse
// per word, wider on vowel-heavy words, at about 2.6 words a second,
// which matches the spoken rate. The track loops while the line stays
// on screen, so the mouth keeps moving while the player reads.
export function makeTrack(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const WPS = 2.6;
  const keys = [{ t: 0, open: 0.08 }];
  let t = 0;
  const wordDur = 1 / WPS;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const vowels = (w.match(/[aeiouy]/gi) || []).length;
    const vowelRatio = vowels / Math.max(1, w.length);
    const jitter = (((i + 1) * 2654435761) % 100) / 100;
    const peak = 0.45 + 0.45 * Math.min(1, vowelRatio * 1.4) + 0.12 * jitter;
    const start = t;
    keys.push({ t: start + 0.05, open: 0.14 });
    keys.push({ t: start + 0.13, open: Math.min(1, peak) });
    keys.push({ t: start + wordDur * 0.85, open: 0.16 });
    t += wordDur;
  }
  keys.push({ t: Math.max(t, 0.3), open: 0.08 });
  return { duration: Math.max(t, 0.3), keys };
}

// Sample a track at time t (seconds), looping past its end.
export function trackValue(track, t) {
  if (!track || !track.keys || !track.keys.length) return 0;
  const dur = track.duration || 0.3;
  let tt = t % dur;
  if (tt < 0) tt = 0;
  const keys = track.keys;
  if (tt <= keys[0].t) return keys[0].open;
  for (let i = 1; i < keys.length; i++) {
    if (tt <= keys[i].t) {
      const a = keys[i - 1], b = keys[i];
      const f = (tt - a.t) / Math.max(1e-6, b.t - a.t);
      return a.open + (b.open - a.open) * f;
    }
  }
  return keys[keys.length - 1].open;
}

// Forward direction of the face, in world space, from the body mesh:
// the mouth and the eyebrows sit on the front of the face, so the line
// from the head axis to them points out of the face. Falls back to +Z.
function computeForward(bodyMesh, mouthWorld, browWorld) {
  const fallback = new THREE.Vector3(0, 0, 1);
  try {
    bodyMesh.updateWorldMatrix(true, false);
    const mouthLocal = bodyMesh.worldToLocal(mouthWorld.clone());
    const pos = bodyMesh.geometry.attributes.position;
    if (!pos) return fallback;
    let top = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > top) top = y;
    }
    const scale = bodyMesh.getWorldScale(new THREE.Vector3());
    const s = (Math.abs(scale.x) + Math.abs(scale.y) + Math.abs(scale.z)) / 3 || 1;
    const headDepth = 0.24 / s;
    let hx = 0, hz = 0, hn = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > top - headDepth) {
        hx += pos.getX(i); hz += pos.getZ(i); hn++;
      }
    }
    if (!hn) return fallback;
    hx /= hn; hz /= hn;
    let fx = mouthLocal.x - hx, fz = mouthLocal.z - hz;
    if (browWorld) {
      const browLocal = bodyMesh.worldToLocal(browWorld.clone());
      fx += browLocal.x - hx; fz += browLocal.z - hz;
    }
    const len = Math.hypot(fx, fz);
    if (len < 1e-6) return fallback;
    const fLocal = new THREE.Vector3(fx / len, 0, fz / len);
    const q = bodyMesh.getWorldQuaternion(new THREE.Quaternion());
    return fLocal.applyQuaternion(q);
  } catch (e) { return fallback; }
}

// Add a jaw-open morph target to one mesh, moving the lower lip and chin
// down (and a touch forward) when the morph is at full weight. The jaw
// region is the patch of the face within 10 cm of the mouth, below the
// mouth line, on the front of the face. Returns the morph index, or -1.
// The morph is generated once per shared geometry (Act III clones share
// Caleb's geometry), and re-used by every mesh that shares it.
function addJawMorphToMesh(mesh, mouthWorld, forwardWorld) {
  try {
    const geo = mesh.geometry;
    if (!geo || !geo.attributes || !geo.attributes.position) return -1;
    if (geo.userData && geo.userData.jawMorphDone) {
      mesh.updateMorphTargets();
      const d = mesh.morphTargetDictionary || {};
      return (typeof d.jawOpen === 'number') ? d.jawOpen : -1;
    }
    mesh.updateWorldMatrix(true, false);
    const mouthLocal = mesh.worldToLocal(mouthWorld.clone());
    const q = mesh.getWorldQuaternion(new THREE.Quaternion()).invert();
    const fLocal = forwardWorld.clone().applyQuaternion(q);
    const fl = Math.hypot(fLocal.x, fLocal.z) || 1;
    fLocal.x /= fl; fLocal.z /= fl; fLocal.y = 0;
    const scale = mesh.getWorldScale(new THREE.Vector3());
    const s = (Math.abs(scale.x) + Math.abs(scale.y) + Math.abs(scale.z)) / 3 || 1;
    const pos = geo.attributes.position;
    const count = pos.count;
    let top = -Infinity;
    for (let i = 0; i < count; i++) {
      const y = pos.getY(i);
      if (y > top) top = y;
    }
    const headDepth = 0.24 / s;
    let hx = 0, hz = 0, hn = 0;
    for (let i = 0; i < count; i++) {
      if (pos.getY(i) > top - headDepth) {
        hx += pos.getX(i); hz += pos.getZ(i); hn++;
      }
    }
    if (!hn) return -1;
    hx /= hn; hz /= hn;
    const mouthFwd = (mouthLocal.x - hx) * fLocal.x + (mouthLocal.z - hz) * fLocal.z;
    const deltas = new Float32Array(count * 3);
    let maxW = 0;
    const openLocal = OPEN_DIST / s;
    const fwdLocal = FWD_DIST / s;
    const radial = 0.10 / s;
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const d3 = Math.sqrt((x - mouthLocal.x) * (x - mouthLocal.x) + (y - mouthLocal.y) * (y - mouthLocal.y) + (z - mouthLocal.z) * (z - mouthLocal.z));
      if (d3 > radial) continue;
      const dy = y - mouthLocal.y;
      if (dy > 0.010 / s || dy < -0.085 / s) continue;
      let wv;
      if (dy >= -0.025 / s) wv = smoothstep(0.010 / s, -0.025 / s, dy);
      else wv = 1 - smoothstep(-0.025 / s, -0.085 / s, dy);
      const fwd = (x - hx) * fLocal.x + (z - hz) * fLocal.z;
      if (fwd < mouthFwd - 0.045 / s) continue;
      const wf = smoothstep(mouthFwd - 0.045 / s, mouthFwd - 0.005 / s, fwd);
      const side = Math.abs((x - hx) * (-fLocal.z) + (z - hz) * fLocal.x);
      if (side > 0.085 / s) continue;
      const ws = 1 - smoothstep(0.055 / s, 0.085 / s, side);
      const w = wv * wf * ws;
      if (w <= 0) continue;
      if (w > maxW) maxW = w;
      deltas[i * 3] = fLocal.x * fwdLocal * w;
      deltas[i * 3 + 1] = -openLocal * w;
      deltas[i * 3 + 2] = fLocal.z * fwdLocal * w;
    }
    if (maxW < 0.05) return -1; // nothing in the jaw region on this mesh
    const attr = new THREE.BufferAttribute(deltas, 3);
    attr.name = 'jawOpen';
    geo.morphAttributes.position = [attr];
    geo.morphTargetsRelative = true;
    if (!geo.userData) geo.userData = {};
    geo.userData.jawMorphDone = true;
    mesh.updateMorphTargets();
    const d = mesh.morphTargetDictionary || {};
    if (typeof d.jawOpen === 'number') {
      mesh.morphTargetInfluences[d.jawOpen] = 0;
      return d.jawOpen;
    }
    return -1;
  } catch (e) { return -1; }
}

// Build the jaw morph for one loaded character group. Returns the list of
// meshes that got a working jaw, each with its morph index.
function buildJawMorph(group) {
  const meshes = [];
  try {
    group.updateMatrixWorld(true);
    let teeth = null;
    group.traverse((o) => {
      if (o.isMesh && o.name && o.name.toLowerCase().indexOf('teeth') !== -1) teeth = o;
    });
    if (!teeth) return meshes; // no mouth landmark, no morph
    const mouthWorld = new THREE.Box3().setFromObject(teeth).getCenter(new THREE.Vector3());
    let brow = null;
    group.traverse((o) => {
      if (o.isMesh && o.name && o.name.toLowerCase().indexOf('eyebrow') !== -1) brow = o;
    });
    const browWorld = brow ? new THREE.Box3().setFromObject(brow).getCenter(new THREE.Vector3()) : null;
    const candidates = [];
    group.traverse((o) => {
      if (!o.isMesh) return;
      if (o.name && o.name.indexOf('Bench') === 0) return; // Walter's hidden bench
      const box = new THREE.Box3().setFromObject(o);
      if (box.min.x - 0.06 > mouthWorld.x || box.max.x + 0.06 < mouthWorld.x) return;
      if (box.min.y - 0.06 > mouthWorld.y || box.max.y + 0.06 < mouthWorld.y) return;
      if (box.min.z - 0.06 > mouthWorld.z || box.max.z + 0.06 < mouthWorld.z) return;
      candidates.push(o);
    });
    if (!candidates.length) return meshes;
    let body = candidates[0];
    for (const m of candidates) {
      const a = m.geometry && m.geometry.attributes && m.geometry.attributes.position;
      const b = body.geometry && body.geometry.attributes && body.geometry.attributes.position;
      if (a && b && a.count > b.count) body = m;
    }
    const forward = computeForward(body, mouthWorld, browWorld);
    for (const mesh of candidates) {
      const idx = addJawMorphToMesh(mesh, mouthWorld, forward);
      if (idx >= 0) meshes.push({ mesh, index: idx });
    }
  } catch (e) { /* morph is best effort */ }
  return meshes;
}

function isShown(group) {
  let o = group;
  while (o) {
    if (o.visible === false) return false;
    o = o.parent;
  }
  return true;
}

const controllers = new Map(); // key -> { key, group, meshes, current, speaking, track, trackStart }
let rafStarted = false;
let lastNow = 0;
let currentWho = '';
let currentText = '';
let observerStarted = false;

// Register the act's humans (the `humans` array: { group, name, ... }).
// Call once, after the models have loaded and been placed, next to the
// gestures registerHumans call. Builds each character's jaw morph.
export function registerLipSyncHumans(humans) {
  try {
    if (!humans || !humans.length) return;
    for (const h of humans) {
      if (!h || !h.group || !h.name) continue;
      const meshes = buildJawMorph(h.group);
      controllers.set(h.name, {
        key: h.name, group: h.group, meshes,
        current: 0, speaking: false, track: null, trackStart: 0,
      });
    }
    startLoop();
    startObserver();
    onDialogueChange(); // a line may already be showing when models load
  } catch (e) { /* lip-sync is best effort */ }
}

// The character with this dialogue name is now speaking a line. If they
// have no model (or no working jaw) in the scene, nothing moves.
export function startSpeaking(who, text) {
  try {
    const key = characterKey(who);
    const c = controllers.get(key);
    if (!c) { stopSpeakingAll(); return; }
    c.track = makeTrack(text);
    c.trackStart = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
    c.speaking = true;
    currentWho = who; currentText = text;
  } catch (e) { /* ignore */ }
}

export function stopSpeakingAll() {
  try {
    for (const c of controllers.values()) { c.speaking = false; c.track = null; }
    currentWho = ''; currentText = '';
  } catch (e) { /* ignore */ }
}

// Read the dialogue box: who is speaking, and what line is showing.
// The mouth follows the line on screen, so it moves even when the voice
// is muted or the browser has no speech synthesis.
function onDialogueChange() {
  try {
    if (typeof document === 'undefined') return;
    const box = document.getElementById('dialogue');
    const nameEl = document.getElementById('dlgName');
    const textEl = document.getElementById('dlgText');
    if (!box || !nameEl || !textEl) return;
    if (box.classList.contains('hidden')) { stopSpeakingAll(); return; }
    const who = (nameEl.textContent || '').trim();
    const text = (textEl.textContent || '').trim();
    if (!who || !text) { stopSpeakingAll(); return; }
    if (who === currentWho && text === currentText) return; // same line, keep the track
    const key = characterKey(who);
    if (!controllers.has(key)) { stopSpeakingAll(); return; }
    startSpeaking(who, text);
  } catch (e) { /* ignore */ }
}

function startObserver() {
  if (observerStarted) return;
  observerStarted = true;
  try {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const box = document.getElementById('dialogue');
    if (!box) return;
    const obs = new MutationObserver(() => onDialogueChange());
    obs.observe(box, { attributes: true, attributeFilter: ['class'], childList: true, characterData: true, subtree: true });
  } catch (e) { /* observer is best effort */ }
}

// Per-frame mouth update, on its own animation loop so the acts' animate
// loops are untouched. Opens fast, closes a touch slower, like a real jaw.
function startLoop() {
  if (rafStarted) return;
  rafStarted = true;
  try {
    if (typeof window === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
    const tick = (nowMs) => {
      try {
        const now = nowMs / 1000;
        let dt = lastNow ? now - lastNow : 0.016;
        lastNow = now;
        if (dt > 0.1) dt = 0.1;
        if (dt < 0) dt = 0;
        for (const c of controllers.values()) {
          let target = 0;
          if (c.speaking && c.track) target = trackValue(c.track, now - c.trackStart);
          const rate = target > c.current ? 22 : 14;
          const k = 1 - Math.exp(-rate * dt);
          c.current += (target - c.current) * k;
          if (Math.abs(c.current) < 0.002) c.current = 0;
          const shown = c.group ? isShown(c.group) : false;
          for (const m of c.meshes) {
            if (!m.mesh) continue;
            if (!m.mesh.morphTargetInfluences) {
              try { m.mesh.updateMorphTargets(); } catch (e) { /* ignore */ }
            }
            if (m.mesh.morphTargetInfluences && m.index >= 0) {
              m.mesh.morphTargetInfluences[m.index] = shown ? c.current : 0;
            }
          }
        }
      } catch (e) { /* never break the game */ }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch (e) { /* loop is best effort */ }
}
