"use client";

import { animate, AnimatePresence, motion, MotionConfig, useAnimationControls, useMotionValue, useTransform, type MotionValue } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, Radio, Settings, ShieldAlert, Ticket, Wallet } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Ball } from "@/ui/football";
import { M } from "@/ui/motion";
import { Odometer } from "@/ui/numbers";
import { Onboarding } from "@/features/onboarding/onboarding";
import { BankScreen } from "@/features/bank/bank-screen";
import { SettingsScreen } from "@/features/settings/settings-screen";
import { StatsScreen } from "@/features/stats/stats-screen";
import { BetsScreen } from "@/features/matches/bets-screen";
import { GoalAlerts } from "@/features/matches/goal-alerts";
import { LiveScreen } from "@/features/matches/live-screen";
import { Sheets } from "./sheets";
import { MatchDetailScreen } from "@/features/match/match-screen";
import { SettledMoments } from "@/features/moments/settled-moments";
import { GameProvider, TABS, useGame, type Tab, type ThemeChoice } from "@/store/app-store";
import { useBankroll, useOpenPicks, useWallet } from "@/hooks/use-shadowscout";
import { getWebApp, openLink } from "@/lib/telegram";

const ICONS: Record<Tab, typeof Ticket> = { bets: Ticket, live: Radio, bank: Wallet, stats: BarChart3, settings: Settings };
const LABELS: Record<Tab, string> = { bets: "Ставки", live: "Live", bank: "Банк", stats: "Статистика", settings: "Настройки" };

function AppBar() {
  const { state, dispatch } = useGame();
  const { data: bank } = useBankroll();
  const { data: wallet, isError: walletDown } = useWallet();
  const bump = useAnimationControls();
  // The real balance once a wallet is connected, otherwise the no-money bank.
  const realBalance = wallet?.connected ? wallet.total : undefined;
  const capital = wallet?.connected ? wallet.total ?? undefined : bank?.capital;
  const lastCapital = useRef(capital);
  useEffect(() => {
    if (lastCapital.current === capital) return;
    if (lastCapital.current !== undefined) void bump.start({ scale: [1, 1.14, 1], transition: { duration: M.dur.slow } });
    lastCapital.current = capital;
  }, [capital, bump]);
  // The red card plays once, on the moment the bank's protection actually trips.
  const stopped = bank?.stopped;
  const wasStopped = useRef(stopped);
  useEffect(() => {
    if (stopped && wasStopped.current === false) dispatch({ type: "STOP_SHOW" });
    wasStopped.current = stopped;
  }, [stopped, dispatch]);
  return (
    <header className="pn-appbar">
      <h1>{LABELS[state.tab]}</h1>
      <span className="pn-demo">Без денег</span>
      <motion.button className="pn-bankpill" animate={bump} aria-label="Открыть банк" onClick={() => dispatch({ type: "TAB", tab: "bank" })}>
        <Wallet size={15} color="var(--tx2)" aria-hidden="true" />
        {capital !== undefined ? <Odometer value={Math.round(capital)} /> : <span className="pn-small">{walletDown || (wallet?.connected && realBalance === null) ? "нет данных" : "Задать"}</span>}
      </motion.button>
    </header>
  );
}

function Dock() {
  const { state, dispatch } = useGame();
  const index = TABS.indexOf(state.tab);
  const liveCount = useOpenPicks().data?.length ?? 0;
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
            {tab === "live" && liveCount > 0 && (
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

/** One match screen for the whole app, so Telegram's Back button can reach it from any tab. */
function MatchLayer() {
  const { state, dispatch } = useGame();
  const opened = state.openMatch;
  return (
    <AnimatePresence>
      {opened && (
        <MatchDetailScreen key={opened.match.id} match={opened.match} morph={opened.morph} onClose={() => dispatch({ type: "CLOSE_MATCH" })} onBet={() => openLink(opened.match.url)} />
      )}
    </AnimatePresence>
  );
}

function Toasts() {
  const { state } = useGame();
  const toast = state.toasts[0];
  return (
    <div className="pn-toasts" aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div key={toast.id} className="pn-toast" initial={{ y: 26, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 14, opacity: 0 }} transition={M.spring.snappy}>
            <span>{toast.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const PULL_REFRESH = 70;
const PULL_MAX = 110;
const SWIPE_MIN = 70;
const SWIPE_MAX = 70;
const NO_GESTURE = ".pn-chips, .pn-keepy, .pn-chart, input, select";

/** Pull down to refresh and swipe between tabs. Mouse too, so it works on desktop. */
function useGestures(scroller: RefObject<HTMLDivElement | null>, pull: MotionValue<number>, swipe: MotionValue<number>) {
  const { state, dispatch } = useGame();
  const { tab } = state;
  const qc = useQueryClient();

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
      if (pull.get() >= PULL_REFRESH) {
        void qc.invalidateQueries();
      }
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
  }, [scroller, pull, swipe, tab, dispatch, qc]);
}

/** The ball rolls down with the pull. */
function PullBall({ pull }: { pull: MotionValue<number> }) {
  const rotate = useTransform(pull, [0, PULL_MAX], [0, 540]);
  const opacity = useTransform(pull, [0, 24], [0, 1]);
  return (
    <motion.div className="pn-pull" style={{ y: pull, rotate, opacity, top: -28 }} aria-hidden="true">
      <Ball size={24} />
    </motion.div>
  );
}

/** A price or a sum flies to where it now belongs, so it's obvious where it went. */
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
          onAnimationComplete={() => dispatch({ type: "FLYER_DONE" })}
        >
          {flyer.label}
        </motion.div>
      )}
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
  const canGoBack = !!state.openMatch || !!state.sheet || state.tab !== "bets";

  useEffect(() => {
    if (!hasBack) return;
    const back = tg!.BackButton!;
    // Sheets close themselves on Escape, top one first: Back takes the same way out.
    const onBack = () => document.querySelector(".pn-sheet") ? window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })) : dispatch(state.openMatch ? { type: "CLOSE_MATCH" } : state.sheet ? { type: "SHEET", sheet: null } : { type: "TAB", tab: "bets" });
    if (canGoBack) back.show();
    else back.hide();
    back.onClick(onBack);
    return () => back.offClick(onBack);
  }, [hasBack, tg, canGoBack, state.openMatch, state.sheet, dispatch]);

  useEffect(() => {
    if (!real || !tg?.isVersionAtLeast?.("6.1")) return;
    const color = theme === "dark" ? "#0b0f0d" : "#f4f6f4";
    tg.setHeaderColor(color);
    tg.setBackgroundColor(color);
  }, [real, tg, theme]);

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
          <div className="pn-scrollwrap">
            <PullBall pull={pull} />
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
          </div>
          <Dock />
          <Toasts />
          <GoalAlerts />
          <SettledMoments />
          <MatchLayer />
          <Sheets />
          <StopOverlay />
          <AnimatePresence>{!state.onboarded && <Onboarding key="onboarding" />}</AnimatePresence>
        </div>
        <Flyer />
      </div>
    </MotionConfig>
  );
}

export function AppShell() {
  return (
    <GameProvider>
      <Shell />
    </GameProvider>
  );
}
