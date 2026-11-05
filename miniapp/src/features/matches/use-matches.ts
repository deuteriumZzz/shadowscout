import { useQuery } from "@tanstack/react-query";
import type { LiveMatch } from "@/lib/feeds/polymarket";

const REFRESH_MS = 30_000;

async function fetchMatches(): Promise<{ matches: LiveMatch[]; partial: boolean }> {
  const response = await fetch("/feed/matches");
  if (!response.ok) throw new Error("Не удалось загрузить матчи");
  return response.json();
}

export function useMatches() {
  return useQuery({
    queryKey: ["polymarket-matches"],
    queryFn: fetchMatches,
    refetchInterval: REFRESH_MS,
    staleTime: 15_000,
    retry: 1,
  });
}
