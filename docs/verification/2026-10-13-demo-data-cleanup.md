# 회사 테스트 고객·견적·예약 데이터 정리

2026-10-13 · Australia/Sydney · `codex/quote-date-first-flow-20261013`

## 삭제 범위와 결과

사용자가 기존 초안과 10월 12·13일의 `Jimee` 운영 견적도 모두 테스트이며 연결된 일정까지 삭제하라고 확인했다. 회사 Supabase `xlqyafthsxallostcqfe`에서 조회한 ID 목록을 기준으로 삭제했으며, 새 고객·견적을 만들거나 회사 설정을 초기화하지 않았다.

| 대상 | 삭제 결과 |
| --- | --- |
| 운영 견적 요청 | 15건 → 0건 |
| 이전 데모 견적 초안 | 8건 → 0건 |
| 웹·Gmail 시험 문의 | 8건 → 0건 |
| 운영/이전 데모 서명 제출 | 각각 3건/5건 → 0건 |
| AI 분석 작업 | 19건 → 0건 |
| 사진 DB 기록 | 운영 42건 + 이전 데모 5건 → 0건 |
| 실제 비공개 사진 파일 | `quote-photos` 4개 + `live-quote-staging` 1개 + `live-quote-photos` 41개, 총 46개 삭제 |
| Google 연결 시험 일정 | 정확한 연결 ID 14개 중 활성 13개 삭제, 1개는 이미 취소됨 |

예약·기간 점유·견적 승인·회사 제안·문서/PDF·발송 대기·사진 감사·고객 견적 복구 세션 등 연결된 DB 기록도 삭제했다. 조회한 업무 테이블 43개 중 42개가 0행이며, `lk_gmail_seen`만 아래 재수집 방지 ID 4행을 유지한다. 등록 고객 테이블 `lk_customers`는 삭제 전후 모두 0행이다. EMS의 Clients·Quotes·웹/Gmail Enquiries와 Calendar 검토 목록도 회사 Chrome에서 빈 상태로 확인했다.

과거 검증에서 남겼던 **10월 20·21·22·23·29일과 11월 3·5일의 시험 자료/점유**는 이번 명시적 요청으로 정리했다. 이전 검증 문서의 “보존”·“점유 유지”는 당시 실행 기록이며 현재 보관 상태를 뜻하지 않는다.

## 회사 설정 보존과 재수집 방지

- 회사 Google 연결·암호화된 자격 증명·선택된 Gmail 라벨/Calendar, 관리자 세션·이메일 확인 기록·Supabase Auth 사용자 2명·기존 약관 설정을 보존했다. 직원/Auth/약관 데이터의 비교 hash가 동일했다. 최종 Google 연결의 건강 확인 시각은 정상 API 대조 후 갱신됐으며 자격 증명이나 대상은 바뀌지 않았다.
- Storage의 파일은 Supabase Storage API로 삭제했다. 세 비공개 bucket의 설정과 RLS를 유지하며 Storage 메타데이터에 직접 SQL DELETE를 하지 않았다.
- Gmail의 원본 메일·라벨을 삭제하지 않았다. 이미 처리한 시험 메일 4개의 회사 계정/메시지 ID만 남기고 문의 FK를 null로 바꿔, 다음 수집에서 삭제한 본문이 다시 생성되지 않도록 했다. 별도 고객 이름·본문·사진은 이 표에 없다.
- `20261013011739_gmail_import_tombstones.sql`은 `lk_gmail_seen.enquiry_id`의 NOT NULL만 해제한다. 기존 PK·FK·RLS·공개 접근 차단과 importer RPC를 유지한다. 다음에 새로 도착한 고객 답장은 정상적인 새 문의로 수집할 수 있다.

## 실제 실행과 검증

회사 Chrome `Kang (L&K Group)`의 Supabase SQL Editor에서 ID 제한·트랜잭션·업무 테이블 잠금·활성 작업 검사 후 삭제했다. 공유 수집 lease를 잡고 적용했으며 검증 후 해제했다. SQL 결과는 `demo_cleanup_complete / 운영 견적 0 / 데모 초안 0 / 문의 0 / 고객 0 / 재수집 방지 4`다. 실행 query ID는 `dbd5d1fd-c489-4db9-9d35-df2af62b6689`다.

각 Google 일정은 회사 계정의 연결 ID·소유 메타데이터·etag·attendee 없음 확인 후 삭제하고 독립 GET으로 취소를 대조했다. 회사 기본 Calendar와 이전 L&K Integration의 10월 20일~11월 6일 실제 `events.list` 결과는 활성 점유 0건이다. 삭제 확인 메일이나 신규 예약 메일은 발송하지 않았다.

실제 Gmail reader는 같은 4개 메시지를 **중복으로 건너뛰었고 본문 조회 0회·새 문의 후보 0건**이었다. 초기 Calendar 검증의 `freeBusy` 요청은 기존 events 권한에 없는 API여서 403으로 거절됐다. 기존 회사 Calendar 권한을 확대하지 않고 앱이 사용하는 `events.list`로 다시 검증했다. 회사 userinfo·Calendar 목록·Gmail profile의 200 응답을 대조해 연결 건강 상태를 정상으로 복구했다.

- 새 tombstone DB 검사 3개와 기존 Supabase 검사 16개: **19/19 통과**.
- 삭제 후 `npm run test:operations` **723/723**, 아래 세션 복구 수정까지 포함한 최종 검사 **728/728 통과**, 실패·skip 0.
- 세션 복구 DB/API·클라이언트 집중 검사 **30/30** 및 최종 `npm run check`의 lint·타입·production build, `git diff --check` 통과. 삭제 fixture는 합성 DB의 소유자 역할에서만 만들며 실제 서비스 역할의 DELETE 권한을 완화하지 않는다.
- 실제 삭제는 회사 DB/Storage/Calendar 조회로 확인했으며, 합성 DB 테스트와 구분한다. 비공개 실행 증거는 Git 제외 `.local/demo-cleanup/`에 보관하며 키·원문·사진·전체 고객 DB 백업을 문서에 넣지 않는다.

## 삭제된 견적의 브라우저 세션

회사 브라우저에 남은 이전 고객 쿠키는 삭제된 복구 세션을 가리켜 빈 입력 폼을 잠갔다. **열린 견적·미저장 입력이 없고 이메일 접근이 만료된 경우에만 `Reopen quote form`**을 표시하도록 수정했다. 기존 로그아웃 API의 복구 모드는 서버에서 활성 고객 세션을 409로 거절하고, 만료/삭제된 고객 인증·challenge 쿠키만 해제한다. 유효한 브라우저 작성 쿠키와 직원 쿠키를 보존하므로, 만료된 이메일 접근 뒤에 가려진 미연결 guest 초안도 접근을 잃지 않는다. 일반 로그아웃과 저장 견적의 새 작성 보호 조건은 그대로다. 인증/DB 장애는 401로 오인하지 않고 실패한다.

회사 Vercel `prj_GVXTidyYCj4zapcEkRpZWOsaXHq6` / `lnkgroupsydney-8702`에 현재 작업 트리를 배포했다. **`dpl_Hi8QUZ53nHrmgqS815ymri71ptLK` / Production READY**이며 www·apex·기존 Vercel 별칭을 확인했다. 배포 검증 당시에는 미커밋 작업 트리였으며 후속 Git 통합 기록은 README 최신 항목을 따른다.

회사 Chrome의 실제 만료 화면에서 **복구 버튼 한 번 → 빈 고객 정보 폼 입력 활성화 → 페이지 Reload 후에도 빈 폼/활성 입력 유지**를 확인했다. EMS Quotes를 다시 열고 Reload해 **기존 관리자 로그인·견적 0건**도 대조했다. 이어서 고객·운영 견적·데모 초안·문의·확정 예약·점유·운영 서명·고객 복구 세션 8개 표를 실제 조회해 모두 0행임을 확인했다. 복구 검증 중 신규 견적 저장·사진 업로드·이메일 발송은 하지 않았다.

삭제·브라우저 검증 당시 Git 통합은 미수행이었다. 이후 사용자 요청에 따른 커밋·병합은 README 최신 Git 통합 항목을 따른다.
