// Demo-only data and match simulation for /prototype. Nothing here reads the
// real API: figures are made up and the UI labels them "Демо". Team and league
// logos are the real ones, from the same API-Football CDN the bot's data uses.
// Pure on purpose, so engine.check.mjs can run it without React or a browser.

export const FULL_TIME = 90;
export const STOPPAGE = 3;
export const FINALE_FROM = 80;
export const WEAK_EDGE = 0.03;
export const STOP_LOSS = 0.2;

const TEAM_ID: Record<string, number> = {
  Arsenal: 42,
  Liverpool: 40,
  "Real Sociedad": 548,
  Sevilla: 536,
  "Bayern Munich": 157,
  "Borussia Dortmund": 165,
  Inter: 505,
  Roma: 497,
  Napoli: 492,
  "AC Milan": 489,
  "RB Leipzig": 173,
};

const LEAGUE_ID: Record<string, number> = {
  "Premier League": 39,
  "La Liga": 140,
  Bundesliga: 78,
  "Serie A": 135,
};

const CDN = "https://media.api-sports.io/football";
export const teamLogo = (team: string) => `${CDN}/teams/${TEAM_ID[team]}.png`;
export const leagueLogo = (league: string) => `${CDN}/leagues/${LEAGUE_ID[league]}.png`;

/**
 * A club's colour taken from its crest: the most common saturated hue, darkened
 * until white text stays readable on it (4.5:1). Null if the crest has no
 * clear colour. Takes RGBA pixels, so it runs without a browser.
 */
export function pickCrestColor(data: ArrayLike<number>): string | null {
  const bins = Array.from({ length: 12 }, () => ({ n: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i + 3 < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (a < 128 || max < 40 || max - min < 50) continue; // Transparent, black, white or grey.
    const d = max - min;
    const hue = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    const bin = bins[Math.floor(hue * 2) % 12];
    // Weighted by saturation: a crest's anti-aliased edges would otherwise wash the colour out.
    bin.n += d;
    bin.r += r * d;
    bin.g += g * d;
    bin.b += b * d;
  }
  const best = bins.reduce((x, y) => (y.n > x.n ? y : x));
  if (!best.n) return null;
  let rgb = [best.r / best.n, best.g / best.n, best.b / best.n];
  const luminance = ([r, g, b]: number[]) => {
    const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  while (1.05 / (luminance(rgb) + 0.05) < 4.5) rgb = rgb.map((v) => v * 0.92);
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

// Set by hand where the crest alone would make a match one-coloured (both these are red).
export const TEAM_COLOR: Record<string, string> = {
  Arsenal: "#b4121b",
  Liverpool: "#0b7d74",
};

export type Side = "home" | "away";
export type Selection = { kind: "team"; side: Side } | { kind: "draw" } | { kind: "over"; line: number } | { kind: "under"; line: number };
export type PickStatus = "pending" | "placed" | "skipped";

export interface MarketOption {
  id: string;
  label: string;
  title: string;
  odds: number;
  prevOdds?: number;
  closing: number;
  selection: Selection;
}

export interface DemoPick {
  id: number;
  league: string;
  home: string;
  away: string;
  marketLabel: string;
  options: MarketOption[];
  recommended: string;
  confidence: string;
  modelP: number;
  poissonP: number;
  xgP: number;
  priceVerified: boolean;
  stake: number;
  kickoffHours: number;
  reasoning: string;
  status: PickStatus;
}

/** A placed bet. Odds are frozen at the moment the user confirmed. */
export interface Bet {
  id: string;
  pickId: number;
  home: string;
  away: string;
  label: string;
  odds: number;
  closing: number;
  selection: Selection;
  stake: number;
}

const OVER = (line: number, odds: number, closing: number): MarketOption => ({
  id: "over",
  label: `Больше ${line}`,
  title: `Больше ${line} гола`,
  odds,
  closing,
  selection: { kind: "over", line },
});

const UNDER = (line: number, odds: number, closing: number): MarketOption => ({
  id: "under",
  label: `Меньше ${line}`,
  title: `Меньше ${line} гола`,
  odds,
  closing,
  selection: { kind: "under", line },
});

const X12 = (home: string, away: string, h: number, d: number, a: number, closing: [number, number, number]): MarketOption[] => [
  { id: "1", label: "1", title: `Победа ${home}`, odds: h, closing: closing[0], selection: { kind: "team", side: "home" } },
  { id: "x", label: "X", title: "Ничья", odds: d, closing: closing[1], selection: { kind: "draw" } },
  { id: "2", label: "2", title: `Победа ${away}`, odds: a, closing: closing[2], selection: { kind: "team", side: "away" } },
];

export const DEMO_PICKS: DemoPick[] = [
  {
    id: 1,
    league: "Premier League",
    home: "Arsenal",
    away: "Liverpool",
    marketLabel: "Исход матча",
    options: X12("Arsenal", "Liverpool", 2.35, 3.6, 2.95, [2.1, 3.7, 3.3]),
    recommended: "1",
    confidence: "Высокая",
    modelP: 0.52,
    poissonP: 0.49,
    xgP: 0.51,
    priceVerified: true,
    stake: 1500,
    kickoffHours: 5.2,
    reasoning: "Arsenal силён в прессинге дома, а у Liverpool две травмы в центре обороны. Рынок недооценивает форму хозяев.",
    status: "pending",
  },
  {
    id: 2,
    league: "Premier League",
    home: "Arsenal",
    away: "Liverpool",
    marketLabel: "Тотал голов",
    options: [OVER(2.5, 1.92, 1.88), UNDER(2.5, 1.95, 2.0)],
    recommended: "over",
    confidence: "Средняя",
    modelP: 0.58,
    poissonP: 0.41,
    xgP: 0.56,
    priceVerified: false,
    stake: 900,
    kickoffHours: 5.2,
    reasoning: "Обе команды создают много голевых моментов, но модель Пуассона сомневается. Проверьте цену у своего букмекера.",
    status: "pending",
  },
  {
    id: 4,
    league: "Bundesliga",
    home: "Bayern Munich",
    away: "Borussia Dortmund",
    marketLabel: "Исход матча",
    options: X12("Bayern Munich", "Borussia Dortmund", 1.72, 4.2, 4.6, [1.68, 4.3, 4.8]),
    recommended: "1",
    confidence: "Средняя",
    modelP: 0.63,
    poissonP: 0.6,
    xgP: 0.62,
    priceVerified: true,
    stake: 1100,
    kickoffHours: 22.5,
    reasoning: "Bayern не проигрывает дома с августа, у Dortmund плотный календарь и мало времени на восстановление.",
    status: "pending",
  },
  {
    id: 3,
    league: "La Liga",
    home: "Real Sociedad",
    away: "Sevilla",
    marketLabel: "Исход матча",
    options: X12("Real Sociedad", "Sevilla", 2.3, 3.2, 3.1, [2.25, 3.25, 3.2]),
    recommended: "2",
    confidence: "Низкая",
    modelP: 0.33,
    poissonP: 0.31,
    xgP: 0.34,
    priceVerified: true,
    stake: 400,
    kickoffHours: 26,
    reasoning: "Перевес над рынком минимальный. Такой прогноз можно спокойно пропустить.",
    status: "pending",
  },
];

export const optionOf = (p: DemoPick, id: string) => p.options.find((o) => o.id === id)!;
export const recommendedOption = (p: DemoPick) => optionOf(p, p.recommended);
export const edge = (p: DemoPick) => p.modelP - 1 / recommendedOption(p).odds;
export const isWeak = (p: DemoPick) => edge(p) < WEAK_EDGE;
export const clv = (b: Pick<Bet, "odds" | "closing">) => b.odds / b.closing - 1;

export const betFrom = (p: DemoPick, optionId: string, stake: number): Bet => {
  const o = optionOf(p, optionId);
  return {
    id: `b${p.id}-${o.id}`,
    pickId: p.id,
    home: p.home,
    away: p.away,
    label: o.title,
    odds: o.odds,
    closing: o.closing,
    selection: o.selection,
    stake,
  };
};

// --- Bet status: computed from the score alone, so a live feed needs no odds calls.

export type Tone = "good" | "level" | "bad";

export interface BetStatus {
  tone: Tone;
  label: string;
  detail: string;
  /** Goals scored and needed, for a totals line. */
  goals?: { total: number; need: number };
}

export function settle(b: Pick<Bet, "selection">, home: number, away: number): "win" | "loss" {
  const s = b.selection;
  const total = home + away;
  if (s.kind === "over") return total > s.line ? "win" : "loss";
  if (s.kind === "under") return total < s.line ? "win" : "loss";
  if (s.kind === "draw") return home === away ? "win" : "loss";
  const mine = s.side === "home" ? home : away;
  const theirs = s.side === "home" ? away : home;
  return mine > theirs ? "win" : "loss";
}

export const payout = (b: Pick<Bet, "stake" | "odds">, result: "win" | "loss") =>
  result === "win" ? Math.round(b.stake * (b.odds - 1)) : -b.stake;

export function betStatus(b: Pick<Bet, "selection">, home: number, away: number, minute: number, finished: boolean): BetStatus {
  const left = Math.max(0, FULL_TIME - Math.floor(minute));
  const s = b.selection;

  if (finished) {
    const won = settle(b, home, away) === "win";
    return { tone: won ? "good" : "bad", label: won ? "Зашла" : "Не зашла", detail: `Итог ${home}:${away}` };
  }

  if (s.kind === "over") {
    const total = home + away;
    const need = Math.ceil(s.line);
    if (total >= need) return { tone: "good", label: "Зашла", detail: `Уже ${total} из ${need}, исход не изменится`, goals: { total, need } };
    return { tone: "level", label: `Голов ${total} из ${need}`, detail: `Нужно ещё ${need - total}, осталось ${left} мин`, goals: { total, need } };
  }
  if (s.kind === "under") {
    const total = home + away;
    if (total > s.line) return { tone: "bad", label: "Не зашла", detail: `Уже ${total}, линия пройдена` };
    return { tone: "good", label: "Заходит", detail: `Пока ${total}, осталось ${left} мин` };
  }
  if (s.kind === "draw") {
    return home === away
      ? { tone: "good", label: "Заходит", detail: `Держится ничья, осталось ${left} мин` }
      : { tone: "bad", label: "Пока не заходит", detail: `Нужно сравнять счёт, осталось ${left} мин` };
  }
  const mine = s.side === "home" ? home : away;
  const theirs = s.side === "home" ? away : home;
  if (mine > theirs) return { tone: "good", label: "Заходит", detail: `Держим счёт, осталось ${left} мин` };
  if (mine === theirs) return { tone: "level", label: "Пока ничья", detail: `Нужен гол, осталось ${left} мин` };
  return { tone: "bad", label: "Пока не заходит", detail: `Нужно отыграться, осталось ${left} мин` };
}

// --- Match simulation

export type EventType = "goal" | "var_cancel" | "yellow" | "red" | "save" | "post";

export interface MatchEvent {
  minute: number;
  type: EventType;
  side: Side;
  player: string;
  note?: string;
}

export type Moment = MatchEvent | { type: "kickoff" | "whistle" };

export interface Scenario {
  id: string;
  title: string;
  subtitle: string;
  events: MatchEvent[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: "win",
    title: "Победа на флажке",
    subtitle: "Гол, штанга и развязка на 83-й",
    events: [
      { minute: 12, type: "save", side: "home", player: "Saka", note: "Вратарь вытащил удар" },
      { minute: 23, type: "yellow", side: "away", player: "Szoboszlai" },
      { minute: 34, type: "goal", side: "home", player: "Saka" },
      { minute: 47, type: "post", side: "away", player: "Salah", note: "Штанга!" },
      { minute: 58, type: "goal", side: "away", player: "Salah" },
      { minute: 83, type: "goal", side: "home", player: "Ødegaard" },
    ],
  },
  {
    id: "comeback",
    title: "Камбэк с VAR",
    subtitle: "Отставание, отмена гола, красная",
    events: [
      { minute: 9, type: "goal", side: "away", player: "Gakpo" },
      { minute: 31, type: "goal", side: "home", player: "Havertz" },
      { minute: 33, type: "var_cancel", side: "home", player: "Havertz", note: "Офсайд" },
      { minute: 52, type: "red", side: "away", player: "Konaté" },
      { minute: 67, type: "goal", side: "home", player: "Rice" },
      { minute: 88, type: "goal", side: "home", player: "Saka" },
    ],
  },
  {
    id: "loss",
    title: "Проигрыш, но с плюсом",
    subtitle: "Матч мимо, зато кэф лучше линии",
    events: [
      { minute: 18, type: "goal", side: "away", player: "Salah" },
      { minute: 44, type: "goal", side: "home", player: "Ødegaard" },
      { minute: 61, type: "yellow", side: "home", player: "Rice" },
      { minute: 77, type: "goal", side: "away", player: "Gakpo" },
    ],
  },
];

export interface Sim {
  status: "idle" | "playing" | "ft";
  scenarioId: string;
  minute: number;
  idx: number;
  home: number;
  away: number;
  log: MatchEvent[];
  moment: Moment | null;
  speed: 1 | 2;
}

export const IDLE_SIM: Sim = {
  status: "idle",
  scenarioId: "win",
  minute: 0,
  idx: 0,
  home: 0,
  away: 0,
  log: [],
  moment: null,
  speed: 1,
};

export const startSim = (scenarioId: string, speed: 1 | 2 = 1): Sim => ({
  ...IDLE_SIM,
  status: "playing",
  scenarioId,
  speed,
  moment: { type: "kickoff" },
});

/** One clock step. The clock stands still while a moment is on screen. */
export function tickSim(sim: Sim, step: number): Sim {
  if (sim.status !== "playing" || sim.moment) return sim;
  const scenario = SCENARIOS.find((s) => s.id === sim.scenarioId)!;
  const next = scenario.events[sim.idx];
  const minute = sim.minute + step * sim.speed;

  if (next && minute >= next.minute) {
    let { home, away } = sim;
    const delta = next.type === "goal" ? 1 : next.type === "var_cancel" ? -1 : 0;
    if (next.side === "home") home += delta;
    else away += delta;
    return { ...sim, minute: next.minute, idx: sim.idx + 1, home, away, log: [...sim.log, next], moment: next };
  }
  if (!next && minute >= FULL_TIME + STOPPAGE) {
    return { ...sim, minute: FULL_TIME + STOPPAGE, status: "ft", moment: { type: "whistle" } };
  }
  return { ...sim, minute };
}

/** "67'" in normal time, "90+2'" in stoppage time. */
export function minuteLabel(minute: number) {
  const m = Math.floor(minute);
  return m > FULL_TIME ? `${FULL_TIME}+${m - FULL_TIME}'` : `${m}'`;
}

/** What the board shows: a new goal or VAR call stays hidden until its broadcast panel leaves. */
export function shownScore(sim: Sim) {
  const m = sim.moment;
  if (m?.type !== "goal" && m?.type !== "var_cancel") return { home: sim.home, away: sim.away };
  const delta = m.type === "goal" ? -1 : 1;
  return m.side === "home" ? { home: sim.home + delta, away: sim.away } : { home: sim.home, away: sim.away + delta };
}

export const shownLog = (sim: Sim) =>
  sim.moment?.type === "goal" || sim.moment?.type === "var_cancel" ? sim.log.slice(0, -1) : sim.log;

/** Events that still stand: a VAR call removes that side's latest goal. */
export function standingEvents(log: MatchEvent[]) {
  const out: MatchEvent[] = [];
  for (const e of log) {
    if (e.type !== "var_cancel") {
      out.push(e);
      continue;
    }
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].type === "goal" && out[i].side === e.side) {
        out.splice(i, 1);
        break;
      }
    }
  }
  return out;
}

/** Bets the demo match follows: placed ones on this match, or a stand-in so it always plays. */
export function trackedBets(bets: Bet[]): { bets: Bet[]; standIn: boolean } {
  const placed = bets.filter((b) => b.home === "Arsenal");
  if (placed.length) return { bets: placed, standIn: false };
  const pick = DEMO_PICKS[0];
  return { bets: [betFrom(pick, pick.recommended, pick.stake)], standIn: true };
}

/** A team or draw bet decides how a goal feels; a totals-only bet follows its direction. */
export function goalMood(bets: Pick<Bet, "selection">[], side: Side): "for" | "against" {
  const team = bets.find((b) => b.selection.kind === "team");
  if (team?.selection.kind === "team") return team.selection.side === side ? "for" : "against";
  if (bets.some((b) => b.selection.kind === "draw" || b.selection.kind === "under")) return "against";
  return "for";
}

// --- Match statistics and line-ups: the shape API-Football returns for a fixture

const FINAL_STATS: { label: string; home: number; away: number; decimals?: number; share?: boolean }[] = [
  { label: "Владение, %", home: 58, away: 42, share: true },
  { label: "Удары", home: 14, away: 9 },
  { label: "В створ", home: 6, away: 3 },
  { label: "xG", home: 1.8, away: 1.1, decimals: 1 },
  { label: "Угловые", home: 7, away: 3 },
  { label: "Фолы", home: 9, away: 12 },
];

/** Stats grow with the clock; possession stays a share, so it is not scaled. */
export function statsAt(minute: number) {
  const k = Math.min(1, minute / FULL_TIME);
  return FINAL_STATS.map((s) => {
    if (s.share) return { label: s.label, home: minute ? s.home : 50, away: minute ? s.away : 50 };
    const scale = (v: number) => (s.decimals ? Number((v * k).toFixed(s.decimals)) : Math.round(v * k));
    return { label: s.label, home: scale(s.home), away: scale(s.away) };
  });
}

export const LINEUPS = {
  formation: "4-3-3",
  home: [["Raya"], ["White", "Saliba", "Gabriel", "Calafiori"], ["Rice", "Ødegaard", "Havertz"], ["Saka", "Gyökeres", "Martinelli"]],
  away: [["Alisson"], ["Frimpong", "Konaté", "van Dijk", "Kerkez"], ["Gravenberch", "Szoboszlai", "Mac Allister"], ["Salah", "Gakpo", "Wirtz"]],
};

// --- Form and head-to-head: from football_data.py's recent_form / head_to_head in the real app

export type FormResult = "win" | "draw" | "loss";

export const TEAM_FORM: Record<string, FormResult[]> = {
  Arsenal: ["win", "win", "draw", "win", "loss"],
  Liverpool: ["loss", "win", "draw", "loss", "win"],
  "Bayern Munich": ["win", "win", "win", "draw", "win"],
  "Borussia Dortmund": ["draw", "loss", "win", "win", "draw"],
  "Real Sociedad": ["draw", "win", "loss", "draw", "win"],
  Sevilla: ["loss", "draw", "win", "loss", "draw"],
};

export const TEAM_TABLE: Record<string, { pos: number; points: number; played: number }> = {
  Arsenal: { pos: 2, points: 25, played: 11 },
  Liverpool: { pos: 4, points: 21, played: 11 },
  "Bayern Munich": { pos: 1, points: 28, played: 10 },
  "Borussia Dortmund": { pos: 5, points: 17, played: 10 },
  "Real Sociedad": { pos: 9, points: 15, played: 11 },
  Sevilla: { pos: 13, points: 12, played: 11 },
};

export const H2H: Record<string, { date: string; score: string }[]> = {
  "Arsenal-Liverpool": [
    { date: "май 2026", score: "2:2" },
    { date: "авг 2025", score: "0:1" },
    { date: "окт 2024", score: "2:2" },
  ],
  "Bayern Munich-Borussia Dortmund": [
    { date: "апр 2026", score: "2:1" },
    { date: "окт 2025", score: "2:1" },
    { date: "мар 2025", score: "1:1" },
  ],
  "Real Sociedad-Sevilla": [
    { date: "фев 2026", score: "1:0" },
    { date: "сен 2025", score: "2:1" },
    { date: "мар 2025", score: "3:0" },
  ],
};

// --- Bank and statistics demo content

export const START_BUDGET = 48250;
export const START_PEAK = 52000;

export const CAPITAL: Record<"week" | "month" | "all", number[]> = {
  week: [47200, 47200, 47900, 47900, 47400, 47400, 47750, 47750, 48100, 47800, 47800, 48400, 48250, 48250],
  month: [44800, 45300, 45100, 46200, 46000, 46900, 47600, 47100, 47900, 47300, 48100, 47800, 48500, 48250],
  all: [40000, 41200, 40600, 42300, 43400, 42800, 44500, 46100, 45200, 48600, 52000, 50200, 49100, 48250],
};

export const CAPITAL_LABEL = { week: "7 дней", month: "30 дней", all: "Всё время" } as const;

export const FORM: FormResult[] = ["win", "win", "loss", "win", "draw"];

export const LEAGUES = [
  { name: "Premier League", wins: 9, losses: 6, roi: 8.1 },
  { name: "La Liga", wins: 7, losses: 6, roi: 3.4 },
  { name: "Bundesliga", wins: 7, losses: 7, roi: -1.2 },
];

export interface HistoryRow {
  id: string;
  home: string;
  away: string;
  score: string;
  pick: string;
  odds: number;
  amount: number;
  result: "win" | "loss";
}

export const DEMO_HISTORY: HistoryRow[] = [
  { id: "h1", home: "Inter", away: "Roma", score: "2:0", pick: "Победа Inter", odds: 1.85, amount: 850, result: "win" },
  { id: "h2", home: "Borussia Dortmund", away: "RB Leipzig", score: "3:2", pick: "Меньше 3.5", odds: 2.05, amount: -800, result: "loss" },
  { id: "h3", home: "Napoli", away: "AC Milan", score: "2:1", pick: "Больше 2.5", odds: 1.74, amount: 666, result: "win" },
];

// --- What the LLM based a pick on: key_factors from analysis.py, split by its reliability tag

export type Factor = { tag: "confirmed" | "rumour"; text: string };

export const PICK_FACTORS: Record<number, Factor[]> = {
  1: [
    { tag: "confirmed", text: "У Liverpool нет двух центральных защитников" },
    { tag: "confirmed", text: "Arsenal выиграл 4 из 5 последних домашних матчей" },
    { tag: "confirmed", text: "Liverpool играл в Лиге чемпионов три дня назад" },
    { tag: "rumour", text: "Разговоры о конфликте тренера и капитана Liverpool" },
  ],
  2: [
    { tag: "confirmed", text: "Обе команды создают больше 1.5 xG за матч" },
    { tag: "confirmed", text: "Судья редко назначает пенальти" },
    { tag: "rumour", text: "Возможна ротация в обороне Arsenal" },
  ],
  3: [
    { tag: "confirmed", text: "Sevilla не побеждала в гостях 5 матчей" },
    { tag: "rumour", text: "Задержка зарплат в Sevilla" },
  ],
  4: [
    { tag: "confirmed", text: "Bayern не проигрывает дома с августа" },
    { tag: "confirmed", text: "У Dortmund три дня на восстановление" },
  ],
};

export const PICK_EVALUATED_MIN: Record<number, number> = { 1: 12, 2: 12, 3: 41, 4: 27 };
export const DEMO_MODEL = "Claude";

// --- Week in review: losses are shown as plainly as wins

export const WEEK = {
  bets: 9,
  won: 5,
  lost: 4,
  amount: 1840,
  clv: 2.6,
  best: { match: "Inter — Roma", amount: 850 },
  worst: { match: "Borussia Dortmund — RB Leipzig", amount: -800 },
};

export const HELP = {
  edge: { title: "Перевес", text: "На сколько процентов модель оценивает шанс исхода выше, чем заложено в кэфе. Например, модель даёт 52%, а кэф 2.35 означает 42.5%: перевес +9.5%." },
  clv: { title: "CLV, плюс к линии", text: "Сравнение вашего кэфа с кэфом перед самым стартом матча. Если вы взяли 2.35, а к старту стало 2.10, вы обыграли рынок, даже если сам матч не зашёл. На длинной дистанции это лучший показатель качества." },
  winrate: { title: "Процент побед", text: "Доля выигравших ставок. В скобках диапазон, где с вероятностью 95% лежит настоящее значение. Пока ставок мало, он широкий." },
  roi: { title: "ROI", text: "Сколько вы заработали на каждый поставленный рубль. +6% означает 6 копеек прибыли с рубля на дистанции." },
  brier: { title: "Точность модели", text: "Brier score показывает, насколько честны вероятности модели. 0 значит идеально, 0.25 равно подбрасыванию монеты. Чем ниже, тем лучше." },
  stop: { title: "Стоп по просадке", text: "Если банк падает от пика на заданный процент, бот перестаёт предлагать ставки. Это защита от серии неудач." },
} as const;

export type HelpTopic = keyof typeof HELP;
