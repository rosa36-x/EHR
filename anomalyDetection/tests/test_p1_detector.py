"""
Checks for p1_detector.py (the deployed P1 tier). Run from anomalyDetection/:  python -m pytest tests -q

  1. parity     : p1_detector gives the same ensemble scores as the evaluated harness (run_experiments.run_ensemble)
  2. no leakage : changing calibration-window rows changes the threshold but not the fitted models; changing
                  labels changes nothing (labels are never read)
  3. determinism: same seed -> identical artifact scores
  4. round trip : joblib save/load and score() reproduce train-time scores, P1 rate on the calibration window ~ 100-pct
  5. zero-variance feature (PCA fix) keeps every score finite
"""
import io
import os
import sys

import joblib
import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import p1_detector as p1                      # noqa: E402
import run_experiments as rx                  # noqa: E402
import generate_synthetic_audit_data_v2 as gen  # noqa: E402


@pytest.fixture(scope="module")
def feats():
    df = gen.generate("v2", 60, 3, None, 1.0)
    f, _, _ = rx.build_feature_table(df, 0.6, 0.2)
    return f


def _harness_scores(f, seed):
    g = f.copy()
    day = p1.day_index(g["date_s"])
    train_end = int((int(day.max()) + 1) * 0.6)
    g["split"] = np.where(day < train_end, "train", "val")      # everything after train = calibration
    fit = (g["split"] == "train").values
    ens, _, _ = rx.run_ensemble(g, fit, p1.CONTAMINATION, seed)
    return ens


def test_parity_with_harness(feats):
    art = p1.train(feats.assign(date=feats["date_s"]), seed=7, train_frac=0.6, pct=95)
    out = p1.score(feats.assign(date=feats["date_s"]), art)
    np.testing.assert_allclose(out["anomaly_score"].values, _harness_scores(feats, 7), rtol=1e-9, atol=1e-9)


def test_labels_are_never_read(feats):
    f = feats.assign(date=feats["date_s"])
    a = p1.train(f, seed=1)
    b = p1.train(f.assign(label="normal", y=False, anomaly_type=""), seed=1)
    assert a["p1_threshold"] == b["p1_threshold"]


def test_calibration_rows_move_threshold_not_models(feats):
    f = feats.assign(date=feats["date_s"])
    a = p1.train(f, seed=1)
    day = p1.day_index(f["date"])
    cal = day >= int((int(day.max()) + 1) * 0.6)
    g = f.copy()
    g.loc[cal, "access_frequency"] = g.loc[cal, "access_frequency"] * 5 + 50
    b = p1.train(g, seed=1)
    assert a["p1_threshold"] != b["p1_threshold"]
    np.testing.assert_allclose(a["scaler"].mean_, b["scaler"].mean_)


def test_deterministic_and_roundtrip(feats, tmp_path):
    f = feats.assign(date=feats["date_s"])
    a, b = p1.train(f, seed=5), p1.train(f, seed=5)
    np.testing.assert_allclose(p1.score(f, a)["anomaly_score"], p1.score(f, b)["anomaly_score"])
    joblib.dump(a, tmp_path / "m.joblib")
    c = joblib.load(tmp_path / "m.joblib")
    out = p1.score(f, c)
    np.testing.assert_allclose(out["anomaly_score"], p1.score(f, a)["anomaly_score"])
    day = p1.day_index(f["date"])
    cal = day >= int((int(day.max()) + 1) * 0.6)
    rate = (out["priority"][cal] == p1.P1_LABEL).mean()
    assert 0.04 <= rate <= 0.06, rate


def test_zero_variance_feature_stays_finite(feats):
    f = feats.assign(date=feats["date_s"]).copy()
    f["dispense_without_read_count"] = 0
    art = p1.train(f, seed=2)
    out = p1.score(f, art)
    assert np.isfinite(out["anomaly_score"]).all()


def test_short_history_rejected(feats):
    f = feats.assign(date=feats["date_s"])
    with pytest.raises(ValueError):
        p1.train(f.iloc[:30], seed=1)
