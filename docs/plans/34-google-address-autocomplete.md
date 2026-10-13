# Google 주소 자동완성 — 전체 주소 입력 공통 적용

2026-10-03 · Australia/Sydney · 사용자 요청: 모든 주소 입력에서 일부 입력 → 후보 제시 → 선택

[전체 고객 흐름](32-client-quote-signature-submission.md) · [TODO](15-home-cabinet-admin-todo.md)

**2026-10-04 상태 갱신:** 사용자가 Google 결제를 요청했고 진행 중이라고 알렸다. 결제 활성·API 키 준비 완료를 확인한 상태는 아니다. 실제 주소 연결은 완료 통보 뒤 재개하며, 그동안 [35번 예약·터치 서명 검증과 비공개 사진 계획](35-mobile-booking-private-photo-plan.md)을 진행한다. 아래 10월 3일의 코드 완료·실제 검색 보류 기록은 유지한다.

**2026-10-13 현재 갱신:** [견적 원페이지 UI 개선](46-quote-one-page-ui.md)에서 운영 Quote의 3개와 EMS 고객 단일 주소를 포함해 현재 **10개 주소 입력**을 공통 자동완성으로 연결했다. AU 전체 주소 문자열 변환과 기존 수동 저장을 보존한다. 사용자 확인으로 회사 API 키·결제 준비가 아직 필요하며 실제 Google 검색은 미실행이다. 아래 10월 3~4일 기록은 당시 상태로 유지한다.

## 적용 범위와 동작

- 현재 실제 주소 입력은 `QuoteDraftForm`과 기존 `EnquiryForm`의 site address·suburb·postcode 총 6곳이다. 관리자 주소는 읽기 전용이므로 새 편집 화면을 만들지 않는다.
- 공통 입력 컴포넌트에서 Google Places (New) 후보를 표시한다. 주소 선택 시 거리 주소·지역명·우편번호를 한 번에 반영하고 기존 저장·초안 복원·수정 감지 경로를 그대로 사용한다.
- 호주 주소를 대상으로 Sydney 주변을 우선 검색하되 회사 서비스 가능 여부를 자동 확정하거나 10km 밖 주소를 거절하지 않는다.
- 지역/우편번호를 바꿀 때 이전 거리 주소를 새 지역과 섞지 않는다. Google이 누락한 값은 확인·직접 입력하게 하며 임의 값을 만들지 않는다. 유닛/아파트 번호도 확인·수정할 수 있게 유지한다.
- 키 미설정·네트워크/Google 오류·결과 없음에도 수동 입력과 저장을 사용할 수 있다. 자동완성 성공을 주소 실재 검증·시공 가능 판정으로 표시하지 않는다.

## 구현 순서

1. `codex/google-address-autocomplete` 브랜치에서 주소 입력 전수 확인과 회사 Cloud의 API/키/결제 상태 확인.
2. `src/shared/address`에 Places New 브라우저 어댑터와 호주 주소 변환·선택 병합 규칙 구현. 업무 모듈·DB에 의존하지 않음.
3. 공통 combobox와 두 입력 폼 연결. 입력 지연 처리, 세션 토큰, 오래된 검색/선택 응답 폐기, IME·키보드·모바일 처리를 포함.
4. `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` 설정과 회사 프로젝트의 API·웹사이트 제한 확인 후 실제 주소 검색·선택·저장/복원 검증.
5. 관련 자동 검사·lint·타입·빌드와 브라우저 결과를 구분하여 기록. 확인용 스크린샷·비밀키는 Git에 저장하지 않음.

## Google 설정

- 회사 계정 `lnkgroupsydney@gmail.com`, 기존 Cloud 프로젝트 `lnkgroup`을 사용한다. Google Calendar/Gmail OAuth 키는 주소 검색 키가 아니다.
- Maps JavaScript API와 Places API (New)가 필요하다. 10월 3일 회사 Console 읽기에서 Maps JavaScript API는 사용 설정되어 있고 API 키 목록은 비어 있었다. 사용 설정 목록에 Places API (New)는 없었으며 프로젝트 결제는 비활성화되어 있었다.
- 사용자는 **결제 등록은 나중에 하고 지금은 코드 구현까지만 진행**하도록 확정했다. 이번 작업에서 새 키·결제 계정 생성, API 활성화, 실제 유료 검색을 진행하지 않는다. 코드·대체 공급자/화면 검증과 실제 Google 검색 완료를 구분한다.
- 브라우저용 키를 `.env.local`의 `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`에 저장한다. 이 키는 브라우저 요청에 보이므로 숨김으로 보호하는 대신 웹사이트 referrer와 API 제한을 적용한다. OAuth secret·Supabase secret을 이 변수에 넣지 않는다.
- 현재 허용 referrer: `http://127.0.0.1:3002/*`, `http://localhost:3002/*`. 운영 도메인은 승인 후 별도 추가한다. API 제한은 Maps JavaScript API·Places API (New) 두 가지로 좁힌다.
- 새 결제 계정·결제 수단·유료 약정은 사용자가 직접 설정한다. API 키 생성 등 브라우저가 확인을 요구하는 작업은 구체적인 제한 조건을 준비한 뒤 확인받는다. 기존 Calendar/Gmail OAuth 범위는 변경하지 않는다.
- `NEXT_PUBLIC_` 키 변경 후 재빌드/재시작한다. 검색은 사용자가 주소 입력을 시작할 때만 로드하고 최소 글자 수·debounce·검색 세션 단위 토큰·필요한 주소 필드만 조회하여 불필요한 호출을 줄인다. 무료 사용이나 비용 상한을 보장하지 않는다.

## 데이터·표시

- 입력한 검색어는 Google에 전송된다. 입력 근처에 이를 짧게 알리고 후보 패널에 Google Maps 출처를 표시한다.
- Google 후보 목록·전체 응답을 DB/로그에 보관하지 않는다. 사용자가 선택하고 확인한 주소 텍스트만 기존 비공개 고객/문의 저장 경로로 저장한다. 별도 공개 주소 테이블이나 원격 schema 변경은 필요하지 않다.
- 공개 배포 전 사이트 이용약관/개인정보 안내와 Google Maps 정책 요건을 확인한다. 데모 계약 약관을 운영 개인정보 정책으로 간주하지 않는다.

## 검증 기준

- 호주 일반 주소·유닛·지역명 fallback·누락된 우편번호·다른 국가·지역 변경 시 오래된 주소 제거를 검사한다.
- 검색 AU 제한·필드 최소화·세션 토큰 재사용/선택 후 교체·응답 순서 역전과 선택 중 입력 변경을 검사한다.
- 실제 회사 브라우저에서 일부 주소 입력, 키보드/포인터 선택, 세 항목 자동 채움, 직접 수정, 새로고침 후 저장값 복원을 확인한다. 기존 서명 제출은 수정하지 않는다.
- 320px 화면의 후보 목록, 오류/결과 없음, 미설정 키 상태의 수동 입력과 기존 예약·메일·Calendar 회귀를 확인한다.

## 공식 근거

- [Places New autocomplete data](https://developers.google.com/maps/documentation/javascript/place-autocomplete-data)
- [Maps JavaScript API 설정](https://developers.google.com/maps/documentation/javascript/get-api-key)
- [사용량·결제](https://developers.google.com/maps/documentation/javascript/usage-and-billing)
- [Google Maps attribution 및 정책](https://developers.google.com/maps/documentation/javascript/policies)

구현·실연동 완료 표시는 실제 검증 결과를 확인한 뒤 TODO와 검증 기록에 반영한다.
