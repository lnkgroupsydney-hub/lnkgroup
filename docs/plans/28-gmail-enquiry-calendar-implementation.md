# Gmail 문의 수집 → 회사 검토 → Google Calendar 구현

2026-09-30 · 사용자 후속 구현 요청 · [전체 TODO](15-home-cabinet-admin-todo.md) · [Calendar 계약](27-kcp-google-calendar-sync.md)

**2026-10-01 저장소 변경:** 사용자 요청에 따라 [30번 Supabase 연결](30-supabase-storage-integration.md)을 우선 진행한다. 신규 업무 데이터는 지정 회사 Supabase 프로젝트에 저장하는 방향이며, 아래 9월 30일 SQLite 검증 기록은 당시 결과로 보존한다. 실제 Supabase 스키마 적용·저장/접근 차단·모바일 일정 변경·재시작 보존 검증을 완료했다. [10월 1일 검증](../verification/2026-10-01-supabase.md)에 자동 테스트 39개·lint/타입/build 결과와 남은 점검을 구분했다. 이후 회사 OAuth와 실제 Gmail 수신/답장·Calendar 양방향 검토를 확인했고, 부분 실패 처리 보강 후 테스트는 44개가 통과했다. [Google 실검증](../verification/2026-10-01-google-oauth-live.md)에 남은 항목을 구분한다.

**2026-10-01 후속 계획:** 회사 OAuth 설정부터 Gmail·Calendar 실연동, 자동 수집·재시작·재연결과 사용 전환까지의 순서·완료 기준은 [29번 실행 계획](29-google-oauth-live-verification-plan.md)을 따른다. 회사 연결·핵심 왕복 검증을 마쳤고 자연 토큰 갱신·재연결·운영 대상 전환은 대기다. 아래 9월 30일 검증 결과를 실제 Google 연결 성공으로 변경하지 않는다.

## 이번 범위

사용자는 P0 이후 구현을 요청하고 디자인 상세보다 기능, 오류 수정 후 다음 단계 진행을 우선했다. ‘이메일 연동’은 **회사 Gmail로 받은 문의 메일까지 자동 수집**하는 뜻으로 확인했다. 회사 계정은 `Lnkgroupsydney@gmail.com`이며 9월 30일 당시 Google OAuth 클라이언트는 준비 전이었다. 최신 연결 상태는 위 10월 1일 항목을 따른다. AI·Resend 등 후속 API는 이번 기능 이후에 진행한다.

이번 구현은 P1 고객 요청·관리 화면, P2 로컬 영속 저장·접근 보호, P3 회사 Google 연결·Gmail 문의함, P6 요청/제안 일정의 Calendar 반영을 연결하는 범위다. P5 가격표가 없는 상태에서 예약 확정을 구현했다고 표시하지 않는다. 근무시간·기간 산식과 정찰제는 사용자 보류를 유지한다. 최종 프로젝트 Complete·발행일 +3일 인보이스 정책은 27번에 보존하고 청구·결제 실행은 후속 단계다.

## 기능 흐름과 데이터 기준

1. KCP 견적 버튼 → 작업 범위·지역·연락처·희망 날짜 입력 → 서버 저장 후 접수 번호. 사진 저장·AI·정찰제는 준비 상태를 설명하며 임의 결과를 만들지 않는다.
2. 회사 관리자 로그인 → 지정 Google 계정의 OAuth 승인 → **문의 Gmail 라벨과 작업 Calendar를 각각 선택**한다. 기본 받은편지함/개인 캘린더를 임의 선택하지 않는다.
3. 선택한 Gmail 라벨의 수신 메일을 수집한다. 제목·발신 표시·본문 텍스트·첨부 존재 여부와 원본 메시지 참조를 비공개 문의함에 저장한다. 같은 계정·메시지 ID는 중복 접수하지 않고, 같은 Gmail 대화의 후속 수신 메일은 **새 메시지 자체도 선택 라벨에 포함된 경우** 기존 문의에 연결한다. 보낸 편지·초안·Spam/Trash는 수집하지 않는다. 본문을 길이 제한으로 줄이면 그 사실을 표시하고 대화는 최신 30개 메시지의 제한된 이력을 보관한다. 과대·잘못된 메시지는 ID/실패 이유를 별도 검토 목록에 남기고 나머지 수집을 계속한다. 일시적인 API 실패는 페이지를 성공 처리하지 않고 재시도한다. 첨부파일 다운로드·AI 분석·답장·읽음 처리는 이번 범위에 없다.
4. 메일의 발신 주소만으로 기존 고객 계정을 합치지 않는다. 자유 서술 날짜를 예약으로 자동 확정하지 않으며, 날짜가 없는 메일은 검토 대기다. HTML·링크·첨부·본문을 실행하지 않는다.
5. 담당자가 Sydney 날짜·시작·종료를 입력한다. 서버 검증 후 요청/제안 이벤트를 Calendar에 비차단으로 반영한다. 고객 수락·가격·근무/자원 정책이 없는 상태는 **미확정 제안**으로 표시한다.
6. Google에서 수정·삭제한 관리 이벤트는 앱 검토함으로 가져온다. 오래된 버전·충돌·잘못된 시간은 자동 덮어쓰지 않고 검토한다. 수정 승인과 예약 확정은 별개다.
7. 연결 실패에도 문의를 보존하고 대기·실패·재시도를 표시한다. 재전송·응답 유실로 같은 문의의 Calendar 이벤트를 중복 생성하지 않는다.

Google 이벤트에는 접수 번호·상태·권한이 필요한 앱 링크만 넣는다. 고객 이메일·전화·메일 본문·사진을 Calendar에 복사하거나 고객을 참석자로 자동 초대하지 않는다.

## 로컬 기반과 자동 수집의 실행 조건

9월 30일 구현은 별도로 켠 로컬 SQLite 저장소를 사용했고 해당 검증 기록을 보존한다. 10월 1일 이후 기본 업무 저장은 `OPERATIONS_STORE=supabase`로 지정 회사 프로젝트를 사용한다. 문의·관리자 세션·회사 OAuth 상태·암호화된 토큰·일정 동기화 데이터는 서버 전용 RPC를 통해 저장한다. `OPERATIONS_STORE=sqlite`는 격리된 오프라인 테스트에 사용하며 Supabase 오류가 나도 조용히 SQLite로 저장하지 않는다. 기존 SQLite 내용은 자동 이전·삭제하지 않는다. 저장소 변경의 실제 권한·보존 검증은 [30번](30-supabase-storage-integration.md)을 따른다.

자동 수집은 실행 중인 polling 작업이 필요하다. 관리자 화면이 열려 있는 동안의 주기 수집과 별도 로컬 worker의 상태를 구분한다. 앱/worker가 종료된 동안 계속 수집된다고 표시하지 않는다. 운영 HTTPS watch·상시 worker·공개 배포는 후속 운영 환경에서 검증한다.

## Google 최초 설정 순서

1. 지정 회사 계정으로 [Google Cloud Console](https://console.cloud.google.com/)에 로그인한다. 회사 소유 프로젝트를 선택하거나 회사가 사용할 프로젝트를 준비한다.
2. 해당 프로젝트에서 **Google Calendar API**와 **Gmail API**를 활성화한다.
3. Google Auth Platform의 Branding/Audience/Data Access를 설정한다. 회사 Gmail 계정 기준 테스트 사용자는 `Lnkgroupsydney@gmail.com`으로 지정한다. Workspace 조직 내부 앱 권한을 가정하지 않는다.
4. OAuth **Web application** 클라이언트를 만들고 `http://127.0.0.1:3002/api/google/callback`을 Authorized redirect URI에 등록한다. 다른 포트·localhost/127.0.0.1 혼용은 허용 URI와 `APP_BASE_URL`을 함께 맞춘다.
5. Client ID/Client Secret은 서버의 로컬 환경변수에 넣는다. 채팅·브라우저 입력 폼·커밋에 비밀키를 넣지 않는다. 앱의 설정 상태를 확인한 뒤 회사 Google 계정으로 연결한다.
6. Gmail에서 문의용 라벨을 준비하고, 문의 메일을 그 라벨로 분류하는 필터를 설정한다. 앱에서 해당 라벨과 회사 계정이 소유한 Calendar를 선택한 후 시험 메일·일정으로 확인한다. 이벤트 연결이 생긴 DB에서 다른 Calendar로 바꾸려면 별도 이전 검토가 필요하다.

요청 scope는 `openid`, `email`, `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, `https://www.googleapis.com/auth/calendar.events.owned`다. **선택 가능한 Calendar는 회사 계정이 소유한 Calendar**다. Gmail의 읽기 권한 자체가 특정 라벨만으로 제한되는 것은 아니며 앱은 선택한 라벨만 수집한다. Gmail 보내기·수정 권한은 요청하지 않는다. [Gmail 권한](https://developers.google.com/workspace/gmail/api/auth/scopes), [Calendar 권한](https://developers.google.com/workspace/calendar/api/auth)

External 앱의 Testing 상태에서는 이번 scope 조합의 refresh token이 7일 만료 조건에 해당하므로 재연결이 필요할 수 있다. 테스트 사용자 등록과 실제 운영용 Google 검증은 별개다. [OAuth 테스트 모드 조건](https://developers.google.com/identity/protocols/oauth2), [OAuth 서버 흐름](https://developers.google.com/identity/protocols/oauth2/web-server)

Google·관리자 서버 설정 계약은 다음과 같다. 이 표의 비밀 설정에 `NEXT_PUBLIC_` 접두어를 붙이지 않는다. Supabase의 공개 URL·publishable key와 서버 전용 Secret key는 [30번 환경변수 표](30-supabase-storage-integration.md)를 따른다.

| 환경변수 | 용도 |
| --- | --- |
| `APP_BASE_URL` | 로컬 기본 `http://127.0.0.1:3002`; OAuth callback·동일 출처 검사 기준 |
| `LOCAL_OPERATIONS_ENABLED` | loopback 앱의 관리자 비밀번호·Google 연결 활성화. 저장 위치는 `OPERATIONS_STORE`로 별도 지정 |
| `LOCAL_OWNER_PASSWORD` | 로컬 관리자 접근용. Google 비밀번호와 별개 |
| `GOOGLE_CLIENT_ID` | 회사 OAuth Web application의 Client ID |
| `GOOGLE_CLIENT_SECRET` | 같은 클라이언트의 서버 전용 Secret |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | 저장 OAuth 토큰 암호화용 64자리 hex 키. 연결 후 임의 재생성 금지 |
| `LOCAL_OPERATIONS_DB_PATH` | `OPERATIONS_STORE=sqlite` 격리 테스트의 DB 위치. Supabase 경로에서는 사용하지 않음 |

환경변수 이름과 설정 유무만 앱에 표시하며 실제 비밀 값은 반환하지 않는다. 설정 파일은 `.env.local`이고 Git 제외 대상이다. OAuth 실연결은 회사 클라이언트 설정 후 별도로 검증한다.

## 로컬 실행

Node.js 24 / npm 11을 사용한다. 저장소 루트에서 최초 설정을 만든다.

```sh
npm run setup:local
npm run dev -- --port 3002
```

`setup:local`은 파일이 없을 때만 `.env.local`에 Supabase 저장소 선택, 무작위 관리자 비밀번호와 토큰 암호화 키를 생성한다. 회사 Supabase 공개키·서버 키와 스키마 준비는 [30번](30-supabase-storage-integration.md)을 따라 완료해야 한다. 기존 파일을 덮어쓰지 않고 비밀 값을 터미널에 출력하지 않는다. `.env.local`의 `LOCAL_OWNER_PASSWORD`로 [관리 화면](http://127.0.0.1:3002/admin)에 로그인한다. Google 비밀번호를 이 화면에 입력하지 않는다. [고객 요청 폼](http://127.0.0.1:3002/quote/start?service=cabinet-painting)은 Google 연결 전에도 준비된 Supabase DB의 접수를 확인할 수 있다.

회사 OAuth 클라이언트를 준비하면 같은 파일의 빈 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`에 값을 넣고 앱을 재시작한다. 기존 `GOOGLE_TOKEN_ENCRYPTION_KEY`를 유지한다. 관리 화면에서 Google 연결, Calendar 저장, Gmail 라벨 저장, **Sync now** 순서로 확인한다. 실제 회사 메일을 처음 수집하기 전에는 문의용 라벨 범위를 확인한다.

관리 화면을 닫아도 수집하려면 별도 터미널에서 아래 로컬 worker를 실행한다.

```sh
npm run integrations:worker
```

한 번만 확인하려면 `npm run integrations:worker -- --once`를 사용한다. 연결/선택 전에는 가져오기·전송 건수가 0이며 실제 연동 성공을 뜻하지 않는다. worker가 실행 중인 동안 60초 간격으로 Gmail·Calendar를 확인한다. 앱과 worker는 같은 `OPERATIONS_STORE`·Supabase 프로젝트·암호화 키를 사용해야 한다. 같은 저장소의 동기화 잠금으로 화면 polling과 중복 실행을 조정한다. 컴퓨터 절전·앱/worker 종료·Google 연결 만료 중에는 상시 수집을 보장하지 않는다. 실제 운영용 상시 실행 환경은 후속 단계다.

## 검증 기준

| 구간 | 확인할 실패·경계 | 통과 기준 |
| --- | --- | --- |
| 문의 저장 | 잘못된 입력·중복 전송·응답 유실·재시작 | 유효 문의만 1회 저장, 원본 보존, 오류 입력 유지 |
| 관리자 접근 | 미로그인·잘못된 비밀번호·교차 출처·세션 만료 | 비공개 메일/문의 접근·변경 차단 |
| Google 연결 | 키 없음·잘못된 state·다른 Google 계정·권한 회수 | 정직한 설정/재연결 안내, 계정 우회·비밀 노출 없음 |
| Gmail 수집 | 여러 페이지·같은 메일 재등장·같은 대화의 답장·MIME/HTML·API 실패 | 선택 라벨만 수집, 메시지 중복/대화별 중복 문의 없음, 텍스트로 안전하게 표시, 실패 후 복구 |
| 일정 | 종료≤시작·과거·Sydney DST·수정 중 경합 | 잘못된 구간 거절, 미확정 상태 보존, 오래된 수정 차단 |
| Calendar 동기화 | 생성 응답 유실·etag 충돌·페이지/410·외부 수정/삭제 | 중복 이벤트·무조건 덮어쓰기 없음, 검토와 재시도 가능 |
| 화면 | 데스크톱/모바일·키보드·오류·CTA | 실제 접수/검토 흐름 완료, 가로 넘침/핵심 콘솔 오류 없음 |

가짜 Google 전송 계층의 자동 테스트와 회사 계정의 실제 OAuth·메일 수집·Calendar 왕복 시험은 별도 증거로 기록한다. 실제 연결과 핵심 왕복은 [10월 1일 Google 검증](../verification/2026-10-01-google-oauth-live.md)에서 확인했으며, 자연 토큰 갱신·재연결·운영 전환 등 남은 항목은 완료로 표시하지 않는다.

## 2026-09-30 구현·검증 결과

이번 로컬 구현을 마쳤다. `npm run check`와 `npm run test:operations`의 **23개 테스트**가 통과했다. 실제 브라우저에서 폼 접수·관리자 로그인/로그아웃·미확정 일정 저장·모바일 이동·안전한 메일 표시와 서버 재시작 후 데이터 보존을 확인했다. 구체적인 폭·테스트 데이터·미검증 범위는 [검증 기록](../verification/2026-09-30-gmail-calendar.md)에 남긴다.

9월 30일 당시 이 작업 기기의 `.env.local`을 생성했고 Google client ID/secret은 비어 있었다. 10월 1일 사용자가 OAuth 클라이언트 연동 완료를 알렸으며 앱 반영·실제 Google 연결 검증은 확인 중이다. 마지막 단계는 위 안내에 따른 회사 OAuth 설정과 실제 Gmail→앱→Calendar 왕복 시험이다. 전체 P1~P8, 상시 운영 환경, AI/Resend, 확정 가격·예약·청구 완료로 표시하지 않는다.
