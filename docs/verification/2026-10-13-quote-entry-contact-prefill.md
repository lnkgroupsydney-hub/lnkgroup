# 새 견적 진입과 연락처 미리 채움 검증

2026-10-13 · Australia/Sydney · 공유 작업트리 `codex/lk-group-home-ui-ux-20261013`

[51번 계획](../plans/51-quote-entry-and-contact-prefill.md)의 승인 범위를 구현한다. 첫 화면을 **Start a new quote / View quotes & bookings**로 나누고 새 견적에는 권한이 확인된 이름·이메일·전화만 채운다. 기존 견적의 업무 데이터를 변경하거나 삭제하지 않는다. 기존 작업트리의 홈·랜딩·견적·입력 검증 변경을 보존한다.

상태: 구현·로컬 production 검증 완료. 실제 운영 적용은 별도다.

## 고객 화면

- 첫 화면의 두 카드에서 새 작성 또는 기존 견적·예약 조회를 직접 선택한다. 선택 전에는 기존 요청을 자동 채택하거나 사진/예약 작업을 실행하지 않는다. 현재 선택된 견적도 목록에서 다시 열 수 있다.
- 새 견적에는 서버가 확인한 이름·이메일·호주 전화만 채운다. 주소·설명·동의·캐비넷·사진·분석·방문일·서명·이메일 인증 proof는 초기 상태다. 연락처 사전 입력을 미저장 변경으로 표시하지 않으며 **Discard changes**는 그 사전 입력값으로 돌아간다.
- 방문일 단계의 단일 이메일 인증과 이미 유효한 현재 견적 인증 재사용을 유지한다. 사진 분석 동의는 방문일 인증을 막지 않는다.
- 다른 견적을 시작할 때 연락처·서비스·선택 파일·사진 동의/촬영 범주·방문일/시간·이름/그린 서명·동의를 보호한다. 미저장 내용은 계속 작성 또는 명시적 폐기를 선택하며, 결과 불명 요청은 원 요청을 확인/재시도하기 전 새 시작·다른 ID·다른 이메일 전환을 차단한다.

## 서버와 API 보존

기존 고객 로그아웃 API에 `start-new`와 `resume-browser-draft`의 상호 배타적인 intent를 추가했다. 유효한 고객 세션으로 현재 선택 견적 또는 최근 연결 견적을 읽고 연락처 세 항목만 반환한다. 연결 견적이 없으면 검증된 이메일만 반환하며 미인증·만료 자료나 클라이언트 입력을 연락처 근거로 사용하지 않는다.

현재 선택 고객 견적 뒤에 미연결 guest 초안이 있으면 쿠키나 세션을 바꾸기 전에 409로 차단한다. **Continue this browser’s draft**의 실제 요청 ID가 일치할 때만 고객 세션을 종료하고 기존 작성 쿠키를 보존한다. 빈 guest 세션도 보존해 다른 탭의 첫 저장이 고립되는 상황을 막는다. 새 견적의 첫 저장은 revision 0에서 별도 요청 ID를 만든다.

서버 관련 **27/27** 검사를 구현자가 실행했다. 실제 migrations/PGlite에 사진·분석·고객 승인·서명 제출·접수 기록·확정 예약 구간을 넣고 전환 전후 업무 데이터 전체를 비교했다. 기존 resolve의 접근 만료시간 갱신과 업무 자료 보존을 구분한다. 일반 로그아웃·만료 복구·CSRF·잘못된 intent·위조된 복귀 ID도 확인했다.

로컬 fixture에 실제 CustomerAuth API와 quote API, 실제 쿠키 전달을 연결하고 인증 제공자만 합성했다. fixture **4/4** 검사와 실제 HTTP 왕복에서 연락처 세 항목·빈 새 세션·별도 신규 ID·기존 요청 payload/status/revision/audit 보존, 숨은 초안 차단과 정확한 ID 복귀를 확인했다. 새 DB schema나 RPC는 추가하지 않았다.

## 최종 UI·실행 검증

- 최신 전체 `npm run test:operations` **767/767 통과**. 기존 749개에 서버 intent·실제 fixture 인증·연락처/복합 세션 경계·첫 저장 연관 검사 18개를 추가했다.
- 고객 접근·예약 클라이언트 관련 **37/37**, 실제 API fixture **4/4**, 최종 lint·타입·production build 통과.
- 로컬 production 브라우저 **40/40**: 기존 journey **18**, 새 entry **16**, 사진 수명 **6**. 최종 세 실행의 pageErrors는 0이며 외부 요청/실제 provider 호출도 0이다.
- 별도 `/var/folders/wp/qb5gvgpx2dg_xqmt3dz5qhxr0000gn/T/lk-quote-entry-8913jqzn`에서 기존 설정을 값 복사 없이 참조해 빌드했다. 전체 `src`·`public` 원본/복사본 SHA-256 불일치 0을 확인했다. 검증한 build를 [3002 미리보기](http://127.0.0.1:3002/quote/start)에 연결하고 시험용 3005 서버는 종료했다.

### 실제로 검사한 경계

권한 있는 A의 연락처 세 항목만 자동 채움, 별도 B ID·revision 1 생성, A 업무 JSON/audit 보존, 현재 A의 명시적 목록 선택, 고객 A 뒤 숨은 미연결 guest B의 차단/정확한 복귀, guest 전용 재개, 초기 baseline/명시적 폐기를 실제 쿠키와 API로 검사했다.

다른 탭의 새 시작과 단순 세션 확인은 현재 입력을 자동 초기화하지 않는다. same-ID 복구는 값을 유지하고 다른-ID는 미저장/결과 불명 경계를 따른다. 첫 PUT이 늦게 완료되면 실제 raw guest 권한과 최초 revision 1·전체 정규화 payload 일치를 확인한 후 ID 메타데이터만 연결한다. 원 body/key를 유지하고 해당 ID 헤더로 재시도하며, 불일치/이후 revision은 입력을 보존하고 잠금을 유지한다.

사진 prepare/finalize/process 각각의 늦은 401/200에서도 선택 File·동의·범주·정확한 body/key를 보존한다. 실제 HTTP가 종료된 뒤 복구를 허용하고 같은 ID 재인증/명시적 선택 후 동일 요청을 재시도한다. finalize의 정당한 revision 증가와 process의 이미 생성된 동일 job도 검사했다. 합성 private upload는 Playwright에서 처리하며 외부로 전송하지 않는다.

예약에서는 두 번의 접근 재확인 뒤 미저장 `11:00` 유지, 지연된 최초 조회에서 저장 `10:30` 복원, same-ID 복구 뒤 서명 화면/name/ack 유지, 중단된 availability 401 body의 무시, PDF 다운로드의 늦은 완료 후 busy 해제, 서버 selection revision 변경/만료 시 이전 review/proof 무효화, 전환 대기 중 이메일 만료에도 입력 유지와 성공 후 새 폼 전환을 확인했다.

### 발견·수정과 검사의 한계

정적 QA와 브라우저에서 peer의 세션 확인이 값을 비우는 경로, 중단된 읽기/PDF의 busy 고정, contact pending의 숨은 재시도 버튼/다른 세션 쓰기, 첫 저장 뒤 복구 막힘, 일반 접근 재확인의 시간·서명 초기화, 최초 읽기 보존 오판과 일반 상태 조회의 오래된 proof를 보완했다. 마지막 분석 QA의 미해결 P1/P2는 없다.

중간 검사의 checkbox 이름·만료 오류·목록 선택 시점·인증된 PUT 헤더 가정을 실제 계약에 맞게 수정했다. 실제 한 분 OTP 제한은 그대로 검사하며 로컬 fixture의 해당 cooldown만 과거로 이동해 재인증 대기를 모사한다. 실제 rate limiter와 hourly/global 제한은 유지한다. 합성 오류 주입은 예상 401/409/503 콘솔 메시지를 낸다. fixture의 홈 prefetch 404·font preload 경고도 관찰했으며 전체 console 무경고를 완료로 보고하지 않는다.

[데스크톱 첫 화면](2026-10-13-quote-entry/quote-entry-desktop.png)·[모바일 첫 화면](2026-10-13-quote-entry/quote-entry-mobile.png)·[연락처만 채운 새 견적](2026-10-13-quote-entry/quote-entry-prefilled.png)을 직접 시각 점검했다. 두 진입 카드·키보드 선택·가로 넘침 없음·원페이지 단계/고정 footer를 확인했다. 캡처는 합성 자료다.

## 범위와 제한

시험은 합성 개인정보와 로컬 PGlite, 합성 인증/사진/AI/예약 제공자를 사용한다. 회사 DB·실제 인증 메일·Google·AI·Calendar·실제 모바일 기기 인수와 운영 배포는 이번 실행에 포함하지 않는다. commit·push·merge는 수행하지 않는다.
