# shadowscout Mini App

Интерфейс бота в Telegram: Next.js, React Query, framer-motion. Обзор проекта в
[корневом README](../README.md), визуальный язык в [DESIGN.md](../DESIGN.md).

```bash
npm install
```

```bash
npm run dev
```

Адрес API задаётся в `.env.local` переменной `NEXT_PUBLIC_API_BASE_URL`.

## Устройство `src/`

| Папка | Что внутри | Может импортировать |
|---|---|---|
| `app/` | Страница, стили, маршруты `/feed/*` | всё |
| `features/` | Экраны, по папке на раздел | `ui`, `lib`, `store`, `hooks`, другие разделы |
| `ui/` | Общие элементы и токены анимации (`motion.ts`) | `lib`, `store` |
| `store/` | Состояние приложения | `lib` |
| `hooks/` | Запросы к API | `lib` |
| `lib/` | Клиент API, типы, подписи, источники `lib/feeds/` | только `lib` |

## Проверки

```bash
npm run check && npx tsc --noEmit && npx eslint src
```
