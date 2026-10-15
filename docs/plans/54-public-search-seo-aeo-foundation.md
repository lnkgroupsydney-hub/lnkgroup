# 공개 검색 SEO·AEO 구현 계획

2026-10-16 · Australia/Sydney · 사용자 승인: 계획서 작성 후 1~2단계 적용

목표는 회사 운영 도메인의 홈페이지와 Kitchen Cabinet Painting 소개를 Google 검색 및 검색 기반 AI 답변의 후보로 공개하는 것이다. 검색 등록·순위·AI 인용 자체는 코드 검증과 구분한다. 기존 고객 자료·관리자 인증·Preview 보호를 유지하며 가격·디자인·견적 절차는 이번에 변경하지 않는다. [52번 마케팅 계획](52-kcp-local-seo-aeo-sns-marketing-plan.md)과 2026-10-15 REA 운영 분석의 후속이다.

## 현재 확인한 원인

- `siteConfig.isPrototype=true`가 root HTML의 robots와 모든 URL의 `X-Robots-Tag`에 `noindex, nofollow`를 적용한다. 공개 이미지도 같은 헤더를 받는다.
- 공개 두 페이지는 정상 응답과 서버 HTML 본문·FAQ·개별 메타데이터를 갖추고 있다. canonical·robots.txt·sitemap.xml·공개 사업 구조화 데이터는 없다.
- 공유 폴더에는 기존 작업 변경이 많으며 현재 운영은 최신 회사 main의 별도 배포다. 기존 변경을 되돌리거나 전체 공유 폴더를 무검증 배포하지 않는다.

## 전체 진행 순서

| 단계 | 작업 | 이번 범위와 완료 기준 |
| --- | --- | --- |
| 1 | 공개 검색 제외 정책 분리 | **이번 적용.** Production의 검증된 www 호스트에서 승인된 홈/KCP·등록된 홍보 이미지만 검색 허용. 나머지 URL·Preview·개발/미설정 환경은 noindex 유지 |
| 2 | 검색 발견·대표 URL·SEO/AEO 기반 | **이번 적용.** 페이지별 canonical·OG URL, 공개 두 URL만 담은 sitemap, 환경별 robots와 검색봇 정책, 화면과 일치하는 최소 사업/탐색 구조화 데이터. Search Console의 인증·사이트맵·AI 포함 설정은 실제 회사 계정 접근 후 결과를 별도 기록 |
| 3 | 실제 공정 사진과 링크 약속 일치 | 후속. 회사 제공 사진의 사용 가능 여부 확인 후 현재 안내와 목적지 정합성 개선 |
| 4 | 캐비넷 지역·가격 조건·견적 준비 안내 | 후속. 현재 A$1,450 시작가·GST 미부과 정책과 실제 범위를 유지하며 문구 검토 |
| 5 | Google 비즈니스 프로필 완성 | 후속. 실제 사업명·인증·지역·서비스·사진·리뷰·공식 링크 확인 |
| 6 | 유입→접수→회사 확정→완료 측정 | 후속. 개인정보를 분석 이벤트에 보내지 않으며 클릭과 실제 접수를 구분 |
| 7 | 실제 사례·고객 질문 콘텐츠 확대 | 후속. 검색·문의 데이터를 근거로 보강, 지역명만 바꾼 복제 페이지는 만들지 않음 |

## 1단계: 공개와 비공개 경계

### 기본 정책

1. 검색 허용은 `VERCEL_ENV=production`이고 Preview/development 환경과 충돌하지 않는 경우에만 켠다. `NODE_ENV=production`, 인증용 기준 URL 또는 사용자 Host만으로 허용하지 않는다.
2. root metadata는 계속 `noindex, nofollow`다. 승인된 두 공개 페이지가 Production에서만 명시적으로 이를 덮어쓴다.
3. HTTP 헤더는 모든 경로에 기본 noindex를 유지한다. Production + `www.lnkgroupsydney.com.au` 요청 중 공개 경로에 한해서 뒤의 정확한 규칙으로 `index, follow`를 적용한다. Next 16.3.6의 동일 헤더 마지막 일치 규칙을 사용하며 실제 GET/HEAD로 확인한다.
4. 공개 문서는 `/`, `/services/cabinet-painting` 두 개다. `/services/:path*` 전체를 허용하지 않는다.
5. 공개 이미지는 중앙 `siteAssets`에 등록된 정적 홍보 자산의 정확한 경로만 허용한다. 같은 자산을 요청하는 `/_next/image`의 `url` 질의도 정확한 허용 목록으로 검사한다. `/images/` 전체나 임의 최적화 이미지를 검색 허용하지 않는다.
6. Production 빌드의 고유 배포 URL·다른 별칭도 운영 www 호스트가 아니면 HTTP noindex를 유지한다. Preview는 HTML·HTTP·robots 모두 닫힌 상태다.

### 보존할 보호

- `/admin`, `/quote`, `/api` 등 비공개/업무 URL의 HTML robots와 HTTP noindex.
- 고객 사진·서명 포함 문서·견적 API의 인증·소유권 검사와 `private, no-store`, `Vary: Cookie`.
- 기존 proxy·인증 refresh·쿠키·허용 Host/Origin 기준. SEO를 위해 인증 matcher·세션 처리를 바꾸지 않는다.
- Supabase RLS·Storage·DB·과거 견적·가격·서명·예약·동결 문서. 이번 작업에 migration·고객 쓰기·메일·AI·Calendar 호출은 없다.
- robots는 수집 지침이며 인증이나 개인정보 보호 수단으로 취급하지 않는다.

## 2단계: SEO·AEO 기반

- 기준 URL은 검증된 `https://www.lnkgroupsydney.com.au` 상수다. 요청 Host나 query로 canonical을 만들지 않는다.
- root에 metadataBase만 두고 canonical은 공개 페이지마다 자기 URL로 지정한다. 관리자·견적에 공개 canonical·JSON-LD가 상속되지 않는다.
- Production sitemap에는 두 공개 정규 URL만 넣는다. 허위 변경일을 만들거나 고객 ID·query·사진·문서 URL을 포함하지 않는다. Preview·미설정 환경은 빈 목록이다.
- Production robots는 공개 페이지와 렌더링 자산을 수집 가능하게 하고 관리자·견적·API를 제한한다. Preview·개발/미설정 환경은 전체 수집을 제한하고 sitemap을 안내하지 않는다. 공통 검색 정책을 OAI-SearchBot에도 일관되게 적용하며 GPTBot 학습 허용을 검색 필수 조건으로 추가하지 않는다.
- 공개 HTML에만 실제 표시 사업명·운영 URL·로고·회사 연락처·공식 SNS를 연결하는 Organization과 실제 breadcrumb를 넣는다. 비공개 거주지 주소·가짜 후기/별점·실적·가격 Offer는 추가하지 않는다. FAQ 본문은 보존하고 AI 전용 파일·스키마는 만들지 않는다.
- Search Console은 실제 회사 속성의 소유권·사이트맵 제출·URL 검사·`Settings → Search generative AI` 포함/상속 상태를 확인한다. 계정이나 DNS 접근이 없으면 사이트 코드 완료와 외부 미완료 의존성을 구분한다. 실제 Google/OpenAI IP 접근과 색인·AI 인용은 별도 후속 확인이다.

## 구현 파일과 순서

1. 이 계획서 저장 후 검색 환경/공개 경로·이미지 정책을 `src/shared/seo/`에 작성한다.
2. `next.config.ts`, root와 두 페이지 metadata, `src/app/robots.ts`, `src/app/sitemap.ts`, 공개 구조화 데이터를 연결한다.
3. 환경·호스트·경로·최적화 이미지 경계를 회귀 시험하고 실제 production/Preview HTTP·HTML을 확인한다.
4. 기존 인증/사진/문서 시험, lint·타입·빌드와 대표 브라우저 흐름을 검사한다.
5. README·15번 TODO·검증 기록에 실제 완료 수준을 반영한다. 운영 반영은 현재 회사 배포 소스와 차이를 확인한 격리된 release에서 진행하며 공유 작업의 unrelated 변경을 섞지 않는다. 커밋·push가 배포 경로상 새로 필요하면 그 시점에 필요한 범위를 구체적으로 정리한다.

## 검증 행렬과 인수 기준

| 대상 | 확인할 결과 |
| --- | --- |
| Production + www 홈/KCP GET·HEAD·검색봇 UA | 200, meta·HTTP 모두 index 허용, 고유 본문·각자 canonical, query 없는 OG URL |
| Preview/development/미설정·오타·충돌 환경 | 두 페이지 meta·HTTP noindex, robots 전체 제한, sitemap 비어 있음 |
| Production + 배포별 URL/localhost/다른 Host | HTTP noindex 유지, 운영 www canonical을 사용자 Host로 바꾸지 않음 |
| 승인된 원본/최적화 이미지 | www Production에서만 index, 정상 이미지 표시 |
| 미등록 이미지·비공개 URL을 넣은 최적화 요청 | 공개 허용 규칙에 포함되지 않음 |
| 관리자·견적·사진·서명/PDF API·없는 경로 | 기존 상태/인증·캐시 보호 + noindex. 익명 요청 조회의 200 `{request:null}` 계약은 유지 |
| sitemap·robots | 공개 URL 2개만, 개인정보/Preview/localhost 없음, 비공개 수집 제한 |
| 데스크톱/모바일 | 홈→KCP→견적 링크, 메뉴·FAQ·이미지, 가로 넘침·console/page 오류 확인 |

관련 단위/인증 시험·lint·타입·빌드와 실제 화면 검사 후 완료로 표시한다. Search Console 인증 성공·색인 요청·실제 색인·AI 노출을 각각 구분한다. 공개 설정 변경 후에도 순위·노출 시점·AI 인용을 보장하지 않는다.

## 참고

- 설치된 Next.js 16.3.6의 `node_modules/next/dist/docs/` metadata·headers·robots·sitemap 가이드.
- [Google robots meta/HTTP 규칙](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag), [사이트맵](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).
- [Google 생성형 AI 검색](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide), [AI 포함 설정](https://support.google.com/webmasters/answer/16908024?hl=en).
- [OpenAI 검색/학습 크롤러 구분](https://developers.openai.com/api/docs/bots).

## 실행 상태

- [x] 구현 전 계획 작성.
- [x] 1단계 로컬 구현·검증.
- [x] 2단계 사이트 로컬 구현·검증.
- [ ] 운영 도메인 반영·실제 보호 확인.
- [ ] 회사 Search Console 속성·사이트맵·AI 포함 확인.
