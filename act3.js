import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { FINAL_VALUES, sealFinalChoice, wasSealedOnChain, initZamaUI, setupRevealButton } from './zama.js';
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
  if (!dlgQueue.length) { box.classList.add('hidden'); if (dlgCb) { const f = dlgCb; dlgCb = null; f(); } return; }
  const line = dlgQueue.shift(); box.classList.remove('hidden');
  document.getElementById('dlgName').textContent = line.who;
  document.getElementById('dlgText').textContent = line.text;
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

// ---------- Renderer / scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
  3: { pos: [0, 1.7, 8], yaw: 0, x: [-8, 8], z: [-6, 12] },
  4: { pos: [0, 1.7, 8], yaw: 0, x: [-8, 8], z: [-4, 11] },
  5: { pos: [0, 1.7, 7], yaw: 0, x: [-6, 6], z: [-2, 10] },
  6: { pos: [0, 2.0, 10], yaw: 0, x: [-1.5, 1.5], z: [-12, 12] }
};
let camBounds = VIEWS[1];
let camY = 1.7; // camera height; the rooftop stage raises it, dawn raises it a little
function resetView() {
  const v = VIEWS[state.chapter];
  camera.position.set(v.pos[0], v.pos[1], v.pos[2]);
  state.yaw = v.yaw; state.pitch = 0; camBounds = v;
  camY = state.chapter === 6 ? 2.0 : 1.7;
}
document.getElementById('resetViewBtn').onclick = resetView;
canvas.style.touchAction = 'none';
let dragging = false, lx = 0, ly = 0, dragMoved = 0;
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  dragging = true; dragMoved = 0; lx = e.clientX; ly = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fallback */ }
});
canvas.addEventListener('pointermove', e => {
  if (!dragging) return;
  const dx = e.clientX - lx, dy = e.clientY - ly;
  dragMoved += Math.abs(dx) + Math.abs(dy);
  state.yaw -= dx * 0.0012; state.pitch -= dy * 0.0012;
  state.yaw = Math.max(-1.2, Math.min(1.2, state.yaw));
  state.pitch = Math.max(-0.6, Math.min(0.6, state.pitch));
  lx = e.clientX; ly = e.clientY;
});
function endDrag() { dragging = false; }
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
addEventListener('pointerup', endDrag);
addEventListener('blur', endDrag);
const keys = {};
addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; if (e.key.toLowerCase() === 'r') resetView(); });
addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

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
    cloneCaleb(calebBase, 'leader', 0x0a0a0a, gEscape, 0, -3, 0);
  }
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
function buildEscape() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), stdMat({ color: 0x2a2f33, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; gEscape.add(ground);
  // White corrections van, loading dock.
  box(gEscape, 2.4, 2.4, 5, 0xe8e8e8, 0, 1.2, 2, null, { roughness: 0.5, metalness: 0.2 });
  box(gEscape, 2.2, 0.9, 0.6, 0x1a2a3a, 0, 1.5, 4.6, null, { roughness: 0.3 }); // cab
  const dl = box(gEscape, 1.1, 2.0, 0.08, 0xd8d8d8, -0.55, 1.1, -0.55, 'vanDoors', { roughness: 0.5 });
  const dr = box(gEscape, 1.1, 2.0, 0.08, 0xd8d8d8, 0.55, 1.1, -0.55, 'vanDoors', { roughness: 0.5 });
  vanDoorL = dl; vanDoorR = dr;
  hitBox(gEscape, 2.6, 2.4, 0.8, 0, 1.2, -0.6, 'vanDoors');
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
function startEscapeTimer() {
  let left = 90;
  document.getElementById('timerLabel').textContent = 'Backup';
  document.getElementById('timerVal').textContent = left + ' seconds';
  document.getElementById('timerBar').style.width = '100%';
  if (escapeTimer) clearInterval(escapeTimer);
  escapeTimer = setInterval(() => {
    left--;
    if (left <= 0) { left = 0; clearInterval(escapeTimer); escapeTimer = null; toast('Backup is here - move!'); }
    document.getElementById('timerVal').textContent = left + ' seconds';
    document.getElementById('timerBar').style.width = left + '%';
  }, 1000);
}
function stopEscapeTimer() { if (escapeTimer) { clearInterval(escapeTimer); escapeTimer = null; } }
function startChapter3() {
  state.chapter = 3; state.escapeStep = 0; resetView(); hideToast();
  for (const [n, g] of Object.entries(GROUPS)) g.visible = (parseInt(n, 10) === 3);
  reparentCast('jade', gEscape, -0.9, 3.5, 0);
  reparentCast('caleb', gEscape, 0.9, 3.5, 0);
  setObjectives(0); updateHUD();
  startEscapeTimer();
  showDialogue([
    { who: 'Jade Morales', text: 'A white corrections van idles by the curb. Two officers load us into the back. The doors slam shut. Darkness. A metal bench, a wire mesh partition, a single flickering light.' },
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
    setObjectives(2);
    showDialogue([
      { who: 'System', text: 'SCREECHING TIRES. The van slams to a stop. A CRASH. The back doors are ripped open. Sunlight floods in. Three figures in black tactical gear stand silhouetted against the light.' },
      { who: 'Leader', text: 'Jade Morales. Caleb Bishop. You are coming with us.' },
      { who: 'Caleb Bishop', text: 'Who the hell are you?' },
      { who: 'Leader', text: 'Friends of Derrick Shaw. He said you might need a hand. We have got ninety seconds before backup arrives. Move.' },
      { who: 'Caleb Bishop', text: 'This is insane! We are escaping custody!' },
      { who: 'Jade Morales', text: 'You got a better idea?' }
    ], () => toast('Run - click the rooftop to climb up, then the fire escape down to the SUV.'));
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
    ], () => { setObjectives(3); stopEscapeTimer(); setTimeout(() => startChapter4(), 1200); });
  }
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
  for (const [n, g] of Object.entries(GROUPS)) g.visible = (parseInt(n, 10) === 6);
  reparentCast('jade', gBridge, -0.8, 4, Math.PI);
  reparentCast('caleb', gBridge, 0.8, 4, Math.PI);
  // Dawn light: warm sun, soft sky.
  sun.intensity = 1.4; sun.color.set(0xffd9a0); ambient.intensity = 0.55; hemi.intensity = 0.5;
  scene.background = new THREE.Color(0x2a1a2a); scene.fog.density = 0.008;
  setObjectives(0); updateHUD();
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
  requestAnimationFrame(animate);
  const t = Date.now() / 1000;
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
  // Press-conference camera flashes.
  for (const fl of flashSprites) {
    fl.material.opacity = (state.chapter === 5 && Math.random() > 0.97) ? 0.9 : Math.max(0, fl.material.opacity - 0.05);
  }
  // The 4 train crosses the distant bridge, over and over.
  if (trainMesh) {
    trainMesh.position.x += 0.03;
    if (trainMesh.position.x > 40) trainMesh.position.x = -40;
  }
  for (const h of humans) {
    const bt = t * 1.1 + h.phase;
    h.group.scale.set(h.baseScale, h.baseScale * (1 + Math.sin(bt) * 0.012), h.baseScale);
  }
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
setObjectives(0); updateHUD();
initZamaUI({ onConnect: async () => {
  // If the player connects late, at the end card, the reveal button
  // appears then.
  if (!document.getElementById('endCard').classList.contains('hidden')) await setupRevealButton();
} });
loadHumans();
