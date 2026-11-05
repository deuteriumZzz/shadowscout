"use client";

import { useEffect, useRef } from "react";

const COLORS = ["#22c55e", "#f7c948", "#ffffff"];
const COUNT = 110;
const DURATION_MS = 2400;

/** One burst on a won bet's final whistle. Never on placing a bet. */
export function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const c = canvas?.getContext("2d");
    if (!canvas || !c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    c.scale(dpr, dpr);

    const parts = Array.from({ length: COUNT }, () => ({
      x: width / 2 + (Math.random() - 0.5) * 80,
      y: height * 0.25,
      vx: (Math.random() - 0.5) * 12,
      vy: -5 - Math.random() * 11,
      w: 5 + Math.random() * 6,
      h: 3 + Math.random() * 4,
      r: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.45,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));

    let raf = 0;
    const started = performance.now();
    const frame = (now: number) => {
      const t = now - started;
      c.clearRect(0, 0, width, height);
      c.globalAlpha = Math.max(0, 1 - t / DURATION_MS);
      for (const p of parts) {
        p.vy += 0.3;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.r);
        c.fillStyle = p.color;
        c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        c.restore();
      }
      if (t < DURATION_MS) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className="pn-confetti" aria-hidden="true" />;
}
