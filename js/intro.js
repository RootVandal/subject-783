// Title sequence. The 138,639 neurons start as a slow vortex of dust; a section plane sweeps
// down through the volume and every neuron snaps to its real FlyWire position as the plane
// passes it. Once the simulation is ready, the assembled brain flickers with the model's
// real spikes (ambient light on the eyes). Entering dives the camera into the brain.
import * as THREE from 'three';

const vert = /* glsl */ `
  attribute vec4 aSeed;
  attribute float aSpike;
  attribute float aClass;
  uniform float uTime, uScan, uScale, uWarp, uSize;
  varying vec3 vColor;
  varying float vA;
  void main() {
    // dust vortex start
    vec3 s = normalize(aSeed.xyz * 2.0 - 1.0) * (1.2 + aSeed.w * 1.3);
    s.y *= 0.55;
    float ang = uTime * (0.08 + 0.12 * aSeed.w) + aSeed.w * 6.28;
    s.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * s.xz;
    s.y += sin(uTime * 0.6 + aSeed.x * 12.0) * 0.06;
    // the scan plane moves from the top (y = +0.62) to the bottom (y = -0.62)
    float yN = 0.46 - uScan * 0.92;
    float passed = smoothstep(0.0, 0.18 + aSeed.w * 0.25, position.y - yN);
    vec3 p = mix(s, position, passed);
    float near = exp(-abs(position.y - yN) * 40.0) * step(0.0, uScan) * step(uScan, 1.0);
    float f = exp(-max(uTime - aSpike, 0.0) * 5.0);
    if (abs(aClass - 3.0) < 0.5) f *= 0.05;      // receptors: dim, so the brain's own response shows
    vColor = mix(color * 0.85, vec3(1.0, 0.9, 0.74) * 1.7, max(f, near * 0.6));
    vA = mix(0.025 + aSeed.w * 0.035, 0.1, passed) + f * 0.5 + near * 0.45;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = min(uSize * (1.0 + f * 1.2 + near * 1.4) * uScale / -mv.z, mix(2.5, 24.0, passed));
    gl_Position = projectionMatrix * mv;
  }
`;
const frag = /* glsl */ `
  varying vec3 vColor;
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25) discard;
    gl_FragColor = vec4(vColor * smoothstep(0.25, 0.0, d) * vA, 1.0);
  }
`;

export function createIntro(brainGeo) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020203);
  const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.01, 50);
  const geo = new THREE.BufferGeometry();
  for (const k of ['position', 'color', 'aSpike', 'aClass']) geo.setAttribute(k, brainGeo.getAttribute(k));
  const n = brainGeo.getAttribute('position').count;
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScan: { value: -0.2 }, uScale: { value: 500 }, uWarp: { value: 0 }, uSize: { value: 0.012 } },
    vertexShader: vert, fragmentShader: frag, vertexColors: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const spin = new THREE.Group();
  spin.add(points);
  scene.add(spin);

  // the section plane: a faint sheet with a bright leading edge
  const planeMat = new THREE.ShaderMaterial({
    uniforms: { uO: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uO; varying vec2 vUv;
      void main(){ vec2 c = abs(vUv - 0.5) * 2.0; float edge = max(smoothstep(0.96, 1.0, c.x), smoothstep(0.96, 1.0, c.y));
        float grid = step(0.97, fract(vUv.x * 24.0)) + step(0.97, fract(vUv.y * 24.0));
        float a = (0.012 + 0.5 * edge + 0.035 * grid) * uO * (1.0 - 0.7 * max(c.x, c.y));
        gl_FragColor = vec4(vec3(0.95, 0.75, 0.42) * a, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.9), planeMat);
  plane.rotation.x = -Math.PI / 2;
  spin.add(plane);

  // orbit rings with ticks (instrument reticle)
  const ringMat = new THREE.LineBasicMaterial({ color: 0x8a7a5a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  const rings = [];
  for (const [r, tilt, ticks] of [[1.25, 0.32, 72], [1.42, -0.18, 36]]) {
    const pts = [];
    for (let i = 0; i <= 256; i++) { const a = i / 256 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
    for (let i = 0; i < ticks; i++) {
      const a = i / ticks * Math.PI * 2, l = i % 6 === 0 ? 0.07 : 0.03;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), new THREE.Vector3(Math.cos(a) * (r + l), 0, Math.sin(a) * (r + l)));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const ring = new THREE.LineSegments(g, ringMat);
    ring.rotation.x = tilt;
    scene.add(ring);
    rings.push(ring);
  }

  const state = { t: 0, scan: -0.2, assembled: false, warp: -1 };

  function resize(w, h) {
    camera.aspect = w / h;
    // brain on the right half on wide screens, centred (lower) on narrow ones
    if (w / h > 1.2) camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
    else camera.setViewOffset(w, h, 0, -h * 0.16, w, h);
    camera.updateProjectionMatrix();
    mat.uniforms.uScale.value = h * 0.9;
  }

  function update(dt, loaded) {
    state.t += dt;
    const u = mat.uniforms;
    u.uTime.value = state.t;
    if (loaded && state.scan < 1.15) state.scan += dt * 0.26;
    u.uScan.value = state.scan;
    plane.position.y = 0.46 - state.scan * 0.92;
    planeMat.uniforms.uO.value = state.scan > -0.1 && state.scan < 1.05 ? 1 : Math.max(0, planeMat.uniforms.uO.value - dt * 2);
    state.assembled = state.scan >= 1.0;
    spin.rotation.y = Math.sin(state.t * 0.11) * 0.55 + state.t * 0.02;
    rings[0].rotation.y = state.t * 0.05;
    rings[1].rotation.y = -state.t * 0.03;
    let dist = 3.3;
    if (state.warp >= 0) {
      state.warp += dt;
      const k = Math.min(1, state.warp / 1.25);
      dist = 3.3 - 3.25 * k * k * k;
      ringMat.opacity = 0.35 * (1 - k);
      camera.fov = 32 + 50 * k * k;
      camera.updateProjectionMatrix();
    }
    camera.position.set(0, 0.2 * dist / 3.3, dist);
    camera.lookAt(0, 0, 0);
  }

  return {
    scene, camera, resize, update, state,
    warp() { state.warp = 0; },
    get scanPercent() { return Math.max(0, Math.min(1, state.scan)); },
    get sectionUm() { return state.scan; },
  };
}
