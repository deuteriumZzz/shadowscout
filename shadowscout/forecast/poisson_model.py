"""Independent Poisson goal-rate model — a cheap statistical second opinion
that never touches the LLM, so a stated model_probability isn't graded
solely by the same system that produced it. Needs API_FOOTBALL_KEY, same as
football_data.py's other enrichers; returns None when unavailable so callers
can just skip the cross-check.

ponytail: expected goals are a straight blend of team_a's home scoring rate
with team_b's away conceding rate (and vice versa) — no league-average
attack/defense normalization (Dixon-Coles style). Good enough as a rough
second opinion; upgrade to normalized attack/defense indices if this baseline
proves too crude against realized results.
"""

from __future__ import annotations

import math

from shadowscout.feeds import football_data

MAX_GOALS = 8  # truncate the Poisson grid here; P(goals > 8) is negligible for football


def _pmf(k: int, lam: float) -> float:
    return math.exp(-lam) * lam ** k / math.factorial(k)


def _grid_probabilities(lam_home: float, lam_away: float, total_point: float = 2.5) -> dict:
    """The actual Poisson-grid math, factored out from match_probabilities()
    so backtest.py can run it directly against historical (lam_home,
    lam_away) pairs without re-fetching live data through this module."""
    home = draw = away = over = 0.0
    for h in range(MAX_GOALS + 1):
        for a in range(MAX_GOALS + 1):
            p = _pmf(h, lam_home) * _pmf(a, lam_away)
            if h > a:
                home += p
            elif h == a:
                draw += p
            else:
                away += p
            if h + a > total_point:
                over += p

    # the (MAX_GOALS+1)x(MAX_GOALS+1) grid doesn't capture the full Poisson
    # tail — normalize by its actual total mass rather than assuming it's 1
    total_mass = home + draw + away
    return {
        "h2h": {"home": home / total_mass, "draw": draw / total_mass, "away": away / total_mass},
        "totals": {"over": over / total_mass, "under": (total_mass - over) / total_mass},
    }


def match_probabilities(
    team_a_id: int, team_b_id: int, api_key: str, total_point: float = 2.5
) -> dict | None:
    """team_a is treated as the home side. Returns
    {"h2h": {"home","draw","away"}, "totals": {"over","under"}, "expected_goals": {"home","away"}}
    or None if there isn't enough fixture history to split scoring by venue."""
    rates_a = football_data.goal_rates(team_a_id, api_key)
    rates_b = football_data.goal_rates(team_b_id, api_key)
    if not rates_a or not rates_b:
        return None

    lam_home = (rates_a["home_scored_avg"] + rates_b["away_conceded_avg"]) / 2
    lam_away = (rates_b["away_scored_avg"] + rates_a["home_conceded_avg"]) / 2

    result = _grid_probabilities(lam_home, lam_away, total_point)
    result["expected_goals"] = {"home": lam_home, "away": lam_away}
    return result


def demo():
    """Self-check: not an accuracy test (no real data here), just confirms
    the math stays internally consistent and responds the right direction to
    a lopsided input before this is trusted as a cross-check signal."""
    import unittest.mock as mock

    fake_rates = {
        111: {"home_scored_avg": 2.4, "home_conceded_avg": 0.6, "away_scored_avg": 1.6, "away_conceded_avg": 1.0},
        222: {"home_scored_avg": 1.0, "home_conceded_avg": 1.8, "away_scored_avg": 0.6, "away_conceded_avg": 2.2},
    }
    with mock.patch.object(football_data, "goal_rates", side_effect=lambda tid, key, last=10: fake_rates[tid]):
        result = match_probabilities(111, 222, "fake_key")

    assert result is not None
    total = sum(result["h2h"].values())
    assert abs(total - 1.0) < 1e-6, f"h2h probs should sum to 1, got {total}"
    assert result["h2h"]["home"] > result["h2h"]["away"], "strong home attack vs weak away defense should favor home"
    assert 0 < result["totals"]["over"] < 1

    with mock.patch.object(football_data, "goal_rates", return_value=None):
        assert match_probabilities(111, 222, "fake_key") is None

    print("poisson_model.py self-check OK:", result)


if __name__ == "__main__":
    demo()
