"""Independent xG-based cross-check via Understat.com's team match feed —
same Poisson-grid math as poisson_model.py, but expected goals come from
shot-quality (xG) instead of realized scoring/conceding, so it isn't
fooled by finishing variance the goals-based model can't see.

Understat has no official API or published ToS for this endpoint (found by
inspecting its team page's own AJAX call — https://understat.com/getTeamData/
<team>/<season>) and no team-name search, so this needs API_FOOTBALL_KEY too,
purely to resolve whatever name the user typed to Understat's own English
team title. Treat every failure — network, 404, a team Understat doesn't
cover, a site restructure — as "skip this cross-check", the same contract
poisson_model.py already has, never as an error to surface to the user.
Understat only covers the top-5 European leagues plus the RPL, so this
returns None for everything else (Ligue 1's smaller clubs, most of the
Champions League's non-top-5 sides, etc.) — that's expected, not a bug.
"""

from __future__ import annotations

from datetime import datetime, timezone

import requests

import football_data
from poisson_model import _grid_probabilities

BASE_URL = "https://understat.com"
_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)


def _current_season() -> int:
    """Understat/API-Football convention: the year a season started (e.g.
    2025 for the 2025/26 season). European club seasons start in July/August."""
    now = datetime.now(timezone.utc)
    return now.year if now.month >= 7 else now.year - 1


def _fetch_matches(team_name: str, season: int) -> list[dict] | None:
    url = f"{BASE_URL}/getTeamData/{team_name}/{season}"
    referer = f"{BASE_URL}/team/{team_name.replace(' ', '_')}/{season}"
    try:
        resp = requests.get(
            url,
            headers={
                "User-Agent": _USER_AGENT,
                "X-Requested-With": "XMLHttpRequest",
                "Referer": referer,
            },
            timeout=15,
        )
    except requests.RequestException:
        return None
    if resp.status_code != 200:
        return None
    try:
        return resp.json().get("dates", [])
    except ValueError:
        return None


def team_xg_rates(name: str, api_football_key: str, last: int = 8) -> dict | None:
    """Average xG created/conceded, split by home/away venue, over a team's
    last `last` finished matches this season — same shape as
    football_data.goal_rates() so the Poisson-grid math can be reused
    unchanged. Returns None if the team can't be resolved to an Understat
    page, Understat has no data for it, or there's too little of its
    season played to split by venue."""
    canonical = football_data.find_team_name(name, api_football_key)
    if not canonical:
        return None

    matches = _fetch_matches(canonical, _current_season())
    if not matches:
        return None

    finished = sorted((m for m in matches if m.get("isResult")), key=lambda m: m["datetime"])
    finished = finished[-last:]

    home_xg = home_xga = away_xg = away_xga = 0.0
    home_games = away_games = 0
    for m in finished:
        try:
            xg_h, xg_a = float(m["xG"]["h"]), float(m["xG"]["a"])
        except (KeyError, TypeError, ValueError):
            continue
        if m.get("side") == "h":
            home_xg += xg_h
            home_xga += xg_a
            home_games += 1
        elif m.get("side") == "a":
            away_xg += xg_a
            away_xga += xg_h
            away_games += 1

    if home_games == 0 or away_games == 0:
        return None
    return {
        "home_xg_avg": home_xg / home_games,
        "home_xga_avg": home_xga / home_games,
        "away_xg_avg": away_xg / away_games,
        "away_xga_avg": away_xga / away_games,
    }


def match_probabilities(
    team_a: str, team_b: str, api_football_key: str, total_point: float = 2.5
) -> dict | None:
    """team_a is treated as the home side. Same return shape as
    poisson_model.match_probabilities() — {"h2h", "totals", "expected_goals"}
    — computed from xG instead of realized goals."""
    rates_a = team_xg_rates(team_a, api_football_key)
    rates_b = team_xg_rates(team_b, api_football_key)
    if not rates_a or not rates_b:
        return None

    lam_home = (rates_a["home_xg_avg"] + rates_b["away_xga_avg"]) / 2
    lam_away = (rates_b["away_xg_avg"] + rates_a["home_xga_avg"]) / 2

    result = _grid_probabilities(lam_home, lam_away, total_point)
    result["expected_goals"] = {"home": lam_home, "away": lam_away}
    return result


def demo():
    """Self-check: confirms the math stays internally consistent and
    responds the right direction to a lopsided xG input — not a live-data
    test (Understat's endpoint is undocumented and could change).

    Patches via sys.modules[__name__] rather than mock.patch("xg_model...."):
    the string form re-imports the module under its real name, which is a
    *second* module object distinct from the one actually running as
    __main__ when this file is executed directly — the patch would land on
    the wrong copy and match_probabilities() would still hit the network."""
    import sys
    import unittest.mock as mock

    this_module = sys.modules[__name__]
    fake_rates = {
        "Strong FC": {"home_xg_avg": 2.2, "home_xga_avg": 0.7, "away_xg_avg": 1.5, "away_xga_avg": 1.1},
        "Weak FC": {"home_xg_avg": 0.9, "home_xga_avg": 1.9, "away_xg_avg": 0.5, "away_xga_avg": 2.3},
    }
    with mock.patch.object(this_module, "team_xg_rates", side_effect=lambda name, key, last=8: fake_rates[name]):
        result = match_probabilities("Strong FC", "Weak FC", "fake_key")

    assert result is not None
    total = sum(result["h2h"].values())
    assert abs(total - 1.0) < 1e-6, f"h2h probs should sum to 1, got {total}"
    assert result["h2h"]["home"] > result["h2h"]["away"], "much stronger xG side should be favored"
    assert 0 < result["totals"]["over"] < 1

    with mock.patch.object(this_module, "team_xg_rates", return_value=None):
        assert match_probabilities("Strong FC", "Weak FC", "fake_key") is None

    print("xg_model.py self-check OK:", result)


if __name__ == "__main__":
    demo()
