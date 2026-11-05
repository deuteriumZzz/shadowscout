import tempfile
import unittest
import os
from unittest.mock import patch

from fastapi.testclient import TestClient

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-bot-token")
os.environ.setdefault("OWNER_TELEGRAM_ID", "12345")

from shadowscout import storage
import shadowscout.api.main as api_main


class PicksApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        storage.DB_PATH = f"{self.temp_dir.name}/test.sqlite3"
        storage.init_db()
        api_main.app.dependency_overrides[api_main.require_owner] = lambda: {"id": 12345}
        self.client = TestClient(api_main.app)

    def tearDown(self):
        self.client.close()
        api_main.app.dependency_overrides.clear()
        self.temp_dir.cleanup()

    def create_pick(self, recommended_stake=10):
        return storage.save_pick(
            league="АПЛ",
            match="Home - Away",
            market="h2h",
            pick="home",
            odds=2.0,
            confidence="medium",
            reasoning="test",
            commence_time=None,
            recommended_stake=recommended_stake,
        )

    def test_skip_changes_pending_pick_to_skipped(self):
        pick_id = self.create_pick()

        response = self.client.post(f"/api/picks/{pick_id}/skip")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "skipped")
        self.assertEqual(self.client.post(f"/api/picks/{pick_id}/skip").status_code, 409)

    def test_place_uses_saved_stake_and_opens_bookmaker(self):
        storage.init_bankroll(1000)
        pick_id = self.create_pick(recommended_stake=17.5)

        with patch.object(api_main.browser_session, "open_bookmaker") as open_bookmaker:
            response = self.client.post(f"/api/picks/{pick_id}/place")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "placed")
        self.assertEqual(response.json()["stake"], 17.5)
        self.assertTrue(response.json()["browser_opened"])
        open_bookmaker.assert_called_once_with(api_main.connections.bookmaker_site())
        self.assertEqual(self.client.post(f"/api/picks/{pick_id}/place").status_code, 409)

    def test_place_rejects_missing_bankroll(self):
        pick_id = self.create_pick()

        response = self.client.post(f"/api/picks/{pick_id}/place")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "Bankroll not set or stake suggestions are stopped")


if __name__ == "__main__":
    unittest.main()
