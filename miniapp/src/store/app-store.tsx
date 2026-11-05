"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import type { LiveMatch } from "@/lib/feeds/polymarket";
import type { HelpTopic } from "@/lib/help";
import type { Morph } from "@/ui/motion";

// What the screens share that isn't server data: navigation, overlays and the
// owner's display preferences. Everything else lives in the API and its queries.

export const TABS = ["bets", "live", "bank", "stats", "settings"] as const;
export type Tab = (typeof TABS)[number];
export type ThemeChoice = "auto" | "light" | "dark";

const TOAST_MS = 2600;
const ONBOARDED_KEY = "pn-onboarded";
const PREFS_KEY = "pn-prefs";

export interface Toast {
  id: number;
  text: string;
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

export type SheetState = { kind: "help"; topic: HelpTopic } | { kind: "bank" } | null;

export interface GameState {
  theme: ThemeChoice;
  calm: boolean;
  currency: string;
  favorites: string[];
  onboarded: boolean;
  tab: Tab;
  tabDirection: 1 | -1;
  sheet: SheetState;
  openMatch: { match: LiveMatch; morph?: Morph } | null;
  toasts: Toast[];
  flyer: Flyer | null;
  stopMoment: boolean;
  nextId: number;
}

type Point = { x: number; y: number };

export type Action =
  | { type: "TAB"; tab: Tab }
  | { type: "SET_THEME"; theme: ThemeChoice }
  | { type: "SET_CALM"; on: boolean }
  | { type: "SET_CURRENCY"; currency: string }
  | { type: "TOGGLE_FAVORITE"; team: string }
  | { type: "ONBOARDING"; show: boolean }
  | { type: "SHEET"; sheet: SheetState }
  | { type: "OPEN_MATCH"; match: LiveMatch; morph?: Morph }
  | { type: "CLOSE_MATCH" }
  | { type: "FLY"; kind: Flyer["kind"]; label: string; win?: boolean; from: Point; to: Point }
  | { type: "FLYER_DONE" }
  | { type: "TOAST"; text: string }
  | { type: "TOAST_DONE" }
  | { type: "STOP_SHOW" }
  | { type: "STOP_ACK" };

type SavedPrefs = { theme?: ThemeChoice; calm?: boolean; currency?: string; favorites?: string[] };

function readSaved(): SavedPrefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as SavedPrefs;
  } catch {
    return {};
  }
}

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

function initial(calm: boolean): GameState {
  const saved = readSaved();
  return {
    theme: saved.theme ?? "auto",
    calm: saved.calm ?? calm,
    currency: saved.currency ?? "$",
    favorites: saved.favorites ?? [],
    onboarded: readOnboarded(),
    tab: "bets",
    tabDirection: 1,
    sheet: null,
    openMatch: null,
    toasts: [],
    flyer: null,
    stopMoment: false,
    nextId: 1,
  };
}

function reducer(s: GameState, a: Action): GameState {
  switch (a.type) {
    case "TAB":
      return { ...s, tab: a.tab, tabDirection: TABS.indexOf(a.tab) >= TABS.indexOf(s.tab) ? 1 : -1 };
    case "SET_THEME":
      return { ...s, theme: a.theme };
    case "SET_CALM":
      return { ...s, calm: a.on };
    case "SET_CURRENCY":
      return { ...s, currency: a.currency };
    case "TOGGLE_FAVORITE":
      return { ...s, favorites: s.favorites.includes(a.team) ? s.favorites.filter((t) => t !== a.team) : [...s.favorites, a.team] };
    case "ONBOARDING":
      return { ...s, onboarded: !a.show };
    case "SHEET":
      return { ...s, sheet: a.sheet };
    case "OPEN_MATCH":
      return { ...s, openMatch: { match: a.match, morph: a.morph } };
    case "CLOSE_MATCH":
      return { ...s, openMatch: null };
    case "FLY":
      return {
        ...s,
        nextId: s.nextId + 1,
        flyer: { id: s.nextId, kind: a.kind, label: a.label, win: a.win, x: a.from.x, y: a.from.y, tx: a.to.x, ty: a.to.y },
      };
    case "FLYER_DONE":
      return { ...s, flyer: null };
    case "TOAST":
      return { ...s, nextId: s.nextId + 1, toasts: [...s.toasts, { id: s.nextId, text: a.text }] };
    case "TOAST_DONE":
      return { ...s, toasts: s.toasts.slice(1) };
    case "STOP_SHOW":
      return { ...s, stopMoment: true };
    case "STOP_ACK":
      return { ...s, stopMoment: false };
  }
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
  const [state, dispatch] = useReducer(reducer, undefined, () => initial(window.matchMedia("(prefers-reduced-motion: reduce)").matches));
  const { theme, calm, currency, favorites, toasts } = state;

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ theme, calm, currency, favorites }));
    } catch {
      // Private mode: settings last until the app closes.
    }
  }, [theme, calm, currency, favorites]);

  const toastId = toasts[0]?.id;
  useEffect(() => {
    if (toastId === undefined) return;
    const t = setTimeout(() => dispatch({ type: "TOAST_DONE" }), TOAST_MS);
    return () => clearTimeout(t);
  }, [toastId]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
