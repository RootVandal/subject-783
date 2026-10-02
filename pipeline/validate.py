"""Check the numpy LIF port against the Brian2 reference results shipped with Shiu et al.

Reference: raw/shiu/results/example/sugarR.parquet (v630 connectome, 21 right-side
sugar GRNs at 200 Hz, 30 trials x 1 s). We rerun the same experiment with lif.py
and compare per-neuron firing rates.
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

from lif import Connectome, simulate

ROOT = Path(__file__).resolve().parent.parent
SHIU = ROOT / "raw" / "shiu"
SUGAR_R = [
    720575940624963786, 720575940630233916, 720575940637568838, 720575940638202345,
    720575940617000768, 720575940630797113, 720575940632889389, 720575940621754367,
    720575940621502051, 720575940640649691, 720575940639332736, 720575940616885538,
    720575940639198653, 720575940620900446, 720575940617937543, 720575940632425919,
    720575940633143833, 720575940612670570, 720575940628853239, 720575940629176663,
    720575940611875570,
]
MN9 = 720575940660219265


def main(n_trials=10):
    comp = pd.read_csv(SHIU / "2023_03_23_completeness_630_final.csv", index_col=0)
    ids = comp.index.to_numpy()
    id2i = {f: i for i, f in enumerate(ids)}
    e = pd.read_parquet(SHIU / "2023_03_23_connectivity_630_final.parquet")
    con = Connectome.from_edges(
        len(ids), e["Presynaptic_Index"].to_numpy(), e["Postsynaptic_Index"].to_numpy(),
        e["Excitatory x Connectivity"].to_numpy(),
    )
    stim = [(np.array([id2i[f] for f in SUGAR_R]), 200.0)]

    counts = np.zeros(len(ids))
    t0 = time.time()
    for trial in range(n_trials):
        nn, _ = simulate(con, stim, t_ms=1000.0, seed=trial)
        counts += np.bincount(nn, minlength=len(ids))
        print(f"trial {trial}: {nn.size} spikes ({time.time() - t0:.0f}s)", flush=True)
    ours = pd.Series(counts / n_trials, index=ids)

    ref = pd.read_parquet(SHIU / "results" / "example" / "sugarR.parquet")
    ref_rate = ref.groupby("flywire_id").size() / ref.trial.nunique()

    union = ref_rate.index.union(ours[ours > 0].index)
    r_ref = ref_rate.reindex(union, fill_value=0.0)
    r_our = ours.reindex(union, fill_value=0.0)
    # exclude the stimulated neurons: they fire at the input rate by construction
    mask = ~union.isin(SUGAR_R)
    corr = float(np.corrcoef(r_ref[mask], r_our[mask])[0, 1])
    res = {
        "trials_ours": n_trials,
        "trials_reference": int(ref.trial.nunique()),
        "active_neurons_reference": int((ref_rate > 0).sum()),
        "active_neurons_ours": int((ours > 0).sum()),
        "mn9_hz_reference": round(float(ref_rate.get(MN9, 0.0)), 1),
        "mn9_hz_ours": round(float(ours[MN9]), 1),
        "pearson_r_nonstimulated": round(corr, 4),
        "top20_overlap": int(len(set(r_ref[mask].nlargest(20).index) & set(r_our[mask].nlargest(20).index))),
    }
    print(json.dumps(res, indent=2))
    (ROOT / "pipeline" / "validation.json").write_text(json.dumps(res, indent=2))


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 10)
