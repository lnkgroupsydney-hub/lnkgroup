# 실제 예상 견적 승인·예약 요청·Google Calendar 인수

2026-10-12 · 회사 Chrome `Kang (L&K Group)` · Google 계정 `lnkgroupsydney@gmail.com`

## 구현·배포

- 브랜치: `codex/live-quote-booking-calendar-20261012`, 기준 `main@418e03d`. 이번 기능은 작업 폴더에서 회사 Vercel에 배포했으며 Git 병합/푸시와 구분한다.
- 회사 프로젝트: `prj_GVXTidyYCj4zapcEkRpZWOsaXHq6`, 팀 `team_wxpVLa8lqL0xuCzFcAyIXJnv`.
- 최초 기능 인수 배포 `dpl_CsmaREhzouhMQXYM7ryDtw68zQtW` READY. EMS 목록의 부정확한 “In progress” 설명을 “Details saved”와 상세 상태 안내로 수정한 최종 배포 `dpl_GdtvDY3CL48orKGaZs1pWNhg8A5L` READY.
- 주소: `https://www.lnkgroupsydney.com.au/quote/start?service=cabinet-painting`.
- `LIVE_QUOTE_CALENDAR_ID=lnkgroupsydney@gmail.com`와 서버 전용 `CRON_SECRET`을 회사 Production에 설정했다. 비밀값은 출력/커밋하지 않았다.

## 회사 데이터베이스

- `20261012100045_live_quote_booking_flow.sql`을 회사 프로젝트 `xlqyafthsxallostcqfe`의 새 SQL 작업에서 실행: **Success. No rows returned**.
- 적용 전후 내용 hash 일치: 요청 13건, 사진 35건, AI 분석 16건, 기존 데모 제출 5건, 기존 예약 1건.
- 신규 승인·제출·명령 영수증·확정 구간 테이블 네 개와 booking RPC는 publishable key GET에서 **401 / 42501**로 차단. service role 조회는 성공했다. HEAD 응답은 오류 body가 없으므로 권한 판정에 사용하지 않았다.
- 기존 데모 테이블과 운영 예약 요청 테이블을 분리했다. 기본 Calendar ID와 시험용 `L&K Integration` ID는 같은 계정 아래 별도 자원이다. 새 운영 흐름의 조회/기록은 기본 Calendar 하나를 사용하며 옛 선택/링크는 변경하지 않았다.

## 실제 브라우저 흐름

기존 회사 QA 요청 `895f8919-7e19-4506-972d-944285b0185a`의 저장된 성공 분석을 재사용했다. 이번 검증을 위해 OpenAI 재분석을 추가 호출하지 않았다.

1. 인증된 고객 화면에서 사진 **5장**, 입력 revision **7**, 분석 `cee10c05-a7c7-4f8a-9fa9-ae62b19bb6e9`, **15문/6서랍**, 소계 **A$2,850 + GST A$285 = A$3,135** 확인.
2. “Approve estimate and choose date” → 승인 `0a901e03-72d1-4f2d-a640-ee385d06b793`, version 1. 원본 사진/금액/분석을 고정하고 입력 revision은 7 유지.
3. 회사 기본 Calendar에 개인정보 없는 임시 opaque QA 일정을 10월 21일에 생성하고 독립 GET으로 확인. 앱에서 **21일 disabled / Booked**, 20일·22일은 선택 가능. API 날짜 마스크와 화면 일치.
4. 10월 20일 선택 → 확인문 → 시험 서명·동의 → 22일로 변경했을 때 서명 폼/동의·제출 버튼이 제거됨 확인. 다시 20일 선택·확인 후 `LK Booking QA 20261012` typed acknowledgment로 제출. **계약/결제/확정 예약이 아닌 시험용 예약 요청**이다.
5. 아래 동일 요청이 고객·EMS·DB에 저장됐고 고객 새로고침 후 같은 결과 복구. 사진/연락처/서비스 편집 버튼은 제거되고 읽기 전용 안내 표시.
6. 회사 EMS에서 인증된 이메일 연결, 서명 이름, 10월 20일, 고정 PDF, 메일 접수, Google synced, 실제 기본 Calendar 주소를 대조.
7. Chrome 320×844 기기 화면에서 영수증·메일/Calendar 상태·다운로드·새로고침 버튼이 잘리지 않음 확인. Console 표시 메시지 0개. 모바일의 신규 날짜 선택/그리기 전체 재실행은 하지 않았으며 해당 입력은 자동 검사와 데스크톱 흐름으로 검증했다.

## 저장·발송·Google 증거

| 항목 | 확인 값 |
| --- | --- |
| 요청 제출 ID | `070eeb13-c91f-4a70-b567-97c2d9ecaaeb` |
| 영수증 번호 | `REQUEST-070EEB13C91F` |
| 제출 시각 | `2026-10-12T10:23:05.557616Z` |
| 희망일 | `2026-10-20` (Sydney) |
| 상태 | email `provider_accepted`, Calendar `synced`, error null |
| Resend message ID | `01a12fa3-4f3b-70f1-af18-f83ed1cffc34` |
| Calendar event ID | `ada14142934531602aea462267fca43cf710b57628556147ade36615ad64f17ad` |
| Google 독립 GET | 같은 ID·ETag·snapshotHash, start `2026-10-20`, exclusive end `2026-10-21`, `private` / `transparent` / `tentative`, 참석자 0명 |
| snapshot SHA-256 | `c7fd5b2c024a9039f065e63d7e9b123febd0ae72e5f7c4cd4d5ed7ee3ab456e2` |
| signed content SHA-256 | `73eaa7ab29e10814da964f667c2b72e756e9b8c9e5a665ee051daec74314609d` |
| PDF SHA-256 | `964462d1aa2e3c86e00dab63d5f4b8c4284a9ccf7be95a3751273f4c1c594141` |

- Gmail에서 **21:23 Sydney** 수신 메일을 직접 열었다. From `L&K Group <quotes@lnkgroupsydney.com.au>`, 회사 Gmail 수신, 정확한 요청 번호·희망일과 PDF 첨부 1개를 확인했다. 서버의 provider acceptance와 실제 수신을 별도 확인했다. 앱은 여전히 acceptance로 표시하며 일반 고객 delivered를 추정하지 않는다.
- 실제 첨부 PDF **3페이지**를 Gmail에서 열고 로컬 파서/렌더러로 검사했다. 참조·총액·GST·서명·사진 5개 ID/해시·원본/서명 해시가 일치하며 잘림·겹침·공개 접근 URL이 없다. 고객 다운로드 버튼으로 받은 PDF와 DB 고정 PDF의 SHA-256도 일치했다.
- 로컬 발신용 Resend 키의 메일 상세 GET은 401이어서 해당 응답으로 배달 상태를 판정하지 않았다. 정상 Production 발송과 Gmail 실제 수신을 근거로 한다. 키를 교체하거나 권한을 넓히지 않았다.
- 실제 Google Calendar 회사 계정 화면에서 기본 Calendar 표시를 켜고 `Pending booking request · REQUEST-070EEB13C91F`를 열었다. 10월 20일·비공개·희망일/회사 검토 고지 일치. 기본 Calendar에 같은 submission 표식의 일정은 **1개**였다.
- 인증된 recovery endpoint 2회 재실행은 각각 claimed/accepted/calendarSynced **0**으로 이미 완료된 작업을 재전송하지 않았다.
- 차단 확인용 **10월 21일 임시 QA 일정만** 원본 소유 표식과 ETag를 확인하고 제거했다. 재조회에서 21일 다시 선택 가능. 위 제출의 transparent pending 항목과 영수증은 인수 확인용으로 남겨 두었으며 날짜를 점유하지 않는다.

## 자동 처리와 제한

- 제출 직후 Next `after()`가 저장된 outbox를 처리한다. 별도 인증 batch는 1회 최대 5건, 시작 후 120초를 넘으면 새 작업을 시작하지 않는다. 중간 중단 시 DB lease와 고정 이메일 key/body를 이용해 복구한다.
- 실제 회사 Vercel은 **Hobby**다. `vercel.json`의 매일 `03:00 UTC` cron이 해당 Production 배포에 등록된 것을 API로 확인했다. 익명 endpoint **401**, 인증 호출 **200**, storageErrors 0. 예약 시각의 스케줄러 자동 호출은 아직 도래하지 않아 미검증이다. 제출 직후 처리는 실제 실행됐다.
- [Vercel 제약](https://vercel.com/docs/cron-jobs/usage-and-pricing)에 따라 하루 한 번의 백업 복구이며 정밀 시각/분 단위 복구를 보장하지 않는다. 명시적 고객 재시도와 별도 `npm run booking:worker -- --once`도 가능하다. Resend 재시도 창이 지난 불명확 전송은 수동 검토로 남긴다.
- 확인한 것은 **예약 요청**의 제출/보관/메일/Calendar 저장이다. 회사 실제 기간·최종 가격/약관·변경 재동의·확정 예약 및 그 양방향 변경 승인, live 배달/반송 webhook은 후속이다. 이번 기능으로 이 후속 범위를 완료 표시하지 않는다.

## 자동 검사

- focused live booking **54/54** 통과: DB/API 권한·최신 manifest·가격 위조·만료/선택 변경·서명/동시 재시도·편집 잠금, PDF/메일 gate/lease, Calendar DST/실패/읽기 확인/응답 유실/외부 변경, UI 응답 수명과 복구 상태.
- `npm run check` (lint·타입·빌드) 통과. 마지막 EMS 안내 문구 변경은 해당 ESLint 및 최종 Vercel 빌드/TypeScript 성공으로 확인.
- 전체 자동 suite 최종 결과: **612/612 통과**.
