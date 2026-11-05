"use client";

import dynamic from "next/dynamic";

// Client-only: the app reads local preferences and Telegram's WebApp object on
// first render, and neither exists on the server.
export const AppEntry = dynamic(() => import("./app-shell").then((m) => m.AppShell), {
  ssr: false,
  loading: () => <div className="pn-stage" />,
});
