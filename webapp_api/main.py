"""FastAPI service exposing storage.py to the Telegram Mini App frontend.
Runs as its own process (`uvicorn webapp_api.main:app`), independent of
bot.py's polling loop — see PRODUCT.md's Stack section for why. Reads and
writes the same SQLite file bot.py's own background jobs use, so every
GET here is a live read, never a cache the Mini App owns on its own."""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import browser_session
import storage
from config import BOOKMAKER_SITE, MINIAPP_ORIGIN
from webapp_api.auth import require_owner

log = logging.getLogger("shadowscout.webapp_api")

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
        await asyncio.to_thread(browser_session.open_bookmaker, BOOKMAKER_SITE)
    except Exception:
        log.exception("failed to open bookmaker browser")
        browser_opened = False

    result = _row(storage.get_pick(pick_id))
    result["browser_opened"] = browser_opened
    return result
