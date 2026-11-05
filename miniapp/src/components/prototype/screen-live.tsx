"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Minus, Play, Share2, TrendingUp, Volume2, VolumeX, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  betStatus,
  clv,
  FINALE_FROM,
  FULL_TIME,
  LINEUPS,
  minuteLabel,
  payout,
  SCENARIOS,
  settle,
  shownLog,
  shownScore,
  standingEvents,
  statsAt,
  TEAM_COLOR,
  trackedBets,
  type EventType,
  type MatchEvent,
} from "./engine";
import { Ball, CardIcon, Confetti, Crest, M, Odometer, RollDigit, Segmented } from "./fx";
import { thud } from "./sound";
import { useGame } from "./store";
import { haptic } from "@/lib/telegram";

const money = (v: number) => Math.abs(Math.round(v)).toLocaleString("ru-RU");
const REACTIONS = ["⚽", "🔥", "📣", "😱"];

function Scorers({ log, side }: { log: MatchEvent[]; side: "home" | "away" }) {
  const goals = standingEvents(log).filter((e) => e.type === "goal" && e.side === side);
  return (
    <div className="pn-board__scorers">
      <AnimatePresence initial={false}>
        {goals.map((g) => (
          <motion.div key={g.minute} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={M.spring.snappy}>
            {g.player} {g.minute}&apos;
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** A crest that jumps each time its team's goal tally changes. */
function BoardCrest({ team, tally }: { team: string; tally: number }) {
  return (
    <motion.span key={tally} style={{ display: "grid" }} initial={tally ? { scale: 1.32, rotate: -7 } : false} animate={{ scale: 1, rotate: 0 }} transition={M.spring.bouncy}>
      <Crest team={team} size={54} />
    </motion.span>
  );
}

/** Minute line under the board: goals above or below it by side, cards too. */
function MatchStrip({ log, minute }: { log: MatchEvent[]; minute: number }) {
  const marks = standingEvents(log).filter((e) => e.type === "goal" || e.type === "yellow" || e.type === "red");
  return (
    <div className="pn-ms" role="img" aria-label={`Лента матча, ${Math.floor(minute)} минута, событий: ${marks.length}`}>
      <div className="pn-ms__track">
        <motion.span initial={false} animate={{ scaleX: Math.min(1, minute / FULL_TIME) }} transition={{ duration: 0.12, ease: "linear" }} />
        <i aria-hidden="true" />
      </div>
      <AnimatePresence initial={false}>
        {marks.map((e) => (
          <motion.span
            key={`${e.minute}${e.type}`}
            className="pn-ms__mark"
            data-side={e.side}
            style={{ left: `${(e.minute / FULL_TIME) * 100}%` }}
            initial={{ scale: 0, y: e.side === "home" ? -12 : 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={M.spring.bouncy}
          >
            {e.type === "goal" ? <Ball size={15} /> : <CardIcon red={e.type === "red"} />}
          </motion.span>
        ))}
      </AnimatePresence>
      <div className="pn-ms__labels pn-small pn-muted" aria-hidden="true">
        <span>0&apos;</span><span>45&apos;</span><span>90&apos;</span>
      </div>
    </div>
  );
}

function Scoreboard() {
  const { state } = useGame();
  const { sim } = state;
  // The board holds a new goal back until its panel leaves, so the change is seen.
  const score = shownScore(sim);
  const log = shownLog(sim);
  const scored = standingEvents(log).filter((e) => e.type === "goal");
  const last = scored.at(-1);
  return (
    <section className="pn-board" aria-label={`Счёт ${score.home}:${score.away}, ${Math.floor(sim.minute)} минута`}>
      {last && (
        <motion.i
          key={scored.length}
          className="pn-board__flash"
          style={{ background: TEAM_COLOR[last.side === "home" ? "Arsenal" : "Liverpool"] }}
          initial={{ opacity: 0.85 }}
          animate={{ opacity: 0 }}
          transition={{ duration: M.dur.crawl * 1.2, ease: M.ease.smooth }}
          aria-hidden="true"
        />
      )}
      <div className="pn-board__team">
        <BoardCrest team="Arsenal" tally={score.home} /> Arsenal
        <Scorers log={log} side="home" />
      </div>
      <div className="pn-board__mid">
        {/* The last ten minutes get louder: this is when a bet is won or lost. */}
        <span className="pn-board__min" data-finale={sim.status === "playing" && sim.minute >= FINALE_FROM}>
          {sim.status === "playing" && <i className="pn-live" aria-hidden="true" />}
          {sim.status === "ft" ? "Финал" : minuteLabel(sim.minute)}
        </span>
        <div className="pn-board__score">
          <RollDigit value={score.home} />
          <span aria-hidden="true">:</span>
          <RollDigit value={score.away} />
        </div>
      </div>
      <div className="pn-board__team">
        <BoardCrest team="Liverpool" tally={score.away} /> Liverpool
        <Scorers log={log} side="away" />
      </div>
      <MatchStrip log={log} minute={sim.minute} />
    </section>
  );
}

function Bets() {
  const { state } = useGame();
  const { sim } = state;
  const { bets, standIn } = trackedBets(state.bets);
  const finished = sim.status === "ft";
  const score = shownScore(sim);
  return (
    <section className="pn-stack">
      <div className="pn-row">
        <h2 className="pn-h2">{bets.length > 1 ? "Ваши ставки" : "Ваша ставка"}</h2>
        {standIn && <span className="pn-small pn-muted">Для примера</span>}
      </div>
      {bets.map((bet) => {
        const st = betStatus(bet, score.home, score.away, sim.minute, finished);
        const Icon = st.tone === "good" ? Check : st.tone === "bad" ? X : Minus;
        return (
          <motion.div key={bet.id} className="pn-bet" data-tone={st.tone} layout>
            {/* A colour wipe across the card whenever the status flips. */}
            {st.tone !== "level" && (
              <motion.i key={st.tone} className="pn-bet__wipe" data-tone={st.tone} initial={{ scaleX: 0, opacity: 0.7 }} animate={{ scaleX: 1, opacity: 0 }} transition={{ duration: M.dur.crawl, ease: M.ease.smooth }} aria-hidden="true" />
            )}
            <span className="pn-bet__icon">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={st.tone} initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={M.spring.bouncy} style={{ display: "grid" }}>
                  <Icon size={19} aria-hidden="true" />
                </motion.span>
              </AnimatePresence>
            </span>
            <div style={{ minWidth: 0 }}>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div key={st.label} className="pn-bet__label" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }} transition={M.spring.snappy}>
                  {st.label}
                </motion.div>
              </AnimatePresence>
              <div className="pn-small pn-muted">{bet.label} · {st.detail}</div>
              {st.goals && (
                <div className="pn-pips" aria-hidden="true">
                  {Array.from({ length: st.goals.need }, (_, i) => (
                    <i key={i} data-on={i < st.goals!.total} />
                  ))}
                </div>
              )}
            </div>
            <span style={{ textAlign: "right" }}>
              <span className="pn-num" style={{ display: "block", fontSize: 18 }}>{bet.odds.toFixed(2)}</span>
              <span className="pn-small pn-muted">{money(bet.stake)}</span>
            </span>
          </motion.div>
        );
      })}
    </section>
  );
}

/** Fan reactions: pure fun, sent nowhere, and only shown while the match is on. */
function Reactions() {
  const { state } = useGame();
  const [floats, setFloats] = useState<{ id: number; emoji: string; left: number }[]>([]);
  const nextId = useRef(0);

  function shout(emoji: string, index: number) {
    haptic("light");
    if (state.sound) thud();
    const id = nextId.current++;
    setFloats((f) => [...f.slice(-8), { id, emoji, left: 8 + index * 24 + Math.random() * 8 }]);
  }

  return (
    <div className="pn-react" aria-label="Реакции болельщика">
      {REACTIONS.map((emoji, i) => (
        <motion.button key={emoji} whileTap={{ scale: 0.82 }} onClick={() => shout(emoji, i)} aria-label={`Реакция ${emoji}`}>
          {emoji}
        </motion.button>
      ))}
      <AnimatePresence>
        {floats.map((f) => (
          <motion.span
            key={f.id}
            className="pn-float"
            style={{ left: `${f.left}%` }}
            initial={{ y: 0, opacity: 1, scale: 0.7 }}
            animate={{ y: -150, opacity: 0, scale: 1.5, rotate: f.id % 2 ? 16 : -16 }}
            transition={{ duration: 1.1, ease: M.ease.smooth }}
            onAnimationComplete={() => setFloats((all) => all.filter((x) => x.id !== f.id))}
            aria-hidden="true"
          >
            {f.emoji}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

const EVENT_LABEL: Record<EventType, string> = {
  goal: "Гол",
  var_cancel: "VAR отменил гол",
  yellow: "Жёлтая карточка",
  red: "Красная карточка",
  save: "Сейв",
  post: "Штанга",
};

function EventIcon({ type }: { type: EventType }) {
  if (type === "goal") return <Ball size={18} />;
  if (type === "yellow") return <CardIcon />;
  if (type === "red") return <CardIcon red />;
  if (type === "var_cancel") return <span style={{ fontSize: 10, fontWeight: 700, color: "#8fd6ff" }}>VAR</span>;
  return <span className="pn-muted" aria-hidden="true">●</span>;
}

function Timeline({ log }: { log: MatchEvent[] }) {
  if (!log.length) return <p className="pn-small pn-muted" style={{ padding: "8px 2px" }}>Событий пока нет, команды присматриваются друг к другу.</p>;
  return (
    <div className="pn-tl">
      <AnimatePresence initial={false}>
        {[...log].reverse().map((e) => (
          <motion.div key={`${e.minute}-${e.type}`} className="pn-tl__item" layout initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={M.spring.snappy}>
            <span className="pn-num pn-muted">{e.minute}&apos;</span>
            <span className="pn-tl__icon"><EventIcon type={e.type} /></span>
            <span>
              {EVENT_LABEL[e.type]}: {e.player}
              <small>{e.side === "home" ? "Arsenal" : "Liverpool"}</small>
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function MatchStats({ minute }: { minute: number }) {
  return (
    <div className="pn-panel pn-panel--flat">
      <div className="pn-row pn-small">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Crest team="Arsenal" size={20} /> Arsenal</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Liverpool <Crest team="Liverpool" size={20} /></span>
      </div>
      {statsAt(minute).map((s) => {
        const total = s.home + s.away || 1;
        return (
          <div className="pn-stat" key={s.label}>
            <div className="pn-row pn-small">
              <b className="pn-num" style={{ fontSize: 16 }}>{s.home}</b>
              <span className="pn-muted">{s.label}</span>
              <b className="pn-num" style={{ fontSize: 16 }}>{s.away}</b>
            </div>
            <div className="pn-stat__bars" aria-hidden="true">
              <div className="pn-stat__bar"><motion.span initial={false} animate={{ scaleX: s.home / total }} transition={M.spring.gentle} /></div>
              <div className="pn-stat__bar pn-stat__bar--away"><motion.span initial={false} animate={{ scaleX: s.away / total }} transition={M.spring.gentle} /></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Both line-ups on one pitch: home in the lower half attacking up, away mirrored. */
export function Lineups() {
  const place = (rows: string[][], flip: boolean) =>
    rows.flatMap((row, r) =>
      row.map((name, i) => {
        const y = 6 + r * 11.5;
        return { name, x: ((i + 1) / (row.length + 1)) * 100, y: flip ? 100 - y : y };
      }),
    );
  const away = place(LINEUPS.away, false);
  const home = place(LINEUPS.home, true);
  return (
    <div className="pn-stack">
      <div className="pn-row pn-small pn-muted">
        <span>Схема {LINEUPS.formation} у обеих команд</span>
      </div>
      <div className="pn-pitch" role="img" aria-label="Расстановка команд на поле">
        <svg viewBox="0 0 68 100" preserveAspectRatio="none" aria-hidden="true">
          <g fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="0.4">
            <rect x="2" y="2" width="64" height="96" />
            <line x1="2" y1="50" x2="66" y2="50" />
            <circle cx="34" cy="50" r="8" />
            <rect x="16" y="2" width="36" height="13" />
            <rect x="16" y="85" width="36" height="13" />
          </g>
        </svg>
        {[...away.map((p) => ({ ...p, color: "#0b7d74" })), ...home.map((p) => ({ ...p, color: "#b4121b" }))].map((p, i) => (
          <motion.div
            key={`${p.name}${i}`}
            className="pn-player"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ ...M.spring.bouncy, delay: i * 0.025 }}
          >
            <i style={{ background: p.color }} />
            {p.name}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function Result() {
  const { state, dispatch } = useGame();
  const { sim } = state;
  const { bets } = trackedBets(state.bets);
  const rows = bets.map((bet) => {
    const result = settle(bet, sim.home, sim.away);
    return { bet, result, amount: payout(bet, result), clv: clv(bet) };
  });
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const anyLoss = rows.some((r) => r.result === "loss");
  const best = rows.reduce((a, b) => (b.clv > a.clv ? b : a), rows[0]);
  const colors = useMemo(() => ["#22c55e", "#f7c948", "#ffffff"], []);
  const sum = useRef<HTMLParagraphElement>(null);
  const flying = state.flyer?.kind === "money";

  function confirm() {
    const from = sum.current?.getBoundingClientRect();
    const to = document.querySelector(".pn-bankpill")?.getBoundingClientRect();
    if (state.calm || !from || !to) {
      dispatch({ type: "CONFIRM" });
      return;
    }
    dispatch({
      type: "FLY_MONEY",
      amount: total,
      from: { x: from.left + 40, y: from.top + from.height / 2 },
      to: { x: to.left + to.width / 2, y: to.top + to.height / 2 },
    });
  }

  return (
    <motion.section className="pn-panel pn-panel--flat" style={{ gap: 12 }} initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={M.spring.gentle}>
      <p className="pn-small pn-muted">{total >= 0 ? "Матч в плюс" : "Этот матч в минус"}</p>
      <motion.p ref={sum} className="pn-result__sum" style={{ color: total >= 0 ? "var(--gold)" : "var(--bad)", visibility: flying ? "hidden" : undefined }} initial={{ scale: 1.35 }} animate={{ scale: 1 }} transition={M.spring.bouncy}>
        <span style={{ display: "inline-flex" }}>{total >= 0 ? "+" : "−"}<Odometer value={Math.abs(total)} /></span> {state.prefs.currency}
      </motion.p>

      {rows.map((r) => (
        <div className="pn-row pn-small" key={r.bet.id}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {r.result === "win" ? <Check size={15} color="var(--good)" aria-hidden="true" /> : <X size={15} color="var(--bad)" aria-hidden="true" />}
            {r.bet.label}: {r.result === "win" ? "зашла" : "не зашла"}
          </span>
          <span className="pn-num" style={{ fontSize: 15 }}>{r.amount >= 0 ? "+" : "−"}{money(r.amount)}</span>
        </div>
      ))}

      {best.clv > 0 && (
        <div className="pn-clv">
          <TrendingUp size={18} color="var(--accent)" style={{ flex: "none", marginTop: 2 }} aria-hidden="true" />
          <span>
            {anyLoss && "Матч не зашёл, но решение было сильным. "}
            Вы взяли {best.bet.odds.toFixed(2)} при закрытии {best.bet.closing.toFixed(2)}: это {(best.clv * 100).toFixed(1)}% к линии.
          </span>
        </div>
      )}

      <p className="pn-small pn-muted">Банк изменится только после вашего подтверждения.</p>
      <motion.button className="pn-btn pn-btn--primary" whileTap={{ scale: M.press }} disabled={flying} onClick={confirm}>
        <Check size={18} aria-hidden="true" /> Подтвердить исход
      </motion.button>
      <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "SIM_RESET" })}>
        Отменить, банк не трогать
      </motion.button>
      <motion.button
        className="pn-btn pn-btn--text"
        whileTap={{ scale: M.press }}
        onClick={async () => {
          const lines = rows.map((r) => `${r.bet.label}: ${r.result === "win" ? "зашла" : "не зашла"}`);
          const outcome = await shareResult(lines, total, `${sim.home}:${sim.away}`);
          if (outcome === "saved") dispatch({ type: "TOAST", text: "Картинка сохранена" });
          if (outcome === "error") dispatch({ type: "TOAST", text: "Не удалось создать картинку" });
        }}
      >
        <Share2 size={15} aria-hidden="true" /> Поделиться результатом
      </motion.button>

      {/* Salute on a win only: the moment the fun belongs to. */}
      {total > 0 && !state.calm && !sim.moment && <Confetti colors={colors} count={120} />}
    </motion.section>
  );
}

/** A plain text card: crests aren't drawn because a cross-origin image would block canvas export. */
async function shareResult(lines: string[], total: number, score: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  const c = canvas.getContext("2d");
  if (!c) return "error";
  c.fillStyle = "#0b0f0d";
  c.fillRect(0, 0, 1080, 1080);
  c.fillStyle = "#a9b6af";
  c.font = "500 40px sans-serif";
  c.fillText("shadowscout", 80, 120);
  c.fillStyle = "#f3f6f4";
  c.font = "700 76px sans-serif";
  c.fillText(`Arsenal ${score} Liverpool`, 80, 300);
  c.font = "500 44px sans-serif";
  lines.forEach((line, i) => c.fillText(line, 80, 420 + i * 70));
  c.fillStyle = total >= 0 ? "#f7c948" : "#fb8585";
  c.font = "700 140px sans-serif";
  c.fillText(`${total >= 0 ? "+" : "−"}${money(total)}`, 80, 900);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return "error";
  const file = new File([blob], "shadowscout-result.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (e) {
      // The user closing the share sheet isn't a failure; a WebView refusing files is, so save instead.
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  return "saved";
}

function MatchControls() {
  const { state, dispatch } = useGame();
  return (
    <div className="pn-row">
      <div style={{ width: 110 }}>
        <Segmented<"1" | "2">
          label="Скорость демо-матча"
          value={String(state.sim.speed) as "1" | "2"}
          onChange={(v) => dispatch({ type: "SIM_SPEED", speed: v === "2" ? 2 : 1 })}
          options={[{ id: "1", label: "×1" }, { id: "2", label: "×2" }]}
        />
      </div>
      <button className="pn-icon" aria-label={state.sound ? "Выключить звук" : "Включить звук"} aria-pressed={state.sound} onClick={() => dispatch({ type: "SET_SOUND", on: !state.sound })}>
        {state.sound ? <Volume2 size={20} aria-hidden="true" /> : <VolumeX size={20} color="var(--tx2)" aria-hidden="true" />}
      </button>
    </div>
  );
}

function Idle() {
  const { state, dispatch } = useGame();
  const others = state.bets.filter((b) => b.home !== "Arsenal");
  const mine = state.bets.filter((b) => b.home === "Arsenal");
  return (
    <>
      {state.bets.length > 0 ? (
        <section className="pn-stack">
          <h2 className="pn-h2">Мои ставки: {state.bets.length}</h2>
          {[...mine, ...others].map((b) => (
            <motion.div key={b.id} className="pn-bet" layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={M.spring.snappy}>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <Crest team={b.home} size={22} />
                <Crest team={b.away} size={22} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="pn-bet__label">{b.label}</div>
                <div className="pn-small pn-muted">{b.home} — {b.away} · ждёт начала</div>
              </div>
              <span style={{ textAlign: "right" }}>
                <span className="pn-num" style={{ display: "block", fontSize: 18 }}>{b.odds.toFixed(2)}</span>
                <span className="pn-small pn-muted">{money(b.stake)}</span>
              </span>
            </motion.div>
          ))}
        </section>
      ) : (
        <section className="pn-panel pn-panel--flat">
          <h2 className="pn-h2">Сейчас ваших матчей нет</h2>
          <p className="pn-small pn-muted">Когда начнётся матч с вашей ставкой, здесь будут счёт, голы и её статус.</p>
          <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "TAB", tab: "bets" })}>
            К прогнозам
          </motion.button>
        </section>
      )}

      <div className="pn-row" style={{ marginTop: 8 }}>
        <h2 className="pn-h2">Посмотреть демо-матч</h2>
        <div style={{ width: 110 }}>
          <Segmented<"1" | "2">
            label="Скорость демо-матча"
            value={String(state.sim.speed) as "1" | "2"}
            onChange={(v) => dispatch({ type: "SIM_SPEED", speed: v === "2" ? 2 : 1 })}
            options={[{ id: "1", label: "×1" }, { id: "2", label: "×2" }]}
          />
        </div>
      </div>
      <p className="pn-small pn-muted">90 минут примерно за минуту: так будет выглядеть настоящий матч.</p>
      {SCENARIOS.map((s, i) => (
        <motion.button
          key={s.id}
          className="pn-scn"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...M.spring.snappy, delay: i * 0.05 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => dispatch({ type: "SIM_START", scenarioId: s.id })}
        >
          <span className="pn-scn__play"><Play size={18} fill="currentColor" aria-hidden="true" /></span>
          <span>
            <b>{s.title}</b>
            <span className="pn-small pn-muted">{s.subtitle}</span>
          </span>
        </motion.button>
      ))}
    </>
  );
}

type View = "events" | "stats" | "lineups";

export function LiveScreen() {
  const { state } = useGame();
  const { sim } = state;
  const [view, setView] = useState<View>("events");

  if (sim.status === "idle") return <div className="pn-screen"><Idle /></div>;

  return (
    <div className="pn-screen">
      <Scoreboard />
      {sim.status === "ft" && !sim.moment ? <Result /> : null}
      <Bets />
      {sim.status === "playing" && <Reactions />}
      <Segmented<View>
        label="Раздел матча"
        value={view}
        onChange={setView}
        options={[{ id: "events", label: "События" }, { id: "stats", label: "Статистика" }, { id: "lineups", label: "Составы" }]}
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: M.dur.fast }}>
          {view === "events" && <Timeline log={shownLog(sim)} />}
          {view === "stats" && <MatchStats minute={sim.minute} />}
          {view === "lineups" && <Lineups />}
        </motion.div>
      </AnimatePresence>
      {sim.status === "playing" && <MatchControls />}
    </div>
  );
}
