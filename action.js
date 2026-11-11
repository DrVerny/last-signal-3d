// THE LAST SIGNAL - small shared helpers for the action sequences.
// The action banner (a persistent goal line during a run or chase) and
// the hit flash (a full-screen colour pulse) are created lazily in code,
// so no HTML edits are needed for them. Everything here is guarded:
// if the DOM is unavailable, the helpers are silent no-ops.

import * as THREE from 'three';

let bannerEl = null, flashEl = null;

function ensureBanner() {
  if (bannerEl) return bannerEl;
  try {
    bannerEl = document.createElement('div');
    bannerEl.id = 'actionBanner';
    bannerEl.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);' +
      'background:rgba(8,14,20,.92);border:1px solid #ffd166;border-radius:10px;' +
      'padding:10px 18px;z-index:18;color:#ffd166;font-size:15px;letter-spacing:1px;' +
      'text-align:center;max-width:92vw;display:none;pointer-events:none;';
    document.body.appendChild(bannerEl);
  } catch (e) { bannerEl = null; }
  return bannerEl;
}

export function showActionBanner(html) {
  const el = ensureBanner();
  if (!el) return;
  try { el.innerHTML = html; el.style.display = 'block'; } catch (e) { /* ignore */ }
}

export function hideActionBanner() {
  try { if (bannerEl) bannerEl.style.display = 'none'; } catch (e) { /* ignore */ }
}

function ensureFlash() {
  if (flashEl) return flashEl;
  try {
    flashEl = document.createElement('div');
    flashEl.id = 'actionFlash';
    flashEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:19;' +
      'opacity:0;background:rgba(255,40,30,0.35);';
    document.body.appendChild(flashEl);
  } catch (e) { flashEl = null; }
  return flashEl;
}

// A quick full-screen colour pulse (a hit, a near miss). Fades out on its own.
export function flashScreen(color) {
  const el = ensureFlash();
  if (!el) return;
  try {
    el.style.background = color || 'rgba(255,40,30,0.35)';
    el.style.transition = 'none';
    el.style.opacity = '1';
    requestAnimationFrame(() => {
      el.style.transition = 'opacity .5s';
      el.style.opacity = '0';
    });
  } catch (e) { /* ignore */ }
}

// Flat distance on the ground plane, for dodge and goal checks.
export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// A pulsing floating marker (a canvas-texture sprite), for run goals and
// climb points. Returns the sprite; the caller adds it to the scene and
// hides or removes it when the beat ends.
export function makeActionMarker(text, color) {
  try {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = color || '#ffd166';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#111111';
    ctx.font = 'bold 52px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(text, 256, 82);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    s.scale.set(1.6, 0.4, 1);
    return s;
  } catch (e) { return null; }
}
