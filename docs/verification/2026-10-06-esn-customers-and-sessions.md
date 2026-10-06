# ESN 고객 통합 조회·본인 세션 관리 검증

날짜: 2026-10-06 · Australia/Sydney · 브랜치: `codex/esn-admin-planning`

사용자가 오늘 남은 작업을 다시 검토해 계획을 세우고 구현하도록 요청했다. 설계·검토는 `analyst`(설정: GPT-6 Astra / xhigh), 코드·테스트는 `implementer`(설정: GPT-6.1 Sol / high) 역할로 나눴다. 지정 역할 생성에 성공했으며 주 채팅의 모델 설정은 변경하지 않았다.

## 착수 전 실제 연결 확인

| 대상 | 확인 결과 |
| --- | --- |
| Chrome 회사 프로필 | Kang (L&K Group), 회사 이메일 로그인 상태 확인 |
| Supabase | 기존 `xlqyafthsxallostcqfe` / `lnkgroup project` / `main PRODUCTION`, `lnkgroupsydney-hub`로 접근 |
| Supabase 상태 | 처음 열린 화면은 `Unhealthy`; 새로고침 후 `Healthy`. 표시 변화만으로 원인을 추정하지 않음 |
| 회사 DB 읽기 검사 | `npm run test:supabase:connection` 통과. 기존 업무 21테이블의 0행 조회, 서버 health, 7개 RPC의 비변경 probe, 유효한 공개 키의 테이블/RPC 접근 거절 확인. 고객 데이터 변경 없음 |
| Google Cloud | 회사 `lnkgroup` 프로젝트 선택 후 활성 API 전체 26개 확인. Gmail API·Google Calendar API·Maps JavaScript API 포함. Places API (New)는 해당 목록에 없음. 결제 등록이나 API 설정 변경은 수행하지 않음 |
| 로컬 앱 | 중단된 기존 production 앱을 `127.0.0.1:3002`에서 다시 실행. 기존 세션 만료로 로그인 화면 표시. 사용자에게 비밀번호·이메일 코드를 화면에 직접 입력하도록 인계 |

DB 연결 검사는 직원 Auth 로그인·새 고객 기능·운영 인수 완료의 증거와 구분한다. Google API 활성화는 실제 OAuth 재연결이나 Places 결제 완료를 뜻하지 않는다.

## 구현 범위

- 관리자 업무 화면에 Operations·Customers·Session security 탐색을 연결했다.
- 고객 원장 생성·검색·페이지 이동·상세, 미연결 문의/서명 제출 목록, 이유와 확인을 요구하는 수동 연결/해제, 변경 이력을 구현했다. 같은 연락처를 자동 병합하지 않는다.
- 서명 제출과 파생 문의를 하나의 원본 묶음으로 취급한다. 원본 고객 연락처·예약·문서·사진은 변경하지 않으며 기존 비공개 문서/사진 API를 재사용한다. 구매·청구는 아직 사용할 수 없다고 표시한다.
- 세션 목록과 본인의 다른 세션 종료를 추가했다. 현재 세션은 보존하고, ESN 접근 회수 후 Auth 정리가 실패하면 부분 실패와 재시도를 표시한다. 새로고침 후 다른 ESN 세션 수가 0이어도 정리를 재시도할 수 있다.
- 고객 변경 API에는 관리자 권한·같은 출처 검사, revision·요청 키·트랜잭션 감사 기록을 적용했다. 감사에는 요청 원문의 개인정보 대신 SHA256 해시와 최소 결과만 남긴다.

## 자동 검사

| 검사 | 결과와 범위 |
| --- | --- |
| `npm run test:operations` | **359/359 통과**. 기존 업무 회귀, 직원 인증, 고객 SQL/API/요청 상태 포함 |
| 고객 SQL/API | 원본 보존, 제출/파생 문의 묶음, 공개 역할 차단, 인가, 동일 요청 재시도, 충돌, 감사 실패 rollback, 연결 원본 연락처/참조 검색 확인 |
| 세션 SQL/API | 본인만 조회/회수, 현재 세션 보존, 다른 사용자 세션 보존, 만료·권한 거절, Auth 부분 실패 처리 확인 |
| lint·타입·production 빌드 | 최종 포커스 접근성 변경을 포함해 통과. Node 24.14.1·Next.js 16.3.6 |
| 비인증 HTTP | 고객 목록·미연결 목록·세션·기존 견적 PDF 모두 401, private/no-store·Cookie Vary 확인 |

검토에서 세션 0개 상태의 정리 재시도 차단, 원본 참조 검색 누락, 감사의 불필요한 개인정보 복제, 새 고객 생성 후 이전 연결 확인 유지 문제를 발견해 수정했다. 최초 타입 검사에서 nullable 연락처와 Route Handler 인수 불일치가 발견됐으며 수정 후 통과했다. 검사를 삭제하거나 실패를 숨기지 않았다.

## 실제 브라우저 검증 — 합성 데이터

`scripts/verify-esn-ui-fixture.mjs`를 3013에서 실행했다. `/api/**`는 모두 합성 응답이며 회사 DB로 전달하지 않는다. UI 자산만 3002에서 읽고 Cookie/Authorization·Set-Cookie를 전달하지 않는다. 이름과 주소는 Synthetic/example.invalid 시험값이다. 이 검사는 실제 Auth·DB 통합 인수와 구분한다.

| 흐름 | 확인 결과 |
| --- | --- |
| 검색·페이지 이동 | 13개 목록의 2페이지 이동, 검색 0건, 연락처 검색·복구 확인 |
| 생성·상세 | 고객 A/B 생성과 상세 표시. A의 연결 확인을 체크한 뒤 B를 생성하면 이전 제안·이유·확인이 제거됨 |
| 연결·해제 | 이유+명시 확인 후 제출 연결, 문서/사진 경로·예약 상태 표시, 감사 revision 2. 해제 후 원본이 미연결 목록에 돌아오고 감사 revision 3 유지 |
| 응답 유실 | 저장 성공 후 응답 503을 주입. 입력 유지 후 같은 요청 재시도로 결과 복구, fixture의 해당 고객 수 **1개** |
| 충돌 | 409를 주입하면 최신 revision으로 갱신, 이유 보존, 확인 해제와 버튼 비활성화로 재검토 요구 |
| 저장소 오류 | 503이 빈 고객 목록으로 표시되지 않음. 오류와 준비 필요 안내 후 Retry customers/Retry source records로 복구 |
| 세션 부분 실패 | 다른 ESN 세션 2→0, Auth 정리 503, 현재 세션 유지. 새로고침 후 Clean up other sign-ins로 다시 시도해 성공 |
| 세션 만료 | 고객 요청 401 후 모든 고객/업무 화면이 제거되고 로그인 화면으로 전환 |
| 반응형·키보드 | 320px·390px 모두 document scrollWidth가 viewport와 일치. 긴 이름/이메일 줄바꿈, Enter 검색, 상세/목록 제목 포커스 이동 확인 |
| 브라우저 오류 | 초기 fixture HTML 배너 삽입으로 React #418 발생. HTML을 변경하지 않고 합성 표시를 응답 헤더로 옮겨 해결. 새 탭의 초기 warn/error 0개. 주입한 409/503 네트워크 오류는 의도된 실패 시험 |

증거: [390px 화면](assets/esn-customers-mobile-20261006.png), [320px 긴 이름](assets/esn-customers-long-mobile-20261006.png). 실제 휴대전화 검사는 수행하지 않았다.

## 실제 회사 계정의 기존 자료 읽기

사용자가 직접 직원 로그인과 이메일 확인을 완료했다. `DEMO-F628C5C6`의 견적 PDF(12,808 bytes)와 서명 약관 PDF(13,658 bytes)를 브라우저에서 다운로드했다. 두 문서 각각 2페이지, 추출 본문 1,558/2,092자를 확인하고 총 4페이지를 렌더링해 참조번호·데모 표시·서명·가독성과 잘림 여부를 확인했다. 비공개 원본 사진 1도 640×480으로 로드됐다. 다운로드 파일을 수정하거나 공개하지 않았다.

## 회사 DB 적용 및 남은 인수

신규 `20261006102454_staff_session_security.sql`, `20261006102621_esn_customers.sql`을 하나의 트랜잭션으로 Supabase의 새 SQL 편집기에 준비했다. UI가 함수 안의 세션 삭제·역할 권한 회수 구문에 최종 실행 확인을 표시해 사용자에게 해당 실행을 확인 요청했다. 합성 UI 검증 후 다시 관찰했을 때 편집기가 **Success. No rows returned**로 전환됐고 실제 앱에서 새 함수가 응답했다. 에이전트가 확인 버튼을 누르거나 다른 도구로 우회 적용하지 않았다. 실행 주체를 추정하지 않고 성공 결과와 후속 검증을 기록한다. [실행 확인 화면](assets/esn-schema-confirmation-20261006.png), [적용 성공 화면](assets/esn-schema-applied-20261006.png).

`npm run test:supabase:esn`을 추가해 실제 회사 DB에서 **14/14 통과**했다. service 역할의 새 3테이블 0행 조회·4함수의 비변경 probe, 유효한 공개 키의 같은 3테이블/4함수 접근 거절을 확인했다. 자격 증명·고객 행을 출력하지 않았으며 쓰기 명령이나 로그인은 실행하지 않는다. authenticated 역할의 직접 원격 probe는 이번 스크립트 범위가 아니며 해당 grant 계약은 로컬 SQL 검사에 포함한다.

최종 앱 재시작·새로고침 후 사용자 인증을 유지했고, 실제 Customers에 고객 0건·미연결 원본 7건(서명 제출 4·일반 문의 3), Session security에 현재 세션·다른 세션 0건을 표시했다. 기존 Operations 문의 7건과 직원 경계도 유지됐고 실제 탭 warn/error는 0개였다. [회사 고객 화면](assets/esn-customers-live-20261006.png).

Supabase Advisors를 재실행했다. Security는 오류 0·기존 `Leaked Password Protection Disabled` 경고 1·RLS No Policy 정보 26건이다. 새 고객 3테이블도 공개 정책 없이 서버 전용 접근을 유지한다. Performance는 오류/경고 0·정보 11건이다. 새 고객 링크의 원본 FK 두 개에 인덱스 권고와 아직 사용 이력이 없는 감사 인덱스가 포함된다. 기존 예약/아웃박스 권고와 구분하며, 불필요하게 권한을 열거나 감사 인덱스를 제거하지 않았다. 유출 비밀번호 보호 설정·원본 FK 인덱스 검토를 후속으로 남긴다.

- 회사 고객 생성/연결·다른 실제 세션 종료는 수행하지 않았다. 합성 결과를 실제 변경 성공으로 표시하지 않는다.
- PGlite의 직렬화 검사와 원자적 실패 검사를 실제 여러 DB 연결의 동시 경합 검증으로 확대하지 않는다.
- 추가 관리자 초대·권한 관리/분실 계정 복구·실기기·운영 도메인/배포·실제 가격/계약·청구·구매는 후속이다. 커밋·푸시·배포하지 않았다.

## 최종 확인

최종 lint·타입·production 빌드가 모두 exit 0으로 통과했다. 기존 SQLite 실험 기능 경고만 있었고 코드를 재검사 없이 완료 처리하지 않았다. 3002에서 최종 빌드로 재시작했으며 Customers 탐색 시 제목의 `tabIndex=-1`·포커스 이동을 확인했다. 수정 문서 7개의 로컬 링크 228개와 `git diff --check`를 통과했다. 독립 analyst는 오늘 범위의 로컬 구현/합성 인수를 통과로 판정했으며 실제 쓰기·다중 연결 경합·운영 인수는 위 한계를 유지한다. 검증용 3013 서버/탭은 종료하고 실제 관리자 3002는 열어 두었다.

## 확인한 기술 근거

- 설치된 Next.js 16.3.6의 `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` 및 인증 가이드.
- [Supabase 세션](https://supabase.com/docs/guides/auth/sessions): 세션 ID와 실제 세션 레코드를 통한 로그아웃 이후 접근 확인.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): 노출 schema의 RLS와 역할별 접근 제한.
- Supabase changelog Markdown을 내려받아 확인. [PostgreSQL minor release 변경](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)을 읽었으며 현재 저장소 migration에서 `ltree`, `btree_gist`, PGP 암호화, 사용자 정의 연산자 사용은 발견하지 못했다. 원격 DB 전체 확장·버전 감사 완료로 확대하지 않는다.

자격 증명·비밀번호·인증 코드·세션 토큰과 원문 고객 개인정보는 이 기록에 저장하지 않는다.
