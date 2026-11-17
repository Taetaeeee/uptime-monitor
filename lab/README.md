# 네트워크·서버 진단 실습 환경

이 환경은 **실시간 관측 기반과 수동 시작형 역할별 조사**입니다. 운영 Uptime Monitor·원격 D1·공개 서비스와 연결하지 않습니다. 자동 사건 생성·실제 LLM 조사·최종 대시보드 통합은 다음 단계입니다.

## 실제 에이전트 팀

[팀 브리지 실행과 경계](team-bridge/README.md)를 참고하세요. 실제 팀은 별도 Node 프로세스 `http://127.0.0.1:18912/agents.html`에서 봅니다. 기존 Paseo 로그인과 등록 세션을 조회하고 읽기 전용 조사·설계 요청과 담당 게시 요약을 연결합니다. 실제 수정·복구는 미연결이며 공개 Worker에 배포하지 않았습니다.

## 규칙 조사 탭 (보존)

http://127.0.0.1:18911/rules.html 에서 ERP 증상을 질문하면 조사 팀장 → DNS·네트워크 → 서버·로그 → 후보 비교 → 필요한 경우 1회 추가 점검 → 보고서 순서로 진행합니다. 각 노드를 클릭하면 받은 지시, 실행 결과, 관측 위치·시각·ID, 다음 역할에 넘긴 지시를 확인할 수 있습니다.

**현재 executor는 rules이고 LLM은 미연결입니다.** 실측 도구를 정해진 규칙으로 연결한 실행이며 실제 여러 모델의 자유로운 대화나 판단으로 표시하지 않습니다. 질문은 ERP 증상 설명으로 기록될 뿐 명령·URL·SQL로 실행하지 않습니다. 추가 질문에 따른 자유로운 재계획은 아직 지원하지 않습니다.

- 시작: `node start.mjs --build`. 이미지에 UI를 포함하므로 `lab/`과 형제 `public/` 폴더를 함께 보관해야 합니다. Compose 2.17+의 additional_contexts를 사용합니다. 기존 Docker 볼륨과 실습 암호는 유지합니다.
- 브라우저가 닫혀도 로컬 실행기는 후속 작업을 계속합니다. 페이지를 다시 열면 저장된 최근 조사와 단계 기록을 조회합니다.
- 서버 재시작 때 진행 중이던 조사는 미완료로 마감합니다. 자동 체크포인트 재개를 지원한다는 뜻은 아닙니다.
- 한 번에 한 조사, 최근 최대 20건, 추가 검사 최대 1회입니다. 30초 한도를 단계 경계에서 확인하고 개별 실측 도구는 기존의 짧은 timeout을 사용합니다. 중단은 진행 중인 제한 시간 내 검사가 끝난 뒤 후속 작업을 막습니다.
- 기록은 evidence 볼륨 `/data/workflows/`에 저장합니다. 작업 상태와 원인 판단 결과는 구분하며 원인을 확정하지 않습니다.
- POST는 같은 origin·JSON·메모리 세션 토큰을 요구합니다. UI에서 토큰을 디스크나 localStorage에 저장하지 않습니다. 공개 배포용 인증 설계는 별도입니다.
- Worker의 기존 정적 사이트에서도 탭 링크는 생기지만 실행 API가 없는 환경은 ‘실행 서버 미연결’로 표시합니다. 원격 API·실제 LLM·배포는 이번 변경에 포함하지 않습니다.

```powershell
node --test tests/workflow.test.mjs
```

## 구성과 출처

```text
수집기 ── CoreDNS에서 erp.lab.test 해석 ── ERP 업무 조회 ── PostgreSQL
   └───── DB TCP 연결 / ERP 프로세스 생존·자원·정제 로그 확인
```

- DNS·HTTP·TCP·자원 값은 `source: real`, `environment: lab`인 **실습 환경 실측**입니다. 실제 회사 운영 장애나 RCAEval 기록이 아닙니다.
- 구매 요청·자산 지급 업무 항목은 가상 데이터입니다. AI가 생성한 숫자나 난수 지표는 없습니다.
- ERP 프로세스 CPU는 1코어 기준이며 앞뒤 누적 CPU 시간의 변화율입니다. Windows 호스트 전체 사용률이 아닙니다.
- 메모리는 프로세스 RSS와 cgroup 컨테이너 메모리를 분리합니다. 파일시스템 여유량은 공유 기반 스토리지 값이며 전용 디스크 용량이 아닙니다.
- NIC bytes는 컨테이너 네트워크 범위입니다. 첫 표본·재시작·카운터 초기화 때 변화율을 만들지 않습니다.
- `observed_at`, `received_at`, 근거 ID, 관측 지점, 구성 해시를 기록합니다. 60초 넘게 갱신되지 않으면 현재 상태를 정상으로 표시하지 않습니다.

## 실행 (PowerShell)

Docker Desktop의 Linux 엔진과 Node.js가 필요합니다. DB와 DNS는 호스트 포트를 공개하지 않으며, ERP와 관측 화면은 `127.0.0.1`에만 바인딩합니다. 기존 프로젝트 포트는 사용하지 않습니다.

```powershell
cd C:\Users\User\Projects\uptime-monitor\lab
node start.mjs --build
docker compose ps
Start-Process http://127.0.0.1:18911/
Invoke-RestMethod http://127.0.0.1:18911/api/snapshot
Invoke-RestMethod http://127.0.0.1:18910/api/orders
```

첫 빌드는 컨테이너 이미지와 실습 API의 `pg` 의존성을 내려받습니다. DB·DNS는 내부 전용 네트워크에만 연결하고 ERP·수집기는 여기에 더해 호스트 화면 접근용 bridge에 연결합니다. 두 호스트 포트는 loopback에만 바인딩합니다. ERP·수집기의 외부 통신을 네트워크 방화벽으로 차단한 구성은 아니며, 코드는 고정된 실습 대상만 호출합니다. 수집 주기는 15초, 화면 조회 주기는 5초입니다. API의 `/health/live` 성공은 프로세스 생존일 뿐이며, DB까지 거치는 `/api/orders` 성공과 구분합니다.

`start.mjs`는 최초 실행 때 임의의 실습 DB 암호를 `lab/.runtime/secrets/`에 생성합니다. 이 폴더는 Git에서 제외합니다. 앱은 별도 비관리자 DB 계정을 쓰며, 암호·DB 주소·SQL·예외 원문을 관측 로그에 남기지 않습니다. 초기화 SQL은 새 DB 볼륨에만 적용합니다. 기존 볼륨을 유지한 채 암호 파일만 지우거나 교체하면 DB와 불일치하므로 파일을 보존하세요. `start.ps1`은 선택 대안이며 실행 정책 때문에 막히면 정책을 바꾸지 말고 위 Node.js 명령을 사용하세요.

## 검증과 DB 중단 훈련

```powershell
# 순수 계산·HTTP 실패 경계 테스트 (의존성 설치 없이 실행 가능)
node --test tests/*.test.mjs
# 정상 실측과 변화율 확인
node verify.mjs
# 이 실습 프로젝트의 DB만 중단했다가 finally에서 다시 시작
node verify.mjs --with-db-outage
```

검증은 정상 DNS·업무 HTTP·DB TCP와 자원/로그 실측을 확인합니다. DB 중단 훈련에서는 **DNS 정상 + ERP 프로세스 생존 + 업무 HTTP 503 + DB TCP 실패**, 재시작 후 같은 업무 조회 복구를 확인합니다. 기록은 Git 제외된 `.runtime/verification.json`에 저장합니다. 실제 LLM을 호출하거나 운영 판정·SLA·모니터 테이블을 수정하지 않습니다.

수집 기록은 Docker `evidence` 볼륨의 `latest.json`, `history.jsonl`, `history.previous.jsonl`에 저장합니다. 이력은 약 10MiB 범위로 순환합니다. ERP 내부 로그는 메모리 최근 100건이며 수집기가 최근 30건을 가져갑니다. 중복 로그는 `id`로 구별할 수 있습니다. 이 단계는 손실 없는 중앙 로그 수집기를 보장하지 않습니다.

```powershell
# 측정 내용을 파일로 내보내기
docker compose cp collector:/data/latest.json .runtime/latest.json
# 종료 (DB·증거 볼륨과 암호를 보존)
docker compose down
```

## 이번 단계의 경계

- Ping·Windows 호스트 전체 자원·DB 연결 통계·DB 원문 로그·실제 LLM은 아직 수집하지 않습니다.
- 수집기는 승인된 고정 대상만 검사하며 URL·shell·SQL을 받아 실행하는 API는 없습니다.
- 기존 Worker의 외부 HTTPS/SSRF 가드를 풀지 않았습니다. 다음 단계에서는 내부 수집기가 인증된 작업을 가져오고 근거를 외부로 보내도록 연결합니다.
- 기본 관측 화면과 역할별 조사 탭을 제공합니다. 브라우저 시각·키보드 검수와 최종 NOC 디자인은 별도입니다.
- 사용 이미지 태그는 고정했지만 불변 digest로 잠그지 않았습니다. 재현 기록에는 실제 이미지 digest를 별도로 보존해야 합니다.

## 면접 질문

1. **프로세스가 살아 있는데 왜 장애인가요?** 생존 검사는 DB 업무 경로를 검사하지 않습니다. 프로세스·DNS·TCP·업무 읽기를 분리해야 실패 계층을 좁힐 수 있습니다.
2. **컨테이너 CPU를 서버 CPU라고 하면 안 되나요?** 수집 범위와 분모가 다릅니다. 1코어 기준 프로세스 변화율, cgroup 메모리, 공유 파일시스템 값을 각각 표시하고 결측을 0으로 채우지 않았습니다.

커밋 메시지 제안: `feat(lab): ERP·DNS·DB 실습 환경과 실측 수집 기반 추가`

근거: [CoreDNS rewrite](https://coredns.io/plugins/rewrite/), [PostgreSQL 공식 이미지](https://hub.docker.com/_/postgres), [Compose 서비스 설정](https://docs.docker.com/reference/compose-file/services/)
