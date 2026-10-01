# Google OAuth 실제 연결 검증

2026-10-01 사용자 요청으로 확인용 스크린샷을 삭제했다. 아래 텍스트 검증 기록은 보존한다.

2026-10-01 · Australia/Sydney · **회사 연결·핵심 왕복 검증 완료, 운영 전환·복구 검증 일부 대기**

[실행 계획](../plans/29-google-oauth-live-verification-plan.md) · [Supabase 검증](2026-10-01-supabase.md) · [TODO](../plans/15-home-cabinet-admin-todo.md)

## 실제 연결과 시험 범위

- 회사 계정 `Lnkgroupsydney@gmail.com`, Google Cloud 프로젝트 `lnkgroup`, OAuth 앱 이름 `lnkgroup`을 확인했다. Web callback은 `http://127.0.0.1:3002/api/google/callback`이다.
- 최초 `403 access_denied`는 External / Testing의 테스트 사용자 누락이 원인이었다. 회사 계정 1명을 등록하고 다시 진행했다. 게시 상태는 Testing을 유지했다.
- 사용자가 Gmail 읽기·Calendar 목록·회사 소유 이벤트 권한에 최종 동의했다. callback 이후 암호화된 토큰 저장과 실제 Gmail/Calendar 목록 조회 HTTP 200을 확인했다.
- 최초 API 요청의 `accessNotConfigured` 이후 Console에서 API 활성 상태를 확인했고, 재조회에서 Gmail·Calendar API 모두 성공했다. 활성 상태 확인과 실제 API 성공을 별도로 확인했다.
- 활성 업무 저장소는 회사 Supabase `xlqyafthsxallostcqfe`다. 시험 전 문의·outbox·Calendar 연결이 0개인 것을 확인했다.
- Gmail 라벨은 **`L&K Integration Test`**, 필터는 `subject:(LK-OAUTH-20261001)`이다. 시험 제목에만 자동 라벨을 부여하며 기존 일반 메일은 일괄 수집하지 않았다.
- 선택한 회사 소유 시험 Calendar의 실제 이름은 **`L&K Integration`**이다. 회사 기본 Calendar가 아닌 별도 Calendar이고 `Australia/Sydney`, 공개 공유 해제 상태다. 운영용 대상 확정은 아니다.

비밀키·토큰·개인 발신 주소·메일 본문은 이 기록에 포함하지 않는다. 시험 메일은 사용자가 발송했고 에이전트는 메일을 발송하지 않았다.

## Gmail 실제 결과

시험 접수번호는 **`KCP-1DC4F38580B5`**다.

| ID | 결과 | 근거·한계 |
| --- | --- | --- |
| G01 | 통과 | 시험 라벨의 실제 수신 메일 1통을 Supabase 문의로 저장 |
| G02 | 통과 | 같은 메일 반복 동기화에서 새 문의·메시지 중복 없음 |
| G03 | 통과 | 같은 대화의 개인 계정→회사 답장이 기존 문의에 추가됨. 수신 이력 2통, 원래 본문·일정 유지 |
| G04 | 일부 | 날짜 없는 첫 Gmail 문의가 일정 미지정 상태로 저장됨. 별도 대화 분리의 실제 시험은 미실행 |
| G05 | 일부 | 사용자가 회사 계정에서 보낸 답장 2통은 `SENT`로 정상 제외. 미선택 라벨·초안 전체 경우는 격리 테스트 근거이며 별도 실메일 시험 미실행 |
| G06 | 미실행 | 실제 첨부 포함 시험 메일은 준비하지 않음. MIME·첨부 처리의 기존 격리 테스트와 구분 |
| G07 | 통과 | 수동 Sync/worker 실행 없이 관리자 polling이 21:17:53 Sydney에 추가 수신 답장을 반영. 당시 동일 접수번호의 이력 2통·revision 7 확인 |

대화에는 수신 2통과 회사 발신 2통이 있었으며 앱에는 수신 2통만 저장됐다. 자유 서술의 날짜를 예약으로 자동 확정하지 않는다.

## Calendar 실제 결과

Google API를 사용한 실제 제공자 측 변경과 앱 API를 왕복했다. Google 웹 화면에서도 생성된 미확정 일정·날짜/시간·비공개·시간 비차단 표시를 확인했다. Google 화면에서 모든 변경 시나리오를 수동 조작한 것으로 기록하지 않는다.

| ID | 결과 | 확인 내용 |
| --- | --- | --- |
| C01 | 통과 | 앱 제안 일정 → Google 이벤트 1개. 절대 시각·Sydney 시간대·private·transparent 일치, 참석자·고객 연락처/본문 없음 |
| C02 | 통과 | 반복 동기화와 앱 시간 수정 모두 같은 이벤트 ID 유지 |
| C03 | 통과 | Google 날짜/시간 변경은 검토 전 앱에 미반영, 승인 후 반영 |
| C04 | 통과 | Google 시간 변경 거절 후 앱의 기존 시간으로 복원 |
| C05 | 통과 | Google 삭제 승인 후 원본 문의 보존·일정/연결 해제, 반복 동기화로 부활하지 않음 |
| C06 | 통과 | 재일정은 새 이벤트 ID 사용. 삭제 거절 시 새 ID로 복원하고 이후 중복 없음 |
| C07 | 일부 | 추가 메일로 revision이 바뀐 뒤 오래된 앱 편집 HTTP 409 확인. 제공자 동시 경합의 전체 실제 재현은 미실행, 관련 격리 테스트 통과 |
| C08 | 통과 | 합성 웹 문의 `KCP-D49E449B4DE6`, 희망일 10월 20일 → 20일~21일 종일 요청 이벤트. 반복 동기화 1개, 비공개·비차단 |
| C09 | 통과 | 반복 일정 변경은 invalid 검토, 승인 HTTP 400, 거절 후 단일 이벤트 복원 |
| C10 | 통과 | 연결 없는 별도 시험 이벤트는 앱 문의/검토를 생성하지 않고 이벤트 etag도 유지 |

실제 Google 화면을 대조한 뒤 시험 일정을 삭제 승인 절차로 정리했다.

## 재시작·실패 처리·코드 검증

- 최신 production 서버를 재시작한 뒤 관리자 세션, 회사 Google 연결, 선택 대상, 접수번호, 메일 본문·일정 보존을 확인했다.
- 실제 연결 상태에서 `npm run integrations:worker -- --once`를 실행했다. Gmail scanned 1/imported 0, Calendar failed 0, 오류 없이 종료했다. 이 1회 실행을 화면 없는 신규 메일 수집이나 상시 운영의 검증으로 확대하지 않는다.
- 부분 동기화 실패가 성공처럼 보일 수 있는 문제를 수정했다. 관리자 화면은 Gmail/Calendar 오류·실패 건수를 확인해 실패를 표시하고, worker `--once`는 부분 실패 시 exit 1을 반환한다. 반복 worker는 오류를 기록하고 다음 주기를 계속한다.
- 자동 테스트 **44/44 통과**: 기존 39개와 부분 실패·worker 종료 상태 5개. `npm run check`의 lint·typecheck·production build 모두 통과했다.
- 기존 SQLite experimental / TypeScript module-type 안내는 실행 경고이며 테스트 실패는 아니다.

## 종료 상태와 남은 검증

시험 이벤트를 **Google 삭제 → 앱 삭제 검토 승인 → 재동기화**로 정리했다. 독립 시험 이벤트도 정리했다. 최종 상태는 문의 2개(Gmail 1·합성 웹 1), Gmail 수신 이력 2통, 활성 Calendar 연결 0개, outbox 0개, 대기 검토 0개다. 문의 이력은 보존했고 DB 행·연결을 직접 삭제하지 않았다.

로컬 production 앱은 `http://127.0.0.1:3002`에서 실행 중이다. 별도 상시 worker는 실행하지 않았다. 관리자 화면이 열리고 대상이 선택된 동안 약 60초 간격으로 확인하며, 절전·화면 종료 중 상시 수집은 보장하지 않는다. 현재 선택 대상은 위 시험 라벨·Calendar다.

다음 항목은 미완료로 남긴다.

1. access token 자연 만료 후 갱신, 앱 권한 회수→동기화 실패→회사 재연결→동일 데이터 복구. 관찰한 최초 만료는 2026-10-01 21:49:45 Sydney이며 DB 시각을 임의 변경하지 않았다.
2. 화면 없는 반복 worker의 새 메일 수집, 앱/worker 모두 중단 중 들어온 메일의 재시작 후 수집. 1회 worker·기존 데이터 재시작 보존과 구분한다.
3. G04/G05/G06/C07의 위 미실행 실제 조건.
4. 실제 운영용 Gmail 라벨·필터·회사 소유 Calendar 결정 후 소량 왕복. 공개 문의함 `Lnkpaintingau@gmail.com`은 이번 연동 계정과 별개이며 자동 전달 규칙을 만들지 않았다.
5. Supabase advisors 접근과 다음 CLI db push 전 마이그레이션 이력 정합성 확인은 Supabase 기록을 따른다.

External / Testing의 refresh token 7일 만료 조건은 [29번 공식 근거](../plans/29-google-oauth-live-verification-plan.md)를 따른다. 연결이 영구 유지되거나 운영 준비가 모두 끝났다고 표현하지 않는다. 근무시간·기간 산식·정찰제는 계속 보류하며, Complete 시 인보이스 발행·발행일 +3 달력일 납기·AI·Resend는 후속 단계다.
