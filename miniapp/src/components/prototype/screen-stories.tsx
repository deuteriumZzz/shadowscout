"use client";

import { AnimatePresence, motion } from "framer-motion";
import { TrendingUp, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { WEEK } from "./engine";
import { Crest, M, Odometer } from "./fx";
import { useGame } from "./store";

const SLIDE_SECONDS = 4;
const money = (v: number) => Math.abs(v).toLocaleString("ru-RU");

const teamsOf = (match: string) => match.split(" — ");

function Duel({ match, amount }: { match: string; amount: number }) {
  const [home, away] = teamsOf(match);
  return (
    <div className="pn-story__duel">
      <Crest team={home} size={56} />
      <Crest team={away} size={56} />
      <p style={{ width: "100%", marginTop: 10 }}>{match}</p>
      <strong className="pn-story__big" style={{ color: amount >= 0 ? "var(--gold)" : "var(--bad)" }}>
        {amount >= 0 ? "+" : "−"}{money(amount)}
      </strong>
    </div>
  );
}

const SLIDES: { title: string; body: ReactNode }[] = [
  {
    title: "Ваша неделя",
    body: (
      <>
        <strong className="pn-story__big">{WEEK.bets}</strong>
        <p>ставок: {WEEK.won} зашло, {WEEK.lost} не зашло</p>
      </>
    ),
  },
  {
    title: "Итог в банке",
    body: (
      <>
        <span className="pn-story__big" style={{ color: WEEK.amount >= 0 ? "var(--gold)" : "var(--bad)", display: "inline-flex" }}>
          {WEEK.amount >= 0 ? "+" : "−"}<Odometer value={Math.abs(WEEK.amount)} />
        </span>
        <p>за семь дней</p>
      </>
    ),
  },
  {
    title: "Плюс к линии",
    body: (
      <>
        <TrendingUp size={38} color="var(--accent)" aria-hidden="true" />
        <strong className="pn-story__big">+{WEEK.clv}%</strong>
        <p>Вы брали кэфы лучше закрытия. На дистанции это важнее одного результата.</p>
      </>
    ),
  },
  { title: "Лучший матч", body: <Duel match={WEEK.best.match} amount={WEEK.best.amount} /> },
  { title: "Что не зашло", body: <Duel match={WEEK.worst.match} amount={WEEK.worst.amount} /> },
];

/** A short recap in the shape of stories. It includes the losses, or it would flatter. */
export function WeekStories() {
  const { dispatch } = useGame();
  const [index, setIndex] = useState(0);
  const close = () => dispatch({ type: "STORIES", show: false });
  const go = (delta: number) => {
    const next = index + delta;
    if (next >= SLIDES.length) close();
    else setIndex(Math.max(0, next));
  };
  const slide = SLIDES[index];

  return (
    <motion.div className="pn-story" role="dialog" aria-modal="true" aria-label="Итоги недели" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={M.spring.sheet}>
      <div className="pn-story__bars" aria-hidden="true">
        {SLIDES.map((s, i) => (
          <span key={s.title}>
            {i === index ? (
              <motion.i key={index} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: SLIDE_SECONDS, ease: "linear" }} onAnimationComplete={() => go(1)} />
            ) : (
              <i style={{ transform: `scaleX(${i < index ? 1 : 0})` }} />
            )}
          </span>
        ))}
      </div>
      <button className="pn-icon pn-story__close" aria-label="Закрыть" onClick={close}><X size={22} aria-hidden="true" /></button>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={index} className="pn-story__slide" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={{ duration: M.dur.fast, ease: M.ease.smooth }}>
          <h2 className="pn-story__title">{slide.title}</h2>
          {slide.body}
        </motion.div>
      </AnimatePresence>
      <button className="pn-story__zone" style={{ left: 0 }} aria-label="Назад" onClick={() => go(-1)} />
      <button className="pn-story__zone" style={{ right: 0 }} aria-label="Дальше" onClick={() => go(1)} />
    </motion.div>
  );
}
