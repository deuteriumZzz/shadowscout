"use client";

import { animate, AnimatePresence, motion, MotionConfig, useAnimationControls, useMotionValue, useTransform, type MotionValue } from "framer-motion";
import { BarChart3, Radio, RefreshCw, Settings, ShieldAlert, Ticket, Wallet } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { goalMood, minuteLabel, trackedBets, type MatchEvent } from "./engine";
import { Ball, Crest, M, Odometer, ScrollCtx, useTeamColor } from "./fx";
import { thud } from "./sound";
import { Onboarding } from "./screen-connections";
import { BankScreen, SettingsScreen, StatsScreen } from "./screen-club";
import { LiveScreen } from "./screen-live";
import { BetsScreen, Sheets, SlipBar } from "./screen-matchday";
import { WeekStories } from "./screen-stories";
import { GameProvider, TABS, useGame, type Tab, type ThemeChoice } from "./store";
import { getWebApp } from "@/lib/telegram";

const ICONS: Record<Tab, typeof Ticket> = { bets: Ticket, live: Radio, bank: Wallet, stats: BarChart3, settings: Settings };
const LABELS: Record<Tab, string> = { bets: "Ставки", live: "Live", bank: "Банк", stats: "Статистика", settings: "Настройки" };

function AppBar() {
  const { state, dispatch } = useGame();
  const [turns, setTurns] = useState(0);
  const bump = useAnimationControls();
  const lastBudget = useRef(state.budget);
  useEffect(() => {
    if (lastBudget.current === state.budget) return;
    lastBudget.current = state.budget;
    void bump.start({ scale: [1, 1.14, 1], transition: { duration: M.dur.slow } });
  }, [state.budget, bump]);
  return (
    <header className="pn-appbar">
      <h1>{LABELS[state.tab]}</h1>
      <span className="pn-demo">Демо</span>
      {state.tab === "bets" && (
        <motion.button
          className="pn-icon"
          aria-label="Обновить прогнозы"
          animate={{ rotate: turns * 360 }}
          transition={M.spring.gentle}
          onClick={() => {
            setTurns((n) => n + 1);
            dispatch({ type: "REFRESH" });
          }}
        >
          <RefreshCw size={19} aria-hidden="true" />
        </motion.button>
      )}
      <motion.button className="pn-bankpill" animate={bump} aria-label="Открыть банк" onClick={() => dispatch({ type: "TAB", tab: "bank" })}>
        <Wallet size={15} color="var(--tx2)" aria-hidden="true" />
        {state.budget ? <Odometer value={state.budget} /> : <span className="pn-small">Задать</span>}
      </motion.button>
    </header>
  );
}

function LiveStrip() {
  const { state, dispatch } = useGame();
  const { sim, tab } = state;
  return (
    <AnimatePresence initial={false}>
      {sim.status !== "idle" && tab !== "live" && tab !== "bets" && (
        <motion.button
          className="pn-strip"
          initial={{ y: -38, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -38, opacity: 0 }}
          transition={M.spring.snappy}
          onClick={() => dispatch({ type: "TAB", tab: "live" })}
        >
          {sim.status === "playing" && <i className="pn-live" aria-hidden="true" />}
          <span>{sim.status === "ft" ? "Финал" : minuteLabel(sim.minute)}</span>
          <Crest team="Arsenal" size={20} />
          <b>{sim.home}:{sim.away}</b>
          <Crest team="Liverpool" size={20} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function Dock() {
  const { state, dispatch } = useGame();
  const index = TABS.indexOf(state.tab);
  const liveCount = state.bets.length;
  return (
    <nav className="pn-dock" aria-label="Разделы">
      {/* The one bit of fun in the chrome: a ball rolls to the active tab. */}
      <motion.div className="pn-dock__ball" initial={false} animate={{ x: `${index * 100}%` }} transition={M.spring.gentle}>
        <motion.div initial={false} animate={{ rotate: index * 360 }} transition={M.spring.gentle} style={{ display: "grid" }}>
          <Ball size={13} />
        </motion.div>
      </motion.div>
      {TABS.map((tab) => {
        const Icon = ICONS[tab];
        return (
          <button key={tab} data-dock={tab} className="pn-dock__btn" aria-current={state.tab === tab ? "page" : undefined} onClick={() => dispatch({ type: "TAB", tab })}>
            <motion.span whileTap={{ scale: 0.84 }} style={{ display: "grid" }}>
              <Icon size={22} strokeWidth={state.tab === tab ? 2.3 : 1.8} aria-hidden="true" />
            </motion.span>
            <span>{LABELS[tab]}</span>
            {tab === "live" && state.sim.status === "playing" && <i className="pn-dot" aria-hidden="true" />}
            {tab === "live" && state.sim.status !== "playing" && liveCount > 0 && (
              <motion.span key={liveCount} className="pn-badge" initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={M.spring.bouncy}>
                {liveCount}
              </motion.span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

/** Wipes in like a TV graphic: team colour for our goal, neutral for theirs. */
function GoalPanel({ event, mood, onSkip }: { event: MatchEvent; mood: "for" | "against"; onSkip: () => void }) {
  const { state } = useGame();
  const team = event.side === "home" ? "Arsenal" : "Liverpool";
  const good = mood === "for";
  const color = useTeamColor(team);
  return (
    <>
      <motion.div className="pn-moment-scrim" initial={{ opacity: 0 }} animate={{ opacity: good ? 1 : 0.6 }} exit={{ opacity: 0 }} onClick={onSkip} />
      <motion.div
        className="pn-moment"
        role="status"
        aria-label={`Гол, ${event.player}, ${event.minute} минута`}
        style={{ background: good ? color : undefined, color: good ? "#fff" : undefined }}
        initial={{ clipPath: "inset(0 100% 0 0)" }}
        animate={{ clipPath: "inset(0 0% 0 0)" }}
        exit={{ clipPath: "inset(0 0 0 100%)" }}
        transition={{ duration: M.dur.normal, ease: M.ease.smooth }}
        onClick={onSkip}
      >
        {/* A bright edge leads the wipe, like a broadcast graphic. Our goals only. */}
        {good && <motion.i className="pn-moment__sweep" initial={{ x: "-120%" }} animate={{ x: "120%" }} transition={{ duration: M.dur.slow, ease: M.ease.sharp }} aria-hidden="true" />}
        <motion.div className="pn-moment__disc" initial={{ scale: 0.3, rotate: -24 }} animate={{ scale: 1, rotate: 0 }} transition={{ ...M.spring.bouncy, delay: 0.16 }}>
          {good && <motion.i className="pn-moment__ring" initial={{ scale: 0.9, opacity: 0.8 }} animate={{ scale: 1.7, opacity: 0 }} transition={{ duration: M.dur.crawl, delay: 0.3, ease: M.ease.smooth }} aria-hidden="true" />}
          <Crest team={team} size={62} />
        </motion.div>
        <div style={{ minWidth: 0 }}>
          <motion.div className="pn-moment__big" initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ ...M.spring.snappy, delay: 0.2 }}>
            {good ? "Гол!" : "Гол"}
          </motion.div>
          <motion.div className="pn-moment__line" initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ ...M.spring.snappy, delay: 0.28 }}>
            {event.player}, {event.minute}&apos; · {state.sim.home}:{state.sim.away}
          </motion.div>
          <motion.div className="pn-moment__sub" initial={{ opacity: 0 }} animate={{ opacity: 0.86 }} transition={{ delay: 0.42 }}>
            {good ? "В пользу вашей ставки" : "Против вашей ставки, матч ещё идёт"}
          </motion.div>
        </div>
        <motion.div className="pn-moment__bar" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: 2.5, ease: "linear" }} />
      </motion.div>
    </>
  );
}

function VarPanel({ event, onSkip }: { event: MatchEvent; onSkip: () => void }) {
  return (
    <>
      <motion.div className="pn-moment-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onSkip} />
      <motion.div
        className="pn-moment"
        role="status"
        style={{ background: "#14344a", color: "#fff" }}
        initial={{ clipPath: "inset(0 100% 0 0)" }}
        animate={{ clipPath: "inset(0 0% 0 0)" }}
        exit={{ clipPath: "inset(0 0 0 100%)" }}
        transition={{ duration: M.dur.normal, ease: M.ease.smooth }}
        onClick={onSkip}
      >
        <motion.div className="pn-scan" initial={{ y: 0 }} animate={{ y: [0, 124, 0, 124] }} transition={{ duration: 1.5, ease: "linear" }} />
        <div style={{ position: "relative", minHeight: 76, flex: 1 }}>
          <motion.div style={{ position: "absolute" }} initial={{ opacity: 1 }} animate={{ opacity: [1, 1, 0] }} transition={{ duration: 1.5, times: [0, 0.85, 1] }}>
            <div className="pn-moment__big">VAR</div>
            <div className="pn-moment__line">Проверка гола: {event.player}</div>
          </motion.div>
          <motion.div style={{ position: "absolute" }} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ ...M.spring.snappy, delay: 1.5 }}>
            <div className="pn-moment__big">Гол отменён</div>
            <div className="pn-moment__line">{event.note}, счёт откатился</div>
          </motion.div>
        </div>
      </motion.div>
    </>
  );
}

function CardPanel({ event, onSkip }: { event: MatchEvent; onSkip: () => void }) {
  const red = event.type === "red";
  return (
    <motion.div
      className="pn-moment"
      role="status"
      style={{ perspective: 600, minHeight: 104 }}
      initial={{ clipPath: "inset(0 100% 0 0)" }}
      animate={{ clipPath: "inset(0 0% 0 0)" }}
      exit={{ clipPath: "inset(0 0 0 100%)" }}
      transition={{ duration: M.dur.normal, ease: M.ease.smooth }}
      onClick={onSkip}
    >
      <motion.div className="pn-moment-card" style={{ background: red ? "var(--live)" : "var(--warn)" }} initial={{ rotateY: 180, rotateZ: -14, y: 40 }} animate={{ rotateY: 0, rotateZ: 6, y: 0 }} transition={{ ...M.spring.gentle, delay: 0.1 }} />
      <div>
        <div className="pn-moment__line" style={{ fontSize: 20, marginTop: 0 }}>{red ? "Красная карточка" : "Жёлтая карточка"}</div>
        <div className="pn-moment__sub">{event.player}, {event.minute}&apos;, {event.side === "home" ? "Arsenal" : "Liverpool"}</div>
      </div>
    </motion.div>
  );
}

function Small({ icon, title, text }: { icon: React.ReactNode; title: string; text?: string }) {
  return (
    <motion.div className="pn-moment-small" role="status" initial={{ y: -80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -80, opacity: 0 }} transition={M.spring.snappy}>
      {icon}
      <div>
        <b>{title}</b>
        {text && <span className="pn-muted">{text}</span>}
      </div>
    </motion.div>
  );
}

function MomentLayer() {
  const { state, dispatch } = useGame();
  const m = state.sim.moment;
  const skip = () => dispatch({ type: "SIM_CLEAR" });

  let node: React.ReactNode = null;
  if (m) {
    if (m.type === "kickoff") node = <Small key="k" icon={<Ball size={24} />} title="Матч начался" text="Arsenal против Liverpool" />;
    else if (m.type === "whistle") node = <Small key="w" icon={<Ball size={24} />} title="Финальный свисток" text={`Итог ${state.sim.home}:${state.sim.away}`} />;
    else {
      const e = m as MatchEvent;
      const key = `${e.type}${e.minute}`;
      if (e.type === "goal") node = <GoalPanel key={key} event={e} mood={goalMood(trackedBets(state.bets).bets, e.side)} onSkip={skip} />;
      else if (e.type === "var_cancel") node = <VarPanel key={key} event={e} onSkip={skip} />;
      else if (e.type === "yellow" || e.type === "red") node = <CardPanel key={key} event={e} onSkip={skip} />;
      else node = <Small key={key} icon={<Ball size={24} />} title={e.note ?? "Момент"} text={`${e.player}, ${e.minute}'`} />;
    }
  }
  return <AnimatePresence>{node}</AnimatePresence>;
}

/** The red card stays: every football fan reads it instantly, and it means stop. */
function StopOverlay() {
  const { state, dispatch } = useGame();
  return (
    <AnimatePresence>
      {state.stopMoment && (
        <motion.div className="pn-stop" style={{ perspective: 800 }} role="alertdialog" aria-label="Ставки приостановлены" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="pn-stop__card" initial={{ rotateY: 240, y: 380, rotateZ: -20 }} animate={{ rotateY: 0, y: 0, rotateZ: 6 }} transition={M.spring.gentle} />
          <p style={{ fontSize: 24, fontWeight: 700 }}>Ставки приостановлены</p>
          <p className="pn-small pn-muted" style={{ maxWidth: 300, margin: "8px 0 20px" }}>
            Просадка дошла до стопа, новые ставки не предлагаются. Это сработала защита банка.
          </p>
          <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "STOP_ACK" })}>
            <ShieldAlert size={18} aria-hidden="true" /> Понятно
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Toasts() {
  const { state, dispatch } = useGame();
  const toast = state.toasts[0];
  return (
    <div className="pn-toasts" aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div key={toast.id} className="pn-toast" initial={{ y: 26, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 14, opacity: 0 }} transition={M.spring.snappy}>
            <span>{toast.text}</span>
            {toast.undoPickId !== undefined && (
              <button onClick={() => dispatch({ type: "UNDO_SKIP", pickId: toast.undoPickId! })}>Вернуть</button>
            )}
            {toast.undoBets && <button onClick={() => dispatch({ type: "UNDO_PLACE" })}>Отменить</button>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const COIN_SPREAD = [-46, 30, -14, 52, -30, 12];
const PULL_REFRESH = 70;
const PULL_MAX = 110;
const SWIPE_MIN = 70;
const SWIPE_MAX = 70;
const NO_GESTURE = ".pn-chips, .pn-keepy, .pn-chart, input, select";

/** Pull down to refresh and swipe between tabs. Mouse too, so it works on desktop. */
function useGestures(scroller: RefObject<HTMLDivElement | null>, pull: MotionValue<number>, swipe: MotionValue<number>) {
  const { state, dispatch } = useGame();
  const { tab } = state;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let start: { x: number; y: number; axis: "x" | "y" | null; canPull: boolean } | null = null;

    const begin = (x: number, y: number, target: EventTarget | null) => {
      if ((target as Element | null)?.closest?.(NO_GESTURE)) return;
      start = { x, y, axis: null, canPull: tab === "bets" && el.scrollTop <= 0 };
    };
    const move = (x: number, y: number, e: Event) => {
      if (!start) return;
      const dx = x - start.x;
      const dy = y - start.y;
      if (!start.axis && Math.hypot(dx, dy) > 10) start.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (start.axis === "y" && start.canPull && dy > 0) {
        if (e.cancelable) e.preventDefault();
        pull.set(Math.min(PULL_MAX, dy * 0.5));
      }
      // The screen follows the finger, resisting harder when there's no tab that way.
      if (start.axis === "x") {
        const hasNext = !!TABS[TABS.indexOf(tab) + (dx < 0 ? 1 : -1)];
        swipe.set(Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx * (hasNext ? 0.4 : 0.1))));
      }
    };
    const end = (x: number, y: number) => {
      if (!start) return;
      const dx = x - start.x;
      const dy = y - start.y;
      if (start.axis === "x" && Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 2) {
        const next = TABS[TABS.indexOf(tab) + (dx < 0 ? 1 : -1)];
        if (next) dispatch({ type: "TAB", tab: next });
      }
      if (pull.get() >= PULL_REFRESH) dispatch({ type: "REFRESH" });
      if (pull.get() > 0) animate(pull, 0, M.spring.snappy);
      if (swipe.get() !== 0) animate(swipe, 0, M.spring.snappy);
      start = null;
    };

    const onTouchStart = (e: TouchEvent) => begin(e.touches[0].clientX, e.touches[0].clientY, e.target);
    const onTouchMove = (e: TouchEvent) => move(e.touches[0].clientX, e.touches[0].clientY, e);
    const onTouchEnd = (e: TouchEvent) => end(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    const onMouseDown = (e: MouseEvent) => begin(e.clientX, e.clientY, e.target);
    const onMouseMove = (e: MouseEvent) => move(e.clientX, e.clientY, e);
    const onMouseUp = (e: MouseEvent) => end(e.clientX, e.clientY);

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [scroller, pull, swipe, tab, dispatch]);
}

/** The ball rolls down with the pull and keeps bouncing while new picks load. */
function PullBall({ pull }: { pull: MotionValue<number> }) {
  const { state } = useGame();
  const rotate = useTransform(pull, [0, PULL_MAX], [0, 540]);
  const opacity = useTransform(pull, [0, 24], [0, 1]);
  if (state.loading && state.tab === "bets") {
    return (
      <div className="pn-pull" style={{ top: 6 }} aria-hidden="true">
        <motion.div animate={{ y: [0, 16, 0], rotate: [0, 120, 240] }} transition={{ duration: M.dur.slow, repeat: Infinity, ease: "easeInOut" }}>
          <Ball size={24} />
        </motion.div>
      </div>
    );
  }
  return (
    <motion.div className="pn-pull" style={{ y: pull, rotate, opacity, top: -28 }} aria-hidden="true">
      <Ball size={24} />
    </motion.div>
  );
}

/** The chosen odds fly down into the slip, so it's obvious where the bet went. */
function Flyer() {
  const { state, dispatch } = useGame();
  const flyer = state.flyer;
  const money = flyer?.kind === "money";
  return (
    <AnimatePresence>
      {flyer && (
        <motion.div
          key={flyer.id}
          className="pn-num pn-flyer"
          data-money={money}
          data-win={flyer.win}
          initial={{ x: flyer.x - 28, y: flyer.y - 16, scale: money ? 1.2 : 1 }}
          // An arc rather than a straight line: it reads as something thrown, not slid.
          animate={{ x: flyer.tx - 28, y: [flyer.y - 16, Math.max(12, Math.min(flyer.y, flyer.ty) - 56), flyer.ty - 16], scale: 0.7 }}
          exit={{ opacity: 0 }}
          transition={{ duration: money ? M.dur.slow + 0.2 : M.dur.normal + 0.1, ease: M.ease.smooth }}
          onAnimationComplete={() => {
            if (state.sound) thud();
            dispatch({ type: "FLYER_DONE" });
          }}
        >
          {flyer.label}
        </motion.div>
      )}
      {/* A trail of coins on a win only: a loss just moves the number. */}
      {flyer?.win &&
        COIN_SPREAD.map((spread, i) => (
          <motion.i
            key={`${flyer.id}c${i}`}
            className="pn-coin"
            initial={{ x: flyer.x + spread, y: flyer.y, scale: 1 }}
            animate={{ x: flyer.tx, y: flyer.ty, scale: 0.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: M.dur.slow, ease: M.ease.smooth, delay: 0.04 + i * 0.05 }}
          />
        ))}
    </AnimatePresence>
  );
}

/** Follows the choice in settings; "auto" means Telegram's theme, or the OS outside it. */
function useResolvedTheme(choice: ThemeChoice) {
  const [auto, setAuto] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const tg = getWebApp();
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const inTelegram = !!tg?.initData;
    const sync = () => setAuto(inTelegram ? tg!.colorScheme : mql.matches ? "dark" : "light");
    sync();
    mql.addEventListener("change", sync);
    if (inTelegram) tg!.onEvent("themeChanged", sync);
    return () => {
      mql.removeEventListener("change", sync);
      if (inTelegram) tg!.offEvent("themeChanged", sync);
    };
  }, []);
  return choice === "auto" ? auto : choice;
}

type TelegramChrome = {
  initData: string;
  initDataUnsafe: { start_param?: string };
  isVersionAtLeast?: (v: string) => boolean;
  BackButton?: { show(): void; hide(): void; onClick(f: () => void): void; offClick(f: () => void): void };
  setHeaderColor(c: string): void;
  setBackgroundColor(c: string): void;
};

/** Telegram's own Back button closes a sheet or returns to the feed, plus deep links from the bot. */
function useTelegramChrome(theme: "light" | "dark") {
  const { state, dispatch } = useGame();
  const tg = getWebApp() as unknown as TelegramChrome | undefined;
  const real = !!tg?.initData;
  const hasBack = real && !!tg?.BackButton && !!tg?.isVersionAtLeast?.("6.1");
  const canGoBack = !!state.sheet || state.tab !== "bets";

  useEffect(() => {
    if (!hasBack) return;
    const back = tg!.BackButton!;
    const onBack = () => dispatch(state.sheet ? { type: "SHEET", sheet: null } : { type: "TAB", tab: "bets" });
    if (canGoBack) back.show();
    else back.hide();
    back.onClick(onBack);
    return () => back.offClick(onBack);
  }, [hasBack, tg, canGoBack, state.sheet, dispatch]);

  useEffect(() => {
    if (!real || !tg?.isVersionAtLeast?.("6.1")) return;
    const color = theme === "dark" ? "#0b0f0d" : "#f4f6f4";
    tg.setHeaderColor(color);
    tg.setBackgroundColor(color);
  }, [real, tg, theme]);

  // A bot message can link straight to a pick: t.me/<bot>/app?startapp=pick_1
  const startParam = real ? tg?.initDataUnsafe.start_param : undefined;
  useEffect(() => {
    const id = Number(startParam?.match(/^pick_(\d+)$/)?.[1]);
    if (id) dispatch({ type: "SHEET", sheet: { kind: "pick", pickId: id } });
  }, [startParam, dispatch]);
}

function Shell() {
  const { state } = useGame();
  const theme = useResolvedTheme(state.theme);
  useTelegramChrome(theme);
  const scroller = useRef<HTMLDivElement>(null);
  const d = state.tabDirection;
  const pull = useMotionValue(0);
  const swipe = useMotionValue(0);
  useGestures(scroller, pull, swipe);

  return (
    <MotionConfig reducedMotion={state.calm ? "always" : "user"}>
      <div className={`pn-stage ${state.calm ? "pn-calm" : ""}`} data-theme={theme}>
        <div className="pn-phone">
          <AppBar />
          <LiveStrip />
          <div className="pn-scrollwrap">
            <PullBall pull={pull} />
            <ScrollCtx.Provider value={scroller}>
          <div className="pn-scroll" ref={scroller}>
            <motion.div style={{ y: pull, x: swipe }}>
            <AnimatePresence mode="wait" initial={false} custom={d} onExitComplete={() => scroller.current?.scrollTo(0, 0)}>
              <motion.main
                key={state.tab}
                custom={d}
                variants={{
                  enter: (dir: number) => ({ x: 22 * dir, opacity: 0 }),
                  center: { x: 0, opacity: 1 },
                  exit: (dir: number) => ({ x: -22 * dir, opacity: 0 }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: M.dur.fast, ease: M.ease.smooth }}
              >
                {state.tab === "bets" && <BetsScreen />}
                {state.tab === "live" && <LiveScreen />}
                {state.tab === "bank" && <BankScreen />}
                {state.tab === "stats" && <StatsScreen />}
                {state.tab === "settings" && <SettingsScreen />}
              </motion.main>
            </AnimatePresence>
            </motion.div>
          </div>
            </ScrollCtx.Provider>
          </div>
          <SlipBar />
          <Dock />
          <MomentLayer />
          <Toasts />
          <Sheets />
          <StopOverlay />
          <AnimatePresence>{state.stories && <WeekStories key="stories" />}</AnimatePresence>
          <AnimatePresence>{!state.onboarded && <Onboarding key="onboarding" />}</AnimatePresence>
        </div>
        <Flyer />
      </div>
    </MotionConfig>
  );
}

export function GameApp() {
  return (
    <GameProvider>
      <Shell />
    </GameProvider>
  );
}

