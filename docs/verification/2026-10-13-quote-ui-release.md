# 견적 UI·UX main 통합과 운영 배포

2026-10-13 · Australia/Sydney · 사용자 요청: 현재 견적 UI·UX 변경을 커밋하고 main에 병합한 뒤 운영 배포.

## Git과 배포 결과

- 회사 `origin`: `git@github.com:lnkgroupsydney-hub/lnkgroup.git`. 개인 `legacy-origin`은 사용하지 않았다.
- 릴리스 브랜치 `codex/quote-entry-release-20261013`, 구현 커밋 `f3d5d944a1603fa5c3b77d027efefa9f1b6959dc`(29개 파일).
- 기존 회사 main `cc5a29f`에 충돌 없이 병합: `4bb0b80a001b758f2cb4b681a7f9c744e8aaae30`. 병합 트리와 구현 커밋 트리는 동일하다. 두 원격 브랜치 SHA를 확인했다.
- 회사 Vercel `lnkgroupsydney-8702 / lnkgroup`, project `prj_GVXTidyYCj4zapcEkRpZWOsaXHq6`, team `team_wxpVLa8lqL0xuCzFcAyIXJnv`의 기존 Git 자동 배포를 사용했다. 새 프로젝트나 환경·연동·비용 설정은 만들지 않았다.
- 브랜치 Preview `dpl_A6D6hC7V1RX81WzcpmwdDuQkiPMs` READY / Vercel status success 확인 후 main을 반영했다.
- Production `dpl_3CAYjvbR6qHxTv2Jj9Nf6a6s9Pz3` READY, source SHA `4bb0b80…`, 운영 alias 적용을 확인했다. [배포 메타데이터](2026-10-13-quote-ui-release/production-deployment.json).
- [운영 견적 화면](https://www.lnkgroupsydney.com.au/quote/start). apex 주소는 www로 HTTP 308 이동하며 www는 HTTPS 200이다.

main의 이전 홈·Cabinet·원페이지 견적·필드 검증·방문일 단일 인증 변경은 조회 시점에 이미 `cc5a29f` Production에 자동 배포돼 있었다. 이번 커밋은 새 작성/기존 조회 진입 분리·권한 있는 연락처만 사전 입력·기존 자료 보존과 동시 요청 복구 보완을 추가한다. DB migration·RPC·환경변수·의존성·Vercel/cron 설정 변경은 없다. 공유 원본 체크아웃과 다른 작업트리는 보존하고 별도 관리 작업트리에서 통합했다.

## 검증

- 제품 `src`·`public`와 빌드 설정·lockfile 등 474개 파일이 최종 로컬 검증 스냅샷과 SHA-256 기준으로 동일하다. OS `.DS_Store`는 비교/배포에서 제외한다.
- 해당 동일 코드의 전체 operations **767/767**, 관련 **37/37**, 실제 API fixture **4/4**, lint·타입·production build와 로컬 브라우저 **40/40** 결과를 재사용한다. [상세 경계 검증](2026-10-13-quote-entry-contact-prefill.md).
- 읽기 전용 pre-landing 검토에서 P1/P2 병합 차단 결함을 발견하지 못했다. 제품 diff SHA-256: `172a051ca564ec7c8a5c15b0585dcd32ec7b9afc4dec7b5e711faacce398a6c4`.
- Vercel Preview/Production build와 커밋 status success를 실제 확인했다. GitHub Actions run API는 해당 커밋에 0건을 반환했다. 별도의 GitHub Actions 검사가 통과했다고 주장하지 않는다.
- 실제 운영 응답을 사용하는 Playwright의 데스크톱1280×800·모바일390×844 검사 **107/107 통과**. [최종 결과](2026-10-13-quote-ui-release/production-results.json).
- 두 시작 카드·기존 보기/복귀·키보드 진입·새 연락처/주소/설명/동의 초기 상태·입력 type/숫자 키보드·이메일/호주 전화/이름/우편번호 실제 validity·견적 미생성·홈/캐비넷200·가로 넘침·화면/리소스를 확인했다. pageErrors·console 경고/오류·차단 요청·실패 요청은 0이다.
- 실제 화면 [데스크톱 진입](2026-10-13-quote-ui-release/desktop-entry.png)·[모바일 진입](2026-10-13-quote-ui-release/mobile-entry.png)·[데스크톱 새 폼](2026-10-13-quote-ui-release/desktop-new-empty.png)·[모바일 새 폼](2026-10-13-quote-ui-release/mobile-new-empty.png)을 시각 점검했다.

최초 운영 검사에서 검사기가 DOM `maxlength=4`를 가정해 우편번호 assertion 두 개를 실패했다. 제품은 정확한 네 자리 pattern과 `setCustomValidity`로 검증한다. 숫자 키보드/실제 패턴을 대조하고 `abc`·`20000`·`200` 거절, `2000` 허용을 실제 입력으로 검증하도록 검사기를 수정했다. 제품을 바꾸거나 실패 검사를 제거하지 않았다. [최초 결과](2026-10-13-quote-ui-release/initial-results.json)를 보존한다.

## 데이터 보호와 남은 인수

운영 smoke는 새로운 익명 브라우저만 사용했다. 기존 고객 권한/견적이 없음을 먼저 확인하고 빈 인증 세션 및 `start-new` 전환 POST 6개만 허용했으며 실제 200 응답을 대조했다. 개인정보 입력은 브라우저에만 남겼고 저장/인증 제출을 누르지 않았다. 견적·연락처·사진·AI·이메일·예약·Calendar mutation과 외부 origin은 차단하도록 검사했다. 견적 GET의 `request:null`을 대조했다. 빈 익명 인증 세션 생성과 회사 업무 자료 변경을 구분한다.

실제 고객 로그인·연락처 사전 입력·기존 고객 견적 내용은 운영에서 열거나 독립 감사하지 않았다. 그 보존/복구 경계는 앞의 실제 쿠키/API/PGlite 합성 검사에 근거한다. 이메일 배달·실제 사진 AI·Google Maps·Calendar·실물 휴대폰은 이번 운영 smoke에 포함하지 않는다. 회사 Google Maps 키·API·결제 준비 대기는 계속 남아 있으며 준비 전에는 수동 주소 입력을 사용한다.

이 기록의 후속 문서 커밋은 제품 코드를 바꾸지 않는다. 이하 README/TODO와 기존 검증 문서의 미커밋·미병합·미배포 설명은 각 작업 당시의 결과다. 최신 운영 상태는 이 기록을 따른다.
