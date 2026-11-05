"use client";

import { useState } from "react";
import { ForecastsView } from "@/features/forecast/forecast";
import { getWebApp } from "@/lib/telegram";
import { Segmented } from "@/ui/controls";
import { MarketsView } from "./matches-view";

type FeedView = "matches" | "picks";

/** Real matches first, then what the forecast made of them. */
export function BetsScreen() {
  // A bot message can link straight to the forecasts: t.me/<bot>/app?startapp=pick_1
  const [view, setView] = useState<FeedView>(() => {
    const tg = getWebApp() as unknown as { initDataUnsafe?: { start_param?: string } } | undefined;
    return tg?.initDataUnsafe?.start_param?.startsWith("pick_") ? "picks" : "matches";
  });
  return (
    <>
      <div className="pn-feedbar">
        <Segmented<FeedView>
          label="Раздел ставок"
          value={view}
          onChange={setView}
          options={[{ id: "matches", label: "Матчи" }, { id: "picks", label: "Прогнозы" }]}
        />
      </div>
      {view === "matches" ? <MarketsView /> : <ForecastsView />}
    </>
  );
}
