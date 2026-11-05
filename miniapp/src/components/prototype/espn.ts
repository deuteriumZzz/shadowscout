// Live scores, events, statistics and line-ups from ESPN's public (unofficial,
// undocumented) soccer API, plus pairing its games with Polymarket's matches.
// Pure, so engine.check.mjs can run it. A wrong pairing would show one match's
// statistics on another, so anything less than one clear candidate means no link.

export const ESPN_CODES: Record<string, string> = {
  "Premier League": "eng.1",
  "La Liga": "esp.1",
  Bundesliga: "ger.1",
  "Serie A": "ita.1",
  "Ligue 1": "fra.1",
  "Champions League": "uefa.champions",
};

export type GameState = "pre" | "in" | "post";
export type FormLetter = "win" | "draw" | "loss";

export interface EspnTeam {
  name: string;
  /** The full name: short ones like "Spurs" or "Nottm Forest" can't be matched. */
  fullName: string;
  logo: string;
  score: number;
  form: FormLetter[];
}

export interface EspnGame {
  id: string;
  code: string;
  league: string;
  start: string;
  state: GameState;
  clock: string;
  home: EspnTeam;
  away: EspnTeam;
}

/** ESPN's JSON is external and unversioned: it's read defensively, field by field. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

const FORM: Record<string, FormLetter> = { W: "win", D: "draw", L: "loss" };

/** The scoreboard lists form newest first; the summary oldest first, as the app shows it. */
const toForm = (form: unknown): FormLetter[] =>
  [...String(form ?? "")].reverse().flatMap((c) => FORM[c] ?? []);

export function normalizeScoreboard(data: Raw, code: string, league: string): EspnGame[] {
  const games: EspnGame[] = [];
  for (const event of data?.events ?? []) {
    const competition = event?.competitions?.[0];
    const side = (s: string) => competition?.competitors?.find((c: Raw) => c?.homeAway === s);
    const home = side("home");
    const away = side("away");
    const state = event?.status?.type?.state;
    if (!event?.id || !event?.date || !home?.team || !away?.team) continue;
    if (state !== "pre" && state !== "in" && state !== "post") continue;
    const team = (c: Raw): EspnTeam => ({
      name: String(c.team.shortDisplayName ?? c.team.displayName ?? ""),
      fullName: String(c.team.displayName ?? c.team.shortDisplayName ?? ""),
      logo: String(c.team.logo ?? ""),
      score: Number(c.score) || 0,
      form: toForm(c.form),
    });
    games.push({
      id: String(event.id),
      code,
      league,
      start: new Date(event.date).toISOString(),
      state,
      clock: String(event.status?.displayClock ?? ""),
      home: team(home),
      away: team(away),
    });
  }
  return games;
}

// --- Pairing with Polymarket: the two feeds name clubs differently

const NOISE = new Set(["fc", "afc", "cf", "sc", "ac", "as", "ss", "ssc", "us", "rc", "rcd", "sv", "vfb", "vfl", "tsg", "fsv", "bsc", "club", "de", "la", "of", "the", "and", "calcio", "stade", "olympique"]);
const ALIASES: Record<string, string> = {
  munchen: "munich",
  man: "manchester",
  utd: "united",
  wolves: "wolverhampton",
  internazionale: "inter",
  koln: "cologne",
  gladbach: "monchengladbach",
  hamburger: "hamburg",
  brestois: "brest",
  lyonnais: "lyon",
};

export function teamTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ø/gi, "o")
    .toLowerCase()
    // Otherwise "Paris FC" would be a subset of "Paris Saint-Germain".
    .replace(/paris saint[ -]germain/, "psg")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !/^\d+$/.test(t) && !NOISE.has(t))
    .map((t) => ALIASES[t] ?? t);
}

export function sameTeam(a: string, b: string) {
  const x = teamTokens(a);
  const y = teamTokens(b);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((t) => long.includes(t));
}

const LINK_WINDOW_MS = 2 * 3_600_000;

const isTeam = (team: EspnTeam, name: string) => sameTeam(team.fullName, name) || sameTeam(team.name, name);

/** Same league (the caller's list), close kick-off, both clubs, and exactly one candidate. */
export function findGame(games: EspnGame[], home: string, away: string, start: string): EspnGame | null {
  const at = Date.parse(start);
  const found = games.filter(
    (g) => Math.abs(Date.parse(g.start) - at) <= LINK_WINDOW_MS && isTeam(g.home, home) && isTeam(g.away, away),
  );
  return found.length === 1 ? found[0] : null;
}

// --- One match in detail

export type EventKind = "goal" | "yellow" | "red" | "sub";

export interface MatchEventRow {
  minute: string;
  kind: EventKind;
  side: "home" | "away" | null;
  player: string;
  /** The assist for a goal, or the player coming off for a substitution. */
  other: string | null;
  /** When it really happened, as ISO time, for lining it up with prices. */
  at: string | null;
}

export interface StatRow {
  label: string;
  home: number;
  away: number;
  share: boolean;
}

export interface LineupPlayer {
  name: string;
  jersey: string;
  position: string;
}

export interface Lineup {
  formation: string;
  /** Goalkeeper first, then one array per line of the formation, from the back. */
  lines: LineupPlayer[][];
  subs: LineupPlayer[];
}

export interface TableRow {
  rank: number;
  points: number;
  played: number;
}

export interface MatchDetail {
  state: GameState;
  clock: string;
  homeScore: number;
  awayScore: number;
  events: MatchEventRow[];
  stats: StatRow[];
  lineups: { home: Lineup; away: Lineup } | null;
  form: { home: FormLetter[]; away: FormLetter[] };
  table: { home: TableRow | null; away: TableRow | null };
}

/** "45'+3'" as 48. Null when there's no clock to read, rather than a guessed zero. */
export function minuteValue(minute: string): number | null {
  const parts = minute.match(/\d+/g);
  return parts ? parts.slice(0, 2).reduce((sum, n) => sum + Number(n), 0) : null;
}

const STAT_ROWS: [string, string, boolean][] = [
  ["possessionPct", "Владение, %", true],
  ["totalShots", "Удары", false],
  ["shotsOnTarget", "В створ", false],
  ["wonCorners", "Угловые", false],
  ["offsides", "Офсайды", false],
  ["foulsCommitted", "Фолы", false],
  ["saves", "Сейвы", false],
];

/** How far up the pitch a position sits, to put players into the formation's lines. */
function depth(position: string) {
  const p = position.toUpperCase();
  if (p === "G" || p === "GK") return 0;
  if (p.startsWith("CD") || p === "LB" || p === "RB" || p === "D") return 1;
  if (p.startsWith("DM") || p.endsWith("WB")) return 2;
  if (p.startsWith("CM") || p === "LM" || p === "RM" || p === "M") return 3;
  if (p.startsWith("AM")) return 4;
  if (p === "LW" || p === "RW" || p === "W") return 5;
  return 6; // Strikers, and anything unknown stays up front rather than dropping out.
}

/** Left to right across a line, as the team itself sees it: full-backs outside centre-backs. */
const lateral = (position: string) => {
  const p = position.toUpperCase();
  if (/^L(B|M|W|F|WB)$/.test(p)) return -2;
  if (p.endsWith("-L")) return -1;
  if (p.endsWith("-R")) return 1;
  if (/^R(B|M|W|F|WB)$/.test(p)) return 2;
  return 0;
};

const lastName = (name: string) => name.trim().split(/\s+/).at(-1) ?? name;

function toLineup(roster: Raw): Lineup | null {
  const player = (p: Raw): LineupPlayer => ({
    name: lastName(String(p?.athlete?.displayName ?? "")),
    jersey: String(p?.jersey ?? ""),
    position: String(p?.position?.abbreviation ?? ""),
  });
  const everyone: Raw[] = roster?.roster ?? [];
  const starters = everyone.filter((p) => p?.starter).map(player);
  const shape = String(roster?.formation ?? "").split("-").map(Number);
  // Before the team sheet is out there's nothing to draw, so report nothing rather than guess.
  if (starters.length !== 11 || shape.some((n) => !n) || shape.reduce((a, b) => a + b, 0) !== 10) return null;
  const ordered = [...starters].sort((a, b) => depth(a.position) - depth(b.position));
  const lines: LineupPlayer[][] = [ordered.slice(0, 1)];
  let from = 1;
  for (const size of shape) {
    lines.push(ordered.slice(from, from + size).sort((a, b) => lateral(a.position) - lateral(b.position)));
    from += size;
  }
  return { formation: String(roster.formation), lines, subs: everyone.filter((p) => !p?.starter).map(player) };
}

const kindOf = (e: Raw): EventKind | null => {
  const text = String(e?.type?.text ?? "");
  if (e?.scoringPlay || text.startsWith("Goal") || text.startsWith("Penalty - Scored")) return "goal";
  if (text.includes("Yellow")) return "yellow";
  if (text.includes("Red")) return "red";
  if (text.startsWith("Substitution")) return "sub";
  return null;
};

export function normalizeSummary(data: Raw): MatchDetail {
  const competition = data?.header?.competitions?.[0];
  const competitor = (s: string) => competition?.competitors?.find((c: Raw) => c?.homeAway === s);
  const box = (s: string) => data?.boxscore?.teams?.find((t: Raw) => t?.homeAway === s);
  const roster = (s: string) => data?.rosters?.find((r: Raw) => r?.homeAway === s);
  const nameOf = (s: string) => competitor(s)?.team?.displayName ?? box(s)?.team?.displayName ?? roster(s)?.team?.displayName;
  const homeName = nameOf("home");
  const awayName = nameOf("away");

  const events: MatchEventRow[] = [];
  for (const e of data?.keyEvents ?? []) {
    const kind = kindOf(e);
    if (!kind) continue;
    const team = e?.team?.displayName;
    const names: string[] = (e?.participants ?? []).map((p: Raw) => String(p?.athlete?.displayName ?? "")).filter(Boolean);
    events.push({
      minute: String(e?.clock?.displayValue ?? ""),
      kind,
      side: team === homeName ? "home" : team === awayName ? "away" : null,
      player: names[0] ?? String(e?.shortText ?? ""),
      other: names[1] ?? null,
      at: e?.wallclock ? String(e.wallclock) : null,
    });
  }

  const statOf = (s: string, name: string) => {
    const raw = box(s)?.statistics?.find((x: Raw) => x?.name === name)?.displayValue;
    const value = Number(raw);
    return raw === undefined || raw === "" || Number.isNaN(value) ? null : value;
  };
  const stats: StatRow[] = STAT_ROWS.flatMap(([name, label, share]) => {
    const home = statOf("home", name);
    const away = statOf("away", name);
    return home === null || away === null ? [] : [{ label, home, away, share }];
  });

  const formOf = (name: unknown): FormLetter[] => {
    const games = data?.lastFiveGames?.find((g: Raw) => g?.team?.displayName === name)?.events ?? [];
    return games.flatMap((g: Raw) => FORM[g?.gameResult] ?? []);
  };

  const entries: Raw[] = data?.standings?.groups?.[0]?.standings?.entries ?? [];
  const tableOf = (name: unknown): TableRow | null => {
    const entry = entries.find((x) => x?.team === name);
    if (!entry) return null;
    const stat = (n: string) => Number(entry.stats?.find((x: Raw) => x?.name === n)?.displayValue);
    const row = { rank: stat("rank"), points: stat("points"), played: stat("gamesPlayed") };
    return Object.values(row).some(Number.isNaN) ? null : row;
  };

  const home = toLineup(roster("home"));
  const away = toLineup(roster("away"));
  const state = competition?.status?.type?.state;

  return {
    state: state === "in" || state === "post" ? state : "pre",
    clock: String(competition?.status?.displayClock ?? ""),
    homeScore: Number(competitor("home")?.score) || 0,
    awayScore: Number(competitor("away")?.score) || 0,
    events,
    stats,
    lineups: home && away ? { home, away } : null,
    form: { home: formOf(homeName), away: formOf(awayName) },
    table: { home: tableOf(homeName), away: tableOf(awayName) },
  };
}
