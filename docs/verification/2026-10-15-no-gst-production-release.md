# A$1,450·GST 미부과 운영 DB 적용 및 배포

2026-10-15 · Australia/Sydney · [53번 가격 정책](../plans/53-new-quote-no-gst-pricing.md)

## 완료한 변경

회사 Supabase `xlqyafthsxallostcqfe`에 신규 가격 v3 migration을 적용하고 회사 Vercel `lnkgroup`의 운영 도메인으로 배포했다. 신규 요청은 A$1,450 시작가·GST 미부과 정책을 저장한다. 수량·상태에 따라 금액이 달라지며 현장 최종 확인 조건은 유지한다. 고객/EMS와 신규 접수·예약 확정 메일/PDF의 표기는 같은 저장 버전을 따른다.

운영 주소: https://www.lnkgroupsydney.com.au/quote/start

## DB 적용과 기존 기록 보존

- PostgreSQL 17.11, 기존 견적 4건·사진 13장·분석 4건·서명 접수 3건·예약 3건을 사전 확인했다. 교체할 기존 함수 3개의 `prosrc` 해시가 검증한 migration 이전 상태와 일치했다.
- 원본 migration은 `20261014014608_live_quote_no_gst_pricing_v3.sql`, SHA-256 `d2aeef3e27b7b373ca2e0798505d93f40195415af954cdb96501e2d402931701`이다.
- 동일 본문을 원자적 검증 wrapper로 실행했다. wrapper SHA-256은 `ecf7ebf70be45aa4d3ef2b7968d4e40bc5395230519ca4e9a484b4e6034917b1`이다. 기존 18개 테이블의 쓰기를 짧게 잠그고 전후 건수·전체 행 해시를 대조한 뒤 COMMIT했다. 요청의 새 NULL 가격 열만 해시 비교에서 제외하고 별도로 과거 4행 모두 NULL임을 검사했다.
- **18/18 테이블의 건수·내용이 동일하며, 기존 견적 4건·서명 접수 3건·예약 3건의 재계산·수정은 0건이다.** 저장된 분석·서명·예약·동결 메일/PDF도 전체 행 해시에 포함된다.
- 새 요청의 v3 기본값을 실제 DB RPC로 검사했다. 합성 요청·감사·rate-limit 쓰기는 내부 하위 트랜잭션에서 롤백했고 역할도 복원했다. 실제 고객 요청이나 메일·AI·Calendar 작업은 만들지 않았다.
- 적용 후 기본값 v3, 기존 4요청 NULL, 합성 요청 0건, RLS 유지와 새 validator의 anon/authenticated 실행 차단·service_role 실행 허용을 다시 확인했다.
- SQL Editor의 RLS 알림은 `ON COMMIT DROP` 세션 임시 보존 테이블에 대한 정적 탐지였다. 공개 스키마 테이블의 RLS나 권한은 완화하지 않았다. Advisor 재검사 결과 DB 오류는 0건이며, Auth의 Leaked Password Protection Disabled 경고 1건은 이번 가격 DDL과 관계없는 설정이다. Auth 설정은 변경하지 않았다.
- 기존 운영처럼 회사 SQL Editor로 적용했다. 정렬되지 않은 과거 CLI migration 이력을 repair하거나 기존 migration을 다시 실행하지 않았다.

[운영 보존 보고서](2026-10-14-no-gst-deployment/db-rollout-report.json) · [적용 후 정책/권한](2026-10-14-no-gst-deployment/db-postflight.json) · [적용 화면](2026-10-14-no-gst-deployment/db-applied.png) · [실행 wrapper와 재현 검사](2026-10-14-no-gst-deployment/rollout/manifest.json)

## 배포와 소스

검증한 제품 변경 커밋은 `ee064e38fd54ebb257a5d36460886ec7f9d1a5f7`이다. 최신 회사 main `d73d7e7` 위에 반영했고, 별도 release worktree에서 기존 공유 폴더의 사용자 변경을 보존했다. 최신 main의 기존 예약 상태 안내도 유지했다.

CLI 파일 업로드 방식은 Git 작성자 권한 검사에서 차단됐다. 작성자·권한을 바꾸지 않고 기존 회사 Git 연결로 정확한 release SHA를 빌드했다. 준비된 production 배포 `dpl_8Ge3JKqxqig7Dp2szmsAzzQ7wJae`를 회사 인증으로 HTTP 200 확인한 뒤 DB COMMIT 직후 승격했다. 승격은 약 2초였으며 재빌드 없이 같은 배포를 사용했다. 배포 상태 READY/PROMOTED, 회사 www/apex/기본 도메인의 alias 대상과 소스 SHA를 확인했다.

운영 도메인 전환 전후 메타데이터와 최종 main 동기화 상태는 [증거 폴더](2026-10-14-no-gst-deployment/)에 보관한다. 소스와 배포의 최종 main 동기화는 아래 실행 기록을 따른다.

## 검증 범위

- 제품 변경 전체 업무 시험 **773/773**, lint·타입·production build·공백 검사 통과. Node v24.14.1을 사용했다. 동일 제품 코드의 완료된 검사는 이 배포 중 불필요하게 반복하지 않았다.
- 최신 main과 합친 제품 코드로 로컬 실제 Next 화면 **8/8 시나리오·44개 레이아웃** 통과. 신규·과거 견적, 방문일·서명·접수·EMS 복구 및 좁은 화면 금액표를 확인했다.
- 합성 입력의 신규/과거 PDF 4종·각 2쪽과 메일 payload를 검사했다. 과거 생성 결과는 변경 전 생성기와 바이트가 동일했다. 이는 실제 운영 메일 발송 시험과 구분한다.
- 운영 www의 새 익명 세션에서 **1280·390·320px 3/3** 통과. HTTP 200, 허용된 요청 90개, console/page 오류·HTTP 실패·예상 밖 요청 0건. POST는 빈 세션의 logout/session 전환 각 3회뿐이다. 고객 견적 저장·OTP·AI·예약·메일·Calendar 호출은 하지 않았다.
- 운영 데스크톱 가격 요약을 실제로 스크롤해 **From A$1,450 / No GST charged** 표시를 확인했다. 모바일은 기존 설계대로 요약 sidebar가 숨겨져 있으므로 정책 DOM과 빈 입력·메뉴·가로 넘침·키보드를 확인했다. 실제 견적 결과의 모바일 금액 표시는 앞선 로컬 합성 8개 시나리오에서 검증했다.
- 운영 기존 고객 자료를 새로 열거나 다시 서명·확정하지 않았다. 기존 자료 보존은 실제 DB 18개 테이블 해시와 로컬 기존 버전 복구 검사로 확인했다.
- 초기에 검증 도구가 같은 이름의 Back to quote 버튼 2개를 선택하는 문제를 발견했다. 도구의 selector 범위를 header로 좁힌 뒤 전체 3개 화면을 통과했다. 제품 코드는 바꾸지 않았고 최초 실패 증거도 구분해 보관했다.
- 승격 배포의 최근 15분 error 로그 조회가 정상 종료됐고 반환된 오류는 0건이었다. 지속 모니터링이나 미래 오류가 없다는 보장은 아니다.

[운영 UI 결과](2026-10-14-no-gst-deployment/production/ui-results.json) · [운영 A$1,450·GST 표시](2026-10-14-no-gst-deployment/production/1280-starting-price-summary.png) · [운영 320px](2026-10-14-no-gst-deployment/production/320-new-empty-form.png) · [로컬 기존/신규 복구](2026-10-14-no-gst-deployment/local-ui/ui-results.json) · [기존 PDF/메일 검증](2026-10-14-no-gst-pricing.md)

## 별도 실제 제공자 인수

이번 배포에서 새 실제 고객 견적을 저장해 유료 AI·OTP·메일/PDF 발송·Google 예약을 반복하지 않았다. 해당 기능은 배포된 코드의 버전 분기와 로컬 통합 시험까지 검증됐고, 신규 v3 실제 제공자 전체 인수는 수행하지 않은 범위로 남긴다. 과거 견적·예약 및 이미 발송된 문서의 원본은 그대로 보관한다.

## 최종 main 연동 확인

회사 `origin/main`에 `1e9cbf9daad23f4d0f2381c2d9a4fe1073b77887`을 fast-forward로 반영했다. Git 연동 production `dpl_HALJE1DmbmvjyiKt82Zf88au9Evj`는 READY/PROMOTED이며 www/apex가 같은 배포를 가리킨다. 빌드 시간은 약 56.4초다. 추가 커밋은 문서·검증 증거·검증 도구뿐이며 제품 소스·설정·의존성·migration은 검증한 `ee064e3`과 동일하다.

최종 배포본에서도 1280·390·320px의 동일한 안전 범위 화면 검사 **3/3**, 허용 요청90개·브라우저/HTTP 오류0·가로 넘침0을 다시 확인했다. 추가 실제 견적/메일/AI/예약은 생성하지 않았다. 최종 main 배포의 최근 error 로그 조회도 0건이다.

[최종 배포 메타데이터](2026-10-14-no-gst-deployment/production-final.json) · [최종 main UI 결과](2026-10-14-no-gst-deployment/main-production/ui-results.json) · [최종 운영 시작가](2026-10-14-no-gst-deployment/main-production/1280-starting-price-summary.png) · [최종 로그 조회](2026-10-14-no-gst-deployment/final-runtime-log-check.json)
