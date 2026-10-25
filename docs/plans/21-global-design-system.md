# 글로벌 디자인 시스템 — Slate / Greige

2026-09-28 · 구현 명세 v2. 사용자 승인 시안은 [concept-1-slate-greige-v5.png](../design-concepts/concept-1-slate-greige-v5.png)다. 전역 색상·로컬 Manrope·크기·굵기·공용 UI를 실제 코드에 적용했다. 단일 토큰 원본은 `src/shared/styles/tokens.css`이며 폰트 변수는 `html`에 연결한다. KCP 상세만 변경하고 메인 프로토타입을 유지하는 최종 결정은 [추가 명세](22-cinematic-cabinet-story.md)를 따른다.

## 1. 설계 원칙과 범위

- 사진의 회청색 캐비넷과 슬레이트 글자, 밝은 그레이지 바탕을 연결한다. 따뜻한 포인트는 원본 목재·황동·회사 로고가 제공한다.
- 승인 PNG 전체를 배경으로 쓰지 않는다. 글자 없는 사진 + CSS 레이어 + 실제 HTML 텍스트·버튼으로 재현한다.
- 공통 규칙은 홈·KCP·후속 Painting/Handyman에 함께 적용한다. 서비스별로 기본 서체·버튼·글자 크기를 복사해 새 값을 만들지 않는다.
- 서체의 정확한 원본은 생성 이미지에서 확정할 수 없다. 구현용 서체는 **Manrope** 한 계열을 선택하고, 승인 시안과 화면 비교해 굵기·자간을 조정한다.
- 전역 변경은 root 토큰에서, 허용된 서비스별 표현 차이는 해당 섹션의 semantic alias에서 관리한다. 사진의 실제 색상을 CSS 필터로 강제 통일하지 않는다.

## 2. 색상 토큰

| 토큰 | 값 | 사용 |
| --- | --- | --- |
| `--color-background` | `#F1EFE9` | 페이지 기본 배경·그레이지 |
| `--color-surface` | `#FAF8F3` | 밝은 카드·본문·메뉴 표면 |
| `--color-foreground` | `#2E3A3F` | 제목·내비게이션·작은 중요 글자 |
| `--color-muted` | `#465156` | 밝은 바탕 위 본문·보조 설명 |
| `--color-border` | `#D1D5D3` | 비상호작용 구분선 |
| `--color-border-strong` | `#657177` | 필요한 컨트롤 경계·선택 상태 |
| `--color-action` | `#2E3A3F` | 주요 버튼 |
| `--color-action-hover` | `#202C31` | 활성 주요 버튼 hover |
| `--color-on-action` | `#FAF8F3` | 주요 버튼 안 글자 |
| `--color-focus` | `#2E3A3F` | 밝은 바탕의 focus ring |
| `--color-focus-outer` | `#FAF8F3` | 사진·어두운 바탕 focus ring 외곽 |
| `--color-disabled-surface` | `#E0E2DE` | 비활성 컨트롤 |
| `--color-disabled-text` | `#465156` | 비활성 글자·준비 안내 |
| `--hero-veil-rgb` | `241 239 233` | 사진 위 그레이지 레이어 |
| `--hero-veil-start / mid / end` | `0.90 / 0.70 / 0.04` | 데스크톱 레이어의 시작값 |

Hero gradient 초기 지점은 좌측 0%, 중간 42%, 우측 78%다. 모바일에서는 글자 영역의 불투명도를 0.94 / 0.86까지 높이거나 사진과 본문을 세로로 나눈다. 실제 사진·크롭·텍스트 길이를 기준으로 조정하며 시안을 흐리게 덮는 정도를 정량 확정한 것으로 보지 않는다. 텍스트에 `mix-blend-mode`를 사용하지 않는다.

기존 단색 계산에서 제목/그레이지 대비는 10.18:1, 본문/그레이지는 7.10:1, 아이보리/주요 버튼은 11.03:1이다. **사진 위 실제 합성 대비 검증은 별도**다. 본문·작은 글자 4.5:1, 큰 글자 3:1을 내부 검수 기준으로 삼고 모든 크롭에서 확인한다. 구분선 색을 작은 글자에 재사용하지 않는다.

검정·금색 회사 로고는 원본을 사용한다. 금색 UI 테마와 여러 서비스별 새 강조색은 이번 범위에 추가하지 않는다.

**2026-10-25 결정 — Quote 전용 Painted Cabinet 예외:** 사용자 확인에 따라 [55번 Quote UI·UX 계획](55-quote-ui-ux-analysis-and-cabinet-palette.md) §3.2의 Painted Cabinet 팔레트를 Quote 화면에만 적용한다. `src/shared/styles/tokens.css`에는 `--palette-*` 원시 토큰을 두고, `.quote-route-shell` 안에서만 `--quote-*` 의미 별칭으로 사용한다. 홈·KCP·EMS 색상과 기존 `--site-*` 값은 유지한다. 이 결정은 앞선 “서비스별 새 강조색을 추가하지 않는다”는 원칙의 Quote 한정 예외다.

## 3. 서체와 굵기

[Manrope](https://fonts.google.com/specimen/Manrope)를 영문 UI의 공통 서체로 사용한다. 적용 시 공식 배포 파일과 라이선스를 함께 보관하고, variable WOFF2 한 파일 또는 검증된 필요한 weight 파일로 구성한다. 공식 Latin variable WOFF2 24,576 B와 OFL 라이선스를 확보해 로컬에 저장했다. 파일 출처·SHA-256은 폰트 디렉터리 README에 있다.

- `--font-family-sans`: `var(--font-manrope, Arial), Helvetica, sans-serif`. `--font-manrope`는 폰트 로더가 공급하는 실제 family 변수다.
- `--font-weight-regular: 400`: 본문.
- `--font-weight-medium: 500`: 짧은 라벨·보조 문구.
- `--font-weight-semibold: 600`: 메뉴·본문 내 강조.
- `--font-weight-bold: 700`: 제목·버튼.
- `--font-weight-display: 800`: RENEW. REFRESH. 대형 문구.
- 가짜 900 bold나 브라우저 합성 굵기에 의존하지 않는다. 폰트 파일에서 실제 지원 weight를 확인한다.
- 한국어 UI를 추가할 때 해당 글리프를 지원하는 폰트를 별도 결정한다. 영문 Manrope가 한국어까지 처리한다고 가정하지 않는다.

`src/shared/config/fonts.ts`에서 `next/font/local`을 한 번 정의하고 `localFont({ variable: "--font-manrope", ... })`의 `.variable` 클래스를 RootLayout에 연결한다. Tailwind `@theme inline`의 `--font-sans`는 `var(--font-family-sans)`에 매핑한다. 생성된 family를 문자열 `Manrope`만으로 가정하지 않는다. 다른 프로젝트에서는 `--font-manrope` 공급부를 로컬 `@font-face` 등으로 교체한다. `font-display: swap`, fallback metrics와 줄바꿈을 확인하며 방문자 브라우저의 외부 Google Fonts 요청 없이 로컬 파일을 제공한다. [Next.js 공식 폰트 안내](https://nextjs.org/docs/app/getting-started/fonts)

## 4. 글자 크기·행간·자간

아래 px는 기본 16px 환경의 디자인 목표다. 실제 코드는 rem과 clamp를 사용하고 사용자 확대 설정을 허용한다. 최종 display 상한은 136px, Hero tagline은 32–44px/400, 공용 cinematic story H3는 데스크톱 48–64px/700이다. 아래 일반 scene-title과 cinematic 크기를 구분한다. **HTML heading 수준과 시각적 크기는 분리**한다. 큰 글자를 만들려고 H1을 추가하지 않는다.

| 의미 토큰 | 320–639px | 640–1023px | 1024px 이상 | 굵기 / 행간 / 자간 |
| --- | --- | --- | --- | --- |
| `display` — KCP Hero | 48–64 | 72–96 | 96–136 | 800 / 0.98 / -0.045em |
| `page-title` — 일반 페이지 제목 | 36–44 | 48–56 | 56–72 | 700 / 1.08 / -0.035em |
| `section-title` — H2 | 28–32 | 36–40 | 40–48 | 700 / 1.15 / -0.025em |
| `scene-title` — 단계 H3 | 24–28 | 28–34 | 32–40 | 700 / 1.15 / -0.02em |
| `card-title` | 20–22 | 22–24 | 24 | 700 / 1.25 / -0.01em |
| `lead` — 소개 문장 | 18 | 20 | 22–24 | 400 / 1.5 / normal |
| `body` | 16 | 17 | 18 | 400 / 1.65 / normal |
| `nav` | 16 | 16 | 16–18 | 600 / 1.4 / normal |
| `section-nav` — 기존 KCP 목차 | 18 | 20 | 20 | 600 / 1.4 / normal |
| `button` | 16 | 16 | 18 | 700 / 1.2 / normal |
| `caption` | 14 | 14 | 14 | 500 / 1.5 / normal |
| `eyebrow` | 12 | 12 | 13 | 600 / 1.5 / 0.14em |

시작 예시: display `clamp(3rem, 0.5rem + 9.1vw, 8.5rem)`, page-title `clamp(2.25rem, 1.5rem + 3vw, 4.5rem)`. 표의 범위를 breakpoint별로 조절할 수 있으나 개별 페이지에서 무관한 임의값을 추가하지 않는다. KITCHEN. / RENEWED.의 의도한 두 줄은 유지하되 320px·200% 확대에서 잘림 없이 재배치한다. 본문 최대 폭은 60–65ch, 사진 위 문장은 38–48ch를 기준으로 한다.

폰트 크기는 `--text-display`처럼 정의하고 Tailwind v4의 부속 토큰은 `--text-display--line-height`, `--text-display--font-weight`, `--text-display--letter-spacing`처럼 **이중 하이픈**을 사용한다. 구성요소는 `text-display / text-page-title / text-body` 의미 utility를 소비한다. 일반 CSS 원본 변수를 따로 둘 경우 `@theme inline`의 이 이름들에 매핑하며 같은 수치를 두 곳에 저장하지 않는다.

## 5. 여백·레이아웃·형태

| 항목 | 글로벌 기준 |
| --- | --- |
| spacing scale | 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128px |
| container max | 88rem(1408px), 본문 영역은 더 좁은 measure 적용 가능 |
| 좌우 gutter | 모바일 20px, 태블릿 32px, 데스크톱 48–64px |
| 섹션 상하 여백 | 모바일 48–64px, 데스크톱 80–112px |
| 카드 모서리 | 8px; 사진 모서리 0–8px |
| 버튼 모서리 | pill, 999px |
| 터치 높이 | 기본 48px 이상; 주요 CTA 52–56px |
| 헤더 | 모바일 약 72px, 데스크톱 약 88–96px; 콘텐츠가 커지면 늘어남 |
| z-index | 기본 0 / 장면 장식 1 / 본문 2 / 헤더 20 / 메뉴 40 / skip link 60 |
| focus | 2px ring + 4px offset, 사진 위는 밝은 외곽선 추가 |

KCP 헤더만 Hero 사진 위에 겹친다. 메인 헤더는 기존 프로토타입 배치를 유지한다. route 맥락과 overlay 여부를 별도 prop으로 관리한다. 자동 스크롤 고정 헤더는 기본 필수로 추가하지 않는다. 향후 sticky header를 사용하면 실제 높이와 anchor scroll-margin을 같은 토큰으로 관리한다.

Hero는 무조건 고정 `100vh`로 잘라내지 않는다. 최소 높이와 내용 높이를 함께 고려하고 모바일 브라우저 주소창·짧은 화면·가로 화면에서 내용이 흐르도록 한다. 메뉴가 한 줄에 맞지 않는 폭에서는 접는다.

## 6. 공용 UI 계약

- `Container`: wide / content / narrow 폭과 공통 gutter.
- `SectionHeading`: semantic tag와 typography variant를 별도로 받음.
- `ActionLink` 또는 확장 `AnchorButton`: 실제 이동용, primary / outline / text 형태.
- `Button`: 동작용 native button. disabled는 실제 disabled 속성을 사용하고 가짜 href로 처리하지 않음.
- `QuoteCta`: 서비스 콘텐츠 모듈에서 상태와 준비 안내를 조립. **이번 온라인 Free Quote는 계속 비활성**이다. 시안의 진한 활성 버튼 스타일은 실제 사용 가능한 연락 CTA에 사용할 수 있다.
- `MediaFigure`: 이미지 비율·alt·caption·concept/source 고지를 함께 제공.
- `ServiceStory`: 공용 모션·레이아웃만 맡고 서비스명·실제 공정·회사 정책은 props로 받음.
- 시안의 RENEW. REFRESH.를 HTML로 렌더링하고, 전화·이메일·KCP 링크는 기존 실동작을 유지한다.

서비스별로 바꿀 수 있는 값은 이미지·focus 위치·카피·장면 수·선택된 motion preset이다. 글로벌 타입 스케일·버튼·메뉴·focus 규칙은 그대로 사용한다. 새로운 서비스별 테마는 필요가 확인될 때 semantic token override로 추가한다.

## 7. 모션 토큰

- `--motion-fast: 160ms`: hover·작은 상태 변화.
- `--motion-standard: 240ms`: 일반 opacity 전환.
- `--motion-scene: 420ms`: 장면 교차 전환의 시작값.
- `--ease-standard: cubic-bezier(0.2, 0.65, 0.3, 1)`.
- 분해·조립 이동량과 coat reveal은 장면 내부 정규화 진행률 0–1을 사용한다. 스크롤과 연동된 동작에 시간 기반 autoplay를 섞지 않는다.
- 텍스트를 단어별로 오래 가리거나 본문 표시를 애니메이션 완료에 의존시키지 않는다.
- reduced-motion에서는 transform·scrub·긴 pin을 제거하고 정적인 단계 목록을 제공한다. [MDN reduced-motion 안내](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)

## 8. 실제 파일 적용과 회귀 방지

예정 파일 구조:

```text
src/shared/styles/tokens.css          # 색·크기·굵기·간격·모션 단일 원본
src/shared/styles/typography.css      # 의미별 조합이 필요할 때만
src/shared/config/fonts.ts            # 폰트 로더 한 곳
src/shared/assets/fonts/              # 확인된 로컬 폰트·라이선스
src/app/globals.css                   # import·Tailwind theme 매핑·기본 스타일
src/app/layout.tsx                    # 폰트 변수 적용
src/shared/ui/                       # 공통 컨트롤·레이아웃
```

현재 `globals.css`의 5개 색 변수·Arial 선언과 페이지마다 흩어진 크기/굵기를 새 토큰으로 이관한다. Tailwind v4 `@theme inline`으로 의미 utility에 연결하되 색상 HEX를 CSS와 TS에 중복 저장하지 않는다. 기존 `bg-[#...]`, 직접 font-size/weight 사용은 관련 홈·KCP·공용 헤더/푸터 범위에서 함께 정리한다. [Tailwind theme 변수 안내](https://tailwindcss.com/docs/theme)

글로벌 변경의 검수는 홈과 KCP를 모두 포함한다. 단순히 tokens.css 파일이 존재하는 것으로 완료 표시하지 않고, 실제 소비 컴포넌트에서 값이 적용되는지 확인한다. 모바일 메뉴·FAQ·실제 연락 링크의 기능 회귀, 긴 제목·200% 확대·폰트 로딩 실패도 확인한다.
