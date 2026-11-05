import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-bot-token")
os.environ.setdefault("OWNER_TELEGRAM_ID", "12345")

import requests

import storage
import wallet
import webapp_api.main as api_main

LOGIN = "0x" + "a" * 40
PROXY = "0x" + "b" * 40
OPEN_ROW = {"title": "Arsenal win?", "outcome": "Yes", "status": "OPEN", "current_value": 61.5, "unrealized_pnl": 8.79, "event_slug": "epl-ars"}
LOST_ROW = {"title": "Lost", "outcome": "Yes", "status": "REDEEMABLE", "current_value": 0.0, "unrealized_pnl": -50, "event_slug": "x"}
WON_ROW = {"title": "Won", "outcome": "Yes", "status": "REDEEMABLE", "current_value": 20.0, "unrealized_pnl": 9, "event_slug": "y"}


def answer(json_body, status=200):
    response = MagicMock(status_code=status)
    response.json.return_value = json_body
    response.raise_for_status.side_effect = requests.HTTPError() if status >= 400 else None
    return response


def fake_get(url, params=None, timeout=None):
    if url.endswith("/public-profile"):
        return answer({"proxyWallet": PROXY, "name": "owner"}) if params["address"] == LOGIN else answer({"error": "nf"}, 404)
    if url.endswith("/value"):
        return answer({"data": {"proxy_wallet": PROXY, "value": 81.5}})
    if params.get("status") == "CLOSED":
        return answer({"data": [{"title": "Old", "status": "CLOSED", "realized_pnl": 12.0}], "pagination": {"has_more": False}})
    return answer({"data": [OPEN_ROW, LOST_ROW, WON_ROW], "pagination": {"has_more": False}})


def fake_post(url, json=None, timeout=None):
    return answer({"result": hex(1_250_500_000)})


class WalletTests(unittest.TestCase):
    def setUp(self):
        wallet._cache.clear()
        self.get = patch.object(wallet.requests, "get", side_effect=fake_get)
        self.post = patch.object(wallet.requests, "post", side_effect=fake_post)
        self.get.start()
        self.post.start()

    def tearDown(self):
        self.get.stop()
        self.post.stop()

    def test_real_figures_add_up(self):
        p = wallet.portfolio(PROXY)
        self.assertEqual(p["cash"], 1250.5, "pUSD has six decimals")
        self.assertEqual(p["positions_value"], 81.5)
        self.assertEqual(p["total"], 1332.0)
        self.assertEqual(p["errors"], [])

    def test_the_balance_is_asked_for_this_wallet_and_token(self):
        wallet.portfolio(PROXY)
        sent = wallet.requests.post.call_args.kwargs["json"]["params"][0]
        self.assertEqual(sent["to"], wallet.PUSD_TOKEN)
        self.assertEqual(sent["data"], "0x70a08231" + "0" * 24 + "b" * 40)

    def test_lost_positions_are_gone_and_winnings_stay(self):
        titles = [p["title"] for p in wallet.portfolio(PROXY)["positions"]]
        self.assertEqual(titles, ["Arsenal win?", "Won"])

    def test_a_failed_part_is_unknown_never_zero(self):
        def broken(url, params=None, timeout=None):
            if url.endswith("/value"):
                raise requests.ConnectionError()
            return fake_get(url, params, timeout)

        with patch.object(wallet.requests, "get", side_effect=broken):
            p = wallet.portfolio(PROXY)
        self.assertIsNone(p["positions_value"])
        self.assertIsNone(p["total"], "a total built on a guess would be a fake number")
        self.assertEqual(p["cash"], 1250.5)
        self.assertEqual(len(p["errors"]), 1)

    def test_balance_falls_back_to_a_second_node_then_admits_it_failed(self):
        with patch.object(wallet.requests, "post", side_effect=[requests.ConnectionError(), answer({"result": hex(2_000_000)})]):
            self.assertEqual(wallet._pusd_balance(PROXY), 2.0)
        with patch.object(wallet.requests, "post", side_effect=requests.ConnectionError()):
            self.assertIsNone(wallet._pusd_balance(PROXY))
        with patch.object(wallet.requests, "post", return_value=answer({"error": {"message": "limit"}})):
            self.assertIsNone(wallet._pusd_balance(PROXY), "a node's error isn't a zero balance")

    def test_a_partial_read_isnt_cached_as_if_it_were_good(self):
        with patch.object(wallet.requests, "post", side_effect=requests.ConnectionError()):
            self.assertIsNone(wallet.portfolio(PROXY)["cash"])
        self.assertEqual(wallet.portfolio(PROXY)["cash"], 1250.5)

    def test_pnl_isnt_summed_from_a_partial_list(self):
        def many(url, params=None, timeout=None):
            if url.endswith("/positions") and params.get("status") != "CLOSED":
                return answer({"data": [OPEN_ROW], "pagination": {"has_more": True}})
            return fake_get(url, params, timeout)

        with patch.object(wallet.requests, "get", side_effect=many):
            p = wallet.portfolio(PROXY)
        self.assertTrue(p["truncated"])
        self.assertIsNone(p["unrealized_pnl"])


class WalletApiTests(unittest.TestCase):
    def setUp(self):
        wallet._cache.clear()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db = patch.object(storage, "DB_PATH", f"{self.temp_dir.name}/t.sqlite3")
        self.db.start()
        storage.init_db()
        self.get = patch.object(wallet.requests, "get", side_effect=fake_get)
        self.post = patch.object(wallet.requests, "post", side_effect=fake_post)
        self.get.start()
        self.post.start()
        api_main.app.dependency_overrides[api_main.require_owner] = lambda: {"id": 12345}
        self.client = TestClient(api_main.app)

    def tearDown(self):
        self.client.close()
        api_main.app.dependency_overrides.clear()
        self.get.stop()
        self.post.stop()
        self.db.stop()
        self.temp_dir.cleanup()

    def test_not_connected_says_so(self):
        self.assertEqual(self.client.get("/api/wallet").json(), {"connected": False})

    def test_connecting_keeps_the_real_polymarket_wallet(self):
        body = self.client.post("/api/wallet", json={"address": LOGIN}).json()
        self.assertEqual((body["address"], body["name"]), (PROXY, "owner"))
        self.assertEqual(self.client.get("/api/wallet").json()["total"], 1332.0)

    def test_bad_or_unknown_addresses_are_refused_and_not_saved(self):
        self.assertEqual(self.client.post("/api/wallet", json={"address": "seed words here"}).status_code, 400)
        self.assertEqual(self.client.post("/api/wallet", json={"address": "0x" + "c" * 40}).status_code, 400)
        self.assertEqual(self.client.get("/api/wallet").json(), {"connected": False})

    def test_a_polymarket_outage_doesnt_connect_anything(self):
        with patch.object(wallet.requests, "get", side_effect=requests.ConnectionError()):
            self.assertEqual(self.client.post("/api/wallet", json={"address": LOGIN}).status_code, 502)
        self.assertEqual(self.client.get("/api/wallet").json(), {"connected": False})

    def test_disconnecting(self):
        self.client.post("/api/wallet", json={"address": LOGIN})
        self.assertEqual(self.client.post("/api/wallet/delete").json(), {"connected": False})
        self.assertEqual(self.client.get("/api/wallet").json(), {"connected": False})

    def test_routes_require_the_owner(self):
        api_main.app.dependency_overrides.clear()
        self.assertIn(self.client.get("/api/wallet").status_code, (401, 403, 422))


if __name__ == "__main__":
    unittest.main()
