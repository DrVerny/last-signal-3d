import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { canvas, renderer, disposeScene, healMorphsIfDirty } from './core.js';
import { FINAL_VALUES, sealFinalChoice, wasSealedOnChain, initZamaUI, setupRevealButton } from './zama.js';
import { speakLine, stopSpeaking, initVoiceUI } from './speak.js';
import { registerHumans, updateSpeakingGestures } from './gestures.js';
import { registerLipSyncHumans } from './lipsync.js';
import { initSoundUI, setAmbient, setTension, soundTick, sfxDoor, sfxBoom, sfxGavel, sfxShutter, sfxRev, sfxTrainPass, sfxThud, sfxAlert } from './sound.js';
import { runHoldQTE } from './qte.js';
import { showActionBanner, hideActionBanner, flashScreen, dist2D, makeActionMarker, showBriefing } from './action.js';
import { grantPayout } from './economy.js';
import { moveDelta, applyPlayerPresence, beginPlayerFrame, setPlayerPos, resolveMove, addBoxCollider } from './player.js';
import { concreteTex, asphaltTex, brickTex, woodTex, metalTex, steelTex, glassTex, cabinGlassTex, fabricTex, carpetTex, plasterTex, roofTex, tileTex, paintTex } from './textures.js';
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
  1: ['Reach the MTA Rail Control Center terminal: walk to the terminal and click it', 'Decide how to fix the EBS virus - and seal the choice: pick a choice', 'The choice stays sealed until the end'],
  2: ['Stand before Judge Ellsworth: walk to the judge', 'Hear the sentence - and what comes with it: watch the hearing'],
  3: ['Step inside the police bus: walk to the rear doors - they slide open', 'When they come for you, click the van doors - then run: move with WASD or the on-screen pad', 'Cross the rooftop - down the fire escape to the SUV: climb with press and hold, then run to the SUV'],
  4: ['Meet Owen Marsh and the ex-city workers: click Owen Marsh', 'See the files, the witnesses, the evidence: click the evidence', 'Agree the plan: the Attorney General\u2019s press conference, 9 AM - pick a choice'],
  5: ['Step up to the podium: walk to the podium and click it', 'Tell the city the truth - and hand over the folder: pick a choice'],
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
      if (c.locked) { b.disabled = true; b.style.opacity = 0.55; b.title = 'Locked - see the requirement in the label'; }
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
function glowTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
}
const GLOW_TEX = glowTexture();
function signTexture(text, bg, fg, sub, panel) {
  return canvasTexture(512, 128, (ctx, w, h) => {
    // panel: a semi-transparent fill (e.g. 'rgba(0,0,0,0.45)') for
    // title cards that float over a scene - the scene shows through
    // behind the text instead of a solid black rectangle. Wall signs
    // omit it and keep the solid plaque.
    ctx.fillStyle = panel || bg; ctx.fillRect(0, 0, w, h);
    if (panel) { ctx.strokeStyle = 'rgba(212,175,55,0.85)'; ctx.lineWidth = 4; ctx.strokeRect(4, 4, w - 8, h - 8); }
    // Auto-fit: the old fixed 52px font overflowed the 512px canvas for
    // every long sign (WILLIAMSBURG BRIDGE - DAWN is ~820px at 52px),
    // so both ends clipped - the Ch 6 card read "AMSBURG BRIDGE".
    // Shrink until the text fits with a margin. measureText is real in
    // the browser; fall back to a per-character estimate when it is not
    // (the harness stub canvas returns a constant 10 for every string).
    ctx.fillStyle = fg; ctx.textAlign = 'center';
    const fitFont = (t, maxSize, weight) => {
      let s = maxSize;
      const widthAt = (size) => {
        ctx.font = (weight ? weight + ' ' : '') + size + 'px Arial';
        let tw = 0;
        try { tw = ctx.measureText(t).width; } catch (e) { tw = 0; }
        if (!tw || tw < t.length * 4) tw = t.length * size * 0.58;
        return tw;
      };
      while (s > 18 && widthAt(s) > w - 32) s -= 2;
      ctx.font = (weight ? weight + ' ' : '') + s + 'px Arial';
      return s;
    };
    fitFont(text, 52, 'bold'); ctx.fillText(text, w / 2, 62);
    if (sub) { fitFont(sub, 26, ''); ctx.fillText(sub, w / 2, 102); }
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
// Act III is dawn: the bridge at dawn. A soft mauve dawn sky and a low
// warm sun, so the act reads as a different time of day from the night
// bridge of Act II. The final bridge chapter sets its own dawn values.
scene.background = new THREE.Color(0x2a2028);
scene.fog = new THREE.FogExp2(0x2a2028, 0.016);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 1.7, 8);
const ambient = new THREE.AmbientLight(0xbfc8d4, 0.5); scene.add(ambient);
const hemi = new THREE.HemisphereLight(0xd8a8a0, 0x2a2418, 0.45); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffd9a0, 1.1); sun.position.set(-14, 7, 8);
sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
// The default shadow frustum is only 10 m across, so shadows vanished a
// few steps from the origin. Widen it to cover the play areas, or the new
// textures sit in flat light. A small bias keeps the textures from
// shimmering with shadow acne.
sun.shadow.camera.left = -20; sun.shadow.camera.right = 20; sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20; sun.shadow.bias = -0.0005; scene.add(sun);
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
  // Keep the stored player position in step, or the next frame's
  // beginPlayerFrame teleports the camera back to the old spot and
  // undoes the reset.
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
addEventListener('keydown', e => { if (!actActive) return; keys[e.key.toLowerCase()] = true; if (e.key.toLowerCase() === 'r') resetView(); });
addEventListener('keyup', e => { if (!actActive) return; keys[e.key.toLowerCase()] = false; });
// A keyup lost to a focus change would leave a movement key stuck on
// forever: drop every held key when the window loses focus.
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
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
  // Cloning copies the base rotation through its quaternion, and the
  // Euler comes back in the gimbal-lock alias (-PI, 0, -PI). That alias
  // stands upright on its own, but anything that writes rotation.x/y
  // alone (the gesture loop does, every frame) leaves rotation.z at
  // -PI and flips the figure upside down under the floor. Reset to a
  // clean Euler first; placeHuman sets the facing yaw below.
  g.rotation.set(0, 0, 0);
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
    gControl.add(jg); placeHuman(jg, 'jade', -1.4, 4.5, Math.PI, jscale);
    afterHuman();
  };
  const addCaleb = (caleb) => {
    const cg = caleb.scene; cg.name = 'caleb';
    const cb = new THREE.Box3().setFromObject(cg); const cs = new THREE.Vector3(); cb.getSize(cs);
    const cscale = 1.68 / cs.y; cg.scale.setScalar(cscale);
    const navy = new THREE.MeshStandardMaterial({ color: 0x1a3a5a, roughness: 0.85, metalness: 0.02 });
    cg.traverse(o => { if (o.isMesh && o.material && o.material.name && o.material.name.indexOf('casualsuit') !== -1) o.material = navy; });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x16283f, roughness: 0.7 });
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.13, 0.07, 16), capMat);
    crown.position.set(0, 1.81, 0); crown.castShadow = true; cg.add(crown);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.012, 0.1), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.3 }));
    brim.position.set(0, 1.775, 0.13); cg.add(brim);
    const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.01, 12), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.25 }));
    badge.rotation.x = Math.PI / 2; badge.position.set(-0.09, 1.32, 0.17); cg.add(badge);
    const calebBase = { group: cg, scale: cscale };
    gControl.add(cg); placeHuman(cg, 'caleb', 1.4, 4.5, Math.PI, cscale);
    // Stand-ins from Caleb's scan, recoloured: the judge, Owen Marsh, the
    // Attorney General, an MTA official, Derrick in the gallery, and the
    // masked leader of the van ambush.
    const judgeG = cloneCaleb(calebBase, 'judge', 0x1a1a1a, gCourt, 0, -4.5, 0);
    judgeG.position.y = 0.5; // stand on the raised dais behind the bench: head above the bench top
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
    afterHuman();
  };
  const addNurse = (nurse) => {
    const ng = nurse.scene; ng.name = 'nurse';
    const nb = new THREE.Box3().setFromObject(ng); const ns = new THREE.Vector3(); nb.getSize(ns);
    const nscale = 1.68 / ns.y; ng.scale.setScalar(nscale);
    gCourt.add(ng); placeHuman(ng, 'nurse', -4.5, 2, 0.5, nscale);
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
  // Start the act now; the characters stream in behind it. Chapter 1
  // needs the scene, the objectives and the briefing, none of which read
  // the human groups directly.
  document.getElementById('loading').classList.add('hidden');
  startChapter1();
  loadOne('models/jade.glb', addJade, 'Jade');
  loadOne('models/caleb.glb', addCaleb, 'Caleb');
  loadOne('models/adeyemi.glb', addNurse, 'Nurse Adeyemi');
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
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), stdMat({ map: tileTex(6, 6, '#23272e', '#0f1216', 4, '#5c626a'), roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; gControl.add(floor);
  box(gControl, 20, 4, 0.4, 0x2a2f33, 0, 2, -5, null, { map: plasterTex(8, 2, '#3a4046'), roughness: 0.9 });
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
  // Terminal desk where the fix is entered: dark wood, not a grey slab.
  // BoxGeometry maps one texture to every face, so a single material
  // left the top reading as a flat slab while the sides showed grain.
  // The top face gets its own strong-grain wood (material index 2, +y);
  // same geometry, same position, same collider as before.
  const deskSideMat = stdMat({ map: woodTex(2, 1, '#4a3423', '#2e2012'), roughness: 0.6, metalness: 0.1 });
  const deskTopMat = stdMat({ map: woodTex(1, 1, '#5a4028', '#33240f', 4, 1.8), roughness: 0.55, metalness: 0.1 });
  const desk = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 1.0), [deskSideMat, deskSideMat, deskTopMat, deskSideMat, deskSideMat, deskSideMat]);
  desk.position.set(0, 0.45, 1.5); desk.castShadow = true; desk.receiveShadow = true; gControl.add(desk);
  // The desk is solid: the player stops at its edge instead of walking
  // straight through it and into the terminal screen.
  addBoxCollider(ch1Colliders, -1.6, 1.0, 1.6, 2.0);
  const term = box(gControl, 1.6, 1.0, 0.1, 0x111111, 0, 1.3, 1.4, 'terminal', { map: metalTex(1, 1, '#1a1d20'), roughness: 0.35, metalness: 0.5 });
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
  // Build the jaw morphs now that the game is on screen, not during the
  // load: mouth estimation must never be able to hold the loading overlay
  // up. The morphs are ready before the first line needs them.
  try { registerLipSyncHumans(humans); } catch (e) { /* lip-sync is best effort */ }
  state.chapter = 1; resetView(); hideToast();
  for (const [n, g] of Object.entries(GROUPS)) g.visible = (parseInt(n, 10) === 1);
  setObjectives(0); updateHUD();
  document.getElementById('timerLabel').textContent = 'EBS virus';
  ebsTick();
  // The reason for Act III: who called, what is wrong, what is at stake.
  // The final choice - how the city fixes itself - is the whole game.
  showBriefing({
    title: 'Act III - The Human Signal',
    calledBy: 'Jade Morales - she called you at dawn, after the bridge.',
    problem: 'Derrick Shaw left one last fail-safe: a virus in the Emergency Broadcast System. In twelve hours it broadcasts a fake all-clear, then a fake evacuation order.',
    stakes: 'Mass panic across the city - and the choice of how to fix it is yours. Quick fix, rebuild, or a third way. The choice you make is the ending.'
  }, () => {
  showDialogue([
    { who: 'Jade Morales', text: 'Four AM. Thirty-six hours after the first blackout. MTA Rail Control Center, Midtown. Derrick Shaw left one last fail-safe: a virus in the Emergency Broadcast System.' },
    { who: 'Caleb Bishop', text: 'Twelve hours, and it broadcasts a fake all-clear - then a fake evacuation order. Mass panic.' },
    { who: 'Jade Morales', text: 'I have the fix. But it needs a choice - and the choice is the whole game. Click the terminal when you are ready.' }
  ], () => { toast('Click the glowing terminal to decide how the city fixes the EBS.'); });
  });
}

// ---------- Chapter 2: The Courtroom ----------
function buildCourt() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), stdMat({ map: woodTex(10, 10, '#6b4a2c', '#4a3018'), roughness: 0.65 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; gCourt.add(floor);
  box(gCourt, 16, 3.4, 0.4, 0x4a3423, 0, 1.7, -5, null, { map: woodTex(8, 2, '#4a3423', '#33241a'), roughness: 0.8 });
  // Judge's bench, raised, with the seal.
  box(gCourt, 6, 0.5, 2, 0x3a2a18, 0, 0.25, -4, null, { map: woodTex(3, 1, '#3a2a18', '#241a10'), roughness: 0.8 });
  const bench = box(gCourt, 5, 1.2, 1.2, 0x4a3423, 0, 1.1, -4.2, 'bench', { map: woodTex(3, 1, '#5a3a22', '#3a2412'), roughness: 0.6 });
  bench.rotation.y = 0;
  hitBox(gCourt, 5.5, 2, 1.6, 0, 1.1, -4.2, 'bench');
  const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.06, 20), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.25 }));
  seal.rotation.x = Math.PI / 2; seal.position.set(0, 1.5, -3.55); gCourt.add(seal);
  // Flags either side of the bench. Big enough and bold enough to
  // read as fabric from the gallery, 11 m away: the old 0.9 m flags
  // with a 2 px weave read as flat colour rectangles at that distance,
  // and the hearing advances before anyone can walk up close. The
  // emblem (stars on the blue flag, gold seal on the red) and the gold
  // fringe are what make them read as flags, not coloured blocks.
  for (const fx of [-3.6, 3.6]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 8), stdMat({ color: 0xd4af37, metalness: 0.8, roughness: 0.4 }));
    pole.position.set(fx, 1.3, -4.6); gCourt.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshStandardMaterial({ map: fabricTex(1, 1, fx < 0 ? '#1a3a8a' : '#8a1a1a', fx < 0 ? 'stars' : 'seal'), roughness: 0.9, side: THREE.DoubleSide }));
    flag.position.set(fx + (fx < 0 ? 0.7 : -0.7), 2.0, -4.6); gCourt.add(flag);
  }
  // Gallery benches. The backrest sits behind the sitter (south side)
  // and low: a seated head is at about 1.3 m, so a back up to 1.1 m
  // leaves heads and shoulders visible from the door. The old tall
  // backs (top 1.45, on the north side, in front of a north-facing
  // sitter) hid every gallery head from the player and the pews read
  // as empty.
  const pewWood = woodTex(2, 1, '#3a2a18', '#241a10');
  for (const gz of [1, 3, 5]) for (const gx of [-3.5, 3.5]) {
    box(gCourt, 3, 0.45, 0.8, 0x3a2a18, gx, 0.55, gz, null, { map: pewWood, roughness: 0.85 });
    box(gCourt, 3, 0.6, 0.12, 0x3a2a18, gx, 0.8, gz - 0.35, null, { map: pewWood, roughness: 0.85 });
  }
  // Witness stand + defendant table.
  box(gCourt, 1.4, 1.1, 1.0, 0x4a3423, -3.2, 0.55, -2.5, null, { map: woodTex(1, 1, '#4a3423', '#33241a'), roughness: 0.8 });
  box(gCourt, 3.4, 0.75, 1.2, 0x2a2118, 0, 0.38, 2.2, null, { map: woodTex(2, 1, '#2a2118', '#1a140c'), roughness: 0.8 });
  // Counsel tables: prosecution on the left, defence on the right.
  const counselWood = woodTex(1, 1, '#2a2118', '#1a140c');
  box(gCourt, 1.6, 0.75, 1.0, 0x2a2118, -2.6, 0.38, 1.6, null, { map: counselWood, roughness: 0.8 });
  box(gCourt, 1.6, 0.75, 1.0, 0x2a2118, 2.6, 0.38, 1.6, null, { map: counselWood, roughness: 0.8 });
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
let busDoorsOpen = false; // the police bus rear doors slide open on walk-up, so the player can step inside
let busDoorCollider = null; // the doorway plug: blocks the rear doorway while the doors are shut, removed when they open
let busLight = null; // the single flickering ceiling light inside the bus
let busLightMesh = null; // its emissive fixture, flickers in sync with the light
const dustPuffs = []; // drifting dust sprites, reused
// A real wheel: a dark tyre with a lighter steel hubcap and a sidewall
// ring on both faces, so it reads as a wheel from the side instead of a
// flat black disc buried under the body. axis 'x' is for road vehicles
// (axle across the body); axis 'z' is for the train (axle across the track).
function makeWheel(r, w, axis) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 20), stdMat({ color: 0x0d0d0d, roughness: 0.95 }));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, w + 0.06, 16), stdMat({ color: 0xa8adb2, metalness: 0.8, roughness: 0.35 }));
  if (axis === 'z') { tyre.rotation.x = Math.PI / 2; hub.rotation.x = Math.PI / 2; }
  else { tyre.rotation.z = Math.PI / 2; hub.rotation.z = Math.PI / 2; }
  tyre.castShadow = true; g.add(tyre); g.add(hub);
  for (const s of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, r * 0.07, 8, 20), stdMat({ color: 0x2e2e2e, roughness: 0.9 }));
    if (axis === 'z') ring.position.z = s * (w / 2 + 0.01);
    else { ring.rotation.y = Math.PI / 2; ring.position.x = s * (w / 2 + 0.01); }
    g.add(ring);
  }
  return g;
}
// A fender arch over a road wheel: a half-torus in the wheel plane, top
// half only, in the body colour, so the wheel sits in an arch instead of
// disappearing under a flat body side.
function makeFenderArch(r, color) {
  const arch = new THREE.Mesh(new THREE.TorusGeometry(r, 0.09, 8, 16, Math.PI), stdMat({ color, roughness: 0.5, metalness: 0.25 }));
  arch.rotation.y = Math.PI / 2;
  return arch;
}
// The militant van is solid: a live axis-aligned box that follows it.
// The van is parked against the bus at first, then pulls away and drifts
// down the road right across the player's run to the ladder, so without
// this it drives straight through him. Updated every frame in
// updateVanChase and once at build; act3Colliders() includes it only
// while the player is on the street (on the rooftop he is above it).
const vanCollider = { x0: 0, z0: 0, x1: 0, z1: 0 };
function updateVanCollider() {
  if (!militantVan) return;
  const th = militantVan.rotation.y;
  const hw = 1.1 * Math.abs(Math.cos(th)) + 2.3 * Math.abs(Math.sin(th));
  const hd = 1.1 * Math.abs(Math.sin(th)) + 2.3 * Math.abs(Math.cos(th));
  vanCollider.x0 = militantVan.position.x - hw;
  vanCollider.x1 = militantVan.position.x + hw;
  vanCollider.z0 = militantVan.position.z - hd;
  vanCollider.z1 = militantVan.position.z + hd;
}
// The militant van's chase: rammed into the bus, then it pulls back, turns
// onto the road and drifts away down the street, looping behind the camera.
const vanChase = { phase: 'rammed', t: 0, fromX: 0, fromZ: 0, fromYaw: 0, toX: 0, toZ: 0, toYaw: 0, z: 0, spawnT: 0 };
function buildEscape() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), stdMat({ map: concreteTex(8, 8), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; gEscape.add(ground);
  // The road: a marked asphalt strip running the length of the scene, so the
  // chase plays out on a street the camera can see, not a blank floor.
  const road = new THREE.Mesh(new THREE.PlaneGeometry(7, 34), new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.95 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0.02, 0); road.receiveShadow = true; gEscape.add(road);
  for (const sx of [-1, 1]) box(gEscape, 2.2, 0.14, 34, 0x4a4d4f, sx * 4.6, 0.07, 0, null, { map: concreteTex(1, 12, '#5a5d60'), roughness: 1 }); // sidewalks
  // Street lamps along the road.
  const poleMetal = metalTex(1, 2, '#2a2f33');
  for (const [lx, lz] of [[4.2, -6], [-4.2, 0], [4.2, 6]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.5, 8), stdMat({ map: poleMetal, metalness: 0.6, roughness: 0.5 }));
    pole.position.set(lx, 2.25, lz); gEscape.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.25), new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffc978, emissiveIntensity: 0.9 }));
    head.position.set(lx + (lx > 0 ? -0.3 : 0.3), 4.5, lz); gEscape.add(head);
  }
  // Police transport bus: the offender rides in this. Navy body, white band,
  // POLICE lettering, barred windows, flashing roof bar, rear doors (the
  // click target, same name as the old van doors so the escape still works).
  const bus = new THREE.Group(); bus.position.set(0, 0, 2); bus.name = 'policeBus'; gEscape.add(bus);
  // The bus is a real shell, not a solid box: the player steps inside
  // through the rear doors. Floor, side walls, front wall, rear wall in
  // two segments with a 1.4 m doorway, and the roof. DoubleSide so the
  // inside reads as walls, not sky. Same navy outside as before.
  const busShellMat = stdMat({ map: metalTex(2, 1, '#22395e'), roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide });
  const busFloor = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 6), stdMat({ map: metalTex(2, 2, '#23262a'), roughness: 0.95, side: THREE.DoubleSide }));
  busFloor.position.set(0, 0.05, 0); busFloor.receiveShadow = true; bus.add(busFloor);
  for (const sx of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.6, 6), busShellMat);
    wall.position.set(sx * 1.25, 1.4, 0); wall.castShadow = true; wall.receiveShadow = true; bus.add(wall);
  }
  const busFront = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 0.1), busShellMat);
  busFront.position.set(0, 1.4, 2.95); busFront.castShadow = true; bus.add(busFront);
  for (const sx of [-1, 1]) {
    const rear = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.6, 0.1), busShellMat);
    rear.position.set(sx * 1.0, 1.4, -2.95); rear.castShadow = true; bus.add(rear);
  }
  const busHeader = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 0.1), busShellMat);
  busHeader.position.set(0, 2.5, -2.95); bus.add(busHeader);
  // Roof cap and bumpers, so the body reads as a bus and not a plain box.
  const busRoof = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.18, 5.9), stdMat({ color: 0x2c4a72, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide }));
  busRoof.position.set(0, 2.78, 0); busRoof.castShadow = true; bus.add(busRoof);
  for (const bz of [3.02, -3.02]) {
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.25, 0.3), stdMat({ color: 0xc8ccd0, metalness: 0.8, roughness: 0.3 }));
    bumper.position.set(0, 0.35, bz); bus.add(bumper);
  }
  for (const hx of [-0.85, 0.85]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.08), new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe9a0, emissiveIntensity: 1.5 }));
    hl.position.set(hx, 0.75, 3.06); bus.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.08), new THREE.MeshStandardMaterial({ color: 0xaa0000, emissive: 0xff2020, emissiveIntensity: 1.2 }));
    tl.position.set(hx, 0.75, -3.06); bus.add(tl);
  }
  // The bus walls are solid; the rear doorway is the only way in.
  // The doorway plug blocks it while the doors are shut and is removed
  // when they slide open (see openBusDoors). The benches and the mesh
  // partition are solid too, so the player cannot walk through them.
  addBoxCollider(ch3Colliders, -1.45, -1, -1.15, 5); // west wall
  addBoxCollider(ch3Colliders, 1.15, -1, 1.45, 5); // east wall
  addBoxCollider(ch3Colliders, -1.3, 4.85, 1.3, 5.15); // front wall (south)
  addBoxCollider(ch3Colliders, -1.3, -1.15, -0.7, -0.85); // rear wall, west of the doorway
  addBoxCollider(ch3Colliders, 0.7, -1.15, 1.3, -0.85); // rear wall, east of the doorway
  addBoxCollider(ch3Colliders, -1.2, 0, -0.7, 2.5); // west bench
  addBoxCollider(ch3Colliders, 0.7, 0, 1.2, 2.5); // east bench
  addBoxCollider(ch3Colliders, -1.2, 3.75, 1.2, 3.85); // wire mesh partition
  busDoorCollider = { x0: -0.7, z0: -1.15, x1: 0.7, z1: -0.85 };
  ch3Colliders.push(busDoorCollider);
  const busBand = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.55, 6.02), stdMat({ map: metalTex(2, 1, '#d8d8d8'), roughness: 0.5, metalness: 0.1 }));
  busBand.position.set(0, 1.55, 0); bus.add(busBand);
  for (const sx of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.7), new THREE.MeshStandardMaterial({ map: signTexture('POLICE', '#f8f8f8', '#1a2a4a', ''), roughness: 0.6 }));
    plate.position.set(sx * 1.32, 1.95, 0); plate.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2; bus.add(plate);
  }
  const shield = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.9), new THREE.MeshStandardMaterial({ color: 0x0a141e, roughness: 0.15, metalness: 0.5 }));
  shield.position.set(0, 1.7, 3.02); bus.add(shield);
  // One shared glass texture for all bus windows: the same pane repeated,
  // not a fresh canvas per window.
  const winGlass = glassTex();
  for (const sx of [-1, 1]) for (const wz of [-2, -0.6, 0.8, 2.2]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.7), new THREE.MeshStandardMaterial({ map: winGlass, roughness: 0.1, metalness: 0.5 }));
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
  // Real tyres: large, outboard of the body side so they read as wheels
  // from the side, with a steel hubcap and a fender arch over each one.
  // The old wheels were flat black discs flush with the body side, hidden
  // under the dark body on a dark street.
  for (const [wx, wz] of [[-1.33, -1.8], [1.33, -1.8], [-1.33, 2.0], [1.33, 2.0]]) {
    const wh = makeWheel(0.55, 0.35, 'x');
    wh.position.set(wx, 0.55, wz); bus.add(wh);
    const arch = makeFenderArch(0.67, 0x22395e);
    arch.position.set(wx > 0 ? 1.31 : -1.31, 0.55, wz); bus.add(arch);
  }
  // Rear doors on real hinges: each panel hangs from a group at the
  // doorway edge, so it swings open instead of sliding through the
  // wall. DoubleSide so the closed doors read as a wall from inside
  // the bus too. The panels are the click target that starts the
  // escape, as before; walking up to them opens them (see openBusDoors).
  const doorMetal = metalTex(1, 1, '#c8c8c8');
  const doorMat = stdMat({ map: doorMetal, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide });
  const dl = new THREE.Group(); dl.position.set(-0.7, 1.2, -3.05); bus.add(dl);
  const dlPanel = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.2, 0.1), doorMat);
  dlPanel.position.set(0.35, 0, 0); dlPanel.name = 'vanDoors'; dlPanel.userData.clickable = true; dl.add(dlPanel);
  const dr = new THREE.Group(); dr.position.set(0.7, 1.2, -3.05); bus.add(dr);
  const drPanel = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.2, 0.1), doorMat);
  drPanel.position.set(-0.35, 0, 0); drPanel.name = 'vanDoors'; drPanel.userData.clickable = true; dr.add(drPanel);
  vanDoorL = dl; vanDoorR = dr;
  // Inside the bus: what Jade describes - a metal bench along each
  // side, a wire mesh partition, a single flickering light. Jade and
  // Caleb already stand in here at the chapter start (reparented to
  // (+-0.9, 3.5)), clear of the benches, just north of the partition.
  const benchSteel = stdMat({ color: 0x8a9094, roughness: 0.4, metalness: 0.7 });
  for (const sx of [-1, 1]) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 2.5), benchSteel);
    bench.position.set(sx * 0.95, 0.325, -0.75); bench.castShadow = true; bus.add(bench);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 2.5), benchSteel);
    back.position.set(sx * 1.18, 0.8, -0.75); bus.add(back);
  }
  const meshSteel = stdMat({ color: 0x55595e, roughness: 0.5, metalness: 0.8 });
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.5, 0.06), meshSteel);
    post.position.set(sx * 1.2, 1.35, 1.8); bus.add(post);
  }
  for (const ry of [0.2, 2.5]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.06, 0.06), meshSteel);
    rail.position.set(0, ry, 1.8); bus.add(rail);
  }
  for (let bx = -1.2; bx <= 1.21; bx += 0.2) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.02, 2.3, 0.02), meshSteel);
    bar.position.set(bx, 1.35, 1.8); bus.add(bar);
  }
  for (let by = 0.4; by <= 2.31; by += 0.21) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.02, 0.02), meshSteel);
    bar.position.set(0, by, 1.8); bus.add(bar);
  }
  busLightMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.3), new THREE.MeshStandardMaterial({ color: 0x666666, emissive: 0xffe9a8, emissiveIntensity: 1.2 }));
  busLightMesh.position.set(0, 2.62, 0); bus.add(busLightMesh);
  busLight = new THREE.PointLight(0xffe9a8, 0.9, 7, 1.5);
  busLight.position.set(0, 2.3, 0); busLight.visible = false; bus.add(busLight);
  vanDoorsHit = hitBox(gEscape, 2.8, 2.6, 0.8, 0, 1.3, -1.1, 'vanDoors');
  // The militants' van: a dark van rammed nose-first into the bus's left
  // flank. Its nose touches the bus side at (-1.3, 2.3), with a dust puff
  // at the impact point. It pulls away and drifts down the road once the
  // doors are ripped open (see updateVanChase in the animate loop).
  militantVan = new THREE.Group();
  militantVan.position.set(-3.0, 0, 0.8); militantVan.rotation.y = 0.85;
  gEscape.add(militantVan);
  // Dark grey-blue, not near-black: the old #0d0d0f body with metalness
  // 0.4 was invisible against the near-black street, especially on a
  // phone screen. A light side stripe gives the silhouette an edge.
  const mvBody = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.0, 4.6), stdMat({ map: metalTex(2, 1, '#3d4756'), roughness: 0.55, metalness: 0.12 }));
  mvBody.position.set(0, 1.15, 0); mvBody.castShadow = true; mvBody.receiveShadow = true; militantVan.add(mvBody);
  const mvStripe = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.18, 4.62), stdMat({ color: 0x7a8694, roughness: 0.5, metalness: 0.15 }));
  mvStripe.position.set(0, 1.35, 0); militantVan.add(mvStripe);
  const mvCab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 0.8), stdMat({ map: metalTex(1, 1, '#2f3a48'), roughness: 0.5, metalness: 0.12 }));
  mvCab.position.set(0, 1.35, 2.0); militantVan.add(mvCab);
  const mvShield = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.7), new THREE.MeshStandardMaterial({ map: glassTex(), roughness: 0.1, metalness: 0.5 }));
  mvShield.position.set(0, 1.4, 2.42); militantVan.add(mvShield);
  for (const [wx, wz] of [[-1.12, -1.5], [1.12, -1.5], [-1.12, 1.5], [1.12, 1.5]]) {
    const wh = makeWheel(0.42, 0.3, 'x');
    wh.position.set(wx, 0.42, wz); militantVan.add(wh);
    const arch = makeFenderArch(0.54, 0x3d4756);
    arch.position.set(wx > 0 ? 1.11 : -1.11, 0.42, wz); militantVan.add(arch);
  }
  updateVanCollider(); // the van is solid from the moment it is parked here
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
  // A proper police car (sedan) parked on the east side of the street:
  // the scene had a bus and a van but no police car. White body with a
  // black hood and trunk, POLICE on the doors, a red/blue light bar, four
  // real tyres, bumpers and headlights. Parked clear of the ladder run,
  // the fire-escape path and the SUV approach; it does not drive. It is
  // solid, like the bus.
  const policeCar = new THREE.Group();
  policeCar.position.set(4.5, 0, 8); policeCar.rotation.y = 0.15;
  policeCar.name = 'policeCar'; gEscape.add(policeCar);
  const pcBody = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 4.4), stdMat({ color: 0xe8e8e8, roughness: 0.4, metalness: 0.3 }));
  pcBody.position.set(0, 0.62, 0); pcBody.castShadow = true; pcBody.receiveShadow = true; policeCar.add(pcBody);
  const pcHood = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.1, 1.0), stdMat({ color: 0x14161a, roughness: 0.4, metalness: 0.3 }));
  pcHood.position.set(0, 0.92, -1.6); policeCar.add(pcHood);
  const pcTrunk = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.1, 0.9), stdMat({ color: 0x14161a, roughness: 0.4, metalness: 0.3 }));
  pcTrunk.position.set(0, 0.92, 1.6); policeCar.add(pcTrunk);
  const pcCabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.2), stdMat({ color: 0xe8e8e8, roughness: 0.4, metalness: 0.3 }));
  pcCabin.position.set(0, 1.15, 0.1); pcCabin.castShadow = true; policeCar.add(pcCabin);
  const pcGlass = glassTex();
  const pcShield = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.5), new THREE.MeshStandardMaterial({ map: pcGlass, roughness: 0.1, metalness: 0.5 }));
  pcShield.position.set(0, 1.2, -1.02); pcShield.rotation.x = -0.25; policeCar.add(pcShield);
  const pcRear = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.5), new THREE.MeshStandardMaterial({ map: pcGlass, roughness: 0.1, metalness: 0.5 }));
  pcRear.position.set(0, 1.2, 1.22); pcRear.rotation.y = Math.PI; pcRear.rotation.x = 0.25; policeCar.add(pcRear);
  for (const sx of [-1, 1]) {
    const pcWin = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.45), new THREE.MeshStandardMaterial({ map: pcGlass, roughness: 0.1, metalness: 0.5 }));
    pcWin.position.set(sx * 0.81, 1.2, 0.1); pcWin.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2; policeCar.add(pcWin);
    const pcPlate = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshStandardMaterial({ map: signTexture('POLICE', '#f8f8f8', '#14161a', ''), roughness: 0.6 }));
    pcPlate.position.set(sx * 0.92, 0.72, 0.1); pcPlate.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2; policeCar.add(pcPlate);
    const pcWheel = makeWheel(0.34, 0.24, 'x');
    pcWheel.position.set(sx * 0.85, 0.34, -1.35); policeCar.add(pcWheel);
    const pcWheel2 = makeWheel(0.34, 0.24, 'x');
    pcWheel2.position.set(sx * 0.85, 0.34, 1.35); policeCar.add(pcWheel2);
    const pcArch = makeFenderArch(0.46, 0xe8e8e8);
    pcArch.position.set(sx * 0.91, 0.34, -1.35); policeCar.add(pcArch);
    const pcArch2 = makeFenderArch(0.46, 0xe8e8e8);
    pcArch2.position.set(sx * 0.91, 0.34, 1.35); policeCar.add(pcArch2);
    const pcHead = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.3), new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe9a0, emissiveIntensity: 1.5 }));
    pcHead.position.set(sx * 0.55, 0.7, -2.21); policeCar.add(pcHead);
    const pcTail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.3), new THREE.MeshStandardMaterial({ color: 0xaa0000, emissive: 0xff2020, emissiveIntensity: 1.2 }));
    pcTail.position.set(sx * 0.55, 0.7, 2.21); policeCar.add(pcTail);
  }
  const pcBarBase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.35), stdMat({ color: 0x111111, roughness: 0.4 }));
  pcBarBase.position.set(0, 1.48, 0.1); policeCar.add(pcBarBase);
  const pcLightL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.3), new THREE.MeshStandardMaterial({ color: 0xaa0000, emissive: 0xff2020, emissiveIntensity: 1.2, roughness: 0.3 }));
  pcLightL.position.set(-0.28, 1.56, 0.1); policeCar.add(pcLightL);
  const pcLightR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.3), new THREE.MeshStandardMaterial({ color: 0x0000aa, emissive: 0x2040ff, emissiveIntensity: 1.2, roughness: 0.3 }));
  pcLightR.position.set(0.28, 1.56, 0.1); policeCar.add(pcLightR);
  for (const bz of [-2.15, 2.15]) {
    const pcBumper = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.18, 0.3), stdMat({ color: 0xc8ccd0, metalness: 0.8, roughness: 0.3 }));
    pcBumper.position.set(0, 0.35, bz); policeCar.add(pcBumper);
  }
  const pcGrille = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 0.06), stdMat({ color: 0x222222, metalness: 0.6, roughness: 0.4 }));
  pcGrille.position.set(0, 0.6, -2.21); policeCar.add(pcGrille);
  // Parked at (4.5, 8), angled 0.15 rad: axis-aligned footprint
  // x 3.28..5.72, z 5.69..10.31. Clear of the spawn walk (x 0), the
  // ladder run and the SUV approach.
  addBoxCollider(ch3Colliders, 3.28, 5.69, 5.72, 10.31);
  // Rooftop (raised platform) with AC units and a parapet: gravel
  // membrane on top, concrete parapet, brushed-metal AC boxes.
  box(gEscape, 10, 0.4, 8, 0x3a3f42, -4, 2.6, -6, null, { map: roofTex(4, 3), roughness: 1 });
  rooftopHit = hitBox(gEscape, 10, 1.4, 8, -4, 3.2, -6, 'rooftop');
  box(gEscape, 10, 0.5, 0.3, 0x2a2f33, -4, 3.0, -10, null, { map: concreteTex(4, 1, '#2a2f33'), roughness: 1 });
  box(gEscape, 1.5, 1.0, 1.5, 0x5a5f62, -6, 3.3, -7, null, { map: metalTex(1, 1, '#5a5f62'), roughness: 0.7, metalness: 0.4 });
  box(gEscape, 1.2, 0.8, 1.2, 0x4a4f52, -2, 3.2, -8, null, { map: metalTex(1, 1, '#4a4f52'), roughness: 0.7, metalness: 0.4 });
  // Fire escape stairs down from the rooftop to the alley. Light brushed
  // steel: the old near-black steel read as a flat black platform.
  const stepSteel = steelTex(1, 1, '#767c82');
  for (let i = 0; i < 5; i++) {
    box(gEscape, 1.2, 0.08, 0.5, 0x1a1d20, 1.5, 2.6 - i * 0.5, -2.5 + i * 0.9, i === 2 ? 'fireEscape' : null, { map: stepSteel, roughness: 0.5, metalness: 0.4 });
  }
  hitBox(gEscape, 1.6, 3.0, 3.0, 1.5, 1.5, -0.5, 'fireEscape');
  // Black SUV waiting in the alley: glossy black paint, glass cabin.
  // The paint highlight is baked into the texture (paintTex): with no
  // env map in the scene a dark standard material goes flat black no
  // matter how low the metalness is. Chrome beltline and bumpers give
  // the body its edges back.
  box(gEscape, 2.0, 1.4, 4.4, 0x33383f, 5.5, 0.9, -1, 'suv', { map: paintTex(2, 1, '#33383f'), roughness: 0.22, metalness: 0.15 });
  // Cabin: bright sky-blue glass, stepped in 0.2 m per side from the
  // body so it reads as a greenhouse, not more bodywork. The old dark
  // glass (#1a2836) was darker than the glossy body and vanished into
  // it from the rear view at 3 m - the only view the player gets.
  box(gEscape, 1.6, 0.7, 2.2, 0x111418, 5.5, 1.9, -1, null, { map: cabinGlassTex(), roughness: 0.05, metalness: 0.15 });
  const chromeTex = steelTex(1, 1, '#b8bcc0');
  for (const sx of [-1.01, 1.01]) box(gEscape, 0.04, 0.08, 4.2, 0xb8bcc0, 5.5 + sx, 1.15, -1, null, { map: chromeTex, roughness: 0.3, metalness: 0.6 });
  box(gEscape, 2.02, 0.2, 0.12, 0xb8bcc0, 5.5, 0.45, 1.22, null, { map: chromeTex, roughness: 0.3, metalness: 0.6 });
  box(gEscape, 2.02, 0.2, 0.12, 0xb8bcc0, 5.5, 0.45, -3.22, null, { map: chromeTex, roughness: 0.3, metalness: 0.6 });
  hitBox(gEscape, 2.6, 2.2, 5.0, 5.5, 1.0, -1, 'suv');
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('QUEENSBORO PLAZA', '#111111', '#e8e8e8', 'AFTERNOON'), transparent: true, depthWrite: false }));
  sign.scale.set(5, 1.25, 1); sign.position.set(0, 5.5, -8); gEscape.add(sign);
  blobShadow(gEscape, 0, 2, 2.6, 5, 0.5);
}
// The bus rear doors swing open when the player walks up to them, so
// he can step inside the bus before the escape starts. Called from
// animate; the escape still starts by clicking the doors (the ripped-
// open doors swing further on their hinges, as before).
function openBusDoors() {
  if (busDoorsOpen || state.chapter !== 3 || state.escapeStep !== 0) return;
  busDoorsOpen = true;
  if (vanDoorL) vanDoorL.rotation.y = 1.9;
  if (vanDoorR) vanDoorR.rotation.y = -1.9;
  if (busDoorCollider) {
    const i = ch3Colliders.indexOf(busDoorCollider);
    if (i >= 0) ch3Colliders.splice(i, 1);
  }
  try { sfxDoor(); } catch (e) { /* ignore */ }
  toast('The bus doors swing open - step inside.');
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
  if (rooftopHit) rooftopHit.visible = true; // the rooftop click target, hidden again once the player climbs up
  if (vanDoorsHit) vanDoorsHit.visible = true; // the van-doors click target, hidden again once the doors open
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
    // Doors ripped open: flung wide on their hinges (they already stand
    // open if the player walked up to them first). The doorway plug goes
    // too, so the player can run out of the bus to the ladder.
    if (vanDoorL) vanDoorL.rotation.y = 2.2;
    if (vanDoorR) vanDoorR.rotation.y = -2.2;
    if (busDoorCollider) {
      const i = ch3Colliders.indexOf(busDoorCollider);
      if (i >= 0) ch3Colliders.splice(i, 1);
    }
    busDoorsOpen = true;
    if (vanDoorsHit) vanDoorsHit.visible = false; // the big doors hitbox sits between the roof and the fire escape: left visible it swallows the later fire-escape click
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
    camY = 3.4; camera.position.set(-4, 3.4, -4); setPlayerPos(-4, -4); // keep the teleport: beginPlayerFrame snaps the camera back to the stored position every frame
    if (rooftopHit) rooftopHit.visible = false; // the player teleports inside this hitbox: left visible it swallows every later click, including the fire-escape click
    showDialogue([
      { who: 'System', text: 'Across the rooftop, past the AC units, the city spread out below. The leader stops at the edge. Below: a fire escape leading to an alley. A black SUV waits.' },
      { who: 'Leader', text: 'Down. Now.' }
    ], () => toast('Click the fire escape stairs to climb down.'));
  } else if (state.escapeStep === 2) {
    state.escapeStep = 3;
    camY = 1.9; camera.position.set(5.5, 1.9, 2); setPlayerPos(5.5, 2); // keep the teleport: beginPlayerFrame snaps the camera back to the stored position every frame
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
let escapeMarkers = {}, escapeBarriers = [], escapeLight = null, escapeBeam = null, escapeBeamX = -4, rooftopHit = null, vanDoorsHit = null;
function buildEscapeAction() {
  if (escapeMarkers.ladder) return;
  try {
    escapeMarkers.ladder = makeActionMarker('LADDER', '#7ac74f');
    if (escapeMarkers.ladder) { escapeMarkers.ladder.position.set(-4, 1.8, -2); escapeMarkers.ladder.visible = false; gEscape.add(escapeMarkers.ladder); }
    escapeMarkers.fire = makeActionMarker('FIRE ESCAPE', '#ffd166');
    if (escapeMarkers.fire) { escapeMarkers.fire.position.set(1.5, 3.8, -2); escapeMarkers.fire.visible = false; gEscape.add(escapeMarkers.fire); }
    escapeMarkers.suv = makeActionMarker('SUV', '#7ac74f');
    if (escapeMarkers.suv) { escapeMarkers.suv.position.set(5.5, 1.8, -1); escapeMarkers.suv.visible = false; gEscape.add(escapeMarkers.suv); }
    const barrierWood = woodTex(1, 1, '#4a3620', '#2e2010');
    for (const z of [-2, -3.5, -0.5]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), new THREE.MeshStandardMaterial({ map: barrierWood, roughness: 0.9 }));
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
        escapeClimb('CLIMB UP', 'Hold SPACE or press and hold here to climb the ladder to the rooftop.', () => {
          if (!escapeActionActive) return;
          camY = 3.4; camera.position.set(-4, 3.4, -4); setPlayerPos(-4, -4); // keep the teleport: beginPlayerFrame snaps the camera back to the stored position every frame
          if (rooftopHit) rooftopHit.visible = false; // the player teleports inside this hitbox: left visible it swallows every later click, including the fire-escape click
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
        escapeClimb('CLIMB DOWN', 'Hold SPACE or press and hold here to climb down the fire escape.', () => {
          if (!escapeActionActive) return;
          camY = 1.9; camera.position.set(5.5, 1.9, 2); setPlayerPos(5.5, 2); // keep the teleport: beginPlayerFrame snaps the camera back to the stored position every frame
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
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), stdMat({ map: concreteTex(7, 7, '#3a3630', '#2a2724'), roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; gSafe.add(floor);
  box(gSafe, 20, 4.5, 0.4, 0x4a4640, 0, 2.25, -5, null, { map: brickTex(11, 4, '#6a4a3a', '#9a8a76'), roughness: 0.95 });
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
  const crateWood = woodTex(1, 1, '#6a5232', '#4a3620');
  for (const [cx, cz] of [[-6, 2], [-5, 3.2], [5, 3]]) box(gSafe, 1.2, 1.0, 1.2, 0x5a4632, cx, 0.5, cz, null, { map: crateWood, roughness: 0.95 });
  // The cot: lighter olive canvas, so it reads against the dark concrete
  // floor instead of vanishing into it. Same position and size as before.
  box(gSafe, 1.8, 0.4, 0.7, 0x3a4a3a, -6, 0.25, -1, null, { map: fabricTex(2, 1, '#6a7a58'), roughness: 0.95 });
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
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), stdMat({ map: carpetTex(8, 8, '#6b5648'), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; gPress.add(ground);
  // Red carpet runner to the podium: the unmistakable carpet signal.
  // It runs from the crowd to the podium, passing under the barrier.
  box(gPress, 2.2, 0.02, 9, 0x7a2020, 0, 0.01, 1.5, null, { map: carpetTex(1, 4, '#7a2020'), roughness: 1 });
  // Podium with microphones.
  box(gPress, 1.6, 1.2, 0.8, 0x2a2118, 0, 0.6, -2, 'podium', { map: woodTex(2, 1, '#3a2a18', '#241a10'), roughness: 0.7 });
  hitBox(gPress, 2.2, 1.8, 1.4, 0, 0.8, -2, 'podium');
  // The podium is solid: the player steps up to it and clicks it, he
  // does not walk through it. Progression is by click, so blocking the
  // footprint cannot strand him.
  addBoxCollider(ch5Colliders, -1.1, -2.7, 1.1, -1.3);
  for (const mx of [-0.3, 0, 0.3]) {
    const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), stdMat({ color: 0x111111, roughness: 0.4 }));
    mic.position.set(mx, 1.45, -1.9); mic.rotation.x = 0.4; gPress.add(mic);
  }
  // Cameras on tripods, with flash sprites.
  const legSteel = steelTex(1, 2);
  for (const [cx, cz] of [[-3, 2], [0, 3], [3, 2]]) {
    const cam = box(gPress, 0.5, 0.35, 0.7, 0x1a1d20, cx, 1.5, cz, null, { map: metalTex(1, 1, '#1a1d20'), roughness: 0.4, metalness: 0.4 });
    cam.rotation.y = cx === 0 ? 0 : (cx < 0 ? 0.5 : -0.5);
    for (const [lx, lz] of [[-0.2, 0.2], [0.2, 0.2]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6), stdMat({ map: legSteel, metalness: 0.7, roughness: 0.4 }));
      leg.position.set(cx + lx, 0.75, cz + lz); leg.rotation.z = lx * 0.8; gPress.add(leg);
    }
    const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    fl.scale.set(1.6, 1.6, 1); fl.position.set(cx, 1.6, cz - 0.4); gPress.add(fl); flashSprites.push(fl);
  }
  // Crowd: a row of press figures behind the barrier. They are PEOPLE,
  // not bollards: varied shirts, skin tones, shoulders and heights, so
  // the row reads as a crowd at a glance. The old version was seven
  // identical near-black tapered cylinders with tan sphere heads, and
  // in play it read as a row of bollards in front of the steel bar.
  box(gPress, 10, 0.9, 0.3, 0x8a8a8a, 0, 0.45, 4.5, null, { map: steelTex(4, 1, '#9aa0a6'), roughness: 0.45, metalness: 0.3 });
  const pressShirts = ['#2a3a55', '#3a3a3a', '#4a3528', '#2a4030', '#4a2a30', '#35424a', '#24344d'];
  const pressSkins = ['#2e1a0e', '#5a3a22', '#8a5a3a', '#a06a42', '#e8c8a8'];
  for (let i = 0; i < 7; i++) {
    const hgt = 1.0 + (i % 3) * 0.08;
    const shirt = pressShirts[i % pressShirts.length];
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, hgt, 8), stdMat({ color: shirt, roughness: 0.9 }));
    p.position.set(-4.5 + i * 1.5, hgt / 2, 5.2); gPress.add(p);
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.3), stdMat({ color: shirt, roughness: 0.9 }));
    sh.position.set(-4.5 + i * 1.5, hgt - 0.08, 5.2); gPress.add(sh);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), stdMat({ color: pressSkins[i % pressSkins.length], roughness: 0.8 }));
    h.position.set(-4.5 + i * 1.5, hgt + 0.12, 5.2); gPress.add(h);
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
    updateVanCollider();
    if (ramPuff) ramPuff.material.opacity = Math.max(0, 0.5 - k * 0.5);
    if (k >= 1) { vanChase.phase = 'drift'; vanChase.z = militantVan.position.z; vanChase.spawnT = 0; }
    return;
  }
  // Drift: the van runs down the road (toward -z) weaving across its
  // lane, its nose pointed a slip angle away from its direction of
  // travel so the rear reads as sliding out, with dust at the rear
  // wheels. When it runs off the far end it loops back behind the
  // camera, out of sight. It weaves across the east half of the road
  // only: the old weave (x -3..-1) sat right on the ladder approach
  // at (-4,-2), so the solid van could wall the player off the ladder.
  // The ladder approach from the west stays open now.
  vanChase.z -= 4.5 * dt;
  if (vanChase.z < -16) vanChase.z = 10;
  const weave = Math.sin(vanChase.z * 0.25);
  militantVan.position.z = vanChase.z;
  militantVan.position.x = -1.5 + weave * 0.8;
  const slip = 0.28 * Math.sin(vanChase.z * 0.25 + 0.8);
  militantVan.rotation.y = Math.PI + slip;
  updateVanCollider();
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
  // Lightened so the dawn actually reads: the old 0x2a1a2a sky and the
  // 92%-black end card together left the bridge nearly invisible.
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(160, 50), new THREE.MeshBasicMaterial({ color: 0x5a3a4d }));
  sky.position.set(0, 18, -55); gBridge.add(sky);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xffb36a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  sunGlow.scale.set(26, 12, 1); sunGlow.position.set(0, 4, -50); gBridge.add(sunGlow);
  // Bridge deck + railings.
  box(gBridge, 4, 0.5, 30, 0x3a3f42, 0, -0.25, -2, null, { map: asphaltTex(1, 10, '#45484d'), roughness: 0.95 });
  const deckRailSteel = steelTex(1, 8);
  for (const sx of [-1.9, 1.9]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 30, 8), stdMat({ map: deckRailSteel, metalness: 0.85, roughness: 0.35 }));
    rail.rotation.x = Math.PI / 2; rail.position.set(sx, 1.1, -2); gBridge.add(rail);
  }
  // Posts under the deck handrails: the old rails were floating 30 m
  // cylinders with nothing under them, so from the deck they read as
  // continuous bars. Real bridge railings have posts.
  for (const sx of [-1.9, 1.9]) {
    for (let pz = -16; pz <= 12; pz += 2.5) {
      box(gBridge, 0.08, 1.1, 0.08, 0x8a9094, sx, 0.55, pz, null, { map: deckRailSteel, metalness: 0.85, roughness: 0.35 });
    }
  }
  // The 4 train crossing on a distant bridge, full of passengers, moving.
  // Shaped cars, not plain boxes: a roof, lit windows on both sides, a
  // belt stripe, and two bogies per car with visible round wheels and
  // hubs, so the train reads as a train on its track. The cars ride above
  // the railhead on the bogies, like a real train.
  trainMesh = new THREE.Group();
  const trainMetal = metalTex(2, 1, '#3d7a4e');
  for (let i = 0; i < 4; i++) {
    const cx = i * 3.4;
    const car = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 1.6), new THREE.MeshStandardMaterial({ map: trainMetal, roughness: 0.45, metalness: 0.25 }));
    car.position.set(cx, 0.55, 0); car.castShadow = true; trainMesh.add(car);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.18, 1.5), stdMat({ color: 0x8a9094, roughness: 0.5, metalness: 0.4 }));
    roof.position.set(cx, 1.32, 0); trainMesh.add(roof);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.02, 0.18, 1.62), stdMat({ color: 0xd8d8d8, roughness: 0.5, metalness: 0.2 }));
    stripe.position.set(cx, 0.75, 0); trainMesh.add(stripe);
    for (const wz of [0.85, -0.85]) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.6), new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffd166, emissiveIntensity: 0.8 }));
      win.position.set(cx, 0.75, wz);
      if (wz < 0) win.rotation.y = Math.PI;
      trainMesh.add(win);
    }
    // Two bogies per car, each with four visible wheels sitting on the rails.
    for (const bx of [cx - 0.9, cx + 0.9]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 1.3), stdMat({ color: 0x1a1a1a, roughness: 0.9 }));
      bogie.position.set(bx, -0.38, 0); trainMesh.add(bogie);
      for (const wx of [bx - 0.45, bx + 0.45]) for (const wz of [0.85, -0.85]) {
        const wh = makeWheel(0.32, 0.18, 'z');
        wh.position.set(wx, -0.35, wz); trainMesh.add(wh);
      }
    }
  }
  // Front cab on the leading car (car 3, +x end): a nose, a windshield
  // and headlights, so the train has a front.
  const cabNose = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 1.5), new THREE.MeshStandardMaterial({ map: trainMetal, roughness: 0.45, metalness: 0.25 }));
  cabNose.position.set(12.0, 0.55, 0); trainMesh.add(cabNose);
  const cabGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7), new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffd166, emissiveIntensity: 0.8 }));
  cabGlass.position.set(12.36, 0.8, 0); cabGlass.rotation.y = Math.PI / 2; trainMesh.add(cabGlass);
  for (const hz of [-0.5, 0.5]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.3), new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe9a0, emissiveIntensity: 1.5 }));
    hl.position.set(12.37, 0.3, hz); trainMesh.add(hl);
  }
  trainMesh.position.set(-30, 2.67, -30); trainMesh.name = 'train'; gBridge.add(trainMesh);
  // The train is solid: the track corridor it runs in.
  addBoxCollider(ch6Colliders, -45, -31.6, 45, -28.4);
  // The 4 train runs on a real track: a ballast deck, two steel rails and
  // sleepers, carried on pillars, so the moving train reads as a train on
  // a track and not a box floating over the river.
  box(gBridge, 90, 0.4, 3.2, 0x2a2f33, 0, 1.5, -30, null, { map: concreteTex(20, 1, '#2a2f33'), roughness: 0.95 });
  // One shared texture per repeated element: a fresh canvas per sleeper
  // would be ~64 canvases of 512x512 for the same dark wood.
  const trackRailSteel = steelTex(20, 1);
  for (const rz of [-30.75, -29.25]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(90, 0.1, 0.08), stdMat({ map: trackRailSteel, metalness: 0.9, roughness: 0.25 }));
    rail.position.set(0, 1.95, rz); gBridge.add(rail);
  }
  // Sleepers: light warm wood, wider and closer together, so the
  // separate ties read from the player's deck 30 m away. The round 3
  // ties were dark brown on a dark ballast deck and their 0.45x0.2 m
  // end faces vanished at that distance - the trackside view passed
  // but the deck view saw only continuous bars. Tie tops stay 1.90,
  // so the rails (tops 2.00) and the train do not move.
  const tieWood = woodTex(1, 1, '#8a6a42', '#5a3a22');
  for (let sx = -44; sx <= 44; sx += 1.0) box(gBridge, 0.6, 0.25, 2.6, 0x1a1a1a, sx, 1.775, -30, null, { map: tieWood, roughness: 1 });
  const pillarConcrete = concreteTex(1, 2);
  for (const px of [-30, -10, 10, 30]) box(gBridge, 0.8, 4, 0.8, 0x3a3f42, px, -0.5, -30, null, { map: pillarConcrete, roughness: 0.95 });
  // The click target rides WITH the train: the old static hit box sat at
  // x=0 while the train moved, so only the leading car was clickable when
  // it happened to pass x=0. Now the whole train is clickable anywhere.
  hitBox(trainMesh, 15, 3, 3, 5.1, 0, 0, 'train');
  // Title card: lighter panel (0.30, was 0.45) and lowered to y 4.2 so
  // the sun glow sits behind it from the deck - at y 6 the sightline
  // through the card passed above the glow, so even a translucent
  // panel read as opaque dark. The auto-fit in signTexture keeps the
  // full WILLIAMSBURG BRIDGE - DAWN on the card.
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('WILLIAMSBURG BRIDGE - DAWN', '#111111', '#ffd166', 'ONE MONTH LATER', 'rgba(0,0,0,0.30)'), transparent: true, depthWrite: false }));
  sign.scale.set(5, 1.25, 1); sign.position.set(0, 4.2, -14); gBridge.add(sign);
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
  // Dawn light: warm sun, soft sky. Brightened so the bridge, the deck
  // and the train actually read: the old levels (sun 1.4, ambient 0.55,
  // fog 0.008, background 0x2a1a2a) left the scene nearly black behind
  // the end card on the user's phone. Still dawn, not noon: warm tones,
  // soft shadows, the low sun glow stays.
  sun.intensity = 2.3; sun.color.set(0xffd9a0); ambient.intensity = 0.85; hemi.intensity = 0.75;
  scene.background = new THREE.Color(0x4a3040); scene.fog.density = 0.005;
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
  // Mission pay: finishing Act III earns $40,000 (once only).
  try { grantPayout('act3'); } catch (e) { /* economy is optional */ }
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

// Pause / resume for a home visit: freeze the render loop and input
// WITHOUT disposing the scene (stopAct() disposes it, so it is only for
// act transitions). The escape timer is stopped so it does not fire
// while the player is away; the escape itself is not a fail state.
export function pauseAct() {
  actActive = false;
  if (actRaf) { try { cancelAnimationFrame(actRaf); } catch (e) { /* ignore */ } actRaf = 0; }
  try { if (typeof stopEscapeTimer === 'function') stopEscapeTimer(); } catch (e) { /* ignore */ }
  try { document.getElementById('dialogue').classList.add('hidden'); } catch (e) { /* ignore */ }
}
export function resumeAct() {
  if (actActive) return;
  actActive = true;
  animate();
}

// Stop this act cleanly (the game is complete, but stopAct keeps the
// single-page lifecycle consistent and frees this act's scene): halt the
// animate loop and the escape timer, silence speech, hide any open
// dialogue, and dispose this act's scene (the shared renderer in core.js
// is never disposed).
export function stopAct() {
  actActive = false;
  dlgToken++; // a pending auto-advance must not fire after the act stops
  if (dlgTimer) { clearTimeout(dlgTimer); dlgTimer = null; }
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
  if (dragMoved > 10) { dragMoved = 0; return; }
  dragMoved = 0;
  if (Date.now() - lastTapAt < 400) return;
  lastTapAt = Date.now();
  handleTap(e.clientX, e.clientY);
});
canvas.addEventListener('pointerup', e => {
  // A drag must never become a tap: stamp lastTapAt when rejecting,
  // or the click that follows sees dragMoved reset and fires a
  // phantom tap at the release point (same fix as act2).
  if (dragMoved > 10) { dragMoved = 0; lastTapAt = Date.now(); return; }
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

// ---------- Wall colliders (see player.js) ----------
// Only three Act III obstacles sit inside the walkable bounds and are
// solid enough to block the player: the terminal desk in the Ch 1 control
// room, the police bus in the Ch 3 escape street and the podium in the
// Ch 5 press hall. Everything else is either beyond the view bounds (the
// Ch 1/2/4 back walls, the Ch 6 parapets), a click target the player must
// reach (the SUV, whose arrival trigger is a 1.5 m radius around its
// centre, and the fire escape), or a low rail the player steps over (the
// press crowd barrier, and the Ch 3 militant van, which drives away). The
// bus rear doorway is the one real doorway in Act III: it has a plug
// collider while the doors are shut, removed when they swing open.
let ch1Colliders = [];
let ch3Colliders = [];
let ch5Colliders = [];
let ch6Colliders = []; // the distant train track corridor: the player is
// bounded to the deck, so he can never reach it, but the train is solid
// in the collision system like every other vehicle.
function act3Colliders() {
  if (state.chapter === 1) return ch1Colliders;
  if (state.chapter === 3) {
    // On the rooftop the player is above the street: the street-level
    // van must not block him up there, so its live box is only included
    // while he is on the street.
    if (escapePhase === 2 && camY > 3) return ch3Colliders;
    return ch3Colliders.concat([vanCollider]);
  }
  if (state.chapter === 5) return ch5Colliders;
  if (state.chapter === 6) return ch6Colliders;
  return [];
}

// ---------- Animate ----------
document.getElementById('cinemaBtn').onclick = () => {
  document.getElementById('letterboxTop').classList.toggle('hidden');
  document.getElementById('letterboxBottom').classList.toggle('hidden');
};
function animate() {
  if (!actActive) return;
  actRaf = requestAnimationFrame(animate);
  // Heal any mesh left without morphTargetInfluences by a morph
  // push since the last frame, before rendering (see core.js).
  try { healMorphsIfDirty(scene); } catch (e) { /* healing is best effort */ }
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
    // In third-person the camera was left behind the avatar last frame;
    // put it back on the player before moving, or movement starts from
    // the wrong place.
    beginPlayerFrame(camera, camY);
    // Speed per second, not per frame: a fixed step per frame made
    // walking speed depend on the frame rate (3 m/s at 60 fps, 0.5 m/s
    // at 10 fps), so on a slow device the player crawls. dt is seconds,
    // so the 60 fps step (0.05) scales by dt * 60.
    const sp = 0.05 * dt * 60;
    const mv = moveDelta(keys, state.yaw, sp);
    const resolved = resolveMove(camera.position.x, camera.position.z, mv.dx, mv.dz, act3Colliders());
    camera.position.x = resolved.x; camera.position.z = resolved.z;
    camera.position.x = Math.max(camBounds.x[0], Math.min(camBounds.x[1], camera.position.x));
    camera.position.z = Math.max(camBounds.z[0], Math.min(camBounds.z[1], camera.position.z));
    // Rooftop crossing (phase 2): keep the player on the raised slab.
    // The slab spans x [-9,1], z [-10,-2]; without this the player walks
    // off the edge and wanders the street bounds in mid-air at camY 3.4,
    // with no way to tell where the roof ends. Inset by the player
    // radius (0.35) so the player stops at the edge. The fire-escape
    // trigger (1.5,-2) stays reachable: the clamped corner (0.65,-2.35)
    // is 0.92 m away, inside the 1.3 m trigger radius. Gated on camY
    // too, so Reset view (camY 2.4) still puts the player on the street.
    if (escapePhase === 2 && camY > 3) {
      camera.position.x = Math.max(-8.65, Math.min(0.65, camera.position.x));
      camera.position.z = Math.max(-9.65, Math.min(-2.35, camera.position.z));
    }
    camera.rotation.order = 'YXZ';
    const sway = document.getElementById('dialogue').classList.contains('hidden') ? 1 : 0.4;
    camera.rotation.y = state.yaw + Math.sin(t * 0.7) * 0.004 * sway;
    camera.rotation.x = state.pitch + Math.sin(t * 0.9 + 1.3) * 0.003 * sway;
    camera.position.y = camY + Math.sin(t * 0.8) * 0.012 * sway;
  }
  // The bus rear doors swing open when the player walks up to them
  // (chapter 3, before the escape starts), so he can step inside.
  if (state.chapter === 3 && state.escapeStep === 0 && !busDoorsOpen && dist2D(camera.position.x, camera.position.z, 0, -1) < 1.8) openBusDoors();
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
  // The single bus light is on only while the player is inside the
  // bus, and it flickers - the holding-area light Jade describes.
  if (state.chapter === 3 && busLight && busLightMesh) {
    const inBus = camera.position.x > -1.3 && camera.position.x < 1.3 && camera.position.z > -1 && camera.position.z < 5;
    busLight.visible = inBus;
    if (inBus) {
      const dip = Math.random() < 0.06 ? 0.25 : 1;
      busLight.intensity = 0.9 * dip + Math.sin(t * 13) * 0.05;
      busLightMesh.material.emissiveIntensity = 1.2 * dip;
    }
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
  // Third-person: show the player avatar and put the camera behind it.
  // Skipped during the bridge exterior shot, which has its own camera.
  if (!bridgeShot.active) {
    const mv2 = moveDelta(keys, state.yaw, 1);
    // Inside the police bus the camera shortens to 2 m and clamps to
    // the bus interior (the train does the same in its car), so the
    // player sees himself in the bus instead of the camera clipping
    // through the roof. Raised floors: on the rooftop (phase 2) the
    // slab top is 2.8, so the avatar stands on it instead of at y 0
    // under the slab.
    const inBus = state.chapter === 3 && escapePhase !== 2 && camera.position.x > -1.3 && camera.position.x < 1.3 && camera.position.z > -1 && camera.position.z < 5;
    applyPlayerPresence({ scene, camera, x: camera.position.x, z: camera.position.z, yaw: state.yaw, pitch: state.pitch, moving, moveDx: mv2.dx, moveDz: mv2.dz, dt, t, eyeY: inBus ? 1.6 : camY, groundY: (state.chapter === 3 && escapePhase === 2) ? 2.8 : 0, camBounds: inBus ? { x: [-1.0, 1.0], z: [-0.7, 4.7] } : undefined, camDist: inBus ? 2.0 : undefined });
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
