"""
p1_detector.py -- the DEPLOYED detector (tier P1): 5-model PyOD ensemble over actor-day features.

This is the protocol evaluated in run_experiments.py, packaged for train/score use by the backend:

  train : chronological split of the history window by DAY
            fit window  (first --train-frac of days)   -> StandardScaler + 5 detectors are fitted here ONLY
            calibration (remaining days)               -> per-model min-max ranges and the P1 threshold
                                                          come from these rows' scores
          P1 threshold = --pct percentile of the calibration ensemble scores (default 95: the percentile
          selected on validation on every v2 seed, see EXPERIMENTS.md). No labels are read anywhere, so the
          same command works on real, unlabelled audit data.
  score : load the artifact, score new actor-days, flag score >= threshold. Scores are NOT clipped
          (ranking keeps its resolution); nothing is refitted.

PyOD contamination is fixed (0.05) and only drives PyOD's internal per-model predict(); it never
decides P1. The PCA zero-weight fix from run_experiments.run_ensemble is reproduced here, and
tests/test_p1_detector.py checks that both code paths give identical scores.

    python p1_detector.py train --in features_history.csv --model-out models/p1_ensemble.joblib
    python p1_detector.py score --in features.csv --model-in models/p1_ensemble.joblib --out scored.csv
"""

import argparse
import json
import os
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

from pyod.models.hbos import HBOS
from pyod.models.iforest import IForest
from pyod.models.knn import KNN
from pyod.models.ocsvm import OCSVM
from pyod.models.pca import PCA

FEATURES = [
    "access_frequency", "distinct_resources_touched", "off_hours_ratio",
    "burst_count", "consent_denied_ratio", "dispense_without_read_count",
]
CONTAMINATION = 0.05
DEFAULT_PCT = 95.0
P1_LABEL = "P1_high_confidence"
ARTIFACT_VERSION = 3


def make_builders(contamination, seed):
    return {
        "pca": lambda: PCA(contamination=contamination, random_state=seed),
        "knn": lambda: KNN(contamination=contamination),
        "iforest": lambda: IForest(contamination=contamination, random_state=seed),
        "ocsvm": lambda: OCSVM(contamination=contamination),
        "hbos": lambda: HBOS(contamination=contamination),
    }


def day_index(dates):
    d = pd.to_datetime(pd.Series(dates)).dt.normalize()
    return (d - d.min()).dt.days.values


def top_features(z_row, top_n=3):
    order = np.argsort(z_row)[::-1][:top_n]
    return json.dumps([{"feature": FEATURES[i], "contribution": round(float(z_row[i]), 4)} for i in order])


def fit_detectors(Xs_fit, seed, contamination=CONTAMINATION):
    models = {}
    for name, build in make_builders(contamination, seed).items():
        m = build()
        with np.errstate(divide="ignore", invalid="ignore"):
            m.fit(Xs_fit)
        # PyOD's PCA divides by the component weights; a zero-variance feature in the fit window
        # gives a zero weight and +inf for every row, which would silently remove PCA.
        w = getattr(m, "selected_w_components_", None)
        if w is not None and np.min(w) < 1e-6:
            m.selected_w_components_ = np.maximum(w, 1e-3)
            m.decision_scores_ = np.asarray(m.decision_function(Xs_fit), dtype=float)
            m._process_decision_scores()
        models[name] = m
    return models


def normalised_scores(models, Xs, ranges):
    """Min-max each model with its calibration range, then equal-weight mean. Returns (ensemble, votes)."""
    parts, votes = [], np.zeros(len(Xs), dtype=int)
    for name, m in models.items():
        raw = np.asarray(m.decision_function(Xs), dtype=float)
        lo, hi = ranges[name]
        ok = np.isfinite(raw)
        nm = (raw - lo) / (hi - lo) if hi > lo else np.zeros_like(raw)
        if np.isposinf(raw).any():
            nm[np.isposinf(raw)] = nm[ok].max() if ok.any() else 1.0
        parts.append(nm)
        votes += np.asarray(m.predict(Xs)).astype(int)
    return np.mean(parts, axis=0), votes


def train(feats, seed=42, train_frac=0.6, pct=DEFAULT_PCT):
    feats = feats.reset_index(drop=True)
    day = day_index(feats["date"].astype(str))
    n_days = int(day.max()) + 1
    train_end = int(n_days * train_frac)
    fit = day < train_end
    cal = ~fit
    if fit.sum() < 50 or cal.sum() < 20:
        raise ValueError(f"history too short: {int(fit.sum())} fit rows / {int(cal.sum())} calibration rows "
                         f"over {n_days} days (need >= 50 / >= 20)")
    X = feats[FEATURES].values.astype(float)
    scaler = StandardScaler().fit(X[fit])
    Xs = scaler.transform(X)
    models = fit_detectors(Xs[fit], seed)

    ranges = {}
    for name, m in models.items():
        raw = np.asarray(m.decision_function(Xs[cal]), dtype=float)
        raw = raw[np.isfinite(raw)]
        if raw.size == 0:
            raise RuntimeError(f"{name}: no finite calibration scores")
        ranges[name] = (float(raw.min()), float(raw.max()))
    ens, _ = normalised_scores(models, Xs, ranges)
    threshold = float(np.percentile(ens[cal], pct))

    mean, std = X[fit].mean(axis=0), X[fit].std(axis=0)
    std[std == 0] = 1.0
    return {
        "version": ARTIFACT_VERSION, "scaler": scaler, "models": models, "ranges": ranges,
        "p1_threshold": threshold, "pct": float(pct), "seed": int(seed), "contamination": CONTAMINATION,
        "train_mean": mean, "train_std": std, "feature_columns": FEATURES,
        "n_fit_rows": int(fit.sum()), "n_cal_rows": int(cal.sum()), "n_days": n_days,
        "fit_days": [str(feats["date"].astype(str)[fit].min()), str(feats["date"].astype(str)[fit].max())],
        "cal_days": [str(feats["date"].astype(str)[cal].min()), str(feats["date"].astype(str)[cal].max())],
    }


def score(feats, art):
    feats = feats.copy()
    X = feats[art["feature_columns"]].values.astype(float)
    Xs = art["scaler"].transform(X)
    ens, votes = normalised_scores(art["models"], Xs, art["ranges"])
    z = (X - art["train_mean"]) / art["train_std"]
    feats["anomaly_score"] = ens
    feats["votes"] = votes            # interpretability only ("N of 5 detectors agree"); never decides P1
    feats["top_features"] = [top_features(z[i]) for i in range(len(z))]
    feats["priority"] = np.where(ens >= art["p1_threshold"], P1_LABEL, "none")
    if "label" not in feats.columns:
        feats["label"] = "unknown"
    return feats


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("train")
    t.add_argument("--in", dest="infile", required=True, help="actor-day features CSV (feature_engineering.py output)")
    t.add_argument("--model-out", required=True)
    t.add_argument("--thresholds-out", default=None, help="also write/merge a thresholds.json with p1_threshold")
    t.add_argument("--seed", type=int, default=42)
    t.add_argument("--train-frac", type=float, default=0.6)
    t.add_argument("--pct", type=float, default=DEFAULT_PCT)
    s = sub.add_parser("score")
    s.add_argument("--in", dest="infile", required=True)
    s.add_argument("--model-in", required=True)
    s.add_argument("--out", required=True)
    a = ap.parse_args()

    if a.cmd == "train":
        art = train(pd.read_csv(a.infile), seed=a.seed, train_frac=a.train_frac, pct=a.pct)
        os.makedirs(os.path.dirname(os.path.abspath(a.model_out)), exist_ok=True)
        joblib.dump(art, a.model_out)
        if a.thresholds_out:
            cur = {}
            if os.path.exists(a.thresholds_out):
                with open(a.thresholds_out) as f:
                    cur = json.load(f)
            # ensemble_threshold kept as an alias so priority_tagging.py (experimental P2 path) still reads it
            cur.update({"p1_threshold": art["p1_threshold"], "ensemble_threshold": art["p1_threshold"],
                        "p1_pct": art["pct"]})
            with open(a.thresholds_out, "w") as f:
                json.dump(cur, f, indent=2)
        print(f"P1 trained: fit {art['n_fit_rows']} rows ({art['fit_days'][0]}..{art['fit_days'][1]}), "
              f"calibration {art['n_cal_rows']} rows ({art['cal_days'][0]}..{art['cal_days'][1]}), "
              f"p{art['pct']:g} threshold = {art['p1_threshold']:.4f}", file=sys.stderr)
    else:
        art = joblib.load(a.model_in)
        if art.get("version") != ARTIFACT_VERSION:
            sys.exit(f"{a.model_in}: artifact version {art.get('version')} != {ARTIFACT_VERSION}; "
                     f"it was written by the old pyod_ensemble.py. Run retrain_pipeline.sh.")
        out = score(pd.read_csv(a.infile), art)
        out.to_csv(a.out, index=False)
        print(f"scored {len(out)} actor-days, {int((out['priority'] == P1_LABEL).sum())} P1", file=sys.stderr)


if __name__ == "__main__":
    main()
