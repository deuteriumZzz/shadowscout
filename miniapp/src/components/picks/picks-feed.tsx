"use client";

import { AnimatePresence } from "framer-motion";
import { Target } from "lucide-react";
import { usePendingPicks } from "@/hooks/use-shadowscout";
import { EmptyState, ErrorState, LoadingState } from "@/components/status-state";
import { PickCard } from "@/components/picks/pick-card";

export function PicksFeed() {
  const { data, isPending, isError, error, refetch } = usePendingPicks();

  if (isPending) return <LoadingState label="Загружаю рекомендации…" />;
  if (isError) return <ErrorState message={error.message} onRetry={() => refetch()} />;
  if (data.length === 0) {
    return (
      <EmptyState
        icon={<Target className="size-6 text-muted-foreground" />}
        title="Нет активных рекомендаций"
        description="Как только бот найдёт edge против рынка по /match, /league или дайджесту — пик появится здесь."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <AnimatePresence mode="popLayout">
        {data.map((pick) => (
          <PickCard key={pick.id} pick={pick} />
        ))}
      </AnimatePresence>
    </div>
  );
}
