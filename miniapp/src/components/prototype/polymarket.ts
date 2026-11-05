// Real upcoming football matches and prices from Polymarket's public API. Pure,
// so engine.check.mjs can run it. A match with incomplete or ambiguous data is
// dropped rather than guessed at: these prices lead to a real bet.

export const PM_LEAGUES = [
  { slug: "epl", label: "Premier League" },
  { slug: "la-liga", label: "La Liga" },
  { slug: "bundesliga", label: "Bundesliga" },
  { slug: "sea", label: "Serie A" },
  { slug: "ligue-1", label: "Ligue 1" },
  { slug: "ucl", label: "Champions League" },
] as const;

export interface LiveTeam {
  name: string;
  logo: string;
  color: string | null;
}

export interface LiveOption {
  id: "1" | "x" | "2";
  title: string;
  /** Price to buy now, in dollars per share: also the market's implied probability. */
  price: number;
  /** Decimal odds after the taker fee: what a bettor really gets. */
  odds: number;
  available: number;
}

/** The linked game in the score feed, when one was found with confidence. */
export interface ScoreLink {
  id: string;
  code: string;
  state: "pre" | "in" | "post";
  clock: string;
  homeScore: number;
  awayScore: number;
  homeForm: ("win" | "draw" | "loss")[];
  awayForm: ("win" | "draw" | "loss")[];
}

export interface LiveMatch {
  espn?: ScoreLink;
  id: string;
  url: string;
  league: string;
  start: string;
  volume: number;
  home: LiveTeam;
  away: LiveTeam;
  options: LiveOption[];
}

interface RawTeam {
  name?: string;
  logo?: string;
  color?: string;
  ordering?: string;
}

interface RawMarket {
  groupItemTitle?: string;
  sportsMarketType?: string;
  bestAsk?: number;
  liquidityNum?: number;
  acceptingOrders?: boolean;
  feesEnabled?: boolean;
  feeSchedule?: { rate?: number };
}

export interface RawEvent {
  id?: string | number;
  slug?: string;
  title?: string;
  startTime?: string;
  volume?: string | number;
  teams?: RawTeam[];
  markets?: RawMarket[];
}

/** Polymarket's fee is rate × p × (1−p) per share, so a share really costs p plus that. */
export function oddsAfterFee(price: number, feeRate: number) {
  return 1 / (price + feeRate * price * (1 - price));
}

/** How long after kick-off a match stays listed: it's live, so it matters more, not less. */
export const STARTED_WINDOW_MS = 3 * 3_600_000;

const shortName = (name: string) => name.replace(/\s+(FC|AFC|CF|SC)$/, "").trim();

const toTeam = (t: RawTeam): LiveTeam | null =>
  t.name && t.logo ? { name: shortName(t.name), logo: t.logo, color: t.color ?? null } : null;

export function normalizeEvent(event: RawEvent, league: string, now: number): LiveMatch | null {
  const { title = "", slug, startTime, teams = [], markets = [] } = event;
  // The main match only: props are separate events titled "A vs. B - Total Corners".
  if (!slug || !startTime || !title.includes(" vs") || title.includes(" - ")) return null;
  if (!(Date.parse(startTime) > now - STARTED_WINDOW_MS)) return null;

  const rawHome = teams.find((t) => t.ordering === "home");
  const rawAway = teams.find((t) => t.ordering === "away");
  const home = rawHome && toTeam(rawHome);
  const away = rawAway && toTeam(rawAway);
  if (!home || !away || !rawHome || !rawAway) return null;

  const results = markets.filter((m) => m.sportsMarketType === "moneyline");
  const pick = (test: (name: string) => boolean) => results.filter((m) => test(m.groupItemTitle ?? ""));
  const slots: [LiveOption["id"], string, RawMarket[]][] = [
    ["1", `Победа ${home.name}`, pick((n) => n === rawHome.name)],
    ["x", "Ничья", pick((n) => n.startsWith("Draw"))],
    ["2", `Победа ${away.name}`, pick((n) => n === rawAway.name)],
  ];

  const options: LiveOption[] = [];
  for (const [id, optionTitle, found] of slots) {
    const market = found[0];
    const price = market?.bestAsk;
    if (found.length !== 1 || !market?.acceptingOrders || !price || price <= 0 || price >= 1) return null;
    const rate = market.feesEnabled ? (market.feeSchedule?.rate ?? 0) : 0;
    options.push({ id, title: optionTitle, price, odds: oddsAfterFee(price, rate), available: market.liquidityNum ?? 0 });
  }

  return {
    id: String(event.id ?? slug),
    url: `https://polymarket.com/event/${slug}`,
    league,
    start: startTime,
    volume: Number(event.volume) || 0,
    home,
    away,
    options,
  };
}
