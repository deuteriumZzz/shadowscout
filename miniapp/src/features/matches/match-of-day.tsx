"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll, useTransform } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { forecastHint } from "@/features/forecast/forecast";
import { useForecasts } from "@/hooks/use-shadowscout";
import type { LiveMatch } from "@/lib/feeds/polymarket";
import { useGame } from "@/store/app-store";
import { ClubTints, LeagueLogo, teamNameSize } from "@/ui/football";
import { M } from "@/ui/motion";

const MINI_AFTER = 130;

const pad = (n: number) => String(n).padStart(2, "0");

function untilKickoff(ms: number) {
  if (ms <= 0) return "Скоро начало";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return days ? `${days} д ${pad(hours)}:${pad(minutes)}` : `${pad(hours)}:${pad(minutes)}:${pad(total % 60)}`;
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** The day's biggest match as a poster: both clubs' colours, crests, a live countdown. */
export function MatchOfDay({ match, tag = "Матч дня" }: { match: LiveMatch; tag?: string }) {
  const { dispatch } = useGame();
  const { data: forecasts } = useForecasts();
  const now = useNow();
  const poster = useRef<HTMLButtonElement>(null);
  const scroller = useRef<HTMLElement | null>(null);
  // Has to run before useScroll below, which reads this ref when it starts tracking.
  useLayoutEffect(() => {
    scroller.current = poster.current?.closest<HTMLElement>(".pn-scroll") ?? null;
  }, []);
  const { scrollY } = useScroll({ container: scroller });
  // Scrolling away, the poster recedes and a slim bar with the countdown takes over.
  const scale = useTransform(scrollY, [0, MINI_AFTER], [1, 0.93]);
  const opacity = useTransform(scrollY, [0, MINI_AFTER], [1, 0.25]);
  const [mini, setMini] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setMini(y > MINI_AFTER));

  const { home, away, espn } = match;
  const live = espn?.state === "in";
  const clock = untilKickoff(new Date(match.start).getTime() - now);
  const score = live ? `${espn.homeScore}:${espn.awayScore}` : null;
  const hint = forecastHint(forecasts, `${home.name} - ${away.name}`);
  const open = () => {
    const logo = (key: string) => poster.current?.querySelector<HTMLElement>(`[data-morph="${key}"]`) ?? undefined;
    dispatch({ type: "OPEN_MATCH", match, morph: { home: logo("home"), away: logo("away") } });
  };

  return (
    <>
      <div className="pn-mini-wrap">
        <AnimatePresence>
          {mini && (
            <motion.button
              className="pn-mini"
              initial={{ y: -48, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -48, opacity: 0 }}
              transition={M.spring.snappy}
              onClick={() => dispatch({ type: "OPEN_MATCH", match })}
              aria-label={`${tag}: ${home.name} против ${away.name}, ${score ? `счёт ${score}` : `до начала ${clock}`}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- remote logo from the data feed */}
              <img src={home.logo} alt="" width={22} height={22} style={{ objectFit: "contain" }} />
              {/* eslint-disable-next-line @next/next/no-img-element -- remote logo from the data feed */}
              <img src={away.logo} alt="" width={22} height={22} style={{ objectFit: "contain" }} />
              <span className="pn-small pn-mini__name">{home.name} — {away.name}</span>
              <span className="pn-num" style={{ marginLeft: "auto", fontSize: 16, whiteSpace: "nowrap" }}>{score ?? clock}</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <motion.button
        ref={poster}
        className="pn-motd"
        style={{ scale, opacity }}
        initial={{ y: 12 }}
        animate={{ y: 0 }}
        transition={M.spring.gentle}
        whileTap={{ scale: 0.985 }}
        onClick={open}
        aria-label={`${tag}: ${home.name} против ${away.name}, ${score ? `счёт ${score}` : `до начала ${clock}`}`}
      >
        <ClubTints home={home} away={away} />
        <span className="pn-motd__tag"><LeagueLogo league={match.league} size={14} /> {tag}</span>
        {[home, away].map((team, i) => (
          <span className="pn-motd__team" key={team.name} style={{ gridColumn: i ? 3 : 1, gridRow: 2, fontSize: teamNameSize(team.name) }}>
            <motion.img
              src={team.logo}
              alt=""
              width={60}
              height={60}
              style={{ objectFit: "contain" }}
              data-morph={i ? "away" : "home"}
              initial={{ x: i ? 30 : -30, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ ...M.spring.gentle, delay: 0.1 }}
            />
            {team.name}
          </span>
        ))}
        <span className="pn-motd__mid" style={{ gridColumn: 2, gridRow: 2 }}>
          {live ? (
            <>
              <span className="pn-board__min" style={{ color: "var(--live)" }}><i className="pn-live" aria-hidden="true" /> {espn.clock}</span>
              <span className="pn-motd__time" style={{ fontSize: 30 }}>{score}</span>
            </>
          ) : (
            <>
              <span className="pn-small">До начала</span>
              <span className="pn-motd__time">{clock}</span>
            </>
          )}
        </span>
        {match.options.length > 0 && (
          <span className="pn-motd__prices">
            {match.options.map((o) => (
              <span key={o.id}>{o.id.toUpperCase()} <b className="pn-num">{o.odds.toFixed(2)}</b></span>
            ))}
          </span>
        )}
        {hint && <span className="pn-small pn-motd__hint">{hint}</span>}
      </motion.button>
    </>
  );
}
