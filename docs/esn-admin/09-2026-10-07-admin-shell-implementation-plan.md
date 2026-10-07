# 2026-10-07 EMS-D1 순차 구현 계획

작성·구현: 2026-10-07 · Australia/Sydney · **EMS-D1 구현·합성 검증 완료 / 실제 회사 인수 미완료**

사용자가 승인한 [08 대시보드 디자인·UX 계획](08-ems-dashboard-design-and-implementation-plan.md)을 실제 개발 순서로 나눈다. 오늘 목표는 **기존 로그인과 업무 기능을 보존하면서 공통 관리자 화면과 메뉴별 경로를 적용하는 것**이다. 최초 요청에서는 계획서·목차·진행표·TODO만 작성했고, 후속 구현 승인에 따라 아래 D1을 실행했다. 전체 검사 374/374·lint·타입·build와 합성 브라우저 36+8+4 항목이 통과했다. 실제 변경·오류 수정·검증 범위는 [당일 검증 기록](../verification/2026-10-07-ems-admin-shell.md)을 따른다. D2 실제 집계·그래프와 회사 자료 인수는 별도다.

## 1. 오늘의 범위와 완료 모습

- 글로벌 Slate/Greige·Manrope를 사용하는 sidebar·header·계정 메뉴·모바일 메뉴가 있다.
- 고객, 문의, 서명 데모 견적, 예약 검토, 설정을 각 메뉴에서 열 수 있다.
- 로그인·비밀번호 변경·이메일 확인·재인증은 기존 상태와 서버 검증을 유지한다.
- Overview는 **집계 준비 안내와 작동하는 업무 링크**를 제공한다. HTML 시안의 가상 숫자·차트를 제품에 넣지 않는다.
- 기존 고객 생성/검색/상세/연결/감사, 예약/PDF/사진, 세션 관리가 이관 후에도 동작한다.
- 모바일·키보드·직접 URL·새로고침·권한 상실 및 회귀 검사를 통과해야 D1 완료다.

| 오늘 제외할 일 | 이어지는 단계 / 이유 |
| --- | --- |
| 실제 KPI·그래프·agenda·집계 API/RPC | EMS-D2. 목록의 500/100건 제한과 전체 집계를 별도로 해결해야 함 |
| 고객 `[id]` 상세 경로, 새 상태/기간 필터, 상세 UX 전면 정돈 | EMS-D3. 오늘은 기존 내부 상세와 기능 이관에 집중 |
| 새 일/주/월 캘린더, 일정 끌어놓기 | 후속 일정 UI. 오늘은 기존 예약 검토 기능 재사용 |
| Job·주문·재고·매출·인보이스 구현 | EMS-D4/D5. 상태·원장·업무 정책 준비 필요 |
| 추가 관리자 초대·권한 변경·인증 방식 변경 | 기존 인증 기능 보존과 다른 작업 |
| DB migration·실제 회사 자료 변경·외부 메일/Calendar 쓰기 시험 | D1의 합성 검증과 구분하고 기존 실제 인수 범위에서 후속 실행 |
| 공개 배포·도메인·Google 결제·원격 push | 이번 계획 요청의 범위 밖 |

Google Places 결제, Job 정책, 재고 품목 확정은 D1을 막지 않는다. 기존 실제 고객 연결/해제·다른 본인 세션 종료·사진 포함 재서명/확정·실기기 인수는 [07번](07-2026-10-06-main-status-and-next-steps.md)에 남아 있으며 D1 UI 이관 완료로 대신 체크하지 않는다.

## 2. 시작 기준과 재사용할 구현

기준 코드는 로컬 `main@78cf64f`다. 디자인 커밋 `3eae547`까지 병합됐고, 업무 구현은 앞선 `d0aa347`에 있다. 계획 작성 시작 시 08번 문서에 미커밋 편집이 있었으며 그대로 보존했다. 후속 구현 착수 때 작업 상태를 다시 확인하고 `codex/ems-admin-shell-20261007`을 생성했다. 커밋·merge·원격 push는 수행하지 않았다.

| 현재 구현 | 재사용·이관 방법 |
| --- | --- |
| [admin 진입점](../../src/app/admin/page.tsx) | 직원/legacy 모드의 현재 서버 분기를 유지하면서 Overview 조립으로 축소 |
| [StaffAdminConsole](../../src/modules/admin-access/presentation/staff-admin-console.tsx) | 로그인·비밀번호·추가 확인·focus 재검사·비밀값 초기화를 유지. ready 업무 조립만 분리 |
| [OperationsConsole](../../src/modules/operations/presentation/operations-console.tsx) | 요청/상태 controller와 화면 section을 분리하고 같은 데이터를 재사용 |
| [CustomersConsole](../../src/modules/customers/presentation/customers-console.tsx) | 생성·검색·내부 상세·원본 연결/해제·감사·request lane을 유지 |
| [SessionSecurity](../../src/modules/admin-access/presentation/session-security.tsx) | 현재 세션 보존·다른 세션 종료·공급자 정리 실패 재시도 유지 |
| [예약 패널](../../src/modules/bookings/presentation/booking-operations-panel.tsx) | proposal·revision·서명·PDF/사진·확정·15초 상세 갱신 유지 |
| [RootLayout](../../src/app/layout.tsx), [토큰](../../src/shared/styles/tokens.css) | 폰트와 글로벌 스타일 재사용. 공개 사이트 라우트와 색상 원본을 재편하지 않음 |
| [합성 UI 도구](../../scripts/verify-esn-ui-fixture.mjs) | 새 페이지 경로를 시험하도록 범위를 보완하되 API·쿠키의 회사 서버 전달 금지 유지 |

새 인증 라이브러리·상태 관리 라이브러리·차트 라이브러리는 필요하지 않다. D1의 `admin-dashboard`는 presentation과 공개 진입점만 만든다. 비어 있는 domain/application/infrastructure를 미리 생성하지 않는다. 여러 route 파일은 얇은 조립 역할이며, 같은 업무 controller를 경로별로 복제하지 않는다.

## 3. 순차 실행표

앞 단계의 완료 조건을 충족한 뒤 다음 단계로 이동한다. 한 단계에서 인증·원본 보존 문제가 나오면 그 문제를 고치고 해당 검사를 다시 실행한다.

| 순서 | 작업과 주요 대상 | 단계 완료 조건 |
| --- | --- | --- |
| D1-00 | 작업 상태·Node 24/npm 11·기준 커밋 확인, 구현 브랜치 준비, 기존 경로/상태/기능 목록 고정 | 사용자 편집 보존, 범위와 기준 증거가 기록됨. 회사 설정/키 재생성 없음 |
| D1-01 | `StaffAdminConsole`에서 공통 직원 인증 경계·접근 상실 전달을 추출 | 기존 화면에서도 로그인 단계가 같고 ready 이전 업무 UI/요청이 시작되지 않음 |
| D1-02 | Operations의 controller·공통 요청·동기화 수명과 미저장 입력 보호를 분리 | 기존 standalone 화면으로 먼저 동일 동작 검증. 타이머/데이터 중복 소유 없음 |
| D1-03 | 관리자 layout·shell·모바일 메뉴·글로벌 토큰 alias 구현 | 한 개 main·페이지 H1, 올바른 활성 메뉴·초점·반응형, 공개 화면 영향 없음 |
| D1-04 | 고객과 세션 보안 화면을 먼저 경로에 연결 | 기존 기능/에러/재시도 유지, 두 경로의 직접 진입·이동·재인증 통과 |
| D1-05 | 문의·서명 데모 견적·예약·연동 설정을 목적별 경로로 이관 | 기존 mutation/API payload와 원본 규칙 유지, 각 기능의 접근 위치 확정 |
| D1-06 | Overview 준비 화면, 미래 메뉴 안내, 기존 hash·Google 복귀 연결 | 가상 KPI 없음, 모든 메뉴/옛 주소가 정해진 내부 목적지로 연결 |
| D1-07 | 관련 자동 검사·통합 검사·빌드·브라우저 회귀 | 아래 QA-D1 기준 통과 또는 미완료 원인 명시. 치명적인 인가/데이터 실패는 전환 차단 |
| D1-08 | 당일 검증 기록·진행표·TODO 갱신, 다음 D2 입력사항 인계 | 실제 완료 수준과 남은 인수 구분. D1 검수 후에만 기본 화면 전환 |

### D1-01 — 인증 경계를 먼저 분리

추가 후보는 `src/modules/admin-access/presentation/staff-admin-boundary.tsx`와 최소 인증 context다. 기존 `staff-admin-console.tsx`와 `client.ts`를 순차 편집한다. 현재 단계 전환·오류·로딩·이메일 코드/비밀번호 초기화·focus 재확인을 이동하며 인증 규칙은 다시 쓰지 않는다.

- `ready` 전에는 개인정보가 있는 업무 컴포넌트를 mount하지 않는다. 자식 Server Component가 미리 데이터를 읽지 않도록 D1 route는 비민감 조립에 한정한다.
- 신규 page/frame의 표시 제어와 기존 API/PDF/사진의 서버 인가는 별개의 책임이다. layout 한 번의 검사로 API 보호를 대체하지 않는다.
- Customers·SessionSecurity의 기존 접근 상실 callback을 공통 경계로 연결한다. Operations의 옵션/저장/동기화와 예약 목록/상세/15초 polling도 같은 경계로 전달한다.
- 401/403을 받으면 업무 데이터·선택·초안·늦은 응답을 제거하고 현재 인증 단계를 재확인한다. 이를 ‘서버 로그아웃 성공’으로 잘못 안내하지 않는다.
- 직원 모드에서 인증 실패 시 legacy 화면으로 fallback하지 않는다. legacy 모드는 현재 `/admin` standalone 동작을 유지하며 새 직원 전용 subroute를 허용하지 않는다.

### D1-02 — 데이터·타이머·입력 소유권 정리

`operations-console.tsx`를 먼저 controller와 표현 section으로 분리하고 기존 standalone 화면에서 검증한 뒤 새 route에 조립한다. 새 helper 이름 후보는 `use-operations-workspace.ts`이며, 구현 편의만으로 여러 서비스/추상 계층을 만들지 않는다.

| 대상 | 유일한 관리 주체와 종료 조건 |
| --- | --- |
| 직원 세션/인가 단계 | admin-access 경계. ready 해제 시 모든 업무 subtree와 요청을 무효화 |
| Operations 역할·공통 응답·동기화 lock/retry | 직원 ready 범위의 단일 controller. `/api/operations/session`의 실제 owner/admin 정보 사용 |
| 60초 자동 동기화 | 위 controller 하나에서 기존 owner·연결·대상 선택·in-flight·재시도 지연 조건 유지. 메뉴 이동만으로 중단/복제하지 않음 |
| Google 옵션 조회 | owner가 연결 설정 화면을 열 때 조회. admin에게 owner 옵션 요청/저장 UI를 제공하지 않음 |
| 15초 예약 상세 갱신 | 현재 표시된 예약 상세 한 곳. 상세 이탈·권한 상실 시 정리 |
| 고객/문의/예약 편집 | 각 업무 모듈. record ID·revision·기존 idempotency/응답 유실 상태 유지 |
| 미저장 입력/이동 보호 | 인증 완료 수명 안의 최소 메모리 계약. 로그아웃/권한 상실 때 폐기 |

현재 자동 동기화에는 별도 토글이 없고 Operations가 항상 mount돼 있다. **D1은 동일한 직원 ready 수명에서 한 개 타이머를 유지한다.** 화면별 분리 때문에 자동 동기화를 조용히 없애거나 경로마다 실행하지 않는다. 기존 `/api/operations` 응답에는 동기화 조건과 업무 목록이 함께 있으므로, 업무 데이터 전체를 경로별 lazy 조회한다고 약속하지 않는다. D1에서는 공통 응답 재사용·중복 요청 차단을 우선하고 API 분할은 이번 범위에 넣지 않는다.

미저장 폼은 앱 내 메뉴에서 저장/이동 취소/입력 폐기를 선택하도록 한다. 브라우저 뒤로가기에는 같은 인증 수명의 메모리 초안을 복원하고, 새로고침/탭 닫기는 지원되는 브라우저의 `beforeunload`로 보조한다. 브라우저의 경고 제공을 절대 보장하지 않는다. 비밀번호·인증 코드는 이 초안에 보관하지 않는다. 개인정보를 URL/localStorage/sessionStorage에 넣지 않는다.

저장 중이거나 결과가 불명확하면 동일 요청의 idempotency key와 payload를 보존하고 확인 없이 새 요청으로 바꾸지 않는다. 재진입 시 서버 최신 revision을 확인하고, 변경됐으면 명시적 충돌 검토를 요구한다. 권한 상실 시에는 입력 복원보다 데이터 삭제가 우선이다. 늦은 요청은 AbortController 또는 request generation으로 무효화해 새 화면/재로그인에 옛 결과가 복원되지 않게 한다.

### D1-03 — 승인한 공통 화면 적용

추가 후보는 `src/app/admin/layout.tsx`, `src/modules/admin-dashboard/client.ts`, `presentation/admin-shell.tsx`, `admin-shell.css`, `admin-overview.tsx`다.

- sidebar·상단바·계정 메뉴·본문의 책임을 shell 한 곳에 둔다. 각 업무 화면의 header·`min-height:100vh`·중복 main을 embedded 모드에서 제거한다.
- 색상은 `--site-*`를 참조하는 관리자 alias로 적용한다. 홈페이지/KCP의 전역 크기·색 값을 수정하지 않는다.
- 첫 화면은 업무 탐색과 집계 준비 상태를 표시한다. 아직 계산하지 않은 KPI를 0이나 가상 값으로 채우지 않는다.
- 모바일 메뉴는 키보드·Escape·초점 복귀·선택 후 닫힘을 지원한다. 버튼과 폼의 실제 조작 영역, 긴 텍스트, 320px 레이아웃을 확인한다.

### D1-04~06 — 화면 이동표

| 경로 | 오늘 연결할 실제 기능 | 오늘 추가하지 않을 기능 |
| --- | --- | --- |
| `/admin` | Overview 준비 안내·작동하는 업무 링크 | 실제 지표·그래프·agenda |
| `/admin/customers` | 기존 Customers 전체 및 내부 상세 | 새 `[id]` 경로·상태/기간 필터 |
| `/admin/enquiries` | 문의 목록·대화·임시 일정 편집·연결된 예약 진입 | 새 문의 상태·원본 자동 병합 |
| `/admin/quotes` | 기존 서명 데모 제출·서명 문서·PDF/사진 조회 | 운영 견적 승인율·새 가격/계약 |
| `/admin/schedule` | 기존 예약 목록/상세·기간 제안·재서명 검토·확정·Google 변경 검토 | 새 캘린더 그리드·드래그 확정 |
| `/admin/settings` | 기존 세션 보안·owner의 Google 연결/옵션/동기화 관리 | 새 초대/권한·회사 정책 편집 |
| `/admin/jobs`, `/admin/orders`, `/admin/inventory`, `/admin/reports` | 각 기능의 준비사항 안내. 공통 안내 컴포넌트 재사용 | 가짜 목록·숫자·작동하지 않는 저장 버튼 |

Quotes와 Schedule은 같은 서명 제출·예약 원본을 사용한다. 동일 패널과 controller를 공유하고 목적별 제목/초기 보기만 구분한다. 두 개의 기록이나 서로 다른 승인 상태를 만들지 않는다. 고객·예약·세션 컴포넌트는 각 모듈 `client.ts` 공개 export를 통해 조립한다.

| 기존 주소 | 고정된 내부 이동 대상 |
| --- | --- |
| `/admin#operations-content` | `/admin/enquiries` |
| `/admin#customers-heading` | `/admin/customers` |
| `/admin#staff-session-security-heading` | `/admin/settings#staff-session-security-heading` |
| `/admin#signed-demo-requests` | `/admin/schedule#signed-demo-requests` |
| `/admin?google=connected` | 인증 완료 후 `/admin/settings`의 연결 영역 |

이동은 whitelist 내부 경로만 사용한다. 외부 `returnTo`를 새로 받지 않는다. Google callback의 state/code/cookie·서버 복귀 URL은 보존하고, 복귀 화면의 내부 이동만 추가한다. 알 수 없는 hash는 Overview에 안전하게 남는다. 이동 반복/뒤로가기 루프를 피하고, 로그인 전 진입한 내부 목적지는 ready 후 복원한다.

## 4. 요청 흐름과 검증 경계

```text
직접 URL / 메뉴 이동 / Google 복귀
  → 기존 서버의 staff/legacy 모드 분기
      ├─ legacy → 기존 /admin만 유지; 새 직원 화면 차단
      └─ staff boundary → 로그인 / 비밀번호 / 이메일 확인 / ready
                              ↓ ready일 때만
                         관리자 shell
                         ├─ 단일 Operations controller + 기존 자동 sync
                         └─ 현재 업무 route → 기존 모듈 → 기존 보호 API
                                                   ↓
                        401/403 → 요청 무효화 + 개인정보/초안 제거
                                → 인증 단계 다시 확인
```

| QA ID | 실패 가능 지점 | 구현할 처리와 확인 방법 |
| --- | --- | --- |
| QA-D1-01 | 직접 subroute·새로고침으로 인증을 건너뜀 | stage별 합성 세션으로 업무 UI/데이터 요청·API 거부 확인. 서버 guard 보존 |
| QA-D1-02 | 설정·예약 polling에서 권한 상실 후 상세가 남음 | 모든 요청 경로의 401/403을 주입해 즉시 제거·재인증 확인 |
| QA-D1-03 | 로그아웃/화면 이동 뒤 느린 응답이 이전 데이터를 복원 | 지연 응답 → 이동/권한 상실 → 응답 해제 순서로 검사 |
| QA-D1-04 | 여러 경로의 타이머가 중복 sync·메일 작업을 실행 | 합성 요청 횟수·in-flight/retry 확인. 여러 메뉴 이동 뒤 타이머 1개, 권한 상실 뒤 0개 |
| QA-D1-05 | 메모리 초안·이동 중 저장 결과가 유실/중복됨 | dirty 취소/폐기·뒤로가기 복원·revision 충돌·응답 유실 동일 요청 재시도 검사 |
| QA-D1-06 | owner/admin 분기 및 legacy 경계가 바뀜 | 합성 role별 옵션 요청·저장 접근·새 직원 route 거부 확인. ready만으로 owner 추정 금지 |
| QA-D1-07 | 북마크/Google 복귀가 빈 화면·루프를 만듦 | 위 주소표 각각의 미로그인/ready 진입·뒤로가기·새로고침 확인 |
| QA-D1-08 | 고객/예약/문서/사진/세션 기능이 누락됨 | 아래 업무별 최소 회귀 흐름을 새 메뉴에서 실행 |
| QA-D1-09 | 작은 화면·키보드에서 메뉴/내용이 가려짐 | 1440·1280·768·390·320px, 확대·Tab·Escape·focus 복귀·콘솔 점검 |
| QA-D1-10 | 테스트 도구가 새 경로를 회사 API로 전달함 | 합성 fixture의 API/쿠키 전달 차단을 검사하고 미지원 endpoint는 로컬 실패로 종료 |

현재 예약 패널은 일부 오류를 자기 화면에만 표시하며 공통 access-lost callback이 없다. 이것은 이번 계획에서 확인한 **이관 전 보완 대상**이다. 위 표는 필요한 시험 목록이며, 코드 수정이나 새 시험을 통과했다는 기록이 아니다.

## 5. 구현 후 검사 순서

1. 인증 추출 후 `npm run test:admin-access`. 새 공통 경계의 stage·접근 상실·지연 응답 등 동작 검사를 기존 Node test runner 구조로 추가한다. 단순 텍스트 일치 검사로 대체하지 않는다.
2. 고객 이관 중 실제 관련 변경이 있으면 `npm run test:customers`. 기존 request-state·revision·응답 유실 규칙을 확인한다.
3. 모든 이관 완료 후 `npm run test:operations` → `npm run check`. 전체 operations 목록에 admin/customer 검사가 포함되므로 최종 단계에서 같은 묶음을 이유 없이 재실행하지 않는다. 실패 수정 뒤에는 실패 관련 검사부터 다시 확인한다.
4. 기존 합성 UI fixture의 page proxy를 **승인된 `/admin` 하위 경로 목록**으로 보완한다. `/api` 전체 로컬 처리·Cookie/Authorization/Set-Cookie 비전달을 보존한다. 새 RSC/navigation 요청도 헤더와 응답 경계를 확인하며 미지원 요청을 회사 데이터로 우회하지 않는다.
5. 합성 브라우저에서 QA-D1-01~10과 주요 업무를 확인한다. 필요한 HTML·상태만으로 재현 가능한 검사는 실제 계정을 사용하지 않는다.
6. 회사 읽기 검증은 기존 인증을 사용하는 읽기 전용 GET 조회로 제한하고 별도 기록한다. 실제 owner 관리자 화면은 60초 자동 동기화가 DB·Calendar 쓰기를 실행할 수 있으므로 읽기 전용 검사로 취급하지 않는다. 자동 동기화가 작동하는 실제 화면 인수·고객 연결·예약 확정·메일/Calendar 전송·다른 세션 종료는 별도 인수 범위에서 수행한다. 세션이 없다면 직접 로그인이 필요한 시점에 안내하고, 비밀번호/코드는 채팅이나 로그에 남기지 않는다.

| 업무 회귀 흐름 | 합성 검증과 실제 인수 구분 |
| --- | --- |
| 고객 생성 → 검색 → 내부 상세 → 연결/해제 → 감사 → 재조회 | 합성 데이터로 이관 동작 확인. 회사 DB의 실제 분류 인수는 여전히 별도 |
| 문의 → Gmail 대화 → 임시 일정/변경 검토 | 기존 payload·revision 유지. 외부 발송/일정 변경을 QA 목적으로 자동 실행하지 않음 |
| 서명 데모 → PDF·사진 → 기간 제안/재서명 → 확정 상태 표시 | 합성 실패/권한/동작 시험. 기존 실제 PDF/사진 읽기 근거 보존; 새 왕복은 별도 |
| 본인 세션 조회 → 다른 세션 종료 → 부분 실패 재시도 | 합성 현재 세션 보존 검사. 실제 다른 세션 종료 인수는 별도 |

기존 359개 통과는 이전 구현의 기준 증거다. 새 프레임 변경 후 실행한 개수·명령·결과·브라우저 범위를 새로 기록한다. D1에서 schema를 변경하지 않으므로 Supabase schema 검사·원격 SQL 적용·`setup:local`을 관성적으로 실행하지 않는다.

## 6. 담당 역할과 파일 충돌 방지

- **analyst — GPT-6 Astra / xhigh:** 인증/상태 소유권·기존 동작 보존·시험 전략·최종 결과 판정.
- **implementer — GPT-6.1 Sol / high:** 위 순서의 코드·테스트 구현·실행. 동일 핵심 파일의 추출과 route 이관은 순차 작업.
- **quick_edit:** 이번 핵심 이관에는 사용하지 않는다. 확정된 단순 문구/간격 정리가 따로 생길 때만 분리한다.
- 주 에이전트가 결과를 통합하고 실제/합성 검증·회사 변경 여부를 구분한다. 역할은 주 채팅 모델을 바꾸는 설정이 아니다.

`staff-admin-console.tsx`, `admin-access/client.ts`, `operations-console.tsx`, `operations/client.ts`, `booking-operations-panel.tsx`는 동시에 여러 작업자가 편집하지 않는다. 공통 props/접근 상실 계약이 확정된 뒤 독립 CSS·route 조립만 나눌 수 있다. 사용자 또는 다른 작업자의 편집을 덮어쓰지 않는다.

## 7. 완료 판정과 되돌리기

**D1 완료 조건:** 공통 프레임과 위 경로가 동작하고, 기존 인증/업무 기능의 누락이 없으며 QA-D1 핵심 검사·lint/type/build가 통과한다. 회사 계정·자료가 없어 실행하지 못한 실제 인수는 별도 미완료로 표시한다. 인가 실패·PII 잔류·중복 mutation·입력 유실 문제가 있으면 기본 진입 전환을 완료 처리하지 않는다.

초기 구현 동안 기존 UI는 동일 직원 인증 뒤의 내부 UI 선택으로 유지한다. 새 프레임 문제가 생기면 UI 선택을 되돌린다. `STAFF_ADMIN_AUTH_ENABLED`를 끄거나 legacy 인증으로 전환하는 것을 복구 방법으로 쓰지 않는다. 새 업무 데이터/SQL을 함께 변경하지 않아 되돌리기 범위를 화면으로 제한한다. 배포·원격 push·추가 commit/merge는 그 시점 사용자 요청 범위에 따른다.

구현 완료 후 생성할 기록 후보는 `docs/verification/2026-10-07-ems-admin-shell.md`다. 실제 작업일이 달라지면 해당 날짜로 기록한다. 문서에는 변경 파일, QA ID별 증거, 실행한 명령, 알려진 한계, 실제 고객/세션 인수 상태를 적고 [진행표](05-progress.md)·[전체 TODO](../plans/15-home-cabinet-admin-todo.md)를 갱신한다.

## 8. 다음 단계 인계 — EMS-D2

D1 완료 후 별도 단위로 집계 계약을 시작한다. 4개 지표는 선택일 저장된 확정 일정, 현재 미확정 요청, 최근 7일 문의, 현재 미연결 원본이다. 전체 집계·Sydney 날짜/DST·canonical 중복 제거·confirmed proposal·review-required 구분·조회 시각과 상세 목록 조건 일치를 [08번](08-ems-dashboard-design-and-implementation-plan.md)에 따라 구현한다. D1의 API 목록 배열 길이를 임시 실적 수치로 먼저 노출하지 않는다.

## 9. 이번 계획 검토 결과

| 관점 | 판단 |
| --- | --- |
| 범위·구조 | 승인 설계의 D1만 실행 단위로 분해. 기존 모듈/단일 앱/단일 DB 재사용, 새 업무 규칙 없음 |
| 코드 구성 | 인증·controller를 기존 UI에서 먼저 추출한 후 route 이관. 공개 export와 단일 상태 소유로 중복 구현 방지 |
| 검증 | API 권한·늦은 응답·타이머·입력 보존·legacy/role·옛 경로·기존 업무·반응형을 QA-D1-01~10으로 연결 |
| 성능·요청 | 60초 동기화 한 개와 표시 중 상세 polling만 유지, Google 옵션 지연 조회. 공통 API의 현재 과잉 데이터는 D1에서 재사용하며 완전 lazy/새 캐시는 후속 |

`plan-eng-review`의 범위·구조·코드 구성·테스트·성능 체크리스트를 오늘 계획에 맞게 적용했다. 기존 승인 설계의 전면 재검토나 외부 설정 변경 절차는 추가하지 않았다. analyst의 경계/실패 검토와 implementer의 파일·순서 대조를 통합했다.

계획의 근거는 현재 소스, [package scripts](../../package.json), [08 승인 설계](08-ems-dashboard-design-and-implementation-plan.md), [기존 구현 검증](../verification/2026-10-06-esn-customers-and-sessions.md), 설치된 Next.js 16.3.6의 `node_modules/next/dist/docs/01-app/02-guides/authentication.md`다. 해당 로컬 안내는 layout이 이동 때마다 인증을 검사하거나 숨긴 자식의 실행/RSC 응답을 막는 경계가 아니라고 설명한다. 계획 작성 당시에는 앱 검사를 실행하지 않았고, 후속 구현·검증 결과는 [10월 7일 실행 기록](../verification/2026-10-07-ems-admin-shell.md)에 분리했다. 구현 중 추가 analyst는 agent thread 한도로 실행되지 않아 주 에이전트가 최종 검토를 맡았다.
