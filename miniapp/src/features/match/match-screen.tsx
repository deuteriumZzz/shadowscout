"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useIsPresent, useScroll, useTransform } from "framer-motion";
import { ArrowLeftRight, ExternalLink, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EventKind, Lineup, MatchDetail as Detail, TableRow } from "@/lib/feeds/espn";
import { ForecastSection } from "@/features/forecast/forecast";
import { clubColor } from "@/lib/clubs";
import { haptic } from "@/lib/telegram";
import { Ball, CardIcon, ClubTints, FormPips, teamNameSize } from "@/ui/football";
import { flyIn, flyOut, M, type Morph } from "@/ui/motion";
import { RollDigit } from "@/ui/numbers";
import { Segmented } from "@/ui/controls";
import { MatchTimeline, PriceLine } from "@/features/match/match-charts";
import { useGame } from "@/store/app-store";
import type { LiveMatch } from "@/lib/feeds/polymarket";

const MINI_FADE_START = 50;
const BOARD_FADE_END = 100;
const LIVE_REFRESH_MS = 20_000;
const IDLE_REFRESH_MS = 120_000;

type View = "forecast" | "overview" | "events" | "stats" | "lineups";

const SWIPE_MIN = 60;
// These answer to a finger moving across them: a swipe there would change the tab by accident.
const NO_SWIPE = ".pn-chart, .pn-tline, .pn-seg";

const KIND_LABEL: Record<EventKind, string> = { goal: "Гол", yellow: "Жёлтая карточка", red: "Красная карточка", sub: "Замена" };

function EventIcon({ kind }: { kind: EventKind }) {
  if (kind === "goal") return <Ball size={18} />;
  if (kind === "yellow") return <CardIcon />;
  if (kind === "red") return <CardIcon red />;
  return <ArrowLeftRight size={15} color="var(--tx2)" aria-hidden="true" />;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="pn-small pn-muted" style={{ padding: "18px 4px", textAlign: "center" }}>{children}</p>;
}

function Events({ detail, match }: { detail: Detail; match: LiveMatch }) {
  if (!detail.events.length) {
    return <Empty>{detail.state === "pre" ? "Матч ещё не начался. События появятся здесь сами." : "Пока без событий."}</Empty>;
  }
  const team = (side: "home" | "away" | null) => (side ? match[side].name : "");
  return (
    <div className="pn-tl">
      <AnimatePresence initial={false}>
        {[...detail.events].reverse().map((e) => (
          <motion.div key={`${e.minute}-${e.kind}-${e.player}`} className="pn-tl__item" layout initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={M.spring.snappy}>
            <span className="pn-num pn-muted">{e.minute}</span>
            <span className="pn-tl__icon"><EventIcon kind={e.kind} /></span>
            <span>
              {KIND_LABEL[e.kind]}: {e.player}
              <small>
                {team(e.side)}
                {e.other ? `${team(e.side) ? " · " : ""}${e.kind === "sub" ? "уходит" : "пас"}: ${e.other}` : ""}
              </small>
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Stats({ detail, match }: { detail: Detail; match: LiveMatch }) {
  if (detail.state === "pre" || !detail.stats.length) return <Empty>Статистика появится после начала матча.</Empty>;
  return (
    <div className="pn-panel pn-panel--flat">
      <div className="pn-row pn-small">
        <b style={{ fontWeight: 600 }}>{match.home.name}</b>
        <b style={{ fontWeight: 600 }}>{match.away.name}</b>
      </div>
      {detail.stats.map((s) => {
        const total = s.home + s.away || 1;
        return (
          <div className="pn-stat" key={s.label}>
            <div className="pn-row pn-small">
              <b className="pn-num" style={{ fontSize: 16 }}>{s.home}</b>
              <span className="pn-muted">{s.label}</span>
              <b className="pn-num" style={{ fontSize: 16 }}>{s.away}</b>
            </div>
            <div className="pn-stat__bars" aria-hidden="true">
              <div className="pn-stat__bar"><motion.span initial={{ scaleX: 0 }} animate={{ scaleX: s.home / total }} transition={M.spring.gentle} /></div>
              <div className="pn-stat__bar pn-stat__bar--away"><motion.span initial={{ scaleX: 0 }} animate={{ scaleX: s.away / total }} transition={M.spring.gentle} /></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Both teams on one pitch: home in the lower half attacking up, away mirrored. */
function Pitch({ detail, match }: { detail: Detail; match: LiveMatch }) {
  const { lineups } = detail;
  const pitch = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // Players start from the centre spot, which is measured because motion works in pixels.
  useLayoutEffect(() => {
    if (!pitch.current) return;
     
    setSize({ w: pitch.current.clientWidth, h: pitch.current.clientHeight });
  }, [lineups]);
  if (!lineups) return <Empty>Составы появятся примерно за час до начала матча.</Empty>;
  // The away team faces the other way, so its left is on the right of the screen.
  const place = (lineup: Lineup, flip: boolean, color: string) =>
    lineup.lines.flatMap((line, row) =>
      line.map((player, i) => {
        // Half the pitch per team, split evenly however many lines the formation has.
        const y = 6 + (row * 40) / Math.max(1, lineup.lines.length - 1);
        const x = ((i + 1) / (line.length + 1)) * 100;
        return { ...player, color, x: flip ? x : 100 - x, y: flip ? 100 - y : y };
      }),
    );
  const players = [
    ...place(lineups.away, false, clubColor(match.away) ?? "#5b8def"),
    ...place(lineups.home, true, clubColor(match.home) ?? "#22c55e"),
  ];
  return (
    <div className="pn-stack">
      <div className="pn-row pn-small pn-muted">
        <span>{match.away.name}: {lineups.away.formation}</span>
        <span>{match.home.name}: {lineups.home.formation}</span>
      </div>
      <div className="pn-pitch" ref={pitch} role="img" aria-label="Расстановка команд на поле">
        <svg viewBox="0 0 68 100" preserveAspectRatio="none" aria-hidden="true">
          <g fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="0.4">
            <rect x="2" y="2" width="64" height="96" />
            <line x1="2" y1="50" x2="66" y2="50" />
            <circle cx="34" cy="50" r="8" />
            <rect x="16" y="2" width="36" height="13" />
            <rect x="16" y="85" width="36" height="13" />
          </g>
        </svg>
        {size && players.map((p, i) => (
          <motion.div
            key={`${p.name}${p.jersey}${i}`}
            className="pn-player"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            initial={{ opacity: 0, scale: 0.5, x: ((50 - p.x) / 100) * size.w, y: ((50 - p.y) / 100) * size.h }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            transition={{ ...M.spring.gentle, delay: i * 0.025 }}
          >
            <i className="pn-player__num" style={{ background: p.color }}>{p.jersey}</i>
            <span className="pn-player__name">{p.name}</span>
          </motion.div>
        ))}
      </div>
      {[{ team: match.home, lineup: lineups.home }, { team: match.away, lineup: lineups.away }].map(({ team, lineup }) =>
        lineup.subs.length ? (
          <p className="pn-small pn-muted" key={team.name}>
            <b style={{ fontWeight: 600 }}>Запас, {team.name}:</b> {lineup.subs.map((s) => s.name).join(", ")}
          </p>
        ) : null,
      )}
    </div>
  );
}

function TableLine({ name, row }: { name: string; row: TableRow | null }) {
  return (
    <div className="pn-row pn-small">
      <span>{name}</span>
      <span className="pn-muted">{row ? `${row.rank} место, ${row.points} очк., ${row.played} игр` : "нет данных"}</span>
    </div>
  );
}

function Overview({ detail, match }: { detail: Detail; match: LiveMatch }) {
  const hasForm = detail.form.home.length > 0 || detail.form.away.length > 0;
  const hasTable = detail.table.home || detail.table.away;
  return (
    <div className="pn-stack" style={{ gap: 12 }}>
      {hasForm && (
        <section className="pn-panel pn-panel--flat">
          <b style={{ fontWeight: 600 }}>Форма, последние матчи</b>
          <div className="pn-row pn-small"><span>{match.home.name}</span><FormPips form={detail.form.home} /></div>
          <div className="pn-row pn-small"><span>{match.away.name}</span><FormPips form={detail.form.away} /></div>
        </section>
      )}
      {hasTable && (
        <section className="pn-panel pn-panel--flat">
          <b style={{ fontWeight: 600 }}>Положение в таблице</b>
          <TableLine name={match.home.name} row={detail.table.home} />
          <TableLine name={match.away.name} row={detail.table.away} />
        </section>
      )}
      {!hasForm && !hasTable && <Empty>Данных об этом матче пока нет.</Empty>}
    </div>
  );
}

async function fetchDetail(id: string, code: string): Promise<Detail> {
  const response = await fetch(`/feed/match/${id}?code=${encodeURIComponent(code)}`);
  if (!response.ok) throw new Error("Данные матча недоступны");
  return response.json();
}

/** The real match centre: refreshes by itself, faster while the match is on. */
export function MatchDetailScreen({ match, morph, onClose, onBet }: { match: LiveMatch; morph?: Morph; onClose: () => void; onBet: () => void }) {
  const { state: { calm } } = useGame();
  const espn = match.espn;
  const body = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLElement>(null);

  // The crests fly out of the card into the board, and back on closing, however it was closed.
  useLayoutEffect(() => {
    if (!morph || calm || !board.current) return;
    return flyIn(morph, board.current);
  }, [morph, calm]);
  const present = useIsPresent();
  useLayoutEffect(() => {
    if (!present && morph && !calm && board.current && (body.current?.scrollTop ?? 0) < BOARD_FADE_END / 2) flyOut(morph, board.current);
  }, [present, morph, calm]);

  // Scrolling folds the big board into a thin bar, so the score stays in sight.
  const { scrollY } = useScroll({ container: body });
  const miniOpacity = useTransform(scrollY, [MINI_FADE_START, BOARD_FADE_END], [0, 1]);
  const leagueOpacity = useTransform(scrollY, [MINI_FADE_START, BOARD_FADE_END], [1, 0]);
  const boardScale = useTransform(scrollY, [0, BOARD_FADE_END], [1, 0.94]);
  const boardOpacity = useTransform(scrollY, [0, BOARD_FADE_END], [1, 0.35]);

  const [chosen, setChosen] = useState<View | null>(null);
  const [direction, setDirection] = useState(1);
  const canSwipe = useRef(false);
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["match-detail", espn?.id],
    queryFn: () => fetchDetail(espn!.id, espn!.code),
    enabled: !!espn,
    refetchInterval: (query) => (query.state.data?.state === "in" ? LIVE_REFRESH_MS : IDLE_REFRESH_MS),
    retry: 1,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".pn-sheet") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const phone = typeof document !== "undefined" ? document.querySelector(".pn-phone") : null;
  if (!phone) return null;

  const state = data?.state ?? espn?.state ?? "pre";
  const homeScore = data?.homeScore ?? espn?.homeScore ?? 0;
  const awayScore = data?.awayScore ?? espn?.awayScore ?? 0;
  const clock = data?.clock ?? espn?.clock ?? "";
  const when = new Date(match.start).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  // A forecast is for a match that hasn't started: once it kicks off, the tab goes and the match takes over.
  const canForecast = match.options.length > 0 && state === "pre";
  const view: View = chosen === "forecast" && !canForecast ? "overview" : chosen ?? (canForecast ? "forecast" : "overview");
  const tabs: { id: View; label: string }[] = [
    ...(canForecast ? [{ id: "forecast" as const, label: "Прогноз" }] : []),
    { id: "overview", label: "Обзор" },
    ...(data ? [{ id: "events" as const, label: "События" }, { id: "stats" as const, label: "Статистика" }, { id: "lineups" as const, label: "Составы" }] : []),
  ];
  const goTo = (next: View) => {
    setDirection(tabs.findIndex((t) => t.id === next) > tabs.findIndex((t) => t.id === view) ? 1 : -1);
    setChosen(next);
  };

  return createPortal(
    <motion.div className="pn-detail" role="dialog" aria-modal="true" aria-label={`${match.home.name} против ${match.away.name}`} initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={M.spring.sheet}>
      <header className="pn-detail__head">
        <motion.span className="pn-small pn-muted" style={{ flex: 1, opacity: leagueOpacity }}>{match.league}</motion.span>
        <motion.div className="pn-detail__mini" style={{ opacity: miniOpacity }} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- remote logo from the data feed */}
          <img src={match.home.logo} alt="" width={22} height={22} />
          {state === "pre" ? (
            <span className="pn-small pn-muted">{new Date(match.start).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
          ) : (
            <b className="pn-num">{homeScore}:{awayScore}</b>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element -- remote logo from the data feed */}
          <img src={match.away.logo} alt="" width={22} height={22} />
          {state === "in" && <span className="pn-small" style={{ color: "var(--live)" }}>{clock}</span>}
        </motion.div>
        <button className="pn-icon" aria-label="Закрыть" onClick={onClose}><X size={22} aria-hidden="true" /></button>
      </header>
      <motion.div
        className="pn-detail__body"
        ref={body}
        style={{ touchAction: "pan-y" }}
        onPanStart={(e) => {
          canSwipe.current = !(e.target as Element | null)?.closest?.(NO_SWIPE);
        }}
        onPanEnd={(_, { offset }) => {
          if (!canSwipe.current || Math.abs(offset.x) < SWIPE_MIN || Math.abs(offset.x) < Math.abs(offset.y) * 2) return;
          const next = tabs[tabs.findIndex((t) => t.id === view) + (offset.x < 0 ? 1 : -1)];
          if (!next) return;
          haptic("light");
          goTo(next.id);
        }}
      >
        <motion.section ref={board} className="pn-board" style={{ scale: boardScale, opacity: boardOpacity }} aria-label={state === "pre" ? `Начало ${when}` : `Счёт ${homeScore}:${awayScore}`}>
          <ClubTints home={match.home} away={match.away} />
          {[match.home, match.away].map((team, i) => (
            <div className="pn-board__team" key={team.name} style={{ gridColumn: i ? 3 : 1, gridRow: 1, fontSize: teamNameSize(team.name) }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- remote logo from the data feed */}
              <img src={team.logo} alt="" width={54} height={54} style={{ objectFit: "contain" }} data-morph-to={i ? "away" : "home"} />
              {team.name}
            </div>
          ))}
          <div className="pn-board__mid" style={{ gridColumn: 2, gridRow: 1 }}>
            {state === "pre" ? (
              <span className="pn-small pn-muted" style={{ textAlign: "center", marginTop: 8, maxWidth: 96 }}>{when}</span>
            ) : (
              <>
                <span className="pn-board__min">
                  {state === "in" && <i className="pn-live" aria-hidden="true" />}
                  {state === "post" ? "Финал" : clock}
                </span>
                <div className="pn-board__score">
                  <RollDigit value={homeScore} />
                  <span aria-hidden="true">:</span>
                  <RollDigit value={awayScore} />
                </div>
              </>
            )}
          </div>
        </motion.section>

        {data && <MatchTimeline detail={data} match={match} />}
        {tabs.length > 1 && <Segmented<View> label="Раздел матча" value={view} onChange={goTo} options={tabs} />}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            className="pn-stack"
            style={{ gap: 12 }}
            initial={{ opacity: 0, x: direction * 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: M.dur.fast }}
          >
            {view === "forecast" && <ForecastSection home={match.home.name} away={match.away.name} league={match.league} />}
            {view === "overview" && (
              <>
                <PriceLine match={match} detail={data} />
                {!espn ? (
                  <Empty>Для этого матча нет подробных данных: мы не смогли надёжно найти его в источнике статистики.</Empty>
                ) : isPending ? (
                  <div className="pn-skeleton" style={{ height: 220 }} aria-busy="true" />
                ) : isError && !data ? (
                  <section className="pn-notice" role="status">
                    <p className="pn-small pn-muted">Данные матча сейчас недоступны.</p>
                    <button className="pn-btn pn-btn--ghost" onClick={() => refetch()}>Повторить</button>
                  </section>
                ) : data ? (
                  <Overview detail={data} match={match} />
                ) : null}
              </>
            )}
            {data && view === "events" && <Events detail={data} match={match} />}
            {data && view === "stats" && <Stats detail={data} match={match} />}
            {data && view === "lineups" && <Pitch detail={data} match={match} />}
          </motion.div>
        </AnimatePresence>
      </motion.div>
      {match.options.length > 0 && state !== "post" && (
        <div className="pn-detail__foot">
          <motion.button className="pn-btn pn-btn--ghost" style={{ width: "100%" }} whileTap={{ scale: M.press }} onClick={onBet}>
            <ExternalLink size={17} aria-hidden="true" /> Открыть на Polymarket
          </motion.button>
        </div>
      )}
    </motion.div>,
    phone,
  );
}
