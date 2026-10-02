// The operator's console: a sloped steel panel with illuminated push-buttons (instanced),
// an emergency-stop mushroom (RESET) and two guarded switches under flip-up covers
// (FLIGHT, LETHAL INJECTION) with a toxin selector knob. Legends are printed on the panel
// and back-lit; they are redrawn when the language changes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYOUT, FONT_UI, textDecal } from './lab.js';
import * as TX from './textures.js';
import { t } from '../i18n.js';

export const BUTTONS = [
  { id: 'sugar', sec: 'feed', key: '1' },
  { id: 'bitter', sec: 'feed', key: '2' },
  { id: 'music', sec: 'sense', key: '3' },
  { id: 'wind', sec: 'sense', key: '4' },
  { id: 'tickle', sec: 'sense', key: '5' },
  { id: 'odor', sec: 'sense', key: '8', warn: true },
  { id: 'loom', sec: 'vision', key: '6' },
  { id: 'images', sec: 'vision', key: '7' },
  { id: 'light', sec: 'vision', key: '0' },
  { id: 'strobe', sec: 'vision', key: 'T', warn: true },
  { id: 'laser', sec: 'vision', key: 'L', warn: true },
  { id: 'shock', sec: 'body', key: '9', warn: true },
  { id: 'spin', sec: 'body', key: 'C', warn: true },
  { id: 'hypoxia', sec: 'body', key: 'N', warn: true },
  { id: 'scalpel', sec: 'body', key: 'V', warn: true },
];
const SECTIONS = ['feed', 'sense', 'vision', 'body'];

const PW = 2.5, PD = 0.5;          // panel width / depth (m)
const TEX_W = 3000, TEX_H = 600;   // 1200 px per metre
const PX = TEX_W / PW;
const BTN_Z = -0.035;               // button row (local z; +z is towards the operator)
const PITCH = 0.1, GAP = 0.07;
const X_RESET = -1.145, X_FLIGHT = 0.83, X_INJECT = 1.04, X_KNOB = 1.19;

export function buildConsole(scene) {
  const group = new THREE.Group();
  group.position.copy(LAYOUT.console);
  group.rotation.x = LAYOUT.consoleTilt;
  scene.add(group);

  // button x positions, grouped by section
  let x = -1.0;
  const xs = [];
  let prevSec = BUTTONS[0].sec;
  const secSpan = {};
  BUTTONS.forEach((b) => {
    if (b.sec !== prevSec) { x += GAP; prevSec = b.sec; }
    xs.push(x);
    const s = secSpan[b.sec] || (secSpan[b.sec] = [x, x]);
    s[1] = x;
    x += PITCH;
  });

  // ---- housing: a wedge under the sloped plate ----
  const half = PD / 2, sn = Math.sin(LAYOUT.consoleTilt), cs = Math.cos(LAYOUT.consoleTilt);
  const yBack = LAYOUT.console.y + half * sn, zBack = LAYOUT.console.z - half * cs;
  const yFront = LAYOUT.console.y - half * sn, zFront = LAYOUT.console.z + half * cs;
  const shape = new THREE.Shape();
  shape.moveTo(zFront + 0.01, 0.89); shape.lineTo(zFront + 0.01, yFront - 0.012);
  shape.lineTo(zBack, yBack - 0.012); shape.lineTo(zBack - 0.04, yBack - 0.03); shape.lineTo(zBack - 0.04, 0.89);
  const wedge = new THREE.ExtrudeGeometry(shape, { depth: PW + 0.06, bevelEnabled: false });
  wedge.rotateY(-Math.PI / 2);
  wedge.translate((PW + 0.06) / 2, 0, 0);
  const housingMat = new THREE.MeshStandardMaterial({ map: TX.metal({ tint: [30, 32, 33], seed: 31 }), metalness: 0.55, roughness: 0.5 });
  const housing = new THREE.Mesh(wedge, housingMat);
  housing.receiveShadow = true;
  scene.add(housing);

  // ---- the printed / back-lit plate ----
  const base = document.createElement('canvas'); base.width = TEX_W; base.height = TEX_H;
  const glow = document.createElement('canvas'); glow.width = TEX_W; glow.height = TEX_H;
  const baseTex = new THREE.CanvasTexture(base); baseTex.colorSpace = THREE.SRGBColorSpace; baseTex.anisotropy = 8;
  const glowTex = new THREE.CanvasTexture(glow); glowTex.colorSpace = THREE.SRGBColorSpace; glowTex.anisotropy = 8;
  const plateMat = new THREE.MeshStandardMaterial({
    map: baseTex, emissiveMap: glowTex, emissive: 0xe8dcc4, emissiveIntensity: 0.55, metalness: 0.45, roughness: 0.55,
  });
  const plateGeo = new THREE.BoxGeometry(PW, 0.012, PD);
  plateGeo.translate(0, -0.006, 0);
  const plate = new THREE.Mesh(plateGeo, [housingMat, housingMat, plateMat, housingMat, housingMat, housingMat]);
  plate.receiveShadow = true;
  group.add(plate);

  const toU = (lx) => (lx + PW / 2) * PX;
  const toV = (lz) => (lz + PD / 2) * PX;

  function drawPlate() {
    const c = base.getContext('2d'), g = glow.getContext('2d');
    // brushed graphite with wear
    c.fillStyle = '#1b1d1e'; c.fillRect(0, 0, TEX_W, TEX_H);
    for (let i = 0; i < 2600; i++) {
      c.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.05})`;
      c.fillRect(Math.random() * TEX_W, Math.random() * TEX_H, 30 + Math.random() * 200, 1);
    }
    for (let i = 0; i < 90; i++) {
      c.strokeStyle = `rgba(200,200,190,${0.03 + Math.random() * 0.06})`; c.lineWidth = 1;
      const x0 = Math.random() * TEX_W, y0 = Math.random() * TEX_H, a = Math.random() * Math.PI, l = 10 + Math.random() * 70;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + Math.cos(a) * l, y0 + Math.sin(a) * l); c.stroke();
    }
    g.fillStyle = '#000'; g.fillRect(0, 0, TEX_W, TEX_H);
    const both = (fn) => { fn(c, false); fn(g, true); };
    const font = (w, px) => `${w} ${px}px ${FONT_UI}`;
    // screws
    for (const [sx, sy] of [[30, 30], [TEX_W - 30, 30], [30, TEX_H - 30], [TEX_W - 30, TEX_H - 30], [TEX_W / 2, 30], [TEX_W / 2, TEX_H - 30]]) {
      c.fillStyle = '#4a4d4f'; c.beginPath(); c.arc(sx, sy, 10, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#151617'; c.lineWidth = 3; c.beginPath(); c.moveTo(sx - 7, sy); c.lineTo(sx + 7, sy); c.stroke();
    }
    // section frames + titles
    SECTIONS.forEach((sec) => {
      const [a, b] = secSpan[sec];
      const x0 = toU(a - PITCH / 2 + 0.008), x1 = toU(b + PITCH / 2 - 0.008);
      const y0 = toV(-0.2), y1 = toV(0.17);
      c.strokeStyle = 'rgba(190,186,172,0.35)'; c.lineWidth = 2;
      c.strokeRect(x0, y0, x1 - x0, y1 - y0);
      both((ctx, lit) => {
        ctx.fillStyle = lit ? '#000' : '#1b1d1e';
        ctx.font = font(600, 24);
        const label = t(`sec_${sec}`);
        const w = ctx.measureText(label).width + 20;
        ctx.fillStyle = lit ? '#000' : '#1b1d1e';
        ctx.fillRect(x0 + 16, y0 - 16, w, 30);
        ctx.fillStyle = lit ? 'rgba(150,145,130,0.65)' : '#b5b0a2';
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.fillText(label, x0 + 26, y0);
      });
    });
    // per-button legends
    BUTTONS.forEach((b, i) => {
      const cx = toU(xs[i]), top = toV(BTN_Z + 0.062);
      c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 4;
      const bw = 0.088 * PX;
      c.strokeRect(cx - bw / 2, toV(BTN_Z) - bw / 2, bw, bw);
      both((ctx, lit) => {
        const text = t(`btn_${b.id}`);
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        let size = 23;
        ctx.font = font(600, size);
        const maxW = PITCH * PX - 10;
        let lines = [text];
        if (ctx.measureText(text).width > maxW && text.includes(' ')) {
          const k = text.indexOf(' ');
          lines = [text.slice(0, k), text.slice(k + 1)];
        }
        while (Math.max(...lines.map((l) => ctx.measureText(l).width)) > maxW && size > 14) { size--; ctx.font = font(600, size); }
        ctx.fillStyle = lit ? (b.warn ? 'rgba(255,90,70,0.9)' : 'rgba(235,228,210,0.85)') : (b.warn ? '#c8463a' : '#d8d2c2');
        lines.forEach((l, k) => ctx.fillText(l, cx, top + k * (size + 3)));
        ctx.font = font(500, 18);
        ctx.fillStyle = lit ? 'rgba(160,155,140,0.55)' : '#7e7a70';
        ctx.fillText(`[${b.key}]`, cx, top + lines.length * (size + 3) + 4);
      });
    });
    // RESET: yellow disc printed under the mushroom
    c.fillStyle = '#b89000'; c.beginPath(); c.arc(toU(X_RESET), toV(BTN_Z), 0.07 * PX, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#121110'; c.font = font(700, 14); c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let k = 0; k < 18; k++) {
      const a = k / 18 * Math.PI * 2;
      c.save(); c.translate(toU(X_RESET) + Math.cos(a) * 0.062 * PX, toV(BTN_Z) + Math.sin(a) * 0.062 * PX); c.rotate(a + Math.PI / 2);
      c.fillText(k % 2 ? '·' : 'STOP', 0, 0); c.restore();
    }
    both((ctx, lit) => {
      ctx.font = font(700, 23); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = lit ? 'rgba(240,200,60,0.75)' : '#d6b21c';
      ctx.fillText(t('btn_reset'), toU(X_RESET), toV(BTN_Z + 0.085));
      ctx.font = font(500, 18); ctx.fillStyle = lit ? 'rgba(160,155,140,0.55)' : '#7e7a70';
      ctx.fillText('[R]', toU(X_RESET), toV(BTN_Z + 0.085) + 28);
    });
    // critical section frame
    const cx0 = toU(X_FLIGHT - 0.1), cx1 = toU(X_KNOB + 0.05);
    c.strokeStyle = 'rgba(200,60,40,0.55)'; c.lineWidth = 2;
    c.strokeRect(cx0, toV(-0.2), cx1 - cx0, toV(0.17) - toV(-0.2));
    both((ctx, lit) => {
      ctx.font = font(600, 24); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const label = t('sec_crit');
      const w = ctx.measureText(label).width + 20;
      ctx.fillStyle = lit ? '#000' : '#1b1d1e'; ctx.fillRect(cx0 + 16, toV(-0.2) - 16, w, 30);
      ctx.fillStyle = lit ? 'rgba(255,80,60,0.75)' : '#c8463a';
      ctx.fillText(label, cx0 + 26, toV(-0.2));
    });
    for (const [bx, key, lab] of [[X_FLIGHT, 'F', 'flight_btn'], [X_INJECT, 'K', 'btn_inject']]) {
      both((ctx, lit) => {
        ctx.font = font(700, 22); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillStyle = lit ? 'rgba(255,90,70,0.9)' : '#e0e0d6';
        const txt = t(lab);
        const parts = txt.includes(' ') && ctx.measureText(txt).width > 0.2 * PX ? [txt.slice(0, txt.indexOf(' ')), txt.slice(txt.indexOf(' ') + 1)] : [txt];
        parts.forEach((p, k) => ctx.fillText(p, toU(bx), toV(BTN_Z + 0.098) + k * 25));
        ctx.font = font(500, 18); ctx.fillStyle = lit ? 'rgba(160,155,140,0.55)' : '#7e7a70';
        ctx.fillText(`[${key}]`, toU(bx), toV(BTN_Z + 0.098) + parts.length * 25 + 2);
      });
    }
    // knob scale
    const kx = toU(X_KNOB), ky = toV(BTN_Z);
    both((ctx, lit) => {
      ctx.font = font(700, 20); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = lit ? 'rgba(160,230,255,0.7)' : '#9fd4e8';
      ctx.fillText('TTX', kx - 0.042 * PX, ky - 0.06 * PX);
      ctx.fillStyle = lit ? 'rgba(200,255,120,0.7)' : '#b8e070';
      ctx.fillText('NEO', kx + 0.042 * PX, ky - 0.06 * PX);
      ctx.font = font(600, 18); ctx.fillStyle = lit ? 'rgba(160,155,140,0.55)' : '#8a867c';
      ctx.fillText(t('btn_toxin'), kx, ky + 0.07 * PX);
      ctx.fillText('[J]', kx, ky + 0.07 * PX + 24);
    });
    c.strokeStyle = '#a8a496'; c.lineWidth = 3;
    for (const a of [-0.65, 0.65]) {
      c.beginPath(); c.moveTo(kx + Math.sin(a) * 0.036 * PX, ky - Math.cos(a) * 0.036 * PX);
      c.lineTo(kx + Math.sin(a) * 0.05 * PX, ky - Math.cos(a) * 0.05 * PX); c.stroke();
    }
    // maker's plate
    c.font = font(500, 16); c.fillStyle = '#6d6a62'; c.textAlign = 'left'; c.textBaseline = 'bottom';
    c.fillText('PULT-783 · SER. 0447 · 24 V DC · НЕ ОСТАВЛЯТЬ БЕЗ НАДЗОРА', 60, TEX_H - 18);
    baseTex.needsUpdate = true; glowTex.needsUpdate = true;
  }

  // ---- push-buttons (instanced: bezels, caps, lenses) ----
  const n = BUTTONS.length;
  const frame = [];
  const fw = 0.088, ft = 0.008;
  for (const [w, d, ox, oz] of [[fw, ft, 0, -(fw - ft) / 2], [fw, ft, 0, (fw - ft) / 2], [ft, fw, -(fw - ft) / 2, 0], [ft, fw, (fw - ft) / 2, 0]]) {
    const g = new THREE.BoxGeometry(w, 0.014, d); g.translate(ox, 0.007, oz); frame.push(g);
  }
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, metalness: 0.8, roughness: 0.35 });
  const bezels = new THREE.InstancedMesh(mergeGeometries(frame), bezelMat, n);
  const capGeo = new THREE.BoxGeometry(0.068, 0.026, 0.068); capGeo.translate(0, 0.013, 0);
  const caps = new THREE.InstancedMesh(capGeo, new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.45 }), n);
  const lensGeo = new THREE.BoxGeometry(0.058, 0.004, 0.058); lensGeo.translate(0, 0.028, 0);
  const lenses = new THREE.InstancedMesh(lensGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), n);
  for (const m of [bezels, caps, lenses]) { m.frustumCulled = false; group.add(m); }
  const dm = new THREE.Object3D();
  // place every instance now: raycasting caches the instanced bounds on first use, and a
  // pointer move can arrive before the first update() (all caps still stacked at the centre)
  BUTTONS.forEach((b, i) => {
    dm.position.set(xs[i], 0, BTN_Z); dm.updateMatrix();
    bezels.setMatrixAt(i, dm.matrix); caps.setMatrixAt(i, dm.matrix); lenses.setMatrixAt(i, dm.matrix);
  });
  for (const m of [bezels, caps, lenses]) { m.computeBoundingBox(); m.computeBoundingSphere(); }
  const st = BUTTONS.map(() => ({ on: false, press: 0, depth: 0, hover: 0 }));
  const col = new THREE.Color();

  // ---- RESET: emergency-stop mushroom ----
  const reset = new THREE.Group();
  reset.position.set(X_RESET, 0, BTN_Z);
  group.add(reset);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.03, 24), new THREE.MeshStandardMaterial({ color: 0xc9a000, roughness: 0.5 }));
  collar.position.y = 0.015;
  const mushroom = new THREE.Group();
  const redMat = new THREE.MeshStandardMaterial({ color: 0xb01010, roughness: 0.35, emissive: 0x300000, emissiveIntensity: 1 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 16), redMat); stem.position.y = 0.03;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.052, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), redMat);
  head.scale.y = 0.55; head.position.y = 0.045;
  mushroom.add(stem, head);
  reset.add(collar, mushroom);

  // ---- guarded switches ----
  function guarded(xc, capColor, emissive, coverColor, ringColor) {
    const g = new THREE.Group();
    g.position.set(xc, 0, BTN_Z);
    group.add(g);
    const tape = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.17), new THREE.MeshStandardMaterial({ map: textDecal([''], { stripes: true, w: 256, h: 256 }), roughness: 0.7 }));
    tape.rotation.x = -Math.PI / 2; tape.position.y = 0.001;
    const baseB = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.02, 0.115), new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.5, metalness: 0.4 }));
    baseB.position.y = 0.01;
    const mat = new THREE.MeshStandardMaterial({ color: capColor, roughness: 0.35, emissive, emissiveIntensity: 1 });
    const btn = new THREE.Group(); btn.position.y = 0.02;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, 0.02, 24), mat); cap.position.y = 0.01;
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat); top.scale.y = 0.35; top.position.y = 0.02;
    btn.add(cap, top);
    const ringMat = new THREE.MeshBasicMaterial({ color: ringColor, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.003, 6, 32), ringMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.021;
    const pivot = new THREE.Group(); pivot.position.set(0, 0.02, -0.05);
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.1), new THREE.MeshPhysicalMaterial({
      color: coverColor, transparent: true, opacity: 0.35, roughness: 0.05, clearcoat: 1, depthWrite: false,
    }));
    cover.position.set(0, 0.025, 0.05); cover.renderOrder = 12;
    pivot.add(cover);
    g.add(tape, baseB, btn, ring, pivot);
    return { group: g, btn, mat, ring: ringMat, pivot, hit: [cover, cap, top, baseB, tape], open: 0, target: 0, press: 0 };
  }
  const flight = guarded(X_FLIGHT, 0xc81010, 0x400000, 0xd8f0ff, 0x401010);
  const inject = guarded(X_INJECT, 0x1a1a1a, 0x000000, 0xff9a8a, 0x103010);
  const skull = new THREE.Mesh(new THREE.CircleGeometry(0.022, 20), new THREE.MeshBasicMaterial({
    map: textDecal(['☠'], { w: 128, h: 128, font: `600 92px ${FONT_UI}`, color: 'rgba(220,220,210,0.95)', wear: 30 }), transparent: true,
  }));
  skull.rotation.x = -Math.PI / 2; skull.position.y = 0.0315;
  inject.btn.add(skull);

  // ---- toxin selector knob ----
  const knob = new THREE.Group();
  knob.position.set(X_KNOB, 0, BTN_Z);
  group.add(knob);
  const kBody = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.03, 20), new THREE.MeshStandardMaterial({ color: 0x0e0f10, roughness: 0.4 }));
  kBody.position.y = 0.015;
  const kPointer = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.004, 0.026), new THREE.MeshBasicMaterial({ color: 0xe8e4d8 }));
  kPointer.position.set(0, 0.031, -0.012);
  const kRot = new THREE.Group();
  kRot.add(kBody, kPointer);
  knob.add(kRot);
  let toxin = 0, knobAngle = 0.65;

  const hitList = [caps, lenses, collar, stem, head, ...flight.hit, ...inject.hit, kBody];
  const idOf = new Map();
  [collar, stem, head].forEach((m) => idOf.set(m, 'reset'));
  flight.hit.forEach((m) => idOf.set(m, 'flight'));
  inject.hit.forEach((m) => idOf.set(m, 'inject'));
  idOf.set(kBody, 'toxin');

  let hoverId = null;
  let resetPress = 0;

  function pick(raycaster) {
    const h = raycaster.intersectObjects(hitList, false)[0];
    if (!h) return null;
    if (h.object === caps || h.object === lenses) return BUTTONS[h.instanceId].id;
    return idOf.get(h.object) || null;
  }

  function update(dt, now) {
    BUTTONS.forEach((b, i) => {
      const s = st[i];
      s.press = Math.max(0, s.press - dt);
      s.hover += ((hoverId === b.id ? 1 : 0) - s.hover) * Math.min(1, dt * 12);
      const target = s.press > 0 ? 0.013 : s.on ? 0.006 : 0;
      s.depth += (target - s.depth) * Math.min(1, dt * 30);
      dm.position.set(xs[i], -s.depth, BTN_Z); dm.updateMatrix();
      caps.setMatrixAt(i, dm.matrix); lenses.setMatrixAt(i, dm.matrix);
      if (s.on) col.setRGB(...(b.warn ? [2.2, 0.32, 0.18] : [1.9, 1.25, 0.45]));
      else col.setRGB(...(b.warn ? [0.09, 0.025, 0.02] : [0.07, 0.062, 0.05]));
      if (s.on && b.warn) col.multiplyScalar(0.8 + 0.2 * Math.sin(now * 9));
      col.addScalar(s.hover * 0.06);
      lenses.setColorAt(i, col);
    });
    caps.instanceMatrix.needsUpdate = true; lenses.instanceMatrix.needsUpdate = true; lenses.instanceColor.needsUpdate = true;
    resetPress = Math.max(0, resetPress - dt);
    mushroom.position.y = resetPress > 0 ? -0.014 : 0;
    redMat.emissiveIntensity = 1 + (hoverId === 'reset' ? 1.5 : 0);
    for (const gs of [flight, inject]) {
      gs.pivot.rotation.x += ((gs.target ? -1.9 : 0) - gs.pivot.rotation.x) * Math.min(1, dt * 10);
      gs.press = Math.max(0, gs.press - dt);
      gs.btn.position.y += ((gs.press > 0 ? 0.008 : 0.02) - gs.btn.position.y) * Math.min(1, dt * 20);
    }
    flight.mat.emissiveIntensity = 1 + (flight.target ? 1.5 + Math.sin(now * 8) : 0) + (hoverId === 'flight' ? 0.8 : 0);
    flight.ring.color.setRGB(flight.target ? 2.2 : 0.25, 0.05, 0.03);
    inject.ring.color.setRGB(inject.target ? 0.6 : 0.04, inject.target ? 2.2 * (0.6 + 0.4 * Math.sin(now * 6)) : 0.18, inject.target ? 0.4 : 0.04);
    inject.mat.emissive.setRGB(hoverId === 'inject' ? 0.15 : 0, 0, 0);
    const ka = toxin ? 0.65 : -0.65;
    knobAngle += (ka - knobAngle) * Math.min(1, dt * 14);
    kRot.rotation.y = -knobAngle;
  }

  drawPlate();
  return {
    group, hitList,
    pick,
    setHover(id) { hoverId = id; },
    setOn(id, on) { const i = BUTTONS.findIndex((b) => b.id === id); if (i >= 0) st[i].on = !!on; },
    press(id) {
      const i = BUTTONS.findIndex((b) => b.id === id);
      if (i >= 0) st[i].press = 0.13;
      else if (id === 'reset') resetPress = 0.25;
      else if (id === 'flight') flight.press = 0.4;
      else if (id === 'inject') inject.press = 0.4;
    },
    cover(id, open) { (id === 'flight' ? flight : inject).target = open ? 1 : 0; },
    isOpen(id) { return !!(id === 'flight' ? flight : inject).target; },
    get toxin() { return toxin; },
    set toxin(v) { toxin = v ? 1 : 0; },
    flightLight: flight,
    update,
    relabel: drawPlate,
    worldPos(id, out = new THREE.Vector3()) {
      const i = BUTTONS.findIndex((b) => b.id === id);
      const lx = i >= 0 ? xs[i] : { reset: X_RESET, flight: X_FLIGHT, inject: X_INJECT, toxin: X_KNOB }[id] ?? 0;
      return group.localToWorld(out.set(lx, 0.03, BTN_Z));
    },
  };
}
