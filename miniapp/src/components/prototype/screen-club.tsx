"use client";

import { animate, AnimatePresence, motion } from "framer-motion";
import { BarChart3, Check, Minus, Pause, Pencil, Play, Plus, ShieldAlert, ShieldCheck, Sparkles, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CAPITAL, CAPITAL_LABEL, FORM, LEAGUES, STOP_LOSS, type HelpTopic } from "./engine";
import { CardIcon, Chip, Crest, FormPips, HelpButton, KeepyUppy, LeagueLogo, M, Odometer, Segmented, Switch, useHold } from "./fx";
import { ConnectionsSection } from "./screen-connections";
import { FeedNotice } from "./screen-matchday";
import { useGame, type FeedState, type ThemeChoice } from "./store";

const money = (v: number) => Math.abs(Math.round(v)).toLocaleString("ru-RU");

type Period = keyof typeof CAPITAL;
const CHART = { w: 320, h: 150, left: 40, right: 8, top: 12, bottom: 20 };

/** Capital over time: one series, so the title names it and no legend is needed. */
function CapitalChart({ period, current }: { period: Period; current: number }) {
  const line = useRef<SVGPathElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(() => [...CAPITAL[period].slice(0, -1), current], [period, current]);

  const max = Math.max(...series);
  const min = Math.min(...series);
  const pad = Math.max(1, (max - min) * 0.1);
  const x = (i: number) => CHART.left + (i / (series.length - 1)) * (CHART.w - CHART.left - CHART.right);
  const y = (v: number) => CHART.top + (1 - (v - (min - pad)) / (max - min + 2 * pad)) * (CHART.h - CHART.top - CHART.bottom);
  const d = series.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const base = CHART.h - CHART.bottom;
  const area = `${d} L${x(series.length - 1).toFixed(1)} ${base} L${x(0).toFixed(1)} ${base} Z`;
  const ticks = [min, (min + max) / 2, max];

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
  }, [period]);

  function onPointer(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * CHART.w;
    const i = Math.round(((px - CHART.left) / (CHART.w - CHART.left - CHART.right)) * (series.length - 1));
    setHover(Math.max(0, Math.min(series.length - 1, i)));
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
            <text x={CHART.left - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--tx2)">{Math.round(t / 100) / 10}к</text>
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

/** Limits sit next to the money, not buried in settings: they're part of playing well. */
function Limits() {
  const { state, dispatch } = useGame();
  const down = useHold(() => dispatch({ type: "SET_LIMIT", limit: Math.max(LIMIT_STEP, state.dailyLimit - LIMIT_STEP) }));
  const up = useHold(() => dispatch({ type: "SET_LIMIT", limit: state.dailyLimit + LIMIT_STEP }));
  const used = state.dailyLimit ? Math.min(1, state.lossToday / state.dailyLimit) : 0;
  return (
    <section className="pn-panel pn-panel--flat">
      <b style={{ fontWeight: 600 }}>Дневной лимит потерь</b>
      <div className="pn-stepper">
        <button aria-label="Уменьшить лимит" {...down}><Minus size={18} aria-hidden="true" /></button>
        <div className="pn-stepper__value" aria-live="polite">{money(state.dailyLimit)}</div>
        <button aria-label="Увеличить лимит" {...up}><Plus size={18} aria-hidden="true" /></button>
      </div>
      <div className="pn-meter" role="progressbar" aria-label="Использовано лимита" aria-valuenow={Math.round(used * 100)} aria-valuemin={0} aria-valuemax={100}>
        <motion.span style={{ background: used >= 1 ? "var(--live)" : "var(--accent)" }} initial={false} animate={{ scaleX: used }} transition={M.spring.gentle} />
      </div>
      <p className="pn-small pn-muted">Сегодня потеряно {money(state.lossToday)}. При достижении лимита ставки выключатся до завтра.</p>
      {state.pausedUntil ? (
        <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "RESUME" })}>
          <Play size={16} aria-hidden="true" /> Снять паузу
        </motion.button>
      ) : (
        <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "PAUSE", until: Date.now() + 86_400_000 })}>
          <Pause size={16} aria-hidden="true" /> Пауза на сутки
        </motion.button>
      )}
    </section>
  );
}

export function BankScreen() {
  const { state, dispatch } = useGame();
  const [period, setPeriod] = useState<Period>("month");
  const drawdown = Math.max(0, (state.peak - state.budget) / state.peak);
  const used = Math.min(1, drawdown / STOP_LOSS);
  const stake = state.budget * 0.02;
  const first = CAPITAL[period][0];
  const change = state.budget - first;

  if (!state.budget) {
    return (
      <div className="pn-screen">
        <FeedNotice icon={<Wallet size={26} aria-hidden="true" />} title="Задайте банк" text="От него считаются размер ставки, просадка и стоп. Без банка бот не сможет советовать сумму." action="Указать сумму" onAction={() => dispatch({ type: "SHEET", sheet: { kind: "bank" } })} />
      </div>
    );
  }

  return (
    <div className="pn-screen">
      <section className="pn-bank">
        <span className="pn-small pn-muted">Банк</span>
        <span className="pn-bank__value" style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}><Odometer value={state.budget} /><span style={{ fontSize: 26, color: "var(--tx2)" }}>{state.prefs.currency}</span></span>
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
        <CapitalChart period={period} current={state.budget} />
      </section>

      <section className="pn-panel pn-panel--flat">
        <div className="pn-row">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <b style={{ fontWeight: 600 }}>Просадка от пика</b>
            <HelpButton topic="stop" />
          </span>
          {state.stopped ? (
            <span className="pn-small" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--bad)" }}><ShieldAlert size={15} aria-hidden="true" /> Стоп</span>
          ) : (
            <span className="pn-small" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--good)" }}><ShieldCheck size={15} aria-hidden="true" /> Норма</span>
          )}
        </div>
        <div className="pn-meter" role="progressbar" aria-label="Просадка относительно стопа" aria-valuenow={Math.round(used * 100)} aria-valuemin={0} aria-valuemax={100}>
          <motion.span style={{ background: state.stopped ? "var(--live)" : used > 0.7 ? "var(--warn)" : "var(--accent)" }} initial={{ scaleX: 0 }} animate={{ scaleX: state.stopped ? 1 : used }} transition={M.spring.gentle} />
        </div>
        <div className="pn-row pn-small pn-muted">
          <span>Сейчас {(drawdown * 100).toFixed(1)}%, пик {money(state.peak)}</span>
          <span>Стоп {(STOP_LOSS * 100).toFixed(0)}%</span>
        </div>
      </section>

      <section className="pn-panel pn-panel--flat">
        <div className="pn-row">
          <div>
            <b style={{ fontWeight: 600 }}>Рекомендованная ставка</b>
            <p className="pn-small pn-muted">2% от банка</p>
          </div>
          <span className="pn-num" style={{ fontSize: 24 }}>{state.stopped ? "—" : money(stake)}</span>
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

type StatsView = "overview" | "history";
type HistoryFilter = "all" | "win" | "loss";

export function StatsScreen() {
  const { state, dispatch } = useGame();
  const [view, setView] = useState<StatsView>("overview");
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const rows = state.history.filter((h) => filter === "all" || h.result === filter);

  if (!state.history.length) {
    return (
      <div className="pn-screen">
        <FeedNotice icon={<BarChart3 size={26} aria-hidden="true" />} title="Статистики пока нет" text="Она появится после первых закрытых ставок. Выводы лучше делать после 30 и больше." action="К прогнозам" onAction={() => dispatch({ type: "TAB", tab: "bets" })} />
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
            <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "STORIES", show: true })}>
              <Sparkles size={16} color="var(--gold)" aria-hidden="true" /> Итоги недели
            </motion.button>
            <section className="pn-panel pn-panel--flat">
              <div className="pn-row">
                <b style={{ fontWeight: 600 }}>Форма</b>
                <FormPips form={FORM} />
              </div>
            </section>
            <div className="pn-grid2">
              <Kpi label="Процент побед" value="54.8%" sub="23 из 42, диапазон 39–69%" topic="winrate" />
              <Kpi label="ROI" value="+6.4%" sub="на дистанции" topic="roi" tone="var(--good)" />
              <Kpi label="Плюс к линии" value="+2.1%" sub="по 38 ставкам" topic="clv" tone="var(--good)" />
              <Kpi label="Точность модели" value="0.231" sub="0 идеал, 0.25 монетка" topic="brier" />
            </div>
            <section className="pn-panel pn-panel--flat">
              <h2 className="pn-h2">По лигам</h2>
              <table className="pn-table">
                <thead>
                  <tr><th>Лига</th><th>В</th><th>П</th><th>ROI</th></tr>
                </thead>
                <tbody>
                  {LEAGUES.map((l) => (
                    <tr key={l.name}>
                      <td><span><LeagueLogo league={l.name} size={15} /> {l.name}</span></td>
                      <td className="pn-num">{l.wins}</td>
                      <td className="pn-num">{l.losses}</td>
                      <td className="pn-num">{l.roi > 0 ? "+" : "−"}{Math.abs(l.roi).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
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
                {rows.map((h) => (
                  <motion.div key={h.id} className="pn-hist" layout initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={M.spring.snappy}>
                    {h.result === "win" ? <Check size={20} color="var(--good)" aria-label="Зашла" /> : <X size={20} color="var(--bad)" aria-label="Не зашла" />}
                    <div style={{ minWidth: 0 }}>
                      {[h.home, h.away].map((team, i) => (
                        <div className="pn-hist__team" key={team}>
                          <Crest team={team} size={18} />
                          <span>{team}</span>
                          <b className="pn-num">{h.score.split(":")[i]}</b>
                        </div>
                      ))}
                      <div className="pn-small pn-muted">{h.pick} · кэф {h.odds.toFixed(2)}</div>
                    </div>
                    <span className="pn-num" style={{ fontSize: 16, color: h.result === "win" ? "var(--gold)" : "var(--tx2)" }}>
                      {h.amount >= 0 ? "+" : "−"}{money(h.amount)} {state.prefs.currency}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
              {rows.length === 0 && <p className="pn-small pn-muted" style={{ padding: "16px 0" }}>Таких ставок пока нет.</p>}
            </section>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const ALL_LEAGUES = ["Premier League", "La Liga", "Bundesliga", "Serie A"];

export function SettingsScreen() {
  const { state, dispatch } = useGame();
  const { prefs } = state;
  const set = (p: Partial<typeof prefs>) => dispatch({ type: "SET_PREF", prefs: p });

  return (
    <div className="pn-screen">
      <ConnectionsSection />

      <section className="pn-panel pn-panel--flat">
        <h2 className="pn-h2">Уведомления в Telegram</h2>
        <Switch label="Новый прогноз" on={prefs.newPicks} onToggle={() => set({ newPicks: !prefs.newPicks })} />
        <Switch label="Начало матча со ставкой" on={prefs.kickoff} onToggle={() => set({ kickoff: !prefs.kickoff })} />
        <Switch label="Голы в моих матчах" on={prefs.goals} onToggle={() => set({ goals: !prefs.goals })} />
      </section>

      <section className="pn-panel pn-panel--flat">
        <h2 className="pn-h2">Лиги в дайджесте</h2>
        <div className="pn-chips pn-chips--wrap">
          {ALL_LEAGUES.map((name) => (
            <Chip
              key={name}
              active={prefs.leagues.includes(name)}
              onClick={() => set({ leagues: prefs.leagues.includes(name) ? prefs.leagues.filter((l) => l !== name) : [...prefs.leagues, name] })}
            >
              <LeagueLogo league={name} size={13} /> {name}
            </Chip>
          ))}
        </div>
      </section>

      <section className="pn-panel pn-panel--flat">
        <h2 className="pn-h2">Интерфейс</h2>
        <Segmented<string>
          label="Валюта"
          value={prefs.currency}
          onChange={(currency) => set({ currency })}
          options={[{ id: "₽", label: "₽" }, { id: "$", label: "$" }, { id: "€", label: "€" }]}
        />
        <Segmented<ThemeChoice>
          label="Тема"
          value={state.theme}
          onChange={(theme) => dispatch({ type: "SET_THEME", theme })}
          options={[{ id: "auto", label: "Как в Telegram" }, { id: "light", label: "Светлая" }, { id: "dark", label: "Тёмная" }]}
        />
        <Switch label="Звук стадиона" hint="Свисток и трибуны во время матча" on={state.sound} onToggle={() => dispatch({ type: "SET_SOUND", on: !state.sound })} />
        <Switch label="Меньше анимации" hint="Без салюта и движения" on={state.calm} onToggle={() => dispatch({ type: "SET_CALM", on: !state.calm })} />
      </section>

      <section className="pn-panel pn-panel--flat">
        <h2 className="pn-h2">Перерыв: чеканка</h2>
        <KeepyUppy />
      </section>

      <section className="pn-panel pn-panel--flat">
        <h2 className="pn-h2">Демо</h2>
        <label className="pn-stack">
          <span className="pn-small pn-muted">Состояние ленты прогнозов</span>
          <select className="pn-select" value={state.feedState} onChange={(e) => dispatch({ type: "SET_FEED", state: e.target.value as FeedState })}>
            <option value="ok">Всё работает</option>
            <option value="stale">Данные устарели</option>
            <option value="offline">Нет связи</option>
            <option value="error">Ошибка сервера</option>
            <option value="nokey">Нет ключа модели</option>
          </select>
        </label>
        <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "ONBOARDING", show: true })}>Показать мастер первого запуска</motion.button>
        <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "SET_FRESH" })}>Показать как у нового пользователя</motion.button>
        {state.stopped ? (
          <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "STOP_LIFT" })}>Снять остановку</motion.button>
        ) : (
          <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "STOP_DEMO" })}>
            <CardIcon red /> Показать остановку по просадке
          </motion.button>
        )}
        <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "RESET" })}>Начать демо заново</motion.button>
        <p className="pn-small pn-muted">Цифры здесь демонстрационные, реальных денег в прототипе нет.</p>
      </section>
    </div>
  );
}
