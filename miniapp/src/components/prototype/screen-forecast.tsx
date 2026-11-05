"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ExternalLink, Sparkles, Wand2, X } from "lucide-react";
import { useState } from "react";
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

function MarketRows({ forecast, marketKey, market }: { forecast: Forecast; marketKey: string; market: ForecastMarket }) {
  const outcomes = Object.keys(market.estimate ?? market.fair ?? {});
  return (
    <div className="pn-stack" style={{ gap: 6 }}>
      <b style={{ fontWeight: 600 }}>{MARKET_TITLE[marketKey] ?? marketKey}{market.line ? ` ${market.line}` : ""}</b>
      {outcomes.length > 0 && (
        <table className="pn-table">
          <thead>
            <tr><th>Исход</th><th>Модель</th><th>Рынок</th></tr>
          </thead>
          <tbody>
            {outcomes.map((o) => (
              <tr key={o}>
                <td style={o === market.pick ? { color: "var(--accent)", fontWeight: 600 } : undefined}>{pickName(forecast.match, marketKey, o, market.line)}</td>
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
  const { dispatch } = useGame();
  const accept = useAcceptPick();
  const skip = useSkipPick();
  const bank = useBankroll();
  const limits = useLimits();
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
        <motion.button className="pn-btn pn-btn--primary" whileTap={{ scale: M.press }} disabled={!!blocked || accept.isPending} onClick={() => accept.mutate(pick.id, { onSuccess: () => dispatch({ type: "TOAST", text: "Принято, без денег" }) })}>
          <Check size={16} aria-hidden="true" /> Принять
        </motion.button>
      </div>
      {url && <button className="pn-small" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "underline" }} onClick={() => openLink(url)}><ExternalLink size={13} aria-hidden="true" /> Открыть на Polymarket</button>}
    </div>
  );
}

function ForecastBody({ forecast, showLink = false }: { forecast: Forecast; showLink?: boolean }) {
  return (
    <div className="pn-stack" style={{ gap: 14 }}>
      {forecast.picks.filter((p) => p.status === "pending").map((p) => <PickActions key={p.id} pick={p} url={showLink ? forecast.url : null} />)}
      {forecast.picks.filter((p) => p.status === "placed").map((p) => <p className="pn-small" key={p.id} style={{ color: "var(--good)" }}>Принято: {pickName(p.match, p.market, p.pick, p.line)}, кэф {p.odds?.toFixed(2)}</p>)}
      {Object.entries(forecast.markets).map(([key, market]) => <MarketRows key={key} forecast={forecast} marketKey={key} market={market} />)}
      <Facts forecast={forecast} />
    </div>
  );
}

/** The forecast block inside a match: asks the model only on request, since each call costs. */
export function ForecastSection({ home, away, league }: { home: string; away: string; league: string }) {
  const { data: forecasts } = useForecasts();
  const make = useMakeForecast();
  const match = `${home} - ${away}`;
  const forecast = forecasts?.find((f) => f.match === match) ?? (make.data?.match === match ? make.data : undefined);
  return (
    <section className="pn-panel pn-panel--flat">
      <h2 className="pn-h2" style={{ display: "flex", alignItems: "center", gap: 8 }}><Sparkles size={17} color="var(--gold)" aria-hidden="true" /> Прогноз</h2>
      {forecast ? (
        <ForecastBody forecast={forecast} />
      ) : make.isPending ? (
        <div className="pn-stack" style={{ alignItems: "center", gap: 10 }} role="status">
          <Ball size={24} />
          <p className="pn-small pn-muted" style={{ textAlign: "center" }}>Модель изучает матч, это занимает пару минут.</p>
        </div>
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
