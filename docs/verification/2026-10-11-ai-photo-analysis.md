# 2026-10-11 사진 AI 분석·EMS 저장 검증

> 아래는 가격 규칙 적용 전 기록이다. 이후 가격 v1과 회사 브라우저 실제 인수 결과는 [후속 검증](2026-10-11-pricing-browser-qa.md)을 따른다.

브랜치: `codex/ai-photo-estimate-20261011`. 기존 미커밋 변경을 보존했다. 가격 기준 미정이라는 사용자 결정에 따라 금액은 `awaiting_company_rates`와 `null`로 남긴다. 이번 범위에 운영 가격·예약·약관·메일 발송·배포는 포함하지 않는다.

## 구현

- 실제 Quote의 서비스 저장 다음 단계에 약 5장 촬영 안내(전체 전면/상부/하부·서랍/측면/손상), 최대 8장 업로드, 상부장 없음·손상 없음 선택을 추가했다.
- 10 MiB 원본을 Supabase 비공개 staging에 서명 URL로 직접 업로드한다. 앱 함수에 큰 사진 본문을 보내지 않는다. SHA-256 원본 일치, 실제 파일 형식·정적 이미지·최대 50MP 검증 후 EXIF 제거·회전·최대 2048px/3MiB JPEG 정규화를 한다. 응답 유실 재시도는 같은 예약/키/파일 해시를 사용한다.
- `OPENAI_API_KEY` 및 사용자가 입력한 `OPEN_AI_API_KEY`를 서버에서만 지원한다. `gpt-6.1-sol`, `medium`, 표준 처리, 최대 출력 8,000토큰, 120초 제한, `store:false`다. 연락처·주소·자유 입력 문구는 제공자에 보내지 않는다. 사진 속 지시는 실행하지 않으며 DB/메일/Calendar 도구를 부여하지 않는다.
- 분석은 사진 근거·품질·누락 범위·손상·작업 항목·수량 불일치를 구조화하고 서버에서 검증한다. 원시 출력·모델이 생성한 임의 금액은 공개하지 않는다. 모델 추론을 포함한 토큰 사용량과 요율 버전에 따른 USD 추정 호출 비용을 기록한다.
- 요청 revision·사진 manifest·모델/프롬프트/스키마/가격 버전·촬영 예외 입력에 분석 작업을 귀속한다. 같은 요청의 중복 실행을 lease로 차단하고, 완료 저장 재시도는 제공자를 재호출하지 않는다. 240초 lease, 사진 준비 전체 30초 제한, 실패 후 명시적 재시도만 허용한다. 요청당 최대 3회 시도, 작성 세션당 시간당 3건·전체 시간당 20건 생성 제한을 둔다.
- 중단된 running은 조회/worker 재개 시 uncertain으로 복구한다. 사진/서비스 수정 후 결과는 stale 이력으로 보존한다. 기존 review 요청은 명시적 reopen 후만 수정한다. 이전 데모·서명 자료를 자동 분석하거나 수정하지 않는다.
- 고객과 EMS는 같은 저장 결과를 조회한다. 사진 권한 만료·직원 권한 상실 시 비공개 데이터를 지운다. `npm run quote:worker -- --once`와 반복 worker를 추가했다. HTTP process 경로도 작업을 await하며 응답 이후 메모리 작업에 의존하지 않는다.

## 자동 검증

- 전체 `npm run test:operations`: **461/461 통과**. 이후 오류 분류/메타데이터 누락 보강을 포함한 `npm run test:live-quotes`: **63/63 통과**. 두 실행 결과는 각각의 범위로 기록하며 합산하지 않는다.
- PGlite 실제 SQL + 실제 API 권한/세션 처리 + 실제 이미지 정규화 + 제공자 응답 fixture로 소유권·CSRF·직원 권한·해시 위조·응답 유실·중복 호출·stale 결과·lease 만료·쿼터 부족·메타데이터 누락을 검사했다.
- 최종 `npm run lint`, `npm run typecheck`(Next 타입 생성 및 TypeScript), `npm run build`(production)는 모두 성공했다. 초기 lint는 `.local`의 과거 빌드 백업 생성물까지 검사해 실패했으며, 생성물 없는 격리 복사본에서 소스 검사·빌드를 통과했다. 이후 Git에서도 제외하는 로컬 검증 산출물·빌드 백업 디렉터리 `.local`을 ESLint/TypeScript 검사 대상에서 제외하고 실제 프로젝트 루트에서 lint·타입 검사를 다시 통과했다. `src`·`scripts`의 코드 및 테스트는 그대로 검사한다.
- production build를 로컬 3002에서 실행한 뒤 견적 URL HTTP 200과 실제 폼/Photos and analysis SSR을 확인했다. 인증 없는 photos, customer analysis, admin analysis 요청은 모두 401이었다. 이는 브라우저 상호작용 인수와 다르다. 초기 HTTP smoke의 제목 일치 기대값은 실제 문구와 달라 조정한 뒤 통과했으며 제품 오류는 아니었다.

## 실제 회사 Supabase / OpenAI

- 회사 Chrome 프로필 `lnkgroupsydney@gmail.com`과 회사 프로젝트 `xlqyafthsxallostcqfe`를 확인한 뒤 SQL Editor에서 `20261011003128_live_quote_photo_analysis.sql` 적용 성공을 확인했다. CLI migration history에 자동 등록되는 경로는 아니다. 이전 수동 적용 이력 정리는 여전히 별도다.
- 신규 테이블 `lk_live_quote_photos`, `lk_quote_analysis_jobs`, `lk_quote_media_receipts`, `lk_quote_media_audit`: 서버 읽기 성공·익명 권한 거절 4/4. 두 버킷 `live-quote-staging`(10MiB), `live-quote-photos`(3MiB)의 비공개 설정을 확인했다. 원격 실제 lease는 240초다.
- 원격 합성 요청 **RQ-A3E6E2DCE501444F85942885489460F6**에 사용자 지정 `damage 1.jpeg`, `damage 2.jpeg` 두 장을 업로드하고 서버 검사·정규화·비공개 조회를 확인했다. 두 장을 전체 촬영 범위가 충족된 세트라고 간주하지 않는다.
- 모델 조회는 HTTP 200으로 `gpt-6.1-sol` 접근을 확인했다. 최초 사진 분석 시도는 개인정보 없는 최소 진단에서 **HTTP 429 / `credit_balance_exhausted` / `insufficient_quota`**로 실패했다. 이는 당시 API 크레딧 부족 기록으로 보존한다. 이후 크레딧 상태가 해결된 뒤 명시적으로 같은 요청을 재호출해 실제 분석이 성공했다. API 키 값은 출력·문서·Git에 기록하지 않았다.
- 실제 재시도는 `gpt-6.1-sol / medium`에서 **31.012초** 걸렸고 `additional_photos_required`를 반환했다. 결과에는 관찰 손상 4건과 작업 제안 3건이 포함됐다. 이는 지정 손상 사진 두 장의 분석이며 전체 촬영 범위가 확보됐다는 뜻은 아니다. 사용량은 입력 1,782토큰, 출력 1,960토큰(추론 215 포함), 합계 3,742토큰이며, 기록된 요율 버전 기준 비용 추정은 **USD 0.023164**다.
- 가격 상태는 `awaiting_company_rates`, 통화 AUD, 금액 `null`로 저장됐다. 실제 회사 가격 기준 계산·예상 금액 인수는 완료되지 않았다. 동일 작업을 명시적으로 다시 호출했을 때 이미 성공한 같은 분석을 반환했고 분석을 다시 수행하지 않았다. 이는 API 작업 중복 방지 확인이지 고객 브라우저 화면 인수는 아니다.
- 회사 readback에서 고객·EMS가 모두 `publicWorkspace(false/true)` 경로를 거쳐 실제 `parsePhotoWorkspace`로 읽혔다. 두 결과의 analysis/pricing 원본이 일치했고 `ownerHash`, `sourceHash`, `stagingPath`, `objectPath`, `leaseToken`, `inputSnapshot`은 공개 응답에 포함되지 않았다. 기존 초안 8건·제출 5건·데모 사진 5건·고객 0건 및 기존 네 테이블 fingerprint는 전후 동일했다. 메일·Google Calendar·고객 자동 병합은 실행하지 않았다.
- 성공 결과 확인과 저장 일치는 브라우저 UI 입력을 통해 검증한 것이 아니다. 회사 창 선택 중 입력이 개인 창으로 전달되어 추가 UI 조작을 중단했다. 브라우저의 업로드/분석/새로고침/오류/모바일/키보드/EMS 화면 인수는 미완료다.
- worker `--once`는 회사 DB에 정상 접속했고 최초 실패 기록을 자동 유료 재시도하지 않았다. 성공 분석은 별도의 명시적 사용자 재호출로 수행됐다. 후속으로 로컬 15초 반복 worker를 실행했으며 실패 작업의 자동 유료 재시도는 없다. 이는 Vercel 상시 worker 운영 인수를 뜻하지 않는다.

## 남은 인수

1. 회사 브라우저의 안정적으로 고정된 탭에서 업로드·분석·새로고침·오류·모바일·키보드·EMS 화면 인수를 진행한다. 회사 창 선택 중 입력이 개인 창으로 전달되어 추가 브라우저 조작을 중단했으며, 이 검증은 완료로 표시하지 않는다.
2. 회사 가격 기준·실제 금액 계산, 현장 조정, 고객 인증·승인·예약은 후속이다. 현재 `awaiting_company_rates`/금액 null을 유지한다.
3. Vercel 환경 키·실제 배포와 상시 worker 실행 환경은 후속이다. 현재 로컬 실행이나 SQL 적용을 배포로 간주하지 않는다.

참고: [OpenAI 모델](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs), [Supabase 서명 업로드](https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl).
