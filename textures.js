// THE LAST SIGNAL - procedural surface textures.
// Canvas-generated textures, no image files, no downloads: the game stays
// vendored and offline, and building the set costs a few milliseconds at
// boot, inside the 30 s load budget. Every factory returns a fresh
// THREE.CanvasTexture with repeat wrapping and sRGB colorspace, ready for
// a MeshStandardMaterial map slot. Repeats are chosen per call site so
// features read at roughly real-world scale. A seeded RNG keeps the look
// identical on every load, so screenshots stay comparable between runs.
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function makeTex(w, h, draw, rx, ry) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx || 1, ry || 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function speckle(ctx, w, h, rand, n, light, dark) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = rand() < 0.5 ? light : dark;
    ctx.globalAlpha = 0.05 + rand() * 0.12;
    const s = 1 + rand() * 2;
    ctx.fillRect(rand() * w, rand() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

// Poured concrete: grey base, aggregate speckle, soft damp stains and a
// few hairline cracks. Floors, sidewalks, pillars, track bed.
export function concreteTex(rx, ry, base, dark) {
  const b = base || '#8f9296', d = dark || '#6f7276';
  return makeTex(256, 256, (ctx, w, h) => {
    const rand = rng(11);
    ctx.fillStyle = b; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, rand, 2500, '#b8bcc0', d);
    for (let i = 0; i < 6; i++) {
      const x = rand() * w, y = rand() * h, r = 20 + rand() * 50;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, 'rgba(40,40,44,0.10)'); g.addColorStop(1, 'rgba(40,40,44,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.strokeStyle = 'rgba(50,50,54,0.35)'; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      let x = rand() * w, y = rand() * h;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 0; s < 4; s++) { x += (rand() - 0.5) * 60; y += rand() * 40; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }, rx, ry);
}

// Asphalt: near-black with fine aggregate and faint patch rectangles.
// Roads, bridge deck, tyres.
export function asphaltTex(rx, ry, base) {
  const b = base || '#26292d';
  return makeTex(256, 256, (ctx, w, h) => {
    const rand = rng(23);
    ctx.fillStyle = b; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, rand, 4000, '#4a4e54', '#101214');
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = shade(b, rand() < 0.5 ? 1.15 : 0.85);
      ctx.globalAlpha = 0.25;
      ctx.fillRect(rand() * w * 0.7, rand() * h * 0.7, 40 + rand() * 80, 30 + rand() * 60);
    }
    ctx.globalAlpha = 1;
  }, rx, ry);
}

// Running-bond brick: mortar joints, per-brick tone jitter, top light and
// bottom shade on each brick so the courses read in low light.
export function brickTex(rx, ry, base, mortar) {
  const b = base || '#7a4636', m = mortar || '#a89a88';
  return makeTex(512, 512, (ctx, w, h) => {
    const rand = rng(37);
    ctx.fillStyle = m; ctx.fillRect(0, 0, w, h);
    const rows = 8, cols = 4, ch = h / rows, bw = w / cols;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) ? bw / 2 : 0;
      for (let c = -1; c < cols + 1; c++) {
        const x = c * bw + off, y = r * ch;
        ctx.fillStyle = shade(b, 0.85 + rand() * 0.3);
        ctx.fillRect(x + 2, y + 2, bw - 4, ch - 4);
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(x + 2, y + 2, bw - 4, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x + 2, y + ch - 4, bw - 4, 2);
      }
    }
    speckle(ctx, w, h, rand, 1200, '#c8b8a8', '#3a2a22');
  }, rx, ry);
}

// Wood planks: horizontal boards with grain strokes, board separators and
// the occasional knot. Floors, benches, pews, tables, crates, sleepers.
// The optional grain factor (default 1) scales the grain-stroke contrast:
// a desk top or sleeper seen up close needs grain 1.8 to read, while
// ordinary furniture reads at 1.
export function woodTex(rx, ry, base, dark, planks, grain) {
  const b = base || '#6b4a2c', d = dark || '#4a3018', n = planks || 6, g = grain || 1;
  return makeTex(512, 512, (ctx, w, h) => {
    const rand = rng(51);
    ctx.fillStyle = b; ctx.fillRect(0, 0, w, h);
    const ph = h / n;
    for (let p = 0; p < n; p++) {
      const y = p * ph;
      ctx.fillStyle = shade(b, 0.9 + rand() * 0.2);
      ctx.fillRect(0, y, w, ph);
      ctx.strokeStyle = 'rgba(30,18,8,' + Math.min(0.85, 0.35 * g).toFixed(2) + ')'; ctx.lineWidth = 1;
      for (let gg = 0; gg < 5; gg++) {
        const gy = y + 4 + rand() * (ph - 8);
        ctx.beginPath(); ctx.moveTo(0, gy);
        for (let x = 0; x <= w; x += 32) ctx.lineTo(x, gy + Math.sin(x * 0.02 + gg) * 2 + (rand() - 0.5) * 2);
        ctx.stroke();
      }
      ctx.fillStyle = d; ctx.fillRect(0, y, w, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(0, y + 2, w, 1);
      if (rand() < 0.6) {
        const kx = rand() * w, ky = y + ph / 2;
        ctx.strokeStyle = 'rgba(30,18,8,' + Math.min(0.85, 0.5 * g).toFixed(2) + ')'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(kx, ky, 7, 4, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(kx, ky, 3, 2, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
    speckle(ctx, w, h, rand, 800, '#c8a878', '#2a1a0c');
  }, rx, ry);
}

// Painted metal: base coat with fine vertical brushed streaks and two
// panel seams. Vehicle bodies, lamp poles, cabinets.
export function metalTex(rx, ry, base) {
  const b = base || '#5a6066';
  return makeTex(256, 256, (ctx, w, h) => {
    const rand = rng(67);
    ctx.fillStyle = b; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 140; i++) {
      ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
      ctx.fillRect(rand() * w, 0, 1, h);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, h * 0.33, w, 2); ctx.fillRect(0, h * 0.66, w, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, h * 0.33 + 2, w, 1); ctx.fillRect(0, h * 0.66 + 2, w, 1);
    speckle(ctx, w, h, rand, 500, '#c8ccd0', '#22262a');
  }, rx, ry);
}

// Glossy car paint: the highlight is baked into the texture, because
// with no env map in the scene a dark standard material goes flat
// black no matter how low the metalness is. A broad soft sky
// reflection across the upper half plus a crisp horizon line reads as
// glossy paint from rear and side views.
export function paintTex(rx, ry, base) {
  const b = base || '#33383f';
  return makeTex(256, 256, (ctx, w, h) => {
    const rand = rng(71);
    ctx.fillStyle = b; ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0.32)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.08)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.38)'; ctx.fillRect(0, h * 0.30, w, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(0, h * 0.30 + 3, w, 2);
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      ctx.fillRect(rand() * w, 0, 1, h);
    }
    speckle(ctx, w, h, rand, 400, '#c8ccd0', '#22262a');
  }, rx, ry);
}

// Brushed steel: bright base with fine horizontal streaks and a soft
// diagonal highlight. Rails, fire escape, tripod legs, barriers. The
// streaks are strong enough to read on a small mesh at a distance.
export function steelTex(rx, ry, base) {
  const b = base || '#9aa2a8';
  return makeTex(256, 256, (ctx, w, h) => {
    const rand = rng(83);
    ctx.fillStyle = b; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 240; i++) {
      ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)';
      ctx.fillRect(0, rand() * h, w, 1);
    }
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(0, rand() * h, w, 2);
    }
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, rx, ry);
}

// Window glass: dark blue-grey with strong diagonal reflection streaks
// and a sky band at the top. Used with a standard material at low
// roughness; the streaks keep a pane from reading as a flat black slab.
export function glassTex(rx, ry) {
  return makeTex(256, 256, (ctx, w, h) => {
    const rand = rng(97);
    ctx.fillStyle = '#1a2836'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = 'rgba(180,210,235,' + (0.20 + rand() * 0.12) + ')';
      ctx.beginPath();
      const x0 = rand() * w;
      ctx.moveTo(x0, 0); ctx.lineTo(x0 + 26, 0); ctx.lineTo(x0 - 60, h); ctx.lineTo(x0 - 86, h);
      ctx.closePath(); ctx.fill();
    }
    const g = ctx.createLinearGradient(0, 0, 0, h * 0.35);
    g.addColorStop(0, 'rgba(200,220,240,0.16)'); g.addColorStop(1, 'rgba(200,220,240,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h * 0.35);
    speckle(ctx, w, h, rand, 200, '#8aa8c0', '#05080c');
  }, rx, ry);
}

// Woven fabric: crosshatch weave over a dyed base, with dye variation
// and hanging folds. Flags, cot canvas, crowd clothing. The weave is
// coarse and high-contrast on purpose: on a small flag at a few metres
// a fine weave is sub-pixel and the cloth reads as a flat colour block.
// The large-scale blotches and fold bands are what read at distance.
// Fabric: strong large-scale variation (dye blotches, wide fold
// bands) so it reads as cloth at the distance the player actually
// sees it from. The old 2 px weave was sub-pixel at 10 m and the
// courtroom flags read as flat colour rectangles, and the hearing
// advances before anyone can walk up close - so the fabric must read
// from the gallery, not from a close-up that never happens. Optional
// emblem variant, drawn once per flag (call sites must use repeat
// 1,1 for emblems): 'stars' is a star canton, 'seal' is a gold ring
// emblem. A gold fringe at the bottom edge and a header band at the
// top frame the cloth.
export function fabricTex(rx, ry, base, variant) {
  const b = base || '#5a2a2a';
  return makeTex(256, 256, (ctx, w, h) => {
    const rand = rng(113);
    ctx.fillStyle = b; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      const x = rand() * w, y = rand() * h, r = 40 + rand() * 70;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, rand() < 0.5 ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.18)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Wide vertical fold bands: the large-scale light and shadow
    // that reads as draped cloth from across the room.
    for (let i = 0; i < 5; i++) {
      const x = (i + 0.5) * w / 5 + (rand() - 0.5) * 10;
      const g = ctx.createLinearGradient(x - 26, 0, x + 26, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, i % 2 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.24)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 26, 0, 52, h);
    }
    // Header band at the top, gold fringe at the bottom edge.
    ctx.fillStyle = shade(b, 0.55); ctx.fillRect(0, 0, w, 10);
    ctx.fillStyle = '#c8a83a'; ctx.fillRect(0, h - 14, w, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = 4; x < w; x += 8) ctx.fillRect(x, h - 14, 2, 14);
    if (variant === 'stars') {
      // Star canton in the upper hoist quarter: white stars on a
      // deeper blue field.
      ctx.fillStyle = shade(b, 0.7); ctx.fillRect(0, 10, w * 0.45, h * 0.5);
      ctx.fillStyle = '#f2f2f2';
      for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
        const sx = 14 + c * 22 + (r % 2 ? 11 : 0), sy = 26 + r * 28;
        ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (variant === 'seal') {
      // Gold ring emblem in the centre.
      ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(w / 2, h / 2 - 6, 42, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#d4af37';
      ctx.beginPath(); ctx.arc(w / 2, h / 2 - 6, 14, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 0; y < h; y += 2) ctx.fillRect(0, y, w, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    for (let x = 0; x < w; x += 2) ctx.fillRect(x, 0, 1, h);
    speckle(ctx, w, h, rand, 900, '#c8a0a0', '#1a0c0c');
  }, rx, ry);
}

// Carpet: large-scale tile pattern and long strong fibre strokes, so
// it reads as carpet at the distance the player sees the floor from.
// The old 2-3 px strokes at low alpha were sub-pixel at that distance
// and the floor read as mottled dark slab. Each canvas holds 4x4
// carpet tiles with per-tile tone variation and visible seams.
export function carpetTex(rx, ry, base) {
  const b = base || '#6b5648';
  return makeTex(256, 256, (ctx, w, h) => {
    const rand = rng(127);
    ctx.fillStyle = b; ctx.fillRect(0, 0, w, h);
    // Carpet tiles: 4x4 per canvas, alternating tone, dark seams.
    // The tone gap is deliberately wide: a long fibre layer sits on
    // top of the tiles, and a narrow gap gets buried under it.
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
      ctx.fillStyle = (tx + ty) % 2 ? shade(b, 1.3) : shade(b, 0.62);
      ctx.globalAlpha = 0.8;
      ctx.fillRect(tx * 64, ty * 64, 64, 64);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i <= 4; i++) {
      ctx.fillRect(i * 64 - 1, 0, 2, h);
      ctx.fillRect(0, i * 64 - 1, w, 2);
    }
    for (let i = 0; i < 6; i++) {
      const x = rand() * w, y = rand() * h, r = 40 + rand() * 60;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, rand() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Long fibre strokes in two contrasting tones, strong enough to
    // read: length 6-14 px, alpha 0.2-0.4.
    for (let i = 0; i < 6000; i++) {
      ctx.strokeStyle = rand() < 0.5 ? shade(b, 1.5) : shade(b, 0.55);
      ctx.globalAlpha = 0.2 + rand() * 0.2;
      ctx.lineWidth = 1;
      const x = rand() * w, y = rand() * h, a = rand() * Math.PI, l = 6 + rand() * 8;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, rx, ry);
}

// Plaster wall: warm off-white with soft blotches and faint vertical
// streaks. Interior walls that should read as painted plaster, not paint.
// The variation is deliberately strong: at 0.06 alpha the old blotches
// were invisible at a glance and the wall read as flat paint.
export function plasterTex(rx, ry, base) {
  const b = base || '#c9bfa9';
  return makeTex(256, 256, (ctx, w, h) => {
    const rand = rng(131);
    ctx.fillStyle = b; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 16; i++) {
      const x = rand() * w, y = rand() * h, r = 30 + rand() * 60;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      const light = rand() < 0.5;
      g.addColorStop(0, light ? 'rgba(255,255,255,0.12)' : 'rgba(60,50,40,0.12)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 4; i++) {
      const y = rand() * h;
      const g = ctx.createLinearGradient(0, y - 14, 0, y + 14);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, rand() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(60,50,40,0.05)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, y - 14, w, 28);
    }
    for (let i = 0; i < 28; i++) {
      ctx.fillStyle = 'rgba(60,50,40,0.08)';
      ctx.fillRect(rand() * w, 0, 1 + rand() * 2, h);
    }
    speckle(ctx, w, h, rand, 1200, '#e8e0d0', '#8a7a62');
  }, rx, ry);
}

// Roof membrane: dark grey with gravel speckle. The rooftop slab top.
// The old version's regular seam grid read as a dark tile floor; the
// grid is gone and the gravel is now thousands of visible stones in
// varied greys, large and bright enough to read at normal distance.
export function roofTex(rx, ry, base) {
  const b = base || '#3a3d40';
  return makeTex(256, 256, (ctx, w, h) => {
    const rand = rng(149);
    ctx.fillStyle = b; ctx.fillRect(0, 0, w, h);
    const tones = ['#6a6e72', '#55585c', '#7d8185', '#2c2e30', '#8a8e92', '#45484b'];
    for (let i = 0; i < 3800; i++) {
      ctx.fillStyle = tones[(rand() * tones.length) | 0];
      ctx.globalAlpha = 0.45 + rand() * 0.4;
      const r = 1 + rand() * 2.5;
      ctx.beginPath(); ctx.ellipse(rand() * w, rand() * h, r, r * (0.6 + rand() * 0.6), rand() * Math.PI, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 4; i++) {
      const x = rand() * w, y = rand() * h, r = 25 + rand() * 40;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, 'rgba(20,20,22,0.12)'); g.addColorStop(1, 'rgba(20,20,22,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    for (let x = 0; x <= w; x += 128) ctx.fillRect(x, 0, 2, h);
    for (let y = 0; y <= h; y += 128) ctx.fillRect(0, y, w, 2);
    speckle(ctx, w, h, rand, 1200, '#7a7e82', '#1c1e20');
  }, rx, ry);
}

// Floor tiles: a real checkerboard - tiles alternate between the base
// tone and a contrasting tone (default: the base lightened 1.8x), with
// grout joints and per-tile tone jitter. The old version used one tone
// for every tile, so the floor read as all-black with grey grout.
export function tileTex(rx, ry, base, grout, tiles, alt) {
  const b = base || '#20242a', g = grout || '#3a4048', n = tiles || 4, a = alt || shade(b, 1.8);
  return makeTex(256, 256, (ctx, w, h) => {
    const rand = rng(163);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const s = w / n;
    for (let ty = 0; ty < n; ty++) {
      for (let tx = 0; tx < n; tx++) {
        ctx.fillStyle = shade(((tx + ty) % 2 === 0) ? b : a, 0.9 + rand() * 0.2);
        ctx.fillRect(tx * s + 2, ty * s + 2, s - 4, s - 4);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(tx * s + 2, ty * s + 2, s - 4, 2);
      }
    }
    speckle(ctx, w, h, rand, 900, '#4a5058', '#101216');
  }, rx, ry);
}
