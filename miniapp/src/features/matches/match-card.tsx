"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, ExternalLink, Star } from "lucide-react";
import { useRef, useState } from "react";
import { advisedOption, forecastHint } from "@/features/forecast/forecast";
import { useForecasts } from "@/hooks/use-shadowscout";
import { biggestMove, type LiveMatch, type LiveOption } from "@/lib/feeds/polymarket";
import { haptic, openLink } from "@/lib/telegram";
import { useGame } from "@/store/app-store";
import { FormPips, LeagueLogo } from "@/ui/football";
import { M } from "@/ui/motion";
import { RollDigit } from "@/ui/numbers";

const money = (v: number) => (v >= 1000 ? `$${Math.round(v / 1000)} тыс.` : `$${Math.round(v)}`);

/** A real crest from the feed. Remote and already sized, so a plain image is right. */
function TeamLogo({ src, alt, morph }: { src: string; alt: string; morph?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- remote logo from the data feed
  return <img className="pn-logo" src={src} alt={alt} width={28} height={28} loading="lazy" data-morph={morph} />;
}

function OddsTile({ option, advised }: { option: LiveOption; advised: boolean }) {
  // Only a change seen while watching flashes: the first load is not news.
  const shown = option.odds.toFixed(2);
  const [prev, setPrev] = useState(shown);
  const [move, setMove] = useState<{ up: boolean; n: number } | null>(null);
  if (shown !== prev) {
    setPrev(shown);
    setMove({ up: Number(shown) > Number(prev), n: (move?.n ?? 0) + 1 });
  }
  return (
    <div className="pn-tile pn-tile--static" data-rec={advised} title={option.title} aria-label={`${option.title}, кэф ${shown}${advised ? ", совет прогноза" : ""}`} role="group">
      {advised && <motion.span className="pn-tip" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={M.spring.bouncy}>Совет</motion.span>}
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

function FavouriteStar({ match }: { match: LiveMatch }) {
  const { state, dispatch } = useGame();
  const on = state.favorites.includes(match.home.name) || state.favorites.includes(match.away.name);
  const toggle = () => {
    haptic("light");
    // Either club of the match counts: remove whichever is there, or add the home side.
    const present = [match.home.name, match.away.name].filter((t) => state.favorites.includes(t));
    (present.length ? present : [match.home.name]).forEach((team) => dispatch({ type: "TOGGLE_FAVORITE", team }));
  };
  return (
    <motion.button className="pn-star" aria-pressed={on} aria-label={on ? `Убрать ${match.home.name} из избранного` : `Добавить ${match.home.name} в избранное`} whileTap={{ scale: 0.8 }} onClick={toggle}>
      <motion.span key={String(on)} style={{ display: "grid" }} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={M.spring.bouncy}>
        <Star size={16} fill={on ? "currentColor" : "none"} aria-hidden="true" />
      </motion.span>
    </motion.button>
  );
}

export function MatchCard({ match, index }: { match: LiveMatch; index: number }) {
  const { dispatch } = useGame();
  const card = useRef<HTMLElement>(null);
  function open() {
    const logo = (key: string) => card.current?.querySelector<HTMLElement>(`[data-morph="${key}"]`) ?? undefined;
    dispatch({ type: "OPEN_MATCH", match, morph: { home: logo("home"), away: logo("away") } });
  }
  const time = new Date(match.start).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const espn = match.espn;
  const live = espn?.state === "in";
  const { data: forecasts } = useForecasts();
  const hint = forecastHint(forecasts, `${match.home.name} - ${match.away.name}`);
  const advised = advisedOption(forecasts, `${match.home.name} - ${match.away.name}`);
  const move = biggestMove(match.options);
  const moveText = move?.dayChange ? `${move.title} ${move.dayChange > 0 ? "▲" : "▼"} ${Math.round(Math.abs(move.dayChange) * 100)} п. за сутки` : null;
  return (
    <motion.article
      ref={card}
      className="pn-match"
      layout
      whileTap={{ scale: 0.985 }}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      // Its own quick transition: filtering shouldn't wait on the delay cards use to come in.
      exit={{ opacity: 0, scale: 0.97, transition: { duration: M.dur.fast / 2 } }}
      transition={{ ...M.spring.snappy, delay: Math.min(index, 6) * 0.04, layout: M.spring.snappy }}
    >
      {/* Stretched over the card, so the whole card opens the match without nesting buttons. */}
      <button className="pn-match__open" aria-label={`Открыть матч ${match.home.name} — ${match.away.name}`} onClick={open} />
      <div className="pn-match__head">
        <LeagueLogo league={match.league} />
        <span>{match.league}</span>
        <FavouriteStar match={match} />
        <span className="pn-match__when">
          {live ? (
            <span className="pn-board__min" style={{ color: "var(--live)" }}><i className="pn-live" aria-hidden="true" /> {espn.clock}</span>
          ) : (
            time
          )}
          <ChevronRight size={15} color="var(--tx2)" aria-hidden="true" />
        </span>
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
      {(match.options.length > 0 || hint) && (
        <section className="pn-market">
          {match.options.length > 0 && (
            <div className="pn-tiles">
              {match.options.map((o) => <OddsTile key={o.id} option={o} advised={o.id === advised} />)}
            </div>
          )}
          {hint && <p className="pn-small" style={{ color: "var(--accent)", fontWeight: 600 }}>{hint}</p>}
          {match.options.length > 0 && (
            <div className="pn-row">
              <div style={{ minWidth: 0 }}>
                {moveText && <p className="pn-small" style={{ color: move!.dayChange! > 0 ? "var(--good)" : "var(--bad)" }}>{moveText}</p>}
                <p className="pn-small pn-muted">Объём {money(match.volume)}</p>
              </div>
              <motion.button className="pn-icon pn-match__link" aria-label={`${match.home.name} — ${match.away.name} на Polymarket`} whileTap={{ scale: 0.85 }} onClick={() => openLink(match.url)}>
                <ExternalLink size={17} color="var(--tx2)" aria-hidden="true" />
              </motion.button>
            </div>
          )}
        </section>
      )}
    </motion.article>
  );
}
