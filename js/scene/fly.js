// Procedural Drosophila, human-sized, seated upright in the experiment chair.
// Local frame: origin at the seat centre, +z towards the observers, +y up.
// Every motion is driven by the model's output neurons (see main.js `drive`).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// tapered cylinder geometry from a to b
function limbGeo(a, b, r0, r1, seg = 8) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}
function limb(a, b, r0, r1, mat, seg = 10) {
  const m = new THREE.Mesh(limbGeo(a, b, r0, r1, seg), mat);
  m.castShadow = true;
  return m;
}
function sphereGeo(p, r, w = 10, h = 8) {
  const g = new THREE.SphereGeometry(r, w, h);
  g.translate(p.x, p.y, p.z);
  return g;
}
function ellipsoid(rx, ry, rz, mat, wseg = 40, hseg = 28) {
  const g = new THREE.SphereGeometry(1, wseg, hseg);
  g.scale(rx, ry, rz);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function merged(geos, mat) {
  for (const g of geos) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
  m.castShadow = true;
  return m;
}

export function buildFly() {
  const root = new THREE.Group();
  root.name = 'fly';

  // wet, slightly greasy cuticle
  const chitin = new THREE.MeshPhysicalMaterial({
    color: 0x8a6a46, roughness: 0.42, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.22,
    sheen: 0.5, sheenColor: new THREE.Color(0x3a2814),
  });
  const chitinDark = new THREE.MeshPhysicalMaterial({ color: 0x1e140c, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  const legMat = new THREE.MeshPhysicalMaterial({ color: 0x33241a, roughness: 0.55, clearcoat: 0.3 });
  const bristleMat = new THREE.MeshStandardMaterial({ color: 0x0d0907, roughness: 0.6 });

  const body = new THREE.Group();
  root.add(body);

  const abdMat = chitin.clone();
  abdMat.map = TX.abdomenBands();
  abdMat.color.set(0xb9b0a0);
  const abdomen = ellipsoid(0.3, 0.44, 0.3, abdMat);
  abdomen.position.set(0, 0.86, -0.1);
  abdomen.rotation.x = -0.22;
  body.add(abdomen);

  const thoraxMat = chitin.clone();
  thoraxMat.color.set(0x7d6040);
  const thorax = ellipsoid(0.27, 0.27, 0.29, thoraxMat);
  thorax.position.set(0, 1.4, 0.0);
  body.add(thorax);
  const scut = ellipsoid(0.13, 0.07, 0.1, thoraxMat, 20, 12);
  scut.position.set(0, 1.5, -0.24);
  scut.rotation.x = 0.6;
  body.add(scut);

  // thoracic bristles (macrochaetae), instanced
  const bristleGeo = new THREE.ConeGeometry(0.008, 0.16, 5);
  bristleGeo.translate(0, 0.08, 0);
  const bristles = new THREE.InstancedMesh(bristleGeo, bristleMat, 60);
  const dummy = new THREE.Object3D();
  const rng = mulberry(11);
  for (let i = 0; i < 60; i++) {
    const th = (rng() - 0.5) * 2.6, ph = 0.2 + rng() * 1.1;
    const n = V(Math.sin(th) * Math.sin(ph), Math.cos(ph), -Math.cos(th) * Math.sin(ph) * 0.4 - 0.35).normalize();
    dummy.position.copy(V(n.x * 0.27, n.y * 0.27, n.z * 0.29).add(thorax.position));
    dummy.quaternion.setFromUnitVectors(UP, V(n.x * 0.4, 0.55, -1).normalize());
    dummy.scale.setScalar(0.6 + rng() * 0.8);
    dummy.updateMatrix();
    bristles.setMatrixAt(i, dummy.matrix);
  }
  body.add(bristles);

  // ---- head ----
  const head = new THREE.Group();
  head.position.set(0, 1.74, 0.1);
  body.add(head);
  const capsuleMat = new THREE.MeshPhysicalMaterial({
    color: 0xc9b39a, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05,
    transparent: true, opacity: 0.13, depthWrite: false,
  });
  const capsule = ellipsoid(0.26, 0.21, 0.19, capsuleMat, 32, 20);
  capsule.renderOrder = 3;
  capsule.castShadow = false;
  head.add(capsule);
  const face = ellipsoid(0.1, 0.08, 0.06, chitin, 20, 14);
  face.position.set(0, -0.1, 0.13);
  head.add(face);

  const eyeTex = TX.compoundEye();
  const eyeMat = new THREE.MeshPhysicalMaterial({
    map: eyeTex.map, bumpMap: eyeTex.bump, bumpScale: 1.2, roughness: 0.32,
    clearcoat: 1, clearcoatRoughness: 0.05, emissive: 0xff3a22, emissiveIntensity: 0.22, emissiveMap: eyeTex.map,
  });
  eyeMat.map.repeat.set(3, 2);
  eyeMat.bumpMap.repeat.set(3, 2);
  const eyes = [];
  for (const s of [-1, 1]) {
    const eye = ellipsoid(0.15, 0.2, 0.17, eyeMat, 48, 32);
    eye.position.set(s * 0.19, 0.01, 0.05);
    eye.rotation.y = s * 0.35;
    head.add(eye);
    eyes.push(eye);
  }
  head.add(merged([[0, 0.02], [-0.03, -0.02], [0.03, -0.02]].map(([x, z]) => sphereGeo(V(x, 0.205, z), 0.015)),
    new THREE.MeshStandardMaterial({ color: 0x300404, emissive: 0x200000, roughness: 0.2 })));

  // antennae with feathery arista (each antenna: 2 merged meshes)
  const antennae = [];
  for (const s of [-1, 1]) {
    const ant = new THREE.Group();
    ant.position.set(s * 0.045, 0.06, 0.17);
    const seg3 = new THREE.SphereGeometry(1, 14, 10); seg3.scale(0.03, 0.045, 0.03); seg3.translate(s * 0.025, -0.09, 0.07);
    ant.add(merged([sphereGeo(V(0, 0, 0), 0.025), limbGeo(V(0, 0, 0), V(s * 0.02, -0.05, 0.05), 0.024, 0.03), seg3], chitin));
    const ar = [];
    const o = V(s * 0.04, -0.07, 0.08);
    ar.push(limbGeo(o, o.clone().add(V(s * 0.16, 0.12, 0.05)), 0.004, 0.002, 5));
    for (let k = 1; k < 7; k++) {
      const t = k / 7;
      const p = o.clone().add(V(s * 0.16 * t, 0.12 * t, 0.05 * t));
      ar.push(limbGeo(p, p.clone().add(V(0, 0.03, 0.01)), 0.0015, 0.001, 3));
      ar.push(limbGeo(p, p.clone().add(V(0, -0.025, 0.0)), 0.0015, 0.001, 3));
    }
    ant.add(merged(ar, bristleMat));
    head.add(ant);
    antennae.push(ant);
  }

  // proboscis: rostrum -> haustellum -> labellum; folded under the head at rest
  const proboscis = new THREE.Group();
  proboscis.position.set(0, -0.12, 0.17);
  head.add(proboscis);
  const rostrum = new THREE.Group();
  proboscis.add(rostrum);
  rostrum.add(limb(V(0, 0, 0), V(0, -0.13, 0), 0.05, 0.042, chitin));
  const haust = new THREE.Group();
  haust.position.set(0, -0.13, 0);
  rostrum.add(haust);
  haust.add(merged([sphereGeo(V(0, 0, 0), 0.042, 12, 8), limbGeo(V(0, 0, 0), V(0, -0.16, 0), 0.04, 0.034)], chitinDark));
  const labellum = new THREE.Group();
  labellum.position.set(0, -0.17, 0);
  haust.add(labellum);
  const lobes = [];
  const lobeMat = new THREE.MeshPhysicalMaterial({ color: 0x8c6a4a, roughness: 0.6, clearcoat: 0.5 });
  for (const s of [-1, 1]) {
    const lobe = ellipsoid(0.045, 0.06, 0.05, lobeMat, 16, 12);
    lobe.position.set(s * 0.03, -0.03, 0);
    labellum.add(lobe);
    lobes.push(lobe);
  }

  // ---- wings: pivot (sweep) -> flap (stroke) -> tilt (lay flat) -> blade ----
  const wingMat = new THREE.MeshPhysicalMaterial({
    map: TX.wing(), transparent: true, side: THREE.DoubleSide, depthWrite: false,
    roughness: 0.15, metalness: 0.0, iridescence: 1.0, iridescenceIOR: 1.35,
    iridescenceThicknessRange: [250, 700], opacity: 0.95,
  });
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.2, 1.52, -0.12);
    const flap = new THREE.Group();
    const tilt = new THREE.Group();
    const geo = new THREE.PlaneGeometry(1.05, 0.39);
    geo.translate(0.52, 0, 0);
    if (s < 0) geo.scale(-1, 1, 1);
    const w = new THREE.Mesh(geo, wingMat);
    w.renderOrder = 2;
    tilt.add(w);
    flap.add(tilt);
    pivot.add(flap);
    body.add(pivot);
    wings.push({ pivot, flap, tilt, side: s });
  }

  // ---- legs: each leg merged into 3 meshes under a pivot at its coxa ----
  const legs = [];
  const legDefs = [
    { a: V(0.1, 1.27, 0.16), pts: [V(0.22, 1.18, 0.26), V(0.42, 1.05, 0.2), V(0.56, 0.84, 0.26), V(0.6, 0.79, 0.44)], front: true },
    { a: V(0.15, 1.24, 0.02), pts: [V(0.3, 1.12, 0.04), V(0.5, 0.98, -0.02), V(0.52, 0.62, 0.12), V(0.5, 0.52, 0.3)] },
    { a: V(0.14, 1.2, -0.1), pts: [V(0.24, 1.0, 0.0), V(0.34, 0.62, 0.42), V(0.3, 0.2, 0.52), V(0.28, 0.06, 0.74)], hind: true },
  ];
  for (const s of [-1, 1]) {
    for (const def of legDefs) {
      const a = V(def.a.x * s, def.a.y, def.a.z);
      const P = [def.a, ...def.pts].map((p) => V(p.x * s, p.y, p.z).sub(a));
      const radii = [0.042, 0.034, 0.025, 0.018, 0.012];
      const coxa = [limbGeo(P[0], P[1], radii[0], radii[1])];
      const segs = [], hairs = [];
      for (let i = 0; i < P.length - 1; i++) {
        if (i > 0) segs.push(limbGeo(P[i], P[i + 1], radii[i], radii[i + 1]));
        segs.push(sphereGeo(P[i + 1], radii[i + 1] * 1.05, 8, 6));
        for (let h = 0; h < 4; h++) {
          const p = P[i].clone().lerp(P[i + 1], (h + 0.5) / 4);
          hairs.push(limbGeo(p, p.clone().addScaledVector(V(s * 0.6, 0.3, -0.4).normalize(), 0.05), 0.003, 0.001, 3));
        }
      }
      const tip = P[P.length - 1];
      hairs.push(limbGeo(tip, tip.clone().add(V(s * 0.03, -0.03, 0.03)), 0.008, 0.002, 4));
      const pivot = new THREE.Group();
      pivot.position.copy(a);
      pivot.add(merged(coxa, chitin), merged(segs, legMat), merged(hairs, bristleMat));
      body.add(pivot);
      legs.push({ pivot, side: s, front: !!def.front, hind: !!def.hind, tipRest: tip.clone() });
    }
  }

  // parts that can be severed (scale -> 0; a detached copy falls)
  const parts = [];
  legs.forEach((l) => parts.push({ id: `leg${l.side > 0 ? 'L' : 'R'}${l.front ? 1 : l.hind ? 3 : 2}`, kind: 'leg', side: l.side, obj: l.pivot }));
  wings.forEach((w) => parts.push({ id: `wing${w.side > 0 ? 'L' : 'R'}`, kind: 'wing', side: w.side, obj: w.pivot }));
  antennae.forEach((a, i) => parts.push({ id: `ant${i ? 'L' : 'R'}`, kind: 'antenna', side: i ? 1 : -1, obj: a }));
  parts.forEach((p) => { p.cut = false; p.meshes = []; p.obj.traverse((o) => { if (o.isMesh) p.meshes.push(o); }); });

  const brainAnchor = new THREE.Group();
  brainAnchor.position.set(0, 0.02, -0.01);
  head.add(brainAnchor);
  const eyeAnchor = new THREE.Object3D();
  eyeAnchor.position.set(0, 0.03, 0.2);
  head.add(eyeAnchor);

  // ---- animation ----
  const state = { ext: 0, jolt: 0, t: 0, twitch: 0, groom: 0, spasm: 0, flight: 0, legT: 0, legTarget: -1, kick: 0, dead: 0, limp: 0, trem: 0, spin: 0 };
  const rest = { rostrum: 1.35, haust: -2.55, labellum: 0.5 };
  const out = { rostrum: -0.95, haust: 0.25, labellum: -0.2 };
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), eul = new THREE.Euler();
  // for grooming: rotation that brings each front leg's tip from the armrest to the face
  const toHead = legs.filter((l) => l.front).map((l) => {
    const target = V(-l.side * 0.02, 1.86, 0.36).sub(l.pivot.position);
    return new THREE.Quaternion().setFromUnitVectors(l.tipRest.clone().normalize(), target.normalize());
  });
  // death: legs fold in under the thorax; coma: they hang; centrifuge: they are flung outwards
  const towards = (l, target) => new THREE.Quaternion().setFromUnitVectors(l.tipRest.clone().normalize(), target.sub(l.pivot.position).normalize());
  legs.forEach((l, i) => {
    l.curl = towards(l, V(-l.side * 0.04, 1.02 + (l.front ? 0.18 : l.hind ? -0.05 : 0.06), 0.42));
    l.droop = towards(l, l.pivot.position.clone().add(l.tipRest).add(V(0, -0.28, 0.06)));
    l.splay = towards(l, l.pivot.position.clone().add(l.tipRest).add(V(l.side * 0.45, 0.3, (i % 3 - 1) * 0.2)));
  });
  const qc = new THREE.Quaternion();

  function update(dt, drive) {
    state.t += dt;
    const t = state.t;
    state.flight += ((drive.flight ? 1 : 0) - state.flight) * Math.min(1, dt * 2.2);
    const fl = state.flight;
    state.dead += ((drive.dead || 0) - state.dead) * Math.min(1, dt * 1.6);
    state.limp += (Math.max(drive.limp || 0, drive.dead || 0) - state.limp) * Math.min(1, dt * 1.8);
    state.trem += ((drive.tremor || 0) - state.trem) * Math.min(1, dt * 6);
    state.spin += ((drive.spin || 0) - state.spin) * Math.min(1, dt * 3);
    const dead = state.dead, limp = state.limp, trem = state.trem, spin = state.spin;
    const alive = 1 - limp;
    eyeMat.emissiveIntensity = 0.22 * (1 - 0.85 * dead);

    // proboscis follows MN9 (a dead fly's proboscis hangs half out)
    state.ext += (Math.max(drive.proboscis * (1 - fl) * alive, dead * 0.55) - state.ext) * Math.min(1, dt * 6);
    const e = state.ext;
    rostrum.rotation.x = THREE.MathUtils.lerp(rest.rostrum, out.rostrum, e);
    haust.rotation.x = THREE.MathUtils.lerp(rest.haust, out.haust, e);
    labellum.rotation.x = THREE.MathUtils.lerp(rest.labellum, out.labellum, e);
    lobes.forEach((l, i) => { l.position.x = (i ? 1 : -1) * (0.03 + e * 0.025); });
    labellum.scale.setScalar(1 + e * 0.12 * Math.max(0, Math.sin(t * 9)));

    // escape circuit -> jolt; shock -> spasm (direct muscle response); stress -> twitches
    state.jolt += (drive.escape * alive - state.jolt) * Math.min(1, dt * (drive.escape > state.jolt ? 18 : 3));
    state.spasm = Math.max(drive.shock || 0, state.spasm - dt * 2.5);
    const stress = (drive.stress || 0) * alive;
    state.twitch -= dt * (0.5 + 4 * stress);
    if (state.twitch < 0) {
      state.twitch = 0.6 + Math.random() * 2.4;
      state.legTarget = Math.floor(Math.random() * legs.length);
      state.legT = 0;
      state.kick = 0.2 + 1.2 * stress;
      if (stress > 0.35) state.jolt = Math.max(state.jolt, 0.25 + 0.5 * stress);   // a startle
    }
    state.legT += dt;
    const j = Math.min(1, state.jolt + state.spasm);
    const sp = state.spasm;
    const tr = trem * (0.6 + 0.4 * Math.sin(t * 13.7));
    body.position.set(
      j * 0.014 * Math.sin(t * 57) + sp * 0.02 * Math.sin(t * 91) + tr * 0.018 * Math.sin(t * 97),
      j * 0.05 * Math.abs(Math.sin(t * 40)) + tr * 0.012 * Math.sin(t * 83) - limp * 0.06,
      tr * 0.01 * Math.sin(t * 71));
    body.rotation.set(-j * 0.06 + sp * 0.05 * Math.sin(t * 77) + tr * 0.05 * Math.sin(t * 61) + limp * 0.12,
      sp * 0.06 * Math.sin(t * 63) + tr * 0.04 * Math.sin(t * 89), sp * 0.05 * Math.sin(t * 83) + tr * 0.04 * Math.sin(t * 79) + dead * 0.05);

    state.groom += ((drive.groom || 0) * (1 - fl) * alive - state.groom) * Math.min(1, dt * 4);
    const gr = Math.min(1, state.groom);

    // wings: folded / flared (jolt) / beating in flight
    const beatPhase = t * 2 * Math.PI * 13;
    for (const w of wings) {
      const s = w.side;
      const restSweep = 2.45 - j * 0.9 + j * 0.35 * Math.sin(t * 70) - dead * 0.55 - spin * 1.0
        + trem * 0.22 * Math.sin(t * 88 + s);
      // in flight the blade stays in the body's frontal plane and beats about the body axis
      w.pivot.rotation.y = s * THREE.MathUtils.lerp(restSweep, 0.95 * Math.sin(beatPhase), fl);
      w.flap.rotation.z = s * THREE.MathUtils.lerp(-0.4 - j * 0.5 - limp * 0.35 - spin * 0.3, -0.3, fl);
      w.tilt.rotation.x = THREE.MathUtils.lerp(0.2 - j * 0.3 + limp * 0.2, 0, fl);
    }

    // antennae: sound vibrates them, wind deflects them, grooming pulls them down
    antennae.forEach((a, i) => {
      const s = i ? 1 : -1;
      const wind = drive.wind || 0;
      a.rotation.z = s * (0.15 + wind * 0.35 + spin * 0.4) + Math.sin(t * 3 + i) * 0.04 * alive
        + drive.sound * 0.18 * Math.sin(t * 55 + i) + wind * 0.1 * Math.sin(t * 23 + i) + trem * 0.15 * Math.sin(t * 77 + i);
      a.rotation.x = 0.1 + drive.odor * 0.25 * Math.sin(t * 4 + i * 2) + gr * 0.4 * Math.max(0, Math.sin(t * 9 + i * Math.PI)) + limp * 0.45;
    });

    const breathe = alive * (1 - 0.6 * trem);
    abdomen.scale.set(1, 1 + Math.sin(t * 1.3) * 0.012 * breathe, 1 + Math.sin(t * 1.3) * 0.02 * breathe);
    head.rotation.y = (Math.sin(t * 0.37) * 0.06 + j * 0.08 * Math.sin(t * 31)) * alive + trem * 0.1 * Math.sin(t * 67) + dead * 0.18;
    head.rotation.x = (Math.sin(t * 0.23) * 0.03 + e * 0.12 + gr * 0.18) * alive + limp * 0.5;
    head.rotation.z = dead * 0.22 + trem * 0.06 * Math.sin(t * 53);

    let fi = 0;
    legs.forEach((l, i) => {
      const kick = i === state.legTarget ? state.kick * Math.max(0, Math.sin(Math.min(1, state.legT * 3) * Math.PI)) : 0;
      eul.set((kick * 0.25 + j * 0.06 * Math.sin(t * 45 + i)) * alive + sp * 0.3 * Math.sin(t * 60 + i * 1.7) + trem * 0.22 * Math.sin(t * 73 + i * 2.3),
        trem * 0.12 * Math.sin(t * 59 + i), sp * 0.15 * Math.sin(t * 70 + i) + trem * 0.18 * Math.sin(t * 91 + i * 1.3));
      qa.setFromEuler(eul);
      if (spin > 0) { qc.identity().slerp(l.splay, spin * (0.8 + 0.2 * Math.sin(t * 17 + i))); qa.premultiply(qc); }
      if (limp > 0) { qc.identity().slerp(l.droop, limp * (1 - dead)); qa.premultiply(qc); }
      if (dead > 0) { qc.identity().slerp(l.curl, dead * (0.92 + 0.08 * Math.sin(i * 1.7))); qa.premultiply(qc); }
      if (l.front) {
        const rub = 0.85 + 0.15 * Math.sin(t * 11 + (l.side > 0 ? Math.PI : 0));
        qb.identity().slerp(toHead[fi++], gr * rub * alive);
        qa.premultiply(qb);
      }
      if (fl > 0) {
        eul.set(l.hind ? 0.9 : l.front ? -0.3 : 0.5, 0, -l.side * 0.35);
        qb.setFromEuler(eul);
        qa.slerp(qb, fl);
      }
      l.pivot.quaternion.copy(qa);
    });
  }

  function resetPose() {
    Object.assign(state, { ext: 0, jolt: 0, twitch: 0, groom: 0, spasm: 0, flight: 0, legT: 0, legTarget: -1, kick: 0, dead: 0, limp: 0, trem: 0, spin: 0 });
    head.rotation.set(0, 0, 0);
    parts.forEach((p) => { p.cut = false; p.obj.scale.setScalar(1); });
    body.position.set(0, 0, 0);
    body.rotation.set(0, 0, 0);
  }

  const headParts = [capsule, face, ...eyes, ...antennae, brainAnchor];
  return { root, body, head, brainAnchor, eyeAnchor, headParts, proboscisTip: labellum, update, resetPose, state, parts };
}

// One merged geometry of a dead subject (legs curled), for the specimen tanks.
export function flySilhouette() {
  const f = buildFly();
  const drive = { proboscis: 0, escape: 0, sound: 0, odor: 0, groom: 0, stress: 0, shock: 0, wind: 0, flight: false, dead: 1 };
  for (let i = 0; i < 90; i++) f.update(1 / 30, drive);
  f.root.updateMatrixWorld(true);
  const geos = [];
  f.root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || (o.material.transparent && o.material.opacity < 0.5)) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    geos.push(g);
  });
  return mergeGeometries(geos, false);
}

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
