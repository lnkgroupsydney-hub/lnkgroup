# 실제 예상 견적 승인·예약 요청·회사 Calendar 연동

2026-10-12 · 기준 `main@418e03d` · `codex/live-quote-booking-calendar-20261012`

[전체 계획](41-domain-live-quote-booking-plan.md)의 다음 구현 단위다. 가격/AI/이메일 인증을 재사용하며, 이 문서의 완료 표시는 실제 검증 후 갱신한다.

## 확정된 범위

- 고객은 저장된 사진 분석의 숫자 예상 금액을 확인하고 승인 → 희망 시작일 선택 → 예약 요청 확인 서명 → 제출한다. 최종 계약·시공 지시·결제·예약 확정이 아니다. 회사가 실제 기간·충돌·현장 수량/가격을 확인한 뒤 확정한다.
- 회사 승인 약관이 없으므로 이번 서명은 사용자가 선택한 **예약 요청 확인**으로 한정한다. 가격·수량·범위가 바뀌면 이후 별도 제안과 재동의가 필요하다.
- 연결 계정은 `lnkgroupsydney@gmail.com` 하나다. Google API에서 같은 계정 아래 기본 캘린더와 `L&K Integration`의 **서로 다른 ID**를 확인했다. 신규 운영 날짜 조회/예약 요청 저장은 `LIVE_QUOTE_CALENDAR_ID=lnkgroupsydney@gmail.com` 기본 캘린더로 통일한다. 기존 데모 링크/시험 캘린더는 보존하며 자동 이동·삭제하지 않는다.
- 이미 예약된 Google opaque 일정과 운영 DB 확정 구간은 선택 불가다. 조회 오류·불완전 응답·연결 변경도 선택을 허용하지 않는다. 기간 규칙 미정으로 회사 확인 전 요청은 일정을 점유하지 않는다.
- Google의 하루 종일 **비공개·tentative·transparent** 항목은 희망 시작일 표시이며 하루 작업 기간이나 확정 예약이 아니다. 고객 개인정보·사진·서명·메일 수신자/attendee는 Calendar에 넣지 않는다.

## 구현 순서와 인수 조건

1. **불변 예상본 승인**: 인증 고객의 특정 요청만 허용하고, 최신 성공 분석 ID·입력 revision·사진 manifest·확정된 서버 금액을 고정한다. 업로드 중/분석 중/숫자 보류/다른 고객/변경된 분석은 승인 불가. 승인으로 입력 revision을 바꾸지 않는다.
2. **회사 날짜 선택**: 기본 Calendar 실제 조회 + 확정 구간으로 Sydney 날짜를 계산한다. 반복 일정·페이지네이션·종일 exclusive end·DST를 다룬다. 4개월 표시 창과 2분 조회 유효 시간은 UI/신선도 제약이며 영업일·기간·견적 유효기간을 새로 정하지 않는다. 날짜 저장/최종 제출 시 서버에서 재조회한다.
3. **검토·서명·원자적 제출**: 승인 버전·선택 버전·수신 이메일·고지문·분석/금액·사진 manifest에 서명을 묶는다. 날짜 변경/새 분석은 검토 증명과 서명을 무효화한다. 같은 제출 재시도는 기존 결과를 반환하고 제출 후 원본 편집은 DB에서 차단한다.
4. **고정 PDF/메일·Calendar outbox**: 비공개 예약 요청 PDF와 정확한 이메일 payload/hash를 고정한다. 회사 발신 주소에서 인증 이메일로 발송하고 provider accepted 후 Calendar를 기록한다. 메일 접수와 delivered를 구분한다. 임대/CAS·안정적인 idempotency key·응답 유실 복구·허용 시간 초과 수동 검토를 적용한다.
5. **Calendar 저장 확인**: 제출별 고정 event ID를 먼저 조회하고 필요할 때만 생성한다. 생성 응답 뒤 별도 GET으로 날짜/비공개/투명도/소유 표식/hash를 확인해야 synced다. 외부에서 이동/삭제한 항목을 덮어쓰지 않고 검토로 남긴다. 확정 예약과 충돌하면 회사 검토로 표시한다.
6. **고객 복구·EMS**: 새로고침/재인증 후 동일 승인·요청·PDF·메일·Calendar 상태를 복구한다. EMS에 원본 예상본/서명/날짜/수신 검증/처리 상태를 표시한다. 인증된 반복 worker와 제출 직후 처리로 화면을 닫아도 저장된 작업을 이어간다.
7. **검증**: 자동 테스트 → lint/타입/빌드 → 회사 Supabase migration 및 기존 데이터 보존 → 회사 배포 → 회사 Chrome 실사용 → DB/실제 Google event/메일 ID 대조. 예약일 차단, 중복 제출, 응답 유실, 제출 후 잠금, 고객/직원 세션 경계를 포함한다.

## 실행 체크리스트

- [x] 승인/선택/서명/제출 DB·권한·재시도와 원본 잠금
- [x] 고객 화면과 EMS 조회/복구
- [x] 고정 PDF·회사 메일 outbox
- [x] 기본 Calendar 날짜 차단·pending event 생성/독립 읽기 확인
- [x] 인증 worker/반복 복구 설정
- [x] 자동 suite·lint·타입·빌드
- [x] 회사 DB·환경설정·배포와 실제 브라우저 인수

구현·배포·회사 Chrome 인수를 완료했다. [검증 기록](../verification/2026-10-12-live-booking-request-calendar.md)에 따르면 실제 Gmail PDF 수신, EMS 저장 상태, 회사 기본 Calendar의 요청 일정 1건과 독립 읽기를 확인했다. 완료된 범위는 **예약 요청**이며 회사의 최종 가격·약관 확정 후 고객 동의와 확정 예약은 후속이다. 매일 cron 등록은 확인했지만 예약 시각 자동 호출은 아직 검증하지 않았다. 자동 전체 검사 612/612, focused 검사 54/54와 `npm run check`가 통과했다.

후속 범위: 회사의 실제 작업 기간·자원·최종 금액/약관 제안, 고객 재동의, **확정 예약**의 양방향 변경 검토 및 인보이스는 별도 구현 단위다. 이번 pending 날짜 표식을 확정 예약 인수로 보고하지 않는다.

## 참고

- [Google event insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert): 고정 ID, private/transparent, 알림 제어.
- [Google events list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list): 반복 일정 전개·페이지네이션·기간 조회.
- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys): 중복 발송 방지 창을 넘긴 불명확 결과는 자동 재발송하지 않는다.
