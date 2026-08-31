import type { Pick } from "@/lib/types";

// analysis.py's own divergence flag — surfaced when the LLM's stated
// probability and the independent Poisson model disagree by more than
// this (see analysis.py's POISSON_DIVERGENCE_FLAG).
export const POISSON_DIVERGENCE_FLAG = 0.15;

export function pickOutcomeLabel(p: Pick): string {
  const [teamA, teamB] = p.match.split(" - ").map((s) => s.trim());
  if (p.market === "h2h") {
    if (p.pick === "home") return `П1 · ${teamA ?? ""}`;
    if (p.pick === "away") return `П2 · ${teamB ?? ""}`;
    if (p.pick === "draw") return "X · Ничья";
  }
  if (p.market === "totals") {
    if (p.pick === "over") return "Тотал Больше";
    if (p.pick === "under") return "Тотал Меньше";
  }
  return p.pick;
}

export function formatOdds(odds: number | null): string {
  return odds == null ? "—" : odds.toFixed(2);
}

export function formatPct(value: number | null, opts: { signed?: boolean } = {}): string {
  if (value == null) return "—";
  const sign = opts.signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function formatProbability(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

export function formatMoney(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatRelativeKickoff(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = d.getTime() - Date.now();
  const diffH = diffMs / 3_600_000;
  if (diffH < 0) return "уже началось";
  if (diffH < 1) return `через ${Math.round(diffH * 60)} мин`;
  if (diffH < 24) return `через ${Math.round(diffH)} ч`;
  return `через ${Math.round(diffH / 24)} дн`;
}
