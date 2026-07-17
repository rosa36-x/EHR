"""
lstm_sequence_model.py

Per-actor SEQUENCE anomaly model, layered on top of (not replacing) the
Isolation Forest baseline. Isolation Forest scores each actor-day window
as a bag of features; it can't tell "5 reads in normal order" from
"5 reads in a weird order/timing" if the aggregate counts match. This
model looks at the actual ORDER and TIMING of events per actor and
flags sequences that don't look like anything it saw during training.

Approach: unsupervised next-token prediction (a small per-actor "language
model" over audit events, no labels used in training):
  1. Each event -> a token combining (actorRole, action, resourceType,
     time-since-last-event-bucket). Role and time delta are folded INTO
     the token specifically so the model is sensitive to role-specific
     norms and unusual gaps, not just unusual actions in isolation.
  2. Train an LSTM to predict the next token given the actor's event
     history so far (teacher forcing, cross-entropy loss).
  3. Anomaly score for each event = "surprisal" = -log P(actual next
     token | history). A predictable actor produces low-surprisal
     sequences; an actor doing something it's never done before (wrong
     order, unusual gap, unusual action) produces high surprisal.
  4. Aggregate surprisal per actor-day (mean + max) for eval against the
     synthetic `label` column, and for combining with Isolation Forest
     features later.

Usage:
    python lstm_sequence_model.py --in synthetic_audit_log.csv --out lstm_scored_actor_days.csv
"""

import argparse
from collections import defaultdict

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.metrics import average_precision_score, classification_report

START_TOKEN = "<START>"
UNK_TOKEN = "<UNK>"

# Time-since-last-event buckets. Folding time into the token vocabulary
# (rather than feeding it as a separate scalar) means the model's
# next-token distribution is directly sensitive to "this actor never
# does X this fast" or "...this actor never goes quiet this long".
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


def build_actor_sequences(df: pd.DataFrame):
    """Returns {actorID: [(token, date, label), ...]} in chronological order.

    Tokens are prefixed with actorRole (doctor/org_actor/patient/etc.) so
    the model's next-token distribution is conditioned on role -- e.g.
    "unusual for a pharmacy actor" vs "unusual for a doctor" -- rather
    than one global, role-blind "typical sequence for anyone" model. This
    is NOT full per-actor identity conditioning (that would need a
    separate embedding keyed by actorID, a bigger change with only ~291
    actors' worth of data to spread across it) -- just the ~4-5 role
    categories already present in every event via actorRole, which is
    denser and far cheaper to add. See AI_MODEL_ROADMAP.md for why full
    per-actor embedding is still deferred.
    """
    df = df.sort_values(["actorID", "timestamp"])
    has_label = "label" in df.columns
    sequences = defaultdict(list)
    for actor_id, group in df.groupby("actorID"):
        prev_ts = None
        actor_role = group["actorRole"].iloc[0]
        for _, row in group.iterrows():
            gap = None if prev_ts is None else (row["timestamp"] - prev_ts).total_seconds()
            token = f"{actor_role}|{row['action']}|{row['resourceType']}|{delta_bucket(gap)}"
            label = row["label"] if has_label else "unknown"
            sequences[actor_id].append((token, row["timestamp"].date(), label))
            prev_ts = row["timestamp"]
    return sequences


def build_vocab(sequences):
    tokens = {START_TOKEN, UNK_TOKEN}
    for seq in sequences.values():
        for token, _, _ in seq:
            tokens.add(token)
    vocab = sorted(tokens)
    return {tok: i for i, tok in enumerate(vocab)}


class NextEventLSTM(nn.Module):
    def __init__(self, vocab_size, embed_dim=16, hidden_dim=32):
        super().__init__()
        self.embed = nn.Embedding(vocab_size, embed_dim)
        self.lstm = nn.LSTM(embed_dim, hidden_dim, batch_first=True)
        self.out = nn.Linear(hidden_dim, vocab_size)

    def forward(self, token_ids):
        # token_ids: (1, seq_len)
        x = self.embed(token_ids)
        h, _ = self.lstm(x)
        return self.out(h)  # (1, seq_len, vocab_size)

def compute_holdout_loss(model, sequences, cutoffs, token_to_id):
    """Avg CE loss on each actor's held-out (post-cutoff) events only, no grad
    update. Returns None (not 0.0) when there's no genuine held-out data at
    all (e.g. train_frac=1.0) -- 0.0 would look like a perfect score to the
    early-stopping logic below and trigger stopping after 1 epoch, loading a
    badly undertrained checkpoint. Caller must check for None."""
    start_id = token_to_id[START_TOKEN]
    loss_fn = nn.CrossEntropyLoss(reduction="sum")
    total_loss, total_events = 0.0, 0
    with torch.no_grad():
        for actor_id, seq in sequences.items():
            cutoff = cutoffs.get(actor_id, len(seq))
            if cutoff >= len(seq):
                continue
            tokens = [t for t, _, _ in seq]
            ids = [start_id] + [token_to_id[t] for t in tokens]
            input_ids = torch.tensor([ids[:-1]], dtype=torch.long)
            target_ids = torch.tensor(ids[1:], dtype=torch.long)
            logits = model(input_ids).squeeze(0)
            ho_logits, ho_targets = logits[cutoff:], target_ids[cutoff:]
            if len(ho_targets) == 0:
                continue
            total_loss += loss_fn(ho_logits, ho_targets).item()
            total_events += len(ho_targets)
    if total_events == 0:
        return None
    return total_loss / total_events

def train(model, train_sequences, token_to_id, epochs=25, lr=1e-2,
          full_sequences=None, cutoffs=None, patience=5, checkpoint_path="lstm_best.pt"):
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    loss_fn = nn.CrossEntropyLoss()
    start_id = token_to_id[START_TOKEN]

    loss_history, val_loss_history = [], []
    best_val_loss, best_epoch, patience_counter = float("inf"), 0, 0
    actor_ids = [a for a, s in train_sequences.items() if len(s) >= 2]

    for epoch in range(epochs):
        total_loss, n_batches = 0.0, 0
        for actor_id in actor_ids:
            tokens = [t for t, _, _ in train_sequences[actor_id]]
            ids = [start_id] + [token_to_id[t] for t in tokens]
            input_ids = torch.tensor([ids[:-1]], dtype=torch.long)
            target_ids = torch.tensor([ids[1:]], dtype=torch.long)
            opt.zero_grad()
            logits = model(input_ids)
            loss = loss_fn(logits.squeeze(0), target_ids.squeeze(0))
            loss.backward()
            opt.step()
            total_loss += loss.item()
            n_batches += 1
        avg_loss = total_loss / n_batches
        loss_history.append(avg_loss)

        if full_sequences is not None and cutoffs is not None:
            val_loss = compute_holdout_loss(model, full_sequences, cutoffs, token_to_id)
            if val_loss is None:
                # No genuine held-out data (e.g. train_frac=1.0, a real
                # production retrain, not a benchmarking run) -- fall back to
                # training-loss-based checkpointing instead of misreading a
                # degenerate always-0.0 "held-out loss" as instant convergence.
                val_loss_history.append(None)
                print(f"  epoch {epoch+1}/{epochs} — train {avg_loss:.3f} "
                      f"(no held-out data -- using train loss for checkpointing)")
                if avg_loss < best_val_loss:
                    best_val_loss, best_epoch, patience_counter = avg_loss, epoch + 1, 0
                    torch.save(model.state_dict(), checkpoint_path)
                else:
                    patience_counter += 1
                    if patience_counter >= patience:
                        print(f"  Early stopping at epoch {epoch+1} (best train loss "
                              f"{best_val_loss:.3f} at epoch {best_epoch})")
                        break
                continue
            val_loss_history.append(val_loss)
            print(f"  epoch {epoch+1}/{epochs} — train {avg_loss:.3f}, held-out {val_loss:.3f}")
            if val_loss < best_val_loss:
                best_val_loss, best_epoch, patience_counter = val_loss, epoch + 1, 0
                torch.save(model.state_dict(), checkpoint_path)
            else:
                patience_counter += 1
                if patience_counter >= patience:
                    print(f"  Early stopping at epoch {epoch+1} (best held-out loss "
                          f"{best_val_loss:.3f} at epoch {best_epoch})")
                    break
        else:
            print(f"  epoch {epoch+1}/{epochs} — avg loss {avg_loss:.3f}")

    return loss_history, val_loss_history, best_epoch


@torch.no_grad()
def score_sequences_fixed_vocab(model, sequences, token_to_id):
    """Like score_sequences, but for a model+vocab that are ALREADY
    fitted/built (score mode) -- maps any token not seen during training
    to UNK_TOKEN instead of raising KeyError."""
    start_id = token_to_id[START_TOKEN]
    unk_id = token_to_id[UNK_TOKEN]
    rows = []
    for actor_id, seq in sequences.items():
        if len(seq) == 0:
            continue
        tokens = [t for t, _, _ in seq]
        ids = [start_id] + [token_to_id.get(t, unk_id) for t in tokens]
        input_ids = torch.tensor([ids[:-1]], dtype=torch.long)
        target_ids = torch.tensor(ids[1:], dtype=torch.long)

        logits = model(input_ids).squeeze(0)
        log_probs = torch.log_softmax(logits, dim=-1)
        surprisal = -log_probs[torch.arange(len(target_ids)), target_ids]

        for (token, date, label), s in zip(seq, surprisal.tolist()):
            rows.append({"actorID": actor_id, "date": date, "token": token,
                         "surprisal": s, "label": label})
    return pd.DataFrame(rows)


def save_lstm_artifacts(model, token_to_id, embed_dim, hidden_dim, global_mean, global_std,
                         lstm_threshold, path):
    torch.save({
        "model_state": model.state_dict(),
        "token_to_id": token_to_id,
        "embed_dim": embed_dim,
        "hidden_dim": hidden_dim,
        "global_mean": global_mean,
        "global_std": global_std,
        "lstm_threshold": lstm_threshold,
    }, path)


def load_lstm_artifacts(path):
    return torch.load(path, weights_only=False)


def score_new(df: pd.DataFrame, artifacts: dict, burn_in: int = 5, report_since=None) -> pd.DataFrame:
    """Score NEW data with an ALREADY-TRAINED model -- no training, no
    train/holdout split. z-scores against the GLOBAL surprisal baseline
    from training (not a per-actor baseline recomputed from this tiny
    live batch, which would be too noisy to mean anything).

    report_since (optional date/datetime/ISO string): if given, `df` is
    expected to include EXTRA history before this cutoff purely as
    autoregressive CONTEXT -- scored normally (so later events get correct
    history) but excluded from the returned rows. This is what lets the
    live worker pull e.g. 14 days of lookback for context while only
    creating flags for the actual new scan window: burn_in (dropping each
    actor's first few events) now mostly lands inside the CONTEXT portion
    instead of eating into the window we actually report on. Still not
    full persistent hidden state across runs (see module docstring) -- an
    actor quiet longer than the lookback window still hits a cold start --
    but meaningfully better than scoring the new window in isolation.
    """
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    sequences = build_actor_sequences(df)

    model = NextEventLSTM(vocab_size=len(artifacts["token_to_id"]),
                           embed_dim=artifacts["embed_dim"], hidden_dim=artifacts["hidden_dim"])
    model.load_state_dict(artifacts["model_state"])
    model.eval()

    empty_cols = ["actorID", "date", "mean_surprisal", "max_surprisal",
                  "mean_z_surprisal", "max_z_surprisal", "n_events", "label"]

    event_scores = score_sequences_fixed_vocab(model, sequences, artifacts["token_to_id"])
    if event_scores.empty:
        return pd.DataFrame(columns=empty_cols)

    event_scores["event_idx"] = event_scores.groupby("actorID").cumcount()
    event_scores = event_scores[event_scores["event_idx"] >= burn_in]
    if event_scores.empty:
        return pd.DataFrame(columns=empty_cols)

    event_scores["z_surprisal"] = (event_scores["surprisal"] - artifacts["global_mean"]) / artifacts["global_std"]

    agg = event_scores.groupby(["actorID", "date"]).agg(
        mean_surprisal=("surprisal", "mean"),
        max_surprisal=("surprisal", "max"),
        mean_z_surprisal=("z_surprisal", "mean"),
        max_z_surprisal=("z_surprisal", "max"),
        n_events=("surprisal", "size"),
        label=("label", lambda s: "anomalous" if (s == "anomalous").any() else "normal"),
    ).reset_index()

    if report_since is not None:
        cutoff_date = pd.to_datetime(report_since).date()
        agg = agg[pd.to_datetime(agg["date"]).dt.date >= cutoff_date].reset_index(drop=True)
    return agg


def split_train_holdout(sequences, train_frac=0.8):
    """Chronological per-actor split: train on the first train_frac of each
    actor's events, hold out the rest for scoring only. Returns
    (train_sequences, cutoffs) where cutoffs[actor] is the index at which
    that actor's held-out portion begins.

    This exists because the original version trained (backprop) and
    scored on the exact same events -- a model can partially learn to
    predict anomalous transitions it was shown during training, which
    suppresses surprisal exactly where high surprisal is the signal being
    measured. Scoring still runs over each actor's FULL sequence (see
    score_sequences in main()) so the autoregressive context stays
    correct; only the metrics reported for the held-out portion are safe
    from this leakage.
    """
    train_sequences = {}
    cutoffs = {}
    for actor_id, seq in sequences.items():
        cutoff = max(1, int(len(seq) * train_frac))
        train_sequences[actor_id] = seq[:cutoff]
        cutoffs[actor_id] = cutoff
    return train_sequences, cutoffs


@torch.no_grad()
def score_sequences(model, sequences, token_to_id):
    """Returns per-event surprisal, keyed by (actorID, index in that actor's sequence)."""
    start_id = token_to_id[START_TOKEN]
    rows = []
    for actor_id, seq in sequences.items():
        if len(seq) == 0:
            continue
        tokens = [t for t, _, _ in seq]
        ids = [start_id] + [token_to_id[t] for t in tokens]
        input_ids = torch.tensor([ids[:-1]], dtype=torch.long)
        target_ids = torch.tensor(ids[1:], dtype=torch.long)

        logits = model(input_ids).squeeze(0)  # (seq_len, vocab_size)
        log_probs = torch.log_softmax(logits, dim=-1)
        surprisal = -log_probs[torch.arange(len(target_ids)), target_ids]  # (seq_len,)

        for (token, date, label), s in zip(seq, surprisal.tolist()):
            rows.append({"actorID": actor_id, "date": date, "token": token,
                         "surprisal": s, "label": label})
    return pd.DataFrame(rows)


def aggregate_by_actor_day(event_scores: pd.DataFrame, burn_in: int = 5) -> pd.DataFrame:
    """burn_in: drop each actor's first N events before aggregating. Those
    events are scored against a near-empty history (right after <START>),
    so they're inherently high-surprisal regardless of whether they're
    actually anomalous — including them just adds noise concentrated on
    day 1 for every actor.

    Also z-scores surprisal PER ACTOR before aggregating: a doctor's
    baseline event diversity is naturally higher-entropy than a patient's,
    so comparing raw surprisal across actor types buries the signal.
    Ranking by how unusual a day is FOR THAT ACTOR is the meaningful
    comparison.

    If event_scores has a "held_out" column (see split_train_holdout /
    main()), it's propagated as "any events in this actor-day were held
    out of training" -- use this to filter to leakage-free rows before
    reporting metrics.
    """
    event_scores = event_scores.copy()
    event_scores["event_idx"] = event_scores.groupby("actorID").cumcount()
    event_scores = event_scores[event_scores["event_idx"] >= burn_in]

    actor_stats = event_scores.groupby("actorID")["surprisal"].agg(["mean", "std"]).rename(
        columns={"mean": "actor_mean", "std": "actor_std"})
    actor_stats["actor_std"] = actor_stats["actor_std"].replace(0, np.nan).fillna(1e-6)
    event_scores = event_scores.merge(actor_stats, on="actorID", how="left")
    event_scores["z_surprisal"] = (event_scores["surprisal"] - event_scores["actor_mean"]) / event_scores["actor_std"]

    agg_kwargs = dict(
        mean_surprisal=("surprisal", "mean"),
        max_surprisal=("surprisal", "max"),
        mean_z_surprisal=("z_surprisal", "mean"),
        max_z_surprisal=("z_surprisal", "max"),
        p75_z_surprisal=("z_surprisal", lambda s: np.percentile(s, 75)),
        p90_z_surprisal=("z_surprisal", lambda s: np.percentile(s, 90)),
        p95_z_surprisal=("z_surprisal", lambda s: np.percentile(s, 95)),
        n_events=("surprisal", "size"),
        label=("label", lambda s: "anomalous" if (s == "anomalous").any() else "normal"),
    )
    if "held_out" in event_scores.columns:
        agg_kwargs["held_out"] = ("held_out", "any")

    agg = event_scores.groupby(["actorID", "date"]).agg(**agg_kwargs).reset_index()
    return agg


def evaluate(agg: pd.DataFrame, label_suffix: str = ""):
    y_true = (agg["label"] == "anomalous").astype(int)
    for score_col in ["mean_surprisal", "max_surprisal", "mean_z_surprisal", "max_z_surprisal",
                       "p75_z_surprisal", "p90_z_surprisal", "p95_z_surprisal"]:        
        ap = average_precision_score(y_true, agg[score_col])
        print(f"\n=== {score_col}{label_suffix} — average precision: {ap:.3f} ===")
        threshold = agg[score_col].quantile(0.95)  # flag top 5% as a simple demo cutoff
        y_pred = (agg[score_col] >= threshold).astype(int)
        print(classification_report(y_true, y_pred, target_names=["normal", "anomalous"], zero_division=0))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in", dest="infile", default="synthetic_audit_log.csv")
    parser.add_argument("--out", default="lstm_scored_actor_days.csv")
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--top-n", type=int, default=10)
    parser.add_argument("--loss-out", default=None,
                         help="optional path to write per-epoch avg loss as CSV (epoch,avg_loss)")
    parser.add_argument("--train-frac", type=float, default=0.8,
                         help="fraction of each actor's chronological sequence used for training; "
                              "the rest is scored but never trained on, to avoid the model "
                              "partially learning to predict anomalies it was shown in training")
    parser.add_argument("--patience", type=int, default=5)
    parser.add_argument("--checkpoint", default="lstm_best.pt")
    parser.add_argument("--embed-dim", type=int, default=16)
    parser.add_argument("--hidden-dim", type=int, default=32)
    parser.add_argument("--mode", choices=["train", "score"], default="train",
                         help="train: fit fresh on --in (batch job, needs a large historical window, "
                              "see retrain_pipeline.sh). score: load --model-in, score --in with NO "
                              "training and a FIXED vocab/threshold (what the live worker should call).")
    parser.add_argument("--model-out", default="lstm_model.pt",
                         help="[train mode] where to save the trained model+vocab+threshold")
    parser.add_argument("--model-in", default="lstm_model.pt",
                         help="[score mode] trained artifact to load")
    parser.add_argument("--lstm-percentile", type=float, default=0.99,
                         help="[train mode] percentile of max_z_surprisal saved as the P2 threshold "
                              "for priority_tagging.py to use in score mode")
    parser.add_argument("--report-since", default=None,
                         help="[score mode] ISO date/datetime. --in may include extra history before "
                              "this cutoff purely as autoregressive CONTEXT (scored normally so later "
                              "events get correct history, but excluded from --out). Lets the live "
                              "worker pull e.g. 14 days of lookback for context while only flagging "
                              "the actual new scan window -- see score_new()'s docstring.")
    args = parser.parse_args()

    df = pd.read_csv(args.infile)

    if args.mode == "score":
        artifacts = load_lstm_artifacts(args.model_in)
        agg = score_new(df, artifacts, report_since=args.report_since)
        agg.to_csv(args.out, index=False)
        print(f"[score mode] Scored {len(agg)} actor-day rows using {args.model_in} -> {args.out}")
        return

    df["timestamp"] = pd.to_datetime(df["timestamp"])

    print("Building per-actor sequences...")
    sequences = build_actor_sequences(df)
    token_to_id = build_vocab(sequences)
    print(f"{len(sequences)} actors, vocab size {len(token_to_id)}")

    train_sequences, cutoffs = split_train_holdout(sequences, train_frac=args.train_frac)
    print(f"Train/holdout split: train_frac={args.train_frac} "
          f"(each actor trains on their first {args.train_frac:.0%} of events chronologically, "
          f"scored on all events, but only held-out events are leakage-free)")
    
    model = NextEventLSTM(vocab_size=len(token_to_id), embed_dim=args.embed_dim, hidden_dim=args.hidden_dim)
    print("Training (unsupervised next-event prediction, no labels used, TRAIN split only)...")
    loss_history, val_loss_history, best_epoch = train(
        model, train_sequences, token_to_id, epochs=args.epochs,
        full_sequences=sequences, cutoffs=cutoffs, patience=args.patience,
        checkpoint_path=args.checkpoint)

    if val_loss_history:
        model.load_state_dict(torch.load(args.checkpoint))
        real_val_losses = [v for v in val_loss_history if v is not None]
        if real_val_losses:
            print(f"Loaded best checkpoint: epoch {best_epoch}, held-out loss {min(real_val_losses):.3f}")
        else:
            print(f"Loaded best checkpoint: epoch {best_epoch} (selected by training loss -- "
                  f"no held-out data was available, see train() docstring)")

    if args.loss_out:
        pd.DataFrame({"epoch": range(1, len(loss_history) + 1), "avg_loss": loss_history}) \
            .to_csv(args.loss_out, index=False)
        print(f"Wrote loss history to {args.loss_out}")

    print("\nScoring (full sequences, for correct autoregressive context)...")
    event_scores = score_sequences(model, sequences, token_to_id)
    event_scores["event_idx"] = event_scores.groupby("actorID").cumcount()
    event_scores["cutoff"] = event_scores["actorID"].map(cutoffs)
    event_scores["held_out"] = event_scores["event_idx"] >= event_scores["cutoff"]

    agg = aggregate_by_actor_day(event_scores)

    print("\n" + "=" * 70)
    print("METRICS INCLUDING TRAINING DATA (may be optimistic -- see held-out below)")
    print("=" * 70)
    evaluate(agg, label_suffix=" [ALL, includes train-period days]")

    holdout_agg = agg[agg["held_out"]]
    print("\n" + "=" * 70)
    print(f"METRICS ON HELD-OUT DATA ONLY (leakage-free, n={len(holdout_agg)} actor-days) "
          f"-- THIS is the number to report")
    print("=" * 70)
    if len(holdout_agg) == 0 or (holdout_agg["label"] == "anomalous").sum() == 0:
        print("No held-out anomalous actor-days to evaluate -- try a lower --train-frac.")
    else:
        evaluate(holdout_agg, label_suffix=" [HELD-OUT, leakage-free]")

    top = agg.sort_values("max_z_surprisal", ascending=False).head(args.top_n)
    print(f"\n=== Top {args.top_n} highest-surprisal actor-day windows (by max_z_surprisal) ===")
    print(top.to_string(index=False))

    agg.sort_values("max_z_surprisal", ascending=False).to_csv(args.out, index=False)
    print(f"\nWrote {len(agg)} actor-day rows to {args.out}")

    burn_in_filtered = event_scores[event_scores["event_idx"] >= 5]
    global_mean = float(burn_in_filtered["surprisal"].mean())
    global_std = float(burn_in_filtered["surprisal"].std()) or 1e-6
    lstm_threshold = float(agg["max_z_surprisal"].quantile(args.lstm_percentile))
    save_lstm_artifacts(model, token_to_id, args.embed_dim, args.hidden_dim,
                        global_mean, global_std, lstm_threshold, args.model_out)
    print(f"[train mode] Saved trained model + P2 threshold ({lstm_threshold:.4f} "
          f"@ p{args.lstm_percentile*100:.0f}) to {args.model_out}")


if __name__ == "__main__":
    main()
