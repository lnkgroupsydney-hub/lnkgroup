# 회사 제공자를 사용한 사진 견적·서명·예약 실제 인수

2026-10-14 · Australia/Sydney · `codex/quote-live-e2e-20261014` · 기준 `origin/main`의 `66beaf0`

## 결과와 실행 범위

회사 Chrome에서 **사진 5장 실제 업로드 → 실제 AI 분석 → 현재 견적에 묶인 이메일 인증 → take-off 날짜·시간 선택 → 시험용 typed 서명·제출 → 운영 EMS의 Booking confirm 한 번 → Google 두 방문 검증 → 접수/확정 메일 수신**을 확인했다. 사진·분석·잠정 금액·서명 원본·회사 확정본·두 날짜의 DB 점유·Google 일정·수신 PDF를 독립적으로 대조했다.

고객 UI는 최신 main을 실행한 **`http://localhost:3034/quote/start`**, EMS는 **`https://www.lnkgroupsydney.com.au`의 운영 관리자 화면**을 사용했다. 고객 UI도 실제 회사 Supabase·OpenAI·Google·Resend에 연결해 정상 저장·인증·분석·제출 흐름을 수행했다. 회사 Chrome 프로필과 Gmail/Calendar 계정은 회사 `lnkgroupsydney@gmail.com`이다. 회사 계정을 시험 고객 수신자로 사용했다.

운영 고객 화면에 남아 있던 별도 개인 이메일의 미연결 draft를 보호하기 위해 고객 UI 인수는 별도 localhost에서 진행했다. 기존 draft를 회사 이메일로 바꾸거나 재제출하지 않았다. 따라서 이번 결과는 **로컬 고객 UI와 운영 EMS를 연결한 실제 회사 제공자 인수**이며, 배포 고객 UI 전체 E2E 인수 결과로 확대하지 않는다.

## 실제 입력과 저장 결과

필수 촬영 범주에 원본 공유 프로젝트 `public/images/story/quote photo/`의 **`whole 1.png`(overview), `upper 1.png`, `lower 1.png`, `side 1.png`, `damage 1.png`** 다섯 장을 실제 업로드했다. 별도 검증 작업트리에 사진을 복사하거나 커밋하지 않았다. 회사 EMS에서도 같은 비공개 사진·AI 결과·원본 예상 금액을 확인했다. 유료 AI 실행은 **이번 요청의 1회**이며 재분석·중복 실행하지 않았다.

| 항목 | 실제 결과 |
| --- | --- |
| 요청 ID | `1d8705ac-f185-4f70-83ec-b8baead09441` |
| 분석 ID | `0376af4a-2f6c-4377-ab8a-c8257c808102`, `succeeded` |
| 사진·revision | 5개 역할 모두 `ready`; 분석 입력/요청 revision 7 |
| AI 추정 수량 | 도어 14개·서랍 앞판 6개 |
| 잠정 도장비 | A$2,700 + GST A$270 = **A$2,970** |
| 범위 | `primary_view` 사진 범위의 잠정 도장비. 미확인 손상은 포함하지 않으며 현장 확인 필요 |
| 고객 선택 | take-off **2026-10-28 09:30 Sydney** |
| 서명·제출 | 시험용 비구속 확인의 `typed` 서명; `live-booking-request-ack-v2` |
| 제출 ID·접수번호 | `b8445ab4-9299-4e2d-8896-a05e72ff9a3a` / `REQUEST-B8445AB49299` |
| 회사 예약 | `c65d571a-fcda-461c-88d6-de34bb16b076` / `signed_request` / `confirmed` |
| Take-off | **2026-10-28 09:30–10:30 Sydney** |
| Installation | **2026-10-30 10:00–12:00 Sydney** |
| 두 번째 고객 확인 | acceptance 0행, booking의 `acceptance_id=null`, 원본 `signed_submission_id` 참조 |

고객은 방문일 단계에서 현재 요청에 묶인 실제 이메일 인증을 거친 뒤 날짜·시간을 선택하고 시험용 확인 서명을 제출했다. 정식 계약·실제 고객의 서명을 대신 작성한 인수로 취급하지 않는다. 최초 v2 제출의 Calendar 상태는 `not_required`이고 대기 Calendar 이벤트를 만들지 않았다.

EMS에서 고객 take-off 시작을 유지하고 종료 10:30, installation 시작/종료 10월 30일 10:00–12:00과 현장 손상 증가 안내를 확인한 뒤 **Booking confirm 한 번**으로 확정했다. 원본 사진·AI 분석·서비스 입력·사진 manifest·분석 input snapshot·가격을 제출본과 대조하고 기존 가격 계산 함수의 재계산 결과도 일치했다. 회사 확정본의 원본 snapshot/signed-content hash 참조와 가격도 일치한다. 이 재계산은 저장된 AI 결과에 대한 순수 가격 계산이며 새로운 AI 요청이 아니다.

## Google·점유·날짜 선택 대조

회사 live Calendar 대상은 명시된 `LIVE_QUOTE_CALENDAR_ID=lnkgroupsydney@gmail.com`이다. 이전 연동용 `selected_calendar_id`와 live Calendar 대상은 별도다. 검증 스크립트가 처음 두 값을 같다고 가정해 중단됐으나 실제 `resolveLiveCalendarTarget` 계약을 확인하고 live 설정·회사 계정·확정본 target을 정확히 대조하도록 스크립트만 수정했다. 제품 설정이나 Calendar 대상을 변경하지 않았다.

확정 이벤트 각각을 **독립 Google `events.get` 1회씩, 총 2회** 조회했다. ID·원본 payload hash·etag·목적·시작/종료·제목/설명·`private`·`confirmed`·opaque 기본값·attendee/반복 일정 없음과 회사 확정본을 대조했다. 각 방문의 DB confirmed segment 2개도 동일 submission·회사 계정/Calendar·기간·확정 version을 유지한다. 회사 Google Calendar 화면의 검색으로 두 날짜·시간도 직접 확인했다.

| 목적 | 이벤트 ID | Sydney 기간 |
| --- | --- | --- |
| take-off | `b48179087ebef09404ea95e43dd4a5d2679253caee8f5b211c1a359f2814a1017` | 10월 28일 09:30–10:30 |
| installation | `b9e87a6f153f1a4d34ee75cbd98cc876102944ecc50e8943f1a31505dc4c87efa` | 10월 30일 10:00–12:00 |

고객의 최초 날짜 UI에서는 당시 기존 점유인 **10월 15일·19일 차단**을 확인했다. 이번 확정 이후에는 동일 요청의 정상 availability API 응답을 회사 Chrome에서 열고 JSON Find로 **10월 28일·30일 `selectable=false`, `reason=busy` / 사이의 29일 `selectable=true`**를 대조했다. 새 두 번째 AI 견적의 날짜 UI를 만들어 확인한 결과가 아니다. 두 방문 사이 모든 날을 자동 점유하지 않는다.

## 실제 메일과 동결 PDF

접수 제출본과 확정 outbox 모두 `email_status=provider_accepted`이며 확정 outbox의 `complete=true`다. 회사 Chrome의 native Gmail **INBOX 검색 목록**에서 같은 접수번호의 접수 안내 1통·예약 확정 1통과 제목·첨부 표시를 확인했다. native 클릭으로 메일 전체 본문을 열 수 없었으므로 전체 본문을 시각 열람했다고 쓰지 않는다. 별도 읽기 전용 **Gmail API GET**으로 두 실제 수신 메일 각각의 전체 plain text·파일명·첨부 내용·DB 동결 PDF를 대조했다. 수신 PDF bytes는 DB 동결 bytes와 완전히 동일하며 SHA-256도 일치한다.

| 수신 문서 | 실제 PDF | SHA-256 |
| --- | --- | --- |
| 서명 접수본 | 3페이지 / 19,232 bytes | `f0924d70f20b40e58d6226d4410c1c7cc5e488c467c22442bb8f02b764fcf63f` |
| 예약 확정본 | 2페이지 / 15,377 bytes | `dd73de64be630600689435f4e77100ff06a54351ab64a325b2968780b752aa9d` |

확정 메일에는 두 방문·원본 `AUD 2970.00`·현장 추가 손상에 따른 가격 증가 가능·추가 온라인 승인 불필요 안내가 들어 있다. PDF는 동결 bytes·구조/페이지 수를 대조했으며, 페이지별 시각 레이아웃 인수를 완료한 것으로 표현하지 않는다. EMS 확정 직후에는 PDF disabled/retry processing이 잠시 표시됐다. 이후 **약 15초의 자동 polling**으로 `provider accepted`·`Frozen PDF saved`·다운로드 enabled·retry 버튼 없음으로 바뀌는 실제 화면을 확인했다. 수동 refresh나 추가 전송/재시도 명령 없이 처리됐고 최종 DB/Gmail 읽기에서도 완료 상태가 일치했다.

## 기존 자료 보존과 증거 관리

실행 전 회사 baseline은 quote request 2건·signed submission 1건·confirmed company booking 1건이었다. 새 요청 이외 기존 요청 2건을 각각 `select=id,revision,status,payload`와 `company_id=eq.lk-group`, 지정 ID의 GET으로 읽었다. 각 row의 `JSON.stringify(row)` SHA-256은 실행 전 값과 같다.

| 기존 요청 ID | 유지된 SHA-256 |
| --- | --- |
| `f9d23e12-0f78-440c-ac3a-b197070f40d5` | `dae9183f579b776b0759ca1d9c7c2674d59b7ec13eff2d39106e0e2c4bf64779` |
| `314f21df-cbe2-45ea-a12b-e243a2a2e602` | `e09b3777bd54937494c40cc079569a16bdbd7b0c57f012bbefa2f3143fa5cc4f` |

읽기 검증 스크립트는 회사 Supabase URL의 정확한 일치, 지정 요청/연결된 ID 조회, Google 읽기 endpoint를 제한했다. 정상 OAuth refresh/health 외 업무 mutation은 거절하며 이번 실행에서는 **업무 직접 쓰기 0회·OAuth maintenance 0회**였다. 고객/EMS가 정상 UI에서 수행한 저장·분석·인증·서명·예약과 보조 검증의 읽기 전용 접근을 구분한다.

비공개 로컬 증거는 작업트리 `.local/quote-e2e-20261014/`에만 둔다. `read-proof-1d8705ac-f185-4f70-83ec-b8baead09441.json`, `existing-request-preservation-proof.json`, `baseline-proof.json`은 `completed=true`이고 결과 JSON 권한은 `0600`이다. 개인정보·OTP·비밀값·메일/PDF 원문·사진·브라우저 인증자료·스크린샷을 이 문서나 커밋에 넣지 않는다. 비교 hash는 위에 명시한 지정 컬럼과 문서 bytes의 보존 증거이며 전체 DB 감사로 확대하지 않는다.

기존 DB 설정·Supabase schema·회사 Auth·환경 설정·가격 기준을 변경하지 않았다. 이번 QA 요청/서명/예약/메일과 **10월 28일·30일 두 Calendar 일정·DB 점유는 보관**하며 자동 삭제하지 않았다. 원본 공유 폴더와 다른 작업자의 변경도 보존했다.

## 접수 상태 문구와 실제 reload 복원

실제 확정된 v2 요청에서 초기 `not_required` Calendar 상태만으로 미래형 안내를 계속 표시하던 문구를 바로잡았다. `booking-flow-client.ts`는 회사 booking status를 확인하도록 중립적인 Calendar 안내를 사용한다. `customer-access-panel.tsx`의 목록 표시는 `Saved draft`에서 `Saved quote`로 바꿨다. backend의 draft는 요청 메타데이터이며 이 표시 수정으로 서명·예약 상태를 바꾸지 않는다. `live-customer-proposal.tsx`의 v2 고정 미래형 설치일 배정 안내는 현재 take-off/installation 일정·예약 상태·확정 문서를 아래에서 확인하도록 바꿨으며 추가 서명이 필요하지 않다는 안내를 유지했다.

회사 Chrome에서 localhost:3034를 **Reload → View quotes & bookings → 권한 있는 이메일 세션 유지 → 본인 요청 목록 → Open saved quote** 순서로 조작했다. 같은 `REQUEST-B8445AB49299`·A$2,970·10월 28일 09:30–10:30 take-off·10월 30일 10:00–12:00 installation·`Booking confirmed`·두 Google 기간 검증 완료·PDF 링크 복원을 확인했다. 금액·사진·서명을 다시 저장하거나 AI·예약 확정을 다시 실행하지 않았다. 복원된 실제 고객 화면을 직접 시각 점검했으며 스크린샷 파일을 저장하지 않았다.

이번 문구 변경은 기존 디자인·원본 서명·업무 DB와 예약 상태를 변경하지 않는다. 실제 제공자 대조와 위 브라우저 복원을 연결해 확인했으며 배포 고객 UI 전체 E2E로 확대하지 않는다.

최종 check 이후 같은 요청을 다시 복원해 세 번째 수정 문구인 `View your take-off and installation schedule, booking status and confirmation documents below.`와 추가 서명 불필요 안내가 실제 회사 고객 화면에 표시되는 것을 확인했다. 접수 상세의 Calendar 중립 문구·`Booking confirmed`·두 Google 기간 검증 완료·접수/확정 PDF 다운로드 2개 enabled를 함께 대조했다. 스크롤한 native 화면으로 수정 문구와 A$2,700 + GST A$270 = A$2,970의 배치를 시각 점검했고 스크린샷 파일을 저장하지 않았다.

## 코드 검사

- 고객/EMS 클라이언트 집중 검사 **29/29**, fail/cancelled/skipped 0. 실제 실행 로그는 `.local/quote-e2e-20261014/client-tests.log`다.
- 문구/복원 후속의 관련 booking 검사 29/29·customer access panel 검사 8/8, **집중 검사 총 37/37 통과**를 확인했다. 로그는 `client-tests.log`와 `customer-access-tests.log`이며 전체 suite 실행과 구분한다.
- `npm run check`의 lint·Next 타입 생성/TypeScript·production build가 종료 코드 0으로 통과했다. 로그는 같은 폴더의 `check.log`다.
- 읽기 검증 스크립트의 구문 검사와 네트워크/환경 로딩 없는 `--self-test`도 통과했다.
- 이전 전체 **767/767** 기록은 기존 실행 결과다. 이번에 전체 suite를 다시 실행했다고 쓰지 않는다.
- 수정 대상 세 파일의 detector는 종료 코드 0, findings 없음으로 보고됐다. detector 검사와 실제 브라우저·타입/빌드 검증을 구분한다.
- 후속 두 번째 `npm run check`도 종료 코드 0이었다. 세 파일의 마지막 문구 수정까지 포함한 **최종 `npm run check`도 종료 코드 0**, lint·타입·production build 모두 통과했다. 최종 로그는 `.local/quote-e2e-20261014/final-check.log`다.

## 미실행과 남은 범위

이번 브랜치의 commit·main merge·push·운영 배포는 실행하지 않았으며 이번 범위에 포함하지 않는다. 이번 로컬 보정이 운영 고객 화면에 반영됐다고 주장하지 않는다. 배포 고객 UI 전체 E2E, 실물 모바일·전체 키보드·PDF 페이지별 시각 검사, Google Maps 실제 검색/선택 인수는 별도다.

미래 webhook·backup cron·현장 최종 가격·정식 계약·취소/변경·Complete 후 인보이스 +3일 업무는 이번 완료 항목이 아니다. 시험용 날짜를 실제 신규 고객에게 제공하려면 보관 중인 QA 점유와 후속 운영 절차를 먼저 검토해야 한다.
