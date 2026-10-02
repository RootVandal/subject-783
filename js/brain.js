// Neuron point cloud: 138,639 neurons at their FlyWire positions. A spike sets the
// neuron's "last spike" time; the shader turns that into a flash that decays. A neuron that has
// been blocked (toxin, overload, light damage) flares red once and then stays dark.
import * as THREE from 'three';

export const CLASS_COLORS = [   // muted: the clinical palette of a fixed-tissue atlas
  0x3d7f7a, // optic lobes
  0x52639e, // central brain
  0xb08a4c, // mushroom bodies
  0x66957a, // sensory
  0xb0583c, // descending / ascending
  0x7f669a, // central complex
  0xa39552, // antennal lobe
  0xa85676, // motor
];

async function gunzipFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(ds).arrayBuffer());
  }
  return buf;
}

export async function loadNeurons(url) {
  const bytes = await gunzipFetch(url);
  const n = Math.round(bytes.length / 7);
  const q = new Int16Array(bytes.buffer, 0, n * 3);
  const cls = new Uint8Array(bytes.buffer, n * 6, n);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) pos[i] = q[i] / 32767;
  return { n, pos, cls: new Uint8Array(cls) };
}

const vert = /* glsl */ `
  attribute float aSpike;
  attribute float aClass;
  attribute float aDead;
  uniform float uSensoryFlash;  // receptors flash dimmer so downstream processing stays visible
  uniform float uTime;
  uniform float uSize;
  uniform float uScale;
  uniform float uBase;
  uniform float uGain;
  uniform float uRefDist;   // > 0: keep the cloud's overall brightness constant when viewed up close
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float f = exp(-max(uTime - aSpike, 0.0) * 5.0);
    if (abs(aClass - 3.0) < 0.5) f *= uSensoryFlash;
    // aDead > 0: died at that time; aDead < 0: silenced (reversibly) at -aDead
    float dead = step(abs(aDead), uTime);
    float sup = step(aDead, 0.0);
    float dying = dead * exp(-max(uTime - abs(aDead), 0.0) * 2.2);
    f *= 1.0 - dead;
    vColor = mix(color * 0.9, vec3(1.0, 0.93, 0.8) * 2.4, f);
    vColor = mix(vColor, mix(vec3(0.3, 0.045, 0.035), vec3(0.03, 0.06, 0.16), sup), dead)
           + mix(vec3(2.4, 0.28, 0.1), vec3(0.4, 0.9, 2.2), sup) * dying;
    // projected brain size ~ uScale / depth; keep summed brightness roughly constant
    float dn = uRefDist > 0.0 ? clamp(pow(-mv.z * 990.0 / (uRefDist * uScale), 2.0), 0.02, 1.0) : 1.0;
    vAlpha = (uBase * dn * (1.0 - 0.45 * dead) + (f + dying) * (0.35 + 0.65 * dn)) * uGain;
    float ps = uSize * (1.0 + (f + dying) * 2.2) * uScale / -mv.z;
    gl_PointSize = uRefDist > 0.0 ? min(ps, 3.5) : ps;
    gl_Position = projectionMatrix * mv;
  }
`;
const frag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25) discard;
    float a = smoothstep(0.25, 0.0, d);
    gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
  }
`;

export function makeBrainGeometry(data) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.pos, 3));
  const col = new Float32Array(data.n * 3);
  const c = new THREE.Color();
  const pal = CLASS_COLORS.map((h) => new THREE.Color(h));
  for (let i = 0; i < data.n; i++) {
    c.copy(pal[data.cls[i]] || pal[1]);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aClass', new THREE.BufferAttribute(Float32Array.from(data.cls), 1));
  const spike = new Float32Array(data.n).fill(-1e4);
  const attr = new THREE.BufferAttribute(spike, 1);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aSpike', attr);
  const dead = new THREE.BufferAttribute(new Float32Array(data.n).fill(1e9), 1);
  dead.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aDead', dead);
  geo.computeBoundingSphere();
  return geo;
}

export function makeBrainMaterial({ size = 1.0, base = 0.18, refDist = 0, gain = 1, sensoryFlash = 0.45 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: size },
      uScale: { value: 1 },
      uBase: { value: base },
      uRefDist: { value: refDist },
      uGain: { value: gain },
      uSensoryFlash: { value: sensoryFlash },
    },
    vertexShader: vert,
    fragmentShader: frag,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

// Writes spike times into the shared attribute; uploads once per frame.
export class SpikePainter {
  constructor(geo) {
    this.attr = geo.getAttribute('aSpike');
    this.dead = geo.getAttribute('aDead');
    this.dirty = false;
    this.deadDirty = false;
  }
  kill(i, now, silenced = false) { this.dead.array[i] = silenced ? -now : now; this.deadDirty = true; }
  revive(i) { this.dead.array[i] = 1e9; this.deadDirty = true; }
  reviveAll() { this.dead.array.fill(1e9); this.deadDirty = true; }
  paint(spikes, now) {
    const a = this.attr.array;
    for (let k = 0; k < spikes.length; k++) a[spikes[k]] = now;
    if (spikes.length) this.dirty = true;
  }
  clear() { this.attr.array.fill(-1e4); this.dirty = true; }
  flush() {
    if (this.dirty) { this.attr.needsUpdate = true; this.dirty = false; }
    if (this.deadDirty) { this.dead.needsUpdate = true; this.deadDirty = false; }
  }
}
