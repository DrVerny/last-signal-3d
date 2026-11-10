// THE LAST SIGNAL - Act I: The 4 Train - 3D prototype
// Original short dialogue in the spirit of the script; no long verbatim copying.
// Sealed choice is simulated locally: hidden until reveal. On Sepolia it would
// use FHEVM (as in Sealed Fortune) so no one sees the choice before reveal.
const state = {
  trust: 3, timer: 900, // 15:00 in-fiction, ticks in real time
  integrity: { Transit: 70, Water: 80, Power: 60, Comms: 40 },
  objectives: [], inventory: [], sealedChoice: null, sealedRevealed: false,
  stage: 'intro', repaired: false, passengersCounted: false, walterHelped: false, boardFound: false,
  yaw: 0, pitch: 0, camZ: 0
};
const OBJ = [
  'Ride the 4 train - talk to Caleb',
  'Survive the blackout - inspect the signal relay',
  'Repair the relay (match the circuit)',
  'Count the passengers and help Walter',
  'Make a sealed choice: which line gets priority power',
  'Find the RESET circuit board on the platform'
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
function toast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.style.opacity = 1;
  setTimeout(() => t.style.opacity = 0, 3500);
}
function hideToast() { document.getElementById('toast').style.opacity = 0; }
function trust(n, why) { state.trust = Math.max(0, Math.min(10, state.trust + n)); updateHUD(); toast((n > 0 ? 'Trust +' + n : 'Trust ' + n) + (why ? ' - ' + why : '')); }
function integrity(key, n) { state.integrity[key] = Math.max(0, Math.min(100, state.integrity[key] + n)); updateHUD(); }

// ---------- Dialogue ----------
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
    ctx.fillStyle = fg; ctx.font = 'bold 52px Arial'; ctx.textAlign = 'center'; ctx.fillText(text, w / 2, 62);
    if (sub) { ctx.font = '26px Arial'; ctx.fillText(sub, w / 2, 102); }
    ctx.textAlign = 'left';
  });
}

// ---------- Three.js scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; // photoreal filmic response
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070a);
scene.fog = new THREE.FogExp2(0x0a0d10, 0.055); // tunnel haze, denser than before
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 1.6, 6);
const ambient = new THREE.AmbientLight(0xbfc8d4, 0.35); scene.add(ambient); // low cool fill, real light comes from tubes
const hemi = new THREE.HemisphereLight(0x8fa3b8, 0x1a1410, 0.25); scene.add(hemi);
// Cool-white fluorescent key light, with realistic falloff and shadows
const mainLight = new THREE.PointLight(0xeef4ff, 28, 22, 1.8); mainLight.position.set(0, 2.6, 0);
mainLight.castShadow = true; mainLight.shadow.mapSize.set(1024, 1024); mainLight.shadow.bias = -0.002;
scene.add(mainLight);
const fillLight = new THREE.PointLight(0xdfeaff, 8, 16, 1.8); fillLight.position.set(0, 2.5, -4.5); scene.add(fillLight);
const fillLight2 = new THREE.PointLight(0xdfeaff, 8, 16, 1.8); fillLight2.position.set(0, 2.5, 4.5); scene.add(fillLight2);
const redLight = new THREE.PointLight(0xff2a22, 0, 22, 1.6); redLight.position.set(0, 2.4, 0); redLight.castShadow = true; scene.add(redLight);
const redLight2 = new THREE.PointLight(0xff2a22, 0, 18, 1.6); redLight2.position.set(0, 2.2, -4); scene.add(redLight2);
const warmLight = new THREE.PointLight(0xffc98a, 0, 18, 1.7); warmLight.position.set(0, 2.5, 0); scene.add(warmLight);
// Fluorescent tube fixtures (emissive, so they read as real light sources)
const tubeMat = new THREE.MeshStandardMaterial({ color: 0xf4f8ff, emissive: 0xeef4ff, emissiveIntensity: 1.6, roughness: 0.3 });
const tubeGeo = new THREE.BoxGeometry(0.28, 0.06, 3.2);
const tubes = [];
for (const z of [-4.5, 0, 4.5]) {
  const t = new THREE.Mesh(tubeGeo, tubeMat); t.position.set(0, 2.92, z); scene.add(t); tubes.push(t);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xdfeaff, transparent: true, opacity: 0.22, depthWrite: false }));
  glow.scale.set(2.2, 0.7, 1); glow.position.set(0, 2.85, z); scene.add(glow); tubes.push(glow);
}
// Red emergency strips along the ceiling (emissive, glow in blackout)
const stripMat = new THREE.MeshStandardMaterial({ color: 0x7a0f0f, emissive: 0xff2222, emissiveIntensity: 0, roughness: 0.5 });
for (const x of [-1.4, 1.4]) {
  const s = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 12), stripMat);
  s.position.set(x, 2.9, 0); scene.add(s);
}
// Dust motes drifting in the air, lit by the tubes
const dustGeo = new THREE.BufferGeometry();
const dustCount = 320, dustPos = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) { dustPos[i * 3] = (Math.random() - 0.5) * 5.6; dustPos[i * 3 + 1] = 0.2 + Math.random() * 2.7; dustPos[i * 3 + 2] = (Math.random() - 0.5) * 13; }
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: glowTexture(), color: 0xcfd8e2, size: 0.035, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true }));
scene.add(dust);
// Volumetric-style light shafts under the tubes (additive, faint)
const shaftMat = new THREE.MeshBasicMaterial({ color: 0xbfd4ee, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const shafts = [];
for (const z of [-4.5, 0, 4.5]) {
  const shaft = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.9, 24, 1, true), shaftMat);
  shaft.position.set(0, 1.45, z); scene.add(shaft); shafts.push(shaft);
}
function setLightingMode(mode) {
  // mode: 'normal' (cool fluorescent), 'blackout' (dark + red), 'battery' (dim warm)
  if (mode === 'normal') {
    mainLight.intensity = 28; fillLight.intensity = 8; fillLight2.intensity = 8;
    redLight.intensity = 0; redLight2.intensity = 0; warmLight.intensity = 0;
    tubeMat.emissive.set(0xeef4ff); tubeMat.emissiveIntensity = 1.6; stripMat.emissiveIntensity = 0;
    renderer.toneMappingExposure = 1.15; scene.fog.density = 0.045;
  } else if (mode === 'blackout') {
    mainLight.intensity = 0.6; fillLight.intensity = 0; fillLight2.intensity = 0;
    redLight.intensity = 14; redLight2.intensity = 9; warmLight.intensity = 0;
    tubeMat.emissive.set(0x111111); tubeMat.emissiveIntensity = 0.1; stripMat.emissiveIntensity = 2.2;
    renderer.toneMappingExposure = 0.9; scene.fog.density = 0.075;
  } else {
    mainLight.intensity = 0; fillLight.intensity = 0; fillLight2.intensity = 0;
    redLight.intensity = 2; redLight2.intensity = 1; warmLight.intensity = 12;
    tubeMat.emissive.set(0xffc98a); tubeMat.emissiveIntensity = 0.5; stripMat.emissiveIntensity = 0.4;
    renderer.toneMappingExposure = 1.0; scene.fog.density = 0.06;
  }
}
setLightingMode('normal');
const floorTex = grimeTexture('#33383d', '#14171a', 3, 7);
const wallTex = grimeTexture('#46545e', '#1c2226', 2, 2);
const seatTex = fabricTexture('#1d4a75', 2, 1);
const steelTex = grimeTexture('#9aa4ab', '#5a646b', 1, 1);
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
// Subway car interior: floor, ceiling, walls, seats, poles, doors, windows
box(6, 0.1, 14, 0x2a2f33, 0, 0, 0, null, { map: floorTex, roughness: 0.65, metalness: 0.15 }); // worn, scuffed floor
box(6, 0.1, 14, 0x1c2126, 0, 3, 0, null, { map: wallTex, roughness: 0.9 }); // ceiling
box(0.15, 3, 14, 0x3a4a55, -3, 1.5, 0, null, { map: wallTex, roughness: 0.75, metalness: 0.3 }); // left wall
box(0.15, 3, 14, 0x3a4a55, 3, 1.5, 0, null, { map: wallTex, roughness: 0.75, metalness: 0.3 }); // right wall
box(6, 3, 0.15, 0x2a343c, 0, 1.5, -7, null, { map: wallTex, roughness: 0.8, metalness: 0.25 }); // front
box(6, 3, 0.15, 0x2a343c, 0, 1.5, 7, null, { map: wallTex, roughness: 0.8, metalness: 0.25 }); // back
// Seats (blue fabric benches, worn)
for (const sx of [-2.4, 2.4]) for (let z = -5; z <= 5; z += 2.5) box(1.2, 0.5, 2, 0x1f4e79, sx, 0.6, z, null, { map: seatTex, roughness: 0.95, metalness: 0 });
// Poles (brushed stainless steel, slight wear)
for (let z = -6; z <= 6; z += 3) { cyl(0.05, 3, 0xc0c8cc, -1.2, 1.5, z, { map: steelTex, metalness: 0.9, roughness: 0.28 }); cyl(0.05, 3, 0xc0c8cc, 1.2, 1.5, z, { map: steelTex, metalness: 0.9, roughness: 0.28 }); }
// Horizontal handrails above the seats
for (const sx of [-1.2, 1.2]) { const r = cyl(0.035, 13, 0xc0c8cc, sx, 2.55, 0, { metalness: 0.9, roughness: 0.3 }); r.rotation.x = Math.PI / 2; }
// Doors (centre, right side) - open to platform after blackout
const doorL = box(0.1, 2.2, 1.1, 0x8a9aa5, 2.95, 1.2, -1, 'door', { map: steelTex, metalness: 0.7, roughness: 0.35 });
const doorR = box(0.1, 2.2, 1.1, 0x8a9aa5, 2.95, 1.2, 1, 'door', { map: steelTex, metalness: 0.7, roughness: 0.35 });
// Windows: dark city glow strips (emissive, so the city outside reads as lit)
const winMat = new THREE.MeshStandardMaterial({ color: 0x0a1a2a, emissive: 0x16283a, emissiveIntensity: 0.7, roughness: 0.15, metalness: 0.4 });
for (const sx of [-2.95, 2.95]) for (let z = -5; z <= 5; z += 2.5) {
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 1.4), winMat);
  win.position.set(sx, 1.9, z); scene.add(win);
}
// Realistic signage and ads on the car walls (procedural canvas textures)
wallPlane(1.1, 1.65, posterTexture('mta'), -2.91, 1.7, -5.2, Math.PI / 2);
wallPlane(1.1, 1.65, posterTexture('zoo'), 2.91, 1.7, -5.2, -Math.PI / 2);
wallPlane(1.1, 1.65, posterTexture('safety'), -2.91, 1.7, 5.2, Math.PI / 2);
wallPlane(1.1, 1.65, posterTexture('zoo'), 2.91, 1.7, 5.2, -Math.PI / 2);
wallPlane(2.0, 0.5, signTexture('14 ST - UNION SQ', '#111111', '#e8e8e8', '4  5  6  L  N  Q  R  W'), -2.91, 2.55, 0, Math.PI / 2);
wallPlane(1.6, 0.4, signTexture('STAND CLEAR OF THE CLOSING DOORS', '#e8e8e8', '#111111', ''), 2.91, 2.55, 0, -Math.PI / 2);
// Interactive objects
const relay = box(0.7, 0.9, 0.2, 0xffd166, -2.9, 1.6, -3, 'relay');
const release = box(0.4, 0.5, 0.15, 0xef476f, 2.9, 1.5, -3, 'release');
const panel = box(0.8, 1.0, 0.15, 0x4cc9f0, -2.9, 1.5, 3, 'panel');
const board = box(0.35, 0.25, 0.05, 0x7ac74f, 2.9, 1.1, 3, 'board');
board.visible = false; // appears on the platform after evacuation
// NPCs: simple figures (Jade = player, Caleb, Nurse, Walter)
function person(color, x, z, name) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 1.1, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  body.position.y = 0.8; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.6 }));
  head.position.y = 1.55; head.castShadow = true; g.add(head);
  // Shoulders read as a real coat, not a flat cylinder
  const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  shoulders.scale.set(1, 0.55, 1); shoulders.position.y = 1.32; shoulders.castShadow = true; g.add(shoulders);
  g.position.set(x, 0, z); g.name = name; scene.add(g); return g;
}
const caleb = person(0x1a3a5a, 1.5, -2, 'caleb');
const nurse = person(0xffffff, -1.8, 1, 'nurse');
const walter = person(0x5a4a3a, -1.8, 4, 'walter');
// Platform outside the doors (visible when doors open)
box(6, 0.1, 4, 0x3a3a3a, 6, 0, 0);
box(0.2, 3, 4, 0x222222, 9, 1.5, 0);
// Drag to look, WASD to move
let dragging = false, lx = 0, ly = 0;
canvas.addEventListener('mousedown', e => { dragging = true; lx = e.clientX; ly = e.clientY; });
addEventListener('mouseup', () => dragging = false);
addEventListener('mousemove', e => {
  if (!dragging) return;
  state.yaw -= (e.clientX - lx) * 0.003; state.pitch -= (e.clientY - ly) * 0.003;
  state.pitch = Math.max(-0.6, Math.min(0.6, state.pitch)); lx = e.clientX; ly = e.clientY;
});
const keys = {};
addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
function animate() {
  requestAnimationFrame(animate);
  const t = Date.now() / 1000;
  const sp = 0.05;
  if (keys['w']) camera.position.z -= sp; if (keys['s']) camera.position.z += sp;
  if (keys['a']) camera.position.x -= sp; if (keys['d']) camera.position.x += sp;
  camera.position.x = Math.max(-2.5, Math.min(2.5, camera.position.x));
  camera.position.z = Math.max(-6.5, Math.min(6.5, camera.position.z));
  camera.rotation.order = 'YXZ';
  // Slight handheld sway (depth-of-field feel comes from the vignette + grain overlays)
  const sway = document.getElementById('dialogue').classList.contains('hidden') ? 1 : 0.4;
  camera.rotation.y = state.yaw + Math.sin(t * 0.7) * 0.004 * sway;
  camera.rotation.x = state.pitch + Math.sin(t * 0.9 + 1.3) * 0.003 * sway;
  camera.position.y = 1.6 + Math.sin(t * 0.8) * 0.012 * sway;
  // Dust drifts slowly through the light shafts
  const pos = dustGeo.attributes.position;
  for (let i = 0; i < dustCount; i++) {
    let y = pos.getY(i) - 0.0006;
    if (y < 0.15) y = 2.9;
    pos.setY(i, y);
    pos.setX(i, pos.getX(i) + Math.sin(t * 0.4 + i) * 0.0004);
  }
  pos.needsUpdate = true;
  dust.material.opacity = (state.stage === 'blackout') ? 0.25 : 0.55;
  if (state.stage === 'blackout' || state.stage === 'after') {
    if (state.stage === 'blackout') {
      // Flickering red emergency light while the relay is dead
      setLightingMode('blackout');
      redLight.intensity = 12 + Math.sin(t * 9) * 3 + (Math.random() > 0.96 ? -6 : 0);
      mainLight.intensity = 0.4 + Math.sin(t * 7) * 0.25;
    } else {
      setLightingMode('battery'); // dim warm battery power after the repair
    }
  }
  renderer.render(scene, camera);
}
animate();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
// Click to inspect
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
canvas.addEventListener('click', e => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects([relay, release, panel, board, doorL, doorR, caleb, nurse, walter], true);
  if (!hits.length) return;
  let o = hits[0].object; while (o.parent && o.parent !== scene && !o.userData.clickable && !o.name) o = o.parent;
  interact(o.name || hits[0].object.name);
});
function interact(name) {
  if (name === 'relay' && state.stage === 'blackout') { openRepair(); return; }
  if (name === 'relay') { toast('Signal relay - dead. It needs a repair once the power is out.'); return; }
  if (name === 'release') { toast('Emergency release - locked. Restore the relay first.'); return; }
  if (name === 'panel') { toast('Maintenance panel - wiring inside. Jade knows this panel by heart.'); return; }
  if (name === 'board' && board.visible) { findBoard(); return; }
  if (name === 'caleb') { toast('Caleb Bishop, NYPD Transit. Young, earnest, out of his depth - and trying.'); return; }
  if (name === 'nurse') { toast('Nurse Adeyemi - night shift starts in an hour. People are counting on her.'); return; }
  if (name === 'walter') { toast('Walter Simms, 70s. He rode this line when it cost a nickel. He cannot climb stairs.'); return; }
  if (name === 'door') { toast('Doors - sealed while the train is in the tunnel.'); return; }
}

// ---------- Repair mini-game ----------
const TARGET = [1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0];
let gridState = [];
function openRepair() {
  document.getElementById('repairModal').classList.remove('hidden');
  gridState = TARGET.map(() => Math.random() > 0.5 ? 1 : 0);
  renderRepair();
}
function renderRepair() {
  const tp = document.getElementById('targetPattern');
  tp.innerHTML = TARGET.map(v => `<div class="tile ${v ? 'lit' : ''}"></div>`).join('');
  const g = document.getElementById('repairGrid');
  g.innerHTML = '';
  gridState.forEach((v, i) => {
    const d = document.createElement('div'); d.className = 'tile' + (v ? ' on' : '');
    d.onclick = () => { gridState[i] = 1 - v; renderRepair(); checkRepair(); };
    g.appendChild(d);
  });
  document.getElementById('repairStatus').textContent = 'Match the gold pattern above.';
}
function checkRepair() {
  if (gridState.every((v, i) => v === TARGET[i])) {
    state.repaired = true;
    hideToast(); // BLACKOUT banner goes away as soon as the lights return
    document.getElementById('repairStatus').textContent = '✓ Relay restored - platform lights flicker back on.';
    document.getElementById('repairClose').textContent = 'Continue';
    integrity('Transit', 10); integrity('Power', 10);
    setObjectives(3);
  }
}
document.getElementById('repairClose').onclick = () => {
  document.getElementById('repairModal').classList.add('hidden');
  if (state.repaired && state.stage === 'blackout') { state.stage = 'after'; afterRepair(); }
};

// ---------- Flow ----------
function afterRepair() {
  doorL.position.x = 2.95; doorR.position.x = 2.95;
  // slide doors open (visually: move them apart)
  doorL.position.z = -2.2; doorR.position.z = 2.2;
  board.visible = true;
  showDialogue([
    { who: 'Jade', text: 'Lights are back - on battery. Fifteen minutes. We move now, or we wait in the dark.' },
    { who: 'Caleb', text: 'Count the passengers. Third car first. Nobody gets left behind.' }
  ], () => countPassengers());
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
  // Prototype simulates FHE locally; on Sepolia this would be an FHEVM euint32.
  showDialogue([
    { who: 'System', text: 'SEALED CHOICE - Priority power: one line gets full power for 2 hours. The others run low. Your choice is sealed - nobody, not even the other players, can see it until the reveal.' },
    { who: 'Jade', text: 'Hospital, residential, or the treatment plant. There is no clean answer. Choose - and own it.', choices: [
      { label: 'Hospital - full power', effect: () => { state.sealedChoice = 'Hospital'; integrity('Water', -5); } },
      { label: 'Residential - dialysis clinic line', effect: () => { state.sealedChoice = 'Residential'; integrity('Power', -5); } },
      { label: 'Industrial - water treatment plant', effect: () => { state.sealedChoice = 'Industrial'; integrity('Transit', -5); } }
    ] }
  ], () => { setObjectives(5); toast('Choice sealed (encrypted in prototype - hidden until reveal). Click the green circuit board on the platform wall.'); });
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
  const el = document.getElementById('endCard');
  el.classList.remove('hidden');
  document.getElementById('endSummary').innerHTML =
    `<p>Act I complete - the passengers are moving to the platform, the relay is repaired, and the RESET board is in your hands. Caleb is staying with Walter on the bench until help reaches him.</p>` +
    `<p><strong>Sealed choice revealed:</strong> ${state.sealedChoice || 'none'} got priority power. ` +
    `In the full Zama version this choice would have stayed encrypted on-chain until this moment.</p>` +
    `<p>Trust: ${state.trust} / 10 &nbsp;•&nbsp; System Integrity - Transit ${state.integrity.Transit}, Water ${state.integrity.Water}, Power ${state.integrity.Power}, Comms ${state.integrity.Comms}</p>` +
    `<p>Next: Act II - City of Wires (not in this prototype).</p>`;
}
document.getElementById('cinemaBtn').onclick = () => {
  document.getElementById('letterboxTop').classList.toggle('hidden');
  document.getElementById('letterboxBottom').classList.toggle('hidden');
};
// Timer
setInterval(() => {
  if (state.timer > 0) { state.timer--; updateHUD(); if (state.timer === 0) toast('Battery dead - emergency lights are out. The story continues in the dark.'); }
}, 1000);
// Intro
setObjectives(0); updateHUD();
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
  setObjectives(2);
  toast('BLACKOUT - click the glowing gold signal relay to repair it.');
});
