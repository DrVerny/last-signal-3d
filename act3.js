import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { canvas, renderer, disposeScene } from './core.js';
import { FINAL_VALUES, sealFinalChoice, wasSealedOnChain, initZamaUI, setupRevealButton } from './zama.js';
import { speakLine, stopSpeaking, initVoiceUI } from './speak.js';
import { registerHumans, updateSpeakingGestures } from './gestures.js';
import { registerLipSyncHumans } from './lipsync.js';
import { initSoundUI, setAmbient, setTension, soundTick, sfxDoor, sfxBoom, sfxGavel, sfxShutter, sfxRev, sfxTrainPass, sfxThud, sfxAlert } from './sound.js';
import { runHoldQTE } from './qte.js';
import { showActionBanner, hideActionBanner, flashScreen, dist2D, makeActionMarker } from './action.js';
// THE LAST SIGNAL - Act III: The Human Signal - 3D prototype
// Chapters from the script (short original dialogue in its spirit; no long
// verbatim copying): 1. The Control Center (the final sealed choice),
// 2. The Courtroom, 3. The Transport Van + Escape, 4. The Safehouse,
// 5. The Press Conference, 6. The Aftermath + The Bridge at dawn.
// Trust, System Integrity, evidence and the Act II bridge path carry over
// from localStorage (saved by Act II); defaults apply when played standalone.
// The final choice is SEALED like Act I's: hidden until the end card, where
// the ending is revealed. In demo mode it is simulated locally; when a wallet
// is connected on Sepolia (see zama.js), the choice is ALSO encrypted with
// FHEVM as an euint8 vote, exactly like Sealed Fortune.
// Single-page lifecycle (see acts.js): this module boots on import, and
// the act manager calls stopAct() before the next act loads. actActive
// gates the animate loop and input handlers so a stopped act cannot keep
// rendering or responding. It starts true because import is the start.
let actActive = true;
let actRaf = 0;
let act2 = { trust: 6, integrity: { Transit: 80, Water: 75, Power: 70, Comms: 40 }, evidence: [], waterChoice: 'Hospital', bombDisarmed: true, bridgePath: 'undecided' };
try {
  const saved = JSON.parse(localStorage.getItem('lastSignalAct2') || 'null');
  if (saved) act2 = {
    trust: saved.trust ?? 6,
    integrity: saved.integrity || act2.integrity,
    evidence: saved.evidence || [],
    waterChoice: saved.waterChoice || 'Hospital',
    bombDisarmed: saved.bombDisarmed !== false,
    bridgePath: saved.bridgePath || 'undecided'
  };
} catch (e) { /* private mode: defaults */ }
let act1Sealed = null;
let act1SealedOnChain = false;
try { const a1 = JSON.parse(localStorage.getItem('lastSignalAct1') || 'null'); if (a1) { act1Sealed = a1.sealedChoice || null; act1SealedOnChain = a1.prioritySealedOnChain === true; } } catch (e) { /* ignore */ }
const state = {
  trust: act2.trust,
  integrity: { Transit: act2.integrity.Transit ?? 80, Water: act2.integrity.Water ?? 75, Power: act2.integrity.Power ?? 70, Comms: act2.integrity.Comms ?? 40 },
  inventory: ['Whistleblower files', 'RESET board'],
  evidence: act2.evidence.slice(),
  waterChoice: act2.waterChoice, bombDisarmed: act2.bombDisarmed, bridgePath: act2.bridgePath,
  act1Sealed, chapter: 1, finalChoice: null, finalSealed: false, escapeStep: 0,
  yaw: 0, pitch: 0
};
const OBJ = {
  1: ['Reach the MTA Rail Control Center terminal', 'Decide how to fix the EBS virus - and seal the choice', 'The choice stays sealed until the end'],
  2: ['Stand before Judge Ellsworth', 'Hear the sentence - and what comes with it'],
  3: ['Ride the transport van to lockup', 'When the doors open, run', 'Cross the rooftop - down the fire escape to the SUV'],
  4: ['Meet Owen Marsh and the ex-city workers', 'See the files, the witnesses, the evidence', 'Agree the plan: the Attorney General\u2019s press conference, 9 AM'],
  5: ['Step up to the podium', 'Tell the city the truth - and hand over the folder'],
  6: ['One month later: City Hall steps', 'Dawn on the Williamsburg Bridge - the ending is revealed']
};
function setObjectives(doneCount) {
  const list = OBJ[state.chapter] || [];
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
function hideToast() {
  const t = document.getElementById('toast'); t.style.opacity = 0;
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
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
      if (c.locked) { b.disabled = true; b.style.opacity = 0.55; b.title = 'Locked - see the requirement in the label'; }
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
function screenTexture(lines, fg) {
  return canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#061a12'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg || '#2aff7a'; ctx.font = 'bold 22px monospace'; ctx.textAlign = 'left';
    lines.forEach((l, i) => ctx.fillText(l, 18, 36 + i * 30));
  });
}
function mapTexture() {
  return canvasTexture(512, 384, (ctx, w, h) => {
    ctx.fillStyle = '#e8e0c8'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#4a6a8a'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(40, 320); ctx.bezierCurveTo(180, 200, 320, 260, 470, 80); ctx.stroke();
    ctx.strokeStyle = '#8a4a3a'; ctx.beginPath(); ctx.moveTo(60, 60); ctx.lineTo(460, 330); ctx.stroke();
    ctx.fillStyle = '#111'; ctx.font = 'bold 24px Arial'; ctx.fillText('CITY GRID - EVIDENCE MAP', 20, 36);
    ctx.fillStyle = '#c02020';
    for (const [x, y] of [[120, 240], [250, 180], [360, 260], [200, 300]]) { ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill(); }
  });
}
// Road surface: dark asphalt with a dashed yellow centre line and white edge
// lines, repeated along the length so the dashes stay a sensible size.
function roadTexture() {
  return canvasTexture(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#23262a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2a2e33';
    for (let i = 0; i < 120; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(10, 0, 6, h); ctx.fillRect(240, 0, 6, h);
    ctx.fillStyle = '#d8b400';
    for (let y = 0; y < h; y += 64) ctx.fillRect(124, y, 8, 32);
  }, 1, 4);
}

// ---------- Renderer / scene ----------
// Renderer and canvas are shared with the other acts (see core.js): one
// WebGL context for the whole single-page game. This act sets only its
// own exposure on the shared renderer.
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d10);
scene.fog = new THREE.FogExp2(0x0a0d10, 0.02);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 1.7, 8);
const ambient = new THREE.AmbientLight(0xbfc8d4, 0.5); scene.add(ambient);
const hemi = new THREE.HemisphereLight(0x9db8d4, 0x2a2418, 0.4); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 1.2); sun.position.set(12, 20, 8);
sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); scene.add(sun);
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
function hitBox(parent, w, h, d, x, y, z, name) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  m.position.set(x, y, z); m.name = name; m.userData.clickable = true; parent.add(m); return m;
}
// Chapter groups: only one visible at a time.
const gControl = new THREE.Group(); scene.add(gControl);
const gCourt = new THREE.Group(); scene.add(gCourt); gCourt.visible = false;
const gEscape = new THREE.Group(); scene.add(gEscape); gEscape.visible = false;
const gSafe = new THREE.Group(); scene.add(gSafe); gSafe.visible = false;
const gPress = new THREE.Group(); scene.add(gPress); gPress.visible = false;
const gBridge = new THREE.Group(); scene.add(gBridge); gBridge.visible = false;
const GROUPS = { 1: gControl, 2: gCourt, 3: gEscape, 4: gSafe, 5: gPress, 6: gBridge };
const VIEWS = {
  1: { pos: [0, 1.7, 8], yaw: 0, x: [-8, 8], z: [-4, 11] },
  2: { pos: [0, 1.7, 7], yaw: 0, x: [-6, 6], z: [-2, 10] },
  3: { pos: [0, 2.4, 10.5], yaw: 0, x: [-8, 8], z: [-6, 12] }, // raised and pulled back so the road, the police bus and the militant van are all in frame
  4: { pos: [0, 1.7, 8], yaw: 0, x: [-8, 8], z: [-4, 11] },
  5: { pos: [0, 1.7, 7], yaw: 0, x: [-6, 6], z: [-2, 10] },
  6: { pos: [0, 2.0, 10], yaw: 0, x: [-1.5, 1.5], z: [-12, 12] }
};
let camBounds = VIEWS[1];
let camY = 1.7; // camera height; the rooftop stage raises it, dawn raises it a little
function resetView() {
  if (!actActive) return;
  const v = VIEWS[state.chapter];
  camera.position.set(v.pos[0], v.pos[1], v.pos[2]);
  state.yaw = v.yaw; state.pitch = 0; camBounds = v;
  camY = v.pos[1]; // the chapter view carries its own height (ch. 3 is raised so the road reads)
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
  state.pitch = Math.max(-0.6, Math.min(0.6, state.pitch));
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

// ---------- Characters ----------
const humans = [];
const humanGroups = [];
const modelGroups = {};
function placeHuman(group, name, x, z, faceYaw, baseScale) {
  group.position.set(x, 0, z); group.rotation.y = faceYaw;
  group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  humans.push({ group, name, baseScale, phase: Math.random() * 6 });
  humanGroups.push(group); modelGroups[name] = { group };
  return group;
}
function reparentCast(name, group, x, z, yaw) {
  const g = modelGroups[name] && modelGroups[name].group;
  if (!g) return;
  if (g.parent) g.parent.remove(g);
  g.position.set(x, 0, z); g.rotation.y = yaw;
  group.add(g);
}
function cloneCaleb(base, name, coatColor, group, x, z, yaw) {
  const g = base.group.clone(true);
  g.name = name;
  const coat = new THREE.MeshStandardMaterial({ color: coatColor, roughness: 0.85, metalness: 0.02 });
  g.traverse(o => { if (o.isMesh && o.material && o.material.name && o.material.name.indexOf('casualsuit') !== -1) o.material = coat; });
  g.children = g.children.filter(c => c.position.y <= 1.0); // drop Caleb's cap, brim and badge
  group.add(g); placeHuman(g, name, x, z, yaw, base.scale);
  return g;
}
// Durag + face wrap for a militant: dark cloth cap over the crown, a tail
// hanging down the back of the head, and a wrap across the lower face so the
// nose and mouth are hidden while the eyes stay clear. Positions are in the
// character group's local units (head centre near y 1.76, face front +z),
// so the covering scales with the model and sits on the head, not floating.
function addDurag(group) {
  const cloth = new THREE.MeshStandardMaterial({ color: 0x16161c, roughness: 0.95, metalness: 0 });
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.145, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), cloth);
  cap.position.set(0, 1.74, -0.02); cap.castShadow = true; group.add(cap);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.02), cloth);
  tail.position.set(0, 1.62, -0.15); tail.rotation.x = 0.12; tail.castShadow = true; group.add(tail);
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), cloth);
  knot.position.set(0, 1.78, -0.15); group.add(knot);
  const wrap = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.06), cloth);
  wrap.position.set(0, 1.6, 0.1); wrap.castShadow = true; group.add(wrap);
}
async function loadHumans() {
  const loadingText = document.getElementById('loadingText');
  const loadingError = document.getElementById('loadingError');
  const loadingContinue = document.getElementById('loadingContinue');
  const loader = new GLTFLoader();
  const failures = [];
  let calebBase = null;
  try {
    loadingText.textContent = 'Loading characters... Jade';
    const jade = await loader.loadAsync('models/jade.glb');
    const jg = jade.scene; jg.name = 'jade';
    const jb = new THREE.Box3().setFromObject(jg); const js = new THREE.Vector3(); jb.getSize(js);
    const jscale = 1.70 / js.y; jg.scale.setScalar(jscale);
    gControl.add(jg); placeHuman(jg, 'jade', -1.4, 4.5, Math.PI, jscale);
  } catch (e) { failures.push('jade'); }
  try {
    loadingText.textContent = 'Loading characters... Caleb';
    const caleb = await loader.loadAsync('models/caleb.glb');
    const cg = caleb.scene; cg.name = 'caleb';
    const cb = new THREE.Box3().setFromObject(cg); const cs = new THREE.Vector3(); cb.getSize(cs);
    const cscale = 1.88 / cs.y; cg.scale.setScalar(cscale);
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
    gControl.add(cg); placeHuman(cg, 'caleb', 1.4, 4.5, Math.PI, cscale);
  } catch (e) { failures.push('caleb'); }
  try {
    loadingText.textContent = 'Loading characters... Nurse Adeyemi';
    const nurse = await loader.loadAsync('models/adeyemi.glb');
    const ng = nurse.scene; ng.name = 'nurse';
    const nb = new THREE.Box3().setFromObject(ng); const ns = new THREE.Vector3(); nb.getSize(ns);
    const nscale = 1.68 / ns.y; ng.scale.setScalar(nscale);
    gCourt.add(ng); placeHuman(ng, 'nurse', -4.5, 2, 0.5, nscale);
  } catch (e) { failures.push('nurse'); }
  if (calebBase) {
    // Stand-ins from Caleb's scan, recoloured: the judge, Owen Marsh, the
    // Attorney General, an MTA official, Derrick in the gallery, and the
    // masked leader of the van ambush.
    cloneCaleb(calebBase, 'judge', 0x1a1a1a, gCourt, 0, -4.5, 0);
    cloneCaleb(calebBase, 'owen', 0x5a4632, gSafe, -2.5, -2, 0.4);
    cloneCaleb(calebBase, 'ag', 0x222226, gPress, 2.5, -3, Math.PI);
    cloneCaleb(calebBase, 'mta', 0x3a3a40, gControl, 3.5, -1, -0.6);
    cloneCaleb(calebBase, 'derrick', 0x3a3a3a, gCourt, 4.5, 2, -0.5);
    const leaderG = cloneCaleb(calebBase, 'leader', 0x0a0a0a, gEscape, 0, -3, 0);
    addDurag(leaderG); // the masked leader: face covered
    // A live courtroom: two lawyers at the counsel tables, a witness in the
    // stand, four people seated in the gallery pews, and a court officer.
    cloneCaleb(calebBase, 'lawyerP', 0x1a2a4a, gCourt, -2.6, 2.6, Math.PI);
    cloneCaleb(calebBase, 'lawyerD', 0x2a2a2e, gCourt, 2.6, 2.6, Math.PI);
    const wit = cloneCaleb(calebBase, 'witness', 0x4a3a2a, gCourt, -3.2, -2.5, 0);
    wit.position.y = -0.35; // sunk so only the upper body shows above the stand: reads as seated
    for (const [gx, gz, nm] of [[-3.5, 1, 'gallery1'], [3.5, 1, 'gallery2'], [-3.5, 3, 'gallery3'], [3.5, 3, 'gallery4']]) {
      const gg = cloneCaleb(calebBase, nm, 0x3a3f45, gCourt, gx, gz, Math.PI);
      gg.position.y = -0.35; // seated in the gallery pew: torso above the bench back
    }
    cloneCaleb(calebBase, 'officer', 0x1a1a22, gCourt, 3.4, -3.0, 0);
    // The van ambush crew: two more militants by the militant van, durags on.
    // They stand on the raised sidewalk, so their feet sit at its height.
    const mil1 = cloneCaleb(calebBase, 'militant1', 0x0a0a0a, gEscape, -4.8, 1.5, 1.2);
    mil1.position.y = 0.14; addDurag(mil1);
    const mil2 = cloneCaleb(calebBase, 'militant2', 0x111114, gEscape, -4.2, 3.2, 1.2);
    mil2.position.y = 0.14; addDurag(mil2);
  }
  registerHumans(humans); // speaking gestures use the loaded models
  registerLipSyncHumans(humans); // jaw morph lip-sync uses the same loaded models
  if (failures.length) {
    loadingError.classList.remove('hidden');
    loadingError.textContent = 'Could not load: ' + failures.join(', ') + '. The game can still start without them.';
    loadingContinue.classList.remove('hidden');
    loadingContinue.onclick = () => { document.getElementById('loading').classList.add('hidden'); startChapter1(); };
    loadingText.textContent = 'Some characters failed to load.';
  } else {
    document.getElementById('loading').classList.add('hidden');
    startChapter1();
  }
}

// ---------- Chapter 1: The Control Center ----------
// EBS virus countdown (fiction: 12 hours; ticks in real seconds for drama).
let ebsSeconds = 12 * 3600;
function ebsTick() {
  if (!actActive) return;
  if (state.chapter !== 1) return;
  if (ebsSeconds > 0) ebsSeconds--;
  const h = Math.floor(ebsSeconds / 3600), m = Math.floor(ebsSeconds % 3600 / 60), s = ebsSeconds % 60;
  document.getElementById('timerVal').textContent = h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  document.getElementById('timerBar').style.width = (ebsSeconds / (12 * 3600) * 100) + '%';
}
setInterval(ebsTick, 1000);
let ebsScreen;
function buildControl() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), stdMat({ color: 0x1a1e22, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; gControl.add(floor);
  box(gControl, 20, 4, 0.4, 0x2a2f33, 0, 2, -5, null, { roughness: 0.9 });
  // Monitor wall: city systems at a glance.
  const screens = [
    ['TRANSIT  80%', '#2aff7a'], ['WATER  75%', '#2aff7a'],
    ['POWER  70%', '#ffd166'], ['COMMS  40%', '#ff5a3a']
  ];
  screens.forEach(([txt, fg], i) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshStandardMaterial({ map: screenTexture([txt, 'NOMINAL'], fg), roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.25, emissiveMap: screenTexture([txt, 'NOMINAL'], fg) }));
    s.position.set(-6 + i * 4, 2.2, -4.75); gControl.add(s);
  });
  // The EBS warning screen: big, red, impossible to miss.
  ebsScreen = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.6), new THREE.MeshStandardMaterial({ map: screenTexture(['EBS VIRUS DETECTED', 'TRIGGERS IN 12:00:00', 'FAKE ALL-CLEAR + EVACUATION'], '#ff3a2a'), roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.35, emissiveMap: screenTexture(['EBS VIRUS DETECTED', 'TRIGGERS IN 12:00:00', 'FAKE ALL-CLEAR + EVACUATION'], '#ff3a2a') }));
  ebsScreen.position.set(0, 3.6, -4.75); ebsScreen.name = 'ebs'; ebsScreen.userData.clickable = true; gControl.add(ebsScreen);
  hitBox(gControl, 6, 2.2, 0.6, 0, 3.6, -4.6, 'ebs');
  // Terminal desk where the fix is entered.
  box(gControl, 3.2, 0.9, 1.0, 0x2a2f33, 0, 0.45, 1.5, null, { roughness: 0.6, metalness: 0.3 });
  const term = box(gControl, 1.6, 1.0, 0.1, 0x111111, 0, 1.3, 1.4, 'terminal', { roughness: 0.3 });
  term.rotation.x = -0.2;
  const termScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), new THREE.MeshStandardMaterial({ color: 0x061a12, emissive: 0x2aff7a, emissiveIntensity: 0.6, roughness: 0.3 }));
  termScreen.position.set(0, 1.32, 1.34); termScreen.rotation.x = -0.2; gControl.add(termScreen);
  hitBox(gControl, 2.2, 1.8, 1.0, 0, 1.3, 1.4, 'terminal');
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('MTA RAIL CONTROL CENTER', '#111111', '#e8e8e8', 'MIDTOWN - 4:00 AM'), transparent: true, depthWrite: false }));
  sign.scale.set(5, 1.25, 1); sign.position.set(0, 4.6, -4.6); gControl.add(sign);
  blobShadow(gControl, -1.4, 4.5, 0.9, 0.9, 0.55);
  blobShadow(gControl, 1.4, 4.5, 0.9, 0.9, 0.55);
  blobShadow(gControl, 3.5, -1, 0.9, 0.9, 0.5);
}
// Seal the Act III pick on Sepolia when a wallet is connected. Never
// blocks the dialogue: the seal runs in the background, and if it
// fails the game carries on with the local seal.
function sealActIIIChoice(key) {
  sealFinalChoice(FINAL_VALUES[key], toast);
}
function finalChoiceDialogue() {
  if (state.finalSealed) { toast('The choice is sealed. It stays sealed until the end.'); return; }
  const canRebuild = state.trust >= 8 && state.evidence.length >= 4;
  const canThirdWay = state.trust === 10 && state.bridgePath === 'best' && state.evidence.length >= 5;
  const lockedNote = 'Rebuild needs Trust 8+ and 4 pieces of evidence (you have Trust ' + state.trust + ', ' + state.evidence.length + ' evidence). '
    + 'The third way needs Trust 10, the trust dialogue at the bridge, and all 5 evidence pieces.';
  const choices = [
    { label: 'A - QUICK FIX: restore the old code, 30 minutes, no changes', effect: () => { state.finalChoice = 'quick'; integrity('Comms', 10); sealActIIIChoice('quick'); } }
  ];
  if (canRebuild) choices.push({ label: 'B - REBUILD: transparent logs, public oversight, whistleblower protections (4 hours, partial outage)', effect: () => { state.finalChoice = 'rebuild'; integrity('Comms', 15); integrity('Power', -10); sealActIIIChoice('rebuild'); } });
  else choices.push({ label: 'B - REBUILD: transparent logs, public oversight, whistleblower protections (LOCKED - needs Trust 8+ and 4 evidence; you have Trust ' + state.trust + ', ' + state.evidence.length + ' evidence)', locked: true });
  if (canThirdWay) choices.push({ label: 'C - THE THIRD WAY: rebuild AND expose the official who buried your audit', effect: () => { state.finalChoice = 'thirdway'; integrity('Comms', 20); sealActIIIChoice('thirdway'); } });
  else choices.push({ label: 'C - THE THIRD WAY: rebuild AND expose the official who buried your audit (LOCKED - needs Trust 10, the best bridge path, and 5 evidence)', locked: true });
  showDialogue([
    { who: 'MTA Official', text: 'We need to restore the EBS now. The virus triggers in twelve hours. If we do not fix it -' },
    { who: 'Jade Morales', text: 'I know what happens if we do not fix it. The question is HOW we fix it. Two options. Quick fix - restore the old code, no changes, back to normal in thirty minutes.' },
    { who: 'Jade Morales', text: 'Or rebuild. Transparent audit logs. Public oversight dashboard. Mandatory whistleblower protections. Four hours. And a partial outage - some neighborhoods lose power for six hours.' },
    { who: 'MTA Official', text: 'That is unacceptable. We cannot just -' },
    { who: 'Jade Morales', text: 'Bury it again? That is what got us here. ' + (canRebuild || canThirdWay ? '' : lockedNote) },
    { who: 'Caleb Bishop', text: 'My dad drove a bus for thirty years. He said the city does not run on gas. It runs on trust. And somebody has to keep it running.' },
    { who: 'System', text: 'SEALED CHOICE - how does the city fix the EBS? Your choice is sealed, like Act I: nobody sees it until the end.' , choices }
  ], () => {
    state.finalSealed = true;
    state.inventory.push('Sealed repair plan'); updateHUD(); setObjectives(2);
    showDialogue([
      { who: 'Jade Morales', text: 'Then it is decided. Sealed. Whatever happens next - the choice is made.' },
      { who: 'Caleb Bishop', text: '...They are here for us, Jade. The courtroom is next.' }
    ], () => startChapter2());
  });
}
function startChapter1() {
  state.chapter = 1; resetView(); hideToast();
  for (const [n, g] of Object.entries(GROUPS)) g.visible = (parseInt(n, 10) === 1);
  setObjectives(0); updateHUD();
  document.getElementById('timerLabel').textContent = 'EBS virus';
  ebsTick();
  showDialogue([
    { who: 'Jade Morales', text: 'Four AM. Thirty-six hours after the first blackout. MTA Rail Control Center, Midtown. Derrick Shaw left one last fail-safe: a virus in the Emergency Broadcast System.' },
    { who: 'Caleb Bishop', text: 'Twelve hours, and it broadcasts a fake all-clear - then a fake evacuation order. Mass panic.' },
    { who: 'Jade Morales', text: 'I have the fix. But it needs a choice - and the choice is the whole game. Click the terminal when you are ready.' }
  ], () => { toast('Click the glowing terminal to decide how the city fixes the EBS.'); });
}

// ---------- Chapter 2: The Courtroom ----------
function buildCourt() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), stdMat({ color: 0x5a4632, roughness: 0.7 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; gCourt.add(floor);
  box(gCourt, 16, 3.4, 0.4, 0x4a3423, 0, 1.7, -5, null, { roughness: 0.85 });
  // Judge's bench, raised, with the seal.
  box(gCourt, 6, 0.5, 2, 0x3a2a18, 0, 0.25, -4, null, { roughness: 0.8 });
  const bench = box(gCourt, 5, 1.2, 1.2, 0x4a3423, 0, 1.1, -4.2, 'bench', { roughness: 0.7 });
  bench.rotation.y = 0;
  hitBox(gCourt, 5.5, 2, 1.6, 0, 1.1, -4.2, 'bench');
  const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.06, 20), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.25 }));
  seal.rotation.x = Math.PI / 2; seal.position.set(0, 1.5, -3.55); gCourt.add(seal);
  // Flags either side of the bench.
  for (const fx of [-3.6, 3.6]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 8), stdMat({ color: 0xd4af37, metalness: 0.8, roughness: 0.4 }));
    pole.position.set(fx, 1.3, -4.6); gCourt.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshStandardMaterial({ color: fx < 0 ? 0x1a3a8a : 0x8a1a1a, roughness: 0.9, side: THREE.DoubleSide }));
    flag.position.set(fx + (fx < 0 ? 0.45 : -0.45), 2.2, -4.6); gCourt.add(flag);
  }
  // Gallery benches.
  for (const gz of [1, 3, 5]) for (const gx of [-3.5, 3.5]) {
    box(gCourt, 3, 0.45, 0.8, 0x3a2a18, gx, 0.55, gz, null, { roughness: 0.85 });
    box(gCourt, 3, 0.9, 0.12, 0x3a2a18, gx, 1.0, gz + 0.35, null, { roughness: 0.85 });
  }
  // Witness stand + defendant table.
  box(gCourt, 1.4, 1.1, 1.0, 0x4a3423, -3.2, 0.55, -2.5, null, { roughness: 0.8 });
  box(gCourt, 3.4, 0.75, 1.2, 0x2a2118, 0, 0.38, 2.2, null, { roughness: 0.8 });
  // Counsel tables: prosecution on the left, defence on the right.
  box(gCourt, 1.6, 0.75, 1.0, 0x2a2118, -2.6, 0.38, 1.6, null, { roughness: 0.8 });
  box(gCourt, 1.6, 0.75, 1.0, 0x2a2118, 2.6, 0.38, 1.6, null, { roughness: 0.8 });
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('NEW YORK SUPREME COURT', '#111111', '#e8e8e8', ''), transparent: true, depthWrite: false }));
  sign.scale.set(5, 1.25, 1); sign.position.set(0, 4.4, -4.8); gCourt.add(sign);
  blobShadow(gCourt, 0, 2.5, 1.2, 1.2, 0.5);
  blobShadow(gCourt, -4.5, 2, 0.9, 0.9, 0.5);
  blobShadow(gCourt, 4.5, 2, 0.9, 0.9, 0.5);
}
function startChapter2() {
  state.chapter = 2; resetView(); hideToast();
  for (const [n, g] of Object.entries(GROUPS)) g.visible = (parseInt(n, 10) === 2);
  reparentCast('jade', gCourt, -0.8, 2.8, Math.PI);
  reparentCast('caleb', gCourt, 0.8, 2.8, Math.PI);
  setObjectives(0); updateHUD();
  setAmbient('court'); // the courtroom: low murmur and room tone
  setTension(0.25);
  try { sfxGavel(); } catch (e) { /* ignore */ } // the gavel falls as court opens
  document.getElementById('timerLabel').textContent = 'Sentence';
  document.getElementById('timerVal').textContent = '90 days';
  document.getElementById('timerBar').style.width = '100%';
  showDialogue([
    { who: 'Judge Ellsworth', text: 'Miss Morales. Mister Bishop. I have reviewed the evidence, the testimony, and the unusual circumstances of this case. You broke the law. That is not in dispute. But you also saved lives. That is also not in dispute.' },
    { who: 'Judge Ellsworth', text: 'Mister Bishop. You had a choice between your badge and your conscience. You chose your conscience. In my courtroom, that counts for something. But it does not erase the law.' },
    { who: 'Judge Ellsworth', text: 'I am sentencing you both to ninety days in county lockup. Credit for time served. Probation for two years. And a mandatory public service requirement - four hundred hours each, working with the city\u2019s infrastructure oversight committee.' },
    { who: 'Judge Ellsworth', text: 'Miss Morales. You were right. The system failed. But that does not mean you get to break it. It means you get to fix it - the right way.' }
  ], () => {
    setObjectives(1);
    showDialogue([
      { who: 'Nurse Adeyemi', text: 'Miss Morales. I wanted you to know - the hospital. The dialysis clinic. They are both fine. Because of you.' },
      { who: 'Jade Morales', text: '...Thank you.' },
      { who: 'Nurse Adeyemi', text: 'No. Thank you.' }
    ], () => { setObjectives(2); toast('The court officers lead you out. Click the van doors when they come for you.'); setTimeout(() => startChapter3(), 1200); });
  });
}

// ---------- Chapter 3: The Transport Van + The Escape ----------
let vanDoorL, vanDoorR, trainMesh;
let policeLightL = null, policeLightR = null; // flashing roof bar on the police bus
let militantVan = null; // the militants' van, animated in the chase
let ramPuff = null; // dust at the spot where the van rammed the bus
const dustPuffs = []; // drifting dust sprites, reused
// The militant van's chase: rammed into the bus, then it pulls back, turns
// onto the road and drifts away down the street, looping behind the camera.
const vanChase = { phase: 'rammed', t: 0, fromX: 0, fromZ: 0, fromYaw: 0, toX: 0, toZ: 0, toYaw: 0, z: 0, spawnT: 0 };
function buildEscape() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), stdMat({ color: 0x2a2f33, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; gEscape.add(ground);
  // The road: a marked asphalt strip running the length of the scene, so the
  // chase plays out on a street the camera can see, not a blank floor.
  const road = new THREE.Mesh(new THREE.PlaneGeometry(7, 34), new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.95 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0.02, 0); road.receiveShadow = true; gEscape.add(road);
  for (const sx of [-1, 1]) box(gEscape, 2.2, 0.14, 34, 0x4a4d4f, sx * 4.6, 0.07, 0, null, { roughness: 1 }); // sidewalks
  // Street lamps along the road.
  for (const [lx, lz] of [[4.2, -6], [-4.2, 0], [4.2, 6]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.5, 8), stdMat({ color: 0x2a2f33, metalness: 0.6, roughness: 0.5 }));
    pole.position.set(lx, 2.25, lz); gEscape.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.25), new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffc978, emissiveIntensity: 0.9 }));
    head.position.set(lx + (lx > 0 ? -0.3 : 0.3), 4.5, lz); gEscape.add(head);
  }
  // Police transport bus: the offender rides in this. Navy body, white band,
  // POLICE lettering, barred windows, flashing roof bar, rear doors (the
  // click target, same name as the old van doors so the escape still works).
  const bus = new THREE.Group(); bus.position.set(0, 0, 2); gEscape.add(bus);
  const busBody = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 6), stdMat({ color: 0x1a2a4a, roughness: 0.5, metalness: 0.25 }));
  busBody.position.set(0, 1.4, 0); busBody.castShadow = true; busBody.receiveShadow = true; bus.add(busBody);
  const busBand = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.55, 6.02), stdMat({ color: 0xe8e8e8, roughness: 0.5 }));
  busBand.position.set(0, 1.55, 0); bus.add(busBand);
  for (const sx of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.7), new THREE.MeshStandardMaterial({ map: signTexture('POLICE', '#f8f8f8', '#1a2a4a', ''), roughness: 0.6 }));
    plate.position.set(sx * 1.32, 1.95, 0); plate.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2; bus.add(plate);
  }
  const shield = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.9), new THREE.MeshStandardMaterial({ color: 0x0a141e, roughness: 0.15, metalness: 0.5 }));
  shield.position.set(0, 1.7, 3.02); bus.add(shield);
  for (const sx of [-1, 1]) for (const wz of [-2, -0.6, 0.8, 2.2]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.7), new THREE.MeshStandardMaterial({ color: 0x0a141e, roughness: 0.2, metalness: 0.4 }));
    win.position.set(sx * 1.31, 1.95, wz); win.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2; bus.add(win);
    for (const bx of [-0.3, 0, 0.3]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.7, 0.03), stdMat({ color: 0x888888, metalness: 0.8, roughness: 0.3 }));
      bar.position.set(sx * 1.33, 1.95, wz + bx); bus.add(bar);
    }
  }
  const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.45), stdMat({ color: 0x111111, roughness: 0.4 }));
  barBase.position.set(0, 2.76, 1.6); bus.add(barBase);
  policeLightL = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.4), new THREE.MeshStandardMaterial({ color: 0xaa0000, emissive: 0xff2020, emissiveIntensity: 1.2, roughness: 0.3 }));
  policeLightL.position.set(-0.32, 2.82, 1.6); bus.add(policeLightL);
  policeLightR = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.4), new THREE.MeshStandardMaterial({ color: 0x0000aa, emissive: 0x2040ff, emissiveIntensity: 1.2, roughness: 0.3 }));
  policeLightR.position.set(0.32, 2.82, 1.6); bus.add(policeLightR);
  for (const [wx, wz] of [[-1.15, -1.8], [1.15, -1.8], [-1.15, 2.0], [1.15, 2.0]]) {
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 16), stdMat({ color: 0x111111, roughness: 0.9 }));
    wh.rotation.z = Math.PI / 2; wh.position.set(wx, 0.45, wz); wh.castShadow = true; bus.add(wh);
  }
  const dl = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.1), stdMat({ color: 0xd8d8d8, roughness: 0.5 }));
  dl.position.set(-0.62, 1.2, -3.05); dl.name = 'vanDoors'; dl.userData.clickable = true; bus.add(dl);
  const dr = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.1), stdMat({ color: 0xd8d8d8, roughness: 0.5 }));
  dr.position.set(0.62, 1.2, -3.05); dr.name = 'vanDoors'; dr.userData.clickable = true; bus.add(dr);
  vanDoorL = dl; vanDoorR = dr;
  hitBox(gEscape, 2.8, 2.6, 0.8, 0, 1.3, -1.1, 'vanDoors');
  // The militants' van: a dark van rammed nose-first into the bus's left
  // flank. Its nose touches the bus side at (-1.3, 2.3), with a dust puff
  // at the impact point. It pulls away and drifts down the road once the
  // doors are ripped open (see updateVanChase in the animate loop).
  militantVan = new THREE.Group();
  militantVan.position.set(-3.0, 0, 0.8); militantVan.rotation.y = 0.85;
  gEscape.add(militantVan);
  const mvBody = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.0, 4.6), stdMat({ color: 0x0d0d0f, roughness: 0.4, metalness: 0.4 }));
  mvBody.position.set(0, 1.15, 0); mvBody.castShadow = true; mvBody.receiveShadow = true; militantVan.add(mvBody);
  const mvCab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 0.8), stdMat({ color: 0x14161a, roughness: 0.3, metalness: 0.4 }));
  mvCab.position.set(0, 1.35, 2.0); militantVan.add(mvCab);
  const mvShield = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.7), new THREE.MeshStandardMaterial({ color: 0x0a141e, roughness: 0.15, metalness: 0.5 }));
  mvShield.position.set(0, 1.4, 2.42); militantVan.add(mvShield);
  for (const [wx, wz] of [[-1.0, -1.5], [1.0, -1.5], [-1.0, 1.5], [1.0, 1.5]]) {
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 14), stdMat({ color: 0x111111, roughness: 0.9 }));
    wh.rotation.z = Math.PI / 2; wh.position.set(wx, 0.38, wz); militantVan.add(wh);
  }
  for (const hx of [-0.7, 0.7]) {
    const hl = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe9a0, emissiveIntensity: 1.5 }));
    hl.position.set(hx, 0.9, 2.32); militantVan.add(hl);
  }
  ramPuff = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0x9a8a7a, transparent: true, opacity: 0.5, depthWrite: false }));
  ramPuff.scale.set(2.2, 1.4, 1); ramPuff.position.set(-1.5, 0.9, 2.3); gEscape.add(ramPuff);
  // Drift dust pool: small grey puffs that spawn at the van's rear wheels
  // while it slides, then grow and fade.
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0x8a8578, transparent: true, opacity: 0, depthWrite: false }));
    s.scale.set(0.6, 0.6, 1); s.position.set(0, -10, 0); gEscape.add(s);
    dustPuffs.push({ sprite: s, life: 0, maxLife: 1 });
  }
  // Rooftop (raised platform) with AC units and a parapet.
  box(gEscape, 10, 0.4, 8, 0x3a3f42, -4, 2.6, -6, null, { roughness: 1 });
  hitBox(gEscape, 10, 1.4, 8, -4, 3.2, -6, 'rooftop');
  box(gEscape, 10, 0.5, 0.3, 0x2a2f33, -4, 3.0, -10, null, { roughness: 1 });
  box(gEscape, 1.5, 1.0, 1.5, 0x5a5f62, -6, 3.3, -7, null, { roughness: 0.8, metalness: 0.4 });
  box(gEscape, 1.2, 0.8, 1.2, 0x4a4f52, -2, 3.2, -8, null, { roughness: 0.8, metalness: 0.4 });
  // Fire escape stairs down from the rooftop to the alley.
  for (let i = 0; i < 5; i++) {
    box(gEscape, 1.2, 0.08, 0.5, 0x1a1d20, 1.5, 2.6 - i * 0.5, -2.5 + i * 0.9, i === 2 ? 'fireEscape' : null, { roughness: 0.7, metalness: 0.5 });
  }
  hitBox(gEscape, 1.6, 3.0, 3.0, 1.5, 1.5, -0.5, 'fireEscape');
  // Black SUV waiting in the alley.
  box(gEscape, 2.0, 1.4, 4.4, 0x0a0a0a, 5.5, 0.9, -1, 'suv', { roughness: 0.3, metalness: 0.5 });
  box(gEscape, 1.8, 0.7, 2.2, 0x111418, 5.5, 1.9, -1, null, { roughness: 0.2, metalness: 0.4 });
  hitBox(gEscape, 2.6, 2.2, 5.0, 5.5, 1.0, -1, 'suv');
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('QUEENSBORO PLAZA', '#111111', '#e8e8e8', 'AFTERNOON'), transparent: true, depthWrite: false }));
  sign.scale.set(5, 1.25, 1); sign.position.set(0, 5.5, -8); gEscape.add(sign);
  blobShadow(gEscape, 0, 2, 2.6, 5, 0.5);
}
let escapeTimer = null;
let escapeTimeLeft = 90; // shared so action hits can subtract backup time
function escapePenalty(s) {
  escapeTimeLeft = Math.max(0, escapeTimeLeft - s);
  try {
    document.getElementById('timerVal').textContent = escapeTimeLeft + ' seconds';
    document.getElementById('timerBar').style.width = escapeTimeLeft + '%';
  } catch (e) { /* ignore */ }
  toast('Caught in the open - ' + s + ' seconds lost. Keep moving!');
}
function startEscapeTimer() {
  escapeTimeLeft = 90;
  document.getElementById('timerLabel').textContent = 'Backup';
  document.getElementById('timerVal').textContent = escapeTimeLeft + ' seconds';
  document.getElementById('timerBar').style.width = '100%';
  if (escapeTimer) clearInterval(escapeTimer);
  escapeTimer = setInterval(() => {
    escapeTimeLeft--;
    if (escapeTimeLeft <= 0) { escapeTimeLeft = 0; clearInterval(escapeTimer); escapeTimer = null; toast('Backup is here - move!'); }
    document.getElementById('timerVal').textContent = escapeTimeLeft + ' seconds';
    document.getElementById('timerBar').style.width = escapeTimeLeft + '%';
  }, 1000);
}
function stopEscapeTimer() { if (escapeTimer) { clearInterval(escapeTimer); escapeTimer = null; } }
function startChapter3() {
  state.chapter = 3; state.escapeStep = 0; resetView(); hideToast();
  for (const [n, g] of Object.entries(GROUPS)) g.visible = (parseInt(n, 10) === 3);
  reparentCast('jade', gEscape, -0.9, 3.5, 0);
  reparentCast('caleb', gEscape, 0.9, 3.5, 0);
  setObjectives(0); updateHUD();
  setAmbient('chase'); // sirens and engine roar for the escape
  setTension(0.9);
  startEscapeTimer();
  showDialogue([
    { who: 'Jade Morales', text: 'A police bus idles by the curb. Two officers load us into the back. The doors slam shut. Darkness. A metal bench, a wire mesh partition, a single flickering light.' },
    { who: 'Caleb Bishop', text: 'Well. This is new. First time in any wagon.' },
    { who: 'Jade Morales', text: 'You get used to it.' },
    { who: 'Caleb Bishop', text: 'Hey, Morales. What about us? After the ninety days?' },
    { who: 'Jade Morales', text: state.finalChoice === 'quick' ? 'We wait it out. Ninety days. Then we see what the city does with us.' : 'We rebuild. Remember?' }
  ], () => {
    setObjectives(1);
    toast('Something is wrong - the van just stopped. Click the van doors.');
  });
}
function escapeStep(from) {
  // Each escape beat only advances from its own target, so a stray click on
  // the SUV or the fire escape cannot skip the van doors or the rooftop.
  if (state.escapeStep === 0 && from !== 'vanDoors') return;
  if (state.escapeStep === 1 && from !== 'rooftop') return;
  if (state.escapeStep === 2 && from !== 'fireEscape' && from !== 'suv') return;
  if (state.escapeStep === 0) {
    state.escapeStep = 1;
    vanDoorL.position.x = -1.6; vanDoorR.position.x = 1.6; // doors ripped open
    try { sfxDoor(); sfxBoom(); } catch (e) { /* ignore */ } // the doors tear off, the ram hits
    // Jade and Caleb step out of the back of the bus, by the leader.
    reparentCast('jade', gEscape, -1.2, -2.2, 0);
    reparentCast('caleb', gEscape, 1.2, -2.2, 0);
    // The militant van pulls off the bus and away down the road, drifting.
    if (militantVan && vanChase.phase === 'rammed') {
      vanChase.phase = 'pullback'; vanChase.t = 0;
      vanChase.fromX = militantVan.position.x; vanChase.fromZ = militantVan.position.z; vanChase.fromYaw = militantVan.rotation.y;
      vanChase.toX = -2.2; vanChase.toZ = -1.5; vanChase.toYaw = Math.PI;
    }
    setObjectives(2);
    showDialogue([
      { who: 'System', text: 'SCREECHING TIRES. The van slams to a stop. A CRASH. The back doors are ripped open. Sunlight floods in. Three figures in black tactical gear stand silhouetted against the light.' },
      { who: 'Leader', text: 'Jade Morales. Caleb Bishop. You are coming with us.' },
      { who: 'Caleb Bishop', text: 'Who the hell are you?' },
      { who: 'Leader', text: 'Friends of Derrick Shaw. He said you might need a hand. We have got ninety seconds before backup arrives. Move.' },
      { who: 'Caleb Bishop', text: 'This is insane! We are escaping custody!' },
      { who: 'Jade Morales', text: 'You got a better idea?' }
    ], () => { startEscapeAction(); }); // the escape becomes an action run, not just clicks
  } else if (state.escapeStep === 1) {
    state.escapeStep = 2;
    camY = 3.4; camera.position.set(-4, 3.4, -4);
    showDialogue([
      { who: 'System', text: 'Across the rooftop, past the AC units, the city spread out below. The leader stops at the edge. Below: a fire escape leading to an alley. A black SUV waits.' },
      { who: 'Leader', text: 'Down. Now.' }
    ], () => toast('Click the fire escape stairs to climb down.'));
  } else if (state.escapeStep === 2) {
    state.escapeStep = 3;
    camY = 1.9; camera.position.set(5.5, 1.9, 2);
    showDialogue([
      { who: 'System', text: 'Down the fire escape, into the alley. The SUV doors open. You pile in. The SUV peels out.' },
      { who: 'Caleb Bishop', text: 'No! But I would like to go on record saying this is insane!' },
      { who: 'Jade Morales', text: '(half-smile) Noted. For the record.' }
    ], () => { try { sfxRev(); } catch (e) { /* ignore */ } setObjectives(3); stopEscapeTimer(); setTimeout(() => startChapter4(), 1200); });
  }
}

// ---------- Act III action: the escape as a run, dodge and climb ----------
// After the doors are ripped open, the escape is an action sequence, not
// just clicks: run (WASD) to the rooftop ladder, dodging the rolling
// barriers on the street; climb up (hold SPACE); run across the rooftop,
// dodging the searchlight; climb down the fire escape (hold SPACE); run
// to the SUV. A hit costs 5 seconds on the backup timer - never a fail
// state. The old click targets still work as a fallback, and if the
// player clicks ahead the action syncs to the new step, so this beat can
// never block progress. While a dialogue is open the action pauses.
let escapeActionActive = false, escapePhase = 0, escapeInvuln = 0, escapeClimbing = false;
let escapeMarkers = {}, escapeBarriers = [], escapeLight = null, escapeBeam = null, escapeBeamX = -4;
function buildEscapeAction() {
  if (escapeMarkers.ladder) return;
  try {
    escapeMarkers.ladder = makeActionMarker('LADDER', '#7ac74f');
    if (escapeMarkers.ladder) { escapeMarkers.ladder.position.set(-4, 1.8, -2); escapeMarkers.ladder.visible = false; gEscape.add(escapeMarkers.ladder); }
    escapeMarkers.fire = makeActionMarker('FIRE ESCAPE', '#ffd166');
    if (escapeMarkers.fire) { escapeMarkers.fire.position.set(1.5, 3.8, -2); escapeMarkers.fire.visible = false; gEscape.add(escapeMarkers.fire); }
    escapeMarkers.suv = makeActionMarker('SUV', '#7ac74f');
    if (escapeMarkers.suv) { escapeMarkers.suv.position.set(5.5, 1.8, -1); escapeMarkers.suv.visible = false; gEscape.add(escapeMarkers.suv); }
    for (const z of [-2, -3.5, -0.5]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.9 }));
      b.position.set(0, 0.35, z); b.castShadow = true; b.visible = false;
      gEscape.add(b);
      escapeBarriers.push({ mesh: b, z, phase: z * 1.3, speed: 0.9 + Math.random() * 0.3 });
    }
    // Searchlight sweeping the rooftop: a spotlight plus a visible beam cone.
    escapeLight = new THREE.SpotLight(0xfff2d8, 0, 20, 0.35, 0.5, 1.2);
    escapeLight.position.set(-4, 7, -6);
    const tgt = new THREE.Object3D(); tgt.position.set(-4, 2.6, -6);
    gEscape.add(tgt); escapeLight.target = tgt;
    gEscape.add(escapeLight);
    escapeBeam = new THREE.Mesh(new THREE.ConeGeometry(1.1, 5.5, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2d8, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    escapeBeam.position.set(-4, 4.8, -6); escapeBeam.visible = false;
    gEscape.add(escapeBeam);
  } catch (e) { /* action props are best effort */ }
}
function startEscapeAction() {
  try {
    buildEscapeAction();
    escapeActionActive = true; escapePhase = 1; escapeInvuln = 0; escapeClimbing = false;
    if (escapeMarkers.ladder) escapeMarkers.ladder.visible = true;
    for (const b of escapeBarriers) b.mesh.visible = true;
    showActionBanner('RUN! Get to the rooftop ladder - dodge the rolling barriers. WASD to move.');
    toast('Run to the glowing LADDER - dodge the barriers.');
  } catch (e) { escapeActionActive = false; toast('Run - click the rooftop to climb up, then the fire escape down to the SUV.'); }
}
function endEscapeAction() {
  if (!escapeActionActive) return;
  escapeActionActive = false; escapePhase = 0;
  hideActionBanner();
  try {
    for (const m of Object.values(escapeMarkers)) if (m) m.visible = false;
    for (const b of escapeBarriers) b.mesh.visible = false;
    if (escapeLight) escapeLight.intensity = 0;
    if (escapeBeam) escapeBeam.visible = false;
  } catch (e) { /* ignore */ }
}
function escapeClimb(label, sub, done) {
  // A hold-SPACE climb. While it runs the action pauses (no hits).
  escapeClimbing = true;
  try {
    const ok = runHoldQTE({
      label, sub, holdMs: 1200, windowMs: 8000,
      onDone: (ok) => { escapeClimbing = false; done(ok); }
    });
    if (!ok) { escapeClimbing = false; done(true); }
  } catch (e) { escapeClimbing = false; done(true); }
}
function updateEscapeAction(dt) {
  if (!escapeActionActive || escapeClimbing) return;
  try {
    if (state.chapter !== 3 || state.escapeStep >= 3) { endEscapeAction(); return; }
    // While a dialogue is open the player is reading: pause the action.
    if (!document.getElementById('dialogue').classList.contains('hidden')) return;
    // Sync with the click fallback: if the player clicked ahead, jump to the right phase.
    if (state.escapeStep === 2 && escapePhase === 1) {
      escapePhase = 2;
      if (escapeMarkers.ladder) escapeMarkers.ladder.visible = false;
      for (const b of escapeBarriers) b.mesh.visible = false;
      if (escapeMarkers.fire) escapeMarkers.fire.visible = true;
      if (escapeLight) escapeLight.intensity = 8;
      if (escapeBeam) escapeBeam.visible = true;
      showActionBanner('Across the rooftop - stay out of the searchlight, reach the FIRE ESCAPE.');
    }
    if (escapeInvuln > 0) escapeInvuln -= dt;
    const t = Date.now() / 1000;
    if (escapePhase === 1) {
      // Barriers roll across the street; a hit costs 5 seconds.
      for (const b of escapeBarriers) {
        b.mesh.position.x = Math.sin(t * b.speed + b.phase) * 4;
        b.mesh.rotation.y += dt;
        if (escapeInvuln <= 0 && camera.position.y < 2.5 && Math.abs(b.mesh.position.x - camera.position.x) < 0.6 && Math.abs(b.z - camera.position.z) < 0.6) {
          escapeInvuln = 2;
          escapePenalty(5);
          flashScreen('rgba(255,40,30,0.35)');
          try { sfxThud(); } catch (e) { /* ignore */ }
        }
      }
      const dist = dist2D(camera.position.x, camera.position.z, -4, -2);
      try { showActionBanner('RUN! Reach the glowing LADDER - ' + Math.max(0, Math.ceil(dist)) + ' m to go. Dodge the barriers.'); } catch (e) { /* ignore */ }
      if (dist < 1.3) {
        escapeClimb('CLIMB UP', 'Hold SPACE to climb the ladder to the rooftop.', () => {
          if (!escapeActionActive) return;
          camY = 3.4; camera.position.set(-4, 3.4, -4);
          escapePhase = 2;
          if (escapeMarkers.ladder) escapeMarkers.ladder.visible = false;
          for (const b of escapeBarriers) b.mesh.visible = false;
          if (escapeMarkers.fire) escapeMarkers.fire.visible = true;
          if (escapeLight) escapeLight.intensity = 8;
          if (escapeBeam) escapeBeam.visible = true;
          escapeStep('rooftop');
        });
      }
    } else if (escapePhase === 2) {
      // Searchlight sweeps the rooftop; standing in the beam costs 5 seconds.
      escapeBeamX = -4 + Math.sin(t * 0.45) * 4.5;
      if (escapeLight) escapeLight.target.position.set(escapeBeamX, 2.6, -6);
      if (escapeBeam) escapeBeam.position.set(escapeBeamX, 4.8, -6);
      if (escapeInvuln <= 0 && camY > 3 && Math.abs(camera.position.x - escapeBeamX) < 0.9) {
        escapeInvuln = 2;
        escapePenalty(5);
        flashScreen('rgba(255,240,180,0.3)');
        try { sfxAlert(); } catch (e) { /* ignore */ }
        toast('Searchlight! You were spotted - 5 seconds lost.');
      }
      const dist = dist2D(camera.position.x, camera.position.z, 1.5, -2);
      try { showActionBanner('Across the rooftop - stay out of the searchlight, reach the FIRE ESCAPE - ' + Math.max(0, Math.ceil(dist)) + ' m.'); } catch (e) { /* ignore */ }
      if (dist < 1.3) {
        escapeClimb('CLIMB DOWN', 'Hold SPACE to climb down the fire escape.', () => {
          if (!escapeActionActive) return;
          camY = 1.9; camera.position.set(5.5, 1.9, 2);
          escapePhase = 3;
          if (escapeMarkers.fire) escapeMarkers.fire.visible = false;
          if (escapeLight) escapeLight.intensity = 0;
          if (escapeBeam) escapeBeam.visible = false;
          if (escapeMarkers.suv) escapeMarkers.suv.visible = true;
          showActionBanner('RUN! Get to the SUV - climb in and go.');
        });
      }
    } else if (escapePhase === 3) {
      const dist = dist2D(camera.position.x, camera.position.z, 5.5, -1);
      try { showActionBanner('RUN! Get to the SUV - ' + Math.max(0, Math.ceil(dist)) + ' m to go.'); } catch (e) { /* ignore */ }
      if (dist < 1.5) {
        endEscapeAction();
        escapeStep('suv');
      }
    }
  } catch (e) { endEscapeAction(); }
}

// ---------- Chapter 4: The Safehouse ----------
function buildSafe() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), stdMat({ color: 0x3a3630, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; gSafe.add(floor);
  box(gSafe, 20, 4.5, 0.4, 0x4a4640, 0, 2.25, -5, null, { roughness: 1 });
  // Evidence map on the wall.
  const map = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.5), new THREE.MeshStandardMaterial({ map: mapTexture(), roughness: 0.9 }));
  map.position.set(-4, 2, -4.75); map.name = 'evidenceMap'; map.userData.clickable = true; gSafe.add(map);
  hitBox(gSafe, 4, 3, 0.6, -4, 2, -4.6, 'evidenceMap');
  // Monitors with the files.
  for (let i = 0; i < 3; i++) {
    const mon = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), new THREE.MeshStandardMaterial({ map: screenTexture(['FILES', 'WITNESSES', 'EVIDENCE'], '#2aff7a'), roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.25, emissiveMap: screenTexture(['FILES', 'WITNESSES', 'EVIDENCE'], '#2aff7a') }));
    mon.position.set(1.5 + i * 1.5, 1.6, -4.7); gSafe.add(mon);
  }
  hitBox(gSafe, 4.5, 1.4, 0.6, 3, 1.6, -4.6, 'monitors');
  // Crates, cots, and the folder stack.
  for (const [cx, cz] of [[-6, 2], [-5, 3.2], [5, 3]]) box(gSafe, 1.2, 1.0, 1.2, 0x5a4632, cx, 0.5, cz, null, { roughness: 0.95 });
  box(gSafe, 1.8, 0.4, 0.7, 0x3a4a3a, -6, 0.25, -1, null, { roughness: 0.9 });
  const files = box(gSafe, 0.5, 0.25, 0.35, 0xd8c98a, -5, 1.15, 3.2, 'files', { roughness: 0.85 });
  files.rotation.y = 0.4;
  hitBox(gSafe, 1.2, 1.0, 1.2, -5, 1.1, 3.2, 'files');
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('SAFEHOUSE - LONG ISLAND CITY', '#111111', '#e8e8e8', ''), transparent: true, depthWrite: false }));
  sign.scale.set(5, 1.25, 1); sign.position.set(0, 4.8, -4.6); gSafe.add(sign);
  blobShadow(gSafe, -2.5, -2, 0.9, 0.9, 0.55);
}
function startChapter4() {
  state.chapter = 4; resetView(); hideToast();
  for (const [n, g] of Object.entries(GROUPS)) g.visible = (parseInt(n, 10) === 4);
  reparentCast('jade', gSafe, -1.2, 3.5, Math.PI);
  reparentCast('caleb', gSafe, 1.2, 3.5, Math.PI);
  setObjectives(0); updateHUD();
  setAmbient('room'); // the safehouse: quiet, just room tone
  setTension(0.2);
  document.getElementById('timerLabel').textContent = 'Press conference';
  document.getElementById('timerVal').textContent = 'tomorrow 9 AM';
  document.getElementById('timerBar').style.width = '100%';
  showDialogue([
    { who: 'Owen Marsh', text: 'My name is Owen. Owen Marsh. I worked signals with Derrick. Before they fired him. Before they fired all of us.' },
    { who: 'Jade Morales', text: 'You are the ones who have been helping him. The RESET board. The spoofing device.' },
    { who: 'Owen Marsh', text: 'We did not know about the bridge. I swear to God. Derrick went off-script. We thought he was just gathering evidence. Building a case.' },
    { who: 'Owen Marsh', text: 'We have got the files. We have got the witnesses. We have got the evidence. What we do not have is someone the public will believe. Someone who took the fall and got back up. That is you.' },
    { who: 'Jade Morales', text: 'I am a fugitive now. Thanks to you.' },
    { who: 'Owen Marsh', text: 'You are a symbol. There is a difference. The Attorney General holds a press conference tomorrow at nine AM. We are going to be there. With the files. With the witnesses. With you.' }
  ], () => {
    setObjectives(2);
    toast('Look at the evidence map on the wall, then the folder stack - then we go to the press conference.');
  });
}

// ---------- Chapter 5: The Press Conference ----------
let flashSprites = [];
function buildPress() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), stdMat({ color: 0x6a6f72, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; gPress.add(ground);
  // Podium with microphones.
  box(gPress, 1.6, 1.2, 0.8, 0x2a2118, 0, 0.6, -2, 'podium', { roughness: 0.8 });
  hitBox(gPress, 2.2, 1.8, 1.4, 0, 0.8, -2, 'podium');
  for (const mx of [-0.3, 0, 0.3]) {
    const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), stdMat({ color: 0x111111, roughness: 0.4 }));
    mic.position.set(mx, 1.45, -1.9); mic.rotation.x = 0.4; gPress.add(mic);
  }
  // Cameras on tripods, with flash sprites.
  for (const [cx, cz] of [[-3, 2], [0, 3], [3, 2]]) {
    const cam = box(gPress, 0.5, 0.35, 0.7, 0x1a1d20, cx, 1.5, cz, null, { roughness: 0.4 });
    cam.rotation.y = cx === 0 ? 0 : (cx < 0 ? 0.5 : -0.5);
    for (const [lx, lz] of [[-0.2, 0.2], [0.2, 0.2]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6), stdMat({ color: 0x222222, metalness: 0.6, roughness: 0.5 }));
      leg.position.set(cx + lx, 0.75, cz + lz); leg.rotation.z = lx * 0.8; gPress.add(leg);
    }
    const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    fl.scale.set(1.6, 1.6, 1); fl.position.set(cx, 1.6, cz - 0.4); gPress.add(fl); flashSprites.push(fl);
  }
  // Crowd: a row of simple dark figures (low boxes) behind a barrier.
  box(gPress, 10, 0.9, 0.3, 0x8a8a8a, 0, 0.45, 4.5, null, { roughness: 0.8, metalness: 0.4 });
  for (let i = 0; i < 7; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.1, 8), stdMat({ color: 0x2a2a30, roughness: 0.9 }));
    p.position.set(-4.5 + i * 1.5, 0.55, 5.2); gPress.add(p);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), stdMat({ color: 0xc8a080, roughness: 0.8 }));
    h.position.set(-4.5 + i * 1.5, 1.25, 5.2); gPress.add(h);
  }
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('STATE ATTORNEY GENERAL', '#111111', '#e8e8e8', 'PRESS CONFERENCE - 9:00 AM'), transparent: true, depthWrite: false }));
  sign.scale.set(5, 1.25, 1); sign.position.set(0, 4.8, -4.6); gPress.add(sign);
  blobShadow(gPress, 0, -2, 1.2, 1.0, 0.5);
}
function startChapter5() {
  state.chapter = 5; resetView(); hideToast();
  for (const [n, g] of Object.entries(GROUPS)) g.visible = (parseInt(n, 10) === 5);
  reparentCast('jade', gPress, -1.2, 1.5, 0);
  reparentCast('caleb', gPress, 1.2, 1.5, 0);
  setObjectives(0); updateHUD();
  setAmbient('press'); // crowd murmur and camera shutters
  setTension(0.35);
  document.getElementById('timerLabel').textContent = 'Press conference';
  document.getElementById('timerVal').textContent = 'live';
  document.getElementById('timerBar').style.width = '100%';
  showDialogue([
    { who: 'Attorney General', text: '...and I want to be clear: my office will not tolerate vigilante action. The individuals responsible for the recent infrastructure attacks will be prosecuted to the fullest extent of the law.' },
    { who: 'Jade Morales', text: 'What about the individuals who caused the attacks in the first place?' },
    { who: 'Attorney General', text: 'Miss Morales. You are supposed to be in custody.' },
    { who: 'Jade Morales', text: 'I was. Then I got out. And now I am here to tell you the truth.' }
  ], () => {
    setObjectives(1);
    toast('Click the podium - step up and tell the city the truth.');
  });
}
function pressConference() {
  reparentCast('jade', gPress, 0, -1.2, 0);
  setObjectives(2);
  showDialogue([
    { who: 'Jade Morales', text: 'My name is Jade Morales. I used to work for the MTA. I found cracks in the system. I reported them. I was ignored. Then I was fired. Then I was arrested for trying to fix it.' },
    { who: 'Jade Morales', text: 'This folder contains evidence of systemic corruption in the New York City infrastructure oversight committee. Names. Dates. Bribes. Cover-ups. And the testimony of a dozen city workers who were fired or silenced for telling the truth.' },
    { who: 'Jade Morales', text: 'Derrick Shaw was wrong to plant those bombs. But he was right about one thing: the system does not listen. So we are making it listen. Read it. Publish it. Prosecute the people who deserve it. And then - maybe - we can start talking about repair.' },
    { who: 'Attorney General', text: '(quiet) This better be good.' },
    { who: 'Jade Morales', text: 'It is the truth. That is better than good.' }
  ], () => { setObjectives(2); stopEscapeTimer(); setTimeout(() => startChapter6(), 1200); });
}

// Bridge exterior shot: after the train has run a while in chapter 6 the
// camera cuts to a trackside shot of the full train body moving on its
// track, holds a few seconds, then returns to the deck.
const bridgeShot = { done: true, active: false, until: 0, startT: 0 };
function spawnDust(x, y, z) {
  for (const p of dustPuffs) {
    if (p.life <= 0) {
      p.life = p.maxLife = 0.9 + Math.random() * 0.5;
      p.sprite.position.set(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6);
      p.sprite.material.opacity = 0.5;
      p.sprite.scale.set(0.6, 0.6, 1);
      return;
    }
  }
}
function updateVanChase(dt, t) {
  if (!militantVan || state.chapter !== 3) return;
  if (vanChase.phase === 'rammed') return;
  if (vanChase.phase === 'pullback') {
    vanChase.t += dt;
    const k = Math.min(1, vanChase.t / 1.5);
    const e = k * k * (3 - 2 * k); // smoothstep
    militantVan.position.x = vanChase.fromX + (vanChase.toX - vanChase.fromX) * e;
    militantVan.position.z = vanChase.fromZ + (vanChase.toZ - vanChase.fromZ) * e;
    militantVan.rotation.y = vanChase.fromYaw + (vanChase.toYaw - vanChase.fromYaw) * e;
    if (ramPuff) ramPuff.material.opacity = Math.max(0, 0.5 - k * 0.5);
    if (k >= 1) { vanChase.phase = 'drift'; vanChase.z = militantVan.position.z; vanChase.spawnT = 0; }
    return;
  }
  // Drift: the van runs down the road (toward -z) weaving across its lane,
  // its nose pointed a slip angle away from its direction of travel so the
  // rear reads as sliding out, with dust at the rear wheels. When it runs
  // off the far end it loops back behind the camera, out of sight.
  vanChase.z -= 4.5 * dt;
  if (vanChase.z < -16) vanChase.z = 10;
  const weave = Math.sin(vanChase.z * 0.25);
  militantVan.position.z = vanChase.z;
  militantVan.position.x = -2.0 + weave * 1.0;
  const slip = 0.28 * Math.sin(vanChase.z * 0.25 + 0.8);
  militantVan.rotation.y = Math.PI + slip;
  vanChase.spawnT -= dt;
  if (vanChase.spawnT <= 0) {
    vanChase.spawnT = 0.07;
    const bx = militantVan.position.x - Math.sin(militantVan.rotation.y) * 1.8;
    const bz = militantVan.position.z - Math.cos(militantVan.rotation.y) * 1.8;
    spawnDust(bx, 0.5, bz);
  }
}

// ---------- Chapter 6: The Aftermath + The Bridge at dawn ----------
function buildBridge() {
  // Dawn sky: warm gradient plane behind the deck, low sun glow.
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(160, 50), new THREE.MeshBasicMaterial({ color: 0x2a1a2a }));
  sky.position.set(0, 18, -55); gBridge.add(sky);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xffb36a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  sunGlow.scale.set(26, 12, 1); sunGlow.position.set(0, 4, -50); gBridge.add(sunGlow);
  // Bridge deck + railings.
  box(gBridge, 4, 0.5, 30, 0x3a3f42, 0, -0.25, -2, null, { roughness: 0.9 });
  for (const sx of [-1.9, 1.9]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 30, 8), stdMat({ color: 0x6a747a, metalness: 0.8, roughness: 0.4 }));
    rail.rotation.x = Math.PI / 2; rail.position.set(sx, 1.1, -2); gBridge.add(rail);
  }
  // The 4 train crossing on a distant bridge, full of passengers, moving.
  trainMesh = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const car = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 1.6), new THREE.MeshStandardMaterial({ color: 0x2a5a3a, roughness: 0.5, metalness: 0.4 }));
    car.position.set(i * 3.4, 0, 0); trainMesh.add(car);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.6), new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffd166, emissiveIntensity: 0.8 }));
    win.position.set(i * 3.4, 0.2, 0.85); trainMesh.add(win);
  }
  trainMesh.position.set(-30, 2.5, -30); trainMesh.name = 'train'; gBridge.add(trainMesh);
  // The 4 train runs on a real track: a ballast deck, two steel rails and
  // sleepers, carried on pillars, so the moving train reads as a train on
  // a track and not a box floating over the river.
  box(gBridge, 90, 0.4, 3.2, 0x2a2f33, 0, 1.5, -30, null, { roughness: 0.95 });
  for (const rz of [-30.75, -29.25]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(90, 0.1, 0.08), stdMat({ color: 0x9aa2a8, metalness: 0.9, roughness: 0.25 }));
    rail.position.set(0, 1.78, rz); gBridge.add(rail);
  }
  for (let sx = -44; sx <= 44; sx += 1.4) box(gBridge, 0.3, 0.08, 2.2, 0x1a1a1a, sx, 1.72, -30, null, { roughness: 1 });
  for (const px of [-30, -10, 10, 30]) box(gBridge, 0.8, 4, 0.8, 0x3a3f42, px, -0.5, -30, null, { roughness: 0.95 });
  // The click target rides WITH the train: the old static hit box sat at
  // x=0 while the train moved, so only the leading car was clickable when
  // it happened to pass x=0. Now the whole train is clickable anywhere.
  hitBox(trainMesh, 14, 3, 3, 5.1, 0, 0, 'train');
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('WILLIAMSBURG BRIDGE - DAWN', '#111111', '#ffd166', 'ONE MONTH LATER'), transparent: true, depthWrite: false }));
  sign.scale.set(5, 1.25, 1); sign.position.set(0, 6, -14); gBridge.add(sign);
  blobShadow(gBridge, -0.8, 4, 0.9, 0.9, 0.55);
  blobShadow(gBridge, 0.8, 4, 0.9, 0.9, 0.55);
}
function startChapter6() {
  state.chapter = 6; resetView(); hideToast();
  // The exterior train shot starts counting now: after the train has run a
  // while on the bridge, the camera cuts to the trackside view.
  bridgeShot.done = false; bridgeShot.active = false; bridgeShot.startT = Date.now() / 1000;
  for (const [n, g] of Object.entries(GROUPS)) g.visible = (parseInt(n, 10) === 6);
  reparentCast('jade', gBridge, -0.8, 4, Math.PI);
  reparentCast('caleb', gBridge, 0.8, 4, Math.PI);
  // Dawn light: warm sun, soft sky.
  sun.intensity = 1.4; sun.color.set(0xffd9a0); ambient.intensity = 0.55; hemi.intensity = 0.5;
  scene.background = new THREE.Color(0x2a1a2a); scene.fog.density = 0.008;
  setObjectives(0); updateHUD();
  setAmbient('dawn'); // soft wind and birds at dawn on the bridge
  setTension(0.15);
  document.getElementById('timerLabel').textContent = 'One month later';
  document.getElementById('timerVal').textContent = 'dawn';
  document.getElementById('timerBar').style.width = '100%';
  showDialogue([
    { who: 'Jade Morales', text: state.finalChoice === 'quick'
      ? 'One month ago, I stood on the City Hall steps and told you the system was broken. Today, I am here to tell you the city recovered. Quietly. The same way it always does.'
      : 'One month ago, I stood on the City Hall steps and told you the system was broken. Today, I am here to tell you it is being fixed. Independent. Transparent. Accountable. It is not perfect. It is not fast. But it is a start.' },
    { who: 'Caleb Bishop', text: 'My dad used to say the city runs on trust. And trust has to be earned. So we are earning it. One crack at a time.' },
    { who: 'System', text: 'Dawn on the Williamsburg Bridge. The city hums beneath them. And somewhere, in a prison cell, Derrick Shaw watches too. And for the first time in years, he smiles.' },
    { who: 'Caleb Bishop', text: 'So. Director Morales. Has a nice ring to it.' },
    { who: 'Jade Morales', text: '(half-smile) Still hate it.' },
    { who: 'Caleb Bishop', text: 'Bridges are trust you can see. So are people.' }
  ], () => { setObjectives(2); toast('Click the 4 train crossing in the distance - then the ending is revealed.'); });
}
function endAct3() {
  try {
    localStorage.setItem('lastSignalAct3', JSON.stringify({ trust: state.trust, integrity: state.integrity, evidence: state.evidence, finalChoice: state.finalChoice, bridgePath: state.bridgePath }));
  } catch (e) { /* private mode */ }
  const el = document.getElementById('endCard');
  el.classList.remove('hidden');
  const endings = {
    quick: { title: 'ENDING A - "THE SYSTEM HOLDS"', text: 'The city recovers. Jade is offered her job back. She takes it - but the final shot shows her staring at the same faded safety poster, and we know nothing has changed.' },
    rebuild: { title: 'ENDING B - "THE HUMAN SIGNAL"', text: 'The rebuild happens. The partial outage is announced, hospitals are pre-warned, neighborhoods coordinate. Jade and Caleb stand at a press conference. Derrick, watching from a holding cell, nods once. The system is not fixed - but it is honest.' },
    thirdway: { title: 'ENDING C - "THE LAST SIGNAL" (BEST ENDING)', text: 'Jade exposes the official who buried her audit. The rebuild happens with public support, not despite it. Jade and Caleb stand on the reopened Williamsburg Bridge at dawn. The 4 train crosses, full of passengers, moving.' }
  };
  const e = endings[state.finalChoice || 'quick'];
  document.getElementById('endSummary').innerHTML =
    `<p><strong>Sealed choice revealed:</strong> ${state.finalChoice || 'none'} - ` +
    (wasSealedOnChain('final')
      ? `sealed on Sepolia with FHEVM, encrypted until this moment. Press "Reveal on Sepolia" below to decrypt the on-chain record.`
      : `in the full Zama version this vote would have stayed encrypted on-chain until this moment.`) + `</p>` +
    `<p><strong>${e.title}</strong><br>${e.text}</p>` +
    `<p><strong>Evidence:</strong> ${state.evidence.length ? state.evidence.join(' · ') : 'none'}<br>` +
    `Act I sealed choice: ${state.act1Sealed || 'none'} got priority power` +
    (act1SealedOnChain ? ` (sealed on Sepolia with FHEVM)` : ``) +
    ` &nbsp;•&nbsp; Act II water: ${state.waterChoice} line &nbsp;•&nbsp; Substation bomb: ${state.bombDisarmed ? 'disarmed' : 'partial blackout'} &nbsp;•&nbsp; Bridge: ${state.bridgePath}</p>` +
    `<p>Trust: ${state.trust} / 10 &nbsp;•&nbsp; System Integrity - Transit ${state.integrity.Transit}, Water ${state.integrity.Water}, Power ${state.integrity.Power}, Comms ${state.integrity.Comms}</p>` +
    `<p>THE LAST SIGNAL - complete. “Repair is a moral act.”</p>`;
  // The on-chain reveal button appears only when there is something
  // to reveal: wallet connected and both choices sealed on-chain.
  setupRevealButton();
  if (window.__lsActManager) window.__lsActManager.setEndCardButtons('act3');
}

// Stop this act cleanly (the game is complete, but stopAct keeps the
// single-page lifecycle consistent and frees this act's scene): halt the
// animate loop and the escape timer, silence speech, hide any open
// dialogue, and dispose this act's scene (the shared renderer in core.js
// is never disposed).
export function stopAct() {
  actActive = false;
  if (actRaf) { try { cancelAnimationFrame(actRaf); } catch (e) { /* ignore */ } actRaf = 0; }
  try { if (typeof stopEscapeTimer === 'function') stopEscapeTimer(); } catch (e) { /* ignore */ }
  try { stopSpeaking(); } catch (e) { /* ignore */ }
  try { document.getElementById('dialogue').classList.add('hidden'); } catch (e) { /* ignore */ }
  try { disposeScene(scene); } catch (e) { /* ignore */ }
}

// ---------- Click to inspect ----------
window.__ls3 = { state, interact: null };
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let lastTapAt = 0;
function handleTap(clientX, clientY) {
  // While a dialogue is open the player is reading or choosing: canvas
  // taps must not re-trigger an interaction and reset the queue.
  if (!document.getElementById('dialogue').classList.contains('hidden')) return;
  mouse.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  // Every named prop / hit box in the current chapter group is clickable
  // (collected at boot into chapterTargets), plus the characters.
  const targets = (chapterTargets[state.chapter] || []).slice();
  const sceneHits = ray.intersectObjects(targets.filter(t => t && t.visible !== false), false);
  if (sceneHits.length) { interact(sceneHits[0].object.name); return; }
  const humanHits = ray.intersectObjects(humanGroups.filter(g => g.visible && g.parent && g.parent.visible), true);
  if (humanHits.length) {
    let name = null, p = humanHits[0].object;
    while (p) { if (humanGroups.indexOf(p) !== -1) { name = p.name; break; } p = p.parent; }
    interact(name || humanHits[0].object.name);
  }
}
canvas.addEventListener('click', e => {
  if (!actActive) return;
  if (dragMoved > 6) { dragMoved = 0; return; }
  dragMoved = 0;
  if (Date.now() - lastTapAt < 400) return;
  lastTapAt = Date.now();
  handleTap(e.clientX, e.clientY);
});
canvas.addEventListener('pointerup', e => {
  if (dragMoved > 6) { dragMoved = 0; return; }
  dragMoved = 0;
  if (Date.now() - lastTapAt < 400) return;
  lastTapAt = Date.now();
  handleTap(e.clientX, e.clientY);
});
function interact(name) {
  if (!name) return;
  if (name === 'terminal') { finalChoiceDialogue(); return; }
  if (name === 'ebs') { toast('EBS virus - dormant, triggers in 12 hours: a fake all-clear, then a fake evacuation order. The terminal holds the fix.'); return; }
  if (name === 'bench') { toast('The bench. Twenty-seven years on it, and Judge Ellsworth has seen people who thought they were right. Some of them were not.'); return; }
  if (name === 'judge') { toast('Judge Ellsworth, 60s. Weary, but fair. He read the buried audit.'); return; }
  if (name === 'lawyerP') { toast('The prosecutor. Sharp suit, sharper questions. "Ninety days is lenient, Your Honour."'); return; }
  if (name === 'lawyerD') { toast('The defence lawyer. "My clients broke the law to save lives. The city should be thanking them."'); return; }
  if (name === 'witness') { toast('A witness in the stand - an ex-city worker, sworn in, telling the truth at last.'); return; }
  if (name === 'gallery1' || name === 'gallery2' || name === 'gallery3' || name === 'gallery4') { toast('The public gallery - neighbours, reporters, city workers. The whole city is watching this case.'); return; }
  if (name === 'officer') { toast('The court officer, standing by the bench. He has seen this courtroom full before - never like this.'); return; }
  if (name === 'militant1' || name === 'militant2') { toast('A militant, face covered with a durag. No name, no badge - just the van and the plan.'); return; }
  if (name === 'nurse') { toast('Nurse Adeyemi - night shift, hospital, dialysis clinic. People are counting on her.'); return; }
  if (name === 'derrick') { toast('Derrick Shaw, in custody. He testified six times. Nobody listened. Now they will.'); return; }
  if (name === 'vanDoors') { escapeStep('vanDoors'); return; }
  if (name === 'rooftop') { escapeStep('rooftop'); return; }
  if (name === 'fireEscape') { escapeStep('fireEscape'); return; }
  if (name === 'suv') { escapeStep('suv'); return; }
  if (name === 'leader') { toast('The leader - a former MTA worker, tired eyes. "We are not terrorists. We are city workers."'); return; }
  if (name === 'evidenceMap') { toast('The map: every crack, every cover-up, pinned and connected. This is the case.'); return; }
  if (name === 'files') {
    showDialogue([
      { who: 'Owen Marsh', text: 'The files. Testimony. Whistleblowers. Derrick had it all - he was going to take it to the Attorney General. Then his daughter died, and he broke.' },
      { who: 'Jade Morales', text: 'Then we finish what he started. The right way.' }
    ], () => { setObjectives(3); toast('Click the podium at the press conference - no, first the plan is set. On to the press conference.'); startChapter5(); });
    return;
  }
  if (name === 'monitors') { toast('Monitors: the files, the witnesses, the evidence. Everything Derrick gathered, and everything you found.'); return; }
  if (name === 'owen') { toast('Owen Marsh, 40s. Worked signals with Derrick. Fired for backing his report. He organised the ex-city workers.'); return; }
  if (name === 'podium') { pressConference(); return; }
  if (name === 'ag') { toast('The Attorney General. Sharp, ambitious. Dismissive at first - but he does the right thing in the end.'); return; }
  if (name === 'train') { endAct3(); return; }
  if (name === 'jade') { toast('Jade Morales - former MTA signal engineer, whistleblower, now Director of Infrastructure Oversight.'); return; }
  if (name === 'caleb') { toast('Caleb Bishop - his badge is restored. He chose his conscience over his badge, and the city noticed.'); return; }
  if (name === 'mta') { toast('MTA Official - the broken system, in a suit. "That is unacceptable. We cannot just -" Yes. You can.'); return; }
}
window.__ls3.interact = interact;
// Clickable props per chapter (named boxes + invisible hit boxes in each
// chapter group). Filled at boot, after the builders run.
const chapterTargets = {};

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
  // Bridge exterior shot: after the train has run a while, cut to a
  // trackside shot of the full train body moving on its track, hold a few
  // seconds, then return to the deck.
  if (state.chapter === 6 && !bridgeShot.done) {
    const now = Date.now() / 1000;
    if (!bridgeShot.active && now - bridgeShot.startT > 25) {
      bridgeShot.active = true; bridgeShot.until = now + 7;
      toast('The 4 train crosses the bridge - full of passengers, moving.');
    }
    if (bridgeShot.active && now >= bridgeShot.until) {
      bridgeShot.active = false; bridgeShot.done = true; resetView();
    }
  }
  if (bridgeShot.active && trainMesh) {
    // Trackside exterior shot: camera beside the track, tracking the train.
    camera.position.set(16, 4.2, -22);
    camera.lookAt(trainMesh.position.x, 2.5, -30);
  } else {
    const sp = 0.05;
    if (keys['w']) camera.position.z -= sp; if (keys['s']) camera.position.z += sp;
    if (keys['a']) camera.position.x -= sp; if (keys['d']) camera.position.x += sp;
    camera.position.x = Math.max(camBounds.x[0], Math.min(camBounds.x[1], camera.position.x));
    camera.position.z = Math.max(camBounds.z[0], Math.min(camBounds.z[1], camera.position.z));
    camera.rotation.order = 'YXZ';
    const sway = document.getElementById('dialogue').classList.contains('hidden') ? 1 : 0.4;
    camera.rotation.y = state.yaw + Math.sin(t * 0.7) * 0.004 * sway;
    camera.rotation.x = state.pitch + Math.sin(t * 0.9 + 1.3) * 0.003 * sway;
    camera.position.y = camY + Math.sin(t * 0.8) * 0.012 * sway;
  }
  // Press-conference camera flashes.
  for (const fl of flashSprites) {
    if (state.chapter === 5 && Math.random() > 0.97) {
      fl.material.opacity = 0.9;
      try { sfxShutter(); } catch (e) { /* ignore */ } // shutter click with the flash
    } else {
      fl.material.opacity = Math.max(0, fl.material.opacity - 0.05);
    }
  }
  // The police bus roof bar flashes red and blue, alternating.
  if (state.chapter === 3 && policeLightL && policeLightR) {
    const on = Math.sin(t * 6) > 0;
    policeLightL.material.emissiveIntensity = on ? 2.2 : 0.15;
    policeLightR.material.emissiveIntensity = on ? 0.15 : 2.2;
  }
  // The 4 train crosses the distant bridge, over and over.
  if (trainMesh) {
    trainMesh.position.x += 0.03;
    if (trainMesh.position.x > 40) {
      trainMesh.position.x = -40;
      try { sfxTrainPass(); } catch (e) { /* ignore */ } // the train whooshes past again
    }
  }
  updateVanChase(dt, t); // the militant van pulls away and drifts down the road
  // Drift dust: puffs grow and fade.
  for (const p of dustPuffs) {
    if (p.life > 0) {
      p.life -= dt;
      const k = Math.max(0, p.life / p.maxLife);
      p.sprite.material.opacity = 0.5 * k;
      const s = 0.6 + (1 - k) * 1.6;
      p.sprite.scale.set(s, s, 1);
      p.sprite.position.y += dt * 0.5;
      if (p.life <= 0) p.sprite.position.y = -10;
    }
  }
  for (const h of humans) {
    const bt = t * 1.1 + h.phase;
    h.group.scale.set(h.baseScale, h.baseScale * (1 + Math.sin(bt) * 0.012), h.baseScale);
  }
  updateSpeakingGestures(t); // speaking bob, nod, lean and turn (no-op with no speaker)
  // Sound: footsteps while moving, heartbeat and score tension by chapter.
  // The escape is the tense one: sirens, engine, a fast heartbeat.
  const moving = keys['w'] || keys['a'] || keys['s'] || keys['d'];
  let tension = 0.2, hb = 0;
  if (state.chapter === 1) tension = 0.3;
  if (state.chapter === 2) tension = 0.25;
  if (state.chapter === 3) { tension = 0.9; hb = 120; }
  if (state.chapter === 5) tension = 0.35;
  if (state.chapter === 6) tension = 0.15;
  if (escapeActionActive) { tension = 0.95; hb = 125; }
  setTension(tension);
  soundTick(dt, { moving, heartbeatBpm: hb });
  updateEscapeAction(dt); // the escape action sequence, no-op when inactive
  renderer.render(scene, camera);
}
animate();
// ---------- Boot ----------
buildControl();
buildCourt();
buildEscape();
buildSafe();
buildPress();
buildBridge();
// Now that the groups are built, collect each chapter's clickable props.
for (const [n, g] of Object.entries(GROUPS)) {
  const arr = [];
  g.traverse(o => { if (o.userData && o.userData.clickable) arr.push(o); });
  chapterTargets[n] = arr;
}
setObjectives(0); updateHUD(); initVoiceUI();
initSoundUI(); // procedural sound: ambient, effects, score, sound toggle
setAmbient('control'); // the control center: low hum and soft beeps
setTension(0.2);
initZamaUI({ onConnect: async () => {
  // If the player connects late, at the end card, the reveal button
  // appears then.
  if (!document.getElementById('endCard').classList.contains('hidden')) await setupRevealButton();
} });
loadHumans();
