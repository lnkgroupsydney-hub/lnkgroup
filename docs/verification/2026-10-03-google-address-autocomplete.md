# 주소 자동완성 코드·격리 검증

2026-10-03 · Australia/Sydney · `codex/google-address-autocomplete`

[계획과 설정 방법](../plans/34-google-address-autocomplete.md) · [TODO](../plans/15-home-cabinet-admin-todo.md)

## 구현

- 현재 주소 입력 6곳(견적 초안과 기존 문의 폼의 street·suburb·postcode)을 `AddressAutocompleteInput`으로 연결했다. 주소 선택은 세 필드와 오류 상태를 함께 갱신하고 기존 저장·revision·초안 복원 로직을 사용한다.
- Places New adapter는 AU 필터·지역별 타입·Sydney권 soft bias·최소 주소 필드·검색별 세션 토큰을 사용한다. 주소/지역명 3자, 우편번호 2자와 300ms 입력 지연 뒤 검색한다. 지도 렌더·사용자 GPS 요청·추가 OAuth 범위는 없다.
- 오래된 검색/상세 응답, blur/unmount/직접 수정·다른 주소 항목 변경 후 응답을 무시한다. 오류·키 미설정·결과 없음에는 직접 입력을 유지한다. 키보드 combobox·IME 처리·포인터 선택·Google Maps 출처와 검색어 전송 안내를 포함했다.
- 지역명·우편번호 새 선택은 이전 street를 비우고 응답에 없는 값을 추측하지 않는다. 입력값이 이미 수정된 뒤 같은 지역이라고 오판하는 오류를 검토 중 수정했다. 동일 거리 주소의 기존 unit만 보존하고 사용자가 상세 주소를 확인·수정하도록 안내한다.
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` 환경변수 예시와 설정 방법을 추가했다. 실제 키/결제는 설정하지 않았다. DB schema 변경은 없다.

## 자동 검사

- `npm run test:operations`: 기존 164개 + 주소 관련 16개, **180/180 통과**, 실패/skip 0.
- 주소 검사: 호주 주소·unit·postcode·지역명 fallback·누락/다른 국가, 잘못된 이전 주소 혼합, 검색 필터·최소 필드·토큰 교체, 응답 순서 역전·선택 중 수정·실패/timeout·무키·단일 script/auth 실패를 대체 공급자로 확인했다.
- `npm run check`: lint·TypeScript·Next.js production build 통과. 임시 QA 페이지 삭제 후 남은 `.next/dev/types`의 생성 파일 때문에 첫 타입 검사가 실패했다. 해당 개발용 생성 캐시만 제거하고 같은 전체 검사를 다시 실행해 통과했다. 소스 검사·테스트는 삭제/비활성화하지 않았다.
- `git diff --check`와 신규 파일별 whitespace 검사 통과.

## 회사 Chrome 실제 컴포넌트 검증

`Kang (L&K Group)` 회사 Chrome만 사용했다. 잠깐 만든 로컬 `/address-qa` 페이지에 **실제 공통 입력 컴포넌트 + 가상 Places 응답**을 넣어 검증했다. 이는 실제 Google 주소 조회나 실제 고객 제출 검증이 아니다. fixture는 DB/이메일/Calendar를 호출하지 않았다.

| 확인 | 관찰 결과 |
| --- | --- |
| 일부 주소 입력·키보드 선택 | 가상 후보 2개 표시, ↓+Enter로 2번째 선택 후 street·Ermington·2115 일괄 채움. 폼 제출 횟수 0 유지 |
| 우편번호 2자 검색 | `21`에서 후보 표시. 다른 우편번호 선택 시 Parramatta·2150으로 변경하고 이전 거리 주소는 비움 |
| 공급자 오류·결과 없음 | `error`/`none` 가상 응답에 맞는 안내. 입력 텍스트와 수동 편집 유지 |
| 늦은 상세 응답 | 1.5초 지연 선택 직후 `Manual newer address`로 편집·Tab 이동. 늦은 응답이 새 텍스트를 덮어쓰지 않음 |
| 320×844 화면 | 후보 줄바꿈·패널 폭과 Google Maps 출처 확인, 두 번째 후보 포인터 선택 후 세 필드 정상 반영. 실제 휴대폰 테스트는 아님 |
| 키 미설정 | 실제 무키 환경으로 로컬 서버 재시작. 수동 주소·지역·우편번호 입력 후 테스트 폼 제출 횟수 1, 가상 검색/상세 요청 수 각각 0 |

검증 후 화면 크기·DevTools를 복원하고 임시 탭/서버를 종료했다. fixture 소스는 삭제했으며 production build에 포함하지 않는다. 확인용 스크린샷은 저장하지 않았다. 개발용 fixture 콘솔의 폰트 preload 경고와 React/HMR 안내는 실제 기능 오류와 구분하며 콘솔 메시지 0이라고 보고하지 않는다.

## 실제 Google 연결은 보류

회사 Console의 `lnkgroupsydney@gmail.com` / `lnkgroup`에서 Maps JavaScript API 활성, API 키 없음, Places API (New) 사용 설정 목록에 없음, 프로젝트 결제 비활성을 읽기 전용으로 확인했다. 사용자는 **“결제 나중에 등록할게” / “지금은 코드 구현까지만 진행”**으로 범위를 확정했다.

따라서 새 키·결제 계정 생성이나 유료 검색은 진행하지 않았다. 회사 결제 연결·Places 활성화·웹사이트/API 제한된 키 입력 후 재빌드하여 실제 주소 후보/선택/저장·복원을 검증해야 한다. 이번 가상 응답 시험을 Google 실연동 완료로 대신하지 않는다.

## 최종 확인

전체 자동 검사 180개·lint·타입·production build와 신규 파일 포함 whitespace 검사를 통과했다. 임시 `/address-qa` 소스·개발 서버·가상 키 환경은 제거했다. 실제 API 키가 없는 `.env.local` 설정으로 로컬 앱 `127.0.0.1:3002`를 재시작했고 견적 페이지 HTTP 200·삭제한 QA 페이지 HTTP 404를 확인했다. 기존 반복 worker·회사 DB 데이터·서명 제출은 이번 검증에서 변경하지 않았다. 변경은 `codex/google-address-autocomplete` 작업 브랜치에서 관리한다.
