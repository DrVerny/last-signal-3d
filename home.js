// THE LAST SIGNAL - homes and visitable places.
// First-person 3D rooms and exteriors on the shared renderer (core.js).
// The act manager pauses the current act while a place is open and resumes
// it when the player leaves, so no mission progress is lost.
// The Hospital is built from the photo the user sent: a tall white tower
// with a rounded corner and rows of windows, plus a lower white wing, under
// a blue sky. The other big buildings use the same clean white modern style
// with rows of windows. Shapes are built in 3D (boxes/cylinders); the photo
// is a reference only, never a texture.

import * as THREE from 'three';
import { canvas, renderer, disposeScene } from './core.js';
import { getBalance, moneyFmt, grantPayout } from './economy.js';
import { makeCrowd, makePedestrian, updatePedestrian, showBriefing } from './action.js';
import { makeSeatedPerson, updateSeatedPerson, onCrowdReady } from './crowd.js';
import { moveDelta, applyPlayerPresence, beginPlayerFrame, buildCar, hasKey, giveKey, getAvatar, setAvatarPose, detachAvatar } from './player.js';
import { readingTimeMs } from './speak.js';

let homeActive = false, homeRaf = 0, homeScene = null, homeCamera = null;
let homeKind = null, homeOnLeave = null;
let homeYaw = 0, homePitch = 0;
let homeBounds = { x: [-6, 6], z: [-4, 4] };
let homeStart = { x: 0, y: 1.7, z: 4, yaw: 0 };
// Walkable exit doors: each room has a real, visible door the player
// walks up to and through to leave, instead of only a UI button. A door
// is { x, z, ry, keyId, keyLabel, action, label, panel, glow }. The
// button stays as a backup. A locked door needs its key first; the key
// is always findable inside the room, so the player can never get stuck.
let homeDoors = [];
let homeDoorLockedAt = -10; // throttle for the "locked" toast at a door
// Room keys: small glowing key pickups inside a room, one per locked
// door. Each is { x, z, keyId, keyLabel, group, label }.
let homeRoomKeys = [];
// Ceiling fans: the spinning blade groups, so homeAnimate can turn them.
let homeFans = [];
// Wind tunnel lab: the tunnel fan blades, the gauge needle and reading,
// and the run state. The fan spins up when the player runs the tunnel.
let tunnelFan = null, tunnelGaugeNeedle = null, tunnelGaugeCanvas = null, tunnelGaugeTex = null;
let tunnelRunning = false, tunnelRunT = 0, tunnelDone = false;
// Symposium hall: the seated audience, for the idle sway.
let symposiumAudience = [];
let symposiumAudienceBuilt = false;
let podiumDone = false;
// Police station / Navy barracks: officers and sailors walking the room.
let roomWalkers = [];
// Sensor vault: blinking sensor lights, gauge needles and readouts.
let vaultBlinkers = [];
let vaultNeedles = [];
let vaultReadouts = [];
let vaultReadAt = -100;
// Uniformed forces: a police officer or a sailor, built from a normal
// pedestrian (rigged if the crowd models are loaded, primitive if not)
// with a cap, a badge or neckerchief, and a recoloured uniform. The cap
// and badge sit on the front of the body: rigged models face -z, the
// primitive figure faces +z. The uniform is tracked on the person, so
// if the crowd upgrade swaps the body for a rigged one later, the
// uniform can be re-applied (see updateOfficer).
const OFFICER_SKINS = [0x2a1a12, 0x6b4a2f, 0xc89b7a, 0xe8b88a];
function dressUniform(p, kind) {
  if (!p || !p.group) return;
  const front = p.rigged ? -1 : 1;
  const old = [];
  p.group.traverse(o => { if (o.userData && o.userData.uniformPart) old.push(o); });
  for (const o of old) { if (o.parent) o.parent.remove(o); }
  const g = p.group;
  if (kind === 'police') {
    const capMat = new THREE.MeshStandardMaterial({ color: 0x1a2a4a, roughness: 0.85 });
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.09, 12), capMat);
    crown.position.set(0, 1.7, 0); crown.userData.uniformPart = true; g.add(crown);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, 0.14), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }));
    brim.position.set(0, 1.66, front * 0.17); brim.userData.uniformPart = true; g.add(brim);
    const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 12), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.25 }));
    badge.rotation.x = Math.PI / 2; badge.position.set(-0.1, 1.28, front * 0.16); badge.userData.uniformPart = true; g.add(badge);
    g.traverse(o => { if (o.isMesh && o.material && o.material.name && o.material.name.indexOf('casualsuit') !== -1) o.material = new THREE.MeshStandardMaterial({ color: 0x1a2a4a, roughness: 0.9 }); });
  } else if (kind === 'navy') {
    const capMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.85 });
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.12, 12), capMat);
    cup.position.set(0, 1.7, 0); cup.userData.uniformPart = true; g.add(cup);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.03), new THREE.MeshStandardMaterial({ color: 0x1a2a4a, roughness: 0.9 }));
    neck.position.set(0, 1.42, front * 0.15); neck.userData.uniformPart = true; g.add(neck);
    g.traverse(o => { if (o.isMesh && o.material && o.material.name && o.material.name.indexOf('casualsuit') !== -1) o.material = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.9 }); });
  }
  p.uniform = kind; p.uniformGroup = p.group;
}
function makeOfficer(kind, opts) {
  const o = Object.assign({}, opts);
  if (kind === 'police') { o.coatColor = 0x1a2a4a; o.legColor = 0x141c28; }
  else { o.coatColor = 0xf2f2f2; o.legColor = 0xe8e8e8; }
  if (o.skinColor === undefined) o.skinColor = OFFICER_SKINS[Math.floor(Math.random() * OFFICER_SKINS.length)];
  const p = makePedestrian(o);
  if (p) dressUniform(p, kind);
  return p;
}
function updateOfficer(p, dt) {
  if (!p) return;
  updatePedestrian(p, dt);
  if (p.uniform && p.group !== p.uniformGroup) dressUniform(p, p.uniform);
}
// The bed the player sleeps in, for the sleep view: { x, z, w }.
let currentBedPos = null;
// Sleeping: while true the avatar lies on the bed and the camera shows
// him from the bedside. sleepRestDone marks the rest as saved.
let sleeping = false, sleepT = 0, sleepRestDone = false;
let homeTargets = [];
let homeDragging = false, homeLx = 0, homeLy = 0, homeDragMoved = 0;
const homeKeys = {};

window.__lsHomeActive = false;

// Prologue: the game opens in the player's room (the Mansion) with the
// phone ringing. Jade calls with the reason for the first mission, then
// the player goes to the Train Terminal and boards the 4 train, which
// starts Act I. The terminal is also a map destination in Act II.
let homePrologue = false, homeCallDone = false, prologueOnBoardTrain = null;
let ringing = false, ringInterval = 0, ringCtx = null;
let phoneGlow = null;
// Prologue bed-to-couch sequence: the player wakes in bed, stands up,
// walks to the couch, sits down, and answers the phone on the couch.
// prologueInBed: lying in bed (movement paused, "Stand up" shown).
// prologueSeated: sitting on the couch (movement paused, "Stand up" shown).
// callActive: the call is in progress (guards answerPhone against a double tap/swipe).
let prologueInBed = false, prologueSeated = false, callActive = false;
// Phone swipe: a press that starts on the phone (tap or swipe) answers it.
let phoneDown = false;
// Phone booth (wind tunnel lab): throttle for the walk-up briefing.
let boothBriefAt = -100;
// The couch: where the player sits, and where the phone lies beside him.
const COUCH_SIT = { x: 0.6, z: -0.2 };
const COUCH_PHONE = { x: -0.2, z: -0.2 };
let terminalPedestrians = [];
let callLines = [], callIdx = 0;

// A soft radial glow texture, for the ringing phone and the platform sign.
function glowTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// The phone ring: two short beeps, repeating. Web Audio, guarded.
function ringOnce() {
  try {
    if (!ringCtx) ringCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (ringCtx.state === 'suspended') ringCtx.resume();
    const t0 = ringCtx.currentTime;
    for (const start of [0, 0.25]) {
      const osc = ringCtx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = 1250;
      const g = ringCtx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(0.06, t0 + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + 0.2);
      osc.connect(g); g.connect(ringCtx.destination);
      osc.start(t0 + start); osc.stop(t0 + start + 0.22);
    }
  } catch (e) { /* no audio - the phone still flashes */ }
}
function startRinging() {
  if (ringing) return;
  ringing = true;
  ringOnce();
  ringInterval = setInterval(() => { if (ringing) ringOnce(); }, 2200);
}
function stopRinging() {
  ringing = false;
  if (ringInterval) { clearInterval(ringInterval); ringInterval = 0; }
  if (phoneGlow) phoneGlow.visible = false;
}
// The opening phone call: Jade calls with the reason for the first
// mission. A small overlay with her lines. The lines advance by
// themselves on a reading-time delay, so nobody has to click Continue;
// the Continue button stays as a skip that jumps to the next line at once.
let callEl = null;
let callTimer = null; // pending auto-advance for the current call line
let callToken = 0; // invalidates a pending auto-advance when the call is skipped or ends
function endCall() {
  if (callTimer) { clearTimeout(callTimer); callTimer = null; }
  callToken++;
  callActive = false;
  if (callEl) callEl.style.display = 'none';
  homeCallDone = true;
  showHomeBar(homeKind); // the "Go to the Train Terminal" button appears
  showHomeToast('Jade hung up. Go to the Train Terminal and board the 4 train.');
}
function showCallLine() {
  const textEl = document.getElementById('callText');
  if (textEl) textEl.textContent = callLines[callIdx];
  // Advance by itself after the line has been read. The Continue button
  // cancels this pending advance because advanceCall() invalidates the token.
  const myToken = callToken;
  if (callTimer) clearTimeout(callTimer);
  callTimer = setTimeout(() => {
    callTimer = null;
    if (myToken !== callToken) return;
    advanceCall();
  }, readingTimeMs(callLines[callIdx]));
}
function advanceCall() {
  if (callTimer) { clearTimeout(callTimer); callTimer = null; }
  callToken++;
  callIdx++;
  if (callIdx >= callLines.length) { endCall(); return; }
  showCallLine();
}
function ensureCallOverlay() {
  if (callEl) return callEl;
  try {
    callEl = document.createElement('div');
    callEl.id = 'phoneCall';
    callEl.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:35;background:rgba(4,8,12,0.6);padding:14px;';
    callEl.innerHTML =
      '<div style="max-width:520px;width:100%;background:#0b1118;border:1px solid #ffd166;border-radius:14px;padding:20px 22px;color:#f2e9d8;box-shadow:0 10px 40px rgba(0,0,0,0.6);">'
      + '<div style="color:#7ac74f;font-size:14px;letter-spacing:2px;text-transform:uppercase;">Incoming call - Jade Morales</div>'
      + '<div id="callText" style="font-size:17px;line-height:1.6;margin:12px 0 16px;"></div>'
      + '<button id="callNext" type="button" style="background:#ffd166;color:#111;border:0;border-radius:8px;padding:11px 22px;font-size:16px;cursor:pointer;width:100%;">Continue</button>'
      + '</div>';
    document.body.appendChild(callEl);
    document.getElementById('callNext').addEventListener('click', () => { advanceCall(); });
  } catch (e) { callEl = null; }
  return callEl;
}
function answerPhone() {
  // Guard against a double tap/swipe answering twice: the call is already in progress.
  if (homeCallDone || callActive) return;
  callActive = true;
  stopRinging();
  callLines = [
    'Jade here. The 4 train is losing power - the whole line is going dark and the passengers are stuck.',
    'I need you on that train. Get to the train terminal and board the 4. The relay is failing - you are the one who can fix it.',
    'I will talk you through it on the radio. Go - now.'
  ];
  callIdx = 0;
  const el = ensureCallOverlay();
  if (!el) { callActive = false; homeCallDone = true; showHomeBar(homeKind); return; }
  showCallLine(); // first line shows, then advances by itself
  el.style.display = 'flex';
}
// Prologue sequence: stand up from the bed, or from the couch. The
// player is placed standing at eye height next to where he was, and
// normal walking takes over from there. The call stays answerable on
// the phone itself whether he is standing or sitting.
function standUp() {
  const wasInBed = prologueInBed, wasSeated = prologueSeated;
  if (!wasInBed && !wasSeated) return;
  prologueInBed = false; prologueSeated = false;
  try { const a = getAvatar(); setAvatarPose('stand'); detachAvatar(); } catch (e) { /* ignore */ }
  if (homeCamera) {
    // From bed: stand on the floor BESIDE the bed, at its south-east
    // corner (east of the bed edge, south of the foot, clear of the
    // partition), facing the couch - never on top of the bed.
    if (wasInBed) { homeCamera.position.set(-2.9, 1.7, -1.3); homeYaw = -1.87; homePitch = 0; }
    else { homeCamera.position.set(COUCH_SIT.x, 1.7, COUCH_SIT.z + 1.0); homeYaw = 0; homePitch = 0; }
  }
  showHomeToast(wasInBed ? 'You stand up. Walk to the couch - the phone is ringing.' : 'You stand up.');
  showHomeBar(homeKind);
}
// Prologue sequence: sit down on the couch, next to the phone. Only
// works near the couch (the button is only shown there, and clicking
// the sofa only fires near it), and only before the call.
function sitOnCouch() {
  if (prologueSeated || homeCallDone) return;
  if (!homeActive || homeKind !== 'mansion' || !homeCamera) return;
  const dx = homeCamera.position.x - COUCH_SIT.x, dz = homeCamera.position.z - COUCH_SIT.z;
  if (dx * dx + dz * dz > 2.2 * 2.2) { showHomeToast('Walk to the couch first.'); return; }
  prologueSeated = true;
  showHomeToast('You sit on the couch. The phone is beside you - tap its green button to answer.');
  showHomeBar(homeKind);
}
// Show or hide the prologue Stand up / Sit on the couch buttons. The
// Stand button shows while lying in bed or sitting on the couch. The
// Sit button shows only when standing near the couch before the call.
function updatePrologueButtons() {
  try {
    const stand = document.getElementById('homeStandBtn');
    const sit = document.getElementById('homeSitBtn');
    if (!stand || !sit) return;
    stand.style.display = (prologueInBed || prologueSeated) ? '' : 'none';
    let nearCouch = false;
    if (homeActive && homePrologue && homeKind === 'mansion' && !homeCallDone && !prologueInBed && !prologueSeated && homeCamera) {
      const dx = homeCamera.position.x - COUCH_SIT.x, dz = homeCamera.position.z - COUCH_SIT.z;
      nearCouch = dx * dx + dz * dz < 1.8 * 1.8;
    }
    sit.style.display = nearCouch ? '' : 'none';
  } catch (e) { /* ignore */ }
}

function mat(color, opts) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.9, metalness: 0.02 }, opts || {})); }
// Draw the Zama logo (the dark Z on a gold rounded square, the same
// artwork as ZAMA_LOGO_SVG in economy.js) on a 2D canvas at (x, y)
// with the given size (the square's side). The Z path is the SVG path
// "M6 6.5H18V9l-6.1 6H18v2.5H6V15l6.1-6H6z" in a 24x24 viewBox.
function drawZamaLogo(ctx, x, y, size) {
  const s = size / 24;
  const r = 6 * s;
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + size - r, y);
  ctx.arcTo(x + size, y, x + size, y + r, r);
  ctx.lineTo(x + size, y + size - r);
  ctx.arcTo(x + size, y + size, x + size - r, y + size, r);
  ctx.lineTo(x + r, y + size);
  ctx.arcTo(x, y + size, x, y + size - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.moveTo(x + 6 * s, y + 6.5 * s);
  ctx.lineTo(x + 18 * s, y + 6.5 * s);
  ctx.lineTo(x + 18 * s, y + 9 * s);
  ctx.lineTo(x + 11.9 * s, y + 15 * s);
  ctx.lineTo(x + 18 * s, y + 15 * s);
  ctx.lineTo(x + 18 * s, y + 17.5 * s);
  ctx.lineTo(x + 6 * s, y + 17.5 * s);
  ctx.lineTo(x + 6 * s, y + 15 * s);
  ctx.lineTo(x + 12.1 * s, y + 9 * s);
  ctx.lineTo(x + 6 * s, y + 9 * s);
  ctx.closePath();
  ctx.fill();
}
// A canvas texture of just the Zama logo, for planes on a phone back or a booth.
function zamaLogoTexture(size) {
  const px = size || 128;
  const c = document.createElement('canvas'); c.width = px; c.height = px;
  const ctx = c.getContext('2d');
  drawZamaLogo(ctx, 0, 0, px);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// Draw a phone handset glyph (a curved receiver) on a 2D canvas, centred
// at (cx, cy) with radius r. rot turns it: 0 is the pick-up handset,
// Math.PI * 0.75 is the hang-up handset.
function drawHandset(ctx, cx, cy, r, color, rot) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot || 0);
  ctx.strokeStyle = color;
  ctx.lineWidth = r * 0.34;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, r, Math.PI * 0.2, Math.PI * 1.1, false);
  ctx.stroke();
  ctx.restore();
}
// A rounded-rectangle shape, for a phone body and screen (sculpted, not a box).
function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(w / 2, h / 2 - r);
  s.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2, false);
  s.lineTo(-w / 2 + r, h / 2);
  s.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-w / 2, -h / 2 + r);
  s.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
// A rounded box: a rounded-rectangle shape extruded with a bevel, so
// furniture reads as real, soft-edged pieces instead of sharp boxes.
// The final size is w x h x d (the bevel is folded into the shape).
// Returns a mesh with castShadow on.
function roundedBox(w, h, d, r, material) {
  const b = Math.min(0.025, r * 0.35, d / 2 - 0.005);
  const dep = Math.max(0.01, d - 2 * b);
  const geo = new THREE.ExtrudeGeometry(roundedRectShape(Math.max(0.02, w - 2 * b), Math.max(0.02, h - 2 * b), Math.max(0.005, r - b)), { depth: dep, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 8 });
  geo.translate(0, 0, -dep / 2);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  return m;
}
// A stuffed cushion: a rounded-rectangle profile extruded with a DEEP
// bevel, so the top and the front edge are fully round and the cushion
// bulges like a real stuffed sofa cushion instead of reading as a flat
// slab with sharp corners. The old roundedBox caps its bevel at 0.025,
// which is invisible at play distance; this one rounds the edges with
// a radius near half the cushion thickness. The final size is w x h x d,
// and the top stays flat across the middle, so the phone and the sit
// spot do not move. Returns a mesh with castShadow on.
function plumpCushion(w, h, d, r, material) {
  const b = Math.min(0.08, r * 0.55, h * 0.3, d * 0.3);
  const dep = Math.max(0.01, d - 2 * b);
  const geo = new THREE.ExtrudeGeometry(roundedRectShape(Math.max(0.02, w - 2 * b), Math.max(0.02, h - 2 * b), Math.max(0.005, r - b)), { depth: dep, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 5, curveSegments: 12 });
  geo.translate(0, 0, -dep / 2);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  return m;
}
function hbox(scene, w, h, d, color, x, y, z, name, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  if (name) { m.name = name; m.userData.homeAction = name; homeTargets.push(m); }
  scene.add(m); return m;
}
function hcyl(scene, rt, rb, h, color, x, y, z, name, opts, seg) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 16), mat(color, opts));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  if (name) { m.name = name; m.userData.homeAction = name; homeTargets.push(m); }
  scene.add(m); return m;
}
function hitBox(scene, w, h, d, x, y, z, name) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  m.position.set(x, y, z); m.name = name; m.userData.homeAction = name; homeTargets.push(m); scene.add(m); return m;
}
function lamp(scene, x, y, z, color, intensity, dist) {
  const l = new THREE.PointLight(color || 0xffe0b0, intensity || 0.9, dist || 12);
  l.position.set(x, y, z); scene.add(l); return l;
}
function textSprite(text, bg, fg, sub) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = fg; ctx.font = 'bold 44px Arial'; ctx.textAlign = 'center';
  ctx.fillText(text, 256, sub ? 58 : 74);
  if (sub) { ctx.font = '28px Arial'; ctx.fillText(sub, 256, 102); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  return s;
}
function nightSkyTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0a1626'; ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#f2f2f2';
  for (let i = 0; i < 60; i++) { ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(200, 50, 22, 0, Math.PI * 2); ctx.fill();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function tvTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 288;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 288);
  g.addColorStop(0, '#1a3a5a'); g.addColorStop(0.6, '#c96a2a'); g.addColorStop(1, '#2a1a2a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 288);
  ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(400, 200, 34, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0a1420'; ctx.fillRect(0, 220, 512, 68);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 34px Arial'; ctx.textAlign = 'center';
  ctx.fillText('THE LAST SIGNAL', 256, 60);
  ctx.font = '22px Arial'; ctx.fillText('City news - the grid holds', 256, 100);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// White modern facade: a clean white wall with a regular grid of small
// square windows, like the hospital in the photo. litRatio lights a few
// windows warm (evening/night); in daylight most windows stay dark glass.
function whiteFacadeTexture(cols, rows, litRatio) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f6f8'; ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#e2e6ea'; ctx.fillRect(0, 0, 256, 10);
  const gw = 256 / cols, gh = 256 / rows;
  for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
    const lit = Math.random() < (litRatio || 0);
    ctx.fillStyle = lit ? '#ffd166' : '#2a3a4a';
    ctx.fillRect(col * gw + gw * 0.22, r * gh + gh * 0.25, gw * 0.56, gh * 0.5);
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function whiteFacadeMat(cols, rows, litRatio) {
  return new THREE.MeshStandardMaterial({ map: whiteFacadeTexture(cols, rows, litRatio), roughness: 0.85, metalness: 0.02 });
}
// Pale lab tiles: white squares with grey grout, for the wind tunnel
// lab floor and the tiled band along its walls.
function tileTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#dfe5e8'; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#9aa5ab'; ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(256, i * 64); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
// A pale daytime sky for the lab's big windows.
function daySkyTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#7fb2e0'); g.addColorStop(0.7, '#cfe4f2'); g.addColorStop(1, '#e8f2f8');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#fff2c0'; ctx.beginPath(); ctx.arc(200, 55, 24, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.ellipse(70, 90, 42, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(120, 70, 34, 12, 0, 0, Math.PI * 2); ctx.fill();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- Toast and save ----------
let homeToastTimer = 0;
function showHomeToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.opacity = '1';
  if (homeToastTimer) clearTimeout(homeToastTimer);
  homeToastTimer = setTimeout(() => { t.style.opacity = '0'; }, 4000);
}
function saveHomeGame(kind) {
  try {
    localStorage.setItem('lastSignalHomeSave', JSON.stringify({ place: kind, at: Date.now(), money: getBalance() }));
  } catch (e) { /* private mode */ }
  showHomeToast('Game saved - ' + (kind === 'mansion' ? 'The Mansion' : kind === 'safehouse' ? 'Safe House' : kind) + '. Balance: ' + moneyFmt(getBalance()));
}
function doSleep() {
  // Show the player sleeping: lay the avatar flat on his back on the
  // bed and move the camera to a third-person bedside view, so the
  // player SEES himself sleeping. The rest (save + "You slept") lands
  // after a few seconds, and a Wake up button appears; the view stays
  // until the player wakes, so he can watch himself sleep.
  if (sleeping) return;
  if (!currentBedPos) { saveHomeGame(homeKind); showHomeToast('You slept. Rested. Game saved.'); return; }
  sleeping = true; sleepT = 0; sleepRestDone = false;
  try {
    const a = getAvatar();
    if (a.parent) a.parent.remove(a);
    setAvatarPose('lie');
    a.visible = true;
    // Lie along the bed, on his back, head at the north end.
    a.position.set(currentBedPos.x, 0.62, currentBedPos.z - 0.4);
    a.rotation.set(0, 0, 0);
    a.scale.set(1, 1, 1);
    homeScene.add(a);
  } catch (e) { /* avatar is optional */ }
  // Show the Wake up button in the home bar while sleeping.
  try {
    const bar = document.getElementById('homeBar');
    if (bar) {
      let wake = document.getElementById('homeWakeBtn');
      if (!wake) {
        wake = document.createElement('button');
        wake.id = 'homeWakeBtn'; wake.type = 'button';
        wake.textContent = 'Wake up';
        wake.onclick = () => wakeUp();
        bar.appendChild(wake);
      }
      wake.style.display = '';
    }
  } catch (e) { /* ignore */ }
  showHomeToast('You are sleeping... (watch yourself rest, then Wake up)');
}
function wakeUp() {
  // Stand the avatar back up and return the camera to the normal mode.
  if (!sleeping) return;
  sleeping = false; sleepRestDone = false;
  try {
    const a = getAvatar();
    setAvatarPose('stand');
    a.rotation.set(0, 0, 0);
    a.scale.set(1, 1, 1);
    detachAvatar();
  } catch (e) { /* ignore */ }
  try {
    const wake = document.getElementById('homeWakeBtn');
    if (wake) wake.style.display = 'none';
  } catch (e) { /* ignore */ }
  showHomeToast('You woke up. Rested.');
}
function doSave() {
  saveHomeGame(homeKind);
}

// ---------- Home HUD bar ----------
let homeBarBuilt = false;
function buildHomeBar() {
  if (homeBarBuilt) return;
  homeBarBuilt = true;
  const bar = document.createElement('div');
  bar.id = 'homeBar';
  bar.className = 'hidden';
  bar.innerHTML = '<span id="homeBarTitle"></span><span id="homeBarInfo"></span>'
    + '<button id="homeStandBtn" type="button">Stand up</button>'
    + '<button id="homeSitBtn" type="button">Sit on the couch</button>'
    + '<button id="homePickupBtn" type="button">Pick up the phone</button>'
    + '<button id="homeTerminalBtn" type="button">Go to the Train Terminal</button>'
    + '<button id="homeBoardBtn" type="button">Board the train</button>'
    + '<button id="homeSleepBtn" type="button">Sleep</button>'
    + '<button id="homeSaveBtn" type="button">Save game</button>'
    + '<button id="homeLeaveBtn" type="button">Leave</button>';
  document.body.appendChild(bar);
  document.getElementById('homeStandBtn').onclick = () => standUp();
  document.getElementById('homeSitBtn').onclick = () => sitOnCouch();
  document.getElementById('homePickupBtn').onclick = () => answerPhone();
  document.getElementById('homeTerminalBtn').onclick = () => goToTerminal();
  document.getElementById('homeBoardBtn').onclick = () => boardTrain();
  document.getElementById('homeSleepBtn').onclick = () => doSleep();
  document.getElementById('homeSaveBtn').onclick = () => doSave();
  document.getElementById('homeLeaveBtn').onclick = () => leavePlace();
}
// The prologue: after the call, the player goes to the Train Terminal.
function goToTerminal() {
  enterPlace('terminal', () => {}, { prologue: true, onBoardTrain: prologueOnBoardTrain });
}
// Board the 4 train: in the prologue this starts Act I. From the map
// (Act II) the train is already ridden, so it just says so.
function boardTrain() {
  if (homePrologue && prologueOnBoardTrain) {
    const cb = prologueOnBoardTrain;
    prologueOnBoardTrain = null;
    homePrologue = false;
    leavePlace();
    cb();
  } else {
    showHomeToast('The 4 train - you already rode it. The story is in Act II now.');
  }
}
function showHomeBar(kind) {
  buildHomeBar();
  const titles = {
    mansion: 'THE MANSION - home',
    safehouse: 'SAFE HOUSE APARTMENT',
    hospital: 'CITY HOSPITAL',
    industry: 'INDUSTRIAL AREA - WATER TREATMENT PLANT',
    terminal: 'TRAIN TERMINAL - GRAND CENTRAL',
    hotel: 'HOTEL - YOUR SUITE',
    airport: 'AIRPORT - JFK TERMINAL',
    carpark: 'CAR PARK',
    windtunnel: 'WIND TUNNEL LAB - ENGINEERING LAB',
    symposium: 'SYMPOSIUM HALL - NEW YORK'
  };
  const infos = {
    mansion: homePrologue && !homeCallDone ? (prologueInBed ? 'You are in bed. The phone is ringing - stand up.' : prologueSeated ? 'You are on the couch. The phone is beside you - tap its green button.' : 'The phone is ringing. Walk to the couch, sit down and answer it.') : homePrologue ? 'Jade called. Go to the Train Terminal and board the 4 train.' : 'Drag to look around - WASD to walk - click the bed to sleep.',
    safehouse: 'Drag to look around - WASD to walk - click the bed or table to save.',
    hospital: 'Drag to look around - WASD to walk - look around, then head back.',
    industry: 'Drag to look around - WASD to walk - look around, then head back.',
    terminal: homePrologue ? 'Walk through the concourse to the platform and board the 4 train. The train is at the far end.' : 'Drag to look around - WASD to walk - the 4 train is on the platform. Look around, then head back.',
    hotel: 'Drag to look around - WASD to walk - click the bed to sleep.',
    airport: 'Drag to look around - WASD to walk - look around, then head back.',
    carpark: 'Drag to look around - WASD to walk - rows of parked cars. Look around, then head back.',
    windtunnel: 'Drag to look around - WASD to walk - run the wind tunnel at the control panel. The phone booth on the wall gives the next mission.',
    symposium: 'Drag to look around - WASD to walk - take the NYC podium on the stage.'
  };
  document.getElementById('homeBarTitle').textContent = titles[kind] || kind;
  document.getElementById('homeBarInfo').textContent = infos[kind] || '';
  document.getElementById('homeSleepBtn').style.display = (kind === 'mansion' || kind === 'hotel') && !homePrologue ? '' : 'none';
  document.getElementById('homeSaveBtn').style.display = kind === 'safehouse' && !homePrologue ? '' : 'none';
  // Prologue buttons: Go to the Terminal (after the call, in the room),
  // Board the train (in the terminal). The phone is answered on the
  // phone itself (tap or swipe its green button), not from a HUD button,
  // so Pick up stays hidden. Stand up / Sit on the couch are handled
  // by updatePrologueButtons.
  document.getElementById('homePickupBtn').style.display = 'none';
  document.getElementById('homeTerminalBtn').style.display = homePrologue && kind === 'mansion' && homeCallDone ? '' : 'none';
  document.getElementById('homeBoardBtn').style.display = homePrologue && kind === 'terminal' ? '' : 'none';
  // In the prologue there is nowhere else to go: Leave is hidden until
  // the player is back in the acts (the map, or after boarding).
  document.getElementById('homeLeaveBtn').style.display = homePrologue ? 'none' : '';
  document.getElementById('homeBar').classList.remove('hidden');
  updatePrologueButtons();
}

// ---------- Room builders ----------
function roomShell(scene, w, d, h, floorColor, wallColor) {
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), mat(floorColor, { roughness: 0.7 }));
  floor.position.set(0, 0.05, 0); floor.receiveShadow = true; scene.add(floor);
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), mat(0x8a8078, { roughness: 0.95 }));
  ceil.position.set(0, h + 0.05, 0); scene.add(ceil);
  const mkWall = (ww, x, z, ry) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(ww, h, 0.15), mat(wallColor, { roughness: 0.95 }));
    wall.position.set(x, h / 2, z); wall.rotation.y = ry || 0; wall.receiveShadow = true; scene.add(wall); return wall;
  };
  mkWall(w, 0, -d / 2); mkWall(w, 0, d / 2);
  mkWall(d, -w / 2, 0, Math.PI / 2); mkWall(d, w / 2, 0, Math.PI / 2);
}
// A real, visible, walkable exit door in a room wall. The player walks
// up to it (WASD or the touch W/A/S/D buttons) and walks through it to
// leave, the way he walks through the station door into the valve room.
// The door is a frame, a wood panel with a handle, a gold glow strip and
// an EXIT sign, so it is easy to find. Clicking it also opens it.
// opts: { x, z, ry, keyId, keyLabel, action, label }.
//   keyId/keyLabel: when set, the door is locked until the player has
//     that key (the key is a pickup inside the room, see addRoomKey).
//   action: 'leave' (default, leaves the place) or 'terminal' (the
//     prologue path: go to the Train Terminal).
function addExitDoor(scene, opts) {
  const o = opts || {};
  const ry = o.ry || 0;
  const g = new THREE.Group();
  g.position.set(o.x || 0, 0, o.z || 0);
  g.rotation.y = ry;
  // Frame: two posts and a lintel, in a warm wood tone.
  const frameMat = mat(0x6b4226, { roughness: 0.6 });
  for (const dx of [-0.65, 0.65]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.4, 0.2), frameMat);
    post.position.set(dx, 1.2, 0); g.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.16, 0.2), frameMat);
  lintel.position.set(0, 2.42, 0); g.add(lintel);
  // The door panel: dark wood with a brass handle. It swings open on a
  // hinge (the panel sits in a hinge group at the door's edge) when the
  // player walks up to it.
  const hinge = new THREE.Group();
  hinge.position.set(-0.58, 0, 0);
  g.add(hinge);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.16, 2.3, 0.08), mat(0x4a3220, { roughness: 0.6 }));
  panel.position.set(0.58, 1.15, 0); panel.castShadow = true;
  panel.name = 'exitDoor'; panel.userData.homeAction = 'exitDoor';
  hinge.add(panel);
  const handle = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd8b13a, metalness: 0.9, roughness: 0.25 }));
  handle.position.set(1.0, 1.1, 0.08); hinge.add(handle);
  // A gold glow strip above the door, so it is easy to spot across the room.
  const glow = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.06), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
  glow.position.set(0, 2.62, 0.05); g.add(glow);
  const sign = textSprite(o.label || 'EXIT', '#2a2118', '#ffd166', o.keyId ? 'Locked - needs the ' + (o.keyLabel || 'key') : 'Walk through to leave');
  sign.scale.set(2.2, 0.55, 1); sign.position.set(0, 3.0, 0.05); g.add(sign);
  scene.add(g);
  const door = { x: o.x || 0, z: o.z || 0, ry, keyId: o.keyId || null, keyLabel: o.keyLabel || null, action: o.action || 'leave', panel, hinge, glow, group: g, open: 0 };
  homeDoors.push(door);
  // The panel is clickable, so a click on the door opens it too.
  panel.userData.doorRef = door;
  homeTargets.push(panel);
  return door;
}
// A small glowing key pickup inside a room, for a locked exit door.
// Clicking it (or walking up to it) picks it up. The key is always
// inside the room, before the player needs its door, so the player can
// never get permanently stuck at a locked door.
function addRoomKey(scene, x, z, keyId, keyLabel) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 8, 20), new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.3, metalness: 0.8 }));
  ring.position.set(0, 0.1, 0); g.add(ring);
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.03), new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.3, metalness: 0.8 }));
  stem.position.set(0.05, -0.08, 0); g.add(stem);
  const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.03), new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.3, metalness: 0.8 }));
  tooth.position.set(0.09, -0.16, 0); g.add(tooth);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.18 }));
  g.add(glow);
  g.position.set(x, 1.0, z);
  g.name = 'roomKey';
  // An invisible hit box, so the key is easy to click (raycasting a
  // Group does not hit its children, so the hit box carries the action).
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.position.set(0, 0, 0); hit.name = 'roomKey'; hit.userData.homeAction = 'roomKey'; hit.userData.keyId = keyId; hit.userData.keyLabel = keyLabel;
  g.add(hit);
  scene.add(g);
  homeTargets.push(hit);
  const label = textSprite(keyLabel.toUpperCase(), '#2a2118', '#ffd166', 'Click or walk up to pick it up');
  label.scale.set(1.8, 0.45, 1); label.position.set(x, 1.5, z); scene.add(label);
  const rec = { x, z, keyId, keyLabel, group: g, label };
  homeRoomKeys.push(rec);
  return rec;
}
// Sync the room keys with the keys the player already has (a replay):
// a key already owned is hidden so it cannot be picked up twice.
function syncRoomKeys() {
  for (const k of homeRoomKeys) {
    const owned = hasKey(k.keyId);
    try { k.group.visible = !owned; } catch (e) { /* ignore */ }
    try { k.label.visible = !owned; } catch (e) { /* ignore */ }
  }
}
function addWindow(scene, x, y, z, ry) {
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.4), new THREE.MeshStandardMaterial({ map: nightSkyTexture(), roughness: 0.2, metalness: 0.3 }));
  win.position.set(x, y, z); win.rotation.y = ry; scene.add(win);
  const frame = roundedBox(1.8, 0.08, 0.06, 0.02, mat(0x2a2118));
  frame.position.set(x, y + 0.75, z); frame.rotation.y = ry; scene.add(frame);
  const frame2 = frame.clone(); frame2.position.y = y - 0.75; scene.add(frame2);
}
function addBed(scene, x, z, w, single) {
  // Remember where the bed is, so the sleep view can lay the avatar on it.
  currentBedPos = { x, z, w };
  const g = new THREE.Group(); scene.add(g);
  // A rounded wooden frame, a plump rounded mattress, a folded blanket
  // with a roll at its top edge, pillows propped against a headboard.
  const frame = roundedBox(w, 0.4, 3, 0.06, mat(0x4a3220, { roughness: 0.7 }));
  frame.position.set(x, 0.2, z); frame.castShadow = true; g.add(frame);
  const head = roundedBox(w, 1.1, 0.12, 0.05, mat(0x4a3220, { roughness: 0.7 }));
  head.position.set(x, 0.95, z - 1.5); head.castShadow = true; g.add(head);
  const matt = roundedBox(w - 0.2, 0.25, 2.8, 0.09, mat(0xf2f0e8, { roughness: 0.9 }));
  matt.position.set(x, 0.5, z); matt.castShadow = true; matt.name = 'bed'; matt.userData.homeAction = 'bed'; homeTargets.push(matt); g.add(matt);
  const blanket = roundedBox(w - 0.2, 0.1, 1.7, 0.05, mat(0x2e4a6b, { roughness: 0.9 }));
  blanket.position.set(x, 0.62, z + 0.5); g.add(blanket);
  const fold = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, Math.max(0.2, w - 0.4), 4, 10), mat(0x3a5a7d, { roughness: 0.9 }));
  fold.rotation.z = Math.PI / 2; fold.position.set(x, 0.68, z - 0.35); fold.castShadow = true; g.add(fold);
  const n = single ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const px = single ? x : x - 0.55 + i * 1.1;
    const pil = roundedBox(0.8, 0.16, 0.5, 0.07, mat(0xffffff, { roughness: 0.95 }));
    pil.position.set(px, 0.65, z - 1.1); pil.rotation.x = -0.12; pil.castShadow = true; g.add(pil);
  }
  hitBox(scene, w + 0.6, 1.6, 3.4, x, 0.8, z, 'bed');
  return g;
}
function addSofa(scene, x, z, w, color, name, ry) {
  // A real couch, not a box: short legs, a rounded base, plump rounded
  // seat and back cushions, rolled capsule arms and a rolled back top,
  // and rounded throw pillows. Built in a group so ry can turn it:
  // ry = 0 faces south, PI faces north (toward a TV on the north
  // wall), PI/2 faces east, -PI/2 west. The seat top stays at 0.77, so
  // the sit spot and the phone on the cushion do not move.
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = ry || 0;
  const cloth = mat(color, { roughness: 0.95 });
  for (const [dx, dz] of [[-w / 2 + 0.2, -0.42], [w / 2 - 0.2, -0.42], [-w / 2 + 0.2, 0.42], [w / 2 - 0.2, 0.42]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.1, 10), mat(0x2a2118, { roughness: 0.6 }));
    leg.position.set(dx, 0.05, dz); g.add(leg);
  }
  const base = roundedBox(w, 0.5, 1.15, 0.08, cloth);
  base.position.set(0, 0.35, 0); base.name = name || 'sofa'; base.userData.homeAction = name || 'sofa'; homeTargets.push(base); g.add(base);
  const back = roundedBox(w, 0.85, 0.3, 0.09, cloth);
  back.position.set(0, 0.92, -0.52); back.rotation.x = -0.08; g.add(back);
  const roll = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, Math.max(0.2, w - 0.5), 4, 12), cloth);
  roll.rotation.z = Math.PI / 2; roll.position.set(0, 1.32, -0.55); roll.castShadow = true; g.add(roll);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.8, 4, 12), cloth);
    arm.rotation.x = Math.PI / 2; arm.position.set(s * (w / 2 - 0.16), 0.72, 0); arm.castShadow = true; g.add(arm);
  }
  const n = Math.max(2, Math.round(w / 1.1));
  const cw = w / n - 0.05; // cushions nearly touch: a thin seam, and a
  // continuous top under the phone, which lies across the seam.
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + (i + 0.5) * (w / n);
    // Seat cushion: thick and stuffed, radius near half its thickness,
    // so the top edge is a full round and the front edge bulges. The
    // top stays at 0.77, so the sit spot and the phone do not move.
    const c = plumpCushion(cw, 0.32, 0.95, 0.15, mat(0xd8cfc0, { roughness: 0.95 }));
    c.position.set(cx, 0.61, 0.02); g.add(c);
    // Back cushion: thicker and taller than before, leaning back,
    // bulging forward instead of sitting as a flat slab.
    const bc = plumpCushion(cw, 0.56, 0.28, 0.13, cloth);
    bc.position.set(cx, 0.98, -0.36); bc.rotation.x = -0.16; g.add(bc);
    // A throw pillow on each seat, in a warm gold accent, plump too.
    // Moved slightly forward so the thicker back cushion does not
    // bury it.
    const pil = plumpCushion(0.46, 0.42, 0.20, 0.10, mat(0xffd166, { roughness: 0.95 }));
    pil.position.set(cx, 0.92, -0.16);
    pil.rotation.x = -0.2; pil.rotation.z = (i % 2 === 0 ? 0.08 : -0.08);
    g.add(pil);
  }
  // A generous invisible click target that turns with the sofa.
  const hit = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 1.6, 1.8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.position.set(0, 0.8, 0); hit.name = name || 'sofa'; hit.userData.homeAction = name || 'sofa'; homeTargets.push(hit); g.add(hit);
  scene.add(g);
  return g;
}
function addTV(scene, x, y, z, w, name) {
  // A real flat-screen: a thin rounded panel on a neck over a low
  // rounded media console, not a black box.
  const g = new THREE.Group(); scene.add(g);
  for (const dx of [-w / 2 - 0.1, w / 2 + 0.1]) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.08, 10), mat(0x2a2118, { roughness: 0.6 }));
    foot.position.set(x + dx, 0.04, z + 0.2); g.add(foot);
  }
  const stand = roundedBox(w + 0.4, 0.4, 0.5, 0.05, mat(0x2a2118, { roughness: 0.7 }));
  stand.position.set(x, 0.28, z + 0.2); g.add(stand);
  const neck = roundedBox(0.18, 0.55, 0.06, 0.03, mat(0x1a1a1a, { roughness: 0.5, metalness: 0.3 }));
  neck.position.set(x, 0.72, z + 0.15); g.add(neck);
  const body = roundedBox(w, w * 0.56, 0.08, 0.04, mat(0x111111, { roughness: 0.4 }));
  body.position.set(x, y, z); body.name = name || 'tv'; body.userData.homeAction = name || 'tv'; homeTargets.push(body); g.add(body);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.15, w * 0.56 - 0.15), new THREE.MeshStandardMaterial({ map: tvTexture(), emissive: 0xffffff, emissiveMap: tvTexture(), emissiveIntensity: 0.7, roughness: 0.3 }));
  screen.position.set(x, y, z + 0.05); g.add(screen);
  hitBox(scene, w + 0.4, w * 0.56 + 0.4, 0.6, x, y, z, name || 'tv');
  lamp(scene, x, y + 1, z + 1.2, 0x9fd8ff, 0.4, 6);
  return g;
}
function addFloorLamp(scene, x, z) {
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 16), mat(0x2a2a2a, { metalness: 0.6, roughness: 0.4 }));
  base.position.set(x, 0.015, z); scene.add(base);
  hcyl(scene, 0.05, 0.07, 1.6, 0x2a2a2a, x, 0.8, z, null, { metalness: 0.6, roughness: 0.4 });
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.4, 12, 1, true), mat(0xffd166, { roughness: 0.8, side: THREE.DoubleSide }));
  shade.position.set(x, 1.75, z); scene.add(shade);
  lamp(scene, x, 1.7, z, 0xffe0b0, 0.9, 9);
}
function addDiningTable(scene, x, z) {
  // A round-edged table with turned legs, and chairs with rounded
  // seats and backs on slim legs.
  const top = roundedBox(2.4, 0.08, 1.4, 0.04, mat(0x4a3220, { roughness: 0.6 }));
  top.position.set(x, 0.75, z); top.castShadow = true; scene.add(top);
  for (const [dx, dz] of [[-1.1, -0.6], [1.1, -0.6], [-1.1, 0.6], [1.1, 0.6]]) {
    hcyl(scene, 0.05, 0.05, 0.75, 0x2a2118, x + dx, 0.37, z + dz, null, { roughness: 0.6 });
  }
  for (const [dx, dz, ry] of [[-1.6, 0, Math.PI / 2], [1.6, 0, -Math.PI / 2], [0, -1.1, 0], [0, 1.1, Math.PI]]) {
    const seat = roundedBox(0.5, 0.08, 0.5, 0.04, mat(0x6b4226, { roughness: 0.7 }));
    seat.position.set(x + dx, 0.45, z + dz); scene.add(seat);
    const bk = roundedBox(0.5, 0.6, 0.08, 0.04, mat(0x6b4226, { roughness: 0.7 }));
    bk.position.set(x + dx * 1.15, 0.8, z + dz * 1.15); bk.rotation.y = ry; scene.add(bk);
    for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) {
      hcyl(scene, 0.025, 0.025, 0.45, 0x2a2118, x + dx + lx, 0.225, z + dz + lz, null, { roughness: 0.6 });
    }
  }
}
function addKitchen(scene, x, z, len, ry) {
  // A proper kitchen run: counters with a stove (hob + oven), a sink
  // with a tap, a fridge, upper cabinets, and a kettle and fruit bowl
  // on the counter. Built in a group that runs along local z and faces
  // local -x; ry rotates it (0 = against the east wall facing west,
  // -PI/2 = against the south wall facing north).
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = ry || 0;
  const half = len / 2;
  const counter = roundedBox(0.65, 0.9, len, 0.06, mat(0x8a8a82, { roughness: 0.6 }));
  counter.position.set(0, 0.45, 0); g.add(counter);
  const top = roundedBox(0.72, 0.05, len + 0.04, 0.02, mat(0x2a2a2a, { roughness: 0.4 }));
  top.position.set(0, 0.92, 0); g.add(top);
  // Stove: a hob with four burners on the counter, and an oven door.
  const stoveZ = -half + 0.8;
  const hob = roundedBox(0.6, 0.04, 0.9, 0.015, mat(0x111111, { roughness: 0.3, metalness: 0.4 }));
  hob.position.set(0, 0.96, stoveZ); g.add(hob);
  for (const [dz, dx] of [[-0.25, -0.15], [-0.25, 0.15], [0.25, -0.15], [0.25, 0.15]]) {
    const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 12), mat(0x333333, { roughness: 0.4, metalness: 0.5 }));
    burner.position.set(dx, 0.99, stoveZ + dz); g.add(burner);
  }
  const oven = roundedBox(0.04, 0.5, 0.7, 0.015, mat(0x1a1a1a, { roughness: 0.3, metalness: 0.4 }));
  oven.position.set(-0.34, 0.45, stoveZ); g.add(oven);
  const ovenHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8), new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.8, roughness: 0.3 }));
  ovenHandle.rotation.x = Math.PI / 2; ovenHandle.position.set(-0.37, 0.72, stoveZ); g.add(ovenHandle);
  // Sink: a basin set into the counter, with a tap.
  const sinkZ = half - 0.8;
  const basin = roundedBox(0.45, 0.08, 0.6, 0.03, mat(0x9aa2a8, { roughness: 0.3, metalness: 0.6 }));
  basin.position.set(0, 0.92, sinkZ); g.add(basin);
  const tapBase = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.8, roughness: 0.3 }));
  tapBase.position.set(0.15, 1.1, sinkZ - 0.25); g.add(tapBase);
  const tapArm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.28, 8), new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.8, roughness: 0.3 }));
  tapArm.rotation.x = Math.PI / 2; tapArm.position.set(0.02, 1.24, sinkZ - 0.12); g.add(tapArm);
  // Upper cabinets on the wall above the counter, with round knobs.
  const cab = roundedBox(0.4, 0.8, len - 0.8, 0.06, mat(0x6a5a44, { roughness: 0.7 }));
  cab.position.set(0.15, 2.0, 0); g.add(cab);
  for (const kz of [-0.9, 0, 0.9]) {
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd8b13a, metalness: 0.8, roughness: 0.3 }));
    knob.position.set(-0.06, 1.7, kz); g.add(knob);
  }
  // Fridge at the north end of the run, with rounded doors and handles.
  const fridge = roundedBox(0.75, 1.9, 0.85, 0.08, mat(0xd8d8d8, { metalness: 0.5, roughness: 0.3 }));
  fridge.position.set(0, 0.95, -half - 0.55); g.add(fridge);
  for (const hy of [0.7, 1.3]) {
    const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.26, 4, 8), mat(0x2a2a2a, { metalness: 0.6, roughness: 0.4 }));
    handle.position.set(-0.4, hy, -half - 0.55); g.add(handle);
  }
  // A kettle and a fruit bowl on the counter.
  const kettle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.18, 10), mat(0x2a2a2a, { metalness: 0.6, roughness: 0.4 }));
  kettle.position.set(-0.1, 1.03, 0); g.add(kettle);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.09, 0.07, 12), mat(0xc0392b, { roughness: 0.6 }));
  bowl.position.set(0.05, 0.98, 0.5); g.add(bowl);
  for (const [fx, fz] of [[-0.03, 0.45], [0.1, 0.52], [0.02, 0.56]]) {
    const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), mat(0xffa500, { roughness: 0.6 }));
    fruit.position.set(fx, 1.03, fz); g.add(fruit);
  }
  scene.add(g);
  return g;
}
// A potted plant: a terracotta pot, a trunk, and a leafy crown.
function addPlant(scene, x, z, scale) {
  const s = scale || 1;
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.16 * s, 0.3 * s, 12), mat(0xa85a2a, { roughness: 0.8 }));
  pot.position.set(x, 0.15 * s, z); pot.castShadow = true; g.add(pot);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.21 * s, 0.025 * s, 8, 20), mat(0x8a4520, { roughness: 0.8 }));
  rim.rotation.x = Math.PI / 2; rim.position.set(x, 0.3 * s, z); g.add(rim);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.04 * s, 0.05 * s, 0.5 * s, 8), mat(0x4a3220, { roughness: 1 }));
  trunk.position.set(x, 0.5 * s, z); g.add(trunk);
  const crownMat = mat(0x3a6a2a, { roughness: 1 });
  for (const [dx, dy, dz, r] of [[0, 0.95, 0, 0.35], [0.2, 0.8, 0.1, 0.25], [-0.18, 0.85, -0.08, 0.25], [0.05, 1.1, -0.12, 0.22]]) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(r * s, 10, 8), crownMat);
    leaf.position.set(x + dx * s, dy * s, z + dz * s); leaf.castShadow = true; g.add(leaf);
  }
  scene.add(g);
  return g;
}
// A low coffee table with a rounded top, turned legs, a book and a mug.
function addCoffeeTable(scene, x, z, w) {
  const g = new THREE.Group();
  const top = roundedBox(w, 0.06, 0.7, 0.03, mat(0x4a3220, { roughness: 0.5 }));
  top.position.set(x, 0.42, z); g.add(top);
  for (const [dx, dz] of [[-w / 2 + 0.08, -0.28], [w / 2 - 0.08, -0.28], [-w / 2 + 0.08, 0.28], [w / 2 - 0.08, 0.28]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.4, 8), mat(0x2a2118, { roughness: 0.6 }));
    leg.position.set(x + dx, 0.2, z + dz); g.add(leg);
  }
  const book = roundedBox(0.3, 0.04, 0.22, 0.015, mat(0xc0392b, { roughness: 0.8 }));
  book.position.set(x - w / 4, 0.47, z); book.rotation.y = 0.3; g.add(book);
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.09, 10), mat(0x2e6fb0, { roughness: 0.5 }));
  mug.position.set(x + w / 4, 0.5, z + 0.1); g.add(mug);
  scene.add(g);
  return g;
}
// A bedside nightstand with a rounded body and drawer, and a small lamp.
function addNightstand(scene, x, z) {
  const g = new THREE.Group();
  const body = roundedBox(0.55, 0.55, 0.45, 0.05, mat(0x4a3220, { roughness: 0.6 }));
  body.position.set(x, 0.28, z); g.add(body);
  const drawer = roundedBox(0.45, 0.18, 0.03, 0.015, mat(0x6b4226, { roughness: 0.6 }));
  drawer.position.set(x, 0.35, z + 0.24); g.add(drawer);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd8b13a, metalness: 0.8, roughness: 0.3 }));
  knob.position.set(x, 0.35, z + 0.27); g.add(knob);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.04, 10), mat(0x2a2a2a, { metalness: 0.6, roughness: 0.4 }));
  base.position.set(x, 0.57, z); g.add(base);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 8), mat(0x2a2a2a, { metalness: 0.6, roughness: 0.4 }));
  stem.position.set(x, 0.68, z); g.add(stem);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.16, 10, 1, true), mat(0xffd166, { roughness: 0.8, side: THREE.DoubleSide }));
  shade.position.set(x, 0.82, z); g.add(shade);
  lamp(scene, x, 0.9, z, 0xffe0b0, 0.5, 5);
  scene.add(g);
  return g;
}
// A tall wardrobe with two doors and brass handles. ry turns it to
// face into the room (PI/2 faces east from the west wall).
function addWardrobe(scene, x, z, ry) {
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = ry || 0;
  const body = roundedBox(1.4, 2.2, 0.55, 0.06, mat(0x4a3220, { roughness: 0.6 }));
  body.position.set(0, 1.1, 0); g.add(body);
  const crown = roundedBox(1.5, 0.08, 0.62, 0.03, mat(0x5a3a24, { roughness: 0.6 }));
  crown.position.set(0, 2.24, 0); g.add(crown);
  for (const dx of [-0.35, 0.35]) {
    const door = roundedBox(0.62, 2.0, 0.04, 0.02, mat(0x5a3a24, { roughness: 0.6 }));
    door.position.set(dx, 1.1, 0.29); g.add(door);
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd8b13a, metalness: 0.8, roughness: 0.3 }));
    handle.position.set(dx + (dx < 0 ? 0.22 : -0.22), 1.1, 0.33); g.add(handle);
  }
  scene.add(g);
  return g;
}
// A low partition wall (a room divider, not a full wall): about 1.1 m
// high with a wood top rail, so the layout reads room by room but the
// player can see over it. It is a visual divider, like the furniture:
// the game has no collision, so the player walks through the gaps.
// ry = 0 runs along x, PI/2 runs along z.
function addPartition(scene, x, z, len, ry) {
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = ry || 0;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 1.05, 0.12), mat(0xc9b8a0, { roughness: 0.95 }));
  wall.position.set(0, 0.55, 0); wall.castShadow = true; wall.receiveShadow = true; g.add(wall);
  const rail = roundedBox(len, 0.06, 0.16, 0.02, mat(0x6b4226, { roughness: 0.6 }));
  rail.position.set(0, 1.1, 0); g.add(rail);
  scene.add(g);
  return g;
}
// A ceiling fan: a mount, a motor, and four blades. The blades are
// stored in homeFans so homeAnimate can spin them slowly.
function addCeilingFan(scene, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 3.2, z);
  const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.25, 8), mat(0x2a2a2a, { metalness: 0.6, roughness: 0.4 }));
  mount.position.set(0, 0.12, 0); g.add(mount);
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.18, 12), mat(0x2a2a2a, { metalness: 0.6, roughness: 0.4 }));
  motor.position.set(0, -0.05, 0); g.add(motor);
  const blades = new THREE.Group();
  blades.position.set(0, -0.12, 0);
  for (let i = 0; i < 4; i++) {
    const b = roundedBox(0.9, 0.03, 0.18, 0.012, mat(0x6b4226, { roughness: 0.6 }));
    const a = i * Math.PI / 2;
    b.position.set(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
    b.rotation.y = -a;
    blades.add(b);
  }
  g.add(blades);
  scene.add(g);
  homeFans.push(blades);
  return g;
}
// A bookshelf with colourful books, like the one in the reference.
// An open frame (back, sides, top, bottom) so the books show.
function addBookshelf(scene, x, z, ry) {
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = ry || 0;
  const wood = mat(0x4a3220, { roughness: 0.7 });
  const back = roundedBox(0.06, 2.2, 1.8, 0.02, wood);
  back.position.set(-0.17, 1.1, 0); g.add(back);
  for (const dz of [-0.87, 0.87]) {
    const side = roundedBox(0.4, 2.2, 0.06, 0.02, wood);
    side.position.set(0, 1.1, dz); g.add(side);
  }
  for (const y of [0.03, 2.17]) {
    const cap = roundedBox(0.4, 0.06, 1.8, 0.02, wood);
    cap.position.set(0, y, 0); g.add(cap);
  }
  const bookCols = [0xc0392b, 0x2e6fb0, 0x7ac74f, 0xffd166, 0x8a5a9a, 0xd8d8d8, 0x2e8b8b, 0xe07a5f];
  for (let s = 0; s < 3; s++) {
    const shelfY = 0.35 + s * 0.65;
    const shelf = roundedBox(0.36, 0.04, 1.7, 0.015, mat(0x6b4226, { roughness: 0.7 }));
    shelf.position.set(0, shelfY, 0); g.add(shelf);
    for (let b = 0; b < 6; b++) {
      const bc = bookCols[(s * 6 + b) % bookCols.length];
      const book = roundedBox(0.24, 0.42, 0.22, 0.02, mat(bc, { roughness: 0.8 }));
      book.position.set(0.02, shelfY + 0.23, -0.68 + b * 0.27);
      if ((s + b) % 5 === 0) book.rotation.x = 0.18;
      g.add(book);
    }
  }
  scene.add(g);
  return g;
}
// A bathtub: a white tub with a rim and a tap. ry turns it (0 = long
// side along z, PI/2 = long side along x).
function addBathtub(scene, x, z, ry) {
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = ry || 0;
  const tub = roundedBox(0.85, 0.55, 1.8, 0.12, mat(0xf4f6f8, { roughness: 0.3 }));
  tub.position.set(0, 0.28, 0); g.add(tub);
  const inner = roundedBox(0.65, 0.1, 1.6, 0.05, mat(0x9fc8d8, { roughness: 0.2 }));
  inner.position.set(0, 0.5, 0); g.add(inner);
  const rim = roundedBox(0.95, 0.06, 1.9, 0.03, mat(0xffffff, { roughness: 0.3 }));
  rim.position.set(0, 0.57, 0); g.add(rim);
  const tapBase = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.25, 8), new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.8, roughness: 0.3 }));
  tapBase.position.set(0, 0.7, -0.8); g.add(tapBase);
  const tapArm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.8, roughness: 0.3 }));
  tapArm.rotation.x = Math.PI / 2; tapArm.position.set(0, 0.82, -0.65); g.add(tapArm);
  scene.add(g);
  return g;
}
// A toilet: a tank, a bowl and a seat. It faces local +z.
function addToilet(scene, x, z, ry) {
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = ry || 0;
  const tank = roundedBox(0.45, 0.55, 0.16, 0.05, mat(0xf4f6f8, { roughness: 0.3 }));
  tank.position.set(0, 0.55, -0.28); g.add(tank);
  const lid = roundedBox(0.47, 0.05, 0.18, 0.02, mat(0xffffff, { roughness: 0.3 }));
  lid.position.set(0, 0.84, -0.28); g.add(lid);
  const flush = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12), new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.8, roughness: 0.3 }));
  flush.position.set(0, 0.87, -0.28); g.add(flush);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.4, 14), mat(0xf4f6f8, { roughness: 0.3 }));
  bowl.position.set(0, 0.2, 0.05); bowl.scale.set(1, 1, 1.25); bowl.castShadow = true; g.add(bowl);
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 14), mat(0xffffff, { roughness: 0.3 }));
  seat.position.set(0, 0.42, 0.05); g.add(seat);
  scene.add(g);
  return g;
}
// A bathroom sink: a pedestal, a basin, a tap and a mirror above it.
// It faces local +z (the mirror is on the local -z side, against the wall).
function addBathroomSink(scene, x, z, ry) {
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = ry || 0;
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.7, 10), mat(0xf4f6f8, { roughness: 0.3 }));
  ped.position.set(0, 0.35, 0); ped.castShadow = true; g.add(ped);
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.15, 14), mat(0xffffff, { roughness: 0.3 }));
  basin.position.set(0, 0.75, 0); g.add(basin);
  const basinRim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.02, 8, 20), mat(0xf4f6f8, { roughness: 0.3 }));
  basinRim.rotation.x = Math.PI / 2; basinRim.position.set(0, 0.82, 0); g.add(basinRim);
  const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.18, 8), new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.8, roughness: 0.3 }));
  tap.position.set(0, 0.9, -0.2); g.add(tap);
  const frame = roundedBox(0.56, 0.76, 0.02, 0.02, mat(0x4a3220, { roughness: 0.6 }));
  frame.position.set(0, 1.5, -0.29); g.add(frame);
  const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), new THREE.MeshStandardMaterial({ color: 0xb8d8e8, roughness: 0.1, metalness: 0.6 }));
  mirror.position.set(0, 1.5, -0.28); g.add(mirror);
  scene.add(g);
  return g;
}

// Remap a ShapeGeometry's UVs to 0-1 across the shape, so a canvas texture covers it.
function shapeUV01(geo) {
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let i = 0; i < pos.count; i++) {
    minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i));
    minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i));
  }
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (pos.getX(i) - minX) / (maxX - minX), (pos.getY(i) - minY) / (maxY - minY));
  }
  uv.needsUpdate = true;
  return geo;
}
// The phone's incoming-call screen: dark, the Zama logo at the top,
// Jade's name, and Answer / Decline labels under the two 3D buttons.
function phoneScreenTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#1a2a3a'); g.addColorStop(1, '#0a0d10');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 512);
  drawZamaLogo(ctx, 98, 30, 60);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('Jade Morales', 128, 140);
  ctx.fillStyle = '#9fb3c8'; ctx.font = '20px sans-serif';
  ctx.fillText('Incoming call', 128, 172);
  ctx.fillStyle = '#ffffff'; ctx.font = '16px sans-serif';
  ctx.fillText('Answer', 64, 480);
  ctx.fillText('Decline', 192, 480);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// A transparent canvas with just a white handset glyph, for a button top.
function handsetGlyphTexture(rot) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  drawHandset(ctx, 32, 32, 20, '#ffffff', rot || 0);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// A realistic smartphone (not a box): a rounded, bevelled body, a glass
// screen with the incoming-call display, an earpiece slot, a front
// camera, side buttons, a raised green pick-up button and a red decline
// button, and the Zama logo on its back. It lies flat, screen up, at
// (x, y, z) with its top pointing by ry. The pick-up button is the
// raycast target (homeAction 'phone'); tapping or swiping it answers.
function buildRealPhone(scene, x, y, z, ry) {
  const phone = new THREE.Group();
  phone.position.set(x, y, z);
  phone.rotation.y = ry || 0;
  const flat = new THREE.Group();
  flat.rotation.x = -Math.PI / 2;
  phone.add(flat);
  const bodyGeo = new THREE.ExtrudeGeometry(roundedRectShape(0.09, 0.18, 0.015), { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 12 });
  bodyGeo.translate(0, 0, -0.006);
  const body = new THREE.Mesh(bodyGeo, mat(0x1a1a1a, { roughness: 0.35, metalness: 0.6 }));
  body.castShadow = true; body.userData.homeAction = 'phone'; homeTargets.push(body);
  flat.add(body);
  const screenGeo = shapeUV01(new THREE.ShapeGeometry(roundedRectShape(0.082, 0.172, 0.012), 12));
  const screen = new THREE.Mesh(screenGeo, new THREE.MeshBasicMaterial({ map: phoneScreenTexture() }));
  screen.position.z = 0.0085; screen.userData.homeAction = 'phone'; homeTargets.push(screen);
  flat.add(screen);
  // Earpiece slot and front camera, at the top of the screen.
  const ear = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.004, 0.002), mat(0x050505, { roughness: 0.4 }));
  ear.position.set(0, 0.078, 0.0085); flat.add(ear);
  const cam = new THREE.Mesh(new THREE.CircleGeometry(0.003, 12), new THREE.MeshBasicMaterial({ color: 0x0a1a2a }));
  cam.position.set(0.028, 0.078, 0.0086); flat.add(cam);
  // Side buttons: power on the right, volume on the left.
  const pwr = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.03, 0.004), mat(0x333333, { roughness: 0.4, metalness: 0.6 }));
  pwr.position.set(0.0465, 0.02, 0); flat.add(pwr);
  const volU = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.02, 0.004), mat(0x333333, { roughness: 0.4, metalness: 0.6 }));
  volU.position.set(-0.0465, 0.04, 0); flat.add(volU);
  const volD = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.02, 0.004), mat(0x333333, { roughness: 0.4, metalness: 0.6 }));
  volD.position.set(-0.0465, 0.0, 0); flat.add(volD);
  // Green pick-up button (left) and red decline button (right): raised
  // discs on the screen, with a white handset glyph on top of each.
  const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.003, 24), mat(0x22c55e, { roughness: 0.4 }));
  pick.rotation.x = Math.PI / 2; pick.position.set(-0.0205, -0.055, 0.010); pick.userData.homeAction = 'phone'; homeTargets.push(pick);
  flat.add(pick);
  const pickGlyph = new THREE.Mesh(new THREE.CircleGeometry(0.016, 24), new THREE.MeshBasicMaterial({ map: handsetGlyphTexture(0), transparent: true }));
  pickGlyph.position.set(-0.0205, -0.055, 0.0118); flat.add(pickGlyph);
  const decl = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.003, 24), mat(0xef4444, { roughness: 0.4 }));
  decl.rotation.x = Math.PI / 2; decl.position.set(0.0205, -0.055, 0.010); decl.userData.homeAction = 'phone'; homeTargets.push(decl);
  flat.add(decl);
  const declGlyph = new THREE.Mesh(new THREE.CircleGeometry(0.016, 24), new THREE.MeshBasicMaterial({ map: handsetGlyphTexture(Math.PI * 0.75), transparent: true }));
  declGlyph.position.set(0.0205, -0.055, 0.0118); flat.add(declGlyph);
  // The Zama logo on the phone's back, so it reads as a Zama phone.
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), new THREE.MeshBasicMaterial({ map: zamaLogoTexture(128), transparent: true }));
  back.rotation.y = Math.PI; back.position.z = -0.0085; flat.add(back);
  scene.add(phone);
  // A generous invisible target over the phone, so it is easy to tap on a phone screen.
  hitBox(scene, 0.55, 0.4, 0.55, x, y + 0.05, z, 'phone');
  return phone;
}
// A wall-mounted phone booth in the wind tunnel lab (the Factory): a
// frame on the north wall, a keypad, a shelf, a realistic handset with
// a curved handle and a coiled cord, a PHONE sign with the Zama logo,
// and the Zama logo on the handset. Clicking it (or walking up to it)
// shows the briefing for the next mission. It pays no ZAMA.
function buildPhoneBooth(scene) {
  const bx = -7.2, bz = -5.5;
  const frame = mat(0x2a3a4a, { roughness: 0.6, metalness: 0.2 });
  const dark = mat(0x1a1a1a, { roughness: 0.4, metalness: 0.3 });
  // Back panel, side posts and top hood, on the north wall.
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 0.08), frame);
  back.position.set(bx, 1.05, -5.88); back.castShadow = true; scene.add(back);
  for (const sx of [-0.65, 0.65]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.1, 0.28), frame);
    post.position.set(bx + sx, 1.05, -5.74); post.castShadow = true; scene.add(post);
  }
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.45), frame);
  hood.position.set(bx, 2.15, -5.68); hood.rotation.x = -0.15; hood.castShadow = true; scene.add(hood);
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.3), frame);
  shelf.position.set(bx, 0.95, -5.7); shelf.castShadow = true; scene.add(shelf);
  // Keypad panel with a 3x4 grid of buttons, on the left of the back panel.
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.04), dark);
  pad.position.set(bx - 0.15, 1.35, -5.82); scene.add(pad);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12), mat(0x444444, { roughness: 0.4, metalness: 0.4 }));
      b.rotation.x = Math.PI / 2;
      b.position.set(bx - 0.15 + (col - 1) * 0.14, 1.35 + (1.5 - row) * 0.13, -5.79);
      scene.add(b);
    }
  }
  // The handset: a curved handle, an earpiece and a mouthpiece, hanging
  // on the right side of the booth, with the Zama logo on its earpiece.
  const hand = new THREE.Group();
  hand.position.set(bx + 0.55, 1.45, -5.72);
  hand.rotation.z = 0.08;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.12, 0),
    new THREE.Vector3(0.02, 0.06, 0.03),
    new THREE.Vector3(0.02, 0, 0.04),
    new THREE.Vector3(0.02, -0.06, 0.03),
    new THREE.Vector3(0, -0.12, 0)
  ]);
  const handle = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.022, 8, false), dark);
  handle.castShadow = true; hand.add(handle);
  const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.03, 16), dark);
  ear.position.set(0, 0.13, 0); hand.add(ear);
  const earRim = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.01, 16), dark);
  earRim.position.set(0, 0.15, 0); hand.add(earRim);
  const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.03, 16), dark);
  mouth.position.set(0, -0.13, 0); hand.add(mouth);
  const mouthRim = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.01, 16), dark);
  mouthRim.position.set(0, -0.15, 0); hand.add(mouthRim);
  // The Zama logo on the earpiece, facing the room.
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), new THREE.MeshBasicMaterial({ map: zamaLogoTexture(128), transparent: true }));
  logo.position.set(0, 0.13, 0.052); hand.add(logo);
  scene.add(hand);
  // A coiled cord from the handset down to the shelf.
  const cordPts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, a = t * Math.PI * 2 * 5;
    cordPts.push(new THREE.Vector3(bx + 0.55 + 0.035 * Math.cos(a), 1.3 - t * 0.35, -5.72 + 0.035 * Math.sin(a)));
  }
  const cord = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cordPts), 80, 0.008, 6, false), dark);
  scene.add(cord);
  // PHONE sign with the Zama logo, on top of the booth.
  const sc = document.createElement('canvas'); sc.width = 512; sc.height = 128;
  const sctx = sc.getContext('2d');
  sctx.fillStyle = '#1a1a1a'; sctx.fillRect(0, 0, 512, 128);
  drawZamaLogo(sctx, 14, 14, 100);
  sctx.fillStyle = '#ffd166'; sctx.font = 'bold 64px sans-serif'; sctx.textAlign = 'left'; sctx.textBaseline = 'middle';
  sctx.fillText('PHONE', 140, 66);
  const signTex = new THREE.CanvasTexture(sc); signTex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshBasicMaterial({ map: signTex }));
  sign.position.set(bx, 2.45, -5.68); scene.add(sign);
  // A generous invisible target over the booth, so it is easy to tap.
  hitBox(scene, 1.6, 2.4, 0.7, bx, 1.2, -5.6, 'phoneBooth');
}
// The next story mission, in order, from the save state. The phone booth
// in the wind tunnel lab points the player at it; it never invents a
// mission and never pays ZAMA.
function nextMissionInfo() {
  const has = (k) => { try { return !!localStorage.getItem(k); } catch (e) { return false; } };
  const mission = Number((() => { try { return localStorage.getItem('lastSignalAct2Mission') || '0'; } catch (e) { return '0'; } })()) || 0;
  const paid = (() => { try { return JSON.parse(localStorage.getItem('lastSignalPaid') || '[]'); } catch (e) { return []; } })();
  if (!has('lastSignalAct1')) return { title: 'Next mission - Act I, The 4 Train', calledBy: 'Jade Morales', problem: 'The 4 train is losing power and the passengers are stuck. Board the train and fix the relay.', stakes: 'Go to the Train Terminal, Grand Central, and board the 4 train. That is where the story starts.' };
  if (!has('lastSignalAct2')) {
    if (mission < 2) return { title: 'Next mission - Act II, Mission 1', calledBy: 'Jade Morales', problem: 'The water pressure is failing at the Reservoir. Find the valve room and hold the lines steady.', stakes: 'Go to the Reservoir, upstate North. The valve puzzle is there.' };
    if (mission === 2) return { title: 'Next mission - Act II, Mission 2', calledBy: 'Jade Morales', problem: 'The substation in Long Island City is dark. Get past the guards, find the key card, and reroute the power.', stakes: 'Go to the Substation, Long Island City. The guards are on patrol.' };
    return { title: 'Next mission - Act II, Mission 3', calledBy: 'Jade Morales', problem: 'Derrick Shaw is on the catwalk. Climb up, face him, and take the bridge.', stakes: 'Go to the Bridge, Verrazzano. The catwalk is the way across.' };
  }
  if (!has('lastSignalAct3')) return { title: 'Next mission - Act III, The Human Signal', calledBy: 'Jade Morales', problem: 'The final choice is yours. The court is waiting, and the city is watching.', stakes: 'Go to the Court, Foley Square, near Zama HQ in SoHo. That is where Act III ends.' };
  if (paid.indexOf('symposium') === -1) return { title: 'Next mission - Symposium Hall', calledBy: 'New York Symposium', problem: 'The hall is full and the podium is yours. Take it and speak.', stakes: 'Go to the Symposium Hall, Astoria, Queens. Walk to the NYC podium.' };
  return { title: 'The story is complete', calledBy: 'Jade Morales', problem: 'Every mission is done. The last step is the proof: seal and reveal your choices on Sepolia, then submit.', stakes: 'Open the Act III end card, press Reveal sealed choices on Sepolia, and submit the game to Zama. The deadline is Dec 14.' };
}
function showNextMissionBriefing() {
  showBriefing(nextMissionInfo(), null);
}

function buildMansion(scene) {
  // A large furnished home, 14 wide, 10 deep, laid out room by room
  // like the reference: a bedroom in the north-west, a living room in
  // the centre with blue sofas and a TV, a kitchen along the east wall,
  // a dining table in the south-east, and a bathroom in the south-west,
  // with low partition walls between the areas so the layout reads
  // room by room. The front door (north-east) and the phone stay where
  // they were, so the prologue and the walk-out still work.
  roomShell(scene, 14, 10, 3.4, 0x6b4a2f, 0xc9b8a0);
  // --- Bedroom (north-west): a rug, the bed, a nightstand, a wardrobe.
  const bedRug = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.04, 4.2), mat(0x7a2a2a, { roughness: 1 }));
  bedRug.position.set(-4.5, 0.12, -2.8); bedRug.receiveShadow = true; scene.add(bedRug);
  addBed(scene, -4.5, -3.2, 2.4, false);
  addNightstand(scene, -6.2, -3.2);
  addWardrobe(scene, -6.7, -1.2, Math.PI / 2);
  addPlant(scene, -6.3, -4.5, 1);
  // A low partition between the bedroom and the living room, with a gap
  // to walk through at the south end.
  addPartition(scene, -2.5, -3.5, 3, Math.PI / 2);
  // --- Living room (centre): blue L-shaped sectional sofas around a
  // coffee table and a dark rug, facing the TV on the north wall.
  // A ceiling fan turns above the coffee table.
  const liveRug = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.04, 3.2), mat(0x1a1a2a, { roughness: 1 }));
  liveRug.position.set(0.6, 0.12, -0.9); liveRug.receiveShadow = true; scene.add(liveRug);
  addSofa(scene, 0.3, -0.2, 3.2, 0x2e4a8a, 'sofa', Math.PI);
  addSofa(scene, 2.4, -1.2, 2.0, 0x2e4a8a, 'sofa2', -Math.PI / 2);
  addCoffeeTable(scene, 0.3, -1.2, 1.4);
  addTV(scene, 0, 1.7, -4.85, 2.6, 'tv');
  addCeilingFan(scene, 0.3, -1.2);
  addPlant(scene, 2.8, -4.3, 1);
  // --- Kitchen (east wall): counters, stove, sink, fridge, cabinets.
  addKitchen(scene, 6.5, 0, 4, 0);
  // --- Dining area (south-east): a table with four chairs.
  addDiningTable(scene, 3.8, 3.2);
  addPlant(scene, 6.3, 4.3, 0.9);
  // --- Bathroom (south-west, partitioned): a tub, a toilet, a sink.
  // The partitions leave a 1 m gap at the north-east corner to walk in.
  addPartition(scene, -5.75, 2, 2.5, 0);
  addPartition(scene, -3.5, 3.5, 3, Math.PI / 2);
  addBathtub(scene, -6.2, 3.8, 0);
  addToilet(scene, -4.2, 4.5, Math.PI);
  addBathroomSink(scene, -3.9, 2.6, -Math.PI / 2);
  // --- Bookshelf on the west wall, between the bedroom and bathroom.
  addBookshelf(scene, -6.7, 0.5, 0);
  addWindow(scene, -6.9, 1.9, -1.5, Math.PI / 2);
  addWindow(scene, 6.9, 1.9, -2.5, -Math.PI / 2);
  addFloorLamp(scene, 6, 4);
  // Chandelier over the living area.
  const ch = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 24), mat(0xd8b13a, { metalness: 0.8, roughness: 0.3 }));
  ch.position.set(0, 3.0, -0.5); ch.rotation.x = Math.PI / 2; scene.add(ch);
  for (let i = 0; i < 5; i++) {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    const a = i / 5 * Math.PI * 2;
    bulb.position.set(Math.cos(a) * 0.5, 2.95, -0.5 + Math.sin(a) * 0.5); scene.add(bulb);
  }
  lamp(scene, 0, 2.9, -0.5, 0xffe0b0, 1.0, 12);
  lamp(scene, 0, 2.5, 0, 0xffe0b0, 0.5, 14);
  const sign = textSprite('THE MANSION', '#2a2118', '#ffd166', 'Home - sleep here');
  sign.scale.set(3.4, 0.85, 1); sign.position.set(0, 2.9, -4.8); scene.add(sign);
  // The ringing phone (prologue only): a real smartphone lying on the
  // couch cushion beside where the player sits, screen up, with the
  // Zama logo and Jade's name on the screen and a green pick-up button.
  // The player stands up from bed, walks over, sits down, and answers
  // it by tapping or swiping the green button on the phone itself.
  // A pulsing gold glow and a "PHONE RINGING" sign mark it.
  if (homePrologue && !homeCallDone) {
    buildRealPhone(scene, COUCH_PHONE.x, 0.78, COUCH_PHONE.z, Math.PI / 2);
    phoneGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd166, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    phoneGlow.scale.set(1.6, 1.6, 1); phoneGlow.position.set(COUCH_PHONE.x, 1.1, COUCH_PHONE.z); scene.add(phoneGlow);
    const ring = textSprite('PHONE RINGING', '#2a2118', '#ffd166', 'Answer it on the couch');
    ring.scale.set(3.0, 0.75, 1); ring.position.set(COUCH_PHONE.x, 1.9, COUCH_PHONE.z); scene.add(ring);
    startRinging();
  }
  // The front door: a real, visible, walkable exit on the north wall.
  // It is locked and needs the mansion key, which is on the dining
  // table. In the prologue the door leads to the Train Terminal (the
  // same as the button); after that it leaves the Mansion. The button
  // stays as a backup.
  addExitDoor(scene, { x: 4.5, z: -4.9, ry: 0, keyId: 'mansion', keyLabel: 'mansion key', label: 'EXIT - FRONT DOOR' });
  addRoomKey(scene, 3.8, 3.2, 'mansion', 'mansion key');
}

function buildSafehouse(scene) {
  // A smaller furnished apartment, 8 wide, 6 deep, laid out room by
  // room like the reference: a bedroom corner in the north-west, a
  // living area in the east with a blue sofa and a TV, a kitchenette
  // along the south wall, and a table to save at. A low partition
  // separates the bed from the living area.
  roomShell(scene, 8, 6, 3.0, 0x5a4632, 0xbfb09a);
  // --- Bedroom corner (north-west): a rug, the bed, a nightstand, a wardrobe.
  const bedRug = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.04, 3.0), mat(0x4a5a7a, { roughness: 1 }));
  bedRug.position.set(-2.4, 0.12, -1.4); bedRug.receiveShadow = true; scene.add(bedRug);
  addBed(scene, -2.4, -1.4, 1.6, true);
  addNightstand(scene, -1.2, -2.5);
  addWardrobe(scene, -3.7, 0.5, Math.PI / 2);
  // A low partition between the bed and the living area, with a gap at
  // the south end to walk through.
  addPartition(scene, 0, -1.5, 2.5, Math.PI / 2);
  // --- Living area (east): a blue sofa facing the TV, a coffee table,
  // a dark rug, and a ceiling fan above.
  const liveRug = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.04, 2.4), mat(0x1a1a2a, { roughness: 1 }));
  liveRug.position.set(1.8, 0.12, -1.2); liveRug.receiveShadow = true; scene.add(liveRug);
  addSofa(scene, 1.8, -0.4, 2.2, 0x2e4a8a, 'sofa', Math.PI);
  addCoffeeTable(scene, 1.8, -1.4, 1.1);
  addTV(scene, 1.8, 1.4, -2.85, 1.6, 'tv');
  addCeilingFan(scene, 1.8, -1.2);
  addPlant(scene, 3.5, -2.5, 0.8);
  // --- Kitchenette (south wall): counters, stove, sink, mini fridge.
  addKitchen(scene, 0.5, 2.6, 2.4, -Math.PI / 2);
  // Small table (click it to save, like the bed).
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 1.0), mat(0x4a3220, { roughness: 0.6 }));
  top.position.set(0, 0.72, 1.6); top.castShadow = true; top.name = 'table'; top.userData.homeAction = 'save'; homeTargets.push(top); scene.add(top);
  for (const [dx, dz] of [[-0.7, -0.4], [0.7, -0.4], [-0.7, 0.4], [0.7, 0.4]]) {
    hcyl(scene, 0.04, 0.04, 0.72, 0x2a2118, dx, 0.36, 1.6 + dz, null, { roughness: 0.6 });
  }
  hitBox(scene, 2.0, 1.2, 1.4, 0, 0.7, 1.6, 'save');
  for (const [dx, dz, ry] of [[-1.3, 1.6, Math.PI / 2], [1.3, 1.6, -Math.PI / 2]]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 0.45), mat(0x6b4226, { roughness: 0.7 }));
    seat.position.set(dx, 0.45, dz); scene.add(seat);
  }
  addWindow(scene, 3.9, 1.8, -1, -Math.PI / 2);
  addFloorLamp(scene, -3.2, 2);
  lamp(scene, 0, 2.5, 0, 0xffe0b0, 0.6, 10);
  const sign = textSprite('SAFE HOUSE', '#2a2118', '#7ac74f', 'Nobody knows this place');
  sign.scale.set(3.0, 0.75, 1); sign.position.set(0, 2.6, -2.8); scene.add(sign);
  // The front door: a real, visible, walkable exit on the east wall.
  // It is locked and needs the safehouse key, which is on the table.
  addExitDoor(scene, { x: 3.9, z: 0, ry: -Math.PI / 2, keyId: 'safehouse', keyLabel: 'safehouse key', label: 'EXIT - FRONT DOOR' });
  addRoomKey(scene, 0, 1.6, 'safehouse', 'safehouse key');
}

// ---------- Visitable exteriors (white modern buildings, like the photo) ----------
function addTree(scene, x, z) {
  hcyl(scene, 0.12, 0.16, 1.6, 0x4a3220, x, 0.8, z, null, { roughness: 1 });
  const crown = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), mat(0x3a6a2a, { roughness: 1 }));
  crown.position.set(x, 2.4, z); crown.castShadow = true; scene.add(crown);
}
function buildHospital(scene) {
  // Bright blue sky, like the photo. A tall white tower with a rounded
  // corner and rows of windows, plus a lower white wing in front.
  scene.background = new THREE.Color(0x2a6db5);
  scene.fog = new THREE.Fog(0x9fc4e8, 40, 140);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat(0x4a7a3a, { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const forecourt = new THREE.Mesh(new THREE.PlaneGeometry(30, 18), mat(0xb8bcc0, { roughness: 0.95 }));
  forecourt.rotation.x = -Math.PI / 2; forecourt.position.set(0, 0.02, 2); forecourt.receiveShadow = true; scene.add(forecourt);
  const crossing = new THREE.Mesh(new THREE.PlaneGeometry(10, 2), mat(0x8a3a2a, { roughness: 1 }));
  crossing.rotation.x = -Math.PI / 2; crossing.position.set(0, 0.04, 8); scene.add(crossing);
  // Main tower: white slab, 10 wide, 16 high, 6 deep, window grid texture.
  const towerMat = whiteFacadeMat(6, 14, 0.08);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(10, 16, 6), towerMat);
  tower.position.set(0, 8, -8); tower.castShadow = true; tower.receiveShadow = true; scene.add(tower);
  // Rounded corner: a white cylinder at the front-left corner, full height,
  // so the tower reads as curved on that edge, like the photo.
  const corner = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 16, 20), mat(0xf4f6f8, { roughness: 0.85 }));
  corner.position.set(-5, 8, -5); corner.castShadow = true; scene.add(corner);
  // A vertical strip of windows on the rounded corner.
  for (let i = 0; i < 9; i++) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.8), mat(0x2a3a4a, { roughness: 0.2, metalness: 0.3 }));
    w.position.set(-5, 1.6 + i * 1.6, -3.18); scene.add(w);
  }
  // Lower white wing in front, with its own window grid.
  const wingMat = whiteFacadeMat(8, 3, 0.1);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(12, 4, 5), wingMat);
  wing.position.set(2, 2, -2); wing.castShadow = true; wing.receiveShadow = true; scene.add(wing);
  // Glass entrance on the wing, with a canopy.
  const door = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.6), mat(0x1a3a5a, { roughness: 0.1, metalness: 0.5 }));
  door.position.set(2, 1.3, 0.55); door.name = 'info'; door.userData.homeAction = 'info'; homeTargets.push(door); scene.add(door);
  hbox(scene, 3.4, 0.15, 1.2, 0xd8d8d8, 2, 2.9, 0.9, null, { roughness: 0.5 });
  // Red cross on the tower.
  hbox(scene, 1.6, 0.5, 0.1, 0xc0392b, 0, 13.5, -4.95, null, { roughness: 0.6 });
  hbox(scene, 0.5, 1.6, 0.1, 0xc0392b, 0, 13.5, -4.95, null, { roughness: 0.6 });
  const sign = textSprite('CITY HOSPITAL', '#f4f6f8', '#2a3a4a', 'Emergency - open 24 hours');
  sign.scale.set(6, 1.5, 1); sign.position.set(0, 11, -4.6); scene.add(sign);
  // An ambulance van parked by the entrance.
  const van = new THREE.Group(); scene.add(van);
  const vb = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.6, 1.9), mat(0xf4f6f8, { roughness: 0.4, metalness: 0.2 }));
  vb.position.set(-8, 1.0, 4); vb.castShadow = true; van.add(vb);
  const vc = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.8), mat(0xd8e2ea, { roughness: 0.3, metalness: 0.4 }));
  vc.position.set(-5.4, 0.9, 4); van.add(vc);
  hbox(scene, 1.0, 0.35, 0.06, 0xc0392b, -8, 1.1, 4.98, null, { roughness: 0.6 });
  for (const wx of [-9.6, -6.4]) {
    hcyl(scene, 0.42, 0.42, 0.3, 0x111111, wx, 0.42, 5.0, null, { roughness: 0.9 });
  }
  addTree(scene, -12, -2); addTree(scene, 12, -4); addTree(scene, 10, 8);
  const bench = hbox(scene, 2.0, 0.08, 0.5, 0x6b4226, 8, 0.45, 6, null, { roughness: 0.8 });
  bench.position.y = 0.45;
  lamp(scene, -6, 3.2, 6, 0xfff2c0, 0.7, 10);
  lamp(scene, 6, 3.2, 10, 0xfff2c0, 0.7, 10);
}
function buildIndustry(scene) {
  // White modern factory buildings with window grids, smokestacks, tanks.
  scene.background = new THREE.Color(0x7aa0c4);
  scene.fog = new THREE.Fog(0x9fc4e8, 40, 140);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat(0x8a8a82, { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(40, 26), mat(0x6a6a62, { roughness: 0.95 }));
  yard.rotation.x = -Math.PI / 2; yard.position.set(0, 0.02, 0); yard.receiveShadow = true; scene.add(yard);
  // Main treatment hall: a long white modern block with a window grid.
  const hallMat = whiteFacadeMat(10, 4, 0.05);
  const hall = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 9), hallMat);
  hall.position.set(-2, 3, -8); hall.castShadow = true; hall.receiveShadow = true; scene.add(hall);
  // Office block beside it, also white with rows of windows.
  const offMat = whiteFacadeMat(6, 5, 0.15);
  const office = new THREE.Mesh(new THREE.BoxGeometry(8, 7, 6), offMat);
  office.position.set(10, 3.5, -8); office.castShadow = true; office.receiveShadow = true; scene.add(office);
  // Smokestacks: white with a red band at the top.
  for (const sx of [-8, -5]) {
    hcyl(scene, 0.7, 0.9, 12, 0xf4f6f8, sx, 6, -12, null, { roughness: 0.7 });
    hcyl(scene, 0.72, 0.72, 1.2, 0xc0392b, sx, 11.4, -12, null, { roughness: 0.7 });
  }
  // Storage tanks.
  for (let i = 0; i < 3; i++) {
    hcyl(scene, 1.6, 1.6, 3.2, 0xd8d8d8, -12 + i * 4, 1.6, 4, null, { metalness: 0.5, roughness: 0.4 });
  }
  // Pipes between the hall and the tanks.
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 10, 10), mat(0x6a747a, { metalness: 0.7, roughness: 0.4 }));
  pipe.rotation.z = Math.PI / 2; pipe.position.set(-6, 1.0, 0); pipe.castShadow = true; scene.add(pipe);
  const pipe2 = pipe.clone(); pipe2.position.set(-6, 2.2, -4); scene.add(pipe2);
  // Barrels.
  for (let i = 0; i < 5; i++) {
    hcyl(scene, 0.35, 0.35, 0.9, [0x2e6fb0, 0xc07a1a, 0x4a7c59, 0x8a5a9a, 0xc0392b][i], 12 + (i % 3) * 1.2, 0.45, 2 + Math.floor(i / 3) * 1.2, null, { roughness: 0.7 });
  }
  const sign = textSprite('INDUSTRIAL AREA', '#f4f6f8', '#2a3a4a', 'Water treatment plant');
  sign.scale.set(6, 1.5, 1); sign.position.set(-2, 8, -3.4); scene.add(sign);
  const gate = textSprite('AUTHORISED PERSONNEL', '#2a2118', '#ffd166', '');
  gate.scale.set(4, 1, 1); gate.position.set(0, 3.2, 10); scene.add(gate);
  addTree(scene, 14, 6);
  lamp(scene, -10, 3.2, 8, 0xfff2c0, 0.7, 10);
}

// A simple parked car (body + cabin + wheels) for the car park and airport.
function homeCar(scene, color, x, z, ry) {
  // A realistic car, built from parts (see player.js buildCar): a shaped
  // body with a hood, a glass cabin with a roof, four wheels with hubs,
  // headlights, taillights, a grille and bumpers - not a box.
  const car = buildCar(color, { type: 'sedan' });
  car.position.set(x, 0, z); car.rotation.y = ry || 0;
  scene.add(car);
  return car;
}
function departuresTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0a0f14'; ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#ffd166'; ctx.font = 'bold 30px Arial'; ctx.textAlign = 'left';
  ctx.fillText('DEPARTURES', 20, 40);
  ctx.fillStyle = '#f2e9d8'; ctx.font = '24px Arial';
  const rows = [['4', 'Downtown', 'NOW'], ['7', 'Flushing', '4 min'], ['A', 'Far Rockaway', '9 min'], ['1', 'South Ferry', '12 min']];
  rows.forEach((r, i) => {
    ctx.fillText(r[0] + '  ' + r[1], 20, 80 + i * 40);
    ctx.fillStyle = r[2] === 'NOW' ? '#7ac74f' : '#ffd166';
    ctx.fillText(r[2], 380, 80 + i * 40);
    ctx.fillStyle = '#f2e9d8';
  });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function buildTerminal(scene) {
  // Grand Central: a big hall, 24 wide, 30 deep, 8 high. The entrance
  // is at the south end (z = 15), the concourse in the middle, and the
  // platform with the 4 train at the north end (z = -14). The player
  // enters through the entrance, walks the concourse to the platform,
  // and boards the train. People cross the concourse going to work.
  roomShell(scene, 24, 30, 8, 0x8a8a86, 0xd8cfc0);
  // The departures board on the north wall, and a big clock.
  const board = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshStandardMaterial({ map: departuresTexture(), roughness: 0.4 }));
  board.position.set(0, 5, -14.9); scene.add(board);
  const clock = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.15, 24), mat(0xf4f6f8, { roughness: 0.4 }));
  clock.rotation.x = Math.PI / 2; clock.position.set(0, 6.8, -14.9); scene.add(clock);
  const clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.75, 24), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  clockFace.position.set(0, 6.8, -14.8); scene.add(clockFace);
  // Pillars down the concourse, and benches.
  for (const z of [-6, 0, 6]) for (const x of [-8, 8]) {
    hcyl(scene, 0.5, 0.6, 8, 0xd8cfc0, x, 4, z, null, { roughness: 0.6 });
  }
  for (const z of [-4, 4]) {
    const bench = new THREE.Group(); scene.add(bench);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(4, 0.15, 0.8), mat(0x6b4226, { roughness: 0.7 }));
    seat.position.set(0, 0.45, z); bench.add(seat);
    for (const dx of [-1.8, 1.8]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.7), mat(0x2a2118));
      leg.position.set(dx, 0.22, z); bench.add(leg);
    }
  }
  // Ticket machines along the east wall.
  for (let i = 0; i < 4; i++) {
    hbox(scene, 0.8, 1.6, 0.6, 0x2e6fb0, 11.4, 0.8, -2 + i * 2.2, null, { roughness: 0.5, metalness: 0.3 });
  }
  // Big windows on the west wall, with a daylight sky.
  for (const z of [-8, 0, 8]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(3, 4), new THREE.MeshStandardMaterial({ map: nightSkyTexture(), roughness: 0.2, metalness: 0.3 }));
    win.position.set(-11.9, 4, z); win.rotation.y = Math.PI / 2; scene.add(win);
  }
  // The platform: a raised slab at the north end, and the 4 train on
  // tracks beside it. The train is a long box with lit windows.
  hbox(scene, 22, 1.0, 4, 0x6a6a62, 0, 0.5, -12, null, { roughness: 0.9 });
  const railMat = mat(0x9aa2a8, { metalness: 0.9, roughness: 0.3 });
  for (const rz of [-14.4, -13.2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(22, 0.12, 0.12), railMat);
    rail.position.set(0, 0.06, rz); scene.add(rail);
  }
  const train = new THREE.Group(); scene.add(train);
  const tBody = new THREE.Mesh(new THREE.BoxGeometry(20, 2.4, 2.4), mat(0x2a4a6a, { roughness: 0.5, metalness: 0.4 }));
  tBody.position.set(0, 1.6, -13.8); tBody.castShadow = true; tBody.name = 'boardTrain'; tBody.userData.homeAction = 'boardTrain'; homeTargets.push(tBody); train.add(tBody);
  for (let i = 0; i < 8; i++) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), new THREE.MeshStandardMaterial({ color: 0x201808, emissive: 0xffd166, emissiveIntensity: 1.0 }));
    win.position.set(-8 + i * 2.3, 1.7, -12.55); train.add(win);
  }
  hitBox(scene, 20, 3, 3, 0, 1.6, -13.8, 'boardTrain');
  // Signs: the platform and the entrance.
  const plat = textSprite('PLATFORM 4 - THE 4 TRAIN', '#2a2118', '#ffd166', 'Downtown - board here');
  plat.scale.set(6, 1.5, 1); plat.position.set(0, 6.2, -12.5); scene.add(plat);
  const ent = textSprite('GRAND CENTRAL - ENTRANCE', '#2a2118', '#f2e9d8', '');
  ent.scale.set(5, 1.25, 1); ent.position.set(0, 6.5, 14.6); ent.rotation.y = Math.PI; scene.add(ent);
  lamp(scene, 0, 7, 0, 0xffe0b0, 1.2, 20);
  lamp(scene, -6, 7, 8, 0xffe0b0, 0.8, 14);
  lamp(scene, 6, 7, -8, 0xffe0b0, 0.8, 14);
  // People crossing the concourse, going to work: singles and pairs,
  // different paces, some on a phone, some with bags.
  const crowd = makeCrowd({ count: 12, bounds: { minX: -10, maxX: 10, minZ: -8, maxZ: 13 } });
  for (const p of crowd) { scene.add(p.group); terminalPedestrians.push(p); }
  // The main entrance: a real, visible, walkable exit at the south end.
  // It is a public building, so the entrance is unlocked. Walking
  // through it leaves the Terminal (the Leave button stays as a backup).
  addExitDoor(scene, { x: 0, z: 14.9, ry: Math.PI, label: 'EXIT - MAIN ENTRANCE' });
}
function buildHotel(scene) {
  // A hotel suite, 10 wide, 7 deep, laid out room by room like the
  // reference: a bedroom area in the north-west, a living area in the
  // north-east with a blue sofa and a TV, a desk in the south-east, and
  // a bathroom in the south-west, with a low partition around the
  // bathroom so the layout reads room by room. The bed sleeps (and
  // saves), like the mansion.
  roomShell(scene, 10, 7, 3.2, 0x5a4632, 0xd8cfc0);
  // --- Bedroom area (north-west): a rug, the bed, two nightstands, a wardrobe.
  const bedRug = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.04, 3.6), mat(0x2e4a6b, { roughness: 1 }));
  bedRug.position.set(-2.8, 0.12, -1.6); bedRug.receiveShadow = true; scene.add(bedRug);
  addBed(scene, -2.8, -1.8, 2.2, false);
  addNightstand(scene, -1.4, -2.8);
  addNightstand(scene, -4.2, -2.8);
  addWardrobe(scene, -4.7, -0.5, Math.PI / 2);
  // --- Living area (north-east): a blue sofa facing the TV, a coffee
  // table, a dark rug, and a ceiling fan above.
  const liveRug = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.04, 2.6), mat(0x1a1a2a, { roughness: 1 }));
  liveRug.position.set(1.8, 0.12, -1.4); liveRug.receiveShadow = true; scene.add(liveRug);
  addSofa(scene, 1.8, -0.6, 2.4, 0x2e4a8a, 'sofa', Math.PI);
  addCoffeeTable(scene, 1.8, -1.6, 1.2);
  addTV(scene, 1.8, 1.6, -3.35, 2.0, 'tv');
  addCeilingFan(scene, 1.8, -1.4);
  addPlant(scene, 4.5, -3.0, 0.9);
  // --- Desk area (south-east): a desk with a chair, and a minibar fridge.
  hbox(scene, 1.8, 0.08, 0.9, 0x4a3220, 3.6, 0.75, 1.6, null, { roughness: 0.6 });
  for (const [dx, dz] of [[-0.8, -0.35], [0.8, -0.35], [-0.8, 0.35], [0.8, 0.35]]) {
    hcyl(scene, 0.04, 0.04, 0.75, 0x2a2118, 3.6 + dx, 0.37, 1.6 + dz, null, { roughness: 0.6 });
  }
  const chair = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), mat(0x6b4226, { roughness: 0.7 }));
  chair.position.set(3.6, 0.45, 2.6); scene.add(chair);
  hbox(scene, 0.7, 1.1, 0.6, 0xd8d8d8, 4.6, 0.55, 2.8, null, { metalness: 0.5, roughness: 0.3 });
  // --- Bathroom (south-west, partitioned): a tub along the south wall,
  // a toilet and a sink. The partitions leave a 1 m gap to walk in.
  addPartition(scene, -4, 1.2, 2, 0);
  addPartition(scene, -2, 2.35, 2.3, Math.PI / 2);
  addBathtub(scene, -3.5, 3.0, Math.PI / 2);
  addToilet(scene, -4.6, 1.8, 0);
  addBathroomSink(scene, -2.4, 1.8, -Math.PI / 2);
  addWindow(scene, 4.9, 1.8, -1, -Math.PI / 2);
  addFloorLamp(scene, -0.5, 2.8);
  lamp(scene, 0, 2.6, 0, 0xffe0b0, 0.7, 10);
  const sign = textSprite('HOTEL - YOUR SUITE', '#2a2118', '#ffd166', 'Room 412 - sleep here');
  sign.scale.set(3.4, 0.85, 1); sign.position.set(0, 2.7, -3.3); scene.add(sign);
  // The suite door: a real, visible, walkable exit on the east wall.
  // It is locked and needs the hotel key, which is on the desk.
  addExitDoor(scene, { x: 4.9, z: 0, ry: -Math.PI / 2, keyId: 'hotel', keyLabel: 'hotel key', label: 'EXIT - SUITE DOOR' });
  addRoomKey(scene, 3.6, 1.6, 'hotel', 'hotel key');
}
function buildAirport(scene) {
  // JFK terminal exterior: a long white modern terminal with a glass
  // front, a control tower, a runway, and a parked plane.
  scene.background = new THREE.Color(0x2a6db5);
  scene.fog = new THREE.Fog(0x9fc4e8, 40, 160);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), mat(0x8a8a82, { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(50, 30), mat(0x6a6a62, { roughness: 0.95 }));
  apron.rotation.x = -Math.PI / 2; apron.position.set(0, 0.02, -6); apron.receiveShadow = true; scene.add(apron);
  // The terminal: a long white modern block with a glass front.
  const termMat = whiteFacadeMat(12, 4, 0.1);
  const term = new THREE.Mesh(new THREE.BoxGeometry(24, 8, 8), termMat);
  term.position.set(0, 4, 6); term.castShadow = true; term.receiveShadow = true; scene.add(term);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(20, 5), mat(0x1a3a5a, { roughness: 0.1, metalness: 0.5 }));
  glass.position.set(0, 3, 1.95); scene.add(glass);
  const sign = textSprite('AIRPORT - JFK', '#f4f6f8', '#2a3a4a', 'Terminal 4 - flights out');
  sign.scale.set(7, 1.75, 1); sign.position.set(0, 9.5, 1.8); scene.add(sign);
  // The control tower: a tall white cylinder with a wider top.
  hcyl(scene, 1.2, 1.6, 20, 0xf4f6f8, 16, 10, -10, null, { roughness: 0.7 });
  hcyl(scene, 2.6, 2.6, 2.5, 0x2a3a4a, 16, 21, -10, null, { roughness: 0.4, metalness: 0.3 });
  // The runway: a long dark strip with white markings.
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(70, 8), mat(0x2a2d30, { roughness: 0.95 }));
  runway.rotation.x = -Math.PI / 2; runway.position.set(0, 0.03, -22); runway.receiveShadow = true; scene.add(runway);
  for (let x = -32; x <= 32; x += 8) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.3), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }));
    dash.rotation.x = -Math.PI / 2; dash.position.set(x, 0.05, -22); scene.add(dash);
  }
  // A parked plane: fuselage, wings, tail, engines.
  const plane = new THREE.Group(); scene.add(plane);
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 12, 16), mat(0xf4f6f8, { roughness: 0.4, metalness: 0.3 }));
  fus.rotation.z = Math.PI / 2; fus.position.set(0, 2, -22); fus.castShadow = true; plane.add(fus);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), mat(0xf4f6f8, { roughness: 0.4 }));
  nose.position.set(6, 2, -22); plane.add(nose);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 6), mat(0xd8d8d8, { roughness: 0.4, metalness: 0.4 }));
    wing.position.set(0, 1.8, -22 + s * 4); plane.add(wing);
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.6, 12), mat(0x8a949a, { metalness: 0.7, roughness: 0.3 }));
    eng.rotation.z = Math.PI / 2; eng.position.set(0.5, 1.2, -22 + s * 3.5); plane.add(eng);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.5, 2.5), mat(0x2e6fb0, { roughness: 0.5 }));
  tail.position.set(-5.8, 3.5, -22); plane.add(tail);
  homeCar(scene, 0xc0392b, -10, 12, 0.3);
  homeCar(scene, 0x2e6fb0, -6, 14, -0.2);
  homeCar(scene, 0xd8d8d8, 8, 13, 0.1);
  addTree(scene, -14, 10); addTree(scene, 14, 12);
  lamp(scene, -8, 3.2, 10, 0xfff2c0, 0.7, 10);
  lamp(scene, 8, 3.2, 12, 0xfff2c0, 0.7, 10);
}
function buildCarpark(scene) {
  // A parking lot: asphalt, painted bays, rows of parked cars, lamps.
  scene.background = new THREE.Color(0x7aa0c4);
  scene.fog = new THREE.Fog(0x9fc4e8, 40, 140);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat(0x3a3d40, { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  // Painted parking bays: two rows, white lines.
  for (let r = 0; r < 2; r++) {
    const rz = r === 0 ? -4 : 4;
    for (let i = 0; i < 8; i++) {
      const x = -14 + i * 4;
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 5), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }));
      line.rotation.x = -Math.PI / 2; line.position.set(x, 0.04, rz); scene.add(line);
    }
  }
  // Rows of parked cars, varied colours.
  const cols = [0xc0392b, 0x2e6fb0, 0xd8d8d8, 0x3a3a3a, 0xc07a1a, 0x5a7a3a, 0x7a2e5a, 0x2e7a4a];
  for (let r = 0; r < 2; r++) {
    const rz = r === 0 ? -4 : 4;
    for (let i = 0; i < 7; i++) {
      if (Math.random() < 0.2) continue; // some bays empty
      homeCar(scene, cols[(r * 7 + i) % cols.length], -12 + i * 4, rz, r === 0 ? Math.PI / 2 : -Math.PI / 2);
    }
  }
  // A few lamp posts and trees around the lot.
  for (const [lx, lz] of [[-16, -8], [0, -8], [16, -8], [-16, 8], [16, 8]]) {
    hcyl(scene, 0.08, 0.08, 4.5, 0x6a747a, lx, 2.25, lz, null, { metalness: 0.8, roughness: 0.4 });
    lamp(scene, lx, 4.5, lz, 0xffe9a8, 0.8, 12);
  }
  addTree(scene, -18, 12); addTree(scene, 18, -10); addTree(scene, 10, 14);
  const sign = textSprite('CAR PARK', '#2a2118', '#ffd166', 'Parking - 2 ZAMA an hour');
  sign.scale.set(5, 1.25, 1); sign.position.set(0, 5, -12); scene.add(sign);
}

// A projector slide for the symposium screen: a New York title card.
function symposiumScreenTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 288;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f6f8'; ctx.fillRect(0, 0, 512, 288);
  ctx.fillStyle = '#1a2a4a'; ctx.fillRect(0, 0, 512, 90);
  ctx.fillStyle = '#ffd166'; ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center';
  ctx.fillText('NEW YORK SYMPOSIUM', 256, 58);
  ctx.fillStyle = '#1a2a4a'; ctx.font = 'bold 30px Arial';
  ctx.fillText('Engineering the future', 256, 150);
  ctx.font = '24px Arial'; ctx.fillStyle = '#4a5a6a';
  ctx.fillText('New York City - all are welcome', 256, 195);
  ctx.fillStyle = '#c0392b'; ctx.fillRect(156, 230, 200, 6);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// Redraw the wind tunnel gauge reading (a canvas texture on the panel).
function setTunnelGaugeText(text) {
  if (!tunnelGaugeCanvas || !tunnelGaugeTex) return;
  const ctx = tunnelGaugeCanvas.getContext('2d');
  ctx.fillStyle = '#0a0f14'; ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#7ac74f'; ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center';
  ctx.fillText(text, 128, 38);
  tunnelGaugeTex.needsUpdate = true;
}
function startTunnelRun() {
  if (tunnelDone) { showHomeToast('Wind tunnel test complete - the data is in.'); return; }
  if (tunnelRunning) { showHomeToast('The wind tunnel is already running...'); return; }
  tunnelRunning = true; tunnelRunT = 0;
  showHomeToast('Wind tunnel running - fan spinning up...');
}
function finishTunnelRun() {
  tunnelRunning = false; tunnelDone = true;
  setTunnelGaugeText('42 m/s - 1.2 kPa - DONE');
  showHomeToast('Wind tunnel test complete - clean airflow at 42 m/s.');
  grantPayout('windtunnel');
}
function buildWindtunnel(scene) {
  // An engineering lab, 18 wide, 12 deep, built around one long wooden
  // wind tunnel: a flared wooden contraction cone at the west end
  // (wide mouth narrowing into the tunnel), a straight test section
  // with glass viewing windows and metal latches, metal support frames
  // under it, and a fan at the east end. The player walks around it and
  // runs it from the control panel on the south side.
  roomShell(scene, 18, 12, 3.6, 0x8a8a82, 0xcfd8dc);
  // Tiled floor and a tiled band along the walls, like a real lab.
  const floorTex = tileTexture(); floorTex.repeat.set(9, 6);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 12), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.6 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.11, 0); floor.receiveShadow = true; scene.add(floor);
  const wallTex = tileTexture(); wallTex.repeat.set(9, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.7 });
  for (const [w, x, z, ry] of [[18, 0, -5.92, 0], [18, 0, 5.92, 0], [12, -8.92, 0, Math.PI / 2], [12, 8.92, 0, Math.PI / 2]]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, 0.06), wallMat);
    band.position.set(x, 0.6, z); band.rotation.y = ry; band.receiveShadow = true; scene.add(band);
  }
  // Big windows on the south wall, with a daytime sky.
  const skyTex = daySkyTexture();
  for (const wx of [-5, 0, 5]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.9, 2.3, 0.08), mat(0x2a2a2a, { roughness: 0.6 }));
    frame.position.set(wx, 2.1, 5.94); scene.add(frame);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.0), new THREE.MeshStandardMaterial({ map: skyTex, roughness: 0.2, metalness: 0.2 }));
    win.position.set(wx, 2.1, 5.89); win.rotation.y = Math.PI; scene.add(win);
  }
  addCeilingFan(scene, -6, 3);
  addCeilingFan(scene, 0, 3);
  addCeilingFan(scene, 6, 3);
  const wood = mat(0x8a6a42, { roughness: 0.7 });
  const woodDark = mat(0x6b4a2a, { roughness: 0.7 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa2a8, metalness: 0.8, roughness: 0.35 });
  const tz = -1.5; // tunnel axis (z), centre height 1.25
  // Metal support frames under the tunnel.
  for (const fx of [-4.5, -1, 1.5, 4]) {
    for (const dz of [-0.6, 0.6]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), steel);
      leg.position.set(fx, 0.25, tz + dz); leg.castShadow = true; scene.add(leg);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 1.32), steel);
    bar.position.set(fx, 0.5, tz); scene.add(bar);
  }
  // The contraction cone: a flared wooden cone, wide mouth at the west
  // end narrowing into the test section. CylinderGeometry is along Y,
  // so it is laid on its side; radiusTop ends up at the west mouth.
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 0.75, 4, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.7, side: THREE.DoubleSide }));
  cone.rotation.z = Math.PI / 2; cone.position.set(-4.5, 1.25, tz); cone.castShadow = true; scene.add(cone);
  const mouthRim = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.08, 10, 32), woodDark);
  mouthRim.rotation.y = Math.PI / 2; mouthRim.position.set(-6.5, 1.25, tz); scene.add(mouthRim);
  const throatRim = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.06, 10, 24), woodDark);
  throatRim.rotation.y = Math.PI / 2; throatRim.position.set(-2.5, 1.25, tz); scene.add(throatRim);
  // The test section: a wooden frame with glass viewing windows on both
  // long sides and the top, held by metal latches. A model wing on a
  // sting sits inside, visible through the glass.
  const postY = [0.56, 1.94];
  for (const py of postY) for (const pz of [tz - 0.69, tz + 0.69]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 0.12), wood);
    post.position.set(1, py, pz); post.castShadow = true; scene.add(post);
  }
  for (const ex of [-2.5, 4.5]) {
    for (const py of postY) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.5), wood);
      bar.position.set(ex, py, tz); scene.add(bar);
    }
    for (const pz of [tz - 0.69, tz + 0.69]) {
      const upright = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.12), wood);
      upright.position.set(ex, 1.25, pz); scene.add(upright);
    }
  }
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.25, roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide });
  const glassS = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 1.26), glassMat);
  glassS.position.set(1, 1.25, tz + 0.72); scene.add(glassS);
  const glassN = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 1.26), glassMat);
  glassN.position.set(1, 1.25, tz - 0.72); glassN.rotation.y = Math.PI; scene.add(glassN);
  const glassT = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 1.38), glassMat);
  glassT.rotation.x = -Math.PI / 2; glassT.position.set(1, 1.98, tz); scene.add(glassT);
  // Metal latches along the glass edges.
  for (const lx of [-2, -0.5, 1, 2.5, 4]) {
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.06), steel);
    latch.position.set(lx, 1.25, tz + 0.76); scene.add(latch);
    const latch2 = latch.clone(); latch2.position.z = tz - 0.76; scene.add(latch2);
  }
  // The model wing inside the test section, on a sting.
  const sting = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), steel);
  sting.position.set(1, 0.85, tz); scene.add(sting);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.35), mat(0xc0392b, { roughness: 0.5 }));
  wing.position.set(1, 1.15, tz); wing.castShadow = true; scene.add(wing);
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), mat(0x2a2a2a, { roughness: 0.5 }));
  fus.rotation.z = Math.PI / 2; fus.position.set(1, 1.15, tz); scene.add(fus);
  // The fan housing and diffuser at the east end, and the fan itself.
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.0, 20), steel);
  housing.rotation.z = Math.PI / 2; housing.position.set(5.0, 1.25, tz); housing.castShadow = true; scene.add(housing);
  const diffuser = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.1, 0.8, 20), wood);
  diffuser.rotation.z = Math.PI / 2; diffuser.position.set(5.9, 1.25, tz); diffuser.castShadow = true; scene.add(diffuser);
  tunnelFan = new THREE.Group();
  tunnelFan.position.set(5.0, 1.25, tz);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 0.18), mat(0x2a2a2a, { metalness: 0.6, roughness: 0.4 }));
    const a = i * Math.PI / 2;
    b.position.set(0, Math.cos(a) * 0.4, Math.sin(a) * 0.4);
    b.rotation.x = -a;
    tunnelFan.add(b);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 10), steel);
  hub.rotation.z = Math.PI / 2; tunnelFan.add(hub);
  scene.add(tunnelFan);
  // The control panel: a console on the south side of the tunnel, with
  // a pressure gauge, a needle, a digital reading and start buttons.
  const consoleBody = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 0.6), mat(0x2e4a6b, { roughness: 0.5, metalness: 0.3 }));
  consoleBody.position.set(2.5, 0.5, 0.8); consoleBody.castShadow = true;
  consoleBody.name = 'tunnelPanel'; consoleBody.userData.homeAction = 'tunnelPanel'; homeTargets.push(consoleBody); scene.add(consoleBody);
  const consoleTop = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.7), mat(0x1a2a4a, { roughness: 0.5 }));
  consoleTop.position.set(2.5, 1.04, 0.8); consoleTop.rotation.x = -0.25; scene.add(consoleTop);
  for (let i = 0; i < 3; i++) {
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 10), new THREE.MeshStandardMaterial({ color: [0x7ac74f, 0xffd166, 0xc0392b][i], roughness: 0.4 }));
    btn.position.set(2.1 + i * 0.4, 1.09, 0.72); scene.add(btn);
  }
  // The pressure gauge on the console front, with a needle that swings
  // as the fan spins up, and a digital reading below it.
  const gaugeFace = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.4 }));
  gaugeFace.position.set(2.5, 0.72, 1.11); scene.add(gaugeFace);
  const gaugeRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 8, 24), steel);
  gaugeRing.position.set(2.5, 0.72, 1.11); scene.add(gaugeRing);
  const needlePivot = new THREE.Group();
  needlePivot.position.set(2.5, 0.72, 1.12);
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.02), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.4 }));
  needle.position.set(0, 0.08, 0); needlePivot.add(needle);
  needlePivot.rotation.z = -1.1; // at rest, hard left
  scene.add(needlePivot);
  tunnelGaugeNeedle = needlePivot;
  tunnelGaugeCanvas = document.createElement('canvas'); tunnelGaugeCanvas.width = 256; tunnelGaugeCanvas.height = 64;
  tunnelGaugeTex = new THREE.CanvasTexture(tunnelGaugeCanvas); tunnelGaugeTex.colorSpace = THREE.SRGBColorSpace;
  setTunnelGaugeText('PRESSURE --');
  const reading = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.24), new THREE.MeshBasicMaterial({ map: tunnelGaugeTex }));
  reading.position.set(2.5, 0.3, 1.11); scene.add(reading);
  hitBox(scene, 1.6, 1.6, 1.0, 2.5, 0.7, 0.8, 'tunnelPanel');
  // A workbench along the south wall, and a tool cabinet.
  const benchTop = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.9), woodDark);
  benchTop.position.set(-5, 0.85, 4.6); benchTop.castShadow = true; scene.add(benchTop);
  for (const [dx, dz] of [[-1.1, -0.35], [1.1, -0.35], [-1.1, 0.35], [1.1, 0.35]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.85, 0.1), steel);
    leg.position.set(-5 + dx, 0.42, 4.6 + dz); scene.add(leg);
  }
  const tool1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.3), mat(0xc0392b, { roughness: 0.6 }));
  tool1.position.set(-5.4, 0.98, 4.6); scene.add(tool1);
  const tool2 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.3, 10), steel);
  tool2.rotation.z = Math.PI / 2; tool2.position.set(-4.5, 0.95, 4.6); scene.add(tool2);
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.8, 0.6), mat(0x2e6fb0, { roughness: 0.5, metalness: 0.3 }));
  cabinet.position.set(6.5, 0.9, 4.8); cabinet.castShadow = true; scene.add(cabinet);
  addPlant(scene, -8.2, 5.2, 0.9);
  lamp(scene, 0, 3.0, 0, 0xffe0b0, 1.0, 16);
  lamp(scene, -6, 3.0, 2, 0xffe0b0, 0.7, 10);
  lamp(scene, 6, 3.0, 2, 0xffe0b0, 0.7, 10);
  // The phone booth on the north wall: walk up to it (or click it) and it
  // tells you the briefing for the next mission. It pays no ZAMA.
  buildPhoneBooth(scene);
  const sign = textSprite('WIND TUNNEL LAB', '#2a2118', '#ffd166', 'Engineering lab - run the tunnel');
  sign.scale.set(5, 1.25, 1); sign.position.set(0, 3.0, -5.8); scene.add(sign);
  // The lab door: a real, visible, walkable exit on the south wall.
  // It is locked and needs the wind tunnel key, which is on the workbench.
  addExitDoor(scene, { x: 7, z: 5.9, ry: Math.PI, keyId: 'windtunnel', keyLabel: 'wind tunnel key', label: 'EXIT - LAB DOOR' });
  addRoomKey(scene, -5, 4.6, 'windtunnel', 'wind tunnel key');
}
function takePodium() {
  if (podiumDone) { showHomeToast('You already took the NYC podium - the hall heard you.'); return; }
  podiumDone = true;
  showHomeToast('You take the NYC podium - the hall falls quiet. Symposium complete.');
  grantPayout('symposium');
}
// Seat the symposium audience: real rigged people sitting in the rows,
// facing the stage. Seats are skipped in a fixed pattern so a few stay
// empty, like a real hall. If the crowd models have not finished
// loading yet, this tries again when crowdReady fires; the audience is
// never built from blocky primitives.
function buildSymposiumAudience(scene) {
  if (symposiumAudienceBuilt) return;
  const rows = [-1, 0.6, 2.2, 3.8];
  const cols = [-4.8, -2.4, 0, 2.4, 4.8];
  let seatIdx = 0, built = 0;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cols.length; c++) {
      if ((r + c) % 5 === 0) continue; // a few seats stay empty
      const sx = cols[c], sz = rows[r];
      const p = makeSeatedPerson({ modelIndex: seatIdx, x: sx, z: sz, heading: (Math.random() - 0.5) * 0.2, scale: 0.95 + Math.random() * 0.1 });
      seatIdx++;
      if (!p) continue;
      // Centre the hips over the chair: each model's hips sit at a
      // different offset from its group origin, so shift by the gap.
      try {
        p.group.updateMatrixWorld(true);
        const hp = new THREE.Vector3();
        p.bones.hips.getWorldPosition(hp);
        p.group.position.x += sx - hp.x;
        p.group.position.z += sz - hp.z;
      } catch (e) { /* the pose already put them close enough */ }
      scene.add(p.group);
      symposiumAudience.push(p);
      built++;
    }
  }
  if (built > 0) symposiumAudienceBuilt = true;
}
function buildSymposium(scene) {
  // A red-lit auditorium, 16 wide, 14 deep: rows of seats facing a
  // stage with green curtains, a projector screen, a SYMPOSIUM banner,
  // and the NYC podium. The audience sits in the seats - real rigged
  // people, like the main characters, never blocky primitives.
  roomShell(scene, 16, 14, 5, 0x4a2020, 0x3a2028);
  // Red wash over the hall, and a warm light on the stage.
  lamp(scene, -5, 4.2, 0, 0xff4a3a, 1.0, 12);
  lamp(scene, 5, 4.2, 0, 0xff4a3a, 1.0, 12);
  lamp(scene, 0, 4.2, 4, 0xff4a3a, 0.8, 10);
  lamp(scene, 0, 4.5, -5, 0xffe0b0, 1.2, 10);
  // The stage: a raised platform at the north end, with a red carpet
  // top and a red front skirt.
  const stage = new THREE.Mesh(new THREE.BoxGeometry(10, 1.0, 3), mat(0x3a2a1a, { roughness: 0.8 }));
  stage.position.set(0, 0.5, -5.5); stage.castShadow = true; stage.receiveShadow = true; scene.add(stage);
  const stageTop = new THREE.Mesh(new THREE.BoxGeometry(10, 0.06, 3), mat(0x7a1a1a, { roughness: 1 }));
  stageTop.position.set(0, 1.03, -5.5); stageTop.receiveShadow = true; scene.add(stageTop);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(10, 1.0, 0.1), mat(0x6a1a1a, { roughness: 1 }));
  skirt.position.set(0, 0.5, -3.98); scene.add(skirt);
  // Green curtains: a back curtain with fold stripes, side drapes, and
  // a valance across the top.
  const curtain = new THREE.Mesh(new THREE.BoxGeometry(11, 4.2, 0.25), mat(0x1a5a2a, { roughness: 1 }));
  curtain.position.set(0, 2.6, -6.85); scene.add(curtain);
  for (let i = 0; i < 6; i++) {
    const fold = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.2, 0.06), mat(0x0f3a1c, { roughness: 1 }));
    fold.position.set(-4.2 + i * 1.68, 2.6, -6.7); scene.add(fold);
  }
  for (const s of [-1, 1]) {
    const drape = new THREE.Mesh(new THREE.BoxGeometry(1.4, 4.2, 0.5), mat(0x123f1e, { roughness: 1 }));
    drape.position.set(s * 5.4, 2.6, -6.4); drape.castShadow = true; scene.add(drape);
  }
  const valance = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.9, 0.4), mat(0x1a5a2a, { roughness: 1 }));
  valance.position.set(0, 4.5, -6.5); scene.add(valance);
  // The projector screen, showing the New York title card.
  const screenFrame = new THREE.Mesh(new THREE.BoxGeometry(5.7, 3.2, 0.06), mat(0x1a1a1a, { roughness: 0.6 }));
  screenFrame.position.set(0, 3.0, -6.75); scene.add(screenFrame);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 3.0), new THREE.MeshStandardMaterial({ map: symposiumScreenTexture(), roughness: 0.4 }));
  screen.position.set(0, 3.0, -6.7); scene.add(screen);
  // The SYMPOSIUM banner above the stage.
  const banner = textSprite('SYMPOSIUM', '#7a1a1a', '#ffd166', 'New York City');
  banner.scale.set(6, 1.5, 1); banner.position.set(0, 4.4, -4.2); scene.add(banner);
  // The NYC podium on the stage: a stand with a slanted top, a mic,
  // and an NYC sign. Never any other city's name on it.
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.5), mat(0x4a3220, { roughness: 0.6 }));
  stand.position.set(0, 1.55, -4.6); stand.castShadow = true; scene.add(stand);
  const standTop = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.07, 0.6), mat(0x6b4226, { roughness: 0.6 }));
  standTop.position.set(0, 2.12, -4.6); standTop.rotation.x = -0.3; scene.add(standTop);
  const micStem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), mat(0x1a1a1a, { metalness: 0.6, roughness: 0.4 }));
  micStem.position.set(0.15, 2.3, -4.7); micStem.rotation.x = 0.3; scene.add(micStem);
  const mic = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mat(0x1a1a1a, { roughness: 0.5 }));
  mic.position.set(0.15, 2.55, -4.78); scene.add(mic);
  const nyc = textSprite('NYC', '#1a2a4a', '#ffd166', 'New York Symposium');
  nyc.scale.set(1.7, 0.42, 1); nyc.position.set(0, 1.75, -4.28); scene.add(nyc);
  hitBox(scene, 1.6, 1.8, 1.4, 0, 1.8, -4.6, 'podium');
  // Two chairs and a water table behind the podium.
  for (const cx of [-1.8, 1.8]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.5), mat(0x6a2a2a, { roughness: 0.9 }));
    seat.position.set(cx, 1.45, -6.0); scene.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.65, 0.08), mat(0x6a2a2a, { roughness: 0.9 }));
    back.position.set(cx, 1.78, -6.22); scene.add(back);
  }
  const wtable = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.5), mat(0x4a3220, { roughness: 0.6 }));
  wtable.position.set(2.6, 1.45, -6.0); scene.add(wtable);
  for (const [dx, dz] of [[-0.4, -0.2], [0.4, -0.2], [-0.4, 0.2], [0.4, 0.2]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.05), mat(0x2a2118, { roughness: 0.6 }));
    leg.position.set(2.6 + dx, 1.22, -6.0 + dz); scene.add(leg);
  }
  for (const gx of [2.4, 2.8]) {
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.12, 10), new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.6, roughness: 0.1 }));
    glass.position.set(gx, 1.53, -6.0); scene.add(glass);
  }
  // Rows of seats facing the stage.
  const rows = [-1, 0.6, 2.2, 3.8];
  const cols = [-4.8, -2.4, 0, 2.4, 4.8];
  for (const rz of rows) for (const cx of cols) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.5), mat(0x6a2a2a, { roughness: 0.9 }));
    seat.position.set(cx, 0.38, rz); seat.castShadow = true; scene.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.65, 0.08), mat(0x6a2a2a, { roughness: 0.9 }));
    back.position.set(cx, 0.74, rz + 0.28); scene.add(back);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.45), mat(0x2a2a2a, { roughness: 0.9 }));
    base.position.set(cx, 0.21, rz); scene.add(base);
  }
  // Seat the audience now, or when the crowd models finish loading.
  buildSymposiumAudience(scene);
  if (!symposiumAudienceBuilt) {
    try {
      onCrowdReady(() => {
        if (homeActive && homeKind === 'symposium' && homeScene && !symposiumAudienceBuilt) buildSymposiumAudience(homeScene);
      });
    } catch (e) { /* the hall stays empty rather than blocking the game */ }
  }
  const backSign = textSprite('NEW YORK SYMPOSIUM', '#7a1a1a', '#f2e9d8', 'All seats - please be seated');
  backSign.scale.set(5, 1.25, 1); backSign.position.set(0, 3.5, 6.5); scene.add(backSign);
  // The hall door: a real, visible, walkable exit on the south wall.
  // It is locked and needs the symposium key, by the back row.
  addExitDoor(scene, { x: -6, z: 6.9, ry: Math.PI, keyId: 'symposium', keyLabel: 'symposium key', label: 'EXIT - HALL DOOR' });
  addRoomKey(scene, 6.5, 5.5, 'symposium', 'symposium key');
}

// ---------- Place engine ----------
function baseLights(scene, day) {
  scene.add(new THREE.AmbientLight(0xbfc8d4, day ? 0.55 : 0.5));
  const hemi = new THREE.HemisphereLight(0x9db8d4, 0x2a2418, day ? 0.5 : 0.4); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d8, day ? 1.4 : 1.0);
  sun.position.set(12, 20, 8); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); scene.add(sun);
  return { hemi, sun };
}
// ---------- Police station, Navy barracks, Sensor Vault ----------
// The forces, and the underground water sensors: three new visitable
// places on the city map. The station and the barracks are real rooms
// with uniformed officers and sailors; the vault is an underground room
// under the treatment plant whose gauges read the same three water
// lines as the Act II valve room.
// The US flag: 13 stripes and a blue canton with stars, drawn on canvas
// so it needs no texture file. The plane hangs from a pole by its left
// edge (position the mesh so x 0 is the pole).
function makeUSFlag() {
  const c = document.createElement('canvas'); c.width = 150; c.height = 90;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 13; i++) { ctx.fillStyle = i % 2 === 0 ? '#b22234' : '#f2f2f2'; ctx.fillRect(0, i * 90 / 13, 150, 90 / 13 + 1); }
  ctx.fillStyle = '#3c3b6e'; ctx.fillRect(0, 0, 60, 90 * 7 / 13);
  ctx.fillStyle = '#f2f2f2';
  for (let r = 0; r < 5; r++) for (let col = 0; col < 6; col++) { ctx.beginPath(); ctx.arc(5 + col * 10, 5 + r * 10, 1.8, 0, Math.PI * 2); ctx.fill(); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.9), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 }));
  flag.position.set(0.75, 0, 0);
  return flag;
}
// The NYPD flag: a blue field with a white badge and NYPD in white.
function makeNYPDFlag() {
  const c = document.createElement('canvas'); c.width = 150; c.height = 90;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a2a4a'; ctx.fillRect(0, 0, 150, 90);
  ctx.fillStyle = '#f2f2f2'; ctx.beginPath(); ctx.arc(75, 32, 20, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a2a4a'; ctx.beginPath(); ctx.arc(75, 32, 13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f2f2f2'; ctx.font = 'bold 26px Arial'; ctx.textAlign = 'center';
  ctx.fillText('NYPD', 75, 76);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.9), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 }));
  flag.position.set(0.75, 0, 0);
  return flag;
}
// A wanted poster for the station bulletin board: WANTED, a silhouette,
// NYPD at the bottom.
function makeWantedPoster() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2ede2'; ctx.fillRect(0, 0, 128, 160);
  ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 24px Arial'; ctx.textAlign = 'center';
  ctx.fillText('WANTED', 64, 30);
  ctx.fillStyle = '#5a5a5a'; ctx.beginPath(); ctx.arc(64, 70, 22, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(64, 132, 30, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 16px Arial';
  ctx.fillText('NYPD', 64, 152);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
}
// A police station lobby: a front desk, benches, a barred cell, flags,
// a bulletin board with wanted posters, and officers on duty.
function buildPoliceStation(scene) {
  const wallMat = mat(0x9ab8a8, { roughness: 0.95 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(18, 0.1, 14), mat(0x3a3a3a, { roughness: 0.9 }));
  floor.position.set(0, 0.05, 0); floor.receiveShadow = true; scene.add(floor);
  const mk = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat); m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m; };
  mk(18, 3.4, 0.2, 0, 1.7, -7); mk(18, 3.4, 0.2, 0, 1.7, 7);
  mk(0.2, 3.4, 14, -9, 1.7, 0); mk(0.2, 3.4, 14, 9, 1.7, 0);
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(18, 0.1, 14), mat(0xd8d8d8, { roughness: 0.95 }));
  ceil.position.set(0, 3.45, 0); scene.add(ceil);
  // Front desk: a long wooden counter with a bell, a phone and papers.
  const desk = roundedBox(4.5, 1.1, 0.9, 0.06, mat(0x6b4226, { roughness: 0.6 }));
  desk.position.set(0, 0.55, -5); desk.castShadow = true; scene.add(desk);
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.25 }));
  bell.position.set(-1.2, 1.15, -5); scene.add(bell);
  const deskPhone = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.2), mat(0x1a1a1a, { roughness: 0.4 }));
  deskPhone.position.set(1.2, 1.16, -5); scene.add(deskPhone);
  const papers = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.35), mat(0xf2f2f2, { roughness: 0.9 }));
  papers.position.set(0.3, 1.12, -5); scene.add(papers);
  // Benches along both side walls.
  for (const bx of [-8.2, 8.2]) {
    const bench = roundedBox(0.6, 0.45, 3, 0.05, mat(0x6b4226, { roughness: 0.7 }));
    bench.position.set(bx, 0.45, 0); bench.castShadow = true; scene.add(bench);
  }
  // A barred cell in the north-east corner: a frame, vertical steel
  // bars, a bench inside, a small barred window.
  const cellFrame = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 0.1), mat(0x3a3a3a, { metalness: 0.6, roughness: 0.4 }));
  cellFrame.position.set(6.5, 1.3, -5.9); scene.add(cellFrame);
  for (let i = 0; i < 7; i++) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 8), new THREE.MeshStandardMaterial({ color: 0x8a8a86, metalness: 0.8, roughness: 0.3 }));
    bar.position.set(5.1 + i * 0.45, 1.3, -5.7); scene.add(bar);
  }
  const cellBench = roundedBox(2.6, 0.4, 0.6, 0.05, mat(0x5a5a58, { roughness: 0.9 }));
  cellBench.position.set(6.5, 0.4, -6.4); scene.add(cellBench);
  const cellSign = textSprite('HOLDING CELL', '#2a2118', '#ffd166', 'Cell 1');
  cellSign.scale.set(2.4, 0.6, 1); cellSign.position.set(6.5, 2.9, -6.6); scene.add(cellSign);
  // Flags on poles in the north-west corner: the US flag and the NYPD flag.
  for (const [fx, mkFlag] of [[-8, makeUSFlag], [-6.6, makeNYPDFlag]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.6, 8), new THREE.MeshStandardMaterial({ color: 0x8a8a86, metalness: 0.7, roughness: 0.4 }));
    pole.position.set(fx, 1.3, -6.2); scene.add(pole);
    const flag = mkFlag(); flag.position.set(fx, 2.2, -6.2); scene.add(flag);
  }
  // Bulletin board with wanted posters on the west wall.
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 2.4), mat(0x8a6a3a, { roughness: 0.9 }));
  board.position.set(-8.85, 1.7, -2); scene.add(board);
  for (let i = 0; i < 3; i++) {
    const poster = makeWantedPoster();
    poster.position.set(-8.78, 1.7, -2.8 + i * 0.8); poster.rotation.y = Math.PI / 2; scene.add(poster);
  }
  // Coffee machine and water cooler on a side table.
  const sideTable = roundedBox(1.2, 0.8, 0.6, 0.05, mat(0x5a5a58, { roughness: 0.8 }));
  sideTable.position.set(-8.2, 0.4, 4.5); scene.add(sideTable);
  const coffee = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.35), mat(0x1a1a1a, { roughness: 0.4 }));
  coffee.position.set(-8.2, 1.05, 4.3); scene.add(coffee);
  const cooler = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.1, 12), mat(0x2e6fb0, { roughness: 0.5 }));
  cooler.position.set(-8.2, 0.55, 5.2); scene.add(cooler);
  const coolerTop = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshStandardMaterial({ color: 0x9fd8ff, roughness: 0.2, transparent: true, opacity: 0.7 }));
  coolerTop.position.set(-8.2, 1.2, 5.2); scene.add(coolerTop);
  // Wall clock on the north wall.
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.3, 24), mat(0xf4f6f8, { roughness: 0.4 }));
  clock.position.set(-3.5, 2.6, -6.85); scene.add(clock);
  const clockHand = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.01), mat(0x1a1a1a, { roughness: 0.5 }));
  clockHand.position.set(-3.5, 2.68, -6.84); clockHand.rotation.z = -0.8; scene.add(clockHand);
  lamp(scene, -4, 3.0, 0, 0xffe0b0, 0.9, 14);
  lamp(scene, 4, 3.0, 0, 0xffe0b0, 0.9, 14);
  const sign = textSprite('POLICE STATION', '#1a2a4a', '#7fb0ff', 'NYPD - Midtown Manhattan');
  sign.scale.set(5, 1.25, 1); sign.position.set(0, 3.0, -6.8); scene.add(sign);
  // Officers on duty: one behind the desk, one by the cells, two
  // walking the lobby floor.
  const deskOfficer = makeOfficer('police', { x: 0, z: -5.9, speed: 0 });
  if (deskOfficer) { deskOfficer.group.position.set(0, 0, -5.9); deskOfficer.group.rotation.y = deskOfficer.rigged ? 0 : Math.PI; scene.add(deskOfficer.group); }
  const cellOfficer = makeOfficer('police', { x: 4.6, z: -5.2, speed: 0 });
  if (cellOfficer) { cellOfficer.group.position.set(4.6, 0, -5.2); cellOfficer.group.rotation.y = cellOfficer.rigged ? -Math.PI / 2 : Math.PI / 2; scene.add(cellOfficer.group); }
  for (let i = 0; i < 2; i++) {
    const w = makeOfficer('police', { bounds: { minX: -8, maxX: 8, minZ: -6, maxZ: 6 }, speed: 0.7 + Math.random() * 0.3 });
    if (w) { scene.add(w.group); roomWalkers.push(w); }
  }
  addExitDoor(scene, { x: 0, z: 6.9, ry: Math.PI, label: 'EXIT - STATION DOOR' });
}
// A Navy barracks hall: rows of bunks, wall lockers, a duty desk, a flag,
// and sailors on duty.
function buildNavyBarracks(scene) {
  const wallMat = mat(0x6a6a5a, { roughness: 0.95 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(20, 0.1, 12), mat(0x4a4a48, { roughness: 0.9 }));
  floor.position.set(0, 0.05, 0); floor.receiveShadow = true; scene.add(floor);
  const mk = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat); m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m; };
  mk(20, 3.4, 0.2, 0, 1.7, -6); mk(20, 3.4, 0.2, 0, 1.7, 6);
  mk(0.2, 3.4, 12, -10, 1.7, 0); mk(0.2, 3.4, 12, 10, 1.7, 0);
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(20, 0.1, 12), mat(0xd8d8d8, { roughness: 0.95 }));
  ceil.position.set(0, 3.45, 0); scene.add(ceil);
  // Rows of bunks along both side walls: frame, mattress, pillow,
  // folded blanket, footlocker.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z = -3 + i * 3;
      const bx = side * 8.6;
      for (const [dx, dz] of [[-0.9, -0.4], [0.9, -0.4], [-0.9, 0.4], [0.9, 0.4]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), new THREE.MeshStandardMaterial({ color: 0x3a3a30, metalness: 0.6, roughness: 0.4 }));
        leg.position.set(bx + dx, 0.25, z + dz); scene.add(leg);
      }
      const mattress = roundedBox(2, 0.25, 0.9, 0.06, mat(0x7a7a6a, { roughness: 0.95 }));
      mattress.position.set(bx, 0.62, z); mattress.castShadow = true; scene.add(mattress);
      const pillow = roundedBox(0.5, 0.15, 0.4, 0.05, mat(0xf2f2f2, { roughness: 0.95 }));
      pillow.position.set(bx - side * 0.6, 0.8, z); scene.add(pillow);
      const blanket = roundedBox(1, 0.12, 0.9, 0.04, mat(0x1a2a4a, { roughness: 0.95 }));
      blanket.position.set(bx + side * 0.4, 0.78, z); scene.add(blanket);
      const footlocker = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.5), mat(0x5a4a2a, { roughness: 0.8 }));
      footlocker.position.set(bx, 0.2, z + side * 0.9); scene.add(footlocker);
    }
  }
  // Wall lockers along the north wall, between the bunk rows.
  for (let i = 0; i < 6; i++) {
    const locker = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2, 0.5), mat(0x5a5a3a, { roughness: 0.8, metalness: 0.2 }));
    locker.position.set(-4.5 + i * 1.8, 1, -5.6); locker.castShadow = true; scene.add(locker);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.8, 0.04), mat(0x6a6a4a, { roughness: 0.8 }));
    door.position.set(-4.5 + i * 1.8, 1, -5.32); scene.add(door);
  }
  // Duty desk with a lamp and papers, near the door.
  const desk = roundedBox(1.6, 0.9, 0.8, 0.05, mat(0x6b4226, { roughness: 0.6 }));
  desk.position.set(3.5, 0.45, 4.5); desk.castShadow = true; scene.add(desk);
  const deskLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.35, 10), new THREE.MeshStandardMaterial({ color: 0x2a5a2a, roughness: 0.5 }));
  deskLamp.position.set(3.1, 1.05, 4.5); scene.add(deskLamp);
  const deskPapers = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.35), mat(0xf2f2f2, { roughness: 0.9 }));
  deskPapers.position.set(3.8, 0.92, 4.5); scene.add(deskPapers);
  // US flag on a pole in the north-west corner, bulletin board on the
  // north wall, ceiling fan in the middle of the hall.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.6, 8), new THREE.MeshStandardMaterial({ color: 0x8a8a86, metalness: 0.7, roughness: 0.4 }));
  pole.position.set(-9, 1.3, -5); scene.add(pole);
  const flag = makeUSFlag(); flag.position.set(-9, 2.2, -5); scene.add(flag);
  const board = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 0.1), mat(0x8a6a3a, { roughness: 0.9 }));
  board.position.set(7, 1.7, -5.85); scene.add(board);
  for (let i = 0; i < 3; i++) {
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.5), mat(0xf2f2f2, { roughness: 0.9 }));
    note.position.set(6.2 + i * 0.8, 1.7, -5.78); scene.add(note);
  }
  addCeilingFan(scene, 0, 0);
  lamp(scene, -5, 3.0, 0, 0xffe0b0, 0.9, 14);
  lamp(scene, 5, 3.0, 0, 0xffe0b0, 0.9, 14);
  const sign = textSprite('NAVY BARRACKS', '#2a2118', '#ffd166', 'US Navy - Brooklyn Navy Yard');
  sign.scale.set(5, 1.25, 1); sign.position.set(0, 3.0, -5.8); scene.add(sign);
  // Sailors on duty: one by the flag, one by the duty desk, two walking
  // the hall floor.
  const flagSailor = makeOfficer('navy', { x: -8.2, z: -4.4, speed: 0 });
  if (flagSailor) { flagSailor.group.position.set(-8.2, 0, -4.4); flagSailor.group.rotation.y = flagSailor.rigged ? Math.PI : 0; scene.add(flagSailor.group); }
  const deskSailor = makeOfficer('navy', { x: 2.6, z: 4.4, speed: 0 });
  if (deskSailor) { deskSailor.group.position.set(2.6, 0, 4.4); deskSailor.group.rotation.y = deskSailor.rigged ? -Math.PI / 2 : Math.PI / 2; scene.add(deskSailor.group); }
  for (let i = 0; i < 2; i++) {
    const w = makeOfficer('navy', { bounds: { minX: -9, maxX: 9, minZ: -5, maxZ: 5 }, speed: 0.7 + Math.random() * 0.3 });
    if (w) { scene.add(w.group); roomWalkers.push(w); }
  }
  addExitDoor(scene, { x: 0, z: 5.9, ry: Math.PI, label: 'EXIT - BARRACKS DOOR' });
}
// ---------- Sensor Vault ----------
// The needle angle for a pressure gauge: 0% points down-left, 50% up,
// 100% down-right, matching the dial ticks.
function vaultNeedleAngle(pct) {
  return (1 - pct / 50) * (3 * Math.PI / 4);
}
// The vault reads the same three water lines as the Act II valve room.
// The valve room saves its latest pressures to localStorage; the vault
// falls back to 60/60/60 (the valve puzzle start) when nothing is saved.
function readVaultPressures() {
  const def = { hospital: 60, residential: 60, industrial: 60 };
  try {
    const raw = localStorage.getItem('lastSignalPressures');
    if (!raw) return def;
    const saved = JSON.parse(raw);
    return {
      hospital: Math.max(0, Math.min(100, saved.hospital !== undefined ? saved.hospital : 60)),
      residential: Math.max(0, Math.min(100, saved.residential !== undefined ? saved.residential : 60)),
      industrial: Math.max(0, Math.min(100, saved.industrial !== undefined ? saved.industrial : 60))
    };
  } catch (e) { return def; }
}
// A pressure gauge dial: cream face, ticks and numbers 0-100 PSI, a red
// zone at 80-100, PSI and the line name at the bottom.
function vaultDialTexture(label) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f0e0'; ctx.beginPath(); ctx.arc(128, 128, 126, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 10;
  // Red zone 80-100 PSI: from -9 deg to +45 deg on the dial face.
  ctx.beginPath(); ctx.arc(128, 128, 112, -9 * Math.PI / 180, 45 * Math.PI / 180); ctx.stroke();
  ctx.fillStyle = '#1a1a1a'; ctx.strokeStyle = '#1a1a1a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let v = 0; v <= 100; v += 5) {
    const a = (-135 + v / 100 * 270) * Math.PI / 180;
    const r1 = 108, r2 = v % 25 === 0 ? 88 : 98;
    ctx.lineWidth = v % 25 === 0 ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(128 + Math.sin(a) * r1, 128 - Math.cos(a) * r1);
    ctx.lineTo(128 + Math.sin(a) * r2, 128 - Math.cos(a) * r2);
    ctx.stroke();
  }
  ctx.font = 'bold 26px Arial';
  for (const v of [0, 25, 50, 75, 100]) {
    const a = (-135 + v / 100 * 270) * Math.PI / 180;
    ctx.fillText(String(v), 128 + Math.sin(a) * 68, 128 - Math.cos(a) * 68);
  }
  ctx.font = 'bold 22px Arial'; ctx.fillText('PSI', 128, 168);
  ctx.font = 'bold 18px Arial'; ctx.fillText(label, 128, 196);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// Redraw one vault readout: the percent text and the status light
// (green at 70 or more, amber below).
function setVaultReading(r, pct) {
  try {
    const ctx = r.ctx;
    ctx.fillStyle = '#0a1a0a'; ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = pct >= 70 ? '#7ac74f' : '#ffb13a';
    ctx.font = 'bold 34px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(r.label + ' ' + Math.round(pct) + '%', 128, 34);
    r.tex.needsUpdate = true;
    r.light.material.color.set(pct >= 70 ? 0x2aff7a : 0xffb13a);
    r.light.material.emissive.set(pct >= 70 ? 0x2aff7a : 0xffb13a);
  } catch (e) { /* ignore */ }
}
// The sensor vault: an underground room under the water treatment plant.
// A stair comes down from a hatch in the ceiling; three sensor panels on
// the north wall read the Hospital, Residential and Industrial lines;
// three big pipes come in through the east wall; sensor lights blink;
// a console shows the pressure graph.
function buildSensorVault(scene) {
  const wallMat = mat(0x3a3a38, { roughness: 0.95 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(12, 0.1, 8), mat(0x2e2e2c, { roughness: 0.9 }));
  floor.position.set(0, 0.05, 0); floor.receiveShadow = true; scene.add(floor);
  const mk = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat); m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m; };
  mk(12, 2.8, 0.2, 0, 1.4, -4); mk(12, 2.8, 0.2, 0, 1.4, 4);
  mk(0.2, 2.8, 8, -6, 1.4, 0); mk(0.2, 2.8, 8, 6, 1.4, 0);
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(12, 0.1, 8), mat(0x2a2a28, { roughness: 0.95 }));
  ceil.position.set(0, 2.85, 0); scene.add(ceil);
  // A floor drain and a puddle near it.
  const drain = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.04, 0.8), mat(0x1a1a1a, { metalness: 0.6, roughness: 0.4 }));
  drain.position.set(-4, 0.12, 2.5); scene.add(drain);
  const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20), new THREE.MeshStandardMaterial({ color: 0x1a2a3a, metalness: 0.8, roughness: 0.1 }));
  puddle.rotation.x = -Math.PI / 2; puddle.position.set(-3, 0.12, 1.6); scene.add(puddle);
  // The stair down from the hatch: six steps rising to a square hatch
  // in the ceiling at the south wall, the hatch door swung open.
  for (let i = 0; i < 6; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.4), mat(0x4a4a48, { roughness: 0.9 }));
    step.position.set(0, 0.18 + i * 0.42, 1.6 + i * 0.38); scene.add(step);
  }
  const hatchFrame = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 1.4), mat(0x6a6a66, { metalness: 0.6, roughness: 0.4 }));
  hatchFrame.position.set(0, 2.82, 3.5); scene.add(hatchFrame);
  const hatchDoor = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 1.2), mat(0x8a6a3a, { roughness: 0.8 }));
  hatchDoor.position.set(0, 3.3, 3.9); hatchDoor.rotation.x = -1.9; scene.add(hatchDoor);
  // Pipes along the ceiling, one per line, with a coloured band each.
  const pipeCols = { hospital: 0x2e6fb0, residential: 0x2e7a4a, industrial: 0xc07a1a };
  const pipeZ = { hospital: -3, residential: -2.5, industrial: -2 };
  for (const k of Object.keys(pipeCols)) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 11, 10), new THREE.MeshStandardMaterial({ color: 0x9aa2a8, metalness: 0.8, roughness: 0.35 }));
    pipe.rotation.z = Math.PI / 2; pipe.position.set(0, 2.6, pipeZ[k]); scene.add(pipe);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.3, 10), mat(pipeCols[k], { roughness: 0.6 }));
    band.rotation.z = Math.PI / 2; band.position.set(-2, 2.6, pipeZ[k]); scene.add(band);
  }
  // Three sensor panels on the north wall, one per line: a panel, a
  // round gauge with a needle, a digital readout, a status light, a
  // label, and a blinking sensor light on top.
  const lines = [
    { key: 'hospital', label: 'HOSPITAL', x: -3.5, color: 0x2e6fb0 },
    { key: 'residential', label: 'RESIDENTIAL', x: 0, color: 0x2e7a4a },
    { key: 'industrial', label: 'INDUSTRIAL', x: 3.5, color: 0xc07a1a }
  ];
  const pr = readVaultPressures();
  for (const line of lines) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.2, 0.15), mat(0x2a2e33, { metalness: 0.5, roughness: 0.5 }));
    panel.position.set(line.x, 1.5, -3.85); panel.castShadow = true; scene.add(panel);
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.32, 28), new THREE.MeshStandardMaterial({ map: vaultDialTexture(line.label), roughness: 0.4 }));
    dial.position.set(line.x, 1.95, -3.76); scene.add(dial);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.025, 8, 28), new THREE.MeshStandardMaterial({ color: 0xc8a24a, metalness: 0.9, roughness: 0.3 }));
    ring.position.set(line.x, 1.95, -3.76); scene.add(ring);
    const pivot = new THREE.Group(); pivot.position.set(line.x, 1.95, -3.74);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, 0.015), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.4 }));
    needle.position.set(0, 0.1, 0); pivot.add(needle);
    pivot.rotation.z = vaultNeedleAngle(pr[line.key]); scene.add(pivot);
    vaultNeedles.push({ key: line.key, pivot, target: vaultNeedleAngle(pr[line.key]) });
    const readCanvas = document.createElement('canvas'); readCanvas.width = 256; readCanvas.height = 64;
    const readTex = new THREE.CanvasTexture(readCanvas); readTex.colorSpace = THREE.SRGBColorSpace;
    const readout = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.24), new THREE.MeshBasicMaterial({ map: readTex }));
    readout.position.set(line.x, 1.35, -3.76); scene.add(readout);
    const lightMat = new THREE.MeshStandardMaterial({ color: 0x2aff7a, emissive: 0x2aff7a, emissiveIntensity: 1.2, roughness: 0.4 });
    const status = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), lightMat);
    status.position.set(line.x + 0.7, 2.4, -3.76); scene.add(status);
    vaultReadouts.push({ key: line.key, label: line.label, canvas: readCanvas, ctx: readCanvas.getContext('2d'), tex: readTex, light: status });
    setVaultReading(vaultReadouts[vaultReadouts.length - 1], pr[line.key]);
    const label = textSprite(line.label, '#2a2118', '#ffd166', 'Water pressure sensor');
    label.scale.set(2.2, 0.55, 1); label.position.set(line.x, 2.85, -3.7); scene.add(label);
    const blinkMat = new THREE.MeshStandardMaterial({ color: 0x2aff7a, emissive: 0x2aff7a, emissiveIntensity: 1.2, roughness: 0.4 });
    const blink = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), blinkMat);
    blink.position.set(line.x - 0.7, 2.4, -3.76); scene.add(blink);
    vaultBlinkers.push(blink);
    hitBox(scene, 2.0, 2.4, 0.6, line.x, 1.5, -3.8, 'vaultPanel');
  }
  // Three big pipes coming in through the east wall, one per line, each
  // with a valve wheel and a label, running down into the floor.
  const eastZ = { hospital: -2, residential: 0, industrial: 2 };
  for (const line of lines) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 2.2, 12), new THREE.MeshStandardMaterial({ color: 0x9aa2a8, metalness: 0.8, roughness: 0.35 }));
    pipe.position.set(5.7, 1.5, eastZ[line.key]); scene.add(pipe);
    const wheel = new THREE.Group(); wheel.position.set(5.55, 1.4, eastZ[line.key]); wheel.rotation.y = Math.PI / 2; scene.add(wheel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 8, 20), new THREE.MeshStandardMaterial({ color: 0xc0392b, metalness: 0.6, roughness: 0.4 }));
    wheel.add(rim);
    for (let s = 0; s < 3; s++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.04), new THREE.MeshStandardMaterial({ color: 0xc0392b, metalness: 0.6, roughness: 0.4 }));
      spoke.rotation.z = s * Math.PI / 3; wheel.add(spoke);
    }
    const plabel = textSprite(line.label, '#2a2118', '#ffd166', 'Sensor line');
    plabel.scale.set(1.8, 0.45, 1); plabel.position.set(5.5, 2.5, eastZ[line.key]); scene.add(plabel);
  }
  // Control console in the south-east corner: a desk with a screen
  // showing the pressure graph, a keyboard, and cables to the panels.
  const consoleBody = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.7), mat(0x2e4a6b, { roughness: 0.5, metalness: 0.3 }));
  consoleBody.position.set(4.5, 0.45, 3.2); consoleBody.castShadow = true; scene.add(consoleBody);
  const graphCanvas = document.createElement('canvas'); graphCanvas.width = 256; graphCanvas.height = 128;
  const gctx = graphCanvas.getContext('2d');
  gctx.fillStyle = '#0a1a0a'; gctx.fillRect(0, 0, 256, 128);
  gctx.strokeStyle = '#2a4a2a'; gctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { gctx.beginPath(); gctx.moveTo(0, i * 32); gctx.lineTo(256, i * 32); gctx.stroke(); }
  const graphCols = { hospital: '#4a9fd8', residential: '#7ac74f', industrial: '#ffb13a' };
  for (const line of lines) {
    const y = 118 - pr[line.key] / 100 * 100;
    gctx.strokeStyle = graphCols[line.key]; gctx.lineWidth = 3;
    gctx.beginPath(); gctx.moveTo(8, y + 6); gctx.lineTo(248, y - 6); gctx.stroke();
  }
  gctx.fillStyle = '#c8d4dc'; gctx.font = 'bold 16px Arial'; gctx.textAlign = 'left';
  gctx.fillText('PRESSURE - HOSPITAL / RESIDENTIAL / INDUSTRIAL', 8, 16);
  const graphTex = new THREE.CanvasTexture(graphCanvas); graphTex.colorSpace = THREE.SRGBColorSpace;
  const graph = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), new THREE.MeshBasicMaterial({ map: graphTex }));
  graph.position.set(4.5, 1.15, 3.2); graph.rotation.x = -0.2; scene.add(graph);
  const keyboard = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.2), mat(0x1a1a1a, { roughness: 0.4 }));
  keyboard.position.set(4.5, 0.92, 3.2); scene.add(keyboard);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 7.5, 6), mat(0x1a1a1a, { roughness: 0.9 }));
  cable.rotation.z = Math.PI / 2; cable.position.set(1, 2.7, -3.7); scene.add(cable);
  lamp(scene, 0, 2.5, 0, 0xffe0b0, 0.9, 12);
  lamp(scene, -4, 2.5, 2, 0xffe0b0, 0.6, 9);
  const sign = textSprite('SENSOR VAULT', '#2a2118', '#ffd166', 'Water pressure sensors - underground');
  sign.scale.set(4.5, 1.1, 1); sign.position.set(0, 2.6, -3.8); scene.add(sign);
  addExitDoor(scene, { x: 3.5, z: 3.9, ry: Math.PI, label: 'EXIT - UP THE STAIRS' });
}
export function enterPlace(kind, onLeave, options) {
  if (homeActive) leavePlace();
  const opts = options || {};
  homePrologue = !!opts.prologue;
  if (homePrologue && kind === 'mansion') { homeCallDone = false; prologueInBed = true; prologueSeated = false; } // a fresh prologue: the player wakes in bed, the phone has not been answered yet
  if (opts.onBoardTrain) prologueOnBoardTrain = opts.onBoardTrain;
  homeKind = kind; homeOnLeave = onLeave || null;
  homeScene = new THREE.Scene();
  homeTargets = [];
  homeDoors = [];
  homeRoomKeys = [];
  homeFans = [];
  tunnelFan = null; tunnelGaugeNeedle = null; tunnelGaugeCanvas = null; tunnelGaugeTex = null;
  tunnelRunning = false; tunnelRunT = 0; tunnelDone = false;
  symposiumAudience = []; symposiumAudienceBuilt = false; podiumDone = false;
  roomWalkers = []; vaultBlinkers = []; vaultNeedles = []; vaultReadouts = []; vaultReadAt = -100;
  callActive = false; phoneDown = false; boothBriefAt = -100;
  currentBedPos = null;
  sleeping = false; sleepT = 0; sleepRestDone = false;
  try { const w = document.getElementById('homeWakeBtn'); if (w) w.style.display = 'none'; } catch (e) { /* ignore */ }
  terminalPedestrians = [];
  const isRoom = kind === 'mansion' || kind === 'safehouse' || kind === 'terminal' || kind === 'hotel' || kind === 'windtunnel' || kind === 'symposium' || kind === 'policestation' || kind === 'navybarracks' || kind === 'sensorvault';
  if (isRoom) {
    homeScene.background = new THREE.Color(0x0a0d10);
    homeScene.fog = new THREE.FogExp2(0x0a0d10, 0.02);
  }
  baseLights(homeScene, !isRoom);
  if (kind === 'mansion') { buildMansion(homeScene); homeBounds = { x: [-6.4, 6.4], z: [-4.4, 4.4] }; homeStart = homePrologue ? { x: -2.9, y: 1.7, z: -1.3, yaw: -1.87 } : { x: 0, y: 1.7, z: 4, yaw: 0 }; }
  else if (kind === 'safehouse') { buildSafehouse(homeScene); homeBounds = { x: [-3.4, 3.4], z: [-2.4, 2.4] }; homeStart = { x: 0, y: 1.7, z: 2, yaw: 0 }; }
  else if (kind === 'hospital') { buildHospital(homeScene); homeBounds = { x: [-16, 16], z: [-14, 18] }; homeStart = { x: 0, y: 1.7, z: 14, yaw: 0 }; }
  else if (kind === 'industry') { buildIndustry(homeScene); homeBounds = { x: [-16, 16], z: [-12, 16] }; homeStart = { x: 0, y: 1.7, z: 12, yaw: 0 }; }
  else if (kind === 'terminal') { buildTerminal(homeScene); homeBounds = { x: [-11, 11], z: [-9.5, 14] }; homeStart = { x: 0, y: 1.7, z: 12, yaw: 0 }; }
  else if (kind === 'hotel') { buildHotel(homeScene); homeBounds = { x: [-4.4, 4.4], z: [-2.9, 2.9] }; homeStart = { x: 0, y: 1.7, z: 2.5, yaw: 0 }; }
  else if (kind === 'airport') { buildAirport(homeScene); homeBounds = { x: [-20, 20], z: [-16, 20] }; homeStart = { x: 0, y: 1.7, z: 14, yaw: 0 }; }
  else if (kind === 'carpark') { buildCarpark(homeScene); homeBounds = { x: [-18, 18], z: [-14, 18] }; homeStart = { x: 0, y: 1.7, z: 14, yaw: 0 }; }
  else if (kind === 'windtunnel') { buildWindtunnel(homeScene); homeBounds = { x: [-8.4, 8.4], z: [-5.4, 5.4] }; homeStart = { x: 0, y: 1.7, z: 4.5, yaw: 0 }; }
  else if (kind === 'symposium') { buildSymposium(homeScene); homeBounds = { x: [-7.4, 7.4], z: [-6.4, 6.4] }; homeStart = { x: 0, y: 1.7, z: 5.5, yaw: 0 }; }
  else if (kind === 'policestation') { buildPoliceStation(homeScene); homeBounds = { x: [-8.4, 8.4], z: [-6.4, 6.4] }; homeStart = { x: 0, y: 1.7, z: 5.5, yaw: 0 }; }
  else if (kind === 'navybarracks') { buildNavyBarracks(homeScene); homeBounds = { x: [-9.4, 9.4], z: [-5.4, 5.4] }; homeStart = { x: 0, y: 1.7, z: 4.5, yaw: 0 }; }
  else if (kind === 'sensorvault') { buildSensorVault(homeScene); homeBounds = { x: [-5.4, 5.4], z: [-3.4, 3.4] }; homeStart = { x: 0, y: 1.7, z: 1.0, yaw: 0 }; }
  else return;
  // Hide any room key the player already owns (a replay), so it cannot
  // be picked up twice.
  syncRoomKeys();
  homeCamera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 300);
  homeCamera.position.set(homeStart.x, homeStart.y, homeStart.z);
  homeYaw = homeStart.yaw; homePitch = 0;
  showHomeBar(kind);
  homeActive = true;
  window.__lsHomeActive = true;
  const welcomes = {
    mansion: homePrologue ? 'You wake up in bed. The phone is ringing - stand up, then sit on the couch and answer it.' : 'The Mansion - home. The couch, the big TV, your bed. Click the bed to sleep.',
    safehouse: 'Safe House Apartment - nobody knows this place. Click the bed or the table to save.',
    hospital: 'City Hospital - the tall white tower. Look around, then head back to the map.',
    industry: 'Industrial Area - the water treatment plant. Look around, then head back to the map.',
    terminal: homePrologue ? 'Grand Central. Walk through the concourse to Platform 4 and board the 4 train.' : 'Train Terminal - Grand Central. The 4 train is on Platform 4. Look around, then head back to the map.',
    hotel: 'Hotel - your suite. Click the bed to sleep.',
    airport: 'Airport - JFK Terminal 4. Look around, then head back to the map.',
    carpark: 'Car Park - rows of parked cars. Look around, then head back to the map.',
    windtunnel: 'Wind Tunnel Lab - the long wooden tunnel. Run it at the control panel by the test section. The phone booth on the wall gives the next mission.',
    symposium: 'Symposium Hall - a full house. Take the NYC podium on the stage.',
    policestation: 'Police Station - NYPD Midtown. The officers are on duty. Look around, then head back to the map.',
    navybarracks: 'Navy Barracks - Brooklyn Navy Yard. The sailors are on duty. Look around, then head back to the map.',
    sensorvault: 'Sensor Vault - underground, under the treatment plant. The pressure sensors read the three water lines. Tap a panel for the readings.'
  };
  showHomeToast(welcomes[kind] || kind);
  if (homeRaf) cancelAnimationFrame(homeRaf);
  homeRaf = requestAnimationFrame(homeAnimate);
  // The loading overlay starts visible on page load, and only the acts
  // hide it (in their start functions). A place (Mansion, Terminal,
  // hotel...) is a full scene too, so hide the overlay once the room is
  // built - otherwise a fresh player on the prologue stares at the opaque
  // "Loading characters..." cover forever, even though the room rendered
  // behind it.
  try { const l = document.getElementById('loading'); if (l) l.classList.add('hidden'); } catch (e) { /* ignore */ }
}
export function leavePlace() {
  if (!homeActive) return;
  stopRinging();
  if (callTimer) { clearTimeout(callTimer); callTimer = null; } // a pending call auto-advance must not fire after the room is gone
  callToken++;
  homeActive = false;
  window.__lsHomeActive = false;
  if (homeRaf) { try { cancelAnimationFrame(homeRaf); } catch (e) { /* ignore */ } homeRaf = 0; }
  try { disposeScene(homeScene); } catch (e) { /* ignore */ }
  homeScene = null; homeCamera = null; homeTargets = [];
  homeDoors = []; homeRoomKeys = []; homeFans = []; currentBedPos = null;
  tunnelFan = null; tunnelGaugeNeedle = null; tunnelGaugeCanvas = null; tunnelGaugeTex = null;
  tunnelRunning = false; tunnelRunT = 0; tunnelDone = false;
  symposiumAudience = []; symposiumAudienceBuilt = false; podiumDone = false;
  roomWalkers = []; vaultBlinkers = []; vaultNeedles = []; vaultReadouts = []; vaultReadAt = -100;
  sleeping = false; sleepT = 0; sleepRestDone = false;
  prologueInBed = false; prologueSeated = false; callActive = false; phoneDown = false; boothBriefAt = -100;
  try { const a = getAvatar(); setAvatarPose('stand'); detachAvatar(); } catch (e) { /* ignore */ }
  try { const w = document.getElementById('homeWakeBtn'); if (w) w.style.display = 'none'; } catch (e) { /* ignore */ }
  phoneGlow = null; terminalPedestrians = [];
  const bar = document.getElementById('homeBar');
  if (bar) bar.classList.add('hidden');
  const cb = homeOnLeave; homeOnLeave = null;
  if (cb) cb();
}
function homeAnimate() {
  if (!homeActive) return;
  homeRaf = requestAnimationFrame(homeAnimate);
  const t = Date.now() / 1000;
  const dt = homeAnimate.lastT === undefined ? 0.016 : Math.min(0.1, t - homeAnimate.lastT);
  homeAnimate.lastT = t;
  // While sleeping, the avatar lies on the bed and the camera watches
  // from the bedside, so the player sees himself sleeping. The rest
  // (save + "You slept") lands after about 4 seconds, and the view
  // stays until the player wakes up. Movement is paused while asleep.
  if (sleeping && currentBedPos && homeCamera) {
    sleepT += dt;
    try {
      const a = getAvatar();
      if (a.parent !== homeScene) { try { homeScene.add(a); } catch (e) { /* ignore */ } }
      a.visible = true;
    } catch (e) { /* ignore */ }
    // Bedside camera: from the foot/side of the bed, close enough to
    // see him clearly, looking at the bed.
    const bx = currentBedPos.x, bz = currentBedPos.z;
    homeCamera.position.set(bx + 2.2, 1.6, bz + 2.6);
    homeCamera.lookAt(bx, 0.7, bz);
    if (!sleepRestDone && sleepT > 4) {
      sleepRestDone = true;
      saveHomeGame(homeKind);
      showHomeToast('You slept. Rested. Game saved. (Wake up when ready)');
    }
    renderer.render(homeScene, homeCamera);
    return;
  }
  // Prologue: lying in bed. The avatar lies on the bed and the camera
  // watches from the bedside, so the player sees himself waking up.
  // Movement is paused; "Stand up" is the way out.
  if (prologueInBed && homeKind === 'mansion' && currentBedPos && homeCamera) {
    try {
      const a = getAvatar();
      if (a.parent !== homeScene) { try { homeScene.add(a); } catch (e) { /* ignore */ } }
      a.visible = true;
      setAvatarPose('lie');
      a.position.set(currentBedPos.x, 0.62, currentBedPos.z - 0.4);
      a.rotation.set(0, 0, 0);
    } catch (e) { /* ignore */ }
    const bx = currentBedPos.x, bz = currentBedPos.z;
    homeCamera.position.set(bx + 2.2, 1.6, bz + 2.6);
    homeCamera.lookAt(bx, 0.7, bz);
    renderer.render(homeScene, homeCamera);
    updatePrologueButtons();
    return;
  }
  // Prologue: sitting on the couch. The avatar sits on the couch and the
  // camera watches from in front, so the phone beside him is in view.
  // Movement is paused; "Stand up" is the way out, the phone is the way in.
  if (prologueSeated && homeKind === 'mansion' && homeCamera) {
    try {
      const a = getAvatar();
      if (a.parent !== homeScene) { try { homeScene.add(a); } catch (e) { /* ignore */ } }
      a.visible = true;
      setAvatarPose('sit');
      a.position.set(COUCH_SIT.x, 0, COUCH_SIT.z);
      a.rotation.set(0, Math.PI, 0);
    } catch (e) { /* ignore */ }
    // The camera sits on the TV side (north) of the couch, looking south
    // at the player and the phone on the cushion. The old spot was south
    // of the couch, behind the backrest, so the back hid the phone and
    // its green button and the player could not see or tap it. From the
    // front the cushion, the phone and the player are all in clear view,
    // and the sight line to the phone passes well over the coffee table.
    homeCamera.position.set(0.0, 1.6, -1.7);
    homeCamera.lookAt(0.1, 0.78, COUCH_SIT.z);
    renderer.render(homeScene, homeCamera);
    updatePrologueButtons();
    return;
  }
  // In third-person the camera was left behind the avatar last frame;
  // put it back on the player before moving, or movement starts from
  // the wrong place.
  beginPlayerFrame(homeCamera, 1.7);
  const sp = 0.07;
  const mv = moveDelta(homeKeys, homeYaw, sp);
  homeCamera.position.x += mv.dx; homeCamera.position.z += mv.dz;
  homeCamera.position.x = Math.max(homeBounds.x[0], Math.min(homeBounds.x[1], homeCamera.position.x));
  homeCamera.position.z = Math.max(homeBounds.z[0], Math.min(homeBounds.z[1], homeCamera.position.z));
  const moving = homeKeys['w'] || homeKeys['a'] || homeKeys['s'] || homeKeys['d'];
  homeCamera.position.y = 1.7 + (moving ? Math.sin(t * 5.2) * 0.03 : Math.sin(t * 0.8) * 0.008);
  homeCamera.rotation.order = 'YXZ';
  homeCamera.rotation.y = homeYaw;
  homeCamera.rotation.x = homePitch;
  homeCamera.rotation.z = 0;
  // The ringing phone glows in pulses while it rings.
  if (ringing && phoneGlow) {
    phoneGlow.material.opacity = 0.5 + Math.sin(t * 6) * 0.35;
    const s = 1.3 + Math.sin(t * 6) * 0.35;
    phoneGlow.scale.set(s, s, 1);
  }
  // The ceiling fans turn slowly.
  for (const f of homeFans) {
    try { f.rotation.y += dt * 1.5; } catch (e) { /* ignore */ }
  }
  // Room keys bob gently, so they catch the eye.
  for (const k of homeRoomKeys) {
    if (k.group && k.group.visible) {
      k.group.position.y = 1.0 + Math.sin(t * 2) * 0.06;
      k.group.rotation.y = Math.sin(t * 1.2) * 0.4;
    }
  }
  // Walk up to a room key to pick it up (a missed click is not a dead end).
  for (const k of homeRoomKeys) {
    if (k.group && k.group.visible && !hasKey(k.keyId)) {
      const dx = homeCamera.position.x - k.x, dz = homeCamera.position.z - k.z;
      if (dx * dx + dz * dz < 1.2 * 1.2) {
        giveKey(k.keyId, k.keyLabel);
        showHomeToast('Picked up the ' + k.keyLabel + '.');
        try { k.group.visible = false; } catch (e) { /* ignore */ }
        try { k.label.visible = false; } catch (e) { /* ignore */ }
      }
    }
  }
  // Walkable exit doors: walking up to a door swings it open. If the
  // door is locked it shows what key it needs (throttled, so the toast
  // does not spam); the key is inside the room, so the player can
  // always go back and get it. If it is unlocked, walking through it
  // leaves the room - in the prologue the Mansion door leads to the
  // Train Terminal instead.
  for (const d of homeDoors) {
    const dx = homeCamera.position.x - d.x, dz = homeCamera.position.z - d.z;
    const near = dx * dx + dz * dz < 1.4 * 1.4;
    if (near && d.keyId && !hasKey(d.keyId)) {
      d.open = Math.max(0, d.open - dt * 2);
      if (t - homeDoorLockedAt > 3) {
        homeDoorLockedAt = t;
        showHomeToast('Locked - needs the ' + d.keyLabel + '. It is in this room.');
      }
    } else if (near) {
      // Swing the panel open as the player reaches it, then leave.
      // In the prologue the phone comes first: the player cannot leave
      // the Mansion before answering Jade's call.
      if (homePrologue && homeKind === 'mansion' && !homeCallDone) {
        if (t - homeDoorLockedAt > 3) {
          homeDoorLockedAt = t;
          showHomeToast('The phone is ringing - answer it first.');
        }
        d.open = Math.max(0, d.open - dt * 2);
      } else {
        d.open = Math.min(1, d.open + dt * 3);
        if (d.open > 0.6) {
          if (homePrologue && homeKind === 'mansion' && homeCallDone) goToTerminal();
          else leavePlace();
          return;
        }
      }
    } else {
      d.open = Math.max(0, d.open - dt * 2);
    }
    try { d.hinge.rotation.y = -d.open * 1.5; } catch (e) { /* ignore */ }
  }
  // Walk to the train: in the Terminal, walking up to the 4 train
  // boards it (the prologue path), instead of only a button. Outside
  // the prologue it just says the train is already ridden.
  if (homeKind === 'terminal' && !sleeping) {
    const dx = homeCamera.position.x - 0, dz = homeCamera.position.z - (-12);
    if (dx * dx + dz * dz < 2.2 * 2.2) {
      if (homePrologue) { boardTrain(); return; }
      else if (t - (homeAnimate.trainToastAt || -10) > 5) {
        homeAnimate.trainToastAt = t;
        showHomeToast('The 4 train - you already rode it. The story is in Act II now.');
      }
    }
  }
  // People cross the terminal concourse, going to work.
  if (homeKind === 'terminal') {
    for (const p of terminalPedestrians) updatePedestrian(p, dt);
  }
  // Wind tunnel: the fan spins up while a test runs, the gauge needle
  // follows, and the test completes after a few seconds.
  if (homeKind === 'windtunnel' && tunnelFan) {
    if (tunnelRunning) {
      tunnelRunT += dt;
      const sp = Math.min(1, tunnelRunT / 2); // spin up over 2 s
      tunnelFan.rotation.x += dt * (2 + sp * 14);
      if (tunnelGaugeNeedle) tunnelGaugeNeedle.rotation.z = -1.1 + sp * 2.0;
      if (tunnelRunT > 2 && tunnelRunT < 2.2) setTunnelGaugeText('MEASURING - 42 m/s');
      if (tunnelRunT >= 3.5) finishTunnelRun();
    } else if (tunnelDone) {
      tunnelFan.rotation.x += dt * 6; // keeps turning slowly after the test
    }
  }
  // Walk up to the control panel to run the tunnel (a missed click is
  // not a dead end).
  if (homeKind === 'windtunnel' && !tunnelDone && !tunnelRunning) {
    const dx = homeCamera.position.x - 2.5, dz = homeCamera.position.z - 0.8;
    if (dx * dx + dz * dz < 1.6 * 1.6) startTunnelRun();
  }
  // Phone booth: walking up to it shows the briefing for the next
  // mission (throttled, so it does not pop up again and again).
  if (homeKind === 'windtunnel') {
    const dx = homeCamera.position.x - (-7.2), dz = homeCamera.position.z - (-5.5);
    if (dx * dx + dz * dz < 1.5 * 1.5 && t - boothBriefAt > 20) {
      boothBriefAt = t;
      showNextMissionBriefing();
    }
  }
  // Prologue: the Sit on the couch button appears when the player is
  // standing near the couch before the call.
  updatePrologueButtons();
  // Symposium: the seated audience sways gently, and walking up to the
  // stage takes the NYC podium (a missed click is not a dead end).
  if (homeKind === 'symposium') {
    for (const p of symposiumAudience) updateSeatedPerson(p, t);
    if (!podiumDone) {
      const dx = homeCamera.position.x - 0, dz = homeCamera.position.z - (-3.2);
      if (dx * dx + dz * dz < 1.5 * 1.5) takePodium();
    }
  }
  // Police station / Navy barracks: officers and sailors walk the room.
  for (const p of roomWalkers) updateOfficer(p, dt);
  // Sensor vault: the sensor lights blink, and the gauge needles follow
  // the live pressures from the valve room (re-read once a second).
  if (homeKind === 'sensorvault') {
    const phase = t * 2;
    for (let i = 0; i < vaultBlinkers.length; i++) {
      const b = vaultBlinkers[i];
      try { b.material.emissiveIntensity = (Math.sin(phase + i * 1.7) > 0) ? 1.6 : 0.15; } catch (e) { /* ignore */ }
    }
    for (const n of vaultNeedles) n.pivot.rotation.z += (n.target - n.pivot.rotation.z) * 0.08;
    if (t - vaultReadAt > 1) {
      vaultReadAt = t;
      const pr = readVaultPressures();
      for (const n of vaultNeedles) n.target = vaultNeedleAngle(pr[n.key]);
      for (const r of vaultReadouts) setVaultReading(r, pr[r.key]);
    }
  }
  // Third-person: show the player avatar and put the camera behind it.
  {
    const mv2 = moveDelta(homeKeys, homeYaw, 1);
    applyPlayerPresence({ scene: homeScene, camera: homeCamera, x: homeCamera.position.x, z: homeCamera.position.z, yaw: homeYaw, pitch: homePitch, moving, moveDx: mv2.dx, moveDz: mv2.dz, dt, t, eyeY: 1.7 });
  }
  renderer.render(homeScene, homeCamera);
}
function homeResetView() {
  if (!homeActive || !homeCamera) return;
  homeCamera.position.set(homeStart.x, homeStart.y, homeStart.z);
  homeYaw = homeStart.yaw; homePitch = 0;
}
const homeRay = new THREE.Raycaster(), homeMouse = new THREE.Vector2();
function homeHandleTap(clientX, clientY) {
  if (!homeActive || !homeCamera) return;
  homeMouse.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  homeRay.setFromCamera(homeMouse, homeCamera);
  const hits = homeRay.intersectObjects(homeTargets.filter(o => o.visible !== false), false);
  if (!hits.length) return;
  // The prologue phone lies on the couch cushion, inside the sofa's big
  // invisible hit box, so a ray toward the phone hits the sofa first.
  // While the call is pending, a phone hit anywhere on the ray wins over
  // the sofa, so a tap on or near the phone answers the call.
  let hit = hits[0];
  if (homePrologue && homeKind === 'mansion' && !homeCallDone) {
    for (const h of hits) {
      const a = h.object.userData.homeAction || h.object.name;
      if (a === 'phone') { hit = h; break; }
    }
  }
  const action = hit.object.userData.homeAction || hit.object.name;
  if (action === 'exitDoor') {
    // Clicking a walkable exit door opens it. A locked door needs its
    // key first; the key is inside the room. In the prologue the phone
    // comes first: the player cannot leave before answering the call.
    const door = hit.object.userData.doorRef;
    if (homePrologue && homeKind === 'mansion' && !homeCallDone) {
      showHomeToast('The phone is ringing - answer it first.');
      return;
    }
    if (door && door.keyId && !hasKey(door.keyId)) {
      showHomeToast('Locked - needs the ' + door.keyLabel + '. It is in this room.');
      return;
    }
    if (homePrologue && homeKind === 'mansion' && homeCallDone) goToTerminal();
    else leavePlace();
    return;
  }
  if (action === 'roomKey') {
    // Clicking a room key picks it up and unlocks its door.
    const keyId = hit.object.userData.keyId;
    const keyLabel = hit.object.userData.keyLabel || 'key';
    if (!keyId) return;
    if (hasKey(keyId)) { showHomeToast('You already have the ' + keyLabel + '.'); return; }
    giveKey(keyId, keyLabel);
    showHomeToast('Picked up the ' + keyLabel + '.');
    for (const k of homeRoomKeys) {
      if (k.keyId === keyId) {
        try { k.group.visible = false; } catch (e) { /* ignore */ }
        try { k.label.visible = false; } catch (e) { /* ignore */ }
      }
    }
    return;
  }
  if (action === 'phone') {
    answerPhone();
  } else if (action === 'phoneBooth') {
    showNextMissionBriefing();
  } else if (action === 'boardTrain') {
    boardTrain();
  } else if (action === 'tunnelPanel') {
    startTunnelRun();
  } else if (action === 'vaultPanel') {
    const pr = readVaultPressures();
    showHomeToast('Sensors live - Hospital ' + Math.round(pr.hospital) + '%, Residential ' + Math.round(pr.residential) + '%, Industrial ' + Math.round(pr.industrial) + '%.');
  } else if (action === 'podium') {
    takePodium();
  } else if (action === 'bed') {
    // In the prologue the player is already in bed; the bed is not a
    // sleep spot then, it is where he wakes up. Stand up instead.
    if (homePrologue && homeKind === 'mansion' && !homeCallDone) { showHomeToast('You are in bed. Stand up - the phone is ringing.'); return; }
    if (homeKind === 'mansion' || homeKind === 'hotel') doSleep();
    else if (homeKind === 'safehouse') doSave();
    else showHomeToast('A bed. Not yours to sleep in here.');
  } else if (action === 'save') doSave();
  else if (action === 'tv') showHomeToast('The TV is on - the news is all about the grid and the water.');
  else if (action === 'sofa' || action === 'sofa2') {
    // In the prologue, clicking the couch near it sits the player down
    // next to the phone. Otherwise it is just a couch.
    if (homePrologue && homeKind === 'mansion' && !homeCallDone && !prologueSeated) sitOnCouch();
    else showHomeToast('Soft. You could nap here - but the city needs you.');
  }
  else if (action === 'info') showHomeToast(homeKind === 'hospital' ? 'City Hospital - the tower from the photo. Emergency is open 24 hours.' : 'Water treatment plant - the industrial line feeds this place.');
}
// Raycast at a pointer position: true when the ray hits the phone.
// Used to tell a press that starts on the phone (tap or swipe to answer)
// from a look-around drag.
function phoneHitAt(clientX, clientY) {
  if (!homeActive || !homeCamera || !homeTargets.length) return false;
  try {
    const r = renderer.domElement.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = -((clientY - r.top) / r.height) * 2 + 1;
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(nx, ny), homeCamera);
    const hits = rc.intersectObjects(homeTargets, false).filter((h) => h.object && h.object.visible !== false);
    // The phone lies inside the sofa's big invisible hit box, so the
    // first hit on the ray is often the sofa. Any phone hit on the ray
    // counts, while the call is pending, so a press starting on the
    // phone is a tap or swipe to answer it, not a look-around drag.
    if (!homePrologue || homeKind !== 'mansion' || homeCallDone) return false;
    return hits.some((h) => h.object.userData.homeAction === 'phone' || h.object.name === 'phone');
  } catch (e) { return false; }
}
// Input: registered once, guarded by homeActive so the acts never fight it.
canvas.addEventListener('pointerdown', (e) => {
  if (!homeActive) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  homeDragging = true; homeDragMoved = 0; homeLx = e.clientX; homeLy = e.clientY;
  // A press that starts on the phone is a tap or a swipe on the phone,
  // to answer it, not a look-around drag.
  phoneDown = phoneHitAt(e.clientX, e.clientY);
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fallback */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (!homeActive || !homeDragging) return;
  const dx = e.clientX - homeLx, dy = e.clientY - homeLy;
  homeDragMoved += Math.abs(dx) + Math.abs(dy);
  // A press that starts on the phone is a swipe on the phone (to answer
  // it), so the camera stays put.
  if (phoneDown) { homeLx = e.clientX; homeLy = e.clientY; return; }
  homeYaw -= dx * 0.0012; homePitch -= dy * 0.0012;
  if (homeYaw > Math.PI) homeYaw -= Math.PI * 2;
  if (homeYaw < -Math.PI) homeYaw += Math.PI * 2;
  homePitch = Math.max(-1.5, Math.min(1.5, homePitch));
  homeLx = e.clientX; homeLy = e.clientY;
});
function homeEndDrag() { homeDragging = false; phoneDown = false; }
canvas.addEventListener('pointerup', (e) => {
  const wasPhoneDown = phoneDown;
  homeEndDrag();
  // Releasing a press that started on the phone answers the call, so a
  // swipe across the phone's green button works as well as a tap.
  if (wasPhoneDown) answerPhone();
});
canvas.addEventListener('pointercancel', homeEndDrag);
addEventListener('pointerup', homeEndDrag);
addEventListener('blur', homeEndDrag);
canvas.addEventListener('click', (e) => {
  if (!homeActive) return;
  if (homeDragMoved > 6) { homeDragMoved = 0; return; }
  homeDragMoved = 0;
  homeHandleTap(e.clientX, e.clientY);
});
addEventListener('keydown', (e) => {
  if (!homeActive) return;
  homeKeys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === 'r') homeResetView();
});
addEventListener('keyup', (e) => {
  if (!homeActive) return;
  homeKeys[e.key.toLowerCase()] = false;
});
addEventListener('resize', () => {
  if (!homeActive || !homeCamera) return;
  homeCamera.aspect = innerWidth / innerHeight; homeCamera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});
