# L&K Group EMS 디자인 키트

L&K Group 관리자 화면(EMS)의 검정·금색 팔레트, Outfit 글꼴, 입력창·버튼·배지·카드·사이드바 스타일을 **어느 프로젝트에서나** 쓸 수 있게 묶은 폴더다. 프레임워크 없이 CSS 파일만으로 동작한다. 이 폴더를 통째로 복사하면 된다.

- 원본 화면: 이 저장소의 `/admin/**` (`src/shared/styles/admin-tokens.css`)
- 설계 근거: [13번 계획](../../docs/esn-admin/13-2026-10-25-dashboard-ui-ux-plan.md)
- 미리보기: `preview.html`을 브라우저로 열면 색·글꼴·컴포넌트를 한 화면에서 볼 수 있다.

## 파일

| 파일 | 내용 |
| --- | --- |
| `ems-tokens.css` | 색·글꼴·크기·두께·모서리·그림자 변수(`--ems-*`). `.ems-theme` 범위에만 정의 |
| `ems-fonts.css` | Outfit 가변 글꼴(300–800) `@font-face`. `fonts/` 폴더를 옆에 둔다 |
| `ems-components.css` | 입력창, 버튼, 배지, 알림, 카드, 읽기 전용 값, 목록 행, 검정 사이드바 |
| `fonts/` | Outfit Latin·Latin Ext woff2, SIL OFL 1.1 라이선스 |
| `preview.html` | 견본 페이지 |
| `ems-tokens.test.mts` | 키트 값이 앱 테마와 같은지 확인하는 테스트(`npm run test:admin-shell`에 포함) |

## 사용법

```html
<link rel="stylesheet" href="lk-ems/ems-fonts.css">
<link rel="stylesheet" href="lk-ems/ems-tokens.css">
<link rel="stylesheet" href="lk-ems/ems-components.css">

<body class="ems-theme">
  <section class="ems-panel">
    <p class="ems-eyebrow">L&K Group · EMS</p>
    <h1 class="ems-page-title">Overview</h1>
    <label class="ems-field">Name <input placeholder="Client name"></label>
    <button class="ems-button">Save</button>
    <span class="ems-status ems-status--warning">Review requested</span>
  </section>
</body>
```

- 페이지 전체가 아니라 일부 영역에만 쓰려면 그 영역의 바깥 요소에 `class="ems-theme"`을 붙인다. 키트는 `:root`나 태그 전체를 바꾸지 않는다.
- Next.js에서는 `ems-fonts.css` 대신 `next/font/local`로 `fonts/`의 두 파일을 불러오고 `variable: "--font-outfit"`을 쓰면 된다(이 저장소의 `admin-fonts.ts`와 같은 방식).
- 파일 없이 쓰려면 Google Fonts 링크 `https://fonts.googleapis.com/css2?family=Outfit:wght@300..800&display=swap`를 쓴다.

## 색

| 토큰 | 값 | 용도 |
| --- | --- | --- |
| `--ems-black` / `--ems-black-raised` | `#161412` / `#26231F` | 사이드바, 기본 버튼, 강조 카드 / hover·활성 바탕 |
| `--ems-gold` / `--ems-gold-bright` | `#C9A227` / `#E0BC4F` | 활성 표시선, 강조 카드 버튼 / 어두운 바탕 위 focus |
| `--ems-gold-text` / `--ems-gold-tint` | `#7A5E0E` / `#F7EFD6` | 밝은 바탕 위 금색 글자·focus / 선택된 행 바탕 |
| `--ems-canvas` / `--ems-surface` | `#F3F1EC` / `#FFFFFF` | 페이지 바탕 / 카드 |
| `--ems-field` / `--ems-sunken` | `#F8F6F1` / `#EEEBE4` | 입력창 바탕 / 비활성·코드 상자 |
| `--ems-ink` / `--ems-ink-2` / `--ems-muted` | `#1C1A17` / `#45413A` / `#5F5A51` | 본문 / 라벨 / 보조 글자 |
| `--ems-line` / `--ems-line-strong` | `#E2DED5` / `#8A8478` | 장식 구분선 / 입력창·체크박스 테두리 |
| success · warning · danger · info · neutral | 글자/바탕 쌍 | 상태 배지·알림. 항상 글자와 함께 쓴다 |

**규칙:** 금색 `#C9A227`은 흰 바탕 위 글자로 쓰지 않는다(대비 2.42:1). 밝은 바탕의 금색 글자는 `--ems-gold-text`(6.11:1)를 쓴다. 기본 행동은 검정 버튼이고, 금색 채움 버튼(`.ems-button--gold`)은 검정 강조 카드 안에서만 쓴다.

대비는 모두 WCAG 2.1 AA 기준을 넘는다: 텍스트 4.5:1 이상, 입력 테두리·focus 3:1 이상. 앱에서는 `admin-palette.test.mts`가 이 기준을 검사한다.

## 글자

| 역할 | 클래스 | 크기 / 두께 |
| --- | --- | --- |
| 페이지 제목 | `.ems-page-title` | 28px(모바일 24px) / 650 |
| 섹션 제목 | `.ems-section-title` | 20px / 600 |
| 카드 제목 | `.ems-panel-title` | 16px / 600 |
| 본문 | `.ems-body` | 15px / 400 |
| 라벨·메뉴·버튼 | `.ems-label` | 14px / 500 (버튼 600) |
| 보조 | `.ems-meta` | 13px / 400 |
| 배지·eyebrow | `.ems-status`, `.ems-eyebrow` | 12px / 600 |
| 요약 숫자 | `.ems-kpi` | 36px(모바일 30px) / 600, 고정폭 숫자 |

Outfit은 700 이상에서 뭉쳐 보여 650을 넘기지 않는다. 가장 작은 글자는 12px이다. Outfit에는 한글이 없어 한글은 시스템 한글 글꼴(Apple SD Gothic Neo, Noto Sans KR, 맑은 고딕)로 표시된다.

## 컴포넌트

| 클래스 | 설명 |
| --- | --- |
| `.ems-panel`, `[data-accent=gold\|info\|success\|neutral]`, `.ems-panel--focus` | 흰 카드, 연한 색조 카드, 검정 강조 카드 |
| `.ems-field` + `input`/`select`/`textarea` | `.ems-theme` 안의 입력창은 자동으로 미색 바탕·진한 테두리, focus 시 흰 바탕·금색 링. `aria-invalid="true"`면 빨간 테두리 |
| `.ems-button`, `--secondary`, `--danger`, `--gold` | 높이 44px, 모서리 10px. 비활성은 회색 바탕·muted 글자 |
| `.ems-status`, `.ems-status--success\|warning\|danger\|info` | 상태 배지 |
| `.ems-feedback`, `.ems-feedback--danger\|warning\|success` | 알림·오류 상자 |
| `.ems-details` | 읽기 전용 값(라벨/값 2단, 모바일 1단) |
| `.ems-list` + `.ems-record-row` (`.ems-record-main`, `.ems-record-actions`) | 목록 행. `aria-current="true"`면 선택 표시. 모바일에서 세로로 쌓인다 |
| `.ems-sidebar`, `.ems-nav-label`, `.ems-nav` | 검정 사이드바와 금색 활성선 메뉴 |

## 값을 바꿀 때

`ems-tokens.css`와 `src/shared/styles/admin-tokens.css`를 함께 고친다. 둘이 다르면 `ems-tokens.test.mts`가 실패한다.
