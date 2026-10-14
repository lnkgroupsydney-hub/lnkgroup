# L&K Group 웹 서비스 구축 계획

**2026-10-14 실제 회사 사진 견적·서명·예약 인수:** 회사 Chrome의 **localhost:3034 고객 UI + 운영 EMS**에서 사진 5장 업로드·실제 AI 1회·견적에 묶인 이메일 인증·10/28 09:30 typed QA 확인 서명/제출·EMS 단일 확정을 진행했다. 도어14/서랍6·**A$2,700 + GST270 = A$2,970**의 원본 잠정 도장비, 10/28 take-off·10/30 installation의 실제 Google 일정/DB 점유2개, 접수/확정 INBOX 각1통·동결 PDF bytes와 기존 견적2건 보존 hash를 대조했다. 문구3곳을 바로잡고 Reload 후 같은 접수번호·금액·확정 기간/문서를 재분석·재확정 없이 복원했다. 집중 검사 **37/37**·최종 lint/타입/build 통과; 전체767은 이번 재실행이 아니다. 로컬 고객 UI와 실제 회사 제공자 연결 인수이며 배포 고객 UI 전체 E2E로 확대하지 않는다. QA 일정/기록을 보관하고 이번 commit·merge·push·배포·DB/환경/가격 기준 변경은 없다. [실행 기록/남은 범위](docs/verification/2026-10-14-quote-live-e2e.md)를 따른다.

**2026-10-13 견적 UI·UX 운영 배포 완료:** 구현 `f3d5d94`를 회사 main에 병합(`4bb0b80`)하고 기존 Vercel Git 연동으로 Production READY·운영 alias를 확인했다. 동일 코드의 전체 767/767·로컬 브라우저40/40·lint/타입/build와 실제 운영 데스크톱·모바일107/107 검사가 통과했다. 원본 공유 폴더와 기존 업무 자료를 보존하며 이번 배포에 DB/환경 설정 변경은 없다. [운영 견적](https://www.lnkgroupsydney.com.au/quote/start)·[배포/검증/남은 Google 준비 기록](docs/verification/2026-10-13-quote-ui-release.md). 아래 미배포/미커밋 설명은 당시 기록이다.

**2026-10-13 새 견적/기존 견적·예약 진입 분리:** 첫 화면의 두 카드에서 작업을 선택하며 새 견적에는 권한이 확인된 이름·이메일·전화만 미리 채운다. 별도 ID를 만들고 기존 견적·사진·분석·서명·예약·접수 기록을 보존한다. 미저장·결과 불명 요청과 다른 탭의 전환/복구를 보호하고 방문일 단일 인증을 유지했다. 전체 **767/767**, 관련 **37/37**, fixture **4/4**, lint·타입·build와 로컬 브라우저 **40/40** 통과. [51번 계획](docs/plans/51-quote-entry-and-contact-prefill.md)·[검증 기록/화면](docs/verification/2026-10-13-quote-entry-contact-prefill.md)·[3002 미리보기](http://127.0.0.1:3002/quote/start)를 따른다. 실제 회사 제공자/DB 인수·운영 배포·commit/push/merge는 수행하지 않았다.

**2026-10-13 최신 Git 통합 — 캐비넷·홈·견적 UI:** 이전 대화에서 승인한 현재 변경 223개 파일을 `a93b3b4`에 커밋하고 main에 무충돌 병합했다(`b747587`). 회사 `origin`에 작업 브랜치와 main을 atomic push하고 원격 SHA를 확인했다. 전체 **749/749**, 타임라인 **8/8**, 마지막 예약 복구 관련 **29/29**, 최신 lint·타입·빌드와 브라우저 **49/49**가 통과했다. 공유 작업 폴더는 보존했고 별도 운영 배포는 실행하지 않았다. [통합·검증 기록](docs/verification/2026-10-13-kcp-main-integration.md)을 따른다. 아래 미커밋/미병합 설명은 각 작업 당시의 기록이다.

**2026-10-13 방문일 단일 이메일 인증:** 신규 견적은 방문일 단계에서 현재 저장 이메일·요청 ID·revision에 묶인 코드 한 번으로 연결하며 유효한 현재 견적 인증은 재사용한다. 인증 후 이전 견적을 자동으로 열지 않고, 기존 목록은 Open saved quote에서 명시적으로 조회한다. 입력/분석 보존·다른 탭의 명시적 현재 견적 복귀·예약 재시도·접수본 복구를 보완했다. 전체 **749/749**, 최종 관련 **21/21**, lint·타입·build와 로컬 공개 브라우저 **18/18** 통과. [50번 계획과 새 견적 제안](docs/plans/50-booking-stage-email-verification.md)·[검증 기록](docs/verification/2026-10-13-booking-stage-email-verification.md)·[3002 미리보기](http://127.0.0.1:3002/quote/start)를 따른다. 실제 이메일/운영 제공자 인수·배포와 로그인 유지 상태의 새 견적 API는 후속이다.

**2026-10-13 KCP 디자인 후속 보정:** 브라우저 주석6개를 반영해 Hero 문단 여백·52px 주요 CTA·18px 목차·12px 흰색 이미지 고지·20px 서비스 카드 모서리·Aquanamel 제품명·링크 SVG 정렬을 정리했다. 공정3D와 SEO/견적 조건을 유지하고 최신 lint·타입·build 및 로컬 production 브라우저16개 시나리오를 통과했다. [디자인·오류 수정·검증 기록](docs/verification/2026-10-13-kcp-design-polish.md). 커밋·푸시·병합·운영 배포는 수행하지 않았다.

**2026-10-13 항목별 입력 검증:** 견적·문의·고객·인증·서명·EMS 금액/일정/설명·검색에 항목별 타입·형식·범위와 화면/서버 검증을 적용했다. 호주 전화·이메일·4자리 우편번호·정수 수량·텍스트 길이를 검사하며 잘못된 값은 필드 옆에 표시하고 신규 저장을 차단한다. 과거 저장본 읽기·단계별 교정·동일 요청 재시도는 유지한다. 전체 **746/746**·lint·타입·빌드와 로컬 공개 **11개**/관리자 **3개** 브라우저 시나리오가 통과했다. [49번 계획](docs/plans/49-field-input-validation.md)·[실행 범위와 제한](docs/verification/2026-10-13-field-input-validation.md)을 따른다. 회사 Google 키 준비/실제 주소 검색 인수와 운영 배포는 후속이다.

**2026-10-13 메인 UI·UX 구현·주석 반영 완료:** `codex/lk-group-home-ui-ux-20261013`에서 [48번 계획](docs/plans/48-lk-group-home-ui-ux-plan.md)을 구현하고 사용자 브라우저 태그 일곱 항목을 반영했다. 그룹 생활 공간 배경과 다섯 서비스·상품별 생성 이미지/설명, Ermington 지역 소개, 흰 외곽만 투명한 검정 원 로고, 회사 Gmail·오전 7시–오후 5시 연락 시간을 적용했다. 10km 직접 언급과 캐비넷 중심 사진 구역을 정리했으며 네 Coming soon 항목은 링크 없이 유지한다. 최종 lint·타입·빌드, 로컬 브라우저 **12/12**, 공통 로고 6개 화면 조합, fixture 3/3을 확인했다. [최신 화면·검증·생성 자산 기록](docs/verification/2026-10-13-lk-home-revision.md), [로컬 미리보기](http://127.0.0.1:3026/)를 따른다. 생성 사진은 소개용 컨셉이며 실제 실적/상품 사진으로 표시하지 않는다. 기존 미커밋 작업을 보존했고 커밋·푸시·운영 배포·색인 활성화는 수행하지 않았다.

**2026-10-13 KCP 랜딩 UI·UX 구현:** [47번 계획](docs/plans/47-kcp-landing-ui-ux-content-plan.md)에 따라 서비스 3카드·짧은 9공정/완성 장면·전후 비교·범위·FAQ 5개·견적 순서로 압축했다. 지역 상세 21개/기존 범위 조건은 홈 `#service-area`로 옮기고 KCP에는 짧은 안내만 남겼다. 별도 색상 쇼룸을 삭제했으며 공정 3D 모델은 유지한다. 타임라인 **8/8**, 로컬 production 브라우저 **16개 시나리오**, 최신 작업트리 **lint·타입·빌드**와 최종 모바일/사진 대비 검증을 통과했다. 같은 데스크톱 조건에서 문서 길이는 약 50% 줄었다. 운영 배포·커밋/푸시/병합·색인 활성화는 수행하지 않는다. 실제 기기·실제 브라우저 확대·정량 성능 인수는 별도다. [구현·오류 수정·검증 기록](docs/verification/2026-10-13-kcp-landing-ui-ux.md)을 따른다.

**2026-10-13 견적 원페이지 UI 개선:** 새 `codex/quote-one-page-ux-20261013`에서 고객 정보·캐비넷·사진·예상 금액·방문일·서명을 개별 패널로 전환했다. 고정 하단 동작·선택 카드·금액 강조·실제 사진 분석 로딩을 구현하고 접수 완료 화면은 금액·희망 방문일·접수번호를 우선 표시한다. 전체 주소 입력 10곳의 공통 Google Places 연결과 공개 테스트 문구를 정리했다. 전체 **733/733**·lint·타입·빌드와 로컬 브라우저 6개 시나리오를 검증했다. 사용자가 회사 Google 키·결제 준비가 아직 필요함을 확인했으므로 실제 주소 검색은 미실행이며 수동 입력은 유지한다. [디자인·구현 계획](docs/plans/46-quote-one-page-ui.md)·[검증 기록](docs/verification/2026-10-13-quote-one-page-ui.md)을 따른다. 이번 브랜치는 로컬 검증 단계이며 운영 배포·Git 커밋/병합/푸시는 수행하지 않는다.

**2026-10-13 최신 Git 통합 — 예약 단순화·세션 복구·시험 자료 정리:** `codex/quote-date-first-flow-20261013`의 변경 56개 파일을 `9cc9ba3`에 커밋하고 `main`에 충돌 없이 병합했다(`67feded`). 병합 직후 트리는 검증한 작업 브랜치와 동일하며 전체 **728/728·lint·타입·빌드** 결과를 재사용한다. 회사 Production `dpl_Hi8QUZ53nHrmgqS815ymri71ptLK`에 배포한 코드와 동일하고, 이 후속 문서 갱신은 Git 기록만 추가한다. 원격 대상은 회사 `origin` (`lnkgroupsydney-hub/lnkgroup`)이며 작업 브랜치와 main을 함께 저장한다. 아래 미커밋/시험 점유 기록은 각 검증 당시 상태다.

**2026-10-13 테스트 자료 정리:** 사용자 확인에 따라 회사 DB의 운영 견적 15건·이전 데모 초안 8건·문의 8건과 연결된 서명·예약·분석·문서를 삭제했다. 실제 비공개 사진 46개·활성 Google 시험 일정 13개도 정리하고 이미 취소된 1개를 확인했다. EMS 목록과 관련 날짜 점유는 비어 있으며 회사 Google 연결·관리자 Auth·Storage 설정은 보존한다. 시험 메일 4개는 본문 없는 수집 ID만 남겨 재생성을 막았다. 삭제된 고객 세션의 `Reopen quote form` 복구를 회사 사이트에 배포하고 빈 폼·새로고침·EMS 로그인 유지까지 확인했다. 최종 전체 **728/728**·lint·타입·빌드 통과. 아래 42~45번 검증에서 “보존/점유 유지”는 정리 이전의 역사적 결과다. [삭제·보존·실제 검증 기록](docs/verification/2026-10-13-demo-data-cleanup.md).

**2026-10-13 현재 구현 — 예약 절차 단순화:** [45번 계획](docs/plans/45-simple-take-off-install-booking.md)에 따라 신규 요청은 **고객 날짜·시간 → 서명 → 제출 / EMS 견적·안내·take-off 확인·install 입력 → Booking confirm 한 번 → Google 두 방문 저장·독립 검증 → 고객 확인 메일**로 연결한다. 기존 예상 금액을 고정하고 현장 손상 증가 안내를 포함하며 새 요청의 두 번째 고객 승인·Calendar 대기 항목을 제거했다. 이전 v1 서명과 회사 제안/확정 자료는 보존한다. 전체 **720/720**, lint·타입·빌드·독립 정적 검토 통과, 회사 DB 기존 14개 테이블 값 보존과 Production READY 확인. 회사 Chrome의 단일 EMS 확정과 **11/3 take-off·11/5 installation Google 실제 저장·Gmail INBOX 확인 메일 1통·동일 2페이지 PDF·고객 3/5일 차단/4일 허용**까지 확인했다. 고객 제출/복구는 정상 운영 API로 검증했으며 신규 고객 화면 전체 키보드·모바일 인수와 구분한다. 시험용 두 날짜 점유는 남아 있고 기존 실제 10/29 v1 요청은 보존했다. [실행 기록](docs/verification/2026-10-13-simple-take-off-install-booking.md). 회사 검증 당시 작업 브랜치는 미커밋 상태였으며 후속 main 통합은 최신 Git 기록을 따른다.

**2026-10-13 최신 구현 — 고객 날짜 선택·EMS 문의 연결:** [44번 수정 계획](docs/plans/44-quote-customer-date-first-recovery.md)에 따라 회사 검토 요청의 상태 변경만으로 완료된 AI가 오래된 분석으로 판정되던 오류와 예약 단계 안내를 수정했다. 고객의 예상본 승인 → 희망일 선택 → 서명·제출이 EMS 검토보다 먼저이며, 회사 전체 기간·최종 금액 확인 뒤 Google 확정 일정과 확인 메일로 이어진다. 사용자 본인이 제출한 **10월 29일 / REQUEST-C214E9F473D7 / A$2,475 GST 포함**의 DB·PDF·메일 접수·Google 확정 대기 일정을 대조했다. EMS Enquiries에도 Quotes와 같은 운영 견적을 표시하도록 연결했으며 별도 Gmail 수집·DB 복제는 하지 않는다. 기존 확정 점유 20·21·23일의 저장 409 차단과 QA 요청 22일 저장·검토·복구도 재확인했다. 전체 검사 **691/691**, Enquiries 추가 변경의 관리자 검사 **13/13**·lint·타입·빌드 통과. 회사 적용/브라우저 검증 수준은 [실행 기록](docs/verification/2026-10-13-quote-customer-date-first-recovery.md)에 따른다. 신규 브랜치는 `codex/quote-date-first-flow-20261013`이며 아직 아래 main 통합 기록에 포함하지 않았다.

**2026-10-13 최신 Git 통합:** `codex/ems-confirmed-booking-calendar-20261013`의 구현 커밋 `acf2faa`를 `main`에 충돌 없이 병합했다(`3bddc59`). 병합 직후 트리는 회사 환경에서 검증한 작업 브랜치와 동일하다. 회사 원격 `origin` (`lnkgroupsydney-hub/lnkgroup`)에 작업 브랜치와 main을 함께 push했으며 개인 원격은 사용하지 않았다. 이 후속 문서 갱신은 Git 통합 기록만 추가한다. 기존 678/678·실제 PostgreSQL 경합 8/8·lint/타입/build·회사 Chrome 인수 결과를 재사용하며 코드나 회사 저장 자료는 변경하지 않는다.

**2026-10-13 최신 구현 — EMS 회사 제안·확정 예약:** [43번 계획](docs/plans/43-ems-confirmed-booking-calendar.md)에 따라 회사 최종 금액·여러 실제 작업 기간·별도 고객 확인·DB 원자 점유·Google 확정 일정/독립 검증·고객 날짜 차단·고정 PDF/메일·변경 대사를 구현했다. 전체 최종 **678/678**, 실제 PostgreSQL 17 별도 세션 경합 **8/8**, lint·타입·빌드 통과. 회사 Supabase 적용·익명 접근 차단·원본 보존과 Production READY를 확인했다. 회사 Chrome에서 **A$3,190 GST 포함 / 10월 20–21일 종일 +23일 09–13시** 초안을 저장하고, 시작일 다음 날의 Google 충돌과 발행 차단을 확인했다. 회사 Chrome에서 **발행 → 고객 OTP 복구/전체 금액·기간 별도 확인 → EMS 확정**까지 실행하고 실제 Google 두 구간·DB 점유·원본/PDF hash를 대조했다. **Gmail 실제 3통·확정 PDF 2페이지·고객 복구/320·393px·고객 B의 20/21/23일 선택 차단·22일 저장·오래된 날짜 저장/제출 409 인수까지 완료**했다. 예정 시각 자동 cron 실행과 확정 Google event의 실제 변경 주입은 미실행이며, 확인용 가상 예약의 20·21·23일 점유는 유지했다. 브랜치는 `codex/ems-confirmed-booking-calendar-20261013`이며 이번 배포와 Git 통합은 구분한다. 일일 백업 cron은 실시간 동기화가 아니다. [검증 기록](docs/verification/2026-10-13-ems-confirmed-booking-calendar.md).

**2026-10-12 최신 구현 — 예상 견적 승인·예약 요청·회사 Calendar:** [42번 계획](docs/plans/42-live-estimate-booking-request-calendar.md)에 따라 숫자 예상본 승인 → Google 예약일 차단/희망일 선택 → 예약 요청 확인 서명·제출 → EMS 저장·고정 PDF·회사 메일 → 회사 기본 Calendar의 확정 대기 일정까지 구현·배포했다. 새 운영 흐름은 `lnkgroupsydney@gmail.com` 기본 Calendar로 통일하며 기존 시험 캘린더 자료는 보존한다. 회사 Chrome에서 **A$3,135 / 10월 20일 / REQUEST-070EEB13C91F**의 동일 저장본·Gmail 실제 PDF 수신·Google 일정 1개와 날짜 변경 시 재서명·새로고침 복구를 확인했다. 전체 **612/612개**, 관련 **54/54개**, lint·타입·빌드 통과. 제출 직후 처리와 하루 한 번의 백업 cron을 설정했으며 예약 시각의 cron 자동 실행은 아직 미검증이다. **회사 실제 기간·최종 가격/약관·재동의·확정 예약은 후속**이다. 작업 브랜치 `codex/live-quote-booking-calendar-20261012`의 회사 Vercel 배포와 Git 커밋/병합은 구분한다. [검증 기록](docs/verification/2026-10-12-live-booking-request-calendar.md).

**2026-10-12 최신 Git 통합:** 예약 요청 연동 작업 브랜치 커밋 `9e7f728`을 `main`에 충돌 없이 병합했다(`ce5c565`). 병합 트리는 검증한 작업 브랜치와 동일하다. 회사 원격은 `origin` (`lnkgroupsydney-hub/lnkgroup`)이며 개인 원격은 사용하지 않는다. 앞선 고객 인증/복구 통합 이력은 `92f76a8` → `6dd42ea`다.

**2026-10-12 최신 구현 — 회사 도메인·고객 이메일 인증/견적 복구:** [41번 계획](docs/plans/41-domain-live-quote-booking-plan.md)의 1~2단계를 `main@31e7387`에서 분기한 `codex/domain-customer-quote-auth-20261012`에 구현했다. Production 기준 주소를 **https://www.lnkgroupsydney.com.au**로 전환해 견적 API 200을 확인했고, 회사 발신 주소 `quotes@lnkgroupsydney.com.au`와 Reply-To 회사 Gmail, Supabase custom SMTP·8자리/15분 OTP·Site URL, Google callback을 설정했다. 고객/직원 세션 분리, 요청별 이메일 인증·견적/사진 복구·로그아웃·이전 주소의 일회용 이전 경로와 다중 탭 요청 ID 검사를 추가했다.

자동 검사 **558/558개**, lint·타입·빌드가 통과했다. 회사 SQL `20261012085406` 적용 후 기존 요청 12건·사진 29건·분석 15건의 내용 hash 보존과 신규 세 테이블의 익명 접근 차단을 확인했다. Vercel `dpl_FSteedNuKs7tnRBSEga5VGKaPFon`는 READY이며 작업 브랜치 검증 당시 CLI로 배포했다. **1~2단계 회사 Chrome 인수 완료:** 회사 발신 OTP 배달/인증·EMS 직원 로그인·이전 요청 동일 ID 이전·www 저장/5장 업로드 → AI **15문/6서랍, A$3,135 GST 포함** → 고객/EMS/DB 대조 → 고객 로그아웃/직원 로그인 유지 → 두 번째 OTP의 새 고객 세션으로 사진·동일 분석/금액 복구·새로고침 보존을 확인했다. 목록에는 인증하여 연결한 요청만 표시됐다. **실제 다른 물리 기기와 미가입 신규 이메일/signup은 미검증**이며 별도 고객 세션으로 복구를 확인한 결과다. 당시 3단계 이후는 미구현이었으며, 후속 예약 요청 연동은 위 42번 최신 기록을 따른다. [인수 기록](docs/verification/2026-10-12-domain-customer-quote-auth.md). 아래 날짜별 설명은 당시 결과다.

**2026-10-11 최신 개정 — AI 수량 추정 가견적 운영 완료:** 고객 수량을 비워 두어도 AI가 문·서랍 앞판을 추정하고 예상 도장 금액을 계산한다. 정확한 수량·상태·최종 가격은 현장에서 확인해 조정한다. 기존 단가와 GST는 유지하며, 같은 사진의 미선택 표면이나 다른 현장의 손상은 보수비에 합산하지 않는다. [40번 현행 명세](docs/plans/40-ai-quantity-provisional-estimates.md)가 아래 v1의 고객 수량 일치 조건을 대체한다. 기존 기록은 보존한다.

전체 **524/524**·lint·타입·빌드, 회사 Supabase 적용, Vercel `dpl_FgjBEwxhuz17b5A4pUVWq4FAMUK7` READY를 확인했다. 5장씩 3세트의 실제 AI 추정 결과는 **14문/6서랍 A$2,970 · 21문/6서랍 A$4,125 · 12문/4서랍 A$2,420 (GST 포함)**이며 회사 Chrome EMS와 DB의 저장값이 일치한다. 모두 기준 전면 범위의 잠정 도장비이고 미산정 손상·미촬영 범위는 별도다. 현장 최종견적 편집·발행(RQ-04c), 재동의·정식 예약은 후속이다. [실행 증거](docs/verification/2026-10-11-ai-quantity-provisional-estimates.md). 후속 사용자 요청으로 운영 수정·AI 수량 견적을 `main`에 병합했다(`425959b`). 회사 원격은 `origin` = `lnkgroupsydney-hub/lnkgroup`이며 이번 통합의 push 대상이다. 아래 이전 시점의 미병합 설명은 당시 기록이다.

**앞선 v1 운영 검증 기록(2026-10-11):** 회사 Vercel Production 환경을 설정하고 [운영 앱](https://lnkgroup.vercel.app/)에 배포했다. `dpl_7yQ7MBKWgcX8bp9ufkMUos9f3QP5`는 READY이며, 회사 Chrome의 실제 EMS 로그인·비공개 사진·가격표 열람을 확인했다. 분석은 Mac worker가 꺼진 상태에서도 Vercel `after()`로 완료됐다. Forwarded `sig`/`exp` 호환, 프롬프트 v2의 사진 근거 계약과 실행 버전 검사를 보강했고 전체 검사 **502/502**, lint·타입·production build가 통과했다.

운영 API에서 생성 예시의 **단일 수납장 문 3개·서랍 2개**가 A$1,500 + GST A$150 = **A$1,650**으로 저장되고 EMS에 같은 항목·총액이 표시됐다. 사용자가 요청한 전체·상부·하부·측면·손상 **5장 세트 1·2·3, 총 15장**의 비공개 저장·분석을 완료했다. 세트 1은 회사 Chrome에서 5장 업로드·새로고침 복원·EMS 동일 사진/작업을 확인했고, 전체 수량·손상 위치 확인이 필요해 `review_required`, 총액 null이다. 세트 2·3도 범위·수량·손상 확인이 필요해 총액을 보류했다. 단일 수납장 가격을 전체 주방 견적으로 표시하지 않는다.

동일 주방의 충분한 전체 사진·확인 수량을 사용한 숫자 견적 인수, 현장 조정, 일반 고객 이메일 본인 확인·정식 약관/서명·예약, 만료 staging 사진의 클라우드 정기 정리는 남아 있다. 과거 `unconfigured`/`awaiting_company_rates` 저장본은 유지한다. [운영 검증 기록](docs/verification/2026-10-11-vercel-live-quote.md)을 따른다. 앞선 구현은 `main@f1f071b`에 병합됐다. 이번 운영 수정의 소스 기준은 `codex/vercel-live-quote-qa-20261011`이며 회사 Vercel CLI 배포와 별도로 관리한다. 이번 작업의 main 병합·원격 push는 수행하지 않았으며 배포 READY를 main 최신 소스 반영으로 간주하지 않는다.

2026년 9월 25일 · 계획 버전 1.0 · 기준 지역 Australia/Sydney · 문서 언어 한국어

L&K Group의 서비스 홈페이지, 온라인 쇼핑몰, ERP·CRM 운영관리 시스템을 구축하기 위한 개발 참조 문서와 로컬 Next.js 앱 저장소다. 기존 분석 자산은 ChatGPT 프로젝트의 대화 3개와 화면 시안 3개다. 2026-09-27 로컬 기본 앱을 생성했고, 2026-10-01 사용자가 지정한 회사 Supabase 프로젝트로 업무 저장소 연결을 진행한다. 회사 도메인·Vercel 배포·고객 인증/복구의 최신 상태는 위 2026-10-12 기록, 사진 AI 견적 인수는 2026-10-11 기록을 따른다.

권장 방향은 **하나의 고객·운영 데이터 기반 위에 서비스 예약과 상품 구매 흐름을 구분하고, 서비스 매출부터 단계적으로 운영을 검증하는 것**이다. 핸디맨·페인팅·캐비넷 페인팅과 터치업 키트·김치는 동일 관리자에서 관리하되, 식품의 배송·위생·재고 정책은 별도로 적용한다. 현재 명칭은 EMS(Enterprise Management System)이며 ERP·CRM 중심 운영관리를 뜻한다. 기존 `esn-admin` 경로와 과거 기록은 유지한다.

## 읽는 순서

**2026-10-08 최신 구현 — 실제 고객 저장 → EMS 연결:** [37번 운영 전환 계획](docs/plans/37-live-quote-ems-booking-implementation.md)의 RQ-00~02를 새 `codex/live-quote-ems-foundation-20261008`에서 구현했다. 실제 이메일·연락처·서비스·수량 저장, 복원, EMS 동일 요청/이력 조회와 검토 요청 전환을 회사 Chrome·Supabase에서 확인했다. 전체 검사 **420/420**, 후속 관련 검사 **20/20**, lint·타입·빌드가 통과했고 기존 네 테이블 fingerprint는 일치한다. 고객 이메일 인증·사진·회사 금액·서명·예약은 후속이다. 로컬 3002에는 반영했으며 [Vercel 앱](https://lnkgroup.vercel.app/)은 이전 배포다. [검증 기록](docs/verification/2026-10-08-live-quote-foundation.md). 현재 다음 순서는 10월 11일 개정에 따라 RQ-03 촬영 안내/사진 → RQ-04 AI 예상 견적·EMS 저장/현장 조정이며 EMS-D2는 이후다.

**2026-10-08 추가 완료 — 새 견적 전체 폼:** 제출 완료 화면의 `Start a new quote → Open new quote form`을 구현했다. 기존 제출·사진·서명과 작성 탭을 보존하며 별도 비공개 세션의 빈 폼을 새 탭으로 연다. 고객 정보 → 서비스 → 사진 → 데모 승인 → 날짜 → 서명·제출 흐름을 직접 진행할 수 있다. 전체 검사 **392/392**, lint·타입·빌드와 추가 두 미제출 작성 탭 분리 검사 **18/18**을 통과했다. 회사 Chrome에 사용자 입력용 빈 폼을 열었고 실제 `DEMO-3E8E831C` snapshot/사진 두 장/발송 1회 보존을 확인했다. 가격·약관은 데모이며 회사 제안·최종 확정의 잔여 인수와 구분한다. [검증 기록](docs/verification/2026-10-08-quote-damage-demo.md#새-견적-전체-폼--후속-요청-완료)을 참조한다.

**2026-10-08 구현·일부 실연동 검증 — 두 사진 Quote 데모:** 새 `codex/quote-damage-demo-implementation-20261008`에서 재서명 사진 표시·권한 만료 화면 제거·느린 조회/늦은 동의 응답 처리를 보완했다. **380/380 검사·lint·타입·빌드**가 통과했고 지정 두 사진으로 `DEMO-3E8E831C` 저장·복원·서명 제출 → 회사 INBOX 1통/PDF 2개 → 확정 대기 Calendar 이벤트를 실제 확인했다. 기존 네 제출과 새 사진은 보존됐다. [검증 기록](docs/verification/2026-10-08-quote-damage-demo.md)에 합성 UI·실제 연결·남은 항목을 구분한다. **직원 관리자 로그인 대기와 Mac 잠금으로 EMS 고객 연결·회사 제안/재서명/최종 확정 및 일부 화면 인수는 미완료**다. 성공 빌드는 작업 폴더에 반영했고 로컬 3002에서 실행한다. [계획](docs/plans/36-quote-damage-demo-completion-plan.md)·[TODO](docs/plans/15-home-cabinet-admin-todo.md)를 갱신했으며 커밋·병합·푸시는 수행하지 않았다.

**2026-10-08 다음 구현 계획 — 두 손상 사진으로 Quote 마무리:** `main@3f7e8c9` 기준으로 [36번 순차 계획](docs/plans/36-quote-damage-demo-completion-plan.md)을 작성했다. 사용자 지정 `damage 1.jpeg`·`damage 2.jpeg`를 비공개 데모 자료로 사용해 고객/서비스/사진 저장 → 승인·날짜·서명·제출 → PDF·회사 메일·확정 대기 Calendar → EMS 고객 연결·기간 제안 → 고객 재서명·회사 확정·Google 동기화 순으로 인수한다. 현재는 계획·TODO 갱신이며 사진 업로드·실연동·코드 구현은 미착수다. 실제 AI·운영 가격/약관은 후속이고 EMS D2 집계보다 Quote 완료를 먼저 진행한다. 당시 Git 조회에서 로컬 main은 회사 `origin/main`보다 7커밋 앞서며 새 계획 브랜치는 `codex/quote-finish-20261008`이다. 아래 날짜별 설명은 당시 구현/검증 기록이다.

**2026-10-07 EMS-D1 구현 완료:** 승인한 관리자 공통 화면·메뉴별 경로에 기존 고객/문의/견적/예약/설정 기능을 연결했다. 인증 경계·자동 동기화·입력/불확실 요청을 보존하고 전체 검사 **374/374**·lint·타입·build와 합성 브라우저 **36+8+4** 항목을 통과했다. 로컬 앱은 기존 3002 주소에서 실행 중이다. [구현 계획](docs/esn-admin/09-2026-10-07-admin-shell-implementation-plan.md)·[검증 기록](docs/verification/2026-10-07-ems-admin-shell.md)·[진행표](docs/esn-admin/05-progress.md)에 결과와 미완료 인수를 반영했다. 실제 KPI/그래프 집계는 다음 D2이며 회사 자료 변경·운영 배포·커밋/merge/push는 수행하지 않았다.

**2026-10-06 EMS 대시보드 설계:** 참고 이미지의 카드·그래프·일정·사이드바를 기존 글로벌 Slate/Greige로 적용하는 [디자인·UX 및 admin 이관 계획](docs/esn-admin/08-ems-dashboard-design-and-implementation-plan.md)과 [가상 와이어프레임](docs/esn-admin/design/dashboard-wireframe.html)을 추가했다. 현재 기능을 활용한 1차 화면과 Jobs·Orders·Inventory 확장 목표를 구분하며, 기존 인증·고객·예약·문서/사진·세션 규칙을 보존한다. 이번은 계획·문서 시안이고 실제 새 대시보드 구현은 후속이다.

**2026-10-06 main 대조:** 로컬 `main@e2d4d73`에 직원 관리자 접근·고객 통합 조회·본인 세션 관리가 병합됐다. 회사 원격을 fetch한 결과 `origin/main@9ec6f6e`이며 로컬이 3커밋 앞선다. [최신 main 상태와 다음 작업](docs/esn-admin/07-2026-10-06-main-status-and-next-steps.md)에 이전 안내의 완료 상태를 정정하고 실제 고객 연결/세션 회수 인수·필터·KCP 왕복 검증 순서를 정리했다. 이번 확인은 Git·문서 대조이며 CI·배포 검증을 새로 실행한 결과가 아니다.

**2026-10-06 최신 진행 — 고객 통합 조회·본인 세션 관리:** [오늘 구현 계획](docs/esn-admin/06-2026-10-06-implementation-plan.md)에 따라 고객 생성·검색·상세·원본 수동 연결/해제·감사와 본인 세션 조회·다른 세션 종료·복구 안내를 구현했다. 기존 Operations와 직원 로그인 경계를 유지하고 구매/청구는 준비 상태로 표시한다. 전체 업무 검사 **359/359**·lint·타입·production 빌드가 통과했다. 사용자의 실제 직원 로그인·이메일 확인 후 기존 견적/서명 약관 PDF 두 개(각 2페이지)를 읽고 총 4페이지를 렌더링해 참조번호·데모 표시·서명·가독성을 확인했으며 비공개 사진도 640×480으로 로드됐다. 회사 DB의 기존 21테이블/7 RPC 읽기 검사와 Dashboard Healthy 표시를 확인했다. **신규 세션/고객 SQL 두 개의 회사 적용과 실제 읽기를 확인했다.** 새 테이블/함수의 읽기·익명 접근 차단 14/14와 고객 0건·미연결 원본 7건·현재 세션 조회가 정상이며, 합성 UI의 모바일·키보드·오류 복구 검증도 완료했다. 실제 고객 생성/연결·실제 다른 세션 종료·다중 DB 연결 경합은 미검증이다. 추가 관리자 초대·권한 회수/분실 복구·구매/청구·운영 배포는 후속이다. [당일 검증 기록](docs/verification/2026-10-06-esn-customers-and-sessions.md)·[ESN 진행표](docs/esn-admin/05-progress.md)를 따른다.

**2026-10-04 당시 기록 — 관리자 이메일 코드 확인:** `lnkgroupsydney@gmail.com` 회사 관리자 생성·실제 앱 로그인·사용자 영구 비밀번호 변경을 확인했고 임시 비밀번호 값은 비공개 로컬 기록에서 제거했다. 휴대폰을 사용할 수 없다는 최신 요청에 따라 **비밀번호 + 이메일 코드 확인**을 구현했다. 이메일 검증은 서버의 현재 사용자·이메일·세션에 귀속되며 Supabase `aal2`/TOTP MFA 완료로 표시하지 않는다. 최초 수신자는 지정 회사 이메일로 제한한다. 전체 업무 검사 **320/320**, lint·타입·격리 production 빌드가 통과했다. 사용자 승인 후 이메일 검증 migration 적용 성공·service RPC 응답·anon 권한 차단을 확인했다. 로컬 앱(3002)의 이메일 모드를 활성화하고 기존 사용자 세션으로 `Verify your email` 화면까지 확인했다. `Send verification code` 실행 후 Resend 수락·서버 발송 확인과 6자리 입력·만료/재발송 카운트를 확인했다. 사용자가 이메일 코드를 입력해 인증을 마쳤고 실제 DB의 활성 검증 1개·소비된 코드 해시 제거와 새 관리자 탭의 업무 화면을 확인했다. 문의 7건·서명 데모 요청 4건, Calendar/Gmail 영역과 기존 제출의 비공개 사진을 열었고 새로고침 후 인증·업무 화면이 유지됐다. 콘솔 오류·경고는 없었다. PDF 본문은 당시 브라우저 다운로드 제한으로 미확인이었으며, 10월 6일 실제 읽기로 보완했다. [이메일 검증 기록](docs/verification/2026-10-04-staff-email-verification.md)과 [진행표](docs/esn-admin/05-progress.md)를 따른다. 앞선 Auth·QR 작업은 [온보딩 기록](docs/verification/2026-10-04-staff-admin-onboarding.md)에 보존하며 ESN-01 전체 인수는 미완료다.

**2026-10-04 앞선 구현 — ESN 관리자 접근 기반:** Google 주소 검색 결제 대기와 독립적으로 [첫 작업 ESN-01](docs/esn-admin/04-roadmap-and-acceptance.md)을 시작했다. `admin-access`의 세션·만료·활성 membership·MFA 수준·업무 권한 정책과 인증/권한 조회 포트를 구현하고, 기존 로컬/Google 데모의 요청 host·세션 경계 및 로그인 전 정보 노출을 보강했다. 정책·API·비공개 파일의 합성 시험과 기존 업무 회귀 검사, CI 실행을 추가했다. [구현 검증 기록](docs/verification/2026-10-04-esn-admin-access.md)에서 자동 검사·로컬 브라우저·실제 연결을 구분한다. 당시 실제 직원 Auth/MFA와 membership 연결은 다음 단계였으며 위 후속 요청으로 진행한다.

**2026-10-04 기획 — 관리자 전용 ESN:** 고객의 계약·예약·구매·관련 데이터를 별도 관리자 화면에서 통합 확인하는 [ESN 계획 폴더](docs/esn-admin/README.md)를 추가했다. 기존 앱과 업무 DB를 유지하며 `/admin` 화면·서버 권한을 구분하는 모듈형 모놀리스를 초기 권장안으로 삼는다. `admin.<회사 도메인>`은 소유 도메인 확인·배포 승인 후 검토할 자리표시자이며, 독립 배포 격리를 뜻하지 않는다. 요청의 ‘프렌치’는 Git 브랜치로 잠정 해석해 `codex/esn-admin-planning`에서 기획과 첫 구현을 진행한다. 실제 운영 도메인과 구매 범위는 확인 대기다.

최초 분석·분리 개발 계획·진행표 작성에 이어 사용자 요청으로 ESN-01b 공통 인가 정책과 데모 접근 경계를 구현했다. localhost 관리자·고객 초안·서명 데모/PDF·예약 검토·비공개 사진 기반을 재사용하며, 당시 통합 고객 원장은 후속이었으며 10월 6일 코드 구현·회사 SQL 적용·실제 읽기 확인을 위에 갱신했다. 주문/결제/인보이스는 후속 구현이다. [ESN 진행표](docs/esn-admin/05-progress.md)가 ESN 상태의 원본이며 [기존 TODO](docs/plans/15-home-cabinet-admin-todo.md)는 KCP 잔여 작업과 연결한다. 아래 날짜별 구현·테스트 수치는 당시 증거로 보존한다. 앞선 ESN-01b 구현에서는 회사 DB·계정·Google 설정·DNS·배포를 변경하지 않았으며 첫 Auth 계정 생성은 위 후속 요청의 범위다.

**2026-10-04 구현·실제 연결 — 예약·서명 보강과 비공개 사진:** 새 `codex/private-quote-photos` 브랜치에서 [35번](docs/plans/35-mobile-booking-private-photo-plan.md)의 사진 업로드·검사·비공개 저장/조회/삭제/복원과 사진 변경 시 재승인·서명 원본 보존을 구현했다. 회사 Supabase에 신규 migration을 적용해 업무 테이블 22개·신규 사진 테이블의 RLS/역할 차단과 private JPEG 버킷을 확인했다. 회사 Chrome에서 사진 포함 `kcp-demo-v2` 제출 `DEMO-F628C5C6`을 저장·새로고침 복원했고, 회사 Gmail 받은편지함 1통/PDF 2개와 10월 21일 `Pending confirmation` Calendar 이벤트 1개를 실제 확인했다. 별도 고객 세션의 예약일 차단 UI와 서명 포인터 처리를 검증·보강했으며, 당시 남았던 관리자 사진 열람은 후속 직원 인증에서 확인했고 PDF 본문/서명도 10월 6일 읽었다. 실제 휴대폰 서명·사진 화면 320px·사진 포함 회사 제안 재서명/확정은 남아 있다. 마지막 DB 보호 조건을 포함한 전체 **229/229 테스트**와 lint·타입·빌드가 통과했다. [실행 증거](docs/verification/2026-10-04-private-photos-mobile-booking.md)는 실제 연결과 격리 장애 시험을 구분한다. Google 주소 검색 결제 요청은 진행 중이며 AI·운영 가격/약관·운영 고객 인증·공개 배포는 후속이다.

**2026-10-03 추가 요청 — 전체 주소 자동완성 코드 완료:** [34번](docs/plans/34-google-address-autocomplete.md)에 따라 견적·문의 폼의 주소·지역명·우편번호 6개 입력에 Google Places (New) 공통 검색/선택을 연결했다. 회사 Cloud의 결제 비활성·API 키 미설정을 확인했고, 사용자는 결제 등록을 나중에 하고 코드 구현까지만 진행하도록 확정했다. 실제 Google 검색은 후속이며 미연결 상태에서도 직접 입력·저장 경로를 유지한다. 전체 검사 180개·lint·타입·빌드와 가상 응답의 키보드/포인터 선택·320px·늦은 응답 무시·무키 수동 폼 동작을 [검증](docs/verification/2026-10-03-google-address-autocomplete.md)했다. 실제 Google 주소 선택/저장·복원 시험과 구분한다.

**2026-10-03 회사 데모 확장·실제 왕복 검증:** [33번 관리자 검토·회사 일정 확정](docs/plans/33-admin-booking-confirmation-day-plan.md)의 비공개 제출/PDF·수동 작업 구간·재서명·전체 기간 충돌 검사·원자적 점유·Google 변경 검토를 연결했다. 회사 Supabase에 신규 migration 두 개를 적용하고 **21테이블/7 RPC·공개 역할 차단**, 보안 Advisor 오류·경고 0을 확인했다. 회사 Chrome에서 새 `DEMO-EE6B0405`의 고객/서비스 저장→날짜·키보드 서명→PDF 메일→회사 제안·재서명·확정→Google 외부 이동→재검토·재서명·재확정을 실제 확인했다. Google의 기본 `opaque` 생략 응답으로 생긴 검토 오류를 수정한 뒤 **164/164 테스트·lint·타입·빌드가 통과**했다. [검증 기록](docs/verification/2026-10-03-admin-booking-confirmation.md)에서 실제 연동과 격리 시험을 구분한다. 회사 Gmail 4통/PDF 8개와 Google 이벤트 4개(원본 요청·최종 작업 2·요약 1), 반복 worker 중복 없음·새로고침 복원·320/390px 화면·콘솔 오류 없음을 확인했다. 실제 모바일 터치·별도 작성 세션의 날짜 선택 UI는 남아 있으며, 운영 가격·약관·근무/자원 정책·고객 인증·발신 도메인·공개 배포는 별도다.

**회사 전용 데모 실제 검증 완료(2026-10-02):** 서비스 저장 → 데모 금액·약관 승인 → 날짜 선택 → 서명·제출 → Resend → 회사 Calendar를 연결했다. [검증 결과](docs/verification/2026-10-02-demo-quote-email-calendar.md): 자동 검사 117개, 회사 Gmail 스팸함 1통/HTML 첨부 2개, Calendar 확정 대기 이벤트 1개, 실제 예약일 차단·중복 없음·새로고침 복원 확인. 시험 수신자는 회사 주소로 제한한다. PDF·실제 가격/약관/계약·사진/AI·운영 배포는 별도다.

**기반 검증(2026-10-02): 고객 선저장과 Google 연동 복구.** [32번 전체 고객 진행 계약](docs/plans/32-client-quote-signature-submission.md)에 따라 고객 정보 저장 → 서비스·사진 → AI·가격 → 고객 approve → 시작일 선택 → 최종 확인·서명·제출 → 견적·서명 계약 이메일 → 회사 Calendar 순서로 정렬했다. 회사가 기간·충돌을 검토한 뒤 예약을 확정하며 이미 예약된 날짜는 선택할 수 없다. 고객·서비스 초안 비공개 저장/복원과 [31번 OAuth·worker 복구](docs/plans/31-google-integration-recovery-and-operation-plan.md) 코드와 데모 연결 전 80개 격리 테스트·lint·타입·빌드가 통과했다. 회사 DB에 신규 migration 2개를 적용했고 실제 브라우저 저장·새로고침 복원·두 탭 충돌 보존·타 세션 분리·320px 화면과 자연 만료 Google 토큰 갱신(R01)을 확인했다. 회사 Dashboard advisors는 오류·경고 0이며 정보 항목은 의도한 서버 전용 RLS/유일성 인덱스로 기록했다. [10월 2일 결과](docs/verification/2026-10-02-google-recovery.md)에 증거를 구분한다. Next 앱·브라우저 없이 반복 worker가 새 시험 메일을 수집한 W01도 확인했다. 중단 중 같은 대화 답장 복구(W02)와 실제 동시 실행 잠금(R02)도 통과했다. 실제 권한 회수/재연결, CLI migration 이력 정리는 대기다. 사진·AI·실제 가격/계약·운영 고객 인증은 후속이며 실제 완료 범위는 [TODO](docs/plans/15-home-cabinet-admin-todo.md)에 구분한다.

**10월 2일 초기 데모 기록: 서명·실제 이메일 → Calendar.** [32번 1.1절](docs/plans/32-client-quote-signature-submission.md)에 따라 localhost에서 샘플 AUD 1,250·비구속 데모 약관, 실제 Google busy 날짜 선택, 이름/그린 서명·불변 제출, 서명된 **HTML 첨부 2개**와 Resend provider 수락 후 Pending confirmation Calendar 업로드를 구현했다. 확인된 발신 도메인이 없어 `onboarding@resend.dev`에서 `Lnkgroupsydney@gmail.com`으로만 시험한다. 비공개 작성 쿠키는 고객 신원 인증이 아니며 PDF·실제 계약·예약 확정이 아니다. 새 migration 원격 적용·14테이블/4 RPC anon 차단과 **전체 테스트 117/117·lint·타입·빌드 통과**를 확인했다. 실제 브라우저 제출→회사 Gmail 스팸함 1통/HTML 첨부 2개→Calendar 이벤트 1개, 예약일 차단·새로고침 복원·worker 재실행 중복 없음까지 [실제 검증](docs/verification/2026-10-02-demo-quote-email-calendar.md)을 마쳤다. 장애·동시 변경·서명 변조 등은 격리 시험 결과이며 실제 장애 시험으로 확대하지 않는다.

**당시 작업 기록(2026-10-01): [회사 Supabase 저장소 연결](docs/plans/30-supabase-storage-integration.md).** 사용자가 지정한 `xlqyafthsxallostcqfe` 프로젝트에 문의·Gmail 이력·일정·관리자 세션·암호화된 Google 토큰을 저장하도록 어댑터와 마이그레이션을 구성했다. 12개 업무 테이블은 RLS와 역할 권한으로 브라우저 직접 접근을 차단하고 서버 전용 RPC로 사용한다. 실제 스키마 적용·클라우드 문의 저장/재조회·권한 차단·모바일 관리자 일정 변경·재시작 보존을 확인했다. 후속 Google 오류 처리 보강을 포함해 자동 테스트 44개와 lint·타입·빌드도 통과했으며 [검증 기록](docs/verification/2026-10-01-supabase.md)을 따른다. 현재 관리자 로그인과 Google 연결은 loopback 로컬 앱에서 실행한다. 회사 OAuth·Gmail 수신/답장 병합·Calendar 양방향 검토를 실제 연결로 확인했다. [Google 검증 기록](docs/verification/2026-10-01-google-oauth-live.md)에 통과 범위와 자연 토큰 갱신·재연결·운영 전환 대기를 구분한다.

**이전 계획(2026-10-01): [회사 OAuth 설정·실연동 검증](docs/plans/29-google-oauth-live-verification-plan.md).** 회사 Google 설정 → Gmail 수집 → Calendar 양방향 검토 → 자동 수집·재시작·재연결 → 실제 사용 대상 확인 순서와 완료 기준을 작성했다. [TODO](docs/plans/15-home-cabinet-admin-todo.md)에 실행 항목을 나눴으며, 회사 계정 연결, 시험 문의/답장 수집, 일정 생성·변경 승인/거절·삭제 왕복을 확인했다. 현재 대상은 시험 라벨·Calendar이며 운영 대상 전환과 일부 복구 검증은 남아 있다.

**당시 작업 기록(2026-09-30): [Gmail 문의 → 회사 검토 → Google Calendar](docs/plans/28-gmail-enquiry-calendar-implementation.md) 로컬 구현·검증 완료.** [18번 후속 제품 흐름](docs/plans/18-kcp-page-prototype.md)·[25번 전체 계획](docs/plans/25-kcp-quote-to-booking-implementation.md)·[15번 TODO](docs/plans/15-home-cabinet-admin-todo.md)를 따른다. P0 명세 이후 KCP 견적 폼, 로컬 SQLite 저장, `/admin` 비공개 문의함, 회사 OAuth, Gmail 라벨 수집과 제안 일정의 Calendar 양방향 검토를 구현했다. 코드 검사·대체 전송 테스트 23개·실제 브라우저·재시작 보존 확인은 [검증 기록](docs/verification/2026-09-30-gmail-calendar.md)을 따른다. 9월 30일 당시 실제 Google 연결은 회사 OAuth 클라이언트 설정 대기였으며, 최신 상태는 위 10월 1일 항목을 따른다. 설정 방법·이번 구현 범위는 28번에 정리한다.

연동 계정은 `Lnkgroupsydney@gmail.com`이며 공개 문의 이메일과 구분한다. Google에서의 수정은 검증 후 앱에 반영한다. **마지막 작업 후 프로젝트 Complete → 인보이스 발행 → 실제 발행일 +3 달력일 납기(Sydney)** 정책은 [27번](docs/plans/27-kcp-google-calendar-sync.md)에 보존한다. 비공개 사진과 실제 AI 분석·초기 예상 가격 계산은 10월 11일 고객/EMS 흐름까지 연결했고 청구 실행·운영 고객 이메일은 후속 단계다. Resend는 위 사용자 승인 회사 전용 데모 범위에서 먼저 연결한다. 근무시간·기간 산식은 보류하고 KCP 초기 예상 가격은 39번의 승인된 v1 규칙을 사용한다. 다른 정찰제·현장 조정·운영 계약 정책은 후속이다. 최초 제출 일정은 확정 대기 요청이다. 33번의 회사 검토·재서명·충돌 검사 후 확정은 회사 전용 데모이며 운영 예약 승인은 별도다. 과거 Cabinet ‘약 1주’는 소개·문의 접수 목표이며 전체 기능의 납기가 아니다.

**당시 작업 기록(2026-09-29): KCP 시네마틱 디자인 구현·로컬 검증 완료.** 메인은 기존 서비스 소개 프로토타입으로 유지하고, **Kitchen Cabinet Painting 상세에만** 사진형 Hero, 실제 WebGL 9단계 공정과 완료 장면, 전후 비교 슬라이더, 색상·광택 미리보기를 적용했다. [최신 구현 범위](docs/plans/24-cinematic-kitchen-webgl.md), [글로벌 디자인 시스템](docs/plans/21-global-design-system.md), [실제 검증 기록](docs/verification/2026-09-29-cinematic-v3.md)을 따른다. 같은 모델의 문짝·손잡이·힌지를 분리하고 세척·국소 퍼티 보수·프라이머·두 마감 코트·재조립을 가역 스크롤로 연결했다. 모델은 사진을 참고한 건축 컨셉이며 실측 CAD나 실사 재구성은 아니다. 모바일·JavaScript/WebGL 미지원 환경에는 읽을 수 있는 사진과 본문을 제공한다. 전역 토큰과 공용 KitchenScene 렌더러를 콘텐츠에서 분리했다. 현재 프로덕션 미리보기는 [KCP](http://127.0.0.1:3002/services/cabinet-painting) / [메인](http://127.0.0.1:3002)이다.

회사 자료·메인 SEO는 앞서 반영했다. [회사 제공 자료](docs/reference-assets/company-brief.md)를 기준으로 실제 전화·이메일·지역·회사 로고·홍보 이미지·작업 사진을 유지한다. 회사 Supabase 연결·저장 및 Google 핵심 실연동 검증은 완료했다. 회사 Vercel 주소의 배포·Quote/EMS 검증은 10월 11일 기록을 따르며 별도 회사 도메인·Google 전체 운영 전환은 후속이다. `noindex`는 유지하며 사진 업로드·실제 AI 분석·초기 가격 계산/검토 결과와 EMS 저장은 10월 11일 검증을 따르고, 충분한 전체 사진의 실제 숫자 견적·현장 조정·운영 계약/예약·인보이스·결제는 [순차 구현 목표](docs/plans/25-kcp-quote-to-booking-implementation.md)로 남긴다. 현장별 전후 사례 자료·실측 정밀 모델·정량 성능 및 실제 기기 검증은 남아 있다.

Cabinet 상세 `/services/cabinet-painting`의 6개 서비스·적합성·포함/제외·공정·컨셉 사례·FAQ 최초 구성은 [SEO·지역 개정](docs/plans/19-kcp-seo-content-and-service-area.md)과 [이전 검증](docs/verification/2026-09-27-kcp-seo-content.md)을 참조한다. 회사가 제공한 최신 서비스 지역은 기존 지도 조사의 제한적인 후보 목록보다 우선한다.

회사 자료·실제 이미지 반영 후 lint·타입·production build와 1440·768·390·320px 메인 브라우저 확인을 마쳤다. 회사 자료 반영 당시 기록은 [이전 검증](docs/verification/2026-09-27-home-company-content.md), 이번 디자인 검증은 [2026-09-28 기록](docs/verification/2026-09-28-scroll-storytelling.md)을 따른다.

2026-10-02 Google 복구 시험에서는 앱 없는 worker 신규 수신·중단 중 답장 복구·중복 방지·동시 실행 잠금을 확인한 뒤 해당 worker를 종료했다. 이후 [데모 검증](docs/verification/2026-10-02-demo-quote-email-calendar.md)에서 반복 worker를 다시 실행했으며 최종 기록은 로컬 앱 3002·반복 worker 실행, 임시 3003 서버 종료다. 클라우드 상시 운영은 별도다.

## 로컬 앱 실행

Node.js 24와 npm 11을 사용한다. `.nvmrc`는 확인한 로컬 버전을 기록하며 실제 패키지 버전은 `package.json`과 lockfile이 기준이다.

```sh
npm ci
npm run setup:local
npm run dev -- --port 3002
```

로컬 기능 검증 주소는 `http://127.0.0.1:3002`이며, 회사 운영 검증 주소는 `https://lnkgroup.vercel.app`이다. `setup:local`은 기존 설정을 보존하고, 최초 실행 때 비공개 `.env.local`에 관리자 비밀번호·토큰 암호화 키를 생성한다. [28번 로컬 설정과 Google 연결 안내](docs/plans/28-gmail-enquiry-calendar-implementation.md)를 따른다. 다른 포트로 실행하려면 `APP_BASE_URL`과 Google redirect URI도 함께 맞춘다. 최신 저장소 설정은 [30번 Supabase 안내](docs/plans/30-supabase-storage-integration.md)를 따른다. `setup:local`의 신규 설정은 `OPERATIONS_STORE=supabase`이며, 회사 키와 DB 스키마가 준비돼야 문의 저장과 운영 검토가 동작한다. 기존 `.env.local`은 덮어쓰지 않으므로 저장소 선택을 직접 확인한다. `OPERATIONS_STORE=sqlite`는 격리된 오프라인 테스트에 사용하고 Supabase 장애 시 자동 전환하지 않는다. Google 키 없이도 DB 접수·검토는 가능하고, 실제 Gmail·Calendar 동기화에는 별도 OAuth 설정이 필요하다. 검사 명령은 `npm run lint`, `npm run typecheck`, `npm run build`이며 `npm run check`로 순서대로 실행할 수도 있다. CI 설정과 실제 GitHub 실행 결과는 구분한다.

현재 Mac에서 Turbopack의 CSS worker 포트 권한 오류를 확인해 공식 Webpack 옵션으로 dev·build를 구성했다. Webpack production 빌드는 통과했다. Next.js 공식 ESLint preset의 peer 호환 범위에 맞춰 ESLint 9를 고정했으며 npm의 지원 종료 경고는 남아 있다. 자세한 결과는 [검증 기록](docs/verification/2026-09-27-home-prototype.md)을 따른다.

회사 제공 이미지의 적용 위치와 기존 생성 이미지 기록은 [자산 기록](docs/prototype-assets.md)에 있다. 회사 연락처·로고·작업 사진은 수령했으며 최종 디자인·현장별 사례 설명·운영 도메인은 별도 준비한다.

**보상 조건 검토(2026-09-27): [웹 유입 매출 5% 계약 분석](docs/plans/16-revenue-share-contract-review.md).** 사용자가 설명한 제안은 웹 유입으로 인정되는 매출의 5%이며 GST 포함 금액 기준이다. 최소 보수·계약 기간·귀속 규칙·코드 권리 등은 미합의다. 이 분석은 개발자 내부 검토용이며 상대방에게 전달할 계약서가 아니다.

| 문서 | 개발에서 참조할 내용 |
| --- | --- |
| [ESN 관리자 계획](docs/esn-admin/README.md) | 관리자 전용 분리 개발·고객 통합·단계별 인수 기준·진행표 |
| [00 기존 프로젝트 분석](docs/plans/00-project-baseline.md) | 확인된 시안, 기존 결정, 새 요청과의 차이 |
| [01 사업 목표와 범위](docs/plans/01-product-scope.md) | 단계별 범위, 이용자, 요구사항 ID |
| [02 화면과 고객 여정](docs/plans/02-information-architecture.md) | 사이트맵, 페이지 구성, 모바일 흐름 |
| [03 기술 구조와 배포](docs/plans/03-architecture-and-deployment.md) | Next.js, Supabase, Vercel, Docker 역할 |
| [04 데이터와 권한](docs/plans/04-data-model-and-access.md) | 테이블, 상태, 원장, 데이터 접근 |
| [05 자동견적과 예약](docs/plans/05-quote-ai-booking.md) | 정찰제, 사진 분석, 승인, 일정, 변경견적 |
| [06 쇼핑몰과 재고](docs/plans/06-commerce-and-inventory.md) | 키트, 김치, 결제, 배송, 반품 |
| [07 자동화와 운영](docs/plans/07-automation-and-operations.md) | 이메일, 인보이스, 장애 복구, 관리자 SOP |
| [08 보안과 호주 운영 조건](docs/plans/08-security-and-compliance.md) | 고객 사진, 개인정보, 계약, 식품 판매 조건 |
| [09 테스트와 출시 검증](docs/plans/09-test-and-qa.md) | 테스트 시나리오, AI 평가, UAT, 출시 기준 |
| [10 일정과 비용](docs/plans/10-roadmap-budget-risks.md) | 인력, 의존성, 공수, 운영비, 위험 |
| [11 서비스 마케팅](docs/plans/11-marketing-and-growth.md) | 고객군, SEO, 광고, 콘텐츠, 90일 실행 |
| [12 개발 백로그](docs/plans/12-implementation-backlog.md) | 구현 순서, 완료 기준, 담당 역할 |
| [13 모델과 개발 운영](docs/plans/13-ai-development-workflow.md) | 사용자 모델·effort 선택과 개발 검증 기준 |
| [14 결정과 출처](docs/plans/14-decisions-and-sources.md) | 확정·제안·미정 구분과 공식 근거 |
| [15 우선 제작 TODO](docs/plans/15-home-cabinet-admin-todo.md) | 메인·Cabinet·관리 웹의 착수 순서 |
| [16 웹 매출배분 계약 검토](docs/plans/16-revenue-share-contract-review.md) | 내부 사업성 분석, 회수 예시, 웹 귀속·보수·IP 협상 |
| [17 메인 프로토타입·디자인](docs/plans/17-home-prototype-design-plan.md) | 구현 범위, DDD 조립, 디자인 초안, SEO·QA 기준 |
| [18 KCP 상세 프로토타입](docs/plans/18-kcp-page-prototype.md) | 6개 서비스 카테고리, 메인 연결, Free Quote 표시, 후속 견적·AI·예약 흐름 |
| [19 KCP SEO·지역 콘텐츠](docs/plans/19-kcp-seo-content-and-service-area.md) | Google Maps 지역 조사, 10km 반경, 임시 회사 정보 표시·교체 기준 |
| [20 승인 디자인·스크롤 스토리 구현](docs/plans/20-scroll-storytelling-implementation-plan.md) | 최초 계획과 최신 KCP 상세 전용 범위, 자산·재사용·SEO·검수 |
| [21 글로벌 디자인 시스템](docs/plans/21-global-design-system.md) | 공통 색상·서체·크기·굵기·여백·버튼·모션 토큰과 적용 규칙 |
| [22 KCP 전체 화면 공정](docs/plans/22-cinematic-cabinet-story.md) | 메인 프로토타입 유지, KCP Hero·공정 우선 배치·사진 레이어·표현 한계 |
| [23 정면 캐비넷 깊이 연출](docs/plans/23-front-cabinet-depth-story.md) | Concept 2 공정 사진, 6개 도어·원본 배경 합성·절제된 입체 움직임 |
| [24 시네마틱 WebGL 공정](docs/plans/24-cinematic-kitchen-webgl.md) | 실제 3D 9단계 공정, 전후 비교, 색상·광택, 정적 대체와 최신 검증 |
| [25 KCP 견적부터 결제까지](docs/plans/25-kcp-quote-to-booking-implementation.md) | P0~P8 순차 구현, AI·가격·예약 요청/확정·회사 duration·청구/결제, 선행 조건과 KQ 검증 |
| [26 KCP P0 계약·재사용](docs/plans/26-kcp-p0-contracts-and-reuse.md) | Coatly 실제 소스 검토, 입력·상태·DB/권한·API 계약, 이식 전 수정과 운영 결정 |
| [27 Google Calendar 연동](docs/plans/27-kcp-google-calendar-sync.md) | 양방향 검증 후 확정, 시간/기간·발행/납기 자동 설정, 동기화·충돌·GC 검증 |
| [28 Gmail 문의·Calendar 구현](docs/plans/28-gmail-enquiry-calendar-implementation.md) | 로컬 요청 저장·관리, Gmail 라벨 수집, Calendar 변경 검토, 회사 OAuth 최초 설정 |
| [29 회사 OAuth 실연동 검증 계획](docs/plans/29-google-oauth-live-verification-plan.md) | Google 설정·Gmail 수집·Calendar 왕복·자동 수집·재연결·사용 전환 순서와 완료 기준 |
| [30 회사 Supabase 저장소 연결](docs/plans/30-supabase-storage-integration.md) | 지정 프로젝트·환경변수·비공개 테이블/RPC·저장소 선택·실연결 검증 |
| [31 Google 연동 복구·자동 수집](docs/plans/31-google-integration-recovery-and-operation-plan.md) | 10월 2일 OAuth 상태·재연결·worker 중단 복구·남은 예외·DB 점검·운영 전환 계획 |
| [32 고객 견적·서명·제출](docs/plans/32-client-quote-signature-submission.md) | 고객 선저장·approve·예약일 차단·서명 제출·메일→Calendar·회사 최종 확정 계약 |
| [33 관리자 검토·회사 일정 확정](docs/plans/33-admin-booking-confirmation-day-plan.md) | 10월 3일 제출 검토·수동 기간·재동의·충돌 방지·데모 확정·PDF의 구현 순서와 검증 기준 |
| [34 Google 주소 자동완성](docs/plans/34-google-address-autocomplete.md) | 전체 주소 입력 검색/선택, 수동 입력 대체, 결제·키 설정과 실제 연결 검증 |
| [35 예약·터치 서명·비공개 사진](docs/plans/35-mobile-booking-private-photo-plan.md) | 10월 4일 예약/서명 보강과 비공개 사진·불변 제출 구현, 실제 연결/격리 검증과 남은 기기 의존성 |
| [36 두 손상 사진으로 Quote 마무리](docs/plans/36-quote-damage-demo-completion-plan.md) | 지정 사진 2장·저장/서명/제출·EMS 고객 연결·회사 제안/재서명/확정·메일/Calendar의 순차 인수 계획 |
| [37 실제 Quote·EMS·예약](docs/plans/37-live-quote-ems-booking-implementation.md) | 운영 요청 저장부터 고객 확인·예약까지의 RQ 순서 |
| [38 사진 AI 예상 견적](docs/plans/38-ai-photo-estimate-and-ems-plan.md) | 5개 촬영 범주·AI 관찰·EMS 저장·운영 분석 실행과 남은 인수 |
| [39 Sydney 초기 가격 v1](docs/plans/39-sydney-cabinet-pricing-v1.md) | 기존 단가와 v1 검증 기록 |
| [40 AI 수량 추정 가견적](docs/plans/40-ai-quantity-provisional-estimates.md) | 현행 AI 추정 수량·기준 사진 범위·잠정 금액·현장 조정·v2 계약 |
| [41 회사 도메인·운영 Quote 흐름](docs/plans/41-domain-live-quote-booking-plan.md) | 회사 도메인·인증/복구부터 운영 예약까지의 연결 순서 |
| [42 실제 예약 요청·Calendar](docs/plans/42-live-estimate-booking-request-calendar.md) | 예상본 승인·희망일·예약 요청 확인 서명·고정 발송·확정 대기 일정 |
| [43 EMS 확정 예약·Calendar](docs/plans/43-ems-confirmed-booking-calendar.md) | 회사 금액/실제 기간·별도 고객 확인·원자 점유·확정 Google 일정·고객 차단·대사 |

클라이언트 전달본은 [Word 구현계획서](deliverables/LK_Group_Client_Implementation_Plan_KO.docx)이며, 편집 가능한 원문은 [클라이언트 제안서 Markdown](docs/client-proposal.md)이다. 기술 기준은 위 개발 문서가 원본이며, 클라이언트 문서를 변경할 때 관련 개발 문서도 함께 갱신한다. 문서 자체의 확인 결과는 [검증 기록](docs/document-validation.md)에 정리했다.

기존 `deliverables/LK_Group_Planning_Package.zip`은 이번 수정 전 보관본이다. 최신 제안서는 위 Word와 Markdown을 사용한다. 내부 계약 분석 문서는 클라이언트 전달 패키지에 자동으로 포함하지 않는다.

## 계획의 사용 기준

- 일정·가격·전환율은 사업 자료가 없는 상태에서 세운 **계획 가정**이다. 승인된 계약금액, 견적 단가 또는 실적이 아니다.
- 고객용 영어 사이트를 우선하고 한국어 콘텐츠를 다음 단계에서 추가하는 안이다. 브랜드명과 법인·ABN·GST 등록 상태는 착수 단계에서 확인한다.
- 최신 회사 제공 서비스 지역은 **Ermington 중심 10km + Inner West Sydney 및 명시된 21개 suburb**다. 목록의 모든 지역이 10km 안에 있다는 뜻은 아니며 실제 주소별 가능 여부는 회사에 확인한다. [회사 답변](docs/reference-assets/company-brief.md)이 이전 15km 가정과 지도 후보 목록보다 우선한다. 식품 배송 범위는 별도다.
- Kitchen Cabinet Painting 사진 예상 견적은 승인된 [39번 초기 가격 v1](docs/plans/39-sydney-cabinet-pricing-v1.md)을 적용한다. 그 밖의 미확정 판매가격과 산식 설명용 예시는 운영값으로 사용하지 않는다.
- 기존 산출물은 계획서와 작업 설정이며, 2026-09-27 로컬 Next.js 메인 프로토타입 개발 요청이 추가됐다. 회사 DB는 2026-10-01 지정 프로젝트 연결 요청을 따라 진행하고, 앱 배포는 별도 승인 후 진행하며 결제 계정 개설·광고 집행은 이번 범위에 포함하지 않는다.

## 첫 착수 회의 산출물

대표가 승인할 항목은 판매 사업자와 서비스 자격, 초기 서비스 목록, 정찰제 포함 범위, 서비스 중심 주소, 키트 SKU, 김치 제조·배송 방법, 목표 예산, 출시 담당자다. 이 자료를 [결정표](docs/plans/14-decisions-and-sources.md)에 기록하면 개발 백로그의 준비 단계부터 시작할 수 있다.

## 다른 기기에서 작업 이어가기

저장소는 [lnkgroupsydney-hub/lnkgroup](https://github.com/lnkgroupsydney-hub/lnkgroup)이다. 새 기기에서 `git clone https://github.com/lnkgroupsydney-hub/lnkgroup.git`으로 내려받고 해당 폴더를 Codex 프로젝트로 연다. 작업 시작 전 `git pull --ff-only`, 종료 후 커밋과 `git push`로 변경 사항을 주고받는다.

맥북 최초 설정, GitHub 인증, 기기를 바꿀 때의 순서와 문서 도구의 실행 조건은 [다른 기기에서 작업 이어가기](docs/device-setup.md)를 참조한다.
