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
