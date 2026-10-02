// Whole-brain LIF simulation of Drosophila, running in a Web Worker.
//
// Model: Shiu et al. 2024 (Nature), identical update rule to pipeline/lif.py, which
// reproduces the Brian2 reference spike-for-spike.
//
// Engine: exact event-driven. Between inputs a cell obeys a linear ODE with a closed-form
// solution, so instead of integrating every neuron every 0.1 ms we
//   - bring a cell's state up to date only when a spike or stimulus reaches it, and
//   - solve analytically for the first future timestep at which it crosses threshold,
//     scheduling that spike on a timing wheel (re-solved whenever new input arrives).
// Cost scales with synaptic events instead of neurons x timesteps. A dense reference
// stepper (mode 'dense') is kept so the two can be compared spike-for-spike (tools/bench.html).
//
// Interventions that are not part of the Shiu model (off by default, so the model itself is
// untouched): a neuron can be *blocked* from a given step on (toxin, light damage); it is then
// held refractory forever. And excitatory synapses can be scaled (a cholinergic agonist).
'use strict';

const P = {
  dt: 0.1, v0: -52, vrst: -52, vth: -45, tmbr: 20, tau: 5,
  trfc: 2.2, tdly: 1.8, wsyn: 0.275, fpoi: 250,
};
const A = Math.exp(-P.dt / P.tmbr);
const B = Math.exp(-P.dt / P.tau);
const TK = P.tau / (P.tmbr - P.tau);
const LNA = Math.log(A), LNB = Math.log(B), LNAB = Math.log(A / B);
const UTH = P.vth - P.v0;
const KICK = P.fpoi * P.wsyn;
const DLY = Math.round(P.tdly / P.dt);
const RFC = Math.round(P.trfc / P.dt);

// propagator tables: u(n) = u0*A^n + g0*K[n],  g(n) = g0*B^n
const H = 1 << 15;
const PA = new Float64Array(H), PB = new Float64Array(H), PK = new Float64Array(H);
let KMAX = 0;
for (let n = 0; n < H; n++) {
  PA[n] = Math.pow(A, n); PB[n] = Math.pow(B, n); PK[n] = TK * (PA[n] - PB[n]);
  if (PK[n] > KMAX) KMAX = PK[n];
}
const W = 4096, WMASK = W - 1;   // timing wheel (crossings are always < ~300 steps ahead)

let mode = 'event';
let N = 0;
let rowOf, rowPtr, post, wgt;
let u, g, tLast, refUntil, pend, lastSpike, rfc, dirty, dirtyList, dirtyLen = 0;
let wheel, wheelLen;
let ring, ringLen;
let groups = {};
let step = 0;
let outSpikes = new Int32Array(1 << 16), outLen = 0;
let events = 0;
let running = false;
let speedCap = 1.0;
let lastPost = 0, wallAcc = 0, simAcc = 0, eventAcc = 0;
let lastTick = 0;
const NEVER = 0x7fffffff;
let excGain = 1;
let qStep = new Int32Array(0), qIdx = new Int32Array(0), qPos = 0;   // pending blocks, sorted by step

// xorshift128 -> [0,1)
let s0, s1, s2, s3;
function seed(x) { s0 = 0x9E3779B9 ^ x; s1 = 0x243F6A88; s2 = 0xB7E15162 ^ (x * 31); s3 = 0x6A09E667; for (let i = 0; i < 20; i++) rnd(); }
function rnd() {
  let t = s3;
  const s = s0;
  s3 = s2; s2 = s1; s1 = s;
  t ^= t << 11; t ^= t >>> 8;
  s0 = t ^ s ^ (s >>> 19);
  return (s0 >>> 0) / 4294967296;
}
seed(1);

// the file may come in parts (byte slices of one gzip stream, kept small for slow uploads)
async function fetchBytes(urls, stage) {
  const responses = await Promise.all(urls.map(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res;
  }));
  const total = responses.reduce((a, r) => a + (+r.headers.get('content-length') || 0), 0);
  const chunks = [];
  let got = 0;
  for (const res of responses) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      postMessage({ type: 'progress', stage, got, total });
    }
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  if (buf[0] === 0x1f && buf[1] === 0x8b) {   // server may already have removed the gzip layer
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(ds).arrayBuffer());
  }
  return buf;
}

async function load(msg) {
  if (msg.mode) mode = msg.mode;
  const bytes = await fetchBytes(msg.synapsesUrls || [msg.synapsesUrl], 'synapses');
  const hdr = new Uint32Array(bytes.buffer, 0, 4);
  if (hdr[0] !== 0x53554A42) throw new Error('bad synapse file');
  N = hdr[1];
  const nPre = hdr[2], nE = hdr[3];
  let off = 16;
  const pre = new Uint32Array(bytes.buffer, off, nPre); off += 4 * nPre;
  rowPtr = new Uint32Array(bytes.buffer, off, nPre + 1); off += 4 * (nPre + 1);
  post = new Uint32Array(bytes.buffer, off, nE); off += 4 * nE;
  const cnt = new Int16Array(bytes.buffer, off, nE);
  for (let r = 0; r < nPre; r++) {           // undo delta coding within rows
    let acc = 0;
    for (let e = rowPtr[r]; e < rowPtr[r + 1]; e++) { acc += post[e]; post[e] = acc; }
  }
  wgt = new Float64Array(nE);
  for (let e = 0; e < nE; e++) wgt[e] = cnt[e] * P.wsyn;
  rowOf = new Int32Array(N).fill(-1);
  for (let r = 0; r < nPre; r++) rowOf[pre[r]] = r;

  u = new Float64Array(N); g = new Float64Array(N);
  tLast = new Int32Array(N); refUntil = new Int32Array(N);
  pend = new Int32Array(N).fill(-1); lastSpike = new Int32Array(N).fill(-1);
  rfc = new Int32Array(N).fill(RFC);
  dirty = new Uint8Array(N); dirtyList = new Int32Array(N);
  wheel = Array.from({ length: W }, () => new Int32Array(8)); wheelLen = new Int32Array(W);
  ring = Array.from({ length: DLY }, () => new Int32Array(1024)); ringLen = new Int32Array(DLY);
  for (const [name, idx] of Object.entries(msg.stim)) {
    const a = Int32Array.from(idx);
    for (const i of a) rfc[i] = 0;           // Poisson targets have no refractory period
    groups[name] = { idx: a, rate: 0 };
  }
  postMessage({ type: 'ready', n: N, presynaptic: nPre, connections: nE, mode });
}

// ---------------- event-driven core ----------------
// state of cell i is stored "as after the update of step tLast[i]"
function catchUp(i, s) {
  let t0 = tLast[i];
  const frozenTo = refUntil[i] - 1;           // refractory: state held at reset until here
  if (t0 < frozenTo) { u[i] = 0; g[i] = 0; t0 = frozenTo; }
  const n = s - t0;
  if (n > 0) {
    if (n >= H) { u[i] = 0; g[i] = 0; }
    else {
      const ui = u[i], gi = g[i];
      u[i] = ui * PA[n] + gi * PK[n];
      g[i] = gi * PB[n];
    }
  }
  tLast[i] = s;
}

function markDirty(i) {
  if (!dirty[i]) { dirty[i] = 1; dirtyList[dirtyLen++] = i; }
}

function wheelPush(t, i) {
  const b = t & WMASK;
  let arr = wheel[b];
  if (wheelLen[b] >= arr.length) { const nb = new Int32Array(arr.length * 2); nb.set(arr); wheel[b] = arr = nb; }
  arr[wheelLen[b]++] = i;
}

// first m >= 1 with u(m) > UTH, or 0 if the cell will not fire without further input
function crossing(u0, g0) {
  if (g0 <= 0) return (u0 * A + g0 * PK[1] > UTH) ? 1 : 0;
  if ((u0 > 0 ? u0 : 0) + g0 * KMAX <= UTH) return 0;   // cheap bound: cannot reach threshold
  if (u0 * A + g0 * PK[1] > UTH) return 1;
  const c = g0 * TK;
  if (u0 + c <= 0) return 0;
  const nStar = Math.log((c * LNB) / ((u0 + c) * LNA)) / LNAB;   // continuous peak of u(n)
  if (!(nStar > 1)) return 0;
  let hi = Math.ceil(nStar);
  if (hi >= W - 1) return 0;
  const lo0 = hi - 1;
  const uHi = u0 * PA[hi] + g0 * PK[hi], uLo = u0 * PA[lo0] + g0 * PK[lo0];
  if (uHi <= UTH && uLo <= UTH) return 0;
  if (uLo > UTH) hi = lo0;
  let lo = 1;                                  // u(lo) <= UTH < u(hi), u increasing on [1, hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (u0 * PA[mid] + g0 * PK[mid] > UTH) hi = mid; else lo = mid;
  }
  return hi;
}

function applyBlocks(s) {
  while (qPos < qStep.length && qStep[qPos] <= s) {
    const i = qIdx[qPos++];
    if (i >= 0) {
      refUntil[i] = NEVER;                       // permanently refractory: no input, no spikes
      pend[i] = -1; u[i] = 0; g[i] = 0;
    } else {                                     // ~i: recovers (from rest) at this step
      const j = ~i;
      if (refUntil[j] === NEVER) { refUntil[j] = s; tLast[j] = s; u[j] = 0; g[j] = 0; }
    }
  }
}

function eventStep() {
  const s = step;
  const slot = s % DLY;
  if (qPos < qStep.length) applyBlocks(s);
  // 1) threshold: cells scheduled to cross at this step
  const b = s & WMASK;
  const bucket = wheel[b], bl = wheelLen[b];
  let nsp = 0;
  const ringBuf = ensureRing(slot, bl);
  for (let k = 0; k < bl; k++) {
    const i = bucket[k];
    if (pend[i] !== s) continue;               // stale entry (re-scheduled or cancelled)
    pend[i] = -1;
    u[i] = 0; g[i] = 0; tLast[i] = s;
    refUntil[i] = s + 1 + rfc[i];
    lastSpike[i] = s;
    ring[slot][nsp++] = i;
  }
  wheelLen[b] = 0;
  // 2) deliver spikes emitted DLY steps ago (slot still holds them until we overwrite below)
  const src = ringPrev[slot], n = ringPrevLen[slot];
  for (let k = 0; k < n; k++) {
    const r = rowOf[src[k]];
    if (r < 0) continue;
    if (excGain === 1) {
      for (let e = rowPtr[r], end = rowPtr[r + 1]; e < end; e++) {
        const p = post[e];
        if (s < refUntil[p] - 1 || lastSpike[p] === s) continue;   // lost: refractory or resetting now
        catchUp(p, s);
        g[p] += wgt[e];
        markDirty(p);
      }
    } else {
      const eg = excGain;
      for (let e = rowPtr[r], end = rowPtr[r + 1]; e < end; e++) {
        const p = post[e];
        if (s < refUntil[p] - 1 || lastSpike[p] === s) continue;
        catchUp(p, s);
        const w = wgt[e];
        g[p] += w > 0 ? w * eg : w;
        markDirty(p);
      }
    }
    events += rowPtr[r + 1] - rowPtr[r];
  }
  // 3) Poisson stimulus, geometric skipping
  poisson(s, true);
  // 4) re-solve threshold crossings for every cell that received input
  for (let k = 0; k < dirtyLen; k++) {
    const i = dirtyList[k];
    dirty[i] = 0;
    const m = crossing(u[i], g[i]);
    const t = m ? s + m : -1;
    if (t !== pend[i]) { pend[i] = t; if (t >= 0) wheelPush(t, i); }
  }
  dirtyLen = 0;
  finishStep(slot, nsp);
}

// ---------------- dense reference stepper ----------------
function denseStep() {
  const s = step;
  const slot = s % DLY;
  let nsp = 0;
  if (qPos < qStep.length) applyBlocks(s);
  ensureRing(slot, N);
  for (let i = 0; i < N; i++) {
    if (s >= refUntil[i]) {
      const ui = u[i] * A + g[i] * PK[1];
      g[i] = g[i] * B; u[i] = ui;
      if (ui > UTH) ring[slot][nsp++] = i;
    } else g[i] = 0;
  }
  const src = ringPrev[slot], n = ringPrevLen[slot];
  for (let k = 0; k < n; k++) {
    const r = rowOf[src[k]];
    if (r < 0) continue;
    const eg = excGain;
    for (let e = rowPtr[r], end = rowPtr[r + 1]; e < end; e++) { const w = wgt[e]; g[post[e]] += w > 0 ? w * eg : w; }
    events += rowPtr[r + 1] - rowPtr[r];
  }
  poisson(s, false);
  for (let k = 0; k < nsp; k++) {
    const i = ring[slot][k];
    u[i] = 0; g[i] = 0; refUntil[i] = s + 1 + rfc[i];
  }
  finishStep(slot, nsp);
}

function poisson(s, ev) {
  for (const name in groups) {
    const gr = groups[name];
    if (gr.rate <= 0) continue;
    const p = gr.rate * P.dt * 1e-3;
    if (!(p > 1e-12)) continue;
    const idx = gr.idx, m = idx.length;
    // log1p keeps tiny rates exact; with log(1 - p) a rate of ~1e-15 Hz rounds to 0 and the
    // geometric skip below divides by zero and never terminates (this froze the simulation)
    const lq = Math.log1p(-Math.min(p, 0.999999));
    if (!(lq < 0)) continue;
    let k = p >= 1 ? 0 : Math.floor(Math.log(1 - rnd()) / lq);
    while (k < m) {
      const i = idx[k];
      if (ev) {
        if (!(s < refUntil[i] - 1 || lastSpike[i] === s)) { catchUp(i, s); u[i] += KICK; markDirty(i); }
      } else u[i] += KICK;
      k += p >= 1 ? 1 : 1 + Math.floor(Math.log(1 - rnd()) / lq);
    }
  }
}

// ring slots: spikes written at step s are delivered at step s + DLY. We read last round's
// content of a slot before overwriting it, so keep a second set of buffers and swap.
let ringPrev, ringPrevLen;
function ensureRing(slot, need) {
  if (ring[slot].length < need) ring[slot] = new Int32Array(Math.max(need, ring[slot].length * 2));
  return ring[slot];
}
function finishStep(slot, nsp) {
  // swap: this step's spikes become the "previous" content of the slot
  const tmp = ringPrev[slot];
  ringPrev[slot] = ring[slot]; ringPrevLen[slot] = nsp;
  ring[slot] = tmp;
  if (outLen + nsp > outSpikes.length) {
    const nb = new Int32Array(Math.max(outSpikes.length * 2, outLen + nsp)); nb.set(outSpikes.subarray(0, outLen)); outSpikes = nb;
  }
  outSpikes.set(ringPrev[slot].subarray(0, nsp), outLen);
  outLen += nsp;
  step++;
}

function initRings() {
  ring = Array.from({ length: DLY }, () => new Int32Array(1024));
  ringPrev = Array.from({ length: DLY }, () => new Int32Array(1024));
  ringPrevLen = new Int32Array(DLY);
}

function reset() {
  u.fill(0); g.fill(0); tLast.fill(0); refUntil.fill(0); pend.fill(-1); lastSpike.fill(-1);
  wheelLen.fill(0); dirtyLen = 0; dirty.fill(0);
  initRings();
  step = 0; outLen = 0; events = 0;
  excGain = 1; qStep = new Int32Array(0); qIdx = new Int32Array(0); qPos = 0;
}

// schedule blocks: neuron idx[k] stops firing delayMs[k] (or delayMs) from now;
// with release = true it recovers instead
function scheduleBlocks(idx, delayMs, release = false) {
  const n0 = qStep.length - qPos, n1 = idx.length;
  const order = new Int32Array(n0 + n1);
  const st = new Int32Array(n0 + n1), ix = new Int32Array(n0 + n1);
  for (let k = 0; k < n0; k++) { st[k] = qStep[qPos + k]; ix[k] = qIdx[qPos + k]; }
  for (let k = 0; k < n1; k++) {
    const d = typeof delayMs === 'number' ? delayMs : delayMs[k];
    st[n0 + k] = step + Math.max(0, Math.round(d / P.dt));
    ix[n0 + k] = release ? ~idx[k] : idx[k];
  }
  for (let k = 0; k < order.length; k++) order[k] = k;
  order.sort((a, b) => st[a] - st[b]);
  qStep = new Int32Array(order.length); qIdx = new Int32Array(order.length); qPos = 0;
  for (let k = 0; k < order.length; k++) { qStep[k] = st[order[k]]; qIdx[k] = ix[order[k]]; }
  return step * P.dt;
}

const simStep = () => (mode === 'event' ? eventStep() : denseStep());

const BUDGET_MS = 14;
function tick() {
  if (!running) return;
  const t0 = performance.now();
  const wall = lastTick ? Math.min(t0 - lastTick, 100) : 16;
  lastTick = t0;
  const want = Math.max(1, Math.round(wall * speedCap / P.dt));
  let did = 0;
  while (did < want) {
    simStep();
    did++;
    if ((did & 7) === 0 && performance.now() - t0 > BUDGET_MS) break;
  }
  wallAcc += wall;
  simAcc += did * P.dt;
  if (t0 - lastPost > 33) {
    const out = outSpikes.slice(0, outLen);
    postMessage({
      type: 'spikes', spikes: out, simMs: step * P.dt, dSimMs: simAcc,
      speed: wallAcc > 0 ? simAcc / wallAcc : 0, events: events - eventAcc,
    }, [out.buffer]);
    eventAcc = events;
    outLen = 0; wallAcc = 0; simAcc = 0; lastPost = t0;
  }
  // run again immediately while behind real time (MessageChannel is not throttled like timers);
  // when ahead, yield a few ms so an idle brain does not spin a core
  if (simAcc >= wallAcc * speedCap * 0.98 && wallAcc > 0) setTimeout(tick, 4); else kick.postMessage(0);
}
const chan = new MessageChannel();
chan.port1.onmessage = () => tick();
const kick = chan.port2;

onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'load') { await load(m); initRings(); }
    else if (m.type === 'start') { if (!running) { running = true; lastTick = 0; tick(); } }
    else if (m.type === 'stop') running = false;
    else if (m.type === 'rates') {
      for (const [k, v] of Object.entries(m.rates)) if (groups[k]) groups[k].rate = Number.isFinite(v) && v > 0.01 ? v : 0;
      if (m.exc != null) excGain = Number.isFinite(m.exc) && m.exc > 0 ? m.exc : 1;
    } else if (m.type === 'group') {          // an extra Poisson group over existing receptor cells
      groups[m.name] = { idx: Int32Array.from(m.idx), rate: 0 };
    } else if (m.type === 'block') {
      const baseMs = scheduleBlocks(m.idx, m.delayMs, !!m.release);
      postMessage({ type: 'blocked', id: m.id, baseMs });
    } else if (m.type === 'reset') { reset(); if (m.seed != null) seed(m.seed); }
    else if (m.type === 'speed') speedCap = m.value;
    else if (m.type === 'bench') {
      for (const [k, v] of Object.entries(m.rates || {})) if (groups[k]) groups[k].rate = v;
      const counts = m.counts ? new Uint16Array(N) : null;
      const t0 = performance.now();
      const steps = Math.round(m.ms / P.dt);
      let spikes = 0;
      const ev0 = events;
      for (let i = 0; i < steps; i++) {
        simStep();
        if (counts) for (let k = 0; k < outLen; k++) counts[outSpikes[k]]++;
        spikes += outLen; outLen = 0;
      }
      postMessage({ type: 'bench', ms: m.ms, wallMs: performance.now() - t0, spikes, events: events - ev0, counts }, counts ? [counts.buffer] : []);
    }
  } catch (err) {
    postMessage({ type: 'error', message: String(err && err.stack || err) });
  }
};
