# Design

<!-- impeccable:design-schema 1 -->

## World

A calm sports app in the spirit of Sofascore or FotMob, where betting is the
centre and real club crests bring the colour. Playfulness is reserved for football
moments, never the chrome. Mode: Operate, one person reviewing matches and acting
on them.

## Palette

Tokens live in `miniapp/src/app/theme.css`, scoped under `.pn-stage`, with a
separate light set under `[data-theme="light"]`. Both themes are real, selected
modes.

| Role | Tokens | Rule |
|---|---|---|
| Surfaces | `--bg --s1 --s2 --s3` | Neutral, so crests carry the colour |
| Text | `--tx --tx2` | Values and labels stay in these |
| Action | `--accent` | Actions and the bot's advice |
| Money | `--gold` | Only money won |
| Live, stop | `--live` | Live state and stop |
| Caution | `--warn` | Caution |
| Win, loss | `--good --bad` | Always with an icon or text, never colour alone |

## Typography

Inter for text (`--font-sans`, loaded in `app/layout.tsx`), Oswald for numbers
(`--font-display`, loaded in `app/page.tsx`), with tabular figures.

## Layout

One app shell: app bar, scrolling content, bottom dock with five tabs (Ставки,
Live, Банк, Статистика, Настройки), safe-area aware for Telegram's WebView. One
match screen for the whole app, so Telegram's Back button closes it from any tab.

## Motion

Tokens are the `M` object in `miniapp/src/ui/motion.ts` (durations, easings,
springs), used through framer-motion. Rules:

- Motion follows events and shows cause and effect: a card grows into its sheet and
  back, money lands and only then the bank rolls.
- Nothing loops at rest except the live dot.
- A goal plays out in order: broadcast panel, then the board updates, then the bet
  card flips. A goal against the bet stays neutral.
- Everything honours reduced motion and the "Меньше анимации" switch.

## Haptics

Light for taps, medium for a goal against, success for a goal for and for
confirming, warning for VAR and red cards.

## Football language

Stays: red card for a stop, yellow card icon for a caution, the rolling ball in the
dock, keepy-uppy on an empty feed.

Excluded: levels, XP, streaks and login rewards, anything that celebrates placing a
bet, any nudge to bet more or to chase a loss.

## States

Every data view handles loading, empty, error, offline, stale and "no key" through
the one `FeedNotice` pattern. Data shows its age and source. A figure that failed to
load reads "нет данных", never 0. No demo data on any screen.

## Trust

Facts behind a forecast show their source and date. The bank changes only after an
explicit confirm. Limits and a pause sit next to the money.
