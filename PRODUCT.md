# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: Next.js (App Router, client-heavy) for the frontend + a separate FastAPI service (`shadowscout/api/`) over `shadowscout/storage.py`. Chosen because storage's functions are synchronous and drop straight into FastAPI's threadpool, and the bot's own `python-telegram-bot` polling loop stays untouched by running as its own process.

## Users

A single user: the owner/operator of the shadowscout Telegram bot, opening the Mini App from inside Telegram (via the bot's menu button). Not a multi-tenant product: no signup, no other accounts.

## Product Purpose

shadowscout estimates upcoming football matches and compares the estimate with the market. The Mini App is the main surface: real matches and Polymarket prices, the match screen, forecasts, a read-only wallet, bets without money, bank limits, and the statistics that show whether the model is any good.

## Positioning

Never places bets by itself. The model estimates probabilities and code decides, so it can't simply agree with a bet. The differentiator versus a plain tipster is measurement: every forecast is stored and scored against the market and the result, and calibration/CLV show whether the estimates are honest, not just win/loss.

## Operating Context

Launched from inside Telegram (bot menu button / WebAppInfo), in Telegram's in-app WebView on mobile or desktop. Auth is Telegram's own `initData` (HMAC-verified against the bot token), gated additionally to a single allowed Telegram user id. The API reads/writes the same SQLite file the bot's background jobs use, so data can change at any time independent of the user: the UI polls rather than assuming it owns the only writer.

## Capabilities and Constraints

- Data lives in `storage.py`'s SQLite schema: picks, forecasts and their scores, bankroll, limits, settings.
- Match data comes from ESPN, prices from Polymarket, both without keys. LLM and optional football API keys are pasted in the app and stored encrypted (`connections.py`).
- The forecast logic lives in `shadowscout/forecast/`. The frontend shows its results and never reimplements edge calculation, calibration or staking.
- The wallet is read-only from a public address. A seed phrase or private key is never asked for or accepted.
- No bookmaker passwords stored, no browser auto-clicks, no antidetect or captcha bypass. No personal data sent to the LLM.
- Real bets only after the model proves itself, with limits and confirmation.
- Settling a real result that adjusts the bank stays a deliberate confirm.
- Undecided: production hosting/domain for the API and the frontend.

## Brand Commitments

None. "shadowscout" has no existing logo or visual identity: the name is a text wordmark.

## Evidence on Hand

The database starts with little or no settled history. Every list and stat view must have a real, considered empty state, since that's what the owner will see on first use. The forecast thresholds are hand-picked and not yet measured; the verdict on the model comes after 300 scored forecasts.

## Product Principles

1. Operate mode, not Persuade: scanability and correct state outrank expressive marketing moves.
2. Never imply an action the backend wouldn't take: respect the same stop conditions, never suggest a stake or settle a result on the client.
3. Assume concurrent writers: views poll and reconcile rather than trusting client-cached state.
4. Every number is real or explicitly "нет данных". Never a placeholder, a demo figure or a 0 standing in for a failure, since the owner will act on it.
5. Security is not cosmetic: the API is on the public internet for Telegram to load it, so initData verification and the single-owner allowlist are load-bearing.
6. No reward for betting: no celebration for placing a bet, no nudge to bet more or chase a loss.

## Accessibility & Inclusion

Primary usage is one-handed on a phone inside Telegram's WebView: touch targets ≥44px, safe-area insets respected, and win/loss/edge meaning carried through more than color alone (icons/text alongside green/red).
