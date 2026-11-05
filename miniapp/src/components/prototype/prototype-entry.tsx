"use client";

import dynamic from "next/dynamic";

// Client-only: the prototype leans on timers, canvas and audio, and rendering
// it on the server would only add hydration risk to a demo with no real data.
export const PrototypeEntry = dynamic(() => import("./game-app").then((m) => m.GameApp), {
  ssr: false,
  loading: () => <div className="pn-stage" />,
});
