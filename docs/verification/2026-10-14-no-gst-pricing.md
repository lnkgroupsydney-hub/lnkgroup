# 신규 A$1,450·GST 미부과 검증

2026-10-14 · Australia/Sydney · [53번 결정·적용 순서](../plans/53-new-quote-no-gst-pricing.md)

## 결과와 범위

신규 요청은 가격 v3로 고정하며 최소 도장비 A$1,450·GST 0을 계산한다. 기존 문·서랍·해당 도막 보수 단가는 유지하므로 큰 작업은 시작가보다 높을 수 있다. 화면·서명·접수·EMS·신규 메일/PDF에 `No GST charged. The supplier is not registered for GST.` 또는 짧은 `No GST charged`를 표시한다. 현장 확인 전 가견적의 성격은 유지한다.

기존 요청의 가격 정책, 분석/입력 스냅샷, 서명·예약 원본, 감사 및 동결 문서 보존을 구현했다. 기존 요청은 재분석해도 이전 v2 정책을 사용한다. 기존 v1/v2 표시와 별도 회사 제안 경로의 과거 GST 계산은 유지한다. **운영 DB migration·배포·실제 메일 발송·AI 호출·Google Calendar 변경·커밋/푸시는 수행하지 않았다.**

## 실행한 검사

| 검사 | 결과 |
|---|---|
| 전체 업무 시험 `npm run test:operations` | 773/773 통과 |
| ESLint `npm run lint` | 통과 |
| 타입 검사 `npm run typecheck` | 통과 |
| 최종 production build `npm run build` | 통과 |
| 변경 공백 검사 `git diff --check` | 통과 |
| Impeccable 표시 대상 정적 점검 | 결과 `[]`; React Best Practices 관련 props·파생 표시·모듈 경계 검토도 완료 |
| 실제 Next 화면 브라우저 시험 | 8/8 시나리오·44개 레이아웃 측정 통과; 콘솔/page 오류·외부 요청 0 |
| PDF/메일 | 신규·과거 4종 생성/검증, 각 2쪽 전부 렌더링·시각 검토 |

최초 전체 검사에서 신규 PDF의 Buffer/Uint8Array 비교 형식 차이와 과거 가격 시험의 현행 계산기 사용을 발견했다. 바이트 자료형을 맞추고 과거 v2·신규 v3를 각각 검사하도록 시험 데이터를 정리한 뒤 773/773을 다시 확인했다. 실패한 검사를 삭제하거나 제외하지 않았다.

## 기존 기록·계산·변조 검증

`pricing-v3-db.test.mts`는 모든 migration 이전 상태에 과거 요청·사진·분석 작업·서명 접수본을 만들고 새 migration을 적용했다. 요청에 새로 추가되는 NULL 가격 열을 제외한 기존 8개 테이블의 전체 행 해시가 동일했다. 이후 과거 진행 중 v1/v2 분석 완료, 이전 요청의 v2 재분석, 신규 요청의 v3 분석, 다른 소유자 사진 접근 거부, 정책/세금/금액 변조 거부, anon/authenticated 직접 접근 거부를 확인했다.

신규 분석 → 승인 → 방문일/시간 → 검토/서명/제출 → EMS 일정 확정 → Calendar 완료 SQL 명령을 실제 로컬 PGlite에서 실행했다. 총액 145000 cents·GST 0과 서명 원본 보존을 대조했다. Calendar 증거는 합성 입력이며 Google 제공자를 호출한 시험은 아니다. 오래된 v1 DB 완료 호환은 최신 AI runner가 오래된 prompt를 실행한다는 뜻이 아니다.

화면 parser·가격 계산·메일 단위 시험은 과거 금액 A$1,650 및 큰 작업의 새 금액 A$2,200·GST 0을 함께 확인한다. 기존 재시도의 동결 payload·중복 발송 차단 검사도 전체 시험에 포함된다.

## 화면 검증과 수정

`scripts/verify-gst-pricing-ui.mjs`를 로컬 최종 production build(3045)에 연결했다. 실제 Next 화면을 렌더링하고 견적 저장/읽기는 PGlite API로 처리했다. 사진 분석·OTP·서명/접수·회사 예약 확정 응답은 기존 validator를 통과하는 합성 fixture다. 실제 고객 자료와 외부 제공자는 사용하지 않았다.

- 신규 최소 금액: 1280·390·320px, 견적 → 방문일 → 서명 → 접수 → 새로고침 복구 → EMS 확인.
- 신규 큰 작업: 390px, 문 12·서랍 앞판 4개 A$2,200·GST 0.
- 과거 가격 v1: 390·320px 상세 분석·가격표 복구. v1은 `estimate_ready`이므로 신규 예약 흐름으로 바꾸지 않는다.
- 과거 가격 v2 + acknowledgment v2: 390px에서 원래 A$1,650·GST A$150로 전체 흐름 복구.
- 과거 가격 v2 + acknowledgment v1: 390px에서 기존 별도 회사 제안/동의·예약 화면 복구 및 원본 보존.

상세 표를 펼칠 때 모바일 문서 폭이 529px로 늘어나는 기존 결함을 발견했다. route grid의 암시적 auto 열을 `minmax(0,1fr)`로 제한했다. 기존 표의 내부 가로 스크롤은 유지했으며, 320·390px의 신규/과거 표 펼침·오른쪽 끝 이동·총액·상하단 버튼을 재검증했다. 전체 44개 측정에서 문서 폭이 viewport와 일치했다.

최종 시각 검토에서 EMS 문장 전체를 소문자로 바꾸며 `GST`도 작아지는 것을 발견해 문장용 표기를 따로 정의했다. 최종 build·lint·타입 검사 후 신규/과거 EMS 대상 2개 시나리오와 실제 스크린샷에서 `no GST charged`·`including GST`를 재확인했다. 결과 JSON은 원래 8개/44개와 해당 대상의 최신 결과를 합쳐 보존한다.

[기계 판독 결과](2026-10-14-no-gst-pricing/ui-results.json) · [신규 데스크톱](2026-10-14-no-gst-pricing/new-3-2-1280-estimate.png) · [신규 320px](2026-10-14-no-gst-pricing/new-3-2-320-estimate.png) · [서명 390px](2026-10-14-no-gst-pricing/new-3-2-390-signature.png)

## PDF·메일 검증

`scripts/verify-gst-pricing-pdf.mts`는 고정된 합성 서명 원본으로 신규/과거 접수본과 회사 확정본을 생성한다. 반복 생성의 바이트·해시·수신자/첨부 검증·개인 사진 경로 비노출·본문 텍스트를 검사했다. 각 PDF 2쪽을 PNG로 렌더링해 금액·GST 문구·줄바꿈·페이지 경계·서명/해시 정보를 시각 확인했다.

변경 직전 임시 복사본의 생성기와 동일한 과거 v2 입력을 사용해 **기존 접수·회사 확정 PDF 바이트와 전체 메일 payload가 정확히 같음**을 대조했다. 과거 접수 메일 본문은 원래 금액이 없으므로 추가하지 않았고, 첨부 PDF의 A$1,650/GST는 그대로 유지한다.

[신규 접수 PDF 예시](2026-10-14-no-gst-pricing/pdf/new-request.pdf) · [신규 확정 PDF 예시](2026-10-14-no-gst-pricing/pdf/new-confirmation.pdf) · [과거 접수 PDF](2026-10-14-no-gst-pricing/pdf/legacy-request.pdf) · [과거 확정 PDF](2026-10-14-no-gst-pricing/pdf/legacy-confirmation.pdf) · [해시/동등성 결과](2026-10-14-no-gst-pricing/pdf/result.json)

## 운영 반영에 남은 항목

1. 회사 DB에 새 migration을 적용한다. 기존 행/분석/서명/문서 backfill은 하지 않는다.
2. 동일 변경의 앱·worker를 배포한다. DB가 먼저 새 정책을 지원해야 한다. 이전 앱(v2 분석 요청)과 새 DB(v3 기본값)가 혼용되는 짧은 적용 구간은 신규 저장/분석을 제한해 조율한다.
3. 실제 신규 요청이 v3·A$1,450 시작가·GST 0으로 저장되고 실제 메일/PDF에도 일치하는지 확인한다. 기존 견적/예약 복구를 함께 대조한다.

실제 운영 DB/외부 제공자 인수와 배포는 이번 로컬 검증 결과로 완료 표시하지 않는다.
