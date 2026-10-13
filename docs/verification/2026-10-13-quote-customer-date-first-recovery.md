# 고객 날짜 선택 복구 검증

2026-10-13 · `codex/quote-date-first-flow-20261013` · [44번 계획](../plans/44-quote-customer-date-first-recovery.md)

## 원인과 수정

회사 Chrome `Kang (L&K Group)`에서 숫자 성공 분석의 입력 revision 4와 상태 변경 후 요청 revision 5를 대조했다. `request_review`는 서비스·사진을 변경하지 않았지만 기존 함수의 revision 비교로 stale이 되어 예상본 승인/달력이 비활성화됐다. 고객 이메일 인증과 해당 요청 연결이 별도로 필요했으며 사용자 연결 완료 후 실제 화면의 연결 목록과 동일 요청을 확인했다.

성공 분석의 실제 서비스·정렬된 ready 사진 manifest·coverage 형식·실행/동의 메타데이터를 확인하도록 신규 SQL helper를 추가했다. 대기/실행/실패 분석은 기존 revision 제한을 유지한다. 고객 승인의 현재 revision·전체 payload·최신 분석·불변 원본/가격·서명/제출 잠금·요청별 이메일 권한은 유지한다. 상태만 바뀐 성공 분석을 다시 호출하거나 감사값을 덮어쓰지 않는다.

고객 진행 순서는 승인 → 희망일 → 예약 요청 확인 서명/제출 → 회사 검토/전체 기간 확인 → EMS 확정/Google/확정 메일이다. 수동 예상 견적 검토 버튼과 예약 제출 안내를 분리했다. 캘린더 조회 2분 만료는 유휴 재조회하며 작성 중 서명을 지우지 않는다. 검토 증명 15분 만료·최종 제출 전 실제 서버 충돌 검사는 그대로다. 복구된 희망일도 새 조회에서 selectable이어야 서명 검토를 허용한다.

## 코드 검사

- 원인 회귀 RED: 기존 코드 14 통과/4 실패. 상태 변경 후 정상 분석 재사용이 실패함을 확인.
- 수정 후 관련 DB/API GREEN 77/77. 서비스·사진·업로드 중·최신 job·실행 metadata·연락처 변경 뒤 기존 승인 무효·원본 보존·함수 권한 포함.
- UI 관련 20/20. 차단 사유, 안전한 새 견적 경계, TTL, 저장 날짜 최신 가능 여부 검사 포함.
- 전체 `npm run test:operations`: **691/691**, 실패/취소/skip 0.
- `npm run check`: lint·타입·Webpack production build 모두 exit 0.
- 최종 독립 정적 검토에서 새 차단급·높은 위험 결함 없음. `git diff --check` 통과.

## 회사 적용

- 회사 Supabase `xlqyafthsxallostcqfe`에서 `20261012214515_live_quote_completed_analysis_source_current.sql` 전체 transaction 실행 완료. 회사 계정·프로젝트·Production 표시 확인.
- 기존 요청·사진·AI job·승인·예약 제출·확정 점유 **6개 테이블의 전체 내용 hash/행 수가 migration 적용 직전/직후 일치**. 이후 사용자의 정상 제출과 QA 요청의 날짜 저장은 이 보존 대조 이후에 진행했다.
- 실제 문제 요청은 request revision 5 / AI 원본 input revision 4 그대로이며 새 helper의 `source_current=true` 확인.
- publishable key로 helper 실행은 `42501` 거절. 원본 비공개 자료/키는 로그나 저장소에 출력하지 않음.
- 회사 Vercel `dpl_GGypajeSmYLe5zVyg2oVwVDaN6tj` Production 배포 완료. `https://www.lnkgroupsydney.com.au/quote/start?service=cabinet-painting` 200, apex→www 이동과 새 7단계 서버 본문 확인.
- 회사 Chrome에서 같은 고객 요청·사진 2장·AI job 원본·A$2,475가 복구됐다. 이전 분석 stale 안내가 사라지고 **Approve estimate and choose date 활성화**와 회사 검토 대기 중에도 고객이 진행 가능하다는 안내를 확인했다.
- `Start a new quote` 보존 안내 열기 → `Continue current quote` 취소 후 동일 고객 요청/세션 유지 확인. 실제 빈 폼 전환/재인증은 수행하지 않았다.
- 2분 TTL의 실제 대기/서명 보존은 아직 회사 브라우저 미실행이며 자동 검사와 정적 검토 결과와 구분한다.

## 실제 날짜 저장·제출 대조

- 기존 QA 요청을 정상 고객 OTP 인증·선택 API로 복구했다. 회사 Google 연결과 Gmail profile의 회사 이메일을 확인했으며 OTP는 회사 계정에서만 읽고 세션은 메모리에서 사용 후 폐기했다. 브라우저 쿠키 추출이나 DB 인증 자료 조작은 하지 않았다.
- 실제 예약 점유가 있는 **2026-10-20·21·23**은 최신 availability에서 busy였으며 각 날짜 저장 API가 **409 conflict**로 거절했다. **22일**은 기존 승인에 정상 저장·검토·읽기 복구됐으며 AI 원본·사진·가격은 유지했다. 서명 제출·Calendar 쓰기·회사 확정은 이 QA 실행에 포함하지 않았다.
- 사용자 본인이 같은 문제 견적에서 **10월 29일**을 선택하고 서명·제출했다. 고객 요청 `RQ-345B09DD2EB047E782B389F5216D28EA`, 제출 **REQUEST-C214E9F473D7**, 원본 AI 분석·현재 revision 5 승인·날짜 2026-10-29·A$2,475 GST 포함을 대조했다. 제출 시각은 2026-10-13 08:58:34 Sydney다.
- 제출 DB의 PDF 준비 상태는 ready, 메일은 **provider_accepted**, Calendar는 synced다. 메일 접수 상태를 실제 수신/배달 완료와 동일하게 보고하지 않는다.
- 회사 기본 Calendar에서 해당 제출의 이벤트를 OAuth API로 독립 GET하여 **200 / 시작 2026-10-29 / 종료 2026-10-30 / tentative / transparent / private**를 확인했다. 회사 검토 전의 희망일 표시이며 확정 예약이나 전체 작업 기간 점유가 아니다.
- 비공개 정상 API/Calendar 대조 자료는 git 제외 `.local/quote-date-first/`에 유지한다. 공개 문서에는 고객 연락처·사진·키·세션을 포함하지 않는다.

## EMS Enquiries 표시 연결

사용자 제출은 이미 저장돼 있었지만 `/admin/enquiries`는 기존 Operations의 Gmail/이전 데모 문의만 조회했다. 운영 견적과 서명 제출은 `/admin/quotes`의 별도 조회에 있었다. 기존 `LiveQuoteRequestsPanel`을 Enquiries 상단에 재사용하고 Gmail/데모 영역은 아래에 유지했다. 같은 요청 ID와 직원 읽기·쓰기 권한, 세션 상실 처리, 미저장 변경 보호를 사용한다. DB 복제나 Gmail 동기화를 기다리지 않는다.

- Enquiries 추가 변경 뒤 `npm run test:admin-shell` **13/13**와 `npm run check` lint·타입·production build exit 0을 확인했다. 추가 독립 정적 검토에서 구체 결함을 찾지 못했다. 앞선 전체 691개 실행과 이 추가 검사는 구분한다.
- 추가 변경은 회사 Vercel **dpl_9cKVH9gqp7qqpX2hsDaCXRXKxsH8** Production READY로 배포했으며 www/apex/기존 Vercel 도메인의 같은 배포 연결을 확인했다. 회사 Chrome의 Enquiries 상단에 실제 웹 요청 14건과 문제 요청이 표시되고 아래 Gmail/기존 문의 영역을 유지함을 확인했다.
- 회사 Chrome의 Enquiries에서 같은 `RQ-345B09DD2EB047E782B389F5216D28EA` 상세를 열어 **REQUEST-C214E9F473D7 / Thursday, 29 October 2026 / $2,475 incl GST / Frozen PDF saved / provider 접수 / 회사 Calendar 확정 대기 synced**를 대조했다. 같은 비공개 사진 2장과 성공 AI 원본이 표시됐다. 기존 Gmail/기타 문의 8건도 아래 영역에 표시됐다.
- 인수 시점에 이 요청의 회사 제안 Version 1이 고객 검토 대기로 별도 표시됐다. 기존 제안·기간을 읽기만 했으며 작성·발행·확정 버튼은 대신 실행하지 않았다.
- 회사 Chrome에서 Enquiries를 새로고침한 뒤 14건 목록 복구 → 같은 요청 상세 다시 열기 → 동일 제출 번호·29일·금액·PDF·메일 접수·Google 확정 대기 상태 복구를 확인했다. 기존 직원 로그인과 Gmail/기타 문의 8건은 유지됐다.

회사 계정 외 브라우저에 접근하지 않았다. 실제 고객의 희망일·서명·제출은 사용자가 직접 수행한 결과를 읽어 검증했으며 예약 확정은 임의로 생성하지 않았다. 기존 확인용 확정 예약의 10월 20·21·23일 점유는 보존한다. 검증 당시에는 commit/main merge/push를 수행하지 않았다. 후속 Git 통합 기록은 README 최신 항목을 따른다.
