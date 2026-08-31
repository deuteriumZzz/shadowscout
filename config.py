import os

from dotenv import load_dotenv

load_dotenv()

TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]

# Optional enrichers — bot works without them (Claude's own web search fills the
# gap), but odds/stats from real APIs are more reliable than a search result.
ODDS_API_KEY = os.environ.get("ODDS_API_KEY")
API_FOOTBALL_KEY = os.environ.get("API_FOOTBALL_KEY")

# Which bookmakers.py adapter supplies market odds — swap platforms by
# changing this one value, see bookmakers.py.
BOOKMAKER_ADAPTER = os.environ.get("BOOKMAKER_ADAPTER", "the_odds_api")

# Which llm_providers.py adapter does the analysis — "claude" (default,
# native web search, best quality) or "groq" (free tier, weaker + needs
# GROQ_API_KEY). See llm_providers.py.
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "claude")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")

# Extra confidence gate on top of the edge check: a pick must also have a
# model-estimated probability >= this to surface. 0 = off (edge alone
# decides). Football favorites rarely clear 70-75% true probability, so a
# high value here can legitimately mean "almost nothing ever qualifies" —
# that's not a bug, short-priced favorites are usually already fairly priced.
MIN_MODEL_PROBABILITY = float(os.environ.get("MIN_MODEL_PROBABILITY", "0"))

DB_PATH = os.environ.get("SHADOWSCOUT_DB", "shadowscout.db")

# De-vig method for the market's fair-probability baseline: "proportional"
# (default, spreads the vig evenly) or "shin" (Shin 1992 — corrects for the
# favorite-longshot bias, see odds.py). Shin is the sharper choice once
# you've eyeballed it against a few real markets; proportional stays the
# default because it's the simpler, longer-established baseline.
DEVIG_METHOD = os.environ.get("DEVIG_METHOD", "proportional")

# If set, use this bookmaker's own de-vigged price as the fair-probability
# anchor instead of the cross-book median (e.g. "pinnacle" if you've
# confirmed that key appears in your own Odds API response — don't guess
# it, check a live response first). Unset (default) uses the median.
REFERENCE_BOOKMAKER = os.environ.get("REFERENCE_BOOKMAKER") or None

# Minimum number of bookmakers that must be quoting a market before a pick
# on it is trusted — a single stale/outlier price masquerading as "edge" is
# not a signal. Ignored when REFERENCE_BOOKMAKER is used (a designated sharp
# book's own line doesn't need corroboration from others).
MIN_BOOKS_FOR_PICK = int(os.environ.get("MIN_BOOKS_FOR_PICK", "2"))

# Which browser_session.SITES entry to open (logged-in, via your own manual
# login) when you tap "Ставлю" — bot.py only navigates there, it never
# fills or submits the bet slip itself. Requires a Chrome/display on the
# machine running bot.py (i.e. run it on your desktop, not a headless VPS).
BOOKMAKER_SITE = os.environ.get("BOOKMAKER_SITE", "leon")

# The Odds API's own key for that same bookmaker (its namespace doesn't
# match BOOKMAKER_SITE's — e.g. Odds API may call it "leonbets", not "leon".
# Verify against a live API response before setting this, don't guess it).
# When set and the book is quoting this event, the "кэф" shown/recorded is
# THAT book's own price — not a best-of-market composite you might not
# actually be able to get at the one book BOOKMAKER_SITE opens for you.
# Unset (default): every price is best-of-market and flagged unverified.
EXECUTION_BOOKMAKER = os.environ.get("EXECUTION_BOOKMAKER") or None

# --- Telegram Mini App (webapp_api/) -----------------------------------
# Numeric Telegram user id of the bot's owner — the only identity the Mini
# App API will accept, regardless of how well-formed a request's initData
# is. Required to run webapp_api (not required for bot.py alone), since
# unlike the bot itself (which only replies in the chat that messaged it)
# the API is reachable by anyone who can reach its URL.
OWNER_TELEGRAM_ID = int(os.environ["OWNER_TELEGRAM_ID"]) if os.environ.get("OWNER_TELEGRAM_ID") else None

# Comma-separated allowed CORS origin(s) for the Mini App frontend, e.g.
# "https://shadowscout-miniapp.vercel.app". Required to run webapp_api.
MINIAPP_ORIGIN = os.environ.get("MINIAPP_ORIGIN") or None

# Public HTTPS URL of the deployed Mini App frontend — bot.py points its
# menu button / WebAppInfo here. Unset: no menu button is registered.
MINIAPP_URL = os.environ.get("MINIAPP_URL") or None
