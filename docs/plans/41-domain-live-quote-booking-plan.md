# 회사 도메인 적용과 실제 견적 승인·예약 연결 계획

2026-10-12 · Australia/Sydney · 착수 기준 `main = origin/main = 31e7387` · 작업 `codex/domain-customer-quote-auth-20261012`

상태: **1~2단계 인수 완료. 3~7단계 중 예상본 승인·Google 날짜 차단/희망일 선택·예약 요청 확인 서명·EMS 저장·PDF 메일·Google 확정 대기 일정은 [42번 구현](42-live-estimate-booking-request-calendar.md)으로 완료했다. 회사 현장 가격 조정·실제 기간/자원·정식 약관·재동의·최종 확정과 배달/반송 webhook은 후속이다.** 실제 다른 물리 기기·미가입 신규 이메일/signup은 미검증이며 아래 최초 조사 결과는 당시 상태로 보존한다.

[전체 운영 계획](37-live-quote-ems-booking-implementation.md) · [AI 예상 견적](40-ai-quantity-provisional-estimates.md) · [TODO](15-home-cabinet-admin-todo.md)

## 0. 후속 구현·검증 상태 — 2026-10-12

- **예약 요청 연동 인수:** `main@418e03d`에서 분기한 `codex/live-quote-booking-calendar-20261012`에 [42번 범위](42-live-estimate-booking-request-calendar.md)를 구현하고 회사 DB/Production에 적용했다. 회사 Chrome에서 기존 사진 5장·A$3,135 예상본 승인 → 예약일 차단 → 날짜 변경 시 서명 무효화 → 확인 서명·제출 → EMS 동일 원본·Gmail PDF 수신·Google 기본 Calendar 일정 1개를 확인했다. 전체 612/612, 관련 54/54 및 lint·타입·빌드 통과. 회사 기간 확인 전 요청은 날짜를 점유하지 않는다. 제출 직후 처리와 일 1회 백업 cron은 연결했으며 예약 시각의 자동 cron 실행은 미검증이다. [실행 기록](../verification/2026-10-12-live-booking-request-calendar.md).
- **Calendar 통일:** 같은 계정의 기본 Calendar와 `L&K Integration`은 서로 다른 ID다. 새 운영 날짜 조회/기록을 `LIVE_QUOTE_CALENDAR_ID=lnkgroupsydney@gmail.com` 기본 Calendar로 통일했고 기존 시험 일정·연결은 보존했다. 아래 1~2단계 시점의 운영 전환 대기 기록은 당시 결과다.
- `main@31e7387`에서 새 `codex/domain-customer-quote-auth-20261012`를 만들고 1~2단계를 구현했다. 회사 브라우저 인수와 CLI 배포 후 사용자 요청으로 `92f76a8`을 커밋하고 `main`에 병합했다(`6dd42ea`). 회사 `origin`만 push 대상으로 사용한다.
- www 기준 origin을 반영해 `GET /api/quote/requests` **200**을 확인했다. 회사 발신 설정은 `COMPANY_EMAIL_FROM=quotes@lnkgroupsydney.com.au`, Reply-To는 `lnkgroupsydney@gmail.com`이다. 기존 시험 발신/회사 수신 제한과 직원 발신을 분리했다.
- 사용자 저장으로 회사 Supabase custom SMTP를 연결하고 Site URL을 새 www, 고객 OTP를 8자리/900초와 코드 템플릿으로 설정했다. Google OAuth callback도 새 www의 `/api/google/callback`으로 수정·저장했다. 설정 완료와 실제 수신·로그인 성공은 별도 판정한다.
- 최종 점검에서 Vercel에 누락된 회사 Google client ID/secret을 Production Secret으로 추가했다. EMS의 누락 설정 성공 오표시도 수정했다. 최종 배포의 회사 Chrome에서 기존 소유 캘린더·Gmail 라벨 조회가 성공했으며 시험 대상 `L&K Integration`/`L&K Integration Test`는 보존했다. 운영 Calendar 대상 전환·이벤트 생성은 후속이다.
- 고객/직원 세션 분리, 특정 저장 요청의 이메일 검증·접근 관계, 연결된 견적/사진 복구, 로그아웃·만료·다중 탭 요청 ID 검사를 구현했다. 이메일 문자열이 같다는 이유로 과거 EMS 자료를 모두 연결하지 않는다. 고객 세션 만료 후에는 OTP 재인증으로 연결된 요청 목록에 복귀한다.
- `QUOTE_LEGACY_BASE_URL=https://lnkgroup.vercel.app`은 기존 guest 작성본 읽기와 15분/일회용 이전에만 명시 허용한다. 새 작성/수정은 차단하고, 새 사이트에서 복구 fragment를 읽은 즉시 URL 기록에서 제거한 뒤 원래 이메일 OTP로 연결한다.
- 회사 SQL `20261012085406` 적용 성공. 기존 요청 **12건**, 사진 **29건**, 분석 **15건**의 내용 hash가 보존됐고 신규 세 테이블의 익명 접근은 `42501`로 차단됐다.
- 자동 suite **558/558개**, lint·타입·빌드가 통과했다. 회사 Vercel 배포 **`dpl_FSteedNuKs7tnRBSEga5VGKaPFon` READY**: `https://lnkgroup-bzrc4mgx1-lnkgroupsydney-8702.vercel.app`. 작업 폴더 배포와 Git 커밋/병합을 구분한다.
- 회사 Chrome에서 SMTP 실제 발송을 확인했다. 고객 OTP **`01a12f6e-ee5f-7521-bca0-5b413199d00d`**, **2026-10-12 09:26 UTC**, From **`L&K Group <quotes@lnkgroupsydney.com.au>`**, 상태 **delivered**이며 사용자가 코드 인증을 완료했다. 새 회사 도메인의 EMS 직원 로그인·코드 수신도 성공했다. 코드 값·키는 기록하지 않는다.
- 기존 Vercel 요청 **`895f8919-7e19-4506-972d-944285b0185a`**를 일회용 이전 + OTP로 새 www에서 **동일 ID** 복구했다. 서비스 저장 **revision 2**, 필수 사진 **5장 업로드 revision 7**을 회사 Chrome에서 확인했다.
- AI job **`cee10c05-a7c7-4f8a-9fa9-ae62b19bb6e9`**는 **2026-10-12 09:34:08 UTC succeeded**, 입력 revision **7**/사진 **5장**이다. **15문/6서랍**, 소계 **A$2,850**, GST **A$285**, 총액 **A$3,135**이며 다른 현장 사진의 수량/보수는 합산하지 않았다. 회사 Chrome 고객·EMS 상세·DB에서 같은 5개 photo ID/job/revision/금액을 대조했다.
- **09:35:00 UTC** 고객 로그아웃의 DB `revoked_at`과 직원 EMS 새로고침 후 로그인 유지를 확인했다. **09:35 UTC** 두 번째 OTP가 회사 Gmail에 도착했고 새 고객 세션 인증에 성공했다. 연결 목록에는 위 요청만 표시되고, 같은 이메일의 미연결 API QA 요청은 보이지 않았다. `Open saved quote`로 사진 5장/같은 AI job/금액을 복구하고 새로고침 보존을 확인했다.
- **검증 제한:** 별도 고객 세션으로 복구를 확인했으며 실제 다른 물리 기기·미가입 신규 이메일/signup은 시험하지 않았다. [인수 기록](../verification/2026-10-12-domain-customer-quote-auth.md)에서 실제/합성 검증을 구분한다. 예상본 승인·운영 예약/서명·live PDF/메일·Google 확정은 이번 1~2단계에 포함하지 않았다.

## 1. 최초 읽기 조사 결과 — 2026-10-12 구현 전

| 항목 | 10월 12일 확인 결과 | 다음 조치 |
| --- | --- | --- |
| Git | 회사 origin을 fetch한 뒤 main과 origin/main 동일, 앞섬/뒤처짐 0/0 | 구현 착수 시 최신 기준에서 작업 브랜치 생성 |
| Vercel | 회사 팀의 `lnkgroup` 프로젝트에 `lnkgroupsydney.com.au` 등록. 해당 주소 조회는 Production `dpl_7q7iGxAG6nLaMECmPqPHKoq1Nx3U`, READY | 새 도메인 앱 설정을 반영한 배포 필요 |
| 대표 웹 주소 | 루트 도메인이 경로·쿼리를 보존해 `https://www.lnkgroupsydney.com.au`로 308 이동. www의 홈·Quote·EMS 페이지 HTTP 200, HTTPS 정상 | 현 설정에 맞춰 www를 기준 origin으로 사용 |
| 견적 API | www의 `GET /api/quote/requests`는 **403 / This application address is not allowed**. 이전 `lnkgroup.vercel.app`에서는 200 / request null | 페이지 개통과 앱 기능 개통을 구분. origin 전환을 최우선 수정 |
| Production 환경 | `APP_BASE_URL=https://lnkgroup.vercel.app`, `RESEND_FROM_EMAIL=L&K Demo <onboarding@resend.dev>`, `QUOTE_DEMO_ENABLED=false` | 기준 주소·운영 발신 설정과 관련 코드를 함께 전환 |
| 비밀 설정 | `RESEND_API_KEY`는 Production 변수 목록에 존재. Secret 값은 읽기/pull 결과로 유효성을 판정하지 않음 | 키를 출력·교체하지 않고 후속 허용된 실제 발송으로 확인 |
| Resend | `lnkgroupsydney.com.au`: **verified**, sending enabled, receiving disabled. DKIM·SPF 제공자 검증 완료 | 발신 주소를 앱·Auth에 연결하고 실제 수신 인수 |
| DNS | DKIM TXT 및 send/rsend CNAME 조회 성공. DMARC `p=quarantine`, relaxed alignment 존재. 루트 MX는 ENODATA | 도메인 메일 수신함이 준비됐다고 가정하지 않음. 답장은 회사 Gmail 활용 제안 |
| 배달/자동 처리 | Production 변수 목록에 Resend webhook secret·Cron secret 없음. live 메일 webhook/반복 batch 연결도 미구현 | RQ-07/09에서 서명 검증 webhook·인증 batch·재시도 연결 |
| 검색 공개 | 홈·견적·EMS 응답은 noindex 유지 | 도메인 연결만으로 색인·운영 계약 공개를 완료 처리하지 않음 |

최초 조사 수단은 회사 Vercel CLI, 연결된 Resend의 domain list/get, 공개 DNS·HTTPS GET이다. 이 조사 시점에는 개인 브라우저 접근, 고객 자료 생성, 테스트 발송, DNS/환경변수 수정은 하지 않았으며 SMTP/Site URL·OAuth callback은 직접 확인 전이었다. 위 0절은 후속 구현 승인 이후의 최신 상태다.

## 2. 고객에게 연결할 흐름

**Photos and analysis → 예상 금액·포함/제외 항목 확인 → 고객 이메일 인증 → 예상 견적 승인 → 희망 시작일 → 최종 확인·서명·제출 → EMS 저장·PDF 메일 → Google 확정 대기 일정 → 회사 기간·충돌 확인 → 필요한 고객 재동의 → 예약 확정.**

- 시작가 A$1,500 GST 별도, 기존 v2 단가·수량 추정·GST 계산은 유지한다. 첫 승인은 사진 기준의 예상 견적에 대한 진행 의사다. 정확한 수량·상태·최종 금액은 현장 확인 후 조정한다.
- 정상 숫자 결과가 있는 고객에게 회사 수동 발행을 먼저 기다리게 하지 않는다. `review_required`/총액 보류는 추가 자료 또는 회사 검토로 연결하며 숫자 없는 견적 승인은 차단한다.
- 회사 검토 전 희망 날짜를 확정 예약으로 표시하지 않는다. 고객 서명 제출은 예약 요청이며 회사 승인 약관에도 그 의미를 명시해야 한다.
- 이미 예약된 날짜는 선택 불가. 최종 확정은 회사가 실제 작업 기간·자원·Google 및 DB 충돌을 확인한 뒤 진행한다.
- 현장에서 가격·범위·약관 또는 제안 일정이 달라지면 새 버전과 변경 이유를 보여주고 재동의·필요 재서명을 받는다. 과거 동의/서명 원본은 보존한다.

## 3. 순차 구현 단위와 인수 기준

아래 항목은 합의한 요구사항·완료 기준이다. 1~2단계와 3~7단계의 예약 요청 부분을 구현했으며 최신 인수는 0절·42번 계획을 따른다. 3~7단계의 회사 최종 조정·정식 계약/확정 등 남은 범위를 전체 완료로 해석하지 않는다.

### 1단계 — 새 주소에서 저장·직원 로그인·메일 기반 정상화

**현재 완료:** origin·회사 발신·SMTP/Site URL/OTP·Google callback 설정 반영, 회사 OTP delivered/사용자 인증·EMS 직원 로그인·www 저장/5장 AI·기존 요청 이전·고객/EMS/DB 동일 분석/금액 대조 확인.

1. 운영 origin을 `https://www.lnkgroupsydney.com.au`로 맞춘다. 광범위 Host/Origin 허용으로 403을 우회하지 않는다. localhost 개발 주소는 별도 유지한다.
2. 기존 직원 메일의 `onboarding@resend.dev` 전용 검증부터 교체한다. 검증된 회사 발신 주소와 데모 발신/수신 제한을 분리한 뒤 환경변수를 변경한다. 직원 수신 권한·추가 인증 정책은 유지한다.
3. 최초 제안한 발신 `L&K Group <quotes@lnkgroupsydney.com.au>`와 Reply-To `lnkgroupsydney@gmail.com`을 후속 승인으로 설정했다. 고객 인증 메일의 해당 From과 실제 delivered를 확인했다. 인증 메일은 용도에 맞는 별도 제목·본문을 사용하며 이 성공을 견적/PDF 발송 완료로 확대하지 않는다.
4. Supabase Site URL·필요한 정확한 인증 redirect, Resend custom SMTP, Google OAuth callback `/api/google/callback`과 현재 연결 상태를 점검한다. 기존 refresh token을 이유 없이 폐기하지 않는다. 메일 발신 인증과 Gmail 수신·Calendar OAuth는 별도 연결이다.
5. 기존 vercel.app 작성 쿠키는 새 도메인으로 이전되지 않고 현재 서명도 origin에 귀속된다. 전환 전 저장본을 보존하고, 아래 고객 인증/복구와 연결한다. 필요한 기존 주소 복구 경로만 한시적으로 명시 허용하되 신규 작성 기준은 www로 단일화한다. 기존 쿠키를 URL로 전달하거나 서로 다른 도메인에 공유하지 않는다.

**완료 기준:** www에서 새 요청 저장·사진/분석 조회 및 직원 로그인/코드 수신 정상. 잘못된 origin은 차단. 기존 자료 보존. DNS 인증 완료와 실제 수신 성공을 별도 기록.

### 2단계 — 고객 이메일 인증·요청별 복귀 권한

**현재 완료:** 요청별 인증/복구·세션 분리·다중 탭 보호 구현/자동 검증, 실제 OTP/이전 요청 복구·로그아웃 DB 회수/직원 로그인 유지·두 번째 OTP의 별도 고객 세션에서 같은 사진/분석/금액 복원과 새로고침 보존 확인. 실제 다른 물리 기기·미가입 신규 이메일/signup은 미검증이다.

- Supabase Auth 이메일 OTP와 Resend custom SMTP를 연결한다. 고객 세션은 직원 세션과 분리한다. **1~2단계 구현 UI는 특정 초안/분석 결과를 보관하는 이메일 인증과 연결된 견적 복구를 제공한다.** 가격 후 Approve 진입은 3단계에서 이어 붙인다.
- 현재 작성 권한과 인증된 이메일 소유권을 함께 검증해 **특정 요청**에 접근 관계를 만든다. 입력 이메일이 같다는 이유만으로 과거 EMS 고객 전체를 연결하지 않는다.
- 다른 날/기기는 이미 검증된 요청 관계로 복귀한다. 이전 도메인의 미인증 초안은 유효 기존 작성 권한으로 발급하는 짧은 일회용 이전 권한 + 이메일 인증, 또는 감사되는 회사 복구 절차로 처리한다. 만료 쿠키를 임의로 되살리지 않는다.
- OTP 재발송 제한·만료·재사용 거절·계정 존재 여부 노출 방지와 사진/문서 권한 검사를 포함한다.

**완료 기준:** 고객 A/B의 견적·사진·문서 교차 접근 차단, 다른 기기 복귀, 같은 브라우저 EMS 로그인 유지.

### 3단계 — 예상 견적 승인 버전·회사 현장 조정

- AI 결과 ID, 입력 revision, 사진 manifest, 항목·수량·세금·총액·가격 규칙·가정·제외 항목을 승인 당시 불변 버전으로 고정한다.
- `Approve estimate and choose date`를 현재 유효 결과와 고객 권한이 있을 때 활성화한다. stale 분석·사진 변경·금액 조작을 서버에서 차단한다.
- **시스템의 예상본**과 **직원이 현장 확인 후 발행하는 최종본**을 구분한다. 회사 EMS에 수량/범위/금액 수정·사유·새 버전·이전/새 금액 비교를 추가한다. 승인된 단가·GST 계산과 근거가 유지돼야 한다.
- 견적 유효기간은 회사 정책 결정 대상이며 임의의 날짜를 운영값으로 넣지 않는다. 수정본은 새 고객 동의를 요구한다.

**완료 기준:** 고객·EMS가 같은 승인 버전을 표시하고 재분석/현장 변경이 기존 승인본을 덮어쓰지 않음.

### 4단계 — 운영 날짜 선택·동시 예약 차단

- 기존 availability/DST/종일 이벤트/전체 페이지 조회·충돌 검사를 live 요청에 연결한다. 운영 회사·작업 자원·Calendar 매핑을 먼저 정한다.
- Google busy + 실제 DB 점유 날짜를 가리고 제출 직전 재검사한다. 조회 실패 시 빈 달력으로 예약을 허용하지 않는다.
- 기간 산식은 미정이므로 고객은 희망 시작일을 고른다. 회사가 기간을 입력한 뒤 전체 구간을 검사한다. 확정 전 요청/보류의 상태·유효 범위를 별도로 정의하고 임의의 종료일을 생성하지 않는다.
- 시험 예약의 FK·자원·worker 조회 범위를 분리하며, 실제 회사 Calendar의 busy 구간은 출처와 무관하게 충돌 검사에 반영한다.

**완료 기준:** 이미 예약된 날·기간 중간 충돌·오래된 달력·동시 확정의 중복 점유 차단.

### 5단계 — 최종 확인·회사 약관·서명·제출

- 기존 SignaturePad와 검토 화면을 재사용하고 live 금액·사진·주소·희망일·회사 승인 약관을 연결한다. 데모 약관/금액을 실제 문서에 사용하지 않는다.
- 서명할 내용 전체의 snapshot/hash, 약관 버전, 본인 동의, 시각, 중복키를 원자적으로 저장한다. 재클릭/응답 유실은 같은 제출 결과를 반환한다.
- 최초 예상 견적/예약 요청 서명과 회사의 정확한 기간·최종 조건에 대한 수락을 구분한다. 서명 후 수정은 새 버전을 만든다.

**완료 기준:** EMS 동일 서명본·새로고침 복원·모바일/키보드 서명·중복 제출 1건. 정식 약관 미준비 시 실제 계약 활성화는 대기.

### 6단계 — 고정 PDF·실제 고객 메일·클라우드 자동 처리

- live 제출본에서 예상 견적서와 서명한 문서를 생성·비공개 저장하고 고정 bytes/hash를 outbox 발송에 사용한다. 현장 확정 전 문서를 최종 확정 견적이라고 부르지 않는다.
- 승인된 회사 도메인으로 인증한 고객에게 발송한다. Resend 수락, 배달, 반송, 실패를 구분하고 서명 검증 webhook의 중복/순서 역전을 처리한다.
- 로컬 반복 worker를 인증된 배포 batch로 연결하고 DB lease·재시도·실패 복구를 사용한다. 실행 주기/실행 시간/회사 요금제를 확인해 설정한다. AI `after()` 성공을 메일/Calendar 상시 처리 완료로 간주하지 않는다.
- 제공자 응답 유실은 상태를 대사한다. 중복키 보장 기간 이후 새 키로 무조건 재발송하지 않는다. 메일 실패가 저장된 서명/예약 요청을 지우지 않는다.

**완료 기준:** 허용된 파일럿 실제 수신자에게 PDF 도착, 저장본과 일치, 컴퓨터/브라우저 종료 후 자동 복구·중복 없는 발송.

### 7단계 — Google 확정 대기·회사 검토·최종 확정

- 서명본 메일의 제공자 수락 후 회사 Google Calendar에 `확정 대기` 요청을 중복 없이 기록한다. 의미가 정해지지 않은 작업 기간을 확정 busy 구간으로 꾸미지 않는다.
- 회사 EMS에서 실제 시작/종료·자원·전체 충돌을 확인한다. 변경된 기간/가격/범위는 고객 재동의를 연결한다.
- 확정 명령은 **현재 회사 제안의 정확한 전체 작업 구간에 대한 고객 동의·서명과 해당 서명본 메일의 `provider_accepted`**를 확인한 경우에만 허용한다. 최초 희망일의 서명·메일 수락으로 이후 회사 제안을 확정하지 않는다.
- 확정 시 최신 Google 상태 재검사 → 회사/자원별 DB 원자 점유 → 안정 event ID로 Google 반영 → 재조회 일치 확인 순으로 진행한다. 그 전에는 `확정 처리 중`이다.
- Google에서 일정이 이동·연장·삭제되면 검토 건을 만들고 필요한 재동의를 받는다. 기존 계약을 자동으로 바꾸지 않는다.

**완료 기준:** 고객·EMS·Google 동일 일정/버전, 동시 확정 한 건만 성공, API 실패·응답 유실·외부 변경 복구.

## 4. 기존 구현의 재사용과 필요한 확장

| 영역 | 재사용 | 필요한 확장 |
| --- | --- | --- |
| Quote | `quotes` 입력/사진/AI/가격·revision·비공개 API | 고객 principal·예상본 승인·복귀·live 단계 UI |
| DB | `lk_quote_request_access`, `lk_terms_versions`, `lk_quote_versions`, `lk_quote_acceptances` 기반 테이블 존재 | 현재 읽기 scaffold를 실제 권한/RPC로 확장. `issued_by` 필수인 정식 버전에 AI를 가짜 직원으로 저장하지 않음 |
| 승인 | 견적/약관 snapshot 구조 | 예상본 approval과 최종 수락 구분, 견적 버전과 별개 일정 제안 재동의 관계. 기존 unique 제약을 억지로 재사용하지 않음 |
| 날짜/서명 | `enquiries` availability, `shared/ui/signature-pad.tsx` | localhost/demo gate·고정 회사 수신자·고정 데모 금액/약관을 live 계약과 분리 |
| PDF/메일 | 렌더링·고정 payload·lease·멱등 재시도 | live 문서 snapshot, 운영 발신/고객 수신, webhook |
| 예약 | `bookings` 제안/충돌/점유·Google etag/대사 | demo FK·단일 자원 제약을 회사/운영 자원으로 확장 |
| 관리자 인증 | 기존 직원 membership·추가 메일 확인 | 회사 발신 주소 지원, 고객 OTP와 세션/권한 분리 |

운영 SQL은 기존 자료를 보존하는 추가 migration으로 만들고 실제 회사 적용 전에 권한·제약·경합을 검사한다. 모든 테이블을 복제하거나 데모 기록을 운영 기록으로 자동 승격하지 않는다.

## 5. 착수 우선순위와 남은 결정

첫 구현 묶음인 **1~2단계: 도메인 403 해결·직원 메일 호환·고객 인증/복구**의 코드·설정·배포와 회사 Chrome 실제 메일/로그인/이전·www 저장/사진 AI·EMS 대조·고객 별도 세션 재복구 인수를 완료했다. 이후 **3~5단계 승인·날짜·서명**, **6~7단계 발송·Google 확정** 순으로 연결한다. 실제 다른 물리 기기·미가입 신규 이메일/signup과 동일 현장 수량의 실측 정확도는 별도 검증으로 남기며, 이미 검증한 AI 가견적을 다시 만들고 시작하지 않는다.

회사 승인 약관, 견적 유효기간·변경/취소 조건, 실제 작업 자원·Calendar, 미확정 일정 표시/보류 정책, 배치 주기/요금제는 후속 구현 중 확정해야 한다. 운영 발신은 위 회사 주소로 설정/인수했으며 새 도메인 수신함 개설을 의미하지 않는다. 자동 작업기간·현장 방문 비용·새 메일 수신함은 이번에 임의 확정하지 않는다.

각 묶음은 관련 자동 검사·타입/lint/build 후 **회사 Chrome의 새 도메인**에서 인수한다. 최종 인수는 사진 5장 → AI 예상 금액 → 이메일 인증 → 승인 → 예약 날짜 → 서명 → PDF 수신 → EMS/Google 대조 한 건을 끝까지 수행한다. 실제 동의·서명은 당사자가 수행하며 시험 자료를 실제 계약으로 처리하지 않는다. 동시 예약·반송·토큰 만료·새로고침·작업 중단도 검사한다.

## 6. 확인에 사용한 공식 문서

- [Resend 도메인 인증](https://resend.com/docs/dashboard/domains/introduction): 인증된 발신 도메인과 메일 수신 기능을 구분.
- [Vercel Secret 변수](https://vercel.com/docs/environment-variables/sensitive-environment-variables): 비밀값을 읽지 못하는 것을 미설정으로 판정하지 않음.
- [Supabase 고객 이메일 OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless)·[custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)·[redirect URL](https://supabase.com/docs/guides/auth/redirect-urls): 고객 인증/메일/복귀 설정 기준. 최초 조사에서는 설정을 변경하지 않았고, 후속 1~2단계 승인으로 회사 설정과 실제 OTP 배달/인증을 확인했다.

프로젝트 Complete 후 인보이스 발행·발행일 +3일 납기, 카드결제, 쇼핑몰, 전체 EMS 집계는 이 연결 뒤의 별도 단계다.
