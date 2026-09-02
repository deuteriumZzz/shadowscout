import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  BacktestResult,
  BankrollStatus,
  DigestSettings,
  EquityPoint,
  Pick,
  PlacePickResponse,
  Stats,
} from "@/lib/types";

// Background jobs (bot.py) can change picks/bankroll independent of this
// session — see PRODUCT.md's Operating Context — so these two poll rather
// than trusting a one-time fetch as ground truth.
const LIVE_POLL_MS = 45_000;

export function usePendingPicks() {
  return useQuery({
    queryKey: ["picks", "pending"],
    queryFn: () => api.get<Pick[]>("/api/picks/pending"),
    refetchInterval: LIVE_POLL_MS,
  });
}

export function useHistory(limit = 100) {
  return useQuery({
    queryKey: ["history", limit],
    queryFn: () => api.get<Pick[]>(`/api/history?limit=${limit}`),
  });
}

export function useBankroll() {
  return useQuery({
    queryKey: ["bankroll"],
    queryFn: () => api.get<BankrollStatus | null>("/api/bankroll"),
    refetchInterval: LIVE_POLL_MS,
  });
}

export function useSetBankroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (capital: number) => api.post<BankrollStatus>("/api/bankroll", { capital }),
    onSuccess: (data) => qc.setQueryData(["bankroll"], data),
  });
}

export function useStats(league?: string) {
  return useQuery({
    queryKey: ["stats", league ?? null],
    queryFn: () => api.get<Stats>(`/api/stats${league ? `?league=${encodeURIComponent(league)}` : ""}`),
  });
}

export function useEquityCurve() {
  return useQuery({
    queryKey: ["equity-curve"],
    queryFn: () => api.get<EquityPoint[]>("/api/equity-curve"),
  });
}

export function useBacktest() {
  return useMutation({
    mutationFn: ({ league, season }: { league: string; season: number }) =>
      api.get<BacktestResult>(`/api/backtest?league=${encodeURIComponent(league)}&season=${season}`),
  });
}

export function useDigestSettings() {
  return useQuery({
    queryKey: ["settings", "digest"],
    queryFn: () => api.get<DigestSettings>("/api/settings/digest"),
  });
}

export function useSetDigestSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leagues: string) => api.post<DigestSettings>("/api/settings/digest", { leagues }),
    onSuccess: (data) => qc.setQueryData(["settings", "digest"], data),
  });
}

function removeFromPending(qc: ReturnType<typeof useQueryClient>, pickId: number) {
  qc.setQueryData<Pick[]>(["picks", "pending"], (old) => old?.filter((p) => p.id !== pickId));
}

export function useSkipPick() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pickId: number) => api.post<Pick>(`/api/picks/${pickId}/skip`),
    onSuccess: (_data, pickId) => removeFromPending(qc, pickId),
  });
}

export function usePlacePick() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pickId: number) => api.post<PlacePickResponse>(`/api/picks/${pickId}/place`),
    onSuccess: (_data, pickId) => {
      removeFromPending(qc, pickId);
      qc.invalidateQueries({ queryKey: ["bankroll"] });
    },
  });
}
