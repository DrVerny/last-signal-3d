// THE LAST SIGNAL - realistic crowd: background people built from the
// same rigged Quaternius models as the main characters (Jade, Caleb,
// Nurse), with variation so they are not identical clones. The models
// are loaded once, shared across the whole game, and cloned per person
// with a proper skinned-mesh clone (each clone gets its own skeleton and
// AnimationMixer, so every person walks with their own phase). People
// built before the models finish loading start as the old primitive
// figure and are upgraded to a rigged clone when the models arrive, so
// the crowd is never blocked on a download. CC0, see models/rigged/SOURCES.md.
import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';

// The civilian rigged models, with the role each plays in the crowd.
// Two men (Matt, Sam) and two women (Casual Female, Lis) give variety.
// sitThighL/R and sitShinL/R are the seated-pose angles (degrees about
// each leg bone's local X axis) for that model's rig: the Matt/Lis/Sam
// rigs share one set, while Jade's rig has different rest rotations on
// its legs (left -166 deg, right +129 deg about X), so her legs need
// different deltas to end up symmetric. Angles measured in Node from
// the model files; see makeSeatedPerson.
// CROWD_DEFS height is the model's real height in scene units (the
// raw geometry height times the model's root __fit scale), used as the
// denominator when normalising the crowd to the target height. Do not
// set these to the target height: a smaller denominator makes the
// crowd taller. Measured: caleb-alt 1.34, jade 1.89, nurse 1.53,
// walter 1.36. The crowd is normalised to 1.24 m in makePerson.
const CROWD_DEFS = [
  { file: 'models/rigged/caleb-alt-civilian.glb', sex: 'm', height: 1.34 },
  { file: 'models/rigged/jade-rigged.glb', sex: 'f', height: 1.89, sitThighL: 70, sitThighR: 130, sitShinL: -70, sitShinR: -90, sitShoulder: 45, sitHipsY: 0.47 },
  { file: 'models/rigged/nurse-rigged.glb', sex: 'f', height: 1.53 },
  { file: 'models/rigged/walter-rigged.glb', sex: 'm', height: 1.36 }
];
let crowdModels = null; // [{ scene, animations, height, sex }]
let crowdReadyFlag = false;
let crowdWaiters = [];
const pendingUpgrades = [];
const loader = new GLTFLoader();

function loadOne(def) {
  return Promise.race([
    loader.loadAsync(def.file),
    new Promise((_, reject) => setTimeout(() => reject(new Error('crowd model timed out: ' + def.file)), 30000))
  ]).then(gltf => {
    // Jade (Casual Female) has an oversized head: its Hair is wider than
    // its shoulders, so it reads as a wide flat disc about twice normal
    // width. The Atlas models (Matt, Lis, Sam) read as chibi, with heads
    // too big for their bodies, so they get a moderate shrink. Shrink the
    // head bone before the model is used, so the height and the clones
    // (via cloneSkinned) use the corrected head. Every clip on the Casual
    // models carries a Head scale track that would write the scale back
    // to 1 every frame, so strip that track from every clip so the shrink
    // stays. (The Atlas clips carry no Head scale track, so the strip is
    // a no-op for them, but it is kept so a future re-export of those
    // models cannot undo the shrink either.)
    let hasFaceHair = false;
    gltf.scene.traverse(o => { if (o.isMesh && o.material && (o.material.name === 'Face' || o.material.name === 'Hair')) hasFaceHair = true; });
    if (hasFaceHair) {
      gltf.scene.traverse(o => { if (o.isBone && o.name === 'Head') o.scale.setScalar(0.3); });
    } else {
      gltf.scene.traverse(o => { if (o.isBone && o.name === 'Head') o.scale.setScalar(0.6); });
    }
    for (const clip of (gltf.animations || [])) {
      clip.tracks = clip.tracks.filter(t => t.name !== 'Head.scale');
    }
    // Capture the Atlas texture image: per-person recolouring repaints
    // the measured palette cells of this image (see ATLAS_CELLS below).
    // The image is read again lazily when a look is applied, so a slow
    // texture load cannot leave the crowd unrecoloured.
    let atlasImage = null;
    try {
      gltf.scene.traverse(o => {
        if (!atlasImage && o.isMesh && o.material && o.material.name === 'Atlas' && o.material.map && o.material.map.image) atlasImage = o.material.map.image;
      });
    } catch (e) { /* ignore */ }
    return {
      scene: gltf.scene, animations: gltf.animations || [], height: def.height, sex: def.sex, file: def.file, atlasImage,
    // Seated-pose angles for this model's rig (defaults fit the
    // Matt/Lis/Sam rigs; Jade's rig overrides them above). hipsY is the
    // height the hips sit at: each rig's legs are a different length,
    // so the hips sit where the feet reach the floor.
    sit: {
      thighL: def.sitThighL !== undefined ? def.sitThighL : 110,
      thighR: def.sitThighR !== undefined ? def.sitThighR : 110,
      shinL: def.sitShinL !== undefined ? def.sitShinL : -110,
      shinR: def.sitShinR !== undefined ? def.sitShinR : -110,
      shoulder: def.sitShoulder !== undefined ? def.sitShoulder : -25,
      elbow: def.sitElbow !== undefined ? def.sitElbow : -55,
      hipsY: def.sitHipsY !== undefined ? def.sitHipsY : 0.42
      }
    };
  })
    .catch(() => null);
}
// Start loading at import time, so the models are ready by the time the
// player reaches the Terminal crowd. Failures are tolerated: the crowd
// simply stays primitive for the models that did not load.
export const crowdReadyPromise = Promise.all(CROWD_DEFS.map(loadOne)).then(list => {
  crowdModels = list.filter(Boolean);
  crowdReadyFlag = crowdModels.length > 0;
  for (const cb of crowdWaiters) { try { cb(crowdReadyFlag); } catch (e) { /* ignore */ } }
  crowdWaiters = [];
  flushUpgrades();
  return crowdReadyFlag;
}).catch(() => false);
export function crowdReady() { return crowdReadyFlag; }
export function onCrowdReady(cb) {
  if (crowdReadyFlag) { try { cb(true); } catch (e) { /* ignore */ } return; }
  crowdWaiters.push(cb);
}
// Clone a skinned GLTF scene so the clone has its own skeleton (the
// default Object3D.clone shares the original skeleton, so every clone
// would animate together). This mirrors three's SkeletonUtils.clone:
// map original bones to cloned bones, then rebind each skinned mesh.
export function cloneSkinned(source) {
  const clone = source.clone(true);
  const origBones = [], cloneBones = [];
  source.traverse(o => { if (o.isBone) origBones.push(o); });
  clone.traverse(o => { if (o.isBone) cloneBones.push(o); });
  const boneMap = new Map();
  origBones.forEach((b, i) => boneMap.set(b, cloneBones[i]));
  clone.traverse(o => {
    if (!o.isSkinnedMesh) return;
    try {
      const skel = o.skeleton;
      const bones = skel.bones.map(b => boneMap.get(b) || b);
      const newSkel = new THREE.Skeleton(bones, skel.boneInverses);
      o.skeleton = newSkel;
      o.bind(newSkel, o.bindMatrix);
    } catch (e) { /* keep the shared skeleton as a fallback */ }
  });
  return clone;
}
function pickModel(index) {
  if (!crowdModels || !crowdModels.length) return null;
  if (index !== undefined && index !== null) return crowdModels[((index % crowdModels.length) + crowdModels.length) % crowdModels.length];
  // Balance the sexes: pick a sex first (50/50), then a loaded model of
  // that sex, so the crowd is never all men or all women even if only
  // some models loaded. Fall back to any loaded model when none of the
  // chosen sex is available.
  const sex = Math.random() < 0.5 ? 'm' : 'f';
  const ofSex = crowdModels.filter(m => m.sex === sex);
  const pool = ofSex.length ? ofSex : crowdModels;
  return pool[Math.floor(Math.random() * pool.length)];
}
function findBone(group, names) {
  let found = null;
  group.traverse(o => { if (!found && o.isBone && names.indexOf(o.name) !== -1) found = o; });
  return found;
}
// ---------- Crowd variety: ethnicity and body type ----------
// The crowd is Black and Saxon people mixed, in a range of tones from
// deep brown-black to warm fair beige, so the difference reads at play
// distance. A fair-skinned person is a real person with warm beige
// skin, never a white statue: the rigged models are recoloured with
// these tones, never left as a flat white primitive. Hair, shirt and
// trousers vary too, and every person gets a clearly different height
// and build: tall, short and medium; fat, thin and medium. The variety
// is per person, not per place, so no crowd is segregated by look.
export const SKIN_TONES = [0x2e1a0e, 0x5a3a22, 0x8a5a3a, 0xa06a42, 0xe8c8a8]; // Black and Saxon, deep brown-black to warm fair beige
export const HAIR_COLOURS = [0x141414, 0x3a2418, 0x6a4a2a, 0xc8a848, 0x8a8a8a, 0x6a2a1a];
export const SHIRT_COLOURS = [0x1a1a1a, 0x222f45, 0x5a3a22, 0x8a2a22, 0x2a4a6a, 0x3a5a3a, 0xc8b89a, 0x555555, 0x3a2a4a, 0x2a6a4a];
export const PANTS_COLOURS = [0x2a4a6a, 0x1a1a1a, 0x3a2a1a, 0x555555, 0x333333, 0x4a3a2a];
// Body types: height is a multiplier on the normalised 1.24 m person
// (nobody above 1.24 m; short about 1.08 m); width is a multiplier on
// the body width (fat about 28% wider, thin about 14% slimmer). The
// spread is deliberate, not subtle: a fat person and a thin person
// standing next to each other read as different body types at a glance.
export const BODY_TYPES = [
  { name: 'tall-thin', height: 1.00, width: 0.88 },
  { name: 'tall', height: 1.00, width: 1.00 },
  { name: 'tall-fat', height: 1.00, width: 1.28 },
  { name: 'medium-thin', height: 1.00, width: 0.86 },
  { name: 'medium', height: 1.00, width: 1.00 },
  { name: 'medium-fat', height: 0.99, width: 1.26 },
  { name: 'short-thin', height: 0.88, width: 0.86 },
  { name: 'short', height: 0.88, width: 1.00 },
  { name: 'short-fat', height: 0.87, width: 1.28 }
];
export function pickBodyType() { return BODY_TYPES[Math.floor(Math.random() * BODY_TYPES.length)]; }
export function pickLook() {
  return {
    skin: SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)],
    hair: HAIR_COLOURS[Math.floor(Math.random() * HAIR_COLOURS.length)],
    shirt: SHIRT_COLOURS[Math.floor(Math.random() * SHIRT_COLOURS.length)],
    pants: PANTS_COLOURS[Math.floor(Math.random() * PANTS_COLOURS.length)]
  };
}
// Ages: the crowd spans the 20s, 30s, 40s and 50s, so no crowd is all
// one age. Young adults in their 20s walk briskly with dark hair and
// full height; people in their 30s walk at a normal pace; people in
// their 40s walk slightly slower, a quarter with grey hair, slightly
// shorter; people in their 50s walk slower still, most with grey hair,
// slightly shorter with a slight stoop. Speeds are metres per second;
// grey is the chance the hair is grey; height multiplies the body
// height; stoop is a forward lean in radians on the torso.
export function pickAge() {
  const r = Math.random();
  if (r < 0.30) return '20s';
  if (r < 0.60) return '30s';
  if (r < 0.85) return '40s';
  return '50s';
}
export function ageTraits(age) {
  switch (age) {
    case '20s': return { speedMin: 1.3, speedMax: 1.65, grey: 0, height: 1.0, stoop: 0 };
    case '30s': return { speedMin: 1.05, speedMax: 1.35, grey: 0.05, height: 1.0, stoop: 0 };
    case '40s': return { speedMin: 0.9, speedMax: 1.2, grey: 0.25, height: 0.99, stoop: 0.05 };
    default: return { speedMin: 0.7, speedMax: 1.0, grey: 0.6, height: 0.97, stoop: 0.1 };
  }
}
// Atlas palette cells, measured from the GLB files: the three Atlas
// models (Matt, Lis, Sam) share one 512x512 palette texture, and every
// vertex UV points at the centre of a 16px colour cell, so a whole body
// part is one solid cell. The HAND vertices are all skin, so the cell
// the hands use is the skin cell; the biggest non-skin head cell is the
// hair; the biggest torso cell is the shirt; the biggest leg cell is the
// trousers. Cells are [col, row] on the 16px grid, row 0 at the top:
//   Matt: skin (1,0), hair (2,0), shirt (5,0), pants (3,0)
//   Lis:  skin (1,2) + (9,2), hair (5,2), shirt (4,2), pants (3,2)
//   Sam:  skin (15,0), hair (22,0), shirt (18,0), pants (14,0)
// Palette cells are shared across parts by design (a sleeve can share
// its swatch with the trousers), so repainting a cell recolours every
// part that uses it; the outfit stays coherent. Jade's model has
// separate materials per part (Skin, Face, Hair, Shirt, Pants), so her
// clones are recoloured by material name instead.
const ATLAS_CELLS = {
  'models/rigged/caleb-alt-civilian.glb': { skin: [[1, 0]], hair: [[2, 0]], shirt: [[5, 0]], pants: [[3, 0]] },
  'models/rigged/nurse-rigged.glb': { skin: [[1, 2], [9, 2]], hair: [[5, 2]], shirt: [[4, 2]], pants: [[3, 2]] },
  'models/rigged/walter-rigged.glb': { skin: [[15, 0]], hair: [[22, 0]], shirt: [[18, 0]], pants: [[14, 0]] }
};
const JADE_PART_MATERIALS = { skin: ['Skin', 'Face'], hair: ['Hair'], shirt: ['Shirt'], pants: ['Pants'] };
// The repainted atlas is drawn at 256px (the source is 512, nearest
// neighbour, so the solid palette cells stay exact) to keep texture
// memory down on phones. Looks are cached per (model, skin, hair,
// shirt, pants), so people who roll the same look share one texture.
const TINT_SIZE = 256;
const atlasMatCache = new Map();
const jadeMatCache = new Map();
function hexCss(hex) { return '#' + (hex >>> 0).toString(16).padStart(6, '0'); }
// Repaint the measured palette cells of an atlas image with a look.
// Returns a CanvasTexture, or null when there is no image or no canvas
// (headless): the caller then keeps the original material, so a failed
// recolour never stops the crowd.
export function repaintAtlas(image, modelFile, look) {
  try {
    if (!image || !(image.naturalWidth || image.width) || !(image.naturalHeight || image.height)) return null;
    if (typeof document === 'undefined' || !document.createElement) return null;
    const cells = ATLAS_CELLS[modelFile];
    if (!cells || !look) return null;
    const canvas = document.createElement('canvas');
    canvas.width = TINT_SIZE; canvas.height = TINT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    try { ctx.imageSmoothingEnabled = false; } catch (e) { /* ignore */ }
    ctx.drawImage(image, 0, 0, TINT_SIZE, TINT_SIZE);
    const cellPx = 16 * (TINT_SIZE / 512); // 16px cells on the 512 atlas
    const paint = (list, colour) => {
      if (!list) return;
      ctx.fillStyle = hexCss(colour);
      for (const [cx, cy] of list) ctx.fillRect(cx * cellPx, cy * cellPx, cellPx, cellPx);
    };
    paint(cells.skin, look.skin);
    paint(cells.hair, look.hair);
    paint(cells.shirt, look.shirt);
    paint(cells.pants, look.pants);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  } catch (e) { return null; }
}
function atlasImageOf(model) {
  if (!model) return null;
  if (model.atlasImage && (model.atlasImage.naturalWidth || model.atlasImage.width)) return model.atlasImage;
  // The texture may have finished loading after the model entry was made:
  // read the image off the model's own Atlas material.
  let img = null;
  try {
    model.scene.traverse(o => {
      if (!img && o.isMesh && o.material && o.material.name === 'Atlas' && o.material.map && o.material.map.image) img = o.material.map.image;
    });
  } catch (e) { /* ignore */ }
  if (img && (img.naturalWidth || img.width)) { model.atlasImage = img; return img; }
  return null;
}
function getAtlasMaterial(model, look) {
  try {
    const img = atlasImageOf(model);
    if (!img) return null;
    const key = model.file + '|' + look.skin + '|' + look.hair + '|' + look.shirt + '|' + look.pants;
    if (atlasMatCache.has(key)) return atlasMatCache.get(key);
    const tex = repaintAtlas(img, model.file, look);
    if (!tex) return null;
    let base = null;
    model.scene.traverse(o => { if (!base && o.isMesh && o.material && o.material.name === 'Atlas') base = o.material; });
    if (!base) return null;
    const mat = base.clone();
    mat.map = tex;
    mat.needsUpdate = true;
    atlasMatCache.set(key, mat);
    return mat;
  } catch (e) { return null; }
}
function getJadeMaterials(model, look) {
  try {
    const key = model.file + '|' + look.skin + '|' + look.hair + '|' + look.shirt + '|' + look.pants;
    if (jadeMatCache.has(key)) return jadeMatCache.get(key);
    const base = {};
    model.scene.traverse(o => {
      if (o.isMesh && o.material && o.material.name && !base[o.material.name]) base[o.material.name] = o.material;
    });
    const out = {};
    const set = (names, colour) => {
      for (const n of names) {
        if (!base[n]) continue;
        const m = base[n].clone();
        m.color.setHex(colour);
        out[n] = m;
      }
    };
    set(JADE_PART_MATERIALS.skin, look.skin);
    set(JADE_PART_MATERIALS.hair, look.hair);
    set(JADE_PART_MATERIALS.shirt, look.shirt);
    set(JADE_PART_MATERIALS.pants, look.pants);
    if (!Object.keys(out).length) return null;
    jadeMatCache.set(key, out);
    return out;
  } catch (e) { return null; }
}
// Give one cloned person their look: Atlas models get a cached material
// with a repainted palette texture; Jade's model gets cached materials
// recoloured by part name. The source model's own materials are never
// mutated (the clone gets replacement materials), so the main characters
// and other clones are untouched. A failure leaves the original look.
export function applyLook(group, model, look) {
  try {
    if (!group || !model || !look) return;
    if (model.file && model.file.indexOf('jade-rigged') !== -1) {
      const mats = getJadeMaterials(model, look);
      if (!mats) return;
      group.traverse(o => {
        if (o.isMesh && o.material && o.material.name && mats[o.material.name]) o.material = mats[o.material.name];
      });
    } else {
      const mat = getAtlasMaterial(model, look);
      if (!mat) return;
      group.traverse(o => {
        if (o.isMesh && o.material && o.material.name === 'Atlas') o.material = mat;
      });
    }
  } catch (e) { /* a failed recolour must never stop the crowd */ }
}
// Loaded crowd model entries, for tests and for callers that need to
// inspect the models (may be null before the models finish loading).
export function getCrowdModels() { return crowdModels; }
// Build one realistic crowd person from a rigged model. Returns a
// pedestrian-like object matching the shape action.js makePedestrian
// returns (group, x, z, speed, phase, heading, bounds, lane, leader),
// plus rigged fields (mixer, rootBone, rootRest, rigged=true). Returns
// null when no crowd model is loaded yet.
export function makeRiggedPerson(opts) {
  const o = opts || {};
  const model = pickModel();
  if (!model) return null;
  try {
    const group = cloneSkinned(model.scene);
    group.userData.keepAlive = true;
    // Ethnicity + body type: every crowd person gets their own skin tone,
    // hair and clothes, and a clearly different height and build (fat,
    // thin, tall, short, medium). Callers may pass an explicit look/body
    // to keep a person the same through an upgrade. Age is picked first:
    // it sets the walk speed, the chance of grey hair and a slight
    // height change, so the crowd spans the 20s, 30s, 40s and 50s.
    const age = o.age || pickAge();
    const traits = ageTraits(age);
    const look = o.look || pickLook();
    if (!o.look && Math.random() < traits.grey) look.hair = 0x8a8a8a;
    const body = o.body || pickBodyType();
    applyLook(group, model, look);
    // Normalise height to the model's real height, then apply the body
    // type: height on Y, width on X/Z, with a tiny jitter so two people
    // of the same type are not exactly alike. The age height factor
    // (slightly shorter in the 40s and 50s) rides on the same scale.
    // The Walk clip is bone-relative, so the walk cycle is unaffected
    // by the scale.
    const s = (o.scale !== undefined ? o.scale : 1) * (1.24 / model.height) * body.height * traits.height;
    const sj = 0.98 + Math.random() * 0.04;
    group.scale.set(s * body.width, s * sj, s * body.width);
    group.traverse(m => { m.castShadow = true; });
    // Walk clip on its own mixer, with a random phase so the crowd never
    // marches in lockstep. The Walk clip walks in place; the root bone's
    // horizontal position is reset after each mixer update (see
    // updateRiggedPerson), so the clip can never drag the person away
    // from their path; the group's translation does the moving.
    let mixer = null, rootBone = null, rootRest = null, headBone = null, torsoBone = null;
    try {
      const walkClip = THREE.AnimationClip.findByName(model.animations || [], 'Walk');
      if (walkClip) {
        mixer = new THREE.AnimationMixer(group);
        const action = mixer.clipAction(walkClip);
        action.play();
        action.time = Math.random() * (walkClip.duration || 1);
      }
      group.traverse(m => { if (!rootBone && m.isBone && (m.name === 'Bone' || m.name === 'Root')) rootBone = m; });
      if (!rootBone) group.traverse(m => { if (!rootBone && m.isBone) rootBone = m; });
      if (rootBone) rootRest = rootBone.position.clone();
      headBone = findBone(group, ['Head', 'Neck']);
      torsoBone = findBone(group, ['Torso']);
    } catch (e) { mixer = null; }
    // A phone in the right hand for phone users: a small dark box on the
    // fist bone, with the head tilted down. A shopping bag hangs from the
    // left fist. These ride the skeleton, so they swing with the walk.
    if (o.phone) {
      const fist = findBone(group, ['FistR', 'HandR', 'RightHand']);
      if (fist) {
        const ph = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.02), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.5 }));
        ph.position.set(0, -0.05, 0.05); fist.add(ph);
      }
    }
    if (o.bags && o.bags >= 1) {
      const fist = findBone(group, ['FistL', 'HandL', 'LeftHand']);
      if (fist) {
        const bag = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.08), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.8 }));
        bag.position.set(0, -0.25, 0); fist.add(bag);
      }
    }
    // Walk speed from the age decade (20s brisk, 50s slow); phone users
    // walk slower. An explicit speed (for example kept through an
    // upgrade) is never overridden.
    let speed = o.speed;
    if (speed === undefined) {
      speed = traits.speedMin + Math.random() * (traits.speedMax - traits.speedMin);
    }
    if (o.phone) speed *= 0.75;
    const heading = o.heading !== undefined ? o.heading : Math.random() * Math.PI * 2;
    const bounds = o.bounds || { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
    const lane = o.lane || null;
    return {
      group, mixer, rootBone, rootRest, headBone, torsoBone, rigged: true,
      phone: !!o.phone, pockets: !!o.pockets, bags: o.bags || 0, age, stoop: traits.stoop,
      heading, bounds, lane, look, body,
      x: o.x !== undefined ? o.x : (lane ? (Math.random() * (lane.max - lane.min) + lane.min) : (Math.random() * (bounds.maxX - bounds.minX) + bounds.minX)),
      z: o.z !== undefined ? o.z : (lane ? lane.fixed : (Math.random() * (bounds.maxZ - bounds.minZ) + bounds.minZ)),
      speed, phase: Math.random() * 6.28,
      leader: o.leader || null, latOffset: o.latOffset || 0,
      legL: null, legR: null, armL: null, armR: null, headGroup: null, bagMeshes: []
    };
  } catch (e) { return null; }
}
// Advance a rigged person's walk clip and keep the root bone in place.
// Call this from updatePedestrian for rigged people.
const _stoopQ = new THREE.Quaternion();
const _stoopX = new THREE.Vector3(1, 0, 0);
export function updateRiggedPerson(p, dt) {
  if (!p || !p.mixer) return;
  try {
    p.mixer.update(dt);
    if (p.rootBone && p.rootRest) {
      p.rootBone.position.x = p.rootRest.x;
      p.rootBone.position.z = p.rootRest.z;
    }
    // Older people stoop slightly: add a small forward lean on the torso
    // after the mixer update, so the walk sway is kept and the stoop
    // rides on top of it. The mixer resets the torso each frame, so
    // this never accumulates.
    if (p.stoop && p.torsoBone) {
      _stoopQ.setFromAxisAngle(_stoopX, p.stoop);
      p.torsoBone.quaternion.multiply(_stoopQ);
    }
    // Phone users look down at the phone: re-apply the head tilt after
    // the mixer update, or the clip overwrites it.
    if (p.phone && p.headBone) p.headBone.rotation.x = 0.45;
  } catch (e) { /* a failed mixer update must never stop the crowd */ }
}
// ---------- Seated people (symposium audience) ----------
// The seated pose, measured from the rigged model files in Node: the
// thighs swing forward (about each leg bone's local X axis, applied on
// top of the bone's rest rotation) and the shins drop, the forearms
// rest on the lap, the torso leans slightly forward, and then the
// group is lowered so the hips sit at seat height. Jade's SitDown clip
// was measured too, but it is a deep squat-sit (knees 0.21 m below the
// hips, feet 0.07 m under the floor for a 0.45 m chair), so the manual
// pose is used for all four models. Verified numbers, production scale,
// per model: hips 0.42-0.47, knees 0.35-0.47, lowest mesh point (the
// shoe sole) -0.02 to 0.11 m, soles 0.29-0.52 m forward of the hips.
// The pose is measured after scaling, so the numbers hold at any scale.
function applySeatedPose(group, model) {
  const sit = (model && model.sit) || { thighL: 110, thighR: 110, shinL: -110, shinR: -110, shoulder: -25, elbow: -55, hipsY: 0.42 };
  const rest = new Map();
  const delta = (bone, deg) => {
    if (!bone) return;
    if (!rest.has(bone)) rest.set(bone, bone.quaternion.clone());
    const dq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(deg));
    bone.quaternion.copy(rest.get(bone)).multiply(dq);
  };
  const bones = {
    hips: findBone(group, ['Hips']),
    torso: findBone(group, ['Torso']),
    head: findBone(group, ['Head']),
    upperLegL: findBone(group, ['UpperLegL']),
    upperLegR: findBone(group, ['UpperLegR']),
    lowerLegL: findBone(group, ['LowerLegL']),
    lowerLegR: findBone(group, ['LowerLegR'])
  };
  if (!bones.hips || !bones.upperLegL || !bones.lowerLegL) return null;
  delta(bones.upperLegL, sit.thighL);
  delta(bones.upperLegR, sit.thighR);
  delta(bones.lowerLegL, sit.shinL);
  delta(bones.lowerLegR, sit.shinR);
  // Forearms rest on the lap: upper arms swing slightly forward, elbows bend.
  // (The Matt rigs' shoulder local X maps to world -X, so their angle is
  // negative; Jade's maps the other way, so hers is positive. The elbow
  // sign is the same for all four rigs.)
  delta(findBone(group, ['ShoulderL']), sit.shoulder);
  delta(findBone(group, ['ShoulderR']), sit.shoulder);
  delta(findBone(group, ['LowerArmL']), sit.elbow);
  delta(findBone(group, ['LowerArmR']), sit.elbow);
  // A slight forward lean, so the sitter reads as listening, not slouching.
  delta(bones.torso, -7);
  // Lower the group so the hips sit at seat height, whatever the model
  // scale is: measure the posed hips in world space and shift by the gap.
  group.updateMatrixWorld(true);
  const hp = new THREE.Vector3();
  bones.hips.getWorldPosition(hp);
  group.position.y += sit.hipsY - hp.y;
  group.updateMatrixWorld(true);
  // The sway animation works from the posed rotations, not the rest pose.
  const baseQuats = new Map();
  if (bones.torso) baseQuats.set('torso', bones.torso.quaternion.clone());
  if (bones.head) baseQuats.set('head', bones.head.quaternion.clone());
  return { bones, baseQuats };
}
// Build one seated audience member from a rigged model. Returns null
// when no crowd model is loaded yet. opts: { modelIndex, x, z, heading,
// scale }. The person never walks; updateSeatedPerson gives them a
// subtle idle sway. The hips end up at seat height over (x, z) - the
// caller centres the hips over the chair, since each model's hips sit
// at a different offset from its group origin.
export function makeSeatedPerson(opts) {
  const o = opts || {};
  const model = pickModel(o.modelIndex);
  if (!model) return null;
  try {
    const group = cloneSkinned(model.scene);
    group.userData.keepAlive = true;
    // Ethnicity + body type, as for walkers: each sitter gets their own
    // skin tone, hair and clothes, and a clearly different height and
    // build. Age too: a sitter in their 40s or 50s may have grey hair
    // and sit slightly shorter. The seated pose is measured after
    // scaling (see applySeatedPose), so the hips still land at seat
    // height and the feet stay near the floor at every size; a short
    // sitter's feet may dangle a little, as a short person's do.
    const age = o.age || pickAge();
    const traits = ageTraits(age);
    const look = o.look || pickLook();
    if (!o.look && Math.random() < traits.grey) look.hair = 0x8a8a8a;
    const body = o.body || pickBodyType();
    applyLook(group, model, look);
    const s = (o.scale !== undefined ? o.scale : 1) * (1.24 / model.height) * body.height * traits.height;
    const sj = 0.98 + Math.random() * 0.04;
    group.scale.set(s * body.width, s * sj, s * body.width);
    group.traverse(m => { m.castShadow = true; });
    group.position.set(o.x || 0, 0, o.z || 0);
    group.rotation.y = o.heading || 0;
    const posed = applySeatedPose(group, model);
    if (!posed) return null;
    return {
      group, seated: true, rigged: true, mixer: null,
      phase: Math.random() * 6.28, bones: posed.bones, baseQuats: posed.baseQuats,
      look, body, age
    };
  } catch (e) { return null; }
}
// A seated person's idle: a slow torso sway and an occasional head
// turn, applied on top of the posed rotations. Call once per frame
// from the room's animate loop. t is seconds.
const _seatQ = new THREE.Quaternion();
const _seatX = new THREE.Vector3(1, 0, 0);
const _seatY = new THREE.Vector3(0, 1, 0);
export function updateSeatedPerson(p, t) {
  if (!p || !p.bones || !p.baseQuats) return;
  try {
    if (p.bones.torso && p.baseQuats.get('torso')) {
      _seatQ.setFromAxisAngle(_seatX, Math.sin(t * 0.5 + p.phase) * 0.02);
      p.bones.torso.quaternion.copy(p.baseQuats.get('torso')).multiply(_seatQ);
    }
    if (p.bones.head && p.baseQuats.get('head')) {
      _seatQ.setFromAxisAngle(_seatY, Math.sin(t * 0.23 + p.phase * 1.7) * 0.12);
      p.bones.head.quaternion.copy(p.baseQuats.get('head')).multiply(_seatQ);
    }
  } catch (e) { /* a failed sway must never stop the crowd */ }
}
// Swap a primitive pedestrian for a rigged clone, keeping its position,
// heading, speed and walk phase, so the crowd upgrades in place when the
// models finish loading. Returns true when it upgraded. If the person
// is not in a scene yet (no parent), the rigged group is still built and
// p.group is swapped to it, so the caller adds the rigged person when it
// places them; the upgrade is never skipped just because the group had
// no parent at that moment.
export function upgradePedestrian(p) {
  if (!p || p.rigged || !crowdReady()) return false;
  const old = p.group;
  if (!old) return false;
  const parent = old.parent;
  const rigged = makeRiggedPerson({
    x: p.x, z: p.z, heading: p.heading, speed: p.speed,
    bounds: p.bounds, lane: p.lane, leader: p.leader, latOffset: p.latOffset,
    phone: p.phone, pockets: p.pockets, bags: p.bags, age: p.age,
    look: p.look, body: p.body
  });
  if (!rigged) return false;
  try {
    if (parent) parent.remove(old);
    try {
      old.traverse(m => {
        try { if (m.geometry) m.geometry.dispose(); } catch (e) { /* ignore */ }
        try {
          const mats = Array.isArray(m.material) ? m.material : (m.material ? [m.material] : []);
          for (const mm of mats) { try { mm.dispose(); } catch (e) { /* ignore */ } }
        } catch (e) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
    rigged.group.position.copy(old.position);
    rigged.group.rotation.copy(old.rotation);
    // Do NOT copy the old scale: the primitive's scale is uniform, but
    // the rigged clone was built from this person's body type (fat/thin
    // width on X/Z, tall/short height on Y). Copying the old scale
    // would flatten every upgraded person back to medium width.
    rigged.phase = p.phase;
    if (parent) parent.add(rigged.group);
    p.group = rigged.group;
    p.mixer = rigged.mixer; p.rootBone = rigged.rootBone; p.rootRest = rigged.rootRest;
    p.headBone = rigged.headBone; p.torsoBone = rigged.torsoBone; p.stoop = rigged.stoop; p.rigged = true;
    p.legL = null; p.legR = null; p.armL = null; p.armR = null; p.headGroup = null; p.bagMeshes = [];
    return true;
  } catch (e) { return false; }
}
export function queueUpgrade(p) {
  if (!p || p.rigged) return;
  if (pendingUpgrades.indexOf(p) === -1) pendingUpgrades.push(p);
}
function flushUpgrades() {
  for (let i = pendingUpgrades.length - 1; i >= 0; i--) {
    const p = pendingUpgrades[i];
    if (!p || p.rigged) { pendingUpgrades.splice(i, 1); continue; }
    if (upgradePedestrian(p)) pendingUpgrades.splice(i, 1);
  }
}
// action.js imports this name; it is the same flush as above.
export { flushUpgrades as processUpgradeQueue };
