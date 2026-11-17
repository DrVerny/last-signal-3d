// THE LAST SIGNAL - facial expressions.
// The user playtested and saw no expression on the characters' faces:
// the faces looked blank while they talked. The rigged models have no
// expression morph targets at all (checked against the real GLB files:
// Jade, Caleb and Nurse have no morph targets and no separate eye or
// brow meshes; only body-bone animations), and Walter's scan has a
// separate eyebrow mesh but no expression morphs either. So expression
// is built procedurally, the same way the lip-sync jaw is: small brow
// and upper-eyelid meshes are placed on the face, and a smile morph is
// generated on the mouth corners. The brows and lids ride on the Head
// bone, so they follow the head through walk, idle and gesture movement.
// The expression follows the dialogue line: each line is read for its
// feeling (worried, serious, determined, relieved, surprised, happy,
// sad, angry) and the speaking character's face shows it while the line
// plays, then relaxes back to neutral between lines. The jaw keeps
// moving for speech exactly as before; brows, lids and smile carry the
// feeling, so the two never fight. Voices, dialogue, lip-sync, story,
// choices and gameplay are unchanged. If a face cannot be built for a
// character, that character simply keeps the old static face and the
// game plays as before.

import * as THREE from './three.module.js';
import { characterKey } from './gestures.js';

// Emotions, as face targets. lift: how far the brows rise, in metres
// (world). tilt: brow tilt in radians, positive lifts the inner end
// (worried, sad). pinch: how far the brows draw together, in metres.
// lid: upper-lid openness, 1 is normal, above 1 is wide open
// (surprised), below 1 is narrowed (determined, angry). smile: mouth
// corner lift, -1 is a full frown, +1 is a full smile.
const EMOTIONS = {
  neutral:    { lift: 0,      tilt: 0,     pinch: 0,     lid: 1,    smile: 0 },
  worried:    { lift: 0.008,  tilt: 0.28,  pinch: 0.001, lid: 1.15, smile: -0.15 },
  serious:    { lift: -0.002, tilt: -0.12, pinch: 0.001, lid: 0.9,  smile: -0.1 },
  determined: { lift: -0.003, tilt: -0.22, pinch: 0.003, lid: 0.7,  smile: 0 },
  relieved:   { lift: 0.002,  tilt: 0.05,  pinch: 0,     lid: 1,    smile: 0.5 },
  surprised:  { lift: 0.012,  tilt: 0.10,  pinch: 0,     lid: 1.35, smile: 0 },
  happy:      { lift: 0.004,  tilt: 0.08,  pinch: 0,     lid: 0.85, smile: 1 },
  sad:        { lift: 0.002,  tilt: 0.35,  pinch: 0.001, lid: 0.95, smile: -0.6 },
  angry:      { lift: -0.004, tilt: -0.38, pinch: 0.004, lid: 0.6,  smile: -0.3 },
};
const NEUTRAL = EMOTIONS.neutral;

// Keyword rules, in order: the first rule whose word appears in the
// line wins. Strong feelings are checked before the common words
// (will, must, go) that appear in almost every determined line.
const EMOTION_RULES = [
  ['happy', ['thank', 'we did it', 'made it', 'you did it', 'alive', 'safe now', 'it worked', 'brilliant', 'great', 'we are out']],
  ['relieved', ['okay', 'ok', 'fine', 'stable', 'holding', 'breathe', 'calm', 'it is over', 'over now', 'you are safe']],
  ['sad', ['sorry', 'lost', 'gone', 'dead', 'died', 'could not save', "couldn't save", 'alone', 'afraid', 'miss', 'goodbye', 'i am so sorry']],
  ['angry', ['damn', 'hell', 'liar', 'lies', 'betray', 'enough', 'never', 'stop it', 'how dare', 'shut']],
  ['worried', ['worried', 'scared', 'fear', 'risk', 'danger', 'might', 'could be', 'not sure', 'what if', 'please', 'careful', 'oh no']],
  ['surprised', ['what', 'how', 'impossible', 'no way', 'wait', 'look at', 'you are joking']],
  ['determined', ['must', 'will', 'go now', 'do it', 'fix', 'hold', 'stay', 'move', 'trust me', 'i will', 'we will', 'now']],
];
export function emotionForLine(text) {
  try {
    const t = String(text || '').toLowerCase();
    if (!t) return 'neutral';
    for (const [name, words] of EMOTION_RULES) {
      for (const w of words) if (t.indexOf(w) !== -1) return name;
    }
    return 'serious';
  } catch (e) { return 'serious'; }
}

// Face geometry. The brow and eye heights are measured from the face
// itself (see measureFace), not assumed, because the Head bone sits at
// the neck and the models' proportions differ. The eyes sit about
// 6.4 cm apart; the brows and lids are sized to read at play distance.
const EYE_HALF_SEP = 0.032;
const BROW_LEN = 0.055;
const BROW_R = 0.008;
const LID_W = 0.034;
const LID_H = 0.005;
const LID_TRAVEL = 0.014; // how far the lid drops from wide open to narrowed
const BROW_COLOUR = 0x20140e;
const LID_COLOUR = 0x140f0c;

// Smoothstep, same shape as the one in lipsync.js.
function smoothstep(a, b, x) {
  if (a === b) return x <= a ? 1 : 0;
  let t = (x - a) / (b - a);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

function isShown(group) {
  let o = group;
  while (o) {
    if (o.visible === false) return false;
    o = o.parent;
  }
  return true;
}

// Measure the face in the character group's local space (the GLB's own
// space, where the model faces +Z and up is +Y). The Head bone is not a
// face landmark in these models: it sits at the neck, 0.27 to 0.57 m
// below the face, so a mouth estimated from it lands on the neck or
// chest. Instead the face is measured from the geometry itself. When
// the model has a Face material (Jade) that mesh is the face surface.
// Otherwise the front slice of the head region is the face: the most
// forward vertices at head height, with the nose band deciding which
// side is the front. Returns null when no face can be found. All
// positions are in group-local space; the caller turns them into world
// positions with group.localToWorld.
function measureFace(group, headBone) {
  try {
    group.updateMatrixWorld(true);
    const invGroup = group.matrixWorld.clone().invert();
    const headLocal = group.worldToLocal(headBone.getWorldPosition(new THREE.Vector3()));
    const meshes = [];
    group.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) meshes.push(o);
    });
    if (!meshes.length) return null;
    // Vertices of each mesh, in group-local space.
    const perMesh = [];
    let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
    const v = new THREE.Vector3();
    for (const mesh of meshes) {
      const rel = new THREE.Matrix4().multiplyMatrices(invGroup, mesh.matrixWorld);
      const pos = mesh.geometry.attributes.position;
      if (!pos) continue;
      const vs = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(rel);
        vs[i * 3] = v.x; vs[i * 3 + 1] = v.y; vs[i * 3 + 2] = v.z;
        if (v.x < bMinX) bMinX = v.x;
        if (v.x > bMaxX) bMaxX = v.x;
        if (v.y < bMinY) bMinY = v.y;
        if (v.y > bMaxY) bMaxY = v.y;
      }
      perMesh.push({ mesh, vs });
    }
    if (!perMesh.length || bMaxY - bMinY <= 0.1) return null;
    const nativeH = bMaxY - bMinY;
    const headTop = bMaxY;
    const headH = 0.13 * nativeH;
    const headCut = headTop - 0.15 * nativeH;
    const centreX = (bMinX + bMaxX) / 2;
    // Face surface z at a height: the most forward vertex near that
    // height and near the face centre. sign is +1 when the face is on
    // the +Z side of the head, -1 when it is on the -Z side. The nose
    // tip is skipped: it is a narrow centreline protrusion that sticks
    // out in front of the lips, cheeks and brow, so taking the plain
    // maximum would put the mouth at the nose tip and the smile and
    // jaw would find no mouth corners behind it.
    // Returns the face-surface depth at a height: the most forward
    // face vertex near that height. The nose tip is skipped by excluding
    // a narrow centreline strip, so the most forward point found is the
    // lip, cheek or brow ridge.
    function surfaceZ(verts, y, cx, sign) {
      let z = sign > 0 ? -Infinity : Infinity;
      for (let i = 0; i < verts.length; i += 3) {
        if (Math.abs(verts[i + 1] - y) > 0.025) continue;
        if (Math.abs(verts[i] - cx) < 0.02) continue;
        if (Math.abs(verts[i] - cx) > 0.09) continue;
        if (sign > 0) { if (verts[i + 2] > z) z = verts[i + 2]; }
        else if (verts[i + 2] < z) z = verts[i + 2];
      }
      return z;
    }
    const faceEntry = perMesh.find((p) => p.mesh.material && p.mesh.material.name === 'Face');
    let faceBottomY, faceTopY, faceCentreX, mouthY, browY, eyeY, mouthZ, browZ, eyeZ, forwardSign, faceMeshes;
    if (faceEntry) {
      const vs = faceEntry.vs;
      let fMinX = Infinity, fMaxX = -Infinity, fMinY = Infinity, fMaxY = -Infinity, fMinZ = Infinity, fMaxZ = -Infinity;
      for (let i = 0; i < vs.length; i += 3) {
        if (vs[i] < fMinX) fMinX = vs[i];
        if (vs[i] > fMaxX) fMaxX = vs[i];
        if (vs[i + 1] < fMinY) fMinY = vs[i + 1];
        if (vs[i + 1] > fMaxY) fMaxY = vs[i + 1];
        if (vs[i + 2] < fMinZ) fMinZ = vs[i + 2];
        if (vs[i + 2] > fMaxZ) fMaxZ = vs[i + 2];
      }
      if (fMaxY - fMinY <= 0.02) return null;
      faceBottomY = fMinY; faceTopY = fMaxY;
      faceCentreX = (fMinX + fMaxX) / 2;
      const faceH = fMaxY - fMinY;
      mouthY = fMinY + 0.22 * faceH;
      browY = fMinY + 0.78 * faceH;
      eyeY = fMinY + 0.55 * faceH;
      forwardSign = ((fMinZ + fMaxZ) / 2 >= headLocal.z) ? 1 : -1;
      const front = forwardSign > 0 ? fMaxZ : fMinZ;
      const sz = (y) => {
        const z = surfaceZ(vs, y, faceCentreX, forwardSign);
        return (z === Infinity || z === -Infinity) ? front : z;
      };
      mouthZ = sz(mouthY);
      browZ = sz(browY);
      eyeZ = sz(eyeY);
      faceMeshes = [faceEntry.mesh];
    } else {
      // Head-region vertices, no hair: the head, near the centreline.
      const headVerts = [];
      for (const p of perMesh) {
        if (p.mesh.material && p.mesh.material.name === 'Hair') continue;
        const vs = p.vs;
        for (let i = 0; i < vs.length; i += 3) {
          if (vs[i + 1] < headCut) continue;
          if (Math.abs(vs[i] - centreX) > 0.15 * nativeH) continue;
          headVerts.push(vs[i], vs[i + 1], vs[i + 2]);
        }
      }
      if (!headVerts.length) return null;
      // The face is on the +Z side of the head. That is the GLTF
      // convention, and the Face mesh proves it for this model family,
      // so it is not derived from a distance: the hair makes the back
      // of the head stick out further from the Head bone than the nose
      // does, so a distance comparison flips the face to the back.
      // The front is the most forward point at nose height: the hair
      // does not reach the nose height in front, so the nose band
      // gives the face front even when the hair is in the head region.
      forwardSign = 1;
      const noseY = headTop - 0.83 * headH;
      let hFront = -Infinity;
      for (let i = 0; i < headVerts.length; i += 3) {
        if (Math.abs(headVerts[i + 1] - noseY) > 0.05) continue;
        if (headVerts[i + 2] > hFront) hFront = headVerts[i + 2];
      }
      if (hFront === -Infinity) return null;
      // Front slice: the most forward vertices, within 10 cm of the
      // front. Its height range is the face, chin to brow. The nose
      // sticks out about 5 cm in front of the lips and chin, so a
      // 5 cm slice only catches the nose tip and puts the mouth at
      // the nose; 10 cm catches the whole face.
      let fMinY = Infinity, fMaxY = -Infinity;
      for (let i = 0; i < headVerts.length; i += 3) {
        const z = headVerts[i + 2];
        if (forwardSign > 0 ? z < hFront - 0.10 : z > hFront + 0.10) continue;
        if (headVerts[i + 1] < fMinY) fMinY = headVerts[i + 1];
        if (headVerts[i + 1] > fMaxY) fMaxY = headVerts[i + 1];
      }
      if (fMaxY - fMinY <= 0.02) return null;
      faceBottomY = fMinY; faceTopY = fMaxY;
      faceCentreX = headLocal.x;
      const faceH = fMaxY - fMinY;
      mouthY = fMinY + 0.22 * faceH;
      browY = fMinY + 0.78 * faceH;
      eyeY = fMinY + 0.55 * faceH;
      const sz = (y) => {
        const z = surfaceZ(headVerts, y, faceCentreX, forwardSign);
        return (z === Infinity || z === -Infinity) ? hFront : z;
      };
      mouthZ = sz(mouthY);
      browZ = sz(browY);
      eyeZ = sz(eyeY);
      faceMeshes = perMesh
        .filter((p) => !(p.mesh.material && p.mesh.material.name === 'Hair'))
        .map((p) => p.mesh);
    }
    // The mouth depth from the face surface sits on the nose side,
    // which sticks out about 4 cm in front of the lips at mouth height.
    // Pull it back to the lips so the jaw and the smile land on the
    // mouth instead of the nose.
    mouthZ -= forwardSign * 0.04;
    return {
      ok: true,
      faceBottomY, faceTopY, faceCentreX,
      mouthY, browY, eyeY, mouthZ, browZ, eyeZ,
      forwardSign, faceMeshes, headH, nativeH,
    };
  } catch (e) { return null; }
}

// Measure the mouth and face forward for a character group, in world
// space, from the face geometry itself. The lip-sync jaw uses this so
// the jaw morph lands on the real mouth instead of the neck. Returns
// { mouthWorld, forward } or null when no face can be found.
export function measureMouthWorld(group) {
  try {
    let headBone = null;
    group.traverse((o) => {
      if (!headBone && o.isBone && o.name === 'Head') headBone = o;
    });
    if (!headBone) return null;
    const fm = measureFace(group, headBone);
    if (!fm || !fm.ok) return null;
    const mouthWorld = group.localToWorld(new THREE.Vector3(fm.faceCentreX, fm.mouthY, fm.mouthZ));
    const gq = group.getWorldQuaternion(new THREE.Quaternion());
    const forward = new THREE.Vector3(0, 0, fm.forwardSign).applyQuaternion(gq);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    return { mouthWorld, forward };
  } catch (e) { return null; }
}

// Add a smile morph to one mesh: the mouth corners rise (smile) or fall
// (frown). Same pattern as the jaw morph in lipsync.js, on the mouth
// corners instead of the chin. Returns the morph index, or -1.
function addSmileMorphToMesh(mesh, mouthWorld, forwardWorld) {
  try {
    const geo = mesh.geometry;
    if (!geo || !geo.attributes || !geo.attributes.position) return -1;
    if (geo.userData && geo.userData.smileMorphDone) {
      mesh.updateMorphTargets();
      const d = mesh.morphTargetDictionary || {};
      return (typeof d.smile === 'number') ? d.smile : -1;
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
    if (count > 200000) return -1;
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
    const upLocal = 0.009 / s;
    const outLocal = 0.003 / s;
    const fwdLocal = 0.002 / s;
    const radial = 0.07 / s;
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const d3 = Math.sqrt((x - mouthLocal.x) * (x - mouthLocal.x) + (y - mouthLocal.y) * (y - mouthLocal.y) + (z - mouthLocal.z) * (z - mouthLocal.z));
      if (d3 > radial) continue;
      const dy = y - mouthLocal.y;
      if (dy > 0.035 / s || dy < -0.035 / s) continue;
      const side = Math.abs((x - hx) * (-fLocal.z) + (z - hz) * fLocal.x);
      if (side < 0.018 / s || side > 0.085 / s) continue; // corners only, not the centre
      const fwd = (x - hx) * fLocal.x + (z - hz) * fLocal.z;
      if (fwd < mouthFwd - 0.03 / s) continue;
      const wv = 1 - smoothstep(0.02 / s, 0.035 / s, Math.abs(dy));
      const wf = smoothstep(mouthFwd - 0.03 / s, mouthFwd - 0.005 / s, fwd);
      const ws = smoothstep(0.018 / s, 0.035 / s, side) * (1 - smoothstep(0.06 / s, 0.085 / s, side));
      const w = wv * wf * ws;
      if (w <= 0) continue;
      if (w > maxW) maxW = w;
      const sideSign = ((x - hx) * (-fLocal.z) + (z - hz) * fLocal.x) >= 0 ? 1 : -1;
      deltas[i * 3] = (-fLocal.z) * sideSign * outLocal * w;
      deltas[i * 3 + 1] = upLocal * w;
      deltas[i * 3 + 2] = fLocal.x * sideSign * outLocal * w + fLocal.z * fwdLocal * w;
    }
    if (maxW < 0.05) return -1;
    const attr = new THREE.BufferAttribute(deltas, 3);
    attr.name = 'smile';
    if (!geo.morphAttributes.position) geo.morphAttributes.position = [];
    geo.morphAttributes.position.push(attr);
    geo.morphTargetsRelative = true;
    if (!geo.userData) geo.userData = {};
    geo.userData.smileMorphDone = true;
    mesh.updateMorphTargets();
    const d = mesh.morphTargetDictionary || {};
    if (typeof d.smile === 'number') {
      mesh.morphTargetInfluences[d.smile] = 0;
      return d.smile;
    }
    return -1;
  } catch (e) { return -1; }
}

// Build one brow or lid rig: an outer group carrying the base transform
// (position and facing, in the parent's local space) and an inner rig
// group that starts at identity, so the animated lift, tilt and pinch
// are clean local moves. Returns { base, rig }.
function makeRig(parent, worldPos, worldQuat, worldScale) {
  const base = new THREE.Group();
  const pq = parent.getWorldQuaternion(new THREE.Quaternion());
  const ps = parent.getWorldScale(new THREE.Vector3());
  if (!ps.x || !ps.y || !ps.z || Math.abs(ps.x) < 1e-6 || Math.abs(ps.y) < 1e-6 || Math.abs(ps.z) < 1e-6) return null;
  base.position.copy(parent.worldToLocal(worldPos.clone()));
  base.quaternion.copy(pq.clone().invert().multiply(worldQuat));
  base.scale.set(worldScale.x / ps.x, worldScale.y / ps.y, worldScale.z / ps.z);
  parent.add(base);
  const rig = new THREE.Group();
  base.add(rig);
  return { base, rig };
}

function browMesh() {
  const m = new THREE.Mesh(
    new THREE.CapsuleGeometry(BROW_R, BROW_LEN - BROW_R * 2, 4, 10),
    new THREE.MeshStandardMaterial({ color: BROW_COLOUR, roughness: 0.95 })
  );
  m.rotation.z = Math.PI / 2; // long axis along X
  m.scale.z = 0.55; // flatten front to back
  m.castShadow = false;
  return m;
}

function lidMesh() {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(LID_W, LID_H, 0.006),
    new THREE.MeshStandardMaterial({ color: LID_COLOUR, roughness: 0.9 })
  );
  m.castShadow = false;
  return m;
}

// Build the face controls for one character group. Returns a controller
// or null when no face can be built (the character keeps a static face).
function buildFaceControls(group, name) {
  try {
    group.updateMatrixWorld(true);
    // The Head bone carries the face for the rigged models.
    let headBone = null;
    group.traverse((o) => {
      if (!headBone && o.isBone && o.name === 'Head') headBone = o;
    });
    if (headBone) {
      const fm = measureFace(group, headBone);
      if (!fm || !fm.ok) return null;
      // Face forward, in world space: the model faces +Z in its own
      // space (or -Z when the measurement says so), turned by the
      // group's world rotation.
      const gq = group.getWorldQuaternion(new THREE.Quaternion());
      const forward = new THREE.Vector3(0, 0, fm.forwardSign).applyQuaternion(gq);
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
      forward.normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(forward, up).normalize();
      // Brow and eye heights, measured from the face itself, capped so
      // the brows can never float above the top of the face and the
      // lids never sink below the eyes.
      let browY = fm.browY, eyeY = fm.eyeY;
      if (browY > fm.faceTopY - 0.005) browY = fm.faceTopY - 0.005;
      if (eyeY > browY - 0.01) eyeY = browY - 0.01;
      if (eyeY < fm.mouthY + 0.02) eyeY = fm.mouthY + 0.02;
      const baseQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward));
      const one = new THREE.Vector3(1, 1, 1);
      // The face points, in group-local space, lifted just off the
      // skin so the brows and lids sit on the face instead of in it.
      // The brows sit 0.004 m off the face surface. The lids need
      // their own offset: the eyeballs bulge in front of the eye
      // centre, so a lid at the brow offset is hidden behind the
      // eyeball. The eyeball centre sits behind the face surface by
      // a different amount per model (Jade 0.004 m, Caleb 0.011 m,
      // Nurse 0.008 m in world), so the lid offset is per character:
      // eyeball radius 0.0225 minus that depth plus 0.002 in front
      // of the eyeball front. Divided by the group scale because
      // these points are in group-local space. The lid rests at the
      // top edge of the eye (eyeY + 0.006), not at the eye centre,
      // so it reads as an upper lid.
      const off = 0.004 * fm.forwardSign;
      const gs = group.scale.x || 1;
      const LID_WORLD_OFF = { jade: 0.021, caleb: 0.013, nurse: 0.017 };
      const lidOff = ((LID_WORLD_OFF[name] || 0.021) / gs) * fm.forwardSign;
      const mouthWorld = group.localToWorld(new THREE.Vector3(fm.faceCentreX, fm.mouthY, fm.mouthZ));
      const browCentre = group.localToWorld(new THREE.Vector3(fm.faceCentreX, browY, fm.browZ + off));
      const lidCentre = group.localToWorld(new THREE.Vector3(fm.faceCentreX, eyeY + 0.006, fm.eyeZ + lidOff));
      const brows = [];
      const lids = [];
      for (const side of [-1, 1]) {
        // side -1 is the character's left brow, +1 the right brow.
        const bx = browCentre.clone().addScaledVector(right, side * EYE_HALF_SEP);
        const br = makeRig(headBone, bx, baseQuat, one);
        if (!br) return null;
        br.rig.add(browMesh());
        brows.push({ rig: br.rig, sideSign: -side });
        const lx = lidCentre.clone().addScaledVector(right, side * EYE_HALF_SEP);
        const lr = makeRig(headBone, lx, baseQuat, one);
        if (!lr) return null;
        lr.rig.add(lidMesh());
        lids.push({ rig: lr.rig });
      }
      // Smile morph on the face meshes, at the mouth corners.
      const smileMeshes = [];
      for (const mesh of fm.faceMeshes) {
        const idx = addSmileMorphToMesh(mesh, mouthWorld, forward);
        if (idx >= 0) smileMeshes.push({ mesh, index: idx });
      }
      return {
        key: name, group, headBone, brows, lids, smileMeshes,
        cur: { lift: 0, tilt: 0, pinch: 0, lid: 1, smile: 0 },
        target: { lift: 0, tilt: 0, pinch: 0, lid: 1, smile: 0 },
      };
    }
    // No Head bone (Walter, the seated scan): the teeth mesh marks the
    // mouth, and the scan already has its own eyebrow mesh, so animate
    // that mesh instead of adding new brows.
    let teeth = null, browMeshFound = null;
    group.traverse((o) => {
      if (!o.isMesh) return;
      const n = (o.name || '').toLowerCase();
      if (!teeth && n.indexOf('teeth') !== -1) teeth = o;
      if (!browMeshFound && n.indexOf('eyebrow') !== -1) browMeshFound = o;
    });
    if (!teeth) return null;
    const mouthWorld = new THREE.Box3().setFromObject(teeth).getCenter(new THREE.Vector3());
    const gq = new THREE.Quaternion();
    group.getWorldQuaternion(gq);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(gq);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    const smileMeshes = [];
    const cands = [];
    group.traverse((o) => {
      if (!o.isMesh) return;
      if (o.name && o.name.indexOf('Bench') === 0) return;
      const box = new THREE.Box3().setFromObject(o);
      if (box.min.x - 0.06 > mouthWorld.x || box.max.x + 0.06 < mouthWorld.x) return;
      if (box.min.y - 0.06 > mouthWorld.y || box.max.y + 0.06 < mouthWorld.y) return;
      if (box.min.z - 0.06 > mouthWorld.z || box.max.z + 0.06 < mouthWorld.z) return;
      cands.push(o);
    });
    for (const mesh of cands) {
      const idx = addSmileMorphToMesh(mesh, mouthWorld, forward);
      if (idx >= 0) smileMeshes.push({ mesh, index: idx });
    }
    // Wrap the scan's own eyebrow mesh in a pivot at its own transform,
    // so it renders exactly as before and can be lifted and tilted.
    let walterBrow = null;
    if (browMeshFound && browMeshFound.parent) {
      try {
        // The pivot's lift is in its parent's local units, so measure
        // the parent's world scale first: it converts world metres to
        // the parent's local units.
        const meshParent = browMeshFound.parent;
        const parentScale = meshParent.getWorldScale(new THREE.Vector3());
        const pivot = new THREE.Group();
        pivot.position.copy(browMeshFound.position);
        pivot.quaternion.copy(browMeshFound.quaternion);
        pivot.scale.copy(browMeshFound.scale);
        meshParent.add(pivot);
        browMeshFound.position.set(0, 0, 0);
        browMeshFound.quaternion.identity();
        browMeshFound.scale.set(1, 1, 1);
        pivot.add(browMeshFound);
        walterBrow = { rig: pivot, parentScaleY: Math.abs(parentScale.y) || 1 };
      } catch (e) { walterBrow = null; }
    }
    return {
      key: name, group, headBone: null, brows: [], lids: [], smileMeshes,
      walterBrow,
      cur: { lift: 0, tilt: 0, pinch: 0, lid: 1, smile: 0 },
      target: { lift: 0, tilt: 0, pinch: 0, lid: 1, smile: 0 },
    };
  } catch (e) { return null; }
}

const faces = new Map(); // key -> controller
let rafStarted = false;
let lastNow = 0;

export function registerFaceHumans(humans) {
  try {
    if (!humans || !humans.length) return;
    for (const h of humans) {
      if (!h || !h.group || !h.name) continue;
      if (faces.has(h.name)) continue;
      const c = buildFaceControls(h.group, h.name);
      if (c) faces.set(h.name, c);
    }
    startLoop();
  } catch (e) { /* faces are best effort */ }
}

export function setSpeakingFace(who, text) {
  try {
    const key = characterKey(who);
    const emo = EMOTIONS[emotionForLine(text)] || NEUTRAL;
    for (const [k, c] of faces) {
      c.target = (k === key) ? emo : NEUTRAL;
    }
  } catch (e) { /* ignore */ }
}

export function clearFace() {
  try {
    for (const c of faces.values()) c.target = NEUTRAL;
  } catch (e) { /* ignore */ }
}

// Ease one controller toward its target and apply it. Exported so tests
// can drive it without a browser animation loop.
export function updateFaces(dt) {
  try {
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;
    const k = 1 - Math.exp(-7 * dt);
    for (const c of faces.values()) {
      const cur = c.cur, tgt = c.target;
      cur.lift += (tgt.lift - cur.lift) * k;
      cur.tilt += (tgt.tilt - cur.tilt) * k;
      cur.pinch += (tgt.pinch - cur.pinch) * k;
      cur.lid += (tgt.lid - cur.lid) * k;
      cur.smile += (tgt.smile - cur.smile) * k;
      if (Math.abs(cur.lift) < 0.0002) cur.lift = 0;
      if (Math.abs(cur.tilt) < 0.002) cur.tilt = 0;
      if (Math.abs(cur.pinch) < 0.0002) cur.pinch = 0;
      if (Math.abs(cur.lid - 1) < 0.005) cur.lid = 1;
      if (Math.abs(cur.smile) < 0.005) cur.smile = 0;
      const shown = c.group ? isShown(c.group) : false;
      for (const b of c.brows) {
        b.rig.position.y = cur.lift;
        b.rig.position.x = cur.pinch * b.sideSign;
        b.rig.rotation.z = cur.tilt * b.sideSign;
      }
      for (const l of c.lids) {
        // Lid 1 is neutral, above 1 is wide open (surprised, the lid
        // rises) and below 1 is narrowed (angry, the lid drops). The
        // old sign was backwards: surprised dropped the lid and angry
        // raised it.
        l.rig.position.y = (cur.lid - 1) * LID_TRAVEL;
      }
      if (c.walterBrow) {
        const w = c.walterBrow;
        w.rig.position.y = cur.lift / w.parentScaleY;
        w.rig.rotation.z = cur.tilt * 0.5;
      }
      for (const m of c.smileMeshes) {
        if (!m.mesh) continue;
        if (!m.mesh.morphTargetInfluences) {
          try { m.mesh.updateMorphTargets(); } catch (e) { /* ignore */ }
        }
        if (m.mesh.morphTargetInfluences && m.index >= 0) {
          m.mesh.morphTargetInfluences[m.index] = shown ? cur.smile : 0;
        }
      }
    }
  } catch (e) { /* never break the game */ }
}

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
        updateFaces(dt);
      } catch (e) { /* never break the game */ }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch (e) { /* loop is best effort */ }
}
