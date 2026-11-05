from __future__ import annotations

import json
import math
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone

from config import DB_PATH

_SCHEMA = """
CREATE TABLE IF NOT EXISTS picks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    league TEXT,
    match TEXT NOT NULL,
    market TEXT NOT NULL DEFAULT 'h2h',
    pick TEXT NOT NULL,
    odds REAL,
    confidence TEXT,
    reasoning TEXT,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | placed | skipped
    result TEXT,                             -- NULL | win | loss | push
    stake REAL,                              -- amount staked, set when status becomes 'placed'
    commence_time TEXT,                      -- ISO8601 kickoff, from the bookmaker adapter
    closing_odds REAL,                       -- price captured shortly before kickoff, for CLV
    news_checked INTEGER NOT NULL DEFAULT 0, -- whether the pre-kickoff news recheck has fired
    model_probability REAL,                  -- LLM's own stated probability for the pick, for calibration
    poisson_probability REAL,                -- independent Poisson-model probability, if available
    xg_probability REAL,                     -- independent xG-based probability, if available
    price_verified INTEGER NOT NULL DEFAULT 0, -- 1 if `odds` is EXECUTION_BOOKMAKER's own quote, 0 if best-of-market
    recommended_stake REAL,                  -- stake shown to the user at recommendation time (correlation-adjusted)
    steam_checked INTEGER NOT NULL DEFAULT 0 -- whether the pre-kickoff line-movement check has fired
);

-- Single-row bankroll: flat-percent staking + a stop-loss that halts new
-- stake suggestions once the drawdown from the peak balance gets too deep.
-- This is advisory only — the bot never moves money, it just stops
-- recommending a stake size once the account is bleeding.
CREATE TABLE IF NOT EXISTS bankroll (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    capital REAL NOT NULL,
    peak REAL NOT NULL,
    unit_pct REAL NOT NULL DEFAULT 0.02,
    stop_loss_pct REAL NOT NULL DEFAULT 0.2
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Every forecast, bet or not, written before kick-off. Scoring only the picks
-- would flatter the model: this is what it's measured against the market on.
CREATE TABLE IF NOT EXISTS forecasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    league TEXT,
    match TEXT NOT NULL,
    commence_time TEXT,
    provider TEXT,
    prompt_version TEXT,
    payload TEXT NOT NULL,                   -- JSON: per-market estimate, fair, line, pick, reason; facts; text
    home_goals INTEGER,                      -- final score, filled in from ESPN
    away_goals INTEGER
);
"""

# How long after kickoff a match is assumed over (for the auto-settle job),
# and how far ahead of kickoff the closing line / late-news jobs look.
SETTLEMENT_BUFFER = timedelta(minutes=150)
CLOSING_LINE_BUFFER = timedelta(minutes=10)
NEWS_CHECK_WINDOW = timedelta(minutes=90)

# Steam check: a single mid-window look at line movement since the pick was
# made, well before the closing-line capture — an early warning (or
# confirmation) rather than the final post-hoc CLV number.
STEAM_CHECK_DELAY = timedelta(hours=2)

# Rolling CLV kill-switch: if the average CLV over the most recent window of
# picks-with-a-captured-closing-price drops below this, bankroll_status()
# stops suggesting new stakes — persistent negative CLV is direct evidence
# the model isn't beating the market, not something to keep betting through.
CLV_GATE_WINDOW = 20
CLV_GATE_MIN_SAMPLE = 20
CLV_GATE_THRESHOLD = -1.0  # percent

# Below this many scored forecasts, model-vs-market is reported as too early to call.
MIN_FORECASTS_FOR_VERDICT = 300


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _migrate(conn):
    """Idempotent ALTER TABLE for columns added after the initial schema —
    CREATE TABLE IF NOT EXISTS alone won't add columns to an existing db
    file."""
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(picks)")}
    for column, decl in (
        ("model_probability", "REAL"),
        ("poisson_probability", "REAL"),
        ("xg_probability", "REAL"),
        ("price_verified", "INTEGER NOT NULL DEFAULT 0"),
        ("recommended_stake", "REAL"),
        ("steam_checked", "INTEGER NOT NULL DEFAULT 0"),
        ("line", "REAL"),
        ("fair_probability", "REAL"),
        ("blended_probability", "REAL"),
        ("provider", "TEXT"),
        ("prompt_version", "TEXT"),
        ("virtual", "INTEGER NOT NULL DEFAULT 0"),
        ("final_score", "TEXT"),
        ("home_logo", "TEXT"),
        ("away_logo", "TEXT"),
    ):
        if column not in existing:
            conn.execute(f"ALTER TABLE picks ADD COLUMN {column} {decl}")


def init_db():
    with closing(_connect()) as conn, conn:
        conn.executescript(_SCHEMA)
        _migrate(conn)


def _parse_iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def save_pick(league: str, match: str, market: str, pick: str, odds: float | None,
              confidence: str, reasoning: str, commence_time: str | None,
              model_probability: float | None = None, poisson_probability: float | None = None,
              xg_probability: float | None = None,
              price_verified: bool = False, recommended_stake: float | None = None,
              line: float | None = None, fair_probability: float | None = None,
              blended_probability: float | None = None, provider: str | None = None,
              prompt_version: str | None = None, home_logo: str | None = None,
              away_logo: str | None = None) -> int:
    with closing(_connect()) as conn, conn:
        cur = conn.execute(
            "INSERT INTO picks (created_at, league, match, market, pick, odds, confidence, "
            "reasoning, commence_time, model_probability, poisson_probability, xg_probability, "
            "price_verified, recommended_stake, line, fair_probability, blended_probability, "
            "provider, prompt_version, home_logo, away_logo) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (datetime.now(timezone.utc).isoformat(), league, match, market, pick, odds,
             confidence, reasoning, commence_time, model_probability, poisson_probability,
             xg_probability, int(price_verified), recommended_stake, line, fair_probability,
             blended_probability, provider, prompt_version, home_logo, away_logo),
        )
        return cur.lastrowid


def save_forecast(league: str | None, match: str, commence_time: str | None, provider: str | None,
                  prompt_version: str, payload: dict) -> int:
    with closing(_connect()) as conn, conn:
        cur = conn.execute(
            "INSERT INTO forecasts (created_at, league, match, commence_time, provider, prompt_version, payload) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (datetime.now(timezone.utc).isoformat(), league, match, commence_time, provider, prompt_version,
             json.dumps(payload, ensure_ascii=False)),
        )
        return cur.lastrowid


def forecasts_awaiting_result() -> list[sqlite3.Row]:
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT * FROM forecasts WHERE home_goals IS NULL AND commence_time IS NOT NULL"
        ).fetchall()
    now = datetime.now(timezone.utc)
    return [r for r in rows if _parse_iso(r["commence_time"]) + SETTLEMENT_BUFFER <= now]


def set_forecast_result(forecast_id: int, home_goals: int, away_goals: int):
    with closing(_connect()) as conn, conn:
        conn.execute("UPDATE forecasts SET home_goals = ?, away_goals = ? WHERE id = ?",
                     (home_goals, away_goals, forecast_id))


def latest_forecast(match: str) -> dict | None:
    with closing(_connect()) as conn:
        row = conn.execute("SELECT * FROM forecasts WHERE match = ? ORDER BY id DESC LIMIT 1", (match,)).fetchone()
    return _forecast_dict(row) if row else None


def recent_forecasts(limit: int = 100) -> list[dict]:
    with closing(_connect()) as conn:
        rows = conn.execute("SELECT * FROM forecasts ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [_forecast_dict(r) for r in rows]


def _forecast_dict(row: sqlite3.Row) -> dict:
    return {**dict(row), "payload": json.loads(row["payload"])}


def _outcome_won(market: str, outcome: str, line: float | None, home_goals: int, away_goals: int) -> int | None:
    if market == "h2h":
        actual = "home" if home_goals > away_goals else "away" if away_goals > home_goals else "draw"
        return int(outcome == actual)
    total = home_goals + away_goals
    if line is None or total == line:
        return None
    return int((outcome == "over") == (total > line))


def forecast_outcomes(league: str | None = None) -> list[dict]:
    """One row per outcome of every scored forecast: the model's number, the
    market's, and what happened."""
    query = "SELECT * FROM forecasts WHERE home_goals IS NOT NULL"
    params: tuple = ()
    if league:
        query += " AND league = ?"
        params = (league,)
    with closing(_connect()) as conn:
        rows = conn.execute(query, params).fetchall()
    out = []
    for row in rows:
        for market, data in json.loads(row["payload"]).get("markets", {}).items():
            for outcome, model_p in (data.get("estimate") or {}).items():
                won = _outcome_won(market, outcome, data.get("line"), row["home_goals"], row["away_goals"])
                market_p = (data.get("fair") or {}).get(outcome)
                if won is not None:
                    out.append({"forecast_id": row["id"], "market": market, "model": model_p, "fair": market_p, "won": won})
    return out


def forecast_scores() -> dict:
    """Is the model more accurate than simply believing the market? Lower Brier
    is better, compared only where both have a number. This, not a winning run,
    is what says whether its estimates are worth anything."""
    rows = [r for r in forecast_outcomes() if r["fair"] is not None]
    forecasts = len({r["forecast_id"] for r in rows})
    if not rows:
        return {"forecasts": 0, "model_brier": None, "market_brier": None, "beats_market": None,
                "low_sample": True, "min_sample": MIN_FORECASTS_FOR_VERDICT}
    model = sum((r["model"] - r["won"]) ** 2 for r in rows) / len(rows)
    market = sum((r["fair"] - r["won"]) ** 2 for r in rows) / len(rows)
    low_sample = forecasts < MIN_FORECASTS_FOR_VERDICT
    return {"forecasts": forecasts, "model_brier": model, "market_brier": market,
            "beats_market": None if low_sample else model < market,
            "low_sample": low_sample, "min_sample": MIN_FORECASTS_FOR_VERDICT}


def set_status(pick_id: int, status: str):
    with closing(_connect()) as conn, conn:
        conn.execute("UPDATE picks SET status = ? WHERE id = ?", (status, pick_id))


def settle(pick_id: int, result: str):
    """Marks a placed pick won/lost/pushed and applies its stake to the
    bankroll (no-op on capital if no bankroll has been set up, or on push)."""
    pick = get_pick(pick_id)
    if pick is None or pick["status"] != "placed":
        return
    with closing(_connect()) as conn, conn:
        conn.execute("UPDATE picks SET result = ? WHERE id = ?", (result, pick_id))
    if pick["stake"] is not None and result in ("win", "loss"):
        stake = pick["stake"]
        delta = stake * ((pick["odds"] or 1) - 1) if result == "win" else -stake
        adjust_bankroll(delta)


def record_result(pick_id: int, result: str):
    """Like settle(), but for picks that were never placed (pending/skipped)
    — records the outcome for CLV/calibration stats without touching the
    bankroll, so those stats aren't limited to the subset of picks the user
    happened to act on."""
    with closing(_connect()) as conn, conn:
        conn.execute("UPDATE picks SET result = ? WHERE id = ?", (result, pick_id))


def get_pick(pick_id: int) -> sqlite3.Row | None:
    with closing(_connect()) as conn:
        return conn.execute("SELECT * FROM picks WHERE id = ?", (pick_id,)).fetchone()


def set_closing_odds(pick_id: int, closing_odds: float):
    with closing(_connect()) as conn, conn:
        conn.execute("UPDATE picks SET closing_odds = ? WHERE id = ?", (closing_odds, pick_id))


def mark_news_checked(pick_id: int):
    with closing(_connect()) as conn, conn:
        conn.execute("UPDATE picks SET news_checked = 1 WHERE id = ?", (pick_id,))


def mark_steam_checked(pick_id: int):
    with closing(_connect()) as conn, conn:
        conn.execute("UPDATE picks SET steam_checked = 1 WHERE id = ?", (pick_id,))


def _due(rows, predicate) -> list[sqlite3.Row]:
    now = datetime.now(timezone.utc)
    due = []
    for r in rows:
        if not r["commence_time"]:
            continue
        try:
            commence = _parse_iso(r["commence_time"])
        except ValueError:
            continue
        if predicate(now, commence):
            due.append(r)
    return due


def picks_awaiting_closing_line() -> list[sqlite3.Row]:
    """Every pick (not just placed ones) — CLV is a property of what the
    model recommended, not of which recommendations the user happened to
    act on. Restricting this to 'placed' would bias avg CLV toward whatever
    subset of picks the user's own judgment selected."""
    with closing(_connect()) as conn:
        rows = conn.execute("SELECT * FROM picks WHERE closing_odds IS NULL").fetchall()
    return _due(rows, lambda now, commence: now >= commence - CLOSING_LINE_BUFFER)


def picks_awaiting_steam_check() -> list[sqlite3.Row]:
    """Pending picks (not yet placed or skipped — a decided pick has nothing
    left to warn about) created more than STEAM_CHECK_DELAY ago and still
    outside the closing-line window, so this fires once, earlier than and
    independent of the final CLV capture."""
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT * FROM picks WHERE status = 'pending' AND steam_checked = 0"
        ).fetchall()
    now = datetime.now(timezone.utc)
    due = []
    for r in rows:
        if not r["commence_time"]:
            continue
        try:
            created = _parse_iso(r["created_at"])
            commence = _parse_iso(r["commence_time"])
        except ValueError:
            continue
        if now >= created + STEAM_CHECK_DELAY and now < commence - CLOSING_LINE_BUFFER:
            due.append(r)
    return due


def picks_awaiting_settlement() -> list[sqlite3.Row]:
    """Placed picks only — these drive the explicit user-confirm flow
    because a wrong auto-settle here would misapply real bankroll money."""
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT * FROM picks WHERE status = 'placed' AND result IS NULL"
        ).fetchall()
    return _due(rows, lambda now, commence: now >= commence + SETTLEMENT_BUFFER)


def picks_awaiting_result_tracking() -> list[sqlite3.Row]:
    """Non-placed picks (pending/skipped) whose result isn't known yet.
    Safe to auto-settle with no user confirmation — no bankroll is at stake
    — purely so calibration/CLV stats cover every recommendation the model
    made, not just the ones the user chose to bet."""
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT * FROM picks WHERE status != 'placed' AND result IS NULL"
        ).fetchall()
    return _due(rows, lambda now, commence: now >= commence + SETTLEMENT_BUFFER)


def picks_awaiting_news_check() -> list[sqlite3.Row]:
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT * FROM picks WHERE status = 'pending' AND news_checked = 0"
        ).fetchall()
    return _due(rows, lambda now, commence: commence - NEWS_CHECK_WINDOW <= now < commence)


def get_setting(key: str) -> str | None:
    with closing(_connect()) as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_setting(key: str, value: str):
    with closing(_connect()) as conn, conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def init_bankroll(capital: float, unit_pct: float = 0.02, stop_loss_pct: float = 0.2):
    with closing(_connect()) as conn, conn:
        conn.execute(
            "INSERT INTO bankroll (id, capital, peak, unit_pct, stop_loss_pct) VALUES (1, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET capital = excluded.capital, peak = excluded.peak, "
            "unit_pct = excluded.unit_pct, stop_loss_pct = excluded.stop_loss_pct",
            (capital, capital, unit_pct, stop_loss_pct),
        )


def get_bankroll() -> sqlite3.Row | None:
    with closing(_connect()) as conn:
        return conn.execute("SELECT * FROM bankroll WHERE id = 1").fetchone()


def adjust_bankroll(delta: float):
    row = get_bankroll()
    if row is None:
        return
    new_capital = row["capital"] + delta
    new_peak = max(row["peak"], new_capital)
    with closing(_connect()) as conn, conn:
        conn.execute("UPDATE bankroll SET capital = ?, peak = ? WHERE id = 1", (new_capital, new_peak))


def rolling_clv_status() -> dict:
    """Average CLV over the most recent CLV_GATE_WINDOW picks with a
    captured closing price (any status — see picks_awaiting_closing_line()'s
    docstring). Feeds bankroll_status()'s CLV kill-switch: a persistently
    negative rolling average is direct evidence the model isn't beating the
    market, independent of whether the bankroll itself has drawn down yet."""
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT odds, closing_odds FROM picks WHERE closing_odds IS NOT NULL "
            "ORDER BY created_at DESC LIMIT ?",
            (CLV_GATE_WINDOW,),
        ).fetchall()
    values = [(r["odds"] / r["closing_odds"] - 1) * 100 for r in rows if r["odds"] and r["closing_odds"]]
    if len(values) < CLV_GATE_MIN_SAMPLE:
        return {"sample": len(values), "avg_clv": None, "gated": False}
    avg = sum(values) / len(values)
    return {"sample": len(values), "avg_clv": avg, "gated": avg < CLV_GATE_THRESHOLD}


def bankroll_status() -> dict | None:
    """Stake suggestion gated on two independent stop conditions: bankroll
    drawdown from peak (the original safety valve) and rolling CLV (the
    edge-reality check — see rolling_clv_status()). Either one alone halts
    new stake suggestions."""
    row = get_bankroll()
    if row is None:
        return None
    drawdown = 1 - (row["capital"] / row["peak"]) if row["peak"] > 0 else 0.0
    drawdown_stopped = drawdown >= row["stop_loss_pct"]
    clv_gate = rolling_clv_status()
    stopped = drawdown_stopped or clv_gate["gated"]
    suggested_stake = None if stopped else round(row["capital"] * row["unit_pct"], 2)
    return {
        "capital": row["capital"],
        "peak": row["peak"],
        "drawdown_pct": drawdown * 100,
        "stop_loss_pct": row["stop_loss_pct"] * 100,
        "stopped": stopped,
        "drawdown_stopped": drawdown_stopped,
        "clv_gated": clv_gate["gated"],
        "clv_gate_avg": clv_gate["avg_clv"],
        "suggested_stake": suggested_stake,
    }


def list_pending_picks(limit: int = 50) -> list[sqlite3.Row]:
    """Active recommendations awaiting a place/skip decision — the Mini
    App's feed tab. Newest first."""
    with closing(_connect()) as conn:
        return conn.execute(
            "SELECT * FROM picks WHERE status = 'pending' ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()


def list_settled_picks(limit: int = 100) -> list[sqlite3.Row]:
    """Placed picks with a known result — the Mini App's history tab.
    Mirrors stats()'s own row selection (status='placed' AND result set)."""
    with closing(_connect()) as conn:
        return conn.execute(
            "SELECT * FROM picks WHERE status = 'placed' AND result IS NOT NULL "
            "ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()


def place(pick_id: int, stake: float | None, virtual: bool = False):
    with closing(_connect()) as conn, conn:
        conn.execute("UPDATE picks SET status = 'placed', stake = ?, virtual = ? WHERE id = ?",
                     (stake, int(virtual), pick_id))


def set_final_score(pick_id: int, score: str):
    with closing(_connect()) as conn, conn:
        conn.execute("UPDATE picks SET final_score = ? WHERE id = ?", (score, pick_id))


def list_open_picks(limit: int = 50) -> list[sqlite3.Row]:
    """Accepted and waiting for the final whistle."""
    with closing(_connect()) as conn:
        return conn.execute(
            "SELECT * FROM picks WHERE status = 'placed' AND result IS NULL ORDER BY commence_time LIMIT ?",
            (limit,),
        ).fetchall()


def picks_for_match(match: str) -> list[sqlite3.Row]:
    with closing(_connect()) as conn:
        return conn.execute("SELECT * FROM picks WHERE match = ? ORDER BY id DESC", (match,)).fetchall()


def virtual_picks_to_settle() -> list[sqlite3.Row]:
    with closing(_connect()) as conn:
        rows = conn.execute("SELECT * FROM picks WHERE status = 'placed' AND result IS NULL AND virtual = 1").fetchall()
    return _due(rows, lambda now, commence: now >= commence + SETTLEMENT_BUFFER)


def limits_status() -> dict:
    """The owner's own brakes, on top of the drawdown stop. `reason` says why new
    bets are off right now, if they are."""
    limit = float(get_setting("daily_limit") or 0)
    paused_until = get_setting("paused_until")
    now = datetime.now(timezone.utc)
    if paused_until and _parse_iso(paused_until) <= now:
        paused_until = None
    # ponytail: losses count on the day of the match, there's no separate settled-at time.
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT stake, commence_time FROM picks WHERE status = 'placed' AND result = 'loss' AND stake IS NOT NULL "
            "AND commence_time IS NOT NULL"
        ).fetchall()
    loss_today = sum(r["stake"] for r in rows if _parse_iso(r["commence_time"]).date() == now.date())
    reason = None
    if paused_until:
        reason = "Вы взяли паузу: ставки выключены на сутки"
    elif limit and loss_today >= limit:
        reason = "Дневной лимит потерь исчерпан: до завтра ставок нет"
    return {"daily_limit": limit, "loss_today": loss_today, "paused_until": paused_until, "reason": reason}


# Below this settled-bet count, win rate / ROI are mostly noise — bot.py
# surfaces a warning rather than let a short lucky/unlucky streak look like
# a real edge or the lack of one.
MIN_SAMPLE_FOR_STATS = 30


def _wilson_ci(wins: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson score interval for a win rate (percent, percent) — more
    reliable than a naive normal approximation at the small sample sizes
    this bot will realistically have for a while."""
    if n == 0:
        return 0.0, 0.0
    p = wins / n
    denom = 1 + z ** 2 / n
    center = p + z ** 2 / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z ** 2 / (4 * n ** 2))
    lo = max(0.0, (center - margin) / denom)
    hi = min(1.0, (center + margin) / denom)
    return lo * 100, hi * 100


def stats(league: str | None = None) -> dict:
    query = "SELECT * FROM picks WHERE status = 'placed' AND result IS NOT NULL"
    params: tuple = ()
    if league:
        query += " AND league = ?"
        params = (league,)
    with closing(_connect()) as conn:
        rows = conn.execute(query, params).fetchall()

    wins = sum(1 for r in rows if r["result"] == "win")
    losses = sum(1 for r in rows if r["result"] == "loss")
    settled = wins + losses
    # unit-stake ROI: +(odds-1) per win, -1 per loss, over number of unit stakes placed —
    # average edge per bet, independent of how bankroll sizing varied over time
    profit = sum((r["odds"] or 0) - 1 for r in rows if r["result"] == "win")
    profit -= losses
    roi = (profit / settled * 100) if settled else 0.0
    win_rate = (wins / settled * 100) if settled else 0.0
    win_rate_ci = _wilson_ci(wins, settled)

    # real-money ROI: actual currency profit over actual currency staked —
    # differs from the unit-stake ROI above once stake sizes vary (e.g. the
    # bankroll grew/shrank between bets)
    staked_total = sum(r["stake"] for r in rows if r["stake"])
    profit_currency = sum(r["stake"] * ((r["odds"] or 1) - 1) for r in rows if r["result"] == "win" and r["stake"])
    profit_currency -= sum(r["stake"] for r in rows if r["result"] == "loss" and r["stake"])
    weighted_roi = (profit_currency / staked_total * 100) if staked_total else None

    # what fraction of settled bets used a price actually confirmed at your
    # own bookmaker (EXECUTION_BOOKMAKER) rather than an unverified
    # best-of-market composite — a low number here means the ROI/CLV figures
    # above may be optimistic relative to what you could actually capture
    verified_count = sum(1 for r in rows if r["price_verified"])
    price_verified_pct = (verified_count / settled * 100) if settled else None

    by_league: dict[str, dict] = {}
    for r in rows:
        lg = r["league"] or "unknown"
        b = by_league.setdefault(lg, {"wins": 0, "losses": 0})
        if r["result"] == "win":
            b["wins"] += 1
        elif r["result"] == "loss":
            b["losses"] += 1

    # CLV across every pick with a captured closing price, regardless of
    # status — see picks_awaiting_closing_line()'s docstring for why 'placed'
    # only would bias this toward the user's own selection habits, not the
    # model's actual edge. Positive average = systematically beating the
    # closing line, the strongest evidence of real edge this bot can offer.
    with closing(_connect()) as conn:
        clv_query = "SELECT odds, closing_odds FROM picks WHERE closing_odds IS NOT NULL"
        clv_params: tuple = ()
        if league:
            clv_query += " AND league = ?"
            clv_params = (league,)
        clv_rows = conn.execute(clv_query, clv_params).fetchall()
    clv_values = [(r["odds"] / r["closing_odds"] - 1) * 100 for r in clv_rows if r["odds"] and r["closing_odds"]]
    avg_clv = sum(clv_values) / len(clv_values) if clv_values else None

    # Calibration: does a stated model_probability of ~0.6 actually win ~60%
    # of the time? Computed across every pick with both a stored probability
    # and a known result — again not restricted to 'placed', for the same
    # selection-bias reason as CLV above. This is the metric that actually
    # answers "is the model's own probability estimate any good", separate
    # from whether the market happened to offer a price worth taking.
    with closing(_connect()) as conn:
        calib_query = (
            "SELECT model_probability, result FROM picks "
            "WHERE model_probability IS NOT NULL AND result IN ('win', 'loss')"
        )
        calib_params: tuple = ()
        if league:
            calib_query += " AND league = ?"
            calib_params = (league,)
        calib_rows = conn.execute(calib_query, calib_params).fetchall()
    brier_score = log_loss = None
    if calib_rows:
        n = len(calib_rows)
        brier_sum = log_loss_sum = 0.0
        for r in calib_rows:
            p = min(max(r["model_probability"], 1e-6), 1 - 1e-6)
            y = 1.0 if r["result"] == "win" else 0.0
            brier_sum += (p - y) ** 2
            log_loss_sum += -(y * math.log(p) + (1 - y) * math.log(1 - p))
        brier_score = brier_sum / n
        log_loss = log_loss_sum / n

    return {
        "settled": settled,
        "wins": wins,
        "losses": losses,
        "win_rate": win_rate,
        "win_rate_ci": win_rate_ci,
        "roi": roi,
        "weighted_roi": weighted_roi,
        "price_verified_pct": price_verified_pct,
        "by_league": by_league,
        "avg_clv": avg_clv,
        "clv_sample": len(clv_values),
        "brier_score": brier_score,
        "log_loss": log_loss,
        "calibration_sample": len(calib_rows),
        "low_sample": settled < MIN_SAMPLE_FOR_STATS,
    }


def equity_curve() -> list[dict]:
    """Running cumulative profit over every placed, settled pick — same
    population and same two profit conventions as stats() (unit-stake and
    real-currency), just as a series instead of one final aggregate. Ordered
    by created_at (when the pick was made): picks has no separate "settled
    at" timestamp, so this is the closest chronological ordering available —
    close enough since settlement follows kickoff shortly after the pick."""
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT created_at, odds, stake, result FROM picks "
            "WHERE status = 'placed' AND result IS NOT NULL ORDER BY created_at ASC"
        ).fetchall()

    points = []
    cum_units = cum_currency = 0.0
    for r in rows:
        if r["result"] == "win":
            cum_units += (r["odds"] or 0) - 1
            if r["stake"]:
                cum_currency += r["stake"] * ((r["odds"] or 1) - 1)
        elif r["result"] == "loss":
            cum_units -= 1
            if r["stake"]:
                cum_currency -= r["stake"]
        points.append({
            "date": r["created_at"],
            "cumulative_units": round(cum_units, 4),
            "cumulative_currency": round(cum_currency, 2),
        })
    return points
