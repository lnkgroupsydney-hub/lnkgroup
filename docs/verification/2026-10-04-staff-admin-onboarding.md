# 첫 관리자 계정·온보딩 구현 검증

날짜: 2026-10-04 · Australia/Sydney · 브랜치: `codex/esn-admin-planning`

**후속 변경:** 사용자가 휴대전화 대신 이메일 코드를 요청하여 [이메일 인증 구현·검증](2026-10-04-staff-email-verification.md)으로 이어갔다. 아래 TOTP/QR 내용과 검사 수치는 당시 구현·검증 기록이며 현재 사용자에게 인증 앱 등록을 요구하는 의미가 아니다.

사용자가 지정한 `lnkgroupsydney@gmail.com`으로 첫 회사 관리자 계정을 생성하고 임시 비밀번호 로그인과 후속 설정 흐름을 구현했다. **실제 Auth 로그인 성공, 앱 로그인 화면 검증, 회사 DB 적용, 영구 비밀번호·MFA 완료는 서로 다른 결과다.** ESN 전체와 운영 공개는 미완료다.

## 실제 완료한 계정 작업

- 기존 승인된 회사 Supabase 프로젝트에서 동일 이메일의 기존 계정이 없음을 확인한 뒤 Auth 계정을 생성했다. 새 프로젝트나 유료 리소스를 만들지 않았다.
- 서버 소유 `app_metadata.lk_staff`에 `lk-group`의 활성 `owner`를 지정하고, 독립된 `lk_staff_password_change_required`를 `true`로 설정했다.
- 무작위 임시 비밀번호는 Git 제외 `.local/admin-onboarding.json`에 `0600` 권한으로 보관했다. 사용자 비밀번호 변경을 확인한 뒤 `temporaryPassword` 필드는 삭제했고 진행 상태만 남겼다. 본 문서·저장한 검증 로그·스크린샷에 비밀번호나 토큰을 기록하지 않는다.
- 실제 SDK `signInWithPassword`가 성공했고 `getClaims`와 `getUser`로 동일 사용자를 확인했다. 당시 `aal1`, 비밀번호 변경 필요, owner 상태를 확인했다. 이 확인용 Auth 세션은 로그아웃했다.
- 후속 요청에서 사용자가 SQL을 적용한 뒤, 실제 앱 `127.0.0.1:3002/admin`에 임시 비밀번호로 로그인하여 `Replace your temporary password` 화면과 지정 이메일을 확인했다. 이후 사용자가 영구 비밀번호를 저장했고 Auth의 변경 의무 플래그 `false`를 확인했다. 새 비밀번호 값은 읽거나 저장하지 않았다. 실제 인증 앱 등록·MFA 통과는 사용자 설정 대기다.

## 구현한 흐름과 경계

`STAFF_ADMIN_AUTH_ENABLED=true`일 때 `/admin`은 개별 직원 로그인 → 임시 비밀번호 교체 → 본인 인증 앱 설정/검증 → 업무 화면 순서로 진행한다. 현재 HTTP loopback 로컬 검증 범위이며 운영 도메인 접근은 허용하지 않는다. 최초에는 격리 검증 서버에서만 켰으며, SQL의 실제 검증 후 원래 `.env.local`에서도 활성화했다.

- 라우트는 `admin-access` 공개 서버 진입점에 연결하고 화면은 공개 client 진입점으로 조합한다. 기존 DDD domain/application의 제공자 비의존 규칙을 유지한다.
- HttpOnly `lk-staff-auth` 쿠키를 사용한다. 서버는 검증한 JWT, 최신 Auth 사용자·관리자 권한, 실제 Auth 세션, 기존 비공개 `lk_sessions`의 직원 등록·만료를 확인한다. 원시 `getSession` 결과나 클라이언트 metadata만으로 인가하지 않는다.
- 비밀번호 교체 전과 MFA `aal2` 전에는 업무 API·PDF·사진을 거절한다. MFA 기기를 제거했을 때 이전 `aal2` 토큰이 남더라도 최신 verified TOTP factor가 없으면 차단한다.
- 로그인/비밀번호/MFA 요청은 동일 origin·JSON·본문 크기·시도 횟수 제한을 적용한다. 실패 응답에 제공자 원문·토큰·계정 정보를 노출하지 않는다.
- 비밀번호 변경 뒤 다른 직원 세션을 회수하고, 성공한 경우에만 독립된 변경 의무 플래그를 해제한다. 과거 역할/상태 값을 덮어써 권한 회수를 취소하지 않는다.
- 직원 모드에서는 기존 공용 비밀번호·Google 데모 세션·SQLite 경로로 우회하지 않는다. Google 연동은 owner의 `integrations.manage`와 현재 직원 세션에 결합한 OAuth 상태를 요구한다.
- 별도 다중 관리자 membership 테이블·초대/회수 UI·기기 분실 복구·감사 절차는 후속 범위다. 첫 계정의 최신 서버 소유 Auth metadata를 권한 원본으로 사용한다.

## 자동 검사

| 검사 | 결과 |
| --- | --- |
| `npm run test:operations` | **294/294 통과**. 앞선 268개 + 직원 경계 3개 + 세션 DB 7개 + 실제 SDK/합성 제공자 16개 |
| `npm run lint` | 통과 |
| `npm run typecheck` | 통과 |
| 신규 `.mts` strict TypeScript 검사 | 담당 구현 단위에서 별도 검사 통과 |
| 격리 소스 사본 production build | 통과. 기존 3002 서버의 `.next`는 덮어쓰지 않음 |
| 변경 Markdown의 로컬 링크·diff 형식 | 로컬 링크 370개 누락 없음, `git diff --check` 통과 |

제공자 시험은 실제 Supabase SDK와 합성 JWT/HTTP 응답으로 세션·역할·MFA·비밀번호·로그아웃·OAuth 경계를 확인한다. 실제 원격 MFA를 완료한 증거는 아니다. DB 시험은 PGlite의 합성 Auth 세션으로 service role 허용, anon/authenticated 거절, 다른 사용자·삭제·만료·null 세션 차단, 기존 migration 호환성을 확인한다.

전체 검사 로그는 `/private/tmp/lk-staff-tests-final.log`에 남겼다. Node의 기존 module-type/SQLite 실험 경고는 존재하며 검사 실패는 없었다.

## 실제 앱·HTTP 검사

환경: 격리 production 사본 `/private/tmp/lk-staff-build-P8DYKV`, `127.0.0.1:3011`, 직원 인증 스위치 활성화. 회사 제공자 설정을 사용하되, 아래 익명 화면·API 검증은 고객 레코드를 읽거나 변경하지 않았다.

| 검증 | 결과 |
| --- | --- |
| `/admin` | 기존 데모 로그인 대신 개별 이메일·비밀번호 화면 표시, 초기 이메일 노출 없음 |
| 1280px·320px | 로그인 화면 가로 넘침 없음. 실제 휴대폰 검증과 구분 |
| 키보드·필수 입력 | 초기 제목 포커스, 빈 제출 시 이메일 입력에 포커스/필수 오류, Tab으로 비밀번호 이동 |
| 브라우저 콘솔 | 로그인 전 화면 오류·경고 없음 |
| 익명 세션 | 두 session API 모두 200/비인증. 이전 owner 이메일·설정값 노출 없음 |
| 익명 업무·예약·PDF·사진·Google 연결 | 모두 401 |
| 레거시 쿠키 | 직원 모드의 업무 API 401 |
| 다른 origin 로그인 POST | 403 |
| 잘못된 Host | `curl`로 실제 Host를 지정해 403 확인 |
| 캐시 | 위 실제 응답 `Cache-Control: private, no-store` 확인 |

Host 검사의 첫 Node `fetch` 실행에서는 지정 Host가 적용되지 않아 정상 origin의 200 응답을 받았다. 실제 헤더를 보내는 `curl -H 'Host: untrusted.invalid'`로 재현하여 403을 확인했다. 애플리케이션 인가 우회로 판단하지 않았고 검사를 삭제하지 않았다. Proxy는 API 검사 전에 Auth 갱신을 수행할 수 있으므로 “제공자 호출 전 차단” 시험은 직접 핸들러 범위의 증거로 한정한다.

화면: [데스크톱](assets/staff-admin-login-desktop.jpg), [320px](assets/staff-admin-login-320.jpg). 인증 후 화면과 실제 MFA는 별도 인수가 남았다.

최초 검토에서는 3011 검증 서버와 미실행 SQL 탭을 남겼다. 아래 후속 검증으로 원래 3002 앱에 전환한 뒤, 임시 3011 서버를 종료하고 임시 사본의 `.env.local`을 삭제했다. 운영 도메인을 추가하지 않았다.

## 회사 DB 적용과 실제 앱 로그인 — 후속 확인

준비한 SQL: [`20261004022533_staff_admin_access.sql`](../../supabase/migrations/20261004022533_staff_admin_access.sql).

신규 `public.lk_staff_session_active`는 service role 전용 진입점이고, 비공개 helper가 지정 사용자·세션의 존재와 만료만 검사한다. 고객 데이터 변경이나 브라우저 역할의 Auth 테이블 조회 권한 추가는 없다. 별도 `lk_private` schema와 함수 실행 권한을 만드는 작업이다.

연결된 Supabase MCP는 회사 프로젝트 권한 오류를 반환했고 CLI는 해당 프로젝트에 연결되지 않았다. 처음에는 [적용 전 화면](assets/staff-session-sql-awaiting-approval.jpg)을 준비해 브라우저 도구의 보안 권한 추가 시점 승인을 요청했다. 이후 사용자가 직접 적용했다고 알렸고, 회사 SQL Editor의 `Success. No rows returned`와 아래 실제 API 결과를 확인했다. 에이전트는 같은 migration을 중복 실행하지 않았다. [사용자 적용 후 화면](assets/staff-session-sql-applied.jpg).

| 회사 DB 실제 검사 | 결과 |
| --- | --- |
| service role RPC 호출 / null ID | 정상 실행, `false` |
| 유효한 현재 Auth 세션·사용자 | `true` |
| 같은 세션·다른 사용자 | `false` |
| anon 호출 | `42501` 권한 거절 |
| 로그인한 authenticated 호출 | `42501` 권한 거절 |
| 해당 검증 세션 로그아웃 후 재조회 | `false`, 기존 토큰의 유효 기간과 별도로 회수 확인 |

회사 SDK 검증에 사용한 별도 세션은 로그아웃했다. 고객 테이블·파일·예약·회사 연동을 이 검사로 변경하지 않았다.

Security Advisor를 재실행한 결과 **오류 0, 경고 1**을 확인했다. 경고는 Auth의 `Leaked Password Protection Disabled`이며, 서버 전용 테이블에 대한 기존 정보 항목은 22개다. 새 세션 함수의 권한 노출 오류는 보고되지 않았다. 유출 비밀번호 검사 설정·사용 가능 조건은 운영 전 검토할 남은 항목이며 임의로 설정이나 요금제를 변경하지 않았다. [Advisor 화면](assets/staff-auth-security-advisor.jpg).

기존 3002 서버가 이전 production build를 실행 중이어서 환경 파일 수정만으로 새 화면이 나타나지 않았다. 해당 로컬 앱을 정상 종료한 뒤 현재 소스로 `npm run build`를 완료하고 동일 주소에 재시작했다. 추가 빌드는 실제 실행 앱 갱신을 위한 것이며 통과한 전체 테스트는 반복하지 않았다. 빌드 로그: `/private/tmp/lk-staff-main-build.log`.

| 실제 3002 앱 검사 | 결과 |
| --- | --- |
| 관리자 진입 | 개별 이메일·비밀번호 로그인 화면 표시 |
| 임시 비밀번호 로그인 | 성공, `Signed in as lnkgroupsydney@gmail.com` 표시 |
| 다음 단계 | `Replace your temporary password` 화면 도달, 업무 화면은 아직 열리지 않음 |
| 브라우저 콘솔 | 해당 로그인 흐름 오류·경고 없음 |
| 사용자 인계 | 로그인된 앱 탭을 표시하고 영구 비밀번호·본인 인증 앱 설정을 요청 |

[비밀번호 설정 인계 화면](assets/staff-admin-password-handoff.jpg). 비밀번호·인증 코드·QR 비밀값은 이 증거에 포함하지 않는다.

## 실제 MFA 설정 중 발견한 QR 표시 오류

사용자가 설정 방법을 요청한 시점에는 비밀번호 저장이 끝나 MFA 등록 화면에 도달했으나 QR 이미지 대신 수동 키 안내만 표시됐고 코드 거절 메시지가 있었다. 설치된 `@supabase/auth-js`의 `GoTrueClient.ts`는 원본 SVG 앞에 `data:image/svg+xml;utf-8,`를 붙인다. UI는 `charset=utf-8` 형식만 인식하여 이 실제 응답 형식을 거절했다.

`authenticator-qr.ts`에서 SDK의 URI와 원본/인코딩된 SVG를 정규화하고, 색상의 `#` 등이 URL fragment로 잘리지 않도록 SVG payload를 인코딩했다. SVG는 계속 이미지로 표시하며 문서 HTML에 삽입하지 않는다. 잘못된 URI와 다른 미디어 형식은 수동 안내로 처리한다.

수정 검증: SDK 형식·색상/Unicode/퍼센트 문자 보존·기존 SVG 형식·비이미지/잘못된 URI를 다루는 회귀 시험 **3/3**, 관리자 전체 집중 검사 **67/67**, lint·typecheck·새 production build 통과. 전체 업무 **294/294**는 이 수정 전 실행 기록이며 수정 뒤 전체 297개를 다시 실행한 것으로 표시하지 않는다. 새 코드를 3002 앱에 반영하고 사용자의 비밀번호 설정 완료·MFA 미검증 상태가 유지되는 것을 확인했다. 새로운 QR의 실제 표시·스캔과 MFA 성공은 사용자가 설정 버튼을 누른 뒤 확인할 항목이다.

검사 로그: `/private/tmp/lk-staff-qr-tests.log`, `/private/tmp/lk-staff-qr-build.log`. 사용자의 실제 QR·설정 키·6자리 코드는 검증 파일에 보관하지 않는다.

## 후속 사용자 요청과 검증

사용자가 해당 휴대전화가 본인 기기가 아니라고 알려 이메일 코드를 선택했다. ESN 영구 비밀번호 저장은 완료됐으며 인증 앱 등록은 현재 필수 단계에서 제외한다. 기존 QR 수정은 TOTP 모드를 위한 코드로 보존한다.

이메일 검증 이후 업무·PDF·사진 읽기와 권한 경계를 실제 흐름으로 인수한 뒤 ESN-02 고객 통합 조회를 진행한다. 앱 첫 로그인이나 비밀번호 저장을 ESN-01 전체 인수로 표시하지 않는다. 최신 진행과 사용자 입력 안내는 [이메일 인증 기록](2026-10-04-staff-email-verification.md)을 따른다.

DNS·새 운영 배포·Google 결제·고객 자료·계약·예약·구매 데이터는 이번 계정 설정으로 변경하지 않았다. 진행표와 기존 TODO는 이 완료 수준으로 갱신한다.
