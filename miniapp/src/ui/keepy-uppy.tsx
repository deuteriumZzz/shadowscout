"use client";

import { useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/telegram";
import { Ball } from "@/ui/football";

const BEST_KEY = "pn-keepy-best";

function readBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Keepy-uppy: a tiny game for an empty feed. Deliberately unrelated to bets. */
export function KeepyUppy() {
  const box = useRef<HTMLDivElement>(null);
  const ball = useRef<HTMLDivElement>(null);
  const sim = useRef({ x: 0, y: 0, vx: 0, vy: 0, r: 0, live: false, count: 0 });
  const [count, setCount] = useState(0);
  const [best, setBest] = useState(readBest);
  const [missed, setMissed] = useState(false);
  const SIZE = 52;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const s = sim.current;
    s.x = el.clientWidth / 2 - SIZE / 2;
    s.y = el.clientHeight - SIZE;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 16.67, 2);
      last = now;
      const w = el.clientWidth - SIZE;
      const h = el.clientHeight - SIZE;
      if (s.live) {
        s.vy += 0.34 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.r += s.vx * 3 * dt;
        if (s.x < 0 || s.x > w) {
          s.vx *= -0.8;
          s.x = Math.max(0, Math.min(w, s.x));
        }
        if (s.y < 0) {
          s.y = 0;
          s.vy = Math.abs(s.vy) * 0.3;
        }
        if (s.y >= h) {
          s.y = h;
          s.live = false;
          const final = s.count;
          s.count = 0;
          setCount(0);
          setMissed(final > 0);
          setBest((b) => {
            if (final <= b) return b;
            try {
              localStorage.setItem(BEST_KEY, String(final));
            } catch {
              // Private mode: the record just lasts for this session.
            }
            return final;
          });
        }
      }
      if (ball.current) ball.current.style.transform = `translate3d(${s.x}px, ${s.y}px, 0) rotate(${s.r}deg)`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  function kick() {
    const el = box.current;
    if (!el) return;
    const s = sim.current;
    if (s.y < el.clientHeight * 0.3) return;
    s.live = true;
    s.vy = -9.4;
    s.vx = (Math.random() - 0.5) * 5;
    s.count += 1;
    setCount(s.count);
    setMissed(false);
    haptic("light");
  }

  return (
    <div
      ref={box}
      className="pn-keepy"
      role="button"
      tabIndex={0}
      aria-label="Чеканка: нажимайте, чтобы подбивать мяч"
      onPointerDown={kick}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          kick();
        }
      }}
    >
      <div className="pn-keepy__count" aria-live="polite">{count}</div>
      <div className="pn-keepy__hint">{missed ? "Упал! Ещё раз?" : "Чеканка: жмите, когда мяч внизу"} · рекорд {best}</div>
      <div ref={ball} className="pn-keepy__ball"><Ball size={SIZE} /></div>
    </div>
  );
}
