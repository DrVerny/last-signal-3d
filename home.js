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
import { getBalance, moneyFmt } from './economy.js';
import { makeCrowd, updatePedestrian } from './action.js';

let homeActive = false, homeRaf = 0, homeScene = null, homeCamera = null;
let homeKind = null, homeOnLeave = null;
let homeYaw = 0, homePitch = 0;
let homeBounds = { x: [-6, 6], z: [-4, 4] };
let homeStart = { x: 0, y: 1.7, z: 4, yaw: 0 };
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
// mission. A small overlay with her lines and a Continue button.
let callEl = null;
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
    document.getElementById('callNext').addEventListener('click', () => {
      callIdx++;
      if (callIdx >= callLines.length) {
        callEl.style.display = 'none';
        homeCallDone = true;
        showHomeBar(homeKind); // the "Go to the Train Terminal" button appears
        showHomeToast('Jade hung up. Go to the Train Terminal and board the 4 train.');
      } else {
        document.getElementById('callText').textContent = callLines[callIdx];
      }
    });
  } catch (e) { callEl = null; }
  return callEl;
}
function answerPhone() {
  if (homeCallDone) return;
  stopRinging();
  callLines = [
    'Jade here. The 4 train is losing power - the whole line is going dark and the passengers are stuck.',
    'I need you on that train. Get to the train terminal and board the 4. The relay is failing - you are the one who can fix it.',
    'I will talk you through it on the radio. Go - now.'
  ];
  callIdx = 0;
  const el = ensureCallOverlay();
  if (!el) { homeCallDone = true; showHomeBar(homeKind); return; }
  document.getElementById('callText').textContent = callLines[0];
  el.style.display = 'flex';
}

function mat(color, opts) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.9, metalness: 0.02 }, opts || {})); }
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
  saveHomeGame(homeKind);
  showHomeToast('You slept. Rested. Game saved.');
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
    + '<button id="homePickupBtn" type="button">Pick up the phone</button>'
    + '<button id="homeTerminalBtn" type="button">Go to the Train Terminal</button>'
    + '<button id="homeBoardBtn" type="button">Board the train</button>'
    + '<button id="homeSleepBtn" type="button">Sleep</button>'
    + '<button id="homeSaveBtn" type="button">Save game</button>'
    + '<button id="homeLeaveBtn" type="button">Leave</button>';
  document.body.appendChild(bar);
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
    carpark: 'CAR PARK'
  };
  const infos = {
    mansion: homePrologue && !homeCallDone ? 'Your phone is ringing - click the phone or Pick up. Drag to look, WASD to walk.' : homePrologue ? 'Jade called. Go to the Train Terminal and board the 4 train.' : 'Drag to look around - WASD to walk - click the bed to sleep.',
    safehouse: 'Drag to look around - WASD to walk - click the bed or table to save.',
    hospital: 'Drag to look around - WASD to walk - look around, then head back.',
    industry: 'Drag to look around - WASD to walk - look around, then head back.',
    terminal: homePrologue ? 'Walk through the concourse to the platform and board the 4 train. The train is at the far end.' : 'Drag to look around - WASD to walk - the 4 train is on the platform. Look around, then head back.',
    hotel: 'Drag to look around - WASD to walk - click the bed to sleep.',
    airport: 'Drag to look around - WASD to walk - look around, then head back.',
    carpark: 'Drag to look around - WASD to walk - rows of parked cars. Look around, then head back.'
  };
  document.getElementById('homeBarTitle').textContent = titles[kind] || kind;
  document.getElementById('homeBarInfo').textContent = infos[kind] || '';
  document.getElementById('homeSleepBtn').style.display = (kind === 'mansion' || kind === 'hotel') && !homePrologue ? '' : 'none';
  document.getElementById('homeSaveBtn').style.display = kind === 'safehouse' && !homePrologue ? '' : 'none';
  // Prologue buttons: Pick up (before the call), Go to the Terminal
  // (after the call, in the room), Board the train (in the terminal).
  document.getElementById('homePickupBtn').style.display = homePrologue && kind === 'mansion' && !homeCallDone ? '' : 'none';
  document.getElementById('homeTerminalBtn').style.display = homePrologue && kind === 'mansion' && homeCallDone ? '' : 'none';
  document.getElementById('homeBoardBtn').style.display = homePrologue && kind === 'terminal' ? '' : 'none';
  // In the prologue there is nowhere else to go: Leave is hidden until
  // the player is back in the acts (the map, or after boarding).
  document.getElementById('homeLeaveBtn').style.display = homePrologue ? 'none' : '';
  document.getElementById('homeBar').classList.remove('hidden');
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
function addWindow(scene, x, y, z, ry) {
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.4), new THREE.MeshStandardMaterial({ map: nightSkyTexture(), roughness: 0.2, metalness: 0.3 }));
  win.position.set(x, y, z); win.rotation.y = ry; scene.add(win);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.06), mat(0x2a2118));
  frame.position.set(x, y + 0.75, z); frame.rotation.y = ry; scene.add(frame);
  const frame2 = frame.clone(); frame2.position.y = y - 0.75; scene.add(frame2);
}
function addBed(scene, x, z, w, single) {
  const g = new THREE.Group(); scene.add(g);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, 3), mat(0x4a3220, { roughness: 0.7 }));
  frame.position.set(x, 0.2, z); frame.castShadow = true; g.add(frame);
  const matt = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.25, 2.8), mat(0xf2f0e8, { roughness: 0.9 }));
  matt.position.set(x, 0.5, z); matt.castShadow = true; matt.name = 'bed'; matt.userData.homeAction = 'bed'; homeTargets.push(matt); g.add(matt);
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.08, 1.7), mat(0x2e4a6b, { roughness: 0.9 }));
  blanket.position.set(x, 0.62, z + 0.5); g.add(blanket);
  const n = single ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const px = single ? x : x - 0.55 + i * 1.1;
    const pil = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.15, 0.5), mat(0xffffff, { roughness: 0.95 }));
    pil.position.set(px, 0.65, z - 1.1); pil.castShadow = true; g.add(pil);
  }
  hitBox(scene, w + 0.6, 1.6, 3.4, x, 0.8, z, 'bed');
  return g;
}
function addSofa(scene, x, z, w, color, name) {
  const g = new THREE.Group(); scene.add(g);
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, 1.2), mat(color, { roughness: 0.95 }));
  base.position.set(x, 0.35, z); base.castShadow = true; base.name = name || 'sofa'; base.userData.homeAction = name || 'sofa'; homeTargets.push(base); g.add(base);
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, 0.3), mat(color, { roughness: 0.95 }));
  back.position.set(x, 0.9, z - 0.55); back.castShadow = true; g.add(back);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 1.2), mat(color, { roughness: 0.95 }));
    arm.position.set(x + s * (w / 2 - 0.15), 0.6, z); arm.castShadow = true; g.add(arm);
  }
  const n = Math.max(2, Math.round(w / 1.1));
  for (let i = 0; i < n; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(w / n - 0.15, 0.18, 1.0), mat(0xd8cfc0, { roughness: 0.95 }));
    c.position.set(x - w / 2 + (i + 0.5) * (w / n), 0.68, z); c.castShadow = true; g.add(c);
  }
  hitBox(scene, w + 0.4, 1.6, 1.8, x, 0.8, z, name || 'sofa');
  return g;
}
function addTV(scene, x, y, z, w, name) {
  const g = new THREE.Group(); scene.add(g);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.5, 0.5), mat(0x2a2118, { roughness: 0.7 }));
  stand.position.set(x, 0.25, z + 0.2); stand.castShadow = true; g.add(stand);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, w * 0.56, 0.08), mat(0x111111, { roughness: 0.4 }));
  body.position.set(x, y, z); body.castShadow = true; body.name = name || 'tv'; body.userData.homeAction = name || 'tv'; homeTargets.push(body); g.add(body);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.15, w * 0.56 - 0.15), new THREE.MeshStandardMaterial({ map: tvTexture(), emissive: 0xffffff, emissiveMap: tvTexture(), emissiveIntensity: 0.7, roughness: 0.3 }));
  screen.position.set(x, y, z + 0.05); g.add(screen);
  hitBox(scene, w + 0.4, w * 0.56 + 0.4, 0.6, x, y, z, name || 'tv');
  lamp(scene, x, y + 1, z + 1.2, 0x9fd8ff, 0.4, 6);
  return g;
}
function addFloorLamp(scene, x, z) {
  hcyl(scene, 0.05, 0.07, 1.6, 0x2a2a2a, x, 0.8, z, null, { metalness: 0.6, roughness: 0.4 });
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.4, 12, 1, true), mat(0xffd166, { roughness: 0.8, side: THREE.DoubleSide }));
  shade.position.set(x, 1.75, z); scene.add(shade);
  lamp(scene, x, 1.7, z, 0xffe0b0, 0.9, 9);
}
function addDiningTable(scene, x, z) {
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 1.4), mat(0x4a3220, { roughness: 0.6 }));
  top.position.set(x, 0.75, z); top.castShadow = true; scene.add(top);
  for (const [dx, dz] of [[-1.1, -0.6], [1.1, -0.6], [-1.1, 0.6], [1.1, 0.6]]) {
    hcyl(scene, 0.05, 0.05, 0.75, 0x2a2118, x + dx, 0.37, z + dz, null, { roughness: 0.6 });
  }
  for (const [dx, dz, ry] of [[-1.6, 0, Math.PI / 2], [1.6, 0, -Math.PI / 2], [0, -1.1, 0], [0, 1.1, Math.PI]]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), mat(0x6b4226, { roughness: 0.7 }));
    seat.position.set(x + dx, 0.45, z + dz); seat.castShadow = true; scene.add(seat);
    const bk = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.08), mat(0x6b4226, { roughness: 0.7 }));
    bk.position.set(x + dx * 1.15, 0.8, z + dz * 1.15); bk.rotation.y = ry; scene.add(bk);
  }
}
function addKitchen(scene, x, z, len) {
  hbox(scene, 0.7, 0.9, len, 0x8a8a82, x, 0.45, z, null, { roughness: 0.6 });
  hbox(scene, 0.5, 0.8, len - 0.6, 0x6a5a44, x - 0.1, 2.0, z, null, { roughness: 0.7 });
  hbox(scene, 0.9, 2.0, 0.9, 0xd8d8d8, x, 1.0, z - len / 2 - 0.7, null, { metalness: 0.5, roughness: 0.3 });
}

function buildMansion(scene) {
  // A large furnished room: 14 wide, 10 deep. Bed at the north end, living
  // area with a big TV and a soft couch, dining table, kitchen, bookshelf.
  roomShell(scene, 14, 10, 3.4, 0x6b4a2f, 0xc9b8a0);
  const rug = new THREE.Mesh(new THREE.BoxGeometry(5, 0.04, 3.5), mat(0x7a2a2a, { roughness: 1 }));
  rug.position.set(0, 0.12, -1); rug.receiveShadow = true; scene.add(rug);
  addBed(scene, -4.5, -3.2, 2.4, false);
  addSofa(scene, 0, -0.6, 3.2, 0x4a7c7a, 'sofa');
  addTV(scene, 0, 1.7, -4.85, 2.6, 'tv');
  addDiningTable(scene, 3.8, 3.2);
  addKitchen(scene, 6.5, 1, 4);
  // Bookshelf on the west wall.
  hbox(scene, 0.4, 2.4, 2.2, 0x4a3220, -6.7, 1.2, 2, null, { roughness: 0.7 });
  for (let s = 0; s < 3; s++) {
    for (let b = 0; b < 6; b++) {
      const bc = [0xc0392b, 0x2e6fb0, 0x7ac74f, 0xffd166, 0x8a5a9a, 0xd8d8d8][(s * 6 + b) % 6];
      hbox(scene, 0.3, 0.45, 0.25, bc, -6.7, 0.45 + s * 0.7, 1.2 + b * 0.3, null, { roughness: 0.8 });
    }
  }
  addWindow(scene, -6.9, 1.9, -1.5, Math.PI / 2);
  addWindow(scene, 6.9, 1.9, -2.5, -Math.PI / 2);
  addFloorLamp(scene, -6, -4);
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
  // The ringing phone (prologue only): on a side table by the bed, with
  // a pulsing gold glow and a "PHONE RINGING" sign, so a first-time
  // player cannot miss it. Clicking it (or Pick up) starts the call.
  if (homePrologue && !homeCallDone) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.5), mat(0x4a3220, { roughness: 0.7 }));
    side.position.set(-2.8, 0.3, -3.2); side.castShadow = true; scene.add(side);
    const phone = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.32), mat(0x111111, { roughness: 0.3, metalness: 0.5 }));
    phone.position.set(-2.8, 0.62, -3.2); phone.name = 'phone'; phone.userData.homeAction = 'phone'; homeTargets.push(phone); scene.add(phone);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.26), new THREE.MeshBasicMaterial({ color: 0x7ac74f }));
    scr.rotation.x = -Math.PI / 2; scr.position.set(-2.8, 0.64, -3.2); scene.add(scr);
    phoneGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd166, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    phoneGlow.scale.set(1.6, 1.6, 1); phoneGlow.position.set(-2.8, 0.9, -3.2); scene.add(phoneGlow);
    const ring = textSprite('PHONE RINGING', '#2a2118', '#ffd166', 'Click the phone or Pick up');
    ring.scale.set(3.0, 0.75, 1); ring.position.set(-2.8, 1.6, -3.2); scene.add(ring);
    startRinging();
  }
}

function buildSafehouse(scene) {
  // A smaller furnished apartment: 8 wide, 6 deep. Bed, small sofa, TV,
  // a table, a lamp, a kitchenette, one window. This is the safe house.
  roomShell(scene, 8, 6, 3.0, 0x5a4632, 0xbfb09a);
  const rug = new THREE.Mesh(new THREE.BoxGeometry(3, 0.04, 2.2), mat(0x4a5a7a, { roughness: 1 }));
  rug.position.set(0.5, 0.12, -0.5); rug.receiveShadow = true; scene.add(rug);
  addBed(scene, -2.4, -1.4, 1.6, true);
  addSofa(scene, 1.6, -1.4, 2.0, 0x6a6a72, 'sofa');
  addTV(scene, 0.2, 1.4, -2.85, 1.6, 'tv');
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
  addKitchen(scene, 3.6, 0.5, 2.4);
  addWindow(scene, 3.9, 1.8, -1, -Math.PI / 2);
  addFloorLamp(scene, -3.2, 2);
  lamp(scene, 0, 2.5, 0, 0xffe0b0, 0.6, 10);
  const sign = textSprite('SAFE HOUSE', '#2a2118', '#7ac74f', 'Nobody knows this place');
  sign.scale.set(3.0, 0.75, 1); sign.position.set(0, 2.6, -2.8); scene.add(sign);
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
  const g = new THREE.Group(); scene.add(g);
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 1.1), mat(color, { roughness: 0.4, metalness: 0.5 }));
  body.position.y = 0.45; body.castShadow = true; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.0), mat(0x18242e, { roughness: 0.2, metalness: 0.6 }));
  cabin.position.set(-0.15, 0.95, 0); g.add(cabin);
  for (const [wx, wz] of [[-0.75, 0.55], [0.75, 0.55], [-0.75, -0.55], [0.75, -0.55]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.18, 12), mat(0x111111, { roughness: 0.9 }));
    w.rotation.x = Math.PI / 2; w.position.set(wx, 0.28, wz); g.add(w);
  }
  g.position.set(x, 0, z); g.rotation.y = ry || 0;
  return g;
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
}
function buildHotel(scene) {
  // A hotel suite: 10 wide, 7 deep. A double bed, a sofa, a big TV, a
  // desk with a chair, a window with a city view, a minibar. The bed
  // sleeps (and saves), like the mansion.
  roomShell(scene, 10, 7, 3.2, 0x5a4632, 0xd8cfc0);
  const rug = new THREE.Mesh(new THREE.BoxGeometry(4, 0.04, 2.6), mat(0x2e4a6b, { roughness: 1 }));
  rug.position.set(0, 0.12, -0.5); rug.receiveShadow = true; scene.add(rug);
  addBed(scene, -2.8, -1.8, 2.2, false);
  addSofa(scene, 1.8, -1.8, 2.4, 0x7a2e2e, 'sofa');
  addTV(scene, 0, 1.6, -3.35, 2.0, 'tv');
  // A desk with a chair, and a minibar fridge.
  hbox(scene, 1.8, 0.08, 0.9, 0x4a3220, 3.6, 0.75, 1.6, null, { roughness: 0.6 });
  for (const [dx, dz] of [[-0.8, -0.35], [0.8, -0.35], [-0.8, 0.35], [0.8, 0.35]]) {
    hcyl(scene, 0.04, 0.04, 0.75, 0x2a2118, 3.6 + dx, 0.37, 1.6 + dz, null, { roughness: 0.6 });
  }
  const chair = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), mat(0x6b4226, { roughness: 0.7 }));
  chair.position.set(3.6, 0.45, 2.6); scene.add(chair);
  hbox(scene, 0.7, 1.1, 0.6, 0xd8d8d8, -4.4, 0.55, 2.6, null, { metalness: 0.5, roughness: 0.3 });
  addWindow(scene, 4.9, 1.8, -1, -Math.PI / 2);
  addFloorLamp(scene, -4, 2);
  lamp(scene, 0, 2.6, 0, 0xffe0b0, 0.7, 10);
  const sign = textSprite('HOTEL - YOUR SUITE', '#2a2118', '#ffd166', 'Room 412 - sleep here');
  sign.scale.set(3.4, 0.85, 1); sign.position.set(0, 2.7, -3.3); scene.add(sign);
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
  const sign = textSprite('CAR PARK', '#2a2118', '#ffd166', 'Parking - $2 an hour');
  sign.scale.set(5, 1.25, 1); sign.position.set(0, 5, -12); scene.add(sign);
}

// ---------- Place engine ----------
function baseLights(scene, day) {
  scene.add(new THREE.AmbientLight(0xbfc8d4, day ? 0.55 : 0.5));
  const hemi = new THREE.HemisphereLight(0x9db8d4, 0x2a2418, day ? 0.5 : 0.4); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d8, day ? 1.4 : 1.0);
  sun.position.set(12, 20, 8); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); scene.add(sun);
  return { hemi, sun };
}
export function enterPlace(kind, onLeave, options) {
  if (homeActive) leavePlace();
  const opts = options || {};
  homePrologue = !!opts.prologue;
  if (homePrologue && kind === 'mansion') homeCallDone = false; // a fresh prologue: the phone has not been answered yet
  if (opts.onBoardTrain) prologueOnBoardTrain = opts.onBoardTrain;
  homeKind = kind; homeOnLeave = onLeave || null;
  homeScene = new THREE.Scene();
  homeTargets = [];
  terminalPedestrians = [];
  const isRoom = kind === 'mansion' || kind === 'safehouse' || kind === 'terminal' || kind === 'hotel';
  if (isRoom) {
    homeScene.background = new THREE.Color(0x0a0d10);
    homeScene.fog = new THREE.FogExp2(0x0a0d10, 0.02);
  }
  baseLights(homeScene, !isRoom);
  if (kind === 'mansion') { buildMansion(homeScene); homeBounds = { x: [-6.4, 6.4], z: [-4.4, 4.4] }; homeStart = { x: 0, y: 1.7, z: 4, yaw: 0 }; }
  else if (kind === 'safehouse') { buildSafehouse(homeScene); homeBounds = { x: [-3.4, 3.4], z: [-2.4, 2.4] }; homeStart = { x: 0, y: 1.7, z: 2, yaw: 0 }; }
  else if (kind === 'hospital') { buildHospital(homeScene); homeBounds = { x: [-16, 16], z: [-14, 18] }; homeStart = { x: 0, y: 1.7, z: 14, yaw: 0 }; }
  else if (kind === 'industry') { buildIndustry(homeScene); homeBounds = { x: [-16, 16], z: [-12, 16] }; homeStart = { x: 0, y: 1.7, z: 12, yaw: 0 }; }
  else if (kind === 'terminal') { buildTerminal(homeScene); homeBounds = { x: [-11, 11], z: [-9.5, 14] }; homeStart = { x: 0, y: 1.7, z: 12, yaw: 0 }; }
  else if (kind === 'hotel') { buildHotel(homeScene); homeBounds = { x: [-4.4, 4.4], z: [-2.9, 2.9] }; homeStart = { x: 0, y: 1.7, z: 2.5, yaw: 0 }; }
  else if (kind === 'airport') { buildAirport(homeScene); homeBounds = { x: [-20, 20], z: [-16, 20] }; homeStart = { x: 0, y: 1.7, z: 14, yaw: 0 }; }
  else if (kind === 'carpark') { buildCarpark(homeScene); homeBounds = { x: [-18, 18], z: [-14, 18] }; homeStart = { x: 0, y: 1.7, z: 14, yaw: 0 }; }
  else return;
  homeCamera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 300);
  homeCamera.position.set(homeStart.x, homeStart.y, homeStart.z);
  homeYaw = homeStart.yaw; homePitch = 0;
  showHomeBar(kind);
  homeActive = true;
  window.__lsHomeActive = true;
  const welcomes = {
    mansion: homePrologue ? 'Your phone is ringing. Pick it up - Jade is calling.' : 'The Mansion - home. The couch, the big TV, your bed. Click the bed to sleep.',
    safehouse: 'Safe House Apartment - nobody knows this place. Click the bed or the table to save.',
    hospital: 'City Hospital - the tall white tower. Look around, then head back to the map.',
    industry: 'Industrial Area - the water treatment plant. Look around, then head back to the map.',
    terminal: homePrologue ? 'Grand Central. Walk through the concourse to Platform 4 and board the 4 train.' : 'Train Terminal - Grand Central. The 4 train is on Platform 4. Look around, then head back to the map.',
    hotel: 'Hotel - your suite. Click the bed to sleep.',
    airport: 'Airport - JFK Terminal 4. Look around, then head back to the map.',
    carpark: 'Car Park - rows of parked cars. Look around, then head back to the map.'
  };
  showHomeToast(welcomes[kind] || kind);
  if (homeRaf) cancelAnimationFrame(homeRaf);
  homeRaf = requestAnimationFrame(homeAnimate);
}
export function leavePlace() {
  if (!homeActive) return;
  stopRinging();
  homeActive = false;
  window.__lsHomeActive = false;
  if (homeRaf) { try { cancelAnimationFrame(homeRaf); } catch (e) { /* ignore */ } homeRaf = 0; }
  try { disposeScene(homeScene); } catch (e) { /* ignore */ }
  homeScene = null; homeCamera = null; homeTargets = [];
  phoneGlow = null; terminalPedestrians = [];
  const bar = document.getElementById('homeBar');
  if (bar) bar.classList.add('hidden');
  const cb = homeOnLeave; homeOnLeave = null;
  if (cb) cb();
}
function homeAnimate() {
  if (!homeActive) return;
  homeRaf = requestAnimationFrame(homeAnimate);
  const sp = 0.07;
  if (homeKeys['w']) homeCamera.position.z -= sp;
  if (homeKeys['s']) homeCamera.position.z += sp;
  if (homeKeys['a']) homeCamera.position.x -= sp;
  if (homeKeys['d']) homeCamera.position.x += sp;
  homeCamera.position.x = Math.max(homeBounds.x[0], Math.min(homeBounds.x[1], homeCamera.position.x));
  homeCamera.position.z = Math.max(homeBounds.z[0], Math.min(homeBounds.z[1], homeCamera.position.z));
  const moving = homeKeys['w'] || homeKeys['a'] || homeKeys['s'] || homeKeys['d'];
  const t = Date.now() / 1000;
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
  // People cross the terminal concourse, going to work.
  if (homeKind === 'terminal') {
    const dt = 1 / 60;
    for (const p of terminalPedestrians) updatePedestrian(p, dt);
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
  const action = hits[0].object.userData.homeAction || hits[0].object.name;
  if (action === 'phone') {
    answerPhone();
  } else if (action === 'boardTrain') {
    boardTrain();
  } else if (action === 'bed') {
    if (homeKind === 'mansion' || homeKind === 'hotel') doSleep();
    else if (homeKind === 'safehouse') doSave();
    else showHomeToast('A bed. Not yours to sleep in here.');
  } else if (action === 'save') doSave();
  else if (action === 'tv') showHomeToast('The TV is on - the news is all about the grid and the water.');
  else if (action === 'sofa') showHomeToast('Soft. You could nap here - but the city needs you.');
  else if (action === 'info') showHomeToast(homeKind === 'hospital' ? 'City Hospital - the tower from the photo. Emergency is open 24 hours.' : 'Water treatment plant - the industrial line feeds this place.');
}
// Input: registered once, guarded by homeActive so the acts never fight it.
canvas.addEventListener('pointerdown', (e) => {
  if (!homeActive) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  homeDragging = true; homeDragMoved = 0; homeLx = e.clientX; homeLy = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fallback */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (!homeActive || !homeDragging) return;
  const dx = e.clientX - homeLx, dy = e.clientY - homeLy;
  homeDragMoved += Math.abs(dx) + Math.abs(dy);
  homeYaw -= dx * 0.0012; homePitch -= dy * 0.0012;
  if (homeYaw > Math.PI) homeYaw -= Math.PI * 2;
  if (homeYaw < -Math.PI) homeYaw += Math.PI * 2;
  homePitch = Math.max(-1.5, Math.min(1.5, homePitch));
  homeLx = e.clientX; homeLy = e.clientY;
});
function homeEndDrag() { homeDragging = false; }
canvas.addEventListener('pointerup', homeEndDrag);
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
