import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-bot-token")
os.environ.setdefault("OWNER_TELEGRAM_ID", "12345")

import analysis
import bookmakers
import calibration
import espn_data
import news_feed
import polymarket
import storage
import xg_model

NOW = datetime(2026, 11, 5, 12, tzinfo=timezone.utc)
FUTURE = "2026-11-07T15:00:00Z"
ODDS = {"home": 2.0, "draw": 4.0, "away": 4.0}
FAIR = {"home": 0.5, "draw": 0.25, "away": 0.25}


def quote(ask, bid, liquidity=20000, rate=0.05):
    return {"ask": ask, "bid": bid, "rate": rate, "liquidity": liquidity}


class BlindPromptTests(unittest.TestCase):
    def test_prompt_has_no_price_threshold_or_pick_to_choose(self):
        news = [{"published": NOW, "source": "BBC", "title": "Saka injured", "summary": "Out for weeks", "url": "u"}]
        prompt = analysis.build_prompt("Arsenal", "Leeds", "EPL", 2.5, "[ESPN] form", news)
        for leaked in ("fair probabilit", "overround", "percentage points", '"pick"', "skip", "confidence"):
            self.assertNotIn(leaked, prompt)
        self.assertIn("Do not search for, read or use betting odds", prompt)
        self.assertIn("untrusted data", prompt)
        self.assertIn("[N1]", prompt)


class DecisionTests(unittest.TestCase):
    def test_the_models_gap_is_shrunk_before_it_counts(self):
        # 60% against a 50% market and an even price: 2.5 points, not 10.
        d = analysis.decide_market({"home": 0.6, "draw": 0.2, "away": 0.2}, FAIR, ODDS, True)
        self.assertEqual(d["pick"], "home")
        self.assertAlmostEqual(d["blended_probability"], 0.525)
        self.assertAlmostEqual(d["edge"], 0.025)

    def test_a_small_gap_is_no_bet_with_a_reason(self):
        d = analysis.decide_market({"home": 0.53, "draw": 0.24, "away": 0.23}, FAIR, ODDS, True)
        self.assertIsNone(d["pick"])
        self.assertIn("Перевеса нет", d["reason"])

    def test_a_bet_stays_possible_on_a_real_market(self):
        # Hamburg - Gladbach as Polymarket really priced it: spread and fee cost about 2 points.
        fair = {"home": 0.39, "draw": 0.27, "away": 0.34}
        prices = {"home": 2.43, "draw": 3.57, "away": 2.77}
        too_little = {"home": 0.47, "draw": 0.23, "away": 0.30}
        enough = {"home": 0.53, "draw": 0.20, "away": 0.27}
        self.assertIsNone(analysis.decide_market(too_little, fair, prices, True)["pick"])
        self.assertEqual(analysis.decide_market(enough, fair, prices, True)["pick"], "home")

    def test_a_huge_gap_is_distrust_not_a_big_opportunity(self):
        d = analysis.decide_market({"home": 0.8, "draw": 0.1, "away": 0.1}, FAIR, ODDS, True)
        self.assertIsNone(d["pick"])
        self.assertIn("расходится", d["reason"])

    def test_the_fee_counts_against_the_edge(self):
        estimate = {"home": 0.6, "draw": 0.2, "away": 0.2}
        pricier = {**ODDS, "home": 1.92}  # the same market with a fee on top
        self.assertIsNone(analysis.decide_market(estimate, FAIR, pricier, True)["pick"])

    def test_no_market_or_untrusted_market_is_no_bet(self):
        estimate = {"home": 0.6, "draw": 0.2, "away": 0.2}
        self.assertIsNone(analysis.decide_market(estimate, None, ODDS, True)["pick"])
        self.assertIsNone(analysis.decide_market(estimate, FAIR, ODDS, False)["pick"])
        self.assertIsNone(analysis.decide_market(None, FAIR, ODDS, True)["pick"])

    def test_probabilities_must_be_real(self):
        outcomes = ("home", "draw", "away")
        self.assertIsNone(analysis.clean_probabilities({"home": 0.9, "draw": 0.5, "away": 0.5}, outcomes))
        self.assertIsNone(analysis.clean_probabilities({"home": "0.5", "draw": 0.25, "away": 0.25}, outcomes))
        self.assertIsNone(analysis.clean_probabilities({"home": 1.0, "draw": 0.0, "away": 0.0}, outcomes))
        self.assertIsNone(analysis.clean_probabilities({"home": 0.5, "draw": 0.5}, outcomes))
        self.assertIsNone(analysis.clean_probabilities("0.5", outcomes))
        cleaned = analysis.clean_probabilities({"home": 0.51, "draw": 0.25, "away": 0.25}, outcomes)
        self.assertAlmostEqual(sum(cleaned.values()), 1)


class FactTests(unittest.TestCase):
    NEWS = [{"published": NOW, "source": "BBC Sport", "title": "t", "summary": "s", "url": "https://bbc/1"}]

    def clean(self, *items):
        return analysis.clean_facts(list(items), self.NEWS, NOW)

    def test_a_fact_without_a_source_is_dropped(self):
        facts, dropped = self.clean({"text": "Саид ушёл", "status": "confirmed"}, {"text": "x", "source": "мой инсайдер"})
        self.assertEqual((facts, dropped), ([], 2))

    def test_a_news_id_resolves_to_a_checked_source(self):
        facts, _ = self.clean({"text": "Травма", "status": "confirmed", "source": "N1"})
        self.assertEqual((facts[0]["source"], facts[0]["url"], facts[0]["checked"]), ("BBC Sport", "https://bbc/1", True))

    def test_an_invented_news_id_is_dropped(self):
        self.assertEqual(self.clean({"text": "Травма", "status": "confirmed", "source": "N9"})[1], 1)

    def test_a_url_from_search_is_kept_only_with_a_believable_date_and_stays_unchecked(self):
        ok = {"text": "a", "status": "confirmed", "source": "https://x.io/a", "date": "2026-11-04"}
        old = {**ok, "date": "2024-01-01"}
        future = {**ok, "date": "2026-12-25"}
        nodate = {k: v for k, v in ok.items() if k != "date"}
        facts, dropped = self.clean(ok, old, future, nodate)
        self.assertEqual(len(facts), 1)
        self.assertFalse(facts[0]["checked"])
        self.assertEqual(dropped, 3)

    def test_anything_not_marked_confirmed_is_a_rumour(self):
        facts, _ = self.clean({"text": "a", "status": "точно", "source": "ESPN"})
        self.assertEqual(facts[0]["status"], "rumour")

    def test_garbage_key_factors_dont_crash(self):
        self.assertEqual(analysis.clean_facts("нет", [], NOW), ([], 0))
        self.assertEqual(analysis.clean_facts([1, None], [], NOW), ([], 2))


class AnalyzeFlowTests(unittest.TestCase):
    ANSWER = (
        'Разбор.\n```json\n{"markets": {"1X2": {"home": 0.6, "draw": 0.2, "away": 0.2},'
        ' "totals": {"line": 2.5, "over": 0.5, "under": 0.5}},'
        ' "key_factors": [{"text": "a", "status": "confirmed", "source": "ESPN"},'
        ' {"text": "b", "status": "confirmed", "source": "ESPN"}], "missing": []}\n```'
    )

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db = patch.object(storage, "DB_PATH", f"{self.temp_dir.name}/t.sqlite3")
        self.db.start()
        storage.init_db()
        event = {
            "home": "Arsenal", "away": "Leeds United", "start": FUTURE, "url": "https://polymarket.com/event/a",
            "h2h": {"home": quote(0.5, 0.49, rate=0), "draw": quote(0.25, 0.24, rate=0), "away": quote(0.25, 0.24, rate=0)},
            "totals": {"line": 2.5, "over": quote(0.55, 0.54), "under": quote(0.46, 0.45)},
        }
        self.patches = [
            patch.object(analysis, "BOOKMAKER_ADAPTER", "polymarket"),
            patch.object(polymarket, "list_matches", return_value=[event]),
            patch.object(analysis, "_gather_stats", return_value=("[ESPN] form", True, None, None)),
            patch.object(news_feed, "for_match", return_value=[]),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.db.stop()
        self.temp_dir.cleanup()

    def run_with(self, answer, team_a="Arsenal", team_b="Leeds"):
        class Provider:
            def analyze(self, *args):
                self.prompt = args[3]
                return answer

        provider = Provider()
        with patch.object(analysis.llm_providers, "get_provider_chain", return_value=provider), \
                patch.object(analysis.connections, "llm_chain", return_value=("gemini", [])):
            return analysis.analyze_match(team_a, team_b, "EPL"), provider

    def test_code_picks_and_records_while_the_model_never_saw_the_price(self):
        result, provider = self.run_with(self.ANSWER)
        self.assertEqual([p["pick"] for p in result["picks"]], ["home"])
        self.assertAlmostEqual(result["picks"][0]["edge"], 0.027, places=3)  # market mids scale to 50.25%
        self.assertNotIn("0.49", provider.prompt)
        self.assertNotIn("0.24", provider.prompt)
        stored = storage.recent_forecasts()
        self.assertEqual(len(stored), 1)
        self.assertEqual((stored[0]["provider"], stored[0]["prompt_version"]), ("gemini", analysis.PROMPT_VERSION))
        self.assertAlmostEqual(stored[0]["payload"]["markets"]["h2h"]["estimate"]["home"], 0.6)

    def test_a_no_bet_is_stored_too_otherwise_the_scores_would_flatter_the_model(self):
        answer = self.ANSWER.replace('"home": 0.6, "draw": 0.2, "away": 0.2', '"home": 0.5, "draw": 0.25, "away": 0.25')
        result, _ = self.run_with(answer)
        self.assertEqual(result["picks"], [])
        self.assertEqual(len(storage.recent_forecasts()), 1)

    def test_a_broken_answer_is_an_error_not_a_quiet_skip(self):
        result, _ = self.run_with("Извините, не могу")
        self.assertIn("неверном формате", result["error"])
        self.assertEqual(result["picks"], [])
        self.assertEqual(storage.recent_forecasts(), [])

    def test_too_few_sourced_facts_means_no_bet(self):
        answer = self.ANSWER.replace('{"text": "b", "status": "confirmed", "source": "ESPN"}', '{"text": "b", "source": "ESPN"}')
        result, _ = self.run_with(answer)
        self.assertEqual(result["picks"], [])
        self.assertIn("Мало подтверждённых", result["decisions"][0]["reason"])

    def test_no_statistics_means_no_bet(self):
        with patch.object(analysis, "_gather_stats", return_value=("", False, None, None)):
            result, _ = self.run_with(self.ANSWER)
        self.assertEqual(result["picks"], [])
        self.assertIn("Нет статистики", result["decisions"][0]["reason"])

    def test_the_market_says_who_is_at_home(self):
        result, provider = self.run_with(self.ANSWER, "Leeds", "Arsenal")
        self.assertEqual(result["match"], "Arsenal - Leeds United")
        self.assertIn("Arsenal (home)", provider.prompt)


class ScoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db = patch.object(storage, "DB_PATH", f"{self.temp_dir.name}/t.sqlite3")
        self.db.start()
        storage.init_db()

    def tearDown(self):
        self.db.stop()
        self.temp_dir.cleanup()

    def add(self, estimate, fair, home_goals, away_goals):
        forecast = storage.save_forecast("EPL", "A - B", FUTURE, "gemini", "v", {"markets": {"h2h": {"estimate": estimate, "fair": fair, "line": None}}})
        storage.set_forecast_result(forecast, home_goals, away_goals)

    def test_scores_compare_the_model_with_the_market(self):
        self.add({"home": 0.7, "draw": 0.2, "away": 0.1}, {"home": 0.5, "draw": 0.3, "away": 0.2}, 2, 0)
        scores = storage.forecast_scores()
        self.assertLess(scores["model_brier"], scores["market_brier"])
        self.assertTrue(scores["low_sample"])
        self.assertIsNone(scores["beats_market"], "one good call says nothing yet")

    def test_calibration_learns_from_every_forecast_and_waits_for_a_sample(self):
        self.assertIsNone(calibration.fit_from_storage())
        for i in range(20):
            self.add({"home": 0.7, "draw": 0.2, "away": 0.1}, None, 2 if i % 2 else 0, 0)
        self.assertIsNotNone(calibration.fit_from_storage())

    def test_only_finished_old_forecasts_await_a_result(self):
        past = (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat()
        soon = (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()
        storage.save_forecast("EPL", "A - B", past, "g", "v", {})
        storage.save_forecast("EPL", "C - D", soon, "g", "v", {})
        self.assertEqual([r["match"] for r in storage.forecasts_awaiting_result()], ["A - B"])


class EspnTests(unittest.TestCase):
    def game(self, gid, home, away, start=NOW, completed=False):
        return {"id": gid, "code": "eng.1", "start": start, "completed": completed, "state": "pre",
                "home": {"name": home, "short": "", "score": 1}, "away": {"name": away, "short": "", "score": 0}}

    def test_team_names_across_feeds(self):
        for a, b in (("Stade Brestois 29", "Brest"), ("Hamburger SV", "Hamburg SV"), ("FC Internazionale Milano", "Internazionale"),
                     ("FC Bayern München", "Bayern Munich"), ("Man United", "Manchester United")):
            self.assertTrue(espn_data.same_team(a, b), f"{a} is {b}")
        for a, b in (("Manchester United", "Manchester City"), ("Paris FC", "Paris Saint-Germain"), ("Real Madrid", "Real Sociedad")):
            self.assertFalse(espn_data.same_team(a, b), f"{a} isn't {b}")

    def test_choosing_a_game_needs_both_clubs_and_one_candidate(self):
        one = self.game("1", "Arsenal", "Leeds United")
        self.assertEqual(espn_data.choose_game([one], "Leeds", "Arsenal")["id"], "1")
        self.assertIsNone(espn_data.choose_game([one], "Arsenal", "Everton"))
        self.assertIsNone(espn_data.choose_game([one, self.game("2", "Arsenal", "Leeds United")], "Arsenal", "Leeds"))
        later = NOW + timedelta(days=7)
        self.assertIsNone(espn_data.choose_game([one], "Arsenal", "Leeds", later), "a rematch isn't this match")

    def test_pick_results(self):
        self.assertEqual(espn_data.pick_result("h2h", "home", None, 2, 1), "win")
        self.assertEqual(espn_data.pick_result("h2h", "draw", None, 2, 1), "loss")
        self.assertEqual(espn_data.pick_result("totals", "over", 2.5, 2, 1), "win")
        self.assertEqual(espn_data.pick_result("totals", "under", 2.5, 2, 1), "loss")
        self.assertEqual(espn_data.pick_result("totals", "over", 3.0, 2, 1), "push")
        self.assertIsNone(espn_data.pick_result("totals", "over", None, 2, 1), "no line, no guess")

    def test_settling_never_touches_a_model_and_follows_the_stored_home_side(self):
        pick = {"match": "Leeds - Arsenal", "league": "EPL", "commence_time": FUTURE, "market": "h2h", "pick": "home", "line": None}
        with patch.object(espn_data, "find_game", return_value=self.game("1", "Arsenal", "Leeds United", completed=True)), \
                patch.object(analysis.llm_providers, "get_provider_chain", side_effect=AssertionError("no LLM here")):
            info = analysis.check_result(pick)
        self.assertEqual((info["final_score"], info["pick_result"]), ("0-1", "loss"))

    def test_an_unfinished_game_stays_unknown(self):
        pick = {"match": "Arsenal - Leeds", "league": "EPL", "commence_time": FUTURE, "market": "h2h", "pick": "home", "line": None}
        with patch.object(espn_data, "find_game", return_value=self.game("1", "Arsenal", "Leeds United", completed=False)):
            self.assertEqual(analysis.check_result(pick)["pick_result"], "unknown")

    def test_match_context_reads_espns_shapes(self):
        event = lambda at, h, a, r: {"atVs": at, "homeTeamScore": h, "awayTeamScore": a, "gameResult": r, "gameDate": "2026-10-10T13:30Z", "opponent": {"displayName": "X"}}
        summary = {
            "lastFiveGames": [
                {"team": {"displayName": "Arsenal"}, "events": [event("vs", "2", "0", "W"), event("@", "1", "3", "W"), event("vs", "1", "1", "D")]},
                {"team": {"displayName": "Leeds United"}, "events": [event("@", "2", "2", "D")]},
            ],
            "standings": {"groups": [{"standings": {"entries": [{"team": "Arsenal", "stats": [{"name": "rank", "displayValue": "1"}, {"name": "points", "displayValue": "24"}, {"name": "gamesPlayed", "displayValue": "9"}]}]}}]},
            "seasonseries": [{"summary": "Arsenal leads 3-1", "shortSummary": "Last 5"}],
        }
        with patch.object(espn_data, "_get", return_value=summary):
            context = espn_data.match_context(self.game("1", "Arsenal", "Leeds United"))
        self.assertAlmostEqual(context["rates"]["home"]["for"], 2.0)  # 2, 3 away, 1
        self.assertAlmostEqual(context["rates"]["home"]["against"], 2 / 3)
        self.assertFalse(context["has_form"], "one game for Leeds isn't form")
        self.assertIn("place 1, 24 points", context["text"])
        self.assertIn("starting XI not announced", context["text"])
        self.assertIn("Arsenal leads 3-1", context["text"])


class PolymarketTests(unittest.TestCase):
    def event(self, **over):
        moneyline = lambda name, ask, bid: {"sportsMarketType": "moneyline", "groupItemTitle": name, "bestAsk": ask, "bestBid": bid, "acceptingOrders": True, "liquidityNum": 20000, "feesEnabled": True, "feeSchedule": {"rate": 0.05}}
        return {
            "title": "Arsenal FC vs. Leeds United FC", "slug": "arsenal-leeds", "startTime": FUTURE,
            "teams": [{"name": "Arsenal FC", "ordering": "home"}, {"name": "Leeds United FC", "ordering": "away"}],
            "markets": [moneyline("Arsenal FC", 0.6, 0.59), moneyline("Draw (x)", 0.22, 0.21), moneyline("Leeds United FC", 0.2, 0.19)],
            **over,
        }

    def more(self):
        total = lambda line, ask, bid: {"sportsMarketType": "totals", "line": line, "bestAsk": ask, "bestBid": bid, "acceptingOrders": True, "liquidityNum": 20000, "feesEnabled": True, "feeSchedule": {"rate": 0.05}}
        return {"title": "Arsenal FC vs. Leeds United FC - More Markets", "slug": "m", "startTime": FUTURE, "markets": [total(1.5, 0.8, 0.79), total(2.5, 0.56, 0.55)]}

    def test_reads_results_and_the_main_totals_line(self):
        match = polymarket.normalize_events([self.event(), self.more()], NOW)[0]
        self.assertEqual((match["home"], match["away"]), ("Arsenal", "Leeds United"))
        self.assertEqual(match["totals"]["line"], 2.5)
        self.assertEqual(match["totals"]["under"]["ask"], 0.45, "buying Under is taking the other side of Over")

    def test_drops_props_started_and_incomplete_matches(self):
        self.assertEqual(polymarket.normalize_events([self.event(title="Arsenal FC vs. Leeds United FC - Corners")], NOW), [])
        self.assertEqual(polymarket.normalize_events([self.event(startTime="2026-11-01T15:00:00Z")], NOW), [])
        broken = self.event()
        broken["markets"] = broken["markets"][:2]
        self.assertEqual(polymarket.normalize_events([broken], NOW), [])

    def test_adapter_prices_include_the_fee_and_fair_is_a_real_distribution(self):
        adapter = bookmakers.PolymarketAdapter()
        match = polymarket.normalize_events([self.event(), self.more()], NOW)[0]
        with patch.object(polymarket, "list_matches", return_value=[match]):
            data = adapter.get_market("Arsenal", "Leeds", "EPL", "h2h", None)
        self.assertAlmostEqual(sum(data["fair"].values()), 1)
        self.assertTrue(data["trusted"])
        price, verified = adapter.price_for(match, "h2h", "home")
        self.assertTrue(verified)
        self.assertLess(price, 1 / 0.6, "the fee makes the real odds worse than the bare price")

    def test_thin_or_wide_markets_arent_trusted(self):
        self.assertFalse(polymarket.is_trusted({"home": quote(0.5, 0.49, liquidity=100)}))
        self.assertFalse(polymarket.is_trusted({"home": quote(0.5, 0.40)}))
        self.assertFalse(polymarket.is_trusted({"home": quote(0.5, None)}))


class NewsTests(unittest.TestCase):
    RSS = """<rss><channel>
      <item><title>Saka &lt;b&gt;out&lt;/b&gt; for Arsenal</title><description>Injury</description><link>https://x/1</link><pubDate>Wed, 04 Nov 2026 10:00:00 GMT</pubDate></item>
      <item><title>No date on this Arsenal story</title><link>https://x/2</link></item>
    </channel></rss>"""

    def item(self, title, published=NOW):
        return {"source": "s", "title": title, "summary": "", "url": "u", "published": published}

    def test_rss_is_read_and_cleaned(self):
        items = news_feed.parse_rss(self.RSS, "BBC")
        self.assertEqual([i["title"] for i in items], ["Saka out for Arsenal"])

    def test_only_these_clubs_only_recent_and_nothing_after_kickoff(self):
        items = [
            self.item("Arsenal injury news", NOW - timedelta(days=1)),
            self.item("Chelsea sign someone", NOW - timedelta(days=1)),
            self.item("Old Arsenal story", NOW - timedelta(days=40)),
            self.item("Arsenal won after the match", NOW + timedelta(days=1)),
        ]
        selected = news_feed.select(items, "Arsenal", "Leeds United", NOW)
        self.assertEqual([i["title"] for i in selected], ["Arsenal injury news"])

    def test_clubs_are_told_apart(self):
        self.assertFalse(news_feed.mentions(self.item("Manchester City win again"), "Manchester United"))
        self.assertTrue(news_feed.mentions(self.item("Man United sack the coach"), "Manchester United"))
        self.assertTrue(news_feed.mentions(self.item("Tottenham lose again"), "Tottenham Hotspur"))
        self.assertTrue(news_feed.mentions(self.item("Leeds beat Forest"), "Leeds United"))

    def test_a_dead_feed_means_fewer_items_not_a_failure(self):
        with patch.object(news_feed.requests, "get", side_effect=news_feed.requests.ConnectionError()):
            news_feed._cache.clear()
            self.assertEqual(news_feed.for_match("Arsenal", "Leeds", "EPL"), [])


class XgTests(unittest.TestCase):
    TEAMS = [
        {"display_name": "Arsenal", "games": 10, "xg_for": 2.1, "xg_against": 0.8},
        {"display_name": "Leeds United", "games": 10, "xg_for": 1.0, "xg_against": 1.6},
        {"display_name": "Burnley", "games": 1, "xg_for": 1.0, "xg_against": 1.0},
    ]

    def run_for(self, home, away, league="EPL"):
        with patch.object(xg_model.connections, "get_key", return_value="k"), \
                patch.object(xg_model, "_league_stats", return_value=self.TEAMS):
            return xg_model.match_probabilities(home, away, league)

    def test_stronger_xg_side_is_favoured(self):
        result = self.run_for("Arsenal", "Leeds")
        self.assertGreater(result["h2h"]["home"], result["h2h"]["away"])
        self.assertIn("[StrikerAPI] Arsenal", result["text"])

    def test_skips_quietly_when_it_cant_answer(self):
        self.assertIsNone(self.run_for("Arsenal", "Burnley"), "too few games")
        self.assertIsNone(self.run_for("Arsenal", "Unknown FC"))
        self.assertIsNone(self.run_for("Arsenal", "Leeds", league="РПЛ"), "league not covered")
        with patch.object(xg_model.connections, "get_key", return_value=None):
            self.assertIsNone(xg_model.match_probabilities("Arsenal", "Leeds", "EPL"), "no key")


if __name__ == "__main__":
    unittest.main()
