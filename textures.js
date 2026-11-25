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
export function woodTex(rx, ry, base, dark, planks) {
  const b = base || '#6b4a2c', d = dark || '#4a3018', n = planks || 6;
  return makeTex(512, 512, (ctx, w, h) => {
    const rand = rng(51);
    ctx.fillStyle = b; ctx.fillRect(0, 0, w, h);
    const ph = h / n;
    for (let p = 0; p < n; p++) {
      const y = p * ph;
      ctx.fillStyle = shade(b, 0.9 + rand() * 0.2);
      ctx.fillRect(0, y, w, ph);
      ctx.strokeStyle = 'rgba(30,18,8,0.35)'; ctx.lineWidth = 1;
      for (let g = 0; g < 5; g++) {
        const gy = y + 4 + rand() * (ph - 8);
        ctx.beginPath(); ctx.moveTo(0, gy);
        for (let x = 0; x <= w; x += 32) ctx.lineTo(x, gy + Math.sin(x * 0.02 + g) * 2 + (rand() - 0.5) * 2);
        ctx.stroke();
      }
      ctx.fillStyle = d; ctx.fillRect(0, y, w, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(0, y + 2, w, 1);
      if (rand() < 0.6) {
        const kx = rand() * w, ky = y + ph / 2;
        ctx.strokeStyle = 'rgba(30,18,8,0.5)'; ctx.lineWidth = 2;
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

// Brushed steel: bright base with fine horizontal streaks and a soft
// diagonal highlight. Rails, fire escape, tripod legs, barriers.
export function steelTex(rx, ry, base) {
  const b = base || '#9aa2a8';
  return makeTex(256, 256, (ctx, w, h) => {
    const rand = rng(83);
    ctx.fillStyle = b; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 180; i++) {
      ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)';
      ctx.fillRect(0, rand() * h, w, 1);
    }
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, rx, ry);
}

// Window glass: dark blue-grey with diagonal reflection streaks. Used
// with a standard material at low roughness; the streaks keep a pane
// from reading as a flat black slab.
export function glassTex(rx, ry) {
  return makeTex(256, 256, (ctx, w, h) => {
    const rand = rng(97);
    ctx.fillStyle = '#0e1a24'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = 'rgba(180,210,235,' + (0.10 + rand() * 0.08) + ')';
      ctx.beginPath();
      const x0 = rand() * w;
      ctx.moveTo(x0, 0); ctx.lineTo(x0 + 26, 0); ctx.lineTo(x0 - 60, h); ctx.lineTo(x0 - 86, h);
      ctx.closePath(); ctx.fill();
    }
    speckle(ctx, w, h, rand, 200, '#8aa8c0', '#05080c');
  }, rx, ry);
}

// Woven fabric: crosshatch weave over a dyed base. Flags, cot canvas,
// crowd clothing.
export function fabricTex(rx, ry, base) {
  const b = base || '#5a2a2a';
  return makeTex(256, 256, (ctx, w, h) => {
    const rand = rng(113);
    ctx.fillStyle = b; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    for (let x = 0; x < w; x += 3) ctx.fillRect(x, 0, 1, h);
    speckle(ctx, w, h, rand, 600, '#c8a0a0', '#1a0c0c');
  }, rx, ry);
}

// Carpet: dense short speckle in two close tones. Press hall floor.
export function carpetTex(rx, ry, base) {
  const b = base || '#3a2a3e';
  return makeTex(256, 256, (ctx, w, h) => {
    const rand = rng(127);
    ctx.fillStyle = b; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, rand, 6000, shade(b, 1.25), shade(b, 0.75));
  }, rx, ry);
}

// Plaster wall: warm off-white with soft blotches and faint vertical
// streaks. Interior walls that should read as painted plaster, not paint.
export function plasterTex(rx, ry, base) {
  const b = base || '#c9bfa9';
  return makeTex(256, 256, (ctx, w, h) => {
    const rand = rng(131);
    ctx.fillStyle = b; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 12; i++) {
      const x = rand() * w, y = rand() * h, r = 30 + rand() * 60;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      const light = rand() < 0.5;
      g.addColorStop(0, light ? 'rgba(255,255,255,0.06)' : 'rgba(60,50,40,0.06)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = 'rgba(60,50,40,0.04)';
      ctx.fillRect(rand() * w, 0, 1 + rand() * 2, h);
    }
    speckle(ctx, w, h, rand, 800, '#e8e0d0', '#8a7a62');
  }, rx, ry);
}

// Roof membrane: dark grey with gravel speckle and seam grid. The
// rooftop slab top.
export function roofTex(rx, ry, base) {
  const b = base || '#3a3d40';
  return makeTex(256, 256, (ctx, w, h) => {
    const rand = rng(149);
    ctx.fillStyle = b; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, rand, 2500, '#6a6e72', '#1c1e20');
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    for (let x = 0; x <= w; x += 64) ctx.fillRect(x, 0, 2, h);
    for (let y = 0; y <= h; y += 64) ctx.fillRect(0, y, w, 2);
    for (let i = 0; i < 4; i++) {
      const x = rand() * w, y = rand() * h, r = 25 + rand() * 40;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, 'rgba(20,20,22,0.12)'); g.addColorStop(1, 'rgba(20,20,22,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, rx, ry);
}

// Dark floor tiles: grout grid with per-tile tone jitter. Control room.
export function tileTex(rx, ry, base, grout, tiles) {
  const b = base || '#20242a', g = grout || '#3a4048', n = tiles || 4;
  return makeTex(256, 256, (ctx, w, h) => {
    const rand = rng(163);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const s = w / n;
    for (let ty = 0; ty < n; ty++) {
      for (let tx = 0; tx < n; tx++) {
        ctx.fillStyle = shade(b, 0.9 + rand() * 0.2);
        ctx.fillRect(tx * s + 2, ty * s + 2, s - 4, s - 4);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(tx * s + 2, ty * s + 2, s - 4, 2);
      }
    }
    speckle(ctx, w, h, rand, 900, '#4a5058', '#101216');
  }, rx, ry);
}
