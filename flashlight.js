// THE LAST SIGNAL - flashlight for the dark sections (Act I).
// A spotlight that rides on the camera, toggled with F or the HUD button.
// It is an extra light only: it never touches the lighting modes, the
// blackout puzzle or the relay glow, so the repair still plays exactly
// as before. In normal light it adds little; in blackout and on battery
// it brightens the player's immediate view. Guarded: if the scene or
// camera is missing, toggling is a no-op.

import * as THREE from 'three';
import { sfxClick } from './sound.js';

let light = null, target = null, cam = null, on = false;

export function initFlashlight(scene, camera) {
  cam = camera;
  try {
    if (!scene || !camera) return;
    light = new THREE.SpotLight(0xfff2d8, 0, 14, 0.5, 0.6, 1.4);
    light.position.set(0, 1.6, 4);
    target = new THREE.Object3D();
    target.position.set(0, 1.4, -2);
    scene.add(target);
    light.target = target;
    scene.add(light);
    const b = document.getElementById('flashBtn');
    if (b) b.onclick = () => toggleFlashlight();
    updateFlashButton();
  } catch (e) { light = null; }
}

export function isFlashlightOn() { return on; }

export function toggleFlashlight() {
  on = !on;
  try {
    if (light) light.intensity = on ? 25 : 0;
    try { sfxClick(); } catch (e) { /* ignore */ }
  } catch (e) { /* ignore */ }
  updateFlashButton();
  return on;
}

function updateFlashButton() {
  try {
    const b = document.getElementById('flashBtn');
    if (!b) return;
    b.textContent = on ? '🔦 Light on' : '🔦 Light off';
    b.classList.toggle('flash-on', on);
    b.title = on ? 'Flashlight is on - press F or click to turn it off' : 'Flashlight is off - press F or click to turn it on';
  } catch (e) { /* ignore */ }
}

// Keep the beam glued to the camera, pointing where the player looks.
// Call once per frame from the act's animate loop.
export function updateFlashlight() {
  if (!light || !cam || !target) return;
  try {
    light.position.copy(cam.position);
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    target.position.copy(cam.position).addScaledVector(dir, 6);
  } catch (e) { /* never break the frame */ }
}
