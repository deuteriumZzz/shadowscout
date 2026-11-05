"use client";

import { motion } from "framer-motion";
import { WalletSettings } from "@/features/wallet/wallet";
import { useAlertSettings, useDigestSettings, useSetAlertSettings, useSetDigestSettings } from "@/hooks/use-shadowscout";
import { useGame, type ThemeChoice } from "@/store/app-store";
import { Chip, Segmented, Switch } from "@/ui/controls";
import { LeagueLogo } from "@/ui/football";
import { KeepyUppy } from "@/ui/keepy-uppy";
import { M } from "@/ui/motion";
import { BacktestPanel } from "./backtest-panel";
import { ConnectionsSection } from "./connections";

const ALL_LEAGUES = ["Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1", "Champions League"];

/** Real messages from the bot about matches you hold a bet on. The final always comes. */
function Alerts() {
  const { data, isError } = useAlertSettings();
  const save = useSetAlertSettings();
  if (isError || !data) return null;
  return (
    <section className="pn-panel pn-panel--flat">
      <h2 className="pn-h2">Сообщения в Telegram</h2>
      <Switch label="Начало матча со ставкой" on={data.kickoff} onToggle={() => save.mutate({ kickoff: !data.kickoff })} />
      <Switch label="Голы в матчах со ставкой" on={data.goals} onToggle={() => save.mutate({ goals: !data.goals })} />
      <p className="pn-small pn-muted">Финал приходит всегда. Сообщения отправляет бот, он должен быть запущен.</p>
    </section>
  );
}

function Digest() {
  const { data, isError } = useDigestSettings();
  const save = useSetDigestSettings();
  if (isError || !data) return null;
  const chosen = (data.leagues ?? "").split(",").map((l) => l.trim()).filter(Boolean);
  const toggle = (name: string) => save.mutate((chosen.includes(name) ? chosen.filter((l) => l !== name) : [...chosen, name]).join(", "));
  return (
    <section className="pn-panel pn-panel--flat">
      <h2 className="pn-h2">Лиги в дайджесте</h2>
      <div className="pn-chips pn-chips--wrap">
        {ALL_LEAGUES.map((name) => (
          <Chip key={name} active={chosen.includes(name)} onClick={() => toggle(name)}>
            <LeagueLogo league={name} size={13} /> {name}
          </Chip>
        ))}
      </div>
    </section>
  );
}

export function SettingsScreen() {
  const { state, dispatch } = useGame();

  return (
    <div className="pn-screen">
      <WalletSettings />
      <ConnectionsSection />
      <Alerts />
      <Digest />
      <BacktestPanel />

      <section className="pn-panel pn-panel--flat">
        <h2 className="pn-h2">Интерфейс</h2>
        <Segmented<string>
          label="Валюта"
          value={state.currency}
          onChange={(currency) => dispatch({ type: "SET_CURRENCY", currency })}
          options={[{ id: "$", label: "$" }, { id: "€", label: "€" }, { id: "₽", label: "₽" }]}
        />
        <Segmented<ThemeChoice>
          label="Тема"
          value={state.theme}
          onChange={(theme) => dispatch({ type: "SET_THEME", theme })}
          options={[{ id: "auto", label: "Как в Telegram" }, { id: "light", label: "Светлая" }, { id: "dark", label: "Тёмная" }]}
        />
        <Switch label="Меньше анимации" hint="Без движения и эффектов" on={state.calm} onToggle={() => dispatch({ type: "SET_CALM", on: !state.calm })} />
      </section>

      <section className="pn-panel pn-panel--flat">
        <h2 className="pn-h2">Перерыв: чеканка</h2>
        <KeepyUppy />
      </section>

      <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "ONBOARDING", show: true })}>Показать мастер первого запуска</motion.button>
    </div>
  );
}
