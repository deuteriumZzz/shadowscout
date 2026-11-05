"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, RefreshCw, ShieldQuestion } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Chip, FormPips, LeagueLogo, M, RollDigit } from "./fx";
import type { LiveMatch, LiveOption } from "./polymarket";
import { forecastHint, pickName } from "./screen-forecast";
import { useGame } from "./store";
import { WalletPositions } from "./screen-wallet";
import { useForecasts, useOpenPicks } from "@/hooks/use-shadowscout";
import { getWebApp, haptic } from "@/lib/telegram";

const REFRESH_MS = 30_000;

async function fetchMatches(): Promise<{ matches: LiveMatch[]; partial: boolean }> {
  const response = await fetch("/prototype/matches");
  if (!response.ok) throw new Error("Не удалось загрузить матчи");
  return response.json();
}

function openLink(url: string) {
  haptic("light");
  const tg = getWebApp() as unknown as { initData?: string; openLink?: (u: string) => void } | undefined;
  if (tg?.initData && tg.openLink) tg.openLink(url);
  else window.open(url, "_blank", "noopener");
}

const money = (v: number) => (v >= 1000 ? `$${Math.round(v / 1000)} тыс.` : `$${Math.round(v)}`);

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function dayLabel(iso: string, now: number) {
  const date = new Date(iso);
  const dayDiff = Math.round((new Date(date).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  if (dayDiff === 0) return "Сегодня";
  if (dayDiff === 1) return "Завтра";
  return sentenceCase(date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }));
}

/** A real crest from the feed. Remote and already sized, so a plain image is right. */
function TeamLogo({ src, alt, morph }: { src: string; alt: string; morph?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- remote logo from the data feed
  return <img className="pn-logo" src={src} alt={alt} width={28} height={28} loading="lazy" data-morph={morph} />;
}

function OddsTile({ option }: { option: LiveOption }) {
  // Only a change seen while watching flashes: the first load is not news.
  const shown = option.odds.toFixed(2);
  const [prev, setPrev] = useState(shown);
  const [move, setMove] = useState<{ up: boolean; n: number } | null>(null);
  if (shown !== prev) {
    setPrev(shown);
    setMove({ up: Number(shown) > Number(prev), n: (move?.n ?? 0) + 1 });
  }
  return (
    <div className="pn-tile pn-tile--static" title={option.title} aria-label={`${option.title}, кэф ${shown}`} role="group">
      {move && (
        <motion.i
          key={move.n}
          className="pn-tile__flash"
          style={{ background: move.up ? "var(--good)" : "var(--bad)" }}
          initial={{ opacity: 0.4 }}
          animate={{ opacity: 0 }}
          transition={{ duration: M.dur.crawl, ease: M.ease.smooth }}
          aria-hidden="true"
        />
      )}
      {move && (
        <motion.span
          key={`a${move.n}`}
          className="pn-tile__move"
          style={{ color: move.up ? "var(--good)" : "var(--bad)" }}
          initial={{ opacity: 1, y: move.up ? 4 : -4 }}
          animate={{ opacity: 0, y: 0 }}
          transition={{ duration: M.dur.crawl * 2, ease: M.ease.smooth }}
          aria-hidden="true"
        >
          {move.up ? "▲" : "▼"}
        </motion.span>
      )}
      <span className="pn-tile__label">{option.id.toUpperCase()}</span>
      <span className="pn-tile__odds">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={option.odds.toFixed(2)} initial={{ y: -12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }} transition={M.spring.snappy}>
            {option.odds.toFixed(2)}
          </motion.span>
        </AnimatePresence>
      </span>
    </div>
  );
}

function useMatches() {
  return useQuery({
    queryKey: ["polymarket-matches"],
    queryFn: fetchMatches,
    refetchInterval: REFRESH_MS,
    staleTime: 15_000,
    retry: 1,
  });
}

const GOAL_MS = 2600;

interface Goal {
  key: string;
  team: LiveMatch["home"];
  line: string;
}

/** A real goal, on any tab: the same broadcast wipe as designed. Mounted once, for the whole app. */
export function GoalAlerts() {
  const { data } = useMatches();
  const [goal, setGoal] = useState<Goal | null>(null);
  const seen = useRef(new Map<string, [number, number]>());
  useEffect(() => {
    for (const m of data?.matches ?? []) {
      if (m.espn?.state !== "in") continue;
      const { homeScore: h, awayScore: a } = m.espn;
      const before = seen.current.get(m.id);
      if (before && (h > before[0] || a > before[1])) {
        haptic("medium");
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to new data from the feed
        setGoal({ key: `${m.id}-${h}-${a}`, team: h > before[0] ? m.home : m.away, line: `${m.home.name} ${h}:${a} ${m.away.name}` });
      }
      seen.current.set(m.id, [h, a]);
    }
  }, [data]);
  useEffect(() => {
    if (!goal) return;
    const t = setTimeout(() => setGoal(null), GOAL_MS);
    return () => clearTimeout(t);
  }, [goal]);

  const color = goal?.team.color ? (goal.team.color.startsWith("#") ? goal.team.color : `#${goal.team.color}`) : "var(--accent)";
  return (
    <AnimatePresence>
      {goal && (
        <motion.div
          key={goal.key}
          className="pn-moment"
          role="status"
          aria-label={`Гол, ${goal.line}`}
          style={{ background: color, color: "#fff" }}
          initial={{ clipPath: "inset(0 100% 0 0)" }}
          animate={{ clipPath: "inset(0 0% 0 0)" }}
          exit={{ clipPath: "inset(0 0 0 100%)" }}
          transition={{ duration: M.dur.normal, ease: M.ease.smooth }}
          onClick={() => setGoal(null)}
        >
          <motion.i className="pn-moment__sweep" initial={{ x: "-120%" }} animate={{ x: "120%" }} transition={{ duration: M.dur.slow, ease: M.ease.sharp }} aria-hidden="true" />
          <motion.div className="pn-moment__disc" initial={{ scale: 0.3, rotate: -24 }} animate={{ scale: 1, rotate: 0 }} transition={{ ...M.spring.bouncy, delay: 0.16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- remote logo from the data feed */}
            <img src={goal.team.logo} alt="" width={62} height={62} style={{ objectFit: "contain" }} />
          </motion.div>
          <div style={{ minWidth: 0 }}>
            <motion.div className="pn-moment__big" initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ ...M.spring.snappy, delay: 0.2 }}>Гол!</motion.div>
            <motion.div className="pn-moment__line" initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ ...M.spring.snappy, delay: 0.28 }}>{goal.line}</motion.div>
          </div>
          <motion.div className="pn-moment__bar" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: GOAL_MS / 1000, ease: "linear" }} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Accepted bets waiting for the whistle, with the score once the match is on. */
function OpenPicks({ matches }: { matches: LiveMatch[] }) {
  const { data } = useOpenPicks();
  if (!data?.length) return null;
  return (
    <section className="pn-stack">
      <h2 className="pn-h2">Ставки без денег: {data.length}</h2>
      <div className="pn-panel pn-panel--flat" style={{ gap: 0, paddingBlock: 4 }}>
        {data.map((p) => {
          const match = matches.find((m) => `${m.home.name} - ${m.away.name}` === p.match);
          const live = match?.espn?.state === "in" ? match.espn : null;
          return (
            <div className="pn-row" key={p.id} style={{ padding: "11px 0", borderTop: "1px solid var(--line)" }}>
              <div style={{ minWidth: 0 }}>
                <b style={{ fontWeight: 600 }}>{p.match.replace(" - ", " — ")}</b>
                <p className="pn-small pn-muted">{pickName(p.match, p.market, p.pick, p.line)}, кэф {p.odds?.toFixed(2)}, ставка {Math.round(p.stake ?? 0).toLocaleString("ru-RU")}</p>
              </div>
              {live ? <span className="pn-num" style={{ fontSize: 20, color: "var(--live)" }}>{live.homeScore}:{live.awayScore}</span> : <span className="pn-small pn-muted" style={{ flex: "none" }}>{p.commence_time ? new Date(p.commence_time).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MatchCard({ match, index }: { match: LiveMatch; index: number }) {
  const { dispatch } = useGame();
  const card = useRef<HTMLElement>(null);
  function open() {
    const logo = (key: string) => card.current?.querySelector<HTMLElement>(`[data-morph="${key}"]`) ?? undefined;
    dispatch({ type: "OPEN_MATCH", match, morph: { home: logo("home"), away: logo("away") } });
  }
  const time = new Date(match.start).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const thinnest = match.options.length ? Math.min(...match.options.map((o) => o.available)) : 0;
  const espn = match.espn;
  const live = espn?.state === "in";
  const { data: forecasts } = useForecasts();
  const hint = forecastHint(forecasts, `${match.home.name} - ${match.away.name}`);
  return (
    <motion.article
      ref={card}
      className="pn-match"
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ ...M.spring.snappy, delay: Math.min(index, 6) * 0.04, layout: M.spring.snappy }}
    >
      <div className="pn-match__head">
        <LeagueLogo league={match.league} />
        <span>{match.league}</span>
        {live ? (
          <span className="pn-board__min" style={{ color: "var(--live)" }}><i className="pn-live" aria-hidden="true" /> {espn.clock}</span>
        ) : (
          <span>{time}</span>
        )}
      </div>
      <div className="pn-match__teams">
        {[match.home, match.away].map((team, i) => {
          const form = i ? espn?.awayForm : espn?.homeForm;
          return (
            <div className="pn-teamrow" key={team.name}>
              <TeamLogo src={team.logo} alt="" morph={i ? "away" : "home"} />
              <span className="pn-teamrow__name">{team.name}</span>
              {live ? (
                <span className="pn-num" style={{ marginLeft: "auto", fontSize: 22 }}><RollDigit value={i ? espn.awayScore : espn.homeScore} /></span>
              ) : (
                form && form.length > 0 && <FormPips form={form} />
              )}
            </div>
          );
        })}
      </div>
      <section className="pn-market" style={{ paddingBottom: 14 }}>
        {match.options.length > 0 && (
          <>
            <div className="pn-tiles">
              {match.options.map((o) => <OddsTile key={o.id} option={o} />)}
            </div>
            <p className="pn-small pn-muted">Объём {money(match.volume)}, в ценах от {money(thinnest)}</p>
          </>
        )}
        {hint && <p className="pn-small" style={{ color: "var(--accent)", fontWeight: 600 }}>{hint}</p>}
        <div className={match.options.length > 0 ? "pn-grid2" : "pn-stack"}>
          <motion.button className="pn-btn pn-btn--primary" whileTap={{ scale: M.press }} onClick={open}>Матч и прогноз</motion.button>
          {match.options.length > 0 && (
            <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => openLink(match.url)}>
              <ExternalLink size={17} aria-hidden="true" /> Polymarket
            </motion.button>
          )}
        </div>
      </section>
    </motion.article>
  );
}

/** Live football from Polymarket: real matches, real prices, refreshed in the background. */
export function MarketsView() {
  const { data, isPending, isError, refetch, isFetching, dataUpdatedAt } = useMatches();
  const [league, setLeague] = useState("all");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const matches = useMemo(() => data?.matches ?? [], [data]);
  const leagues = useMemo(() => [...new Set(matches.map((m) => m.league))], [matches]);
  const shown = matches.filter((m) => league === "all" || m.league === league);
  const groups = useMemo(() => {
    const byDay = new Map<string, LiveMatch[]>();
    for (const m of shown) {
      const key = m.espn?.state === "in" ? "Сейчас идут" : dayLabel(m.start, now);
      byDay.set(key, [...(byDay.get(key) ?? []), m]);
    }
    return [...byDay.entries()];
  }, [shown, now]);

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

  return (
    <div className="pn-screen">
      <div className="pn-chips" role="group" aria-label="Фильтр по лигам">
        <Chip active={league === "all"} onClick={() => setLeague("all")}>Все</Chip>
        {leagues.map((l) => (
          <Chip key={l} active={league === l} onClick={() => setLeague(l)}><LeagueLogo league={l} size={13} /> {l}</Chip>
        ))}
      </div>
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
          <h2 className="pn-h2">Ближайших матчей нет</h2>
          <p className="pn-small pn-muted">Рынки появятся ближе к следующему туру.</p>
        </section>
      )}

      <p className="pn-small pn-muted" style={{ textAlign: "center" }}>
        Настоящие цены Polymarket, счёт и статистика ESPN. Кэфы показаны с учётом комиссии{data?.partial ? ", часть данных сейчас недоступна" : ""}.
      </p>
    </div>
  );
}

/** The real "on right now" list for the Live tab. */
export function LiveNowSection() {
  const { data, isPending } = useMatches();
  const matches = useMemo(() => data?.matches ?? [], [data]);
  const live = matches.filter((m) => m.espn?.state === "in");
  const next = matches.find((m) => m.espn?.state !== "in");
  if (isPending) return <div className="pn-skeleton" style={{ height: 90 }} aria-busy="true" />;
  return (
    <section className="pn-stack">
      <h2 className="pn-h2">Сейчас идут: {live.length}</h2>
      {live.length === 0 && (
        <p className="pn-small pn-muted">
          Сейчас матчей нет.{next ? ` Ближайший: ${next.home.name} — ${next.away.name}, ${new Date(next.start).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}.` : ""}
        </p>
      )}
      <AnimatePresence initial={false} mode="popLayout">
        {live.map((m, i) => <MatchCard key={m.id} match={m} index={i} />)}
      </AnimatePresence>
      <WalletPositions matches={matches} />
      <OpenPicks matches={matches} />
    </section>
  );
}
