"use client";

import { animate, AnimatePresence, motion, useMotionValueEvent, useScroll, useTransform } from "framer-motion";
import { AlertTriangle, ArrowDown, ArrowUp, Bell, BellRing, Check, ChevronRight, ExternalLink, KeyRound, Minus, Plus, RefreshCw, ShieldQuestion, Star, Trash2, WifiOff, X } from "lucide-react";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  betStatus,
  DEMO_MODEL,
  edge,
  H2H,
  HELP,
  isWeak,
  minuteLabel,
  optionOf,
  PICK_EVALUATED_MIN,
  PICK_FACTORS,
  recommendedOption,
  shownScore,
  TEAM_FORM,
  TEAM_TABLE,
  trackedBets,
  type DemoPick,
  type MarketOption,
} from "./engine";
import { CardIcon, Chip, Crest, FormPips, HelpButton, KeepyUppy, LeagueLogo, M, Odometer, RollDigit, ScrollCtx, Segmented, Sheet, useHold, useTeamColor } from "./fx";
import { thud } from "./sound";
import { Lineups } from "./screen-live";
import { blockReason, useGame, type Morph } from "./store";
import { getWebApp, haptic, hapticResult } from "@/lib/telegram";

const pct = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const money = (v: number) => Math.round(v).toLocaleString("ru-RU");
const STAKE_STEP = 100;
const DONE_MS = 520;
const BOOKMAKERS: Record<string, string> = { fonbet: "Fonbet", winline: "Winline", leon: "Leon", "1xbet": "1xBet", bet365: "bet365" };
// Same addresses as browser_session.SITES.
const BOOKMAKER_URL: Record<string, string> = {
  fonbet: "https://fonbet.ru",
  winline: "https://winline.ru",
  leon: "https://leon.ru",
  "1xbet": "https://1xbet.com",
  bet365: "https://www.bet365.com",
};

const MINI_AFTER = 130;

function readMorph(crests: Element | null, odds: Element | null): Morph {
  const get = (root: Element | null, key: string) => root?.querySelector<HTMLElement>(`[data-morph="${key}"]`) ?? undefined;
  return { home: get(crests, "home"), away: get(crests, "away"), odds: get(odds, "odds") };
}

/**
 * Grows the sheet out of the card: clones of the crests and odds fly from where
 * they sit to their place in the sheet. Clones rather than a shared layoutId,
 * because the target rides on a sheet that is itself sliding up.
 */
function flyIn(morph: Morph, header: HTMLElement) {
  const sheet = header.closest(".pn-sheet");
  const phone = header.closest(".pn-phone");
  const stage = header.closest(".pn-stage");
  if (!sheet || !phone || !stage) return () => {};
  const sheetRect = sheet.getBoundingClientRect();
  // The sheet starts below the screen, so aim at where it will come to rest.
  const dy = sheetRect.top - (phone.getBoundingClientRect().bottom - sheetRect.height);
  const stops = (["home", "away", "odds"] as const).map((key) => {
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
function flyOut(morph: Morph, header: HTMLElement) {
  const stage = header.closest(".pn-stage");
  if (!stage) return;
  for (const key of ["home", "away", "odds"] as const) {
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

function useMorphIn(morph: Morph | undefined, calm: boolean) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!morph || calm || !root.current) return;
    return flyIn(morph, root.current);
  }, [morph, calm]);
  return root;
}

function useKickoff(hours: number) {
  const [target] = useState(() => Date.now() + hours * 3_600_000);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, target - now);
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  const date = new Date(target);
  const today = new Date(now).getDate() === date.getDate();
  const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return {
    clock: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
    when: `${today ? "Сегодня" : "Завтра"}, ${time}`,
  };
}

function OddsValue({ option }: { option: MarketOption }) {
  const up = option.prevOdds !== undefined && option.odds > option.prevOdds;
  const down = option.prevOdds !== undefined && option.odds < option.prevOdds;
  return (
    <span className="pn-tile__odds" data-morph="odds">
      {option.prevOdds !== undefined && (
        <motion.i key={option.odds} className="pn-tile__flash" style={{ background: up ? "var(--good)" : "var(--warn)" }} initial={{ opacity: 0.55 }} animate={{ opacity: 0 }} transition={{ duration: M.dur.crawl * 1.4 }} aria-hidden="true" />
      )}
      {up && <ArrowUp size={13} color="var(--good)" aria-label="Кэф вырос" />}
      {down && <ArrowDown size={13} color="var(--warn)" aria-label="Кэф снизился" />}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={option.odds} initial={{ y: -12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }} transition={M.spring.snappy}>
          {option.odds.toFixed(2)}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function OddsTile({ pick, option }: { pick: DemoPick; option: MarketOption }) {
  const { state, dispatch } = useGame();
  const selected = state.slip.some((i) => i.pickId === pick.id && i.optionId === option.id);
  const recommended = pick.recommended === option.id;
  const ref = useRef<HTMLButtonElement>(null);

  function tap() {
    haptic("light");
    if (state.sound) thud();
    const r = ref.current?.getBoundingClientRect();
    dispatch({
      type: "SLIP_TOGGLE",
      pickId: pick.id,
      optionId: option.id,
      from: r && { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      to: { x: window.innerWidth / 2, y: window.innerHeight - 110 },
    });
  }

  return (
    <motion.button
      ref={ref}
      className="pn-tile"
      data-rec={recommended}
      aria-pressed={selected}
      aria-label={`${option.title}, кэф ${option.odds.toFixed(2)}${recommended ? ", совет бота" : ""}`}
      disabled={!!blockReason(state)}
      whileTap={{ scale: M.press }}
      animate={selected ? { scale: [1, 1.05, 1] } : { scale: 1 }}
      transition={{ duration: M.dur.normal }}
      onClick={tap}
    >
      {recommended && <span className="pn-tip">Совет</span>}
      <span className="pn-tile__label">{option.label}</span>
      <OddsValue option={option} />
    </motion.button>
  );
}

function Market({ pick }: { pick: DemoPick }) {
  const { dispatch } = useGame();
  const e = edge(pick);
  const weak = isWeak(pick);
  const marketRef = useRef<HTMLElement>(null);
  const open = () => {
    const market = marketRef.current;
    // Only the recommended tile's odds fly; the others stay put.
    const rec = market?.querySelector('.pn-tile[data-rec="true"]') ?? null;
    dispatch({ type: "SHEET", sheet: { kind: "pick", pickId: pick.id, morph: readMorph(market?.closest(".pn-match") ?? null, rec) } });
  };
  return (
    <motion.section
      ref={marketRef}
      className="pn-market"
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: -50, transition: { duration: M.dur.fast } }}
      transition={M.spring.snappy}
    >
      <div className="pn-row">
        <span className="pn-small" style={{ fontWeight: 600 }}>{pick.marketLabel}</span>
        <span className="pn-edge pn-muted">
          Перевес&nbsp;<b style={{ color: weak ? "var(--tx2)" : "var(--accent)" }}>{pct(e)}</b>
          <HelpButton topic="edge" />
        </span>
      </div>
      <div className="pn-tiles" style={{ marginTop: 4 }}>
        {pick.options.map((o) => (
          <OddsTile key={o.id} pick={pick} option={o} />
        ))}
      </div>
      {!pick.priceVerified && (
        <p className="pn-flag"><CardIcon /> Цена не подтверждена у вашего букмекера</p>
      )}
      <div className="pn-actions">
        <button className="pn-btn pn-btn--text" onClick={open}>
          Почему этот прогноз <ChevronRight size={15} aria-hidden="true" />
        </button>
        <button
          className="pn-btn pn-btn--text"
          onClick={() => {
            haptic("light");
            dispatch({ type: "SKIP", pickId: pick.id });
          }}
        >
          Пропустить
        </button>
      </div>
    </motion.section>
  );
}

function MatchCard({ picks, index }: { picks: DemoPick[]; index: number }) {
  const { state, dispatch } = useGame();
  const first = picks[0];
  const { when } = useKickoff(first.kickoffHours);
  return (
    <motion.article
      className="pn-match"
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ ...M.spring.snappy, delay: index * 0.07, layout: M.spring.snappy }}
    >
      <div className="pn-match__head">
        <LeagueLogo league={first.league} />
        <span>{first.league}</span>
        <span>{when}</span>
      </div>
      <div className="pn-match__teams">
        {[first.home, first.away].map((team, i) => (
          <div className="pn-teamrow" key={team}>
            <span data-morph={i ? "away" : "home"} style={{ display: "grid" }}><Crest team={team} size={28} /></span>
            <span className="pn-teamrow__name">{team}</span>
            <motion.button
              className="pn-star"
              aria-label={state.favorites.includes(team) ? `Убрать ${team} из любимых` : `Добавить ${team} в любимые`}
              aria-pressed={state.favorites.includes(team)}
              whileTap={{ scale: 0.7, rotate: -20 }}
              onClick={() => dispatch({ type: "TOGGLE_FAVORITE", team })}
            >
              <Star size={15} fill={state.favorites.includes(team) ? "currentColor" : "none"} aria-hidden="true" />
            </motion.button>
            <FormPips form={TEAM_FORM[team] ?? []} />
          </div>
        ))}
      </div>
      <AnimatePresence mode="popLayout" initial={false}>
        {picks.map((p) => (
          <Market key={p.id} pick={p} />
        ))}
      </AnimatePresence>
    </motion.article>
  );
}

/** The biggest match gets a poster: both clubs' colours, crests, a live countdown. */
function MatchOfTheDay({ pick }: { pick: DemoPick }) {
  const { dispatch } = useGame();
  const { clock } = useKickoff(pick.kickoffHours);
  const rec = recommendedOption(pick);
  const homeColor = useTeamColor(pick.home);
  const awayColor = useTeamColor(pick.away);
  const scroller = useContext(ScrollCtx);
  const { scrollY } = useScroll(scroller ? { container: scroller } : undefined);
  // Scrolling away, the poster recedes and a slim bar with the countdown takes over.
  const scale = useTransform(scrollY, [0, MINI_AFTER], [1, 0.93]);
  const opacity = useTransform(scrollY, [0, MINI_AFTER], [1, 0.25]);
  const [mini, setMini] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => setMini(v > MINI_AFTER));
  const open = (e: React.MouseEvent<HTMLElement>) =>
    dispatch({ type: "SHEET", sheet: { kind: "pick", pickId: pick.id, morph: readMorph(e.currentTarget, e.currentTarget) } });
  return (
    <>
      <div className="pn-mini-wrap">
        <AnimatePresence>
          {mini && (
            <motion.button
              className="pn-mini"
              initial={{ y: -48, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -48, opacity: 0 }}
              transition={M.spring.snappy}
              onClick={() => dispatch({ type: "SHEET", sheet: { kind: "pick", pickId: pick.id } })}
              aria-label={`Матч дня: ${pick.home} против ${pick.away}, до начала ${clock}`}
            >
              <Crest team={pick.home} size={22} />
              <Crest team={pick.away} size={22} />
              <span className="pn-small">{pick.home} — {pick.away}</span>
              <span className="pn-num" style={{ marginLeft: "auto", fontSize: 16 }}>{clock}</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    <motion.button
      className="pn-motd"
      style={{ scale, opacity }}
      initial={{ y: 12 }}
      animate={{ y: 0 }}
      transition={M.spring.gentle}
      whileTap={{ scale: 0.985 }}
      onClick={open}
      aria-label={`Матч дня: ${pick.home} против ${pick.away}, совет ${rec.title}`}
    >
      <i className="pn-motd__tint pn-motd__tint--home" style={{ background: homeColor }} />
      <i className="pn-motd__tint pn-motd__tint--away" style={{ background: awayColor }} />
      <span className="pn-motd__tag"><LeagueLogo league={pick.league} size={14} /> Матч дня</span>
      <span className="pn-motd__team">
        <motion.span data-morph="home" initial={{ x: -30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ ...M.spring.gentle, delay: 0.1 }} style={{ display: "grid" }}><Crest team={pick.home} size={60} /></motion.span>
        {pick.home}
      </span>
      <span className="pn-motd__mid">
        <span className="pn-small">До начала</span>
        <span className="pn-motd__time">{clock}</span>
        <span className="pn-small" style={{ marginTop: 3 }}>{rec.title}</span>
        <span className="pn-num" data-morph="odds" style={{ fontSize: 19, color: "var(--gold)" }}>{rec.odds.toFixed(2)}</span>
      </span>
      <span className="pn-motd__team">
        <motion.span data-morph="away" initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ ...M.spring.gentle, delay: 0.1 }} style={{ display: "grid" }}><Crest team={pick.away} size={60} /></motion.span>
        {pick.away}
      </span>
    </motion.button>
    </>
  );
}

type Sort = "edge" | "time";
type Day = "all" | "today" | "tomorrow";

const dayOf = (hours: number, now: number): Exclude<Day, "all"> =>
  new Date(now + hours * 3_600_000).getDate() === new Date(now).getDate() ? "today" : "tomorrow";

/** "Обновлено 12 с назад": with real money on screen, age matters as much as the number. */
function Freshness() {
  const { state } = useGame();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const stale = state.feedState === "stale";
  const sec = stale ? 2460 : Math.max(0, Math.round((now - state.updatedAt) / 1000));
  const age = sec < 60 ? `${sec} с` : `${Math.round(sec / 60)} мин`;
  return (
    <p className="pn-fresh" data-stale={stale}>
      {stale && <AlertTriangle size={13} aria-hidden="true" />}
      {sec < 10 ? "Только что обновлено" : `Обновлено ${age} назад${stale ? ": данные могли устареть" : ""}`}
    </p>
  );
}

/** One treatment for every state the feed can be in, instead of a screen of its own for each. */
export function FeedNotice({ icon, title, text, action, onAction }: { icon: React.ReactNode; title: string; text: string; action: string; onAction: () => void }) {
  return (
    <motion.section className="pn-notice" role="status" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={M.spring.gentle}>
      <motion.span className="pn-notice__icon" initial={{ scale: 0.4, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={M.spring.bouncy}>{icon}</motion.span>
      <h2 className="pn-h2">{title}</h2>
      <p className="pn-small pn-muted">{text}</p>
      <motion.button className="pn-btn pn-btn--primary" style={{ alignSelf: "stretch" }} whileTap={{ scale: M.press }} onClick={onAction}>{action}</motion.button>
    </motion.section>
  );
}

/** While a match with your bet runs, it sits above the new picks. */
function LiveCard() {
  const { state, dispatch } = useGame();
  const { sim } = state;
  const score = shownScore(sim);
  const { bets } = trackedBets(state.bets);
  const st = betStatus(bets[0], score.home, score.away, sim.minute, sim.status === "ft");
  return (
    <motion.button className="pn-livecard" layout initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={M.spring.snappy} onClick={() => dispatch({ type: "TAB", tab: "live" })}>
      <span className="pn-livecard__min">{sim.status === "playing" && <i className="pn-live" aria-hidden="true" />}{sim.status === "ft" ? "Финал" : minuteLabel(sim.minute)}</span>
      <Crest team="Arsenal" size={26} />
      <span className="pn-num" style={{ fontSize: 22 }}><RollDigit value={score.home} />:<RollDigit value={score.away} /></span>
      <Crest team="Liverpool" size={26} />
      <span className="pn-small" data-tone={st.tone} style={{ marginLeft: "auto", fontWeight: 600 }}>{st.label}</span>
      <ChevronRight size={17} color="var(--tx2)" aria-hidden="true" />
    </motion.button>
  );
}

export function BetsScreen() {
  const { state, dispatch } = useGame();
  const [league, setLeague] = useState("all");
  const [sort, setSort] = useState<Sort>("edge");
  const [day, setDay] = useState<Day>("all");
  const [now] = useState(() => Date.now());
  const pending = state.picks.filter((p) => p.status === "pending");
  const leagues = useMemo(() => [...new Set(state.picks.map((p) => p.league))], [state.picks]);

  const groups = useMemo(() => {
    const list = pending.filter((p) => (league === "all" || p.league === league) && (day === "all" || dayOf(p.kickoffHours, now) === day));
    const byMatch = new Map<string, DemoPick[]>();
    for (const p of list) {
      const key = `${p.home}-${p.away}`;
      byMatch.set(key, [...(byMatch.get(key) ?? []), p]);
    }
    const score = (g: DemoPick[]) => (sort === "edge" ? -Math.max(...g.map(edge)) : g[0].kickoffHours);
    const loved = (g: DemoPick[]) => (state.favorites.includes(g[0].home) || state.favorites.includes(g[0].away) ? 0 : 1);
    return [...byMatch.entries()].sort((a, b) => loved(a[1]) - loved(b[1]) || score(a[1]) - score(b[1]));
  }, [pending, league, sort, day, now, state.favorites]);

  if (state.loading) {
    return (
      // Shaped like what's coming, so the real cards land where the eye already is.
      <div className="pn-screen" aria-busy="true" aria-label="Загружаем прогнозы">
        <div className="pn-skeleton" style={{ height: 160 }} />
        <div className="pn-chips">{[74, 77, 68].map((w) => <div key={w} className="pn-skeleton" style={{ width: w, height: 38, flex: "none", borderRadius: 19 }} />)}</div>
        <div className="pn-chips">{[48, 146, 117].map((w) => <div key={w} className="pn-skeleton" style={{ width: w, height: 38, flex: "none", borderRadius: 19 }} />)}</div>
        {[0, 1].map((card) => (
          <div key={card} className="pn-match" style={{ padding: 14, gap: 10 }}>
            <div className="pn-skeleton" style={{ width: "55%", height: 14, borderRadius: 7 }} />
            <div className="pn-skeleton" style={{ width: "70%", height: 26, borderRadius: 8 }} />
            <div className="pn-skeleton" style={{ width: "62%", height: 26, borderRadius: 8 }} />
            <div className="pn-tiles">{[0, 1, 2].map((t) => <div key={t} className="pn-skeleton" style={{ height: 48, borderRadius: 10 }} />)}</div>
          </div>
        ))}
      </div>
    );
  }

  const refresh = () => dispatch({ type: "REFRESH" });
  if (state.feedState === "error") {
    return <div className="pn-screen"><FeedNotice icon={<ShieldQuestion size={26} aria-hidden="true" />} title="Прогнозы не загрузились" text="Сервер ответил ошибкой. Ваши ставки и банк в порядке." action="Повторить" onAction={refresh} /></div>;
  }
  if (state.feedState === "nokey") {
    return <div className="pn-screen"><FeedNotice icon={<KeyRound size={26} aria-hidden="true" />} title="Подключите модель" text="Прогнозы делает LLM. Без ключа хотя бы одной модели анализировать матчи некому." action="Открыть подключения" onAction={() => dispatch({ type: "TAB", tab: "settings" })} /></div>;
  }

  const block = blockReason(state);
  const top = pending[0];

  return (
    <div className="pn-screen">
      {state.feedState === "offline" && (
        <motion.div className="pn-stop-note" data-tone="warn" initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={M.spring.snappy}>
          <WifiOff size={17} aria-hidden="true" />
          <span style={{ flex: 1 }}>Нет связи: показаны последние данные</span>
          <button className="pn-icon" style={{ margin: -8 }} aria-label="Проверить связь" onClick={refresh}><RefreshCw size={17} aria-hidden="true" /></button>
        </motion.div>
      )}
      {block && (
        <div className="pn-stop-note"><CardIcon red /> {block}</div>
      )}

      <AnimatePresence initial={false}>{state.sim.status !== "idle" && <LiveCard key="live" />}</AnimatePresence>

      {top && <MatchOfTheDay pick={top} />}

      {pending.length > 0 && (
        <>
          <div className="pn-chips" role="group" aria-label="Фильтр по дате">
            <Chip active={day === "all"} onClick={() => setDay("all")}>Все дни</Chip>
            <Chip active={day === "today"} onClick={() => setDay("today")}>Сегодня</Chip>
            <Chip active={day === "tomorrow"} onClick={() => setDay("tomorrow")}>Завтра</Chip>
          </div>
          <div className="pn-chips" role="group" aria-label="Фильтр по лигам">
            <Chip active={league === "all"} onClick={() => setLeague("all")}>Все</Chip>
            {leagues.map((l) => (
              <Chip key={l} active={league === l} onClick={() => setLeague(l)}>
                <LeagueLogo league={l} size={13} /> {l}
              </Chip>
            ))}
          </div>
          <div className="pn-row">
            <h2 className="pn-h2">Прогнозы: {pending.length}</h2>
            <div style={{ width: 170 }}>
              <Segmented<Sort>
                label="Сортировка"
                value={sort}
                onChange={setSort}
                options={[{ id: "edge", label: "Перевес" }, { id: "time", label: "Время" }]}
              />
            </div>
          </div>
          <Freshness />
        </>
      )}

      <AnimatePresence mode="popLayout">
        {groups.map(([key, picks], i) => (
          <MatchCard key={key} picks={picks} index={i} />
        ))}
      </AnimatePresence>

      {pending.length > 0 && groups.length === 0 && (
        <motion.div className="pn-notice" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={M.spring.gentle}>
          <p className="pn-small pn-muted">По этим фильтрам прогнозов нет.</p>
          <button className="pn-btn pn-btn--ghost" onClick={() => { setLeague("all"); setDay("all"); }}>Сбросить фильтры</button>
        </motion.div>
      )}

      {pending.length === 0 && (
        <motion.section className="pn-panel pn-panel--flat" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={M.spring.gentle}>
          <div>
            <h2 className="pn-h2">Новых прогнозов нет</h2>
            <p className="pn-small pn-muted" style={{ marginTop: 4 }}>Как только бот найдёт перевес над рынком, матч появится здесь. Пока можно почеканить.</p>
          </div>
          <KeepyUppy />
        </motion.section>
      )}
    </div>
  );
}

export function SlipBar() {
  const { state, dispatch } = useGame();
  const items = state.slip.map((i) => {
    const pick = state.picks.find((p) => p.id === i.pickId)!;
    return { ...i, odds: optionOf(pick, i.optionId).odds };
  });
  const win = items.reduce((sum, i) => sum + Math.round(i.stake * (i.odds - 1)), 0);
  return (
    <AnimatePresence>
      {/* Only where bets are picked: on other tabs it would sit on top of their content. */}
      {items.length > 0 && !state.sheet && state.tab === "bets" && (
        <motion.button
          className="pn-slipbar"
          initial={{ y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 90, opacity: 0 }}
          transition={M.spring.snappy}
          whileTap={{ scale: 0.98 }}
          onClick={() => dispatch({ type: "SHEET", sheet: { kind: "slip" } })}
        >
          <motion.span key={items.length} className="pn-slipbar__count" initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={M.spring.bouncy}>
            {items.length}
          </motion.span>
          <span className="pn-slipbar__text">
            <b>Купон</b>
            Возможный выигрыш +{money(win)} {state.prefs.currency}
          </span>
          <ChevronRight size={20} aria-hidden="true" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function StakeStepper({ pickId, stake }: { pickId: number; stake: number }) {
  const { dispatch } = useGame();
  const change = (delta: number) => dispatch({ type: "SLIP_STAKE", pickId, stake: Math.max(STAKE_STEP, stake + delta) });
  const down = useHold(() => change(-STAKE_STEP));
  const up = useHold(() => change(STAKE_STEP));
  return (
    <div className="pn-stepper">
      <button aria-label="Уменьшить ставку" {...down}><Minus size={18} aria-hidden="true" /></button>
      <div className="pn-stepper__value" aria-live="polite">{money(stake)}</div>
      <button aria-label="Увеличить ставку" {...up}><Plus size={18} aria-hidden="true" /></button>
    </div>
  );
}

function SlipSheet() {
  const { state, dispatch } = useGame();
  const close = () => dispatch({ type: "SHEET", sheet: null });
  const [done, setDone] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const items = state.slip.map((i) => {
    const pick = state.picks.find((p) => p.id === i.pickId)!;
    return { item: i, pick, option: optionOf(pick, i.optionId) };
  });
  const stake = items.reduce((s, x) => s + x.item.stake, 0);
  const win = items.reduce((s, x) => s + Math.round(x.item.stake * (x.option.odds - 1)), 0);
  const bookmaker = BOOKMAKERS[state.prefs.bookmaker];

  /** Works on a phone too, where no extension can fill the slip. Each press copies the next bet's stake. */
  const copied = useRef(0);
  async function openSite() {
    const entry = items[copied.current % items.length];
    copied.current += 1;
    let text = `Откройте ${bookmaker} и введите ${money(entry.item.stake)}: ${entry.option.title}`;
    try {
      await navigator.clipboard.writeText(String(entry.item.stake));
      text = `Сумма ${money(entry.item.stake)} скопирована: ${entry.option.title}`;
    } catch {
      // Clipboard refused (some WebViews): the message above still gives the amount.
    }
    dispatch({ type: "TOAST", text });
    const url = BOOKMAKER_URL[state.prefs.bookmaker];
    const tg = getWebApp() as unknown as { initData?: string; openLink?: (u: string) => void } | undefined;
    if (tg?.initData && tg.openLink) tg.openLink(url);
    else window.open(url, "_blank", "noopener");
  }

  function confirm() {
    if (done) return;
    setDone(true);
    hapticResult("success");
    const r = confirmRef.current?.getBoundingClientRect();
    const dock = document.querySelector('[data-dock="live"]')?.getBoundingClientRect();
    timer.current = setTimeout(() => {
      dispatch({
        type: "PLACE_SLIP",
        from: r && { x: r.left + r.width / 2, y: r.top + r.height / 2 },
        to: dock && { x: dock.left + dock.width / 2, y: dock.top + 12 },
      });
    }, DONE_MS);
  }

  return (
    <Sheet title="Купон" onClose={close}>
      <h2>Купон</h2>
      {items.length === 0 && <p className="pn-small pn-muted">Купон пуст. Нажмите на кэф в карточке матча.</p>}
      <AnimatePresence mode="popLayout" initial={false}>
        {items.map(({ item, pick, option }) => {
          const off = pick.recommended !== option.id;
          return (
            <motion.section key={item.pickId} className="pn-panel" layout exit={{ opacity: 0, x: -40 }} transition={M.spring.snappy}>
              <div className="pn-row">
                <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <Crest team={pick.home} size={22} />
                  <Crest team={pick.away} size={22} />
                  <span className="pn-small pn-muted">{pick.home} — {pick.away}</span>
                </span>
                <button className="pn-icon" style={{ margin: -8 }} aria-label="Убрать из купона" onClick={() => dispatch({ type: "SLIP_REMOVE", pickId: item.pickId })}>
                  <Trash2 size={17} color="var(--tx2)" aria-hidden="true" />
                </button>
              </div>
              <div className="pn-row">
                <b style={{ fontWeight: 600 }}>{option.title}</b>
                <span className="pn-num" style={{ fontSize: 20 }}>{option.odds.toFixed(2)}</span>
              </div>
              {off && <p className="pn-flag"><CardIcon /> Это не совет бота: выбран другой исход</p>}
              <StakeStepper pickId={item.pickId} stake={item.stake} />
              {/* Always laid out: appearing would grow the sheet and pull "+" out from under a holding finger. */}
              <button
                className="pn-btn pn-btn--text"
                style={{ alignSelf: "center", minHeight: 32, visibility: item.stake === pick.stake ? "hidden" : undefined }}
                onClick={() => dispatch({ type: "SLIP_STAKE", pickId: item.pickId, stake: pick.stake })}
              >
                Вернуть рекомендованную: {money(pick.stake)}
              </button>
            </motion.section>
          );
        })}
      </AnimatePresence>

      {items.length > 0 && (
        <>
          <div className="pn-row pn-small"><span className="pn-muted">Всего поставлено</span><span className="pn-num pn-total" style={{ display: "inline-flex", gap: 4 }}><Odometer value={stake} /> {state.prefs.currency}</span></div>
          <div className="pn-row pn-small"><span className="pn-muted">Возможный выигрыш</span><span className="pn-num" style={{ fontSize: 22, color: "var(--gold)", display: "inline-flex" }}>+<Odometer value={win} />&nbsp;{state.prefs.currency}</span></div>
          <motion.button
            className="pn-btn pn-btn--line"
            whileTap={{ scale: M.press }}
            onClick={openSite}
          >
            <ExternalLink size={17} aria-hidden="true" /> Скопировать сумму и открыть {bookmaker}
          </motion.button>
          <AnimatePresence>
            {done && (
              <motion.div className="pn-stamp" initial={{ scale: 2.4, opacity: 0, rotate: 5 }} animate={{ scale: 1, opacity: 1, rotate: -8 }} transition={M.spring.bouncy} aria-hidden="true">В игре</motion.div>
            )}
          </AnimatePresence>
          <motion.button ref={confirmRef} className="pn-btn pn-btn--primary" whileTap={{ scale: M.press }} onClick={confirm} disabled={!!blockReason(state)} aria-label="Я поставил">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={String(done)} style={{ display: "inline-flex", alignItems: "center", gap: 7 }} initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -18, opacity: 0 }} transition={M.spring.snappy}>
                {done ? <><Check size={19} aria-hidden="true" /> Отмечено</> : "Я поставил"}
              </motion.span>
            </AnimatePresence>
          </motion.button>
          <p className="pn-small pn-muted" style={{ textAlign: "center" }}>Бот не ставит сам. Эта кнопка отмечает ставку, сделанную у букмекера.</p>
        </>
      )}
    </Sheet>
  );
}

function PickSheet({ pickId, morph }: { pickId: number; morph?: Morph }) {
  const { state, dispatch } = useGame();
  const header = useMorphIn(morph, state.calm);
  const [view, setView] = useState<"pick" | "match">("pick");
  const close = () => {
    if (morph && !state.calm && header.current) flyOut(morph, header.current);
    dispatch({ type: "SHEET", sheet: null });
  };
  const pick = state.picks.find((p) => p.id === pickId)!;
  const rec = recommendedOption(pick);
  const reminded = state.reminders.includes(pickId);
  const h2h = H2H[`${pick.home}-${pick.away}`] ?? [];
  const inSlip = state.slip.some((i) => i.pickId === pickId);
  const rows = [
    { label: "Рынок", value: 1 / rec.odds, color: "var(--tx2)" },
    { label: "Модель", value: pick.modelP, color: "var(--accent)" },
    { label: "Пуассон", value: pick.poissonP, flag: Math.abs(pick.modelP - pick.poissonP) > 0.1 },
    { label: "xG", value: pick.xgP, flag: Math.abs(pick.modelP - pick.xgP) > 0.1 },
  ];
  return (
    <Sheet title={`${pick.home} против ${pick.away}`} onClose={close}>
      <div className="pn-pickhead" ref={header}>
        <span data-morph-to="home" style={{ display: "grid" }}><Crest team={pick.home} size={54} /></span>
        <div style={{ minWidth: 0, textAlign: "center" }}>
          <p className="pn-small pn-muted">{pick.marketLabel} · уверенность: {pick.confidence.toLowerCase()}</p>
          <h2 style={{ marginTop: 2, fontSize: 17 }}>{rec.title}</h2>
          <span className="pn-num" data-morph-to="odds" style={{ display: "inline-block", fontSize: 28, color: "var(--gold)" }}>{rec.odds.toFixed(2)}</span>
        </div>
        <span data-morph-to="away" style={{ display: "grid" }}><Crest team={pick.away} size={54} /></span>
      </div>

      <Segmented<"pick" | "match">
        label="Раздел"
        value={view}
        onChange={setView}
        options={[{ id: "pick", label: "Прогноз" }, { id: "match", label: "Матч" }]}
      />

      {view === "pick" && (
        <>
      <p className="pn-small" style={{ fontSize: 15 }}>{pick.reasoning}</p>

      <section className="pn-panel">
        <b style={{ fontWeight: 600 }}>На чём основан прогноз</b>
        {(PICK_FACTORS[pick.id] ?? []).map((f, i) => (
          <motion.div key={f.text} className="pn-factor" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ ...M.spring.snappy, delay: 0.12 + i * 0.05 }}>
            <span className="pn-factor__tag" data-tag={f.tag}>{f.tag === "confirmed" ? "Факт" : "Слух"}</span>
            <span className="pn-small">{f.text}</span>
          </motion.div>
        ))}
        <p className="pn-small pn-muted">{DEMO_MODEL}, оценено {PICK_EVALUATED_MIN[pick.id] ?? "?"} мин назад. Слух сам по себе не повод для ставки.</p>
      </section>

      <section className="pn-panel">
        <div className="pn-row">
          <b style={{ fontWeight: 600 }}>Шанс этого исхода</b>
          <span className="pn-edge pn-muted">Перевес&nbsp;<b style={{ color: "var(--accent)" }}>{pct(edge(pick))}</b><HelpButton topic="edge" /></span>
        </div>
        {rows.map((r, i) => (
          <div className="pn-barrow" key={r.label}>
            <span className="pn-muted">{r.label}</span>
            <div className="pn-meter">
              <motion.span style={{ background: r.color ?? (r.flag ? "var(--warn)" : "var(--accent)") }} initial={{ scaleX: 0 }} animate={{ scaleX: r.value }} transition={{ ...M.spring.gentle, delay: 0.1 + i * 0.06 }} />
            </div>
            <span className="pn-num" style={{ textAlign: "right" }}>{Math.round(r.value * 100)}%</span>
          </div>
        ))}
        {rows.some((r) => r.flag) && <p className="pn-flag"><CardIcon /> Модели расходятся, сигнал менее надёжный</p>}
      </section>

        </>
      )}

      {view === "match" && (
        <>
      <section className="pn-panel">
        <b style={{ fontWeight: 600 }}>Положение в таблице</b>
        {[pick.home, pick.away].map((team) => (
          <div className="pn-row pn-small" key={team}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><Crest team={team} size={20} /> {team}</span>
            <span className="pn-muted">{TEAM_TABLE[team]?.pos ?? "—"} место, {TEAM_TABLE[team]?.points ?? "—"} очк., {TEAM_TABLE[team]?.played ?? "—"} игр</span>
          </div>
        ))}
      </section>

      <section className="pn-panel">
        <b style={{ fontWeight: 600 }}>Форма, последние 5</b>
        {[pick.home, pick.away].map((team) => (
          <div className="pn-teamrow" key={team} style={{ fontSize: 14 }}>
            <Crest team={team} size={22} /> {team}
            <FormPips form={TEAM_FORM[team] ?? []} />
          </div>
        ))}
      </section>

      {h2h.length > 0 && (
        <section className="pn-panel">
          <b style={{ fontWeight: 600 }}>Личные встречи</b>
          {h2h.map((m) => (
            <div className="pn-row pn-small" key={m.date}>
              <span className="pn-muted">{m.date}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Crest team={pick.home} size={18} />
                <b className="pn-num" style={{ fontSize: 15 }}>{m.score}</b>
                <Crest team={pick.away} size={18} />
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="pn-panel">
        <b style={{ fontWeight: 600 }}>Ожидаемые составы</b>
        {pick.home === "Arsenal" ? <Lineups /> : <p className="pn-small pn-muted">Появятся примерно за час до начала матча.</p>}
      </section>
        </>
      )}

      <div className="pn-grid2">
        <motion.button className="pn-btn pn-btn--line" whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "REMIND", pickId })}>
          {reminded ? <BellRing size={17} color="var(--accent)" aria-hidden="true" /> : <Bell size={17} aria-hidden="true" />} {reminded ? "Напомним" : "Напомнить"}
        </motion.button>
        <motion.button className="pn-btn pn-btn--line" whileTap={{ scale: M.press }} onClick={() => dispatch({ type: "SKIP", pickId })}>
          <X size={17} aria-hidden="true" /> Пропустить
        </motion.button>
      </div>
      <div className="pn-sheet__cta">
        <motion.button
          className="pn-btn pn-btn--primary"
          style={{ flex: 1 }}
          whileTap={{ scale: M.press }}
          disabled={!!blockReason(state)}
          onClick={() => {
            if (!inSlip) dispatch({ type: "SLIP_TOGGLE", pickId, optionId: pick.recommended });
            dispatch({ type: "SHEET", sheet: { kind: "slip" } });
          }}
        >
          {inSlip ? "Открыть купон" : `В купон: ${money(pick.stake)} на ${rec.odds.toFixed(2)}`}
        </motion.button>
      </div>
    </Sheet>
  );
}

function HelpSheet({ topic }: { topic: keyof typeof HELP }) {
  const { dispatch } = useGame();
  const close = () => dispatch({ type: "SHEET", sheet: null });
  const h = HELP[topic];
  return (
    <Sheet title={h.title} onClose={close}>
      <h2>{h.title}</h2>
      <p style={{ lineHeight: 1.5 }}>{h.text}</p>
      <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={close}>Понятно</motion.button>
    </Sheet>
  );
}

function BankSheet() {
  const { state, dispatch } = useGame();
  const close = () => dispatch({ type: "SHEET", sheet: null });
  const [value, setValue] = useState(String(state.budget));
  const [error, setError] = useState("");

  function save() {
    const n = Number(value.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      setError("Введите сумму больше нуля");
      return;
    }
    dispatch({ type: "SET_BUDGET", budget: Math.round(n) });
  }

  return (
    <Sheet title="Изменить банк" onClose={close}>
      <h2>Изменить банк</h2>
      <label className="pn-stack">
        <span className="pn-small pn-muted">Сумма</span>
        <input
          className="pn-input"
          inputMode="decimal"
          value={value}
          aria-invalid={!!error}
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
          }}
        />
      </label>
      {error && <p className="pn-small" style={{ color: "var(--bad)" }}>{error}</p>}
      <motion.button className="pn-btn pn-btn--primary" whileTap={{ scale: M.press }} onClick={save}>Сохранить</motion.button>
    </Sheet>
  );
}

/** Sheets live in one AnimatePresence, so each keeps its props while sliding away. */
export function Sheets() {
  const { state } = useGame();
  const s = state.sheet;
  return (
    <AnimatePresence>
      {s?.kind === "slip" && <SlipSheet key="slip" />}
      {s?.kind === "pick" && <PickSheet key={`pick${s.pickId}`} pickId={s.pickId} morph={s.morph} />}
      {s?.kind === "help" && <HelpSheet key={`help${s.topic}`} topic={s.topic} />}
      {s?.kind === "bank" && <BankSheet key="bank" />}
    </AnimatePresence>
  );
}
