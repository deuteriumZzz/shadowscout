"""Independent xG-based cross-check via StrikerAPI's per-club season averages.

Same Poisson-grid math as poisson_model.py, but expected goals come from shot
quality instead of realized scoring, so it isn't fooled by finishing variance.
The xG is StrikerAPI's own model, refitted by them from time to time, so a past
value can change later. Any failure (no key, network, an uncovered league or
club) means "skip this cross-check": it's a second opinion, never an error.

One call covers a whole league at 5 credits, from a free allowance of 500 a
month, hence the long cache.
"""

from __future__ import annotations

import logging
import time

import requests

import connections
from espn_data import LEAGUES, league_key, same_team
from poisson_model import _grid_probabilities

log = logging.getLogger("shadowscout.xg")

URL = "https://mcp.strikerapi.com/v1/get_team_stats"
TIMEOUT = 20
CACHE_SECONDS = 24 * 3600  # their match data refreshes once a day
MIN_GAMES = 3

_cache: dict[str, tuple[float, list[dict]]] = {}


def _league_stats(striker_league: str, api_key: str) -> list[dict] | None:
    now = time.monotonic()
    cached = _cache.get(striker_league)
    if cached and now - cached[0] < CACHE_SECONDS:
        return cached[1]
    try:
        response = requests.post(
            URL, json={"league": striker_league}, headers={"x-api-key": api_key}, timeout=TIMEOUT
        )
        response.raise_for_status()
        teams = response.json().get("teams") or []
    except (requests.RequestException, ValueError) as exc:
        # The exception's text is left out: a request's details stay out of the logs.
        log.warning("StrikerAPI failed: %s", type(exc).__name__)
        return None
    _cache[striker_league] = (now, teams)
    return teams


def _team(teams: list[dict], name: str) -> dict | None:
    found = [t for t in teams if same_team(str(t.get("display_name", "")), name)]
    if len(found) != 1:
        return None
    team = found[0]
    usable = (team.get("games") or 0) >= MIN_GAMES and team.get("xg_for") is not None and team.get("xg_against") is not None
    return team if usable else None


def match_probabilities(home: str, away: str, league_hint: str | None, total_point: float = 2.5) -> dict | None:
    """Same return shape as poisson_model.match_probabilities(), plus "text" for the prompt."""
    api_key = connections.get_key("striker")
    key = league_key(league_hint)
    striker_league = LEAGUES[key]["striker"] if key else None
    if not (api_key and striker_league):
        return None
    teams = _league_stats(striker_league, api_key)
    if not teams:
        return None
    a, b = _team(teams, home), _team(teams, away)
    if not (a and b):
        return None

    # ponytail: season averages, not split by venue, so no home advantage. Their match-level
    # data could split it, at 5+ credits per game; add if the free allowance turns out to allow.
    lam_home = (a["xg_for"] + b["xg_against"]) / 2
    lam_away = (b["xg_for"] + a["xg_against"]) / 2
    result = _grid_probabilities(lam_home, lam_away, total_point)
    result["expected_goals"] = {"home": lam_home, "away": lam_away}
    result["text"] = (
        f"[StrikerAPI] {home}: xG per game {a['xg_for']:.2f} for, {a['xg_against']:.2f} against, {a['games']} games\n"
        f"[StrikerAPI] {away}: xG per game {b['xg_for']:.2f} for, {b['xg_against']:.2f} against, {b['games']} games"
    )
    return result
