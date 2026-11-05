"""Read-only view of the owner's Polymarket wallet, from its public address alone.

No key, no signature, and nothing here can move money. Positions and their value
come from Polymarket's public Data API; free cash is the wallet's pUSD balance
(Polymarket's collateral token), read straight from Polygon.

These are real figures or nothing: a part that can't be read comes back as None
with a reason, never as 0, since a false zero on a money screen is worse than a gap.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone

import requests

log = logging.getLogger("shadowscout.wallet")

GAMMA = "https://gamma-api.polymarket.com"
DATA_API = "https://data-api.polymarket.com/v2"
# https://docs.polymarket.com/resources/contracts
PUSD_TOKEN = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB"
PUSD_UNITS = 10 ** 6
POLYGON_NODES = ("https://polygon-bor-rpc.publicnode.com", "https://1rpc.io/matic")
BALANCE_OF = "0x70a08231"
TIMEOUT = 15
CACHE_SECONDS = 20
PAGE_SIZE = 100
CLOSED_SHOWN = 20

ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")

_cache: dict[str, tuple[float, dict]] = {}


class WalletError(ValueError):
    """What to tell the owner when an address can't be connected."""


def resolve(address: str) -> dict:
    """Finds the Polymarket account behind an address, which may be its own wallet
    address or the login wallet in front of it. Nothing unverified gets connected."""
    address = address.strip()
    if not ADDRESS.match(address):
        raise WalletError("Это не адрес кошелька: он начинается с 0x, дальше 40 символов")
    response = requests.get(f"{GAMMA}/public-profile", params={"address": address}, timeout=TIMEOUT)
    if response.status_code == 404:
        raise WalletError("На Polymarket нет профиля с этим адресом. Скопируйте его из своего профиля на сайте")
    response.raise_for_status()
    profile = response.json()
    proxy = profile.get("proxyWallet")
    if not proxy or not ADDRESS.match(proxy):
        raise WalletError("У этого профиля Polymarket нет кошелька")
    return {"address": proxy, "name": profile.get("name") or profile.get("pseudonym") or ""}


def _pusd_balance(address: str) -> float | None:
    data = BALANCE_OF + address[2:].lower().rjust(64, "0")
    payload = {"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": PUSD_TOKEN, "data": data}, "latest"]}
    for node in POLYGON_NODES:
        try:
            response = requests.post(node, json=payload, timeout=TIMEOUT)
            response.raise_for_status()
            return int(response.json()["result"], 16) / PUSD_UNITS
        except (requests.RequestException, KeyError, TypeError, ValueError) as exc:
            log.warning("Polygon node failed: %s", type(exc).__name__)
    return None


def _position(row: dict) -> dict:
    slug = row.get("event_slug")
    return {
        "title": row.get("title") or "Без названия",
        "outcome": row.get("outcome"),
        "status": row.get("status"),
        "avg_price": row.get("avg_price"),
        "price": row.get("current_price"),
        "value": row.get("current_value"),
        "cost": row.get("total_cost_usdc"),
        "pnl": row.get("unrealized_pnl"),
        "realized_pnl": row.get("realized_pnl"),
        "event_slug": slug,
        "url": f"https://polymarket.com/event/{slug}" if slug else None,
        "end_date": row.get("end_date"),
    }


def _get_data(path: str, params: dict) -> dict:
    response = requests.get(f"{DATA_API}/{path}", params=params, timeout=TIMEOUT)
    response.raise_for_status()
    return response.json()


def _still_worth_showing(row: dict) -> bool:
    # A lost position sits as "redeemable" at zero until it's archived: there's nothing left in it.
    return row.get("status") != "REDEEMABLE_LOST" and not (row.get("status") == "REDEEMABLE" and not row.get("current_value"))


def portfolio(wallet_address: str, name: str = "") -> dict:
    cached = _cache.get(wallet_address)
    if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
        return cached[1]

    errors = []
    positions_value = None
    positions = None
    closed = None
    truncated = False
    try:
        positions_value = _get_data("value", {"user": wallet_address})["data"]["value"]
    except (requests.RequestException, KeyError, TypeError, ValueError) as exc:
        log.warning("portfolio value failed: %s", type(exc).__name__)
        errors.append("Не удалось получить стоимость позиций")
    try:
        page = _get_data("positions", {"user": wallet_address, "limit": PAGE_SIZE})
        positions = [_position(r) for r in page["data"] if _still_worth_showing(r)]
        truncated = bool(page.get("pagination", {}).get("has_more"))
    except (requests.RequestException, KeyError, TypeError, ValueError) as exc:
        log.warning("positions failed: %s", type(exc).__name__)
        errors.append("Не удалось получить список позиций")
    try:
        page = _get_data("positions", {"user": wallet_address, "status": "CLOSED", "limit": CLOSED_SHOWN})
        closed = [_position(r) for r in page["data"]]
    except (requests.RequestException, KeyError, TypeError, ValueError) as exc:
        log.warning("closed positions failed: %s", type(exc).__name__)
        errors.append("Не удалось получить закрытые позиции")
    cash = _pusd_balance(wallet_address)
    if cash is None:
        errors.append("Не удалось прочитать свободный остаток из сети")

    known_pnl = [p["pnl"] for p in positions or [] if p["pnl"] is not None]
    result = {
        "connected": True,
        "address": wallet_address,
        "name": name,
        "cash": cash,
        "positions_value": positions_value,
        "total": cash + positions_value if cash is not None and positions_value is not None else None,
        "unrealized_pnl": sum(known_pnl) if positions is not None and not truncated else None,
        "positions": positions,
        "closed": closed,
        "truncated": truncated,
        "errors": errors,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if not errors:
        _cache[wallet_address] = (time.monotonic(), result)
    return result
