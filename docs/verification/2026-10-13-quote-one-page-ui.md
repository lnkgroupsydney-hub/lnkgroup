# 견적 원페이지 UI 검증

2026-10-13 · Australia/Sydney · `codex/quote-one-page-ux-20261013`

## 실행 범위

운영 배포가 아닌 로컬 production build 서버 `http://127.0.0.1:3002`와 독립 fixture `http://127.0.0.1:3017`에서 실행했다. Playwright와 격리된 headless Google Chrome 프로필을 사용했으며 실제 사용자 브라우저 프로필을 열지 않았다. 동작 줄이기 설정을 적용했다.

연락처·서비스 저장/읽기는 기존 Quote Request HTTP API → application → 모든 migration을 적용한 **로컬 PGlite DB**를 사용한다. 고객 인증·사진·분석·예약·영수증 응답은 시험용 overlay다. 분석·가격·예약 상태·review·서명은 기존 domain/client validator와 가격 계산기로 검증한 형식을 재사용한다. fixture 외 origin 요청을 차단·기록하며 최종 실행에서 외부 요청은 0건이었다. 운영 DB·실제 AI·메일·Google/Calendar 호출은 수행하지 않았다.

## 브라우저 결과

`node --experimental-strip-types scripts/verify-quote-journey-ui.mjs` **6/6 통과**, 브라우저 runtime error **0건**.

접수 완료 요약 카드·상세 접기 개선을 포함한 **최종 production build에서 6개 시나리오를 다시 실행해 모두 통과**했다. 접수 화면에서 저장된 금액·방문시간·reference가 일치하며, receipt 상세가 기본으로 접히고 펼치면 저장된 서명자를 표시한다. 상세를 다시 접은 뒤에도 고정 viewport와 영수증 다운로드가 유지된다. 아래 7개 스크린샷은 이 최종 실행으로 갱신했다.

| 시나리오 | 실행한 동작과 확인 |
| --- | --- |
| 연락처 응답 유실·서비스 저장 | 실제 DB 저장 후 첫 응답 503, 같은 idempotency key로 재시도해 요청 1개 유지. 서비스 저장 후 뒤로 이동해 연락처·주소·선택값 보존 |
| 320 × 568, 키보드·긴 내용 | 긴 프로젝트 메모 저장/복원, Tab 이동. 문서 세로 스크롤 0·화면 높이 유지·가로 넘침 없음·표시되는 단계 1개 |
| 409·고객 접근 종료 | 충돌 전 미저장 이름 보존, 최신값 명시적 복구. 접근 401 후 비공개 작성/서명 화면 제거 |
| 분석 상태·복구 | queued/running 처리 중 분석 중복 실행 차단, stale 서명 진입 차단, failed/uncertain 상태와 저장 상태 확인·사진 유지. 분석 없음/실패 시 팀 검토 패널은 열리며 숫자 견적 없는 방문일 선택은 차단 |
| 숨은 패널의 늦은 조회 | 사진 분석 GET를 지연하고 연락처 화면에서 이름 편집. 늦은 snapshot 수신 후 미저장 이름 유지, dirty 상태에서 분석 단계 이동 차단 |
| 393 × 852 전체 흐름 | 사진 분석 → 예상 금액 → 방문일 → 이메일 인증 후 같은 방문일 자동 복귀 → 최초 예약 읽기 503에서 탐색 잠금 해제·조회 복구 → 날짜/시간 → 서명 → 제출 → 접수증 |

마지막 시나리오에는 다음 회귀 검사를 함께 실행했다.

- 서명 화면에서 이름·동의와 키보드로 그린 획을 입력한 뒤 방문시간을 변경하면 이름·동의·획이 초기화된다.
- 활성 서명 review proof가 만료되면 방문일로 돌아간다. 서명 패널이 숨겨진 동안 만료되면 현재 예상 금액 화면을 유지한다. review는 저장된 selection revision에 연결한다.
- 제출이 저장된 뒤 첫 응답만 503으로 유실되면 `Retry same request`가 동일한 body로 재시도한다. 저장된 typed 서명과 변경한 시간을 유지한다.
- 새로고침 후 접수 완료 단계 6과 고정 viewport를 복원한다. 서명 입력을 다시 표시하지 않는다.
- 영수증 다운로드 동작과 `REQUEST-SYNTHETIC.pdf` 파일명을 확인했다. 시험용 PDF bytes이므로 실제 영수증 생성·내용·레이아웃 검증은 이 브라우저 결과에 포함하지 않는다.

## 관련 자동 검사

- `node --experimental-strip-types --test src/shared/address/address.test.mts`: **18/18 통과**. AU 주소 parsing·세션/오래된 응답과 단일 고객 주소 변환을 확인했다.
- `node --experimental-strip-types --test scripts/verify-live-quote-fixture.test.mjs`: **2/2 통과**. 기존 첫 test에 reset 성공 200·빈 DB·오류 flags 초기화·다음 독립 저장 성공 assertions를 추가했다. test 수는 늘리지 않았다.
- 변경한 주소·고객 UI와 세 fixture script의 ESLint 통과.
- 주 에이전트가 실행한 전체 operations suite **733/733**, lint·typecheck·production build 통과. 이후 fixture reset 확장에는 위 관련 2개 검사와 브라우저 6개를 실행했다.

fixture reset에 새 사진/예약 FK 테이블이 포함되도록 `TRUNCATE … CASCADE`를 적용했다. 이 DB는 `createLiveQuoteFixture`가 메모리에 만드는 로컬 합성 시험 DB이며 운영 DB를 연결하거나 초기화하지 않는다. 매 브라우저 시나리오 시작 시 reset HTTP 성공을 확인해 이전 시나리오의 401/503/409 flags가 누적되지 않게 한다.

초기 개발 서버 proxy에서는 client hydration이 시작되지 않아 인수를 완료하지 못했다. 별도 production build/start로 전환한 최종 실행에서 전체 흐름을 검증했다. 분석 fixture의 schema version 누락과 초기 booking fault를 취소된 중복 GET가 소비하는 시험 코드 문제를 수정했다. 최종 503 fixture는 명시적 recovery 전까지 실패를 유지한다.

## 화면 증거

가상 자료를 사용해 로컬 `/tmp`에 저장했다. 저장소에 원본 고객 사진이나 검증 화면을 추가하지 않았다.

- `/tmp/quote-one-page-desktop.png` — 1280 × 800 고객 정보
- `/tmp/quote-one-page-mobile.png` — 320 × 568 긴 메모
- `/tmp/quote-one-page-photos.png` — 사진/분석 완료
- `/tmp/quote-one-page-estimate.png` — 예상 금액
- `/tmp/quote-one-page-date.png` — 방문일/시간
- `/tmp/quote-one-page-sign.png` — 검토·서명
- `/tmp/quote-one-page-complete.png` — 접수 완료 복원

## Google 주소와 남은 확인

Quote·draft·enquiry의 주소 3개씩과 EMS 고객 단일 주소 1개, 총 **10개 입력**이 공통 Google Places (New) 자동완성에 연결됐다. 고객의 단일 텍스트 주소 저장 규칙을 유지하며 선택한 street/unit·suburb·state/postcode를 한 문자열로 변환한다. 조회 전 검색어가 Google로 전송됨을 안내하고 수동 입력을 보존한다.

`.env.local`·예시 env·process에서 `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`의 **존재 boolean만 확인**했으며 설정되지 않았다. 사용자가 회사 API 키·결제 준비가 필요함을 확인했다. **실제 Google dropdown 검색/선택은 미실행**이다. 회사 Google Cloud의 Maps JavaScript API·Places API (New)·결제, 회사/로컬 referrer 및 API 제한을 갖춘 browser key, 해당 NEXT_PUBLIC env 설정 후 재빌드/재시작과 실제 선택 인수가 필요하다. 개인 계정 연결·Cloud 리소스 생성·결제 약정은 수행하지 않았다.

현재 Google 공식 [Autocomplete Data API](https://developers.google.com/maps/documentation/javascript/place-autocomplete-data), [API reference](https://developers.google.com/maps/documentation/javascript/reference/autocomplete-data), [정책](https://developers.google.com/maps/documentation/javascript/policies)을 확인했다. 실제 Google 오류/권한·Chrome 외 브라우저·모바일 실기기 키보드·실제 사진 업로드/AI·이메일 배달/Calendar·운영 영수증은 이번 합성 인수 범위 밖이다. commit·push·merge·운영 배포는 수행하지 않았다.
