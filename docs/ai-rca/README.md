# AI 장애 조사 · 로컬 제품 통합

2026-11-17 기준, 기존 CPU 기준선·합성 동기 CLI와 별도로 Workers용 비동기 LLM 조사 루프·등록 대상 라이브 어댑터·`/rca.html` 화면을 추가했다. 현재 API 키가 없어 실제 서버 모델 호출은 비활성화 상태다. 전송 계층 대역 통합, 실제 로컬 Workers/D1/API, 라이브 어댑터 직접 측정을 검증했다. 실제 모델 성능·LLM과 라이브를 함께 사용한 전체 조사·운영 배포 완료를 뜻하지 않는다.

## 구성과 경계

| 경로 | 역할 |
|---|---|
| rca/lib/baseline.js | 주입 시각 전후 CPU 평균 증가량으로 서비스 후보 계산 |
| rca/lib/case-schema.js | 합성 사례·증거·보고서 검증, 실행 상태와 원인 판단 분리 |
| rca/lib/dns-http-diagnosis.js | DNS/HTTP 현상·원인 후보·미확인 사항·다음 확인을 구분 |
| rca/tools/synthetic-tools.js | 현재 사례/실행의 허용된 합성 관측만 조회 |
| rca/runner.js | 규칙/테스트 정책의 도구 선택·추가 관측·한도·보고 흐름 |
| scripts/rca-baseline/run.mjs | 로컬 JSON 기준선 입력·별도 정답 채점 CLI |
| scripts/rca-demo/run.mjs | 합성 사례 조사 CLI |
| test/fixtures/rca-synthetic/observations | 정답 없는 가짜 관측 |
| test/fixtures/rca-synthetic/grading-only | 채점 쪽만 읽는 정답 |
| test/rca-*.test.js | 계산·경계·도구·실행·CLI 검증 |

rca/는 운영 DB·기존 판정 경로에 결과를 쓰지 않는다. 초기 AI-RCA-002는 신규 로컬 경로만 추가했고, AI-RCA-004에서 아래 서버·화면·분석 전용 마이그레이션을 추가했다. 기존 판정·Cron·가동률·의존성 파일은 변경하지 않았다.
파일 범위와 읽기 전용 지침은 행동 규칙이며 OS 격리 보장으로 표현하지 않는다.

## 로컬 실행

프로젝트 루트의 PowerShell에서 실행한다. 원본 데이터나 LLM 키 없이 합성 CLI를 실행할 수 있다.

~~~powershell
node scripts/rca-demo/run.mjs --list
node scripts/rca-demo/run.mjs --case syn-7f3a21
npm.cmd test
~~~

보고서는 표준 출력 JSON이다. mode=synthetic, provenance=synthetic-simulation, decision_policy.llm_executed=false이며, 실제 서비스 상태나 운영 장애 이력으로 취급하지 않는다.
run_status(completed/incomplete/failed)는 cause_outcome(no_anomaly_observed/candidate/deferred/not_analyzable)과 별개다. 정상 관측은 관측 범위의 결과이며 서비스가 항상 정상이라는 증명이 아니다.

### 합성 사례 실행 결과

| 사례 | 규칙 판단 | 실행 상태 |
|---|---|---|
| 정상 DNS·HTTP | no_anomaly_observed | completed |
| NXDOMAIN+HTTP 연결 실패 | candidate | completed |
| DNS 정상+HTTP500 | deferred | completed |
| DNS 정상+HTTP 지연 | deferred | completed |
| DoH 통신 실패+HTTP 정상 | deferred | completed |
| HTTP 성공/시간 초과 교대 | deferred | 추가 관측 한도로 incomplete |

상위 Codex가 여섯 CLI를 직접 실행해 위 상태와 validation.ok=true, llm_executed=false를 확인했다.
합성 시나리오는 개발·회귀 확인용으로 이미 사용한 사례다. 이 표는 LLM 성능이나 일반화된 장애 원인 정확도가 아니다.
DoH와 HTTP의 해석·통신 경로는 다를 수 있다. HTTP500이나 느린 응답만으로 CPU·DB·애플리케이션의 내부 원인을 확정하지 않는다.

## CPU 기준선 입력

~~~powershell
node scripts/rca-baseline/run.mjs --input <입력.json>
node scripts/rca-baseline/run.mjs --input <입력.json> --answers <정답.json> --config <설정.json>
~~~

입력은 로컬 JSON만 지원한다. CSV/Parquet/URL을 직접 읽거나 다운로드하지 않는다.
정답은 분석이 끝난 후 --answers로 읽으며 분석 입력에는 넣지 않는다. 원인을 담은 사례명 대신 불투명 case_key를 쓴다.

입력 구조 예시:

~~~json
{
  "schema_version": 1,
  "dataset_label": "사용자 지정 자료",
  "cases": [
    {
      "case_key": "k00001",
      "inject_time": 2,
      "sample_interval_sec": 1,
      "time": [0, 1, 2, 3],
      "columns": {
        "service-a_cpu": [1, 1, 9, 9],
        "service-b_cpu": [2, 2, 2, 2]
      }
    }
  ]
}
~~~

위 작은 예시에는 preWindowSec=2, postWindowSec=2 등 실제 샘플 길이에 맞는 별도 설정이 필요하다.
기본 설정은 전후300초, gap0, time==inject_time은 이후 구간, 최소 유효 관측 비율0.8, 최소 후보2개, 동점 이름 오름차순이다. 창·열·단위·동점 규칙은 resolveSettings에서 노출한다.
N(전체), A(분석 가능), S(자료 부족), 정답·오답·동점 채점은 구분해서 보고한다.

## 실제 검증 결과

검증일: 2026-11-16. 증거는 별도 portfolio 작업공간의 verification/AI-RCA-003/README.md 및 JSON·review 사본에 보존했다.

### Colab 계산 재현
사용자가 제공한 노트북의 CPU 분석 셀을 고정 데이터 리비전에서 다시 실행했다. 계산은 전체 time<inject_time / time>=inject_time의 _cpu 열 평균 차이와 idxmax다.
- 전체 CPU120, 분석 가능119, 정답119, 오답0, 비교 구간 부족1.
- 제외: re1ob_productcatalogservice_cpu_3.
- 평가 가능 분모100%, 전체 분모119/120=99.17%.
- 원본 pandas2.2.3 / 재현2.3.3 환경 차이와 원본 데이터 revision 미고정 한계가 있다.
- 주입 시각과 CPU 유형을 알고 하는 오프라인 서비스 식별이며 실시간 AI 성능이 아니다.

현재 프로젝트 CLI 기본값은 원본과 다른 조건이다.
- 기본값:120개 중118개 분석·118개 정답·자료 부족2.
- 추가 제외: re2ob_checkoutservice_cpu_2.
- 전체 기록이 포함되도록 한 별도 비교 설정에서는119개 분석·119개 정답이었다. 비교 설정은 pre/postWindowSec=1000000000, minCoverage=1e-12, minCandidateServices=1, tieEpsilon=0이다. 이것은 검증용 비교이며 새 기본값으로 추천하거나 적용한 것이 아니다.
- CLI reproduction의 unknown/false 메타데이터는 검증 기록과 자동 연동되지 않는다. 이 값을 완료로 바꾸는 기능은 구현하지 않았다.

### 실제 LLM 별도 시험
기존 ChatGPT 로그인 Codex의 GPT-6.1-Sol로 합성6사례/24관측을 한 번에 해석했다. 정답·기존 진단·미래 관측을 입력으로 주지 않았다.
판정 등급5/6 일치, DoH transport 실패+HTTP정상에서 기대deferred와 모델candidate가 달랐다. 내부 원인을 확정한 답은 없었지만 이는 확정 금지를 지시한 작은 시험 결과다.
이 시험은 제품 러너 밖의 일회성 관측 해석이며 LLM 도구 선택·실행 루프 검증이 아니다.

### 라이브 읽기 점검
기존 상태·이력API와 등록된 내 사이트·채팅 health HTTP 및 DNS가 한 시점에 정상 응답했다. 운영 DB에 결과를 쓰지 않았다.
이 시험 당시 제품 live 모드는 없었다. 기존 동기 CLI의 --live는 지금도 사용법 오류로 끝난다. AI-RCA-004의 새 HTTP API 라이브 어댑터와 구분하며, 당시 연결 확인을 새 제품의 라이브 RCA 통합 검증으로 확대하지 않는다.

### 검토
C가 구현과 수정본을 리뷰했다. 구현 단계 팀장 확인의 전체 node 테스트 결과는341통과/실패0이었다(테스트 러너의 helper 파일 집계 포함).
E는 AI-RCA-003의 저장 코드·예측·입력·보고서 정합성을 승인 가능으로 판정했다. E가 CPU·LLM·라이브를 다시 실행한 것은 아니다.
당시 원시 모델 JSONL/stderr와 채점 시간순서 독립 로그는 보존되지 않았다. 프롬프트 사본은 저장 입력·스크립트에서 재구성해 LF 정규화 해시를 대조했다.

## AI-RCA-004 서버·화면 통합

### 새 구성
| 경로 | 역할 |
|---|---|
| rca/async-runner.js | 모델이 선택한 도구 실행→관측 반환→재판단→보고. 기존 규칙 판정으로 모델 가설을 덮지 않음 |
| rca/policies/llm-policy.js · adapters/openai-responses.js | strict function call/출력 반환, 비공개 reasoning 항목 보존, 고정 OpenAI Responses endpoint |
| rca/adapters/live.js · src/rca-context.js | 등록된 real·활성 HTTPS 대상/동일 호스트 DNS 연결, 저장 기록과 새 측정 분리 |
| rca/lib/report-v2.js | 장부의 id·시각·스칼라 값 대조, 관측과 미확정 가설 구분 |
| rca/lib/budget.js · src/rca-store.js | 호출 전 예약·한도·사용량 정산, 중복 실행/전역 동시성/UTC 일 예산 |
| src/rca-api.js · migrations/0014_rca_runs.sql | 전용 인증 API·분석 실행/예산 테이블. 운영 점검 테이블에는 쓰지 않음 |
| public/rca.html · rca.js · rca.css | 출처/대상, 진행 스트림, 관측과 가설, 중단, 공개 보고서 조회 |

### 설정과 실행
`.dev.vars.example`의 빈 RCA 항목을 로컬 `.dev.vars`에 설정한다. 키 값은 채팅·공개 JS·커밋에 넣지 않는다. 배포 설정은 별도 단계다.
- OPENAI_API_KEY: 제공자 API 키. Codex/ChatGPT 로그인과 별개.
- RCA_OPERATOR_TOKEN: 분석 실행/취소 전용 토큰. 관리자 전체 권한 토큰을 재사용하지 않는다. 화면에는 이 전용 토큰만 입력하며 저장하지 않는다.
- RCA_MODEL, RCA_INPUT_USD_PER_MILLION, RCA_OUTPUT_USD_PER_MILLION: 계정에서 사용 가능한 모델과 공식 입력/출력 요금. 모델/가격을 자동 추측하지 않는다.
- RCA_RUN_USD_LIMIT, RCA_DAILY_USD_LIMIT: 실행/UTC 일 상한. 최대 6회 × (24,512 입력 토큰 보수 추산 + 1,200 출력 토큰) 가격으로 예약한다. 설정한 실행 상한이 이 예약보다 작으면 시작하지 않는다.
- RCA_ALLOWED_HOSTS: 사용자가 운영하는 등록 대상 호스트만 쉼표 구분. 비어 있으면 실제 대상은 선택할 수 없다. 모델은 URL/호스트 인자를 받지 않는다.

프로젝트 루트 PowerShell에서 로컬 DB 마이그레이션을 적용하고 개발 서버를 실행한다. **이번 작업에서는 원격 마이그레이션을 적용하지 않았다.**
~~~powershell
npm.cmd run db:migrate:local
npm.cmd run dev
~~~
`/rca.html`을 열면 설정/저장소 미완료 상태가 표시된다. API 키·요금·모델·예산 미설정이면 유료 호출하지 않는다.

| API | 접근/역할 |
|---|---|
| GET /api/rca/capabilities | 준비 상태·합성 사례 목록·허용된 별칭/ID |
| POST /api/rca/analyze | 전용 Bearer 토큰 + Idempotency-Key, JSON mode/case_id 또는 mode/monitor_id. 진행 NDJSON |
| POST /api/rca/cancel/:run_id | 전용 토큰, 추가 호출 중단 요청 |
| GET /api/rca/reports/:run_id | 정제된 공개 보고서. 링크를 가진 방문자가 볼 수 있으므로 비밀 정보 저장 금지 |

### 지원 범위와 제한
- 합성 기록과 실제 측정을 같은 실행에 섞지 않는다. RCAEval은 별도 오프라인 평가다. 실제 모드에서 replay/simulator/비활성/허용 목록 밖 대상은 선택 불가.
- 실제 도구는 한 대상의 최근 1시간 최대 8개/채널 기록 또는 새 HTTP/DNS 관측이다. 직접 점검은 6초 제한, 동일 HTTPS origin 내 리다이렉트 최대 2회, DoH JSON 32KB 제한이다. HTTP 본문은 읽지 않고 즉시 취소한다. HTTP 시간은 헤더 수신까지이므로 기존 본문 포함 점검 시간과 같지 않다.
- 호스트 허용 목록은 운영자가 관리한다. DNS 해석 결과 IP를 고정해 연결하는 별도 네트워크 프록시는 없다. 승인된 내 호스트로만 제한하며 임의 대상 진단 서비스로 사용하지 않는다.
- 모델은 URL·원문 본문/헤더/오류문·사용자 데이터·정답표·전체 미래 관측을 받지 않는다. 최종 보고의 근거는 발급 장부와 대조한다. 문장 자체가 인과관계로 검증된 것은 아니며 모든 가설은 미확정이다.
- 실행은 최대 90초/모델 6회/도구 8회/추가 관측 2회. 자동 재시도 없음. 제공자 최대 출력 토큰에 reasoning도 포함될 수 있어 미완료 종료가 가능하다.
- 실제 모드의 기본 HTTP/DNS probe는 채널별 첫 측정(또는 마지막 추가 측정)을 캐시해 재조회한다. 진행 중 기본 호출도 같은 Promise를 공유하며 새 측정은 추가 관측 경로로만 요청한다. boolean/number/문자열/배열은 도구 인자로 받지 않는다.
- 중단 버튼은 현재 연결부터 즉시 끊고, 캡처한 실행 토큰으로 최대 3초의 서버 취소 요청을 별도로 보낸다. 서버 취소 응답을 기다리느라 로컬 중단을 지연하지 않는다.
- D1 batch로 호출 전 보수 예약한다. 날짜가 바뀌어도 전역 동시 실행은 1개다. 사용량을 받지 못하면 예약 전액을 불확정 비용으로 유지한다. 이 원장은 제공자의 청구서가 아니며 요금 설정이 정확하다는 전제가 있다.
- 연결 이탈 뒤 백그라운드 완료·재개를 보장하지 않는다. 중단은 새 호출을 막지만 이미 진행된 공급자 처리/과금을 취소한다고 보장하지 않는다. Worker가 끝나 정산되지 않은 실행은 만료 후 다음 인증된 실행에서 불확정으로 정리한다. 자동 Queue/Cron 재개는 없다.
- 완료는 검증된 형식의 모델 보고를 수신했다는 뜻이다. 내부 원인 확정·실제 장애 판정과 다르다. 오류/한도/관측 부족이면 미완료·실패로 저장하며 관측 요약을 AI 성공처럼 표시하지 않는다.
- 코드/전송 대역 테스트376개와 Workers 번들 dry-run은 통과했고, E가 신규35개를 독립 실행해 코드·대역 범위에서 승인 가능으로 검토했다.
- 후속 실제 로컬 검증: 격리된 D1에 마이그레이션14개를 적용하고 workerd 서버의 HTTP 검사12개를 통과했다. 페이지/JS/CSS 바이트 일치, 상태·월간 보고 API, 인증401/출처403/키 미설정503을 확인했다. OpenAI 키나 실제 모델 응답 대역을 주입하지 않은 로컬 런타임 검사다.
- 라이브 어댑터 직접 검증: 등록된 사용자 소유 사이트의 HTTP200과 DNS RCODE0/A답2개를 실제 외부 요청2회로 확인했다. 기본 HTTP 재조회는 캐시를 재사용했다. 임시 로컬 대상 활성값만 테스트 중 설정하고 복원했으며 측정/분석/예산 테이블 행 수는 모두0으로 유지됐다. 이는 Node fetch로 제품 어댑터를 직접 실행한 한시점 관측이며, Workers live API와 LLM의 전체 조사 흐름을 실행한 것은 아니다.
- 인앱 브라우저 실행 모듈 및 화면 접근 연결이 없어 실제375px/테마/키보드 조작은 여전히 미검증이다. 실제 서버 모델 호출·LLM/live 전체 조사·운영 D1/배포 통합도 미검증이다.

## 남은 작업
- Colab 계산 조건을 정식 설정으로 지원하고 재현 메타데이터를 검증 기록에 연결.
- 모델·공식 요금·총 비용 한도를 정하고 서버 secret을 설정한 뒤 실제 소규모 조사 실행을 검증.
- 모바일/양 테마/키보드 조작과 실제 모델을 포함한 전체 조사 확인. 운영 D1/배포 환경 검증은 별도 승인 후 진행.
- 장기 작업이 필요하면 별도 Queue/Workflows·실행 재개 설계.
- 새 LLM/다운로드/운영 변경은 해당 범위를 정한 작업 요청에 따라 진행.
커밋·푸시·배포는 이번 단계에서 수행하지 않았다.

## 면접 질문과 답변 포인트
1. 왜 합성 테스트 통과를 AI 성능으로 표현하지 않았나요? 규칙과 가짜 관측으로 흐름을 검증한 것이며 모델의 원인 추적 정확도·일반화는 별도 시험이기 때문이다.
2. 같은 CPU 분석인데 기본 CLI는 왜118개인가요? 원본은 전체 구간이고 CLI는300초 창과80%관측 비율을 요구한다. 제외 분모·계산 조건을 같이 보고해야 성능을 정직하게 비교할 수 있다.

커밋 메시지 제안: feat(rca): CPU 기준선과 합성 DNS HTTP 조사 흐름 추가
