"""API keys, the active LLM and the bookmaker, changeable from the Mini App.

Keys saved in the app are encrypted in the same SQLite `settings` table and
override .env; a key only in .env still works, so nothing has to be migrated.
Read on every call, so bot.py and webapp_api (separate processes over one
database) both pick a change up on their next call, without a restart.

Three values stay in .env because they're needed before anyone can log in:
TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_ID and SHADOWSCOUT_SECRET_KEY itself.

Bookmaker passwords are deliberately not handled here. The owner logs in by hand
in the persistent Chrome profile (see browser_session.py), so no password ever
reaches this code, and nothing here can place a bet.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import secrets

import requests
from cryptography.fernet import Fernet, InvalidToken

import storage

log = logging.getLogger("shadowscout.connections")

SECRET_ENV = "SHADOWSCOUT_SECRET_KEY"
TIMEOUT = 15

CATALOG = {
    "claude": {"label": "Claude", "group": "llm", "env": "ANTHROPIC_API_KEY", "search": "native", "hint": "console.anthropic.com"},
    "gemini": {"label": "Gemini", "group": "llm", "env": "GEMINI_API_KEY", "search": "native", "hint": "aistudio.google.com, есть бесплатный тариф"},
    "groq": {"label": "Groq", "group": "llm", "env": "GROQ_API_KEY", "search": "duckduckgo", "hint": "console.groq.com, есть бесплатный тариф"},
    "openai": {"label": "Другая модель", "group": "llm", "env": None, "search": "duckduckgo", "hint": "OpenAI, OpenRouter, DeepSeek или своя: адрес API и название модели", "custom": True},
    "espn": {"label": "ESPN", "group": "football", "env": None, "keyless": True, "hint": "Live, события, составы, статистика. Без ключа, но API неофициальный"},
    "football_data": {"label": "football-data.org", "group": "football", "env": "FOOTBALL_DATA_TOKEN", "hint": "Бесплатно: 12 турниров, расписание и таблицы. Счёт с задержкой"},
    "striker": {"label": "StrikerAPI", "group": "football", "env": "STRIKERAPI_API_KEY", "hint": "xG для прогноза. Бесплатно: strikerapi.com, 500 кредитов в месяц, без карты"},
    "api_football": {"label": "API-Football", "group": "football", "env": "API_FOOTBALL_KEY", "hint": "Необязательно: только для проверки на истории. Бесплатный ключ текущий сезон не отдаёт"},
    "odds_api": {"label": "The Odds API", "group": "odds", "env": "ODDS_API_KEY", "hint": "Необязательно: цены и так идут с Polymarket. Кэфы букмекеров для сравнения"},
}

BOOKMAKER_SITES = ("1xbet", "fonbet", "bet365", "leon", "winline")


class SecretNotConfigured(RuntimeError):
    """Saving is refused rather than falling back to storing a key in plain text."""


def _entry(name: str) -> dict:
    if name not in CATALOG:
        raise ValueError(f"Неизвестное подключение: {name}")
    return CATALOG[name]


def _secret() -> str | None:
    """From the environment if set, otherwise generated once and kept in a private
    file beside the database, so pasting a key in the app needs no setup. Never in
    the database itself: a copy of that alone must not reveal the keys. Losing the
    file only means entering the keys again (see _decrypt)."""
    secret = os.environ.get(SECRET_ENV)
    if secret:
        return secret
    path = f"{storage.DB_PATH}.secret"
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        try:
            with open(path, encoding="utf-8") as f:
                return f.read().strip() or None
        except OSError:
            return None
    except OSError:
        log.warning("can't create the key-encryption secret file")
        return None
    secret = secrets.token_urlsafe(32)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(secret)
    return secret


def _fernet() -> Fernet | None:
    secret = _secret()
    if not secret:
        return None
    # ponytail: a plain hash is enough for a generated random secret, a human
    # passphrase here would want a real KDF.
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))


def _decrypt(token: str) -> str | None:
    fernet = _fernet()
    if not fernet:
        return None
    try:
        return fernet.decrypt(token.encode()).decode()
    except InvalidToken:
        # The secret changed: the key is unreadable, not wrong. status() asks to re-enter it.
        log.warning("a stored API key can't be decrypted with the current secret")
        return None


def get_key(name: str) -> str | None:
    entry = _entry(name)
    token = storage.get_setting(f"secret:{name}")
    key = _decrypt(token) if token else None
    if key:
        return key
    return os.environ.get(entry["env"]) if entry["env"] else None


def _option(name: str, field: str) -> str | None:
    return storage.get_setting(f"conn:{name}:{field}") or None


def get_model(name: str) -> str | None:
    return _option(name, "model")


def get_base_url(name: str) -> str | None:
    return _option(name, "base_url")


def _check_base_url(url: str) -> str:
    url = url.strip().rstrip("/")
    local = url.startswith(("http://localhost", "http://127.0.0.1"))
    if not (url.startswith("https://") or local):
        raise ValueError("Адрес API должен начинаться с https://")
    return url


def save(name: str, key: str | None, base_url: str | None = None, model: str | None = None) -> None:
    entry = _entry(name)
    if entry.get("keyless"):
        raise ValueError(f"{entry['label']} работает без ключа")
    if entry.get("custom"):
        if not (base_url or get_base_url(name)) or not (model or get_model(name)):
            raise ValueError("Укажите адрес API и название модели")
    if base_url:
        storage.set_setting(f"conn:{name}:base_url", _check_base_url(base_url))
    if model is not None:
        storage.set_setting(f"conn:{name}:model", model.strip())
    key = (key or "").strip()
    if not key:
        return
    fernet = _fernet()
    if not fernet:
        raise SecretNotConfigured(f"Не удалось создать секрет шифрования. Проверьте права на папку базы или задайте {SECRET_ENV}, чтобы ключи можно было хранить зашифрованными")
    storage.set_setting(f"secret:{name}", fernet.encrypt(key.encode()).decode())


def delete(name: str) -> None:
    _entry(name)
    for setting in (f"secret:{name}", f"conn:{name}:base_url", f"conn:{name}:model"):
        storage.set_setting(setting, "")
    primary, fallbacks = llm_chain()
    if name in fallbacks:
        storage.set_setting("llm_fallback", ",".join(f for f in fallbacks if f != name))
    if name == primary:
        storage.set_setting("llm_primary", "")


def _mask(key: str) -> str:
    return f"••••{key[-4:]}" if len(key) >= 12 else "••••"


def _describe(name: str, entry: dict) -> dict:
    token = storage.get_setting(f"secret:{name}")
    stored = _decrypt(token) if token else None
    env_key = os.environ.get(entry["env"]) if entry["env"] else None
    source = "keyless" if entry.get("keyless") else "app" if stored else "env" if env_key else "none"
    key = stored or env_key
    return {
        "name": name,
        "label": entry["label"],
        "group": entry["group"],
        "hint": entry["hint"],
        "source": source,
        "connected": source != "none",
        "masked": _mask(key) if key else None,
        "search": entry.get("search"),
        "custom": bool(entry.get("custom")),
        "model": get_model(name),
        "base_url": get_base_url(name),
        "needs_reentry": bool(token) and not stored,
    }


def status() -> dict:
    primary, fallbacks = llm_chain()
    return {
        "items": [_describe(name, entry) for name, entry in CATALOG.items()],
        "primary": primary,
        "fallbacks": fallbacks,
        "bookmaker": {"site": bookmaker_site(), "sites": list(BOOKMAKER_SITES)},
        "can_store": _fernet() is not None,
    }


def llm_chain() -> tuple[str, list[str]]:
    from config import LLM_FALLBACK_PROVIDERS, LLM_PROVIDER

    primary = storage.get_setting("llm_primary") or LLM_PROVIDER
    stored = storage.get_setting("llm_fallback")
    raw = stored if stored is not None else LLM_FALLBACK_PROVIDERS
    return primary, [p.strip() for p in raw.split(",") if p.strip() and p.strip() != primary]


def set_llm_chain(primary: str, fallbacks: list[str]) -> None:
    for name in [primary, *fallbacks]:
        entry = _entry(name)
        if entry["group"] != "llm":
            raise ValueError(f"{entry['label']} не языковая модель")
        if not get_key(name):
            raise ValueError(f"Сначала подключите {entry['label']}")
    storage.set_setting("llm_primary", primary)
    storage.set_setting("llm_fallback", ",".join(f for f in fallbacks if f != primary))


def bookmaker_site() -> str:
    from config import BOOKMAKER_SITE

    return storage.get_setting("bookmaker_site") or BOOKMAKER_SITE


def set_bookmaker_site(site: str) -> None:
    if site not in BOOKMAKER_SITES:
        raise ValueError(f"Неизвестный букмекер: {site}")
    storage.set_setting("bookmaker_site", site)


def _probe(name: str, key: str | None, base_url: str | None) -> requests.Response:
    """The cheapest request that proves a key works."""
    if name == "espn":
        return requests.get("https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard", timeout=TIMEOUT)
    if name == "claude":
        return requests.get("https://api.anthropic.com/v1/models", headers={"x-api-key": key, "anthropic-version": "2023-06-01"}, timeout=TIMEOUT)
    if name == "gemini":
        return requests.get("https://generativelanguage.googleapis.com/v1beta/models", headers={"x-goog-api-key": key}, timeout=TIMEOUT)
    if name == "groq":
        return requests.get("https://api.groq.com/openai/v1/models", headers={"Authorization": f"Bearer {key}"}, timeout=TIMEOUT)
    if name == "openai":
        return requests.get(f"{base_url}/models", headers={"Authorization": f"Bearer {key}"}, timeout=TIMEOUT)
    if name == "football_data":
        return requests.get("https://api.football-data.org/v4/competitions", headers={"X-Auth-Token": key}, timeout=TIMEOUT)
    if name == "api_football":
        return requests.get("https://v3.football.api-sports.io/status", headers={"x-apisports-key": key}, timeout=TIMEOUT)
    if name == "striker":
        # The one probe that spends quota: 1 credit, there's no free endpoint to try.
        return requests.post("https://mcp.strikerapi.com/v1/list_teams", json={}, headers={"x-api-key": key}, timeout=TIMEOUT)
    if name == "odds_api":
        return requests.get("https://api.the-odds-api.com/v4/sports", params={"apiKey": key}, timeout=TIMEOUT)
    raise ValueError(f"Неизвестное подключение: {name}")


def test(name: str, key: str | None = None, base_url: str | None = None) -> dict:
    """Checks a key just typed, or the saved one. Messages never echo the
    request: a key can sit in its URL, and an exception's text would carry it."""
    entry = _entry(name)
    key = (key or "").strip() or get_key(name)
    if entry.get("custom"):
        base_url = _check_base_url(base_url) if base_url else get_base_url(name)
        if not base_url:
            return {"ok": False, "detail": "Укажите адрес API"}
    if not key and not entry.get("keyless"):
        return {"ok": False, "detail": "Ключ не указан"}
    try:
        response = _probe(name, key, base_url)
    except requests.RequestException as exc:
        return {"ok": False, "detail": f"Сервис не отвечает ({type(exc).__name__})"}
    # football-data.org answers 400, not 401, to a malformed token.
    if response.status_code in (401, 403) or (name == "football_data" and response.status_code == 400):
        return {"ok": False, "detail": "Ключ не подошёл"}
    if response.status_code == 429:
        return {"ok": False, "detail": "Лимит запросов исчерпан, ключ при этом рабочий"}
    if not response.ok:
        return {"ok": False, "detail": f"Сервис ответил ошибкой {response.status_code}"}
    if name == "api_football":
        # API-Football answers 200 even for a bad key, with the reason in the body.
        try:
            if response.json().get("errors"):
                return {"ok": False, "detail": "Ключ не подошёл"}
        except ValueError:
            return {"ok": False, "detail": "Сервис вернул непонятный ответ"}
    return {"ok": True, "detail": "Подключение работает"}
