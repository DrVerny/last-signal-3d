// THE LAST SIGNAL - player presence: third-person avatar, touch controls,
// realistic cars, door keys. Shared by all acts and the homes, so
// the player sees himself the same way everywhere. No wallet needed;
// demo mode works with no wallet connected. The avatar is built from
// primitives (always available, no async load) and wears the equipped
// outfit colour and cap from the store.
import * as THREE from 'three';
import { getEquipped, getEquippedCarDef, ITEM_BY_ID } from './economy.js';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';

// Real vehicle model (CC0, Quaternius sports car via Poly Pizza, see
// models/vehicles/SOURCES.md): the BMW M4 is built from this real model
// when it has loaded, so it looks like a real car, not a box. The model
// loads once at import time; until it arrives (or if it fails) the
// procedural M4 below is used, so the game never waits on a download.
let sportsCarScene = null;
let sportsCarReady = false;
const sportsCarPromise = new Promise((resolve) => {
  try {
    const loader = new GLTFLoader();
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('sports car timed out')), 30000));
    Promise.race([loader.loadAsync('models/vehicles/sports-car.glb'), timeout])
      .then(gltf => { sportsCarScene = gltf.scene; sportsCarReady = true; resolve(true); })
      .catch(() => resolve(false));
  } catch (e) { resolve(false); }
});
export function sportsCarReadyNow() { return sportsCarReady; }

// ---------- Third-person camera ----------
// First-person is the camera at the player's eyes. Third-person puts the
// camera behind and above a visible player avatar, so the player sees
// himself walk, drive and sleep. Default is third-person on touch
// devices (no keyboard, the avatar shows where you are) and first-person
// on desktop. The toggle is always available (C key or the Camera button).
let thirdPerson = false;
// The third-person camera sits at a fixed 4 m behind the avatar. There
// used to be a zoom in/out (buttons, mouse wheel, pinch) from 2 m to
// 8 m, but the user asked for it removed: zoomed all the way in the
// player filled the screen, and zoomed all the way out the camera rose
// above the train roof and the characters' heads poked out through it.
// The camera stays at 4 m now, close enough to see the player, far
// enough to stay inside the train.
const zoomDist = 4;
export function isThirdPerson() { return thirdPerson; }
export function getZoom() { return zoomDist; }
export function setThirdPerson(on) {
  thirdPerson = !!on;
  // Remember the choice, so it survives a reload and the next act: the
  // player wants to see himself, and the old code reset the camera to
  // first-person on desktop every time the page loaded.
  try { localStorage.setItem('lastSignalCamera3rd', thirdPerson ? '1' : '0'); } catch (e) { /* ignore */ }
  try { const b = document.getElementById('camBtn'); if (b) b.textContent = thirdPerson ? 'Camera: 3rd (C)' : 'Camera: 1st (C)'; } catch (e) { /* no button yet */ }
  try { const b = document.getElementById('touchCamBtn'); if (b) b.textContent = thirdPerson ? '3rd' : '1st'; } catch (e) { /* no touch button yet */ }
}
// The camera mode to start with: the saved choice if there is one, else
// third-person. The player wants to see himself walk, drive and sleep,
// so third-person is the default on every device, not first-person on
// desktop.
function cameraModeDefault() {
  try {
    const saved = localStorage.getItem('lastSignalCamera3rd');
    if (saved === '1') return true;
    if (saved === '0') return false;
  } catch (e) { /* ignore */ }
  return true;
}
export function toggleThirdPerson() { setThirdPerson(!thirdPerson); }
export function isTouchDevice() {
  try {
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) return true;
    if (typeof window !== 'undefined' && ('ontouchstart' in window)) return true;
  } catch (e) { /* ignore */ }
  return false;
}

// ---------- Player avatar ----------
// The player is a realistic rigged young man (Quaternius "Casual Male",
// models/rigged/player-rigged.glb, CC0, 23-joint rig with Walk and Idle
// clips), not the old boxy figure. The model loads asynchronously with
// a 30-second timeout; until it arrives (or if it fails) a procedural
// fallback figure stands in, so the game never hangs and the avatar is
// never missing. The outer group is stable: getAvatar() returns it
// immediately, and the rig (or the fallback) lives inside it, so every
// caller (home, acts, driving) keeps working unchanged. The rig has
// separate materials per part, so the shirt is tinted with the equipped
// clothes colour and the skin with a realistic brown tone. The raw
// file's Skin is near-black and its Face near-white (the pack's
// placeholder colours), so both are recoloured on load.
const PLAYER_MODEL = 'models/rigged/player-rigged.glb';
const PLAYER_HEIGHT = 1.24; // target standing height in metres (4 feet 1 inch)
const PLAYER_SKIN = 0x6b4a2f; // warm medium-dark brown skin
let avatar = null;
let avatarParts = null; // procedural fallback parts (null once rigged)
let avatarPose = 'stand';
let avatarWalkPhase = 0;
let avatarScene = null;
let avatarRigged = false; // true once the rigged model replaced the fallback
let avatarRigLoadStarted = false;
let avatarRig = null; // the loaded rig group (child of avatar)
let avatarFallback = null; // the procedural fallback group (child of avatar)
let avatarMixer = null;
let avatarWalkAction = null;
let avatarIdleAction = null;
let avatarMoveAction = null; // 'walk' | 'idle' | null
let avatarRootBone = null;
let avatarRootRest = null;
let avatarBones = null; // Map of bone name -> bone
let avatarRestQuats = null; // Map of bone -> rest quaternion
let avatarShirtMat = null; // the rig's shirt material, for re-tinting
// White sneakers on the rigged model, measured in Node from the model
// file in the Idle pose (rig-local units). The foot bones sit at the
// ankles: FootL (0.205, 0.016, -0.180), FootR (-0.108, 0.016, -0.180).
// The visible foot is a small dark patch centred at (0.207, 0.020,
// -0.169) on the left and (-0.110, 0.020, -0.169) on the right, with
// its sole at y -0.008, and the face (and toes) point to +Z. The shoe
// is centred on the foot, its sole on the ground, its toe forward.
// The sneakers are children of the rig, NOT of the foot bones: the
// foot bones' local frames point in different directions (the bind
// pose is mid-stride), so a bone-local offset put the old shoes inside
// the leg or underground. Each frame the shoe follows its foot bone by
// the bone's movement since the Idle pose (see updateSneakers).
const SNEAKER_IDLE_BONE = { FootL: [0.205, 0.016, -0.180], FootR: [-0.108, 0.016, -0.180] };
const SNEAKER_BIND_POS = { FootL: [0.207, 0.032, -0.129], FootR: [-0.110, 0.032, -0.129] };
let avatarSneakers = null; // [{ bone, group, bindBone, bindPos }] once rigged
let lastShoeStatus = 0; // TEMP DIAGNOSTIC: last time the shoe status line was refreshed
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
// Re-tint the player's outfit with the currently equipped clothes
// colour (call after buying or equipping in the store). The rig's
// Shirt material is tinted; the fallback's jacket, trousers and shoes
// are tinted. The designer outfit also carries a trouser and shoe
// colour on its store item; other outfits keep the defaults.
export function refreshPlayerOutfit() {
  try {
    const col = outfitColor();
    if (avatarRigged && avatarShirtMat) { avatarShirtMat.color.copy(col); return; }
    if (avatarParts && avatarParts.jacketMat) avatarParts.jacketMat.color.copy(col);
    let item = null;
    try { const eq = getEquipped(); if (eq && eq.clothes) item = ITEM_BY_ID[eq.clothes] || null; } catch (e) { item = null; }
    if (avatarParts && avatarParts.pantsMat) avatarParts.pantsMat.color.setHex(item && item.pants ? parseInt(item.pants.slice(1), 16) : 0x2a2f38);
    if (avatarParts && avatarParts.shoeMat) avatarParts.shoeMat.color.setHex(item && item.shoes ? parseInt(item.shoes.slice(1), 16) : 0xf2f2f2);
  } catch (e) { /* ignore */ }
}
// The procedural fallback figure (the old boxy avatar), used only until
// the rigged model loads, or permanently if it never does. Same size and
// same poses as before, so nothing that uses the avatar can tell.
function buildFallbackAvatar() {
  const skin = 0xc9a186, hairC = 0x2a2018, pants = 0x2a2f38, shoe = 0xf2f2f2, sole = 0x1a1a1a;
  const jacket = outfitColor();
  const g = new THREE.Group();
  g.userData.keepAlive = true;
  const skinMat = avMat(skin, 0.8), hairMat = avMat(hairC, 0.95), pantsMat = avMat(pants, 0.9), shoeMat = avMat(shoe, 0.7), soleMat = avMat(sole, 0.6);
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
    // Shoes: clean white sneakers with a dark sole, big enough to read
    // clearly from behind and in third person. Both parts hang off the
    // knee group like the old foot did, so the walk still moves them.
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.32), shoeMat);
    shoe.position.set(0, -0.43, 0.05); shoe.castShadow = true; knee.add(shoe);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.32), soleMat);
    sole.position.set(0, -0.48, 0.05); sole.castShadow = true; knee.add(sole);
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
  // Scale the whole fallback to the player's height (1.24 m, 4 feet 1
  // inch). As built it is about 1.95 m tall (hair top), so a uniform
  // scale brings the head down to 1.24 m and the feet stay on the
  // ground. Poses still work: they only rotate the pivots.
  g.scale.setScalar(PLAYER_HEIGHT / 1.95);
  return { group: g, parts: { legL, legR, armL, armR, headGroup, torso, capMesh, jacketMat, pantsMat, shoeMat } };
}

export function buildPlayerAvatar() {
  if (avatar) return avatar;
  const g = new THREE.Group();
  g.userData.keepAlive = true;
  const fb = buildFallbackAvatar();
  g.add(fb.group);
  avatar = g;
  avatarFallback = fb.group;
  avatarParts = fb.parts;
  avatarPose = 'stand';
  if (!avatarRigLoadStarted) { avatarRigLoadStarted = true; loadPlayerRig(); }
  return avatar;
}

// Load the rigged young man. Recolours skin/face and the shirt, scales
// him to the player's height, re-grounds his feet, sets up the Walk
// and Idle clips, then swaps the fallback for the rig. Any failure
// leaves the fallback in place, so the game never hangs.
async function loadPlayerRig() {
  try {
    const loader = new GLTFLoader();
    const gltf = await Promise.race([
      loader.loadAsync(PLAYER_MODEL),
      new Promise((_, reject) => setTimeout(() => reject(new Error('player model timed out after 30s')), 30000))
    ]);
    const rig = gltf.scene;
    rig.userData.keepAlive = true;
    rig.traverse(o => { o.userData.keepAlive = true; });
    // Recolour: skin and face to the player's skin tone, shirt to the
    // equipped clothes colour. The raw file's Skin is near-black and
    // its Face near-white, so without this the player would be a black
    // silhouette with a white face. Materials are cloned so the source
    // file is never mutated; the shirt clone is kept for re-tinting.
    const matByName = {};
    rig.traverse(o => {
      if (o.isMesh && o.material && o.material.name && !matByName[o.material.name]) matByName[o.material.name] = o.material;
    });
    const tint = (names, colour) => {
      for (const n of names) {
        if (!matByName[n]) continue;
        const m = matByName[n].clone();
        m.color.setHex(colour);
        rig.traverse(o => { if (o.isMesh && o.material && o.material.name === n) o.material = m; });
        if (n === 'Shirt') avatarShirtMat = m;
      }
    };
    tint(['Skin', 'Face'], PLAYER_SKIN);
    tint(['Shirt'], outfitColor().getHex());
    rig.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // The Casual Male model has an oversized head: its Hair is wider than
    // its shoulders and its Face is far wider than a real face, so from
    // behind it reads as a wide flat brown disc about twice normal width.
    // Shrink the head bone before the height is normalised, so the
    // normalisation measures the corrected head.
    rig.traverse(o => { if (o.isBone && o.name === 'Head') o.scale.setScalar(0.3); });
    // Every clip carries a scale track for the Head bone, so the mixer
    // would write the Head scale back to 1 every frame and undo the
    // shrink. Strip the Head scale track from every clip so the 0.3 stays.
    for (const clip of (gltf.animations || [])) {
      clip.tracks = clip.tracks.filter(t => t.name !== 'Head.scale');
    }
    // Normalise height to the player's height, then re-ground the feet.
    // The scale lives on the INNER rig group, never on the outer avatar
    // group: the drive code sets the outer group's scale to 0.72 to seat
    // the driver in the car and back to 1 after, and that must keep
    // working exactly as before.
    // Measure the height from the raw geometry, NOT from
    // Box3.setFromObject: for a skinned mesh that measures the skinned
    // bounds, which collapse to 0.74 at load time while the bones are
    // unposed, while the real geometry is 3.33 tall. Using the 0.74
    // made the scale 1.24 / 0.74 = 1.68, so the model rendered about
    // 5.6 m tall with its head through the ceiling. The raw geometry
    // bounds are stable and give the true height.
    rig.updateMatrixWorld(true);
    let minY = Infinity, maxY = -Infinity;
    const _gb = new THREE.Box3();
    rig.traverse(o => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      _gb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      if (_gb.min.y < minY) minY = _gb.min.y;
      if (_gb.max.y > maxY) maxY = _gb.max.y;
    });
    let s = 1;
    const geomH = (maxY > minY) ? (maxY - minY) : 0;
    if (geomH > 0) s = PLAYER_HEIGHT / geomH;
    rig.scale.setScalar(s);
    rig.position.y = -minY * s;
    // Bones, mixer and clips. The root bone's rest position is kept so
    // the Walk clip's root motion cannot slide the avatar across the
    // floor (the clip moves the root forward as it walks).
    const bones = new Map();
    rig.traverse(o => { if (o.isBone) bones.set(o.name, o); });
    const restQuats = new Map();
    bones.forEach(b => restQuats.set(b, b.quaternion.clone()));
    let mixer = null, walkAction = null, idleAction = null, rootBone = null, rootRest = null;
    try {
      const walkClip = THREE.AnimationClip.findByName(gltf.animations || [], 'Walk');
      const idleClip = THREE.AnimationClip.findByName(gltf.animations || [], 'Idle');
      mixer = new THREE.AnimationMixer(rig);
      if (walkClip) walkAction = mixer.clipAction(walkClip);
      if (idleClip) idleAction = mixer.clipAction(idleClip);
      rootBone = bones.get('Bone') || bones.get('Root') || null;
      if (!rootBone) { for (const b of bones.values()) { rootBone = b; break; } }
      if (rootBone) rootRest = rootBone.position.clone();
    } catch (e) { mixer = null; walkAction = null; idleAction = null; }
    // A soft blob shadow under the feet, like the fallback had.
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; shadow.userData.keepAlive = true; rig.add(shadow);
    // Cap, if the cap accessory is equipped: on top of the head.
    // headTop stays PLAYER_HEIGHT: the hair bounding box is measured
    // from the bind-pose geometry and does not account for the head
    // bone scale, so it would overestimate the head top and the cap
    // would float above the head. The top of the normalised model is
    // the hair top, so PLAYER_HEIGHT is the head top.
    let headTop = PLAYER_HEIGHT;
    if (hasCapEquipped()) {
      try {
        const cap = new THREE.Group();
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.135, 0.08, 16), avMat(0x2e4a6b, 0.85));
        crown.position.y = 0.04; cap.add(crown);
        const brim = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.12), avMat(0x2e4a6b, 0.85));
        brim.position.set(0, 0.01, 0.14); cap.add(brim);
        // headTop is in outer-group space; the cap is a child of the
        // rig, so convert it to rig-local space (undo the rig's scale
        // and re-ground offset) so it sits on the head, not above it.
        cap.position.set(0, (headTop - rig.position.y) / s - 0.03 / s, 0.02 / s);
        cap.userData.keepAlive = true;
        rig.add(cap);
      } catch (e) { /* no cap */ }
    }
    // Swap the fallback for the rig, keeping the outer group (and its
    // position, rotation and scale) exactly as it was.
    const outer = avatar;
    if (!outer) return;
    if (avatarFallback && avatarFallback.parent === outer) {
      try { outer.remove(avatarFallback); } catch (e) { /* ignore */ }
      try {
        avatarFallback.traverse(m => {
          try { if (m.geometry) m.geometry.dispose(); } catch (e) { /* ignore */ }
          try {
            const mats = Array.isArray(m.material) ? m.material : (m.material ? [m.material] : []);
            for (const mm of mats) { try { mm.dispose(); } catch (e) { /* ignore */ } }
          } catch (e) { /* ignore */ }
        });
      } catch (e) { /* ignore */ }
      avatarFallback = null;
    }
    outer.add(rig);
    avatarRig = rig;
    avatarMixer = mixer; avatarWalkAction = walkAction; avatarIdleAction = idleAction;
    avatarRootBone = rootBone; avatarRootRest = rootRest;
    avatarBones = bones; avatarRestQuats = restQuats;
    avatarRigged = true;
    avatarParts = null;
    // White sneakers on the rigged model: the model's own shoes are dark,
    // so from behind the feet read as dark. The sneakers are children of
    // the rig, NOT of the foot bones (see SNEAKER_IDLE_BONE above for
    // why). Each sneaker is placed in rig-local space from the measured
    // Idle-pose foot position, with its sole on the ground and its toe
    // forward, and it follows its foot bone every frame (updateSneakers).
    avatarSneakers = [];
    const shoeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const soleMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    for (const boneName of ['FootL', 'FootR']) {
      const foot = bones.get(boneName);
      if (!foot) continue;
      const group = new THREE.Group();
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.15, 0.50), shoeMat);
      shoe.castShadow = true; shoe.receiveShadow = true;
      group.add(shoe);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.03, 0.50), soleMat);
      sole.position.y = -0.06;
      sole.castShadow = true;
      group.add(sole);
      const bindPos = SNEAKER_BIND_POS[boneName];
      group.position.set(bindPos[0], bindPos[1], bindPos[2]);
      group.userData.keepAlive = true;
      rig.add(group);
      const bindBone = SNEAKER_IDLE_BONE[boneName];
      avatarSneakers.push({ bone: foot, group, bindBone: new THREE.Vector3(bindBone[0], bindBone[1], bindBone[2]), bindPos: new THREE.Vector3(bindPos[0], bindPos[1], bindPos[2]) });
    }
    // TEMP DIAGNOSTIC: report sneaker count and world positions on load.
    writeShoeStatus();
    // Re-apply the current pose on the rig (it may be lying or sitting).
    setAvatarPose(avatarPose);
  } catch (e) { try { console.error('Player rig failed to load, keeping the fallback:', e && e.message ? e.message : e); } catch (e2) { /* ignore */ } /* keep the fallback; the game never hangs on the avatar */ }
}

// Restore every rig bone to its rest rotation.
function restoreRiggedBones() {
  if (!avatarBones || !avatarRestQuats) return;
  avatarBones.forEach(b => {
    const q = avatarRestQuats.get(b);
    if (q) b.quaternion.copy(q);
  });
}

// Seat the rigged player: thighs forward, shins down, arms forward,
// like the seated crowd. Deltas are on top of the rest rotations, in
// degrees about each bone's local X axis (same numbers as Jade's seated
// pose in crowd.js; this rig is the male counterpart of hers).
function riggedSitPose() {
  if (!avatarBones || !avatarRestQuats) return;
  const deg = THREE.MathUtils.degToRad;
  const delta = (name, d) => {
    const bone = avatarBones.get(name);
    if (!bone) return;
    const rest = avatarRestQuats.get(bone);
    if (!rest) return;
    const dq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), deg(d));
    bone.quaternion.copy(rest).multiply(dq);
  };
  delta('UpperLegL', 70); delta('UpperLegR', 130);
  delta('LowerLegL', -70); delta('LowerLegR', -90);
  delta('ShoulderL', 45); delta('ShoulderR', 45);
  delta('LowerArmL', -55); delta('LowerArmR', -55);
  delta('Torso', -7);
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
  avatarPose = pose;
  if (avatarRigged && avatarRig) {
    // Rigged: stop any walk/idle so it cannot overwrite the pose.
    try { if (avatarMixer) avatarMixer.stopAllAction(); } catch (e) { /* ignore */ }
    avatarMoveAction = null;
    a.rotation.x = 0; a.rotation.z = 0;
    if (pose === 'lie') {
      // Lie flat on the back: rotate the group so the head (+y) points
      // to -z. The group's origin is at the feet, so place it at the
      // foot of the bed and the head lands on the pillow.
      a.rotation.x = -Math.PI / 2;
    } else if (pose === 'sit') {
      riggedSitPose();
      // The sit pose moves the feet, so re-seat the sneakers on them.
      updateSneakers();
    } else {
      // Stand: bones back to rest, then the Idle clip holds a natural
      // standing pose (never the bind T-pose). updateAvatarWalk swaps
      // to Walk when the player moves.
      restoreRiggedBones();
      try {
        if (avatarIdleAction) { avatarIdleAction.play(); avatarMoveAction = 'idle'; }
      } catch (e) { /* ignore */ }
    }
    return;
  }
  const p = avatarParts;
  if (!p) return;
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
// Keep the white sneakers on the feet: each sneaker is a child of the
// rig, so it does not follow the Walk animation by itself. After the
// mixer moves the bones, re-position each sneaker from its foot bone's
// current rig-local position, keeping the same offset it had in the
// Idle pose. The shoe stays flat (it never takes the bone's rotation),
// so it reads as a shoe even while the foot swings and lifts.
// The Y follow is damped to 0.75: measured in Node, the skinned foot
// mesh rises only about two-thirds as much as the foot bone during the
// swing (the foot rotates as it lifts), so following the bone's Y
// exactly would float the shoe about 1 cm above the foot mid-stride.
// TEMP DIAGNOSTIC: report the white sneakers' world positions on screen
// so the live check can see whether they are in the scene at all and
// where they are. Remove once the shoe visibility issue is solved.
function writeShoeStatus() {
  try {
    const el = document.getElementById('shoeStatus');
    if (!el) return;
    const fmt = v => '(' + v.x.toFixed(2) + ',' + v.y.toFixed(2) + ',' + v.z.toFixed(2) + ')';
    if (!avatarSneakers || !avatarRig) { el.textContent = 'Shoes: none (rig not loaded)'; return; }
    const v = new THREE.Vector3();
    const parts = avatarSneakers.map((s, i) => (i === 0 ? 'L=' : 'R=') + fmt(s.group.getWorldPosition(v)));
    avatarRig.getWorldPosition(v);
    el.textContent = 'Shoes: N=' + avatarSneakers.length + ' ' + parts.join(' ') + ' rig=' + fmt(v) + ' s=' + avatarRig.scale.x.toFixed(2);
  } catch (e) { /* diagnostic only, never break the game */ }
}

function updateSneakers() {
  if (!avatarSneakers || !avatarRig) return;
  const v = new THREE.Vector3();
  for (const s of avatarSneakers) {
    try {
      s.bone.getWorldPosition(v);
      avatarRig.worldToLocal(v);
      s.group.position.set(
        s.bindPos.x + (v.x - s.bindBone.x),
        s.bindPos.y + (v.y - s.bindBone.y) * 0.75,
        s.bindPos.z + (v.z - s.bindBone.z)
      );
    } catch (e) { /* ignore */ }
  }
}
// Walk: the rigged model plays its embedded Walk clip (feet stepping,
// not gliding) and Idle when still; the procedural fallback swings its
// limbs. Only runs while the avatar is standing/walking.
export function updateAvatarWalk(moving, dt) {
  if (avatarRigged && avatarRig) {
    if (avatarPose !== 'stand' || !avatarMixer) return;
    const d = dt || 0.016;
    try {
      const want = moving ? 'walk' : 'idle';
      if (avatarMoveAction !== want) {
        if (want === 'walk' && avatarWalkAction) {
          try { if (avatarIdleAction) avatarIdleAction.stop(); avatarWalkAction.play(); } catch (e) { /* ignore */ }
        } else if (want === 'idle' && avatarIdleAction) {
          try { if (avatarWalkAction) avatarWalkAction.stop(); avatarIdleAction.play(); } catch (e) { /* ignore */ }
        }
        avatarMoveAction = want;
      }
      avatarMixer.update(d);
      // The Walk clip moves the root bone forward as it walks; pin the
      // root back to its rest spot so the avatar walks in place and the
      // game (not the clip) moves him.
      if (avatarRootBone && avatarRootRest) {
        avatarRootBone.position.x = avatarRootRest.x;
        avatarRootBone.position.z = avatarRootRest.z;
      }
      // Sneakers follow the feet after the mixer and the root pin.
      updateSneakers();
      // TEMP DIAGNOSTIC: refresh the shoe positions once a second.
      const nowMs = performance.now();
      if (nowMs - lastShoeStatus > 1000) { lastShoeStatus = nowMs; writeShoeStatus(); }
    } catch (e) { /* ignore */ }
    return;
  }
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
  let camX = o.x + bx * dist;
  let camZ = o.z + bz * dist;
  // Keep the camera inside the room: in a small room like the valve
  // chamber the fixed 4 m distance would push the camera through the
  // wall when the player stands near it facing it. Clamp to the bounds
  // the caller passes (the same bounds the player walks in), inset a
  // little so the camera never sits exactly on the wall.
  if (o.camBounds && o.camBounds.x && o.camBounds.z) {
    camX = Math.max(o.camBounds.x[0] + 0.2, Math.min(o.camBounds.x[1] - 0.2, camX));
    camZ = Math.max(o.camBounds.z[0] + 0.2, Math.min(o.camBounds.z[1] - 0.2, camZ));
  }
  const camY = (o.eyeY || 1.7) + dist * 0.28;
  o.camera.position.set(camX, camY, camZ);
  o.camera.rotation.order = 'YXZ';
  // Look at the avatar's chest, slightly ahead so the view leads
  // forward. At 1.0 m the 1.24 m player is framed head to feet; the
  // old 1.45 m aim was tuned for a 1.75 m player and put the feet at
  // the bottom edge of the frame.
  const fx = -Math.sin(o.yaw), fz = -Math.cos(o.yaw);
  o.camera.lookAt(o.x + fx * 1.2, 1.0, o.z + fz * 1.2);
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
  // Camera toggle + pad toggle, bottom-right.
  const misc = document.createElement('div');
  misc.id = 'touchMisc';
  misc.innerHTML = '<button type="button" id="touchCamBtn">1st</button>'
    + '<button type="button" id="touchPadBtn">Keys</button>';
  document.body.appendChild(misc);
  document.getElementById('touchCamBtn').addEventListener('click', () => toggleThirdPerson());
  document.getElementById('touchPadBtn').addEventListener('click', () => setTouchVisible(!touchVisible));
  // Two fingers on the canvas: hold the look-drag still so a pinch never
  // spins the camera. There is no pinch zoom any more (the user asked for
  // zoom removed), so two fingers simply do nothing while they are down.
  const pinchPointers = new Map();
  function pinchOnCanvas(e) {
    return e.target && e.target.tagName === 'CANVAS';
  }
  addEventListener('pointerdown', (e) => {
    if (!pinchOnCanvas(e)) return;
    pinchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchPointers.size === 2) {
      // Keep the second finger from resetting the look-drag origin.
      e.stopPropagation();
    }
  }, true);
  addEventListener('pointermove', (e) => {
    if (!pinchPointers.has(e.pointerId)) return;
    const p = pinchPointers.get(e.pointerId);
    p.x = e.clientX; p.y = e.clientY;
    if (pinchPointers.size < 2) return;
    // Two fingers down: freeze the look-drag.
    e.stopPropagation();
  }, true);
  const pinchEnd = (e) => {
    if (!pinchPointers.has(e.pointerId)) return;
    pinchPointers.delete(e.pointerId);
  };
  addEventListener('pointerup', pinchEnd, true);
  addEventListener('pointercancel', pinchEnd, true);
  // C toggles first/third person everywhere.
  addEventListener('keydown', (e) => {
    if (e.key && e.key.toLowerCase() === 'c' && !e.repeat) {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      toggleThirdPerson();
    }
  });
  setTouchVisible(isTouchDevice());
  setThirdPerson(cameraModeDefault());
}
export function setTouchVisible(on) {
  touchVisible = !!on;
  try {
    const pad = document.getElementById('touchPad');
    if (pad) pad.style.display = touchVisible ? '' : 'none';
    const mc = document.getElementById('touchMisc');
    if (mc) mc.style.display = '';
  } catch (e) { /* ignore */ }
  try { const b = document.getElementById('touchPadBtn'); if (b) b.textContent = touchVisible ? 'Keys: on' : 'Keys'; } catch (e) { /* ignore */ }
}
export function isTouchVisible() { return touchVisible; }

// ---------- Realistic cars (procedural) ----------
// A car built from parts, not a single box: a shaped lower body with a
// hood, a cabin with glass windows, a roofline, four wheels with hubs,
// headlights, taillights, a grille and a bumper, and side mirrors.
// The car faces +z (front at +z); rotate the group by PI to face -z.
// type changes the proportions: 'sedan' (balanced), 'coupe' (low and
// long), 'suv' (tall, e.g. the BMW X5), 'van' (tall one-box van with
// blue-tinted windows). colour is a hex number.
// A sculpted body from a 2D side profile: draw the silhouette (length
// along x, height along y), extrude it across the width, and bevel the
// edges, so the body is a shaped panel with sloped sides and rounded
// edges, not a flat box. The profile runs rear (-x) to front (+x); the
// mesh is rotated so +x becomes the car's +z (front).
function extrudedBody(points, width, material, bevel) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const b = bevel === undefined ? 0.04 : bevel;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, steps: 1
  });
  geo.rotateY(-Math.PI / 2);
  geo.center();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  let minY = Infinity, maxY = -Infinity;
  for (const p of points) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  mesh.position.y = (minY + maxY) / 2;
  return mesh;
}
// Car paint: a clearcoat physical material, so the body reads as real
// metallic paint with a glossy coat, not flat plastic.
function paintMat(colorHex) {
  return new THREE.MeshPhysicalMaterial({ color: colorHex, metalness: 0.65, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12 });
}
// A realistic wheel: a tyre and a rim with five spokes and a hub, so the
// wheel reads as a real alloy wheel, not a plain disc.
function buildWheel(radius, width) {
  const g = new THREE.Group();
  const tyreMat = carMat(0x111111, 0.95, 0);
  const rimMat = carMat(0x9aa2a8, 0.3, 0.85);
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 20), tyreMat);
  tyre.rotation.z = Math.PI / 2; tyre.castShadow = true; g.add(tyre);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width + 0.02, 20), rimMat);
  rim.rotation.z = Math.PI / 2; g.add(rim);
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(width + 0.04, radius * 0.58, 0.09), rimMat);
    spoke.position.set(0, Math.cos(a) * radius * 0.3, Math.sin(a) * radius * 0.3);
    spoke.rotation.x = -a;
    g.add(spoke);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.16, radius * 0.16, width + 0.06, 10), carMat(0x1a1d20, 0.5, 0.6));
  hub.rotation.z = Math.PI / 2; g.add(hub);
  return g;
}
function carMat(color, roughness, metalness) {
  return new THREE.MeshStandardMaterial({ color, roughness: roughness === undefined ? 0.4 : roughness, metalness: metalness === undefined ? 0.5 : metalness });
}
// The BMW M4 built from the real Quaternius sports-car model (CC0):
// a proper car silhouette with a sloped hood, a curved roofline and
// separate wheels, repainted in the car's colour, with the windows made
// semi-transparent (so the driver shows through and the in-car camera
// can see out) and the M4 details added (kidney grille, spoiler, quad
// exhausts, mirrors, steering wheel and dashboard). The model faces +z
// (headlights at +z), the same as the procedural cars.
function buildModelM4(color) {
  const S = 1.12;
  const g = new THREE.Group();
  g.userData.keepAlive = true;
  const model = sportsCarScene.clone(true);
  model.scale.setScalar(S);
  const paint = paintMat(color);
  model.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      if (o.material && o.material.name === 'White') {
        o.material = paint;
      } else if (o.material && o.material.name === 'Windows') {
        const glass = o.material.clone();
        glass.transparent = true; glass.opacity = 0.5; glass.color.set(0x10181f);
        o.material = glass;
      } else if (o.material) {
        o.material = o.material.clone();
      }
    }
  });
  g.add(model);
  const trimMat = carMat(0x1a1d20, 0.6, 0.3);
  const chromeMat = carMat(0xc8ccd0, 0.25, 0.9);
  // Kidney grille: two tall dark kidneys with a chrome surround.
  for (const sx of [-1, 1]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.04), chromeMat);
    frame.position.set(sx * 0.14, 0.62, 2.14); g.add(frame);
    const kidney = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.05), trimMat);
    kidney.position.set(sx * 0.14, 0.62, 2.15); g.add(kidney);
  }
  // Rear spoiler lip and quad exhaust tips.
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.22), trimMat);
  spoiler.position.set(0, 0.95, -2.2); spoiler.rotation.x = -0.12; g.add(spoiler);
  for (const sx of [-1, 1]) for (const dx of [-0.09, 0.09]) {
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.12, 10), chromeMat);
    tip.rotation.x = Math.PI / 2; tip.position.set(sx * 0.55 + dx, 0.35, -2.28); g.add(tip);
  }
  // Side mirrors.
  for (const sx of [-1, 1]) {
    const mir = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.16), paint);
    mir.position.set(sx * 1.01, 1.0, 0.8); g.add(mir);
  }
  // Interior: dashboard, two front seats and a steering wheel on the
  // left, so the in-car view shows a real wheel and dash.
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.35), trimMat);
  dash.position.set(0, 0.95, 0.85); g.add(dash);
  for (const sx of [-1, 1]) {
    const seatBase = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.18, 0.48), trimMat);
    seatBase.position.set(sx * 0.38, 0.6, 0.0); g.add(seatBase);
    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.55, 0.14), trimMat);
    seatBack.position.set(sx * 0.38, 0.88, -0.25); g.add(seatBack);
  }
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.025, 8, 20), trimMat);
  wheel.add(rim);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), trimMat);
  column.rotation.x = Math.PI / 2 - 0.4; column.position.set(0, -0.02, -0.1); wheel.add(column);
  for (const a of [0.5, Math.PI - 0.5, -Math.PI / 2]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), trimMat);
    spoke.position.set(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0); spoke.rotation.z = a; wheel.add(spoke);
  }
  wheel.position.set(-0.38, 0.98, 0.62); wheel.rotation.x = -0.4; g.add(wheel);
  g.userData.steerPos = new THREE.Vector3(-0.38, 0.98, 0.62);
  g.userData.headPos = new THREE.Vector3(-0.38, 1.08, 0.35);
  g.traverse(oo => { oo.userData.keepAlive = true; });
  return g;
}
export function buildCar(colorHex, opts) {
  const o = opts || {};
  const type = o.type || 'sedan';
  const color = (colorHex === undefined || colorHex === null) ? 0x9aa5ad : colorHex;
  // The M4 uses the real model when it has loaded; until then the
  // procedural M4 below is used, so the game never waits on a download.
  if (type === 'm4' && sportsCarReady && sportsCarScene) return buildModelM4(color);
  const g = new THREE.Group();
  g.userData.keepAlive = true;
  const bodyMat = paintMat(color);
  // A van has blue-tinted windows; other cars keep dark glass.
  const glassMat = new THREE.MeshStandardMaterial({ color: type === 'van' ? 0x2f6fb5 : 0x10181f, roughness: 0.15, metalness: 0.7, transparent: true, opacity: 0.55 });
  const trimMat = carMat(0x1a1d20, 0.6, 0.3);
  const chromeMat = carMat(0xc8ccd0, 0.25, 0.9);
  // Proportions by type (length along z, width along x). cabZ is where
  // the cabin sits along the car: near the middle for a sedan, at the
  // front for a pickup truck (the bed is behind it), centred for a bus.
  const dims = type === 'van'
    ? { len: 4.9, wid: 2.0, bodyH: 1.05, bodyY: 0.85, cabLen: 3.6, cabY: 1.55, cabH: 0.7, cabZ: -0.29, wheelR: 0.38 }
    : type === 'suv'
    ? { len: 4.6, wid: 1.95, bodyH: 0.75, bodyY: 0.62, cabLen: 2.6, cabY: 1.25, cabH: 0.62, cabZ: -0.28, wheelR: 0.38 }
    : type === 'm4'
    ? { len: 4.7, wid: 1.9, bodyH: 0.52, bodyY: 0.5, cabLen: 2.1, cabY: 1.02, cabH: 0.46, cabZ: -0.28, wheelR: 0.34 }
    : type === 'coupe'
    ? { len: 4.5, wid: 1.85, bodyH: 0.5, bodyY: 0.5, cabLen: 2.0, cabY: 1.0, cabH: 0.45, cabZ: -0.27, wheelR: 0.33 }
    : type === 'taxi'
    ? { len: 4.4, wid: 1.85, bodyH: 0.55, bodyY: 0.55, cabLen: 2.2, cabY: 1.08, cabH: 0.5, cabZ: -0.26, wheelR: 0.34 }
    : type === 'truck'
    ? { len: 5.2, wid: 2.0, bodyH: 0.65, bodyY: 0.62, cabLen: 1.7, cabY: 1.2, cabH: 0.6, cabZ: 1.15, wheelR: 0.4 }
    : type === 'bus'
    ? { len: 7.6, wid: 2.45, bodyH: 0.95, bodyY: 0.85, cabLen: 6.2, cabY: 1.6, cabH: 0.85, cabZ: 0, wheelR: 0.42 }
    : type === 'hatchback'
    ? { len: 3.9, wid: 1.8, bodyH: 0.55, bodyY: 0.55, cabLen: 2.3, cabY: 1.05, cabH: 0.48, cabZ: -0.15, wheelR: 0.33 }
    : { len: 4.4, wid: 1.85, bodyH: 0.55, bodyY: 0.55, cabLen: 2.2, cabY: 1.08, cabH: 0.5, cabZ: -0.26, wheelR: 0.34 };
  const L = dims.len, W = dims.wid;
  // Lower body: the M4, the coupe and the van are built from an extruded
  // side profile (a sculpted silhouette with a sloped hood/nose and
  // rounded bevelled edges), not a flat box. Sedans and SUVs keep the
  // box body, since they are background traffic.
  if (type === 'm4' || type === 'coupe' || type === 'van') {
    const hl = L / 2;
    const profile = type === 'van'
      ? [[-hl, 0.32], [-hl, 1.18], [hl * 0.62, 1.18], [hl * 0.82, 0.88], [hl * 0.94, 0.72], [hl, 0.48], [hl * 0.98, 0.32]]
      : type === 'm4'
      ? [[-hl, 0.32], [-hl, 0.80], [-hl * 0.68, 0.86], [-hl * 0.34, 0.88], [hl * 0.34, 0.88], [hl * 0.68, 0.79], [hl * 0.97, 0.67], [hl, 0.45], [hl * 0.98, 0.32]]
      : [[-hl, 0.32], [-hl, 0.78], [-hl * 0.68, 0.84], [-hl * 0.34, 0.86], [hl * 0.34, 0.86], [hl * 0.68, 0.77], [hl * 0.97, 0.65], [hl, 0.45], [hl * 0.98, 0.32]];
    g.add(extrudedBody(profile, W * 0.96, bodyMat, 0.05));
  } else {
    // Lower body: a long box with a slightly narrower hood section at
    // the front, so the silhouette reads as a car, not a slab.
    const lower = new THREE.Mesh(new THREE.BoxGeometry(W, dims.bodyH, L), bodyMat);
    lower.position.y = dims.bodyY; lower.castShadow = true; g.add(lower);
    // Hood: a lower, sloping panel at the front (+z).
    const hoodLen = L * 0.28;
    const hoodZ = L * 0.32;
    const hood = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, 0.16, hoodLen), bodyMat);
    hood.position.set(0, dims.bodyY + dims.bodyH / 2 - 0.02, hoodZ); hood.rotation.x = 0.08; hood.castShadow = true; g.add(hood);
    // Trunk: a short deck at the rear (-z). A pickup truck has no trunk:
    // it has an open bed instead, added below.
    if (type !== 'truck') {
      const trunk = new THREE.Mesh(new THREE.BoxGeometry(W * 0.94, 0.14, L * 0.16), bodyMat);
      trunk.position.set(0, dims.bodyY + dims.bodyH / 2 - 0.03, -L * 0.38); trunk.castShadow = true; g.add(trunk);
    }
  }
  // A pickup truck's open bed: a floor and low walls behind the cab, so
  // the rear reads as a truck bed, not a sedan trunk.
  if (type === 'truck') {
    const bedFloor = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 0.06, L * 0.5), trimMat);
    bedFloor.position.set(0, dims.bodyY + dims.bodyH / 2 - 0.05, -L * 0.28); g.add(bedFloor);
    for (const sx of [-1, 1]) {
      const bedWall = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, L * 0.5), bodyMat);
      bedWall.position.set(sx * (W / 2 - 0.03), dims.bodyY + dims.bodyH / 2 + 0.18, -L * 0.28); g.add(bedWall);
    }
    const tailgate = new THREE.Mesh(new THREE.BoxGeometry(W * 0.94, 0.45, 0.06), bodyMat);
    tailgate.position.set(0, dims.bodyY + dims.bodyH / 2 + 0.18, -L * 0.52); g.add(tailgate);
  }
  // A taxi's roof sign, and a bus's destination sign, so each reads as
  // its own kind of vehicle at a glance.
  if (type === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.28), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
    sign.position.set(0, dims.cabY + dims.cabH / 2 + 0.1, dims.cabZ); g.add(sign);
  }
  if (type === 'bus') {
    const dest = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 0.06), new THREE.MeshBasicMaterial({ color: 0x1a2a3a }));
    dest.position.set(0, dims.cabY + 0.2, L / 2 - 0.05); g.add(dest);
  }
  // M4 power dome: a raised centre ridge on the long sculpted hood, so
  // the nose reads as a BMW M4, not a flat slab.
  if (type === 'm4') {
    const dome = new THREE.Mesh(new THREE.BoxGeometry(W * 0.34, 0.1, L * 0.24), bodyMat);
    dome.position.set(0, 0.85, L * 0.32); dome.rotation.x = 0.08; dome.castShadow = true; g.add(dome);
  }
  // Cabin: glasshouse with a roof, set back from the nose, with a
  // windscreen slope at the front and a rear window at the back. The
  // cabin sits at cabZ: mid-car for a sedan, at the front for a truck.
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, dims.cabH, dims.cabLen), glassMat);
  cabin.position.set(0, dims.cabY, dims.cabZ); cabin.castShadow = true; g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.07, dims.cabLen * 0.82), bodyMat);
  roof.position.set(0, dims.cabY + dims.cabH / 2 + 0.02, dims.cabZ); roof.castShadow = true; g.add(roof);
  // Pillars: thin body-colour strips at the cabin corners so the glass
  // reads as windows, not a solid dark box.
  for (const sx of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.07, dims.cabH, 0.09), bodyMat);
    pillar.position.set(sx * W * 0.42, dims.cabY, dims.cabZ + dims.cabLen * 0.38); g.add(pillar);
    const pillarR = new THREE.Mesh(new THREE.BoxGeometry(0.07, dims.cabH, 0.09), bodyMat);
    pillarR.position.set(sx * W * 0.42, dims.cabY, dims.cabZ - dims.cabLen * 0.38); g.add(pillarR);
  }
  // A van's cabin is long, so one more pillar pair at the back divides
  // the side glass into two windows.
  if (type === 'van') {
    for (const sx of [-1, 1]) {
      const pillarB = new THREE.Mesh(new THREE.BoxGeometry(0.07, dims.cabH, 0.09), bodyMat);
      pillarB.position.set(sx * W * 0.42, dims.cabY, -L * 0.3); g.add(pillarB);
    }
    // Sliding door outline and handles on both sides, so the van reads
    // as a real van with a side door, not a plain box.
    const doorMat = carMat(0x5a5f63, 0.5, 0.4);
    for (const sx of [-1, 1]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.5, 1.15), doorMat);
      door.position.set(sx * (W / 2 + 0.005), 1.05, 0.35); g.add(door);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.22), chromeMat);
      handle.position.set(sx * (W / 2 + 0.02), 1.25, 0.85); g.add(handle);
      const slideHandle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.22), chromeMat);
      slideHandle.position.set(sx * (W / 2 + 0.02), 1.25, -0.15); g.add(slideHandle);
    }
    // Roof rails, so the tall van roof has a finished edge.
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, L * 0.7), trimMat);
      rail.position.set(sx * W * 0.36, dims.cabY + dims.cabH / 2 + 0.08, -L * 0.05); g.add(rail);
    }
  }
  // Wheels: four alloy wheels (tyre, rim, spokes, hub) at the corners,
  // slightly tucked in.
  const wheelZ = L * 0.32, wheelX = W / 2 - 0.08;
  for (const [wx, wz] of [[-wheelX, wheelZ], [wheelX, wheelZ], [-wheelX, -wheelZ], [wheelX, -wheelZ]]) {
    const wheel = buildWheel(dims.wheelR, 0.22);
    wheel.position.set(wx, dims.wheelR, wz);
    g.add(wheel);
  }
  // Headlights: two bright lenses at the front, with a grille between.
  // The M4 gets sharp swept headlights (angled back at the outer edge)
  // and the BMW kidney grille: two tall dark kidneys with a chrome
  // surround, instead of one wide bar.
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(type === 'm4' ? 0.5 : 0.42, 0.14, 0.06), lightMat);
    hl.position.set(sx * W * 0.32, dims.bodyY + 0.12, L / 2 + 0.01);
    if (type === 'm4') hl.rotation.y = -sx * 0.28;
    g.add(hl);
  }
  if (type === 'm4') {
    for (const sx of [-1, 1]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.04), chromeMat);
      frame.position.set(sx * 0.14, dims.bodyY + 0.04, L / 2 + 0.01); g.add(frame);
      const kidney = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.05), trimMat);
      kidney.position.set(sx * 0.14, dims.bodyY + 0.04, L / 2 + 0.02); g.add(kidney);
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.05), trimMat);
      intake.position.set(sx * W * 0.36, dims.bodyY - dims.bodyH / 2 + 0.12, L / 2 + 0.01); g.add(intake);
    }
  } else {
    const grille = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, 0.16, 0.05), trimMat);
    grille.position.set(0, dims.bodyY + 0.02, L / 2 + 0.01); g.add(grille);
  }
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
  // M4 details: side skirts, a rear spoiler lip, and quad exhaust tips.
  if (type === 'm4') {
    for (const sx of [-1, 1]) {
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, L * 0.55), trimMat);
      skirt.position.set(sx * (W / 2 - 0.02), dims.bodyY - dims.bodyH / 2 + 0.06, -L * 0.05); g.add(skirt);
    }
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 0.05, 0.22), trimMat);
    spoiler.position.set(0, dims.bodyY + dims.bodyH / 2 + 0.02, -L * 0.42); spoiler.rotation.x = -0.12; g.add(spoiler);
    for (const sx of [-1, 1]) for (const dx of [-0.09, 0.09]) {
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.12, 10), chromeMat);
      tip.rotation.x = Math.PI / 2; tip.position.set(sx * 0.55 + dx, dims.bodyY - dims.bodyH / 2 + 0.12, -L / 2 - 0.05); g.add(tip);
    }
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
  // Interior, visible through the glass: a dashboard, two front seats,
  // and a steering wheel on the left, so the car is a real car inside
  // as well as out. The wheel sits in front of the driver's seat.
  const seatBaseY = dims.cabY - dims.cabH / 2 + 0.08;
  const dash = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.14, 0.35), trimMat);
  dash.position.set(0, dims.cabY - 0.1, L * 0.14); g.add(dash);
  for (const sx of [-1, 1]) {
    const seatBase = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.18, 0.48), trimMat);
    seatBase.position.set(sx * 0.38, seatBaseY, -0.05); g.add(seatBase);
    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.55, 0.14), trimMat);
    seatBack.position.set(sx * 0.38, seatBaseY + 0.28, -0.3); g.add(seatBack);
  }
  const steerY = dims.cabY + 0.08, steerZ = L * 0.1;
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.025, 8, 20), trimMat);
  wheel.add(rim);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), trimMat);
  column.rotation.x = Math.PI / 2 - 0.4; column.position.set(0, -0.02, -0.1); wheel.add(column);
  for (const a of [0.5, Math.PI - 0.5, -Math.PI / 2]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), trimMat);
    spoke.position.set(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0); spoke.rotation.z = a; wheel.add(spoke);
  }
  wheel.position.set(-0.38, steerY, steerZ); wheel.rotation.x = -0.4; g.add(wheel);
  // Driver head and steering wheel positions (car-local), for the
  // in-car driving camera.
  g.userData.steerPos = new THREE.Vector3(-0.38, steerY, steerZ);
  g.userData.headPos = new THREE.Vector3(-0.38, dims.cabY + 0.02, 0.3);
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
  else if (def && def.id === 'bmw-m4') type = 'm4';
  else if (def && def.id === 'coupe') type = 'coupe';
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
  try { setThirdPerson(cameraModeDefault()); } catch (e) { /* ignore */ }
}
