"""보고 전송 (urllib, 표준 라이브러리)

에이전트 → Worker 방향으로만 연결합니다. PC에서 포트를 열 필요가 없어요.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

USER_AGENT = "status-monitor-agent/0.1 (portfolio project)"


class SendError(Exception):
    """재시도해도 소용없는 오류 (키 틀림, 형식 오류 등)"""


def send_report(api_url: str, api_key: str, payload: dict, retries: int = 2, timeout: float = 10.0,
                sleep=time.sleep) -> dict:
    """보고를 보내고 서버 응답(JSON)을 돌려준다.

    재시도 규칙:
      - 4xx(키 틀림 401, 형식 오류 400 등): 다시 보내도 똑같이 실패하므로 바로 중단
      - 5xx, 네트워크 오류: 2초, 4초 쉬고 다시 시도 (일시적인 문제일 수 있음)
    같은 보고를 두 번 보내도 서버가 '이미 기록된 회차'로 건너뛰므로(멱등) 재시도해도 안전합니다.
    """
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        api_url,
        data=data,
        method="POST",
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {api_key}",
            "user-agent": USER_AGENT,
        },
    )

    last_error = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")[:300]
            if 400 <= e.code < 500:
                raise SendError(f"HTTP {e.code}: {body}") from None
            last_error = f"HTTP {e.code}: {body}"
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_error = f"{type(e).__name__}: {e}"
        if attempt < retries:
            sleep(2 ** (attempt + 1))
    raise SendError(f"재시도 {retries}회 후 실패: {last_error}")
