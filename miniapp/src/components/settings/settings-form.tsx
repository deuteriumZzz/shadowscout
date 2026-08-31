"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState, LoadingState } from "@/components/status-state";
import { useDigestSettings, useSetDigestSettings } from "@/hooks/use-shadowscout";
import { hapticResult } from "@/lib/telegram";

const KNOWN_LEAGUES = ["АПЛ", "Ла Лига", "Бундеслига", "Серия А", "Лига 1", "Лига чемпионов", "РПЛ"];

export function SettingsForm() {
  const { data, isPending, isError, error, refetch } = useDigestSettings();
  const setDigest = useSetDigestSettings();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setValue(data.leagues ?? "");
  }, [data]);

  if (isPending) return <LoadingState label="Загружаю настройки…" />;
  if (isError) return <ErrorState message={error.message} onRetry={() => refetch()} />;

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
    </div>
  );
}
