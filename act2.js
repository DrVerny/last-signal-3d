import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
// THE LAST SIGNAL - Act II: City of Wires - 3D prototype
// Three missions from the script (short original dialogue in its spirit;
// no long verbatim copying): 1. The Delaware Line (Rondout Reservoir),
// 2. The Grid (Con Edison substation), 3. The Verrazzano (bridge, night).
// Trust, System Integrity and the Act I sealed choice carry over from
// localStorage (saved by Act I); defaults apply when played standalone.
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
function gaugeTexture(label) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#10141a'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(128, 140, 90, Math.PI * 0.85, Math.PI * 2.15); ctx.stroke();
    ctx.fillStyle = '#ffd166'; ctx.font = 'bold 24px Arial'; ctx.textAlign = 'center'; ctx.fillText(label, 128, 220);
    ctx.textAlign = 'left';
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
function resetView() {
  const v = VIEWS[state.mission];
  camera.position.set(v.pos[0], v.pos[1], v.pos[2]);
  state.yaw = v.yaw; state.pitch = 0; camBounds = v;
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

// ---------- Characters (shared across missions) ----------
const humans = []; // {group, name, baseScale, phase}
const humanGroups = [];
const modelGroups = {};
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
    }
  }
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
  box(mission1, 1.2, 2.2, 0.15, 0x2a2118, 0, 1.1, -0.68, 'stationDoor');
  for (const wx of [-3, 3]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1), new THREE.MeshStandardMaterial({ color: 0x0e1a24, roughness: 0.1, metalness: 0.4 }));
    win.position.set(wx, 2, -0.72); mission1.add(win);
  }
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('RONDOUT RESERVOIR', '#2a2118', '#ffd166', 'CONTROL STATION'), transparent: true, depthWrite: false }));
  sign.scale.set(5, 1.25, 1); sign.position.set(0, 4.6, -3.2); mission1.add(sign);
  // Three valve assemblies on a concrete plinth, in front of the station.
  const plinth = box(mission1, 10, 0.25, 2, 0x8a8a82, 0, 0.12, 2.5);
  plinth.receiveShadow = true;
  const valveDefs = [
    { key: 'hospital', label: 'HOSPITAL', color: 0x7ac74f, x: -3 },
    { key: 'residential', label: 'RESIDENTIAL', color: 0x4cc9f0, x: 0 },
    { key: 'industrial', label: 'INDUSTRIAL', color: 0xffd166, x: 3 }
  ];
  window._valveMeshes = {};
  for (const v of valveDefs) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.6, 12), stdMat({ color: 0x6a747a, metalness: 0.8, roughness: 0.35 }));
    pipe.rotation.z = Math.PI / 2; pipe.position.set(v.x, 0.55, 2.5); pipe.castShadow = true; mission1.add(pipe);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 10, 24), new THREE.MeshStandardMaterial({ color: v.color, emissive: v.color, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.3 }));
    wheel.position.set(v.x, 1.25, 2.5); wheel.castShadow = true;
    wheel.name = 'valve' + v.key[0].toUpperCase() + v.key.slice(1); wheel.userData.clickable = true; mission1.add(wheel);
    window._valveMeshes[v.key] = wheel;
    // Generous invisible click target around the whole valve assembly: the
    // torus is a thin ring with an empty hub, so a click dead-centre on the
    // wheel (the obvious place to click) would otherwise miss it entirely.
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.6, 1.2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.position.set(v.x, 1.4, 2.5); hit.name = wheel.name; hit.userData.clickable = true; mission1.add(hit);
    window._valveMeshes[v.key + 'Hit'] = hit;
    for (let s = 0; s < 3; s++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.8, 0.05), stdMat({ color: v.color, roughness: 0.5 }));
      spoke.position.copy(wheel.position); spoke.rotation.z = s * Math.PI / 3; mission1.add(spoke);
    }
    const gauge = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ map: gaugeTexture(v.label), roughness: 0.6 }));
    gauge.position.set(v.x, 2.3, 2.2); mission1.add(gauge);
    const lbl = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(v.label, '#111111', '#e8e8e8', ''), transparent: true, depthWrite: false }));
    lbl.scale.set(2.2, 0.55, 1); lbl.position.set(v.x, 3.1, 2.5); mission1.add(lbl);
  }
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
    renderValve();
  }, 5000);
}
document.querySelectorAll('#valveModal button[data-line]').forEach(b => {
  b.onclick = () => {
    const k = b.dataset.line, d = parseInt(b.dataset.d, 10);
    pressures[k] = Math.max(20, Math.min(100, pressures[k] + d));
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
  if (!valveOpen || state.waterStable) return;
  if (Object.values(pressures).every(p => p >= 70)) {
    stableHold++;
    renderValve();
    if (stableHold >= 3) {
      state.waterStable = true; valveOpen = false;
      if (valveTimer) { clearInterval(valveTimer); valveTimer = null; }
      document.getElementById('valveModal').classList.add('hidden');
      integrity('Water', 10);
      setObjectives(OBJ1, 2);
      window._device1.visible = true; window._device1Hit.visible = true;
      toast('Pressure holding - the aqueduct is stable. Something on the station wall catches your eye.');
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
  ], () => { setObjectives(OBJ1, 3); toast('Click the small green circuit board on the station wall.'); });
}
function startMission1() {
  resetView();
  setObjectives(OBJ1, 0); updateHUD();
  document.getElementById('timerLabel').textContent = 'Water pressure';
  document.getElementById('timerVal').textContent = 'dropping 2%/hr';
  document.getElementById('timerBar').style.width = '80%';
  showDialogue([
    { who: 'Jade Morales', text: 'Next morning, 6 AM. The Delaware Aqueduct - eighty-five miles, half the city\u2019s water. Pressure is dropping two percent an hour. Thirty-six hours and the taps run dry.' },
    { who: 'Caleb Bishop', text: 'And this Derrick Shaw - he used to work for the city?' },
    { who: 'Jade Morales', text: 'Deputy Director of City Planning, twenty years. He wrote the vulnerability report in 2019. The one they ignored. He was my mentor, once.' },
    { who: 'Caleb Bishop', text: 'So he is not just some lunatic.' },
    { who: 'Jade Morales', text: 'No. He watched the system fail and decided the only way to fix it was to break it. I agree with his diagnosis. Not his prescription.' }
  ], () => {
    setObjectives(OBJ1, 1);
    toast('Click a valve wheel to open the pressure controls - balance all three lines to 70% or more.');
  });
}

// ---------- Mission 2: The Grid (Con Edison substation) ----------
let keycardMesh, logbookMesh, scadaMesh, manifestoMesh, bombInterval = null, bombTime = 90;
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
  reparentCast('jade', mission2, -1.6, 5.5, Math.PI);
  reparentCast('caleb', mission2, 1.6, 5.5, Math.PI);
  setObjectives(OBJ2, 0); updateHUD();
  document.getElementById('timerLabel').textContent = 'Logic bomb - trips 8:00 PM';
  document.getElementById('timerVal').textContent = 'armed';
  document.getElementById('timerBar').style.width = '100%';
  showDialogue([
    { who: 'Jade Morales', text: 'Two PM. Con Edison substation, Long Island City. A logic bomb is sitting in the SCADA system. At eight it cascades - one substation trips, overloads the next, and takes down the Northeast grid.' },
    { who: 'Caleb Bishop', text: 'And the guards are not his people. Private security, hired through a shell company. They do not know what they are protecting.' },
    { who: 'Jade Morales', text: 'So we do not fight them. You walk up as a city inspector. I feed you the jargon through your earpiece. Click a guard to start.' }
  ], () => { toast('Click a guard - Caleb talks his way in.'); });
}
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
      guardsDown = true; keycardMesh.visible = true; if (window._keycardHit) window._keycardHit.visible = true; trust(1, 'Caleb talked them down');
      setObjectives(OBJ2, 1);
      toast('The guards stood down. Click the white key card on the guard\u2019s belt, then the red log book on the desk.');
    });
  } else {
    showDialogue([
      { who: 'Caleb Bishop', text: 'City inspector - I need to see the terminal.' },
      { who: 'Guard 1', text: 'Credentials? Work order number? You do not sound like an inspector.' },
      { who: 'Jade Morales', text: 'He is not ready for this. Plan B - I slip in through the side gate while they are watching him. It is slower, and it costs us goodwill.' }
    ], () => {
      guardsDown = true; keycardMesh.visible = true; if (window._keycardHit) window._keycardHit.visible = true; trust(-1, 'the bluff failed'); integrity('Power', -5);
      setObjectives(OBJ2, 1);
      toast('Jade slipped in through the side gate. Click the white key card, then the red log book.');
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
  document.getElementById('scadaModal').classList.remove('hidden');
  renderScada();
  if (bombInterval) clearInterval(bombInterval);
  bombInterval = setInterval(() => {
    bombTime--;
    renderScada();
    document.getElementById('timerVal').textContent = bombTime + 's to cascade';
    document.getElementById('timerBar').style.width = (bombTime / 90 * 100) + '%';
    if (bombTime <= 0) {
      clearInterval(bombInterval); bombInterval = null;
      document.getElementById('scadaModal').classList.add('hidden');
      bombGoesOff();
    }
  }, 1000);
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
  toast('The bomb is still counting down in the terminal. Open it again to finish the job.');
};
function bombGoesOff() {
  integrity('Power', -25); integrity('Comms', -10);
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
}
function startMission3() {
  mission1.visible = false; mission2.visible = false; mission3.visible = true;
  state.mission = 3; state.climbStep = 0; resetView();
  reparentCast('jade', mission3, 0.4, 8, Math.PI);
  reparentCast('caleb', mission3, 1.2, 9, Math.PI);
  // Night lighting: the sun goes down, the moon takes over.
  sun.intensity = 0.08; moon.intensity = 0.9; ambient.intensity = 0.12; hemi.intensity = 0.15;
  scene.background = new THREE.Color(0x05070a); scene.fog.density = 0.012;
  setObjectives(OBJ3, 0); updateHUD();
  document.getElementById('timerLabel').textContent = 'Detonator - 48 hr demand';
  document.getElementById('timerVal').textContent = 'live-streaming';
  document.getElementById('timerBar').style.width = '100%';
  showDialogue([
    { who: 'Jade Morales', text: 'Eleven-thirty PM. Verrazzano-Narrows Bridge, upper deck. Derrick Shaw is up there with four shaped charges on the main cables - not enough to drop the bridge, enough to close it for months.' },
    { who: 'Caleb Bishop', text: 'And he is live-streaming. Full public audit of all city infrastructure in forty-eight hours, or he detonates.' },
    { who: 'Jade Morales', text: 'My dad welded this bridge. We climb the maintenance catwalk. Click the catwalk planks to climb - and mind the gap.' }
  ], () => { toast('Click the catwalk planks to climb toward the upper deck.'); });
}
function climbStep() {
  if (state.climbStep >= 3) { gapChoice(); return; }
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
  showDialogue([
    { who: 'Caleb Bishop', text: 'That is not there. That is not a catwalk. That is a - a thing that is not there. I cannot move.' },
    { who: 'Jade Morales', text: 'Caleb. Look at me. When I was a kid, my dad took me up here. I was terrified. And he said: "Jade, the bridge does not care if you are scared. It is going to hold you anyway. That is what it is for."', choices: [
      { label: '\u201CBridges are trust you can see. I trust you.\u201D (Trust +2)', effect: () => { trust(2, 'you trusted Caleb at the gap'); state.bridgePath = 'best'; } },
      { label: '\u201CYou do not have to do this. Go back.\u201D (Caleb retreats)', effect: () => { trust(1, 'you let him choose'); state.bridgePath = 'solo'; integrity('Power', -5); } },
      { label: '\u201CMove, Bishop. Now.\u201D (Trust -1)', effect: () => { trust(-1, 'you ordered him across'); state.bridgePath = 'strained'; } }
    ] },
    { who: 'Caleb Bishop', text: 'You know what you said? About bridges being trust you can see? ... I see you.' }
  ], () => {
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
  const el = document.getElementById('endCard');
  el.classList.remove('hidden');
  const pathText = { best: 'Caleb crossed the gap with you - the best-ending path is open.', solo: 'Caleb stayed behind - Jade faced Derrick alone.', strained: 'Caleb crossed, but the trust is strained.', undecided: '' }[state.bridgePath];
  document.getElementById('endSummary').innerHTML =
    `<p>Act II complete - the aqueduct holds, the substation ${state.bombDisarmed ? 'bomb is disarmed' : 'suffered a partial blackout'}, and Derrick Shaw put down the detonator on the Verrazzano.</p>` +
    `<p><strong>Water choice:</strong> ${state.waterChoice || 'none'} line got full pressure. <strong>Bridge:</strong> ${pathText}</p>` +
    `<p><strong>Evidence:</strong> ${state.evidence.length ? state.evidence.join(' · ') : 'none yet'}</p>` +
    `<p>Trust: ${state.trust} / 10 &nbsp;•&nbsp; System Integrity - Transit ${state.integrity.Transit}, Water ${state.integrity.Water}, Power ${state.integrity.Power}, Comms ${state.integrity.Comms}</p>` +
    `<p>Next: Act III - The Human Signal (courtroom, ambush, press conference). Press "Begin Act III" below to continue.</p>`;
}

// ---------- Click to inspect ----------
// Debug hook for live testing: window.__ls2.state / .interact / .openValveModal.
window.__ls2 = { state, interact, openValveModal, openScadaModal };
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
  if (state.mission === 1) targets.push(...Object.values(window._valveMeshes || {}), window._device1, window._device1Hit);
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
  if (dragMoved > 6) { dragMoved = 0; return; }
  dragMoved = 0;
  if (Date.now() - lastTapAt < 400) return; // already handled by pointerup
  lastTapAt = Date.now();
  handleTap(e.clientX, e.clientY);
});
// Pointerup fallback: some harnesses and touch inputs deliver press/release
// without a click event on the canvas. A tap (not a drag) is a click here.
canvas.addEventListener('pointerup', e => {
  if (dragMoved > 6) { dragMoved = 0; return; }
  dragMoved = 0;
  if (Date.now() - lastTapAt < 400) return;
  lastTapAt = Date.now();
  handleTap(e.clientX, e.clientY);
});
function interact(name) {
  if (!name) return;
  if (name === 'valveHospital' || name === 'valveResidential' || name === 'valveIndustrial') { openValveModal(); return; }
  if (name === 'digitalPanel') { toast('Digital control - sabotaged. It overcorrects every valve you set. The physical valves still work.'); return; }
  if (name === 'stationDoor') { toast('Control station - analog valves and digital monitors inside. The valves are outside, on the plinth.'); return; }
  if (name === 'device1' && window._device1.visible) {
    state.inventory.push('RESET device (aqueduct)'); state.evidence.push('RESET device + fingerprint: Derrick Shaw');
    updateHUD(); setObjectives(OBJ1, 4);
    showDialogue([
      { who: 'Jade Morales', text: 'Same label. RESET. Same hand-soldered board, same MTA capacitors. And a partial fingerprint on the casing.' },
      { who: 'Caleb Bishop', text: 'Running it now... Derrick Shaw. Former Deputy Director of City Planning. The Architect has a name.' },
      { who: 'Jade Morales', text: 'He was my mentor. And he is waiting for someone to prove him wrong. Next: the substation. The grid is next.' }
    ], () => startMission2());
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
  if (name === 'controlDoor') { toast('Control room - the SCADA terminal is on the desk outside. The manifesto is pinned inside, on the wall.'); return; }
  if (name === 'manifesto' && manifestoMesh.visible) {
    state.evidence.push('Manifesto addressed to Jade');
    showDialogue([
      { who: 'Jade Morales', text: '"You saw the cracks. You spoke. No one listened. So I will make them listen. - D.S." It is addressed to me, by name.' },
      { who: 'Caleb Bishop', text: 'He is not hiding. He is waiting. The bridge is next - the Verrazzano, tonight.' },
      { who: 'Jade Morales', text: 'Then we go to the bridge.' }
    ], () => startMission3());
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
  requestAnimationFrame(animate);
  const t = Date.now() / 1000;
  const sp = 0.05;
  if (keys['w']) camera.position.z -= sp; if (keys['s']) camera.position.z += sp;
  if (keys['a']) camera.position.x -= sp; if (keys['d']) camera.position.x += sp;
  camera.position.x = Math.max(camBounds.x[0], Math.min(camBounds.x[1], camera.position.x));
  camera.position.z = Math.max(camBounds.z[0], Math.min(camBounds.z[1], camera.position.z));
  camera.rotation.order = 'YXZ';
  const sway = document.getElementById('dialogue').classList.contains('hidden') ? 1 : 0.4;
  const wind = state.mission === 3 ? 0.02 : 0.004; // the bridge sways in the wind
  camera.rotation.y = state.yaw + Math.sin(t * 0.7) * 0.004 * sway;
  camera.rotation.x = state.pitch + Math.sin(t * 0.9 + 1.3) * 0.003 * sway;
  camera.rotation.z = Math.sin(t * 0.5) * wind * sway;
  camera.position.y = (state.mission === 3 ? 1.9 : 1.7) + Math.sin(t * 0.8) * 0.012 * sway;
  if (waterMesh) waterMesh.position.y = 0.05 + Math.sin(t * 0.6) * 0.02;
  for (const ch of chargeMeshes) {
    if (!state.derrickDown && ch.material.emissive) ch.material.emissiveIntensity = 1.2 + Math.sin(t * 5) * 0.8;
  }
  for (const h of humans) {
    const bt = t * 1.1 + h.phase;
    h.group.scale.set(h.baseScale, h.baseScale * (1 + Math.sin(bt) * 0.012), h.baseScale);
  }
  renderer.render(scene, camera);
}
animate();
// ---------- Boot ----------
buildMission1();
buildMission2();
buildMission3();
setObjectives(OBJ1, 0); updateHUD();
loadHumans();
