# KCP SEO 콘텐츠·서비스 지역 개정

**2026-09-28 최신 상태:** 사용자 최종 정정으로 메인은 기존 프로토타입을 유지하고 KCP 상세에만 사진형 Hero·전체 화면 7단계 공정을 적용했다. 기존 서비스·지역·FAQ·8개 앵커는 유지한다. [최종 명세](22-cinematic-cabinet-story.md)와 [이번 검증](../verification/2026-09-28-scroll-storytelling.md)을 따른다. 아래는 최초 프로토타입/콘텐츠 기록이다.

2026-09-27 · 사용자 승인: 제안한 SEO 구성으로 KCP 페이지를 임의 수정하고, 부족한 회사 정보는 임시 내용으로 작성해 표시한다. 작업 브랜치는 기존 `codex/kcp-page-prototype`을 유지한다. 이 문서는 [18 프로토타입](18-kcp-page-prototype.md)의 후속 개정이다.

**로컬 콘텐츠 개정·검증 완료.** [검증 결과](../verification/2026-09-27-kcp-seo-content.md). 회사 내용 확정·공개·주소 검증·견적 접수 완료를 뜻하지 않는다.

**회사 자료 접수에 따른 후속 기준:** 같은 날짜 [회사 답변](../reference-assets/company-brief.md)으로 서비스 지역이 **Ermington 10km + Inner West Sydney 및 명시한 21개 suburb**로 구체화됐다. Lane Cove·Drummoyne·Ashfield도 회사 목록에 포함된다. 아래 거리 조사는 과거 후보 조사이며 현재 서비스 범위를 제한하는 근거로 사용하지 않는다. 회사 소개·연락처·도장 제품·일반 작업기간·로고·작업 사진은 수령됐고 Cabinet 가격·기본 포함 범위·보증 상세·사진별 현장 설명/전후 짝·도메인·공개 승인은 여전히 미정이다. 웹사이트 온라인 견적 기능과 실제 전화·이메일 문의 가능 여부는 구분한다. Cabinet의 공간/마감 컨셉 이미지는 아직 실제 시공 사례로 교체하지 않았다.

## 지역 기준과 조사 방법

- 사용자가 지정한 `working area.png`에는 **Ermington을 중심으로 한 10km 반경**이 표시되어 있다. 현재 KCP 콘텐츠의 반경은 10km이며 이전 문서의 15km를 KCP 운영 기준으로 재사용하지 않는다.
- Google Maps에서 Ermington과 지도에 표시된 주변 suburb를 직접 검색했다. 최종 Ermington suburb 검색 결과의 대표 지점 `-33.8143301, 151.0562386`을 임시 조사 기준으로 사용한다. 이는 회사 주소·확정 작업 출발점이 아니다. 초기 검색은 별도의 우편번호 결과(`-33.8132521, 151.0616918`)였으므로 suburb 결과로 다시 계산했다.
- Google Maps가 반환한 개별 suburb 대표 지점 간 직선거리를 Haversine 방식으로 계산해 지역 후보를 보조 확인한다. 계산값은 Google이 제공한 이동거리·운전거리·행정구역 전체 포함 판정이 아니다.
- 최종 회사 기준점, 정확한 10,000m 경계 포함 정책, 주소별 가능 여부는 후속 견적 설계에서 확인한다. suburb 이름만으로 자동예약을 허용하거나 구역 전체를 보장하지 않는다.
- 사용자 제공 지도는 지역 의도 참고 자료다. 정밀 경계 지도나 공식 Google 서비스 반경으로 재배포하지 않는다. 웹페이지에는 설명·지역 묶음·Google Maps의 Ermington 보기 링크를 제공하고 지도 API·계정은 연결하지 않는다.

개별 검색 URL·좌표와 계산 결과는 [지역 조사 기록](../research/2026-09-27-kcp-service-area.json)에 보존한다. 최종 기준점에서 대표 지점까지의 직선거리는 Parramatta 약 5.0km, Ryde 4.5km, Macquarie Park 7.2km, Five Dock 9.1km다. Drummoyne 약 10.0km·Lane Cove 10.5km는 주소 확인 안내로 분리하고, Ashfield 10.4km는 주 서비스 지역 목록에 넣지 않는다. 소수 첫째 자리로 반올림한 조사값이며 예약 판정에 사용하지 않는다. Rydalmere·Dundas·Telopea·Silverwater·West Ryde·Eastwood·Rhodes는 주변 지도 표기를 참고한 후보로, 개별 지점 거리 계산과 구분한다.

## 페이지 구성

| 순서 | 제목·내용 | 확인 수준 |
| --- | --- | --- |
| 상단 | 콘텐츠 미리보기 안내, Kitchen Cabinet Painting in Ermington, 10km 지역 소개, 비활성 Free Quote | 지역 반경은 사용자 지정, 서비스 문구는 초안 |
| 빠른 이동 | Services / Suitable cabinets / Included scope / Process / Service area / Examples / FAQs / Quote status | 실제 페이지 안의 8개 섹션 링크 |
| 서비스 | 기존 6개 카테고리, 각 작업이 해결하는 문제·대상·포함 후보·조건 | Draft scope 표시 |
| 재질·상태 | 기존 목재/도장면, laminate/melamine 등 확인 항목; 손상은 별도 판단 | 회사의 실제 취급 재질·코팅 시스템 미확정 |
| 포함·제외 | 준비·대상면·탈부착·하드웨어·내부면 등의 포함 후보와 별도 합의 항목 | 회사 확인 필요 표시 |
| 공정 | 평가 → 범위 합의 → 준비 → 도장 → 재조립·확인 초안 | 브랜드·도장 횟수·현장/외부 작업·기간 미확정 |
| 서비스 지역 | Google Maps에서 확인한 주변 suburb를 구역별로 소개 | 주소별 확인 조건, 경계 근처 별도 안내 |
| 사례 | 기존 생성 이미지와 예시 작업 설명 | Concept only. 실제 고객·작업 지역·전후 실적을 만들지 않음 |
| FAQ | 교체와 차이·적합성·포함면·가격 조건·기간/주방 사용·지역·견적 준비 상태 | 회사 정책 수치는 placeholder |

H1은 하나로 유지하고 서비스명 원문은 breadcrumb와 콘텐츠에 보존한다. H2는 독립적인 고객 질문, H3는 서비스·재질·단계 등 하위 항목에 사용한다. 지역명만 바꾼 중복 페이지·도메인·subdomain은 추가하지 않는다.

2026-09-27 추가 화면 피드백: `On this page`의 섹션 이동 항목을 모바일 18px·640px 이상 20px 및 semibold로 키우고, 항목 간격과 높이 48px 이상의 클릭 영역을 확보한다. 8개 링크는 화면 폭에 맞춰 줄바꿈하며 기존 앵커 이동을 유지한다.

## 임시 데이터 표시·교체 원칙

상단에 전체 콘텐츠 초안임을 설명하고 해당 섹션에 `Draft — company confirmation required` 등 상태를 보인다. 작업 범위·재질·공정은 구체적인 **예시 초안**으로 쓰되 확정 서비스 약속으로 표시하지 않는다.

정확한 제품·현장 일수·양생 시간·기본 패키지·추가 작업 단가·회사 연락처 등은 `[Company to confirm: ...]` 형태로 구분한다. 사용자 요청은 임시 콘텐츠 작성 허용이며 허위 자격·보험·리뷰·실적·주소·실제 판매가격을 만들라는 뜻으로 해석하지 않는다.

교체 위치는 `src/modules/service-catalog/content/cabinet-painting-content.ts`, 지역 데이터는 같은 모듈의 별도 content 파일을 둘 수 있다. 메타데이터도 같은 콘텐츠 값을 조립해 수정을 한 곳에서 관리한다. 이미지는 `src/shared/config/assets.ts`를 유지한다.

필요 자료: 회사 제공 서비스 목록과 재질, 대상면·탈부착·보수 한도, 공정/코팅/색상, 작업일·양생/주방 이용 안내, 견적 기본범위·추가금 조건, 실제 사례와 사용 허락, 연락처·운영 도메인, 서비스 반경의 실제 중심점.

| 회사 자료 | 중앙 콘텐츠의 교체 위치 |
| --- | --- |
| 서비스 범위·각 설명 | `categories`, `introduction`, `scope` |
| 허용 재질·평가 방법 | `suitability`, 관련 `faqs` |
| 대상면·준비·탈부착·하드웨어·제외 범위 | `inclusions`, 관련 `categories`·`faqs` |
| 코팅·공정·현장/외부 작업·기간·양생 | `process`, 관련 `faqs` |
| 반경의 실제 중심점·주소별 범위 | `serviceArea`, 지역 관련 `faqs` |
| 패키지·추가금·변경 승인 기준 | 가격·추가 작업 관련 `faqs` |
| 실제 사례와 사진 사용 허락 | `examples`, `src/shared/config/assets.ts` |
| 연락처·견적 접수 상태 | `quoteStatus`, `closing`, 관련 `faqs` — 버튼 활성화는 별도 기능 구현 후 |
| 공개용 제목·설명 | `title`, `metadataDescription` — 도메인·공개 승인 후 preview/noindex 정책과 함께 검토 |

## SEO·기능 범위

title은 `Kitchen Cabinet Painting in Ermington | L&K Group — Preview`, description은 서비스·지역·작업 범위를 자연스럽게 요약한다. 제목과 본문에 동네 이름을 반복 나열하지 않고 지역 안내 섹션에서 한 번씩 묶어서 설명한다. `kitchen cabinet painting`, `cabinet repainting`, `kitchen cupboard painting`은 내용에 맞게 사용하며 검색량·순위 검증을 했다고 주장하지 않는다.

noindex meta와 X-Robots-Tag를 유지한다. 운영 canonical·sitemap·구조화 데이터는 회사 정보·도메인·공개 승인 전 추가하지 않는다. FAQ는 실제 질문에 답하는 본문으로 작성하며 검색결과 확장 표시를 보장하지 않는다.

Free Quote는 계속 비활성이다. 사진 업로드·AI 분석·정찰제·예약·인보이스·결제는 구현하지 않는다. 새 지도 SDK·외부 API·클라우드 계정·유료 리소스도 추가하지 않는다.

## 근거

- [Google Maps Ermington](https://www.google.com/maps/search/Ermington%2C%20Sydney%2C%20City%20of%20Parramatta%20Council%2C%20New%20South%20Wales%2C%202115%2C%20Australia): 브라우저에서 실제 검색·주변 지도 확인, 2026-09-27.
- [Google SEO 기본 가이드](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), [제목](https://developers.google.com/search/docs/appearance/title-link), [검색 설명](https://developers.google.com/search/docs/appearance/snippet): 고객에게 도움이 되는 고유 본문·명확한 제목·설명 기준.
- [Dulux 제조사 Cabinet Doors 프로젝트 가이드](https://assets.ctfassets.net/j001bqnk84dk/3usIMHGIR7z9QS1koV6anY/b29cdf7cec7d249fe45defe5ab16a619/Renovation_Range_Project_Guides_-_Cabinet_Doors.pdf): 목재·laminate·melamine의 제품별 준비·코팅 적합성 참고. L&K가 이 제품을 사용한다거나 모든 표면을 시공한다는 근거가 아님.

## 검증 기준

lint·타입·production build, HTTP 서버 본문·title·noindex, 1440·768·390·320px 레이아웃, 모든 빠른 이동 링크와 FAQ 키보드, 모바일 메뉴·홈 왕복, 이미지 로딩·콘솔, 임시 데이터 라벨·허위 실적 부재를 점검한다. 실제 브라우저 결과와 문서/지도 조사는 별도 기록한다. 이전 프로토타입의 통과 기록으로 이번 변경 검증을 대체하지 않는다.

기존 클라이언트 제안서·Word·보관 패키지는 과거 15km 가정을 포함한 이전 전달본이다. 이번 범위에서는 재발행하지 않으며, 다시 전달하기 전에 최신 KCP 10km 기준과 회사 확인 결과로 갱신해야 한다. 다른 서비스 범위는 KCP 반경으로 자동 변경하지 않는다.
