export type BetTone = "good" | "bad" | "level";

/** How an accepted bet stands at the current score. Says nothing about how the match will end. */
export function betStatus(bet: { market: string; pick: string; line?: number | null }, home: number, away: number) {
  const total = home + away;
  if (bet.market === "totals" && bet.line != null) {
    const need = Math.floor(bet.line) + 1;
    if (bet.pick === "over") {
      if (total >= need) return { tone: "good" as BetTone, label: "Зашла", detail: `Уже ${total} из ${need}` };
      return { tone: "level" as BetTone, label: `Голов ${total} из ${need}`, detail: `Нужно ещё ${need - total}`, goals: { total, need } };
    }
    if (total >= need) return { tone: "bad" as BetTone, label: "Не зашла", detail: `Уже ${total}, линия пройдена` };
    return { tone: "good" as BetTone, label: "Заходит", detail: `Пока ${total} из ${need - 1} допустимых` };
  }
  if (bet.pick === "draw") {
    return home === away
      ? { tone: "good" as BetTone, label: "Заходит", detail: "Держится ничья" }
      : { tone: "bad" as BetTone, label: "Пока не заходит", detail: "Нужно сравнять счёт" };
  }
  const [mine, theirs] = bet.pick === "away" ? [away, home] : [home, away];
  if (mine > theirs) return { tone: "good" as BetTone, label: "Заходит", detail: "Счёт в вашу пользу" };
  if (mine === theirs) return { tone: "level" as BetTone, label: "Пока ничья", detail: "Нужен гол" };
  return { tone: "bad" as BetTone, label: "Пока не заходит", detail: "Нужно отыграться" };
}
