// The two observation monitors.
//   right (CH-2): live whole-brain activity, STRESS and CNS LOAD meters, circuit gauges, raster
//   left  (CH-1): what the subject sees, rendered as a compound-eye hex mosaic. Facets whose
//                 photoreceptors / optic-lobe neurons are blocked in the model go dark.
import * as THREE from 'three';
import { makeBrainMaterial, CLASS_COLORS } from '../brain.js';
import { t, getLang } from '../i18n.js';
import { FONT_UI } from './lab.js';

const W = 1024, H = 640;
const CLASS_NAMES = {
  ru: ['зрительные доли', 'центральный мозг', 'грибовидные тела', 'сенсорные', 'нисходящие', 'центр. комплекс', 'антеннальная доля', 'моторные'],
  en: ['optic lobes', 'central brain', 'mushroom bodies', 'sensory', 'descending', 'central complex', 'antennal lobe', 'motor'],
};

// shared GLSL: hex lattice + the per-facet mask (128 x 64: left eye | right eye)
export const EYE_GLSL = /* glsl */ `
  uniform sampler2D uMask;
  vec4 hexCoords(vec2 uv) {
    vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    return vec4(gv, uv - gv);
  }
  float hexDist(vec2 p) { p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  // cell: facet centre in eye disc coordinates (-1..1); e: 0 = left eye, 1 = right eye
  vec4 facetMask(vec2 cell, float e) {
    vec2 m = clamp(cell * 0.5 + 0.5, 0.0, 0.999);
    return texture2D(uMask, vec2((e + m.x) * 0.5, m.y));
  }
`;

const screenVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const screenFrag = /* glsl */ `
  uniform sampler2D uSrc;
  uniform sampler2D uOverlay;
  uniform float uTime;
  uniform float uPower;
  uniform int uMode;
  uniform float uGainEye;   // exposure for the dim chamber camera (1 for VR content)
  uniform float uAlert;     // red tint when the subject is in distress
  uniform float uGlitch;    // CNS overload: tearing
  uniform float uStatic;    // no signal
  uniform float uLaser;     // 532 nm glare on the left eye
  varying vec2 vUv;
  ${EYE_GLSL}

  vec3 eyes(vec2 uv) {
    vec2 p = vec2(uv.x * 1.6, uv.y);
    vec3 col = vec3(0.008, 0.009, 0.01);
    float e = step(0.8, p.x);   // which eye (no loop: keeps sampling in uniform control flow)
    vec2 c = vec2(mix(0.47, 1.13, e), 0.5);
    vec2 q = (p - c) / vec2(0.33, 0.37);
    float d = length(q);
    vec4 h = hexCoords(q * 15.0);
    vec2 cell = h.zw / 15.0;
    vec2 s = vec2(mix(0.31, 0.69, e) + cell.x * 0.31, 0.5 + cell.y * 0.47);
    vec3 src = texture2D(uSrc, clamp(s, 0.0, 1.0)).rgb;
    src = uGainEye > 1.0 ? pow(src * uGainEye, vec3(0.8)) : src;
    vec4 mk = facetMask(cell, e);
    float glare = uLaser * (1.0 - e) * exp(-dot(cell - vec2(-0.62, 0.3), cell - vec2(-0.62, 0.3)) * 3.5);
    src = mix(src, vec3(0.55, 1.0, 0.6) * 1.6, clamp(glare, 0.0, 1.0));
    src *= 1.0 - max(mk.r, mk.b * 0.92);
    src += vec3(1.0, 0.9, 0.7) * mk.g * (0.6 + 0.4 * hash(cell + uTime));
    float edge = smoothstep(0.38, 0.5, hexDist(h.xy));
    float shade = 1.0 - 0.5 * dot(cell, cell);
    vec3 inside = src * (1.0 - edge * 0.85) * shade + vec3(0.015, 0.02, 0.02) * edge;
    inside *= smoothstep(1.0, 0.93, d);
    return d < 1.0 ? inside : col;
  }

  void main() {
    vec2 c = vUv - 0.5;
    vec2 uv = 0.5 + c * (1.0 + 0.025 * dot(c, c));
    float band = floor(uv.y * 24.0 + floor(uTime * 13.0));
    uv.x += uGlitch * (hash(vec2(band, floor(uTime * 20.0))) - 0.5) * 0.08 * step(0.6, hash(vec2(band * 1.7, floor(uTime * 9.0))));
    vec3 col = uMode == 0 ? texture2D(uSrc, uv).rgb : eyes(uv);
    vec4 ov = texture2D(uOverlay, uv);
    col = mix(col, ov.rgb, ov.a);
    float n = hash(uv * 731.0 + uTime);
    col = mix(col, vec3(n * 0.6 + 0.05), uStatic * (0.75 + 0.25 * step(0.5, hash(vec2(floor(uv.y * 90.0), uTime)))));
    col *= 0.96 + 0.04 * sin(uv.y * 640.0 * 3.14159);
    col += (n - 0.5) * 0.015;
    col = mix(col, col * vec3(1.25, 0.5, 0.45) + vec3(0.05, 0.0, 0.0), uAlert * (0.6 + 0.4 * sin(uTime * 8.0)));
    col *= 0.5 + 0.5 * smoothstep(0.85, 0.3, length(c * vec2(1.0, 1.3)));
    float pb = smoothstep(0.0, 0.02, uPower * 0.55 - abs(uv.y - 0.5));
    col = col * pb * min(1.0, uPower * 1.2) + vec3(0.7, 0.8, 0.85) * (1.0 - pb) * step(abs(uv.y - 0.5), 0.004) * step(0.02, uPower);
    gl_FragColor = vec4(col * 1.08, 1.0);
  }
`;

function overlayCanvas() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  return { c, ctx: c.getContext('2d'), tex };
}

function screenMesh(src, overlay, mode, size, mask) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSrc: { value: src }, uOverlay: { value: overlay }, uTime: { value: 0 }, uPower: { value: 0 }, uMode: { value: mode },
      uGainEye: { value: 1 }, uAlert: { value: 0 }, uGlitch: { value: 0 }, uStatic: { value: 0 }, uLaser: { value: 0 }, uMask: { value: mask },
    },
    vertexShader: screenVert, fragmentShader: screenFrag, toneMapped: false,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), mat);
}

const AMBER = '#e2a64a', DIM = 'rgba(205,200,186,0.55)', INK = '#e8e4d8', RED = '#ff3b30';

export function createMonitors({ lab, brainGeo, fly, mask }) {
  // ---------- brain monitor ----------
  const brainRT = new THREE.WebGLRenderTarget(W, H);
  brainRT.texture.colorSpace = THREE.SRGBColorSpace;
  const brainScene = new THREE.Scene();
  brainScene.background = new THREE.Color(0x030304);
  const brainCam = new THREE.PerspectiveCamera(30, (W + 420) / H, 0.1, 50);
  brainCam.setViewOffset(W + 420, H, 420, 0, W, H);
  const brainMat = makeBrainMaterial({ size: 0.016, base: 0.2 });
  const brainSpin = new THREE.Group();
  brainSpin.add(new THREE.Points(brainGeo, brainMat));
  brainScene.add(brainSpin);
  const grid = new THREE.GridHelper(3.2, 16, 0x2a2824, 0x141311);
  grid.position.y = -0.62;
  brainScene.add(grid);

  const ovR = overlayCanvas();
  const right = screenMesh(brainRT.texture, ovR.tex, 0, lab.monitors.right.size, mask);
  lab.monitors.right.anchor.add(right);

  // ---------- eye monitor ----------
  const eyeRT = new THREE.WebGLRenderTarget(256, 256);
  eyeRT.texture.colorSpace = THREE.SRGBColorSpace;
  const eyeCam = new THREE.PerspectiveCamera(105, 1, 0.04, 80);
  eyeCam.layers.enable(1);   // sees the observer in the booth
  const ovL = overlayCanvas();
  const left = screenMesh(eyeRT.texture, ovL.tex, 1, lab.monitors.left.size, mask);
  lab.monitors.left.anchor.add(left);

  let frame = 0, lastOverlay = -1;
  const camPos = new THREE.Vector3(), camQuat = new THREE.Quaternion();
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

  function render(renderer, scene, now, vrTexture, { eyes = true } = {}) {
    frame++;
    brainMat.uniforms.uTime.value = now;
    brainMat.uniforms.uScale.value = H / 2;
    brainSpin.rotation.y = now * 0.12;
    brainCam.position.set(0, 0.55, 3.7);
    brainCam.lookAt(0, -0.05, 0);
    renderer.setRenderTarget(brainRT);
    renderer.render(brainScene, brainCam);
    if (vrTexture) {
      left.material.uniforms.uSrc.value = vrTexture;
      left.material.uniforms.uGainEye.value = 1;
    } else {
      left.material.uniforms.uSrc.value = eyeRT.texture;
      left.material.uniforms.uGainEye.value = 3.4;
      if (eyes && frame % 3 === 0) {
        fly.eyeAnchor.getWorldPosition(camPos);
        fly.eyeAnchor.getWorldQuaternion(camQuat);
        eyeCam.position.copy(camPos);
        eyeCam.quaternion.copy(camQuat).multiply(turn);
        eyeCam.rotateX(-0.08);
        fly.headParts.forEach((m) => { m.visible = false; });
        left.visible = false;              // the screen shows this very texture: avoid a feedback loop
        renderer.setRenderTarget(eyeRT);
        renderer.render(scene, eyeCam);
        left.visible = true;
        fly.headParts.forEach((m) => { m.visible = true; });
      }
    }
    renderer.setRenderTarget(null);
  }

  function update(dt, now, info) {
    for (const m of [left, right]) {
      const u = m.material.uniforms;
      u.uTime.value = now;
      u.uPower.value = info.power;
      u.uAlert.value = info.alert || 0;
      u.uGlitch.value = info.glitch || 0;
    }
    left.material.uniforms.uStatic.value = info.noSignal || 0;
    left.material.uniforms.uLaser.value = info.laser || 0;
    if (now - lastOverlay > 1 / 12) {
      lastOverlay = now;
      drawBrainOverlay(ovR.ctx, info);
      ovR.tex.needsUpdate = true;
      drawEyeOverlay(ovL.ctx, info);
      ovL.tex.needsUpdate = true;
    }
  }

  return { render, update, screens: { left, right }, brainMat, brainTexture: brainRT.texture, eyeTexture: eyeRT.texture };
}

function titleBar(ctx, chan, title, sub, live = true) {
  ctx.fillStyle = 'rgba(6,6,7,0.92)';
  ctx.fillRect(0, 0, W, 62);
  ctx.fillStyle = 'rgba(226,166,74,0.3)';
  ctx.fillRect(0, 62, W, 1);
  ctx.textBaseline = 'alphabetic';
  ctx.font = `500 18px ${FONT_UI}`;
  ctx.fillStyle = DIM;
  ctx.fillText(chan, 24, 25);
  ctx.font = `600 26px ${FONT_UI}`;
  ctx.fillStyle = INK;
  ctx.fillText(title, 24, 53);
  if (sub) {
    ctx.font = `500 16px ${FONT_UI}`;
    ctx.fillStyle = DIM;
    ctx.textAlign = 'right';
    ctx.fillText(sub, W - 24, 53);
    ctx.textAlign = 'left';
  }
  if (live) {
    ctx.fillStyle = Math.floor(performance.now() / 600) % 2 ? RED : 'rgba(255,59,48,0.3)';
    ctx.beginPath(); ctx.arc(W - 30, 20, 6, 0, Math.PI * 2); ctx.fill();
    ctx.font = `600 16px ${FONT_UI}`;
    ctx.fillStyle = INK;
    ctx.textAlign = 'right';
    ctx.fillText('REC', W - 44, 26);
    ctx.textAlign = 'left';
  }
}

function bar(ctx, x, y, w, h, v, color, segs = 40) {
  ctx.fillStyle = 'rgba(226,166,74,0.07)';
  ctx.fillRect(x, y, w, h);
  const n = Math.round(Math.min(1, Math.max(0, v)) * segs);
  ctx.fillStyle = color;
  for (let s = 0; s < n; s++) ctx.fillRect(x + s * (w / segs), y, w / segs - 2, h);
}

function drawBrainOverlay(ctx, info) {
  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  titleBar(ctx, 'CH-2 · CNS · FLYWIRE v783', t('mon_brain'), info.aliveText || t('mon_brain_sub'), false);

  const names = CLASS_NAMES[getLang()];
  ctx.font = `500 14px ${FONT_UI}`;
  names.forEach((nm, i) => {
    const x = 26 + (i % 2) * 280, y = 440 + Math.floor(i / 2) * 21;
    ctx.fillStyle = '#' + CLASS_COLORS[i].toString(16).padStart(6, '0');
    ctx.fillRect(x, y - 10, 10, 10);
    ctx.fillStyle = DIM;
    ctx.fillText(nm, x + 16, y);
  });

  // right column
  const gx = 626, gw = 374;
  ctx.fillStyle = 'rgba(5,5,6,0.88)';
  ctx.fillRect(gx - 16, 63, W - gx + 16, H - 63);
  ctx.fillStyle = 'rgba(226,166,74,0.22)';
  ctx.fillRect(gx - 16, 63, 1, H - 63);

  // STRESS
  const st = info.stress;
  ctx.font = `600 26px ${FONT_UI}`;
  ctx.fillStyle = RED;
  ctx.fillText(t('g_stress'), gx, 98);
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(st.value * 100)}%`, gx + gw, 98);
  ctx.textAlign = 'left';
  ctx.font = `500 12px ${FONT_UI}`;
  ctx.fillStyle = 'rgba(255,170,160,0.7)';
  ctx.fillText(t('g_stress_d'), gx, 116);
  bar(ctx, gx, 123, gw, 20, st.value, st.value > 0.66 ? '#ff2a1a' : st.value > 0.33 ? '#e24a32' : '#a8372a', 30);

  // CNS LOAD
  const ld = info.load;
  const lc = ld.value > 1 ? RED : ld.value > 0.7 ? '#ff8a2a' : AMBER;
  ctx.font = `600 20px ${FONT_UI}`;
  ctx.fillStyle = lc;
  ctx.fillText(t('g_load'), gx, 172);
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(ld.value * 100)}%`, gx + gw, 172);
  ctx.textAlign = 'left';
  ctx.font = `500 12px ${FONT_UI}`;
  ctx.fillStyle = DIM;
  ctx.fillText(t('g_load_d'), gx, 189);
  bar(ctx, gx, 195, gw, 12, Math.min(1, ld.value / 1.5), lc, 30);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(gx + gw / 1.5, 192, 2, 18);   // 100 % mark

  info.gauges.forEach((g, i) => {
    const y = 226 + i * 57;
    ctx.font = `600 19px ${FONT_UI}`;
    ctx.fillStyle = g.value > 0.66 ? RED : g.value > 0.12 ? AMBER : INK;
    ctx.fillText(t(g.label), gx, y + 16);
    ctx.textAlign = 'right';
    ctx.fillStyle = INK;
    ctx.fillText(g.text, gx + gw, y + 16);
    ctx.textAlign = 'left';
    ctx.font = `500 12px ${FONT_UI}`;
    ctx.fillStyle = DIM;
    ctx.fillText(t(g.desc), gx, y + 32);
    bar(ctx, gx, y + 38, gw, 9, g.value, g.value > 0.66 ? RED : AMBER);
  });

  // raster
  const rx = 26, ry = 528, rw = 560, rh = 98;
  ctx.font = `500 14px ${FONT_UI}`;
  ctx.fillStyle = DIM;
  ctx.fillText(`${t('raster')} · 2 s`, rx, ry - 9);
  ctx.strokeStyle = 'rgba(226,166,74,0.2)';
  ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
  const rows = info.raster.rows;
  const now = info.raster.now;
  rows.forEach((row, i) => {
    const y0 = ry + 4 + i * (rh - 8) / rows.length;
    const hh = (rh - 8) / rows.length - 2;
    ctx.fillStyle = row.color;
    const ts = row.times;
    for (let k = 0; k < ts.length; k++) {
      const age = now - ts[k];
      if (age > 2000 || age < 0) continue;
      ctx.fillRect(rx + rw - (age / 2000) * rw, y0, 2, hh);
    }
  });
  if (info.flat) {
    // flat line across the raster
    ctx.strokeStyle = RED; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(rx, ry + rh / 2); ctx.lineTo(rx + rw, ry + rh / 2); ctx.stroke();
  }

  if (info.banner) {
    ctx.fillStyle = Math.floor(info.now * 2) % 2 ? RED : 'rgba(255,59,48,0.35)';
    ctx.font = `700 21px ${FONT_UI}`;
    ctx.fillText(info.banner, 26, 98);
  }
}

function drawEyeOverlay(ctx, info) {
  ctx.clearRect(0, 0, W, H);
  const e = info.eye;
  titleBar(ctx, 'CH-1 · OPTIC · 2 × ~780 OMMATIDIA', t('mon_eye'),
    e.vr ? `${t('mon_vr')}: ${t(e.vr === 'loom' ? 'exp_loom' : 'exp_images').replace(/^VR:\s*/, '')}` : t('mon_cam'));
  ctx.font = `600 20px ${FONT_UI}`;
  ctx.fillStyle = INK;
  ctx.fillText('L', 294, 612);
  ctx.fillText('R', 717, 612);
  ctx.font = `500 16px ${FONT_UI}`;
  ctx.fillStyle = DIM;
  ctx.fillText(`${t('mon_photo')}  L ${e.rateL.toFixed(0)} · R ${e.rateR.toFixed(0)} Hz`, 24, 92);
  if (e.loom > 0) { ctx.fillStyle = RED; ctx.fillText(`LPLC2 / LC4  ${e.loom.toFixed(0)} Hz`, 24, 116); }
  if (e.burned > 0) { ctx.fillStyle = RED; ctx.fillText(`${t('mon_burned')}: ${e.burned}`, 24, 140); }
  for (const [x, r] of [[160, e.rateL], [583, e.rateR]]) bar(ctx, x, 620, 280, 8, r / 60, AMBER, 28);
  if (info.noSignal > 0.5) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(W / 2 - 200, H / 2 - 34, 400, 68);
    ctx.font = `700 30px ${FONT_UI}`;
    ctx.fillStyle = Math.floor(info.now * 1.5) % 2 ? INK : RED;
    ctx.textAlign = 'center';
    ctx.fillText(t('mon_nosignal'), W / 2, H / 2 + 11);
    ctx.textAlign = 'left';
  }
}
