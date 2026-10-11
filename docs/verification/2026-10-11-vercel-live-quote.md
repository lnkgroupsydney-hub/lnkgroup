# Vercel 실제 사진 견적·EMS 검증

2026-10-11 · Australia/Sydney · 배포·실연동 검증

## 적용 범위

회사 `lnkgroupsydney@gmail.com` 계정의 Vercel `lnkgroup` 프로젝트와 기존 회사 Supabase를 사용한다. 운영 주소는 `https://lnkgroup.vercel.app`이다. 기준 main은 `f1f071b`이며 후속 수정은 `codex/vercel-live-quote-qa-20261011`에서 진행한다. CLI의 회사 이메일·팀·프로젝트·Git 연결을 대조했고 개인 계정에는 배포하지 않았다.

Production 환경에 `APP_BASE_URL`, `OPERATIONS_STORE`, `QUOTE_LIVE_ENABLED`, `QUOTE_DEMO_ENABLED`, `LOCAL_OPERATIONS_ENABLED`, `STAFF_ADMIN_AUTH_ENABLED`, `STAFF_ADMIN_SECOND_STEP`, `RESEND_FROM_EMAIL`과 서버 전용 OpenAI·암호화·이메일 인증·Resend 키를 설정했다. Supabase integration의 회사 URL·공개 키를 대조하고 기존 서버 키를 유지했다. 비밀값은 문서·로그·명령 인자에 기록하지 않는다. Preview/Development 환경은 변경하지 않았다.

`after()`로 분석 시작 응답 후에도 서버 작업을 이어가도록 연결했다. 기존 DB 원자적 claim을 재사용하므로 브라우저 처리와 경합해도 한 작업이 중복 유료 호출을 하지 않는다. 실패·불확실한 결과를 무조건 자동 재시도하지 않는다. 런타임 종료를 넘는 영구 큐 보장은 아니며 기존 복구/명시적 재시도 상태를 유지한다.

## 배포에서 발견한 오류

첫 배포에서 canonical 주소의 Quote API와 EMS가 403을 반환했다. 서버 진단 결과 URL·Host·X-Forwarded-Host·HTTPS는 모두 회사 주소와 일치하고 X-Forwarded-Port는 없었다. Vercel의 `Forwarded` 헤더에 `for`, `host`, `proto` 외 `sig`, `exp` 확장 필드가 포함돼 기존 제한 파서가 거부했다. 확장 필드는 권한 결정에 사용하지 않고 기존 고정 주소·Origin 검증을 유지하는 공용 파서와 회귀 검사를 적용했다. 진단은 쿠키·IP·서명값 없이 필드 이름과 주소 정보만 사용했고 최종 코드에서 제거했다. 배포에서 세션 발급·저장·사진·분석 API와 회사 EMS 로그인이 정상 작동했다.

실제 수량 불일치 시험에서 AI가 상부장 없음 상태를 `covered: true, photoIds: []`로 반환해 근거 검증에 실패했다. 기존 검증을 유지하면서 Structured Outputs의 coverage 제약과 `cabinet-observations-v2` 프롬프트를 보강했다. 구버전 실패 결과의 명시적 재시도는 현재 버전의 새 작업을 만들고 과거 실패 이력은 보존한다. 구버전 대기 작업은 사진 조회·유료 호출 전에 중단하며 재시도를 안내한다. 과거 가격 미설정 결과는 다시 계산하지 않는다.

최종 Production 배포 `dpl_7yQ7MBKWgcX8bp9ufkMUos9f3QP5`가 **Ready**이며 `https://lnkgroup.vercel.app`에 연결됐다. 작업 브랜치 소스를 CLI로 배포했으며 배포 성공과 Git 병합을 혼동하지 않는다.

## 사진 및 테스트 기준

사용자 지정 `public/images/story/quote photo/`의 원본을 사용한다. `.vercelignore`로 이 폴더·로컬 환경 파일·검증 산출물을 배포에서 제외했다. 실제 배포의 `/images/story/quote%20photo/side%201.png`는 404이며 견적 사진은 비공개 업로드 API를 통해서만 보관한다.

번호가 같은 whole/upper/lower/side 이미지도 캐비넷 배치가 다르다. 정상 단일 범위와 서로 다른 주방 혼합 사례를 구분한다. AI-generated example 표시가 있는 자료는 실제 시공 증거로 취급하지 않는다. 모든 생성 요청은 `QA VERCEL 20261011`로 표시한다. 테스트 범위는 사진·분석·예상 가격·저장/복원이며 고객 메일·계약·예약·Calendar 이벤트를 생성하지 않는다.

## 실제 배포 테스트

고객 브라우저를 이용한 수동 검증과 별도 QA 고객 세션을 사용하는 공개 API 검증을 구분했다. API 검증은 브라우저 쿠키를 가져오거나 관리자 인증을 우회하지 않는다. Mac 분석 worker를 중지한 채 `/process` 호출 없이 `after()`만으로 완료되는지 확인했다.

| 시나리오 | 사진 | 실제 결과 |
| --- | --- | --- |
| 단일 하부장, 문 3·서랍 2 확인 | side 1 한 장 | `analysis_ready`·`estimate_ready`, A$1,500 + GST A$150 = **A$1,650**. 해당 단일 유닛만의 결과이며 전체 주방 가격이 아니다. |
| 촬영 범위 부족 | upper 1 한 장 | `additional_photos_required`, 총액 없음 |
| 고객 문 4·사진 문 3 불일치 | side 1 한 장 | 최초 provider 출력 근거 검증 실패. 수정 후 명시적 재시도 1회는 성공, 상부장 없음이 근거 없는 `covered: true`로 표시되지 않고 수량 확인·추가 사진 요청 및 총액 없음으로 저장됐다. |
| 심한 손상·전체 범위 불명 | damage 2 한 장 | `additional_photos_required`, 심한 박리·변형 관찰, 총액 없음 |
| 서로 다른 주방 혼합 | whole/upper/lower/side 2 네 장 | `site_review_required`, 전체 수량·같은 현장 여부 불명, 총액 없음 |
| **요청된 모든 장면, 1번 세트** | **whole/upper/lower/side/damage 1 다섯 장** | **회사 Chrome에서 업로드·분석·새로고침·EMS 대조 완료**. 다섯 장면 확인, 문 하단 중간 정도 박리 관찰. 전체 수량·손상 문의 현장 위치 미확정으로 `site_review_required`/`review_required`, 총액 없음 |
| **요청된 모든 장면, 2번 세트** | **whole/upper/lower/side/damage 2 다섯 장** | **모든 장면 확인·분석 성공**, 서로 다른 스타일·현장 범위 불명·심한 끝판 손상으로 `site_review_required`/`review_required`, 총액 없음 |
| **요청된 모든 장면, 3번 세트** | **whole/upper/lower/side/damage 3 다섯 장** | **모든 장면 확인·분석 성공**, 서로 다른 구조·마감·수량 불명 및 보수 분류 확인으로 `site_review_required`/`review_required`, 총액 없음 |

다섯 장 세트에는 확인되지 않은 문·서랍 수량을 임의로 입력하지 않았다. 2번은 `RQ-B8D7AF1773614454B5223365F5593945`, 3번은 `RQ-C7C4D66CE924479CA119C3A89F01B6AB`로 저장됐다. 각 5장의 비공개 저장본 해시와 API 반환을 대조했고 요청 복원·결과 snapshot·동일 키 중복 방지·분석 호출 1회를 확인했다. 직접 Supabase 읽기로 같은 요청/사진/분석/가격/사용량을 대조했다. 이는 입력 부적합 시 금액을 보류하는 실제 검증이며, 전체 주방 숫자 견적 인수 완료를 뜻하지 않는다.

2번 세트 OpenAI 사용량은 입력 10,632 / 출력 1,916 토큰, 저장된 추정 호출 비용 US$0.040424다. 3번은 입력 10,689 / 출력 1,953 토큰, US$0.040908다. 실제 청구서 확정액과 구분한다.

회사 Chrome에서 사용자가 EMS 이메일 코드 로그인을 완료한 뒤 단일 유닛 결과의 A$1,650 내역과 저장된 분석·비공개 원본 사진을 실제 화면에서 확인했다. 후속 1번 세트는 `RQ-5AF76DCCF72D42DB93A55C24390AACC5` revision 10, 분석 `ad4b8c3f-d1f4-4874-b983-e2702296763c`로 저장됐다. 회사 Chrome에서 직접 각 장면을 선택해 다섯 장을 업로드하고 AI 분석을 실행했다. 고객 새로고침 후 동일한 사진 5장과 분석이 복원됐으며, 회사 EMS에서 요청을 검색·열어 5개 사진 ID·동일 분석 ID·관찰 내용·가격 보류 상태를 대조했다. Supabase에서도 prompt v2·호출 1회·사진 다섯 장·전체 장면 coverage를 확인했다. 입력 10,637 / 출력 1,969 토큰, 추정 호출 비용 US$0.040964였다. **세 세트 15장 모두 업로드·분석·EMS 저장 완료**이며 전체 주방 숫자 총액은 세 세트 모두 보류됐다.

오류 재시도는 기존 실패 작업 `d3e8b668-3d50-43b4-95df-c66822f3a6ee`를 보존하고 새 prompt v2 작업 `933095ef-b532-4b1f-85b5-50371ad8db3f`로 성공했다. 한 번의 유료 재시도와 동일 키 replay를 검증했으며 새 작업 추가·중복 과금은 없었다. 비용 추정 US$0.015652. 고객 입력 4/2를 덮어쓰지 않고 관찰 수량 미확정·총액 없음 상태를 유지했다.

## 저장·권한·중복 및 검증 증거

- 비로그인 사진 조회 401, 다른 QA 요청의 사진 조회 404, 다른 Origin의 분석 쓰기 403을 확인했다. 익명 Supabase 조회는 `42501`로 거부됐다.
- 동일 사진은 업로드 시작 후 서버 정규화·해시 대조 단계에서 409로 차단된다. QA가 만든 두 pending 행은 소유자 API의 정상 삭제로 정리했다. 사진 revision 변경에 따른 과거 분석의 stale 표시와 기존 결과·가격·사용량 보존을 확인했다.
- `live-quote-staging`, `live-quote-photos` 버킷은 비공개다. 정상 업로드의 staging 원본 삭제를 표본 확인했다. `staging_cleaned_at`은 업로드 토큰 재사용까지 고려한 지연 정리 시점에 기록되므로 즉시 null을 고아 파일로 판단하지 않는다.
- 최종 자동 검사 **502/502**, lint·타입 검사·분리 경로의 프로덕션 빌드 통과. 로그: `.local/verification/2026-10-11-runner-version-guard-full-tests.log`, `.local/verification/2026-10-11-final-isolated-check.log`.
- 실제 API 영수증·사진 해시·사용량은 접근 제한된 `.local/production-quote-results/`, `.local/production-quote-full-sets/`에 보관한다. 세션과 signed URL이 포함될 수 있어 Git에 올리지 않는다.

## 남은 인수

같은 주방의 연속된 전체·상부·하부·측면·손상 사진과 확인된 수량으로 전체 주방의 숫자 예상 견적을 추가 인수해야 한다. 상시 클라우드의 만료 staging 정리 운영, 고객 이메일 본인 확인·실제 약관·서명·예약은 이번 사진 분석 검증의 완료 범위에 포함하지 않는다.
