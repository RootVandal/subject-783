import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildLab, LAYOUT } from './scene/lab.js';
import { buildFly, flySilhouette } from './scene/fly.js';
import { buildConsole, BUTTONS } from './scene/console.js';
import { createMonitors } from './scene/monitors.js';
import { loadNeurons, makeBrainGeometry, makeBrainMaterial, SpikePainter } from './brain.js';
import { LabAudio } from './audio.js';
import { VRStimulus } from './vr.js';
import { createPOV } from './pov.js';
import { createIntro } from './intro.js';
import { t, apply as applyI18n, setLang, onLang, getLang } from './i18n.js';

const $ = (s) => document.querySelector(s);
const bootlog = $('#bootlog');
const logLines = [];
function log(key, extra = '', ok = false) { logLines.push({ key, extra, ok }); renderLog(); }
function renderLog() {
  bootlog.innerHTML = logLines.map((l) => `<span class="${l.ok ? 'ok' : 'wait'}">${l.ok ? '[ OK ]' : '[ .. ]'}</span> ${t(l.key)}${l.extra ? ' <em>' + l.extra + '</em>' : ''}`).join('\n');
}
const fmt = (n) => n.toLocaleString(getLang() === 'ru' ? 'ru-RU' : 'en-US');
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const pad = (n) => String(n).padStart(3, '0');
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// canvas labels in the scene need the UI font before they are drawn
await Promise.race([
  Promise.all([400, 500, 600, 700].map((w) => document.fonts.load(`${w} 20px "IBM Plex Mono"`))),
  new Promise((r) => setTimeout(r, 2500)),
]).catch(() => {});

applyI18n();

// experiment counter and the preserved subjects (persist between visits)
let expNo = 1, tankList = [];
try {
  expNo = Math.max(1, parseInt(localStorage.getItem('s783-exp') || '1', 10) || 1);
  tankList = JSON.parse(localStorage.getItem('s783-tanks') || '[]').filter(Number.isFinite).slice(0, 6);
} catch { /* storage blocked */ }
function showExpNo() {
  $('#exp-num').textContent = `#${pad(expNo)}`;
  $('#explode-num').textContent = pad(expNo);
}
showExpNo();

// ---------------------------------------------------------------- renderer
const canvas = $('#scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  bootlog.textContent = 'WebGL is not available in this browser.';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;     // updated once per frame, not for every render target

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x030405, 0.055);
const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.03, 140);
camera.position.copy(LAYOUT.camera);
camera.layers.enable(2);   // light cone (hidden from the subject's eye cameras)

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.42, 0.5, 0.82);
const bloomSetSize = bloom.setSize.bind(bloom);
bloom.setSize = (w, h) => bloomSetSize(Math.round(w * 0.5), Math.round(h * 0.5));   // half-res bloom
composer.addPass(bloom);
// lens: chromatic edge, cold grade, vignette, grain, tearing on overload, red siren tint
const lensPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uFade: { value: 0 }, uRed: { value: 0 }, uTime: { value: 0 }, uGlitch: { value: 0 }, uGrain: { value: 0.05 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uFade, uRed, uTime, uGlitch, uGrain; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      float band = floor(uv.y * 38.0);
      float g = uGlitch * step(0.78, hash(vec2(band, floor(uTime * 14.0))));
      uv.x += g * (hash(vec2(band * 3.1, floor(uTime * 31.0))) - 0.5) * 0.05;
      vec2 c = uv - 0.5;
      float ca = 0.001 + 0.0026 * dot(c, c) + g * 0.008;
      vec3 col = vec3(texture2D(tDiffuse, uv + c * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - c * ca).b);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 0.8);
      col += vec3(-0.003, 0.004, 0.003) * (1.0 - smoothstep(0.0, 0.2, l));
      float vig = smoothstep(1.08, 0.28, length(c * vec2(1.0, 1.25)));
      col *= mix(0.38, 1.0, vig) * uFade;
      col = mix(col, col * vec3(1.35, 0.6, 0.55), uRed);
      col += (hash(vUv * vec2(1733.0, 977.0) + fract(uTime * 7.31)) - 0.5) * uGrain * (0.15 + min(col, vec3(1.0)));
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
});
composer.addPass(lensPass);
composer.addPass(new OutputPass());

// picture-in-picture of the brain monitor (flight, death)
const pipScene = new THREE.Scene();
const pipCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const pipQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ toneMapped: false }));
pipScene.add(pipQuad);

// ---------------------------------------------------------------- world
const lab = buildLab(scene);
const fly = buildFly();
fly.root.position.copy(LAYOUT.chair);
scene.add(fly.root);
const desk = buildConsole(scene);
onLang(() => desk.relabel());
// preserved subjects in the tanks
const tankFlies = new THREE.InstancedMesh(flySilhouette(), new THREE.MeshStandardMaterial({ color: 0x1a130c, roughness: 0.55 }), 6);
tankFlies.count = 0;
tankFlies.frustumCulled = false;
scene.add(tankFlies);
function syncTanks() {
  tankFlies.count = tankList.length;
  lab.tanks.setLabels(tankList.length, tankList[0] || 0);
}
syncTanks();
log('log_scene', '', true);

const audio = new LabAudio();
const vr = new VRStimulus();

// facet mask shared by the eye monitor and the POV: 64 x 64 per eye (R dead, G flash, B silenced)
const MASK_W = 128, MASK_H = 64;
const maskData = new Uint8Array(MASK_W * MASK_H * 4);
const maskTex = new THREE.DataTexture(maskData, MASK_W, MASK_H);
maskTex.minFilter = maskTex.magFilter = THREE.NearestFilter;
maskTex.needsUpdate = true;
const deadCnt = new Uint8Array(MASK_W * MASK_H), suppCnt = new Uint8Array(MASK_W * MASK_H);
const maskFlash = new Set();
let maskDirty = false;

// ---------------------------------------------------------------- data + simulation
let meta, neurons, brainGeo, painter, monitors, worker, pov = null, intro = null;
let membership, isStim, visionSet;
const READOUTS = ['proboscis', 'escape', 'auditory', 'interest', 'vision', 'taste', 'groom', 'alarm', 'ppl1',
  'dna02L', 'dna02R', 'dng02L', 'dng02R', 'gfL', 'gfR'];
const RASTER = ['proboscis', 'escape', 'auditory', 'interest', 'vision', 'groom', 'alarm'];
const rowColors = { proboscis: '#c8577e', escape: '#ff3b30', auditory: '#8fb0c0', interest: '#d8a24a', vision: '#5f9c96', groom: '#9cc27a', alarm: '#e07a3a' };
const readout = Object.fromEntries(READOUTS.map((k) => [k, { rate: 0, size: 1, max: 1, times: [] }]));
const stats = { simMs: 0, speed: 0, spikesPerS: 0, central: 0 };
let simReady = false, entered = false;
let stress = 0;
const LOAD_CAP = 60000;   // central (non-receptor) spikes/s counted as 100 % CNS load

const progress = { synapses: 0, neurons: 0, got: 0, total: 0 };
function setProgress() {
  const p = Math.min(1, progress.synapses * 0.85 + progress.neurons * 0.15);
  $('#progressbar').style.width = `${(p * 100).toFixed(1)}%`;
  $('#prog-pct').textContent = `${Math.round(p * 100)}%`;
  if (progress.total) $('#prog-mb').textContent = `${(progress.got / 1048576).toFixed(1)} / ${(progress.total / 1048576).toFixed(1)} MB`;
}

// per-neuron intervention state: 0 alive, 1 silenced (hypoxia, reversible), 2 dead, 3 burned (laser)
let kind, blockedCount = 0, visBlocked = 0, visCount = 1;
let spikeCount;               // spikes per neuron since a seizure-type death began
const EXCITO_SPIKES = 25;
let texOf;   // neuron -> facets it feeds (photoreceptor or optic-lobe neuron)
let burnOrder = [];
let joSide = { L: [], R: [] };   // Johnston's-organ neurons of each antenna   // left-eye photoreceptor facets, nearest to the laser spot first

async function boot() {
  log('log_fetch');
  meta = await (await fetch('data/brain.json')).json();
  logLines[logLines.length - 1].ok = true;
  logLines[logLines.length - 1].extra = 'FlyWire v783';
  renderLog();

  worker = new Worker('js/sim/worker.js');
  const ready = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') { progress.synapses = m.total ? m.got / m.total : 0.5; progress.got = m.got; progress.total = m.total; setProgress(); }
      else if (m.type === 'ready') resolve(m);
      else if (m.type === 'error') reject(new Error(m.message));
    };
  });
  const synapsesUrls = (meta.synapse_parts || ['synapses.bin.gz']).map((p) => new URL(`data/${p}`, location.href).href);
  worker.postMessage({ type: 'load', synapsesUrls, stim: meta.stim });

  log('log_neurons');
  neurons = await loadNeurons('data/neurons.bin.gz');
  progress.neurons = 1; setProgress();
  logLines[logLines.length - 1].ok = true;
  logLines[logLines.length - 1].extra = `${fmt(neurons.n)} ${t('log_cells')}`;
  renderLog();

  brainGeo = makeBrainGeometry(neurons);
  painter = new SpikePainter(brainGeo);
  intro = createIntro(brainGeo);
  intro.resize(innerWidth, innerHeight);
  // seen through the translucent head capsule (the opaque eyes and face still hide it)
  const headMat = makeBrainMaterial({ size: 0.006, base: 0.32, refDist: 6, gain: 0.45, sensoryFlash: 0.06 });
  const headBrain = new THREE.Points(brainGeo, headMat);
  headBrain.renderOrder = 20;
  headBrain.scale.set(0.205, 0.205, -0.205);
  headBrain.frustumCulled = false;
  fly.brainAnchor.add(headBrain);
  fly.headBrainMat = headMat;
  monitors = createMonitors({ lab, brainGeo, fly, mask: maskTex });
  pov = createPOV({ fly, mask: maskTex });
  pipQuad.material.map = monitors.brainTexture;

  membership = new Uint16Array(neurons.n);
  const normScen = Object.entries(meta.scenarios).filter(([n]) => !['everything', 'all_but_odor', 'flight', 'strobe', 'laserL', 'spin'].includes(n));
  READOUTS.forEach((k, bit) => {
    const idx = meta.readout[k];
    for (const i of idx) membership[i] |= 1 << bit;
    readout[k].size = idx.length;
    readout[k].max = Math.max(1, ...normScen.map(([, s]) => s.readout_hz[k] || 0));
  });
  isStim = new Uint8Array(neurons.n);
  for (const idx of Object.values(meta.stim)) for (const i of idx) isStim[i] = 1;
  kind = new Uint8Array(neurons.n);
  spikeCount = new Uint8Array(neurons.n);
  buildEyeMap();

  log('log_synapses');
  const r = await ready;
  progress.synapses = 1; setProgress();
  logLines[logLines.length - 1].ok = true;
  logLines[logLines.length - 1].extra = `${fmt(r.connections)} ${t('log_conns')}`;
  log('log_ready', '', true);
  worker.onmessage = onWorker;
  worker.postMessage({ type: 'group', name: 'joL', idx: joSide.L });
  worker.postMessage({ type: 'group', name: 'joR', idx: joSide.R });
  // the brain runs during the title sequence too: ambient light on the eyes, real spikes
  worker.postMessage({ type: 'rates', rates: { eyeL: 3, eyeR: 3 } });
  worker.postMessage({ type: 'start' });
  simReady = true;
  resize();
  updateEnterLabel();
  if (location.hash.startsWith('#lab')) { warmed = true; enter(true); } else prewarm();
}

// Build every shader program and upload every texture of the lab while the title sequence is
// still running, so the dive lands straight in the lab instead of stalling on the first frame.
let warmed = false;
async function prewarm() {
  try {
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    const rt = new THREE.WebGLRenderTarget(320, 180, { type: THREE.HalfFloatType });
    renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    for (let k = 0; k < 3; k++) monitors.render(renderer, scene, 0, null, { eyes: true });
    pov.render(renderer, scene, 0, { alive: 1, seizure: 0, fade: 0, flash: 0, red: 0, shake: 0 });
    renderer.setRenderTarget(rt);
    renderer.render(pov.scene, pov.camera);
    renderer.setRenderTarget(null);
    rt.dispose();
  } catch (e) { console.warn('prewarm', e); }
  warmed = true;
  updateEnterLabel();
}

// facets: each eye's 64 x 64 mask texels get one photoreceptor (random) and one optic-lobe
// neuron of that side (in 3 x 3 patches, so a dying optic neuron blanks a patch of facets)
function buildEyeMap() {
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const meanX = (idx) => idx.reduce((acc, i) => acc + neurons.pos[i * 3], 0) / idx.length;
  const leftSign = Math.sign(meanX(meta.stim.eyeL) - meanX(meta.stim.eyeR)) || -1;
  const jo = [...meta.stim.hearing, ...meta.stim.wind];
  joSide = { L: jo.filter((i) => Math.sign(neurons.pos[i * 3]) === leftSign), R: jo.filter((i) => Math.sign(neurons.pos[i * 3]) !== leftSign) };
  const PR = [shuffle([...meta.stim.eyeL]), shuffle([...meta.stim.eyeR])];
  const OL = [[], []];
  for (const i of meta.readout.vision) OL[Math.sign(neurons.pos[i * 3]) === leftSign ? 0 : 1].push(i);
  OL.forEach(shuffle);
  visionSet = new Uint8Array(neurons.n);
  for (const i of meta.readout.vision) visionSet[i] = 1;
  visCount = meta.readout.vision.length;
  texOf = new Map();
  const add = (i, tx) => { let l = texOf.get(i); if (!l) texOf.set(i, l = []); l.push(tx); };
  const prTex = [];
  for (let e = 0; e < 2; e++) {
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const tx = y * MASK_W + e * 64 + x;
      const pr = PR[e][(y * 64 + x) % PR[e].length];
      add(pr, tx);
      if (e === 0) prTex.push({ i: pr, d: Math.hypot(x / 64 - 0.19, y / 64 - 0.65) + rnd() * 0.04 });
      const ol = OL[e][(Math.floor(y / 3) * 22 + Math.floor(x / 3)) % OL[e].length];
      if (ol != null) add(ol, tx);
    }
  }
  burnOrder = prTex.sort((a, b) => a.d - b.d);
}

function setKind(i, k, now) {
  const old = kind[i];
  if (old === k) return;
  if (k === 0 && old !== 1) return;          // only silenced neurons come back
  if (k === 1 && old !== 0) return;          // the dead stay dead
  kind[i] = k;
  if (old === 0) blockedCount++; else if (k === 0) blockedCount--;
  if (visionSet[i]) visBlocked += (k ? 1 : 0) - (old ? 1 : 0);
  if (k === 0) painter.revive(i); else painter.kill(i, now, k === 1);
  const tl = texOf.get(i);
  if (!tl) return;
  for (const tx of tl) {
    if (old === 1) suppCnt[tx]--; else if (old >= 2) deadCnt[tx]--;
    if (k === 1) suppCnt[tx]++; else if (k >= 2) deadCnt[tx]++;
    const o = tx * 4;
    maskData[o] = deadCnt[tx] > 0 ? 255 : 0;
    maskData[o + 2] = suppCnt[tx] > 0 ? 255 : 0;
    if (k) { maskData[o + 1] = 255; maskFlash.add(tx); }
  }
  maskDirty = true;
}

// ---- block schedules: neurons stop (or resume) firing at given delays, exactly in the worker
const schedules = [];
let schedSeq = 0;
function schedule(idx, delays, k) {
  const n = idx.length, key = new Float64Array(n);
  for (let j = 0; j < n; j++) key[j] = Math.round(Math.max(0, delays[j]) * 10) * 262144 + idx[j];
  key.sort();
  const sIdx = new Int32Array(n), sDel = new Float32Array(n);
  for (let j = 0; j < n; j++) { sIdx[j] = key[j] % 262144; sDel[j] = Math.floor(key[j] / 262144) / 10; }
  const s = { id: ++schedSeq, idx: sIdx, del: sDel, n, pos: 0, base: null, kind: k };
  schedules.push(s);
  worker.postMessage({ type: 'block', id: s.id, idx: sIdx, delayMs: sDel, release: k === 0 });
  return s;
}
function runSchedules(now) {
  for (let j = schedules.length - 1; j >= 0; j--) {
    const s = schedules[j];
    if (s.base == null) continue;
    while (s.pos < s.n && s.base + s.del[s.pos] <= stats.simMs) setKind(s.idx[s.pos++], s.kind, now);
    if (s.pos >= s.n) schedules.splice(j, 1);
  }
}
function clearInterventions() {
  schedules.length = 0;
  if (!kind) return;
  kind.fill(0); blockedCount = 0; visBlocked = 0;
  painter.reviveAll();
  maskData.fill(0); deadCnt.fill(0); suppCnt.fill(0); maskFlash.clear(); maskDirty = true;
  exp.burned = 0; exp.burnK = 0;
}

function updateEnterLabel() {
  const b = $('#enter');
  const ok = simReady && warmed;
  b.disabled = !ok;
  b.querySelector('b').textContent = ok ? t('enter') : t('loading');
  b.classList.toggle('ready', ok);
}

function onWorker(e) {
  const m = e.data;
  if (m.type === 'blocked') { const s = schedules.find((x) => x.id === m.id); if (s) s.base = m.baseMs; return; }
  if (m.type !== 'spikes') return;
  const now = clock.elapsedTime;
  const spikes = m.spikes;
  painter.paint(spikes, now);
  const dSim = Math.max(m.dSimMs, 1e-3);
  const counts = new Float64Array(READOUTS.length);
  const sampled = new Int32Array(READOUTS.length);
  let central = 0;
  // seizure under a toxin / overload burn-out: a neuron that keeps firing dies (excitotoxicity)
  const excito = (death.phase === 'inject' || death.phase === 'pov') && (death.cause === 'neo' || death.cause === 'overload') && death.sched;
  const burnt = excito ? [] : null;
  for (let k = 0; k < spikes.length; k++) {
    const i = spikes[k];
    if (!isStim[i]) central++;
    if (excito && kind[i] === 0 && ++spikeCount[i] === EXCITO_SPIKES) burnt.push(i);
    const b = membership[i];
    if (!b) continue;
    for (let j = 0; j < READOUTS.length; j++) {
      if (b & (1 << j)) {
        counts[j]++;
        if (sampled[j] < 60 && Math.random() < 120 / (counts[j] + 60)) {
          sampled[j]++;
          readout[READOUTS[j]].times.push(m.simMs - Math.random() * dSim);
        }
      }
    }
  }
  const alpha = 1 - Math.exp(-dSim / 120);
  READOUTS.forEach((k, j) => {
    const r = readout[k];
    r.rate += (counts[j] / r.size / (dSim / 1000) - r.rate) * alpha;
    if (r.times.length > 700) r.times.splice(0, r.times.length - 700);
  });
  if (death.phase === 'inject' || death.phase === 'pov') death.total += spikes.length;
  if (burnt && burnt.length) schedule(Int32Array.from(burnt), new Float32Array(burnt.length), 2);
  stats.simMs = m.simMs;
  stats.speed += (m.speed - stats.speed) * 0.2;
  stats.spikesPerS += (spikes.length / (dSim / 1000) - stats.spikesPerS) * 0.2;
  stats.central += (central / (dSim / 1000) - stats.central) * Math.min(1, alpha * 2);
}

function clearBrain() {
  worker.postMessage({ type: 'reset' });
  painter.clear();
  READOUTS.forEach((k) => { readout[k].rate = 0; readout[k].times.length = 0; });
  stress = 0;
  stats.central = 0;
  ovl.load = 0;
  clearInterventions();
}

// ---------------------------------------------------------------- protocol journal
const journal = [];
function note(text, level = '') {
  const tt = entered ? mmss((performance.now() - recStart) / 1000) : '--:--.-';
  journal.unshift({ tt, text, level });
  if (journal.length > 7) journal.length = 7;
  $('#journal').innerHTML = journal.map((j) => `<li class="${j.level}"><time>${j.tt}</time>${j.text}</li>`).join('');
}
let recStart = performance.now();

// ---------------------------------------------------------------- experiments
const exp = {
  hunger: 0.72, feed: null, music: false, wind: false, tickle: false, vr: null,
  odorT: -1, shockT: -1, light: true, flicker: 0, windAmt: 0,
  strobe: false, strobePh: 0, strobeFlash: 0,
  laser: false, laserT: 0, burned: 0, burnK: 0, burnAcc: 0,
  spin: false, spinW: 0, spinAngle: 0,
  hypoxia: false, hypoT: 0, gas: 0, hoodSeal: false, comaSched: null, comaAt: -1, coma: 0,
  painT: -1, scalpel: false, cuts: [],
};
const tipPos = new THREE.Vector3(0.85, 1.25, 1.75);
const labellumPos = new THREE.Vector3();
const brushPos = new THREE.Vector3(0.75, 3.1, 1.15);
let contact = false, tickleContact = false;

// overload: central firing above capacity -> countdown -> excitotoxic burn-out
const ovl = { load: 0, hot: 0, crit: false, count: 0, calm: 0, sparkAcc: 0 };

// death: lethal injection (TTX / neonicotinoid), overload burn-out, prolonged anoxia
const death = { phase: 'off', t: 0, cause: '', sched: null, startSim: 0, endSim: 0, doneT: -1, beat: 0, flash: 0, total: 0, plunge: 0 };
const busy = () => flight.phase !== 'off' || death.phase !== 'off';

function stopAll() {
  if (exp.feed) { exp.feed = null; audio.servo(0.9); }
  if (exp.music) { exp.music = false; audio.setMusic(false); }
  if (exp.wind) { exp.wind = false; audio.setFan(false); }
  if (exp.tickle) { exp.tickle = false; audio.servo(0.7, { pitch: 1.4 }); }
  if (exp.vr) { exp.vr = null; vr.stop(); audio.servo(1.0, { pitch: 0.8 }); }
  if (exp.strobe) exp.strobe = false;
  if (exp.laser) { exp.laser = false; audio.setLaser(false); }
  if (exp.spin) exp.spin = false;
  if (exp.hypoxia) { exp.hypoxia = false; audio.setGas(0); }
  exp.scalpel = false;
  exp.odorT = -1;
}

function setAlarm(title, text, level = 'red') {
  const a = $('#alarm');
  if (!title) { a.hidden = true; return; }
  a.hidden = false;
  a.className = level;
  $('#alarm-title').textContent = title;
  $('#alarm-text').textContent = text || '';
}

// mutually exclusive rigs (they would collide around the subject's head)
function exclusive(name) {
  const off = {
    spin: ['feed', 'tickle', 'vr', 'hypoxia', 'laser'], hypoxia: ['vr', 'spin', 'feed'], laser: ['spin'],
    vr: ['hypoxia', 'spin'], feed: ['spin', 'hypoxia'], tickle: ['spin'],
  }[name] || [];
  for (const k of off) {
    if (k === 'feed' && exp.feed) { exp.feed = null; audio.servo(0.9); }
    if (k === 'tickle' && exp.tickle) exp.tickle = false;
    if (k === 'vr' && exp.vr) { exp.vr = null; vr.stop(); }
    if (k === 'spin' && exp.spin) exp.spin = false;
    if (k === 'laser' && exp.laser) { exp.laser = false; audio.setLaser(false); }
    if (k === 'hypoxia' && exp.hypoxia) hypoxiaOff();
  }
}

const label = (name) => t(`btn_${name}`);
function toggle(name, fromKey = false) {
  audio.resume();
  if (name === 'reset' && death.phase === 'dead') { audio.button(); desk.press('reset'); nextSubject(); return; }
  if (name === 'flight' && flight.phase === 'off' && death.phase === 'off') { flightButton(); return; }
  if (busy()) return;
  if (!entered) return;
  desk.press(name);
  if (name === 'toxin') { desk.toxin = desk.toxin ? 0 : 1; audio.knob(); note(`${t('btn_toxin')}: ${desk.toxin ? 'NEO' : 'TTX'}`); return; }
  if (name === 'inject') { injectButton(); return; }
  if (fromKey) audio.key(); else audio.button();
  if (name === 'sugar' || name === 'bitter') {
    exclusive('feed');
    exp.feed = exp.feed && exp.feed.kind === name ? null : { kind: name, t: 0, volume: 1 };
    const col = name === 'sugar' ? 0xf2c46a : 0x7d6cff;
    lab.feeder.drop.material.color.set(col);
    lab.feeder.drop.material.emissive.set(name === 'sugar' ? 0x3a2400 : 0x120a40);
    lab.feeder.liquid.material.color.set(col);
    audio.servo(1.1);
    note(`${label(name)} · ${exp.feed ? t('j_on') : t('j_off')}`);
  } else if (name === 'music') {
    exp.music = !exp.music;
    audio.setMusic(exp.music);
    if (yt.player && yt.player.playVideo) { if (exp.music) yt.player.playVideo(); else yt.player.pauseVideo(); }
    note(`${label(name)} · ${exp.music ? t('j_on') : t('j_off')}`);
  } else if (name === 'wind') {
    exp.wind = !exp.wind;
    audio.setFan(exp.wind);
    note(`${label(name)} · ${exp.wind ? t('j_on') : t('j_off')}`);
  } else if (name === 'tickle') {
    if (!exp.tickle) exclusive('tickle');
    exp.tickle = !exp.tickle;
    audio.servo(0.9, { pitch: 1.4 });
    note(`${label(name)} · ${exp.tickle ? t('j_on') : t('j_off')}`);
  } else if (name === 'loom' || name === 'images') {
    if (exp.vr !== name) exclusive('vr');
    exp.vr = exp.vr === name ? null : name;
    if (exp.vr) vr.start(exp.vr); else vr.stop();
    audio.servo(1.2, { pitch: 0.8 });
    note(`${label(name)} · ${exp.vr === name ? t('j_on') : t('j_off')}`);
  } else if (name === 'odor') {
    exp.odorT = 0;
    audio.hiss(1.6);
    note(`${label(name)} · ${t('j_puff')}`, 'warn');
  } else if (name === 'shock') {
    if (exp.shockT >= 0 && exp.shockT < 0.6) return;
    exp.shockT = 0;
    audio.zap();
    note(`${label(name)} · 40 V`, 'warn');
  } else if (name === 'light') {
    exp.light = !exp.light;
    audio.clunk();
    note(`${label(name)} · ${exp.light ? t('j_on') : t('j_off')}`);
  } else if (name === 'strobe') {
    exp.strobe = !exp.strobe;
    exp.strobePh = 0;
    note(`${label(name)} · ${exp.strobe ? '3 Hz' : t('j_off')}`, exp.strobe ? 'warn' : '');
  } else if (name === 'laser') {
    if (!exp.laser) exclusive('laser');
    exp.laser = !exp.laser;
    audio.setLaser(exp.laser);
    audio.clunk();
    note(`${label(name)} · ${exp.laser ? '532 nm' : t('j_off')}`, exp.laser ? 'warn' : '');
  } else if (name === 'spin') {
    if (!exp.spin) exclusive('spin');
    exp.spin = !exp.spin;
    audio.clunk();
    note(`${label(name)} · ${exp.spin ? t('j_on') : t('j_off')}`, exp.spin ? 'warn' : '');
  } else if (name === 'hypoxia') {
    if (!exp.hypoxia) { exclusive('hypoxia'); hypoxiaOn(); } else hypoxiaOff();
  } else if (name === 'scalpel') {
    exp.scalpel = !exp.scalpel;
    if (exp.scalpel) { setFocus('subject'); note(t('j_scalpel'), 'warn'); } else setFocus('center');
  } else if (name === 'reset') {
    stopAll();
    clearBrain();
    resetOverload();
    if (desk.isOpen('inject')) desk.cover('inject', false);
    audio.beep(500, 0.15, 0.06);
    note(t('j_reset'));
  }
  syncButtons();
}

function syncButtons() {
  const on = {
    sugar: exp.feed?.kind === 'sugar', bitter: exp.feed?.kind === 'bitter', music: exp.music, wind: exp.wind, tickle: exp.tickle,
    loom: exp.vr === 'loom', images: exp.vr === 'images', odor: exp.odorT >= 0 && exp.odorT < 1.6,
    shock: exp.shockT >= 0 && exp.shockT < 0.6, light: exp.light, strobe: exp.strobe, laser: exp.laser, spin: exp.spin, hypoxia: exp.hypoxia, scalpel: exp.scalpel,
  };
  BUTTONS.forEach((b) => desk.setOn(b.id, on[b.id]));
}

// ---- hypoxia: N2 hood over the head -> spreading depolarisation silences the brain (coma)
let brainBox = null;
function brainExtent() {
  if (brainBox) return brainBox;
  const p = neurons.pos;
  let minY = 1e9, maxR = 0;
  for (let i = 0; i < neurons.n; i++) { minY = Math.min(minY, p[i * 3 + 1]); maxR = Math.max(maxR, Math.hypot(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])); }
  brainBox = { minY, maxR };
  return brainBox;
}
function waveDelays(origin, spanMs, jitterMs, idx) {
  const p = neurons.pos, d = new Float32Array(idx.length);
  let maxD = 1e-6;
  for (let j = 0; j < idx.length; j++) {
    const i = idx[j];
    d[j] = Math.hypot(p[i * 3] - origin[0], p[i * 3 + 1] - origin[1], p[i * 3 + 2] - origin[2]);
    maxD = Math.max(maxD, d[j]);
  }
  for (let j = 0; j < idx.length; j++) d[j] = spanMs * d[j] / maxD + (Math.random() - 0.5) * 2 * jitterMs;
  return d;
}
function hypoxiaOn() {
  exp.hypoxia = true; exp.hypoT = 0; exp.gas = 0; exp.hoodSeal = false; exp.comaAt = -1;
  audio.servo(1.4, { pitch: 0.7 });
  note(`${label('hypoxia')} · ${t('j_on')}`, 'warn');
}
function startComa() {
  // silence every living neuron; the front starts somewhere in the brain and sweeps across it
  const idx = [];
  for (let i = 0; i < neurons.n; i++) if (kind[i] === 0) idx.push(i);
  const o = Math.floor(Math.random() * neurons.n);
  const origin = [neurons.pos[o * 3], neurons.pos[o * 3 + 1], neurons.pos[o * 3 + 2]];
  exp.comaOrigin = origin;
  const del = waveDelays(origin, 4200, 160, idx);
  for (let j = 0; j < del.length; j++) del[j] += 400;
  exp.comaSched = schedule(Int32Array.from(idx), del, 1);
  exp.comaAt = 0;
  note(t('j_sd'), 'red');
}
function hypoxiaOff() {
  exp.hypoxia = false;
  audio.setGas(0);
  audio.hiss(1.2);
  // everything silenced or still about to be silenced by the wave recovers, in a wave
  if (exp.comaAt >= 0 && worker) {
    const idx = [], del = [];
    const origin = exp.comaOrigin;
    const sh = schedules.includes(exp.comaSched) ? exp.comaSched : null;
    const pending = new Map();
    if (sh && sh.base != null) for (let k = sh.pos; k < sh.n; k++) pending.set(sh.idx[k], sh.base + sh.del[k] - stats.simMs);
    else if (sh) for (let k = sh.pos; k < sh.n; k++) pending.set(sh.idx[k], sh.del[k] + 200);
    for (let i = 0; i < neurons.n; i++) if (kind[i] === 1 || pending.has(i)) idx.push(i);
    const w = waveDelays(origin, 4500, 200, idx);
    for (let j = 0; j < idx.length; j++) {
      const pend = pending.get(idx[j]);
      del.push(1800 + w[j] + (pend != null ? Math.max(0, pend + 150) : 0));
    }
    schedule(Int32Array.from(idx), del, 0);
    note(t('j_recover'));
  } else note(`${label('hypoxia')} · ${t('j_off')}`);
  exp.comaAt = -1;
  exp.comaSched = null;
  syncButtons();
}

// ---- lethal injection
function injectButton() {
  if (!desk.isOpen('inject')) {
    desk.cover('inject', true);
    death.armedAt = clock.elapsedTime;
    audio.coverFlip();
    $('#armed').hidden = false;
    $('#armed-text').textContent = `${t('inject_arm')} · ${desk.toxin ? t('tox_neo') : t('tox_ttx')}`;
    return;
  }
  $('#armed').hidden = true;
  audio.bigButton();
  startDeath(desk.toxin ? 'neo' : 'ttx');
}

function startDeath(cause) {
  stopAll();
  resetOverload(true);
  death.phase = cause === 'ttx' || cause === 'neo' ? 'inject' : 'pov';
  death.cause = cause;
  death.t = 0;
  death.doneT = -1;
  death.flash = 0;
  death.startSim = stats.simMs;
  death.sched = null;
  death.plunge = 0;
  death.total = 0;
  spikeCount.fill(0);
  lab.injector.liquidMat.color.set(cause === 'neo' ? 0xc8e060 : 0x8fc8ff);
  lab.injector.liquidMat.emissive.copy(lab.injector.liquidMat.color);
  note(`${t('j_death_start')}: ${t('cause_' + cause)}`, 'red');
  if (death.phase === 'inject') { setFocus('inject'); audio.servo(1.3, { pitch: 0.9 }); }
  else enterPOV();
  syncButtons();
}

function toxinSchedule() {
  const n = neurons.n, idx = new Int32Array(n), del = new Float32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  if (death.cause === 'ttx') {
    // tetrodotoxin enters the brain from the neck (hemolymph) and blocks spikes as it spreads
    const { minY } = brainExtent();
    const w = waveDelays([0, minY * 0.92, 0], 9500, 700, idx);
    for (let i = 0; i < n; i++) del[i] = 1500 + w[i];
  } else if (death.cause === 'neo') {
    // neonicotinoid: cholinergic over-excitation (see rates/exc) -> seizure; neurons that
    // overfire die first (onWorker), the rest go silent as the receptors desensitise
    for (let i = 0; i < n; i++) del[i] = 4600 + 5500 * Math.pow(Math.random(), 0.7);
  } else {
    // overload: excitotoxic burn-out, fast and everywhere
    for (let i = 0; i < n; i++) del[i] = 400 + 4200 * Math.random();
  }
  death.sched = schedule(idx, del, 2);
}

function enterPOV() {
  death.phase = 'pov';
  death.t = 0;
  death.flash = 1;
  if (!death.sched) toxinSchedule();
  document.body.classList.add('pov');
  $('#povhud').hidden = false;
  $('#pov-cause').textContent = t('cause_' + death.cause);
  audio.setMuffle(1800);
  audio.whoosh();
}

function finishDeath() {
  death.phase = 'dead';
  death.t = 0;
  document.body.classList.remove('pov');
  $('#povhud').hidden = true;
  renderPass.scene = scene; renderPass.camera = camera;
  audio.setMuffle(20000);
  audio.setTinnitus(0);
  audio.setFlatline(true);
  setTimeout(() => audio.setFlatline(false), 3200);
  setFocus('subject');
  camera.position.copy(camTarget.pos);
  camLook.copy(camTarget.look);
  const secs = (death.endSim - death.startSim) / 1000;
  $('#dc-subj').textContent = `783-${pad(expNo)}`;
  $('#dc-cause').textContent = t('cause_' + death.cause);
  $('#dc-time').textContent = `${secs.toFixed(1)} s`;
  $('#dc-last').textContent = fmt(death.total);
  $('#deathcard').hidden = false;
  if (!tankList.includes(expNo)) { tankList.unshift(expNo); tankList = tankList.slice(0, 6); }
  try { localStorage.setItem('s783-tanks', JSON.stringify(tankList)); } catch { /* ignore */ }
  note(`${t('j_dead')} · ${secs.toFixed(1)} s`, 'red');
  setAlarm(null);
}

function nextSubject() {
  $('#deathcard').hidden = true;
  death.phase = 'off';
  syncTanks();
  newSubject();
}

// ---- overload
function resetOverload(silent = false) {
  ovl.hot = 0; ovl.crit = false; ovl.count = 0; ovl.calm = 0;
  if (!silent) setAlarm(null);
}

// Poisson rates (Hz) for each stimulated population
function rates() {
  const r = {
    sugar: 0, bitter: 0, hearing: 0, wind: 0, tickle: 0, body: 0, loom: 0, loomL: 0, loomR: 0,
    eyeL: 0, eyeR: 0, odor: 0, dna02L: 0, dna02R: 0, dng02L: 0, dng02R: 0, gf: 0, joL: 0, joR: 0,
  };
  for (const c of exp.cuts) {
    if (c.t > 0.25) continue;
    if (c.kind === 'antenna') r[c.side > 0 ? 'joL' : 'joR'] = 100;   // severed axons: an injury discharge
    else if (c.burst) r.body = Math.max(r.body, 30);                 // injury signal from the body
  }
  if (exp.feed && contact) r[exp.feed.kind] = exp.feed.kind === 'sugar' ? 200 * (0.25 + 0.75 * exp.hunger) : 200;
  r.hearing = 190 * audio.level;
  r.wind = Math.max(100 * exp.windAmt, exp.spinW > 0.02 ? 30 + 90 * exp.spinW : 0);
  r.tickle = tickleContact ? 40 : 0;
  if (exp.shockT >= 0 && exp.shockT < 0.25) r.body = 40;
  if (exp.painT >= 0 && exp.painT < 0.25) r.body = Math.max(r.body, 40);   // the needle: like a shock
  if (exp.vr) {
    r.eyeL = vr.photoRate(0);
    r.eyeR = vr.photoRate(1);
    r.loom = 150 * vr.loomDrive;
  } else {
    // what reaches the eyes: the lamp (and its stutter), the strobe, optic flow while spinning
    const ambient = (exp.light ? 0.5 + 2.5 * flick.level : 0.5) + exp.flicker * 20 + 25 * exp.spinW;
    r.eyeL = r.eyeR = ambient;
  }
  if (exp.strobeFlash > 0.5) { r.eyeL = Math.max(r.eyeL, 150); r.eyeR = Math.max(r.eyeR, 150); }
  if (exp.laser) r.eyeL = Math.max(r.eyeL, 120);
  if (exp.odorT >= 0 && exp.odorT < 1.6) r.odor = 150 * Math.min(1, exp.odorT * 6) * (1 - exp.odorT / 1.6);
  if (death.cause === 'neo' && death.phase !== 'off' && death.phase !== 'dead' && death.sched) {
    const k = clamp01(((stats.simMs - death.startSim) / 1000 - 3.7) / 1.2);
    r.body = Math.max(r.body, 30 * k);                   // the nerve cord is poisoned too
  }
  if (flight.phase === 'flying' || flight.phase === 'release') Object.assign(r, flight.rates);
  if (dbg && dbg.rates) Object.assign(r, dbg.rates);
  for (const k in r) if (!(r[k] > 0.01)) r[k] = 0;   // decaying envelopes never reach exactly 0
  return r;
}
let dbg = null;   // debug overrides: { exc, rates }
function excGain() {
  if (dbg && dbg.exc != null) return dbg.exc;
  if (death.cause !== 'neo' || death.phase === 'off' || death.phase === 'dead' || !death.sched) return 1;
  return 1 + 0.5 * clamp01(((stats.simMs - death.startSim) / 1000 - 3.6) / 1.5);
}

// ---------------------------------------------------------------- flight protocol
const flight = {
  phase: 'off', t: 0, coverOpen: false, armedAt: 0,
  pos: new THREE.Vector3(), yaw: 0, vy: 0, speed: 0, bank: 0, pitch: 0,
  keys: { left: false, right: false, up: false, down: false, gf: false }, gfT: -1, wander: 0, evadeT: 0, evadeDir: 0,
  rates: {}, camPos: new THREE.Vector3(), shake: 0,
};
const BOUNDS = { x: 8.2, yMin: 0.7, yMax: 8.0, zMin: -60, zMax: 2.6 };

function flightButton() {
  if (flight.phase !== 'off' || !entered) return;
  if (fly.parts.some((p) => p.kind === 'wing' && p.cut)) { audio.beep(220, 0.2, 0.08); note(t('j_nowing'), 'red'); return; }
  desk.press('flight');
  if (!desk.isOpen('flight')) {
    desk.cover('flight', true);
    flight.armedAt = clock.elapsedTime;
    audio.coverFlip();
    $('#armed').hidden = false;
    $('#armed-text').textContent = t('flight_arm');
    return;
  }
  // second press: launch
  $('#armed').hidden = true;
  audio.bigButton();
  stopAll();
  clearBrain();
  resetOverload();
  flight.phase = 'siren';
  flight.t = 0;
  audio.setSiren(true);
  setFocus('center');
  note(t('flight_banner'), 'red');
  syncButtons();
}

function startFlying() {
  flight.phase = 'flying';
  flight.t = 0;
  fly.root.localToWorld(flight.pos.set(0, 1.3, 0));   // centre of the body
  flight.yaw = 0;
  flight.speed = 1.5;
  flight.vy = 1.2;
  document.body.classList.add('flying');
  $('#flighthud').hidden = false;
  scene.fog.density = 0.022;
  flash('#000', 0.9, 0.35);
  audio.whoosh();
}

function explode() {
  if (flight.phase !== 'flying') return;
  flight.phase = 'boom';
  flight.t = 0;
  audio.boom();
  boomFx.start(fly.root.localToWorld(new THREE.Vector3(0, 1.4, 0)));
  fly.root.visible = false;
  flash('#fff', 0.85, 0.5);
  flight.shake = 1;
  clearBrain();
  $('#btn-explode').disabled = true;
}

function newSubject() {
  // the next fly is strapped in while the title card is up
  expNo++;
  try { localStorage.setItem('s783-exp', String(expNo)); } catch { /* ignore */ }
  showExpNo();
  fly.root.visible = true;
  fly.root.position.copy(LAYOUT.chair);
  fly.root.rotation.set(0, 0, 0);
  fly.resetPose();
  clearDebris();
  exp.spinAngle = 0; exp.spinW = 0;
  lab.spin.forEach((g) => { g.rotation.y = 0; });
  lab.rig.group.position.y = 0;
  lab.straps.forEach((s) => { s.pivot.rotation.z = 0; });
  desk.cover('flight', false);
  desk.cover('inject', false);
  flight.phase = 'title';
  flight.t = 0;
  audio.setSiren(false);
  document.body.classList.remove('flying');
  $('#flighthud').hidden = true;
  $('#btn-explode').disabled = false;
  scene.fog.density = 0.055;
  exp.hunger = 0.72;
  boomFx.stop();
  camera.position.copy(LAYOUT.camera);
  camLook.copy(LAYOUT.lookAt);
  setFocus('center');
  stopAll();
  clearBrain();
  resetOverload();
  death.cause = '';
  powerOnAt = -1;
  titleCard(() => { flight.phase = 'off'; powerOnAt = clock.elapsedTime; recStart = performance.now(); note(`${t('exp_no')} #${pad(expNo)} · ${t('j_start')}`); syncButtons(); });
}

// screen flash / fade (color, peak opacity, seconds)
function flash(color, peak, dur) {
  const el = $('#flash');
  el.style.background = color;
  el.style.transition = 'none';
  el.style.opacity = String(peak);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transition = `opacity ${dur}s ease-out`;
    el.style.opacity = '0';
  }));
}

// glitch-decode a line of text into an element
const GLYPHS = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯ0123456789#%&@$▓▒░/\\<>';
function decode(el, text, dur = 1200, done) {
  const t0 = performance.now();
  const order = [...text].map((ch, i) => ({ ch, at: (i / text.length) * 0.65 + Math.random() * 0.35 }));
  const step = () => {
    const k = (performance.now() - t0) / dur;
    el.textContent = order.map((o) => (o.ch === ' ' ? ' ' : k >= o.at ? o.ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join('');
    if (k < 1) setTimeout(step, 33); else { el.textContent = text; done && done(); }
  };
  step();
}

// experiment title card: glitching number + typewriter log
function titleCard(done) {
  const card = $('#titlecard');
  card.hidden = false;
  card.classList.remove('out');
  $('#tc-subj').textContent = `783-${pad(expNo)}`;
  decode($('#tc-num'), `#${pad(expNo)}`, 900);
  const lines = t('tc_lines').split('|');
  const out = $('#tc-log');
  out.textContent = '';
  let li = 0, ci = 0;
  audio.beep(880, 0.12, 0.06);
  const step = () => {
    if (li >= lines.length) {
      setTimeout(() => {
        audio.beep(1320, 0.18, 0.06);
        card.classList.add('out');
        setTimeout(() => { card.hidden = true; done && done(); }, 800);
      }, 700);
      return;
    }
    const line = lines[li];
    if (ci === 0) out.textContent += (li ? '\n' : '') + '> ';
    out.textContent += line[ci];
    if (ci % 2 === 0) audio.typeTick();
    ci++;
    if (ci >= line.length) { li++; ci = 0; setTimeout(step, 220); } else setTimeout(step, 22);
  };
  setTimeout(step, 450);
}

// explosion: white-hot flash -> expanding shockwave -> fireball -> glowing shards -> smoke
const boomFx = (() => {
  const N = 200;
  const shardMat = new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: 0xff6a20, emissiveIntensity: 0 });
  const shards = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.07), shardMat, N);
  shards.visible = false;
  shards.frustumCulled = false;
  const cols = [0x8a6a46, 0x6a0a04, 0x33241a, 0xb9b0a0, 0x1e140c, 0xcfe0ff];
  const col = new THREE.Color();
  for (let i = 0; i < N; i++) shards.setColorAt(i, col.set(cols[i % cols.length]));
  scene.add(shards);
  const parts = Array.from({ length: N }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), s: 1 }));
  const dot = document.createElement('canvas'); dot.width = dot.height = 64;
  const dctx = dot.getContext('2d');
  const grd = dctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  dctx.fillStyle = grd; dctx.fillRect(0, 0, 64, 64);
  const sprite = new THREE.CanvasTexture(dot);
  const FN = 320;
  const mkPoints = (size, color, blending) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FN * 3), 3));
    const m = new THREE.PointsMaterial({ size, color, map: sprite, transparent: true, opacity: 0, blending, depthWrite: false, toneMapped: false });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    scene.add(p);
    return p;
  };
  const fire = mkPoints(1.5, 0xffd890, THREE.AdditiveBlending);
  const smoke = mkPoints(2.4, 0x34373a, THREE.NormalBlending);
  smoke.material.toneMapped = true;
  const wave = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({
    color: 0xffb060, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  wave.visible = false;
  scene.add(wave);
  const fv = Array.from({ length: FN }, () => new THREE.Vector3());
  const sv = Array.from({ length: FN }, () => new THREE.Vector3());
  const origin = new THREE.Vector3();
  let tt = -1;
  const dm = new THREE.Object3D();
  return {
    start(at) {
      origin.copy(at); tt = 0;
      shards.visible = true; wave.visible = true;
      wave.position.copy(at);
      parts.forEach((q) => {
        q.p.copy(at);
        q.v.set(Math.random() - 0.5, Math.random() * 0.9 - 0.25, Math.random() - 0.5).normalize().multiplyScalar(5 + Math.random() * 11);
        q.r.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
        q.s = 0.5 + Math.random() * 1.8;
      });
      for (let i = 0; i < FN; i++) {
        fv[i].set(Math.random() - 0.5, Math.random() - 0.4, Math.random() - 0.5).normalize().multiplyScalar(0.6 + Math.random() * 2.6);
        sv[i].set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize().multiplyScalar(0.8 + Math.random() * 3.2);
      }
      lab.hall.light.position.copy(at);
    },
    stop() {
      tt = -1; shards.visible = false; wave.visible = false;
      fire.material.opacity = 0; smoke.material.opacity = 0;
    },
    update(dt) {
      if (tt < 0) return;
      tt += dt;
      parts.forEach((q, i) => {
        q.v.y -= 9.8 * dt;
        q.p.addScaledVector(q.v, dt);
        if (q.p.y < 0.03) { q.p.y = 0.03; q.v.multiplyScalar(0.4); q.v.y = Math.abs(q.v.y) * 0.3; }
        dm.position.copy(q.p);
        dm.rotation.set(q.r.x * tt, q.r.y * tt, q.r.z * tt);
        dm.scale.setScalar(q.s);
        dm.updateMatrix();
        shards.setMatrixAt(i, dm.matrix);
      });
      shards.instanceMatrix.needsUpdate = true;
      shardMat.emissiveIntensity = Math.max(0, 3 * (1 - tt / 1.4));
      const fp = fire.geometry.attributes.position, sp = smoke.geometry.attributes.position;
      const kf = 1 - Math.exp(-tt * 4), ks = 1 - Math.exp(-tt * 1.6);
      for (let i = 0; i < FN; i++) {
        fp.setXYZ(i, origin.x + fv[i].x * kf, origin.y + fv[i].y * kf, origin.z + fv[i].z * kf);
        sp.setXYZ(i, origin.x + sv[i].x * ks, origin.y + sv[i].y * ks + tt * 0.5, origin.z + sv[i].z * ks);
      }
      fp.needsUpdate = sp.needsUpdate = true;
      fire.material.opacity = Math.max(0, 1 - tt / 1.1);
      fire.material.color.setRGB(1, Math.max(0.35, 0.95 - tt * 0.7), Math.max(0.1, 0.75 - tt * 1.2));
      fire.material.size = 1.5 + tt * 1.5;
      smoke.material.opacity = Math.min(0.55, Math.max(0, tt - 0.2) * 1.5) * Math.max(0, 1 - tt / 4.5);
      const w = Math.min(1, tt / 0.35);
      wave.scale.setScalar(0.3 + 6 * w);
      wave.material.opacity = 0.85 * (1 - w);
      lab.hall.light.color.setRGB(1, 0.65, 0.35);
      lab.hall.light.intensity = Math.max(0, 600 * (1 - tt * 2));
    },
  };
})();

// ---- the saw and what it leaves behind ----
// hemolymph: spray (falls, splashes on the floor and on the window in front of us), wounds that drip
const HEMO = 0x8f9a3a;
const cutFx = (() => {
  const pieces = [];
  const N = 420;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const drops = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.04, color: HEMO, transparent: true, opacity: 0.95, depthWrite: false, map: TXdot() }));
  drops.frustumCulled = false;
  scene.add(drops);
  const dp = Array.from({ length: N }, () => ({ p: new THREE.Vector3(0, -50, 0), v: new THREE.Vector3(), life: 0, landed: false }));
  let next = 0;
  const emit = (at, v) => { const d = dp[next]; next = (next + 1) % N; d.p.copy(at); d.v.copy(v); d.life = 8; d.landed = false; };
  // splats: on the floor and on the window glass (chamber side)
  const mkSplats = (n, rotX, tex, opacity) => {
    const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshPhysicalMaterial({
      map: tex, color: HEMO, transparent: true, opacity, depthWrite: false, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05,
      polygonOffset: true, polygonOffsetFactor: -2,
    }), n);
    m.count = 0; m.frustumCulled = false; m.userData.rotX = rotX; m.renderOrder = 11;
    scene.add(m);
    return m;
  };
  const floorSplats = mkSplats(90, -Math.PI / 2, poolTexture(), 0.8), glassSplats = mkSplats(70, 0, beadTexture(), 0.7);
  const dm = new THREE.Object3D();
  const addSplat = (m, x, y, z, s) => {
    const i = m.count < m.instanceMatrix.count ? m.count++ : Math.floor(Math.random() * m.count);
    dm.position.set(x, y, z); dm.rotation.set(m.userData.rotX, 0, Math.random() * 6.28); dm.scale.set(s, s * (0.75 + Math.random() * 0.5), 1);
    dm.updateMatrix(); m.setMatrixAt(i, dm.matrix); m.instanceMatrix.needsUpdate = true;
    return i;
  };
  // beads on the glass run down a little and evaporate within a few seconds
  const beads = [];
  const addBead = (x, y, s) => {
    const i = addSplat(glassSplats, x, y, 3.655, s);
    const b = beads.find((q) => q.i === i) || (beads.push({ i }), beads[beads.length - 1]);
    Object.assign(b, { x, y, s, t: 0, life: 1.8 + Math.random() * 1.2, run: 0.02 + Math.random() * 0.06 });
  };
  const wounds = [];
  const wp = new THREE.Vector3(), vtmp = new THREE.Vector3();
  return {
    cut(piece, at, kind) {
      pieces.push({
        obj: piece, rest: false,
        v: new THREE.Vector3((Math.random() - 0.5) * 3, 1.5 + Math.random() * 1.5, 1.2 + Math.random() * 1.6),
        w: new THREE.Vector3(Math.random() * 16 - 8, Math.random() * 16 - 8, Math.random() * 16 - 8),
        trail: 1.2,
      });
      const n = kind === 'antenna' ? 70 : 170;
      for (let k = 0; k < n; k++) {
        const fast = k % 7 === 0;   // fine mist that reaches the window
        emit(at, vtmp.set((Math.random() - 0.5) * (fast ? 2.4 : 3.5), fast ? 1.6 + Math.random() * 2.4 : Math.random() * 3, fast ? 6 + Math.random() * 3 : (Math.random() - 0.2) * 3));
      }
    },
    wound(mesh) { wounds.push({ mesh, t: 0 }); },
    update(dt) {
      for (const q of pieces) {
        if (q.rest) continue;
        q.v.y -= 9.8 * dt;
        q.obj.position.addScaledVector(q.v, dt);
        q.obj.rotation.x += q.w.x * dt; q.obj.rotation.y += q.w.y * dt; q.obj.rotation.z += q.w.z * dt;
        if (q.trail > 0) { q.trail -= dt; if (Math.random() < 0.7) emit(q.obj.position, vtmp.set((Math.random() - 0.5) * 0.4, -0.2, (Math.random() - 0.5) * 0.4)); }
        if (q.obj.position.y < 0.06) {
          if (q.v.y < -1.5) addSplat(floorSplats, q.obj.position.x, 0.007, q.obj.position.z, 0.25 + Math.random() * 0.2);
          q.obj.position.y = 0.06;
          q.v.y = Math.abs(q.v.y) * 0.25; q.v.x *= 0.5; q.v.z *= 0.5; q.w.multiplyScalar(0.4);
          if (q.v.y < 0.2) q.rest = true;
        }
      }
      // wounds keep dripping for a while
      for (const w of wounds) {
        w.t += dt;
        if (w.t < 6 && Math.random() < dt * (w.t < 1 ? 40 : 10)) {
          w.mesh.getWorldPosition(wp);
          emit(wp, vtmp.set((Math.random() - 0.5) * 0.3, -0.1 - Math.random() * 0.3, (Math.random() - 0.5) * 0.3 + 0.1));
        }
      }
      if (beads.length) {
        for (const b of beads) {
          if (b.t > b.life) continue;
          b.t += dt;
          const k = Math.max(0, 1 - b.t / b.life);
          dm.position.set(b.x, b.y - b.run * b.t, 3.655); dm.rotation.set(0, 0, 0);
          dm.scale.set(b.s * Math.sqrt(k), b.s * (Math.sqrt(k) + 0.3 * (1 - k)), 1);
          dm.updateMatrix(); glassSplats.setMatrixAt(b.i, dm.matrix);
        }
        glassSplats.instanceMatrix.needsUpdate = true;
      }
      const pa = geo.attributes.position;
      dp.forEach((d, i) => {
        if (d.life > 0) {
          d.life -= dt;
          if (!d.landed) {
            d.v.y -= 9.8 * dt;
            d.p.addScaledVector(d.v, dt);
            if (d.p.z > 3.62) {
              if (Math.abs(d.p.x) < 2.45 && d.p.y > 0.9 && d.p.y < 2.55) addBead(d.p.x, d.p.y, 0.012 + Math.random() * 0.03);
              d.life = 0;
            } else if (d.p.y <= 0.012) {
              d.p.y = 0.012; d.landed = true; d.v.set(0, 0, 0);
              if (Math.random() < 0.3) addSplat(floorSplats, d.p.x, 0.006 + Math.random() * 0.001, d.p.z, 0.05 + Math.random() * 0.12);
            }
          }
        }
        pa.setXYZ(i, d.p.x, d.life > 0 ? d.p.y : -50, d.p.z);
      });
      pa.needsUpdate = true;
    },
    clear() {
      pieces.forEach((q) => scene.remove(q.obj));
      pieces.length = 0;
      wounds.forEach((w) => w.mesh.parent && w.mesh.parent.remove(w.mesh));
      wounds.length = 0;
      dp.forEach((d) => { d.life = 0; d.p.set(0, -50, 0); });
      floorSplats.count = 0; glassSplats.count = 0; beads.length = 0;
    },
  };
})();
function TXdot() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.6, 'rgba(255,255,255,0.9)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}
// a pool: one irregular blob with soft wet edges and a few satellite drops (alpha only)
function poolTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const blob = (x, y, r, a) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.72, `rgba(255,255,255,${a * 0.92})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  for (let k = 0; k < 14; k++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * 34;
    blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 34 + Math.random() * 30, 0.55);
  }
  for (let k = 0; k < 9; k++) {
    const a = Math.random() * Math.PI * 2, d = 78 + Math.random() * 38;
    blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 3 + Math.random() * 8, 0.9);
  }
  return new THREE.CanvasTexture(c);
}
// a bead of liquid on glass: round, slightly heavier at the bottom
function beadTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 36, 0, 32, 34, 26);
  gr.addColorStop(0, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.9, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.ellipse(32, 34, 24, 27, 0, 0, Math.PI * 2); g.fill();
  return new THREE.CanvasTexture(c);
}
function clearDebris() { cutFx.clear(); exp.cuts.length = 0; }

function pickPart() {
  if (!exp.scalpel || death.phase !== 'off' || flight.phase !== 'off') return null;
  const live = fly.parts.filter((p) => !p.cut);
  const hit = raycaster.intersectObjects(live.flatMap((p) => p.meshes), false)[0];
  return hit ? live.find((p) => p.meshes.includes(hit.object)) : null;
}

let slowUntil = 0, camShake = 0, lastInjury = -99;
const woundMat = new THREE.MeshStandardMaterial({ color: 0x4e5a1c, roughness: 0.18, emissive: 0x141805 });
function cutPart(p) {
  p.obj.updateWorldMatrix(true, false);
  const piece = p.obj.clone(true);
  p.obj.matrixWorld.decompose(piece.position, piece.quaternion, piece.scale);
  scene.add(piece);
  const stump = new THREE.Vector3().setFromMatrixPosition(p.obj.matrixWorld);
  p.cut = true;
  p.obj.scale.setScalar(0.0001);
  // a wet wound where it was attached
  const wound = new THREE.Mesh(new THREE.SphereGeometry(p.kind === 'antenna' ? 0.03 : 0.045, 12, 8), woundMat);
  wound.scale.set(1, 0.6, 1);
  wound.position.copy(p.obj.position);
  p.obj.parent.add(wound);
  cutFx.wound(wound);
  cutFx.cut(piece, stump, p.kind);
  // body injury signals at most every 1.5 s: stacked volleys tip the model into its runaway
  const burst = clock.elapsedTime - lastInjury > 1.5;
  if (burst && p.kind !== 'antenna') lastInjury = clock.elapsedTime;
  exp.cuts.push({ kind: p.kind, side: p.side, t: 0, burst });
  fly.state.spasm = 1;
  fly.state.jolt = 1;
  audio.chop();
  slowUntil = clock.elapsedTime + 0.55;
  camShake = 1;
  flash('#d8e070', 0.22, 0.35);
  if (p.kind === 'antenna') {
    // the Johnston's-organ neurons of that antenna fire an injury discharge, then are gone for good
    const idx = joSide[p.side > 0 ? 'L' : 'R'];
    schedule(Int32Array.from(idx), new Float32Array(idx.length).fill(350), 3);
  }
  note(`${t('j_cut')}: ${t('part_' + p.id)}`, 'red');
}

// circular saw with big hooked teeth, on a telescopic arm from the ceiling; the blade faces us
const saw = (() => {
  const anchor = new THREE.Vector3(1.05, 3.3, 1.55);
  const rest = new THREE.Vector3(1.05, 2.4, 1.55);
  const steel = new THREE.MeshStandardMaterial({ color: 0xd0d4d6, metalness: 1, roughness: 0.22 });
  const tipsMat = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, metalness: 0.9, roughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d1f, metalness: 0.6, roughness: 0.45 });
  const R = 0.3, TEETH = 24;
  const shape = new THREE.Shape();
  for (let k = 0; k < TEETH; k++) {
    const a0 = k / TEETH * Math.PI * 2, step = Math.PI * 2 / TEETH;
    const pt = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];
    if (k === 0) shape.moveTo(...pt(R * 0.8, a0)); else shape.lineTo(...pt(R * 0.8, a0));
    shape.lineTo(...pt(R * 0.86, a0 + step * 0.15));
    shape.lineTo(...pt(R, a0 + step * 0.72));          // hooked tooth tip
    shape.lineTo(...pt(R * 0.9, a0 + step * 0.8));
    shape.lineTo(...pt(R * 0.78, a0 + step * 0.95));    // gullet
  }
  shape.closePath();
  const hole = new THREE.Path(); hole.absarc(0, 0, 0.03, 0, Math.PI * 2, true); shape.holes.push(hole);
  for (let k = 0; k < 6; k++) {   // expansion slots
    const a = k / 6 * Math.PI * 2, slot = new THREE.Path();
    slot.absarc(Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55, 0.012, 0, Math.PI * 2, true);
    shape.holes.push(slot);
  }
  const bladeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 6 });
  bladeGeo.translate(0, 0, -0.004);
  const group = new THREE.Group();            // blade axis = local z, pointed at the window
  const blade = new THREE.Mesh(bladeGeo, [steel, tipsMat]);
  const blur = new THREE.Mesh(new THREE.RingGeometry(R * 0.78, R * 1.01, 64), new THREE.MeshBasicMaterial({
    color: 0xc8ccd0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
  }));
  blur.position.z = 0.006;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 20), dark);
  hub.rotation.x = Math.PI / 2;
  const guard = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.1, R * 1.1, 0.06, 40, 1, true, -Math.PI / 2, Math.PI), dark);
  guard.material.side = THREE.DoubleSide;
  guard.rotation.x = Math.PI / 2;
  guard.position.z = -0.01;
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.2, 18), dark);
  motor.rotation.x = Math.PI / 2; motor.position.z = -0.12;
  const hot = new THREE.PointLight(0xffa040, 0, 1.6, 2);
  group.add(blade, blur, hub, guard, motor, hot);
  scene.add(group);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 8), steel);
  rod.geometry.translate(0, 0.5, 0);
  scene.add(rod);
  const house = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.24), dark);
  house.position.copy(anchor).add(new THREE.Vector3(0, 0.09, 0));
  scene.add(house);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 9 - anchor.y, 8), steel);
  pole.position.set(anchor.x, (9 + anchor.y) / 2, anchor.z);
  scene.add(pole);
  const SN = 140;
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SN * 6), 3));
  const sparks = new THREE.LineSegments(sGeo, new THREE.LineBasicMaterial({ color: 0xffd080, transparent: true, blending: THREE.AdditiveBlending, toneMapped: false }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  const sp = Array.from({ length: SN }, () => ({ p: new THREE.Vector3(0, -50, 0), v: new THREE.Vector3(), life: 0 }));
  const pos = rest.clone(), target = new THREE.Vector3(), bite = new THREE.Vector3(), dir = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), tmpQ = new THREE.Quaternion(), look = new THREE.Vector3(), rd = new THREE.Vector3();
  let job = null, spin = 0, angle = 0;
  return {
    get busy() { return !!job; },
    start(part) {
      part.obj.updateWorldMatrix(true, false);
      bite.setFromMatrixPosition(part.obj.matrixWorld);
      // blade centre one radius up-and-out from the joint, the teeth on the joint
      dir.set(rest.x - bite.x, rest.y - bite.y, 0).normalize();
      target.copy(bite).addScaledVector(dir, R * 0.92).add(new THREE.Vector3(0, 0, 0.12));
      job = { part, t: 0, done: false };
      audio.saw(1.25, 0.5);
    },
    update(dt) {
      let biting = false;
      if (job) {
        job.t += dt;
        const tt = job.t;
        if (tt < 0.5) { const k = Math.min(1, tt / 0.45); pos.lerpVectors(rest, target, k * k * (3 - 2 * k)); }
        else if (tt < 1.15) {
          biting = true;
          pos.copy(target).addScaledVector(dir, -0.07 * Math.min(1, (tt - 0.5) / 0.35))
            .add(new THREE.Vector3((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02, 0));
        } else pos.lerp(rest, 1 - Math.exp(-dt * 3));
        if (tt > 0.85 && !job.done) { job.done = true; cutPart(job.part); }
        spin = tt < 1.5 ? Math.min(1, tt / 0.3) : Math.max(0, 1 - (tt - 1.5) / 1.2);
        if (tt > 3) job = null;
      } else pos.lerp(rest, 1 - Math.exp(-dt * 3));
      if (biting) {
        for (let k = 0; k < 9; k++) {
          const s = sp.find((q) => q.life <= 0);
          if (!s) break;
          s.life = 0.3 + Math.random() * 0.5;
          s.p.copy(bite).add(new THREE.Vector3(0, 0, 0.1));
          s.v.set((Math.random() - 0.3) * 5, Math.random() * 4, 1 + Math.random() * 4);
        }
      }
      hot.intensity = biting ? 3 + Math.random() * 4 : 0;
      angle -= spin * dt * 60;
      blur.material.opacity = 0.32 * spin * spin;
      group.position.copy(pos);
      group.lookAt(look.copy(pos).add(new THREE.Vector3(0, 0, 1)));
      blade.rotation.z = angle;
      guard.rotation.y = 0;
      rd.copy(pos).sub(anchor);
      rod.position.copy(anchor);
      rod.scale.set(1, rd.length(), 1);
      rod.quaternion.copy(tmpQ.setFromUnitVectors(up, rd.normalize()));
      const sa = sGeo.attributes.position;
      sp.forEach((s, i) => {
        if (s.life > 0) { s.life -= dt; s.v.y -= 9.8 * dt; s.p.addScaledVector(s.v, dt); if (s.p.y < 0.02) { s.p.y = 0.02; s.v.y *= -0.4; } }
        const y = s.life > 0 ? 0 : -50;
        sa.setXYZ(i * 2, s.p.x, s.p.y + y, s.p.z);
        sa.setXYZ(i * 2 + 1, s.p.x - s.v.x * 0.025, s.p.y - s.v.y * 0.025 + y, s.p.z - s.v.z * 0.025);
      });
      sa.needsUpdate = true;
    },
  };
})();

function updateFlight(dt, now) {
  const f = flight;
  f.t += dt;
  const s = lab.sirens;
  const sirenOn = f.phase === 'siren' || f.phase === 'release' || f.phase === 'flying' || (f.phase === 'boom' && f.t < 1.6);
  s.units.forEach((u) => { u.rot.rotation.y += dt * (sirenOn ? 7 : 0); });
  s.dome.color.set(sirenOn ? 0xff1a0a : 0x1a0303);
  s.fin.color.set(sirenOn ? 0xffd0c0 : 0x200808);
  s.lights.forEach((l, i) => {
    l.intensity = sirenOn ? 150 : 0;
    const a = now * 7 + i * Math.PI;
    l.target.position.set(l.position.x + Math.cos(a) * 5, l.position.y - 1.6, l.position.z + Math.sin(a) * 5);
  });
  const red = sirenOn ? 0.5 + 0.5 * Math.sin(now * 7) : 0;
  lensPass.uniforms.uRed.value = red * 0.35;
  if (f.phase === 'off' && desk.isOpen('flight') && now - f.armedAt > 8) { desk.cover('flight', false); $('#armed').hidden = true; audio.coverFlip(); }

  if (f.phase === 'siren') {
    if (f.t > 2.2) { f.phase = 'release'; f.t = 0; audio.unlock(); }
  } else if (f.phase === 'release') {
    // straps swing open, electrode rig lifts away, hall lights come on, the fly lifts off
    lab.straps.forEach((st) => { st.pivot.rotation.z += (st.side * -1.6 - st.pivot.rotation.z) * Math.min(1, dt * 5); });
    lab.rig.group.position.y += (1.4 - lab.rig.group.position.y) * Math.min(1, dt * 1.6);
    const on = clamp01((f.t - 0.6) * 1.5);
    lab.hall.lamps.color.setScalar(0.08 + 0.92 * (Math.random() < on ? 1 : 0.2));
    lab.hall.light.intensity = 80 * on;
    lab.hall.light.color.set(0xdfe9ff);
    lab.hemi.intensity = lab.hemiBase + 0.5 * on;
    const lift = clamp01((f.t - 1.6) / 2.2);
    const e = lift * lift * (3 - 2 * lift);
    fly.root.position.set(LAYOUT.chair.x, LAYOUT.chair.y + e * 1.8, LAYOUT.chair.z - e * 0.6);
    fly.root.rotation.set(e * Math.PI / 2, e * Math.PI, 0, 'YXZ');
    f.rates = { dng02L: 40 * clamp01(f.t - 1.2), dng02R: 40 * clamp01(f.t - 1.2) };
    if (f.t > 4.2) startFlying();
  } else if (f.phase === 'flying') {
    flyStep(dt, now);
  } else if (f.phase === 'boom') {
    boomFx.update(dt);
    if (f.t > 2.2 && !f.faded) { f.faded = true; const el = $('#flash'); el.style.transition = 'opacity 0.5s'; el.style.background = '#000'; el.style.opacity = '1'; }
    if (f.t > 2.8) {
      f.faded = false;
      newSubject();
      const el = $('#flash'); el.style.transition = 'opacity 1s'; el.style.opacity = '0';
    }
  } else if (f.phase === 'off' || f.phase === 'title') {
    lab.hall.lamps.color.setScalar(0.08);
    if (!exp.strobe) lab.hall.light.intensity = 0;
    lab.hemi.intensity = lab.hemiBase;
  }
}

const fwd = new THREE.Vector3(), tmpV = new THREE.Vector3();
const qYaw = new THREE.Quaternion(), qPitch = new THREE.Quaternion(), qRoll = new THREE.Quaternion();
const AX_X = new THREE.Vector3(1, 0, 0), AX_Y = new THREE.Vector3(0, 1, 0);
function wallDistance(pos, dirx, dirz) {
  // distance to the chamber walls / window along a horizontal direction
  let d = 99;
  if (dirx > 1e-3) d = Math.min(d, (BOUNDS.x - pos.x) / dirx);
  if (dirx < -1e-3) d = Math.min(d, (-BOUNDS.x - pos.x) / dirx);
  if (dirz > 1e-3) d = Math.min(d, (BOUNDS.zMax - pos.z) / dirz);
  if (dirz < -1e-3) d = Math.min(d, (BOUNDS.zMin - pos.z) / dirz);
  return d;
}

function flyStep(dt) {
  const f = flight, k = f.keys;
  // ---- stimulation: autopilot + you ----
  f.wander += (Math.random() - 0.5) * dt * 30;
  f.wander *= 1 - dt * 0.6;
  const yawDir = (a) => [-Math.sin(a), -Math.cos(a)];
  const [lx, lz] = yawDir(f.yaw + 0.6), [rx, rz] = yawDir(f.yaw - 0.6);
  const dL = wallDistance(f.pos, lx, lz), dR = wallDistance(f.pos, rx, rz);
  const loomL = clamp01((7 - dL) / 5.5), loomR = clamp01((7 - dR) / 5.5);
  const lowHigh = clamp01((1.6 - (f.pos.y - BOUNDS.yMin)) / 1.4) + clamp01((1.4 - (BOUNDS.yMax - f.pos.y)) / 1.2);
  if (k.gf && f.gfT < 0) f.gfT = 0;
  if (f.gfT >= 0) { f.gfT += dt; if (f.gfT > 0.4) f.gfT = -1; }
  // autopilot holds ~3.5 m by modulating DNg02; your keys add or remove spikes on top
  const hold = Math.max(-45, Math.min(45, (3.5 - f.pos.y) * 18 - f.vy * 10));
  const power0 = k.down ? 8 : 62 + hold + (k.up ? 110 : 0);
  f.rates = {
    dna02L: Math.max(0, 15 + f.wander) + (k.left ? 160 : 0),
    dna02R: Math.max(0, 15 - f.wander) + (k.right ? 160 : 0),
    dng02L: Math.max(0, power0),
    dng02R: Math.max(0, power0),
    gf: f.gfT >= 0 && f.gfT < 0.12 ? 250 : 0,
    loomL: 150 * Math.max(loomL, lowHigh * 0.3),
    loomR: 150 * Math.max(loomR, lowHigh * 0.3),
    eyeL: 3, eyeR: 3,
  };
  // ---- read the brain's output neurons ----
  const R = (n) => readout[n].rate;
  const steer = (R('dna02L') - R('dna02R')) / 110 + 0.35 * (R('dng02L') - R('dng02R')) / 110;
  const power = (R('dng02L') + R('dng02R')) / 2 / 110;
  const gfL = R('gfL'), gfR = R('gfR');
  if ((gfL + gfR) / 2 > 70 && f.evadeT <= 0) {
    // giant fiber volley: evasive saccade away from the side that fired harder, plus a climb
    f.evadeT = 0.45;
    f.evadeDir = gfL > gfR ? -1 : 1;
    f.vy += f.pos.y > 5.5 ? -4 : 4;   // dive away from the ceiling, otherwise pop up
    f.speed = Math.min(10, f.speed + 3);
    fly.state.jolt = 1;
  }
  f.evadeT -= dt;
  const yawRate = 1.9 * steer + (f.evadeT > 0 ? f.evadeDir * 3.2 : 0);
  f.yaw += yawRate * dt;
  const targetSpeed = Math.min(9, 1.5 + 6 * Math.min(1.6, power));
  f.speed += (targetSpeed - f.speed) * Math.min(1, dt * 1.2);
  const climb = 3.5 * (power - 0.56);
  f.vy += (climb - f.vy) * Math.min(1, dt * 1.5);
  // ---- integrate & keep inside the hall ----
  fwd.set(-Math.sin(f.yaw), 0, -Math.cos(f.yaw));
  f.pos.addScaledVector(fwd, f.speed * dt);
  f.pos.y += f.vy * dt;
  if (f.pos.x > BOUNDS.x || f.pos.x < -BOUNDS.x) { f.pos.x = Math.sign(f.pos.x) * BOUNDS.x; f.yaw += Math.PI * 0.5 * dt * 4; }
  if (f.pos.z > BOUNDS.zMax || f.pos.z < BOUNDS.zMin) { f.pos.z = Math.min(BOUNDS.zMax, Math.max(BOUNDS.zMin, f.pos.z)); f.yaw += Math.PI * 0.5 * dt * 4; }
  if (f.pos.y < BOUNDS.yMin) { f.pos.y = BOUNDS.yMin; f.vy = Math.abs(f.vy) * 0.5; }
  if (f.pos.y > BOUNDS.yMax) { f.pos.y = BOUNDS.yMax; f.vy = -Math.abs(f.vy) * 0.5; }
  f.bank += (-yawRate * 0.35 - f.bank) * Math.min(1, dt * 4);
  f.pitch += (-f.vy * 0.06 - f.pitch) * Math.min(1, dt * 3);
  // body axis along the heading, back up (seated frame: +y = head, +z = belly); roll about the body axis
  qYaw.setFromAxisAngle(AX_Y, f.yaw + Math.PI);
  qPitch.setFromAxisAngle(AX_X, Math.PI / 2 + f.pitch);
  qRoll.setFromAxisAngle(AX_Y, f.bank);
  fly.root.quaternion.copy(qYaw).multiply(qPitch).multiply(qRoll);
  fly.root.position.copy(f.pos).addScaledVector(fwd, -1.3);
  // hall light follows the subject
  lab.hall.light.position.set(f.pos.x * 0.5, 7.5, f.pos.z);

  // flight HUD
  const bars = [['fl-dnaL', 'dna02L'], ['fl-dnaR', 'dna02R'], ['fl-dng', null], ['fl-gf', null]];
  bars.forEach(([id, key]) => {
    let v;
    if (id === 'fl-dng') v = (R('dng02L') + R('dng02R')) / 2;
    else if (id === 'fl-gf') v = (gfL + gfR) / 2;
    else v = R(key);
    $(`#${id}`).style.width = `${Math.min(100, v / 2)}%`;
    $(`#${id}-v`).textContent = v.toFixed(0);
  });
  $('#fl-alt').textContent = `${f.pos.y.toFixed(1)} m`;
  $('#fl-spd').textContent = `${f.speed.toFixed(1)} m/s`;
}

// ---------------------------------------------------------------- input
const KEYMAP = {
  1: 'sugar', 2: 'bitter', 3: 'music', 4: 'wind', 5: 'tickle', 6: 'loom', 7: 'images', 8: 'odor', 9: 'shock', 0: 'light',
  t: 'strobe', е: 'strobe', l: 'laser', д: 'laser', c: 'spin', с: 'spin', n: 'hypoxia', т: 'hypoxia',
  v: 'scalpel', м: 'scalpel', k: 'inject', л: 'inject', j: 'toxin', о: 'toxin', r: 'reset', к: 'reset', f: 'flight', а: 'flight',
};
const STEER = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down', ф: 'left', в: 'right', ц: 'up', ы: 'down', ' ': 'gf' };
window.addEventListener('keydown', (e) => {
  if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;   // typing a link
  if (!entered || e.ctrlKey || e.metaKey || e.altKey || $('#about').open) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (flight.phase === 'flying') {
    if (STEER[key]) { flight.keys[STEER[key]] = true; e.preventDefault(); return; }
    if (key === 'x' || key === 'ч') { explode(); return; }
  }
  if (death.phase === 'dead' && (key === 'r' || key === 'к' || key === 'Enter')) { toggle('reset', true); return; }
  if (busy()) return;
  if (KEYMAP[key] !== undefined) toggle(KEYMAP[key], true);
  else if (key === 'q' || key === 'й') setFocus(focus === 'left' ? 'center' : 'left');
  else if (key === 'e' || key === 'у') setFocus(focus === 'right' ? 'center' : 'right');
  else if (key === 's' || key === 'ы') setFocus(focus === 'subject' ? 'center' : 'subject');
  else if (key === 'p' || key === 'з') setFocus(focus === 'console' ? 'center' : 'console');
  else if (key === 'Escape' || key === 'w' || key === 'ц') setFocus('center');
  else if (key === '?' || key === '/') openAbout();
});
window.addEventListener('keyup', (e) => {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (STEER[key]) flight.keys[STEER[key]] = false;
});
document.querySelectorAll('[data-steer]').forEach((b) => {
  const k = b.dataset.steer;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); flight.keys[k] = true; });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { flight.keys[k] = false; });
});
$('#btn-explode').addEventListener('click', () => { audio.key(); explode(); });
$('#btn-next').addEventListener('click', () => toggle('reset'));
window.addEventListener('pointerdown', () => audio.resume());
$('#btn-about').addEventListener('click', () => { audio.key(); openAbout(); });
$('#about .close').addEventListener('click', () => $('#about').close());
function openAbout() { $('#about').showModal(); }
$('#btn-sound').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  audio.setEnabled(on);
});
document.querySelectorAll('[data-focus]').forEach((b) => b.addEventListener('click', () => { audio.key(); setFocus(b.dataset.focus); }));

// your own music: a file picker or drag & drop; the file is played locally, never uploaded
function useTrack(file) {
  if (!file) return;
  stopYouTube();
  if (!/^audio\//.test(file.type) && !/\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|webm)$/i.test(file.name)) { note(t('j_track_bad'), 'warn'); return; }
  audio.start();
  audio.resume();
  audio.loadTrack(file);
  const name = file.name.replace(/\.[^.]+$/, '');
  $('#track-name').textContent = `♫ ${name}`;
  $('#btn-track').title = file.name;
  $('#btn-track').classList.add('on');
  $('#btn-track-x').hidden = false;
  note(`${t('j_track')}: ${name}`);
  if (!exp.music && entered && !busy()) toggle('music');
}
$('#btn-track')?.addEventListener('click', () => { audio.key(); $('#musicpanel').hidden = !$('#musicpanel').hidden; if (!$('#musicpanel').hidden) $('#yt-url').focus(); });
$('#mp-file')?.addEventListener('click', () => { $('#musicpanel').hidden = true; $('#track-file').click(); });
// the panel closes on a tap anywhere else or on Esc (on a phone it covers the brain monitor)
window.addEventListener('pointerdown', (e) => {
  const mp = $('#musicpanel');
  if (mp && !mp.hidden && !mp.contains(e.target) && !$('#btn-track').contains(e.target)) mp.hidden = true;
}, true);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#musicpanel')) $('#musicpanel').hidden = true; });

// ...or a YouTube video: the official embedded player plays it; the fly hears it through the mic
const yt = { player: null, api: null, id: '' };
function ytId(url) {
  const m = String(url).trim().match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/) || String(url).trim().match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : '';
}
function ytApi() {
  if (yt.api) return yt.api;
  yt.api = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return yt.api;
}
async function useYouTube(url) {
  const id = ytId(url);
  if (!id) { note(t('j_yt_bad'), 'warn'); return; }
  $('#musicpanel').hidden = true;
  audio.start();
  audio.resume();
  audio.clearTrack();
  audio.setExternal(true);
  yt.id = id;
  $('#yt').hidden = false;
  $('#track-name').textContent = '♫ YouTube';
  $('#btn-track').classList.add('on');
  $('#btn-track-x').hidden = false;
  if (!exp.music && entered && !busy()) toggle('music');
  const micP = audio.enableMic();
  const YT = await ytApi();
  if (yt.player) { yt.player.loadVideoById(id); if (!exp.music) yt.player.pauseVideo(); }
  else {
    yt.player = new YT.Player('yt-player', {
      videoId: id, width: 240, height: 135,
      playerVars: { autoplay: 1, playsinline: 1, loop: 1, playlist: id, rel: 0 },
      events: {
        onReady: (e) => { if (exp.music) e.target.playVideo(); else e.target.pauseVideo(); },
        onError: () => note(t('j_yt_err'), 'warn'),
        onStateChange: (e) => {
          const d = e.target.getVideoData && e.target.getVideoData();
          if (d && d.title) { $('#yt-title').textContent = d.title; $('#track-name').textContent = `♫ ${d.title}`; }
        },
      },
    });
  }
  note(await micP ? t('j_mic_on') : t('j_mic_off'), 'warn');
}
function stopYouTube() {
  if (!yt.id) return;
  if (yt.player) { yt.player.destroy(); yt.player = null; $('#yt').innerHTML = '<div class="yt-head"><span id="yt-title">YouTube</span></div><div id="yt-player"></div>'; }
  yt.id = '';
  $('#yt').hidden = true;
  audio.setExternal(false);
}
$('#yt-form')?.addEventListener('submit', (e) => { e.preventDefault(); useYouTube($('#yt-url').value); });
$('#track-file')?.addEventListener('change', (e) => { useTrack(e.target.files[0]); e.target.value = ''; });
$('#btn-track-x')?.addEventListener('click', () => {
  audio.key();
  stopYouTube();
  audio.clearTrack();
  $('#track-name').textContent = t('track_btn');
  $('#btn-track').classList.remove('on');
  $('#btn-track').title = t('track_title');
  $('#btn-track-x').hidden = true;
  note(t('j_track_off'));
});
onLang(() => { if (audio.trackName) $('#track-name').textContent = `♫ ${audio.trackName.replace(/\.[^.]+$/, '')}`; });
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (!entered || !e.dataTransfer?.types.includes('Files')) return; dragDepth++; document.body.dataset.drop = t('track_drop'); document.body.classList.add('dragging'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', (e) => { if (entered) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  if (!entered) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  useTrack(e.dataTransfer.files[0]);
});
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => { audio.key(); setLang(b.dataset.lang); }));
onLang(() => { renderLog(); updateEnterLabel(); if (!entered) decode($('#title'), t('title'), 500); });

// ---------------------------------------------------------------- intro -> lab
let entering = false;
function enter(skipCard = false) {
  if (!simReady || !warmed || entered || entering) return;
  audio.start();
  audio.resume();
  if (skipCard) { reallyEnter(true); return; }
  entering = true;
  const b = $('#enter');
  b.classList.add('scanning');
  b.querySelector('b').textContent = t('enter_scan');
  setTimeout(() => {
    $('#intro').classList.add('warp');
    intro.warp();
    audio.dive();
    setTimeout(() => {
      flash('#fff', 1, 0.9);
      reallyEnter(true);     // straight into the dark lab; its lights strike one by one
    }, 1250);
  }, 750);
}
function reallyEnter(skipCard) {
  entered = true;
  entering = false;
  $('#intro').classList.add('gone');
  $('#hud').hidden = false;
  document.body.classList.add('inlab');
  applyI18n();
  syncButtons();
  clearBrain();
  worker.postMessage({ type: 'start' });
  const go = () => {
    powerOnAt = clock.elapsedTime;
    recStart = performance.now();
    note(`${t('exp_no')} #${pad(expNo)} · ${t('j_start')}`);
  };
  if (skipCard) go(); else { flight.phase = 'title'; titleCard(() => { flight.phase = 'off'; go(); }); }
}
$('#enter').addEventListener('click', () => enter(false));

// camera focus: overview, subject close-up, console, monitor close-ups, injection, chase (flight)
let focus = 'center';
const camTarget = { pos: LAYOUT.camera.clone(), look: LAYOUT.lookAt.clone() };
const camLook = LAYOUT.lookAt.clone();
function setFocus(f) {
  focus = f;
  document.querySelectorAll('[data-focus]').forEach((b) => b.classList.toggle('on', b.dataset.focus === f));
  if (f === 'center') {
    camTarget.pos.copy(LAYOUT.camera);
    camTarget.look.copy(LAYOUT.lookAt);
  } else if (f === 'subject') {
    camTarget.pos.set(0.18, 1.66, 4.3);
    camTarget.look.set(0, 1.42, 0.7);
  } else if (f === 'inject') {
    camTarget.pos.set(-0.42, 1.7, 4.05);
    camTarget.look.set(-0.12, 1.5, 0.78);
  } else if (f === 'console') {
    camTarget.pos.set(0, 1.78, 6.7);
    camTarget.look.set(0, 0.95, 5.15);
  } else {
    const g = lab.monitors[f].group;
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
    camTarget.look.copy(g.position);
    camTarget.pos.copy(g.position).addScaledVector(n, 0.72 * Math.max(1, 1.5 / camera.aspect));
  }
}
const raycaster = new THREE.Raycaster();
const mouseN = new THREE.Vector2();
const tip = $('#tip');
let hoverId = null;
function pickAt(x, y) {
  mouseN.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouseN, camera);
  return desk.pick(raycaster);
}
const interactive = () => entered && flight.phase === 'off' && (death.phase === 'off' || death.phase === 'dead');
canvas.addEventListener('pointermove', (e) => {
  if (!innerWidth || !innerHeight) return;   // minimised / zero-size window
  mouseN.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (!interactive()) { canvas.style.cursor = ''; tip.hidden = true; if (hoverId) { hoverId = null; desk.setHover(null); } return; }
  let id = pickAt(e.clientX, e.clientY);
  if (death.phase === 'dead' && id !== 'reset') id = null;
  if (id !== hoverId) { hoverId = id; desk.setHover(id); }
  canvas.style.cursor = id ? 'pointer' : '';
  const part = id ? null : pickPart();
  if (part) {
    canvas.style.cursor = 'crosshair';
    tip.hidden = false;
    tip.querySelector('b').textContent = `${t('tip_cut')}: ${t('part_' + part.id)}`;
    tip.querySelector('span').textContent = t('cut_' + part.kind);
    tip.querySelector('kbd').textContent = '✂';
    tip.style.transform = `translate(${Math.min(innerWidth - 300, e.clientX + 18)}px, ${Math.max(70, e.clientY - 70)}px)`;
    return;
  }
  if (id && e.pointerType !== 'touch') {
    tip.hidden = false;
    const b = BUTTONS.find((x) => x.id === id);
    const key = b ? b.key : { reset: 'R', flight: 'F', inject: 'K', toxin: 'J' }[id];
    tip.querySelector('b').textContent = id === 'toxin' ? `${t('btn_toxin')}: ${desk.toxin ? t('tox_neo') : t('tox_ttx')}` : t(`tip_${id}`);
    tip.querySelector('span').textContent = t(`tip_${id}_d`);
    tip.querySelector('kbd').textContent = key;
    const x = Math.min(innerWidth - 300, e.clientX + 18), y = Math.max(70, e.clientY - 70);
    tip.style.transform = `translate(${x}px, ${y}px)`;
  } else tip.hidden = true;
});
canvas.addEventListener('click', (e) => {
  if (!monitors || !interactive()) return;
  const id = pickAt(e.clientX, e.clientY);
  if (death.phase === 'dead') { if (id === 'reset') toggle('reset'); return; }
  if (id) { toggle(id); tip.hidden = true; return; }
  const part = pickPart();
  if (part) { if (!saw.busy) saw.start(part); tip.hidden = true; return; }
  if (exp.scalpel) return;
  const hit = raycaster.intersectObjects([monitors.screens.left, monitors.screens.right])[0];
  if (hit) setFocus(hit.object === monitors.screens.left ? (focus === 'left' ? 'center' : 'left') : (focus === 'right' ? 'center' : 'right'));
  else if (focus !== 'center') setFocus('center');
});

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(21)) * 16 / 9);
  const vfov = 2 * Math.atan(Math.tan(hfov / 2) / camera.aspect);
  camera.fov = Math.min(Math.max(THREE.MathUtils.radToDeg(vfov), 42), 92);
  camera.updateProjectionMatrix();
  if (fly.headBrainMat) fly.headBrainMat.uniforms.uScale.value = camera.projectionMatrix.elements[5] * h * renderer.getPixelRatio() / 2;
  if (intro) intro.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- adaptive quality
let quality = new URLSearchParams(location.search).has('low') ? 0 : 2;
let perfT = 0, perfN = 0;
function applyQuality() {
  if (quality <= 1) renderer.setPixelRatio(1);
  if (quality === 0) {
    bloom.enabled = false;
    lab.spot.light.castShadow = false;
  }
  resize();
}
function watchPerf(dt) {
  if (quality === 0 || !entered) return;
  perfT += dt; perfN++;
  if (perfT > 2.5) {
    if (perfT / perfN > 1 / 42) { quality--; applyQuality(); }
    perfT = 0; perfN = 0;
  }
}
if (quality === 0) setTimeout(applyQuality, 0);

// ---------------------------------------------------------------- light behaviour
// the lamp over the subject fails now and then; a tube far down the hall barely works
const flick = { level: 1, next: 7, seq: null, far: 0.02, farNext: 4, farSeq: null, figureAt: -99 };
function flickerSeq() {
  const s = [];
  if (Math.random() < 0.62) {
    const n = 4 + Math.floor(Math.random() * 7);
    for (let k = 0; k < n; k++) s.push([0.03 + Math.random() * 0.1, Math.random() < 0.55 ? 0.04 : 0.5 + Math.random() * 0.5]);
  } else {
    s.push([0.05, 0.2], [0.07, 1], [0.04, 0], [0.7 + Math.random() * 1.6, 0], [0.05, 0.6], [0.05, 0], [0.1, 1], [0.04, 0.3]);
  }
  s.push([0.1, 1]);
  return { s, k: 0, t: 0 };
}
function runFlicker(dt, now) {
  if (!flick.seq && now > flick.next) flick.seq = flickerSeq();
  if (flick.seq) {
    const q = flick.seq;
    q.t += dt;
    while (q.k < q.s.length && q.t > q.s[q.k][0]) { q.t -= q.s[q.k][0]; q.k++; }
    if (q.k >= q.s.length) { flick.seq = null; flick.level = 1; flick.next = now + 8 + Math.random() * 20; }
    else flick.level = q.s[q.k][1];
  }
  audio.setBuzz(flick.seq ? (flick.level < 0.9 ? 1 : 0.4) : 0);
  // far tube
  if (!flick.farSeq && now > flick.farNext) {
    flick.farSeq = flickerSeq();
    flick.farSeq.s.push([1 + Math.random() * 3, 0.9]);
    if (now - flick.figureAt > 50 && Math.random() < 0.3) { lab.far.figure.visible = true; flick.figureAt = now; }
  }
  if (flick.farSeq) {
    const q = flick.farSeq;
    q.t += dt;
    while (q.k < q.s.length && q.t > q.s[q.k][0]) { q.t -= q.s[q.k][0]; q.k++; }
    if (q.k >= q.s.length) { flick.farSeq = null; flick.far = 0.02; flick.farNext = now + 5 + Math.random() * 15; lab.far.figure.visible = false; }
    else flick.far = q.s[q.k][1];
  }
  lab.far.tube.color.setRGB(0.05 + 0.9 * flick.far, 0.06 + 0.95 * flick.far, 0.055 + 0.85 * flick.far);
  lab.far.glow.color.setRGB(0.25 * flick.far, 0.3 * flick.far, 0.28 * flick.far);
}

// ---------------------------------------------------------------- frame loop
const clock = new THREE.Clock();
let powerOnAt = -1;
let rateTimer = 0, hud = 0;
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
const ledColor = new THREE.Color();
const FEED_OFFSET = new THREE.Vector3(0.0, -0.05, 0.07);
const VR_OFFSET = new THREE.Vector3(0, 0.01, -0.03);
const HOOD_OFFSET = new THREE.Vector3(0, 0.02, 0.0);
const vrRest = new THREE.Vector3(0, 4.6, 0.95);
const vrPos = vrRest.clone();
const hoodPos = lab.hood.rest.clone();
const headWorld = new THREE.Vector3();
const brushRest = new THREE.Vector3(0.75, 3.05, 1.15);
const UPV = new THREE.Vector3(0, 1, 0);
const injRestTip = new THREE.Vector3(-0.85, 2.55, 1.5);
const injTip = injRestTip.clone();
const injDir = new THREE.Vector3(0.45, -0.8, -0.3).normalize();
const ZV = new THREE.Vector3(0, 0, 1);
let powerStage = -1;
let slowK = 1;   // slow motion at the moment of a cut
const dmm = new THREE.Object3D();

function frame() {
  const rawDt = clock.getDelta();
  const now = clock.elapsedTime;
  slowK += ((now < slowUntil ? 0.22 : 1) - slowK) * Math.min(1, rawDt * (now < slowUntil ? 30 : 4));
  const dt = Math.min(rawDt, 0.05) * timeScale * slowK;
  if (rawDt < 0.2 && !document.hidden) watchPerf(rawDt);
  lensPass.uniforms.uTime.value = now;

  // ---------------- title sequence ----------------
  if (!entered) {
    if (intro) {
      intro.update(dt, true);
      painter.flush();
      $('#d-section').textContent = intro.state.scan < 1 ? `${Math.round(intro.scanPercent * 100)}%` : t('d_done');
      if (simReady) $('#d-spikes').textContent = fmt(Math.round(stats.spikesPerS));
      renderPass.scene = intro.scene; renderPass.camera = intro.camera;
    }
    lensPass.uniforms.uFade.value = Math.min(1, lensPass.uniforms.uFade.value + dt * 0.8);
    lensPass.uniforms.uGlitch.value = intro && intro.state.warp >= 0 ? clamp01(intro.state.warp - 0.6) : 0;
    if (intro) composer.render(dt);
    lastFrameAt = performance.now();
    return;
  }
  const inLab = flight.phase === 'off' || flight.phase === 'title';
  const labIdle = inLab && death.phase === 'off';

  // ---------------- experiment state ----------------
  exp.hunger = Math.min(1, exp.hunger + dt / 400);
  if (exp.odorT >= 0) { exp.odorT += dt; if (exp.odorT > 1.6 && exp.odorT - dt <= 1.6) syncButtons(); }
  if (exp.shockT >= 0) { exp.shockT += dt; if (exp.shockT > 0.6 && exp.shockT - dt <= 0.6) syncButtons(); if (exp.shockT > 3) exp.shockT = -1; }
  if (exp.painT >= 0) { exp.painT += dt; if (exp.painT > 1) exp.painT = -1; }
  const shocking = exp.shockT >= 0 && exp.shockT < 0.35;
  if (shocking) exp.flicker = Math.max(exp.flicker, Math.random());
  exp.flicker = Math.max(0, exp.flicker - dt * 5);
  exp.windAmt += ((exp.wind ? 0.75 + 0.25 * Math.sin(now * 2.3) * Math.sin(now * 0.7) : 0) - exp.windAmt) * Math.min(1, dt * 2);
  runFlicker(dt, now);

  // strobe: 3 flashes per second
  if (exp.strobe) {
    const before = exp.strobePh % 1;
    exp.strobePh += dt * 3;
    if (exp.strobePh % 1 < before) audio.strobeFlash();
    exp.strobeFlash = (exp.strobePh % 1) < 0.18 ? 1 : 0;
  } else exp.strobeFlash = 0;
  lab.strobe.light.intensity = exp.strobeFlash * (reduceMotion ? 6 : 34);
  lab.strobe.face.color.setScalar(exp.strobeFlash ? 3 : 0.1);

  // laser: glare, then photoreceptor damage around the spot (blocked for good)
  const ls = lab.laser;
  if (exp.laser) {
    exp.laserT += dt;
    ls.core.opacity = 0.9 + 0.1 * Math.random();
    ls.glow.opacity = 0.18 + 0.06 * Math.random();
    ls.hit.material.opacity = 0.75 + 0.25 * Math.sin(now * 40);
    ls.led.color.setRGB(0.3, 2, 0.4);
    if (exp.laserT > 1.5 && labIdle && exp.burnK < burnOrder.length * 0.42) {   // the spot: ~40 % of the eye
      exp.burnAcc += dt * (40 + 25 * (exp.laserT - 1.5));     // facets per second, growing
      const n = Math.floor(exp.burnAcc);
      if (n > 0) {
        exp.burnAcc -= n;
        const idx = [];
        while (idx.length < n && exp.burnK < burnOrder.length) { const pr = burnOrder[exp.burnK++].i; if (kind[pr] === 0) idx.push(pr); }
        if (idx.length) { schedule(Int32Array.from(idx), new Float32Array(idx.length), 3); exp.burned += idx.length; }
        if (exp.burned > 0 && exp.burned - idx.length === 0) note(t('j_burn'), 'red');
      }
    }
    audio.setLaser(true, clamp01((exp.laserT - 1.5) / 2));
  } else {
    exp.laserT = 0;
    ls.core.opacity = 0; ls.glow.opacity = 0; ls.hit.material.opacity = 0;
    ls.led.color.setRGB(0.04, 0.16, 0.04);
  }

  // centrifuge: the chair spins the subject (antennae deflected, optic flow)
  exp.spinW += ((exp.spin ? 1 : 0) - exp.spinW) * Math.min(1, dt * (exp.spin ? 0.45 : 0.6));
  if (!exp.spin && exp.spinW < 0.04) {
    // settle facing the window
    const target = Math.round(exp.spinAngle / (Math.PI * 2)) * Math.PI * 2;
    exp.spinAngle += (target - exp.spinAngle) * Math.min(1, dt * 2.5);
  } else exp.spinAngle += exp.spinW * 11 * dt;
  if (inLab) {
    lab.spin.forEach((g) => { g.rotation.y = exp.spinAngle; });
    if (flight.phase === 'off') fly.root.rotation.y = exp.spinAngle;
  }
  audio.setSpin(exp.spinW);

  // feeder follows the labellum while feeding
  fly.proboscisTip.getWorldPosition(labellumPos);
  if (exp.feed) { exp.feed.t += dt; tmp.copy(labellumPos).add(FEED_OFFSET); } else tmp.set(0.85, 1.2, 1.75);
  tipPos.lerp(tmp, 1 - Math.exp(-dt * 3.2));
  contact = !!exp.feed && tipPos.distanceTo(tmp) < 0.06 && exp.feed.volume > 0;
  const fd = lab.feeder;
  fd.arm.lookAt(tipPos);
  const L = fd.joint.position.distanceTo(tipPos);
  const bar = fd.arm.children[0];
  bar.scale.z = Math.max(0.05, L - 0.45);
  bar.position.z = bar.scale.z / 2;
  fd.syringe.position.z = L - 0.48;
  if (contact && exp.feed.kind === 'sugar' && fly.state.ext > 0.45) {
    exp.feed.volume = Math.max(0, exp.feed.volume - dt * 0.09);
    exp.hunger = Math.max(0, exp.hunger - dt * 0.06);
  }
  fd.drop.scale.setScalar(exp.feed ? 0.3 + 0.7 * exp.feed.volume : 0.7);
  if (exp.feed && exp.feed.volume <= 0) { exp.feed = null; audio.servo(0.9); syncButtons(); }

  // VR visor
  fly.head.getWorldPosition(headWorld);
  const vrTarget = exp.vr ? tmp2.copy(headWorld).add(VR_OFFSET) : vrRest;
  vrPos.lerp(vrTarget, 1 - Math.exp(-dt * 3));
  lab.vr.group.position.copy(vrPos);
  lab.vr.leds.forEach((l, i) => l.material.color.set(exp.vr ? (Math.floor(now * 4 + i) % 3 ? 0x40ff90 : 0x0a3318) : 0x0a1a10));
  const vl = (vr.lum[0] + vr.lum[1]) / 2;
  lab.vr.front.material.color.setRGB(0.1, exp.vr ? 0.5 + 0.9 * vl : 0.05, exp.vr ? 0.45 + 0.8 * vl : 0.05);
  vr.update(dt);

  // N2 hood: lowered over the head, fills, the brain goes quiet
  const hoodTarget = exp.hypoxia ? tmp2.copy(headWorld).add(HOOD_OFFSET) : lab.hood.rest;
  hoodPos.lerp(hoodTarget, 1 - Math.exp(-dt * 2.6));
  lab.hood.group.position.copy(hoodPos);
  if (exp.hypoxia) {
    exp.hypoT += dt;
    exp.hoodSeal = hoodPos.distanceTo(hoodTarget) < 0.04;
    if (exp.hoodSeal) exp.gas = Math.min(1, exp.gas + dt / 3.2);
    if (exp.gas > 0.65 && exp.comaAt < 0 && labIdle) startComa();
    if (exp.comaAt >= 0) {
      exp.comaAt += dt;
      if (exp.comaAt > 42 && death.phase === 'off') { death.total = 0; death.endSim = stats.simMs; death.startSim = stats.simMs - exp.comaAt * 1000; death.cause = 'hypoxia'; exp.hypoxia = false; audio.setGas(0); finishDeath(); }
    }
    audio.setGas(exp.hoodSeal && exp.gas < 1 ? 1 : 0.15);
  } else exp.gas = Math.max(0, exp.gas - dt / 1.8);
  lab.hood.mist.uniforms.uFill.value = exp.gas;
  lab.hood.mist.uniforms.uTime.value = now;
  exp.coma = kind ? clamp01(blockedCount / neurons.n) : 0;

  // speakers, fan, tickler
  lab.speakers.forEach((s) => {
    s.dome.scale.setScalar(1 + audio.level * 0.6 * (0.6 + 0.4 * Math.sin(now * 50)));
    s.led.material.color.set(exp.music ? 0xff3010 : 0x220800);
  });
  const fan = lab.fan;
  fan.blades.rotation.z += dt * 30 * exp.windAmt;
  const sp = fan.streaks.geometry.attributes.position;
  fan.parts.forEach((p, i) => {
    p.t = (p.t + dt * 1.4) % 1;
    tmp.copy(fan.from).lerp(fan.to, p.t).add(p.off);
    sp.setXYZ(i * 2, tmp.x, tmp.y, tmp.z);
    tmp.copy(fan.from).lerp(fan.to, Math.min(1, p.t + 0.12)).add(p.off);
    sp.setXYZ(i * 2 + 1, tmp.x, tmp.y, tmp.z);
  });
  sp.needsUpdate = true;
  fan.streaks.material.opacity = 0.3 * exp.windAmt;
  const tk = lab.tickler;
  const brushTarget = exp.tickle
    ? tmp.set(0.1 + Math.sin(now * 3.1) * 0.08, 1.98 + Math.sin(now * 4.7) * 0.04, 0.8 + Math.cos(now * 3.1) * 0.05).add(fly.root.position).sub(LAYOUT.chair)
    : brushRest;
  brushPos.lerp(brushTarget, 1 - Math.exp(-dt * 3));
  tickleContact = exp.tickle && brushPos.distanceTo(brushTarget) < 0.12;
  const rodDir = tmp2.copy(brushPos).sub(tk.anchor);
  tk.rod.position.copy(tk.anchor);
  tk.rod.scale.set(1, rodDir.length(), 1);
  tk.rod.quaternion.setFromUnitVectors(UPV, rodDir.normalize());
  tk.brush.position.copy(brushPos);
  tk.brush.rotation.z = Math.sin(now * 20) * 0.3 * (tickleContact ? 1 : 0);

  // injector: approach, pierce, push the plunger
  const ij = lab.injector;
  if (death.phase === 'inject') {
    death.t += dt;
    const tt = death.t;
    const approach = clamp01(tt / 1.3), e = approach * approach * (3 - 2 * approach);
    const pierce = clamp01((tt - 1.35) / 0.18);
    tmp.copy(LAYOUT.thorax).addScaledVector(injDir, -0.1 * (1 - pierce) + 0.035);
    injTip.copy(injRestTip).lerp(tmp, e);
    if (tt > 1.35 && !death.pierced) { death.pierced = true; audio.needle(); exp.painT = 0; fly.state.spasm = 1; note(t('j_needle'), 'red'); }
    if (tt > 1.6 && !death.pushing) { death.pushing = true; audio.plunger(1.6); }
    death.plunge = clamp01((tt - 1.6) / 1.6);
    if (tt > 2.2 && !death.sched) toxinSchedule();
    if (tt > 3.4) { death.pierced = false; death.pushing = false; enterPOV(); }
  } else if (death.phase === 'pov' || death.phase === 'dead') {
    // stays in place
  } else {
    injTip.lerp(injRestTip, 1 - Math.exp(-dt * 2.5));
    death.plunge = Math.max(0, death.plunge - dt * 0.5);
  }
  const syrBack = tmp.copy(injTip).addScaledVector(injDir, -0.66);
  ij.syringe.position.copy(syrBack);
  ij.syringe.quaternion.setFromUnitVectors(ZV, injDir);
  const rd = tmp2.copy(syrBack).sub(ij.anchor);
  ij.rod.position.copy(ij.anchor); ij.rod.scale.set(1, rd.length(), 1);
  ij.rod.quaternion.setFromUnitVectors(UPV, rd.clone().normalize());
  ij.sleeve.position.copy(ij.anchor); ij.sleeve.quaternion.copy(ij.rod.quaternion);
  ij.plunger.position.z = 0.02 + 0.36 * death.plunge;
  ij.liquid.scale.y = Math.max(0.001, 0.36 * (1 - death.plunge));
  ij.liquid.position.z = 0.03 + 0.36 * death.plunge;

  // electric arcs + electrode LEDs during a shock
  const arcs = lab.arcs;
  arcs.material.opacity = shocking ? 0.6 + 0.4 * Math.random() : Math.max(0, arcs.material.opacity - dt * 6);
  if (shocking) {
    const ap = arcs.geometry.attributes.position;
    let n = 0;
    lab.rig.tips.forEach((tp) => {
      let prev = tp.clone();
      for (let s = 1; s <= 8; s++) {
        const k = s / 8;
        const next = tp.clone().lerp(new THREE.Vector3(0, 1.78, 0.1), k * 0.85)
          .add(new THREE.Vector3((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06));
        ap.setXYZ(n++, prev.x, prev.y, prev.z);
        ap.setXYZ(n++, next.x, next.y, next.z);
        prev = next;
      }
    });
    ap.needsUpdate = true;
  }
  const ovlFx = clamp01((ovl.load - 0.8) * 2) * (inLab ? 1 : 0);
  lab.rig.leds.forEach((m, i) => m.color.set(shocking ? 0x9fd8ff : ovlFx > 0.3 && Math.random() < 0.5 ? 0xff2010 : (Math.floor(now * 2 + i) % 6 ? 0x40ff90 : 0x0a4020)));

  // overload sparks from the electrode crown
  const spk = lab.sparks;
  ovl.sparkAcc += dt * ovlFx * 120;
  const spp = spk.lines.geometry.attributes.position;
  spk.parts.forEach((q, i) => {
    if (q.life <= 0 && ovl.sparkAcc > 1) {
      ovl.sparkAcc -= 1;
      q.life = 0.3 + Math.random() * 0.5;
      const c = lab.rig.crown[Math.floor(Math.random() * 6)];
      lab.rig.group.localToWorld(q.p.copy(c));
      q.v.set((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3);
      if (i % 9 === 0) audio.spark();
    }
    if (q.life > 0) { q.life -= dt; q.v.y -= 9.8 * dt; q.p.addScaledVector(q.v, dt); }
    const vis = q.life > 0 ? 1 : 0;
    spp.setXYZ(i * 2, q.p.x, q.p.y - 50 * (1 - vis), q.p.z);
    spp.setXYZ(i * 2 + 1, q.p.x - q.v.x * 0.025, q.p.y - q.v.y * 0.025 - 50 * (1 - vis), q.p.z - q.v.z * 0.025);
  });
  spp.needsUpdate = true;

  // severed parts, injury timers
  for (const c of exp.cuts) c.t += dt;
  cutFx.update(dt);
  saw.update(dt);

  // odor puff particles
  const od = lab.odor;
  const puffing = exp.odorT >= 0 && exp.odorT < 1.6;
  const posAttr = od.puff.geometry.getAttribute('position');
  od.particles.forEach((p, i) => {
    if (p.life <= 0 && puffing && Math.random() < dt * 60) {
      p.life = 1.4;
      p.p.copy(od.tip);
      p.v.set(0.3 + Math.random() * 0.15, -0.12 + Math.random() * 0.1, -0.33 + Math.random() * 0.12);
    }
    if (p.life > 0) { p.life -= dt; p.p.addScaledVector(p.v, dt); p.v.multiplyScalar(1 - dt * 0.6); p.v.y += dt * 0.03; }
    posAttr.setXYZ(i, p.p.x, p.life > 0 ? p.p.y : -50, p.p.z);
  });
  posAttr.needsUpdate = true;
  od.puff.material.opacity = puffing ? 0.9 : Math.max(0, od.puff.material.opacity - dt * 0.5);

  // ---------------- lights ----------------
  const powered = powerOnAt >= 0;
  const pt = powered ? now - powerOnAt : -1;
  // power-on: red light, task lamp, monitors, then the lamp over the subject strikes
  if (powered && powerStage < 0) { powerStage = 0; audio.tubeStart(0.1); audio.tubeStart(0.55); audio.tubeStart(1.1); }
  if (!powered) powerStage = -1;
  const strike = (t0) => (pt < t0 ? 0 : pt < t0 + 0.5 ? (Math.random() < 0.5 ? 0.15 : 1) : 1);
  const spt = lab.spot;
  const spotPower = strike(1.1);
  const spotOn = (exp.light && flight.phase !== 'flying' ? 1 : flight.phase === 'flying' ? 0.4 : 0) * spotPower * flick.level * (1 - exp.flicker * 0.85);
  spt.light.intensity = spt.base * spotOn;
  spt.cone.material.uniforms.uOpacity.value = 0.32 * spotOn;
  spt.cone.material.uniforms.uTime.value = now;
  spt.face.material.color.setScalar(0.06 + 0.94 * spotOn);
  lab.fill.spill.intensity = lab.fill.spillBase * spotOn;
  lab.fill.rim.intensity = lab.fill.rimBase * (0.4 + 0.6 * spotOn);
  const bt = lab.booth;
  const dyingBooth = 1;
  const ovlFlick = ovlFx > 0.2 && Math.random() < ovlFx * 0.5 ? 0.15 : 1;
  const redDip = Math.random() < 0.004 ? 0.4 : 1;
  const redOn = strike(0.1) * ovlFlick * redDip * dyingBooth;
  bt.red.intensity = bt.redBase * redOn * (1 + 0.6 * ovlFx * Math.sin(now * 9));
  bt.redMat.color.setRGB(redOn * 1.6, redOn * 0.18, redOn * 0.1);
  const taskOn = strike(0.55) * (Math.random() < 0.002 ? 0.2 : 1) * dyingBooth;
  bt.task.intensity = bt.taskBase * taskOn;
  bt.taskMat.color.setRGB(taskOn * 1.4, taskOn * 1.15, taskOn * 0.85);
  const leds = lab.leds;
  for (let i = 0; i < leds.colors.length; i++) {
    const on = Math.sin(now * leds.rate[i] + leds.phase[i]) > -0.2;
    ledColor.copy(leds.colors[i]).multiplyScalar(on && powered ? 1.4 : 0.06);
    leds.mesh.setColorAt(i, ledColor);
  }
  leds.mesh.instanceColor.needsUpdate = true;
  lab.dust.rotation.y = now * 0.01;
  // tanks: slow bob, rising bubbles, a sick pulse in the light
  const tk2 = lab.tanks;
  for (let i = 0; i < tankFlies.count; i++) {
    const [x, z] = tk2.pos[i];
    dmm.position.set(x, 0.62 + Math.sin(now * 0.4 + i * 1.7) * 0.05, z - 0.12);
    dmm.rotation.set(0.15 * Math.sin(now * 0.23 + i), (x < 0 ? 1 : -1) * 1.1 + 0.2 * Math.sin(now * 0.17 + i * 2), 0.08 * Math.sin(now * 0.31 + i));
    dmm.scale.setScalar(0.62);
    dmm.updateMatrix();
    tankFlies.setMatrixAt(i, dmm.matrix);
  }
  tankFlies.instanceMatrix.needsUpdate = true;
  tk2.glow.color.setRGB(0.25, 0.65 + 0.12 * Math.sin(now * 0.8), 0.3);
  const bp = tk2.bubbles.geometry.attributes.position;
  tk2.bub.forEach((b, i) => {
    b.y += b.v * dt;
    if (b.y > 2.6) b.y = 0;
    const [x, z] = tk2.pos[b.tank];
    bp.setXYZ(i, x + b.x * 0.9 + Math.sin(now * 2 + i) * 0.02, 0.4 + b.y, z + b.z * 0.9);
  });
  bp.needsUpdate = true;

  updateFlight(dt, now);

  // ---------------- simulation I/O ----------------
  let r = null;
  if (simReady) {
    rateTimer += dt;
    r = rates();
    if (rateTimer > 0.05) { rateTimer = 0; worker.postMessage({ type: 'rates', rates: r, exc: excGain() }); }
    // STRESS: the strongest of three aversive circuits (square-root scale)
    const st = Math.max(
      Math.sqrt(clamp01(readout.escape.rate / readout.escape.max)),
      Math.sqrt(clamp01(readout.alarm.rate / readout.alarm.max)),
      Math.sqrt(clamp01(readout.ppl1.rate / readout.ppl1.max)),
    );
    stress += (st - stress) * Math.min(1, dt * (st > stress ? 10 : 1.2));
    ovl.load += (stats.central / LOAD_CAP - ovl.load) * Math.min(1, dt * 3);
  }
  if (painter) runSchedules(now);
  if (maskFlash.size) {
    for (const tx of maskFlash) {
      const o = tx * 4 + 1;
      const v = maskData[o] - dt * 700;
      if (v <= 0) { maskData[o] = 0; maskFlash.delete(tx); } else maskData[o] = v;
    }
    maskDirty = true;
  }
  if (maskDirty) { maskTex.needsUpdate = true; maskDirty = false; }

  // overload: sustained central firing above capacity
  if (labIdle && simReady) {
    if (ovl.load > 1) ovl.hot += dt; else ovl.hot = Math.max(0, ovl.hot - dt * 0.6);
    if (!ovl.crit && ovl.hot > 1.5) {
      ovl.crit = true; ovl.count = 10; ovl.calm = 0;
      note(t('j_overload'), 'red');
      audio.glitch();
    }
    if (ovl.crit) {
      if (ovl.load < 0.55) ovl.calm += dt; else ovl.calm = 0;
      if (ovl.calm > 2) { ovl.crit = false; ovl.hot = 0; note(t('j_stable')); setAlarm(null); }
      else {
        if (ovl.load > 0.7) ovl.count -= dt;
        setAlarm(t('ovl_title'), t('ovl_text').replace('{s}', Math.max(0, ovl.count).toFixed(1)));
        if (ovl.count <= 0) startDeath('overload');
      }
    } else if (ovl.load > 0.85) setAlarm(t('ovl_warn'), t('ovl_warn_d'), 'amber');
    else if (!$('#alarm').hidden && !ovl.crit) setAlarm(null);
  }
  audio.setOverload(death.phase === 'off' && inLab ? clamp01((ovl.load - 0.7) / 0.8) : 0);
  audio.setSpikes(simReady ? stats.central : 0);
  lensPass.uniforms.uGlitch.value = labIdle ? clamp01((ovl.load - 1) * 1.5) * (ovl.crit ? 1 : 0.4) : 0;

  // ---------------- death ----------------
  const aliveFrac = kind ? 1 - blockedCount / neurons.n : 1;
  const visAlive = kind ? 1 - visBlocked / visCount : 1;
  if (death.phase === 'pov') {
    death.t += dt;
    death.flash = Math.max(0, death.flash - dt * 2.5);
    const sched = death.sched;
    const done = sched && !schedules.includes(sched) && aliveFrac < 0.01;
    if (done && death.doneT < 0) { death.doneT = death.t; death.endSim = stats.simMs; audio.setFlatline(true); }
    // heartbeat slows as the brain dies; ringing grows
    const period = 0.75 + 1.8 * (1 - aliveFrac);
    death.beat -= dt;
    if (death.beat < 0 && death.doneT < 0) { death.beat = period; audio.heartbeat(); }
    audio.setTinnitus(clamp01((1 - aliveFrac) * 1.3));
    audio.setMuffle(300 + 3500 * aliveFrac);
    if (death.doneT >= 0 && death.t - death.doneT > 2.4) finishDeath();
    $('#pov-time').textContent = `+${((stats.simMs - death.startSim) / 1000).toFixed(1)} s`;
    $('#pov-alive').textContent = `${fmt(neurons.n - blockedCount)} · ${Math.round(aliveFrac * 100)}%`;
    $('#pov-spikes').textContent = fmt(Math.round(stats.spikesPerS));
  }
  if (death.phase === 'dead') death.t += dt;

  // ---------------- fly ----------------
  const tremor = Math.max(clamp01((ovl.load - 0.75) * 2) * (inLab ? 1 : 0), death.cause === 'neo' && death.phase !== 'off' ? clamp01(ovl.load) * aliveFrac : 0);
  const drive = {
    proboscis: Math.min(1, readout.proboscis.rate / 55),
    escape: Math.min(1, readout.escape.rate / 90),
    sound: audio.level,
    odor: puffing ? 1 : 0,
    groom: Math.min(1, readout.groom.rate / 25),
    stress,
    shock: shocking || (exp.painT >= 0 && exp.painT < 0.3) ? 1 : 0,
    wind: Math.max(exp.windAmt, exp.spinW),
    flight: flight.phase === 'flying' || (flight.phase === 'release' && flight.t > 1.2),
    dead: death.phase === 'off' ? 0 : clamp01((1 - aliveFrac) * 1.15) * (death.phase === 'inject' ? 0 : 1),
    limp: clamp01(exp.coma * 1.1),
    tremor,
    spin: exp.spinW,
  };
  if (fly.root.visible) fly.update(dt, drive);
  audio.update(dt, { escape: drive.escape * (1 - drive.dead), seizure: ovl.crit && labIdle, flight: drive.flight ? 1 : 0 });
  audio.setDrone(death.phase === 'pov' ? 0.3 : 1);

  // ---------------- camera ----------------
  if (flight.phase === 'flying' || flight.phase === 'boom') {
    // chase cam behind, above and slightly to the side (3/4 view shows the wings)
    fwd.set(-Math.sin(flight.yaw), 0, -Math.cos(flight.yaw));
    tmpV.copy(flight.pos).addScaledVector(fwd, -4.2).add(new THREE.Vector3(fwd.z * 1.4, 2.0, -fwd.x * 1.4));
    tmpV.x = Math.min(9, Math.max(-9, tmpV.x));
    tmpV.y = Math.min(8.4, Math.max(0.6, tmpV.y));
    tmpV.z = Math.min(3.4, Math.max(-62, tmpV.z));
    if (flight.phase === 'flying') flight.camPos.lerp(tmpV, 1 - Math.exp(-dt * 3));
    camera.position.copy(flight.camPos);
    tmp.copy(flight.pos).addScaledVector(fwd, flight.phase === 'flying' ? 2 : 0);
    camLook.lerp(tmp, 1 - Math.exp(-dt * 5));
    camera.lookAt(camLook);
    flight.shake = Math.max(0, flight.shake - dt * 0.9);
    if (flight.shake > 0) {
      camera.position.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(flight.shake * 0.35));
    }
  } else {
    const k = 1 - Math.exp(-dt * (death.phase === 'inject' ? 1.8 : 2.6));
    const par = focus === 'center' ? 1 : 0.15;
    tmp.copy(camTarget.pos);
    tmp.x += mouseN.x * 0.14 * par;
    tmp.y += mouseN.y * 0.06 * par;
    if (powerOnAt < 0) { tmp.x += Math.sin(now * 0.2) * 0.05; tmp.y += 0.02; tmp.z += 0.35; }
    camera.position.lerp(tmp, k);
    camLook.lerp(camTarget.look, k);
    if (!Number.isFinite(camera.position.x + camera.position.y + camLook.x + camLook.y)) { camera.position.copy(camTarget.pos); camLook.copy(camTarget.look); }
    camera.lookAt(camLook);
    camera.position.y += Math.sin(now * 0.9) * 0.0015;
    if (camShake > 0) { camShake = Math.max(0, camShake - rawDt * 1.8); camera.position.add(tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.05 * camShake)); }
    // overload shakes the booth a little
    if (ovlFx > 0.4 && labIdle) camera.position.add(tmp.set(Math.random() - 0.5, Math.random() - 0.5, 0).multiplyScalar(0.006 * ovlFx));
    if (flight.phase === 'release' && flight.t > 3.6) flight.camPos.copy(camera.position);
  }

  // ---------------- render ----------------
  lensPass.uniforms.uFade.value = Math.min(1, lensPass.uniforms.uFade.value + dt * 0.6);
  lensPass.uniforms.uGrain.value = death.phase === 'pov' ? 0.09 : 0.05;
  desk.update(dt, now);
  if (monitors) {
    painter.flush();
    fly.headBrainMat.uniforms.uTime.value = now;
    const G = (lbl, desc, key) => {
      const ro = readout[key];
      return { label: lbl, desc, value: Math.min(1, ro.rate / ro.max), text: `${ro.rate < 10 ? ro.rate.toFixed(1) : ro.rate.toFixed(0)} Hz` };
    };
    const gauges = [
      G('g_fear', 'g_fear_d', 'escape'),
      G('g_interest', 'g_interest_d', 'interest'),
      G('g_hearing', 'g_hearing_d', 'auditory'),
      G('g_vision', 'g_vision_d', 'vision'),
      G('g_groom', 'g_groom_d', 'groom'),
      { label: 'g_hunger', desc: 'g_hunger_d', value: exp.hunger, text: `${Math.round(exp.hunger * 100)}%` },
      G('g_proboscis', 'g_proboscis_d', 'proboscis'),
    ];
    const deadNow = death.phase === 'dead' || (death.phase === 'pov' && death.doneT >= 0);
    let banner = '';
    if (ovl.crit && labIdle) banner = t('ovl_title');
    else if (exp.coma > 0.5) banner = t('mon_coma');
    else if (deadNow) banner = t('mon_dead');
    monitors.update(dt, now, {
      power: powered ? clamp01((pt - 0.7) / 1.1) : 0,
      now, gauges,
      stress: { value: stress },
      load: { value: ovl.load },
      alert: Math.max(clamp01((stress - 0.6) * 2.5), ovl.crit ? 1 : 0, deadNow ? 1 : 0) * 0.6,
      glitch: labIdle ? clamp01((ovl.load - 0.9) * 2) : death.phase === 'pov' ? 0.3 * (1 - aliveFrac) : 0,
      raster: { now: stats.simMs, rows: RASTER.map((key) => ({ color: rowColors[key], times: readout[key].times })) },
      flat: deadNow,
      banner,
      aliveText: blockedCount ? `${fmt(neurons.n - blockedCount)} / ${fmt(neurons.n)}` : null,
      noSignal: deadNow || visAlive < 0.03 ? 1 : 0,
      laser: exp.laser ? 1 : 0,
      eye: { vr: exp.vr, rateL: r ? r.eyeL : 0, rateR: r ? r.eyeR : 0, loom: r ? r.loom : 0, burned: exp.burned },
    });
    monitors.render(renderer, scene, now, exp.vr ? vr.tex : null, { eyes: inLab && death.phase !== 'pov' });
  }
  renderer.shadowMap.needsUpdate = true;
  if (death.phase === 'pov' && pov) {
    const fadeIn = clamp01(death.t / 0.4);
    pov.render(renderer, scene, now, {
      alive: visAlive * fadeIn + (1 - fadeIn), seizure: death.cause === 'neo' || death.cause === 'overload' ? clamp01((ovl.load - 0.6) * 1.2) * aliveFrac : 0,
      fade: death.doneT >= 0 ? clamp01((death.t - death.doneT) / 1.6) : 0,
      flash: death.flash, red: clamp01((1 - aliveFrac) * 1.4), shake: death.cause === 'neo' || death.cause === 'overload' ? clamp01(ovl.load) * aliveFrac : 0,
    });
    renderPass.scene = pov.scene; renderPass.camera = pov.camera;
  } else { renderPass.scene = scene; renderPass.camera = camera; }
  composer.render(dt);

  // brain picture-in-picture (flight, death)
  if ((flight.phase === 'flying' || death.phase === 'pov') && monitors) {
    const rect = $('#pip').getBoundingClientRect();
    if (rect.width > 0) {
      const y = innerHeight - rect.bottom;
      renderer.setScissorTest(true);
      renderer.setScissor(rect.left, y, rect.width, rect.height);
      renderer.setViewport(rect.left, y, rect.width, rect.height);
      renderer.autoClear = false;
      renderer.render(pipScene, pipCam);
      renderer.autoClear = true;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, innerWidth, innerHeight);
    }
  }

  // ---------------- HUD (10 Hz) ----------------
  hud += dt;
  if (hud > 0.1) {
    hud = 0;
    $('#st-time').textContent = `${(stats.simMs / 1000).toFixed(2)} s`;
    const sEl = $('#st-speed');
    sEl.textContent = stats.speed >= 0.97 ? `×1.00` : `×${stats.speed.toFixed(2)}`;
    sEl.classList.toggle('slow', stats.speed < 0.97);
    $('#st-spikes').textContent = fmt(Math.round(stats.spikesPerS));
    $('#stress-fill').style.width = `${(stress * 100).toFixed(1)}%`;
    $('#stress-val').textContent = `${Math.round(stress * 100)}%`;
    $('.meter.stress').classList.toggle('hot', stress > 0.66);
    $('#load-fill').style.width = `${Math.min(100, ovl.load / 1.5 * 100).toFixed(1)}%`;
    $('#load-val').textContent = `${Math.round(ovl.load * 100)}%`;
    $('.meter.load').classList.toggle('hot', ovl.load > 1);
    $('.meter.load').classList.toggle('warm', ovl.load > 0.7);
    $('#rec-time').textContent = mmss((performance.now() - recStart) / 1000).slice(0, 5);
    if (desk.isOpen('inject') && death.phase === 'off' && now - (death.armedAt || 0) > 8) { desk.cover('inject', false); $('#armed').hidden = true; audio.coverFlip(); }
  }
  lastFrameAt = performance.now();
}
let lastFrameAt = 0;
let timeScale = 1;   // debug only (slow motion for inspecting effects)
function loop() { frame(); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
if (location.hash.includes('debug')) {
  window.S783 = {
    THREE, renderer, camera, camTarget, scene, fly, lab, desk, exp, ovl, death, toggle, readout, stats, setFocus, audio, vr, flight, explode,
    startDeath, schedule, cutPart, saw, get kind() { return kind; }, get blocked() { return blockedCount; }, get stress() { return stress; },
    get worker() { return worker; }, set timeScale(v) { timeScale = v; }, get intro() { return intro; }, set dbg(v) { dbg = v; }, get pov() { return pov; }, maskTex,
  };
  setInterval(() => { if (performance.now() - lastFrameAt > 60) frame(); }, 33);
}

decode($('#title'), t('title'), 1600);
boot().catch((err) => {
  console.error(err);
  bootlog.textContent += `\n[FAIL] ${err.message}`;
});
