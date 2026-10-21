# 11 다음 워크트리 인계 — R2·R3a 이후

작성: 2026-10-21 · Australia/Sydney

R2 마무리와 R3a를 로컬 `main`에 병합했다. 다음 작업은 새 워크트리에서 이 문서부터 읽고 시작한다. 실행 증거는 [검증 기록](../verification/2026-10-21-ems-r2-r3a-resume.md)에 있다.

## 현재 상태

| 단위 | 상태 |
| --- | --- |
| R1 공통 화면 | 코드·합성 브라우저 인수 완료 |
| R2 고객 중복/복수 현장/견적 CRM 연결 | 코드·합성 브라우저 20/20 완료. 회사 DB 적용·실제 인수는 미실행 |
| R3a 문의·직원 초안·단순 예약 CRUD/취소 | 코드·합성 브라우저 11/11 완료. 회사 DB 적용·실제 Google 삭제 인수는 미실행 |
| R3b 이후 | 미착수 |

- **회사 Supabase에 적용하지 않은 migration이 있다.** 운영에 배포하기 전에 회사 승인을 받고 순서대로 적용한다.
  1. `supabase/migrations/20261020094056_ems_r3a_current_work_management.sql`
  2. `supabase/migrations/20261020101429_ems_customer_resolve_revision_guard.sql`
- **배포 순서 조건:** `src/app/api/admin/quote-requests/route.ts`가 새 RPC `quote_list`를 쓴다. migration 1을 적용하기 전에 이 코드를 배포하면 기존 견적·문의 목록이 503이 된다. 반드시 migration 2개를 먼저 적용하거나, 배포와 같은 시점에 적용한다.
- 원격 `origin`에 push하지 않았고 Vercel 배포도 하지 않았다.

## 새 워크트리 시작

```sh
cd "/Users/jimee/Desktop/L&K Group"
git worktree add ../lk-<작업명> -b <브랜치명> main
cd ../lk-<작업명>
npm ci                                # Node 24.14.1 / npm 11.11.0
npm run test:operations               # 기준 903/903
npm run lint && npm run typecheck
```

- `.env*`·`.claude/settings.local.json`·비공개 백업은 Git에 없다. 필요하면 원본 폴더에서 복사한다.
- 같은 폴더에서 `next dev`와 `next build`를 동시에 돌리지 않는다. 공유 `.next`가 덮어써져 거짓 실패가 난다. 브라우저 검사용 build는 별도 복사본에서 한다.
- 합성 브라우저 검사 (실제 Chrome, Playwright 경로 지정):

```sh
STAFF_ADMIN_AUTH_ENABLED=true APP_BASE_URL=http://127.0.0.1:3063 npm run check
STAFF_ADMIN_AUTH_ENABLED=true APP_BASE_URL=http://127.0.0.1:3063 npx next start --hostname 127.0.0.1 --port 3064 &
EMS_FIXTURE_PORT=3063 EMS_FIXTURE_UPSTREAM=http://127.0.0.1:3064 node --experimental-strip-types scripts/verify-esn-ui-fixture.mjs &
PW=/Users/jimee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs
node scripts/verify-ems-r3a-ui.mjs --base http://127.0.0.1:3063 --playwright $PW --channel chrome   # 11/11
node scripts/verify-ems-r1.mjs     --base http://127.0.0.1:3063 --playwright $PW --channel chrome   # 13/13
node scripts/verify-ems-r2.mjs     --base http://127.0.0.1:3063 --playwright $PW --channel chrome   # 20/20
```

각 검사 사이에 `POST /__fixture/control {"reset":true}`로 fixture를 초기화한다.

## 결정 필요 — 현재는 보수적 기본값으로 구현

| 항목 | 현재 동작 | 정해야 할 것 |
| --- | --- | --- |
| 취소 고객 통지 | 메일·Calendar 참석자 통지 없음. 직원이 별도로 연락 | 문구·시점·채널 |
| 확정 후 일정 변경 | 확정본의 날짜·금액은 바꾸지 않음. 미확정 draft만 수정 | 새 일정 제안·고객 동의·점유 교체 절차 |
| 취소 가능 조건 | 확정 완료 + 일정 manifest 완전 + 확정 메일 처리 완료 | 확정 중·메일 결과 불명·legacy v1의 취소 절차 |
| 외부에서 바뀐 Google 일정 | `review_required`. 점유 유지, 자동 강제 삭제 없음 | 회사 검토 승인 절차 |
| 권한을 잃은 뒤의 취소 명령 | 원래 명령을 재실행하지 않음 | 다른 직원에게 인계하는 UI·정책 |
| 고객 취소 요청·환불 | 없음. 직원 명령만 처리 | 정식 계약·금융 정책 |
| 직원 견적 초안 | 효력 없는 내부 작업본. 발행·가격 변경 없음 | R3b의 회사 가격·문서 버전·고객 재확인 |
| 담당자 범위 | 기존 admin/owner 직원만 | 현장 직원 역할·배정 권한 |
| 보관·메모·초안 보존 기간 | 삭제 없음 | 개인정보 보존·영구 삭제 정책 |
| 직원 초안 첫 저장 | 고객 원본에 현재 검증 기준에 맞지 않는 값이 있으면 저장이 막힘 | 그대로 둘지, 첫 저장에서 교정하도록 할지 |

## 다음 작업 후보 (10번 계획 순서)

1. **회사 적용과 실제 인수 (R2·R3a)**
   - 회사 승인 후 진행한다. 순서는 migration 2개 적용 → 배포 → 실제 직원 로그인으로 문의·초안·예약 취소.
   - 취소는 Google 일정 실제 삭제·GET 확인과 점유 해제까지 대조한다.
2. **R3b 견적/문서 변경**
   - 현장 수량·추가 항목·회사 금액 버전, 변경 비교, 고객 재확인, 계약 초안·서명 관계.
   - 위 "직원 견적 초안" 결정이 먼저 필요하다.
3. **R4 Overview·검색**
   - 전체 집계 API, 4 KPI·그래프·오늘 일정·주의 큐·드릴다운, 전역 검색.
4. **남은 정리**
   - 범위 밖 화면의 라벨 감싸기 3곳: `customer-booking-review.tsx`, `booking-operations-panel.tsx`, `live-customer-proposal.tsx`
   - 목록 화면의 첫 Tab 순서
   - 초안 저장 후 Booking confirm, 고객 화면 취소 문구의 브라우저 확인
5. **integrator 권장 사항** (차단 아님, 2026-10-21 통합 검토)
   - **취소 재처리 주기:** `processSimpleBookingCancellation()`은 하루 1회 cron(`0 3 * * *`)에 1건만 처리한다. 재시도 상태인 취소는 하루 이상 점유를 유지할 수 있다. 시간 예산 안에서 여러 건을 반복 처리하도록 바꾸고, 화면 문구 "retries automatically in the background"를 실제 주기에 맞춘다.
   - **422 `fields`:** 실제 서버의 `workApiBoundary`는 `fields`를 보내지 않는다. 따라서 필드별 오류 표시는 합성 fixture에서만 확인됐고, 실제 화면에서는 일반 오류 문구만 보인다. 서버 쪽 필드 오류 생성을 추가할지 정한다.
   - **현장 revision 누락:** `propertyId`만 있고 `expectedPropertyRevision`이 없으면 API 단계에서 400으로 거절한다. 지금은 DB에서 409가 난다.
   - **Google 오류 구분:** 401/403/429/5xx를 모두 `calendar_outcome_unknown`으로 기록한다. 권한·쿼터 실패를 `calendar_unavailable` 등으로 구분한다.
   - **읽기 명령의 행 잠금:** `lk_current_work_command`의 detail·receipt·cancellation 읽기에서 `for update`를 제거한다. 교착은 없지만 불필요한 경합이 생긴다.
   - **공용 기반 위치:** `WorkStore`, `workApiBoundary`, `CurrentWorkClient`가 enquiries 모듈 안에 있어 bookings와 quotes가 enquiries에 의존한다. shared 쪽으로 옮기는 것을 검토한다.
   - **확인 메일 실패 안내:** 확인 메일이 `failed`/`manual_review`이면 "Retry pending booking processing first"가 표시되지만 따라 할 수 없다. 실제로 할 수 있는 조치로 문구를 바꾼다.
   - **같은 이름의 버튼:** `/admin/enquiries`의 두 목록에 "Next page" 버튼이 두 개 있다. 페이지 버튼 이름을 구분한다.

## 알려 둘 것

- 2026-10-20 저녁 원본 폴더에서 아래 4개 파일이 지워진 상태로 발견됐다. 원인은 확인하지 못했다.
  - `concept 1.png`, `concept 2.png`, `concept 3.png`
  - `docs/reference-assets/LK_Group_Logo.pdf`
- 이번 커밋에는 이 삭제를 포함하지 않았다. 그래서 `main`과 새 워크트리에는 4개 파일이 그대로 있다.
- 원본 폴더에서 되살리려면 `git checkout -- "concept 1.png" "concept 2.png" "concept 3.png" docs/reference-assets/LK_Group_Logo.pdf`를 실행한다.
