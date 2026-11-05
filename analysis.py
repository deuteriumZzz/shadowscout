"""Core analysis: gathers market + stats context, asks the configured LLM
provider to research the match once and estimate its own probabilities for
every market we track (1X2, totals), then re-checks each recommendation
locally against the de-vigged market price before it's allowed to reach the
user — the "don't lose to the vig" gate, per market, provider-agnostic.

Guards beyond the edge check itself: a market needs enough corroborating
bookmakers before its price is trusted (bookmakers.py's `trusted` flag — a
single stale/outlier quote isn't a signal); where API_FOOTBALL_KEY is
available, two LLM-independent statistical cross-checks are shown to the LLM
as second opinions and stored alongside the pick — a Poisson goal-rate model
(poisson_model.py, from realized scoring/conceding) and a Poisson xG model
(xg_model.py, from Understat's shot-quality data, so it isn't fooled by the
same finishing variance the goals-based one can be); and once enough settled
history exists, the LLM's raw stated probability is passed through
calibration.py's Platt-scaling fit before the edge check, instead of trusting
it as-is forever."""

from __future__ import annotations

import json
import re

import requests

import bookmakers
import calibration
import football_data
import llm_providers
import poisson_model
import xg_model
import connections
from config import BOOKMAKER_ADAPTER, MIN_MODEL_PROBABILITY

EDGE_THRESHOLD = 0.05  # minimum probability edge over the fair market price to recommend a bet
LEAGUE_SCAN_LIMIT = 12  # fixtures per /league scan — each one is a full LLM call, so this caps cost

# market key -> (label shown in the JSON schema, outcome keys)
MARKET_SCHEMA = {
    "h2h": ("1X2", ("home", "draw", "away")),
    "totals": ("totals", ("over", "under")),
}


def _parse_json_block(text: str) -> dict | None:
    match = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


def _stats_context(team_a: str, team_b: str, total_point: float = 2.5) -> tuple[str, dict | None, dict | None]:
    """Returns (context_text_for_the_prompt, poisson_probabilities_or_None,
    xg_probabilities_or_None). All come from API_FOOTBALL_KEY — recent-form/
    h2h text for the LLM's own research, an independent Poisson goal-rate
    estimate (poisson_model.py), and a second independent estimate from
    shot-quality xG (xg_model.py, via Understat) — neither the LLM nor each
    other controls these, so the LLM's own stated probability isn't graded
    solely by the system that produced it, and goals-based vs xG-based
    disagreement is itself informative (finishing variance vs real chances)."""
    api_key = connections.get_key("api_football")
    if not api_key:
        return "", None, None
    try:
        id_a = football_data.find_team_id(team_a, api_key)
        id_b = football_data.find_team_id(team_b, api_key)
        if not (id_a and id_b):
            return "", None, None
        form_a = football_data.recent_form(id_a, api_key)
        form_b = football_data.recent_form(id_b, api_key)
        h2h = football_data.head_to_head(id_a, id_b, api_key)
        text = f"{team_a} last 5: {form_a}\n{team_b} last 5: {form_b}\nHead-to-head: {h2h}\n"

        poisson = poisson_model.match_probabilities(id_a, id_b, api_key, total_point)
        if poisson:
            eg = poisson["expected_goals"]
            text += (
                f"\nIndependent statistical model (Poisson goal-rate from recent scoring/conceding "
                f"rates, not from the LLM) — expected goals: {team_a} {eg['home']:.2f}, "
                f"{team_b} {eg['away']:.2f}. 1X2: {poisson['h2h']}. Totals ({total_point}): "
                f"{poisson['totals']}. Treat this as one more input, not ground truth — it has no "
                f"knowledge of injuries, motivation, or lineup news, so weigh it against what you find "
                f"yourself rather than deferring to it.\n"
            )

        xg = xg_model.match_probabilities(team_a, team_b, api_key, total_point)
        if xg:
            eg = xg["expected_goals"]
            text += (
                f"\nIndependent xG-based model (shot-quality expected goals from Understat, not "
                f"realized scoring — filters out finishing variance) — expected goals: {team_a} "
                f"{eg['home']:.2f}, {team_b} {eg['away']:.2f}. 1X2: {xg['h2h']}. Totals "
                f"({total_point}): {xg['totals']}. Also just one more input, not ground truth.\n"
            )
        return text, poisson, xg
    except requests.RequestException:
        return "", None, None


def analyze_match(team_a: str, team_b: str, league_hint: str | None = None) -> dict:
    adapter = bookmakers.get_adapter(BOOKMAKER_ADAPTER)
    market_data = {m: adapter.get_market(team_a, team_b, league_hint, m, connections.get_key("odds_api")) for m in bookmakers.MARKETS}
    totals_point = float(market_data["totals"]["line"]) if market_data["totals"]["line"] else 2.5
    stats_text, poisson, xg = _stats_context(team_a, team_b, totals_point)

    context_blocks = [d["context_text"] for d in market_data.values() if d["context_text"]]
    market_text = "\n".join(context_blocks)

    schema_parts = []
    for label, outcomes in MARKET_SCHEMA.values():
        probs = ", ".join('"%s": 0.0' % k for k in outcomes)
        schema_parts.append(
            '"%s": {"model_probabilities": {%s}, "pick": "%s|skip", "confidence": "low|medium|high"}'
            % (label, probs, "|".join(outcomes))
        )
    schema_fields = ",\n".join(schema_parts)

    user_prompt = f"""Analyze the upcoming football match: {team_a} vs {team_b}{f' ({league_hint})' if league_hint else ''}.

Use web search to check each of these for both teams:
- Form: the last 5-6 games, results and performance, not just the table.
- Availability: injuries and suspensions of key players, and who is returning.
- Line-ups: confirmed or expected starting XI. Say so plainly if it isn't announced yet.
- Dressing room: conflicts, unpaid wages, ownership or financial trouble, contract disputes, \
public statements by players or the coach.
- Coaching: recent changes, a coach under pressure, tactical shifts.
- Motivation: table position, title race, relegation battle, European spots, dead rubber, derby.
- Fatigue and calendar: rest days, fixture congestion, European or cup games either side of this \
one, travel, players back from internationals, likely rotation before a bigger game.
- Head-to-head history and typical goal-scoring tendencies (relevant for the totals market).
- Conditions: the referee and their card/penalty tendencies, weather, pitch.

{market_text}
{stats_text}

Weigh these facts together: no single factor decides a match. Separate what is confirmed by a \
reliable source from rumour. A rumour may nudge your estimate but must never justify a pick on \
its own, and many factors already move the market, so ask whether the odds have priced them in. \
If you can't find reliable information on a factor, say so; never invent it.

After your research, write a short human-readable analysis in Russian (a few paragraphs covering \
the factors above, including a note on likely goals for the totals market), followed by a fenced \
```json block with exactly this shape:
{{"markets": {{
{schema_fields}
}}, "key_factors": ["[подтверждено] ...", "[слух] ..."]}}

Each key_factors entry is one short fact in Russian that actually moved your estimate, starting \
with its reliability tag: [подтверждено] or [слух].

Each market's model_probabilities must sum to ~1.0 and reflect your own genuine assessment, not the \
market odds. Only set a market's pick to something other than "skip" if your estimated probability \
for that outcome is meaningfully higher (at least 5 percentage points) than the de-vigged market \
probability given above for that market. If a market had no odds context, only pick when your own \
confidence is high — otherwise skip. It's normal and expected for most markets to come back "skip"."""

    provider = llm_providers.get_provider_chain()
    text = provider.analyze(team_a, team_b, league_hint, user_prompt)
    parsed = _parse_json_block(text) or {}
    markets_out = parsed.get("markets", {})
    key_factors = parsed.get("key_factors", [])

    event = next((d["event"] for d in market_data.values() if d["event"]), None)
    commence_time = adapter.commence_time(event) if event else None

    # fit once per call (global, not per-league — reaches MIN_SAMPLE_FOR_CALIBRATION sooner);
    # None until enough settled history exists, in which case the raw probability is used as-is
    calib_params = calibration.fit_from_storage()

    picks = []
    for market_key, (label, outcomes) in MARKET_SCHEMA.items():
        m_out = markets_out.get(label) or markets_out.get(market_key) or {}
        pick = m_out.get("pick", "skip")
        model_probs = m_out.get("model_probabilities")
        confidence = m_out.get("confidence", "low")
        fair = market_data[market_key]["fair"]

        if not (fair and model_probs and pick in outcomes):
            continue
        if not market_data[market_key]["trusted"]:
            # too few bookmakers corroborating this price (or a stale one) —
            # a single-book edge isn't a signal, see bookmakers.py
            continue
        model_p = model_probs.get(pick)
        fair_p = fair.get(pick)
        if model_p is None or fair_p is None:
            continue

        calibrated_p = calibration.apply(model_p, calib_params) if calib_params else model_p
        edge = calibrated_p - fair_p
        if edge < EDGE_THRESHOLD or calibrated_p < MIN_MODEL_PROBABILITY:
            continue

        poisson_p = poisson.get(market_key, {}).get(pick) if poisson else None
        xg_p = xg.get(market_key, {}).get(pick) if xg else None
        odds, price_verified = adapter.price_for(market_data[market_key]["event"], market_key, pick)

        picks.append({
            "market": market_key,
            "market_label": label,
            "pick": pick,
            "odds": odds,
            "price_verified": price_verified,
            "confidence": confidence,
            "edge": edge,
            "fair_probability": fair_p,
            "model_probability": model_p,
            "calibrated_probability": calibrated_p,
            "poisson_probability": poisson_p,
            "xg_probability": xg_p,
        })

    return {
        "league": league_hint,
        "match": f"{team_a} - {team_b}",
        "commence_time": commence_time,
        "analysis_text": text,
        "key_factors": key_factors,
        "picks": picks,
    }


def scan_league(league_hint: str, limit: int = LEAGUE_SCAN_LIMIT) -> list[dict]:
    """Runs analyze_match over every upcoming fixture in a league — the
    "натравливал на лигу" workflow. Needs ODDS_API_KEY: that's the only
    source we have for "what matches are coming up", and guessing a
    schedule from an LLM's memory/search snippets is exactly the kind of
    thing that quietly invents or misses fixtures."""
    adapter = bookmakers.get_adapter(BOOKMAKER_ADAPTER)
    fixtures = adapter.list_fixtures(league_hint, connections.get_key("odds_api"))[:limit]
    return [analyze_match(home, away, league_hint) for home, away in fixtures]


def check_result(match: str, market_label: str, pick: str) -> dict:
    """Asks the provider to look up whether the match has finished and what
    the final score means for this pick. Never writes anything itself —
    bot.py only calls storage.settle()/record_result() after resolving it."""
    team_a, team_b = (t.strip() for t in match.split(" - ", 1))
    provider = llm_providers.get_provider_chain()
    prompt = f"""Has the football match {match} finished? Search for the final score.
Market: {market_label}. The tracked pick was: {pick}.
Respond with only a fenced ```json block: {{"finished": true|false, "final_score": "H-A or null", \
"pick_result": "win|loss|push|unknown"}}.
Determine pick_result strictly from the actual final score and the market/pick. If you can't find a \
reliable final score, use "unknown" rather than guessing."""
    text = provider.quick_answer(team_a, team_b, f"{match} final score result", prompt)
    return _parse_json_block(text) or {"finished": False, "final_score": None, "pick_result": "unknown"}


def check_late_news(match: str) -> str:
    """Lightweight pre-kickoff recheck — not a full re-analysis, just
    "did anything material change" (lineup news, a late injury)."""
    team_a, team_b = (t.strip() for t in match.split(" - ", 1))
    provider = llm_providers.get_provider_chain()
    prompt = (
        f"Quick check only: any late team news for {match} in the last few hours — confirmed "
        f"lineups, a key player ruled out, a surprising bench decision? A few sentences in Russian, "
        f"or say 'ничего нового' if nothing material changed."
    )
    return provider.quick_answer(team_a, team_b, f"{match} team news lineup today", prompt)
