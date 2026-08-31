"""Bookmaker/odds-source adapter layer.

analysis.py only talks to the BookmakerAdapter interface. To point the bot
at a different platform: add one adapter class implementing it, register it
in ADAPTERS, and set BOOKMAKER_ADAPTER in the environment — no change to
analysis.py or bot.py. TheOddsApiAdapter (the default) already aggregates
odds across ~70 bookmakers, so a dedicated adapter is only needed for a book
that isn't covered there and has no usable API.

Markets: "h2h" (1X2) and "totals" (over/under, main line nearest 2.5) are
both confirmed Odds API market keys. A "btts" (both teams to score) market
is a natural next addition but I couldn't verify its exact market key
against a live Odds API key — add it here once you've checked it against
your own key rather than trusting a guessed key name.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import requests

import odds as odds_api
from config import DEVIG_METHOD, EXECUTION_BOOKMAKER, MIN_BOOKS_FOR_PICK, REFERENCE_BOOKMAKER

LEAGUE_SPORT_KEYS = {
    "апл": "soccer_epl", "премьер-лига": "soccer_epl", "epl": "soccer_epl",
    "ла лига": "soccer_spain_la_liga", "ла-лига": "soccer_spain_la_liga", "laliga": "soccer_spain_la_liga",
    "бундеслига": "soccer_germany_bundesliga", "bundesliga": "soccer_germany_bundesliga",
    "серия а": "soccer_italy_serie_a", "serie a": "soccer_italy_serie_a",
    "лига 1": "soccer_france_ligue_one", "ligue 1": "soccer_france_ligue_one",
    "лига чемпионов": "soccer_uefa_champs_league", "champions league": "soccer_uefa_champs_league",
    "рпл": "soccer_russia_premier_league", "рфпл": "soccer_russia_premier_league",
}

MARKETS = ("h2h", "totals")


class BookmakerAdapter(ABC):
    @abstractmethod
    def get_market(self, team_a: str, team_b: str, league_hint: str | None, market: str,
                    api_key: str | None) -> dict:
        """Returns {"context_text": str, "fair": dict|None, "overround": float|None,
        "event": Any, "line": str|None, "book_count": int, "trusted": bool}.
        `event` is adapter-specific and only ever passed back into
        price_for()/commence_time() — analysis.py never inspects it. `line`
        is e.g. "2.5" for totals, else None. `book_count` is how many books
        contributed to `fair`; `trusted` is True when book_count meets
        MIN_BOOKS_FOR_PICK or a reference book was used directly — analysis.py
        should not act on a market where trusted is False."""

    @abstractmethod
    def price_for(self, event, market: str, outcome: str) -> tuple[float | None, bool]:
        """Returns (price, verified). If EXECUTION_BOOKMAKER is configured
        and that book is quoting this event/market, returns its own price
        and verified=True. Otherwise returns the best-of-market composite
        price and verified=False — meaning this number isn't guaranteed to
        be available at whichever single book you'll actually place at."""

    @abstractmethod
    def list_fixtures(self, league_hint: str, api_key: str | None) -> list[tuple[str, str]]:
        """Upcoming (home_team, away_team) pairs for a league, nearest first."""

    @abstractmethod
    def commence_time(self, event) -> str | None:
        """ISO8601 kickoff time for the event, or None if unknown."""


class TheOddsApiAdapter(BookmakerAdapter):
    """Default adapter: https://the-odds-api.com — real odds aggregated
    across dozens of bookmakers worldwide."""

    def _fetch_event(self, team_a, team_b, league_hint, api_key):
        sport_key = LEAGUE_SPORT_KEYS.get((league_hint or "").lower())
        if not sport_key:
            return None
        try:
            events = odds_api.list_events(sport_key, api_key)
        except requests.RequestException:
            return None
        return odds_api.find_event(events, team_a, team_b)

    def get_market(self, team_a, team_b, league_hint, market, api_key):
        empty = {"context_text": "", "fair": None, "overround": None, "event": None, "line": None,
                  "book_count": 0, "trusted": False}
        if not api_key:
            return empty
        event = self._fetch_event(team_a, team_b, league_hint, api_key)
        if not event:
            return empty

        if market == "h2h":
            prices = odds_api.best_h2h_prices(event)
            if not prices:
                return {**empty, "event": event}
            fair_result = odds_api.fair_probabilities_market(
                event, "h2h", method=DEVIG_METHOD, reference_book=REFERENCE_BOOKMAKER
            )
            if not fair_result:
                return {**empty, "event": event}
            fair_by_name, overround, book_count, used_reference = fair_result
            trusted = used_reference or book_count >= MIN_BOOKS_FOR_PICK
            fair = {
                "home": fair_by_name.get(event["home_team"]),
                "away": fair_by_name.get(event["away_team"]),
                "draw": fair_by_name.get("Draw"),
            }
            context_text = (
                f"1X2 — best market odds: {prices}\n"
                f"1X2 — de-vigged fair probabilities ({book_count} books"
                f"{', reference book' if used_reference else ''}): {fair}\n"
                f"1X2 — bookmaker overround: {overround:.1%}\n"
            )
            return {"context_text": context_text, "fair": fair, "overround": overround,
                     "event": event, "line": None, "book_count": book_count, "trusted": trusted}

        if market == "totals":
            result = odds_api.best_totals_prices(event)
            if not result:
                return {**empty, "event": event}
            prices, point = result
            fair_result = odds_api.fair_probabilities_market(
                event, "totals", point, method=DEVIG_METHOD, reference_book=REFERENCE_BOOKMAKER
            )
            if not fair_result:
                return {**empty, "event": event}
            fair_by_name, overround, book_count, used_reference = fair_result
            trusted = used_reference or book_count >= MIN_BOOKS_FOR_PICK
            fair = {"over": fair_by_name.get("Over"), "under": fair_by_name.get("Under")}
            context_text = (
                f"Totals ({point}) — best market odds: {prices}\n"
                f"Totals ({point}) — de-vigged fair probabilities ({book_count} books"
                f"{', reference book' if used_reference else ''}): {fair}\n"
                f"Totals ({point}) — bookmaker overround: {overround:.1%}\n"
            )
            return {"context_text": context_text, "fair": fair, "overround": overround,
                     "event": event, "line": str(point), "book_count": book_count, "trusted": trusted}

        return empty

    def _preferred_book_price(self, event, market, outcome) -> float | None:
        """EXECUTION_BOOKMAKER's own quote for this event/market/outcome, or
        None if that book isn't present (unknown key, or not covering this
        event) — callers fall back to the best-of-market price."""
        name = None
        if market == "h2h":
            name = {"home": event["home_team"], "away": event["away_team"], "draw": "Draw"}.get(outcome)
        elif market == "totals":
            name = {"over": "Over", "under": "Under"}.get(outcome)
        if name is None:
            return None

        target_point = None
        if market == "totals":
            result = odds_api.best_totals_prices(event)
            if not result:
                return None
            _, target_point = result

        for bm in event.get("bookmakers", []):
            if bm.get("key") != EXECUTION_BOOKMAKER:
                continue
            for mkt in bm.get("markets", []):
                if mkt["key"] != market:
                    continue
                outcomes = mkt["outcomes"]
                if market == "totals":
                    outcomes = [o for o in outcomes if o.get("point") == target_point]
                for o in outcomes:
                    if o["name"] == name:
                        return o["price"]
        return None

    def price_for(self, event, market, outcome):
        if not event:
            return None, False

        if EXECUTION_BOOKMAKER:
            preferred = self._preferred_book_price(event, market, outcome)
            if preferred is not None:
                return preferred, True

        if market == "h2h":
            name_by_outcome = {"home": event["home_team"], "away": event["away_team"], "draw": "Draw"}
            prices = odds_api.best_h2h_prices(event) or {}
            return prices.get(name_by_outcome.get(outcome)), False
        if market == "totals":
            result = odds_api.best_totals_prices(event)
            if not result:
                return None, False
            prices, _ = result
            return prices.get({"over": "Over", "under": "Under"}.get(outcome)), False
        return None, False

    def list_fixtures(self, league_hint, api_key):
        if not api_key:
            return []
        sport_key = LEAGUE_SPORT_KEYS.get((league_hint or "").lower())
        if not sport_key:
            return []
        try:
            events = odds_api.list_events(sport_key, api_key)
        except requests.RequestException:
            return []
        return [(e["home_team"], e["away_team"]) for e in events]

    def commence_time(self, event):
        return event.get("commence_time") if event else None


ADAPTERS: dict[str, BookmakerAdapter] = {
    "the_odds_api": TheOddsApiAdapter(),
}


def get_adapter(name: str) -> BookmakerAdapter:
    try:
        return ADAPTERS[name]
    except KeyError:
        raise ValueError(f"Unknown BOOKMAKER_ADAPTER={name!r}, available: {list(ADAPTERS)}")
