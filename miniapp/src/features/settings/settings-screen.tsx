"use client";

import { motion } from "framer-motion";
import { Banknote, Bell, CircleDot, Database, History, List, Palette, Rocket, Sparkles } from "lucide-react";
import { WalletRow } from "@/features/wallet/wallet";
import { useAlertSettings, useDigestSettings, useSetAlertSettings, useSetDigestSettings } from "@/hooks/use-shadowscout";
import { errorText } from "@/lib/labels";
import { useGame, type ThemeChoice } from "@/store/app-store";
import { Chip, Segmented, SheetRow, Switch } from "@/ui/controls";
import { LeagueLogo } from "@/ui/football";
import { KeepyUppy } from "@/ui/keepy-uppy";
import { M } from "@/ui/motion";
import { BacktestPanel } from "./backtest-panel";
import { DataConnections, ModelConnections, useConnections } from "./connections";

const ALL_LEAGUES = ["Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1", "Champions League"];

/** Real messages from the bot about matches you hold a bet on. The final always comes. */
function Alerts() {
  const { data, isError, error } = useAlertSettings();
  const save = useSetAlertSettings();
  if (isError) return <p className="pn-small pn-muted">{errorText(error)}</p>;
  if (!data) return null;
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
  const { data, isError, error } = useDigestSettings();
  const save = useSetDigestSettings();
  if (isError) return <p className="pn-small pn-muted">{errorText(error)}</p>;
  if (!data) return null;
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

const THEME_NAME: Record<ThemeChoice, string> = { auto: "как в Telegram", light: "светлая", dark: "тёмная" };

function ModelRow() {
  const { data, loading, isError } = useConnections();
  const primary = data.items.find((i) => i.name === data.primary && i.connected);
  return (
    <SheetRow
      icon={<Sparkles size={17} aria-hidden="true" />}
      tint="#6d4bd8"
      label="Модель"
      value={isError ? "нет данных" : loading ? "" : primary?.label ?? "не подключена"}
      tone={!isError && !loading && !primary ? "var(--warn)" : undefined}
    >
      <ModelConnections />
    </SheetRow>
  );
}

function DataRow() {
  const { data, loading, isError } = useConnections();
  const sources = data.items.filter((i) => i.group !== "llm");
  return (
    <SheetRow icon={<Database size={17} aria-hidden="true" />} tint="#1c7bc4" label="Данные" value={isError ? "нет данных" : loading ? "" : `${sources.filter((i) => i.connected).length} из ${sources.length}`}>
      <DataConnections />
    </SheetRow>
  );
}

function AlertsRow() {
  const { data, isError } = useAlertSettings();
  const value = isError ? "нет данных" : !data ? "" : data.kickoff || data.goals ? "включены" : "только финал";
  return <SheetRow icon={<Bell size={17} aria-hidden="true" />} tint="#d9534a" label="Telegram" title="Сообщения в Telegram" value={value}><Alerts /></SheetRow>;
}

function DigestRow() {
  const { data, isError } = useDigestSettings();
  const value = isError ? "нет данных" : !data ? "" : String((data.leagues ?? "").split(",").filter((l) => l.trim()).length);
  return <SheetRow icon={<List size={17} aria-hidden="true" />} tint="#5b6b63" label="Лиги в дайджесте" value={value}><Digest /></SheetRow>;
}

export function SettingsScreen() {
  const { state, dispatch } = useGame();

  return (
    <div className="pn-screen">
      <h2 className="pn-listcap">Прогнозы</h2>
      <div className="pn-list">
        <ModelRow />
        <DataRow />
        <SheetRow icon={<History size={17} aria-hidden="true" />} tint="#0f8f74" label="Проверка на истории"><BacktestPanel /></SheetRow>
      </div>

      <h2 className="pn-listcap">Деньги</h2>
      <div className="pn-list">
        <WalletRow />
        <SheetRow icon={<Banknote size={17} aria-hidden="true" />} tint="#946a00" label="Валюта" value={state.currency}>
          <h2 className="pn-h2">Валюта</h2>
          <Segmented<string>
            label="Валюта"
            value={state.currency}
            onChange={(currency) => dispatch({ type: "SET_CURRENCY", currency })}
            options={[{ id: "$", label: "$" }, { id: "€", label: "€" }, { id: "₽", label: "₽" }]}
          />
        </SheetRow>
      </div>

      <h2 className="pn-listcap">Сообщения</h2>
      <div className="pn-list">
        <AlertsRow />
        <DigestRow />
      </div>

      <h2 className="pn-listcap">Вид</h2>
      <div className="pn-list">
        <SheetRow icon={<Palette size={17} aria-hidden="true" />} tint="#c98a12" label="Тема и анимация" value={THEME_NAME[state.theme]}>
          <h2 className="pn-h2">Тема и анимация</h2>
          <Segmented<ThemeChoice>
            label="Тема"
            value={state.theme}
            onChange={(theme) => dispatch({ type: "SET_THEME", theme })}
            options={[{ id: "auto", label: "Как в Telegram" }, { id: "light", label: "Светлая" }, { id: "dark", label: "Тёмная" }]}
          />
          <Switch label="Меньше анимации" hint="Без движения и эффектов" on={state.calm} onToggle={() => dispatch({ type: "SET_CALM", on: !state.calm })} />
        </SheetRow>
        <SheetRow icon={<CircleDot size={17} aria-hidden="true" />} tint="#3f7d4f" label="Перерыв: чеканка">
          <h2 className="pn-h2">Перерыв: чеканка</h2>
          <KeepyUppy />
        </SheetRow>
      </div>

      <motion.button className="pn-btn pn-btn--text" style={{ alignSelf: "center" }} whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "ONBOARDING", show: true })}>
        <Rocket size={15} aria-hidden="true" /> Показать мастер первого запуска
      </motion.button>
    </div>
  );
}
