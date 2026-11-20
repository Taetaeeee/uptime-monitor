# 서비스별 장애 메일 수신자 — 켜는 체크리스트 (19단계)

운영자 말고도 "이 서비스의 장애 메일을 받겠다"고 동의한 사람에게 장애·복구 메일을 보내는 기능입니다.
**코드와 표(0019)는 배포돼 있지만 기본은 꺼져 있습니다.** 꺼져 있는 동안에는:

- 서비스 추가 팝업에 '알림 받을 메일' 칸이 보이지 않고, 관리자 API로 수신자를 추가하면 503
- 장애 메일은 지금처럼 운영자 한 명(`ALERT_EMAIL_TO`)에게만 감
- 수신자 표(`service_subscribers`)에는 아무것도 저장되지 않음

## 왜 지금 켤 수 없나

1. **도메인이 없음:** Resend 기본 주소(`onboarding@resend.dev`)는 가입한 메일 주소로만 보낼 수 있습니다. 다른 사람에게 보내려면 내 도메인을 Resend에 인증해야 합니다(무료 하위 도메인 서비스는 Resend가 거부함 — 2026-11-20 is-a.dev로 확인).
2. **지침:** CLAUDE.md 규칙 4("데이터는 전부 가상이다. 실존 회사·인물 정보는 쓰지 않는다")와 실제 사람의 메일 주소 저장이 부딪힙니다. 켜기 전에 이 규칙을 바꿔야 합니다.

## 켜는 순서

| 순서 | 할 일 | 누가 |
|---|---|---|
| 1 | 도메인 구매 (예: 가비아 `.cloud` 1년, **자동 연장 끄기**, 등록자 정보 보호) | 사용자 |
| 2 | (권장) Cloudflare에 도메인 추가(무료) → 가비아에서 네임서버를 Cloudflare 것으로 변경 | 사용자 |
| 3 | Resend → Domains → Add Domain → 나오는 TXT·MX 기록을 DNS에 추가 → **Verify** | 사용자 |
| 4 | 발신 주소 등록: `npx.cmd wrangler secret put ALERT_EMAIL_FROM` → 값 `Uptime Monitor <alert@내도메인>` | 사용자 |
| 5 | 시험 메일(`POST /api/admin/alerts/test`)이 운영자에게 오는지 확인 | 사용자 + 확인 |
| 6 | **내 주소가 아닌 다른 주소**(내 다른 메일 계정 등)로 보내 받은편지함에 오는지 확인 — 6번까지 되어야 실제로 다른 사람에게 갈 수 있음 | 사용자 + 확인 |
| 7 | CLAUDE.md 규칙 4 문구 변경 (예: "실제 운영 서비스의 운영자·수신자 메일 주소는 동의를 받은 경우에만 D1에 저장하고, 코드·저장소·Notion·로그에는 남기지 않는다") | 승인 후 수정 |
| 8 | 링크 토큰 비밀 값: `npx.cmd wrangler secret put SUBSCRIBE_SECRET` (32자 이상 난수, 아래 명령) | 사용자 |
| 9 | 켜기: `npx.cmd wrangler secret put SUBSCRIBERS_ENABLED` → 값 `1` | 사용자 |
| 10 | 대시보드 서비스 추가 팝업에 '알림 받을 메일' 칸이 보이는지, `GET /api/admin/subscribers`의 `enabled: true` 확인 | 확인 |

비밀 값 만들기(Windows PowerShell 5.1에서도 동작):

```powershell
$r = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($r); ($r | ForEach-Object { $_.ToString('x2') }) -join ''
```

켜졌는지 확인(관리자 토큰):

```powershell
$h = @{ Authorization = "Bearer $env:ADMIN_TOKEN" }
Invoke-RestMethod -Headers $h "https://<상태 페이지 주소>/api/admin/subscribers"
```

`enabled`가 `False`면 `reason`이 이유를 알려 줍니다: `not_enabled`(9번), `own_domain_required`(4번), `secret_missing`(8번), `email_not_configured`(15단계 설정), `site_url_missing`(wrangler.jsonc).

## 켠 뒤 동작

1. **추가:** 서비스 추가 팝업의 '알림 받을 메일' 또는 `POST /api/admin/services/:key/subscribers {"email": "..."}` → 대기(pending) + 확인 메일
2. **확인:** 받는 사람이 메일의 링크를 열고 **[받기]**를 눌러야 활성(active). 링크를 열기만 해서는 바뀌지 않습니다(메일 보안 검사기가 링크를 미리 열어도 등록되지 않게). 링크는 7일 유효, 7일 안에 확인하지 않으면 Cron이 주소를 지웁니다.
3. **장애 메일:** 서비스의 장애가 15분을 넘으면 운영자와 그 서비스의 활성 수신자에게 **한 사람씩 따로** 보냅니다(다른 수신자 주소가 보이지 않게). 받는 사람별로 기록해서 실패한 사람에게만 다음 회차에 다시 보냅니다. 복구 메일은 장애 메일을 받은 사람에게만, 복구 후 60분 안에만.
4. **그만 받기:** 모든 수신자 메일 아래에 그만 받기 링크가 있고, 메일 프로그램의 '구독 취소' 버튼(`List-Unsubscribe` 헤더)도 동작합니다. 그만 받으면 **주소가 DB에서 지워집니다.** 기능을 다시 꺼도 그만 받기는 동작합니다(`SUBSCRIBE_SECRET`가 남아 있는 동안).
5. **관리:** `GET /api/admin/subscribers`(주소는 `q***@example.com`처럼 가림), `DELETE /api/admin/subscribers/:id`(주소 삭제).

## 제한과 한계

- 서비스당 5명, 전체 20명 — Resend 무료 플랜 하루 100통 안에 들도록.
- 받은편지함 도착은 보장하지 않습니다(새 도메인 평판, 받는 쪽 스팸 필터).
- Resend의 `headers`(List-Unsubscribe) 지원과 받는 쪽 메일 프로그램의 '구독 취소' 버튼 표시 여부는 공식 문서·실제 메일로 확인할 부분입니다.
- 도메인을 그만 쓸 때(만료 **전에**): `SUBSCRIBERS_ENABLED` 삭제 → 수신자에게 안내 후 `DELETE`로 주소 정리 → `ALERT_EMAIL_FROM` 삭제(운영자는 Resend 기본 주소로 계속 받음).
