// THE LAST SIGNAL - shared WebGL core for the single-page game.
// One renderer and one canvas for all three acts. Each act builds its own
// scene and camera and renders them through this shared renderer, so act
// transitions never create a second WebGL context on the same canvas.
// The shared renderer is never disposed; a finished act's scene is torn
// down with disposeScene() instead.
import * as THREE from 'three';

export const canvas = document.getElementById('scene');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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
