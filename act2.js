import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { canvas, renderer, disposeScene, showFrameErrorBanner, healMorphsIfDirty, healMorphInfluences } from './core.js';
import { speakLine, stopSpeaking, initVoiceUI } from './speak.js';
import { registerHumans, updateSpeakingGestures } from './gestures.js';
import { registerLipSyncHumans } from './lipsync.js';
import { initSoundUI, setAmbient, setAmbientLevel, setTension, soundTick, sfxRepair, sfxTick, sfxPowerRestored, sfxBoom, sfxThud, sfxWhoosh } from './sound.js';
import { runQTE, runHoldQTE } from './qte.js';
import { initZamaUI } from './zama.js';
import { showActionBanner, hideActionBanner, showTrekGuide, hideTrekGuide, updateTrekGuide, flashScreen, dist2D, makeActionMarker, showBriefing, makePedestrian, updatePedestrian, makeCrowd } from './action.js';
import { makeRiggedPerson, updateRiggedPerson, getCrowdModels, onCrowdReady, applyLook, atlasImageReady } from './crowd.js';
import { grantPayout, openStore, getEquippedCarDef, getBalance, moneyFmt, spendMoney, getFuel, consumeFuelMiles } from './economy.js';
import { moveDelta, applyPlayerPresence, beginPlayerFrame, setPlayerPos, getPlayerPos, buildCar, buildPlayerCar, hasKey, giveKey, getAvatar, setAvatarPose, detachAvatar, getZoom, setThirdPerson, resolveMove, addBoxCollider, clearPinchPointers } from './player.js';
// THE LAST SIGNAL - Act II: City of Wires - 3D prototype
// Three missions from the script (short original dialogue in its spirit;
// no long verbatim copying): 1. The Delaware Line (Rondout Reservoir),
// 2. The Grid (Con Edison substation), 3. The Verrazzano (bridge, night).
// Trust, System Integrity and the Act I sealed choice carry over from
// localStorage (saved by Act I); defaults apply when played standalone.
// Single-page lifecycle (see acts.js): this module boots on import, and
// the act manager calls stopAct() before the next act loads. actActive
// gates the animate loop and input handlers so a stopped act cannot keep
// rendering or responding. It starts true because import is the start.
let actActive = true;
let actRaf = 0;
let act1 = { trust: 6, integrity: { Transit: 80, Water: 75, Power: 70, Comms: 40 }, sealedChoice: null, inventory: [], boardFound: false };
try {
  const saved = JSON.parse(localStorage.getItem('lastSignalAct1') || 'null');
  if (saved) act1 = { trust: saved.trust ?? 6, integrity: saved.integrity || act1.integrity, sealedChoice: saved.sealedChoice || null, inventory: saved.inventory || [], boardFound: !!saved.boardFound };
} catch (e) { /* private mode: defaults */ }
const state = {
  trust: act1.trust,
  integrity: { Transit: act1.integrity.Transit ?? 80, Water: act1.integrity.Water ?? 75, Power: act1.integrity.Power ?? 70, Comms: act1.integrity.Comms ?? 40 },
  inventory: act1.inventory.slice(),
  sealedChoice: act1.sealedChoice,
  mission: 1, stage: 'intro', bridgePath: 'undecided', evidence: act1.boardFound ? ['RESET board (Act I)'] : [],
  yaw: 0, pitch: 0, climbStep: 0, derrickDown: false, bombDisarmed: false, waterStable: false
};
const OBJ1 = [
  'Reach the Rondout control station - talk to Caleb: get out of the car, walk to Caleb',
  'Enter the valve room through the station door: take the key beside the door, click the door handle',
  'Balance the pressure: all three lines to 70% or more - click the valve wheels to raise each line',
  'Choose which line runs reduced for 2 hours - pick a choice',
  'Find the sabotage device - who built it? Click the device under the staircase'
];
const OBJ2 = [
  'Get past the guards - Caleb talks, Jade feeds him the jargon: walk up to the guards',
  'Find the key card and the passphrase: click the key card on the guard belt, read the log book',
  'Reroute the load before the logic bomb trips at 8:00 PM: click the SCADA terminal, set the feeders to total 100',
  'Read what was left on the wall: click the manifesto on the wall'
];
const OBJ3 = [
  'Climb the maintenance catwalk to the upper deck: click the planks, then press and hold',
  'Cross the gap - Caleb freezes: press SPACE or tap the prompt, then choose',
  'Face Derrick Shaw on the bridge: click Derrick Shaw',
  'Bring him down without breaking the bridge: pick a choice in the talk'
];
function setObjectives(list, doneCount) {
  document.getElementById('objList').innerHTML = list.map((o, i) =>
    `<li class="${i < doneCount ? 'done' : ''}">${o}</li>`).join('');
}
function updateHUD() {
  document.getElementById('trustBar').style.width = (state.trust * 10) + '%';
  document.getElementById('trustVal').textContent = state.trust + ' / 10';
  document.getElementById('intTransit').style.width = state.integrity.Transit + '%';
  document.getElementById('intWater').style.width = state.integrity.Water + '%';
  document.getElementById('intPower').style.width = state.integrity.Power + '%';
  document.getElementById('intComms').style.width = state.integrity.Comms + '%';
  document.getElementById('invList').textContent = state.inventory.length ? state.inventory.join(', ') : '- empty -';
}
let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.style.opacity = 1;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.opacity = 0; toastTimer = null; }, 4000);
}
function trust(n, why) { state.trust = Math.max(0, Math.min(10, state.trust + n)); updateHUD(); toast((n > 0 ? 'Trust +' + n : 'Trust ' + n) + (why ? ' - ' + why : '')); }
function integrity(key, n) { state.integrity[key] = Math.max(0, Math.min(100, state.integrity[key] + n)); updateHUD(); }
let dlgQueue = [], dlgCb = null;
// Dialogue advances by itself: a plain line moves on once it has been
// spoken (or read, when the voice is muted or unavailable), after a short
// pause. Choice lines still wait for the player to pick an option. The
// Continue button stays as a skip: clicking it calls nextLine(), which
// cancels any pending auto-advance below, so the game never
// double-advances.
let dlgToken = 0; // invalidates a pending auto-advance when a line is skipped, a choice is picked, or the dialogue closes
let dlgTimer = null; // the pending auto-advance timer (the short pause after a line finishes)
function showDialogue(lines, cb) {
  dlgQueue = lines.slice(); dlgCb = cb || null; nextLine();
}
function nextLine() {
  // Any pending auto-advance belongs to the line being left: cancel it.
  // Skip, choice and auto-advance all funnel through here, so this one
  // spot keeps the queue from ever advancing twice for one line.
  dlgToken++;
  if (dlgTimer) { clearTimeout(dlgTimer); dlgTimer = null; }
  const box = document.getElementById('dialogue');
  if (!dlgQueue.length) { box.classList.add('hidden'); stopSpeaking(); if (dlgCb) { const f = dlgCb; dlgCb = null; f(); } return; }
  const line = dlgQueue.shift(); box.classList.remove('hidden');
  document.getElementById('dlgName').textContent = line.who;
  document.getElementById('dlgText').textContent = line.text;
  const ch = document.getElementById('dlgChoices'); ch.innerHTML = '';
  const next = document.getElementById('dlgNext');
  if (line.choices) {
    next.style.display = 'none';
    line.choices.forEach(c => {
      const b = document.createElement('button'); b.textContent = c.label;
      b.onclick = () => { if (c.effect) c.effect(); nextLine(); };
      ch.appendChild(b);
    });
    speakLine(line.who, line.text); // choice lines wait for the player, no auto-advance
  } else {
    next.style.display = 'inline-block';
    // Plain line: move on by itself once spoken (or read), after a short
    // natural pause. The token guard stops a late voice callback from
    // advancing after the player already skipped ahead.
    const myToken = dlgToken;
    speakLine(line.who, line.text, () => {
      if (myToken !== dlgToken) return;
      if (dlgTimer) clearTimeout(dlgTimer);
      dlgTimer = setTimeout(() => {
        dlgTimer = null;
        if (myToken !== dlgToken) return;
        nextLine();
      }, 500);
    });
  }
}
document.getElementById('dlgNext').onclick = nextLine;

// ---------- Procedural textures ----------
function canvasTexture(w, h, draw, rx, ry) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx || 1, ry || 1);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function speckle(ctx, w, h, n, color, alpha, maxR) {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = Math.random() * alpha; ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(Math.random() * w, Math.random() * h, 0.5 + Math.random() * (maxR || 3), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function glowTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
}
const GLOW_TEX = glowTexture();
// Shrink a sign's font until the text fits its board: the old fixed
// 52px clipped any text wider than the 512px board, so "GRAND CENTRAL -
// ENTRANCE" read as "AND CENTRAL - ENTRAN" and "RENTAL CAR - 0.05 ZAMA"
// lost both ends. Every sign drawn through this helper now fits.
function fitSignFont(ctx, text, maxWidth, startPx, weight) {
  let px = startPx;
  ctx.font = weight + px + 'px Arial';
  while (px > 12 && ctx.measureText(text).width > maxWidth) {
    px -= 2;
    ctx.font = weight + px + 'px Arial';
  }
  return px;
}
function signTexture(text, bg, fg, sub) {
  return canvasTexture(512, 128, (ctx, w, h) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg; ctx.textAlign = 'center';
    fitSignFont(ctx, text, w - 24, 52, 'bold ');
    ctx.fillText(text, w / 2, 62);
    if (sub) { fitSignFont(ctx, sub, w - 24, 26, ''); ctx.fillText(sub, w / 2, 102); }
    ctx.textAlign = 'left';
  });
}
// A floating text sprite (a label) from signTexture, for shop names and
// street signs. Transparent background, so only the text shows. Returns
// a THREE.Sprite; the caller sets its scale and position.
function makeTextSprite(text, color) {
  const tex = signTexture(text, 'rgba(0,0,0,0)', color || '#ffd166', '');
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
}
function pressureDialTexture(label) {
  // Round cream dial face for a real pressure gauge: tick marks and
  // numbers from 0 to 100 PSI, a red zone at 80-100, and the line name
  // at the bottom. 0 sits at 7:30 and 100 at 4:30 (270 degrees of sweep),
  // matching the needle angle in updatePressureGauges.
  return canvasTexture(256, 256, (ctx, w, h) => {
    const cx = 128, cy = 128;
    const rad = d => d * Math.PI / 180;
    const tickAngle = p => rad(-135 + (p / 100) * 270); // clockwise from 12 o clock
    const arcAngle = p => tickAngle(p) - Math.PI / 2; // canvas arc is from +x
    ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(cx, cy, 128, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f2ead8'; ctx.beginPath(); ctx.arc(cx, cy, 118, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#c02020'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(cx, cy, 100, arcAngle(80), arcAngle(100)); ctx.stroke();
    ctx.fillStyle = '#1a1a1a'; ctx.strokeStyle = '#1a1a1a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let p = 0; p <= 100; p += 5) {
      const a = tickAngle(p), major = p % 25 === 0;
      const r1 = major ? 88 : 96, r2 = 104;
      ctx.lineWidth = major ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
      ctx.lineTo(cx + Math.sin(a) * r2, cy - Math.cos(a) * r2);
      ctx.stroke();
      if (major) {
        ctx.font = 'bold 34px Arial';
        ctx.fillText(String(p), cx + Math.sin(a) * 64, cy - Math.cos(a) * 64);
      }
    }
    ctx.font = 'bold 26px Arial'; ctx.fillText('PSI', cx, cy + 42);
    ctx.font = 'bold 26px Arial'; ctx.fillText(label, cx, cy + 68);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  });
}
// Live 3D pressure gauges (one per valve line). The needle and the water
// flow follow pressures[key] every frame, so the panel always shows the
// live pressure: the needle eases toward it, and the sight-glass flow
// runs fast and bright at full pressure and slow and dim when a line
// drifts down. Built once per line in buildMission1.
const pressureGauges = {};
function buildPressureGauge(v) {
  // Round gauge on the back wall, above its valve wheel: steel drum body,
  // brass rim, glass face, numbered dial, and a red needle.
  const g = new THREE.Group();
  g.position.set(v.x, 2.3, -5.8);
  mission1.add(g);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.1, 32), stdMat({ color: 0x3a3f44, metalness: 0.7, roughness: 0.4 }));
  body.rotation.x = Math.PI / 2; body.position.z = -0.03; g.add(body);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 12, 40), new THREE.MeshStandardMaterial({ color: 0xb08d3e, metalness: 0.9, roughness: 0.3 }));
  rim.position.z = 0.04; g.add(rim);
  // The dial face is UNLIT (MeshBasicMaterial): the lit standard material
  // depended on the room point lights, so the gauge on the far side of
  // the panel fell into shadow and rendered almost black, with the glass
  // glare reading as a white starburst. Unlit, the cream face and the
  // numbers read at full brightness from anywhere in the room.
  const dial = new THREE.Mesh(new THREE.CircleGeometry(0.40, 40), new THREE.MeshBasicMaterial({ map: pressureDialTexture(v.label) }));
  dial.position.z = 0.02; g.add(dial);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.40, 40), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0.1 }));
  glass.position.z = 0.06; g.add(glass);
  const needle = new THREE.Group(); needle.position.z = 0.05; g.add(needle);
  const pointer = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.34, 0.012), new THREE.MeshStandardMaterial({ color: 0xc02020, roughness: 0.4 }));
  pointer.position.y = 0.13; needle.add(pointer);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), stdMat({ color: 0x2a2a2a, metalness: 0.7, roughness: 0.4 }));
  hub.rotation.x = Math.PI / 2; hub.position.z = 0.05; g.add(hub);
  // Vertical copper pipe from the gauge down to the valve, with a glass
  // sight tube in the middle so the water inside is visible.
  const copper = new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.85, roughness: 0.35 });
  const lowerPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 12), copper);
  lowerPipe.position.set(v.x, 0.8, -5.78); mission1.add(lowerPipe);
  const sight = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.8, 12), new THREE.MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1 }));
  sight.position.set(v.x, 1.45, -5.78); mission1.add(sight);
  const upperPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 12), copper);
  upperPipe.position.set(v.x, 1.9, -5.78); mission1.add(upperPipe);
  // Water column inside the sight glass, and the moving flow beads.
  const waterMat = new THREE.MeshBasicMaterial({ color: 0x2f9fe8, transparent: true, opacity: 0.5 });
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.78, 10), waterMat);
  column.position.set(v.x, 1.45, -5.78); mission1.add(column);
  const flowMat = new THREE.MeshBasicMaterial({ color: 0x7ac7f0, transparent: true, opacity: 0.6 });
  const flow = [];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), flowMat);
    s.position.set(v.x, 1.1, -5.78); mission1.add(s); flow.push(s);
  }
  // Live digital readout beside the dial: a dark panel with the PSI
  // number, redrawn from a canvas texture whenever the shown pressure
  // changes by 1. Unlit, so it reads from anywhere in the room.
  const readoutCanvas = document.createElement('canvas');
  readoutCanvas.width = 256; readoutCanvas.height = 96;
  const readoutCtx = readoutCanvas.getContext('2d');
  const readoutTex = new THREE.CanvasTexture(readoutCanvas);
  readoutTex.colorSpace = THREE.SRGBColorSpace;
  const readoutPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.22), new THREE.MeshBasicMaterial({ map: readoutTex }));
  readoutPanel.position.set(0.68, 0, 0.03); g.add(readoutPanel);
  const readout = { canvas: readoutCanvas, ctx: readoutCtx, tex: readoutTex };
  drawGaugeReadout({ readout, lastPsi: 60 }, 60);
  return { needle, shown: 60, last: 60, spin: 0, angle: 0, wheel: null, spokes: [], flow, flowMat, waterMat, column, readout, lastPsi: 60 };
}
// Redraws one gauge's digital readout: big digits, green at or above the
// 70 PSI target, amber below it, red when a line is nearly dry.
function drawGaugeReadout(rec, psi) {
  const { ctx, tex } = rec.readout;
  ctx.fillStyle = '#0d0d0d'; ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, 252, 92);
  ctx.fillStyle = psi >= 70 ? '#2aff7a' : psi >= 40 ? '#ffb020' : '#ff4444';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 52px Arial';
  ctx.fillText(psi + ' PSI', 128, 50);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  tex.needsUpdate = true;
}
function updatePressureGauges(dt, t) {
  for (const k of Object.keys(pressureGauges)) {
    const rec = pressureGauges[k];
    if (!rec || !rec.needle) continue;
    const target = pressures[k];
    // The needle eases toward the live pressure instead of snapping.
    rec.shown += (target - rec.shown) * Math.min(1, dt * 4);
    rec.needle.rotation.z = (135 - (rec.shown / 100) * 270) * Math.PI / 180;
    // Live digital readout: redraw when the shown PSI changes by 1, so
    // the number follows a valve turn at once and a sabotage drop as it
    // happens.
    const psi = Math.round(rec.shown);
    if (rec.readout && psi !== rec.lastPsi) { rec.lastPsi = psi; drawGaugeReadout(rec, psi); }
    // Sight-glass water column: its HEIGHT follows the pressure, so a
    // dropping line is visible as the water level falling. The bottom
    // stays at the base of the tube (y 1.06) while the top rises and
    // falls: tall near the top of the tube at 100, a stub at the bottom
    // at 0. The flow beads travel inside the water column, not above it.
    if (rec.column) {
      const frac = Math.max(0.02, rec.shown / 100);
      rec.column.scale.y = frac;
      rec.column.position.y = 1.06 + 0.39 * frac;
    }
    // The wheel turns when its valve is turned (pressure changes either
    // way: up by the player, down by the sabotage overcorrection).
    if (target !== rec.last) rec.spin += (target - rec.last) * 0.12;
    rec.last = target;
    rec.spin *= Math.pow(0.4, dt);
    rec.angle += rec.spin * dt;
    if (rec.wheel) rec.wheel.rotation.z = rec.angle;
    for (let i = 0; i < rec.spokes.length; i++) rec.spokes[i].rotation.z = i * Math.PI / 3 + rec.angle;
    // Water flow in the sight glass: fast and bright at full pressure,
    // slow and dim when the line drifts down.
    const speed = 0.12 + (rec.shown / 100) * 0.5; // cycles per second
    if (rec.flowMat) rec.flowMat.opacity = 0.3 + (rec.shown / 100) * 0.7;
    if (rec.waterMat) rec.waterMat.opacity = 0.25 + (rec.shown / 100) * 0.55;
    for (let i = 0; i < rec.flow.length; i++) {
      const s = rec.flow[i];
      const ph = (i / rec.flow.length + t * speed) % 1;
      s.position.y = 1.08 + ph * 0.74 * Math.max(0.05, rec.shown / 100);
    }
  }
}

// ---------- Renderer / scene ----------
// Renderer and canvas are shared with the other acts (see core.js): one
// WebGL context for the whole single-page game. This act sets only its
// own exposure on the shared renderer.
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1218);
scene.fog = new THREE.FogExp2(0x0a1218, 0.02);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 1.7, 8);
const ambient = new THREE.AmbientLight(0xbfc8d4, 0.5); scene.add(ambient);
const hemi = new THREE.HemisphereLight(0x9db8d4, 0x2a2418, 0.5); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 1.6); sun.position.set(12, 20, 8);
sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); scene.add(sun);
const moon = new THREE.DirectionalLight(0x8fa8ff, 0.0); moon.position.set(-10, 18, -6); scene.add(moon);
function stdMat(opts) { return new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.8, metalness: 0.05 }, opts)); }
function box(parent, w, h, d, color, x, y, z, name, matOpts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matOpts ? stdMat(matOpts) : stdMat({ color }));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  if (name) { m.name = name; m.userData.clickable = true; }
  parent.add(m); return m;
}
function blobShadow(parent, x, z, sx, sz, opacity) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: GLOW_TEX, color: 0x000000, transparent: true, opacity: opacity || 0.5, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.06, z); m.scale.set(sx, sz, 1); parent.add(m); return m;
}
// Mission groups: only one visible at a time.
const mission1 = new THREE.Group(); scene.add(mission1);
// Rondout station sits 300 m south of the water facility in its own
// sub-group, so from the platform the facility is beyond the camera
// far plane (200) and cannot be seen: the rental drive is a real
// drive, not a walk across a shared field. Station geometry is built
// in local coordinates and shifted by this offset.
const STATION_DZ = 300;
const stationGroup = new THREE.Group(); stationGroup.position.z = STATION_DZ; mission1.add(stationGroup);
const mission2 = new THREE.Group(); scene.add(mission2); mission2.visible = false;
const mission3 = new THREE.Group(); scene.add(mission3); mission3.visible = false;
// Camera bounds per mission (x/z clamp + default view).
const VIEWS = {
  1: { pos: [0, 1.7, 8], yaw: 0, x: [-8, 11.5], z: [-6, 14] },
  2: { pos: [0, 1.7, 9], yaw: 0, x: [-9, 9], z: [-6, 12] },
  3: { pos: [0, 2.2, 10], yaw: 0, x: [-1.2, 1.2], z: [-14, 12] }
};
let camBounds = VIEWS[1];
// Act II arrival: the player steps off the train at Rondout station,
// 300 m south of the water facility (see STATION_DZ), and takes the
// rental car before Mission 1 starts. The platform is at the south
// end of the station ground (local z 11 to 13.6), so the arrival
// spawn faces the train (yaw PI looks south, +z) and the trigger
// line is local z 7 on the dirt track. World positions add
// STATION_DZ to the local station coordinates.
const ARRIVAL_VIEW = { pos: [-3.9, 1.7, 312.3], yaw: Math.PI };
// Camera bounds while he is at the station, before Mission 1 starts:
// VIEWS[1] shifted by STATION_DZ (platform world z 311 to 313.6, the
// rental car at world z 309, the track bed at 315.3 just outside).
const STATION_VIEW = { pos: ARRIVAL_VIEW.pos, yaw: Math.PI, x: [-8, 11.5], z: [294, 314] };
let arrivalDone = false; // true once the player has walked off the platform
let mission1Started = false; // true once startMission1 has run
// The rental car at Rondout station: a plain sedan he rents for 0.05 ZAMA
// and drives to the water facility. The mission briefing starts only
// after that drive.
let stationRental = null; // { group, hit, label } built at the station, removed on take
let rentalTaken = false; // true once he has taken the rental car
let arrivedByRental = false; // the rental drive just ended; park the rental at the facility
let travelRental = false; // the drive in progress is the rental car, not his own car
let rentalExtraCar = null; // his own car in the second bay while the rental takes the first
let rentalToastAt = -10; // throttle for the walk-up rental toast
let takeRentalBtnEl = null;
// The dam the water is piped from: the concrete wall stands on the west
// side at x -14, and the roar of its spillway is the Mission 1 ambient.
// DAM_X/DAM_Z is the roar source point for the distance level.
const DAM_X = -14, DAM_Z = 0, DAM_WATER_Y = 7.6;
let lastDamLevel = -1; // last roar level sent to setAmbientLevel
// ---------- Parking: a marked bay at each mission, where the player's car sits ----------
// The player drives to a destination and the car pulls into a real parking
// space there, it does not stop on the highway and vanish. Each mission
// has one marked lot (paved pad, white bay lines, a P sign, a curb): the
// lot in front of the skyscraper lobby (Mission 1), the lot in the
// substation yard forecourt (Mission 2), and the lot by a small garden
// beside the bridge approach (Mission 3). The player's equipped car is
// parked in the lot whenever the mission is active, on drive arrival and
// on any other entry, so the scene is consistent. No rooftop ramp: there
// is no drivable ramp to a roof, so front-of-building and garden cover
// the brief.
// PARKING[mission]: cx/cz is the lot centre, carX/carZ is the player's
// bay (one of the two bays), carRotY faces the car at the building (-z is
// north, toward the lobby / control room / bridge), driveSpawn is where
// the player stands after getting out on a drive arrival (null means the
// normal mission spawn is used).
const PARKING = {
  // driveSpawn west of the rental, not between the two cars: the
  // rental parks at carX 6.9 and his own car beside it at cx + 1.4
  // (9.7), so the old spots on the centre line (x 8.3) put him in
  // the 0.9 m gap between them - first inside the overlap of the
  // two car colliders with WASD dead, then at the gap's south end
  // still reading as wedged between the cars with the door open
  // into the gap. West of the rental (x 5.2, clear of its west
  // face at 5.98 by more than his radius) is open ground with a
  // straight walk north to the facility door.
  1: { cx: 8.3, cz: 4.25, carX: 6.9, carZ: 4.25, carRotY: Math.PI, driveSpawn: { x: 5.2, z: 5.6, yaw: 0 } },
  // Mission 2 lot: cz is 7.0, not 9.0. The seated camera sits about 4.2 m
  // behind the parked car, and at cz 9.0 it landed south of the yard's
  // south fence (z 12), looking through the fence into a dark yard with
  // no lot, building or guards in view. At cz 7.0 the camera lands at z
  // about 11.2, inside the yard.
  2: { cx: -5.7, cz: 7.0, carX: -4.3, carZ: 7.0, carRotY: Math.PI, driveSpawn: { x: -1.8, z: 7.0, yaw: 0 } },
  3: { cx: 6.0, cz: 11.85, carX: 4.6, carZ: 11.85, carRotY: Math.PI, driveSpawn: null }
};
let arrivedByDrive = false; // true while the mission start that follows a drive runs
const parkedCars = {}; // mission number -> parked car group in that mission's scene
// Where the player's car is parked, by place key: a mission place
// (reservoir / substation / bridge, set by parkPlayerCar) or the
// destination of a drive arrival (set by arriveAt / showArrivalBeat).
// lotCarPlaceKey is the place whose car waits in the shared arrival
// lot; atParkedLot is true while the player stands in that lot beside
// his car after coming out of an interior (the return beat).
let parkedPlaceKey = null;
let lotCarPlaceKey = null;
let atParkedLot = false;
function disposeCarGroup(g) {
  if (!g) return;
  try { if (g.parent) g.parent.remove(g); } catch (e) { /* ignore */ }
  try {
    g.traverse(m => {
      try { if (m.geometry) m.geometry.dispose(); } catch (e) { /* ignore */ }
      try {
        const mats = Array.isArray(m.material) ? m.material : (m.material ? [m.material] : []);
        for (const mm of mats) { try { mm.dispose(); } catch (e) { /* ignore */ } }
      } catch (e) { /* ignore */ }
    });
  } catch (e) { /* ignore */ }
}
// A two-bay lot: paved pad, white bay lines, a low curb along the back,
// and a P sign on a post at the head of the player's bay. The bays run
// north-south and the cars face north (-z), at the building. carX is the
// centre of the player's bay. signRotY faces the sign at the player:
// south (0) for Missions 1 and 2, west (-PI/2) for Mission 3, where the
// player stands on the deck to the west of the lot.
function buildParkingLot(parent, cx, cz, carX, signRotY) {
  // Lighter than the yard ground (0x3a3f42) so the pad reads as a
  // marked lot at dusk instead of blending into the dirt around it.
  const asphalt = stdMat({ color: 0x4a4e54, roughness: 0.95 });
  const pad = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.06, 5.7), asphalt);
  pad.position.set(cx, 0.03, cz); pad.receiveShadow = true; parent.add(pad);
  // White bay lines: west edge, centre divider, east edge, all running
  // north-south, so the two bays read as marked spaces.
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
  for (const lx of [cx - 2.8, cx, cx + 2.8]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 5.7), lineMat);
    line.position.set(lx, 0.07, cz); parent.add(line);
  }
  // Low concrete curb along the back (north) edge of the lot.
  const curb = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.16, 0.3), stdMat({ color: 0x8a8a86, roughness: 0.95 }));
  curb.position.set(cx, 0.08, cz - 2.7); curb.castShadow = true; parent.add(curb);
  // P sign on a post at the head of the player's bay, facing south.
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 8), stdMat({ color: 0x6a747a, metalness: 0.7, roughness: 0.4 }));
  post.position.set(carX, 1.1, cz - 2.55); post.castShadow = true; parent.add(post);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshBasicMaterial({ map: signTexture('P', '#1a4a8a', '#ffffff', 'PARKING') }));
  sign.position.set(carX, 2.45, cz - 2.55); sign.rotation.y = signRotY || 0; parent.add(sign);
}
// A small garden beside the Mission 3 lot: an approach apron under the
// lot and garden (the bridge has no ground plane, only the deck, so the
// lot would float without it), a lawn, a hedge, two trees, a bench and
// bushes, so the bridge approach reads as a planted place, not bare deck.
function buildBridgeGarden(parent) {
  const apron = new THREE.Mesh(new THREE.BoxGeometry(12, 0.4, 10), stdMat({ color: 0x5a5e60, roughness: 0.95 }));
  apron.position.set(8, -0.2, 11.75); apron.receiveShadow = true; parent.add(apron);
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 6.8), stdMat({ color: 0x4a6a34, roughness: 1 }));
  lawn.rotation.x = -Math.PI / 2; lawn.position.set(11.1, 0.02, 11.75); lawn.receiveShadow = true; parent.add(lawn);
  const hedge = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 6.8), stdMat({ color: 0x2e5a2a, roughness: 1 }));
  hedge.position.set(13.0, 0.35, 11.75); hedge.castShadow = true; parent.add(hedge);
  for (const [tx, tz] of [[10.2, 9.5], [12.2, 14.0]]) {
    try {
      const tree = makeStreetTree();
      tree.position.set(tx, 0, tz); parent.add(tree);
    } catch (e) { /* tree is decoration */ }
  }
  const benchSeat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.45), stdMat({ color: 0x6a4a30, roughness: 0.9 }));
  benchSeat.position.set(10.5, 0.5, 12.8); parent.add(benchSeat);
  const benchBack = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 0.08), stdMat({ color: 0x6a4a30, roughness: 0.9 }));
  benchBack.position.set(10.5, 0.75, 13.0); parent.add(benchBack);
  for (const [bx, bz] of [[9.6, 14.2], [12.4, 9.0]]) {
    const bush = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), stdMat({ color: 0x3a6a2e, roughness: 1 }));
    bush.position.set(bx, 0.4, bz); bush.castShadow = true; parent.add(bush);
  }
}
// Park the player's equipped car in a mission's lot. Rebuilds it each
// time the mission starts, so a car bought since the last visit shows up
// and the colour and model are always the equipped ones. The parked car
// lives in the mission's group, so it stays visible while the mission
// runs and hides with the group when another mission starts. It is a
// separate car from the drive car in travelGroup, which the drive
// disposes on its own.
function parkPlayerCar(mission) {
  const p = PARKING[mission];
  if (!p) return;
  // The car now waits at this mission's lot: the next drive leaves
  // from here (see the map Drive handler).
  parkedPlaceKey = MISSION_PLACE[mission];
  const group = mission === 1 ? mission1 : mission === 2 ? mission2 : mission3;
  // Rental arrival at the facility: the rental parks in the player's bay
  // and his own car takes the second bay, so seatIfDrove seats him in
  // the car he drove. Consumes the flag here, before seating.
  if (mission === 1 && arrivedByRental) {
    arrivedByRental = false;
    try { disposeCarGroup(parkedCars[1]); } catch (e) { /* ignore */ }
    parkedCars[1] = null;
    try { disposeCarGroup(rentalExtraCar); } catch (e) { /* ignore */ }
    rentalExtraCar = null;
    let rental = null;
    try { rental = buildRentalCar(); } catch (e) { rental = null; }
    if (rental) {
      rental.rotation.y = p.carRotY;
      rental.position.set(p.carX, 0, p.carZ);
      group.add(rental);
      parkedCars[1] = rental;
    }
    let own = null;
    try { own = buildPlayerCar(); } catch (e) { own = null; }
    if (own) {
      own.rotation.y = p.carRotY;
      own.position.set(p.cx + 1.4, 0, p.carZ);
      group.add(own);
      rentalExtraCar = own;
    }
    return;
  }
  try { disposeCarGroup(parkedCars[mission]); } catch (e) { /* ignore */ }
  parkedCars[mission] = null;
  let car = null;
  try { car = buildPlayerCar(); } catch (e) { car = null; }
  if (!car) return;
  car.rotation.y = p.carRotY;
  car.position.set(p.carX, 0, p.carZ);
  group.add(car);
  parkedCars[mission] = car;
}
// After a drive arrival, stand the player beside the parked car instead
// of at the default mission spawn, so he has just got out of the car.
// Mission 1 uses this for the rental drive from Rondout station, and
// Mission 2 for a drive to the substation. Mission 3 has no drive
// spawn: it is reached on foot or by a drive the deck bounds cannot
// hold (the deck is 2.4 m wide), so it keeps its normal spawn and the
// car is simply parked in the lot. Consumes the arrivedByDrive flag.
function applyDriveSpawn(mission) {
  const p = PARKING[mission];
  if (!arrivedByDrive || !p || !p.driveSpawn) { arrivedByDrive = false; return; }
  arrivedByDrive = false;
  camera.position.set(p.driveSpawn.x, VIEWS[mission].pos[1], p.driveSpawn.z);
  // Sync the stored ground position, or the next frame's
  // beginPlayerFrame snaps the player back to his pre-drive spot.
  try { setPlayerPos(p.driveSpawn.x, p.driveSpawn.z); } catch (e) { /* ignore */ }
  state.yaw = p.driveSpawn.yaw; state.pitch = 0; camBounds = VIEWS[mission];
}
// ---------- Open the car door and step outside ----------
// When the player drives to a destination and the car is parked, he does
// not teleport beside it: he starts seated in the parked car with the
// door closed, and steps out by opening the driver's door. The door is a
// real door on the car (a panel with a window and a handle, hinged at its
// front edge, swinging outward), clickable in 3D, and there is also an
// on-screen Get out button while he is seated, so he can never get stuck
// in the car. The door stays open after he steps out.
// parkedSeat is null when the player is on foot; while he is seated in a
// parked car it holds the car, the door, the place he ends up standing,
// and the callback to run once he is out (for an arrival beat, the
// destination action; for a mission, null - the mission just continues).
let parkedSeat = null;
let parkedSeatActive = false;
let doorSwing = null; // { group, t } while a car door is swinging open
let getOutBtnEl = null;
let getOutCbTimer = null; // delayed destination action after stepping out (see getOutOfParkedCar)
function showGetOutButton() {
  if (!getOutBtnEl) {
    getOutBtnEl = document.createElement('div');
    getOutBtnEl.id = 'getOutBtn';
    getOutBtnEl.innerHTML = '<button type="button" id="getOutBtnInner" style="padding:14px 26px;font-size:17px;font-weight:bold;background:#ffd166;color:#111;border:none;border-radius:10px;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,0.5);">Get out of the car</button>';
    getOutBtnEl.style.cssText = 'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:56;text-align:center;pointer-events:auto;';
    document.body.appendChild(getOutBtnEl);
    const inner = document.getElementById('getOutBtnInner');
    // Answer both the click and the raw pointerup: a real press that
    // drifts a few pixels before release can lose its click event, and
    // a lost click here left the player seated with every other input
    // (WASD, drags, Reset, C) ignored by the seated camera branch.
    // getOutOfParkedCar no-ops when not seated, so double-firing is safe.
    inner.onclick = () => { getOutOfParkedCar(); };
    inner.addEventListener('pointerup', () => { getOutOfParkedCar(); });
  }
  getOutBtnEl.style.display = 'block';
}
function hideGetOutButton() { if (getOutBtnEl) getOutBtnEl.style.display = 'none'; }
// A real driver's door on a parked car: a body-coloured panel with a
// window strip and a chrome handle, hinged at its front edge so it
// swings outward, on the driver's side (local -x, where the driver
// sits). The door is sized from the car's own bounding box and the
// driver's seat (headPos), so it fits the sedan, the coupe, the X5 and
// the real M4 model alike. Returns the hinge group, the panel and a
// generous invisible hit box around the door for easy tapping.
function buildCarDoor(car) {
  // Local bounding box: reset the transform, measure, restore. The car
  // is positioned and rotated by parkPlayerCar before this runs.
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
  hinge.name = 'carDoorHinge';
  const panelMat = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.5, metalness: 0.4 });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.05, doorH, doorLen), panelMat);
  panel.position.set(0, doorMidY, -doorLen / 2);
  panel.castShadow = true;
  panel.name = 'carDoor'; panel.userData.clickable = true;
  hinge.add(panel);
  // Window strip on the upper half of the door, so it reads as a car
  // door with glass, not a plain panel.
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x10181f, roughness: 0.15, metalness: 0.7, transparent: true, opacity: 0.55 });
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.02, doorH * 0.32, doorLen * 0.78), glassMat);
  win.position.set(-0.03, doorTop - doorH * 0.2, -doorLen / 2);
  hinge.add(win);
  // Chrome handle near the rear edge (the edge that swings out), at
  // hand height, on the outer face.
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.22), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.25, metalness: 0.9 }));
  handle.position.set(-0.045, 1.0, -doorLen + 0.15);
  hinge.add(handle);
  // Generous invisible hit box around the whole door, so a tap on the
  // door (or just beside it) opens it instead of missing.
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.7, doorLen + 0.4), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.position.set(0, 0.95, -doorLen / 2);
  hit.name = 'carDoor'; hit.userData.clickable = true;
  hinge.add(hit);
  car.add(hinge);
  return { group: hinge, panel, hit };
}
// Seat the player in a parked car, door closed, ready to step out.
// car is the parked car group (already placed in its lot). getOutPos is
// { x, z, yaw } where he ends up standing. onGetOut runs once he is out
// (the destination action for an arrival beat, null for a mission).
// opts.quiet seats him without the Get out button and the parked toast:
// the departure beat, where he is about to drive away from the lot.
function seatPlayerInParkedCar(car, getOutPos, onGetOut, opts) {
  if (!car || !getOutPos) return false;
  const door = buildCarDoor(car);
  const driver = getAvatar();
  try { if (driver.parent) driver.parent.remove(driver); } catch (e) { /* ignore */ }
  setAvatarPose('sit');
  driver.visible = true;
  // Driver's seat, left side, sitting in the cabin at the same 0.62
  // scale as the drive, so his head stays under the cabin roof.
  driver.position.set(-0.38, 0.02, 0.35);
  driver.rotation.set(0, 0, 0);
  driver.scale.set(0.62, 0.62, 0.62);
  car.add(driver);
  parkedSeat = { car, door: door.group, doorHit: door.hit, getOutPos, onGetOut: onGetOut || null, doorOpen: false };
  parkedSeatActive = true;
  // A key held through the drive end (W is the natural one: he holds
  // it to drive) must not step him straight back out on its next
  // repeat: snapshot and clear held keys, so only a fresh press acts.
  suppressHeldKeys();
  // The seated camera orbits with drags (see updateParkedSeatView):
  // start every seat at the default framing, facing the building.
  state.yaw = 0; state.pitch = 0;
  try { setThirdPerson(true); } catch (e) { /* camera is best effort */ }
  if (!(opts && opts.quiet)) {
    showGetOutButton();
    toast('You are parked. Click the car door, or Get out, to step outside.');
  }
  return true;
}
// Open the driver's door and step outside. The door swings open and
// stays open; the player ends up standing beside the car, at full size,
// in third person. Always works while he is seated: the Get out button
// is always visible, and clicking the door does the same thing.
function getOutOfParkedCar() {
  if (!parkedSeatActive || !parkedSeat) return;
  const seat = parkedSeat;
  parkedSeat = null;
  parkedSeatActive = false;
  hideGetOutButton();
  // The key that stepped him out (or one still held from the drive)
  // must not walk him on from the door before he has seen where he
  // is: he stands beside the car until he presses a key afresh, so
  // the briefing finds him at the car, not halfway to the guards.
  suppressHeldKeys();
  // Swing the door open (animated in the animate loop) and leave it open.
  doorSwing = { group: seat.door, t: 0 };
  // Step out: out of the car, on his feet, at full size, standing at
  // the get-out spot beside the driver's door, facing the building.
  try {
    const driver = getAvatar();
    if (driver.parent === seat.car) { try { seat.car.remove(driver); } catch (e) { /* ignore */ } }
    setAvatarPose('stand');
    driver.scale.set(1, 1, 1);
    driver.rotation.set(0, 0, 0);
    driver.visible = true;
    detachAvatar();
  } catch (e) { /* ignore */ }
  // Place him on foot at the get-out spot and sync the player presence
  // (this also resets the stored ground position, so the next frame does
  // not snap the camera back to where he was before the drive).
  try {
    camera.position.set(seat.getOutPos.x, 1.7, seat.getOutPos.z);
    state.yaw = seat.getOutPos.yaw || 0; state.pitch = 0;
    applyPlayerPresence({ scene, camera, x: seat.getOutPos.x, z: seat.getOutPos.z, yaw: state.yaw, pitch: state.pitch, moving: false, moveDx: 0, moveDz: 0, dt: 0.016, t: Date.now() / 1000, eyeY: 1.7 });
  } catch (e) { /* presence is best effort */ }
  const cb = seat.onGetOut;
  if (cb) {
    // The destination action (briefing, store, interior) waits a beat
    // after the step-out, so the player sees the door swing open and
    // himself standing beside the car in the yard before any modal
    // covers the screen. It used to run in the same frame as the
    // step-out, so the modal opened instantly and the player never saw
    // himself get out: it read as the Get out button doing nothing but
    // opening a popup, and he looked stuck in the car. If a dialogue
    // opens in the meantime (he walked straight to a guard), the
    // briefing waits for it to close; after a few tries it is dropped
    // rather than stacking a modal over a dialogue.
    if (getOutCbTimer) { clearTimeout(getOutCbTimer); getOutCbTimer = null; }
    let tries = 0;
    const runCb = () => {
      getOutCbTimer = null;
      if (!actActive) return;
      if (!document.getElementById('dialogue').classList.contains('hidden')) {
        if (tries < 5) { tries++; getOutCbTimer = setTimeout(runCb, 1000); }
        return;
      }
      try { cb(); } catch (e) { /* destination action is best effort */ }
    };
    getOutCbTimer = setTimeout(runCb, 1400);
  }
}
// Chase camera while the player is seated in a parked car: behind and
// to the driver's side, looking PAST the car toward the building it
// faces, so the destination (the substation yard, the hospital, the
// hall) fills the frame instead of the car's roof with the bright
// street beyond it. Dragging orbits the view around the car (state.yaw
// is the orbit offset, state.pitch the height; both reset on seating
// and again on get-out, so the on-foot facing is never affected).
function updateParkedSeatView() {
  if (!parkedSeat || !parkedSeat.car) return;
  const car = parkedSeat.car;
  const pos = new THREE.Vector3();
  car.getWorldPosition(pos);
  const q = new THREE.Quaternion();
  car.getWorldQuaternion(q);
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const side = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);
  const orbit = state.yaw || 0;
  const cosO = Math.cos(orbit), sinO = Math.sin(orbit);
  const dirX = fwd.x * cosO + fwd.z * sinO;
  const dirZ = -fwd.x * sinO + fwd.z * cosO;
  const sideX = side.x * cosO + side.z * sinO;
  const sideZ = -side.x * sinO + side.z * cosO;
  const camY = Math.max(1.3, Math.min(4.2, 2.0 + (state.pitch || 0) * 1.5));
  camera.position.set(pos.x - dirX * 4.2 + sideX * 1.2, camY, pos.z - dirZ * 4.2 + sideZ * 1.2);
  camera.rotation.order = 'YXZ';
  camera.lookAt(pos.x + dirX * 7, 1.3, pos.z + dirZ * 7);
}
// Advance an opening car door: swings from closed to about 66 degrees
// over half a second, then stays open.
function updateDoorSwing(dt) {
  if (!doorSwing || !doorSwing.group) { doorSwing = null; return; }
  doorSwing.t = Math.min(1, doorSwing.t + dt / 0.6);
  const e = 1 - (1 - doorSwing.t) * (1 - doorSwing.t);
  try { doorSwing.group.rotation.y = 1.15 * e; } catch (err) { /* ignore */ }
  if (doorSwing.t >= 1) doorSwing = null;
}
// Station door handle turn, then swing. Touching a handle (click, or
// walking up to the door) turns the lever down over 0.4 s, then the
// door swings open on its hinge over 0.6 s, and only then does the
// player enter or leave. The gates are the same as before: the door
// stays shut before the mission starts and locked without the station
// key. A door that is already open skips the swing and just turns the
// lever before the player passes through.
function tryStationDoor(side) {
  if (stationDoorAnim) return false;
  if (side === 'outside') {
    if (!mission1Started) { toast('Take the rental car to the water facility first - it costs 0.05 ZAMA and is waiting by the platform.'); return false; }
    if (!hasKey('station')) { toast('Locked - needs the station key. It is on the hook beside the door.'); sfxThud(); return false; }
    // He has to be AT the door (1.8 m, the walk-up radius). The gate
    // lives here, not only in the click handler, so every path that
    // can start the door - click, walk-up, anything added later -
    // is refused from across the room. Exit stays key-free; it is
    // not distance-free.
    if (playerDist2D(0, -0.68) > 1.8) { toast('The station door is just ahead - walk to it and use the key.'); return false; }
    stationDoorAnim = { side, phase: 'lever', t: 0, onDone: enterValveRoom };
  } else {
    if (!inValveRoom) return false;
    if (playerDist2D(0, -0.68) > 1.8) { toast('Too far - walk to the door.'); sfxThud(); return false; }
    stationDoorAnim = { side, phase: 'lever', t: 0, onDone: exitValveRoom };
  }
  return true;
}
function updateStationDoorAnim(dt) {
  if (!stationDoorAnim) return;
  const a = stationDoorAnim;
  // One door, one hinge: the station door slab serves both sides, with
  // a brass lever on each face. From outside it swings in (into the
  // room); from inside it swings the other way, out toward the yard.
  const hinge = stationDoorHinge;
  const pivots = stationLeverPivots;
  const alreadyOpen = stationDoorOpen;
  a.t += dt;
  if (a.phase === 'lever') {
    const e = Math.min(1, a.t / 0.4);
    const ang = (Math.PI / 2) * (1 - (1 - e) * (1 - e));
    for (const p of pivots) { if (p) p.rotation.z = ang; }
    if (e >= 1) {
      if (alreadyOpen) {
        // Door is already open: the lever turn is the only feedback,
        // then the player passes through. The camera moves on entry,
        // so the lever returning is not seen.
        const done = a.onDone; stationDoorAnim = null;
        for (const p of pivots) { if (p) p.rotation.z = 0; }
        try { done(); } catch (err) { /* ignore */ }
      } else { a.phase = 'swing'; a.t = 0; }
    }
    return;
  }
  // Swing: the levers spring back up while the door swings open.
  const e = Math.min(1, a.t / 0.6);
  const sw = 1 - (1 - e) * (1 - e);
  const dir = a.side === 'outside' ? 1 : -1;
  if (hinge) hinge.rotation.y = dir * 1.75 * sw;
  for (const p of pivots) { if (p) p.rotation.z = (Math.PI / 2) * (1 - sw); }
  if (e >= 1) {
    stationDoorOpen = true;
    const done = a.onDone; stationDoorAnim = null;
    try { done(); } catch (err) { /* ignore */ }
  }
}
// On a drive arrival, seat the player in the mission's parked car
// instead of standing him beside it. Returns true when he was seated
// (the mission start should not also move him to the drive spawn).
// On any other entry the car is just parked and he spawns normally.
// The flag is only consumed when seating succeeds, so the caller can
// fall back to applyDriveSpawn when the car is missing.
function seatIfDrove(mission, onGetOut) {
  if (!arrivedByDrive) return false;
  const p = PARKING[mission];
  const car = parkedCars[mission];
  if (!p || !p.driveSpawn || !car) return false;
  arrivedByDrive = false;
  return seatPlayerInParkedCar(car, p.driveSpawn, onGetOut || null);
}
// ---------- Parking at every destination: the arrival lot ----------
// The three missions have their own lots. For every other destination
// (a store, a home or visit, a landmark) the drive used to open the
// store UI or the interior at once, and the car vanished. Now a drive
// arrival first shows a small exterior beat: the car parked in a marked
// bay in front of the destination building, with a P sign and the
// building's name over the door. The player starts seated in the car,
// opens the door and steps out, and only then does the store open or the
// interior load. A Skip (no drive) goes straight to the destination, as
// before, and missions keep their own lots.
let arrivalGroup = null;
let arrivalCar = null;
let arrivalSignSprite = null;
let arrivalSavedMissionVis = null;
let arrivalPendingAction = null;
let arrivalFacadeGroup = null; // the destination building, rebuilt per place
// The name over the arrival lot building: a fresh text sprite each time,
// so the building is named for the destination just driven to.
function setArrivalSign(name) {
  if (!arrivalGroup) return;
  if (arrivalSignSprite) { try { arrivalGroup.remove(arrivalSignSprite); } catch (e) { /* ignore */ } arrivalSignSprite = null; }
  const sprite = makeTextSprite((name || 'DESTINATION').toUpperCase(), '#ffd166');
  sprite.scale.set(7, 1.75, 1);
  // 1 m off the facade (front face at z -7), not 0.1: a billboard
  // hugging the wall swings its far edge behind the wall plane at
  // oblique angles, and the depth test clipped the last letters of
  // long names (SYMPOSIUM, FILLING STATION) on the live check.
  sprite.position.set(0, 5.0, -6.0);
  arrivalGroup.add(sprite);
  arrivalSignSprite = sprite;
}
// One shared exterior for every non-mission drive arrival: a ground
// plane, the destination building at the north (its own distinct build
// per place, see buildArrivalFacade) with the destination name over
// the entrance, a marked two-bay lot (reusing buildParkingLot) with the
// car in the west bay facing the building, a street lamp and a tree.
function buildArrivalLot() {
  arrivalGroup = new THREE.Group();
  arrivalGroup.name = 'arrivalLot';
  arrivalGroup.visible = false;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), stdMat({ color: 0x3a3d40, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  arrivalGroup.add(ground);
  // The destination building lives in its own group, rebuilt for each
  // place so every arrival reads as its own building.
  arrivalFacadeGroup = new THREE.Group();
  arrivalFacadeGroup.name = 'arrivalFacade';
  arrivalGroup.add(arrivalFacadeGroup);
  // The marked lot: the car parks in the west bay, facing the building.
  buildParkingLot(arrivalGroup, 0, 2, -1.4);
  // A street lamp over the lot and a tree beside it, for life.
  try { const lamp = makeStreetLight(0, 0); lamp.position.set(4.5, 0, 0.5); arrivalGroup.add(lamp); } catch (e) { /* lamp is decoration */ }
  try { const tree = makeStreetTree(); tree.position.set(-4.5, 0, 0.5); arrivalGroup.add(tree); } catch (e) { /* tree is decoration */ }
  scene.add(arrivalGroup);
}
// Build the destination building for the arrival lot: each place gets
// its own distinct exterior (the symposium a skyscraper, the wind
// tunnel an industrial lab block, and so on - varied height, facade
// material and roofline). Every variant keeps the same contract with
// the verified arrival beat: the front face sits at z -7 and the
// entrance door at (0, 1.3, -6.95), so the destination sign at
// (0, 5.0, -6.0) stays whole and clear of the facade edge, and the
// car parks in the same marked lot in front of it.
function buildArrivalFacade(key) {
  if (!arrivalFacadeGroup) return;
  const g = arrivalFacadeGroup;
  // Clear the previous place's building.
  for (let i = g.children.length - 1; i >= 0; i--) {
    const c = g.children[i];
    g.remove(c);
    try {
      c.traverse(m => {
        try { if (m.geometry) m.geometry.dispose(); } catch (e) { /* ignore */ }
        try {
          const mats = Array.isArray(m.material) ? m.material : (m.material ? [m.material] : []);
          for (const mm of mats) { try { if (mm.map) mm.map.dispose(); mm.dispose(); } catch (e) { /* ignore */ } }
        } catch (e) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
  }
  const box = (w, h, d, color, x, y, z, opts) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), (opts && opts.mat) || stdMat({ color, roughness: (opts && opts.roughness) || 0.9 }));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  };
  const texMat = (base, cols, rows, lit) => {
    const tex = skyscraperFacadeTexture(base, cols, rows, lit);
    return new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.85 });
  };
  const door = (w, h, color) => box(w || 1.6, h || 2.6, 0.12, color || 0x2a3a4a, 0, (h || 2.6) / 2, -6.95, { roughness: 0.6 });
  const winMat = new THREE.MeshStandardMaterial({ color: 0xffd88a, emissive: 0xffc860, emissiveIntensity: 0.5, roughness: 0.4 });
  const wins = (list) => { for (const [wx, wy] of list) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), winMat); w.position.set(wx, wy, -6.95); g.add(w); } };
  if (key === 'symposium') {
    // A tall skyscraper tower in blue glass.
    box(8, 22, 6, 0, 0, 11, -10, { mat: texMat('#2e4a66', 6, 20, 0.35) });
    box(3, 0.3, 1.2, 0x2a3a4a, 0, 3.2, -6.6, { roughness: 0.6 }); // entrance canopy
    door();
  } else if (key === 'windtunnel') {
    // A wide industrial lab block: shed roof, roof vents, big doors.
    box(20, 5, 6, 0x8a8a82, 0, 2.5, -10);
    const roof = box(20, 0.3, 6.5, 0x6a6a62, 0, 5.2, -10); roof.rotation.x = 0.12;
    for (const vx of [-6, 0, 6]) {
      const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.2, 10), stdMat({ color: 0x9aa2a8, roughness: 0.5 }));
      vent.position.set(vx, 5.8, -10); vent.castShadow = true; g.add(vent);
    }
    box(2.2, 3, 0.12, 0x4a5a6a, -3.5, 1.5, -6.95, { roughness: 0.6 });
    box(2.2, 3, 0.12, 0x4a5a6a, 3.5, 1.5, -6.95, { roughness: 0.6 });
    door();
  } else if (key === 'hospital') {
    // A multi-storey white block with a red cross over the entrance.
    box(12, 12, 6, 0, 0, 6, -10, { mat: texMat('#e8ecef', 6, 12, 0.3) });
    box(0.5, 1.6, 0.1, 0xc0392b, 0, 9.5, -6.9, { roughness: 0.6 });
    box(1.6, 0.5, 0.1, 0xc0392b, 0, 9.5, -6.9, { roughness: 0.6 });
    door();
  } else if (key === 'fillingstation') {
    // A forecourt: canopy on posts over two pumps, kiosk behind.
    box(8, 3.5, 4, 0xd8b078, 0, 1.75, -9);
    box(12, 0.3, 6, 0x2e6fb0, 0, 4.2, -4.5, { roughness: 0.7 });
    for (const [px, pz] of [[-5, -6.5], [5, -6.5], [-5, -2.5], [5, -2.5]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.2, 10), stdMat({ color: 0x8a949a, roughness: 0.4 }));
      post.position.set(px, 2.1, pz); post.castShadow = true; g.add(post);
    }
    for (const px of [-2, 2]) box(0.7, 1.5, 0.5, 0xc0392b, px, 0.75, -4, { roughness: 0.6 });
    door();
  } else if (key === 'hotels') {
    // A taller limestone slab with many windows.
    box(10, 14, 6, 0, 0, 7, -10, { mat: texMat('#b8a888', 5, 14, 0.35) });
    box(3, 0.3, 1.2, 0x4a3220, 0, 3.2, -6.6, { roughness: 0.6 });
    door();
  } else if (key === 'airport') {
    // A wide low terminal with a control tower beside it.
    box(22, 5, 6, 0, 0, 2.5, -10, { mat: texMat('#e8ecef', 12, 4, 0.3) });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 14, 12), stdMat({ color: 0xf4f6f8, roughness: 0.7 }));
    tower.position.set(8, 7, -10); tower.castShadow = true; g.add(tower);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 2, 12), stdMat({ color: 0x2a3a4a, roughness: 0.4 }));
    cab.position.set(8, 15, -10); cab.castShadow = true; g.add(cab);
    door();
  } else if (key === 'carpark') {
    // An open-deck parking structure: stacked slabs on columns.
    for (const sy of [0.2, 3.2, 6.2]) box(16, 0.4, 7, 0x9a9a94, 0, sy, -10.5, { roughness: 0.95 });
    for (const cx of [-7.5, -2.5, 2.5, 7.5]) for (const cz of [-7.5, -13.5]) box(0.4, 6.4, 0.4, 0x8a8a84, cx, 3.2, cz, { roughness: 0.95 });
    for (const py of [3.6, 6.6]) box(16, 0.8, 0.2, 0x8a8a84, 0, py, -7.1, { roughness: 0.95 });
    box(3, 3, 2, 0xd8b078, 0, 1.5, -8, { roughness: 0.9 }); // office at the entrance
    door();
  } else if (key === 'industry') {
    // A brick factory block with two chimneys.
    box(14, 7, 6, 0, 0, 3.5, -10, { mat: texMat('#7a4636', 6, 6, 0.25) });
    for (const cx of [-4.5, 4.5]) {
      const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 11, 12), stdMat({ color: 0xf4f6f8, roughness: 0.7 }));
      ch.position.set(cx, 5.5, -11); ch.castShadow = true; g.add(ch);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 1.2, 12), stdMat({ color: 0xc0392b, roughness: 0.7 }));
      band.position.set(cx, 10.2, -11); g.add(band);
    }
    door();
  } else if (key === 'policestation') {
    // A civic stone block with a columned portico.
    box(12, 8, 6, 0, 0, 4, -10, { mat: texMat('#cfc4ae', 6, 8, 0.3) });
    for (const cx of [-1.6, 1.6]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 3.2, 10), stdMat({ color: 0xe8e2d4, roughness: 0.8 }));
      col.position.set(cx, 1.6, -6.5); col.castShadow = true; g.add(col);
    }
    box(4.2, 0.4, 1.0, 0xe8e2d4, 0, 3.4, -6.5, { roughness: 0.8 });
    door();
  } else if (key === 'navybarracks') {
    // A long low barracks block under a flat roof.
    box(20, 4, 6, 0x6a6a5a, 0, 2, -10);
    box(20.5, 0.3, 6.5, 0x4a4a48, 0, 4.15, -10, { roughness: 0.95 });
    wins([[-7, 2.2], [-4, 2.2], [4, 2.2], [7, 2.2]]);
    door();
  } else if (key === 'sensorvault') {
    // A squat dark secure block with a heavy door.
    box(10, 4, 6, 0x3a3a38, 0, 2, -10, { roughness: 0.95 });
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10), stdMat({ color: 0x6a6a66, roughness: 0.6 }));
    vent.position.set(3, 4.4, -10); g.add(vent);
    door(2.2, 2.8, 0x2a2e33);
  } else if (key === 'clothing' || key === 'dealership') {
    // A shopfront with an awning and big glass windows.
    box(12, 5, 5, 0x8a7a68, 0, 2.5, -9.5);
    const awn = box(8, 0.15, 1.6, key === 'clothing' ? 0xc0392b : 0x2e6fb0, 0, 3.0, -6.6, { roughness: 0.8 });
    awn.rotation.x = -0.3;
    wins([[-3, 1.8], [3, 1.8]]);
    door();
  } else if (key === 'zama' || key === 'court') {
    // A dark glass office tower (the landmarks).
    box(9, 16, 6, 0, 0, 8, -10, { mat: texMat('#232c33', 8, 16, 0.4) });
    door();
  } else if (key === 'mansion' || key === 'safehouse') {
    // A house: cream walls under a pitched roof.
    box(10, 5, 5, 0xd8cfc0, 0, 2.5, -9.5);
    const r1 = box(10.6, 0.25, 3.4, 0x6a4a30, 0, 5.6, -8.6, { roughness: 0.9 }); r1.rotation.x = 0.5;
    const r2 = box(10.6, 0.25, 3.4, 0x6a4a30, 0, 5.6, -10.4, { roughness: 0.9 }); r2.rotation.x = -0.5;
    wins([[-3.5, 2.4], [3.5, 2.4]]);
    door();
  } else {
    // The original shared facade (terminal, Market Street, anything else).
    box(16, 6, 2, 0x8a7a68, 0, 3, -8);
    wins([[-5.5, 3.6], [-3.5, 3.6], [3.5, 3.6], [5.5, 3.6]]);
    door();
  }
  // The area sign over the door names this part of New York, so every
  // arrival reads as its own neighbourhood, not the same street.
  const areaName = areaNameFor(key);
  const areaSign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: signTexture(areaName, 'rgba(0,0,0,0)', '#ffd166', ''), transparent: true, depthWrite: false }));
  areaSign.position.set(0, 4.4, -6.8);
  areaSign.name = 'areaSign'; areaSign.userData.areaName = areaName;
  g.add(areaSign);
}
// Show the arrival beat for a destination just driven to. The mission
// scene hides while the beat runs; the car parks in the lot; the player
// starts seated in it. On get-out the lot hides, the mission scene
// comes back, the view resets, and the destination action runs (the
// store opens, the interior loads, or the landmark card shows).
function showArrivalBeat(name, onGetOut, key) {
  if (!arrivalGroup) buildArrivalLot();
  arrivalSavedMissionVis = [mission1.visible, mission2.visible, mission3.visible];
  mission1.visible = false; mission2.visible = false; mission3.visible = false;
  if (travelGroup) travelGroup.visible = false;
  if (trekGroup) trekGroup.visible = false;
  // The car now waits in this lot at this place: coming back out of
  // the interior returns him here, beside it (see returnToParkedCar).
  if (key) { lotCarPlaceKey = key; parkedPlaceKey = key; }
  buildArrivalFacade(key);
  setArrivalSign(name);
  try { disposeCarGroup(arrivalCar); } catch (e) { /* ignore */ }
  arrivalCar = null;
  const car = buildPlayerCar();
  car.position.set(-1.4, 0, 2);
  car.rotation.y = Math.PI; // facing north, toward the building
  arrivalGroup.add(car);
  arrivalCar = car;
  arrivalGroup.visible = true;
  arrivalPendingAction = onGetOut || null;
  // Seating must never throw past this point: a failure here used to
  // propagate into the drive completion and could leave the player
  // on foot with no arrival beat (the hospital arrival spawned him
  // on foot once on the live check). Fall back to stepping straight
  // into the destination instead.
  let seated = false;
  try {
    seated = seatPlayerInParkedCar(car, { x: 0.1, z: 2, yaw: 0 }, () => {
      hideArrivalBeat();
      try { resetView(); } catch (e) { /* view is best effort */ }
      if (arrivalPendingAction) { const cb = arrivalPendingAction; arrivalPendingAction = null; try { cb(); } catch (err) { /* destination action is best effort */ } }
    });
  } catch (e) { seated = false; }
  if (!seated) {
    hideArrivalBeat();
    if (onGetOut) { try { onGetOut(); } catch (e) { /* ignore */ } }
  }
}
function hideArrivalBeat() {
  if (arrivalGroup) arrivalGroup.visible = false;
  if (arrivalSavedMissionVis) {
    mission1.visible = arrivalSavedMissionVis[0];
    mission2.visible = arrivalSavedMissionVis[1];
    mission3.visible = arrivalSavedMissionVis[2];
    arrivalSavedMissionVis = null;
  }
}
// ---------- Back to the parked car ----------
// Coming out of an interior (or closing the store or a landmark card)
// puts him back in the arrival lot BESIDE his parked car, with a gold
// Get in the car button: the journey continues from where the car is
// parked, never from a reset spawn. Getting in seats him in the car
// and opens the map; closing the map while seated steps him back out
// beside the car; closing it while standing puts the mission scene
// back, as before. When there is no lot car (a Skip arrival), the
// map opens directly, exactly as it used to.
let getInBtnEl = null;
function showGetInButton() {
  if (!getInBtnEl) {
    getInBtnEl = document.createElement('div');
    getInBtnEl.id = 'getInBtn';
    getInBtnEl.innerHTML = '<button type="button" id="getInBtnInner" style="padding:14px 26px;font-size:17px;font-weight:bold;background:#ffd166;color:#111;border:none;border-radius:10px;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,0.5);">Get in the car</button>';
    getInBtnEl.style.cssText = 'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:56;text-align:center;pointer-events:auto;';
    document.body.appendChild(getInBtnEl);
    const inner = document.getElementById('getInBtnInner');
    inner.onclick = () => { getInParkedCar(); };
    inner.addEventListener('pointerup', () => { getInParkedCar(); });
  }
  getInBtnEl.style.display = 'block';
}
function hideGetInButton() { if (getInBtnEl) getInBtnEl.style.display = 'none'; }
function getInParkedCar() {
  if (!arrivalCar || parkedSeatActive) return;
  hideGetInButton();
  const seated = seatPlayerInParkedCar(arrivalCar, { x: 0.1, z: 2, yaw: 0 }, () => {
    // Stepped back out (the map was closed while seated): he is
    // beside the car again, so the way back in is offered again.
    if (atParkedLot) showGetInButton();
  });
  if (seated) openCityMap(lotCarPlaceKey || undefined);
  else showGetInButton();
}
export function returnToParkedCar() {
  if (lotCarPlaceKey && arrivalCar && arrivalGroup && !travelActive) {
    atParkedLot = true;
    arrivalSavedMissionVis = [mission1.visible, mission2.visible, mission3.visible];
    mission1.visible = false; mission2.visible = false; mission3.visible = false;
    if (travelGroup) travelGroup.visible = false;
    if (trekGroup) trekGroup.visible = false;
    arrivalGroup.visible = true;
    try {
      camera.position.set(0.1, 1.7, 2);
      state.yaw = 0; state.pitch = 0;
      setPlayerPos(0.1, 2);
    } catch (e) { /* ignore */ }
    showGetInButton();
    toast('Your car is parked here. Get in to drive on.');
    return;
  }
  openCityMap(parkedPlaceKey || undefined);
}
// The valve room inside the control station: the player enters through
// the station door and walks to the valves. A separate bounds box, so
// WASD stays inside the room while he is in there.
const VALVE_ROOM_BOUNDS = { pos: [0, 1.7, -2], yaw: 0, x: [-3.4, 3.4], z: [-5.4, -1.4] };
let inValveRoom = false;
let stationDoorLockedAt = -10; // throttle for the "locked" toast at the door
// Station door handle + swing: the outside door and the inside exit door
// each sit in a hinge group at the door's edge, with lever handles that
// turn before the door swings. The levers rest horizontal (90 degrees
// from straight up) and press down to 180 degrees; the door then swings
// open on its hinge and stays open. stationDoorAnim is the sequence in
// progress ({ side, phase, t, onDone }) or null; the open flags stop the
// swing from replaying when the player comes back through an open door.
let stationDoorHinge = null, stationLeverPivots = [], stationDoorHandleParts = [];
let stationDoorAnim = null, stationDoorOpen = false;
function resetView() {
  if (!actActive) return;
  // Reset view is the recovery button: recover the input too. A
  // keyup lost to a focus change leaves a movement key stuck on
  // (the player walks straight back to the wall after the reset),
  // and a phantom pinch pointer freezes every drag. Clear both.
  for (const k in keys) keys[k] = false;
  dragging = false; dragMoved = 0;
  try { clearPinchPointers(); } catch (e) { /* ignore */ }
  if (inValveRoom) {
    camera.position.set(VALVE_ROOM_BOUNDS.pos[0], VALVE_ROOM_BOUNDS.pos[1], VALVE_ROOM_BOUNDS.pos[2]);
    state.yaw = VALVE_ROOM_BOUNDS.yaw; state.pitch = 0; camBounds = VALVE_ROOM_BOUNDS;
    // Keep the stored player position in step, or the next frame's
    // beginPlayerFrame teleports the camera back to the old spot and
    // undoes the reset.
    try { setPlayerPos(VALVE_ROOM_BOUNDS.pos[0], VALVE_ROOM_BOUNDS.pos[2]); } catch (e) { /* ignore */ }
    return;
  }
  // Before Mission 1 has started, Reset view returns the player to the
  // platform where he stepped off the train, not to the mission spawn.
  if (state.mission === 1 && !mission1Started) {
    camera.position.set(ARRIVAL_VIEW.pos[0], ARRIVAL_VIEW.pos[1], ARRIVAL_VIEW.pos[2]);
    state.yaw = ARRIVAL_VIEW.yaw; state.pitch = 0; camBounds = STATION_VIEW;
    try { setPlayerPos(ARRIVAL_VIEW.pos[0], ARRIVAL_VIEW.pos[2]); } catch (e) { /* ignore */ }
    return;
  }
  const v = VIEWS[state.mission];
  camera.position.set(v.pos[0], v.pos[1], v.pos[2]);
  state.yaw = v.yaw; state.pitch = 0; camBounds = v;
  try { setPlayerPos(v.pos[0], v.pos[2]); } catch (e) { /* ignore */ }
}
document.getElementById('resetViewBtn').onclick = resetView;
canvas.style.touchAction = 'none';
let dragging = false, lx = 0, ly = 0, dragMoved = 0;
canvas.addEventListener('pointerdown', e => {
  if (!actActive) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  dragging = true; dragMoved = 0; lx = e.clientX; ly = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fallback */ }
});
canvas.addEventListener('pointermove', e => {
  if (!actActive) return;
  if (!dragging) return;
  const dx = e.clientX - lx, dy = e.clientY - ly;
  dragMoved += Math.abs(dx) + Math.abs(dy);
  state.yaw -= dx * 0.0012; state.pitch -= dy * 0.0012;
  // Full 360-degree look: the yaw wraps around instead of stopping at
  // a wall, so the player can turn all the way around and see behind.
  if (state.yaw > Math.PI) state.yaw -= Math.PI * 2;
  if (state.yaw < -Math.PI) state.yaw += Math.PI * 2;
  // Look up and down freely, almost straight up and straight down, so
  // the player can turn his head like a person. Stops just short of
  // straight up/down (1.5 rad = 86 deg) so the view never flips over.
  // A NaN (a bad event coordinate, a synthetic drag) would pass straight
  // through Math.min/Math.max and wedge the pitch forever: every later
  // drag keeps producing NaN and the camera can never be levelled again.
  // Reset a non-finite angle to level before clamping.
  if (!isFinite(state.yaw)) state.yaw = 0;
  if (!isFinite(state.pitch)) state.pitch = 0;
  state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch));
  lx = e.clientX; ly = e.clientY;
});
function endDrag() { dragging = false; }
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
addEventListener('pointerup', endDrag);
addEventListener('blur', endDrag);
const keys = {};
// Held-key suppression: a key already held when the player sits in a
// parked car (or steps out of one) must not act until it is released
// and pressed again. Without this, holding W through the end of a
// drive made the next key-repeat step him out of the car in the same
// frame he sat down: the gold Get out button flashed for one frame,
// the briefing fired while he was already walking, and he walked
// straight into the guard trigger - the arrival read as "no button,
// stuck on a street, dialogue auto-fired at the car".
const suppressedKeys = new Set();
function suppressHeldKeys() {
  for (const k in keys) {
    if (keys[k]) { suppressedKeys.add(k); keys[k] = false; }
  }
}
addEventListener('keydown', e => {
  if (!actActive) return;
  const k = e.key.toLowerCase();
  if (suppressedKeys.has(k)) return;
  keys[k] = true;
  // Seated in a parked car, the natural "let me move" keys step him
  // out first: without this a missed button click left WASD, drags,
  // Reset and C all dead in the seated branch and the arrival read
  // as frozen. The key is then suppressed (see getOutOfParkedCar),
  // so he stands beside the car until he presses it afresh.
  if (parkedSeatActive && (k === 'w' || k === 'a' || k === 's' || k === 'd' || k === 'e')) getOutOfParkedCar();
  if (k === 'r') resetView();
});
addEventListener('keyup', e => { if (!actActive) return; const k = e.key.toLowerCase(); keys[k] = false; suppressedKeys.delete(k); });
// A keyup lost to a focus change would leave a movement key stuck on
// forever (W cancelled by a phantom S reads as "cannot move, reload
// required"): drop every held key when the window loses focus.
addEventListener('blur', () => { for (const k in keys) keys[k] = false; suppressedKeys.clear(); });
addEventListener('resize', () => { if (!actActive) return; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- Characters (shared across missions) ----------
const humans = []; // {group, name, baseScale, phase}
const humanGroups = [];
const modelGroups = {};
// Guard patrol: the two substation guards walk the gate line (see
// loadHumans). Each entry: {group, baseX, baseZ, phase}.
const guardPatrol = [];
const guardMarkers = [];
// Gold "!" marker texture, drawn once and shared by both guard markers.
const guardMarkerTex = (() => {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#111111'; ctx.font = 'bold 84px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('!', 64, 68);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();
function placeHuman(group, name, x, z, faceYaw, baseScale) {
  group.position.set(x, 0, z);
  // Set the FULL rotation, never just .y: a cloned group (the guard
  // clones, Derrick) carries its source's quaternion, and THREE
  // re-derives the Euler from it in the gimbal-flipped form
  // (-PI, 0, -PI) for a PI yaw. Writing .y on that form produces
  // (-PI, yaw, -PI), whose effective yaw is PI - yaw - the guards
  // faced exactly away from the player after stand-down on the
  // live check while every rotation-based test passed.
  group.rotation.set(0, faceYaw, 0);
  group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // Keep the full build scale: rigged people are built wider than
  // tall (body.width on X/Z), and the per-frame breathing loop must
  // preserve that width instead of resetting X/Z to the height
  // scale (which shrank fat builds by a fifth and buried the
  // guards' kit inside their bodies).
  humans.push({ group, name, baseScale, baseScaleX: group.scale.x || baseScale, baseScaleZ: group.scale.z || baseScale, phase: Math.random() * 6 });
  humanGroups.push(group); modelGroups[name] = { group };
  return group;
}
// Caleb's loaded scan, kept at module level so a guard can be built
// from it whenever the yard needs one (see ensureGuards).
let calebBase = null;
// Remove the cap, brim and badge cloned from Caleb. They are removed
// by NAME, not by height: the old height filter (drop every direct
// child above y 1.0) also dropped the model's own head, hair,
// eyebrows, eyelashes and teeth, whose nodes sit at y 1.6-1.7 as
// direct children of the scan - Derrick and both guards rendered
// headless.
function stripCalebKit(grp) {
  for (const c of [...grp.children]) {
    if (c.name === 'calebCap' || c.name === 'calebBrim' || c.name === 'calebBadge') grp.remove(c);
  }
}
// Measure which way a guard figure visually faces in its own space,
// from its face-feature geometry: the scan's named face parts
// (eyebrow, eyelash, teeth) or a rig's face features under the Head
// bone. Returns 0 when the face sits at +Z, PI when it sits at -Z,
// null when no features are found (caller falls back to the table
// value). The facing code then points the VISUAL face at its target
// by construction, whichever model file is actually served - the
// live check found a guard facing exactly away from the player
// while every rotation-based check passed.
function measureGuardFaceYaw(group) {
  try {
    // Zero the rotation with a full set, and restore the saved
    // Euler the same way: a cloned group's Euler can sit in the
    // gimbal-flipped form (-PI, 0, -PI), where setting .y alone
    // does not zero the rotation, and restoring via the quaternion
    // re-derives that flipped form.
    const saved = group.rotation.clone();
    group.rotation.set(0, 0, 0);
    group.updateWorldMatrix(true, true);
    const pts = [];
    const v = new THREE.Vector3();
    group.traverse(o => {
      if (!o.isMesh || o.isSkinnedMesh) return;
      const nm = o.name || '';
      if (/eyebrow|eyelash|teeth/i.test(nm)) {
        const b = new THREE.Box3().setFromObject(o); b.getCenter(v); pts.push(v.clone()); return;
      }
      let p = o.parent, underHead = false;
      while (p) { if (p.isBone && /head/i.test(p.name || '')) { underHead = true; break; } p = p.parent; }
      if (underHead) { o.getWorldPosition(v); pts.push(v.clone()); }
    });
    group.rotation.copy(saved);
    if (!pts.length) return null;
    const gp0 = new THREE.Vector3(); group.getWorldPosition(gp0);
    let cz = 0; for (const p of pts) cz += p.z - gp0.z;
    return cz < 0 ? Math.PI : 0;
  } catch (e) { return null; }
}
// The crowd model a rigged person was built from, found by matching
// the Walk clip the person's mixer is playing against the loaded
// models' clip lists (makeRiggedPerson does not hand the model back).
// Used to give guards the matching Idle clip and to keep the guard
// line male (the bluff dialogue addresses them as gentlemen).
function guardModelFor(person) {
  try {
    const models = getCrowdModels() || [];
    if (!person || !person.mixer) return null;
    for (const m of models) {
      const walk = THREE.AnimationClip.findByName(m.animations || [], 'Walk');
      if (walk && person.mixer.existingAction(walk)) return m;
    }
    const acts = person.mixer._actions || [];
    const clip = acts.length ? acts[0].getClip() : null;
    if (clip) return models.find(m => (m.animations || []).indexOf(clip) !== -1) || null;
  } catch (e) { /* best effort */ }
  return null;
}
// The two guards' looks: real skin tones from the crowd range (deep
// brown and normal brown, never the fairest beige that blows out to
// white under the yard floodlights), dark navy security uniform.
// Fixed per post so the line always reads as two real, different men.
const GUARD_LOOKS = {
  guard1: { skin: 0x5a3a22, hair: 0x141414, shirt: 0x22345c, pants: 0x161c28 },
  guard2: { skin: 0x8a5a3a, hair: 0x3a2418, shirt: 0x22345c, pants: 0x161c28 }
};
// Dress a guard figure in his security kit: a dark navy cap with a
// brim, a SECURITY patch and a gold badge on the chest, and a belt.
// The kit rides in a counter-scaled child group, so its parts are
// sized in true metres from the figure's own measurements whichever
// model (rigged Atlas or Caleb scan) is under it. frontSign is the
// model's facing in its own space (-1 Atlas rigs, +1 the scan).
//
// The measurements come from the POSED figure (skinned vertices with
// bone transforms applied), not Box3.setFromObject: that reads the
// bind-pose geometry box, which is about 0.25 m shorter than the
// walking figure and misjudges his depth, so the cap landed inside
// his head and the patch and badge inside his chest - the live
// check saw no kit at all. The scan has no skeleton, so its plain
// mesh vertices are the posed figure already.
function dressGuardKit(group, frontSign, person) {
  try {
    const front = frontSign < 0 ? -1 : 1;
    const savedPos = group.position.clone();
    const savedRot = group.rotation.clone();
    group.position.set(0, 0, 0);
    group.rotation.set(0, 0, 0);
    // Pose the rig in its neutral Idle stance for the measurement:
    // the Walk clip's root/hips travel offsets the figure from the
    // group origin by up to a metre at some phases, which put the
    // kit beside the body instead of on it. Idle stands him centred
    // and still, the way the frame loop's root recentre holds him.
    let restoreWalk = null;
    if (person && person.mixer) {
      try {
        const idleClip = person.model ? THREE.AnimationClip.findByName(person.model.animations || [], 'Idle') : null;
        const acts = person.mixer._actions || [];
        const walkAction = acts.length ? acts[0] : null;
        if (idleClip) {
          const idleAction = person.mixer.clipAction(idleClip);
          const savedWeight = walkAction ? walkAction.getEffectiveWeight() : 1;
          idleAction.reset();
          idleAction.setEffectiveWeight(1);
          idleAction.play();
          if (walkAction) walkAction.setEffectiveWeight(0);
          person.mixer.update(0.001);
          restoreWalk = () => {
            try {
              idleAction.stop();
              if (walkAction) walkAction.setEffectiveWeight(savedWeight);
              person.mixer.update(0.001);
            } catch (e) { /* ignore */ }
          };
        } else {
          updateRiggedPerson(person, 0);
        }
        if (person.rootBone && person.rootRest) {
          person.rootBone.position.x = person.rootRest.x;
          person.rootBone.position.z = person.rootRest.z;
        }
      } catch (e) { /* measure whatever pose stands */ }
    }
    group.updateWorldMatrix(true, true);
    // Sample the figure's vertices in measured space (group at the
    // origin, rotation zero, build scale applied). Skinned vertices
    // are transformed by hand (bone world matrix times bone inverse
    // times the bind matrix): applyBoneTransform's result depends
    // on bindMatrixInverse freshness, which put the kit beside the
    // body instead of on it. Plain meshes (the scan) take the mesh
    // matrix instead.
    const pts = [];
    const v = new THREE.Vector3();
    const tv = new THREE.Vector3();
    const bm = new THREE.Matrix4();
    group.traverse(o => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 1500));
      const si = o.geometry.attributes.skinIndex;
      const sw = o.geometry.attributes.skinWeight;
      if (o.isSkinnedMesh && o.skeleton && si && sw) {
        const bones = o.skeleton.bones;
        const boneInverses = o.skeleton.boneInverses;
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.bindMatrix);
          const acc = new THREE.Vector3();
          const ws = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)];
          const is = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)];
          for (let k = 0; k < 4; k++) {
            if (!ws[k] || !bones[is[k]]) continue;
            bm.multiplyMatrices(bones[is[k]].matrixWorld, boneInverses[is[k]]);
            acc.addScaledVector(tv.copy(v).applyMatrix4(bm), ws[k]);
          }
          pts.push(acc);
        }
      } else {
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          pts.push(v.clone());
        }
      }
    });
    group.position.copy(savedPos);
    group.rotation.copy(savedRot);
    if (restoreWalk) restoreWalk();
    if (pts.length < 20) return;
    const all = new THREE.Box3();
    for (const p of pts) all.expandByPoint(p);
    if (!isFinite(all.min.y) || !isFinite(all.max.y) || all.max.y <= all.min.y) return;
    const height = all.max.y - all.min.y;
    const centreX = (all.min.x + all.max.x) / 2;
    const bandBox = (lo, hi, colHalf) => {
      const b = new THREE.Box3();
      for (const p of pts) {
        if (p.y < all.min.y + height * lo || p.y > all.min.y + height * hi) continue;
        if (colHalf && Math.abs(p.x - centreX) > colHalf) continue;
        b.expandByPoint(p);
      }
      return b;
    };
    const headBand = bandBox(0.84, 1.01, 0.35);
    const chestCol = bandBox(0.60, 0.82, 0.24);
    const hipsCol = bandBox(0.44, 0.58, 0.30);
    // The figure's own centre in measured space (the hips band is
    // the torso core): kit parts sit on him wherever he stands.
    const cx = (hipsCol.min.x + hipsCol.max.x) / 2;
    const cz = (hipsCol.min.z + hipsCol.max.z) / 2;
    const headW = Math.max(0.2, headBand.max.x - headBand.min.x);
    const headD = Math.max(0.2, headBand.max.z - headBand.min.z);
    const headR = Math.max(headW, headD) / 2 + 0.015;
    const chestFront = front > 0 ? chestCol.max.z - cz : cz - chestCol.min.z;
    const chestY = (chestCol.min.y + chestCol.max.y) / 2;
    const hipsW = Math.max(0.3, hipsCol.max.x - hipsCol.min.x);
    const hipsD = Math.max(0.24, hipsCol.max.z - hipsCol.min.z);
    const hipsY = (hipsCol.min.y + hipsCol.max.y) / 2;
    const kit = new THREE.Group();
    kit.name = 'guardKitGroup';
    kit.scale.set(1 / (group.scale.x || 1), 1 / (group.scale.y || 1), 1 / (group.scale.z || 1));
    group.add(kit);
    const navy = new THREE.MeshStandardMaterial({ color: 0x16233c, roughness: 0.85 });
    const add = (mesh, part) => {
      mesh.name = 'guardKit'; mesh.userData.kitPart = part;
      mesh.frustumCulled = false; mesh.castShadow = true;
      kit.add(mesh); return mesh;
    };
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(headR * 0.94, headR, 0.14, 14), navy);
    crown.position.set(cx, all.max.y + 0.06, cz); add(crown, 'cap');
    const brim = new THREE.Mesh(new THREE.BoxGeometry(headW * 0.85, 0.02, 0.17), new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.4 }));
    brim.position.set(cx, all.max.y + 0.0, cz + front * (headD / 2 + 0.06)); add(brim, 'cap');
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.12), new THREE.MeshBasicMaterial({ map: signTexture('SECURITY', '#16233c', '#ffd166', ''), transparent: false }));
    patch.position.set(cx + 0.03, chestY, cz + front * (chestFront + 0.02));
    if (front < 0) patch.rotation.y = Math.PI;
    add(patch, 'patch');
    const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 12), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.25 }));
    badge.rotation.x = Math.PI / 2;
    badge.position.set(cx - 0.14, chestY + 0.08, cz + front * (chestFront + 0.025)); add(badge, 'badge');
    const belt = new THREE.Mesh(new THREE.BoxGeometry(hipsW + 0.05, 0.07, hipsD + 0.05), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 }));
    belt.position.set(cx, hipsY, cz); add(belt, 'belt');
  } catch (e) { /* the kit is dressing; never break a guard build */ }
}
// Build one substation guard as a rigged crowd person in a dark navy
// security uniform, Walk clip playing, matching Idle clip ready for
// stand-down. Returns the patrol entry (group already in the yard)
// or null when the crowd models are not loaded yet.
//
// Why rigged, not a Caleb clone: Act II's Caleb (models/caleb.glb)
// is a static scan - eight unskinned meshes, no bones, no clips - so
// a clone can only ever glide when the patrol translates it (the
// live-play report: guards sliding instead of walking back and
// forth). A rigged guard walks the gate line for real. Caleb himself
// and Derrick keep the scan (neither patrols).
function buildRiggedGuardEntry(gname, gx, gz) {
  let person = null, model = null, look = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    look = Object.assign({}, GUARD_LOOKS[gname] || GUARD_LOOKS.guard1);
    const p = makeRiggedPerson({ x: gx, z: gz, heading: Math.PI, look, sex: 'm' });
    if (!p || !p.group) return null; // crowd models not loaded yet
    person = p; model = p.model || guardModelFor(p);
    if (model && model.sex === 'm') break;
    // A female rig was picked: discard it (its group was never added
    // to the yard) and roll again - the guards are addressed as
    // gentlemen in the bluff.
  }
  const g = person.group;
  g.name = gname;
  // A guard must never be frustum-culled: his marker sprite rendered
  // while his meshes were culled away on the live check (one guard
  // figure invisible, marker floating). makeRiggedPerson sets this
  // too; belt and braces for the guard line.
  g.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  mission2.add(g);
  // From here on the group is in the yard: every step is guarded so
  // a throw can never leave an orphan figure standing at the post
  // while the patrol drives a different one. The entry is returned
  // whatever succeeded.
  let measuredRigYaw = null, marker = null;
  try { placeHuman(g, gname, gx, gz, Math.PI, g.scale.y || 1); } catch (e) { g.position.set(gx, 0, gz); }
  // faceYaw rides on the rig: the Atlas crowd rigs face -Z in their
  // own space (faceYaw PI), the Casual rig faces +Z (0). Measured
  // from the rig's own face features when they exist, with the
  // layout table value as the fallback.
  try { measuredRigYaw = measureGuardFaceYaw(g); } catch (e) { measuredRigYaw = null; }
  // Walk is already playing on the person's mixer (makeRiggedPerson
  // starts it at a random phase). Keep a handle on it plus the
  // matching Idle action so stand-down can crossfade instead of
  // marching in place.
  let walkAction = null, idleAction = null;
  try {
    const acts = person.mixer ? (person.mixer._actions || []) : [];
    walkAction = acts.length ? acts[0] : null;
    const idleClip = model ? THREE.AnimationClip.findByName(model.animations || [], 'Idle') : null;
    if (idleClip && person.mixer) idleAction = person.mixer.clipAction(idleClip);
  } catch (e) { walkAction = null; idleAction = null; }
  // The security kit (cap, SECURITY patch, badge, belt) goes on
  // before the marker sprite, so the kit's bounding box measures
  // the man, not the floating "!".
  const guardFaceYaw = measuredRigYaw === null ? (person.faceYaw || 0) : measuredRigYaw;
  dressGuardKit(g, guardFaceYaw === Math.PI ? -1 : 1, person);
  try {
    marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: guardMarkerTex, color: 0xffd166, transparent: true, depthWrite: false }));
    marker.scale.set(1.15, 1.15, 1); marker.position.set(0, 2.4, 0); marker.name = 'guardMarker';
    g.add(marker); guardMarkers.push(marker);
  } catch (e) { marker = null; }
  // If the Atlas image had not decoded when the look was applied,
  // the guard kept his factory colours; ensureGuards retries the
  // look once the image is ready (see the heal pass there).
  const lookPending = (model && !atlasImageReady(model)) ? { model, look } : null;
  return { group: g, baseX: gx, baseZ: gz, phase: Math.random() * 6, person, walkAction, idleAction, marker, faceYaw: guardFaceYaw, look, lookPending };
}
// Last-resort guard: a Caleb scan clone. The scan has no skeleton,
// so this guard can only glide on patrol - it exists so the yard is
// never guard-less (which would soft-lock Mission 2) if the crowd
// models fail to load. ensureGuards upgrades it to a rigged guard
// as soon as the crowd lands.
function buildStaticGuardEntry(gname, gx, gz) {
  if (!calebBase || !calebBase.group) return null;
  // Dark navy security uniform (the same navy as the rigged guards),
  // light enough to read against the dark yard at dusk (the old
  // near-black 0x1c1c22 made the guards invisible silhouettes on the
  // live checks).
  const dark = new THREE.MeshStandardMaterial({ color: 0x22345c, roughness: 0.85, metalness: 0.02 });
  const g = calebBase.group.clone(true);
  g.name = gname;
  g.traverse(o => { if (o.isMesh && o.material && o.material.name && o.material.name.indexOf('casualsuit') !== -1) o.material = dark; });
  // A guard must never be frustum-culled (see buildRiggedGuardEntry).
  g.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  stripCalebKit(g); // drop Caleb's cap, brim and badge (by name - see above)
  mission2.add(g); placeHuman(g, gname, gx, gz, Math.PI, calebBase.scale);
  // faceYaw is MEASURED from the clone's own face geometry (see
  // measureGuardFaceYaw): the scan faces +Z, so the measured value
  // is 0 and a plain atan2 yaw points him at his target with no
  // offset. Measuring keeps the visual face correct even if the
  // served model file differs.
  const measuredYaw = measureGuardFaceYaw(g);
  // The same security kit as the rigged guards (cap, SECURITY patch,
  // badge, belt), dressed before the marker sprite is added.
  dressGuardKit(g, measuredYaw === Math.PI ? -1 : 1);
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: guardMarkerTex, color: 0xffd166, transparent: true, depthWrite: false }));
  marker.scale.set(1.15, 1.15, 1); marker.position.set(0, 2.4, 0); marker.name = 'guardMarker';
  g.add(marker); guardMarkers.push(marker);
  return { group: g, baseX: gx, baseZ: gz, phase: Math.random() * 6, marker, static: true, faceYaw: measuredYaw === null ? 0 : measuredYaw, look: Object.assign({}, GUARD_LOOKS[gname] || GUARD_LOOKS.guard1) };
}
// Build one substation guard at his post: a walking rigged guard
// whenever the crowd models are loaded, else (only when allowStatic)
// a Caleb scan clone so the yard is never empty. Returns true on
// success.
function buildOneGuard(gname, gx, gz, allowStatic) {
  try {
    // One figure per post, by construction: drop any stale same-name
    // group already in the yard before adding the new one, so a
    // retry or a double build can never leave an orphan figure
    // standing at the post while the patrol drives a different one.
    for (const child of [...mission2.children]) {
      if (child.name === gname && !guardPatrol.some(gp => gp.group === child)) mission2.remove(child);
    }
    const entry = buildRiggedGuardEntry(gname, gx, gz) || (allowStatic ? buildStaticGuardEntry(gname, gx, gz) : null);
    if (!entry) return false;
    guardPatrol.push(entry);
    return true;
  } catch (e) { return false; }
}
// Both guards must always stand in the yard. The two spawn paths
// (walking rigged guards once the crowd models land, Caleb scan
// clones as the last resort) used to guard on guardPatrol.length,
// so ONE failed spawn in either path left a single guard forever -
// the live check found one guard in the yard. Top the line up to
// two from whichever source is ready, retrying a failed build once.
function ensureGuards() {
  // One patrol entry per guard name: a double build (retry after a
  // throw past the push) would leave two entries for one post, and
  // the patrol loop would drive both figures. Drop the extras and
  // take their groups out of the yard.
  for (let i = guardPatrol.length - 1; i >= 0; i--) {
    const name = guardPatrol[i].group && guardPatrol[i].group.name;
    if (guardPatrol.findIndex(gp => gp.group && gp.group.name === name) !== i) {
      try { mission2.remove(guardPatrol[i].group); } catch (e) { /* ignore */ }
      guardPatrol.splice(i, 1);
    }
  }
  for (const [gname, gx, gz] of [['guard1', -3.5, 2], ['guard2', 3.5, 2]]) {
    if (guardPatrol.some(gp => gp.group && gp.group.name === gname)) continue;
    if (!buildOneGuard(gname, gx, gz, false)) buildOneGuard(gname, gx, gz, false);
  }
  // Upgrade any static scan-clone guard to a walking rigged guard
  // once the crowd models are in: the scan has no skeleton, so a
  // scan guard can only glide along the patrol line. The
  // replacement is built first; the static figure is swapped out
  // only on success, so a failed upgrade never empties the post.
  for (let i = guardPatrol.length - 1; i >= 0; i--) {
    const gp = guardPatrol[i];
    if (!gp.static || !gp.group) continue;
    const entry = buildRiggedGuardEntry(gp.group.name, gp.baseX, gp.baseZ);
    if (!entry) continue;
    try { mission2.remove(gp.group); } catch (e) { /* ignore */ }
    for (let j = humans.length - 1; j >= 0; j--) if (humans[j].group === gp.group) humans.splice(j, 1);
    const hi = humanGroups.indexOf(gp.group); if (hi !== -1) humanGroups.splice(hi, 1);
    if (gp.marker) { const mi = guardMarkers.indexOf(gp.marker); if (mi !== -1) guardMarkers.splice(mi, 1); }
    guardPatrol[i] = entry;
  }
  // Orphan sweep: a guard figure in the yard that is not on the
  // patrol list would stand at its post forever, never patrolling
  // and never facing the player (the live check saw a stationary
  // guard facing north while the patrol line worked). Remove any
  // guard-named group the patrol does not own.
  try {
    for (const child of [...mission2.children]) {
      if ((child.name === 'guard1' || child.name === 'guard2') && !guardPatrol.some(gp => gp.group === child)) mission2.remove(child);
    }
  } catch (e) { /* ignore */ }
  // Visibility by construction: both figures shown, no mesh left
  // frustum-culled (meshes added later - expression pivots, kit -
  // get the same treatment the build paths apply).
  for (const gp of guardPatrol) {
    try {
      gp.group.visible = true;
      gp.group.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
      // Look heal: a guard built before his Atlas image decoded kept
      // the factory colours (applyLook is a no-op until then), which
      // left him pale and out of uniform. Retry the security look
      // once the image is ready.
      if (gp.lookPending && atlasImageReady(gp.lookPending.model)) {
        applyLook(gp.group, gp.lookPending.model, gp.lookPending.look);
        gp.lookPending = null;
      }
    } catch (e) { /* ignore */ }
  }
}
// Guards are rigged crowd people: when the crowd models land, top
// the guard line up (and upgrade any static stand-in).
try { onCrowdReady(() => { try { ensureGuards(); } catch (e) { /* guards are best effort */ } }); } catch (e) { /* ignore */ }
async function loadHumans() {
  const loader = new GLTFLoader();
  // Each model load races a 30 s timeout, as in Act I: a network request
  // that hangs (never resolves, never rejects) would otherwise stall this
  // await forever and leave the game stuck on "Loading characters..." with
  // no way forward. The models load IN PARALLEL and the act starts right
  // away: the loading screen no longer waits on the characters, so a slow
  // fetch can never hold the player past the 30 s rule. A model that
  // misses its first attempt is retried in the background (the Act I
  // retryHumanLater pattern) and streams in when it lands; only a model
  // that fails every attempt is reported, and the game continues without
  // them.
  const loadWithTimeoutMs = (file, ms) => Promise.race([
    loader.loadAsync(file),
    new Promise((_, reject) => setTimeout(() => reject(new Error('load timed out after 30s')), ms))
  ]);
  // Speaking gestures and jaw morphs use the loaded models: re-register
  // after each arrival so a late character speaks and moves like the rest.
  const afterHuman = () => {
    try { registerHumans(humans); } catch (e) { /* gestures are best effort */ }
    try { registerLipSyncHumans(humans); } catch (e) { /* lip-sync is best effort */ }
  };
  const addJade = (jade) => {
    const jg = jade.scene; jg.name = 'jade';
    const jb = new THREE.Box3().setFromObject(jg); const js = new THREE.Vector3(); jb.getSize(js);
    const jscale = 1.68 / js.y; jg.scale.setScalar(jscale);
    const jb2 = new THREE.Box3().setFromObject(jg); jg.position.y = -jb2.min.y;
    mission1.add(jg); placeHuman(jg, 'jade', -2.8, 6, Math.PI, jscale);
    afterHuman();
  };
  const addCaleb = (caleb) => {
    const cg = caleb.scene; cg.name = 'caleb';
    const cb = new THREE.Box3().setFromObject(cg); const cs = new THREE.Vector3(); cb.getSize(cs);
    const cscale = 1.68 / cs.y; cg.scale.setScalar(cscale);
    const cb2 = new THREE.Box3().setFromObject(cg); cg.position.y = -cb2.min.y;
    // Navy recolour + cap + badge, as in Act I.
    const navy = new THREE.MeshStandardMaterial({ color: 0x1a3a5a, roughness: 0.85, metalness: 0.02 });
    cg.traverse(o => { if (o.isMesh && o.material && o.material.name && o.material.name.indexOf('casualsuit') !== -1) o.material = navy; });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x16283f, roughness: 0.7 });
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.13, 0.07, 16), capMat);
    crown.position.set(0, 1.81, 0); crown.castShadow = true; crown.name = 'calebCap'; cg.add(crown);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.012, 0.1), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.3 }));
    brim.position.set(0, 1.775, 0.13); brim.name = 'calebBrim'; cg.add(brim);
    const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.01, 12), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.25 }));
    badge.rotation.x = Math.PI / 2; badge.position.set(-0.09, 1.32, 0.17); badge.name = 'calebBadge'; cg.add(badge);
    calebBase = { group: cg, scale: cscale };
    mission1.add(cg); placeHuman(cg, 'caleb', 2.8, 6, Math.PI, cscale);
    // Derrick Shaw and the two substation guards reuse Caleb's scan with
    // new coats (cloned groups, recoloured materials) - a prototype
    // stand-in, the script's Derrick is a man in his 60s in a dark suit.
    const grey = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.85, metalness: 0.02 });
    const derrick = calebBase.group.clone(true);
    derrick.name = 'derrick';
    derrick.traverse(o => { if (o.isMesh && o.material && o.material.name && o.material.name.indexOf('casualsuit') !== -1) o.material = grey; });
    stripCalebKit(derrick);
    mission3.add(derrick); placeHuman(derrick, 'derrick', 0, -6, 0, calebBase.scale);
    // Stand the guard line up (or top it up if the crowd-rig
    // stand-ins already built one): ensureGuards builds any missing
    // guard from this scan, so a slow Caleb fetch can neither double
    // the line nor leave it one short.
    ensureGuards();
    afterHuman();
  };
  // Retry a missed model in the background: two more attempts, the first
  // after 2 s and the second 5 s after that, each with a 60 s race. The
  // game has already started by then, so a slow retry never blocks the
  // player. Only if every attempt fails is the player told.
  const retryLater = (file, addFn, name) => {
    let attempt = 0;
    const tryOnce = async () => {
      attempt++;
      try {
        const gltf = await loadWithTimeoutMs(file, 60000);
        addFn(gltf);
      } catch (e) {
        if (attempt < 2) setTimeout(tryOnce, 5000);
        else { try { toast(name + ' could not be loaded - the game continues without them.'); } catch (e2) { /* toast is best effort */ } }
      }
    };
    setTimeout(tryOnce, 2000);
  };
  const loadOne = async (file, addFn, name) => {
    try {
      const gltf = await loadWithTimeoutMs(file, 30000);
      addFn(gltf);
    } catch (e) {
      retryLater(file, addFn, name);
    }
  };
  // Start the act now; the characters stream in behind it. The scene,
  // the rental car and the objectives are all ready without the models,
  // and nothing in the arrival reads the human groups directly.
  document.getElementById('loading').classList.add('hidden');
  startArrival();
  loadOne('models/jade.glb', addJade, 'Jade');
  loadOne('models/caleb.glb', addCaleb, 'Caleb');
}

// ---------- Mission 1: The Delaware Line (Rondout Reservoir) ----------
let waterMesh;
// The valve room, inside the control station (the station building is a
// solid box, so the room is built as its own enclosed space within the
// building footprint: x -4 to 4, z -6 to -1, 3.2 high). The front wall
// has a doorway that lines up with the station door outside. The player
// enters through the door, walks to a valve wheel, and the pressure
// controls open when he reaches the valves. The same station door takes
// him back outside, and the sabotage device hides under the staircase
// inside the room.
function buildValveRoom() {
  const room = new THREE.Group(); mission1.add(room);
  // Underground chamber beneath the skyscraper: bare concrete walls,
  // cool industrial light, no windows. The player reaches it by going
  // down from the tower entrance (the door teleports him in, as before);
  // the stairs by the entrance wall are the flight he came down.
  const wallMat = stdMat({ color: 0x5f5f5c, roughness: 0.95 });
  const mk = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, y, z); m.receiveShadow = true; room.add(m); return m;
  };
  // Floor and ceiling.
  mk(8, 0.1, 5, 0, 0.05, -3.5);
  mk(8, 0.1, 5, 0, 3.25, -3.5);
  // Back, left and right walls.
  mk(8, 3.2, 0.15, 0, 1.6, -6);
  mk(0.15, 3.2, 5, -4, 1.6, -3.5);
  mk(0.15, 3.2, 5, 4, 1.6, -3.5);
  // Front wall in two segments plus a lintel, leaving a doorway 1.2 wide.
  mk(3.4, 3.2, 0.15, -2.3, 1.6, -1);
  mk(3.4, 3.2, 0.15, 2.3, 1.6, -1);
  mk(1.2, 1.0, 0.15, 0, 2.7, -1);
  // Cool industrial lights and a caged ceiling fixture.
  const l1 = new THREE.PointLight(0xd8e8ff, 0.9, 9); l1.position.set(0, 2.8, -2.5); room.add(l1);
  const l2 = new THREE.PointLight(0xd8e8ff, 0.7, 9); l2.position.set(0, 2.8, -5); room.add(l2);
  // A small light over the gauge panel, so the needles, brass rims and
  // valve wheels read clearly even though the dial faces are unlit.
  const gl = new THREE.PointLight(0xd8e8ff, 0.8, 7); gl.position.set(0, 3.0, -4.6); room.add(gl);
  const fix = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.3), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0xd8e8ff, emissiveIntensity: 1.2 }));
  fix.position.set(0, 3.15, -3.5); room.add(fix);
  // VALVE ROOM sign on the INTERIOR face of the front wall, centred over
  // the doorway but small (1.5 m wide) and set 0.65 m into the room
  // (z -1.65): at the old z -1.25 the wall segment beside the doorway
  // crossed its text from the oblique valve viewpoints, and at the old
  // 2.4 m width it clipped at the screen edge, the lintel and the
  // ceiling from every inside viewpoint. Here the whole text reads
  // from the valves, the room centre and both corners. (The EXIT sign
  // keeps the west wall segment.)
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('VALVE ROOM', '#2a2118', '#ffd166', 'UNDERGROUND - LEVEL B1'), transparent: true, depthWrite: false }));
  sign.scale.set(1.5, 0.37, 1); sign.position.set(0, 2.5, -1.65); room.add(sign);
  // A second VALVE ROOM sign on the back wall, above the gauges: the
  // front-wall sign sits behind the entry camera, so the player never
  // faced it. It hangs in FRONT of the back pipe main (the main runs
  // at z -5.7, y 3.08 and crossed both text bands at the old z -5.85,
  // so it read "VE ROOM / ROUND") and just above the gauge labels,
  // clear of the ceiling. It reads whole from the door and the valves.
  const signBack = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('VALVE ROOM', '#2a2118', '#ffd166', 'UNDERGROUND - LEVEL B1'), transparent: true, depthWrite: false }));
  signBack.scale.set(1.5, 0.3, 1); signBack.position.set(0, 2.98, -5.4); room.add(signBack);
  // One door only in this doorway: the station door slab outside is the
  // single front door, and it works both ways (in with the key, out
  // from inside without it). There used to be a second slab here, the
  // EXIT door, 0.4 m behind the station door in the same doorway; it
  // is gone. The green EXIT sign stays, so the way out is still marked.
  const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.35), new THREE.MeshStandardMaterial({ color: 0x0a3a0a, emissive: 0x2aff7a, emissiveIntensity: 0.9 }));
  // On the interior face of the front wall, left of the door, facing
  // into the room (rotation.y = PI): it used to sit at z -1.05, inside
  // the wall itself, so it was invisible from both sides.
  exitSign.position.set(-1.9, 2.3, -1.25); exitSign.rotation.y = Math.PI; room.add(exitSign);
  // Exposed pipes run along the ceiling from the entrance wall to the
  // back wall, then drop down to feed the three valves: the water comes
  // straight from the dam, through the tower, down into this chamber.
  // The ceiling runs sit in the GAPS between the gauge labels (x -1.5
  // and 1.5), not over the valves: a run over a valve crossed its label
  // at the label's own height and split it ("RESI...TIAL"), because the
  // runs span the whole room at the labels' height. The labels sit at
  // x -3, 0 and 3, so the gaps between them are the only clear lanes.
  // A single main along the back wall joins the runs to the drops.
  // The drops sit 0.8 m WEST of each valve (x -3.8, -0.8, 2.2), not
  // on the valve's own x: a drop on the valve's x ran straight down
  // in front of its gauge and wheel and hid them. Off to the side,
  // each drop lands on the west end of its valve's horizontal pipe
  // and the gauge, the wheel, the sight tube and the PSI readout are
  // all clear of it and clickable. The drops and the back-wall main
  // sit BEHIND the labels (z -5.7, labels at z -5.35), so the labels
  // draw over them and read whole.
  const chamberPipeMat = stdMat({ color: 0x6a747a, metalness: 0.8, roughness: 0.35 });
  // The runs and the back main sit high (y 3.08, against the ceiling):
  // at the old y 2.95 they crossed the gauge labels' tops from the
  // door view, because the runs span the whole room at label height.
  for (const px of [-1.5, 1.5]) {
    const run = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 4.7, 12), chamberPipeMat);
    run.rotation.x = Math.PI / 2; run.position.set(px, 3.08, -3.35); run.castShadow = true; room.add(run);
  }
  const backMain = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 7.6, 12), chamberPipeMat);
  backMain.rotation.z = Math.PI / 2; backMain.position.set(0, 3.08, -5.7); backMain.castShadow = true; room.add(backMain);
  for (const px of [-3.8, -0.8, 2.2]) {
    const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.4, 12), chamberPipeMat);
    drop.position.set(px, 1.75, -5.7); drop.castShadow = true; room.add(drop);
  }
  // The flight of stairs down from the tower: eight steps along the
  // right wall, from a landing by the entrance door down to the floor.
  // A dark doorway at the top landing is the door he came down through.
  const stairMat = stdMat({ color: 0x4a4a48, roughness: 0.95 });
  for (let i = 0; i < 8; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 0.4), stairMat);
    step.position.set(3.3, 2.25 - i * 0.3, -1.5 - i * 0.35);
    step.castShadow = true; step.receiveShadow = true; room.add(step);
  }
  const landing = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.8), stairMat);
  landing.position.set(3.3, 2.42, -1.2); landing.receiveShadow = true; room.add(landing);
  const stairDoor = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.1), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }));
  stairDoor.position.set(3.3, 1.9, -0.93); room.add(stairDoor);
  // The staircase is solid: the player walks around it, not through the
  // steps. The device hides under the flight, east of the steps, so this
  // box stops at the steps' east edge and never covers it.
  addBoxCollider(valveRoomColliders, 2.75, -4.15, 3.85, -1.3);
  // The back-wall pipework is solid too: the drops, valve wheels and
  // gauges all sit at z -5.7 (front surfaces at -5.48), but the walk
  // bounds let the player reach z -5.4, so in first person his eye
  // sat 0.08 m from the pipes and the near plane clipped into them
  // (the door was not even visible from the gauges). This strip stops
  // him at z -5.15, a third of a metre clear of every pipe, in first
  // and third person alike; the valves stay clickable from there.
  addBoxCollider(valveRoomColliders, -3.9, -6.05, 3.9, -5.5);
}
function enterValveRoom() {
  if (inValveRoom) return;
  inValveRoom = true;
  // Third person in the valve room, so the player sees himself at the valves.
  try { setThirdPerson(true); } catch (e) { /* camera is best effort */ }
  camera.position.set(VALVE_ROOM_BOUNDS.pos[0], VALVE_ROOM_BOUNDS.pos[1], VALVE_ROOM_BOUNDS.pos[2]);
  // Sync the stored ground position too: without this the next frame's
  // beginPlayerFrame snaps the camera back to the spot outside the door
  // and the bounds clamp lands him just inside the doorway instead of
  // at the room spawn.
  try { setPlayerPos(VALVE_ROOM_BOUNDS.pos[0], VALVE_ROOM_BOUNDS.pos[2]); } catch (e) { /* ignore */ }
  state.yaw = VALVE_ROOM_BOUNDS.yaw; state.pitch = 0; camBounds = VALVE_ROOM_BOUNDS;
  // Objectives only move forward: re-entering after the hold and the
  // choice must keep the device objective struck through to it, not
  // reset the list to the balancing step (which read as the mission
  // un-finishing itself and needing a reload).
  setObjectives(OBJ1, state.waterStable ? 4 : 2);
  toast('Down in the valve chamber, under the tower - walk up to a valve wheel to open the pressure controls. Click the station door to go back outside.');
}
function exitValveRoom() {
  if (!inValveRoom) return;
  inValveRoom = false;
  // Leaving the room always closes its pressure controls. The key
  // pickup, the door walk-up and the other yard triggers are gated on
  // the valve modal being hidden, so a modal left open here would
  // silently kill every one of them outside with no feedback.
  try {
    valveOpen = false;
    valveReopenAt = Date.now() + 2500;
    if (valveTimer) { clearInterval(valveTimer); valveTimer = null; }
    document.getElementById('valveModal').classList.add('hidden');
  } catch (e) { /* ignore */ }
  camera.position.set(0, 1.7, 2);
  // Sync the stored ground position too: without this the next frame's
  // beginPlayerFrame snaps the player back to his spot inside the room,
  // within the door's walk-up radius, and the walk-up trigger sends him
  // straight back in - an exit loop that read as being trapped in the
  // valve room with movement dead (only Reset view escaped it).
  try { setPlayerPos(0, 2); } catch (e) { /* ignore */ }
  state.yaw = 0; state.pitch = 0; camBounds = VIEWS[1];
  toast('Back outside the station.');
}

// ---------- Rondout station, dam and water tower (Mission 1) ----------
// The water facility is an underground chamber beneath a skyscraper,
// piped directly from a dam, with the building standing around the dam.
// The player arrives by train at Rondout station at the south end and
// walks the dirt track north to the tower entrance.
function buildDamComplex() {
  const concrete = stdMat({ color: 0x8a8a84, roughness: 0.95 });
  const steel = stdMat({ color: 0x6a747a, metalness: 0.8, roughness: 0.35 });
  // Concrete gravity dam wall on the west side, 28 m long, 9 m high,
  // with a wider base batter and a crest walkway with parapets.
  const wall = new THREE.Mesh(new THREE.BoxGeometry(2.5, 9, 28), concrete);
  wall.position.set(DAM_X, 4.5, 0); wall.castShadow = true; wall.receiveShadow = true; mission1.add(wall);
  const base = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 28), concrete);
  base.position.set(DAM_X, 1, 0); base.castShadow = true; base.receiveShadow = true; mission1.add(base);
  const crest = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3, 28), concrete);
  crest.position.set(DAM_X, 9.15, 0); crest.castShadow = true; mission1.add(crest);
  for (const px of [-15.6, -12.4]) {
    const par = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 28), concrete);
    par.position.set(px, 9.7, 0); par.castShadow = true; mission1.add(par);
  }
  // Abutments tying the dam ends into the banks.
  for (const az of [-15.5, 15.5]) {
    const ab = new THREE.Mesh(new THREE.BoxGeometry(4, 9, 3), concrete);
    ab.position.set(DAM_X, 4.5, az); ab.castShadow = true; mission1.add(ab);
  }
  // The reservoir held back behind the dam: a still sheet of water at
  // 7.6 m, just below the crest, with a far earth bank closing it.
  waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(14, 28), new THREE.MeshStandardMaterial({ color: 0x1a5a8a, roughness: 0.15, metalness: 0.3 }));
  waterMesh.rotation.x = -Math.PI / 2; waterMesh.position.set(-21, DAM_WATER_Y, 0); mission1.add(waterMesh);
  const berm = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 30), stdMat({ color: 0x4a5a34, roughness: 1 }));
  berm.position.set(-28.5, 1.5, 0); berm.castShadow = true; mission1.add(berm);
  // Spillway at the north end: water pours over the crest, down a
  // concrete chute on the dam face, into a plunge pool at the base.
  const chute = new THREE.Mesh(new THREE.BoxGeometry(0.25, 9, 1.6), concrete);
  chute.rotation.z = 0.262; chute.position.set(-11.75, 4.6, -11); chute.castShadow = true; mission1.add(chute);
  const spill = new THREE.Mesh(new THREE.BoxGeometry(0.06, 8.8, 1.4), new THREE.MeshStandardMaterial({ color: 0xcfe8ff, emissive: 0x9fd4ff, emissiveIntensity: 0.5, roughness: 0.2 }));
  spill.rotation.z = 0.262; spill.position.set(-11.6, 4.64, -11); mission1.add(spill);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.2, 20), new THREE.MeshStandardMaterial({ color: 0xbfe0ff, emissive: 0x7fb8e8, emissiveIntensity: 0.4, roughness: 0.2, transparent: true, opacity: 0.9 }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(-10.4, 0.07, -11); mission1.add(pool);
  const foam = new THREE.Mesh(new THREE.CircleGeometry(1.4, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
  foam.rotation.x = -Math.PI / 2; foam.position.set(-10.4, 0.08, -11); mission1.add(foam);
  // Three parallel steel pipes, 0.9 m across, run straight from the dam
  // base into the west face of the tower: the water is piped directly
  // from the dam to the facility, and down to the underground chamber.
  for (const pz of [-3, -5, -7]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 5.75, 16), steel);
    pipe.rotation.z = Math.PI / 2; pipe.position.set(-9.9, 0.9, pz); pipe.castShadow = true; mission1.add(pipe);
    const intake = new THREE.Mesh(new THREE.BoxGeometry(1, 1.2, 1.2), concrete);
    intake.position.set(-12.9, 0.9, pz); intake.castShadow = true; mission1.add(intake);
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 1.2), steel);
    collar.position.set(-7, 0.9, pz); collar.castShadow = true; mission1.add(collar);
    const support = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, 0.3), concrete);
    support.position.set(-10, 0.225, pz); mission1.add(support);
    for (const fx of [-12.6, -7.2]) {
      const flange = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.06, 8, 20), steel);
      flange.rotation.y = Math.PI / 2; flange.position.set(fx, 0.9, pz); mission1.add(flange);
    }
  }
}
function buildWaterTower() {
  // The skyscraper the facility sits under: a solid lobby at ground
  // level with the entrance door, and a setback glass tower above it,
  // 14 m wide and about 40 m tall. The front face stays at z -0.75,
  // so the entrance door and the key hook keep their exact positions
  // on the lobby face.
  box(mission1, 14, 4.5, 12, 0x2e3a44, 0, 2.25, -6.75, null, { color: 0x2e3a44, roughness: 0.6, metalness: 0.3 });
  // The lobby is a solid box: its front and side faces are walls the
  // player walks against, not through. The front wall leaves the
  // 1.2-wide doorway open (the shut station door slab blocks it until
  // it swings open). The side walls only run over the reachable z
  // range: the dam side is beyond the view bounds.
  addBoxCollider(mission1Colliders, -7, -0.95, -0.6, -0.55);
  addBoxCollider(mission1Colliders, 0.6, -0.95, 7, -0.55);
  addBoxCollider(mission1Colliders, -7.2, -6, -6.8, -0.75);
  addBoxCollider(mission1Colliders, 6.8, -6, 7.2, -0.75);
  const palette = skyFacadePalette(0.35, false);
  const tower = makeSkyscraper('setback', 13, 35, 11, palette[0]);
  tower.position.set(0, 4.5, -6.75);
  mission1.add(tower);
  // Glass canopy over the entrance door and a red beacon on the roof.
  box(mission1, 4, 0.15, 1.5, 0x3a3f44, 0, 3.1, -0.1, null, { color: 0x3a3f44, roughness: 0.7, metalness: 0.2 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4444 }));
  beacon.position.set(0, 40.1, -6.75); mission1.add(beacon);
}
function buildRondoutStation() {
  // Rondout station at the south end: a ground-level track with a
  // two-car commuter train, a raised concrete platform alongside it,
  // and a RONDOUT sign. The player spawns on the platform facing the
  // train (south), steps off through the open car door, and takes the
  // rental car north to the facility. Everything here is built in
  // station-local coordinates inside stationGroup (300 m south of
  // the facility, see STATION_DZ).
  const concrete = stdMat({ color: 0x8a8a86, roughness: 0.95 });
  // Station ground: the facility's 60x60 field only covers z -30 to
  // 30, so the station needs its own grass patch under the platform,
  // the track and the rental pull-off.
  const stnGround = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), stdMat({ color: 0x4a5a34, roughness: 1 }));
  stnGround.rotation.x = -Math.PI / 2; stnGround.position.set(0, 0, 12); stnGround.receiveShadow = true; stationGroup.add(stnGround);
  // Platform: 24 m long, 2.6 m wide, 0.15 m high, top at y 0.15.
  const platform = new THREE.Mesh(new THREE.BoxGeometry(24, 0.15, 2.6), concrete);
  platform.position.set(0, 0.075, 12.3); platform.receiveShadow = true; stationGroup.add(platform);
  // Yellow safety line along the platform edge.
  const edgeLine = new THREE.Mesh(new THREE.BoxGeometry(24, 0.02, 0.3), new THREE.MeshStandardMaterial({ color: 0xd8b13a, roughness: 0.8 }));
  edgeLine.position.set(0, 0.16, 11.2); stationGroup.add(edgeLine);
  // Shelter: four posts, a flat canopy roof, and a bench.
  const postMat = stdMat({ color: 0x3a3f44, metalness: 0.6, roughness: 0.4 });
  for (const [px, pz] of [[-8.8, 11.4], [-5.2, 11.4], [-8.8, 13.2], [-5.2, 13.2]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), postMat);
    post.position.set(px, 1.45, pz); post.castShadow = true; stationGroup.add(post);
  }
  const shelterRoof = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.1, 2.4), stdMat({ color: 0x2a4a6a, roughness: 0.6, metalness: 0.3 }));
  shelterRoof.position.set(-7, 2.8, 12.3); shelterRoof.castShadow = true; stationGroup.add(shelterRoof);
  const benchSeat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.5), stdMat({ color: 0x6a4a30, roughness: 0.9 }));
  benchSeat.position.set(-7, 0.62, 12.5); stationGroup.add(benchSeat);
  const benchBack = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.08), stdMat({ color: 0x6a4a30, roughness: 0.9 }));
  benchBack.position.set(-7, 0.9, 12.72); stationGroup.add(benchBack);
  // RONDOUT station sign above the platform, near the middle of the
  // platform sightline so it reads whole from the spawn and the track.
  // Shifted east and narrowed: from north-facing platform views its
  // left letters sat behind the 320px left HUD panel.
  const stnSign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('RONDOUT', '#1a2a44', '#ffd166', 'DELAWARE AQUEDUCT - 6 AM'), transparent: true, depthWrite: false }));
  stnSign.scale.set(4.0, 1.0, 1); stnSign.position.set(5.0, 3.4, 12.3); stationGroup.add(stnSign);
  // Track bed, rails and sleepers running east-west.
  const bed = new THREE.Mesh(new THREE.BoxGeometry(34, 0.12, 3.4), stdMat({ color: 0x4a4a48, roughness: 1 }));
  bed.position.set(0, 0.06, 15.3); bed.receiveShadow = true; stationGroup.add(bed);
  for (const rz of [14.6, 16.0]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(34, 0.12, 0.12), stdMat({ color: 0x9aa2a8, metalness: 0.9, roughness: 0.3 }));
    rail.position.set(0, 0.18, rz); stationGroup.add(rail);
  }
  for (let x = -16; x <= 16; x += 1.1) {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 2.4), stdMat({ color: 0x3a2f24, roughness: 1 }));
    tie.position.set(x, 0.12, 15.3); stationGroup.add(tie);
  }
  // The train: two commuter cars with lit windows, sliding doors on the
  // platform side, bogies and wheels underneath. The first car's centre
  // door stands open, warm light inside: the door he just stepped out of.
  const bodyMat = stdMat({ color: 0xb8bcc0, roughness: 0.45, metalness: 0.5 });
  const stripeMat = stdMat({ color: 0x2a4a6a, roughness: 0.5, metalness: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x201808, emissive: 0xffd166, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.3 });
  const darkGlassMat = new THREE.MeshStandardMaterial({ color: 0x0e1a24, roughness: 0.1, metalness: 0.4 });
  const train = new THREE.Group();
  for (const carX of [-3.9, 3.9]) {
    const car = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(7.4, 2.8, 2.6), bodyMat);
    body.position.y = 2.1; body.castShadow = true; car.add(body);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(7.42, 0.5, 2.62), stripeMat);
    stripe.position.y = 1.35; car.add(stripe);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.15, 2.4), stdMat({ color: 0x6a6e72, roughness: 0.7 }));
    roof.position.y = 3.55; car.add(roof);
    for (const wx of [-2.6, -1.7, 1.7, 2.6]) {
      for (const wz of [1.31, -1.31]) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.8), glassMat);
        win.position.set(wx, 2.4, wz);
        if (wz < 0) win.rotation.y = Math.PI;
        car.add(win);
      }
    }
    // Sliding doors on the platform side, one at each car centre.
    if (carX < 0) {
      // Open: the two panels slid apart, warm light spilling out.
      for (const dx of [-0.68, 0.68]) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.65, 2.1, 0.08), stdMat({ color: 0x9aa2a8, roughness: 0.5, metalness: 0.5 }));
        panel.position.set(dx, 1.75, -1.28); car.add(panel);
      }
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.0), new THREE.MeshStandardMaterial({ color: 0x201808, emissive: 0xffd166, emissiveIntensity: 1.4 }));
      glow.position.set(0, 1.75, -1.34); car.add(glow);
    } else {
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 0.08), stdMat({ color: 0x9aa2a8, roughness: 0.5, metalness: 0.5 }));
      door.position.set(0, 1.75, -1.28); car.add(door);
      const doorWin = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), glassMat);
      doorWin.position.set(0, 2.1, -1.33); car.add(doorWin);
    }
    // Bogies and wheels underneath, wheels resting on the rails.
    for (const bx of [-2.4, 2.4]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 2.2), stdMat({ color: 0x1a1d20, roughness: 0.8 }));
      bogie.position.set(bx, 0.7, 0); car.add(bogie);
      for (const [wx, wz] of [[-0.6, -0.8], [0.6, -0.8], [-0.6, 0.8], [0.6, 0.8]]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.15, 12), stdMat({ color: 0x111111, roughness: 0.9 }));
        wheel.rotation.x = Math.PI / 2; wheel.position.set(bx + wx, 0.59, wz); car.add(wheel);
      }
    }
    car.position.set(carX, 0, 15.3);
    train.add(car);
  }
  // Cab end: windshield and headlights on the east end, red tail lights
  // on the west end.
  const shield = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.9), darkGlassMat);
  shield.position.set(7.62, 2.6, 15.3); shield.rotation.y = Math.PI / 2; train.add(shield);
  for (const hz of [14.6, 16.0]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
    lamp.position.set(7.62, 1.2, hz); train.add(lamp);
  }
  for (const hz of [14.6, 16.0]) {
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    tail.position.set(-7.62, 1.2, hz); train.add(tail);
  }
  stationGroup.add(train);
}

function buildMission1() {
  // Ground: grassy upstate field, dirt track to the station.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), stdMat({ color: 0x4a5a34, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; mission1.add(ground);
  const track = new THREE.Mesh(new THREE.PlaneGeometry(3, 24), stdMat({ color: 0x6a5a44, roughness: 1 }));
  track.rotation.x = -Math.PI / 2; track.position.set(0, 0.02, 2); track.receiveShadow = true; mission1.add(track);
  // The dam, the pipes and the skyscraper: one connected water complex.
  // The reservoir is held back behind the dam wall to the west, and
  // three steel pipes run straight from the dam base into the tower.
  buildDamComplex();
  buildWaterTower();
  // Rondout station at the south end: the train he arrived on.
  buildRondoutStation();
  // Parking lot in front of the skyscraper lobby, east of the dirt
  // track, so the player's car has a marked space at the facility.
  buildParkingLot(mission1, PARKING[1].cx, PARKING[1].cz, PARKING[1].carX);
  // The area sign names this part of New York on arrival.
  const m1Sign = makeTextSprite('RONDOUT - UPSTATE NEW YORK', '#ffd166');
  m1Sign.name = 'areaSign'; m1Sign.userData.areaName = 'RONDOUT - UPSTATE NEW YORK';
  m1Sign.scale.set(7, 1.6, 1); m1Sign.position.set(0, 4.0, 2.5); mission1.add(m1Sign);
  // The station door hangs in a hinge group at its left edge, so it can
  // swing open instead of vanishing when the player enters. The slab,
  // the raised panels and the brass lever handles on both faces all ride
  // on the hinge. Each lever sits in its own pivot group at the plate,
  // so touching a handle turns the lever down (90 to 180 degrees)
  // before the door swings.
  stationDoorHinge = new THREE.Group();
  stationDoorHinge.position.set(-0.6, 0, -0.68);
  mission1.add(stationDoorHinge);
  stationLeverPivots = []; stationDoorHandleParts = [];
  window._stationDoor = box(stationDoorHinge, 1.2, 2.2, 0.15, 0x2a2118, 0.6, 1.1, 0, 'stationDoor');
  const stationHandleMat = new THREE.MeshStandardMaterial({ color: 0xd8b13a, metalness: 0.9, roughness: 0.25 });
  for (const sz of [1, -1]) {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 16), stationHandleMat);
    plate.rotation.x = Math.PI / 2;
    plate.position.set(1.05, 1.05, sz * 0.085);
    plate.name = 'stationDoor'; plate.userData.clickable = true;
    stationDoorHinge.add(plate); stationDoorHandleParts.push(plate);
    const pivot = new THREE.Group();
    pivot.position.set(1.05, 1.05, sz * 0.085);
    stationDoorHinge.add(pivot); stationLeverPivots.push(pivot);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.035), stationHandleMat);
    lever.position.set(-0.08, 0, sz * 0.03);
    lever.name = 'stationDoor'; lever.userData.clickable = true;
    pivot.add(lever); stationDoorHandleParts.push(lever);
  }
  const stationPanelMat = new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 0.6 });
  for (const py of [1.7, 0.65]) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.02), stationPanelMat);
    sp.position.set(0.6, py, 0.09); stationDoorHinge.add(sp);
  }
  // Generous invisible click target in front of the door: the door itself
  // is a thin dark slab, so a click slightly off it would otherwise miss
  // and the player could never enter the valve room.
  const doorHit = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3, 1.2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  doorHit.position.set(0, 1.4, -0.5); doorHit.name = 'stationDoor'; doorHit.userData.clickable = true; mission1.add(doorHit);
  window._stationDoorHit = doorHit;
  // The station key hangs on a hook beside the door, with a gold glow
  // and a floating label, so the player can find it before he needs
  // the door. Clicking it (or walking up to it) picks it up, and the
  // door unlocks. The key is always here, so the player can never get
  // stuck at the locked door. The key parts are unlit bright gold and
  // oversized: as a small lit-metal key on a dark wall it was never
  // visually located on the live checks (the wall read as bare). The
  // hook itself is a permanent wall fixture (plate + curved hook on
  // the lobby face), separate from the key group, so the hook is
  // still there to see after the key has been taken.
  const hookMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.85, roughness: 0.35 });
  const hookPlate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.34, 0.04), hookMat);
  hookPlate.position.set(1.5, 1.82, -0.73); hookPlate.name = 'stationKeyHook'; mission1.add(hookPlate);
  const hookCurve = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.022, 8, 16, Math.PI * 1.35), hookMat);
  hookCurve.position.set(1.5, 1.74, -0.66); hookCurve.rotation.set(0, Math.PI / 2, Math.PI * 0.82); hookCurve.name = 'stationKeyHook'; mission1.add(hookCurve);
  const hookArm = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 8), hookMat);
  hookArm.rotation.x = Math.PI / 2; hookArm.position.set(1.5, 1.74, -0.7); hookArm.name = 'stationKeyHook'; mission1.add(hookArm);
  const keyGroup = new THREE.Group();
  const keyMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
  const keyRing = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.05, 8, 20), keyMat);
  keyRing.position.set(0, 0.18, 0); keyGroup.add(keyRing);
  const keyStem = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.06), keyMat);
  keyStem.position.set(0.1, -0.14, 0); keyGroup.add(keyStem);
  const keyTooth = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.07, 0.06), keyMat);
  keyTooth.position.set(0.17, -0.3, 0); keyGroup.add(keyTooth);
  const keyGlow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
  keyGroup.add(keyGlow);
  // Never frustum-cull the key: it is the one small object the
  // player must spot on a big dark wall.
  keyGroup.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  keyGroup.position.set(1.5, 1.5, -0.6);
  keyGroup.name = 'stationKey'; keyGroup.userData.clickable = true;
  keyGroup.userData.keyId = 'station'; keyGroup.userData.keyLabel = 'station key';
  mission1.add(keyGroup);
  window._stationKey = keyGroup;
  // Generous invisible click target around the key: the group itself
  // has no geometry, so a click on the key meshes would miss it.
  const keyHit = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.9), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  keyHit.position.set(1.5, 1.5, -0.6); keyHit.name = 'stationKey'; keyHit.userData.clickable = true; mission1.add(keyHit);
  window._stationKeyHit = keyHit;
  const keyLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('STATION KEY', '#1a2a44', '#ffd166', ''), transparent: true, depthWrite: false }));
  keyLabel.scale.set(2.0, 0.5, 1); keyLabel.position.set(1.5, 2.15, -0.6); keyLabel.name = 'stationKeyLabel'; mission1.add(keyLabel);
  window._stationKeyLabel = keyLabel;
  // A pulsing gold marker over the hook, like the guards' markers:
  // the key is small against a big wall and was never visually
  // located on the live checks, so the hook gets the same "look
  // here" cue every other objective in the game already has.
  const keyMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: guardMarkerTex, color: 0xffd166, transparent: true, depthWrite: false }));
  keyMarker.scale.set(0.8, 0.8, 1); keyMarker.position.set(1.5, 2.85, -0.6); keyMarker.name = 'stationKeyMarker'; mission1.add(keyMarker);
  window._stationKeyMarker = keyMarker;
  for (const wx of [-3, 3]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1), new THREE.MeshStandardMaterial({ color: 0x0e1a24, roughness: 0.1, metalness: 0.4 }));
    win.position.set(wx, 2, -0.72); mission1.add(win);
  }
  // Facility sign on the lobby face, shifted east and narrowed: from
  // the parked car in the lot (east of the door) the old centred 5.5 m
  // sign put its R behind the top-left HUD panel. At x 3.8, 3.4 m
  // wide, the whole text clears the panel from the car, from the lot
  // and from the platform spawn.
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('RONDOUT DAM', '#2a2118', '#ffd166', 'WATER FACILITY'), transparent: true, depthWrite: false }));
  sign.scale.set(3.4, 0.83, 1); sign.position.set(3.8, 4.0, -0.6); mission1.add(sign);
  // The valve room, inside the control station: the player enters through
  // the station door and walks to the valves. The three valve assemblies
  // live on the back wall of the room, not outside on a plinth, so the
  // valve puzzle only opens once he has walked in to reach them.
  buildValveRoom();
  const valveDefs = [
    { key: 'hospital', label: 'HOSPITAL', color: 0x7ac74f, x: -3, labelX: -1.35 },
    { key: 'residential', label: 'RESIDENTIAL', color: 0x4cc9f0, x: 0, labelX: 0 },
    { key: 'industrial', label: 'INDUSTRIAL', color: 0xffd166, x: 3, labelX: 2.55 }
  ];
  window._valveMeshes = {};
  for (const v of valveDefs) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.6, 12), stdMat({ color: 0x6a747a, metalness: 0.8, roughness: 0.35 }));
    pipe.rotation.z = Math.PI / 2; pipe.position.set(v.x, 0.55, -5.7); pipe.castShadow = true; mission1.add(pipe);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 10, 24), new THREE.MeshStandardMaterial({ color: v.color, emissive: v.color, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.3 }));
    wheel.position.set(v.x, 1.25, -5.7); wheel.castShadow = true;
    wheel.name = 'valve' + v.key[0].toUpperCase() + v.key.slice(1); wheel.userData.clickable = true; mission1.add(wheel);
    window._valveMeshes[v.key] = wheel;
    // Generous invisible click target around the whole valve assembly: the
    // torus is a thin ring with an empty hub, so a click dead-centre on the
    // wheel (the obvious place to click) would otherwise miss it entirely.
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.6, 1.2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.position.set(v.x, 1.4, -5.7); hit.name = wheel.name; hit.userData.clickable = true; mission1.add(hit);
    window._valveMeshes[v.key + 'Hit'] = hit;
    const spokes = [];
    for (let s = 0; s < 3; s++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.8, 0.05), stdMat({ color: v.color, roughness: 0.5 }));
      spoke.position.copy(wheel.position); spoke.rotation.z = s * Math.PI / 3; mission1.add(spoke); spokes.push(spoke);
    }
    // Real 3D pressure gauge above the valve: brass rim, glass face,
    // numbered dial and a needle that follows the live pressure, with a
    // copper pipe and a glass sight tube carrying visible water flow.
    const rec = buildPressureGauge(v);
    rec.wheel = wheel; rec.spokes = spokes;
    pressureGauges[v.key] = rec;
    // Clicking the gauge opens the pressure controls, same as its valve.
    const gaugeHit = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 0.5), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    gaugeHit.position.set(v.x, 2.3, -5.8); gaugeHit.name = wheel.name; gaugeHit.userData.clickable = true; mission1.add(gaugeHit);
    window._valveMeshes[v.key + 'GaugeHit'] = gaugeHit;
    const lbl = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(v.label, '#111111', '#e8e8e8', ''), transparent: true, depthWrite: false }));
    // The label sits in front of the ceiling pipe drops: the drops
    // (radius 0.22 at z -5.7) have their front surface at z -5.48,
    // which poked through the old label plane at z -5.5 and hid the
    // first letters ("INDUSTRIAL" read "NDUSTRIAL"). At z -5.4 the
    // whole board is in front of every pipe. The HOSPITAL board sits
    // further inboard (labelX -1.35) and all three are narrower
    // (1.05 m) and lower (y 2.62, under the back VALVE ROOM sign at
    // y 2.98), so "HOSPITAL" reads whole from the door, clear of the
    // top-left HUD panel, and from each valve at close range. The
    // dial faces carry the line names too, so the offset board still
    // reads as its line's label.
    lbl.scale.set(1.05, 0.26, 1); lbl.position.set(v.labelX, 2.62, -5.4); mission1.add(lbl);
  }
  // A long main pipe along the back wall, joining the three valves.
  const mainPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 7.5, 12), stdMat({ color: 0x6a747a, metalness: 0.8, roughness: 0.35 }));
  mainPipe.rotation.z = Math.PI / 2; mainPipe.position.set(0, 0.4, -5.85); mainPipe.castShadow = true; mission1.add(mainPipe);
  // Digital control panel, cracked screen, red warning light - sabotaged.
  // It stands on the grass east of the tower entrance (the lobby face is
  // solid, so it cannot stay where the old building's wall was).
  const panel = box(mission1, 1.6, 2, 0.5, 0x2a2f33, 8.2, 1.2, -1, 'digitalPanel', { color: 0x2a2f33, roughness: 0.5, metalness: 0.4 });
  panel.rotation.y = -0.5;
  // The panel is a solid free-standing box east of the lobby: the
  // player walks around it, not through it. It stays clickable from
  // 0.35 m out (the collider stops him at its face, the click target
  // is the panel itself).
  addBoxCollider(mission1Colliders, 7.38, -1.6, 9.02, -0.4);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.9), new THREE.MeshStandardMaterial({ color: 0x1a0505, emissive: 0xff2222, emissiveIntensity: 0.8, roughness: 0.3 }));
  screen.position.set(8.0, 1.5, -0.72); screen.rotation.y = -0.5; mission1.add(screen);
  const warnGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xff2222, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  warnGlow.scale.set(1.6, 1.6, 1); warnGlow.position.set(8.0, 2.4, -0.7); mission1.add(warnGlow);
  // Sabotage device (hidden until the water is stable): small green board
  // under the staircase inside the valve room, pinned to the east wall
  // beneath the flight, where the player can see it from the room floor
  // by looking under the steps. It used to sit outside on the station
  // wall, so the player had to go back out to find it.
  const dev = box(mission1, 0.05, 0.25, 0.35, 0x7ac74f, 3.9, 0.8, -2.6, 'device1');
  dev.rotation.y = 0; dev.visible = false;
  window._device1 = dev;
  // Generous invisible click target for the small device, same reason as the valves.
  const devHit = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 1.2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  devHit.position.set(3.75, 0.8, -2.6); devHit.name = 'device1'; devHit.userData.clickable = true; devHit.visible = false; mission1.add(devHit);
  window._device1Hit = devHit;
  blobShadow(mission1, -2.8, 6, 0.9, 0.9, 0.55);
  blobShadow(mission1, 2.8, 6, 0.9, 0.9, 0.55);
}
// Valve-balance puzzle (Mission 1).
const pressures = { hospital: 60, residential: 60, industrial: 60 };
let valveTimer = null, stableHold = 0, valveOpen = false;
let valveReopenAt = 0; // walk-up reopen cooldown after Close (see valveClose)
function renderValve() {
  const map = { hospital: 'Hosp', residential: 'Res', industrial: 'Ind' };
  for (const k of Object.keys(pressures)) {
    document.getElementById('press' + map[k]).style.width = pressures[k] + '%';
    document.getElementById('press' + map[k] + 'Val').textContent = pressures[k] + '%';
  }
  // The underground sensor vault reads the same three lines: keep the
  // latest pressures where the vault can read them.
  try { localStorage.setItem('lastSignalPressures', JSON.stringify(pressures)); } catch (e) { /* ignore */ }
  const allOk = Object.values(pressures).every(p => p >= 70);
  document.getElementById('valveStatus').textContent = allOk
    ? 'All lines at 70% or more - holding steady... ' + stableHold + ' / 3s' + (state.trust >= 7 ? ' (Caleb holds the Industrial valve by radio.)' : '')
    : 'Hold all three lines at 70% or above.' + (state.trust >= 7 ? ' Caleb holds the Industrial valve by radio.' : ' Caleb is not sure of the sequence yet - the Industrial valve drifts faster.');
}
function openValveModal() {
  valveOpen = true; stableHold = 0;
  document.getElementById('valveModal').classList.remove('hidden');
  renderValve();
  if (valveTimer) clearInterval(valveTimer);
  valveTimer = setInterval(() => {
    if (!valveOpen) return;
    // The sabotaged digital control overcorrects: one valve drops on its own.
    const keys = ['hospital', 'residential', 'industrial'];
    const k = keys[Math.floor(Math.random() * keys.length)];
    const drop = (k === 'industrial' && state.trust < 7) ? 8 : 6;
    pressures[k] = Math.max(20, pressures[k] - drop);
    if (state.trust >= 7) pressures.industrial = Math.max(pressures.industrial, 70); // Caleb holds it
    try { sfxThud(); } catch (e) { /* ignore */ } // the sabotage clunks as a valve drops
    renderValve();
  }, 5000);
}
document.querySelectorAll('#valveModal button[data-line]').forEach(b => {
  b.onclick = () => {
    const k = b.dataset.line, d = parseInt(b.dataset.d, 10);
    pressures[k] = Math.max(20, Math.min(100, pressures[k] + d));
    try { sfxRepair(); } catch (e) { /* ignore */ }
    renderValve();
  };
});
document.getElementById('valveClose').onclick = () => {
  valveOpen = false;
  // Give the player a moment to walk away from the wheel: without this
  // the walk-up trigger reopens the modal on the very next frame while
  // he is still standing at the valve, so Close appears to do nothing.
  valveReopenAt = Date.now() + 2500;
  if (valveTimer) { clearInterval(valveTimer); valveTimer = null; }
  document.getElementById('valveModal').classList.add('hidden');
};
// Stability is checked once a second while the modal is open.
setInterval(() => {
  if (!actActive) return;
  if (!valveOpen || state.waterStable) return;
  if (Object.values(pressures).every(p => p >= 70)) {
    stableHold++;
    renderValve();
    if (stableHold >= 3) {
      state.waterStable = true; valveOpen = false;
      if (valveTimer) { clearInterval(valveTimer); valveTimer = null; }
      document.getElementById('valveModal').classList.add('hidden');
      integrity('Water', 10);
      setObjectives(OBJ1, 3);
      window._device1.visible = true; window._device1Hit.visible = true;
      toast('Pressure holding - the aqueduct is stable. Something under the staircase catches your eye.');
      moralChoiceWater();
    }
  } else stableHold = 0;
}, 1000);
function moralChoiceWater() {
  showDialogue([
    { who: 'Caleb', text: 'Three lines. Hospital, residential, industrial. We cannot run all three at full pressure - not with the digital control fighting us.' },
    { who: 'Jade', text: 'Hospital is obvious. But the residential line serves a dialysis clinic. And the industrial line feeds the treatment plant - drop it too low and the water is not safe.' },
    { who: 'Jade', text: 'There is no clean answer. We choose - and then we tell the truth about what we did. You pick, Caleb. I trust you.', choices: [
      { label: 'Hospital full - residential reduced 2 hours', effect: () => { integrity('Water', 5); integrity('Comms', 5); state.waterChoice = 'Hospital'; } },
      { label: 'Residential full - protect the dialysis clinic', effect: () => { integrity('Water', 5); trust(1, 'you protected the clinic'); state.waterChoice = 'Residential'; } },
      { label: 'Industrial full - protect the treatment plant', effect: () => { integrity('Power', 5); integrity('Water', -5); state.waterChoice = 'Industrial'; } }
    ] },
    { who: 'Radio', text: 'Copy, Bishop. We will make it work. Hospitals report pressure coming back up.' },
    { who: 'Caleb', text: 'It does not feel good.' },
    { who: 'Jade', text: 'It is not supposed to. Now - that board on the wall. Click it. It is not MTA issue.' }
  ], () => { setObjectives(OBJ1, 4); toast('Click the small green circuit board under the staircase, here in the valve room.'); });
}
// Act II arrival: the player steps off the train at Rondout station.
// No briefing, no dialogue yet: he takes the rental car by the
// platform (0.05 ZAMA) and drives it to the facility first, and the
// mission starts when that drive arrives (see startRentalDrive).
function startArrival() {
  try { registerLipSyncHumans(humans); } catch (e) { /* lip-sync is best effort */ }
  mission1Started = false; arrivalDone = false;
  rentalTaken = false; arrivedByRental = false; travelRental = false;
  // Station door: fresh entry, the single door shut again.
  stationDoorAnim = null; stationDoorOpen = false;
  try { if (stationDoorHinge) stationDoorHinge.rotation.y = 0; } catch (e) { /* ignore */ }
  for (const p of stationLeverPivots) { try { if (p) p.rotation.z = 0; } catch (e) { /* ignore */ } }
  hideTakeRentalButton();
  setTimeOfDay('day'); // Rondout arrival is bright morning.
  currentPlaceKey = 'reservoir';
  setObjectives(['Take the rental car to the water facility: walk to the rental car and click it'], 0);
  updateHUD();
  camera.position.set(ARRIVAL_VIEW.pos[0], ARRIVAL_VIEW.pos[1], ARRIVAL_VIEW.pos[2]);
  // Sync the stored ground position: coming from Act I the stored spot
  // is a train-car position, and beginPlayerFrame would snap him there.
  try { setPlayerPos(ARRIVAL_VIEW.pos[0], ARRIVAL_VIEW.pos[2]); } catch (e) { /* ignore */ }
  state.yaw = ARRIVAL_VIEW.yaw; state.pitch = 0; camBounds = STATION_VIEW;
  // The player's car is already parked in the lot in front of the
  // tower at the facility, 300 m north; he reaches it after the
  // rental drive.
  parkPlayerCar(1);
  // A rental car waits by the platform end (0.05 ZAMA): he drives it to the
  // facility, parks it, and only then does the mission begin.
  buildStationRental();
  toast('Rondout station, 6 AM. You step off the train. A rental car is waiting by the platform - 0.05 ZAMA. Take it to the water facility.');
}
function startMission1() {
  if (mission1Started) return; // the arrival trigger fires exactly once
  mission1Started = true;
  // The drive hides every mission scene while the road shows; Missions 2
  // and 3 put their own scene back when they start, but Mission 1 never
  // did, so after a drive the arrival rendered an empty dark void until
  // something else restored the scene. Show it here, first, so the
  // parking scene is visible from the first frame after the drive ends.
  mission1.visible = true; mission2.visible = false; mission3.visible = false;
  hideTakeRentalButton(); // the rental step is done; the button must not linger
  // Third person on entering the mission, so the player sees himself.
  try { setThirdPerson(true); } catch (e) { /* camera is best effort */ }
  // Build the jaw morphs now that the game is on screen, not during the
  // load: mouth estimation must never be able to hold the loading overlay
  // up. The morphs are ready before the first line needs them.
  try { registerLipSyncHumans(humans); } catch (e) { /* lip-sync is best effort */ }
  // A mission always starts outside the valve room: clear the flag so
  // resetView below uses this mission's bounds, not the valve room's.
  inValveRoom = false;
  resetView();
  setTimeOfDay('day'); // Mission 1 (aqueduct) is bright day.
  currentPlaceKey = 'reservoir';
  // The car stays parked in the lot in front of the tower (already
  // parked on arrival; rebuilt here if this start came another way).
  parkPlayerCar(1);
  // Seating happens below, with the briefing as the get-out callback
  // (same pattern as Mission 2).
  // If the player already has the station key (a replay), the key
  // mesh beside the door is hidden so it cannot be picked up twice.
  try {
    const hasIt = hasKey('station');
    if (window._stationKey) window._stationKey.visible = !hasIt;
    if (window._stationKeyHit) window._stationKeyHit.visible = !hasIt;
    if (window._stationKeyLabel) window._stationKeyLabel.visible = !hasIt;
    if (window._stationKeyMarker) window._stationKeyMarker.visible = !hasIt;
  } catch (e) { /* ignore */ }
  setObjectives(OBJ1, 0); updateHUD();
  document.getElementById('timerLabel').textContent = 'Water pressure';
  document.getElementById('timerVal').textContent = 'dropping 2%/hr';
  document.getElementById('timerBar').style.width = '80%';
  // Every mission starts with a briefing: who asked, what is wrong, and
  // what is at stake. The phone call (Act I) covered the first mission;
  // this is the reason for Mission 1. The briefing waits until the
  // player is on foot: on the rental-drive arrival he starts seated
  // in the parked car, and the briefing must never fire while he is
  // still sitting in it (the live check found the Mission 1 briefing
  // modal open over the seated player). It runs as the get-out
  // callback, same as Mission 2; any other entry stands him beside
  // the car and runs it at once.
  const startBriefing = () => {
  showBriefing({
    title: 'Mission 1 - The Water',
    calledBy: 'Jade Morales, MTA signal engineer - she called you at dawn.',
    problem: 'The Delaware Aqueduct pressure is dropping two percent an hour. The valves are inside the water facility, and someone has been tampering with them.',
    stakes: 'Half the city\u2019s water. In 36 hours the taps run dry - hospitals, homes, the treatment plant. And the man behind it used to run the city\u2019s planning office.'
  }, () => {
  showDialogue([
    { who: 'Jade Morales', text: 'Next morning, 6 AM. The Delaware Aqueduct - eighty-five miles, half the city\u2019s water. Pressure is dropping two percent an hour. Thirty-six hours and the taps run dry.' },
    { who: 'Caleb Bishop', text: 'And this Derrick Shaw - he used to work for the city?' },
    { who: 'Jade Morales', text: 'Deputy Director of City Planning, twenty years. He wrote the vulnerability report in 2019. The one they ignored. He was my mentor, once.' },
    { who: 'Caleb Bishop', text: 'So he is not just some lunatic.' },
    { who: 'Jade Morales', text: 'No. He watched the system fail and decided the only way to fix it was to break it. I agree with his diagnosis. Not his prescription.' }
  ], () => {
    setObjectives(OBJ1, 1);
    toast('Enter the valve room through the station door - the valves are inside. Walk up to a valve wheel to open the pressure controls.');
  });
  });
  };
  if (!seatIfDrove(1, startBriefing)) { applyDriveSpawn(1); startBriefing(); }
}

// ---------- The rental car: Rondout station to the water facility ----------
// The player steps off the train, takes a rental car by the platform
// (0.05 ZAMA) and drives it to the facility. The rental is a plain
// light-grey sedan with no brand and no logo; the UI calls it a rental car.
function buildRentalCar() {
  const car = buildCar(0xcfd4d6, { type: 'sedan' });
  car.userData.carName = 'Rental car';
  return car;
}
function buildStationRental() {
  disposeStationRental();
  const g = new THREE.Group();
  // Asphalt pull-off under the car, east of the dirt track by the
  // platform end, so it reads as a parked rental, not a car on the grass.
  const pad = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.06, 5.6), stdMat({ color: 0x3a3d40, roughness: 0.95 }));
  pad.position.set(4.5, 0.03, 9.0); pad.receiveShadow = true; g.add(pad);
  const car = buildRentalCar();
  car.rotation.y = Math.PI; // facing north, up the track toward the facility
  car.position.set(4.5, 0, 9.0);
  g.add(car);
  // Floating board sign so the player can find it from the platform: a
  // solid dark board (not bare text on transparency, which vanished
  // against the sky and trees and never read whole on the live checks).
  // It stands between the track and the car, north of the pad, so it
  // reads whole on the walk north from the platform (over the car at
  // x 4.5 it sat far right of the northward view and was never seen).
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('RENTAL CAR - 0.05 ZAMA', '#1a2a44', '#ffd166', ''), transparent: true, depthWrite: false }));
  // Shifted east and narrowed: at 6 m wide centred on x 1.8 its left
  // letters ("RENTAL") stayed behind the 320px left HUD panel from
  // every platform viewpoint on the live checks.
  label.scale.set(4.8, 1.2, 1); label.position.set(3.2, 3.0, 8.5); g.add(label);
  // Generous invisible hit box over the car, so a tap anywhere on it
  // takes the rental.
  const hit = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.4, 5.2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.position.set(4.5, 1.1, 9.0); hit.name = 'rentalCar'; hit.userData.clickable = true; g.add(hit);
  stationGroup.add(g);
  stationRental = { group: g, hit, label };
  window._rentalCarHit = hit;
}
function disposeStationRental() {
  if (!stationRental) return;
  try { stationGroup.remove(stationRental.group); } catch (e) { /* ignore */ }
  try { disposeCarGroup(stationRental.group); } catch (e) { /* ignore */ }
  stationRental = null; window._rentalCarHit = null;
}
// Gold on-screen button, the forgiving path for players who walk up to
// the rental without thinking to click it. Mirrors the Get out button.
function showTakeRentalButton() {
  if (!takeRentalBtnEl) {
    takeRentalBtnEl = document.createElement('div');
    takeRentalBtnEl.id = 'takeRentalBtn';
    takeRentalBtnEl.innerHTML = '<button type="button" id="takeRentalBtnInner" style="padding:14px 26px;font-size:17px;font-weight:bold;background:#ffd166;color:#111;border:none;border-radius:10px;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,0.5);">Take the rental car</button>';
    takeRentalBtnEl.style.cssText = 'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:56;text-align:center;pointer-events:auto;';
    document.body.appendChild(takeRentalBtnEl);
    document.getElementById('takeRentalBtnInner').onclick = () => { startRentalDrive(); };
  }
  takeRentalBtnEl.style.display = 'block';
}
function hideTakeRentalButton() { if (takeRentalBtnEl) takeRentalBtnEl.style.display = 'none'; }
// Take the rental and drive it to the water facility. Short drive: the
// station and the facility share one map, so the drive is the 12-second
// minimum. On arrival the rental parks in the lot and the mission
// briefing starts only then.
function startRentalDrive() {
  if (rentalTaken || travelActive || mission1Started) return;
  if (getBalance() < 0.05) { toast('You need 0.05 ZAMA for the rental car.'); return; }
  rentalTaken = true;
  hideTakeRentalButton();
  // The station rental is the car he drives: take it off the platform
  // so it does not sit there twice after the drive.
  disposeStationRental();
  travelRental = true;
  mapFromKey = 'reservoir';
  try {
    startTravelDrive('reservoir', () => {
      arrivedByRental = true;
      startMission1();
    });
    spendMoney(0.05);
    toast('Rental car - 0.05 ZAMA. Balance: ' + moneyFmt(getBalance()) + '.');
  } catch (e) {
    // The drive did not start: put the rental back and let him try again.
    travelRental = false; rentalTaken = false;
    buildStationRental();
    toast('The rental car would not start - try again.');
  }
}

// ---------- Mission 2: The Grid (Con Edison substation) ----------
let keycardMesh, logbookMesh, scadaMesh, manifestoMesh, bombInterval = null, bombTime = 90;
let scadaQteDone = false; // the surge quick-time fires once per SCADA open
// The feeders start OFF target (total 115, feeder A over the 60 cap),
// so the reroute is a real puzzle and the surge quick-time at 20 s
// fires while the player is still working. 33/33/34 stays a valid
// solution, as does any split totalling exactly 100 with none over 60.
const FEEDER_START = { A: 70, B: 25, C: 20 };
const feeders = { A: FEEDER_START.A, B: FEEDER_START.B, C: FEEDER_START.C };
let hasKeycard = false, hasPassphrase = false, guardsDown = false;
// The bluff (walk-up or click) waits for the Mission 2 briefing to
// finish: during the briefing card and the get-out beat the player
// can already be standing near the gate line, and an early trigger
// there stood the line down before he ever saw it patrol.
let mission2BriefingDone = false;
function buildMission2() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), stdMat({ color: 0x3a3f42, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; mission2.add(ground);
  // Chain-link fence around the yard: posts + translucent mesh panels.
  // The panels carry a faint emissive so they never render pure black at
  // dusk (at 0.35 opacity with no emissive the whole fence vanished
  // against the dark sky on the live checks), and a steel top rail runs
  // along every side so the yard boundary reads as a line from the lot.
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x9aa6ae, roughness: 0.4, metalness: 0.7, transparent: true, opacity: 0.6, emissive: 0x141a20, emissiveIntensity: 1 });
  const railMat = stdMat({ color: 0x8a949c, metalness: 0.8, roughness: 0.35 });
  for (const z of [-6, 12]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(20, 3), fenceMat);
    f.position.set(0, 1.5, z); if (z === 12) f.rotation.y = Math.PI; mission2.add(f);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(20, 0.07, 0.07), railMat);
    rail.position.set(0, 3.0, z); mission2.add(rail);
  }
  for (const x of [-10, 10]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(18, 3), fenceMat);
    f.position.set(x, 1.5, 3); f.rotation.y = Math.PI / 2; mission2.add(f);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 18), railMat);
    rail.position.set(x, 3.0, 3); mission2.add(rail);
  }
  for (let x = -10; x <= 10; x += 2.5) for (const z of [-6, 12]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 8), stdMat({ color: 0x6a747a, metalness: 0.8, roughness: 0.4 }));
    p.position.set(x, 1.5, z); mission2.add(p);
  }
  // Two transformers with insulator stacks.
  for (const tx of [-4, 4]) {
    box(mission2, 3, 2.6, 2, 0x5d7050, tx, 1.3, -2, null, { roughness: 0.7, metalness: 0.4 });
    for (let i = 0; i < 3; i++) {
      const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.1, 10), stdMat({ color: 0xb8b0a0, roughness: 0.6 }));
      ins.position.set(tx - 0.8 + i * 0.8, 3.1, -2); ins.castShadow = true; mission2.add(ins);
    }
    const hum = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xffc978, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false }));
    hum.scale.set(3, 2, 1); hum.position.set(tx, 2, -2); mission2.add(hum);
  }
  // Control room building + SCADA terminal + log book. The walls are a
  // lighter warm grey than the old 0x5a5a55 (which rendered as a black
  // slab at dusk), with lit windows on the yard face and a pale roof
  // slab, so the building reads as a building from the parking lot.
  box(mission2, 7, 3.2, 4.5, 0x82827a, 0, 1.6, -4.5, null, { roughness: 0.95 });
  box(mission2, 7.5, 0.25, 5.0, 0x9c9c94, 0, 3.32, -4.5, null, { roughness: 0.9 });
  const winMat = new THREE.MeshStandardMaterial({ color: 0x2a2010, emissive: 0xffd9a0, emissiveIntensity: 1.1, roughness: 0.3 });
  for (const wx of [-0.6, 0.4, 2.7]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.12, 1.02, 0.04), stdMat({ color: 0x3a3f44, metalness: 0.6, roughness: 0.4 }));
    frame.position.set(wx, 2.1, -2.23); mission2.add(frame);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.9), winMat);
    win.position.set(wx, 2.1, -2.20); mission2.add(win);
  }
  box(mission2, 1.4, 2.4, 0.15, 0x2a2118, -2, 1.2, -2.2, 'controlDoor');
  // The control-room door is a real door, not a flat slab: a brass
  // lever handle on its face and a lit sign over it, so the player can
  // find it and click it. It stays click-only by design - there is no
  // interior to walk into; the room is a solid SCADA box, the key card
  // opens it from the guards, and the terminal, log book and manifesto
  // are all used from outside.
  const controlHandleMat = new THREE.MeshStandardMaterial({ color: 0xd8b13a, metalness: 0.9, roughness: 0.25 });
  const controlPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 16), controlHandleMat);
  controlPlate.rotation.x = Math.PI / 2;
  controlPlate.position.set(-1.35, 1.15, -2.1); mission2.add(controlPlate);
  const controlLever = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.035), controlHandleMat);
  controlLever.position.set(-1.43, 1.15, -2.13); mission2.add(controlLever);
  const controlSign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('CONTROL ROOM', '#1a2a44', '#ffd166', ''), transparent: true, depthWrite: false }));
  controlSign.scale.set(2.4, 0.6, 1); controlSign.position.set(-2, 2.75, -2.1); mission2.add(controlSign);
  const desk = box(mission2, 2.2, 0.9, 0.8, 0x3a2f24, 2.5, 0.45, 1.5);
  desk.rotation.y = -0.4;
  scadaMesh = box(mission2, 1.1, 0.75, 0.08, 0x111111, 2.5, 1.35, 1.35, 'scada');
  scadaMesh.rotation.y = -0.4;
  const scadaScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6), new THREE.MeshStandardMaterial({ color: 0x061a12, emissive: 0x2aff7a, emissiveIntensity: 0.5, roughness: 0.3 }));
  scadaScreen.position.set(2.42, 1.38, 1.28); scadaScreen.rotation.y = -0.4; mission2.add(scadaScreen);
  logbookMesh = box(mission2, 0.4, 0.06, 0.3, 0x8a2a2a, 1.9, 0.95, 1.7, 'logbook');
  logbookMesh.rotation.y = 0.5;
  var logbookHit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  logbookHit.position.set(1.9, 0.95, 1.7); logbookHit.name = 'logbook'; logbookHit.userData.clickable = true; mission2.add(logbookHit);
  window._logbookHit = logbookHit;
  // Manifesto pinned to the control-room wall (revealed after the bomb is dealt with).
  manifestoMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.2), new THREE.MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.9 }));
  manifestoMesh.position.set(1.5, 1.8, -2.22); manifestoMesh.name = 'manifesto'; manifestoMesh.userData.clickable = true;
  manifestoMesh.visible = false; mission2.add(manifestoMesh);
  var manifestoHit = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 0.5), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  manifestoHit.position.set(1.5, 1.8, -2.1); manifestoHit.name = 'manifesto'; manifestoHit.userData.clickable = true; manifestoHit.visible = false; mission2.add(manifestoHit);
  window._manifestoHit = manifestoHit;
  // Security cameras on poles, with vision cones.
  for (const cx of [-6, 6]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 8), stdMat({ color: 0x6a747a, metalness: 0.8, roughness: 0.4 }));
    pole.position.set(cx, 1.7, 0); mission2.add(pole);
    const cam = box(mission2, 0.35, 0.2, 0.5, 0x1a1d20, cx, 3.4, 0, 'camera');
    cam.rotation.y = cx > 0 ? -0.6 : 0.6;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.4, 4, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }));
    cone.rotation.x = Math.PI / 2 - 0.5; cone.position.set(cx, 2.6, 2); mission2.add(cone);
  }
  // Key card on the first guard's belt (hidden until the guards stand
  // down). Oversized and unlit bright white with a gold stripe, a glow
  // and a pulsing marker above it: the old card was a real-size
  // 0.16 x 0.1 m lit box flush against the guard's waist (z +0.15 from
  // his centre, inside his torso silhouette and behind his hanging
  // arm from every approach angle), so on the live check no white
  // card could be seen on either guard's belt and the chain blocked
  // at the SCADA terminal. The follow code in the animate loop keeps
  // it on his front hip once he stands down and turns to face the
  // player.
  keycardMesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.03), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  keycardMesh.position.set(-3.5, 1.02, 2.24); keycardMesh.name = 'keycard'; keycardMesh.userData.clickable = true;
  keycardMesh.visible = false; mission2.add(keycardMesh);
  const cardStripe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.005), new THREE.MeshBasicMaterial({ color: 0xd4af37 }));
  cardStripe.position.set(0, 0.05, 0.02); keycardMesh.add(cardStripe);
  const cardGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xffffff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  cardGlow.scale.set(0.85, 0.85, 1); cardGlow.name = 'keycardGlow'; keycardMesh.add(cardGlow);
  window._keycardGlow = cardGlow;
  const cardMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: guardMarkerTex, color: 0xffffff, transparent: true, depthWrite: false }));
  cardMarker.scale.set(0.55, 0.55, 1); cardMarker.position.set(0, 0.62, 0); cardMarker.name = 'keycardMarker'; keycardMesh.add(cardMarker);
  window._keycardMarker = cardMarker;
  // A generous invisible hit box around the guard's belt, so a tap
  // anywhere on his front collects the card.
  var keycardHit = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.0), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  keycardHit.position.set(-3.5, 1.05, 2.15); keycardHit.name = 'keycard'; keycardHit.userData.clickable = true; keycardHit.visible = false; mission2.add(keycardHit);
  window._keycardHit = keycardHit;
  blobShadow(mission2, -3.5, 2, 0.9, 0.9, 0.55);
  blobShadow(mission2, 3.5, 2, 0.9, 0.9, 0.55);
  // Parking lot in the yard forecourt, west of the spawn, in front of
  // the control room: the player's car pulls in here off the road.
  buildParkingLot(mission2, PARKING[2].cx, PARKING[2].cz, PARKING[2].carX);
  // A lamp over the lot and a lit sign on the control room, so the yard
  // reads at dusk: the lot, the P sign and the building were lost in the
  // dark on the first live check, and the road beyond the fence was the
  // only thing that read.
  try { const lotLamp = makeStreetLight(Math.PI, 0.08); lotLamp.group.position.set(-8.5, 0, 5.0); mission2.add(lotLamp.group); } catch (e) { /* lamp is decoration */ }
  // Real yard floodlights. The street lamps above only fake their light
  // (emissive head + glow sprite + ground pool) - they never light the
  // yard surfaces, so at dusk the control room, transformers and guards
  // rendered near-black and the yard read as empty dark ground with the
  // lit city street beyond it. These two poles flank the guard line and
  // carry real point lights, plus one at the lot lamp head, so the whole
  // yard - lot, guards, transformers, control room - is lit on arrival.
  const floodPoleMat = stdMat({ color: 0x4a5058, metalness: 0.7, roughness: 0.4 });
  const floodHeadMat = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, emissive: 0xffd9a0, emissiveIntensity: 1.25, roughness: 0.4 });
  for (const fx of [-6.5, 6.5]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 4.6, 10), floodPoleMat);
    pole.position.set(fx, 2.3, 4.5); pole.castShadow = true; mission2.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.35), floodHeadMat);
    head.position.set(fx, 4.65, 4.5); head.rotation.x = 0.5; mission2.add(head);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xffe9a8, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(3.2, 3.2, 1); glow.position.set(fx, 4.5, 4.5); mission2.add(glow);
    // Toned down from 180: at full strength the yard read bright and
    // daylike for dusk on the live check. 130 keeps every surface
    // readable (guards, sign, lot, control room) under a dusk sky.
    const fl = new THREE.PointLight(0xffd9a0, 130, 36, 2);
    fl.position.set(fx, 4.4, 4.5); mission2.add(fl);
  }
  const lotLight = new THREE.PointLight(0xffd9a0, 100, 32, 2);
  lotLight.position.set(-8.5, 4.1, 6.1); mission2.add(lotLight);
  const subSign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('CON EDISON SUBSTATION', '#1a2a44', '#ffd166', ''), transparent: true, depthWrite: false }));
  subSign.scale.set(8, 2, 1); subSign.position.set(0, 3.7, -2.1); mission2.add(subSign);
  // The area sign above it names this part of New York.
  const m2Sign = makeTextSprite('LONG ISLAND CITY, QUEENS', '#ffd166');
  m2Sign.name = 'areaSign'; m2Sign.userData.areaName = 'LONG ISLAND CITY, QUEENS';
  m2Sign.scale.set(7, 1.6, 1); m2Sign.position.set(0, 5.4, -2.1); mission2.add(m2Sign);
  // The living city around the yard: the substation sits in Long Island
  // City, so beyond the north fence there is a road with moving cars,
  // houses, an elevated train track with a passing train, and the
  // Manhattan skyline. The fence is translucent, so all of it reads
  // from inside the yard and the scene stops feeling like an empty lot.
  buildCityEnvironment();
  // Wall and furniture colliders (see player.js): the control room is a
  // solid box with no doorway gap - its door is click-only, the key
  // card opens it, and everything inside is used from outside - the
  // transformers are solid, the SCADA desk is solid, and the fence is
  // solid just outside the walk bounds, so it can never shrink the
  // yard. Nothing crosses the guard line at z 2 or the walk from the
  // lot (driveSpawn -1.8, 7) north to the control-room door: the gap
  // between the transformers is 5 m wide, and the door face stays
  // reachable (the player stops 0.35 m short of it, well inside click
  // range for the door, the manifesto and the log book).
  addBoxCollider(mission2Colliders, -3.5, -6.75, 3.5, -2.25);
  addBoxCollider(mission2Colliders, -5.5, -3, -2.5, -1);
  addBoxCollider(mission2Colliders, 2.5, -3, 5.5, -1);
  addBoxCollider(mission2Colliders, 1.33, 0.7, 3.67, 2.3);
  addBoxCollider(mission2Colliders, -10, -6.7, 10, -6.35);
  addBoxCollider(mission2Colliders, -10, 12.35, 10, 12.7);
  addBoxCollider(mission2Colliders, -10.7, -6, -10.35, 12);
  addBoxCollider(mission2Colliders, 10.35, -6, 10.7, 12);
}

// ---------- Living city around the substation (Mission 2) ----------
// Animated: cityCars drive the road, cityTrain runs the elevated track,
// cityPedestrians walk the sidewalks, and the traffic jam honks.
const cityCars = [];
const cityPedestrians = [];
let cityTrain = null;
let hornTimer = 0;
let hornCtx = null;
function honkHorn() {
  try {
    if (!hornCtx) hornCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (hornCtx.state === 'suspended') hornCtx.resume();
    const t0 = hornCtx.currentTime;
    for (const start of [0, 0.22]) {
      const osc = hornCtx.createOscillator();
      osc.type = 'square'; osc.frequency.value = 370;
      const g = hornCtx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(0.05, t0 + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + 0.18);
      osc.connect(g); g.connect(hornCtx.destination);
      osc.start(t0 + start); osc.stop(t0 + start + 0.2);
    }
  } catch (e) { /* no audio - the jam is still visible */ }
}
// White modern facade: a clean white wall with a regular grid of small
// square windows, like the hospital in the photo the user sent (tall white
// tower, rounded corner, rows of windows, lower white wing). The city
// buildings use this so the whole city looks like the photo.
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
// ---------- NYC skyscrapers ----------
// The buildings along the road are skyscrapers now, different varieties
// of the structures that make up New York: slab glass towers, setback
// towers that narrow as they rise, spired and Art Deco crown towers,
// tapered towers, and brick walk-ups with a rooftop water tower. Facades
// are canvas textures with a grid of windows, some lit warm gold, some
// lit cool white, so the towers read at day and at dusk/night.
function skyscraperFacadeTexture(base, cols, rows, litRatio) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
  const gw = 256 / cols, gh = 256 / rows;
  for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
    if (Math.random() < (litRatio || 0.35)) ctx.fillStyle = Math.random() < 0.6 ? '#ffd166' : '#cfe4ff';
    else ctx.fillStyle = 'rgba(8,14,22,0.85)';
    ctx.fillRect(col * gw + gw * 0.22, r * gh + gh * 0.25, gw * 0.56, gh * 0.5);
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// A shared palette of facade materials, so towers reuse textures instead
// of making one per building. glow is the starting emissive intensity;
// the drive palette is registered in travelWindowMats so setTimeOfDay
// turns the window glow up at dusk/night and down in daylight.
function skyFacadePalette(glow, register) {
  const defs = [
    { base: '#2e4a66', cols: 6, rows: 16 }, // blue glass
    { base: '#232c33', cols: 8, rows: 20 }, // dark glass
    { base: '#7a4636', cols: 5, rows: 10 }, // brick
    { base: '#cfc4ae', cols: 6, rows: 12 }, // pale stone
    { base: '#b8a888', cols: 5, rows: 14 }, // Art Deco limestone
    { base: '#e8ecef', cols: 6, rows: 12 }  // white modern
  ];
  const mats = defs.map(d => {
    const tex = skyscraperFacadeTexture(d.base, d.cols, d.rows, 0.35);
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: glow, roughness: 0.85 });
    if (register) travelWindowMats.push(m);
    return m;
  });
  return mats;
}
// Classic NYC rooftop water tower: a wooden barrel on legs with a cone roof.
function makeWaterTower() {
  const g = new THREE.Group();
  const wood = stdMat({ color: 0x6a4a30, roughness: 0.95 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 1.1, 10), wood);
  barrel.position.y = 1.1; barrel.castShadow = true; g.add(barrel);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.65, 0.5, 10), stdMat({ color: 0x4a3220, roughness: 0.95 }));
  cone.position.y = 1.9; g.add(cone);
  for (const [lx, lz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), stdMat({ color: 0x3a3a3a, roughness: 0.8 }));
    leg.position.set(lx, 0.35, lz); g.add(leg);
  }
  return g;
}
// One varied NYC tower, standing on the ground (y = 0 at the base).
// style: 'slab' | 'setback' | 'spired' | 'tapered' | 'brick' | 'deco'.
// facadeMat is one material from skyFacadePalette.
function makeSkyscraper(style, w, h, d, facadeMat) {
  const g = new THREE.Group();
  const roofMat = stdMat({ color: 0x3a3f44, roughness: 0.9 });
  const goldMat = stdMat({ color: 0xc8b060, metalness: 0.5, roughness: 0.4 });
  const box = (bw, bh, bd, y, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), [mat, mat, roofMat, roofMat, mat, mat]);
    m.position.y = y; m.castShadow = true; g.add(m); return m;
  };
  if (style === 'setback') {
    box(w, h * 0.55, d, h * 0.275, facadeMat);
    box(w * 0.7, h * 0.3, d * 0.7, h * 0.55 + h * 0.15, facadeMat);
    box(w * 0.45, h * 0.15, d * 0.45, h * 0.85 + h * 0.075, facadeMat);
  } else if (style === 'tapered') {
    const r = (w / 2) * Math.SQRT2;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r, h, 4, 1), facadeMat);
    t.rotation.y = Math.PI / 4; t.position.y = h / 2; t.castShadow = true; g.add(t);
    box(w * 0.3, h * 0.08, d * 0.3, h + h * 0.04, roofMat);
  } else if (style === 'spired') {
    box(w, h, d, h / 2, facadeMat);
    box(w * 0.6, h * 0.08, d * 0.6, h + h * 0.04, roofMat);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.35, h * 0.22, 8), stdMat({ color: 0x8a7a3a, metalness: 0.7, roughness: 0.35 }));
    spire.position.y = h + h * 0.08 + h * 0.11; g.add(spire);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
    tip.position.y = h + h * 0.08 + h * 0.22; g.add(tip);
  } else if (style === 'deco') {
    box(w, h, d, h / 2, facadeMat);
    box(w * 0.7, h * 0.06, d * 0.7, h + h * 0.03, goldMat);
    box(w * 0.45, h * 0.06, d * 0.45, h + h * 0.09, goldMat);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, h * 0.12, 8), stdMat({ color: 0x8a7a3a, metalness: 0.7, roughness: 0.35 }));
    spire.position.y = h + h * 0.12 + h * 0.06; g.add(spire);
  } else if (style === 'brick') {
    box(w, h, d, h / 2, facadeMat);
    if (Math.random() < 0.6) { const wt = makeWaterTower(); wt.position.set(0, h, 0); g.add(wt); }
    else box(w * 0.4, 1.0, d * 0.4, h + 0.5, roofMat); // rooftop penthouse
  } else { // slab
    box(w, h, d, h / 2, facadeMat);
    box(w * 0.5, 1.2, d * 0.5, h + 0.6, roofMat);
  }
  return g;
}
// Pick a tower style and a height band for it, so the skyline mixes very
// tall, tall, medium and shorter towers instead of one height. minH
// excludes styles too short for the spot (the skyline wants tall only).
function pickSkyscraper(palette, minH) {
  const bands = { slab: [24, 50], setback: [20, 45], spired: [28, 55], tapered: [22, 42], brick: [8, 16], deco: [26, 48] };
  const floor = minH || 0;
  const styles = Object.keys(bands).filter(s => bands[s][1] >= floor);
  const style = styles[Math.floor(Math.random() * styles.length)];
  const band = bands[style];
  const lo = Math.max(band[0], floor);
  const h = lo + Math.random() * (band[1] - lo);
  const w = 7 + Math.random() * 5, d = 7 + Math.random() * 3;
  const mat = palette[Math.floor(Math.random() * palette.length)];
  return { group: makeSkyscraper(style, w, h, d, mat), h, w, d, style };
}
// ---------- Tiled road (from the street photo the user sent) ----------
// The city streets are a GREEN TILED road: hexagonal tiles, green bike
// lanes with bicycle symbols, "MAIN ST" painted on the road, parked cars
// on both sides, trees lining the street, shops with awnings, and a white
// striped crosswalk. The hex tile pattern is drawn on a canvas and
// repeated along the road.
function hexTileTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2a5a35'; ctx.fillRect(0, 0, 256, 256); // grout between tiles
  const s = 18; // hexagon size (centre to vertex)
  const hw = Math.sqrt(3) * s, hh = 1.5 * s;
  let row = 0;
  for (let y = -hh; y < 256 + hh; y += hh, row++) {
    for (let x = -hw; x < 256 + hw; x += hw) {
      const cx = x + (row % 2 === 0 ? 0 : hw / 2);
      const cy = y;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + k * Math.PI / 3; // pointy-top hexagon
        const px = cx + Math.cos(a) * (s - 1.5), py = cy + Math.sin(a) * (s - 1.5);
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = (row + Math.round(cx / hw)) % 2 === 0 ? '#3d7a4d' : '#4a8a5a';
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
// A white bicycle symbol (two wheels and a frame) for the bike lanes.
function bikeSymbolTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(30, 88, 20, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(98, 88, 20, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(30, 88); ctx.lineTo(58, 52); ctx.lineTo(98, 88); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(58, 52); ctx.lineTo(78, 52); ctx.lineTo(98, 88); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(58, 52); ctx.lineTo(48, 88); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(72, 40); ctx.lineTo(86, 40); ctx.stroke();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// "MAIN ST" painted on the road in white.
function mainStTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = '#f2f2f2'; ctx.font = 'bold 64px Arial'; ctx.textAlign = 'center';
  ctx.fillText('MAIN ST', 256, 84);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// A simple parked car (body + cabin + wheels), for the street sides and
// the car park. Returns a group; the caller positions and rotates it.
// A realistic street car, built from parts (see player.js buildCar):
// a shaped body with a hood, a glass cabin with a roof, four wheels
// with hubs, headlights, taillights, a grille and bumpers - not a box.
function makeStreetCar(color) {
  const hex = (color === undefined || color === null) ? 0x9aa5ad : color;
  return buildCar(hex, { type: 'sedan' });
}
// A street tree: a trunk and a round canopy.
function makeStreetTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 1.4, 8), stdMat({ color: 0x5a3a22, roughness: 0.95 }));
  trunk.position.y = 0.7; g.add(trunk);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 10), stdMat({ color: 0x2e6a2e, roughness: 0.95 }));
  top.position.y = 1.9; top.scale.y = 0.85; g.add(top);
  return g;
}
// A shop awning: a sloped striped panel over a shopfront, with a sign.
function makeShopAwning(color, label) {
  const g = new THREE.Group();
  const awn = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.12, 1.6), stdMat({ color, roughness: 0.8 }));
  awn.position.set(0, 2.6, 0.8); awn.rotation.x = 0.35; g.add(awn);
  if (label) {
    const s = makeTextSprite(label, '#f2e9d8');
    s.scale.set(3.2, 0.8, 1); s.position.set(0, 3.3, 0.9); g.add(s);
  }
  return g;
}
function buildCityEnvironment() {
  // Road running east-west just beyond the north fence (z = -10). The
  // street looks like the photo: a GREEN TILED road (hexagonal tiles),
  // green bike lanes with bicycle symbols, "MAIN ST" painted on it,
  // parked cars on both sides, trees lining the street, shops with
  // awnings, and a white striped crosswalk. Layout from the curb in:
  // parked cars, bike lane, car lanes, bike lane, parked cars.
  const roadTex = hexTileTexture();
  roadTex.repeat.set(20, 2);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(90, 7), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0.03, -10); road.receiveShadow = true; mission2.add(road);
  // Green bike lanes along both edges of the road.
  for (const z of [-8.0, -12.0]) {
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(90, 1.0), stdMat({ color: 0x2e7a4a, roughness: 0.95 }));
    lane.rotation.x = -Math.PI / 2; lane.position.set(0, 0.05, z); mission2.add(lane);
  }
  // Bicycle symbols painted in the bike lanes.
  const bikeTex = bikeSymbolTexture();
  for (const z of [-8.0, -12.0]) for (const x of [-30, -10, 10, 30]) {
    const sym = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: bikeTex, transparent: true, opacity: 0.85, depthWrite: false }));
    sym.rotation.x = -Math.PI / 2; sym.position.set(x, 0.06, z); mission2.add(sym);
  }
  // "MAIN ST" painted on the road.
  const mainTex = mainStTexture();
  for (const x of [-20, 20]) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: mainTex, transparent: true, opacity: 0.9, depthWrite: false }));
    t.rotation.x = -Math.PI / 2; t.position.set(x, 0.06, -10); mission2.add(t);
  }
  // A white striped crosswalk across the road (zebra stripes).
  for (let i = 0; i < 6; i++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 6.4), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }));
    stripe.rotation.x = -Math.PI / 2; stripe.position.set(8 + i * 1.15, 0.06, -10); mission2.add(stripe);
  }
  // Dashed yellow centre line.
  for (let x = -42; x <= 42; x += 4) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.18), new THREE.MeshBasicMaterial({ color: 0xd8b13a }));
    dash.rotation.x = -Math.PI / 2; dash.position.set(x, 0.05, -10); mission2.add(dash);
  }
  // Parked cars along both curbs (in the parking lane, outside the bike lanes).
  const parkCols = [0xc0392b, 0x2e6fb0, 0xd8d8d8, 0x3a3a3a, 0xc07a1a, 0x5a7a3a, 0x7a2e5a];
  for (const [px, pz, faceEast] of [[-35, -7.0, true], [-25, -7.0, true], [15, -7.0, false], [30, -7.0, true], [-30, -13.0, false], [-10, -13.0, true], [20, -13.0, false], [35, -13.0, true]]) {
    const pc = makeStreetCar(parkCols[Math.floor(Math.random() * parkCols.length)]);
    pc.position.set(px, 0, pz);
    if (!faceEast) pc.rotation.y = Math.PI;
    mission2.add(pc);
  }
  // Trees lining the far sidewalk.
  for (const tx of [-38, -26, -14, -2, 10, 22, 34, 42]) {
    const tree = makeStreetTree();
    tree.position.set(tx, 0, -15.6); mission2.add(tree);
  }
  // Street lights along the road: real cobra-head lamps on the
  // sidewalks, alternating sides, so the road is lit at dusk like a real
  // street. Mission 2 is dusk, so the lamps are on here.
  for (const [lx, lz, lry] of [[-36, -6.0, Math.PI], [-18, -15.2, 0], [0, -6.0, Math.PI], [18, -15.2, 0], [36, -6.0, Math.PI]]) {
    const lamp = makeStreetLight(lry, 0.08);
    lamp.group.position.set(lx, 0, lz); mission2.add(lamp.group);
  }
  // Parked cars along the curb, so the street reads as busy without
  // blocking the driving lanes. The old bumper-to-bumper jam sat in the
  // east lane and the flowing cars drove straight through it, so the
  // road looked packed. Now the lanes flow and the parked row is off
  // to the side, clear of traffic.
  for (let i = 0; i < 5; i++) {
    const pc = makeStreetCar(parkCols[i % parkCols.length]);
    pc.position.set(-30 + i * 9, 0, -7.2);
    mission2.add(pc);
  }
  // Cars: two lanes, one each way, with DIFFERENT types of cars on the
  // road - sedan, SUV, taxi, pickup truck, bus, hatchback and van - so
  // the highway reads as real traffic, not one car copied six times.
  // Each lane moves at one speed, so cars in a lane keep their spacing
  // and never bunch up into a pack.
  const trafficMix = [
    { type: 'sedan', col: 0xc0392b }, { type: 'suv', col: 0x2e6fb0 },
    { type: 'taxi', col: 0xf2c200 }, { type: 'truck', col: 0x5a5a5a },
    { type: 'bus', col: 0x2e7a4a }, { type: 'hatchback', col: 0xd8d8d8 },
    { type: 'sedan', col: 0xc07a1a }, { type: 'suv', col: 0x3a3a3a },
  ];
  const laneSpeed = { east: 7, west: -6.5 };
  for (let i = 0; i < trafficMix.length; i++) {
    const east = i % 2 === 0; // even cars go east (+x) on the near lane
    const spec = trafficMix[i];
    const car = buildCar(spec.col, { type: spec.type });
    car.position.set(-44 + i * 11, 0, east ? -9.0 : -11.0); // car lanes, inside the bike lanes
    if (!east) car.rotation.y = Math.PI; // face the direction of travel
    mission2.add(car);
    cityCars.push({ group: car, speed: east ? laneSpeed.east : laneSpeed.west });
  }
  // The grey van: a plain grey van with blue windows, driving the east
  // lane with the other traffic. No logo, no text, no rope, no person
  // behind it - it is just a van on the road.
  const greyVan = buildCar(0x9aa5ad, { type: 'van' });
  greyVan.position.set(-20, 0, -9.0);
  mission2.add(greyVan);
  cityCars.push({ group: greyVan, speed: laneSpeed.east });
  // Pedestrians on the sidewalks: a busy crowd, like the plaza video -
  // singles and pairs, different paces, some on a phone, some with bags.
  // They walk along the street (lane axis x) and wrap at the ends, so
  // the crowd keeps entering and leaving.
  const nearCrowd = makeCrowd({ count: 4, lane: { axis: 'x', fixed: -6.3, min: -44, max: 44 } });
  const farCrowd = makeCrowd({ count: 8, lane: { axis: 'x', fixed: -14.5, min: -44, max: 44 } });
  for (const p of [...nearCrowd, ...farCrowd]) { mission2.add(p.group); cityPedestrians.push(p); }
  // Houses beyond the road (z = -16), a small residential row - clean
  // white modern boxes with rows of windows, like the photo, flat roofs.
  const shopNames = ['CAFE', 'DELI', 'BAKERY', 'PHARMACY', 'FLOWERS', 'BOOKS', 'PIZZA'];
  const awnCols = [0xc0392b, 0x2e6fb0, 0x2e7a4a, 0xc07a1a, 0x7a2e5a, 0x3a3a3a, 0xd8b13a];
  // Houses beyond the road (z = -16), a small shop row: varied heights
  // and fronts, white, brick and pale stone, some with a rooftop water
  // tower, so the row reads as a real New York street, not one box.
  const shopPalette = skyFacadePalette(0.55, false);
  for (let i = 0; i < 7; i++) {
    const hx = -30 + i * 10 + (Math.random() * 3 - 1.5);
    const h = new THREE.Group();
    const sh = 2.6 + Math.random() * 1.9; // 2.6 to 4.5 high
    const shopMat = shopPalette[Math.floor(Math.random() * shopPalette.length)];
    const base = new THREE.Mesh(new THREE.BoxGeometry(5, sh, 4.5), shopMat);
    base.position.y = sh / 2; base.castShadow = true; h.add(base);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.15, 4.7), stdMat({ color: 0xe8ecef, roughness: 0.9 }));
    roof.position.y = sh + 0.05; roof.castShadow = true; h.add(roof);
    if (Math.random() < 0.3) { const wt = makeWaterTower(); wt.scale.setScalar(0.7); wt.position.set(1.2, sh + 0.1, 0); h.add(wt); }
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ color: 0x201808, emissive: 0xffc978, emissiveIntensity: 0.9 }));
    win.position.set(-1, 1.4, 2.28); h.add(win);
    const win2 = win.clone(); win2.position.set(1.2, 1.4, 2.28); h.add(win2);
    // A shop awning over the shopfront, with the shop name.
    const awn = makeShopAwning(awnCols[i % awnCols.length], shopNames[i % shopNames.length]);
    awn.position.set(0, 0, 2.3); h.add(awn);
    h.position.set(hx, 0, -16.5); mission2.add(h);
  }
  // Elevated train track (the 7 line) running east-west at z = -22,
  // deck at y = 4.5 on pillars, with two rails the player can see.
  const deck = new THREE.Mesh(new THREE.BoxGeometry(90, 0.5, 3), stdMat({ color: 0x3a3f44, roughness: 0.9 }));
  deck.position.set(0, 4.5, -22); deck.castShadow = true; mission2.add(deck);
  for (const rz of [-22.7, -21.3]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(90, 0.12, 0.12), stdMat({ color: 0x9aa2a8, metalness: 0.9, roughness: 0.3 }));
    rail.position.set(0, 4.85, rz); mission2.add(rail);
  }
  for (let x = -42; x <= 42; x += 7) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4.3, 0.8), stdMat({ color: 0x4a4f54, roughness: 0.9 }));
    pillar.position.set(x, 2.15, -22); pillar.castShadow = true; mission2.add(pillar);
  }
  // The train: three cars with lit windows, running the elevated track.
  cityTrain = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const car = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(6.5, 2.2, 2.2), stdMat({ color: 0x2a4a6a, roughness: 0.5, metalness: 0.4 }));
    body.position.y = 1.4; body.castShadow = true; car.add(body);
    for (let w = 0; w < 4; w++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), new THREE.MeshStandardMaterial({ color: 0x201808, emissive: 0xffd166, emissiveIntensity: 1.0 }));
      win.position.set(-2.4 + w * 1.6, 1.5, 1.12); car.add(win);
      const winB = win.clone(); winB.position.z = -1.12; winB.rotation.y = Math.PI; car.add(winB);
    }
    car.position.set(i * 7, 4.8, -22);
    cityTrain.add(car);
  }
  cityTrain.position.set(-30, 0, 0);
  mission2.add(cityTrain);
  // Manhattan skyline in the far background (z = -26 to -40): varied NYC
  // skyscrapers, slab glass, setback, spired, tapered, brick and Art Deco
  // crowns, hazed by the fog so the city reads at a distance. Windows
  // glow at dusk. Only tall towers here (18 and up).
  const skyPalette = skyFacadePalette(0.55, false);
  for (let i = 0; i < 10; i++) {
    const pick = pickSkyscraper(skyPalette, 18);
    pick.group.position.set(-42 + i * 9.5 + (Math.random() * 3 - 1.5), 0, -28 - Math.random() * 12);
    mission2.add(pick.group);
  }
}

// ---------- Mission map + travel (the adventure between missions) ----------
// The missions are NOT in one place: the reservoir is upstate, the
// substation is in Long Island City, the bridge is the Verrazzano. The
// player travels between them like Call of Duty / Mission Impossible -
// a map shows where he is and where he is going, then he drives there
// through the city before the next mission starts. This is the part
// that makes the game feel adventurous instead of a single room.
// The city map is the hub for EVERYTHING: the three mission places plus
// the clothing store, the car dealership, the mansion, the safe house,
// the hospital and the industrial area. Every place is spread far apart
// across the map, with real miles between them (a mile to a mile, like
// travelling across a city), and the player drives to each one.
// Types: mission (starts a mission), store (opens the store on a tab),
// home (enters the mansion / safe house), visit (a walk-around exterior).
const TRAVEL_PLACES = {
  reservoir: { name: 'Rondout Reservoir', short: 'Reservoir', x: 0.16, y: 0.10, desc: 'Upstate New York - the Delaware Line', type: 'mission', mission: 1 },
  hospital: { name: 'City Hospital', short: 'Hospital', x: 0.45, y: 0.12, desc: 'City hospital - the Bronx', type: 'visit', kind: 'hospital' },
  windtunnel: { name: 'Wind Tunnel Lab', short: 'Wind Tunnel', x: 0.44, y: 0.22, desc: 'Engineering lab - Morningside Heights', type: 'visit', kind: 'windtunnel' },
  hotels: { name: 'Hotels', short: 'Hotels', x: 0.56, y: 0.32, desc: 'A hotel suite - Midtown', type: 'home', kind: 'hotel' },
  marketstreet: { name: 'Market Street', short: 'Market St', x: 0.66, y: 0.24, desc: 'Market street - stalls and shops, Midtown', type: 'visit', kind: 'marketstreet' },
  symposium: { name: 'Symposium Hall', short: 'Symposium', x: 0.84, y: 0.32, desc: 'Symposium hall - Astoria, Queens', type: 'visit', kind: 'symposium' },
  clothing: { name: 'Clothing Store', short: 'Clothing', x: 0.44, y: 0.44, desc: 'Buy clothes - Manhattan', type: 'store', tab: 'clothes' },
  dealership: { name: 'Car Dealership', short: 'Dealership', x: 0.70, y: 0.42, desc: 'Buy cars - Queens', type: 'store', tab: 'cars' },
  terminal: { name: 'Train Terminal', short: 'Terminal', x: 0.50, y: 0.50, desc: 'Grand Central - board the 4 train', type: 'home', kind: 'terminal' },
  substation: { name: 'Con Edison Substation', short: 'Substation', x: 0.68, y: 0.52, desc: 'Long Island City, Queens', type: 'mission', mission: 2 },
  mansion: { name: 'The Mansion', short: 'Mansion', x: 0.93, y: 0.55, desc: 'Your mansion - Long Island', type: 'home', kind: 'mansion' },
  carpark: { name: 'Car Park', short: 'Car Park', x: 0.58, y: 0.58, desc: 'Parking lot - Midtown South', type: 'visit', kind: 'carpark' },
  industry: { name: 'Industrial Area', short: 'Industry', x: 0.78, y: 0.62, desc: 'Water treatment plant', type: 'visit', kind: 'industry' },
  zama: { name: 'Zama HQ', short: 'Zama HQ', x: 0.42, y: 0.68, desc: 'Zama - confidential computing, SoHo', type: 'visit', kind: 'zama', landmark: true },
  court: { name: 'NYC Court', short: 'Court', x: 0.60, y: 0.72, desc: 'NYC Court - Foley Square, by Zama HQ', type: 'visit', kind: 'court', landmark: true },
  safehouse: { name: 'Safe House Apartment', short: 'Safe House', x: 0.72, y: 0.76, desc: 'Your safe house - Brooklyn', type: 'home', kind: 'safehouse' },
  airport: { name: 'Airport', short: 'Airport', x: 0.90, y: 0.84, desc: 'JFK - flights out', type: 'visit', kind: 'airport' },
  bridge: { name: 'Verrazzano Bridge', short: 'Bridge', x: 0.45, y: 0.88, desc: 'Verrazzano-Narrows, tonight', type: 'mission', mission: 3 },
  policestation: { name: 'NYPD Police Station', short: 'Police', x: 0.55, y: 0.38, desc: 'NYPD precinct - Midtown Manhattan', type: 'visit', kind: 'policestation' },
  navybarracks: { name: 'Navy Barracks', short: 'Navy Barracks', x: 0.60, y: 0.60, desc: 'US Naval barracks - Brooklyn Navy Yard', type: 'visit', kind: 'navybarracks' },
  fillingstation: { name: 'Filling Station', short: 'Fuel', x: 0.34, y: 0.60, desc: 'Fill your tank - 0.5 ZAMA for a full tank', type: 'visit', kind: 'fillingstation' },
  sensorvault: { name: 'Sensor Vault', short: 'Sensor Vault', x: 0.82, y: 0.70, desc: 'Underground water pressure sensors - under the treatment plant', type: 'visit', kind: 'sensorvault' }
};
// Miles between every pair of places (symmetric: look up either order).
// The far places are far: the reservoir is upstate, 85 miles from the
// substation; the hospital and the industrial area are far from each other
// and from the safe house, so the drive feels like a real distance.
const DISTANCES = {
  'reservoir>hospital': 38, 'reservoir>industry': 55, 'reservoir>mansion': 92, 'reservoir>dealership': 80,
  'reservoir>clothing': 78, 'reservoir>substation': 85, 'reservoir>safehouse': 84, 'reservoir>bridge': 95,
  'hospital>industry': 48, 'hospital>mansion': 58, 'hospital>dealership': 42, 'hospital>clothing': 35,
  'hospital>substation': 33, 'hospital>safehouse': 40, 'hospital>bridge': 44,
  'industry>mansion': 12, 'industry>dealership': 18, 'industry>clothing': 26, 'industry>substation': 30,
  'industry>safehouse': 34, 'industry>bridge': 38,
  'mansion>dealership': 8, 'mansion>clothing': 14, 'mansion>substation': 4, 'mansion>safehouse': 10, 'mansion>bridge': 12,
  'dealership>clothing': 5, 'dealership>substation': 6, 'dealership>safehouse': 8, 'dealership>bridge': 13,
  'clothing>substation': 2, 'clothing>safehouse': 4, 'clothing>bridge': 11,
  'substation>safehouse': 3, 'substation>bridge': 9,
  'safehouse>bridge': 7,
  // The four new places (airport, hotels, train terminal, car park):
  // each is far from the others, like a real city.
  'airport>reservoir': 88, 'airport>hospital': 55, 'airport>industry': 62, 'airport>mansion': 70,
  'airport>dealership': 48, 'airport>clothing': 40, 'airport>substation': 35, 'airport>safehouse': 28, 'airport>bridge': 32,
  'hotels>reservoir': 70, 'hotels>hospital': 28, 'hotels>industry': 30, 'hotels>mansion': 25,
  'hotels>dealership': 12, 'hotels>clothing': 8, 'hotels>substation': 15, 'hotels>safehouse': 18, 'hotels>bridge': 22,
  'terminal>reservoir': 75, 'terminal>hospital': 32, 'terminal>industry': 35, 'terminal>mansion': 30,
  'terminal>dealership': 10, 'terminal>clothing': 4, 'terminal>substation': 7, 'terminal>safehouse': 12, 'terminal>bridge': 16,
  'carpark>reservoir': 82, 'carpark>hospital': 38, 'carpark>industry': 40, 'carpark>mansion': 35,
  'carpark>dealership': 14, 'carpark>clothing': 10, 'carpark>substation': 8, 'carpark>safehouse': 6, 'carpark>bridge': 12,
  'airport>hotels': 38, 'airport>terminal': 30, 'airport>carpark': 22,
  'hotels>terminal': 10, 'hotels>carpark': 16, 'terminal>carpark': 9,
  // The four new places (wind tunnel lab, symposium hall, Zama HQ, NYC
  // Court): each is in its own part of the city, with real miles to the
  // other places. The court is one mile from Zama HQ, by design.
  'windtunnel>reservoir': 68, 'windtunnel>hospital': 6, 'windtunnel>industry': 22, 'windtunnel>mansion': 30,
  'windtunnel>dealership': 12, 'windtunnel>clothing': 6, 'windtunnel>substation': 8, 'windtunnel>safehouse': 14, 'windtunnel>bridge': 16,
  'windtunnel>airport': 24, 'windtunnel>hotels': 5, 'windtunnel>terminal': 4, 'windtunnel>carpark': 7,
  'symposium>reservoir': 78, 'symposium>hospital': 30, 'symposium>industry': 14, 'symposium>mansion': 18,
  'symposium>dealership': 6, 'symposium>clothing': 10, 'symposium>substation': 5, 'symposium>safehouse': 12, 'symposium>bridge': 20,
  'symposium>airport': 16, 'symposium>hotels': 12, 'symposium>terminal': 9, 'symposium>carpark': 11,
  'zama>reservoir': 82, 'zama>hospital': 34, 'zama>industry': 24, 'zama>mansion': 26,
  'zama>dealership': 10, 'zama>clothing': 4, 'zama>substation': 6, 'zama>safehouse': 8, 'zama>bridge': 12,
  'zama>airport': 22, 'zama>hotels': 6, 'zama>terminal': 3, 'zama>carpark': 4,
  'court>reservoir': 83, 'court>hospital': 35, 'court>industry': 25, 'court>mansion': 27,
  'court>dealership': 11, 'court>clothing': 5, 'court>substation': 7, 'court>safehouse': 9, 'court>bridge': 13,
  'court>airport': 23, 'court>hotels': 7, 'court>terminal': 4, 'court>carpark': 5,
  'windtunnel>symposium': 12, 'windtunnel>zama': 8, 'windtunnel>court': 9,
  'symposium>zama': 10, 'symposium>court': 11, 'zama>court': 1,
  // The three new places (police station, Navy barracks, sensor vault):
  // the police station is Midtown, the barracks is the Brooklyn Navy
  // Yard, the vault is under the treatment plant by the industry.
  'policestation>reservoir': 72, 'policestation>hospital': 30, 'policestation>industry': 32, 'policestation>mansion': 28,
  'policestation>dealership': 9, 'policestation>clothing': 6, 'policestation>substation': 7, 'policestation>safehouse': 11, 'policestation>bridge': 15,
  'policestation>airport': 26, 'policestation>hotels': 9, 'policestation>terminal': 5, 'policestation>carpark': 8,
  'policestation>windtunnel': 7, 'policestation>symposium': 10, 'policestation>zama': 3, 'policestation>court': 4,
  'navybarracks>reservoir': 80, 'navybarracks>hospital': 34, 'navybarracks>industry': 16, 'navybarracks>mansion': 20,
  'navybarracks>dealership': 8, 'navybarracks>clothing': 12, 'navybarracks>substation': 6, 'navybarracks>safehouse': 9, 'navybarracks>bridge': 14,
  'navybarracks>airport': 18, 'navybarracks>hotels': 14, 'navybarracks>terminal': 11, 'navybarracks>carpark': 10,
  'navybarracks>windtunnel': 13, 'navybarracks>symposium': 7, 'navybarracks>zama': 9, 'navybarracks>court': 10, 'navybarracks>policestation': 8,
  'sensorvault>reservoir': 85, 'sensorvault>hospital': 36, 'sensorvault>industry': 2, 'sensorvault>mansion': 14,
  'sensorvault>dealership': 15, 'sensorvault>clothing': 22, 'sensorvault>substation': 24, 'sensorvault>safehouse': 12, 'sensorvault>bridge': 30,
  'sensorvault>airport': 34, 'sensorvault>hotels': 26, 'sensorvault>terminal': 28, 'sensorvault>carpark': 24,
  'sensorvault>windtunnel': 20, 'sensorvault>symposium': 12, 'sensorvault>zama': 20, 'sensorvault>court': 21, 'sensorvault>policestation': 22, 'sensorvault>navybarracks': 10,
  // Market Street (Midtown): close to the Midtown places, far from upstate.
  'marketstreet>reservoir': 74, 'marketstreet>hospital': 28, 'marketstreet>industry': 20, 'marketstreet>mansion': 26,
  'marketstreet>dealership': 8, 'marketstreet>clothing': 2, 'marketstreet>substation': 9, 'marketstreet>safehouse': 11, 'marketstreet>bridge': 18,
  'marketstreet>airport': 30, 'marketstreet>hotels': 7, 'marketstreet>terminal': 3, 'marketstreet>carpark': 6,
  'marketstreet>windtunnel': 6, 'marketstreet>symposium': 10, 'marketstreet>zama': 4, 'marketstreet>court': 5,
  'marketstreet>policestation': 5, 'marketstreet>navybarracks': 12, 'marketstreet>sensorvault': 22,
  // Filling Station (west Midtown, on the drive road): close to the
  // Midtown places, so it is never a long drive away when the tank runs low.
  'fillingstation>reservoir': 76, 'fillingstation>hospital': 30, 'fillingstation>industry': 22, 'fillingstation>mansion': 28,
  'fillingstation>dealership': 9, 'fillingstation>clothing': 4, 'fillingstation>substation': 8, 'fillingstation>safehouse': 10, 'fillingstation>bridge': 17,
  'fillingstation>airport': 32, 'fillingstation>hotels': 8, 'fillingstation>terminal': 4, 'fillingstation>carpark': 7,
  'fillingstation>windtunnel': 7, 'fillingstation>symposium': 11, 'fillingstation>zama': 5, 'fillingstation>court': 6,
  'fillingstation>policestation': 6, 'fillingstation>navybarracks': 11, 'fillingstation>sensorvault': 24, 'fillingstation>marketstreet': 5
};
function getMiles(a, b) {
  if (a === b) return 0;
  return DISTANCES[a + '>' + b] || DISTANCES[b + '>' + a] || 10;
}
const MISSION_PLACE = { 1: 'reservoir', 2: 'substation', 3: 'bridge' };
const MISSION_TIME = { 1: 'day', 2: 'dusk', 3: 'night' };
let travelActive = false, travelT = 0, travelDur = 60, travelOnArrive = null, travelGroup = null, travelCars = [], travelPedestrians = [];
let travelStartWall = 0; // wall-clock start of the drive (see updateTravelDrive)
let travelWatchdog = null; // interval that ends the drive on schedule even if rAF is paused
// Driving the car yourself: gas (W or D, or the on-screen GAS pedal),
// brake (S, or the BRAKE pedal), and a camera view switch (C, or the
// View button) between the chase view and the in-car view. The car
// creeps at 3 m/s on its own so the drive always finishes; gas takes it
// to 12 m/s. The drive is time-based (travelDur), so a slow drive still
// arrives, and the Skip button arrives at once.
let driveSpeed = 0, driveView = 'chase';
const driveKeys = {};
let drivePedalGas = false, drivePedalBrake = false;
let driveControlsEl = null, driveKeyHandler = null, driveKeyUpHandler = null;
const DRIVE_MAX_SPEED = 12, DRIVE_CREEP_SPEED = 3, DRIVE_ROAD_LEN = 720;
// The player's own car in the drive, with the driver (player avatar)
// seated inside, so the player sees himself driving in third-person.
// The car is rebuilt each drive from the equipped car, and it lives in
// travelGroup, so it is hidden again when the drive ends (this also
// fixes the sedan mesh that used to stay stuck to the camera).
let driveCar = null;
// Trekking: some legs are done on foot. The trek is a real walk through
// the busy street (the green tiled MAIN ST, sidewalks, shops, parked
// cars, a traffic jam, pedestrians) from one end to a gold marker at the
// other end. No car, no skip - the player walks it with WASD.
let trekActive = false, trekGroup = null, trekPedestrians = [], trekOnArrive = null, trekToKey = null;
let trekDestX = 0, trekDestZ = -45;
let travelMapEl = null;
let travelToKey = null, travelMiles = 0, travelLastMilesShown = -1;
let travelFuelCounted = 0; // miles of this drive already charged to the tank
let mapFromKey = 'reservoir', mapSelectedKey = null, pendingMission = null;
let currentPlaceKey = 'reservoir';
let missionsDone = { 1: false, 2: false, 3: false };
let travelWindowMats = [];
// Drive areas: New York is not one street. Each destination sits in
// its own part of the city, and the drive to it is dressed for that
// part - country road upstate, Manhattan avenues, Queens brick and
// elevated track, Brooklyn brownstones, the bridge waterfront - so a
// drive reads as crossing a real city, not replaying one street.
// The road, traffic, parked cars, trees and lamps are shared; the
// buildings and roadside dressing live in one group per area and
// applyDriveArea shows only the destination's group.
const DRIVE_AREAS = {
  reservoir: 'upstate', mansion: 'upstate',
  bridge: 'bridge',
  substation: 'queens', symposium: 'queens', dealership: 'queens', airport: 'queens', industry: 'queens', sensorvault: 'queens',
  safehouse: 'brooklyn', navybarracks: 'brooklyn'
};
const AREA_NAMES = {
  reservoir: 'RONDOUT - UPSTATE NEW YORK', mansion: 'LONG ISLAND',
  bridge: 'VERRAZZANO-NARROWS BRIDGE',
  substation: 'LONG ISLAND CITY, QUEENS', symposium: 'ASTORIA, QUEENS', dealership: 'QUEENS', airport: 'JFK AIRPORT, QUEENS', industry: 'QUEENS', sensorvault: 'QUEENS',
  safehouse: 'BROOKLYN', navybarracks: 'BROOKLYN NAVY YARD',
  hospital: 'THE BRONX', windtunnel: 'MORNINGSIDE HEIGHTS', zama: 'SOHO, MANHATTAN', court: 'FOLEY SQUARE, MANHATTAN',
  hotels: 'MIDTOWN, MANHATTAN', marketstreet: 'MIDTOWN, MANHATTAN', clothing: 'MANHATTAN', terminal: 'GRAND CENTRAL, MANHATTAN',
  carpark: 'MIDTOWN SOUTH, MANHATTAN', policestation: 'MIDTOWN, MANHATTAN', fillingstation: 'MIDTOWN, MANHATTAN'
};
const AREA_DEFAULT_NAMES = { manhattan: 'MANHATTAN', queens: 'QUEENS', brooklyn: 'BROOKLYN', upstate: 'UPSTATE NEW YORK', bridge: 'VERRAZZANO-NARROWS' };
let driveAreaGroups = {};
let driveCityPaint = null;
let driveAreaSign = null;
function driveAreaFor(toKey) { return DRIVE_AREAS[toKey] || 'manhattan'; }
function areaNameFor(toKey) { return AREA_NAMES[toKey] || AREA_DEFAULT_NAMES[driveAreaFor(toKey)] || 'MANHATTAN'; }
// Dress the drive for the destination's part of New York: show only
// that area's buildings, keep the city road paint (bike lanes, MAIN
// ST, crosswalk) and sidewalk crowds off the country road and the
// bridge approach, and name the area on the sign at the road start.
function applyDriveArea(toKey) {
  const area = driveAreaFor(toKey);
  for (const k of Object.keys(driveAreaGroups)) driveAreaGroups[k].visible = k === area;
  const city = area !== 'upstate' && area !== 'bridge';
  if (driveCityPaint) driveCityPaint.visible = city;
  for (const p of travelPedestrians) { try { p.group.visible = city; } catch (e) { /* ignore */ } }
  const name = areaNameFor(toKey);
  if (driveAreaSign && driveAreaSign.userData.areaName !== name) {
    try {
      const old = driveAreaSign.material.map;
      driveAreaSign.material.map = signTexture(name, 'rgba(0,0,0,0)', '#ffd166', '');
      driveAreaSign.material.needsUpdate = true;
      if (old) old.dispose();
    } catch (e) { /* the sign is dressing; never break a drive */ }
    driveAreaSign.userData.areaName = name;
  }
}
// Street lights: real cobra-head lamps (pole, curved arm, lamp head,
// glowing underside, pool of light on the road). Their glow follows the
// time of day: off in daylight, on at dusk, brightest at night. Every
// lamp built by makeStreetLight registers its glowing parts here so
// setTimeOfDay can switch them all at once.
let travelLamps = [];
function applyLampState(lamp, mode) {
  const on = mode === 'day' ? 0 : mode === 'dusk' ? 0.6 : 1;
  try { lamp.headMat.emissiveIntensity = on * 1.6; } catch (e) { /* ignore */ }
  try { lamp.glowMat.opacity = on * 0.55; } catch (e) { /* ignore */ }
  try { lamp.poolMat.opacity = on * 0.22; } catch (e) { /* ignore */ }
}
// A real street lamp: a tapered pole on a base, a curved arm that sweeps
// out over the road, a cobra-head housing with a glowing underside, a
// soft glow sprite, and a pool of light on the road below the head. The
// lamp is built facing local +z (arm and head toward +z); rotate the
// group so the arm reaches over the road. poolY is the road surface
// height, so the pool sits just above the road and never z-fights it.
function makeStreetLight(rotY, poolY) {
  const g = new THREE.Group();
  const metal = stdMat({ color: 0x3a4046, metalness: 0.7, roughness: 0.4 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.4, 10), metal);
  base.position.set(0, 0.2, 0); base.castShadow = true; g.add(base);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 5.2, 10), metal);
  pole.position.set(0, 2.8, 0); pole.castShadow = true; g.add(pole);
  // Curved arm: a quarter torus from the pole top (0, 5.4, 0) sweeping
  // out to the head at (0, 4.3, 1.1).
  const arm = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.055, 8, 14, Math.PI / 2), metal);
  arm.rotation.y = -Math.PI / 2; arm.position.set(0, 4.3, 0); arm.castShadow = true; g.add(arm);
  // Cobra head: a dark housing, slightly tilted down toward the road,
  // with a warm glowing panel underneath.
  const head = new THREE.Group(); head.position.set(0, 4.25, 1.15); head.rotation.x = 0.12; g.add(head);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.8), stdMat({ color: 0x2a2e33, metalness: 0.6, roughness: 0.4 }));
  housing.castShadow = true; head.add(housing);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.4 });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.62), headMat);
  panel.position.set(0, -0.08, 0); head.add(panel);
  const glowMat = new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xffe9a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Sprite(glowMat); glow.scale.set(2.6, 2.6, 1); glow.position.set(0, 4.1, 1.15); g.add(glow);
  const poolMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.4, 24), poolMat);
  pool.rotation.x = -Math.PI / 2; pool.position.set(0, poolY === undefined ? 0.06 : poolY, 1.15); g.add(pool);
  g.rotation.y = rotY || 0;
  const lamp = { group: g, headMat, glowMat, poolMat };
  travelLamps.push(lamp);
  applyLampState(lamp, currentTimeMode);
  return lamp;
}
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
let currentTimeMode = 'day';
window.__lsTravelActive = false;

// Day and night: each mission has a different time of day. Mission 1
// (aqueduct) is bright day, Mission 2 (substation) is dusk/evening,
// Mission 3 (bridge) is night. The sky, sun, moon, fog and the glow of
// the city windows all change, so the time is obvious. Act I stays
// dark (train blackout) and Act III is dawn (its own module). The drive
// sets the time of the mission being driven to, so the drive matches.
function setTimeOfDay(mode) {
  currentTimeMode = mode;
  const winGlow = mode === 'day' ? 0.03 : mode === 'dusk' ? 0.55 : 0.85;
  for (const m of travelWindowMats) { try { m.emissiveIntensity = winGlow; } catch (e) { /* ignore */ } }
  for (const l of travelLamps) applyLampState(l, mode);
  if (mode === 'day') {
    scene.background.set(0x87b5d9); // bright blue sky
    scene.fog.color.set(0x87b5d9); scene.fog.density = 0.008;
    sun.intensity = 1.8; sun.color.set(0xfff2d8); sun.position.set(12, 20, 8);
    moon.intensity = 0;
    hemi.intensity = 0.6; hemi.color.set(0xbfd8ff); hemi.groundColor.set(0x8a7a5a);
    ambient.intensity = 0.5;
  } else if (mode === 'dusk') {
    scene.background.set(0x2a1e33); // dusky purple-orange evening
    scene.fog.color.set(0x2a1e33); scene.fog.density = 0.012;
    sun.intensity = 0.58; sun.color.set(0xff8a3c); sun.position.set(-14, 6, 8);
    moon.intensity = 0.15;
    // Dusk stays dusky, but the fill light is high enough that the
    // substation yard (lot, fence, control room, guards) reads from
    // the seated arrival view instead of sinking into silhouette
    // against the lit shops beyond it. Toned down a touch from
    // 0.65/0.4/0.4: the yard read bright and daylike on the live
    // check; the floodlights carry the yard, the fill just lifts it.
    hemi.intensity = 0.36; hemi.color.set(0x8a6a9a); hemi.groundColor.set(0x3a2a22);
    ambient.intensity = 0.36;
  } else { // night
    scene.background.set(0x05070a);
    scene.fog.color.set(0x05070a); scene.fog.density = 0.012;
    sun.intensity = 0.08; sun.color.set(0xfff2d8); sun.position.set(12, 20, 8);
    moon.intensity = 0.9;
    hemi.intensity = 0.15; hemi.color.set(0x9db8d4); hemi.groundColor.set(0x2a2418);
    ambient.intensity = 0.12;
  }
}

// Low-rise street-front shops lining the left side of the drive road:
// 2-3 storeys, fronts at x -6.1 just behind the sidewalk, ground-floor
// shopfronts with glass, doors and striped awnings. Each building is
// about 20 m along the road with two shopfronts (each 8-12 m wide), so a
// row of about 290 m holds 12 buildings. Gaps are left at the two gas
// stations so they stay visible from the road. palette is a shared
// skyFacadePalette (registered, so the window glow follows the time of day).
function makeMarketShopRow(zTop, zBottom, palette, startIdx, parent) {
  const host = parent || travelGroup;
  const shopNames = ['CAFE', 'DELI', 'BAKERY', 'PHARMACY', 'FLOWERS', 'BOOKS', 'PIZZA', 'MARKET'];
  const awnCols = [0xc0392b, 0x2e6fb0, 0x2e7a4a, 0xc07a1a, 0x7a2e5a, 0x3a3a3a, 0xd8b13a, 0x2e6a7a];
  const mats = [palette[2], palette[3], palette[4], palette[5]];
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x2a4a6a, roughness: 0.15, metalness: 0.4 });
  const doorMat = stdMat({ color: 0x2a2118, roughness: 0.7 });
  const corniceMat = stdMat({ color: 0xe8ecef, roughness: 0.9 });
  let n = 0;
  for (let zc = zTop - 12; zc >= zBottom + 12; zc -= 24) {
    if (Math.abs(zc + 90) < 16 || Math.abs(zc + 560) < 16) continue; // keep the gas stations visible
    const h = 6 + (n % 3) * 1.5;
    const shop = new THREE.Mesh(new THREE.BoxGeometry(5, h, 20), mats[(startIdx + n) % mats.length]);
    shop.position.set(-8.6, h / 2, zc); shop.castShadow = true; host.add(shop);
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.25, 20.3), corniceMat);
    cornice.position.set(-8.6, h + 0.1, zc); host.add(cornice);
    for (let j = 0; j < 2; j++) {
      const fz = zc - 5 + j * 10;
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2.2), glassMat);
      glass.position.set(-6.08, 1.4, fz - 1.5); glass.rotation.y = Math.PI / 2; host.add(glass);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.2, 1.0), doorMat);
      door.position.set(-6.05, 1.1, fz + 2.5); host.add(door);
      const awn = makeShopAwning(awnCols[(startIdx + n * 2 + j) % awnCols.length], shopNames[(startIdx + n * 2 + j) % shopNames.length]);
      awn.position.set(-6.0, 0, fz); awn.rotation.y = Math.PI / 2; host.add(awn);
    }
    n++;
  }
}

// Upstate country road: fields, hills, fences, dense trees, a few
// farmhouses and barns, utility poles, and the reservoir with its dam
// wall near the far end. No city paint, no crowds - open country
// between the city and Rondout.
function buildUpstateDrive(g) {
  const fieldCols = [0x4a6a34, 0x5a7a3a, 0x6a7a3a, 0x7a6a3a, 0x3f5f30];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(60, 120), stdMat({ color: fieldCols[(i + (side > 0 ? 2 : 0)) % fieldCols.length], roughness: 1 }));
      f.rotation.x = -Math.PI / 2;
      f.position.set(side * 35, 0.0, -60 - i * 120);
      f.receiveShadow = true; g.add(f);
    }
  }
  // Rolling hills far out on both sides.
  for (let i = 0; i < 10; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(18 + Math.random() * 14, 12, 8), stdMat({ color: 0x3a5a30, roughness: 1 }));
    hill.scale.y = 0.18;
    hill.position.set(side * (55 + Math.random() * 25), 0, -40 - i * 70);
    g.add(hill);
  }
  // Wooden fences along both road edges: posts and two rails.
  const fenceMat = stdMat({ color: 0x6a4a2e, roughness: 0.95 });
  for (const side of [-1, 1]) {
    for (const ry of [0.45, 0.85]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 720), fenceMat);
      rail.position.set(side * 5.6, ry, -360); g.add(rail);
    }
    for (let z = -6; z >= -714; z -= 12) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.12), fenceMat);
      post.position.set(side * 5.6, 0.5, z); g.add(post);
    }
  }
  // Dense trees beyond the fences.
  for (let z = -14; z >= -700; z -= 11) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.35) continue;
      const tree = makeStreetTree();
      const sc = 1.2 + Math.random() * 0.9;
      tree.scale.set(sc, sc, sc);
      tree.position.set(side * (8 + Math.random() * 14), 0, z + (Math.random() * 6 - 3));
      g.add(tree);
    }
  }
  // Utility poles down the west side.
  const poleMat = stdMat({ color: 0x4a3a28, roughness: 0.95 });
  for (let z = -30; z >= -690; z -= 36) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 7, 8), poleMat);
    pole.position.set(-6.4, 3.5, z); pole.castShadow = true; g.add(pole);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.1), poleMat);
    cross.position.set(-6.4, 6.4, z); g.add(cross);
  }
  // A few farmhouses and barns, set back from the road.
  const houseCols = [0xe8e0d0, 0xd8c8a8, 0xc8b898];
  for (const [hx, hz, barn] of [[-16, -120, false], [18, -260, true], [-20, -420, false], [16, -540, true]]) {
    const w = barn ? 7 : 5, h = barn ? 4 : 3.2, d = barn ? 9 : 6;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMat({ color: barn ? 0x8a2a22 : houseCols[Math.floor(Math.random() * houseCols.length)], roughness: 0.95 }));
    body.position.set(hx, h / 2, hz); body.castShadow = true; g.add(body);
    const r1 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.18, d * 0.62), stdMat({ color: 0x4a3a2e, roughness: 0.95 }));
    r1.position.set(hx, h + 0.7, hz - d * 0.22); r1.rotation.x = 0.55; g.add(r1);
    const r2 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.18, d * 0.62), stdMat({ color: 0x4a3a2e, roughness: 0.95 }));
    r2.position.set(hx, h + 0.7, hz + d * 0.22); r2.rotation.x = -0.55; g.add(r2);
  }
  // The reservoir near the far end (west side) with its dam wall.
  const water = new THREE.Mesh(new THREE.PlaneGeometry(70, 170), stdMat({ color: 0x2a5a7a, roughness: 0.25, metalness: 0.3 }));
  water.rotation.x = -Math.PI / 2; water.position.set(-45, 0.05, -635); g.add(water);
  const dam = new THREE.Mesh(new THREE.BoxGeometry(60, 4, 3), stdMat({ color: 0x8a8a84, roughness: 0.95 }));
  dam.position.set(-40, 2, -552); dam.castShadow = true; g.add(dam);
}
// Queens: lower brick blocks, an elevated train structure down the
// east side, warehouses toward the far end - the borough of brick,
// track steel and industry (Long Island City, Astoria, JFK).
function buildQueensDrive(g) {
  const brickMats = ['#7a4636', '#8a5a44', '#6a4a3a', '#9a6a50'].map(base => {
    const tex = skyscraperFacadeTexture(base, 5, 8, 0.3);
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.9 });
    travelWindowMats.push(m);
    return m;
  });
  const roofMat = stdMat({ color: 0x3a3f44, roughness: 0.95 });
  for (let z = -12; z >= -700; z -= 16) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.18) continue;
      if (side === 1 && Math.random() < 0.5) continue; // the elevated line takes the east side
      const w = 8 + Math.random() * 6, h = 9 + Math.random() * 6, d = 8 + Math.random() * 3;
      const mat = brickMats[Math.floor(Math.random() * brickMats.length)];
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mat, mat, roofMat, roofMat, mat, mat]);
      b.position.set(side * (8 + w / 2 + Math.random() * 2), h / 2, z + (Math.random() * 4 - 2));
      b.castShadow = true; g.add(b);
      if (Math.random() < 0.35) { const wt = makeWaterTower(); wt.position.set(b.position.x, h, b.position.z); g.add(wt); }
    }
  }
  // Elevated structure: steel pillars and a track bed down the east
  // side, with a train standing on it.
  const steel = stdMat({ color: 0x4a5058, metalness: 0.7, roughness: 0.45 });
  for (let z = -8; z >= -712; z -= 12) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6.2, 0.5), steel);
    p.position.set(9.5, 3.1, z); p.castShadow = true; g.add(p);
  }
  const bed = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.4, 720), steel);
  bed.position.set(9.5, 6.4, -360); g.add(bed);
  for (const rx of [8.9, 10.1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 720), stdMat({ color: 0x8a949c, metalness: 0.8, roughness: 0.35 }));
    rail.position.set(rx, 6.66, -360); g.add(rail);
  }
  const trainMat = stdMat({ color: 0xb8bcc0, metalness: 0.6, roughness: 0.4 });
  const trainWin = new THREE.MeshStandardMaterial({ color: 0x2a2010, emissive: 0xffd9a0, emissiveIntensity: 0.7, roughness: 0.3 });
  for (const tz of [-180, -430]) {
    for (let c = 0; c < 3; c++) {
      const car = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 14), trainMat);
      car.position.set(9.5, 8.0, tz - c * 15); car.castShadow = true; g.add(car);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.7, 13), trainWin);
      strip.position.set(9.5, 8.4, tz - c * 15); g.add(strip);
    }
  }
  // Warehouses toward the far end (the industrial yards).
  for (const [wx, wz] of [[-16, -520], [17, -580], [-18, -640]]) {
    const wh = new THREE.Mesh(new THREE.BoxGeometry(18, 6, 12), stdMat({ color: 0x7a7a74, roughness: 0.95 }));
    wh.position.set(wx, 3, wz); wh.castShadow = true; g.add(wh);
    const wr = new THREE.Mesh(new THREE.BoxGeometry(18.4, 0.3, 12.4), stdMat({ color: 0x5a5a54, roughness: 0.95 }));
    wr.position.set(wx, 6.15, wz); g.add(wr);
  }
}
// Brooklyn: attached brownstone rows with stoops and cornices - a
// narrower, house-lined street. Facade textures carry the windows,
// so each house is a handful of boxes.
function buildBrooklynDrive(g) {
  const brownMats = ['#6a4a3a', '#7a5240', '#5a3a2e'].map(base => {
    const tex = skyscraperFacadeTexture(base, 2, 4, 0.3);
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.95 });
    travelWindowMats.push(m);
    return m;
  });
  const corniceMat = stdMat({ color: 0xd8cfc0, roughness: 0.9 });
  const doorMat = stdMat({ color: 0x2a2118, roughness: 0.7 });
  const roofMat = stdMat({ color: 0x3a3f44, roughness: 0.95 });
  for (let z = -8; z >= -706; z -= 6.5) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.08) continue; // the odd gap / side street
      const h = 11 + Math.random() * 2;
      const mat = brownMats[Math.floor(Math.random() * brownMats.length)];
      const hx = side * 8.2;
      const house = new THREE.Mesh(new THREE.BoxGeometry(5, h, 6.2), [mat, mat, roofMat, roofMat, mat, mat]);
      house.position.set(hx, h / 2, z); house.castShadow = true; g.add(house);
      const cor = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.35, 6.5), corniceMat);
      cor.position.set(hx, h + 0.1, z); g.add(cor);
      // Stoop: three steps up to the front door, facing the road.
      const fx = hx - side * 2.5;
      for (let s = 0; s < 3; s++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 1.4), corniceMat);
        step.position.set(fx - side * (0.25 + s * 0.22), 0.12 + s * 0.18, z); g.add(step);
      }
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.2, 1.0), doorMat);
      door.position.set(fx - side * 0.02, 1.6, z); g.add(door);
    }
  }
}
// The bridge approach: water on both sides of the Narrows, a
// guardrail, concrete barriers, the skyline across the water, and
// the two towers with their cables waiting at the far end.
function buildBridgeDrive(g) {
  const water = new THREE.Mesh(new THREE.PlaneGeometry(130, 740), stdMat({ color: 0x1a3a5a, roughness: 0.2, metalness: 0.35 }));
  water.rotation.x = -Math.PI / 2; water.position.set(72, -1.2, -360); g.add(water);
  const water2 = new THREE.Mesh(new THREE.PlaneGeometry(90, 740), stdMat({ color: 0x16324e, roughness: 0.2, metalness: 0.35 }));
  water2.rotation.x = -Math.PI / 2; water2.position.set(-58, -1.2, -360); g.add(water2);
  // Guardrail along the water side.
  const railMat = stdMat({ color: 0x8a949c, metalness: 0.8, roughness: 0.35 });
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 720), railMat);
  rail.position.set(5.4, 0.75, -360); g.add(rail);
  for (let z = -6; z >= -714; z -= 12) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.75, 0.12), railMat);
    post.position.set(5.4, 0.38, z); g.add(post);
  }
  // Concrete barriers on the land side.
  const conc = stdMat({ color: 0x9a9a94, roughness: 0.95 });
  for (let z = -16; z >= -700; z -= 24) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 5), conc);
    bar.position.set(-5.4, 0.4, z); bar.castShadow = true; g.add(bar);
  }
  // Skyline silhouettes across the water (west, far).
  const skyMat = new THREE.MeshStandardMaterial({ color: 0x141a22, emissive: 0xffc978, emissiveIntensity: 0.12, roughness: 0.9 });
  for (let i = 0; i < 14; i++) {
    const h = 14 + Math.random() * 22;
    const b = new THREE.Mesh(new THREE.BoxGeometry(8 + Math.random() * 6, h, 8), skyMat);
    b.position.set(-38 - Math.random() * 18, h / 2 - 1, -30 - i * 50);
    g.add(b);
  }
  // The two towers at the far end, with the main cables.
  const towerMat = stdMat({ color: 0x3a4046, roughness: 0.8, metalness: 0.3 });
  for (const tz of [-620, -690]) {
    for (const tx of [-4.2, 4.2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 34, 1.6), towerMat);
      leg.position.set(tx, 17, tz); leg.castShadow = true; g.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(10, 1.6, 1.6), towerMat);
    beam.position.set(0, 33, tz); g.add(beam);
    const beam2 = new THREE.Mesh(new THREE.BoxGeometry(10, 1.2, 1.4), towerMat);
    beam2.position.set(0, 20, tz); g.add(beam2);
  }
  const cableMat = stdMat({ color: 0x22262a, metalness: 0.7, roughness: 0.5 });
  for (const cx of [-4.2, 4.2]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(cx, 33, -620), new THREE.Vector3(cx, 12, -655), new THREE.Vector3(cx, 33, -690)
    ]);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.18, 6), cableMat);
    g.add(cable);
    const curve2 = new THREE.CatmullRomCurve3([
      new THREE.Vector3(cx, 33, -620), new THREE.Vector3(cx, 14, -540), new THREE.Vector3(cx, 6, -470)
    ]);
    const cable2 = new THREE.Mesh(new THREE.TubeGeometry(curve2, 24, 0.15, 6), cableMat);
    g.add(cable2);
  }
}
function buildTravelScene() {
  if (travelGroup) return travelGroup;
  travelGroup = new THREE.Group();
  travelGroup.visible = false;
  scene.add(travelGroup);
  // Area dressing groups (see DRIVE_AREAS): the road, traffic, parked
  // cars, trees and lamps below are shared by every drive; the city
  // road paint and each area's buildings live in their own group and
  // applyDriveArea shows only the destination's part of New York.
  const cityPaint = new THREE.Group(); cityPaint.name = 'driveCityPaint'; travelGroup.add(cityPaint);
  driveCityPaint = cityPaint;
  for (const ak of ['manhattan', 'upstate', 'queens', 'brooklyn', 'bridge']) {
    const ag = new THREE.Group(); ag.name = 'driveArea_' + ak; ag.visible = ak === 'manhattan';
    travelGroup.add(ag); driveAreaGroups[ak] = ag;
  }
  const manhattanGroup = driveAreaGroups.manhattan;
  // A long road running forward (-z). The camera drives along it. The
  // street looks like the photo: a GREEN TILED road (hexagonal tiles),
  // green bike lanes with bicycle symbols, "MAIN ST" painted on it,
  // parked cars on both sides, trees lining the street, shops with
  // awnings, and a white striped crosswalk.
  const roadTex = hexTileTexture();
  roadTex.repeat.set(2, 160);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(9, DRIVE_ROAD_LEN), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0.02, -DRIVE_ROAD_LEN / 2); road.receiveShadow = true; travelGroup.add(road);
  for (let z = -4; z >= -DRIVE_ROAD_LEN + 4; z -= 8) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 3), new THREE.MeshBasicMaterial({ color: 0xd8b13a }));
    dash.rotation.x = -Math.PI / 2; dash.position.set(0, 0.04, z); travelGroup.add(dash);
  }
  // Green bike lanes along both edges of the road, with bicycle symbols.
  // City road paint (lanes, symbols, MAIN ST, crosswalk) rides in the
  // cityPaint group: it belongs to the city streets, not the country
  // road or the bridge approach.
  const bikeTex = bikeSymbolTexture();
  for (const x of [-3.6, 3.6]) {
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(1.0, DRIVE_ROAD_LEN), stdMat({ color: 0x2e7a4a, roughness: 0.95 }));
    lane.rotation.x = -Math.PI / 2; lane.position.set(x, 0.04, -DRIVE_ROAD_LEN / 2); cityPaint.add(lane);
  }
  for (const x of [-3.6, 3.6]) for (let z = -30; z >= -700; z -= 60) {
    const sym = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: bikeTex, transparent: true, opacity: 0.85, depthWrite: false }));
    sym.rotation.x = -Math.PI / 2; sym.rotation.z = Math.PI / 2; sym.position.set(x, 0.05, z); cityPaint.add(sym);
  }
  // "MAIN ST" painted on the road, every so often.
  const mainTex = mainStTexture();
  for (const z of [-40, -140, -240, -340, -440, -540, -640]) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: mainTex, transparent: true, opacity: 0.9, depthWrite: false }));
    t.rotation.x = -Math.PI / 2; t.rotation.z = Math.PI / 2; t.position.set(0, 0.05, z); cityPaint.add(t);
  }
  // A white striped crosswalk across the road.
  for (let i = 0; i < 6; i++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 8.4), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }));
    stripe.rotation.x = -Math.PI / 2; stripe.position.set(-2.9 + i * 1.15, 0.05, -100); cityPaint.add(stripe);
  }
  // Parked cars along both curbs, trees lining the sidewalks.
  const parkCols = [0xc0392b, 0x2e6fb0, 0xd8d8d8, 0x3a3a3a, 0xc07a1a, 0x5a7a3a];
  for (let z = -24; z >= -700; z -= 28) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.4) continue;
      const pc = makeStreetCar(parkCols[Math.floor(Math.random() * parkCols.length)]);
      pc.position.set(side * 3.9, 0, z);
      pc.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      travelGroup.add(pc);
    }
  }
  for (let z = -18; z >= -700; z -= 24) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.3) continue;
      if (side === -1 && ((z <= -10 && z >= -300) || (z <= -360 && z >= -650))) continue; // left trees would stand inside the shop fronts
      const tree = makeStreetTree();
      tree.position.set(side * 6.2, 0, z); travelGroup.add(tree);
    }
  }
  // Pedestrians on the sidewalks, walking along the street in both
  // directions, like the plaza video. They scroll past as the car drives.
  const driveCrowd = makeCrowd({ count: 10, lane: { axis: 'z', fixed: 5.6, min: -710, max: 0 } });
  const driveCrowd2 = makeCrowd({ count: 10, lane: { axis: 'z', fixed: -5.6, min: -710, max: 0 } });
  for (const p of [...driveCrowd, ...driveCrowd2]) { travelGroup.add(p.group); travelPedestrians.push(p); }
  // Buildings on both sides, scrolling past as the camera drives: varied
  // NYC skyscrapers, slab glass, setback, spired, tapered, brick with a
  // rooftop water tower, Art Deco crown, in blue glass, dark glass,
  // brick, pale stone and white, with lit windows. The window glow is
  // turned up at dusk/night and down in daylight by setTimeOfDay (the
  // palette materials are kept in travelWindowMats). Towers are placed
  // so their street-side face stays clear of the trees and sidewalks.
  const drivePalette = skyFacadePalette(0.4, true);
  // Landmark z positions, by side: no tower is placed on top of the gas
  // stations, the hospital tower, the police station or Zama HQ.
  const landmarkZ = { '-1': [-90, -320, -560], '1': [-150, -200, -450] };
  for (let z = -10; z >= -710; z -= 14) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.25) continue; // gaps so the street breathes
      if (landmarkZ[String(side)].some(lz => Math.abs(z - lz) < 12)) continue;
      if (side === -1 && ((z <= -10 && z >= -300) || (z <= -360 && z >= -650))) continue; // shop rows line the left side here
      const pick = pickSkyscraper(drivePalette, 0);
      const bx = side * (7.5 + pick.w / 2 + Math.random() * 4);
      const bz = z + (Math.random() * 4 - 2);
      pick.group.position.set(bx, 0, bz);
      manhattanGroup.add(pick.group);
      // A shop awning on the ground floor of the lower buildings, facing
      // the road, so the street reads as shops, not blank towers.
      if (pick.h < 14 && Math.random() < 0.6) {
        const awn = makeShopAwning([0xc0392b, 0x2e6fb0, 0x2e7a4a, 0xc07a1a][Math.floor(Math.random() * 4)], null);
        awn.position.set(bx - side * 4, 0, bz);
        awn.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        manhattanGroup.add(awn);
      }
    }
    // Street lights: a real cobra-head lamp every 42 m, alternating
    // sides, so the road is lit like a real street and not lined solid
    // with poles. The lamps follow the time of day (off in daylight).
    if (Math.round(-z / 14) % 3 === 0) {
      const side = (Math.floor(Math.round(-z / 14) / 3) % 2 === 0) ? 1 : -1;
      const lamp = makeStreetLight(side > 0 ? -Math.PI / 2 : Math.PI / 2, 0.06);
      lamp.group.position.set(side * 5.2, 0, z); travelGroup.add(lamp.group);
    }
  }
  // Market Street shop rows on the left side of the drive: row 1 from
  // the start of the drive, row 2 further along past the 3-mile mark
  // (z -360 is roughly 3 miles into a typical 6-8 mile drive, since the
  // 720 m road stands in for the whole trip).
  makeMarketShopRow(-10, -300, drivePalette, 0, manhattanGroup);
  makeMarketShopRow(-360, -650, drivePalette, 2, manhattanGroup);
  // Landmark on the drive: a tall white hospital tower with a rounded
  // corner and rows of windows, like the photo, plus a lower white wing.
  // It stands out from the other buildings so the city reads as the photo.
  const towerMat = whiteFacadeMat(6, 14, 0.4);
  travelWindowMats.push(towerMat);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(10, 22, 6), towerMat);
  tower.position.set(16, 11, -150); tower.castShadow = true; manhattanGroup.add(tower);
  const towerCorner = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 22, 20), stdMat({ color: 0xf4f6f8, roughness: 0.85 }));
  towerCorner.position.set(11, 11, -147); towerCorner.castShadow = true; manhattanGroup.add(towerCorner);
  const wingMat = whiteFacadeMat(8, 3, 0.4);
  travelWindowMats.push(wingMat);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 5), wingMat);
  wing.position.set(18, 2.5, -141); wing.castShadow = true; manhattanGroup.add(wing);
  // The city pieces the player asked for: a gas station and a police
  // station, so the drive passes a real city, not just towers.
  // Gas station (west side, z = -90): a low white kiosk, a canopy on
  // pillars, pumps, and a GAS sign.
  const gasKiosk = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 4), whiteFacadeMat(3, 1, 0.3));
  gasKiosk.position.set(-15, 1.5, -90); manhattanGroup.add(gasKiosk);
  const gasCanopy = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 7), stdMat({ color: 0xc0392b, roughness: 0.7 }));
  gasCanopy.position.set(-15, 4.2, -96); manhattanGroup.add(gasCanopy);
  for (const [px, pz] of [[-17, -95], [-13, -95]]) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4.2, 8), stdMat({ color: 0xd8d8d8, metalness: 0.6, roughness: 0.4 }));
    pillar.position.set(px, 2.1, pz); manhattanGroup.add(pillar);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.5), stdMat({ color: 0xd8d8d8, roughness: 0.5 }));
    pump.position.set(px, 0.6, pz + 1.5); manhattanGroup.add(pump);
  }
  const gasSign = makeTextSprite('GAS', '#ffd166'); gasSign.scale.set(4, 1, 1); gasSign.position.set(-15, 5.6, -93); manhattanGroup.add(gasSign);
  // Police station (east side, z = -200): a proper NYPD precinct, not a
  // plain block - a pale stone building on a dark base, an entrance
  // portico with columns and steps, glass double doors, a blue stripe, a
  // US flag on a pole, a POLICE sign, a small plaza, two police cars, and
  // officers on duty at the door.
  const policeBase = new THREE.Mesh(new THREE.BoxGeometry(11, 1, 7), stdMat({ color: 0x5a5a58, roughness: 0.9 }));
  policeBase.position.set(15, 0.5, -200); policeBase.castShadow = true; manhattanGroup.add(policeBase);
  const policeMat = whiteFacadeMat(6, 3, 0.4);
  travelWindowMats.push(policeMat);
  const policeB = new THREE.Mesh(new THREE.BoxGeometry(10, 6.5, 6), policeMat);
  policeB.position.set(15, 4.25, -200); policeB.castShadow = true; manhattanGroup.add(policeB);
  const policeStripe = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.5, 6.2), stdMat({ color: 0x1a3a6a, roughness: 0.7 }));
  policeStripe.position.set(15, 6.9, -200); manhattanGroup.add(policeStripe);
  const policeParapet = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.4, 6.4), stdMat({ color: 0x8a8a86, roughness: 0.9 }));
  policeParapet.position.set(15, 7.7, -200); manhattanGroup.add(policeParapet);
  // Entrance portico: two columns, a canopy, steps, glass double doors.
  for (const cx of [13.6, 16.4]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 3, 12), stdMat({ color: 0xe8e2d4, roughness: 0.8 }));
    col.position.set(cx, 2.5, -196.6); col.castShadow = true; manhattanGroup.add(col);
  }
  const policeCanopy = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.25, 2), stdMat({ color: 0x1a3a6a, roughness: 0.7 }));
  policeCanopy.position.set(15, 4.1, -196.6); manhattanGroup.add(policeCanopy);
  for (let s = 0; s < 3; s++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(4.4 - s * 0.4, 0.18, 1.6 - s * 0.3), stdMat({ color: 0x9a9a96, roughness: 0.9 }));
    step.position.set(15, 0.09 + s * 0.18, -195.6 + s * 0.25); manhattanGroup.add(step);
  }
  for (const dx of [-0.45, 0.45]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.85, 2.2, 0.1), new THREE.MeshStandardMaterial({ color: 0x2a4a6a, roughness: 0.2, metalness: 0.4 }));
    door.position.set(15 + dx, 2.1, -196.9); manhattanGroup.add(door);
  }
  const policeSign = makeTextSprite('POLICE', '#7fb0ff'); policeSign.scale.set(5, 1.1, 1); policeSign.position.set(15, 8.6, -196.8); manhattanGroup.add(policeSign);
  // US flag on a pole in front of the station.
  const policeFlagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 8, 8), stdMat({ color: 0x8a8a86, metalness: 0.7, roughness: 0.4 }));
  policeFlagPole.position.set(11, 4, -196); manhattanGroup.add(policeFlagPole);
  const policeFlag = makeUSFlag(); policeFlag.position.set(11, 7.3, -196); manhattanGroup.add(policeFlag);
  // Plaza: a bench and a planter in front of the station.
  const policeBench = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.45, 0.6), stdMat({ color: 0x6b4226, roughness: 0.85 }));
  policeBench.position.set(11, 0.45, -202); manhattanGroup.add(policeBench);
  const policePlanter = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.4, 0.6, 10), stdMat({ color: 0x5a5a58, roughness: 0.9 }));
  policePlanter.position.set(19, 0.3, -196); manhattanGroup.add(policePlanter);
  const policeShrub = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), stdMat({ color: 0x2e7a4a, roughness: 0.95 }));
  policeShrub.position.set(19, 0.85, -196); manhattanGroup.add(policeShrub);
  // Two police cars parked in front, with blue light bars.
  for (const pz of [-196, -203]) {
    const pc = makeStreetCar(0xf2f2f2);
    pc.position.set(9, 0, pz); pc.rotation.y = Math.PI / 2; manhattanGroup.add(pc);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.2), new THREE.MeshBasicMaterial({ color: 0x2a6ab0 }));
    bar.position.set(9, 1.3, pz); manhattanGroup.add(bar);
  }
  // Officers on duty: two standing guard at the entrance, one by a
  // police car. They face the road (west).
  for (const [ox, oz] of [[13.4, -196.2], [16.6, -196.2], [9.8, -199.5]]) {
    const off = makeOfficer('police', { x: ox, z: oz, speed: 0 });
    if (off) { off.group.position.set(ox, 0, oz); off.group.rotation.y = off.rigged ? Math.PI / 2 : -Math.PI / 2; manhattanGroup.add(off.group); }
  }
  // Navy Barracks (west side, z = -320): a US Naval barracks in the
  // Brooklyn Navy Yard style - a long olive barracks block, a fenced
  // yard with a gate, a guard tower, a US flag, a military truck,
  // crates, and sailors on duty at the gate.
  const barracksMat = stdMat({ color: 0x5a5a3a, roughness: 0.9 });
  const barracks = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 6), barracksMat);
  barracks.position.set(-16, 2.5, -320); barracks.castShadow = true; manhattanGroup.add(barracks);
  const barracksRoof = new THREE.Mesh(new THREE.BoxGeometry(14.4, 0.3, 6.4), stdMat({ color: 0x3a3a30, roughness: 0.9 }));
  barracksRoof.position.set(-16, 5.15, -320); manhattanGroup.add(barracksRoof);
  // A row of windows on the front (road side) of the barracks.
  for (let i = 0; i < 6; i++) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1), new THREE.MeshStandardMaterial({ color: 0x2a3a4a, roughness: 0.3, metalness: 0.3, emissive: 0xffd166, emissiveIntensity: 0.15 }));
    win.position.set(-21.5 + i * 2.2, 2.8, -316.9); manhattanGroup.add(win);
  }
  const barracksSign = makeTextSprite('NAVY BARRACKS', '#ffd166'); barracksSign.scale.set(6, 1.2, 1); barracksSign.position.set(-16, 6.4, -316.8); manhattanGroup.add(barracksSign);
  // Guard tower at the corner of the yard.
  for (const [lx, lz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 8), stdMat({ color: 0x3a3a30, roughness: 0.9 }));
    leg.position.set(-10.5 + lx, 1.7, -314 + lz); manhattanGroup.add(leg);
  }
  const towerCab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2, 2.2), stdMat({ color: 0x5a5a3a, roughness: 0.9 }));
  towerCab.position.set(-10.5, 4.4, -314); manhattanGroup.add(towerCab);
  const towerRoof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 2.6), stdMat({ color: 0x3a3a30, roughness: 0.9 }));
  towerRoof.position.set(-10.5, 5.5, -314); manhattanGroup.add(towerRoof);
  // Fenced yard in front of the barracks (road side), with a gate gap on
  // the north side at x -14 to -12.
  const fenceMat = stdMat({ color: 0x6a6a66, metalness: 0.6, roughness: 0.5 });
  const yardX0 = -22, yardX1 = -10, yardZ0 = -326, yardZ1 = -314;
  for (let x = yardX0; x <= yardX1; x += 2) {
    for (const z of [yardZ0, yardZ1]) {
      if (z === yardZ1 && x >= -14 && x <= -12) continue; // the gate gap
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), fenceMat);
      post.position.set(x, 0.8, z); manhattanGroup.add(post);
    }
  }
  for (const y of [0.6, 1.3]) {
    const railS = new THREE.Mesh(new THREE.BoxGeometry(yardX1 - yardX0, 0.06, 0.06), fenceMat);
    railS.position.set((yardX0 + yardX1) / 2, y, yardZ0); manhattanGroup.add(railS);
    const railN1 = new THREE.Mesh(new THREE.BoxGeometry(-14 - yardX0, 0.06, 0.06), fenceMat);
    railN1.position.set((yardX0 + -14) / 2, y, yardZ1); manhattanGroup.add(railN1);
    const railN2 = new THREE.Mesh(new THREE.BoxGeometry(yardX1 - -12, 0.06, 0.06), fenceMat);
    railN2.position.set((-12 + yardX1) / 2, y, yardZ1); manhattanGroup.add(railN2);
    for (const x of [yardX0, yardX1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, yardZ1 - yardZ0), fenceMat);
      rail.position.set(x, y, (yardZ0 + yardZ1) / 2); manhattanGroup.add(rail);
    }
  }
  // US flag on a pole in the yard, a military truck, crates and a barrel.
  const navyFlagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 8, 8), stdMat({ color: 0x8a8a86, metalness: 0.7, roughness: 0.4 }));
  navyFlagPole.position.set(-20, 4, -316); manhattanGroup.add(navyFlagPole);
  const navyFlag = makeUSFlag(); navyFlag.position.set(-20, 7.3, -316); manhattanGroup.add(navyFlag);
  const truck = buildCar(0x4a4a2a, { type: 'van' });
  truck.position.set(-16, 0, -320); truck.rotation.y = Math.PI / 2; manhattanGroup.add(truck);
  for (const [cx, cz] of [[-12, -324], [-12.8, -324]]) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), stdMat({ color: 0x8a6a3a, roughness: 0.95 }));
    crate.position.set(cx, 0.45, cz); manhattanGroup.add(crate);
  }
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 12), stdMat({ color: 0x3a5a3a, metalness: 0.4, roughness: 0.6 }));
  barrel.position.set(-11, 0.45, -322); manhattanGroup.add(barrel);
  // Sailors on duty: two standing guard at the gate, facing the road (east).
  for (const [sx, sz] of [[-14, -314.5], [-12, -314.5]]) {
    const sal = makeOfficer('navy', { x: sx, z: sz, speed: 0 });
    if (sal) { sal.group.position.set(sx, 0, sz); sal.group.rotation.y = sal.rigged ? -Math.PI / 2 : Math.PI / 2; manhattanGroup.add(sal.group); }
  }
  // Traffic: cars coming the other way and cars ahead in our lane.
  // Realistic cars (see player.js buildCar), not boxes. Spread along
  // the whole 720 m road, so the long drive never empties.
  const carCols = [0xc0392b, 0x2e6fb0, 0xd8d8d8, 0xc07a1a];
  for (let i = 0; i < 8; i++) {
    const oncoming = i % 2 === 0;
    const car = buildCar(carCols[i % carCols.length], { type: 'sedan' });
    car.position.set(oncoming ? -2.2 : 2.2, 0, -20 - i * 80 - Math.random() * 20);
    if (!oncoming) car.rotation.y = Math.PI;
    travelGroup.add(car);
    travelCars.push({ group: car, speed: oncoming ? 14 : 4 });
  }
  // Zama HQ tower on the long drive (east side, z = -450): a tall dark
  // tower with a gold ZAMA sign, so the drive passes the Zama place on
  // the map. A second gas station further down (west side, z = -560).
  const zamaTowerMat = new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.4, metalness: 0.6 });
  const zamaTower = new THREE.Mesh(new THREE.BoxGeometry(9, 26, 8), zamaTowerMat);
  zamaTower.position.set(16, 13, -450); zamaTower.castShadow = true; manhattanGroup.add(zamaTower);
  const zamaSign = makeTextSprite('ZAMA', '#ffd166'); zamaSign.scale.set(6, 1.4, 1); zamaSign.position.set(16, 28, -446); manhattanGroup.add(zamaSign);
  const gas2Kiosk = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 4), whiteFacadeMat(3, 1, 0.3));
  gas2Kiosk.position.set(-15, 1.5, -560); manhattanGroup.add(gas2Kiosk);
  const gas2Canopy = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 7), stdMat({ color: 0x2e6fb0, roughness: 0.7 }));
  gas2Canopy.position.set(-15, 4.2, -566); manhattanGroup.add(gas2Canopy);
  for (const [px, pz] of [[-17, -565], [-13, -565]]) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4.2, 8), stdMat({ color: 0xd8d8d8, metalness: 0.6, roughness: 0.4 }));
    pillar.position.set(px, 2.1, pz); manhattanGroup.add(pillar);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.5), stdMat({ color: 0xd8d8d8, roughness: 0.5 }));
    pump.position.set(px, 0.6, pz + 1.5); manhattanGroup.add(pump);
  }
  const gas2Sign = makeTextSprite('GAS', '#ffd166'); gas2Sign.scale.set(4, 1, 1); gas2Sign.position.set(-15, 5.6, -563); manhattanGroup.add(gas2Sign);
  // The other parts of New York, one dressing group each (only the
  // destination's group shows on any drive - see applyDriveArea).
  buildUpstateDrive(driveAreaGroups.upstate);
  buildQueensDrive(driveAreaGroups.queens);
  buildBrooklynDrive(driveAreaGroups.brooklyn);
  buildBridgeDrive(driveAreaGroups.bridge);
  // The area sign at the start of the road names the part of New
  // York this drive crosses (applyDriveArea sets its text per trip).
  driveAreaSign = makeTextSprite('MANHATTAN', '#ffd166');
  driveAreaSign.name = 'driveAreaSign';
  driveAreaSign.scale.set(10, 2.4, 1);
  driveAreaSign.position.set(0, 5.4, -30);
  driveAreaSign.userData.areaName = 'MANHATTAN';
  travelGroup.add(driveAreaSign);
  // Sync the window glow to the current time of day (the scene is built
  // lazily on the first drive, so the materials start at the build-time
  // value and need one sync).
  setTimeOfDay(currentTimeMode);
  return travelGroup;
}

// Draw the city map as a LIVE map of New York: real geography - the
// Hudson River on the west, Manhattan with its street grid, the East
// River, Brooklyn and Queens on Long Island, Staten Island, the
// Verrazzano Bridge across the Narrows, and upstate at the top. Every
// place sits at its real NYC spot, and the route is drawn like a
// navigation route (a solid line with a casing, bending through the
// streets), not a straight dashed line. Borough names are printed on
// the map. Day is a light map, dusk and night are dark.
function drawTravelMap(canvas, fromKey, toKey) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const mode = toKey && TRAVEL_PLACES[toKey].type === 'mission' ? MISSION_TIME[TRAVEL_PLACES[toKey].mission] : (pendingMission ? MISSION_TIME[TRAVEL_PLACES[pendingMission.key].mission] : MISSION_TIME[state.mission]);
  const light = mode === 'day';
  const water = light ? '#a9c8de' : mode === 'dusk' ? '#2c3247' : '#16222e';
  const land = light ? '#e9e6da' : mode === 'dusk' ? '#3a3f4a' : '#232d33';
  const land2 = light ? '#dfe4d2' : mode === 'dusk' ? '#333845' : '#1e282e';
  const streetCol = light ? '#ffffff' : mode === 'dusk' ? '#4a5060' : '#2e3a42';
  const textCol = light ? '#20242a' : '#e8eef2';
  const subCol = light ? '#5a6a75' : '#8a97a3';
  const faintCol = light ? '#7a8a96' : '#5a6a75';
  // Water base.
  ctx.fillStyle = water; ctx.fillRect(0, 0, W, H);
  function landPoly(points, fill) {
    ctx.fillStyle = fill || land;
    ctx.beginPath();
    ctx.moveTo(points[0][0] * W, points[0][1] * H);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0] * W, points[i][1] * H);
    ctx.closePath(); ctx.fill();
  }
  // New Jersey (west bank), leaving the Hudson River open beside Manhattan.
  landPoly([[0, 0.16], [0.24, 0.18], [0.33, 0.30], [0.34, 0.55], [0.30, 0.78], [0, 0.80]], land2);
  // Upstate and the Bronx (top).
  landPoly([[0, 0], [1, 0], [1, 0.10], [0.62, 0.14], [0.40, 0.12], [0.24, 0.14], [0, 0.12]], land);
  // Manhattan: a long narrow island, slightly tilted.
  landPoly([[0.42, 0.13], [0.47, 0.12], [0.50, 0.28], [0.53, 0.45], [0.56, 0.62], [0.55, 0.78], [0.51, 0.80], [0.49, 0.62], [0.46, 0.45], [0.43, 0.28], [0.41, 0.16]], land);
  // Long Island: Brooklyn and Queens (right).
  landPoly([[0.60, 0.22], [1, 0.18], [1, 1], [0.66, 1], [0.60, 0.80], [0.58, 0.55], [0.58, 0.35]], land);
  // Staten Island (bottom left).
  landPoly([[0.10, 0.72], [0.30, 0.70], [0.34, 0.82], [0.30, 0.98], [0.12, 1], [0.06, 0.85]], land2);
  // Manhattan street grid: cross streets and two avenues along the island.
  const manW = y => 0.415 + (y - 0.13) * 0.13;
  const manE = y => 0.475 + (y - 0.13) * 0.12;
  ctx.strokeStyle = streetCol; ctx.lineWidth = 1;
  for (const y of [0.20, 0.30, 0.40, 0.50, 0.60, 0.70]) {
    ctx.beginPath(); ctx.moveTo(manW(y) * W, y * H); ctx.lineTo(manE(y) * W, y * H); ctx.stroke();
  }
  for (const f of [0.33, 0.66]) {
    ctx.beginPath();
    for (let y = 0.15; y <= 0.78; y += 0.09) {
      const x = (manW(y) + f * (manE(y) - manW(y))) * W;
      if (y === 0.15) ctx.moveTo(x, y * H); else ctx.lineTo(x, y * H);
    }
    ctx.stroke();
  }
  // Borough and river names, faint.
  ctx.fillStyle = faintCol; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
  ctx.fillText('U P S T A T E', 0.5 * W, 0.05 * H);
  ctx.fillText('NEW JERSEY', 0.13 * W, 0.45 * H);
  ctx.fillText('QUEENS', 0.80 * W, 0.30 * H);
  ctx.fillText('BROOKLYN', 0.78 * W, 0.72 * H);
  ctx.fillText('LONG ISLAND', 0.88 * W, 0.55 * H);
  ctx.fillText('STATEN ISLAND', 0.20 * W, 0.86 * H);
  ctx.save(); ctx.translate(0.36 * W, 0.45 * H); ctx.rotate(-Math.PI / 2); ctx.fillText('HUDSON RIVER', 0, 0); ctx.restore();
  ctx.save(); ctx.translate(0.585 * W, 0.45 * H); ctx.rotate(-Math.PI / 2); ctx.fillText('EAST RIVER', 0, 0); ctx.restore();
  ctx.save(); ctx.translate(0.49 * W, 0.45 * H); ctx.rotate(Math.PI / 2 - 0.13); ctx.fillText('MANHATTAN', 0, 0); ctx.restore();
  // Verrazzano Bridge across the Narrows, Staten Island to Brooklyn.
  ctx.strokeStyle = light ? '#8a97a3' : '#5a6a75'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0.33 * W, 0.82 * H); ctx.lineTo(0.61 * W, 0.86 * H); ctx.stroke();
  ctx.strokeStyle = light ? '#5a6a75' : '#8a97a3'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0.40 * W, 0.825 * H); ctx.lineTo(0.40 * W, 0.845 * H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0.53 * W, 0.845 * H); ctx.lineTo(0.53 * W, 0.865 * H); ctx.stroke();
  ctx.fillStyle = faintCol; ctx.font = '10px Arial'; ctx.textAlign = 'center';
  ctx.fillText('VERRAZZANO BRIDGE', 0.47 * W, 0.93 * H);
  // LIVE badge and compass.
  ctx.fillStyle = '#2e7a4a'; ctx.beginPath(); ctx.arc(14, 14, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = textCol; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'left';
  ctx.fillText('LIVE', 24, 18);
  ctx.fillStyle = textCol; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'right';
  ctx.fillText('N', W - 12, 20);
  ctx.strokeStyle = textCol; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(W - 12, 24); ctx.lineTo(W - 12, 36); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W - 12, 24); ctx.lineTo(W - 16, 30); ctx.lineTo(W - 8, 30); ctx.closePath(); ctx.fill();
  const from = TRAVEL_PLACES[fromKey], to = toKey ? TRAVEL_PLACES[toKey] : null;
  // Route: a navigation route - solid line with a casing, bending
  // through the streets, with an arrowhead at the destination end.
  if (to) {
    const fx = from.x * W, fy = from.y * H, tx = to.x * W, ty = to.y * H;
    const mx = (fx + tx) / 2, my = (fy + ty) / 2;
    const dx = tx - fx, dy = ty - fy, len = Math.hypot(dx, dy) || 1;
    const bend = Math.min(40, len * 0.18);
    const bx = mx - dy / len * bend, by = my + dx / len * bend;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = light ? '#ffffff' : '#0d141b'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
    const ang = Math.atan2(ty - by, tx - bx);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.moveTo(tx, ty);
    ctx.lineTo(tx - Math.cos(ang - 0.4) * 12, ty - Math.sin(ang - 0.4) * 12);
    ctx.lineTo(tx - Math.cos(ang + 0.4) * 12, ty - Math.sin(ang + 0.4) * 12);
    ctx.closePath(); ctx.fill();
  }
  // All places, spread across the real city. Landmarks (Zama HQ and the
  // Court) are diamonds; the rest are circles. The description shows
  // only for the place you are at and the one you picked, so the labels
  // never pile up in Midtown.
  for (const [key, p] of Object.entries(TRAVEL_PLACES)) {
    const x = p.x * W, y = p.y * H;
    const isFrom = key === fromKey, isTo = key === toKey;
    const st = placeStatus(key);
    // The Filling Station gets its own marker: a bright orange dot with a
    // fuel-pump glyph and its full name always drawn. As one more small
    // grey dot labelled "Fuel" it could not be found on the map at all,
    // and a player low on fuel has to be able to spot it at a glance.
    const isFuel = key === 'fillingstation';
    const col = isTo ? '#ffd166' : isFrom ? '#2e6fb0' : isFuel ? '#ff8c42' : st === 'next' ? '#ffd166' : st === 'done' ? '#3a4a58' : st === 'locked' ? '#2a3540' : '#5a6a75';
    ctx.fillStyle = col;
    if (p.landmark) {
      const r = isTo ? 11 : 8;
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(x, y, isTo ? 10 : isFuel ? 9 : 7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = isFuel && !isTo ? '#ffffff' : light ? '#ffffff' : '#0d141b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, isTo ? 13 : isFuel ? 12 : 10, 0, Math.PI * 2); ctx.stroke();
    if (isFuel) {
      // Fuel-pump glyph on the dot: a white pump body with a dark window
      // and a hose on the side.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 4, y - 5, 6, 10);
      ctx.fillStyle = '#111111';
      ctx.fillRect(x - 3, y - 4, 4, 3);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x + 2, y - 4); ctx.quadraticCurveTo(x + 6, y - 2, x + 5, y + 3); ctx.stroke();
    }
    const flip = p.x > 0.72;
    ctx.fillStyle = isFuel && !isTo ? '#ff8c42' : textCol; ctx.font = 'bold 14px Arial'; ctx.textAlign = flip ? 'right' : 'left';
    ctx.fillText(isFuel ? p.name : p.short, flip ? x - 14 : x + 14, y + 5);
    if (isFrom || isTo) {
      ctx.fillStyle = subCol; ctx.font = '11px Arial';
      ctx.fillText(p.desc, flip ? x - 14 : x + 14, y + 20);
    }
  }
  // Pulsing ring on the destination.
  if (to) {
    const pr = 16 + Math.sin(Date.now() / 300) * 4;
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(to.x * W, to.y * H, pr, 0, Math.PI * 2); ctx.stroke();
  }
}
// Status of a place on the map: 'next' (the mission to do), 'done'
// (a finished mission), 'locked' (a future mission), 'here' (where the
// player is), 'open' (a store, home or visit - always driveable).
function placeStatus(key) {
  const p = TRAVEL_PLACES[key];
  if (!p) return 'open';
  if (key === currentPlaceKey) return 'here';
  if (p.type === 'mission') {
    if (pendingMission && pendingMission.key === key) return 'next';
    if (missionsDone[p.mission]) return 'done';
    if (p.mission > state.mission) return 'locked';
    // The current mission's place, but he is physically somewhere
    // else (he drove to a visit mid-mission): driving back must stay
    // possible, or the mission is unreachable. Physical presence is
    // the currentPlaceKey check above; this fallthrough used to say
    // 'here' and soft-locked the return drive.
    return 'open';
  }
  return 'open';
}
function placeDriveable(key) {
  const st = placeStatus(key);
  // A finished mission place stays driveable: parking continuity means
  // the journey continues from where the car is parked, and the player
  // can drive back to a done mission's yard to walk it (no restart,
  // no second payout - see arriveAt).
  return st === 'next' || st === 'open' || st === 'done';
}

// The bridge leg is a trek, not a drive: after Mission 2 the player
// walks on foot from the substation to the bridge through the busy
// street. No car for this leg, and no skip - it is a real walk.
function isTrekLeg(key) {
  return !!(pendingMission && pendingMission.key === key && key === 'bridge');
}
export function openCityMap(fromKey, preselectKey) {
  // No map during a drive, a home scene, or the on-foot trek: the
  // walk is the mission and cannot be skipped, and closing the map
  // mid-trek used to kill the trek (street hidden, guide gone).
  if (travelActive || trekActive || window.__lsHomeActive) return;
  mapFromKey = fromKey || currentPlaceKey;
  if (preselectKey) mapSelectedKey = preselectKey;
  else if (!mapSelectedKey || !TRAVEL_PLACES[mapSelectedKey] || mapSelectedKey === mapFromKey) mapSelectedKey = pendingMission ? pendingMission.key : MISSION_PLACE[state.mission];
  if (!travelMapEl) {
    travelMapEl = document.createElement('div');
    travelMapEl.id = 'travelMap';
    travelMapEl.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(5,8,12,0.88);z-index:60;';
    travelMapEl.innerHTML = '<div style="width:min(640px,92vw);background:#101820;border:1px solid #2a3540;border-radius:12px;padding:18px 20px;color:#e8eef2;font-family:Arial,sans-serif;">'
      + '<div style="font-size:20px;font-weight:bold;letter-spacing:1px;">CITY MAP - New York</div>'
      + '<div id="travelRoute" style="color:#ffd166;margin:6px 0 10px;font-size:15px;"></div>'
      + '<canvas id="travelCanvas" width="600" height="340" style="width:100%;border-radius:8px;display:block;cursor:pointer;"></canvas>'
      + '<div id="travelHint" style="color:#9fb8c8;font-size:12px;margin-top:8px;">Live map of New York City - click a place, then Drive. Gold = your next mission. Orange = the Filling Station, refill your tank for 0.5 ZAMA. The bridge leg is a trek on foot - no car, walk the busy street. The wind tunnel lab is up in Morningside Heights, the symposium hall is in Astoria, and the NYC Court sits by Zama HQ in SoHo.</div>'
      + '<div style="display:flex;gap:10px;margin-top:14px;">'
      + '<button id="travelDriveBtn" type="button" style="flex:1;padding:12px;font-size:16px;font-weight:bold;background:#ffd166;color:#111;border:none;border-radius:8px;cursor:pointer;"></button>'
      + '<button id="travelSkipBtn" type="button" style="padding:12px 18px;font-size:15px;background:#22303a;color:#e8eef2;border:1px solid #3a4a58;border-radius:8px;cursor:pointer;">Skip drive</button>'
      + '<button id="travelCloseBtn" type="button" style="padding:12px 18px;font-size:15px;background:#22303a;color:#e8eef2;border:1px solid #3a4a58;border-radius:8px;cursor:pointer;">Close</button>'
      + '</div></div>';
    document.body.appendChild(travelMapEl);
    document.getElementById('travelCanvas').addEventListener('click', (e) => {
      const cv = document.getElementById('travelCanvas');
      const rect = cv.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width * 600;
      const y = (e.clientY - rect.top) / rect.height * 340;
      let best = null, bestD = 34;
      for (const [key, p] of Object.entries(TRAVEL_PLACES)) {
        const d = Math.hypot(p.x * 600 - x, p.y * 340 - y);
        if (d < bestD) { bestD = d; best = key; }
      }
      if (best) { mapSelectedKey = best; refreshMapUI(); }
    });
    document.getElementById('travelDriveBtn').onclick = () => {
      if (!mapSelectedKey || !placeDriveable(mapSelectedKey)) return;
      const key = mapSelectedKey;
      travelMapEl.style.display = 'none';
      if (isTrekLeg(key)) startTrek(key, arriveAt(key));
      else {
        // The drive starts where the car is parked: at a mission lot
        // he is seated in the parked car first and the drive leaves
        // from the lot, instead of the car vanishing and the drive
        // starting from nowhere. (At the arrival lot he is already
        // seated in the car - see getInParkedCar.)
        // The seated beat is held long enough to be seen (2.2 s, with
        // a "Leaving ..." toast): at 900 ms the live check never saw
        // it, and at the arrival lot there was no beat at all - the
        // seated view sat behind the map overlay and Drive cut
        // straight to the road. Now every path shows him in the car
        // at the lot first, then the road.
        const lotCar = departureLotCar();
        if (lotCar) {
          // He may be inside the valve room (Mission 1 ends there):
          // stepping out to the car leaves the room behind, and the
          // drive clears the flag anyway - clear it now so a get-out
          // during the beat cannot clamp him into the room's bounds.
          inValveRoom = false;
          // The lot is the current place's mission lot (a revisit to
          // a finished mission parks there), else the current
          // mission's lot - the same rule departureLotCar used.
          const depPlace = TRAVEL_PLACES[currentPlaceKey];
          const depMission = (depPlace && depPlace.type === 'mission') ? depPlace.mission : state.mission;
          const p = PARKING[depMission];
          const out = (p && p.driveSpawn) || { x: lotCar.position.x - 1.5, z: lotCar.position.z, yaw: 0 };
          seatPlayerInParkedCar(lotCar, out, null, { quiet: true });
          toast('Leaving ' + TRAVEL_PLACES[mapFromKey].name + '...');
          setTimeout(() => { if (!travelActive) startTravelDrive(key, arriveAt(key)); }, 2200);
        } else if (parkedSeatActive) {
          // Already seated at the arrival lot: hold the seated view
          // for the same beat so the departure is seen, not skipped.
          toast('Leaving ' + TRAVEL_PLACES[mapFromKey].name + '...');
          setTimeout(() => { if (!travelActive) startTravelDrive(key, arriveAt(key)); }, 2200);
        } else startTravelDrive(key, arriveAt(key));
      }
    };
    document.getElementById('travelSkipBtn').onclick = () => {
      if (!pendingMission) return;
      const key = pendingMission.key;
      travelMapEl.style.display = 'none';
      // Use the same arrival path as the Drive button (arriveAt), so the
      // scene switches to the destination just like a completed drive.
      // Then force the mission scene to match the mission state, so a
      // skip can never leave the old scene showing under the new mission.
      const arrive = arriveAt(key);
      arrive();
      restoreMissionScene();
    };
    document.getElementById('travelCloseBtn').onclick = () => { closeCityMap(); };
  }
  refreshMapUI();
  travelMapEl.style.display = 'flex';
}
function refreshMapUI() {
  const cv = document.getElementById('travelCanvas');
  if (!cv) return;
  drawTravelMap(cv, mapFromKey, mapSelectedKey);
  const from = TRAVEL_PLACES[mapFromKey];
  const sel = mapSelectedKey ? TRAVEL_PLACES[mapSelectedKey] : null;
  const routeEl = document.getElementById('travelRoute');
  const driveBtn = document.getElementById('travelDriveBtn');
  const skipBtn = document.getElementById('travelSkipBtn');
  if (!sel) {
    routeEl.textContent = 'You are at ' + from.name + '. Click a place on the map.';
    driveBtn.textContent = 'Drive ▸';
    driveBtn.disabled = true; driveBtn.style.opacity = '0.5';
  } else {
    const miles = getMiles(mapFromKey, mapSelectedKey);
    const st = placeStatus(mapSelectedKey);
    const note = st === 'next' ? ' - NEXT MISSION' : st === 'done' ? ' - already completed' : st === 'locked' ? ' - finish the current mission first' : st === 'here' ? ' - you are here' : '';
    const trekNote = isTrekLeg(mapSelectedKey) ? ' - TREK ON FOOT, no car: walk the busy street to the bridge' : '';
    routeEl.textContent = from.name + ' to ' + sel.name + ' - ' + miles + ' miles' + note + trekNote;
    if (isTrekLeg(mapSelectedKey)) {
      driveBtn.textContent = 'Trek to ' + sel.short + ' on foot ▸';
    } else {
      const car = getEquippedCarDef();
      driveBtn.textContent = 'Drive to ' + sel.short + ' in your ' + car.name + ' ▸';
    }
    const ok = placeDriveable(mapSelectedKey);
    driveBtn.disabled = !ok; driveBtn.style.opacity = ok ? '1' : '0.5';
  }
  if (skipBtn) {
    // No skip on a trek leg: the walk is the mission, it cannot be skipped.
    if (pendingMission && !isTrekLeg(pendingMission.key)) {
      skipBtn.style.display = '';
      skipBtn.textContent = 'Skip drive - go to ' + TRAVEL_PLACES[pendingMission.key].short + ' now';
    } else skipBtn.style.display = 'none';
  }
}
const LANDMARK_INFO = {
  zama: { title: 'Zama HQ - SoHo, Manhattan', body: 'The home of confidential computing. This is where the sealed choices in this game are encrypted - your Act I and Act III choices are locked on-chain with Zama FHE, and only you can reveal them. The NYC Court is right next door, one mile away.' },
  court: { title: 'NYC Court - Foley Square', body: 'This is where Act III takes you. The trial, the verdict, and the choice that decides the ending - right by Zama HQ, in the heart of lower Manhattan.' }
};
let landmarkEl = null;
function showLandmarkCard(key) {
  const info = LANDMARK_INFO[key] || { title: TRAVEL_PLACES[key].name, body: TRAVEL_PLACES[key].desc };
  if (!landmarkEl) {
    landmarkEl = document.createElement('div');
    landmarkEl.id = 'landmarkCard';
    landmarkEl.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(5,8,12,0.88);z-index:60;';
    document.body.appendChild(landmarkEl);
  }
  landmarkEl.innerHTML = '<div style="width:min(520px,92vw);background:#101820;border:1px solid #2a3540;border-radius:12px;padding:20px 22px;color:#e8eef2;font-family:Arial,sans-serif;">'
    + '<div style="font-size:20px;font-weight:bold;letter-spacing:1px;color:#ffd166;">' + info.title + '</div>'
    + '<div style="margin:12px 0 16px;font-size:15px;line-height:1.5;color:#c8d4dc;">' + info.body + '</div>'
    + '<button id="landmarkBackBtn" type="button" style="padding:12px 20px;font-size:15px;font-weight:bold;background:#ffd166;color:#111;border:none;border-radius:8px;cursor:pointer;">Back to map</button>'
    + '</div>';
  landmarkEl.style.display = 'flex';
  document.getElementById('landmarkBackBtn').onclick = () => {
    landmarkEl.style.display = 'none';
    // Back to the parked car first (or straight to the map after a
    // Skip, when there is no lot car).
    returnToParkedCar();
  };
}
// What happens when the drive arrives at a place.
function arriveAt(key) {
  const p = TRAVEL_PLACES[key];
  if (!p) return () => restoreMissionScene();
  if (p.landmark) {
    // Zama HQ and the NYC Court are landmarks on the live map: driving
    // there shows a card about the place, then back to the map. The
    // court is where Act III takes you; Zama HQ is where the sealed
    // choices in this game are encrypted. A drive arrival parks in front
    // of the landmark first; the card shows after he steps out of the
    // car. A Skip goes straight to the card, as before.
    return () => {
      currentPlaceKey = key; parkedPlaceKey = key;
      if (arrivedByDrive) { arrivedByDrive = false; showArrivalBeat(p.name, () => showLandmarkCard(key), key); }
      else showLandmarkCard(key);
    };
  }
  if (p.type === 'mission') {
    if (pendingMission && pendingMission.key === key) {
      const fn = pendingMission.fn; pendingMission = null;
      return () => { currentPlaceKey = key; parkedPlaceKey = key; fn(); };
    }
    if (missionsDone[p.mission]) {
      // Revisit a finished mission place: park in the mission's own
      // lot, step out beside the car and walk the yard. No briefing,
      // no objectives reset, no second payout - the mission stays
      // done (grantPayout is once-only anyway, and nothing here
      // re-arms an objective).
      return () => {
        currentPlaceKey = key; parkedPlaceKey = key;
        inValveRoom = false;
        restoreMissionScene();
        parkPlayerCar(p.mission);
        if (!seatIfDrove(p.mission, null)) applyDriveSpawn(p.mission);
        toast(p.name + ' - mission complete. Walk the yard; your car is in the lot.');
      };
    }
    return () => restoreMissionScene();
  }
  if (p.type === 'store') {
    // A drive arrival parks in front of the shop first; the store opens
    // after he steps out of the car. A Skip goes straight to the store.
    // Closing the store returns him to his parked car (or, with no lot
    // car after a Skip, straight to the map, as before).
    return () => {
      currentPlaceKey = key; parkedPlaceKey = key;
      if (arrivedByDrive) { arrivedByDrive = false; showArrivalBeat(p.name, () => openStore(p.tab, () => returnToParkedCar()), key); }
      else openStore(p.tab, () => returnToParkedCar());
    };
  }
  if (p.type === 'home' || p.type === 'visit') {
    // A drive arrival parks in front of the building first; the
    // interior loads after he steps out of the car. A Skip goes
    // straight inside, as before.
    return () => {
      currentPlaceKey = key; parkedPlaceKey = key;
      const go = () => { if (window.__lsActManager && typeof window.__lsActManager.enterHome === 'function') window.__lsActManager.enterHome(p.kind, 'map'); };
      if (arrivedByDrive) { arrivedByDrive = false; showArrivalBeat(p.name, go, key); }
      else go();
    };
  }
  return () => restoreMissionScene();
}
// A mission just ended: the next mission is the destination, but the map
// is the hub - the player can drive to a store, a home or a visit first,
// then come back to the map and drive to the mission.
function beginTravel(fromKey, toKey, onArrive) {
  pendingMission = { key: toKey, fn: onArrive };
  openCityMap(fromKey, toKey);
}
function closeCityMap() {
  if (travelMapEl) travelMapEl.style.display = 'none';
  // At the parked car (the return beat): closing the map while seated
  // steps him back out beside the car; closing it while standing
  // beside the car puts the mission scene back, as before.
  if (atParkedLot) {
    if (parkedSeatActive) { getOutOfParkedCar(); return; }
    atParkedLot = false;
    hideGetInButton();
    hideArrivalBeat();
  }
  restoreMissionScene();
}
function restoreMissionScene() {
  // Never restore over an active trek: the walk is the mission and
  // cannot be skipped, and restoring here hides the trek street and
  // its guide mid-walk (the disappearing arrow pill).
  if (trekActive) return;
  // The scene to show is the current PLACE's mission when the player
  // is standing at a mission place (a revisit to a finished mission
  // keeps its own yard up even though state.mission has moved on);
  // anywhere else it is the current mission's scene, as before.
  const place = TRAVEL_PLACES[currentPlaceKey];
  const sceneMission = (place && place.type === 'mission') ? place.mission : state.mission;
  mission1.visible = sceneMission === 1;
  mission2.visible = sceneMission === 2;
  mission3.visible = sceneMission === 3;
  if (travelGroup) travelGroup.visible = false;
  if (trekGroup) trekGroup.visible = false;
  trekActive = false;
  hideDriveHood();
  hideActionBanner();
  hideTrekGuide();
  // If the camera is far outside the mission (after a drive or a trek),
  // put it back at the mission's default view; otherwise leave it.
  const v = inValveRoom ? VALVE_ROOM_BOUNDS : VIEWS[sceneMission];
  camBounds = v;
  if (camera.position.x < v.x[0] || camera.position.x > v.x[1] || camera.position.z < v.z[0] || camera.position.z > v.z[1]) resetView();
}
// The car hood at the bottom of the screen during a drive: a trapezoid in
// the equipped car's colour, with the car name on it, so the player sees
// which car he is driving.
let driveHoodEl = null;
function showDriveHood() {
  const car = getEquippedCarDef();
  if (!driveHoodEl) {
    driveHoodEl = document.createElement('div');
    driveHoodEl.id = 'driveHood';
    driveHoodEl.innerHTML = '<div class="hood-shape"></div><div class="hood-label"></div>';
    document.body.appendChild(driveHoodEl);
  }
  driveHoodEl.querySelector('.hood-shape').style.background = car.color;
  driveHoodEl.querySelector('.hood-label').textContent = car.name;
  driveHoodEl.style.display = 'block';
}
function hideDriveHood() { if (driveHoodEl) driveHoodEl.style.display = 'none'; }
// Switch the driving camera between the chase view (third-person, see
// yourself driving) and the in-car view (from the driver's seat, the
// steering wheel in front of you). The hood overlay only shows in the
// chase view; in-car you see the real hood.
function toggleDriveView() {
  driveView = driveView === 'chase' ? 'incar' : 'chase';
  const b = document.getElementById('driveViewBtn');
  if (b) b.textContent = driveView === 'chase' ? 'View: 3rd person (C)' : 'View: In-car (C)';
  if (driveView === 'incar') hideDriveHood(); else if (travelActive) showDriveHood();
}
// On-screen drive controls: GAS and BRAKE pedals (hold), a View button
// and a Skip button. The pedals sit bottom-right, clear of the W/A/S/D
// pad on the left and the camera buttons.
function showDriveControls() {
  if (!driveControlsEl) {
    driveControlsEl = document.createElement('div');
    driveControlsEl.id = 'driveControls';
    driveControlsEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:55;';
    driveControlsEl.innerHTML =
      '<button id="driveGasBtn" type="button" style="position:absolute;right:18px;bottom:170px;width:96px;height:96px;border-radius:50%;background:#2e7a4a;color:#fff;font-size:15px;font-weight:bold;border:3px solid #4a9a6a;pointer-events:auto;touch-action:none;">GAS</button>'
      + '<button id="driveBrakeBtn" type="button" style="position:absolute;right:132px;bottom:180px;width:80px;height:80px;border-radius:50%;background:#8a2a2a;color:#fff;font-size:14px;font-weight:bold;border:3px solid #b04a4a;pointer-events:auto;touch-action:none;">BRAKE</button>'
      + '<button id="driveViewBtn" type="button" style="position:absolute;right:18px;top:120px;padding:10px 14px;font-size:14px;font-weight:bold;background:#22303a;color:#e8eef2;border:1px solid #3a4a58;border-radius:8px;pointer-events:auto;">View: 3rd person (C)</button>'
      + '<button id="driveSkipBtn" type="button" style="position:absolute;right:18px;top:64px;padding:10px 14px;font-size:14px;background:#22303a;color:#e8eef2;border:1px solid #3a4a58;border-radius:8px;pointer-events:auto;">Skip drive</button>';
    document.body.appendChild(driveControlsEl);
    const hold = (el, on, off) => {
      el.addEventListener('pointerdown', (ev) => { ev.preventDefault(); on(); });
      el.addEventListener('pointerup', () => off());
      el.addEventListener('pointerleave', () => off());
      el.addEventListener('pointercancel', () => off());
    };
    hold(document.getElementById('driveGasBtn'), () => { drivePedalGas = true; }, () => { drivePedalGas = false; });
    hold(document.getElementById('driveBrakeBtn'), () => { drivePedalBrake = true; }, () => { drivePedalBrake = false; });
    document.getElementById('driveViewBtn').onclick = () => toggleDriveView();
    document.getElementById('driveSkipBtn').onclick = () => { if (travelActive) endTravelDrive(); };
  }
  driveControlsEl.style.display = 'block';
  const vb = document.getElementById('driveViewBtn');
  if (vb) vb.textContent = 'View: 3rd person (C)';
}
function hideDriveControls() {
  if (driveControlsEl) driveControlsEl.style.display = 'none';
  drivePedalGas = false; drivePedalBrake = false;
}

// The drive itself: hide the missions, show the road, and drive the
// camera forward through the city in the player's own car. The banner
// names the car and counts the miles down. The drive takes longer for a
// far place, so the distance feels real. Any key or click skips to arrival.
// The car waiting in the current mission's lot, when the player is
// standing in that mission's scene and the car is parked there: the
// drive he is about to take leaves from that car. Null when he is
// already seated in a parked car, standing at the arrival lot, or
// anywhere the mission lot car is not (the drive then starts the
// usual way). At the water facility his own car (beside the rental)
// is the one he drives away in.
function departureLotCar() {
  if (parkedSeatActive || atParkedLot) return null;
  // The lot is the current place's mission lot when standing at a
  // mission place (a revisit parks there too), else the current
  // mission's lot.
  const place = TRAVEL_PLACES[currentPlaceKey];
  const m = (place && place.type === 'mission') ? place.mission : state.mission;
  const group = m === 1 ? mission1 : m === 2 ? mission2 : mission3;
  if (!group || !group.visible) return null;
  if (parkedPlaceKey !== MISSION_PLACE[m]) return null;
  if (m === 1 && rentalExtraCar) return rentalExtraCar;
  return parkedCars[m] || null;
}
function startTravelDrive(toKey, onArrive) {
  if (travelActive) return;
  // A drive can never legitimately start mid-trek (the map stays
  // closed during the walk), but clear the trek state defensively
  // so no stray path can leave the trek street or guide orphaned.
  if (trekActive) {
    trekActive = false;
    if (trekGroup) trekGroup.visible = false;
    trekOnArrive = null; trekToKey = null;
    hideTrekGuide();
  }
  const to = TRAVEL_PLACES[toKey];
  // Leaving from a parked seat (the departure beat seated him in the
  // lot car, or he got in at the arrival lot): clear the seat state
  // and the arrival lot before the drive takes over. The drive car
  // build below reparents the avatar out of the parked car.
  if (parkedSeatActive) { parkedSeatActive = false; parkedSeat = null; hideGetOutButton(); }
  if (arrivalGroup) arrivalGroup.visible = false;
  atParkedLot = false;
  hideGetInButton();
  buildTravelScene();
  // Dress the road for the destination's part of New York.
  applyDriveArea(toKey);
  mission1.visible = false; mission2.visible = false; mission3.visible = false;
  travelGroup.visible = true;
  // Warm up the destination's shader programs now, while the drive
  // transition covers it: the first real render of a mission scene
  // otherwise compiles dozens of programs in one frame, which on a
  // slow or software renderer stalls the arrival for a long time
  // (the canvas keeps showing the drive street while the game state
  // has already arrived). Compiling here, with only the destination
  // group shown, matches the light state the arrival frame renders.
  try {
    const destGroup = to && to.mission === 1 ? mission1 : to && to.mission === 2 ? mission2 : to && to.mission === 3 ? mission3 : null;
    if (destGroup && typeof renderer.compile === 'function') {
      travelGroup.visible = false;
      destGroup.visible = true;
      // compile() only initialises programs for objects inside the
      // camera frustum, and the camera is wherever the last scene
      // left it (inside the valve room, facing away from the
      // substation yard) - so the old warm-up compiled almost
      // nothing of the destination and the first real frame still
      // paid for every program. Point the camera at the whole
      // destination group for the compile, then put it back.
      const savedPos = camera.position.clone();
      const savedQuat = camera.quaternion.clone();
      camera.position.set(0, 10, 28);
      camera.lookAt(0, 1, 0);
      camera.updateMatrixWorld(true);
      renderer.compile(scene, camera);
      camera.position.copy(savedPos);
      camera.quaternion.copy(savedQuat);
      camera.updateMatrixWorld(true);
      destGroup.visible = false;
      travelGroup.visible = true;
    }
  } catch (e) { /* warm-up is best effort */ }
  travelActive = true; window.__lsTravelActive = true;
  // Driving away means he has left the valve room: clear the flag so it
  // cannot leak into the next scene. Mission 1 ends with the device
  // click INSIDE the valve room, and the travel starts from there; with
  // the flag still set, resetView at the next mission kept the valve
  // room bounds and the get-out clamped the player into that tiny box
  // at the substation control room (Mission 2 arrival trap).
  inValveRoom = false;
  travelT = 0; travelOnArrive = onArrive; travelToKey = toKey;
  travelMiles = getMiles(mapFromKey, toKey);
  // A same-place leg (the rental hop from the Rondout platform to the
  // water facility, reservoir to reservoir) is a real short drive, not a
  // zero drive: 0 miles made the banner read "0 miles to go" from the
  // start and hid the countdown, so give it a short real distance.
  if (travelMiles <= 0) travelMiles = 8;
  travelStartWall = Date.now();
  travelLastMilesShown = -1;
  travelFuelCounted = 0;
  // An empty tank never blocks a drive: the car still drives, the gauge
  // sits empty, and the game prompts to refuel at a Filling Station.
  if (!travelRental && getFuel() <= 0) toast('Fuel empty - the car still drives, but stop at a Filling Station to refuel for 0.5 ZAMA.');
  // The drive takes longer for a far place, so the distance feels real:
  // the 85-mile Reservoir to Substation leg is 60 seconds at full speed.
  travelDur = Math.min(60, Math.max(12, Math.round(travelMiles / 85 * 60)));
  // Watchdog: the drive must finish even if the frame loop is throttled
  // or paused (a background tab stops requestAnimationFrame, which froze
  // the rental drive live - the banner stuck, nothing moved, Skip still
  // worked because it is a button, not a frame). The interval fires even
  // when rAF is paused, so the drive ends on schedule either way.
  try { if (travelWatchdog) clearInterval(travelWatchdog); } catch (e) { /* ignore */ }
  travelWatchdog = setInterval(() => {
    try {
      if (travelActive && Date.now() - travelStartWall >= travelDur * 1000) endTravelDrive();
    } catch (e) { /* the watchdog must never throw */ }
  }, 500);
  // The drive matches the time of the mission being driven to.
  if (to.type === 'mission') setTimeOfDay(MISSION_TIME[to.mission]);
  // The player's own car, in the equipped colour, with the driver (the
  // player avatar) seated inside. The car faces -z (the driving
  // direction), so it is rotated PI from the builder's +z front. The
  // old drive car is disposed first, so a car bought since the last
  // drive shows up and no stale car stays in the scene.
  try {
    if (driveCar) {
      try { travelGroup.remove(driveCar); } catch (e) { /* ignore */ }
      try {
        driveCar.traverse(m => {
          try { if (m.geometry) m.geometry.dispose(); } catch (e) { /* ignore */ }
          try {
            const mats = Array.isArray(m.material) ? m.material : (m.material ? [m.material] : []);
            for (const mm of mats) { try { mm.dispose(); } catch (e) { /* ignore */ } }
          } catch (e) { /* ignore */ }
        });
      } catch (e) { /* ignore */ }
      driveCar = null;
    }
    // The rental drive uses the plain rental sedan, not his own car.
    driveCar = travelRental ? buildRentalCar() : buildPlayerCar();
    driveCar.rotation.y = Math.PI;
    driveCar.position.set(0, 0, 4);
    travelGroup.add(driveCar);
    const driver = getAvatar();
    try { if (driver.parent) driver.parent.remove(driver); } catch (e) { /* ignore */ }
    setAvatarPose('sit');
    driver.visible = true;
    // Driver's seat, left side, sitting in the cabin. The driver is
    // scaled to 0.62, not 0.72: at 0.72 his head sat at about 1.28 m,
    // right at the cabin roof, so from the chase camera he read as
    // sitting ON TOP of the car. At 0.62 his head is at about 1.10 m,
    // the same height as the in-car camera (headPos), well under the
    // roof, so he reads as sitting INSIDE the cabin, seen through the
    // glass. His feet stay at y 0.02 on the car floor, so nothing
    // clips below the car. He faces the car's forward (+z local).
    driver.position.set(-0.38, 0.02, 0.35);
    driver.rotation.set(0, 0, 0);
    driver.scale.set(0.62, 0.62, 0.62);
    driveCar.add(driver);
  } catch (e) { driveCar = null; }
  camera.position.set(0, 1.7, 4);
  state.yaw = 0; state.pitch = 0;
  showDriveHood();
  // The hood shows the equipped car name; the rental drive says so.
  if (travelRental) { const hl = driveHoodEl && driveHoodEl.querySelector('.hood-label'); if (hl) hl.textContent = 'Rental car'; }
  updateDriveBanner();
  // Drive controls: no more "any key skips" - the drive is driven now.
  // W or D is gas, S is brake, C switches the camera view, Escape (or
  // the Skip button) arrives at once. The on-screen GAS and BRAKE pedals
  // do the same on touch.
  driveSpeed = DRIVE_CREEP_SPEED; driveView = 'chase';
  driveKeys.w = driveKeys.a = driveKeys.s = driveKeys.d = false;
  // Pedals too: a pedal press whose release was lost (pointer capture
  // dropped, focus change) would brake the car to a standstill for
  // the whole drive while the miles counted down by the clock.
  drivePedalGas = false; drivePedalBrake = false;
  driveKeyHandler = (e) => {
    if (!travelActive) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'escape') { endTravelDrive(); return; }
    if (k === 'c') { toggleDriveView(); return; }
    if (k === 'w' || k === 'a' || k === 's' || k === 'd') driveKeys[k] = true;
  };
  driveKeyUpHandler = (e) => {
    const k = (e.key || '').toLowerCase();
    if (k === 'w' || k === 'a' || k === 's' || k === 'd') driveKeys[k] = false;
  };
  addEventListener('keydown', driveKeyHandler);
  addEventListener('keyup', driveKeyUpHandler);
  showDriveControls();
}
function updateDriveBanner() {
  const to = TRAVEL_PLACES[travelToKey];
  if (!to) return;
  const car = getEquippedCarDef();
  const left = Math.max(0, Math.round(travelMiles * (1 - travelT / travelDur)));
  if (left === travelLastMilesShown) return;
  travelLastMilesShown = left;
  if (travelRental) showActionBanner('Driving the rental car to the water facility - ' + left + ' miles to go. Hold W or D to drive, S to brake, C to switch view, Esc or Skip to arrive.');
  else showActionBanner('Driving your ' + car.name + ' to ' + to.name + ' - ' + left + ' miles to go. Hold W or D to drive, S to brake, C to switch view, Esc or Skip to arrive.');
}
function endTravelDrive() {
  if (!travelActive) return;
  travelActive = false; window.__lsTravelActive = false;
  try { if (travelWatchdog) clearInterval(travelWatchdog); } catch (e) { /* ignore */ }
  travelWatchdog = null;
  if (travelGroup) travelGroup.visible = false;
  hideDriveHood();
  hideActionBanner();
  hideDriveControls();
  if (driveKeyHandler) { try { removeEventListener('keydown', driveKeyHandler); } catch (e) { /* ignore */ } driveKeyHandler = null; }
  if (driveKeyUpHandler) { try { removeEventListener('keyup', driveKeyUpHandler); } catch (e) { /* ignore */ } driveKeyUpHandler = null; }
  driveView = 'chase'; driveSpeed = 0;
  // The driver (player avatar) gets out of the car: put him back on
  // his feet, at full size, and detach him from the car so the next
  // scene's presence hook can place him at the player position. The
  // car stays in travelGroup, which is hidden, so no car mesh is left
  // stuck to the camera after the drive.
  try {
    const driver = getAvatar();
    if (driveCar && driver && driver.parent === driveCar) {
      try { driveCar.remove(driver); } catch (e) { /* ignore */ }
    }
    setAvatarPose('stand');
    driver.scale.set(1, 1, 1);
    driver.rotation.set(0, 0, 0);
    driver.visible = false;
    detachAvatar();
  } catch (e) { /* ignore */ }
  // Third person after every drive, so the player sees himself at the
  // destination instead of arriving in first person with no avatar.
  try { setThirdPerson(true); } catch (e) { /* camera is best effort */ }
  if (travelToKey) currentPlaceKey = travelToKey;
  // Fuel: charge the miles not yet counted (a skipped drive or a
  // watchdog-ended drive still burns its miles). The rental car has its
  // own tank, so the rental drive burns none of his. An empty tank never
  // blocks the drive: the car already arrived, the gauge sits empty, and
  // the game prompts to refuel.
  if (!travelRental && travelMiles > 0) {
    const remaining = travelMiles - travelFuelCounted;
    if (remaining > 0) consumeFuelMiles(remaining);
    travelFuelCounted = 0;
    if (getFuel() <= 0) toast('Fuel empty - the car still drives, but stop at a Filling Station to refuel for 0.5 ZAMA.');
  }
  const cb = travelOnArrive; travelOnArrive = null; travelToKey = null;
  // The arrival that follows knows the player drove in, so a mission
  // start can stand him beside the parked car. The flag is consumed by
  // the mission start (applyDriveSpawn) and cleared here either way, so
  // a store, home or landmark arrival never leaves it set for later.
  arrivedByDrive = true;
  if (cb) cb();
  arrivedByDrive = false;
  travelRental = false;
}
function updateTravelDrive(dt, t) {
  if (!travelActive) return;
  // Drive progress follows the wall clock, not accumulated frame time:
  // when the tab is throttled the frame delta is clamped to 0.1 s, so
  // accumulating dt made the drive crawl (or never finish) while the
  // banner, the car, the traffic and the pedestrians all froze. The wall
  // clock keeps the 12 s rental drive at 12 s at any frame rate, and the
  // watchdog in startTravelDrive ends it even if no frame runs at all.
  travelT = Math.min(travelDur, (Date.now() - travelStartWall) / 1000);
  // Fuel: the player's own car burns fuel by the mile (a full tank
  // covers 500 miles, so the 85-mile leg uses 17%). The rental car has
  // its own tank, so the rental drive burns none of his. The gauge drops
  // as the miles pass; an empty tank never stops the car.
  if (!travelRental && travelMiles > 0 && travelDur > 0) {
    const covered = travelMiles * (travelT / travelDur);
    const delta = covered - travelFuelCounted;
    if (delta > 0) { consumeFuelMiles(delta); travelFuelCounted = covered; }
  }
  // The player drives: gas (W or D, or the GAS pedal) speeds the car up
  // toward 12 m/s, brake (S, or the BRAKE pedal) slows it to a stop, and
  // letting go settles back to a 3 m/s creep, so the drive always
  // finishes. The road is 720 m long and the longest drive is 60 s, so
  // at full speed the car reaches the end just as the drive ends.
  const gas = driveKeys['w'] || driveKeys['d'] || drivePedalGas;
  const brake = driveKeys['s'] || drivePedalBrake;
  if (gas) driveSpeed = Math.min(DRIVE_MAX_SPEED, driveSpeed + 6 * dt);
  else if (brake) driveSpeed = Math.max(0, driveSpeed - 10 * dt);
  else if (driveSpeed > DRIVE_CREEP_SPEED) driveSpeed = Math.max(DRIVE_CREEP_SPEED, driveSpeed - 4 * dt);
  else if (driveSpeed < DRIVE_CREEP_SPEED) driveSpeed = Math.min(DRIVE_CREEP_SPEED, driveSpeed + 4 * dt);
  const zoomDist = getZoom();
  if (driveCar) {
    driveCar.position.z = Math.max(-DRIVE_ROAD_LEN + 10, driveCar.position.z - driveSpeed * dt);
    if (driveView === 'incar' && driveCar.userData.headPos) {
      // In-car view: from the driver's seat, over the steering wheel,
      // looking down the road through the windscreen.
      const head = driveCar.localToWorld(driveCar.userData.headPos.clone());
      camera.position.set(head.x, head.y + Math.sin(t * 6) * 0.01, head.z);
      camera.lookAt(head.x, 1.0, head.z - 20);
    } else {
      // Chase view: behind and above the car, so the player sees himself
      // driving. The camera sits at the fixed 4 m distance.
      camera.position.set(0, 1.7 + zoomDist * 0.35 + Math.sin(t * 6) * 0.02, driveCar.position.z + zoomDist + 1.5);
      camera.lookAt(0, 1.0, driveCar.position.z - 8);
    }
  } else {
    camera.position.z -= driveSpeed * dt;
    camera.position.x = 0;
    camera.position.y = 1.7 + Math.sin(t * 6) * 0.02;
    camera.rotation.order = 'YXZ';
    camera.rotation.y = 0; camera.rotation.x = 0; camera.rotation.z = 0;
  }
  // Traffic moves: oncoming cars rush toward the camera, cars ahead
  // crawl forward. Wrap them so the street never empties. Pedestrians
  // walk the sidewalks in both directions as the car drives past.
  for (const c of travelCars) {
    c.group.position.z += c.speed * dt;
    if (c.group.position.z > 10) c.group.position.z = -710;
    if (c.group.position.z < -720) c.group.position.z = 0;
  }
  for (const p of travelPedestrians) updatePedestrian(p, dt);
  updateDriveBanner();
  if (travelT >= travelDur) endTravelDrive();
}

// ---------- Trekking (on foot) ----------
// A walkable busy street: the green tiled MAIN ST, sidewalks with shops
// and awnings, trees, parked cars, a traffic jam, and pedestrians
// walking in both directions. The player starts at the south end (z = 30)
// and walks to the gold marker at the north end (z = -45), where the
// bridge approach begins. About 75 metres, a real walk, not a skip.
function buildTrekStreet() {
  if (trekGroup) return trekGroup;
  trekGroup = new THREE.Group();
  trekGroup.visible = false;
  scene.add(trekGroup);
  // The street cars are solid (the solid-world rule), so each car that
  // actually spawns registers a box here. Parked spawn is random, so
  // the boxes follow the real cars, and the layout always leaves a
  // passable gap (see the parked/jam loops below).
  trekColliders = [];
  const roadTex = hexTileTexture();
  roadTex.repeat.set(2, 18);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 85), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0.02, -7.5); road.receiveShadow = true; trekGroup.add(road);
  // Sidewalks on both sides.
  for (const x of [-6.5, 6.5]) {
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(4, 85), stdMat({ color: 0x8a8a86, roughness: 1 }));
    walk.rotation.x = -Math.PI / 2; walk.position.set(x, 0.03, -7.5); walk.receiveShadow = true; trekGroup.add(walk);
  }
  // Green bike lanes, MAIN ST, and a crosswalk, like the city street.
  const bikeTex = bikeSymbolTexture();
  for (const x of [-3.6, 3.6]) {
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 85), stdMat({ color: 0x2e7a4a, roughness: 0.95 }));
    lane.rotation.x = -Math.PI / 2; lane.position.set(x, 0.04, -7.5); trekGroup.add(lane);
  }
  for (const x of [-3.6, 3.6]) for (const z of [-30, 10]) {
    const sym = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: bikeTex, transparent: true, opacity: 0.85, depthWrite: false }));
    sym.rotation.x = -Math.PI / 2; sym.rotation.z = Math.PI / 2; sym.position.set(x, 0.05, z); trekGroup.add(sym);
  }
  const mainTex = mainStTexture();
  const t = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: mainTex, transparent: true, opacity: 0.9, depthWrite: false }));
  t.rotation.x = -Math.PI / 2; t.rotation.z = Math.PI / 2; t.position.set(0, 0.05, 0); trekGroup.add(t);
  for (let i = 0; i < 6; i++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 8.4), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }));
    stripe.rotation.x = -Math.PI / 2; stripe.position.set(-2.9 + i * 1.15, 0.05, -20); trekGroup.add(stripe);
  }
  for (let z = 28; z >= -48; z -= 8) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 3), new THREE.MeshBasicMaterial({ color: 0xd8b13a }));
    dash.rotation.x = -Math.PI / 2; dash.position.set(0, 0.04, z); trekGroup.add(dash);
  }
  // Shops and towers on both sides: low shopfronts with awnings in
  // front, taller varied skyscrapers behind them, so the walked street
  // reads as New York, not one white box repeated. Nothing is placed on
  // the road or the sidewalks (the player walks x -4.2 to 4.2, the
  // BRIDGE marker is at the far end, z -47).
  const shopNames = ['CAFE', 'DELI', 'BAKERY', 'PHARMACY', 'FLOWERS', 'BOOKS', 'PIZZA', 'MARKET'];
  const awnCols = [0xc0392b, 0x2e6fb0, 0x2e7a4a, 0xc07a1a, 0x7a2e5a, 0x3a3a3a, 0xd8b13a, 0x2e6a7a];
  const trekPalette = skyFacadePalette(0.85, false);
  let si = 0;
  for (let z = 22; z >= -44; z -= 11) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.2) continue;
      if (Math.random() < 0.6) {
        // Low shopfront with an awning, varied height and front.
        const sh = 4 + Math.random() * 2;
        const shopMat = trekPalette[Math.floor(Math.random() * trekPalette.length)];
        const shop = new THREE.Mesh(new THREE.BoxGeometry(5, sh, 6), shopMat);
        shop.position.set(side * 11, sh / 2, z); shop.castShadow = true; trekGroup.add(shop);
        const awn = makeShopAwning(awnCols[si % awnCols.length], shopNames[si % shopNames.length]);
        awn.position.set(side * 8.2, 0, z);
        awn.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        trekGroup.add(awn);
        si++;
      } else {
        // A taller tower behind the shopfront line.
        const pick = pickSkyscraper(trekPalette, 10);
        pick.group.position.set(side * (10 + pick.w / 2 + Math.random() * 3), 0, z + (Math.random() * 4 - 2));
        trekGroup.add(pick.group);
      }
    }
  }
  // Parked cars along both curbs, and trees on the sidewalks. Each
  // parked car is solid: rotated +-PI/2, the sedan (len 4.4, wid 1.85)
  // spans x +-2.2 around +-3.9 and z +-0.925 around its slot, shrunk
  // 0.1 a side so a shoulder can brush the paint. Even with a car on
  // both curbs the middle of the road stays open.
  const parkCols = [0xc0392b, 0x2e6fb0, 0xd8d8d8, 0x3a3a3a, 0xc07a1a, 0x5a7a3a];
  for (let z = 16; z >= -40; z -= 14) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.35) continue;
      const pc = makeStreetCar(parkCols[Math.floor(Math.random() * parkCols.length)]);
      pc.position.set(side * 3.9, 0, z);
      pc.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      trekGroup.add(pc);
      addBoxCollider(trekColliders, side * 3.9 - 2.1, z - 0.825, side * 3.9 + 2.1, z + 0.825);
    }
    if (Math.random() < 0.7) {
      const tree = makeStreetTree();
      tree.position.set((Math.random() < 0.5 ? -1 : 1) * 6.5, 0, z + 5); trekGroup.add(tree);
    }
  }
  // Street lights along the trek: real cobra-head lamps on the
  // sidewalks, alternating sides, so the walked street is lit at night
  // like a real street. The trek is night, so the lamps are on here.
  for (const [lx, lz, lry] of [[5.2, 24, -Math.PI / 2], [-5.2, 8, Math.PI / 2], [5.2, -8, -Math.PI / 2], [-5.2, -24, Math.PI / 2], [5.2, -40, -Math.PI / 2]]) {
    const lamp = makeStreetLight(lry, 0.08);
    lamp.group.position.set(lx, 0, lz); trekGroup.add(lamp.group);
  }
  // The traffic hold-up, here too: a line of cars stopped bumper to
  // bumper in the east lane, horns sounding, blocking the road. The
  // jam is solid as one long block (unrotated sedans at x -2: x span
  // -2.925..-1.075, z span +-2.2 each, shrunk 0.1 a side). Worst case,
  // a left-curb parked car beside the jam still leaves the free gap
  // x -1.175..1.8 (2.975 m, 2.275 m after the player's radius), so
  // the player can always slip past on the west side.
  for (let i = 0; i < 5; i++) {
    const jc = makeStreetCar(parkCols[i % parkCols.length]);
    jc.position.set(-2, 0, -8 - i * 2.7);
    trekGroup.add(jc);
    addBoxCollider(trekColliders, -2.825, -8 - i * 2.7 - 2.1, -1.175, -8 - i * 2.7 + 2.1);
  }
  // Pedestrians on the sidewalks, walking in both directions, in pairs
  // and alone, like the plaza video. They are the crowd the player
  // treks through.
  const c1 = makeCrowd({ count: 7, lane: { axis: 'z', fixed: -6.5, min: -48, max: 32 } });
  const c2 = makeCrowd({ count: 7, lane: { axis: 'z', fixed: 6.5, min: -48, max: 32 } });
  for (const p of [...c1, ...c2]) { trekGroup.add(p.group); trekPedestrians.push(p); }
  // The destination: a pulsing gold marker and a bridge sign at the far end.
  const marker = makeActionMarker('BRIDGE', '#ffd166');
  if (marker) { marker.position.set(trekDestX, 2.2, trekDestZ); trekGroup.add(marker); }
  const sign = makeTextSprite('VERRAZZANO BRIDGE - 1 MILE', '#ffd166');
  sign.scale.set(7, 1.4, 1); sign.position.set(0, 4.5, -47); trekGroup.add(sign);
  setTimeOfDay(currentTimeMode);
  return trekGroup;
}
// Start a trek: hide the missions, show the street, put the player at
// the south end on foot. No car, no skip - he walks to the gold marker.
function startTrek(toKey, onArrive) {
  const to = TRAVEL_PLACES[toKey];
  buildTrekStreet();
  mission1.visible = false; mission2.visible = false; mission3.visible = false;
  if (travelGroup) travelGroup.visible = false;
  trekGroup.visible = true;
  trekActive = true;
  trekOnArrive = onArrive; trekToKey = toKey;
  if (to && to.type === 'mission') setTimeOfDay(MISSION_TIME[to.mission]);
  camera.position.set(0, 1.7, 30);
  // Sync the stored ground position, or beginPlayerFrame snaps him
  // back to wherever he stood before the trek started.
  try { setPlayerPos(0, 30); } catch (e) { /* ignore */ }
  state.yaw = 0; state.pitch = 0;
  camBounds = { x: [-4.2, 4.2], z: [-48, 32] };
  showActionBanner('TREK ON FOOT - walk to the ' + (to ? to.name : 'destination') + '. No car - walk with the crowd. Reach the gold BRIDGE marker at the end of the street.');
  showTrekGuide();
  toast('Trek on foot - walk the busy street to the gold marker. No car for this leg.');
}
function endTrek() {
  if (!trekActive) return;
  trekActive = false;
  if (trekGroup) trekGroup.visible = false;
  hideActionBanner();
  hideTrekGuide();
  if (trekToKey) currentPlaceKey = trekToKey;
  const cb = trekOnArrive; trekOnArrive = null; trekToKey = null;
  if (cb) cb();
}
// The trek update (called from animate): pedestrians walk, the jam
// honks now and then, and reaching the gold marker ends the trek.
function updateTrek(dt, t) {
  if (!trekActive) return;
  for (const p of trekPedestrians) updatePedestrian(p, dt);
  hornTimer += dt;
  if (hornTimer > 9) { hornTimer = 0; honkHorn(); }
  // Measure from the player's ground position, not the camera: in
  // third person the camera rides ~4 m behind him, so a camera-based
  // check can read 4 m at the marker and never fire (the same class
  // as the round-8 valve proximity bug; playerDist2D falls back to
  // the camera only when no ground position is stored).
  if (playerDist2D(trekDestX, trekDestZ) < 3) {
    toast('You reach the bridge approach. The Verrazzano is ahead.');
    endTrek();
    return;
  }
  // Direction guide: point the HUD arrow at the bridge marker and
  // count down the metres. Forward is (-sin yaw, -cos yaw) (see
  // moveDelta in player.js), so the yaw that faces the target is
  // atan2(-dx, -dz); the guide takes the bearing relative to the
  // current facing, wrapped to [-PI, PI].
  const p = getPlayerPos();
  const px = p ? p.x : camera.position.x;
  const pz = p ? p.z : camera.position.z;
  const dx = trekDestX - px, dz = trekDestZ - pz;
  const dist = Math.hypot(dx, dz);
  const targetYaw = Math.atan2(-dx, -dz);
  let rel = targetYaw - state.yaw;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  updateTrekGuide(rel, dist);
}

function reparentCast(name, group, x, z, yaw) {
  const g = modelGroups[name] && modelGroups[name].group;
  if (!g) return;
  if (g.parent) g.parent.remove(g);
  g.position.set(x, 0, z); g.rotation.y = yaw;
  group.add(g);
}
// Fallback guards from the crowd rigs, built only if Caleb's model has
// not landed by Mission 2 (the guards normally clone Caleb in
// addCaleb). The crowd models load at import time on their own files,
// so the yard is never left guard-less by one slow fetch. If neither
// has landed, this does nothing and Caleb's background retries still
// deliver the guards when they land.
function buildFallbackGuards() {
  // The yard must never be short a guard: top the line up to two
  // with walking rigged guards (see ensureGuards).
  ensureGuards();
  // Last resort: if the crowd models never landed, stand Caleb scan
  // clones up so Mission 2 is never soft-locked guard-less. A scan
  // guard glides (no skeleton), but ensureGuards upgrades him to a
  // rigged guard as soon as the crowd arrives.
  for (const [gname, gx, gz] of [['guard1', -3.5, 2], ['guard2', 3.5, 2]]) {
    if (!guardPatrol.some(gp => gp.group && gp.group.name === gname)) buildOneGuard(gname, gx, gz, true);
  }
}
function startMission2() {
  mission1.visible = false; mission2.visible = true; mission3.visible = false;
  // The yard is the only scene that may show here: a stale travel, trek
  // or arrival-lot group left visible would paint its own street over
  // the yard, so hide them explicitly instead of trusting the drive
  // teardown alone.
  if (typeof travelGroup !== 'undefined' && travelGroup) travelGroup.visible = false;
  if (typeof trekGroup !== 'undefined' && trekGroup) trekGroup.visible = false;
  if (typeof arrivalGroup !== 'undefined' && arrivalGroup) arrivalGroup.visible = false;
  // A mission always starts outside the valve room: clear the flag so
  // resetView below uses this mission's bounds, not the valve room's.
  inValveRoom = false;
  state.mission = 2; resetView();
  // Mission 2 always starts with the guards on duty: whatever a
  // free-roam visit to the yard did before this mission began, the
  // line patrols and the key card stays hidden until the bluff.
  guardsDown = false;
  mission2BriefingDone = false;
  try { if (keycardMesh) keycardMesh.visible = false; } catch (e) { /* ignore */ }
  try { for (const m of guardMarkers) m.visible = true; } catch (e) { /* ignore */ }
  // The guards must exist by arrival: if Caleb's model is still in
  // flight, stand in crowd-rig guards so the yard is never empty.
  try { buildFallbackGuards(); } catch (e) { /* guards are best effort */ }
  // Third person on entering the mission, so the player sees himself.
  try { setThirdPerson(true); } catch (e) { /* camera is best effort */ }
  // The car pulls into the lot in the yard forecourt. On a drive
  // arrival he starts seated in the parked car and opens the door to
  // step out; any other entry just stands him beside it.
  parkPlayerCar(2);
  // Seating happens below, with the briefing as the get-out callback.
  setTimeOfDay('dusk'); // Mission 2 (substation) is dusk/evening.
  currentPlaceKey = 'substation';
  try { localStorage.setItem('lastSignalAct2Mission', '2'); } catch (e) { /* private mode */ }
  setAmbient('substation'); // electrical hum and whine inside the yard
  setTension(0.4);
  reparentCast('jade', mission2, -1.6, 5.5, Math.PI);
  reparentCast('caleb', mission2, 1.6, 5.5, Math.PI);
  setObjectives(OBJ2, 0); updateHUD();
  document.getElementById('timerLabel').textContent = 'Logic bomb - trips 8:00 PM';
  document.getElementById('timerVal').textContent = 'armed';
  document.getElementById('timerBar').style.width = '100%';
  // The reason for Mission 2: who called, what is wrong, what is at stake.
  // The briefing waits until the player is on foot: on a drive arrival he
  // starts seated in the parked car, and the "walk up to a guard" objective
  // must never fire while he is still sitting in it (movement and the
  // camera are locked while seated, so the scene looked frozen and the
  // player looked stuck in the car). The briefing runs as the get-out
  // callback; any other entry stands him beside the car and runs it at once.
  const startBriefing = () => {
    showBriefing({
      title: 'Mission 2 - The Grid',
      calledBy: 'Jade Morales and Con Edison - they called you in after the aqueduct.',
      problem: 'A logic bomb is sitting in the SCADA system at the Con Edison substation. The guards at the gate are private security, hired through a shell company - they do not know what they are protecting.',
      stakes: 'At 8 PM the bomb cascades: one substation trips, overloads the next, and takes down the Northeast grid. The whole city goes dark.'
    }, () => {
      showDialogue([
        { who: 'Jade Morales', text: 'Six PM. Con Edison substation, Long Island City. A logic bomb is sitting in the SCADA system. At eight it cascades - one substation trips, overloads the next, and takes down the Northeast grid.' },
        { who: 'Caleb Bishop', text: 'And the guards are not his people. Private security, hired through a shell company. They do not know what they are protecting.' },
        { who: 'Jade Morales', text: 'So we do not fight them. You walk up as a city inspector. I feed you the jargon through your earpiece. Click a guard to start.' }
      ], () => { mission2BriefingDone = true; toast('Walk up to a guard (or click one) - Caleb talks his way in.'); });
    });
  };
  if (!seatIfDrove(2, startBriefing)) { applyDriveSpawn(2); startBriefing(); }
}
// Hide the gold "!" markers over the guards once they stand down.
function hideGuardMarkers() { for (const m of guardMarkers) m.visible = false; }
// Face both guards at the player. The model-space forward differs by
// rig: the Caleb scan faces +Z (faceYaw 0 on its patrol entry), the
// Atlas crowd rigs face -Z (faceYaw PI). The atan2 yaw to the player
// plus the rig's own faceYaw points either rig at him. The target is
// the authoritative ground position (getPlayerPos), not the camera:
// the dialogue callback calls this between frames, when the camera
// still sits behind the avatar from the last render, and aiming at
// the camera turned the guards toward a point behind the player.
// One patrol step for both guards: walk the gate line in x around
// their post, face the walking direction, stride matched to the
// patrol speed so the feet slow at the turnarounds. Called from the
// main frame loop and from the seated-arrival branch (movement
// only there - the bluff trigger stays in the main loop).
function updateGuardPatrol(t, dt) {
  // Line integrity, every frame the yard is shown: the visible
  // figures must be exactly the patrol entries. A guard-named
  // group the patrol does not own (a build that threw after adding
  // its figure, an upgrade that swapped entries mid-flight) would
  // stand frozen at its post forever, so sweep it out; a patrol
  // group that lost its parent goes back in; a short line is
  // topped up. All cheap: the yard has a few dozen children.
  try {
    for (const child of [...mission2.children]) {
      if ((child.name === 'guard1' || child.name === 'guard2') && !guardPatrol.some(gp => gp.group === child)) mission2.remove(child);
    }
    for (const gp of guardPatrol) {
      if (gp.group && gp.group.parent !== mission2) mission2.add(gp.group);
      // Look heal, per frame: a guard built before his Atlas image
      // decoded kept the factory colours, and the heal used to run
      // only inside ensureGuards - if the image decoded after the
      // last ensureGuards call, the uniform never landed.
      if (gp.lookPending && atlasImageReady(gp.lookPending.model)) {
        try { applyLook(gp.group, gp.lookPending.model, gp.lookPending.look); } catch (e) { /* ignore */ }
        gp.lookPending = null;
      }
    }
    if (guardPatrol.length < 2) ensureGuards();
  } catch (e) { /* integrity is best effort; the patrol below still runs */ }
  // Stood down: the line holds its ground. The guards face the
  // player and idle where they stand (crossfade Walk -> Idle once),
  // but the integrity sweep and look heal above have already run -
  // they used to stop entirely at stand-down because the caller
  // gated this whole function on !guardsDown, so a guard whose
  // Atlas image decoded after the bluff kept his factory colours
  // (or an orphan figure stayed) for the rest of the mission.
  if (guardsDown) {
    faceGuardsAtPlayer();
    for (const gp of guardPatrol) {
      if (!gp.person) continue;
      if (!gp.idled && gp.walkAction && gp.idleAction) {
        gp.idled = true;
        try {
          gp.idleAction.reset();
          gp.idleAction.setEffectiveTimeScale(1);
          gp.idleAction.setEffectiveWeight(1);
          gp.idleAction.play();
          gp.walkAction.crossFadeTo(gp.idleAction, 0.4, false);
        } catch (e) { /* animation is best effort */ }
      }
      try { updateRiggedPerson(gp.person, dt); } catch (e) { /* animation is best effort */ }
    }
    return;
  }
  for (const gp of guardPatrol) {
    const phase = t * 0.45 + gp.phase;
    const w = Math.sin(phase);
    gp.group.position.x = gp.baseX + w * 1.8;
    // Pace by pace: the stride rate follows the actual patrol speed
    // (velocity = 1.8 * 0.45 * cos(phase) m/s), so the feet plant
    // with each step and slow to a stop at the turnarounds instead
    // of skating. The Walk clip at timeScale 1 covers about
    // 1.15 m/s, so timeScale is speed over 1.15.
    const speed = 1.8 * 0.45 * Math.cos(phase);
    // Turn smoothly at the ends of the line instead of snapping 180
    // degrees in one frame: step the yaw toward its target.
    const targetYaw = (speed >= 0 ? Math.PI / 2 : -Math.PI / 2) + (gp.faceYaw || 0);
    if (gp.yaw === undefined) gp.yaw = targetYaw;
    let dy = targetYaw - gp.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const maxStep = 3.2 * Math.max(0, dt || 0);
    gp.yaw += Math.max(-maxStep, Math.min(maxStep, dy));
    gp.group.rotation.set(0, gp.yaw, 0);
    // Rigged guards carry their own walk mixer.
    if (gp.person) {
      if (gp.walkAction) gp.walkAction.timeScale = Math.min(1.3, Math.abs(speed) / 1.15);
      try { updateRiggedPerson(gp.person, dt); } catch (e) { /* animation is best effort */ }
    }
  }
  for (const m of guardMarkers) {
    const s = 1.15 + Math.sin(t * 4) * 0.18;
    m.scale.set(s, s, 1);
    m.material.opacity = 0.85 + Math.sin(t * 4) * 0.15;
  }
}
function faceGuardsAtPlayer() {
  const pp = getPlayerPos();
  const tx = pp ? pp.x : camera.position.x;
  const tz = pp ? pp.z : camera.position.z;
  for (const gp of guardPatrol) {
    const dx = tx - gp.group.position.x;
    const dz = tz - gp.group.position.z;
    // Full rotation set, not .y alone: a cloned guard group's Euler
    // can sit in the gimbal-flipped form (-PI, 0, -PI), where a .y
    // write produces an effective yaw of PI - yaw and the guard
    // faces exactly away from the player (see placeHuman).
    if (dx * dx + dz * dz > 0.04) gp.group.rotation.set(0, Math.atan2(dx, dz) + (gp.faceYaw || 0), 0);
  }
}
function guardDialogue() {
  if (guardsDown) { toast('The guards have stood down. The SCADA terminal is yours.'); return; }
  // The bluff belongs to Mission 2: the yard can be visited during
  // Mission 1 (a map drive shows it through restoreMissionScene),
  // and a guard click there must not stand the line down early -
  // guardsDown is never reset, so an early stand-down left both
  // guards frozen at their posts for the whole of Mission 2.
  if (state.mission !== 2) { toast('Private security. They watch the gate and say nothing.'); return; }
  // The bluff is an on-foot conversation: a guard click while the
  // player is still seated in the parked car (or while another
  // dialogue is already up) must not start it. The seated click
  // used to fire the whole bluff before the briefing, standing
  // the line down before the player ever saw it patrol - the live
  // check then found both guards frozen at their posts for the
  // rest of the mission. The walk-up trigger already waits for
  // the player to be on foot with no dialogue up; clicks now do
  // the same.
  if (parkedSeatActive) { toast('Get out of the car first - the guards are watching the gate.'); return; }
  if (!document.getElementById('dialogue').classList.contains('hidden')) return;
  // The bluff is the briefing's next step: a guard click during the
  // briefing card (dialogue not up yet) must not jump the queue and
  // stand the line down before the player knows why he is here.
  if (!mission2BriefingDone) { toast('Start the briefing first - then walk up to a guard.'); return; }
  if (state.trust >= 6) {
    showDialogue([
      { who: 'Caleb Bishop', text: 'Afternoon, gentlemen. City inspector. We have a work order on feeder line B - harmonic distortion on the bus. I need five minutes at the terminal.' },
      { who: 'Jade (earpiece)', text: 'Say it again, slower. Harmonic distortion. Bus differential. They are nodding. Keep going.' },
      { who: 'Guard 1', text: '...We were told it was a routine contract. Just watch the door, they said.' },
      { who: 'Caleb Bishop', text: 'I believe you. But you were protecting something that was going to hurt people. Help us, and you are part of the fix.' },
      { who: 'Guard 1', text: 'What do you need?' },
      { who: 'Caleb Bishop', text: 'Names. Numbers. Who hired you. And the key card - the terminal needs it.' }
    ], () => {
      guardsDown = true; hideGuardMarkers(); keycardMesh.visible = true; if (window._keycardHit) window._keycardHit.visible = true; trust(1, 'Caleb talked them down');
      // The guards turn to face the player they just stood down for,
      // so the white key card on guard 1's front belt is in plain
      // sight (he patrolled facing sideways, card hidden behind his
      // arm - the live check could not find it on either belt). The
      // per-frame block keeps them facing him after this. The line
      // is topped up and swept first, so exactly the two patrol
      // figures stand in the yard at the stand-down moment.
      try { ensureGuards(); } catch (e) { /* guards are best effort */ }
      faceGuardsAtPlayer();
      // The guard hands over the substation gate key with the key card.
      giveKey('substation', 'substation key');
      state.inventory.push('Substation key'); updateHUD();
      setObjectives(OBJ2, 1);
      toast('The guards stood down. Guard 1 handed you the substation key. Click the white key card on the guard\u2019s belt, then the red log book on the desk.');
    });
  } else {
    showDialogue([
      { who: 'Caleb Bishop', text: 'City inspector - I need to see the terminal.' },
      { who: 'Guard 1', text: 'Credentials? Work order number? You do not sound like an inspector.' },
      { who: 'Jade Morales', text: 'He is not ready for this. Plan B - I slip in through the side gate while they are watching him. It is slower, and it costs us goodwill.' }
    ], () => {
      guardsDown = true; hideGuardMarkers(); keycardMesh.visible = true; if (window._keycardHit) window._keycardHit.visible = true; trust(-1, 'the bluff failed'); integrity('Power', -5);
      // Same turn-to-face as the bluff-success path: the key card on
      // guard 1's front belt must be visible either way. The line is
      // topped up and swept first, same as the success path.
      try { ensureGuards(); } catch (e) { /* guards are best effort */ }
      faceGuardsAtPlayer();
      // Jade slipped in and took the substation gate key from the guard
      // post on her way through, so the player has it either way.
      giveKey('substation', 'substation key');
      state.inventory.push('Substation key'); updateHUD();
      setObjectives(OBJ2, 1);
      toast('Jade slipped in through the side gate and left you the substation key. Click the white key card, then the red log book.');
    });
  }
}
function renderScada() {
  for (const f of ['A', 'B', 'C']) {
    document.getElementById('feed' + f).style.width = feeders[f] + '%';
    document.getElementById('feed' + f + 'Val').textContent = feeders[f];
  }
  const total = feeders.A + feeders.B + feeders.C;
  const ok = total === 100 && feeders.A <= 60 && feeders.B <= 60 && feeders.C <= 60;
  document.getElementById('scadaStatus').textContent = ok
    ? 'Load balanced - total 100, no feeder over 60. Disarm it.'
    : 'Total ' + total + ' (need 100), no feeder over 60. Bomb: ' + bombTime + 's.';
  document.getElementById('bombVal').textContent = bombTime;
}
function openScadaModal() {
  if (!hasKeycard) { toast('The SCADA terminal needs the key card first - it is on the guard\u2019s belt.'); return; }
  if (!hasPassphrase) { toast('Two-factor: the terminal also needs a passphrase. It is in the maintenance log - the red book on the desk.'); return; }
  // Every open starts from the same off-target load, like the bomb
  // timer restarting at 90: a half-finished reroute never carries
  // over, and the puzzle is never already solved on entry.
  feeders.A = FEEDER_START.A; feeders.B = FEEDER_START.B; feeders.C = FEEDER_START.C;
  bombTime = 90;
  scadaQteDone = false;
  document.getElementById('scadaModal').classList.remove('hidden');
  renderScada();
  setTension(0.7); // the countdown is tense: score rises, heartbeat starts
  if (bombInterval) clearInterval(bombInterval);
  bombInterval = setInterval(() => {
    bombTime--;
    renderScada();
    if (bombTime <= 10 && bombTime > 0) { try { sfxTick(); } catch (e) { /* ignore */ } } // final-seconds beeps
    document.getElementById('timerVal').textContent = bombTime + 's to cascade';
    document.getElementById('timerBar').style.width = (bombTime / 90 * 100) + '%';
    if (bombTime <= 0) {
      clearInterval(bombInterval); bombInterval = null;
      document.getElementById('scadaModal').classList.add('hidden');
      bombGoesOff();
    }
  }, 1000);
  // Surge quick-time, once per open: twenty seconds in, the load spikes.
  // A well-timed press steadies the feeders (+5 seconds); a miss just
  // continues the reroute - never a fail state, never blocks the puzzle.
  setTimeout(() => {
    try {
      if (scadaQteDone || !bombInterval) return;
      if (document.getElementById('scadaModal').classList.contains('hidden')) return;
      scadaQteDone = true;
      runQTE({
        label: 'SURGE SPIKE!',
        sub: 'The load is spiking - press SPACE or tap here now to steady the feeders.',
        key: ' ', windowMs: 2500,
        onHit: () => { bombTime = Math.min(90, bombTime + 5); renderScada(); toast('Steady hands - +5 seconds on the bomb.'); },
        onMiss: () => { toast('The surge passes - keep rerouting.'); }
      });
    } catch (e) { /* the QTE must never break the puzzle */ }
  }, 20000);
}
document.querySelectorAll('#scadaModal button[data-f]').forEach(b => {
  b.onclick = () => {
    const f = b.dataset.f, d = parseInt(b.dataset.d, 10);
    feeders[f] = Math.max(0, Math.min(100, feeders[f] + d));
    renderScada();
  };
});
document.getElementById('scadaSubmit').onclick = () => {
  const total = feeders.A + feeders.B + feeders.C;
  if (total === 100 && feeders.A <= 60 && feeders.B <= 60 && feeders.C <= 60) {
    clearInterval(bombInterval); bombInterval = null;
    document.getElementById('scadaModal').classList.add('hidden');
    document.getElementById('timerVal').textContent = 'disarmed';
    document.getElementById('timerBar').style.width = '0%';
    state.bombDisarmed = true; integrity('Power', 15);
    try { sfxPowerRestored(); setTension(0.3); } catch (e) { /* ignore */ }
    manifestoMesh.visible = true; if (window._manifestoHit) window._manifestoHit.visible = true; setObjectives(OBJ2, 3);
    showDialogue([
      { who: 'Jade Morales', text: 'Load rerouted. The bomb has nothing to cascade into. It is dead.' },
      { who: 'Caleb Bishop', text: 'You used your own words as the passphrase. "Trust the system, but verify the people." He has been reading your old reports.' },
      { who: 'Jade Morales', text: 'My ideas about transparency - twisted into sabotage. There is something pinned to the wall. Click it.' }
    ], () => toast('Click the white manifesto paper on the control-room wall.'));
  } else {
    document.getElementById('scadaStatus').textContent = 'Not balanced yet - total must be 100, no feeder over 60. Keep going.';
  }
};
document.getElementById('scadaClose').onclick = () => {
  if (bombInterval) { clearInterval(bombInterval); bombInterval = null; }
  document.getElementById('scadaModal').classList.add('hidden');
  try { setTension(0.4); } catch (e) { /* ignore */ }
  toast('The bomb is still counting down in the terminal. Open it again to finish the job.');
};
function bombGoesOff() {
  integrity('Power', -25); integrity('Comms', -10);
  try { sfxBoom(); setTension(0.8); } catch (e) { /* ignore */ }
  document.getElementById('timerVal').textContent = 'cascaded';
  document.getElementById('timerBar').style.width = '0%';
  manifestoMesh.visible = true; if (window._manifestoHit) window._manifestoHit.visible = true; setObjectives(OBJ2, 3);
  showDialogue([
    { who: 'System', text: '8:00 PM. The cascade trips. A partial blackout rolls across Queens - hospitals switch to generators, the streets go dark. The game goes on, but the city is darker, and the finale will be harder.' },
    { who: 'Jade Morales', text: 'We were too slow. We still finish this - and there is something pinned to the wall. Click it.' }
  ], () => toast('Click the white manifesto paper on the control-room wall.'));
}

// ---------- Mission 3: The Verrazzano (night) ----------
let chargeMeshes = [], derrickGlow;
function buildMission3() {
  scene.background = new THREE.Color(0x05070a);
  // Night sky + city glow far below.
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(200, 60), new THREE.MeshBasicMaterial({ color: 0x05070a }));
  sky.position.set(0, 20, -60); mission3.add(sky);
  for (let i = 0; i < 60; i++) {
    const star = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.15), new THREE.MeshBasicMaterial({ color: 0xdfeaff }));
    star.position.set((Math.random() - 0.5) * 120, 12 + Math.random() * 30, -50 - Math.random() * 20); mission3.add(star);
  }
  const cityGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xffc978, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  cityGlow.scale.set(80, 18, 1); cityGlow.position.set(0, -2, -40); mission3.add(cityGlow);
  // Bridge deck + railings + two towers.
  box(mission3, 4, 0.5, 34, 0x2a2f33, 0, -0.25, -2, null, { roughness: 0.9 });
  for (const sx of [-1.9, 1.9]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 34, 8), stdMat({ color: 0x6a747a, metalness: 0.8, roughness: 0.4 }));
    rail.rotation.x = Math.PI / 2; rail.position.set(sx, 1.1, -2); mission3.add(rail);
    for (let z = -18; z <= 14; z += 4) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 8), stdMat({ color: 0x6a747a, metalness: 0.8, roughness: 0.4 }));
      post.position.set(sx, 0.55, z); mission3.add(post);
    }
  }
  for (const tz of [-10, 6]) {
    box(mission3, 1.2, 14, 1.2, 0x3a4046, -1.6, 7, tz, null, { roughness: 0.8, metalness: 0.3 });
    box(mission3, 1.2, 14, 1.2, 0x3a4046, 1.6, 7, tz, null, { roughness: 0.8, metalness: 0.3 });
    box(mission3, 4.6, 1, 1.2, 0x3a4046, 0, 13.5, tz, null, { roughness: 0.8, metalness: 0.3 });
    // The tower legs are solid: their inner corners intrude 0.2 m into
    // the 2.4 m walkable deck, so the player would clip through them
    // without a collider. The gap between each pair of legs stays 2 m
    // wide, so the walk north and south stays open, and the catwalk
    // climb is click-driven (camera placement, not WASD), so the legs
    // can never strand the climb.
    addBoxCollider(mission3Colliders, -2.2, tz - 0.6, -1.0, tz + 0.6);
    addBoxCollider(mission3Colliders, 1.0, tz - 0.6, 2.2, tz + 0.6);
  }
  // Main cable: a catenary curve between the towers, as a tube.
  const cableCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.6, 13.5, -10), new THREE.Vector3(-1.6, 6, -2),
    new THREE.Vector3(-1.6, 4.5, 2), new THREE.Vector3(-1.6, 6, 6),
    new THREE.Vector3(-1.6, 13.5, 6)
  ]);
  const cable = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 40, 0.12, 8), stdMat({ color: 0x22262a, metalness: 0.7, roughness: 0.5 }));
  mission3.add(cable);
  // Maintenance catwalk along the right side, with a GAP cut out (z -5 to -2).
  for (let z = 12; z >= -14; z -= 1.2) {
    if (z <= -2 && z >= -5) continue; // the gap: a section cut away, ten feet across
    const plank = box(mission3, 0.9, 0.06, 1.1, 0x5a4632, 1.2, 0.6, z, z === 12 ? 'catwalk' : null, { roughness: 1 });
    if (z !== 12) plank.userData.clickable = true, plank.name = 'catwalk';
  }
  const gapSign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('GAP - 10 FT', '#111111', '#ffd166', ''), transparent: true, depthWrite: false }));
  gapSign.scale.set(2.4, 0.6, 1); gapSign.position.set(1.2, 1.6, -3.5); mission3.add(gapSign);
  // Four shaped charges on the cables, red and blinking.
  for (const cz of [-8, -4, 0, 4]) {
    const ch = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.35), new THREE.MeshStandardMaterial({ color: 0x3a0a0a, emissive: 0xff2222, emissiveIntensity: 1.6, roughness: 0.4 }));
    ch.position.set(-1.6, 5.2, cz); ch.name = 'charge'; ch.userData.clickable = true; mission3.add(ch); chargeMeshes.push(ch);
    const chHit = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    chHit.position.set(-1.6, 5.2, cz); chHit.name = 'charge'; chHit.userData.clickable = true; mission3.add(chHit); chargeMeshes.push(chHit);
  }
  // Thin invisible click slab just above the catwalk planks, so clicking the
  // walkway anywhere advances the climb. (The planks were never in the
  // Mission 3 raycast targets, so 45 clicks on them did nothing.) The slab
  // sits low (y 0.55-0.75) so it does not block clicks on the characters.
  const catHit = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.2, 26), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  catHit.position.set(1.2, 0.65, -1); catHit.name = 'catwalk'; catHit.userData.clickable = true; mission3.add(catHit);
  window._catwalkHit = catHit;
  window._catwalkPlanks = [];
  mission3.traverse(o => { if (o.name === 'catwalk' && o !== catHit) window._catwalkPlanks.push(o); });
  // Derrick's detonator, on the deck beside him (small dark box, red button).
  const det = box(mission3, 0.25, 0.12, 0.18, 0x1a1a1a, 0.5, 0.06, -6.5, 'detonator', { roughness: 0.4 });
  det.visible = false; window._detonator = det;
  blobShadow(mission3, 0, -6, 0.9, 0.9, 0.55);
  blobShadow(mission3, 1.2, 4, 0.9, 0.9, 0.55);
  // Deck-chase obstacles: cable spools that roll back and forth across the
  // deck while the player runs to the catwalk. Hidden until the chase starts.
  for (const [lane, phase, speed] of [[-6, 0, 0.7], [-2, 1.4, 0.9], [2, 2.6, 0.8], [6, 3.8, 1.0], [10, 5.0, 0.75]]) {
    const spool = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 0.5, 14),
      new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9, metalness: 0.1 })
    );
    spool.rotation.x = Math.PI / 2; // axle along z, so it rolls in x
    spool.position.set(0, 0.35, lane);
    spool.castShadow = true;
    spool.visible = false;
    mission3.add(spool);
    chaseSpools.push({ mesh: spool, z: lane, phase, speed });
  }
  // Parking lot by a small garden beside the bridge approach, east of
  // the deck: the player's car has a marked space at the bridge. The P
  // sign faces west, at the player standing on the deck.
  buildParkingLot(mission3, PARKING[3].cx, PARKING[3].cz, PARKING[3].carX, -Math.PI / 2);
  buildBridgeGarden(mission3);
  // The area sign names this part of New York on arrival.
  const m3Sign = makeTextSprite('VERRAZZANO-NARROWS BRIDGE', '#ffd166');
  m3Sign.name = 'areaSign'; m3Sign.userData.areaName = 'VERRAZZANO-NARROWS BRIDGE';
  m3Sign.scale.set(7, 1.6, 1); m3Sign.position.set(0, 3.4, 8); mission3.add(m3Sign);
}
function startMission3() {
  mission1.visible = false; mission2.visible = false; mission3.visible = true;
  // A mission always starts outside the valve room: clear the flag so
  // resetView below uses this mission's bounds, not the valve room's.
  inValveRoom = false;
  state.mission = 3; state.climbStep = 0; resetView();
  // Third person on entering the mission, so the player sees himself.
  try { setThirdPerson(true); } catch (e) { /* camera is best effort */ }
  // The car is parked in the lot by the garden at the bridge approach.
  parkPlayerCar(3);
  applyDriveSpawn(3);
  setTimeOfDay('night'); // Mission 3 (bridge) is night.
  currentPlaceKey = 'bridge';
  try { localStorage.setItem('lastSignalAct2Mission', '3'); } catch (e) { /* private mode */ }
  reparentCast('jade', mission3, 0.4, 8, Math.PI);
  reparentCast('caleb', mission3, 1.2, 9, Math.PI);
  // Night lighting is set by setTimeOfDay('night') above: the sun goes
  // down, the moon takes over, the city windows glow.
  setAmbient('bridge'); // night wind on the bridge, city hum far below
  setTension(0.55);
  setObjectives(OBJ3, 0); updateHUD();
  document.getElementById('timerLabel').textContent = 'Detonator - 48 hr demand';
  document.getElementById('timerVal').textContent = 'live-streaming';
  document.getElementById('timerBar').style.width = '100%';
  // The reason for Mission 3: who called, what is wrong, what is at stake.
  // You get here on foot - the trek through the busy street is the last
  // stretch to the bridge.
  showBriefing({
    title: 'Mission 3 - The Bridge',
    calledBy: 'Jade Morales - she called you the moment the substation was safe.',
    problem: 'Derrick Shaw is on the Verrazzano Bridge with four shaped charges on the main cables, live-streaming a 48-hour demand for a full public audit of city infrastructure.',
    stakes: 'Not enough to drop the bridge - enough to close it for months and cut the city in half. And if his demand is ignored, he detonates. You have to reach him across the deck, on foot.'
  }, () => {
  showDialogue([
    { who: 'Jade Morales', text: 'Eleven-thirty PM. Verrazzano-Narrows Bridge, upper deck. Derrick Shaw is up there with four shaped charges on the main cables - not enough to drop the bridge, enough to close it for months.' },
    { who: 'Caleb Bishop', text: 'And he is live-streaming. Full public audit of all city infrastructure in forty-eight hours, or he detonates.' },
    { who: 'Jade Morales', text: 'My dad welded this bridge. We climb the maintenance catwalk. Click the catwalk planks to climb - and mind the gap.' }
  ], () => { startDeckChase(); });
  });
}

// ---------- Act II action: the deck chase and the physical catwalk climb ----------
// Security is coming across the bridge deck. The player runs (WASD) from
// the south end to the catwalk, dodging cable spools that roll back and
// forth. A hit costs 1 Trust and staggers briefly - never a fail state.
// Reaching the catwalk, or the 40 second window running out (the guards
// lose you in the dark), ends the chase and the climb begins.
let chaseActive = false, chaseTime = 0, chaseInvuln = 0;
const chaseSpools = [];
function startDeckChase() {
  try {
    chaseActive = true; chaseTime = 0; chaseInvuln = 0;
    for (const s of chaseSpools) s.mesh.visible = true;
    showActionBanner('RUN! Security is coming - run the deck to the catwalk and dodge the rolling spools. WASD to move.');
    toast('Run to the catwalk - dodge the rolling spools.');
  } catch (e) { chaseActive = false; toast('Click the catwalk planks to climb toward the upper deck.'); }
}
function completeDeckChase(auto) {
  if (!chaseActive) return;
  chaseActive = false;
  hideActionBanner();
  try { for (const s of chaseSpools) s.mesh.visible = false; } catch (e) { /* ignore */ }
  if (auto) toast('The guards lose you in the dark. The catwalk is ahead.');
  else toast('You reach the catwalk. Click the planks to climb - then hold SPACE or press and hold the prompt to pull yourself up.');
}
function updateDeckChase(dt) {
  if (!chaseActive) return;
  try {
    chaseTime += dt;
    if (chaseInvuln > 0) chaseInvuln -= dt;
    const t = Date.now() / 1000;
    for (const s of chaseSpools) {
      s.mesh.position.x = Math.sin(t * s.speed + s.phase) * 1.4;
      s.mesh.rotation.z += dt * s.speed * 2;
      if (chaseInvuln <= 0 && Math.abs(s.mesh.position.x - camera.position.x) < 0.55 && Math.abs(s.z - camera.position.z) < 0.55) {
        chaseInvuln = 2;
        trust(-1, 'a rolling spool clipped you');
        flashScreen('rgba(255,40,30,0.35)');
        try { sfxThud(); } catch (e) { /* ignore */ }
      }
    }
    const dist = Math.max(0, camera.position.z - (-2));
    try { showActionBanner('RUN! Reach the catwalk - ' + Math.ceil(dist) + ' m to go. Dodge the rolling spools.'); } catch (e) { /* ignore */ }
    if (camera.position.z <= -2 || chaseTime > 40) completeDeckChase(chaseTime > 40);
  } catch (e) { completeDeckChase(true); }
}
// The catwalk climb is physical now: each step is a hand-over-hand pull.
// Clicking the catwalk starts a hold - hold SPACE (or hold the prompt)
// to pull yourself up. Releasing pauses the pull; the window is generous
// and a slip just means trying again - never a fail state, never blocked.
let climbHolding = false, gapQteDone = false, gapActive = false;
function climbStep() {
  if (state.climbStep >= 3) { gapChoice(); return; }
  if (climbHolding) return;
  climbHolding = true;
  try {
    const ok = runHoldQTE({
      label: 'CLIMB - HAND OVER HAND',
      sub: 'Hold SPACE or press and hold here to pull yourself up the catwalk. Release to rest, hold to climb.',
      holdMs: 1200, windowMs: 8000,
      onDone: (done) => {
        climbHolding = false;
        if (done) advanceClimb();
        else toast('You slip back a step - click the catwalk and press and hold to try again.');
      }
    });
    if (!ok) { climbHolding = false; advanceClimb(); }
  } catch (e) { climbHolding = false; advanceClimb(); }
}
function advanceClimb() {
  state.climbStep++;
  const zPos = [8, 4, 0, -2][state.climbStep];
  camera.position.z = zPos + 2; camera.position.y = 1.9;
  const lines = [
    'The wind hits the catwalk sideways. The whole bridge sways under your feet. Caleb grips the safety cable with both hands.',
    'Halfway up. The city glitters far below. Caleb is breathing hard - he hates heights, and he told you so three times already.',
    'The catwalk ends. A section has been cut away - ten feet of nothing, with the city a hundred feet below. Caleb freezes.'
  ];
  showDialogue([{ who: 'System', text: lines[state.climbStep - 1] }], () => {
    if (state.climbStep === 3) { setObjectives(OBJ3, 1); gapChoice(); }
    else toast('Click the catwalk planks to keep climbing.');
  });
}
function gapChoice() {
  if (state.gapDone) return;
  state.gapDone = true;
  gapActive = true; // Caleb freezes: heartbeat and score stay tense
  if (gapQteDone) { gapChoiceDialogue(); return; }
  gapQteDone = true;
  try {
    const ok = runQTE({
      label: 'CALEB FREEZES!',
      sub: 'Press SPACE or tap here now to steady him before he falls back.',
      key: ' ', windowMs: 2500,
      onHit: () => { trust(1, 'steady hands at the gap'); gapChoiceDialogue(); },
      onMiss: () => { gapChoiceDialogue(); }
    });
    if (!ok) gapChoiceDialogue();
  } catch (e) { gapChoiceDialogue(); }
}
function gapChoiceDialogue() {
  showDialogue([
    { who: 'Caleb Bishop', text: 'That is not there. That is not a catwalk. That is a - a thing that is not there. I cannot move.' },
    { who: 'Jade Morales', text: 'Caleb. Look at me. When I was a kid, my dad took me up here. I was terrified. And he said: "Jade, the bridge does not care if you are scared. It is going to hold you anyway. That is what it is for."', choices: [
      { label: '\u201CBridges are trust you can see. I trust you.\u201D (Trust +2)', effect: () => { trust(2, 'you trusted Caleb at the gap'); state.bridgePath = 'best'; } },
      { label: '\u201CYou do not have to do this. Go back.\u201D (Caleb retreats)', effect: () => { trust(1, 'you let him choose'); state.bridgePath = 'solo'; integrity('Power', -5); } },
      { label: '\u201CMove, Bishop. Now.\u201D (Trust -1)', effect: () => { trust(-1, 'you ordered him across'); state.bridgePath = 'strained'; } }
    ] },
    { who: 'Caleb Bishop', text: 'You know what you said? About bridges being trust you can see? ... I see you.' }
  ], () => {
    gapActive = false; // the gap is crossed: the tension eases
    setObjectives(OBJ3, 2);
    if (state.bridgePath === 'solo') toast('Caleb stays behind. Jade goes on alone - the final sequence is harder.');
    else toast('Caleb jumps the gap. Together, then. Click Derrick Shaw to face him.');
  });
}
function confrontation() {
  if (state.derrickDown) return;
  // Mark resolved at entry, not in the callback: a second canvas tap while
  // the dialogue is open used to restart the whole confrontation.
  state.derrickDown = true;
  showDialogue([
    { who: 'Derrick Shaw', text: 'Jade. You look well.' },
    { who: 'Jade Morales', text: 'You look like a terrorist.' },
    { who: 'Derrick Shaw', text: 'I prefer "infrastructure activist." I testified. Six times. I brought evidence. I brought experts. I brought my daughter\u2019s medical records. And nothing changed.' },
    { who: 'Jade Morales', text: 'So you became the thing you hated. A system that does not listen.' },
    { who: 'Derrick Shaw', text: 'The system does not want to listen! You cannot fix something that does not want to be fixed! You have to break it!' },
    { who: 'Jade Morales', text: 'And what about the people on this bridge? The people who use this system every day? Blowing it up will not bring her back. It will just create more grief. More cracks. More people like you.' },
    { who: 'Jade Morales', text: 'I have everything. The 2022 audit. The cracked supports. The cover-up. The names. Witnesses. People who saw what happens when the system fails. This time I am not alone.' },
    { who: 'Derrick Shaw', text: '...What do I do?' },
    { who: 'Jade Morales', text: 'You put down the detonator. You come with us. And you tell your story. Not with bombs. With words.' }
  ], () => {
    // Turn the charges off. Guard for emissive: the hit boxes in
    // chargeMeshes use MeshBasicMaterial, which has no emissive - the old
    // unguarded loop threw on the first hit box and the ending never ran.
    for (const ch of chargeMeshes) { if (ch.material.emissive) { ch.material.emissiveIntensity = 0; ch.material.emissive.set(0x111111); } }
    window._detonator.visible = true;
    integrity('Transit', 10); integrity('Comms', 10);
    state.evidence.push('Derrick Shaw surrendered');
    setObjectives(OBJ3, 4);
    showDialogue([
      { who: 'System', text: 'Long silence. The wind howls. Derrick looks at Jade. At Caleb. At the city below. He puts down the detonator.' },
      { who: 'Derrick Shaw', text: 'My daughter died because no one listened.' },
      { who: 'Jade Morales', text: 'I know. And I am sorry. But repair is a moral act. We fix it - the right way.' }
    ], endAct2);
  });
}
function endAct2() {
  try {
    localStorage.setItem('lastSignalAct2', JSON.stringify({
      trust: state.trust, integrity: state.integrity, evidence: state.evidence,
      waterChoice: state.waterChoice || 'none', bombDisarmed: state.bombDisarmed, bridgePath: state.bridgePath
    }));
  } catch (e) { /* private mode */ }
  missionsDone[3] = true;
  // Mission pay: finishing Mission 3 earns $22,000 (once only).
  try { grantPayout('act2m3'); } catch (e) { /* economy is optional */ }
  const el = document.getElementById('endCard');
  el.classList.remove('hidden');
  const pathText = { best: 'Caleb crossed the gap with you - the best-ending path is open.', solo: 'Caleb stayed behind - Jade faced Derrick alone.', strained: 'Caleb crossed, but the trust is strained.', undecided: '' }[state.bridgePath];
  document.getElementById('endSummary').innerHTML =
    `<p>Act II complete - the aqueduct holds, the substation ${state.bombDisarmed ? 'bomb is disarmed' : 'suffered a partial blackout'}, and Derrick Shaw put down the detonator on the Verrazzano.</p>` +
    `<p><strong>Water choice:</strong> ${state.waterChoice || 'none'} line got full pressure. <strong>Bridge:</strong> ${pathText}</p>` +
    `<p><strong>Evidence:</strong> ${state.evidence.length ? state.evidence.join(' · ') : 'none yet'}</p>` +
    `<p>Trust: ${state.trust} / 10 &nbsp;•&nbsp; System Integrity - Transit ${state.integrity.Transit}, Water ${state.integrity.Water}, Power ${state.integrity.Power}, Comms ${state.integrity.Comms}</p>` +
    `<p>Next: Act III - The Human Signal (courtroom, ambush, press conference). Press "Begin Act III" below to continue.</p>`;
  if (window.__lsActManager) window.__lsActManager.setEndCardButtons('act2');
}

// Pause / resume for a home visit: freeze the render loop and input
// WITHOUT disposing the scene (stopAct() disposes it, so it is only for
// act transitions). The valve sabotage timer and the bomb timer are
// stopped so they do not run while the player is away; reopening the
// valve modal or the SCADA terminal restarts them.
export function pauseAct() {
  actActive = false;
  if (actRaf) { try { cancelAnimationFrame(actRaf); } catch (e) { /* ignore */ } actRaf = 0; }
  try { valveOpen = false; } catch (e) { /* ignore */ }
  try { if (typeof bombInterval !== 'undefined' && bombInterval) { clearInterval(bombInterval); bombInterval = null; } } catch (e) { /* ignore */ }
  try { document.getElementById('dialogue').classList.add('hidden'); } catch (e) { /* ignore */ }
  try { document.getElementById('valveModal').classList.add('hidden'); } catch (e) { /* ignore */ }
  try { document.getElementById('scadaModal').classList.add('hidden'); } catch (e) { /* ignore */ }
}
export function resumeAct() {
  if (actActive) return;
  actActive = true;
  animate();
}

// Stop this act cleanly so the next act can load on the same page: halt
// the animate loop and the puzzle timers, silence speech, hide any open
// dialogue or modal, and dispose this act's scene (the shared renderer
// in core.js is never disposed).
export function stopAct() {
  actActive = false;
  dlgToken++; // a pending auto-advance must not fire after the act stops
  if (dlgTimer) { clearTimeout(dlgTimer); dlgTimer = null; }
  try { hideTakeRentalButton(); } catch (e) { /* button is optional */ }
  if (actRaf) { try { cancelAnimationFrame(actRaf); } catch (e) { /* ignore */ } actRaf = 0; }
  try { if (typeof valveTimer !== 'undefined' && valveTimer) { clearInterval(valveTimer); valveTimer = null; } } catch (e) { /* ignore */ }
  try { if (typeof getOutCbTimer !== 'undefined' && getOutCbTimer) { clearTimeout(getOutCbTimer); getOutCbTimer = null; } } catch (e) { /* ignore */ }
  try { if (typeof bombInterval !== 'undefined' && bombInterval) { clearInterval(bombInterval); bombInterval = null; } } catch (e) { /* ignore */ }
  try { stopSpeaking(); } catch (e) { /* ignore */ }
  try { document.getElementById('dialogue').classList.add('hidden'); } catch (e) { /* ignore */ }
  try { document.getElementById('valveModal').classList.add('hidden'); } catch (e) { /* ignore */ }
  try { document.getElementById('scadaModal').classList.add('hidden'); } catch (e) { /* ignore */ }
  try { disposeScene(scene); } catch (e) { /* ignore */ }
}

// ---------- Click to inspect ----------
// Debug hook for live testing: window.__ls2.state / .interact / .openValveModal.
window.__ls2 = { state, interact, openValveModal, openScadaModal, openCityMap };
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let lastTapAt = 0;
function handleTap(clientX, clientY) {
  mouse.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  // The parked car door is always clickable, even while a briefing or a
  // dialogue is open: the player is seated in the car and the door is
  // how he gets out. A tap on the door opens it; anything else is
  // ignored while reading, as before.
  if (parkedSeatActive && parkedSeat && parkedSeat.doorHit) {
    const doorHits = ray.intersectObject(parkedSeat.doorHit, false);
    if (doorHits.length) { interact('carDoor'); return; }
    // A tap anywhere on the parked car also opens the door: from the
    // seated view the door sits on one side of the car, and a tap
    // dead-centre on the car must not miss it entirely.
    if (parkedSeat.car) {
      const carHits = ray.intersectObject(parkedSeat.car, true);
      if (carHits.length) { interact('carDoor'); return; }
    }
  }
  // While a dialogue or a modal is open the player is reading or choosing:
  // canvas taps must not re-trigger an interaction and reset the queue.
  if (!document.getElementById('dialogue').classList.contains('hidden')) return;
  if (!document.getElementById('valveModal').classList.contains('hidden')) return;
  if (!document.getElementById('scadaModal').classList.contains('hidden')) return;
  const targets = [];
  if (state.mission === 1) targets.push(...Object.values(window._valveMeshes || {}), window._device1, window._device1Hit, window._stationDoor, window._stationDoorHit, ...stationDoorHandleParts, window._stationKey, window._stationKeyHit, window._stationKeyLabel, window._rentalCarHit);
  if (state.mission === 2) targets.push(keycardMesh, window._keycardHit, logbookMesh, window._logbookHit, scadaMesh, manifestoMesh, window._manifestoHit);
  if (state.mission === 3) targets.push(...chargeMeshes, window._catwalkHit, ...(window._catwalkPlanks || []));
  const sceneHits = ray.intersectObjects(targets.filter(t => t && t.visible !== false), false);
  if (sceneHits.length) { interact(sceneHits[0].object.name); return; }
  const humanHits = ray.intersectObjects(humanGroups.filter(g => g.visible && g.parent && g.parent.visible), true);
  if (humanHits.length) {
    // Resolve the clicked character by walking up to the human group itself.
    // (The old walk-up stopped at the mission group, whose name is empty,
    // so clicks on Jade/Caleb/guards/Derrick silently did nothing.)
    let name = null, p = humanHits[0].object;
    while (p) {
      if (humanGroups.indexOf(p) !== -1) { name = p.name; break; }
      p = p.parent;
    }
    interact(name || humanHits[0].object.name);
  }
}
canvas.addEventListener('click', e => {
  if (!actActive) return;
  if (dragMoved > 10) { dragMoved = 0; return; }
  dragMoved = 0;
  if (Date.now() - lastTapAt < 400) return; // already handled by pointerup
  lastTapAt = Date.now();
  handleTap(e.clientX, e.clientY);
});
// Pointerup fallback: some harnesses and touch inputs deliver press/release
// without a click event on the canvas. A tap (not a drag) is a click here.
canvas.addEventListener('pointerup', e => {
  if (!actActive) return;
  // A drag must never become a tap: stamp lastTapAt when rejecting, or
  // the click event that follows every pointerup sees dragMoved reset
  // to 0 and fires handleTap at the release point - inside the valve
  // room that phantom tap hit the station door and threw the player
  // out mid-drag.
  if (dragMoved > 10) { dragMoved = 0; lastTapAt = Date.now(); return; }
  dragMoved = 0;
  if (Date.now() - lastTapAt < 400) return;
  lastTapAt = Date.now();
  handleTap(e.clientX, e.clientY);
});
// Distance from the PLAYER (his ground position) to a point. Click
// handlers run outside the animate loop, where camera.position is
// the render camera - up to 4 m behind him in third person - so
// measuring from the camera would refuse clicks while he stands at
// the target. The avatar mesh is not used either: in first person
// the avatar is hidden and its position is never updated, so it
// stays where third person last left it (near the station door, say)
// and a gate measured from it passed from the back wall of the
// valve room, 5 m away. getPlayerPos is the ground position the
// movement code itself uses, kept current in both camera modes.
function playerDist2D(x, z) {
  const p = getPlayerPos();
  if (p) return dist2D(p.x, p.z, x, z);
  return dist2D(camera.position.x, camera.position.z, x, z);
}
// Collect the SCADA key card from guard 1's belt. One helper for
// every path that can take it - clicking the card itself, its hit
// box, or either guard after stand-down - so the chain can never
// soft-block on pixel-hunting a small card (on the live check the
// card could not be found or clicked on either belt and the SCADA
// reroute was never reached).
function collectKeycard() {
  if (hasKeycard || !keycardMesh || !keycardMesh.visible) return;
  hasKeycard = true; keycardMesh.visible = false; if (window._keycardHit) window._keycardHit.visible = false;
  state.inventory.push('SCADA key card'); updateHUD();
  setObjectives(OBJ2, 2);
  toast('Key card collected. Now the red log book on the desk - the passphrase is in it.');
}
function interact(name) {
  if (!name) return;
  // The parked car door: open it and step outside. This is how the
  // player gets out of the car at any destination he drove to.
  if (name === 'carDoor') { getOutOfParkedCar(); return; }
  if (name === 'rentalCar') { startRentalDrive(); return; }
  if (name === 'valveHospital' || name === 'valveResidential' || name === 'valveIndustrial') {
    // The valves are inside the valve room: the puzzle only opens once the
    // player has walked in through the station door to reach them.
    if (!inValveRoom) { toast('The valves are inside the valve room - enter through the station door.'); return; }
    openValveModal(); return;
  }
  if (name === 'digitalPanel') { toast('Digital control - sabotaged. It overcorrects every valve you set. The physical valves still work.'); return; }
  if (name === 'stationKey' || name === 'stationKeyLabel') {
    // The station key, on its hook beside the door. Picking it up
    // unlocks the station door. Walking up to it also picks it up
    // (see the animate loop), so a missed click is not a dead end.
    if (hasKey('station')) { toast('You already have the station key.'); return; }
    // The click target is generous, so a click from across the yard
    // would otherwise pick the key up from metres away: he has to
    // walk to the hook beside the door.
    if (playerDist2D(1.5, -0.6) > 2.0) {
      toast('The station key is on the hook beside the door - walk over to it.');
      return;
    }
    giveKey('station', 'station key');
    // Keys live in localStorage (player.js), not in the HUD
    // inventory, so a pickup never showed anywhere the player could
    // check - on the live check the door opened "with no key in
    // inventory" because the walk-up pickup had already fired.
    state.inventory.push('Station key'); updateHUD();
    toast('Picked up the station key. The station door is unlocked.');
    sfxRepair();
    try { if (window._stationKey) window._stationKey.visible = false; } catch (e) { /* ignore */ }
    try { if (window._stationKeyHit) window._stationKeyHit.visible = false; } catch (e) { /* ignore */ }
    try { if (window._stationKeyLabel) window._stationKeyLabel.visible = false; } catch (e) { /* ignore */ }
    try { if (window._stationKeyMarker) window._stationKeyMarker.visible = false; } catch (e) { /* ignore */ }
    return;
  }
  if (name === 'stationDoor') {
    // One door, two sides: from inside the valve room the same slab
    // opens without the key; from outside it needs the mission to have
    // started and the station key on its hook beside the door.
    if (inValveRoom) {
      // Exit stays key-free, but he still has to be at the door: the
      // click target is generous enough to reach from the back wall.
      // 1.8 m, the walk-up radius: the old 3.5 m covered most of this
      // small room (the gauges and the east stairs both sit inside
      // it), so "far" clicks still exited on the live check. The
      // refusal is loud and explicit so a far click can never read
      // as a silent exit.
      if (playerDist2D(0, -0.68) > 1.8) {
        toast('Too far - walk to the door.');
        sfxThud();
        return;
      }
      tryStationDoor('inside'); return;
    }
    // Before the mission starts the door stays shut: he takes the rental
    // car to the facility first. The briefing starts after that drive.
    if (!mission1Started) {
      toast('Take the rental car to the water facility first - it costs 0.05 ZAMA and is waiting by the platform.');
      return;
    }
    // The station door is locked: it needs the station key, which is
    // on the hook beside the door. Without the key the door shows it
    // is locked instead of opening.
    if (!hasKey('station')) {
      toast('Locked - needs the station key. It is on the hook beside the door.');
      sfxThud();
      return;
    }
    // The door's click target is generous: a click from across the
    // yard would otherwise swing it open and put him inside without
    // ever walking to it. He has to be at the door.
    if (playerDist2D(0, -0.68) > 1.8) {
      toast('The station door is just ahead - walk to it and use the key.');
      return;
    }
    tryStationDoor('outside'); return;
  }
  if (name === 'device1' && window._device1.visible) {
    state.inventory.push('RESET device (aqueduct)'); state.evidence.push('RESET device + fingerprint: Derrick Shaw');
    updateHUD(); setObjectives(OBJ1, 5);
    missionsDone[1] = true;
    // Mission pay: finishing Mission 1 earns $12,000 (once only).
    try { grantPayout('act2m1'); } catch (e) { /* economy is optional */ }
    showDialogue([
      { who: 'Jade Morales', text: 'Same label. RESET. Same hand-soldered board, same MTA capacitors. And a partial fingerprint on the casing.' },
      { who: 'Caleb Bishop', text: 'Running it now... Derrick Shaw. Former Deputy Director of City Planning. The Architect has a name.' },
      { who: 'Jade Morales', text: 'He was my mentor. And he is waiting for someone to prove him wrong. Next: the substation. The grid is next.' }
    ], () => beginTravel('reservoir', 'substation', startMission2));
    return;
  }
  if (name === 'jade') { toast('Jade Morales - former MTA signal engineer. She designed the 4 line, and she knows every relay in the city.'); return; }
  if (name === 'caleb') { toast('Caleb Bishop, NYPD Transit. Young, earnest - and getting better at this.'); return; }
  if (name === 'guard1' || name === 'guard2') {
    // After stand-down, tapping either guard hands over the key card:
    // the card rides on guard 1, but the bluff can trigger at either
    // guard and nothing said which belt to search - the live check
    // clicked around both guards and never collected it. A guard is
    // a big, easy target on a phone; the card hunt must not block.
    if (guardsDown && !hasKeycard) { collectKeycard(); return; }
    guardDialogue(); return;
  }
  if (name === 'keycard' && keycardMesh.visible) { collectKeycard(); return; }
  if (name === 'logbook') {
    if (hasPassphrase) { toast('You already have the passphrase - "Trust the system, but verify the people." The terminal is waiting.'); return; }
    hasPassphrase = true; state.inventory.push('Passphrase'); state.evidence.push('Passphrase: Jade\u2019s own words'); updateHUD();
    showDialogue([
      { who: 'Jade Morales', text: 'The maintenance logs. An entry I wrote years ago: "Trust the system, but verify the people." That is the passphrase.' },
      { who: 'Caleb Bishop', text: 'He used your own words against you.' },
      { who: 'Jade Morales', text: 'He has been reading my old reports. My ideas, twisted into sabotage. The terminal will take the key card and the passphrase now.' }
    ], () => { setObjectives(OBJ2, 2); toast('Click the SCADA terminal to reroute the load.'); });
    return;
  }
  if (name === 'scada') { openScadaModal(); return; }
  if (name === 'camera') { toast('Security camera - it watches the yard. The guards are the way in, not the fence.'); return; }
  if (name === 'controlDoor') {
    // The control-room door is locked: it needs the substation key,
    // which the guards hand over when they stand down. Without it the
    // door shows it is locked; with it, the room is open.
    if (!hasKey('substation')) {
      toast('Locked - needs the substation key. The guards at the gate have it.');
      sfxThud();
      return;
    }
    toast('Control room - unlocked with the substation key. The SCADA terminal is on the desk outside. The manifesto is pinned inside, on the wall.'); return;
  }
  if (name === 'manifesto' && manifestoMesh.visible) {
    state.evidence.push('Manifesto addressed to Jade');
    missionsDone[2] = true;
    // Mission pay: finishing Mission 2 earns $18,000 (once only).
    try { grantPayout('act2m2'); } catch (e) { /* economy is optional */ }
    showDialogue([
      { who: 'Jade Morales', text: '"You saw the cracks. You spoke. No one listened. So I will make them listen. - D.S." It is addressed to me, by name.' },
      { who: 'Caleb Bishop', text: 'He is not hiding. He is waiting. The bridge is next - the Verrazzano, tonight.' },
      { who: 'Jade Morales', text: 'Then we go to the bridge.' }
    ], () => beginTravel('substation', 'bridge', startMission3));
    return;
  }
  if (name === 'catwalk') { climbStep(); return; }
  if (name === 'charge') { toast('Shaped charge, wired to the main cable. Four of them. Do not touch it - Derrick holds the detonator.'); return; }
  if (name === 'derrick') { confrontation(); return; }
  if (name === 'detonator') { toast('The detonator - on the deck now, not in his hand. The bridge is safe.'); return; }
}

// ---------- Animate ----------
document.getElementById('cinemaBtn').onclick = () => {
  document.getElementById('letterboxTop').classList.toggle('hidden');
  document.getElementById('letterboxBottom').classList.toggle('hidden');
};
// ---------- Wall colliders (see player.js) ----------
// One list per walkable area, filled by the builders below. The animate
// loop resolves movement against the list for the current view, so the
// player stops at walls and slides along them instead of walking
// through. Outer walls that sit beyond the view bounds need no box:
// the bounds clamp already stops the player before he reaches them.
// Doorways are left open in the wall lists; a shut door blocks its own
// doorway with the slab box below until it swings open.
// The station door slab (hinge at x -0.6, slab 1.2 wide, 0.15 thick at
// z -0.68): it blocks the lobby doorway while shut. Entry is by the
// walk-up trigger (1.8 m), which fires before the player reaches the
// slab, so the closed door never traps him outside.
const STATION_DOOR_BOX = { x0: -0.6, z0: -0.8, x1: 0.6, z1: -0.55 };
let mission1Colliders = [];
let mission2Colliders = [];
let mission3Colliders = [];
let valveRoomColliders = [];
let trekColliders = [];
function act2Colliders() {
  // The trek street is its own scene: only its own car boxes apply
  // (trekColliders, registered in buildTrekStreet). Without this
  // exception the substation yard fences (mission2Colliders, still
  // selected while state.mission is 2) block the street: the
  // full-width fence at z 12.35-12.7 stopped the trek 58 m short of
  // the bridge marker (round 17).
  if (trekActive) return trekColliders;
  let list;
  if (inValveRoom) list = valveRoomColliders;
  else if (state.mission === 2) list = mission2Colliders;
  else if (state.mission === 1) list = mission1Colliders;
  else if (state.mission === 3) list = mission3Colliders;
  else list = mission1Colliders;
  if (state.mission === 1 && !inValveRoom && !stationDoorOpen) return list.concat([STATION_DOOR_BOX]);
  return list;
}
// Frame errors are logged once per distinct message so a live check
// can capture them from the console instead of the game freezing on
// the last good frame with no trace of why. They also go on the
// on-screen banner (core.js): the checker toolset has no console
// access, so a frozen canvas must carry its reason in the screenshot
// itself. The banner counts every error, not just distinct ones.
const _frameErrorsSeen = new Set();
function logFrameError(e) {
  try {
    const msg = (e && e.message) ? e.message : String(e);
    try { showFrameErrorBanner(msg); } catch (err) { /* banner is best effort */ }
    if (_frameErrorsSeen.has(msg)) return;
    _frameErrorsSeen.add(msg);
    console.error('[LastSignal frame error] ' + msg, e);
  } catch (err) { /* logging must never break the loop */ }
}
// The render loop must never die on a bad frame: if any per-frame
// update throws (a rigged model, a mixer, a sound call), the frame
// still renders with whatever state was reached, and the next frame
// tries again. Before this wrapper, one throw before the render
// call froze the canvas on the last good frame - which is exactly
// what the live check saw at every Act II travel arrival (the drive
// street stayed on screen, drags did not orbit, WASD moved nothing
// visibly, while the DOM and the game logic kept working).
let _renderFailStreak = 0;
let _skinnedFallbackDone = false;
function animate() {
  if (!actActive) return;
  actRaf = requestAnimationFrame(animate);
  // A morph push since the last frame (a cast arrival registering
  // lip-sync) can leave a sharer mesh in this scene without its
  // morphTargetInfluences, which throws inside renderer.render and
  // freezes the canvas. Heal once per push generation, before the
  // frame renders (see core.js). O(1) when nothing was pushed.
  try { healMorphsIfDirty(scene); } catch (e) { /* healing is best effort */ }
  try { animateFrame(); _renderFailStreak = 0; }
  catch (e) {
    logFrameError(e);
    // The frame (or its render) threw: heal any morph-poisoned mesh
    // in the scene and retry the render once, so a sharer the push
    // sweeps missed fixes itself instead of freezing the canvas.
    try { healMorphInfluences(scene); } catch (e0) { /* best effort */ }
    try { renderer.render(scene, camera); _renderFailStreak = 0; }
    catch (e2) {
      logFrameError(e2);
      // The render itself is throwing, so no frame can present and
      // the canvas stays frozen on the last good frame (the Mission
      // 2 arrival freeze: logic and DOM kept running over a frozen
      // street). As a last resort, after a streak of render
      // failures, hide every skinned mesh in the scene (the rigged
      // people are the only Mission 2 content class the other
      // arrivals never render) and let the rest of the world
      // present. The banner keeps the original error on screen, so
      // a live check can still read what broke; the game stays
      // playable instead of frozen.
      _renderFailStreak++;
      if (_renderFailStreak >= 10 && !_skinnedFallbackDone) {
        _skinnedFallbackDone = true;
        _renderFailStreak = 0;
        try {
          scene.traverse(o => { if (o.isSkinnedMesh) o.visible = false; });
          showFrameErrorBanner('render fallback: skinned meshes hidden after repeated render failures - see error above');
        } catch (e3) { /* fallback is best effort */ }
      }
    }
  }
}
function animateFrame() {
  const t = Date.now() / 1000;
  const dt = animateFrame.lastT === undefined ? 0.016 : Math.min(0.1, t - animateFrame.lastT);
  animateFrame.lastT = t;
  // During the drive between missions the travel sequence owns the
  // camera: the road and the city scroll past, WASD is ignored, and the
  // mission camera control below is skipped so it cannot fight the drive.
  if (travelActive) {
    updateTravelDrive(dt, t);
    renderer.render(scene, camera);
    return;
  }
  // While the player is seated in a parked car, the seat owns the
  // camera: a chase view from behind the car so he sees himself in the
  // driver's seat and the door he can click. Movement and the normal
  // presence hook are skipped, so the avatar is not forced to stand and
  // the camera does not snap back to the pre-drive position.
  if (parkedSeatActive) {
    updateParkedSeatView();
    updateDoorSwing(dt);
    // The yard stays alive while he sits in the car: guards keep
    // walking their patrol (movement only - the walk-up bluff
    // trigger must never fire while he is still seated). The
    // guardsDown check lives inside updateGuardPatrol now, so the
    // integrity sweep and look heal run even after stand-down.
    if (mission2.visible) updateGuardPatrol(t, dt);
    renderer.render(scene, camera);
    return;
  }
  // A car door that was opened keeps swinging even after the player is
  // on foot, so it finishes opening and stays open.
  updateDoorSwing(dt);
  // The station door handle turn and swing runs on the same frame loop,
  // so the lever turns and the door opens while the player watches.
  updateStationDoorAnim(dt);
  // In third-person the camera was left behind the avatar last frame;
  // put it back on the player BEFORE the walk-up triggers below read
  // camera.position as the player position. The triggers used to run
  // first, so in third person they measured from the camera 4 m behind
  // him and the key pickup, the station door and the valve walk-ups
  // never fired in the default view (only clicks worked).
  beginPlayerFrame(camera, state.mission === 3 ? 1.9 : 1.7);
  // Valve room: walking up to a valve wheel opens the pressure controls,
  // so the puzzle opens when the player reaches the valves.
  if (state.mission === 1 && mission1.visible && inValveRoom && !valveOpen && !state.waterStable && Date.now() > valveReopenAt
    && document.getElementById('dialogue').classList.contains('hidden')
    && document.getElementById('valveModal').classList.contains('hidden')) {
    for (const vx of [-3, 0, 3]) {
      if (playerDist2D(vx, -5.7) < 1.8) { openValveModal(); break; }
    }
  }
  // Arrival: the player stepped off the train at Rondout station. The
  // mission only starts once he walks off the platform toward the
  // facility: crossing world z 307 (local z 7 + STATION_DZ) on the
  // dirt track, past the platform end at world z 311. He spawns at
  // world z 312.3, so this cannot fire at spawn, and the flag makes
  // it fire exactly once per Act II entry.
  if (state.mission === 1 && mission1.visible && !mission1Started && !arrivalDone
    && document.getElementById('dialogue').classList.contains('hidden')
    && document.getElementById('valveModal').classList.contains('hidden')) {
    if (camera.position.z < 307) {
      arrivalDone = true;
      // Walking off the platform leads to the rental car, not straight
      // into the mission: the briefing starts only after the rental drive.
      showTakeRentalButton();
      toast('Take the rental car to the water facility - 0.05 ZAMA. Click the car, or tap Take the rental car.');
    }
  }
  // The rental car by the platform: walking up to it offers the drive,
  // so a player who does not think to click still gets the button.
  if (state.mission === 1 && mission1.visible && !mission1Started && !rentalTaken && stationRental
    && document.getElementById('dialogue').classList.contains('hidden')
    && document.getElementById('valveModal').classList.contains('hidden')) {
    if (dist2D(camera.position.x, camera.position.z, 4.5, 309.0) < 4) {
      showTakeRentalButton();
      if (t - rentalToastAt > 6) {
        rentalToastAt = t;
        toast('Rental car - 0.05 ZAMA. Take it to the water facility.');
      }
    }
  }
  // Station key: walking right up to the hook picks it up, so a missed
  // click is not a dead end. The radius is 0.75 m, not the original
  // 1.2 m: at 1.2 m the walk to the door itself passed through it, so
  // the key was taken silently on the way in and the door read as
  // needing no key at all. At 0.75 m the straight walks from the
  // parked car and from Caleb to the door still pass clear (both over
  // 1.3 m from the hook), while a player who walks to the glowing key
  // and stops a step short of it still gets the pickup - the wall
  // stops him 0.4 m short of the hook, so the old 0.6 m left only
  // 0.45 m of sideways tolerance and a near miss got no feedback.
  if (state.mission === 1 && mission1.visible && !inValveRoom && !hasKey('station')
    && document.getElementById('dialogue').classList.contains('hidden')
    && document.getElementById('valveModal').classList.contains('hidden')) {
    if (playerDist2D(1.5, -0.6) < 0.75) {
      giveKey('station', 'station key');
      state.inventory.push('Station key'); updateHUD();
      toast('Picked up the station key. The station door is unlocked.');
      sfxRepair();
      try { if (window._stationKey) window._stationKey.visible = false; } catch (e) { /* ignore */ }
      try { if (window._stationKeyHit) window._stationKeyHit.visible = false; } catch (e) { /* ignore */ }
      try { if (window._stationKeyLabel) window._stationKeyLabel.visible = false; } catch (e) { /* ignore */ }
    try { if (window._stationKeyMarker) window._stationKeyMarker.visible = false; } catch (e) { /* ignore */ }
    }
  }
  // Station door: walking up to the entrance enters the valve room, so
  // the player can get in by walking through the door even if the click
  // misses. The door is also clickable (see the Mission 1 targets).
  // The player starts 8.7 m back, so this cannot fire at spawn. The
  // door is locked: it needs the station key, which is on a hook beside
  // the door (see buildMission1). Without the key the door shows it is
  // locked instead of opening, so the player is never stuck - the key
  // is right there before he needs the door.
  if (state.mission === 1 && mission1.visible && !inValveRoom
    && document.getElementById('dialogue').classList.contains('hidden')
    && document.getElementById('valveModal').classList.contains('hidden')) {
    if (playerDist2D(0, -0.68) < 1.8) {
      if (!mission1Started) {
        if (t - stationDoorLockedAt > 3) {
          stationDoorLockedAt = t;
          toast('Take the rental car to the water facility first - it costs 0.05 ZAMA and is waiting by the platform.');
        }
      } else if (hasKey('station')) tryStationDoor('outside');
      else if (t - stationDoorLockedAt > 3) {
        stationDoorLockedAt = t;
        toast('Locked - needs the station key. It is on the hook beside the door.');
        sfxThud();
      }
    }
  }
  // (beginPlayerFrame already ran above, before the walk-up triggers,
  // so the camera is on the player and movement starts from his feet.)
  const sp = 0.05;
  const mv = moveDelta(keys, state.yaw, sp);
  const resolved = resolveMove(camera.position.x, camera.position.z, mv.dx, mv.dz, act2Colliders());
  camera.position.x = resolved.x; camera.position.z = resolved.z;
  camera.position.x = Math.max(camBounds.x[0], Math.min(camBounds.x[1], camera.position.x));
  camera.position.z = Math.max(camBounds.z[0], Math.min(camBounds.z[1], camera.position.z));
  const moving = keys['w'] || keys['a'] || keys['s'] || keys['d'];
  const strafing = (keys['a'] ? -1 : 0) + (keys['d'] ? 1 : 0);
  camera.rotation.order = 'YXZ';
  const sway = document.getElementById('dialogue').classList.contains('hidden') ? 1 : 0.4;
  const wind = state.mission === 3 ? 0.02 : 0.004; // the bridge sways in the wind
  camera.rotation.y = state.yaw + Math.sin(t * 0.7) * 0.004 * sway;
  camera.rotation.x = state.pitch + Math.sin(t * 0.9 + 1.3) * 0.003 * sway;
  // Lean into a strafe so sideways movement reads, and bob with the
  // player's steps (not a constant sway): the bob is strong and quick
  // while moving and settles to a faint idle sway when still, so WASD
  // visibly moves the world instead of gliding through it.
  camera.rotation.z = Math.sin(t * 0.5) * wind * sway - strafing * 0.02 * sway;
  const bobAmp = moving ? 0.035 : 0.008;
  const bobFreq = moving ? 5.2 : 0.8;
  camera.position.y = (state.mission === 3 ? 1.9 : 1.7) + Math.sin(t * bobFreq) * bobAmp * sway;
  if (waterMesh) waterMesh.position.y = DAM_WATER_Y + Math.sin(t * 0.6) * 0.02;
  for (const ch of chargeMeshes) {
    if (!state.derrickDown && ch.material.emissive) ch.material.emissiveIntensity = 1.2 + Math.sin(t * 5) * 0.8;
  }
  for (const h of humans) {
    const bt = t * 1.1 + h.phase;
    // Breathe on Y only: X/Z keep the build scale (body width), so
    // a wide build stays wide and kit sized to the build-time
    // bounding box stays on the body's surface.
    h.group.scale.set(h.baseScaleX !== undefined ? h.baseScaleX : h.baseScale, h.baseScale * (1 + Math.sin(bt) * 0.012), h.baseScaleZ !== undefined ? h.baseScaleZ : h.baseScale);
  }
  // Guards patrol the gate line while the yard is shown and they have
  // not stood down, so the yard feels alive and the player can see the
  // guards are the way in. They walk back and forth in x around their
  // post and face the direction they walk (the Caleb scan faces +z, so
  // +x is rotation.y = PI/2 and -x is -PI/2; a rigged guard adds
  // its own faceYaw, PI for the -Z Atlas rigs). The key card rides on
  // guard1's belt, so it follows him; the "!" markers pulse above them.
  // The movement gate is the yard being shown, NOT the mission
  // number: the yard can be on screen without state.mission === 2
  // (a map drive to the substation during Mission 1 shows the yard
  // through restoreMissionScene), and gating the walk on the mission
  // number left both guards standing frozen at their posts on the
  // live check while the yard rendered around them. Only the
  // walk-up bluff trigger below stays mission-gated: the shared
  // arrival lot sits on the same origin coordinates as the yard, so
  // without that gate the trigger fired inside the lot (a Symposium
  // arrival put the player 1.7 m from a guard patrol point) while
  // the yard was hidden.
  if (mission2.visible) {
    updateGuardPatrol(t, dt);
    if (!guardsDown && state.mission === 2 && mission2BriefingDone
      && document.getElementById('dialogue').classList.contains('hidden')
      && document.getElementById('valveModal').classList.contains('hidden')
      && document.getElementById('scadaModal').classList.contains('hidden')) {
      for (const gp of guardPatrol) {
        if (dist2D(camera.position.x, camera.position.z, gp.group.position.x, gp.group.position.z) < 4) {
          guardDialogue();
          break;
        }
      }
    }
  }
  // Stood-down facing and idle now live inside updateGuardPatrol
  // (called above whenever the yard is shown), so the integrity
  // sweep and look heal keep running after stand-down instead of
  // stopping at the old !guardsDown gate. The final facing word
  // after the gesture pass below is unchanged.
  // The key card sits on guard1's front belt: while it is visible,
  // keep it on him so the player always finds it where he is. He
  // stands down facing the player (see guardDialogue), so the card
  // rides 0.24 m in front of his centre at belt height, offset to
  // his right hand side, clear of his torso and arm; the old fixed
  // z +0.24 spot only worked while he faced south. The marker above
  // it pulses so the player can tell WHICH guard has the card.
  if (state.mission === 2 && keycardMesh && keycardMesh.visible && guardPatrol.length) {
    const g1 = guardPatrol[0].group.position;
    let fdx = camera.position.x - g1.x, fdz = camera.position.z - g1.z;
    const fl = Math.hypot(fdx, fdz);
    if (fl > 0.01) { fdx /= fl; fdz /= fl; } else { fdx = 0; fdz = 1; }
    keycardMesh.position.set(g1.x + fdx * 0.24 + fdz * 0.12, 1.02, g1.z + fdz * 0.24 - fdx * 0.12);
    keycardMesh.rotation.y = Math.atan2(fdx, fdz); // card face toward the player
    if (window._keycardHit) window._keycardHit.position.set(g1.x + fdx * 0.15, 1.05, g1.z + fdz * 0.15);
    if (window._keycardMarker) {
      const ms = 0.55 + Math.sin(t * 4) * 0.08;
      window._keycardMarker.scale.set(ms, ms, 1);
      window._keycardMarker.material.opacity = 0.85 + Math.sin(t * 4) * 0.15;
    }
    if (window._keycardGlow) window._keycardGlow.material.opacity = 0.4 + Math.sin(t * 3) * 0.15;
  }
  // Living city traffic (Mission 2 only, not while trekking): cars drive
  // the road in both directions and the train runs the elevated track,
  // looping so the street never empties. This is the movement the player
  // sees even when standing still, and it makes WASD travel read against
  // it. Pedestrians walk the sidewalks, and the traffic jam honks.
  if (state.mission === 2 && !trekActive) {
    for (const c of cityCars) {
      c.group.position.x += c.speed * dt;
      if (c.group.position.x > 46) c.group.position.x = -46;
      if (c.group.position.x < -46) c.group.position.x = 46;
    }
    if (cityTrain) {
      cityTrain.position.x += 9 * dt;
      if (cityTrain.position.x > 55) cityTrain.position.x = -55;
    }
    // Per-pedestrian isolation: one bad rigged upgrade or mixer must
    // not take the whole frame (and with it the render) down with
    // it. The error still lands on the banner via logFrameError.
    for (const p of cityPedestrians) { try { updatePedestrian(p, dt); } catch (e) { logFrameError(e); } }
    hornTimer += dt;
    if (hornTimer > 9) { hornTimer = 0; honkHorn(); }
  }
  updateTrek(dt, t); // on-foot trek, no-op when inactive
  // The station key bobs gently on its hook, so it catches the eye.
  if (window._stationKey && window._stationKey.visible) {
    window._stationKey.position.y = 1.5 + Math.sin(t * 2) * 0.06;
    window._stationKey.rotation.y = Math.sin(t * 1.2) * 0.4;
    if (window._stationKeyMarker) {
      const ks = 0.8 + Math.sin(t * 4) * 0.12;
      window._stationKeyMarker.scale.set(ks, ks, 1);
      window._stationKeyMarker.material.opacity = 0.85 + Math.sin(t * 4) * 0.15;
    }
  }
  updateSpeakingGestures(t); // speaking bob, nod, lean and turn (no-op with no speaker)
  // Stood-down guards face the player LAST: gestures write every
  // registered human's rotation each frame (a listener turn toward
  // whoever spoke last would swing the guards away from the player
  // after any later line), so re-apply the guard facing after the
  // gesture pass. The patrol block above already ran before
  // gestures and its facing is adopted as the rest pose, so only
  // the stood-down facing needs this final word.
  if (mission2.visible && guardsDown) faceGuardsAtPlayer();
  // Sound: footsteps while moving, heartbeat and score tension. The bomb
  // countdown and the bridge gap are the tense moments here.
  // (`moving` is computed above, with the camera bob.)
  let tension = state.mission === 3 ? 0.55 : (state.mission === 2 ? 0.4 : 0.15);
  let hb = 0;
  if (state.mission === 2 && bombInterval) { tension = 0.7 + (1 - bombTime / 90) * 0.2; hb = bombTime <= 30 ? 100 : 70; }
  if (state.mission === 3 && gapActive) { tension = 0.85; hb = 110; }
  if (chaseActive) { tension = 0.8; hb = 105; }
  setTension(tension);
  soundTick(dt, { moving, heartbeatBpm: hb });
  // Dam roar: loud near the dam, quieter at the platform, muffled
  // underground in the valve room. Only while Mission 1 is active and
  // the dam ambient is playing; Missions 2 and 3 switch ambients and
  // the level resets to full on the switch, so this never runs there.
  if (state.mission === 1) {
    try {
      let lvl;
      if (inValveRoom) lvl = 0.2;
      else {
        const d = dist2D(camera.position.x, camera.position.z, DAM_X, DAM_Z);
        lvl = Math.max(0.15, Math.min(1.0, 1.15 - d * 0.04));
      }
      if (Math.abs(lvl - lastDamLevel) > 0.02) { lastDamLevel = lvl; setAmbientLevel(lvl); }
    } catch (e) { /* sound is best effort, never break the frame */ }
  }
  updateDeckChase(dt); // Verrazzano deck chase, no-op when inactive
  // Third-person: show the player avatar and put the camera behind it.
  {
    const mv2 = moveDelta(keys, state.yaw, 1);
    applyPlayerPresence({ scene, camera, x: camera.position.x, z: camera.position.z, yaw: state.yaw, pitch: state.pitch, moving, moveDx: mv2.dx, moveDz: mv2.dz, dt, t, eyeY: state.mission === 3 ? 1.9 : 1.7, camBounds });
  }
  updatePressureGauges(dt, t); // valve-room gauges: needles ease to the live pressure, sight-glass water flows
  renderer.render(scene, camera);
}
animate();
// ---------- Boot ----------
buildMission1();
buildMission2();
buildMission3();
setObjectives(OBJ1, 0); updateHUD(); initVoiceUI();
initSoundUI(); // procedural sound: ambient, effects, score, sound toggle
setAmbient('dam'); // the dam: the roar of water flowing, loud near the dam
setTension(0.15);
// Wire the wallet Connect button. Act I and Act III call initZamaUI on
// their own boot, but Act II boots standalone when the player resumes
// here (or loads ?act=2) and game.js is never imported, so without this
// the Connect button has no handler and clicking it does nothing.
initZamaUI();
loadHumans();
