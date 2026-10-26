"""
run_experiments.py

One reproducible entry point for the reviewer-rerun. Everything the paper
reports comes out of one invocation, into one timestamped folder
(runs/<tag>/), so outputs stop piling up in this directory.

Protocol (the answer to "where were the percentiles fitted?")
  * Chronological split by calendar day, shared by every model:
        train = first 60% of days   (models are FIT here)
        val   = next 20%            (thresholds, min-max ranges, LSTM z-score stats,
                                     LSTM early stopping are chosen here)
        test  = last 20%            (REPORTED only; nothing is fitted or tuned on it)
    An actor-day lies wholly inside one split, so there is no straddling.
  * Seeds: generator seed = model seed = each value of --seeds. torch/numpy/random
    are seeded. LSTM checkpoints are kept in memory (no files).
  * P1 = ensemble score >= p97 of VAL scores. P2 = LSTM max-z >= p99 of VAL
    scores (and not P1). Deployed system = P1 or P2.
  * Every method reports counts AND rates: flags, TP, FP, FN, precision, recall,
    F1, flags per 1000 windows, and the precision ceiling n_pos/flags (the
    reviewer's point: precision cannot exceed this at a given flag budget).

Methods
  P1, votes>=4 (legacy rule), IForest-only, LSTM-only, DeepLog-style (top-g
  next-event rule, g chosen on val so the val flag rate matches P1's budget),
  deployed P1+P2, supervised LR / SVM trained on train+val labels (temporal),
  and supervised LR / SVM with stratified 10-fold CV pooled over all windows
  (Boxwala-et-al.-style protocol; different evaluation population, marked in
  the `protocol` column; supervised baselines use labels, the others do not).

Extra experiments
  --sanity           print dataset diagnostics (legacy vs v2): counts, positives per
                     split, benign-denial rate, single-feature ROC-AUC. No models.
  --p1-filtered-train label-free: train the LSTM without the training actor-days that P1 flags
  --clean-train      oracle ablation: fit ensemble + LSTM on training data with every injected event removed
                     (thresholds are still set on the unmodified validation split)
  --exclude-type T   remove anomaly type T from everything the models are fitted on
                     (train period), then evaluate recall on T in the test period.
  --severity s       v2 only, volume of injected anomalies (see generator).

Usage:
    python run_experiments.py --sanity --seeds 1-3
    python run_experiments.py --profile v2 --seeds 1-10 --figures
    python run_experiments.py --profile legacy --seeds 1 --days 90
    python run_experiments.py --profile v2 --seeds 1-10 --exclude-type bigram_violation
"""

import argparse
import copy
import json
import os
import platform
import random
import subprocess
import sys
import time
from datetime import datetime

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

from pyod.models.hbos import HBOS
from pyod.models.iforest import IForest
from pyod.models.knn import KNN
from pyod.models.ocsvm import OCSVM
from pyod.models.pca import PCA

import generate_synthetic_audit_data_v2 as gen
from feature_engineering import build_actor_features

FEATURES = [
    "access_frequency", "distinct_resources_touched", "off_hours_ratio",
    "burst_count", "consent_denied_ratio", "dispense_without_read_count",
]
START_TOKEN, UNK_TOKEN = "<START>", "<UNK>"
BURN_IN = 5
P1_PCT, P2_PCT = 97.0, 99.0
SWEEP_PCTS = [90.0, 93.0, 95.0, 97.0, 98.0, 99.0, 99.5]
G_GRID = [1, 2, 3, 4, 5, 7, 9, 12, 15, 20, 25, 32, 40, 50, 60, 80, 100, 115, 130, 145, 160, 175]


# ------------------------------------------------------------------ utils ----

def set_seeds(seed):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def parse_seeds(text):
    seeds = []
    for part in text.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-")
            seeds += list(range(int(a), int(b) + 1))
        elif part:
            seeds.append(int(part))
    return seeds


def flag_metrics(y, flag):
    y = np.asarray(y).astype(bool)
    f = np.asarray(flag).astype(bool)
    tp, fp, fn = int((y & f).sum()), int((~y & f).sum()), int((y & ~f).sum())
    n, npos, nf = len(y), int(y.sum()), int(f.sum())
    precision = tp / nf if nf else 0.0
    recall = tp / npos if npos else float("nan")
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
    return dict(
        n_windows=n, n_pos=npos, flags=nf, tp=tp, fp=fp, fn=fn,
        precision=precision, recall=recall, f1=f1,
        flags_per_1k=1000.0 * nf / n if n else float("nan"),
        precision_ceiling=min(1.0, npos / nf) if nf else float("nan"),
    )


def rank_metrics(y, score):
    """Threshold-free metrics. NaN when the test slice has a single class."""
    y = np.asarray(y).astype(int)
    s = np.nan_to_num(np.asarray(score, dtype=float), nan=-1e9, posinf=1e9, neginf=-1e9)
    out = dict(ap=float("nan"), auc=float("nan"), r_precision=float("nan"))
    if y.sum() == 0 or y.sum() == len(y):
        return out
    out["ap"] = float(average_precision_score(y, s))
    out["auc"] = float(roc_auc_score(y, s))
    k = int(y.sum())
    top = np.argsort(-s, kind="stable")[:k]
    out["r_precision"] = float(y[top].mean())
    return out


def day_splits(dates, train_frac, val_frac):
    """Return (split array, train_end_day, val_end_day, day_index)."""
    dates = pd.to_datetime(pd.Series(dates))
    d0 = dates.min().normalize()
    day = (dates.dt.normalize() - d0).dt.days.values
    n_days = int(day.max()) + 1
    train_end = int(n_days * train_frac)
    val_end = int(n_days * (train_frac + val_frac))
    split = np.where(day < train_end, "train", np.where(day < val_end, "val", "test"))
    return split, train_end, val_end, day


# --------------------------------------------------------------- features ----

def build_feature_table(df, train_frac, val_frac):
    feats = build_actor_features(df)
    feats["date_s"] = feats["date"].astype(str)
    feats["y"] = (feats["label"] == "anomalous").values
    split, train_end, val_end, day = day_splits(feats["date_s"], train_frac, val_frac)
    feats["split"] = split
    feats["day"] = day
    # anomaly type per actor-day (first type among the day's anomalous events)
    ev = df[df["label"] == "anomalous"].copy()
    ev["date_s"] = pd.to_datetime(ev["timestamp"]).dt.date.astype(str)
    if "anomaly_type" in ev.columns:
        ev["anomaly_type"] = ev["anomaly_type"].fillna("untagged")
    else:
        ev["anomaly_type"] = "untagged"
    types = (ev.sort_values("anomaly_type").groupby(["actorID", "date_s"])["anomaly_type"]
               .first().rename("anomaly_type").reset_index())
    feats = feats.merge(types, on=["actorID", "date_s"], how="left")
    feats["anomaly_type"] = feats["anomaly_type"].fillna("")
    return feats, train_end, val_end


# --------------------------------------------------------------- ensemble ----

def make_builders(contamination, seed):
    return {
        "pca": lambda: PCA(contamination=contamination, random_state=seed),
        "knn": lambda: KNN(contamination=contamination),
        "iforest": lambda: IForest(contamination=contamination, random_state=seed),
        "ocsvm": lambda: OCSVM(contamination=contamination),
        "hbos": lambda: HBOS(contamination=contamination),
    }


def run_ensemble(feats, fit_mask, contamination, seed):
    """Fit scaler + 5 detectors on fit_mask rows only. Min-max ranges come from
    VAL scores. Scores are NOT clipped, so ranking metrics keep resolution."""
    X = feats[FEATURES].values.astype(float)
    val = (feats["split"] == "val").values
    scaler = StandardScaler().fit(X[fit_mask])
    Xs = scaler.transform(X)
    norm, votes = {}, np.zeros(len(feats), dtype=int)
    for name, build in make_builders(contamination, seed).items():
        model = build()
        with np.errstate(divide="ignore", invalid="ignore"):
            model.fit(Xs[fit_mask])
        # PyOD's PCA divides by the component weights; a zero-variance feature in the fit
        # data (clean-train: dispense_without_read_count is always 0) gives a zero weight
        # and +inf for EVERY row, which silently removed PCA from the ensemble.
        w = getattr(model, "selected_w_components_", None)
        if w is not None and np.min(w) < 1e-6:
            model.selected_w_components_ = np.maximum(w, 1e-3)
            model.decision_scores_ = np.asarray(model.decision_function(Xs[fit_mask]), dtype=float)
            model._process_decision_scores()   # refresh threshold_/labels_ used by predict() (votes rule)
        raw = np.asarray(model.decision_function(Xs), dtype=float)
        # A detector can return +inf when a feature has zero variance in the fit
        # data (clean-train: dispense_without_read_count is always 0, so PyOD's PCA
        # divides by a zero weight). +inf means "infinitely far from the fit data":
        # rank it at the top, and keep it out of the min-max range.
        pos_inf = np.isposinf(raw)
        ok = np.isfinite(raw)
        if pos_inf.any():
            print(f"    note: {name} returned +inf for {int(pos_inf.sum())} rows; ranked at the top", file=sys.stderr)
        if not (val & ok).any():
            raise RuntimeError(f"{name}: no finite validation scores; the detector is not usable on this fit set")
        lo, hi = raw[val & ok].min(), raw[val & ok].max()
        nm = (raw - lo) / (hi - lo) if hi > lo else np.zeros_like(raw)
        if pos_inf.any():
            nm[pos_inf] = nm[ok].max()
        norm[name] = nm
        votes += np.asarray(model.predict(Xs)).astype(int)
    score = np.mean(list(norm.values()), axis=0)
    return score, norm["iforest"], votes


# ------------------------------------------------------------------- LSTM ----

def delta_bucket(seconds):
    if seconds is None:
        return "FIRST"
    if seconds < 60:
        return "<1m"
    if seconds < 5 * 60:
        return "1-5m"
    if seconds < 30 * 60:
        return "5-30m"
    if seconds < 2 * 3600:
        return "30m-2h"
    if seconds < 8 * 3600:
        return "2-8h"
    if seconds < 24 * 3600:
        return "8-24h"
    return ">24h"


def seq_table(df, d0):
    """Per-event table with the same token definition as lstm_sequence_model.py."""
    d = df[["actorID", "actorRole", "action", "resourceType", "timestamp"]].copy()
    d["timestamp"] = pd.to_datetime(d["timestamp"])
    d = d.sort_values(["actorID", "timestamp"], kind="stable").reset_index(drop=True)
    gap = d.groupby("actorID")["timestamp"].diff().dt.total_seconds()
    bucket = pd.Series([delta_bucket(None if pd.isna(x) else float(x)) for x in gap], index=d.index)
    role = d.groupby("actorID")["actorRole"].transform("first")
    d["token"] = role + "|" + d["action"] + "|" + d["resourceType"] + "|" + bucket
    d["event_idx"] = d.groupby("actorID").cumcount()
    d["day"] = (d["timestamp"].dt.normalize() - d0).dt.days
    d["date_s"] = d["timestamp"].dt.date.astype(str)
    return d


class NextEventLSTM(nn.Module):
    def __init__(self, vocab_size, embed_dim=16, hidden_dim=32):
        super().__init__()
        self.embed = nn.Embedding(vocab_size, embed_dim)
        self.lstm = nn.LSTM(embed_dim, hidden_dim, batch_first=True)
        self.out = nn.Linear(hidden_dim, vocab_size)

    def forward(self, ids):
        h, _ = self.lstm(self.embed(ids))
        return self.out(h)


def train_and_score_lstm(df, d0, train_end, val_end, seed, train_exclude_type=None, exclude_windows=None,
                         epochs=25, patience=5, lr=1e-2, embed_dim=16, hidden_dim=32):
    """Trains on events with day < train_end only. Early stopping on val-period
    loss (the LSTM is causal, so a forward pass over a full sequence never lets
    test events influence val positions). Returns per-event scores for all events."""
    full = seq_table(df, d0)
    train_src = df
    if train_exclude_type == "__all__" and "anomaly_type" in df.columns:
        train_src = df[df["anomaly_type"].fillna("") == ""]
    elif train_exclude_type and "anomaly_type" in df.columns:
        train_src = df[df["anomaly_type"].fillna("") != train_exclude_type]
    train_ev = seq_table(train_src, d0)
    train_ev = train_ev[train_ev["day"] < train_end]
    if exclude_windows:  # label-free filter: drop events of actor-days flagged by P1; tokens keep their original gaps
        keys = pd.MultiIndex.from_frame(train_ev[["actorID", "date_s"]])
        train_ev = train_ev[~keys.isin(list(exclude_windows))]

    vocab_tokens = sorted(set(train_ev["token"]) | {START_TOKEN, UNK_TOKEN})
    vocab = {t: i for i, t in enumerate(vocab_tokens)}
    start_id, unk_id = vocab[START_TOKEN], vocab[UNK_TOKEN]

    train_seqs = [[start_id] + [vocab[t] for t in g_.token] for _, g_ in train_ev.groupby("actorID", sort=True)
                  if len(g_) >= 2]
    full["tid"] = full["token"].map(vocab).fillna(unk_id).astype(int)
    actors = []
    for actor, g_ in full.groupby("actorID", sort=True):
        ids = torch.tensor([[start_id] + g_["tid"].tolist()], dtype=torch.long)
        day = g_["day"].values
        in_val = torch.tensor((day >= train_end) & (day < val_end))
        actors.append((actor, g_, ids, in_val))

    set_seeds(seed)
    model = NextEventLSTM(len(vocab), embed_dim, hidden_dim)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    ce = nn.CrossEntropyLoss()
    order_rng = random.Random(seed)
    best_val, best_state, bad, history = float("inf"), None, 0, []

    for epoch in range(epochs):
        model.train()
        order = list(range(len(train_seqs)))
        order_rng.shuffle(order)
        tot = 0.0
        for i in order:
            ids = torch.tensor([train_seqs[i]], dtype=torch.long)
            opt.zero_grad()
            loss = ce(model(ids[:, :-1]).squeeze(0), ids[0, 1:])
            loss.backward()
            opt.step()
            tot += loss.item()
        model.eval()
        v_sum, v_n = 0.0, 0
        with torch.no_grad():
            for _, _, ids, in_val in actors:
                if not in_val.any():
                    continue
                logits = model(ids[:, :-1]).squeeze(0)
                v_sum += nn.functional.cross_entropy(logits[in_val], ids[0, 1:][in_val], reduction="sum").item()
                v_n += int(in_val.sum())
        val_loss = v_sum / v_n if v_n else float("nan")
        history.append((epoch + 1, tot / max(1, len(order)), val_loss))
        if v_n and val_loss < best_val:
            best_val, bad = val_loss, 0
            best_state = copy.deepcopy(model.state_dict())
        else:
            bad += 1
            if bad >= patience:
                break
    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()

    parts = []
    with torch.no_grad():
        for actor, g_, ids, _ in actors:
            logits = model(ids[:, :-1]).squeeze(0)
            logp = torch.log_softmax(logits, dim=-1)
            tgt = ids[0, 1:]
            surprisal = -logp[torch.arange(len(tgt)), tgt]
            rank = (logits > logits.gather(1, tgt[:, None])).sum(dim=1)
            parts.append(pd.DataFrame({
                "actorID": actor, "date_s": g_["date_s"].values, "day": g_["day"].values,
                "event_idx": g_["event_idx"].values,
                "surprisal": surprisal.numpy(), "rank": rank.numpy()}))
    ev = pd.concat(parts, ignore_index=True)
    return ev, history, len(vocab)


def aggregate_lstm(ev, test_start):
    """Per actor-day: max z-surprisal and max rank. z-score stats per actor use
    only events BEFORE the test period (past data); fallback to global."""
    ev = ev[ev["event_idx"] >= BURN_IN].copy()
    pre = ev[ev["day"] < test_start]
    stats = pre.groupby("actorID")["surprisal"].agg(["mean", "std", "count"])
    gmean, gstd = pre["surprisal"].mean(), pre["surprisal"].std()
    ev = ev.join(stats, on="actorID")
    ok = (ev["count"].fillna(0) >= 5) & ev["std"].notna() & (ev["std"] > 1e-6)
    mu = np.where(ok, ev["mean"], gmean)
    sd = np.where(ok, ev["std"], gstd if gstd and gstd > 1e-6 else 1.0)
    ev["z"] = (ev["surprisal"] - mu) / sd
    agg = ev.groupby(["actorID", "date_s"]).agg(lstm_z=("z", "max"), max_rank=("rank", "max")).reset_index()
    return agg


# ---------------------------------------------------------------- one seed ----

def run_seed(seed, args):
    t0 = time.time()
    df = gen.generate(args.profile, args.days, seed, args.n_bursts, args.severity)
    feats, train_end, val_end = build_feature_table(df, args.train_frac, args.val_frac)
    d0 = pd.to_datetime(feats["date_s"]).min().normalize()
    n_days = int(feats["day"].max()) + 1

    tr = (feats["split"] == "train").values
    va = (feats["split"] == "val").values
    te = (feats["split"] == "test").values
    y = feats["y"].values

    excl = args.exclude_type
    fit_mask = tr.copy()
    if excl:
        fit_mask &= (feats["anomaly_type"] != excl).values
    if args.clean_train:  # oracle ablation: models are fitted without ANY injected events
        fit_mask &= (y == 0)

    # ---- ensemble
    ens, iforest, votes = run_ensemble(feats, fit_mask, args.contamination, seed)
    feats["ens"], feats["iforest"], feats["votes"] = ens, iforest, votes

    # ---- label-free filter for LSTM training: drop actor-days that P1 flags (P1 threshold from VAL)
    excl_windows, n_ex, n_ex_pos = None, 0, 0
    if args.p1_filtered_train:
        t1_pre = float(np.percentile(ens[va], P1_PCT))
        flagged_tr = tr & (ens >= t1_pre)
        excl_windows = set(zip(feats.loc[flagged_tr, "actorID"], feats.loc[flagged_tr, "date_s"]))
        n_ex, n_ex_pos = int(flagged_tr.sum()), int((flagged_tr & (y == 1)).sum())  # labels: reporting only

    # ---- LSTM
    ev, history, vocab_size = train_and_score_lstm(df, d0, train_end, val_end, seed,
                                                   train_exclude_type=("__all__" if args.clean_train else excl),
                                                   exclude_windows=excl_windows,
                                                   epochs=args.epochs)
    agg = aggregate_lstm(ev, val_end)
    feats = feats.merge(agg, on=["actorID", "date_s"], how="left")
    feats["lstm_z"] = feats["lstm_z"].fillna(-np.inf)
    feats["max_rank"] = feats["max_rank"].fillna(-1)
    lz, mr = feats["lstm_z"].values, feats["max_rank"].values

    # ---- thresholds: VAL only
    t1 = float(np.percentile(ens[va], P1_PCT))
    ti = float(np.percentile(iforest[va], P1_PCT))
    lz_val = lz[va & np.isfinite(lz)]
    t2 = float(np.percentile(lz_val, P2_PCT)) if len(lz_val) else np.inf
    budget = 1.0 - P1_PCT / 100.0
    # DeepLog's g: pick the g whose VAL flag rate is closest to P1's budget
    # (ties -> smaller g), so the comparison is at an equal flag budget.
    g_sel = min(G_GRID, key=lambda g_: (abs((mr[va] >= g_).mean() - budget), g_))

    p1 = ens >= t1
    p2 = (lz >= t2) & ~p1
    flags = {
        "P1 (ensemble p97)": (p1, ens),
        "Votes>=4 (legacy rule)": (votes >= 4, None),
        "IForest only (p97)": (iforest >= ti, iforest),
        "LSTM only (p99)": (lz >= t2, lz),
        "DeepLog-style (budget-matched g)": (mr >= g_sel, mr.astype(float)),
        "Deployed P1+P2": (p1 | p2, None),  # two-tier rule has no single score
    }

    # ---- supervised baselines (labels used; temporal protocol)
    Xf = feats[FEATURES].values.astype(float)
    sup_train = (tr | va)
    if excl:
        sup_train &= (feats["anomaly_type"] != excl).values
    models = {"LR": lambda: make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", max_iter=1000)),
              "SVM": lambda: make_pipeline(StandardScaler(), SVC(kernel="rbf", class_weight="balanced"))}
    for name, mk in models.items():
        if y[sup_train].sum() >= 2:
            m = mk().fit(Xf[sup_train], y[sup_train])
            dec = m.decision_function(Xf)
            flags[f"Supervised {name} (train+val labels)"] = (dec > 0, dec)

    rows, type_rows = [], []
    for method, (flag, score) in flags.items():
        m = flag_metrics(y[te], flag[te])
        m.update(rank_metrics(y[te], np.asarray(score)[te]) if score is not None
                 else dict(ap=float("nan"), auc=float("nan"), r_precision=float("nan")))
        m.update(seed=seed, method=method, protocol="temporal-test")
        rows.append(m)
        for typ in sorted(set(feats.loc[te & y, "anomaly_type"])):
            sel = te & y & (feats["anomaly_type"] == typ).values
            type_rows.append(dict(seed=seed, method=method, anomaly_type=typ or "untagged",
                                  n_pos=int(sel.sum()), caught=int(flag[sel].sum()),
                                  recall=float(flag[sel].mean()) if sel.sum() else float("nan")))

    # ---- Boxwala-style: stratified 10-fold CV pooled over ALL windows (random folds)
    npos_all = int(y.sum())
    if npos_all >= 4:
        skf = StratifiedKFold(n_splits=min(10, npos_all), shuffle=True, random_state=seed)
        for name, mk in models.items():
            dec = cross_val_predict(mk(), Xf, y, cv=skf, method="decision_function")
            m = flag_metrics(y, dec > 0)
            m.update(rank_metrics(y, dec))
            m.update(seed=seed, method=f"Supervised {name} (10-fold CV, pooled)", protocol="random-10fold-all-windows")
            rows.append(m)

    # ---- threshold sweep on test (thresholds still from VAL)
    sweep = []
    for pct in SWEEP_PCTS:
        t = float(np.percentile(ens[va], pct))
        a = ens >= t
        b = a | ((lz >= t2) & ~a)
        for label, fl in (("P1", a), ("P1+P2", b)):
            m = flag_metrics(y[te], fl[te])
            m.update(seed=seed, p1_percentile=pct, system=label)
            sweep.append(m)

    info = dict(seed=seed, profile=args.profile, n_events=len(df), n_windows=len(feats),
                n_pos_total=int(y.sum()),
                n_pos_train=int(y[tr].sum()), n_pos_val=int(y[va].sum()), n_pos_test=int(y[te].sum()),
                n_test_windows=int(te.sum()), n_train_excluded=n_ex, n_train_excluded_pos=n_ex_pos, t1=t1, t2=t2, g=g_sel, vocab=vocab_size,
                lstm_epochs=len(history), lstm_best_val=min((h[2] for h in history if not np.isnan(h[2])), default=float("nan")),
                n_days=n_days, train_end_day=train_end, val_end_day=val_end,
                seconds=round(time.time() - t0, 1))
    print(f"  seed {seed}: {info['n_windows']} windows, test pos {info['n_pos_test']}/{info['n_test_windows']}, "
          f"P1 flags {int(p1[te].sum())}, P2 flags {int(p2[te].sum())}, g={g_sel}, {info['seconds']}s", flush=True)
    return rows, type_rows, sweep, info


# ---------------------------------------------------------------- sanity ----

def sanity(args):
    print("Dataset diagnostics (no models). One row per profile x seed.\n")
    out = []
    for profile in ("legacy", "v2"):
        for seed in parse_seeds(args.seeds):
            df = gen.generate(profile, args.days, seed, None, args.severity)
            feats, _, _ = build_feature_table(df, args.train_frac, args.val_frac)
            y = feats["y"].values
            normal_ev = df[df["label"] == "normal"]
            row = dict(profile=profile, seed=seed, events=len(df),
                       anomalous_events=int((df["label"] == "anomalous").sum()),
                       windows=len(feats), pos=int(y.sum()),
                       pos_train=int(y[feats.split == "train"].sum()),
                       pos_val=int(y[feats.split == "val"].sum()),
                       pos_test=int(y[feats.split == "test"].sum()),
                       normal_denied_pct=round(100 * (normal_ev["action"] == "ACCESS_DENIED").mean(), 2))
            for f in FEATURES:
                row["auc_" + f.replace("distinct_resources_touched", "distinct_res")[:14]] = round(roc_auc_score(y, feats[f]), 3)
            out.append(row)
    table = pd.DataFrame(out)
    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 30)
    print(table.to_string(index=False))
    print("\nauc_* = ROC-AUC of that single raw feature against the label over all windows.")
    print("Values near 1.0 mean the feature alone nearly equals the label (a label proxy).")
    print("0.5 = no information. Compare legacy vs v2 rows.")


# ------------------------------------------------------------------ report ----

def mean_std(df, cols, by):
    g_ = df.groupby(by, sort=False)[cols]
    m, s = g_.mean(), g_.std(ddof=1)
    out = m.copy()
    for c in cols:
        out[c] = [f"{a:.3f} ± {b:.3f}" if pd.notna(b) else f"{a:.3f}" for a, b in zip(m[c], s[c])]
    return out.reset_index()


def to_markdown(df):
    cols = list(df.columns)
    lines = ["| " + " | ".join(cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    for _, r in df.iterrows():
        lines.append("| " + " | ".join(str(r[c]) for c in cols) + " |")
    return "\n".join(lines)


def write_reports(out_dir, rows, type_rows, sweep, infos, args, make_figures):
    res = pd.DataFrame(rows)
    res.to_csv(os.path.join(out_dir, "per_seed.csv"), index=False)
    pd.DataFrame(type_rows).to_csv(os.path.join(out_dir, "by_type_per_seed.csv"), index=False)
    pd.DataFrame(sweep).to_csv(os.path.join(out_dir, "sweep_per_seed.csv"), index=False)
    pd.DataFrame(infos).to_csv(os.path.join(out_dir, "dataset_per_seed.csv"), index=False)

    metric_cols = ["flags", "tp", "fp", "fn", "precision", "recall", "f1", "flags_per_1k",
                   "precision_ceiling", "ap", "auc", "r_precision", "n_pos", "n_windows"]
    summary = mean_std(res, metric_cols, ["protocol", "method"])
    summary.to_csv(os.path.join(out_dir, "summary.csv"), index=False)
    shown = ["protocol", "method", "n_pos", "flags", "tp", "fp", "precision", "recall", "f1",
             "flags_per_1k", "precision_ceiling", "ap"]
    md = ["# Summary (mean ± std over seeds)\n",
          f"profile={args.profile}  seeds={args.seeds}  days={args.days}  severity={args.severity}  "
          f"split={args.train_frac}/{args.val_frac}/{round(1 - args.train_frac - args.val_frac, 2)}  "
          f"exclude_type={args.exclude_type} clean_train={args.clean_train} p1_filtered_train={args.p1_filtered_train}\n",
          "Thresholds, min-max ranges and LSTM stats fit on VAL; metrics on TEST only "
          "(rows with protocol random-10fold-all-windows pool all windows).\n",
          to_markdown(summary[shown]), ""]
    ds = pd.DataFrame(infos)[["seed", "n_windows", "n_pos_total", "n_pos_train", "n_pos_val", "n_pos_test",
                              "n_test_windows", "n_train_excluded", "n_train_excluded_pos", "lstm_epochs", "g", "seconds"]]
    md += ["\n# Dataset per seed\n", to_markdown(ds), ""]

    sw = pd.DataFrame(sweep)
    swm = sw.groupby(["system", "p1_percentile"], sort=False)[
        ["flags", "precision", "recall", "precision_ceiling", "flags_per_1k"]].mean().round(3).reset_index()
    swm.to_csv(os.path.join(out_dir, "sweep_mean.csv"), index=False)
    md += ["\n# Threshold sweep (mean over seeds; P1 percentile fit on VAL)\n", to_markdown(swm), ""]

    if type_rows:
        ty = pd.DataFrame(type_rows)
        tym = ty.groupby(["method", "anomaly_type"], sort=False).agg(
            n_pos=("n_pos", "sum"), caught=("caught", "sum")).reset_index()
        tym["recall"] = (tym["caught"] / tym["n_pos"]).round(3)
        tym.to_csv(os.path.join(out_dir, "by_type_pooled.csv"), index=False)
        keep = tym[tym["method"].isin(["P1 (ensemble p97)", "LSTM only (p99)", "Deployed P1+P2"])
                   | tym["method"].str.startswith("DeepLog") | tym["method"].str.startswith("Supervised LR (train")]
        md += ["\n# Recall by anomaly type (test windows pooled over seeds)\n", to_markdown(keep), ""]

    with open(os.path.join(out_dir, "summary.md"), "w") as f:
        f.write("\n".join(md))

    if make_figures:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(7, 4.5))
        for system, style in (("P1", "-"), ("P1+P2", "--")):
            s = sw[sw["system"] == system].groupby("p1_percentile")[["precision", "recall", "precision_ceiling"]].agg(["mean", "std"])
            x = s.index.values
            ax.errorbar(x, s[("precision", "mean")], s[("precision", "std")], ls=style, marker="o", color="#C44E52",
                        label=f"precision ({system})")
            ax.errorbar(x, s[("recall", "mean")], s[("recall", "std")], ls=style, marker="s", color="#4C72B0",
                        label=f"recall ({system})")
            if system == "P1":
                ax.plot(x, s[("precision_ceiling", "mean")], ls=":", color="gray", label="precision ceiling n_pos/flags")
        ax.set_xlabel("P1 percentile (threshold fit on validation scores)")
        ax.set_ylabel("test metric (mean ± std over seeds)")
        ax.set_ylim(0, 1.05)
        ax.legend(fontsize=8)
        ax.set_title("Operating point sweep")
        fig.tight_layout()
        fig.savefig(os.path.join(out_dir, "sweep.png"), dpi=150)
        plt.close(fig)

    print("\n" + "\n".join(md[:5]))


def git_rev():
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], stderr=subprocess.DEVNULL).decode().strip()
    except Exception:
        return None


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--profile", choices=["legacy", "v2"], default="v2")
    p.add_argument("--seeds", default="1-10", help="e.g. 1-10 or 1,4,7")
    p.add_argument("--days", type=int, default=90)
    p.add_argument("--n-bursts", type=int, default=None)
    p.add_argument("--severity", type=float, default=1.0)
    p.add_argument("--train-frac", type=float, default=0.6)
    p.add_argument("--val-frac", type=float, default=0.2)
    p.add_argument("--contamination", type=float, default=0.05,
                   help="PyOD internal contamination; fixed (not derived from labels). Affects votes only")
    p.add_argument("--epochs", type=int, default=25)
    p.add_argument("--clean-train", action="store_true")
    p.add_argument("--p1-filtered-train", action="store_true",
                   help="label-free: train the LSTM without the training actor-days that P1 flags")
    p.add_argument("--exclude-type", default=None, choices=gen.ANOMALY_TYPES,
                   help="drop this anomaly type from everything fitted on (train period)")
    p.add_argument("--sanity", action="store_true", help="dataset diagnostics only, no models")
    p.add_argument("--figures", action="store_true")
    p.add_argument("--out-dir", default=None, help="default runs/<profile>_<timestamp>")
    args = p.parse_args()

    torch.set_num_threads(1)
    if args.sanity:
        sanity(args)
        return

    tag = args.out_dir or os.path.join("runs", f"{args.profile}_{datetime.now():%Y%m%d-%H%M%S}")
    os.makedirs(tag, exist_ok=True)
    seeds = parse_seeds(args.seeds)
    print(f"Writing to {tag}  (seeds {seeds}, profile {args.profile})")

    all_rows, all_types, all_sweep, infos = [], [], [], []
    for s in seeds:
        r, t, w, i = run_seed(s, args)
        all_rows += r
        all_types += t
        all_sweep += w
        infos.append(i)

    config = dict(args=vars(args), seeds=seeds, git_rev=git_rev(), python=sys.version.split()[0],
                  platform=platform.platform(), numpy=np.__version__, pandas=pd.__version__, torch=torch.__version__,
                  started=datetime.now().isoformat(timespec="seconds"))
    with open(os.path.join(tag, "config.json"), "w") as f:
        json.dump(config, f, indent=2, default=str)
    write_reports(tag, all_rows, all_types, all_sweep, infos, args, args.figures)
    print(f"\nDone. See {tag}/summary.md")


if __name__ == "__main__":
    main()
