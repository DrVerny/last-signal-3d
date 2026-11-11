// THE LAST SIGNAL - act manager for the single-page game.
// index.html loads this module only. It dynamically imports each act
// module when that act starts (the act boots on import) and calls the
// previous act's stopAct() before the next act loads, so acts never
// render or listen at the same time. Forward transitions never reload
// the page. Replay of an act that is already loaded reloads to
// index.html with ?act=N, because ES modules cannot be re-imported fresh.
import './core.js';

const ACTS = {
  1: { file: './game.js', name: 'Act I: The 4 Train', help: 'Drag to look around • Click glowing objects to inspect • WASD to move • R / Reset view to re-centre • F / Flashlight in the dark • Start: talk through the opening scene' },
  2: { file: './act2.js', name: 'Act II: City of Wires', help: 'Drag to look around • Click glowing objects to inspect • WASD to move • R / Reset view to re-centre • Act II: three missions - the aqueduct, the substation, the bridge' },
  3: { file: './act3.js', name: 'Act III: The Human Signal', help: 'Drag to look around • Click glowing objects to inspect • WASD to move • R / Reset view to re-centre • Act III: the control center, the courtroom, the escape, the safehouse, the press conference, the bridge at dawn' }
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
    document.title = 'THE LAST SIGNAL - ' + ACTS[n].name + ' (3D Prototype)';
  } catch (e) { /* ignore */ }
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

window.__lsActManager = { goToAct, setEndCardButtons };
window.__lsGoToAct = goToAct;
goToAct(startActFromURL());
