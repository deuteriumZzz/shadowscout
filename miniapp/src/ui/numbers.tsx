"use client";

import { AnimatePresence, motion } from "framer-motion";
import { M } from "@/ui/motion";

/** A single digit that rolls when it changes: the score on the board. */
export function RollDigit({ value }: { value: number }) {
  return (
    <span className="pn-roll" role="text" aria-label={String(value)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          aria-hidden="true"
          initial={{ y: "-100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={M.spring.snappy}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Rolling number for money: each digit column slides, so a win visibly adds up. */
export function Odometer({ value, className }: { value: number; className?: string }) {
  const text = Math.round(Math.abs(value)).toLocaleString("ru-RU").replace(/\s/g, " ");
  const chars = [...(value < 0 ? `−${text}` : text)];
  return (
    <span className={`pn-odo ${className ?? ""}`} role="text" aria-label={chars.join("")}>
      {chars.map((ch, i) => {
        const key = chars.length - i;
        if (ch === " ") return <span key={key} className="pn-odo__gap" aria-hidden="true" />;
        if (!/\d/.test(ch)) return <span key={key} aria-hidden="true">{ch}</span>;
        return (
          <span key={key} className="pn-odo__col" aria-hidden="true">
            <motion.span className="pn-odo__strip" initial={{ y: "0%" }} animate={{ y: `${-Number(ch) * 10}%` }} transition={M.spring.roll}>
              {Array.from({ length: 10 }, (_, d) => (
                <span key={d}>{d}</span>
              ))}
            </motion.span>
          </span>
        );
      })}
    </span>
  );
}
