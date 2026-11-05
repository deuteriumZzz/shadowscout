"use client";

import { useQuery } from "@tanstack/react-query";
import { animate, AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { minuteValue, type EventKind, type MatchDetail, type MatchEventRow } from "@/lib/feeds/espn";
import { Ball, CardIcon } from "@/ui/football";
import { M } from "@/ui/motion";
import type { LiveMatch, PricePoint } from "@/lib/feeds/polymarket";
import { useGame } from "@/store/app-store";
import { haptic } from "@/lib/telegram";

const REGULATION = 90;
const CLOSE_MINUTES = 6; // nearer than this on one side, two marks would sit on top of each other
const PLOT_HEIGHT = 64;
const LANE_STEP = 18;
const SHOWN_KINDS: EventKind[] = ["goal", "yellow", "red"];
const KIND_NAME: Record<EventKind, string> = { goal: "Гол", yellow: "Жёлтая карточка", red: "Красная карточка", sub: "Замена" };

/** Moves a mark to a second row when it would land on the one before it, goals taking the first row. */
function withLanes<T extends { value: number; side: "home" | "away" | null; kind: EventKind }>(rows: T[]) {
  const lastInLane: Record<string, number[]> = { home: [-Infinity, -Infinity], away: [-Infinity, -Infinity] };
  const ordered = [...rows].sort((a, b) => Number(b.kind === "goal") - Number(a.kind === "goal") || a.value - b.value);
  const taken = new Map<T, number>();
  for (const row of ordered) {
    const lanes = lastInLane[row.side ?? "home"];
    const lane = Math.abs(row.value - lanes[0]) >= CLOSE_MINUTES ? 0 : Math.abs(row.value - lanes[1]) >= CLOSE_MINUTES ? 1 : lanes[0] <= lanes[1] ? 0 : 1;
    lanes[lane] = row.value;
    taken.set(row, lane);
  }
  return rows.map((row) => ({ ...row, lane: taken.get(row) ?? 0 }));
}

/** The match at a glance: home's moments above the line, away's below, as they happen. */
export function MatchTimeline({ detail, match }: { detail: MatchDetail; match: LiveMatch }) {
  const [picked, setPicked] = useState<string | null>(null);
  const rows = useMemo(
    () =>
      withLanes(
        detail.events.flatMap((e) => {
          const minute = minuteValue(e.minute);
          return minute !== null && SHOWN_KINDS.includes(e.kind) ? [{ ...e, value: minute, key: `${e.minute}-${e.kind}-${e.player}` }] : [];
        }),
      ),
    [detail.events],
  );
  if (detail.state === "pre") return null;

  const clockNow = minuteValue(detail.clock);
  const length = Math.max(REGULATION, clockNow ?? 0, ...rows.map((r) => r.value));
  const played = detail.state === "post" ? 1 : Math.min(1, (clockNow ?? 0) / length);
  const goals = rows.filter((r) => r.kind === "goal");
  const chosen = rows.find((r) => r.key === picked);
  const team = (e: MatchEventRow) => (e.side === "home" ? match.home.name : e.side === "away" ? match.away.name : "");

  return (
    <section className="pn-tline" aria-label={goals.length ? `Голы: ${goals.map((g) => `${g.minute} ${g.player}`).join(", ")}` : "Лента матча, голов пока нет"}>
      <div className="pn-tline__plot" style={{ height: PLOT_HEIGHT + (rows.some((r) => r.lane) ? LANE_STEP * 2 : 0) }}>
        <div className="pn-tline__track" aria-hidden="true">
          <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: played }} transition={M.spring.gentle} />
          <b style={{ left: `${(45 / length) * 100}%` }} />
        </div>
        <AnimatePresence initial={false}>
          {rows.map((e, i) => (
            <motion.button
              key={e.key}
              className="pn-tline__mark"
              data-side={e.side ?? "home"}
              aria-label={`${e.minute} ${KIND_NAME[e.kind]}: ${e.player}`}
              aria-pressed={picked === e.key}
              data-kind={e.kind}
              style={{ left: `${(e.value / length) * 100}%`, [e.side === "away" ? "top" : "bottom"]: `calc(50% + 2px + ${e.lane * LANE_STEP}px)` }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ ...M.spring.bouncy, delay: 0.12 + Math.min(i, 8) * 0.04 }}
              onClick={() => setPicked(picked === e.key ? null : e.key)}
            >
              {e.kind === "goal" ? <Ball size={15} /> : <CardIcon red={e.kind === "red"} />}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
      <div className="pn-row pn-small pn-muted" style={{ gap: 8 }}>
        <span>0&apos;</span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>▲ {match.home.name} · ▼ {match.away.name}</span>
        <span>{length}&apos;</span>
      </div>
      {chosen && (
        <p className="pn-small">{chosen.minute} · {KIND_NAME[chosen.kind]}: {chosen.player}{team(chosen) ? `, ${team(chosen)}` : ""}{chosen.other && chosen.kind === "goal" ? `, пас: ${chosen.other}` : ""}</p>
      )}
    </section>
  );
}

const HOUR = 3600;
const PRE_MATCH_WINDOW = 3 * 24 * HOUR;
const LIVE_REFRESH_MS = 30_000;
const IDLE_REFRESH_MS = 300_000;
const REACTION_SECONDS = 180;
const BUZZ_GAP_MS = 120; // a minute-by-minute line has far more points than a finger can feel
const CHART = { w: 340, h: 150, left: 34, right: 10, top: 16, bottom: 22 };

const clockTime = (t: number) => new Date(t * 1000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const percent = (p: number) => `${Math.round(p * 100)}%`;

function priceAt(points: PricePoint[], t: number) {
  return points.reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best), points[0]);
}

async function fetchPrices(token: string, from: number, bucket: number): Promise<PricePoint[]> {
  const response = await fetch(`/feed/prices/${token}?from=${from}&bucket=${bucket}`);
  if (!response.ok) throw new Error("История цены недоступна");
  return response.json();
}

/** The market's real price through the match, with goals marked where they happened: this is how it reacted. */
export function PriceLine({ match, detail }: { match: LiveMatch; detail?: MatchDetail }) {
  const { state: { calm } } = useGame();
  const token = match.options[0]?.tokenId;
  const kickoff = Math.floor(Date.parse(match.start) / 1000);
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const started = kickoff <= now;
  const from = started ? kickoff - HOUR : now - PRE_MATCH_WINDOW;
  const bucket = started ? 60 : HOUR;
  const live = detail?.state === "in";
  const { data, isPending, isError } = useQuery({
    queryKey: ["prices", token, from, bucket],
    queryFn: () => fetchPrices(token!, from, bucket),
    enabled: !!token,
    refetchInterval: live ? LIVE_REFRESH_MS : IDLE_REFRESH_MS,
    retry: 1,
  });
  const line = useRef<SVGPathElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const lastBuzz = useRef(0);
  const hasLine = (data?.length ?? 0) > 1;

  // Draws once when the chart appears. New points during a match just extend the line.
  useEffect(() => {
    const path = line.current;
    if (!path || !hasLine || calm) return;
    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    const controls = animate(length, 0, {
      duration: M.dur.crawl,
      ease: M.ease.smooth,
      onUpdate: (v) => {
        path.style.strokeDashoffset = String(v);
      },
      onComplete: () => {
        path.style.strokeDasharray = "";
        path.style.strokeDashoffset = "";
      },
    });
    return () => controls.stop();
  }, [hasLine, calm]);

  if (!token) return null;
  const title = `Шансы победы ${match.home.name} по рынку`;
  if (isPending) return <div className="pn-skeleton" style={{ height: 190 }} aria-busy="true" />;
  if (isError || !data || data.length < 2) {
    return (
      <section className="pn-panel pn-panel--flat">
        <b style={{ fontWeight: 600 }}>{title}</b>
        <p className="pn-small pn-muted">{isError ? "История цены сейчас недоступна." : "Истории цены пока нет."}</p>
      </section>
    );
  }

  const points = data;
  const first = points[0];
  const last = points[points.length - 1];
  const values = points.map((p) => p.p);
  const top = Math.min(1, Math.max(...values) + 0.03);
  const bottom = Math.max(0, Math.min(...values) - 0.03);
  const span = Math.max(0.02, top - bottom);
  const x = (t: number) => CHART.left + ((t - first.t) / Math.max(1, last.t - first.t)) * (CHART.w - CHART.left - CHART.right);
  const y = (p: number) => CHART.top + (1 - (p - bottom) / span) * (CHART.h - CHART.top - CHART.bottom);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.p).toFixed(1)}`).join(" ");
  const base = CHART.h - CHART.bottom;
  const ticks = [...new Set([bottom, (bottom + top) / 2, top])];
  const goals = (detail?.events ?? []).flatMap((e) => {
    const t = e.kind === "goal" && e.at ? Math.floor(Date.parse(e.at) / 1000) : NaN;
    return Number.isFinite(t) && t >= first.t && t <= last.t ? [{ ...e, t, point: priceAt(points, t) }] : [];
  });
  const reaction = goals.at(-1);
  const after = reaction && priceAt(points, reaction.t + REACTION_SECONDS);
  const before = reaction && priceAt(points, reaction.t - 60);

  function onPointer(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * CHART.w;
    const t = first.t + ((px - CHART.left) / (CHART.w - CHART.left - CHART.right)) * (last.t - first.t);
    const next = priceAt(points, t).t;
    if (e.pointerType === "touch" && next !== hover && Date.now() - lastBuzz.current > BUZZ_GAP_MS) {
      lastBuzz.current = Date.now();
      haptic("light");
    }
    setHover(next);
  }
  const hovered = hover === null ? null : points.find((p) => p.t === hover) ?? null;

  return (
    <section className="pn-panel pn-panel--flat">
      <div className="pn-row" style={{ gap: 10, alignItems: "baseline" }}>
        <b style={{ fontWeight: 600 }}>{title}</b>
        <span className="pn-num" style={{ fontSize: 20, flex: "none" }}>{percent(last.p)}</span>
      </div>
      <div className="pn-chart">
        {hovered && (
          <div className="pn-chart__tip pn-num" style={{ left: `${(x(hovered.t) / CHART.w) * 100}%` }}>{clockTime(hovered.t)} · {percent(hovered.p)}</div>
        )}
        <svg
          viewBox={`0 0 ${CHART.w} ${CHART.h}`}
          role="img"
          aria-label={`${title}: от ${percent(first.p)} до ${percent(last.p)}${reaction && before && after ? `. Гол на ${reaction.minute}: с ${percent(before.p)} до ${percent(after.p)}` : ""}`}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={CHART.left} x2={CHART.w - CHART.right} y1={y(t)} y2={y(t)} stroke="var(--line)" />
              <text x={CHART.left - 5} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--tx2)">{percent(t)}</text>
            </g>
          ))}
          {started && kickoff >= first.t && (
            <line x1={x(kickoff)} x2={x(kickoff)} y1={CHART.top} y2={base} stroke="var(--line-2)" strokeDasharray="3 3" />
          )}
          {goals.map((g) => <line key={`l${g.t}`} x1={x(g.t)} x2={x(g.t)} y1={CHART.top} y2={base} stroke="var(--line-2)" />)}
          <path ref={line} d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {goals.map((g, i) => (
            <motion.g key={g.t} style={{ transformBox: "fill-box", transformOrigin: "center" }} initial={{ scale: calm ? 1 : 0 }} animate={{ scale: 1 }} transition={{ ...M.spring.bouncy, delay: calm ? 0 : M.dur.crawl * 0.8 + i * 0.08 }}>
              <circle cx={x(g.t)} cy={y(g.point.p)} r="4.5" fill="var(--tx)" stroke="var(--s1)" strokeWidth="2" />
            </motion.g>
          ))}
          {hovered && <line x1={x(hovered.t)} x2={x(hovered.t)} y1={CHART.top} y2={base} stroke="var(--tx2)" />}
          {hovered && <circle cx={x(hovered.t)} cy={y(hovered.p)} r="4" fill="var(--accent)" stroke="var(--s1)" strokeWidth="2" />}
          <text x={CHART.left} y={CHART.h - 5} fontSize="10" fill="var(--tx2)">{clockTime(first.t)}</text>
          <text x={CHART.w - CHART.right} y={CHART.h - 5} textAnchor="end" fontSize="10" fill="var(--tx2)">{clockTime(last.t)}</text>
        </svg>
      </div>
      {reaction && before && after && (
        <p className="pn-small pn-muted">Гол на {reaction.minute}: рынок изменил шансы с {percent(before.p)} до {percent(after.p)}.</p>
      )}
    </section>
  );
}
