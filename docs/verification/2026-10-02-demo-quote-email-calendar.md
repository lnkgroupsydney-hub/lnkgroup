# 회사 전용 데모 — 서비스 저장·날짜·서명·메일·Calendar 검증

2026-10-02 · Australia/Sydney · 확인용 스크린샷 저장 없음

## 승인된 범위

사용자가 가격표·약관은 데모 데이터로 대체하고 Resend 메일 후 회사 Calendar 자동 저장을 요청했다. API key 입력 완료와 인증된 발신 도메인 없음도 확인했다. 이번 흐름은 loopback 로컬에서 회사 주소 `Lnkgroupsydney@gmail.com`만 수신할 수 있다. 샘플 AUD 1,250·비구속 데모 약관·가상 서명은 실제 계약/가격/세금/청구/작업 승인이 아니다.

서비스 저장 → 데모 approve → 회사 Calendar busy를 반영한 희망일 → 서버가 만든 최종 요약·입력 성명/그린 서명 → 불변 제출 → Resend 수락 → `Pending confirmation` Calendar 이벤트 순서다. 첨부는 서명이 들어간 **HTML 견적·HTML 데모 약관 각 1개**이며 PDF 완료로 표시하지 않는다. 사진/AI·실제 고객 인증/계약·기간 계산·예약 확정은 후속이다.

## 코드·DB 검사

- `npm run check`: lint·TypeScript·production build 통과. 새 API 5개 생성 확인.
- `npm run test:operations`: **117/117 통과**, 실패/skip 0. 기존 80 + 제출 DB 14 + API/가용성 12 + 이메일/worker 11.
- DB/API 격리 검증: 세션·Origin·대상 수신자·loopback 제한, 소유 분리, 옛 revision/서명/변조 token 거절, 이름·서명 좌표 검증, 조회 후 새 busy/Calendar 대상 변경 차단, 동일 제출 응답 유실 재시도, 불변 서명/메일 본문, lease fencing, 최초 발송 전 payload 고정, 수락·outbox 원자 저장, 23시간 이후 불명확한 재발송 중단.
- Google 어댑터 격리 검증: 반복 일정 확장 요청·모든 페이지 수집, 비정상/부분 응답·대상 변경 시 차단, 제목·주소·attendee를 요청/고객 응답에서 제외. 기존 9개 도메인 시험은 Sydney/DST·다일 종료 경계 포함.
- `.next/static` 검사: Resend/Supabase/Google 서버 비밀값 노출 없음.
- 회사 SQL Editor에서 `20261002113243_demo_quote_submissions.sql` 적용 `Success. No rows returned`. 기존 적용 migration을 재실행하지 않음.
- `npm run test:supabase:connection` 통과: 서버 14개 private table·4개 private RPC, publishable key 접근 거절. 새 RPC/trigger 함수 invoker, 빈 search_path, anon execute false/service_role true 확인.
- Security Advisor 오류 0·경고 0·정보 14개는 서버 전용 테이블의 의도한 RLS No Policy. Performance Advisor 오류 0·경고 0·정보 1개. 회사 관리 인증 및 수동 migration history repair는 여전히 별도 대기이며 `db push`하지 않음.

## 실제 연결·브라우저 검증

사용자 127.0.0.1 작성 초안을 수정하지 않고 별도 `localhost:3003` 세션에서 가상 고객 `LK DEMO TEST`로 시험했다. 서비스는 Colour change·문 4개, 주소는 DEMO ONLY 가상 문구다.

1. 고객 저장 → Save service details → 데모 금액/약관 승인 → 날짜 단계 이동 확인.
2. 회사 소유 `L&K Integration` 시험 Calendar를 확인하고 10월 9일 opaque 임시 일정을 생성했다. 앱의 해당 날짜는 **Booked·disabled**, 과거 날짜도 disabled로 표시됐다. 임시 일정은 검증 뒤 삭제해 정리했다.
3. 10월 12일 선택 → 서버 요약 대조 → 시험 성명·키보드로 그린 가상 서명·명시 demo 동의 → Submit. 서명 전에는 제출 버튼이 비활성화됐고 서명/동의 후 활성화됐다.
4. **DEMO-43915C8F**, 제출 UTC `2026-10-02T11:50:02.802637Z`(Sydney 21:50:02). Supabase submission 1개, 이메일 시도 1회, provider ID 기록, 이메일 수락 뒤 enquiry/outbox 생성 확인.
5. 실제 Google 이벤트: `[DEMO] Pending confirmation · DEMO-43915C8F`, 시작 `2026-10-12`, exclusive 종료 `2026-10-13`, private·transparent, 참석자 0. 이는 선호 날짜 표시이며 하루 공사 기간이나 예약 확정을 뜻하지 않는다.
6. 회사 Gmail에서 같은 reference를 조회해 **스팸함 수신 1통·HTML 첨부 2개**를 확인했다. 수신 UTC `2026-10-02T11:50:03Z`. 최초 받은편지함 기본 검색은 0건이었고 스팸함을 포함한 조회로 실제 수신 위치를 확인했다. Resend key는 발송 전용이라 메일 조회 API는 `restricted_api_key`; 더 넓은 권한을 추가하지 않고 기존 회사 Gmail 읽기 권한으로 수신을 검증했다. 앱은 여전히 provider acceptance와 배달을 구분하며 webhook 배달 자동 갱신을 구현했다고 표시하지 않는다.
7. worker `--once` 재실행: 메일 claimed/accepted/queued 모두 0, Gmail imported 0/scanned 4, Calendar synced 0/scanned 2/reviewed 0. 추가 메일·이벤트 생성 없음.
8. 브라우저 새로고침 후 같은 제출 번호·메일 수락·Calendar 저장 상태 복원. 320px 가로 넘침 없음, console warning/error 0. 이 모바일 확인은 제출 결과 화면이며 실제 터치 서명 전체 시험과 구분한다.

최종 DB 건수: drafts 2, submissions 1, enquiries 4, Gmail seen 4, Calendar links 1, outbox 0. 기존 사용자 초안·문의·Gmail 이력은 보존했다. 실제 데모 제출·수신 메일·Calendar 결과는 사용자 확인용으로 남겼다.

## 실행 상태와 다음 조건

로컬 앱은 `127.0.0.1:3002`, 반복 연동 worker는 로컬 프로세스로 실행한다. 임시 3003 검증 서버·시험 탭은 검증 후 종료했다. 남겨 둔 데모 일정의 관리자 링크는 실행 중인 3002 앱으로 맞췄다. 로컬 프로세스나 컴퓨터가 꺼지면 상시 처리되지 않으며 클라우드 상시 운영은 별도다. 제출 직후는 Next `after`가 처리하고 남은 durable queue는 worker가 재시도한다.

실제 장애·Google 외부 변경 경합을 강제로 발생시킨 시험은 이번에 하지 않았으며 관련 보장은 위 격리 시험과 기존 검증 기록을 따른다. 실제 개인 고객 발송에는 인증된 발신 도메인과 운영 수신자 정책이 필요하다. 회사 테스트 메일은 현재 스팸함에 도착했으므로 받은편지함 배달 성공으로 기록하지 않는다.

공식 구현 근거: [Resend 발송 API](https://resend.com/docs/api-reference/emails/send-email), [Resend 24시간 idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [Google Events list·권한·반복/페이지 조회](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [Supabase RPC](https://supabase.com/docs/reference/javascript/rpc). Supabase 최신 changelog의 PostgreSQL minor 변경도 확인했고 이번 스키마는 해당 ltree·legacy pgcrypto·float GiST·custom operator 기능을 추가하지 않는다.
