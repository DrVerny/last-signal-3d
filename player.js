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
const PLAYER_HEIGHT = 1.68; // target standing height in metres (5 feet 6 inches)
const PLAYER_SKIN = 0x8a5a3a; // normal brown skin (user asked: dark brown to normal brown)
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
// ROOT CAUSE of the invisible shoes, measured in Node: the avatar
// stands at y 0 but every roomShell floor is a 0.1 thick box with its
// top at world y 0.10, so the old bind y 0.032 put the whole shoe
// (world y -0.030 to 0.098) UNDER the floor, and the feet with it.
// The shoe was white, in the scene and correctly placed, just buried.
// The bind y 0.12 lifts the shoe so its bottom sits near the outdoor
// ground (roads at y 0.02) and 0.086 m of white shoe shows above the
// indoor floor. The feet themselves stay buried under room floors;
// that is a separate avatar ground-level issue, not a shoe issue.
const SNEAKER_IDLE_BONE = { FootL: [0.205, 0.016, -0.180], FootR: [-0.108, 0.016, -0.180] };
const SNEAKER_BIND_POS = { FootL: [0.207, 0.12, -0.129], FootR: [-0.110, 0.12, -0.129] };
let avatarSneakers = null; // [{ bone, group, bindBone, bindPos }] once rigged
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
  // Scale the whole fallback to the player's height (1.68 m, 5 feet 6
  // inches). As built it is about 1.95 m tall (hair top), so a uniform
  // scale brings the head down to 1.68 m and the feet stay on the
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

// ---------- Realistic face ----------
// The Face mesh is a thin plate over the front of the head (the
// Quaternius asset's own face surface, built to carry a painted face).
// It ships with no UVs, so planar UVs are generated from its own
// geometry (u across its width, v up its height) and a canvas texture
// is painted on it: skin with tonal variation only. The features
// (eyes, brows, nose, lips) are 3D meshes on the Head bone (see
// addFaceFeatures below), NOT painted on the texture: measured in Node,
// the painted features do not read live - the eye anchors land at the
// temples, the nose and mouth anchors land where the plate has no
// front-facing surface (the nose pokes through the plate there), and
// the plate sits only 1.8 mm in front of the skin at game scale, so
// the paint z-fights with the blank skin behind it. The 3D features
// sit proud of the face surface and read clearly at 2-4 m, so the
// texture carries the skin tone and shading only. paintBrows is kept
// for API compatibility and ignored.
const FACE_TEX_W = 512;
const FACE_TEX_H = 200;
export function makeFaceTexture(paintBrows) {
  const cv = document.createElement('canvas');
  cv.width = FACE_TEX_W; cv.height = FACE_TEX_H;
  const ctx = cv.getContext('2d');
  // Soft radial blotch: rgb is 'r,g,b', alpha is the centre strength.
  const soft = (cx, cy, rx, ry, rgb, alpha) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(' + rgb + ',' + alpha + ')');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  };
  // Base skin.
  ctx.fillStyle = '#8a5a3a';
  ctx.fillRect(0, 0, FACE_TEX_W, FACE_TEX_H);
  // Large-scale tonal variation: forehead lighter, cheeks warmer,
  // jaw and chin darker, edges fall off so the face reads round.
  soft(256, 20, 220, 60, '154,106,66', 0.45);
  soft(150, 110, 90, 55, '150,82,46', 0.30);
  soft(362, 110, 90, 55, '150,82,46', 0.30);
  soft(256, 195, 220, 45, '110,70,40', 0.35);
  soft(30, 100, 70, 110, '70,40,20', 0.28);
  soft(482, 100, 70, 110, '70,40,20', 0.28);
  // Fine noise so the skin is not a flat fill.
  for (let i = 0; i < 1400; i++) {
    const nx = Math.random() * FACE_TEX_W, ny = Math.random() * FACE_TEX_H;
    const light = Math.random() > 0.5;
    ctx.fillStyle = light ? 'rgba(200,150,105,0.05)' : 'rgba(60,30,15,0.05)';
    ctx.fillRect(nx, ny, 1.6, 1.6);
  }
  // Cheek warmth and a faint chin crease.
  soft(150, 128, 42, 20, '150,80,50', 0.12);
  soft(362, 128, 42, 20, '150,80,50', 0.12);
  ctx.beginPath();
  ctx.moveTo(236, 186);
  ctx.quadraticCurveTo(256, 189, 276, 186);
  ctx.strokeStyle = 'rgba(60,30,15,0.18)'; ctx.lineWidth = 1.5; ctx.stroke();
  const tex = new THREE.CanvasTexture(cv);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
// Paint the face texture onto a Face mesh: generate planar UVs from
// the mesh's own geometry, then replace its material with the painted
// texture. Returns true when the face was painted.
export function paintFaceOnMesh(faceMesh, paintBrows) {
  if (!faceMesh || !faceMesh.geometry) return false;
  try {
    const geo = faceMesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y;
    if (w <= 0 || h <= 0) return false;
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) - bb.min.x) / w;
      uv[i * 2 + 1] = (pos.getY(i) - bb.min.y) / h;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mat = new THREE.MeshBasicMaterial({ map: makeFaceTexture(paintBrows) });
    mat.name = 'Face';
    faceMesh.material = mat;
    return true;
  } catch (e) { return false; }
}
// 3D facial features on the Head bone. These are what reads live:
// they sit proud of the face surface, past the hair fringe, so they
// are visible front-on at 2-4 m where the painted texture is not.
// Positions are in Head-bone local space, measured from the head
// geometry in Node (see the layout notes in game.js). Sizes are world
// metres, divided by totalScale (Head bone scale x rig scale).
// flipZ: the Atlas models (Caleb, Nurse) face -Z in their own space,
// so their features sit on the -Z side of the Head bone, not +Z.
// Measured in Node: the Atlas nose tip is at Head-local z -0.256
// (Caleb) and -0.266 (Nurse), while the back of the head is at
// +0.18; the old +Z layouts put the eyes, nose, mouth and brows on
// the back of the head, which is why Caleb's face read blank live.
// Real eyes: a small white eyeball, a warm brown iris disc with a
// darker limbic ring and a black pupil and a catchlight, and
// skin-coloured upper lid that leaves an almond slit. The old eye
// was a small white sphere with a tiny dark iris (0.011 m, about 6 px
// at 3 m, its brown annulus barely 1.4 px), so it read as a black dot
// or a dark lash mark and no brown iris was visible live at 2-4 m.
// This eye is substantially larger: a 0.019 m white eyeball (about
// 10 px at 3 m), a 0.0155 m bright brown iris (about 8 px, its brown
// annulus about 2.7 px), a thin dark limbic ring, a small pupil and a
// bigger catchlight. The iris, ring, pupil and shine sit 1.5-4 mm
// proud of the white sphere's front, so they read as painted on the
// eyeball instead of floating in front of it. The single skin lid
// sits just above the iris top (eye centre + 0.016 m) and just in
// front of the iris disc, so it cuts the top of the white into an
// almond slit without covering the brown. (eyePush is kept for API
// compatibility and ignored: the eye group position already puts the
// eyeball proud of the face surface, so pushing the discs further
// forward would only float them off the sphere.)
export function makeRealEye(w, eyePush) {
  const g = new THREE.Group();
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xf5efe2 });
  const eye = new THREE.Mesh(new THREE.SphereGeometry(w(0.019), 12, 10), whiteMat);
  eye.userData.keepAlive = true;
  g.add(eye);
  const ring = new THREE.Mesh(new THREE.CircleGeometry(w(0.0165), 16), new THREE.MeshBasicMaterial({ color: 0x1a0f06 }));
  ring.position.z = w(0.0195);
  ring.userData.keepAlive = true;
  g.add(ring);
  const iris = new THREE.Mesh(new THREE.CircleGeometry(w(0.0155), 16), new THREE.MeshBasicMaterial({ color: 0x8a5a28 }));
  iris.position.z = w(0.0205);
  iris.userData.keepAlive = true;
  g.add(iris);
  const pupil = new THREE.Mesh(new THREE.CircleGeometry(w(0.005), 12), new THREE.MeshBasicMaterial({ color: 0x0d0603 }));
  pupil.position.z = w(0.0215);
  pupil.userData.keepAlive = true;
  g.add(pupil);
  const shine = new THREE.Mesh(new THREE.CircleGeometry(w(0.0028), 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  shine.position.set(w(0.004), w(0.005), w(0.023));
  shine.userData.keepAlive = true;
  g.add(shine);
  // Skin lid above the eyeball: it covers the top of the white sphere
  // so the eye reads as an almond slit, not a round googly ball. It
  // sits just above the iris top and just in front of the iris disc,
  // so it trims the top sliver of the brown without covering it. There
  // is no bottom lid: it added nothing at play distance and doubled
  // the skin bar across the eye.
  const lidMat = new THREE.MeshBasicMaterial({ color: 0x8a5a3a });
  const lidTop = new THREE.Mesh(new THREE.BoxGeometry(w(0.040), w(0.005), w(0.004)), lidMat);
  lidTop.position.set(0, w(0.016), w(0.021));
  lidTop.userData.keepAlive = true;
  g.add(lidTop);
  g.traverse(o => { o.userData.keepAlive = true; });
  return g;
}
export function addFaceFeatures(headBone, totalScale, layout, fitScale) {
  if (!headBone || !totalScale || totalScale <= 0 || !layout) return;
  try {
    // The Head bone sits under the __fit node, so a Head child's true
    // world scale is totalScale times fitScale (0.591 for Casual
    // models, 0.89 for Atlas). All feature sizes use the corrected
    // wf() converter so they render at their true world size instead
    // of 0.59-0.89 of it: the old w() converter made the eyes render
    // at 0.59x on the Casual models, which is part of why they did not
    // read live.
    const wf = (worldSize) => worldSize / (totalScale * (fitScale || 1));
    // flipZ mirrors the features onto the -Z side of the Head bone
    // for the Atlas models, and turns each eye group around so its
    // iris and lids face -Z too.
    const zs = layout.flipZ ? -1 : 1;
    const noseS = layout.nose || [0.020, 0.018, 0.018];
    const mouthS = layout.mouth || [0.040, 0.007, 0.010];
    const browS = layout.brow || [0.032, 0.010, 0.008];
    const eyePush = layout.eyePush || 0;
    const noseMat = new THREE.MeshBasicMaterial({ color: 0x8a5a3a });
    const mouthMat = new THREE.MeshBasicMaterial({ color: 0x8a2a20 });
    const browMat = new THREE.MeshBasicMaterial({ color: 0x3a2010 });
    const grp = new THREE.Group();
    for (const sx of [-1, 1]) {
      // The eyes use wf() like the nose and mouth, so they render at
      // their true world size instead of 0.59-0.89 of it.
      const eye = makeRealEye(wf, eyePush);
      eye.position.set(layout.cx + sx * layout.eyeX, layout.eyeY, zs * layout.eyeZ);
      if (zs < 0) eye.rotation.y = Math.PI;
      grp.add(eye);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(wf(browS[0]), wf(browS[1]), wf(browS[2])), browMat);
      brow.position.set(layout.cx + sx * layout.eyeX, layout.browY, zs * (layout.browZ + wf(0.006)));
      brow.userData.keepAlive = true;
      grp.add(brow);
    }
    // Nose: a small tip sphere plus a short bridge, skin-coloured, so
    // it reads as a nose instead of a box.
    const noseTip = new THREE.Mesh(new THREE.SphereGeometry(wf(noseS[0] * 0.55), 10, 8), noseMat);
    noseTip.scale.set(1, 0.85, 1);
    noseTip.position.set(layout.cx, layout.noseY, zs * (layout.noseZ + wf(0.008)));
    noseTip.userData.keepAlive = true;
    grp.add(noseTip);
    const noseBridge = new THREE.Mesh(new THREE.BoxGeometry(wf(noseS[0] * 0.45), wf(noseS[1]), wf(noseS[2] * 0.5)), noseMat);
    noseBridge.position.set(layout.cx, layout.noseY + wf(0.012), zs * (layout.noseZ + wf(0.002)));
    noseBridge.userData.keepAlive = true;
    grp.add(noseBridge);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(wf(mouthS[0]), wf(mouthS[1]), wf(mouthS[2])), mouthMat);
    mouth.position.set(layout.cx, layout.mouthY, zs * (layout.mouthZ + wf(0.008)));
    mouth.userData.keepAlive = true;
    grp.add(mouth);
    // Lower lip highlight, a thinner lighter strip just under the mouth.
    const lip = new THREE.Mesh(new THREE.BoxGeometry(wf(mouthS[0] * 0.8), wf(0.004), wf(0.006)), new THREE.MeshBasicMaterial({ color: 0xa04a30 }));
    lip.position.set(layout.cx, layout.mouthY - wf(0.008), zs * (layout.mouthZ + wf(0.006)));
    lip.userData.keepAlive = true;
    grp.add(lip);
    grp.userData.keepAlive = true;
    headBone.add(grp);
  } catch (e) { /* face features are cosmetic; never break the load */ }
}
// The player's face layout: the Casual Male uses the same Face mesh as
// Jade, so the same Head-local positions fit. eyeZ/noseZ/mouthZ/browZ
// are the measured front of the Face plate (plate front Z 0.505 in
// Head-local space).
export const PLAYER_FACE_LAYOUT = { cx: 0.001, eyeX: 0.155, eyeY: 0.513, eyeZ: 0.48, noseY: 0.44, noseZ: 0.50, mouthY: 0.36, mouthZ: 0.46, browY: 0.54, browZ: 0.47, nose: [0.022, 0.020, 0.020], mouth: [0.045, 0.008, 0.012], brow: [0.040, 0.012, 0.010], eyePush: 0.008 };
// Skin tonal variation: a per-vertex colour attribute on the Skin
// geometry, so the unlit skin does not read as flat plastic. Colours
// are multipliers on the material colour (forehead lighter, cheeks
// warmer, nose bridge highlighted, jaw and neck darker, fine noise).
// Positions are in the model's geometry space (head y 2.0-3.3).
export function addSkinToneVariation(skinMesh) {
  if (!skinMesh || !skinMesh.geometry) return false;
  try {
    const geo = skinMesh.geometry;
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      let r = 1, g = 1, b = 1;
      if (y > 2.0) {
        if (y > 2.68 && y < 2.9 && z > 0.2 && Math.abs(x) < 0.35) { r *= 1.07; g *= 1.06; b *= 1.05; }
        if (y > 2.5 && y < 2.68 && Math.abs(x) > 0.12 && Math.abs(x) < 0.38 && z > 0.25) { r *= 1.07; b *= 0.94; }
        if (y > 2.55 && y < 2.68 && Math.abs(x) < 0.07 && z > 0.4) { r *= 1.06; g *= 1.05; b *= 1.04; }
        if (y > 2.52 && y < 2.66 && Math.abs(x) >= 0.07 && Math.abs(x) < 0.16 && z > 0.36) { r *= 0.93; g *= 0.93; b *= 0.93; }
        if (y > 2.32 && y < 2.52) { r *= 0.93; g *= 0.93; b *= 0.93; }
        if (y >= 2.0 && y < 2.32 && z < 0.3) { r *= 0.87; g *= 0.87; b *= 0.87; }
        if (Math.abs(x) > 0.45 && y > 2.45 && y < 2.72) { r *= 0.94; g *= 0.94; b *= 0.94; }
      }
      const n = Math.sin(i * 12.9898) * 43758.5453;
      const f = (n - Math.floor(n) - 0.5) * 0.06;
      r += f; g += f; b += f;
      colors[i * 3] = Math.min(1.15, Math.max(0.7, r));
      colors[i * 3 + 1] = Math.min(1.15, Math.max(0.7, g));
      colors[i * 3 + 2] = Math.min(1.15, Math.max(0.7, b));
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (skinMesh.material) skinMesh.material.vertexColors = true;
    return true;
  } catch (e) { return false; }
}

// Fist scale: the rigged hand is oversized. Measured in Node: the fist
// block is 0.197 m long (wrist to fingertip, real: about 0.185 m) and
// the old 0.22 m finger capsules stuck 0.09 m past it, so the hand
// measured 0.29 m wrist to fingertip and the fingertips reached the
// knees. Scaling the Fist bone to 0.75 shrinks the block to 0.148 m,
// and with the shorter fingers below the whole hand measures about
// 0.19 m. The clips carry a Fist scale track, so it is stripped with
// the Head scale track in loadPlayerRig.
export const FIST_SCALE = 0.75;
// One finger pointing along +Y from the origin: a proximal capsule, a
// knuckle, a distal capsule bent slightly forward, and a nail near the
// tip. Lengths are world metres; w converts them to the Fist bone's
// local units. The knuckle is a large sphere so the joint reads at
// 2-4 m, and the distal segment starts a little past the knuckle so
// there is a visible gap at the joint instead of one solid paddle.
// The nail sits on the Fist-local -Z side: measured live, the nail on
// +Z read as palm-side, so the back of the hand is -Z here. The
// finger group is turned PI about Y by addJointedFingers, so the
// dorsal side (and the nail) faces forward in the Idle pose, where
// the palms face the camera and the nails would otherwise face away.
// That turn mirrors the curl too, so the distal bend is -0.28 here:
// after the PI turn it curls toward the palm (+Z) exactly as before.
// The nail is large (0.016 x 0.018 m) so it reads as a nail plate
// from the front at 2-4 m, not a pale fingertip tip.
function makeFinger(w, mat, nailMat, proxLen, distLen, radius) {
  const g = new THREE.Group();
  const prox = new THREE.Mesh(new THREE.CapsuleGeometry(w(radius), w(Math.max(0.001, proxLen - radius * 2)), 4, 10), mat);
  prox.position.y = w(proxLen / 2);
  g.add(prox);
  const knuckle = new THREE.Mesh(new THREE.SphereGeometry(w(radius * 1.8), 10, 8), mat);
  knuckle.position.y = w(proxLen);
  knuckle.scale.set(1.15, 0.85, 1.15);
  g.add(knuckle);
  const dist = new THREE.Group();
  dist.position.y = w(proxLen + 0.004);
  dist.rotation.x = -0.28; // slight natural curl toward the palm once the group is turned PI about Y
  const distMesh = new THREE.Mesh(new THREE.CapsuleGeometry(w(radius * 0.92), w(Math.max(0.001, distLen - radius * 1.84)), 4, 10), mat);
  distMesh.position.y = w(distLen / 2);
  dist.add(distMesh);
  const nail = new THREE.Mesh(new THREE.BoxGeometry(w(0.016), w(0.018), w(0.003)), nailMat);
  nail.position.set(0, w(distLen * 0.62), w(-radius * 0.95));
  dist.add(nail);
  g.add(dist);
  g.traverse(o => { o.userData.keepAlive = true; });
  return g;
}
// Fingers on a rigged hand. The model's hands are solid mitten blocks
// (part of the Skin mesh, no finger bones). These jointed fingers
// extend past the fist so the hand reads as real fingers, not
// rectangular prongs: two segments with a knuckle, a rounded tip and a
// nail. They are children of the Fist bone so they move with the arm.
// Sizes are world metres divided by boneScale times FIST_SCALE: a Fist
// child is shrunk by the bone scale as well as the __fit node (0.591)
// and the rig scale, so dividing by boneScale alone would make them
// render at 0.75 of their designed size. The fingers are MeshBasicMaterial
// in the player's own skin tone so they blend with the hand while
// staying bright in the dim mansion. thumbSign is +1 when the thumb
// sits on the Fist local +X side.
export function addJointedFingers(fistBone, boneScale, thumbSign) {
  if (!fistBone || !boneScale || boneScale <= 0) return;
  try {
    const eff = boneScale * FIST_SCALE;
    const w = (worldSize) => worldSize / eff;
    const fingerMat = new THREE.MeshBasicMaterial({ color: PLAYER_SKIN });
    const nailMat = new THREE.MeshBasicMaterial({ color: 0xe8cbb0 });
    const grp = new THREE.Group();
    // Four fingers from the thumb side: index, middle, ring, pinky.
    // dx is the world offset from the fist centre (0.0075 local); the
    // base sits inside the fist at local Y 0.20, the knuckle at the
    // fist top, the tip about 0.04 m past it. The fingers are spaced
    // 0.024 m apart centre to centre with a 0.016 m capsule diameter,
    // so there is a clear 0.008 m gap between neighbours instead of
    // one solid paddle.
    const defs = [
      { dx: 0.036, dist: 0.045 },
      { dx: 0.012, dist: 0.050 },
      { dx: -0.012, dist: 0.048 },
      { dx: -0.036, dist: 0.038 },
    ];
    for (const d of defs) {
      const f = makeFinger(w, fingerMat, nailMat, 0.047, d.dist, 0.008);
      f.position.set(0.0075 + w(thumbSign * d.dx), 0.20, 0.05);
      // Turn the finger PI about its own Y (the finger's long axis):
      // the dorsal side, where the nail sits, then faces forward in
      // the Idle pose instead of away from the camera. The turn is
      // about the finger's own axis, so the finger still points down
      // and the knuckle stays put; the curl sign inside makeFinger
      // is already mirrored to match. This is a plain Group, not a
      // bone, so the Walk/Idle clips (which only track the Fist
      // bones) never overwrite it.
      f.rotation.y = Math.PI;
      grp.add(f);
    }
    const thumb = makeFinger(w, fingerMat, nailMat, 0.030, 0.035, 0.0085);
    thumb.position.set(0.0075 + w(thumbSign * 0.05), 0.16, 0.06);
    // Same dorsal turn for the thumb, composed as R = R_x * R_z *
    // R_y (order XZY) so the thumb keeps its world tilt and curl and
    // only its front and back swap: a plain XYZ Euler would flip the
    // tilt sign instead. The thumb's own x/z numbers are unchanged.
    thumb.rotation.order = 'XZY';
    thumb.rotation.set(-0.35, Math.PI, -thumbSign * 0.55);
    grp.add(thumb);
    grp.userData.keepAlive = true;
    fistBone.add(grp);
  } catch (e) { /* fingers are cosmetic; never break the load */ }
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
    // Skin is replaced with flat unlit MeshBasicMaterial in the
    // player's skin tone, keeping its name so later lookups still work.
    // The raw Skin is near-black (#1f1f1f) with no texture map, so
    // cloning it as MeshStandardMaterial and tinting the colour keeps
    // it lit: in the dim mansion the tinted standard material renders
    // far darker than the colour value, and the skin read as very dark
    // brown, close to black-brown. An unlit basic material renders the
    // exact colour and stays bright in dim light. The flat look is
    // fixed with per-vertex tonal variation instead of lighting (see
    // addSkinToneVariation). The Face is not replaced here: it is
    // painted with the realistic face texture by paintFaceOnMesh below.
    {
      const m = new THREE.MeshBasicMaterial({ color: PLAYER_SKIN });
      m.name = 'Skin';
      rig.traverse(o => { if (o.isMesh && o.material && o.material.name === 'Skin') o.material = m; });
    }
    rig.traverse(o => {
      if (o.isMesh && o.material && o.material.name === 'Skin') addSkinToneVariation(o);
      if (o.isMesh && o.material && o.material.name === 'Face') paintFaceOnMesh(o, true);
    });
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
    // The Fist scale tracks are stripped too: the Fist bones are scaled
    // to FIST_SCALE below (see addJointedFingers) and the clips would
    // otherwise write them back to 1.
    for (const clip of (gltf.animations || [])) {
      clip.tracks = clip.tracks.filter(t => t.name !== 'Head.scale' && t.name !== 'FistL.scale' && t.name !== 'FistR.scale');
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
    // Jointed fingers on both hands. The face is already painted on the
    // Face mesh (see the material step above), so no 3D face features
    // are added. The hands are solid mitten blocks, so the fingers are
    // children of the Fist bones. The Fist bones sit under the __fit
    // node (scale 0.591), so a Fist child's world scale is 0.591 times
    // the rig scale s. Pass that to the finger helper, not s alone, or
    // the fingers render at 0.591 of their designed size. The Fist
    // bones are scaled to FIST_SCALE first (see the note on the
    // constant): it shrinks the oversized mitten so the whole hand
    // measures about 0.19 m wrist to fingertip.
    let fitScale = 1;
    rig.traverse(o => { if (o.name === '__fit' && o.scale) fitScale = o.scale.x; });
    for (const fistName of ['FistL', 'FistR']) {
      const fb = bones.get(fistName);
      if (fb) fb.scale.setScalar(FIST_SCALE);
    }
    addJointedFingers(bones.get('FistL'), fitScale * s, 1);
    addJointedFingers(bones.get('FistR'), fitScale * s, -1);
    // 3D face features on the Head bone (eyes, brows, nose, lips):
    // the painted texture alone does not read live, so the player
    // gets the same treatment as Jade. The Head bone scale is 0.3,
    // so the total scale is 0.3 times the rig scale.
    {
      const headBone = bones.get('Head');
      if (headBone) addFaceFeatures(headBone, 0.3 * s, PLAYER_FACE_LAYOUT, fitScale);
    }
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
    // Weave texture for the white upper: a crosshatch that reads at
    // 2-4 m. The old version was near-white on purpose and invisible
    // live; this one is mid-grey at half strength, so the weave shows
    // without the shoe reading grey. The ExtrudeGeometry UVs are
    // arbitrary, so the repeat is kept coarse (2x1) to avoid moire.
    // Round 3: the old lines were about 1 px at 3 m and too faint to
    // read from the front, so they are darker and thicker now.
    const weave = document.createElement('canvas');
    weave.width = weave.height = 64;
    {
      const wc = weave.getContext('2d');
      wc.fillStyle = '#f4f4f4';
      wc.fillRect(0, 0, 64, 64);
      wc.strokeStyle = 'rgba(80,80,80,0.8)';
      wc.lineWidth = 2.2;
      for (let i = -64; i <= 64; i += 8) {
        wc.beginPath(); wc.moveTo(i, 0); wc.lineTo(i + 64, 64); wc.stroke();
        wc.beginPath(); wc.moveTo(i + 64, 0); wc.lineTo(i, 64); wc.stroke();
      }
    }
    const weaveTex = new THREE.CanvasTexture(weave);
    weaveTex.wrapS = weaveTex.wrapT = THREE.RepeatWrapping;
    weaveTex.repeat.set(2, 1);
    if (THREE.SRGBColorSpace) weaveTex.colorSpace = THREE.SRGBColorSpace;
    const shoeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: weaveTex });
    // Unlit dark, so the sole and midsole read dark from the front even
    // in the dim train and mansion: the old lit standard material went
    // near-black in shadow and near-white under a lamp, and the band
    // vanished against the white upper.
    const soleMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    const bandMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    // Running-shoe upper: an extruded side profile (low tapered toe,
    // higher heel, dipped ankle opening), not a plain box, so it reads
    // as a real running shoe. The profile is drawn in XY (X = length,
    // Y = height) and extruded across the width, then rotated so the
    // length runs along Z with the toe forward. A small bevel rounds
    // the edges. The measured profile is oversized: 0.54 m long by
    // 0.28 m wide by 0.17 m tall in rig-local units, where a real shoe
    // is about 0.28 x 0.10 x 0.10 m. The inner group below scales the
    // whole shoe down to 0.31 m long, 0.16 m wide and 0.14 m tall
    // (world, measured in Node). The sole bottom stays at group-local
    // -0.09, so at the 0.12 bind height it sits at y 0.032 world and
    // the shoe top at 0.176, showing 0.076 m above the indoor floor
    // (0.10) and only a 0.012 m sliver of foot below the sole on the
    // outdoor roads (0.02). Raising the bind would show more shoe
    // indoors but leave a bare-foot strip outdoors, so it stays 0.12.
    const shoeProfile = new THREE.Shape();
    shoeProfile.moveTo(-0.27, 0);
    shoeProfile.lineTo(-0.27, 0.15);
    shoeProfile.quadraticCurveTo(-0.26, 0.17, -0.20, 0.165);
    shoeProfile.lineTo(-0.12, 0.155);
    shoeProfile.quadraticCurveTo(-0.05, 0.105, 0.03, 0.12);
    shoeProfile.quadraticCurveTo(0.15, 0.105, 0.23, 0.06);
    shoeProfile.quadraticCurveTo(0.27, 0.035, 0.27, 0);
    shoeProfile.lineTo(-0.27, 0);
    const shoeGeo = new THREE.ExtrudeGeometry(shoeProfile, { depth: 0.28, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, steps: 1 });
    shoeGeo.rotateY(-Math.PI / 2);
    shoeGeo.translate(0.14, -0.06, 0);
    const laceMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    for (const boneName of ['FootL', 'FootR']) {
      const foot = bones.get(boneName);
      if (!foot) continue;
      const group = new THREE.Group();
      // The whole shoe lives in this inner group so the profile, toe
      // cap and sole can be scaled down together: x 0.60 (width),
      // y 0.80 (height), z 0.62 (length). updateSneakers only sets
      // the outer group's position, so this scale is untouched by
      // the follow logic. Position y -0.018 keeps the sole bottom
      // at group-local -0.09: the sole bottom is -0.09 in inner
      // units, scaled by 0.80 to -0.072, then lifted by -0.018.
      const inner = new THREE.Group();
      inner.scale.set(0.60, 0.80, 0.62);
      inner.position.y = -0.018;
      group.add(inner);
      const shoe = new THREE.Mesh(shoeGeo, shoeMat);
      shoe.castShadow = true; shoe.receiveShadow = true;
      inner.add(shoe);
      // Rounded toe cap: a flattened sphere at the front of the shoe.
      const toeCap = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), shoeMat);
      toeCap.scale.set(1, 0.6, 0.9);
      toeCap.position.set(0, 0.02, 0.22);
      toeCap.castShadow = true;
      inner.add(toeCap);
      // Four lace strips across the top of the shoe, following its
      // curve. Their heights are the profile top at each Z plus the
      // 0.01 bevel plus half the strip thickness, so they sit just
      // above the upper instead of buried inside it: at Z 0.10 the
      // profile top is 0.108, at 0.05 and 0.00 it is 0.117, at -0.05
      // it is 0.121. The instep slopes down toward the toe, so the
      // strips tilt with it (rotation.x 0.25). The laces are dark and
      // crossed: each strip is rotated alternately around Y so it
      // runs diagonally across the instep, zigzagging like real
      // laces. Round 3: the old 0.010 thick dark-grey strips were
      // about 2 px at 3 m and foreshortened to nothing from a
      // straight front view, so they are thicker (0.016), wider,
      // darker and raised a little further off the upper.
      // (Rotation is around Y, not Z: a Z rotation would tilt the
      // strip up and down and bury one end in the shoe; a Y rotation
      // keeps it flat on the instep while making the diagonal.)
      const laceZ = [0.10, 0.05, 0.00, -0.05];
      const laceY = [0.123, 0.132, 0.132, 0.136];
      for (let i = 0; i < laceZ.length; i++) {
        const lace = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.016, 0.028), laceMat);
        lace.position.set(0, laceY[i] + 0.008, laceZ[i]);
        lace.rotation.x = 0.25;
        lace.rotation.y = (i % 2 === 0 ? 1 : -1) * 0.4;
        inner.add(lace);
      }
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 0.58), soleMat);
      sole.position.y = -0.075;
      sole.castShadow = true;
      inner.add(sole);
      // Dark midsole band around the base of the visible shoe. The
      // real sole sits with its bottom at world y 0.032, under the
      // indoor floor top (0.10), so it is invisible from the front
      // indoors; only the white upper shows. This band is a separate
      // dark strip at the bottom of the visible shoe (world y about
      // 0.098 to 0.138), so the shoe reads as having a dark sole
      // from the front as well as the side. Round 3: the old band
      // (0.34 x 0.03 x 0.60) stuck out only 0.012 m and ended flush
      // with the white toe cap, so from the front it read as part of
      // the white shoe. This one is wider, taller and longer than
      // the upper and the toe cap, so it protrudes about 0.03 m at
      // the sides and 0.027 m past the toe cap and wraps the base as
      // a dark band. It does not move the sole or the bind height,
      // so the shoe still sits on the floor exactly as before.
      const midsole = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.05, 0.68), bandMat);
      midsole.position.y = 0.020;
      midsole.castShadow = true;
      inner.add(midsole);
      const bindPos = SNEAKER_BIND_POS[boneName];
      group.position.set(bindPos[0], bindPos[1], bindPos[2]);
      group.userData.keepAlive = true;
      rig.add(group);
      const bindBone = SNEAKER_IDLE_BONE[boneName];
      avatarSneakers.push({ bone: foot, group, bindBone: new THREE.Vector3(bindBone[0], bindBone[1], bindBone[2]), bindPos: new THREE.Vector3(bindPos[0], bindPos[1], bindPos[2]) });
    }
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
// the next frame, before the act moves it. This runs in first-person
// too: toggling from third to first used to leave the camera at the
// third-person spot 4 m behind the player, and the player position was
// then recorded from that spot, so toggling back put the camera 8 m
// behind, through the walls, and Reset view could not recover it
// (the next frame restored the drifted position). Restoring in both
// modes snaps the camera back onto the player on the toggle frame.
let playerPos = null;
// Reset the stored player ground position (used by Reset view): the
// next frame's beginPlayerFrame would otherwise teleport the camera
// straight back to the old spot and undo the reset.
export function setPlayerPos(x, z) { playerPos = { x, z }; }
export function beginPlayerFrame(camera, eyeY) {
  if (!playerPos || !camera) return;
  try {
    camera.position.x = playerPos.x;
    camera.position.z = playerPos.z;
    camera.position.y = eyeY === undefined ? 1.7 : eyeY;
  } catch (e) { /* ignore */ }
}
// Places the avatar at the player's ground position, faces it toward the
// movement (or the camera yaw when still), and - in third-person - puts
// the camera behind and above the avatar instead of at the eyes.
// o: { scene, camera, x, z, yaw, pitch, moving, moveDx, moveDz, dt, t, eyeY, camBounds, camDist }
// The act still owns movement and bounds; this only positions the avatar
// and overrides the camera in third-person. Returns true when the camera
// was overridden (third-person), false in first-person.
// camBounds clamps the camera inside the room the player walks in, so a
// fixed distance never pushes it through a wall. camDist overrides the
// camera distance (default zoomDist 4 m): a tight space like the train
// car needs a short distance, or the camera rides up into the roof arch.
// Both are optional; callers that pass neither get the old behaviour.
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
  // camDist shortens the distance in tight spaces (the train car); the
  // default 4 m would put the camera through the roof arch there.
  const dist = o.camDist || zoomDist;
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
  // When the bounds clamp squeezes the camera close to the avatar (the
  // player standing at a wall or a room edge facing away from it), the
  // fixed lift would leave the camera almost directly above him, looking
  // straight down, and no drag could level it. Lower the camera toward
  // eye level as the horizontal distance shrinks, so the view levels out
  // instead of tipping over the top of his head.
  const hDist = Math.hypot(camX - o.x, camZ - o.z);
  const camY = (o.eyeY || 1.7) + dist * 0.28 * Math.min(1, hDist / dist);
  o.camera.position.set(camX, camY, camZ);
  o.camera.rotation.order = 'YXZ';
  // Look at the avatar's chest, slightly ahead so the view leads
  // forward. At 1.35 m the 1.68 m player is framed head to feet; the
  // old 1.45 m aim was tuned for a 1.75 m player and put the feet at
  // the bottom edge of the frame.
  const fx = -Math.sin(o.yaw), fz = -Math.cos(o.yaw);
  o.camera.lookAt(o.x + fx * 1.2, 1.35, o.z + fz * 1.2);
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

// ---------- Wall collision ----------
// Buildings used to be scenery only: the player walked straight through
// their walls, because the only limits were the outer bounds of each
// place. Now every walkable scene registers axis-aligned box colliders
// for its walls, and movement is resolved against them every frame.
// A collider is a ground-plane rectangle { x0, z0, x1, z1 } in the same
// coordinates the player walks in. The player is a circle of
// PLAYER_RADIUS around his ground position. resolveMove tries the full
// step, then each axis on its own, so walking into a wall stops the
// player at its face and walking along it slides: the axis that is free
// still moves. A player who starts inside a box (a bad spawn, or a box
// added under him) can always walk back out: a step is only blocked
// when it would carry him INTO a box he is not already in.
export const PLAYER_RADIUS = 0.35;
let activeColliders = [];
export function setColliders(list) { activeColliders = list || []; }
export function getColliders() { return activeColliders; }
// Add one box to a list, normalising the corners so the caller never
// has to mind which corner is which. Returns the list, so a builder can
// keep pushing into the same module list.
export function addBoxCollider(list, x0, z0, x1, z1) {
  list.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) });
  return list;
}
function circleHitsBox(x, z, r, b) {
  const cx = Math.max(b.x0, Math.min(x, b.x1));
  const cz = Math.max(b.z0, Math.min(z, b.z1));
  const dx = x - cx, dz = z - cz;
  return dx * dx + dz * dz < r * r;
}
function hitsAnyBox(x, z, r, list) {
  for (const b of list) { if (circleHitsBox(x, z, r, b)) return true; }
  return false;
}
// Resolve one movement step against a collider list (defaults to the
// list set by setColliders). Returns the new ground position.
export function resolveMove(x, z, dx, dz, colliders) {
  const list = colliders || activeColliders;
  if (!list || !list.length || (!dx && !dz)) return { x: x + dx, z: z + dz };
  const r = PLAYER_RADIUS;
  const insideNow = hitsAnyBox(x, z, r, list);
  let nx = x + dx;
  if (!insideNow && hitsAnyBox(nx, z, r, list)) nx = x;
  let nz = z + dz;
  if (!insideNow && hitsAnyBox(nx, nz, r, list)) nz = z;
  return { x: nx, z: nz };
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
    // A stale entry (a release the page never saw - a missed pointerup,
    // a lost focus, a synthetic event from automation) would leave two
    // phantom fingers "down" forever, and every later pointermove would
    // be stopped in the capture phase: the look-drag would die for the
    // rest of the session and the camera could never be dragged back.
    // A fresh press while the map is already full means the old entries
    // are stale, so clear them before tracking the new press.
    if (pinchPointers.size >= 2) pinchPointers.clear();
    pinchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchPointers.size === 2) {
      // Keep the second finger from resetting the look-drag origin.
      e.stopPropagation();
    }
  }, true);
  // Losing focus mid-gesture can swallow the releases: drop the tracked
  // pointers so the next press starts from a clean map.
  addEventListener('blur', () => { pinchPointers.clear(); });
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
