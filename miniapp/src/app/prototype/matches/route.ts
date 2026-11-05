import { ESPN_CODES, findGame, normalizeScoreboard, type EspnGame } from "@/components/prototype/espn";
import { normalizeEvent, PM_LEAGUES, STARTED_WINDOW_MS, type LiveMatch, type RawEvent } from "@/components/prototype/polymarket";

const GAMMA = "https://gamma-api.polymarket.com/events";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const CACHE_SECONDS = 20;
// ESPN takes one date per request and its days don't quite follow UTC, so ask from yesterday.
const SCORE_DAYS = [-1, 0, 1, 2, 3];

async function leagueMatches(slug: string, label: string, now: number): Promise<LiveMatch[]> {
  const query = new URLSearchParams({
    tag_slug: slug,
    closed: "false",
    active: "true",
    limit: "100",
    order: "endDate",
    ascending: "true",
    end_date_min: new Date(now - STARTED_WINDOW_MS).toISOString().slice(0, 19) + "Z",
  });
  const response = await fetch(`${GAMMA}?${query}`, { next: { revalidate: CACHE_SECONDS } });
  if (!response.ok) throw new Error(`Polymarket answered ${response.status}`);
  const events = (await response.json()) as RawEvent[];
  return events.flatMap((e) => normalizeEvent(e, label, now) ?? []);
}

async function leagueGames(league: string, now: number): Promise<EspnGame[]> {
  const code = ESPN_CODES[league];
  const days = await Promise.allSettled(
    SCORE_DAYS.map(async (offset) => {
      const date = new Date(now + offset * 86_400_000).toISOString().slice(0, 10).replaceAll("-", "");
      const response = await fetch(`${ESPN}/${code}/scoreboard?dates=${date}`, { next: { revalidate: CACHE_SECONDS } });
      if (!response.ok) throw new Error(`ESPN answered ${response.status}`);
      return normalizeScoreboard(await response.json(), code, league);
    }),
  );
  const byId = new Map<string, EspnGame>();
  for (const day of days) if (day.status === "fulfilled") for (const game of day.value) byId.set(game.id, game);
  return [...byId.values()];
}

const linkOf = (g: EspnGame): NonNullable<LiveMatch["espn"]> => ({
  id: g.id,
  code: g.code,
  state: g.state,
  clock: g.clock,
  homeScore: g.home.score,
  awayScore: g.away.score,
  homeForm: g.home.form,
  awayForm: g.away.form,
});

/** A match on right now with no open market still belongs in the list, just without prices. */
const scoreOnly = (g: EspnGame): LiveMatch => ({
  id: `espn-${g.id}`,
  url: "",
  league: g.league,
  start: g.start,
  volume: 0,
  home: { name: g.home.name, logo: g.home.logo, color: null },
  away: { name: g.away.name, logo: g.away.logo, color: null },
  options: [],
  espn: linkOf(g),
});

/** A thin server-side proxy: one cached call per league, however many screens are open. */
export async function GET() {
  const now = Date.now();
  const settled = await Promise.allSettled(PM_LEAGUES.map((l) => leagueMatches(l.slug, l.label, now)));
  const failed = settled.filter((s) => s.status === "rejected").length;
  if (failed === PM_LEAGUES.length) {
    return Response.json({ error: "Polymarket недоступен" }, { status: 502 });
  }
  const byId = new Map<string, LiveMatch>();
  for (const result of settled) {
    if (result.status === "fulfilled") for (const match of result.value) byId.set(match.id, match);
  }
  // Scores are a bonus on top of prices: if ESPN fails, the matches still show.
  const scoreResults = await Promise.allSettled(PM_LEAGUES.map((l) => leagueGames(l.label, now)));
  const games = scoreResults.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const linked = new Set<string>();
  const matches: LiveMatch[] = [...byId.values()].map((match) => {
    const game = findGame(games.filter((g) => g.league === match.league), match.home.name, match.away.name, match.start);
    if (!game) return match;
    linked.add(game.id);
    return { ...match, espn: linkOf(game) };
  });
  for (const game of games) if (game.state === "in" && !linked.has(game.id)) matches.push(scoreOnly(game));
  const finished = (m: LiveMatch) => m.espn?.state === "post";
  const live = (m: LiveMatch) => m.espn?.state === "in";
  const visible = matches.filter((m) => !finished(m));
  visible.sort((a, b) => Number(live(b)) - Number(live(a)) || Date.parse(a.start) - Date.parse(b.start));
  return Response.json({ matches: visible, partial: failed > 0 || scoreResults.some((r) => r.status === "rejected") });
}
