// THE LAST SIGNAL - act manager for the single-page game.
// index.html loads this module only. It dynamically imports each act
// module when that act starts (the act boots on import) and calls the
// previous act's stopAct() before the next act loads, so acts never
// render or listen at the same time. Forward transitions never reload
// the page. Replay of an act that is already loaded reloads to
// index.html with ?act=N, because ES modules cannot be re-imported fresh.
// The economy (money + store) and the homes are loaded here too: they are
// game-wide systems, not tied to one act, and they work in demo mode with
// no wallet connected, so a first-time player can use them immediately.
import './core.js';
import { initEconomy, isStoreOpen } from './economy.js';
import { enterPlace } from './home.js';

const ACTS = {
  1: { file: './game.js', name: 'Act I: The 4 Train', help: 'Drag to look around • Click glowing objects to inspect • WASD to move • R / Reset view • F / Flashlight • B / Store • H / Home • Start: talk through the opening scene' },
  2: { file: './act2.js', name: 'Act II: City of Wires', help: 'Drag to look around • Click glowing objects to inspect • WASD to move • R / Reset view • B / Store • M / City Map • H / Home • Act II: three missions - the aqueduct, the substation, the bridge' },
  3: { file: './act3.js', name: 'Act III: The Human Signal', help: 'Drag to look around • Click glowing objects to inspect • WASD to move • R / Reset view • B / Store • H / Home • Act III: the control center, the courtroom, the escape, the safehouse, the press conference, the bridge at dawn' }
};
const CUR_KEY = 'lastSignalCurrentAct';
let currentAct = 0;
const actModules = {};

function showLoading(text) {
  try {
    const t = document.getElementById('loadingText');
    if (t) t.textContent = text || 'Loading...';
    const l = document.getElementById('loading');
    if (l) l.classList.remove('hidden');
  } catch (e) { /* ignore */ }
}

function hideEndCard() {
  try { document.getElementById('endCard').classList.add('hidden'); } catch (e) { /* ignore */ }
  try { document.getElementById('endCardButtons').innerHTML = ''; } catch (e) { /* ignore */ }
  try { document.getElementById('dialogue').classList.add('hidden'); } catch (e) { /* ignore */ }
}

function setActChrome(n) {
  try {
    const name = document.getElementById('hudActName');
    if (name) name.textContent = '- ' + ACTS[n].name;
    const help = document.getElementById('help');
    if (help) help.textContent = ACTS[n].help;
    // Exterior view and the flashlight are Act I only.
    const ex = document.getElementById('exteriorBtn');
    if (ex) ex.style.display = n === 1 ? '' : 'none';
    const fl = document.getElementById('flashBtn');
    if (fl) fl.style.display = n === 1 ? '' : 'none';
    // The city map is an Act II hub (missions, stores, homes, visits).
    const mp = document.getElementById('mapBtn');
    if (mp) mp.style.display = n === 2 ? '' : 'none';
    document.title = 'THE LAST SIGNAL - ' + ACTS[n].name + ' (3D Prototype)';
  } catch (e) { /* ignore */ }
}

// ---------- Homes and visits ----------
// Entering a home pauses the current act WITHOUT disposing its scene
// (stopAct() disposes the scene, so it cannot be resumed - it is only for
// act transitions). pauseAct()/resumeAct() freeze and restart the act's
// render loop and input, so the player comes back to exactly where they
// were, mission progress intact. returnTo is 'map' (came from the city
// map: leaving returns to the map) or 'act' (came from the HUD: leaving
// returns straight to the act).
export function enterHome(kind, returnTo) {
  if (window.__lsHomeActive) return;
  if (!currentAct || !actModules[currentAct]) return;
  const mod = actModules[currentAct];
  try { if (typeof mod.pauseAct === 'function') mod.pauseAct(); } catch (e) { /* ignore */ }
  try { enterPlace(kind, () => leaveHome(returnTo || 'act')); } catch (e) { /* ignore */ }
}
export function leaveHome(returnTo) {
  const mod = currentAct ? actModules[currentAct] : null;
  try { if (mod && typeof mod.resumeAct === 'function') mod.resumeAct(); } catch (e) { /* ignore */ }
  if (returnTo === 'map' && currentAct === 2 && mod && typeof mod.openCityMap === 'function') {
    try { mod.openCityMap(); } catch (e) { /* ignore */ }
  }
}
// Home chooser for the HUD Home button: Mansion or Safe House.
function openHomeChooser() {
  if (window.__lsHomeActive || window.__lsTravelActive) return;
  if (isStoreOpen()) return;
  let el = document.getElementById('homeChooser');
  if (!el) {
    el = document.createElement('div');
    el.id = 'homeChooser';
    el.innerHTML = '<div class="home-chooser-panel"><h2>GO HOME</h2>'
      + '<p>Pick a place to rest. The Mansion is big and furnished; the Safe House is small, quiet, and nobody knows it.</p>'
      + '<button type="button" id="homeGoMansion">The Mansion<small>Sleep in the big bed - couch, big TV, dining table, kitchen.</small></button>'
      + '<button type="button" id="homeGoSafehouse">Safe House Apartment<small>Save the game - a small apartment, a safe place to rest.</small></button>'
      + '<button type="button" id="homeChooserClose">Stay here</button></div>';
    document.body.appendChild(el);
    document.getElementById('homeGoMansion').onclick = () => { el.classList.add('hidden'); enterHome('mansion', 'act'); };
    document.getElementById('homeGoSafehouse').onclick = () => { el.classList.add('hidden'); enterHome('safehouse', 'act'); };
    document.getElementById('homeChooserClose').onclick = () => { el.classList.add('hidden'); };
  }
  el.classList.remove('hidden');
}
function wireLifeButtons() {
  const hb = document.getElementById('homeBtn');
  if (hb) hb.onclick = () => openHomeChooser();
  const mb = document.getElementById('mapBtn');
  if (mb) mb.onclick = () => {
    if (isStoreOpen()) return;
    if (currentAct === 2 && actModules[2] && typeof actModules[2].openCityMap === 'function') actModules[2].openCityMap();
    else {
      const t = document.getElementById('toast');
      if (t) { t.textContent = 'The city map opens in Act II - finish Act I first.'; t.style.opacity = '1'; setTimeout(() => { t.style.opacity = '0'; }, 3000); }
    }
  };
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (window.__lsHomeActive || window.__lsTravelActive) return;
    if (isStoreOpen()) return;
    if (k === 'h') openHomeChooser();
    if (k === 'm') {
      if (currentAct === 2 && actModules[2] && typeof actModules[2].openCityMap === 'function') actModules[2].openCityMap();
    }
  });
}

// Replay of an act: set where to resume, then reload to that act.
function replay(n) {
  try { localStorage.setItem(CUR_KEY, String(n)); } catch (e) { /* ignore */ }
  location.href = 'index.html' + (n > 1 ? '?act=' + n : '');
}

// Buttons for the end card of the act that just finished. Each act calls
// this from its endAct() after filling #endSummary.
export function setEndCardButtons(kind) {
  const box = document.getElementById('endCardButtons');
  if (!box) return;
  const mk = (label, onclick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = onclick;
    return b;
  };
  box.innerHTML = '';
  if (kind === 'act1') {
    box.appendChild(mk('Begin Act II - City of Wires ▸', () => goToAct(2)));
    box.appendChild(mk('Play Act I Again', () => replay(1)));
  } else if (kind === 'act2') {
    box.appendChild(mk('Begin Act III - The Human Signal ▸', () => goToAct(3)));
    box.appendChild(mk('Play Act I Again', () => replay(1)));
    box.appendChild(mk('Play Act II Again', () => replay(2)));
  } else if (kind === 'act3') {
    box.appendChild(mk('Play Act I Again', () => replay(1)));
    box.appendChild(mk('Play Act II Again', () => replay(2)));
    box.appendChild(mk('Play Act III Again', () => replay(3)));
  }
}

export async function goToAct(n) {
  n = Number(n) || 1;
  if (!ACTS[n]) n = 1;
  // An act that is already loaded cannot be re-imported fresh, so a
  // replay goes through a reload to that act instead.
  if (actModules[n]) { replay(n); return; }
  // Stop the current act cleanly before the next one boots.
  if (currentAct && actModules[currentAct]) {
    try {
      const m = actModules[currentAct];
      if (m && typeof m.stopAct === 'function') m.stopAct();
    } catch (e) { /* ignore */ }
  }
  hideEndCard();
  setActChrome(n);
  try { localStorage.setItem(CUR_KEY, String(n)); } catch (e) { /* ignore */ }
  currentAct = n;
  showLoading('Loading ' + ACTS[n].name + '...');
  const mod = await import(ACTS[n].file);
  actModules[n] = mod;
}

// Which act to start on a fresh load: ?act=N wins, then the last act
// reached (so a refresh resumes), but only when that act's prerequisite
// save exists. Otherwise start at Act I.
function startActFromURL() {
  let n = 1;
  try {
    const q = new URLSearchParams(location.search).get('act');
    if (q) {
      n = Number(q) || 1;
    } else {
      const cur = Number(localStorage.getItem(CUR_KEY) || '1') || 1;
      if (cur === 2 || cur === 3) n = cur;
    }
  } catch (e) { /* ignore */ }
  try {
    if (n === 2 && !localStorage.getItem('lastSignalAct1')) n = 1;
    if (n === 3 && !localStorage.getItem('lastSignalAct2')) n = 1;
  } catch (e) { n = 1; }
  if (n < 1 || n > 3) n = 1;
  return n;
}

// ---------- Prologue: the opening phone call ----------
// A fresh player does not start on the train. The game opens in his
// room (the Mansion): the phone rings, Jade calls with the reason for
// the first mission, he goes to the Train Terminal and boards the 4
// train, and THAT starts Act I. Once he has boarded (the flag is set),
// later loads resume the act he reached, like before. If the prologue
// cannot open (no room), fall back to Act I.
export function startPrologue() {
  try {
    enterPlace('mansion', () => {}, { prologue: true, onBoardTrain: () => {
      try { localStorage.setItem('lastSignalPrologue', 'done'); } catch (e) { /* private mode */ }
      goToAct(1);
    } });
  } catch (e) { goToAct(1); }
}

window.__lsActManager = { goToAct, setEndCardButtons, enterHome, leaveHome, startPrologue };
window.__lsGoToAct = goToAct;
// Game-wide systems: money + store (with retroactive payouts for missions
// already finished) and the HUD buttons. No wallet needed - demo mode.
try { initEconomy(); } catch (e) { /* economy is optional */ }
try { wireLifeButtons(); } catch (e) { /* buttons are optional */ }
// A fresh player (no prologue done, no act save) starts in his room
// with the phone ringing. Anyone who has boarded the train, or who has
// an act save, loads straight into the act they reached.
let prologueDone = false, hasActSave = false;
try {
  prologueDone = localStorage.getItem('lastSignalPrologue') === 'done';
  hasActSave = !!(localStorage.getItem('lastSignalAct1') || localStorage.getItem('lastSignalAct2') || localStorage.getItem('lastSignalAct3'));
} catch (e) { /* ignore */ }
if (!prologueDone && !hasActSave) startPrologue();
else goToAct(startActFromURL());
