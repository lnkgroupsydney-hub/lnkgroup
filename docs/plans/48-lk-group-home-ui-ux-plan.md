# L&K Group 메인페이지 UI·UX 구현계획

2026-10-13 · 작업 브랜치 `codex/lk-group-home-ui-ux-20261013` · 기준 커밋 `756eb4d`와 기존 작업 트리.

**현재 단계: H-01~05 구현 및 후속 브라우저 태그 일곱 항목 반영 완료.** 그룹 배경·서비스별 생성 이미지·지역 숫자 제거·검정 원 로고·회사 연락처/표시명을 반영했다. 최종 lint·타입·빌드와 로컬 브라우저 12/12 통과, [최신 화면·생성 자산·검증 기록](../verification/2026-10-13-lk-home-revision.md)을 따른다. 아래 설계 표는 구현 기준이며 공개 단계는 별도다. 기존 미커밋 변경을 보존하고 기존 견적·KCP 작업을 이번 신규 구현으로 계산하지 않는다. 커밋·푸시·운영 배포·색인 공개는 수행하지 않는다.

## 1. 사용자 요청과 목표

L&K Group은 시드니에서 주택 도장, 기존 캐비넷 도장, 핸디맨 서비스, 페인트 터치업 키트와 김치를 제공하는 회사다. **Ermington NSW 2115와 인근 시드니 지역의 로컬 서비스**라는 정체성을 먼저 전달한다. 후속 태그 요청으로 공개 화면의 거리 숫자를 제거한다. 사이트 본문은 기존 호주 영어(`en-AU`)를 유지한다.

방문자가 짧게 훑어도 회사·지역·다섯 제공 항목·현재 가능한 행동을 알 수 있게 한다. 신뢰는 실제 회사 정보, 명확한 설명과 연락 방법으로 만든다. 홈 생성 이미지는 서비스 소개 컨셉으로 구분하며 회사 제공 작업 사진은 상세에서 보존한다. 확인되지 않은 평점·후기·보험·보증·실적·사업 가격을 추가하지 않는다.

사용자 후속 답변으로 준비 상태 문구는 **`Coming soon`**으로 확정했다. Residential Painting·Handyman Services·Paint Touch-up Kits·Kimchi에는 상세/구매 링크를 만들지 않는다. 기존 Kitchen Cabinet Painting 상세와 견적 경로는 유지한다.

## 2. 현재 화면과 개선 방향

확인 기준은 현재 소스이며 새 메인 화면을 브라우저로 구현·검증한 결과와 구분한다. 참고: [17번 홈 계획](17-home-prototype-design-plan.md), [21번 공통 디자인](21-global-design-system.md), [47번 KCP 계획](47-kcp-landing-ui-ux-content-plan.md), [회사 제공 자료](../reference-assets/company-brief.md).

| Before | After | Why |
| --- | --- | --- |
| 서비스 목록이 H1과 첫 소개 역할을 함께 담당 | 짧은 회사 소개 Hero와 별도의 서비스 목록 | 회사와 제공 항목의 위계 구분 |
| Products·Handyman·Cabinet·Painting 네 카드, 김치 없음 | 서비스 3개·상품 2개를 이름별로 제시 | 다섯 제공 항목을 한 구역에서 확인 |
| Cabinet 외 카드에도 `Enquire with Lisa` 링크 | `Coming soon` 텍스트 배지와 설명 | 준비 중인 상세/판매 기능의 상태를 정직하게 전달 |
| 중앙 정렬·큰 아이콘·반복 소개 | 왼쪽 정렬·짧은 설명·일관된 제목과 간격 | 빠른 비교와 가독성 |
| 지역 소개에 10km와 Inner West 등 추가 지역 혼재 | 첫 화면은 Ermington·인근 지역, 상세에는 지역 목록과 주소별 확인 안내 | 지역 정보의 정확성과 로컬 정체성 |
| 작은 푸터·안내 글자와 개별 크기 혼재 | 본문 16–18px, 중요 보조 정보 14px 이상 | 신뢰 정보와 준비 상태도 읽기 쉽게 표시 |
| 회사 소개와 작업 사진이 분리 | 그룹 소개와 다섯 서비스별 생성 이미지·설명 | 캐비넷에 편중되지 않은 전체 사업 소개 |
| 배경이 있는 로고 | 흰 외곽만 투명한 검정 원 로고를 공통 사용 | 원래 브랜드 형태 유지 |

## 3. 화면 구조와 사용자 흐름

순서는 **헤더 → 회사 소개 → 다섯 서비스·상품 → 회사·작업 방식 → 서비스별 이미지·설명 → 서비스 지역 → 연락 → 푸터**다. 긴 회사 소개나 사진보다 서비스 목록을 먼저 제시한다.

| 영역 | 콘텐츠와 동작 |
| --- | --- |
| 헤더 | 검정 원을 유지한 로고·L&K Group, Services / About / What we offer / Service area / Contact. 기존 `#home`, `#services`, `#about`, `#gallery`, `#service-area`, `#contact` 유지. 홈 전용 배치로 상세 헤더에 영향 제한 |
| Hero | 회사명, `Ermington, Sydney`, 그룹 중심 H1·소개·생활 공간 생성 배경. `View our services` → `#services`, 보조 연락 → `#contact` |
| Services & products | 주택 도장·캐비넷 도장·핸디맨 3개와 터치업 키트·김치 2개. 탭·캐러셀·펼침 없이 이름과 상태를 모두 노출 |
| About | Ermington 기반 회사 소개와 Lisa 안내. 회사 제공 도장 경력 10년 이상·꼼꼼한 표면 준비·서비스와 상품을 함께 제공하는 점을 간결하게 설명 |
| What we offer | 다섯 서비스·상품별 생성 이미지·짧은 제공 내용·컨셉 안내. 준비 중 네 이미지 카드에 링크 없음 |
| Service area | Ermington·인근 시드니 지역 소개, 기존 지역 목록과 실제 주소별 확인 안내. KCP의 `/#service-area` 링크 유지 |
| Contact | 기존 회사 제공 전화·이메일·운영시간·Instagram과 담당자. 준비 중 카드의 대체 클릭 링크를 만들지 않고 공통 연락 구역 제공 |
| Footer | L&K Group 표시명·읽을 수 있는 ABN/licence·메뉴. ABN·Painting licence는 회사 제공 값 유지; 외부 검증 완료로 표현하지 않음 |

Hero에 고정 100vh나 큰 애니메이션을 추가하지 않는다. 모바일 첫 화면에서 회사·지역·주요 행동을 볼 수 있게 하되 글자를 줄이거나 콘텐츠를 잘라 모두 욱여넣지 않는다.

후속 구현 결과: 모든 폭에서 그룹 생활 공간 생성 배경을 Hero에 표시하고 대비용 그라데이션을 적용한다. 첫 배경만 preload하며 아래 다섯 서비스 이미지는 지연 로딩한다. `#home`은 최상단 헤더에 유지해 Back to top이 메뉴 전체로 돌아온다.

### 영문 카피 초안

- H1: `Local services. Everyday care.`
- 소개: `L&K Group brings together residential painting, kitchen cabinet painting and handyman services, alongside paint touch-up kits and kimchi. We serve Ermington and nearby Sydney suburbs.`
- 서비스 구역 H2: `Our services & products`
- 회사 소개 H2: `A local team, with care in every detail.`
- 지역 H2: `Local to Ermington. Close to your home.`
- 연락 H2: `Tell Lisa what you have in mind.`

위 문구는 구현용 편집 초안이다. `team`이 실제 회사 구성보다 크게 읽히면 `Local care, with attention to detail.`로 바꾼다. 김치의 제조 방식·건강 효과·원산지·인증·배송·보관 조건은 현재 자료로 확정하지 않는다.

## 4. 제공 항목과 링크 계약

| 표시 항목 | 설명 초안 | 상태·동작 |
| --- | --- | --- |
| Residential Painting | `Interior and exterior painting for homes, with careful preparation and attention to detail.` | `Coming soon` / `Service page coming soon`. 제목·카드·배지·아이콘에 링크 없음 |
| Kitchen Cabinet Painting | `Refresh your existing cabinet doors and drawer fronts while keeping the kitchen you have.` | `Explore cabinet painting` → 기존 `/services/cabinet-painting`; 기존 견적 진입 유지 |
| Handyman Services | `Practical help with minor home repairs, adjustments and maintenance.` | `Coming soon` / `Service page coming soon`. 링크 없음 |
| Paint Touch-up Kits | `Paint touch-up kits for small marks and everyday home maintenance.` | `Coming soon` / `Online ordering coming soon`. 구매·장바구니·가격 없음 |
| Kimchi | `Kimchi from L&K Group. Product details will be added here.` | `Coming soon` / `Online ordering coming soon`. 구매·가격·식품 운영 조건 없음 |

`Coming soon`은 온라인 상세/주문 준비 상태이며 회사가 실제 서비스를 제공하지 않는다는 의미로 쓰지 않는다. 준비 중 배지는 일반 텍스트로 만든다. `href="#"`, 비활성처럼 꾸민 링크, 동작 없는 Continue 버튼을 만들지 않는다. 서비스 반경을 상품·김치 배송 반경으로 해석하지 않는다.

다섯 항목은 홈 표시용 콘텐츠로 관리한다. **김치·터치업 키트를 표시하기 위해 업무 견적의 `ServiceId`·가격·예약 계약을 확장하지 않는다.** 기존 업무 카탈로그와 홈 표시 목록을 구분하고 활성 링크는 중앙 `siteRoutes`를 사용한다.

## 5. 타이포그래피·간격·반응형

기존 로컬 **Manrope**, Slate/Greige·아이보리, 금색 로고를 사용한다. 외부 폰트·새 UI 라이브러리를 추가하지 않는다. `src/shared/styles/tokens.css`의 의미별 크기와 `Container`를 재사용하고 홈 전용 클래스로 조정한다. 공통 토큰 값을 일괄 변경해 견적·EMS 화면을 바꾸지 않는다.

| 역할 | 모바일 | 데스크톱 | 굵기 / 행간 |
| --- | --- | --- | --- |
| H1 | 36–44px | 56–64px | 700 / 1.08–1.15 |
| H2 | 28–32px | 40–48px | 700 / 1.15 |
| 제공 항목 제목 | 20–22px | 22–24px | 600–700 / 1.25 |
| 소개 | 18px | 18–20px | 400 / 1.5 |
| 본문 | 16px | 17–18px | 400 / 1.6–1.65 |
| 상태·사진 캡션·사업자 정보 | 14px | 14px | 400–600 / 1.5 |
| 버튼·메뉴 | 16–18px | 18px | 600–700 / 1.3–1.4 |

px는 기본 16px 환경의 설계 기준이며 실제 구현은 rem/clamp와 자연 줄바꿈을 사용한다. 본문 최대 폭은 55–65ch, 소개는 약 42–50ch. 제목을 작게 만드는 대신 폭과 줄바꿈을 조정한다.

- 섹션 상하 여백: 모바일 56–64px, 데스크톱 80–96px. 카드 내부 20–28px, 카드 간격 16–24px. 기존 공통 좌우 여백 사용.
- 데스크톱: 서비스 3열, 같은 섹션에서 상품 2열. 태블릿: 2열. 모바일: 짧은 1열 목록. 모바일에서는 큰 아이콘과 불필요한 최소 높이를 줄인다.
- 카드 제목·설명은 왼쪽 정렬. 활성 Cabinet 링크만 분명한 버튼 스타일. 준비 상태를 색상만으로 구분하지 않는다.
- 주요 동작 높이 48px 이상, CTA 52–56px 목표. 키보드 focus가 배경과 구분되며 가려지지 않게 한다.
- 기본 본문 대비 4.5:1, 큰 글자 3:1을 확인한다. 로고 금색을 작은 본문의 색으로 사용하지 않는다.
- 모션은 짧은 hover/press 피드백 위주. 내용을 애니메이션 뒤에 숨기지 않으며 reduced-motion을 존중한다.

## 6. 지역 SEO와 공개 단계

SEO는 실제 회사·서비스·지역 정보를 검색엔진이 이해하고 고객이 읽기 쉽게 만드는 데 집중한다. 설명적인 제목, 읽기 쉬운 본문, 실제 유효한 링크를 우선한다. [Google SEO 기본 가이드](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)

- title 초안: `L&K Group | Painting & Home Care in Ermington, Sydney`.
- description 초안: `L&K Group offers residential painting, kitchen cabinet painting, handyman services, paint touch-up kits and kimchi. Local to Ermington and nearby Sydney suburbs.`
- H1은 회사·지역 소개 하나. 주요 섹션 H2, 제공 항목 H3로 구성한다. 다섯 항목·상태·지역·연락 정보를 초기 서버 HTML에 포함한다.
- 기존 `en-AU`, Open Graph·Twitter의 고유 제목/설명을 맞춘다. 이미지 alt·width/height·sizes를 유지하고 필요한 첫 이미지 외에는 지연 로딩한다.
- 모든 suburb를 title·H1에 나열하지 않는다. 지역 목록은 `#service-area` 한 곳에서 설명하고 KCP는 홈으로 연결한다.
- 기존 회사 자료에는 반경 밖 Inner West와 추가 지역도 있다. 후속 요청에 따라 공개 화면의 거리 숫자는 빼고 **Ermington·인근 지역**을 앞세운다. 추가 지역은 주소별 상담 대상으로 구분하며 제공 범위를 임의로 삭제하거나 넓히지 않는다.

현재 `siteConfig.isPrototype`이 true라 전체 robots는 **noindex/nofollow**다. 이번 로컬 단계에서는 유지한다. 따라서 구현 이후에도 검색 유입·색인 개선을 완료했다고 보고할 수 없다. noindex는 검색 제외 지시이며 인증 수단이 아니다. [Google noindex 안내](https://developers.google.com/search/docs/crawling-indexing/block-indexing)

공개 전 별도 단계에서는 이미 확인된 회사 도메인 `https://www.lnkgroupsydney.com.au`의 승인된 Production만 대상으로 canonical·sitemap·robots를 정리한다. Preview와 Quote·고객 복구·관리자 영역의 색인 정책을 분리하고 개인 정보 영역은 제외한다. 이번 변경만으로 일괄 index를 켜지 않는다.

Organization 구조화 데이터는 실제 이름·로고·회사 URL·확인된 연락처·SNS만 사용한다. LocalBusiness의 Google 검색 기능에는 주소 등 필수 속성이 있으므로 미확정 상세 주소나 개인 주소를 만들어 넣지 않는다. 준비 중 상품의 가격·재고·Offer와 허위 Review/AggregateRating을 생성하지 않는다. [Google Organization 안내](https://developers.google.com/search/docs/appearance/structured-data/organization), [LocalBusiness 안내](https://developers.google.com/search/docs/appearance/structured-data/local-business)

공개 후 Search Console의 색인·검색어·노출·클릭과 실제 페이지 성능으로 결과를 판단한다. 검색 순위를 보장하지 않는다.

## 7. 로고 배경 제거와 전체 적용

명시적 로고 요청은 이번 단계에서 별도로 실행한다.

- 원본: `public/images/lk-group-logo.png`, 900×900, 흰 외곽과 검은 원형 배경.
- 원본 보존: `docs/reference-assets/lk-group-logo-original-with-background.png`. 기존 회사 PDF도 유지.
- 편집: 후속 사용자 태그에 따라 내장 `image_gen`으로 원 밖 흰색만 제거한 alpha PNG. 검정 원·금색 원·L&K·GROUP 요소를 함께 유지한다. 최종 프롬프트·픽셀/브라우저 검증은 [수정 기록](../verification/2026-10-13-lk-home-revision.md)에 기록.
- 적용: `public/images/lk-group-logo-circle-transparent.png`를 공용 경로로 사용하고 `siteAssets.wordmark`의 실제 크기를 1254×1254로 갱신. 헤더 두 변형·견적 로고·favicon은 같은 자산을 사용한다. 기존 파일명도 투명본으로 교체했지만 브라우저의 이전 최적화 이미지 캐시를 피하기 위해 새 경로를 사용한다. 관련 fixture의 허용 경로와 검사를 함께 갱신하며 접근 제한은 유지한다.
- 새 메인에 푸터 로고를 추가한다면 같은 중앙 자산만 사용. 홍보 아트워크 속 로고는 원본 자료 일부로 보존한다.
- 밝고 어두운 배경, 128/96/56/40px 실제 표시와 모바일 헤더를 점검. favicon처럼 작은 크기에서는 문자가 모두 읽힌다고 보장하지 않는다.

## 8. 파일별 구현 순서와 검증 단위

| 순서 | 소유 파일/책임 | 완료 기준 |
| --- | --- | --- |
| H-00 | 이 계획·README·15번 TODO·로고 원본/투명본·공용 assets | 계획 우선 작성과 로고 적용 기록, 사용자 검토 가능한 산출물 |
| H-01 | company-profile의 홈 소개/표시용 콘텐츠, 홈 서비스 표시 컴포넌트 | 다섯 항목·명칭·Coming soon·지역·링크 상태 명확. 업무 ServiceId 불변 |
| H-02 | `src/app/page.tsx`, 홈 전용 header/hero/서비스 UI·스타일 | 정보 순서·헤딩 계층·기존 앵커 유지, 로컬 메인 구현 |
| H-03 | about/benefits/gallery/service-area/contact/footer의 홈 소비 방식 | 반복 축소, 회사 정보·거리 숫자 없는 지역 설명·읽기 쉬운 사업 정보 |
| H-04 | 홈 metadata·모바일 메뉴·이미지·접근성 | 서버 HTML·실제 링크·반응형·확대·키보드 확인 |
| H-05 | 관련 브라우저 점검·lint/typecheck/build·검증 문서·TODO | 실행한 검사와 미실행 항목 구분, 로컬 결과 제시 |
| 공개 후속 | 승인된 Production SEO·canonical·sitemap·구조화 데이터·Search Console | 별도 공개 결정 및 운영 검증 완료 후 기록 |

현재 작업 트리에는 47번 계획 관련 `ServiceAreaSection` 추출과 KCP 수정이 이미 있다. 완료한 구조를 재사용하며 이전 문서의 미완료 표기만 보고 다시 구현하지 않는다. 공통 헤더 수정이 필요한 경우 KCP·견적 회귀를 함께 확인한다. 견적·예약·DB·EMS·가격·Calendar는 이번 메인 개편의 수정 범위에 포함하지 않는다.

## 9. 인수 기준과 남은 단계

- [x] 새 브랜치에서 기존 변경을 보존하고 구현계획 작성.
- [x] `Coming soon` 문구와 링크 없는 네 항목 상태 사용자 확인.
- [x] 투명 로고 선택·공통 자산 적용. 실제 검증 결과는 별도 기록.
- [x] 메인 UI 개편 계획 검토 후 H-01~05 구현.
- [x] 다섯 이름·설명·상태가 한 구역에 있으며 준비 중 항목에 링크·클릭·키보드 초점이 없음.
- [x] Cabinet 상세/견적 진입, 전화/메일 href, 메뉴 앵커와 `/#service-area` 경로 확인. 실제 전화 발신/메일 발송은 미실행.
- [x] 320/393/768/855/1024/1440px와 200% **글자 확대**에서 넘침·잘림 없음. 모바일 메뉴 열기/닫기·Escape·초점 복원 확인. 실제 브라우저 zoom과 실물 기기는 별도.
- [x] 초기 HTML의 단일 H1·헤딩 계층·다섯 항목·지역·metadata·현재 noindex 확인.
- [x] 홈·KCP·견적에서 공통 검정 원 로고 사용과 콘솔/실행 오류 없음, 생성 배경·다섯 이미지 로딩 확인. 견적 API는 브라우저 가상 응답이며 실제 업무 저장 인수가 아님.
- [x] 관련 lint·타입·빌드 및 실제 브라우저 결과를 구분해 기록. 본문 문구를 그대로 복제하는 테스트나 무관한 업무 DB 검사를 추가하지 않음.
- [ ] 실제 휴대폰/Safari·네이티브 브라우저 확대·정량 성능 검증.
- [ ] 색인 공개·운영 배포·검색 성과 측정은 별도 단계.

확인해야 할 운영 자료는 실제 김치 상품 설명·판매 방식, 상품 주문 범위, 추가 지역 제공 조건이다. 이 자료는 이번 회사 소개와 준비 상태 UI의 진행을 막지 않으며, 미확정 내용을 운영 약속으로 사용하지 않는다.
