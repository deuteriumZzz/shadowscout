# Design

<!-- impeccable:design-schema 1 -->

> The sections below describe the live dashboard at `/`. Its replacement is
> being built at `/prototype`, see "Direction: match centre" at the end.

## World

Dark Premium fintech dashboard (Stripe/Vercel register) with one football
reference: a pitch-green accent and a barely-visible pitch-marking grid
texture (`.pitch-texture`, 4% opacity) behind the header. Mode: Operate —
the visitor is completing a task (review a pick, mark it placed/skipped,
check bankroll health), not being persuaded. No hero, no marketing copy,
no illustration.

## Palette

Both light and dark are real, selected modes — the app follows Telegram's
own `colorScheme`, not a manual toggle. Tokens live in
`miniapp/src/app/globals.css` as CSS custom properties (`:root` = light,
`.dark` = dark), consumed through Tailwind v4's `@theme inline` mapping.

| Role | Light | Dark |
|---|---|---|
| background | `#f8fafc` | `#020617` |
| card | `#ffffff` | `#0e1223` |
| primary (pitch-green) | `#16a34a` | `#22c55e` |
| secondary / muted | `#f1f5f9` / `#64748b` | `#1e293b` / `#94a3b8` |
| destructive (loss/stop) | `#dc2626` | `#ef4444` |
| positive (win, mirrors primary) | `#16a34a` | `#22c55e` |
| warning (steam/unverified price) | `#d97706` | `#f59e0b` |
| border | `#e2e8f0` | `#334155` |
| chart 1–5 | green/red/amber/blue/slate, same hexes as the roles above |

Status colors used specifically for win/loss (`#0ca30c` good / `#d03b3b`
critical, from the dataviz skill's fixed status palette) are a **separate,
never-themed** pair reserved for that one meaning — chosen because win/loss
is inherently a red/green pair that fails colorblind hue-separation, so
every place it appears (stats chart legend, history table) also carries an
icon (✓/✗) and text label, never color alone.

## Typography

Inter (UI text, headings) + JetBrains Mono (all numeric data — odds, stakes,
percentages, currency — via `.tabular-nums`), loaded through `next/font`
as `--font-sans` / `--font-mono`. No serif, no display face — this is a
data tool, not an editorial surface.

## Components

shadcn/ui on Base UI primitives (`@base-ui/react`, this project's shadcn
preset — not Radix; triggers use the `render` prop, active states use
`data-active`, not `data-[state=active]`). Tabs, Dialog, Sheet, Table,
Badge, Progress, Input, Label, Card, Skeleton.

## Layout

Single-page app shell: header (wordmark + pitch texture) → scrollable
content region → fixed bottom tab bar (5 tabs: Лента / Банкролл /
Статистика / История / Настройки), safe-area-aware
(`env(safe-area-inset-*)`) for Telegram's WebView chrome. No sidebar, no
scroll-snap sections — this is a tabbed dashboard, not a scrolling
narrative.

## Motion

framer-motion: spring-based card enter/exit in the picks feed
(`AnimatePresence` + `layout`), `whileTap` scale on the Ставлю/Пропускаю
buttons paired with Telegram `HapticFeedback`. Lottie reserved for the
loading state (not yet wired to a specific asset — plain spinner ships
today, swap in a football-themed Lottie animation when one is chosen).

## Data visualization

Recharts for the one real chart (by-league win/loss, `stats-panel.tsx`).
Every other metric (winrate, ROI, CLV, Brier/log-loss) is a stat tile, not
a chart — per the dataviz skill's own principle that a single number
doesn't need a plot. Charts carry a hover tooltip and a legend with
icon+label (see Palette above).

## States

Every list/stat view has three real states — loading (`LoadingState`),
error with retry (`ErrorState`), and a considered empty state
(`EmptyState`, per-screen copy) — never a placeholder assuming data
exists, per PRODUCT.md's Evidence on Hand.

## Direction: match centre (`/prototype`, demo data)

Replaces the "dry fintech" world above once approved. A calm sports app in the
spirit of Sofascore or FotMob, where betting is the centre and real club crests
bring the colour. Playfulness is reserved for football moments, never the chrome.

**Tokens** live in `miniapp/src/app/prototype/prototype.css`, scoped under
`.pn-stage`, with a separate light set under `[data-theme="light"]`. Surfaces
`--bg --s1 --s2 --s3`; text `--tx --tx2`; `--accent` green for actions and the
bot's advice; `--gold` only for money won; `--live` red for live and stop;
`--warn` amber for caution. Numbers use Oswald, body text Inter.

**Motion** tokens are the `M` object in `prototype/fx.tsx` (durations, easings,
springs). Rules:
- Motion follows events and shows cause and effect: odds fly into the coupon, a
  card grows into its sheet and back, money lands and only then the bank rolls.
- Nothing loops at rest except the live dot.
- A goal plays out in order: broadcast panel, then the board updates, then the
  bet card flips. A goal against the bet stays neutral.
- Everything honours reduced motion and the "Меньше анимации" switch.

**Haptics**: light for taps, medium for a goal against, success for a goal for
and for confirming, warning for VAR and red cards.

**Football language that stays**: red card for a stop, yellow card icon for a
caution, the rolling ball in the dock, fan reactions, confetti on a winning full
time, keepy-uppy on an empty feed.

**Deliberately excluded**: levels, XP, streaks and login rewards, anything that
celebrates placing a bet, any nudge to bet more or to chase a loss.

**States**: every data view handles loading, empty, error, offline, stale and
"no key", through the one `FeedNotice` / note pattern. Data shows its age and
source ("Обновлено 12 с назад", "Claude, оценено 12 мин назад").

**Trust**: facts behind a pick carry a "Факт" or "Слух" tag. Bank changes only
after an explicit confirm. Limits and a 24-hour pause sit next to the money.
