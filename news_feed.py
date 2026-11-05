"""Recent football news for the two clubs, from free feeds that need no key.

Gives every LLM provider the same dated, linkable facts, however weak its own
search is. A feed failing just means fewer items: the forecast goes on, and the
model's own search still applies. Feed text is untrusted input: analysis.py hands
it to the model as data, and only headlines and summaries are kept.
"""

from __future__ import annotations

import logging
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import requests

from espn_data import BASE as ESPN_BASE, LEAGUES, league_key, team_tokens

log = logging.getLogger("shadowscout.news")

RSS_FEEDS = {
    "BBC Sport": "https://feeds.bbci.co.uk/sport/football/rss.xml",
    "The Guardian": "https://www.theguardian.com/football/rss",
    "Sky Sports": "https://www.skysports.com/rss/12040",
}
TIMEOUT = 15
CACHE_SECONDS = 600
MAX_AGE = timedelta(days=10)
MAX_ITEMS = 10
MAX_TEXT = 300
# Words that don't identify a club on their own. Manchester is the exception: "City" and "United" are what tell them apart.
_GENERIC = {"united", "city", "town", "hotspur", "real", "athletic", "rovers", "wanderers", "albion", "county", "fc"}

_cache: dict[str, tuple[float, list[dict]]] = {}


def _clean(text: str | None) -> str:
    return " ".join(re.sub(r"<[^>]+>", " ", text or "").split())[:MAX_TEXT]


def parse_rss(xml_text: str, source: str) -> list[dict]:
    items = []
    for node in ET.fromstring(xml_text).iter("item"):
        try:
            published = parsedate_to_datetime(node.findtext("pubDate") or "")
        except (TypeError, ValueError):
            continue
        if published.tzinfo is None:
            published = published.replace(tzinfo=timezone.utc)
        title = _clean(node.findtext("title"))
        if title:
            items.append({
                "source": source,
                "title": title,
                "summary": _clean(node.findtext("description")),
                "url": (node.findtext("link") or "").strip(),
                "published": published,
            })
    return items


def parse_espn(data: dict) -> list[dict]:
    items = []
    for article in data.get("articles") or []:
        try:
            published = datetime.fromisoformat(str(article.get("published")).replace("Z", "+00:00"))
        except ValueError:
            continue
        items.append({
            "source": "ESPN",
            "title": _clean(article.get("headline")),
            "summary": _clean(article.get("description")),
            "url": ((article.get("links") or {}).get("web") or {}).get("href") or "",
            "published": published,
        })
    return items


def _load(url: str, parse) -> list[dict]:
    now = time.monotonic()
    cached = _cache.get(url)
    if cached and now - cached[0] < CACHE_SECONDS:
        return cached[1]
    try:
        response = requests.get(url, timeout=TIMEOUT, headers={"User-Agent": "shadowscout/1.0"})
        response.raise_for_status()
        items = parse(response)
    except (requests.RequestException, ET.ParseError, ValueError) as exc:
        log.warning("news feed failed: %s", type(exc).__name__)
        return []
    _cache[url] = (now, items)
    return items


def _club_words(name: str) -> list[str]:
    tokens = team_tokens(name)
    if "manchester" in tokens:
        return tokens
    return [t for t in tokens if t not in _GENERIC] or tokens


def mentions(item: dict, team: str) -> bool:
    words = set(team_tokens(f"{item['title']} {item['summary']}"))
    return all(word in words for word in _club_words(team))


def select(items: list[dict], team_a: str, team_b: str, before: datetime, limit: int = MAX_ITEMS) -> list[dict]:
    """Newest first, only about these clubs, and nothing from after kick-off."""
    fresh = [
        item for item in items
        if before - MAX_AGE <= item["published"] <= before and (mentions(item, team_a) or mentions(item, team_b))
    ]
    fresh.sort(key=lambda item: item["published"], reverse=True)
    seen = set()
    unique = []
    for item in fresh:
        if item["title"] not in seen:
            seen.add(item["title"])
            unique.append(item)
    return unique[:limit]


def for_match(team_a: str, team_b: str, league_hint: str | None, kickoff: datetime | None = None) -> list[dict]:
    items: list[dict] = []
    for source, url in RSS_FEEDS.items():
        items += _load(url, lambda r, s=source: parse_rss(r.text, s))
    key = league_key(league_hint)
    if key:
        url = f"{ESPN_BASE}/{LEAGUES[key]['espn']}/news?limit=50"
        items += _load(url, lambda r: parse_espn(r.json()))
    now = datetime.now(timezone.utc)
    return select(items, team_a, team_b, min(kickoff, now) if kickoff else now)
