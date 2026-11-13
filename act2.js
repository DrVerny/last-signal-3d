import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { canvas, renderer, disposeScene } from './core.js';
import { speakLine, stopSpeaking, initVoiceUI } from './speak.js';
import { registerHumans, updateSpeakingGestures } from './gestures.js';
import { registerLipSyncHumans } from './lipsync.js';
import { initSoundUI, setAmbient, setTension, soundTick, sfxRepair, sfxTick, sfxPowerRestored, sfxBoom, sfxThud, sfxWhoosh } from './sound.js';
import { runQTE, runHoldQTE } from './qte.js';
import { initZamaUI } from './zama.js';
import { showActionBanner, hideActionBanner, flashScreen, dist2D, makeActionMarker, showBriefing, makePedestrian, updatePedestrian, makeCrowd } from './action.js';
import { grantPayout, openStore, getEquippedCarDef } from './economy.js';
import { moveDelta, applyPlayerPresence, beginPlayerFrame, buildCar, buildPlayerCar, hasKey, giveKey, getAvatar, setAvatarPose, detachAvatar, getZoom } from './player.js';
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
  'Reach the Rondout control station - talk to Caleb',
  'Enter the valve room through the station door',
  'Balance the pressure: all three lines to 70% or more',
  'Choose which line runs reduced for 2 hours',
  'Find the sabotage device - who built it?'
];
const OBJ2 = [
  'Get past the guards - Caleb talks, Jade feeds him the jargon',
  'Find the key card and the passphrase',
  'Reroute the load before the logic bomb trips at 8:00 PM',
  'Read what was left on the wall'
];
const OBJ3 = [
  'Climb the maintenance catwalk to the upper deck',
  'Cross the gap - Caleb freezes',
  'Face Derrick Shaw on the bridge',
  'Bring him down without breaking the bridge'
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
function showDialogue(lines, cb) {
  dlgQueue = lines.slice(); dlgCb = cb || null; nextLine();
}
function nextLine() {
  const box = document.getElementById('dialogue');
  if (!dlgQueue.length) { box.classList.add('hidden'); stopSpeaking(); if (dlgCb) { const f = dlgCb; dlgCb = null; f(); } return; }
  const line = dlgQueue.shift(); box.classList.remove('hidden');
  document.getElementById('dlgName').textContent = line.who;
  document.getElementById('dlgText').textContent = line.text;
  speakLine(line.who, line.text);
  const ch = document.getElementById('dlgChoices'); ch.innerHTML = '';
  const next = document.getElementById('dlgNext');
  if (line.choices) {
    next.style.display = 'none';
    line.choices.forEach(c => {
      const b = document.createElement('button'); b.textContent = c.label;
      b.onclick = () => { if (c.effect) c.effect(); nextLine(); };
      ch.appendChild(b);
    });
  } else { next.style.display = 'inline-block'; }
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
function signTexture(text, bg, fg, sub) {
  return canvasTexture(512, 128, (ctx, w, h) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg; ctx.font = 'bold 52px Arial'; ctx.textAlign = 'center'; ctx.fillText(text, w / 2, 62);
    if (sub) { ctx.font = '26px Arial'; ctx.fillText(sub, w / 2, 102); }
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
function gaugeTexture(label) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#10141a'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(128, 140, 90, Math.PI * 0.85, Math.PI * 2.15); ctx.stroke();
    ctx.fillStyle = '#ffd166'; ctx.font = 'bold 24px Arial'; ctx.textAlign = 'center'; ctx.fillText(label, 128, 220);
    ctx.textAlign = 'left';
  });
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
const mission2 = new THREE.Group(); scene.add(mission2); mission2.visible = false;
const mission3 = new THREE.Group(); scene.add(mission3); mission3.visible = false;
// Camera bounds per mission (x/z clamp + default view).
const VIEWS = {
  1: { pos: [0, 1.7, 8], yaw: 0, x: [-8, 8], z: [-6, 12] },
  2: { pos: [0, 1.7, 9], yaw: 0, x: [-9, 9], z: [-6, 12] },
  3: { pos: [0, 2.2, 10], yaw: 0, x: [-1.2, 1.2], z: [-14, 12] }
};
let camBounds = VIEWS[1];
// The valve room inside the control station: the player enters through
// the station door and walks to the valves. A separate bounds box, so
// WASD stays inside the room while he is in there.
const VALVE_ROOM_BOUNDS = { pos: [0, 1.7, -2], yaw: 0, x: [-3.4, 3.4], z: [-5.4, -1.4] };
let inValveRoom = false;
let stationDoorLockedAt = -10; // throttle for the "locked" toast at the door
function resetView() {
  if (!actActive) return;
  if (inValveRoom) {
    camera.position.set(VALVE_ROOM_BOUNDS.pos[0], VALVE_ROOM_BOUNDS.pos[1], VALVE_ROOM_BOUNDS.pos[2]);
    state.yaw = VALVE_ROOM_BOUNDS.yaw; state.pitch = 0; camBounds = VALVE_ROOM_BOUNDS;
    return;
  }
  const v = VIEWS[state.mission];
  camera.position.set(v.pos[0], v.pos[1], v.pos[2]);
  state.yaw = v.yaw; state.pitch = 0; camBounds = v;
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
  state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch));
  lx = e.clientX; ly = e.clientY;
});
function endDrag() { dragging = false; }
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
addEventListener('pointerup', endDrag);
addEventListener('blur', endDrag);
const keys = {};
addEventListener('keydown', e => { if (!actActive) return; keys[e.key.toLowerCase()] = true; if (e.key.toLowerCase() === 'r') resetView(); });
addEventListener('keyup', e => { if (!actActive) return; keys[e.key.toLowerCase()] = false; });
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
  group.position.set(x, 0, z); group.rotation.y = faceYaw;
  group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  humans.push({ group, name, baseScale, phase: Math.random() * 6 });
  humanGroups.push(group); modelGroups[name] = { group };
  return group;
}
async function loadHumans() {
  const loadingText = document.getElementById('loadingText');
  const loadingError = document.getElementById('loadingError');
  const loadingContinue = document.getElementById('loadingContinue');
  const loader = new GLTFLoader();
  const failures = [];
  try {
    loadingText.textContent = 'Loading characters... Jade';
    const jade = await loader.loadAsync('models/jade.glb');
    const jg = jade.scene; jg.name = 'jade';
    const jb = new THREE.Box3().setFromObject(jg); const js = new THREE.Vector3(); jb.getSize(js);
    const jscale = 1.70 / js.y; jg.scale.setScalar(jscale);
    const jb2 = new THREE.Box3().setFromObject(jg); jg.position.y = -jb2.min.y;
    mission1.add(jg); placeHuman(jg, 'jade', -2.8, 6, Math.PI, jscale);
  } catch (e) { failures.push('jade'); }
  let calebBase = null;
  try {
    loadingText.textContent = 'Loading characters... Caleb';
    const caleb = await loader.loadAsync('models/caleb.glb');
    const cg = caleb.scene; cg.name = 'caleb';
    const cb = new THREE.Box3().setFromObject(cg); const cs = new THREE.Vector3(); cb.getSize(cs);
    const cscale = 1.88 / cs.y; cg.scale.setScalar(cscale);
    const cb2 = new THREE.Box3().setFromObject(cg); cg.position.y = -cb2.min.y;
    // Navy recolour + cap + badge, as in Act I.
    const navy = new THREE.MeshStandardMaterial({ color: 0x1a3a5a, roughness: 0.85, metalness: 0.02 });
    cg.traverse(o => { if (o.isMesh && o.material && o.material.name && o.material.name.indexOf('casualsuit') !== -1) o.material = navy; });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x16283f, roughness: 0.7 });
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.13, 0.07, 16), capMat);
    crown.position.set(0, 1.81, 0); crown.castShadow = true; cg.add(crown);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.012, 0.1), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.3 }));
    brim.position.set(0, 1.775, 0.13); cg.add(brim);
    const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.01, 12), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.25 }));
    badge.rotation.x = Math.PI / 2; badge.position.set(-0.09, 1.32, 0.17); cg.add(badge);
    calebBase = { group: cg, scale: cscale };
    mission1.add(cg); placeHuman(cg, 'caleb', 2.8, 6, Math.PI, cscale);
  } catch (e) { failures.push('caleb'); }
  // Derrick Shaw and the two substation guards reuse Caleb's scan with new
  // coats (cloned groups, recoloured materials) - a prototype stand-in, the
  // script's Derrick is a man in his 60s in a dark suit.
  if (calebBase) {
    const grey = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.85, metalness: 0.02 });
    const derrick = calebBase.group.clone(true);
    derrick.name = 'derrick';
    derrick.traverse(o => { if (o.isMesh && o.material && o.material.name && o.material.name.indexOf('casualsuit') !== -1) o.material = grey; });
    // Remove the cap, brim and badge cloned from Caleb (direct children of
    // the group, all sitting above y 1.0; the model's own roots sit at y 0).
    derrick.children = derrick.children.filter(c => c.position.y <= 1.0);
    mission3.add(derrick); placeHuman(derrick, 'derrick', 0, -6, 0, calebBase.scale);
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.9, metalness: 0.02 });
    for (const [gname, gx, gz] of [['guard1', -3.5, 2], ['guard2', 3.5, 2]]) {
      const g = calebBase.group.clone(true);
      g.name = gname;
      g.traverse(o => { if (o.isMesh && o.material && o.material.name && o.material.name.indexOf('casualsuit') !== -1) o.material = dark; });
      g.children = g.children.filter(c => c.position.y <= 1.0); // drop Caleb's cap, brim and badge
      mission2.add(g); placeHuman(g, gname, gx, gz, Math.PI, calebBase.scale);
      // Patrol data: the guards walk the gate line so the yard feels alive
      // and the player can see they are interactive. They patrol in x
      // around their post; after they stand down they stop where they are.
      guardPatrol.push({ group: g, baseX: gx, baseZ: gz, phase: Math.random() * 6 });
      // A pulsing gold "!" above each guard until they stand down, so the
      // player can see at a glance that the guards are the way in.
      const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: guardMarkerTex, color: 0xffd166, transparent: true, depthWrite: false }));
      marker.scale.set(0.55, 0.55, 1); marker.position.set(0, 2.35, 0); marker.name = 'guardMarker';
      g.add(marker); guardMarkers.push(marker);
    }
  }
  registerHumans(humans); // speaking gestures use the loaded models
  registerLipSyncHumans(humans); // jaw morph lip-sync uses the same loaded models
  if (failures.length) {
    loadingError.classList.remove('hidden');
    loadingError.textContent = 'Could not load: ' + failures.join(', ') + '. The game can still start without them.';
    loadingContinue.classList.remove('hidden');
    loadingContinue.onclick = () => { document.getElementById('loading').classList.add('hidden'); startMission1(); };
    loadingText.textContent = 'Some characters failed to load.';
  } else {
    document.getElementById('loading').classList.add('hidden');
    startMission1();
  }
}

// ---------- Mission 1: The Delaware Line (Rondout Reservoir) ----------
let waterMesh;
// The valve room, inside the control station (the station building is a
// solid box, so the room is built as its own enclosed space within the
// building footprint: x -4 to 4, z -6 to -1, 3.2 high). The front wall
// has a doorway that lines up with the station door outside. The player
// enters through the door, walks to a valve wheel, and the pressure
// controls open when he reaches the valves. The EXIT door takes him back
// outside to find the sabotage device.
function buildValveRoom() {
  const room = new THREE.Group(); mission1.add(room);
  const wallMat = stdMat({ color: 0x8a7a68, roughness: 0.95 });
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
  // Warm interior lights and a ceiling fixture.
  const l1 = new THREE.PointLight(0xffe0b0, 0.9, 9); l1.position.set(0, 2.8, -2.5); room.add(l1);
  const l2 = new THREE.PointLight(0xffe0b0, 0.7, 9); l2.position.set(0, 2.8, -5); room.add(l2);
  const fix = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.3), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0xffe9a8, emissiveIntensity: 1.2 }));
  fix.position.set(0, 3.15, -3.5); room.add(fix);
  // VALVE ROOM sign above the door, inside.
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('VALVE ROOM', '#2a2118', '#ffd166', 'WATER PRESSURE'), transparent: true, depthWrite: false }));
  sign.scale.set(3.2, 0.8, 1); sign.position.set(0, 2.45, -1.2); room.add(sign);
  // EXIT door in the doorway (click it to go back outside) + green EXIT sign.
  const exit = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.1, 0.08), stdMat({ color: 0x2a2118, roughness: 0.7 }));
  exit.position.set(0, 1.05, -1.08); exit.name = 'valveRoomExit'; exit.userData.clickable = true; room.add(exit);
  window._valveRoomExit = exit;
  const exitHit = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 0.5), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  exitHit.position.set(0, 1.2, -1.1); exitHit.name = 'valveRoomExit'; exitHit.userData.clickable = true; room.add(exitHit);
  window._valveRoomExitHit = exitHit;
  const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.35), new THREE.MeshStandardMaterial({ color: 0x0a3a0a, emissive: 0x2aff7a, emissiveIntensity: 0.9 }));
  exitSign.position.set(0, 2.3, -1.05); room.add(exitSign);
}
function enterValveRoom() {
  if (inValveRoom) return;
  inValveRoom = true;
  camera.position.set(VALVE_ROOM_BOUNDS.pos[0], VALVE_ROOM_BOUNDS.pos[1], VALVE_ROOM_BOUNDS.pos[2]);
  state.yaw = VALVE_ROOM_BOUNDS.yaw; state.pitch = 0; camBounds = VALVE_ROOM_BOUNDS;
  setObjectives(OBJ1, 2);
  toast('Valve room - walk up to a valve wheel to open the pressure controls. Click the green EXIT door to go back outside.');
}
function exitValveRoom() {
  if (!inValveRoom) return;
  inValveRoom = false;
  camera.position.set(0, 1.7, 2);
  state.yaw = 0; state.pitch = 0; camBounds = VIEWS[1];
  toast('Back outside the station.');
}

function buildMission1() {
  // Ground: grassy upstate field, dirt track to the station.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), stdMat({ color: 0x4a5a34, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; mission1.add(ground);
  const track = new THREE.Mesh(new THREE.PlaneGeometry(3, 24), stdMat({ color: 0x6a5a44, roughness: 1 }));
  track.rotation.x = -Math.PI / 2; track.position.set(0, 0.02, 2); track.receiveShadow = true; mission1.add(track);
  // The reservoir itself, to the left: a wide still sheet of water.
  waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 40), new THREE.MeshStandardMaterial({ color: 0x1a5a8a, roughness: 0.15, metalness: 0.3 }));
  waterMesh.rotation.x = -Math.PI / 2; waterMesh.position.set(-22, 0.05, 0); mission1.add(waterMesh);
  const shore = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 40), stdMat({ color: 0x5a5a50, roughness: 1 }));
  shore.position.set(-7, 0.2, 0); mission1.add(shore);
  // Control station: aging brick building with a pitched roof.
  box(mission1, 9, 3.6, 5.5, 0x7a4a3a, 0, 1.8, -3.5, null, { roughness: 0.95 });
  const roof1 = box(mission1, 9.6, 0.18, 3.2, 0x3a3a3a, 0, 3.9, -4.9);
  roof1.rotation.x = 0.35;
  const roof2 = box(mission1, 9.6, 0.18, 3.2, 0x3a3a3a, 0, 3.9, -2.1);
  roof2.rotation.x = -0.35;
  window._stationDoor = box(mission1, 1.2, 2.2, 0.15, 0x2a2118, 0, 1.1, -0.68, 'stationDoor');
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
  // stuck at the locked door.
  const keyGroup = new THREE.Group();
  const keyRing = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 8, 20), new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.3, metalness: 0.8 }));
  keyRing.position.set(0, 0.1, 0); keyGroup.add(keyRing);
  const keyStem = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.03), new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.3, metalness: 0.8 }));
  keyStem.position.set(0.05, -0.08, 0); keyGroup.add(keyStem);
  const keyTooth = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.03), new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.3, metalness: 0.8 }));
  keyTooth.position.set(0.09, -0.16, 0); keyGroup.add(keyTooth);
  const keyGlow = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.18 }));
  keyGroup.add(keyGlow);
  keyGroup.position.set(1.5, 1.5, -0.6);
  keyGroup.name = 'stationKey'; keyGroup.userData.clickable = true;
  keyGroup.userData.keyId = 'station'; keyGroup.userData.keyLabel = 'station key';
  mission1.add(keyGroup);
  window._stationKey = keyGroup;
  const keyLabel = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9 }));
  keyLabel.position.set(1.5, 1.95, -0.6); keyLabel.name = 'stationKeyLabel'; mission1.add(keyLabel);
  window._stationKeyLabel = keyLabel;
  for (const wx of [-3, 3]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1), new THREE.MeshStandardMaterial({ color: 0x0e1a24, roughness: 0.1, metalness: 0.4 }));
    win.position.set(wx, 2, -0.72); mission1.add(win);
  }
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('RONDOUT RESERVOIR', '#2a2118', '#ffd166', 'CONTROL STATION'), transparent: true, depthWrite: false }));
  sign.scale.set(5, 1.25, 1); sign.position.set(0, 4.6, -3.2); mission1.add(sign);
  // The valve room, inside the control station: the player enters through
  // the station door and walks to the valves. The three valve assemblies
  // live on the back wall of the room, not outside on a plinth, so the
  // valve puzzle only opens once he has walked in to reach them.
  buildValveRoom();
  const valveDefs = [
    { key: 'hospital', label: 'HOSPITAL', color: 0x7ac74f, x: -3 },
    { key: 'residential', label: 'RESIDENTIAL', color: 0x4cc9f0, x: 0 },
    { key: 'industrial', label: 'INDUSTRIAL', color: 0xffd166, x: 3 }
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
    for (let s = 0; s < 3; s++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.8, 0.05), stdMat({ color: v.color, roughness: 0.5 }));
      spoke.position.copy(wheel.position); spoke.rotation.z = s * Math.PI / 3; mission1.add(spoke);
    }
    const gauge = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ map: gaugeTexture(v.label), roughness: 0.6 }));
    gauge.position.set(v.x, 2.3, -5.85); mission1.add(gauge);
    const lbl = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(v.label, '#111111', '#e8e8e8', ''), transparent: true, depthWrite: false }));
    lbl.scale.set(2.2, 0.55, 1); lbl.position.set(v.x, 2.9, -5.7); mission1.add(lbl);
  }
  // A long main pipe along the back wall, joining the three valves.
  const mainPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 7.5, 12), stdMat({ color: 0x6a747a, metalness: 0.8, roughness: 0.35 }));
  mainPipe.rotation.z = Math.PI / 2; mainPipe.position.set(0, 0.4, -5.85); mainPipe.castShadow = true; mission1.add(mainPipe);
  // Digital control panel, cracked screen, red warning light - sabotaged.
  const panel = box(mission1, 1.6, 2, 0.5, 0x2a2f33, 5.2, 1.2, -1, 'digitalPanel', { roughness: 0.5, metalness: 0.4 });
  panel.rotation.y = -0.5;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.9), new THREE.MeshStandardMaterial({ color: 0x1a0505, emissive: 0xff2222, emissiveIntensity: 0.8, roughness: 0.3 }));
  screen.position.set(5.0, 1.5, -0.72); screen.rotation.y = -0.5; mission1.add(screen);
  const warnGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xff2222, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  warnGlow.scale.set(1.6, 1.6, 1); warnGlow.position.set(5.0, 2.4, -0.7); mission1.add(warnGlow);
  // Sabotage device (hidden until the water is stable): small green board on the station wall.
  const dev = box(mission1, 0.35, 0.25, 0.05, 0x7ac74f, -2.2, 1.4, -0.7, 'device1');
  dev.rotation.y = 0; dev.visible = false;
  window._device1 = dev;
  // Generous invisible click target for the small device, same reason as the valves.
  const devHit = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 0.8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  devHit.position.set(-2.2, 1.4, -0.5); devHit.name = 'device1'; devHit.userData.clickable = true; devHit.visible = false; mission1.add(devHit);
  window._device1Hit = devHit;
  blobShadow(mission1, -2.8, 6, 0.9, 0.9, 0.55);
  blobShadow(mission1, 2.8, 6, 0.9, 0.9, 0.55);
}
// Valve-balance puzzle (Mission 1).
const pressures = { hospital: 60, residential: 60, industrial: 60 };
let valveTimer = null, stableHold = 0, valveOpen = false;
function renderValve() {
  const map = { hospital: 'Hosp', residential: 'Res', industrial: 'Ind' };
  for (const k of Object.keys(pressures)) {
    document.getElementById('press' + map[k]).style.width = pressures[k] + '%';
    document.getElementById('press' + map[k] + 'Val').textContent = pressures[k] + '%';
  }
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
      toast('Pressure holding - the aqueduct is stable. Head back outside - something on the station wall catches your eye.');
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
  ], () => { setObjectives(OBJ1, 4); toast('Click the small green circuit board on the station wall - it is outside, so leave the valve room first if you are still in it.'); });
}
function startMission1() {
  resetView();
  setTimeOfDay('day'); // Mission 1 (aqueduct) is bright day.
  currentPlaceKey = 'reservoir';
  // If the player already has the station key (a replay), the key
  // mesh beside the door is hidden so it cannot be picked up twice.
  try {
    const hasIt = hasKey('station');
    if (window._stationKey) window._stationKey.visible = !hasIt;
    if (window._stationKeyLabel) window._stationKeyLabel.visible = !hasIt;
  } catch (e) { /* ignore */ }
  setObjectives(OBJ1, 0); updateHUD();
  document.getElementById('timerLabel').textContent = 'Water pressure';
  document.getElementById('timerVal').textContent = 'dropping 2%/hr';
  document.getElementById('timerBar').style.width = '80%';
  // Every mission starts with a briefing: who asked, what is wrong, and
  // what is at stake. The phone call (Act I) covered the first mission;
  // this is the reason for Mission 1.
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
}

// ---------- Mission 2: The Grid (Con Edison substation) ----------
let keycardMesh, logbookMesh, scadaMesh, manifestoMesh, bombInterval = null, bombTime = 90;
let scadaQteDone = false; // the surge quick-time fires once per SCADA open
const feeders = { A: 33, B: 33, C: 34 };
let hasKeycard = false, hasPassphrase = false, guardsDown = false;
function buildMission2() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), stdMat({ color: 0x3a3f42, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; mission2.add(ground);
  // Chain-link fence around the yard: posts + translucent mesh panels.
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x8a949a, roughness: 0.4, metalness: 0.7, transparent: true, opacity: 0.35 });
  for (const z of [-6, 12]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(20, 3), fenceMat);
    f.position.set(0, 1.5, z); if (z === 12) f.rotation.y = Math.PI; mission2.add(f);
  }
  for (const x of [-10, 10]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(18, 3), fenceMat);
    f.position.set(x, 1.5, 3); f.rotation.y = Math.PI / 2; mission2.add(f);
  }
  for (let x = -10; x <= 10; x += 2.5) for (const z of [-6, 12]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 8), stdMat({ color: 0x6a747a, metalness: 0.8, roughness: 0.4 }));
    p.position.set(x, 1.5, z); mission2.add(p);
  }
  // Two transformers with insulator stacks.
  for (const tx of [-4, 4]) {
    box(mission2, 3, 2.6, 2, 0x4a5a3a, tx, 1.3, -2, null, { roughness: 0.7, metalness: 0.4 });
    for (let i = 0; i < 3; i++) {
      const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.1, 10), stdMat({ color: 0xb8b0a0, roughness: 0.6 }));
      ins.position.set(tx - 0.8 + i * 0.8, 3.1, -2); ins.castShadow = true; mission2.add(ins);
    }
    const hum = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xffc978, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false }));
    hum.scale.set(3, 2, 1); hum.position.set(tx, 2, -2); mission2.add(hum);
  }
  // Control room building + SCADA terminal + log book.
  box(mission2, 7, 3.2, 4.5, 0x5a5a55, 0, 1.6, -4.5, null, { roughness: 0.95 });
  box(mission2, 1.4, 2.4, 0.15, 0x2a2118, -2, 1.2, -2.2, 'controlDoor');
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
  // Key card on the first guard's belt (hidden until the guards stand down).
  keycardMesh = box(mission2, 0.16, 0.1, 0.02, 0xf2f2f2, -3.5, 1.0, 2.15, 'keycard');
  keycardMesh.visible = false;
  // The card is tiny: a generous invisible hit box around the guard's belt.
  var keycardHit = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 0.8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  keycardHit.position.set(-3.5, 1.1, 2.1); keycardHit.name = 'keycard'; keycardHit.userData.clickable = true; keycardHit.visible = false; mission2.add(keycardHit);
  window._keycardHit = keycardHit;
  blobShadow(mission2, -3.5, 2, 0.9, 0.9, 0.55);
  blobShadow(mission2, 3.5, 2, 0.9, 0.9, 0.55);
  // The living city around the yard: the substation sits in Long Island
  // City, so beyond the north fence there is a road with moving cars,
  // houses, an elevated train track with a passing train, and the
  // Manhattan skyline. The fence is translucent, so all of it reads
  // from inside the yard and the scene stops feeling like an empty lot.
  buildCityEnvironment();
}

// ---------- Living city around the substation (Mission 2) ----------
// Animated: cityCars drive the road, cityTrain runs the elevated track,
// cityPedestrians walk the sidewalks, and the traffic jam honks.
const cityCars = [];
const cityPedestrians = [];
const jamCars = [];
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
  // The traffic hold-up: a line of cars stopped bumper to bumper in the
  // east lane, going nowhere, horns sounding. They are static (not in
  // cityCars) - the jam is the point.
  for (let i = 0; i < 5; i++) {
    const jc = makeStreetCar(parkCols[i % parkCols.length]);
    jc.position.set(-2 + i * 2.7, 0, -9.0);
    mission2.add(jc);
    jamCars.push(jc);
  }
  // Cars: two lanes, one each way. Realistic cars (see player.js
  // buildCar), not boxes, with a shaped body, glass cabin, wheels,
  // headlights and taillights.
  const carColors = [0xc0392b, 0x2e6fb0, 0xd8d8d8, 0x3a3a3a, 0xc07a1a, 0x5a7a3a];
  for (let i = 0; i < 6; i++) {
    const east = i % 2 === 0; // even cars go east (+x) on the near lane
    const col = carColors[i % carColors.length];
    const car = buildCar(col, { type: 'sedan' });
    car.position.set(-40 + i * 14 + Math.random() * 6, 0, east ? -9.0 : -11.0); // car lanes, inside the bike lanes
    if (!east) car.rotation.y = Math.PI; // face the direction of travel
    mission2.add(car);
    cityCars.push({ group: car, speed: (5.5 + Math.random() * 3) * (east ? 1 : -1) });
  }
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
  for (let i = 0; i < 7; i++) {
    const hx = -30 + i * 10 + (Math.random() * 3 - 1.5);
    const h = new THREE.Group();
    const houseMat = whiteFacadeMat(4, 2, 0.5);
    const base = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 4.5), houseMat);
    base.position.y = 1.3; base.castShadow = true; h.add(base);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.15, 4.7), stdMat({ color: 0xe8ecef, roughness: 0.9 }));
    roof.position.y = 2.65; roof.castShadow = true; h.add(roof);
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
  // Manhattan skyline in the far background (z = -26 to -40): tall white
  // modern towers with rows of windows, like the hospital in the photo,
  // hazed by the fog so the city reads at a distance. Windows glow at dusk.
  const skyTexA = whiteFacadeTexture(6, 12, 0.5);
  const skyTexB = whiteFacadeTexture(6, 12, 0.35);
  for (let i = 0; i < 10; i++) {
    const w = 6 + Math.random() * 5, h = 14 + Math.random() * 18, d = 6 + Math.random() * 4;
    const tex = i % 2 === 0 ? skyTexA : skyTexB;
    const side = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.85 });
    const pale = stdMat({ color: 0xe8ecef, roughness: 0.9 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, pale, pale, side, side]);
    b.position.set(-42 + i * 9.5 + (Math.random() * 3 - 1.5), h / 2, -28 - Math.random() * 12);
    mission2.add(b);
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
  reservoir: { name: 'Rondout Reservoir', short: 'Reservoir', x: 0.10, y: 0.15, desc: 'Upstate New York - the Delaware Line', type: 'mission', mission: 1 },
  hospital: { name: 'City Hospital', short: 'Hospital', x: 0.42, y: 0.10, desc: 'City hospital - north side', type: 'visit', kind: 'hospital' },
  industry: { name: 'Industrial Area', short: 'Industry', x: 0.88, y: 0.16, desc: 'Water treatment plant', type: 'visit', kind: 'industry' },
  mansion: { name: 'The Mansion', short: 'Mansion', x: 0.90, y: 0.48, desc: 'Your mansion - Long Island', type: 'home', kind: 'mansion' },
  dealership: { name: 'Car Dealership', short: 'Dealership', x: 0.66, y: 0.38, desc: 'Buy cars - Queens', type: 'store', tab: 'cars' },
  clothing: { name: 'Clothing Store', short: 'Clothing', x: 0.48, y: 0.42, desc: 'Buy clothes - Manhattan', type: 'store', tab: 'clothes' },
  substation: { name: 'Con Edison Substation', short: 'Substation', x: 0.60, y: 0.60, desc: 'Long Island City, Queens', type: 'mission', mission: 2 },
  safehouse: { name: 'Safe House Apartment', short: 'Safe House', x: 0.74, y: 0.74, desc: 'Your safe house - Brooklyn', type: 'home', kind: 'safehouse' },
  bridge: { name: 'Verrazzano Bridge', short: 'Bridge', x: 0.86, y: 0.86, desc: 'Verrazzano-Narrows, tonight', type: 'mission', mission: 3 },
  airport: { name: 'Airport', short: 'Airport', x: 0.08, y: 0.85, desc: 'JFK - flights out', type: 'visit', kind: 'airport' },
  hotels: { name: 'Hotels', short: 'Hotels', x: 0.55, y: 0.25, desc: 'A hotel suite - Midtown', type: 'home', kind: 'hotel' },
  terminal: { name: 'Train Terminal', short: 'Train Terminal', x: 0.30, y: 0.55, desc: 'Grand Central - board the 4 train', type: 'home', kind: 'terminal' },
  carpark: { name: 'Car Park', short: 'Car Park', x: 0.35, y: 0.75, desc: 'Parking lot - Midtown South', type: 'visit', kind: 'carpark' }
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
  'hotels>terminal': 10, 'hotels>carpark': 16, 'terminal>carpark': 9
};
function getMiles(a, b) {
  if (a === b) return 0;
  return DISTANCES[a + '>' + b] || DISTANCES[b + '>' + a] || 10;
}
const MISSION_PLACE = { 1: 'reservoir', 2: 'substation', 3: 'bridge' };
const MISSION_TIME = { 1: 'day', 2: 'dusk', 3: 'night' };
let travelActive = false, travelT = 0, travelDur = 18, travelOnArrive = null, travelGroup = null, travelCars = [], travelPedestrians = [];
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
let mapFromKey = 'reservoir', mapSelectedKey = null, pendingMission = null;
let currentPlaceKey = 'reservoir';
let missionsDone = { 1: false, 2: false, 3: false };
let travelWindowMats = [];
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
    sun.intensity = 0.5; sun.color.set(0xff8a3c); sun.position.set(-14, 6, 8);
    moon.intensity = 0.15;
    hemi.intensity = 0.25; hemi.color.set(0x8a6a9a); hemi.groundColor.set(0x3a2a22);
    ambient.intensity = 0.25;
  } else { // night
    scene.background.set(0x05070a);
    scene.fog.color.set(0x05070a); scene.fog.density = 0.012;
    sun.intensity = 0.08; sun.color.set(0xfff2d8); sun.position.set(12, 20, 8);
    moon.intensity = 0.9;
    hemi.intensity = 0.15; hemi.color.set(0x9db8d4); hemi.groundColor.set(0x2a2418);
    ambient.intensity = 0.12;
  }
}

function buildTravelScene() {
  if (travelGroup) return travelGroup;
  travelGroup = new THREE.Group();
  travelGroup.visible = false;
  scene.add(travelGroup);
  // A long road running forward (-z). The camera drives along it. The
  // street looks like the photo: a GREEN TILED road (hexagonal tiles),
  // green bike lanes with bicycle symbols, "MAIN ST" painted on it,
  // parked cars on both sides, trees lining the street, shops with
  // awnings, and a white striped crosswalk.
  const roadTex = hexTileTexture();
  roadTex.repeat.set(2, 70);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 320), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0.02, -160); road.receiveShadow = true; travelGroup.add(road);
  for (let z = -4; z >= -316; z -= 8) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 3), new THREE.MeshBasicMaterial({ color: 0xd8b13a }));
    dash.rotation.x = -Math.PI / 2; dash.position.set(0, 0.04, z); travelGroup.add(dash);
  }
  // Green bike lanes along both edges of the road, with bicycle symbols.
  const bikeTex = bikeSymbolTexture();
  for (const x of [-3.6, 3.6]) {
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 320), stdMat({ color: 0x2e7a4a, roughness: 0.95 }));
    lane.rotation.x = -Math.PI / 2; lane.position.set(x, 0.04, -160); travelGroup.add(lane);
  }
  for (const x of [-3.6, 3.6]) for (let z = -30; z >= -300; z -= 60) {
    const sym = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: bikeTex, transparent: true, opacity: 0.85, depthWrite: false }));
    sym.rotation.x = -Math.PI / 2; sym.rotation.z = Math.PI / 2; sym.position.set(x, 0.05, z); travelGroup.add(sym);
  }
  // "MAIN ST" painted on the road, every so often.
  const mainTex = mainStTexture();
  for (const z of [-40, -140, -240]) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: mainTex, transparent: true, opacity: 0.9, depthWrite: false }));
    t.rotation.x = -Math.PI / 2; t.rotation.z = Math.PI / 2; t.position.set(0, 0.05, z); travelGroup.add(t);
  }
  // A white striped crosswalk across the road.
  for (let i = 0; i < 6; i++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 8.4), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }));
    stripe.rotation.x = -Math.PI / 2; stripe.position.set(-2.9 + i * 1.15, 0.05, -100); travelGroup.add(stripe);
  }
  // Parked cars along both curbs, trees lining the sidewalks.
  const parkCols = [0xc0392b, 0x2e6fb0, 0xd8d8d8, 0x3a3a3a, 0xc07a1a, 0x5a7a3a];
  for (let z = -24; z >= -300; z -= 28) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.4) continue;
      const pc = makeStreetCar(parkCols[Math.floor(Math.random() * parkCols.length)]);
      pc.position.set(side * 3.9, 0, z);
      pc.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      travelGroup.add(pc);
    }
  }
  for (let z = -18; z >= -300; z -= 24) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.3) continue;
      const tree = makeStreetTree();
      tree.position.set(side * 6.2, 0, z); travelGroup.add(tree);
    }
  }
  // Pedestrians on the sidewalks, walking along the street in both
  // directions, like the plaza video. They scroll past as the car drives.
  const driveCrowd = makeCrowd({ count: 10, lane: { axis: 'z', fixed: 5.6, min: -310, max: 0 } });
  const driveCrowd2 = makeCrowd({ count: 10, lane: { axis: 'z', fixed: -5.6, min: -310, max: 0 } });
  for (const p of [...driveCrowd, ...driveCrowd2]) { travelGroup.add(p.group); travelPedestrians.push(p); }
  // Buildings on both sides, scrolling past as the camera drives.
  // Clean white modern style with rows of windows, like the hospital in
  // the photo. The window glow is turned up at dusk/night and down in
  // daylight by setTimeOfDay (the materials are kept in travelWindowMats).
  const winTex = whiteFacadeTexture(6, 12, 0.4);
  for (let z = -10; z >= -310; z -= 14) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.25) continue; // gaps so the street breathes
      const h = 8 + Math.random() * 16;
      const sideMat = new THREE.MeshStandardMaterial({ map: winTex, emissiveMap: winTex, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.85 });
      travelWindowMats.push(sideMat);
      const pale = stdMat({ color: 0xe8ecef, roughness: 0.9 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(7 + Math.random() * 4, h, 8), [sideMat, sideMat, pale, pale, sideMat, sideMat]);
      b.position.set(side * (11 + Math.random() * 5), h / 2, z + (Math.random() * 4 - 2));
      travelGroup.add(b);
      // A shop awning on the ground floor of the lower buildings, facing
      // the road, so the street reads as shops, not blank towers.
      if (h < 14 && Math.random() < 0.6) {
        const awn = makeShopAwning([0xc0392b, 0x2e6fb0, 0x2e7a4a, 0xc07a1a][Math.floor(Math.random() * 4)], null);
        awn.position.set(side * (11 + Math.random() * 5) - side * 4, 0, z + (Math.random() * 4 - 2));
        awn.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        travelGroup.add(awn);
      }
    }
    // Streetlights.
    if (Math.random() < 0.7) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5, 8), stdMat({ color: 0x6a747a, metalness: 0.8, roughness: 0.4 }));
      pole.position.set(5.2, 2.5, z); travelGroup.add(pole);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
      lamp.position.set(5.2, 5, z); travelGroup.add(lamp);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xffe9a8, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.set(3, 3, 1); glow.position.set(5.2, 5, z); travelGroup.add(glow);
    }
  }
  // Landmark on the drive: a tall white hospital tower with a rounded
  // corner and rows of windows, like the photo, plus a lower white wing.
  // It stands out from the other buildings so the city reads as the photo.
  const towerMat = whiteFacadeMat(6, 14, 0.4);
  travelWindowMats.push(towerMat);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(10, 22, 6), towerMat);
  tower.position.set(16, 11, -150); tower.castShadow = true; travelGroup.add(tower);
  const towerCorner = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 22, 20), stdMat({ color: 0xf4f6f8, roughness: 0.85 }));
  towerCorner.position.set(11, 11, -147); towerCorner.castShadow = true; travelGroup.add(towerCorner);
  const wingMat = whiteFacadeMat(8, 3, 0.4);
  travelWindowMats.push(wingMat);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 5), wingMat);
  wing.position.set(18, 2.5, -141); wing.castShadow = true; travelGroup.add(wing);
  // The city pieces the player asked for: a gas station and a police
  // station, so the drive passes a real city, not just towers.
  // Gas station (west side, z = -90): a low white kiosk, a canopy on
  // pillars, pumps, and a GAS sign.
  const gasKiosk = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 4), whiteFacadeMat(3, 1, 0.3));
  gasKiosk.position.set(-15, 1.5, -90); travelGroup.add(gasKiosk);
  const gasCanopy = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 7), stdMat({ color: 0xc0392b, roughness: 0.7 }));
  gasCanopy.position.set(-15, 4.2, -96); travelGroup.add(gasCanopy);
  for (const [px, pz] of [[-17, -95], [-13, -95]]) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4.2, 8), stdMat({ color: 0xd8d8d8, metalness: 0.6, roughness: 0.4 }));
    pillar.position.set(px, 2.1, pz); travelGroup.add(pillar);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.5), stdMat({ color: 0xd8d8d8, roughness: 0.5 }));
    pump.position.set(px, 0.6, pz + 1.5); travelGroup.add(pump);
  }
  const gasSign = makeTextSprite('GAS', '#ffd166'); gasSign.scale.set(4, 1, 1); gasSign.position.set(-15, 5.6, -93); travelGroup.add(gasSign);
  // Police station (east side, z = -200): a white modern block with a
  // POLICE sign and two police cars parked in front.
  const policeMat = whiteFacadeMat(6, 3, 0.4);
  const policeB = new THREE.Mesh(new THREE.BoxGeometry(9, 6, 6), policeMat);
  policeB.position.set(15, 3, -200); travelGroup.add(policeB);
  const policeSign = makeTextSprite('POLICE', '#7fb0ff'); policeSign.scale.set(5, 1.1, 1); policeSign.position.set(15, 7, -197); travelGroup.add(policeSign);
  for (const pz of [-196, -203]) {
    const pc = makeStreetCar(0xf2f2f2);
    pc.position.set(9, 0, pz); pc.rotation.y = Math.PI / 2; travelGroup.add(pc);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.2), new THREE.MeshBasicMaterial({ color: 0x2a6ab0 }));
    bar.position.set(9, 1.3, pz); travelGroup.add(bar);
  }
  // Traffic: cars coming the other way and cars ahead in our lane.
  // Realistic cars (see player.js buildCar), not boxes.
  const carCols = [0xc0392b, 0x2e6fb0, 0xd8d8d8, 0xc07a1a];
  for (let i = 0; i < 8; i++) {
    const oncoming = i % 2 === 0;
    const car = buildCar(carCols[i % carCols.length], { type: 'sedan' });
    car.position.set(oncoming ? -2.2 : 2.2, 0, -20 - i * 36 - Math.random() * 10);
    if (!oncoming) car.rotation.y = Math.PI;
    travelGroup.add(car);
    travelCars.push({ group: car, speed: oncoming ? 14 : 4 });
  }
  // Sync the window glow to the current time of day (the scene is built
  // lazily on the first drive, so the materials start at the build-time
  // value and need one sync).
  setTimeOfDay(currentTimeMode);
  return travelGroup;
}

// Draw the city map on a canvas: all nine places, spread far apart, the
// route from the current place to the selected one, and a pulsing marker
// on the destination. Labels flip to the left near the right edge so they
// never run off the canvas. The map tint matches the time of day of the
// mission being headed to (day = lighter, dusk = purple, night = dark).
function drawTravelMap(canvas, fromKey, toKey) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const mode = toKey && TRAVEL_PLACES[toKey].type === 'mission' ? MISSION_TIME[TRAVEL_PLACES[toKey].mission] : (pendingMission ? MISSION_TIME[TRAVEL_PLACES[pendingMission.key].mission] : MISSION_TIME[state.mission]);
  ctx.fillStyle = mode === 'day' ? '#1a2a38' : mode === 'dusk' ? '#241a2e' : '#0d141b';
  ctx.fillRect(0, 0, W, H);
  // A few faint roads.
  ctx.strokeStyle = '#2a3540'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(0, H * 0.55); ctx.bezierCurveTo(W * 0.3, H * 0.45, W * 0.55, H * 0.6, W, H * 0.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W * 0.2, 0); ctx.bezierCurveTo(W * 0.25, H * 0.4, W * 0.5, H * 0.6, W * 0.75, H); ctx.stroke();
  ctx.strokeStyle = '#1c2630'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, H * 0.3); ctx.lineTo(W, H * 0.35); ctx.stroke();
  const from = TRAVEL_PLACES[fromKey], to = toKey ? TRAVEL_PLACES[toKey] : null;
  // Route: dashed gold line from current to destination.
  if (to) {
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.moveTo(from.x * W, from.y * H); ctx.lineTo(to.x * W, to.y * H); ctx.stroke();
    ctx.setLineDash([]);
  }
  // All nine places, spread across the map.
  for (const [key, p] of Object.entries(TRAVEL_PLACES)) {
    const x = p.x * W, y = p.y * H;
    const isFrom = key === fromKey, isTo = key === toKey;
    const st = placeStatus(key);
    ctx.fillStyle = isTo ? '#ffd166' : isFrom ? '#7fb0ff' : st === 'next' ? '#ffd166' : st === 'done' ? '#3a4a58' : st === 'locked' ? '#2a3540' : '#5a6a75';
    ctx.beginPath(); ctx.arc(x, y, isTo ? 11 : 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = mode === 'day' ? '#1a2a38' : mode === 'dusk' ? '#241a2e' : '#0d141b';
    ctx.beginPath(); ctx.arc(x, y, isTo ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
    // Labels flip to the left near the right edge so they stay on the map.
    const flip = p.x > 0.72;
    ctx.fillStyle = '#e8eef2'; ctx.font = 'bold 15px Arial'; ctx.textAlign = flip ? 'right' : 'left';
    ctx.fillText(p.short, flip ? x - 14 : x + 14, y + 5);
    ctx.fillStyle = '#8a97a3'; ctx.font = '12px Arial';
    ctx.fillText(p.desc, flip ? x - 14 : x + 14, y + 21);
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
    return 'here';
  }
  return 'open';
}
function placeDriveable(key) {
  const st = placeStatus(key);
  return st === 'next' || st === 'open';
}

// The bridge leg is a trek, not a drive: after Mission 2 the player
// walks on foot from the substation to the bridge through the busy
// street. No car for this leg, and no skip - it is a real walk.
function isTrekLeg(key) {
  return !!(pendingMission && pendingMission.key === key && key === 'bridge');
}
export function openCityMap(fromKey, preselectKey) {
  if (travelActive || window.__lsHomeActive) return;
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
      + '<div id="travelHint" style="color:#9fb8c8;font-size:12px;margin-top:8px;">Click a place on the map, then Drive. Gold = your next mission. The map shows the real miles - far places take a longer drive. The bridge leg is a trek on foot - no car, walk the busy street.</div>'
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
      else startTravelDrive(key, arriveAt(key));
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
// What happens when the drive arrives at a place.
function arriveAt(key) {
  const p = TRAVEL_PLACES[key];
  if (!p) return () => restoreMissionScene();
  if (p.type === 'mission') {
    if (pendingMission && pendingMission.key === key) {
      const fn = pendingMission.fn; pendingMission = null;
      return () => { currentPlaceKey = key; fn(); };
    }
    return () => restoreMissionScene();
  }
  if (p.type === 'store') {
    return () => { currentPlaceKey = key; openStore(p.tab, () => openCityMap(key)); };
  }
  if (p.type === 'home' || p.type === 'visit') {
    return () => {
      currentPlaceKey = key;
      if (window.__lsActManager && typeof window.__lsActManager.enterHome === 'function') window.__lsActManager.enterHome(p.kind, 'map');
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
  restoreMissionScene();
}
function restoreMissionScene() {
  mission1.visible = state.mission === 1;
  mission2.visible = state.mission === 2;
  mission3.visible = state.mission === 3;
  if (travelGroup) travelGroup.visible = false;
  if (trekGroup) trekGroup.visible = false;
  trekActive = false;
  hideDriveHood();
  hideActionBanner();
  // If the camera is far outside the mission (after a drive or a trek),
  // put it back at the mission's default view; otherwise leave it.
  const v = inValveRoom ? VALVE_ROOM_BOUNDS : VIEWS[state.mission];
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

// The drive itself: hide the missions, show the road, and drive the
// camera forward through the city in the player's own car. The banner
// names the car and counts the miles down. The drive takes longer for a
// far place, so the distance feels real. Any key or click skips to arrival.
function startTravelDrive(toKey, onArrive) {
  const to = TRAVEL_PLACES[toKey];
  buildTravelScene();
  mission1.visible = false; mission2.visible = false; mission3.visible = false;
  travelGroup.visible = true;
  travelActive = true; window.__lsTravelActive = true;
  travelT = 0; travelOnArrive = onArrive; travelToKey = toKey;
  travelMiles = getMiles(mapFromKey, toKey);
  travelLastMilesShown = -1;
  travelDur = Math.min(21, Math.max(10, 8 + travelMiles * 0.15));
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
    driveCar = buildPlayerCar();
    driveCar.rotation.y = Math.PI;
    driveCar.position.set(0, 0, 4);
    travelGroup.add(driveCar);
    const driver = getAvatar();
    try { if (driver.parent) driver.parent.remove(driver); } catch (e) { /* ignore */ }
    setAvatarPose('sit');
    driver.visible = true;
    // Driver's seat, left side, sitting in the cabin. The driver is
    // scaled to 0.72 so his head fits under the cabin roof, and the
    // cabin glass is semi-transparent (see buildCar) so he is visible
    // from the chase camera. He faces the car's forward (+z local).
    driver.position.set(-0.38, 0.02, 0.35);
    driver.rotation.set(0, 0, 0);
    driver.scale.set(0.72, 0.72, 0.72);
    driveCar.add(driver);
  } catch (e) { driveCar = null; }
  camera.position.set(0, 1.7, 4);
  state.yaw = 0; state.pitch = 0;
  showDriveHood();
  updateDriveBanner();
  const skip = () => { if (travelActive) endTravelDrive(); };
  travelGroup.userData.skip = skip;
  canvas.addEventListener('pointerdown', skip, { once: true });
  addEventListener('keydown', skip, { once: true });
}
function updateDriveBanner() {
  const to = TRAVEL_PLACES[travelToKey];
  if (!to) return;
  const car = getEquippedCarDef();
  const left = Math.max(0, Math.round(travelMiles * (1 - travelT / travelDur)));
  if (left === travelLastMilesShown) return;
  travelLastMilesShown = left;
  showActionBanner('Driving your ' + car.name + ' to ' + to.name + ' - ' + left + ' miles to go. (Click or press any key to skip)');
}
function endTravelDrive() {
  if (!travelActive) return;
  travelActive = false; window.__lsTravelActive = false;
  if (travelGroup) travelGroup.visible = false;
  hideDriveHood();
  hideActionBanner();
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
  if (travelToKey) currentPlaceKey = travelToKey;
  const cb = travelOnArrive; travelOnArrive = null; travelToKey = null;
  if (cb) cb();
}
function updateTravelDrive(dt, t) {
  if (!travelActive) return;
  travelT += dt;
  // The player's car drives forward at ~12 m/s; the road is 320 long
  // and the longest drive is 21 s (252 m), so the car stays on the road.
  // The camera follows the car from behind and above (a third-person
  // driving view), so the player sees himself driving. The camera
  // distance follows the zoom setting, so the player can pull in close
  // to the car or back out for a wider view of the road.
  const zoomDist = getZoom();
  if (driveCar) {
    driveCar.position.z -= 12 * dt;
    camera.position.set(0, 1.7 + zoomDist * 0.35 + Math.sin(t * 6) * 0.02, driveCar.position.z + zoomDist + 1.5);
    camera.lookAt(0, 1.0, driveCar.position.z - 8);
  } else {
    camera.position.z -= 12 * dt;
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
    if (c.group.position.z > 10) c.group.position.z = -310;
    if (c.group.position.z < -320) c.group.position.z = 0;
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
  // Shops with awnings on both sides, white modern fronts.
  const shopNames = ['CAFE', 'DELI', 'BAKERY', 'PHARMACY', 'FLOWERS', 'BOOKS', 'PIZZA', 'MARKET'];
  const awnCols = [0xc0392b, 0x2e6fb0, 0x2e7a4a, 0xc07a1a, 0x7a2e5a, 0x3a3a3a, 0xd8b13a, 0x2e6a7a];
  let si = 0;
  for (let z = 22; z >= -44; z -= 11) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.2) continue;
      const shop = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 6), whiteFacadeMat(3, 2, 0.4));
      shop.position.set(side * 11, 2.5, z); shop.castShadow = true; trekGroup.add(shop);
      const awn = makeShopAwning(awnCols[si % awnCols.length], shopNames[si % shopNames.length]);
      awn.position.set(side * 8.2, 0, z);
      awn.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      trekGroup.add(awn);
      si++;
    }
  }
  // Parked cars along both curbs, and trees on the sidewalks.
  const parkCols = [0xc0392b, 0x2e6fb0, 0xd8d8d8, 0x3a3a3a, 0xc07a1a, 0x5a7a3a];
  for (let z = 16; z >= -40; z -= 14) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.35) continue;
      const pc = makeStreetCar(parkCols[Math.floor(Math.random() * parkCols.length)]);
      pc.position.set(side * 3.9, 0, z);
      pc.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      trekGroup.add(pc);
    }
    if (Math.random() < 0.7) {
      const tree = makeStreetTree();
      tree.position.set((Math.random() < 0.5 ? -1 : 1) * 6.5, 0, z + 5); trekGroup.add(tree);
    }
  }
  // The traffic hold-up, here too: a line of cars stopped bumper to
  // bumper in the east lane, horns sounding, blocking the road.
  for (let i = 0; i < 5; i++) {
    const jc = makeStreetCar(parkCols[i % parkCols.length]);
    jc.position.set(-2, 0, -8 - i * 2.7);
    trekGroup.add(jc);
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
  state.yaw = 0; state.pitch = 0;
  camBounds = { x: [-4.2, 4.2], z: [-48, 32] };
  showActionBanner('TREK ON FOOT - walk to the ' + (to ? to.name : 'destination') + '. No car - walk with the crowd. Reach the gold BRIDGE marker at the end of the street.');
  toast('Trek on foot - walk the busy street to the gold marker. No car for this leg.');
}
function endTrek() {
  if (!trekActive) return;
  trekActive = false;
  if (trekGroup) trekGroup.visible = false;
  hideActionBanner();
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
  if (dist2D(camera.position.x, camera.position.z, trekDestX, trekDestZ) < 3) {
    toast('You reach the bridge approach. The Verrazzano is ahead.');
    endTrek();
  }
}

function reparentCast(name, group, x, z, yaw) {
  const g = modelGroups[name] && modelGroups[name].group;
  if (!g) return;
  if (g.parent) g.parent.remove(g);
  g.position.set(x, 0, z); g.rotation.y = yaw;
  group.add(g);
}
function startMission2() {
  mission1.visible = false; mission2.visible = true; mission3.visible = false;
  state.mission = 2; resetView();
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
  ], () => { toast('Walk up to a guard (or click one) - Caleb talks his way in.'); });
  });
}
// Hide the gold "!" markers over the guards once they stand down.
function hideGuardMarkers() { for (const m of guardMarkers) m.visible = false; }
function guardDialogue() {
  if (guardsDown) { toast('The guards have stood down. The SCADA terminal is yours.'); return; }
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
      // The guard hands over the substation gate key with the key card.
      giveKey('substation', 'substation key');
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
      // Jade slipped in and took the substation gate key from the guard
      // post on her way through, so the player has it either way.
      giveKey('substation', 'substation key');
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
        sub: 'The load is spiking - press SPACE now to steady the feeders.',
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
}
function startMission3() {
  mission1.visible = false; mission2.visible = false; mission3.visible = true;
  state.mission = 3; state.climbStep = 0; resetView();
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
  else toast('You reach the catwalk. Click the planks to climb - hold SPACE to pull yourself up.');
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
      sub: 'Hold SPACE to pull yourself up the catwalk. Release to rest, hold to climb.',
      holdMs: 1200, windowMs: 8000,
      onDone: (done) => {
        climbHolding = false;
        if (done) advanceClimb();
        else toast('You slip back a step - click the catwalk and hold SPACE to try again.');
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
      sub: 'Press SPACE now to steady him before he falls back.',
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
  if (actRaf) { try { cancelAnimationFrame(actRaf); } catch (e) { /* ignore */ } actRaf = 0; }
  try { if (typeof valveTimer !== 'undefined' && valveTimer) { clearInterval(valveTimer); valveTimer = null; } } catch (e) { /* ignore */ }
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
  // While a dialogue or a modal is open the player is reading or choosing:
  // canvas taps must not re-trigger an interaction and reset the queue.
  if (!document.getElementById('dialogue').classList.contains('hidden')) return;
  if (!document.getElementById('valveModal').classList.contains('hidden')) return;
  if (!document.getElementById('scadaModal').classList.contains('hidden')) return;
  mouse.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const targets = [];
  if (state.mission === 1) targets.push(...Object.values(window._valveMeshes || {}), window._device1, window._device1Hit, window._valveRoomExit, window._valveRoomExitHit, window._stationDoor, window._stationDoorHit, window._stationKey, window._stationKeyLabel);
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
  if (dragMoved > 6) { dragMoved = 0; return; }
  dragMoved = 0;
  if (Date.now() - lastTapAt < 400) return; // already handled by pointerup
  lastTapAt = Date.now();
  handleTap(e.clientX, e.clientY);
});
// Pointerup fallback: some harnesses and touch inputs deliver press/release
// without a click event on the canvas. A tap (not a drag) is a click here.
canvas.addEventListener('pointerup', e => {
  if (!actActive) return;
  if (dragMoved > 6) { dragMoved = 0; return; }
  dragMoved = 0;
  if (Date.now() - lastTapAt < 400) return;
  lastTapAt = Date.now();
  handleTap(e.clientX, e.clientY);
});
function interact(name) {
  if (!name) return;
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
    giveKey('station', 'station key');
    toast('Picked up the station key. The station door is unlocked.');
    sfxRepair();
    try { if (window._stationKey) window._stationKey.visible = false; } catch (e) { /* ignore */ }
    try { if (window._stationKeyLabel) window._stationKeyLabel.visible = false; } catch (e) { /* ignore */ }
    return;
  }
  if (name === 'stationDoor') {
    // The station door is locked: it needs the station key, which is
    // on the hook beside the door. Without the key the door shows it
    // is locked instead of opening.
    if (!hasKey('station')) {
      toast('Locked - needs the station key. It is on the hook beside the door.');
      sfxThud();
      return;
    }
    enterValveRoom(); return;
  }
  if (name === 'valveRoomExit') { exitValveRoom(); return; }
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
  if (name === 'guard1' || name === 'guard2') { guardDialogue(); return; }
  if (name === 'keycard' && keycardMesh.visible) {
    hasKeycard = true; keycardMesh.visible = false; if (window._keycardHit) window._keycardHit.visible = false; state.inventory.push('SCADA key card'); updateHUD();
    setObjectives(OBJ2, 2);
    toast('Key card collected. Now the red log book on the desk - the passphrase is in it.');
    return;
  }
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
function animate() {
  if (!actActive) return;
  actRaf = requestAnimationFrame(animate);
  const t = Date.now() / 1000;
  const dt = animate.lastT === undefined ? 0.016 : Math.min(0.1, t - animate.lastT);
  animate.lastT = t;
  // During the drive between missions the travel sequence owns the
  // camera: the road and the city scroll past, WASD is ignored, and the
  // mission camera control below is skipped so it cannot fight the drive.
  if (travelActive) {
    updateTravelDrive(dt, t);
    renderer.render(scene, camera);
    return;
  }
  // Valve room: walking up to a valve wheel opens the pressure controls,
  // so the puzzle opens when the player reaches the valves.
  if (state.mission === 1 && inValveRoom && !valveOpen && !state.waterStable
    && document.getElementById('dialogue').classList.contains('hidden')
    && document.getElementById('valveModal').classList.contains('hidden')) {
    for (const vx of [-3, 0, 3]) {
      if (dist2D(camera.position.x, camera.position.z, vx, -5.7) < 1.8) { openValveModal(); break; }
    }
  }
  // Station key: walking up to the hook picks it up, so a missed click
  // is not a dead end. The key is right beside the door, before the
  // player needs it.
  if (state.mission === 1 && !inValveRoom && !hasKey('station')
    && document.getElementById('dialogue').classList.contains('hidden')
    && document.getElementById('valveModal').classList.contains('hidden')) {
    if (dist2D(camera.position.x, camera.position.z, 1.5, -0.6) < 1.2) {
      giveKey('station', 'station key');
      toast('Picked up the station key. The station door is unlocked.');
      sfxRepair();
      try { if (window._stationKey) window._stationKey.visible = false; } catch (e) { /* ignore */ }
      try { if (window._stationKeyLabel) window._stationKeyLabel.visible = false; } catch (e) { /* ignore */ }
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
  if (state.mission === 1 && !inValveRoom
    && document.getElementById('dialogue').classList.contains('hidden')
    && document.getElementById('valveModal').classList.contains('hidden')) {
    if (dist2D(camera.position.x, camera.position.z, 0, -0.68) < 1.8) {
      if (hasKey('station')) enterValveRoom();
      else if (t - stationDoorLockedAt > 3) {
        stationDoorLockedAt = t;
        toast('Locked - needs the station key. It is on the hook beside the door.');
        sfxThud();
      }
    }
  }
  // In third-person the camera was left behind the avatar last frame;
  // put it back on the player before moving, or movement starts from
  // the wrong place.
  beginPlayerFrame(camera, state.mission === 3 ? 1.9 : 1.7);
  const sp = 0.05;
  const mv = moveDelta(keys, state.yaw, sp);
  camera.position.x += mv.dx; camera.position.z += mv.dz;
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
  if (waterMesh) waterMesh.position.y = 0.05 + Math.sin(t * 0.6) * 0.02;
  for (const ch of chargeMeshes) {
    if (!state.derrickDown && ch.material.emissive) ch.material.emissiveIntensity = 1.2 + Math.sin(t * 5) * 0.8;
  }
  for (const h of humans) {
    const bt = t * 1.1 + h.phase;
    h.group.scale.set(h.baseScale, h.baseScale * (1 + Math.sin(bt) * 0.012), h.baseScale);
  }
  // Guards patrol the gate line while Mission 2 is active and they have
  // not stood down, so the yard feels alive and the player can see the
  // guards are the way in. They walk back and forth in x around their
  // post and face the direction they walk (the old scan faces +z, so
  // +x is rotation.y = PI/2 and -x is -PI/2). The key card rides on
  // guard1's belt, so it follows him; the "!" markers pulse above them.
  if (state.mission === 2 && !guardsDown) {
    for (const gp of guardPatrol) {
      const w = Math.sin(t * 0.45 + gp.phase);
      gp.group.position.x = gp.baseX + w * 1.8;
      gp.group.rotation.y = Math.cos(t * 0.45 + gp.phase) >= 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    for (const m of guardMarkers) {
      const s = 0.55 + Math.sin(t * 4) * 0.12;
      m.scale.set(s, s, 1);
      m.material.opacity = 0.75 + Math.sin(t * 4) * 0.25;
    }
    // Walk up to a guard: if the player gets close, Caleb starts the
    // bluff on his own. This is the forgiving path for players who do
    // not think to click - walking up to the police is the natural move.
    // (Only when no dialogue or modal is open, so it never fires over
    // the intro scene or another interaction.)
    if (document.getElementById('dialogue').classList.contains('hidden')
      && document.getElementById('valveModal').classList.contains('hidden')
      && document.getElementById('scadaModal').classList.contains('hidden')) {
      for (const gp of guardPatrol) {
        if (dist2D(camera.position.x, camera.position.z, gp.group.position.x, gp.group.position.z) < 2.5) {
          guardDialogue();
          break;
        }
      }
    }
  }
  // The key card sits on guard1's belt: while it is visible, keep it on
  // him even as he patrols, so the player always finds it where he is.
  if (state.mission === 2 && keycardMesh && keycardMesh.visible && guardPatrol.length) {
    const g1 = guardPatrol[0].group.position;
    keycardMesh.position.set(g1.x, 1.0, g1.z + 0.15);
    if (window._keycardHit) window._keycardHit.position.set(g1.x, 1.1, g1.z + 0.1);
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
    for (const p of cityPedestrians) updatePedestrian(p, dt);
    hornTimer += dt;
    if (hornTimer > 9) { hornTimer = 0; honkHorn(); }
  }
  updateTrek(dt, t); // on-foot trek, no-op when inactive
  // The station key bobs gently on its hook, so it catches the eye.
  if (window._stationKey && window._stationKey.visible) {
    window._stationKey.position.y = 1.5 + Math.sin(t * 2) * 0.06;
    window._stationKey.rotation.y = Math.sin(t * 1.2) * 0.4;
  }
  updateSpeakingGestures(t); // speaking bob, nod, lean and turn (no-op with no speaker)
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
  updateDeckChase(dt); // Verrazzano deck chase, no-op when inactive
  // Third-person: show the player avatar and put the camera behind it.
  {
    const mv2 = moveDelta(keys, state.yaw, 1);
    applyPlayerPresence({ scene, camera, x: camera.position.x, z: camera.position.z, yaw: state.yaw, pitch: state.pitch, moving, moveDx: mv2.dx, moveDz: mv2.dz, dt, t, eyeY: state.mission === 3 ? 1.9 : 1.7 });
  }
  renderer.render(scene, camera);
}
animate();
// ---------- Boot ----------
buildMission1();
buildMission2();
buildMission3();
setObjectives(OBJ1, 0); updateHUD(); initVoiceUI();
initSoundUI(); // procedural sound: ambient, effects, score, sound toggle
setAmbient('field'); // the reservoir: wind and open air
setTension(0.15);
// Wire the wallet Connect button. Act I and Act III call initZamaUI on
// their own boot, but Act II boots standalone when the player resumes
// here (or loads ?act=2) and game.js is never imported, so without this
// the Connect button has no handler and clicking it does nothing.
initZamaUI();
loadHumans();
