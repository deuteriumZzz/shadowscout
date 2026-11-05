"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronRight, ExternalLink, Eye, EyeOff, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Chip, LeagueLogo, M, Sheet } from "./fx";
import { rememberOnboarded, useGame } from "./store";
import { api } from "@/lib/api";

interface Item {
  name: string;
  label: string;
  group: "llm" | "football" | "odds";
  hint: string;
  source: "app" | "env" | "none" | "keyless";
  connected: boolean;
  masked: string | null;
  search: "native" | "duckduckgo" | null;
  custom: boolean;
  model: string | null;
  base_url: string | null;
  needs_reentry: boolean;
}

interface State {
  items: Item[];
  primary: string;
  fallbacks: string[];
  bookmaker: { site: string; sites: string[] };
  can_store: boolean;
  demo: boolean;
}

const row = (name: string, label: string, group: Item["group"], hint: string, extra: Partial<Item> = {}): Item => ({
  name, label, group, hint, source: "none", connected: false, masked: null, search: null, custom: false, model: null, base_url: null, needs_reentry: false, ...extra,
});

// Mirrors connections.py's CATALOG, used only when no backend answers.
const DEMO: State = {
  demo: true,
  can_store: true,
  primary: "claude",
  fallbacks: [],
  bookmaker: { site: "fonbet", sites: ["fonbet", "winline", "leon", "1xbet", "bet365"] },
  items: [
    row("claude", "Claude", "llm", "console.anthropic.com", { search: "native" }),
    row("gemini", "Gemini", "llm", "aistudio.google.com, есть бесплатный тариф", { search: "native" }),
    row("groq", "Groq", "llm", "console.groq.com, есть бесплатный тариф", { search: "duckduckgo" }),
    row("openai", "Другая модель", "llm", "OpenAI, OpenRouter, DeepSeek или своя: адрес API и название модели", { search: "duckduckgo", custom: true }),
    row("espn", "ESPN", "football", "Live, события, составы, статистика. Без ключа, но API неофициальный", { source: "keyless", connected: true }),
    row("football_data", "football-data.org", "football", "Бесплатно: 12 турниров, расписание и таблицы. Счёт с задержкой"),
    row("api_football", "API-Football", "football", "Форма и личные встречи для прогноза. Бесплатно 100 запросов в день"),
    row("odds_api", "The Odds API", "odds", "Кэфы букмекеров: без них не считается перевес. Бесплатно 500 запросов в месяц"),
  ],
};

const SITE_LABEL: Record<string, string> = { fonbet: "Fonbet", winline: "Winline", leon: "Leon", "1xbet": "1xBet", bet365: "bet365" };

const fetchState = async (): Promise<State> => {
  try {
    return { ...(await api.get<Omit<State, "demo">>("/api/connections")), demo: false };
  } catch {
    return DEMO;
  }
};

/** Real API when it answers, otherwise a local demo that never keeps a key anywhere. */
function useConnections() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["connections"], queryFn: fetchState, retry: false, staleTime: 30_000 });
  const data = query.data ?? DEMO;
  const put = (next: State) => qc.setQueryData(["connections"], next);
  const send = async (path: string, body?: unknown) => {
    put({ ...(await api.post<Omit<State, "demo">>(path, body)), demo: false });
  };
  const patchItem = (name: string, change: Partial<Item>) =>
    put({ ...data, items: data.items.map((i) => (i.name === name ? { ...i, ...change } : i)) });
  return { data, loading: query.isPending, send, put, patchItem };
}

function ConnectionForm({ item, onDone }: { item: Item; onDone?: () => void }) {
  const { data, send, patchItem } = useConnections();
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [baseUrl, setBaseUrl] = useState(item.base_url ?? "");
  const [model, setModel] = useState(item.model ?? "");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const body = { key: key || null, base_url: baseUrl || null, model: model || null };

  async function test() {
    setBusy("test");
    setResult(null);
    try {
      if (data.demo) {
        setResult({ ok: false, detail: "Демо: настоящая проверка работает с запущенным сервером" });
      } else {
        setResult(await api.post<{ ok: boolean; detail: string }>(`/api/connections/${item.name}/test`, body));
      }
    } catch (e) {
      setResult({ ok: false, detail: e instanceof Error ? e.message : "Не удалось проверить" });
    }
    setBusy(null);
  }

  async function save() {
    if (item.custom && !(baseUrl && model)) {
      setResult({ ok: false, detail: "Укажите адрес API и название модели" });
      return;
    }
    if (!key && !item.connected) {
      setResult({ ok: false, detail: "Вставьте ключ" });
      return;
    }
    setBusy("save");
    try {
      if (data.demo) {
        // The demo keeps only the same masked tail a real save would show.
        patchItem(item.name, { connected: true, source: "app", masked: key.length >= 12 ? `••••${key.slice(-4)}` : "••••", model: model || null, base_url: baseUrl || null });
      } else {
        await send(`/api/connections/${item.name}`, body);
      }
      setKey("");
      onDone?.();
    } catch (e) {
      setResult({ ok: false, detail: e instanceof Error ? e.message : "Не удалось сохранить" });
    }
    setBusy(null);
  }

  return (
    <div className="pn-stack" style={{ gap: 10 }}>
      <p className="pn-small pn-muted">{item.hint}</p>
      {item.custom && (
        <>
          <label className="pn-stack" style={{ gap: 4 }}>
            <span className="pn-small pn-muted">Адрес API</span>
            <input className="pn-input pn-input--text" placeholder="https://api.openai.com/v1" autoComplete="off" spellCheck={false} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </label>
          <label className="pn-stack" style={{ gap: 4 }}>
            <span className="pn-small pn-muted">Модель</span>
            <input className="pn-input pn-input--text" placeholder="gpt-5" autoComplete="off" spellCheck={false} value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
        </>
      )}
      <label className="pn-stack" style={{ gap: 4 }}>
        <span className="pn-small pn-muted">{item.connected ? `Новый ключ, сейчас ${item.masked ?? "сохранён"}` : "Ключ"}</span>
        <span className="pn-keyfield">
          <input className="pn-input pn-input--text" type={show ? "text" : "password"} autoComplete="off" spellCheck={false} placeholder="Вставьте ключ" value={key} onChange={(e) => { setKey(e.target.value); setResult(null); }} />
          <button type="button" className="pn-icon" aria-label={show ? "Скрыть ключ" : "Показать ключ"} onClick={() => setShow((v) => !v)}>
            {show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </span>
      </label>
      <AnimatePresence mode="popLayout" initial={false}>
        {result && (
          <motion.p key={result.detail} className="pn-testresult" data-ok={result.ok} role="status" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={M.spring.snappy}>
            {result.ok ? <Check size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />} {result.detail}
          </motion.p>
        )}
      </AnimatePresence>
      <div className="pn-grid2">
        <motion.button className="pn-btn pn-btn--line" whileTap={{ scale: M.press }} disabled={!!busy} onClick={test}>{busy === "test" ? "Проверяем…" : "Проверить"}</motion.button>
        <motion.button className="pn-btn pn-btn--primary" whileTap={{ scale: M.press }} disabled={!!busy} onClick={save}>{busy === "save" ? "Сохраняем…" : "Сохранить"}</motion.button>
      </div>
      {!data.demo && !data.can_store && (
        <p className="pn-flag">Сохранение выключено: на сервере нет SHADOWSCOUT_SECRET_KEY.</p>
      )}
    </div>
  );
}

function ConnectionSheet({ item, onClose }: { item: Item; onClose: () => void }) {
  const { data, send, patchItem } = useConnections();
  async function remove() {
    if (data.demo) patchItem(item.name, { connected: false, source: "none", masked: null });
    else await send(`/api/connections/${item.name}/delete`);
    onClose();
  }
  return (
    <Sheet title={item.label} onClose={onClose}>
      <h2>{item.label}</h2>
      <ConnectionForm item={item} onDone={onClose} />
      {item.source === "app" && (
        <motion.button className="pn-btn pn-btn--text" style={{ color: "var(--bad)" }} whileTap={{ scale: M.press }} onClick={remove}>Отключить</motion.button>
      )}
      {item.source === "env" && <p className="pn-small pn-muted">Сейчас ключ берётся из файла .env. Новый ключ из приложения будет важнее.</p>}
    </Sheet>
  );
}

function ConnectionRow({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const tone = item.needs_reentry ? "warn" : item.connected ? "good" : "off";
  const text = item.needs_reentry ? "Введите ключ заново" : item.source === "keyless" ? "Без ключа" : item.connected ? `${item.source === "env" ? ".env " : ""}${item.masked ?? ""}` : "Не подключено";
  return (
    <motion.button className="pn-conn" layout onClick={onOpen} disabled={item.source === "keyless"} whileTap={{ scale: 0.985 }}>
      <span className="pn-conn__dot" data-tone={tone} aria-hidden="true" />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="pn-conn__label">{item.label}</span>
        <span className="pn-small pn-muted">{text}</span>
      </span>
      {item.source !== "keyless" && <ChevronRight size={17} color="var(--tx2)" aria-hidden="true" />}
    </motion.button>
  );
}

function ModelChain() {
  const { data, send, put } = useConnections();
  const llms = data.items.filter((i) => i.group === "llm" && i.connected);
  const primary = data.items.find((i) => i.name === data.primary);
  const [error, setError] = useState("");

  async function change(next: string, fallbacks: string[]) {
    setError("");
    try {
      if (data.demo) put({ ...data, primary: next, fallbacks });
      else await send("/api/connections/llm", { primary: next, fallbacks });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сменить модель");
    }
  }

  if (!llms.length) return <p className="pn-flag">Подключите хотя бы одну модель: прогнозы делает она.</p>;
  return (
    <div className="pn-stack">
      <span className="pn-small pn-muted">Основная модель</span>
      <div className="pn-chips pn-chips--wrap">
        {llms.map((i) => (
          <Chip key={i.name} active={data.primary === i.name} onClick={() => change(i.name, data.fallbacks.filter((f) => f !== i.name))}>{i.label}</Chip>
        ))}
      </div>
      {llms.length > 1 && (
        <>
          <span className="pn-small pn-muted">Запасная, если у основной кончится лимит</span>
          <div className="pn-chips pn-chips--wrap">
            {llms.filter((i) => i.name !== data.primary).map((i) => (
              <Chip key={i.name} active={data.fallbacks.includes(i.name)} onClick={() => change(data.primary, data.fallbacks.includes(i.name) ? data.fallbacks.filter((f) => f !== i.name) : [...data.fallbacks, i.name])}>{i.label}</Chip>
            ))}
          </div>
        </>
      )}
      {primary?.search === "duckduckgo" && <p className="pn-flag">У этой модели нет своего поиска: факты соберём через DuckDuckGo, разбор будет слабее.</p>}
      {error && <p className="pn-small" style={{ color: "var(--bad)" }}>{error}</p>}
    </div>
  );
}

function BookmakerPanel() {
  const { dispatch } = useGame();
  const { data, send, put } = useConnections();
  const [note, setNote] = useState("");

  async function choose(site: string) {
    dispatch({ type: "SET_PREF", prefs: { bookmaker: site } });
    if (data.demo) put({ ...data, bookmaker: { ...data.bookmaker, site } });
    else await send("/api/connections/bookmaker", { site });
  }

  async function open() {
    setNote("");
    if (data.demo) {
      setNote("Демо: с запущенным сервером здесь откроется Chrome на сайте букмекера.");
      return;
    }
    try {
      await api.post("/api/connections/bookmaker/open");
      setNote("Chrome открыт. Войдите на сайте, браузер запомнит вход.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Не удалось открыть браузер");
    }
  }

  return (
    <section className="pn-panel pn-panel--flat">
      <h2 className="pn-h2">Аккаунт букмекера</h2>
      <div className="pn-chips pn-chips--wrap">
        {data.bookmaker.sites.map((site) => (
          <Chip key={site} active={data.bookmaker.site === site} onClick={() => choose(site)}>{SITE_LABEL[site] ?? site}</Chip>
        ))}
      </div>
      <motion.button className="pn-btn pn-btn--ghost" whileTap={{ scale: M.press }} onClick={open}>
        <ExternalLink size={16} aria-hidden="true" /> Открыть сайт и войти
      </motion.button>
      {note && <p className="pn-small pn-muted" role="status">{note}</p>}
      <p className="pn-small pn-muted">Вход делаете вы сами в своём браузере, он запоминает сессию. Пароль приложение не видит и не хранит, а ставку подтверждаете только вы.</p>
    </section>
  );
}

export function ConnectionsSection() {
  const { data } = useConnections();
  const [openName, setOpenName] = useState<string | null>(null);
  const open = data.items.find((i) => i.name === openName);
  const group = (g: Item["group"]) => data.items.filter((i) => i.group === g);
  const phone = typeof document !== "undefined" ? document.querySelector(".pn-phone") : null;

  return (
    <>
      {data.demo && <p className="pn-stop-note" data-tone="warn">Сервер недоступен: это демо, ключи никуда не сохраняются.</p>}
      <section className="pn-panel pn-panel--flat">
        <h2 className="pn-h2">Модель для прогнозов</h2>
        {group("llm").map((i) => <ConnectionRow key={i.name} item={i} onOpen={() => setOpenName(i.name)} />)}
        <ModelChain />
      </section>
      <section className="pn-panel pn-panel--flat">
        <h2 className="pn-h2">Футбольные данные и кэфы</h2>
        {[...group("football"), ...group("odds")].map((i) => <ConnectionRow key={i.name} item={i} onOpen={() => setOpenName(i.name)} />)}
      </section>
      <BookmakerPanel />
      {phone && createPortal(
        <AnimatePresence>{open && <ConnectionSheet key={open.name} item={open} onClose={() => setOpenName(null)} />}</AnimatePresence>,
        phone,
      )}
    </>
  );
}

const STEPS = ["Модель", "Данные", "Банк", "Лиги"];
const WIZARD_LEAGUES = ["Premier League", "La Liga", "Bundesliga", "Serie A"];

/** First run: without a model the app has nothing to show, so setup comes first. */
export function Onboarding() {
  const { state, dispatch } = useGame();
  const { data } = useConnections();
  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState("gemini");
  const [bank, setBank] = useState(String(state.budget));
  const [bankError, setBankError] = useState("");
  const item = (name: string) => data.items.find((i) => i.name === name);
  const llm = item(provider);
  const odds = item("odds_api");

  function finish() {
    rememberOnboarded();
    dispatch({ type: "ONBOARDING", show: false });
  }

  function next() {
    if (step === 2) {
      const n = Number(bank.replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) {
        setBankError("Введите сумму больше нуля");
        return;
      }
      if (n !== state.budget) dispatch({ type: "SET_BUDGET", budget: Math.round(n) });
    }
    if (step === STEPS.length - 1) finish();
    else setStep(step + 1);
  }

  return (
    <motion.div className="pn-wizard" role="dialog" aria-modal="true" aria-label="Первый запуск" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: 30 }} transition={{ duration: M.dur.normal }}>
      <div className="pn-wizard__steps" aria-label={`Шаг ${step + 1} из ${STEPS.length}`}>
        {STEPS.map((s, i) => (
          <span key={s} className="pn-wizard__step" data-on={i <= step}>
            <motion.i initial={false} animate={{ scaleX: i <= step ? 1 : 0 }} transition={M.spring.gentle} />
            {s}
          </span>
        ))}
      </div>
      <div className="pn-wizard__body">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step} className="pn-stack" style={{ gap: 14 }} initial={{ opacity: 0, x: 26 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -26 }} transition={{ duration: M.dur.fast, ease: M.ease.smooth }}>
            {step === 0 && (
              <>
                <h1 className="pn-wizard__title">Выберите модель</h1>
                <p className="pn-muted">Она изучает матч и оценивает шансы команд. Хватит одной, менять можно в любой момент.</p>
                <div className="pn-chips pn-chips--wrap">
                  {data.items.filter((i) => i.group === "llm").map((i) => (
                    <Chip key={i.name} active={provider === i.name} onClick={() => setProvider(i.name)}>{i.label}</Chip>
                  ))}
                </div>
                {llm && <ConnectionForm key={llm.name} item={llm} />}
              </>
            )}
            {step === 1 && (
              <>
                <h1 className="pn-wizard__title">Футбольные данные</h1>
                <p className="pn-muted">Live-матчи уже работают через ESPN без ключа. Кэфы нужны, чтобы считать перевес над рынком.</p>
                {odds && <ConnectionForm item={odds} />}
              </>
            )}
            {step === 2 && (
              <>
                <h1 className="pn-wizard__title">Ваш банк</h1>
                <p className="pn-muted">От него считается размер ставки и стоп по просадке.</p>
                <label className="pn-stack">
                  <span className="pn-small pn-muted">Сумма</span>
                  <input className="pn-input" inputMode="decimal" aria-invalid={!!bankError} value={bank} onChange={(e) => { setBank(e.target.value); setBankError(""); }} />
                </label>
                {bankError && <p className="pn-small" style={{ color: "var(--bad)" }}>{bankError}</p>}
              </>
            )}
            {step === 3 && (
              <>
                <h1 className="pn-wizard__title">Какие лиги смотреть?</h1>
                <p className="pn-muted">По ним бот будет искать матчи с перевесом.</p>
                <div className="pn-chips pn-chips--wrap">
                  {WIZARD_LEAGUES.map((name) => (
                    <Chip
                      key={name}
                      active={state.prefs.leagues.includes(name)}
                      onClick={() => dispatch({ type: "SET_PREF", prefs: { leagues: state.prefs.leagues.includes(name) ? state.prefs.leagues.filter((l) => l !== name) : [...state.prefs.leagues, name] } })}
                    >
                      <LeagueLogo league={name} size={13} /> {name}
                    </Chip>
                  ))}
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="pn-wizard__foot">
        <motion.button className="pn-btn pn-btn--primary" whileTap={{ scale: M.press }} onClick={next}>{step === STEPS.length - 1 ? "Готово" : "Дальше"}</motion.button>
        <button className="pn-btn pn-btn--text" onClick={finish}>Пропустить и посмотреть демо</button>
      </div>
    </motion.div>
  );
}
