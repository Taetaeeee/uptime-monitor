# 내부 점검 에이전트

Windows PC에서 ping·TCP 포트·SSL 인증서 만료·디스크 사용률·서비스 상태를 **측정**해서
Worker의 `POST /api/agent/report`로 보내는 Python 프로그램입니다. 표준 라이브러리만 씁니다.

- **판정은 서버가 합니다.** 에이전트는 측정값만 보냅니다(기준값을 서버 한곳에서 관리).
- **바깥으로만 연결합니다.** PC에서 포트를 열 필요가 없어요.
- **두 가지 모드**
  - 실제 모드: 이 PC에서 실제로 측정 → `mode: "real"` → 서버의 `source = 'real'` 대상에만 기록
  - 시뮬레이터: 시나리오 파일의 가짜 측정값 → `mode: "simulator"` → `source = 'simulator'` 대상에만 기록
  - 서버가 출처를 확인해서, 가짜 값이 실제 대상에 섞이지 않습니다.

## 파일

| 파일 | 역할 |
|---|---|
| `agent.py` | 실행 진입점 (옵션 처리, 실제 모드 반복, 시뮬레이터) |
| `checks.py` | 종류별 측정 함수 (판정 없음, 예외를 밖으로 던지지 않음) |
| `sender.py` | 보고 전송 (4xx는 재시도 안 함, 5xx·네트워크 오류는 2초·4초 뒤 재시도) |
| `config.example.json` | 실제 모드 설정 예시 → `config.json`으로 복사해서 사용 (`.gitignore`에 있음) |
| `scenarios/db-outage.json` | 시뮬레이터 시나리오 (DB 포트 장애 → 복구, 디스크 사용률 증가) |
| `tests/` | `unittest` 테스트 |

## 실행 (PowerShell, 프로젝트 폴더에서)

### 1. 테스트
```powershell
python -m unittest discover -s agent\tests -v
```

### 2. 실제 측정만 해 보기 (전송 없음)
```powershell
python agent\agent.py --config agent\config.example.json --once --dry-run
```
출력 예:
```
[2026-11-10T04:46:43Z] my-pc (real)
  OK   pc-ping-localhost        1ms
  OK   pc-disk-c                값 23.9
  ...
  → dry-run: 전송하지 않음
```

### 3. API 키 만들기와 등록 (직접 실행)
키는 코드·설정 파일·저장소에 넣지 않습니다.
```powershell
# 32바이트 무작위 키 만들기 (화면에 나온 값을 복사)
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)

# Worker에 등록 (붙여 넣으라는 안내가 나옴)
npx.cmd wrangler secret put AGENT_API_KEY
```
에이전트를 실행할 PowerShell 창에서만 환경 변수로 줍니다.
```powershell
$env:AGENT_API_KEY = "<위에서 만든 키>"
```

### 4. 시뮬레이터 전송
먼저 서버에 시뮬레이터 대상을 등록해야 합니다(`seed/simulator-monitors.sql`).
```powershell
python agent\agent.py --simulate agent\scenarios\db-outage.json --api-url https://<내 Worker 주소>/api/agent/report
```
- 시나리오의 마지막 단계가 '지금', 앞 단계는 5분씩 과거 시각으로 보내집니다(30분짜리 장애를 바로 재현).
- 같은 시나리오를 바로 다시 보내면 서버가 '이미 기록된 회차'로 건너뜁니다(멱등).
  처음부터 다시 보여 주려면 `seed/simulator-monitors.sql`을 다시 실행하세요(시뮬레이터 기록 초기화).

### 5. (선택) 작업 스케줄러로 5분마다 실행 — 예시만, 실행은 직접 판단
실제 모드를 계속 돌리려면 서버에 실제 대상(`source = 'real'`, `check_key` 지정)을 먼저 등록해야 합니다.
내 PC의 디스크·서비스 정보가 **공개 상태 페이지**에 보이게 되므로 무엇을 올릴지 먼저 정하세요.
```powershell
# 예시: 5분마다 한 번 실행 (API 키를 작업에 어떻게 줄지는 따로 정해야 함)
schtasks /Create /SC MINUTE /MO 5 /TN "StatusMonitorAgent" /TR "python C:\경로\agent\agent.py --config C:\경로\agent\config.json --once"
```

## 확인이 필요한 부분
- 한국어 Windows의 `sc query` 출력에서 상태 단어(`RUNNING`)가 영어로 나오는 것은 이 PC에서 확인했지만, 모든 Windows 버전에서 같은지는 확실하지 않습니다.
- 이미 만료된 인증서는 접속 단계에서 오류가 나서 '만료 임박'이 아니라 '네트워크 오류'로 기록됩니다.
