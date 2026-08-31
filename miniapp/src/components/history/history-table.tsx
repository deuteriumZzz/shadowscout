"use client";

import { Check, History, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/status-state";
import { useHistory } from "@/hooks/use-shadowscout";
import { formatDateTime, formatMoney, formatOdds, pickOutcomeLabel } from "@/lib/format";
import { MARKET_LABEL, type PickResult } from "@/lib/types";

function ResultBadge({ result }: { result: PickResult }) {
  if (result === "win") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: "#0ca30c" }}>
        <Check className="size-3.5" /> Win
      </span>
    );
  }
  if (result === "loss") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: "#d03b3b" }}>
        <X className="size-3.5" /> Loss
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">Push</span>;
}

export function HistoryTable() {
  const { data, isPending, isError, error, refetch } = useHistory();

  if (isPending) return <LoadingState label="Загружаю историю…" />;
  if (isError) return <ErrorState message={error.message} onRetry={() => refetch()} />;
  if (data.length === 0) {
    return (
      <EmptyState
        icon={<History className="size-6 text-muted-foreground" />}
        title="История пуста"
        description="Здесь появятся ставки, которые вы отметили «Ставлю» и по которым уже известен исход."
      />
    );
  }

  return (
    <div className="p-4">
      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Матч</TableHead>
              <TableHead>Пик</TableHead>
              <TableHead className="text-right">Кэф</TableHead>
              <TableHead className="text-right">Стейк</TableHead>
              <TableHead>Итог</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((pick) => (
              <TableRow key={pick.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{pick.match}</span>
                    <span className="text-xs text-muted-foreground">
                      {pick.league ?? "—"} · {MARKET_LABEL[pick.market]} · {formatDateTime(pick.commence_time)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-sm">{pickOutcomeLabel(pick)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatOdds(pick.odds)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatMoney(pick.stake)}</TableCell>
                <TableCell>
                  <ResultBadge result={pick.result} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground mt-2 px-1">Всего: {data.length}</p>
    </div>
  );
}
