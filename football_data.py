"""Thin API-Football (api-sports.io) client for recent form + head-to-head.
Optional — analysis.py falls back to Claude's own web search when
API_FOOTBALL_KEY is unset, this just gives more reliable structured numbers
when it's available."""

from __future__ import annotations

import time

import requests

BASE_URL = "https://v3.football.api-sports.io"

# API-Football's free tier is 100 requests/day, and every function here goes
# through this one call site — recent_form/head_to_head/goal_rates for the
# same handful of teams get re-requested across every /match, every fixture
# in a /league scan, and every weekly /digest, so without caching a busy day
# burns quota fast on data that doesn't actually change that often. 6 hours
# is short enough to pick up a team's new result the same day, long enough
# that repeated lookups across a scan or a day of use mostly hit the cache.
_CACHE_TTL = 6 * 3600
_cache: dict[tuple, tuple[float, list]] = {}


def _get(path: str, api_key: str, params: dict):
    cache_key = (path, tuple(sorted(params.items())))
    now = time.monotonic()
    cached = _cache.get(cache_key)
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    resp = requests.get(
        f"{BASE_URL}/{path}",
        headers={"x-apisports-key": api_key},
        params=params,
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json().get("response", [])
    _cache[cache_key] = (now, data)
    return data


def find_team_id(name: str, api_key: str) -> int | None:
    results = _get("teams", api_key, {"search": name})
    return results[0]["team"]["id"] if results else None


def recent_form(team_id: int, api_key: str, last: int = 5) -> list[dict]:
    fixtures = _get("fixtures", api_key, {"team": team_id, "last": last})
    return [
        {
            "date": f["fixture"]["date"][:10],
            "home": f["teams"]["home"]["name"],
            "away": f["teams"]["away"]["name"],
            "score": f"{f['goals']['home']}-{f['goals']['away']}",
        }
        for f in fixtures
    ]


def head_to_head(team_a_id: int, team_b_id: int, api_key: str, last: int = 5) -> list[dict]:
    fixtures = _get("fixtures/headtohead", api_key, {"h2h": f"{team_a_id}-{team_b_id}", "last": last})
    return [
        {
            "date": f["fixture"]["date"][:10],
            "home": f["teams"]["home"]["name"],
            "away": f["teams"]["away"]["name"],
            "score": f"{f['goals']['home']}-{f['goals']['away']}",
        }
        for f in fixtures
    ]


def goal_rates(team_id: int, api_key: str, last: int = 10, before: str | None = None) -> dict | None:
    """Average goals scored/conceded, split by home/away venue, over the
    team's `last` finished fixtures strictly before `before` (ISO date/
    datetime string) if given, else simply the most recent `last`. `before`
    is what makes this safe for walk-forward backtesting (backtest.py) — it
    keeps a historical prediction from being computed using fixtures that
    happened *after* the match being predicted, which would leak the future
    into a supposedly "as of that date" estimate. Returns None if the team
    has no eligible finished home game or no eligible finished away game
    (too little to split by venue)."""
    fetch_last = last * 4 if before else last
    fixtures = _get("fixtures", api_key, {"team": team_id, "last": fetch_last})
    fixtures = sorted(fixtures, key=lambda f: f["fixture"]["date"])
    if before:
        fixtures = [f for f in fixtures if f["fixture"]["date"] < before]
    fixtures = fixtures[-last:]

    home_scored = home_conceded = away_scored = away_conceded = 0
    home_games = away_games = 0
    for f in fixtures:
        gh, ga = f["goals"]["home"], f["goals"]["away"]
        if gh is None or ga is None:
            continue
        if f["teams"]["home"]["id"] == team_id:
            home_scored += gh
            home_conceded += ga
            home_games += 1
        elif f["teams"]["away"]["id"] == team_id:
            away_scored += ga
            away_conceded += gh
            away_games += 1
    if home_games == 0 or away_games == 0:
        return None
    return {
        "home_scored_avg": home_scored / home_games,
        "home_conceded_avg": home_conceded / home_games,
        "away_scored_avg": away_scored / away_games,
        "away_conceded_avg": away_conceded / away_games,
    }


def season_results(team_id: int, season: int, api_key: str) -> list[dict]:
    """Finished fixtures for a team across a full season — raw material for
    backtest.py's walk-forward match list. `season` is the year the season
    started (API-Football convention, e.g. 2024 for 2024/25). Verify the
    "season" query param and "FT" status code against a live key before
    relying on this for a full crawl — not tested against a real key here."""
    fixtures = _get("fixtures", api_key, {"team": team_id, "season": season})
    return [f for f in fixtures if f["fixture"]["status"]["short"] == "FT"]


def demo():
    """Self-check for _get()'s cache — the free API-Football tier is 100
    requests/day, so a caching bug that silently stops caching (or caches
    the wrong thing across different params) would burn quota fast."""
    import unittest.mock as mock

    _cache.clear()
    call_count = 0

    class _FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"response": [{"fake": "data"}]}

    def _fake_get(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        return _FakeResponse()

    with mock.patch("requests.get", side_effect=_fake_get):
        _get("teams", "fake_key", {"search": "Ливерпуль"})
        _get("teams", "fake_key", {"search": "Ливерпуль"})
    assert call_count == 1, f"repeated identical calls should hit the cache, got {call_count} real calls"

    with mock.patch("requests.get", side_effect=_fake_get):
        _get("teams", "fake_key", {"search": "Арсенал"})
    assert call_count == 2, "different params must not share a cache entry"

    with mock.patch("requests.get", side_effect=_fake_get):
        _get("fixtures", "fake_key", {"search": "Ливерпуль"})
    assert call_count == 3, "different endpoint path must not share a cache entry"

    print("football_data.py cache self-check OK")


if __name__ == "__main__":
    demo()
