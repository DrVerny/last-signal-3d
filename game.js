import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { canvas, renderer, disposeScene } from './core.js';
import { PRIORITY_VALUES, sealPriorityChoice, wasSealedOnChain, initZamaUI } from './zama.js';
import { speakLine, stopSpeaking, initVoiceUI } from './speak.js';
import { registerHumans, updateSpeakingGestures } from './gestures.js';
import { registerLipSyncHumans } from './lipsync.js';
import { initSoundUI, setAmbient, setTension, soundTick, sfxDoor, sfxRepair, sfxPowerRestored, sfxWhoosh, sfxThud } from './sound.js';
import { initFlashlight, toggleFlashlight, updateFlashlight } from './flashlight.js';
import { runHoldQTE } from './qte.js';
import { showActionBanner, hideActionBanner, flashScreen, dist2D, makeActionMarker } from './action.js';
// THE LAST SIGNAL - Act I: The 4 Train - 3D prototype
// Original short dialogue in the spirit of the script; no long verbatim copying.
// Sealed choice: hidden until reveal. In demo mode it is simulated locally;
// when a wallet is connected on Sepolia (see zama.js), the choice is ALSO
// encrypted with FHEVM and sealed on-chain, so no one sees it before reveal.
// Single-page lifecycle (see acts.js): this module boots on import, and
// the act manager calls stopAct() before the next act loads. actActive
// gates the animate loop and input handlers so a stopped act cannot keep
// rendering or responding. It starts true because import is the start.
let actActive = true;
let actRaf = 0;
let batteryInterval = 0;
// Act I dodge-run state. Declared here (not with the run functions below)
// because animate() reads runActive on its first frame, and a let declared
// after the animate() call would throw a temporal-dead-zone error and stop
// the whole game from loading.
let runActive = false, runTime = 0, runInvuln = 0, runSpawnT = 0;
let exitMarker = null;
const runDebris = []; // {mesh, active, speed, cooldown}
const state = {
  trust: 3, timer: 900, // 15:00 in-fiction, ticks in real time
  integrity: { Transit: 70, Water: 80, Power: 60, Comms: 40 },
  objectives: [], inventory: [], sealedChoice: null, sealedRevealed: false,
  stage: 'intro', repaired: false, passengersCounted: false, walterHelped: false, boardFound: false,
  yaw: 0.23, pitch: 0, camZ: 0 // yaw 0.23 centres the relay in the default view
};
const OBJ = [
  'Ride the 4 train - talk to Caleb',
  'Survive the blackout - inspect the signal relay',
  'Repair the relay (match the circuit)',
  'Count the passengers and help Walter',
  'Make a sealed choice: which line gets priority power',
  'Find the RESET circuit board in the car'
];
function setObjectives(doneCount) {
  document.getElementById('objList').innerHTML = OBJ.map((o, i) =>
    `<li class="${i < doneCount ? 'done' : ''}">${o}</li>`).join('');
}
function updateHUD() {
  document.getElementById('trustBar').style.width = (state.trust * 10) + '%';
  document.getElementById('trustVal').textContent = state.trust + ' / 10';
  const m = Math.floor(state.timer / 60), s = state.timer % 60;
  document.getElementById('timerVal').textContent = `${m}:${String(s).padStart(2, '0')}`;
  document.getElementById('timerBar').style.width = (state.timer / 900 * 100) + '%';
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
  toastTimer = setTimeout(() => { t.style.opacity = 0; toastTimer = null; }, 3500);
}
function hideToast() { if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; } document.getElementById('toast').style.opacity = 0; }
function trust(n, why) { state.trust = Math.max(0, Math.min(10, state.trust + n)); updateHUD(); toast((n > 0 ? 'Trust +' + n : 'Trust ' + n) + (why ? ' - ' + why : '')); }
function integrity(key, n) { state.integrity[key] = Math.max(0, Math.min(100, state.integrity[key] + n)); updateHUD(); }

// ---------- Dialogue ----------
let dlgQueue = [], dlgCb = null;
let dialogueActive = false; // source of truth for "a dialogue is open"; the walkers
// pause while this is true. (Do not gate on the dialogue panel's CSS class:
// the panel's class is managed in several places and is not a reliable signal.)
function showDialogue(lines, cb) {
  hideToast(); // a new dialogue clears any stale hint, e.g. the BLACKOUT prompt after the repair
  dlgQueue = lines.slice(); dlgCb = cb || null; dialogueActive = true; nextLine();
}
function nextLine() {
  const box = document.getElementById('dialogue');
  if (!dlgQueue.length) { box.classList.add('hidden'); dialogueActive = false; stopSpeaking(); if (dlgCb) { const f = dlgCb; dlgCb = null; f(); } return; }
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

// ---------- Procedural textures (no external assets) ----------
function canvasTexture(w, h, draw, repeatX, repeatY) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX || 1, repeatY || 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function speckle(ctx, w, h, n, color, alpha, maxR) {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = Math.random() * alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(Math.random() * w, Math.random() * h, 0.5 + Math.random() * (maxR || 3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function grimeTexture(base, dark, repeatX, repeatY) {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 900, dark, 0.35, 4);
    speckle(ctx, w, h, 260, '#000000', 0.25, 7);
    for (let i = 0; i < 22; i++) { // scuffs and streaks
      ctx.globalAlpha = 0.06 + Math.random() * 0.1; ctx.strokeStyle = dark;
      ctx.lineWidth = 1 + Math.random() * 3; ctx.beginPath();
      const x = Math.random() * w, y = Math.random() * h;
      ctx.moveTo(x, y); ctx.lineTo(x + (Math.random() - 0.5) * 180, y + (Math.random() - 0.5) * 60); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const g = ctx.createLinearGradient(0, 0, 0, h); // worn edges darker
    g.addColorStop(0, 'rgba(0,0,0,0.22)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, repeatX, repeatY);
}
function fabricTexture(base, repeatX, repeatY) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 3) { ctx.globalAlpha = 0.12; ctx.fillStyle = (y / 3) % 2 ? '#000' : '#fff'; ctx.fillRect(0, y, w, 1); }
    for (let x = 0; x < w; x += 3) { ctx.globalAlpha = 0.08; ctx.fillStyle = (x / 3) % 2 ? '#000' : '#fff'; ctx.fillRect(x, 0, 1, h); }
    ctx.globalAlpha = 1; speckle(ctx, w, h, 220, '#101418', 0.3, 2);
  }, repeatX, repeatY);
}
function glowTexture() { // soft round sprite for light shafts, dust and lamp glow
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
}
// Brushed stainless steel: fine horizontal streaks + faint vertical grain, used as
// map, roughnessMap and bumpMap so poles, doors and kick panels catch streaky reflections.
function brushedSteelTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9aa4ab'; ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y++) {
    const v = 148 + Math.floor((Math.random() - 0.5) * 36);
    ctx.fillStyle = 'rgb(' + v + ',' + (v + 6) + ',' + (v + 10) + ')';
    ctx.fillRect(0, y, 256, 1);
  }
  for (let i = 0; i < 40; i++) { // occasional deeper brush lines and scuffs
    ctx.globalAlpha = 0.08 + Math.random() * 0.12; ctx.strokeStyle = Math.random() > 0.5 ? '#e8eef2' : '#4a545b';
    ctx.lineWidth = 1; ctx.beginPath(); const y = Math.random() * 256; ctx.moveTo(0, y); ctx.lineTo(256, y + (Math.random() - 0.5) * 4); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function floorTexture() { // anti-slip speckled rubber floor, worn centre aisle, yellow door threshold
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#2e3236'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 2600, '#565d63', 0.5, 2); speckle(ctx, w, h, 1400, '#14171a', 0.5, 2);
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) { // anti-slip diamond dots
      ctx.globalAlpha = 0.18; ctx.fillStyle = '#7a8288'; ctx.beginPath(); ctx.arc(x + 8, y + 8, 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const g = ctx.createLinearGradient(0, 0, w, 0); // aisle wear, darker at the walls
    g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 30; i++) { ctx.globalAlpha = 0.08; ctx.strokeStyle = '#0c0e10'; ctx.lineWidth = 2 + Math.random() * 3; ctx.beginPath(); const x = Math.random() * w, y = Math.random() * h; ctx.moveTo(x, y); ctx.lineTo(x + (Math.random() - 0.5) * 120, y + (Math.random() - 0.5) * 30); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }, 2, 8);
}
function seatFabricTexture() { // R160 blue-grey moquette: woven dots, seam lines, faded wear patches
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#24486e'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 6) for (let x = 0; x < w; x += 6) {
      ctx.globalAlpha = 0.35; ctx.fillStyle = ((x + y) / 6) % 2 ? '#1a3a5c' : '#2e5a8a';
      ctx.fillRect(x + 1, y + 1, 3, 3);
    }
    ctx.globalAlpha = 1; speckle(ctx, w, h, 300, '#0e1e30', 0.3, 2); speckle(ctx, w, h, 120, '#6a8ab0', 0.25, 2);
    ctx.strokeStyle = 'rgba(10,20,32,0.55)'; ctx.lineWidth = 2; // stitch seam
    ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(w, 8); ctx.stroke(); ctx.setLineDash([]);
    const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 120);
    g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, 1, 1);
}
function stripMapTexture() { // R160 strip map above the doors: green 4 line, stations, "4" bullet
  return canvasTexture(1024, 96, (ctx, w, h) => {
    ctx.fillStyle = '#e9e9e4'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#00985f'; ctx.fillRect(0, 42, w, 10); // Lexington Ave line
    ctx.fillStyle = '#00985f'; ctx.beginPath(); ctx.arc(52, 47, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 34px Arial'; ctx.textAlign = 'center'; ctx.fillText('4', 52, 59);
    ctx.fillStyle = '#111'; ctx.font = 'bold 15px Arial';
    const stops = ['Woodlawn', 'Burnside', '149 St', '125 St', '86 St', '59 St', '42 St', '14 St', 'Fulton St', 'Borough Hall', 'Utica Av', 'Crown Hts', 'New Lots'];
    stops.forEach((s, i) => {
      const x = 110 + i * 68;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, 47, 7, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#111'; ctx.fillText(s, x, 82);
    });
    ctx.textAlign = 'left';
  });
}
function routeMapTexture() { // small framed system map poster, simplified coloured lines
  return canvasTexture(512, 384, (ctx, w, h) => {
    ctx.fillStyle = '#f2f0e8'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#111'; ctx.font = 'bold 26px Arial'; ctx.fillText('SUBWAY MAP', 20, 36);
    const lines = [['#00985f', 60], ['#ee352e', 120], ['#0039a6', 180], ['#ff6319', 240], ['#b933ad', 300]];
    lines.forEach(([c, y]) => { ctx.strokeStyle = c; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(30, y); ctx.bezierCurveTo(180, y - 18, 320, y + 18, 480, y); ctx.stroke(); });
    ctx.fillStyle = '#111'; ctx.font = '16px Arial'; ctx.fillText('4  5  6  -  Lexington Av', 20, 350);
  });
}
// Procedural environment cube for reflections on steel (no external HDR).
function envCubeTexture() {
  const faces = [];
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, '#dfeaff'); g.addColorStop(0.45, '#5a6a78'); g.addColorStop(1, '#14181c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(20, 6, 24, 5); // fake tube strip
    faces.push(c);
  }
  const t = new THREE.CubeTexture(faces); t.needsUpdate = true; return t;
}
const ENV_MAP = envCubeTexture();
// Grayscale noise canvas, reused as bumpMap and roughnessMap (no per-frame allocation).
function noiseTexture(size, contrast) {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 118 + Math.floor((Math.random() - 0.5) * contrast);
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); return t;
}
const NOISE_TEX = noiseTexture(128, 90);
const NOISE_TEX_FINE = noiseTexture(128, 50);
// Vertical gradient alpha texture for volumetric light shafts (bright at top, fading down).
function shaftTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.5, 'rgba(255,255,255,0.28)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 256);
  const t = new THREE.CanvasTexture(c); return t;
}
const SHAFT_TEX = shaftTexture();
// Radial black blob for contact shadows under characters and benches.
function blobTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(0.6, 'rgba(0,0,0,0.4)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
}
const BLOB_TEX = blobTexture();
function contactShadow(x, z, sx, sz, opacity) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: BLOB_TEX, transparent: true, opacity: opacity || 0.5, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.06, z); m.scale.set(sx, sz, 1); scene.add(m); return m;
}
function posterTexture(kind) {
  return canvasTexture(256, 384, (ctx, w, h) => {
    if (kind === 'zoo') {
      ctx.fillStyle = '#0e3a24'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 44px Georgia'; ctx.fillText('BRONX', 22, 70); ctx.fillText('ZOO', 22, 118);
      ctx.fillStyle = '#e8e8e8'; ctx.font = '20px Georgia'; ctx.fillText('Open daily', 22, 160); ctx.fillText('4 train to', 22, 190); ctx.fillText('Pelham Pkwy', 22, 218);
      ctx.fillStyle = '#7ac74f'; ctx.beginPath(); ctx.arc(150, 300, 52, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0e3a24'; ctx.font = 'bold 26px Georgia'; ctx.fillText('GO', 132, 310);
    } else if (kind === 'mta') {
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#0039a6'; ctx.beginPath(); ctx.arc(128, 84, 56, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 64px Arial'; ctx.fillText('4', 110, 108);
      ctx.fillStyle = '#111'; ctx.font = 'bold 24px Arial'; ctx.fillText('LEXINGTON AVE', 28, 190); ctx.fillText('EXPRESS', 62, 222);
      ctx.font = '18px Arial'; ctx.fillText('Stand clear of the', 48, 272); ctx.fillText('closing doors.', 58, 298);
    } else {
      ctx.fillStyle = '#12303f'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#4cc9f0'; ctx.font = 'bold 34px Georgia'; ctx.fillText('RIDE', 30, 80); ctx.fillText('SAFE', 30, 122);
      ctx.fillStyle = '#e8e8e8'; ctx.font = '18px Georgia'; ctx.fillText('See something,', 30, 170); ctx.fillText('say something.', 30, 198);
      ctx.fillText('Report to any', 30, 240); ctx.fillText('MTA employee.', 30, 268);
    }
  });
}
function signTexture(text, bg, fg, sub) {
  return canvasTexture(512, 128, (ctx, w, h) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg; ctx.font = 'bold 52px Arial'; ctx.textAlign = 'center';
    // The '▼' glyph does not render in Arial on the test browser - every
    // round the testers reported no triangle on the sign, only the separate
    // cone below it. Draw the triangle explicitly as a filled path.
    let drawText = text, tri = false;
    if (text.startsWith('▼')) { tri = true; drawText = text.slice(1).trim(); }
    ctx.fillText(drawText, w / 2, 62);
    if (tri) {
      const tw = ctx.measureText(drawText).width;
      const cx = w / 2 - tw / 2 - 38, cy = 46, s = 22;
      ctx.beginPath(); ctx.moveTo(cx, cy + s); ctx.lineTo(cx - s * 0.9, cy - s * 0.7); ctx.lineTo(cx + s * 0.9, cy - s * 0.7); ctx.closePath(); ctx.fill();
    }
    if (sub) { ctx.font = '26px Arial'; ctx.fillText(sub, w / 2, 102); }
    ctx.textAlign = 'left';
  });
}

// ---------- Three.js scene ----------
// Renderer and canvas are shared with the other acts (see core.js): one
// WebGL context for the whole single-page game. This act sets only its
// own exposure on the shared renderer.
renderer.toneMappingExposure = 0.95; // photoreal filmic response
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070a);
scene.environment = ENV_MAP; // procedural env map: steel and skin pick up reflections
scene.fog = new THREE.FogExp2(0x0a0d10, 0.065); // tunnel haze, denser than before
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 1.6, 4);
const ambient = new THREE.AmbientLight(0xbfc8d4, 0.10); scene.add(ambient); // low cool fill, real light comes from tubes; kept low so the tunnel outside stays dark
const hemi = new THREE.HemisphereLight(0x8fa3b8, 0x1a1410, 0.08); scene.add(hemi);
// Cool-white fluorescent key light, with realistic falloff and shadows.
// Distance is kept to the car interior (9 m) so light does not spill out
// through the windows and wash out the tunnel and platform outside.
const mainLight = new THREE.PointLight(0xeef4ff, 5, 9, 1.8); mainLight.position.set(0, 1.4, 0);
mainLight.castShadow = true; mainLight.shadow.mapSize.set(1024, 1024); mainLight.shadow.bias = -0.002;
scene.add(mainLight);
const fillLight = new THREE.PointLight(0xdfeaff, 1.5, 8, 1.8); fillLight.position.set(0, 1.4, -4.5); scene.add(fillLight);
const fillLight2 = new THREE.PointLight(0xdfeaff, 1.5, 8, 1.8); fillLight2.position.set(0, 1.4, 4.5); scene.add(fillLight2);
const redLight = new THREE.PointLight(0xff2a22, 0, 10, 1.6); redLight.position.set(0, 1.4, 0); redLight.castShadow = true; scene.add(redLight);
const redLight2 = new THREE.PointLight(0xff2a22, 0, 9, 1.6); redLight2.position.set(0, 1.4, -4); scene.add(redLight2);
const warmLight = new THREE.PointLight(0xffc98a, 0, 9, 1.7); warmLight.position.set(0, 1.4, 0); scene.add(warmLight);
// Fluorescent tube fixtures (emissive, so they read as real light sources).
// Kept dim on purpose: the interior is a moody night car, not a bright room.
// The glow sprites are tracked separately so blackout can dim them too.
const tubeMat = new THREE.MeshStandardMaterial({ color: 0x4a5056, emissive: 0x8fa8c0, emissiveIntensity: 0.08, roughness: 0.85 });
const tubeGeo = new THREE.BoxGeometry(0.28, 0.06, 1.5);
const tubes = [];
const tubeGlows = [];
for (const z of [-5.5, -1, 3.5]) {
  const t = new THREE.Mesh(tubeGeo, tubeMat); t.position.set(0, 2.92, z); scene.add(t); tubes.push(t);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xdfeaff, transparent: true, opacity: 0.015, depthWrite: false }));
  glow.scale.set(2.2, 0.7, 1); glow.position.set(0, 2.85, z); scene.add(glow); tubes.push(glow); tubeGlows.push(glow);
}
// The stacked additive glows at each tube (glow sprite + halo + shaft cone
// apex) all land on the same spot, and their sum reads on screen as a bright
// white triangular tip at the near end of the ceiling - in every lighting
// mode, through three rounds of dimming. Hide them: the tubes alone, lit by
// the point lights, are the fixtures now. Floor pools stay (they are on the
// floor, not the ceiling, and they ground the light).
for (const g of tubeGlows) g.visible = false;
// Red emergency strips along the ceiling (emissive, glow in blackout)
const stripMat = new THREE.MeshStandardMaterial({ color: 0x7a0f0f, emissive: 0xff2222, emissiveIntensity: 0, roughness: 0.5, envMapIntensity: 0 });
for (const x of [-1.15, 1.15]) {
  const s = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 12), stripMat);
  s.position.set(x, 2.62, 0); scene.add(s);
}
// Dust motes drifting in the air, lit by the tubes
const dustGeo = new THREE.BufferGeometry();
const dustCount = 320, dustPos = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) { dustPos[i * 3] = (Math.random() - 0.5) * 2.6; dustPos[i * 3 + 1] = 0.2 + Math.random() * 2.7; dustPos[i * 3 + 2] = (Math.random() - 0.5) * 14; }
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: glowTexture(), color: 0xcfd8e2, size: 0.035, transparent: true, opacity: 0.35, depthWrite: false, sizeAttenuation: true }));
scene.add(dust);
// Volumetric light shafts: layered cones with a vertical gradient alpha texture,
// so the beam is bright at the tube and fades to nothing at the floor (god-ray feel).
const shaftMat = new THREE.MeshBasicMaterial({ map: SHAFT_TEX, color: 0xbfd4ee, transparent: true, opacity: 0.04, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const shafts = [];
const shaftHalos = [];
for (const z of [-4.5, 0, 4.5]) {
  const shaft = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.9, 24, 1, true), shaftMat);
  shaft.position.set(0, 1.45, z); scene.add(shaft); shafts.push(shaft);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.85, 2.9, 20, 1, true), shaftMat.clone());
  inner.material.opacity = 0.05; inner.position.set(0, 1.45, z); scene.add(inner); shafts.push(inner);
  // Light pool on the floor under each tube, plus a bloom-like halo at the tube.
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xbfd4ee, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.055, z); scene.add(pool); shaftHalos.push(pool);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xeef4ff, transparent: true, opacity: 0.03, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(3.2, 1.0, 1); halo.position.set(0, 2.85, z); scene.add(halo); shaftHalos.push(halo);
}
// Dust motes concentrated inside the light shafts (visible beams, not just ambient dust).
const shaftDustCount = 180, shaftDustPos = new Float32Array(shaftDustCount * 3);
for (let i = 0; i < shaftDustCount; i++) {
  const zc = [-4.5, 0, 4.5][i % 3];
  shaftDustPos[i * 3] = (Math.random() - 0.5) * 1.6; shaftDustPos[i * 3 + 1] = 0.3 + Math.random() * 2.5; shaftDustPos[i * 3 + 2] = zc + (Math.random() - 0.5) * 1.6;
}
const shaftDustGeo = new THREE.BufferGeometry();
shaftDustGeo.setAttribute('position', new THREE.BufferAttribute(shaftDustPos, 3));
const shaftDust = new THREE.Points(shaftDustGeo, new THREE.PointsMaterial({ map: glowTexture(), color: 0xe8f0fa, size: 0.05, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
scene.add(shaftDust);
// Hide the volumetric cones, their halo sprites and the shaft dust: the cone
// apexes sit right above the camera and read as a bright white triangular
// tip at the near end of the ceiling in every lighting mode. The floor pools
// (also in shaftHalos, but planes, not sprites) stay visible.
for (const s of shafts) s.visible = false;
for (const h of shaftHalos) if (h.isSprite) h.visible = false;
shaftDust.visible = false;
function setLightingMode(mode) {
  // mode: 'normal' (cool fluorescent), 'blackout' (dark + red), 'battery' (dim warm)
  if (mode === 'normal') {
    mainLight.intensity = 2.8; fillLight.intensity = 1.5; fillLight2.intensity = 1.5;
    redLight.intensity = 0; redLight2.intensity = 0; warmLight.intensity = 0;
    tubeMat.color.set(0x4a5056); tubeMat.emissive.set(0x8fa8c0); tubeMat.emissiveIntensity = 0.08; stripMat.emissiveIntensity = 0;
    for (const g of tubeGlows) g.material.opacity = 0.008;
    renderer.toneMappingExposure = 0.95; scene.fog.density = 0.055;
    shaftMat.opacity = 0.02; for (const h of shaftHalos) h.material.opacity = h.isSprite ? 0.015 : 0.03;
    shaftDust.material.opacity = 0.3;
  } else if (mode === 'blackout') {
    mainLight.intensity = 0.6; fillLight.intensity = 0; fillLight2.intensity = 0;
    redLight.intensity = 5; redLight2.intensity = 3; warmLight.intensity = 0;
    // Dead fluorescents: near-black tubes, so the red emergency light has
    // almost nothing to bounce off - the red strips are the light, not the tubes.
    tubeMat.color.set(0x111111); tubeMat.emissive.set(0x0a0a0a); tubeMat.emissiveIntensity = 0.05; stripMat.emissiveIntensity = 0.6;
    for (const g of tubeGlows) g.material.opacity = 0.005;
    renderer.toneMappingExposure = 0.9; scene.fog.density = 0.075;
    shaftMat.opacity = 0.01; for (const h of shaftHalos) h.material.opacity = h.isSprite ? 0.01 : 0.015;
    shaftDust.material.opacity = 0.15;
  } else {
    mainLight.intensity = 0; fillLight.intensity = 0; fillLight2.intensity = 0;
    // The red emergency lights are OFF now - the battery runs the warm lights.
    // Leaving them on tinted the far tube red after the repair.
    redLight.intensity = 0; redLight2.intensity = 0; warmLight.intensity = 4;
    tubeMat.color.set(0x4a5056); tubeMat.emissive.set(0xffc98a); tubeMat.emissiveIntensity = 0.08; stripMat.emissiveIntensity = 0.4;
    for (const g of tubeGlows) g.material.opacity = 0.008;
    renderer.toneMappingExposure = 1.0; scene.fog.density = 0.06;
    shaftMat.opacity = 0.02; for (const h of shaftHalos) h.material.opacity = h.isSprite ? 0.02 : 0.03;
    shaftDust.material.opacity = 0.35;
  }
}
setLightingMode('normal');
const floorTex = floorTexture();
const wallTex = grimeTexture('#46545e', '#1c2226', 2, 2);
const seatTex = seatFabricTexture();
const steelTex = brushedSteelTexture();
const steelMatShared = new THREE.MeshStandardMaterial({ map: steelTex, bumpMap: NOISE_TEX_FINE, bumpScale: 0.12, roughnessMap: NOISE_TEX_FINE, metalness: 0.92, roughness: 0.28, envMap: ENV_MAP, envMapIntensity: 0.9 });
const glassMatShared = new THREE.MeshPhysicalMaterial({ color: 0x0e1a24, metalness: 0, roughness: 0.06, envMap: ENV_MAP, envMapIntensity: 0.35, transparent: true, opacity: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 });
const seatMatShared = new THREE.MeshStandardMaterial({ map: seatTex, bumpMap: NOISE_TEX_FINE, bumpScale: 0.3, roughnessMap: NOISE_TEX_FINE, roughness: 0.96, metalness: 0 });
const seatBackMatShared = seatMatShared;
const plasticMatShared = new THREE.MeshStandardMaterial({ color: 0xcfd6da, roughness: 0.55, metalness: 0.05, bumpMap: NOISE_TEX_FINE, bumpScale: 0.1 });
// Shared seat geometries (reused for every cushion, so 20 seats cost little extra memory)
const seatPanGeo = new THREE.BoxGeometry(0.44, 0.09, 0.46);
const seatRollGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.46, 12);
const seatBackGeo = new THREE.BoxGeometry(0.07, 0.58, 0.46);
const seatBaseGeo = new THREE.BoxGeometry(0.42, 0.36, 0.46);
const dividerGeo = new THREE.BoxGeometry(0.05, 0.16, 0.03);
const poleGeo = new THREE.CylinderGeometry(0.032, 0.032, 2.9, 12);
const strapGeo = new THREE.TorusGeometry(0.07, 0.014, 8, 16);
function stdMat(opts) { return new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.8, metalness: 0.05 }, opts)); }
function box(w, h, d, color, x, y, z, name, matOpts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matOpts ? stdMat(matOpts) : stdMat({ color }));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  if (name) { m.name = name; m.userData.clickable = true; } scene.add(m); return m;
}
function cyl(r, h, color, x, y, z, matOpts) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), matOpts ? stdMat(matOpts) : stdMat({ color, metalness: 0.85, roughness: 0.25 }));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m;
}
function wallPlane(w, h, tex, x, y, z, rotY) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  m.position.set(x, y, z); m.rotation.y = rotY; m.receiveShadow = true; scene.add(m); return m;
}
// ---------- Subway car body: real R160/R211 proportions, not a box ----------
// Interior: 3.0 m wide, 15 m long, 3.45 m to the arched roof apex. Cross-section:
// vertical lower walls to y=1.9, then the roof curves in to a shallow arch.
// The old car was a 6 m wide flat box with a flat ceiling; that is what made it
// look fake. All positions below are in this 3.0 m car: benches at x=+-1.21,
// aisle centre x=0, poles at x=+-0.82, doors in the side walls at x=+-1.5.
const CAR_HALF = 1.5, CAR_LEN = 15, CAR_END = 7.5;
box(3.0, 0.1, 15, 0x2a2f33, 0, 0, 0, null, { map: floorTex, bumpMap: NOISE_TEX, bumpScale: 0.6, roughnessMap: NOISE_TEX_FINE, roughness: 0.65, metalness: 0.15 });
// Side walls are SEGMENTED, not solid boxes: the old solid walls had no holes,
// so the side windows were just dark glass planes on an opaque wall and the
// tunnel lamps outside could never be seen through them, and the sliding
// doors opened onto solid wall instead of the platform. Each wall is now:
// a bottom band below the windows, pillars between the window openings, and
// a thin top band - with real openings for the 4 windows per side (z centres
// -5.25, -2.75, 2.75, 5.25; window spans y 1.43-1.93) and for the centre
// doorway (z -0.7 to 0.7, full wall height, covered by the door leaves).
function wallSeg(sx, y0, y1, z0, z1) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, y1 - y0, z1 - z0),
    new THREE.MeshStandardMaterial({ map: wallTex, bumpMap: NOISE_TEX, bumpScale: 0.4, roughness: 0.75, metalness: 0.3, envMap: ENV_MAP, envMapIntensity: 0.25 }));
  m.position.set(sx * 1.46, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = true; m.receiveShadow = true; scene.add(m); return m;
}
for (const sx of [-1, 1]) {
  for (const zr of [[-7.5, -0.7], [0.7, 7.5]]) wallSeg(sx, 0, 1.43, zr[0], zr[1]); // bottom band, split at the doorway
  for (const zr of [[-7.5, -6.0], [-4.5, -3.5], [-2.0, -0.7], [0.7, 2.0], [3.5, 4.5], [6.0, 7.5]]) wallSeg(sx, 1.43, 1.93, zr[0], zr[1]); // pillars between windows/door
  wallSeg(sx, 1.93, 1.95, -7.5, 7.5); // thin top band
  // Yellow tactile warning strip along each door threshold, and a steel kick plate
  // (split at the doorway so the open doors give a clear view to the platform).
  box(0.5, 0.02, 1.4, 0xd8b400, sx * 1.22, 0.06, 0);
  for (const zr of [[-7.5, -0.7], [0.7, 7.5]]) {
    const kp = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, zr[1] - zr[0]), new THREE.MeshStandardMaterial({ map: steelTex, metalness: 0.85, roughness: 0.35, envMap: ENV_MAP, envMapIntensity: 0.7 }));
    kp.position.set(sx * 1.42, 0.2, (zr[0] + zr[1]) / 2); scene.add(kp);
  }
}
// Arched roof: extruded arch shell (shape in XY, extruded 15 m along Z), apex
// 3.15 m, spring line at y=1.9 where it meets the lower walls. Extrude is used
// (not a rotated cylinder) so the arch orientation is exact.
const roofShape = new THREE.Shape();
roofShape.moveTo(-1.5, 1.9); roofShape.quadraticCurveTo(-1.35, 2.85, 0, 3.15); roofShape.quadraticCurveTo(1.35, 2.85, 1.5, 1.9);
roofShape.lineTo(1.5, 1.82); roofShape.quadraticCurveTo(1.3, 2.78, 0, 3.07); roofShape.quadraticCurveTo(-1.3, 2.78, -1.5, 1.82); roofShape.lineTo(-1.5, 1.9);
const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 15, bevelEnabled: false, curveSegments: 24 });
const roofMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85, metalness: 0.2, side: THREE.DoubleSide, envMap: ENV_MAP, envMapIntensity: 0.2 });
const roof = new THREE.Mesh(roofGeo, roofMat);
roof.position.set(0, 0, -7.5); roof.receiveShadow = true; scene.add(roof);
// Ceiling panels: longitudinal strips following the arch, with seams between them.
// Mid-grey, not near-white: the old near-white panels blew out under the tubes.
for (const px of [-0.85, 0, 0.85]) {
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.04, 14.6), new THREE.MeshStandardMaterial({ color: 0x2e3438, roughness: 0.95, metalness: 0.08, envMapIntensity: 0, bumpMap: NOISE_TEX_FINE, bumpScale: 0.08 }));
  const y = px === 0 ? 3.02 : 2.82;
  panel.position.set(px, y, 0); panel.receiveShadow = true; panel.castShadow = true; scene.add(panel);
}
// Recessed fluorescent housings (two rows, in the ceiling panels) - the tubes
// already defined above sit inside these, so they read as fixtures, not floating bars
for (const px of [0]) for (const z of [-5.5, -1, 3.5]) {
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 1.7), new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.4, metalness: 0.7, envMap: ENV_MAP, envMapIntensity: 0 }));
  housing.position.set(px, 3.0, z); scene.add(housing);
}
// Arched end walls (same profile as the cross-section), with a centre door and
// window holes cut via Shape holes; tapered end bulkheads narrow the last 0.8 m.
function endWall(z) {
  const s = new THREE.Shape();
  s.moveTo(-1.5, 0); s.lineTo(-1.5, 1.9); s.quadraticCurveTo(-1.35, 2.85, 0, 3.15); s.quadraticCurveTo(1.35, 2.85, 1.5, 1.9); s.lineTo(1.5, 0); s.lineTo(-1.5, 0);
  const win = new THREE.Path(); win.moveTo(-0.55, 1.7); win.lineTo(0.55, 1.7); win.lineTo(0.55, 2.5); win.lineTo(-0.55, 2.5); win.lineTo(-0.55, 1.7);
  s.holes.push(win);
  const g = new THREE.ShapeGeometry(s, 24);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8, metalness: 0.25, side: THREE.DoubleSide }));
  m.position.set(0, 0, z); m.receiveShadow = true; scene.add(m);
  const gw = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), glassMatShared);
  gw.position.set(0, 2.1, z + (z > 0 ? -0.02 : 0.02)); if (z > 0) gw.rotation.y = Math.PI; scene.add(gw);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.08), new THREE.MeshStandardMaterial({ map: steelTex, metalness: 0.75, roughness: 0.35, envMap: ENV_MAP, envMapIntensity: 0.6 }));
  door.position.set(0, 0.95, z); door.castShadow = true; scene.add(door);
  const dw = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.6), glassMatShared);
  dw.position.set(0, 1.75, z + (z > 0 ? -0.06 : 0.06)); if (z > 0) dw.rotation.y = Math.PI; scene.add(dw);
  return m;
}
endWall(-7.5); endWall(7.5);
for (const sx of [-1, 1]) for (const ez of [-1, 1]) { // tapered end corners
  const taper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.9, 1.1), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8, metalness: 0.25 }));
  taper.position.set(sx * 1.38, 0.95, ez * 7.15); taper.rotation.y = sx * ez * 0.22; scene.add(taper);
}
// Wall panel seams and rivets: thin vertical seam strips + rivet dots on both walls
const rivetGeo = new THREE.SphereGeometry(0.012, 6, 6);
const rivetMat = new THREE.MeshStandardMaterial({ color: 0x6a747a, metalness: 0.8, roughness: 0.4 });
for (const sx of [-1, 1]) for (let z = -6; z <= 6; z += 2) {
  if (z === 0) continue; // the centre doorway has no seam or rivets
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.9, 0.03), new THREE.MeshStandardMaterial({ color: 0x232a2f, roughness: 0.9 }));
  seam.position.set(sx * 1.41, 0.98, z); scene.add(seam);
  for (const y of [0.4, 1.0, 1.6]) { const r = new THREE.Mesh(rivetGeo, rivetMat); r.position.set(sx * 1.41, y, z); scene.add(r); }
}
// ---------- Seats: real longitudinal benches, individual contoured cushions ----------
// Each seat: 0.46 m wide, seat pan 0.45 m high and 0.44 m deep, a rounded front
// roll, a backrest tilted 12 degrees with a curved top, a fabric cushion with
// seams, a steel divider/armrest between neighbours, and a plinth underneath.
// Two bench sections per side (either side of the centre doors), 5 seats each:
// 20 seats total. Walter sits on the rear left bench (see MODEL_DEFS).
function buildSeat(side, zc) {
  const g = new THREE.Group();
  const xBase = side * 1.21, xWall = side * 1.44;
  const pan = new THREE.Mesh(seatPanGeo, seatMatShared);
  pan.position.set(xBase, 0.47, 0); pan.castShadow = true; pan.receiveShadow = true; g.add(pan);
  const roll = new THREE.Mesh(seatRollGeo, seatMatShared);
  roll.rotation.x = Math.PI / 2; roll.position.set(side * 0.98, 0.47, 0); roll.castShadow = true; g.add(roll);
  const base = new THREE.Mesh(seatBaseGeo, new THREE.MeshStandardMaterial({ map: steelTex, metalness: 0.7, roughness: 0.45, envMap: ENV_MAP, envMapIntensity: 0.5 }));
  base.position.set(xBase, 0.24, 0); base.castShadow = true; g.add(base);
  const back = new THREE.Mesh(seatBackGeo, seatBackMatShared);
  back.position.set(xWall, 0.82, 0); back.rotation.z = -side * 0.21; back.castShadow = true; back.receiveShadow = true; g.add(back);
  const topRail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.46, 10), plasticMatShared);
  topRail.rotation.x = Math.PI / 2; topRail.position.set(side * 1.38, 1.12, 0); g.add(topRail);
  const div = new THREE.Mesh(dividerGeo, steelMatShared);
  div.position.set(side * 1.05, 0.58, 0.25); g.add(div);
  g.position.z = zc; scene.add(g); return g;
}
for (const sx of [-1, 1]) for (const zc of [-6.0, -5.5, -5.0, -4.5, -4.0, -3.5, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0]) buildSeat(sx, zc);
// Poles: vertical stanchions at each door edge and at bench-section ends, plus
// a centre pole by each door, all brushed steel with env reflections
for (const z of [-1.35, 1.35, -2.9, 2.9, -6.9, 6.9]) {
  for (const px of [-0.82, 0.82]) { const p = new THREE.Mesh(poleGeo, steelMatShared); p.position.set(px, 1.5, z); p.castShadow = true; scene.add(p); }
}
// Horizontal handrails above the seats and along the ceiling edge
for (const sx of [-0.82, 0.82]) {
  const r = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 14.6, 10), steelMatShared);
  r.rotation.x = Math.PI / 2; r.position.set(sx, 2.35, 0); r.castShadow = true; scene.add(r);
}
// Hand straps hanging from the rails (torus loop + short strap), spaced along the car
const strapMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.7 });
for (const sx of [-0.82, 0.82]) for (let z = -6; z <= 6; z += 1.5) {
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.01), strapMat);
  strap.position.set(sx, 2.24, z); scene.add(strap);
  const loop = new THREE.Mesh(strapGeo, strapMat);
  loop.position.set(sx, 2.12, z); scene.add(loop);
}
// Doors: sliding leaves on BOTH sides at centre, each leaf with a window, rubber
// seal, pocket recess and a "Stand clear" strip. Right-side leaves are the
// clickable 'door' objects that slide open after the repair.
function buildDoorLeaf(side, zc, name) {
  const g = new THREE.Group();
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.1, 0.62), new THREE.MeshStandardMaterial({ map: steelTex, metalness: 0.75, roughness: 0.32, envMap: ENV_MAP, envMapIntensity: 0.8, bumpMap: NOISE_TEX_FINE, bumpScale: 0.1 }));
  leaf.position.set(0, 1.12, 0); leaf.castShadow = true; if (name) leaf.name = name; g.add(leaf);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.85), glassMatShared);
  win.position.set(-side * 0.035, 1.55, 0); win.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; g.add(win);
  const seal = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.1, 0.04), new THREE.MeshStandardMaterial({ color: 0x111414, roughness: 0.95 }));
  seal.position.set(0, 1.12, side > 0 ? 0.31 : -0.31); g.add(seal);
  g.position.set(side * 1.46, 0, zc); scene.add(g); return g;
}
const doorGroupL = buildDoorLeaf(1, -0.35, 'door');
const doorGroupR = buildDoorLeaf(1, 0.35, 'door');
buildDoorLeaf(-1, -0.35, null); buildDoorLeaf(-1, 0.35, null);
const doorL = doorGroupL.children[0], doorR = doorGroupR.children[0];
doorL.userData.clickable = true; doorR.userData.clickable = true;
// Door pockets (dark recesses the leaves slide into) and header with strip map
for (const sx of [-1, 1]) for (const pz of [-1.15, 1.15]) {
  const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.1, 0.5), new THREE.MeshStandardMaterial({ color: 0x14181b, roughness: 0.95 }));
  pocket.position.set(sx * 1.44, 1.12, pz); scene.add(pocket);
}
// Windows: framed glass set INTO the real openings in the segmented walls
// (y 1.43-1.93, centre 1.68), so the tunnel outside is actually visible
// through them instead of being hidden behind a solid wall.
const winMat = new THREE.MeshStandardMaterial({ color: 0x0a1a2a, emissive: 0x16283a, emissiveIntensity: 0.7, roughness: 0.15, metalness: 0.4 });
const tunnelLights = [];
for (const sx of [-1, 1]) for (const z of [-5.25, -2.75, 2.75, 5.25]) {
  // Frame is 4 thin border bars only, NOT a solid slab: the old solid
  // 0.04 x 0.65 x 1.7 box filled the whole opening and hid the tunnel.
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.6, metalness: 0.4 });
  for (const fy of [1.68 - 0.295, 1.68 + 0.295]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 1.7), frameMat);
    bar.position.set(sx * 1.44, fy, z); scene.add(bar);
  }
  for (const fz of [z - 0.82, z + 0.82]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.65, 0.06), frameMat);
    bar.position.set(sx * 1.44, 1.68, fz); scene.add(bar);
  }
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.5), glassMatShared);
  win.position.set(sx * 1.42, 1.68, z); win.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2; scene.add(win);
  const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.04), new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.6 }));
  mullion.position.set(sx * 1.41, 1.68, z); scene.add(mullion);
}
// Tunnel outside: dark walls between lamps, with wall-mounted tunnel lamps
// spaced along both walls so the tunnel reads as lit in pools of light, not
// pitch black and not a flat bright wash. The lamps stream past the windows
// while the train is moving (intro stage, see animate loop) and go dark when
// the train stops for the blackout. envMapIntensity 0 stops the bright
// procedural environment map washing the tunnel out. No tunnel point lights:
// the lamps are emissive fixtures + glow sprites + lit wall pools only, so
// no light spills into the car or washes out the gold relay.
// The tunnel runs 50 m (z -25 to 25) so the full three-car train sits
// inside it; the walls are kept so the exterior camera can hide the near
// one and look at the train from outside.
const tunnelWallMeshes = [];
for (const sx of [-1, 1]) {
  const tw = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.4, 50), new THREE.MeshStandardMaterial({ color: 0x020304, roughness: 1, envMapIntensity: 0 }));
  tw.position.set(sx * 2.6, 1.6, 0); scene.add(tw); tunnelWallMeshes.push(tw);
  const lw = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 50), new THREE.MeshStandardMaterial({ color: 0x020304, roughness: 1, envMapIntensity: 0 }));
  lw.position.set(sx * 2.6, -0.55, 0); scene.add(lw); tunnelWallMeshes.push(lw);
}
const tunnelLampMat = new THREE.MeshStandardMaterial({ color: 0x3a2a10, emissive: 0xff8c00, emissiveIntensity: 0.9, roughness: 0.4, envMapIntensity: 0 });
const tunnelLampGlowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff9d00, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
const tunnelLampPoolMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xff9d00, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
const tunnelLampGroups = [];
for (const sx of [-1, 1]) for (const z of [-23, -19.2, -15.4, -11.6, -7.8, -6.6, -4.7, -2.8, -0.9, 1.0, 2.9, 4.8, 6.7, 8.6, 12.4, 16.2, 20, 23.8]) { // lamps aligned with the window centres, at window height (y 1.68), so they are seen through the windows, not above them
  const g = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.55), new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.8, metalness: 0.4 }));
  housing.position.set(0, 0, 0); g.add(housing);
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.6), tunnelLampMat);
  face.position.set(-sx * 0.07, 0, 0); g.add(face);
  const glow = new THREE.Sprite(tunnelLampGlowMat);
  glow.scale.set(2.2, 1.4, 1); glow.position.set(-sx * 0.18, 0, 0); g.add(glow);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.0), tunnelLampPoolMat);
  pool.position.set(-sx * 0.08, -0.7, 0); pool.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2; g.add(pool);
  g.position.set(sx * 2.5, 1.68, z); scene.add(g); tunnelLampGroups.push(g);
}
// Lit tunnel ahead: a soft warm glow at the far end the train is heading
// toward (forward is -z), seen through the end-wall window, so entering the
// tunnel reads as moving into light. It sits behind the end wall (z -8.6),
// not inside the car, and fog:false keeps it bright through the glass.
const tunnelAheadGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc978, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
tunnelAheadGlow.scale.set(6.0, 3.5, 1); tunnelAheadGlow.position.set(0, 1.9, -24.5); scene.add(tunnelAheadGlow);
let tunnelLampsOn = true;
// Passing light strips, restored to clearly visible warm light: larger and
// brighter than the dimmed version, with a glow sprite each, streaming past
// the windows while the train is moving (intro stage) and freezing/dark when
// the train stops.
for (let i = 0; i < 16; i++) {
  const tl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 1.4), new THREE.MeshStandardMaterial({ color: 0x3a2a10, emissive: 0xff8c00, emissiveIntensity: 0.9, envMapIntensity: 0 }));
  const tlGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff9d00, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
  tlGlow.scale.set(1.4, 0.7, 1); tl.add(tlGlow);
  tl.position.set((i % 2 ? 2.15 : -2.15), 1.68, -7 + i * 0.94); scene.add(tl); tunnelLights.push(tl);
}
// Signage, strip maps, ads and route map on the car walls
wallPlane(1.1, 1.65, posterTexture('mta'), -1.41, 1.35, -6.85, Math.PI / 2);
wallPlane(1.1, 1.65, posterTexture('zoo'), 1.41, 1.35, -6.85, -Math.PI / 2);
wallPlane(1.1, 1.65, posterTexture('safety'), -1.41, 1.35, 6.85, Math.PI / 2);
wallPlane(1.1, 1.65, posterTexture('zoo'), 1.41, 1.35, 6.85, -Math.PI / 2);
wallPlane(1.1, 0.85, routeMapTexture(), -1.41, 1.35, -4.0, Math.PI / 2);
wallPlane(2.6, 0.24, stripMapTexture(), -1.41, 2.42, -2.75, Math.PI / 2);
wallPlane(2.6, 0.24, stripMapTexture(), 1.41, 2.42, -2.75, -Math.PI / 2);
wallPlane(2.0, 0.5, signTexture('14 ST - UNION SQ', '#111111', '#e8e8e8', '4  5  6  L  N  Q  R  W'), -1.41, 2.42, 0, Math.PI / 2);
wallPlane(1.6, 0.4, signTexture('STAND CLEAR OF THE CLOSING DOORS', '#e8e8e8', '#111111', ''), 1.41, 2.42, 0, -Math.PI / 2);
// Emergency intercom box by the right-hand doors, with a red button
const intercom = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.2), new THREE.MeshStandardMaterial({ color: 0xb8bec2, roughness: 0.5, metalness: 0.4 }));
intercom.position.set(1.42, 1.5, -1.6); scene.add(intercom);
const intercomBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), new THREE.MeshStandardMaterial({ color: 0xc02020, roughness: 0.4 }));
intercomBtn.rotation.z = Math.PI / 2; intercomBtn.position.set(1.38, 1.5, -1.6); scene.add(intercomBtn);
// Interactive objects (on the new 3.0 m walls, x=+-1.42)
// Relay: big, emissive gold, with a pulsing halo, a floating RELAY marker and
// a down arrow, so it is unmissable from the starting camera. ROOT CAUSE of
// the old invisible relay: its box was 0.95 m wide in X and only 0.28 m deep
// in Z, so its large face pointed along the car (toward +/-z) and the room
// only ever saw its thin 0.28 m edge, half-embedded in the wall, with a dark
// faceplate on top of it. The box is now thin in X (0.28) and wide in Z
// (0.95), so its large gold face points into the room (+x), it sits proud
// of the wall, and the faceplate is gold too. The marker and arrow sit in
// open car air (x -1.05, below the roof arch) instead of up at y 2.5 inside
// the arch, and the glow/marker sprites ignore fog so they stay bright.
const relayMat = new THREE.MeshStandardMaterial({ color: 0x3d2f0a, emissive: 0x2a1f00, emissiveIntensity: 0.15, roughness: 0.6, metalness: 0.2 });
const relayBackplateMat = new THREE.MeshStandardMaterial({ color: 0x3d2f0a, emissive: 0x2a1f00, emissiveIntensity: 0.12, roughness: 0.55 });
const relayBackplate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.6, 1.4), relayBackplateMat);
relayBackplate.position.set(-1.40, 1.6, -1.5); relayBackplate.name = 'relay'; relayBackplate.userData.clickable = true; scene.add(relayBackplate);
const relay = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.4, 1.2), relayMat);
relay.position.set(-1.30, 1.6, -1.5); relay.castShadow = true; relay.receiveShadow = true;
relay.name = 'relay'; relay.userData.clickable = true; scene.add(relay);
const relayFaceMat = new THREE.MeshStandardMaterial({ color: 0x3d2f0a, emissive: 0x2a1f00, emissiveIntensity: 0.12, roughness: 0.55 });
const relayFace = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.9), relayFaceMat);
relayFace.position.set(-1.14, 1.6, -1.5); relayFace.name = 'relay'; relayFace.userData.clickable = true; scene.add(relayFace);
const relayStrip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.7), new THREE.MeshStandardMaterial({ color: 0x2a2113, emissive: 0x2a1f00, emissiveIntensity: 0.2, roughness: 0.4 }));
relayStrip.position.set(-1.10, 1.6, -1.5); scene.add(relayStrip);
const relayGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb700, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
relayGlow.scale.set(1.8, 1.8, 1); relayGlow.position.set(-1.05, 1.6, -1.5); scene.add(relayGlow);
// The relay light sits further from the face now: at 0.3 m it blasted the
// gold point-blank and read as bright lemon-yellow, whatever the paint.
const relayLight = new THREE.PointLight(0xffb700, 1.0, 6, 1.8); relayLight.position.set(-0.6, 1.6, -1.5); scene.add(relayLight);
// The marker and arrow float in the aisle above the relay, NOT on the wall:
// every pole in the car sits at x +/-0.82 on the same sightline as the relay,
// so any wide sign near the wall gets a pole across its text. Centred in the
// aisle the sign is clear of all poles from the default camera.
// The marker hangs in the CENTRE of the aisle (x 0, y 2.2, z -0.5), not
// over the cabinet. Round 10 proved the left side is unusable: the
// horizontal handrail at (x -0.82, y 2.35) runs the whole car and, seen in
// perspective, cuts diagonally across any sign near it through "R" and "E",
// and the hanging strap loops at the same x cross its left end. In the
// centre the two rails converge toward the vanishing point and only cross
// the sign's blank margins, never the centred text; the straps, loops and
// poles all project outside the sign, and the ceiling tubes (y 2.92) sit
// well above it. The arrow still points down-left at the relay itself.
const relayMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('▼ RELAY', '#ffd166', '#111111', ''), transparent: true, depthWrite: false, fog: false }));
relayMarker.scale.set(1.4, 0.35, 1); relayMarker.position.set(0, 2.2, -0.5); scene.add(relayMarker);
const relayArrow = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 12), new THREE.MeshStandardMaterial({ color: 0xffc94d, emissive: 0x7a5c00, emissiveIntensity: 1.0, roughness: 0.4 }));
relayArrow.rotation.x = Math.PI; relayArrow.position.set(-1.0, 1.95, -1.5); scene.add(relayArrow); // smaller and lower than before, clear of the sign above it
// Generous invisible click target around the relay (transparent, still raycast).
const relayHit = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 2.4), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
relayHit.position.set(-1.15, 1.6, -1.5); relayHit.name = 'relay'; relayHit.userData.clickable = true; scene.add(relayHit);
const release = box(0.4, 0.5, 0.15, 0xef476f, 1.42, 1.5, -4.0, 'release');
release.rotation.y = Math.PI / 2; // wall-mounted boxes must face into the room, not along the car (same edge-on bug as the relay)
const panel = box(0.8, 1.0, 0.15, 0x4cc9f0, -1.42, 1.5, 4.0, 'panel');
panel.rotation.y = Math.PI / 2;
const board = box(0.35, 0.25, 0.05, 0x7ac74f, 1.38, 1.1, 3.9, 'board');
// Generous invisible click target around the RESET board: the board itself is
// only 0.35 m wide, so clicks on its upper half used to miss it entirely.
const boardHit = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 0.5), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
boardHit.position.set(1.38, 1.1, 3.9); boardHit.name = 'board'; boardHit.userData.clickable = true; scene.add(boardHit);
board.rotation.y = Math.PI / 2; // moved to z 3.9, onto a solid pillar between windows (was z 3, inside a window opening)
board.visible = false; // appears on the platform after evacuation
// ---------- Human characters: rigged CC0 3D people (Quaternius) ----------
// GLB models in models/rigged/ - rigged figures with a real skeleton and an
// embedded Walk animation, so arms swing from the shoulder, elbows bend,
// and legs step with knees bending. Jade is the Casual Female, Caleb is
// the plain civilian Matt (not the BlueSoldier, whose helmet and vest
// would clash with the police cap and badge added in code), the nurse is
// Lis, Walter is Sam. The walkers play the plain "Walk" clip on loop
// while they patrol; Walter stays seated, so no Walk clip is played for
// him. The Walk clips walk in place (the skeleton root does not travel),
// so the group's patrol translation does the moving. Caleb gets a simple
// navy cap and a gold badge disc in code, since the model has neither.
// (The old navy recolour looked for a 'casualsuit' material on the scan;
// the rigged Matt model uses a single "Atlas" material, so that recolour
// is now a no-op and Caleb keeps his own outfit colours.)
const humans = []; // {group, name, baseScale, phase, seated, mixer, rootBone, rootRest}
const humanGroups = []; // THREE.Group per loaded character, for raycast clicking
const modelGroups = {}; // key -> {group}
const MODEL_DEFS = [
  { key: 'jade', file: 'models/rigged/jade-rigged.glb', name: 'jade', x: -0.55, z: -2.6, faceYaw: 0.5, targetHeight: 1.70 },
  { key: 'caleb', file: 'models/rigged/caleb-alt-civilian.glb', name: 'caleb', x: 0.6, z: -2, faceYaw: -0.4, targetHeight: 1.88, recolourNavy: true },
  { key: 'nurse', file: 'models/rigged/nurse-rigged.glb', name: 'nurse', x: 0.55, z: 1, faceYaw: -0.9, targetHeight: 1.68 },
  { key: 'walter', file: 'models/walter.glb', name: 'walter', x: -1.18, z: 4.5, faceYaw: 0.6, targetHeight: null, hideBench: true }
];
let introStarted = false;
function startIntro() {
  if (introStarted) return;
  introStarted = true;
  document.getElementById('loading').classList.add('hidden');
  showDialogue([
    { who: 'Jade Morales', text: 'Southbound 4 train, rush hour. I designed the signal system for this line - before they fired me.' },
    { who: 'Caleb Bishop', text: 'Everybody stay calm! NYPD! We are going to get you out of here!' },
    { who: 'Jade Morales', text: 'Unless you know how to bypass a locked emergency release, let me work. You are my eyes. Third car. Count the passengers.' },
    { who: 'System', text: 'The lights flicker. Once. Twice. Then - darkness.', choices: [
      { label: '“Stay calm. I have done this before.” (Trust +1)', effect: () => trust(1, 'calm under pressure') },
      { label: '“Move. Now. No time to talk.”', effect: () => {} }
    ] }
  ], () => {
    state.stage = 'blackout';
    setAmbient('tunnel'); // the train stops: rumble dies, tunnel wind stays
    setObjectives(2);
    toast('BLACKOUT - click the glowing gold signal relay to repair it.');
  });
}
async function loadHumans() {
  const loadingText = document.getElementById('loadingText');
  const loadingError = document.getElementById('loadingError');
  const loadingContinue = document.getElementById('loadingContinue');
  const loader = new GLTFLoader();
  const failures = [];
  let done = 0;
  const jobs = MODEL_DEFS.map(async (def) => {
    try {
      const gltf = await loader.loadAsync(def.file, (ev) => {
        if (ev.total > 0) loadingText.textContent = 'Loading characters... ' + def.key + ' ' + Math.min(100, Math.round(ev.loaded / ev.total * 100)) + '%';
      });
      const group = gltf.scene;
      group.name = def.name;
      // Hide Walter's bench (the game already has benches in the car).
      if (def.hideBench) group.traverse((o) => { if (o.name && o.name.indexOf('Bench') === 0) o.visible = false; });
      // Caleb's officer markers: a navy cap and a gold badge disc on the chest.
      // NOTE: the jacket recolour below is a no-op on the rigged model: the
      // old scan had a 'casualsuit' material, but the rigged Matt uses a
      // single "Atlas" texture material for the whole body, so recolouring
      // it would tint the skin too. The cap + badge carry the officer look.
      // Positions are calibrated for the rigged Matt (measured from its GLB):
      // native height 1.508, head top local y 1.503, and it faces -z (local
      // forward is -z, so the chest front and the brim are on the -z side).
      // These are local units, added before the height normalisation scales
      // the whole group, so they land on the head/chest after scaling.
      if (def.recolourNavy) {
        const navy = new THREE.MeshStandardMaterial({ color: 0x1a3a5a, roughness: 0.85, metalness: 0.02 });
        group.traverse((o) => {
          if (o.isMesh && o.material && o.material.name && o.material.name.indexOf('casualsuit') !== -1) o.material = navy;
        });
        // Simple navy cap and a gold badge disc on the chest.
        const capMat = new THREE.MeshStandardMaterial({ color: 0x16283f, roughness: 0.7 });
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.13, 0.07, 16), capMat);
        crown.position.set(0, 1.51, -0.13); crown.castShadow = true; group.add(crown);
        const brim = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.012, 0.1), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.3 }));
        brim.position.set(0, 1.47, -0.22); group.add(brim);
        const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.01, 12), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.25, side: THREE.DoubleSide }));
        badge.rotation.x = Math.PI / 2; badge.position.set(-0.09, 1.22, -0.38); group.add(badge);
      }
      group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      // Normalise height to the character's target height, then re-ground feet at y=0.
      let s = 1;
      const box = new THREE.Box3().setFromObject(group);
      const size = new THREE.Vector3(); box.getSize(size);
      if (def.targetHeight && size.y > 0) s = def.targetHeight / size.y;
      group.scale.setScalar(s);
      const box2 = new THREE.Box3().setFromObject(group);
      group.position.set(def.x, -box2.min.y, def.z);
      group.rotation.y = def.faceYaw || 0;
      scene.add(group);
      // Walking: the standing characters patrol a short stretch of the aisle so
      // the car feels alive instead of frozen. Walter stays seated. Each walker
      // gets a patrol range around their home spot, a slow speed, and a step
      // phase for the bob. The contact shadow follows them.
      const walkRanges = {
        jade: { minZ: -4.5, maxZ: -0.5, speed: 0.35 },
        caleb: { minZ: -4.5, maxZ: 0.5, speed: 0.4 },
        nurse: { minZ: -0.5, maxZ: 3.5, speed: 0.3 }
      };
      const wr = walkRanges[def.key];
      // Walk animation (rigged models only): the standing characters play
      // the plain "Walk" clip on loop while they patrol, so arms swing
      // from the shoulder, elbows bend, and legs step with knees bending.
      // Walter is seated, so no Walk clip is played for him. The Walk
      // clips walk in place: the skeleton root (Bone on the 23-joint rig,
      // Root on the 43-joint rig) does not travel, so the group's patrol
      // translation does the moving. The root bone's horizontal position
      // is still reset to its rest pose after each mixer update (see
      // animate), which keeps the character in place if a clip ever does
      // carry root motion. If no "Walk" clip is found the character
      // simply patrols with the step bob as before.
      let mixer = null, rootBone = null, rootRest = null;
      if (wr) {
        try {
          const walkClip = THREE.AnimationClip.findByName(gltf.animations || [], 'Walk');
          if (walkClip) {
            mixer = new THREE.AnimationMixer(group);
            mixer.clipAction(walkClip).play();
            group.traverse((o) => {
              if (!rootBone && o.isBone && (o.name === 'Bone' || o.name === 'Root')) rootBone = o;
            });
            if (!rootBone) group.traverse((o) => { if (!rootBone && o.isBone) rootBone = o; });
            if (rootBone) rootRest = rootBone.position.clone();
          }
        } catch (e) { mixer = null; rootBone = null; rootRest = null; }
      }
      humans.push({ group, name: def.name, baseScale: s, phase: Math.random() * 6, seated: def.key === 'walter', baseY: group.position.y, shadow: humanShadows[def.key] || null, walk: wr ? { minZ: wr.minZ, maxZ: wr.maxZ, speed: wr.speed, dir: Math.random() < 0.5 ? 1 : -1, stepPhase: Math.random() * 6 } : null, mixer, rootBone, rootRest });
      humanGroups.push(group);
      modelGroups[def.key] = { group };
    } catch (e) {
      failures.push(def.key + ': ' + (e && e.message ? e.message : e));
    }
    done++;
    loadingText.textContent = 'Loading characters... ' + done + ' / ' + MODEL_DEFS.length;
  });
  await Promise.all(jobs);
  registerHumans(humans); // speaking gestures use the loaded models
  registerLipSyncHumans(humans); // jaw morph lip-sync uses the same loaded models
  if (failures.length) {
    loadingError.classList.remove('hidden');
    loadingError.textContent = 'Could not load: ' + failures.join(' ; ') + '. The game can still start without them.';
    loadingContinue.classList.remove('hidden');
    loadingContinue.onclick = () => startIntro();
    loadingText.textContent = 'Some characters failed to load.';
  } else {
    startIntro();
  }
}
// Contact shadows: soft dark blobs grounding characters and benches (real shadows are
// soft in a subway; these keep feet and seats from floating when lights are dim).
// The three walking characters keep their shadow mesh so it can follow them.
const humanShadows = {};
humanShadows.jade = contactShadow(-0.55, -2.6, 0.9, 0.9, 0.55); // Jade
humanShadows.caleb = contactShadow(0.6, -2, 0.9, 0.9, 0.55); // Caleb
humanShadows.nurse = contactShadow(0.55, 1, 0.9, 0.9, -0.5); // Nurse Adeyemi
contactShadow(-1.18, 4.5, 1.1, 1.0, 0.55); // Walter, seated on the rear left bench
for (const sx of [-1.21, 1.21]) for (let z = -5; z <= 5; z += 2.5) contactShadow(sx, z, 0.7, 2.3, 0.4); // benches
// Platform outside the right-hand doors (visible when doors open). Near-black
// concrete with envMapIntensity 0, so the interior lights and the environment
// map cannot wash it out; only a faint dim pool of light on the floor itself.
const platformSlab = box(3.5, 0.1, 4, 0x111214, 3.4, 0, 0, null, { color: 0x111214, envMapIntensity: 0, roughness: 1 });
const platformWall = box(0.2, 3, 4, 0x0a0b0c, 5.2, 1.5, 0, null, { color: 0x0a0b0c, envMapIntensity: 0, roughness: 1 });
// ---------- Track under the train, and the train seen from outside ----------
// The car sits on a real track: a ballast bed, two steel rails and sleepers,
// with bogies and wheels under the car. The sleepers stream past in the
// intro and after stages (same speed as the tunnel lamps) so the train
// reads as moving when the camera is outside. The tunnel floor closes the
// underside of the tunnel so the track does not float in a void.
const trackBed = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.15, 50), new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 1, envMapIntensity: 0 }));
trackBed.position.set(0, -0.95, 0); trackBed.receiveShadow = true; scene.add(trackBed);
const tunnelFloor = new THREE.Mesh(new THREE.PlaneGeometry(12, 50), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1, envMapIntensity: 0 }));
tunnelFloor.rotation.x = -Math.PI / 2; tunnelFloor.position.set(0, -1.02, 0); scene.add(tunnelFloor);
for (const rx of [-0.75, 0.75]) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 50), new THREE.MeshStandardMaterial({ color: 0x9aa2a8, metalness: 0.9, roughness: 0.25, envMapIntensity: 0.4 }));
  rail.position.set(rx, -0.82, 0); scene.add(rail);
}
const trackSleepers = [];
for (let z = -24.5; z <= 24.5; z += 0.7) {
  const sl = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.35), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1, envMapIntensity: 0 }));
  sl.position.set(0, -0.88, z); scene.add(sl); trackSleepers.push(sl);
}
const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.18, 16);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.4 });
function buildBogie(zc, parent) {
  const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 2.4), new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.7, metalness: 0.5 }));
  bogie.position.set(0, -0.35, zc); parent.add(bogie);
  for (const wx of [-0.75, 0.75]) for (const wz of [zc - 0.8, zc + 0.8]) {
    const wh = new THREE.Mesh(wheelGeo, wheelMat);
    wh.rotation.z = Math.PI / 2; wh.position.set(wx, -0.38, wz); parent.add(wh);
  }
}
buildBogie(-5, scene); buildBogie(5, scene);
// Green livery band on the outside of the car (below the windows), so the
// car reads as a 4 train from the outside, not a plain steel box.
for (const sx of [-1, 1]) {
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.35, 15), new THREE.MeshStandardMaterial({ color: 0x2a5a3a, roughness: 0.6, metalness: 0.2 }));
  band.position.set(sx * 1.505, 1.15, 0); scene.add(band);
}
// Two coupled cars (front and rear), exterior only - the player never goes
// inside them. Same 3.0 m width and arched roof profile as the main car,
// green livery, lit window band, headlights on the front car and red
// tail lights on the rear, so the train reads as a full train from outside.
function buildExteriorCar(zc, isFront) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.0, 14.5), new THREE.MeshStandardMaterial({ color: 0x2a5a3a, roughness: 0.55, metalness: 0.3 }));
  body.position.set(0, 1.0, 0); body.castShadow = true; g.add(body);
  const roofGeo2 = new THREE.ExtrudeGeometry(roofShape, { depth: 14.5, bevelEnabled: false, curveSegments: 24 });
  const roof2 = new THREE.Mesh(roofGeo2, roofMat);
  roof2.position.set(0, 0, -7.25); g.add(roof2);
  const winBand = new THREE.Mesh(new THREE.BoxGeometry(3.04, 0.65, 14.2), new THREE.MeshStandardMaterial({ color: 0x1a2a1a, emissive: 0xffd166, emissiveIntensity: 0.35, roughness: 0.2, metalness: 0.3 }));
  winBand.position.set(0, 1.65, 0); g.add(winBand);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.04, 0.3, 14.5), new THREE.MeshStandardMaterial({ color: 0x1a3a2a, roughness: 0.6 }));
  stripe.position.set(0, 1.15, 0); g.add(stripe);
  buildBogie(-5, g); buildBogie(5, g);
  const endZ = isFront ? -7.3 : 7.3;
  for (const lx of [-0.9, 0.9]) {
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), new THREE.MeshStandardMaterial({ color: isFront ? 0xfff2c0 : 0xff2020, emissive: isFront ? 0xffe9a0 : 0xff2020, emissiveIntensity: 1.6 }));
    lamp.position.set(lx, 0.9, endZ); lamp.rotation.y = isFront ? Math.PI : 0; g.add(lamp);
  }
  g.position.set(0, 0, zc); scene.add(g); return g;
}
buildExteriorCar(-15, true);
buildExteriorCar(15, false);
const platformPool = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x9a8548, transparent: true, opacity: 0.10, blending: THREE.AdditiveBlending, depthWrite: false }));
platformPool.rotation.x = -Math.PI / 2; platformPool.position.set(3.4, 0.06, 0); scene.add(platformPool);
// Exterior camera: the train's body from outside, not only the interior.
// The near tunnel wall, its lamps and light strips, and the platform sit
// between an outside camera and the train, so they are hidden while the
// exterior view is on and restored when it is off. The camera orbits the
// train (drag to swing around it); V or the Exterior button toggles back.
let exteriorView = false;
function setExteriorView(on) {
  exteriorView = on;
  const btn = document.getElementById('exteriorBtn');
  if (btn) btn.textContent = on ? 'Interior' : 'Exterior';
  for (const w of tunnelWallMeshes) w.visible = !(on && w.position.x > 0);
  for (const g of tunnelLampGroups) g.visible = !(on && g.position.x > 0);
  for (const tl of tunnelLights) tl.visible = !(on && tl.position.x > 0);
  platformSlab.visible = !on; platformWall.visible = !on;
  if (on) { state.yaw = 0.6; state.pitch = 0; }
  else resetView();
}
const exteriorBtnEl = document.getElementById('exteriorBtn');
if (exteriorBtnEl) exteriorBtnEl.onclick = () => setExteriorView(!exteriorView);
// Drag to look, WASD to move.
// Pointer Events (not mouse-only handlers): the old mousedown-on-canvas +
// mousemove-on-window pair lost the drag whenever the pointer started on an
// overlay, left the canvas, or the input came through as pointer events,
// which is why deliberate drags produced zero rotation. Pointer capture
// keeps the drag on the canvas for mouse, touch and pen alike, and
// touch-action none stops touch drags scrolling the page instead.
canvas.style.touchAction = 'none';
let dragging = false, lx = 0, ly = 0, downX = 0, downY = 0, dragMoved = 0;
function applyDrag(dx, dy) {
  state.yaw -= dx * 0.0012; state.pitch -= dy * 0.0012;
  // Full 360-degree look: the yaw wraps around instead of stopping at
  // a wall, so the player can turn all the way around and see behind.
  if (state.yaw > Math.PI) state.yaw -= Math.PI * 2;
  if (state.yaw < -Math.PI) state.yaw += Math.PI * 2;
  // Look up and down freely, almost straight up and straight down, so
  // the player can turn his head like a person. Stops just short of
  // straight up/down (1.5 rad = 86 deg) so the view never flips over.
  state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch));
}
canvas.addEventListener('pointerdown', e => {
  if (!actActive) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  dragging = true; dragMoved = 0; lx = e.clientX; ly = e.clientY; downX = e.clientX; downY = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture not available, window fallback below still works */ }
  // No preventDefault here: it would suppress the click event that the
  // inspect/raycast handler below relies on. touch-action none (above)
  // already stops touch scrolling and selection during a drag.
});
canvas.addEventListener('pointermove', e => {
  if (!actActive) return;
  if (!dragging) return;
  const dx = e.clientX - lx, dy = e.clientY - ly;
  dragMoved += Math.abs(dx) + Math.abs(dy);
  applyDrag(dx, dy); lx = e.clientX; ly = e.clientY;
});
function endDrag() { dragging = false; }
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
addEventListener('pointerup', endDrag);
addEventListener('blur', endDrag);
// Reset view: restores the default camera position and look direction.
const DEFAULT_VIEW = { x: 0, y: 1.6, z: 4, yaw: 0.23, pitch: 0 };
function resetView() {
  if (!actActive) return;
  if (exteriorView) { exteriorView = false; const btn = document.getElementById('exteriorBtn'); if (btn) btn.textContent = 'Exterior'; setExteriorViewRestore(); }
  camera.position.set(DEFAULT_VIEW.x, DEFAULT_VIEW.y, DEFAULT_VIEW.z);
  state.yaw = DEFAULT_VIEW.yaw; state.pitch = DEFAULT_VIEW.pitch;
}
// Restores the tunnel wall, lamps and platform hidden by the exterior view.
// Kept separate so resetView can turn the exterior view off without recursing.
function setExteriorViewRestore() {
  for (const w of tunnelWallMeshes) w.visible = true;
  for (const g of tunnelLampGroups) g.visible = true;
  for (const tl of tunnelLights) tl.visible = true;
  platformSlab.visible = true; platformWall.visible = true;
}
document.getElementById('resetViewBtn').onclick = resetView;
const keys = {};
addEventListener('keydown', e => { if (!actActive) return; keys[e.key.toLowerCase()] = true; if (e.key.toLowerCase() === 'r') resetView(); if (e.key.toLowerCase() === 'f') toggleFlashlight(); if (e.key.toLowerCase() === 'v') setExteriorView(!exteriorView); });
addEventListener('keyup', e => { if (!actActive) return; keys[e.key.toLowerCase()] = false; });
function animate() {
  if (!actActive) return;
  actRaf = requestAnimationFrame(animate);
  const t = Date.now() / 1000;
  // Frame-rate independent tunnel speed: at 2.7 m/s the lamps stream past
  // the windows at train speed whatever the frame rate (a per-frame step
  // crawls on a slow machine and looked "stopped" after the repair).
  const dt = animate.lastT === undefined ? 0.016 : Math.min(0.1, t - animate.lastT);
  animate.lastT = t;
  const sp = 0.05;
  if (exteriorView) {
    // Exterior orbit: the camera circles the train outside the tunnel wall
    // (hidden while this view is on), looking at the train body and track.
    // Drag swings the orbit around; the pitch raises or lowers the view.
    // The lamps and sleepers stream past, so the train reads as moving.
    const orbitR = 9, orbitH = 2.8 + state.pitch * 2.5;
    camera.position.set(Math.sin(state.yaw) * orbitR, orbitH, Math.cos(state.yaw) * orbitR);
    camera.lookAt(0, 1.3, 0);
  } else {
    if (keys['w']) camera.position.z -= sp; if (keys['s']) camera.position.z += sp;
    if (keys['a']) camera.position.x -= sp; if (keys['d']) camera.position.x += sp;
    camera.position.x = Math.max(-1.05, Math.min(1.05, camera.position.x));
    camera.position.z = Math.max(-7.0, Math.min(7.0, camera.position.z));
    camera.rotation.order = 'YXZ';
    // Slight handheld sway (depth-of-field feel comes from the vignette + grain overlays)
    const sway = document.getElementById('dialogue').classList.contains('hidden') ? 1 : 0.4;
    camera.rotation.y = state.yaw + Math.sin(t * 0.7) * 0.004 * sway;
    camera.rotation.x = state.pitch + Math.sin(t * 0.9 + 1.3) * 0.003 * sway;
    camera.position.y = 1.6 + Math.sin(t * 0.8) * 0.012 * sway;
  }
  // Dust drifts slowly through the light shafts
  const pos = dustGeo.attributes.position;
  for (let i = 0; i < dustCount; i++) {
    let y = pos.getY(i) - 0.0006;
    if (y < 0.15) y = 2.9;
    pos.setY(i, y);
    pos.setX(i, pos.getX(i) + Math.sin(t * 0.4 + i) * 0.0004);
  }
  pos.needsUpdate = true;
  dust.material.opacity = (state.stage === 'blackout') ? 0.25 : 0.35;
  // Shaft dust drifts down through the beams, recycling at the top (reuses the same buffer).
  const sdp = shaftDustGeo.attributes.position;
  for (let i = 0; i < shaftDustCount; i++) {
    let y = sdp.getY(i) - 0.0012;
    if (y < 0.2) y = 2.85;
    sdp.setY(i, y);
  }
  sdp.needsUpdate = true;
  // Relay beacon: pulse the gold glow and bob the marker/arrow so the relay stays unmissable.
  // In blackout the cabinet itself glows bright gold (the prompt promises a
  // "glowing gold signal relay" and the player has to find it in the dark);
  // in normal/battery light it stays dark brass.
  const pulse = 0.5 + 0.5 * Math.sin(t * 3);
  const isBlackout = state.stage === 'blackout';
  relayGlow.material.opacity = (isBlackout ? 0.25 : 0.10) + 0.05 * pulse;
  relayGlow.scale.set(1.5 + 0.2 * pulse, 1.5 + 0.2 * pulse, 1);
  relayMat.emissive.setHex(isBlackout ? 0xaa7d00 : 0x2a1f00);
  relayMat.emissiveIntensity = (isBlackout ? 0.7 : 0.12) + 0.08 * pulse;
  // The whole cabinet glows in blackout, door face included - before, only
  // the body glowed and the face stayed dark brown.
  relayFaceMat.emissive.setHex(isBlackout ? 0xaa7d00 : 0x2a1f00);
  relayFaceMat.emissiveIntensity = (isBlackout ? 0.7 : 0.12) + 0.08 * pulse;
  relayBackplateMat.emissive.setHex(isBlackout ? 0xaa7d00 : 0x2a1f00);
  relayBackplateMat.emissiveIntensity = (isBlackout ? 0.7 : 0.12) + 0.08 * pulse;
  relayMarker.position.y = 2.2 + Math.sin(t * 2) * 0.06;
  relayArrow.position.y = 1.95 + Math.sin(t * 2) * 0.06;
  // Tunnel lights stream past the windows while the train is moving (intro
  // stage, and again after the repair when the train moves off); once the
  // blackout hits, the train is stopped and they freeze. Wall lamps stream
  // at the same speed, and all tunnel light goes dark when the train stops,
  // so blackout stays dark.
  const inTunnel = state.stage === 'intro' || state.stage === 'after';
  if (inTunnel !== tunnelLampsOn) {
    tunnelLampsOn = inTunnel;
    for (const g of tunnelLampGroups) g.visible = inTunnel && !(exteriorView && g.position.x > 0);
    for (const tl of tunnelLights) tl.visible = inTunnel && !(exteriorView && tl.position.x > 0);
    tunnelAheadGlow.visible = inTunnel;
  }
  if (inTunnel) {
    for (const tl of tunnelLights) { tl.position.z += 2.7 * dt; if (tl.position.z > 7.5) tl.position.z = -7.5; }
    for (const g of tunnelLampGroups) { g.position.z += 2.7 * dt; if (g.position.z > 25) g.position.z = -25; }
    for (const sl of trackSleepers) { sl.position.z += 2.7 * dt; if (sl.position.z > 25) sl.position.z = -25; }
  }
  if (state.stage === 'blackout' || state.stage === 'after') {
    if (state.stage === 'blackout') {
      // Flickering red emergency light while the relay is dead
      setLightingMode('blackout');
      redLight.intensity = 4.5 + Math.sin(t * 9) * 1 + (Math.random() > 0.96 ? -2 : 0);
      mainLight.intensity = 0.4 + Math.sin(t * 7) * 0.25;
    } else {
      setLightingMode('battery'); // dim warm battery power after the repair
    }
  }
  // Human idle animation: subtle breathing (whole-group scale). The GLB models are
  // static scans with no skeleton, so there is no head-turn or blink to animate.
  for (const h of humans) {
    const bt = t * 1.1 + h.phase;
    h.group.scale.set(h.baseScale, h.baseScale * (1 + Math.sin(bt) * 0.012), h.baseScale);
    // Seated humans (Walter) hold a posed clip (SitDown): keep their mixer
    // ticking so the pose is re-applied every frame. Walkers update their
    // own mixer in the walking loop below.
    if (!h.walk && h.mixer) {
      try { h.mixer.update(dt); } catch (e) { /* a failed mixer update must never stop the game */ }
    }
  }
  updateSpeakingGestures(t); // speaking bob, nod, lean and turn (no-op with no speaker)
  // Walking: the standing characters patrol a short stretch of the aisle (slow,
  // with a small step bob and facing the direction they walk) so the car feels
  // alive. This runs AFTER the gestures on purpose, so the walked position is
  // the final word each frame and is never overwritten by the gesture rest
  // pose in the same frame. The walkers keep walking even while a dialogue
  // is open (people talk while walking); the click target follows them.
  // The gesture module's rest pose follows the walkers via its 0.002 m
  // outside-move threshold, so it never snaps them back.
  // Rigged walk: each walker also plays its embedded "Walk" clip (arm swing,
  // elbow bend, leg step, knee bend) through an AnimationMixer. The clip
  // walks in place, and the root bone's horizontal position is reset to its
  // rest pose after each mixer update, so the clip can never drag the
  // character away from its patrol path; the group's patrol translation
  // below does the moving. Only the horizontal (x, z) root position is
  // reset, never the rotation, so the clip's turning and bob survive.
  for (const h of humans) {
    if (!h.walk) continue;
    const w = h.walk;
    const g = h.group;
    if (h.mixer) {
      try {
        h.mixer.update(dt);
        if (h.rootBone && h.rootRest) {
          h.rootBone.position.x = h.rootRest.x;
          h.rootBone.position.z = h.rootRest.z;
        }
      } catch (e) { /* a failed mixer update must never stop the patrol */ }
    }
    g.position.z += w.dir * w.speed * dt;
    if (g.position.z > w.maxZ) { g.position.z = w.maxZ; w.dir = -1; }
    if (g.position.z < w.minZ) { g.position.z = w.minZ; w.dir = 1; }
    w.stepPhase += w.speed * dt * 6;
    g.position.y = h.baseY + Math.abs(Math.sin(w.stepPhase)) * 0.025;
    // Face the direction of movement. The rigged Quaternius models face -z
    // in local space (measured from their GLB geometry), so moving +z needs
    // rotation.y = PI and moving -z needs 0 - the opposite of the old scans,
    // which faced +z. Without this flip the walkers moonwalk.
    g.rotation.y = w.dir > 0 ? Math.PI : 0;
    if (h.shadow) { h.shadow.position.x = g.position.x; h.shadow.position.z = g.position.z; }
  }
  updateFlashlight(); // flashlight rides on the camera (no-op when off)
  // Sound: footsteps while moving, heartbeat and score tension by stage.
  // Blackout is tense; a low battery is worse; the debris run is worst.
  const moving = keys['w'] || keys['a'] || keys['s'] || keys['d'];
  let tension = 0.2, hb = 0;
  if (state.stage === 'blackout') { tension = 0.6; hb = 72; }
  else if (state.stage === 'after') { tension = state.timer <= 180 ? 0.85 : 0.35; hb = state.timer <= 180 ? 105 : 0; }
  if (runActive) { tension = Math.max(tension, 0.75); hb = Math.max(hb, 100); }
  setTension(tension);
  soundTick(dt, { moving, heartbeatBpm: hb });
  updateTrainRun(dt); // Act I dodge run, no-op when inactive
  renderer.render(scene, camera);
}
animate();
addEventListener('resize', () => { if (!actActive) return; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
// Click to inspect. A drag that moved more than a few pixels is a look-around,
// not a click, so it must not raycast and open a toast/dialogue on release.
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
canvas.addEventListener('click', e => {
  if (!actActive) return;
  if (dragMoved > 6) { dragMoved = 0; return; }
  dragMoved = 0;
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const runTargets = (runActive && exitMarker && exitMarker.visible) ? [exitMarker] : [];
  const hits = ray.intersectObjects([relay, relayHit, relayFace, relayStrip, relayBackplate, release, panel, board, boardHit, doorL, doorR].concat(runTargets).concat(humanGroups), true);
  if (!hits.length) return;
  let o = hits[0].object; while (o.parent && o.parent !== scene) o = o.parent; // top-level object (model group or named prop)
  interact(o.name || hits[0].object.name);
});
function interact(name) {
  if (name === 'exit' && runActive) { completeTrainRun(false); return; }
  if (name === 'relay' && state.stage === 'blackout') { openRepair(); return; }
  if (name === 'relay') { toast('Signal relay - dead. It needs a repair once the power is out.'); return; }
  if (name === 'release') { toast('Emergency release - locked. Restore the relay first.'); return; }
  if (name === 'panel') { toast('Maintenance panel - wiring inside. Jade knows this panel by heart.'); return; }
  if (name === 'board' && board.visible) { findBoard(); return; }
  if (name === 'jade') { toast('Jade Morales - former MTA signal engineer. She designed this line, and she knows every relay in it.'); return; }
  if (name === 'caleb') { toast('Caleb Bishop, NYPD Transit. Young, earnest, out of his depth - and trying.'); return; }
  if (name === 'nurse') { toast('Nurse Adeyemi - night shift starts in an hour. People are counting on her.'); return; }
  if (name === 'walter') { toast('Walter Simms, 70s. He rode this line when it cost a nickel. He cannot climb stairs.'); return; }
  if (name === 'door') { toast('Doors - sealed while the train is in the tunnel.'); return; }
}

// ---------- Repair mini-game ----------
// ROOT CAUSE of the unresponsive puzzle: the modal was ~600 px tall in a
// 444 px viewport, so the clickable grid sat below the fold inside a
// scrolling modal and the only tiles visible without scrolling were the
// gold TARGET pattern - which is display-only and has no click handler.
// Clicking those gold tiles correctly did nothing. The modal is now
// compact with both grids side by side and Close always visible (see
// index.html / styles.css), and every click updates a visible counter.
const TARGET = [1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0];
let gridState = [];
function repairMatches() { return gridState.filter((v, i) => v === TARGET[i]).length; }
function openRepair() {
  try { sfxRepair(); } catch (e) { /* ignore */ }
  document.getElementById('repairModal').classList.remove('hidden');
  gridState = TARGET.map(() => Math.random() > 0.5 ? 1 : 0);
  document.getElementById('repairClose').textContent = 'Close';
  renderRepair();
}
function renderRepair() {
  const tp = document.getElementById('targetPattern');
  tp.innerHTML = TARGET.map(v => `<div class="tile target-tile ${v ? 'lit' : ''}"></div>`).join('');
  const g = document.getElementById('repairGrid');
  g.innerHTML = '';
  gridState.forEach((v, i) => {
    const d = document.createElement('div');
    d.className = 'tile' + (v ? ' on' : '') + (v === TARGET[i] ? ' match' : '');
    d.dataset.index = i;
    d.title = 'Circuit ' + (i + 1) + ' - click to toggle';
    d.addEventListener('click', () => {
      if (state.repaired) return; // puzzle already solved, do not un-solve it
      gridState[i] = gridState[i] ? 0 : 1; // toggle from current state, not a captured value
      try { sfxRepair(); } catch (e) { /* ignore */ }
      renderRepair();
      checkRepair();
    });
    g.appendChild(d);
  });
  document.getElementById('repairProgress').textContent = 'Matched ' + repairMatches() + ' / 16 - click a tile to toggle it.';
  document.getElementById('repairStatus').textContent = state.repaired ? 'Relay restored - platform lights flicker back on.' : 'Match the gold pattern on the left.';
}
function checkRepair() {
  if (repairMatches() === TARGET.length) {
    state.repaired = true;
    try { sfxPowerRestored(); } catch (e) { /* ignore */ }
    hideToast(); // BLACKOUT banner goes away as soon as the lights return
    document.getElementById('repairProgress').textContent = 'Matched 16 / 16 - relay restored!';
    document.getElementById('repairStatus').textContent = 'Relay restored - platform lights flicker back on.';
    document.getElementById('repairClose').textContent = 'Continue';
    integrity('Transit', 10); integrity('Power', 10);
    setObjectives(3);
  }
}
document.getElementById('repairClose').onclick = () => {
  document.getElementById('repairModal').classList.add('hidden');
  if (state.repaired) hideToast(); // BLACKOUT banner must not linger after the repair
  if (state.repaired && state.stage === 'blackout') { state.stage = 'after'; afterRepair(); }
};

// ---------- Flow ----------
function afterRepair() {
  hideToast();
  // The fifteen minutes of battery start NOW, when the battery comes on -
  // the old timer ran from game start, so a slow intro left almost nothing.
  state.timer = 900; updateHUD();
  // Slide the right-hand door leaves apart into their pockets (move the groups
  // along z, not the leaf meshes, so windows and seals move with them)
  doorGroupL.position.z = -1.55; doorGroupR.position.z = 1.55;
  try { sfxDoor(); } catch (e) { /* ignore */ }
  board.visible = true;
  setAmbient('train'); // the train moves again: rumble returns
  startTrainRun(); // dodge run to the doors, then a short climb out - then the dialogue below
}
function afterRunDialogue() {
  showDialogue([
    { who: 'Jade', text: 'Lights are back - on battery. Fifteen minutes. We move now, or we wait in the dark.' },
    { who: 'Caleb', text: 'Count the passengers. Third car first. Nobody gets left behind.' }
  ], () => countPassengers());
}

// ---------- Act I action: run the car, dodge the debris, climb out ----------
// After the repair the train lurches and the ceiling sheds debris and
// sparks. The player runs (WASD) to the glowing EXIT at the open doors,
// dodging what falls. A hit costs 15 seconds of battery and staggers the
// player briefly - never a fail state. Reaching the doors, clicking the
// EXIT marker, or waiting out the 45 second window all finish the run,
// so this beat can never block progress. Then a short climb out onto
// the platform (hold SPACE), again with an auto-complete so it cannot block.
function buildRunDebris() {
  if (runDebris.length) return;
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x3a2410, emissive: 0xff6a00, emissiveIntensity: 1.2, roughness: 0.5 })
    );
    m.castShadow = false;
    m.visible = false;
    scene.add(m);
    runDebris.push({ mesh: m, active: false, speed: 2.4, cooldown: 0 });
  }
}
function startTrainRun() {
  try {
    buildRunDebris();
    if (!exitMarker) {
      exitMarker = makeActionMarker('EXIT', '#7ac74f');
      if (exitMarker) {
        exitMarker.position.set(1.25, 2.0, 0);
        exitMarker.name = 'exit';
        exitMarker.userData.clickable = true;
        scene.add(exitMarker);
      }
    }
    if (exitMarker) exitMarker.visible = true;
    runActive = true; runTime = 0; runInvuln = 0; runSpawnT = 0;
    showActionBanner('RUN! The train is lurching - dodge the falling debris and reach the glowing EXIT at the doors.');
    toast('Run to the glowing EXIT - WASD to move, dodge the orange debris.');
  } catch (e) { runActive = false; afterRunDialogue(); }
}
function completeTrainRun(auto) {
  if (!runActive) return;
  runActive = false;
  hideActionBanner();
  try {
    if (exitMarker) exitMarker.visible = false;
    for (const d of runDebris) { d.active = false; d.mesh.visible = false; }
  } catch (e) { /* ignore */ }
  if (auto) toast('You make it to the doors as the car steadies.');
  // Short climb out onto the platform: hold SPACE. Releasing pauses the
  // fill; the window is generous and it auto-completes, so it cannot block.
  try {
    const ok = runHoldQTE({
      label: 'CLIMB OUT',
      sub: 'Hold SPACE to climb out onto the platform.',
      holdMs: 1200, windowMs: 8000,
      onDone: () => { afterRunDialogue(); }
    });
    if (!ok) afterRunDialogue();
  } catch (e) { afterRunDialogue(); }
}
function updateTrainRun(dt) {
  if (!runActive) return;
  try {
    runTime += dt;
    if (runInvuln > 0) runInvuln -= dt;
    // Spawn debris above the aisle at random spots.
    runSpawnT -= dt;
    if (runSpawnT <= 0) {
      runSpawnT = 0.45 + Math.random() * 0.3;
      const d = runDebris.find(x => !x.active && x.cooldown <= 0);
      if (d) {
        d.active = true;
        d.speed = 2.2 + Math.random() * 1.2;
        d.mesh.position.set((Math.random() - 0.5) * 2, 2.9, (Math.random() - 0.5) * 12);
        d.mesh.visible = true;
        try { sfxWhoosh(); } catch (e) { /* ignore */ }
      }
    }
    for (const d of runDebris) {
      if (!d.active) { if (d.cooldown > 0) d.cooldown -= dt; continue; }
      d.mesh.position.y -= d.speed * dt;
      d.mesh.rotation.x += dt * 3; d.mesh.rotation.y += dt * 2;
      const p = d.mesh.position;
      if (p.y < 0.15) {
        d.active = false; d.mesh.visible = false; d.cooldown = 0.4 + Math.random() * 0.6;
        continue;
      }
      // A hit: the debris is at body height and close to the camera.
      if (runInvuln <= 0 && p.y > 0.5 && p.y < 2.1 && dist2D(p.x, p.z, camera.position.x, camera.position.z) < 0.45) {
        runInvuln = 1.5;
        state.timer = Math.max(0, state.timer - 15); updateHUD();
        flashScreen('rgba(255,40,30,0.35)');
        try { sfxThud(); } catch (e) { /* ignore */ }
        toast('Debris hits you - 15 seconds of battery lost. Keep moving!');
        d.active = false; d.mesh.visible = false; d.cooldown = 1;
      }
    }
    // Goal: reach the open doors (near the EXIT marker), or the window runs out.
    const dist = dist2D(camera.position.x, camera.position.z, 1.25, 0);
    try { showActionBanner('RUN! Reach the glowing EXIT at the doors - ' + Math.max(0, Math.ceil(dist)) + ' m to go. Debris costs 15s of battery.'); } catch (e) { /* ignore */ }
    if (dist < 1.1 || runTime > 45) completeTrainRun(runTime > 45);
  } catch (e) { completeTrainRun(true); }
}
function countPassengers() {
  showDialogue([
    { who: 'Jade', text: 'Nurse Adeyemi - accounted for. Walter - he is still on the bench. He cannot climb those stairs.' },
    { who: 'Caleb', text: 'I will stay with him. You go ahead and check the platform. Deal?' },
    { who: 'Jade', text: 'Deal. Five minutes, Bishop. Then you are calling the shots again.', choices: [
      { label: '“Thank you, Caleb. I trust you with him.” (Trust +2)', effect: () => trust(2, 'you trusted Caleb') },
      { label: '“Just do it. No time for talk.” (Trust −1)', effect: () => trust(-1, 'dismissive') }
    ] }
  ], () => { state.passengersCounted = true; state.walterHelped = true; setObjectives(4); sealedChoice(); });
}
function sealedChoice() {
  // Sealed / encrypted choice: hidden until the end of Act I.
  // The local simulation is the source of truth for gameplay: the
  // effect sets state.sealedChoice immediately, exactly as before.
  // sealActIChoice() then seals the same pick on Sepolia in the
  // background (fire-and-forget) when a wallet is connected; in
  // demo mode it does nothing, so the game plays unchanged.
  showDialogue([
    { who: 'System', text: 'SEALED CHOICE - Priority power: one line gets full power for 2 hours. The others run low. Your choice is sealed - nobody, not even the other players, can see it until the reveal.' },
    { who: 'Jade', text: 'Hospital, residential, or the treatment plant. There is no clean answer. Choose - and own it.', choices: [
      { label: 'Hospital - full power', effect: () => { state.sealedChoice = 'Hospital'; integrity('Water', -5); sealActIChoice('Hospital'); } },
      { label: 'Residential - dialysis clinic line', effect: () => { state.sealedChoice = 'Residential'; integrity('Power', -5); sealActIChoice('Residential'); } },
      { label: 'Industrial - water treatment plant', effect: () => { state.sealedChoice = 'Industrial'; integrity('Transit', -5); sealActIChoice('Industrial'); } }
    ] }
  ], () => { setObjectives(5); toast('Choice sealed. Find the green RESET board behind you.'); });
}
// Seal the Act I pick on Sepolia when a wallet is connected. Never
// blocks the dialogue: the seal runs in the background, and if it
// fails the game carries on with the local seal.
function sealActIChoice(label) {
  sealPriorityChoice(PRIORITY_VALUES[label], toast);
}
function findBoard() {
  if (state.boardFound) return;
  state.boardFound = true;
  state.inventory.push('RESET circuit board');
  updateHUD(); setObjectives(6);
  showDialogue([
    { who: 'Jade', text: 'Hand-soldered. MTA capacitors. Labelled with one word: RESET. Someone who used to work here built this.' },
    { who: 'Caleb', text: 'So this was not an accident. Someone tested the system - on us.' },
    { who: 'Jade', text: 'And they are waiting for someone to prove them wrong. That someone is us.' }
  ], endAct);
}
function endAct() {
  // Carry Act I forward: Act II reads this from localStorage (Trust, System
  // Integrity, sealed choice, evidence). Defaults apply if it is missing.
  try {
    localStorage.setItem('lastSignalAct1', JSON.stringify({
      trust: state.trust, integrity: state.integrity, sealedChoice: state.sealedChoice,
      inventory: state.inventory, boardFound: state.boardFound,
      // True only if the Act I pick was sealed on Sepolia this session.
      // Act III reads it to say whether the on-chain record exists.
      prioritySealedOnChain: wasSealedOnChain('priority')
    }));
  } catch (e) { /* private mode: Act II starts from its defaults */ }
  const el = document.getElementById('endCard');
  el.classList.remove('hidden');
  document.getElementById('endSummary').innerHTML =
    `<p>Act I complete - the passengers are moving to the platform, the relay is repaired, and the RESET board is in your hands. Caleb is staying with Walter on the bench until help reaches him.</p>` +
    `<p><strong>Sealed choice revealed:</strong> ${state.sealedChoice || 'none'} got priority power. ` +
    (wasSealedOnChain('priority')
      ? `Your choice was sealed on Sepolia with FHEVM - encrypted until this moment, now revealed here.`
      : `In the full Zama version this choice would have stayed encrypted on-chain until this moment.`) + `</p>` +
    `<p>Trust: ${state.trust} / 10 &nbsp;•&nbsp; System Integrity - Transit ${state.integrity.Transit}, Water ${state.integrity.Water}, Power ${state.integrity.Power}, Comms ${state.integrity.Comms}</p>` +
    `<p>Next: Act II - City of Wires. Press "Begin Act II" below to continue.</p>`;
  if (window.__lsActManager) window.__lsActManager.setEndCardButtons('act1');
}

// Stop this act cleanly so the next act can load on the same page: halt
// the animate loop and the battery timer, silence speech, hide any open
// dialogue or modal, and dispose this act's scene (the shared renderer
// in core.js is never disposed).
export function stopAct() {
  actActive = false; dialogueActive = false; dlgQueue = []; dlgCb = null;
  if (actRaf) { try { cancelAnimationFrame(actRaf); } catch (e) { /* ignore */ } actRaf = 0; }
  if (batteryInterval) { try { clearInterval(batteryInterval); } catch (e) { /* ignore */ } batteryInterval = 0; }
  try { stopSpeaking(); } catch (e) { /* ignore */ }
  try { document.getElementById('dialogue').classList.add('hidden'); } catch (e) { /* ignore */ }
  try { document.getElementById('repairModal').classList.add('hidden'); } catch (e) { /* ignore */ }
  try { disposeScene(scene); } catch (e) { /* ignore */ }
}
document.getElementById('cinemaBtn').onclick = () => {
  document.getElementById('letterboxTop').classList.toggle('hidden');
  document.getElementById('letterboxBottom').classList.toggle('hidden');
};
// Timer
batteryInterval = setInterval(() => {
  if (!actActive) return;
  if (state.timer > 0) { state.timer--; updateHUD(); if (state.timer === 0) toast('Battery dead - emergency lights are out. The story continues in the dark.'); }
}, 1000);
// Intro: the game starts only after the character models load (or fail clearly).
setObjectives(0); updateHUD(); initZamaUI(); initVoiceUI();
initSoundUI(); // procedural sound: ambient, effects, score, sound toggle
initFlashlight(scene, camera); // F key / HUD button, dark sections only
setAmbient('train'); // the train is moving: rumble and tunnel wind
setTension(0.2);
loadHumans();
