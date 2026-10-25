# 11 다음 작업 인계 — R2·R3a·R3b

작성: 2026-10-21 · 최종 갱신: 2026-10-22 · Australia/Sydney

R2 마무리와 R3a는 로컬 `main`에 병합했다. 현재 `r3b-orchestration-decisions`, 기반 HEAD `d63b03c`의 같은 작업 트리에 R3b P1·P2·P3 변경이 있으며 아직 커밋하지 않았다. integrator round 1 지적의 Codex·UI 수정과 fix1-final 검증을 완료했다. 새 worktree를 만들지 않았고 build·start는 지정 격리 복사본에서만 수행했다. [R2·R3a 이전 검증](../verification/2026-10-21-ems-r2-r3a-resume.md)과 [R3b 최종 합성 결과·남은 운영 인수](../verification/2026-10-21-ems-r3b.md)를 구분한다.

## 현재 상태

| 단위 | 상태 |
| --- | --- |
| R1 공통 화면 | 코드·합성 브라우저 인수 완료 |
| R2 고객 중복/복수 현장/견적 CRM 연결 | 코드·합성 브라우저 20/20 완료. 회사 DB 적용·실제 인수는 미실행 |
| R3a 문의·직원 초안·단순 예약 CRUD/취소 | 코드·합성 브라우저 11/11 완료. 회사 DB 적용·실제 Google 삭제 인수는 미실행 |
| R3b P1 백엔드·Codex fix1 | M1b·M2·L4·L5·L6 반영. 원본 GST, 철회 발송 차단, 문서·scope·권한과 강한 리뷰 확인 |
| R3b P2 UI·수정 | M1a·L1·L2·L7·철회 문구 반영. 원본 GST·적용 중 금액·짧은 알림·busy status 중복 제거. native modal 계약 유지 |
| R3b P3 이력 | 수정 전 2026-10-22 P3 round 2: 969/969·R3b 6/6. `history-p3-round2/`로 보존 |
| R3b integrator fix1-final | 초기 판정 CONDITIONAL의 지적 보완. 최종 round a: 저장소 lint·typecheck **0**, **984/984**, 격리 check **0**, Chrome **R3b 6/6·R3a 11/11·R1 13/13·R2 20/20**, fail·skip 0. 회사 적용·실제 인수는 미실행 |
| R4 이후 | 미착수 |

- **회사 Supabase에 적용하지 않은 migration이 있다.** 운영에 배포하기 전에 회사 승인을 받고 순서대로 적용한다.
  1. `supabase/migrations/20261020094056_ems_r3a_current_work_management.sql`
  2. `supabase/migrations/20261020101429_ems_customer_resolve_revision_guard.sql`
  3. `supabase/migrations/20261021090000_ems_r3b_staff_draft_validation.sql`
  4. `supabase/migrations/20261021091000_ems_r3b_company_revisions.sql`
- **배포 순서 조건:** 새 `quote_list`·D1 검증·회사본 RPC와 테이블을 쓰므로 반드시 위 **R3a×2 → R3b×2** 순서로 먼저 적용한 뒤 의존 코드를 배포한다. migration 없이 먼저 배포하면 목록·초안·회사본 요청이 실패할 수 있다. 직전 Codex fix1은 신규·미적용 R3b 두 파일만 보완했다. 이번 fix1-final은 SQL을 추가·수정·적용하지 않았다.
- 원격 `origin`에 push하지 않았고 Vercel 배포도 하지 않았다.

## 최종 검증 기록과 재현

```sh
cd "/Users/jimee/orca/workspaces/L&K Group/featherduster"
npm run test:operations
npm run lint && npm run typecheck
```

- `.env*`·`.claude/settings.local.json`·비공개 백업은 Git에 없다. 필요하면 원본 폴더에서 복사한다.
- 현재 저장소에서는 `next dev`·`next build`·`next start`를 실행하지 않는다. 아래 게이트가 `.git`·`.next`·`node_modules`를 제외하고 `app/`으로 복사한 뒤 의존성 symlink·build·start를 수행한다.
- 최초 integrator round 1 판정은 **CONDITIONAL**이며 M1/M2와 L1·L2·L4·L5·L6·L7 수정이 반영됐다. Codex는 M1b·M2·L4·L5·L6, UI 담당은 M1a·L1·L2·L7·철회 문구를 수정했다. 이번 최종 단계는 fixture cancelled 정합·새 문구/GST·철회 증거 단언과 문서·증거만 갱신했다.
- 조정자 최종 **fix1-final round a**는 샌드박스 밖에서 실행했다. 저장소 lint·typecheck 0·업무 **984/984**, fail·skip 0, 격리 check·ready 0, Chrome **R3b 6/6·R3a 11/11·R1 13/13·R2 20/20**, 게이트 0이다. 저장소의 겹친 실행을 중지하고 `repo-a2/`에서 재실행한 로그가 최종 근거다. round b는 실행하지 않았다.
- Codex는 소켓 없는 fixture **8/8**·두 문법 검사 0·강한 리뷰·해시 대조를 수행했다. loopback 제한 때문에 서버·브라우저·build는 직접 실행하지 않았다. reviewer가 발견한 이전 dialog 문구와 cancelled 문단 선택자 2건을 고친 뒤 ready-a 승인받았다.
- `/`·`redirect: 'manual'`·`status < 500`으로 준비 검사한다. 없는 favicon은 검사하지 않는다. 복사본 업무 검사는 `/private/` 경로 정규식·게이트 env artifact 때문에 제외했으며, 게이트 env 적용 전 원 저장소 검사를 기준으로 삼는다. fixture 로고 w48 누락과 401 navigation 뒤 body 읽기 경합도 앞선 단계에서 수정했다.

```sh
bash /private/tmp/claude-501/-Users-jimee-orca-workspaces-L-K-Group-featherduster/687d9dbc-0c8f-4a4c-aac2-1fe5e91655c7/scratchpad/orchestration/ems-r3b/fix1-final/run-gates.sh a
```

게이트는 실제 Chrome·지정 Playwright로 R3b 6개 → R3a 11개 → R1 13개 → R2 20개를 실행하고 매번 fixture를 reset한다. run 디렉터리 `gates-rounda/`의 JSON·필수 화면과 `handshake/done-a`를 [최신 증거 디렉터리](../verification/2026-10-21-ems-r3b/)에 원본 바이트로 복사했다. `history-p3-round2/`는 수정 전 P3 969/969·R3b 6/6이며 나머지 옛 디렉터리도 이력이다. 2026-10-22 재부팅으로 끊긴 P3를 재실행한 사실을 현재 fix1-final과 구분해 보존한다.

lead 결정 B의 **native modal dialog contract**는 기존 showModal과 같다. H2 초기 포커스, Tab/Shift+Tab 각 n+2, 모든 control 도달, 바깥 페이지 inert, idle Escape 복귀를 확인했다. BODY + document.hasFocus=false인 브라우저 UI 이동만 허용하며 바깥 페이지 요소 포커스는 실패한다. 최종 control 3개 모두 도달, 키 입력 10회·브라우저 UI 이동 2회·바깥 페이지 포커스 0회, 바깥 버튼 click 0회·상태 불변·Escape 복귀였다. 이번 단계는 modalFocus 함수와 `.tsx`·`.css`·`.sql` 보호 해시를 유지했다.

고객 원 서명본 $2,420 Including GST는 fixture v2 snapshot의 $2,200 + GST $220이고 회사본 v3는 no-GST다. 비교표의 실제 셀·Difference 라벨에서 구분하며 원본을 재가격 계산하지 않는다. 미시도 notice 철회는 cancelled/revision_withdrawn이고 시도된 행은 증거를 유지하며 새 claim·재시도를 막는다.

남은 경미 항목은 두 가지다. 아직 회사본이 없으면 StaffDetail에 originalTotalCents가 없어 Amount in effect가 Booking 탭을 안내한다. 원본 GST 0 분기는 코드·단위 시험만 확인했고 screenshot은 없다. [최종 검증 문서](../verification/2026-10-21-ems-r3b.md)를 따른다.

## 결정 필요 — 현재는 보수적 기본값으로 구현

| 항목 | 현재 동작 | 정해야 할 것 |
| --- | --- | --- |
| 취소 고객 통지 | 메일·Calendar 참석자 통지 없음. 직원이 별도로 연락 | 문구·시점·채널 |
| 확정 후 일정 변경 | 확정본의 날짜·금액은 바꾸지 않음. 미확정 draft만 수정 | 새 일정 제안·고객 동의·점유 교체 절차 |
| 취소 가능 조건 | 확정 완료 + 일정 manifest 완전 + 확정 메일 처리 완료 | 확정 중·메일 결과 불명·legacy v1의 취소 절차 |
| 외부에서 바뀐 Google 일정 | `review_required`. 점유 유지, 자동 강제 삭제 없음 | 회사 검토 승인 절차 |
| 권한을 잃은 뒤의 취소 명령 | 원래 명령을 재실행하지 않음 | 다른 직원에게 인계하는 UI·정책 |
| 고객 취소 요청·환불 | 없음. 직원 명령만 처리 | 정식 계약·금융 정책 |
| 직원 견적 초안 | 내부 작업본. 원본과 같은 칸은 stored 규칙, 변경 칸은 엄격 검증 | 회사본 발행 때 전 칸 엄격 검증. 실제 회사 적용은 후속 |
| 담당자 범위 | 기존 admin/owner 직원만 | 현장 직원 역할·배정 권한 |
| 보관·메모·초안 보존 기간 | 삭제 없음 | 개인정보 보존·영구 삭제 정책 |
| 회사본 | v3/no-GST 서버 계산·발행 안내·OTP 고객 새 서명·수락본 확정 구현, 합성 고객 화면 게이트 완료 | 회사 적용·실제 OTP 고객/메일·운영 인수 |
| R3b 미결정 정책 | 할인/음수, 거절·변경 요청, 철회 통지, 확정 예약 variation, 정식 약관·서명 보존 | [12번 §7](12-2026-10-21-r3b-company-revision-policy.md#7-미결정-사항) 기준 별도 결정 |

P2 취소 표시는 `accepted_revision`에도 기존 자격 조건을 적용한다. 확정 완료·완전한 이벤트 manifest·확정 메일 제공자 수락 전에는 취소하지 않으며 Google 삭제·독립 부재 확인 전 점유를 유지한다. 실제 제공자 인수·고객 취소·환불은 미완료다. 예약 UI는 quotes의 Booking 탭 gate/탭 이동과 schedule의 서버 409 메시지·Open quote 링크를 구별한다.

## 다음 작업 후보 (10번 계획 순서)

1. **R3b 합성 인수 결과 인계**
   - 코드·자동/합성 인수는 완료다. [최종 검증 문서](../verification/2026-10-21-ems-r3b.md)와 필수 화면을 회사 적용의 검토 자료로 사용하고 실제 인수와 구분한다.
2. **회사 적용과 실제 인수 (R2·R3a·R3b)**
   - 회사 승인 후 migration 4개 순차 적용 → 배포 → 실제 직원 로그인·고객 재확인·메일·예약 취소를 인수한다.
   - 취소는 Google 일정 실제 삭제·GET 확인과 점유 해제까지 대조한다.
3. **R4 Overview·검색**
   - 전체 집계 API, 4 KPI·그래프·오늘 일정·주의 큐·드릴다운, 전역 검색.
4. **남은 정리**
   - 범위 밖 화면의 라벨 감싸기 3곳: `customer-booking-review.tsx`, `booking-operations-panel.tsx`, `live-customer-proposal.tsx`
   - 목록 화면의 첫 Tab 순서
   - 초안 저장 후 Booking confirm, 고객 화면 취소 문구의 브라우저 확인
5. **integrator 권장 사항** (차단 아님, 2026-10-21 통합 검토)
   - **취소 재처리 주기:** `processSimpleBookingCancellation()`은 하루 1회 cron(`0 3 * * *`)에 1건만 처리한다. 재시도 상태인 취소는 하루 이상 점유를 유지할 수 있다. 시간 예산 안에서 여러 건을 반복 처리하도록 바꾸고, 화면 문구 "retries automatically in the background"를 실제 주기에 맞춘다.
   - **422 `fields` — R3b 코드 반영:** API가 식별하는 칸의 오류를 실제 `workApiBoundary`에서 전달한다. 합성 API/fixture 검증과 회사 적용·실제 운영 인수는 구분한다.
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
