---
name: Uptime Monitor · 서비스 상태 진단
description: 실제 운영 서비스를 5분마다 점검해 가동률·장애·변경을 보여 주는 야간 관제실 화면
colors:
  night-navy: "#0b1220"
  night-rail: "#0d1628"
  night-panel: "#111b2e"
  night-panel-raised: "#15213a"
  night-line: "#22304d"
  night-line-strong: "#2b3b5c"
  night-text: "#e6edf7"
  night-muted: "#93a3bd"
  night-faint: "#7b8ba1"
  signal-blue: "#3b82f6"
  signal-blue-fill: "#2563eb"
  nav-on: "#dbeafe"
  status-up: "#22c55e"
  status-up-text: "#4ade80"
  status-warn: "#f59e0b"
  status-warn-text: "#fbbf24"
  status-down: "#ef4444"
  status-down-text: "#f87171"
  status-info: "#60a5fa"
  status-info-text: "#93c5fd"
  day-bg: "#f3f6fb"
  day-panel: "#ffffff"
  day-panel-raised: "#f6f8fc"
  day-line: "#e2e8f0"
  day-line-strong: "#cbd5e1"
  day-text: "#0f172a"
  day-muted: "#475569"
  day-faint: "#617087"
  day-blue: "#2563eb"
  day-up-text: "#157e3c"
  day-warn-text: "#af5109"
  day-down-text: "#b91c1c"
typography:
  headline:
    fontFamily: "Pretendard, system-ui, -apple-system, 'Segoe UI', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.3
  metric:
    fontFamily: "Pretendard, system-ui, -apple-system, 'Segoe UI', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1.2
    fontFeature: "'tnum'"
  title:
    fontFamily: "Pretendard, system-ui, -apple-system, 'Segoe UI', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.35
  body:
    fontFamily: "Pretendard, system-ui, -apple-system, 'Segoe UI', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Pretendard, system-ui, -apple-system, 'Segoe UI', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.4
  caption:
    fontFamily: "Pretendard, system-ui, -apple-system, 'Segoe UI', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif"
    fontSize: "11.5px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  chip: "7px"
  control: "9px"
  tile: "10px"
  panel: "12px"
  dialog: "24px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "18px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal-blue-fill}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.night-panel-raised}"
    textColor: "{colors.night-text}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  filter-pill-active:
    backgroundColor: "{colors.signal-blue-fill}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "7px 14px"
  status-pill-up:
    backgroundColor: "rgba(34, 197, 94, .14)"
    textColor: "{colors.status-up-text}"
    rounded: "{rounded.pill}"
    padding: "5px 12px"
  status-pill-down:
    backgroundColor: "rgba(239, 68, 68, .15)"
    textColor: "{colors.status-down-text}"
    rounded: "{rounded.pill}"
    padding: "5px 12px"
  check-chip:
    backgroundColor: "rgba(255, 255, 255, .02)"
    textColor: "{colors.night-text}"
    rounded: "{rounded.chip}"
    padding: "3px 8px"
  panel:
    backgroundColor: "{colors.night-panel}"
    rounded: "{rounded.panel}"
    padding: "16px 18px"
  metric-tile:
    backgroundColor: "{colors.night-panel-raised}"
    rounded: "{rounded.tile}"
    padding: "12px"
  input-search:
    backgroundColor: "transparent"
    textColor: "{colors.night-text}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  nav-item-active:
    backgroundColor: "rgba(59, 130, 246, .16)"
    textColor: "{colors.nav-on}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
---

# Design System: Uptime Monitor · 서비스 상태 진단

## Overview

**Creative North Star: "야간 관제실"**

불을 낮춘 관제실의 벽면 화면처럼, 어두운 남색 바탕 위에서 **상태만 또렷하게 떠오르는** 운영 도구입니다. 바탕·메뉴·패널은 같은 남색 계열의 밝기 단계로만 나뉘고, 눈에 띄는 색은 정상·주의·장애·정보 네 가지 상태와 주요 동작의 파랑뿐입니다. 장식이 아니라 숫자(가동률, 응답 시간, 다음 점검까지 남은 시간)가 화면의 무게를 집니다.

밀도는 높되 빽빽하지 않습니다. 한 줄에 서비스 하나(아이콘 · 이름 · 상태 · 30일 가동률 · 최근 점검 · 세부 점검 칩)를 놓고, 오른쪽 칸에 최근 알림·운영 지표·오늘 확인할 것·최근 변경을 쌓아 **한 화면에서 훑고, 누르면 깊이 들어가는** 구조입니다. 어두운 화면이 기본이고 밝은 화면은 같은 구조에 색만 바꾼 낮 근무용입니다.

부품은 **또렷하고 자신 있게** 동작합니다. 주요 버튼과 선택된 필터는 꽉 찬 파랑에 흰 글자, 상태 알약은 옅은 상태색 바탕에 굵은 글자로, 누를 수 있는 것과 지금 상태가 망설임 없이 읽혀야 합니다.

**Key Characteristics:**
- 어두운 남색 단계(바탕 → 메뉴 → 패널 → 올린 칸)로 구획, 그림자 없이 1px 테두리
- 색은 상태와 주요 동작에만. 서비스 구분은 별도의 고유색 10개(그래프·아이콘 전용)
- 숫자는 굵고(800) 고정폭 숫자(tabular-nums), 설명은 작고 흐리게
- 글자 대비는 KWCAG 2.2 기준(본문 4.5:1) 이상, 두 화면 모두
- 상태는 색 + 글자 + 아이콘으로 함께 표시

## Colors

남색 밤하늘 위의 신호등: 중성색은 모두 푸른 기가 도는 남색·슬레이트 계열이고, 채도 높은 색은 상태 신호에만 씁니다.

### Primary
- **신호 파랑 (Signal Blue)** (`signal-blue`): 링크, 초점 외곽선, 선택된 탭 밑줄, 칩에 마우스를 올렸을 때 테두리, 정보 아이콘. 어두운 바탕 위에서 글자·선으로 쓸 때의 파랑입니다.
- **채운 파랑 (Filled Blue)** (`signal-blue-fill`): 흰 글자를 얹는 버튼 배경 전용(주요 버튼, 선택된 필터 알약, 본문으로 건너뛰기). 흰 글자 5.2:1.

### Status (의미가 고정된 색)
- **정상 초록** (`status-up` 표시용 / `status-up-text` 글자용): 정상 상태 점·막대·서비스 줄 왼쪽 표시, 정상 알약 글자.
- **주의 호박색** (`status-warn` / `status-warn-text`): 느림·부분 장애·연결 지연.
- **장애 빨강** (`status-down` / `status-down-text`): 장애·실패.
- **정보 하늘색** (`status-info` / `status-info-text`): 점검 대기·계획 작업·알 수 없음.

### Neutral (밤)
- **밤 남색 (Night Navy)** (`night-navy`): 페이지 바탕.
- **레일 남색** (`night-rail`): 왼쪽 메뉴 바탕.
- **패널 남색** (`night-panel`): 카드·서비스 줄·팝업 바탕.
- **올린 패널** (`night-panel-raised`): 패널 안의 칸(지표 타일, 아이콘 상자, 입력 칸), 마우스를 올린 서비스 줄.
- **선** (`night-line` / `night-line-strong`): 패널 테두리 / 칩·입력 칸·버튼 테두리.
- **글자 3단계** (`night-text` 본문·숫자, `night-muted` 이름표·설명, `night-faint` 시각·단위·안내 문구).

### Neutral (낮, 밝은 화면)
- 같은 역할의 밝은 값: `day-bg`, `day-panel`, `day-panel-raised`, `day-line`, `day-line-strong`, `day-text`, `day-muted`, `day-faint`. 파랑은 `day-blue` 하나가 글자와 버튼을 겸하고, 상태 글자색은 `day-up-text`·`day-warn-text`·`day-down-text`.

### Service Colors (그래프·아이콘 전용 10색)
서비스마다 하나씩, 목록 순서대로 배정하는 고유색입니다(`dashboard.css`의 `--sc-1` ~ `--sc-10`, 0번은 회색). 어두운 화면 값은 서로 Lab 거리 ΔE 27.8 이상·바탕 대비 4.7:1 이상으로 계산했고, 밝은 화면은 같은 색상을 어둡게 한 값입니다. 11번째부터는 색을 다시 쓰고 선을 점선으로 바꿉니다. **상태를 뜻하지 않습니다.**

### Named Rules
**The Status-Only Color Rule.** 채도 높은 색은 상태(정상·주의·장애·정보)와 주요 동작(파랑)에만 쓴다. 장식·강조·구분용으로 상태색을 빌려 쓰지 않는다 — 초록이 보이면 언제나 "정상"이어야 한다.

**The Text-Token Rule.** 상태색은 표시용(점·막대·테두리)과 글자용(`-text`)이 따로 있다. 글자에는 반드시 글자용을 쓴다. 표시용 초록 `#16a34a`는 밝은 화면 흰 바탕에서 3.3:1밖에 안 된다.

**The Two Blues Rule.** 흰 글자를 얹는 파란 면은 `signal-blue-fill`, 어두운 바탕 위 파란 글자·선은 `signal-blue`. 하나로 합치면 어느 한쪽의 대비가 무너진다.

## Typography

**Body Font:** Pretendard 지정, 실제로는 시스템 글꼴로 표시 (Windows는 Segoe UI·맑은 고딕, macOS는 Apple SD Gothic Neo). 웹 글꼴을 불러오지 않습니다.

**Character:** 한 가지 산세리프로 크기와 굵기만 바꿔 위계를 만듭니다. 숫자는 굵고 고정폭이라 회차마다 바뀌어도 자리가 흔들리지 않습니다.

### Hierarchy
- **Headline** (700, 24px): 화면 제목 하나(서비스 모니터링, 서비스 이름).
- **Metric** (800, 22px, tabular-nums): 요약 칸의 큰 숫자. 서비스 줄의 가동률은 같은 성격으로 19px.
- **Title** (700, 17px): 서비스 이름, 카드 제목(14~16px).
- **Body** (400, 14px, 줄 간격 1.55): 기본 글자.
- **Label** (600, 12.5~13px): 이름표, 버튼, 칩, 탭.
- **Caption** (500, 11.5~12px): 시각, 단위, 안내 문구. `night-faint` / `day-faint` 색.

### Named Rules
**The Heavy Numbers Rule.** 화면에서 가장 굵은 글자(800)는 숫자다. 제목보다 숫자가 먼저 읽혀야 한다.

## Layout

- **틀:** 왼쪽 메뉴(220px, 화면 높이에 고정) + 본문(여백 18px 24px). 760px 이하에서는 메뉴가 위쪽 가로 띠로 바뀝니다.
- **대시보드 격자:** 본문 1.7 : 오른쪽 칸 1, 간격 세로 14px·가로 18px. 왼쪽은 요약 3칸 → 제목 → 서비스 줄 목록, 오른쪽은 최근 알림 → 운영 지표(2×2 타일) → 오늘 확인할 것 → 최근 변경. 넓은 화면에서는 오른쪽 칸이 스크롤해도 위 16px에 붙어 따라옵니다.
- **1180px 이하:** 한 줄 배치로 바뀌고 오른쪽 칸 고정을 풉니다.
- **간격 리듬:** 묶음 안 6~10px, 카드 사이 12~14px, 패널 안쪽 14~18px.
- **서비스 줄:** 아이콘(44px) · 이름 · 상태 · 가동률 · 최근 점검 · 세부 점검 칩이 한 줄. 좁아지면 위아래로 쌓습니다.

## Elevation & Depth

평평합니다. 깊이는 **남색 밝기 단계와 1px 테두리**로만 나타냅니다(바탕 → 메뉴 → 패널 → 올린 칸). 그림자는 화면 위에 떠오르는 팝업에만 씁니다. 상태 점의 옅은 고리(`0 0 0 3px` 상태색 15%)는 그림자가 아니라 "살아 있음" 표시입니다.

### Shadow Vocabulary
- **팝업** (`box-shadow: 0 30px 80px rgba(0, 0, 0, .55)`): 지표 확대·서비스 추가·점검 상세 팝업처럼 화면 위에 뜨는 상자에만.
- **상태 고리** (`box-shadow: 0 0 0 3px <상태색 14~15%>`): 다음 점검 점, 상태 아이콘.

### Named Rules
**The Flat Panel Rule.** 패널·카드·서비스 줄에는 그림자를 넣지 않는다. 위계가 필요하면 한 단계 밝은 남색(`night-panel-raised`)이나 강한 테두리(`night-line-strong`)를 쓴다.

## Shapes

부드럽지만 둥글지 않은 모서리. 크기가 작을수록 반경도 작습니다: 칩 7px → 버튼·입력 칸·메뉴 9px → 지표 타일·아이콘 상자 10px → 패널 12px → 팝업 24px. 상태 알약·필터 알약·추가 버튼은 완전한 알약(999px), 상태 점·요약 아이콘은 원입니다.

## Components

### Buttons
또렷하고 자신 있게: 누를 수 있는 것은 망설임 없이 보입니다.
- **Shape:** 9px 모서리.
- **Primary:** 채운 파랑(`signal-blue-fill`)에 흰 글자, 600, 13.5px, 여백 8px 16px.
- **Secondary:** 올린 패널 바탕 + 강한 테두리, 본문색 글자.
- **추가 버튼:** 점선 테두리 알약("+ 서비스 추가"). 마우스를 올리면 파란 실선.
- **Focus:** 2px 파란 외곽선, 2px 띄움(모든 누를 수 있는 것 공통).

### Chips
- **필터 알약:** 선택된 것은 채운 파랑 + 흰 글자 알약(7px 14px).
- **상태 알약:** 옅은 상태색 바탕 + 글자용 상태색, 800, 13px, 아이콘 14px. 정상·주의·장애·정보.
- **세부 점검 칩:** "HTTP ✓ 정상"처럼 점검 종류 + 상태. 7px 모서리, 강한 테두리, 11.5px 700. 누르면 점검 상세 팝업, 마우스를 올리면 파란 테두리.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** 패널 남색, 안쪽 칸은 올린 패널.
- **Shadow Strategy:** 없음(The Flat Panel Rule).
- **Border:** 1px `night-line`.
- **Internal Padding:** 14~18px.
- **서비스 줄:** 왼쪽 3px 상태색 테두리로 서비스 상태를 표시합니다(정상 초록·주의 호박·장애 빨강·대기 파랑). 마우스를 올리면 올린 패널로 밝아집니다.

### Inputs / Fields
- **Style:** 올린 패널 바탕, 강한 테두리, 9px 모서리. 검색창은 돋보기 아이콘과 입력 칸이 한 칸 안에.
- **Focus:** 테두리가 파랑으로 바뀌고 2px 파란 외곽선(검색창은 감싸는 칸 전체에).
- **Placeholder:** `night-faint` / `day-faint`(4.5:1 이상).

### Navigation
- **왼쪽 메뉴:** 아이콘 + 이름, 600, 여백 10px 12px, 9px 모서리. 기본은 흐린 글자, 마우스를 올리면 아주 옅은 흰 바탕, 현재 페이지는 옅은 파랑 바탕 + 밝은 파랑 글자 + 왼쪽 2px 파란 선.
- **아래쪽:** 운영 근거(작은 글자), GitHub, 어두운·밝은 화면 스위치.
- **760px 이하:** 위쪽 가로 띠.

### Metric Tile (운영 지표 타일)
2×2 격자의 누를 수 있는 타일: 이름표 → 큰 숫자(800) → 한 줄 설명(전주 대비 등) → 축 없는 작은 선 그래프. 누르면 확대 팝업(겹쳐 보기·순위·서비스별 탭). 나빠졌을 때만 설명 글자를 주의색으로 바꿉니다.

### Check Cycle (다음 점검 표시)
초록 점 + "다음 점검 01:46" 카운트다운. 점에서 고리가 퍼지는 움직임은 "지금 잘 돌고 있다"는 뜻으로만 쓰고, 연결이 늦으면 호박색 점으로 바뀌며 멈춥니다. 움직임 줄이기 설정에서는 점만 보입니다.

## Do's and Don'ts

### Do:
- **Do** 새 화면도 `.dash` 팔레트(`--d-*` 토큰)와 왼쪽 메뉴 틀을 쓴다. 공용 `style.css` 토큰은 아직 옛 틀(장애 상세·월간 보고서)이 쓰는 값이다.
- **Do** 글자에는 글자용 토큰(`--d-*-text`, `--d-faint` 이상)을 쓰고, 새 조합은 `test/contrast.test.js`에 넣어 4.5:1을 확인한다.
- **Do** 상태를 색 + 글자 + 아이콘으로 함께 보인다(색만으로 구분하지 않기).
- **Do** 숫자에는 `font-variant-numeric: tabular-nums`를 준다.
- **Do** 어두운·밝은 화면, 390px 모바일을 함께 확인한다.
- **Do** 움직임에는 `prefers-reduced-motion` 대안을 둔다.

### Don't:
- **Don't** 상태색(초록·호박·빨강)을 장식이나 강조에 쓰지 않는다.
- **Don't** 서비스 고유색으로 상태를 표현하지 않는다(고유색은 어떤 서비스인지만 뜻한다).
- **Don't** 패널·카드에 그림자를 넣지 않는다. 그림자는 팝업 전용이다.
- **Don't** 흰 글자를 `signal-blue`(#3b82f6) 위에 얹지 않는다(3.7:1). `signal-blue-fill`을 쓴다.
- **Don't** 입력 칸의 초점 외곽선을 지우고 테두리 색만 바꾸지 않는다.
