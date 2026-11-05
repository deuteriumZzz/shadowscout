"use client";

import { animate, AnimatePresence, motion } from "framer-motion";
import { BarChart3, Check, Minus, Pause, Pencil, Play, Plus, ShieldAlert, ShieldCheck, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CAPITAL_LABEL, type FormResult, type HelpTopic } from "./engine";
import { Chip, Crest, FormPips, HelpButton, KeepyUppy, LeagueLogo, M, Odometer, Segmented, Switch, useHold } from "./fx";
import { ConnectionsSection } from "./screen-connections";
import { errorText, pickName } from "./screen-forecast";
import { WalletPanel, WalletSettings } from "./screen-wallet";
import { FeedNotice } from "./screen-matchday";
import { useGame, type ThemeChoice } from "./store";
import {
  useAlertSettings,
  useBankroll,
  useDigestSettings,
  useEquityCurve,
  useForecastScores,
  useHistory,
  useLimits,
  useSetAlertSettings,
  useSetDigestSettings,
  useSetLimits,
  useStats,
} from "@/hooks/use-shadowscout";
import { haptic } from "@/lib/telegram";
import type { EquityPoint, Pick } from "@/lib/types";

const money = (v: number) => Math.abs(Math.round(v)).toLocaleString("ru-RU");

type Period = keyof typeof CAPITAL_LABEL;
const PERIOD_DAYS: Record<Period, number> = { week: 7, month: 30, all: Infinity };
const CHART = { w: 320, h: 150, left: 40, right: 8, top: 12, bottom: 20 };

/** The bank at each settled bet in the period, starting from where it stood before it. */
function capitalSeries(points: EquityPoint[], capital: number, period: Period, now: number) {
  const total = points.at(-1)?.cumulative_currency ?? 0;
  const start = capital - total;
  const cutoff = now - PERIOD_DAYS[period] * 86_400_000;
  const inside = points.filter((p) => Date.parse(p.date) >= cutoff);
  const before = points.filter((p) => Date.parse(p.date) < cutoff).at(-1)?.cumulative_currency ?? 0;
  return [start + before, ...inside.map((p) => start + p.cumulative_currency)];
}

/** Capital over time: one series, so the title names it and no legend is needed. */
function CapitalChart({ period, series }: { period: Period; series: number[] }) {
  const line = useRef<SVGPathElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const current = series[series.length - 1];

  const max = Math.max(...series);
  const min = Math.min(...series);
  const pad = Math.max(1, (max - min) * 0.1);
  const x = (i: number) => CHART.left + (i / (series.length - 1)) * (CHART.w - CHART.left - CHART.right);
  const y = (v: number) => CHART.top + (1 - (v - (min - pad)) / (max - min + 2 * pad)) * (CHART.h - CHART.top - CHART.bottom);
  const d = series.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const base = CHART.h - CHART.bottom;
  const area = `${d} L${x(series.length - 1).toFixed(1)} ${base} L${x(0).toFixed(1)} ${base} Z`;
  const ticks = [...new Set([min, (min + max) / 2, max])];

  useEffect(() => {
    const path = line.current;
    if (!path) return;
    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    const controls = animate(length, 0, {
      duration: M.dur.crawl,
      ease: M.ease.smooth,
      onUpdate: (v) => {
        path.style.strokeDashoffset = String(v);
      },
    });
    return () => controls.stop();
  }, [period, series.length]);

  function onPointer(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * CHART.w;
    const i = Math.max(0, Math.min(series.length - 1, Math.round(((px - CHART.left) / (CHART.w - CHART.left - CHART.right)) * (series.length - 1))));
    if (i !== hover && e.pointerType === "touch") haptic("light");
    setHover(i);
  }

  return (
    <div className="pn-chart">
      {hover !== null && (
        <div className="pn-chart__tip pn-num" style={{ left: `${(x(hover) / CHART.w) * 100}%` }}>{money(series[hover])}</div>
      )}
      <svg
        viewBox={`0 0 ${CHART.w} ${CHART.h}`}
        role="img"
        aria-label={`Банк за период ${CAPITAL_LABEL[period]}: от ${money(series[0])} до ${money(current)}`}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={CHART.left} x2={CHART.w - CHART.right} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={CHART.left - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--tx2)">{money(t)}</text>
          </g>
        ))}
        <motion.path key={`a${period}`} d={area} fill="var(--accent)" initial={{ opacity: 0 }} animate={{ opacity: 0.1 }} transition={{ delay: 0.3, duration: M.dur.slow }} />
        <path key={period} ref={line} d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={CHART.top} y2={base} stroke="var(--line-2)" />}
        {hover !== null && <circle cx={x(hover)} cy={y(series[hover])} r="4" fill="var(--tx)" stroke="var(--s1)" strokeWidth="2" />}
        <circle cx={x(series.length - 1)} cy={y(current)} r="3.5" fill="var(--accent)" />
        <text x={CHART.left} y={CHART.h - 5} fontSize="10" fill="var(--tx2)">{period === "all" ? "Начало" : `${CAPITAL_LABEL[period]} назад`}</text>
        <text x={CHART.w - CHART.right} y={CHART.h - 5} textAnchor="end" fontSize="10" fill="var(--tx2)">Сегодня</text>
      </svg>
    </div>
  );
}

const LIMIT_STEP = 500;
const LIMIT_SAVE_DELAY_MS = 500;

/** Limits sit next to the money, not buried in settings: they're part of playing well. */
function Limits() {
  const { data } = useLimits();
  const set = useSetLimits();
  const { mutate } = set;
  const [draft, setDraft] = useState<number | null>(null);
  const limit = draft ?? data?.daily_limit ?? 0;
  const down = useHold(() => setDraft((v) => Math.max(0, (v ?? data?.daily_limit ?? 0) - LIMIT_STEP)));
  const up = useHold(() => setDraft((v) => (v ?? data?.daily_limit ?? 0) + LIMIT_STEP));

  // Saved once the buttons are let go, not on every step of a hold.
  useEffect(() => {
    if (draft === null || draft === data?.daily_limit) return;
    const t = setTimeout(() => mutate({ daily_limit: draft }), LIMIT_SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [draft, data?.daily_limit, mutate]);

  if (!data) return null;
  const used = limit ? Math.min(1, data.loss_today / limit) : 0;
  return (
    <section className="pn-panel pn-panel--flat">
      <b style={{ fontWeight: 600 }}>Дневной лимит потерь</b>
      <div className="pn-stepper">
        <button aria-label="Уменьшить лимит" {...down}><Minus size={18} aria-hidden="true" /></button>
        <div className="pn-stepper__value" aria-live="polite">{limit ? money(limit) : "Нет"}</div>
        <button aria-label="Увеличить лимит" {...up}><Plus size={18} aria-hidden="true" /></button>
      </div>
      <div className="pn-meter" role="progressbar" aria-label="Использовано лимита" aria-valuenow={Math.round(used * 100)} aria-valuemin={0} aria-valuemax={100}>
        <motion.span style={{ background: used >= 1 ? "var(--live)" : "var(--accent)" }} initial={false} animate={{ scaleX: used }} transition={M.spring.gentle} />
      </div>
      <p className="pn-small pn-muted">Сегодня потеряно {money(data.loss_today)}. При достижении лимита ставки выключатся до завтра.</p>
      {data.paused_until ? (
        <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => mutate({ pause: false })}>
          <Play size={16} aria-hidden="true" /> Снять паузу
        </motion.button>
      ) : (
        <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => mutate({ pause: true })}>
          <Pause size={16} aria-hidden="true" /> Пауза на сутки
        </motion.button>
      )}
      {set.isError && <p className="pn-small" style={{ color: "var(--bad)" }} role="alert">{errorText(set.error)}</p>}
    </section>
  );
}

function ApiNotice({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="pn-screen">
      <FeedNotice icon={<ShieldAlert size={26} aria-hidden="true" />} title="Данные не загрузились" text={errorText(error)} action="Повторить" onAction={retry} />
    </div>
  );
}

export function BankScreen() {
  const { state, dispatch } = useGame();
  const { data: bank, isPending, isError, error, refetch } = useBankroll();
  const curve = useEquityCurve();
  const [period, setPeriod] = useState<Period>("month");
  const [now] = useState(() => Date.now());
  const series = useMemo(() => (bank ? capitalSeries(curve.data ?? [], bank.capital, period, now) : []), [curve.data, bank, period, now]);

  if (isPending) return <div className="pn-screen" aria-busy="true"><div className="pn-skeleton" style={{ height: 260 }} /></div>;
  if (isError) return <ApiNotice error={error} retry={() => refetch()} />;
  if (!bank) {
    return (
      <div className="pn-screen">
        <WalletPanel />
        <FeedNotice icon={<Wallet size={26} aria-hidden="true" />} title="Задайте банк" text="От него считаются размер ставки, просадка и стоп. Пока это режим без денег: сумма условная." action="Указать сумму" onAction={() => dispatch({ type: "SHEET", sheet: { kind: "bank" } })} />
      </div>
    );
  }

  const change = bank.capital - series[0];
  const used = Math.min(1, bank.drawdown_pct / bank.stop_loss_pct);

  return (
    <div className="pn-screen">
      <WalletPanel />
      <section className="pn-bank">
        <span className="pn-small pn-muted">Условный банк · режим без денег</span>
        <span className="pn-bank__value" style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}><Odometer value={Math.round(bank.capital)} /><span style={{ fontSize: 26, color: "var(--tx2)" }}>{state.prefs.currency}</span></span>
        <span className="pn-small" style={{ color: change >= 0 ? "var(--good)" : "var(--bad)" }}>
          {change >= 0 ? "+" : "−"}{money(change)} за {CAPITAL_LABEL[period].toLowerCase()}
        </span>
      </section>

      <div className="pn-grid2">
        <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "SHEET", sheet: { kind: "bank" } })}>
          <Pencil size={16} aria-hidden="true" /> Изменить
        </motion.button>
        <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "TAB", tab: "stats" })}>
          Статистика
        </motion.button>
      </div>

      <section className="pn-panel pn-panel--flat">
        <Segmented<Period>
          label="Период графика"
          value={period}
          onChange={setPeriod}
          options={(Object.keys(CAPITAL_LABEL) as Period[]).map((id) => ({ id, label: CAPITAL_LABEL[id] }))}
        />
        {series.length > 1 ? (
          <CapitalChart period={period} series={series} />
        ) : (
          <p className="pn-small pn-muted" style={{ padding: "18px 0", textAlign: "center" }}>За этот период закрытых ставок нет. График появится после них.</p>
        )}
      </section>

      <section className="pn-panel pn-panel--flat">
        <div className="pn-row">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <b style={{ fontWeight: 600 }}>Просадка от пика</b>
            <HelpButton topic="stop" />
          </span>
          {bank.stopped ? (
            <span className="pn-small" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--bad)" }}><ShieldAlert size={15} aria-hidden="true" /> Стоп</span>
          ) : (
            <span className="pn-small" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--good)" }}><ShieldCheck size={15} aria-hidden="true" /> Норма</span>
          )}
        </div>
        <div className="pn-meter" role="progressbar" aria-label="Просадка относительно стопа" aria-valuenow={Math.round(used * 100)} aria-valuemin={0} aria-valuemax={100}>
          <motion.span style={{ background: bank.stopped ? "var(--live)" : used > 0.7 ? "var(--warn)" : "var(--accent)" }} initial={{ scaleX: 0 }} animate={{ scaleX: bank.stopped ? 1 : used }} transition={M.spring.gentle} />
        </div>
        <div className="pn-row pn-small pn-muted">
          <span>Сейчас {bank.drawdown_pct.toFixed(1)}%, пик {money(bank.peak)}</span>
          <span>Стоп {bank.stop_loss_pct.toFixed(0)}%</span>
        </div>
        {bank.clv_gated && (
          <p className="pn-small" style={{ color: "var(--warn)" }}>
            Ставки остановлены: цены в среднем уходят против прогнозов модели ({bank.clv_gate_avg?.toFixed(1)}%).
          </p>
        )}
      </section>

      <section className="pn-panel pn-panel--flat">
        <div className="pn-row">
          <div>
            <b style={{ fontWeight: 600 }}>Рекомендованная ставка</b>
            <p className="pn-small pn-muted">Доля от банка</p>
          </div>
          <span className="pn-num" style={{ fontSize: 24 }}>{bank.stopped || bank.suggested_stake === null ? "—" : money(bank.suggested_stake)}</span>
        </div>
      </section>

      <Limits />
    </div>
  );
}

function Kpi({ label, value, sub, topic, tone }: { label: string; value: string; sub?: string; topic?: HelpTopic; tone?: string }) {
  return (
    <motion.div className="pn-kpi" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={M.spring.snappy}>
      <div className="pn-kpi__top">
        <span>{label}</span>
        {topic && <HelpButton topic={topic} />}
      </div>
      <strong style={{ color: tone }}>{value}</strong>
      {sub && <span className="pn-small pn-muted">{sub}</span>}
    </motion.div>
  );
}

const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
const toneOf = (v: number) => (v >= 0 ? "var(--good)" : "var(--bad)");

function profitOf(p: Pick) {
  if (p.result === "win") return (p.stake ?? 0) * ((p.odds ?? 1) - 1);
  return p.result === "loss" ? -(p.stake ?? 0) : 0;
}

/** Whether the model is any better than simply believing the market: the honest question. */
function ModelVsMarket() {
  const { data } = useForecastScores();
  if (!data || !data.forecasts) return null;
  const verdict = data.low_sample
    ? `Рано судить: ${data.forecasts} из ${data.min_sample} прогнозов`
    : data.beats_market ? "Модель точнее рынка" : "Модель не точнее рынка: реальные деньги сюда не стоит";
  return (
    <section className="pn-panel pn-panel--flat">
      <div className="pn-row">
        <h2 className="pn-h2">Модель против рынка</h2>
        <HelpButton topic="brier" />
      </div>
      <div className="pn-row pn-small"><span>Ошибка модели</span><b className="pn-num" style={{ fontSize: 16 }}>{data.model_brier?.toFixed(3)}</b></div>
      <div className="pn-row pn-small"><span>Ошибка рынка</span><b className="pn-num" style={{ fontSize: 16 }}>{data.market_brier?.toFixed(3)}</b></div>
      <p className="pn-small pn-muted">{verdict}. Чем меньше ошибка, тем лучше.</p>
    </section>
  );
}

type StatsView = "overview" | "history";
type HistoryFilter = "all" | "win" | "loss";

export function StatsScreen() {
  const { state, dispatch } = useGame();
  const stats = useStats();
  const history = useHistory();
  const [view, setView] = useState<StatsView>("overview");
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const scores = useForecastScores();

  if (stats.isPending || history.isPending) return <div className="pn-screen" aria-busy="true"><div className="pn-skeleton" style={{ height: 260 }} /></div>;
  if (stats.isError) return <ApiNotice error={stats.error} retry={() => stats.refetch()} />;

  const s = stats.data;
  const all = history.data ?? [];
  const rows = all.filter((h) => filter === "all" || h.result === filter);
  const form: FormResult[] = all.slice(0, 5).reverse().map((h) => (h.result === "win" ? "win" : h.result === "loss" ? "loss" : "draw"));
  const leagues = Object.entries(s.by_league);

  if (!s.settled && !scores.data?.forecasts) {
    return (
      <div className="pn-screen">
        <FeedNotice icon={<BarChart3 size={26} aria-hidden="true" />} title="Статистики пока нет" text="Она появится после первых закрытых ставок. Выводы лучше делать после 30 и больше." action="К матчам" onAction={() => dispatch({ type: "TAB", tab: "bets" })} />
      </div>
    );
  }

  return (
    <div className="pn-screen">
      <Segmented<StatsView>
        label="Раздел статистики"
        value={view}
        onChange={setView}
        options={[{ id: "overview", label: "Обзор" }, { id: "history", label: "История" }]}
      />

      <AnimatePresence mode="wait" initial={false}>
        {view === "overview" ? (
          <motion.div key="o" className="pn-stack" style={{ gap: 12 }} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ duration: M.dur.fast }}>
            <ModelVsMarket />
            {form.length > 0 && (
              <section className="pn-panel pn-panel--flat">
                <div className="pn-row">
                  <b style={{ fontWeight: 600 }}>Форма</b>
                  <FormPips form={form} />
                </div>
              </section>
            )}
            {s.settled > 0 && (
              <div className="pn-grid2">
                <Kpi label="Процент побед" value={`${s.win_rate.toFixed(1)}%`} sub={`${s.wins} из ${s.settled}, диапазон ${s.win_rate_ci[0].toFixed(0)}–${s.win_rate_ci[1].toFixed(0)}%`} topic="winrate" />
                <Kpi label="ROI" value={signed(s.roi)} sub="на дистанции" topic="roi" tone={toneOf(s.roi)} />
                {s.avg_clv !== null && <Kpi label="Плюс к линии" value={signed(s.avg_clv)} sub={`по ${s.clv_sample} ставкам`} topic="clv" tone={toneOf(s.avg_clv)} />}
                {s.brier_score !== null && <Kpi label="Точность модели" value={s.brier_score.toFixed(3)} sub="0 идеал, 0.25 монетка" topic="brier" />}
              </div>
            )}
            {s.low_sample && s.settled > 0 && <p className="pn-small pn-muted">Выборка мала: {s.settled} закрытых ставок. Выводы лучше делать после 30 и больше.</p>}
            {leagues.length > 0 && (
              <section className="pn-panel pn-panel--flat">
                <h2 className="pn-h2">По лигам</h2>
                <table className="pn-table">
                  <thead>
                    <tr><th>Лига</th><th>В</th><th>П</th></tr>
                  </thead>
                  <tbody>
                    {leagues.map(([name, l]) => (
                      <tr key={name}>
                        <td><span><LeagueLogo league={name} size={15} /> {name}</span></td>
                        <td className="pn-num">{l.wins}</td>
                        <td className="pn-num">{l.losses}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </motion.div>
        ) : (
          <motion.div key="h" className="pn-stack" style={{ gap: 12 }} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 14 }} transition={{ duration: M.dur.fast }}>
            <div className="pn-chips" role="group" aria-label="Фильтр истории">
              <Chip active={filter === "all"} onClick={() => setFilter("all")}>Все</Chip>
              <Chip active={filter === "win"} onClick={() => setFilter("win")}><Check size={14} aria-hidden="true" /> Зашли</Chip>
              <Chip active={filter === "loss"} onClick={() => setFilter("loss")}><X size={14} aria-hidden="true" /> Не зашли</Chip>
            </div>
            <section className="pn-panel pn-panel--flat" style={{ gap: 0, paddingBlock: 4 }}>
              <AnimatePresence initial={false} mode="popLayout">
                {rows.map((h) => {
                  const amount = profitOf(h);
                  return (
                    <motion.div key={h.id} className="pn-hist" layout initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={M.spring.snappy}>
                      {h.result === "win" ? <Check size={20} color="var(--good)" aria-label="Зашла" /> : h.result === "loss" ? <X size={20} color="var(--bad)" aria-label="Не зашла" /> : <Minus size={20} color="var(--tx2)" aria-label="Возврат" />}
                      <div style={{ minWidth: 0 }}>
                        {h.match.split(" - ").map((team, i) => (
                          <div className="pn-hist__team" key={team}>
                            <Crest team={team} size={18} logo={i ? h.away_logo : h.home_logo} />
                            <span>{team}</span>
                            {h.final_score && <b className="pn-num">{h.final_score.split("-")[i]}</b>}
                          </div>
                        ))}
                        <div className="pn-small pn-muted">{pickName(h.match, h.market, h.pick, h.line)} · кэф {h.odds?.toFixed(2)}</div>
                      </div>
                      <span className="pn-num" style={{ fontSize: 16, color: amount > 0 ? "var(--gold)" : "var(--tx2)" }}>
                        {amount >= 0 ? "+" : "−"}{money(amount)} {state.prefs.currency}
                      </span>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {rows.length === 0 && <p className="pn-small pn-muted" style={{ padding: "16px 0" }}>Таких ставок пока нет.</p>}
            </section>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const ALL_LEAGUES = ["Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1", "Champions League"];

/** Real messages from the bot about matches you hold a bet on. The final always comes. */
function Alerts() {
  const { data, isError } = useAlertSettings();
  const save = useSetAlertSettings();
  if (isError || !data) return null;
  return (
    <section className="pn-panel pn-panel--flat">
      <h2 className="pn-h2">Сообщения в Telegram</h2>
      <Switch label="Начало матча со ставкой" on={data.kickoff} onToggle={() => save.mutate({ kickoff: !data.kickoff })} />
      <Switch label="Голы в матчах со ставкой" on={data.goals} onToggle={() => save.mutate({ goals: !data.goals })} />
      <p className="pn-small pn-muted">Финал приходит всегда. Сообщения отправляет бот, он должен быть запущен.</p>
    </section>
  );
}

function Digest() {
  const { data, isError } = useDigestSettings();
  const save = useSetDigestSettings();
  if (isError || !data) return null;
  const chosen = (data.leagues ?? "").split(",").map((l) => l.trim()).filter(Boolean);
  const toggle = (name: string) => save.mutate((chosen.includes(name) ? chosen.filter((l) => l !== name) : [...chosen, name]).join(", "));
  return (
    <section className="pn-panel pn-panel--flat">
      <h2 className="pn-h2">Лиги в дайджесте</h2>
      <div className="pn-chips pn-chips--wrap">
        {ALL_LEAGUES.map((name) => (
          <Chip key={name} active={chosen.includes(name)} onClick={() => toggle(name)}>
            <LeagueLogo league={name} size={13} /> {name}
          </Chip>
        ))}
      </div>
    </section>
  );
}

export function SettingsScreen() {
  const { state, dispatch } = useGame();
  const { prefs } = state;

  return (
    <div className="pn-screen">
      <WalletSettings />
      <ConnectionsSection />
      <Alerts />
      <Digest />

      <section className="pn-panel pn-panel--flat">
        <h2 className="pn-h2">Интерфейс</h2>
        <Segmented<string>
          label="Валюта"
          value={prefs.currency}
          onChange={(currency) => dispatch({ type: "SET_PREF", prefs: { currency } })}
          options={[{ id: "$", label: "$" }, { id: "€", label: "€" }, { id: "₽", label: "₽" }]}
        />
        <Segmented<ThemeChoice>
          label="Тема"
          value={state.theme}
          onChange={(theme) => dispatch({ type: "SET_THEME", theme })}
          options={[{ id: "auto", label: "Как в Telegram" }, { id: "light", label: "Светлая" }, { id: "dark", label: "Тёмная" }]}
        />
        <Switch label="Меньше анимации" hint="Без движения и эффектов" on={state.calm} onToggle={() => dispatch({ type: "SET_CALM", on: !state.calm })} />
      </section>

      <section className="pn-panel pn-panel--flat">
        <h2 className="pn-h2">Перерыв: чеканка</h2>
        <KeepyUppy />
      </section>

      <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "ONBOARDING", show: true })}>Показать мастер первого запуска</motion.button>
    </div>
  );
}
