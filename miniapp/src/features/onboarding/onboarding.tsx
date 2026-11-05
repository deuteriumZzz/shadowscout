"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { ConnectionForm, useConnections } from "@/features/settings/connections";
import { WalletSettings } from "@/features/wallet/wallet";
import { useDigestSettings, useSetDigestSettings } from "@/hooks/use-shadowscout";
import { api } from "@/lib/api";
import { errorText } from "@/lib/labels";
import { rememberOnboarded, useGame } from "@/store/app-store";
import { Chip } from "@/ui/controls";
import { LeagueLogo } from "@/ui/football";
import { M } from "@/ui/motion";

const STEPS = ["Модель", "Данные", "Деньги", "Лиги"];
const WIZARD_LEAGUES = ["Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1", "Champions League"];

/** First run: without a model the app has nothing to show, so setup comes first. */
export function Onboarding() {
  const { dispatch } = useGame();
  const { data, isError, error } = useConnections();
  const digest = useDigestSettings();
  const saveDigest = useSetDigestSettings();
  const chosen = (digest.data?.leagues ?? "").split(",").map((l) => l.trim()).filter(Boolean);
  const toggleLeague = (name: string) => saveDigest.mutate((chosen.includes(name) ? chosen.filter((l) => l !== name) : [...chosen, name]).join(", "));
  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState("gemini");
  const qc = useQueryClient();
  const [bank, setBank] = useState("1000");
  const [bankError, setBankError] = useState("");
  const item = (name: string) => data.items.find((i) => i.name === name);
  const llm = item(provider);
  const striker = item("striker");

  function finish() {
    rememberOnboarded();
    dispatch({ type: "ONBOARDING", show: false });
  }

  function next() {
    if (step === 2) {
      const n = Number(bank.replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) {
        setBankError("Введите сумму больше нуля");
        return;
      }
      // If the server isn't up yet, the Bank tab simply asks for the amount again.
      api.post("/api/bankroll", { capital: Math.round(n) }).then(() => qc.invalidateQueries({ queryKey: ["bankroll"] }), () => undefined);
    }
    if (step === STEPS.length - 1) finish();
    else setStep(step + 1);
  }

  return (
    <motion.div className="pn-wizard" role="dialog" aria-modal="true" aria-label="Первый запуск" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: 30 }} transition={{ duration: M.dur.normal }}>
      <div className="pn-wizard__steps" aria-label={`Шаг ${step + 1} из ${STEPS.length}`}>
        {STEPS.map((s, i) => (
          <span key={s} className="pn-wizard__step" data-on={i <= step}>
            <motion.i initial={false} animate={{ scaleX: i <= step ? 1 : 0 }} transition={M.spring.gentle} />
            {s}
          </span>
        ))}
      </div>
      <div className="pn-wizard__body">
        {isError && <p className="pn-stop-note" data-tone="warn">{errorText(error)} Настройки не сохранятся, их можно задать позже.</p>}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step} className="pn-stack" style={{ gap: 14 }} initial={{ opacity: 0, x: 26 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -26 }} transition={{ duration: M.dur.fast, ease: M.ease.smooth }}>
            {step === 0 && (
              <>
                <h1 className="pn-wizard__title">Выберите модель</h1>
                <p className="pn-muted">Она изучает матч и оценивает шансы команд. Хватит одной, менять можно в любой момент.</p>
                <div className="pn-chips pn-chips--wrap">
                  {data.items.filter((i) => i.group === "llm").map((i) => (
                    <Chip key={i.name} active={provider === i.name} onClick={() => setProvider(i.name)}>{i.label}</Chip>
                  ))}
                </div>
                {llm && <ConnectionForm key={llm.name} item={llm} />}
              </>
            )}
            {step === 1 && (
              <>
                <h1 className="pn-wizard__title">Футбольные данные</h1>
                <p className="pn-muted">Цены с Polymarket, счёт и форма с ESPN уже работают без ключей. StrikerAPI необязателен: он добавит в прогноз xG, бесплатно.</p>
                {striker && <ConnectionForm item={striker} />}
              </>
            )}
            {step === 2 && (
              <>
                <h1 className="pn-wizard__title">Деньги</h1>
                <WalletSettings />
                <p className="pn-muted">Условный банк для режима без денег: от него считаются размер ставки и стоп по просадке.</p>
                <label className="pn-stack">
                  <span className="pn-small pn-muted">Сумма</span>
                  <input className="pn-input" inputMode="decimal" aria-invalid={!!bankError} value={bank} onChange={(e) => { setBank(e.target.value); setBankError(""); }} />
                </label>
                {bankError && <p className="pn-small" style={{ color: "var(--bad)" }}>{bankError}</p>}
              </>
            )}
            {step === 3 && (
              <>
                <h1 className="pn-wizard__title">Какие лиги смотреть?</h1>
                <p className="pn-muted">По ним бот раз в неделю присылает дайджест с матчами, где есть перевес.</p>
                <div className="pn-chips pn-chips--wrap">
                  {WIZARD_LEAGUES.map((name) => (
                    <Chip
                      key={name}
                      active={chosen.includes(name)}
                      onClick={() => toggleLeague(name)}
                    >
                      <LeagueLogo league={name} size={13} /> {name}
                    </Chip>
                  ))}
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="pn-wizard__foot">
        <motion.button className="pn-btn pn-btn--primary" whileTap={{ scale: M.press }} onClick={next}>{step === STEPS.length - 1 ? "Готово" : "Дальше"}</motion.button>
        <button className="pn-btn pn-btn--text" onClick={finish}>Пропустить</button>
      </div>
    </motion.div>
  );
}
