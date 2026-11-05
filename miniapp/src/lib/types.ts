// Mirrors shadowscout/api/main.py's JSON shapes, which in turn mirror
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
  xg_probability: number | null;
  price_verified: 0 | 1;
  recommended_stake: number | null;
  line: number | null;
  fair_probability: number | null;
  blended_probability: number | null;
  provider: string | null;
  virtual: 0 | 1;
  final_score: string | null;
  home_logo: string | null;
  away_logo: string | null;
}

export interface AlertSettings {
  kickoff: boolean;
  goals: boolean;
}

export interface ForecastMarket {
  estimate: Record<string, number> | null;
  fair: Record<string, number> | null;
  line: number | null;
  pick: string | null;
  reason: string;
}

export interface ForecastFact {
  text: string;
  status: "confirmed" | "rumour";
  source: string;
  url?: string;
  date: string | null;
  checked: boolean;
}

export interface Forecast {
  id: number;
  created_at: string;
  league: string | null;
  match: string;
  commence_time: string | null;
  provider: string | null;
  home_goals: number | null;
  away_goals: number | null;
  markets: Record<string, ForecastMarket>;
  facts: ForecastFact[];
  facts_dropped: number;
  missing: string[];
  analysis_text: string;
  url: string | null;
  picks: Pick[];
}

export interface ForecastScores {
  forecasts: number;
  model_brier: number | null;
  market_brier: number | null;
  beats_market: boolean | null;
  low_sample: boolean;
  min_sample: number;
}

export interface WalletPosition {
  title: string;
  outcome: string | null;
  status: string;
  avg_price: number | null;
  price: number | null;
  value: number | null;
  cost: number | null;
  pnl: number | null;
  realized_pnl: number | null;
  event_slug: string | null;
  url: string | null;
  end_date: string | null;
}

export type WalletStatus =
  | { connected: false }
  | {
      connected: true;
      address: string;
      name: string;
      // null everywhere below means "couldn't be read", never zero.
      cash: number | null;
      positions_value: number | null;
      total: number | null;
      unrealized_pnl: number | null;
      positions: WalletPosition[] | null;
      closed: WalletPosition[] | null;
      truncated: boolean;
      errors: string[];
      updated_at: string;
    };

export interface Limits {
  daily_limit: number;
  loss_today: number;
  paused_until: string | null;
  reason: string | null;
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

export interface EquityPoint {
  date: string;
  cumulative_units: number;
  cumulative_currency: number;
}

export interface BacktestResult {
  n: number;
  brier: number | null;
  hit_rate: number | null;
  league_id: number | null;
}
