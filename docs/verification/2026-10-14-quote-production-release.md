# 견적 상태 보정 main 통합·운영 배포와 전체 운영 인수

2026-10-14 · Australia/Sydney · `codex/quote-live-e2e-20261014`

## 완료한 배포와 검증

- 작업 커밋: `f17985dd563bd68994659fa592885efe56954edc`.
- main 병합: `98ecb7582294d7e5a6e27351b6d72656920412a4`. 병합 트리는 검증 브랜치와 동일하다.
- 회사 `origin` (`lnkgroupsydney-hub/lnkgroup`)에 작업 브랜치와 main을 atomic push하고 두 원격 SHA를 대조했다. 개인 원격과 원본 공유 작업 폴더의 변경은 건드리지 않았다.
- 회사 Vercel 계정·팀과 기존 `lnkgroup` 프로젝트를 확인했다. 기존 Git 연동의 Production 배포 `dpl_7cDhcPW1RAAwnNirJfvdcPyJddRS`는 **READY**다.
- 배포 URL `lnkgroup-j2pgmg883-lnkgroupsydney-8702.vercel.app`의 Git metadata는 위 main 병합 SHA다. 회사 www/apex 및 기존 Vercel alias도 같은 배포를 가리킨다.
- [운영 견적](https://www.lnkgroupsydney.com.au/quote/start?service=cabinet-painting)은 공개 HTTP 조회에서 200이었다. 해당 배포의 최근 15분 error 로그 조회는 성공했고 결과는 0건이었다. 신규 업무 흐름을 실행한 뒤의 오류 검사로 확대하지 않는다.
- 제품 변경은 접수 Calendar 안내·회사 예약 안내·저장 견적 목록의 문구 3곳이다. 서명·권한·가격·예약 상태·Calendar 쓰기 경로·DB/schema/Auth/환경 설정은 변경하지 않았다.
- 좁은 변경 리뷰에서 병합 차단 결함을 발견하지 않았다. 같은 코드의 관련 **37/37** 검사와 마지막 수정 후 lint·타입·production build 통과 증거를 재사용했다. 전체 767 suite를 이번에 다시 실행하지 않았다.

## 기존 초안 보호와 신규 운영 견적

회사 `Kang (L&K Group)` Chrome의 운영 견적 화면에서 기존 미연결 견적 `RQ-F9D23E120F78440CAC3AB197070F40D5`를 확인했다. `Start a new quote`는 실제로 미연결 초안을 보호하는 오류를 표시했고 새 요청을 만들지 않았다.

회사 브라우저에 연결 화면을 열고 기존 저장 이메일 인증을 요청했다. 사용자가 연결 완료를 알려준 뒤 회사 Chrome에서 실제 새로고침하고 정상 `Start a new quote`로 별도 신규 요청 `1540eace-1423-4354-8802-9b4cbade9f66`를 만들었다. 기존 초안의 보호를 우회하지 않았으며 새 작성의 정상 세션 전환과 자료 삭제를 구분한다.

인증 의존성을 해결한 뒤 **배포 고객 UI → 운영 EMS → 실제 회사 Google Calendar/Gmail**의 전체 업무 흐름을 완료했다. 고객 작성·사진·AI·이메일 인증·날짜/시간·서명·제출과 EMS 확정은 모두 회사 Chrome의 운영 www 화면에서 직접 조작했다. Supabase·OpenAI·Google·Resend의 실제 회사 서비스를 사용했다. 아래 신규 운영 인수는 앞선 localhost 고객 UI + 운영 EMS의 [실제 제공자 인수](2026-10-14-quote-live-e2e.md)와 별도이며 이전 기록은 당시 실행 범위를 유지한다.

## 신규 운영 요청의 실제 결과

overview·upper·lower·side·damage 다섯 역할의 사진을 실제 업로드하고 AI 분석을 **1회** 실행했다. 현재 요청에 묶인 회사 시험 이메일 OTP **1회**로 연결한 뒤 11월 2일 09:30을 선택하고 비구속 확인의 **시험용 typed 서명**을 한 번 제출했다. 시험용 가상 연락처를 사용했으며 실제 고객의 정식 계약·작업 서명을 대신 작성한 인수가 아니다.

| 항목 | 실제 저장·대조 결과 |
| --- | --- |
| 요청 | `1540eace-1423-4354-8802-9b4cbade9f66` |
| 분석 | `25663c26-7512-45a5-b15c-17d84aa63ac0`, `succeeded`, job 1건/attempt 1회 |
| 사진·revision | 5개 역할 모두 ready, 분석 입력/요청 revision 7 |
| 예상 수량·금액 | 도어 14개·서랍 앞판 6개; **A$2,700 + GST A$270 = A$2,970** |
| 가격 경계 | 사진 기반 잠정 도장비, 미확인/현장 미산정 손상은 포함하지 않으며 현장 확인 필요 |
| 서명 제출 | `ac4b0347-572c-4dfa-aa49-5a49dbab9717` / `REQUEST-AC4B0347572C` / v2 typed 비구속 QA 확인 |
| 예약 | `cd3058b4-c5db-4fa6-b288-17d422b935a4` / `signed_request` / `confirmed` |
| take-off | **2026-11-02 09:30–10:30 Sydney (UTC+11)** |
| installation | **2026-11-04 10:00–12:00 Sydney (UTC+11)** |
| 추가 고객 확인 | acceptance 0건, 원본 signed submission 참조, 두 DB 점유 |

EMS는 고객 take-off 시작과 원본 예상 가격을 유지했다. 회사가 take-off 종료·installation 시작/종료와 현장 손상 증가 안내·QA용이며 실제 작업이 아니라는 안내를 확인하고 **Booking confirm 한 번**을 실행했다. 실제 화면에서 `confirmed`·두 Google 기간 검증 완료·`Frozen PDF saved`를 확인했다. 원본 사진 manifest·AI input snapshot·분석·가격·typed 확인 서명·동결 제출본을 연결된 DB 자료와 대조했고, 저장된 AI의 순수 가격 재계산과 회사 확정본의 원본 snapshot/signed-content hash 참조도 일치했다. v2 접수 Calendar 상태는 `not_required`이며 별도 대기 이벤트를 생성하지 않았다.

저장된 AI usage는 input **11,437**·output **2,713**·total **14,150 tokens**다. cached input 0·reasoning 516이며, 저장 rate `openai-gpt-6.1-sol-standard-usd-2026-10-11` 기준 추정 비용은 **USD 0.050004**다. 실제 청구서 금액으로 확정하지 않는다. 이 신규 요청의 job/attempt는 각각 1이며 검증용 재분석을 실행하지 않았다.

## Calendar·메일·PDF·날짜 차단

회사 primary Calendar `lnkgroupsydney@gmail.com`에서 접수번호 검색으로 두 일정·기간을 직접 확인했다. 독립 Google `events.get` **2회**로 각각 ID·payload hash·etag·목적·기간·private/confirmed·attendee/반복 없음과 DB 점유를 대조했다. 기간은 회사 UI에서 입력한 위 Sydney UTC+11 값과 별도로 비교해 일치했다.

회사 native Gmail의 **INBOX 검색 목록**에서 접수 1통·확정 1통과 제목/PDF 파일명을 직접 확인했다. 전체 본문의 시각 열람과 구분하여, 읽기 전용 **Gmail API GET**으로 수신 본문 전체·파일명·첨부 PDF bytes와 DB 동결 자료를 대조했다. 두 메일은 `provider_accepted`이고 확정 outbox `complete=true`다. 각 수신 PDF는 동결 bytes와 완전히 같고 SHA-256도 일치한다.

| 문서 | 실제 수신 PDF | SHA-256 |
| --- | --- | --- |
| 서명 접수본 | 3페이지 / 19,208 bytes | `75f814d79f3cfbfd7518c2398d40b6524bd6e36279f0eabdd908da6b4b7441b4` |
| 예약 확정본 | 2페이지 / 15,392 bytes | `13dd4b66e9ba7b561bec8c7f1d583cc9e385cfb7b1147f0175c3f172e93f6922` |

운영 고객 달력의 최초 실제 UI에서는 기존 점유 **10월 15일·19일·28일·30일**이 disabled/booked였다. 신규 확정 후 정상 운영 availability JSON을 회사 브라우저 GET으로 열어 **11월 2일·4일 `selectable=false/reason=busy`, 사이의 3일 `selectable=true`**를 직접 확인했다. 이 후자는 정확한 API 대조이며, 별도 두 번째 AI 견적을 만들어 날짜 UI를 검사한 결과가 아니다.

## 기존 자료 보존·증거·최종 복원

신규 운영 인수 전 baseline은 견적 3건·서명 접수 2건·확정 예약 2건이었다. 기존 요청 3건은 `select=id,revision,status,payload`의 같은 컬럼 순서와 회사/ID filter로 다시 읽고 `JSON.stringify(row)` SHA-256을 비교했다. 개인 이메일의 기존 draft와 앞선 QA 요청을 포함한 **3건 모두 hash가 불변**이었다. 사용자가 기존 이메일을 직접 연결한 뒤 정상 신규 시작을 사용했으며 접근 보호를 우회하지 않았다.

비공개 결과는 `.local/quote-e2e-20261014/read-proof-1540eace-1423-4354-8802-9b4cbade9f66.json`과 `production-request-preservation-proof.json`에 `completed=true`, 권한 `0600`으로 보관한다. 독립 대조는 DB GET 11회·연결 read RPC 11회·Google event GET 2회·Gmail list 2회/message 4회/attachment 2회였고 기존 3건 보존은 추가 DB GET 3회였다. 이 읽기 검증의 **업무 직접 쓰기·OAuth maintenance는 모두 0회**였다. 정상 운영 UI의 신규 저장/분석/서명/예약 처리와 보조 검증의 읽기 전용 접근은 구분한다.

공개 HTTP entry/shared chunk에서 수정 문구를 찾지 못한 앞선 진단은 대상 모듈 포함을 확인하지 못한 기술 대조다. 이전 문구도 찾지 못했으므로 제품 오류나 운영 E2E 실패로 판단하지 않는다. 아래 최종 운영 화면에서 세 수정 문구의 실제 표시를 직접 확인했다.

회사 www 고객 탭에서 **Cmd+R → View quotes & bookings → 회사 verified 이메일 세션 유지·신규 RQ의 Saved quote 표시 → Open saved quote**를 조작했다. 같은 `REQUEST-AC4B0347572C`·A$2,970·11월 2일 09:30–10:30 take-off·11월 4일 10:00–12:00 installation·confirmed·두 Google 기간 검증 완료·접수/확정 PDF 다운로드 **두 개 모두 enabled**로 복원됐다. 재OTP·재AI·재서명·재제출·재확정 없이 복구됐다.

접수 상세를 펼쳐 `Calendar visits are managed through company booking confirmation; see the booking status below`와 v2의 `View your take-off and installation schedule, booking status and confirmation documents below.`·추가 서명 불필요 안내를 함께 확인했다. 목록의 `Saved quote`까지 세 수정 문구를 실제 배포 UI에서 대조했다. Scroll과 native 화면으로 회사 예약 안내와 A$2,700/GST A$270/총 A$2,970 배치를 직접 시각 점검했으며 스크린샷 파일은 저장하지 않았다.

업무 흐름 실행 후 운영 서버 로그를 `--since 1h --level error`로 조회한 결과는 **종료 코드 0·오류 0건**이다. 비공개 로컬 로그는 `production-e2e-errors.jsonl`이며 이 확인을 브라우저 console 검사로 확대하지 않는다.

앞선 QA **10월 28일·30일**과 이번 QA **11월 2일·4일**의 Google 일정·DB 점유·요청 기록은 보관하며 자동 삭제하지 않는다. 키·OTP·개인정보 원문·사진·메일/PDF 원문·스크린샷·브라우저 인증자료는 문서/커밋에 넣지 않는다.

## 후속 문서와 남은 범위

이번 후속 변경은 검증 문서와 README/TODO의 최신 결과 기록이며 기능 코드는 검증한 main `98ecb75`와 동일하다. 문서 후속 갱신에는 업무 코드 변경이 없다. 관련 37/37과 마지막 문구 수정 후 최종 lint·타입·production build 결과를 재사용했다. 오늘 전체 767 suite를 다시 실행하지 않았다. 신규 코드·DB/schema/Auth/환경/가격 기준 변경은 없다.

실물 모바일·전체 키보드·PDF 페이지별 시각 레이아웃·Google Maps 실제 검색/선택 인수는 이번 결과에 포함하지 않는다. webhook·backup/예정 cron의 실제 실행, 현장 최종 가격·정식 계약·취소/변경·Complete 후 인보이스 +3일 업무는 후속 범위다.
