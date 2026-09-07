import hashlib
import hmac
import json
import os
import time
import unittest
from urllib.parse import urlencode

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-bot-token")
os.environ.setdefault("OWNER_TELEGRAM_ID", "12345")

from fastapi import HTTPException

from webapp_api.auth import verify_init_data


BOT_TOKEN = "test-bot-token"
OWNER_ID = 12345


def make_init_data(user_id=OWNER_ID, auth_date=None, token=BOT_TOKEN):
    pairs = {
        "auth_date": str(auth_date or int(time.time())),
        "user": json.dumps({"id": user_id, "first_name": "Test"}, separators=(",", ":")),
        "query_id": "test-query",
    }
    data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(pairs.items()))
    secret_key = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    pairs["hash"] = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    return urlencode(pairs)


class VerifyInitDataTests(unittest.TestCase):
    def test_accepts_valid_owner_payload(self):
        user = verify_init_data(make_init_data())

        self.assertEqual(user["id"], OWNER_ID)

    def test_rejects_invalid_signature(self):
        payload = make_init_data().replace("hash=", "hash=invalid", 1)

        with self.assertRaisesRegex(HTTPException, "signature invalid"):
            verify_init_data(payload)

    def test_rejects_expired_payload(self):
        payload = make_init_data(auth_date=int(time.time()) - 86401)

        with self.assertRaisesRegex(HTTPException, "expired"):
            verify_init_data(payload)

    def test_rejects_different_owner(self):
        payload = make_init_data(user_id=99999)

        with self.assertRaisesRegex(HTTPException, "Not authorized"):
            verify_init_data(payload)


if __name__ == "__main__":
    unittest.main()
