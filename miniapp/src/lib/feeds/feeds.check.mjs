// Self-check for reading the feeds. Run: npm run check
import assert from "node:assert/strict";
import { normalizeEvent, normalizePrices, oddsAfterFee, positionName } from "./polymarket.ts";
import { findGame, minuteValue, normalizeScoreboard, normalizeSummary, sameTeam } from "./espn.ts";

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

// The match clock and real prices.
assert.equal(minuteValue("49'"), 49);
assert.equal(minuteValue("45'+3'"), 48);
assert.equal(minuteValue(""), null, "no clock isn't minute zero");
assert.deepEqual(normalizePrices({ data: [{ timestamp: 10, price: 0.44, resolution_seconds: 60 }, { timestamp: 20, price: 0, resolution_seconds: 0 }, { price: 0.5 }] }), [{ t: 10, p: 0.44 }], "settlement and broken rows aren't prices");
assert.deepEqual(normalizePrices(null), []);

// Positions in plain language, and honesty about what isn't recognised.
assert.equal(positionName("Will Sunderland AFC win on 2026-08-30?", "Yes"), "Победа Sunderland");
assert.equal(positionName("Will FC Internazionale Milano win on 2026-08-22?", "No"), "Internazionale Milano не выиграет");
assert.equal(positionName("Will Arsenal FC vs. Leeds United FC end in a draw?", "Yes"), "Ничья: Arsenal — Leeds United");
assert.equal(positionName("Everton FC vs. Coventry City FC: O/U 2.5", "Over"), "Больше 2.5: Everton — Coventry City");
assert.equal(positionName("Will the US confirm that aliens exist before 2027?", "Yes"), "Will the US confirm that aliens exist before 2027?: Yes");

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
