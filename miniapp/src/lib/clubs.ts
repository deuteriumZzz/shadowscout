// Logos for leagues and the few clubs without one from a data feed.

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
  "Ligue 1": 61,
  "Champions League": 2,
};

const CDN = "https://media.api-sports.io/football";

/** Null for a club we hold no id for, so nothing asks the CDN for a logo that can't exist. */
export const teamLogo = (team: string): string | null => (TEAM_ID[team] ? `${CDN}/teams/${TEAM_ID[team]}.png` : null);
export const leagueLogo = (league: string) => `${CDN}/leagues/${LEAGUE_ID[league]}.png`;

export type FormResult = "win" | "draw" | "loss";
