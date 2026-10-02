# 2026-10-02 고객 초안·Google 연동 복구 검증

Australia/Sydney · **원격 추가 스키마·실제 초안 저장/복원·자연 토큰 갱신(R01)·동시 실행 잠금(R02)·worker 신규 수신(W01)·중단 중 같은 대화 답장 복구(W02) 확인. 권한 회수/재연결 등 남은 예외는 아래에 구분**

[오늘 계획](../plans/31-google-integration-recovery-and-operation-plan.md) · [고객 전체 흐름](../plans/32-client-quote-signature-submission.md) · [TODO](../plans/15-home-cabinet-admin-todo.md)

## 구현

- `/quote/start`는 고객 정보 저장을 확인한 뒤 서비스 선택/상세 단계로 이동한다. 같은 브라우저의 유효한 HttpOnly 서명 세션으로 서버 초안을 복원한다. 저장 충돌·실패 시 입력을 유지하며 최종 제출·메일·Calendar를 만들지 않는다.
- 고객 초안의 소유 해시, 24시간 접근 만료, revision CAS, 동일 재전송, 입력/크기/Origin 검사, 세션당 저장 제한과 신규 초안 전역 제한을 구현했다. 24시간은 접근 기간이며 DB 행 자동 삭제 정책이 아니다.
- Google 인증·권한·설정·일시 오류를 구분하고 상태를 저장한다. 회사 재연결은 기존 문의·선택 대상을 보존하며 오래된 자격 증명·lease·관측 결과의 쓰기를 거부한다.
- worker/관리자는 완료·부분 처리·대상 미선택·다른 실행 중·실패를 구분한다. 일반 재시도 60초, 연결/설정 개입 필요 시 300초. 확인된 무효 Gmail 커서만 한 번 복구하고 실패를 수집 완료로 기록하지 않는다.
- 예약일 차단 순수 도메인은 Sydney 날짜·DST·다일 점유·종료 exclusive·과거·조회 실패/부분/만료 차단·제출 직전 새 조회를 검증한다. **실제 Calendar availability 어댑터·고객 달력 UI/API는 아직 연결하지 않았다.**
- 사진 저장·AI·가격표·approve·전자서명·문서 생성·Resend 발송·최종 예약 확정은 후속 구현이다. 가격과 근무/기간 산식 미정을 임의 값으로 대체하지 않았다.

## 자동 검사

- `npm run test:operations`: **80개 통과, 실패/스킵 0**. Google/Supabase 대체 전송·PGlite·도메인 시험이며 실제 제공자 장애 시험과 구분한다.
- `npm run check`: lint·타입·프로덕션 빌드 통과.
- 첫 lint에서 신규 route의 비공개 module 경로 import 2곳이 실패했다. 기존 모듈 공개 index로 고쳐 전체 check를 다시 통과했다. 규칙을 비활성화하지 않았다.
- 새 availability 시험의 경로를 package script에서 수정한 뒤 전체 80개가 실행되는 것을 확인했다.
- `git diff --check` 통과. 연결 검증 스크립트의 후속 수정은 해당 파일 lint 통과.
- 브라우저 정적 번들에서 설정된 서버 비밀 값이 포함되지 않음을 확인했다. 비밀 값은 결과에 출력하지 않았다.
- Node의 기존 SQLite experimental/모듈 형식 안내 warning은 남아 있다. 테스트 오류나 빌드 실패는 아니다.

## 실제 회사 DB 읽기와 브라우저

회사 Chrome의 `lnkgroupsydney-hub` 세션과 `xlqyafthsxallostcqfe` 프로젝트를 확인했다. 서버 Data API 읽기는 가능하다. 현재 CLI/MCP 관리 인증에는 이 프로젝트 접근 권한이 없고 CLI link/migration list는 완료하지 못했다.

추가 migration 적용 전에 SQL Editor에서 기존 스키마를 읽고 원래 migration을 PGlite에 로드한 결과와 대조했다. 원문 업무 데이터·토큰은 출력하지 않았다.

| 비교 | 실제/로컬 결과 |
| --- | --- |
| `lk_operations_command` 함수 정의 md5 | `fa5fa65322595224dd3ab5ff78dc9eca` 일치 |
| 컬럼·형식·nullable·기본값 md5 | `65602a9bd875c4bbc42a681d4923deb0` 일치 |
| 인덱스 정의 md5 | `7ae79f088beb152f116391c1cc6a0526` 일치 |
| PK/FK/unique/check 제약 정의 md5 | `099978a5f2230699aefcb40d1d05782b` 일치 |
| RLS | 기존 업무 테이블 12개 모두 enabled |
| 테이블 권한 | anon/authenticated 직접 접근 0개, service_role 12개 |
| 기존 RPC 실행 권한 | anon/authenticated false, service_role true |

제약 전체 hash는 처음 달랐다. 로컬 PGlite의 `pg_constraint`에는 NOT NULL 항목 54개가 포함되어 있었으며, 이를 제외한 hash가 원격과 일치했다. NOT NULL 자체는 별도 컬럼 nullable 비교에서 일치했다. 이 비교가 원격 migration 이력을 수리한 것은 아니다.

## 초기 실패와 후속 해결

최초 Data API 확인은 문의 2·Gmail 수신 이력 2·Calendar links/outbox/대기 변경 검토 각 0이었다. 회사 계정과 선택 라벨/Calendar는 저장돼 있었고 access token은 자연 만료 상태였다. 기존 문의·처리된 변경 검토 이력은 보존했다.

신규 스키마 적용 전에는 로컬 production 초안 페이지가 준비 실패를 표시하고 저장 성공·다음 단계 이동을 허용하지 않았다. 당시 390px 메뉴 열기·Escape 닫기, 가로 넘침 없음·관찰 콘솔 오류 없음을 확인했다. 이것을 실제 저장·복원 통과로 처리하지 않았다.

최초 `npm run test:supabase:connection`은 기존 server health/schema version 1에 성공했지만 `lk_quote_drafts` 누락으로 **exit 1**이었다. Chrome 활성 창 조작이 겹쳐 SQL 적용이 지연됐다. 자동 승인 심사 거절은 아니었다. 이 실패 기록을 보존하며, 후속으로 회사 Dashboard에서 아래 두 migration을 각각 실행해 **Success**를 확인했다.

- `supabase/migrations/20261002100953_google_connection_health.sql`
- `supabase/migrations/20261002101142_customer_quote_drafts.sql`

이미 적용한 원래 생성 SQL을 재실행하지 않았다. 적용 후 `npm run test:supabase:connection` 재검사에서 **exit 0**을 확인했다. 13개 업무 테이블·Google health 6개 컬럼·3개 RPC 존재와 유효 publishable key/anon의 직접 접근 차단을 확인했다. authenticated 역할의 세부 검사는 PGlite 결과와 구분한다.

## 고객 초안 실제 브라우저·회사 DB 검증

개인정보 없는 가상 고객 초안 1개를 실제 Supabase에 저장하고 브라우저 결과와 DB 상태를 대조했다. 확인 스크린샷은 저장하지 않았다.

| 시험 | 실제 결과 |
| --- | --- |
| 고객 선저장 → 서비스 정보 | 첫 고객 정보 저장 후 같은 초안에서 문 수량 6 입력·저장 성공 |
| 새로고침 복원 | 같은 브라우저 세션에서 저장된 고객/서비스 정보 복원 |
| 두 탭 동시 수정 | 탭 A에서 문 수량 7 저장 후 탭 B의 8 저장은 충돌. 탭 B의 입력 8을 보존하고 명시적으로 복원했을 때 저장값 7 표시 |
| 서버 원본 대조 | 최종 draft revision 3·door_count 7 확인 |
| 다른 세션 접근 | 원본 초안 ID를 `?id=`로 지정해 조회해도 다른 세션의 GET 결과 `draft:null` |
| 교차 출처 쓰기 | 외부 Origin의 PUT은 HTTP 403 |
| 모바일 320px | 가로 넘침 0, 관찰한 콘솔 warning/error 0 |
| 업무 부작용 | 당시 문의 2·수신 이력 2·Calendar links/outbox/대기 검토 각 0 유지. 초안 저장이 일반 문의·메일·Calendar를 생성하지 않음 |

세션 만료·요청 제한·응답 유실 등 전체 조건의 격리 시험 11개와 위 실제 브라우저/DB 시험은 각각의 증거다. 실제 기기·모든 접근 기간의 실시간 경과·사진/AI/서명/메일 전체 흐름까지 검증한 것은 아니다.

## Google 자연 토큰 갱신과 기존 상태 보존

**R01 실제 확인:** DB 만료값을 조작하지 않고 자연 만료된 access token으로 회사 Google API를 호출했다. 갱신 후 expiry가 증가했고 인증 상태는 ready였다. 회사 계정·선택 라벨·Calendar 보존 결과는 모두 true였으며 실제 시험 대상 이름과 Calendar owner가 회사 계정에 맞았다.

선택 대상은 Gmail `L&K Integration Test`, 회사 소유 Calendar `L&K Integration`이다. 실제 동기화는 completed였고 Gmail imported 0/scanned 2, Calendar synced 0/scanned 0/review 0이었다. 기존 메시지 조회를 신규 수신이나 Calendar 변경 왕복 검증으로 세지 않았다.

당시 DB는 문의 2·수신 이력 2·가상 초안 1·Calendar links/outbox/대기 검토 각 0이며 기존 ID를 보존했다. 자연 access token 갱신 성공은 권한 회수 후 재연결(R03~R04), 장기 refresh token 유효성 또는 실제 장애 복구의 통과 증거가 아니다.

## 회사 Dashboard advisors와 수동 migration 이력

| 검사 | 실제 결과 | 판정·조치 |
| --- | --- | --- |
| Security advisors | errors 0, warnings 0, info 13 | 업무 테이블의 RLS No Policy는 anon/authenticated를 명시적으로 막고 서버 권한으로만 사용하는 의도된 경계. 정책을 추가해 공개하지 않음 |
| Performance advisors | errors 0, warnings 0, info 1 | `lk_outbox` Unused Index 정보. 유일성/운영 준비 목적을 보존하며 미사용 표기만으로 삭제하지 않음 |

이 결과는 정보 항목까지 없는 상태나 공개 출시 보안 전체 완료를 뜻하지 않는다. CLI/MCP 관리 인증에는 여전히 회사 프로젝트 권한이 없어 CLI link/list·공식 migration history repair는 미완료다. Dashboard에서 SQL을 수동 적용한 사실과 CLI 이력 등록은 다르다.

수동 적용된 버전은 `20261001100420`, `20261002100953`, `20261002101142`다. 접근 권한 확보 후 실제 스키마·이력을 다시 비교하고 각 버전의 공식 repair를 수행한다. **이력 복구·대조 전 `db push` 금지.** 이미 적용한 생성 SQL을 재실행하거나 DB reset으로 해결하지 않는다.

## 화면 없는 worker 신규 수신 — W01 실제 확인

Next 3002를 중단하고 앱 검증 브라우저 탭을 모두 닫은 상태에서 반복 worker만 실행했다. 사용자 개인 계정이 회사 계정에 보낸 D2 시험 문의가 **2026-10-02 20:56:08.920 Sydney (`10:56:08.920Z`)** 실행에서 수집됐다.

- 반복 worker 결과: Gmail imported 1/scanned 3, Calendar 0.
- 시험 제목 일치 확인 true, 회사 주소가 아닌 발신자 확인. 제목 원문·발신 개인 주소·본문은 문서에 저장하지 않았다.
- 새 문의의 messages 1, attachments 0, 본문 존재·텍스트 처리, 일정 null 확인.
- DB 문의 3·수신 이력 3·Calendar links/outbox 각 0. 신규 메일이 미확정 일정을 자동 만들지 않았다.

**W01의 화면/Next 앱 없는 신규 수집을 통과했다.** 이 메일은 첨부 0이므로 실제 HTML·첨부 처리(G06)나 중단 중 수신 복구(W02)를 통과한 것으로 확대하지 않는다. 반복 후 신규/기존 이력의 추가 중복 방지 대조는 해당 실행 결과로 별도 판정한다.

후속 W02 준비에서 반복 worker PID `18836`에 SIGTERM을 보내 정상 **exit 0**을 확인했다. 아래 후속 결과로 같은 대화의 중단 중 수신 복구까지 확인했다.

## 중단 중 답장 복구·동시 실행 — W02 답장/R02 실제 확인

- 두 단발 worker 실행이 각각 `11:05:50.690Z`, `11:05:53.439Z`에 완료됐다. 이 둘은 실제 실행이 겹치지 않았으므로 잠금 검증으로 세지 않았다. 기존 메일은 각각 imported 0/scanned 3으로 중복 저장되지 않았다.
- 사용자 개인 계정의 추가 답장 메타데이터 수신 시각은 **21:06:17 Sydney (`11:06:17Z`)**였다. 두 worker가 종료된 뒤이며 Next 앱도 중단 상태였다. 같은 대화·시험 제목·비회사 발신자 확인 결과는 true였다. 이 단계는 메타데이터 조회만 했으며 문의 수집은 실행하지 않았다.
- worker 재시작 결과 `11:07:49.421Z`: **imported 1/scanned 4**, Calendar synced/scanned/reviewed 0. 문의 수는 **3 유지**, 수신 이력은 **3→4**, 원래 D2 문의 messages는 **1→2**로 병합됐다. 일정은 null이며 Calendar links/outbox는 0을 유지했다.
- 실제 저장 결과를 읽는 검증 스크립트가 ISO 문자열 날짜를 Number로 변환해 한 번 실패했다. 원본 ISO 타입에 맞춰 고쳐 재조회했으며 앱 저장 실패가 아니었다.
- 두 worker를 같은 부모 프로세스에서 동시에 시작한 후속 시험: worker A `11:09:46.138Z` completed/exit 0(imported 0/scanned 4), worker B `11:09:44.098Z` busy/exit 2. **하나만 lease를 얻어 처리하고 다른 실행은 작업하지 않았다.** 두 실행 모두 종료했다.
- W01 신규 수집 이후 반복 중복 방지, R02 실제 동시 실행 잠금, W02 같은 대화 답장 복구는 통과했다. 강제 종료 후 lease 자연 만료·중단 중 별도 새 문의·실제 Google 권한 회수는 아직 미실행이다.

## 추가 원격 정의·재시작 확인

새 RPC의 본문을 SQL 주석·공백을 정규화하여 로컬 migration을 로드한 PGlite와 대조했다. `lk_google_health`: `d38855ee62a36f85f0a6b416be330587`, `lk_quote_draft`: `f60ca0062a6a144194d352c82b7dad85`로 일치했다. 두 함수는 `security invoker`, 빈 search_path였다.

로컬 production 앱을 3002에서 다시 실행하고 기존 초안의 문 수량 7·서비스 선택 복원을 실제 브라우저로 확인했다. Kitchen Cabinet Painting 페이지의 Request a quote 링크로도 저장된 초안 화면에 정상 진입했고 관찰한 콘솔 오류/경고는 없었다. 검증 탭은 닫았다.

## 남은 검증과 실행 상태

1. W02의 중단 중 별도 새 문의, W03 강제 종료·lease 만료, 권한 회수→회사 재연결·데이터 보존(R03~R04), 라벨 없는 메일·실제 HTML/첨부·Calendar 외부 변경 경합(G05/G06/C07)은 별도 검증한다. 격리 테스트 통과를 실제 제공자 검증으로 확대하지 않는다.
2. 회사 관리 인증을 복구해 수동 migration history를 정리한다. 운영 라벨/Calendar·두 회사 이메일·상시 실행 환경은 결정 후 적용한다.
3. 사진·AI·가격·날짜 UI·서명/PDF·고객 문서 이메일은 후속 단계다. 이미 예약된 날짜 차단 기반과 실제 달력/API 연결은 구분한다.

최종 실행 상태: **로컬 production 사이트 3002 실행 중**(실행 세션 `64697`), 반복 worker `18836`은 SIGTERM exit 0, 이후 단발 worker는 모두 종료했다. 상시 수집기를 등록하거나 계속 실행해 둔 상태가 아니다. 앱 검증 탭은 모두 닫았으며 사용자 Chrome 창은 보존했다. 가상 고객 초안 1개와 시험 문의·답장은 보존했다. 최종 확인 건수는 문의 3·수신 이력 4·초안 1·Calendar links/outbox 0이다. Git commit/merge/push와 공개 배포는 이번 실행에서 수행하지 않았다.
