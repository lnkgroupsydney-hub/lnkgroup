# EMS 관리자 대시보드 UI/UX 개편 검증

날짜: 2026-10-25 · Australia/Sydney · 브랜치: `dashboard-ui/ux` (기준 `5c42702`, 미커밋)

[10번 계획](../esn-admin/10-2026-10-25-dashboard-ui-ux-plan.md)의 Task 1~7을 `/orchestration`(Codex 패킷 C1, UI 패킷 U1·U2, integrator 최종 검토)으로 구현했다. 화면 검증의 업무 자료는 모두 **합성 데이터**(`example.invalid`)다. 회사 계정 로그인, 실제 견적·예약 건수와 운영 화면 인수를 대신하지 않는다.

## 구현

- **관리자 전용 팔레트:** 로고 기준 검정 `#161412` + 금색 `#C9A227`. 토큰은 `.admin-workspace`·`.admin-leave-dialog`·`.ems-theme` 범위에만 정의하고, 같은 범위에서 기존 `--site-*` 변수를 다시 지정한다. 공개 사이트의 `:root` 토큰은 바꾸지 않았다.
- **입력창:** `#F8F6F1` 바탕에 `#8A8478` 테두리(3.44:1)를 써서 흰 카드와 구분한다. focus 때는 흰 바탕과 금색 링으로 바뀐다. 비활성 버튼은 sunken 바탕에 muted 글자(5.75:1)다.
- **글꼴:** Google Fonts Outfit 가변 글꼴(Latin, Latin Ext)을 `src/shared/assets/fonts/`에 vendoring하고 OFL을 함께 두었다. 관리자 레이아웃에서만 불러오고 preload한다. 관리자 범위의 글자는 12px 이상, 두께는 650 이하다.
- **셸:** 검정 사이드바, 금색 활성선, 실제 원형 로고, 메뉴 그룹(Work, Coming soon, Admin), 검정 모바일 서랍.
- **Overview:** 날짜 → 실제 건수 카드 3개 → 검정 강조 카드 + 업무별 색조 바로가기 → Coming soon, Settings 순서.
- **건수 카드:** 기존 관리자 읽기 API 두 개만 쓴다. DB·RPC·API route 변경은 없다.
  - Quotes awaiting review: `/api/admin/quote-requests`를 최대 10×50건까지 순회한다. 넘으면 `N+`로 표시한다.
  - Bookings needing action / Confirmed bookings: `/api/admin/live-bookings`.
  - 어느 한쪽이 실패하면 숫자를 표시하지 않는다. 401/403이면 로그인 화면으로 돌아간다.
- **상태 배지:** 견적·예약 목록에 톤과 글자를 함께 표시한다. 집계 정의와 배지 라벨은 계획서 Task 6(개정 3)을 따른다.
- **로그인·MFA 화면:** 같은 테마를 쓴다(`.ems-theme`).

## 재사용 디자인 키트

`design-system/lk-ems/`에 같은 팔레트·Outfit·컴포넌트를 프레임워크 없는 CSS로 묶었다. 구성은 `ems-tokens.css`, `ems-fonts.css`, `ems-components.css`, `fonts/`, `README.md`, `preview.html`이다. `ems-tokens.test.mts`가 키트 토큰과 `admin-theme.css`의 값이 같은지 검사한다. 이 테스트는 `test:admin-shell`과 `test:operations`에 포함되며 결과는 2/2다. `preview.html`은 headless Chrome에서 1280·390px로 렌더링해 확인했다. Outfit이 로드됐고 가로 넘침과 콘솔 오류가 없었다.

## 실행한 검사 (integrator 재검토 2회차, 직접 실행)

| 명령 | 결과 |
| --- | --- |
| `npm run test:operations` | 800/800 통과 |
| `npm run lint` | 통과 |
| `npm run typecheck` | 통과 |
| `npm run build` | 통과 |
| `git diff --check` | 통과 |

- 대비 기준은 `src/modules/admin-dashboard/presentation/admin-palette.test.mts`로 고정했다. 텍스트 4.5:1, 입력 테두리·focus 3:1이다.
- build 산출물 기준으로 Outfit은 `src/app/admin/layout`에만 연결된다. 공개 `/`와 `/services/cabinet-painting`은 Manrope만 preload하고 관리자 CSS를 포함하지 않는다.
- `npm run test:search`는 공개 페이지 코드 변경이 없어 실행하지 않았다.

## 화면 확인 (합성 데이터, ui-implementer)

- **경로와 폭:** `/admin`, `/admin/customers`, `/admin/enquiries`, `/admin/quotes`, `/admin/schedule`, `/admin/settings`, `/admin/jobs`를 1440·1024·768·390·320px에서 확인했다. 가로 넘침은 없었고 Outfit 적용과 로고 로딩을 확인했다.
- **건수 카드:** 로딩, 정상, 부분(`N+`), 오류, 401(로그인 화면 전환)을 실제 훅 경로에서 확인했다. 세 카드의 숫자 세로 위치가 같았다.
- **상세 화면 측정:** 예약 상세·편집기·초안·검토 필요, 견적·문의 상세를 1440·390에서 쟀다. 두께 700 이상과 12px 미만 텍스트 노드는 모두 0개였다.
- **동작:** 모바일 서랍(Esc, 바깥 클릭, 포커스 복귀), 계정 메뉴, 저장하지 않은 변경 경고, Tab focus를 확인했다. 한글 이름("김민수 · 서울")은 대체 글꼴로 표시됐다.
- **로그인:** `signed_out`, `mfa_verify` 단계를 1440·390에서 확인했다.

## 제한과 후속

- **합성 픽스처:** `scripts/verify-esn-ui-fixture.mjs`는 Next 16 dev에서 `/_next/hmr` WebSocket과 `x-nextjs-request-id`를 전달하지 못해 화면이 "Checking administrator access…"에서 멈춘다. 이번 검증은 저장소 밖 임시 중계 서버로 우회했다. 픽스처 보완(쿠키 미전달 유지)과 두 건수 API의 합성 응답 추가가 후속이다.
- **건수의 성격:** 브라우저에서 목록을 받아 센 값이다. 견적이 500건을 넘으면 하한값(`N+`)으로 표시된다. 정확한 서버 집계는 별도 작업이다.
- **바뀐 목록 문구:** 견적 `Details saved`→`Draft`, 예약 `Company proposal published`→`Awaiting customer`, `Company draft saved`→`Company draft`. 그 밖의 예약 문구는 기존과 같다.
- 실제 회사 계정·운영 데이터에서의 화면 인수, 커밋·푸시·배포는 수행하지 않았다.
