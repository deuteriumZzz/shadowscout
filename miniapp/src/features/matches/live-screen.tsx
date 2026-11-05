"use client";

import { AnimatePresence } from "framer-motion";
import { useMemo } from "react";
import { WalletPositions } from "@/features/wallet/wallet";
import { useOpenPicks } from "@/hooks/use-shadowscout";
import type { LiveMatch } from "@/lib/feeds/polymarket";
import { pickName } from "@/lib/labels";
import { MatchCard } from "./match-card";
import { useMatches } from "./use-matches";

const NEXT_SHOWN = 3;

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
