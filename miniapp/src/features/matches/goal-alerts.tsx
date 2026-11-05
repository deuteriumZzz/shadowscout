"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useOpenPicks } from "@/hooks/use-shadowscout";
import type { MatchDetail } from "@/lib/feeds/espn";
import type { LiveMatch } from "@/lib/feeds/polymarket";
import { haptic } from "@/lib/telegram";
import { M } from "@/ui/motion";
import { useMatches } from "./use-matches";

const GOAL_MS = 2600;

interface Goal {
  key: string;
  team: LiveMatch["home"];
  line: string;
  scorer?: string;
  mood?: string;
}

/** A real goal, on any tab: the same broadcast wipe as designed. Mounted once, for the whole app. */
export function GoalAlerts() {
  const { data } = useMatches();
  const [goal, setGoal] = useState<Goal | null>(null);
  const seen = useRef(new Map<string, [number, number]>());
  const { data: openPicks } = useOpenPicks();
  useEffect(() => {
    for (const m of data?.matches ?? []) {
      if (m.espn?.state !== "in") continue;
      const { homeScore: h, awayScore: a } = m.espn;
      const before = seen.current.get(m.id);
      if (before && (h > before[0] || a > before[1])) {
        haptic("medium");
        const side = h > before[0] ? "home" : "away";
        const key = `${m.id}-${h}-${a}`;
        const bet = openPicks?.find((p) => p.match === `${m.home.name} - ${m.away.name}` && p.market === "h2h" && p.pick !== "draw");
         
        setGoal({ key, team: m[side], line: `${m.home.name} ${h}:${a} ${m.away.name}`, mood: bet ? (bet.pick === side ? "В пользу вашей ставки" : "Против вашей ставки") : undefined });
        // Who scored comes a moment later, and the panel is worth showing without waiting for it.
        void fetch(`/feed/match/${m.espn.id}?code=${encodeURIComponent(m.espn.code)}`)
          .then((r) => (r.ok ? (r.json() as Promise<MatchDetail>) : null))
          .then((detail) => {
            const last = detail?.events.filter((e) => e.kind === "goal" && e.side === side).at(-1);
            if (last) setGoal((g) => (g?.key === key ? { ...g, scorer: `${last.player}, ${last.minute}` } : g));
          })
          .catch(() => undefined);
      }
      seen.current.set(m.id, [h, a]);
    }
  }, [data, openPicks]);
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
            <motion.div className="pn-moment__line" initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ ...M.spring.snappy, delay: 0.28 }}>{goal.scorer ?? goal.line}</motion.div>
            <motion.div className="pn-moment__sub" initial={{ opacity: 0 }} animate={{ opacity: 0.86 }} transition={{ delay: 0.42 }}>{goal.scorer ? goal.line : ""}{goal.scorer && goal.mood ? ". " : ""}{goal.mood}</motion.div>
          </div>
          <motion.div className="pn-moment__bar" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: GOAL_MS / 1000, ease: "linear" }} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
