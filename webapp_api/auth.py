"""Telegram WebApp initData verification — the Mini App's only auth
mechanism (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
Every request must carry the raw initData string; this HMACs it against
the bot token, checks freshness, and rejects anyone but OWNER_TELEGRAM_ID —
unlike the bot itself (which only ever replies in the chat that messaged
it), this API is reachable by anyone who can reach its URL, so the
owner-id check is load-bearing, not a formality."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

from fastapi import Header, HTTPException

from config import EXTENSION_API_TOKEN, OWNER_TELEGRAM_ID, TELEGRAM_BOT_TOKEN

# How long an initData payload stays acceptable after Telegram signed it —
# see PRODUCT.md's Operating Context. Generous on purpose: a Mini App
# session can sit open in the background for a while.
MAX_INIT_DATA_AGE = 86400


def verify_init_data(init_data: str) -> dict:
    """Returns the verified Telegram user dict, or raises 401/403."""
    pairs = dict(parse_qsl(init_data))
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise HTTPException(401, "initData missing hash")

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret_key = hmac.new(b"WebAppData", TELEGRAM_BOT_TOKEN.encode(), hashlib.sha256).digest()
    computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(computed_hash, received_hash):
        raise HTTPException(401, "initData signature invalid")

    try:
        auth_date = int(pairs["auth_date"])
    except (KeyError, ValueError):
        raise HTTPException(401, "initData missing auth_date")
    if time.time() - auth_date > MAX_INIT_DATA_AGE:
        raise HTTPException(401, "initData expired — reopen the Mini App")

    try:
        user = json.loads(pairs["user"])
    except (KeyError, json.JSONDecodeError):
        raise HTTPException(401, "initData missing user")

    if OWNER_TELEGRAM_ID is None:
        raise HTTPException(500, "OWNER_TELEGRAM_ID not configured on the server")
    if user.get("id") != OWNER_TELEGRAM_ID:
        raise HTTPException(403, "Not authorized for this bot")

    return user


async def require_owner(authorization: str = Header(...)) -> dict:
    """FastAPI dependency. Expects `Authorization: tma <initData>` —
    Telegram's own documented convention for this header."""
    scheme, _, init_data = authorization.partition(" ")
    if scheme.lower() != "tma" or not init_data:
        raise HTTPException(401, "Expected 'Authorization: tma <initData>'")
    return verify_init_data(init_data)


async def require_extension_token(authorization: str = Header(...)) -> None:
    """FastAPI dependency for extension/ (the bet-slip auto-fill browser
    extension) — it runs on the bookmaker's own site, not inside Telegram,
    so it has no initData and authenticates with a plain shared secret
    instead. Expects `Authorization: Bearer <EXTENSION_API_TOKEN>`."""
    if not EXTENSION_API_TOKEN:
        raise HTTPException(500, "EXTENSION_API_TOKEN not configured on the server")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(401, "Expected 'Authorization: Bearer <token>'")
    if not hmac.compare_digest(token, EXTENSION_API_TOKEN):
        raise HTTPException(403, "Invalid extension token")
