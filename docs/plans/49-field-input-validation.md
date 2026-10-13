# 항목별 입력 검증

2026-10-13 · Australia/Sydney · 착수 브랜치 `codex/quote-one-page-ux-20261013`

견적 원페이지 UI에 이어 모든 작성 입력의 타입·형식·범위를 해당 항목에 맞게 검증한다. 새 의존성이나 운영 DB migration은 추가하지 않는다.

## 공통 정책

- 이메일은 단일 주소, 최대 254자와 local/domain 문법을 검증한다. 이메일 존재·소유 확인은 기존 OTP 인증이 담당한다.
- 전화는 호주 일반전화·휴대폰·사업용 대표번호를 허용한다. 국내 표기와 `+61`/`0061` 국제 표기, 공백·괄호·하이픈은 허용하되 외국 국가코드·문자·내선은 거부한다. 입력한 저장 표기는 유지한다.
- 우편번호는 네 자리 문자열로 다뤄 `0800` 같은 선행 0을 유지한다. 문·서랍 수량은 빈값 또는 0~500 정수다. 지수·소수·음수를 숫자로 바꾸어 저장하지 않는다.
- 이름·주소·suburb는 Unicode와 아포스트로피·하이픈·unit 슬래시·회사명의 숫자를 허용하고 글자가 포함되어야 한다. Google 선택이나 street number를 필수로 만들지 않는다. 주소 존재 여부는 Google 키 준비 후 실제 선택 인수와 구분한다.
- 단일 줄 텍스트와 여러 줄 설명을 구분한다. 설명에는 줄바꿈·Tab을 허용하며 제어문자·HTML 태그는 거부한다. 문장의 비교 기호 자체를 제거하지 않는다. 길이는 기존 항목별 계약을 따른다.
- 비밀번호는 원문과 기존 길이 제한을 유지한다. 인증번호는 정확한 숫자 문자열을 검사하고 선행 0을 유지한다.
- 금액·작업 기간·서명은 기존 업무 validator의 상한·센트·Sydney 시간/DST·확인 조건을 유지한다. 고객 연결 사유는 DB와 같은 한 줄/500자 계약을 따른다.

전화 체계는 [ACMA](https://www.acma.gov.au/choose-your-phone-number)와 [호주 정부 표기 지침](https://www.stylemanual.gov.au/grammar-punctuation-and-conventions/numbers-and-measurements/telephone-numbers), 브라우저 제약은 [MDN 입력 검증](https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Constraint_validation)을 확인했다.

## 화면·저장 경계

`ValidatedInput`·`ValidatedTextarea`와 주소 공통 입력은 blur·다음·저장 시 오류를 입력 옆에 표시하고 접근성 속성을 연결한다. 버튼 제출과 `noValidate` 경로도 해당 섹션을 검사한다. 잘못된 입력은 저장 요청과 재시도 snapshot을 생성하기 전에 차단한다. 값·붙여넣기·IME 조합을 임의로 제거하거나 다른 유효값으로 바꾸지 않는다.

기존 저장본을 읽는 parser와 새 작성 validator를 분리한다. 과거 입력을 복원하는 기능은 유지하고 변경 저장에는 새 정책을 적용한다. 이전 단계에 오류가 있으면 그 단계를 열고 첫 오류로 이동한다. 이미 결과가 불명확한 요청의 정확한 payload·idempotency key는 그대로 재시도한다.

운영 DB·메일·Google/AI 호출 없이 자동 검사와 로컬 fixture 브라우저로 확인한다. 전체 746개·공개 브라우저 11개·관리자 브라우저 3개와 lint·타입·build가 통과했다. [검증 기록](../verification/2026-10-13-field-input-validation.md)에 실제 실행 범위와 공유 작업트리 상태를 구분했다.
