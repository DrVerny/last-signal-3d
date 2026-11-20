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
import { canvas, renderer, disposeScene, showFrameErrorBanner } from './core.js';
import { getBalance, moneyFmt, grantPayout, spendMoney, getEquippedCarDef, getFuel, refillFuel, consumeFuelMiles } from './economy.js';
import { makeCrowd, makePedestrian, updatePedestrian, showBriefing } from './action.js';
import { makeSeatedPerson, updateSeatedPerson, onCrowdReady, pickLook } from './crowd.js';
import { moveDelta, applyPlayerPresence, beginPlayerFrame, setPlayerPos, getPlayerPos, buildCar, buildPlayerCar, hasKey, giveKey, getAvatar, setAvatarPose, detachAvatar, setThirdPerson, resolveMove, addBoxCollider, clearPinchPointers } from './player.js';
import { readingTimeMs, speakLine } from './speak.js';

let homeActive = false, homeRaf = 0, homeScene = null, homeCamera = null;
let homeKind = null, homeOnLeave = null;
let homeYaw = 0, homePitch = 0;
let homeBounds = { x: [-6, 6], z: [-4, 4] };
let homeColliders = []; // wall boxes for the current place, rebuilt by enterPlace
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
// uniform can be re-applied (see updateOfficer). The rigged facing
// differs by model: the Atlas rigs face -z (faceYaw PI), the Casual
// rig faces +z (faceYaw 0), so the front side follows faceYaw - a
// blanket -1 put a Jade-rig officer's cap brim and badge on his back.
const OFFICER_SKINS = [0x2a1a12, 0x6b4a2f, 0xc89b7a, 0xe8b88a];
function dressUniform(p, kind) {
  if (!p || !p.group) return;
  const front = (p.rigged && p.faceYaw) ? -1 : 1;
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
  } else if (kind === 'vendor') {
    // A market vendor: a flat cap and a white apron over his shirt.
    const capMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.9 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.07, 12), capMat);
    cap.position.set(0, 1.69, 0); cap.userData.uniformPart = true; g.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.12), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.5 }));
    brim.position.set(0, 1.66, front * 0.19); brim.userData.uniformPart = true; g.add(brim);
    const apron = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.75, 0.03), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.9 }));
    apron.position.set(0, 1.02, front * 0.17); apron.userData.uniformPart = true; g.add(apron);
  } else if (kind === 'doctor') {
    // A white coat over the shirt, with a red cross on the chest.
    const coat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.9, 0.03), new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.9 }));
    coat.position.set(0, 1.05, front * 0.17); coat.userData.uniformPart = true; g.add(coat);
    const crossMat = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 });
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.17, 0.012), crossMat);
    crossV.position.set(0.12, 1.32, front * 0.19); crossV.userData.uniformPart = true; g.add(crossV);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.012), crossMat);
    crossH.position.set(0.12, 1.32, front * 0.19); crossH.userData.uniformPart = true; g.add(crossH);
  } else if (kind === 'nurse') {
    // A white nurse cap.
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.85 }));
    cap.position.set(0, 1.71, 0); cap.userData.uniformPart = true; g.add(cap);
  } else if (kind === 'engineer' || kind === 'worker') {
    // A hard hat: yellow for the lab engineers, orange for plant crew.
    const hatMat = new THREE.MeshStandardMaterial({ color: kind === 'engineer' ? 0xf2c230 : 0xe8761a, roughness: 0.5 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hatMat);
    dome.position.set(0, 1.66, 0); dome.userData.uniformPart = true; g.add(dome);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 16), hatMat);
    brim.position.set(0, 1.67, 0); brim.userData.uniformPart = true; g.add(brim);
  } else if (kind === 'staff') {
    // A plain navy cap for desk staff, clerks and attendants.
    const capMat = new THREE.MeshStandardMaterial({ color: 0x1a2a4a, roughness: 0.85 });
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.09, 12), capMat);
    crown.position.set(0, 1.7, 0); crown.userData.uniformPart = true; g.add(crown);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, 0.14), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }));
    brim.position.set(0, 1.66, front * 0.17); brim.userData.uniformPart = true; g.add(brim);
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
// Held-key suppression, same rule as act2.js: a key already held when
// the player sits in the terminal-front car (or steps out of it) must
// not act until it is released and pressed again, or holding W
// through the end of the prologue drive steps him out in the same
// frame he sits down and the gold Get out button never reads.
const homeSuppressedKeys = new Set();
function homeSuppressHeldKeys() {
  for (const k in homeKeys) {
    if (homeKeys[k]) { homeSuppressedKeys.add(k); homeKeys[k] = false; }
  }
}

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
// Train Terminal front (prologue arrival): the player parks in front of
// the terminal, gets out, and walks through the revolving glass door.
// The ticket is bought at the service desk inside for 0.1 ZAMA and is
// needed to board in prologue mode; in visit mode no ticket is needed.
let terminalTicket = false;
let terminalSeated = false; // seated in the parked car at the terminal front
let terminalFrontCar = null, terminalFrontDoor = null; // parked car + its door hinge
let terminalDoorSwing = null; // { group, t } while the car door swings open
let terminalGetOutBtnEl = null;
let glassDoor = null; // { panels, open, opening } revolving glass door at the front
let glassDoorToastAt = -100, serviceDeskToastAt = -100;
let marketVendorAt = -100; // throttle for the Market Street vendor greeting
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
  showHomeBar(homeKind); // the "Drive to the Train Terminal" button appears
  showHomeToast('Jade hung up. Drive to the Train Terminal and board the 4 train.');
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
// A stuffed cushion that BULGES like a real one: the front bows out,
// the top domes, the sides puff slightly, and the edges are rounded.
// The old version extruded a rounded rectangle, so the front face and
// the top were flat in the middle and the cushion still read as a flat
// slab at play distance. This one starts from a sphere, maps it onto a
// superellipsoid (exponent 6) so the edges round, then pushes each
// face out by a pillow profile that peaks at the face centre and
// falls to zero at the edges. The construction box is shrunk by the
// bulge amounts first, so the finished cushion is still exactly
// w x h x d and its top stays at +h/2. The r parameter is kept so the
// call sites do not change; the roundness now comes from the
// superellipsoid. Returns a mesh with castShadow on.
function plumpCushion(w, h, d, r, material) {
  const frontBulge = Math.min(0.045, 0.12 * Math.min(w, h));
  const topDome = Math.min(0.03, 0.08 * Math.min(w, d));
  const sideBulge = Math.min(0.015, 0.03 * Math.min(h, d));
  const hx = (w - 2 * sideBulge) / 2;
  const hy = (h - topDome) / 2;
  const hz = (d - frontBulge) / 2;
  const cy = -topDome / 2;
  const cz = -frontBulge / 2;
  const n = 6;
  const geo = new THREE.SphereGeometry(1, 64, 48);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i), ny = pos.getY(i), nz = pos.getZ(i);
    const s = Math.pow(Math.pow(Math.abs(nx), n) + Math.pow(Math.abs(ny), n) + Math.pow(Math.abs(nz), n), 1 / n);
    const u = nx / s, v = ny / s, t = nz / s;
    let x = u * hx;
    let y = v * hy + cy;
    let z = t * hz + cz;
    x += sideBulge * Math.sign(u) * (1 - v * v) * (1 - t * t);
    if (v > 0) y += topDome * v * (1 - u * u) * (1 - t * t);
    if (t > 0) z += frontBulge * t * (1 - u * u) * (1 - v * v);
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
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
// Shrink a sign's font until the text fits its board: the old fixed
// 44px clipped any text wider than the 512px board, so "GRAND CENTRAL -
// ENTRANCE" read as "AND CENTRAL - ENTRAN". Every sign drawn through
// this helper now fits.
function fitSignFont(ctx, text, maxWidth, startPx, weight) {
  let px = startPx;
  ctx.font = weight + px + 'px Arial';
  while (px > 12 && ctx.measureText(text).width > maxWidth) {
    px -= 2;
    ctx.font = weight + px + 'px Arial';
  }
  return px;
}
function textSprite(text, bg, fg, sub) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = fg; ctx.textAlign = 'center';
  fitSignFont(ctx, text, 512 - 24, 44, 'bold ');
  ctx.fillText(text, 256, sub ? 58 : 74);
  if (sub) { fitSignFont(ctx, sub, 512 - 24, 28, ''); ctx.fillText(sub, 256, 102); }
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
    // Keep the lie rotation: setAvatarPose('lie') turns the group
    // -90 deg on X so the head points north. Resetting the rotation
    // to (0,0,0) here would stand the avatar upright ON the bed.
    a.rotation.set(-Math.PI / 2, 0, 0);
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
    + '<button id="homeTerminalBtn" type="button">Drive to the Train Terminal</button>'
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
// The prologue: after the call, the player drives to the Train Terminal.
function goToTerminal() {
  startPrologueDrive();
}
// Board the 4 train: in the prologue this starts Act I. From the map
// (Act II) the train is already ridden, so it just says so.
function boardTrain() {
  if (homePrologue && prologueOnBoardTrain) {
    // The ticket comes first: in the prologue he must buy it at the
    // service desk near the entrance (0.1 ZAMA) before boarding.
    if (!terminalTicket) {
      showHomeToast('You need a ticket first - buy one at the service desk near the entrance (0.1 ZAMA).');
      return;
    }
    const cb = prologueOnBoardTrain;
    prologueOnBoardTrain = null;
    homePrologue = false;
    leavePlace();
    cb();
  } else {
    showHomeToast('The 4 train - you already rode it. The story is in Act II now.');
  }
}
// ---------- Prologue drive: Mansion to the Train Terminal ----------
// After Jade's call the player drives his own car to Grand Central
// (30 miles) instead of appearing there. A straight night road with
// buildings and street lights on both sides, the player's car with the
// driver seated inside, a chase camera by default (C switches to
// in-car), W or D gas, S brake, Escape or Skip arrives at once. The
// drive uses the same speed and timing as the act2 travel drive: the
// car creeps at 3 m/s on its own, gas takes it to 12 m/s, and the
// 85-mile leg is 60 seconds, so 30 miles is about 21 seconds.
const PL_DRIVE_MILES = 30;
const PL_DRIVE_ROAD_LEN = 330;
const PL_DRIVE_MAX_SPEED = 12, PL_DRIVE_CREEP_SPEED = 3;
let plDriveActive = false, plDriveT = 0, plDriveDur = 21, plDriveSpeed = 0, plDriveView = 'chase';
let plDriveCar = null;
let plDriveKeys = {};
let plDrivePedalGas = false, plDrivePedalBrake = false;
let plDriveControlsEl = null, plDriveBannerEl = null;
let plDriveKeyHandler = null, plDriveKeyUpHandler = null;
let plDriveLastMilesShown = -1;
// A building face with lit windows, drawn on canvas so it needs no
// texture file. Made fresh for each drive and disposed with the scene.
function plDriveFacadeTexture(base, litRatio) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, 128, 256);
  for (let r = 0; r < 12; r++) for (let col = 0; col < 6; col++) {
    ctx.fillStyle = Math.random() < litRatio ? '#ffd166' : '#20242c';
    ctx.fillRect(8 + col * 20, 10 + r * 20, 12, 14);
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// A cobra-head street lamp: pole, arm over the road, glowing head and
// a pool of light on the road. Built facing local +z (arm toward +z);
// rotate the group so the arm reaches over the road.
function plDriveLamp() {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, metalness: 0.5 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.2, 8), poleMat);
  pole.position.y = 2.6; g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.8), poleMat);
  arm.position.set(0, 5.1, 0.9); g.add(arm);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.9), new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.5, metalness: 0.6 }));
  head.position.set(0, 5.05, 1.8); g.add(head);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.7), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
  glow.position.set(0, 4.98, 1.8); g.add(glow);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.2, 16), new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.12 }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.03, 1.8); g.add(pool);
  return g;
}
// The drive road: a straight night road from the Mansion to Grand
// Central, 330 m long. Dark sky, asphalt with a dashed centre line,
// sidewalks, buildings with lit windows on both sides, street lamps
// and a few parked cars, so the drive reads as a real city street at
// night. The car starts at z = 4 and drives toward -z.
function buildPrologueDriveScene() {
  homeScene = new THREE.Scene();
  homeScene.background = new THREE.Color(0x141c2e);
  homeScene.fog = new THREE.FogExp2(0x141c2e, 0.004);
  baseLights(homeScene, false);
  // Ground under everything, so gaps between buildings are not void.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 420), new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, 0, 15 - PL_DRIVE_ROAD_LEN / 2); homeScene.add(ground);
  // The road: dark asphalt, 9 m wide, with a dashed yellow centre line
  // and white edge lines.
  const road = new THREE.Mesh(new THREE.PlaneGeometry(9, PL_DRIVE_ROAD_LEN), new THREE.MeshStandardMaterial({ color: 0x232326, roughness: 0.95 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0.02, 15 - PL_DRIVE_ROAD_LEN / 2); homeScene.add(road);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xf2c200 });
  for (let z = 10; z >= 15 - PL_DRIVE_ROAD_LEN; z -= 8) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 3), dashMat);
    dash.position.set(0, 0.04, z); homeScene.add(dash);
  }
  for (const sx of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.15, PL_DRIVE_ROAD_LEN), new THREE.MeshBasicMaterial({ color: 0xd8d8d8 }));
    edge.rotation.x = -Math.PI / 2; edge.position.set(sx * 4.2, 0.04, 15 - PL_DRIVE_ROAD_LEN / 2); homeScene.add(edge);
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(3.5, PL_DRIVE_ROAD_LEN), new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.95 }));
    walk.rotation.x = -Math.PI / 2; walk.position.set(sx * 6.25, 0.03, 15 - PL_DRIVE_ROAD_LEN / 2); homeScene.add(walk);
  }
  // Buildings with lit windows on both sides, varied heights and
  // widths, set back behind the sidewalk, so the street reads as a
  // real city, not one box.
  const facades = [
    plDriveFacadeTexture('#7a4a3a', 0.45),
    plDriveFacadeTexture('#3a4a5a', 0.5),
    plDriveFacadeTexture('#5a5a55', 0.4),
    plDriveFacadeTexture('#2e3a4a', 0.55)
  ];
  for (let z = 8; z >= 15 - PL_DRIVE_ROAD_LEN; z -= 18) {
    for (const sx of [-1, 1]) {
      const w = 8 + Math.random() * 3, d = 8 + Math.random() * 4, h = 12 + Math.random() * 33;
      const tex = facades[Math.floor(Math.random() * facades.length)];
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
      b.position.set(sx * (13 + Math.random() * 3), h / 2, z - Math.random() * 6);
      homeScene.add(b);
    }
  }
  // Street lamps along the road, alternating sides, arms over the road.
  for (let z = 0; z >= 15 - PL_DRIVE_ROAD_LEN; z -= 30) {
    const side = (Math.round(z / 30) % 2 === 0) ? 1 : -1;
    const lamp = plDriveLamp();
    lamp.position.set(side * 5.2, 0, z);
    lamp.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    homeScene.add(lamp);
  }
  // Parked cars along the right curb, clear of the driving lane.
  const parkCols = [0x8a2a2a, 0x2e4a6a, 0x5a5a5a, 0x6a5a2a];
  for (let i = 0; i < 4; i++) {
    const pc = buildCar(parkCols[i % parkCols.length], { type: 'sedan' });
    pc.rotation.y = Math.PI;
    pc.position.set(5.6, 0, -40 - i * 55);
    homeScene.add(pc);
  }
  // The player's own car, with the driver seated inside. The car faces
  // -z (the driving direction), so it is rotated PI from the builder's
  // +z front.
  try {
    plDriveCar = buildPlayerCar();
    plDriveCar.rotation.y = Math.PI;
    plDriveCar.position.set(0, 0, 4);
    homeScene.add(plDriveCar);
    const driver = getAvatar();
    try { if (driver.parent) driver.parent.remove(driver); } catch (e) { /* ignore */ }
    setAvatarPose('sit');
    driver.visible = true;
    // Driver's seat, left side, sitting in the cabin. He is scaled to
    // 0.62, not 0.72: at 0.72 his head sat at about 1.28 m, right at the
    // cabin roof, so from the chase camera he read as sitting ON TOP of
    // the car. At 0.62 his head is at about 1.10 m, the same height as
    // the in-car camera (headPos), well under the roof, so he reads as
    // sitting INSIDE the cabin, seen through the glass. His feet stay
    // at y 0.02 on the car floor, so nothing clips below the car.
    driver.position.set(-0.38, 0.02, 0.35);
    driver.rotation.set(0, 0, 0);
    driver.scale.set(0.62, 0.62, 0.62);
    plDriveCar.add(driver);
  } catch (e) { plDriveCar = null; }
  homeCamera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 500);
  homeCamera.position.set(0, 1.7, 4);
}
// On-screen drive controls: GAS and BRAKE pedals (hold), a View button
// and a Skip button, in the same spots as the act2 travel drive.
function showPlDriveControls() {
  if (!plDriveControlsEl) {
    plDriveControlsEl = document.createElement('div');
    plDriveControlsEl.id = 'plDriveControls';
    plDriveControlsEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:55;';
    plDriveControlsEl.innerHTML =
      '<button id="plDriveGasBtn" type="button" style="position:absolute;right:18px;bottom:170px;width:96px;height:96px;border-radius:50%;background:#2e7a4a;color:#fff;font-size:15px;font-weight:bold;border:3px solid #4a9a6a;pointer-events:auto;touch-action:none;">GAS</button>'
      + '<button id="plDriveBrakeBtn" type="button" style="position:absolute;right:132px;bottom:180px;width:80px;height:80px;border-radius:50%;background:#8a2a2a;color:#fff;font-size:14px;font-weight:bold;border:3px solid #b04a4a;pointer-events:auto;touch-action:none;">BRAKE</button>'
      + '<button id="plDriveViewBtn" type="button" style="position:absolute;right:18px;top:120px;padding:10px 14px;font-size:14px;font-weight:bold;background:#22303a;color:#e8eef2;border:1px solid #3a4a58;border-radius:8px;pointer-events:auto;">View: 3rd person (C)</button>'
      + '<button id="plDriveSkipBtn" type="button" style="position:absolute;right:18px;top:64px;padding:10px 14px;font-size:14px;background:#22303a;color:#e8eef2;border:1px solid #3a4a58;border-radius:8px;pointer-events:auto;">Skip drive</button>';
    document.body.appendChild(plDriveControlsEl);
    const hold = (el, on, off) => {
      el.addEventListener('pointerdown', (ev) => { ev.preventDefault(); on(); });
      el.addEventListener('pointerup', () => off());
      el.addEventListener('pointerleave', () => off());
      el.addEventListener('pointercancel', () => off());
    };
    hold(document.getElementById('plDriveGasBtn'), () => { plDrivePedalGas = true; }, () => { plDrivePedalGas = false; });
    hold(document.getElementById('plDriveBrakeBtn'), () => { plDrivePedalBrake = true; }, () => { plDrivePedalBrake = false; });
    document.getElementById('plDriveViewBtn').onclick = () => togglePlDriveView();
    document.getElementById('plDriveSkipBtn').onclick = () => { if (plDriveActive) endPrologueDrive(); };
  }
  plDriveControlsEl.style.display = 'block';
  const vb = document.getElementById('plDriveViewBtn');
  if (vb) vb.textContent = 'View: 3rd person (C)';
}
function hidePlDriveControls() {
  if (plDriveControlsEl) plDriveControlsEl.style.display = 'none';
  plDrivePedalGas = false; plDrivePedalBrake = false;
}
// The miles banner at the top of the screen: the car, the destination
// and the miles left, updated only when the number changes.
function showPlDriveBanner(text) {
  if (!plDriveBannerEl) {
    plDriveBannerEl = document.createElement('div');
    plDriveBannerEl.id = 'plDriveBanner';
    plDriveBannerEl.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:55;max-width:92vw;background:rgba(8,12,18,0.85);border:1px solid #ffd166;border-radius:10px;color:#f2e9d8;font-size:15px;font-weight:bold;padding:10px 16px;text-align:center;pointer-events:none;';
    document.body.appendChild(plDriveBannerEl);
  }
  plDriveBannerEl.textContent = text;
  plDriveBannerEl.style.display = 'block';
}
function hidePlDriveBanner() { if (plDriveBannerEl) plDriveBannerEl.style.display = 'none'; }
function updatePlDriveBanner() {
  const left = Math.max(0, Math.round(PL_DRIVE_MILES * (1 - plDriveT / plDriveDur)));
  if (left === plDriveLastMilesShown) return;
  plDriveLastMilesShown = left;
  const carName = (plDriveCar && plDriveCar.userData && plDriveCar.userData.carName) || 'City Sedan';
  showPlDriveBanner('Driving your ' + carName + ' to Train Terminal - ' + left + ' miles to go. Hold W or D to drive, S to brake, C to switch view, Esc or Skip to arrive.');
}
// Switch the driving camera between the chase view (third-person, see
// yourself driving) and the in-car view (from the driver's seat).
function togglePlDriveView() {
  plDriveView = plDriveView === 'chase' ? 'incar' : 'chase';
  const b = document.getElementById('plDriveViewBtn');
  if (b) b.textContent = plDriveView === 'chase' ? 'View: 3rd person (C)' : 'View: In-car (C)';
}
// Start the drive to the Terminal: leave the Mansion, build the road
// scene, and drive the player's own car to Grand Central. The home
// animate loop keeps running and drives the car from its drive branch.
function startPrologueDrive() {
  if (plDriveActive) return;
  leavePlace();
  buildPrologueDriveScene();
  homeKind = 'drive';
  homeActive = true;
  window.__lsHomeActive = true;
  plDriveActive = true;
  plDriveT = 0;
  plDriveDur = Math.min(60, Math.max(12, Math.round(PL_DRIVE_MILES / 85 * 60)));
  plDriveLastMilesShown = -1;
  plDriveSpeed = PL_DRIVE_CREEP_SPEED; plDriveView = 'chase';
  plDriveKeys = {};
  plDrivePedalGas = false; plDrivePedalBrake = false;
  // Drive keys are caught in the capture phase and stopped, so a C
  // press switches the drive view without also flipping the room
  // camera to first-person, and Escape arrives without reaching the
  // acts. W or D is gas, S is brake.
  plDriveKeyHandler = (e) => {
    if (!plDriveActive) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'escape') { e.stopPropagation(); e.preventDefault(); endPrologueDrive(); return; }
    if (k === 'c' && !e.repeat) { e.stopPropagation(); e.preventDefault(); togglePlDriveView(); return; }
    if (k === 'w' || k === 'a' || k === 's' || k === 'd') { e.stopPropagation(); plDriveKeys[k] = true; }
  };
  plDriveKeyUpHandler = (e) => {
    const k = (e.key || '').toLowerCase();
    if (k === 'w' || k === 'a' || k === 's' || k === 'd') { e.stopPropagation(); plDriveKeys[k] = false; }
  };
  addEventListener('keydown', plDriveKeyHandler, true);
  addEventListener('keyup', plDriveKeyUpHandler, true);
  updatePlDriveBanner();
  showPlDriveControls();
  if (homeRaf) cancelAnimationFrame(homeRaf);
  homeRaf = requestAnimationFrame(homeAnimate);
  try { const l = document.getElementById('loading'); if (l) l.classList.add('hidden'); } catch (e) { /* ignore */ }
}
// Arrive at the Terminal (drive finished or skipped): stop the drive,
// take the driver out of the car, and open the Terminal exactly as
// goToTerminal used to, so the boarding and the Act I start work
// exactly as before. enterPlace disposes the drive scene through
// leavePlace, so no car mesh is left behind.
function endPrologueDrive() {
  if (!plDriveActive) return;
  plDriveActive = false;
  if (plDriveKeyHandler) { try { removeEventListener('keydown', plDriveKeyHandler, true); } catch (e) { /* ignore */ } plDriveKeyHandler = null; }
  if (plDriveKeyUpHandler) { try { removeEventListener('keyup', plDriveKeyUpHandler, true); } catch (e) { /* ignore */ } plDriveKeyUpHandler = null; }
  hidePlDriveControls();
  hidePlDriveBanner();
  plDriveView = 'chase'; plDriveSpeed = 0;
  // The driver gets out of the car: back on his feet, at full size,
  // detached from the car so the Terminal can place him at the player
  // position.
  try {
    const driver = getAvatar();
    if (plDriveCar && driver && driver.parent === plDriveCar) {
      try { plDriveCar.remove(driver); } catch (e) { /* ignore */ }
    }
    setAvatarPose('stand');
    driver.scale.set(1, 1, 1);
    driver.rotation.set(0, 0, 0);
    driver.visible = false;
    detachAvatar();
  } catch (e) { /* ignore */ }
  plDriveCar = null;
  // Fuel: the prologue drive is 30 miles in his own car, so it burns
  // 6% of a tank. An empty tank never blocks it - the car still drives.
  consumeFuelMiles(PL_DRIVE_MILES);
  // The drive ends in the parking lot in front of the terminal, not
  // straight inside it: the player starts seated in his parked car,
  // gets out, and walks through the glass doors.
  enterPlace('terminalFront', () => {}, { prologue: true, onBoardTrain: prologueOnBoardTrain });
}
// One drive frame: speed from the pedals, the car rolls down the road,
// the camera follows it, and the miles count down. Arrives when the
// drive time runs out.
function updatePrologueDrive(dt, t) {
  if (!plDriveActive) return;
  plDriveT += dt;
  const gas = plDriveKeys['w'] || plDriveKeys['d'] || plDrivePedalGas;
  const brake = plDriveKeys['s'] || plDrivePedalBrake;
  if (gas) plDriveSpeed = Math.min(PL_DRIVE_MAX_SPEED, plDriveSpeed + 6 * dt);
  else if (brake) plDriveSpeed = Math.max(0, plDriveSpeed - 10 * dt);
  else if (plDriveSpeed > PL_DRIVE_CREEP_SPEED) plDriveSpeed = Math.max(PL_DRIVE_CREEP_SPEED, plDriveSpeed - 4 * dt);
  else if (plDriveSpeed < PL_DRIVE_CREEP_SPEED) plDriveSpeed = Math.min(PL_DRIVE_CREEP_SPEED, plDriveSpeed + 4 * dt);
  if (plDriveCar) {
    plDriveCar.position.z = Math.max(15 - PL_DRIVE_ROAD_LEN + 10, plDriveCar.position.z - plDriveSpeed * dt);
    if (plDriveView === 'incar' && plDriveCar.userData.headPos) {
      // In-car view: from the driver's seat, over the steering wheel,
      // looking down the road through the windscreen.
      const head = plDriveCar.localToWorld(plDriveCar.userData.headPos.clone());
      homeCamera.position.set(head.x, head.y + Math.sin(t * 6) * 0.01, head.z);
      homeCamera.lookAt(head.x, 1.0, head.z - 20);
    } else {
      // Chase view: behind and above the car, so the player sees himself
      // driving. The camera sits at the fixed 4 m distance.
      homeCamera.position.set(0, 1.7 + 4 * 0.35 + Math.sin(t * 6) * 0.02, plDriveCar.position.z + 4 + 1.5);
      homeCamera.lookAt(0, 1.0, plDriveCar.position.z - 8);
    }
  } else if (homeCamera) {
    homeCamera.position.z -= plDriveSpeed * dt;
    homeCamera.position.x = 0;
    homeCamera.position.y = 1.7 + Math.sin(t * 6) * 0.02;
    homeCamera.rotation.order = 'YXZ';
    homeCamera.rotation.y = 0; homeCamera.rotation.x = 0; homeCamera.rotation.z = 0;
  }
  updatePlDriveBanner();
  if (plDriveT >= plDriveDur) { endPrologueDrive(); return; }
  renderer.render(homeScene, homeCamera);
}
function showHomeBar(kind) {
  buildHomeBar();
  const titles = {
    mansion: 'THE MANSION - home',
    safehouse: 'SAFE HOUSE APARTMENT',
    hospital: 'CITY HOSPITAL',
    industry: 'INDUSTRIAL AREA - WATER TREATMENT PLANT',
    terminal: 'TRAIN TERMINAL - GRAND CENTRAL',
    terminalFront: 'TRAIN TERMINAL - GRAND CENTRAL',
    hotel: 'HOTEL - YOUR SUITE',
    airport: 'AIRPORT - JFK TERMINAL',
    carpark: 'CAR PARK',
    windtunnel: 'WIND TUNNEL LAB - ENGINEERING LAB',
    symposium: 'SYMPOSIUM HALL - NEW YORK',
    lobby: 'LOBBY',
    fillingstation: 'FILLING STATION'
  };
  const infos = {
    mansion: homePrologue && !homeCallDone ? (prologueInBed ? 'You are in bed. The phone is ringing - stand up.' : prologueSeated ? 'You are on the couch. The phone is beside you - tap its green button.' : 'The phone is ringing. Walk to the couch, sit down and answer it.') : homePrologue ? 'Jade called. Drive to the Train Terminal and board the 4 train.' : 'Drag to look around - WASD to walk - click the bed to sleep.',
    safehouse: 'Drag to look around - WASD to walk - click the bed or table to save.',
    hospital: 'Drag to look around - WASD to walk - look around, then head back.',
    industry: 'Drag to look around - WASD to walk - look around, then head back.',
    terminal: homePrologue ? 'Buy your ticket at the service desk (0.1 ZAMA), then board the 4 train on Platform 4.' : 'Drag to look around - WASD to walk - the 4 train is on the platform. Look around, then head back.',
    terminalFront: homePrologue ? 'You are parked in front of the terminal. Get out of the car and walk to the glass doors.' : 'Drag to look around - WASD to walk - the 4 train is on the platform. Look around, then head back.',
    hotel: 'Drag to look around - WASD to walk - click the bed to sleep.',
    airport: 'Drag to look around - WASD to walk - look around, then head back.',
    carpark: 'Drag to look around - WASD to walk - rows of parked cars. Look around, then head back.',
    windtunnel: 'Drag to look around - WASD to walk - run the wind tunnel at the control panel. The phone booth on the wall gives the next mission.',
    symposium: 'Drag to look around - WASD to walk - take the NYC podium on the stage.',
    lobby: 'Drag to look around - WASD to walk - walk back out through the EXIT door.',
    fillingstation: 'Drag to look around - WASD to walk - tap Fill tank to fill up for 0.5 ZAMA.'
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
// opts: { x, z, ry, keyId, keyLabel, action, label, lobbyFor }.
//   keyId/keyLabel: when set, the door is locked until the player has
//     that key (the key is a pickup inside the room, see addRoomKey).
//   action: 'leave' (default, leaves the place), 'terminal' (the
//     prologue path: go to the Train Terminal), or 'lobby' (an entrance
//     door on an exterior building: walk through it to enter the small
//     interior lobby for that building, see goToLobby).
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
  // Raised panels on both faces, so the door reads as a panelled door
  // and not a flat box. Two panels per face, in a slightly lighter wood.
  const doorPanelMat = mat(0x5a4030, { roughness: 0.55 });
  for (const sz of [1, -1]) {
    for (const py of [1.75, 0.65]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.75, 0.02), doorPanelMat);
      p.position.set(0.58, py, sz * 0.045); hinge.add(p);
    }
  }
  // A proper lever handle in brass, on both faces of the door, at handle
  // height, so the door clearly has a handle from either side. Round
  // backplate, horizontal lever bar, and a keyhole below it.
  const handleMat = new THREE.MeshStandardMaterial({ color: 0xd8b13a, metalness: 0.9, roughness: 0.25 });
  for (const sz of [1, -1]) {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 16), handleMat);
    plate.rotation.x = Math.PI / 2;
    plate.position.set(1.05, 1.05, sz * 0.05); hinge.add(plate);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.035), handleMat);
    lever.position.set(0.97, 1.05, sz * 0.08); hinge.add(lever);
    const keyhole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 12), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.7, roughness: 0.4 }));
    keyhole.rotation.x = Math.PI / 2;
    keyhole.position.set(1.05, 0.88, sz * 0.05); hinge.add(keyhole);
  }
  // A gold glow strip above the door, so it is easy to spot across the room.
  const glow = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.06), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
  glow.position.set(0, 2.62, 0.05); g.add(glow);
  const sign = textSprite(o.label || 'EXIT', '#2a2118', '#ffd166', o.keyId ? 'Locked - needs the ' + (o.keyLabel || 'key') : (o.action === 'lobby' ? 'Walk through to enter' : 'Walk through to leave'));
  sign.scale.set(2.2, 0.55, 1); sign.position.set(0, 3.0, 0.05); g.add(sign);
  scene.add(g);
  const door = { x: o.x || 0, z: o.z || 0, ry, keyId: o.keyId || null, keyLabel: o.keyLabel || null, action: o.action || 'leave', lobbyFor: o.lobbyFor || null, panel, hinge, glow, group: g, open: 0 };
  homeDoors.push(door);
  // The panel is clickable, so a click on the door opens it too.
  panel.userData.doorRef = door;
  homeTargets.push(panel);
  // A generous invisible hit box around the whole door assembly, so
  // a click anywhere on the door (frame, sign, glow strip) opens it
  // instead of missing the 1.16 m panel from across the grounds:
  // the hospital ENTER door took clicks from 4-8 m on the live check
  // and never entered, while walking through worked. The box sits
  // in the door group, so it follows the door's facing; room keys
  // are never behind a door, so it cannot steal a key click.
  const doorHit = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.7, 0.8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  doorHit.position.set(0, 1.35, 0);
  doorHit.name = 'exitDoor'; doorHit.userData.homeAction = 'exitDoor'; doorHit.userData.doorRef = door;
  g.add(doorHit);
  homeTargets.push(doorHit);
  return door;
}
// Enter a building lobby from its entrance door: the lobby is a small
// interior scene (see buildLobby) behind the door of an exterior
// building that has no interior of its own (hospital, industry,
// airport, car park office, market corner shop, filling station
// kiosk). The grounds' leave callback must not run here - the lobby
// returns to the grounds, not to the map - so it is held and handed to
// the lobby as its way back: leaving the lobby re-enters the grounds,
// and leaving the grounds runs the original callback.
function goToLobby(backKind, door) {
  const ol = homeOnLeave;
  homeOnLeave = null;
  // Coming back out of the lobby, he steps out of the door he went
  // in: the grounds re-entry spawns beside that door, facing it, so
  // he walks back to his parked car from the building instead of
  // restarting at the place's generic start. The spawn sits 2.2 m
  // out from the door along the line he approached on (outside the
  // 1.8 m walk-up radius, so the door does not instantly pull him
  // back in), which works for every door facing.
  let spawn = null;
  try {
    if (door) {
      const pp = getPlayerPos() || { x: homeCamera.position.x, z: homeCamera.position.z };
      let dx = pp.x - door.x, dz = pp.z - door.z;
      const l = Math.hypot(dx, dz);
      if (l > 0.3) { dx /= l; dz /= l; spawn = { x: door.x + dx * 2.2, z: door.z + dz * 2.2, yaw: Math.atan2(dx, dz) }; }
    }
  } catch (e) { /* fall back to the generic spawn */ }
  try { enterPlace('lobby', () => { try { enterPlace(backKind, ol, spawn ? { spawn } : undefined); } catch (e) { /* ignore */ } }, { lobbyFor: backKind }); } catch (e) { /* ignore */ }
}
// The Fill tank button, shown only at the Filling Station: a flat
// 0.5 ZAMA for a full tank, whatever the current level. If the tank is
// already full it says so and charges nothing. The button is hidden
// again when the player leaves the place.
let fillBtnEl = null;
function showFillButton() {
  if (!fillBtnEl) {
    fillBtnEl = document.createElement('div');
    fillBtnEl.id = 'fillTankBtn';
    fillBtnEl.innerHTML = '<button type="button" id="fillTankBtnInner" style="padding:14px 26px;font-size:17px;font-weight:bold;background:#ffd166;color:#111;border:none;border-radius:10px;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,0.5);">Fill tank - 0.5 ZAMA</button>';
    fillBtnEl.style.cssText = 'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:56;text-align:center;pointer-events:auto;';
    document.body.appendChild(fillBtnEl);
    document.getElementById('fillTankBtnInner').onclick = () => { fillTankHere(); };
  }
  const b = document.getElementById('fillTankBtnInner');
  if (b) b.textContent = getFuel() >= 100 ? 'Tank full' : 'Fill tank - 0.5 ZAMA';
  fillBtnEl.style.display = 'block';
}
function hideFillButton() { if (fillBtnEl) fillBtnEl.style.display = 'none'; }
function fillTankHere() {
  const r = refillFuel();
  if (r === 'full') { showHomeToast('Tank is already full - nothing to pay.'); }
  else if (r === 'broke') { showHomeToast('Not enough ZAMA - a full tank costs 0.5 ZAMA, you have ' + moneyFmt(getBalance()) + '. Finish a mission to earn more.'); }
  else { showHomeToast('Tank filled - 0.5 ZAMA. Full tank, 100%.'); showFillButton(); }
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
    // Seat cushion: a real stuffed cushion, its front bows out and
    // its top domes, so it reads as plump at play distance. The top
    // stays at 0.77, so the sit spot and the phone do not move.
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
  // A real entrance door on the wing, with a canopy over it: frame,
  // panel, brass handles, glow and an ENTER sign. Walking through it
  // enters the hospital lobby; the wing wall is split at the doorway
  // (see registerHomeColliders), so the door is the way through.
  addExitDoor(scene, { x: 2, z: 0.55, ry: 0, action: 'lobby', label: 'ENTER' });
  hbox(scene, 3.4, 0.15, 1.2, 0xd8d8d8, 2, 3.4, 0.9, null, { roughness: 0.5 });
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
  // Real entrance doors: one on the treatment hall, one on the office
  // block. Both lead to the plant office lobby; both walls are split
  // at their doorways (see registerHomeColliders).
  addExitDoor(scene, { x: -2, z: -3.45, ry: 0, action: 'lobby', label: 'ENTER' });
  addExitDoor(scene, { x: 10, z: -4.95, ry: 0, action: 'lobby', label: 'OFFICE' });
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
  // Two plant workers on the yard, in hard hats, clear of both doors.
  addStaff(scene, { x: -5, z: -1, heading: 0, label: 'Worker', uniform: 'worker', shirt: 0x4a6a8a, pants: 0x3a3a3a, line: 'Mind the pipes - the plant runs all night.' });
  addStaff(scene, { x: 2, z: -1, heading: 0, label: 'Worker', uniform: 'worker', shirt: 0x4a6a8a, pants: 0x3a3a3a, line: 'Treatment plant. The city drinks what we clean.' });
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
// ---------- Market Street ----------
// A lively dusk street from the reference image: a cobbled street lined
// with varied shop facades, market stalls with striped awnings, a vendor
// and shoppers. The composition follows the photo; the look is realistic
// (real window frames, doors, cornices, columns), not boxy or flat.
// A canvas facade texture per style, following the whiteFacadeMat pattern.
function marketFacadeTexture(style) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  if (style === 'brick') {
    ctx.fillStyle = '#8a4a38'; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(60,30,20,0.55)'; ctx.lineWidth = 2;
    for (let y = 0; y <= 256; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); }
    for (let r = 0; r < 16; r++) { const off = (r % 2) * 16; for (let x = off; x <= 256; x += 32) { ctx.beginPath(); ctx.moveTo(x, r * 16); ctx.lineTo(x, r * 16 + 16); ctx.stroke(); } }
    for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) {
      const wx = 28 + col * 76, wy = 24 + r * 76;
      ctx.fillStyle = '#f2f2f2'; ctx.fillRect(wx - 4, wy - 4, 44, 56);
      ctx.fillStyle = '#2a3a4a'; ctx.fillRect(wx, wy, 36, 48);
      ctx.fillStyle = '#ffd166'; ctx.fillRect(wx, wy, 36, 6);
    }
  } else if (style === 'plaster') {
    ctx.fillStyle = '#d8b078'; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#c8a068'; ctx.fillRect(0, 0, 256, 12);
    for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) {
      const wx = 28 + col * 76, wy = 24 + r * 76;
      ctx.fillStyle = '#2e6a2e'; ctx.fillRect(wx - 16, wy, 12, 48); ctx.fillRect(wx + 40, wy, 12, 48);
      ctx.fillStyle = '#f2f2f2'; ctx.fillRect(wx - 4, wy - 4, 44, 56);
      ctx.fillStyle = '#2a3a4a'; ctx.fillRect(wx, wy, 36, 48);
      ctx.fillStyle = '#6b4226'; ctx.fillRect(wx - 6, wy + 52, 48, 8);
      ctx.fillStyle = '#c0392b'; ctx.fillRect(wx + 2, wy + 46, 8, 8); ctx.fillRect(wx + 26, wy + 46, 8, 8);
      ctx.fillStyle = '#3a7a3a'; ctx.fillRect(wx + 12, wy + 44, 10, 8);
    }
  } else { // pale stone with arched windows and column strips at the edges
    ctx.fillStyle = '#ddd5c2'; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#e8e2d4'; ctx.fillRect(0, 0, 18, 256); ctx.fillRect(238, 0, 18, 256);
    ctx.strokeStyle = '#c8bfa8'; ctx.lineWidth = 2;
    for (let y = 0; y <= 256; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); }
    for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) {
      const wx = 36 + col * 76, wy = 30 + r * 76;
      ctx.fillStyle = '#f4f6f8';
      ctx.beginPath(); ctx.moveTo(wx - 4, wy + 48); ctx.lineTo(wx - 4, wy + 10); ctx.arc(wx + 16, wy + 10, 20, Math.PI, 0, true); ctx.lineTo(wx + 36, wy + 48); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2a3a4a';
      ctx.beginPath(); ctx.moveTo(wx, wy + 48); ctx.lineTo(wx, wy + 12); ctx.arc(wx + 16, wy + 12, 16, Math.PI, 0, true); ctx.lineTo(wx + 32, wy + 48); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#f4f6f8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(wx + 16, wy - 4); ctx.lineTo(wx + 16, wy + 48); ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// Cobblestones: small grey stones in varied shades on a dark grout, so
// the street reads as cobbles, not a flat slab.
function cobbleTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3a3a38'; ctx.fillRect(0, 0, 256, 256);
  const shades = ['#6a6a66', '#7a7a74', '#5a5a56', '#8a8a84', '#63635f'];
  for (let r = 0; r < 8; r++) {
    const off = (r % 2) * 16;
    for (let col = -1; col < 8; col++) {
      ctx.fillStyle = shades[(r * 3 + col + 8) % shades.length];
      ctx.fillRect(col * 32 + off + 2, r * 32 + 2, 28, 28);
    }
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
// Red-and-white stripes for the stall awnings.
function stripeTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 === 0 ? '#c0392b' : '#f2f2f2'; ctx.fillRect(i * 16, 0, 16, 64); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
// A yellow disc with a dark Z, the Zama signboard from the reference.
function marketZSignTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = '#ffd166';
  ctx.beginPath(); ctx.arc(64, 64, 58, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 72px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Z', 64, 68);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// One shop facade: w along the street (z), d deep (x), h tall, front
// facing the street (face +1: front is the +x side, -1: the -x side).
// The front face carries the canvas facade; the other faces are plain.
function marketFacade(scene, cx, cz, w, h, d, face, style, noDoor) {
  const front = new THREE.MeshStandardMaterial({ map: marketFacadeTexture(style), roughness: 0.9, metalness: 0.02 });
  const baseCol = style === 'brick' ? 0x8a4a38 : style === 'plaster' ? 0xd8b078 : 0xddd5c2;
  const side = mat(baseCol, { roughness: 0.9 });
  const roof = mat(0x3a3f44, { roughness: 0.9 });
  const mats = face > 0 ? [front, side, roof, roof, side, side] : [side, front, roof, roof, side, side];
  const b = new THREE.Mesh(new THREE.BoxGeometry(d, h, w), mats);
  b.position.set(cx, h / 2, cz); b.castShadow = true; b.receiveShadow = true; scene.add(b);
  // Cornice along the top of the front face, and a real door with a handle.
  // noDoor skips the decorative slab: that shop gets a real walk-through
  // door instead (see buildMarketStreet).
  const fx = cx + face * (d / 2 + 0.12);
  hbox(scene, 0.3, 0.18, w + 0.2, 0xe8e2d4, fx, h - 0.09, cz, null, { roughness: 0.8 });
  if (!noDoor) {
    const doorCol = style === 'brick' ? 0x2a3a4a : 0x4a3220;
    hbox(scene, 0.12, 2.2, 1.1, doorCol, fx, 1.1, cz, null, { roughness: 0.6 });
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd8b13a, metalness: 0.9, roughness: 0.25 }));
    handle.position.set(fx + face * 0.1, 1.05, cz + 0.35); scene.add(handle);
  }
  if (style === 'stone') {
    for (const dz of [-1.2, 1.2]) hcyl(scene, 0.16, 0.2, 3, 0xe8e2d4, fx + face * 0.25, 1.5, cz + dz, null, { roughness: 0.8 });
  }
  if (style === 'plaster') {
    for (const dz of [-2.6, 2.6]) {
      hbox(scene, 0.08, 1.2, 0.5, 0x2e6a2e, fx + face * 0.05, 5.2, cz + dz, null, { roughness: 0.9 });
      hbox(scene, 0.14, 0.12, 0.7, 0x6b4226, fx + face * 0.08, 4.5, cz + dz, null, { roughness: 0.9 });
    }
  }
  return b;
}
// One market stall: a wooden counter with fruit and vegetables on top,
// crates beside it, four posts holding a sloped red-and-white striped
// awning, and a Z signboard on the front facing the street.
// face -1: the stall faces west (toward the street from the east side);
// face +1: it faces east.
function buildMarketStall(scene, x, z, face) {
  hbox(scene, 0.9, 1.0, 3.0, 0x6b4226, x, 0.5, z, null, { roughness: 0.85 });
  hbox(scene, 1.1, 0.08, 3.2, 0x8a6a42, x, 1.04, z, null, { roughness: 0.8 });
  for (const [px, pz] of [[-0.4, -1.4], [0.4, -1.4], [-0.4, 1.4], [0.4, 1.4]]) {
    hcyl(scene, 0.05, 0.05, 1.3, 0x4a3220, x + px, 1.7, z + pz, null, { roughness: 0.9 });
  }
  const stripeMat = new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.85 });
  const awn = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 3.4), stripeMat);
  awn.position.set(x, 2.4, z); awn.rotation.z = -face * 0.22; awn.castShadow = true; scene.add(awn);
  // Goods on the counter: fruit and vegetables in coloured rows.
  const goods = [0xc0392b, 0xe67e22, 0xf2d13a, 0x3a7a3a, 0x8a2a5a, 0xd8d8d8];
  for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) {
    const g = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), mat(goods[(r * 6 + i) % goods.length], { roughness: 0.7 }));
    g.position.set(x - 0.22 + r * 0.44, 1.17, z - 1.25 + i * 0.5); g.castShadow = true; scene.add(g);
  }
  // Crates of goods beside the stall.
  hbox(scene, 0.6, 0.5, 0.6, 0x8a6a3a, x + face * 0.1, 0.25, z + 2.0, null, { roughness: 0.95 });
  hbox(scene, 0.6, 0.5, 0.6, 0x8a6a3a, x + face * 0.1, 0.75, z + 2.0, null, { roughness: 0.95 });
  // Z signboard on the front of the counter, facing the street.
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ map: marketZSignTexture(), transparent: true, roughness: 0.8 }));
  sign.position.set(x + face * 0.48, 0.55, z); sign.rotation.y = face * Math.PI / 2; scene.add(sign);
}
function buildMarketStreet(scene) {
  // Dusk, like the reference image: a purple-orange evening sky over a
  // cobbled street lined with shops and stalls.
  scene.background = new THREE.Color(0x2a2038);
  scene.fog = new THREE.Fog(0x2a2038, 30, 120);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat(0x3a3d40, { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  // Cobblestone street down the middle, sidewalks on both sides.
  const cob = cobbleTexture(); cob.repeat.set(3, 7);
  const street = new THREE.Mesh(new THREE.PlaneGeometry(12, 29), new THREE.MeshStandardMaterial({ map: cob, roughness: 1 }));
  street.rotation.x = -Math.PI / 2; street.position.set(0, 0.02, 1.5); street.receiveShadow = true; scene.add(street);
  for (const s of [-1, 1]) {
    const walk = new THREE.Mesh(new THREE.BoxGeometry(3, 0.08, 29), mat(0x8a8a86, { roughness: 1 }));
    walk.position.set(s * 7.5, 0.04, 1.5); walk.receiveShadow = true; scene.add(walk);
  }
  // Buildings on both sides, varied facades and heights, fronts facing
  // the street. Left (west): pale stone, red brick, painted plaster.
  marketFacade(scene, -10.5, -8, 8, 11, 5, 1, 'stone');
  marketFacade(scene, -10.5, 0.5, 7, 8, 5, 1, 'brick');
  marketFacade(scene, -10.5, 9, 8, 9.5, 5, 1, 'plaster');
  // Right (east): brick and plaster, with a gap between them for the stalls.
  marketFacade(scene, 10.5, -7, 8, 9, 5, -1, 'brick');
  // The plaster shop on the east side is enterable: its decorative slab
  // is skipped and a real door stands in its place, into the shop lobby.
  // Its wall is split at the doorway (see registerHomeColliders).
  marketFacade(scene, 10.5, 9.5, 7, 7.5, 5, -1, 'plaster', true);
  addExitDoor(scene, { x: 7.95, z: 9.5, ry: -Math.PI / 2, action: 'lobby', label: 'SHOP' });
  // Stalls: one on each side, red-and-white striped awnings, goods on
  // the counters, Z signboards on the fronts.
  buildMarketStall(scene, 7.2, 1.5, -1);
  buildMarketStall(scene, -7.2, 0.5, 1);
  // A big Z board over the right stall, on a post, so the market reads as Zama's.
  hcyl(scene, 0.06, 0.06, 2.6, 0x4a3220, 7.6, 1.3, 1.5, null, { roughness: 0.9 });
  const bigZ = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshStandardMaterial({ map: marketZSignTexture(), transparent: true, roughness: 0.8 }));
  bigZ.position.set(7.6, 3.4, 1.5); bigZ.rotation.y = -Math.PI / 2; scene.add(bigZ);
  const sign = textSprite('MARKET STREET', '#2a2118', '#ffd166', 'Stalls and shops - Midtown');
  sign.scale.set(7, 1.75, 1); sign.position.set(0, 8.5, -12.5); scene.add(sign);
  // Cobra-head lamps along both sidewalks: a pole, an arm toward the
  // street, a lamp head, and a warm point light.
  for (const [lx, lz] of [[-5.8, -8], [5.8, -4], [-5.8, 4], [5.8, 8]]) {
    hcyl(scene, 0.08, 0.08, 4.5, 0x6a747a, lx, 2.25, lz, null, { metalness: 0.8, roughness: 0.4 });
    const armDir = lx < 0 ? 1 : -1;
    hbox(scene, 0.9, 0.08, 0.08, 0x6a747a, lx + armDir * 0.45, 4.45, lz, null, { metalness: 0.8, roughness: 0.4 });
    hbox(scene, 0.5, 0.12, 0.25, 0x2a2e33, lx + armDir * 0.85, 4.4, lz, null, { metalness: 0.6, roughness: 0.4 });
    lamp(scene, lx + armDir * 0.85, 4.3, lz, 0xffe9a8, 0.8, 12);
  }
  // Parked cars on the street and trees at the ends of the street.
  homeCar(scene, 0xc0392b, -4.6, -10, 0.1);
  homeCar(scene, 0x2e6fb0, 4.6, 10, -0.1);
  addTree(scene, -11, 14.5); addTree(scene, 11, -12.5);
  // The vendor, behind the right stall counter, facing the street.
  // He is a rigged person when the crowd models are loaded (makePedestrian
  // falls back to a hidden primitive and upgrades it, like everyone else),
  // with a flat cap and an apron, and he stands still (speed 0, heading
  // west, so updatePedestrian keeps him facing the street).
  const vendor = makePedestrian({ x: 8.2, z: 1.5, speed: 0, heading: -Math.PI / 2, coatColor: 0x3a5a3a, legColor: 0x2a2a2a, skinColor: 0x8a5a3a });
  if (vendor) {
    vendor.group.position.set(8.2, 0, 1.5);
    scene.add(vendor.group);
    dressUniform(vendor, 'vendor');
    roomWalkers.push(vendor);
  }
  const tag = textSprite('Vendor', '#2a2118', '#ffd166', '');
  tag.scale.set(1.8, 0.45, 1); tag.position.set(8.2, 2.15, 1.5); scene.add(tag);
  hitBox(scene, 1.4, 2.0, 1.4, 8.2, 1.0, 1.5, 'marketVendor');
  // Shoppers walking the street.
  const crowd = makeCrowd({ count: 5, bounds: { minX: -3.5, maxX: 3.5, minZ: -12, maxZ: 15 } });
  for (const p of crowd) { scene.add(p.group); roomWalkers.push(p); }
}
// The vendor greets the player: spoken in his voice, and shown as a toast
// too, so the line lands even when speech is muted or unavailable.
function greetMarketVendor() {
  const now = Date.now() / 1000;
  if (now - marketVendorAt < 6) return;
  marketVendorAt = now;
  const line = 'Fresh fruit, friend. Everything on this street is real New York.';
  try { speakLine('vendor', line); } catch (e) { /* speech is best effort */ }
  showHomeToast('Vendor: ' + line);
}
// ---------- Professional people in every building ----------
// Every enterable place has its own staff, standing at their post in
// role dress with a floating role tag, like the Market Street vendor.
// Clicking one speaks a fitting line (throttled, like the vendor).
// Staff stand still (speed 0, Idle clip) and are added to roomWalkers
// so the animate loop keeps them animated and re-dresses them when
// the crowd upgrade swaps in a rigged body. phase is pinned to 0 so
// the walk bob cannot float a standing person off the floor.
// o: { x, z, heading, label, line, voice, shirt, pants, uniform, action }
let staffAt = -100; // throttle for staff greetings
function addStaff(scene, o) {
  const look = pickLook();
  if (o.shirt !== undefined) look.shirt = o.shirt;
  if (o.pants !== undefined) look.pants = o.pants;
  const p = makePedestrian({ x: o.x, z: o.z, speed: 0, heading: o.heading || 0, idle: true, look, coatColor: o.shirt, legColor: o.pants, skinColor: look.skin });
  if (!p) return null;
  p.group.position.set(o.x, 0, o.z);
  p.phase = 0;
  scene.add(p.group);
  if (o.uniform) dressUniform(p, o.uniform);
  roomWalkers.push(p);
  const tag = textSprite(o.label, '#2a2118', '#ffd166', '');
  tag.scale.set(1.8, 0.45, 1); tag.position.set(o.x, 2.15, o.z); scene.add(tag);
  const hb = hitBox(scene, 1.4, 2.0, 1.4, o.x, 1.0, o.z, o.action || 'staff');
  hb.userData.staffRole = o.label;
  hb.userData.staffLine = o.line || 'Can I help you?';
  hb.userData.staffVoice = o.voice || 'staff';
  return p;
}
function greetStaff(role, line, voice) {
  const now = Date.now() / 1000;
  if (now - staffAt < 4) return;
  staffAt = now;
  try { speakLine(voice || 'staff', line); } catch (e) { /* speech is best effort */ }
  showHomeToast(role + ': ' + line);
}
// Hospital treatment, priced by the user at exactly 10 ZAMA. The game
// has no health or energy stat to restore, so treatment is the paid
// interaction and the doctor's line only. No wallet needed: in-game
// services (fuel, tickets, treatment) stay wallet-free.
const TREATMENT_PRICE = 10;
let treatmentAt = -100;
function offerTreatment() {
  const now = Date.now() / 1000;
  if (now - treatmentAt < 6) return;
  treatmentAt = now;
  if (getBalance() < TREATMENT_PRICE) {
    const line = 'Treatment is 10 ZAMA. Come back when you have it - we will be here.';
    try { speakLine('doctor', line); } catch (e) { /* speech is best effort */ }
    showHomeToast('Doctor: ' + line);
    return;
  }
  spendMoney(TREATMENT_PRICE);
  const line = 'There - patched up. Rest, fluids, and no heroics for a day.';
  try { speakLine('doctor', line); } catch (e) { /* speech is best effort */ }
  showHomeToast('Doctor: ' + line + ' Treatment - 10 ZAMA. Balance: ' + moneyFmt(getBalance()) + '.');
}
// ---------- Train Terminal front (prologue arrival) ----------
// After the prologue drive the player parks in the lot in front of
// Grand Central, gets out of his car, and walks through the revolving
// glass doors at the front. The lot, the facade and the glass door live
// in their own place ('terminalFront'); walking through the open glass
// door enters the terminal interior ('terminal') as before.
function buildTerminalFront(scene) {
  // Night, like the prologue drive that ends here.
  scene.background = new THREE.Color(0x141c2e);
  scene.fog = new THREE.Fog(0x141c2e, 30, 120);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat(0x3a3d40, { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  // The terminal building: a long white modern block with lit windows
  // and a glass front, its name over the entrance.
  const termMat = whiteFacadeMat(12, 4, 0.25);
  const term = new THREE.Mesh(new THREE.BoxGeometry(26, 12, 4), termMat);
  term.position.set(0, 6, -12); term.castShadow = true; term.receiveShadow = true; scene.add(term);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(22, 5), mat(0x1a3a5a, { roughness: 0.1, metalness: 0.5 }));
  glass.position.set(0, 3, -9.95); scene.add(glass);
  const sign = textSprite('GRAND CENTRAL', '#2a2118', '#ffd166', 'Train Terminal');
  sign.scale.set(8, 2, 1); sign.position.set(0, 13.5, -9.8); scene.add(sign);
  // Sidewalk in front of the building.
  const walk = new THREE.Mesh(new THREE.BoxGeometry(28, 0.08, 4), mat(0x8a8a86, { roughness: 1 }));
  walk.position.set(0, 0.04, -7); walk.receiveShadow = true; scene.add(walk);
  // The parking lot: a paved two-bay pad with white bay lines, a curb
  // along the back, and a P sign at the head of the player's bay.
  const pad = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.06, 5.7), mat(0x2e3235, { roughness: 0.95 }));
  pad.position.set(0, 0.03, 3); pad.receiveShadow = true; scene.add(pad);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
  for (const lx of [-2.8, 0, 2.8]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 5.7), lineMat);
    line.position.set(lx, 0.07, 3); scene.add(line);
  }
  const curb = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.16, 0.3), mat(0x8a8a86, { roughness: 0.95 }));
  curb.position.set(0, 0.08, 0.3); curb.castShadow = true; scene.add(curb);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 8), mat(0x6a747a, { metalness: 0.7, roughness: 0.4 }));
  post.position.set(-1.4, 1.1, 0.45); post.castShadow = true; scene.add(post);
  const psign = textSprite('P', '#1a4a8a', '#ffffff', 'PARKING');
  psign.scale.set(1.2, 0.6, 1); psign.position.set(-1.4, 2.45, 0.45); scene.add(psign);
  // The player's car, parked in the west bay, facing the building.
  const car = buildPlayerCar();
  car.rotation.y = Math.PI;
  car.position.set(-1.4, 0, 3);
  scene.add(car);
  terminalFrontCar = car;
  // Lamps and trees beside the lot, and a couple of parked cars across
  // the street, so the front reads as a city place.
  hcyl(scene, 0.08, 0.08, 4.5, 0x6a747a, -6, 2.25, -4, null, { metalness: 0.8, roughness: 0.4 });
  lamp(scene, -6, 4.5, -4, 0xffe9a8, 0.8, 12);
  hcyl(scene, 0.08, 0.08, 4.5, 0x6a747a, 6, 2.25, 8, null, { metalness: 0.8, roughness: 0.4 });
  lamp(scene, 6, 4.5, 8, 0xffe9a8, 0.8, 12);
  addTree(scene, -10, -4); addTree(scene, 10, -4);
  homeCar(scene, 0xc0392b, 8, 8, 0.2);
  homeCar(scene, 0x2e6fb0, 12, 6, -0.1);
  // The revolving glass door at the front.
  buildTerminalGlassDoor(scene);
}
// The revolving glass door at the front of the terminal: a frame, a
// centre post, and four glass panels in a cross around the post.
// Touching it (or walking up to it) rotates the panels open; walking
// through the doorway enters the terminal interior.
function buildTerminalGlassDoor(scene) {
  const dz = -9.8; // just in front of the facade face at z -10
  for (const px of [-1.6, 1.6]) {
    hbox(scene, 0.18, 2.6, 0.18, 0x2a3a4a, px, 1.3, dz, null, { metalness: 0.6, roughness: 0.3 });
  }
  hbox(scene, 3.4, 0.18, 0.18, 0x2a3a4a, 0, 2.65, dz, null, { metalness: 0.6, roughness: 0.3 });
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.08, 24), mat(0x6a747a, { metalness: 0.7, roughness: 0.4 }));
  ring.position.set(0, 0.04, dz); ring.receiveShadow = true; scene.add(ring);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.5, 12), mat(0x2a3a4a, { metalness: 0.7, roughness: 0.3 }));
  post.position.set(0, 1.25, dz); post.castShadow = true; scene.add(post);
  const panels = new THREE.Group();
  panels.position.set(0, 0, dz);
  scene.add(panels);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
  const railMat = mat(0x2a3a4a, { metalness: 0.7, roughness: 0.3 });
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = i * Math.PI / 2;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.3, 1.35), glassMat);
    panel.position.set(0, 1.25, 0.75); panel.castShadow = true;
    panel.name = 'terminalGlassDoor'; panel.userData.homeAction = 'terminalGlassDoor'; homeTargets.push(panel);
    arm.add(panel);
    for (const ry of [0.12, 2.38]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.35), railMat);
      rail.position.set(0, ry, 0.75); arm.add(rail);
    }
    // Vertical edge rail on the outer edge of the panel: at the old
    // opacity the four panels read as two faint panes in a V, because
    // the edge-on panels vanished. A hard metal edge on every panel
    // makes all four read as distinct panels, open or shut.
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.3, 0.06), railMat);
    edge.position.set(0, 1.25, 1.42); arm.add(edge);
    // Inner vertical rail at the post end and a mid horizontal rail, so
    // every panel has a complete frame and reads as a distinct pane from
    // any angle, even edge-on or overlapped by the panel in front of it.
    const inner = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.3, 0.06), railMat);
    inner.position.set(0, 1.25, 0.08); arm.add(inner);
    const mid = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.35), railMat);
    mid.position.set(0, 1.25, 0.75); arm.add(mid);
    panels.add(arm);
  }
  // A generous hit box over the whole door, so a tap anywhere on it
  // opens it instead of missing.
  const hit = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.7, 1.2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.position.set(0, 1.35, dz); hit.name = 'terminalGlassDoor'; hit.userData.homeAction = 'terminalGlassDoor'; homeTargets.push(hit); scene.add(hit);
  // The entrance label over the glass door: forward of the door so it
  // reads whole from the car at the lot. At 5.5 m wide its right end
  // slid off the frame from the seated car camera ("GRAND CENTRAL -
  // ENT."), so it is a touch narrower and lower now, which keeps both
  // ends in frame from the lot and from the street on foot.
  const label = textSprite('GRAND CENTRAL - ENTRANCE', '#2a2118', '#f2e9d8', 'Push the glass doors');
  label.scale.set(4.4, 1.1, 1); label.position.set(0, 2.85, dz + 0.9); scene.add(label);
  glassDoor = { panels, open: 0, opening: false, z: dz };
}
function openTerminalGlassDoor() {
  if (!glassDoor || glassDoor.opening || glassDoor.open >= 1) return;
  glassDoor.opening = true;
  showHomeToast('The glass doors revolve open.');
}
function updateTerminalGlassDoor(dt) {
  if (!glassDoor || !glassDoor.opening) return;
  glassDoor.open = Math.min(1, glassDoor.open + dt / 0.8);
  const e = 1 - (1 - glassDoor.open) * (1 - glassDoor.open);
  // The door revolves open only 30 degrees (PI/6), not 45: at 45 degrees
  // the open door read as two panels in a V from the front, with the
  // other two edge-on and invisible. At 30 degrees the four-panel cross
  // still reads clearly while the door is open.
  glassDoor.panels.rotation.y = (Math.PI / 6) * e;
  if (glassDoor.open >= 1) glassDoor.opening = false;
}
function enterTerminalInterior() {
  if (!homeActive || homeKind !== 'terminalFront') return;
  enterPlace('terminal', () => {}, { prologue: homePrologue, onBoardTrain: prologueOnBoardTrain });
}
// Gold on-screen button for getting out of the parked car at the
// terminal front. Same look as the act's Get out button.
function showTerminalGetOutButton() {
  if (!terminalGetOutBtnEl) {
    terminalGetOutBtnEl = document.createElement('div');
    terminalGetOutBtnEl.id = 'homeGetOutBtn';
    terminalGetOutBtnEl.innerHTML = '<button type="button" id="homeGetOutBtnInner" style="padding:14px 26px;font-size:17px;font-weight:bold;background:#ffd166;color:#111;border:none;border-radius:10px;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,0.5);">Get out of the car</button>';
    terminalGetOutBtnEl.style.cssText = 'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:56;text-align:center;pointer-events:auto;';
    document.body.appendChild(terminalGetOutBtnEl);
    const inner = document.getElementById('homeGetOutBtnInner');
    // Answer both the click and the raw pointerup, like the act2
    // button: a press that drifts before release can lose its click.
    inner.onclick = () => { getOutOfTerminalCar(); };
    inner.addEventListener('pointerup', () => { getOutOfTerminalCar(); });
  }
  terminalGetOutBtnEl.style.display = 'block';
}
function hideTerminalGetOutButton() { if (terminalGetOutBtnEl) terminalGetOutBtnEl.style.display = 'none'; }
// A real driver's door on the parked car at the terminal front: same
// shape as the act's car door (panel, glass, chrome handle, hinged at
// the front edge on the driver's side), sized from the car's own box.
function buildTerminalCarDoor(car) {
  const savedPos = car.position.clone(), savedRotY = car.rotation.y;
  car.position.set(0, 0, 0); car.rotation.y = 0; car.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(car);
  car.position.copy(savedPos); car.rotation.y = savedRotY; car.updateMatrixWorld(true);
  const seatZ = (car.userData && car.userData.headPos) ? car.userData.headPos.z : 0.35;
  let paint = 0x9aa5ad;
  try { const def = getEquippedCarDef(); if (def && def.color) paint = new THREE.Color(def.color).getHex(); } catch (e) { /* default paint */ }
  const doorX = box.min.x - 0.01;
  const hingeZ = seatZ + 0.55;
  const doorLen = 1.1;
  const doorBottom = 0.32;
  const doorTop = Math.min(1.25, box.max.y - 0.08);
  const doorH = Math.max(0.6, doorTop - doorBottom);
  const doorMidY = (doorTop + doorBottom) / 2;
  const hinge = new THREE.Group();
  hinge.position.set(doorX, 0, hingeZ);
  hinge.name = 'terminalCarDoorHinge';
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.05, doorH, doorLen), new THREE.MeshStandardMaterial({ color: paint, roughness: 0.5, metalness: 0.4 }));
  panel.position.set(0, doorMidY, -doorLen / 2);
  panel.castShadow = true;
  panel.name = 'terminalCarDoor'; panel.userData.homeAction = 'terminalCarDoor'; homeTargets.push(panel);
  hinge.add(panel);
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.02, doorH * 0.32, doorLen * 0.78), new THREE.MeshStandardMaterial({ color: 0x10181f, roughness: 0.15, metalness: 0.7, transparent: true, opacity: 0.55 }));
  win.position.set(-0.03, doorTop - doorH * 0.2, -doorLen / 2);
  hinge.add(win);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.22), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.25, metalness: 0.9 }));
  handle.position.set(-0.045, 1.0, -doorLen + 0.15);
  hinge.add(handle);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.7, doorLen + 0.4), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.position.set(0, 0.95, -doorLen / 2);
  hit.name = 'terminalCarDoor'; hit.userData.homeAction = 'terminalCarDoor'; homeTargets.push(hit);
  hinge.add(hit);
  car.add(hinge);
  return hinge;
}
// Seat the player in the parked car at the terminal front, door closed,
// ready to step out. Called once when the front place opens.
function seatTerminalFront() {
  if (!terminalFrontCar) return;
  terminalFrontDoor = buildTerminalCarDoor(terminalFrontCar);
  const driver = getAvatar();
  try { if (driver.parent) driver.parent.remove(driver); } catch (e) { /* ignore */ }
  setAvatarPose('sit');
  driver.visible = true;
  driver.position.set(-0.38, 0.02, 0.35);
  driver.rotation.set(0, 0, 0);
  driver.scale.set(0.62, 0.62, 0.62);
  terminalFrontCar.add(driver);
  terminalSeated = true;
  // A key held through the prologue drive end must not step him
  // straight back out on its next repeat.
  homeSuppressHeldKeys();
  try { setThirdPerson(true); } catch (e) { /* camera is best effort */ }
  showTerminalGetOutButton();
  showHomeToast('You are parked in front of Grand Central. Click the car door, or Get out, to step outside.');
}
// Open the driver's door and step outside. The door swings open and
// stays open; the player ends up standing beside the car, at full size,
// in third person, facing the terminal building.
function getOutOfTerminalCar() {
  if (!terminalSeated || !terminalFrontCar) return;
  terminalSeated = false;
  hideTerminalGetOutButton();
  // The key that stepped him out must not walk him on from the door:
  // he stands beside the car until he presses a key afresh.
  homeSuppressHeldKeys();
  terminalDoorSwing = { group: terminalFrontDoor, t: 0 };
  try {
    const driver = getAvatar();
    if (driver.parent === terminalFrontCar) { try { terminalFrontCar.remove(driver); } catch (e) { /* ignore */ } }
    setAvatarPose('stand');
    driver.scale.set(1, 1, 1);
    driver.rotation.set(0, 0, 0);
    driver.visible = true;
    detachAvatar();
  } catch (e) { /* ignore */ }
  // On foot beside the driver's door (east side of the car, the door is
  // on the driver's side), facing the terminal building.
  try {
    homeCamera.position.set(0.4, 1.7, 3);
    homeYaw = 0; homePitch = 0;
    setPlayerPos(0.4, 3);
  } catch (e) { /* presence is best effort */ }
  showHomeToast('You are out. Walk to the glass doors at the front of the terminal.');
}
// Chase camera while the player is seated in the parked car: behind and
// to the driver's side, so he sees himself in the car and the door he
// can click.
function updateTerminalSeatView() {
  if (!terminalFrontCar || !homeCamera) return;
  const pos = new THREE.Vector3();
  terminalFrontCar.getWorldPosition(pos);
  const q = new THREE.Quaternion();
  terminalFrontCar.getWorldQuaternion(q);
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const side = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);
  homeCamera.position.set(pos.x - fwd.x * 4.2 + side.x * 2.2, 2.0, pos.z - fwd.z * 4.2 + side.z * 2.2);
  homeCamera.rotation.order = 'YXZ';
  homeCamera.lookAt(pos.x, 1.0, pos.z);
}
function updateTerminalDoorSwing(dt) {
  if (!terminalDoorSwing || !terminalDoorSwing.group) { terminalDoorSwing = null; return; }
  terminalDoorSwing.t = Math.min(1, terminalDoorSwing.t + dt / 0.6);
  const e = 1 - (1 - terminalDoorSwing.t) * (1 - terminalDoorSwing.t);
  try { terminalDoorSwing.group.rotation.y = 1.15 * e; } catch (err) { /* ignore */ }
  if (terminalDoorSwing.t >= 1) terminalDoorSwing = null;
}
// Buy the train ticket at the service desk: 0.1 ZAMA, charged from the
// balance. In visit mode (not the prologue) no ticket is needed.
function buyTrainTicket() {
  if (!homePrologue) { showHomeToast('The desk is staffed, but you already rode the 4 train - no ticket needed.'); return; }
  if (terminalTicket) { showHomeToast('You already have your ticket. Board the 4 train on Platform 4.'); return; }
  if (getBalance() < 0.1) { showHomeToast('The ticket costs 0.1 ZAMA - you need 0.1 ZAMA.'); return; }
  spendMoney(0.1);
  terminalTicket = true;
  showHomeToast('Ticket bought - 0.1 ZAMA. Balance: ' + moneyFmt(getBalance()) + '. Board the 4 train on Platform 4.');
  try { const info = document.getElementById('homeBarInfo'); if (info) info.textContent = 'Ticket bought. Board the 4 train on Platform 4.'; } catch (e) { /* ignore */ }
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
  // Staffed train service desk near the entrance (south-east, by the
  // door the player comes in through). This is where the ticket is
  // bought in the prologue - 0.1 ZAMA - and it is distinct from the
  // ticket machines on the east wall, which stay as they are. The
  // attendant stands behind the counter in a navy uniform and cap.
  hbox(scene, 3.2, 1.1, 0.9, 0x6b4226, 8, 0.55, 10, null, { roughness: 0.7 });
  hbox(scene, 3.4, 0.08, 1.0, 0xd8cfc0, 8, 1.14, 10, null, { roughness: 0.5 });
  // The sign stands at the west end of the desk, at eye level, on a
  // post: the old sign floated high above the desk and the top-left HUD
  // panel covered its left half, so it read "VICE DESK". Shortened to
  // SERVICE DESK so the whole word fits clear of the HUD. It stands at
  // x 5.0, y 2.4, z 10.3 - east enough that its left edge clears the
  // top-left HUD panel (which ends at screen x 332) from the approach,
  // and still well west of the attendant at x 8, whose head
  // (y 1.58-1.74) used to hide the sub-line's "ZAMA" from the approach
  // angle, and above his head and the counter, so no part of it can be
  // covered from any approach. The post is tall enough to reach it.
  const deskSign = textSprite('SERVICE DESK', '#2a2118', '#ffd166', 'Tickets - 0.1 ZAMA');
  deskSign.scale.set(3.0, 0.75, 1); deskSign.position.set(7.0, 2.5, 10.3); scene.add(deskSign);
  hbox(scene, 0.08, 2.3, 0.08, 0x2a3a4a, 7.0, 1.15, 10.3, null, { metalness: 0.6, roughness: 0.4 });
  // The service-desk clerk: a real rigged person in a navy uniform
  // and cap, standing behind the counter (the old blocky figure is
  // gone - no primitive people). Tapping him buys the ticket, exactly
  // like tapping the desk.
  addStaff(scene, { x: 8, z: 9.2, heading: 0, label: 'Service desk clerk', action: 'serviceDesk', uniform: 'staff', shirt: 0x1a3a5a, pants: 0x141c28, line: 'Tickets for the 4 train, 0.1 ZAMA. Platform 4, north end.' });
  hitBox(scene, 3.4, 1.6, 1.2, 8, 0.8, 10, 'serviceDesk');
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
  // Lower and narrower than before (y 4.4, 4.8 m wide): at y 5.2 and
  // 5.5 m wide it clipped at the top-right of the frame from the
  // concourse floor ("GRAND CENTRAL - I...").
  ent.scale.set(4.8, 1.2, 1); ent.position.set(0, 4.4, 14.6); ent.rotation.y = Math.PI; scene.add(ent);
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
  // The receptionist, by the desk, facing the door. Clear of the key
  // on the desk and of the suite door itself.
  addStaff(scene, { x: 2.2, z: 1.8, heading: 0, label: 'Receptionist', uniform: 'staff', shirt: 0x2a2a4a, pants: 0x1a1a1a, line: 'Your suite is ready, sir. Room 412 - sleep well, the city needs you rested.' });
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
  // Glass front in two segments, with a real entrance door between
  // them: frame, panel, brass handles, glow and an ENTER sign. Walking
  // through it enters the airport lobby; the terminal wall is split at
  // the doorway (see registerHomeColliders).
  for (const gx of [-5.45, 5.45]) {
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(9.1, 5), mat(0x1a3a5a, { roughness: 0.1, metalness: 0.5 }));
    glass.position.set(gx, 3, 1.95); scene.add(glass);
  }
  addExitDoor(scene, { x: 0, z: 1.95, ry: 0, action: 'lobby', label: 'ENTER' });
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
  // Airport staff on duty by the entrance door, facing passengers as
  // they come around the terminal to the glass front.
  addStaff(scene, { x: 2.5, z: 0.5, heading: Math.PI, label: 'Airport staff', uniform: 'staff', shirt: 0x1a3a5a, pants: 0x141c28, line: 'Welcome to JFK Terminal 4. Check-in is inside - mind the boards.' });
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
      const cx = -12 + i * 4;
      homeCar(scene, cols[(r * 7 + i) % cols.length], cx, rz, r === 0 ? Math.PI / 2 : -Math.PI / 2);
      // The car is solid, registered where it was actually placed (the
      // empty bays are random, so the list cannot be fixed). ry +-PI/2
      // puts the 4.4 m length along x.
      addBoxCollider(homeColliders, cx - 2.2, rz - 0.93, cx + 2.2, rz + 0.93);
    }
  }
  // A few lamp posts and trees around the lot.
  for (const [lx, lz] of [[-16, -8], [0, -8], [16, -8], [-16, 8], [16, 8]]) {
    hcyl(scene, 0.08, 0.08, 4.5, 0x6a747a, lx, 2.25, lz, null, { metalness: 0.8, roughness: 0.4 });
    lamp(scene, lx, 4.5, lz, 0xffe9a8, 0.8, 12);
  }
  addTree(scene, -18, 12); addTree(scene, 18, -10); addTree(scene, 10, 14);
  // Parking office in the north-east corner, with a real door into the
  // office lobby. The office wall is split at the doorway (see
  // registerHomeColliders).
  hbox(scene, 4, 3, 3, 0xd8b078, 15, 1.5, -10, null, { roughness: 0.9 });
  addExitDoor(scene, { x: 15, z: -8.45, ry: 0, action: 'lobby', label: 'OFFICE' });
  const officeSign = textSprite('PARKING OFFICE', '#2a2118', '#ffd166', 'Attendant on duty');
  officeSign.scale.set(3, 0.75, 1); officeSign.position.set(15, 3.6, -8.4); scene.add(officeSign);
  const sign = textSprite('CAR PARK', '#2a2118', '#ffd166', 'Parking - 2 ZAMA an hour');
  sign.scale.set(5, 1.25, 1); sign.position.set(0, 5, -12); scene.add(sign);
  // The parking attendant, on the aisle between the two bay rows.
  addStaff(scene, { x: 6, z: 6, heading: 0, label: 'Parking attendant', uniform: 'staff', shirt: 0xc07a1a, pants: 0x2a2a2a, line: 'Parking is 2 ZAMA an hour. Mind the bays, friend.' });
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
  // Two engineers on duty by the tunnel, in hard hats, facing the
  // test section. Clear of the control panel, the workbench key and
  // the lab door.
  addStaff(scene, { x: -1, z: 0.6, heading: Math.PI, label: 'Engineer', uniform: 'engineer', shirt: 0xc07a1a, pants: 0x2a2a2a, line: 'The wing model is on the sting in the test section. Mind the glass.' });
  addStaff(scene, { x: 4.2, z: 0.8, heading: Math.PI, label: 'Engineer', uniform: 'engineer', shirt: 0xc07a1a, pants: 0x2a2a2a, line: 'We run the tunnel at 42 metres a second. Clean airflow, every time.' });
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
      // Heading PI faces the stage at the north end (-Z); makeSeatedPerson
      // adds each rig's own faceYaw, so Atlas and Casual sitters alike
      // end up facing the stage, not the back of the hall.
      const p = makeSeatedPerson({ modelIndex: seatIdx, x: sx, z: sz, heading: Math.PI + (Math.random() - 0.5) * 0.2, scale: 0.95 + Math.random() * 0.1 });
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
  // The host, on the floor in front of the stage, facing the house.
  // Clear of the podium hit box and the front row.
  addStaff(scene, { x: 3, z: -3.2, heading: 0, label: 'Host', shirt: 0x1a1a2a, pants: 0x1a1a1a, line: 'Welcome to the New York Symposium. The podium is yours when you are ready.' });
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
  // walking the lobby floor. The two standing officers hold the Idle
  // clip, face their post, and can be tapped to talk.
  const deskOfficer = makeOfficer('police', { x: 0, z: -5.9, speed: 0, heading: 0, idle: true });
  if (deskOfficer) {
    deskOfficer.group.position.set(0, 0, -5.9); deskOfficer.phase = 0; scene.add(deskOfficer.group); roomWalkers.push(deskOfficer);
    const t1 = textSprite('Officer', '#2a2118', '#ffd166', ''); t1.scale.set(1.8, 0.45, 1); t1.position.set(0, 2.15, -5.9); scene.add(t1);
    const h1 = hitBox(scene, 1.4, 2.0, 1.4, 0, 1.0, -5.9, 'staff');
    h1.userData.staffRole = 'Officer'; h1.userData.staffLine = 'NYPD Midtown. Report it here, or mind the holding cell.'; h1.userData.staffVoice = 'staff';
  }
  const cellOfficer = makeOfficer('police', { x: 4.6, z: -5.2, speed: 0, heading: Math.PI / 2, idle: true });
  if (cellOfficer) {
    cellOfficer.group.position.set(4.6, 0, -5.2); cellOfficer.phase = 0; scene.add(cellOfficer.group); roomWalkers.push(cellOfficer);
    const t2 = textSprite('Officer', '#2a2118', '#ffd166', ''); t2.scale.set(1.8, 0.45, 1); t2.position.set(4.6, 2.15, -5.2); scene.add(t2);
    const h2 = hitBox(scene, 1.4, 2.0, 1.4, 4.6, 1.0, -5.2, 'staff');
    h2.userData.staffRole = 'Officer'; h2.userData.staffLine = 'Holding cell is occupied. Keep it moving, citizen.'; h2.userData.staffVoice = 'staff';
  }
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
  // the hall floor. The two standing sailors hold the Idle clip, face
  // their post, and can be tapped to talk.
  const flagSailor = makeOfficer('navy', { x: -8.2, z: -4.4, speed: 0, heading: Math.PI / 4, idle: true });
  if (flagSailor) {
    flagSailor.group.position.set(-8.2, 0, -4.4); flagSailor.phase = 0; scene.add(flagSailor.group); roomWalkers.push(flagSailor);
    const t1 = textSprite('Sailor', '#2a2118', '#ffd166', ''); t1.scale.set(1.8, 0.45, 1); t1.position.set(-8.2, 2.15, -4.4); scene.add(t1);
    const h1 = hitBox(scene, 1.4, 2.0, 1.4, -8.2, 1.0, -4.4, 'staff');
    h1.userData.staffRole = 'Sailor'; h1.userData.staffLine = 'Brooklyn Navy Yard. Shipshape and squared away.'; h1.userData.staffVoice = 'staff';
  }
  const deskSailor = makeOfficer('navy', { x: 2.6, z: 4.4, speed: 0, heading: -Math.PI / 2, idle: true });
  if (deskSailor) {
    deskSailor.group.position.set(2.6, 0, 4.4); deskSailor.phase = 0; scene.add(deskSailor.group); roomWalkers.push(deskSailor);
    const t2 = textSprite('Sailor', '#2a2118', '#ffd166', ''); t2.scale.set(1.8, 0.45, 1); t2.position.set(2.6, 2.15, 4.4); scene.add(t2);
    const h2 = hitBox(scene, 1.4, 2.0, 1.4, 2.6, 1.0, 4.4, 'staff');
    h2.userData.staffRole = 'Sailor'; h2.userData.staffLine = 'Duty desk. Sign the log if you are staying, sailor.'; h2.userData.staffVoice = 'staff';
  }
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
  // The vault technician, by the panels, facing the stair as the
  // player comes down. Clear of the panel hit boxes and the console.
  addStaff(scene, { x: -2, z: -1, heading: 0, label: 'Technician', uniform: 'engineer', shirt: 0x2e4a6b, pants: 0x2a2a2a, line: 'The sensors read the three water lines live - hospital, residential, industrial. Tap a panel for the numbers.' });
}
// ---------- Building lobbies ----------
// A small interior lobby behind an entrance door: reception desk,
// chairs, a wall sign naming the building. One lobby serves every
// exterior building that has no interior of its own (hospital,
// industry, airport, car park office, market corner shop, filling
// station kiosk). The lobby's own EXIT door returns to the grounds
// outside (its onLeave re-enters the place it came from).
const LOBBY_CONFIG = {
  hospital: { sign: 'CITY HOSPITAL', sub: 'Reception - emergency, open 24 hours', wall: 0x9fc4e8, floor: 0x8a8a86 },
  industry: { sign: 'WATER TREATMENT PLANT', sub: 'Authorised personnel - sign in at the desk', wall: 0x8a8a82, floor: 0x6a6a62 },
  airport: { sign: 'JFK - TERMINAL 4', sub: 'Departures - flights out', wall: 0x9fc4e8, floor: 0x8a8a86 },
  carpark: { sign: 'CAR PARK OFFICE', sub: 'Parking - 2 ZAMA an hour', wall: 0x8a8a82, floor: 0x3a3d40 },
  marketstreet: { sign: 'CORNER SHOP', sub: 'Fresh goods - browse the shelves', wall: 0xd8b078, floor: 0x6b4226 },
  fillingstation: { sign: 'FILLING STATION KIOSK', sub: 'Snacks, oil and air - pay at the counter', wall: 0xd8b078, floor: 0x3a3d40 }
};
function buildLobby(scene, lobbyFor) {
  const cfg = LOBBY_CONFIG[lobbyFor] || LOBBY_CONFIG.hospital;
  roomShell(scene, 9, 7, 3.2, cfg.floor, cfg.wall);
  // Reception desk on the north wall, two chairs facing it.
  hbox(scene, 3.0, 1.1, 0.8, 0x6b4226, 0, 0.55, -2.9, null, { roughness: 0.8 });
  hbox(scene, 3.2, 0.08, 1.0, 0x8a6a42, 0, 1.14, -2.9, null, { roughness: 0.8 });
  for (const cx of [-2.5, 2.5]) {
    hbox(scene, 0.6, 0.08, 0.6, 0x2e6fb0, cx, 0.45, 0.5, null, { roughness: 0.8 });
    hbox(scene, 0.6, 0.6, 0.08, 0x2e6fb0, cx, 0.75, 0.8, null, { roughness: 0.8 });
  }
  const sign = textSprite(cfg.sign, '#f4f6f8', '#2a3a4a', cfg.sub);
  sign.scale.set(5, 1.25, 1); sign.position.set(0, 2.4, -3.4); scene.add(sign);
  // The lobby's own people, at their posts beside the desk ends,
  // facing the player as he comes in. The hospital has a doctor
  // (tap him for treatment, 10 ZAMA) and a nurse; every other lobby
  // has its desk staffer. They stand clear of the EXIT door.
  if (lobbyFor === 'hospital') {
    addStaff(scene, { x: 2.3, z: -2.9, heading: 0, label: 'Doctor', action: 'doctor', voice: 'doctor', uniform: 'doctor', shirt: 0xf2f2f2, pants: 0x2a2a3a });
    addStaff(scene, { x: -2.3, z: -2.9, heading: 0, label: 'Nurse', voice: 'nurse', uniform: 'nurse', shirt: 0x2e7a8a, pants: 0x2e7a8a, line: 'Emergency is open 24 hours. The doctor can treat you - 10 ZAMA, paid at the desk.' });
  } else if (lobbyFor === 'industry') {
    addStaff(scene, { x: 2.3, z: -2.9, heading: 0, label: 'Plant clerk', uniform: 'staff', shirt: 0x2a4a6b, pants: 0x2a2a2a, line: 'Sign in here, please. Authorised personnel only past the desk.' });
  } else if (lobbyFor === 'airport') {
    addStaff(scene, { x: 2.3, z: -2.9, heading: 0, label: 'Airport staff', uniform: 'staff', shirt: 0x1a3a5a, pants: 0x141c28, line: 'Departures are through there. Flights out all day - mind the boards.' });
  } else if (lobbyFor === 'carpark') {
    addStaff(scene, { x: 2.3, z: -2.9, heading: 0, label: 'Parking attendant', uniform: 'staff', shirt: 0xc07a1a, pants: 0x2a2a2a, line: 'Parking is 2 ZAMA an hour. Plenty of bays today.' });
  } else if (lobbyFor === 'marketstreet') {
    addStaff(scene, { x: 2.3, z: -2.9, heading: 0, label: 'Shopkeeper', uniform: 'vendor', shirt: 0x7a5a3a, pants: 0x3a2a1a, line: 'Fresh goods in today. Browse the shelves, friend.' });
  } else if (lobbyFor === 'fillingstation') {
    addStaff(scene, { x: 2.3, z: -2.9, heading: 0, label: 'Salesperson', uniform: 'staff', shirt: 0xc0392b, pants: 0x2a2a2a, line: 'Full tank is 0.5 ZAMA, any level. Tap the Fill tank button and I will sort you out.' });
  }
  // The way back out: a real EXIT door on the south wall, back to the grounds.
  addExitDoor(scene, { x: 0, z: 3.4, ry: Math.PI, label: 'EXIT', action: 'leave' });
}
// A filling station forecourt: a canopy over two pumps, a kiosk with a
// real door, a price sign, and a marked parking bay. The player drives
// here from the map, gets out in the arrival lot, and walks in. The
// Fill button (see showFillButton) is the way to buy fuel.
function buildFillingStation(scene) {
  scene.background = new THREE.Color(0x7aa0c4);
  scene.fog = new THREE.Fog(0x9fc4e8, 40, 140);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat(0x3a3d40, { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const fore = new THREE.Mesh(new THREE.PlaneGeometry(26, 20), mat(0x8a8a86, { roughness: 0.95 }));
  fore.rotation.x = -Math.PI / 2; fore.position.set(0, 0.02, 0); fore.receiveShadow = true; scene.add(fore);
  // Canopy on four posts over the pumps.
  hbox(scene, 12, 0.3, 8, 0x2e6fb0, 0, 4.6, -4, null, { roughness: 0.7 });
  for (const [px, pz] of [[-5, -7], [5, -7], [-5, -1], [5, -1]]) {
    hcyl(scene, 0.12, 0.12, 4.6, 0x8a949a, px, 2.3, pz, null, { metalness: 0.7, roughness: 0.4 });
  }
  // Two fuel pumps under the canopy.
  for (const px of [-2, 2]) {
    hbox(scene, 0.7, 1.5, 0.5, 0xc0392b, px, 0.75, -4, null, { roughness: 0.6 });
    hbox(scene, 0.8, 0.2, 0.6, 0x2a2a2a, px, 1.6, -4, null, { roughness: 0.6 });
  }
  // Kiosk with a real door (leads to the kiosk lobby), and a price sign.
  hbox(scene, 5, 3, 4, 0xd8b078, -8, 1.5, -6, null, { roughness: 0.9 });
  addExitDoor(scene, { x: -8, z: -3.95, ry: 0, action: 'lobby', label: 'KIOSK' });
  const sign = textSprite('FILLING STATION', '#2a2118', '#ffd166', 'Full tank - 0.5 ZAMA');
  sign.scale.set(6, 1.5, 1); sign.position.set(0, 6, -7.5); scene.add(sign);
  const price = textSprite('FUEL 0.5 ZAMA', '#f4f6f8', '#2a3a4a', 'Full tank, any level');
  price.scale.set(3, 0.75, 1); price.position.set(0, 3.2, -3.9); scene.add(price);
  addTree(scene, 11, 8);
  lamp(scene, -6, 3.2, 6, 0xfff2c0, 0.7, 10);
  lamp(scene, 6, 3.2, 10, 0xfff2c0, 0.7, 10);
  // The forecourt attendant, by the pumps. Tapping him offers the
  // fill; the gold Fill tank button still does the filling itself.
  addStaff(scene, { x: 3.2, z: -2.5, heading: 0, label: 'Attendant', uniform: 'staff', shirt: 0xc0392b, pants: 0x2a2a2a, line: 'Full tank is 0.5 ZAMA, any level. Tap the Fill tank button and I will sort you out.' });
}

// ---------- Wall and furniture colliders (see player.js) ----------
// homeColliders is rebuilt by enterPlace for the current place: the
// builder runs first, then registerHomeColliders appends the boxes for
// that place, and the animate loop resolves movement against them.
// The outer walls of the roomShell places need no collider: the
// homeBounds clamp already stops the player 0.5-1 m short of every
// wall face, so the walls are solid through the bounds. The colliders
// below are the things the player can actually walk through today:
// interior partitions, beds, couches, tables, counters, desks, stalls
// and the solid building blocks of the exterior places (hospital
// tower and wing, industry hall and office and tanks, airport
// terminal and tower, terminal building, market facades, parked cars).
// Doorways are never blocked: every addExitDoor gap stays open, and
// every exterior entrance door gets its wall split at the doorway, so
// the player can always walk up to the door and through it. A collider
// never covers a walk-up trigger: the station key, the valve wheels,
// the service desk, the ticket machines, the phone booth, the SCADA
// desk, the log book, the vendor and every click target stay reachable
// from 0.35 m out (the player stops at the face, the click still lands).
function registerHomeColliders(kind) {
  const c = homeColliders;
  const B = (x0, z0, x1, z1) => addBoxCollider(c, x0, z0, x1, z1);
  if (kind === 'mansion') {
    B(-2.58, -5.0, -2.42, -2.0); // bedroom partition
    B(-7.0, 1.94, -4.5, 2.06); // bathroom partition 1
    B(-3.56, 2.0, -3.44, 5.0); // bathroom partition 2
    B(-5.7, -4.7, -3.3, -1.7); // bed
    B(-6.98, -1.9, -6.43, -0.5); // wardrobe
    B(-6.48, -3.43, -5.93, -2.98); // nightstand
    B(-1.3, -0.78, 1.9, 0.47); // sofa 1
    B(1.83, -2.2, 3.07, -0.2); // sofa 2
    B(6.13, -2.98, 6.88, 2.0); // kitchen counter + fridge
    B(2.6, 2.5, 5.0, 3.9); // dining table
    B(-6.9, -0.4, -6.5, 1.4); // bookshelf
    B(-6.63, 2.9, -5.78, 4.7); // bathtub
    B(-4.43, 4.15, -3.98, 4.85); // toilet
    B(-4.18, 2.32, -3.62, 2.88); // bathroom sink
  } else if (kind === 'safehouse') {
    B(-0.08, -2.75, 0.08, -0.25); // partition
    B(-3.2, -2.9, -1.6, 0.1); // bed
    B(-3.98, -0.2, -3.43, 1.2); // wardrobe
    B(-1.48, -2.73, -0.93, -2.28); // nightstand
    B(0.7, -0.98, 2.9, 0.27); // sofa
    B(-0.7, 2.23, 2.68, 2.98); // kitchen counter + fridge
    B(-0.8, 1.1, 0.8, 2.1); // save table (the spawn stands on its south edge and can walk out; the table is clicked to save)
  } else if (kind === 'hospital') {
    B(-5.0, -11.0, 5.0, -5.0); // main tower
    B(-6.8, -6.8, -3.2, -3.2); // rounded corner cylinder (square approx)
    // Lower wing, split at the entrance door (gap x 1.28-2.72).
    B(-4.0, -4.5, 1.28, 0.5);
    B(2.72, -4.5, 8.0, 0.5);
    B(-10.2, 3.05, -4.7, 4.95); // ambulance van
    B(7.0, 5.75, 9.0, 6.25); // bench
  } else if (kind === 'industry') {
    // Treatment hall, split at the entrance door (gap x -2.72 to -1.28).
    B(-10.0, -12.5, -2.72, -3.5);
    B(-1.28, -12.5, 6.0, -3.5);
    // Office block, split at its entrance door (gap x 9.28-10.72).
    B(6.0, -11.0, 9.28, -5.0);
    B(10.72, -11.0, 14.0, -5.0);
    B(-13.6, 2.4, -10.4, 5.6); // storage tank 1
    B(-9.6, 2.4, -6.4, 5.6); // storage tank 2
    B(-5.6, 2.4, -2.4, 5.6); // storage tank 3
    B(11.65, 1.65, 12.35, 2.35); // barrel 1
    B(12.85, 1.65, 13.55, 2.35); // barrel 2
    B(14.05, 1.65, 14.75, 2.35); // barrel 3
    B(11.65, 2.85, 12.35, 3.55); // barrel 4
    B(12.85, 2.85, 13.55, 3.55); // barrel 5
  } else if (kind === 'terminal') {
    B(7.4, -6.6, 8.6, -5.4); // pillar 1
    B(-8.6, -6.6, -7.4, -5.4); // pillar 2
    B(7.4, -0.6, 8.6, 0.6); // pillar 3
    B(-8.6, -0.6, -7.4, 0.6); // pillar 4
    B(7.4, 5.4, 8.6, 6.6); // pillar 5
    B(-8.6, 5.4, -7.4, 6.6); // pillar 6
    B(11.0, -2.3, 11.8, -1.7); // ticket machine 1
    B(11.0, -0.1, 11.8, 0.5); // ticket machine 2
    B(11.0, 2.1, 11.8, 2.7); // ticket machine 3
    B(11.0, 4.3, 11.8, 4.9); // ticket machine 4
    B(6.4, 9.55, 9.6, 10.45); // service desk counter
    B(-2.0, -4.4, 2.0, -3.6); // bench (north)
    B(-2.0, 3.6, 2.0, 4.4); // bench (south)
  } else if (kind === 'terminalFront') {
    // Terminal building, split at the revolving glass door (opening x -1.6 to 1.6).
    B(-13.0, -14.0, -1.6, -10.0);
    B(1.6, -14.0, 13.0, -10.0);
    B(-2.33, 0.8, -0.48, 5.2); // the player's parked sedan
    B(7.08, 5.8, 8.93, 10.2); // parked car 1
    B(11.08, 3.8, 12.93, 8.2); // parked car 2
  } else if (kind === 'hotel') {
    B(-5.0, 1.14, -3.0, 1.26); // bathroom partition 1
    B(-2.06, 1.2, -1.94, 3.5); // bathroom partition 2
    B(-3.9, -3.3, -1.7, -0.3); // bed
    B(-4.98, -1.2, -4.43, 0.2); // wardrobe
    B(-1.68, -3.03, -1.12, -2.58); // nightstand 1
    B(-4.48, -3.03, -3.92, -2.58); // nightstand 2
    B(0.6, -1.18, 3.0, 0.07); // sofa
    B(2.7, 1.15, 4.5, 2.05); // desk
    B(4.25, 2.5, 4.95, 3.1); // minibar fridge
    B(-4.4, 2.58, -2.6, 3.43); // bathtub
    B(-4.83, 1.45, -4.38, 2.15); // toilet
    B(-2.68, 1.52, -2.12, 2.08); // bathroom sink
  } else if (kind === 'airport') {
    // Terminal building, split at the entrance door (gap x -0.72 to 0.72).
    B(-12.0, 2.0, -0.72, 10.0);
    B(0.72, 2.0, 12.0, 10.0);
    B(14.4, -11.6, 17.6, -8.4); // control tower
    B(-12.2, 9.8, -7.8, 14.2); // parked car 1
    B(-8.2, 11.8, -3.8, 16.2); // parked car 2
    B(5.8, 10.8, 10.2, 15.2); // parked car 3
  } else if (kind === 'carpark') {
    // Parked cars are placed at random in buildCarpark (about 20% of
    // bays stay empty), so each car registers its own collider where it
    // is placed. The parking office is fixed: split at its door
    // (gap x 14.28-15.72).
    B(13.0, -11.5, 14.28, -8.5);
    B(15.72, -11.5, 17.0, -8.5);
  } else if (kind === 'fillingstation') {
    B(-2.35, -4.25, -1.65, -3.75); // fuel pump 1
    B(1.65, -4.25, 2.35, -3.75); // fuel pump 2
    // Kiosk, split at its door (gap x -8.72 to -7.28).
    B(-10.5, -8.0, -8.72, -4.0);
    B(-7.28, -8.0, -5.5, -4.0);
  } else if (kind === 'windtunnel') {
    B(-6.5, -3.1, -2.5, 0.1); // contraction cone (wide end)
    B(-2.5, -2.19, 4.5, -0.81); // test section frame
    B(4.5, -2.35, 5.5, -0.65); // fan housing
    B(5.5, -2.6, 6.3, -0.4); // diffuser
    B(1.9, 0.5, 3.1, 1.1); // control console
    B(-6.2, 4.15, -3.8, 5.05); // workbench
    B(6.0, 4.5, 7.0, 5.1); // tool cabinet
    B(-7.85, -5.92, -6.55, -5.6); // phone booth
  } else if (kind === 'symposium') {
    B(-5.0, -7.0, 5.0, -4.0); // stage (raised 1 m, no climb in code)
    for (const rz of [-1, 0.6, 2.2, 3.8]) {
      for (const cx of [-4.8, -2.4, 0, 2.4, 4.8]) {
        B(cx - 0.28, rz - 0.23, cx + 0.28, rz + 0.32); // one seat (aisles stay open between seats and rows)
      }
    }
  } else if (kind === 'policestation') {
    B(-2.25, -5.45, 2.25, -4.55); // front desk
    B(4.8, -5.95, 8.2, -5.65); // holding-cell bars (the cell stays barred off)
    B(-8.8, 4.2, -7.6, 4.8); // side table
  } else if (kind === 'navybarracks') {
    for (const bx of [-8.6, 8.6]) {
      for (const bz of [-3, 0, 3]) {
        B(bx - 1.0, bz - 0.45, bx + 1.0, bz + 0.45); // bunk
        B(bx - 0.35, bz + 0.65, bx + 0.35, bz + 1.15); // footlocker beside it
      }
    }
    for (let i = 0; i < 6; i++) {
      const cx = -4.5 + i * 1.8;
      B(cx - 0.45, -5.85, cx + 0.45, -5.35); // wall locker (gaps stay open between lockers)
    }
    B(2.7, 4.1, 4.3, 4.9); // duty desk
  } else if (kind === 'sensorvault') {
    B(-0.6, 1.4, 0.6, 3.9); // staircase (no climb in code, a solid block in plan)
    B(3.8, 2.85, 5.2, 3.55); // control console
  } else if (kind === 'marketstreet') {
    B(-13.0, -12.0, -8.0, -4.0); // west facade, stone
    B(-13.0, -3.0, -8.0, 4.0); // west facade, brick
    B(-13.0, 5.0, -8.0, 13.0); // west facade, plaster
    B(8.0, -11.0, 13.0, -3.0); // east facade, brick
    // East facade, plaster, split at the corner-shop door (gap z 8.78-10.22).
    B(8.0, 6.0, 13.0, 8.78);
    B(8.0, 10.22, 13.0, 13.0);
    B(6.75, 0.0, 7.65, 3.0); // east stall counter
    B(-7.65, -1.0, -6.75, 2.0); // west stall counter
    B(-5.53, -12.2, -3.68, -7.8); // red car
    B(3.68, 7.8, 5.53, 12.2); // blue car
  } else if (kind === 'lobby') {
    B(-1.5, -3.3, 1.5, -2.5); // reception desk
    B(-2.8, 0.2, -2.2, 0.8); // chair 1
    B(2.2, 0.2, 2.8, 0.8); // chair 2
  }
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
  // Terminal front: a fresh arrival starts with no ticket and nobody
  // seated; the seat logic below puts the player in the parked car.
  terminalSeated = false; terminalFrontCar = null; terminalFrontDoor = null; terminalDoorSwing = null;
  glassDoor = null; glassDoorToastAt = -100; serviceDeskToastAt = -100; marketVendorAt = -100;
  if (kind === 'terminalFront' && homePrologue) terminalTicket = false;
  hideTerminalGetOutButton();
  const isRoom = kind === 'mansion' || kind === 'safehouse' || kind === 'terminal' || kind === 'hotel' || kind === 'windtunnel' || kind === 'symposium' || kind === 'policestation' || kind === 'navybarracks' || kind === 'sensorvault' || kind === 'lobby';
  if (isRoom) {
    homeScene.background = new THREE.Color(0x0a0d10);
    homeScene.fog = new THREE.FogExp2(0x0a0d10, 0.02);
  }
  baseLights(homeScene, !isRoom);
  // Fresh wall list for this place: the builder below fills it, and the
  // animate loop resolves movement against it (see player.js).
  homeColliders = [];
  if (kind === 'mansion') { buildMansion(homeScene); homeBounds = { x: [-6.4, 6.4], z: [-4.4, 4.4] }; homeStart = homePrologue ? { x: -2.9, y: 1.7, z: -1.3, yaw: -1.87 } : { x: 0, y: 1.7, z: 4, yaw: 0 }; }
  else if (kind === 'safehouse') { buildSafehouse(homeScene); homeBounds = { x: [-3.4, 3.4], z: [-2.4, 2.4] }; homeStart = { x: 0, y: 1.7, z: 2, yaw: 0 }; }
  else if (kind === 'hospital') { buildHospital(homeScene); homeBounds = { x: [-16, 16], z: [-14, 18] }; homeStart = { x: 0, y: 1.7, z: 14, yaw: 0 }; }
  else if (kind === 'industry') { buildIndustry(homeScene); homeBounds = { x: [-16, 16], z: [-12, 16] }; homeStart = { x: 0, y: 1.7, z: 12, yaw: 0 }; }
  else if (kind === 'terminal') { buildTerminal(homeScene); homeBounds = { x: [-11, 11], z: [-9.5, 14] }; homeStart = { x: 0, y: 1.7, z: 12, yaw: 0 }; }
  else if (kind === 'terminalFront') { buildTerminalFront(homeScene); homeBounds = { x: [-14, 14], z: [-9.5, 14] }; homeStart = { x: 0.4, y: 1.7, z: 3, yaw: 0 }; }
  else if (kind === 'hotel') { buildHotel(homeScene); homeBounds = { x: [-4.4, 4.4], z: [-2.9, 2.9] }; homeStart = { x: 0, y: 1.7, z: 2.5, yaw: 0 }; }
  else if (kind === 'airport') { buildAirport(homeScene); homeBounds = { x: [-20, 20], z: [-16, 20] }; homeStart = { x: 0, y: 1.7, z: 14, yaw: 0 }; }
  else if (kind === 'carpark') { buildCarpark(homeScene); homeBounds = { x: [-18, 18], z: [-14, 18] }; homeStart = { x: 0, y: 1.7, z: 14, yaw: 0 }; }
  else if (kind === 'windtunnel') { buildWindtunnel(homeScene); homeBounds = { x: [-8.4, 8.4], z: [-5.4, 5.4] }; homeStart = { x: 0, y: 1.7, z: 4.5, yaw: 0 }; }
  else if (kind === 'symposium') { buildSymposium(homeScene); homeBounds = { x: [-7.4, 7.4], z: [-6.4, 6.4] }; homeStart = { x: 0, y: 1.7, z: 5.5, yaw: 0 }; }
  else if (kind === 'policestation') { buildPoliceStation(homeScene); homeBounds = { x: [-8.4, 8.4], z: [-6.4, 6.4] }; homeStart = { x: 0, y: 1.7, z: 5.5, yaw: 0 }; }
  else if (kind === 'navybarracks') { buildNavyBarracks(homeScene); homeBounds = { x: [-9.4, 9.4], z: [-5.4, 5.4] }; homeStart = { x: 0, y: 1.7, z: 4.5, yaw: 0 }; }
  else if (kind === 'sensorvault') { buildSensorVault(homeScene); homeBounds = { x: [-5.4, 5.4], z: [-3.4, 3.4] }; homeStart = { x: 0, y: 1.7, z: 1.0, yaw: 0 }; }
  else if (kind === 'marketstreet') { buildMarketStreet(homeScene); homeBounds = { x: [-13, 13], z: [-13, 16] }; homeStart = { x: 0, y: 1.7, z: 12, yaw: 0 }; }
  else if (kind === 'lobby') { buildLobby(homeScene, opts.lobbyFor || 'hospital'); homeBounds = { x: [-3.9, 3.9], z: [-2.9, 2.9] }; homeStart = { x: 0, y: 1.7, z: 2, yaw: 0 }; }
  else if (kind === 'fillingstation') { buildFillingStation(homeScene); homeBounds = { x: [-13, 13], z: [-10, 14] }; homeStart = { x: 0, y: 1.7, z: 10, yaw: 0 }; }
  else return;
  // A return spawn (coming out of a lobby) puts him beside the door
  // he went in, facing it, instead of at the generic start.
  if (opts.spawn) homeStart = { x: opts.spawn.x, y: 1.7, z: opts.spawn.z, yaw: opts.spawn.yaw || 0 };
  // Walls and furniture for this place (see registerHomeColliders).
  registerHomeColliders(kind);
  // The Filling Station is where fuel is bought: show the Fill button
  // while the player is here, and hide it again when he leaves.
  if (kind === 'fillingstation') showFillButton();
  // Third person on entering any place, so the player sees himself
  // in every room and exterior, not just in the missions.
  try { setThirdPerson(true); } catch (e) { /* camera is best effort */ }
  // Hide any room key the player already owns (a replay), so it cannot
  // be picked up twice.
  syncRoomKeys();
  homeCamera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 300);
  homeCamera.position.set(homeStart.x, homeStart.y, homeStart.z);
  homeYaw = homeStart.yaw; homePitch = 0;
  // Sync the stored player position too: without this the first
  // homeAnimate frame's beginPlayerFrame snaps the camera to wherever
  // the player last stood in the previous scene (wrong spawn - and at
  // the symposium a stale spot near the stage even fired the podium
  // payout on arrival).
  try { setPlayerPos(homeStart.x, homeStart.z); } catch (e) { /* ignore */ }
  showHomeBar(kind);
  homeActive = true;
  window.__lsHomeActive = true;
  const welcomes = {
    mansion: homePrologue ? 'You wake up in bed. The phone is ringing - stand up, then sit on the couch and answer it.' : 'The Mansion - home. The couch, the big TV, your bed. Click the bed to sleep.',
    safehouse: 'Safe House Apartment - nobody knows this place. Click the bed or the table to save.',
    hospital: 'City Hospital - the tall white tower. Look around, then head back to the map.',
    industry: 'Industrial Area - the water treatment plant. Look around, then head back to the map.',
    terminal: homePrologue ? 'Grand Central. Buy your ticket at the service desk near the entrance (0.1 ZAMA), then board the 4 train on Platform 4.' : 'Train Terminal - Grand Central. The 4 train is on Platform 4. Look around, then head back to the map.',
    terminalFront: homePrologue ? 'Grand Central. You are parked in front of the terminal. Get out of the car and walk to the glass doors.' : 'Train Terminal - Grand Central. You are parked in front.',
    hotel: 'Hotel - your suite. Click the bed to sleep.',
    airport: 'Airport - JFK Terminal 4. Look around, then head back to the map.',
    carpark: 'Car Park - rows of parked cars. Look around, then head back to the map.',
    windtunnel: 'Wind Tunnel Lab - the long wooden tunnel. Run it at the control panel by the test section. The phone booth on the wall gives the next mission.',
    symposium: 'Symposium Hall - a full house. Take the NYC podium on the stage.',
    policestation: 'Police Station - NYPD Midtown. The officers are on duty. Look around, then head back to the map.',
    navybarracks: 'Navy Barracks - Brooklyn Navy Yard. The sailors are on duty. Look around, then head back to the map.',
    sensorvault: 'Sensor Vault - underground, under the treatment plant. The pressure sensors read the three water lines. Tap a panel for the readings.',
    marketstreet: 'Market Street - stalls, shops and a vendor. Look around, then head back to the map.',
    lobby: 'Lobby - look around, then walk back out through the EXIT door.',
    fillingstation: 'Filling Station - full tank for 0.5 ZAMA. Tap the Fill tank button to fill up.'
  };
  showHomeToast(welcomes[kind] || kind);
  if (homeRaf) cancelAnimationFrame(homeRaf);
  homeRaf = requestAnimationFrame(homeAnimate);
  // Terminal front: the player arrives in his parked car, seated in the
  // driver's seat. The seat owns the camera until he gets out.
  if (kind === 'terminalFront') seatTerminalFront();
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
  phoneGlow = null; terminalPedestrians = []; marketVendorAt = -100;
  terminalSeated = false; terminalFrontCar = null; terminalFrontDoor = null; terminalDoorSwing = null; glassDoor = null;
  hideTerminalGetOutButton();
  hideFillButton();
  const bar = document.getElementById('homeBar');
  if (bar) bar.classList.add('hidden');
  const cb = homeOnLeave; homeOnLeave = null;
  if (cb) cb();
}
function homeAnimate() {
  if (!homeActive) return;
  homeRaf = requestAnimationFrame(homeAnimate);
  // A throw anywhere in the frame (a rigged model, a mixer, a sound
  // call) must not skip the render: the canvas would freeze on the
  // last good frame while the DOM and the game logic kept running,
  // which reads as the world being stuck with dead drags. Catch it,
  // put it on the on-screen banner (the console is unreadable to a
  // live checker), and still present a frame with whatever state was
  // reached. The next frame tries again.
  try { homeAnimateFrame(); }
  catch (e) {
    try { console.error('[LastSignal frame error]', e); } catch (e2) { /* ignore */ }
    try { showFrameErrorBanner(e && e.message ? e.message : String(e)); } catch (e2) { /* ignore */ }
    try { if (homeScene && homeCamera) renderer.render(homeScene, homeCamera); } catch (e2) { try { showFrameErrorBanner('render: ' + (e2 && e2.message ? e2.message : String(e2))); } catch (e3) { /* ignore */ } }
  }
}
function homeAnimateFrame() {
  const t = Date.now() / 1000;
  const dt = homeAnimate.lastT === undefined ? 0.016 : Math.min(0.1, t - homeAnimate.lastT);
  homeAnimate.lastT = t;
  // Prologue drive: the player is driving his car to the Train Terminal.
  // The drive has its own scene and camera; this branch updates it and
  // renders it, instead of the room movement below.
  if (plDriveActive) { updatePrologueDrive(dt, t); return; }
  // Terminal front: the parked car door and the revolving glass doors
  // animate on this loop. Both update functions no-op when there is
  // nothing to animate, so they are safe to call every frame in any room.
  updateTerminalDoorSwing(dt);
  updateTerminalGlassDoor(dt);
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
      // Keep the lie rotation: setAvatarPose('lie') turns the group
      // -90 deg on X so the head points north. Resetting the rotation
      // to (0,0,0) here would stand the avatar upright ON the bed.
      a.rotation.set(-Math.PI / 2, 0, 0);
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
  // Terminal front: seated in the parked car. The seat owns the camera
  // (a chase view from behind the car, so he sees himself in the
  // driver's seat) and the car door keeps swinging; movement is paused
  // until he gets out through the door or the Get out button.
  if (terminalSeated && homeKind === 'terminalFront' && homeCamera) {
    updateTerminalSeatView();
    updateTerminalDoorSwing(dt);
    renderer.render(homeScene, homeCamera);
    return;
  }
  // In third-person the camera was left behind the avatar last frame;
  // put it back on the player before moving, or movement starts from
  // the wrong place.
  beginPlayerFrame(homeCamera, 1.7);
  // Self-heal a wedged camera: if the position or angles ever go
  // non-finite, reset to the room start instead of rendering
  // nothing with dead drags until a reload.
  if (!isFinite(homeCamera.position.x) || !isFinite(homeCamera.position.z) || !isFinite(homeYaw) || !isFinite(homePitch)) homeResetView();
  const sp = 0.07;
  const mv = moveDelta(homeKeys, homeYaw, sp);
  // Remember where the player stood before this step, so the bed
  // keep-out below can put them back instead of letting them walk
  // through the bed.
  const prevPX = homeCamera.position.x, prevPZ = homeCamera.position.z;
  const resolved = resolveMove(prevPX, prevPZ, mv.dx, mv.dz, homeColliders);
  homeCamera.position.x = resolved.x; homeCamera.position.z = resolved.z;
  homeCamera.position.x = Math.max(homeBounds.x[0], Math.min(homeBounds.x[1], homeCamera.position.x));
  homeCamera.position.z = Math.max(homeBounds.z[0], Math.min(homeBounds.z[1], homeCamera.position.z));
  // Bed keep-out: the bed is solid furniture, not a walk-through. If
  // this step would carry the player into the bed's footprint (from
  // outside it), put them back where they stood. Without this, walking
  // backwards from the prologue stand-up spot (S from -2.9, -1.3)
  // walks straight into the bed, and the camera behind the player
  // ends up inside the bed and the screen goes brown. The footprint
  // is the bed frame (w by 3 m) plus a small margin. A player who
  // somehow starts inside it can still walk out.
  if (currentBedPos) {
    const bx0 = currentBedPos.x - currentBedPos.w / 2 - 0.15, bx1 = currentBedPos.x + currentBedPos.w / 2 + 0.15;
    const bz0 = currentBedPos.z - 1.6, bz1 = currentBedPos.z + 1.6;
    const nowIn = homeCamera.position.x > bx0 && homeCamera.position.x < bx1 && homeCamera.position.z > bz0 && homeCamera.position.z < bz1;
    const wasIn = prevPX > bx0 && prevPX < bx1 && prevPZ > bz0 && prevPZ < bz1;
    if (nowIn && !wasIn) { homeCamera.position.x = prevPX; homeCamera.position.z = prevPZ; }
  }
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
    // 1.8 m, not 1.4: approaching a doorway slightly off its centre
    // line, the wall collider stops the player a step short of the
    // old radius and the door never opened (the hospital entrance
    // needed a strafe into the doorway on the live check).
    const near = dx * dx + dz * dz < 1.8 * 1.8;
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
          if (d.action === 'lobby') { goToLobby(homeKind, d); return; }
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
  // the prologue it just says the train is already ridden. The trigger
  // is 3 m because the player is kept off the raised platform (bounds
  // stop at z -9.5) and the train sits at z -12: a 2.2 m trigger could
  // never be reached on foot, so walking to the train did nothing.
  if (homeKind === 'terminal' && !sleeping) {
    const dx = homeCamera.position.x - 0, dz = homeCamera.position.z - (-12);
    if (dx * dx + dz * dz < 3.0 * 3.0) {
      if (homePrologue) { boardTrain(); return; }
      else if (t - (homeAnimate.trainToastAt || -10) > 5) {
        homeAnimate.trainToastAt = t;
        showHomeToast('The 4 train - you already rode it. The story is in Act II now.');
      }
    }
  }
  // Terminal front: walk up to the revolving glass doors and they open
  // on touch (or a click); stepping through once they are open takes
  // him into the concourse. The door is at z -9.8 and the player can
  // walk to z -9.5, so the 1.4 m entry trigger is reachable on foot.
  if (homeKind === 'terminalFront' && !terminalSeated) {
    const gdx = homeCamera.position.x, gdz = homeCamera.position.z + 9.8;
    const gd2 = gdx * gdx + gdz * gdz;
    if (gd2 < 2.2 * 2.2) {
      if (glassDoor && glassDoor.open < 1) openTerminalGlassDoor();
      if (glassDoor && glassDoor.open > 0.6 && gd2 < 1.4 * 1.4) { enterTerminalInterior(); return; }
    }
  }
  // Service desk: walking up to it in the prologue points at the ticket
  // (throttled, so it does not spam); clicking the desk buys it.
  if (homeKind === 'terminal' && homePrologue && !terminalTicket) {
    const sdx = homeCamera.position.x - 8, sdz = homeCamera.position.z - 10;
    if (sdx * sdx + sdz * sdz < 1.8 * 1.8 && t - serviceDeskToastAt > 6) {
      serviceDeskToastAt = t;
      showHomeToast('Train service desk - buy your ticket here (0.1 ZAMA). Click the desk.');
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
  // podium on the stage takes it (a missed click is not a dead end).
  // The trigger is centred on the podium itself (0, -4.6), so the
  // payout can only fire when the player is actually at the podium,
  // never on arrival or from the audience rows.
  if (homeKind === 'symposium') {
    for (const p of symposiumAudience) updateSeatedPerson(p, t);
    if (!podiumDone) {
      const dx = homeCamera.position.x - 0, dz = homeCamera.position.z - (-4.6);
      if (dx * dx + dz * dz < 1.2 * 1.2) takePodium();
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
  // The camera is clamped inside the room (homeBounds), so it can
  // never be pushed through a wall when the player stands near one:
  // without this, the 4 m camera ended up outside the room and the
  // screen went brown (the prologue S-walk did exactly that).
  {
    const mv2 = moveDelta(homeKeys, homeYaw, 1);
    applyPlayerPresence({ scene: homeScene, camera: homeCamera, x: homeCamera.position.x, z: homeCamera.position.z, yaw: homeYaw, pitch: homePitch, moving, moveDx: mv2.dx, moveDz: mv2.dz, dt, t, eyeY: 1.7, camBounds: homeBounds });
  }
  renderer.render(homeScene, homeCamera);
}
function homeResetView() {
  if (!homeActive || !homeCamera) return;
  homeCamera.position.set(homeStart.x, homeStart.y, homeStart.z);
  homeYaw = homeStart.yaw; homePitch = 0;
  // Clear any wedged drag state too: a press whose release was lost
  // (focus change, pointer capture dropped) leaves homeDragging or
  // phoneDown set, and every later drag then does nothing until a
  // reload. Reset view is the player's recovery button, so it must
  // recover the input as well as the camera.
  homeDragging = false; phoneDown = false; homeDragMoved = 0;
  // Clear held movement keys and stale pinch pointers as well. A
  // keyup lost to a focus change (clicking this very button moves
  // focus) leaves a movement key stuck on: after the reset the
  // player walks straight back to the wall he came from, the
  // squeezed camera hides his avatar, and the view reads as dead.
  // A phantom pinch pointer does the same to drags (one lost
  // pointerup plus one real finger reads as a two-finger pinch).
  for (const k in homeKeys) homeKeys[k] = false;
  try { clearPinchPointers(); } catch (e) { /* ignore */ }
  // Keep the stored player position in step, or the next frame's
  // beginPlayerFrame teleports the camera back to the old spot and
  // undoes the reset.
  try { setPlayerPos(homeStart.x, homeStart.z); } catch (e) { /* ignore */ }
}
// The Reset view button is wired per act (game.js, act2.js, act3.js);
// the prologue runs under home.js, so it needs its own wiring, or the
// button does nothing while the prologue is showing.
if (typeof document !== 'undefined' && document.getElementById('resetViewBtn')) {
  document.getElementById('resetViewBtn').addEventListener('click', () => { try { homeResetView(); } catch (e) { /* ignore */ } });
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
    // An entrance door (action 'lobby') opens into the building's lobby.
    const door = hit.object.userData.doorRef;
    if (door && door.action === 'lobby') { goToLobby(homeKind, door); return; }
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
  } else if (action === 'terminalCarDoor') {
    // The parked car at the terminal front: tap the door to open it and
    // step out, the same as the mission parking lots.
    getOutOfTerminalCar();
  } else if (action === 'terminalGlassDoor') {
    // The revolving glass doors at the front: tap them to open.
    openTerminalGlassDoor();
  } else if (action === 'serviceDesk') {
    // The staffed service desk: tap it to buy the train ticket.
    buyTrainTicket();
  } else if (action === 'marketVendor') {
    // The Market Street vendor: tap him to hear his greeting.
    greetMarketVendor();
  } else if (action === 'staff') {
    // A professional at their post: tap to talk.
    greetStaff(hit.object.userData.staffRole || 'Staff', hit.object.userData.staffLine || 'Can I help you?', hit.object.userData.staffVoice);
  } else if (action === 'doctor') {
    // The hospital doctor: tap to be treated (10 ZAMA).
    offerTreatment();
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
  // A NaN (a bad event coordinate, a synthetic drag) would pass straight
  // through Math.min/Math.max and wedge the pitch forever: every later
  // drag keeps producing NaN and the camera can never be levelled again.
  // Reset a non-finite angle to level before clamping.
  if (!isFinite(homeYaw)) homeYaw = 0;
  if (!isFinite(homePitch)) homePitch = 0;
  homePitch = Math.max(-1.5, Math.min(1.5, homePitch));
  homeLx = e.clientX; homeLy = e.clientY;
});
function homeEndDrag() { homeDragging = false; phoneDown = false; }
let homeLastTapAt = 0;
canvas.addEventListener('pointerup', (e) => {
  const wasPhoneDown = phoneDown;
  homeEndDrag();
  // Releasing a press that started on the phone answers the call, so a
  // swipe across the phone's green button works as well as a tap.
  if (wasPhoneDown) { answerPhone(); return; }
  // Tap fallback: some harnesses and touch inputs deliver press and
  // release without a click event on the canvas, so a tap on a door
  // or the desk did nothing at all. A release that was not a drag is
  // a tap here; the click handler below dedupes against this stamp.
  // A drag must never become a tap: stamp homeLastTapAt when
  // rejecting, or the click that follows every pointerup sees
  // homeDragMoved reset to 0 and fires a phantom tap at the release
  // point (the act2 phantom-tap bug, same fix).
  if (!homeActive) return;
  if (homeDragMoved > 6) { homeDragMoved = 0; homeLastTapAt = Date.now(); return; }
  homeDragMoved = 0;
  if (Date.now() - homeLastTapAt < 400) return;
  homeLastTapAt = Date.now();
  homeHandleTap(e.clientX, e.clientY);
});
canvas.addEventListener('pointercancel', homeEndDrag);
addEventListener('pointerup', homeEndDrag);
// A keyup lost to a focus change would leave a movement key stuck on
// forever (W cancelled by a phantom S reads as "cannot move, reload
// required"): drop every held key when the window loses focus. The
// prologue drive keys and pedals too: a stuck brake there holds the
// car at a standstill while the drive timer runs on.
addEventListener('blur', () => { homeEndDrag(); for (const k in homeKeys) homeKeys[k] = false; homeSuppressedKeys.clear(); plDriveKeys = {}; plDrivePedalGas = false; plDrivePedalBrake = false; });
canvas.addEventListener('click', (e) => {
  if (!homeActive) return;
  if (homeDragMoved > 6) { homeDragMoved = 0; return; }
  homeDragMoved = 0;
  if (Date.now() - homeLastTapAt < 400) return; // already handled by pointerup
  homeLastTapAt = Date.now();
  homeHandleTap(e.clientX, e.clientY);
});
addEventListener('keydown', (e) => {
  if (!homeActive) return;
  const k = e.key.toLowerCase();
  if (homeSuppressedKeys.has(k)) return;
  homeKeys[k] = true;
  // Seated at the terminal front, the movement keys step him out
  // first (the key is then suppressed, so he stands beside the car
  // until he presses it afresh).
  if (terminalSeated && (k === 'w' || k === 'a' || k === 's' || k === 'd' || k === 'e')) getOutOfTerminalCar();
  if (k === 'r') homeResetView();
});
addEventListener('keyup', (e) => {
  if (!homeActive) return;
  const k = e.key.toLowerCase();
  homeKeys[k] = false;
  homeSuppressedKeys.delete(k);
});
addEventListener('resize', () => {
  if (!homeActive || !homeCamera) return;
  homeCamera.aspect = innerWidth / innerHeight; homeCamera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});
