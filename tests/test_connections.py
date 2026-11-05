import os
import sqlite3
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-bot-token")
os.environ.setdefault("OWNER_TELEGRAM_ID", "12345")

import connections
import llm_providers
import storage
import webapp_api.main as api_main

KEY = "sk-very-secret-value-a1b2"


class ConnectionsTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        storage.DB_PATH = f"{self.temp_dir.name}/test.sqlite3"
        storage.init_db()
        self.env = patch.dict(os.environ, {connections.SECRET_ENV: "test-secret"})
        self.env.start()
        for name in ("GROQ_API_KEY", "ODDS_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"):
            os.environ.pop(name, None)
        api_main.app.dependency_overrides[api_main.require_owner] = lambda: {"id": 12345}
        self.client = TestClient(api_main.app)

    def tearDown(self):
        self.client.close()
        api_main.app.dependency_overrides.clear()
        self.env.stop()
        self.temp_dir.cleanup()

    def item(self, name):
        return next(i for i in self.client.get("/api/connections").json()["items"] if i["name"] == name)

    def test_key_is_encrypted_at_rest_and_round_trips(self):
        connections.save("groq", KEY)
        self.assertEqual(connections.get_key("groq"), KEY)
        with sqlite3.connect(storage.DB_PATH) as conn:
            dump = "".join(str(row) for row in conn.execute("SELECT * FROM settings"))
        self.assertNotIn(KEY, dump)

    def test_api_never_returns_a_saved_key(self):
        saved = self.client.post("/api/connections/groq", json={"key": KEY})
        self.assertEqual(saved.status_code, 200)
        self.assertNotIn(KEY, saved.text)
        self.assertNotIn(KEY, self.client.get("/api/connections").text)
        self.assertEqual(self.item("groq")["masked"], "••••a1b2")
        self.assertEqual(self.item("groq")["source"], "app")

    def test_saving_is_refused_without_a_secret_rather_than_stored_plain(self):
        del os.environ[connections.SECRET_ENV]
        response = self.client.post("/api/connections/groq", json={"key": KEY})
        self.assertEqual(response.status_code, 503)
        self.assertIsNone(storage.get_setting("secret:groq"))

    def test_app_key_overrides_env_and_delete_falls_back(self):
        with patch.dict(os.environ, {"GROQ_API_KEY": "from-env-key-0000"}):
            connections.save("groq", KEY)
            self.assertEqual(connections.get_key("groq"), KEY)
            self.client.post("/api/connections/groq/delete")
            self.assertEqual(connections.get_key("groq"), "from-env-key-0000")
            self.assertEqual(self.item("groq")["source"], "env")

    def test_changed_secret_asks_to_re_enter_instead_of_crashing(self):
        connections.save("groq", KEY)
        os.environ[connections.SECRET_ENV] = "another-secret"
        self.assertIsNone(connections.get_key("groq"))
        self.assertTrue(self.item("groq")["needs_reentry"])

    def test_custom_model_needs_https_url_and_model(self):
        no_model = self.client.post("/api/connections/openai", json={"key": KEY, "base_url": "https://x.test/v1"})
        self.assertEqual(no_model.status_code, 400)
        plain_http = self.client.post("/api/connections/openai", json={"key": KEY, "base_url": "http://x.test/v1", "model": "m"})
        self.assertEqual(plain_http.status_code, 400)
        ok = self.client.post("/api/connections/openai", json={"key": KEY, "base_url": "https://x.test/v1/", "model": "m"})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(connections.get_base_url("openai"), "https://x.test/v1")

    def test_chain_change_applies_to_the_next_provider_call(self):
        connections.save("openai", KEY, "https://x.test/v1", "my-model")
        response = self.client.post("/api/connections/llm", json={"primary": "openai", "fallbacks": []})
        self.assertEqual(response.status_code, 200)
        provider = llm_providers.get_provider_chain()
        self.assertIsInstance(provider, llm_providers.OpenAICompatibleProvider)
        self.assertEqual(provider.MODEL, "my-model")

    def test_chain_refuses_a_model_with_no_key(self):
        response = self.client.post("/api/connections/llm", json={"primary": "groq", "fallbacks": []})
        self.assertEqual(response.status_code, 400)

    def test_deleting_the_active_model_clears_it_from_the_chain(self):
        connections.save("groq", KEY)
        connections.save("gemini", KEY)
        connections.set_llm_chain("groq", ["gemini"])
        connections.delete("gemini")
        self.assertEqual(connections.llm_chain()[1], [])

    def test_openai_compatible_429_counts_as_rate_limit_for_fallback(self):
        provider = llm_providers.OpenAICompatibleProvider(KEY, "https://x.test/v1", "m")
        with patch("requests.post", return_value=MagicMock(ok=False, status_code=429)):
            with self.assertRaises(llm_providers.LLMHttpError) as caught:
                provider._complete([], 10)
        self.assertTrue(llm_providers._is_rate_limited(caught.exception))

    def test_probe_results_are_readable_and_never_echo_the_key(self):
        with patch("connections.requests.get", return_value=MagicMock(ok=False, status_code=401)):
            self.assertEqual(connections.test("odds_api", KEY)["detail"], "Ключ не подошёл")
        with patch("connections.requests.get", return_value=MagicMock(ok=False, status_code=429)):
            self.assertIn("Лимит", connections.test("odds_api", KEY)["detail"])
        boom = connections.requests.ConnectionError(f"https://x?apiKey={KEY}")
        with patch("connections.requests.get", side_effect=boom):
            self.assertNotIn(KEY, connections.test("odds_api", KEY)["detail"])

    def test_api_football_bad_key_is_caught_despite_http_200(self):
        reply = MagicMock(ok=True, status_code=200)
        reply.json.return_value = {"errors": {"token": "invalid"}}
        with patch("connections.requests.get", return_value=reply):
            self.assertFalse(connections.test("api_football", KEY)["ok"])

    def test_keyless_source_needs_no_key_and_refuses_one(self):
        with patch("connections.requests.get", return_value=MagicMock(ok=True, status_code=200)):
            self.assertTrue(connections.test("espn")["ok"])
        self.assertEqual(self.client.post("/api/connections/espn", json={"key": KEY}).status_code, 400)

    def test_bookmaker_is_validated_and_used(self):
        self.assertEqual(self.client.post("/api/connections/bookmaker", json={"site": "nope"}).status_code, 400)
        self.assertEqual(self.client.post("/api/connections/bookmaker", json={"site": "fonbet"}).status_code, 200)
        self.assertEqual(connections.bookmaker_site(), "fonbet")

    def test_routes_require_the_owner(self):
        api_main.app.dependency_overrides.clear()
        for method, path in (("get", "/api/connections"), ("post", "/api/connections/groq"), ("post", "/api/connections/llm")):
            self.assertIn(getattr(self.client, method)(path).status_code, (401, 403, 422), path)


if __name__ == "__main__":
    unittest.main()
