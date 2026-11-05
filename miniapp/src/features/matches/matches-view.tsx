"use client";

import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, ShieldQuestion } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LeagueForecast } from "@/features/forecast/league-forecast";
import { matchOfTheDay, type LiveMatch } from "@/lib/feeds/polymarket";
import { useGame } from "@/store/app-store";
import { Chip } from "@/ui/controls";
import { LeagueLogo } from "@/ui/football";
import { M } from "@/ui/motion";
import { MatchCard } from "./match-card";
import { MatchOfDay } from "./match-of-day";
import { useMatches } from "./use-matches";

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function dayLabel(iso: string, now: number) {
  const date = new Date(iso);
  const dayDiff = Math.round((new Date(date).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  if (dayDiff === 0) return "Сегодня";
  if (dayDiff === 1) return "Завтра";
  return sentenceCase(date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }));
}

const foldName = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Live football from Polymarket: real matches, real prices, refreshed in the background. */
export function MarketsView() {
  const { data, isPending, isError, refetch, isFetching, dataUpdatedAt } = useMatches();
  const { state: { favorites } } = useGame();
  const [league, setLeague] = useState("all");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const matches = useMemo(() => data?.matches ?? [], [data]);
  const leagues = useMemo(() => [...new Set(matches.map((m) => m.league))], [matches]);
  const wanted = foldName(query.trim());
  const shown = matches.filter(
    (m) => (league === "all" || m.league === league) && (!wanted || foldName(`${m.home.name} ${m.away.name}`).includes(wanted)),
  );
  const groups = useMemo(() => {
    const byDay = new Map<string, LiveMatch[]>();
    for (const m of shown) {
      const liked = favorites.includes(m.home.name) || favorites.includes(m.away.name);
      const key = m.espn?.state === "in" ? "Сейчас идут" : liked ? "Избранное" : dayLabel(m.start, now);
      byDay.set(key, [...(byDay.get(key) ?? []), m]);
    }
    // What's on now comes first, then your clubs, then the days in order.
    const rank = (key: string) => (key === "Сейчас идут" ? 0 : key === "Избранное" ? 1 : 2);
    return [...byDay.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [shown, now, favorites]);
  const leagueTodo = useMemo(
    () => matches.filter((m) => m.league === league && m.options.length > 0 && m.espn?.state !== "in").map((m) => ({ home: m.home.name, away: m.away.name })),
    [matches, league],
  );

  if (isPending) {
    return (
      <div className="pn-screen" aria-busy="true" aria-label="Загружаем матчи">
        <div className="pn-chips">{[48, 146, 100, 117].map((w) => <div key={w} className="pn-skeleton" style={{ width: w, height: 38, flex: "none", borderRadius: 19 }} />)}</div>
        {[0, 1, 2].map((c) => <div key={c} className="pn-skeleton" style={{ height: 250 }} />)}
      </div>
    );
  }

  if (isError && !data) {
    return (
      <div className="pn-screen">
        <section className="pn-notice" role="status">
          <span className="pn-notice__icon"><ShieldQuestion size={26} aria-hidden="true" /></span>
          <h2 className="pn-h2">Матчи не загрузились</h2>
          <p className="pn-small pn-muted">Polymarket сейчас не отвечает. Проверьте связь и попробуйте ещё раз.</p>
          <button className="pn-btn pn-btn--primary" style={{ alignSelf: "stretch" }} onClick={() => refetch()}>Повторить</button>
        </section>
      </div>
    );
  }

  const age = Math.max(0, Math.round((now - dataUpdatedAt) / 1000));
  const stale = isError;
  // A search is looking for something specific: the poster would only be in the way.
  const poster = wanted ? null : matchOfTheDay(shown);

  return (
    <div className="pn-screen">
      {poster && <MatchOfDay key={poster.id} match={poster} />}
      <div className="pn-chips" role="group" aria-label="Фильтр по лигам">
        <Chip active={league === "all"} onClick={() => setLeague("all")}>Все</Chip>
        {leagues.map((l) => (
          <Chip key={l} active={league === l} onClick={() => setLeague(l)}><LeagueLogo league={l} size={13} /> {l}</Chip>
        ))}
      </div>
      <input className="pn-search" type="search" placeholder="Поиск команды" aria-label="Поиск команды" autoComplete="off" spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} />
      {league !== "all" && <LeagueForecast league={league} matches={leagueTodo} />}
      <div className="pn-row">
        <p className="pn-fresh" data-stale={stale} style={{ marginTop: 0 }}>
          {stale ? "Нет обновлений, цены могли устареть" : age < 10 ? "Цены только что обновлены" : `Цены обновлены ${age} с назад`}
        </p>
        <motion.button className="pn-icon" style={{ margin: -8 }} aria-label="Обновить цены" animate={{ rotate: isFetching ? 360 : 0 }} transition={isFetching ? { repeat: Infinity, duration: M.dur.crawl, ease: "linear" } : { duration: 0 }} onClick={() => refetch()}>
          <RefreshCw size={16} color="var(--tx2)" aria-hidden="true" />
        </motion.button>
      </div>

      {groups.map(([day, list]) => (
        <section className="pn-stack" key={day} style={{ gap: 10 }}>
          <h2 className="pn-h2">{day}</h2>
          <AnimatePresence mode="popLayout" initial={false}>
            {list.map((m, i) => <MatchCard key={m.id} match={m} index={i} />)}
          </AnimatePresence>
        </section>
      ))}

      {!shown.length && (
        <section className="pn-notice" role="status">
          <h2 className="pn-h2">{wanted ? "Таких матчей нет" : "Ближайших матчей нет"}</h2>
          <p className="pn-small pn-muted">{wanted ? "Названия команд в ленте на английском: например, Arsenal или Bayern." : "Рынки появятся ближе к следующему туру."}</p>
        </section>
      )}

      <p className="pn-small pn-muted" style={{ textAlign: "center" }}>
        Настоящие цены Polymarket, счёт и статистика ESPN. Кэфы показаны с учётом комиссии{data?.partial ? ", часть данных сейчас недоступна" : ""}.
      </p>
    </div>
  );
}
