# Quote 페이지 UI·UX 분석, 캐비넷 색상 제안과 구현 계획

2026-10-25 · Australia/Sydney · 브랜치 `quote-page-ux-analysis` (worktree 디렉터리 `sablefish`, 기준 커밋 `5c42702`)

사용자 요청: Quote 페이지의 UI·UX를 분석해 문제점을 찾고, EMS 대시보드 색상(검정 `#161412`·금색 `#C9A227`)이 아닌 **캐비넷·회사 이미지에 맞는 색상**을 추천하며, 개선 방안과 구현 계획을 구체적으로 작성한다.

**2026-10-25 사용자 결정에 따라 구현을 시작했다.** 이 문서는 분석·계획과 검증 기준을 기록하며, 구현은 진행 중이고 아직 검증 완료로 보지 않는다. Quote 전용 팔레트 결정은 [21번 디자인 시스템](21-global-design-system.md)에 기록했다.

## 0. 분석 범위와 근거

| 대상 | 확인 방법 | 비고 |
| --- | --- | --- |
| `/quote/start` 라이브 경로(`LiveQuoteForm`) | 코드 전체 확인: `src/app/quote/start/page.tsx`, `src/modules/quotes/presentation/*.tsx`, `live-quote.css`, `live-photo-workspace.module.css` | 데모 경로(`QuoteDraftForm`)는 운영 기본 경로가 아니므로 제외 |
| 진입 화면 | **2026-10-25 운영 사이트를 격리된 headless Chrome으로 직접 캡처** — 1280×800, 390×844, 320×568 | 저장·세션 생성 동작 없음(비-GET 요청 0건). 계산된 글꼴 크기·굵기 측정 |
| 1~6단계·접수 완료 | 저장소에 커밋된 검증 스크린샷: `docs/verification/2026-10-14-no-gst-deployment/local-ui/*`, `2026-10-13-quote-ui-release/*`, `2026-10-13-quote-entry/*` | Quote UI 코드의 마지막 변경(`ee064e3`, 10-14)과 같은 시점의 화면이다. **오늘 다시 실행한 화면은 아니다.** 일부(10-13)는 가격 표시가 이전 값(A$1,650)이며 레이아웃은 동일 |
| 브랜드·캐비넷 색 | `public/images/lk-group-logo.png`, `story/kitchen-finished.webp`, `home/cabinet-painting.webp`, `kitchen-cabinet-concept.png` 픽셀 샘플링 | 사진이 따뜻한 저녁빛으로 촬영돼 실측값이 황색 쪽으로 치우친다. 아래 팔레트는 실측값을 기준으로 **페인트 본래 색**을 추정해 보정한 값이다 |

실제 iOS·Android 기기 확인, 스크린리더 실사용 테스트는 이번에 수행하지 않았다. 해당 항목은 코드·CSS 근거로 판단했다고 표시한다.

## 1. 현재 구조 요약

```
[route header: 로고 · Back to service]
┌ card ───────────────────────────────────────────────┐
│ [workspace header: kicker · H1 "Let's refresh…" · Start a new quote · View quotes & bookings] │
│ ┌ sidebar ───────┐ ┌ main ───────────────────────────┐ │
│ │ 6단계 진행표     │ │ [stage top: 아이콘 · Step n of 6 · H2 · 저장 상태] │
│ │ 가격 요약 카드   │ │ [내부 스크롤 영역: 알림 + 단계 내용]               │
│ │ 개인정보 안내    │ │ [고정 하단 액션: Back · 주요 버튼]                 │
│ └────────────────┘ └─────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
[route footer: Private quote request · …]
```

진입 선택(새 견적 / 저장된 견적 보기) → 1 고객 정보 → 2 캐비넷 → 3 사진 → 4 예상 금액 → 5 방문일(+이메일 인증) → 6 서명 → 접수 완료. 전체가 `100dvh` 고정 화면이고 단계 내용만 내부 스크롤한다.

## 2. 문제점 — 우선순위별

우선순위: **P0** 입력·이해를 직접 방해, **P1** 전환·신뢰에 큰 영향, **P2** 완성도·일관성.

### P0

| # | 문제 | 근거 | 영향 |
| --- | --- | --- | --- |
| P0-1 | **입력란 글자 13.8px** — iOS Safari는 16px 미만 입력란에 포커스하면 화면을 자동 확대한다 | `.lq-journey .lq-fields input{font-size:.86rem}`, 모바일 규칙에서 재정의 없음 (실기기 미확인, CSS 근거) | 모바일에서 입력할 때마다 확대·가로 이동이 생겨 고정 화면 구조가 깨진다 |
| P0-2 | **읽기 어려운 작은 글자 남발** — 1rem 미만 크기 27종. 모바일 진행표 라벨 0.48rem(≈7.7px), 하단 안내 0.57rem(≈9.1px), 가격 요약 0.61~0.63rem(≈10px), 저장 상태·kicker 0.66~0.67rem(≈10.6px) | `live-quote.css`; 운영 측정값: kicker 10.72px, footer 10.56px, 보조 문구 11.52px | 디자인 시스템 기준(caption 14px, eyebrow 12~13px, body 16~18px) 위반. 중장년 주택 소유자가 주 고객인 업종에서 특히 불리하다 |
| P0-3 | **실제 작업 영역이 너무 좁다** — 화면 헤더 + 카드 헤더 + 단계 헤더 + 하단 액션 + 화면 푸터가 겹겹이 고정 | 1280×800에서 내용 영역은 y≈245~690(약 445px). 390×844 모바일에서는 헤더·진행표가 약 250px 차지. 모바일 키보드가 열리면 더 줄어든다 | 폼·사진·달력을 작은 창으로 스크롤해야 하고, 다음 입력란이 보이지 않는다 |
| P0-4 | **사진 단계의 주요 버튼 문구가 실제 동작과 다르다** — 분석 전 하단 주요 버튼이 `Request team review`지만 실제로는 4단계로 이동만 한다(`go(3)`). 진짜 검토 요청 버튼은 4단계에 따로 있고, 사진 단계의 진짜 주요 동작 `Get your photo estimate`는 스크롤 안쪽에 있다 | `live-quote-form.tsx` 하단 액션, `live-photo-workspace.tsx` | 주요 버튼이 두 개처럼 경쟁하고, 고객이 "검토 요청을 보냈다"고 오해할 수 있다 |

### P1

| # | 문제 | 근거 | 영향 |
| --- | --- | --- | --- |
| P1-1 | **진입 화면의 우선순위가 없다** — "새 견적"과 "저장된 견적 보기"가 같은 무게의 카드. 소요 단계·시간·준비물(사진 약 5장)·시작 가격 안내가 없다. 데스크톱은 큰 빈 카드에 콘텐츠가 왼쪽 75%만 차지 | 운영 캡처 `entry-1280`, `entry-390` | 신규 고객 대부분의 경로가 강조되지 않고, 시작 전 기대치를 줄 수 없다 |
| P1-2 | **견적 중에도 `Start a new quote`가 상시 노출** — 탐색 버튼과 같은 무게로 헤더에 있어 작성 중 잘못 누를 위험. 모바일에서는 두 버튼이 세로로 쌓여 H1을 2~3줄로 밀어낸다 | `lq-workspace-header`, `mobile-new-empty.png` | 실수 클릭 시 확인 단계가 있지만 불안감을 주고 세로 공간 약 110px를 낭비 |
| P1-3 | **진행 상태 구분이 약하다** — 완료(연녹색 체크)·현재(진한 원)·이동 불가(동일 모양, `opacity:1`)가 비슷해 보임. 320px 예상 금액 화면에서 "Add photos"가 진한 원으로 보여 현재 단계처럼 보인다 | `new-3-2-320-estimate.png`, `.lq-journey .lq-progress button:disabled{cursor:default}` | 어느 단계에 있는지, 어디로 돌아갈 수 있는지 판단하기 어렵다 |
| P1-4 | **모바일에서 가격이 사라진다** — 700px 이하에서 가격 요약 카드 숨김 | `.lq-project-summary{display:none!important}` | 모바일 고객은 4단계까지 "From A$1,450" 정보를 못 본다 |
| P1-5 | **이전 알림이 남는다** — 접수 완료 화면에 `Email verified. Choose your preferred visit.`가 그대로 표시 | `new-3-2-1280-receipt.png`; `bookingStageChanged`가 `notice`를 지우지 않음 | 완료 화면에서 "날짜를 고르라"는 모순된 안내 |
| P1-6 | **입력할 때마다 상태 알림** — 글자 하나마다 `Your changes are not saved yet.`가 `aria-live` 영역에 다시 설정 | `update()` → `setNotice(...)` | 시각적 소음, 스크린리더 반복 낭독 가능성(실사용 미확인) |
| P1-7 | **기술 용어·업계 용어** — `take-off`(문짝 탈거 방문), `saved revision changed`, `unconfirmed requests`, `Retry same save`, `writing session` | 단계 설명·오류 문구 | 고객이 무엇을 해야 하는지 이해하기 어렵다 |
| P1-8 | **색이 브랜드·제품과 연결되지 않는다** — 거의 단색 슬레이트/그레이지에 토큰 밖 하드코딩 색 28종(대부분 임의의 연녹색 계열). 예상 금액은 무거운 차콜 블록 | `live-quote.css` hex 28종 | 따뜻한 원목·황동·도장 캐비넷의 제품 이미지와 단절, 유지보수 어려움 |
| P1-9 | **390px에서 이름·이메일 2열** — 이메일 입력란 폭 약 150px | `@media(max-width:700px){.lq-journey .lq-grid{grid-template-columns:repeat(2,…)}}`, 1열 전환은 360px 이하만 | 긴 이메일이 잘리고 오타 확인이 어렵다 |

### P2

| # | 문제 | 근거 |
| --- | --- | --- |
| P2-1 | 1280×800에서 사이드바 가격 카드가 하단에서 잘린다(사이드바 내부 스크롤만 가능) | `desktop-new-empty.png`, `new-3-2-1280-estimate.png` |
| P2-2 | 단계 이동 시 H2에 프로그램 포커스를 주면 굵은 포커스 사각형이 그려진다 | `new-3-2-1280-receipt.png`, `.lq-card :focus-visible` |
| P2-3 | 오류 상자와 상태 알림이 동시에 쌓이며 서로 다른 어조 | `quote-entry-photo-finalize-200.png` |
| P2-4 | 서명 방법 라디오 카드 사이 간격 없음(테두리가 붙음) | `new-3-2-1280-signature.png` |
| P2-5 | 달력 날짜의 보조 정보 0.48rem, 모바일에서는 숨김. 예약 불가 날짜는 취소선만으로 구분 | `.lq-journey .lq-calendar button span` |
| P2-6 | 진입 카드 제목 높이가 설명 길이에 따라 어긋난다(464px vs 474px) | 운영 캡처 `entry-1280` |
| P2-7 | H1 계산 굵기 400, 진입 카드 제목 900 요청(Manrope 최대 800) — 디자인 시스템(page-title 700, 합성 굵기 금지)과 불일치 | 운영 측정값 |
| P2-8 | 다음에 무엇이 일어나는지(회사 확인 → 탈거 방문 → 공방 도장 → 재설치) 흐름 안내가 없다 | 전체 단계 |
| P2-9 | 이메일 인증이 5단계 안에 숨어 있어 진행표에 보이지 않는다 | `CustomerAccessPanel mode="booking"` |

## 3. 색상 추천 — 캐비넷·회사 이미지 기반

### 3.1 이미지에서 읽은 색

| 출처 | 실측(사진 빛 포함) | 해석 |
| --- | --- | --- |
| 로고 | 검정 `#000000`, 금색 `#A48837`~`#E7C14E` | 고급·신뢰. 단 EMS 대시보드가 이미 검정+금색을 쓰므로 고객 화면은 금색을 **황동(brass)으로 낮춰** 구분 |
| 완성 주방(블루그레이 캐비넷) | 캐비넷 `#7E8284`~`#878A8B`, 황동 수전 `#C2A37B` | 차분한 슬레이트 블루 + 황동 손잡이 조합이 대표 이미지 |
| 세이지 캐비넷 | `#6D694F`~`#6E6A53` (따뜻한 빛) | 세이지 그린 — 완료·성공 상태에 자연스럽다 |
| 화이트 셰이커 캐비넷·벽 | 아이보리~그레이지, 대리석 `#D9D3CF` | 바탕·표면 |
| 원목 바닥·식탁·라탄 | `#BE9977`, `#C59F7B`, `#AB7C58` | 따뜻한 보조색(장식·사진 테두리 전용) |

### 3.2 추천 팔레트 — "Painted Cabinet" (권장)

슬레이트 블루를 주 색으로, 황동을 작은 포인트로, 세이지를 완료 상태로 쓴다. 기존 Slate/Greige의 차분함은 유지하면서 실제 시공 이미지와 같은 색 언어를 만든다.

| 역할 | 이름 | 값 | 사용처 |
| --- | --- | --- | --- |
| 바탕 | Greige Wall | `#F2EEE7` | 페이지 배경 |
| 표면 | Shaker White | `#FBF9F4` | 카드·입력 영역 |
| 보조 표면 | Marble | `#E8E3DA` | 사이드바·접힌 상세·비활성 |
| 구분선 | Oak Mist | `#D9D2C6` | 비상호작용 구분선 |
| 컨트롤 경계 | Slate Line | `#6E7A80` | 입력란·라디오·체크 테두리 |
| 본문 글자 | Charcoal Ink | `#23303A` | 제목·본문 |
| 보조 글자 | Pewter | `#4F5B62` | 설명·라벨 보조 |
| **주요 동작** | **Cabinet Slate Blue** | **`#3D5566`** / hover `#2F4554` | 주요 버튼·현재 단계·선택 테두리·focus |
| 주요 동작 연한 면 | Slate Mist | `#E3E9EC` | 선택된 카드 배경·현재 단계 배경 |
| **포인트** | **Brass** | **`#B08D57`** | 장식 전용: 가격 강조선, 선택 체크 배지, 아이콘 포인트(글자 금지) |
| 포인트 글자 | Brass Deep | `#7A5A2B` / 면 `#F3EBDD` | "Estimate ready" 배지·가격 라벨 등 작은 강조 글자 |
| 어두운 면 위 포인트 | Brass Light | `#D9BC86` | 예상 금액 패널(어두운 면) 위 작은 강조 |
| 완료·성공 | Sage | `#55705A` / 면 `#E6EDE3` / 글자 `#4A6350` | 완료 단계 체크, 저장 완료, 접수 완료 |
| 오류 | Clay Red | `#9B2C24` / 면 `#F8E9E6` | 오류 상자·필드 오류 |
| 장식 | Natural Oak | `#C49A6C` | 사진 테두리·일러스트(글자·UI 경계 금지) |

**명도 대비(WCAG 2.1, 계산값)**

| 조합 | 대비 | 판정 |
| --- | --- | --- |
| Charcoal Ink / Shaker White | 12.83:1 | 본문 AA·AAA |
| Pewter / Greige Wall | 6.04:1 | 본문 AA |
| Shaker White / Cabinet Slate Blue (버튼 글자) | 7.42:1 | AA·AAA |
| Cabinet Slate Blue / Slate Mist | 6.37:1 | 본문 AA |
| Sage / Shaker White | 5.18:1 | 본문 AA |
| Sage / Sage 면 | 4.57:1 | 본문 AA(경계값 — 굵은 글자 권장) |
| Brass Deep / Shaker White | 6.00:1 | 본문 AA |
| Brass Light / `#2F4554` | 5.47:1 | 본문 AA |
| Slate Line / Shaker White (컨트롤 경계) | 4.19:1 | 비텍스트 3:1 충족 |
| Clay Red / Shaker White | 7.18:1 | AA |
| Brass / Shaker White | 2.94:1 | **글자 사용 금지**, 장식·3px 이상 강조선만 |
| Natural Oak / Shaker White | 2.44:1 | **글자·경계 사용 금지** |

사용 규칙: 한 화면에서 Brass는 1~2곳(가격·현재 선택)만 쓴다. 주요 버튼은 화면당 하나. 상태 색(Sage·Clay Red)은 아이콘·문구와 함께 써서 색만으로 의미를 전달하지 않는다.

### 3.3 대안 — "Sage & Oak"

세이지 캐비넷을 대표 이미지로 삼을 경우: 주요 동작 `#4A6350`(Shaker White 글자 6.25:1), 포인트 Natural Oak(장식), 완료 상태는 Cabinet Slate Blue로 바꾼다. 더 친근하고 자연스럽지만, 이미 진입·사이드바에 쓰던 임의 연녹색과 섞여 차별화가 약하고 로고(검정·금색)와의 연결이 약하다. **권장안은 3.2**다.

### 3.4 적용 위치

- 원본 값은 `src/shared/styles/tokens.css`에 `--palette-*`로 한 번만 정의한다.
- Quote 화면은 `.quote-route-shell` 범위의 의미 alias(`--quote-action`, `--quote-accent`, `--quote-success` …)만 사용한다. 홈·KCP·EMS 색은 바꾸지 않는다([21번](21-global-design-system.md)의 "서비스별 차이는 semantic alias" 원칙).
- 21번 문서의 "금색 UI 테마와 서비스별 새 강조색은 이번 범위에 추가하지 않는다"는 원칙의 Quote 전용 예외 결정은 [21번 §2](21-global-design-system.md)에 2026-10-25 기록했다.

## 4. 개선 방안 — 화면별

### 4.1 공통 레이아웃

- **크롬 3겹 → 1겹**: route header와 workspace header를 하나로 합친다. 왼쪽 로고, 가운데(데스크톱) 현재 단계, 오른쪽 `My quotes` 메뉴(저장된 견적 보기·새 견적 시작을 메뉴 안으로). H1 "Let's refresh your kitchen."은 진입 화면에서만 쓰고, 작업 화면의 H1은 시각적으로 숨기거나 단계 헤더와 합친다(문서 구조상 H1 1개 유지).
- route footer의 문구는 사이드바·하단 액션 옆 개인정보 안내로 옮기고 화면 푸터는 제거한다.
- 결과: 1280×800 내용 영역 약 445px → 약 600px 목표, 390×844 모바일 상단 고정 영역 약 250px → 약 120px 목표.
- 모바일(≤700px)은 **고정 viewport 대신 문서 스크롤 + 하단 고정 액션 바**로 바꾼다. 키보드가 열려도 입력란이 가려지지 않게 `scroll-margin-bottom`을 하단 바 높이만큼 준다. 데스크톱은 현재의 내부 스크롤 구조를 유지한다. (기존 "단계 이동 시 상단 초기화·포커스" 계약은 유지)

### 4.2 글자 체계

- Quote 전용 크기를 기존 전역 토큰으로 정리한다: 입력란·본문 16px(`--type-body-size` 하한), 라벨 15px/600, 보조 설명 14px(`--type-caption-size`), kicker 12px(`--type-eyebrow-size`), 단계 H2 `--type-card-title-size`.
- **12px 미만 금지.** 모바일 진행표의 아주 작은 라벨은 없애고 4.3의 압축형 진행 표시로 대체한다.
- H1/H2 굵기는 700, 대형 금액 800. 900 요청 제거.

### 4.3 진행 표시

- 데스크톱 사이드바: 현재 = Slate Blue 원 + Slate Mist 배경, 완료 = Sage 체크 + "Edit" 가능 표시, 잠김 = 점선 원 + 흐린 글자 + `aria-disabled` 안내("Complete the previous step first").
- 모바일: 6개 아이콘 열 대신 한 줄 `Step 3 of 6 · Add photos` + 6칸 진행 막대 + 탭 시 단계 목록 시트. 높이 약 56px.
- 5단계 안의 이메일 인증을 진행표 하위 항목("Verify email")으로 표시해 숨은 단계를 없앤다.

### 4.4 진입 화면

- "Start a new quote"를 주 카드(크게, Slate Blue 배경, 오른쪽에 실제 캐비넷 사진 — 기존 `home/cabinet-painting.webp` 재사용, 컨셉 이미지 고지 유지)로, "View quotes & bookings"는 보조 링크 카드로 낮춘다.
- 주 카드 아래 기대치 3개: `About 5 minutes` · `Have ~5 cabinet photos ready` · `From A$1,450 · No GST charged`(가격은 `quotePricingDisplay` 값 사용, 하드코딩 금지).
- "What happens next" 4단계 미니 타임라인: 견적 요청 → 회사 확인 → 문짝 탈거 방문 → 공방 도장·재설치. 실제 운영 절차([45번](45-simple-take-off-install-booking.md))와 일치하는 내용만 쓴다.
- 미확정 전화·이메일은 표시하지 않는다(프로젝트 지침).

### 4.5 1단계 고객 정보 / 2단계 캐비넷

- 700px 이하 1열. 입력 16px.
- 입력할 때마다 알림을 쓰지 않고, 하단 액션 바 왼쪽의 저장 상태 표시(`Unsaved changes` 점 표시)로만 알린다. `aria-live` 낭독은 저장 성공·실패 때만.
- 2단계 의도 선택 카드에 의도별 다른 아이콘(전체 재도장·부분 보수·색상 변경·상담) — 현재 모두 붓 아이콘.
- 선택 카드: 선택 시 Slate Mist 배경 + Slate Blue 2px 테두리 + 오른쪽 위 Brass 체크 배지.

### 4.6 3단계 사진

- 하단 주요 버튼을 상태에 맞게: 사진 없음 → 비활성 `Add a photo to continue`, 사진 있음·분석 전 → **`Get my photo estimate`(실제 분석 실행을 하단 주요 버튼으로 이동)**, 분석 중 → 비활성 `Analysing photos…`, 분석 완료·최신 결과 → `Review estimate`. 분석 대신 팀 검토 단계로 이동하는 보조 버튼은 `Ask the team to review instead`; 실제 요청 전송 버튼은 다음 단계의 `Ask our team to review`다.
- 촬영 가이드는 역할별 작은 일러스트 카드(전체 정면·상부장·하부장·서랍·손상 부위)로, 업로드된 역할은 Sage 체크.
- 오류 상자와 알림은 한 영역에 하나만 — 오류가 있으면 알림을 숨긴다.

### 4.7 4단계 예상 금액

- 금액 패널: 차콜 단색 대신 Slate Blue 계열 `#2F4554` 면 + 상단 3px Brass 강조선 + Brass Light 라벨. 금액 숫자는 Shaker White.
- "Final price confirmed on site" 안내는 금액 바로 아래 한 줄, 추가 손상 비용 안내는 아이콘이 있는 별도 줄로 분리해 읽기 쉽게.
- 상세 내역 `<details>`는 기본 삼각형 대신 일관된 chevron 아이콘·44px 행.
- 모바일 하단 바 위에 가격 칩(`A$1,450 · No GST`)을 1~6단계 내내 표시해 P1-4 해결.

### 4.8 5단계 방문일 / 6단계 서명

- 단계와 진행표 라벨은 `Pick a visit`, 설명은 `Door-removal date & time`으로 한다. 고객 문구는 `Your preferred door-removal visit`, `Door-removal time (Sydney) *`, `Selected door-removal visit:`, `Requested door-removal visit`, 서명 화면의 `Door-removal date and time:`을 사용한다. 화면의 첫 언급은 `door-removal (take-off) visit`으로 병기할 수 있다.
- 달력: 선택 가능 날짜는 Shaker White + Slate Line, 선택은 Slate Blue, 불가 날짜는 Marble 면 + 사선 무늬 + `aria-disabled`·이름에 "unavailable". 보조 정보는 날짜 아래 점(●)과 범례로 대체해 작은 글자 제거.
- 서명: 라디오 카드 간격 8px, 선택 카드 Slate Mist. 서명 요약(날짜·금액)을 카드 형태로 서명 입력 위에 고정.

### 4.9 접수 완료

- 단계 변경 시 이전 알림 초기화(P1-5).
- 상단에 Sage 원형 체크 + "Request received" + 다음 일정 타임라인(회사 확인 대기 → 확정 메일). 기존 금액·방문일·접수번호 카드는 유지.
- 프로그램 포커스 대상 heading은 `:focus:not(:focus-visible){outline:none}`으로 마우스·자동 이동 시 사각형 제거, 키보드 포커스 표시는 유지.

### 4.10 문구

| 현재 | 제안 |
| --- | --- |
| The saved revision changed. Your current entries and unconfirmed requests are still here. Retry an unconfirmed request before replacing its details. | This quote was updated somewhere else. Your entries are still here — review the latest version before saving again. |
| Retry same save | Try saving again |
| A new writing session is ready… | We started a fresh session. Your entries on screen haven't been saved yet. |
| 사진 단계 이동 버튼 | `Ask the team to review instead` (단계 이동만; 요청 전송은 다음 단계 `Ask our team to review`) |
| Choose a visit · Your take-off date & time | Pick a visit · Door-removal date & time |
| take-off 고객 방문 표현 | door-removal 고객 표현; 첫 언급에 `door-removal (take-off)` 허용 |

409 충돌, 재시도, 새 세션 안내는 위 제안 문구를 적용하며 기존 입력 보존·재시도 동작은 유지한다.

문구 변경은 동작·보존 계약을 바꾸지 않는다. 오류 종류별 복구 버튼은 그대로 둔다.

## 5. 구현 계획

### 5.1 원칙과 보존 계약

- 저장·인증·사진·분석·예약·서명·idempotency·revision 로직과 API는 변경하지 않는다. 이번 작업은 **presentation(구조·CSS·문구)** 범위다.
- [46번](46-quote-one-page-ui.md)의 보존 경계(단계 이동 시 상태 소유자 unmount 금지, dirty 입력 보호, `hidden` 비활성 패널, 단계 이동 시 포커스·상단 초기화, 동작 줄이기)를 유지한다.
- 검증 스크립트가 버튼 문구(`Start a new quote`, `View quotes & bookings`, `Save & continue`, `Review estimate`, `Choose a visit`)와 `data-quote-*` 속성에 의존한다. 문구를 바꾸면 같은 커밋에서 `scripts/verify-quote-entry-ui.mjs`, `verify-quote-entry-photo-ui.mjs`, `verify-quote-journey-ui.mjs`를 갱신한다. `data-quote-next`·`data-quote-back`·`data-quote-step`·`data-quote-viewport`는 유지한다.
- 가격·시작 금액은 `quotePricingDisplay`에서만 읽는다.

### 5.2 단계별 작업

| 단계 | 내용 | 파일 | 완료 기준 |
| --- | --- | --- | --- |
| **Q0 승인** | 3.2 팔레트·4.1 레이아웃 방향 승인, 21번 결정 갱신 | `docs/plans/21-global-design-system.md`, 이 문서 | 사용자 승인 기록 |
| **Q1 토큰** | `--palette-*` 원본 값 추가, `.quote-route-shell` 범위 `--quote-*` alias 정의. `live-quote.css`·`live-photo-workspace.module.css`의 hex 28종을 alias로 교체 | `src/shared/styles/tokens.css`, `live-quote.css`, `live-photo-workspace.module.css` | 두 CSS 파일에 hex 리터럴 0개(`#fff` 서명 캔버스 제외), 홈·KCP·EMS 화면 변화 없음 |
| **Q2 글자** | 1rem 미만 크기 27종을 전역 type 토큰으로 정리, 입력 16px, 12px 미만 제거, 굵기 정리 | `live-quote.css`, `live-photo-workspace.module.css` | 계산 글꼴 최소 12px, 입력 16px, 굵기 ≤800 |
| **Q3 P0/P1 버그·문구** | 사진 단계 주요 버튼 상태별 문구·동작(분석 실행을 하단으로), 단계 변경 시 notice 초기화, 입력마다 notice 제거→저장 상태 표시, 오류/알림 단일 표시, 문구 표 적용 | `live-quote-form.tsx`, `live-photo-workspace.tsx`, `booking-flow-panel.tsx` + 3개 검증 스크립트 | 4.6·4.9·4.10 동작 확인, 기존 시나리오 통과 |
| **Q4 레이아웃** | 헤더 통합·`My quotes` 메뉴(포커스 이동·Esc 닫기·복귀), route footer 제거, 모바일 문서 스크롤 + 하단 고정 바 + 가격 칩, 700px 이하 1열, 사이드바 가격 카드 잘림 해결 | `src/app/quote/start/page.tsx`, `live-quote-form.tsx`, `live-quote.css` | 1280×800 내용 영역 ≥580px, 390×844 상단 고정 ≤130px, 가로 넘침 0 |
| **Q5 진행 표시** | 사이드바 상태 3종 시각화, 모바일 압축형 진행 + 단계 시트, 이메일 인증 하위 항목 | `live-quote-form.tsx`, `live-quote.css` | 현재/완료/잠김이 색 외 모양으로도 구분, 키보드 조작 |
| **Q6 진입·완료 화면** | 주/보조 카드, 기대치 3개, "What happens next", 사진 재사용·컨셉 고지, 완료 화면 타임라인 | `live-quote-form.tsx`, `booking-flow-panel.tsx`, `live-quote.css` | 4.4·4.9 반영, 허위 정보 없음 |
| **Q7 단계 세부** | 의도별 아이콘, 선택 카드 스타일, 금액 패널, 달력 상태·범례, 서명 카드 간격, details chevron | 위 파일들 | 4.5~4.8 반영 |
| **Q8 검증·기록** | 아래 5.3 수행, 검증 문서·스크린샷 기록, 15번 TODO 갱신 | `docs/verification/2026-10-25-quote-ui-refresh.md` | 실행 결과와 미수행 항목 구분 기록 |

권장 순서: Q0 → Q1·Q2(같은 PR, 시각 회귀 확인 쉬움) → Q3 → Q4 → Q5 → Q6·Q7 → Q8. Q3은 색과 무관하므로 Q0 승인 전에도 진행 가능하다.

규모 판단: Q1·Q2·Q7은 CSS 중심 저위험 변경. Q3·Q4·Q5는 단계 이동·포커스·잠금 조건을 건드리므로 구현 후 `code-review`를 거친다.

### 5.3 검증

- 정적 검사: `npm run lint`, `npm run typecheck`, 관련 단위 테스트 `npm run test:live-quotes`.
- 빌드·브라우저: [격리 복사본 규칙](../verification/2026-10-13-quote-one-page-ui.md)대로 별도 production build + 로컬 fixture(`scripts/verify-live-quote-fixture.mjs`)에서 `verify-quote-entry-ui.mjs`, `verify-quote-entry-photo-ui.mjs`, `verify-quote-journey-ui.mjs` 실행. 운영 DB·AI·메일·Calendar 호출 없음.
- 화면 크기: 320×568, 390×844, 768×1024, 1024×768, 1280×800, 1440×900. 각 단계 + 오류(409·401·503)·빈 상태·긴 이름/주소·분석 실패 상태 스크린샷.
- 접근성: 키보드만으로 전체 흐름, focus-visible, 진행표 `aria-current`/`aria-disabled`, 메뉴 포커스 복귀, 200% 확대 시 잘림 없음, 동작 줄이기 설정.
- 측정: 계산 글꼴 최소값, 입력 font-size, 내용 영역 높이, 대비(3.2 표), 콘솔 오류 0.
- 실기기: iOS Safari 입력 확대·키보드 가림, Android Chrome — 가능하면 수행, 못하면 미수행으로 기록.

## 6. 사용자 확정 결정

**2026-10-25 · 사용자 확인**

1. 팔레트는 §3.2 **Painted Cabinet**을 선택한다.
2. 적용 범위는 **Quote 화면만**이다. 홈·KCP·EMS 색상은 변경하지 않는다.
3. 모바일(폭 700px 이하)은 고정 viewport 대신 **문서 스크롤 + 화면 하단 고정 액션 바**를 사용한다. 데스크톱은 기존 고정 viewport와 내부 스크롤을 유지한다.
4. 고객 Quote 화면과 고객 영수증(PDF/이메일)의 `take-off` 표현을 `door-removal`로 바꾼다. 첫 언급은 `door-removal (take-off)`를 허용한다. 회사/EMS 화면과 메일은 기존 `take-off`를 유지한다.

구현은 시작했으며 검증 결과는 [2026-10-25 Quote UI refresh 기록](../verification/2026-10-25-quote-ui-refresh.md)에 별도로 남긴다.

커밋·푸시·배포는 이번 문서 작성에 포함하지 않는다.
