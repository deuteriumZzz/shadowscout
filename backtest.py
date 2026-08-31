"""Walk-forward backtest of poisson_model.py against real historical
results — the fastest way to find out whether the goal-rate model has any
skill at all before trusting it live, without waiting weeks for CLV/
calibration data to accumulate through actual use.

Only the Poisson model is backtestable this way. The LLM's analysis depends
on a live web search grounded in "now" — there's no way to point it at "as
of last March" and get a faithful historical answer, so its edge can only be
validated forward (CLV, calibration — see storage.py) rather than backward.

You supply the match list (e.g. built from football_data.season_results()
for the teams you care about) rather than this module crawling a whole
league itself — crawling a full league's fixture list needs a "teams in
league X" endpoint this codebase hasn't verified against a live key yet.
"""

from __future__ import annotations

import football_data
import poisson_model

HISTORY_WINDOW = 10  # goal_rates() window used for each backtest prediction


def backtest_matches(
    matches: list[tuple[int, int, str, str]], api_key: str, history_window: int = HISTORY_WINDOW
) -> dict:
    """matches: list of (home_team_id, away_team_id, match_date_iso, actual_result)
    where actual_result is "home"|"draw"|"away". Each prediction uses only
    goal-rate data strictly before that match's date (see football_data.
    goal_rates' `before` param) — no future data leaks into a historical
    prediction. Returns {"n", "brier", "hit_rate"}: n is how many matches had
    enough pre-match history to predict at all (some early-season matches
    won't); brier is the 3-outcome Brier score (0=perfect, 0.667=random
    guessing on 3 outcomes); hit_rate is how often the model's most-likely
    outcome was the actual one."""
    predictions = []
    for home_id, away_id, date, actual in matches:
        rates_home = football_data.goal_rates(home_id, api_key, last=history_window, before=date)
        rates_away = football_data.goal_rates(away_id, api_key, last=history_window, before=date)
        if not rates_home or not rates_away:
            continue
        lam_home = (rates_home["home_scored_avg"] + rates_away["away_conceded_avg"]) / 2
        lam_away = (rates_away["away_scored_avg"] + rates_home["home_conceded_avg"]) / 2
        probs = poisson_model._grid_probabilities(lam_home, lam_away)["h2h"]
        predictions.append((probs, actual))

    if not predictions:
        return {"n": 0, "brier": None, "hit_rate": None}

    n = len(predictions)
    brier_sum = 0.0
    hits = 0
    for probs, actual in predictions:
        for outcome in ("home", "draw", "away"):
            y = 1.0 if outcome == actual else 0.0
            brier_sum += (probs[outcome] - y) ** 2
        if max(probs, key=probs.get) == actual:
            hits += 1

    return {"n": n, "brier": brier_sum / (n * 3), "hit_rate": hits / n}


def demo():
    """Self-check: synthetic fixture history where the model's implied
    favorite should genuinely tend to win more, using a fixed goal_rates
    mock (no live API call) — confirms the walk-forward wiring and the
    Brier/hit-rate aggregation math, not real-world accuracy."""
    import unittest.mock as mock

    # team 1 is a clearly stronger side than team 2 in every synthetic match
    strong = {"home_scored_avg": 2.2, "home_conceded_avg": 0.7, "away_scored_avg": 1.6, "away_conceded_avg": 1.0}
    weak = {"home_scored_avg": 1.0, "home_conceded_avg": 1.8, "away_scored_avg": 0.6, "away_conceded_avg": 2.0}

    def fake_goal_rates(team_id, api_key, last=10, before=None):
        return strong if team_id == 1 else weak

    matches = [
        (1, 2, "2026-01-01", "home"),
        (1, 2, "2026-02-01", "home"),
        (1, 2, "2026-03-01", "draw"),  # model will "miss" this one — keeps brier/hit_rate meaningfully < perfect
        (2, 1, "2026-04-01", "away"),
    ]

    with mock.patch.object(football_data, "goal_rates", side_effect=fake_goal_rates):
        result = backtest_matches(matches, "fake_key")

    assert result["n"] == 4, result
    assert result["hit_rate"] == 0.75, f"expected 3/4 correct, got {result['hit_rate']}"
    assert 0 <= result["brier"] < 0.667, result

    with mock.patch.object(football_data, "goal_rates", return_value=None):
        empty = backtest_matches(matches, "fake_key")
    assert empty == {"n": 0, "brier": None, "hit_rate": None}

    print("backtest.py self-check OK:", result)


if __name__ == "__main__":
    demo()
