import importlib.util
import os
import unittest
from pathlib import Path
from unittest import mock


BOT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "bot.py"
SPEC = importlib.util.spec_from_file_location("gmail_bot", BOT_PATH)
gmail_bot = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gmail_bot)


class BotWhatsappNotificationTest(unittest.TestCase):
    def test_builds_whatsapp_result_payload(self):
        payload = gmail_bot.build_whatsapp_result_payload(
            "ok",
            "2026-06-19T09:00:00+00:00",
            "2026-06-19T09:00:10+00:00",
            {"emailsMatched": 13},
        )

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["summary"]["emailsMatched"], 13)
        self.assertIsNone(payload["error"])

    def test_notify_skips_when_token_is_missing(self):
        previous_token = os.environ.pop("BOT_WHATSAPP_WEBHOOK_TOKEN", None)
        try:
            sent = gmail_bot.notify_whatsapp_result(
                "ok",
                "2026-06-19T09:00:00+00:00",
                "2026-06-19T09:00:10+00:00",
                {"emailsMatched": 0},
            )
            self.assertFalse(sent)
        finally:
            if previous_token is not None:
                os.environ["BOT_WHATSAPP_WEBHOOK_TOKEN"] = previous_token

    def test_notify_posts_to_backend_with_bearer_token(self):
        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        previous_token = os.environ.get("BOT_WHATSAPP_WEBHOOK_TOKEN")
        previous_url = os.environ.get("BOT_BACKEND_URL")
        os.environ["BOT_WHATSAPP_WEBHOOK_TOKEN"] = "shared-secret"
        os.environ["BOT_BACKEND_URL"] = "http://localhost:30001"

        try:
            with mock.patch.object(gmail_bot.urllib.request, "urlopen", return_value=Response()) as urlopen:
                sent = gmail_bot.notify_whatsapp_result(
                    "error",
                    "2026-06-19T09:00:00+00:00",
                    "2026-06-19T09:00:10+00:00",
                    {"emailsMatched": 2},
                    RuntimeError("fallo de prueba"),
                )

            self.assertTrue(sent)
            request = urlopen.call_args.args[0]
            self.assertEqual(request.full_url, "http://localhost:30001/bot/gmail-ate/whatsapp-result")
            self.assertEqual(request.get_header("Authorization"), "Bearer shared-secret")
        finally:
            if previous_token is None:
                os.environ.pop("BOT_WHATSAPP_WEBHOOK_TOKEN", None)
            else:
                os.environ["BOT_WHATSAPP_WEBHOOK_TOKEN"] = previous_token

            if previous_url is None:
                os.environ.pop("BOT_BACKEND_URL", None)
            else:
                os.environ["BOT_BACKEND_URL"] = previous_url


if __name__ == "__main__":
    unittest.main()
