"""Platt-scaling recalibration of the LLM's raw model_probability against
actual results. storage.stats() already measures whether the raw number is
calibrated (Brier score / log-loss) — this module is the other half: once
enough settled/tracked picks exist, a systematic bias (e.g. always ~10pp
overconfident) gets corrected with a simple 1D logistic fit instead of
trusting the raw number forever.

Pure-Python gradient descent — a few dozen to a few hundred data points
doesn't need numpy/sklearn for a 2-parameter fit.
"""

from __future__ import annotations

import math

import storage

# Below this many (model_probability, result) pairs, a fitted correction is
# more likely to overfit noise than capture a real bias — skip recalibrating.
MIN_SAMPLE_FOR_CALIBRATION = 50


def _logit(p: float, eps: float = 1e-6) -> float:
    p = min(max(p, eps), 1 - eps)
    return math.log(p / (1 - p))


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def fit(rows: list[tuple[float, int]], lr: float = 0.1, epochs: int = 500) -> tuple[float, float]:
    """rows: (raw_probability, outcome 0/1) pairs. Returns (a, b) such that
    calibrated = sigmoid(a * logit(raw) + b), fit by gradient descent on
    log-loss. a=1, b=0 is the identity (no correction)."""
    a, b = 1.0, 0.0
    n = len(rows)
    xs = [_logit(p) for p, _ in rows]
    ys = [y for _, y in rows]
    for _ in range(epochs):
        grad_a = grad_b = 0.0
        for x, y in zip(xs, ys):
            err = _sigmoid(a * x + b) - y
            grad_a += err * x
            grad_b += err
        a -= lr * grad_a / n
        b -= lr * grad_b / n
    return a, b


def apply(raw_probability: float, params: tuple[float, float]) -> float:
    a, b = params
    return _sigmoid(a * _logit(raw_probability) + b)


def fit_from_storage(league: str | None = None) -> tuple[float, float] | None:
    """Fits Platt-scaling params from every outcome of every scored forecast,
    not just the ones that became picks: picks are selected for looking good,
    so fitting on them alone would learn a biased correction. Returns None below
    MIN_SAMPLE_FOR_CALIBRATION (analysis.py then uses the raw probability)."""
    rows = storage.forecast_outcomes(league)
    if len(rows) < MIN_SAMPLE_FOR_CALIBRATION:
        return None
    return fit([(r["model"], r["won"]) for r in rows])


def demo():
    """Self-check on synthetic data: a raw probability that's consistently
    ~15pp overconfident should get pulled back down after fitting; raw
    probabilities that are already well-calibrated should come back roughly
    unchanged."""
    import random

    rng = random.Random(42)

    # overconfident: true win probability is raw - 0.15 (clamped)
    overconfident_rows = []
    for _ in range(300):
        raw = rng.uniform(0.3, 0.9)
        true_p = max(0.02, min(0.98, raw - 0.15))
        outcome = 1 if rng.random() < true_p else 0
        overconfident_rows.append((raw, outcome))

    params = fit(overconfident_rows)
    calibrated_high = apply(0.8, params)
    assert calibrated_high < 0.8, f"should correct overconfidence downward, got {calibrated_high}"
    print(f"overconfident fit: params={params}, apply(0.8)={calibrated_high:.3f} (raw 0.8 -> corrected down)")

    # well-calibrated: true probability equals the raw number
    calibrated_rows = []
    for _ in range(300):
        raw = rng.uniform(0.3, 0.9)
        outcome = 1 if rng.random() < raw else 0
        calibrated_rows.append((raw, outcome))

    params2 = fit(calibrated_rows)
    calibrated_mid = apply(0.7, params2)
    assert abs(calibrated_mid - 0.7) < 0.08, f"well-calibrated input shouldn't move much, got {calibrated_mid}"
    print(f"well-calibrated fit: params={params2}, apply(0.7)={calibrated_mid:.3f} (should stay near 0.7)")

    print("calibration.py self-check OK")


if __name__ == "__main__":
    demo()
