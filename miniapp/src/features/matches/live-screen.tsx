"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Minus, X } from "lucide-react";
import { useMemo } from "react";
import { WalletPositions } from "@/features/wallet/wallet";
import { useOpenPicks } from "@/hooks/use-shadowscout";
import type { LiveMatch } from "@/lib/feeds/polymarket";
import { betStatus } from "@/lib/bet-status";
import { pickName } from "@/lib/labels";
import type { Pick } from "@/lib/types";
import { useGame } from "@/store/app-store";
import { M } from "@/ui/motion";
import { MatchCard } from "./match-card";
import { useMatches } from "./use-matches";

const NEXT_SHOWN = 3;

const TONE_ICON = { good: Check, bad: X, level: Minus };

/** What the score means for this bet right now. A colour wipes across when it flips. */
function BetState({ pick, home, away }: { pick: Pick; home: number; away: number }) {
  const { state: { currency } } = useGame();
  const st = betStatus(pick, home, away);
  const Icon = TONE_ICON[st.tone];
  const payoff = st.tone === "good" && pick.stake && pick.odds ? Math.round(pick.stake * (pick.odds - 1)) : null;
  return (
    <>
      <AnimatePresence initial={false}>
        {st.tone !== "level" && (
          <motion.i key={st.tone} className="pn-bet__wipe" data-tone={st.tone} initial={{ scaleX: 0, opacity: 0.5 }} animate={{ scaleX: 1, opacity: 0 }} transition={{ duration: M.dur.slow, ease: M.ease.smooth }} aria-hidden="true" />
        )}
      </AnimatePresence>
      <motion.p key={st.label} className="pn-bet__state" data-tone={st.tone} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={M.spring.snappy}>
        <Icon size={14} aria-hidden="true" /> {st.label}
        <span className="pn-small pn-muted" style={{ fontWeight: 400 }}>{st.detail}</span>
      </motion.p>
      {st.goals && (
        <div className="pn-pips" aria-hidden="true">
          {Array.from({ length: st.goals.need }, (_, i) => <i key={i} data-on={i < st.goals.total} />)}
        </div>
      )}
      {payoff !== null && <p className="pn-small pn-muted">Если так и закончится: +{payoff.toLocaleString("ru-RU")} {currency}</p>}
    </>
  );
}

/** Accepted bets waiting for the whistle, with the score and how the bet stands once the match is on. */
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
            <div className="pn-row pn-bet" key={p.id} style={{ padding: "11px 0", borderTop: "1px solid var(--line)" }}>
              <div style={{ minWidth: 0 }}>
                <b style={{ fontWeight: 600 }}>{p.match.replace(" - ", " — ")}</b>
                <p className="pn-small pn-muted">{pickName(p.match, p.market, p.pick, p.line)}, кэф {p.odds?.toFixed(2)}, ставка {Math.round(p.stake ?? 0).toLocaleString("ru-RU")}</p>
                {live && <BetState pick={p} home={live.homeScore} away={live.awayScore} />}
              </div>
              {live ? <span className="pn-num" style={{ fontSize: 20, color: "var(--live)" }}>{live.homeScore}:{live.awayScore}</span> : <span className="pn-small pn-muted" style={{ flex: "none" }}>{p.commence_time ? new Date(p.commence_time).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The real "on right now" list for the Live tab. */
function LiveNow() {
  const { data, isPending } = useMatches();
  const matches = useMemo(() => data?.matches ?? [], [data]);
  const live = matches.filter((m) => m.espn?.state === "in");
  const upcoming = matches.filter((m) => m.espn?.state !== "in").slice(0, NEXT_SHOWN);
  if (isPending) return <div className="pn-skeleton" style={{ height: 90 }} aria-busy="true" />;
  return (
    <section className="pn-stack">
      <h2 className="pn-h2">Сейчас идут: {live.length}</h2>
      {live.length === 0 && <p className="pn-small pn-muted">Сейчас матчей нет.</p>}
      <AnimatePresence initial={false} mode="popLayout">
        {live.map((m, i) => <MatchCard key={m.id} match={m} index={i} />)}
      </AnimatePresence>
      <WalletPositions matches={matches} />
      <OpenPicks matches={matches} />
      {live.length === 0 && upcoming.length > 0 && (
        <>
          <h2 className="pn-h2">Ближайшие</h2>
          {upcoming.map((m, i) => <MatchCard key={m.id} match={m} index={i} />)}
        </>
      )}
    </section>
  );
}

export function LiveScreen() {
  return (
    <div className="pn-screen">
      <LiveNow />
    </div>
  );
}
