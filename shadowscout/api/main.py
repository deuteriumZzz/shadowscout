"""FastAPI service exposing storage.py to the Telegram Mini App frontend.
Runs as its own process (`uvicorn shadowscout.api.main:app`), independent of
bot.py's polling loop — see PRODUCT.md's Stack section for why. Reads and
writes the same SQLite file bot.py's own background jobs use, so every
GET here is a live read, never a cache the Mini App owns on its own."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from shadowscout.forecast import analysis
from shadowscout.forecast import backtest
from shadowscout import browser_session
import requests
from shadowscout import wallet
from shadowscout import connections
from shadowscout import match_alerts
from shadowscout import storage
from shadowscout.config import MINIAPP_ORIGIN
from shadowscout.api.auth import require_extension_token, require_owner

log = logging.getLogger("shadowscout.api")

app = FastAPI(title="shadowscout Mini App API")

if MINIAPP_ORIGIN:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in MINIAPP_ORIGIN.split(",")],
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )


@app.on_event("startup")
def _startup():
    storage.init_db()


def _row(r) -> dict | None:
    return dict(r) if r is not None else None


def _rows(rs) -> list[dict]:
    return [dict(r) for r in rs]


@app.get("/api/picks/pending")
def get_pending_picks(_owner: dict = Depends(require_owner)):
    return _rows(storage.list_pending_picks())


@app.get("/api/history")
def get_history(limit: int = 100, _owner: dict = Depends(require_owner)):
    return _rows(storage.list_settled_picks(limit=limit))


@app.get("/api/bankroll")
def get_bankroll(_owner: dict = Depends(require_owner)):
    return storage.bankroll_status()


class BankrollIn(BaseModel):
    capital: float = Field(gt=0)


@app.post("/api/bankroll")
def set_bankroll(body: BankrollIn, _owner: dict = Depends(require_owner)):
    storage.init_bankroll(body.capital)
    return storage.bankroll_status()


@app.get("/api/stats")
def get_stats(league: Optional[str] = None, _owner: dict = Depends(require_owner)):
    return storage.stats(league=league)


@app.get("/api/equity-curve")
def get_equity_curve(_owner: dict = Depends(require_owner)):
    return storage.equity_curve()


@app.get("/api/backtest")
async def run_backtest(league: str, season: int, _owner: dict = Depends(require_owner)):
    api_key = connections.get_key("api_football")
    if not api_key:
        raise HTTPException(400, "API-Football key is not configured")
    return await asyncio.to_thread(backtest.backtest_league, league, season, api_key)


# --- extension/ (bet-slip auto-fill browser extension) --------------------
# Separate auth (require_extension_token, not require_owner) since this runs
# on the bookmaker's own site, outside Telegram — see auth.py.

@app.get("/api/extension/pending-picks")
def get_pending_picks_for_extension(_auth: None = Depends(require_extension_token)):
    picks = _rows(storage.list_pending_picks())
    bankroll = storage.bankroll_status()
    fallback_stake = bankroll["suggested_stake"] if bankroll and not bankroll["stopped"] else None
    return [
        {
            "id": p["id"],
            "match": p["match"],
            "market_label": p["market"],
            "pick": p["pick"],
            "odds": p["odds"],
            "stake": p["recommended_stake"] if p["recommended_stake"] is not None else fallback_stake,
        }
        for p in picks
    ]


class AlertsIn(BaseModel):
    kickoff: Optional[bool] = None
    goals: Optional[bool] = None


@app.get("/api/settings/alerts")
def get_alerts(_owner: dict = Depends(require_owner)):
    return match_alerts.settings()


@app.post("/api/settings/alerts")
def set_alerts(body: AlertsIn, _owner: dict = Depends(require_owner)):
    return match_alerts.set_settings(body.kickoff, body.goals)


@app.get("/api/settings/digest")
def get_digest_settings(_owner: dict = Depends(require_owner)):
    return {"leagues": storage.get_setting("digest_leagues")}


class DigestIn(BaseModel):
    leagues: str


@app.post("/api/settings/digest")
def set_digest_settings(body: DigestIn, _owner: dict = Depends(require_owner)):
    storage.set_setting("digest_leagues", body.leagues)
    return {"leagues": body.leagues}


@app.post("/api/picks/{pick_id}/skip")
def skip_pick(pick_id: int, _owner: dict = Depends(require_owner)):
    pick = storage.get_pick(pick_id)
    if pick is None:
        raise HTTPException(404, "Pick not found")
    if pick["status"] != "pending":
        raise HTTPException(409, "Pick already decided")
    storage.set_status(pick_id, "skipped")
    return _row(storage.get_pick(pick_id))


@app.post("/api/picks/{pick_id}/accept")
def accept_pick(pick_id: int, _owner: dict = Depends(require_owner)):
    """The no-money bet: records it at the real price and stake, and the result
    settles itself. Nothing is sent anywhere."""
    pick = storage.get_pick(pick_id)
    if pick is None:
        raise HTTPException(404, "Прогноз не найден")
    if pick["status"] != "pending":
        raise HTTPException(409, "Решение по этому прогнозу уже принято")
    if pick["commence_time"] and storage._parse_iso(pick["commence_time"]) <= datetime.now(timezone.utc):
        raise HTTPException(409, "Матч уже начался")
    bankroll = storage.bankroll_status()
    if bankroll is None:
        raise HTTPException(409, "Сначала задайте банк")
    if bankroll["stopped"]:
        raise HTTPException(409, "Ставки приостановлены: сработала защита банка")
    reason = storage.limits_status()["reason"]
    if reason:
        raise HTTPException(409, reason)
    stake = pick["recommended_stake"] if pick["recommended_stake"] is not None else bankroll["suggested_stake"]
    storage.place(pick_id, stake, virtual=True)
    return _row(storage.get_pick(pick_id))


@app.get("/api/picks/open")
def get_open_picks(_owner: dict = Depends(require_owner)):
    return _rows(storage.list_open_picks())


@app.get("/api/limits")
def get_limits(_owner: dict = Depends(require_owner)):
    return storage.limits_status()


class LimitsIn(BaseModel):
    daily_limit: Optional[float] = Field(default=None, ge=0, le=1e9)
    pause: Optional[bool] = None


@app.post("/api/limits")
def set_limits(body: LimitsIn, _owner: dict = Depends(require_owner)):
    if body.daily_limit is not None:
        storage.set_setting("daily_limit", str(body.daily_limit))
    if body.pause is not None:
        until = datetime.now(timezone.utc) + timedelta(days=1)
        storage.set_setting("paused_until", until.isoformat() if body.pause else "")
    return storage.limits_status()


# --- The owner's Polymarket wallet: read-only, from its public address ----------


class WalletIn(BaseModel):
    address: str = Field(max_length=100)


def _wallet_status() -> dict:
    address = storage.get_setting("wallet_address")
    if not address:
        return {"connected": False}
    return wallet.portfolio(address, storage.get_setting("wallet_name") or "")


@app.get("/api/wallet")
def get_wallet(_owner: dict = Depends(require_owner)):
    return _wallet_status()


@app.post("/api/wallet")
def connect_wallet(body: WalletIn, _owner: dict = Depends(require_owner)):
    try:
        account = wallet.resolve(body.address)
    except wallet.WalletError as exc:
        raise HTTPException(400, str(exc))
    except (requests.RequestException, ValueError):
        raise HTTPException(502, "Polymarket не отвечает, кошелёк не подключён. Попробуйте позже")
    storage.set_setting("wallet_address", account["address"])
    storage.set_setting("wallet_name", account["name"])
    return _wallet_status()


@app.post("/api/wallet/delete")
def disconnect_wallet(_owner: dict = Depends(require_owner)):
    storage.set_setting("wallet_address", "")
    storage.set_setting("wallet_name", "")
    return {"connected": False}


# --- Forecasts ---------------------------------------------------------------

FORECAST_REUSE = timedelta(hours=6)  # each forecast is a paid, slow model call
_forecasts_running: set[str] = set()


class ForecastIn(BaseModel):
    home: str = Field(min_length=1, max_length=80)
    away: str = Field(min_length=1, max_length=80)
    league: Optional[str] = Field(default=None, max_length=80)


def _forecast_out(forecast: dict) -> dict:
    payload = forecast["payload"]
    return {
        "id": forecast["id"], "created_at": forecast["created_at"], "league": forecast["league"],
        "match": forecast["match"], "commence_time": forecast["commence_time"], "provider": forecast["provider"],
        "home_goals": forecast["home_goals"], "away_goals": forecast["away_goals"],
        "markets": payload.get("markets", {}), "facts": payload.get("facts", []),
        "facts_dropped": payload.get("facts_dropped", 0), "missing": payload.get("missing", []),
        "analysis_text": payload.get("analysis_text", ""), "url": payload.get("url"),
        "picks": _rows(storage.picks_for_match(forecast["match"])),
    }


@app.get("/api/forecasts")
def get_forecasts(limit: int = 50, _owner: dict = Depends(require_owner)):
    return [_forecast_out(f) for f in storage.recent_forecasts(min(limit, 200))]


@app.get("/api/forecast-scores")
def get_forecast_scores(_owner: dict = Depends(require_owner)):
    return storage.forecast_scores()


@app.post("/api/forecast")
async def make_forecast(body: ForecastIn, _owner: dict = Depends(require_owner)):
    match = f"{body.home} - {body.away}"
    recent = storage.latest_forecast(match)
    if recent and datetime.now(timezone.utc) - storage._parse_iso(recent["created_at"]) < FORECAST_REUSE:
        return _forecast_out(recent)
    if not connections.get_key(connections.llm_chain()[0]):
        raise HTTPException(409, "Подключите модель в настройках: нужен её ключ")
    if match in _forecasts_running:
        raise HTTPException(409, "Прогноз по этому матчу уже считается")
    _forecasts_running.add(match)
    try:
        result = await asyncio.to_thread(analysis.analyze_match, body.home, body.away, body.league)
    except Exception:
        log.exception("forecast failed")
        raise HTTPException(502, "Модель сейчас недоступна, попробуйте позже")
    finally:
        _forecasts_running.discard(match)
    if result.get("error"):
        raise HTTPException(502, result["error"])
    analysis.store_picks(result)
    return _forecast_out(storage.latest_forecast(result["match"]))


@app.post("/api/picks/{pick_id}/place")
async def place_pick(pick_id: int, _owner: dict = Depends(require_owner)):
    pick = storage.get_pick(pick_id)
    if pick is None:
        raise HTTPException(404, "Pick not found")
    if pick["status"] != "pending":
        raise HTTPException(409, "Pick already decided")

    bankroll = storage.bankroll_status()
    if bankroll is None or bankroll["stopped"]:
        raise HTTPException(409, "Bankroll not set or stake suggestions are stopped")

    # Same rule as bot.py's button_cb: use the stake already shown at
    # recommendation time (correlation-adjusted), not a fresh recompute —
    # otherwise a bankroll change between then and now could apply a
    # different number than what the user actually saw and agreed to.
    stake = pick["recommended_stake"] if pick["recommended_stake"] is not None else bankroll["suggested_stake"]
    storage.place(pick_id, stake)

    browser_opened = True
    try:
        await asyncio.to_thread(browser_session.open_bookmaker, connections.bookmaker_site())
    except Exception:
        log.exception("failed to open bookmaker browser")
        browser_opened = False

    result = _row(storage.get_pick(pick_id))
    result["browser_opened"] = browser_opened
    return result


# --- Connections: API keys, the active model, the bookmaker -----------------
# No route here ever returns a stored key, only a masked tail. Fixed paths are
# declared before /{name} so "llm" and "bookmaker" can't be read as a name.


class LlmChainIn(BaseModel):
    primary: str
    fallbacks: list[str] = []


class BookmakerIn(BaseModel):
    site: str


class ConnectionIn(BaseModel):
    key: Optional[str] = Field(default=None, max_length=500)
    base_url: Optional[str] = Field(default=None, max_length=300)
    model: Optional[str] = Field(default=None, max_length=120)


@app.get("/api/connections")
def list_connections(_owner: dict = Depends(require_owner)):
    return connections.status()


@app.post("/api/connections/llm")
def set_llm_chain(body: LlmChainIn, _owner: dict = Depends(require_owner)):
    try:
        connections.set_llm_chain(body.primary, body.fallbacks)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return connections.status()


@app.post("/api/connections/bookmaker")
def set_bookmaker(body: BookmakerIn, _owner: dict = Depends(require_owner)):
    try:
        connections.set_bookmaker_site(body.site)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return connections.status()


@app.post("/api/connections/bookmaker/open")
async def open_bookmaker_for_login(_owner: dict = Depends(require_owner)):
    """Opens the persistent Chrome profile so the owner can log in by hand.
    The password goes into the bookmaker's own page: this API never sees it."""
    try:
        await asyncio.to_thread(browser_session.open_bookmaker, connections.bookmaker_site())
    except Exception:
        log.exception("failed to open bookmaker browser")
        raise HTTPException(502, "Не удалось открыть браузер: API должен работать на компьютере с Chrome")
    return {"opened": True}


@app.post("/api/connections/{name}")
def save_connection(name: str, body: ConnectionIn, _owner: dict = Depends(require_owner)):
    try:
        connections.save(name, body.key, body.base_url, body.model)
    except connections.SecretNotConfigured as exc:
        raise HTTPException(503, str(exc))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return connections.status()


@app.post("/api/connections/{name}/test")
def test_connection(name: str, body: ConnectionIn, _owner: dict = Depends(require_owner)):
    try:
        return connections.test(name, body.key, body.base_url)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/connections/{name}/delete")
def delete_connection(name: str, _owner: dict = Depends(require_owner)):
    try:
        connections.delete(name)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return connections.status()
