# Quote 리프레시 + EMS R2·R3a·R3b 운영 DB 적용 및 배포

2026-10-25 · Australia/Sydney · 사용자 요청: 업데이트 커밋, main 병합, EMS까지 전체 배포

운영 주소: https://www.lnkgroupsydney.com.au/quote/start

## 배포한 소스

| 항목 | 값 |
| --- | --- |
| Quote 리프레시 커밋 | `7f9ad42` ([검증 기록](2026-10-25-quote-ui-refresh.md)) |
| 통합 커밋(로컬 main `9eee824` 병합) | `4188c3fef31eee280bae0fcf37489add0c5510b3` |
| 출시 브랜치 | `release/quote-ems-20261025` (회사 GitHub `lnkgroupsydney-hub/lnkgroup`) |
| 운영 배포 | `dpl_Gu8Kk3TR3T9AR2h6D8j3vsz78DFV` · 도메인 자동 연결 없이 production 빌드(STAGED) 후 승격 |

통합 전 검증(lint·typecheck·단위 테스트 7종·build·EMS 게이트 4종·Quote 게이트 4종·시험 데이터 전체 흐름)은 [검증 기록의 main 통합 절](2026-10-25-quote-ui-refresh.md#main-통합-검증-2026-10-25)에 있다.

## 운영 DB 적용 (회사 Supabase `xlqyafthsxallostcqfe`, PostgreSQL 17.11)

접근: 사용자가 회사 계정으로 `supabase login`을 한 뒤 Supabase CLI `db query --linked`(Management API)로 실행했다. 과거처럼 CLI migration 이력을 repair하거나 기존 migration을 다시 실행하지 않았다.

**사전 점검(읽기 전용):** 현재 배포본(`5c42702`)의 migration이 만드는 테이블 51개가 모두 존재, 적용 대상 5개 migration의 객체는 0개 존재, `lk_` 테이블 RLS 비활성 0개. 견적 4·서명 접수 3·회사 예약 3·고객 0건. Management API에서 오류 시 명시적/묵시적 트랜잭션 모두 전체 롤백되는 것을 빈 시험 스키마로 확인했다(시험 스키마는 남지 않음). [db-preflight.json](2026-10-25-production-rollout/db-preflight.json)

**적용 묶음:** [ems-rollout.sql](2026-10-25-production-rollout/ems-rollout.sql) (SHA-256 `b94cd142a1b4a159b4d17ad7509520c86607a12dc9c1106c9cc41de33fb0c73c`). 아래 5개 migration의 원문에서 최상위 `begin;`/`commit;` 줄만 빼고 하나의 트랜잭션으로 묶었다.

1. `20261013032527_ems_customer_properties_crm.sql`
2. `20261020094056_ems_r3a_current_work_management.sql`
3. `20261020101429_ems_customer_resolve_revision_guard.sql`
4. `20261021090000_ems_r3b_staff_draft_validation.sql`
5. `20261021091000_ems_r3b_company_revisions.sql`

트랜잭션 안에서 모든 `lk_` 테이블을 쓰기 잠금(`share row exclusive`)하고 전체 행 해시·건수를 저장한 뒤 적용했다. 적용 후 기존 51개 테이블의 모든 행이 같아야만(이 migration이 추가한 열만 제외: `lk_customers.status/archived_at`, `lk_quote_requests.property_id/crm_revision`, `lk_live_company_bookings.company_revision_*` 4개) COMMIT되고, 다르거나 RLS가 꺼진 `lk_` 테이블이 있으면 예외로 전체 롤백된다. 적용 전 로컬 PGlite에서 현재 배포본 migration + 샘플 행으로 정상 적용과, 기존 행을 바꾸는 문장을 끼운 경우의 자동 롤백(새 테이블 미생성·샘플 불변)을 확인했다. [재현 스크립트](2026-10-25-production-rollout/verify-rollout-bundle.mjs)

**결과:** 09:59:21Z 시작, 7초 만에 COMMIT. 검증 블록 통과 = **기존 51개 테이블의 모든 행이 변경되지 않음.** 사후 점검: `lk_` 테이블 66개, RLS 비활성 0, 견적 4·서명 접수 3·회사 예약 3·고객 0건 유지, 새 명령 함수 4종의 anon/authenticated 실행 권한 0. [db-postflight.json](2026-10-25-production-rollout/db-postflight.json)

## 배포와 승격

출시 브랜치의 정확한 SHA로 `autoAssignCustomDomains:false` production 배포를 만들었다(회사 Git 연결 빌드). READY/STAGED 상태에서 회사 인증으로 `/quote/start`·`/admin`·`/` 200을 확인한 뒤 DB를 적용하고, COMMIT 약 20초 뒤 `vercel promote`로 승격했다(2초, 재빌드 없음). 운영 target이 `dpl_Gu8Kk3TR3T9AR2h6D8j3vsz78DFV`·SHA `4188c3f`임을 확인했다.

## 운영 확인

- www·apex의 `/quote/start`, `/`, `/services/cabinet-painting`, `/admin` 모두 200(apex는 www로 이동).
- 운영 www 새 익명 세션, 1280·390·320px: 진입 화면 H1·진입 사진 로드·`From A$1,450 · No GST charged`, 새 견적 1단계 열기, 입력 16px, 가로 넘침 0, `My quotes` 메뉴 3항목·Esc 닫기, 관리자 로그인 화면. **console/page 오류·HTTP 실패 0건.** 서버 쓰기 요청은 빈 세션 전환(`customer/logout`, `session`)뿐이며 고객 견적 저장·OTP·AI·예약·메일·Calendar 호출은 하지 않았다. 화면: [진입 390](2026-10-25-production-rollout/prod-entry-390.png) · [1단계 1280](2026-10-25-production-rollout/prod-details-1280.png) · [관리자 1280](2026-10-25-production-rollout/prod-admin-1280.png)
- 새 DB 기능 연결: 로그인 없는 `/api/quote/requests/company-revision`·`/booking`·`/api/admin/quote-requests`·`/enquiries`·`/customers`가 503이 아닌 401로 거절된다.
- 승격 후 20분간 해당 배포의 error 로그·5xx 응답 0건(지속 모니터링 아님).

## 수행하지 않은 것

실제 직원 계정으로 EMS 화면을 운영 데이터에서 조작하는 인수, 실제 고객 견적·OTP·메일·Calendar 발송, 실기기·스크린리더 확인. SQL migration 안의 고객 문구 `take-off`(일부 서버 오류 메시지)는 이번에 바꾸지 않았다.
