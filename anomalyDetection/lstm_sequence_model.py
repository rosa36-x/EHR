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
  1. Each event -> a token combining (action, resourceType, time-since-
     last-event-bucket). Time delta is folded INTO the token specifically
     so the model is sensitive to unusual gaps, not just unusual actions.
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
    """Returns {actorID: [(token, date, label), ...]} in chronological order."""
    df = df.sort_values(["actorID", "timestamp"])
    sequences = defaultdict(list)
    for actor_id, group in df.groupby("actorID"):
        prev_ts = None
        for _, row in group.iterrows():
            gap = None if prev_ts is None else (row["timestamp"] - prev_ts).total_seconds()
            token = f"{row['action']}|{row['resourceType']}|{delta_bucket(gap)}"
            sequences[actor_id].append((token, row["timestamp"].date(), row["label"]))
            prev_ts = row["timestamp"]
    return sequences


def build_vocab(sequences):
    tokens = {START_TOKEN}
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


def train(model, sequences, token_to_id, epochs=8, lr=1e-2):
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    loss_fn = nn.CrossEntropyLoss()
    start_id = token_to_id[START_TOKEN]

    actor_ids = [a for a, s in sequences.items() if len(s) >= 2]
    for epoch in range(epochs):
        total_loss, n_batches = 0.0, 0
        for actor_id in actor_ids:
            tokens = [t for t, _, _ in sequences[actor_id]]
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
        print(f"  epoch {epoch+1}/{epochs} — avg loss {total_loss / n_batches:.3f}")


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
    """
    event_scores = event_scores.copy()
    event_scores["event_idx"] = event_scores.groupby("actorID").cumcount()
    event_scores = event_scores[event_scores["event_idx"] >= burn_in]

    actor_stats = event_scores.groupby("actorID")["surprisal"].agg(["mean", "std"]).rename(
        columns={"mean": "actor_mean", "std": "actor_std"})
    actor_stats["actor_std"] = actor_stats["actor_std"].replace(0, np.nan).fillna(1e-6)
    event_scores = event_scores.merge(actor_stats, on="actorID", how="left")
    event_scores["z_surprisal"] = (event_scores["surprisal"] - event_scores["actor_mean"]) / event_scores["actor_std"]

    agg = event_scores.groupby(["actorID", "date"]).agg(
        mean_surprisal=("surprisal", "mean"),
        max_surprisal=("surprisal", "max"),
        mean_z_surprisal=("z_surprisal", "mean"),
        max_z_surprisal=("z_surprisal", "max"),
        n_events=("surprisal", "size"),
        label=("label", lambda s: "anomalous" if (s == "anomalous").any() else "normal"),
    ).reset_index()
    return agg


def evaluate(agg: pd.DataFrame):
    y_true = (agg["label"] == "anomalous").astype(int)
    for score_col in ["mean_surprisal", "max_surprisal", "mean_z_surprisal", "max_z_surprisal"]:
        ap = average_precision_score(y_true, agg[score_col])
        print(f"\n=== {score_col} — average precision: {ap:.3f} ===")
        threshold = agg[score_col].quantile(0.95)  # flag top 5% as a simple demo cutoff
        y_pred = (agg[score_col] >= threshold).astype(int)
        print(classification_report(y_true, y_pred, target_names=["normal", "anomalous"], zero_division=0))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in", dest="infile", default="synthetic_audit_log.csv")
    parser.add_argument("--out", default="lstm_scored_actor_days.csv")
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--top-n", type=int, default=10)
    args = parser.parse_args()

    df = pd.read_csv(args.infile)
    df["timestamp"] = pd.to_datetime(df["timestamp"])

    print("Building per-actor sequences...")
    sequences = build_actor_sequences(df)
    token_to_id = build_vocab(sequences)
    print(f"{len(sequences)} actors, vocab size {len(token_to_id)}")

    model = NextEventLSTM(vocab_size=len(token_to_id))
    print("Training (unsupervised next-event prediction, no labels used)...")
    train(model, sequences, token_to_id, epochs=args.epochs)

    print("\nScoring...")
    event_scores = score_sequences(model, sequences, token_to_id)
    agg = aggregate_by_actor_day(event_scores)

    evaluate(agg)

    top = agg.sort_values("max_z_surprisal", ascending=False).head(args.top_n)
    print(f"\n=== Top {args.top_n} highest-surprisal actor-day windows (by max_z_surprisal) ===")
    print(top.to_string(index=False))

    agg.sort_values("max_z_surprisal", ascending=False).to_csv(args.out, index=False)
    print(f"\nWrote {len(agg)} actor-day rows to {args.out}")


if __name__ == "__main__":
    main()
