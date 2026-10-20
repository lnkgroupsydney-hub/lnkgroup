# EMS 화면·업무 기능 개선 — 구현계획과 실행 순서

작성일: 2026-10-13 · 상태: **R1 완료, R2 구현 중간 저장·최종 인수 미완료**.

사용자 요청은 최신 main 확인, 새 브랜치, 읽기 쉬운 EMS UI/UX·친화적인 애니메이션, 모든 카테고리의 저장·수정·삭제, 견적 고객 중복 방지와 복수 프로퍼티, Jobber의 중요 기능 적용, 반복 레이아웃의 글로벌 CSS 재사용이다. 최초 요청으로 아래 계획을 작성했고 후속 요청으로 R1을 구현했다. 최신 실행 결과는 [R1 검증 기록](../verification/2026-10-13-ems-r1-common-ui.md)과 13절을 따른다. 회사 SQL·실제 데이터·배포 변경은 수행하지 않았다.

## 1. 시작 기준과 이번 확인 결과

| 항목 | 확인 결과 |
| --- | --- |
| Git 기준 | 회사 `origin` fetch 후 로컬 `main` = `origin/main` = `756eb4d`. 예약 단순화·고객 세션 복구·시험 자료 정리 통합 기록 포함 |
| 새 브랜치 | `codex/ems-ux-crud-plan-20261013` |
| 작업 폴더 | `/Users/jimee/.codex/worktrees/ems-ux-crud-plan-20261013/L&K Group` |
| 원래 작업 보존 | 기존 `codex/quote-one-page-ux-20261013`의 고객/견적 UI·주소 관련 미커밋 변경은 원래 폴더에 유지. 새 폴더에는 복사하거나 병합하지 않음 |
| 실행 화면 관찰 | 로그인된 회사 Chrome의 `/admin/enquiries`를 읽고 현재 데스크톱 화면을 확인. 사진 분석·서명·예약·이력이 긴 한 화면에 펼쳐짐 |
| 관찰 한계 | 현재 Enquiries 데스크톱의 화면·접근성 트리 관찰이며 전체 UX 인수, 모바일·키보드·성능 측정은 아님. 고객 개인정보나 실제 화면 사본을 문서에 저장하지 않음 |
| Jobber | 플러그인 도구 명세 확인 및 `search_clients(limit: 1)` 읽기 시도. 응답은 `UNAUTHORIZED / requires reauthentication`; 실제 계정 자료·설정은 확인 못함 |
| 외부 근거 | Jobber 공식 Properties·Merge duplicate clients·Features 문서 확인. 계정 자료 이전·Jobber 동기화의 정상 작동을 확인한 것으로 해석하지 않음 |
| 분석 담당 | `analyst` 두 명: UI/UX·공통 CSS 분석, 데이터/API·중복 방지 분석. 주 에이전트가 Git·실제 화면·공식 자료 확인과 계획 통합 |

기존 [08 디자인 계획](08-ems-dashboard-design-and-implementation-plan.md)의 한눈에 보는 대시보드와 [21 글로벌 디자인 시스템](../plans/21-global-design-system.md)의 Slate/Greige·Manrope를 유지하면서 운영 상세와 CRUD를 확장한다. [43 회사 확정 예약](../plans/43-ems-confirmed-booking-calendar.md)·[45 간단 예약](../plans/45-simple-take-off-install-booking.md)의 검증된 원본·기간 점유·Google 확인 규칙을 보존한다.

## 2. 현재 부족한 기능과 개선 방향

아래 소스 근거는 위 main 기준이다. 화면 관찰과 코드에서 확인한 사실을 구분한다.

| Before | After — 구현 목표 | Why |
| --- | --- | --- |
| Enquiries/Quotes에서 같은 `LiveQuoteRequestsPanel`을 조립하고 목록 아래 전체 상세를 펼침 | 문의는 접수·담당·다음 작업 중심, 견적은 금액·검토·승인 중심 목록. 같은 요청 ID의 공통 상세 화면으로 연결 | 데이터 복제를 피하면서 메뉴별 업무 목적을 분명히 함 |
| 요청 상세에 AI 설명·서명·예약·이력을 세로 적층. 실제 Enquiries에서도 확인 | 상단 요약 + 다음 작업 하나 + `Summary / Photos & estimate / Booking / Documents / Activity` 상세 탭 | 필요한 정보와 현재 해야 할 일을 먼저 찾음 |
| Clients 검색 다음에 신규 고객 폼이 항상 열려 있고 상세·미연결 원본이 이어짐 | 목록이 기본 화면. `Add client`, 행 선택, `Add property`에서만 해당 폼을 엶 | 고객 찾기와 신규 생성의 시각적 충돌 감소 |
| 고객 원장은 단일 `address`, 원본 연결 타입은 `enquiry / submission` | 고객과 현장 1:N, 운영 견적 연결과 현장별 이력 추가 | 같은 고객의 다른 현장을 새 고객으로 만들지 않음 |
| 고객 POST는 멱등 키로 같은 요청 재전송만 방지 | 서버에서 기존 고객 검색·동일성 판정·원자적 재사용, 중복 후보에서는 생성 대신 선택 안내 | 별도 탭/별도 견적에서도 중복 고객 생성 방지 |
| 운영 견적의 `customer_id`는 있으나 쓰기 연결 경로가 없음 | 검증된 견적의 CRM 연결 명령과 누락 연결 처리 큐 | 저장된 견적이 Clients 이력에 실제로 나타남 |
| Schedule은 편집기 목록으로 검색·기간·상태 조작이 제한됨 | 일/주/목록, 날짜·상태·담당 필터, take-off/install을 같은 예약의 두 방문으로 표시 | 하루 업무와 빈 기간·충돌을 쉽게 확인 |
| 신규 단순 예약 편집에는 별도 서버 `Save draft`가 없음 | `Save draft`와 `Booking confirm`을 분리. 확인 한 번의 기존 흐름은 유지 | 초안 저장이 일정 점유·메일·Google 확정을 실행하지 않음 |
| Overview는 바로가기와 준비 안내, Jobs/Orders/Inventory/Reports는 준비 화면 | 실제 서버 집계 Overview, 각 업무 모델 구현 뒤 저장·편집·삭제/보관 기능 활성화 | 디자인 완성과 업무 기능 완성을 구분 |
| shell CSS가 operations/lq/live-company 스타일을 덮음 | EMS 공통 CSS·UI 컴포넌트를 한 번 정의하고 화면이 소비 | 화면별 여백·폼·버튼·상태 표현이 일관됨 |
| 새 `[id]` 상세 경로에서는 exact pathname 매칭이 맞지 않음 | 알려진 경로의 가장 긴 prefix를 기준으로 활성 메뉴·제목·breadcrumb 결정 | 상세/프로퍼티 화면에서도 올바른 메뉴와 위치 유지 |

주요 근거: `src/modules/admin-dashboard/presentation/admin-pages.tsx`, `admin-shell.tsx`, `admin-shell.css`; `src/modules/customers/domain/contracts.ts`, `presentation/customers-console.tsx`; `src/modules/quotes/presentation/live-requests-panel.tsx`; `src/modules/bookings/presentation/live-company-editor.tsx`, `live-company-schedule.tsx`; `src/modules/quotes/requests.test.mts`; `supabase/migrations/20261006102621_esn_customers.sql`, `20261008104249_live_quote_requests.sql`.

## 3. Jobber에서 적용할 중요 기능

기능 비교는 공식 문서와 현재 플러그인 명세에 근거한다. 아래 EMS 적용안·우선순위는 L&K 업무에 맞춘 제안이다.

| 참고 기능 | EMS 적용안 | 우선순위 |
| --- | --- | --- |
| 고객 한 명에 여러 프로퍼티, 현장별 업무 연결 | Clients 상세에 Properties 탭, 견적 생성/연결 시 고객과 프로퍼티 선택, 청구 주소 별도 | 첫 구현 묶음 |
| 중복 고객 검토·병합 | 생성 전 중복 차단, 기존 고객 연결. 기존 중복은 영향 미리보기 후 관리자가 병합 | 첫 구현 묶음 |
| 요청 → 견적 → 작업 → 청구의 연결 | 같은 고객·현장·원본 ID를 유지하는 상태 기반 업무 흐름, 단계별 생성과 감사 이력 | 견적부터 순차 |
| 일정과 여러 방문 | take-off/install·담당자·작업 구간의 일/주/목록 보기, 미배정·확인 필요 큐 | 예약 → Jobs |
| 작업 지시·체크리스트·사진 | Jobs에 작업 내용·현장 메모·담당·체크리스트·완료 증거 | Jobs 단계 |
| 견적/일정/인보이스의 고객 셀프서비스 | 기존 인증 고객 복구를 확장해 승인본·예약·문서를 한 곳에서 확인 | 기존 복구 재사용, 청구 이후 확장 |
| 리마인더·후속 처리 | 앱 내 할 일과 처리 기한부터 구현. 실제 이메일/SMS 자동 발송은 수신 정책·템플릿·재시도 검증 뒤 연결 | 알림 큐 먼저 |
| 상태별 목록과 지표 | 필터 가능한 목록과 같은 조건의 카드·그래프·다음 작업 연결 | Overview 단계 |

Jobber의 고객–현장 구조는 [Properties](https://help.getjobber.com/en/articles/properties/), 중복 처리 흐름은 [Merge duplicate clients](https://help.getjobber.com/en/articles/merge-duplicate-clients/), 일정·작업·고객 허브 기능은 [공식 Features](https://www.getjobber.com/features/)를 참고했다. Jobber는 현장 삭제에 연결 자료 삭제를 포함하지만, EMS는 연결된 서명·예약·청구 보존과 복원 가능한 삭제를 우선 설계한다. 이 차이는 EMS의 데이터 정책 제안이다.

지도 경로 최적화, 시간급여, 마케팅, AI 음성 명령, Jobber와 양방향 동기화는 핵심 CRUD 뒤의 별도 검토 항목이다. 제품 기능을 참고하는 일과 Jobber 계정 연동 개발은 구분한다. 재인증 없이도 공식 자료 기반 설계와 로컬 구현 준비는 진행할 수 있다.

## 4. 화면 구조와 친화적인 사용 흐름

### 4.1 공통 프레임

- 좌측 메뉴는 `Workspace`(Overview·Clients·Enquiries·Quotes·Schedule·Jobs), `Business`(Orders·Inventory·Invoices·Reports), `Administration`(Settings)로 묶는 안을 사용한다. 프로퍼티는 Clients 하위, 계약·결제는 견적/청구 상세의 관계 탭으로 시작한다. 미구현 메뉴의 준비 상태는 실제 기능 출시 때 해제한다.
- 상단은 breadcrumb, 화면 제목, 권한에 맞는 `New…` 작업, 검색으로 구성한다. 전역 검색은 준비된 고객·현장·견적·예약부터 검색하며 모든 준비 메뉴를 검색된 업무로 표시하지 않는다.
- 각 목록은 제목/설명 → 검색·상태·기간 필터 → 결과 수·정렬 → 목록 → 페이지 이동으로 통일한다. 필터와 선택 행을 뒤로가기에서 복원하고 개인정보는 URL이나 브라우저 저장소에 넣지 않는다.
- 데스크톱은 목록 + 선택 상세 요약을 사용할 수 있다. 복잡한 견적/예약 편집은 안정적인 상세 경로에서 연다. 모바일은 목록 → 전체 너비 상세/편집으로 전환한다.
- 상세 상단에 고객·프로퍼티·업무 상태·금액/다음 방문·마지막 갱신·다음 행동 하나를 둔다. 주요 작업은 `Save`/`Confirm` 중 해당 상태의 작업 하나, 나머지는 보조 버튼/More 메뉴에 배치한다.

### 4.2 페이지별 구성

| 화면 | 기본 화면 | 상세·주요 작업 |
| --- | --- | --- |
| Overview | 오늘 일정·확인 필요 큐, 4 KPI, 유입/상태 그래프 | 카드/항목을 누르면 동일 필터의 전체 목록 또는 해당 업무 |
| Clients | 이름, 주 연락처, 현장 수, 최근 업무, 상태 | Summary·Properties·Quotes·Jobs·Orders·Billing·Activity. 기존 고객 사용/수정/보관·복원 |
| Property | Clients 안의 현장 목록 | 주소·현장 연락 담당·메모·관련 일정/견적/작업. 현장 추가·수정·보관 |
| Enquiries | 채널·고객·현장·접수일·담당·검토 상태 | 접수 요약, 메모/할 일, 고객·현장 연결, 견적 전환. Gmail 원본은 읽기 근거로 보존 |
| Quotes | 고객·현장·견적 상태·예상/회사 금액·마지막 변경 | 사진/가격 근거·원본·회사 초안·예약·문서·이력. 새 견적·초안 저장·수정·보관/취소 |
| Schedule | Sydney 일/주/목록, 날짜·상태 필터 | 예약 요약→방문 기간 편집→저장 또는 확정. 외부 변경/실패는 검토 큐 |
| Jobs | 작업 상태·담당·현장·예정/기한 | 지시·방문·체크리스트·사진·완료. 예약 확정과 작업 완료를 별도 기록 |
| Orders / Inventory | 고객 주문 / 품목·위치·가용량 | 주문 상태·배송·반품 / 자재 입출고·사용·조정·구매. 판매 주문과 회사 매입을 구분 |
| Invoices | 초안·발행·미수·수금·취소 | 라인 항목·세금·발행본·수금/환불/대사. 금액과 수금 상태를 별도 |
| Reports / Settings | 실제 연결 자료의 보고서 / 설정 그룹 | 저장된 보고서 필터·내보내기 / 회사·서비스/가격·사용자·연결·세션 설정 |

### 4.3 화면 밀도·상태·접근성

- 브랜드 색은 현재 `--site-*` 토큰을 참조한다. EMS 전용 글자 크기와 간격 alias를 두어 마케팅용 대형 제목/섹션 여백이 업무 화면을 차지하지 않게 한다. 본문은 14–16px 상당의 rem, 중요 제목은 24–32px 상당을 시작안으로 사용하고 200% 확대를 검증한다.
- 목록은 주요 5–7개 정보만 기본 노출, 긴 주소·설명은 상세로 이동한다. 짧은 상태 배지에는 텍스트를 함께 써 색에만 의존하지 않는다.
- 장문 AI 설명·규칙·원본 확인은 관련 탭/펼침에 넣는다. 금액에 영향을 주는 미산정 범위·미확정 상태는 요약에서도 표시한다.
- 저장 상태는 `Unsaved → Saving → Saved at …`, 실패는 인라인 오류와 재시도. 읽기/저장 실패와 진짜 0건, 아직 미구현 상태를 구분한다. 성공 알림은 실제 서버 저장 결과 이후에만 표시한다.
- 클릭 가능한 행에는 별도 상세 링크/버튼을 두고 키보드로 같은 작업을 수행한다. dialog/drawer는 이름·Escape·초점 제한·닫은 뒤 초점 복귀를 갖춘다.
- 터치 대상은 글로벌 디자인의 기본 목표 48px·최소 44px로 통일한다. 현재 EMS의 여러 컨트롤은 44px 기준이며 폼 입력 글자는 16px 이상으로 정리한다. 긴 표는 필요한 열의 표 내부 스크롤 또는 카드 요약으로 전환하고 문서 전체의 가로 넘침을 막는다.
- 320/390/768/1280/1440px, 긴 이름·주소·금액, 빈/로딩/오류/만료, 키보드와 차트 대체 표를 인수 조건으로 둔다. 언어는 기존 영문 운영 UI를 기본으로 하며 한글 UI는 별도 글리프/번역 검토 뒤 연결한다.

### 4.4 애니메이션 기준

| 상호작용 | 계획 | 목적 |
| --- | --- | --- |
| 포인터 버튼 누름 | 100–160ms, 미세한 active transform | 입력 반응 확인 |
| 팝오버 | 125–180ms opacity·미세 transform, 트리거 기준 origin | 메뉴 위치와 열림 상태 이해 |
| 상세 drawer / dialog | 180–240ms, 짧고 중단 가능한 transition | 목록과 상세의 공간 관계 |
| 저장 결과·오류 | 빠른 상태 교체, `aria-live`로 결과 전달 | 처리 결과를 명확하게 알림 |
| 매번 쓰는 목록·탭·키보드 이동 | 즉시 반응, 진입 stagger/count-up 제외 | 반복 업무의 속도 유지 |
| reduced motion | 위치·확대 움직임 제거, 필요한 짧은 opacity만 | 움직임에 민감한 사용자 지원 |

`emil-design-eng`의 빈도·목적·빠른 피드백 기준을 적용한다. CSS의 명시적 `opacity / transform`을 우선 사용하며 `transition: all`, 반복 장식, 숫자 집계 애니메이션은 넣지 않는다. 애니메이션 중에도 클릭·Escape·다시 열기와 저장 결과 처리를 막지 않는다. 동적 제스처가 실제로 필요해지면 Motion을 검토하고 공식 문서를 확인한 뒤 사용한다.

## 5. 반복 레이아웃의 글로벌 CSS와 컴포넌트

스타일 원본은 글로벌로 재사용하고 업무 동작은 모듈에 둔다. R1에서 아래 관리자 CSS 4개와 `src/shared/ui/admin/index.tsx`의 실제 반복 UI를 생성했다. 브랜드 원본은 유지하고 업무별 고유 표현은 모듈에 남겼다.

| 예정 경로 | 책임 |
| --- | --- |
| `src/shared/styles/tokens.css` | 기존 브랜드 색·서체·기본 motion 원본. 같은 색상 값을 별도 정의하지 않음 |
| `src/shared/styles/admin-tokens.css` | EMS 타입·여백·폭·밀도·z-index·motion alias. `--site-*`를 참조 |
| `src/shared/styles/admin-layout.css` | 공통 shell, page header, toolbar, split/list-detail, responsive grid, sticky action 영역 |
| `src/shared/styles/admin-components.css` | panel, table/list, field, buttons, badge, tabs, pagination, drawer/dialog, loading/empty/error/result |
| `src/shared/styles/admin-motion.css` | 짧은 공통 transition와 reduced-motion 규칙 |
| `src/shared/ui/admin/*` | PageHeader·ListToolbar·RecordList·RecordSummary·DetailTabs·FormActions·StatusBadge·RecordDialog·EmptyState·MutationResult 등 실제 반복되는 UI |
| `src/modules/*/presentation/*` | 견적 가격표·예약 구간·재고 원장 등 해당 업무만의 표현과 동작 |

로드는 관리자 조립 지점 한 곳에서 관리한다. 루트 `globals.css`는 기존 브랜드·기본 접근성만 맡기고 EMS 프리미티브는 `.ems-root / .ems-*`로 범위를 제한한다. 홈페이지·고객 견적 폼의 `button / input / h2`를 포괄 선택자로 변경하지 않는다.

EMS 루트는 `AdminWorkspaceStateProvider`의 **children와 sibling leave-dialog를 함께 감싸는 범위**까지 적용하거나 공통 dialog 루트에도 동일 alias를 제공한다. 현재 `.admin-workspace` 내부에만 변수를 두면 저장하지 않은 변경 dialog에 상속되지 않는다. 기존 class는 페이지별 이관 중 어댑터로 유지하고, 마지막 소비자가 이관된 뒤 중복 CSS override를 제거한다. 기존 브랜드 토큰 전체를 업무용으로 축소하지 않는다.

`SavedPhotoAnalysis`처럼 고객과 직원이 함께 쓰는 TSX는 관리자 전용 표현 옵션/adapter로 요약·접기를 적용한다. 공통 컴포넌트 자체를 바꾸어 고객 화면에서도 중요한 가격 근거·주의사항이 사라지게 하지 않는다. CSS 범위와 공유 컴포넌트의 동작을 모두 검증한다.

## 6. 고객 중복 방지와 여러 프로퍼티

### 6.1 사용자에게 보이는 결과

1. 저장된 견적에서 `Use existing client / Create client`를 연다. 이미 연결된 견적은 기존 고객으로 바로 이동한다.
2. 서버가 확인한 동일 고객이면 **새 고객을 만들지 않고 재사용**한다. 같은 고객의 신규 현장은 `Add property`로 추가한다.
3. 같은 고객·같은 현장의 다른 견적은 고객 1명·현장 1개에 여러 견적으로 연결한다. 같은 고객·다른 현장은 고객 1명·현장 N개로 연결한다.
4. 여러 후보, 공유 연락처, 이메일과 전화가 서로 다른 고객을 가리키는 경우에는 신규 고객을 만들지 않고 후보 검토/선택을 요구한다. 이름만 같거나 주소만 같다는 이유로 병합하지 않는다.
5. 중복된 기존 자료는 별도의 `Merge clients` 영향 미리보기에서 고객·현장·견적·예약·청구 관계를 확인한 뒤 관리자가 정리한다. 연락처만 맞는다고 고객 로그인 권한이나 결제 동의를 이전하지 않는다.

후보 검토 결과 같은 연락처를 사용하는 **실제 다른 고객**으로 확인되면 사유를 기록하고 별도 고객 생성이 가능하다. 이 선택은 동일 고객을 중복 생성하는 우회 버튼으로 제공하지 않는다.

### 6.2 고객과 현장 모델

- `lk_customers`: 고객 이름/회사 여부, 연락처, 청구 주소, 활성/보관 상태, revision. 고객 자체의 주소와 현장 주소를 분리한다.
- `lk_customer_properties`(신규 제안): customer FK, 구조화 주소·unit, 표시명, 연락 담당/현장 메모, 활성/보관 상태, revision.
- `lk_quote_requests.customer_id`를 운영 견적 고객 관계의 원본으로 사용하고 `property_id`를 추가한다. 같은 관계를 기존 `lk_customer_record_links`에도 이중 저장하지 않는다.
- 현재 `enquiry / submission` 수동 연결은 유지하고 고객 통합 조회 projection에 `quote_request`를 추가한다. 각 견적/예약/작업의 고객·현장 관계는 company/customer/property FK 조합으로 교차 연결을 막는다.
- 고객 Auth의 `lk_quote_request_access`는 로그인 권한이며 CRM 고객 관계와 별도다. CRM 연결/병합만으로 다른 요청의 고객 열람 권한을 부여하지 않는다.
- 현장 주소 변경은 다음 업무의 현재 주소에 반영한다. 이미 서명/발행된 견적·PDF·예약의 당시 주소 snapshot은 보존한다. 고객 보관 시 현장·견적·예약을 cascade 삭제하지 않는다.

현재 `CustomerSourceType`, `CreateCustomerInput`, `lk_customers_command`는 이 구조를 지원하지 않는다. 고객 모델·API·projection·기존 시험을 함께 확장해야 하며 단순 폼 변경으로 완료하지 않는다.

### 6.3 동일성·동시 저장 계약

- 확실한 관계의 우선순위는 이미 연결된 customer ID → 관리자 검토로 고정한 동일성 관계 → 충돌 없는 확인된 식별 관계다. OTP로 이메일 소유를 확인한 사실과 CRM의 동일한 사람/회사라는 판정은 구분한다.
- 이메일은 공백/정해진 대소문자 정규화만 하고 Gmail 점/플러스 alias를 임의 합치지 않는다. 전화는 국가 정보를 포함해 정규화한다. 이름·주소 유사도는 검토 후보를 만드는 근거다.
- 가족·회사 공용 이메일/전화는 여러 고객이 사용할 수 있다. 전 고객의 `email`에 단순 unique를 걸어 다른 사람을 강제 병합하지 않는다. 독점으로 확인한 identity와 공유 연락처를 구분하고 후보가 모호하면 생성/자동 연결을 멈춘다.
- 후보가 실제 다른 사람/회사라는 관리자 검토 결과는 사유와 함께 저장한다. 동일 원본 또는 확정된 동일성 관계의 동시 생성은 1건, 공유 연락처를 쓰는 별도 고객은 정상 생성 가능해야 한다.
- 신규 생성·기존 고객 재사용·현장 재사용/추가·견적 연결·감사 기록은 하나의 서버 트랜잭션으로 완료한다. 회사별 동일성 키와 원본 ID에 잠금/고유 제약을 두고 DB 충돌 시 기존 결과를 다시 읽는다. 브라우저 중복 검사와 멱등 키만으로 동시 생성 차단을 대신하지 않는다.
- 현장 중복 판정은 customer 범위에서 한다. unit/apartment를 보존하며 주소의 문장 차이만으로 새 현장을 만들지 않는다. 표준 주소 식별이 불충분하면 관리자 확인으로 기존 현장 사용 여부를 결정한다. 다른 고객의 같은 건물은 별도 고객의 현장일 수 있다.
- 보관 고객도 중복 검색에 포함한다. 같은 고객이면 복원 여부를 보여주고 새 중복 고객으로 생성하지 않는다. 식별 연락처 수정·merge도 같은 충돌 검사를 거친다.
- 응답은 `client_created / client_reused / property_created / property_reused / needs_review`처럼 결과를 구분하며 현재 권한에서 허용되는 최소 정보만 반환한다. 재시도는 같은 멱등 키·고정 payload를 유지한다.

### 6.4 견적 원본·기존 인가 보존

현재 `src/modules/quotes/requests.test.mts`는 연락처 기반 자동 CRM 생성/병합을 금지하는 기존 계약을 검증한다. 이번 설계는 **검증된 요청의 관리자 연결 또는 명시적인 CRM 처리 시점**을 추가하는 변경이다. 익명 초안 자동 저장·사진 분석에서는 고객을 자동 생성하지 않는다. 기능 구현 때 기존 검사를 삭제하는 대신 익명 무생성, 검증된 연결, 중복 재사용, 공유 연락처 검토를 나눠 검증한다.

CRM 연결용 `crm_revision` 또는 별도 연결 revision을 콘텐츠 revision과 분리한다. 현재 예약 승인본의 source-current 검사는 `a.input_revision = r.revision` 조건을 사용하므로, 고객/현장 연결만으로 `lk_quote_requests.revision`을 올리면 기존 승인이 오래된 것으로 판정될 수 있다. 완료된 AI 분석의 현재성 판단과 이 예약 승인본 조건은 구분한다. 근거는 `supabase/migrations/20261012214515_live_quote_completed_analysis_source_current.sql`이다. CRM 연결은 기존 payload·content revision·분석·사진 manifest·서명·PDF hash를 바꾸지 않는다.

기존 고객 `address`는 의미가 혼재되어 있어 전부 청구 주소나 현장으로 자동 이관하지 않는다. dry-run 목록에서 출처/의미·후보 고객·후보 현장·모호한 건을 분리한다. 검토한 자료만 batch로 연결하고 실행 ID·결과를 남긴다. 원래 폴더의 견적 UI 변경은 통합 가능한 main 반영 뒤 재대조한다.

## 7. 모든 카테고리의 저장·수정·삭제 계약

모든 관리 대상에 생성/저장·수정·삭제에 해당하는 실제 서버 기능과 권한 검사를 둔다. 삭제의 이름과 효과는 데이터 상태에 맞게 표시한다. 기본 삭제는 복원 가능한 휴지통/보관이고 확정 기록은 취소·무효·정정으로 처리한다. 영구 삭제·보존 기간은 별도 데이터 정책 검토 대상이다.

| 카테고리 | 현재 확인된 범위 | 생성·저장 / 수정 계획 | 삭제·취소·복원 계획 |
| --- | --- | --- | --- |
| Overview | 원본 업무 바로가기, 집계 준비 화면 | 집계는 조회 전용, 생성·수정은 소유 업무로 연결. 저장 보기를 도입하면 그 정의만 CRUD | 집계 숫자를 삭제하지 않음. 저장 보기 정의 삭제는 별도 기능 |
| Clients | 목록·상세·생성·원본 연결/해제. 정보 수정/삭제/중복 차단 없음 | 생성 전 중복 검사, 정보 편집, 관계/메모, merge 검토 | 보관/복원, 참조 없는 초안 고객은 휴지통. 연결 기록 cascade 제거 금지 |
| Properties | 독립 모델 없음 | 한 고객에 여러 현장, 주소/연락 담당/메모 저장·수정 | 미사용 현장 휴지통/복원. 관련 업무가 있으면 보관하고 과거 주소 유지 |
| Enquiries | Gmail/web·이전 데모 목록, 일정 검토와 기존 처리 | 수동 접수, 담당·메모·분류·후속 할 일, 견적 전환 | 업무 접수 보관/복원. Gmail 원본이나 외부 메일은 삭제하지 않음. 수집 ID를 유지해 재생성 방지 |
| Quotes | 고객 정보/서비스 선저장, 사진·분석·요청/서명 조회. 직원 임의 원본 편집 아님 | 고객·현장 선택의 관리자 초안, 회사 수량/항목/가격/조건 버전, 저장·검토·발행 구분 | 초안 휴지통/복원, 발행/승인본 철회·대체 버전. 서명본·PDF 보존 |
| Contracts / documents | 서명된 예약 요청·고정 PDF. 정식 계약 관리 모델은 없음 | 문서 종류·버전·정식 약관 검토 후 계약 초안·발행·서명 연결 | 초안 휴지통, 서명/발행본 종료·철회 상태와 정정 이력. 원본 삭제로 대체하지 않음 |
| Bookings / Schedule | 실제 회사 초안/확정·기간 점유·Google 검증·재시도·변경 대사 | 단순 예약의 독립 초안 저장, 일정 변경 초안·충돌 검토·확정, 취소 상태 | 초안 휴지통. 확정은 취소 요청→외부 일정 확인→최종 취소/점유 해제. 실패 시 검토/재시도 상태 유지 |
| Jobs / visits / tasks | 준비 화면, 작업 원장 없음 | 예약→작업 생성 멱등 연결, 담당·지시·방문·체크리스트·작업 완료·앱 내 할 일 | 초안 휴지통, 진행/완료 작업 취소·정정. 완료 사진/보고 이력 유지 |
| Orders | 준비 화면, 판매/배송/반품 없음 | 고객 주문 초안·품목·상태·배송·반품 기록 | 초안 휴지통, 확정 주문 취소·반품. 결제/재고 복구는 연관 command로 처리 |
| Inventory / purchasing | 준비 화면, 자재·입출고 모델 없음 | SKU/작업 자재, 위치, 입고·출고·작업 사용·실사 조정. 공급업체/발주는 구매 범위에 포함 | 품목 보관/복원, 원장 역분개/정정. 수량 이동 삭제로 과거 가용량을 바꾸지 않음 |
| Invoices / payments | 원장 미구현 | 작업/주문에서 청구 초안, 발행본, 수금·부분 수금·대사. 외부 결제는 제공자/회사 정책 준비 뒤 | 초안 휴지통, 발행본 무효/정정·수금 기록 역처리·환불. 확정 원장 직접 덮어쓰기 금지 |
| Settings / service catalog | Google owner 설정·자기 세션 기능 | 회사 설정·가격표/서비스·사용자 권한·연결 설정을 그룹별 저장·수정 | 불필요한 사용자/연결 비활성·회수, 참조된 가격 버전 보존. 직원/고객 Auth와 CRM 삭제는 별도 |
| Reports | 준비 화면 | 보고서 정의·필터/기간 저장·수정·삭제, 생성 파일 목록 | 저장 정의/생성 파일 휴지통·삭제. 보고서의 집계 원본은 해당 업무에서 정정 |
| Notes / photos / activity | 고객 사진 비공개, 업무 감사 이력 일부 존재 | 현장/작업 메모·새 첨부 업로드·검토·첨부 관계 관리 | 미사용 첨부 휴지통/정리, 서명/발행 snapshot 참조 사진 보존. 감사 이력은 수정/삭제 UI 대상 제외 |

작업 청구에는 [25번 기존 계약](../plans/25-kcp-quote-to-booking-implementation.md)의 **owner 권한 사용자의 명시적 Complete → 최종 인보이스 1회 → 실제 발행일 +3 달력일(Sydney)** 조건을 유지한다. 자동 일정 종료나 예약 확정으로 작업 완료/발행을 실행하지 않는다. 고객 상품 주문의 청구 시점은 별도 주문 정책에서 정하며 작업 Complete 조건을 적용하지 않는다.

### 공통 서버·UI 동작

- 변경마다 최신 직원 인가·company 범위·유효 세션·허용 명령을 검사한다. UI 버튼 숨김만으로 인가를 대신하지 않는다. owner 연결/사용자 관리 권한은 기존 별도 정책을 유지한다.
- 수정은 expected revision, 저장/전환/취소는 멱등 키, 요청 payload hash, actor·사유·이전/새 상태·시각 감사 기록을 갖춘다. 409에서는 입력을 보존하고 최신본/차이를 보여준 뒤 다시 확인한다.
- 삭제 dialog는 이름·관련 고객/현장·영향 받는 자료·복원 가능 여부·다음 효과를 보여준다. 참조가 있으면 삭제를 제한하거나 적절한 취소/보관 동작을 제시한다. 화면에서는 실제 효과에 맞는 용어를 사용한다.
- 저장·삭제 중 이동/닫기 보호, 실패/결과 불명 시 같은 명령 상태 조회·재시도, 취소 dialog에서 아무것도 쓰지 않음을 검증한다. 소프트 삭제 복원도 당시 revision과 중복/관계 제약을 다시 검사한다.
- Google·메일·결제와 DB는 단일 원자 transaction으로 묶을 수 없다. 로컬 명령/처리 큐와 기존 worker·대사 구조를 확장한다. 취소/변경 실패를 성공으로 표시하지 않으며 외부 확인 전 점유 해제나 반복 메일을 실행하지 않는다.
- 공개 schema의 신규 표는 RLS·최소 권한, RPC의 안전한 search_path·실행 권한을 검증한다. 브라우저에 service secret을 주지 않는다. [Supabase RLS 공식 문서](https://supabase.com/docs/guides/database/postgres/row-level-security)를 기준으로 기존 서버 전용 접근 방식을 확장한다.

## 8. 구현 순서·소유 범위·완료 기준

작업 일수 대신 검증 가능한 작은 완료 단위로 진행한다. **첫 제품 구현 묶음은 R1 → R2 → R3a**다. 공통 화면을 읽기 쉽게 만들고 고객/현장과 현재 견적·예약까지 실제 CRUD를 연결한 뒤 대시보드와 새 업무 모델로 넓힌다.

| 순서 | 작업 | 주요 파일/모듈 책임 | 완료 기준 |
| --- | --- | --- | --- |
| R0 — 이번 계획 | main 대조·분리 브랜치, 현재 기능/화면·Jobber 분석, 계획·진행표/TODO | 주 에이전트·analyst | 계획 링크/상태 검증. 제품 구현과 구분 |
| R1 — 공통 UI | EMS tokens/layout/components/motion, shell·경로 resolver, 목록·상세·상태/폼 프리미티브, Clients/Quotes/Schedule 읽기 화면 이관 | analyst UX 판단 → implementer: shared UI/CSS·admin-dashboard. 동일 파일 편집은 순차 | 주요 정보/다음 작업이 먼저 보임, 상세 경로·반응형·키보드·reduced motion·홈/고객폼 영향 검사 |
| R2a — 고객·현장 | 모델/계약·기본 수정·보관/복원, 복수 현장, 중복 후보 검색·원자 생성/재사용 | implementer: customers domain/application/infrastructure, SQL·API. UI는 API 계약 확정 후 | 같은 원본/확정된 동일성의 고객 동시 생성 1건, 다른 현장 추가, 공유 연락처의 별도 고객 검토, 주소/unit 보존, 수정 충돌/복원 검사 |
| R2b — 견적 CRM 연결 | quote_request projection·고객/현장 연결, 별도 CRM revision, 기존 자료 dry-run·중복 정리/merge preview | implementer: customers/quotes 공개 포트·연결 API, migration | 같은 견적 재연결/새 탭 재시도 무중복, 원본 payload/revision/서명/PDF/사진 그대로, 고객 권한 확대 없음 |
| R3a — 현재 업무 CRUD | 문의 담당/메모/보관, 직원 견적 초안 편집/저장·상태 필터, 단순 예약 Save draft·수정/취소와 외부 검증 | implementer: enquiries/quotes/bookings·routes·UI. analyst 상태/테스트 판정 | 저장/수정/삭제 의미가 실제 서버에 존재, 기존 단일 Booking confirm·Google 점유/재시도·고객 복구 회귀 |
| R3b — 견적/문서 변경 | 현장 수량·추가 항목·회사 금액 버전, 변경 비교·필요한 고객 재확인, 계약 초안/서명 관계 | analyst 정책/변경 흐름 → implementer | 이미 서명한 예상본을 보존하며 새 회사본/고객 동의·문서로 연결. 정식 약관 확정 전 요청 서명을 계약으로 승격하지 않음 |
| R4 — Overview/검색 | 운영 원본 전체 집계 API, 4 KPI·그래프·오늘 agenda·주의 큐·동일 필터 drilldown, 준비된 원본 전역 검색 | implementer: admin-dashboard application/ports/DB read·presentation; analyst 지표/수치 판정 | pagination 제한 넘는 집계, live/demo·중복·Sydney 날짜/DST·부분 실패·목록 일치·권한 검사 |
| R5 — Jobs | 작업/방문/앱 내 할 일·담당·체크리스트·메모/사진·완료, 일정 연결 | analyst 업무 상태 → implementer: jobs 새 모듈·bookings 공개 포트 | 같은 예약 재처리로 작업 1개, 작업별 저장·수정·취소/보관·완료. 일정 확정을 완료로 표시하지 않음 |
| R6 — Orders/재고/매입 | 상품/자재·공급업체·발주·입고·작업 사용·고객 주문/배송/반품 원장 | analyst 수량/주문 규칙 → implementer: 필요한 commerce/inventory/purchasing 모듈 | 주문/재고 중복 처리 방지, 원자 예약·가용량, 사용/취소/반품 역처리, 품목 보관/복원 |
| R7 — 청구/수금/Reports | 인보이스·수금/환불/대사, 준비된 업무 수치/저장 보고서, Settings 확장·고객 문서 허브 | analyst 금액/권한 정책 → implementer: billing/reports·설정·고객 접근 | owner Complete·최종 청구 1회·발행일+3일 계약, 발행본 보존, 금액/세금·부분 수금·취소·환불 대조, 주문 청구 조건 별도 |
| R8 — 통합 인수 | 주요 고객→현장→견적→예약→작업→주문/재고→청구 시나리오, 실행 기록·문서 갱신 | implementer 실행 + analyst QA 판정 + 주 에이전트 통합 | 단계별 회귀·실제 사용자 인수·남은 제한을 구분하고 TODO 일치 |

R4는 R2b·R3a 상태/연결 계약이 고정된 후 진행한다. R5 이후는 해당 업무 규칙과 모델을 먼저 확정한다. 청구·재고·정식 계약 정책이 미확정이어도 R1/R2/R3a 준비를 막지 않는다. 기존 EMS-D2는 R4, EMS-D3는 R1/R2/R3, EMS-D4/D5는 R5/R6/R7로 연결해 중복 구현하지 않는다.

첫 구현 착수 시 main에 다른 견적 UI 작업이 추가로 통합됐다면 기준 커밋을 다시 대조하고 이번 브랜치에 필요한 변화를 반영한다. 파일 소유를 분리해 공유 UI/CSS와 고객/견적 데이터 명령을 동시에 같은 파일에서 편집하지 않는다. analyst는 설계·QA 판정, implementer는 코드·테스트 구현/실행을 맡으며 확정된 저위험 간격/문구 조정만 quick_edit에 배정한다.

### 8.1 기존 admin 적용 방법

1. `src/app/admin`은 메타데이터·라우팅·모듈 조립을 유지한다. `StaffAdminBoundary`, 기존 API 인가와 개인/회사/고객 세션 경계를 재사용한다.
2. 현재 각 업무 콘솔은 먼저 공통 UI를 소비하도록 이관한다. CRUD 모델은 별도 단계에서 연결하고 페이지 이관 때문에 기존 server business command를 복제하지 않는다.
3. `AdminSection`을 목록과 상세 조립으로 나누고 필요한 `/admin/customers/[id]`, `/admin/customers/[id]/properties/[propertyId]`, `/admin/quotes/[id]` 등 경로를 추가한다. 기존 주소/OAuth 복귀·deep link와 guarded navigation을 함께 확인한다.
4. 고객·견적·예약은 각 모듈 공개 entrypoint/port로 조합한다. Quotes가 Customers의 내부 DB 파일을 import하는 구조를 만들지 않는다.
5. 기존 원본 조회와 새로운 고객/현장 관계는 단계적으로 연결한다. 추가 column/table·projection을 먼저 도입하고 검토된 backfill 뒤 UI를 전환한다. old schema/자료를 즉시 제거하지 않는다.
6. UI 문제의 복구는 같은 직원 인증 아래 화면 분기로 처리한다. 새 데이터가 생긴 뒤 schema를 삭제하는 방식의 rollback은 사용하지 않는다.
7. 공통 Operations 자동 동기화는 한 곳에서 유지한다. 상세 polling은 표시 중인 상세에만 실행하고 이탈 뒤 중단한다. 401/403은 개인정보·초안을 제거하며 늦게 도착한 이전 응답이 화면을 복구하지 않도록 요청 수명 경계를 보존한다.

### 8.2 새 API 계획 — 아직 없음

고객 정보 PATCH, 고객/현장 archive·restore, 현장 list/create/update, 중복 후보 검색, 운영 견적 CRM 연결, 고객 merge preview/commit, 서버 초안 저장·예약 change/cancel API가 필요하다. URL과 DTO는 R2/R3 계약 리뷰에서 고정한다. 기존 `POST /api/admin/customers`·원본 links 및 live booking 명령과 역할을 정리한 뒤 추가한다. generic `delete any table` 엔드포인트는 만들지 않는다.

## 9. Overview 데이터 기준

기존 08 계획의 4 KPI를 현재 운영 견적/예약 원본으로 갱신한다. 이전 데모는 별도 legacy 필터로만 포함한다.

| KPI | R4 집계 계약 |
| --- | --- |
| 선택일 확정 예약 | 해당 Sydney 날짜에 실제 confirmed 예약 구간이 겹치는 distinct 예약 수. 두 방문/여러 구간을 예약 수로 중복 계산하지 않음. 오늘 방문 수는 별도 agenda 설명 |
| 회사 확인 대기 | 서명된 운영 요청 중 회사 확정 처리가 아직 시작되지 않은 distinct 요청 수. `confirming`은 처리 중 큐, 확정 후 `review_required`는 대사 검토 큐로 구분하며 이 KPI에 다시 포함하지 않음 |
| 최근 7일 문의 | Sydney 오늘 포함 7일간의 운영 견적 접수와 Gmail 접수의 canonical 원본 수. 동일 요청의 파생 행을 중복 계산하지 않음 |
| 고객·현장 연결 필요 | 운영 원본 중 고객 또는 현장 연결이 완료되지 않은 canonical 원본 수. 모호한 연결은 검토 큐에 유지 |

최종 필드/상태 predicates는 R3 계약 이후 SQL·검사에 고정한다. 막대 그래프는 날짜별 접수, 상태 분포는 현재 스냅샷, 일정은 구간별 시간순이다. 집계는 전체 모집단 서버 조회를 사용하고 목록 배열 길이를 이용하지 않는다. 응답은 기준 시각·기간·timezone·각 위젯의 ready/unavailable/error를 포함한다. 차트와 표·드릴다운은 같은 필터/원본 정의를 쓴다. 고객 수, 견적 예상액, 확정 예약, 완료 작업, 실제 수금은 각각 별도 의미다.

확정 후 대사 문제에서는 저장된 확정 구간과 점유를 유지하고 agenda에 검토 필요를 함께 표시한다. 저장 일정의 존재를 현재 Google 정상 검증으로 표현하지 않으며 마지막 확인 시각과 검토 큐를 구분한다.

## 10. 검증과 단계별 인수

- **UI/UX:** 모든 화면의 주요 정보를 빠르게 찾는지, 목록→상세→수정→저장→복귀, 취소/복원과 unsaved 상태, back/forward, deep link, 확대·모바일·키보드·초점 복귀, loading/error/empty를 확인한다. 개선 전/후 대표 화면은 합성 자료로 기록한다.
- **고객/현장:** 같은 연락처의 동일 고객·표기 차이·서로 다른 unit·가족/회사 공유 연락처·충돌 후보·보관 고객·여러 견적/탭/실제 별도 DB 세션 동시 저장, 재전송·원래 저장 결과 유실을 검증한다. 목표는 동일 고객 1개와 올바른 현장 N개다.
- **원본 보존:** CRM 링크/merge·정보 수정 전후 quote content revision·사진 manifest·분석·서명·PDF hash를 대조한다. CRM 연결로 고객 접근 권한이 넓어지지 않는지 검사한다.
- **CRUD:** 카테고리별 허용 상태/권한·유효한 생성/수정/삭제·복원, 참조 제한, revision 409·멱등 payload 변경 거절·결과 불명 상태·필드 검증·외부 실패를 검사한다. 동일 UI 문자열을 반복하는 시험을 늘리지 않는다.
- **예약/외부:** 초안 저장의 Google/메일/점유 변화 없음, confirm 한 번·동시 확정·서버 충돌 재검사, 취소/변경의 외부 오류·재시도·구간 점유 보존과 최종 해제를 대조한다. 실제 메일·Calendar 변경 인수는 지정 시험 자료와 동작으로 진행하고 로그에 구분한다.
- **기술:** 변경 모듈 검사 + `npm run test:operations` + `npm run check`를 적절한 단위에 실행한다. PGlite 기능 시험과 별도 PostgreSQL 동시성 시험을 구분한다. 코드 작성 전에 설치된 Next.js 16 문서와 실제 의존성을 다시 확인한다.
- **DB/전환:** 추가 migration의 원본 보존·권한·회사 간/고객 간 관계·index·실제 질의를 검증한다. 운영 적용 전에 Supabase 실제 PG/extension 버전과 현재 changelog의 관련 변경을 재확인한다. 현재 changelog 읽기는 완료했고 실제 회사 DB 버전/영향 검사는 이번 계획 범위에서 수행하지 않았다.
- **진행표:** `계획 / 코드 / 자동 검사 / 합성 브라우저 / 회사 적용 / 실제 인수`를 따로 기록한다. 계획 단계의 기존 728개 통과 이력은 이번 변경의 새 시험 결과로 사용하지 않는다.

## 11. 실행 체크리스트와 남은 결정

- [x] R0: 회사 main fetch·동일 커밋 확인, 새 브랜치와 작업 폴더 생성, 기존 미커밋 작업 보존.
- [x] R0: 현재 소스/Enquiries 실제 데스크톱 확인, 두 analyst 분석, Jobber 도구/공식 기능 조사.
- [x] R0: 구현순서·고객/프로퍼티·CRUD·글로벌 CSS·애니메이션·회귀/이관 계획과 기존 진행표/TODO 연결.
- [x] R1: 공통 UI/CSS·화면 이관 구현, 739/739·lint/타입/build·합성 13+1+4. 회사 적용/실제 새 UI 인수·물리 기기는 별도 미실행.
- [ ] R2a/R2b: 고객·프로퍼티·중복 방지·운영 견적 연결 구현/동시성·원본 보존 검증.
- [ ] R3a/R3b: 문의/견적/예약 저장·수정·삭제/취소 및 새 회사본/문서 흐름.
- [ ] R4: 전체 집계·KPI/차트/일정·드릴다운/검색.
- [ ] R5/R6/R7: 작업·주문·재고/매입·청구/수금/보고/설정.
- [ ] R8: 단계별 실제 인수와 운영 제한 정리.

계획의 기본안은 기존 영문 UI·브랜드 유지, 동일 앱/DB, 복원 가능한 삭제, 운영 견적의 검증/검토 시점 CRM 연결이다. 구현 시작 전에 해당 단위에서 구체화할 결정은 공유 연락처 고객 판정·기존 자료 연결 기준, 작업 시작/완료·담당/자원, 상품과 작업 자재 범위, 인보이스/수금/환불·정식 약관, 삭제 보존 기간이다. 새 비용/제공자·공개·외부 발송은 각 기능 준비 결과와 기존 사용자 승인 범위를 대조한다.

## 12. 최초 계획 작성의 확인 수준

이번에는 Git 기준·읽기 분석·실제 Enquiries 화면 관찰·공식 자료 조사·계획 문서/링크/진행 상태를 확인했다. 제품 코드·DB schema를 바꾸지 않았으므로 앱 테스트/빌드·새 UI/CRUD의 실제 동작을 완료로 표시하지 않는다. Jobber 연결의 재인증 제한과 다른 진행 중인 견적 UI 미커밋 작업을 다음 구현 착수 시 다시 확인한다.

두 analyst의 최종 문서 검토에서 공유 연락처 예외·CRM/예약 revision 구분·기존 청구 조건·대기 KPI 상태·입력 크기·Overview 파생 데이터·요청 수명·고객 공용 컴포넌트 범위를 반영했다. 변경 문서 6개에서 로컬 링크 350개·현재 소스 경로·문서 whitespace를 검사해 오류 0건을 확인했고 `git diff --check`도 통과했다. 08번 문서의 기존 4행 사용자 변경은 보존했다. 이번 문서 변경은 미커밋 상태다.

관련 문서: [EMS 문서 안내](README.md), [진행표](05-progress.md), [전체 TODO](../plans/15-home-cabinet-admin-todo.md), [D1 구현/검증 기록](09-2026-10-07-admin-shell-implementation-plan.md), [Supabase 최신 변경 목록](https://supabase.com/changelog), [PG minor release 관련 변경](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).

## 13. R1 실행 결과 — 2026-10-13 후속 요청

implementer 3명이 공통 CSS/shell·견적/사진·고객/합성 QA를 나눠 구현했고, 주 에이전트가 일정 UI·읽기 수명·검사/빌드/문서를 통합했다. analyst는 UI·접근성·요청 수명과 legacy 회귀를 검토했다. 새 상세 경로·그룹 메뉴, 생성 dialog·공통 tabs, 예상금액 우선 요약·관리자 분석 어댑터, 조회한 일정의 상태/날짜 필터, 글로벌 CSS/포인터 모션을 적용했다.

**Node 24.14.1/npm 11.11.0 전체 739/739·check·합성 브라우저 13+1+4 완료**. 긴 RQ 번호의 320px 넘침·legacy 고객 상세·세션 버튼·숨긴 조회 즉시 복귀·탭 panel 참조를 수정하고 관련 동작을 다시 확인했다. 고객 공용 분석/견적 TSX·브랜드 원본·업무 API·schema는 보존했다. 최종 증거와 실행 화면은 [R1 검증 기록](../verification/2026-10-13-ems-r1-common-ui.md)에 있다.

R1은 공통 화면과 기존 기능의 코드/합성 인수 완료다. 실제 회사의 새 UI 배포/인수·물리 기기/수동 확대는 미실행이며, 새 고객 중복/프로퍼티/수정·삭제는 R2, 서버 Save draft·예약 취소/일·주 캘린더는 R3 이후, 전체 지표는 R4다. 다음 구현 단위는 R2a → R2b이고 관련 데이터 계약·이관/원본 보존 검증을 먼저 수행한다. 현재 변경은 미커밋이며 main merge/push/배포를 실행하지 않았다.

## 14. R2 구현 체크포인트 — 현재 변경 커밋 요청

고객/현장 CRUD·서버 중복 검토·원자 고객/현장/견적 관계·독립 CRM revision·현재 직원 DB 검사와 관련 테스트를 추가했다. [R2 체크포인트](../verification/2026-10-13-ems-r2-customers-properties.md)에 현재 검증과 미완료 항목을 기록한다. 모호한 현장 검토의 견적 UI 연결·최신 R2 브라우저/회귀·최종 analyst 판정이 남아 있어 R2a/R2b 완료 체크는 유지한다. 회사 SQL 적용·배포·main 병합·원격 push는 수행하지 않았다.
