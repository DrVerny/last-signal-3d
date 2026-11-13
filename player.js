// THE LAST SIGNAL - player presence: third-person avatar, touch controls,
// zoom, realistic cars, door keys. Shared by all acts and the homes, so
// the player sees himself the same way everywhere. No wallet needed;
// demo mode works with no wallet connected. The avatar is built from
// primitives (always available, no async load) and wears the equipped
// outfit colour and cap from the store.
import * as THREE from 'three';
import { getEquipped, getEquippedCarDef, ITEM_BY_ID } from './economy.js';

// ---------- Third-person camera ----------
// First-person is the camera at the player's eyes. Third-person puts the
// camera behind and above a visible player avatar, so the player sees
// himself walk, drive and sleep. Default is third-person on touch
// devices (no keyboard, the avatar shows where you are) and first-person
// on desktop. The toggle is always available (C key or the Camera button).
let thirdPerson = false;
let zoomDist = 4;
export const ZOOM_MIN = 2;
export const ZOOM_MAX = 8;
export function isThirdPerson() { return thirdPerson; }
export function getZoom() { return zoomDist; }
export function setThirdPerson(on) {
  thirdPerson = !!on;
  try { const b = document.getElementById('camBtn'); if (b) b.textContent = thirdPerson ? 'Camera: 3rd (C)' : 'Camera: 1st (C)'; } catch (e) { /* no button yet */ }
  try { const b = document.getElementById('touchCamBtn'); if (b) b.textContent = thirdPerson ? '3rd' : '1st'; } catch (e) { /* no touch button yet */ }
}
export function toggleThirdPerson() { setThirdPerson(!thirdPerson); }
export function setZoom(d) {
  zoomDist = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(d) || 4));
  try { const l = document.getElementById('zoomLabel'); if (l) l.textContent = Math.round(zoomDist) + 'm'; } catch (e) { /* no label yet */ }
}
export function zoomBy(delta) { setZoom(zoomDist + delta); }
export function isTouchDevice() {
  try {
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) return true;
    if (typeof window !== 'undefined' && ('ontouchstart' in window)) return true;
  } catch (e) { /* ignore */ }
  return false;
}

// ---------- Player avatar ----------
// A procedural humanoid, about 1.8 m tall, built from boxes and spheres.
// Two-segment arms and legs (shoulder/elbow, hip/knee) so it can walk,
// sit in a car, and lie flat on a bed. The jacket uses the equipped
// clothes colour and a cap is added when the cap accessory is equipped,
// so the avatar shows what the player bought in the store.
let avatar = null;
let avatarParts = null;
let avatarPose = 'stand';
let avatarWalkPhase = 0;
let avatarScene = null;
function outfitColor() {
  try {
    const eq = getEquipped();
    const item = eq && eq.clothes ? ITEM_BY_ID[eq.clothes] : null;
    if (item && item.color) return new THREE.Color(item.color);
  } catch (e) { /* fall through */ }
  return new THREE.Color('#9aa5ad');
}
function hasCapEquipped() {
  try { const eq = getEquipped(); return eq && Array.isArray(eq.accessories) && eq.accessories.indexOf('cap') !== -1; } catch (e) { return false; }
}
function avMat(color, roughness) {
  return new THREE.MeshStandardMaterial({ color, roughness: roughness === undefined ? 0.85 : roughness });
}
export function buildPlayerAvatar() {
  if (avatar) return avatar;
  const skin = 0xc9a186, hairC = 0x2a2018, pants = 0x2a2f38, shoe = 0x1a1a1a;
  const jacket = outfitColor();
  const g = new THREE.Group();
  g.userData.keepAlive = true;
  const skinMat = avMat(skin, 0.8), hairMat = avMat(hairC, 0.95), pantsMat = avMat(pants, 0.9), shoeMat = avMat(shoe, 0.6);
  const jacketMat = new THREE.MeshStandardMaterial({ color: jacket, roughness: 0.85 });
  // Legs: hip pivot at y 0.95, thigh then shin (knee pivot) then shoe.
  function makeLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(0.11 * side, 0.95, 0);
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.45, 0.16), pantsMat);
    thigh.position.y = -0.22; thigh.castShadow = true; hip.add(thigh);
    const knee = new THREE.Group(); knee.position.set(0, -0.45, 0); hip.add(knee);
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.42, 0.14), pantsMat);
    shin.position.y = -0.21; shin.castShadow = true; knee.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.28), shoeMat);
    foot.position.set(0, -0.45, 0.05); foot.castShadow = true; knee.add(foot);
    g.add(hip);
    return { hip, knee };
  }
  const legL = makeLeg(-1), legR = makeLeg(1);
  // Torso: jacket, shoulders to hips.
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.26), jacketMat);
  torso.position.y = 1.26; torso.castShadow = true; g.add(torso);
  // Arms: shoulder pivot at y 1.5, upper arm then forearm (elbow pivot).
  function makeArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.28 * side, 1.5, 0);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.34, 0.12), jacketMat);
    upper.position.y = -0.17; upper.castShadow = true; shoulder.add(upper);
    const elbow = new THREE.Group(); elbow.position.set(0, -0.34, 0); shoulder.add(elbow);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 0.11), jacketMat);
    fore.position.y = -0.16; fore.castShadow = true; elbow.add(fore);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.1), skinMat);
    hand.position.y = -0.36; elbow.add(hand);
    g.add(shoulder);
    return { shoulder, elbow };
  }
  const armL = makeArm(-1), armR = makeArm(1);
  // Head: skin sphere, hair cap on top, eyes, and a cap when equipped.
  const headGroup = new THREE.Group(); headGroup.position.y = 1.68; g.add(headGroup);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), skinMat);
  head.position.y = 0.1; head.castShadow = true; headGroup.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.145, 16, 12), hairMat);
  hair.scale.set(1, 0.7, 1); hair.position.set(0, 0.17, -0.02); headGroup.add(hair);
  for (const ex of [-0.05, 0.05]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), avMat(0x1a1a1a, 0.4));
    eye.position.set(ex, 0.11, 0.13); headGroup.add(eye);
  }
  let capMesh = null;
  if (hasCapEquipped()) {
    capMesh = new THREE.Group();
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.15, 0.09, 16), avMat(0x2e4a6b, 0.85));
    crown.position.y = 0.22; capMesh.add(crown);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.14), avMat(0x2e4a6b, 0.85));
    brim.position.set(0, 0.19, 0.17); capMesh.add(brim);
    headGroup.add(capMesh);
  }
  // A soft blob shadow under the feet so the avatar reads on the ground.
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; g.add(shadow);
  g.traverse(o => { o.userData.keepAlive = true; });
  avatar = g;
  avatarParts = { legL, legR, armL, armR, headGroup, torso, capMesh };
  avatarPose = 'stand';
  return avatar;
}
export function getAvatar() { return avatar || buildPlayerAvatar(); }
export function detachAvatar() {
  if (avatar && avatar.parent) { try { avatar.parent.remove(avatar); } catch (e) { /* ignore */ } }
  avatarScene = null;
}
// Pose the avatar: 'stand' (limbs neutral), 'lie' (flat on the back,
// whole group rotated so the head points to -z), 'sit' (thighs forward,
// shins down, hands forward as if on a wheel). Walk swing is applied by
// updateAvatarWalk and only runs in the stand/walk pose.
export function setAvatarPose(pose) {
  const a = getAvatar();
  const p = avatarParts;
  if (!p) return;
  avatarPose = pose;
  // Reset all limb rotations first, then apply the pose.
  p.legL.hip.rotation.set(0, 0, 0); p.legL.knee.rotation.set(0, 0, 0);
  p.legR.hip.rotation.set(0, 0, 0); p.legR.knee.rotation.set(0, 0, 0);
  p.armL.shoulder.rotation.set(0, 0, 0); p.armL.elbow.rotation.set(0, 0, 0);
  p.armR.shoulder.rotation.set(0, 0, 0); p.armR.elbow.rotation.set(0, 0, 0);
  p.headGroup.rotation.set(0, 0, 0);
  a.rotation.x = 0; a.rotation.z = 0;
  if (pose === 'lie') {
    // Lie flat on the back: rotate the group so the head (+y) points to
    // -z. The group's origin is at the feet, so place it at the foot of
    // the bed and the head lands on the pillow.
    a.rotation.x = -Math.PI / 2;
    p.headGroup.rotation.x = 0.15;
  } else if (pose === 'sit') {
    // Seated in a car: thighs forward (horizontal), shins down, arms
    // forward to the wheel.
    p.legL.hip.rotation.x = -1.45; p.legL.knee.rotation.x = 1.35;
    p.legR.hip.rotation.x = -1.45; p.legR.knee.rotation.x = 1.35;
    p.armL.shoulder.rotation.x = -0.75; p.armL.elbow.rotation.x = -0.4;
    p.armR.shoulder.rotation.x = -0.75; p.armR.elbow.rotation.x = -0.4;
  }
}
// Procedural walk: arms and legs swing opposite, knees bend, with a
// small bob. Only runs while the avatar is standing/walking.
export function updateAvatarWalk(moving, dt) {
  const p = avatarParts;
  if (!p || avatarPose !== 'stand') return;
  if (moving) {
    avatarWalkPhase += dt * 7;
    const s = Math.sin(avatarWalkPhase);
    p.legL.hip.rotation.x = s * 0.55;
    p.legR.hip.rotation.x = -s * 0.55;
    p.legL.knee.rotation.x = Math.max(0, -s) * 0.7;
    p.legR.knee.rotation.x = Math.max(0, s) * 0.7;
    p.armL.shoulder.rotation.x = -s * 0.45;
    p.armR.shoulder.rotation.x = s * 0.45;
    p.armL.elbow.rotation.x = -0.25;
    p.armR.elbow.rotation.x = -0.25;
  } else {
    // Ease back to neutral when still.
    const k = 0.15;
    p.legL.hip.rotation.x *= (1 - k); p.legR.hip.rotation.x *= (1 - k);
    p.legL.knee.rotation.x *= (1 - k); p.legR.knee.rotation.x *= (1 - k);
    p.armL.shoulder.rotation.x *= (1 - k); p.armR.shoulder.rotation.x *= (1 - k);
    p.armL.elbow.rotation.x *= (1 - k); p.armR.elbow.rotation.x *= (1 - k);
  }
}

// ---------- Player presence (called each frame by an act or a home) ----------
// The act moves the camera as the player, so in third-person the camera
// is overridden to sit behind the avatar for rendering. That would break
// the next frame's movement (it would start from the overridden camera
// position), so the player ground position is stored here and
// beginPlayerFrame restores the camera onto the player at the start of
// the next frame, before the act moves it.
let playerPos = null;
export function beginPlayerFrame(camera, eyeY) {
  if (!thirdPerson || !playerPos || !camera) return;
  try {
    camera.position.x = playerPos.x;
    camera.position.z = playerPos.z;
    camera.position.y = eyeY === undefined ? 1.7 : eyeY;
  } catch (e) { /* ignore */ }
}
// Places the avatar at the player's ground position, faces it toward the
// movement (or the camera yaw when still), and - in third-person - puts
// the camera behind and above the avatar instead of at the eyes.
// o: { scene, camera, x, z, yaw, pitch, moving, moveDx, moveDz, dt, t, eyeY }
// The act still owns movement and bounds; this only positions the avatar
// and overrides the camera in third-person. Returns true when the camera
// was overridden (third-person), false in first-person.
export function applyPlayerPresence(o) {
  if (!o || !o.scene || !o.camera) return false;
  const a = getAvatar();
  // Move the avatar between scenes when the act or place changes.
  if (avatarScene !== o.scene) {
    detachAvatar();
    try { o.scene.add(a); } catch (e) { return false; }
    avatarScene = o.scene;
  }
  // Remember the player ground position for the next frame's movement.
  playerPos = { x: o.x, z: o.z };
  // First-person: the avatar is hidden (the camera is the player's eyes).
  if (!thirdPerson) { a.visible = false; return false; }
  a.visible = true;
  if (avatarPose !== 'stand') setAvatarPose('stand');
  // Face the movement direction while moving; face the camera yaw when still.
  let faceYaw = o.yaw;
  if (o.moving && (o.moveDx || o.moveDz)) faceYaw = Math.atan2(o.moveDx, o.moveDz);
  // The avatar is built facing +z, so rotation.y = faceYaw faces it that way.
  a.rotation.y = faceYaw;
  // A small step bob while walking, so the walk reads.
  const bobY = o.moving ? Math.abs(Math.sin((o.t || 0) * 7)) * 0.03 : 0;
  a.position.set(o.x, bobY, o.z);
  updateAvatarWalk(o.moving, o.dt || 0.016);
  // Third-person camera: behind the avatar relative to the look yaw, and
  // above it. Forward is (-sin yaw, -cos yaw), so behind is the opposite.
  const dist = zoomDist;
  const bx = Math.sin(o.yaw), bz = Math.cos(o.yaw);
  const camX = o.x + bx * dist;
  const camZ = o.z + bz * dist;
  const camY = (o.eyeY || 1.7) + dist * 0.28;
  o.camera.position.set(camX, camY, camZ);
  o.camera.rotation.order = 'YXZ';
  // Look at the avatar's head, slightly ahead so the view leads forward.
  const fx = -Math.sin(o.yaw), fz = -Math.cos(o.yaw);
  o.camera.lookAt(o.x + fx * 1.2, 1.45, o.z + fz * 1.2);
  return true;
}

// ---------- Movement ----------
// Movement vector for one frame. First-person keeps the existing
// world-aligned movement (W always moves -z, A always moves -x), so the
// desktop feel does not change. Third-person is camera-relative: W moves
// toward where the camera looks, so walking feels natural behind the
// avatar. Returns { dx, dz } in world space.
export function moveDelta(keys, yaw, speed) {
  let f = 0, s = 0;
  if (keys['w']) f += 1;
  if (keys['s']) f -= 1;
  if (keys['d']) s += 1;
  if (keys['a']) s -= 1;
  if (!f && !s) return { dx: 0, dz: 0, f: 0, s: 0 };
  if (thirdPerson) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    return { dx: (fx * f + rx * s) * speed, dz: (fz * f + rz * s) * speed, f, s };
  }
  return { dx: s * speed, dz: -f * speed, f, s };
}

// ---------- Touch controller (alphabet W/A/S/D) ----------
// On-screen letter buttons for movement on touch devices. They dispatch
// synthetic KeyboardEvents on window, so the existing per-act key
// listeners (game.js, act2.js, act3.js, home.js) pick them up exactly
// like a physical keyboard. Works in every act and in the rooms. The
// pad is shown automatically on touch devices and can be toggled.
let touchBuilt = false;
let touchVisible = false;
function dispatchKey(type, key) {
  try {
    const ev = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
  } catch (e) { /* ignore */ }
}
function makeTouchKey(label, key, parent) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'touch-key';
  b.textContent = label;
  b.dataset.key = key;
  const press = (e) => {
    try { e.preventDefault(); } catch (err) { /* ignore */ }
    b.classList.add('pressed');
    try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    dispatchKey('keydown', key);
  };
  const release = (e) => {
    b.classList.remove('pressed');
    dispatchKey('keyup', key);
  };
  b.addEventListener('pointerdown', press);
  b.addEventListener('pointerup', release);
  b.addEventListener('pointercancel', release);
  b.addEventListener('lostpointercapture', release);
  b.addEventListener('contextmenu', (e) => { try { e.preventDefault(); } catch (err) { /* ignore */ } });
  parent.appendChild(b);
  return b;
}
export function buildTouchControls() {
  if (touchBuilt) return;
  touchBuilt = true;
  // The W/A/S/D pad, bottom-left, in a D-pad layout with letters.
  const pad = document.createElement('div');
  pad.id = 'touchPad';
  pad.innerHTML = '<div class="touch-row"><span></span><span data-slot="w"></span><span></span></div>'
    + '<div class="touch-row"><span data-slot="a"></span><span data-slot="s"></span><span data-slot="d"></span></div>';
  document.body.appendChild(pad);
  const slot = (name) => pad.querySelector('[data-slot="' + name + '"]');
  const labels = { w: 'W', a: 'A', s: 'S', d: 'D' };
  for (const k of ['w', 'a', 's', 'd']) {
    const holder = slot(k);
    const b = makeTouchKey(labels[k], k, holder);
    b.classList.add('touch-key-' + k);
  }
  // Zoom buttons, bottom-right, with a distance label.
  const zoom = document.createElement('div');
  zoom.id = 'touchZoom';
  zoom.innerHTML = '<button type="button" id="zoomOutBtn" aria-label="Zoom out">-</button>'
    + '<span id="zoomLabel">4m</span>'
    + '<button type="button" id="zoomInBtn" aria-label="Zoom in">+</button>';
  document.body.appendChild(zoom);
  document.getElementById('zoomInBtn').addEventListener('click', () => zoomBy(-1));
  document.getElementById('zoomOutBtn').addEventListener('click', () => zoomBy(1));
  // Camera toggle + pad toggle, above the zoom buttons.
  const misc = document.createElement('div');
  misc.id = 'touchMisc';
  misc.innerHTML = '<button type="button" id="touchCamBtn">1st</button>'
    + '<button type="button" id="touchPadBtn">Keys</button>';
  document.body.appendChild(misc);
  document.getElementById('touchCamBtn').addEventListener('click', () => toggleThirdPerson());
  document.getElementById('touchPadBtn').addEventListener('click', () => setTouchVisible(!touchVisible));
  // Mouse wheel zooms the third-person camera on desktop.
  addEventListener('wheel', (e) => {
    if (!thirdPerson) return;
    if (e.target && e.target.closest && (e.target.closest('button') || e.target.closest('.modal') || e.target.closest('#storeOverlay'))) return;
    zoomBy(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });
  // C toggles first/third person everywhere.
  addEventListener('keydown', (e) => {
    if (e.key && e.key.toLowerCase() === 'c' && !e.repeat) {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      toggleThirdPerson();
    }
  });
  setTouchVisible(isTouchDevice());
  setThirdPerson(isTouchDevice());
  setZoom(zoomDist);
}
export function setTouchVisible(on) {
  touchVisible = !!on;
  try {
    const pad = document.getElementById('touchPad');
    if (pad) pad.style.display = touchVisible ? '' : 'none';
    const zm = document.getElementById('touchZoom');
    if (zm) zm.style.display = touchVisible ? '' : 'none';
    const mc = document.getElementById('touchMisc');
    if (mc) mc.style.display = '';
  } catch (e) { /* ignore */ }
  try { const b = document.getElementById('touchPadBtn'); if (b) b.textContent = touchVisible ? 'Keys: on' : 'Keys'; } catch (e) { /* ignore */ }
}
export function isTouchVisible() { return touchVisible; }

// ---------- Realistic cars (procedural) ----------
// A car built from parts, not a single box: a shaped lower body with a
// hood, a cabin with dark glass windows, a roofline, four wheels with
// hubs, headlights, taillights, a grille and a bumper, and side mirrors.
// The car faces +z (front at +z); rotate the group by PI to face -z.
// type changes the proportions: 'sedan' (balanced), 'coupe' (low and
// long), 'suv' (tall, e.g. the BMW X5). colour is a hex number.
function carMat(color, roughness, metalness) {
  return new THREE.MeshStandardMaterial({ color, roughness: roughness === undefined ? 0.4 : roughness, metalness: metalness === undefined ? 0.5 : metalness });
}
export function buildCar(colorHex, opts) {
  const o = opts || {};
  const type = o.type || 'sedan';
  const color = (colorHex === undefined || colorHex === null) ? 0x9aa5ad : colorHex;
  const g = new THREE.Group();
  g.userData.keepAlive = true;
  const bodyMat = carMat(color, 0.35, 0.55);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x10181f, roughness: 0.15, metalness: 0.7, transparent: true, opacity: 0.55 });
  const trimMat = carMat(0x1a1d20, 0.6, 0.3);
  const chromeMat = carMat(0xc8ccd0, 0.25, 0.9);
  const tyreMat = carMat(0x111111, 0.95, 0);
  const hubMat = carMat(0x9aa2a8, 0.3, 0.85);
  // Proportions by type (length along z, width along x).
  const dims = type === 'suv'
    ? { len: 4.6, wid: 1.95, bodyH: 0.75, bodyY: 0.62, cabLen: 2.6, cabY: 1.25, cabH: 0.62, wheelR: 0.38 }
    : type === 'coupe'
    ? { len: 4.5, wid: 1.85, bodyH: 0.5, bodyY: 0.5, cabLen: 2.0, cabY: 1.0, cabH: 0.45, wheelR: 0.33 }
    : { len: 4.4, wid: 1.85, bodyH: 0.55, bodyY: 0.55, cabLen: 2.2, cabY: 1.08, cabH: 0.5, wheelR: 0.34 };
  const L = dims.len, W = dims.wid;
  // Lower body: a long box with a slightly narrower hood section at the
  // front, so the silhouette reads as a car, not a slab.
  const lower = new THREE.Mesh(new THREE.BoxGeometry(W, dims.bodyH, L), bodyMat);
  lower.position.y = dims.bodyY; lower.castShadow = true; g.add(lower);
  // Hood: a lower, sloping panel at the front (+z).
  const hood = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, 0.16, L * 0.28), bodyMat);
  hood.position.set(0, dims.bodyY + dims.bodyH / 2 - 0.02, L * 0.32); hood.rotation.x = 0.08; hood.castShadow = true; g.add(hood);
  // Trunk: a short deck at the rear (-z).
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(W * 0.94, 0.14, L * 0.16), bodyMat);
  trunk.position.set(0, dims.bodyY + dims.bodyH / 2 - 0.03, -L * 0.38); trunk.castShadow = true; g.add(trunk);
  // Cabin: glasshouse with a roof, set back from the nose, with a
  // windscreen slope at the front and a rear window at the back.
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, dims.cabH, dims.cabLen), glassMat);
  cabin.position.set(0, dims.cabY, -L * 0.06); cabin.castShadow = true; g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.07, dims.cabLen * 0.82), bodyMat);
  roof.position.set(0, dims.cabY + dims.cabH / 2 + 0.02, -L * 0.06); roof.castShadow = true; g.add(roof);
  // Pillars: thin body-colour strips at the cabin corners so the glass
  // reads as windows, not a solid dark box.
  for (const sx of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.07, dims.cabH, 0.09), bodyMat);
    pillar.position.set(sx * W * 0.42, dims.cabY, L * 0.02); g.add(pillar);
    const pillarR = new THREE.Mesh(new THREE.BoxGeometry(0.07, dims.cabH, 0.09), bodyMat);
    pillarR.position.set(sx * W * 0.42, dims.cabY, -L * 0.16); g.add(pillarR);
  }
  // Wheels: four tyres with hubs, at the corners, slightly tucked in.
  const wheelZ = L * 0.32, wheelX = W / 2 - 0.08;
  for (const [wx, wz] of [[-wheelX, wheelZ], [wheelX, wheelZ], [-wheelX, -wheelZ], [wheelX, -wheelZ]]) {
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(dims.wheelR, dims.wheelR, 0.22, 18), tyreMat);
    tyre.rotation.z = Math.PI / 2; tyre.position.set(wx, dims.wheelR, wz); tyre.castShadow = true; g.add(tyre);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(dims.wheelR * 0.55, dims.wheelR * 0.55, 0.24, 12), hubMat);
    hub.rotation.z = Math.PI / 2; hub.position.set(wx, dims.wheelR, wz); g.add(hub);
  }
  // Headlights: two bright lenses at the front, with a grille between.
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.06), lightMat);
    hl.position.set(sx * W * 0.32, dims.bodyY + 0.12, L / 2 + 0.01); g.add(hl);
  }
  const grille = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, 0.16, 0.05), trimMat);
  grille.position.set(0, dims.bodyY + 0.02, L / 2 + 0.01); g.add(grille);
  // Front bumper and rear bumper.
  const bumpF = new THREE.Mesh(new THREE.BoxGeometry(W * 0.98, 0.18, 0.1), trimMat);
  bumpF.position.set(0, dims.bodyY - dims.bodyH / 2 + 0.08, L / 2 + 0.02); g.add(bumpF);
  const bumpR = new THREE.Mesh(new THREE.BoxGeometry(W * 0.98, 0.18, 0.1), trimMat);
  bumpR.position.set(0, dims.bodyY - dims.bodyH / 2 + 0.08, -L / 2 - 0.02); g.add(bumpR);
  // Taillights: two red lenses at the rear.
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xd81f2a });
  for (const sx of [-1, 1]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.06), tailMat);
    tl.position.set(sx * W * 0.32, dims.bodyY + 0.12, -L / 2 - 0.01); g.add(tl);
  }
  // Side mirrors.
  for (const sx of [-1, 1]) {
    const mir = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.16), bodyMat);
    mir.position.set(sx * (W / 2 + 0.05), dims.cabY - 0.05, L * 0.12); g.add(mir);
  }
  // A chrome strip along the side, and a licence plate at the rear.
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, L * 0.7), chromeMat);
  strip.position.set(W / 2 + 0.01, dims.bodyY + 0.05, 0); g.add(strip);
  const strip2 = strip.clone(); strip2.position.x = -W / 2 - 0.01; g.add(strip2);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.03), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }));
  plate.position.set(0, dims.bodyY - 0.05, -L / 2 - 0.04); g.add(plate);
  g.traverse(oo => { oo.userData.keepAlive = true; });
  return g;
}
// The player's car in his equipped colour and type, with the driver
// (player avatar) seated inside. The car faces +z; rotate the group by
// PI to face -z (the driving direction on the travel road).
export function buildPlayerCar() {
  const def = getEquippedCarDef();
  let type = 'sedan';
  if (def && def.id === 'bmw-x5') type = 'suv';
  else if (def && (def.id === 'bmw-m4' || def.id === 'coupe')) type = 'coupe';
  let hex = 0x9aa5ad;
  try { if (def && def.color) hex = new THREE.Color(def.color).getHex(); } catch (e) { /* keep default */ }
  const car = buildCar(hex, { type });
  car.userData.carName = def ? def.name : 'City Sedan';
  car.userData.carDef = def;
  return car;
}

// ---------- Door keys ----------
// Keys the player picks up, kept in localStorage so a key is never lost
// on a reload. A locked door shows which key it needs; the key for a
// door is always findable before the door is needed, so the player can
// never get permanently stuck.
const KEYS_KEY = 'lastSignalKeys';
function readKeys() {
  try {
    const v = JSON.parse(localStorage.getItem(KEYS_KEY) || 'null');
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
function writeKeys(list) {
  try { localStorage.setItem(KEYS_KEY, JSON.stringify(list)); } catch (e) { /* private mode */ }
}
export function hasKey(id) { return readKeys().indexOf(id) !== -1; }
export function giveKey(id, label) {
  const list = readKeys();
  if (list.indexOf(id) !== -1) return false;
  list.push(id);
  writeKeys(list);
  playerToast('Picked up: ' + (label || id) + '.');
  return true;
}
export function keyCount() { return readKeys().length; }
export function clearKeys() { writeKeys([]); }
// A small toast on the shared #toast element (index.html), used by the
// player module so it does not depend on any one act's toast function.
export function playerToast(msg) {
  try {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.style.opacity = '1';
    if (playerToast._timer) clearTimeout(playerToast._timer);
    playerToast._timer = setTimeout(() => { t.style.opacity = '0'; }, 3200);
  } catch (e) { /* ignore */ }
}

// ---------- Init ----------
// Builds the touch controls and the HUD buttons (Restart, Camera), sets
// the default camera mode (third-person on touch, first-person on
// desktop), and wires the Restart button. Called once from acts.js at
// boot. Safe to call twice.
let playerInitDone = false;
export function initPlayer() {
  if (playerInitDone) return;
  playerInitDone = true;
  try { buildTouchControls(); } catch (e) { /* touch UI is optional */ }
  // Restart button: clears the same progress saves as ?fresh and reloads
  // to the prologue (Act I start), so a player stuck on Act II can start
  // from the beginning without remembering a URL.
  try {
    const rb = document.getElementById('restartBtn');
    if (rb) rb.onclick = () => {
      if (!window.confirm('Start again from the beginning? This clears your act progress, money and keys.')) return;
      for (const k of ['lastSignalPrologue', 'lastSignalAct1', 'lastSignalAct2', 'lastSignalAct3', 'lastSignalMoney', 'lastSignalPaid', 'lastSignalOwned', 'lastSignalEquipped', 'lastSignalCurrentAct', 'lastSignalAct2Mission', KEYS_KEY]) {
        try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
      }
      location.href = 'index.html?fresh';
    };
  } catch (e) { /* optional */ }
  try {
    const cb = document.getElementById('camBtn');
    if (cb) cb.onclick = () => toggleThirdPerson();
  } catch (e) { /* optional */ }
  try { setThirdPerson(isTouchDevice()); } catch (e) { /* ignore */ }
  try { setZoom(4); } catch (e) { /* ignore */ }
}
