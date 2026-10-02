"""Build the browser data pack from the FlyWire v783 connectome.

Inputs (see README, "Rebuilding the data"):
  raw/shiu/Completeness_783.csv, raw/shiu/Connectivity_783.parquet  (Shiu et al. 2024, MIT)
  raw/annotations.tsv  (Schlegel et al. 2024, flyconnectome/flywire_annotations)

Outputs in data/:
  neurons.bin.gz   positions (int16 x3) + display class (uint8) for all 138,639 neurons
  synapses.bin.gz.NNN  (slices of one gzip file) outgoing synapses of every neuron that can spike in the experiments
  brain.json       neuron groups, scenario results from the full offline model, pruning stats

Why pruning is safe: in this model a neuron affects the network only when it spikes.
We run every experiment on the full connectome offline, collect every neuron that spiked
or came within MARGIN_MV of threshold, and ship the outgoing synapses of exactly those
cells. Every neuron still exists in the browser and still receives input.
"""
import gzip
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from lif import PARAMS, Connectome, simulate

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
OUT = ROOT / "data"
PART_BYTES = 900_000
MARGIN_MV = 2.0
T_MS = 600.0

CLASSES = ["optic", "central", "mushroom", "sensory", "descending", "complex", "antennal", "motor"]


def display_class(row):
    cc, sc = row.cell_class, row.super_class
    if cc in ("Kenyon_Cell", "MBON", "DAN", "MBIN"):
        return 2
    if cc == "CX":
        return 5
    if cc in ("ALPN", "ALLN"):
        return 6
    if sc in ("optic", "visual_projection", "visual_centrifugal"):
        return 0
    if sc in ("sensory", "sensory_ascending"):
        return 3
    if sc == "motor" or cc == "brain_motor_neuron":
        return 7
    if sc in ("descending", "ascending", "endocrine"):
        return 4
    return 1


def main():
    t0 = time.time()
    comp = pd.read_csv(RAW / "shiu" / "Completeness_783.csv", index_col=0)
    ids = comp.index.to_numpy()
    n = len(ids)
    edges = pd.read_parquet(RAW / "shiu" / "Connectivity_783.parquet")
    pre = edges["Presynaptic_Index"].to_numpy()
    post = edges["Postsynaptic_Index"].to_numpy()
    wcount = edges["Excitatory x Connectivity"].to_numpy()
    con = Connectome.from_edges(n, pre, post, wcount)
    print(f"connectome: {n} neurons, {len(pre)} connections, {np.abs(wcount).sum()} synapses")

    ann = pd.read_csv(RAW / "annotations.tsv", sep="\t", low_memory=False)
    ann = ann.drop_duplicates("root_id").set_index("root_id").reindex(ids)
    ctype = ann.cell_type.astype(str)

    def idx(mask):
        return np.flatnonzero(np.asarray(mask)).astype(np.int64)

    photo = ctype.isin(["R1-6", "R7", "R8"])
    loom = ctype.isin(["LPLC2", "LC4"])
    dna02, dng02 = ctype == "DNa02", ctype.str.startswith("DNg02")
    stim = {
        "sugar": idx(ann.cell_sub_class == "sugar"),
        "bitter": idx(ann.cell_sub_class == "bitter"),
        "hearing": idx(ctype.str.match(r"^JO-[AB]")),        # sound: Johnston's organ A/B
        "wind": idx(ctype.str.match(r"^JO-[CE]")),           # antennal deflection: JO-C/E
        "tickle": idx(ctype.str.startswith("BM_")),          # head bristle mechanosensors
        "body": idx(ann.super_class == "ascending"),         # body signals from the nerve cord (shock)
        "loom": idx(loom),
        "loomL": idx(loom & (ann.side == "left")),
        "loomR": idx(loom & (ann.side == "right")),
        "eyeL": idx(photo & (ann.side == "left")),
        "eyeR": idx(photo & (ann.side == "right")),
        "odor": idx(ctype.isin(["ORN_DM1", "ORN_DM2", "ORN_DM4", "ORN_VA2"])),
        # flight: steering (DNa02) and wing-power (DNg02) descending neurons, giant fiber
        "dna02L": idx(dna02 & (ann.side == "left")),
        "dna02R": idx(dna02 & (ann.side == "right")),
        "dng02L": idx(dng02 & (ann.side == "left")),
        "dng02R": idx(dng02 & (ann.side == "right")),
        "gf": idx(ctype == "DNp01"),
    }

    # hearing readout: central neurons receiving the most JO-A/B synapses
    jo_mask = np.zeros(n, bool)
    jo_mask[stim["hearing"]] = True
    sel = jo_mask[pre] & (wcount > 0)
    tgt = pd.Series(np.abs(wcount[sel]), index=post[sel]).groupby(level=0).sum()
    sensory = ann.super_class.isin(["sensory", "sensory_ascending"]).to_numpy()
    tgt = tgt[~sensory[tgt.index]].nlargest(60)

    cls = np.array([display_class(r) for r in ann.itertuples()], dtype=np.uint8)
    readout = {
        "proboscis": idx(ctype == "CB0701"),            # MN9, proboscis motor neuron
        "escape": idx(ctype.isin(["DNp01", "DNp02", "DNp04", "DNp11"])),  # giant fiber + escape DNs
        "auditory": np.sort(tgt.index.to_numpy()).astype(np.int64),
        "interest": idx(ann.cell_class.isin(["ALPN", "Kenyon_Cell", "MBON"])),
        "vision": None,  # data-driven, below: cells that respond to light in the full model
        "taste": idx(ann.cell_class == "gustatory"),
        "groom": None,   # data-driven: descending neurons driven by wind + tickle
        "alarm": None,   # data-driven: descending neurons driven by the body (shock) signal
        "ppl1": idx(ctype.str.startswith("PPL1")),      # dopamine "punishment" neurons
        "dna02L": stim["dna02L"], "dna02R": stim["dna02R"],
        "dng02L": stim["dng02L"], "dng02R": stim["dng02R"],
        "gfL": idx((ctype == "DNp01") & (ann.side == "left")),
        "gfR": idx((ctype == "DNp01") & (ann.side == "right")),
    }
    for k, v in {**stim, **readout}.items():
        print(f"  group {k:10s} {0 if v is None else len(v)}")

    eyes = np.concatenate([stim["eyeL"], stim["eyeR"]])
    flight = [(stim[k], 150.0) for k in ("dna02L", "dna02R", "dng02L", "dng02R", "gf")]
    calm = [(stim["sugar"], 150.0), (stim["bitter"], 150.0), (stim["hearing"], 150.0), (stim["loom"], 150.0),
            (eyes, 40.0), (stim["wind"], 100.0), (stim["tickle"], 40.0), (stim["body"], 40.0)] + flight
    scenarios = {
        "light": [(eyes, 40.0)],
        "sugar": [(stim["sugar"], 200.0)],
        "bitter": [(stim["bitter"], 200.0)],
        "sugar+bitter": [(stim["sugar"], 200.0), (stim["bitter"], 200.0)],
        "music": [(stim["hearing"], 150.0)],
        "wind": [(stim["wind"], 100.0)],
        "tickle": [(stim["tickle"], 40.0)],
        "shock": [(stim["body"], 40.0)],
        "loom": [(stim["loom"], 150.0)],
        "loomL": [(stim["loomL"], 150.0)],
        "loomR": [(stim["loomR"], 150.0)],
        "flight": flight,
        "odor": [(stim["odor"], 150.0)],
        # torture experiments (only for pruning and the monitor's scales)
        "strobe": [(eyes, 150.0)],                              # xenon flash: every photoreceptor at once
        "laserL": [(stim["eyeL"], 120.0)],                      # green laser into the left eye
        "spin": [(stim["wind"], 120.0), (eyes, 25.0)],          # centrifuge: antennae deflected + optic flow
        "all_but_odor": calm,
        "everything": calm + [(stim["odor"], 150.0)],
    }

    u_th = PARAMS["v_th"] - PARAMS["v_0"]
    keep = np.zeros(n, bool)
    for g in stim.values():
        keep[g] = True
    counts_by, stimulated_by, nspk_by = {}, {}, {}
    for name, groups in scenarios.items():
        max_u = np.full(n, -np.inf)
        ts = time.time()
        nn, _ = simulate(con, groups, t_ms=T_MS, seed=1, max_u=max_u)
        counts_by[name] = np.bincount(nn, minlength=n)
        stimulated_by[name] = np.concatenate([g for g, _ in groups])
        nspk_by[name] = len(nn)
        keep |= (counts_by[name] > 0) | (max_u > (u_th - MARGIN_MV))
        print(f"{name:13s} {len(nn)} spikes ({time.time() - ts:.0f}s)", flush=True)

    is_dn = (ann.super_class == "descending").to_numpy()

    def top_dns(names, k):
        c = sum(counts_by[nm] for nm in names).astype(float)
        stimmed = np.zeros(n, bool)
        for nm in names:
            stimmed[stimulated_by[nm]] = True
        cand = np.flatnonzero(is_dn & ~stimmed & (c > 0))
        return np.sort(cand[np.argsort(-c[cand])][:k]).astype(np.int64)

    readout["vision"] = np.flatnonzero((counts_by["light"] > 0) & ~photo.to_numpy()).astype(np.int64)
    readout["groom"] = np.union1d(top_dns(["wind"], 8), top_dns(["tickle"], 8))
    readout["alarm"] = top_dns(["shock"], 12)
    print("groom DNs", sorted(set(ctype.iloc[readout["groom"]])), "alarm DNs", sorted(set(ctype.iloc[readout["alarm"]])))

    results = {}
    for name in scenarios:
        c = counts_by[name]
        nonstim = c > 0
        nonstim[stimulated_by[name]] = False
        results[name] = {
            "spiking_neurons": int(nonstim.sum()),
            "spikes_per_s": int(nspk_by[name] / (T_MS / 1000)),
            "readout_hz": {k: round(float(c[v].mean() / (T_MS / 1000)), 1) for k, v in readout.items()},
        }
        print(f"{name:13s} {results[name]}", flush=True)

    # odor ignites a self-sustaining loop (antennal lobe + mushroom body): measure what
    # keeps firing after a 50 ms puff has ended
    odor_puff = lambda st: [(stim["odor"], 150.0 if st < 500 else 0.0)]
    nn, tt = simulate(con, [(stim["odor"], 0.0)], t_ms=250.0, seed=1, rate_fn=odor_puff)
    late = nn[tt >= 1500]
    persist = {
        "puff_ms": 50, "window_ms": "150-250",
        "spikes_per_s_after_puff": int(len(late) / 0.1),
        "cells_still_firing": int(len(np.unique(late))),
        "by_class": ann.iloc[np.unique(late)].cell_class.value_counts().head(6).to_dict(),
    }
    print("odor persistence", persist, flush=True)

    # ---- export ----
    OUT.mkdir(exist_ok=True)
    pres = np.flatnonzero(keep)
    lens = (con.indptr[pres + 1] - con.indptr[pres]).astype(np.int64)
    rowptr = np.concatenate([[0], np.cumsum(lens)]).astype(np.uint32)
    offs = np.concatenate([np.arange(con.indptr[p], con.indptr[p + 1]) for p in pres])
    post_k = con.post[offs].astype(np.int64)
    w_k = np.round(con.w[offs] / PARAMS["w_syn"]).astype(np.int16)
    # delta-encode postsynaptic indices within each row (rows are sorted) for better gzip
    delta = post_k.copy()
    row_first = rowptr[:-1][lens > 0].astype(np.int64)
    delta[1:] -= post_k[:-1]
    delta[row_first] = post_k[row_first]
    assert (delta >= 0).all()
    header = np.array([0x53554A42, n, len(pres), len(post_k)], dtype=np.uint32)
    blob = b"".join([header.tobytes(), pres.astype(np.uint32).tobytes(), rowptr.tobytes(),
                     delta.astype(np.uint32).tobytes(), w_k.tobytes()])
    # written in ~0.9 MB slices of one gzip stream: the site concatenates them, and each slice
    # stays small enough to push over a slow connection (GitHub drops long uploads)
    for old in OUT.glob("synapses.bin.gz*"):
        old.unlink()
    gz = gzip.compress(blob, 9)
    parts = []
    for k in range(0, len(gz), PART_BYTES):
        name = f"synapses.bin.gz.{k // PART_BYTES:03d}"
        (OUT / name).write_bytes(gz[k:k + PART_BYTES])
        parts.append(name)

    pos = ann[["pos_x", "pos_y", "pos_z"]].to_numpy(dtype=np.float64)
    pos *= np.array([0.004, 0.004, 0.040])  # FlyWire voxels (4x4x40 nm) -> micrometres
    missing = np.isnan(pos).any(1)
    center = np.nanmedian(pos, 0)
    pos[missing] = center
    pos -= (np.nanmin(pos, 0) + np.nanmax(pos, 0)) / 2
    scale = float(np.abs(pos).max())
    q = np.round(pos / scale * 32767).astype(np.int16)
    q[:, 1] *= -1  # FlyWire y points ventral; flip so dorsal is up
    (OUT / "neurons.bin.gz").write_bytes(gzip.compress(q.tobytes() + cls.tobytes(), 9))

    kept_syn = int(np.abs(w_k).sum())
    meta = {
        "dataset": "FlyWire FAFB v783",
        "neurons": n,
        "connections": int(len(pre)),
        "synapses": int(np.abs(wcount).sum()),
        "params": PARAMS,
        "classes": CLASSES,
        "class_counts": np.bincount(cls, minlength=len(CLASSES)).tolist(),
        "scale_um": scale,
        "stim": {k: v.tolist() for k, v in stim.items()},
        "readout": {k: v.tolist() for k, v in readout.items()},
        "scenarios": results,
        "odor_persistence": persist,
        "scenario_ms": T_MS,
        "synapse_parts": parts,
        "pruning": {
            "presynaptic_kept": int(len(pres)),
            "connections_kept": int(len(post_k)),
            "synapses_kept": kept_syn,
            "margin_mv": MARGIN_MV,
        },
    }
    (OUT / "brain.json").write_text(json.dumps(meta, separators=(",", ":")))
    sizes = {p.name: p.stat().st_size for p in OUT.iterdir()}
    print(json.dumps(meta["pruning"]), sizes, f"total {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
