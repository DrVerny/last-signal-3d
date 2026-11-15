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
const CROWD_DEFS = [
  { file: 'models/rigged/caleb-alt-civilian.glb', sex: 'm', height: 1.82 },
  { file: 'models/rigged/jade-rigged.glb', sex: 'f', height: 1.68, sitThighL: 70, sitThighR: 130, sitShinL: -70, sitShinR: -90, sitShoulder: 45, sitHipsY: 0.47 },
  { file: 'models/rigged/nurse-rigged.glb', sex: 'f', height: 1.66 },
  { file: 'models/rigged/walter-rigged.glb', sex: 'm', height: 1.78 }
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
  ]).then(gltf => ({
    scene: gltf.scene, animations: gltf.animations || [], height: def.height, sex: def.sex, file: def.file,
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
  }))
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
  return crowdModels[Math.floor(Math.random() * crowdModels.length)];
}
function findBone(group, names) {
  let found = null;
  group.traverse(o => { if (!found && o.isBone && names.indexOf(o.name) !== -1) found = o; });
  return found;
}
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
    // Normalise height to the model's real height, then vary it a little
    // so no two people are exactly the same height or build.
    const s = (o.scale !== undefined ? o.scale : 1) * (1.7 / model.height) * (0.94 + Math.random() * 0.12);
    group.scale.set(s, s * (0.97 + Math.random() * 0.06), s);
    group.traverse(m => { m.castShadow = true; });
    // Walk clip on its own mixer, with a random phase so the crowd never
    // marches in lockstep. The Walk clip walks in place; the root bone's
    // horizontal position is reset after each mixer update (see
    // updateRiggedPerson), so the clip can never drag the person away
    // from their path; the group's translation does the moving.
    let mixer = null, rootBone = null, rootRest = null, headBone = null;
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
    const age = o.age || (Math.random() < 0.2 ? 'old' : Math.random() < 0.5 ? 'young' : 'adult');
    let speed = o.speed;
    if (speed === undefined) {
      speed = age === 'old' ? 0.55 + Math.random() * 0.2 : age === 'young' ? 1.3 + Math.random() * 0.35 : 0.9 + Math.random() * 0.3;
    }
    if (o.phone) speed *= 0.75;
    const heading = o.heading !== undefined ? o.heading : Math.random() * Math.PI * 2;
    const bounds = o.bounds || { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
    const lane = o.lane || null;
    return {
      group, mixer, rootBone, rootRest, headBone, rigged: true,
      phone: !!o.phone, pockets: !!o.pockets, bags: o.bags || 0, age,
      heading, bounds, lane,
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
export function updateRiggedPerson(p, dt) {
  if (!p || !p.mixer) return;
  try {
    p.mixer.update(dt);
    if (p.rootBone && p.rootRest) {
      p.rootBone.position.x = p.rootRest.x;
      p.rootBone.position.z = p.rootRest.z;
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
    // Normalise height to the model's real height, then vary it a little
    // so no two people are exactly the same height or build. The spread
    // is kept tight for sitters, so every foot stays near the floor.
    const s = (o.scale !== undefined ? o.scale : 1) * (1.7 / model.height) * (0.97 + Math.random() * 0.06);
    group.scale.set(s, s * (0.97 + Math.random() * 0.06), s);
    group.traverse(m => { m.castShadow = true; });
    group.position.set(o.x || 0, 0, o.z || 0);
    group.rotation.y = o.heading || 0;
    const posed = applySeatedPose(group, model);
    if (!posed) return null;
    return {
      group, seated: true, rigged: true, mixer: null,
      phase: Math.random() * 6.28, bones: posed.bones, baseQuats: posed.baseQuats
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
// models finish loading. Returns true when it upgraded.
export function upgradePedestrian(p) {
  if (!p || p.rigged || !crowdReady()) return false;
  const old = p.group;
  if (!old || !old.parent) return false;
  const parent = old.parent;
  const rigged = makeRiggedPerson({
    x: p.x, z: p.z, heading: p.heading, speed: p.speed,
    bounds: p.bounds, lane: p.lane, leader: p.leader, latOffset: p.latOffset,
    phone: p.phone, pockets: p.pockets, bags: p.bags, age: p.age
  });
  if (!rigged) return false;
  try {
    parent.remove(old);
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
    rigged.group.scale.copy(old.scale);
    rigged.phase = p.phase;
    parent.add(rigged.group);
    p.group = rigged.group;
    p.mixer = rigged.mixer; p.rootBone = rigged.rootBone; p.rootRest = rigged.rootRest;
    p.headBone = rigged.headBone; p.rigged = true;
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
