# 날짜·시간·서명 1회와 EMS 단일 예약 확정 검증

2026-10-13 · Australia/Sydney · `codex/quote-date-first-flow-20261013`

**후속 테스트 데이터 삭제:** 사용자가 기존 자료 전부를 테스트로 확인해 연결 일정까지 삭제하도록 요청했다. 아래 당시 유지했던 10월 29일 요청·11월 3/5일 예약·기존 v1 자료는 이후 정리됐으며 현재 보관/점유 상태는 [삭제 검증 기록](2026-10-13-demo-data-cleanup.md)을 따른다. 아래 기능 검증 결과는 실행 당시 기록으로 유지한다.

## 결과와 실제 실행 경계

신규 v2 요청은 **고객 take-off 날짜·시간 → 서명 → 제출 → EMS 설치 기간·안내 입력 → Booking confirm 한 번 → Google 두 방문 저장·독립 조회 → 고객 확정 메일**로 처리된다. 고객 두 번째 acceptance와 회사 제안 안내 메일을 생성하지 않는다. v2 최초 접수의 Calendar 상태는 `not_required`이며 대기 이벤트를 만들지 않는다.

고객 날짜·시간·서명 제출·이메일 재인증/복구는 배포 사이트의 정상 고객 API로, **EMS 입력·단일 확정과 실제 Google 두 방문 확인은 회사 Chrome**으로 수행했다. 회사 Chrome은 `Kang (L&K Group)`이고 Calendar/Gmail 계정은 `lnkgroupsydney@gmail.com`이다. 브라우저 인증정보 추출·개인 프로필 접근·직원 principal 위조·운영 DB 직접 예약 쓰기를 하지 않았다. 고객 신규 3단계 화면의 전체 마우스/키보드·모바일 인수는 이번 실연동 검증에 포함하지 않으며 순수 클라이언트 회귀와 정상 운영 API 결과를 구분한다.

## 자동 검사와 독립 검토

- `npm run test:operations`: **720/720**, 실패·skip 0.
- `npm run check`: lint·Next 타입 생성/TypeScript·production build 통과.
- 백엔드 DB/API 집중 77/77, 고객/EMS 클라이언트 집중 29/29, receipt/delivery/Calendar 집중 37/37 통과. 전체 suite에 포함되는 검사이므로 합산하지 않는다.
- 독립 정적 검토: v1 원본 보존, 원본 가격/고객 시작 잠금, 두 기간 원자 점유, 재시도 동일성, purpose/hash/독립 GET, Google 확인 전 성공 메일 차단 확인.
- 후속 접수 문구 수정은 v2가 확정 후에도 `Company confirmation required`로 보이던 혼동을 제거한다. 로직 변경 없는 해당 파일 lint/diff와 최종 Vercel TypeScript/build를 확인했다. 기존 v1 안내는 그대로다.

## 회사 DB와 배포

회사 프로젝트 `xlqyafthsxallostcqfe`의 SQL Editor에서 `20261012221456_simple_signed_booking_confirmation.sql`을 transaction으로 적용했고 `Success. No rows returned`를 확인했다. 이전 14개 업무 테이블의 기존 컬럼 hash/count가 적용 전후 동일했다. 추가 nullable time/확정 근거 컬럼은 기존 값 비교에서 제외했으며 기존 서명/사진/가격/이벤트/문서를 재작성하지 않았다.

서비스 역할의 v2 고지문 조회는 200이고, publishable/공개 역할의 신규 고지·Sydney 변환·회사 예약 명령 실행은 **401 / 42501**로 차단된다. 신규 예약 확정은 기존 검증된 직원 세션과 현행 membership을 요구한다.

최초 기능 배포 `dpl_WWPFJaAM1vKKAqCNiPMhW2P83d35`, 접수 안내 문구까지 포함한 최종 배포 **`dpl_3AkfrqnwwqGdmTvUChLFgQ5rvV5y`**는 READY다. 회사 프로젝트/팀에서 CLI로 배포했으며 www·apex·Vercel 별칭 연결을 확인한다. Git commit/main merge/push와 배포는 구분하며 검증 당시 변경은 미커밋이었다. 후속 통합 기록은 README 최신 항목을 따른다.

## 실제 시험 요청과 결과

기존 시험 요청 `RQ-F1EA522E6D874C20A2ED6234C181A6CA`의 회사 이메일·5장 비공개 사진·완료 AI `ec78ff5b-9bb5-417e-bd7f-745c553107f4`를 재사용했다. 새 유료 분석을 하지 않았고 사진·AI 결과·요청 revision 6·원본 A$2,475 GST 포함이 동일하다.

정상 OTP로 요청을 복구하고 미서명 v1 approval을 새 v2 approval로 진행했다. 시간 누락은 400, 기존 확정된 10월 23일 저장은 409로 거절됐다. 고객 시간까지 묶인 새 snapshot에 **시험용 typed 서명**을 제출했다. 실제 고객의 서명을 대신 작성하지 않았다.

| 항목 | 실제 저장 결과 |
| --- | --- |
| 제출 | `REQUEST-132EB5D24B41` / `132eb5d2-4b41-44a2-96cf-1fa943a8c24b` |
| 금액 | A$2,250 + GST A$225 = **A$2,475**, 원본 사진 가견적 유지 |
| Take-off | **2026-11-03 09:15–10:15 Sydney**; 고객 시작은 EMS 수정 불가 |
| Installation | **2026-11-05 09:30–11:30 Sydney**; EMS 입력 |
| 예약 | `3142fa56-6f8f-4e15-9d3a-9d2a7606da47` / `signed_request` / `confirmed` |
| 추가 고객 acceptance | 0행, booking의 `acceptance_id=null`, 원본 `signed_submission_id` 참조 |
| 외부 작업 | 두 DB 점유·두 Google event·confirmation outbox 한 건; proposal/acceptance 메일 없음 |

회사 Chrome에서 두 방문의 종료/설치 일시와 기본 현장 손상 증가 안내가 있는 화면을 확인하고 **Booking confirm 한 번**을 눌렀다. 이후 다른 승인 클릭 없이 Google 확인 완료·provider accepted·확정 PDF 다운로드 표시로 바뀌었다.

### Google 독립 대조와 날짜 차단

- take-off: `b68fb8944d4dcfdfb8c7672efb2be782431e98a906b4c8f7f494145662009799b`
- installation: `b3900dd9db0acad8767d3b788cfd76600363c3a341e4131e54c297d9bd579a83a`

각 event를 생성 응답과 별도로 실제 GET해 목적·제목·시작/종료·private·confirmed·opaque(기본값 생략 허용)·attendee 없음·source payload hash·etag와 DB 점유가 일치함을 확인했다. 회사 Calendar 화면에서도 **11월 3일 오전 9:15–10:15**, **11월 5일 오전 9:30–11:30**이 표시됐다.

인증 고객의 실제 availability API는 **11월 3일·5일 selectable=false/busy, 4일 selectable=true**다. 두 방문 사이 모든 날짜를 막지 않는다. 공개 고객 상태는 Google event ID 목록을 빈 배열로 숨기며 회사 원본에서는 검증 증거를 보존한다.

### 메일과 문서

회사 Gmail **INBOX의 예약 확인 메일 1통** `1a1323fcb3fee498`을 실제 조회했다. Provider ID는 `01a1323f-c33b-71c5-801b-b2489c97accd`다. 메일 전체 plain text가 동결 payload와 동일하며 두 방문·원본 `AUD 2475.00`·현장 추가 손상/금액 안내·추가 온라인 승인 불필요 문구가 포함된다.

첨부 PDF는 **2페이지 / 15,236 bytes**이고 Gmail 받은 bytes, 정상 고객 인증 다운로드, DB 동결 bytes가 동일하다. SHA-256은 `e93eb939b1b81dac5bf8ac7c8ec8719becb542ae90fd9912ef4d2d730e00cdb0`다. 원본 서명·가견적을 표시하며 새 최종 가격 동의를 받았다고 쓰지 않는다.

읽기 검증 스크립트의 초기 가정 세 가지(공개 응답의 비공개 event 목록, acceptance의 요청 직접 FK, 메일 금액의 `$` 표시)를 실제 공개 계약·DB schema·`AUD` 형식으로 바로잡았다. 잘못된 조회/비교 로그는 비공개 `.local/simple-booking/`에 보존했고, 권한을 완화하거나 제품 검사를 생략하지 않았다. 수정한 DB/Google 대조, 정상 고객 PDF/날짜 차단, 별도 Gmail 원문/첨부 byte 검증의 실제 결과를 위에 기록했다.

## 보존과 남은 경계

사용자가 제출한 **10월 29일 `REQUEST-C214E9F473D7`**은 v1·시간 null·원본 A$2,475·고정 PDF hash·이전 Calendar event를 유지한다. 이전 확정 booking `12093d23-6a39-40e1-919a-b394918fe199`도 `customer_proposal`과 실제 acceptance·confirmed를 유지한다. 이전 서명 조건을 새 설치일 배정 동의로 변환하지 않는다.

이번 시험의 **11월 3일·5일 점유와 Google 이벤트는 남아 있다**. 취소·일정 변경 기능이 아직 없으므로 자동 삭제/점유 해제하지 않았다. 실제 근무시간/기간 자동 산정, 현장 추가금 협의/최종 계약, 고객 날짜·시간 변경 요청, 취소/재예약, Complete 인보이스 +3일 납기는 후속 범위다. 예정 시각 cron 실행과 새 v2 Google event 변경 주입·장애 주입은 미실행이며 코드 회귀와 구분한다.
