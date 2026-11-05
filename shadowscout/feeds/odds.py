"""The Odds API client + de-vig math so the bot compares its own probability
estimate against the market's *fair* (margin-removed) probability, not the
raw odds — that's what keeps it from recommending bets the bookmaker's
overround already eats."""

from __future__ import annotations

import math
import statistics
import time

import requests

BASE_URL = "https://api.the-odds-api.com/v4"

# The Odds API's free tier is 500 requests/month — bookmakers.py calls
# list_events() once per market (h2h, totals) per match, and /league scans
# call it again per fixture, so without caching a single 12-match /league
# scan could burn ~24 calls re-fetching the SAME league odds board. 5 min is
# long enough to cover a whole scan on one cache hit, short enough that
# clv_job/steam_job (which run minutes apart and want fresh prices) barely
# notice it.
EVENTS_CACHE_TTL = 300
_events_cache: dict[tuple, tuple[float, list]] = {}


def list_events(sport_key: str, api_key: str, regions: str = "eu", markets: str = "h2h,totals"):
    cache_key = (sport_key, regions, markets)
    now = time.monotonic()
    cached = _events_cache.get(cache_key)
    if cached and now - cached[0] < EVENTS_CACHE_TTL:
        return cached[1]

    resp = requests.get(
        f"{BASE_URL}/sports/{sport_key}/odds",
        params={"apiKey": api_key, "regions": regions, "markets": markets, "oddsFormat": "decimal"},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    _events_cache[cache_key] = (now, data)
    return data


def find_event(events: list[dict], team_a: str, team_b: str) -> dict | None:
    a, b = team_a.lower(), team_b.lower()
    for ev in events:
        home, away = ev.get("home_team", "").lower(), ev.get("away_team", "").lower()
        names = {home, away}
        if any(a in n or n in a for n in names) and any(b in n or n in b for n in names):
            return ev
    return None


def best_h2h_prices(event: dict) -> dict[str, float] | None:
    """Best (highest) decimal price per outcome across all listed bookmakers."""
    best: dict[str, float] = {}
    for bookmaker in event.get("bookmakers", []):
        for market in bookmaker.get("markets", []):
            if market["key"] != "h2h":
                continue
            for outcome in market["outcomes"]:
                name, price = outcome["name"], outcome["price"]
                if name not in best or price > best[name]:
                    best[name] = price
    return best or None


def best_totals_prices(event: dict, target_point: float = 2.5) -> tuple[dict[str, float], float] | None:
    """Bookmakers quote several O/U lines (1.5, 2.5, 3.5, ...) — this picks
    the one closest to target_point (2.5 is the conventional "main" soccer
    total) and returns its best Over/Under prices plus the point used."""
    by_point: dict[float, dict[str, float]] = {}
    for bookmaker in event.get("bookmakers", []):
        for market in bookmaker.get("markets", []):
            if market["key"] != "totals":
                continue
            for outcome in market["outcomes"]:
                point = outcome.get("point")
                if point is None:
                    continue
                name, price = outcome["name"], outcome["price"]
                bucket = by_point.setdefault(point, {})
                if name not in bucket or price > bucket[name]:
                    bucket[name] = price
    if not by_point:
        return None
    best_point = min(by_point, key=lambda p: abs(p - target_point))
    return by_point[best_point], best_point


def fair_probabilities(prices: dict[str, float]) -> tuple[dict[str, float], float]:
    """Remove the bookmaker overround via the proportional method.

    Returns (fair_probabilities, overround) where overround is the raw
    margin (e.g. 0.06 means the book's implied probabilities sum to 106%).
    """
    implied = {k: 1.0 / v for k, v in prices.items()}
    total = sum(implied.values())
    fair = {k: v / total for k, v in implied.items()}
    overround = total - 1.0
    return fair, overround


def shin_fair_probabilities(prices: dict[str, float]) -> tuple[dict[str, float], float]:
    """De-vig via Shin's (1992) model instead of the proportional method.

    Proportional de-vig spreads the vig evenly by probability. Real books
    load disproportionately more margin onto longshots (the well-documented
    favorite-longshot bias), so proportional de-vig still overstates a
    longshot's true chance and understates a favorite's. Shin's model solves
    for z — the fraction of the book's implied overround attributable to
    that mispricing mechanism — via the closed form
        p_i = (sqrt(z^2 + 4(1-z) pi_i^2 / S) - z) / (2(1-z))
    where pi_i are raw implied probabilities and S = sum(pi_i), choosing z
    so that sum(p_i) = 1. Falls back to the proportional method if no root
    brackets within [0, 0.999] (thin/unusual markets) — verified numerically
    against several realistic market shapes before shipping this.
    """
    pi = {k: 1.0 / v for k, v in prices.items()}
    book_sum = sum(pi.values())

    def probs_for_z(z: float) -> dict[str, float]:
        return {
            k: (math.sqrt(max(z * z + 4 * (1 - z) * v * v / book_sum, 0.0)) - z) / (2 * (1 - z))
            for k, v in pi.items()
        }

    lo, hi = 0.0, 0.999
    f_lo = sum(probs_for_z(lo).values()) - 1.0
    f_hi = sum(probs_for_z(hi).values()) - 1.0
    if f_lo * f_hi > 0:
        # ponytail: no bracketed root — fall back to the always-safe proportional method
        return fair_probabilities(prices)

    for _ in range(60):
        mid = (lo + hi) / 2
        f_mid = sum(probs_for_z(mid).values()) - 1.0
        if f_lo * f_mid <= 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid

    fair = probs_for_z((lo + hi) / 2)
    total = sum(fair.values())
    fair = {k: v / total for k, v in fair.items()}
    overround = book_sum - 1.0
    return fair, overround


def fair_probabilities_market(
    event: dict,
    market_key: str,
    point: float | None = None,
    method: str = "proportional",
    reference_book: str | None = None,
) -> tuple[dict[str, float], float, int, bool] | None:
    """De-vig each bookmaker's own prices separately (never a max-of-market
    composite — see shin_fair_probabilities' docstring for why that biases
    the fair price), then aggregate.

    If `reference_book` is set and present on this event, its own de-vigged
    price is used directly instead of aggregating across books — a
    designated sharp book's own margin is a better fair-price anchor than an
    average of soft books, once you've confirmed that book key is actually
    in your API response (don't guess it).

    Otherwise aggregates via the median fair probability across all books
    offering the market — robust to any single book's stale or outlier
    price without needing to know which book is "sharp".

    Returns (fair, overround, book_count, used_reference_book).
    """
    devig = shin_fair_probabilities if method == "shin" else fair_probabilities

    def _prices_for(bookmaker: dict) -> dict[str, float] | None:
        for market in bookmaker.get("markets", []):
            if market["key"] != market_key:
                continue
            outcomes = market["outcomes"]
            if market_key == "totals":
                outcomes = [o for o in outcomes if o.get("point") == point]
            prices = {o["name"]: o["price"] for o in outcomes}
            if len(prices) >= 2:
                return prices
        return None

    if reference_book:
        for bookmaker in event.get("bookmakers", []):
            if bookmaker.get("key") != reference_book:
                continue
            prices = _prices_for(bookmaker)
            if prices:
                fair, overround = devig(prices)
                return fair, overround, 1, True

    per_book_fair: list[dict[str, float]] = []
    overrounds: list[float] = []
    for bookmaker in event.get("bookmakers", []):
        prices = _prices_for(bookmaker)
        if not prices:
            continue
        fair, overround = devig(prices)
        per_book_fair.append(fair)
        overrounds.append(overround)
    if not per_book_fair:
        return None

    keys = set().union(*per_book_fair)
    median_fair = {k: statistics.median(f[k] for f in per_book_fair if k in f) for k in keys}
    total = sum(median_fair.values())
    median_fair = {k: v / total for k, v in median_fair.items()}
    return median_fair, statistics.median(overrounds), len(per_book_fair), False


def demo():
    """Self-check for the de-vig math — not a full test suite, just enough
    to catch a sign/formula error in the Shin bisection before it silently
    produces bad fair prices."""
    prices = {"home": 1.30, "draw": 5.50, "away": 15.00}
    prop_fair, prop_overround = fair_probabilities(prices)
    assert abs(sum(prop_fair.values()) - 1.0) < 1e-9
    assert prop_overround > 0

    shin_fair, shin_overround = shin_fair_probabilities(prices)
    assert abs(sum(shin_fair.values()) - 1.0) < 1e-6
    # favorite-longshot bias: Shin should shift probability mass from the
    # longshot to the favorite relative to the naive proportional method
    assert shin_fair["home"] > prop_fair["home"], "Shin should raise the favorite's fair probability"
    assert shin_fair["away"] < prop_fair["away"], "Shin should lower the longshot's fair probability"

    print("odds.py self-check OK — proportional:", prop_fair, "shin:", shin_fair)

    # cache check: repeated list_events() calls within the TTL must not hit
    # the network again — this is the whole point of the cache
    import unittest.mock as mock

    _events_cache.clear()
    call_count = 0

    class _FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"fake": "data"}

    def _fake_get(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        return _FakeResponse()

    with mock.patch("requests.get", side_effect=_fake_get):
        list_events("soccer_epl", "fake_key")
        list_events("soccer_epl", "fake_key")
        list_events("soccer_epl", "fake_key")
    assert call_count == 1, f"expected 1 real HTTP call across 3 cached lookups, got {call_count}"

    with mock.patch("requests.get", side_effect=_fake_get):
        list_events("soccer_spain_la_liga", "fake_key")
    assert call_count == 2, "a different sport_key must not hit the same cache entry"

    print("odds.py cache self-check OK")


if __name__ == "__main__":
    demo()
