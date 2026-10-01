# 회사 Supabase 업무 저장소 연결

2026-10-01 · Australia/Sydney · **실제 스키마 적용·클라우드 저장/권한·브라우저·재시작 보존 검증 완료**

[전체 TODO](15-home-cabinet-admin-todo.md) · [문의·Gmail·Calendar 기능](28-gmail-enquiry-calendar-implementation.md) · [Google 실연동 계획](29-google-oauth-live-verification-plan.md)

## 대상과 범위

사용자가 [기존 회사 프로젝트](https://supabase.com/dashboard/project/xlqyafthsxallostcqfe)를 지정하고 앞으로 데이터를 여기에 저장하도록 요청했다. 프로젝트 URL은 `https://xlqyafthsxallostcqfe.supabase.co`다. 공개 publishable key를 제공했고 서버 전용 `SUPABASE_SECRET_KEY`는 `.env.local`에 직접 입력했다고 확인했다. 키 입력 확인 후 실제 server health·12개 테이블 조회·유효 공개키 접근 거부를 별도로 확인했다. [검증 기록](../verification/2026-10-01-supabase.md)을 따른다.

이번 범위는 기존 KCP 문의 폼과 회사 문의함의 저장소를 Supabase로 연결하는 것이다. 문의, Gmail 수신 이력·중복 판정, 제안 일정, 외부 변경 검토, Google 연결, 관리자 세션과 동기화 상태를 저장한다. 현재 관리자 로그인과 Google OAuth 연결은 `http://127.0.0.1:3002`에서 실행한다. Supabase DB 연결만으로 앱의 공개 배포나 Supabase Auth 직원 로그인·역할 관리가 완료되는 것은 아니다.

사용자가 제공한 `todos` 조회 예시는 연결 방식 참고다. 실제 업무는 기존 문의·일정 모델을 사용한다. 가격·근무시간·기간 산식·확정 예약·인보이스 실행은 기존 보류를 유지한다. Google OAuth의 클라이언트 설정·동의·실제 Gmail/Calendar 왕복 검증은 29번의 별도 단계다.

## 저장 구조와 접근 경계

`supabase/migrations/20261001100420_operations_supabase.sql`이 이번 스키마의 원본이다. 하나의 RPC `public.lk_operations_command(command, args)`에서 각 업무 변경을 DB 트랜잭션으로 처리한다. Google 네트워크 요청은 트랜잭션 밖에서 실행하며, 반영 시 동기화 잠금과 문의 버전을 다시 확인한다.

| 테이블 | 저장 내용 |
| --- | --- |
| `lk_enquiries` | 웹/Gmail 문의, 제한된 메일 이력, 미확정 일정, 버전 |
| `lk_sessions` | 관리자 세션 토큰의 해시와 만료 |
| `lk_oauth_states` | 단일 사용 OAuth state·브라우저 검증·PKCE 상태 |
| `lk_google_connection` | 회사 계정, 암호화한 토큰, 라벨/Calendar 선택·커서 |
| `lk_calendar_links` | 문의별 Google 이벤트 ID·etag·동기화 버전 |
| `lk_outbox` | Calendar 전송 대기 |
| `lk_change_requests` | Google 외부 변경의 검토·승인/거절 상태 |
| `lk_gmail_seen` | 계정·메시지별 중복 수집 판정 |
| `lk_gmail_threads` | Gmail 대화와 문의 연결 |
| `lk_gmail_quarantine` | 수집 불가 메시지의 ID·검토 이유 |
| `lk_sync_lease` | 앱/worker의 동기화 소유권·만료 |
| `lk_rate_buckets` | 관리자 로그인·문의 접수 요청 제한 |

12개 테이블은 `public` 스키마에 있지만 비공개 업무 데이터다. 모두 RLS를 켜고 `anon`·`authenticated`의 직접 권한을 회수한다. 브라우저 공개키로 메일·토큰·문의 목록을 읽거나 수정할 수 있는 정책을 만들지 않는다. RPC는 `SECURITY INVOKER`, 고정된 빈 `search_path`를 사용하고 실행 권한을 `service_role`에만 부여한다.

Next.js 서버는 `SUPABASE_SECRET_KEY`를 이용한다. 이 키는 RLS를 우회할 수 있으므로 기존 관리자 세션·동일 출처·입력 검증이 서버에서 유지돼야 한다. 공개 문의 폼도 서버 API를 통해 검증·중복 방지·요청 제한 후 저장한다. Secret key는 브라우저 helper·응답·로그·소스 저장소에 포함하지 않는다. Google 토큰은 기존 AES-GCM 암호화 키로 보호하고, DB에 원문 access/refresh token을 저장하지 않는다.

## 설정과 실행

패키지는 `@supabase/supabase-js@2.117.2`, `@supabase/ssr@0.12.7`로 고정하고 lockfile을 관리한다. 브라우저/서버 helper와 Next.js 16의 `src/proxy.ts`를 구성했다. Proxy는 Supabase Auth 쿠키가 있을 때 `getClaims()`를 통해 갱신하고 쿠키·캐시 헤더를 보존한다. 현재 운영관리 인증은 별도의 회사 관리자 세션을 사용한다.

| 환경변수 | 값 또는 용도 |
| --- | --- |
| `OPERATIONS_STORE` | 회사 업무 저장은 `supabase`; 격리 오프라인 테스트는 `sqlite` |
| `NEXT_PUBLIC_SUPABASE_URL` | 지정 회사 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 브라우저에 사용할 공개 publishable key |
| `SUPABASE_SECRET_KEY` | 서버 전용 key, `NEXT_PUBLIC_` 접두어 금지 |
| `APP_BASE_URL` | 현재 `http://127.0.0.1:3002` |
| `LOCAL_OPERATIONS_ENABLED` | 현재 로컬 관리자/Google 흐름은 `true`와 loopback 주소 필요 |
| `LOCAL_OWNER_PASSWORD` | 현재 로컬 관리자 로그인용 비밀번호 |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | 기존 64자리 hex 키 유지, 앱/worker에서 동일하게 사용 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 실제 Google OAuth 단계에서 별도 설정 |
| `LOCAL_OPERATIONS_DB_PATH` | `sqlite` 격리 테스트만 사용, Supabase 저장 위치와 무관 |

`npm run setup:local`은 파일이 없을 때만 `.env.local`을 생성하고 기존 설정은 보존한다. 신규 파일은 Supabase 저장소 선택과 무작위 관리자 비밀번호·암호화 키를 포함한다. 공개키·서버 키를 직접 입력하고 스키마 적용을 확인한 후 실행한다. `.env.example`에는 비밀 값을 넣지 않는다.

```sh
npm ci
npm run setup:local
npm run dev -- --port 3002
```

읽기 전용 연결 점검은 `npm run test:supabase:connection`으로 실행한다. 승인된 회사 프로젝트 일치, 서버 health/테이블 권한, 유효 공개키의 접근 거부를 확인하며 업무 데이터를 변경하지 않는다.

환경변수를 변경하면 앱과 worker를 재시작한다. 둘은 같은 프로젝트와 저장소 선택·암호화 키를 사용해야 한다. worker는 `npm run integrations:worker -- --once`로 1회 또는 `npm run integrations:worker`로 계속 실행한다. 프로세스가 종료되거나 컴퓨터가 절전 상태일 때 상시 수집을 보장하지 않는다.

## 저장소 전환과 기존 데이터

Supabase 모드에서는 접수 성공을 반환하기 전에 회사 DB 저장이 성공해야 한다. 설정 누락·스키마 누락·권한 오류·연결 장애는 실패로 표시하며 SQLite로 자동 전환하지 않는다. 잘못된 `OPERATIONS_STORE` 값도 오류로 처리한다. 기존 설정 호환을 위해 변수가 없으면 SQLite 경로가 선택될 수 있으므로 회사 사용 설정에는 반드시 `OPERATIONS_STORE=supabase`를 명시한다.

현재 `.env.local`은 `OPERATIONS_STORE=supabase`로 전환했다. 기존 `.local/operations.sqlite`는 문의 0개·Google 연결 0개임을 확인한 뒤 보존했으며 이전할 실제 데이터는 없었다. 이후 다른 저장소를 전환할 때도 자동 삭제·복사하지 않고 문의·전송 대기·Google 연결과 보존 대상을 먼저 확인한다. 합성 QA 데이터와 회사 실데이터를 구분하며 필요하면 별도 이전 절차·중복/암호화 키 검증을 수행한다. SQLite의 성공과 로컬 PGlite의 SQL 테스트는 실제 Supabase 저장 성공을 대신하지 않는다.

## 검증 단계와 현재 상태

1. 지정 프로젝트·로컬 변수의 설정 여부를 비밀 값 출력 없이 확인한다.
2. 마이그레이션을 실제 프로젝트에 적용하고 12개 테이블·RLS·역할 권한·RPC schema health를 조회한다. 다른 프로젝트에 적용하거나 기존 업무 데이터를 초기화하지 않는다.
3. 공개키와 일반 사용자 역할의 테이블/RPC 접근 거부를 확인한다. 서버 키로는 합성 문의 1건을 저장·재조회하고 반복 제출의 중복 방지와 일정 버전 충돌을 확인한다.
4. 실제 앱에서 폼 접수, 관리자 로그인/로그아웃, 문의 조회, 일정 입력, 오류 표시와 재시작 후 보존을 데스크톱·모바일에서 검증한다. Google 설정이 없는 상태에서는 Calendar 전송 완료로 표시하지 않는다.
5. `npm run test:operations`의 SQLite·Gmail·PGlite 기반 Supabase 테스트와 `npm run check`를 실행하고, 실제 클라우드·브라우저 결과와 나눠 기록한다.
6. 데이터 보존과 활성 저장소를 확인한 뒤 29번 Google OAuth 실연동 순서를 진행한다.

회사 프로젝트 SQL Editor에 스키마를 적용했고 서버 health(schema 1)·12개 테이블 조회와 유효 공개키의 접근 거부를 확인했다. 실제 브라우저 합성 문의 저장, 같은 제출 중복 방지/내용 변경 409, 관리자 API 인증·교차 출처 403·일정 버전 409, 390px 관리자 일정 오류/저장, 최종 production build 재시작 후 세션·revision 3 일정 보존을 확인했다. 검증 뒤 해당 합성 문의와 outbox만 정리했다.

같은 Supabase 설정의 worker `--once`는 exit 0으로 끝났으며 라벨·Calendar 미선택에 따라 건너뛰었다. 브라우저 재시작 후 인증 유지·시험 문의 정리와 UI 로그아웃도 확인했다. 브라우저 JavaScript 43개 파일에 서버 key·암호화 키·관리자 비밀번호의 실제 값이 포함되지 않음을 검사했다.

자동 테스트 **39/39**(기존 23+신규 Supabase 16), lint·타입·build가 통과했다. 브라우저 콘솔 error·warning은 확인한 흐름에서 0건이다. 구체적인 실클라우드/API/브라우저와 PGlite 테스트 구분은 [검증 기록](../verification/2026-10-01-supabase.md)을 따른다.

남은 DB 운영 점검은 두 가지다. Supabase security/performance advisors는 MCP 프로젝트 권한 거부로 미확인이다. 또한 Dashboard SQL Editor 수동 적용은 CLI migration history에 등록되지 않았으므로 다음 CLI `db push` 전에 스키마 일치 확인과 공식 migration repair 절차로 이력을 맞춰야 한다. 이미 적용한 생성 SQL을 그대로 다시 실행하지 않는다.

Supabase 검증 당시 Google 클라이언트는 앱에 미설정이었다. 이후 사용자가 OAuth 클라이언트 연동 완료를 알렸으며 현재 앱 반영·실제 Gmail/Calendar 확인을 이어간다. 직원별 Supabase Auth·MFA·역할, 상시 worker, 공개 배포는 대기다.

## 공식 참고

- [Supabase SSR client·Proxy와 쿠키 갱신](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs)
- [Supabase API 키와 서버 Secret key](https://supabase.com/docs/guides/api/api-keys)
- [Data API 권한과 RLS](https://supabase.com/docs/guides/api/securing-your-api)
