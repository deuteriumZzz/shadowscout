"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronRight, Eye, EyeOff, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Chip, Sheet } from "@/ui/controls";
import { M } from "@/ui/motion";
import { errorText } from "@/lib/labels";
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
}

const NOTHING: State = { items: [], primary: "", fallbacks: [], bookmaker: { site: "", sites: [] }, can_store: false };

const fetchState = () => api.get<State>("/api/connections");

export function useConnections() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["connections"], queryFn: fetchState, retry: false, staleTime: 30_000 });
  const data = query.data ?? NOTHING;
  const send = async (path: string, body?: unknown) => {
    qc.setQueryData(["connections"], await api.post<State>(path, body));
  };
  return { data, loading: query.isPending, isError: query.isError, error: query.error, send };
}

export function ConnectionForm({ item, onDone }: { item: Item; onDone?: () => void }) {
  const { data, send } = useConnections();
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
      setResult(await api.post<{ ok: boolean; detail: string }>(`/api/connections/${item.name}/test`, body));
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
      await send(`/api/connections/${item.name}`, body);
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
      {!data.can_store && (
        <p className="pn-flag">Сохранение выключено: сервер не смог создать секрет шифрования.</p>
      )}
    </div>
  );
}

function ConnectionSheet({ item, onClose }: { item: Item; onClose: () => void }) {
  const { send } = useConnections();
  async function remove() {
    await send(`/api/connections/${item.name}/delete`);
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
  const { data, send } = useConnections();
  const llms = data.items.filter((i) => i.group === "llm" && i.connected);
  const primary = data.items.find((i) => i.name === data.primary);
  const [error, setError] = useState("");

  async function change(next: string, fallbacks: string[]) {
    setError("");
    try {
      await send("/api/connections/llm", { primary: next, fallbacks });
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

export function ConnectionsSection() {
  const { data, isError, error } = useConnections();
  const [openName, setOpenName] = useState<string | null>(null);
  const open = data.items.find((i) => i.name === openName);
  const group = (g: Item["group"]) => data.items.filter((i) => i.group === g);
  const phone = typeof document !== "undefined" ? document.querySelector(".pn-phone") : null;

  if (isError) return <p className="pn-stop-note" data-tone="warn">{errorText(error)} Подключения недоступны, ключи не сохранятся.</p>;

  return (
    <>
      <section className="pn-panel pn-panel--flat">
        <h2 className="pn-h2">Модель для прогнозов</h2>
        {group("llm").map((i) => <ConnectionRow key={i.name} item={i} onOpen={() => setOpenName(i.name)} />)}
        <ModelChain />
      </section>
      <section className="pn-panel pn-panel--flat">
        <h2 className="pn-h2">Футбольные данные и кэфы</h2>
        {[...group("football"), ...group("odds")].map((i) => <ConnectionRow key={i.name} item={i} onOpen={() => setOpenName(i.name)} />)}
      </section>
      {phone && createPortal(
        <AnimatePresence>{open && <ConnectionSheet key={open.name} item={open} onClose={() => setOpenName(null)} />}</AnimatePresence>,
        phone,
      )}
    </>
  );
}
