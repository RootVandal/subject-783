// Procedural canvas textures: no external image assets.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// tileable value noise
function makeNoise(size, seed) {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const grid = new Float32Array(size * size).map(rnd);
  const at = (x, y) => grid[((y % size + size) % size) * size + ((x % size + size) % size)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function fbm(noises, x, y, period) {
  let v = 0, amp = 0.5, f = 1;
  for (const n of noises) {
    v += amp * n((x * f * period) , (y * f * period));
    amp *= 0.5; f *= 2;
  }
  return v;
}

const cache = new Map();
function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

// Concrete: albedo + roughness in one go. Optional seams (formwork panel lines).
export function concrete({ size = 512, tint = [118, 116, 110], seams = 0, stains = 0.5, seed = 7 } = {}) {
  return cached(`concrete${size}${tint}${seams}${stains}${seed}`, () => {
    const [c, ctx] = canvas(size, size);
    const [rc, rctx] = canvas(size, size);
    const img = ctx.createImageData(size, size);
    const rimg = rctx.createImageData(size, size);
    const periods = [8, 16, 32, 64, 128];
    const noises = periods.map((p, i) => makeNoise(p, seed * 31 + i));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size;
        let n = 0, amp = 0.5;
        for (let i = 0; i < noises.length; i++) { n += amp * noises[i](u * periods[i], v * periods[i]); amp *= 0.55; }
        const stain = noises[0](u * 8 + 3.1, v * 8 + 7.7);
        let k = 0.78 + (n - 0.5) * 0.5 - Math.max(0, stain - 0.55) * stains * 0.9;
        // pores
        if (noises[4](u * 128 + 0.37, v * 128 + 0.91) > 0.93) k -= 0.18;
        if (seams) {
          const sx = (u * seams) % 1, sy = (v * seams) % 1;
          const edge = Math.min(sx, 1 - sx, sy, 1 - sy);
          if (edge < 0.004) k *= 0.62;
          else if (edge < 0.01) k *= 0.9;
        }
        const o = (y * size + x) * 4;
        img.data[o] = tint[0] * k; img.data[o + 1] = tint[1] * k; img.data[o + 2] = tint[2] * k; img.data[o + 3] = 255;
        const r = 200 + (n - 0.5) * 80 + (stain > 0.6 ? -40 : 0);
        rimg.data[o] = rimg.data[o + 1] = rimg.data[o + 2] = r; rimg.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    rctx.putImageData(rimg, 0, 0);
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    const rough = new THREE.CanvasTexture(rc);
    for (const t of [map, rough]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
    return { map, rough };
  });
}

// Brushed / worn painted metal
export function metal({ size = 256, tint = [70, 74, 72], seed = 3 } = {}) {
  return cached(`metal${size}${tint}${seed}`, () => {
    const [c, ctx] = canvas(size, size);
    const img = ctx.createImageData(size, size);
    const n1 = makeNoise(64, seed), n2 = makeNoise(16, seed + 1);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const streak = n1(u * 2, v * 64) * 0.25;
      const blot = n2(u * 16, v * 16);
      const k = 0.85 + streak - Math.max(0, blot - 0.62) * 0.8;
      const o = (y * size + x) * 4;
      img.data[o] = tint[0] * k; img.data[o + 1] = tint[1] * k; img.data[o + 2] = tint[2] * k; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

// Compound eye: hexagonal facets (albedo + bump)
export function compoundEye() {
  return cached('eye', () => {
    const W = 1024, H = 512;
    const [c, ctx] = canvas(W, H);
    const [bc, bctx] = canvas(W, H);
    ctx.fillStyle = '#5a0b07'; ctx.fillRect(0, 0, W, H);
    bctx.fillStyle = '#000'; bctx.fillRect(0, 0, W, H);
    const r = 7.2, dx = r * Math.sqrt(3), dy = r * 1.5;
    for (let row = 0, y = 0; y < H + r; row++, y += dy) {
      for (let x = (row % 2) * dx / 2; x < W + dx; x += dx) {
        const g = ctx.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, r);
        const hue = 4 + Math.random() * 6;
        g.addColorStop(0, `hsl(${hue},85%,${38 + Math.random() * 8}%)`);
        g.addColorStop(0.75, `hsl(${hue},90%,20%)`);
        g.addColorStop(1, '#250303');
        ctx.fillStyle = g;
        hex(ctx, x, y, r * 0.96);
        const bg = bctx.createRadialGradient(x, y, 0, x, y, r);
        bg.addColorStop(0, '#fff'); bg.addColorStop(0.8, '#999'); bg.addColorStop(1, '#000');
        bctx.fillStyle = bg;
        hex(bctx, x, y, r * 0.92);
      }
    }
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    const bump = new THREE.CanvasTexture(bc);
    for (const t of [map, bump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
    return { map, bump };
  });
}

function hex(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i + Math.PI / 6;
    ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  ctx.closePath();
  ctx.fill();
}

// Abdomen: tergite bands
export function abdomenBands() {
  return cached('abd', () => {
    const [c, ctx] = canvas(64, 512);
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#b38a55'); grad.addColorStop(1, '#8f6a3c');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 512);
    // dark posterior band on each segment (v=0 is the tip, v=1 the base)
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      const y0 = 512 * (0.06 + i * 0.145);
      const b = ctx.createLinearGradient(0, y0, 0, y0 + 46);
      b.addColorStop(0, 'rgba(20,12,6,0.0)');
      b.addColorStop(0.35, 'rgba(25,14,6,0.92)');
      b.addColorStop(1, 'rgba(25,14,6,0.0)');
      ctx.fillStyle = b; ctx.fillRect(0, y0, 64, 46);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

// Wing: alpha + vein pattern (Drosophila-like venation)
export function wing() {
  return cached('wing', () => {
    const W = 512, H = 192;
    const [c, ctx] = canvas(W, H);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    // wing blade
    ctx.beginPath();
    ctx.moveTo(6, H * 0.52);
    ctx.bezierCurveTo(W * 0.25, H * 0.06, W * 0.82, H * 0.02, W * 0.985, H * 0.42);
    ctx.bezierCurveTo(W * 1.0, H * 0.7, W * 0.7, H * 0.98, W * 0.35, H * 0.86);
    ctx.bezierCurveTo(W * 0.18, H * 0.8, W * 0.06, H * 0.66, 6, H * 0.52);
    ctx.closePath();
    ctx.fillStyle = 'rgba(210,220,230,0.32)';
    ctx.fill();
    ctx.clip();
    // veins L1..L5 + cross veins
    ctx.strokeStyle = 'rgba(70,50,30,0.95)';
    ctx.lineCap = 'round';
    const vein = (pts, w) => {
      ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 4) ctx.quadraticCurveTo(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
      ctx.stroke();
    };
    vein([6, H * 0.5, W * 0.3, H * 0.14, W * 0.62, H * 0.08], 4);          // costa / L1
    vein([10, H * 0.52, W * 0.5, H * 0.22, W * 0.9, H * 0.2], 2.6);        // L2
    vein([10, H * 0.54, W * 0.5, H * 0.4, W * 0.985, H * 0.42], 2.6);      // L3
    vein([10, H * 0.56, W * 0.5, H * 0.58, W * 0.93, H * 0.66], 2.4);      // L4
    vein([10, H * 0.6, W * 0.4, H * 0.74, W * 0.7, H * 0.9], 2.2);         // L5
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W * 0.38, H * 0.45); ctx.lineTo(W * 0.4, H * 0.58); ctx.stroke(); // anterior cross vein
    ctx.beginPath(); ctx.moveTo(W * 0.62, H * 0.6); ctx.lineTo(W * 0.6, H * 0.79); ctx.stroke(); // posterior cross vein
    // micro-hair shimmer
    for (let i = 0; i < 2200; i++) {
      ctx.fillStyle = `rgba(40,30,20,${Math.random() * 0.25})`;
      ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1);
    }
    ctx.restore();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

// Dirty glass: smudges and scratches (alpha only)
export function glassSmudge() {
  return cached('glass', () => {
    const W = 1024, H = 512;
    const [c, ctx] = canvas(W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * W, y = Math.random() * H, r = 20 + Math.random() * 120;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${0.04 + Math.random() * 0.07})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // finger prints near the bottom edge
    for (let i = 0; i < 9; i++) {
      const x = 80 + Math.random() * (W - 160), y = H * (0.72 + Math.random() * 0.22);
      ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.lineWidth = 1.2;
      for (let k = 1; k < 9; k++) { ctx.beginPath(); ctx.ellipse(x, y, k * 2.6, k * 3.4, 0.3, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.7;
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * W, y = Math.random() * H, l = 10 + Math.random() * 90, a = Math.random() * Math.PI;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

// Soft radial sprite (for light glows, odor puff)
export function softDot(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  return cached(`dot${inner}${outer}`, () => {
    const [c, ctx] = canvas(128, 128);
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, inner); g.addColorStop(1, outer);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

// Light cone gradient: bright at the top (v=1), fading downwards and at the rim
export function coneGradient() {
  return cached('cone', () => {
    const [c, ctx] = canvas(64, 256);
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(255,255,255,0.0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0.9)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 256);
    const t = new THREE.CanvasTexture(c);
    return t;
  });
}

export { fbm, makeNoise };
