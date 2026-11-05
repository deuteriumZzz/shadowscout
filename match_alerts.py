"""Telegram messages about the matches you hold a bet on: kick-off, goals, the final.

Facts from ESPN, no model involved. The state last told is stored per bet, so a
restart neither repeats a message nor invents one: the first time a match is seen
already under way, it's only recorded.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

import requests

import espn_data
import storage

log = logging.getLogger("shadowscout.alerts")

WATCH_BEFORE = timedelta(minutes=20)
WATCH_AFTER = timedelta(hours=4)


def enabled(kind: str) -> bool:
    return storage.get_setting(f"alerts_{kind}") != "0"


def settings() -> dict:
    return {"kickoff": enabled("kickoff"), "goals": enabled("goals")}


def set_settings(kickoff: bool | None = None, goals: bool | None = None) -> dict:
    for kind, value in (("kickoff", kickoff), ("goals", goals)):
        if value is not None:
            storage.set_setting(f"alerts_{kind}", "1" if value else "0")
    return settings()


def _pick_label(pick) -> str:
    home, away = pick["match"].split(" - ", 1)
    if pick["market"] == "totals":
        return f"{'больше' if pick['pick'] == 'over' else 'меньше'} {pick['line']}"
    return {"home": f"победа {home}", "away": f"победа {away}", "draw": "ничья"}.get(pick["pick"], pick["pick"])


def _mood(pick, scorer_side: str) -> str:
    """Whether the goal helps the bet. Only said where it's plain: a goal doesn't decide a total or a draw on its own."""
    if pick["market"] == "h2h" and pick["pick"] in ("home", "away"):
        return "в пользу вашей ставки" if pick["pick"] == scorer_side else "против вашей ставки"
    return ""


def messages_for(pick, before: dict | None, now_state: dict, kickoff_on: bool = True, goals_on: bool = True) -> list[str]:
    """What changed between what was last told and now. `now_state` has state, home and
    away in the stored match's order."""
    if before is None:
        # First sight. Only a match that hasn't started yet gets a kick-off message later on.
        return []
    home, away = pick["match"].split(" - ", 1)
    score = f"{home} {now_state['home']}:{now_state['away']} {away}"
    label = _pick_label(pick)
    out = []
    if before["state"] == "pre" and now_state["state"] == "in" and kickoff_on:
        out.append(f"Матч начался: {home} — {away}. Ваша ставка: {label}.")
    if goals_on and (now_state["home"] > before["home"] or now_state["away"] > before["away"]):
        scorer = "home" if now_state["home"] > before["home"] else "away"
        mood = _mood(pick, scorer)
        out.append(f"Гол! {score}" + (f", {mood}." if mood else "."))
    if before["state"] != "post" and now_state["state"] == "post":
        out.append(f"Финал: {score}. Ваша ставка: {label}. Результат скоро появится в приложении.")
    return out


def _state_for(pick) -> dict | None:
    home, away = (t.strip() for t in pick["match"].split(" - ", 1))
    kickoff = datetime.fromisoformat(pick["commence_time"].replace("Z", "+00:00"))
    game = espn_data.find_game(home, away, pick["league"], kickoff)
    if not game:
        return None
    goals_home, goals_away = game["home"]["score"] or 0, game["away"]["score"] or 0
    if not espn_data.same_team(game["home"]["name"], home):
        goals_home, goals_away = goals_away, goals_home
    # Only a game ESPN calls complete is final: a postponed one is "post" too, without being played.
    if game["state"] == "post" and not game["completed"]:
        return None
    return {"state": game["state"], "home": goals_home, "away": goals_away}


def due_messages() -> list[str]:
    """One pass over open bets near their kick-off, for the bot's minute job."""
    now = datetime.now(timezone.utc)
    kickoff_on, goals_on = enabled("kickoff"), enabled("goals")
    out: list[str] = []
    for pick in storage.list_open_picks():
        if not pick["commence_time"]:
            continue
        kickoff = datetime.fromisoformat(pick["commence_time"].replace("Z", "+00:00"))
        if not kickoff - WATCH_BEFORE <= now <= kickoff + WATCH_AFTER:
            continue
        key = f"alert:{pick['id']}"
        raw = storage.get_setting(key)
        before = json.loads(raw) if raw else None
        try:
            state = _state_for(pick)
        except (requests.RequestException, ValueError) as exc:
            log.warning("alert check failed: %s", type(exc).__name__)
            continue
        if state is None or state == before:
            continue
        out += messages_for(pick, before, state, kickoff_on, goals_on)
        storage.set_setting(key, json.dumps(state))
    return out
