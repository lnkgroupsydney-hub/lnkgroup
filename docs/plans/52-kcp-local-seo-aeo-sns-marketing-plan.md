# Kitchen Cabinet Painting 지역 SEO AEO SNS 마케팅 실행 계획

2026-10-14 · Australia/Sydney · 검토용 계획

목표는 실제 서비스가 가능한 지역에서 캐비넷 도장 문의를 확보하고, 사진 예상 견적을 회사의 예약 확정과 완료 작업으로 연결하는 것이다. 우선순위는 **사업 정보와 검색 공개 준비 → Google 검색과 지도 등록 → 실제 시공 증거와 고객 질문 콘텐츠 → 견적 전환 측정 → 소규모 광고 → 수익성이 확인된 지역 확대**다.

이번 범위는 분석과 계획 작성이다. 앱 코드, 색인 설정, 사업 등록, 광고 계정, 게시물과 광고 집행은 변경하지 않았다. 기간은 실행 착수일부터 계산하며 Google 인증·색인이나 문의 발생 시점을 보장하는 일정이 아니다. 이 문서는 기존 [11번 성장 계획](11-marketing-and-growth.md)의 KCP 실행안을 구체화한다. 과거 전 사업 광고 예산이나 전환율 가정을 이번 승인 예산·실적으로 재사용하지 않는다.

## 1 현재 상태와 먼저 해결할 문제

2026-10-14 공개 사이트의 HTTP 응답과 브라우저 표시, 현재 로컬 콘텐츠와 최신 견적·예약 계획을 대조했다.

| 항목 | 현재 확인한 상태 | 마케팅에 미치는 영향과 우선 조치 |
| --- | --- | --- |
| 운영 주소 | `https://www.lnkgroupsydney.com.au`의 홈·KCP·견적 시작 페이지가 HTTP 200 | 회사 소유 도메인을 기준으로 계정·링크·정규 URL을 통일 |
| 검색 공개 | 홈과 KCP 모두 HTML의 robots와 HTTP `X-Robots-Tag`에 `noindex, nofollow` | 가장 먼저 공개 페이지의 색인 정책을 정리해야 함. 웹에 접속된다는 것과 Google 색인 가능은 다름 |
| 발견·정규 URL | `/robots.txt`, `/sitemap.xml`은 404. 검사한 홈·KCP에 canonical과 JSON-LD 없음 | 공개 정규 URL·사이트맵·사업 정보 구조를 마련. robots.txt 404 자체가 색인 차단 원인은 아니며 현재 핵심 차단은 noindex |
| 서비스 본문 | KCP에 범위·표면 조건·공정·FAQ·사진 견적 CTA가 존재 | 기존 짧은 랜딩을 유지하면서 구매 판단에 필요한 내용을 보강 |
| 실제 사례 | KCP Hero·전후 비교·공정의 일부와 홈 서비스 사진은 생성 컨셉 | 실제 전후 광고를 만들기 전 동일 현장의 전후 사진과 게시 동의 확보 |
| 신뢰 링크 | KCP의 “See our preparation and spray-painting photos”가 홈 `#gallery`로 연결되지만 현재 해당 구역은 생성 서비스 소개 이미지 | 약속한 실제 공정 사진을 보여주거나 링크 설명·목적지를 맞추는 작업을 광고 전 점검 |
| 고객 경로 | 새 견적·기존 견적 진입, 사진 AI 예상, 방문일 이메일 인증, 서명 제출, 회사 확정 흐름 존재 | 신규 경로 전체를 다시 만들기보다 단계별 이탈·회사 후속 대응을 먼저 측정 |
| 측정 | 현재 소스 검색에서 GA4·GTM·Meta Pixel/CAPI·UTM 저장 구현을 찾지 못함 | 채널별 유효 문의와 확정 예약을 비교할 측정 준비가 필요. 광고 계정·Search Console의 현재 소유/연결 상태는 별도 확인 |
| 주소 입력 | 회사 Places 키·결제 준비 대기, 수동 입력 가능 | SEO·Business Profile 준비와 별개로 진행. 모바일 주소·사진 입력 인수 필요 |

Google은 처리된 `noindex`를 검색 제외 지시로 사용한다. `robots.txt` 404는 일반적으로 크롤링 제한이 없는 것으로 처리한다. 따라서 사이트맵만 제출하거나 robots.txt만 추가해 현재 문제를 해결했다고 판단하면 안 된다. [검색 제외 지침](https://developers.google.com/search/docs/crawling-indexing/block-indexing), [robots.txt 응답 처리](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec)

### 사업 명의와 GST 표기 대조

제공 ABN **67 607 948 542**의 2026-10-14 공개 조회에는 활성 개인사업자, 등록 사업명 `L&K PAINTING&MAINTENANCE`, GST 미등록이 표시된다. 사이트 표시 브랜드는 `L&K Group`, 기존 회사 자료는 `LNKPAINTING`이며 견적 소스는 GST 10%와 `Including GST`를 사용한다. 법적 이름과 브랜드가 다른 것만으로 문제가 있다고 단정할 수는 없지만, **실제 계약·청구 주체, 현행 등록 사업명, GST 상태와 견적 표기를 회사 자료로 대조해야 한다.** 이미 승인된 시작가를 임의 변경하지 않으며 대조가 끝나기 전 GST 포함 가격 광고를 확대하지 않는다. [ABN 공개 조회](https://abr.business.gov.au/ABN/View?abn=67607948542), [기존 승인 가격 계획](39-sydney-cabinet-pricing-v1.md)

Google Business Profile은 검색·지도상의 사업 소개다. 호주 ABN·ASIC 사업명 등록과는 별개이며 정부 등록을 대신하지 않는다. 필요한 정부 등록 여부는 실제 사업 구조와 사용 명칭으로 확인한다. [호주 사업명 안내](https://business.gov.au/planning/new-businesses/business-names-trading-names-and-legal-names)

## 2 고객과 핵심 메시지

광고의 메인 주제는 **기존 주방의 구조를 유지하면서 캐비넷 색상과 마감을 새롭게 하는 것**이다. 공정, 표면 적합성, 지역 사례와 견적 방법이 이 메시지를 뒷받침한다. 서비스 표시명은 Kitchen Cabinet Painting을 유지한다.

공개 영문 메시지 초안:

> Refresh the kitchen you already have.
>
> Kitchen cabinet painting around Ermington and Inner West Sydney. Share photos of your existing cabinets for a provisional estimate. Our team reviews the scope and confirms booking dates.

| 고객군과 우선순위 | 구매 이유 가설 | 고객이 확인할 내용 | 연결 행동 |
| --- | --- | --- | --- |
| 1순위 기존 주방을 유지하려는 주택 소유자 | 배치는 마음에 들지만 색상·마감이 오래됨 | 본인 캐비넷의 적합성, 마감, 가격 결정 요인, 주방 이용 영향 | 사진 견적 요청 |
| 2순위 매매·입주 전 집을 정리하는 소유자 | 일정에 맞춰 주방 인상을 개선하고 싶음 | 가능한 일정, 포함 범위, 실제 작업 사례 | 프로젝트 시기 상담 → 사진 견적 |
| 3순위 임대인·부동산 관리자 | 기존 캐비넷의 상태를 정리하고 일정·보고를 관리 | 손상 상태, 작업 범위, 접근·일정, 견적·완료 기록 | 담당자 상담 → 관리물건별 견적 |

위 고객군은 회사 실적 데이터로 순위가 검증된 세그먼트가 아니라 첫 실험의 우선순위다. 임차인 문의는 소유자·관리자의 작업 승인 여부를 확인한다. 매매가 상승이나 임대료 상승을 약속하지 않는다.

### 경쟁 사이트에서 참고할 구조

| 공개 표본 | 실제로 관찰한 구성 | L&K에 적용할 판단 |
| --- | --- | --- |
| [Sky Poly](https://skypoly.com.au/services/kitchen-cabinet-respray/) | 도장 범위·제외·재질·공정·가격 요인·사진/문짝 목록 상담 | 가격만 강조하기보다 어떤 작업을 맡기는지와 견적 준비물을 명확히 안내 |
| [Surface Care](https://surfacescare.com.au/kitchen-resurfacing/) | 재도장 적합·부적합 상태, 사진 문의, 수리와 도장 설명 | “도장하면 해결되는가”에 먼저 답하고 상태 확인을 견적으로 연결 |
| [Resurfacing Sydney](https://www.resurfacingsydney.com.au/resurfacing-before-and-after) | 전후 이미지 중심의 사례와 문의 CTA | 실제 같은 현장의 전후·범위를 갖춘 사례 콘텐츠 우선 |

이 표본은 콘텐츠와 문의 구조 참고다. 검색 순위·광고비·예약 전환율·사진 진위·업체 자격을 감사한 결과가 아니다. 일부 경쟁사가 광고하는 2pac, benchtop resurfacing 등은 L&K의 확인된 Dulux Aquanamel 기반 캐비넷 도장과 범위가 다르므로 제품·성능·가격을 복사하지 않는다.

## 3 무엇부터 해야 하는가

| 순서 | 할 일 | 구체적인 결과물과 완료 기준 | 제안 담당 |
| --- | --- | --- | --- |
| 1 | 공개 사업 정보 확정 | 브랜드/등록 명의·ABN·GST·자격 표기·전화·최신 운영시간·서비스 구역·가격 조건을 한 기준으로 맞춤 | 회사 대표·Lisa |
| 2 | 회사 소유 계정과 기존 등록 확인 | Google Maps에서 기존 사업 프로필 검색·중복 확인. 회사 Google 계정이 소유하고 작업자는 필요한 권한만 받음. 도메인 DNS 접근 확인 | 회사·마케팅 |
| 3 | 검색 공개 준비 구현 | 운영 홈/KCP에서 meta와 HTTP noindex를 함께 해제하는 안 검토. Preview·관리자·견적/비공개 경로는 별도 정책. www canonical·공개 URL 사이트맵·robots·사업 메타정보 정리 | 개발 |
| 4 | Search Console 인증과 색인 점검 | Domain 속성 `lnkgroupsydney.com.au` DNS 인증 → 사이트맵 제출 → 홈/KCP URL 검사·라이브 테스트 → 색인 요청과 이후 실제 색인 상태 확인 | 회사·개발 |
| 5 | Google Business Profile 인증과 완성 | 실제 사업명·주 카테고리·전화·운영시간·서비스 지역·서비스 설명·사진·웹 링크를 맞춤. 회사가 증빙을 준비하고 Google이 제공한 인증 절차 완료 | 회사·Lisa |
| 6 | 실제 증거·콘텐츠·측정 준비 | 사진 동의, 공정과 실제 사례, 고객 질문 답변. GA4/광고 전환 정의·유입 출처·문의 상태 기록. 실제 모바일 견적과 후속 연락 확인 | 콘텐츠·개발·Lisa |
| 7 | 유입 시험 | 먼저 기존 고객·지역 소개·검색/지도·SNS 유기 게시. 준비 기준 충족 후 제한된 Google Search·Meta 광고 시험 | 마케팅·Lisa |
| 8 | 성과에 따른 확대 | 유효 문의·회사 확정·완료 작업·획득비·이동/재작업 비용을 비교해 지역/소재 유지·개선·중단 | 회사·마케팅 |

2~5의 계정 준비·GBP 인증 대기는 병행할 수 있다. Search Console이 GBP의 필수 선행 등록은 아니며 GBP 인증 방식은 Google이 결정한다. 중요한 의존 관계는 **사이트 공개 정책 정리 뒤 색인 확인**, **문의 접수·전환 측정 준비 뒤 유료 유입 확대**다. 사이트 색인을 기다리는 동안 검증된 문의 경로의 유기 운영은 준비할 수 있다. Places API 결제 준비를 Search Console·GBP 준비의 차단 조건으로 삼지 않는다. [사이트 소유권 인증](https://support.google.com/webmasters/answer/9008080), [사이트맵 제출](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [사업 프로필 인증](https://support.google.com/business/answer/7107242?hl=en)

### Google Business Profile 입력 원칙

- 실제 사용하는 사업명과 증빙을 기준으로 작성한다. 검색 키워드를 붙인 사업명이나 동네별 중복 프로필을 만들지 않는다.
- 고객이 방문하지 않는 거점이면 방문형 사업으로 운영하고 상세 주소를 공개하지 않는다. 인증에 쓰는 실제 주소와 고객에게 표시하는 주소를 구분한다.
- 주 카테고리는 계정에서 실제 선택 가능한 항목 중 주된 업무에 가장 가까운 것을 선택한다. `Painter`는 검토 후보이며 신규 캐비넷 제작업체로 오인되는 카테고리는 피한다.
- 서비스 영역은 도시·우편번호 등 최대 20개이며 반경 방식은 지원하지 않는다. 사이트의 21개 suburb를 그대로 한 개씩 모두 등록할 수 있다고 가정하지 않고 실제 작업 실적·수용량을 기준으로 20개 이내에서 선정한다.
- 현재 웹의 전화 `0404 603 966`, 이메일 `lnkgroupsydney@gmail.com`, 문의시간 매일 7am–5pm Sydney를 대조 기준으로 사용한다. 과거 자료의 9pm 종료 시간을 재사용하지 않는다.
- 확인된 로고·실제 작업 사진, 서비스 범위·상담 링크를 넣는다. 홈페이지 링크와 견적 요청 링크는 플랫폼이 지원하는 필드에 맞춰 연결하고 즉시 확정 예약으로 설명하지 않는다.

[사업체 표현 지침](https://support.google.com/business/answer/3038177?hl=en), [서비스 지역 설정](https://support.google.com/business/answer/9157481?hl=en)

사업 소개 영문 초안은 실제 표기 브랜드 확정 후 사용한다:

> L&K Group provides kitchen cabinet painting for existing kitchens around Ermington and Inner West Sydney. We assess suitable doors, drawer fronts, exposed frames and panels, then agree the preparation, repairs, colour and finish for each project. Removable doors are spray-painted and dried in a separate booth. Share photos of your kitchen to request a provisional estimate. Our team reviews the scope and confirms booking dates.

실제 완료 고객에게 같은 기준으로 솔직한 리뷰를 요청하고 답변한다. 긍정 고객만 선별하거나 별점·키워드를 요구하지 않으며 할인·사은품과 리뷰를 교환하지 않는다. 로컬 순위는 관련성·거리·인지도 등의 영향을 받으므로 서비스 지역을 늘리는 것만으로 지역 전체 노출이 확보되지 않는다. [리뷰 정책](https://support.google.com/contributionpolicy/answer/7400114?hl=en), [로컬 순위 요인](https://support.google.com/business/answer/7091?hl=en)

## 4 SEO 콘텐츠 작성 계획

홈은 회사와 지역 정보를, KCP는 캐비넷 도장 선택과 견적 행동을 담당한다. 47·48번에서 승인한 짧은 랜딩과 홈 지역 정보의 역할을 유지한다. 긴 설명이 필요한 주제는 고유한 가이드나 실제 사례로 분리하고 KCP와 연결하는 후속안을 검토한다.

| 검색 의도 가설 | 우선 주제와 예시 검색어 | 연결 위치·내용 | 고객 행동 |
| --- | --- | --- | --- |
| 바로 업체를 찾음 | kitchen cabinet painting Sydney / kitchen cupboard painting / cabinet repainting near me | KCP에 제공 작업·지역 요약·실제 공정·견적 방법 | 사진 견적 |
| 비용·범위 비교 | kitchen cabinet painting cost Sydney / painting vs replacing kitchen cabinets | 수량·재질·준비·보수·도장면·철물·접근 등 가격 요인, 기존 구조 유지 적합성 | 본인 주방 범위 확인 |
| 재질·손상 판단 | can laminate cabinets be painted / peeling kitchen cabinet paint | 재질·박리·부풀음·수분/구조 문제를 실제 사진과 설명 | 사진·회사 검토 |
| 생활·일정 판단 | how long does cabinet painting take / can I use my kitchen | 회사 일반 기간과 현장별 일정·건조/경화·사용 안내 | 프로젝트 시기 상담 |
| 지역 신뢰 확인 | cabinet painting Ermington / Ryde / Inner West | 현재 서비스 구역 + 해당 지역 실제 사례가 있을 때만 고유한 사례 콘텐츠 | 해당 주소 가능 여부 확인 |

검색어는 검색량이 확인된 우선순위가 아니라 검증할 후보다. Search Console 검색어와 광고 계정 Keyword Planner·실제 검색어 결과로 보정한다. `2pac`, 새 캐비넷 제작, 벤치탑 도장 등 제공 범위와 맞지 않는 검색 수요를 무리하게 확보하지 않는다.

### 먼저 작성할 콘텐츠

1. **KCP 제목·설명·도입 문구:** 서비스와 Sydney를 명확히 하고 범위·잠정 견적·회사 확정을 일치시킨다.
2. **사진 견적 준비 가이드:** 주방 전체, 문·서랍, 손상 근접 사진과 필요한 지역 정보, 비공개 저장과 예상 견적의 한계를 설명한다.
3. **도장과 교체의 선택 기준:** 구조·수분 손상·배치 변경 여부를 기준으로 판단한다. 증명되지 않은 절감률은 쓰지 않는다.
4. **가격 결정 요인 가이드:** 승인 가격의 현재 GST·범위 정합성을 확인한 뒤 시작가 조건과 추가 작업의 결정 방식을 설명한다.
5. **같은 현장의 실제 사례:** 동의받은 전·과정·후 사진, suburb, 도장면·재질·범위·실제 기간을 기록한다. 없는 사례는 공정 설명으로 대체한다.

KCP 메타데이터 초안:

- Title: `Kitchen Cabinet Painting Sydney | L&K Group`
- Description: `Refresh your existing kitchen cabinets around Ermington and Inner West Sydney. Explore the process and request a photo-based provisional estimate.`
- H1 검토안: `Kitchen Cabinet Painting in Sydney`
- 지역 안내: `Serving Ermington, surrounding suburbs and Inner West Sydney. Confirm availability for your property address.`
- 주 CTA: `Request a photo-based estimate`

지역명만 바꾼 21개 페이지를 만들지 않는다. 실제 사례·접근·서비스 내용 등 지역별로 고객에게 다른 도움이 있을 때 페이지를 추가한다. 외부 인용·디렉터리도 실제 회사 정보로 관리하며 무관한 링크 구매·가짜 언급은 피한다. [Google 스팸 정책](https://developers.google.com/search/docs/essentials/spam-policies)

### 검색 공개 기술 작업안

공개 홈·KCP·승인된 사례/가이드에 self canonical, 읽을 수 있는 본문, 제목·설명, 고유 H1, 내부 링크, 이미지 크기·대체텍스트·공유 이미지를 적용한다. 사이트맵에는 검색 공개할 정규 URL만 넣고 견적, 관리자, 인증, 비공개 사진·문서·시험 URL은 제외한다. 비공개 자료는 인증·권한으로 보호하며 noindex를 보호 수단으로 사용하지 않는다.

사업 정보는 확인된 값으로 Organization·Breadcrumb를 우선 검토하고, Service는 서비스 의미를 설명하는 데 필요한 범위에서 사용한다. LocalBusiness의 검색 표시 요건을 맞추려고 비공개 주거 주소·가짜 주소를 넣지 않는다. 실제 공개 주소와 해당 요건을 충족할 수 있을 때만 적합성을 검토한다. 자사 후기의 별점이나 검증되지 않은 평점을 구조화 데이터로 만들어 넣지 않는다. [Organization 안내](https://developers.google.com/search/docs/appearance/structured-data/organization), [LocalBusiness 안내](https://developers.google.com/search/docs/appearance/structured-data/local-business)

## 5 AEO 작성과 확인 방법

AEO는 고객이 검색·AI 답변에서 궁금증을 해결하고 L&K를 후보로 판단하도록 내용을 명확히 만드는 작업이다. Google의 최신 가이드는 이를 기존 SEO의 연장으로 설명하며 실제 경험과 독자적인 콘텐츠, 색인·스니펫 적격성, Search Console의 검색 생성형 AI 포함 설정을 안내한다. AI 전용 스키마나 `llms.txt`는 Google 노출 필수 요건이 아니다. [2026-07-10 Google AI 최적화 가이드](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)

고객 질문에는 먼저 답하고, 판단 조건과 다음 행동을 연결한다. 짧은 답변은 독자의 이해를 위한 편집 방식이며 AI 노출을 위한 고정 문장 길이나 순위 공식으로 사용하지 않는다. 현재 5개 FAQ를 무조건 늘리기보다 실제 문의에서 반복되는 질문을 보강한다.

영문 답변 초안:

**Can my existing kitchen cabinets be painted?**

> Suitable existing cabinets can be repainted, but the material, current coating and condition need assessment first. Swelling, moisture damage or loose coverings may require another repair or replacement approach. Share photos of the whole kitchen and affected areas so our team can review the scope.

**What affects the cost of kitchen cabinet painting?**

> The estimate depends on the doors, drawer fronts and panels to be painted, their material and condition, and the preparation and repairs needed. Included faces, hardware work and access are agreed separately. A photo-based amount is provisional until the scope and actual condition are checked.

**How long does the work take?**

> L&K generally allows 3–7 days for work and drying, with careful use recommended for 7 days after reinstallation. Your schedule and kitchen access depend on the agreed scope and finish. Drying is different from full curing, so follow the care guidance for your project.

**Does submitting the form confirm my booking?**

> No. You review the provisional estimate, verify your email, choose a preferred take-off date and time, then sign and submit a booking request. L&K reviews the scope and installation schedule and sends confirmation after the booking is confirmed by the team.

위 답변은 기존 회사 일반 안내와 현행 고객 흐름을 바탕으로 한 검토용 초안이다. 일반 기간은 모든 현장의 고정 납기나 주방 전체 사용 가능 시점으로 바꾸지 않는다.

**2026-05-07부터 Google FAQ rich result는 종료됐다.** FAQ 본문은 고객 판단과 견적 전환에 활용하며 FAQ 스키마로 확장 결과를 보장하는 계획은 세우지 않는다. [Google 변경 기록](https://developers.google.com/search/updates)

Search Console에서 `Settings → Search generative AI`의 포함·상속 상태를 확인한다. 공식 안내상 2026-08-31 전 세계 제공이 완료됐으며 기본은 Include지만 실제 회사 속성 설정은 확인해야 한다. AI Overviews·AI Mode의 **Generative AI performance report**로 페이지별 노출을 관찰하고 유효 문의·확정 예약은 별도 전환 데이터와 대조한다. 노출이 부족하면 보고서가 보이지 않을 수 있다. AI 노출 수를 예약이나 매출로 환산하지 않는다. [AI 포함 설정](https://support.google.com/webmasters/answer/16908024?hl=en), [AI 성과 보고서](https://support.google.com/webmasters/answer/16984139?hl=en-GB)

다른 AI 서비스의 추천·인용은 대표 질문을 정해 참고 관찰할 수 있지만 Google 설정과 보고서를 그대로 적용하지 않는다. AI 답변을 유도하는 가짜 후기·타 사이트 조작 대신 실제 작업 콘텐츠와 사업 정보의 일관성을 우선한다.

## 6 지역 문의를 견적과 예약으로 연결

### 지역 운영

광고 시험은 현재 서비스 구역을 다음 묶음으로 관찰한다. 실제 우선순위는 이동시간·방문 가능한 일정·완료 작업의 기여이익으로 조정한다.

| 관찰 묶음 | 현재 회사 목록의 지역 | 활용 |
| --- | --- | --- |
| Ermington과 인근 | Ermington, Dundas, Telopea, Carlingford, North Rocks | 거점 주변 문의와 이동 부담을 먼저 파악 |
| Ryde와 북쪽 인근 | Epping, Eastwood, Macquarie Park, Ryde, Lane Cove, Gladesville | 실제 방문 여건·문의 적합성 비교 |
| 강변과 Inner West | Silverwater, Rhodes, Concord, Drummoyne, Auburn, Lidcombe, Strathfield, Five Dock, Burwood, Ashfield | 이동·재방문 비용과 실제 사례가 생기는 지역 비교 |

이 묶음을 초기부터 각각 광고 세트로 나누지는 않는다. 예산과 자료가 적으면 하나의 승인 서비스 구역으로 운영하고 CRM에서 묶음별 결과를 본다. 모든 지역을 10km 안이라고 표시하지 않으며 광고 위치만으로 주소 적합성·예약 가능을 확정하지 않는다.

지역 접점은 Google 지도·검색, 허용된 지역 Facebook 커뮤니티, 실제 부동산·유지관리 파트너 소개, 시공 현장 주변의 동의·허가된 홍보를 검토한다. 지역 그룹의 홍보 규칙을 확인하고 담당자가 답변 가능한 글만 올린다. 지역·파트너별 QR/UTM으로 출처를 구분하며 개인정보나 비공개 현장 주소를 공개하지 않는다. 영업 메시지 전송이나 파트너 접촉은 별도 실행 범위다.

### 전환 흐름과 필요한 운영

| 단계 | 고객이 해야 할 일 | 연결을 돕는 내용·회사 행동 | 판정 기준 |
| --- | --- | --- | --- |
| 발견 | 검색·지도·SNS에서 업체 확인 | 지역, 기존 캐비넷 도장, 실제 자료를 같은 메시지로 제시 | 관련 방문 |
| 판단 | 적합성·공정·범위 읽기 | 짧은 KCP 랜딩, 실제 사례/공정, 잠정 견적 설명 | 견적 CTA 또는 실제 상담 |
| 견적 준비 | 신규 작성·연락처/주소·캐비넷·사진 | 필요한 사진과 지원 형식 안내. 사진 미준비 고객은 기존 전화/메일 상담 | 저장한 초안·사진 상태 |
| 예상 확인 | 현재 사진 분석·숫자 예상 또는 회사 검토 요청 | AI 예상과 실제 견적 조건 구분. 숫자가 안 나오면 담당자가 검토 요청 확인 | 예상 금액 확보 또는 회사 검토 접수 |
| 예약 요청 | 방문일 이메일 인증·take-off 희망 시간·서명 제출 | 인증 복귀·다음 단계·회사 처리 주체를 분명히 안내 | 서버 제출 성공 |
| 회사 확정 | 고객 요청에 대한 회사 확인 수신 | EMS에서 범위·일정·installation 검토, 회사 확정 처리 | 서버 confirmed와 Google 두 방문 저장·검증 |
| 완료·소개 | 실제 작업 완료·관리 안내 | 청구·입금 기록 대조, 솔직한 리뷰와 사례 게시 동의 요청 | 완료 작업·실제 입금 |

현행 기준은 [45번 예약 계획](45-simple-take-off-install-booking.md), [50번 단일 이메일 인증](50-booking-stage-email-verification.md), [51번 진입 분리](51-quote-entry-and-contact-prefill.md)다. 예상 견적 열람·서명 제출을 계약·결제·확정 예약으로 집계하지 않는다.

### 광고 전 검증할 이탈 위험

- 상세 주소를 예상 금액보다 먼저 입력하는 부담과 Places 미준비 영향을 단계별로 측정한다. 주소를 뒤로 옮기거나 새 간편 문의를 만드는 것은 후속 설계·구현 결정으로 둔다.
- 사진별 촬영 영역 선택·비공개 저장·별도 분석 실행을 고객이 이해하는지 확인한다. 현재 지원은 JPEG/PNG/WebP, 사진당 10MB 이하, 최대 8장이다. 실제 iPhone 사진 선택과 Instagram/Facebook 인앱 브라우저에서 업로드·복귀·인증을 인수한다.
- 숫자 예상이 없어 방문일을 진행할 수 없는 고객은 기존 `Ask our team to review`를 활용한다. 검토 요청의 담당자·첫 답변·미처리 목록을 정해 AI 실패가 문의 유실로 이어지는지 확인한다.
- 현재 공개 연락 안내는 24시간 이내 답변 목표다. 광고로 문의량을 늘리기 전에 Lisa의 실제 응답 가능량을 확인한다. 운영시간 중 더 빠른 첫 답변은 내부 목표로 시험하며 바로 고객 약속으로 바꾸지 않는다.
- 접수 알림은 실제 저장 성공 뒤 제공한다. 후속 연락은 상담 의사와 고객 요청의 맥락에 맞춰 진행하고 미응답 리마인더 횟수·방법을 정한다. 견적/AI 동의를 홍보메일·광고 추적 동의로 확대하지 않는다.

## 7 Instagram Facebook 콘텐츠와 게시 방법

### 계정 준비 순서

기존 `@lnk_kitchenbath`의 소유자와 계정 유형을 확인한다. 회사 Facebook Page·Instagram professional 계정·Business Portfolio·광고 계정을 회사 소유로 연결하고 필요한 작업 권한과 2단계 인증을 설정하는 안을 준비한다. 기존 연결이 있으면 재사용한다. Business Suite에서 게시 예약·Inbox를 함께 관리하며, 실제 메뉴와 연결 권한은 해당 계정에서 확인한다. [Business Portfolio 교육](https://www.facebookblueprint.com/student/collection/284227/path/240398), [Business Suite 교육](https://formedia.facebookblueprint.com/student/path/253041-meta-business-suite-customer-connection), [Instagram 연결 도움말](https://www.facebook.com/help/instagram/570895513091465)

프로필 소개에는 기존 캐비넷 도장·지역·사진 견적을 넣고 KCP 또는 준비된 견적 진입 링크를 연결한다. 고정 게시물은 서비스/적합성, 실제 공정/사례, 견적 준비법의 세 가지를 우선한다. 현재 그룹 홈보다 캐비넷 전용 페이지로 연결해 광고에서 약속한 내용을 바로 보여준다.

### 메인 주제와 소재

| 우선 주제 | 표현과 자료 | 적합한 형식 | 행동 유도 |
| --- | --- | --- | --- |
| 기존 주방의 변화 | 같은 현장의 실제 전후, 배치 유지와 색상·마감 변화 | Reel·전후 캐러셀 | 사진 견적 요청 |
| 준비와 마감의 신뢰 | 실제 청소·보수·분사·마감 확인 | 공정 Reel·사진 설명 | 작업 방식과 견적 보기 |
| 도장 가능한 캐비넷 | 재질·박리·손상 확인, 가능한/어려운 조건 | 질문 캐러셀·짧은 설명 영상 | 본인 캐비넷 사진 상담 |
| 견적 준비의 쉬움 | 전체·문·서랍·손상 사진 예시, 지역과 시기 | 안내 Reel·고정 게시물 | 준비하고 견적 시작 |
| 비용·일정의 판단 | 가격 결정 요인, 범위·사용 영향·회사 확정 | FAQ 캐러셀·담당자 설명 | 범위·가능 일정 상담 |
| 지역 사례와 후기 | 실제 suburb·작업 범위·고객 허락받은 후기 | 사례 게시물·Stories | 해당 주소 가능 여부 확인 |

초기에는 실제 공정과 견적 준비법을 중심으로 운영한다. 전후 짝이 확인되지 않은 사진이나 생성 주방을 실제 변화 광고로 쓰지 않는다. 준비가 끝난 뒤 메인 광고 소재를 실제 전후로 확장한다. 확인되지 않은 보험·무조건 5년 보증·절감률·최저가·집값 상승·즉시 확정 예약은 광고 카피에서 제외한다.

### 게시 실무

1. 한 콘텐츠에 한 질문 또는 한 변화만 담는다. 시작 장면에서 기존 캐비넷·공정·지역이 무엇인지 이해되게 한다.
2. 실제 사진을 같은 각도와 가능한 같은 조명에서 촬영하고 과도한 보정으로 결과를 바꾸지 않는다. 주소·얼굴·개인 물품과 위치 메타정보 노출을 점검한다. 견적용 비공개 사진과 공개 홍보 동의는 별개다.
3. Reels는 9:16 세로본을 우선 제작하고 자막·핵심 문구를 safe zone에 둔다. Feed용 4:5 파생본은 제작 제안이며 최종 광고 placement preview에서 크롭·버튼 가림을 확인한다. 상업 사용 가능한 오디오로 제작하고 음소거에서도 이해되게 한다. [Meta Reels 광고 안내](https://www.facebook.com/business/ads/facebook-instagram-reels-ads)
4. Instagram에는 시각적 설명과 프로필 링크·Stories 링크 또는 관리 가능한 DM 경로를, Facebook에는 충분한 설명과 클릭 가능한 서비스 링크를 배치한다. 피드 캡션의 URL만으로 Instagram 견적 이동이 완료된다고 가정하지 않는다.
5. 실제 지역·서비스와 관련된 위치 태그와 소수의 해시태그를 사용한다. 해시태그 개수나 게시 시간으로 문의 성과를 보장하지 않는다. 예약 게시 시간은 계정 인사이트와 담당자 응답 가능 시간을 보고 조정한다.
6. 문의에는 suburb·기존 캐비넷 도장 여부·시기를 먼저 확인하고 다음 행동을 안내한다. 상세 주소와 고객 사진을 공개 댓글로 받지 않는다. 같은 문의를 여러 채널에서 받으면 CRM에 하나의 프로젝트로 연결한다.

초기 제작량 제안은 **주 1 Reel + 주 1 캐러셀/사진 게시물**, 같은 자료의 Stories 재활용이다. SNS별로 별도 촬영을 늘리기보다 같은 주제를 채널에 맞게 편집한다. 운영 여유와 실제 자료가 생기면 빈도를 늘린다.

### 첫 4주 콘텐츠 캘린더

| 주차 | Reel | 캐러셀/사진 | Stories·사이트 연계 |
| --- | --- | --- | --- |
| 1주 | 실제 부스·준비 작업과 기존 주방을 유지하는 서비스 소개 | 도장과 교체를 판단하는 기준 | 도장 가능한가 질문 수집 → KCP/FAQ |
| 2주 | 견적 사진 촬영 방법 | 문·서랍·패널과 포함 범위 | 사진 준비 안내 → 견적 링크 |
| 3주 | 동의된 실제 전후 확보 시 사례, 없으면 실제 보수·마감 공정 | 가격을 결정하는 요소 | 재질·손상 질문 → 회사 검토 |
| 4주 | 사진 예상 → 희망 방문일 → 회사 확정 설명 | 실제 고객 질문에 대한 답변 | 상담/견적 경로 재안내·다음 달 사례 준비 |

### 광고용 영문 카피 초안

**소재 A 기존 주방 유지**

> Still happy with your kitchen layout? Explore a fresh finish for your existing cabinets. L&K Group provides kitchen cabinet painting around Ermington and Inner West Sydney. Share kitchen photos for a provisional estimate. Scope and booking dates are confirmed by our team.

Headline: `Refresh your existing cabinets`

**소재 B 실제 공정**

> A cabinet refresh starts with preparation. See how removable doors are prepared, spray-painted and dried in a separate booth. Tell us about your existing kitchen and the finish you have in mind.

Headline: `See the preparation behind the finish`

**소재 C 견적 준비**

> Planning a kitchen cabinet refresh? Start with photos of the full kitchen, doors, drawer fronts and any damaged areas. Explore our process and request a photo-based estimate for your project.

Headline: `Start with your kitchen photos`

실제 사진·영상과 지역·서비스 정합성을 확인한 뒤 사용한다. A도 실제 전후 자료가 없으면 “우리 시공 결과”를 암시하는 이미지 대신 확인된 공정·담당자 자료를 붙인다. CTA 버튼은 Ads Manager에서 제공하는 것 중 랜딩 행동과 일치하는 항목을 선택한다.

## 8 유료 광고의 초기 시험

### Google Search

처음에는 실제 제공하는 캐비넷 도장과 견적 의도가 높은 검색어를 묶은 작은 검색 캠페인으로 시작한다. 문구/일치 검색을 우선 검토하고 검색어 보고서로 범위 밖 의도를 제거한다. 브랜드 검색과 비브랜드 검색의 성과는 구분하되 소액 예산을 과도하게 캠페인으로 나누지 않는다.

초기 제외 검토 대상은 DIY tutorial·jobs·salary·course·새 캐비넷 제작·공급 전용·제공하지 않는 2pac/benchtop 서비스 등이다. 실제 검색어를 보고 제외하며 `cost`·`price`·`quote`처럼 구매 판단과 연결되는 검색어를 일괄 차단하지 않는다.

위치는 실제 서비스 구역으로 제한하고 `Presence`를 시작안으로 검토한다. 기본 `Presence or Interest`는 구역 밖에서 관심을 보이는 사람도 포함할 수 있다. 위치 판별은 완벽하지 않으므로 저장된 실제 서비스 주소와 문의 적합성까지 확인한다. [Google Ads 위치 옵션](https://support.google.com/google-ads/answer/1722038?hl=en)

### Instagram Facebook 광고

Ads Manager에서 **Leads 목적 → 준비된 주 문의 경로 → 승인 지역·예산 → 소재 2~3종 → placement 미리보기·추적 확인 → 제한 시험** 순서로 설정하는 안이다. 기존 웹사이트에 사진 견적 기능이 있으므로 주 경로는 KCP → 웹 견적을 우선 검토한다. 조회수·팔로워 증가를 이번 주요 성과로 삼지 않는다.

| 문의 경로 | 사용 조건 | 전환 집계 |
| --- | --- | --- |
| 웹 견적 | 모바일 사진·저장·인증·회사 처리 흐름 인수 | 실제 제출/검토 요청과 유효 문의를 구분 |
| Instant Form | 짧은 상담 문의와 후속 연락 담당자·개인정보 안내 준비 | 플랫폼 제출 후 실제 적합성 확인. 견적·예약으로 간주하지 않음 |
| Instagram DM·Messenger | 응답 가능한 담당자와 CRM 기록 기준 확보 | 메시지 시작·유효 문의·회사 확정을 따로 기록 |

처음부터 세 경로와 여러 지역·연령·관심사 광고 세트를 동시에 운영하지 않는다. 같은 주 경로·지역에서 메시지 2~3개를 비교하고, 문의량이 충분해지면 경로 실험을 추가한다. 작은 방문자 풀에서 리타기팅 캠페인을 먼저 분리하지 않는다. 실제 계정에서 지역 제어·Advantage+·성과 목표의 가용성을 확인한다.

Meta 공식 자료는 웹사이트·Instant Forms·메시지 경로를 구분하며 현재 Blueprint는 웹 폼과 Instant Forms 모두의 CRM CAPI 연계를 다룬다. 고품질 문의 최적화를 특정 경로에서만 가능하다고 단정하지 않는다. 초기에는 회사가 유효 문의·예약 상태를 정확히 기록하고 그 후 데이터가 준비되면 서버 전환 연계를 추가한다. [Meta 문의 광고 가이드](https://about.fb.com/ltam/wp-content/uploads/sites/14/2023/11/LeadGenerationGuide.pdf), [현재 CRM CAPI 교육](https://www.facebookblueprint.com/student/activity/603002-improve-lead-quality-with-meta-conversions-api-for-crm)

### 예산과 증액 기준

실제 월 예산과 주간 작업 가능량이 없으므로 확정 예산이나 예상 문의 수를 산출하지 않는다. 검토용 예로 **4주 매체비 A$1,500**을 승인한다면 Google Search A$1,050, Meta A$450의 배분으로 시작할 수 있다. 이는 검색 의도 포착에 우선 배분하는 시험 가정이며 성과 검증된 비율이 아니다. 촬영·편집·운영·대행 비용은 별도이며 채널별 입찰비·검색 수요를 확인해 한 채널부터 시작하는 선택도 가능하다.

**완료 작업 1건의 광고 전 기여이익 − 확보할 잔여 기여이익 = 총 고객획득비 한도**로 판단한다. 기여이익은 실제 세금 처리와 할인·자재·노동·이동·결제·재작업 비용을 반영한다. **유효 문의당 허용 비용 = 고객획득비 한도 × 유효 문의의 완료 작업 전환율**로 계산하되 초기 전환율을 가상의 시장 평균으로 채우지 않는다.

증액은 같은 문의 코호트의 회사 확정·작업 완료·입금과 비용을 확인한 뒤 판단한다. 응답 지연·무효 문의 증가·회사 수용량 초과가 생기면 광고 확대보다 운영 원인을 먼저 해결한다. 적은 표본이나 당일 CPL만으로 승자를 확정하지 않는다.

## 9 측정과 고객 정보 처리

유효 문의는 서비스 지역·기존 캐비넷 도장 범위·실제 연락 가능·상담 의사가 확인된 중복 없는 프로젝트로 정의하는 안이다. 사진 미제공·아직 회사 검토 중인 문의는 상태를 남기고 자동 폐기하지 않는다. 전화/DM도 동일 기준으로 기록한다.

| 지표 | 기준 | 해석 |
| --- | --- | --- |
| 검색·지도·AI 노출 | Search Console·GBP의 실제 보고 | 발견 가능성, 예약이나 매출 아님 |
| 견적 진입률 | 신규 견적 시작 / 관련 방문 | 랜딩과 CTA의 연결 |
| 단계 이탈 | 연락처·사진·AI·방문일·서명 단계 도달/완료 | 어느 단계에서 막히는지 |
| 유효 문의당 매체비 | 채널 매체비 / 유효 문의 | 클릭 가격보다 문의 적합성 |
| 예약 요청률 | 제출 성공 / 적합한 견적 진행 프로젝트 | 예상에서 고객 행동으로 이동 |
| 회사 확정률 | confirmed / 같은 제출 코호트 | 회사 검토·일정과 고객 진행 |
| 완료 고객 획득비 | 매체·콘텐츠·대행 등 획득 비용 / 신규 고객 완료 작업 | 수익성의 주요 기준 |
| 응답시간·실주 사유 | 실제 문의·첫 응답 시각, 지역/범위/가격/시기/연락 사유 | 유입과 운영 문제 구분 |

GA4/광고 계측은 공개 조회·CTA 클릭·단계 도달과 서버 성공 상태를 구분한다. 내부 단계 후보는 `quote_started`, `photo_upload_completed`, `estimate_ready`, `team_review_requested`, `booking_request_submitted`, `booking_confirmed`다. `Lead`/GA4 주요 이벤트로 무엇을 보낼지는 정의 후 매핑하며 모든 버튼을 문의 완료로 보내지 않는다. 실제 완료·입금 데이터가 확보되기 전 `Purchase`·ROAS를 보고하지 않는다.

유입은 최초·최근 UTM, 필요한 승인 광고 클릭 식별자, 고객 진술 출처를 구분해 내부 요청에 연결한다. 예: `utm_source=instagram`, `utm_medium=paid_social`, `utm_campaign=kcp_local_test`, `utm_content=process_a`. 전화·DM·QR도 직원 기록과 실제 문의 ID로 대조하고 출처 불명을 추정해서 채우지 않는다. Google과 Meta가 각자 주장하는 전환 수를 더하지 않고 내부 프로젝트·회사 확정 기준으로 비교한다.

분석에는 이름·이메일·전화·상세 주소·사진·서명·자유입력·OTP·비공개 URL을 보내지 않는다. URL/쿼리 매개변수와 이벤트도 허용목록으로 관리한다. 견적 저장·AI 동의는 광고 추적·리타게팅·사진 게시 동의가 아니다. 플랫폼별 연락처 매칭 기능을 후속 도입할 경우 별도의 사용 근거·고지·정책을 확인하며 해싱만으로 허용된 것으로 판단하지 않는다. [Google Analytics 개인정보 안내](https://support.google.com/analytics/answer/6366371?hl=en)

재시도·새로고침·서버와 브라우저 전송은 같은 상태 전환의 안정된 식별자로 중복 제거한다. Meta에 Pixel·CAPI를 함께 보내면 동일 행동의 `event_name`과 `event_id`를 맞춘다. 사진 준비/분석 완료와 유효 문의를, 예약 요청과 회사 확정을 각각 별도 상태로 유지한다. [Meta 공식 SDK의 중복 제거 설명](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/serverside/event.py#L230)

## 10 실행 착수 후 90일

| 기간 | 실행 순서 | 결과와 판정 기준 |
| --- | --- | --- |
| 1주 | 사업 명의·GST·사업명/연락처 정리, 기존 GBP·계정 소유 확인, 검색 공개 작업안 확정, 실제 사진 정리 | 정합성 이슈·계정 권한·공개 범위·사진 사용 동의 확인 |
| 2주 | 공개 SEO 수정·SC 인증/사이트맵/URL 검사, GBP 인증 진행, 필수 콘텐츠·유입 기록 준비 | noindex/canonical/비공개 경계 확인. 인증과 색인의 실제 상태 기록 |
| 3~4주 | 모바일·인앱 견적 인수, 유기 게시, 준비 완료 시 검색/Meta 제한 시험 | 실제 저장·검토 요청·회사 확정까지 연결, 단계 이탈·무효 문의 사유 |
| 31~60일 | 검색어 정리, 실제 사례와 반복 질문 추가, 유효 메시지 유지, 회사 후속 응답 보정 | 채널·지역별 적합 문의·회사 확정·완료 작업과 비용 대조 |
| 61~90일 | 실제 수익성과 작업 가능량에 맞춰 지역·광고 확대, 지역 파트너/소개 시험 검토 | 완료 고객 획득비·이동비·재작업·응답 용량 기준 확대/유지/중단 |

주간 확인은 검색어·지역 유입, 유효 문의, 가장 큰 이탈 단계, 미처리 문의, 회사 확정과 수용량 순으로 한다. 사례 한 건에서 사이트 설명·Reel·캐러셀·GBP 사진을 재사용하고 각 채널 성과를 내부 문의 기록으로 대조한다.

## 11 실행 전에 필요한 결정

1. 실제 계약·청구 명의, L&K Group의 사용/등록 관계와 현행 GST·가격 표기 대조 결과.
2. 공개 홈·KCP의 색인 활성화 범위와 회사 Google 계정의 SC/GBP 소유·접근 상태.
3. 게시 허락을 받은 실제 시공 전후·공정 자료와 반복해서 촬영할 담당자.
4. 광고 시험 예산, Lisa의 문의 대응량, 실제 주간 수용 가능한 작업량.
5. 초기에 사용할 주 문의 경로와 유효 문의·완료 작업·광고 출처의 기록 담당.

이미 제공된 회사 전화·지역·Instagram·도메인은 다시 정하지 않는다. 변경이 있는 정보만 현행 회사 기준으로 보정한다. 가장 먼저 착수할 묶음은 **명의/GST 대조 + 공개 SEO 정책 정리 + Search Console/GBP 기존 소유 확인**이다.

## 12 근거와 검증 범위

프로젝트 기준은 [회사 제공 자료](../reference-assets/company-brief.md), [47번 KCP 구성](47-kcp-landing-ui-ux-content-plan.md), [48번 홈/지역 구성](48-lk-group-home-ui-ux-plan.md), [최신 운영 배포·검증](../verification/2026-10-13-quote-ui-release.md)을 사용했다. 오래된 미배포·미구현·10km 전체 제한 설명을 현재 상태로 재사용하지 않았다.

이번에는 공개 홈·KCP·견적 시작 화면의 브라우저 표시, 홈/KCP/견적의 HTTP 200·robots 메타/헤더·메타데이터, robots/sitemap 404, 현재 로컬 흐름과 공개 공식 자료를 확인했다. 실제 고객 자료·기존 SC/GBP·Meta 광고 계정, 광고 비용/성과·검색량·전체 모바일 견적 제출은 열거나 시험하지 않았다. 초기 이탈 위험은 코드와 흐름을 근거로 검증할 가설로 구분했다.

Meta 일부 Business Help·Ads Guide는 로그인 또는 접근 제한이 있어 Blueprint·공식 가이드·SDK로 보완했다. 최신 계정별 메뉴·성과 목표·타기팅·placement 세부 규격은 실제 회사 계정에서 후속 확인한다. 기존 자동 검사나 과거 운영 smoke를 이번 마케팅 성과/전체 인앱 고객 흐름의 검증으로 표현하지 않는다.
