"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ExternalLink, Sparkles, Wand2, X } from "lucide-react";
import { useMutationState } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore, type MouseEvent } from "react";
import { Ball, LeagueLogo, M } from "./fx";
import { useGame } from "./store";
import { useAcceptPick, useBankroll, useForecasts, useLimits, useMakeForecast, useSkipPick } from "@/hooks/use-shadowscout";
import { ApiError } from "@/lib/api";
import { getWebApp, haptic } from "@/lib/telegram";
import type { Forecast, ForecastMarket, Pick } from "@/lib/types";

const percent = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);

export function errorText(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Откройте приложение из Telegram: так оно узнаёт владельца.";
    return error.message;
  }
  return "Сервер приложения не отвечает. Проверьте, что он запущен.";
}

export function openLink(url: string) {
  haptic("light");
  const tg = getWebApp() as unknown as { initData?: string; openLink?: (u: string) => void } | undefined;
  if (tg?.initData && tg.openLink) tg.openLink(url);
  else window.open(url, "_blank", "noopener");
}

/** Names an outcome the way a person would: the club, not "home". */
export function pickName(match: string, market: string, pick: string, line?: number | null) {
  const [home, away] = match.split(" - ");
  if (market === "totals") return `${pick === "over" ? "Больше" : "Меньше"} ${line ?? ""}`.trim();
  return pick === "home" ? `Победа ${home}` : pick === "away" ? `Победа ${away}` : "Ничья";
}

const MARKET_TITLE: Record<string, string> = { h2h: "Исход матча", totals: "Тотал голов" };

const reveal = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};
const revealItem = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: M.spring.snappy },
};

/** Two thin bars under an outcome: what the model says against the market. The numbers sit beside them. */
function OutcomeBars({ model, market }: { model?: number; market?: number }) {
  if (model === undefined || market === undefined) return null;
  const left = Math.min(model, market) * 100;
  const width = Math.abs(model - market) * 100;
  return (
    <span className="pn-scale" aria-hidden="true">
      <motion.span className="pn-scale__gap" style={{ left: `${left}%`, width: `${width}%`, background: model >= market ? "var(--accent)" : "var(--tx2)", opacity: 0.45 }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ ...M.spring.gentle, delay: 0.25 }} />
      <motion.span className="pn-scale__dot" style={{ left: `${market * 100}%`, background: "var(--away)" }} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...M.spring.bouncy, delay: 0.12 }} />
      <motion.span className="pn-scale__dot" style={{ left: `${model * 100}%`, background: "var(--accent)" }} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...M.spring.bouncy, delay: 0.18 }} />
    </span>
  );
}

function MarketRows({ forecast, marketKey, market }: { forecast: Forecast; marketKey: string; market: ForecastMarket }) {
  const outcomes = Object.keys(market.estimate ?? market.fair ?? {});
  return (
    <div className="pn-stack" style={{ gap: 6 }}>
      <b style={{ fontWeight: 600 }}>{MARKET_TITLE[marketKey] ?? marketKey}{market.line ? ` ${market.line}` : ""}</b>
      {outcomes.length > 0 && (
        <table className="pn-table">
          <thead>
            <tr>
              <th>Исход</th>
              <th style={{ whiteSpace: "nowrap" }}><i className="pn-swatch" style={{ background: "var(--accent)" }} aria-hidden="true" />Модель</th>
              <th style={{ whiteSpace: "nowrap" }}><i className="pn-swatch" style={{ background: "var(--away)" }} aria-hidden="true" />Рынок</th>
            </tr>
          </thead>
          <tbody>
            {outcomes.map((o) => (
              <tr key={o}>
                <td style={o === market.pick ? { color: "var(--accent)", fontWeight: 600 } : undefined}>
                  {pickName(forecast.match, marketKey, o, market.line)}
                  <OutcomeBars model={market.estimate?.[o]} market={market.fair?.[o]} />
                </td>
                <td className="pn-num">{percent(market.estimate?.[o])}</td>
                <td className="pn-num">{percent(market.fair?.[o])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="pn-small pn-muted">{market.reason}</p>
    </div>
  );
}

function Facts({ forecast }: { forecast: Forecast }) {
  if (!forecast.facts.length && !forecast.missing.length && !forecast.facts_dropped) return null;
  return (
    <div className="pn-stack" style={{ gap: 8 }}>
      <b style={{ fontWeight: 600 }}>На чём основан прогноз</b>
      {forecast.facts.map((f, i) => (
        <div key={`${f.text}${i}`}>
          <p className="pn-small"><b style={{ fontWeight: 600 }}>{f.status === "confirmed" ? "Факт" : "Слух"}:</b> {f.text}</p>
          <p className="pn-small pn-muted">
            {f.url ? <button style={{ textDecoration: "underline" }} onClick={() => openLink(f.url!)}>{f.checked ? f.source : "Источник"}</button> : f.source}
            {f.date ? `, ${f.date}` : ""}
            {!f.checked ? " · ссылку нашла модель, не проверена" : ""}
          </p>
        </div>
      ))}
      {forecast.facts_dropped > 0 && <p className="pn-small pn-muted">Отброшено фактов без источника: {forecast.facts_dropped}</p>}
      {forecast.missing.length > 0 && <p className="pn-small pn-muted">Не удалось выяснить: {forecast.missing.join("; ")}</p>}
    </div>
  );
}

function PickActions({ pick, url }: { pick: Pick; url: string | null }) {
  const { state: { calm }, dispatch } = useGame();
  const accept = useAcceptPick();
  const skip = useSkipPick();
  const bank = useBankroll();
  const limits = useLimits();
  function onAccept(e: MouseEvent<HTMLButtonElement>) {
    const from = e.currentTarget.getBoundingClientRect();
    accept.mutate(pick.id, {
      onSuccess: () => {
        haptic("medium");
        dispatch({ type: "TOAST", text: "Принято, без денег" });
        // The price flies to the Live tab, where the bet now lives. Inside a match that tab is covered, so the row's own change says it.
        const to = document.querySelector('[data-dock="live"]')?.getBoundingClientRect();
        if (!to || calm || document.querySelector(".pn-detail") || !pick.odds) return;
        dispatch({
          type: "FLY",
          kind: "odds",
          label: pick.odds.toFixed(2),
          from: { x: from.left + from.width / 2, y: from.top + from.height / 2 },
          to: { x: to.left + to.width / 2, y: to.top + to.height / 2 },
        });
      },
    });
  }
  const blocked = bank.data?.stopped
    ? "Ставки приостановлены: сработала защита банка"
    : limits.data?.reason ?? (bank.data === null ? "Сначала задайте банк" : null);
  return (
    <div className="pn-stack" style={{ gap: 8 }}>
      <div className="pn-row">
        <b style={{ fontWeight: 600 }}>{pickName(pick.match, pick.market, pick.pick, pick.line)}</b>
        <span className="pn-num" style={{ fontSize: 22 }}>{pick.odds?.toFixed(2) ?? "—"}</span>
      </div>
      <p className="pn-small pn-muted">После сверки с рынком {percent(pick.blended_probability)}, рынок {percent(pick.fair_probability)}. Режим без денег: ставка только записывается.</p>
      {blocked && <p className="pn-small" style={{ color: "var(--warn)" }}>{blocked}</p>}
      {accept.isError && <p className="pn-small" style={{ color: "var(--bad)" }}>{errorText(accept.error)}</p>}
      <div className="pn-grid2">
        <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} disabled={skip.isPending} onClick={() => skip.mutate(pick.id)}>
          <X size={16} aria-hidden="true" /> Пропустить
        </motion.button>
        <motion.button className="pn-btn pn-btn--primary" whileTap={{ scale: M.press }} disabled={!!blocked || accept.isPending} onClick={onAccept}>
          <Check size={16} aria-hidden="true" /> Принять
        </motion.button>
      </div>
      {url && <button className="pn-small" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "underline" }} onClick={() => openLink(url)}><ExternalLink size={13} aria-hidden="true" /> Открыть на Polymarket</button>}
    </div>
  );
}

function ForecastBody({ forecast, showLink = false }: { forecast: Forecast; showLink?: boolean }) {
  return (
    <motion.div className="pn-stack" style={{ gap: 14 }} variants={reveal} initial="hidden" animate="show">
      <AnimatePresence mode="popLayout" initial={false}>
        {forecast.picks.filter((p) => p.status === "pending").map((p) => (
          <motion.div key={`pending${p.id}`} variants={revealItem} exit={{ opacity: 0, scale: 0.96 }} transition={M.spring.snappy}>
            <PickActions pick={p} url={showLink ? forecast.url : null} />
          </motion.div>
        ))}
        {forecast.picks.filter((p) => p.status === "placed").map((p) => (
          <motion.p className="pn-small" key={`placed${p.id}`} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--good)" }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={M.spring.snappy}>
            <motion.span style={{ display: "grid" }} initial={{ scale: 0.3 }} animate={{ scale: 1 }} transition={M.spring.bouncy}><Check size={16} aria-hidden="true" /></motion.span>
            Принято: {pickName(p.match, p.market, p.pick, p.line)}, кэф {p.odds?.toFixed(2)}
          </motion.p>
        ))}
      </AnimatePresence>
      {Object.entries(forecast.markets).map(([key, market]) => (
        <motion.div key={key} variants={revealItem}><MarketRows forecast={forecast} marketKey={key} market={market} /></motion.div>
      ))}
      <motion.div variants={revealItem}><Facts forecast={forecast} /></motion.div>
    </motion.div>
  );
}

const WAIT_STEPS = ["Смотрит форму команд", "Проверяет травмы и составы", "Читает новости и слухи", "Смотрит календарь и усталость", "Сводит всё в оценку"];
const WAIT_STEP_MS = 9000;

/** What the model is asked to check, in order. A description of the job, not a progress bar: nothing here reports real progress. */
function ForecastWaiting() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, WAIT_STEPS.length - 1)), WAIT_STEP_MS);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="pn-stack" style={{ alignItems: "center", gap: 10, padding: "10px 0" }} role="status">
      <motion.div animate={{ y: [0, 16, 0], rotate: [0, 120, 240] }} transition={{ duration: M.dur.slow, repeat: Infinity, ease: "easeInOut" }} style={{ display: "grid" }}>
        <Ball size={26} />
      </motion.div>
      <div style={{ minHeight: 22 }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.b key={step} style={{ display: "block", fontWeight: 600 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: M.dur.fast }}>
            Модель: {WAIT_STEPS[step].toLowerCase()}
          </motion.b>
        </AnimatePresence>
      </div>
      <p className="pn-small pn-muted" style={{ textAlign: "center" }}>Обычно это занимает пару минут. Экран можно закрыть: прогноз сохранится.</p>
    </div>
  );
}

/** A league's forecasts, asked for one at a time. Kept outside the screen so leaving the tab doesn't lose the run. */
type LeagueRun = { league: string; done: number; total: number; error: string | null; running: boolean };
let leagueRun: LeagueRun | null = null;
let stopRun = false;
const runListeners = new Set<() => void>();
const publishRun = (next: LeagueRun | null) => {
  leagueRun = next;
  runListeners.forEach((l) => l());
};
const subscribeRun = (l: () => void) => {
  runListeners.add(l);
  return () => void runListeners.delete(l);
};

export function LeagueForecast({ league, matches }: { league: string; matches: { home: string; away: string }[] }) {
  const run = useSyncExternalStore(subscribeRun, () => leagueRun, () => null);
  const { data: forecasts } = useForecasts();
  const make = useMakeForecast();
  const todo = matches.filter((m) => !forecasts?.some((f) => f.match === `${m.home} - ${m.away}`));
  const mine = run?.league === league ? run : null;

  async function start() {
    stopRun = false;
    let done = 0;
    publishRun({ league, done, total: todo.length, error: null, running: true });
    for (const m of todo) {
      if (stopRun) break;
      try {
        await make.mutateAsync({ home: m.home, away: m.away, league });
      } catch (e) {
        publishRun({ league, done, total: todo.length, error: errorText(e), running: false });
        return;
      }
      done += 1;
      publishRun({ league, done, total: todo.length, error: null, running: true });
    }
    publishRun({ league, done, total: todo.length, error: null, running: false });
  }

  if (mine?.running) {
    return (
      <section className="pn-panel pn-panel--flat" role="status">
        <div className="pn-row">
          <b style={{ fontWeight: 600 }}>Прогнозы лиги: {mine.done} из {mine.total}</b>
          <button className="pn-small" style={{ textDecoration: "underline" }} onClick={() => { stopRun = true; }}>Остановить</button>
        </div>
        <div className="pn-meter" role="progressbar" aria-label="Готово прогнозов" aria-valuenow={mine.done} aria-valuemin={0} aria-valuemax={mine.total}>
          <motion.span style={{ background: "var(--accent)" }} initial={false} animate={{ scaleX: mine.total ? mine.done / mine.total : 0 }} transition={M.spring.gentle} />
        </div>
        <p className="pn-small pn-muted">Каждый матч считается отдельно, пара минут на матч. Можно перейти на другие вкладки.</p>
      </section>
    );
  }
  if (!todo.length && !mine?.error) return null;
  return (
    <section className="pn-panel pn-panel--flat">
      <p className="pn-small pn-muted">Без прогноза матчей: {todo.length}. Каждый прогноз это отдельный запрос к модели.</p>
      {mine?.error && <p className="pn-small" style={{ color: "var(--bad)" }} role="alert">Остановлено на {mine.done} из {mine.total}: {mine.error}</p>}
      <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} disabled={run?.running} onClick={start}>
        <Wand2 size={16} aria-hidden="true" /> {run?.running ? "Считается другая лига" : `Посчитать все: ${todo.length}`}
      </motion.button>
    </section>
  );
}

/** The forecast block inside a match: asks the model only on request, since each call costs. */
export function ForecastSection({ home, away, league }: { home: string; away: string; league: string }) {
  const { data: forecasts } = useForecasts();
  const make = useMakeForecast();
  const match = `${home} - ${away}`;
  const forecast = forecasts?.find((f) => f.match === match) ?? (make.data?.match === match ? make.data : undefined);
  // Also when the screen was closed and reopened while the model is still working.
  const running = useMutationState({
    filters: { mutationKey: ["forecast"], status: "pending" },
    select: (m) => m.state.variables as { home: string; away: string } | undefined,
  }).some((v) => v?.home === home && v?.away === away);
  return (
    <section className="pn-panel pn-panel--flat">
      <h2 className="pn-h2" style={{ display: "flex", alignItems: "center", gap: 8 }}><Sparkles size={17} color="var(--gold)" aria-hidden="true" /> Прогноз</h2>
      {forecast ? (
        <ForecastBody forecast={forecast} />
      ) : running ? (
        <ForecastWaiting />
      ) : (
        <>
          <p className="pn-small pn-muted">Модель оценит шансы, не видя цены. Решение о ставке примет код.</p>
          <motion.button className="pn-btn pn-btn--primary" whileTap={{ scale: M.press }} onClick={() => make.mutate({ home, away, league })}>
            <Wand2 size={17} aria-hidden="true" /> Получить прогноз
          </motion.button>
          {make.isError && <p className="pn-small" style={{ color: "var(--bad)" }} role="alert">{errorText(make.error)}</p>}
        </>
      )}
    </section>
  );
}

/** One line on a match card, so the list shows where a forecast already exists. */
export function forecastHint(forecasts: Forecast[] | undefined, match: string) {
  const forecast = forecasts?.find((f) => f.match === match);
  if (!forecast) return null;
  const picks = Object.entries(forecast.markets).filter(([, m]) => m.pick);
  if (!picks.length) return "Прогноз: без ставки";
  return `Прогноз: ${picks.map(([key, m]) => pickName(match, key, m.pick!, m.line)).join(", ")}`;
}

/** The real forecasts tab: anything still waiting for a decision first. */
export function ForecastsView() {
  const { data, isPending, isError, error, refetch } = useForecasts();
  const [now] = useState(() => Date.now());
  if (isPending) return <div className="pn-screen" aria-busy="true"><div className="pn-skeleton" style={{ height: 220 }} /></div>;
  if (isError) {
    return (
      <div className="pn-screen">
        <section className="pn-notice" role="status">
          <h2 className="pn-h2">Прогнозы недоступны</h2>
          <p className="pn-small pn-muted">{errorText(error)}</p>
          <button className="pn-btn pn-btn--primary" style={{ alignSelf: "stretch" }} onClick={() => refetch()}>Повторить</button>
        </section>
      </div>
    );
  }
  const seen = new Set<string>();
  const latest = (data ?? []).filter((f) => (!f.commence_time || Date.parse(f.commence_time) > now) && !seen.has(f.match) && !!seen.add(f.match));
  latest.sort((a, b) => Number(b.picks.some((p) => p.status === "pending")) - Number(a.picks.some((p) => p.status === "pending")));
  return (
    <div className="pn-screen">
      {latest.length === 0 && (
        <section className="pn-notice" role="status">
          <h2 className="pn-h2">Прогнозов пока нет</h2>
          <p className="pn-small pn-muted">Откройте матч в разделе «Матчи» и нажмите «Получить прогноз». Чаще всего ответ будет «без ставки», и это нормально.</p>
        </section>
      )}
      <AnimatePresence initial={false} mode="popLayout">
        {latest.map((f) => (
          <motion.article key={f.id} className="pn-match" style={{ padding: 14 }} layout initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={M.spring.snappy}>
            <div className="pn-row pn-small pn-muted" style={{ marginBottom: 8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{f.league && <LeagueLogo league={f.league} size={14} />}{f.league}</span>
            </div>
            <b style={{ fontWeight: 600, fontSize: 17, display: "block", marginBottom: 10 }}>{f.match.replace(" - ", " — ")}</b>
            <ForecastBody forecast={f} showLink />
          </motion.article>
        ))}
      </AnimatePresence>
    </div>
  );
}
