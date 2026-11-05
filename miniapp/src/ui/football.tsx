"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { leagueLogo, teamLogo, type FormResult } from "@/lib/clubs";
import { M } from "@/ui/motion";

/** Real club crest. Falls back to initials so a CDN hiccup can't break a card. */
export function Crest({ team, size = 32, logo }: { team: string; size?: number; logo?: string | null }) {
  const [failed, setFailed] = useState(false);
  const src = logo || teamLogo(team);
  if (failed || !src) {
    return (
      <span className="pn-crest-fallback" style={{ width: size, height: size, fontSize: size * 0.36 }} aria-label={team}>
        {team.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a small remote logo; next/image would need a config change for a prototype
    <img src={src} alt={team} width={size} height={size} loading="lazy" onError={() => setFailed(true)} style={{ width: size, height: size, objectFit: "contain", flex: "none" }} />
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
