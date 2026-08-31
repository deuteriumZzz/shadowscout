"""Telegram front-end. The bot only ever *recommends* — placing the bet
happens in your own hands at the bookmaker; "Ставлю" additionally opens a
browser window there (see browser_session.py), logged in via your own
manual login, but never fills or submits the bet slip itself. "Ставлю"/
"Пропускаю" just record what you actually did, for tracking. Background jobs
handle closing-line capture (CLV, for every recommendation — not just placed
ones, see storage.py), a mid-window line-movement check, a settlement
proposal you confirm for placed picks, a silent auto-settle of non-placed
picks (no bankroll effect, just feeds CLV/calibration stats), a pre-kickoff
news recheck, and a scheduled league digest — none of them touch money or a
bookmaker account, they only read odds/news and message you."""

from __future__ import annotations

import asyncio
import logging
from datetime import time

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, MenuButtonWebApp, Update, WebAppInfo
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes

import bookmakers
import browser_session
import storage
from analysis import analyze_match, check_late_news, check_result, scan_league
from config import BOOKMAKER_ADAPTER, BOOKMAKER_SITE, MINIAPP_URL, ODDS_API_KEY, TELEGRAM_BOT_TOKEN

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("shadowscout")

TELEGRAM_MSG_LIMIT = 4000

CLV_INTERVAL = 900         # capture closing odds every 15 min
STEAM_INTERVAL = 1800       # check for pre-kickoff line movement every 30 min
SETTLEMENT_INTERVAL = 1800  # look for finished matches every 30 min
RESULT_TRACKING_INTERVAL = 1800  # auto-settle non-placed picks for stats, every 30 min
NEWS_INTERVAL = 900         # pre-kickoff news recheck every 15 min
DIGEST_TIME = time(9, 0)    # UTC — change if you want a different hour
DIGEST_DAYS = (4,)          # 0=Monday..6=Sunday — 4 is Friday

# A pick's model_probability vs poisson_probability disagreeing by more than
# this is surfaced to the user — not auto-blocked, since the LLM sees things
# (injuries, motivation) the goal-rate model can't, but worth a flag.
POISSON_DIVERGENCE_FLAG = 0.15

# A line move bigger than this (fraction of the original price) between pick
# time and the mid-window steam check is worth a heads-up.
STEAM_THRESHOLD = 0.03

HELP_TEXT = (
    "Я анализирую футбольные матчи (форма, травмы, тренер, мотивация, кэфы) и даю "
    "рекомендацию — ставите вы сами, у своего букмекера. Бот денег не трогает.\n\n"
    "/match Реал - Барселона [| Ла Лига] — разбор конкретного матча, рынки 1X2 и тоталы\n"
    "/league Ла Лига — сканирую ближайшие матчи лиги, присылаю только те, где есть edge против рынка "
    "(АПЛ, Ла Лига, Бундеслига, Серия А, Лига 1, Лига чемпионов, РПЛ — нужен ODDS_API_KEY)\n"
    "/digest Ла Лига, АПЛ — раз в пятницу в 09:00 UTC сам сканирую эти лиги и присылаю подборку\n"
    "/bankroll <сумма> — задать банк для расчёта размера ставки (по умолчанию 2% от банка, "
    "стоп при просадке 20% от пика ИЛИ при систематически отрицательном CLV)\n"
    "/settle <id> win|loss — отметить исход вручную (для placed-ставок бот также сам предложит "
    "подтвердить исход и зафиксирует закрывающую линию для CLV)\n"
    "/stats — winrate (с доверительным интервалом), ROI, CLV и калибровка (Brier/log-loss) "
    "по всем рекомендациям, не только по тем, что вы поставили\n\n"
    "Кэф в рекомендации помечен ⚠️, если это лучшая цена по рынку, а не подтверждённая цена вашего "
    "букмекера — задайте EXECUTION_BOOKMAKER, чтобы убрать пометку."
)


def _split_message(text: str) -> list[str]:
    return [text[i:i + TELEGRAM_MSG_LIMIT] for i in range(0, len(text), TELEGRAM_MSG_LIMIT)] or [text]


def _reply_sender(update: Update):
    async def send(text, reply_markup=None):
        await update.message.reply_text(text, reply_markup=reply_markup)
    return send


def _chat_sender(bot, chat_id):
    async def send(text, reply_markup=None):
        await bot.send_message(chat_id=chat_id, text=text, reply_markup=reply_markup)
    return send


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    storage.set_setting("chat_id", str(update.effective_chat.id))
    buttons = None
    if MINIAPP_URL:
        buttons = InlineKeyboardMarkup([[
            InlineKeyboardButton("📊 Открыть дашборд", web_app=WebAppInfo(url=MINIAPP_URL))
        ]])
    await update.message.reply_text(HELP_TEXT, reply_markup=buttons)


def _parse_match_args(raw: str) -> tuple[str, str, str | None] | None:
    if not raw or " - " not in raw:
        return None
    league = None
    if "|" in raw:
        raw, league = raw.split("|", 1)
        league = league.strip()
    team_a, team_b = (t.strip() for t in raw.split(" - ", 1))
    return team_a, team_b, league


async def _deliver_result(send, result: dict, league: str | None, *, full_text: bool):
    if full_text:
        for chunk in _split_message(result["analysis_text"]):
            await send(chunk)

    if not result["picks"]:
        if full_text:
            await send("Рекомендация: пропустить по всем рынкам — либо нет очевидного исхода, либо нет edge против рынка.")
        return

    bankroll = storage.bankroll_status()
    # Multiple picks on the same match (e.g. 1X2 + totals both clearing the
    # edge bar) are correlated outcomes, not independent bets — splitting the
    # unit stake across them keeps total exposure to one match capped at the
    # normal unit_pct instead of stacking it N times.
    n_correlated = len(result["picks"])

    for p in result["picks"]:
        stake_note = ""
        if bankroll is None:
            stake_note = "\n\nБанкролл не задан — /bankroll <сумма>, чтобы бот считал размер ставки."
        elif bankroll["stopped"]:
            if bankroll["drawdown_stopped"]:
                stake_note = (
                    f"\n\n⚠️ Просадка {bankroll['drawdown_pct']:.0f}% от пика банка ≥ стоп-лимита "
                    f"{bankroll['stop_loss_pct']:.0f}%. Новые ставки не предлагаю — сделайте паузу."
                )
            elif bankroll["clv_gated"]:
                stake_note = (
                    f"\n\n⚠️ Средний CLV за последние {storage.CLV_GATE_WINDOW} рекомендаций "
                    f"{bankroll['clv_gate_avg']:+.1f}% — модель систематически проигрывает закрывающей "
                    f"линии, это прямое свидетельство отсутствия edge. Новые ставки не предлагаю."
                )

        edge_pct = p["edge"] * 100
        price_note = "" if p["price_verified"] else " ⚠️ лучшая цена по рынку, не обязательно у вашего букмекера"
        summary = (
            f"{result['match']} [{p['market_label']}]\nПик: {p['pick'].upper()} | кэф {p['odds']}{price_note} | "
            f"edge против рынка: +{edge_pct:.1f}п.п. | уверенность: {p['confidence']}"
        )
        if p.get("poisson_probability") is not None:
            diff = p["model_probability"] - p["poisson_probability"]
            summary += f"\nПуассон-модель (независимая): {p['poisson_probability']:.0%}"
            if abs(diff) > POISSON_DIVERGENCE_FLAG:
                summary += f" ⚠️ расхождение с оценкой LLM: {diff:+.0%}"
        summary += stake_note

        recommended_stake = None
        if bankroll is not None and not bankroll["stopped"]:
            recommended_stake = bankroll["suggested_stake"]
            if n_correlated > 1:
                recommended_stake = round(recommended_stake / n_correlated, 2)

        pick_id = storage.save_pick(
            league=league, match=result["match"], market=p["market"], pick=p["pick"], odds=p["odds"],
            confidence=p["confidence"], reasoning="; ".join(result["key_factors"]),
            commence_time=result["commence_time"],
            model_probability=p["model_probability"], poisson_probability=p.get("poisson_probability"),
            price_verified=p["price_verified"], recommended_stake=recommended_stake,
        )

        buttons = None
        if recommended_stake is not None:
            correlation_note = f" (снижено — {n_correlated} коррелир. пика по этому матчу)" if n_correlated > 1 else ""
            summary += f"\nРекомендованный размер ставки: {recommended_stake}{correlation_note}"
            buttons = InlineKeyboardMarkup([[
                InlineKeyboardButton("Ставлю ✅", callback_data=f"place:{pick_id}"),
                InlineKeyboardButton("Пропускаю ❌", callback_data=f"skip:{pick_id}"),
            ]])

        await send(summary, buttons)


async def match_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    parsed = _parse_match_args(" ".join(context.args))
    if parsed is None:
        await update.message.reply_text("Формат: /match Команда А - Команда Б [| Лига]")
        return
    team_a, team_b, league = parsed

    await update.message.reply_text(f"Разбираю {team_a} — {team_b}, это может занять минуту...")
    try:
        result = await asyncio.to_thread(analyze_match, team_a, team_b, league)
    except Exception:
        log.exception("analysis failed")
        await update.message.reply_text("Не получилось получить разбор, попробуйте ещё раз чуть позже.")
        return

    await _deliver_result(_reply_sender(update), result, league, full_text=True)


async def league_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    league = " ".join(context.args).strip()
    if not league:
        await update.message.reply_text(
            "Формат: /league Ла Лига\nОсновные: АПЛ, Ла Лига, Бундеслига, Серия А, Лига 1, "
            "Лига чемпионов, РПЛ"
        )
        return

    await update.message.reply_text(
        f"Сканирую ближайшие матчи: {league}. Каждый матч разбирается отдельным запросом, "
        f"это может занять несколько минут."
    )
    try:
        results = await asyncio.to_thread(scan_league, league)
    except Exception:
        log.exception("league scan failed")
        await update.message.reply_text("Не получилось просканировать лигу.")
        return

    if not results:
        await update.message.reply_text(
            "Не нашёл матчей — проверьте название лиги или задайте ODDS_API_KEY (обязателен для /league, "
            "иначе неоткуда взять список предстоящих матчей)."
        )
        return

    with_value = [r for r in results if r["picks"]]
    await update.message.reply_text(f"Проверил {len(results)} матчей, есть value: {len(with_value)}.")
    for result in with_value:
        await _deliver_result(_reply_sender(update), result, league, full_text=False)
    if not with_value:
        await update.message.reply_text("По всем матчам — пропуск, нет edge против рынка.")


async def digest_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        current = storage.get_setting("digest_leagues")
        await update.message.reply_text(
            f"Текущие лиги дайджеста: {current or 'не заданы'}\nФормат: /digest Ла Лига, АПЛ"
        )
        return
    leagues = " ".join(context.args)
    storage.set_setting("digest_leagues", leagues)
    await update.message.reply_text(f"Дайджест по пятницам 09:00 UTC для: {leagues}")


async def button_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    parts = query.data.split(":")
    action, pick_id = parts[0], int(parts[1])

    if action == "skip":
        storage.set_status(pick_id, "skipped")
        await query.edit_message_text(query.message.text + "\n\n→ Пропущено.")
        return

    if action == "place":
        bankroll = storage.bankroll_status()
        if bankroll is None or bankroll["stopped"]:
            await query.edit_message_text(query.message.text + "\n\n→ Не отмечено: банкролл не задан или стоп-лимит.")
            return
        pick = storage.get_pick(pick_id)
        # use the stake shown in the original message (correlation-adjusted
        # at recommendation time), not a fresh bankroll_status() recompute —
        # otherwise a bankroll change between message and tap could apply a
        # different number than what the user actually saw and agreed to
        stake = pick["recommended_stake"] if pick is not None else bankroll["suggested_stake"]
        storage.place(pick_id, stake)
        try:
            await asyncio.to_thread(browser_session.open_bookmaker, BOOKMAKER_SITE)
            browser_note = f" Открыл {BOOKMAKER_SITE} — найдите матч и поставьте сами."
        except Exception:
            log.exception("failed to open bookmaker browser")
            browser_note = " Не удалось открыть браузер букмекера, поставьте вручную."
        await query.edit_message_text(
            query.message.text + f"\n\n→ Отмечено как поставлено ({stake})."
            f"{browser_note} После матча бот сам предложит подтвердить исход, "
            f"либо /settle {pick_id} win|loss вручную."
        )
        return

    if action == "confirm":
        result = parts[2]
        storage.settle(pick_id, result)
        await query.edit_message_text(query.message.text + f"\n\n→ Подтверждено: {result}.")
        return


async def bankroll_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        status = storage.bankroll_status()
        if status is None:
            await update.message.reply_text("Банкролл не задан. /bankroll <сумма>")
            return
        if not status["stopped"]:
            stake_text = str(status["suggested_stake"])
        elif status["drawdown_stopped"]:
            stake_text = "остановлено (просадка)"
        else:
            stake_text = "остановлено (CLV)"
        await update.message.reply_text(
            f"Банк: {status['capital']:.2f} (пик {status['peak']:.2f}), просадка {status['drawdown_pct']:.1f}%, "
            f"стоп-лимит {status['stop_loss_pct']:.0f}%, ставка сейчас: {stake_text}"
        )
        return
    try:
        amount = float(context.args[0])
    except ValueError:
        await update.message.reply_text("Формат: /bankroll 10000")
        return
    storage.init_bankroll(amount)
    await update.message.reply_text(f"Банк установлен: {amount:.2f}. Ставка по умолчанию — 2% от банка.")


async def settle_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if len(context.args) != 2 or context.args[1] not in ("win", "loss"):
        await update.message.reply_text("Формат: /settle <id> win|loss")
        return
    pick_id, result = int(context.args[0]), context.args[1]
    storage.settle(pick_id, result)
    await update.message.reply_text(f"Ставка {pick_id} отмечена: {result}.")


async def stats_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    s = storage.stats()
    if s["settled"] == 0:
        await update.message.reply_text("Пока нет закрытых ставок.")
        return
    lines = []
    if s["low_sample"]:
        lines.append(
            f"⚠️ Выборка мала ({s['settled']} закрытых, нужно {storage.MIN_SAMPLE_FOR_STATS}+) — "
            f"winrate/ROI ниже пока не показатель, могут быть шумом."
        )
    ci_lo, ci_hi = s["win_rate_ci"]
    lines.append(
        f"Всего закрыто: {s['settled']} | winrate: {s['win_rate']:.1f}% (95% ДИ {ci_lo:.0f}–{ci_hi:.0f}%) | "
        f"ROI на юнит: {s['roi']:+.1f}%"
    )
    if s["weighted_roi"] is not None:
        lines.append(f"ROI на реальный стейк: {s['weighted_roi']:+.1f}%")
    if s["price_verified_pct"] is not None and s["price_verified_pct"] < 100:
        lines.append(
            f"⚠️ Цена подтверждена у вашего букмекера только для {s['price_verified_pct']:.0f}% ставок — "
            f"остальные по best-of-market цене, ROI выше может быть недостижим. Задайте EXECUTION_BOOKMAKER."
        )
    if s["avg_clv"] is not None:
        lines.append(
            f"Средний CLV: {s['avg_clv']:+.1f}% (по {s['clv_sample']} рекомендациям, "
            f"не только по ставленным — это мера edge самой модели)"
        )
    if s["brier_score"] is not None:
        lines.append(
            f"Калибровка: Brier {s['brier_score']:.3f} (0=идеал, 0.25=монетка), "
            f"log-loss {s['log_loss']:.3f} (по {s['calibration_sample']} рекомендациям)"
        )
    lines.append("")
    lines.append("По лигам:")
    for league, b in s["by_league"].items():
        total = b["wins"] + b["losses"]
        wr = b["wins"] / total * 100 if total else 0
        lines.append(f"  {league}: {b['wins']}W/{b['losses']}L ({wr:.0f}%)")
    await update.message.reply_text("\n".join(lines))


async def clv_job(context: ContextTypes.DEFAULT_TYPE):
    adapter = bookmakers.get_adapter(BOOKMAKER_ADAPTER)
    for pick in storage.picks_awaiting_closing_line():
        team_a, team_b = (t.strip() for t in pick["match"].split(" - ", 1))
        data = adapter.get_market(team_a, team_b, pick["league"], pick["market"], ODDS_API_KEY)
        price, _ = adapter.price_for(data["event"], pick["market"], pick["pick"])
        if price is not None:
            storage.set_closing_odds(pick["id"], price)


async def steam_job(context: ContextTypes.DEFAULT_TYPE):
    """Mid-window line-movement check — an earlier, informational checkpoint
    than clv_job's final closing-line capture. Only for still-pending picks:
    a placed or skipped pick has already been decided, nothing to warn about."""
    chat_id = storage.get_setting("chat_id")
    if not chat_id:
        return
    adapter = bookmakers.get_adapter(BOOKMAKER_ADAPTER)
    for pick in storage.picks_awaiting_steam_check():
        storage.mark_steam_checked(pick["id"])
        if not pick["odds"]:
            continue
        team_a, team_b = (t.strip() for t in pick["match"].split(" - ", 1))
        data = adapter.get_market(team_a, team_b, pick["league"], pick["market"], ODDS_API_KEY)
        price, _ = adapter.price_for(data["event"], pick["market"], pick["pick"])
        if price is None:
            continue
        move = (price - pick["odds"]) / pick["odds"]
        if abs(move) < STEAM_THRESHOLD:
            continue
        direction = "в вашу сторону (цена упала — рынок согласен)" if move < 0 else "против вашего пика (цена выросла — рынок расходится)"
        await context.bot.send_message(
            chat_id=chat_id,
            text=(f"📈 {pick['match']} [{pick['market']}] движение линии {direction}: "
                  f"было {pick['odds']}, стало {price:.2f} ({move * 100:+.1f}%)."),
        )


async def settlement_job(context: ContextTypes.DEFAULT_TYPE):
    """Placed picks only — drives the explicit user-confirm flow, since a
    wrong auto-settle here would misapply real bankroll money."""
    chat_id = storage.get_setting("chat_id")
    if not chat_id:
        return
    for pick in storage.picks_awaiting_settlement():
        try:
            info = await asyncio.to_thread(check_result, pick["match"], pick["market"], pick["pick"])
        except Exception:
            log.exception("check_result failed for pick %s", pick["id"])
            continue
        result = info.get("pick_result")
        if not info.get("finished") or result not in ("win", "loss", "push"):
            continue
        buttons = InlineKeyboardMarkup([[
            InlineKeyboardButton(f"Подтвердить: {result} ✅", callback_data=f"confirm:{pick['id']}:{result}")
        ]])
        await context.bot.send_message(
            chat_id=chat_id,
            text=(f"{pick['match']} [{pick['market']}] — похоже, финальный счёт {info.get('final_score')}, "
                  f"пик '{pick['pick']}' → {result}. Подтвердите, если верно."),
            reply_markup=buttons,
        )


async def result_tracking_job(context: ContextTypes.DEFAULT_TYPE):
    """Auto-settles non-placed (pending/skipped) picks — no bankroll is at
    stake, so no user confirmation is needed, and no message is sent. Purely
    feeds CLV/calibration stats so they cover every recommendation the model
    made, not just the ones the user chose to bet on (see storage.stats())."""
    for pick in storage.picks_awaiting_result_tracking():
        try:
            info = await asyncio.to_thread(check_result, pick["match"], pick["market"], pick["pick"])
        except Exception:
            log.exception("check_result failed for untracked pick %s", pick["id"])
            continue
        result = info.get("pick_result")
        if not info.get("finished") or result not in ("win", "loss", "push"):
            continue
        storage.record_result(pick["id"], result)


async def news_job(context: ContextTypes.DEFAULT_TYPE):
    chat_id = storage.get_setting("chat_id")
    if not chat_id:
        return
    for pick in storage.picks_awaiting_news_check():
        try:
            news = await asyncio.to_thread(check_late_news, pick["match"])
        except Exception:
            log.exception("check_late_news failed for pick %s", pick["id"])
            continue
        storage.mark_news_checked(pick["id"])
        await context.bot.send_message(chat_id=chat_id, text=f"🕐 Перед стартом {pick['match']}: {news}")


async def digest_job(context: ContextTypes.DEFAULT_TYPE):
    chat_id = storage.get_setting("chat_id")
    leagues_raw = storage.get_setting("digest_leagues")
    if not chat_id or not leagues_raw:
        return
    send = _chat_sender(context.bot, chat_id)
    for league in (l.strip() for l in leagues_raw.split(",") if l.strip()):
        try:
            results = await asyncio.to_thread(scan_league, league)
        except Exception:
            log.exception("digest scan failed for %s", league)
            continue
        with_value = [r for r in results if r["picks"]]
        await send(f"Дайджест — {league}: {len(with_value)} матчей с value из {len(results)}.")
        for result in with_value:
            await _deliver_result(send, result, league, full_text=False)


async def _post_init(app: Application):
    if MINIAPP_URL:
        await app.bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(text="Дашборд", web_app=WebAppInfo(url=MINIAPP_URL))
        )


def main():
    storage.init_db()
    app = Application.builder().token(TELEGRAM_BOT_TOKEN).post_init(_post_init).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", start))
    app.add_handler(CommandHandler("match", match_cmd))
    app.add_handler(CommandHandler("league", league_cmd))
    app.add_handler(CommandHandler("digest", digest_cmd))
    app.add_handler(CommandHandler("bankroll", bankroll_cmd))
    app.add_handler(CommandHandler("settle", settle_cmd))
    app.add_handler(CommandHandler("stats", stats_cmd))
    app.add_handler(CallbackQueryHandler(button_cb))

    app.job_queue.run_repeating(clv_job, interval=CLV_INTERVAL, first=60)
    app.job_queue.run_repeating(steam_job, interval=STEAM_INTERVAL, first=80)
    app.job_queue.run_repeating(settlement_job, interval=SETTLEMENT_INTERVAL, first=90)
    app.job_queue.run_repeating(result_tracking_job, interval=RESULT_TRACKING_INTERVAL, first=100)
    app.job_queue.run_repeating(news_job, interval=NEWS_INTERVAL, first=120)
    app.job_queue.run_daily(digest_job, time=DIGEST_TIME, days=DIGEST_DAYS)

    app.run_polling()


if __name__ == "__main__":
    main()
