"""내부 점검 측정 함수 모음 (Python 표준 라이브러리만 사용)

여기서는 '측정'만 합니다. 성공/실패 '판정'은 서버(src/agent-judge.js)가 해요.
  - 기준값(디스크 90% 등)을 서버 한곳에서 관리하기 위해서입니다.

모든 측정 함수는 같은 모양의 dict를 돌려줍니다:
  {"ok": bool, "response_ms": int|None, "value": float|None, "error": str|None}
    ok    : ping 응답 있음 / 포트 열림 / 인증서 읽음 / 디스크 읽음 / 서비스 실행 중
    value : disk = 사용률(%), ssl = 남은 일수

측정 함수는 예외를 밖으로 던지지 않습니다. 실패도 '측정 결과'로 돌려줘서
점검 하나가 터져도 나머지 점검과 전송은 계속되게 해요.
"""

from __future__ import annotations

import math
import re
import shutil
import socket
import ssl
import subprocess
import sys
import time

IS_WINDOWS = sys.platform == "win32"


def result(ok: bool, response_ms=None, value=None, error=None) -> dict:
    return {"ok": ok, "response_ms": response_ms, "value": value, "error": error}


# ─────────────────────────────────────────────
# ping
# ─────────────────────────────────────────────
# 한국어 Windows는 "응답: 바이트=32 시간<1ms TTL=128", 영어는 "Reply from ...: bytes=32 time=12ms TTL=117".
# 언어마다 다른 단어 대신, 언어와 상관없는 부분만 읽습니다:
#   - 'TTL=' 이 있으면 응답을 받은 것 ("요청 시간이 만료되었습니다" 같은 실패 문장에는 TTL이 없음)
#   - '=12ms' 또는 '<1ms' 형태의 숫자
_TTL = re.compile(r"TTL=\d+", re.IGNORECASE)
_MS = re.compile(r"[=<]\s*(\d+)\s*ms", re.IGNORECASE)


def parse_ping_output(text: str) -> tuple[bool, int | None]:
    """ping 출력 → (응답 받음 여부, 응답 ms). '<1ms'는 1ms로 봅니다(0으로 두면 '측정 안 됨'과 헷갈려서)."""
    if not _TTL.search(text):
        return False, None
    m = _MS.search(text)
    if not m:
        return True, None
    return True, max(1, int(m.group(1)))


def ping(host: str, timeout_ms: int = 1000) -> dict:
    # Windows: -n 횟수, -w 대기(ms) / 그 밖(macOS·Linux): -c 횟수, -W 대기(초)
    if IS_WINDOWS:
        cmd = ["ping", "-n", "1", "-w", str(timeout_ms), host]
    else:
        cmd = ["ping", "-c", "1", "-W", str(max(1, timeout_ms // 1000)), host]
    try:
        # 출력 인코딩이 언어마다 달라도(한국어는 cp949) ASCII 부분만 읽으므로 ascii로 풀고 나머지는 버립니다
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout_ms / 1000 + 5)
        text = proc.stdout.decode("ascii", errors="ignore")
    except (OSError, subprocess.TimeoutExpired) as e:
        return result(False, error=f"ping 실행 실패: {e}")
    reachable, ms = parse_ping_output(text)
    return result(reachable, response_ms=ms, error=None if reachable else "응답 없음")


# ─────────────────────────────────────────────
# TCP 포트
# ─────────────────────────────────────────────
def tcp(host: str, port: int, timeout: float = 3.0) -> dict:
    """포트에 연결이 되는지만 봅니다 (연결 후 바로 닫음, 데이터는 보내지 않음)."""
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            ms = round((time.perf_counter() - started) * 1000)
        return result(True, response_ms=max(1, ms))
    except OSError as e:  # 연결 거부, 시간 초과, 이름 풀이 실패 모두 OSError 계열
        return result(False, error=f"{type(e).__name__}: {e}")


# ─────────────────────────────────────────────
# SSL 인증서 만료
# ─────────────────────────────────────────────
def days_left(not_after_seconds: float, now_seconds: float) -> int:
    """만료 시각까지 남은 '완전한' 날 수 (내림). 하루가 안 남았으면 0, 이미 지났으면 음수."""
    return math.floor((not_after_seconds - now_seconds) / 86400)


def ssl_expiry(host: str, port: int = 443, timeout: float = 5.0) -> dict:
    """인증서 만료일까지 남은 일수를 value로 돌려줍니다.

    주의: 이미 만료됐거나 검증에 실패한 인증서는 접속 단계에서 오류가 나서
    ok=False(서버 판정: network_error)로 기록됩니다. '만료 임박' 판정은 아직 유효한 인증서에만 적용돼요.
    """
    ctx = ssl.create_default_context()
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as tls:
                cert = tls.getpeercert()
        not_after = ssl.cert_time_to_seconds(cert["notAfter"])
    except (OSError, ssl.SSLError, KeyError, ValueError) as e:
        return result(False, error=f"{type(e).__name__}: {e}")
    return result(True, value=days_left(not_after, time.time()))


# ─────────────────────────────────────────────
# 디스크 사용률
# ─────────────────────────────────────────────
def disk(path: str) -> dict:
    try:
        usage = shutil.disk_usage(path)
    except OSError as e:
        return result(False, error=f"{type(e).__name__}: {e}")
    percent = round(usage.used / usage.total * 100, 1)
    return result(True, value=percent)


# ─────────────────────────────────────────────
# Windows 서비스 상태
# ─────────────────────────────────────────────
# `sc query <이름>` 출력의 'STATE : 4  RUNNING' 줄에서 RUNNING만 봅니다.
# 확인 필요: 한국어 Windows에서도 상태 단어(RUNNING/STOPPED)는 영어로 나오는 것으로 알고 있으나,
#            모든 버전에서 같은지는 확실하지 않습니다. 첫 실행 때 --dry-run으로 꼭 확인하세요.
_RUNNING = re.compile(r"\bRUNNING\b")


def parse_sc_output(text: str) -> bool:
    return bool(_RUNNING.search(text))


def service(name: str) -> dict:
    if not IS_WINDOWS:
        return result(False, error="서비스 점검은 Windows에서만 지원합니다")
    try:
        proc = subprocess.run(["sc", "query", name], capture_output=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired) as e:
        return result(False, error=f"sc 실행 실패: {e}")
    text = proc.stdout.decode("ascii", errors="ignore")
    if proc.returncode != 0:
        # 예: 1060 = 그런 이름의 서비스가 없음
        return result(False, error=f"sc query 종료 코드 {proc.returncode}")
    running = parse_sc_output(text)
    return result(running, error=None if running else "실행 중이 아님")


# ─────────────────────────────────────────────
# 설정 1개 → 측정
# ─────────────────────────────────────────────
def run_check(spec: dict) -> dict:
    """설정 파일의 점검 1개를 실행하고, 보고용 dict에 key를 붙여 돌려줍니다."""
    kind = spec["kind"]
    try:
        if kind == "ping":
            r = ping(spec["host"], spec.get("timeout_ms", 1000))
        elif kind == "tcp":
            r = tcp(spec["host"], int(spec["port"]), spec.get("timeout", 3.0))
        elif kind == "ssl":
            r = ssl_expiry(spec["host"], int(spec.get("port", 443)))
        elif kind == "disk":
            r = disk(spec["path"])
        elif kind == "service":
            r = service(spec["name"])
        else:
            r = result(False, error=f"알 수 없는 종류: {kind}")
    except Exception as e:  # 설정 누락(KeyError) 등 예상 못 한 오류도 측정 실패로 기록
        r = result(False, error=f"{type(e).__name__}: {e}")
    return {"key": spec["key"], **r}
