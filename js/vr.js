// What the VR goggles show the subject, plus the neural drive it implies.
//   loom:   classic looming stimulus (dark disc approaching at constant speed, r/v = 40 ms)
//           -> LPLC2 / LC4 loom detectors, while the disc is expanding fast
//   images: gratings, flicker, optic flow, a spider -> photoreceptors by per-eye brightness
import * as THREE from 'three';

const W = 512, H = 384;

export class VRStimulus {
  constructor() {
    this.c = document.createElement('canvas');
    this.c.width = W; this.c.height = H;
    this.ctx = this.c.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.small = document.createElement('canvas');
    this.small.width = 16; this.small.height = 12;
    this.sctx = this.small.getContext('2d', { willReadFrequently: true });
    this.program = null;
    this.t = 0;
    this.lum = [0, 0];
    this.dLum = [0, 0];
    this.loomDrive = 0;
    this.stars = Array.from({ length: 220 }, () => [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random()]);
  }

  start(program) { this.program = program; this.t = 0; }
  stop() { this.program = null; this.loomDrive = 0; }

  update(dt) {
    if (!this.program) return;
    this.t += dt;
    const ctx = this.ctx;
    if (this.program === 'loom') this.drawLoom(ctx);
    else this.drawImages(ctx);
    this.tex.needsUpdate = true;
    // brightness per eye (left / right half of the visual field)
    this.sctx.drawImage(this.c, 0, 0, 16, 12);
    const d = this.sctx.getImageData(0, 0, 16, 12).data;
    const sum = [0, 0];
    for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) {
      const o = (y * 16 + x) * 4;
      const l = (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255;
      if (x < 9) sum[0] += l / 108;     // eyes overlap in the middle
      if (x > 6) sum[1] += l / 108;
    }
    for (let e = 0; e < 2; e++) {
      this.dLum[e] = Math.abs(sum[e] - this.lum[e]) / Math.max(dt, 1 / 120);
      this.lum[e] = sum[e];
    }
  }

  // photoreceptor rate (Hz) for eye e: steady light + transients
  photoRate(e) {
    if (!this.program) return 0;
    return Math.min(60, 4 + 34 * this.lum[e] + 16 * Math.min(2, this.dLum[e]));
  }

  drawLoom(ctx) {
    const cycle = 3.4, T = this.t % cycle;
    const tc = 1.25;                 // time of collision within the cycle
    const rv = 0.04;                 // r/v (s)
    ctx.fillStyle = '#e9e7df';
    ctx.fillRect(0, 0, W, H);
    let theta = 0, dTheta = 0;
    if (T < tc) {
      const ttc = tc - T;
      theta = 2 * Math.atan(rv / ttc);                       // full angular size (rad)
      dTheta = 2 * rv / (ttc * ttc + rv * rv);               // rad/s
    } else if (T < tc + 0.7) theta = Math.PI;
    const deg = theta * 180 / Math.PI;
    if (theta > 0) {
      const r = Math.min(H * 1.2, (deg / 160) * H * 0.75);
      ctx.fillStyle = '#060606';
      ctx.beginPath(); ctx.arc(W * 0.52, H * 0.46, r, 0, Math.PI * 2); ctx.fill();
    }
    // LPLC2 / LC4 respond to fast expansion of large dark objects
    const k = smooth(12, 50, deg) * Math.min(1, dTheta / 4);
    this.loomDrive = T < tc ? k : Math.max(0, this.loomDrive - 0.08);
  }

  drawImages(ctx) {
    const seg = 2.6, n = 6;
    const i = Math.floor(this.t / seg) % n, tt = this.t % seg;
    this.loomDrive = 0;
    if (i === 0) {                               // drifting grating
      ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#efeee6';
      const p = 64, off = (tt * 140) % p;
      for (let x = -p; x < W + p; x += p) ctx.fillRect(x + off, 0, p / 2, H);
    } else if (i === 1) {                        // full-field flicker
      ctx.fillStyle = Math.floor(tt * 8) % 2 ? '#f4f2ea' : '#050505';
      ctx.fillRect(0, 0, W, H);
    } else if (i === 2) {                        // optic flow: stars rushing past
      ctx.fillStyle = '#020306'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#dfe8ff';
      for (const s of this.stars) {
        s[2] -= 0.012;
        if (s[2] <= 0.02) { s[0] = Math.random() * 2 - 1; s[1] = Math.random() * 2 - 1; s[2] = 1; }
        const x = W / 2 + (s[0] / s[2]) * W * 0.25, y = H / 2 + (s[1] / s[2]) * H * 0.25;
        const r = (1 - s[2]) * 4 + 0.6;
        ctx.fillRect(x, y, r, r);
      }
    } else if (i === 3) {                        // contrast-reversing checkerboard
      const inv = Math.floor(tt * 3) % 2;
      const q = 48;
      for (let y = 0; y < H; y += q) for (let x = 0; x < W; x += q) {
        ctx.fillStyle = ((x / q + y / q + inv) % 2) ? '#ecebe3' : '#080808';
        ctx.fillRect(x, y, q, q);
      }
    } else if (i === 4) {                        // sunrise
      const k = Math.min(1, tt / seg * 1.4);
      const g = ctx.createRadialGradient(W / 2, H * 1.1, 10, W / 2, H * 1.1, H * 1.4);
      g.addColorStop(0, `rgba(255,${200 + 40 * k},${120 + 100 * k},1)`);
      g.addColorStop(0.4 * k + 0.05, `rgba(255,140,60,${k})`);
      g.addColorStop(1, '#06070c');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    } else {                                     // a spider walks across
      ctx.fillStyle = '#d8d4c4'; ctx.fillRect(0, 0, W, H);
      const x = -60 + (tt / seg) * (W + 120), y = H * 0.55 + Math.sin(tt * 9) * 6;
      ctx.strokeStyle = '#0a0806'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      for (let l = 0; l < 8; l++) {
        const side = l < 4 ? -1 : 1, k = (l % 4) - 1.5;
        const ph = Math.sin(tt * 14 + l * 1.7) * 6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + k * 22 + ph, y + side * 46, x + k * 40 + ph, y + side * 70);
        ctx.stroke();
      }
      ctx.fillStyle = '#0a0806';
      ctx.beginPath(); ctx.ellipse(x - 14, y, 30, 24, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + 26, y, 16, 14, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
