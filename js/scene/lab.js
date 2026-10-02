// The facility: observation booth (us, red emergency light only) -> glass -> underground test
// hall (the subject, one failing lamp). Static geometry is merged per material at the end.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const LAYOUT = {
  windowZ: 3.6,
  chair: V(0, 0, 0.6),
  camera: V(0, 1.6, 7.05),
  lookAt: V(0, 1.2, 1.0),
  monitorL: V(-0.78, 1.43, 4.72),
  monitorR: V(0.78, 1.43, 4.72),
  monitorYaw: 0.14,
  console: V(0, 0.985, 5.25),     // centre of the sloped control surface
  consoleTilt: 0.34,
  eyeL: V(0.19, 1.76, 0.77),      // subject's left compound eye (seated)
  thorax: V(-0.205, 1.42, 0.79),  // injection site: right side of the thorax
};
export const FONT_UI = '"IBM Plex Mono", "JetBrains Mono", ui-monospace, Consolas, monospace';

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

function cyl(r0, r1, h, mat, seg = 16, open = false) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg, 1, open), mat);
  m.receiveShadow = true;
  return m;
}

export function cable(points, radius, mat, seg = 64) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, radius, 6, false), mat);
  m.receiveShadow = true;
  return m;
}

function hang(a, b, sag, radius, mat) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const p = a.clone().lerp(b, t);
    p.y -= Math.sin(Math.PI * t) * sag;
    pts.push(p);
  }
  return cable(pts, radius, mat, 48);
}

// a rod between two points (for hangers, arms)
function rod(a, b, r, mat, seg = 8) {
  const m = cyl(r, r, a.distanceTo(b), mat, seg);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function textDecal(lines, { w = 1024, h = 256, color = 'rgba(230,230,220,0.8)', font = `600 120px ${FONT_UI}`, stripes = false, bg = null, wear = 500 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  if (stripes) {
    ctx.fillStyle = '#b89000';
    ctx.fillRect(0, 0, w, h);
    for (let x = -h; x < w + h; x += 64) {
      ctx.fillStyle = '#121110';
      ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 32, h); ctx.lineTo(x + 32 + h, 0); ctx.lineTo(x + h, 0); ctx.fill();
    }
  }
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * (h / lines.length)));
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < wear; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.5})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 8, 1 + Math.random() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// merge every mesh below `root` into one mesh per material
function mergeStatic(root, { castShadow = false } = {}) {
  root.updateMatrixWorld(true);
  const byMat = new Map();
  const drop = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    const key = o.material.uuid;
    if (!byMat.has(key)) byMat.set(key, { mat: o.material, geos: [] });
    byMat.get(key).geos.push(g);
    drop.push(o);
  });
  drop.forEach((o) => o.parent.remove(o));
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  for (const { mat, geos } of byMat.values()) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    merged.applyMatrix4(inv);
    const m = new THREE.Mesh(merged, mat);
    m.receiveShadow = true;
    m.castShadow = castShadow;
    root.add(m);
  }
}

function gradientTex(stops, w = 4, h = 256) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, h, 0, 0);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildLab(scene) {
  const R = rng(42);
  const handles = {};
  const statics = new THREE.Group();       // hall + booth structure, merged at the end
  const chairStatics = new THREE.Group();  // the chair: casts shadows, turns as a centrifuge
  scene.add(statics, chairStatics);

  // ---------- materials (grimy, cold) ----------
  const conc = TX.concrete({ tint: [86, 88, 86], seams: 2, stains: 0.95, seed: 3 });
  const floorTex = TX.concrete({ tint: [66, 68, 66], seams: 4, stains: 1.0, seed: 9 });
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex.map, roughnessMap: floorTex.rough, roughness: 0.72 });
  floorTex.map.repeat.set(10, 26); floorTex.rough.repeat.set(10, 26);
  const wallMap = conc.map.clone(); wallMap.needsUpdate = true; wallMap.repeat.set(12, 1.5);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallMap, roughnessMap: conc.rough, roughness: 0.95 });
  const steel = new THREE.MeshStandardMaterial({ map: TX.metal({ tint: [118, 122, 122] }), metalness: 0.85, roughness: 0.38 });
  const darkSteel = new THREE.MeshStandardMaterial({ map: TX.metal({ tint: [40, 43, 45], seed: 5 }), metalness: 0.7, roughness: 0.5 });
  const enamel = new THREE.MeshStandardMaterial({ map: TX.metal({ tint: [150, 154, 142], seed: 8 }), metalness: 0.15, roughness: 0.55 });
  const panelMat = new THREE.MeshStandardMaterial({ map: TX.metal({ tint: [96, 100, 98], seed: 2 }), metalness: 0.3, roughness: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.75 });
  const rubberGrey = new THREE.MeshStandardMaterial({ color: 0x23272a, roughness: 0.7 });
  const cableMats = [rubber, rubberGrey,
    new THREE.MeshStandardMaterial({ color: 0x1a2a38, roughness: 0.6 }),
    new THREE.MeshStandardMaterial({ color: 0x3a1414, roughness: 0.6 })];
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xe6eef0, roughness: 0.05, transparent: true, opacity: 0.32, clearcoat: 1, depthWrite: false });

  // ---------- test hall ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 80), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -36.4);
  floor.receiveShadow = true;
  scene.add(floor);

  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(80, 9), wallMat);
    wall.position.set(s * 9.5, 4.5, -36.4);
    wall.rotation.y = -s * Math.PI / 2;
    statics.add(wall);
    for (let z = 1; z > -64; z -= 8) statics.add(box(0.9, 9, 0.9, wallMat, s * 6.5, 4.5, z));
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 66), new THREE.MeshStandardMaterial({ color: 0x5e4f12, roughness: 0.9 }));
    line.rotation.x = -Math.PI / 2;
    line.position.set(s * 5.4, 0.004, -30);
    statics.add(line);
    // pipes along the wall
    for (let k = 0; k < 3; k++) statics.add(rod(V(s * 9.25, 6.6 + k * 0.32, 3.4), V(s * 9.25, 6.6 + k * 0.32, -64), 0.07 + k * 0.02, k === 1 ? rubberGrey : darkSteel, 10));
  }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(30, 80), new THREE.MeshStandardMaterial({ color: 0x101113, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, 9, -36.4);
  statics.add(ceil);
  for (let z = 1; z > -64; z -= 8) statics.add(box(13.9, 0.6, 0.7, wallMat, 0, 8.7, z));

  // ceiling lamps: dead until the flight protocol switches the hall on
  const hallLampMat = new THREE.MeshBasicMaterial({ color: 0x15181b });
  const hallLamps = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.08, 0.25), hallLampMat, 8);
  const dm = new THREE.Object3D();
  for (let i = 0; i < 8; i++) { dm.position.set(0, 8.35, -3 - i * 8); dm.updateMatrix(); hallLamps.setMatrixAt(i, dm.matrix); }
  scene.add(hallLamps);
  const hallLight = new THREE.PointLight(0xdfe9ff, 0, 24, 1.3);
  hallLight.position.set(0, 7.5, -4);
  scene.add(hallLight);
  handles.hall = { lamps: hallLampMat, light: hallLight };

  // one fluorescent tube far down the hall, on its last legs
  const farTubeMat = new THREE.MeshBasicMaterial({ color: 0x0a0c0b });
  const farTube = box(1.5, 0.07, 0.07, farTubeMat, -2.6, 5.6, -19);
  scene.add(farTube);
  statics.add(box(1.6, 0.1, 0.16, darkSteel, -2.6, 5.67, -19));
  statics.add(rod(V(-3.2, 5.7, -19), V(-3.2, 9, -19), 0.012, steel), rod(V(-2.0, 5.7, -19), V(-2.0, 9, -19), 0.012, steel));
  const glowTex = TX.softDot('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
  const farGlow = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 6), new THREE.MeshBasicMaterial({
    map: glowTex, color: 0x0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  farGlow.position.set(-2.6, 3.0, -20.5);
  scene.add(farGlow);
  // someone in a protective suit, standing where the light does not reach
  const figure = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0x2c2e26, roughness: 0.9 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.15, metalness: 0.6 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.62, 4, 10), suit);
  torso.position.y = 1.18; torso.scale.set(1.15, 1, 0.75);
  const fHood = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), suit); fHood.position.y = 1.78;
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), visor);
  face.rotation.x = Math.PI / 2; face.position.set(0, 1.79, 0.1);
  const legs = [-1, 1].map((s) => { const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.62, 4, 8), suit); l.position.set(s * 0.12, 0.42, 0); return l; });
  figure.add(torso, fHood, face, ...legs);
  figure.position.set(-2.2, 0, -18.4);
  figure.rotation.y = 0.12;
  figure.visible = false;
  scene.add(figure);
  handles.far = { tube: farTubeMat, glow: farGlow.material, figure };

  // sirens: rotating red beacons on the pillars nearest the chair (spin during flight)
  const sirens = [];
  const sirenDome = new THREE.MeshBasicMaterial({ color: 0x1a0303 });
  const sirenFin = new THREE.MeshBasicMaterial({ color: 0x200808 });
  for (const [x, z] of [[-6.0, 1], [6.0, 1], [-6.0, -7], [6.0, -7]]) {
    const g = new THREE.Group();
    g.position.set(x, 5.2, z);
    g.add(cyl(0.16, 0.18, 0.12, darkSteel));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), sirenDome);
    dome.position.y = 0.06;
    g.add(dome);
    const rot = new THREE.Group();
    rot.position.y = 0.12;
    rot.add(box(0.02, 0.14, 0.2, sirenFin, 0, 0, 0.06));
    g.add(rot);
    scene.add(g);
    sirens.push({ group: g, rot });
  }
  const sirenLights = [];
  for (const [x, z] of [[-6.0, 1], [6.0, -7]]) {
    const sl = new THREE.SpotLight(0xff1a0a, 0, 26, 0.32, 0.5, 1.2);
    sl.position.set(x, 5.4, z);
    sl.target.position.set(x, 5.4, z + 1);
    scene.add(sl, sl.target);
    sirenLights.push(sl);
  }
  handles.sirens = { units: sirens, lights: sirenLights, dome: sirenDome, fin: sirenFin };

  const ring = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.72, 64),
    new THREE.MeshStandardMaterial({ map: textDecal([''], { stripes: true, w: 1024, h: 64 }), roughness: 0.9, color: 0x9a9a9a }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(LAYOUT.chair.x, 0.003, LAYOUT.chair.z);
  scene.add(ring);
  const stencil = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65),
    new THREE.MeshStandardMaterial({ map: textDecal(['ОБЪЕКТ 783'], { color: 'rgba(200,198,186,0.6)', wear: 1400 }), transparent: true, roughness: 0.9 }));
  stencil.rotation.x = -Math.PI / 2;
  stencil.position.set(0, 0.004, 2.55);
  scene.add(stencil);
  const pillarSign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8),
    new THREE.MeshStandardMaterial({ map: textDecal(['B-7'], { w: 256, h: 256, font: `600 120px ${FONT_UI}`, color: 'rgba(200,198,186,0.7)' }), transparent: true }));
  pillarSign.position.set(-6.04, 2.4, 1);
  pillarSign.rotation.y = Math.PI / 2;
  scene.add(pillarSign);
  // old stains around the chair
  const stainTex = TX.softDot('rgba(30,14,8,0.85)', 'rgba(30,14,8,0)');
  for (let i = 0; i < 6; i++) {
    const st = new THREE.Mesh(new THREE.PlaneGeometry(0.5 + R() * 1.1, 0.4 + R() * 0.9), new THREE.MeshStandardMaterial({ map: stainTex, transparent: true, depthWrite: false, roughness: 0.3 }));
    st.rotation.set(-Math.PI / 2, 0, R() * 3);
    st.position.set((R() - 0.5) * 2.6, 0.005 + i * 0.0004, LAYOUT.chair.z + (R() - 0.3) * 2.2);
    scene.add(st);
  }

  // ---------- the chair (stained enamel + steel); doubles as a centrifuge ----------
  const chair = new THREE.Group();
  chair.position.copy(LAYOUT.chair);
  scene.add(chair);
  const cs = chairStatics;
  cs.position.copy(LAYOUT.chair);
  cs.add(cyl(0.78, 0.82, 0.07, darkSteel, 40));
  cs.children[cs.children.length - 1].position.y = 0.035;
  const post = cyl(0.12, 0.16, 0.42, steel); post.position.set(0, 0.25, -0.05); cs.add(post);
  cs.add(box(0.95, 0.1, 0.8, enamel, 0, 0.47, 0.0));
  cs.add(box(0.62, 0.9, 0.09, enamel, 0, 1.0, -0.5));
  cs.add(box(0.1, 0.5, 0.1, steel, 0, 0.62, -0.48));
  for (const s of [-1, 1]) {
    cs.add(box(0.14, 0.07, 0.85, enamel, s * 0.6, 0.76, 0.05));
    cs.add(box(0.06, 0.28, 0.06, steel, s * 0.6, 0.6, -0.25));
    cs.add(box(0.06, 0.28, 0.06, steel, s * 0.6, 0.6, 0.35));
  }
  cs.add(box(0.9, 0.05, 0.32, darkSteel, 0, 0.05, 0.78));
  const rigPole = cyl(0.05, 0.05, 2.5, steel); rigPole.position.set(0, 1.25, -0.75); cs.add(rigPole);
  const straps = [];
  const strapMat = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.85 });
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.69, 0.81, 0.42);
    const strap = box(0.18, 0.05, 0.08, strapMat, -s * 0.09, 0, 0);
    const buckle = box(0.04, 0.055, 0.05, steel, -s * 0.17, 0, 0);
    pivot.add(strap, buckle);
    chair.add(pivot);
    straps.push({ pivot, side: s });
  }
  handles.straps = straps;

  // electrode rig: lifts away when the subject is released
  const rig = new THREE.Group();
  chair.add(rig);
  rig.add(box(0.07, 0.07, 0.95, steel, 0, 2.48, -0.3));
  const crown = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.018, 8, 48), steel);
  crown.rotation.x = Math.PI / 2;
  crown.position.set(0, 2.06, 0.1);
  rig.add(crown, box(0.05, 0.42, 0.05, steel, 0, 2.27, 0.1));
  const needleMat = new THREE.MeshStandardMaterial({ color: 0xc8cdd0, metalness: 1, roughness: 0.25 });
  const tips = [];
  const ledMats = [];
  const crownPts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const p = V(Math.cos(a) * 0.21, 2.06, 0.1 + Math.sin(a) * 0.21);
    const tip = V(Math.cos(a) * 0.12, 1.9, 0.1 + Math.sin(a) * 0.1);
    rig.add(rod(p, tip, 0.004, needleMat, 4));
    tips.push(tip);
    crownPts.push(p);
    const lm = new THREE.MeshBasicMaterial({ color: 0x40ff90 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), lm);
    led.position.copy(p).add(V(0, 0.025, 0));
    rig.add(led);
    ledMats.push(lm);
    const top = V((i - 2.5) * 0.25, 9, -0.4 + (i % 2) * 0.3);
    rig.add(cable([p, p.clone().add(V(0, 0.4, -0.1)), V(p.x * 1.6, 3.6, -0.6), V(top.x, 6.5, top.z - 0.4), top], 0.012, cableMats[i % 4], 40));
  }
  handles.rig = { group: rig, tips, leds: ledMats, crown: crownPts };

  // electric arcs for the shock experiment (jagged lines from the electrodes into the head)
  const arcGeo = new THREE.BufferGeometry();
  arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 8 * 2 * 3), 3));
  const arcs = new THREE.LineSegments(arcGeo, new THREE.LineBasicMaterial({ color: 0xcfeaff, transparent: true, opacity: 0, toneMapped: false }));
  arcs.frustumCulled = false;
  rig.add(arcs);
  handles.arcs = arcs;
  // sparks (overload): small hot streaks from the crown
  const sparkN = 90;
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sparkN * 2 * 3), 3));
  const sparks = new THREE.LineSegments(sparkGeo, new THREE.LineBasicMaterial({ color: 0xffc070, transparent: true, opacity: 1, toneMapped: false, blending: THREE.AdditiveBlending }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  handles.sparks = { lines: sparks, parts: Array.from({ length: sparkN }, () => ({ p: V(0, -9, 0), v: V(), life: 0 })) };

  for (let i = 0; i < 7; i++) {
    const pts = [];
    let x = (i - 3) * 0.12, z = LAYOUT.chair.z - 0.6;
    pts.push(V(x * 0.5, 0.35, LAYOUT.chair.z - 0.55));
    pts.push(V(x, 0.02, z - 0.4));
    for (let k = 0; k < 9; k++) {
      z -= 3 + R() * 3;
      x += (R() - 0.5) * 1.6 + (i - 3) * 0.25;
      pts.push(V(x, 0.03, z));
    }
    statics.add(cable(pts, 0.025 + R() * 0.02, cableMats[i % 4], 100));
  }
  statics.add(box(0.6, 0.8, 0.25, panelMat, -6.0, 1.3, -6.9));
  for (let i = 0; i < 3; i++) {
    statics.add(cable([V(-0.3 + i * 0.05, 0.03, LAYOUT.chair.z - 0.7), V(-2.5, 0.03, -1 - i * 0.4), V(-5.5, 0.03, -5.5), V(-5.9, 0.03, -6.6), V(-5.9, 0.9, -6.8)], 0.03, cableMats[i], 60));
  }

  // ---------- the failing lamp over the subject ----------
  const lampHousing = cyl(0.25, 0.4, 0.35, darkSteel, 20);
  lampHousing.position.set(0, 6.3, LAYOUT.chair.z + 0.3);
  statics.add(lampHousing);
  const lampFace = new THREE.Mesh(new THREE.CircleGeometry(0.36, 24), new THREE.MeshBasicMaterial({ color: 0xe8f0ea }));
  lampFace.rotation.x = Math.PI / 2;
  lampFace.position.set(0, 6.12, LAYOUT.chair.z + 0.3);
  scene.add(lampFace);
  statics.add(hang(V(0, 6.48, LAYOUT.chair.z + 0.3), V(0, 9, LAYOUT.chair.z + 0.3), 0.0, 0.02, rubber));
  const spot = new THREE.SpotLight(0xdde8e0, 140, 16, 0.34, 0.6, 1.6);
  spot.position.set(0, 6.1, LAYOUT.chair.z + 0.3);
  spot.target.position.set(0, 0.9, LAYOUT.chair.z);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0004;
  spot.shadow.camera.near = 1;
  spot.shadow.camera.far = 12;
  scene.add(spot, spot.target);
  const coneH = 6.1;
  const coneGeo = new THREE.CylinderGeometry(0.33, coneH * Math.tan(0.34) * 1.05, coneH, 48, 1, true);
  coneGeo.translate(0, -coneH / 2, 0);
  const coneMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xd8e6dc) }, uOpacity: { value: 0.085 }, uTime: { value: 0 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying float vH; varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        vH = position.y; vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity; uniform float uTime;
      varying vec3 vN; varying vec3 vV; varying float vH; varying vec3 vW;
      float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float n3(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      void main() {
        float facing = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
        float fade = smoothstep(-6.1, -2.0, vH) * (0.35 + 0.65 * smoothstep(-6.1, 0.0, vH));
        float dust = 0.6 + 0.8 * n3(vW * 2.2 + vec3(0.0, uTime * 0.05, uTime * 0.03));
        gl_FragColor = vec4(uColor * facing * fade * uOpacity * dust, 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.position.set(0, 6.12, LAYOUT.chair.z + 0.3);
  cone.renderOrder = 5;
  cone.layers.set(2);   // atmosphere for our eyes only: the subject's eye cameras sit inside this cone
  scene.add(cone);
  handles.spot = { light: spot, cone, face: lampFace, base: 140 };
  const spill = new THREE.SpotLight(0xb8c8d0, 2.2, 9, 0.42, 1, 1.4);
  spill.position.set(0, 2.2, 3.4);
  spill.target.position.set(0, 1.2, LAYOUT.chair.z);
  scene.add(spill, spill.target);
  const rim = new THREE.SpotLight(0x8fa4c0, 16, 9, 0.5, 0.8, 1.5);
  rim.position.set(0.4, 3.4, LAYOUT.chair.z - 2.6);
  rim.target.position.set(0, 1.4, LAYOUT.chair.z);
  scene.add(rim, rim.target);
  handles.fill = { spill, rim, spillBase: 2.2, rimBase: 16 };

  const dustN = 700;
  const dustGeo = new THREE.BufferGeometry();
  const dp = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) {
    const r = Math.sqrt(R()) * 1.7, a = R() * Math.PI * 2;
    dp[i * 3] = Math.cos(a) * r; dp[i * 3 + 1] = 0.3 + R() * 5.6; dp[i * 3 + 2] = LAYOUT.chair.z + Math.sin(a) * r;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    size: 0.012, map: TX.softDot(), transparent: true, opacity: 0.5, depthWrite: false,
    blending: THREE.AdditiveBlending, color: 0xdfe8e2,
  }));
  dust.layers.set(2);   // dust in the light: for our eyes only (it is centimetres from the subject's)
  scene.add(dust);
  handles.dust = dust;

  // ---------- props: feeding arm ----------
  const feeder = new THREE.Group();
  scene.add(feeder);
  const fBase = box(0.4, 0.06, 0.4, darkSteel, 1.25, 0.03, 1.55);
  const fCol = cyl(0.05, 0.05, 1.45, steel); fCol.position.set(1.25, 0.75, 1.55);
  const fMotor = box(0.16, 0.16, 0.16, panelMat, 1.25, 1.45, 1.55);
  feeder.add(fBase, fCol, fMotor);
  const fJoint = new THREE.Group();
  fJoint.position.set(1.25, 1.45, 1.55);
  feeder.add(fJoint);
  const fArm = new THREE.Group();
  fJoint.add(fArm);
  fArm.add(box(0.05, 0.05, 1, steel, 0, 0, 0.5));
  const syringe = new THREE.Group();
  fArm.add(syringe);
  const barrel = cyl(0.03, 0.03, 0.3, glassMat); barrel.rotation.x = Math.PI / 2; barrel.position.z = 0.15;
  const tipG = cyl(0.004, 0.03, 0.14, glassMat); tipG.rotation.x = Math.PI / 2; tipG.position.z = 0.37;
  const liquid = cyl(0.024, 0.024, 0.22, new THREE.MeshBasicMaterial({ color: 0xf2c46a, transparent: true, opacity: 0.6 }));
  liquid.rotation.x = Math.PI / 2; liquid.position.z = 0.16;
  syringe.add(barrel, tipG, liquid);
  const drop = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 14), new THREE.MeshPhysicalMaterial({
    color: 0xf5cf7a, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.85, emissive: 0x3a2400,
  }));
  drop.position.z = 0.45;
  syringe.add(drop);
  handles.feeder = { group: feeder, joint: fJoint, arm: fArm, syringe, drop, liquid };
  statics.add(hang(V(1.25, 0.08, 1.75), V(0.4, 0.03, 0.2), 0, 0.015, rubberGrey));

  // ---------- props: speakers ----------
  const speakers = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(s * 1.85, 0, 1.0);
    g.rotation.y = -s * 0.9;
    const stand = cyl(0.04, 0.04, 0.7, steel); stand.position.y = 0.35;
    const foot = box(0.5, 0.04, 0.5, darkSteel, 0, 0.02, 0);
    const cab = box(0.55, 0.85, 0.45, new THREE.MeshStandardMaterial({ color: 0x111213, roughness: 0.85 }), 0, 1.12, 0);
    const woofer = new THREE.Mesh(new THREE.CircleGeometry(0.2, 32), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.5 }));
    woofer.position.set(0, 1.0, 0.226);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.3, metalness: 0.4 }));
    dome.rotation.x = Math.PI / 2; dome.position.set(0, 1.0, 0.226);
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.012, 8), new THREE.MeshBasicMaterial({ color: 0x331100 }));
    led.position.set(0.2, 1.48, 0.227);
    g.add(stand, foot, cab, woofer, dome, led);
    scene.add(g);
    statics.add(hang(V(s * 1.85, 0.75, 0.85), V(s * 0.4, 0.03, 0.0), 0.1, 0.012, rubber));
    speakers.push({ group: g, dome, led });
  }
  handles.speakers = speakers;

  // ---------- props: wind fan (aimed at the antennae) ----------
  const fan = new THREE.Group();
  fan.position.set(-1.25, 0, 1.95);
  scene.add(fan);
  const fanStand = cyl(0.03, 0.03, 1.55, steel); fanStand.position.y = 0.78;
  fan.add(fanStand, box(0.4, 0.04, 0.4, darkSteel, 0, 0.02, 0));
  const fanHead = new THREE.Group();
  fanHead.position.y = 1.62;
  fan.add(fanHead);
  const fanTarget = V(0, 1.82, LAYOUT.chair.z + 0.3);
  fan.updateMatrixWorld(true);
  fanHead.lookAt(fanTarget);
  const cage = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.012, 6, 32), steel);
  const cage2 = cage.clone(); cage2.position.z = 0.06;
  const hub = cyl(0.07, 0.07, 0.14, panelMat); hub.rotation.x = Math.PI / 2; hub.position.z = -0.06;
  fanHead.add(cage, cage2, hub);
  const blades = new THREE.Group();
  blades.position.z = 0.03;
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Group(); p.rotation.z = i * Math.PI / 2;
    p.add(box(0.06, 0.2, 0.01, panelMat, 0, 0.1, 0));
    blades.add(p);
  }
  fanHead.add(blades);
  const streakN = 60;
  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(streakN * 2 * 3), 3));
  const streaks = new THREE.LineSegments(streakGeo, new THREE.LineBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0 }));
  streaks.frustumCulled = false;
  scene.add(streaks);
  const fanWorld = new THREE.Vector3(); fanHead.getWorldPosition(fanWorld);
  handles.fan = {
    blades, streaks, from: fanWorld.clone(), to: fanTarget,
    parts: Array.from({ length: streakN }, () => ({ t: Math.random(), off: V((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3) })),
  };

  // ---------- props: tickle probe (soft brush on a robotic rod from the ceiling) ----------
  const tickler = new THREE.Group();
  scene.add(tickler);
  const tRod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 8), steel);
  tRod.geometry.translate(0, 0.5, 0);
  const brush = new THREE.Group();
  const brushMat = new THREE.MeshStandardMaterial({ color: 0xd8d6cc, roughness: 1 });
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.09, 5), brushMat);
    c.rotation.set((Math.random() - 0.5) * 0.9, 0, Math.PI + (Math.random() - 0.5) * 0.9);
    c.position.y = -0.04;
    brush.add(c);
  }
  tickler.add(tRod, brush);
  handles.tickler = { rod: tRod, brush, anchor: V(0.75, 3.4, 1.15) };
  statics.add(box(0.12, 0.12, 0.12, darkSteel, 0.75, 3.46, 1.15));
  statics.add(hang(V(0.75, 3.5, 1.15), V(0.75, 9, 1.0), 0, 0.015, rubber));

  // ---------- props: VR visor on a cable from the ceiling ----------
  const vr = new THREE.Group();
  scene.add(vr);
  const shell = new THREE.MeshStandardMaterial({ color: 0x17191b, roughness: 0.5, metalness: 0.35 });
  vr.add(box(0.88, 0.4, 0.03, shell, 0, 0, 0.27), box(0.88, 0.03, 0.26, shell, 0, 0.2, 0.14), box(0.88, 0.03, 0.26, shell, 0, -0.2, 0.14),
    box(0.03, 0.4, 0.26, shell, -0.44, 0, 0.14), box(0.03, 0.4, 0.26, shell, 0.44, 0, 0.14));
  const vrFront = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.025), new THREE.MeshBasicMaterial({ color: 0x0a2228 }));
  vrFront.position.set(0, -0.12, 0.287);
  const vrStrap = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.022, 6, 32, Math.PI), rubber);
  vrStrap.rotation.set(Math.PI / 2, 0, Math.PI);
  vrStrap.position.z = 0.04;
  const vrLeds = [];
  for (let i = 0; i < 4; i++) {
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.009, 8), new THREE.MeshBasicMaterial({ color: 0x113322 }));
    l.position.set(0.24 + i * 0.035, 0.13, 0.287);
    vr.add(l); vrLeds.push(l);
  }
  const vrLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.055), new THREE.MeshBasicMaterial({
    map: textDecal(['VR-7 · OPTOMOTOR'], { w: 512, h: 128, font: `600 44px ${FONT_UI}`, color: 'rgba(210,220,225,0.5)' }), transparent: true,
  }));
  vrLabel.position.set(-0.26, 0.13, 0.287);
  vr.add(vrFront, vrStrap, vrLabel, hang(V(0, 0.21, 0.14), V(0, 7.5, 0.14), 0, 0.012, rubber));
  handles.vr = { group: vr, front: vrFront, leds: vrLeds };

  // ---------- props: odor nozzle ----------
  const nozPts = [V(-1.4, 0, 1.6), V(-1.35, 1.2, 1.55), V(-1.0, 2.05, 1.35), V(-0.45, 2.0, 1.12), V(-0.22, 1.86, 0.98)];
  statics.add(cable(nozPts, 0.018, new THREE.MeshStandardMaterial({ color: 0x8f989b, roughness: 0.4, metalness: 0.5 }), 64));
  const nozTip = cyl(0.006, 0.022, 0.07, steel, 10);
  nozTip.position.copy(nozPts[4]);
  nozTip.quaternion.setFromUnitVectors(V(0, 1, 0), V(0.22, -0.12, -0.25).normalize());
  statics.add(nozTip);
  const canister = cyl(0.13, 0.13, 0.55, new THREE.MeshStandardMaterial({ color: 0x55633f, roughness: 0.6, metalness: 0.3 }));
  canister.position.set(-1.45, 0.3, 1.75);
  statics.add(canister);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({
    map: textDecal(['C₂H₄O₂', 'ACV'], { w: 256, h: 256, font: `600 44px ${FONT_UI}`, color: 'rgba(20,20,10,0.9)' }), transparent: true, color: 0x777777,
  }));
  label.position.set(-1.45, 0.35, 1.882);
  scene.add(label);
  const puffN = 160;
  const puffGeo = new THREE.BufferGeometry();
  puffGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(puffN * 3), 3));
  const puff = new THREE.Points(puffGeo, new THREE.PointsMaterial({
    size: 0.16, map: TX.softDot('rgba(220,235,170,0.55)', 'rgba(220,235,170,0)'), transparent: true,
    depthWrite: false, opacity: 0, color: 0xdfeec0,
  }));
  puff.frustumCulled = false;
  scene.add(puff);
  handles.odor = { tip: nozPts[4], puff, particles: Array.from({ length: puffN }, () => ({ p: V(0, -10, 0), v: V(), life: 0 })) };

  // ---------- props: 532 nm laser, hung from the ceiling, aimed at the left eye ----------
  const laser = new THREE.Group();
  laser.position.set(1.35, 3.0, 1.95);
  scene.add(laser);
  statics.add(rod(V(1.35, 3.12, 1.95), V(1.35, 9, 1.95), 0.022, steel));
  statics.add(box(0.16, 0.08, 0.16, darkSteel, 1.35, 3.12, 1.95));
  const lHead = new THREE.Group();
  laser.add(lHead);
  laser.updateMatrixWorld(true);
  lHead.lookAt(LAYOUT.eyeL);
  lHead.add(box(0.11, 0.11, 0.36, darkSteel, 0, 0, -0.04));
  const lens = cyl(0.03, 0.03, 0.05, rubber, 16); lens.rotation.x = Math.PI / 2; lens.position.z = 0.16; lHead.add(lens);
  const fins = box(0.15, 0.015, 0.2, steel, 0, 0.065, -0.06); lHead.add(fins);
  const lLed = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), new THREE.MeshBasicMaterial({ color: 0x0a2a0a }));
  lLed.position.set(0.045, 0.056, 0.08); lHead.add(lLed);
  const lStart = V(0, 0, 0.19).applyMatrix4(lHead.matrixWorld);
  const lLen = lStart.distanceTo(LAYOUT.eyeL);
  const beamCore = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 1, 6, 1, true), new THREE.MeshBasicMaterial({
    color: 0x60ff70, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  const beamGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 10, 1, true), new THREE.MeshBasicMaterial({
    color: 0x30ff40, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  for (const b of [beamCore, beamGlow]) {
    b.scale.y = lLen;
    b.position.copy(lStart).lerp(LAYOUT.eyeL, 0.5);
    b.quaternion.setFromUnitVectors(V(0, 1, 0), LAYOUT.eyeL.clone().sub(lStart).normalize());
    scene.add(b);
  }
  const hit = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x80ff90, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  hit.position.copy(LAYOUT.eyeL).add(V(0.03, 0, 0));
  hit.scale.setScalar(0.16);
  scene.add(hit);
  handles.laser = { core: beamCore.material, glow: beamGlow.material, hit, led: lLed.material, origin: lStart.clone() };

  // ---------- props: xenon strobes ----------
  const strobeFaces = [];
  const strobeFaceMat = new THREE.MeshBasicMaterial({ color: 0x1a1c1e });
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(s * 0.82, 3.15, 1.8);
    scene.add(g);
    statics.add(rod(V(s * 0.82, 3.2, 1.8), V(s * 0.82, 9, 1.8), 0.018, steel));
    g.updateMatrixWorld(true);
    g.lookAt(0, 1.75, LAYOUT.chair.z + 0.2);
    g.add(box(0.36, 0.18, 0.12, darkSteel, 0, 0, -0.05));
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.14), strobeFaceMat);
    f.position.z = 0.012;
    g.add(f);
    strobeFaces.push(f);
  }
  const strobeLight = new THREE.PointLight(0xf2f4ff, 0, 8, 1.4);
  strobeLight.position.set(0, 2.9, 1.9);
  scene.add(strobeLight);
  handles.strobe = { light: strobeLight, face: strobeFaceMat };

  // ---------- props: injector (telescopic arm from the ceiling, oversized syringe) ----------
  const injAnchor = V(-1.05, 3.3, 1.6);
  statics.add(box(0.2, 0.16, 0.2, darkSteel, injAnchor.x, injAnchor.y + 0.06, injAnchor.z));
  statics.add(rod(V(injAnchor.x, injAnchor.y + 0.14, injAnchor.z), V(injAnchor.x, 9, injAnchor.z), 0.025, steel));
  const injRod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 8), steel);
  injRod.geometry.translate(0, 0.5, 0);
  const injSleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.5, 10), darkSteel);
  injSleeve.geometry.translate(0, 0.25, 0);
  scene.add(injRod, injSleeve);
  const syr = new THREE.Group();     // built along +z: barrel 0..0.42, needle to 0.66
  scene.add(syr);
  const sBarrel = cyl(0.05, 0.05, 0.42, glassMat, 20); sBarrel.rotation.x = Math.PI / 2; sBarrel.position.z = 0.21;
  sBarrel.renderOrder = 12;
  const sLiquidMat = new THREE.MeshStandardMaterial({ color: 0x7fb4ff, transparent: true, opacity: 0.75, roughness: 0.2, emissive: 0x7fb4ff, emissiveIntensity: 0.25 });
  const sLiquid = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 1, 16), sLiquidMat);
  sLiquid.geometry.translate(0, 0.5, 0);
  sLiquid.rotation.x = Math.PI / 2;
  const sHub = cyl(0.016, 0.03, 0.05, steel, 12); sHub.rotation.x = Math.PI / 2; sHub.position.z = 0.445;
  const sNeedle = cyl(0.0035, 0.005, 0.22, needleMat, 6); sNeedle.rotation.x = Math.PI / 2; sNeedle.position.z = 0.58;
  const sFlange = box(0.16, 0.012, 0.03, steel, 0, 0, 0.0);
  const plunger = new THREE.Group();
  const pRod = cyl(0.01, 0.01, 0.42, steel, 8); pRod.rotation.x = Math.PI / 2; pRod.position.z = -0.21;
  const pHead = cyl(0.046, 0.046, 0.02, rubber, 16); pHead.rotation.x = Math.PI / 2;
  const pThumb = cyl(0.045, 0.045, 0.012, steel, 16); pThumb.rotation.x = Math.PI / 2; pThumb.position.z = -0.42;
  plunger.add(pRod, pHead, pThumb);
  syr.add(sBarrel, sLiquid, sHub, sNeedle, sFlange, plunger);
  const hazard = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.2), new THREE.MeshBasicMaterial({
    map: textDecal(['☠'], { w: 128, h: 256, font: `600 110px ${FONT_UI}`, color: 'rgba(20,18,14,0.95)', bg: '#c9a000', wear: 60 }),
  }));
  hazard.position.set(0, 0.052, 0.2); hazard.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
  syr.add(hazard);
  // the eye cameras sit centimetres from the syringe: keep it out of the subject's view
  for (const o of [injRod, injSleeve, syr]) o.traverse((m) => m.layers.set(2));
  handles.injector = { anchor: injAnchor, rod: injRod, sleeve: injSleeve, syringe: syr, plunger, liquid: sLiquid, liquidMat: sLiquidMat };

  // ---------- props: N2 hood (glass bell on a hose, lowered over the head) ----------
  const hood = new THREE.Group();
  scene.add(hood);
  const hoodGlass = new THREE.Mesh(new THREE.SphereGeometry(0.38, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.78), new THREE.MeshPhysicalMaterial({
    color: 0xdfe8ea, roughness: 0.06, transparent: true, opacity: 0.22, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide,
  }));
  hoodGlass.renderOrder = 13;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 32), steel);
  collar.rotation.x = Math.PI / 2; collar.position.y = -0.29;
  const hoodTop = cyl(0.06, 0.08, 0.08, darkSteel, 12); hoodTop.position.y = 0.4;
  const hose = cyl(0.035, 0.035, 4.5, rubber, 8); hose.position.y = 2.68;
  const mistMat = new THREE.ShaderMaterial({
    uniforms: { uFill: { value: 0 }, uTime: { value: 0 } },
    vertexShader: 'varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ vP = position; vec4 wp = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
    fragmentShader: `uniform float uFill; uniform float uTime; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){
        float level = mix(-0.4, 0.42, uFill);
        float below = smoothstep(level + 0.06, level - 0.06, vP.y);
        float swirl = n2(vP.xz * 6.0 + vec2(uTime * 0.4, vP.y * 3.0 - uTime * 0.3)) * 0.6 + 0.4;
        float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float a = below * swirl * (0.25 + 0.5 * rim) * min(1.0, uFill * 2.0);
        gl_FragColor = vec4(vec3(0.82, 0.86, 0.88) * a, a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const mist = new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 16), mistMat);
  mist.renderOrder = 12;
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.05), new THREE.MeshBasicMaterial({
    map: textDecal(['N₂ 99.9%'], { w: 256, h: 96, font: `600 46px ${FONT_UI}`, color: 'rgba(20,20,20,0.9)', bg: '#9fb0b8', wear: 80 }),
  }));
  tag.position.set(0, 0.34, 0.12); tag.rotation.x = -0.45;
  hood.add(hoodGlass, collar, hoodTop, hose, mist, tag);
  hood.position.set(0, 5.4, LAYOUT.chair.z + 0.12);
  handles.hood = { group: hood, mist: mistMat, rest: V(0, 5.4, LAYOUT.chair.z + 0.12) };

  // ---------- specimen tanks: previous subjects, preserved ----------
  const TANKS = [[-2.4, -4.8], [2.4, -4.8], [-2.8, -9.4], [2.8, -9.4], [-3.2, -14], [3.2, -14]];
  const tankH = 2.7;
  const mkInst = (geo, mat, order = 0) => {
    const m = new THREE.InstancedMesh(geo, mat, TANKS.length);
    TANKS.forEach(([x, z], i) => { dm.position.set(x, 0, z); dm.rotation.set(0, 0, 0); dm.scale.setScalar(1); dm.updateMatrix(); m.setMatrixAt(i, dm.matrix); });
    m.renderOrder = order;
    scene.add(m);
    return m;
  };
  const tBase = new THREE.CylinderGeometry(0.86, 0.92, 0.32, 32); tBase.translate(0, 0.16, 0);
  const tCap = new THREE.CylinderGeometry(0.84, 0.84, 0.24, 32); tCap.translate(0, 0.32 + tankH + 0.12, 0);
  const tPipe = new THREE.CylinderGeometry(0.08, 0.08, 9 - (0.56 + tankH), 8); tPipe.translate(0, (9 + 0.56 + tankH) / 2, 0);
  mkInst(mergeGeometries([tBase, tCap, tPipe]), darkSteel);
  const ringGeo = new THREE.TorusGeometry(0.8, 0.025, 6, 40); ringGeo.rotateX(Math.PI / 2); ringGeo.translate(0, 0.33, 0);
  const tankGlowMat = new THREE.MeshBasicMaterial({ color: 0x4fae58 });
  mkInst(ringGeo, tankGlowMat);
  const liqGeo = new THREE.CylinderGeometry(0.73, 0.73, tankH - 0.25, 32, 1, true); liqGeo.translate(0, 0.32 + (tankH - 0.25) / 2, 0);
  const liqTex = gradientTex([[0, '#4c9a46'], [0.25, '#1d4a1f'], [1, '#061108']]);
  const liqBackMat = new THREE.MeshBasicMaterial({ map: liqTex, side: THREE.BackSide, color: 0x9a9a9a });
  mkInst(liqGeo, liqBackMat);
  const liqFrontMat = new THREE.MeshBasicMaterial({ map: liqTex, side: THREE.FrontSide, transparent: true, opacity: 0.42, depthWrite: false, color: 0x6a6a6a });
  mkInst(liqGeo, liqFrontMat, 8);
  const glassGeo = new THREE.CylinderGeometry(0.77, 0.77, tankH, 32, 1, true); glassGeo.translate(0, 0.32 + tankH / 2, 0);
  mkInst(glassGeo, new THREE.MeshPhysicalMaterial({ color: 0xcfe0d8, roughness: 0.08, transparent: true, opacity: 0.16, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide }), 9);
  const floorGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({
    map: TX.softDot('rgba(90,200,100,0.55)', 'rgba(90,200,100,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), TANKS.length);
  TANKS.forEach(([x, z], i) => { dm.position.set(x, 0.008, z); dm.rotation.set(-Math.PI / 2, 0, 0); dm.updateMatrix(); floorGlow.setMatrixAt(i, dm.matrix); });
  scene.add(floorGlow);
  const bubN = TANKS.length * 18;
  const bubGeo = new THREE.BufferGeometry();
  bubGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bubN * 3), 3));
  const bubbles = new THREE.Points(bubGeo, new THREE.PointsMaterial({
    size: 0.05, map: TX.softDot('rgba(200,255,200,0.9)', 'rgba(200,255,200,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x9fe0a0,
  }));
  bubbles.frustumCulled = false;
  scene.add(bubbles);
  // labels: one canvas atlas, one merged mesh
  const atlas = document.createElement('canvas'); atlas.width = 512; atlas.height = 64 * TANKS.length;
  const atlasTex = new THREE.CanvasTexture(atlas); atlasTex.colorSpace = THREE.SRGBColorSpace;
  const plates = TANKS.map(([x, z], i) => {
    const g = new THREE.PlaneGeometry(0.44, 0.055);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setY(k, (TANKS.length - 1 - i + uv.getY(k)) / TANKS.length);
    g.rotateY(-Math.sign(x) * Math.PI / 2);
    g.translate(x - Math.sign(x) * 0.875, 0.2, z);
    return g;
  });
  scene.add(new THREE.Mesh(mergeGeometries(plates), new THREE.MeshBasicMaterial({ map: atlasTex, color: 0x8a8a8a })));
  const tankFlies = { mesh: null };
  handles.tanks = {
    pos: TANKS, count: 0, flies: tankFlies, bubbles, glow: tankGlowMat,
    bub: Array.from({ length: bubN }, (_, k) => ({ tank: k % TANKS.length, y: R() * tankH, x: (R() - 0.5) * 1.1, z: (R() - 0.5) * 1.1, v: 0.15 + R() * 0.35 })),
    setLabels(count, lastNo) {
      const ctx = atlas.getContext('2d');
      ctx.fillStyle = '#9da39c'; ctx.fillRect(0, 0, atlas.width, atlas.height);
      ctx.font = `600 34px ${FONT_UI}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      for (let i = 0; i < TANKS.length; i++) {
        ctx.fillStyle = '#1b1d1b';
        ctx.fillText(i < count ? `783-${String(lastNo - i).padStart(3, '0')} · †` : '— — —', 256, 64 * i + 32);
      }
      atlasTex.needsUpdate = true;
    },
  };
  handles.tanks.setLabels(0, 0);

  // ---------- the wall with the observation window ----------
  const wz = LAYOUT.windowZ;
  const winL = -2.5, winR = 2.5, winB = 0.85, winT = 2.6;
  const boothWall = new THREE.MeshStandardMaterial({ map: TX.metal({ tint: [52, 55, 54], seed: 12 }), roughness: 0.8, metalness: 0.3 });
  const wallT = 0.35;
  statics.add(box(winL + 6, 4, wallT, wallMat, (winL - 6) / 2, 2, wz + wallT / 2));
  statics.add(box(6 - winR, 4, wallT, wallMat, (winR + 6) / 2, 2, wz + wallT / 2));
  statics.add(box(winR - winL, winB, wallT, wallMat, 0, winB / 2, wz + wallT / 2));
  statics.add(box(winR - winL, 4 - winT, wallT, wallMat, 0, (winT + 4) / 2, wz + wallT / 2));
  const fr = 0.07;
  statics.add(box(winR - winL + 2 * fr, fr, wallT + 0.04, darkSteel, 0, winB - fr / 2, wz + wallT / 2));
  statics.add(box(winR - winL + 2 * fr, fr, wallT + 0.04, darkSteel, 0, winT + fr / 2, wz + wallT / 2));
  statics.add(box(fr, winT - winB, wallT + 0.04, darkSteel, winL - fr / 2, (winB + winT) / 2, wz + wallT / 2));
  statics.add(box(fr, winT - winB, wallT + 0.04, darkSteel, winR + fr / 2, (winB + winT) / 2, wz + wallT / 2));
  for (const x of [-1.62, 1.62]) statics.add(box(0.06, winT - winB, 0.08, darkSteel, x, (winB + winT) / 2, wz + wallT / 2));
  const paneMat = new THREE.MeshPhysicalMaterial({
    color: 0xb8c6c0, map: TX.glassSmudge(), transparent: true, opacity: 0.5, roughness: 0.1,
    metalness: 0.0, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide,
  });
  for (const dz of [0.08, 0.27]) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(winR - winL, winT - winB), paneMat);
    pane.position.set(0, (winB + winT) / 2, wz + dz);
    pane.renderOrder = 10;
    scene.add(pane);
  }
  const warn = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.12), new THREE.MeshBasicMaterial({
    map: textDecal(['BIOHAZARD · LVL 4'], { w: 512, h: 128, font: `600 40px ${FONT_UI}`, color: 'rgba(200,160,30,0.9)' }),
    transparent: true, depthWrite: false, color: 0x777777,
  }));
  warn.position.set(-2.05, 0.98, wz + 0.37);
  warn.renderOrder = 11;
  scene.add(warn);

  // ---------- observation booth: dark, red emergency light only ----------
  const bz0 = wz + wallT, bz1 = 8.4;
  const boothFloor = new THREE.Mesh(new THREE.PlaneGeometry(12, bz1 - bz0), new THREE.MeshStandardMaterial({ color: 0x151718, roughness: 0.55 }));
  boothFloor.rotation.x = -Math.PI / 2;
  boothFloor.position.set(0, 0.001, (bz0 + bz1) / 2);
  statics.add(boothFloor);
  const boothCeil = new THREE.Mesh(new THREE.PlaneGeometry(12, bz1 - bz0), new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.9 }));
  boothCeil.rotation.x = Math.PI / 2;
  boothCeil.position.set(0, 3.2, (bz0 + bz1) / 2);
  statics.add(boothCeil);
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(bz1 - bz0, 3.2), boothWall);
    w.position.set(s * 4.2, 1.6, (bz0 + bz1) / 2);
    w.rotation.y = -s * Math.PI / 2;
    statics.add(w);
  }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 3.2), boothWall);
  back.position.set(0, 1.6, bz1);
  back.rotation.y = Math.PI;
  statics.add(back);
  statics.add(box(1.0, 2.1, 0.06, darkSteel, -2.4, 1.05, bz1 - 0.03));   // door
  statics.add(box(8.4, 0.1, 0.05, darkSteel, 0, 0.05, bz0 + 0.03));   // skirting rail

  // red emergency light: caged bulb + strip
  const redMat = new THREE.MeshBasicMaterial({ color: 0xff2a18 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), redMat);
  bulb.position.set(0, 3.0, 6.15);
  scene.add(bulb);
  const cageG = [];
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2;
    cageG.push(rod(V(Math.cos(a) * 0.085, 3.13, 6.15 + Math.sin(a) * 0.085), V(Math.cos(a) * 0.09, 2.93, 6.15 + Math.sin(a) * 0.09), 0.004, steel, 4));
  }
  cageG.forEach((m) => statics.add(m));
  statics.add(cyl(0.11, 0.11, 0.05, darkSteel, 14));
  statics.children[statics.children.length - 1].position.set(0, 3.16, 6.15);
  const strip = box(3.2, 0.025, 0.04, redMat, 0, 3.17, 4.05);
  scene.add(strip);
  const redLight = new THREE.PointLight(0xff2414, 6, 5.2, 1.5);
  redLight.position.set(0, 2.85, 6.15);
  scene.add(redLight);
  // a small task lamp over the console
  const lampBase = V(-2.15, 0.89, 4.5);
  statics.add(cyl(0.09, 0.1, 0.03, darkSteel, 16));
  statics.children[statics.children.length - 1].position.copy(lampBase).add(V(0, 0.015, 0));
  const neckPts = [lampBase.clone().add(V(0, 0.03, 0)), V(-2.12, 1.25, 4.55), V(-1.98, 1.52, 4.8), V(-1.8, 1.5, 4.98)];
  statics.add(cable(neckPts, 0.012, steel, 24));
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.14, 18, 1, true), darkSteel);
  shade.position.set(-1.77, 1.46, 5.02);
  shade.rotation.set(0.45, 0, -0.95);
  scene.add(shade);
  const lampBulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a8 });
  const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), lampBulbMat);
  lampBulb.position.set(-1.75, 1.435, 5.03);
  scene.add(lampBulb);
  const task = new THREE.SpotLight(0xffc896, 3.2, 3.2, 0.62, 0.7, 1.4);
  task.position.copy(lampBulb.position);
  task.target.position.set(0.05, 0.95, 5.25);
  scene.add(task, task.target);
  handles.booth = { red: redLight, redMat, redBase: 6, task, taskMat: lampBulbMat, taskBase: 3.2 };

  // desk (dark steel worktop), console is built separately (console.js)
  const deskTop = new THREE.MeshStandardMaterial({ map: TX.metal({ tint: [34, 36, 37], seed: 21 }), metalness: 0.4, roughness: 0.55 });
  statics.add(box(5.2, 0.05, 1.5, deskTop, 0, 0.865, 4.87));
  statics.add(box(5.2, 0.8, 0.06, darkSteel, 0, 0.44, 4.15));
  statics.add(box(5.2, 0.7, 0.04, darkSteel, 0, 0.44, 5.6));
  for (const x of [-2.58, 2.58]) statics.add(box(0.06, 0.84, 1.5, darkSteel, x, 0.43, 4.87));
  // clutter: mug, clipboard, ashtray-like dish, a binder
  const mugMat = new THREE.MeshStandardMaterial({ color: 0xb8bab4, roughness: 0.35 });
  const mugBody = cyl(0.045, 0.04, 0.1, mugMat, 20); mugBody.position.set(1.62, 0.94, 4.95);
  const mugHandle = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 6, 16), mugMat); mugHandle.position.set(1.67, 0.94, 4.95);
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.04, 16), new THREE.MeshStandardMaterial({ color: 0x140a04, roughness: 0.1 }));
  coffee.rotation.x = -Math.PI / 2; coffee.position.set(1.62, 0.98, 4.95);
  statics.add(mugBody, mugHandle, coffee);
  const clip = box(0.24, 0.01, 0.32, new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.8 }), -1.95, 0.895, 5.05);
  clip.rotation.y = 0.25;
  statics.add(clip);
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.28), new THREE.MeshStandardMaterial({
    map: textDecal(['ПРОТОКОЛ 783', '', 'объект не кормить', 'после 03:00', '', 'при перегрузке —', 'СБРОС', '', 'останки → бак'], { w: 256, h: 340, font: `500 17px ${FONT_UI}`, color: 'rgba(30,30,40,0.85)', bg: '#c8c4b8', wear: 200 }),
    roughness: 0.9,
  }));
  paper.rotation.set(-Math.PI / 2, 0, -0.25);
  paper.position.set(-1.95, 0.902, 5.05);
  scene.add(paper);
  statics.add(box(0.3, 0.06, 0.24, new THREE.MeshStandardMaterial({ color: 0x3a1a14, roughness: 0.7 }), 2.0, 0.92, 4.5));

  // monitor housings on articulated arms
  const monitors = {};
  for (const [key, pos, yaw] of [['left', LAYOUT.monitorL, LAYOUT.monitorYaw], ['right', LAYOUT.monitorR, -LAYOUT.monitorYaw]]) {
    const g = new THREE.Group();
    g.position.copy(pos);
    g.rotation.y = yaw;
    g.rotation.x = -0.04;
    scene.add(g);
    g.add(box(0.69, 0.44, 0.04, new THREE.MeshStandardMaterial({ color: 0x0f1112, roughness: 0.4, metalness: 0.5 }), 0, 0, -0.025));
    g.add(box(0.3, 0.2, 0.06, darkSteel, 0, 0, -0.07));
    const screenAnchor = new THREE.Object3D();
    screenAnchor.position.z = 0.001;
    g.add(screenAnchor);
    const armTop = V(0, -0.1, -0.1).applyEuler(g.rotation).add(pos);
    const armBase = V(pos.x * 0.98, 0.9, 4.42);
    statics.add(rod(armBase, armTop, 0.022, steel, 8), box(0.18, 0.03, 0.18, darkSteel, armBase.x, 0.905, armBase.z));
    statics.add(hang(armTop.clone().add(V(0.05, 0, -0.05)), V(pos.x * 0.9, 0.9, 4.2), 0.12, 0.01, rubber));
    monitors[key] = { group: g, anchor: screenAnchor, size: [0.66, 0.4125] };
  }
  handles.monitors = monitors;

  for (let i = 0; i < 6; i++) {
    const x0 = -2.4 + i * 0.95;
    const sx = Math.sign(x0) || 1;
    statics.add(cable([V(x0, 0.86, 4.15), V(x0 + 0.1, 0.4, 4.0), V(x0 + 0.2, 0.03, 4.2), V(x0 * 0.6 + 2.8 * sx, 0.03, 6.5), V(3.9 * sx, 0.03, 7.6)], 0.016, cableMats[i % 4], 48));
  }
  for (let i = 0; i < 4; i++) {
    statics.add(hang(V(-4.15, 2.95 - i * 0.07, 4.0), V(-4.15, 2.95 - i * 0.07, 8.3), 0.18 + i * 0.05, 0.014, cableMats[i]));
    statics.add(hang(V(4.15, 2.9 - i * 0.07, 4.0), V(4.15, 2.9 - i * 0.07, 8.3), 0.12 + i * 0.06, 0.014, cableMats[(i + 1) % 4]));
  }
  // equipment rack with status LEDs
  statics.add(box(0.6, 1.9, 0.6, darkSteel, 3.75, 0.95, 5.2));
  for (let i = 0; i < 7; i++) {
    const u = box(0.5, 0.12, 0.02, panelMat, 3.45, 0.4 + i * 0.22, 5.2);
    u.rotation.y = -Math.PI / 2;
    statics.add(u);
  }
  const nLed = 84;
  const leds = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.012, 0.012), new THREE.MeshBasicMaterial({ color: 0xffffff }), nLed);
  const ledCols = [];
  for (let i = 0; i < nLed; i++) {
    const row = i % 7, col = Math.floor(i / 7);
    dm.position.set(3.435, 0.43 + row * 0.22, 5.0 + col * 0.035);
    dm.rotation.set(0, 0, 0);
    dm.updateMatrix();
    leds.setMatrixAt(i, dm.matrix);
    const c = [0x30ff70, 0xffb030, 0xff3020, 0x30ff70][Math.floor(R() * 4)];
    ledCols.push(new THREE.Color(c));
    leds.setColorAt(i, ledCols[i]);
  }
  scene.add(leds);
  handles.leds = { mesh: leds, colors: ledCols, phase: ledCols.map(() => R() * 10), rate: ledCols.map(() => 0.2 + R() * 2) };
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.35), new THREE.MeshBasicMaterial({
    map: textDecal(['LAB B-7', 'DROSOPHILA · CNS'], { w: 512, h: 256, font: `600 52px ${FONT_UI}`, color: 'rgba(25,30,35,0.9)', bg: '#8d9295' }),
    color: 0x5a5a5a,
  }));
  sign.position.set(-4.18, 2.2, 5.6);
  sign.rotation.y = Math.PI / 2;
  scene.add(sign);

  // the observer: invisible to us (we are the camera), visible to the fly's eye camera (layer 1)
  const observer = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({ color: 0xd8dcdc, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a6e5c, roughness: 0.8 });
  const oTorso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.5, 6, 16), coat);
  oTorso.position.y = 1.08;
  oTorso.scale.set(1.25, 1, 0.7);
  const oHead = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 14), skin);
  oHead.position.y = 1.66;
  const oNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), skin);
  oNeck.position.y = 1.52;
  const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.06), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.2, metalness: 0.5 }));
  goggles.position.set(0, 1.68, -0.1);
  observer.add(oTorso, oHead, oNeck, goggles);
  observer.position.set(0, 0, LAYOUT.camera.z + 0.1);
  observer.traverse((o) => o.layers.set(1));
  scene.add(observer);

  const hemi = new THREE.HemisphereLight(0x6f7f88, 0x080a0b, 0.06);
  scene.add(hemi);
  handles.hemi = hemi;
  handles.hemiBase = 0.06;

  mergeStatic(statics);
  mergeStatic(chairStatics, { castShadow: true });
  handles.spin = [chairStatics, chair];
  return handles;
}
