# ESN-01b 관리자 인가 기반 구현 검증

날짜: 2026-10-04 · Australia/Sydney · 브랜치: `codex/esn-admin-planning`

사용자의 “구현으로 진행해줘” 요청에 따라 [ESN 첫 구현 순서](../esn-admin/04-roadmap-and-acceptance.md)의 공통 인가 규칙과 기존 로컬 관리자 접근 경계를 구현했다. **개별 관리자 로그인·초대·MFA 제공자 연결이나 ESN 전체 완료를 뜻하지 않는다.**

## 변경 내용

- `admin-access`의 domain/application에 검증된 사용자 세션, 만료, `aal2`, 같은 회사·사용자의 활성 membership과 작업별 권한을 확인하는 규칙을 추가했다. 인증·membership 조회는 포트로 받으며 오류 시 접근을 거절한다. 권한은 요청마다 재조회하고 조회 중 만료도 다시 확인한다.
- 기존 SQLite/Supabase 운영 세션은 별도의 로컬 preview 규칙을 사용한다. 로컬 실행 스위치·허용 주소·포트를 확인하고 만료/삭제/지원하지 않는 세션을 거절한다. 기존 Google 로그인 세션도 외부 주소나 비활성 로컬 환경을 우회하지 못한다. 이 세션을 개별 직원·MFA 인증으로 승격하지 않는다.
- 로그인·세션·OAuth 진입과 업무 API, 기존 예약/PDF/사진의 인증 경로에 경계를 적용했다. 로그인 전 응답과 화면에서 회사 이메일·저장소·누락 환경변수 목록을 제거했다. 운영 JSON 응답은 `private, no-store`와 `Vary: Cookie`를 사용한다.
- 별도 `test:admin-access` 명령과 전체 운영 검사 실행을 CI에 추가했다. 원격 CI 실행 결과는 아직 없다.

## 자동 검사

| 검사 | 결과·범위 |
| --- | --- |
| 첫 전체 `npm run test:operations` | 265/265 통과. 기존 229개 + 인가 정책 27개 + SQLite/PGlite 경계 8개 + 제출 사진 접근 1개 |
| 첫 lint·typecheck | 통과 |
| 신규 `.mts` 테스트 strict TypeScript 검사 | 통과. 기본 앱 tsconfig의 테스트 제외와 별도로 실행 |
| 격리 소스 사본 production build | 통과. 원래 실행 중인 앱의 `.next`를 덮어쓰지 않음 |
| 실제 브라우저에서 발견한 주소 문제 | 최초 실패를 아래에 기록. 수정 후 최종 검증 결과는 후속 행에 기록 |

인가 정책은 비인증·고객/지원하지 않는 role·미초대·다른 회사·회수 membership·MFA 미완료·만료·제공자 장애와 권한 변경을 합성 계정으로 검사한다. 통합 검사는 임시 SQLite 및 전체 기존 migration을 적용한 PGlite, 가짜 전송 어댑터만 사용한다. `.env`를 로드하거나 실제 외부 제공자로 전송하지 않는다.

제출 사진 시험은 합성 불변 제출의 사진 바이트가 올바른 관리자 요청에서만 반환되는지 확인한다. 다른 제출 ID, 외부 주소, 만료·삭제 세션을 거절하고 거절 시 Storage 호출이 없으며 제출 객체가 보존되는지도 검사한다. 기존 예약 충돌·revision·서명/PDF·사진 저장/복구 시험은 전체 운영 검사에 포함된다.

## 실제 브라우저 검증과 수정

환경: 소스 사본 `/private/tmp/lk-esn-preview-x467fu6z`, loopback 3011 포트, 임시 SQLite·합성 암호. 실제 회사 Supabase/Google 키·데이터·worker를 사용하지 않았다. 기존 3002 서버는 종료하지 않았다.

첫 브라우저 실행에서 `APP_BASE_URL=http://127.0.0.1:3011`과 브라우저 주소가 일치해도 세션 조회가 403으로 거절됐다. 설치된 Next.js의 `NextURL`이 요청 URL의 `127.0.0.1`을 `localhost`로 정규화하는 것이 원인이었다. 임시 사본에서 관측한 요청 URL은 `http://localhost:3011/api/operations/session`, 원본 Host는 `127.0.0.1:3011`이었다. 쿠키·비밀값을 진단 로그에 기록하지 않았다.

어댑터에서 설정된 원본 Host와 포트가 정확히 일치하고 내부 URL도 허용 loopback인 경우에만 이 차이를 정규화한다. 외부 URL·다른 Host/포트·전달 헤더로 허용 범위를 늘리지 않는다. 순수 domain의 동일 origin 규칙은 유지한다.

수정 후 결과:

| 검증 | 결과 |
| --- | --- |
| 전체 운영 자동 검사 | **268/268 통과**. 위 265개에 Next URL/Host 호환·우회 거절 회귀 3개 추가 |
| 관리자 인가 전용 검사 | **38/38 통과** (순수 정책 27 + SQLite/PGlite 통합 11) |
| lint·앱 typecheck·신규 테스트 strict tsc | 통과. 회귀 테스트 옵션 배열의 추론 오류는 명시적 옵션 타입을 추가해 수정 후 재확인 |
| 최종 격리 production build | 통과 |
| 정상 로그인·세션 | 합성 로컬 암호를 Enter로 제출, 업무 화면 표시, 새로고침 뒤 로그인 유지 |
| 로그아웃 | 업무 화면/회사 이메일/설정 목록 제거, 새로고침 뒤 로그인 화면 유지 |
| 요청 주소·직접 API | 설정과 다른 `localhost:3011` 진입에서 거절 화면. HTTP 직접 호출에서 익명 session 200, 업무 401, 위조 Host + forwarded header 403 |
| 응답 캐시 | 실제 HTTP 응답의 `Cache-Control: private, no-store`와 `Vary: Cookie` 확인. Next의 RSC Vary와 별도 헤더로 함께 반환 |
| 반응형·키보드 | 1280px 로그인 화면, 320px 로그인/업무 화면, 390px 로그인 화면에서 가로 넘침 없음. Tab·Enter 건너뛰기 링크가 업무 본문으로 포커스 이동 |
| 브라우저 콘솔 | 정상 로그인/새로고침/로그아웃 흐름 오류 없음. 다른 host의 403은 의도한 접근 거절 결과 |

화면 증거: [1280px 로그인 화면](assets/esn-admin-access/lk-esn-admin-login-desktop.jpg), [320px 로그인 화면](assets/esn-admin-access/lk-esn-admin-login-320.jpg). 이는 브라우저 뷰포트 검사이며 실제 휴대폰 검사나 새 관리자 최종 디자인 인수가 아니다.

변경된 Markdown의 로컬 링크 357개와 `git diff --check`도 통과했다.

최종 로그는 작업 임시 경로 `/private/tmp/lk-esn-final-tests.log`, `/private/tmp/lk-esn-final-build.log`에 남겼다. 임시 3011 서버와 시험 브라우저 탭을 종료했으며 원래 서버는 유지했다. 로컬 포트 실행·HTTP 검사에 필요한 sandbox 허용을 사용했고 외부 서비스는 호출하지 않았다.

## 완료 범위와 다음 작업

ESN-01b의 규칙·포트는 구현됐으며 01c~01e의 기존 preview 경계·회귀 검사만 일부 선행했다. 실제 직원 계정용 Auth 어댑터, 서버 소유 membership schema, 초대·MFA 등록/검증/복구·회수 UI, 서버 페이지 보호, 직원 로그인과 회사 Google 연결의 분리는 다음 구현 단위다. 운영 도메인·배포 URL 접근 시험, 실제 모바일 기기, 실제 제공자 장애/복구·회사 UAT도 미완료다.

운영 DB migration, 새 외부 계정·유료 자원, DNS·배포·Google 결제 설정을 변경하지 않았다. 이 단위의 로컬 개발은 Places 결제 대기와 독립적이다. 진행 상태는 [ESN 진행표](../esn-admin/05-progress.md)와 [전체 TODO](../plans/15-home-cabinet-admin-todo.md)에 연결한다.
