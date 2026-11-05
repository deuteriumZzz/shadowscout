import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-bot-token")
os.environ.setdefault("OWNER_TELEGRAM_ID", "12345")

from shadowscout.feeds import espn_data
from shadowscout import match_alerts
from shadowscout import storage

PICK = {"match": "Arsenal - Everton", "market": "h2h", "pick": "home", "line": None}


class MessageTests(unittest.TestCase):
    def state(self, state, home=0, away=0):
        return {"state": state, "home": home, "away": away}

    def test_first_sight_says_nothing(self):
        self.assertEqual(match_alerts.messages_for(PICK, None, self.state("in", 2, 1)), [])

    def test_kick_off(self):
        out = match_alerts.messages_for(PICK, self.state("pre"), self.state("in"))
        self.assertEqual(out, ["Матч начался: Arsenal — Everton. Ваша ставка: победа Arsenal."])

    def test_goal_says_whether_it_helps_the_bet(self):
        ours = match_alerts.messages_for(PICK, self.state("in"), self.state("in", 1, 0))
        theirs = match_alerts.messages_for(PICK, self.state("in"), self.state("in", 0, 1))
        self.assertEqual(ours, ["Гол! Arsenal 1:0 Everton, в пользу вашей ставки."])
        self.assertEqual(theirs, ["Гол! Arsenal 0:1 Everton, против вашей ставки."])

    def test_a_goal_on_a_total_makes_no_claim_about_the_bet(self):
        total = {**PICK, "market": "totals", "pick": "over", "line": 2.5}
        self.assertEqual(match_alerts.messages_for(total, self.state("in"), self.state("in", 1, 0)), ["Гол! Arsenal 1:0 Everton."])

    def test_final(self):
        out = match_alerts.messages_for(PICK, self.state("in", 1, 0), self.state("post", 1, 0))
        self.assertEqual(len(out), 1)
        self.assertIn("Финал: Arsenal 1:0 Everton", out[0])

    def test_switches_silence_only_what_they_say(self):
        self.assertEqual(match_alerts.messages_for(PICK, self.state("pre"), self.state("in"), kickoff_on=False), [])
        self.assertEqual(match_alerts.messages_for(PICK, self.state("in"), self.state("in", 1, 0), goals_on=False), [])
        self.assertTrue(match_alerts.messages_for(PICK, self.state("in", 1, 0), self.state("post", 1, 0), kickoff_on=False, goals_on=False), "the final always comes")


class DueTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db = patch.object(storage, "DB_PATH", f"{self.temp_dir.name}/t.sqlite3")
        self.db.start()
        storage.init_db()

    def tearDown(self):
        self.db.stop()
        self.temp_dir.cleanup()

    def add_pick(self, minutes_from_now):
        kickoff = (datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now)).isoformat()
        pick = storage.save_pick("EPL", "Arsenal - Everton", "h2h", "home", 2.0, "low", "", kickoff)
        storage.place(pick, 10, virtual=True)
        return pick

    def game(self, state, home=0, away=0, completed=False):
        return {"id": "1", "code": "eng.1", "start": datetime.now(timezone.utc), "state": state, "completed": completed,
                "home": {"name": "Arsenal", "short": "", "score": home}, "away": {"name": "Everton", "short": "", "score": away}}

    def run_with(self, game):
        with patch.object(espn_data, "find_game", return_value=game):
            return match_alerts.due_messages()

    def test_a_match_is_followed_once_each_change(self):
        self.add_pick(-1)
        self.assertEqual(self.run_with(self.game("pre")), [], "first look only records")
        self.assertEqual(len(self.run_with(self.game("in"))), 1, "kick-off")
        self.assertEqual(self.run_with(self.game("in")), [], "nothing new, nothing sent")
        self.assertEqual(len(self.run_with(self.game("in", 1, 0))), 1, "goal")
        self.assertEqual(self.run_with(self.game("in", 1, 0)), [])
        self.assertEqual(len(self.run_with(self.game("post", 1, 0, completed=True))), 1, "final")

    def test_a_restart_mid_match_doesnt_announce_old_goals(self):
        self.add_pick(-30)
        self.assertEqual(self.run_with(self.game("in", 2, 0)), [])

    def test_a_postponed_game_isnt_called_final(self):
        self.add_pick(-1)
        self.run_with(self.game("pre"))
        self.assertEqual(self.run_with(self.game("post", 0, 0, completed=False)), [])

    def test_far_away_matches_arent_even_looked_up(self):
        self.add_pick(600)
        with patch.object(espn_data, "find_game", side_effect=AssertionError("no lookup")):
            self.assertEqual(match_alerts.due_messages(), [])

    def test_settings_round_trip_and_default_on(self):
        self.assertEqual(match_alerts.settings(), {"kickoff": True, "goals": True})
        self.assertEqual(match_alerts.set_settings(goals=False), {"kickoff": True, "goals": False})


if __name__ == "__main__":
    unittest.main()
