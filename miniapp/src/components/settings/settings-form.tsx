"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState, LoadingState } from "@/components/status-state";
import { useBacktest, useDigestSettings, useSetDigestSettings } from "@/hooks/use-shadowscout";
import { hapticResult } from "@/lib/telegram";
import { formatPct } from "@/lib/format";

const KNOWN_LEAGUES = ["АПЛ", "Ла Лига", "Бундеслига", "Серия А", "Лига 1", "Лига чемпионов", "РПЛ"];

// European club seasons start July/August — API-Football's "season" is the
// year it started (2025 for 2025/26), same convention xg_model.py uses.
function currentSeasonYear(): number {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

function BacktestPanel() {
  const [league, setLeague] = useState(KNOWN_LEAGUES[0]);
  const [season, setSeason] = useState(currentSeasonYear());
  const backtest = useBacktest();

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium">Бэктест Пуассон-модели</p>
        <p className="text-xs text-muted-foreground mt-1">
          Прогоняет модель по всем завершённым матчам лиги за сезон — быстрая проверка,
          есть ли у неё вообще предсказательная сила, без ожидания недель живой статистики.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {KNOWN_LEAGUES.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLeague(l)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              league === l ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="backtest-season">Сезон (год начала, напр. 2025 = 2025/26)</Label>
        <Input
          id="backtest-season"
          type="number"
          value={season}
          onChange={(e) => setSeason(Number(e.target.value))}
        />
      </div>

      <Button onClick={() => backtest.mutate({ league, season })} disabled={backtest.isPending} className="w-full">
        {backtest.isPending ? "Считаю…" : "Запустить бэктест"}
      </Button>

      {backtest.isError && <ErrorState message={backtest.error.message} onRetry={() => backtest.mutate({ league, season })} />}

      {backtest.data && (
        backtest.data.league_id === null ? (
          <p className="text-xs text-warning">Лига «{league}» не найдена в API-Football.</p>
        ) : backtest.data.n === 0 ? (
          <p className="text-xs text-muted-foreground">
            Нет матчей с достаточной историей для прогноза — попробуйте другой сезон.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3 pt-1">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Матчей</span>
              <span className="font-mono tabular-nums text-lg font-semibold">{backtest.data.n}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Hit rate</span>
              <span className="font-mono tabular-nums text-lg font-semibold">
                {formatPct(backtest.data.hit_rate! * 100)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Brier</span>
              <span className="font-mono tabular-nums text-lg font-semibold">{backtest.data.brier!.toFixed(3)}</span>
            </div>
          </div>
        )
      )}
    </div>
  );
}

export function SettingsForm() {
  const { data, isPending, isError, error, refetch } = useDigestSettings();

  if (isPending) return <LoadingState label="Загружаю настройки…" />;
  if (isError) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  return <DigestSettingsEditor initialValue={data?.leagues ?? ""} />;
}

function DigestSettingsEditor({ initialValue }: { initialValue: string }) {
  const setDigest = useSetDigestSettings();
  const [value, setValue] = useState(initialValue);
  const [saved, setSaved] = useState(false);

  function toggleLeague(league: string) {
    const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
    const idx = parts.indexOf(league);
    if (idx >= 0) parts.splice(idx, 1);
    else parts.push(league);
    setValue(parts.join(", "));
  }

  const selected = new Set(value.split(",").map((s) => s.trim()).filter(Boolean));

  async function handleSave() {
    setSaved(false);
    try {
      await setDigest.mutateAsync(value);
      hapticResult("success");
      setSaved(true);
    } catch {
      hapticResult("error");
    }
  }

  return (
    <div className="p-4 flex flex-col gap-6">
      <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium">Лиги дайджеста</p>
          <p className="text-xs text-muted-foreground mt-1">
            Каждую пятницу в 09:00 UTC бот сам сканирует эти лиги и присылает подборку с value.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {KNOWN_LEAGUES.map((league) => (
            <button
              key={league}
              type="button"
              onClick={() => toggleLeague(league)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                selected.has(league)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              {league}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="digest-leagues">Или список вручную (через запятую)</Label>
          <Input
            id="digest-leagues"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Ла Лига, АПЛ"
          />
        </div>

        <Button onClick={handleSave} disabled={setDigest.isPending} className="w-full">
          Сохранить
        </Button>
        {saved && <p className="text-xs text-primary text-center">Сохранено</p>}
      </div>

      <BacktestPanel />
    </div>
  );
}
