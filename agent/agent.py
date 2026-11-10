"""Uptime Monitor 내부 점검 에이전트

사용 예 (PowerShell, 프로젝트 폴더에서):
  # 이 PC에서 실제로 측정만 하고 화면에 출력 (전송 안 함)
  python agent\\agent.py --config agent\\config.example.json --once --dry-run

  # 시뮬레이터: 시나리오 파일의 가짜 측정값을 '지금으로부터 거꾸로 5분 간격' 시각으로 보냄
  $env:AGENT_API_KEY = "<직접 만든 키>"
  python agent\\agent.py --simulate agent\\scenarios\\db-outage.json --api-url https://<내 Worker 주소>/api/agent/report

API 키는 코드·설정 파일에 넣지 않고 환경 변수 AGENT_API_KEY로만 받습니다. (CLAUDE.md 규칙 3)
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import time
from datetime import datetime, timedelta, timezone

import checks
from sender import SendError, send_report

DEFAULT_INTERVAL = 300  # 5분 (서버의 회차 단위와 같게)


def iso_utc(dt: datetime) -> str:
    """UTC ISO 문자열, 밀리초 없음 (서버가 요구하는 형식: ...Z)"""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_payload(agent_name: str, mode: str, observed_at: datetime, results: list[dict]) -> dict:
    return {
        "agent": agent_name,
        "mode": mode,  # 'real' | 'simulator' — 서버는 같은 출처의 대상에만 기록합니다
        "observed_at": iso_utc(observed_at),
        "checks": results,
    }


def build_timeline(steps: int, now: datetime, interval_seconds: int = DEFAULT_INTERVAL) -> list[datetime]:
    """시뮬레이터 단계별 측정 시각: 마지막 단계가 '지금', 앞 단계는 interval씩 과거.

    왜 거꾸로? 30분짜리 장애 시나리오를 30분 기다리지 않고 바로 재현하기 위해서입니다.
    서버는 하루보다 오래된 측정은 거부하므로 단계 수 × 간격이 24시간을 넘으면 안 돼요.
    """
    return [now - timedelta(seconds=interval_seconds * (steps - 1 - i)) for i in range(steps)]


def load_json(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def print_report(payload: dict) -> None:
    print(f"[{payload['observed_at']}] {payload['agent']} ({payload['mode']})")
    for c in payload["checks"]:
        state = "OK  " if c["ok"] else "FAIL"
        extra = []
        if c.get("response_ms") is not None:
            extra.append(f"{c['response_ms']}ms")
        if c.get("value") is not None:
            extra.append(f"값 {c['value']}")
        if c.get("error"):
            extra.append(c["error"])
        print(f"  {state} {c['key']:<24} {' / '.join(extra)}")


def deliver(payload: dict, api_url: str | None, dry_run: bool) -> bool:
    """전송(또는 dry-run 출력). 성공하면 True."""
    print_report(payload)
    if dry_run:
        print("  → dry-run: 전송하지 않음")
        return True
    api_key = os.environ.get("AGENT_API_KEY")
    if not api_url or not api_key:
        print("  → 전송 불가: --api-url(또는 설정의 api_url)과 환경 변수 AGENT_API_KEY가 필요합니다", file=sys.stderr)
        return False
    try:
        res = send_report(api_url, api_key, payload)
    except SendError as e:
        print(f"  → 전송 실패: {e}", file=sys.stderr)
        return False
    print(f"  → 서버: 회차 {res.get('checkedAt')} 기록 {res.get('accepted')}건"
          f" / 건너뜀 {res.get('skipped')} / 미등록 {res.get('unknown')} / 거부 {res.get('rejected')}")
    return True


def run_real(config: dict, api_url: str | None, dry_run: bool, once: bool, interval: int) -> int:
    agent_name = config.get("agent_name") or platform.node() or "agent"
    specs = config["checks"]
    while True:
        observed_at = datetime.now(timezone.utc)
        results = [checks.run_check(s) for s in specs]
        ok = deliver(build_payload(agent_name, "real", observed_at, results), api_url, dry_run)
        if once:
            return 0 if ok else 1
        # 측정에 걸린 시간을 빼고 기다려서 주기가 밀리지 않게 합니다
        elapsed = (datetime.now(timezone.utc) - observed_at).total_seconds()
        time.sleep(max(1, interval - elapsed))


def run_simulator(scenario: dict, api_url: str | None, dry_run: bool) -> int:
    steps = scenario["steps"]
    interval = int(scenario.get("interval_seconds", DEFAULT_INTERVAL))
    timeline = build_timeline(len(steps), datetime.now(timezone.utc), interval)
    agent_name = scenario.get("agent_name", "simulator")
    print(f"시나리오 '{scenario.get('name', '?')}': {len(steps)}단계, 간격 {interval}초\n")

    # 한 단계라도 전송에 실패하면 멈춥니다.
    #   시나리오는 단계 순서가 중요해서(연속 실패 → 장애), 중간이 빠진 채 계속 보내면
    #   서버의 장애 판정이 시나리오와 다르게 나옵니다. 키가 틀린 경우에도 8번씩 거부당할 필요가 없고요.
    failures = 0
    for step, observed_at in zip(steps, timeline):
        if failures:
            print("이전 단계 전송 실패로 시뮬레이션을 중단합니다.", file=sys.stderr)
            break
        # 시나리오 값을 측정 결과와 같은 모양으로 정리 (빠진 값은 None)
        results = [
            {"key": c["key"], "ok": bool(c["ok"]), "response_ms": c.get("response_ms"),
             "value": c.get("value"), "error": c.get("error")}
            for c in step["checks"]
        ]
        if step.get("note"):
            print(f"# {step['note']}")
        if not deliver(build_payload(agent_name, "simulator", observed_at, results), api_url, dry_run):
            failures += 1
    return 0 if failures == 0 else 1


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Uptime Monitor 내부 점검 에이전트")
    p.add_argument("--config", help="실제 점검 설정 JSON (agent/config.example.json 참고)")
    p.add_argument("--simulate", metavar="SCENARIO", help="시나리오 JSON의 가짜 측정값을 보냄 (source=simulator)")
    p.add_argument("--api-url", help="보고 받을 주소 (예: https://<Worker 주소>/api/agent/report). 설정의 api_url보다 우선")
    p.add_argument("--once", action="store_true", help="한 번만 점검하고 끝냄 (작업 스케줄러에서 실행할 때)")
    p.add_argument("--interval", type=int, default=DEFAULT_INTERVAL, help="반복 점검 간격(초), 기본 300")
    p.add_argument("--dry-run", action="store_true", help="측정 결과를 화면에만 출력하고 전송하지 않음")
    args = p.parse_args(argv)

    if args.simulate:
        scenario = load_json(args.simulate)
        return run_simulator(scenario, args.api_url, args.dry_run)

    if not args.config:
        p.error("--config 또는 --simulate 중 하나가 필요합니다")
    config = load_json(args.config)
    api_url = args.api_url or config.get("api_url")
    return run_real(config, api_url, args.dry_run, args.once, args.interval)


if __name__ == "__main__":
    # `python agent\agent.py`로 실행하면 파이썬이 이 파일의 폴더(agent/)를 import 경로에 넣어 주므로
    # 위의 `import checks`, `from sender import ...`가 같은 폴더의 파일을 찾습니다.
    raise SystemExit(main())
