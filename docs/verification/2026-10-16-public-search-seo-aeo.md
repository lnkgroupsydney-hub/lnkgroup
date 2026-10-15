# 공개 검색 SEO·AEO 1~2단계 검증

2026-10-16 · Australia/Sydney · [구현 계획](../plans/54-public-search-seo-aeo-foundation.md)

## 구현

Production의 검증된 `www.lnkgroupsydney.com.au`에서 홈페이지·Kitchen Cabinet Painting 및 중앙 설정에 등록된 홍보 이미지에만 검색을 허용한다. 모든 경로의 HTTP 기본값과 root HTML 기본값은 계속 `noindex, nofollow`다. 미등록 경로·관리자·고객 견적·사진·서명 문서·Preview는 공개 예외에 포함하지 않는다.

두 공개 페이지에 고정 canonical·OG URL, 두 URL만 담은 sitemap과 환경별 robots를 추가했다. 공개 HTML에 실제 회사 표시 정보의 Organization과 KCP BreadcrumbList를 연결했다. 거주지 주소·가짜 리뷰·가격 Offer는 추가하지 않았다. 기존 서버 본문·FAQ·디자인·가격·견적 흐름·인증/proxy·DB/RLS/Storage는 수정하지 않았다.

Production 빌드의 배포별 URL은 HTML에 운영 canonical과 index metadata가 있지만 HTTP noindex로 검색을 제외한다. Preview는 별도 빌드에서 HTML·HTTP 모두 noindex이며 robots 전체 제한과 빈 sitemap을 확인했다.

## 실제 완료한 로컬 검증

- 검색 정책 5/5: 환경 누락·개발·Preview·오타·충돌, 정확한 www/두 경로/등록 이미지, Next 실제 헤더 matcher, 유사 호스트·미등록 이미지·최적화 URL 경계.
- 인증·소유권·비공개 미디어/문서 관련 회귀 122/122. 합성 시험이며 실제 회사 제공자 인수와 구분한다.
- lint·타입 검사, Production 및 Preview 각각의 별도 Next 16.3.6 빌드 통과.
- 실제 HTTP Production canonical Host 26/26, 다른 Host 26/26, 별도 Preview 26/26. GET/HEAD·Googlebot·UTM canonical/OG·공개 원본/최적화 이미지·관리자/견적·없는 경로·robots·sitemap·익명 요청/사진/PDF 보호를 확인했다. 로컬 `/api/` 검사는 실제 loopback Host로 요청했으며 운영 쿠키 검증으로 확대하지 않는다.
- 실제 브라우저 KCP 9개 크기, 홈 6개 크기, 모바일 메뉴/키보드 1개, 홈→KCP→새 견적 진입 1개: 총17/17. 가로 넘침·FAQ·메뉴 Escape/focus 복귀·이미지/반응형·console/page 오류를 확인했다. 최신 홈 모바일·KCP 데스크톱 스크린샷도 직접 확인했다.
- 견적 진입 검사는 명시적 start-new logout POST와 자동 session POST, 빈 고객/요청 GET을 브라우저 fixture로 처리했다. 실제 쿠키/고객 기록·AI·OTP·메일·예약을 만들지 않았다.

초기 HTTP 도구의 Host 전송·canonical 끝 슬래시 정규화·비활성 관리자 404·Next 404 복수 robots meta 처리와 UI 도구의 base URL/새 견적 선택 가정을 수정했다. 제품 결함으로 판정하지 않았으며 최초 실패 증거는 로컬 증거 폴더에 구분해 보관했다.

## 운영 반영 및 외부 의존성

현재 운영 main `1e9cbf9daad23f4d0f2381c2d9a4fe1073b77887`에서 격리된 release worktree를 만들고 이번 변경만 적용했다. 공유 원본의 기존 변경은 보존했다. CLI 파일 업로드는 회사 팀/Git 작성자 검사로 BLOCKED였고 운영 alias는 전환되지 않았다. 작성자·권한은 변경하지 않고 기존 회사 Git 연동으로 검증한 소스의 별도 Production 빌드를 준비한다.

회사 Google 계정 `lnkgroupsydney@gmail.com` 로그인은 확인했으나 도메인 Search Console 속성은 접근 불가로 표시됐다. 소유권 인증·사이트맵 제출·URL 검사·AI 포함 설정의 완료 여부는 실제 회사 속성 접근 후 별도로 기록한다. 코드의 검색 허용과 Google 실제 색인·순위·AI 인용은 서로 다른 결과다.

## 운영 배포·인수 완료

검증한 제품 커밋은 `59014a0931c237454265a6272c0e463a56ecd7fc`이며 회사 main에도 fast-forward로 반영했다. 기존 회사 Git 연동의 별도 **Production 빌드** `dpl_BffN6ygbV7Y9LVBByRHMC6QF5ye2`를 READY/STAGED에서 검사하고 승격했다. Preview 빌드를 재사용해 운영 metadata를 바꾸는 방식은 사용하지 않았다. 회사 www의 source SHA와 READY/PROMOTED를 확인했다. 최종 문서 후속 커밋은 제품 코드 변경 없이 결과를 기록한다.

- 배포된 Preview `dpl_5v5MVmxdVyRH9oqcuXrodhgWf2cg`와 staged Production은 회사 CLI 인증으로 각각11개 응답을 확인했다. Vercel Deployment Protection을 해제하지 않았다.
- Preview의 실제 견적 API는 운영 연결이 없어 503 `not configured`로 닫힌다. Preview의 실고객 인증 인수로 확대하지 않는다. HTML·HTTP noindex, robots 전체 제한, 빈 sitemap·고객 데이터 미반환을 확인했다. 최초 도구의 200/401 가정 실패와 수정 결과를 구분해 보관했다.
- 운영 **www의 HTTP 26/26**: 두 공개 페이지 GET/HEAD·Googlebot·UTM canonical/OG, 공개 원본/최적화 이미지, robots·sitemap 2개 URL, 관리자·견적 noindex, 익명 요청 `{request:null}`, 고객 사진/PDF 401 및 `private, no-store`·`Vary: Cookie` 통과.
- 운영 **실제 브라우저4/4**: 홈/KCP 각각1440px·390px, 공개 metadata·canonical·이미지 로딩·가로 넘침·모바일 메뉴/Escape·KCP FAQ 키보드 및 내부 링크 확인. 런타임 오류·HTTP 실패·차단된 외부/쓰기 요청0건. 스크린샷을 직접 확인했다. 고객 견적을 새로 만들거나 열지 않았다.

[운영 HTTP](2026-10-16-public-search/production/http-results.json) · [운영 브라우저](2026-10-16-public-search/production-ui/results.json) · [배포 상태](2026-10-16-public-search/production-deployment.json).

회사 Search Console의 소유권 인증·사이트맵 제출·URL 검사·AI 포함 상태는 미완료다. 회사 계정 로그인은 확인했지만 해당 도메인 속성 접근 불가 안내가 나타나고 자동 제어에서 인증 안내가 열리지 않아 사용자 화면 확인을 요청했다. 실제 Google 색인·검색 순위·AI 인용은 보장하거나 완료로 표시하지 않는다.
