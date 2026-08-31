"use client";

import { AlertTriangle, BarChart3, Check, X } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState, ErrorState, LoadingState } from "@/components/status-state";
import { useStats } from "@/hooks/use-shadowscout";
import { formatPct } from "@/lib/format";

// Fixed status colors (never themed) — see the dataviz skill's reference
// palette. Win/loss is inherently a red/green pair, which fails
// colorblind-separation on hue alone — every place these appear also
// carries an icon + label, never color by itself.
const GOOD = "#0ca30c";
const CRITICAL = "#d03b3b";

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-xl font-semibold">{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

function CustomLegend() {
  return (
    <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground pt-1">
      <span className="inline-flex items-center gap-1">
        <Check className="size-3" style={{ color: GOOD }} /> Победы
      </span>
      <span className="inline-flex items-center gap-1">
        <X className="size-3" style={{ color: CRITICAL }} /> Поражения
      </span>
    </div>
  );
}

export function StatsPanel() {
  const { data, isPending, isError, error, refetch } = useStats();

  if (isPending) return <LoadingState label="Считаю статистику…" />;
  if (isError) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  if (data.settled === 0) {
    return (
      <EmptyState
        icon={<BarChart3 className="size-6 text-muted-foreground" />}
        title="Пока нет закрытых ставок"
        description="Статистика появится после первых settled-пиков — отметьте ставку и дождитесь исхода матча."
      />
    );
  }

  const leagueRows = Object.entries(data.by_league).map(([league, b]) => ({
    league,
    Победы: b.wins,
    Поражения: b.losses,
  }));

  return (
    <div className="p-4 flex flex-col gap-4">
      {data.low_sample && (
        <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-xs text-warning">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>Выборка мала ({data.settled} закрытых) — winrate/ROI пока могут быть шумом.</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="Winrate"
          value={formatPct(data.win_rate)}
          sub={`95% ДИ ${data.win_rate_ci[0].toFixed(0)}–${data.win_rate_ci[1].toFixed(0)}%`}
        />
        <StatTile label="ROI на юнит" value={formatPct(data.roi, { signed: true })} />
        {data.weighted_roi != null && (
          <StatTile label="ROI на стейк" value={formatPct(data.weighted_roi, { signed: true })} />
        )}
        {data.avg_clv != null && (
          <StatTile
            label="Средний CLV"
            value={formatPct(data.avg_clv, { signed: true })}
            sub={`по ${data.clv_sample} рекомендациям`}
          />
        )}
        {data.brier_score != null && (
          <StatTile label="Brier score" value={data.brier_score.toFixed(3)} sub="0 = идеал, 0.25 = монетка" />
        )}
        {data.log_loss != null && <StatTile label="Log-loss" value={data.log_loss.toFixed(3)} />}
      </div>

      {data.price_verified_pct != null && data.price_verified_pct < 100 && (
        <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-xs text-warning">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>
            Цена подтверждена у вашего букмекера только для {data.price_verified_pct.toFixed(0)}% ставок.
          </span>
        </div>
      )}

      {leagueRows.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium mb-3">По лигам</p>
          <ResponsiveContainer width="100%" height={Math.max(120, leagueRows.length * 56)}>
            <BarChart data={leagueRows} layout="vertical" barCategoryGap={12} margin={{ left: 8, right: 16 }}>
              <CartesianGrid horizontal={false} stroke="var(--border)" />
              <XAxis type="number" allowDecimals={false} stroke="var(--muted-foreground)" fontSize={11} />
              <YAxis
                type="category"
                dataKey="league"
                width={90}
                stroke="var(--muted-foreground)"
                fontSize={11}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "var(--popover-foreground)",
                }}
              />
              <Legend content={<CustomLegend />} />
              <Bar dataKey="Победы" fill={GOOD} radius={[4, 4, 4, 4]} maxBarSize={16} />
              <Bar dataKey="Поражения" fill={CRITICAL} radius={[4, 4, 4, 4]} maxBarSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
