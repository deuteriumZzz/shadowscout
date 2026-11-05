"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { useBacktest } from "@/hooks/use-shadowscout";
import { errorText } from "@/lib/labels";
import { Chip } from "@/ui/controls";
import { M } from "@/ui/motion";

const LEAGUES = ["Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1"];
const LAST_FULL_SEASON = 2024; // the newest one API-Football's free key can read

/** How the plain statistical baseline would have done on a past season. Needs an API-Football key. */
export function BacktestPanel() {
  const [league, setLeague] = useState(LEAGUES[0]);
  const [season, setSeason] = useState(String(LAST_FULL_SEASON));
  const run = useBacktest();
  const result = run.data;
  return (
    <section className="pn-panel pn-panel--flat">
      <h2 className="pn-h2">Проверка на истории</h2>
      <p className="pn-small pn-muted">Как простая статистическая модель сыграла бы прошлый сезон. Нужен ключ API-Football, запрос занимает до минуты. LLM здесь не участвует.</p>
      <div className="pn-chips pn-chips--wrap">
        {LEAGUES.map((name) => <Chip key={name} active={league === name} onClick={() => setLeague(name)}>{name}</Chip>)}
      </div>
      <input className="pn-input pn-input--text" inputMode="numeric" aria-label="Сезон, год начала" value={season} onChange={(e) => setSeason(e.target.value)} />
      <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} disabled={run.isPending || !/^\d{4}$/.test(season)} onClick={() => run.mutate({ league, season: Number(season) })}>
        {run.isPending ? "Считаю…" : "Запустить"}
      </motion.button>
      {run.isError && <p className="pn-small" style={{ color: "var(--bad)" }} role="alert">{errorText(run.error)}</p>}
      {result && (result.league_id === null || result.n === 0 ? (
        <p className="pn-small pn-muted">Данных за этот сезон нет: проверьте ключ API-Football и год.</p>
      ) : (
        <>
          <div className="pn-row pn-small"><span className="pn-muted">Матчей</span><b className="pn-num" style={{ fontSize: 16 }}>{result.n}</b></div>
          {result.brier !== null && <div className="pn-row pn-small"><span className="pn-muted">Ошибка, 0.25 это монетка</span><b className="pn-num" style={{ fontSize: 16 }}>{result.brier.toFixed(3)}</b></div>}
          {result.hit_rate !== null && <div className="pn-row pn-small"><span className="pn-muted">Угадано исходов</span><b className="pn-num" style={{ fontSize: 16 }}>{(result.hit_rate * 100).toFixed(1)}%</b></div>}
        </>
      ))}
    </section>
  );
}
