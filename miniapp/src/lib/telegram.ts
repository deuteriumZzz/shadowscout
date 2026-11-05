// Thin wrapper around window.Telegram.WebApp — Telegram's own documented,
// stable global (https://core.telegram.org/bots/webapps), loaded via the
// <script src="https://telegram.org/js/telegram-web-app.js"> tag in
// layout.tsx. Deliberately not using an SDK wrapper package: this API has
// been stable for years and the raw object is simpler to reason about
// than chasing a wrapper library's re-export names.

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string } };
  colorScheme: "light" | "dark";
  themeParams: Record<string, string | undefined>;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  onEvent(event: "themeChanged", handler: () => void): void;
  offEvent(event: "themeChanged", handler: () => void): void;
  HapticFeedback: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | undefined {
  if (typeof window === "undefined") return undefined;
  return window.Telegram?.WebApp;
}

export function getInitData(): string {
  return getWebApp()?.initData ?? "";
}

export function haptic(style: "light" | "medium" | "heavy" = "light") {
  getWebApp()?.HapticFeedback.impactOccurred(style);
}

export function hapticResult(type: "success" | "error" | "warning") {
  getWebApp()?.HapticFeedback.notificationOccurred(type);
}

export function openLink(url: string) {
  haptic("light");
  const tg = getWebApp() as unknown as { initData?: string; openLink?: (u: string) => void } | undefined;
  if (tg?.initData && tg.openLink) tg.openLink(url);
  else window.open(url, "_blank", "noopener");
}
