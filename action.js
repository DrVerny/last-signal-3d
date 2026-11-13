// THE LAST SIGNAL - small shared helpers for the action sequences.
// The action banner (a persistent goal line during a run or chase) and
// the hit flash (a full-screen colour pulse) are created lazily in code,
// so no HTML edits are needed for them. Everything here is guarded:
// if the DOM is unavailable, the helpers are silent no-ops.

import * as THREE from 'three';
import { makeRiggedPerson, updateRiggedPerson, queueUpgrade, processUpgradeQueue } from './crowd.js';

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

// ---------------------------------------------------------------------------
// Mission briefing card. Every mission starts with a short card that says
// WHY: who asked, what is wrong, and what is at stake. Shown before the
// intro dialogue. opts: { title, calledBy, problem, stakes }.
// onStart runs when the player clicks "Start mission".
// ---------------------------------------------------------------------------
let briefingEl = null, briefingStart = null;

function ensureBriefing() {
  if (briefingEl) return briefingEl;
  try {
    briefingEl = document.createElement('div');
    briefingEl.id = 'missionBriefing';
    briefingEl.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;' +
      'justify-content:center;z-index:30;background:rgba(4,8,12,0.72);padding:14px;';
    briefingEl.innerHTML =
      '<div style="max-width:560px;width:100%;background:#0b1118;border:1px solid #ffd166;' +
      'border-radius:14px;padding:20px 22px;color:#f2e9d8;box-shadow:0 10px 40px rgba(0,0,0,0.6);">' +
      '<div id="briefTitle" style="color:#ffd166;font-size:20px;letter-spacing:2px;' +
      'text-transform:uppercase;margin-bottom:12px;"></div>' +
      '<div style="font-size:15px;line-height:1.55;">' +
      '<p style="margin:0 0 10px;"><span style="color:#ffd166;">Called in by:</span> ' +
      '<span id="briefBy"></span></p>' +
      '<p style="margin:0 0 10px;"><span style="color:#ffd166;">The problem:</span> ' +
      '<span id="briefProblem"></span></p>' +
      '<p style="margin:0 0 16px;"><span style="color:#ffd166;">What is at stake:</span> ' +
      '<span id="briefStakes"></span></p></div>' +
      '<button id="briefStart" style="background:#ffd166;color:#111;border:0;border-radius:8px;' +
      'padding:11px 22px;font-size:16px;cursor:pointer;width:100%;">Start mission</button>' +
      '</div>';
    document.body.appendChild(briefingEl);
    const btn = briefingEl.querySelector('#briefStart');
    if (btn) btn.addEventListener('click', () => {
      hideBriefing();
      if (briefingStart) { const fn = briefingStart; briefingStart = null; fn(); }
    });
  } catch (e) { briefingEl = null; }
  return briefingEl;
}

export function showBriefing(opts, onStart) {
  const el = ensureBriefing();
  if (!el) { if (onStart) onStart(); return; }
  try {
    el.querySelector('#briefTitle').textContent = opts.title || 'Mission briefing';
    el.querySelector('#briefBy').textContent = opts.calledBy || '';
    el.querySelector('#briefProblem').textContent = opts.problem || '';
    el.querySelector('#briefStakes').textContent = opts.stakes || '';
    briefingStart = onStart || null;
    el.style.display = 'flex';
  } catch (e) { if (onStart) onStart(); }
}

export function hideBriefing() {
  try { if (briefingEl) briefingEl.style.display = 'none'; } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Pedestrians. A busy crowd like the reference video (a top-down plaza):
// everyone walks at a DIFFERENT pace (older people stroll, younger people
// walk briskly), in different directions, crossing each other's paths and
// flowing around each other, some alone and some in pairs or small groups
// side by side at the same pace, with natural arm swing, some looking
// down at a phone, some carrying shopping bags, some with hands in
// pockets, some with a bag over the shoulder, in varied coats and
// colours (black coats, brown jackets, a red coat, blue jeans, beige).
// They walk continuously across the space, entering and leaving, never
// standing still. No two walk at the same speed and nobody marches in
// lockstep: each pedestrian has its own pace and its own limb phase.
// The walk is procedural (legs, arms, bob, sway) so the crowd can have
// that variety; the rigged Walk clips only exist for the three main
// characters (Jade, Caleb, Nurse), and using them for pedestrians would
// turn the crowd into clones of the player characters.
// ---------------------------------------------------------------------------
// Coat colours from the video: black coats, dark navy, brown jackets,
// red coat, beige puffer, green jacket, grey, dark purple.
const PED_COATS = [0x1a1a1a, 0x1a1a1a, 0x222f45, 0x5a3a22, 0x8a2a22, 0xc8b89a, 0x3a5a3a, 0x555555, 0x3a2a4a, 0x6a4a2e];
const PED_LEGS = [0x2a4a6a, 0x1a1a1a, 0x3a2a1a, 0x555555, 0x2a4a6a, 0x1a1a1a];
const PED_HAIR = [0x1a1a1a, 0x3a2a1a, 0x5a5a5a, 0x8a8a8a];
const PED_BAGS = [0xf2f2f2, 0x2a6ab0, 0xc02a2a, 0x2a8a7a, 0xd8b13a];
const PED_SKINS = [0xc9a17a, 0x8a5a3a, 0xe8c8a8, 0x6a3a22];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export function makePedestrian(opts) {
  try {
    // Realistic people first: if a rigged crowd model is loaded, build a
    // real person from it (proper proportions, real walk cycle). If the
    // models are not loaded yet, build the primitive figure below and
    // queue it for an upgrade to a rigged clone when they arrive.
    try {
      const rigged = makeRiggedPerson(opts);
      if (rigged) return rigged;
    } catch (e) { /* fall through to the primitive figure */ }
    const o = opts || {};
    const age = o.age || (Math.random() < 0.2 ? 'old' : Math.random() < 0.5 ? 'young' : 'adult');
    const coat = o.coat !== undefined ? o.coat : Math.random() < 0.55;
    const phone = o.phone || false;
    const pockets = o.pockets || false;
    const shoulderBag = o.shoulderBag || false;
    const bags = o.bags || 0;
    // Pace by age, with a random factor so no two people share a speed:
    // old people stroll (0.55-0.75 m/s), adults walk (0.9-1.2), the young
    // walk briskly (1.3-1.65). A phone slows the walker down.
    let speed = o.speed;
    if (speed === undefined) {
      speed = age === 'old' ? 0.55 + Math.random() * 0.2 : age === 'young' ? 1.3 + Math.random() * 0.35 : 0.9 + Math.random() * 0.3;
    }
    if (phone) speed *= 0.75;
    const scale = o.scale !== undefined ? o.scale : (age === 'old' ? 0.94 + Math.random() * 0.04 : 0.96 + Math.random() * 0.12);
    const width = o.width !== undefined ? o.width : 0.9 + Math.random() * 0.25;
    const coatColor = o.coatColor !== undefined ? o.coatColor : pick(PED_COATS);
    const legColor = o.legColor !== undefined ? o.legColor : pick(PED_LEGS);
    const hairColor = age === 'old' ? pick([0xd8d8d8, 0x8a8a8a]) : pick(PED_HAIR);
    const skinColor = o.skinColor !== undefined ? o.skinColor : pick(PED_SKINS);

    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: coatColor, roughness: 0.9 });
    const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.8 });
    const legMat = new THREE.MeshStandardMaterial({ color: legColor, roughness: 0.9 });
    // A coat is a longer body (shoulders to knees); a jacket is shorter.
    const bodyH = coat ? 0.95 : 0.68;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.44 * width, bodyH, 0.28), bodyMat);
    body.position.y = coat ? 0.95 : 1.08; g.add(body);
    // Head in a group so it can tilt down (phone users look at the phone).
    const headGroup = new THREE.Group();
    headGroup.position.y = 1.5;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), skinMat);
    head.position.y = 0.12; headGroup.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.95 }));
    hair.scale.set(1, 0.65, 1); hair.position.set(0, 0.2, -0.02); headGroup.add(hair);
    if (phone) headGroup.rotation.x = 0.45; // head down, looking at the phone
    g.add(headGroup);
    const legL = new THREE.Group(); legL.position.set(-0.11, 0.78, 0);
    const legLm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.72, 0.14), legMat);
    legLm.position.y = -0.36; legL.add(legLm); g.add(legL);
    const legR = new THREE.Group(); legR.position.set(0.11, 0.78, 0);
    const legRm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.72, 0.14), legMat);
    legRm.position.y = -0.36; legR.add(legRm); g.add(legR);
    const armL = new THREE.Group(); armL.position.set(-0.27 * width, 1.36, 0);
    const armLm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.1), bodyMat);
    armLm.position.y = -0.26; armL.add(armLm); g.add(armL);
    const armR = new THREE.Group(); armR.position.set(0.27 * width, 1.36, 0);
    const armRm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.1), bodyMat);
    armRm.position.y = -0.26; armR.add(armRm); g.add(armR);
    // A phone in the right hand, held up in front of the chest.
    let phoneMesh = null;
    if (phone) {
      armR.rotation.x = -1.0; armR.rotation.z = -0.25;
      phoneMesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.02), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.5 }));
      phoneMesh.position.set(0, -0.55, 0.06); armR.add(phoneMesh);
    }
    // Shopping bags in the hand(s): bright colours, hanging from the hand.
    const bagMeshes = [];
    const bagCount = bags;
    if (bagCount >= 1) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.08), new THREE.MeshStandardMaterial({ color: pick(PED_BAGS), roughness: 0.8 }));
      b.position.set(0, -0.68, 0); armL.add(b); bagMeshes.push(b);
    }
    if (bagCount >= 2) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.08), new THREE.MeshStandardMaterial({ color: pick(PED_BAGS), roughness: 0.8 }));
      b.position.set(0, -0.68, 0); armR.add(b); bagMeshes.push(b);
    }
    // A bag over the shoulder, on the hip.
    if (shoulderBag) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 0.08), new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.85 }));
      b.position.set(0.26 * width, 0.95, 0); g.add(b);
    }
    // Hands in pockets: both arms hang straight, no swing.
    if (pockets) { armL.rotation.x = 0; armR.rotation.x = 0; }
    g.scale.set(scale, scale, scale);
    // A slight forward stoop for older walkers.
    if (age === 'old') g.rotation.x = 0.05;

    const heading = o.heading !== undefined ? o.heading : Math.random() * Math.PI * 2;
    const bounds = o.bounds || { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
    const lane = o.lane || null; // { axis: 'x'|'z', fixed, min, max }
    const person = {
      group: g, legL, legR, armL, armR, headGroup, bagMeshes,
      phone, pockets, bags: bagCount, age,
      heading, bounds, lane,
      x: o.x !== undefined ? o.x : (lane ? (Math.random() * (lane.max - lane.min) + lane.min) : (Math.random() * (bounds.maxX - bounds.minX) + bounds.minX)),
      z: o.z !== undefined ? o.z : (lane ? lane.fixed : (Math.random() * (bounds.maxZ - bounds.minZ) + bounds.minZ)),
      speed, phase: Math.random() * 6.28,
      leader: o.leader || null, latOffset: o.latOffset || 0
    };
    // Queue this primitive for an upgrade to a rigged person when the
    // crowd models finish loading.
    try { queueUpgrade(person); } catch (e) { /* ignore */ }
    return person;
  } catch (e) { return null; }
}

// Walk a pedestrian one step. A follower walks with its leader (same
// speed and heading, offset to the side) but keeps its own limb phase,
// so a group walks together without marching in lockstep. A free walker
// crosses the space and wraps to the opposite edge when it leaves, so
// the crowd keeps entering and leaving like the video. A lane walker
// stays on its sidewalk and wraps at the ends.
export function updatePedestrian(p, dt) {
  if (!p || !p.group) return;
  // Try to upgrade any primitive pedestrians to rigged models, now
  // that the models may have finished loading.
  try { processUpgradeQueue(); } catch (e) { /* ignore */ }
  if (p.leader) {
    const l = p.leader;
    const lx = Math.cos(l.heading), lz = -Math.sin(l.heading); // lateral
    p.x = l.x + lx * p.latOffset;
    p.z = l.z + lz * p.latOffset;
    p.heading = l.heading;
    p.speed = l.speed;
  } else {
    p.x += Math.sin(p.heading) * p.speed * dt;
    p.z += Math.cos(p.heading) * p.speed * dt;
    if (p.lane) {
      const ln = p.lane;
      if (ln.axis === 'x') {
        if (p.x > ln.max) p.x = ln.min;
        if (p.x < ln.min) p.x = ln.max;
        p.z = ln.fixed;
      } else {
        if (p.z > ln.max) p.z = ln.min;
        if (p.z < ln.min) p.z = ln.max;
        p.x = ln.fixed;
      }
    } else {
      const b = p.bounds;
      if (p.x > b.maxX) p.x = b.minX;
      if (p.x < b.minX) p.x = b.maxX;
      if (p.z > b.maxZ) p.z = b.minZ;
      if (p.z < b.minZ) p.z = b.maxZ;
    }
  }
  // The limb swing is tied to the walking speed (a brisk walk swings
  // faster than a stroll) and each pedestrian has its own phase, so no
  // two people step together.
  p.phase += dt * p.speed * 4.5;
  if (p.rigged) {
    // A rigged person walks with their own Walk clip, not the primitive
    // limb swing. The models face -z, so add PI to face the movement
    // direction (the primitive figure faces +z).
    updateRiggedPerson(p, dt);
    p.group.position.set(p.x, Math.abs(Math.sin(p.phase)) * 0.03, p.z);
    p.group.rotation.y = p.heading + Math.PI;
    p.group.rotation.z = 0;
    return;
  }
  p.group.position.set(p.x, Math.abs(Math.sin(p.phase)) * 0.03, p.z);
  p.group.rotation.y = p.heading;
  // A slight side-to-side sway, like a real walk.
  p.group.rotation.z = Math.sin(p.phase) * 0.02;
  const swing = Math.sin(p.phase) * 0.55;
  p.legL.rotation.x = swing;
  p.legR.rotation.x = -swing;
  if (p.pockets) {
    p.armL.rotation.x = 0; p.armR.rotation.x = 0; // hands in pockets
  } else if (p.phone) {
    p.armL.rotation.x = -swing * 0.8; // one arm swings, the phone arm stays up
    p.armR.rotation.x = -1.0;
  } else {
    // A bag weighs the arm down: it swings less.
    p.armL.rotation.x = p.bags >= 1 ? -swing * 0.4 : -swing * 0.8;
    p.armR.rotation.x = p.bags >= 2 ? swing * 0.4 : swing * 0.8;
  }
  for (const b of p.bagMeshes) b.rotation.x = Math.sin(p.phase + 0.6) * 0.25;
}

// A group of 2-3 pedestrians walking side by side at the same pace,
// like the pairs and trios in the video (chatting, same slow pace).
// Returns the array; the first is the leader, the rest follow it.
export function makePedestrianGroup(n, opts) {
  const o = opts || {};
  const out = [];
  if (!n || n < 2) return out;
  // Groups stroll: the same slow pace for everyone in the group.
  const speed = o.speed !== undefined ? o.speed : 0.7 + Math.random() * 0.25;
  const heading = o.heading !== undefined ? o.heading : Math.random() * Math.PI * 2;
  const leader = makePedestrian(Object.assign({}, o, { speed, heading }));
  if (!leader) return out;
  out.push(leader);
  for (let i = 1; i < n; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const dist = 0.55 * Math.ceil(i / 2);
    const f = makePedestrian(Object.assign({}, o, { speed, heading, leader, latOffset: side * dist }));
    if (f) out.push(f);
  }
  return out;
}

// Spawn a whole crowd in an area: a mix of singles and groups, with
// varied ages, coats, phones, bags and pockets, walking in different
// directions at different paces. opts: { count, bounds, lane } - a lane
// makes them walk along a sidewalk, a bounds makes them cross a plaza.
// Returns the array of pedestrians (add each .group to the scene).
export function makeCrowd(opts) {
  const o = opts || {};
  const count = o.count || 10;
  const out = [];
  let i = 0;
  while (i < count) {
    const r = Math.random();
    if (r < 0.3 && count - i >= 2) {
      // A pair or a trio, side by side.
      const n = Math.random() < 0.6 ? 2 : 3;
      const grp = makePedestrianGroup(n, o);
      for (const p of grp) out.push(p);
      i += grp.length;
    } else {
      const q = Math.random();
      const p = makePedestrian(Object.assign({}, o, {
        phone: q < 0.14,
        pockets: q >= 0.14 && q < 0.28,
        bags: q >= 0.28 && q < 0.42 ? 1 : q >= 0.42 && q < 0.48 ? 2 : 0,
        shoulderBag: q >= 0.48 && q < 0.6
      }));
      if (p) out.push(p);
      i++;
    }
  }
  return out;
}
