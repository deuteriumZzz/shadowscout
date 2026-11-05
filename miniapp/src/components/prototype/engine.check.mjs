// Self-check for the demo match logic. Run: node src/components/prototype/engine.check.mjs
import assert from "node:assert/strict";
import {
  betFrom,
  betStatus,
  clv,
  DEMO_PICKS,
  edge,
  goalMood,
  isWeak,
  payout,
  pickCrestColor,
  SCENARIOS,
  settle,
  shownLog,
  shownScore,
  standingEvents,
  startSim,
  statsAt,
  teamLogo,
  tickSim,
  trackedBets,
} from "./engine.ts";

import { normalizeEvent, oddsAfterFee } from "./polymarket.ts";
import { findGame, normalizeScoreboard, normalizeSummary, sameTeam } from "./espn.ts";

const [arsenalPick, totalPick, , sevillaPick] = DEMO_PICKS;
const arsenal = betFrom(arsenalPick, "1", 1500);
const draw = betFrom(arsenalPick, "x", 1000);
const over = betFrom(totalPick, "over", 900);
const under = betFrom(totalPick, "under", 900);
const sevilla = betFrom(sevillaPick, "2", 400);

// Bet status follows the score, including after a VAR-cancelled goal.
assert.equal(betStatus(arsenal, 1, 0, 40, false).tone, "good");
assert.equal(betStatus(arsenal, 1, 1, 40, false).tone, "level");
assert.equal(betStatus(arsenal, 0, 1, 40, false).tone, "bad");
assert.equal(betStatus(arsenal, 1, 1, 90, true).label, "Не зашла", "a draw loses a 1X2 team pick");

// The user may take any outcome of the market, not only the recommended one.
assert.equal(settle(draw, 1, 1), "win");
assert.equal(settle(draw, 2, 1), "loss");
assert.equal(betStatus(draw, 1, 1, 40, false).tone, "good");
assert.equal(settle(under, 1, 1), "win");
assert.equal(betStatus(under, 2, 1, 50, false).tone, "bad", "under is lost once the line is crossed");

// A totals pick resolves as soon as the line is crossed, not at full time.
assert.equal(betStatus(over, 2, 1, 50, false).label, "Зашла");
assert.equal(betStatus(over, 1, 1, 50, false).label, "Голов 2 из 3");
assert.equal(betStatus(over, 1, 1, 90, true).tone, "bad");

// Money: a loss costs the stake, a win pays profit only.
assert.equal(payout(arsenal, "win"), 2025);
assert.equal(payout(arsenal, "loss"), -1500);
assert.equal(settle(arsenal, 2, 1), "win");
assert.equal(settle(sevilla, 2, 1), "loss");

// CLV stays honest: Arsenal beat the close, Sevilla did not.
assert.ok(clv(arsenal) > 0);
assert.ok(clv(sevilla) < 0);
assert.ok(isWeak(sevillaPick));
assert.ok(!isWeak(arsenalPick));
assert.ok(Math.abs(edge(arsenalPick) - 0.0945) < 0.001);

// Goal mood: against the team bet is calm; a totals bet follows its direction.
assert.equal(goalMood([arsenal], "away"), "against");
assert.equal(goalMood([over], "away"), "for");
assert.equal(goalMood([under], "home"), "against");

// A stand-in bet keeps the demo playable when nothing was placed.
assert.equal(trackedBets([]).standIn, true);
assert.equal(trackedBets([arsenal]).standIn, false);

// Stats grow with the clock; possession stays a share.
assert.equal(statsAt(0).find((s) => s.label === "Удары").home, 0);
assert.equal(statsAt(90).find((s) => s.label === "Удары").home, 14);
const pos = statsAt(45).find((s) => s.label === "Владение, %");
assert.equal(pos.home + pos.away, 100);

// Every team in the demo has a real logo id, so no card shows a broken crest.
for (const p of DEMO_PICKS) {
  for (const team of [p.home, p.away]) assert.ok(!teamLogo(team).includes("undefined"), team);
}

// Every scenario plays to full time with the expected final score.
const finals = { win: [2, 1], comeback: [2, 1], loss: [1, 2] };
for (const scenario of SCENARIOS) {
  let sim = startSim(scenario.id);
  assert.equal(tickSim(sim, 1).minute, 0, "the clock waits while a moment is on screen");
  for (let i = 0; i < 2000 && sim.status === "playing"; i++) {
    sim = tickSim({ ...sim, moment: null }, 0.15);
  }
  assert.equal(sim.status, "ft", scenario.id);
  assert.equal(sim.idx, scenario.events.length, `${scenario.id}: all events fired`);
  assert.deepEqual([sim.home, sim.away], finals[scenario.id], scenario.id);
}

// A crest's colour: the common saturated hue wins, darkened enough for white text.
const px = (...colors) => colors.flatMap(([r, g, b, n]) => Array.from({ length: n }, () => [r, g, b, 255]).flat());
const red = pickCrestColor(px([230, 30, 40, 50], [255, 255, 255, 80], [20, 90, 200, 10]));
assert.match(red, /^#[0-9a-f]{6}$/);
assert.ok(parseInt(red.slice(1, 3), 16) > parseInt(red.slice(5, 7), 16), "red beats blue, and white is ignored");
const yellow = pickCrestColor(px([250, 220, 20, 50]));
assert.ok(parseInt(yellow.slice(1, 3), 16) < 200, "a bright yellow is darkened so white text stays readable");
assert.equal(pickCrestColor(px([255, 255, 255, 50], [10, 10, 10, 50])), null, "black and white has no team colour");

// Polymarket: a real-shaped event maps to 1 / X / 2 with odds after the fee.
const fee = { feesEnabled: true, feeSchedule: { rate: 0.05 } };
const market = (groupItemTitle, bestAsk) => ({ groupItemTitle, bestAsk, sportsMarketType: "moneyline", acceptingOrders: true, liquidityNum: 1000, ...fee });
const pmEvent = {
  id: 1,
  slug: "epl-eve-cov-2026-11-06",
  title: "Everton FC vs. Coventry City FC",
  startTime: "2026-11-06T20:00:00Z",
  volume: "8027",
  teams: [
    { name: "Everton FC", logo: "https://x/e.png", color: "#134F89", ordering: "home" },
    { name: "Coventry City FC", logo: "https://x/c.png", ordering: "away" },
  ],
  // Deliberately out of order: mapping must follow names, not position.
  markets: [market("Coventry City FC", 0.2), market("Draw (Everton FC vs. Coventry City FC)", 0.24), market("Everton FC", 0.57)],
};
const before = Date.parse("2026-11-05T00:00:00Z");
const pm = normalizeEvent(pmEvent, "Premier League", before);
assert.deepEqual(pm.options.map((o) => [o.id, o.price]), [["1", 0.57], ["x", 0.24], ["2", 0.2]]);
assert.equal(pm.home.name, "Everton");
assert.equal(pm.url, "https://polymarket.com/event/epl-eve-cov-2026-11-06");
assert.ok(Math.abs(oddsAfterFee(0.4, 0.05) - 2.427) < 0.001, "40 cents is 2.50 before the fee and about 2.43 after");
assert.ok(pm.options[0].odds < 1 / 0.57, "the fee lowers the odds");
const noFee = normalizeEvent({ ...pmEvent, markets: pmEvent.markets.map((m) => ({ ...m, feesEnabled: false })) }, "x", before);
assert.ok(Math.abs(noFee.options[0].odds - 1 / 0.57) < 1e-9);
// Anything incomplete or ambiguous is dropped, never guessed.
assert.equal(normalizeEvent({ ...pmEvent, title: "Everton FC vs. Coventry City FC - Total Corners" }, "x", before), null, "props aren't the match");
assert.equal(normalizeEvent(pmEvent, "x", Date.parse("2026-11-07T00:00:00Z")), null, "already started");
assert.equal(normalizeEvent({ ...pmEvent, markets: pmEvent.markets.slice(1) }, "x", before), null, "an outcome is missing");
assert.equal(normalizeEvent({ ...pmEvent, markets: [...pmEvent.markets, market("Everton FC", 0.5)] }, "x", before), null, "two markets claim one outcome");
assert.equal(normalizeEvent({ ...pmEvent, markets: pmEvent.markets.map((m) => ({ ...m, acceptingOrders: false })) }, "x", before), null, "not taking orders");
assert.equal(normalizeEvent({ ...pmEvent, markets: pmEvent.markets.map((m) => ({ ...m, bestAsk: undefined })) }, "x", before), null, "no price");
assert.equal(normalizeEvent({ ...pmEvent, teams: [pmEvent.teams[0]] }, "x", before), null, "a team is missing");

// Pairing feeds: the names differ, and a wrong link would show another match's statistics.
for (const [a, b] of [["Bayern Munich", "FC Bayern München"], ["Monchengladbach", "Borussia Mönchengladbach"], ["Man United", "Manchester United FC"], ["Strasbourg", "RC Strasbourg Alsace"], ["Alavés", "Deportivo Alavés"], ["Leverkusen", "Bayer 04 Leverkusen"], ["Mainz", "1. FSV Mainz 05"], ["Espanyol", "RCD Espanyol de Barcelona"], ["Hamburg SV", "Hamburger SV"], ["Brest", "Stade Brestois 29"], ["Lyon", "Olympique Lyonnais"], ["Internazionale", "FC Internazionale Milano"], ["Como", "Como 1907"], ["Troyes", "ES Troyes AC"], ["Stade Rennais", "Stade Rennais FC 1901"], ["PSG", "Paris Saint-Germain"]]) {
  assert.ok(sameTeam(a, b), `${a} is ${b}`);
}
for (const [a, b] of [["Manchester United", "Manchester City"], ["Real Madrid", "Real Sociedad"], ["Inter", "AC Milan"], ["Paris FC", "Paris Saint-Germain"], ["Olympique Lyonnais", "Olympique de Marseille"]]) {
  assert.ok(!sameTeam(a, b), `${a} isn't ${b}`);
}
const side = (name, fullName = name) => ({ name, fullName, logo: "", score: 0, form: [] });
const game = (id, home, away, start) => ({ id, code: "x", league: "x", start, state: "pre", clock: "", home: typeof home === "string" ? side(home) : home, away: typeof away === "string" ? side(away) : away });
const at = "2026-11-07T15:00:00.000Z";
assert.equal(findGame([game("1", "Paris Saint-Germain", "Troyes", at)], "Paris Saint-Germain", "ES Troyes AC", at)?.id, "1");
assert.equal(findGame([game("1", side("Spurs", "Tottenham Hotspur"), "Leeds", at)], "Tottenham Hotspur", "Leeds United", at)?.id, "1", "a nickname falls back to the full name");
assert.equal(findGame([game("1", "Paris Saint-Germain", "Troyes", at)], "Paris FC", "Auxerre", at), null, "both clubs must match");
assert.equal(findGame([game("1", "Arsenal", "Hull", "2026-11-14T15:00:00.000Z")], "Arsenal", "Hull", at), null, "a rematch on another day isn't this match");
assert.equal(findGame([game("1", "Arsenal", "Hull", at), game("2", "Arsenal", "Hull", at)], "Arsenal", "Hull", at), null, "two candidates means no link");
assert.equal(findGame([game("1", "Hull", "Arsenal", at)], "Arsenal", "Hull", at), null, "home and away must line up");

// The scoreboard skips what it can't read instead of inventing it.
const board = normalizeScoreboard({ events: [
  { id: "9", date: "2026-11-07T12:30Z", status: { displayClock: "67'", type: { state: "in" } }, competitions: [{ competitors: [
    { homeAway: "home", score: "2", form: "WDL", team: { shortDisplayName: "Leeds", logo: "l.png" } },
    { homeAway: "away", score: "1", team: { displayName: "Tottenham Hotspur", logo: "t.png" } },
  ] }] },
  { id: "8", date: "2026-11-07T12:30Z", status: { type: { state: "pre" } }, competitions: [{ competitors: [] }] },
] }, "eng.1", "Premier League");
assert.equal(board.length, 1);
assert.deepEqual([board[0].state, board[0].clock, board[0].home.score, board[0].away.score], ["in", "67'", 2, 1]);
assert.deepEqual(board[0].home.form, ["loss", "draw", "win"], "oldest first, like the summary");

// The match centre, from the shapes ESPN really returns.
const starter = (name, position, jersey) => ({ starter: true, jersey, position: { abbreviation: position }, athlete: { displayName: name } });
const eleven = [starter("David Raya", "G", "1"), starter("Ben White", "RB", "4"), starter("Gabriel Magalhães", "CD-L", "6"), starter("William Saliba", "CD-R", "2"), starter("Riccardo Calafiori", "LB", "33"), starter("Declan Rice", "DM", "41"), starter("Martin Zubimendi", "DM", "36"), starter("Bukayo Saka", "RM", "7"), starter("Martin Ødegaard", "AM", "8"), starter("Gabriel Martinelli", "LM", "11"), starter("Viktor Gyökeres", "F", "14")];
const summary = normalizeSummary({
  header: { competitions: [{ status: { displayClock: "90'+5'", type: { state: "post" } }, competitors: [
    { homeAway: "home", score: "3", team: { displayName: "Arsenal" } },
    { homeAway: "away", score: "0", team: { displayName: "Coventry City" } },
  ] }] },
  keyEvents: [
    { type: { text: "Kickoff" } },
    { type: { text: "Goal" }, scoringPlay: true, clock: { displayValue: "15'" }, team: { displayName: "Arsenal" }, participants: [{ athlete: { displayName: "Kai Havertz" } }, { athlete: { displayName: "Riccardo Calafiori" } }] },
    { type: { text: "Yellow Card" }, clock: { displayValue: "27'" }, team: { displayName: "Coventry City" }, participants: [{ athlete: { displayName: "Caleb Yirenkyi" } }] },
    { type: { text: "Substitution" }, clock: { displayValue: "62'" }, team: { displayName: "Coventry City" }, participants: [{ athlete: { displayName: "Victor Torp" } }, { athlete: { displayName: "Caleb Yirenkyi" } }] },
  ],
  boxscore: { teams: [
    { homeAway: "home", statistics: [{ name: "possessionPct", displayValue: "64.5" }, { name: "totalShots", displayValue: "20" }] },
    { homeAway: "away", statistics: [{ name: "possessionPct", displayValue: "35.5" }, { name: "totalShots", displayValue: "4" }] },
  ] },
  rosters: [
    { homeAway: "home", formation: "4-2-3-1", roster: [...eleven, { starter: false, jersey: "22", position: { abbreviation: "SUB" }, athlete: { displayName: "Ethan Nwaneri" } }] },
    { homeAway: "away", formation: "4-2-3-1", roster: eleven },
  ],
  lastFiveGames: [{ team: { displayName: "Arsenal" }, events: [{ gameResult: "W" }, { gameResult: "D" }] }],
  standings: { groups: [{ standings: { entries: [{ team: "Arsenal", stats: [{ name: "rank", displayValue: "1" }, { name: "points", displayValue: "24" }, { name: "gamesPlayed", displayValue: "9" }] }] } }] },
});
assert.deepEqual([summary.state, summary.homeScore, summary.awayScore], ["post", 3, 0]);
assert.deepEqual(summary.events.map((e) => [e.kind, e.side, e.player, e.other]), [["goal", "home", "Kai Havertz", "Riccardo Calafiori"], ["yellow", "away", "Caleb Yirenkyi", null], ["sub", "away", "Victor Torp", "Caleb Yirenkyi"]]);
assert.deepEqual(summary.stats[0], { label: "Владение, %", home: 64.5, away: 35.5, share: true });
assert.deepEqual(summary.form.home, ["win", "draw"]);
assert.deepEqual(summary.table.home, { rank: 1, points: 24, played: 9 });
assert.equal(summary.table.away, null);
const lines = summary.lineups.home.lines;
assert.deepEqual(lines.map((l) => l.length), [1, 4, 2, 3, 1], "a 4-2-3-1 really is 1+4+2+3+1");
assert.equal(lines[0][0].name, "Raya", "goalkeeper at the back");
assert.deepEqual(lines[1].map((p) => p.name), ["Calafiori", "Magalhães", "Saliba", "White"], "full-backs outside centre-backs, left to right");
assert.equal(lines[4][0].name, "Gyökeres", "striker up front");
assert.deepEqual(summary.lineups.home.subs.map((s) => s.name), ["Nwaneri"]);
// Before the team sheet: no line-up at all, rather than a made-up one.
assert.equal(normalizeSummary({ rosters: [{ homeAway: "home", formation: "4-3-3", roster: [] }, { homeAway: "away", formation: "4-3-3", roster: [] }] }).lineups, null);
assert.deepEqual(normalizeSummary({}).events, [], "an empty answer doesn't crash");

// The board holds a new goal back until its panel leaves, and VAR likewise.
const goalEvent = { minute: 31, type: "goal", side: "home", player: "Havertz" };
const varEvent = { minute: 33, type: "var_cancel", side: "home", player: "Havertz" };
const during = { ...startSim("win"), home: 1, away: 1, log: [goalEvent], moment: goalEvent };
assert.deepEqual(shownScore(during), { home: 0, away: 1 });
assert.equal(shownLog(during).length, 0);
assert.deepEqual(shownScore({ ...during, moment: null }), { home: 1, away: 1 });
assert.deepEqual(shownScore({ ...during, home: 0, moment: varEvent }), { home: 1, away: 1 });

// VAR removes only that side's latest goal, so the same scorer can still score again.
const later = { ...goalEvent, minute: 70 };
assert.equal(standingEvents([goalEvent, varEvent, later]).filter((e) => e.type === "goal").length, 1);
assert.equal(standingEvents([goalEvent, varEvent]).length, 0);

console.log("engine: ok");
