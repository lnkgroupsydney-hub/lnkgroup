# 실제 Quote 입력 → EMS 저장 기반 — 검증 기록

2026-10-08 · Australia/Sydney · `codex/live-quote-ems-foundation-20261008`

[37번 운영 전환 계획](../plans/37-live-quote-ems-booking-implementation.md)의 RQ-00~02 범위다. 기존 미커밋 변경을 보존한 새 브랜치에서 **실제 고객 연락처·서비스 저장과 EMS 조회, HTTPS 직원 접근 기반**을 구현했다. 회사 Supabase 적용과 회사 Chrome의 로컬 앱 저장·복원·EMS 왕복을 확인했다. 공개 Vercel 앱에 이번 코드를 배포하거나 실제 고객 계약·예약을 인수한 결과는 아니다.

## 구현 범위와 보호 조건

- 고객 요청은 새 `quotes` 모듈과 별도 `lk_quote_request` HttpOnly 쿠키를 사용한다. 고정 24시간의 작성 권한이며 이메일 소유권 인증을 뜻하지 않는다. 기존 데모·직원 쿠키를 운영 고객 권한으로 변환하지 않는다.
- 회사 시험 이메일과의 일치 조건 없이 실제 입력 이메일을 저장한다. 첫 저장 동의에 회사 시스템 저장·검토 목적을 표시하고 EMS에는 `In progress`로 노출한다. 서비스 저장과 명시적인 `Request company review` 명령을 구분한다.
- 검토 요청 후에는 `review_requested` 상태로 전환해 고객 수정을 잠근다. 같은 요청의 참조번호·revision·변경 이력은 유지한다. 임의 가격·승인·직원 행위자를 고객 입력에서 받지 않는다.
- 동일 이메일로 기존 고객 원장을 병합하거나 가짜 직원 권한으로 고객을 생성하지 않는다. EMS에는 이메일 미확인·자동 고객 연결 없음 상태를 표시한다.
- 최초 세션 발급은 브라우저 Web Locks로 직렬화한다. 미지원 환경은 쿠키 발급 전에 실패하며 다른 탭의 소유권을 교체하는 대체 경로를 사용하지 않는다.
- DB는 소유자별 잠금, 고정 만료, 멱등 응답 기록, revision 충돌 검사, 저장·감사 트랜잭션을 사용한다. 쓰기 제한은 정확히 같은 재시도 응답을 방해하지 않는다.
- `QUOTE_LIVE_ENABLED=false`는 신규 세션·저장·검토 요청을 중단한다. 유효한 기존 작성 권한의 조회와 인증된 직원의 목록·상세 조회는 유지한다.
- HTTPS 직원 접근은 설정된 정확한 origin·Host와 프록시 헤더를 검사하고 Secure·HttpOnly·SameSite 쿠키를 사용한다. 로컬 예외는 별도 정책이며 고객·기존 owner 쿠키로 직원 인증을 통과할 수 없다.
- `/quote/start`의 기본 실제 입력 화면과 `mode=demo`·기존 `quote` 선택자의 데모 경로를 구분한다. 이전 사진·서명·PDF를 실제 계약 자료로 재분류하지 않는다.

## 자동 검사와 빌드

| 검사 | 확인 결과 | 범위·근거 |
| --- | --- | --- |
| 전체 `npm run test:operations` | **420/420 통과** | 업무 회귀·권한·DB·클라이언트 경계 검사 |
| 관련 추가 검사 | **20/20 통과** | 전체 420개 실행 이후 fixture 호스트 격리 검사를 추가하고 `npm run test:live-quotes` 재실행. API/SQL·응답 파서·세션 bootstrap·fixture 경계. 전체 검사 수와 합산하지 않음 |
| HTTPS 직원 인증 관련 검사 | **66개 통과** | 합성 Auth·저장소·OAuth 응답. 실제 Vercel 직원 로그인 검증과 구분 |
| 격리 lint·타입 생성/검사·production 빌드 | **통과** | `/tmp/lk-rq01-build-21R5aZ`에서 실행 중인 앱과 분리 |
| 신규 Next API route 타입 | 오류 수정 후 통과 | 핸들러의 두 번째 인수와 Next route context가 맞지 않던 문제를 명시적인 route wrapper로 수정 |

주요 테스트 소스:

- `src/modules/quotes/requests.test.mts`: 실제 migration을 사용한 소유권·회사 분리·재시도·revision·검토 상태·만료·동의·RLS/권한·검색·쓰기 제한·기능 중단 시 조회 보존·NextRequest 주소 정규화.
- `src/modules/quotes/presentation/request-client.test.mts`: 저장 응답의 기본 계약, 두 탭의 최초 세션 발급 직렬화, 잠금 미지원 시 발급 전 차단.
- `src/modules/admin-access/staff-auth.test.mts`: 고정 HTTPS origin, Secure 쿠키·갱신/종료, 권한 회수, 다른 세션 종류 배제, 회사 OAuth 세션 귀속.
- `scripts/verify-live-quote-fixture.test.mjs`와 `scripts/verify-live-quote-fixture.mjs`: 합성 API·응답 유실/충돌/만료 시나리오와 실제 회사 API로 전달되지 않는 fixture 경계. fixture 자동 검사 통과를 브라우저 시나리오 실행 완료로 간주하지 않는다.

DB 경합 자동 검사는 PGlite에서 실행했다. 실제 PostgreSQL의 독립 연결 간 동시 실행을 검증한 것으로 확대하지 않는다. 코드 리뷰에서는 origin/Host, 초기 세션 경합, 기능 중단 시 기존 조회 보존 문제를 보완한 뒤 추가 보안·저장 무결성 차단 문제를 발견하지 못했다. 읽기 코드 리뷰와 실행 검사는 별개 증거다.

## 회사 Supabase 적용과 접근 검사

- 회사 Chrome 프로필의 `lnkgroupsydney@gmail.com`을 확인했다. 개인 프로필이나 IAB를 사용하지 않았다.
- 회사 프로젝트 `xlqyafthsxallostcqfe`의 SQL Editor에서 `supabase/migrations/20261008104249_live_quote_requests.sql` 적용 성공을 확인했다. 연결된 MCP/CLI 프로필은 회사 프로젝트 접근이 되지 않아 회사 Dashboard를 사용했다. CLI migration 이력을 정리했다고 보고하지 않는다.
- 추가한 여섯 테이블은 `lk_quote_requests`, `lk_quote_request_audit`, `lk_quote_request_access`, `lk_terms_versions`, `lk_quote_versions`, `lk_quote_acceptances`다. 기존 데모 테이블을 교체하지 않는 추가 migration이다.
- SQL 조회로 여섯 테이블의 RLS가 모두 활성화되고 anon/authenticated 접근 권한이 없음을 확인했다.
- 서비스 역할의 제한된 읽기·익명 접근·RPC 권한 등 **14개 연결 검사**를 통과했다. 초기 0행 조회 성공은 이후 UI에서 생성한 검증 요청의 저장 결과와 구분한다.
- 발행 견적·약관·서명·검증된 고객 접근 테이블은 후속 기능을 위한 기반이며 이번에 가격·약관·서명 데이터를 생성하거나 해당 명령을 활성화하지 않았다.

기존 초안 **8건**, 데모 제출 **5건**, 사진 **5건**, 고객 원장 **0건**의 작업 전후 JSON fingerprint를 대조해 네 테이블 모두 일치함을 확인했다. 새 가상 검증 요청 1건은 별도 실제 요청 테이블에 남아 있으며 고객 원장 자동 생성/병합은 없다.

## 실제 회사 Chrome 인수 — 로컬 앱과 회사 DB

검증을 통과한 빌드를 로컬 3002 앱에 반영하고 로컬 `QUOTE_LIVE_ENABLED=true`를 설정했다. 회사 Chrome에서 실제 UI를 사용했으며 저장소는 회사 Supabase다. 실사용 고객 개인정보를 대신 입력한 시험이 아니다.

| 항목 | 확인 내용 |
| --- | --- |
| 가상 검증 이름 | `RQ01 Verification - not a customer` |
| 가상 검증 이메일 | `rq01-verification@example.invalid` |
| 실제 요청 ID | `5da33571-3325-499f-b02f-853516ee883c` |
| 참조번호 | `RQ-5DA335713325499FB02F853516EE883C` |
| 서비스 수량 | Cabinet doors 8, drawer fronts 3 |

1. 회사 주소가 아닌 위 가상 이메일로 고객 정보를 저장했다. 실제 요청이 만들어졌으며 회사 시험 이메일로 바꾸도록 요구하지 않았다.
2. 서비스 상세·수량을 같은 요청에 저장하고 새로고침 후 복원했다.
3. EMS의 Quote requests에서 동일 ID·payload·**revision 2**와 저장 이력 **revision 1, 2**를 확인했다.
4. 고객 화면에서 검토 요청을 실행해 **revision 3 / 읽기 전용**으로 바뀌는 것을 확인했다.
5. EMS 새로고침에서 같은 요청의 **Review requested** 상태를 확인했다.

이 검증은 연락처·서비스의 회사 검토 요청이다. 실제 작업 계약, 고객 이메일 발송, 가격 확정, Calendar 일정 생성이나 예약 확정을 요청하지 않았다. 해당 성공 화면으로 표시하지도 않는다.

## 합성 브라우저 복구·화면 검사

회사 Chrome의 별도 `localhost:3014` fixture에서 실제 화면과 요청 핸들러/SQL을 사용했다. 회사 앱 `127.0.0.1:3002`와 쿠키 호스트를 분리하고 회사 API로 쓰기·인증 헤더가 전달되지 않게 했다. 회사 데이터와 Google/메일에 영향을 주지 않는 합성 자료다.

- 저장은 성공했지만 503 응답을 반환하는 시험: 입력 유지·편집 잠금·`Retry same save` 표시 → 같은 idempotency key로 재시도 → 서비스 단계. DB 요청 1건/감사 1건으로 중복 없음 확인.
- 409 충돌 시험: 선택한 intent/표면·입력 수량 4 보존, 최신 내용 불러오기 전에 복사 안내, `Load latest saved details` 후 실제 저장본 복원.
- 고객 401 시험: 작성 권한 만료/복구 제한 안내, 저장 재시도·편집 차단. 24시간 자연 만료를 기다린 시험과 구분한다.
- EMS 403 시험: 요청 목록을 제거하고 직원 로그인 화면으로 복귀. fixture 인증 복원 후 새로고침으로 목록 복원 확인.
- 390px 상단 진행 안내, 320px 연락처/서비스 입력·세로 배치/버튼을 Chrome 에뮬레이션으로 확인했다. Tab으로 이름→이메일 이동과 명확한 포커스 테두리를 확인했다. 실제 휴대폰 터치 인수는 미실행.
- Console의 503/409/401은 주입한 실패와 일치했다. 정상 복원 페이지에서 JavaScript 오류는 보이지 않았으며 기존 폰트 preload 미사용 경고 1건은 남아 있다. 모든 경고가 0이라고 보고하지 않는다.
- 회사 Supabase Security Advisor 화면 진입 후 Mac이 잠겨 최종 결과를 읽지 못했다. Advisor 결과는 미확인으로 남기며 앞서 완료한 SQL RLS·권한 검사와 구분한다.

## 남은 범위와 배포 상태

고객 이메일은 미검증이며 브라우저 작성 권한은 최대 24시간이다. 다른 기기·만료 후 이메일 복구는 RQ-05, 실제 사진은 RQ-03, 회사의 금액 작성/발행은 RQ-04 이후 작업이다. 약관·고객 승인/서명·문서/메일·일정 선택·회사 예약 확정·Google 운영 동기화도 이번 RQ-00~02 완료 범위에 포함하지 않는다.

`https://lnkgroup.vercel.app`에는 이전 배포가 유지된다. 이번 변경의 실제 HTTPS 직원 로그인·환경 변수·배포 검증은 미실행이다. Vercel 환경이나 배포 설정, 회사 Google 설정을 변경하지 않았다. 커밋·병합·푸시도 수행하지 않았다.
