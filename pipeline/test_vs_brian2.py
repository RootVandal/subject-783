"""Deterministic spike-for-spike check of lif.py against the original Brian2 model.

Both models get the same whole-brain connectome (v630, as shipped with the reference)
and the same deterministic drive: the 21 right sugar GRNs are kicked every 5 ms.
No randomness is involved, so every (neuron, timestep) spike must match exactly.

Requires: pip install brian2   (uses raw/shiu/model.py for the reference network)
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SHIU = ROOT / "raw" / "shiu"
sys.path.insert(0, str(SHIU))

from brian2 import Network, Synapses, SpikeGeneratorGroup, ms, mV, prefs  # noqa: E402
from model import create_model, default_params as P  # noqa: E402

from lif import Connectome, simulate  # noqa: E402
from validate import SUGAR_R  # noqa: E402

T_MS = 200
COMP = SHIU / "2023_03_23_completeness_630_final.csv"
CONN = SHIU / "2023_03_23_connectivity_630_final.parquet"


def main():
    prefs.codegen.target = "numpy"
    comp = pd.read_csv(COMP, index_col=0)
    id2i = {f: i for i, f in enumerate(comp.index)}
    exc = np.array([id2i[f] for f in SUGAR_R])

    neu, syn, spk = create_model(COMP, CONN, P)
    neu.rfc[exc] = 0 * ms
    times = np.arange(0, T_MS, 5.0)
    gen = SpikeGeneratorGroup(1, np.zeros(len(times), int), times * ms)
    kick = Synapses(gen, neu, on_pre="v += %f*mV" % (P["w_syn"] / mV * P["f_poi"]))
    kick.connect(i=0, j=exc)
    Network(neu, syn, spk, gen, kick).run(T_MS * ms)
    ref = set(zip(np.asarray(spk.i[:]).tolist(),
                  np.round(np.asarray(spk.t[:] / ms) * 10).astype(int).tolist()))

    e = pd.read_parquet(CONN)
    con = Connectome.from_edges(len(comp), e.Presynaptic_Index.values, e.Postsynaptic_Index.values,
                                e["Excitatory x Connectivity"].values)
    drive = lambda s: [(exc, 1e9 if s % 50 == 0 else 0.0)]  # rate*dt >= 1: every cell fires
    oi, ot = simulate(con, [(exc, 0.0)], t_ms=T_MS, rate_fn=drive)
    ours = set(zip(oi.tolist(), ot.tolist()))

    res = {"duration_ms": T_MS, "brian2_spikes": len(ref), "ours_spikes": len(ours),
           "identical": len(ref & ours), "only_brian2": len(ref - ours), "only_ours": len(ours - ref)}
    print(json.dumps(res, indent=2))
    (ROOT / "pipeline" / "test_vs_brian2.json").write_text(json.dumps(res, indent=2))
    assert ref == ours, "spike trains differ"


if __name__ == "__main__":
    main()
