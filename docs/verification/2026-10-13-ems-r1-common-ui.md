# EMS-R1 공통 화면·글로벌 CSS·모션 구현 검증

2026-10-13 · Australia/Sydney · 브랜치 `codex/ems-ux-crud-plan-20261013` · 기준 `main@756eb4d`.

현재 수준: **R1 코드·전체 자동 검사·빌드·합성 브라우저 인수 완료**. 최종 실행은 프로젝트 지원 버전 **Node 24.14.1 / npm 11.11.0**이다. 회사 배포/실제 자료 인수와 구분한다. [승인 계획](../esn-admin/10-2026-10-13-ems-ux-crud-implementation-plan.md)의 R1만 이번 구현 단위이며 R2 이후 업무 모델·CRUD는 다음 단위다.

## 구현한 동작

- `admin-tokens/layout/components/motion.css`와 공통 Panel·EmptyState·StatusBadge·PageHeader·Tabs를 관리자 조립 지점에서 재사용한다. 브랜드 원본을 참조하고 `.ems-root`로 페이지·생성 dialog·이탈 dialog까지 범위를 제한한다.
- 그룹 메뉴, 상세 breadcrumb, boundary-aware 경로 판정, 고객/문의/견적/예약 UUID 상세 경로를 추가했다. thin page·직원 경계·기존 API 인가·이전 주소 호환을 유지한다.
- Clients 기본은 목록·검색·페이지 이동이며 `Add client`에서 생성 dialog를 연다. 상세는 Summary·Connected records·Documents·Photos·Activity다. 고객별 연결 사유·멱등 payload를 분리하고 기존 연결/해제·409·응답 유실 복구를 유지한다.
- Enquiries/Quotes는 같은 원본의 목록과 전용 상세 경로를 사용한다. 상세에 연락처/현장/상태 요약과 Summary·Photos & estimate·Booking·Activity 탭을 제공한다. 필터·페이지·선택은 인증된 메모리에만 보존한다.
- 관리자 사진 분석은 금액·미산정 범위·불확실성·이전 자료 여부를 요약하고 전체 분석을 펼칠 수 있다. 고객이 사용하는 `SavedPhotoAnalysis`와 고객 견적 폼은 변경하지 않았다.
- Schedule은 읽은 자료의 고객/현장·상태·Sydney 날짜 필터와 별도 상세 경로를 제공한다. 결과 수는 전체 회사 집계와 구분한 `loaded records`다. 일정을 표시했다고 작업 완료나 수금을 기록하지 않는다.
- 상세 탭은 방문한 내용을 유지해 예약 초안이 사라지지 않는다. 숨긴 탭의 읽기/폴링은 중단하고, 이미 전송한 저장 명령의 결과는 유효한 컴포넌트에 반영한다. 공통 Operations 자동 동기화는 기존 제공자 한 곳에서 유지한다.
- 입력은 16px·최소 48px, 컨트롤 테두리는 기존 strong 브랜드 토큰, 상태는 글자와 함께 표시한다. 포인터 피드백만 짧게 적용하고 키보드/반복 탭 이동·reduced motion은 즉시 반응한다.

## 검토에서 발견해 수정한 항목

| Before | After | Why |
| --- | --- | --- |
| 이전 관리자 UI에서 고객 링크가 신규 상세 경로의 404로 이동 | standalone CustomersConsole은 같은 직원 인증 아래 기존 inline 상세/연결/문서 흐름 유지 | UI 복구 경로를 실제로 사용할 수 있음 |
| 공통 main의 operations 클래스 제거 후 Settings 세션 버튼 스타일 소실 | SessionSecurity 루트에 한정한 공통 버튼 adapter | 기존 조작 영역/활성·확인 동작 유지 |
| 입력 경계가 구분선 색, 예약 입력이 15px 상속 | strong control border와 EMS 예약 입력 16px·48px | 필드 가독성과 터치 크기 기준 유지 |
| 탭 숨김 직후 돌아오면 취소된 조회의 reading/refreshing 상태가 남을 수 있음 | 숨김 시 read lane 초기화, 이전 finally가 새 read lane에 간섭하지 않도록 controller 비교 | 다음 15초 타이머를 기다리지 않고 다시 조회 |
| 루트/상세 경로와 닮은 이름의 메뉴 혼동 가능 | trailing slash 정규화·경로 경계·UUID 검사 | 상세 메뉴/직접 진입의 일관성 |
| 고객 A의 연결 초안이 다른 고객 상세에서 재사용될 위험 | 고객별 draft key·customerId 확인·경로별 컴포넌트 key | 잘못된 고객 대상 재전송 차단 |
| 320px에서 긴 RQ 참조번호가 화면을 390px로 늘림 | 공통 EMS 패널 제목에 줄바꿈 적용, 전체 폭을 다시 검증 | 콘텐츠를 자르거나 넘침 검사를 완화하지 않고 해결 |
| 예상금액이 긴 연락처 표 아래에 위치 | 요약 금액을 먼저 보여주고 원본 연락처/서비스는 펼침 영역으로 제공 | 주요 금액과 미산정 사항을 먼저 확인 |
| 방문 전 탭의 aria-controls 대상이 없음 | 숨긴 panel wrapper를 유지하고 내부 콘텐츠만 지연 mount | 접근성 연결과 읽기 수명 분리 |

## 실행한 검사

| 검사 | 결과 | 증거/범위 |
| --- | --- | --- |
| `npm run test:operations` | **739/739**, 실패·취소·skip 0 | 기존 업무/인가/DB/원본 검사 + 새 경로 3·일정 필터 5·실제 React 분석 요약 3 |
| `npm run check` | 통과 | lint 경고 0, Next typegen/TypeScript, production build |
| fixture 격리 계약 | **1/1** 통과, 전체 검사에도 포함 | 새 live 원본/상세 API 로컬 합성·원격 API/자격 증명 전달 차단·응답 유실/멱등 결과 |
| 합성 R1 브라우저 | **13/13**, skip 0 | Node 24 production build, 실제 Chromium 격리 프로필 |
| legacy 직원 UI | **1/1**, skip 0 | inline 고객 상세/연결/문서·dialog·404 상세 경로 미사용 |
| 제공자·CSS 추가 브라우저 | **4/4** | 이전 주소 5개·admin/owner 경계·단일 제공자/60초 sync·401 중단·공개 KCP 스타일 |
| 문서·변경 형식 | 통과 | 변경 텍스트 40개·로컬 Markdown 링크 365개, `git diff --check`, 기존 사용자 문구 보존 |
| 실제 회사 배포/CRUD 인수 | 이번 미실행 | SQL/DB·업무 API·회사 배포 변경 없음 |

초기 lint는 Schedule cleanup ref 경고로 실패했다. 무효화 callback으로 수정한 뒤 전체 check를 다시 실행해 통과했다. 첫 셸 실행의 Node 26은 프로젝트 지원 범위 밖이므로 최종 자동 검사·빌드·브라우저를 설치된 Node 24.14.1·npm 11.11.0에서 다시 실행했다. 기존 `MODULE_TYPELESS_PACKAGE_JSON`·SQLite 실험 경고는 런타임 안내이며 lint/type/build 실패와 구분한다. 추가 브라우저 실행기의 지원되지 않는 clock 해제 호출은 별도 context로 수정해 4개 검사를 모두 완료했다.

## 합성 브라우저 확인 내용

1. 미인증·비밀번호 변경·이메일 확인·MFA 등록/확인 5단계에서 신규 상세의 회사 API 호출 0.
2. 목록/신규 4종 상세에서 H1 한 개·활성 메뉴·breadcrumb, 검색/페이지와 뒤로가기 복원.
3. Add client dialog의 Escape·초점 복귀·미저장 폐기·입력 보존.
4. 실제 합성 저장이 완료된 뒤 응답 503 유실을 주입하고 같은 payload/key 재시도로 고객 1명 유지.
5. 원본 연결의 409·사유 보존·재확인, 연결/해제 감사와 원본 유지, 결과 유실 후 같은 명령 복구.
6. 견적 요약에 저장된 금액·미산정 범위 표시, 모든 탭의 ARIA 대상 존재, 검색으로 목록 복귀.
7. 지연된 회사 조회를 중단한 뒤 Booking 탭에 즉시 복귀·갱신 가능, 초안 유지·이동 보호.
8. 보이는 예약 상세의 15초 폴링과 숨긴 탭의 중단, 숨긴 탭에서 이미 전송한 초안 PUT 1회의 저장 결과 반영.
9. 분석 중인 사진의 5초 폴링과 숨김 중단, 일정의 읽은 결과 날짜/상태 필터·원래 take-off·필터 복원.
10. 6개 목록/상세/dialog 화면 × 320/390/768/1280/1440px, 키보드 End와 panel 관계, reduced motion `none / 0s`, 인증 상실 뒤 업무·입력 제거.

메인 실행의 외부 요청·pageerror·예상 밖 HTTP 오류는 **0**이다. 콘솔의 오류 3개는 명시적으로 주입한 **503(고객 응답 유실) / 409(연결 revision 충돌) / 503(연결 응답 유실)**에 대응하며 별도로 집계했다. legacy 실행은 콘솔 오류도 0이다. 제공자 추가 검사는 페이지 예외·외부 요청 0이다.

공통 Operations 제공자는 메뉴 이동 중 session 조회 1회, 가상 60초 이후 sync 1회, 401 이후 120초 추가 경과에도 새 sync가 없었다. 공개 KCP의 실제 body·H1·견적 버튼 계산 스타일은 EMS CSS 4개를 추가한 전후 동일했다. 이 검사는 전체 공개 고객 흐름의 새 수동 인수를 대신하지 않는다.

### 실행 화면

주 에이전트와 QA implementer가 실제 저장 파일을 열어 확인했다. 모든 고객·주소·금액은 합성 검증 자료다.

- [Clients 데스크톱](assets/ems-r1-clients-20261013.png)
- [견적 상세와 예상금액](assets/ems-r1-quote-20261013.png)
- [Schedule 모바일](assets/ems-r1-schedule-mobile-20261013.png)

## 로컬 HTTP와 검증 환경

- 새 worktree는 기존 설치 dependencies를 symlink로 재사용했다. `.gitignore`는 dependency 디렉터리와 symlink를 모두 제외한다. 라이브러리를 추가하거나 버전을 변경하지 않았다.
- production UI 원본 `127.0.0.1:3020`, 합성 fixture `3021`. 같은 빌드의 legacy UI 원본 `3022`, 합성 fixture `3023`를 회귀 검사에 사용한다.
- 실제 회사 `.env`/브라우저 쿠키를 옮기지 않았다. 원본 앱의 익명 `/admin`·신규 상세는 로그인 shell 200/noindex다. 회사 설정 없는 원본 API는 503/private no-store로 닫히며 이를 실제 회사 401 인수라고 보고하지 않는다.
- legacy 원본 `/admin`은 200, 신규 고객 상세는 404를 확인했다. 합성 ready 세션에서 inline 고객 업무가 유지되는지는 별도 브라우저 인수 대상이다.
- fixture는 모든 API를 로컬에서 처리하고 Cookie/Authorization/Set-Cookie를 UI upstream으로 전달하지 않는다. 승인된 페이지/UUID 상세/정적 자산만 전달하며 예외 API를 회사 서버로 프록시하지 않는다.
- 최종 로그: `/tmp/lk-ems-r1-tests-final.log`, `/tmp/lk-ems-r1-check-node24.log`, `/tmp/lk-ems-r1-browser-node24.log`, `/tmp/lk-ems-r1-legacy-node24.log`, `/tmp/lk-ems-r1-effects-final.log`.

## 재현 명령

```sh
node --version # v24.14.1
npm --version # 11.11.0
npm run test:operations
STAFF_ADMIN_AUTH_ENABLED=true APP_BASE_URL=http://127.0.0.1:3020 npm run check
STAFF_ADMIN_AUTH_ENABLED=true APP_BASE_URL=http://127.0.0.1:3020 npm run start -- --port 3020
EMS_FIXTURE_PORT=3021 EMS_FIXTURE_UPSTREAM=http://127.0.0.1:3020 node scripts/verify-esn-ui-fixture.mjs
node scripts/verify-ems-r1.mjs --base http://127.0.0.1:3021 --playwright /Users/jimee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs --channel chrome
```

legacy는 `STAFF_ADMIN_WORKSPACE_UI=legacy`·3022 원본과 3023 fixture에서 같은 runner에 `--legacy`를 전달한다. 제공자/CSS 검사는 별도 3025 fixture에서 `scripts/verify-ems-r1-effects.mjs --base http://127.0.0.1:3025 --public-base http://127.0.0.1:3020`으로 실행하며 같은 `--playwright / --channel`을 사용한다. 실행기가 marker 없는 외부 origin을 거부한다.

회사 자료의 스냅샷·발송·Google 일정·고객 생성은 실행하지 않았다. 물리 기기의 실제 키보드/터치·200% 수동 확대, 회사 로그인에서 새 UI 인수, R2 고객 중복/현장 CRUD, R3 서버 초안 저장/취소·일/주 캘린더와 R4 집계는 이번 R1 검사와 별도다. 합성 초안 PUT 결과 검증을 새로운 운영 Save draft API 구현 완료로 해석하지 않는다. 커밋·merge·push·배포도 수행하지 않았다.

관련 문서: [계획](../esn-admin/10-2026-10-13-ems-ux-crud-implementation-plan.md), [진행표](../esn-admin/05-progress.md), [전체 TODO](../plans/15-home-cabinet-admin-todo.md).
