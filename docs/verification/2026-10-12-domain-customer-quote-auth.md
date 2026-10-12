# 회사 도메인·고객 이메일 인증·견적 복구 인수

2026-10-12 · Australia/Sydney · 계획 41의 1~2단계

## 실행 기준

- 기준 소스: `main@31e7387`, 작업 브랜치 `codex/domain-customer-quote-auth-20261012`.
- 운영 주소: `https://www.lnkgroupsydney.com.au`. 루트 주소는 경로·쿼리를 보존해 www로 308 이동한다.
- 회사 Chrome `Kang (L&K Group)` / `lnkgroupsydney@gmail.com`에서 실행했다. 개인 프로필·인앱 브라우저는 사용하지 않았다.
- 가상 회사 QA 요청과 사용자가 지정한 `public/images/story/quote photo` 자료를 사용했다. 실제 계약·서명·예약·최종 견적 발송은 수행하지 않았다.
- 1차 Production: `dpl_9q1g86n9H55Avh5Md4BL7FHYpZRi` READY. 작업 폴더 배포이며 main 병합/push를 의미하지 않는다.
- 최종 Production: **`dpl_FSteedNuKs7tnRBSEga5VGKaPFon` READY**, `https://lnkgroup-bzrc4mgx1-lnkgroupsydney-8702.vercel.app`. Google 설정 및 누락 상태 표시 수정을 포함한다. www 요청/고객 API 200, 기존 인증 세션의 revision 7·사진 5장·동일 분석/금액 복원을 재확인했다.

## Git 통합 — 후속 사용자 요청

- 기능 커밋 `92f76a8`, `main` 병합 `6dd42ea`. 병합 충돌 없음, 기능 브랜치와 병합 결과 tree 동일.
- 회사 `origin` (`lnkgroupsydney-hub/lnkgroup`)을 동기화 대상으로 확인했다. 개인 `legacy-origin`은 사용하지 않는다.
- 최종 558개 검사 및 lint·타입·빌드 후 실행 코드는 바뀌지 않았다. 병합 기록 문서만 추가했으며 비밀키·쿠키·원본 QA 사진·검증 로그는 커밋에 포함하지 않았다.

## 회사 설정과 오류 해결

- `APP_BASE_URL`을 www로 전환해 기존 견적 API의 origin 403을 해결했다. 잘못된 origin은 계속 거절한다.
- 회사 발신 주소 `L&K Group <quotes@lnkgroupsydney.com.au>`, 앱 Reply-To `lnkgroupsydney@gmail.com`을 설정했다. 화면의 **Email for saved quote access**는 인증받을 고객 수신 주소이며 발신 주소와 역할이 다르다.
- Supabase custom SMTP: `smtp.resend.com:465`, 사용자명 `resend`. API 키는 사용자가 직접 입력·저장했다. 최초 `535 Authentication credentials invalid`를 로그로 확인했으며, 자동완성 없이 유효 Resend 키를 저장한 뒤 실제 OTP 메일 배달과 인증이 성공했다. 비밀키·인증 코드는 이 기록에 저장하지 않았다.
- Supabase Site URL은 www, 고객 OTP는 8자리/900초, 기존 사용자 및 신규 가입 이메일 템플릿은 코드 방식이다. 익명 로그인·수동 계정 연결 등 다른 보안 정책은 유지했다.
- Google OAuth의 www redirect 누락 경로를 `https://www.lnkgroupsydney.com.au/api/google/callback`으로 수정·저장했고 로컬 callback을 보존했다. Vercel에 빠져 있던 기존 회사 `GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET`을 Production Secret으로 추가했다. 새 OAuth 클라이언트나 권한을 만들지 않았다.
- EMS 직원 세션 응답이 누락 설정 목록을 항상 빈 배열로 반환해 OAuth 실패와 설정 완료를 동시에 표시하던 오류를 수정했다. ID/secret 공백·암호화 키 형식을 검사하고 미확인 상태를 완료로 표시하지 않는다. 운영 환경 안내도 재배포/HTTPS 기준으로 맞췄다.
- 최종 회사 Chrome EMS 설정 화면에서 회사 소유 캘린더 목록과 Gmail 라벨 조회 성공. 기존 선택 **L&K Integration (owner)** / **L&K Integration Test**를 그대로 유지했다. 새 권한 동의·캘린더 대상 변경·이벤트 생성은 수행하지 않았다. 화면의 이전 동기화 성공 시각(10월 11일)을 오늘의 전체 재동기화 인수로 세지 않는다.

## 실제 메일·회사 Chrome 인수

| 검사 | 관찰된 결과 |
| --- | --- |
| 직원 메일·EMS 로그인 | `01a12f64-8a81-71fe-9949-1b42bb1b3626`, 09:14:40 UTC, `L&K Group EMS sign-in code`, company From/Reply-To, Resend `delivered`. 사용자가 비밀번호·코드로 www EMS 로그인 완료. |
| 고객 OTP 1차 | `01a12f6e-ee5f-7521-bca0-5b413199d00d`, 09:26:01 UTC, `Your L&K Group quote verification code`, company From, `delivered`. 사용자 코드 인증 성공. |
| 이전 도메인 작성본 이전 | 유효한 기존 guest 작성본에서 일회용 이전을 시작했다. www에서 fragment 제거 후 원래 이메일 OTP로 동일 요청 ID를 복구했다. 이전 토큰의 `consumed_at=09:26:24 UTC` 확인. |
| www 저장 | 서비스 저장 revision 2 → 장면별 사진 5장 저장 revision 7. 비공개 사진의 실제 미리보기 확인. |
| 실제 AI·EMS 대조 | 아래 요청/분석 ID와 5개 사진 ID, revision 7, 금액이 고객 화면·EMS 상세·DB에서 일치했다. |
| 고객 로그아웃 | 고객 폼과 연결 목록이 지워졌으며 DB 고객 세션 `revoked_at=09:35:00 UTC`. 같은 브라우저 EMS 새로고침 후 직원 로그인 유지. |
| 재인증·복구 | 2차 OTP `01a12f77-7724-7e90-adbd-87e3e015e725`, 09:35:21 UTC, `delivered`. 회사 Gmail에서 수신한 코드로 별도 고객 세션 생성(09:36:25 UTC). 연결된 요청 목록에서 열어 사진 5장·동일 분석/금액 복구 및 새로고침 보존. |
| 요청별 권한 | 인증 목록에는 직접 연결한 한 건만 표시됐다. 같은 이메일인 별도 API QA 요청 및 과거 EMS 자료가 자동 연결되지 않았다. |

위 복구는 같은 회사 Chrome에서 **기존 고객 세션을 로그아웃하고 새 고객 세션으로 재인증**해 검증했다. 별도 물리 기기 또는 신규 미가입 고객 이메일의 실제 가입 인수까지 수행한 것은 아니다.

## 실제 사진 분석 결과

- 요청: `895f8919-7e19-4506-972d-944285b0185a` / `RQ-895F89197E194506972D944285B0185A` (`LK-DOMAIN-20261012 Legacy QA`).
- 사진: `whole 1.png`, `upper 1.png`, `lower 1.png`, `side 1.png`, `damage 1.png`.
- 비공개 사진 ID: overview `1e9b11da-fc62-456a-9e60-dd2d7601b99c`, upper `69252541-5128-43ed-a226-5fd9cd14d518`, lower `3c26e63e-9bf1-4297-80bb-bba4db1074c5`, side `db8ae583-8d0c-41ea-a6a8-bd17ee012ab8`, damage `dfd7674f-f5d9-4add-a51f-d55fe448389f` — 모두 `ready`.
- 분석 `cee10c05-a7c7-4f8a-9fa9-ae62b19bb6e9`, `gpt-6.1-sol`, input revision 7, `succeeded`, 완료 09:34:08 UTC.
- 추정 문 15개 × A$150 + 서랍 6개 × A$100 = **A$2,850 + GST A$285 = A$3,135**.
- 기준 전체 전면 사진의 잠정 도장비다. 분석은 다른 장면의 배치·마감 불일치를 표시하고, 다른 현장으로 판단한 수량과 손상 보수비를 합산하지 않았다. 정확한 수량·손상·최종 범위는 현장 확인 대상이다. 이번 작업에서 가격 규칙을 바꾸지 않았다.

## Production API·DB 확인

- www 요청/고객 상태 GET 200. 레거시 주소는 기존 요청 읽기/일회용 이전만 허용하고 신규 작성 POST 403. 공격 origin POST 403, 비인증 관리자 요청 401.
- 별도 가상 API QA 요청 `f1ea522e-6d87-4c20-a2ed-6234c181a6ca`: 새 세션·저장·읽기·동일 중복키 재요청 200, 잘못된 예상 요청 ID 409, 다른 guest의 요청 조회 null.
- API QA 사진 `damage 2.jpeg`의 업로드·확정·권한 있는 조회 200, 익명 이미지 조회 401. 이 API 검사를 브라우저 클릭 검증으로 세지 않았다.
- migration `20261012085406_live_quote_customer_email_auth.sql`을 회사 Supabase SQL Editor에서 적용했다.
- 원본 migration SHA-256: `cf7e49918ac88832caf3f085b9623a44b7c6c60abeca60829c6a972496a7a7a2`.
- 적용 직전/직후 기존 요청 12건·사진 29건·분석 15건의 내용 hash 동일. 신규 고객 세 테이블에 익명 접근 `42501`; service role 조회 성공. 이후 QA에서 추가한 데이터는 이 보존 비교의 이후 변경이다.
- 인증 관계 1건, 소비된 이전 권한 1건, 폐기 고객 세션 1건·활성 새 고객 세션 1건을 읽기 검증했다.

## 자동 검사와 남은 범위

- 최초 자동 검사 553개와 후속 provider 검사 4개가 통과했다. 마지막 Google 설정 회귀 검사까지 추가한 뒤 `npm run test:operations` 전체를 다시 실행해 **558/558**, 실패·skip 없이 통과했다.
- `npm run check`: lint·TypeScript·Webpack Production build 통과. `git diff --check` 통과.
- 이메일 OTP 실패/만료/재사용, A/B 요청 접근, 일회용 이전, 직원/고객 세션 분리, stale 요청/다중 탭 요청 ID, SDK 쿠키 처리와 로그아웃 경계는 자동 검사에 포함된다.
- 실제 Postgres 다중 연결 경합, 실제 다른 기기, 신규 미가입 이메일 및 모바일 실기기 인수는 미실행이다. 자동/PGlite 검사와 실제 브라우저 실행을 구분한다.
- 다음 범위: 예상 견적 승인 버전, 날짜 선택, 운영 약관/서명, live 문서·고객 발송, Google 회사 최종 확정. 이 단계의 기존 데모 기능을 운영 기능 완료로 세지 않는다.

공식 설정 참고: [Resend SMTP](https://resend.com/docs/send-with-smtp), [Supabase 이메일 OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless).
