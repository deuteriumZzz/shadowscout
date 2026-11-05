"""Football matches and prices from Polymarket's public Gamma API. No key.

The main result (1X2) sits in the event "A vs. B", totals in its sibling
"A vs. B - More Markets". A match with an incomplete result market is dropped
rather than guessed at. The miniapp's polymarket.ts reads the same feed for its
own screens; this one feeds the forecast. Placing orders isn't handled here.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone

import requests

from espn_data import LEAGUES, league_key, same_team

log = logging.getLogger("shadowscout.polymarket")

GAMMA = "https://gamma-api.polymarket.com/events"
TIMEOUT = 15
CACHE_SECONDS = 30
MIN_LIQUIDITY = 1000  # dollars: below this a price says little about the real odds
MAX_SPREAD = 0.05  # a wide bid/ask gap means the mid-price isn't a real consensus
MAIN_LINE = 2.5

_cache: dict[str, tuple[float, list[dict]]] = {}


def odds_after_fee(ask: float, fee_rate: float) -> float:
    """Polymarket's fee is rate × p × (1−p) per share, so a share costs p plus that."""
    return 1 / (ask + fee_rate * ask * (1 - ask))


def _short(name: str) -> str:
    return re.sub(r"\s+(FC|AFC|CF|SC)$", "", name).strip()


def _quote(market: dict) -> dict | None:
    ask, bid = market.get("bestAsk"), market.get("bestBid")
    if not market.get("acceptingOrders") or not ask or not 0 < ask < 1:
        return None
    return {
        "ask": ask,
        "bid": bid if bid and 0 < bid < ask else None,
        "rate": ((market.get("feeSchedule") or {}).get("rate") or 0) if market.get("feesEnabled") else 0,
        "liquidity": market.get("liquidityNum") or 0,
    }


def _result_quotes(event: dict, home_raw: str, away_raw: str) -> dict | None:
    results = [m for m in event.get("markets") or [] if m.get("sportsMarketType") == "moneyline"]
    tests = {
        "home": lambda n: n == home_raw,
        "draw": lambda n: n.startswith("Draw"),
        "away": lambda n: n == away_raw,
    }
    quotes = {}
    for outcome, test in tests.items():
        found = [m for m in results if test(m.get("groupItemTitle") or "")]
        quote = _quote(found[0]) if len(found) == 1 else None
        if not quote:
            return None
        quotes[outcome] = quote
    return quotes


def _totals_quotes(event: dict | None) -> dict | None:
    """Prefer the 2.5 line. The market prices Over; buying Under means taking the other side."""
    lines = [m for m in (event or {}).get("markets") or [] if m.get("sportsMarketType") == "totals" and m.get("line") is not None]
    lines.sort(key=lambda m: abs(float(m["line"]) - MAIN_LINE))
    for market in lines:
        over = _quote(market)
        if over and over["bid"]:
            under = {**over, "ask": round(1 - over["bid"], 6), "bid": round(1 - over["ask"], 6)}
            return {"line": float(market["line"]), "over": over, "under": under}
    return None


def normalize_events(events: list[dict], now: datetime) -> list[dict]:
    extras = {e["title"].split(" - ")[0]: e for e in events if str(e.get("title", "")).endswith("- More Markets")}
    matches = []
    for event in events:
        title = event.get("title") or ""
        start = event.get("startTime")
        if not event.get("slug") or not start or " vs" not in title or " - " in title:
            continue
        if not datetime.fromisoformat(start.replace("Z", "+00:00")) > now:
            continue
        teams = {t.get("ordering"): t for t in event.get("teams") or []}
        home, away = teams.get("home"), teams.get("away")
        if not (home and away and home.get("name") and away.get("name")):
            continue
        quotes = _result_quotes(event, home["name"], away["name"])
        if not quotes:
            continue
        matches.append({
            "home": _short(home["name"]),
            "away": _short(away["name"]),
            "home_logo": home.get("logo"),
            "away_logo": away.get("logo"),
            "start": start,
            "url": f"https://polymarket.com/event/{event['slug']}",
            "h2h": quotes,
            "totals": _totals_quotes(extras.get(title)),
        })
    matches.sort(key=lambda m: m["start"])
    return matches


def list_matches(league_hint: str | None) -> list[dict]:
    key = league_key(league_hint)
    slug = LEAGUES[key]["polymarket"] if key else None
    if not slug:
        return []
    now = datetime.now(timezone.utc)
    cached = _cache.get(slug)
    if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
        return normalize_events(cached[1], now)
    params = {
        "tag_slug": slug, "closed": "false", "active": "true", "limit": 200, "order": "endDate", "ascending": "true",
        "end_date_min": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    response = requests.get(GAMMA, params=params, timeout=TIMEOUT)
    response.raise_for_status()
    events = response.json()
    _cache[slug] = (time.monotonic(), events)
    return normalize_events(events, now)


def find_match(matches: list[dict], team_a: str, team_b: str) -> dict | None:
    found = [
        m for m in matches
        if (same_team(m["home"], team_a) and same_team(m["away"], team_b))
        or (same_team(m["home"], team_b) and same_team(m["away"], team_a))
    ]
    return found[0] if len(found) == 1 else None


def fair_probabilities(quotes: dict[str, dict]) -> dict[str, float]:
    """Mid-prices, scaled to sum to 1."""
    mids = {k: (q["ask"] + q["bid"]) / 2 if q["bid"] else q["ask"] for k, q in quotes.items()}
    total = sum(mids.values())
    return {k: v / total for k, v in mids.items()}


def is_trusted(quotes: dict[str, dict]) -> bool:
    return all(
        q["liquidity"] >= MIN_LIQUIDITY and q["bid"] is not None and q["ask"] - q["bid"] <= MAX_SPREAD
        for q in quotes.values()
    )
