"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getWebApp } from "@/lib/telegram";

function applyColorScheme(scheme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", scheme === "dark");
}

function TelegramBoot() {
  useEffect(() => {
    const tg = getWebApp();

    if (!tg) {
      // Local dev outside Telegram — fall back to the OS theme so the
      // dashboard is still usable/testable in a plain browser tab.
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      applyColorScheme(mql.matches ? "dark" : "light");
      const onChange = (e: MediaQueryListEvent) => applyColorScheme(e.matches ? "dark" : "light");
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }

    tg.ready();
    tg.expand();
    try {
      tg.disableVerticalSwipes?.();
    } catch {
      // older Telegram client without this method — non-fatal
    }

    const sync = () => {
      applyColorScheme(tg.colorScheme);
      try {
        tg.setBackgroundColor(tg.colorScheme === "dark" ? "#020617" : "#f8fafc");
        tg.setHeaderColor(tg.colorScheme === "dark" ? "#0e1223" : "#ffffff");
      } catch {
        // older Bot API version without explicit-hex support — cosmetic only
      }
    };
    sync();
    tg.onEvent("themeChanged", sync);
    return () => tg.offEvent("themeChanged", sync);
  }, []);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  // networkMode: 'always' — the default 'online' mode pauses fetches based
  // on the browser's online/offline events, which embedded WebViews
  // (Telegram's included) are known to report unreliably. Better to attempt
  // the request and let a real network failure surface as a normal query
  // error (our ErrorState + retry button) than to sit paused indefinitely
  // on a false "offline" signal.
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 15_000, refetchOnWindowFocus: true, networkMode: "always" },
      mutations: { networkMode: "always" },
    },
  }));

  return (
    <QueryClientProvider client={client}>
      <TelegramBoot />
      {children}
    </QueryClientProvider>
  );
}
