# EMS R2 잔여·R3a 중단 구현 재개

2026-10-21 · Australia/Sydney · 로컬 `main@76f2a78`의 기존 미커밋 작업을 보존해 이어서 구현했다. 이번 완료 수준은 코드·로컬 자동 검사·합성 브라우저이며 회사 DB 적용·운영 배포·실제 제공자 인수와 구분한다.

## 구현 결과

- **고객·현장 연결:** 견적에서 모호한 현장 후보를 비교해 기존 현장을 선택하거나 사유를 남겨 별도 현장을 만든다. 취소하면 입력을 복원하고, 후보 revision이 달라지면 다시 검토한다. 기존 고객·견적 콘텐츠·사진·서명·PDF·고객 열람 권한을 유지한다.
- **문의:** 웹/Gmail 접수 목록의 검색·상태·페이지 이동, 담당 변경, 내부 메모 추가/수정, 보관/복원과 감사 이력을 연결했다. 원본 메시지는 보존한다.
- **직원 견적 초안:** 고객 원본과 분리된 작업용 초안 저장·수정, 별도 revision·이력·목록 필터를 연결했다. 고객 금액·가격 버전·서명·문서는 변경하지 않는다.
- **단순 예약:** 미완성 방문 기간의 서버 초안 저장·재조회·수정, 기존 단일 확정, 확정 예약 취소 상태·원래 요청 재시도와 문서 조회를 연결했다. 초안 저장에는 일정 점유·메일·Google 변경이 없다. 취소는 두 Google 일정의 삭제를 각각 확인한 뒤 점유를 함께 해제하는 worker를 사용한다.

## 재개 후 수정한 문제

1. 문의에서 `409` 뒤 최신 조회가 실패하면 이전 revision의 저장 버튼이 다시 열렸다. 재조회 중·실패 후에는 제출과 최신본 재확인을 차단하고, 제출 함수에서도 같은 상태와 revision을 검사한다.
2. 직원 견적은 실패한 조회에 남은 캐시를 최신본으로 사용하거나 `Discard` 재조회 실패 시 입력을 과거 값으로 덮을 수 있었다. 성공한 조회만 입력·기준 revision에 적용하고, 충돌 비교용 최신본을 따로 검증하며 조회 중에는 입력·저장을 잠근다. 조회 실패 시 입력과 충돌 상태를 유지한다.
3. 단독 UTF-16 surrogate가 문자 검사를 통과해 PostgreSQL에서 실패하고 결과 불명 재시도에 묶일 수 있었다. 공통 `workText`가 잘못된 문자를 DB 호출 전 `422 / not_applied`로 차단하며 정상 emoji는 허용한다.

두 UI 회귀는 **수정 전 production 빌드에서 각각 실패를 재현**한 뒤 수정 후 전체 브라우저 검사를 통과했다. 데이터/권한 backend와 최종 UI에 대한 reviewer 재검토의 남은 필수 수정은 0건이다.

## 실제 검증

| 검사 | 결과·범위 |
| --- | --- |
| 전체 `npm run test:operations` | **901/901**, 실패·취소·skip 0. UTF-16 보완 전 전체 검사이며 이후 backend 수정은 아래 집중 검사로 확인 |
| UTF-16 보완 후 domain/API 회귀 | **11/11**. high/low surrogate, reason·메모·직원 초안·예약 설명의 저장 호출 0회, 정상 emoji 허용 |
| 최종 `npm run check` | lint 경고 0, Next 타입 생성·TypeScript·webpack production build 통과 |
| R3a Chrome 합성 UI | **11/11**, skip 0. 문의·직원 초안·예약·취소, `409→GET503` 입력 보존, 결과 불명 동일 요청 재전송, 422 필드 표시, 401/403 개인정보 제거 |
| R2 Chrome 합성 UI | **20/20**, skip 0. 고객/현장 CRUD·후보 검토·동일 요청/원본 보존·revision 충돌·모바일·키보드 |
| R1 Chrome 회귀 | **13/13**, skip 0. 관리자 메뉴·공통 화면·초안/요청 보호·권한 회수·모바일·키보드 |
| 최종 소스/빌드 대조 | 제품 소스·설정·검사·migration **589개 파일 일치**, 차이 0. [대조 결과](2026-10-21-ems-r2-r3a/source-verification.json) |
| 문서·공백 검사 | 관련 문서 7개의 로컬 링크 **409개**, 깨진 링크 0. `git diff --check` 통과 |

브라우저는 회사 자격증명이 없는 별도 복사본의 production 빌드와 loopback 합성 API를 사용했다. API mocking 없이 실제 화면을 조작했으며 원본 데이터 불변, 외부 요청·page error·예상 밖 실패 응답 0건을 확인했다. R3a의 주요 8개 화면은 320/768/1440px에서 가로 넘침 0이다. R2에는 의도한 실패 응답의 resource error와 미사용 preload 경고가 기록돼 있으므로 콘솔 전체 0건으로 표시하지 않는다.

전체 검사 최초 실행의 local listen `EPERM` 5건은 허용된 환경에서 재실행해 해소했다. 테스트를 삭제하거나 skip하지 않았다. 개발 서버는 이 fixture의 정적 번들 전제에 맞지 않아 최종 인수는 production 빌드로 수행했다.

실행 로그: `/private/tmp/lk-ems-resume-20261021-check/test-operations-escalated.log`, `surrogate-regression.log`, `check-final-ui.log`, `browser-r2.log`, `browser-r1.log`. 공유 원본의 `.next`는 사용하지 않았다.

결과: [R3a 11개 상세](2026-10-21-ems-r2-r3a/r3a-browser-results.json) · [R2 20개 상세](2026-10-21-ems-r2-r3a/r2-browser-results.json) · [R1 13개 상세](2026-10-21-ems-r2-r3a/r1-browser-results.json).

합성 화면: [문의 모바일](2026-10-21-ems-r2-r3a/enquiry-detail-320.png) · [직원 견적 초안](2026-10-21-ems-r2-r3a/staff-quote-editor-1440.png) · [예약 취소 후](2026-10-21-ems-r2-r3a/simple-booking-cancelled-320.png).

## 적용과 남은 범위

- 기존 미커밋 migration `20261020094056_ems_r3a_current_work_management.sql`, `20261020101429_ems_customer_resolve_revision_guard.sql`을 코드·PGlite 검사에서 검토했다. 신규 테이블의 RLS·권한 제한, 직원/회사 경계·revision·멱등 receipt·감사·취소 lease와 점유 해제 검사를 확인했다. [Supabase RLS 공식 문서](https://supabase.com/docs/guides/database/postgres/row-level-security)와 최신 changelog의 [PostgreSQL 변경](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)을 확인했으며 회사 DB 버전·운영 advisor 결과를 확인한 것으로 확대하지 않는다.
- **회사 DB migration 적용·운영 배포·실제 Google 삭제/메일·실제 PostgreSQL 별도 세션 경합·직원 사용자 인수는 미실행**이다. 합성 삭제 증거를 실제 Google 삭제 인수로 해석하지 않는다. 취소 후 고객 자동 통지는 없으며 직원 화면에서 안내한다.
- R2의 기존 자료 dry-run/backfill·고객 병합 영향 미리보기, R3b의 회사 견적 개정본·고객 재확인·문서 버전, R4 이후 집계/Jobs/재고/청구는 남아 있다. 영구 삭제나 실제 정책·가격을 임의로 추가하지 않았다.
- 커밋·푸시·병합·운영 DB 및 외부 제공자 호출은 수행하지 않았다. 시작 시 존재한 이미지/PDF 삭제와 다른 사용자 변경을 보존했다.

## 오케스트레이션 통합·main 병합 (Claude lead)

같은 날 `/orchestration`도 진행했다. Claude가 감독과 화면 구현을 맡고 Codex가 로직·DB·API·테스트를 맡았다. 위의 재개 작업과 같은 미커밋 변경을 이어받아 아래를 마무리하고, 확정된 최종 소스를 다시 검증했다.

- 문의 422 오류 문구가 안내 문구와 같은 굵기로 보였다. 원인은 `.ems-field small`의 우선순위였고, 선택자를 고쳐 오류는 `font-weight 650`, 안내는 400으로 표시된다. [390px 화면](2026-10-21-ems-r2-r3a/enquiry-422-field-error-390.png)
- R3a 검사 스크립트의 401/403 시나리오가 세션은 정상인 채 notes 요청에만 실패를 주입하고 있었다. 화면이 세션을 다시 확인한 뒤 기록을 다시 불러오는 정상 동작이 실패로 잡혔다. 세션 상실(`signedOut`)과 미검증 단계(`email_verify`)를 함께 설정하도록 고쳤다. 단언은 유지했다.
- Skip link는 전체 페이지 스크린샷에서 sticky 영역과 겹쳐 보인다. 1440/320px 실제 viewport에서 스크롤 위치마다 측정하면 항상 화면 밖(top −78px)에 있다. 캡처 방식에서 생긴 현상이다.

최종 소스 기준 재실행 결과는 아래와 같다. 쓰기가 멈춘 뒤 실행했고, 격리 복사본의 `src`와 원본이 같음을 diff로 확인했다.

| 검사 | 결과 |
| --- | --- |
| 전체 `npm run test:operations` | **903/903**, 실패·skip 0 (UTF-16 회귀 포함) |
| 저장소 `lint`·`typecheck` | 통과 |
| 격리 복사본 `npm run check` | 통과 |
| Chrome 합성 R3a / R1 / R2 | **11/11 · 13/13 · 20/20** |

integrator 최종 판정: **조건부 승인 → 조건 충족**. 필수 수정은 1건이었다. `quotes/presentation/quote-crm-client.ts`가 customers 모듈 내부 파일을 직접 가져오던 것을, 공개 진입점 `customers/index.ts`(타입)와 새 `customers/request-client.ts`로 바꿨다. 수정 후 다시 검사했다: 전체 **903/903**, lint·타입, 격리 build, Chrome R2 **20/20**·R1 **13/13**.

integrator는 다음도 확인했다.
- migration 2개는 순서와 재정의가 충돌하지 않는다.
- RLS·`search_path`·권한 회수가 적용돼 있다.
- 취소는 두 일정의 삭제 증거가 있을 때만 점유를 해제한다.
- 직원 초안은 고객에게 노출되지 않는다.
- 401/403이면 개인정보를 지운다.

차단하지 않는 권장 사항 9건은 [인계 문서](../esn-admin/11-2026-10-21-next-worktree-handoff.md)에 옮겼다. 그중 둘은 특히 주의한다.
- 배포 순서: migration을 먼저 적용해야 한다. 코드만 배포하면 견적·문의 목록이 503이 된다.
- 422 필드 오류: 합성 fixture에서만 확인했다. 실제 서버는 `fields`를 보내지 않는다.

남은 결정과 다음 작업은 [새 워크트리 인계](../esn-admin/11-2026-10-21-next-worktree-handoff.md)에 정리했다. 확인하지 않은 흐름이 두 가지 있다: 초안 저장 후 Booking confirm, 고객 화면의 취소 문구. 범위 밖 화면 3곳에는 라벨 감싸기가 남아 있다.

관련: [구현계획](../esn-admin/10-2026-10-13-ems-ux-crud-implementation-plan.md) · [진행표](../esn-admin/05-progress.md) · [전체 TODO](../plans/15-home-cabinet-admin-todo.md).
