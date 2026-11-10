"""에이전트 본체·전송 테스트 — 실행: python -m unittest discover -s agent\\tests -v"""

import io
import json
import sys
import unittest
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

AGENT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AGENT_DIR))

import agent  # noqa: E402
import sender  # noqa: E402


class TimelineTest(unittest.TestCase):
    def test_last_step_is_now_and_steps_go_back_by_interval(self):
        now = datetime(2026, 11, 10, 5, 0, 7, tzinfo=timezone.utc)
        t = agent.build_timeline(3, now, 300)
        self.assertEqual([agent.iso_utc(x) for x in t],
                         ["2026-11-10T04:50:07Z", "2026-11-10T04:55:07Z", "2026-11-10T05:00:07Z"])


class PayloadTest(unittest.TestCase):
    def test_payload_shape_matches_server(self):
        p = agent.build_payload("pc", "real", datetime(2026, 11, 10, 5, 0, 7, 123000, tzinfo=timezone.utc),
                                [{"key": "a", "ok": True, "response_ms": 1, "value": None, "error": None}])
        self.assertEqual(p["observed_at"], "2026-11-10T05:00:07Z")  # 밀리초 없이 Z
        self.assertEqual(set(p), {"agent", "mode", "observed_at", "checks"})


class ScenarioFileTest(unittest.TestCase):
    """시나리오 파일이 서버 규칙과 맞는지 (키 형식, 24시간 이내, 시뮬레이터 대상 키와 일치)"""

    def setUp(self):
        self.scenario = agent.load_json(str(AGENT_DIR / "scenarios" / "db-outage.json"))
        seed = (AGENT_DIR.parent / "seed" / "simulator-monitors.sql").read_text(encoding="utf-8")
        import re
        self.seed_keys = set(re.findall(r"'(sim-[a-z0-9-]+)'", seed))

    def test_keys_are_registered_in_simulator_seed(self):
        keys = {c["key"] for step in self.scenario["steps"] for c in step["checks"]}
        self.assertTrue(keys <= self.seed_keys, keys - self.seed_keys)

    def test_timeline_fits_in_24_hours(self):
        span = (len(self.scenario["steps"]) - 1) * self.scenario["interval_seconds"]
        self.assertLess(span, 24 * 3600)

    def test_db_port_fails_twice_in_a_row(self):
        db = [next(c["ok"] for c in s["checks"] if c["key"] == "sim-db-tcp") for s in self.scenario["steps"]]
        self.assertIn("FalseFalse", "".join(str(x) for x in db))


class SenderTest(unittest.TestCase):
    def test_4xx_is_not_retried(self):
        err = urllib.error.HTTPError("u", 401, "Unauthorized", {}, io.BytesIO(b'{"error":"unauthorized"}'))
        sleeps = []
        with mock.patch("urllib.request.urlopen", side_effect=err) as op:
            with self.assertRaises(sender.SendError):
                sender.send_report("https://x.invalid", "k", {}, retries=2, sleep=sleeps.append)
        self.assertEqual(op.call_count, 1)  # 한 번만 시도
        self.assertEqual(sleeps, [])

    def test_network_error_is_retried_then_fails(self):
        sleeps = []
        with mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("down")) as op:
            with self.assertRaises(sender.SendError):
                sender.send_report("https://x.invalid", "k", {}, retries=2, sleep=sleeps.append)
        self.assertEqual(op.call_count, 3)
        self.assertEqual(sleeps, [2, 4])

    def test_sends_bearer_key_and_json(self):
        res = mock.MagicMock()
        res.__enter__.return_value.read.return_value = b'{"accepted": 1}'
        with mock.patch("urllib.request.urlopen", return_value=res) as op:
            out = sender.send_report("https://x.invalid", "secret-k", {"a": 1})
        req = op.call_args.args[0]
        self.assertEqual(out, {"accepted": 1})
        self.assertEqual(req.get_header("Authorization"), "Bearer secret-k")
        self.assertEqual(json.loads(req.data), {"a": 1})


class DryRunTest(unittest.TestCase):
    def test_simulate_dry_run_sends_nothing(self):
        out = io.StringIO()
        with mock.patch("urllib.request.urlopen") as op, mock.patch("sys.stdout", out):
            code = agent.main(["--simulate", str(AGENT_DIR / "scenarios" / "db-outage.json"), "--dry-run"])
        self.assertEqual(code, 0)
        op.assert_not_called()
        self.assertIn("dry-run", out.getvalue())


if __name__ == "__main__":
    unittest.main()
