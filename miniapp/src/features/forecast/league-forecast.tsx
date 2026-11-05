"use client";

import { motion } from "framer-motion";
import { Wand2 } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useForecasts, useMakeForecast } from "@/hooks/use-shadowscout";
import { errorText } from "@/lib/labels";
import { M } from "@/ui/motion";

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
