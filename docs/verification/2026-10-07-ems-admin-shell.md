# EMS-D1 관리자 공통 화면·업무 경로 검증

날짜: 2026-10-07 · Australia/Sydney · 브랜치: `codex/ems-admin-shell-20261007`

[09 순차 구현 계획](../esn-admin/09-2026-10-07-admin-shell-implementation-plan.md)에 따라 기존 인증과 업무 기능을 메뉴별 경로로 이관했다. 실제 KPI·그래프·집계와 D3 상세/필터는 포함하지 않는다. 이번 검증의 업무 자료는 **합성 데이터**다. 회사 계정 로그인·고객 연결/예약 확정·메일/Calendar 쓰기 인수를 대신하지 않는다.

## 구현

- `/admin` 공통 레이아웃, sidebar·계정 메뉴·모바일 dialog, 하나의 main/H1, 페이지 이동 초점을 적용했다. 색상/서체는 기존 Slate/Greige·Manrope를 재사용한다.
- Clients·Enquiries·Quotes·Schedule·Settings 경로에 기존 고객·문의·서명 데모·예약·연동·세션 기능을 연결했다. Jobs·Orders·Inventory·Reports는 준비 안내다. Overview에 가상 수치나 목록 길이로 만든 KPI는 없다.
- `StaffAdminBoundary`가 ready 자식만 mount한다. 비밀번호/이메일/TOTP 단계·focus 재검사·비밀값 초기화와 서버 API 인가는 보존한다. 인증 실패를 legacy 로그인으로 우회하지 않는다.
- 직원 ready 수명에 Operations controller 하나를 두고 기존 owner·연결 대상·in-flight·retry 조건의 60초 동기화를 유지한다. Google 옵션은 owner가 Settings를 열 때 읽는다. 예약 상세의 15초 polling은 해당 화면에서만 동작한다.
- 고객·문의·예약·세션 입력과 불확실 요청을 인증 수명의 메모리에 보존한다. 경로 이동의 취소/폐기, 뒤로가기 복원, 최신 revision 확인, 동일 payload/key 재시도를 지원한다. 개인정보를 URL·localStorage·sessionStorage에 추가하지 않는다.
- JSON 요청의 401/403은 접근 상실 경계로 전달한다. 이전 요청의 늦은 결과는 취소/generation 검사로 무효화한다. 로그아웃 시 자식과 초안을 제거하고, 정리 요청이 불확실해도 별도 확인 후 명시적 로그아웃은 가능하다.
- 기존 PDF/사진의 보호 URL과 native 다운로드/이미지 동작은 유지한다. 파일 API의 서버 인가는 공통 화면 표시 제어와 별개다. 파일 응답을 blob fetch로 바꾸거나 이미지 실패만으로 서버 로그아웃 성공을 안내하지 않는다.
- 이전 hash 네 개와 `?google=connected`는 고정된 내부 경로로 연결한다. 새 외부 returnTo는 받지 않는다.

## 자동 검사와 런타임

| 검사 | 실행 결과 |
| --- | --- |
| 전체 `npm run test:operations` | **374/374 통과**, 실패/skip 0. 기존 359개 + 고객 요청 복원 2개 + Operations/예약 요청 수명 8개 + workspace/주소 호환 4개 + fixture 경계 1개 |
| `npm run check` | lint(경고 허용 0)·Next route typegen/TypeScript·production build 통과 |
| 최종 QA script 검사 | QA script ESLint 및 fixture 계약 1/1 재검증 통과. 가상 favicon allowlist 보완 후 검사 |
| 실행 도구 | Node 24.14.1, npm 11.11.0, Next.js 16.3.6. 새 의존성 설치 없음 |
| 빌드 경고 | 기존 Node SQLite `ExperimentalWarning` 존재. TypeScript/lint 실패와 구분 |

분할 단계에서 관리자 106/106·고객 25/25, 요청 수명 8/8 등 관련 검사를 먼저 실행하고 위 전체 검사로 통합했다. 과거 검사 수를 오늘 실행으로 재사용하지 않았다.

## 합성 브라우저 검증

앱의 production 자산은 3015, 격리 fixture는 3013에서 제공했다. QA는 설치된 Chrome의 **새 격리 프로필**과 번들 Playwright로 실행했다. 회사 Chrome 프로필/쿠키는 사용하지 않았다. fixture는 명시한 관리자 경로·Next static asset·공개 로고만 proxy한다. API는 전부 합성이고 Cookie/Authorization/Set-Cookie는 upstream으로 전달하지 않는다. RSC 요청/응답은 인증 정보 없이 보존한다.

| QA 항목 | 확인한 결과 |
| --- | --- |
| QA-D1-01 인증 단계 | signed_out·password_change·email_verify·mfa_enroll·mfa_verify에서 직접 하위 경로 진입 시 업무 요청 0. 인증 화면/조회 불가 상태 main 1개 |
| 직접 경로 | Overview 포함 10개 경로 200·main/H1 각 1개, RSC 메뉴 이동과 뒤로가기 정상 |
| QA-D1-02 권한 상실 | Operations 401·예약 403 후 개인정보 subtree 제거, 로그인 단계로 복귀 |
| QA-D1-03 늦은 응답 | 지연된 Operations 성공 응답이 로그아웃 후 데이터를 복원하지 않음. 예약 상세 응답도 화면 이탈 후 반영되지 않음 |
| QA-D1-04 타이머 | 메뉴 다섯 개 이동 후 owner session 조회 1회·가상 60초 sync 1회. 401 후 추가 120초 sync 0회. 선택 예약은 15초 상세 조회 1회, 이탈 후 중단 |
| QA-D1-05 입력·응답 유실 | 고객 입력 후 이동 취소·browser back/forward 복원·명시적 폐기 확인. 저장 성공 뒤 503 응답 유실에서 동일 요청 재시도로 고객 1개 유지 |
| 세션 정리·로그아웃 | cleanup pending의 경로 이탈/복원·재시도 유지, 자동 재실행 없음. 명시적 로그아웃의 취소/확인 후 재로그인 시 고객 초안·cleanup 상태 폐기 |
| QA-D1-06 역할 | admin의 Google 옵션 요청 0. owner 옵션은 Settings 진입 때 조회. 별도 아래 legacy HTTP 검증 |
| QA-D1-07 주소 호환 | 예전 hash 4개와 Google 복귀 1개가 지정 경로로 연결. 외부/알 수 없는 hash는 순수 함수 검사 |
| QA-D1-08 파일 | 서명 데모 상세·보존 원본 표시, 합성 사진 decode, 합성 PDF MIME와 본문 확인. 실제 회사 파일 새 열람과 구분 |
| QA-D1-09 화면/키보드 | 1440·1280·768·390·320px 가로 넘침 없음, 모바일 메뉴 선택 후 닫힘·Escape·초점 복귀, 긴 이름/이메일 줄바꿈 |
| QA-D1-10 검증 경계 | API/자격증명 전달 금지, 미지원 경로/POST/image proxy 차단, RSC 계약 검사. 외부 origin 요청 0 |

기본 브라우저 묶음 **36개**, 최종 변경 영향 묶음 **8개**가 통과했다. 최종 영향 검사에서 예상외 console error/warning·pageerror는 0개다. 의도한 API 실패 resource error 5개(401×1, 403×1, 503×3), 허용 목록 밖 홈페이지 RSC prefetch 차단 404 15개, 정리 중 요청 abort 2개는 별도 분류했다. 실제 홈페이지 오류나 회사 API 요청으로 확대 해석하지 않는다.

추가 업무 흐름 **4/4**도 통과했다. 고객 연결→감사→해제는 revision 1→2→3과 원본 보존, 409 충돌에서는 사유 보존·확인 해제·재조회 후 재확인, 예약은 제안 저장→fixture의 서명 상태 주입→새로고침→확정 1회, 문의는 임시 일정 저장과 Gmail 원본 보존을 확인했다. 이 묶음의 예상외 console/pageerror·외부 요청은 0이고 주입 409 1개·홈페이지 prefetch 차단 404 4개를 별도 기록했다. 합성 서명 상태 주입은 실제 고객 서명·메일·Google busy/점유 검증이 아니다.

## 실제 로컬 진입·legacy 검증

최종 앱을 기존 환경의 `http://127.0.0.1:3002`에서 다시 실행했다. `.env.local` 값은 변경하지 않았으며 직원 인증/email 설정을 유지한다. 익명 HTTP로 `/admin`·Customers·Schedule·Settings 4페이지의 로그인 화면/200/noindex와 Operations·Customers·Sessions·Bookings API 4개의 401/no-store를 확인했다. 사용자 로그인·회사 업무 변경은 실행하지 않았다.

별도 임시 프로세스에서 기존 legacy 인증 모드와 **직원 인증을 켠 이전 UI 모드**를 각각 확인했다. 두 모드 모두 `/admin`은 기존 화면이고, 새 직원 하위 경로 9개는 404다. 검사는 페이지 GET만 실행했다.

UI를 되돌릴 때는 `STAFF_ADMIN_AUTH_ENABLED=true`를 유지하고 `STAFF_ADMIN_WORKSPACE_UI=legacy`로 재시작한다. 이 옵션을 생략하면 새 화면이다. `.env.example`에 설명만 추가했고 실제 환경을 바꾸지 않았다. 인증 플래그를 끄는 것을 UI 복구로 사용하지 않는다.

## 발견·수정

| Before | After | Why |
| --- | --- | --- |
| native fetch를 객체 메서드로 호출해 브라우저에서 `Illegal invocation` 발생 | 지역 함수로 호출하고 receiver를 검사하는 회귀 테스트 추가 | Node 모의 fetch만으로 놓친 실제 브라우저 오류 해결 |
| 새 공통 화면 아래 인증 fallback에는 main이 없음 | 공통 layout에서 authMain을 요청하고 standalone은 기존 main 유지 | 로그인부터 업무 화면까지 main 1개 |
| 세션 정리 요청/확인이 route 이탈 때 사라짐 | 인증 수명 draft와 busy/불확실 요청 보호, 복원 후 명시적 재시도 | 결과 유실·자동 중복 명령 방지 |
| 미확정 요청의 이동 guard가 계정 로그아웃도 차단할 수 있음 | 별도 로그아웃 확인으로 초안 제거·보낸 요청의 결과 확인 안내 | 명시적인 보안 종료 경로 보존 |

새 공개 모듈 진입점은 ESLint의 명시 allowlist에 추가했다. 규칙을 끄지 않았다. 테스트 fixture의 홈페이지 prefetch/공개 로고 요청과 응답 도착 시점에 대한 QA race를 분리·보완했으며, 기능 실패를 skip하지 않았다.

## 재현과 증거

```sh
npm run test:operations
npm run check
# 별도 터미널: production 앱 3015가 실행 중일 때
EMS_FIXTURE_PORT=3013 EMS_FIXTURE_UPSTREAM=http://127.0.0.1:3015 node scripts/verify-esn-ui-fixture.mjs
node scripts/verify-ems-shell.mjs --base http://127.0.0.1:3013 --playwright /absolute/path/to/playwright/index.mjs --channel chrome --effects
node scripts/verify-ems-shell-races.mjs --base http://127.0.0.1:3013 --playwright /absolute/path/to/playwright/index.mjs --channel chrome
node scripts/verify-ems-shell-workflows.mjs --base http://127.0.0.1:3013 --playwright /absolute/path/to/playwright/index.mjs --channel chrome
```

브라우저 runner는 fixture marker가 없는 origin을 거부한다. 실제 앱 origin에 synthetic 변경을 보내지 않는다. 현재 머신의 번들 Playwright 경로를 인자로 사용했으며 저장소 의존성으로 설치하지 않았다.

- [1440px Overview](assets/ems-admin-shell-desktop-20261007.png)
- [390px Schedule 상세](assets/ems-admin-shell-mobile-20261007.png)

화면은 모두 Synthetic/example.invalid 자료다. 테스트 로그는 실행 당시 `/tmp/lk-ems-d1-tests-final.log`, `/tmp/lk-ems-d1-check-final.log`, `/tmp/lk-ems-d1-browser.log`, `/tmp/lk-ems-d1-targeted.log`, `/tmp/lk-ems-d1-workflows.log`, `/tmp/lk-ems-d1-route-modes.log`, `/tmp/lk-ems-d1-local-http.log`에 저장했다. `/tmp` 파일은 영구 산출물이 아니며 위 문서와 재현 script를 보존한다.

## 남은 범위와 역할

- 실제 회사 관리자 로그인 후 고객 분류/연결·다른 세션 종료·사진 포함 재서명/확정·실기기 인수는 미완료다. 자동 동기화가 실행되는 실제 owner 화면을 읽기 전용 시험으로 표시하지 않는다.
- EMS-D2의 전체 서버 집계·4 KPI·그래프·agenda와 D3의 상세 경로/필터는 다음 작업이다. Jobs·주문·재고·청구/매출은 준비 상태다.
- schema·API 업무 규칙·가격/약관·Google 결제·회사 설정·배포를 변경하지 않았다. 원격 push/커밋/merge는 수행하지 않았다. 기존 08번 문서의 사용자 미커밋 편집도 보존했다.
- implementer(GPT-6.1 Sol/high) 두 명이 인증/고객과 운영/예약을 분담했고, 기존 implementer가 fixture/브라우저 검증을 맡았다. 추가 analyst 실행은 세션의 agent thread 한도로 실패해 주 에이전트가 경계·동작·UI 결과를 통합 검토했다. 역할이나 모델이 자동 전환됐다고 간주하지 않는다.
