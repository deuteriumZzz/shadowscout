import { ApiError } from "@/lib/api";

export function errorText(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Откройте приложение из Telegram: так оно узнаёт владельца.";
    return error.message;
  }
  return "Сервер приложения не отвечает. Проверьте, что он запущен.";
}

/** Names an outcome the way a person would: the club, not "home". */
export function pickName(match: string, market: string, pick: string, line?: number | null) {
  const [home, away] = match.split(" - ");
  if (market === "totals") return `${pick === "over" ? "Больше" : "Меньше"} ${line ?? ""}`.trim();
  return pick === "home" ? `Победа ${home}` : pick === "away" ? `Победа ${away}` : "Ничья";
}
