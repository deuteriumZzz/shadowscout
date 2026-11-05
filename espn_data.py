"""Form, table, line-ups and final scores from ESPN's public (unofficial) soccer
API. No key. Deliberately not the LLM: a score or a table is a fact we can read,
so nothing here is left for a model to remember or invent.

Team matching is shared with polymarket.py, since the feeds name clubs differently
("Stade Brestois 29" / "Brest"). Anything short of one clear candidate means no
match: showing or settling on the wrong game is worse than showing nothing. The
miniapp's espn.ts holds the same rules for its own proxy.
"""

from __future__ import annotations

import logging
import re
import time
import unicodedata
from datetime import datetime, timedelta, timezone

import requests

log = logging.getLogger("shadowscout.espn")

BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer"
TIMEOUT = 15
CACHE_SECONDS = 60
SCAN_DAYS = range(-1, 8)
LINK_WINDOW = timedelta(hours=2)
MIN_FORM_GAMES = 3

LEAGUES = {
    "epl": {"espn": "eng.1", "polymarket": "epl", "striker": "soccer"},
    "laliga": {"espn": "esp.1", "polymarket": "la-liga", "striker": "laliga"},
    "bundesliga": {"espn": "ger.1", "polymarket": "bundesliga", "striker": "bundesliga"},
    "seriea": {"espn": "ita.1", "polymarket": "sea", "striker": "seriea"},
    "ligue1": {"espn": "fra.1", "polymarket": "ligue-1", "striker": "ligue1"},
    "ucl": {"espn": "uefa.champions", "polymarket": "ucl", "striker": "ucl"},
    "rpl": {"espn": "rus.1", "polymarket": None, "striker": None},
}

_HINTS = {
    "апл": "epl", "премьер-лига": "epl", "epl": "epl", "premier league": "epl",
    "ла лига": "laliga", "ла-лига": "laliga", "laliga": "laliga", "la liga": "laliga",
    "бундеслига": "bundesliga", "bundesliga": "bundesliga",
    "серия а": "seriea", "serie a": "seriea",
    "лига 1": "ligue1", "ligue 1": "ligue1",
    "лига чемпионов": "ucl", "champions league": "ucl", "лч": "ucl",
    "рпл": "rpl", "рфпл": "rpl",
}

_NOISE = {
    "fc", "afc", "cf", "sc", "ac", "as", "ss", "ssc", "us", "rc", "rcd", "sv", "vfb", "vfl", "tsg", "fsv",
    "bsc", "club", "de", "la", "of", "the", "and", "calcio", "stade", "olympique",
}
_ALIASES = {
    "munchen": "munich", "man": "manchester", "utd": "united", "wolves": "wolverhampton",
    "internazionale": "inter", "koln": "cologne", "gladbach": "monchengladbach", "hamburger": "hamburg",
    "brestois": "brest", "lyonnais": "lyon",
}

_cache: dict[str, tuple[float, dict]] = {}


def league_key(hint: str | None) -> str | None:
    return _HINTS.get((hint or "").strip().lower())


def team_tokens(name: str) -> list[str]:
    text = unicodedata.normalize("NFD", name).encode("ascii", "ignore").decode().lower()
    # Otherwise "Paris FC" would be a subset of "Paris Saint-Germain".
    text = re.sub(r"paris saint[ -]germain", "psg", text)
    tokens = [t for t in re.split(r"[^a-z0-9]+", text) if t and not t.isdigit() and t not in _NOISE]
    return [_ALIASES.get(t, t) for t in tokens]


def same_team(a: str, b: str) -> bool:
    x, y = team_tokens(a), team_tokens(b)
    if not x or not y:
        return False
    short, long = (x, y) if len(x) <= len(y) else (y, x)
    return all(t in long for t in short)


def _get(path: str) -> dict:
    now = time.monotonic()
    cached = _cache.get(path)
    if cached and now - cached[0] < CACHE_SECONDS:
        return cached[1]
    response = requests.get(f"{BASE}/{path}", timeout=TIMEOUT)
    response.raise_for_status()
    data = response.json()
    _cache[path] = (now, data)
    return data


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _normalize_game(event: dict, code: str) -> dict | None:
    competition = (event.get("competitions") or [{}])[0]
    sides = {c.get("homeAway"): c for c in competition.get("competitors") or []}
    status = (event.get("status") or {}).get("type") or {}
    if not (event.get("id") and event.get("date") and "home" in sides and "away" in sides):
        return None

    def team(c: dict) -> dict:
        info = c.get("team") or {}
        score = str(c.get("score", ""))
        return {
            "name": info.get("displayName") or info.get("shortDisplayName") or "",
            "short": info.get("shortDisplayName") or "",
            "score": int(score) if score.isdigit() else None,
        }

    return {
        "id": str(event["id"]),
        "code": code,
        "start": _parse_time(event["date"]),
        "state": status.get("state"),
        "completed": bool(status.get("completed")),
        "home": team(sides["home"]),
        "away": team(sides["away"]),
    }


def _is(team: dict, name: str) -> bool:
    return same_team(team["name"], name) or (bool(team["short"]) and same_team(team["short"], name))


def choose_game(games: list[dict], team_a: str, team_b: str, around: datetime | None = None) -> dict | None:
    """Both clubs, either way round, and exactly one candidate."""
    found = [
        g for g in games
        if ((_is(g["home"], team_a) and _is(g["away"], team_b)) or (_is(g["home"], team_b) and _is(g["away"], team_a)))
        and (around is None or abs(g["start"] - around) <= LINK_WINDOW)
    ]
    return found[0] if len(found) == 1 else None


def find_game(team_a: str, team_b: str, league_hint: str | None, around: datetime | None = None) -> dict | None:
    key = league_key(league_hint)
    if not key:
        return None
    code = LEAGUES[key]["espn"]
    anchor = around or datetime.now(timezone.utc)
    days = range(-1, 2) if around else SCAN_DAYS
    games: dict[str, dict] = {}
    for offset in days:
        day = (anchor + timedelta(days=offset)).strftime("%Y%m%d")
        try:
            data = _get(f"{code}/scoreboard?dates={day}")
        except (requests.RequestException, ValueError) as exc:
            log.warning("ESPN scoreboard failed: %s", type(exc).__name__)
            continue
        for event in data.get("events") or []:
            game = _normalize_game(event, code)
            if game:
                games[game["id"]] = game
    return choose_game(list(games.values()), team_a, team_b, around)


def _form_rows(summary: dict, team_name: str) -> list[dict]:
    block = next(
        (t for t in summary.get("lastFiveGames") or [] if same_team((t.get("team") or {}).get("displayName", ""), team_name)),
        None,
    )
    rows = []
    for e in (block or {}).get("events") or []:
        try:
            home_goals, away_goals = int(e["homeTeamScore"]), int(e["awayTeamScore"])
        except (KeyError, TypeError, ValueError):
            continue
        away = e.get("atVs") == "@"
        rows.append({
            "date": str(e.get("gameDate", ""))[:10],
            "opponent": (e.get("opponent") or {}).get("displayName", "?"),
            "venue": "away" if away else "home",
            "for": away_goals if away else home_goals,
            "against": home_goals if away else away_goals,
            "result": e.get("gameResult"),
        })
    return rows


def _table_row(summary: dict, team_name: str) -> dict | None:
    groups = (summary.get("standings") or {}).get("groups") or [{}]
    for entry in (groups[0].get("standings") or {}).get("entries") or []:
        if same_team(str(entry.get("team", "")), team_name):
            stats = {s.get("name"): s.get("displayValue") for s in entry.get("stats") or []}
            return {"rank": stats.get("rank"), "points": stats.get("points"), "played": stats.get("gamesPlayed")}
    return None


def _lineup(summary: dict, side: str) -> list[str] | None:
    roster = next((r for r in summary.get("rosters") or [] if r.get("homeAway") == side), None)
    starters = [
        ((p.get("athlete") or {}).get("displayName") or "?") for p in (roster or {}).get("roster") or [] if p.get("starter")
    ]
    return starters if len(starters) == 11 else None


def match_context(game: dict) -> dict:
    """Plain facts for the prompt, plus goal rates for the independent Poisson
    estimate. Everything is tagged [ESPN], so the model can cite it as a source."""
    summary = _get(f"{game['code']}/summary?event={game['id']}")
    home, away = game["home"]["name"], game["away"]["name"]
    lines = []
    rates = {}
    for side, name in (("home", home), ("away", away)):
        form = _form_rows(summary, name)
        if form:
            games = "; ".join(
                f"{r['date']} {r['venue']} vs {r['opponent']} {r['for']}-{r['against']} {r['result']}" for r in form
            )
            lines.append(f"[ESPN] {name}, recent games: {games}")
        if len(form) >= MIN_FORM_GAMES:
            rates[side] = {
                "for": sum(r["for"] for r in form) / len(form),
                "against": sum(r["against"] for r in form) / len(form),
            }
        table = _table_row(summary, name)
        if table:
            lines.append(f"[ESPN] {name}, league table: place {table['rank']}, {table['points']} points, {table['played']} played")
        lineup = _lineup(summary, side)
        lines.append(
            f"[ESPN] {name}, confirmed starting XI: {', '.join(lineup)}" if lineup
            else f"[ESPN] {name}: starting XI not announced yet"
        )
    series = (summary.get("seasonseries") or [{}])[0]
    if series.get("summary"):
        lines.append(f"[ESPN] Head-to-head, {series.get('shortSummary', 'recent')}: {series['summary']}")
    # ponytail: rates aren't split by venue, five games rarely hold enough of each. Add once this has proven itself.
    return {"text": "\n".join(lines), "has_form": len(rates) == 2, "rates": rates}


def pick_result(market: str, pick: str, line: float | None, home_goals: int, away_goals: int) -> str | None:
    if market == "h2h":
        actual = "home" if home_goals > away_goals else "away" if away_goals > home_goals else "draw"
        return "win" if pick == actual else "loss"
    if market == "totals" and line is not None:
        total = home_goals + away_goals
        if total == line:
            return "push"
        return "win" if (pick == "over") == (total > line) else "loss"
    return None


def final_score(team_a: str, team_b: str, league_hint: str | None, kickoff: str | None) -> dict | None:
    """The score once ESPN says the game is complete, with home and away as ESPN
    has them. A postponed or abandoned game isn't complete, so it stays open."""
    around = _parse_time(kickoff) if kickoff else None
    game = find_game(team_a, team_b, league_hint, around)
    if not game or not game["completed"] or game["home"]["score"] is None or game["away"]["score"] is None:
        return None
    return {
        "home": game["home"]["name"],
        "away": game["away"]["name"],
        "home_goals": game["home"]["score"],
        "away_goals": game["away"]["score"],
    }
