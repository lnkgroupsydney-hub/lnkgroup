# L&K Group 웹 서비스 구축 계획

2026년 9월 25일 · 계획 버전 1.0 · 기준 지역 Australia/Sydney · 문서 언어 한국어

L&K Group의 서비스 홈페이지, 온라인 쇼핑몰, ERP·CRM 운영관리 시스템을 구축하기 위한 개발 참조 문서와 로컬 Next.js 앱 저장소다. 기존 분석 자산은 ChatGPT 프로젝트의 대화 3개와 화면 시안 3개다. 2026-09-27 로컬 기본 앱을 생성했으며, DB·클라우드 연결은 회사 승인 대기다.

권장 방향은 **하나의 고객·운영 데이터 기반 위에 서비스 예약과 상품 구매 흐름을 구분하고, 서비스 매출부터 단계적으로 운영을 검증하는 것**이다. 핸디맨·페인팅·캐비넷 페인팅과 터치업 키트·김치는 동일 관리자에서 관리하되, 식품의 배송·위생·재고 정책은 별도로 적용한다. 사용자가 ESN의 의미를 ERP·CRM 중심으로 확정했다.

## 읽는 순서

**현재 작업(2026-09-30): [Gmail 문의 → 회사 검토 → Google Calendar](docs/plans/28-gmail-enquiry-calendar-implementation.md) 로컬 구현·검증 완료.** [18번 후속 제품 흐름](docs/plans/18-kcp-page-prototype.md)·[25번 전체 계획](docs/plans/25-kcp-quote-to-booking-implementation.md)·[15번 TODO](docs/plans/15-home-cabinet-admin-todo.md)를 따른다. P0 명세 이후 KCP 견적 폼, 로컬 SQLite 저장, `/admin` 비공개 문의함, 회사 OAuth, Gmail 라벨 수집과 제안 일정의 Calendar 양방향 검토를 구현했다. 코드 검사·대체 전송 테스트 23개·실제 브라우저·재시작 보존 확인은 [검증 기록](docs/verification/2026-09-30-gmail-calendar.md)을 따른다. 실제 Google 연결은 회사 OAuth 클라이언트 설정 대기다. 설정 방법·이번 구현 범위는 28번에 정리한다.

연동 계정은 `Lnkgroupsydney@gmail.com`이며 공개 문의 이메일과 구분한다. Google에서의 수정은 검증 후 앱에 반영한다. **마지막 작업 후 프로젝트 Complete → 인보이스 발행 → 실제 발행일 +3 달력일 납기(Sydney)** 정책은 [27번](docs/plans/27-kcp-google-calendar-sync.md)에 보존한다. 청구 실행·사진·AI·Resend는 후속 단계다. 근무시간·기간 산식은 보류하고 정찰제는 가격 수령 후 진행한다. 지금 저장하는 일정은 고객이 수락한 확정 예약이 아니다. 과거 Cabinet ‘약 1주’는 소개·문의 접수 목표이며 전체 기능의 납기가 아니다.

**현재 작업(2026-09-29): KCP 시네마틱 디자인 구현·로컬 검증 완료.** 메인은 기존 서비스 소개 프로토타입으로 유지하고, **Kitchen Cabinet Painting 상세에만** 사진형 Hero, 실제 WebGL 9단계 공정과 완료 장면, 전후 비교 슬라이더, 색상·광택 미리보기를 적용했다. [최신 구현 범위](docs/plans/24-cinematic-kitchen-webgl.md), [글로벌 디자인 시스템](docs/plans/21-global-design-system.md), [실제 검증 기록](docs/verification/2026-09-29-cinematic-v3.md)을 따른다. 같은 모델의 문짝·손잡이·힌지를 분리하고 세척·국소 퍼티 보수·프라이머·두 마감 코트·재조립을 가역 스크롤로 연결했다. 모델은 사진을 참고한 건축 컨셉이며 실측 CAD나 실사 재구성은 아니다. 모바일·JavaScript/WebGL 미지원 환경에는 읽을 수 있는 사진과 본문을 제공한다. 전역 토큰과 공용 KitchenScene 렌더러를 콘텐츠에서 분리했다. 현재 프로덕션 미리보기는 [KCP](http://127.0.0.1:3002/services/cabinet-painting) / [메인](http://127.0.0.1:3002)이다.

회사 자료·메인 SEO는 앞서 반영했다. [회사 제공 자료](docs/reference-assets/company-brief.md)를 기준으로 실제 전화·이메일·지역·회사 로고·홍보 이미지·작업 사진을 유지한다. 회사 연동 계정은 지정됐고 실제 계정 접근·연결 검증·배포 승인·운영 도메인은 대기다. `noindex`는 유지하며 로컬 요청 폼 이후 사진 업로드·AI·확정 견적/예약·인보이스·결제는 [순차 구현 목표](docs/plans/25-kcp-quote-to-booking-implementation.md)로 남긴다. 현장별 전후 사례 자료·실측 정밀 모델·정량 성능 및 실제 기기 검증은 남아 있다.

Cabinet 상세 `/services/cabinet-painting`의 6개 서비스·적합성·포함/제외·공정·컨셉 사례·FAQ 최초 구성은 [SEO·지역 개정](docs/plans/19-kcp-seo-content-and-service-area.md)과 [이전 검증](docs/verification/2026-09-27-kcp-seo-content.md)을 참조한다. 회사가 제공한 최신 서비스 지역은 기존 지도 조사의 제한적인 후보 목록보다 우선한다.

회사 자료·실제 이미지 반영 후 lint·타입·production build와 1440·768·390·320px 메인 브라우저 확인을 마쳤다. 회사 자료 반영 당시 기록은 [이전 검증](docs/verification/2026-09-27-home-company-content.md), 이번 디자인 검증은 [2026-09-28 기록](docs/verification/2026-09-28-scroll-storytelling.md)을 따른다.

## 로컬 앱 실행

Node.js 24와 npm 11을 사용한다. `.nvmrc`는 확인한 로컬 버전을 기록하며 실제 패키지 버전은 `package.json`과 lockfile이 기준이다.

```sh
npm ci
npm run setup:local
npm run dev -- --port 3002
```

현재 기능 검증 주소는 `http://127.0.0.1:3002`다. `setup:local`은 기존 설정을 보존하고, 최초 실행 때 비공개 `.env.local`에 관리자 비밀번호·토큰 암호화 키를 생성한다. [28번 로컬 설정과 Google 연결 안내](docs/plans/28-gmail-enquiry-calendar-implementation.md)를 따른다. 다른 포트로 실행하려면 `APP_BASE_URL`과 Google redirect URI도 함께 맞춘다. 로컬 업무 저장소는 이 기기에만 유지되며 클라우드 DB나 서버리스 배포용 어댑터가 아니다. Google 키 없이도 폼 저장과 운영 검토는 가능하고, 실제 Gmail·Calendar 동기화에는 OAuth 설정이 필요하다. 검사 명령은 `npm run lint`, `npm run typecheck`, `npm run build`이며 `npm run check`로 순서대로 실행할 수도 있다. CI 설정과 실제 GitHub 실행 결과는 구분한다.

현재 Mac에서 Turbopack의 CSS worker 포트 권한 오류를 확인해 공식 Webpack 옵션으로 dev·build를 구성했다. Webpack production 빌드는 통과했다. Next.js 공식 ESLint preset의 peer 호환 범위에 맞춰 ESLint 9를 고정했으며 npm의 지원 종료 경고는 남아 있다. 자세한 결과는 [검증 기록](docs/verification/2026-09-27-home-prototype.md)을 따른다.

회사 제공 이미지의 적용 위치와 기존 생성 이미지 기록은 [자산 기록](docs/prototype-assets.md)에 있다. 회사 연락처·로고·작업 사진은 수령했으며 최종 디자인·현장별 사례 설명·운영 도메인은 별도 준비한다.

**보상 조건 검토(2026-09-27): [웹 유입 매출 5% 계약 분석](docs/plans/16-revenue-share-contract-review.md).** 사용자가 설명한 제안은 웹 유입으로 인정되는 매출의 5%이며 GST 포함 금액 기준이다. 최소 보수·계약 기간·귀속 규칙·코드 권리 등은 미합의다. 이 분석은 개발자 내부 검토용이며 상대방에게 전달할 계약서가 아니다.

| 문서 | 개발에서 참조할 내용 |
| --- | --- |
| [00 기존 프로젝트 분석](docs/plans/00-project-baseline.md) | 확인된 시안, 기존 결정, 새 요청과의 차이 |
| [01 사업 목표와 범위](docs/plans/01-product-scope.md) | 단계별 범위, 이용자, 요구사항 ID |
| [02 화면과 고객 여정](docs/plans/02-information-architecture.md) | 사이트맵, 페이지 구성, 모바일 흐름 |
| [03 기술 구조와 배포](docs/plans/03-architecture-and-deployment.md) | Next.js, Supabase, Vercel, Docker 역할 |
| [04 데이터와 권한](docs/plans/04-data-model-and-access.md) | 테이블, 상태, 원장, 데이터 접근 |
| [05 자동견적과 예약](docs/plans/05-quote-ai-booking.md) | 정찰제, 사진 분석, 승인, 일정, 변경견적 |
| [06 쇼핑몰과 재고](docs/plans/06-commerce-and-inventory.md) | 키트, 김치, 결제, 배송, 반품 |
| [07 자동화와 운영](docs/plans/07-automation-and-operations.md) | 이메일, 인보이스, 장애 복구, 관리자 SOP |
| [08 보안과 호주 운영 조건](docs/plans/08-security-and-compliance.md) | 고객 사진, 개인정보, 계약, 식품 판매 조건 |
| [09 테스트와 출시 검증](docs/plans/09-test-and-qa.md) | 테스트 시나리오, AI 평가, UAT, 출시 기준 |
| [10 일정과 비용](docs/plans/10-roadmap-budget-risks.md) | 인력, 의존성, 공수, 운영비, 위험 |
| [11 서비스 마케팅](docs/plans/11-marketing-and-growth.md) | 고객군, SEO, 광고, 콘텐츠, 90일 실행 |
| [12 개발 백로그](docs/plans/12-implementation-backlog.md) | 구현 순서, 완료 기준, 담당 역할 |
| [13 모델과 개발 운영](docs/plans/13-ai-development-workflow.md) | Astra xhigh / Sol xhigh 작업 기준 |
| [14 결정과 출처](docs/plans/14-decisions-and-sources.md) | 확정·제안·미정 구분과 공식 근거 |
| [15 우선 제작 TODO](docs/plans/15-home-cabinet-admin-todo.md) | 메인·Cabinet·관리 웹의 착수 순서 |
| [16 웹 매출배분 계약 검토](docs/plans/16-revenue-share-contract-review.md) | 내부 사업성 분석, 회수 예시, 웹 귀속·보수·IP 협상 |
| [17 메인 프로토타입·디자인](docs/plans/17-home-prototype-design-plan.md) | 구현 범위, DDD 조립, 디자인 초안, SEO·QA 기준 |
| [18 KCP 상세 프로토타입](docs/plans/18-kcp-page-prototype.md) | 6개 서비스 카테고리, 메인 연결, Free Quote 표시, 후속 견적·AI·예약 흐름 |
| [19 KCP SEO·지역 콘텐츠](docs/plans/19-kcp-seo-content-and-service-area.md) | Google Maps 지역 조사, 10km 반경, 임시 회사 정보 표시·교체 기준 |
| [20 승인 디자인·스크롤 스토리 구현](docs/plans/20-scroll-storytelling-implementation-plan.md) | 최초 계획과 최신 KCP 상세 전용 범위, 자산·재사용·SEO·검수 |
| [21 글로벌 디자인 시스템](docs/plans/21-global-design-system.md) | 공통 색상·서체·크기·굵기·여백·버튼·모션 토큰과 적용 규칙 |
| [22 KCP 전체 화면 공정](docs/plans/22-cinematic-cabinet-story.md) | 메인 프로토타입 유지, KCP Hero·공정 우선 배치·사진 레이어·표현 한계 |
| [23 정면 캐비넷 깊이 연출](docs/plans/23-front-cabinet-depth-story.md) | Concept 2 공정 사진, 6개 도어·원본 배경 합성·절제된 입체 움직임 |
| [24 시네마틱 WebGL 공정](docs/plans/24-cinematic-kitchen-webgl.md) | 실제 3D 9단계 공정, 전후 비교, 색상·광택, 정적 대체와 최신 검증 |
| [25 KCP 견적부터 결제까지](docs/plans/25-kcp-quote-to-booking-implementation.md) | P0~P8 순차 구현, AI·가격·예약 요청/확정·회사 duration·청구/결제, 선행 조건과 KQ 검증 |
| [26 KCP P0 계약·재사용](docs/plans/26-kcp-p0-contracts-and-reuse.md) | Coatly 실제 소스 검토, 입력·상태·DB/권한·API 계약, 이식 전 수정과 운영 결정 |
| [27 Google Calendar 연동](docs/plans/27-kcp-google-calendar-sync.md) | 양방향 검증 후 확정, 시간/기간·발행/납기 자동 설정, 동기화·충돌·GC 검증 |
| [28 Gmail 문의·Calendar 구현](docs/plans/28-gmail-enquiry-calendar-implementation.md) | 로컬 요청 저장·관리, Gmail 라벨 수집, Calendar 변경 검토, 회사 OAuth 최초 설정 |

클라이언트 전달본은 [Word 구현계획서](deliverables/LK_Group_Client_Implementation_Plan_KO.docx)이며, 편집 가능한 원문은 [클라이언트 제안서 Markdown](docs/client-proposal.md)이다. 기술 기준은 위 개발 문서가 원본이며, 클라이언트 문서를 변경할 때 관련 개발 문서도 함께 갱신한다. 문서 자체의 확인 결과는 [검증 기록](docs/document-validation.md)에 정리했다.

기존 `deliverables/LK_Group_Planning_Package.zip`은 이번 수정 전 보관본이다. 최신 제안서는 위 Word와 Markdown을 사용한다. 내부 계약 분석 문서는 클라이언트 전달 패키지에 자동으로 포함하지 않는다.

## 계획의 사용 기준

- 일정·가격·전환율은 사업 자료가 없는 상태에서 세운 **계획 가정**이다. 승인된 계약금액, 견적 단가 또는 실적이 아니다.
- 고객용 영어 사이트를 우선하고 한국어 콘텐츠를 다음 단계에서 추가하는 안이다. 브랜드명과 법인·ABN·GST 등록 상태는 착수 단계에서 확인한다.
- 최신 회사 제공 서비스 지역은 **Ermington 중심 10km + Inner West Sydney 및 명시된 21개 suburb**다. 목록의 모든 지역이 10km 안에 있다는 뜻은 아니며 실제 주소별 가능 여부는 회사에 확인한다. [회사 답변](docs/reference-assets/company-brief.md)이 이전 15km 가정과 지도 후보 목록보다 우선한다. 식품 배송 범위는 별도다.
- 실제 서비스 판매가격은 비워 두고, 산식 설명용 가격은 모두 예시로 표시한다.
- 기존 산출물은 계획서와 작업 설정이며, 2026-09-27 로컬 Next.js 메인 프로토타입 개발 요청이 추가됐다. 앱 배포·DB 연결은 회사 승인 후 진행하고 결제 계정 개설·광고 집행은 이번 범위에 포함하지 않는다.

## 첫 착수 회의 산출물

대표가 승인할 항목은 판매 사업자와 서비스 자격, 초기 서비스 목록, 정찰제 포함 범위, 서비스 중심 주소, 키트 SKU, 김치 제조·배송 방법, 목표 예산, 출시 담당자다. 이 자료를 [결정표](docs/plans/14-decisions-and-sources.md)에 기록하면 개발 백로그의 준비 단계부터 시작할 수 있다.

## 다른 기기에서 작업 이어가기

저장소는 [lnkgroupsydney-hub/lnkgroup](https://github.com/lnkgroupsydney-hub/lnkgroup)이다. 새 기기에서 `git clone https://github.com/lnkgroupsydney-hub/lnkgroup.git`으로 내려받고 해당 폴더를 Codex 프로젝트로 연다. 작업 시작 전 `git pull --ff-only`, 종료 후 커밋과 `git push`로 변경 사항을 주고받는다.

맥북 최초 설정, GitHub 인증, 기기를 바꿀 때의 순서와 문서 도구의 실행 조건은 [다른 기기에서 작업 이어가기](docs/device-setup.md)를 참조한다.
