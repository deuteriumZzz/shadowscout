"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Check, Clock, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { CONFIDENCE_LABEL, MARKET_LABEL, type Pick } from "@/lib/types";
import {
  formatDateTime,
  formatMoney,
  formatOdds,
  formatProbability,
  formatRelativeKickoff,
  pickOutcomeLabel,
  POISSON_DIVERGENCE_FLAG,
} from "@/lib/format";
import { haptic, hapticResult } from "@/lib/telegram";
import { usePlacePick, useSkipPick } from "@/hooks/use-shadowscout";

export function PickCard({ pick }: { pick: Pick }) {
  const place = usePlacePick();
  const skip = useSkipPick();
  const [error, setError] = useState<string | null>(null);
  const busy = place.isPending || skip.isPending;

  const diverges =
    pick.model_probability != null &&
    pick.poisson_probability != null &&
    Math.abs(pick.model_probability - pick.poisson_probability) > POISSON_DIVERGENCE_FLAG;

  async function handlePlace() {
    setError(null);
    haptic("medium");
    try {
      await place.mutateAsync(pick.id);
      hapticResult("success");
    } catch (e) {
      hapticResult("error");
      setError(e instanceof Error ? e.message : "Не удалось отметить ставку");
    }
  }

  async function handleSkip() {
    setError(null);
    haptic("light");
    try {
      await skip.mutateAsync(pick.id);
    } catch (e) {
      hapticResult("error");
      setError(e instanceof Error ? e.message : "Не удалось пропустить");
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 400, damping: 32 }}
      className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {pick.league && (
            <Badge variant="secondary" className="text-xs">
              {pick.league}
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            {MARKET_LABEL[pick.market]}
          </Badge>
        </div>
        {pick.commence_time && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <Clock className="size-3" />
            <span>{formatRelativeKickoff(pick.commence_time)}</span>
          </div>
        )}
      </div>

      <div>
        <p className="font-medium leading-tight">{pick.match}</p>
        {pick.commence_time && (
          <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(pick.commence_time)}</p>
        )}
      </div>

      <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2">
        <span className="text-sm font-medium">{pickOutcomeLabel(pick)}</span>
        <div className="flex items-center gap-1.5 font-mono tabular-nums text-base font-semibold">
          {formatOdds(pick.odds)}
          {!pick.price_verified && (
            <AlertTriangle
              className="size-3.5 text-warning"
              aria-label="Лучшая цена по рынку, не подтверждена у вашего букмекера"
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Уверенность: {CONFIDENCE_LABEL[pick.confidence]}</span>
        <span className="font-mono tabular-nums">
          Модель: {formatProbability(pick.model_probability)}
        </span>
        {pick.poisson_probability != null && (
          <span className="font-mono tabular-nums flex items-center gap-1">
            Пуассон: {formatProbability(pick.poisson_probability)}
            {diverges && (
              <AlertTriangle className="size-3 text-warning" aria-label="Расхождение с моделью Пуассона" />
            )}
          </span>
        )}
      </div>

      {pick.reasoning && (
        <p className="text-xs text-muted-foreground line-clamp-2">{pick.reasoning}</p>
      )}

      {pick.recommended_stake != null && (
        <p className="text-sm">
          Ставка: <span className="font-mono tabular-nums font-medium">{formatMoney(pick.recommended_stake)}</span>
        </p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2 pt-1">
        <motion.button
          whileTap={{ scale: 0.96 }}
          disabled={busy}
          onClick={handlePlace}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground h-11 text-sm font-medium disabled:opacity-50"
        >
          <Check className="size-4" /> Ставлю
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.96 }}
          disabled={busy}
          onClick={handleSkip}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-secondary text-secondary-foreground h-11 text-sm font-medium disabled:opacity-50"
        >
          <X className="size-4" /> Пропускаю
        </motion.button>
      </div>
    </motion.div>
  );
}
