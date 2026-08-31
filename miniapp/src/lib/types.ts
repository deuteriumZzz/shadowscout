// Mirrors webapp_api/main.py's JSON shapes, which in turn mirror
// storage.py's `picks` / `bankroll` schema. Keep these two in sync by hand
// — there is no shared schema generator between the Python and TS sides.

export type PickStatus = "pending" | "placed" | "skipped";
export type PickResult = "win" | "loss" | "push" | null;
export type Market = "h2h" | "totals";
export type Confidence = "low" | "medium" | "high";

export interface Pick {
  id: number;
  created_at: string;
  league: string | null;
  match: string;
  market: Market;
  pick: string;
  odds: number | null;
  confidence: Confidence;
  reasoning: string;
  status: PickStatus;
  result: PickResult;
  stake: number | null;
  commence_time: string | null;
  closing_odds: number | null;
  model_probability: number | null;
  poisson_probability: number | null;
  price_verified: 0 | 1;
  recommended_stake: number | null;
}

export interface PlacePickResponse extends Pick {
  browser_opened: boolean;
}

export interface BankrollStatus {
  capital: number;
  peak: number;
  drawdown_pct: number;
  stop_loss_pct: number;
  stopped: boolean;
  drawdown_stopped: boolean;
  clv_gated: boolean;
  clv_gate_avg: number | null;
  suggested_stake: number | null;
}

export interface LeagueBreakdown {
  wins: number;
  losses: number;
}

export interface Stats {
  settled: number;
  wins: number;
  losses: number;
  win_rate: number;
  win_rate_ci: [number, number];
  roi: number;
  weighted_roi: number | null;
  price_verified_pct: number | null;
  by_league: Record<string, LeagueBreakdown>;
  avg_clv: number | null;
  clv_sample: number;
  brier_score: number | null;
  log_loss: number | null;
  calibration_sample: number;
  low_sample: boolean;
}

export interface DigestSettings {
  leagues: string | null;
}

export const MARKET_LABEL: Record<Market, string> = {
  h2h: "1X2",
  totals: "Тоталы",
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  low: "Низкая",
  medium: "Средняя",
  high: "Высокая",
};
