"use client";

import { motion } from "framer-motion";
import { ExternalLink, Wallet } from "lucide-react";
import { useState } from "react";
import { M } from "@/ui/motion";
import { positionName, type LiveMatch } from "@/lib/feeds/polymarket";
import { errorText } from "@/lib/labels";
import { openLink } from "@/lib/telegram";
import { useGame } from "@/store/app-store";
import { useConnectWallet, useDisconnectWallet, useWallet } from "@/hooks/use-shadowscout";
import type { WalletPosition } from "@/lib/types";

/** Real money to the cent. Null means the figure couldn't be read, so it never renders as 0. */
const usd = (v: number | null | undefined) =>
  v === null || v === undefined ? "нет данных" : `$${v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedUsd = (v: number) => `${v >= 0 ? "+" : "−"}${usd(Math.abs(v))}`;
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const cents = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}¢`);

export function WalletSettings() {
  const { data, isError, error } = useWallet();
  const connect = useConnectWallet();
  const disconnect = useDisconnectWallet();
  const [address, setAddress] = useState("");

  if (isError) {
    return (
      <section className="pn-panel pn-panel--flat">
        <h2 className="pn-h2">Кошелёк Polymarket</h2>
        <p className="pn-small pn-muted">{errorText(error)}</p>
      </section>
    );
  }
  return (
    <section className="pn-panel pn-panel--flat">
      <h2 className="pn-h2">Кошелёк Polymarket</h2>
      {data?.connected ? (
        <>
          <div className="pn-row">
            <div style={{ minWidth: 0 }}>
              <b style={{ fontWeight: 600 }}>{data.name || "Подключён"}</b>
              <p className="pn-small pn-muted pn-num">{short(data.address)}</p>
            </div>
            <span className="pn-small" style={{ color: "var(--good)" }}>Только просмотр</span>
          </div>
          <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>Отключить</motion.button>
        </>
      ) : (
        <>
          <p className="pn-small pn-muted">Покажем настоящий баланс и позиции. Нужен только публичный адрес из профиля на polymarket.com, управлять деньгами приложение не сможет.</p>
          <input
            className="pn-input pn-input--text"
            placeholder="0x…"
            aria-label="Адрес кошелька Polymarket"
            autoComplete="off"
            spellCheck={false}
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              connect.reset();
            }}
          />
          {connect.isError && <p className="pn-small" style={{ color: "var(--bad)" }} role="alert">{errorText(connect.error)}</p>}
          <motion.button className="pn-btn pn-btn--primary" whileTap={{ scale: M.press }} disabled={!address.trim() || connect.isPending} onClick={() => connect.mutate(address.trim())}>
            {connect.isPending ? "Проверяем адрес…" : "Подключить"}
          </motion.button>
          <p className="pn-small" style={{ color: "var(--warn)" }}>Секретную фразу и приватный ключ никуда не вводите: они здесь не нужны.</p>
        </>
      )}
    </section>
  );
}

function PositionRow({ position, score }: { position: WalletPosition; score?: string }) {
  const { title, outcome, status, avg_price, price, value, pnl, url } = position;
  const name = positionName(title, outcome);
  const waiting = status === "REDEEMABLE";
  return (
    <div className="pn-row" style={{ padding: "11px 0", borderTop: "1px solid var(--line)", gap: 12, alignItems: "flex-start" }}>
      <div style={{ minWidth: 0 }}>
        <b style={{ fontWeight: 600 }}>{name}</b>
        <p className="pn-small pn-muted">
          {waiting ? "Ждёт выплаты" : `${cents(avg_price)} → ${cents(price)}`}
          {score ? ` · сейчас ${score}` : ""}
        </p>
        {url && (
          <button className="pn-small pn-muted" style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "underline" }} onClick={() => openLink(url)}>
            <ExternalLink size={12} aria-hidden="true" /> На Polymarket
          </button>
        )}
      </div>
      <div style={{ flex: "none", textAlign: "right" }}>
        <div className="pn-num" style={{ fontSize: 16 }}>{usd(value)}</div>
        {pnl !== null && <div className="pn-small pn-num" style={{ color: pnl >= 0 ? "var(--good)" : "var(--bad)" }}>{signedUsd(pnl)}</div>}
      </div>
    </div>
  );
}

/** The real balance, kept visibly apart from the no-money bank below it. */
export function WalletPanel() {
  const { dispatch } = useGame();
  const { data, isPending, isError, error, refetch } = useWallet();
  const [showClosed, setShowClosed] = useState(false);

  if (isPending) return <div className="pn-skeleton" style={{ height: 150 }} aria-busy="true" />;
  if (isError) {
    return (
      <section className="pn-panel pn-panel--flat">
        <h2 className="pn-h2">Кошелёк Polymarket</h2>
        <p className="pn-small pn-muted">{errorText(error)}</p>
        <button className="pn-btn pn-btn--ghost" onClick={() => refetch()}>Повторить</button>
      </section>
    );
  }
  if (!data.connected) {
    return (
      <motion.button className="pn-btn pn-btn--ghost" style={{ width: "100%" }} whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "TAB", tab: "settings" })}>
        <Wallet size={16} aria-hidden="true" /> Показать настоящий баланс Polymarket
      </motion.button>
    );
  }
  return (
    <section className="pn-panel pn-panel--flat">
      <span className="pn-small pn-muted">Кошелёк Polymarket · настоящие деньги</span>
      <div className="pn-num" style={{ fontSize: 34, lineHeight: 1.1 }}>{usd(data.total)}</div>
      <div className="pn-row pn-small"><span className="pn-muted">Свободно</span><b className="pn-num" style={{ fontSize: 16 }}>{usd(data.cash)}</b></div>
      <div className="pn-row pn-small"><span className="pn-muted">В позициях</span><b className="pn-num" style={{ fontSize: 16 }}>{usd(data.positions_value)}</b></div>
      {data.unrealized_pnl !== null && !!data.positions?.length && (
        <div className="pn-row pn-small">
          <span className="pn-muted">Результат открытых позиций</span>
          <b className="pn-num" style={{ fontSize: 16, color: data.unrealized_pnl >= 0 ? "var(--good)" : "var(--bad)" }}>{signedUsd(data.unrealized_pnl)}</b>
        </div>
      )}
      {data.errors.map((e) => <p className="pn-small" style={{ color: "var(--warn)" }} role="alert" key={e}>{e}</p>)}
      {data.positions && data.positions.length > 0 && (
        <div>
          <b style={{ fontWeight: 600 }}>Открытые позиции: {data.positions.length}{data.truncated ? "+" : ""}</b>
          {data.positions.map((p, i) => <PositionRow key={`${p.event_slug}${p.outcome}${i}`} position={p} />)}
          {data.truncated && <p className="pn-small pn-muted">Показаны самые крупные позиции, остальные на Polymarket.</p>}
        </div>
      )}
      {data.positions?.length === 0 && <p className="pn-small pn-muted">Открытых позиций нет.</p>}
      {data.closed && data.closed.length > 0 && (
        <>
          <button className="pn-small" style={{ alignSelf: "flex-start", textDecoration: "underline" }} aria-expanded={showClosed} onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? "Скрыть закрытые позиции" : "Показать закрытые позиции"}
          </button>
          {showClosed && data.closed.map((p, i) => (
            <div className="pn-row pn-small" key={`${p.event_slug}${p.outcome}${i}`} style={{ gap: 12 }}>
              <span style={{ minWidth: 0 }}>{positionName(p.title, p.outcome)}</span>
              {p.realized_pnl !== null && <b className="pn-num" style={{ flex: "none", color: p.realized_pnl >= 0 ? "var(--good)" : "var(--bad)" }}>{signedUsd(p.realized_pnl)}</b>}
            </div>
          ))}
        </>
      )}
      <p className="pn-small pn-muted">Данные Polymarket и сети Polygon, {new Date(data.updated_at).toLocaleTimeString("ru-RU")}.</p>
    </section>
  );
}

/** Real positions on the Live tab, with the score once their match is on. */
export function WalletPositions({ matches }: { matches: LiveMatch[] }) {
  const { data } = useWallet();
  if (!data?.connected || !data.positions?.length) return null;
  const scoreOf = (p: WalletPosition) => {
    const live = matches.find((m) => p.event_slug && m.url.endsWith(`/${p.event_slug}`))?.espn;
    return live?.state === "in" ? `${live.homeScore}:${live.awayScore}` : undefined;
  };
  return (
    <section className="pn-stack">
      <h2 className="pn-h2">Мои позиции на Polymarket: {data.positions.length}{data.truncated ? "+" : ""}</h2>
      <div className="pn-panel pn-panel--flat" style={{ gap: 0, paddingBlock: 4 }}>
        {data.positions.map((p, i) => <PositionRow key={`${p.event_slug}${p.outcome}${i}`} position={p} score={scoreOf(p)} />)}
      </div>
    </section>
  );
}
