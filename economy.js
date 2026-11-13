// THE LAST SIGNAL - in-game economy: money, the store, clothes, cars, accessories.
// No wallet, no real money: this is play money earned by finishing missions.
// It persists in localStorage so it survives reloads. Demo mode works with
// no wallet connected - the store and the money are purely in-game.

// Mission payouts. They vary per mission and total exactly $100,000.
export const PAYOUTS = { act1: 8000, act2m1: 12000, act2m2: 18000, act2m3: 22000, act3: 40000 };
export const PAYOUT_LABELS = {
  act1: 'Act I complete', act2m1: 'Mission 1 complete', act2m2: 'Mission 2 complete',
  act2m3: 'Mission 3 complete', act3: 'Act III complete'
};

export const STORE_ITEMS = {
  clothes: [
    { id: 'tee', name: 'Casual Tee', price: 1200, color: '#9aa5ad', desc: 'Everyday grey tee' },
    { id: 'hoodie', name: 'Street Hoodie', price: 2500, color: '#c0392b', desc: 'Red hoodie, street style' },
    { id: 'vest', name: 'Tactical Vest', price: 5000, color: '#4a7c59', desc: 'Green tactical vest' },
    { id: 'leather', name: 'Leather Jacket', price: 6500, color: '#6b4226', desc: 'Brown leather jacket' },
    { id: 'suit', name: 'Sharp Suit', price: 8000, color: '#1a1a1a', desc: 'Black sharp suit' }
  ],
  cars: [
    { id: 'sedan', name: 'City Sedan', price: 0, color: '#9aa5ad', desc: 'Reliable city sedan' },
    { id: 'coupe', name: 'Sports Coupe', price: 22000, color: '#c0392b', desc: 'Fast red coupe' },
    { id: 'bmw-m4', name: 'BMW M4', price: 28000, color: '#2e6fb0', desc: 'Blue BMW M4' },
    { id: 'bmw-x5', name: 'BMW X5', price: 35000, color: '#1a1a1a', desc: 'Black BMW X5' }
  ],
  accessories: [
    { id: 'cap', name: 'Cap', price: 800, color: '#2e4a6b', desc: 'A cap, worn forward' },
    { id: 'sunglasses', name: 'Sunglasses', price: 1500, color: '#111111', desc: 'Dark shades' },
    { id: 'watch', name: 'Watch', price: 2000, color: '#d8b13a', desc: 'A gold watch' },
    { id: 'chain', name: 'Gold Chain', price: 3000, color: '#ffd166', desc: 'A gold chain' }
  ]
};
const ITEM_BY_ID = {};
for (const tab of Object.values(STORE_ITEMS)) for (const it of tab) ITEM_BY_ID[it.id] = it;

const MONEY_KEY = 'lastSignalMoney';
const PAID_KEY = 'lastSignalPaid';
const OWNED_KEY = 'lastSignalOwned';
const EQUIPPED_KEY = 'lastSignalEquipped';

function readJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; }
}
function writeJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ } }

export function moneyFmt(n) { return '$' + Number(n || 0).toLocaleString('en-US'); }
export function getBalance() {
  try { return Number(localStorage.getItem(MONEY_KEY) || '0') || 0; } catch (e) { return 0; }
}
function setBalance(n) { try { localStorage.setItem(MONEY_KEY, String(Math.max(0, Math.floor(n)))); } catch (e) { /* ignore */ } updateWalletHUD(); }
export function addMoney(n) { setBalance(getBalance() + n); }
function spendMoney(n) { if (getBalance() < n) return false; setBalance(getBalance() - n); return true; }

export function updateWalletHUD() {
  const el = document.getElementById('walletBal');
  if (el) el.textContent = moneyFmt(getBalance());
  const sb = document.getElementById('storeBalance');
  if (sb) sb.textContent = 'Balance: ' + moneyFmt(getBalance());
}

// A gold toast on the shared #toast element, like the acts use.
let payToastTimer = 0;
export function showPayToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.opacity = '1';
  if (payToastTimer) clearTimeout(payToastTimer);
  payToastTimer = setTimeout(() => { t.style.opacity = '0'; }, 4000);
}

// Grant a mission payout once only. Returns true when it paid out.
export function grantPayout(missionId, quiet) {
  const paid = readJSON(PAID_KEY, []);
  if (paid.indexOf(missionId) !== -1) return false;
  const amount = PAYOUTS[missionId];
  if (!amount) return false;
  paid.push(missionId);
  writeJSON(PAID_KEY, paid);
  addMoney(amount);
  if (!quiet) showPayToast('Mission pay: +' + moneyFmt(amount) + ' - ' + (PAYOUT_LABELS[missionId] || missionId));
  return true;
}

// The player has already finished Act I and Act II Mission 1, so when the
// economy first loads it grants the payouts for missions already done,
// using the saves that exist. That gives $20,000 right away (Act I +
// Mission 1), so the store is usable immediately.
export function grantRetroactivePayouts() {
  let total = 0;
  const has = (k) => { try { return !!localStorage.getItem(k); } catch (e) { return false; } };
  const mission = Number(localStorage.getItem('lastSignalAct2Mission') || '0') || 0;
  if (has('lastSignalAct1') && grantPayout('act1', true)) total += PAYOUTS.act1;
  if ((mission >= 2 || has('lastSignalAct2')) && grantPayout('act2m1', true)) total += PAYOUTS.act2m1;
  if ((mission >= 3 || has('lastSignalAct2')) && grantPayout('act2m2', true)) total += PAYOUTS.act2m2;
  if (has('lastSignalAct2') && grantPayout('act2m3', true)) total += PAYOUTS.act2m3;
  if (has('lastSignalAct3') && grantPayout('act3', true)) total += PAYOUTS.act3;
  if (total > 0) showPayToast('Welcome back pay: +' + moneyFmt(total) + ' for missions already finished. Your balance: ' + moneyFmt(getBalance()));
  return total;
}

// ---------- Owned / equipped ----------
export function getOwned() {
  const owned = readJSON(OWNED_KEY, null);
  if (Array.isArray(owned)) return owned;
  const d = ['tee', 'sedan'];
  writeJSON(OWNED_KEY, d);
  return d;
}
export function isOwned(id) { return getOwned().indexOf(id) !== -1; }
export function getEquipped() {
  const eq = readJSON(EQUIPPED_KEY, null);
  if (eq && eq.clothes && eq.car && Array.isArray(eq.accessories)) return eq;
  const d = { clothes: 'tee', car: 'sedan', accessories: [] };
  writeJSON(EQUIPPED_KEY, d);
  return d;
}
function setEquipped(eq) { writeJSON(EQUIPPED_KEY, eq); }
export function getEquippedCar() { return getEquipped().car || 'sedan'; }
export function getEquippedCarDef() { return ITEM_BY_ID[getEquippedCar()] || ITEM_BY_ID.sedan; }

function buyItem(id) {
  const item = ITEM_BY_ID[id];
  if (!item) return false;
  if (isOwned(id)) return false;
  if (!spendMoney(item.price)) { storeMsg('Not enough money - ' + item.name + ' costs ' + moneyFmt(item.price) + ', you have ' + moneyFmt(getBalance()) + '. Finish a mission to earn more.'); return false; }
  const owned = getOwned(); owned.push(id); writeJSON(OWNED_KEY, owned);
  storeMsg('Bought ' + item.name + ' for ' + moneyFmt(item.price) + '.');
  return true;
}
function equipItem(id) {
  const item = ITEM_BY_ID[id];
  if (!item || !isOwned(id)) return;
  const eq = getEquipped();
  if (item.id === 'sedan' || STORE_ITEMS.cars.some(c => c.id === id)) eq.car = id;
  else if (STORE_ITEMS.clothes.some(c => c.id === id)) eq.clothes = id;
  setEquipped(eq);
  storeMsg('Equipped ' + item.name + '.');
  drawPreview();
}
function toggleAccessory(id) {
  const item = ITEM_BY_ID[id];
  if (!item || !isOwned(id)) return;
  const eq = getEquipped();
  const i = eq.accessories.indexOf(id);
  if (i === -1) { eq.accessories.push(id); storeMsg('Wearing ' + item.name + '.'); }
  else { eq.accessories.splice(i, 1); storeMsg('Took off ' + item.name + '.'); }
  setEquipped(eq);
  drawPreview();
}

// ---------- Character / car preview (2D canvas: this is how the player SEES the clothes change) ----------
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  ctx.fill();
}
function drawLook(cv) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const eq = getEquipped();
  const outfit = ITEM_BY_ID[eq.clothes] || ITEM_BY_ID.tee;
  const cx = W / 2;
  // Ground shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(cx, H - 18, 52, 8, 0, 0, Math.PI * 2); ctx.fill();
  // Legs (dark trousers) and shoes.
  ctx.fillStyle = '#2a2f33';
  ctx.fillRect(cx - 26, 196, 22, 88); ctx.fillRect(cx + 4, 196, 22, 88);
  ctx.fillStyle = '#111111';
  rr(ctx, cx - 30, 282, 28, 12, 4); rr(ctx, cx + 2, 282, 28, 12, 4);
  // Arms (sleeves in the outfit colour, hands skin).
  ctx.fillStyle = outfit.color;
  rr(ctx, cx - 52, 96, 20, 82, 8); rr(ctx, cx + 32, 96, 20, 82, 8);
  ctx.fillStyle = '#d9a066';
  ctx.beginPath(); ctx.arc(cx - 42, 182, 9, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 42, 182, 9, 0, Math.PI * 2); ctx.fill();
  // Watch on the left wrist.
  if (eq.accessories.indexOf('watch') !== -1) {
    ctx.fillStyle = '#d8b13a'; ctx.fillRect(cx - 51, 168, 18, 8);
    ctx.fillStyle = '#111111'; ctx.fillRect(cx - 46, 170, 8, 4);
  }
  // Torso in the outfit colour.
  ctx.fillStyle = outfit.color;
  rr(ctx, cx - 38, 88, 76, 112, 12);
  // Suit: a white shirt V and a tie. Hoodie: a hood bump. Vest: straps.
  if (eq.clothes === 'suit') {
    ctx.fillStyle = '#f2f2f2';
    ctx.beginPath(); ctx.moveTo(cx - 12, 88); ctx.lineTo(cx + 12, 88); ctx.lineTo(cx, 118); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8a1a1a'; ctx.fillRect(cx - 4, 112, 8, 34);
  } else if (eq.clothes === 'hoodie') {
    ctx.fillStyle = outfit.color;
    ctx.beginPath(); ctx.arc(cx, 88, 22, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#f2f2f2'; ctx.fillRect(cx - 14, 92, 28, 3);
  } else if (eq.clothes === 'vest') {
    ctx.fillStyle = '#2a2a2a'; ctx.fillRect(cx - 30, 100, 60, 6); ctx.fillRect(cx - 30, 150, 60, 6);
  } else if (eq.clothes === 'leather') {
    ctx.fillStyle = '#2a2a2a'; ctx.fillRect(cx - 2, 88, 4, 112);
  }
  // Gold chain on the chest.
  if (eq.accessories.indexOf('chain') !== -1) {
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, 92, 26, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  }
  // Neck and head.
  ctx.fillStyle = '#d9a066'; ctx.fillRect(cx - 10, 74, 20, 16);
  ctx.beginPath(); ctx.arc(cx, 52, 26, 0, Math.PI * 2); ctx.fill();
  // Hair.
  ctx.fillStyle = '#2a1a12';
  ctx.beginPath(); ctx.arc(cx, 48, 26, Math.PI, 0); ctx.fill();
  ctx.fillRect(cx - 26, 44, 52, 8);
  // Eyes.
  ctx.fillStyle = '#111111';
  ctx.beginPath(); ctx.arc(cx - 10, 52, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 10, 52, 3, 0, Math.PI * 2); ctx.fill();
  // Sunglasses.
  if (eq.accessories.indexOf('sunglasses') !== -1) {
    ctx.fillStyle = '#111111';
    rr(ctx, cx - 20, 44, 18, 11, 4); rr(ctx, cx + 2, 44, 18, 11, 4);
    ctx.fillRect(cx - 3, 48, 6, 2);
  }
  // Cap.
  if (eq.accessories.indexOf('cap') !== -1) {
    ctx.fillStyle = '#2e4a6b';
    ctx.beginPath(); ctx.arc(cx, 42, 27, Math.PI, 0); ctx.fill();
    rr(ctx, cx - 4, 32, 34, 8, 4);
  }
  // Smile.
  ctx.strokeStyle = '#7a4a2a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, 62, 8, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  const cap = document.getElementById('lookCaption');
  if (cap) {
    const acc = eq.accessories.map(a => (ITEM_BY_ID[a] || {}).name).filter(Boolean);
    cap.textContent = 'Wearing: ' + outfit.name + (acc.length ? ' + ' + acc.join(', ') : '') + '  •  Car: ' + (ITEM_BY_ID[eq.car] || {}).name;
  }
}
function drawCarPreview(cv) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const car = getEquippedCarDef();
  const cy = H / 2 + 20;
  // Ground.
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(14, cy + 34, W - 28, 4);
  ctx.fillStyle = '#3a3f44'; ctx.fillRect(14, cy + 38, W - 28, 3);
  // Body.
  ctx.fillStyle = car.color;
  rr(ctx, 28, cy - 8, W - 56, 34, 12);
  // Cabin + windows.
  ctx.fillStyle = car.color;
  rr(ctx, 62, cy - 34, W - 124, 30, 10);
  ctx.fillStyle = '#9fd8ff';
  rr(ctx, 70, cy - 30, 34, 20, 6); rr(ctx, 112, cy - 30, 34, 20, 6);
  // BMW kidney grille.
  if (car.id.indexOf('bmw') === 0) {
    ctx.fillStyle = '#111111';
    rr(ctx, W - 42, cy + 2, 6, 12, 3); rr(ctx, W - 33, cy + 2, 6, 12, 3);
  }
  // Headlight and taillight.
  ctx.fillStyle = '#fff2c0'; ctx.fillRect(W - 32, cy + 2, 6, 6);
  ctx.fillStyle = '#ff2a22'; ctx.fillRect(30, cy + 2, 6, 6);
  // Wheels.
  for (const wx of [62, W - 62]) {
    ctx.fillStyle = '#111111';
    ctx.beginPath(); ctx.arc(wx, cy + 28, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9aa5ad';
    ctx.beginPath(); ctx.arc(wx, cy + 28, 7, 0, Math.PI * 2); ctx.fill();
  }
  const cap = document.getElementById('lookCaption');
  if (cap) cap.textContent = 'Your car: ' + car.name + ' - ' + car.desc + '. Drive it on the city map.';
}
function drawPreview() {
  const cv = document.getElementById('lookCanvas');
  if (!cv) return;
  if (storeTab === 'cars') drawCarPreview(cv); else drawLook(cv);
}

// ---------- Store overlay ----------
let storeTab = 'clothes';
let storeOnClose = null;
let storeBuilt = false;

function storeMsg(msg) {
  const el = document.getElementById('storeMsg');
  if (el) el.textContent = msg || '';
}
function renderStoreItems() {
  const box = document.getElementById('storeItems');
  if (!box) return;
  const eq = getEquipped();
  const items = STORE_ITEMS[storeTab] || [];
  box.innerHTML = '';
  for (const it of items) {
    const owned = isOwned(it.id);
    const isEq = storeTab === 'clothes' ? eq.clothes === it.id : storeTab === 'cars' ? eq.car === it.id : eq.accessories.indexOf(it.id) !== -1;
    const card = document.createElement('div');
    card.className = 'store-item';
    const swatch = storeTab === 'cars' ? '' : '<span class="store-swatch" style="background:' + it.color + '"></span>';
    card.innerHTML = '<div class="store-item-name">' + swatch + it.name + '</div>'
      + '<div class="store-item-desc">' + it.desc + '</div>'
      + '<div class="store-item-price">' + (it.price === 0 ? 'Free' : moneyFmt(it.price)) + '</div>';
    const btn = document.createElement('button');
    btn.type = 'button';
    if (!owned) {
      btn.textContent = 'Buy ' + (it.price === 0 ? 'Free' : moneyFmt(it.price));
      btn.onclick = () => { if (buyItem(it.id)) { renderStoreItems(); drawPreview(); updateWalletHUD(); } else { renderStoreItems(); } };
    } else if (storeTab === 'accessories') {
      btn.textContent = isEq ? 'Unequip' : 'Wear';
      btn.onclick = () => { toggleAccessory(it.id); renderStoreItems(); };
    } else if (isEq) {
      btn.textContent = 'Equipped';
      btn.disabled = true;
    } else {
      btn.textContent = 'Equip';
      btn.onclick = () => { equipItem(it.id); renderStoreItems(); };
    }
    card.appendChild(btn);
    box.appendChild(card);
  }
  document.querySelectorAll('#storeOverlay .store-tabs button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === storeTab);
  });
  updateWalletHUD();
  drawPreview();
}
function buildStore() {
  if (storeBuilt) return;
  storeBuilt = true;
  const ov = document.createElement('div');
  ov.id = 'storeOverlay';
  ov.className = 'hidden';
  ov.innerHTML = '<div class="store-panel">'
    + '<div class="store-head"><span>STORE</span><span id="storeBalance"></span><button id="storeClose" type="button">Close</button></div>'
    + '<div class="store-tabs">'
    + '<button type="button" data-tab="clothes">Clothes</button>'
    + '<button type="button" data-tab="cars">Cars</button>'
    + '<button type="button" data-tab="accessories">Accessories</button>'
    + '</div>'
    + '<div class="store-body">'
    + '<div class="store-look"><div class="store-look-label">Your look</div><canvas id="lookCanvas" width="220" height="320"></canvas><div id="lookCaption"></div></div>'
    + '<div id="storeItems" class="store-items"></div>'
    + '</div>'
    + '<div id="storeMsg" class="store-msg"></div>'
    + '</div>';
  document.body.appendChild(ov);
  document.getElementById('storeClose').onclick = () => closeStore();
  document.querySelectorAll('#storeOverlay .store-tabs button').forEach(b => {
    b.onclick = () => { storeTab = b.dataset.tab; storeMsg(''); renderStoreItems(); };
  });
}
export function openStore(tab, onClose) {
  buildStore();
  if (tab) storeTab = tab;
  storeOnClose = onClose || null;
  storeMsg('');
  renderStoreItems();
  document.getElementById('storeOverlay').classList.remove('hidden');
}
export function closeStore() {
  const ov = document.getElementById('storeOverlay');
  if (ov) ov.classList.add('hidden');
  const cb = storeOnClose; storeOnClose = null;
  if (cb) cb();
}
export function isStoreOpen() {
  const ov = document.getElementById('storeOverlay');
  return !!ov && !ov.classList.contains('hidden');
}

// Wire the HUD Store button and the B key. Called once from acts.js on boot.
export function initEconomy() {
  buildStore();
  updateWalletHUD();
  grantRetroactivePayouts();
  const btn = document.getElementById('storeBtn');
  if (btn) btn.onclick = () => openStore('clothes');
  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'b') return;
    if (window.__lsTravelActive || window.__lsHomeActive) return;
    const map = document.getElementById('travelMap');
    if (map && map.style.display !== 'none') return;
    const end = document.getElementById('endCard');
    if (end && !end.classList.contains('hidden') && !isStoreOpen()) return;
    if (isStoreOpen()) closeStore(); else openStore('clothes');
  });
}
