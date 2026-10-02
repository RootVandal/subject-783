"""Whole-brain leaky integrate-and-fire model of Drosophila (numpy port).

Re-implements the model of Shiu et al. 2024 (Nature, "A Drosophila computational
brain model reveals sensorimotor processing"; github.com/philshiu/Drosophila_brain_model,
MIT) without Brian2, so the exact same update rule can be mirrored in the browser
worker (web/js/sim/worker.js).

    dv/dt = (v_0 - v + g) / t_mbr      (frozen while refractory)
    dg/dt = -g / tau                   (cleared while refractory, as Brian2 does)
    spike:  v > v_th  ->  v = v_rst, g = 0, refractory for t_rfc
    synapse: g_post += w_syn * signed_synapse_count, after t_dly
    stimulus: Poisson input adding f_poi * w_syn to v (stimulated cells have no refractory period)

The linear system is integrated exactly between steps (Brian2's method='linear').
"""
from dataclasses import dataclass

import numpy as np

PARAMS = dict(
    dt=0.1,       # ms
    v_0=-52.0,    # mV
    v_rst=-52.0,
    v_th=-45.0,
    t_mbr=20.0,   # ms
    tau=5.0,      # ms
    t_rfc=2.2,    # ms
    t_dly=1.8,    # ms
    w_syn=0.275,  # mV per synapse
    f_poi=250.0,
)


def step_constants(p=PARAMS):
    """Exact propagator for (u = v - v_0, g) over one dt."""
    dt, tm, tau = p["dt"], p["t_mbr"], p["tau"]
    a = np.exp(-dt / tm)
    b = np.exp(-dt / tau)
    # u(dt) = u0*a + g0 * tau/(tm - tau) * (a - b)
    k = tau / (tm - tau) * (a - b)
    return a, b, k


@dataclass
class Connectome:
    n: int
    indptr: np.ndarray   # CSR by presynaptic neuron, len n+1
    post: np.ndarray     # int32 postsynaptic index
    w: np.ndarray        # float32 weight in mV (signed)

    @classmethod
    def from_edges(cls, n, pre, post, signed_count, w_syn=PARAMS["w_syn"]):
        order = np.lexsort((post, pre))
        pre, post, signed_count = pre[order], post[order], signed_count[order]
        indptr = np.zeros(n + 1, dtype=np.int64)
        np.add.at(indptr, pre + 1, 1)
        np.cumsum(indptr, out=indptr)
        return cls(n, indptr, post.astype(np.int32), (signed_count * w_syn).astype(np.float32))


def simulate(con, stim, t_ms=1000.0, seed=0, p=PARAMS, rate_fn=None, max_u=None):
    """Run one trial.

    stim: dict {neuron_index_array_name: (indices, rate_hz)} or list of (indices, rate_hz).
    rate_fn: optional callable(step) -> list of (indices, rate_hz), overrides stim per step.
    max_u: optional float array, updated in place with each neuron's peak (v - v_0).
    Returns (spike_neuron, spike_step) int arrays.
    """
    rng = np.random.default_rng(seed)
    n, dt = con.n, p["dt"]
    a, b, k = step_constants(p)
    steps = int(round(t_ms / dt))
    dly = int(round(p["t_dly"] / dt))
    rfc_steps = np.full(n, int(round(p["t_rfc"] / dt)), dtype=np.int64)

    groups = list(stim.values()) if isinstance(stim, dict) else list(stim)
    for idx, _ in groups:
        rfc_steps[idx] = 0  # Poisson targets: no refractory period (as in the reference)
    kick = p["f_poi"] * p["w_syn"]

    u = np.zeros(n, dtype=np.float64)       # v - v_0
    g = np.zeros(n, dtype=np.float64)
    ref_until = np.full(n, -1, dtype=np.int64)  # refractory while step < ref_until
    u_th = p["v_th"] - p["v_0"]
    u_rst = p["v_rst"] - p["v_0"]

    ring = [np.empty(0, dtype=np.int64) for _ in range(dly)]
    out_n, out_t = [], []
    indptr, post, w = con.indptr, con.post, con.w

    for s in range(steps):
        active = s >= ref_until
        # 1) state update (exact), only for non-refractory cells
        # Brian2 behaviour (verified spike-for-spike): synaptic input that arrives
        # while a cell is refractory is discarded, so g is cleared during refractoriness.
        un = u * a + g * k
        gn = g * b
        u = np.where(active, un, u)
        g = np.where(active, gn, 0.0)
        # 2) threshold
        spk = np.flatnonzero(active & (u > u_th))
        # 3) deliver spikes emitted dly steps ago
        src = ring[s % dly]
        if src.size:
            starts, ends = indptr[src], indptr[src + 1]
            lens = ends - starts
            tot = int(lens.sum())
            if tot:
                offs = np.repeat(starts - np.cumsum(lens) + lens, lens) + np.arange(tot)
                g += np.bincount(post[offs], weights=w[offs], minlength=n)
        # 4) Poisson stimulus
        if rate_fn is not None:
            groups = rate_fn(s)
        for idx, rate in groups:
            if rate <= 0:
                continue
            hit = idx[rng.random(idx.size) < rate * dt * 1e-3]
            u[hit] += kick
        if max_u is not None:
            np.maximum(max_u, u, out=max_u)
        # 5) reset
        u[spk] = u_rst
        g[spk] = 0.0
        ref_until[spk] = s + 1 + rfc_steps[spk]  # Brian2 resumes integration one step later
        ring[s % dly] = spk
        if spk.size:
            out_n.append(spk)
            out_t.append(np.full(spk.size, s, dtype=np.int32))

    if not out_n:
        return np.empty(0, np.int64), np.empty(0, np.int32)
    return np.concatenate(out_n), np.concatenate(out_t)
