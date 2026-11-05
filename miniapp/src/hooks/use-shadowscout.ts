import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  AlertSettings,
  BacktestResult,
  BankrollStatus,
  DigestSettings,
  EquityPoint,
  Forecast,
  ForecastScores,
  Limits,
  Pick,
  PlacePickResponse,
  Stats,
  WalletStatus,
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
    refetchInterval: LIVE_POLL_MS,
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

export function useAlertSettings() {
  return useQuery({ queryKey: ["settings", "alerts"], queryFn: () => api.get<AlertSettings>("/api/settings/alerts"), retry: false });
}

export function useSetAlertSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<AlertSettings>) => api.post<AlertSettings>("/api/settings/alerts", body),
    onSuccess: (data) => qc.setQueryData(["settings", "alerts"], data),
  });
}

const WALLET_POLL_MS = 30_000;

export function useWallet() {
  return useQuery({
    queryKey: ["wallet"],
    queryFn: () => api.get<WalletStatus>("/api/wallet"),
    refetchInterval: WALLET_POLL_MS,
    retry: false,
  });
}

export function useConnectWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (address: string) => api.post<WalletStatus>("/api/wallet", { address }),
    onSuccess: (data) => qc.setQueryData(["wallet"], data),
  });
}

export function useDisconnectWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<WalletStatus>("/api/wallet/delete"),
    onSuccess: (data) => qc.setQueryData(["wallet"], data),
  });
}

export function useOpenPicks() {
  return useQuery({
    queryKey: ["picks", "open"],
    queryFn: () => api.get<Pick[]>("/api/picks/open"),
    refetchInterval: LIVE_POLL_MS,
  });
}

export function useAcceptPick() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pickId: number) => api.post<Pick>(`/api/picks/${pickId}/accept`),
    onSuccess: (data, pickId) => {
      removeFromPending(qc, pickId);
      // At once, so the buttons turn into "accepted" with the tap rather than after a refetch.
      qc.setQueryData<Forecast[]>(["forecasts"], (old) =>
        old?.map((f) => ({ ...f, picks: f.picks.map((p) => (p.id === pickId ? data : p)) })),
      );
      qc.invalidateQueries({ queryKey: ["forecasts"] });
      qc.invalidateQueries({ queryKey: ["picks", "open"] });
    },
  });
}

export function useForecasts() {
  return useQuery({
    queryKey: ["forecasts"],
    queryFn: () => api.get<Forecast[]>("/api/forecasts"),
    refetchInterval: LIVE_POLL_MS,
    retry: false,
  });
}

export function useMakeForecast() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["forecast"],
    mutationFn: (body: { home: string; away: string; league: string }) => api.post<Forecast>("/api/forecast", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forecasts"] });
      qc.invalidateQueries({ queryKey: ["picks", "pending"] });
    },
  });
}

export function useForecastScores() {
  return useQuery({
    queryKey: ["forecast-scores"],
    queryFn: () => api.get<ForecastScores>("/api/forecast-scores"),
  });
}

export function useLimits() {
  return useQuery({
    queryKey: ["limits"],
    queryFn: () => api.get<Limits>("/api/limits"),
    refetchInterval: LIVE_POLL_MS,
  });
}

export function useSetLimits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { daily_limit?: number; pause?: boolean }) => api.post<Limits>("/api/limits", body),
    onSuccess: (data) => qc.setQueryData(["limits"], data),
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
