// THE LAST SIGNAL - shared WebGL core for the single-page game.
// One renderer and one canvas for all three acts. Each act builds its own
// scene and camera and renders them through this shared renderer, so act
// transitions never create a second WebGL context on the same canvas.
// The shared renderer is never disposed; a finished act's scene is torn
// down with disposeScene() instead.
import * as THREE from 'three';

export const canvas = document.getElementById('scene');
// The renderer is created up front, and a browser with no WebGL throws
// here. That used to fail the whole app silently: the loading overlay
// stayed on "Loading characters..." forever with no error at all. Show
// the reason on the overlay instead, so the player knows it is the
// browser, not the game.
export let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  try {
    const t = document.getElementById('loadingText');
    if (t) t.textContent = 'This browser cannot run 3D (WebGL is not available). Try Chrome or Edge.';
    const er = document.getElementById('loadingError');
    if (er) { er.classList.remove('hidden'); er.textContent = 'WebGL unavailable.'; }
  } catch (e2) { /* ignore */ }
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// If the GPU drops the context (memory pressure, a driver reset, a
// software renderer giving up on a heavy scene), the canvas freezes
// on its last frame while the game logic keeps running - which reads
// as the world being stuck. preventDefault on the lost event lets
// the browser restore the context; three.js then re-uploads on the
// next render. Log both events so a live check can see them, and put
// them on screen too (see the error banner below): a checker without
// console access can still read a frozen canvas's reason in a
// screenshot.
try {
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.error('[LastSignal] WebGL context lost - waiting for restore.');
    showFrameErrorBanner('WebGL context lost - the picture may stay frozen until the browser restores it.');
  }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    console.error('[LastSignal] WebGL context restored.');
    showFrameErrorBanner('WebGL context restored.');
    setTimeout(() => { try { hideFrameErrorBanner(); } catch (e) { /* ignore */ } }, 5000);
  }, false);
} catch (e) { /* context events are best effort */ }

// On-screen frame-error banner. A per-frame throw used to be visible
// only in the console, which a live checker (or the player) cannot
// read: the canvas froze on the last good frame while the game logic
// kept running, with no clue on screen. Every caught frame error now
// also lands here - a small red-on-dark strip at the top left naming
// the last error and how many have been caught. It stays hidden in
// normal play and only appears when something actually breaks, so a
// screenshot of a frozen game carries its own diagnosis.
let frameErrorBannerEl = null;
let frameErrorCount = 0;
export function showFrameErrorBanner(message) {
  try {
    frameErrorCount++;
    if (!frameErrorBannerEl) {
      frameErrorBannerEl = document.createElement('div');
      frameErrorBannerEl.id = 'frameErrorBanner';
      frameErrorBannerEl.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;max-width:62vw;padding:6px 10px;background:rgba(20,0,0,0.85);color:#ff6b6b;border:1px solid #ff6b6b;border-radius:6px;font:12px/1.4 monospace;pointer-events:none;word-break:break-word;';
      document.body.appendChild(frameErrorBannerEl);
    }
    frameErrorBannerEl.textContent = '[LastSignal frame error x' + frameErrorCount + '] ' + String(message || 'unknown error');
    frameErrorBannerEl.style.display = 'block';
  } catch (e) { /* the banner must never break the game */ }
}
export function hideFrameErrorBanner() {
  try { if (frameErrorBannerEl) frameErrorBannerEl.style.display = 'none'; } catch (e) { /* ignore */ }
}

// Morph-influence healing. Lip-sync and the face controls push
// jaw/smile morph attributes onto SHARED model geometries at
// runtime. A mesh that shares such a geometry but never got its
// morphTargetInfluences throws inside renderer.render (the WebGL2
// morph path reads influences.length unguarded) and freezes the
// canvas on the last good frame. The push sites sweep their own
// scene and cloneSkinned heals crowd clones, but a sharer in a
// different scene tree (a prologue crowd clone, a clone path that
// does not heal) can still slip through - the live fresh run threw
// from the rental drive onward while every headless audit of the
// Act II scene was clean. So: every push bumps a generation
// counter, and every render loop heals its scene once per
// generation before rendering. The per-frame check is O(1) when
// nothing was pushed; the heal is one scene traverse per push,
// not per frame. The render-failure catches also heal and retry,
// so a poisoned mesh from any future clone path fixes itself on
// the first bad frame instead of freezing the game.
let morphGeneration = 0;
const healedGeneration = new WeakMap();
export function markMorphsDirty() { morphGeneration++; }
export function healMorphInfluences(scene) {
  if (!scene) return 0;
  let healed = 0;
  try {
    scene.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      const ma = o.geometry.morphAttributes;
      if (!ma) return;
      const attr = ma.position || ma.normal || ma.color;
      if (!attr || !attr.length) return;
      if (!o.morphTargetInfluences || o.morphTargetInfluences.length !== attr.length) {
        try { o.updateMorphTargets(); healed++; } catch (e) { /* best effort */ }
      }
    });
  } catch (e) { /* healing must never break the loop */ }
  return healed;
}
export function healMorphsIfDirty(scene) {
  if (!scene) return;
  if (healedGeneration.get(scene) === morphGeneration) return;
  healedGeneration.set(scene, morphGeneration);
  healMorphInfluences(scene);
}

// Dispose every GPU resource owned by a scene (geometries, materials and
// their textures) so a finished act does not leak into the next one.
// Safe to call on a scene that was already disposed. The scene's
// environment / background texture is disposed too when it is one.
// Persistent objects (the player avatar, the player car) are marked
// keepAlive: they are moved between scenes, so disposing them here would
// break them in the next scene. A keepAlive subtree is skipped whole.
export function disposeScene(scene) {
  if (!scene) return;
  try {
    const stack = [scene];
    while (stack.length) {
      const o = stack.pop();
      if (o.userData && o.userData.keepAlive) continue;
      try {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        for (const m of mats) {
          try {
            if (m.map) m.map.dispose();
            if (m.emissiveMap) m.emissiveMap.dispose();
            if (m.normalMap) m.normalMap.dispose();
            if (m.roughnessMap) m.roughnessMap.dispose();
            if (m.metalnessMap) m.metalnessMap.dispose();
            if (m.alphaMap) m.alphaMap.dispose();
            m.dispose();
          } catch (e) { /* best effort */ }
        }
      } catch (e) { /* best effort */ }
      for (const c of o.children) stack.push(c);
    }
    if (scene.environment && typeof scene.environment.dispose === 'function') {
      try { scene.environment.dispose(); } catch (e) { /* ignore */ }
    }
    if (scene.background && scene.background.isTexture && typeof scene.background.dispose === 'function') {
      try { scene.background.dispose(); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* best effort */ }
}
