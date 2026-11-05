"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { Ball } from "@/ui/football";
import { M } from "@/ui/motion";
import { pickName } from "@/lib/labels";
import { useGame } from "@/store/app-store";
import { useHistory } from "@/hooks/use-shadowscout";
import { haptic, hapticResult } from "@/lib/telegram";
import type { Pick } from "@/lib/types";

const SEEN_KEY = "pn-settled-seen";
const SHOWN_MS = 3400;
const MAX_REMEMBERED = 300;

function readSeen(): number[] | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? (JSON.parse(raw) as number[]) : null;
  } catch {
    return null;
  }
}

function writeSeen(ids: number[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-MAX_REMEMBERED)));
  } catch {
    // Private mode: finals may replay next time, nothing worse.
  }
}

function profitOf(p: Pick) {
  if (p.result === "win") return (p.stake ?? 0) * ((p.odds ?? 1) - 1);
  return p.result === "loss" ? -(p.stake ?? 0) : 0;
}

const VERDICT = { win: "зашла", loss: "не зашла", push: "возврат" } as const;
const MAX_IN_A_ROW = 2;

interface Moment {
  id: string;
  title: string;
  line: string;
  sub: string;
  value: number;
  tone: "win" | "other";
}

const singleOf = (p: Pick): Moment => ({
  id: String(p.id),
  title: `Финал${p.final_score ? ` ${p.final_score.replace("-", ":")}` : ""}`,
  line: p.match.replace(" - ", " — "),
  sub: `${pickName(p.match, p.market, p.pick, p.line)}: ${p.result ? VERDICT[p.result] : ""}`,
  value: profitOf(p),
  tone: p.result === "win" ? "win" : "other",
});

function summaryOf(picks: Pick[]): Moment {
  const wins = picks.filter((p) => p.result === "win").length;
  const value = picks.reduce((sum, p) => sum + profitOf(p), 0);
  return {
    id: picks.map((p) => p.id).join("-"),
    title: "Финалы",
    line: `Закончилось матчей со ставками: ${picks.length}`,
    sub: `Зашло ${wins} из ${picks.length}`,
    value,
    tone: value > 0 ? "win" : "other",
  };
}

/** The final whistle on a no-money bet, once per bet, then the sum lands on the Bank tab. Also catches what settled while the app was closed. */
export function SettledMoments() {
  const { state, dispatch } = useGame();
  const { data: history } = useHistory();
  const qc = useQueryClient();
  const [queue, setQueue] = useState<Moment[]>([]);
  const amount = useRef<HTMLDivElement>(null);
  const current = queue[0];

  useEffect(() => {
    if (!history) return;
    const settled = history.filter((h) => h.virtual && h.result);
    const seen = readSeen();
    // First run: what's already in the history isn't news.
    if (seen === null) {
      writeSeen(settled.map((h) => h.id));
      return;
    }
    const fresh = settled.filter((h) => !seen.includes(h.id)).sort((a, b) => a.id - b.id);
    if (!fresh.length) return;
    writeSeen([...seen, ...fresh.map((h) => h.id)]);
    // More than a couple at once would hold the screen hostage: they become one summary.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to new data from the server
    setQueue((q) => [...q, ...(fresh.length > MAX_IN_A_ROW ? [summaryOf(fresh)] : fresh.map(singleOf))]);
  }, [history]);

  const close = useCallback(() => {
    if (!current) return;
    const value = current.value;
    const from = amount.current?.getBoundingClientRect();
    const to = document.querySelector('[data-dock="bank"]')?.getBoundingClientRect();
    const refreshBank = () => void qc.invalidateQueries({ queryKey: ["bankroll"] });
    if (value !== 0 && from && to && !state.calm) {
      dispatch({
        type: "FLY",
        kind: "money",
        win: value > 0,
        label: `${value > 0 ? "+" : "−"}${Math.abs(Math.round(value)).toLocaleString("ru-RU")} ${state.currency}`,
        from: { x: from.left + from.width / 2, y: from.top + from.height / 2 },
        to: { x: to.left + to.width / 2, y: to.top + to.height / 2 },
      });
      // The number on the tab moves only once the sum has landed: the order is the whole effect.
      setTimeout(refreshBank, M.dur.slow * 1000);
    } else {
      refreshBank();
    }
    setQueue((q) => q.slice(1));
  }, [current, dispatch, qc, state.calm, state.currency]);

  const currentId = current?.id;
  const currentResult = current?.tone;
  useEffect(() => {
    if (currentId === undefined) return;
    if (currentResult === "win") hapticResult("success");
    else haptic("medium");
    const t = setTimeout(close, SHOWN_MS);
    return () => clearTimeout(t);
  }, [currentId, currentResult, close]);

  const value = current?.value ?? 0;
  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.id}
          className="pn-moment"
          role="status"
          style={{ zIndex: 30 }}
          initial={{ clipPath: "inset(0 100% 0 0)" }}
          animate={{ clipPath: "inset(0 0% 0 0)" }}
          exit={{ clipPath: "inset(0 0 0 100%)" }}
          transition={{ duration: M.dur.normal, ease: M.ease.smooth }}
          onClick={close}
        >
          <motion.div className="pn-moment__disc" initial={{ scale: 0.3, rotate: -24 }} animate={{ scale: 1, rotate: 0 }} transition={{ ...M.spring.bouncy, delay: 0.16 }}>
            <Ball size={44} />
          </motion.div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <motion.div className="pn-moment__big" style={{ fontSize: 30 }} initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ ...M.spring.snappy, delay: 0.2 }}>
              {current.title}
            </motion.div>
            <motion.div className="pn-moment__line" initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ ...M.spring.snappy, delay: 0.28 }}>
              {current.line}
            </motion.div>
            <motion.div className="pn-moment__sub" initial={{ opacity: 0 }} animate={{ opacity: 0.86 }} transition={{ delay: 0.42 }}>
              {current.sub}. Без денег, условный банк
            </motion.div>
            <motion.div
              ref={amount}
              className="pn-num"
              style={{ display: "inline-block", marginTop: 4, fontSize: 22, color: value > 0 ? "var(--gold)" : value < 0 ? "var(--bad)" : undefined }}
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ ...M.spring.snappy, delay: 0.5 }}
            >
              {value > 0 ? "+" : value < 0 ? "−" : ""}{Math.abs(Math.round(value)).toLocaleString("ru-RU")} {state.currency}
            </motion.div>
          </div>
          <motion.div className="pn-moment__bar" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: SHOWN_MS / 1000, ease: "linear" }} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
