"use client";

import { animate, AnimatePresence, motion, useDragControls, type PanInfo } from "framer-motion";
import { Info } from "lucide-react";
import { createContext, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { leagueLogo, pickCrestColor, TEAM_COLOR, teamLogo, type FormResult, type HelpTopic } from "./engine";
import { thud } from "./sound";
import { useGame } from "./store";
import { haptic } from "@/lib/telegram";

// Motion tokens: every duration and spring in the prototype comes from here.
export const M = {
  dur: { fast: 0.18, normal: 0.35, slow: 0.6, crawl: 1 },
  ease: { smooth: [0.22, 1, 0.36, 1] as const, sharp: [0.4, 0, 0.2, 1] as const },
  spring: {
    snappy: { type: "spring", stiffness: 340, damping: 30 } as const,
    gentle: { type: "spring", stiffness: 130, damping: 18 } as const,
    bouncy: { type: "spring", stiffness: 420, damping: 16 } as const,
    roll: { type: "spring", stiffness: 90, damping: 18 } as const,
    sheet: { type: "spring", stiffness: 320, damping: 34 } as const,
  },
  press: 0.96,
};

const crestColors = new Map<string, string>();

/** A club's colour, read from its real crest so no club needs a hand-written entry. */
export function useTeamColor(team: string) {
  const fixed = TEAM_COLOR[team];
  const [color, setColor] = useState<string | null>(() => fixed ?? crestColors.get(team) ?? null);
  useEffect(() => {
    if (fixed || crestColors.has(team)) return;
    let live = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 32;
        const c = canvas.getContext("2d", { willReadFrequently: true });
        if (!c) return;
        c.drawImage(img, 0, 0, 32, 32);
        const found = pickCrestColor(c.getImageData(0, 0, 32, 32).data);
        if (!found) return;
        crestColors.set(team, found);
        if (live) setColor(found);
      } catch {
        // The CDN refused canvas access: the neutral fallback is fine.
      }
    };
    img.src = teamLogo(team);
    return () => {
      live = false;
    };
  }, [team, fixed]);
  return color ?? "var(--s3)";
}

/**
 * Press and hold to repeat, speeding up: a stake moves by 100 at a time, so
 * tapping from 1 500 to 5 000 by hand would be tedious.
 */
export function useHold(step: () => void) {
  const latest = useRef(step);
  useEffect(() => {
    latest.current = step;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stop = () => clearTimeout(timer.current);
  useEffect(() => stop, []);
  return {
    onPointerDown: () => {
      latest.current();
      haptic("light");
      let delay = 420;
      const tick = () => {
        latest.current();
        delay = Math.max(50, delay * 0.8);
        timer.current = setTimeout(tick, delay);
      };
      timer.current = setTimeout(tick, delay);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
  };
}

/** The app's main scroll area, for scroll-linked motion in the screens. */
export const ScrollCtx = createContext<RefObject<HTMLDivElement | null> | null>(null);

/** Real club crest. Falls back to initials so a CDN hiccup can't break a card. */
export function Crest({ team, size = 32, logo }: { team: string; size?: number; logo?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="pn-crest-fallback" style={{ width: size, height: size, fontSize: size * 0.36 }} aria-label={team}>
        {team.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a small remote logo; next/image would need a config change for a prototype
    <img src={logo || teamLogo(team)} alt={team} width={size} height={size} loading="lazy" onError={() => setFailed(true)} style={{ width: size, height: size, objectFit: "contain", flex: "none" }} />
  );
}

export function LeagueLogo({ league, size = 18 }: { league: string; size?: number }) {
  return (
    <span className="pn-league-logo" style={{ width: size + 6, height: size + 6 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- same as Crest */}
      <img src={leagueLogo(league)} alt="" width={size} height={size} loading="lazy" style={{ width: size, height: size, objectFit: "contain" }} />
    </span>
  );
}

export function Ball({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" style={{ flex: "none" }}>
      <circle cx="12" cy="12" r="10.5" fill="#f6f8f4" stroke="#0a120d" strokeWidth="1" />
      <path d="M12 7.4 16 10.3 14.5 15H9.5L8 10.3Z" fill="#0a120d" />
      <path d="M12 7.4V2.2M16 10.3 21.2 8.6M14.5 15 17.8 19.8M9.5 15 6.2 19.8M8 10.3 2.8 8.6" stroke="#0a120d" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

export const CardIcon = ({ red = false }: { red?: boolean }) => (
  <i className={`pn-card ${red ? "pn-card--red" : ""}`} aria-hidden="true" />
);

/** A single digit that rolls when it changes: the score on the board. */
export function RollDigit({ value }: { value: number }) {
  return (
    <span className="pn-roll" role="text" aria-label={String(value)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          aria-hidden="true"
          initial={{ y: "-100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={M.spring.snappy}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Rolling number for money: each digit column slides, so a win visibly adds up. */
export function Odometer({ value, className }: { value: number; className?: string }) {
  const text = Math.round(Math.abs(value)).toLocaleString("ru-RU").replace(/\s/g, " ");
  const chars = [...(value < 0 ? `−${text}` : text)];
  return (
    <span className={`pn-odo ${className ?? ""}`} role="text" aria-label={chars.join("")}>
      {chars.map((ch, i) => {
        const key = chars.length - i;
        if (ch === " ") return <span key={key} className="pn-odo__gap" aria-hidden="true" />;
        if (!/\d/.test(ch)) return <span key={key} aria-hidden="true">{ch}</span>;
        return (
          <span key={key} className="pn-odo__col" aria-hidden="true">
            <motion.span className="pn-odo__strip" initial={{ y: "0%" }} animate={{ y: `${-Number(ch) * 10}%` }} transition={M.spring.roll}>
              {Array.from({ length: 10 }, (_, d) => (
                <span key={d}>{d}</span>
              ))}
            </motion.span>
          </span>
        );
      })}
    </span>
  );
}

/** Confetti for a winning full time. Canvas, so it costs no DOM nodes. */
export function Confetti({ colors, count = 110 }: { colors: string[]; count?: number }) {
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

    const parts = Array.from({ length: count }, () => ({
      x: width / 2 + (Math.random() - 0.5) * 80,
      y: height * 0.4,
      vx: (Math.random() - 0.5) * 12,
      vy: -5 - Math.random() * 11,
      w: 5 + Math.random() * 6,
      h: 3 + Math.random() * 4,
      r: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.45,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));

    let raf = 0;
    const started = performance.now();
    const frame = (now: number) => {
      const t = now - started;
      c.clearRect(0, 0, width, height);
      c.globalAlpha = Math.max(0, 1 - t / 2400);
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
      if (t < 2400) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [colors, count]);

  return <canvas ref={ref} className="pn-confetti" aria-hidden="true" />;
}

/** Bottom sheet, dragged down by its handle so its content can still scroll. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const controls = useDragControls();
  const sheet = useRef<HTMLDivElement>(null);

  // Keeps the sheet above the on-screen keyboard, and the focused field in view.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const sync = () => {
      const keyboard = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      sheet.current?.style.setProperty("--kb", `${keyboard}px`);
    };
    viewport.addEventListener("resize", sync);
    return () => viewport.removeEventListener("resize", sync);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > 110 || info.velocity.y > 600) onClose();
  }

  return (
    <>
      <motion.div className="pn-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: M.dur.fast }} onClick={onClose} />
      <motion.div
        ref={sheet}
        onFocusCapture={(e) => {
          if (!(e.target instanceof HTMLInputElement)) return;
          const field = e.target;
          setTimeout(() => field.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
        }}
        className="pn-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={M.spring.sheet}
        drag="y"
        dragListener={false}
        dragControls={controls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.7 }}
        onDragEnd={onDragEnd}
      >
        <div className="pn-sheet__grab" onPointerDown={(e) => controls.start(e)} aria-hidden="true"><i /></div>
        <div className="pn-sheet__body">{children}</div>
      </motion.div>
    </>
  );
}

/** Segmented control with a pill that slides between options. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (id: T) => void; label: string }) {
  const id = useId();
  return (
    <div className="pn-seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)}>
          {value === o.id && <motion.span layoutId={`seg${id}`} className="pn-seg__pill" transition={M.spring.snappy} />}
          <span className="pn-seg__label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <motion.button className="pn-chip" aria-pressed={active} whileTap={{ scale: M.press }} onClick={onClick}>
      {children}
    </motion.button>
  );
}

export function Switch({ label, hint, on, onToggle }: { label: string; hint?: string; on: boolean; onToggle: () => void }) {
  return (
    <button className="pn-switch" role="switch" aria-checked={on} onClick={onToggle}>
      <span>
        <span className="pn-switch__label">{label}</span>
        {hint && <span className="pn-small pn-muted">{hint}</span>}
      </span>
      <span className="pn-switch__track" aria-hidden="true"><span className="pn-switch__knob" /></span>
    </button>
  );
}

export function HelpButton({ topic }: { topic: HelpTopic }) {
  const { dispatch } = useGame();
  return (
    <button
      className="pn-help"
      aria-label="Что это значит"
      onClick={(e) => {
        e.stopPropagation();
        dispatch({ type: "SHEET", sheet: { kind: "help", topic } });
      }}
    >
      <Info size={15} aria-hidden="true" />
    </button>
  );
}

const FORM_TEXT: Record<FormResult, string> = { win: "В", draw: "Н", loss: "П" };
const FORM_NAME: Record<FormResult, string> = { win: "победа", draw: "ничья", loss: "поражение" };

export function FormPips({ form }: { form: FormResult[] }) {
  return (
    <span className="pn-form" role="img" aria-label={`Форма: ${form.map((r) => FORM_NAME[r]).join(", ")}`}>
      {form.map((r, i) => (
        <motion.span key={i} data-r={r} aria-hidden="true" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...M.spring.bouncy, delay: i * 0.05 }}>
          {FORM_TEXT[r]}
        </motion.span>
      ))}
    </span>
  );
}

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
    thud();
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

/** Where a card's crests and odds sit on screen, so what opens can grow out of them. */
export type Morph = Partial<Record<string, HTMLElement>>;

/**
 * Grows the sheet out of the card: clones of the crests and odds fly from where
 * they sit to their place in the sheet. Clones rather than a shared layoutId,
 * because the target rides on a sheet that is itself sliding up.
 */
export function flyIn(morph: Morph, header: HTMLElement) {
  const sheet = header.closest(".pn-sheet, .pn-detail");
  const phone = header.closest(".pn-phone");
  const stage = header.closest(".pn-stage");
  if (!sheet || !phone || !stage) return () => {};
  const sheetRect = sheet.getBoundingClientRect();
  // The sheet starts below the screen, so aim at where it will come to rest.
  const dy = sheetRect.top - (phone.getBoundingClientRect().bottom - sheetRect.height);
  const stops = Object.keys(morph).map((key) => {
    const src = morph[key];
    const to = header.querySelector<HTMLElement>(`[data-morph-to="${key}"]`);
    if (!src || !to) return () => {};
    const from = src.getBoundingClientRect();
    const target = to.getBoundingClientRect();
    const clone = src.cloneNode(true) as HTMLElement;
    clone.style.cssText = `position:fixed;left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;margin:0;z-index:40;transform-origin:top left;pointer-events:none`;
    stage.append(clone);
    src.style.visibility = "hidden";
    to.style.visibility = "hidden";
    const finish = () => {
      clone.remove();
      src.style.visibility = "";
      to.style.visibility = "";
    };
    const flight = animate(clone, { x: target.left - from.left, y: target.top - dy - from.top, scale: target.width / from.width }, M.spring.sheet);
    void flight.then(finish);
    return () => {
      flight.stop();
      finish();
    };
  });
  return () => stops.forEach((stop) => stop());
}

/** The way back: the same clones return from the sheet to the card as it closes. */
export function flyOut(morph: Morph, header: HTMLElement) {
  const stage = header.closest(".pn-stage");
  if (!stage) return;
  for (const key of Object.keys(morph)) {
    const home = morph[key];
    const from = header.querySelector<HTMLElement>(`[data-morph-to="${key}"]`);
    if (!home?.isConnected || !from) continue;
    const start = from.getBoundingClientRect();
    const end = home.getBoundingClientRect();
    const clone = from.cloneNode(true) as HTMLElement;
    clone.style.cssText = `position:fixed;left:${start.left}px;top:${start.top}px;width:${start.width}px;height:${start.height}px;margin:0;z-index:40;transform-origin:top left;pointer-events:none`;
    stage.append(clone);
    home.style.visibility = "hidden";
    const finish = () => {
      clone.remove();
      home.style.visibility = "";
    };
    void animate(clone, { x: end.left - start.left, y: end.top - start.top, scale: end.width / start.width }, M.spring.sheet).then(finish);
  }
}
