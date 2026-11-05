"use client";

import { AnimatePresence, motion, useDragControls, type PanInfo } from "framer-motion";
import { ChevronRight, Info } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { HelpTopic } from "@/lib/help";
import { haptic } from "@/lib/telegram";
import { useGame } from "@/store/app-store";
import { M } from "@/ui/motion";

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
    // Sheets can stack: Escape closes only the top one.
    const onKey = (e: KeyboardEvent) => {
      const open = document.querySelectorAll(".pn-sheet");
      if (e.key === "Escape" && open[open.length - 1] === sheet.current) onClose();
    };
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

type RowLook = { icon: ReactNode; tint: string; label: string; value?: ReactNode; tone?: string };

function RowContent({ icon, tint, label, value, tone }: RowLook) {
  return (
    <>
      <span className="pn-listrow__icon" style={{ background: tint }}>{icon}</span>
      <span className="pn-listrow__label">{label}</span>
      {value !== undefined && <span className="pn-listrow__value" style={{ color: tone }}>{value}</span>}
    </>
  );
}

/** A plain row for a fact with nothing behind it. */
export function ListRow(look: RowLook) {
  return <div className="pn-listrow"><RowContent {...look} /></div>;
}

/** A row that opens what it names in a sheet, so rare things stay out of the way until asked for. */
export function SheetRow({ title, children, ...look }: RowLook & { title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const phone = typeof document !== "undefined" ? document.querySelector(".pn-phone") : null;
  return (
    <>
      <motion.button className="pn-listrow" whileTap={{ scale: 0.985 }} onClick={() => setOpen(true)}>
        <RowContent {...look} />
        <ChevronRight size={17} color="var(--tx2)" aria-hidden="true" style={{ flex: "none" }} />
      </motion.button>
      {phone && createPortal(
        <AnimatePresence>{open && <Sheet key="sheet" title={title ?? look.label} onClose={() => setOpen(false)}>{children}</Sheet>}</AnimatePresence>,
        phone,
      )}
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
