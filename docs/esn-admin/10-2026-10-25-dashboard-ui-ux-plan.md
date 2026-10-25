# EMS 관리자 대시보드 UI/UX 개선 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

2026-10-25 · Australia/Sydney · 브랜치 `dashboard-ui/ux` · **상태: Task 1~8 구현·integrator 승인 완료(미커밋) — [검증 기록](../verification/2026-10-25-ems-dashboard-ui-ux.md)**

**2026-10-25 사용자 결정(개정 2):** D1 로고·강조색은 **검정** 그대로, D2 사이드바 **검정**, D3 첫 화면에 **실제 건수 카드 포함**. 글꼴은 Manrope가 아니라 **Google Fonts Outfit**(관리자 범위 전용)으로 바꾼다. 8절의 결정 표는 기록으로 남기며 아래 본문이 우선한다.

**작업 분배(`/orchestration`):** Codex 패킷 C1 = 건수 계산·훅·상태 톤 매핑·테스트·`package.json` 스크립트. UI 패킷 U1 = 글꼴·토큰·셸·배지·Overview 레이아웃·로그인 테마. UI 패킷 U2(C1 완료 후) = 훅·톤 매핑 연결. 두 패킷이 함께 쓰는 계약은 `src/modules/admin-dashboard/application/overview-counts-contract.ts`이며 lead가 작성했고 두 패킷 모두 수정하지 않는다.

**Goal:** 관리자 EMS(`/admin/**`)에 L&K 로고의 검정·금색을 기반으로 한 전용 팔레트를 적용하고, 글자 크기·두께·입력창·상태 표시·반응형을 정비해 가독성과 사용성을 높인다. 메인(공개) 페이지는 바꾸지 않는다.

**Architecture:** 관리자 범위(`.admin-workspace`, `.admin-leave-dialog`, 직원 로그인 화면)에만 `--ems-*` 토큰을 정의하고, 같은 범위에서 기존 `--site-*` 변수를 EMS 값으로 다시 지정한다. 그러면 관리자 안에 들어간 고객·문의·견적·예약·세션 화면이 코드 변경 없이 새 색을 따른다. 입력창·버튼·상태는 관리자 범위의 공통 규칙 한 곳에서 관리하고, 개별 모듈의 하드코딩 색은 같은 범위에서 덮어쓴다.

**Tech Stack:** Next.js 16.3.6(App Router, `--webpack`), React, TypeScript, Tailwind v4(`@theme`), 일반 CSS 파일, lucide-react, Manrope 로컬 가변 글꼴(400–800), Node `node:test`.

## Global Constraints

- 공개 사이트(`/`, `/services/**`, `/quote/**` 고객 화면)의 색·글꼴·레이아웃은 바꾸지 않는다. `src/shared/styles/tokens.css`의 `:root` 값은 수정하지 않는다.
- 업무 로직·API·DB·권한·인증 흐름은 바꾸지 않는다. 이번 작업은 표현 계층(CSS·마크업 구조·표시 컴포넌트)만 다룬다.
- 존재하지 않는 KPI·건수·매출을 화면에 만들지 않는다. 준비 중 기능을 0건/0원으로 표시하지 않는다.
- 본문 텍스트 대비 4.5:1 이상, 큰 글자·아이콘·입력창 테두리 등 비텍스트 요소 3:1 이상(WCAG 2.1 AA).
- 관리자 화면 최소 글자 크기 12px. 본문 15px. 모바일 입력창 16px(iOS 확대 방지).
- 터치·클릭 대상 최소 44×44px. 키보드 focus 표시 유지. `prefers-reduced-motion` 존중.
- 금색(`#C9A227`)은 밝은 배경 위의 **글자색으로 쓰지 않는다**(대비 2.42:1). 밝은 배경의 금색 글자는 `--ems-gold-text`(#7A5E0E, 6.11:1)를 쓴다.
- 커밋·푸시·배포는 사용자가 요청할 때만 한다.
- 브라우저 검증은 이 워크트리에서 합성 픽스처(`scripts/verify-esn-ui-fixture.mjs`)로 한다. 회사 DB·실제 계정으로 검증하지 않는다.

---

## 1. 현재 화면 분석 (근거: 코드 + `docs/verification/assets/ems-admin-shell-desktop-20261007.png`)

| # | 문제 | 근거 | 사용자 영향 |
| --- | --- | --- | --- |
| A1 | 배경·카드·사이드바·상단바가 거의 같은 회백색 | `--site-background #f1efe9`, `--site-surface #faf8f3` 대비 1.05:1. 사이드바·상단바·카드 모두 `--admin-surface` | 영역 구분이 테두리 선에만 의존해 화면이 한 덩어리로 보임 |
| A2 | 강조색이 하나(짙은 슬레이트)뿐 | `--site-action #2e3a3f`가 활성 메뉴·버튼·로고·글자에 모두 쓰임 | 무엇이 “선택됨/눌러야 함/그냥 글자”인지 구분이 약함 |
| A3 | 입력창이 카드 배경과 같은 색 | `.admin-main .operations-panel input{background:var(--admin-surface)}`, 다른 모듈은 `background:white` | 어디에 입력하는지 찾기 어렵고, 읽기 전용 값과 입력란이 비슷함 |
| A4 | 글자가 너무 작음 | `admin-shell.css`에 9px 2회·10px 6회·11px 9회·12px 10회 | 태그·보조 설명·링크가 읽기 어려움, 확대 시 깨짐 |
| A5 | 작은 글자에도 강한 음수 자간 | 브랜드 18px `-.055em`, 제목 30px `-.045em` | 글자가 뭉쳐 보임 |
| A6 | 버튼 모양이 화면마다 다름 | 모서리 3px(Operations)·7px(admin)·999px(예약·견적) | 같은 행동이 다른 모양이라 학습이 어려움 |
| A7 | 상태 표시가 회색 테두리 글자뿐 | `.admin-status`, `.booking-status`, 요청 목록의 일반 `<span>` | “조치 필요/확정/실패”를 색과 모양으로 빠르게 훑을 수 없음 |
| A8 | 오류색 하드코딩 | `#9b3c32`·`#fff3ef`(operations), `#8f2525`(예약·견적) | 팔레트 변경 시 빠짐, 화면마다 오류색이 다름 |
| A9 | 로고 대신 “LK” 글자 상자 | `admin-monogram` | 브랜드 인지 약함. 실제 로고 파일 `public/images/lk-group-logo-circle-transparent.png`가 있음 |
| A10 | Overview가 설명 문장 위주 | 소개 카드 + 바로가기 4개 + 준비 중 카드 2개 | 첫 화면에서 “지금 할 일”이 보이지 않음 |
| A11 | 메뉴에 사용 가능/준비 중 항목이 섞여 있음 | Jobs·Orders·Inventory·Reports가 9px “Planned” 태그로만 구분 | 쓸 수 있는 메뉴를 찾는 데 시간이 걸림 |

## 2. 참고 디자인 해석 (Pinterest “Crypto Wallet Dashboard UI”)

참고 이미지에서 가져올 것과 버릴 것을 구분한다.

| 가져올 것 | L&K EMS 적용 |
| --- | --- |
| 어두운 사이드바 + 밝은 본문의 강한 대비 | 검정(#161412) 사이드바, 따뜻한 회백 본문(#F3F1EC), 흰 카드 |
| 큰 굵은 숫자, 작은 보조 라벨 | 숫자는 32px/750 + tabular-nums, 라벨 13px/600 |
| 연한 색조의 요약 카드 | 바로가기·요약 카드에 금색·세이지·블루·스톤 연한 바탕을 업무별로 고정 |
| 아이콘 + 두 줄 정보 + 오른쪽 값의 깔끔한 표 | 요청·예약 목록을 “이름·참조 / 상태 배지 / 날짜 / 행동” 열로 정렬 |
| 하나의 진한 강조 카드 | Overview의 “오늘 확인할 일” 카드를 검정+금색으로 한 개만 둠 |
| 넉넉한 모서리와 여백 | 카드 radius 16px, 입력·버튼 10px로 통일 |

| 버릴 것 | 이유 |
| --- | --- |
| 아이콘만 있는 좁은 사이드바 | 비전문 직원이 쓰는 업무 도구라 메뉴 이름이 항상 보여야 함. 데스크톱·태블릿 가로에서 라벨 유지 |
| 가상 수치·그래프 | 실제 집계가 없음. 수치 카드는 결정 D3 이후 실제 데이터로만 |
| 보라·민트 등 임의 파스텔 | 브랜드 팔레트에서 파생한 색조만 사용 |

## 3. EMS 컬러 팔레트

로고(`public/images/lk-group-logo.png`)는 **검정 바탕 + 금속성 금색**이다. 요청의 “검적색”은 로고 파일 기준 **검정색**으로 해석했다(결정 D1).

### 3.1 브랜드

| 토큰 | 값 | 용도 |
| --- | --- | --- |
| `--ems-black` | `#161412` | 사이드바, 기본 버튼, 강조 카드 |
| `--ems-black-raised` | `#26231F` | 사이드바 hover/활성 바탕, 기본 버튼 hover |
| `--ems-gold` | `#C9A227` | 활성 메뉴 표시선, 강조 카드의 버튼, 아이콘 포인트(어두운 바탕 위) |
| `--ems-gold-bright` | `#E0BC4F` | 어두운 바탕 위 focus·활성 아이콘 |
| `--ems-gold-text` | `#7A5E0E` | 밝은 바탕 위 금색 글자·링크·focus 테두리 |
| `--ems-gold-tint` | `#F7EFD6` | 금색 계열 연한 바탕(선택된 행, 요약 카드) |

### 3.2 중립색 — 영역 구분이 목적

| 토큰 | 값 | 용도 |
| --- | --- | --- |
| `--ems-canvas` | `#F3F1EC` | 페이지 바탕 |
| `--ems-surface` | `#FFFFFF` | 카드·상단바·패널 |
| `--ems-field` | `#F8F6F1` | **입력창 바탕**(흰 카드 안에서 구분) |
| `--ems-sunken` | `#EEEBE4` | 비활성 입력, 표 머리행, 코드·URI 상자 |
| `--ems-ink` | `#1C1A17` | 제목·본문 |
| `--ems-ink-2` | `#45413A` | 라벨·보조 제목 |
| `--ems-muted` | `#5F5A51` | 설명·메타 정보 |
| `--ems-line` | `#E2DED5` | 카드·구분선(장식용) |
| `--ems-line-strong` | `#8A8478` | **입력창·체크박스 테두리**(3:1 이상) |
| `--ems-rail-text` | `#BDB7AC` | 사이드바의 비활성 메뉴 글자 |

### 3.3 상태색 — 글자/바탕 쌍

| 톤 | 글자 | 바탕 | 의미 |
| --- | --- | --- | --- |
| success | `#2E6A4C` | `#E4F1E9` | 확정·완료·연결됨 |
| warning | `#97510A` | `#FCEEDB` | 검토 필요·대기·변경 요청 |
| danger | `#A12A2A` | `#FBE8E6` | 실패·취소·오류 |
| info | `#2D5784` | `#E5EDF6` | 진행 중·알림 |
| neutral | `#56524A` | `#ECE9E3` | 준비 중·초안·기록 |

상태는 색만으로 구분하지 않고 항상 글자(+선택적 아이콘)를 함께 표시한다.

### 3.4 측정한 대비 (스크래치 스크립트로 계산, Task 1에서 테스트로 고정)

| 조합 | 대비 | 기준 |
| --- | --- | --- |
| ink / surface | 17.36 | 텍스트 4.5 ✔ |
| muted / canvas | 6.06 | 텍스트 4.5 ✔ |
| muted / field | 6.34 | 텍스트 4.5 ✔ |
| gold-text / surface | 6.11 | 텍스트 4.5 ✔ |
| gold-text / gold-tint | 5.32 | 텍스트 4.5 ✔ |
| ink / gold (금색 버튼 글자) | 7.18 | 텍스트 4.5 ✔ |
| rail-text / black | 9.22 | 텍스트 4.5 ✔ |
| gold / black | 7.60 | 텍스트 4.5 ✔ |
| line-strong / field (입력 테두리) | 3.44 | 비텍스트 3.0 ✔ |
| line-strong / surface | 3.72 | 비텍스트 3.0 ✔ |
| 상태 5종 글자/바탕 | 5.26–6.42 | 텍스트 4.5 ✔ |
| gold / surface | 2.42 | ✘ → 밝은 바탕 글자 금지 |

### 3.5 색 사용 규칙

- **기본 행동 = 검정 버튼**(흰 글자). 한 화면 영역에 기본 버튼은 하나.
- **금색 = 브랜드 포인트와 “현재 위치”**: 활성 메뉴 표시선, 강조 카드, 선택된 행 바탕(`gold-tint`), focus. 일반 버튼을 금색으로 채우지 않는다(강조 카드 안의 한 개 예외).
- 보조 행동 = 흰 바탕 + `line-strong` 테두리. 위험 행동 = danger 글자 + 테두리, 확인 단계에서만 danger 채움.

## 4. 글꼴·크기·두께 — Outfit (개정 2)

관리자 범위(`/admin/**`, 직원 로그인)는 **[Outfit](https://fonts.google.com/specimen/Outfit)** 가변 글꼴(300–800)을 쓴다. 공개 사이트는 Manrope를 유지한다. Manrope와 같은 방식으로 Google Fonts 공식 배포 파일을 저장소에 두고 `next/font/local`로 연결한다(빌드 시 외부 네트워크 의존 없음).

| 파일 | 출처 | SHA-256 |
| --- | --- | --- |
| `src/shared/assets/fonts/Outfit-Latin-Variable.woff2` (32,228 B) | `https://fonts.gstatic.com/s/outfit/v15/QGYvz_MVcBeNP4NJtEtqUYLknw.woff2` (Google Fonts CSS v15, Latin subset, 2026-10-25) | `92684e4acde79ef07758cd09380b7e01e9824d8b061eddeda046f78c166d7b12` |
| `src/shared/assets/fonts/Outfit-LatinExt-Variable.woff2` (14,760 B) | `https://fonts.gstatic.com/s/outfit/v15/QGYvz_MVcBeNP4NJuktqUYLkn8BJ.woff2` (Latin Extended) | `9e38b3f1575daba3435ef09d33a202585ed5bd204bd0a8c744955c750c2b9091` |
| `src/shared/assets/fonts/OFL-Outfit.txt` | `https://raw.githubusercontent.com/google/fonts/main/ofl/outfit/OFL.txt` (SIL OFL 1.1, Copyright 2021 The Outfit Project Authors) | — |

lead가 받아 둔 사본: `/private/tmp/claude-501/-Users-jimee-orca-workspaces-L-K-Group-butterfish/35e645a8-48d8-4dad-81d7-8e97aa1edc9e/scratchpad/outfit/`. 복사 후 `shasum -a 256`으로 위 값과 대조하고 `src/shared/assets/fonts/README.md`에 Outfit 단락을 추가한다.

```ts
// src/shared/config/fonts.ts — manrope 옆에 추가
export const outfit = localFont({
  src: [
    { path: "../assets/fonts/Outfit-Latin-Variable.woff2", weight: "300 800", style: "normal" },
    { path: "../assets/fonts/Outfit-LatinExt-Variable.woff2", weight: "300 800", style: "normal" },
  ],
  variable: "--font-outfit",
  display: "swap",
});
```

`src/app/admin/layout.tsx`의 최상위 요소(`AdminWorkspace` 래퍼 또는 `main`)에 `outfit.variable` 클래스를 붙여 관리자 하위에서만 변수가 정의되게 한다. Outfit은 한글 글리프가 없으므로 고객 이름·주소의 한글은 시스템 한글 글꼴로 대체한다.

```css
--ems-font: var(--font-outfit, "Outfit"), "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif;
```

Outfit은 x-height가 크고 기하학적이라 Manrope보다 같은 px에서 조금 커 보이고, 700 이상은 굵게 뭉친다. 그래서 제목은 **600–650**, 본문은 **400**, 라벨은 **500**으로 Manrope 계획보다 한 단계 가볍게 잡고, 음수 자간은 제목 24px 이상에만 소폭 둔다.

| 역할 | 토큰 | 크기 / 행간 / 두께 / 자간 |
| --- | --- | --- |
| 페이지 제목 H1 | `--ems-text-page` | 28px(≤600px 24px) / 1.2 / 650 / -0.015em |
| 섹션 제목 H2 | `--ems-text-section` | 20px / 1.3 / 600 / -0.01em |
| 카드 제목 H3 | `--ems-text-card` | 16px / 1.35 / 600 / 0 |
| 본문 | `--ems-text-body` | 15px / 1.55 / 400 / 0 |
| 라벨·메뉴·버튼 | `--ems-text-label` | 14px / 1.4 / 500 (활성 메뉴·버튼 600) |
| 메타·보조 | `--ems-text-meta` | 13px / 1.5 / 400, 색은 muted |
| 배지·eyebrow(최소) | `--ems-text-xs` | 12px / 1.4 / 600, eyebrow만 대문자 +0.08em |
| 요약 숫자 | `--ems-text-kpi` | 36px(≤600px 30px) / 1.05 / 600, `tabular-nums` |
| 사이드바 브랜드 | — | 17px / 600, 부제 12px / 400 |

- 두께 토큰: `--ems-weight-regular:400; --ems-weight-medium:500; --ems-weight-semibold:600; --ems-weight-bold:650`. 700 이상은 쓰지 않는다.
- 날짜·시간·금액·참조번호·건수는 `font-variant-numeric: tabular-nums`.
- 본문 최대 폭 70ch. 표·목록 셀은 줄바꿈 허용(`overflow-wrap:anywhere`) 유지.
- 검증: DevTools 계산 스타일에서 `font-family`가 Outfit으로 해석되는지, 글꼴 로딩 전후 레이아웃 이동이 없는지(`display:swap` + 비슷한 metrics), 한글 샘플("김민수 · 서울")이 대체 글꼴로 깨지지 않는지 확인한다.

## 5. 레이아웃·반응형

| 폭 | 구성 |
| --- | --- |
| ≥1181px | 검정 사이드바 248px(로고·그룹 메뉴·하단 계정) + 상단바(흰색) + 본문(canvas, 최대 1440px, 패딩 32px) |
| 901–1180px | 사이드바 216px(라벨 유지), 본문 패딩 24px, 바로가기 2열, 상세 화면 목록/상세 2열 유지 |
| 601–900px | 사이드바 숨김 → 상단바 메뉴 버튼 + 왼쪽 서랍(검정), 목록/상세 1열 |
| ≤600px | 상단바 축소(로고 + 현재 페이지명 + 메뉴 + 계정 아바타), 패딩 16px, 카드 1열(요약 카드는 2열), 버튼 행은 세로 전체 폭 |
| ≤360px | 요약 카드 1열 |

메뉴 그룹(결정 D2):

```text
WORK        Overview · Clients · Enquiries · Quotes · Schedule
COMING SOON Jobs · Orders · Inventory · Reports   (흐린 글자 + "Soon" 배지 12px)
ADMIN       Settings
```

## 6. 컴포넌트 상태 규칙

| 컴포넌트 | 기본 | hover | focus-visible | active | disabled | error |
| --- | --- | --- | --- | --- | --- | --- |
| 입력창 | field 바탕, line-strong 테두리, radius 10 | 테두리 ink-2 | 흰 바탕 + ink 테두리 + 3px gold-tint 링 + 2px gold-text outline | — | sunken 바탕, muted 글자 | danger 테두리 + 아래 오류 문구(`aria-invalid`) |
| 기본 버튼 | black / 흰 글자 | black-raised | 2px gold-text outline offset 3 | scale .98 (reduced-motion 제외) | opacity .5, not-allowed | — |
| 보조 버튼 | 흰 바탕 / line-strong / ink | canvas 바탕 | 동일 | 동일 | 동일 | — |
| 사이드바 메뉴 | rail-text 글자 | black-raised 바탕, 흰 글자 | 2px gold-bright outline | `aria-current`: black-raised + 왼쪽 3px gold 선 + 흰 글자 + gold 아이콘 | — | — |
| 목록 행 | 흰 바탕 | canvas 바탕 | outline | 선택: gold-tint 바탕 + 왼쪽 3px gold 선 | — | — |

읽기 전용 값(`dl/dd`)은 테두리·바탕 없이 라벨(13px muted)/값(15px ink) 2단으로 둬 입력창과 구분한다.

---

## 7. 파일 구조

| 파일 | 작업 | 책임 |
| --- | --- | --- |
| `src/modules/admin-dashboard/presentation/admin-theme.css` | 생성 | EMS 토큰, `--site-*` 재지정, 글꼴·타입 토큰, 공통 입력/버튼/배지/알림 규칙, 모듈 하드코딩 색 덮어쓰기 |
| `src/modules/admin-dashboard/presentation/admin-palette.test.mts` | 생성 | 토큰 파일을 읽어 대비 기준을 검증 |
| `src/modules/admin-dashboard/presentation/admin-shell.css` | 수정 | 셸·사이드바·상단바·Overview 레이아웃, 크기·간격 정비 |
| `src/modules/admin-dashboard/presentation/admin-shell.tsx` | 수정 | theme import, 로고 이미지, 메뉴 그룹 렌더링 |
| `src/modules/admin-dashboard/presentation/admin-navigation.ts` | 수정 | 각 페이지에 `group` 필드 추가 |
| `src/modules/admin-dashboard/presentation/admin-pages.tsx` | 수정 | Overview 구성 변경(데이터 없는 범위) |
| `src/shared/ui/status-badge.tsx` | 생성 | `tone` + 글자를 받는 표시 전용 배지 |
| `src/modules/quotes/presentation/live-requests-panel.tsx` | 수정 | 요청 상태를 `StatusBadge`로 표시 |
| `src/modules/bookings/presentation/live-company-schedule.tsx`, `booking-ui.tsx` | 수정 | 예약 상태를 `StatusBadge`로 표시 |
| `src/modules/admin-access/presentation/staff-admin-boundary.tsx` | 수정 | 로그인·MFA 화면 최상위에 `ems-theme` 클래스 추가 |
| `package.json` | 수정 | `test:admin-shell`·`test:operations`에 팔레트 테스트 추가 |
| `docs/esn-admin/README.md`, `08-ems-dashboard-design-and-implementation-plan.md` | 수정 | 관리자 팔레트가 Slate/Greige에서 EMS 검정·금색으로 바뀐 결정 기록 |
| `docs/verification/2026-10-2x-ems-dashboard-ui-ux.md` | 생성 | 실행 증거(검사 결과·스크린샷 경로·남은 제한) |

---

### Task 1: EMS 토큰과 대비 테스트

**Files:**
- Create: `src/modules/admin-dashboard/presentation/admin-theme.css`
- Create: `src/modules/admin-dashboard/presentation/admin-palette.test.mts`
- Modify: `src/modules/admin-dashboard/presentation/admin-shell.tsx:10` (import 추가)
- Modify: `package.json` (`test:admin-shell`, `test:operations`)

**Interfaces:**
- Produces: CSS 변수 `--ems-*`(3장 표의 이름 그대로), 범위 선택자 `.admin-workspace, .admin-leave-dialog, .ems-theme`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/modules/admin-dashboard/presentation/admin-palette.test.mts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("./admin-theme.css", import.meta.url), "utf8");
const token = (name: string) => {
  const match = css.match(new RegExp(`--ems-${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `missing --ems-${name}`);
  return match[1];
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const text: [string, string][] = [["ink", "surface"], ["ink", "canvas"], ["ink", "field"], ["ink-2", "surface"], ["muted", "surface"], ["muted", "canvas"], ["muted", "field"], ["gold-text", "surface"], ["gold-text", "canvas"], ["gold-text", "gold-tint"], ["rail-text", "black"], ["gold", "black"], ["ink", "gold"], ["success", "success-bg"], ["warning", "warning-bg"], ["danger", "danger-bg"], ["info", "info-bg"], ["neutral", "neutral-bg"]];
const nonText: [string, string][] = [["line-strong", "surface"], ["line-strong", "field"], ["gold-bright", "black"]];

test("EMS text pairs meet WCAG AA 4.5:1", () => {
  for (const [fg, bg] of text) assert.ok(contrast(token(fg), token(bg)) >= 4.5, `${fg} on ${bg}`);
});
test("EMS field borders and focus indicators meet 3:1", () => {
  for (const [fg, bg] of nonText) assert.ok(contrast(token(fg), token(bg)) >= 3, `${fg} on ${bg}`);
});
test("input fields are visibly distinct from cards and the page", () => {
  assert.notEqual(token("field"), token("surface"));
  assert.notEqual(token("field"), token("canvas"));
});
test("admin scope remaps shared site tokens instead of editing the public :root", () => {
  assert.doesNotMatch(css, /:root\s*\{/);
  for (const name of ["background", "surface", "foreground", "muted", "border", "border-strong", "action", "action-hover", "on-action", "focus"]) assert.match(css, new RegExp(`--site-${name}:\\s*var\\(--ems-`));
});
```

- [ ] **Step 2: 실패 확인** — `node --experimental-strip-types --test src/modules/admin-dashboard/presentation/admin-palette.test.mts` → `ENOENT ... admin-theme.css`로 FAIL

- [ ] **Step 3: 토큰 파일 작성**

```css
/* src/modules/admin-dashboard/presentation/admin-theme.css */
.admin-workspace,
.admin-leave-dialog,
.ems-theme {
  --ems-black: #161412;
  --ems-black-raised: #26231F;
  --ems-gold: #C9A227;
  --ems-gold-bright: #E0BC4F;
  --ems-gold-text: #7A5E0E;
  --ems-gold-tint: #F7EFD6;

  --ems-canvas: #F3F1EC;
  --ems-surface: #FFFFFF;
  --ems-field: #F8F6F1;
  --ems-sunken: #EEEBE4;
  --ems-ink: #1C1A17;
  --ems-ink-2: #45413A;
  --ems-muted: #5F5A51;
  --ems-line: #E2DED5;
  --ems-line-strong: #8A8478;
  --ems-rail-text: #BDB7AC;

  --ems-success: #2E6A4C;
  --ems-success-bg: #E4F1E9;
  --ems-warning: #97510A;
  --ems-warning-bg: #FCEEDB;
  --ems-danger: #A12A2A;
  --ems-danger-bg: #FBE8E6;
  --ems-info: #2D5784;
  --ems-info-bg: #E5EDF6;
  --ems-neutral: #56524A;
  --ems-neutral-bg: #ECE9E3;

  --ems-font: var(--font-outfit, "Outfit"), "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif;
  --ems-weight-regular: 400;
  --ems-weight-medium: 500;
  --ems-weight-semibold: 600;
  --ems-weight-bold: 650;
  --ems-text-page: 28px;
  --ems-text-section: 20px;
  --ems-text-card: 16px;
  --ems-text-body: 15px;
  --ems-text-label: 14px;
  --ems-text-meta: 13px;
  --ems-text-xs: 12px;
  --ems-text-kpi: 36px;
  --ems-radius-card: 16px;
  --ems-radius-control: 10px;
  --ems-shadow-card: 0 1px 2px rgb(22 20 18 / 6%), 0 4px 16px rgb(22 20 18 / 4%);

  --site-background: var(--ems-canvas);
  --site-surface: var(--ems-surface);
  --site-foreground: var(--ems-ink);
  --site-muted: var(--ems-muted);
  --site-border: var(--ems-line);
  --site-border-strong: var(--ems-line-strong);
  --site-action: var(--ems-black);
  --site-action-hover: var(--ems-black-raised);
  --site-on-action: var(--ems-surface);
  --site-focus: var(--ems-gold-text);
  --site-focus-outer: var(--ems-surface);
  --site-disabled-surface: var(--ems-sunken);
  --site-disabled-text: var(--ems-muted);

  font-family: var(--ems-font);
  color: var(--ems-ink);
}

@media (max-width: 600px) {
  .admin-workspace, .ems-theme { --ems-text-page: 24px; --ems-text-kpi: 30px; }
}
```

`admin-shell.tsx`의 `import "./admin-shell.css";` 바로 위에 `import "./admin-theme.css";`를 추가한다(토큰이 셸 규칙보다 먼저 로드).

- [ ] **Step 4: 통과 확인** — 같은 명령 → 4 tests PASS
- [ ] **Step 5: 스크립트 등록** — `package.json`의 `test:admin-shell`과 `test:operations` 목록 끝에 `src/modules/admin-dashboard/presentation/admin-palette.test.mts` 추가 후 `npm run test:admin-shell` PASS 확인

### Task 2: 공통 입력창·버튼·배지·알림 규칙

**Files:**
- Modify: `src/modules/admin-dashboard/presentation/admin-theme.css` (Task 1 아래에 이어서)
- Modify: `src/modules/admin-dashboard/presentation/admin-shell.css` — 기존 `.admin-main .operations-panel input…{border-radius:7px;background:var(--admin-surface)…}`와 `.admin-main.operations-page button{border-radius:7px;font-size:12px}` 삭제

**Interfaces:**
- Consumes: Task 1 토큰
- Produces: 클래스 `.ems-badge`, `.ems-badge[data-tone="success|warning|danger|info|neutral"]` (Task 4가 사용)

선택자 특이도: `.admin-workspace .admin-main :is(...)`는 (0,4,1)로 `.lq-fields input:not(..)`(0,3,1), `.live-company-booking input:not(..)`(0,2,1), `.operations-panel input:not(..)`(0,2,1)을 이긴다. `!important`는 쓰지 않는다.

- [ ] **Step 1: 규칙 추가**

```css
/* Fields — distinct from cards and page */
:is(.admin-workspace .admin-main, .ems-theme) :is(input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea) {
  min-height: 44px; width: 100%; max-width: 100%;
  border: 1px solid var(--ems-line-strong); border-radius: var(--ems-radius-control);
  background: var(--ems-field); color: var(--ems-ink);
  padding: 10px 12px; font: 400 var(--ems-text-body)/1.4 var(--ems-font);
}
:is(.admin-workspace .admin-main, .ems-theme) :is(input, select, textarea)::placeholder { color: var(--ems-muted); opacity: 1; }
:is(.admin-workspace .admin-main, .ems-theme) :is(input:not([type=checkbox]):not([type=radio]), select, textarea):hover:not(:disabled) { border-color: var(--ems-ink-2); }
:is(.admin-workspace .admin-main, .ems-theme) :is(input:not([type=checkbox]):not([type=radio]), select, textarea):focus-visible {
  background: var(--ems-surface); border-color: var(--ems-ink);
  outline: 2px solid var(--ems-gold-text); outline-offset: 2px; box-shadow: 0 0 0 5px var(--ems-gold-tint);
}
:is(.admin-workspace .admin-main, .ems-theme) :is(input, select, textarea):disabled { background: var(--ems-sunken); color: var(--ems-muted); cursor: not-allowed; }
:is(.admin-workspace .admin-main, .ems-theme) :is(input, select, textarea)[aria-invalid=true] { border-color: var(--ems-danger); }
:is(.admin-workspace .admin-main, .ems-theme) label { font-size: var(--ems-text-label); font-weight: 600; color: var(--ems-ink-2); }
:is(.admin-workspace .admin-main, .ems-theme) :is(input[type=checkbox], input[type=radio]) { width: 18px; height: 18px; accent-color: var(--ems-black); }

/* Buttons — one shape everywhere */
:is(.admin-workspace .admin-main, .ems-theme) button:not(.admin-menu-button) {
  min-height: 44px; border-radius: var(--ems-radius-control); padding: 10px 16px;
  font: 650 var(--ems-text-label)/1.2 var(--ems-font);
}
:is(.admin-workspace .admin-main, .ems-theme) :is(button.secondary, button.operations-button-secondary) {
  background: var(--ems-surface); border-color: var(--ems-line-strong); color: var(--ems-ink);
}
@media (hover: hover) and (pointer: fine) {
  :is(.admin-workspace .admin-main, .ems-theme) :is(button.secondary, button.operations-button-secondary):hover:not(:disabled) { background: var(--ems-canvas); }
}
:is(.admin-workspace, .ems-theme) :is(button, a, summary):focus-visible { outline: 2px solid var(--ems-gold-text); outline-offset: 3px; box-shadow: none; }

/* Badges */
.ems-badge { display: inline-flex; align-items: center; gap: 6px; min-height: 26px; padding: 3px 10px; border-radius: 999px; font: 650 var(--ems-text-xs)/1.3 var(--ems-font); background: var(--ems-neutral-bg); color: var(--ems-neutral); white-space: nowrap; }
.ems-badge[data-tone=success] { background: var(--ems-success-bg); color: var(--ems-success); }
.ems-badge[data-tone=warning] { background: var(--ems-warning-bg); color: var(--ems-warning); }
.ems-badge[data-tone=danger] { background: var(--ems-danger-bg); color: var(--ems-danger); }
.ems-badge[data-tone=info] { background: var(--ems-info-bg); color: var(--ems-info); }

/* Notices & errors — replace module hardcoded colours inside admin scope only */
:is(.admin-workspace, .ems-theme) :is(.operations-error, .lq-error, .live-company-error) { border: 1px solid var(--ems-danger); border-left-width: 4px; border-radius: var(--ems-radius-control); background: var(--ems-danger-bg); color: var(--ems-danger); padding: 12px 14px; }
:is(.admin-workspace, .ems-theme) :is(.operations-notice, .lq-notice, .live-company-notice, .booking-demo-note) { border: 1px solid var(--ems-line); border-left: 4px solid var(--ems-info); border-radius: var(--ems-radius-control); background: var(--ems-info-bg); color: var(--ems-ink); }
:is(.admin-workspace, .ems-theme) :is(.operations-uri, .staff-admin-secret) { background: var(--ems-sunken); border-radius: 8px; }

/* Read-only details — no field look */
.admin-workspace :is(.operations-detail dt, .booking-definition dt, .lq-details dt, .live-company-details dt, .customers-contact dt) { font-size: var(--ems-text-meta); font-weight: 600; color: var(--ems-muted); }
.admin-workspace :is(.operations-detail dd, .booking-definition dd, .lq-details dd, .live-company-details dd, .customers-contact dd) { font-size: var(--ems-text-body); color: var(--ems-ink); }
```

- [ ] **Step 2: 확인** — `npm run lint && npm run typecheck` PASS. 합성 픽스처에서 `/admin/customers`(검색·생성 폼), `/admin/schedule`(예약 편집기), `/admin/settings`(세션) 입력창이 카드와 다른 바탕·진한 테두리로 보이는지, Tab 이동 시 금색 focus가 보이는지 확인

### Task 3: 셸 — 검정 사이드바, 로고, 메뉴 그룹, 상단바, 타입 스케일

**Files:**
- Modify: `src/modules/admin-dashboard/presentation/admin-navigation.ts`
- Modify: `src/modules/admin-dashboard/presentation/admin-shell.tsx`
- Modify: `src/modules/admin-dashboard/presentation/admin-shell.css`

**Interfaces:**
- Produces: `adminPages[n].group: "work" | "soon" | "admin"`, `adminNavGroups: readonly { id: "work" | "soon" | "admin"; label: string }[]`

- [ ] **Step 1: 메뉴 그룹 데이터** — `admin-navigation.ts`

```ts
export const adminNavGroups = [
  { id: "work", label: "Work" },
  { id: "soon", label: "Coming soon" },
  { id: "admin", label: "Admin" },
] as const;
```

각 `adminPages` 항목에 `group`을 추가: overview·customers·enquiries·quotes·schedule = `"work"`, jobs·orders·inventory·reports = `"soon"`(기존 `upcoming: true` 유지), settings = `"admin"`.

- [ ] **Step 2: 그룹 렌더링 + 로고** — `admin-shell.tsx`의 `Navigation`

```tsx
function Navigation({ onSelect }: { onSelect?: () => void }) {
  const pathname = usePathname();
  return <nav aria-label="Administrator workspace">{adminNavGroups.map((group) => <div key={group.id} className="admin-nav-group">
    <p className="admin-nav-label" id={`admin-nav-${group.id}`}>{group.label}</p>
    <ul className="admin-nav-list" aria-labelledby={`admin-nav-${group.id}`}>
      {adminPages.filter((page) => page.group === group.id).map((page) => { const Icon = icons[page.id]; return <li key={page.id}>
        <WorkspaceLink href={page.href} aria-current={pathname === page.href ? "page" : undefined} onClick={onSelect}>
          <Icon size={20} aria-hidden="true" /><span>{page.label}</span>{"upcoming" in page && <span className="admin-nav-tag">Soon</span>}
        </WorkspaceLink>
      </li>; })}
    </ul>
  </div>)}</nav>;
}
```

브랜드는 `LK` 상자 대신 실제 로고를 쓴다(`siteAssets`의 원형 투명 로고, 합성 픽스처가 이미 w=96/128/256 허용):

```tsx
<WorkspaceLink href="/admin" className="admin-brand" aria-label="L&K Group overview"><Image src={siteAssets.wordmark.src} alt="" width={44} height={44} priority /><span><strong>L&K Group</strong><small>EMS · Private workspace</small></span></WorkspaceLink>
```

`siteAssets.wordmark`(`src/shared/config/assets.ts:11`, 1254×1254 원형 투명 로고)를 재사용한다. 상단 `import Image from "next/image";`, `import { siteAssets } from "@/shared/config/assets";` 추가. 모바일 서랍 머리에도 같은 로고(36px)를 쓴다.

- [ ] **Step 3: 셸 CSS 교체** — `admin-shell.css`에서 `--admin-*` 변수 선언을 EMS 토큰 별칭으로 바꾸고 아래 규칙을 반영한다(나머지 기존 규칙의 9–11px 글자는 모두 `--ems-text-xs` 이상으로 올린다).

```css
.admin-workspace{--admin-bg:var(--ems-canvas);--admin-surface:var(--ems-surface);--admin-ink:var(--ems-ink);--admin-muted:var(--ems-muted);--admin-line:var(--ems-line);--admin-action:var(--ems-black);--admin-radius:var(--ems-radius-card);display:grid;grid-template-columns:248px minmax(0,1fr);min-height:100svh;background:var(--admin-bg);color:var(--admin-ink);font-size:var(--ems-text-body)}
.admin-sidebar{position:sticky;top:0;height:100svh;overflow-y:auto;display:flex;flex-direction:column;gap:28px;background:var(--ems-black);color:var(--ems-rail-text);padding:24px 14px 20px}
.admin-brand{display:flex;gap:12px;align-items:center;padding:0 8px;color:var(--ems-surface)}
.admin-brand strong{font-size:17px;font-weight:750;letter-spacing:-.01em}
.admin-brand small{display:block;margin-top:2px;font-size:var(--ems-text-xs);color:var(--ems-rail-text)}
.admin-nav-group+.admin-nav-group{margin-top:20px}
.admin-nav-label{text-transform:uppercase;font-size:var(--ems-text-xs);letter-spacing:.08em;font-weight:650;color:var(--ems-rail-text);margin:0 12px 8px}
.admin-nav-list a{position:relative;display:flex;gap:12px;align-items:center;min-height:44px;border-radius:10px;padding:10px 12px;font-size:var(--ems-text-label);font-weight:600;color:var(--ems-rail-text)}
.admin-nav-list a[aria-current=page]{background:var(--ems-black-raised);color:var(--ems-surface)}
.admin-nav-list a[aria-current=page]::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:3px;background:var(--ems-gold)}
.admin-nav-list a[aria-current=page] svg{color:var(--ems-gold)}
.admin-nav-list a:focus-visible{outline:2px solid var(--ems-gold-bright);outline-offset:2px}
.admin-nav-tag{margin-left:auto;font-size:var(--ems-text-xs);font-weight:600;border:1px solid #4A453E;border-radius:999px;padding:1px 8px;color:var(--ems-rail-text)}
.admin-sidebar-foot{margin-top:auto;border-top:1px solid #33302B;padding:16px 8px 0;display:flex;gap:10px;color:var(--ems-rail-text);font-size:var(--ems-text-meta);line-height:1.5}
.admin-topbar{min-height:72px;border-bottom:1px solid var(--ems-line);padding:14px 32px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--ems-surface)}
.admin-breadcrumb{display:flex;align-items:center;gap:10px;color:var(--ems-muted);font-size:var(--ems-text-meta)}
.admin-page-heading h1{font-size:var(--ems-text-page);font-weight:750;line-height:1.2;letter-spacing:-.02em;margin-bottom:6px}
.admin-page-heading>div>p:last-child{font-size:var(--ems-text-body);color:var(--ems-muted);line-height:1.55;max-width:70ch}
.admin-eyebrow{font-size:var(--ems-text-xs);text-transform:uppercase;letter-spacing:.08em;font-weight:650;color:var(--ems-gold-text);margin-bottom:6px}
.admin-section-heading h2,.admin-card h2,.admin-section-title{font-size:var(--ems-text-section);font-weight:700;letter-spacing:-.01em}
.admin-card,.admin-main .operations-panel{border:1px solid var(--ems-line);border-radius:var(--ems-radius-card);background:var(--ems-surface);box-shadow:var(--ems-shadow-card)}
.admin-mobile-drawer{background:var(--ems-black);color:var(--ems-rail-text);border-right:0}
.admin-drawer-heading strong{color:var(--ems-surface);font-size:18px;letter-spacing:-.01em}
.admin-drawer-heading button{border-color:#4A453E;color:var(--ems-surface)}
```

hover 미디어 쿼리 안의 사이드바 hover를 `background:var(--ems-black-raised);color:var(--ems-surface)`로 바꾼다. `.admin-sidebar` 하단 `#33302B`/`#4A453E`는 장식선이라 대비 기준 대상이 아니다.

- [ ] **Step 4: 확인** — lint·typecheck PASS. 합성 픽스처에서 1440·1024·768·390·320px로 사이드바/서랍, 활성 메뉴의 금색 표시선, 서랍 열기·Esc·바깥 클릭·포커스 복귀, 계정 메뉴를 확인

### Task 4: 상태 배지 컴포넌트와 목록 가독성

**Files:**
- Create: `src/shared/ui/status-badge.tsx`
- Modify: `src/modules/quotes/presentation/live-requests-panel.tsx:100` 부근(요청 목록 항목)
- Modify: `src/modules/bookings/presentation/booking-ui.tsx:34` 부근(`statusLabel`), `live-company-schedule.tsx`
- Modify: `src/modules/admin-dashboard/presentation/admin-theme.css` (목록 행 규칙)

**Interfaces:**
- Consumes: Task 2 `.ems-badge[data-tone]`
- Produces: `export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral"; export function StatusBadge(props: { tone: StatusTone; children: ReactNode }): JSX.Element`

- [ ] **Step 1: 표시 컴포넌트**

```tsx
// src/shared/ui/status-badge.tsx
import type { ReactNode } from "react";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className="ems-badge" data-tone={tone}>{children}</span>;
}
```

- [ ] **Step 2: 상태→톤 매핑은 각 모듈 presentation에 둔다** — 업무 의미는 모듈이 안다. 구현 전에 `src/modules/quotes/domain`과 `src/modules/bookings/domain/contracts.ts`에서 실제 status 유니온을 읽고, 아래 원칙으로 `switch` 매핑 함수를 작성한다(누락 시 TypeScript `never` 검사로 컴파일 오류가 나게 `default` 없이 작성).
  - 관리자 조치 필요(`review_requested`, `requested`, 변경 요청 등) → `warning`
  - 확정·완료·동기화됨 → `success`
  - 실패·취소·거절 → `danger`
  - 진행 중·고객 대기 → `info`
  - 초안·기록·기타 → `neutral`
- [ ] **Step 3: 매핑 테스트** — 각 모듈 기존 테스트 파일(`src/modules/quotes/presentation/request-client.test.mts`, `src/modules/bookings/presentation/live-booking-client.test.mts`)에 “조치 필요 상태는 warning, 실패 상태는 danger” 두 가지만 검증하는 케이스 추가 → 실패 확인 → 매핑 구현 → 통과
- [ ] **Step 4: 목록 행 규칙**

```css
.admin-workspace :is(.lq-admin-list, .live-company-list)>li{border:1px solid var(--ems-line);border-radius:12px;background:var(--ems-surface);padding:14px 16px}
.admin-workspace :is(.lq-admin-list, .live-company-list)>li strong{font-size:var(--ems-text-card);font-weight:700}
.admin-workspace :is(.lq-admin-list, .live-company-list)>li span{font-size:var(--ems-text-meta);color:var(--ems-muted);font-variant-numeric:tabular-nums}
.admin-workspace .operations-inbox button.selected{background:var(--ems-gold-tint);box-shadow:inset 3px 0 0 var(--ems-gold)}
@media (hover:hover) and (pointer:fine){.admin-workspace :is(.lq-admin-list, .live-company-list)>li:hover{border-color:var(--ems-line-strong)}}
```

- [ ] **Step 5: 확인** — `npm run test:live-quotes && npm run test:live-bookings` PASS, 합성 픽스처의 Enquiries·Quotes·Schedule에서 배지 색·글자 확인

### Task 5: Overview 재구성(실제 데이터 없이 가능한 범위)

**Files:**
- Modify: `src/modules/admin-dashboard/presentation/admin-pages.tsx` (`AdminOverview`)
- Modify: `src/modules/admin-dashboard/presentation/admin-shell.css` (Overview 규칙)

구성(위→아래):

```text
[ 오늘 날짜(Australia/Sydney) · "Good to see you" 없이 페이지 제목만 ]
┌──────────── 검정 강조 카드(금색 버튼 1개) ─────────────┐ ┌─ 바로가기 4개(2×2, 업무별 연한 색조) ─┐
│ Today's focus                                           │ │ Clients  (gold-tint)   Enquiries (info-bg) │
│ Review new booking requests and confirm work periods.   │ │ Quotes   (success-bg)  Schedule (neutral-bg)│
│ [Review bookings →]                                     │ └────────────────────────────────────────┘
└─────────────────────────────────────────────────────────┘
[ Coming soon: Jobs · Orders · Inventory · Reports — 한 줄 목록, 각 항목 준비 화면 링크 ]
[ Settings 바로가기: Connections & sessions ]
```

- 날짜는 `new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "long", day: "numeric", month: "long" })`로 표시하되 하이드레이션 차이를 피하기 위해 `useEffect` 후 렌더링하고, 그 전에는 빈 `<time>`을 둔다.
- 바로가기 카드: 아이콘 칩(40px, 색조 바탕 + 같은 계열 글자색), 제목 16px/700, 설명 14px/400 muted, 하단 “Open” 13px/650 + 화살표. 카드 전체가 링크(현재 구조 유지).
- “Daily insights — Preparing” 카드는 제거하고 Task 6의 실제 건수 카드 3개(Quotes awaiting review · Bookings needing action · Confirmed bookings)를 강조 카드 아래 한 줄(≥901px 3열, ≤900px 3열 유지하되 숫자 30px, ≤600px 1열)로 둔다.
- 폭: ≥1181 강조 카드 5fr / 바로가기 7fr, 901–1180 세로 쌓기, ≤600 바로가기 1열.

- [ ] **Step 1:** 마크업 변경(기존 `WorkspaceLink`·문구 재사용, 새 문구는 위 두 줄만)
- [ ] **Step 2:** CSS 추가 — `.admin-focus-card{background:var(--ems-black);color:var(--ems-surface);border-radius:var(--ems-radius-card);padding:28px}`, 버튼 `.admin-focus-card .admin-primary-link{background:var(--ems-gold);color:var(--ems-black)}`(7.18:1), 바로가기 색조는 `data-accent="gold|info|success|neutral"`로 지정
- [ ] **Step 3:** 확인 — 1440·1280·1024·768·390·320px 스크린샷, 링크 4개·준비 화면 링크 키보드 이동

### Task 6 (D3 승인됨): Overview 실제 건수 카드

**원칙:** 새 DB·RPC·API를 만들지 않는다. 이미 관리자 화면이 쓰는 두 읽기 API만 사용한다. 서버 집계가 없으므로 "지금 보이는 목록에서 센 수"임을 카드 문구에 밝힌다.

| 카드 | 정의 | 데이터 | 링크 |
| --- | --- | --- | --- |
| Quotes awaiting review | `LiveQuoteRequest.status === 'review_requested'`인 요청 수 | `GET /api/admin/quote-requests?page=N&pageSize=50`를 1페이지부터 최대 10페이지(500건)까지 순회해 센다. `total > 스캔한 건수`면 `quotesAwaitingReviewIsPartial = true` → 카드에 `N+` 표시 | `/admin/quotes` |
| Bookings needing action | **(개정 3, lead 승인)** `booking === null`이면서 고객 응답 대기가 아닌 상태 = `usesSignedRequestBooking(state) \|\| currentAcceptance(state) \|\| proposal === null \|\| proposal.status === 'draft'`, 또는 `booking.status ∈ {'confirming','review_required'}`. 게시된 제안에 현재 수락이 없는 상태(“Awaiting customer”)만 제외한다 | `GET /api/admin/live-bookings` → `states[]` 전체(페이지 없음) | `/admin/schedule` |
| Confirmed bookings | `booking.status === 'confirmed'` | 같은 응답 | `/admin/schedule` |

판정 함수 `currentAcceptance`·`usesSignedRequestBooking`은 `src/modules/bookings/presentation/live-booking-client.ts`의 기존 함수다. application 계층의 `countBookings(states, needsAction)`은 판정 함수를 인자로 받고, presentation의 `load-overview-counts.ts`가 위 조합을 넘긴다(application → presentation 의존 없음). 최초 계획의 `booking === null && acceptance !== null` 정의는 현재 서명 요청 흐름(docs/plans/45)의 새 예약을 0건으로 세어 폐기했다.

같은 기준의 목록 배지(`companyBookingTone`): 확정 `Confirmed and Google verified`(success) · 처리 중 `Confirmation processing`(info) · 검토 필요 `Company review required`(danger) · 서명 요청/제안 없음 `Awaiting company review`(warning) · 현재 제안 수락 `Awaiting company confirmation`(warning) · 회사 초안 `Company draft`(warning) · 게시 후 고객 대기 `Awaiting customer`(info).

**Files (Codex C1):**
- 계약(수정 금지): `src/modules/admin-dashboard/application/overview-counts-contract.ts` — `OverviewCounts`, `OverviewCountsState`, `OverviewCountsHook`
- Create: `src/modules/admin-dashboard/application/overview-counts.ts` — 순수 함수 `countQuotesAwaitingReview(pages: LiveQuoteRequestPage[]): { count; partial }`(partial = 마지막 페이지 total > 누적 스캔 수), `countBookings(states: LiveCompanyBookingState[], needsAction: (state) => boolean): { needingAction; confirmed }`, `buildOverviewCounts(quotes, bookings): OverviewCounts`. React·fetch 의존 없음.
- Create: `src/modules/admin-dashboard/presentation/load-overview-counts.ts` — 훅에서 분리한 순수 async 로더(테스트 대상). 견적 페이지 순회·예약 목록 조회·응답 검증·401/403 판정.
- Create: `src/modules/admin-dashboard/application/overview-counts.test.mts` — 빈 목록, 혼합 상태, 부분 스캔 케이스
- Create: `src/modules/admin-dashboard/presentation/use-overview-counts.ts` — `useOverviewCounts({ onAccessLost }): OverviewCountsHook`. `liveRequest`(`@/modules/quotes/presentation/request-client`)와 `companyBookingRequest`(`@/modules/bookings/presentation/live-booking-client`)를 재사용한다. 401/403이면 `onAccessLost()`를 부르고 `error` 상태로 둔다. 언마운트·재요청 시 이전 요청을 `AbortController`로 취소한다. 두 호출 중 하나가 실패하면 전체를 `error`로 두고 메시지를 그대로 전달한다(부분 숫자를 보여주지 않음).
- Create: `src/modules/admin-dashboard/presentation/use-overview-counts.test.mts` — `fetch`를 가짜로 바꿔 ready / 401→onAccessLost / 네트워크 오류 케이스
- Modify: `package.json` — `test:admin-shell`·`test:operations`에 위 두 테스트와 `src/modules/admin-dashboard/presentation/admin-palette.test.mts`(UI 패킷이 만드는 파일) 추가

**Files (UI U1·U2):** Overview 카드 UI는 Task 5의 레이아웃에 `OverviewCountsState`를 props로 받는 `OverviewCountCards` 컴포넌트로 만든다(U1). 훅 연결은 C1 완료 후(U2).

**카드 표시 규칙:**
- `loading`: 숫자 자리에 `—`와 `aria-busy="true"`, "Counting…" 13px muted
- `ready`: 숫자 36px/600 tabular-nums, 부분이면 `N+`와 "Showing the first 500 requests" 보조 문구, 하단에 "Counted at HH:mm" + Refresh 보조 버튼
- `error`: 카드 안에 `.ems-badge[data-tone=danger]` "Could not count" + 메시지 + Retry 버튼. 숫자는 표시하지 않는다.
- 카드 전체는 링크가 아니고 제목 옆 "Open →" 링크만 이동한다(숫자 오독 방지).

### Task 7: 직원 로그인·MFA 화면에 같은 테마 적용

**Files:** Modify `src/modules/admin-access/presentation/staff-admin-boundary.tsx` — 최상위 `operations-page` 요소에 `ems-theme` 클래스 추가

- [ ] 합성 픽스처의 `signed_out`·`mfa_verify` 단계에서 입력창·버튼·오류 표시가 Task 2 규칙을 따르는지 확인(픽스처 제어 API로 `authStage` 변경)

### Task 8: 검증·문서

- [ ] `npm run test:admin-shell` · `npm run test:live-quotes` · `npm run test:live-bookings` · `npm run test:customers` PASS
- [ ] `npm run lint` · `npm run typecheck` · `npm run build` PASS
- [ ] 합성 픽스처 실행: 이 워크트리에서 `npm run dev -- --port 3015`, 다른 터미널에서 `EMS_FIXTURE_PORT=3013 EMS_FIXTURE_UPSTREAM=http://127.0.0.1:3015 node scripts/verify-esn-ui-fixture.mjs`, 브라우저 `http://127.0.0.1:3013/admin`
- [ ] 화면 확인: 모든 `/admin/**` 10개 경로 × 1440·1024·768·390·320px. 넘침·겹침·가로 스크롤 없음, 로고 로딩, Manrope 실제 로딩(DevTools 계산 스타일), 콘솔 오류 없음
- [ ] 동작 확인: 사이드바·서랍·계정 메뉴·저장 안 한 변경 이탈 대화상자, Tab 순서와 focus 표시, 입력 오류 상태, 긴 고객 이름·긴 이메일, 빈 목록, 로딩 문구
- [ ] 공개 페이지 회귀: `/`, `/services/kitchen-cabinet-painting`, `/quote/start` 스크린샷이 작업 전과 같은지 비교(관리자 토큰 누수 없음)
- [ ] `docs/verification/2026-10-2x-ems-dashboard-ui-ux.md`에 실행 결과·스크린샷 경로·남은 제한 기록, `docs/esn-admin/README.md`에 최신 개정 한 단락, `08-…plan.md`의 “Slate/Greige 유지” 문장 옆에 이 문서로 대체됐다는 표시 추가

---

## 8. 사용자 결정 필요

| ID | 질문 | 추천 |
| --- | --- | --- |
| D1 | “검적색”이 로고의 **검정색**이 맞는지, 또는 검붉은(버건디) 색을 원하는지 | 검정. 로고 파일이 검정+금색이다. 버건디라면 3.1의 `--ems-black*`만 바꾸면 된다 |
| D2 | 사이드바를 참고 이미지처럼 **어두운 검정**으로 할지, 밝게 두고 금색만 강조할지 | 검정. 본문과의 구분이 가장 확실하고 로고가 그대로 어울린다 |
| D3 | Overview에 실제 숫자 카드(검토 대기·확정 대기 건수)를 이번에 넣을지 | 이번에는 레이아웃·색만. 숫자는 정의·집계 범위를 정한 뒤 별도 작업(D2 KPI 계획과 연결) |

## 9. 범위 밖

- 공개 사이트 디자인, 고객 견적 화면(`.lq-journey` 녹색 계열) 색 변경
- 새 KPI·그래프·서버 집계, 검색·필터 기능 추가, 다크 모드
- Jobs·Orders·Inventory·Reports 실제 기능
