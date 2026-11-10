"""측정 함수 테스트 — 실행 (프로젝트 폴더에서): python -m unittest discover -s agent\\tests -v

ping·sc 출력은 실제 Windows 출력 형식을 흉내 낸 샘플로 검증합니다.
(진짜 명령은 PC 상태에 따라 결과가 달라서 테스트가 흔들리기 때문)
"""

import socket
import sys
import tempfile
import unittest
from pathlib import Path

# agent/ 폴더의 모듈(checks.py 등)을 불러올 수 있게 경로 추가
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import checks  # noqa: E402

# 한국어 Windows ping 출력 예 (cp949 한글은 ascii로 풀면 사라지고 숫자·TTL만 남는 것까지 흉내)
PING_KO_OK = "Ping 127.0.0.1 32바이트 데이터 사용:\r\n127.0.0.1의 응답: 바이트=32 시간<1ms TTL=128\r\n"
PING_EN_OK = "Pinging example [10.0.0.1] with 32 bytes of data:\r\nReply from 10.0.0.1: bytes=32 time=12ms TTL=117\r\n"
PING_KO_TIMEOUT = "Ping 10.255.255.1 32바이트 데이터 사용:\r\n요청 시간이 만료되었습니다.\r\n"
# '대상 호스트에 연결할 수 없습니다'는 응답 줄이 있어도 TTL이 없음 → 실패로 봐야 함
PING_EN_UNREACHABLE = "Reply from 192.168.0.1: Destination host unreachable.\r\n"

SC_RUNNING = """
SERVICE_NAME: Dnscache
        TYPE               : 30  WIN32
        STATE              : 4  RUNNING
                                (NOT_STOPPABLE, NOT_PAUSABLE, IGNORES_SHUTDOWN)
"""
SC_STOPPED = """
SERVICE_NAME: Spooler
        STATE              : 1  STOPPED
"""


class ParsePingTest(unittest.TestCase):
    def test_korean_less_than_1ms_counts_as_1ms(self):
        self.assertEqual(checks.parse_ping_output(PING_KO_OK), (True, 1))

    def test_english_reply(self):
        self.assertEqual(checks.parse_ping_output(PING_EN_OK), (True, 12))

    def test_timeout_has_no_ttl(self):
        self.assertEqual(checks.parse_ping_output(PING_KO_TIMEOUT), (False, None))

    def test_destination_unreachable_is_failure(self):
        self.assertEqual(checks.parse_ping_output(PING_EN_UNREACHABLE), (False, None))

    def test_korean_text_decoded_as_ascii_still_parses(self):
        # 실제 실행에서는 cp949 바이트를 ascii로 풀어 한글이 사라집니다. 그래도 결과가 같아야 함
        raw = PING_KO_OK.encode("cp949").decode("ascii", errors="ignore")
        self.assertEqual(checks.parse_ping_output(raw), (True, 1))


class ParseScTest(unittest.TestCase):
    def test_running(self):
        self.assertTrue(checks.parse_sc_output(SC_RUNNING))

    def test_stopped(self):
        self.assertFalse(checks.parse_sc_output(SC_STOPPED))


class DaysLeftTest(unittest.TestCase):
    def test_floor_partial_day(self):
        now = 1_000_000.0
        self.assertEqual(checks.days_left(now + 86400 * 14 + 3600, now), 14)
        self.assertEqual(checks.days_left(now + 3600, now), 0)   # 하루가 안 남음
        self.assertEqual(checks.days_left(now - 3600, now), -1)  # 이미 지남


class LocalMeasureTest(unittest.TestCase):
    """실제 측정이지만 이 PC 안에서만 끝나는 것 (외부 접속 없음)"""

    def test_disk_reports_percent(self):
        r = checks.disk(tempfile.gettempdir())
        self.assertTrue(r["ok"])
        self.assertTrue(0 <= r["value"] <= 100)

    def test_disk_bad_path_is_failure_not_exception(self):
        r = checks.disk(str(Path(tempfile.gettempdir()) / "no-such-dir-xyz" / "deeper"))
        self.assertFalse(r["ok"])
        self.assertIsNotNone(r["error"])

    def test_tcp_open_port(self):
        # 테스트 안에서 잠깐 포트를 열고 접속해 봅니다
        server = socket.socket()
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]
        try:
            r = checks.tcp("127.0.0.1", port, timeout=2)
        finally:
            server.close()
        self.assertTrue(r["ok"])
        self.assertGreaterEqual(r["response_ms"], 1)

    def test_tcp_closed_port(self):
        # 방금 연 포트를 닫으면 그 포트에는 아무도 없음 → 연결 거부
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        r = checks.tcp("127.0.0.1", port, timeout=2)
        self.assertFalse(r["ok"])

    def test_run_check_unknown_kind_and_missing_field(self):
        self.assertFalse(checks.run_check({"key": "x", "kind": "nope"})["ok"])
        r = checks.run_check({"key": "y", "kind": "tcp"})  # host·port 누락
        self.assertEqual(r["key"], "y")
        self.assertFalse(r["ok"])


if __name__ == "__main__":
    unittest.main()
