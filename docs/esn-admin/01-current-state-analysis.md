# ESN 관리자 시스템 — 현재 구현 분석

작성일: **2026-10-04 · Australia/Sydney**

조사 기준: `main`의 `9ec6f6e` · 기획 브랜치: `codex/esn-admin-planning`

범위: 저장소 소스·SQL·기존 계획·검증 기록의 읽기 전용 검토. **이번에는 앱 실행, 자동 테스트, 브라우저 테스트, 원격 DB/Google 연결 검증을 수행하지 않았다.**

[기획 개요](README.md) · [분리 구조](02-separation-architecture.md) · [데이터와 권한](03-data-and-access.md) · [단계와 완료 기준](04-roadmap-and-acceptance.md) · [진행표](05-progress.md)

## 1. 분석 결론

현재 저장소에는 공개 사이트와 같은 Next.js 앱 안의 `/admin`, 문의·Gmail·Google Calendar 관리, 회사 전용 견적·서명·예약 데모, 비공개 사진 저장 기반이 있다. 이것을 ESN의 출발점으로 재사용할 수 있지만, **전체 고객 기록·실제 계약·구매·결제·재고·인보이스를 통합 관리하는 운영 시스템은 아직 구현되지 않았다.**

현재 고객 연락처는 문의·초안·서명 제출에 각각 들어 있으며 독립 고객 마스터가 없다. 관리자 로그인도 운영 직원 초대·역할·MFA가 아닌 로컬 owner/허용 회사 Google 계정과 커스텀 세션을 사용한다. 따라서 기존 `/admin` 화면을 새 주소에 연결하는 것만으로 요청한 관리자 전용 ESN이 완성되지는 않는다.

추천안은 기존 지침에 맞춰 **단일 Next.js 앱과 동일 업무 DB에서 관리자 모듈·라우트·인증을 먼저 분리**하는 것이다. 회사 도메인이 확인된 뒤 `admin.<회사도메인>` 호스트 분리를 검토하며, 이는 런타임 격리를 뜻하지 않는다. 독립 배포가 필요해지면 `apps/site`·`apps/admin`과 공용 패키지로 단계적으로 전환한다. 이 선택은 분석에 따른 **추천안이며 사용자 확정 사항이 아니다.** 실제 주소와 배포 범위는 [분리 구조](02-separation-architecture.md)의 결정 항목을 따른다.

## 2. 기능별 현재 상태

아래의 ‘과거 검증’은 링크된 기록에 남아 있는 결과다. 이번 분석에서 재실행한 결과가 아니며, 코드가 존재한다는 사실만으로 운영 준비가 끝났다고 판단하지 않는다.

| 영역 | 소스에서 확인한 구현 | 과거 실제 검증 기록 | 미구현·잔여 또는 이번 미실행 |
| --- | --- | --- | --- |
| 공개/관리 화면 | [`src/app/admin/page.tsx`](../../src/app/admin/page.tsx)가 [`OperationsConsole`](../../src/modules/operations/presentation/operations-console.tsx)을 조립. 공개 사이트와 같은 앱이며 관리자 화면은 `noindex` | [9월 30일 문의·Calendar](../verification/2026-09-30-gmail-calendar.md), [10월 3일 관리자 예약](../verification/2026-10-03-admin-booking-confirmation.md)에 실제 화면 확인 기록 | 독립 ESN 화면/호스트/배포 없음. `noindex`는 인증이 아님. 이번 화면 재확인 미실행 |
| 관리자 로그인 | [`auth.ts`](../../src/modules/operations/infrastructure/auth.ts), [`supabase-auth.ts`](../../src/modules/operations/infrastructure/supabase-auth.ts): 로컬 owner 비밀번호, 허용 회사 Google 계정 확인, 해시 세션·OAuth 상태/PKCE·토큰 암호화 | [10월 1일 OAuth](../verification/2026-10-01-google-oauth-live.md), [10월 3일 관리자 로그인·검토](../verification/2026-10-03-admin-booking-confirmation.md) | 운영 관리자 초대·membership·역할·MFA·계정 회수 미구현. 이번 로그인/세션 회수 검사 미실행 |
| 문의/Gmail | [`operations`](../../src/modules/operations/), [`gmail-intake`](../../src/modules/gmail-intake/): 문의 생성·목록/상세·잠정 일정·Gmail 수집/대화 병합·외부 일정 검토 | [10월 1일 실제 왕복](../verification/2026-10-01-google-oauth-live.md), [10월 2일 worker 복구](../verification/2026-10-02-google-recovery.md) | Gmail 발신자 검토와 고객 마스터 연결은 별도. 운영 대상 전환·일부 복구 검증은 해당 기록의 잔여 조건을 따름 |
| 고객 연락처/초안 | [`quote-draft.ts`](../../src/modules/enquiries/domain/quote-draft.ts), [`quote-draft-api.ts`](../../src/modules/enquiries/infrastructure/quote-draft-api.ts): 연락처·주소·서비스 초안 저장/복원, revision 충돌, 비공개 작성 쿠키 | [10월 2일 저장·복원·타 세션 분리](../verification/2026-10-02-google-recovery.md) | 독립 고객 마스터·중복 후보 검토·고객별 전체 거래 타임라인 없음. 작성 쿠키는 고객 신원 인증이 아님 |
| 계약/견적/서명 | [`demo-submission.ts`](../../src/modules/enquiries/domain/demo-submission.ts), [`demo-api.ts`](../../src/modules/enquiries/infrastructure/demo-api.ts), [`demo-pdf.ts`](../../src/modules/enquiries/infrastructure/demo-pdf.ts): 데모 금액·약관, 서명, 불변 제출/hash, PDF 생성·비공개 다운로드 | [10월 3일 원본·재서명·PDF](../verification/2026-10-03-admin-booking-confirmation.md), [10월 4일 사진 포함 제출·PDF 바이트](../verification/2026-10-04-private-photos-mobile-booking.md) | 실제 계약/가격표/약관·운영 고객 인증 없음. 기존 자료는 명시적인 `mode: demo`이며 실제 거래로 전환하지 않음 |
| 예약/회사 확정 | [`confirm.ts`](../../src/modules/bookings/application/confirm.ts), [`bookings API`](../../src/modules/bookings/infrastructure/api.ts): 작업 구간 제안·재서명·전체 충돌 검사·회사 확정·Google 변경 검토 | [10월 3일 제안→서명→확정→Google 이동→재확정](../verification/2026-10-03-admin-booking-confirmation.md), [10월 4일 별도 작성 세션의 날짜 선택 차단](../verification/2026-10-04-private-photos-mobile-booking.md) | 단일 시험 자원 `demo-single-resource` 기반. 운영 인력/장비·근무시간·기간·취소/재예약 정책 미구현. 운영 예약 완료로 보지 않음 |
| 사진/문서 | [`quote-photo-api.ts`](../../src/modules/enquiries/infrastructure/quote-photo-api.ts), [`quote-photo-storage.ts`](../../src/modules/enquiries/infrastructure/quote-photo-storage.ts): 비공개 사진 저장·권한 조회·해시·삭제 재시도·제출 manifest. 서명 문서는 고정된 발송 payload 사용 | [10월 4일 실제 Storage·권한·관리자 API·메일/PDF](../verification/2026-10-04-private-photos-mobile-booking.md) | 기록상 관리자 재로그인 후 사진 썸네일 화면, 실제 휴대폰 서명, 일부 사진 재서명/시각적 PDF 대조는 잔여. 운영 보관/삭제 정책·범용 파일함 없음 |
| 구매/주문/재고 | 소스 모듈과 migration에 주문·재고 업무 구현 없음 | 실제 구매 검증 기록 없음 | [쇼핑몰·재고 계획](../plans/06-commerce-and-inventory.md)의 후속 범위. 고객 상품 구매와 회사 자재 구매를 같은 개념으로 가정하지 않음 |
| 결제/인보이스/입금 | 소스 모듈과 migration에 실제 결제·인보이스·입금 배분 구현 없음 | 실제 결제/청구 검증 기록 없음 | [KCP P7](../plans/25-kcp-quote-to-booking-implementation.md), [Calendar·청구 정책](../plans/27-kcp-google-calendar-sync.md)에 계획만 존재. 데모 PDF는 인보이스가 아님 |
| 관리자 감사/보고 | proposal actor hash, revision, 생성 시각·동기화 상태 일부 존재 | 개별 예약·전송 이력 보존은 기존 검증에 기록 | 통합 감사 로그, 관리자별 접근/다운로드 추적, 매출·미수금 보고 미구현 |

## 3. 현재 저장 구조와 권한 경계

소스에는 아래 **migration 7개·업무 테이블 22개**가 있다. 이는 파일 기준의 집계다. 원격 스키마 최신 상태를 이번에 조회한 것은 아니다.

| migration | 추가/변경 대상 | 분석 의미 |
| --- | --- | --- |
| [20261001100420](../../supabase/migrations/20261001100420_operations_supabase.sql) | 문의, 세션, OAuth state, Google 연결, Calendar link/outbox/change, Gmail seen/thread/quarantine, sync lease, rate bucket — 12개 | 문의·연동·커스텀 관리자 세션 기반 |
| [20261002100953](../../supabase/migrations/20261002100953_google_connection_health.sql) | Google 연결 health·복구 명령, 신규 테이블 없음 | 인증/연동 장애를 업무 상태와 구분 |
| [20261002101142](../../supabase/migrations/20261002101142_customer_quote_drafts.sql) | `lk_quote_drafts` — 1개 | 고객 마스터가 아닌 작성 세션별 연락처/서비스 초안 |
| [20261002113243](../../supabase/migrations/20261002113243_demo_quote_submissions.sql) | `lk_quote_submissions` — 1개 | 불변 데모 제출·서명·메일 전송 상태 |
| [20261003111254](../../supabase/migrations/20261003111254_admin_booking_confirmation.sql) | bookings, proposals, segments, booking outbox — 4개 | 단일 시험 자원의 예약 제안/동의/점유 |
| [20261003111541](../../supabase/migrations/20261003111541_booking_calendar_sync.sql) | booking Calendar links, retire intents, changes — 3개 | 외부 일정과 원본 증거·점유의 단계적 동기화 |
| [20261004003752](../../supabase/migrations/20261004003752_private_quote_photos.sql) | `lk_quote_photos` — 1개, 제출 명령 보강 | 비공개 사진 상태·객체 참조·제출 manifest |

업무 테이블은 RLS를 활성화하고 anon/authenticated 역할의 직접 접근을 차단하며 서버 service role과 RPC를 사용한다. [서버 클라이언트](../../src/modules/operations/infrastructure/supabase-client.ts)는 브라우저 사용을 막고 응답 캐시를 끈다. 이 구조에서 **인증한 일반 사용자가 곧바로 관리자라는 뜻은 아니며**, 앞으로 도입할 관리자 인가를 모든 읽기/쓰기/문서/사진 API에 적용해야 한다.

[`router.ts`](../../src/modules/operations/router.ts)는 `OPERATIONS_STORE`로 SQLite 또는 Supabase를 선택한다. SQLite는 격리 로컬 문의·연동 검증 경로이며, 최신 초안·예약·사진 기능 전체를 대체하는 독립 ESN DB가 아니다. Supabase 장애 시 자동으로 SQLite에 쓰는 방식으로 변경하지 않는다.

[10월 4일 검증 기록](../verification/2026-10-04-private-photos-mobile-booking.md)에 회사 DB 22개 테이블·사진 권한·private JPEG 버킷 적용과 자동 검사 229/229·lint·타입·빌드 통과가 기록돼 있다. 이는 **과거 구현 검증 기준점**이다. [10월 3일 기록](../verification/2026-10-03-admin-booking-confirmation.md)의 CLI migration 이력 대조/repair 잔여 항목도 유지하며, 이번 기획 과정에서 원격 SQL이나 이력을 수정하지 않는다.

## 4. 고객 통합 전에 해결할 신원·연결 문제

| 현재 출처 | 지금 확인 가능한 사실 | 자동으로 확정하면 안 되는 것 | ESN에서 필요한 처리 |
| --- | --- | --- | --- |
| 웹 문의 | 사용자가 제출한 연락처·주소·문의 내용 | 입력 이메일/전화 소유권, 기존 고객과 동일인 여부 | 출처·검증 수준을 보존하고 관리자가 고객 연결 후보를 확인 |
| Gmail | 회사가 받은 message/thread와 헤더·본문, 수집 이력 | From이 실제 고객 신원이라는 판단, 이메일 일치만으로 고객 병합 | 발신자 검토 상태와 원본 수집 식별자 유지. [candidate](../../src/modules/gmail-intake/domain/enquiry-candidate.ts), [reader](../../src/modules/gmail-intake/infrastructure/gmail-reader.ts) 경계 재사용 |
| 견적 초안/데모 제출 | 해당 비공개 작성 쿠키가 소유한 초안·서명 snapshot | 실명 확인, 이메일 인증, 같은 사람의 다른 기기/세션 자동 연결 | 신원과 작성 권한을 분리. 원본 증거를 바꾸지 않는 고객 연결 관계 추가 |
| 향후 구매/결제 | 아직 구현 없음 | 같은 이메일의 주문이 기존 고객 소유라는 가정, 결제 페이지 복귀만으로 결제 완료 | 운영 인증/검증된 거래 이벤트 정책에 따라 연결하고 병합 이력 기록 |

독립 고객 마스터를 도입해도 서명·주문·인보이스의 거래 시점 이름·주소·조건은 그대로 보존한다. 고객 프로필을 수정하거나 중복 고객을 병합하는 작업이 과거 snapshot을 덮어쓰지 않아야 한다. 기존 문의·제출 ID를 버리지 않고 원천 자료와 고객의 관계를 명시적으로 추가하는 설계가 필요하다.

## 5. 분리 개발 시 바뀌는 기술 경계

| 현재 지점 | 소스 근거 | 분리 시 고려 사항 |
| --- | --- | --- |
| 관리자 서버 인가 | [`operations/access.ts`](../../src/modules/operations/access.ts), [`supabase-auth.ts`](../../src/modules/operations/infrastructure/supabase-auth.ts), [예약 API](../../src/modules/bookings/infrastructure/api.ts), [사진 API](../../src/modules/enquiries/infrastructure/quote-photo-api.ts) | 공통 관리자 인가 진입점을 두되 각 서버 기능에서도 검증. 공개 페이지에서 admin UI를 숨기는 것만으로 보호하지 않음 |
| Supabase SSR proxy | [`src/proxy.ts`](../../src/proxy.ts), [`middleware.ts`](../../src/utils/supabase/middleware.ts) | 현재 `getClaims()` 호출은 세션 갱신 기반이며 운영 관리자 role/MFA 보호가 아님 |
| 단일 `APP_BASE_URL` | [`auth.ts`](../../src/modules/operations/infrastructure/auth.ts), [`server-api.ts`](../../src/modules/operations/server-api.ts), [`quote-draft-api.ts`](../../src/modules/enquiries/infrastructure/quote-draft-api.ts) | Google callback/관리자 복귀/고객 작성 origin을 목적별로 정리. 고객·관리 호스트 간 무조건적인 CORS 허용이나 쿠키 공유를 만들지 않음 |
| 쿠키 | 관리자 `lk_ops_session`: Path=/, 12시간. 고객 `lk_quote_draft`: Path=/api/quote, 24시간 | 현재 Domain 속성 없는 호스트별 쿠키 경계를 보존하며 이전 계획 작성. 공통 도메인 쿠키로 넓히는 것을 기본안으로 삼지 않음 |
| loopback 제한 | [`localEnabled`](../../src/modules/operations/infrastructure/local-db.ts), [`demoEnabled`](../../src/modules/enquiries/infrastructure/demo-api.ts) | 로컬 인증·데모는 loopback 조건에 의존. 제한 삭제만으로 운영 전환하지 않으며 운영 인증/인가와 데모·실거래 분리를 먼저 구현 |
| 서버/브라우저 진입점 | [`bookings/client.ts`](../../src/modules/bookings/client.ts), [`bookings/server.ts`](../../src/modules/bookings/server.ts), [`modules README`](../../src/modules/README.md) | 서버 코드·키·PDF/DB 구현이 브라우저 import graph에 들어오지 않게 공개 진입점 유지. 과거 빌드 오류와 수리 기록은 [10월 3일 검증](../verification/2026-10-03-admin-booking-confirmation.md) 참조 |
| 공용 업무·worker | [`integrations-worker.mjs`](../../scripts/integrations-worker.mjs), [예약 Calendar](../../src/modules/bookings/calendar.ts), [operations router](../../src/modules/operations/router.ts) | DB·migration 원본, outbox·lease·재시도 처리 책임을 하나로 유지. 두 앱/호스트를 위해 worker와 데이터를 복제하지 않음 |

관리자 하위 호스트는 접속 주소와 화면 경계를 분리하지만 동일 앱·DB 서비스 권한을 사용하는 동안 배포·프로세스·서버 비밀의 격리는 제공하지 않는다. 독립 배포가 필요하면 비용·공유 패키지·권한·worker·운영 책임을 재검토한다.

## 6. 재사용하면서 보존할 업무 규칙

| 업무 규칙 | 기존 근거 | ESN 확장 원칙 |
| --- | --- | --- |
| 서명된 조건은 불변 | [제출 migration](../../supabase/migrations/20261002113243_demo_quote_submissions.sql), [사진 migration](../../supabase/migrations/20261004003752_private_quote_photos.sql) | 범위·가격·약관·사진·일정 변경은 새 버전과 필요한 재동의/서명으로 처리. 고객 프로필 변경으로 원본을 갱신하지 않음 |
| 동시에 저장한 변경 충돌 표시 | [초안 application](../../src/modules/enquiries/application/quote-drafts.ts), [예약 SQL](../../supabase/migrations/20261003111254_admin_booking_confirmation.sql) | revision과 idempotency 검증을 관리 화면에서도 유지 |
| 동의·메일 수락·회사 확정 분리 | [`confirm.ts`](../../src/modules/bookings/application/confirm.ts), [예약 API](../../src/modules/bookings/infrastructure/api.ts) | 고객 요청/서명과 회사 예약 확정을 구분. 제공자 수락은 실제 배달 완료와 별도로 표시 |
| 전체 구간 점유/충돌 검사 | [예약 SQL](../../supabase/migrations/20261003111254_admin_booking_confirmation.sql) | 원자적 점유·DB 제약을 재사용하되 단일 시험 자원을 운영 인력 정책으로 복사하지 않음 |
| Google 수정이 곧 승인 아님 | [동기화 SQL](../../supabase/migrations/20261003111541_booking_calendar_sync.sql), [Calendar 구현](../../src/modules/bookings/calendar.ts) | 외부 이동/삭제는 재검토 대상. 새 일정 검증 전 기존 점유·증거 유지 |
| 사진·문서 비공개 | [사진 API](../../src/modules/enquiries/infrastructure/quote-photo-api.ts), [사진 Storage](../../src/modules/enquiries/infrastructure/quote-photo-storage.ts), [문서 다운로드](../../src/modules/bookings/infrastructure/api.ts) | 인증된 API·소유/관리자 검사·`private, no-store` 유지. 공개 파일 URL·공용 캐시 금지 |
| 실패·재시도에서 중복 방지 | submission/proposal idempotency, outbox, lease, 고정 발송 payload | 호스트/앱 분리 후에도 같은 업무키와 원본 데이터 사용. 새 시스템에 복사했다는 이유로 메일/일정을 재생성하지 않음 |
| 청구·결제·재고 원장 | [기존 데이터 계획](../plans/04-data-model-and-access.md), [청구 정책](../plans/27-kcp-google-calendar-sync.md) | 현재는 계획 단계. 실제 Complete 후 최종 인보이스 1회 발행·실제 발행일 +3 달력일 납기(Sydney), 결제/환불/배분 한도·재고 이동 원장 규칙을 구현 단계에서 검증 |

## 7. 문서 정합성과 남은 확인

조사 시 [`src/modules/README.md`](../../src/modules/README.md)의 마지막 문단은 DB·외부 어댑터·폼·예약이 없고 Free Quote가 비활성이라고 설명했다. 이번 기획 문서 정리에서 해당 문단을 현재 문의·예약·사진·운영 모듈과 미구현 업무의 구분으로 갱신했다. 기존 TODO의 계획 상태와 최신 검증 기록이 섞이지 않도록 [진행표](05-progress.md)에서 분리한다.

이번 분석으로 완료할 수 있는 것은 현재 상태 목록과 분리 영향 파악이다. 다음은 완료로 표시하지 않는다.

- 관리자 운영 인증·고객 마스터·통합 고객 조회·실제 계약·구매·청구/결제 구현.
- 운영 도메인·관리자 호스트 확정, Vercel 배포, 운영 상시 worker 구성.
- 실제 휴대폰 서명·사진 관리자 화면 등 기존 검증 기록의 잔여 시험.
- 이번 기획 변경 이후의 타입·lint·빌드·앱/브라우저·원격 DB/외부 연동 검증.

실제 구현 착수 전 회사 도메인·관리자 범위·‘구매’의 업무 의미·운영 데이터/데모 데이터 분리와 기존 migration 이력을 확인한다. 확인되지 않은 사업 정책·가격·도메인·외부 서비스 승인은 계획 가정으로 남긴다.
