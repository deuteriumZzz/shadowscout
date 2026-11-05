"use client";

import { animate, motion } from "framer-motion";
import { Banknote, CircleSlash, Minus, Pause, Pencil, Play, Plus, ShieldAlert, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { WalletRow } from "@/features/wallet/wallet";
import { useBankroll, useEquityCurve, useLimits, useSetLimits } from "@/hooks/use-shadowscout";
import { errorText } from "@/lib/labels";
import { haptic } from "@/lib/telegram";
import type { EquityPoint } from "@/lib/types";
import { useGame } from "@/store/app-store";
import { HelpButton, ListRow, Segmented, SheetRow, useHold } from "@/ui/controls";
import { M } from "@/ui/motion";
import { FeedNotice } from "@/ui/notice";
import { Odometer } from "@/ui/numbers";

const CAPITAL_LABEL = { week: "7 дней", month: "30 дней", all: "Всё время" } as const;

type Period = keyof typeof CAPITAL_LABEL;

const money = (v: number) => Math.abs(Math.round(v)).toLocaleString("ru-RU");

const PERIOD_DAYS: Record<Period, number> = { week: 7, month: 30, all: Infinity };

const CHART = { w: 320, h: 150, left: 40, right: 8, top: 12, bottom: 20 };

/** The bank at each settled bet in the period, starting from where it stood before it. */
function capitalSeries(points: EquityPoint[], capital: number, period: Period, now: number) {
  const total = points.at(-1)?.cumulative_currency ?? 0;
  const start = capital - total;
  const cutoff = now - PERIOD_DAYS[period] * 86_400_000;
  const inside = points.filter((p) => Date.parse(p.date) >= cutoff);
  const before = points.filter((p) => Date.parse(p.date) < cutoff).at(-1)?.cumulative_currency ?? 0;
  return [start + before, ...inside.map((p) => start + p.cumulative_currency)];
}

/** Capital over time: one series, so the title names it and no legend is needed. */
function CapitalChart({ period, series }: { period: Period; series: number[] }) {
  const line = useRef<SVGPathElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const current = series[series.length - 1];

  const max = Math.max(...series);
  const min = Math.min(...series);
  const pad = Math.max(1, (max - min) * 0.1);
  const x = (i: number) => CHART.left + (i / (series.length - 1)) * (CHART.w - CHART.left - CHART.right);
  const y = (v: number) => CHART.top + (1 - (v - (min - pad)) / (max - min + 2 * pad)) * (CHART.h - CHART.top - CHART.bottom);
  const d = series.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const base = CHART.h - CHART.bottom;
  const area = `${d} L${x(series.length - 1).toFixed(1)} ${base} L${x(0).toFixed(1)} ${base} Z`;
  const ticks = [...new Set([min, (min + max) / 2, max])];

  useEffect(() => {
    const path = line.current;
    if (!path) return;
    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    const controls = animate(length, 0, {
      duration: M.dur.crawl,
      ease: M.ease.smooth,
      onUpdate: (v) => {
        path.style.strokeDashoffset = String(v);
      },
    });
    return () => controls.stop();
  }, [period, series.length]);

  function onPointer(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * CHART.w;
    const i = Math.max(0, Math.min(series.length - 1, Math.round(((px - CHART.left) / (CHART.w - CHART.left - CHART.right)) * (series.length - 1))));
    if (i !== hover && e.pointerType === "touch") haptic("light");
    setHover(i);
  }

  return (
    <div className="pn-chart">
      {hover !== null && (
        <div className="pn-chart__tip pn-num" style={{ left: `${(x(hover) / CHART.w) * 100}%` }}>{money(series[hover])}</div>
      )}
      <svg
        viewBox={`0 0 ${CHART.w} ${CHART.h}`}
        role="img"
        aria-label={`Банк за период ${CAPITAL_LABEL[period]}: от ${money(series[0])} до ${money(current)}`}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={CHART.left} x2={CHART.w - CHART.right} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={CHART.left - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--tx2)">{money(t)}</text>
          </g>
        ))}
        <motion.path key={`a${period}`} d={area} fill="var(--accent)" initial={{ opacity: 0 }} animate={{ opacity: 0.1 }} transition={{ delay: 0.3, duration: M.dur.slow }} />
        <path key={period} ref={line} d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={CHART.top} y2={base} stroke="var(--line-2)" />}
        {hover !== null && <circle cx={x(hover)} cy={y(series[hover])} r="4" fill="var(--tx)" stroke="var(--s1)" strokeWidth="2" />}
        <circle cx={x(series.length - 1)} cy={y(current)} r="3.5" fill="var(--accent)" />
        <text x={CHART.left} y={CHART.h - 5} fontSize="10" fill="var(--tx2)">{period === "all" ? "Начало" : `${CAPITAL_LABEL[period]} назад`}</text>
        <text x={CHART.w - CHART.right} y={CHART.h - 5} textAnchor="end" fontSize="10" fill="var(--tx2)">Сегодня</text>
      </svg>
    </div>
  );
}

const LIMIT_STEP = 500;

const LIMIT_SAVE_DELAY_MS = 500;

/** Limits sit next to the money, not buried in settings: they're part of playing well. */
function Limits() {
  const { data } = useLimits();
  const set = useSetLimits();
  const { mutate } = set;
  const [draft, setDraft] = useState<number | null>(null);
  const limit = draft ?? data?.daily_limit ?? 0;
  const down = useHold(() => setDraft((v) => Math.max(0, (v ?? data?.daily_limit ?? 0) - LIMIT_STEP)));
  const up = useHold(() => setDraft((v) => (v ?? data?.daily_limit ?? 0) + LIMIT_STEP));

  // Saved once the buttons are let go, not on every step of a hold.
  useEffect(() => {
    if (draft === null || draft === data?.daily_limit) return;
    const t = setTimeout(() => mutate({ daily_limit: draft }), LIMIT_SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [draft, data?.daily_limit, mutate]);

  if (!data) return null;
  const used = limit ? Math.min(1, data.loss_today / limit) : 0;
  return (
    <section className="pn-panel pn-panel--flat">
      <b style={{ fontWeight: 600 }}>Дневной лимит потерь</b>
      <div className="pn-stepper">
        <button aria-label="Уменьшить лимит" {...down}><Minus size={18} aria-hidden="true" /></button>
        <div className="pn-stepper__value" aria-live="polite">{limit ? money(limit) : "Нет"}</div>
        <button aria-label="Увеличить лимит" {...up}><Plus size={18} aria-hidden="true" /></button>
      </div>
      <div className="pn-meter" role="progressbar" aria-label="Использовано лимита" aria-valuenow={Math.round(used * 100)} aria-valuemin={0} aria-valuemax={100}>
        <motion.span style={{ background: used >= 1 ? "var(--live)" : "var(--accent)" }} initial={false} animate={{ scaleX: used }} transition={M.spring.gentle} />
      </div>
      <p className="pn-small pn-muted">Сегодня потеряно {money(data.loss_today)}. При достижении лимита ставки выключатся до завтра.</p>
      {data.paused_until ? (
        <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => mutate({ pause: false })}>
          <Play size={16} aria-hidden="true" /> Снять паузу
        </motion.button>
      ) : (
        <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={() => mutate({ pause: true })}>
          <Pause size={16} aria-hidden="true" /> Пауза на сутки
        </motion.button>
      )}
      {set.isError && <p className="pn-small" style={{ color: "var(--bad)" }} role="alert">{errorText(set.error)}</p>}
    </section>
  );
}

/** The daily limit at a glance. A pause is never hidden behind the tap. */
function LimitRow() {
  const { data, isError } = useLimits();
  const value = isError ? "нет данных" : !data ? "" : data.paused_until ? "пауза" : data.daily_limit ? money(data.daily_limit) : "нет";
  return (
    <SheetRow icon={<CircleSlash size={17} aria-hidden="true" />} tint="#d9534a" label="Дневной лимит" value={value} tone={data?.paused_until ? "var(--warn)" : undefined}>
      <Limits />
    </SheetRow>
  );
}

function ApiNotice({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="pn-screen">
      <FeedNotice icon={<ShieldAlert size={26} aria-hidden="true" />} title="Данные не загрузились" text={errorText(error)} action="Повторить" onAction={retry} />
    </div>
  );
}

export function BankScreen() {
  const { state, dispatch } = useGame();
  const { data: bank, isPending, isError, error, refetch } = useBankroll();
  const curve = useEquityCurve();
  const [period, setPeriod] = useState<Period>("month");
  const [now] = useState(() => Date.now());
  const series = useMemo(() => (bank ? capitalSeries(curve.data ?? [], bank.capital, period, now) : []), [curve.data, bank, period, now]);

  if (isPending) return <div className="pn-screen" aria-busy="true"><div className="pn-skeleton" style={{ height: 260 }} /></div>;
  if (isError) return <ApiNotice error={error} retry={() => refetch()} />;
  if (!bank) {
    return (
      <div className="pn-screen">
        <div className="pn-list"><WalletRow /></div>
        <FeedNotice icon={<Wallet size={26} aria-hidden="true" />} title="Задайте банк" text="От него считаются размер ставки, просадка и стоп. Пока это режим без денег: сумма условная." action="Указать сумму" onAction={() => dispatch({ type: "SHEET", sheet: { kind: "bank" } })} />
      </div>
    );
  }

  const change = bank.capital - series[0];
  const used = Math.min(1, bank.drawdown_pct / bank.stop_loss_pct);

  return (
    <div className="pn-screen">
      <section className="pn-bank">
        <div className="pn-row">
          <span className="pn-small pn-muted">Условный банк, без денег</span>
          <motion.button className="pn-bank__edit" whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "SHEET", sheet: { kind: "bank" } })}>
            <Pencil size={13} aria-hidden="true" /> Изменить
          </motion.button>
        </div>
        <span className="pn-bank__value" style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}><Odometer value={Math.round(bank.capital)} /><span style={{ fontSize: 24, color: "var(--tx2)" }}>{state.currency}</span></span>
        <span className="pn-small" style={{ color: change >= 0 ? "var(--good)" : "var(--bad)" }}>
          {change >= 0 ? "+" : "−"}{money(change)} за {CAPITAL_LABEL[period].toLowerCase()}
        </span>
      </section>

      <Segmented<Period>
        label="Период графика"
        value={period}
        onChange={setPeriod}
        options={(Object.keys(CAPITAL_LABEL) as Period[]).map((id) => ({ id, label: CAPITAL_LABEL[id] }))}
      />
      {series.length > 1 ? (
        <CapitalChart period={period} series={series} />
      ) : (
        <p className="pn-small pn-muted" style={{ padding: "18px 0", textAlign: "center" }}>За этот период закрытых ставок нет. График появится после них.</p>
      )}

      {/* What stops bets stays on the screen: protection is never one tap away. */}
      {bank.clv_gated && (
        <p className="pn-small" style={{ color: "var(--warn)" }}>
          Ставки остановлены: цены в среднем уходят против прогнозов модели ({bank.clv_gate_avg?.toFixed(1)}%).
        </p>
      )}

      <div className="pn-list">
        <SheetRow
          icon={bank.stopped ? <ShieldAlert size={17} aria-hidden="true" /> : <ShieldCheck size={17} aria-hidden="true" />}
          tint={bank.stopped ? "#d9534a" : "#1fb155"}
          label="Защита банка"
          value={bank.stopped ? "стоп" : "норма"}
          tone={bank.stopped ? "var(--bad)" : "var(--good)"}
        >
          <div className="pn-row">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <h2 className="pn-h2">Просадка от пика</h2>
              <HelpButton topic="stop" />
            </span>
          </div>
          <div className="pn-meter" role="progressbar" aria-label="Просадка относительно стопа" aria-valuenow={Math.round(used * 100)} aria-valuemin={0} aria-valuemax={100}>
            <motion.span style={{ background: bank.stopped ? "var(--live)" : used > 0.7 ? "var(--warn)" : "var(--accent)" }} initial={{ scaleX: 0 }} animate={{ scaleX: bank.stopped ? 1 : used }} transition={M.spring.gentle} />
          </div>
          <div className="pn-row pn-small pn-muted">
            <span>Сейчас {bank.drawdown_pct.toFixed(1)}%, пик {money(bank.peak)}</span>
            <span>Стоп {bank.stop_loss_pct.toFixed(0)}%</span>
          </div>
        </SheetRow>
        <ListRow icon={<Banknote size={17} aria-hidden="true" />} tint="#1c7bc4" label="Рекомендованная ставка" value={bank.stopped || bank.suggested_stake === null ? "—" : money(bank.suggested_stake)} />
        <LimitRow />
        <WalletRow />
      </div>
    </div>
  );
}
