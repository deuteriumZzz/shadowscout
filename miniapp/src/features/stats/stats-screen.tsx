"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, Check, Minus, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { useForecastScores, useHistory, useStats } from "@/hooks/use-shadowscout";
import type { FormResult } from "@/lib/clubs";
import type { HelpTopic } from "@/lib/help";
import { errorText, pickName } from "@/lib/labels";
import type { Pick } from "@/lib/types";
import { useGame } from "@/store/app-store";
import { Chip, HelpButton, Segmented } from "@/ui/controls";
import { Crest, FormPips, LeagueLogo } from "@/ui/football";
import { M } from "@/ui/motion";
import { FeedNotice } from "@/ui/notice";

const money = (v: number) => Math.abs(Math.round(v)).toLocaleString("ru-RU");

function ApiNotice({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="pn-screen">
      <FeedNotice icon={<ShieldAlert size={26} aria-hidden="true" />} title="Данные не загрузились" text={errorText(error)} action="Повторить" onAction={retry} />
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
  const verdict = data.low_sample ? "Рано судить" : data.beats_market ? "Модель точнее рынка" : "Модель не точнее рынка";
  const detail = data.low_sample ? `${data.forecasts} из ${data.min_sample} прогнозов. ` : data.beats_market ? "" : "Реальные деньги сюда не стоит. ";
  return (
    <section className="pn-verdict">
      <div className="pn-row">
        <span className="pn-small pn-muted">Модель против рынка</span>
        <HelpButton topic="brier" />
      </div>
      <h2>{verdict}</h2>
      <p className="pn-small pn-muted">{detail}Ошибка модели {data.model_brier?.toFixed(3)}, рынка {data.market_brier?.toFixed(3)}: чем меньше, тем лучше.</p>
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
            {s.settled > 0 && (
              <div className="pn-kpis" data-wide={s.avg_clv !== null && s.brier_score !== null}>
                <Kpi label="Побед" value={`${s.win_rate.toFixed(1)}%`} sub={`${s.wins} из ${s.settled}, диапазон ${s.win_rate_ci[0].toFixed(0)}–${s.win_rate_ci[1].toFixed(0)}%`} topic="winrate" />
                <Kpi label="ROI" value={signed(s.roi)} sub="на дистанции" topic="roi" tone={toneOf(s.roi)} />
                {s.avg_clv !== null && <Kpi label="Плюс к линии" value={signed(s.avg_clv)} sub={`по ${s.clv_sample} ставкам`} topic="clv" tone={toneOf(s.avg_clv)} />}
                {s.brier_score !== null && <Kpi label="Точность" value={s.brier_score.toFixed(3)} sub="0 идеал, 0.25 монетка" topic="brier" />}
              </div>
            )}
            {form.length > 0 && (
              <div className="pn-row" style={{ padding: "2px 2px" }}>
                <b style={{ fontWeight: 600 }}>Форма</b>
                <FormPips form={form} />
              </div>
            )}
            {s.low_sample && s.settled > 0 && <p className="pn-small pn-muted">Выборка мала: {s.settled} закрытых ставок. Выводы лучше делать после 30 и больше.</p>}
            {leagues.length > 0 && (
              <section className="pn-stack" style={{ marginTop: 8 }}>
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
                        {amount >= 0 ? "+" : "−"}{money(amount)} {state.currency}
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
