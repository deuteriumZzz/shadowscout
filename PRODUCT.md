# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: Next.js (App Router, client-heavy) for the frontend + a separate FastAPI service wrapping the existing `storage.py` for the backend. Chosen because storage.py's functions are synchronous and drop straight into FastAPI's threadpool with no rewrite, shadcn/ui needs a React framework, and the bot's own `python-telegram-bot` polling loop stays untouched by running as its own process.

## Users

A single user: the owner/operator of the shadowscout Telegram bot, opening the Mini App from inside Telegram (via the bot's menu button) to review and act on the bot's own betting recommendations. Not a multi-tenant product — no signup, no other accounts.

## Product Purpose

shadowscout analyzes upcoming football matches (form, injuries, coach, motivation, odds) and produces betting recommendations with a computed edge against the market. The bot already delivers these as Telegram messages with inline "Ставлю ✅ / Пропускаю ❌" buttons; the Mini App is a richer, persistent surface for the same underlying data — a dashboard to review the current recommendation feed, bankroll health, performance stats, and settled-bet history, and to take the same place/skip actions, without hunting through chat history.

## Positioning

Not a betting product and never places bets itself — it only recommends, and every action (marking "placed") is the user manually confirming what they already did at their own bookmaker. The differentiator versus a plain chat feed is persistent, structured state: bankroll status with its two independent stop conditions (drawdown, rolling CLV), and calibration/CLV metrics that measure whether the model's own probability estimates are honest — not just win/loss.

## Operating Context

Launched from inside Telegram (bot menu button / WebAppInfo), running in Telegram's in-app WebView on mobile or desktop Telegram. Auth is Telegram's own `initData` (HMAC-verified against the bot token), gated additionally to a single allowed Telegram user id — there is no separate login. The backend reads/writes the same SQLite file (`storage.py`'s `shadowscout.db`) that the bot's own background jobs (CLV capture, steam check, settlement, result tracking, digest) already read and write, so data can change under the Mini App at any time independent of user action — the UI polls rather than assuming it owns the only writer.

## Capabilities and Constraints

- Data model is fixed by the existing `storage.py` schema: picks (league, match, market, pick, odds, confidence, reasoning, status pending/placed/skipped, result win/loss/push, stake, commence_time, closing_odds, model_probability, poisson_probability, price_verified, recommended_stake), a single-row bankroll (capital, peak, unit_pct, stop_loss_pct), and a settings key/value table.
- The Mini App can trigger the same actions as the bot's inline buttons: mark a pick placed (with stake) or skipped, and — best-effort, same as `bot.py`'s `button_cb` — open the configured bookmaker site in a local browser via `browser_session.py` when marking placed (only meaningful when the API runs on the same desktop as the browser; failures there are non-fatal, matching the bot's own try/except behavior).
- Settling a result (win/loss/push) requiring bankroll adjustment stays a deliberate confirm action, mirroring the bot's `/settle` and settlement-job confirm button — never auto-applied from the Mini App.
- No new business logic: the Mini App is a read/act surface over existing `analysis.py`/`storage.py` behavior, not a reimplementation of edge calculation, calibration, or staking rules.
- Undecided: production hosting/domain for the FastAPI backend and the Next.js frontend (deployment specifics deferred to when the user is ready to publish the WebApp URL to BotFather).

## Brand Commitments

None. "shadowscout" has no existing logo or visual identity — the name is rendered as a text wordmark plus an icon (ball/scanner motif), not a designed mark to preserve.

## Evidence on Hand

The database currently has little to no settled history (bankroll likely unset, fewer than the 30 settled picks `storage.py` considers a reliable sample). Every list/stat view must have a real, considered empty state — not a placeholder assuming data exists — since that empty state is what the owner will actually see on first use.

## Product Principles

1. Operate mode, not Persuade: this is a task/data surface for one operator, not a pitch — scanability and correct state representation outrank expressive marketing moves.
2. Never imply an action the bot itself wouldn't take: the Mini App must respect the same stop conditions (drawdown stop, CLV gate) and never suggest a stake or auto-settle a result the backend logic wouldn't also produce.
3. Assume concurrent writers: background jobs mutate picks/bankroll independent of the Mini App session, so views poll and reconcile rather than trusting client-cached state as ground truth.
4. Every number is either real (from storage.py) or explicitly a "no data yet" state — never a placeholder/fake figure, since this is financial data the owner will act on.
5. Security is not cosmetic: the API is exposed on the public internet for Telegram to load it, so initData verification and the single-owner allowlist are load-bearing, not best-effort.

## Accessibility & Inclusion

Primary usage is one-handed on a phone inside Telegram's WebView: touch targets ≥44px, safe-area insets respected (Telegram's viewport can be inset by its own chrome), and the color system must carry win/loss/edge meaning through more than color alone (icons/text alongside the green/red) for colorblind legibility.
