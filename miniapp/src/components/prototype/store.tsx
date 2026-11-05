"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import {
  betFrom,
  goalMood,
  IDLE_SIM,
  payout,
  settle,
  startSim,
  tickSim,
  trackedBets,
  type Bet,
  type DemoPick,
  type HelpTopic,
  type HistoryRow,
  type Moment,
  type Sim,
} from "./engine";
import type { LiveMatch } from "./polymarket";
import { roar, startAmbient, stopAmbient, thud, whistle } from "./sound";
import { haptic, hapticResult } from "@/lib/telegram";

export const TABS = ["bets", "live", "bank", "stats", "settings"] as const;
export type Tab = (typeof TABS)[number];

// 90 minutes in about a minute of screen time, at one tick every 100 ms.
const TICK_MS = 100;
const MINUTES_PER_TICK = 0.15;
const TOAST_MS = 2600;
const LOAD_MS = 650;

export interface SlipItem {
  pickId: number;
  optionId: string;
  stake: number;
}

export interface Toast {
  id: number;
  text: string;
  undoPickId?: number;
  undoBets?: { betId: string; pickId: number }[];
}

export interface Flyer {
  id: number;
  kind: "odds" | "money";
  label: string;
  win?: boolean;
  x: number;
  y: number;
  tx: number;
  ty: number;
}

/** Where a pick's crests and odds sit on screen, so the sheet can grow out of them. */
export type Morph = Partial<Record<"home" | "away" | "odds", HTMLElement>>;

export type SheetState =
  | { kind: "pick"; pickId: number; morph?: Morph }
  | { kind: "slip" }
  | { kind: "help"; topic: HelpTopic }
  | { kind: "bank" }
  | null;

export interface Prefs {
  goals: boolean;
  kickoff: boolean;
  newPicks: boolean;
  bookmaker: string;
  leagues: string[];
  currency: string;
}

export type ThemeChoice = "auto" | "light" | "dark";
export type FeedState = "ok" | "error" | "offline" | "nokey" | "stale";

const ONBOARDED_KEY = "pn-onboarded";

function readOnboarded() {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberOnboarded() {
  try {
    localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    // Private mode: the wizard simply shows again next time.
  }
}

export interface GameState {
  theme: ThemeChoice;
  favorites: string[];
  dailyLimit: number;
  lossToday: number;
  pausedUntil: number | null;
  feedState: FeedState;
  updatedAt: number;
  onboarded: boolean;
  stories: boolean;
  tab: Tab;
  tabDirection: 1 | -1;
  loading: boolean;
  picks: DemoPick[];
  slip: SlipItem[];
  bets: Bet[];
  budget: number;
  peak: number;
  history: HistoryRow[];
  reminders: number[];
  toasts: Toast[];
  nextId: number;
  sheet: SheetState;
  openMatch: { match: LiveMatch; morph?: Morph } | null;
  flyer: Flyer | null;
  sound: boolean;
  calm: boolean;
  stopped: boolean;
  stopMoment: boolean;
  prefs: Prefs;
  sim: Sim;
}

export type Action =
  | { type: "TAB"; tab: Tab }
  | { type: "REFRESH" }
  | { type: "LOADED"; at: number }
  | { type: "SET_THEME"; theme: ThemeChoice }
  | { type: "TOGGLE_FAVORITE"; team: string }
  | { type: "SET_LIMIT"; limit: number }
  | { type: "PAUSE"; until: number }
  | { type: "RESUME" }
  | { type: "SET_FEED"; state: FeedState }
  | { type: "ONBOARDING"; show: boolean }
  | { type: "STORIES"; show: boolean }
  | { type: "SLIP_TOGGLE"; pickId: number; optionId: string; from?: { x: number; y: number }; to?: { x: number; y: number } }
  | { type: "SLIP_STAKE"; pickId: number; stake: number }
  | { type: "SLIP_REMOVE"; pickId: number }
  | { type: "PLACE_SLIP"; from?: { x: number; y: number }; to?: { x: number; y: number } }
  | { type: "SKIP"; pickId: number }
  | { type: "UNDO_SKIP"; pickId: number }
  | { type: "UNDO_PLACE" }
  | { type: "SET_FRESH" }
  | { type: "REMIND"; pickId: number }
  | { type: "ODDS_MOVE" }
  | { type: "SHEET"; sheet: SheetState }
  | { type: "OPEN_MATCH"; match: LiveMatch; morph?: Morph }
  | { type: "CLOSE_MATCH" }
  | { type: "FLYER_DONE" }
  | { type: "SIM_START"; scenarioId: string }
  | { type: "SIM_TICK" }
  | { type: "SIM_CLEAR" }
  | { type: "SIM_SPEED"; speed: 1 | 2 }
  | { type: "SIM_RESET" }
  | { type: "CONFIRM" }
  | { type: "FLY_MONEY"; amount: number; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: "FLY"; kind: Flyer["kind"]; label: string; win?: boolean; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: "TOAST"; text: string }
  | { type: "TOAST_DONE" }
  | { type: "SET_BUDGET"; budget: number }
  | { type: "SET_SOUND"; on: boolean }
  | { type: "SET_CALM"; on: boolean }
  | { type: "SET_PREF"; prefs: Partial<Prefs> }
  | { type: "STOP_DEMO" }
  | { type: "STOP_ACK" }
  | { type: "STOP_LIFT" }
  | { type: "RESET" };

const PREFS_KEY = "pn-prefs";

type SavedPrefs = { theme?: ThemeChoice; calm?: boolean; currency?: string; favorites?: string[] };

function readSaved(): SavedPrefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as SavedPrefs;
  } catch {
    return {};
  }
}

function initial(calm: boolean): GameState {
  const saved = readSaved();
  return {
    theme: saved.theme ?? "auto",
    favorites: saved.favorites ?? [],
    dailyLimit: 3000,
    lossToday: 0,
    pausedUntil: null,
    feedState: "ok",
    updatedAt: Date.now(),
    onboarded: readOnboarded(),
    stories: false,
    tab: "bets",
    tabDirection: 1,
    loading: false,
    picks: [],
    slip: [],
    bets: [],
    budget: 0,
    peak: 0,
    history: [],
    reminders: [],
    toasts: [],
    nextId: 1,
    sheet: null,
    openMatch: null,
    flyer: null,
    sound: false,
    calm: saved.calm ?? calm,
    stopped: false,
    stopMoment: false,
    prefs: { goals: true, kickoff: true, newPicks: true, bookmaker: "fonbet", leagues: [], currency: saved.currency ?? "$" },
    sim: IDLE_SIM,
  };
}

/** Why new bets are off right now, if they are. One place, so every button agrees. */
export function blockReason(s: Pick<GameState, "stopped" | "pausedUntil" | "dailyLimit" | "lossToday">): string | null {
  if (s.stopped) return "Ставки приостановлены: просадка дошла до стопа";
  if (s.pausedUntil) return "Вы взяли паузу: ставки выключены на сутки";
  if (s.dailyLimit > 0 && s.lossToday >= s.dailyLimit) return "Дневной лимит потерь исчерпан: до завтра ставок нет";
  return null;
}

const toast = (s: GameState, text: string, undoPickId?: number): GameState => ({
  ...s,
  nextId: s.nextId + 1,
  toasts: [...s.toasts, { id: s.nextId, text, undoPickId }],
});

export function reducer(s: GameState, a: Action): GameState {
  switch (a.type) {
    case "TAB":
      return { ...s, tab: a.tab, tabDirection: TABS.indexOf(a.tab) >= TABS.indexOf(s.tab) ? 1 : -1 };
    case "REFRESH":
      return { ...s, loading: true, feedState: "ok" };
    case "LOADED":
      return { ...s, loading: false, updatedAt: a.at };
    case "SET_THEME":
      return { ...s, theme: a.theme };
    case "TOGGLE_FAVORITE":
      return { ...s, favorites: s.favorites.includes(a.team) ? s.favorites.filter((t) => t !== a.team) : [...s.favorites, a.team] };
    case "SET_LIMIT":
      return { ...s, dailyLimit: a.limit };
    case "PAUSE":
      return toast({ ...s, pausedUntil: a.until, slip: [] }, "Пауза на сутки включена");
    case "RESUME":
      return { ...s, pausedUntil: null };
    case "SET_FEED":
      return { ...s, feedState: a.state };
    case "ONBOARDING":
      return { ...s, onboarded: !a.show };
    case "STORIES":
      return { ...s, stories: a.show };
    case "SLIP_TOGGLE": {
      if (blockReason(s)) return s;
      const pick = s.picks.find((p) => p.id === a.pickId);
      if (pick?.status !== "pending") return s;
      const existing = s.slip.find((i) => i.pickId === a.pickId);
      if (existing?.optionId === a.optionId) return { ...s, slip: s.slip.filter((i) => i.pickId !== a.pickId) };
      const item: SlipItem = { pickId: a.pickId, optionId: a.optionId, stake: existing?.stake ?? pick.stake };
      return {
        ...s,
        slip: existing ? s.slip.map((i) => (i.pickId === a.pickId ? item : i)) : [...s.slip, item],
        nextId: s.nextId + 1,
        flyer: !existing && a.from && a.to
          ? { id: s.nextId, kind: "odds", label: pick.options.find((o) => o.id === a.optionId)!.odds.toFixed(2), x: a.from.x, y: a.from.y, tx: a.to.x, ty: a.to.y }
          : s.flyer,
      };
    }
    case "SLIP_STAKE":
      return { ...s, slip: s.slip.map((i) => (i.pickId === a.pickId ? { ...i, stake: a.stake } : i)) };
    case "SLIP_REMOVE":
      return { ...s, slip: s.slip.filter((i) => i.pickId !== a.pickId) };
    case "PLACE_SLIP": {
      if (blockReason(s) || !s.slip.length) return s;
      const placed = s.slip.map((i) => betFrom(s.picks.find((p) => p.id === i.pickId)!, i.optionId, i.stake));
      const next = toast(
        {
          ...s,
          slip: [],
          sheet: null,
          flyer: a.from && a.to ? { id: s.nextId, kind: "odds", label: `В игре: ${placed.length}`, x: a.from.x, y: a.from.y, tx: a.to.x, ty: a.to.y } : s.flyer,
          bets: [...s.bets, ...placed],
          picks: s.picks.map((p) => (s.slip.some((i) => i.pickId === p.id) ? { ...p, status: "placed" } : p)),
        },
        placed.length > 1 ? `Ставок добавлено: ${placed.length}. Следим за матчами` : "Ставка добавлена. Следим за матчем",
      );
      const last = next.toasts.length - 1;
      return { ...next, toasts: next.toasts.map((t, i) => (i === last ? { ...t, undoBets: placed.map((b) => ({ betId: b.id, pickId: b.pickId })) } : t)) };
    }
    case "UNDO_PLACE": {
      // Fixes a mistaken tap. Only the toast's few seconds offer it, and no money has moved yet.
      const undo = s.toasts[0]?.undoBets ?? [];
      return {
        ...s,
        toasts: s.toasts.slice(1),
        bets: s.bets.filter((b) => !undo.some((u) => u.betId === b.id)),
        picks: s.picks.map((p) => (undo.some((u) => u.pickId === p.id) ? { ...p, status: "pending" } : p)),
      };
    }
    case "SET_FRESH":
      // What a new owner really sees: nothing has happened yet.
      return { ...initial(s.calm), sound: s.sound, onboarded: true, loading: false, tab: s.tab, picks: [], history: [], budget: 0, peak: 0 };
    case "SKIP": {
      // A double tap on a card that is already leaving must not stack up.
      if (s.picks.find((p) => p.id === a.pickId)?.status !== "pending") return s;
      return toast(
        {
          ...s,
          sheet: null,
          slip: s.slip.filter((i) => i.pickId !== a.pickId),
          picks: s.picks.map((p) => (p.id === a.pickId ? { ...p, status: "skipped" } : p)),
        },
        "Прогноз пропущен",
        a.pickId,
      );
    }
    case "UNDO_SKIP":
      return {
        ...s,
        toasts: s.toasts.slice(1),
        picks: s.picks.map((p) => (p.id === a.pickId ? { ...p, status: "pending" } : p)),
      };
    case "REMIND": {
      const on = s.reminders.includes(a.pickId);
      return toast(
        { ...s, reminders: on ? s.reminders.filter((id) => id !== a.pickId) : [...s.reminders, a.pickId] },
        on ? "Напоминание снято" : "Напомним за час до матча",
      );
    }
    case "ODDS_MOVE":
      // The steam job's real behaviour in miniature: a price moves while you look at it.
      return {
        ...s,
        picks: s.picks.map((p) =>
          p.id === 2 ? { ...p, options: p.options.map((o) => (o.id === "over" ? { ...o, prevOdds: o.odds, odds: 1.9 } : o)) } : p,
        ),
      };
    case "SHEET":
      return { ...s, sheet: a.sheet };
    case "OPEN_MATCH":
      return { ...s, openMatch: { match: a.match, morph: a.morph } };
    case "CLOSE_MATCH":
      return { ...s, openMatch: null };
    case "FLYER_DONE":
      // Money lands first, then the bank rolls: the order is the whole effect.
      return s.flyer?.kind === "money" ? reducer({ ...s, flyer: null }, { type: "CONFIRM" }) : { ...s, flyer: null };
    case "FLY_MONEY":
      if (s.sim.status !== "ft" || s.flyer?.kind === "money") return s;
      return {
        ...s,
        nextId: s.nextId + 1,
        flyer: {
          id: s.nextId,
          kind: "money",
          win: a.amount > 0,
          label: `${a.amount >= 0 ? "+" : "−"}${Math.abs(a.amount).toLocaleString("ru-RU")}`,
          x: a.from.x,
          y: a.from.y,
          tx: a.to.x,
          ty: a.to.y,
        },
      };
    case "FLY":
      return {
        ...s,
        nextId: s.nextId + 1,
        flyer: { id: s.nextId, kind: a.kind, label: a.label, win: a.win, x: a.from.x, y: a.from.y, tx: a.to.x, ty: a.to.y },
      };
    case "SIM_START":
      return { ...s, tab: "live", tabDirection: 1, sim: startSim(a.scenarioId, s.sim.speed) };
    case "SIM_TICK":
      return { ...s, sim: tickSim(s.sim, MINUTES_PER_TICK) };
    case "SIM_CLEAR":
      return { ...s, sim: { ...s.sim, moment: null } };
    case "SIM_SPEED":
      return { ...s, sim: { ...s.sim, speed: a.speed } };
    case "SIM_RESET":
      return { ...s, sim: { ...IDLE_SIM, speed: s.sim.speed } };
    case "CONFIRM": {
      // The one place money moves, and only after the user taps confirm.
      if (s.sim.status !== "ft") return s;
      const { bets } = trackedBets(s.bets);
      const { home, away } = s.sim;
      const rows: HistoryRow[] = bets.map((b) => {
        const result = settle(b, home, away);
        return { id: `s${s.nextId}-${b.id}`, home: b.home, away: b.away, score: `${home}:${away}`, pick: b.label, odds: b.odds, amount: payout(b, result), result };
      });
      const delta = rows.reduce((sum, r) => sum + r.amount, 0);
      const budget = s.budget + delta;
      return toast(
        {
          ...s,
          budget,
          lossToday: s.lossToday + Math.max(0, -delta),
          peak: Math.max(s.peak, budget),
          history: [...rows, ...s.history],
          bets: s.bets.filter((b) => !bets.some((t) => t.id === b.id)),
          sim: { ...IDLE_SIM, speed: s.sim.speed },
        },
        `Банк обновлён: ${delta >= 0 ? "+" : "−"}${Math.abs(delta).toLocaleString("ru-RU")}`,
      );
    }
    case "TOAST":
      return toast(s, a.text);
    case "TOAST_DONE":
      return { ...s, toasts: s.toasts.slice(1) };
    case "SET_BUDGET":
      return toast({ ...s, budget: a.budget, peak: Math.max(s.peak, a.budget), sheet: null }, "Банк обновлён");
    case "SET_SOUND":
      return { ...s, sound: a.on };
    case "SET_CALM":
      return { ...s, calm: a.on };
    case "SET_PREF":
      return { ...s, prefs: { ...s.prefs, ...a.prefs } };
    case "STOP_DEMO":
      return { ...s, stopped: true, stopMoment: true, slip: [] };
    case "STOP_ACK":
      return { ...s, stopMoment: false };
    case "STOP_LIFT":
      return { ...s, stopped: false };
    case "RESET":
      return { ...initial(s.calm), sound: s.sound };
  }
}

function momentMs(m: Moment, calm: boolean) {
  const base =
    m.type === "goal" ? 2600
    : m.type === "var_cancel" ? 2800
    : m.type === "whistle" ? 1700
    : m.type === "yellow" || m.type === "red" ? 1600
    : 1300;
  return calm ? Math.round(base * 0.6) : base;
}

interface GameContext {
  state: GameState;
  dispatch: Dispatch<Action>;
}

const Ctx = createContext<GameContext | null>(null);

export function useGame() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGame must be used inside GameProvider");
  return ctx;
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () =>
    initial(window.matchMedia("(prefers-reduced-motion: reduce)").matches),
  );
  const { sim, sound, calm, bets, toasts, loading } = state;

  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => dispatch({ type: "LOADED", at: Date.now() }), LOAD_MS);
    return () => clearTimeout(t);
  }, [loading]);

  const { theme, favorites, prefs: { currency } } = state;
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ theme, calm, currency, favorites }));
    } catch {
      // Private mode: settings last until the app closes.
    }
  }, [theme, calm, currency, favorites]);

  // Match clock. Stands still while a moment is on screen.
  const clockRuns = sim.status === "playing" && !sim.moment;
  useEffect(() => {
    if (!clockRuns) return;
    const t = setInterval(() => dispatch({ type: "SIM_TICK" }), TICK_MS);
    return () => clearInterval(t);
  }, [clockRuns]);

  // Sound and haptics fire once per moment, and the moment times itself out.
  const moment = sim.moment;
  useEffect(() => {
    if (!moment) return;
    const mood = moment.type === "goal" ? goalMood(trackedBets(bets).bets, moment.side) : "for";
    if (sound) {
      if (moment.type === "kickoff") whistle();
      if (moment.type === "whistle") whistle(true);
      if (moment.type === "goal") {
        roar(mood === "for" ? 1 : 0.35);
        thud();
      }
      if (moment.type === "yellow" || moment.type === "red" || moment.type === "var_cancel") whistle();
      if (moment.type === "post" || moment.type === "save") roar(0.4);
    }
    if (moment.type === "goal") {
      if (mood === "for") hapticResult("success");
      else haptic("medium");
    } else if (moment.type === "var_cancel" || moment.type === "red") {
      hapticResult("warning");
    } else {
      haptic("light");
    }
    const t = setTimeout(() => dispatch({ type: "SIM_CLEAR" }), momentMs(moment, calm));
    return () => clearTimeout(t);
    // Keyed on the moment alone: placing a bet mid-match must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment]);

  useEffect(() => {
    if (sound && sim.status === "playing") startAmbient();
    else stopAmbient();
    return stopAmbient;
  }, [sound, sim.status]);

  const toastId = toasts[0]?.id;
  useEffect(() => {
    if (toastId === undefined) return;
    const t = setTimeout(() => dispatch({ type: "TOAST_DONE" }), TOAST_MS);
    return () => clearTimeout(t);
  }, [toastId]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
