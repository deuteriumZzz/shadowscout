"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { useBankroll, useSetBankroll } from "@/hooks/use-shadowscout";
import { HELP, type HelpTopic } from "@/lib/help";
import { errorText } from "@/lib/labels";
import { useGame } from "@/store/app-store";
import { Sheet } from "@/ui/controls";
import { M } from "@/ui/motion";

function HelpSheet({ topic }: { topic: HelpTopic }) {
  const { dispatch } = useGame();
  const close = () => dispatch({ type: "SHEET", sheet: null });
  const h = HELP[topic];
  return (
    <Sheet title={h.title} onClose={close}>
      <h2>{h.title}</h2>
      <p style={{ lineHeight: 1.5 }}>{h.text}</p>
      <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={close}>Понятно</motion.button>
    </Sheet>
  );
}

function BankSheet() {
  const { dispatch } = useGame();
  const close = () => dispatch({ type: "SHEET", sheet: null });
  const { data: bank } = useBankroll();
  const set = useSetBankroll();
  const [value, setValue] = useState(bank ? String(Math.round(bank.capital)) : "");
  const [error, setError] = useState("");

  function save() {
    const n = Number(value.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      setError("Введите сумму больше нуля");
      return;
    }
    set.mutate(Math.round(n), {
      onSuccess: () => {
        close();
        dispatch({ type: "TOAST", text: "Банк обновлён" });
      },
      onError: (e) => setError(errorText(e)),
    });
  }

  return (
    <Sheet title="Изменить банк" onClose={close}>
      <h2>Изменить банк</h2>
      <label className="pn-stack">
        <span className="pn-small pn-muted">Сумма</span>
        <input
          className="pn-input"
          inputMode="decimal"
          value={value}
          aria-invalid={!!error}
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
          }}
        />
      </label>
      {error && <p className="pn-small" style={{ color: "var(--bad)" }}>{error}</p>}
      <motion.button className="pn-btn pn-btn--primary" whileTap={{ scale: M.press }} onClick={save}>Сохранить</motion.button>
    </Sheet>
  );
}

/** Sheets live in one AnimatePresence, so each keeps its props while sliding away. */
export function Sheets() {
  const { state } = useGame();
  const s = state.sheet;
  return (
    <AnimatePresence>
      {s?.kind === "help" && <HelpSheet key={`help${s.topic}`} topic={s.topic} />}
      {s?.kind === "bank" && <BankSheet key="bank" />}
    </AnimatePresence>
  );
}
