# EMS 회사 제안·확정 예약·Google Calendar 검증

2026-10-13 · Australia/Sydney · 회사 Chrome `Kang (L&K Group)` · `lnkgroupsydney@gmail.com`

상태: **코드·자동 검사·회사 DB/배포 적용, 회사 Chrome의 발행 → 고객 이메일 재인증/복구 → 전체 구간 확인 → EMS 확정, 실제 Google 두 일정·DB 점유·원본/메일/PDF hash 대조 완료. Gmail 실제 3통 수신·확정 PDF 2페이지·고객 복구/320·393px 확인까지 완료. 다른 고객 B 날짜 차단·22일 저장과 오래된 날짜 저장/제출 409 거절까지 완료**이다. 아래 구현·격리 검사·회사 환경 결과를 구분한다.

## 구현과 배포

- 계획: [43번 회사 예약 검토·확정](../plans/43-ems-confirmed-booking-calendar.md).
- 브랜치: `codex/ems-confirmed-booking-calendar-20261013`, 시작 기준 회사 `main@7f801b6`. 이번 기능의 커밋·main 병합·push는 아직 수행하지 않았다.
- 회사 초안/충돌 인수 배포 `https://lnkgroup-bftv4uvif-lnkgroupsydney-8702.vercel.app` READY. 후속 UI 회귀 보완의 최종 Production 배포는 `dpl_8FsJRdbxZx76fSwm7nL3t3LxFdgm`, `https://lnkgroup-4pwuuxlic-lnkgroupsydney-8702.vercel.app`, READY. 운영 주소는 `https://www.lnkgroupsydney.com.au`다. 배포 성공과 Git 통합은 별도 상태다.
- 운영 대상은 `lnkgroupsydney@gmail.com` 기본 Calendar 단일 자원이다. 기존 시험 Calendar와 transparent 예약 요청 표식은 보존한다.
- EMS 견적 상세와 운영 예약 화면에서 공급가·GST·총액·범위·조정 사유·종일/시간별 여러 구간을 저장한다. 금액은 정수 cents로 계산하고 종일 종료는 exclusive end, 화면의 마지막 작업일은 포함으로 표시한다.
- 발행본은 불변이며 새 초안/버전으로 수정한다. 인증된 고객은 회사 금액과 전체 기간을 별도 확인하고, 해당 버전의 확인본 발송을 제공자가 수락한 뒤 회사 확정이 가능하다.
- 확정 명령·전체 UTC 기간 점유·고정 구간별 Google event manifest·outbox·감사를 한 DB 트랜잭션으로 준비한다. 실패·검토 상태에도 점유를 보존한다. 모든 Calendar 구간의 독립 조회와 사후 충돌 검사가 성공해야 `confirmed`가 된다.
- private PDF·정확한 발송 payload·멱등 email key를 고정하고, 확정 안내는 Calendar 검증 후에 보낸다. Google 변경을 감지하면 `review_required`로 남기고 고객 동의·자동 취소로 처리하지 않는다.

## 자동 검사와 실제 별도 DB 세션 경합

- 전체 업무 검사 최초 **677/677**, 후속 UI 회귀 검사를 추가한 최종 **678/678 통과**. 로그: `.local/company-booking-qa/operations-final.log`, `.local/company-booking-qa/operations-ui-final.log`.
- `npm run check`의 lint·Next route type 생성/TypeScript·production build 통과. 최초 typegen 검사에서 발견한 정적 route handler의 두 번째 인수 타입 불일치를 Request 전용 wrapper로 고쳤다. 최종 로그: `.local/company-booking-qa/check-ui-final.log`(exit 0), 최초 검사 로그: `.local/company-booking-qa/check.log`.
- 신규 DB/API **28/28**과 기존 예약 요청 DB **14/14**를 개별 확인한 뒤 전체 검사에 통합했다. 권한·버전·정수 금액·DST·기간 중복·서명/확인 hash·처리 lease·외부 실패·UI 응답 수명/복구를 검사했다.
- PostgreSQL **17.11 (Homebrew)**의 임시 loopback 전용 클러스터에서 서로 다른 실제 `psql` 세션으로 **8/8 통과**했다. 회사 DB·Google·Resend는 호출하지 않았다. PGlite 단일 연결의 순차 실행을 실제 경합 증거로 사용하지 않았다.

| 실제 PostgreSQL 확인 | 결과 |
| --- | --- |
| 서로 다른 DB 세션 | 확인 |
| 겹친 두 확정 중 한 건만 점유 | 통과 |
| 두 번째 확정은 첫 commit까지 대기 | 통과 |
| 같은 멱등 확정 재시도에 중복 점유 없음 | 통과 |
| 첫 트랜잭션 rollback 후 다른 확정 성공 | 통과 |
| 맞닿은 `[start,end)` 경계 허용 | 통과 |
| 종일/시간 혼합 겹침 거절 | 통과 |
| 후속 구간 충돌 시 전체 구간 rollback | 통과 |

실행 명령은 `npm run test:booking-concurrency`, 로그는 `.local/company-booking-qa/concurrency.log`다.

## 회사 Supabase 적용·원본 보존

- 회사 프로젝트 `xlqyafthsxallostcqfe`의 로그인된 Dashboard에서 신규 `20261012201809_live_company_booking_confirmation.sql`을 적용했다.
- 새 회사 제안·고객 확인·예약·event manifest·outbox·명령 영수증·감사와 UTC 점유/projection을 확인했다. 테이블/RPC는 익명 요청에서 **401**로 차단됐다.
- 현재 회사 staff membership·상류 Auth 세션·현재 이메일 확인을 DB에서 재검사한다. 고객은 원래 guest 요청 cookie만으로 회사 제안을 확인할 수 없고, 인증된 요청 소유 관계와 현재 Auth 세션을 검사한다.
- 기존 QA 요청 `895f8919-7e19-4506-972d-944285b0185a`와 제출 `070eeb13-c91f-4a70-b567-97c2d9ecaaeb`의 원본 snapshot·서명 hash·기존 provider/event 연결이 보존됨을 확인했다. 이 고객 A의 원본 요청/사진/분석을 다시 생성하거나 AI 분석을 호출하지 않았다.
- 원본 snapshot SHA-256: `c7fd5b2c024a9039f065e63d7e9b123febd0ae72e5f7c4cd4d5ed7ee3ab456e2`.
- 원본 서명본 SHA-256: `73eaa7ab29e10814da964f667c2b72e756e9b8c9e5a665ee051daec74314609d`.

## 회사 Chrome 실제 확인 완료

1. EMS에서 `RQ-895F89197E194506972D944285B0185A`를 열고 기존 예상본 **A$3,135**를 비교하면서 회사 제안 version 1을 저장했다.
2. 회사 최종 공급가 **A$2,900 + GST A$290 = A$3,190**와 작업 범위·조정 사유가 실제 화면에 표시됐다. 이 금액은 가상 QA 요청의 입력값이며 새로운 운영 단가를 뜻하지 않는다.
3. 작업 기간은 **10월 20–21일 종일**과 **10월 23일 09:00–13:00 Sydney** 두 구간이다. 종일 Google/DB 종료는 10월 22일 exclusive end로 준비한다. 구간 사이 22일은 자동 점유하지 않는다.
4. 회사 Calendar에 개인정보 없는 임시 private busy 일정 **10월 21일 10:00–11:00**을 만들고 검사했다. 시작일 20일이 비어 있어도 **첫 작업 구간의 두 번째 날 충돌**을 표시했고, 제안 발행 버튼이 비활성화됐다.
5. 실제 Google의 기본 `opaque` 값은 조회 응답에서 생략될 수 있었다. 기존 엄격 비교가 정상 busy 일정을 오류로 판단하는 원인을 고치고, 생략값을 opaque로 검증하도록 반영했다. `transparent`로 바뀐 자체 event는 여전히 검토 대상이다.

6. 임시 충돌 확인 일정만 소유 표식과 ETag를 확인하고 제거했다. 삭제 응답과 cancelled 조회를 확인했으며 기존 고객 요청/Calendar 자료는 변경하지 않았다.
7. 회사 제안 v1을 발행하고, 회사 Chrome의 고객 이메일 OTP 재인증으로 요청을 복구했다. 고객이 **최종 A$3,190과 두 작업 구간 전체**를 확인하고 `LK Company Schedule QA20261013` typed acknowledgment를 별도 저장했다. 원래 예약 요청의 서명을 재사용하지 않았다.
8. EMS에서 전체 구간을 다시 검사한 뒤 확정했다. 실제 화면의 `confirmed`·검증된 구간 2개·고정 PDF와 DB 상태를 대조했다. 확정 시각은 **2026-10-13 07:54:28 Sydney**다.

## 독립 읽기 대조 결과

Node 서버의 회사 Supabase 조회와 회사 OAuth의 Google **GET**만으로 기존 브라우저 결과와 별도로 읽었다. 개인정보/키/메일 본문/서명 원본은 출력하지 않았다. 검증된 날짜·식별자·hash·동일 여부만 `.local/company-booking-qa/live-proof.json`에 기록했다.

| 항목 | 확인 값 |
| --- | --- |
| 회사 proposal ID / version | `52465d47-a7ac-4769-a93a-2e81db906416` / 1 |
| proposal SHA-256 | `44b44e83f520ba47ad4b9540ec8039667a5a000f8afd4b8086c013da23770ec4` |
| 별도 고객 acknowledgment ID | `ac72c8f6-63be-4d10-8fe7-e3be7c15f59f` |
| 실제 booking ID | `12093d23-6a39-40e1-919a-b394918fe199` |
| 상태 / 확정 UTC | `confirmed` / `2026-10-12T20:54:28.092814Z` |
| 최종 cents | 공급가 `290000` + GST `29000` = `319000` AUD |
| DB 실제 점유 | 2개, proposal UTC 기간·Sydney 날짜 projection 일치 |
| Google 첫 event | `bcfd7b4bd478e5565b97f446d87da10ba3cfb0e12f689f1b397d0bab0aff9a528` |
| Google 첫 기간 | 10월 20일 → 22일 exclusive, 실제 작업일 20·21일 |
| Google 두 번째 event | `bbc8d504669981103c29345c02331a27a066b74b6c9230a9c6e45b862b1480f32` |
| Google 두 번째 기간 | 10월 23일 09:00 → 13:00 Sydney (`+11:00`) |
| Google 독립 조회 | 각 ID·ETag·private/confirmed/opaque·소유 표식·proposal/hash·구간 index·payloadHash 일치, 참석자 0명 |
| Google 동일 booking의 활성 event 수 | 2개, 중복 없음 |
| 원본 요청 | snapshot/서명 hash·signature·기존 provider/event ID 모두 적용 전과 동일 |

| 고정 발송 종류 | Resend provider ID | 고정 PDF SHA-256 |
| --- | --- | --- |
| 회사 제안 | `01a131e0-f571-77f5-9fd4-faa7d907d04c` | `0667d73009baf6baf9098ff30fdb023521fa1dcb5cf47296b59aa61e5f3a68ec` |
| 고객 확인본 | `01a131e2-d1ca-77b1-8422-d2b94c959924` | `a5503d74aeb802de08f555e20a0c97cf0145c2b53b22128e95a296a60050b4e5` |
| 예약 확정 안내 | `01a131e5-4a9b-7196-8a1d-7cb37d338763` | `e7a74f46331725b275180ea684f126616e899dedb00e594e81c19820e21c972a` |

세 outbox는 모두 `provider_accepted`·complete이며, 수신자 배열은 검증된 고객 이메일 하나와 일치했다. 실제 attachment bytes는 저장된 PDF와 hash가 동일했다. **이 독립 읽기 검사는 제공자 수락·저장된 첨부를 대조한 것이며, 후속 회사 Chrome의 실제 수신·PDF 화면 확인을 아래에 별도 기록했다.**

고객 B의 기존 QA 요청 `f1ea522e-6d87-4c20-a2ed-6234c181a6ca`는 Production의 정상 GET(revision 2) → `customer/send` → 회사 Gmail의 새 OTP → `customer/verify`로 **200·인증 이메일 연결·정확한 request ID 선택**을 확인했다. 원래 정상 API로 발급한 시험 요청 credential과 이번 반환된 세션만 사용했으며 이 이메일 인증 단계에서는 브라우저 cookie 추출·DB 직접 인증 쓰기·새 AI 분석을 하지 않았다. 세션은 비공개 ignored 파일에 mode `0600`으로 보관하고 문서/로그에는 cookie나 코드를 기록하지 않았다. 실제 고객 B 날짜 차단의 후속 실행 결과는 아래 별도 인수에 기록했다.

고객 B가 기존 damage 사진 1장·분석 없음으로 예상본 승인을 할 수 없었던 상태를 확인했다. 정상 비공개 presign → Storage signed PUT → finalize API로 사용자 지정 `whole 1.png`/`upper 1.png`/`lower 1.png`/`side 1.png`를 overview/upper/lower/side 장면으로 추가했다. **원래 사진·연락처·서비스는 보존**됐으며 revision 6·ready 사진 5장이 됐다. 동의된 정상 분석 API로 **실제 OpenAI job 1건**(`ec78ff5b-9bb5-417e-bd7f-745c553107f4`)을 실행했고 cloud-after 처리와 GET 조회만으로 succeeded를 확인했다. 결과는 **provisional_estimate A$2,250 + GST A$225 = A$2,475**, 문짝 약 15개·수량 신뢰도 낮음·현장 확인 필요(`site_review_required`)였다. 기존 요청의 도장 대상이 doors only이므로 서랍을 새 가격 대상으로 추가하지 않았다. 연락처/서비스 hash와 기존 damage content hash가 동일하고 photoCount 5·jobCount 1임을 대조했다. 쿠키·서명 upload URL·개인정보를 제외한 실행 증거는 `.local/company-booking-qa/customer-b-analysis-proof.json`에 보관했다. **이 AI 검증은 B의 날짜 화면 인수 준비이며 최종 계약 금액·예약 확정을 뜻하지 않는다.**

## 회사 Chrome 실제 메일·PDF·Calendar·화면 추가 인수

- 회사 Google 계정 표시를 확인한 Chrome Gmail 받은편지함에서 회사 제안·고객 확인본·예약 확정 안내 **실제 3통**을 확인했다. 확정 메일을 직접 열고 발신자 `quotes@lnkgroupsydney.com.au`, **A$2,900 + GST A$290 = A$3,190**, 20–21일 종일과 23일 09–13시, 계약/작업 지시/결제와 별도임을 확인했다. 실제 수신과 앞선 provider acceptance를 구분해 확인한 결과다.
- EMS의 **Download booking confirmation PDF**로 `REQUEST-070EEB13C91F-confirmation.pdf`를 실제 다운로드했다. **13,324 bytes·A4 2페이지**, metadata의 확정 시각 10월 13일 07:54와 내용이 일치했다. 렌더링한 두 페이지를 눈으로 확인해 잘림·겹침이 없었다.
- 고객 새로고침으로 confirmed·최종 제안·두 기간이 복구됐다. **320px와 실제 도구의 iPhone 16 393px** 화면에서 제안·상태·PDF 버튼이 잘리지 않고 버튼이 줄바꿈됐다. 도구에서 390px 설정 시도는 입력 불일치로 실제 적용되지 않았으므로 **390px 통과로 기록하지 않는다**.
- 회사 Google Calendar 주간 화면에서 기본 Calendar `Kang Lisa`의 두 작업 일정을 직접 확인했다. 23일 popup은 **09:00–13:00·private**였다. 기존 transparent 예약 요청 표식과 시험 Calendar `L&K Integration`은 보존됐다.
- 인증된 Production cron endpoint를 명시적으로 **두 번 POST**, 모두 200. 매번 company/request claimed 0, reconciliation checked 1·reviewed 0·unavailable 0·storage error 0이었다. 확정 안내/Google 일정을 재생성하지 않았다. **이는 인증 endpoint 재실행 검증이며 예약 시각 자동 cron 실행을 관찰한 결과가 아니다.**
- 회사 브라우저 Console의 runtime error는 0이었다. browser possible-improvement는 크기가 지정된 lazy logo의 일시적인 width/height 경고로 확인했으며 신규 실행 오류가 아니었다.

## 실제 다른 고객 날짜 차단·오래된 제출 거절

- 회사 Chrome에서 인증된 고객 B가 A의 확정 점유와 동일한 **20·21·23일은 booked/disabled**, **22·24일은 available**인 것을 확인했다. 정상 날짜 저장 API로 20/21/23일을 각각 시도하면 **세 요청 모두 409**였다. 증거는 `.local/company-booking-qa/customer-b-blocked-save.json`이다.
- 실제 화면에서 22일을 선택·저장해 **Thursday 22 October 2026**·selectionRevision 2와 확인/서명 버튼 활성화를 확인했다. Calendar 조회 TTL이 지난 때에는 Refresh 후 정상 선택됐으며 저장 오류로 판단하지 않았다.
- B의 정상 `booking/review` 200 이후, 본인 소유 QA 표식의 **22일 10:00–11:00 Sydney private busy** 임시 일정 한 건을 만들어 독립 GET/ETag/기간을 대조했다. 오래된 review proof로 정상 typed 확인 제출을 시도하면 **409 conflict**로 거절됐다.
- 거절 뒤 B의 제출 row **0개**, 메일 provider/Calendar 연결 없음, 저장된 22일과 selectionRevision 유지, 기존 22일 Calendar events unchanged를 확인했다. A의 confirmed 예약·원본 hash/provider/event·2개 점유도 변경되지 않았다. 정상 API 인증만 사용했으며 DB 직접 쓰기나 서명/충돌 우회는 하지 않았다.
- 소유 kind/nonce와 ETag가 일치한 **본인 임시 22일 일정만 If-Match DELETE 204**, 다시 **GET 200 cancelled**를 확인했다. 정리 후 회사 Chrome에서 Calendar를 Refresh해 20/21/23일 booked/disabled·22일 available와 선택값/확인 버튼 활성화가 복구된 것도 확인했다. 증거는 `.local/company-booking-qa/customer-b-stale-submit-proof.json`이다.
- 가상 고객 A의 확인용 확정 예약은 **20·21일 종일 +23일 09–13시 두 구간·고객 선택의 20/21/23일 차단을 유지**한다. 임시 21일/22일 busy fixture만 제거했다. 확정 후 취소/점유 해제 기능이 후속이므로 확인용 예약을 DB나 Google에서 임의 삭제하지 않았다. 실제 테스트 예약이 해당 날짜 선택에 영향을 주는 상태임을 구분한다.
- 이번 검증에 새로 받은 B 고객 세션 파일은 마지막 API 검증 후 삭제했다. 기존 `domain-api-qa.json`은 보존하며 sanitized 증거에는 cookie·OTP·서명 원문을 넣지 않는다.

## 완료 인수와 미실행 범위

- [x] 임시 busy 일정만 소유/ETag 확인 후 제거하고 실제 제안 발행·고객 확인.
- [x] 별도 회사 금액/전체 구간 확인 서명과 고정 PDF·회사 메일 저장/hash/provider accepted 대조. 실제 Gmail 수신은 아래 별도 인수.
- [x] 실제 회사 확정과 Google 두 opaque/confirmed 구간의 독립 GET·DB 상태 일치.
- [x] 실제 고객 B 화면의 20·21·23일 booked/disabled, 22·24일 available, 22일 저장 확인. 차단 날짜 PUT 3건과 새 충돌 이후 stale submit 모두 409/무제출 확인.
- [x] 실제 고객/EMS 새로고침 복구, Gmail 실제 3통 수신·확정 안내·다운로드 PDF 2페이지 내용 대조.
- [x] 새 외부 busy 추가 뒤 stale submit 409·무제출과 본인 임시 fixture 정리 확인. 확정 event의 실제 이동/삭제로 review 전환시키는 fault injection은 미실행이다. 해당 검토 전환·점유 보존은 자동 회귀 검사로 확인하고 실제 인증 대사에서는 정상 상태를 대조했다.
- [x] 실제 고객 320/393px 제안·확정 상태·PDF 버튼과 Console runtime error 0 확인. 390px·전체 키보드 입력 재실행은 이번 결과로 완료 표시하지 않음.

## 운영 범위와 제한

- 고객 확인은 **회사 제안 금액·범위·전체 일정의 확인**이다. 승인 약관이 없는 정식 계약·작업 지시·결제 의무로 표시하지 않는다. 기존 예약 요청 서명을 재사용하지 않는다.
- 인보이스는 예약 확정 시 발행하지 않는다. 기존 결정인 마지막 작업 후 **Complete → 발행일 +3일 납기**를 유지하며 해당 후속 흐름은 이번 구현에 포함하지 않는다.
- DB와 Google는 단일 원자 트랜잭션이 아니다. 내부 이중 예약은 실제 DB 제약으로 차단하고 Google 외부 변경은 독립 조회·사후 대사·검토로 처리한다.
- 제출/확정 직후 처리·명시적 재시도·인증 worker와 기존 Hobby의 하루 한 번 백업 cron을 연결했다. **일일 cron을 실시간 동기화로 표시하지 않으며**, 예정 시각 자동 실행은 미관찰이다. 확정 event의 실제 변경 주입·전체 키보드 재인수도 이번 결과로 완료 표시하지 않는다.
- 확정 후 재일정/취소·고객 재동의·Google 정리·점유 해제, 정식 계약 약관, 메일 배달/반송 webhook은 후속이다.
