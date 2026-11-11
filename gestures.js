// THE LAST SIGNAL - speaking gestures.
// The human models are static scans with no skeleton (breathing scale only),
// so there are no arm or hand gestures. Instead, while a character speaks,
// the whole model moves: a gentle speaking bob, a small nod, a lean toward
// the listener, and a turn to face the listener. Listeners turn toward the
// speaker. All movement is position and rotation on the model group only,
// eased in and out, and it never touches story, choices, puzzles or gameplay.
// If a speaker has no model in the current scene (Radio, System), there is
// simply no gesture. Everything here is guarded: a missing or hidden model
// is skipped, and the game plays exactly as before if this module is unused.
// The rest pose is re-learned if a model is moved by other code (Act III
// re-parents Jade and Caleb between chapter groups), so a model never snaps
// back to an old spot.

const GESTURE_PROFILES = {
  // bob: speaking bounce height in model units (about 1 unit = 1 metre).
  // nod: forward head tilt in radians. lean: step toward the listener in
  // model units. rate: how fast the bob and nod pulse. turn: how far the
  // speaker turns to face the listener (0 = stay put, 1 = face them fully).
  jade:    { bob: 0.02,  nod: 0.05, lean: 0.08, rate: 1.0,  turn: 0.7 },
  caleb:   { bob: 0.025, nod: 0.07, lean: 0.10, rate: 1.15, turn: 0.7 },
  nurse:   { bob: 0.015, nod: 0.04, lean: 0.05, rate: 0.9,  turn: 0.7 },
  walter:  { bob: 0.008, nod: 0.03, lean: 0.0,  rate: 0.8,  turn: 0.3 },
  derrick: { bob: 0.012, nod: 0.04, lean: 0.09, rate: 0.8,  turn: 0.7 },
  guard1:  { bob: 0.01,  nod: 0.02, lean: 0.0,  rate: 0.9,  turn: 0.5 },
  guard2:  { bob: 0.01,  nod: 0.02, lean: 0.0,  rate: 0.9,  turn: 0.5 },
  judge:   { bob: 0.008, nod: 0.05, lean: 0.04, rate: 0.8,  turn: 0.6 },
  owen:    { bob: 0.012, nod: 0.04, lean: 0.05, rate: 0.85, turn: 0.6 },
  ag:      { bob: 0.012, nod: 0.04, lean: 0.05, rate: 0.9,  turn: 0.6 },
  mta:     { bob: 0.015, nod: 0.03, lean: 0.04, rate: 1.1,  turn: 0.6 },
  leader:  { bob: 0.02,  nod: 0.06, lean: 0.08, rate: 1.0,  turn: 0.7 },
};
const DEFAULT_PROFILE = { bob: 0.015, nod: 0.04, lean: 0.05, rate: 1.0, turn: 0.6 };

// Map a dialogue speaker name (the `who` field) to a model key.
export function characterKey(who) {
  if (!who) return '';
  const w = String(who).toLowerCase();
  if (w.indexOf('jade') !== -1) return 'jade';
  if (w.indexOf('caleb') !== -1 || w.indexOf('bishop') !== -1) return 'caleb';
  if (w.indexOf('adeyemi') !== -1 || w.indexOf('nurse') !== -1) return 'nurse';
  if (w.indexOf('walter') !== -1) return 'walter';
  if (w.indexOf('derrick') !== -1 || w.indexOf('shaw') !== -1) return 'derrick';
  if (w.indexOf('guard 2') !== -1) return 'guard2';
  if (w.indexOf('guard') !== -1) return 'guard1';
  if (w.indexOf('judge') !== -1 || w.indexOf('ellsworth') !== -1) return 'judge';
  if (w.indexOf('owen') !== -1 || w.indexOf('marsh') !== -1) return 'owen';
  if (w.indexOf('attorney') !== -1) return 'ag';
  if (w.indexOf('mta') !== -1) return 'mta';
  if (w.indexOf('leader') !== -1) return 'leader';
  if (w.indexOf('radio') !== -1) return 'radio';
  if (w.indexOf('system') !== -1) return 'system';
  return (w.split(' ')[0] || '');
}

let registry = []; // { group, key, profile, restX, restY, restZ, restYaw, amount, listenAmount, applied, lastX, lastY, lastZ, lastYaw }
let activeKey = null;

// Register the act's humans (the `humans` array: { group, name, ... }).
// Call once, after the models have loaded and been placed.
export function registerHumans(humans) {
  registry = [];
  if (!humans || !humans.length) return;
  for (const h of humans) {
    if (!h || !h.group) continue;
    const key = h.name || '';
    registry.push({
      group: h.group,
      key,
      profile: GESTURE_PROFILES[key] || DEFAULT_PROFILE,
      restX: h.group.position.x,
      restY: h.group.position.y,
      restZ: h.group.position.z,
      restYaw: h.group.rotation.y,
      amount: 0,
      listenAmount: 0,
      applied: false,
      lastX: 0, lastY: 0, lastZ: 0, lastYaw: 0,
    });
  }
}

// The character with this dialogue name is now speaking. If they have no
// model in the scene, the gesture is simply skipped.
export function setSpeakingCharacter(who) {
  try {
    activeKey = characterKey(who) || null;
  } catch (e) { activeKey = null; }
}

export function clearSpeakingCharacter() {
  activeKey = null;
}

function isShown(group) {
  let o = group;
  while (o) {
    if (o.visible === false) return false;
    o = o.parent;
  }
  return true;
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Call once per frame from the act's animate loop, with the same time value
// the breathing animation uses. Never throws.
export function updateSpeakingGestures(t) {
  try {
    if (!registry.length) return;
    let speaker = null;
    if (activeKey) {
      for (const e of registry) if (e.key === activeKey) { speaker = e; break; }
    }
    for (const e of registry) {
      const g = e.group;
      if (!g) continue;
      // Outside move detection: if the group was moved by something other
      // than this module since the last frame (Act III re-parents Jade and
      // Caleb between chapter groups), adopt the new spot as the rest pose
      // and drop any gesture in progress, so the model never snaps back.
      if (e.applied) {
        const moved = Math.abs(g.position.x - e.lastX) > 0.05 || Math.abs(g.position.y - e.lastY) > 0.05 || Math.abs(g.position.z - e.lastZ) > 0.05 || Math.abs(g.rotation.y - e.lastYaw) > 0.05;
        if (moved) {
          e.restX = g.position.x; e.restY = g.position.y; e.restZ = g.position.z;
          e.restYaw = g.rotation.y;
          e.amount = 0; e.listenAmount = 0;
        }
      } else {
        // First frame for this human: take its current pose as the rest pose.
        e.restX = g.position.x; e.restY = g.position.y; e.restZ = g.position.z;
        e.restYaw = g.rotation.y;
      }
      const shown = isShown(g);
      const isSpeaker = speaker && e === speaker && shown;
      const isListener = speaker && e !== speaker && shown;
      const targetAmount = isSpeaker ? 1 : 0;
      const targetListen = isListener ? 1 : 0;
      e.amount += (targetAmount - e.amount) * 0.12;
      e.listenAmount += (targetListen - e.listenAmount) * 0.12;
      if (e.amount < 0.01) e.amount = 0;
      if (e.listenAmount < 0.01) e.listenAmount = 0;
      if (!shown) { e.applied = false; continue; }
      const p = e.profile;
      let x = e.restX, y = e.restY, z = e.restZ, yaw = e.restYaw, pitch = 0;
      if (e.amount > 0) {
        // Speaking bob and nod, pulsing while the line is up.
        y += p.bob * Math.sin(t * 6 * p.rate) * e.amount;
        pitch = p.nod * (0.5 + 0.5 * Math.sin(t * 5 * p.rate)) * e.amount;
        // Lean toward and turn to face the nearest other visible human.
        let best = null, bestD = Infinity;
        for (const o of registry) {
          if (o === e || !o.group || !isShown(o.group)) continue;
          const dx = o.group.position.x - e.restX, dz = o.group.position.z - e.restZ;
          const d = dx * dx + dz * dz;
          if (d < bestD) { bestD = d; best = o; }
        }
        if (best) {
          const dx = best.group.position.x - e.restX, dz = best.group.position.z - e.restZ;
          const len = Math.sqrt(dx * dx + dz * dz) || 1;
          x += (dx / len) * p.lean * e.amount;
          z += (dz / len) * p.lean * e.amount;
          yaw = lerpAngle(e.restYaw, Math.atan2(dx, dz), p.turn * e.amount);
        }
      }
      if (e.listenAmount > 0 && speaker) {
        // Listener turns toward the speaker.
        const dx = speaker.group.position.x - e.restX, dz = speaker.group.position.z - e.restZ;
        yaw = lerpAngle(yaw, Math.atan2(dx, dz), 0.8 * e.listenAmount);
      }
      g.position.set(x, y, z);
      g.rotation.y = yaw;
      g.rotation.x = pitch;
      e.lastX = x; e.lastY = y; e.lastZ = z; e.lastYaw = yaw;
      e.applied = true;
    }
  } catch (err) { /* gestures must never break the game */ }
}
