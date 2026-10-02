# 승인 시안 적용·스크롤 스토리텔링 구현 계획

2026-09-28 · 계획 v2 · KCP 상세의 로컬 구현 및 기록된 범위의 QA 완료. 최종 결과와 미수행 검사는 [검증 기록](../verification/2026-09-28-scroll-storytelling.md)을 따른다.

**최종 사용자 정정 — v1과 앞선 해석보다 우선:** 메인 홈페이지는 기존 프로토타입으로 유지하고 **Kitchen Cabinet Painting 상세 페이지를 변경**한다. `KITCHEN. RENEWED.` 사진형 Hero와 7단계 전체를 KCP 상세에 적용한다. 공정은 Hero/목차 바로 다음으로 옮기고 전체 화면 사진·스크롤 설명·공정 주석·더 강한 분해/조립 연출로 확장한다. [추가 구현 명세](22-cinematic-cabinet-story.md)가 아래 v1의 메인 Hero·teaser 계획을 대체한다.

사용자는 [v5 시안](../design-concepts/concept-1-slate-greige-v5.png)의 디자인 적용을 요청했다. 이어서 배치를 **메인은 짧은 소개, Cabinet 상세에 7단계 전체**로 명시했다. 그 후 상단의 최종 정정으로 메인 새 디자인은 제외하고 KCP 상세만 변경했다. 세부 공통 값은 [글로벌 디자인 시스템](21-global-design-system.md)이 단일 기준이다.

## 1. 확정된 방향과 이번 범위

| 구분 | 적용 방향 |
| --- | --- |
| 메인 `/` | 기존 서비스·회사·갤러리·연락 중심 프로토타입 구성 유지, KCP 상세 링크 유지 |
| KCP `/services/cabinet-painting` | 사진형 Hero와 7단계 전체 화면 스크롤 스토리, 기존 SEO 본문과 목차 유지 |
| 공통 디자인 | 색상·폰트·size·weight·행간·간격·버튼·focus·모션을 중앙 토큰으로 관리 |
| 다른 서비스 | 동일 공용 컴포넌트와 데이터 형식을 후속 Painting/Handyman에 재사용; 이번에 상세 페이지를 새로 만들지 않음 |
| 견적·예약 | Free Quote 비활성 및 준비 안내 유지. 실제 전화·이메일 문의는 기존대로 연결 |
| 외부 서비스 | DB·AI·업로드·예약·인보이스·결제·배포·클라우드 계정 연결은 별도 범위 |
| 검색 공개 | 현재 noindex 유지. 회사 도메인·공개 승인 뒤 공개 SEO 단계 진행 |

기존 온라인 기능 계획을 삭제하지 않고 [18번 문서](18-kcp-page-prototype.md)에 후속 범위로 유지한다. 레퍼런스의 문의 폼·Calendly·가격·가상 후기는 L&K 기능이나 회사 사실로 가져오지 않는다.

## 2. 레퍼런스에서 확인한 것과 적용 방식

사용자 제공 [Nomadium 사례 페이지](https://nomadium.co.uk/lab/sales-page/)와 삽입된 24초 시연 영상을 브라우저에서 확인했다. 페이지는 하나의 건축 그림을 기초·골조·벽·지붕 등 레이어로 나누고 읽는 단계와 결합한다고 설명한다. 실제 대상 제품의 전체 소스·인터랙티브 사이트를 검사한 것은 아니다. 페이지의 전환율·문의 성과 주장도 L&K의 예상 성과로 인용하지 않는다.

채택할 원리는 **장면이 머무는 동안 설명이 자연스럽게 내려가고, 스크롤 위치에 따라 작업 상태가 변하는 방식**이다. 디자인은 승인한 L&K 사진·색·서체 규칙을 사용한다.

| 구현안 | 장점 / 제약 | 선택 |
| --- | --- | --- |
| 정적 사진 + 단계별 교차 전환 | 빠르고 가볍지만 문짝 분해·도장 변화의 연속성이 약함 | 초기 검증과 fallback |
| 사진 + 분리된 2D 레이어 + 단계 진행률 | 기존 사진 느낌으로 분해·재조립·도장 reveal 표현 가능. 같은 좌표의 자산 준비 필요 | **데스크톱 목표 방식** |
| 실제 3D/WebGL 또는 긴 영상 frame sequence | 카메라·입체 표현이 자유롭지만 제작·전송·모바일 비용 증가 | 현재 범위에서 선택하지 않음 |

2D 레이어가 준비되지 않았을 때 교차 전환만 구현한 결과를 최종 분해·조립 연출 완료로 표시하지 않는다. 먼저 대표 3장면(기존→탈거→재조립)의 자산 정합성과 모션을 검증하고 전체를 확장한다.

## 3. 페이지 구성과 SEO 제목 소유권

### 메인

기존 헤더·서비스 카드·회사 소개·실제 작업 사진·연락·Footer의 프로토타입 구성을 유지한다. H1은 기존 ServicesSection이 소유한다. 사진형 Hero나 새 teaser를 메인에 넣지 않는다. 기존 home/services/about/gallery/contact 앵커와 KCP 상세 링크를 유지한다. 공용 토큰·폰트·UI는 함께 재사용한다.

### KCP

1. 사진형 Hero: Breadcrumb, KITCHEN. RENEWED.와 보이는 서비스/지역 설명을 묶은 H1, 짧은 소개·실제 연락/공정 링크·비활성 Free Quote.
2. 기존 SEO 소개·범위 본문과 preview 안내. 긴 본문은 첫 화면 아래에 보존한다.
3. 기존 8개 On this page 링크. 18/20px와 충분한 클릭 영역 유지.
4. Process: 공정 H2 + 7개 서버 H3 단계 + 전체 화면 스크롤 장면.
5. Services 6개, Suitable cabinets, Included scope, Service area, Examples, FAQ, Quote status.

기존 8개 ID를 유지한다. 공정 하위에는 existing/remove/prepare/undercoat/finish/reassemble/complete 앵커가 있다. Skip은 실제 다음 섹션인 Services로 간다. KCP Hero는 완성 컨셉 사진이고, 스크롤 공정의 첫 장면은 요청대로 오래된 캐비넷이다.

## 4. 7단계 스토리보드

단계 제목·설명은 모두 실제 HTML이다. 아래 문구는 콘텐츠 초안이며 실제 공정 약속과 자산의 연속성을 검토하며 조정한다.

| 단계 / 앵커 suffix | 장면과 움직임 | 읽는 설명의 핵심 | 자산 |
| --- | --- | --- | --- |
| 01 Existing / existing | 같은 주방의 사용감 있는 기존 도장. 처음에는 정지된 전체 구도 | 기존 캐비넷의 재질·상태 평가와 작업 범위 확인 | before poster, 동일 주방 master |
| 02 Remove / remove | 선택한 7개 도어/서랍 사진 영역 분리. 손잡이는 사진에 포함되며 힌지 독립 연출은 미완료 | 탈거·라벨링·보호, 합의한 부품의 정리 | clean plate와 원본 사진 clip-path |
| 03 Prepare / prepare | 같은 문짝 형태가 작업장 close-up으로 연결. 샌딩·patch 영역이 순서대로 드러남 | 세척·표면 준비·필요한 부분 보수 | workshop master, sanding/patch 상태 |
| 04 Undercoat / undercoat | 같은 문짝·카메라에서 기초 도장 면이 부드럽게 채워짐 | 표면에 맞는 primer/undercoat 체계 | undercoat 상태·reveal mask |
| 05 Finish / finish | 선택 색상의 1차→2차 finish 상태. **같은 5번 단계 내부의 두 구간** | 원하는 색상·광택, 요청한 2회 마감 설명 | coat-1 / coat-2 상태, 동일 panel geometry |
| 06 Reassemble / reassemble | 원래 주방 구도로 복귀. 선택한 도어/서랍 사진이 제자리로 이동 | 적절한 건조 상태에서 재설치·맞춤·작동 확인 | 완성 배경·원본 사진 clip-path |
| 07 Complete / complete | 01과 같은 구조·카메라의 완성 주방. 장면이 멈추고 다음 내용으로 자연스럽게 이동 | 기존 구조 유지, 마감·관리 안내, 실제 문의 링크 | finished poster, Hero와 일관된 finish |

장면 5의 “원하는 색상”은 서비스 설명이다. 색상 선택기·실시간 도료 미리보기 기능을 추가한다는 뜻은 아니다. 최초 시각 예시는 승인 시안의 회청색 한 가지로 구성한다.

**공정 사실의 구분:** 사용자가 요청한 undercoat·finish 2회·철물 탈거 순서는 시안과 설명의 목표다. 회사 자료에서 확인된 것은 문짝 탈거·별도 부스 분사/건조·Dulux Aqua Enamel·일반적인 3–7일·재설치 후 7일 조심스러운 사용이다. 모든 재질에서의 정확한 도장 횟수·제품 세부 시스템·재도장 간격·모든 힌지 탈거·고정 프레임 처리 방식은 아직 회사 확인이 필요하다. 설명에는 “shown process; preparation and coating system confirmed for your cabinets”처럼 조건을 남기고 기본가 포함·보편적 시공 보장으로 확대하지 않는다. 건조와 완전 경화 시점을 같은 뜻으로 쓰지 않는다.

## 5. 이미지·레이어 제작 계획

현재 승인 이미지에는 로고·문구·버튼이 포함돼 있다. **글자 없는 Hero/주방 master 제작이 선행 작업**이다. 실제 회사 자료에는 준비·탈거·부스 사진이 있지만 같은 현장의 7단계 before/after가 없으므로 아래처럼 분리한다.

- 스토리: 동일한 가상 주방의 일관된 설명용 컨셉 시퀀스. 전체에 “Illustrative process — concept imagery, not a completed L&K project” 표시.
- 회사 작업 사진: 기존 실제 사진 갤러리/보조 자료로 표시. 컨셉 주방의 실제 작업 기록처럼 이어 붙이지 않는다.
- 실제 동종 현장 자료가 들어오면 장면 asset 참조와 출처·caption을 교체하고 동일 현장 여부를 확인한다.

필요 산출물은 UI 없는 Hero 1개, 7단계용 정적 poster 7개, 5번의 두 번째 coat 상태 1개, 탈거/재조립 레이어, 준비·도장 reveal 자산이다. master/완성 사진은 역할이 겹치면 파일을 공유한다. 처음부터 모든 고해상도 자산을 대량 생성하지 않고 master와 대표 장면을 검수한 뒤 확장한다.

연속성 기준: 문짝 수·패널 모양·손잡이/힌지 위치·창·출입구·아일랜드·카메라 높이·렌즈·광원 고정. 작업장 장면도 같은 문짝의 패널·구멍 위치를 유지한다. 마감 전후에 주방 구조가 바뀌면 재제작한다.

분리 레이어는 공통 canvas 크기와 투명 alpha, 원점·크롭·좌표계를 공유한다. 각기 다른 생성 이미지를 단순 겹치면 경계가 어긋나므로 asset QA에서 등록 좌표를 확인한다. base/layer를 같은 wrapper에서 동일 비율로 scale하고 독립적인 object-fit을 적용하지 않는다. 모바일에는 정적인 합성 poster와 별도 focal point를 사용한다.

생성은 내장 image_gen, 편집 대상과 스타일 참조를 구분한다. 원본 master·프롬프트·파생 파일을 기록하고 웹용 포맷/크기는 별도 파이프라인에서 최적화한다. 기존 자산 파일을 임의 덮어쓰지 않는다. `src/shared/config/assets.ts`에서 src·width·height·alt·provenance·caption·focal point를 중앙 관리한다. 기존 `provenance` 출처는 유지하고, 새 `kind`가 필요하면 poster/layer 같은 표현 유형만 나타내게 한다. 생성/회사 제공/변환 여부를 표현 유형으로 대체하지 않는다.

## 6. 스크롤·접근성 동작 명세

### 데스크톱 기본 목표

- 첫 버전 활성화 기준: 폭 1024px 이상이며 충분한 세로 공간(약 700px 이상), reduced-motion 꺼짐. 기준은 실제 텍스트·화면 QA로 조정한다.
- 공정 구간 안에서만 stage를 sticky로 유지한다. 문서 스크롤 자체는 브라우저 기본 동작이며 마지막 단계 뒤에 즉시 일반 페이지가 이어진다.
- 각 설명은 자연스러운 문서 흐름의 순서 있는 목록이다. 장면별 높이는 초기 80–110svh 범위를 검토하되 글이 길면 늘어난다. 빈 공간을 수십 화면 만들어 시간을 강제하지 않는다.
- 공정 상단에 01–07 링크와 “Skip the process” → `#cabinet-service-area`. 모션이 활성화된 환경에는 “View steps without animation” 토글을 제공해 같은 콘텐츠를 정적으로 읽을 수 있게 한다. 이 선택은 페이지 상태로 관리하고 새 추적/계정을 요구하지 않는다.
- 단계 전환은 IntersectionObserver로 결정하고, 분해·조립·reveal은 해당 단계의 local progress 0–1로 연결한다. IO만으로 세밀한 scrub가 된다고 가정하지 않는다.
- passive scroll + requestAnimationFrame으로 story가 화면에 있는 동안 필요한 진행률만 갱신하고 CSS custom property에 반영한다. 스크롤 매 프레임 React 전체 트리를 다시 렌더링하지 않는다.
- 주요 속성은 opacity·transform, 필요한 부분에만 clip/mask. 큰 blur·filter·무한 애니메이션은 피한다.
- 빠른 스크롤·역방향·중간 앵커 진입에서도 현재 문서 위치에서 상태를 계산한다. 이전 애니메이션 완료 이벤트에 의존하지 않는다.

### 모바일·키보드·실패 시

- 작은 화면과 reduced-motion은 **7개의 정적 사진 + 단계별 본문**이 자연스럽게 이어지는 형태가 기본이다. 긴 sticky/pin이나 분해 scrub를 요구하지 않는다.
- JS 비활성/로딩 실패도 서버가 렌더링한 단계·poster·링크가 보인다. JS가 성공적으로 준비됐을 때만 enhanced class를 추가한다.
- 데스크톱 static/enhanced는 가능한 한 같은 단계 좌표·높이를 사용한다. 늦은 hydration·폰트 로딩·resize·정적 보기 토글로 레이아웃이 달라지는 경우 현재 읽는 단계의 viewport 상대 위치를 보존하고, 레이아웃 확정 뒤 진행률을 다시 측정한다. 직접 hash 진입을 초기화 코드가 첫 장면으로 되돌리지 않는다.
- 이미지 로딩 중 직전 시각을 잠시 유지할 때는 로딩 상태임을 구분하고 새 단계의 완성 화면으로 표시하지 않는다. 실패하면 **해당 단계의 정적 poster 또는 중립 placeholder**로 전환한다. 다른 공정 사진과 새 설명을 잘못 짝짓지 않으며 설명·다음 단계 이동은 유지한다.
- 포커스를 자동으로 옮기거나 스크롤마다 aria-live로 읽지 않는다. 단계 링크의 현재 상태는 조용히 `aria-current`로 표시할 수 있다.
- 중복된 장식 stage는 `aria-hidden`, semantic 본문은 한 번만 읽히게 한다. 정보는 색·장면만으로 전달하지 않는다.
- native 앵커는 JS 없이 동작하고, 스크롤 중 hash를 계속 바꿔 history를 오염시키지 않는다.
- 200% 확대·가로 화면·짧은 창에서는 정적 흐름으로 전환 가능해야 한다. sticky가 텍스트·키보드 포커스를 가리지 않는다.
- reduced-motion 변경을 실행 중에도 반영하고 observer/listener/RAF를 cleanup한다. [MDN 안내](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)

초기에는 기존 Next/React/CSS와 작은 controller로 구현한다. GSAP·Lenis·Three.js를 먼저 설치하지 않는다. 대표 장면 spike에서 native 방식이 필요한 연속성을 충족하지 못하면 GSAP ScrollTrigger 등의 대안을 제작비·의존성·번들·QA 영향과 함께 다시 비교한다. 어떤 라이브러리를 쓰든 서버 본문과 static fallback 계약은 동일하다.

## 7. 재사용 아키텍처

```text
src/app/
  page.tsx                           # 홈 모듈 조립·metadata
  services/cabinet-painting/page.tsx  # KCP 모듈 조립·metadata
  globals.css / layout.tsx           # 전역 토큰·폰트 연결
src/shared/
  styles/tokens.css                  # 디자인 단일 원본
  config/fonts.ts / assets.ts        # 폰트·중앙 자산
  ui/service-story/
    index.ts                         # 공개 UI 진입점
    service-story.tsx                # Server: H2/ol/li/H3/figure
    story-motion.tsx                 # Client: stage·관찰·진행률
    story-types.ts                   # UI 계약, 업무 정책 없음
    service-story.css                # static/enhanced/reduced 스타일
src/modules/company-profile/
  presentation/home-hero.tsx
src/modules/service-catalog/
  content/cabinet-story-content.ts
  presentation/cabinet-teaser.tsx
  presentation/cabinet-process-story.tsx
  index.ts                           # 공개 export
```

기존 company-content·cabinet-painting-content·assets 중앙 구조를 사용한다. 공용 UI에서 companyContent를 직접 import하거나 `cabinet`라는 조건문으로 업무를 분기하지 않는다. 현재 실제로 필요한 계층만 추가하고 단순 소개에 Entity·Repository·DB·이벤트 버스를 만들지 않는다.

설계용 계약 예시이며 아직 구현된 API가 아니다:

```ts
type StoryScene = {
  id: string;
  title: string;
  paragraphs: readonly string[];
  poster: AssetRef;
  visual?: {
    preset: "crossfade" | "separate" | "reveal" | "assemble";
    layers?: readonly RegisteredLayer[];
    states?: readonly AssetRef[]; // 예: coat 1 / coat 2
  };
};

type ServiceStoryProps = {
  id: string;
  title: string;
  introduction: string;
  scenes: readonly StoryScene[];
  conceptNotice?: string;
  skipHref: string;
};
```

AssetRef는 src/크기/alt/caption/provenance와 필요 시 표현용 kind를 가진 공유 UI용 자산 참조다. RegisteredLayer에는 공유 canvas 기준의 위치·asset·허용된 이동 preset 정보를 둔다. 임의 실행 함수·서비스별 JS 코드를 콘텐츠 데이터에 넣지 않는다. Server가 본문을 렌더링하고 Client에는 직렬화 가능한 visual/ID 정보만 전달한다.

공용 renderer는 7이라는 수를 하드코딩하지 않는다. Painting의 보호→준비→도장→마무리, Handyman의 확인→수리→작동 점검처럼 **회사 확인을 거친 실제 콘텐츠 배열**을 연결할 수 있다. 이는 재사용 예시이며 새 업무 프로세스의 승인 사실이 아니다. 홈 teaser는 전체 story controller를 로드하지 않고 필요한 대표 자산/요약만 소비한다.

브랜드를 넘어 다른 프로젝트에 가져갈 경우 `shared/styles`, `shared/ui/service-story`, 자산 타입/어댑터가 재사용 단위다. 회사 연락처·가격·출처·지역 데이터는 같이 복사하는 공통 기본값으로 만들지 않는다. 지금 별도 npm 패키지·CMS·다중 브랜드 관리 도구는 만들지 않는다.

## 8. SEO 보존 계약

- 모든 7단계 제목·본문·서비스·지역·FAQ는 초기 서버 HTML에 존재한다. 단계가 활성화된 뒤에만 본문을 fetch하거나 한 단계만 DOM에 마운트하지 않는다.
- 시각 stage는 향상 기능이고, 본문을 canvas·동영상·이미지 속 글자로 대체하지 않는다. Google은 스크롤·클릭 상호작용을 전제로 콘텐츠를 탐색하지 않으므로 문서 내용은 처음부터 제공한다. [Google lazy-loaded 콘텐츠 안내](https://developers.google.com/search/docs/crawling-indexing/javascript/lazy-loading)
- 기존 title/description·유효한 연락 링크·고유 H1·H2/H3·breadcrumb·8개 앵커·21개 회사 지역 목록의 의미를 보존한다. 정확한 H1 소유권 변경은 3절 기준으로 확인한다.
- 지역명만 바꾼 새 URL·도메인을 만들지 않는다. 이미지 alt는 장면을 설명하고 지역 키워드를 반복하지 않는다.
- 생성 컨셉은 실제 사례/고객 후기/전후 증거처럼 표시하지 않는다. 기존 실제 작업사진의 출처도 유지한다.
- 주요 Hero는 일반 img/Next Image로 주소·크기·반응형 sizes가 존재하도록 하고, 눈에 바로 보이는 LCP 이미지를 lazy 처리하지 않는다.
- 현재 meta robots·X-Robots-Tag noindex 정책을 유지한다. 공개 단계에서만 운영 도메인 기반 canonical·sitemap·구조화 데이터·Search Console을 별도 검증한다. 이번 디자인 완료를 검색 노출 완료로 표현하지 않는다.
- 결과를 순위 보장으로 설명하지 않는다. 나중에 실제 검색 노출·클릭·색인과 사용자 성능 지표를 관찰한다.

## 9. 성능 예산과 자산 로딩

아래는 **개발 목표치**이며 아직 측정 결과가 아니다.

| 항목 | 초기 예산/검수 |
| --- | --- |
| Hero 사진 | 실제 내려받는 크기 데스크톱 약 450KB 이하, 모바일 약 250KB 이하 목표 |
| 최초 화면 | 전체7 장면/layer를 preload하지 않음. Hero 1개 우선, 공정은 접근 시 준비 |
| 공정 시각 자산 전체 | 데스크톱 약 3MB, 모바일 poster 세트 약 1.5MB 이내 목표 |
| 폰트 | 영문용 로컬 WOFF2와 최소 필요한 파일, 약 100KB 이내 목표 |
| 모션 JS 증가량 | 대형 패키지 없는 controller 기준 gzip 20KB 이내 목표 |
| LCP / CLS / 응답성 | LCP 2.5초, CLS 0.1, INP 200ms를 성능 목표로 삼되 로컬·실사용 지표 구분 |

이미지는 AVIF/WebP 등 실제 호환성과 화질을 비교하고 width/height 또는 aspect-ratio를 확보한다. stage에는 현재/다음 필요한 자산만 준비하며, poster와 layer의 중복 요청·7개 overlapping img의 동시 다운로드를 Network에서 확인한다. 뒤로 스크롤할 때도 이미지 재사용이 되도록 한다. 필요 범위 밖에서 RAF를 계속 돌리지 않는다.

모바일 정적 경로에서는 데스크톱 layer 자산을 받지 않는 것을 목표로 한다. 클라이언트 설정이 없어도 서버 poster는 읽을 수 있어야 한다. 첫 요청·실제 전송량·decode·메모리·긴 작업은 브라우저로 확인하고 예산 초과 시 먼저 자산 크기와 레이어 수를 줄인다. 예산을 맞추기 위해 본문을 지우거나 실제 기능을 숨기지 않는다.

## 10. 단계별 구현·검수 단위

계획·디자인·판정·코드·테스트 작성의 모델과 effort는 [개발 운영](13-ai-development-workflow.md)의 사용자 선택·에이전트 상속 원칙을 따른다. Sol 모델을 명시할 때는 `gpt-6.1-sol`을 사용한다.

| 단계 | 실제 작업 | 완료 판정 |
| --- | --- | --- |
| 0. 현재 계획 | 토큰·페이지 범위·스토리보드·자산·SEO·QA 계약 작성 | 이번 문서 산출. 코드 적용과 구분 |
| 1. 기반 | 구현 시 기존 작업 상태 확인 후 기능 브랜치, 폰트·tokens·공용 UI 연결 | 홈/KCP 기존 동작 유지, 임의 색·타입 중복 정리 |
| 2. KCP Hero | UI 없는 Hero 자산·HTML 제목·반응형, 메인 프로토타입 유지 | 승인 시안 비교, 작은 화면·H1·실제 CTA 확인 |
| 3. 자산 spike | 같은 주방 master와 01/02/06 대표 layer 제작 | 구도·문짝/철물 수·alpha·정합성 확인 |
| 4. KCP 정적 구성 | 기존 process를 7단계 semantic 본문/poster로 확장 | JS 없어도 전체 내용·앵커 정상 |
| 5. 스크롤 연출 | 대표 분해/재조립 검증 후 03/04/05/07 추가, 재사용 controller | 순방향·역방향·건너뛰기·fallback 정상 |
| 6. 전체 QA | 코드 검사·실제 브라우저·SEO·성능·회귀 | 기록된 합격 기준 충족, 실패는 수정 후 재검증 |

최초 계획의 구현 시작용 브랜치 이름은 `codex/scroll-storytelling-design`을 제안한다. v1 계획 작성 시에는 만들지 않았고, 이후 구현은 해당 브랜치에서 진행했다. 이번 구현의 커밋·push는 하지 않았다. 기존 docs/design-concepts 미커밋 자산은 보존한다. 외부 계정 승인을 기다리는 것은 로컬 디자인 구현의 선행 조건이 아니다.

## 11. 테스트 설계와 인수 조건

- **코드:** npm run check(lint·typecheck·production build). 단순 문구를 그대로 비교하는 테스트는 만들지 않는다.
- **핵심 자동 검증:** 서버 응답에 H1 1개/7개 단계/기존 SEO 섹션·noindex가 존재, 단계 anchor·skip 이동, reduced-motion/static fallback. 구현된 progress 계산이 복잡해질 경우 경계 0/1·역방향·anchor 점프를 의미 있게 검사한다.
- **화면:** 1440×900, 1024×768, 768×1024, 390×844, 320×640 및 짧은 가로 화면·200% 확대. 메뉴·문구·버튼·사진 크롭·레이어 정합성 확인.
- **동작:** 마우스 wheel·트랙패드·터치·키보드 PageDown/Space/Tab, 단계 앵커 직접 URL·새로고침·뒤로 가기, fast scroll·역방향·창 크기 변경.
- **fallback:** JS 없음, reduced-motion, 모션 끄기, 이미지 실패·느린 네트워크, 폰트 실패. 어떤 경우에도 7단계 내용과 연락 경로가 남는다.
- **접근성:** skip link·메뉴 Escape·가시 포커스·semantic 순서·본문 대비·장식 중복 읽기·자동 focus/aria-live 부재.
- **성능:** 실제 이미지 요청/초기 전송량·Hero LCP·CLS·메모리/긴 작업·story 밖 RAF 중단. Lighthouse 실험실 결과와 공개 후 실제 Core Web Vitals를 구분한다.
- **콘텐츠:** 문짝·하드웨어·주방 구조 연속성, 생성/실제 구분, 제품/코트 조건, 기간·보증·가격의 미확정 확대 없음.
- **회귀:** Home→KCP→Home, 8개 기존 목차, FAQ, 실제 tel/mail 링크 주소, Free Quote 비활성, 콘솔·이미지 404·hydration 오류.
- 미수행 브라우저/플랫폼 검사는 별도 남긴다. 이전 QA 결과를 이번 새 디자인의 통과 증거로 쓰지 않는다.

## 12. 선행 자료·남은 판단

1. **이미지 제작 의존성:** UI 없는 Hero와 동일 주방의 7장면/레이어가 필요하다. 현재 9개 WebP와 원본/프롬프트가 준비됐다. 독립 손잡이·힌지 레이어는 남았다.
2. **폰트 파일:** Manrope 공식 Latin variable 파일·400–800 weight·OFL 라이선스를 확인하고 로컬 추가했다.
3. **회사 공정 세부:** undercoat 체계·2회 마감·철물 탈거·프레임 작업은 상세 확인 전 조건부 설명으로 작성한다. 확인 대기 때문에 공용 UI·정적 구조·컨셉 제작 전체를 멈추지 않는다.
4. **공개:** 운영 도메인·계정 권한·배포 승인은 기존 대기 항목. 신규 온라인 견적/결제 개발 승인을 이번 디자인 요청으로 확대하지 않는다.
5. **새 기능/비용:** 모바일 full pin, 실제 3D, 색상 선택기, 동영상 제작, 외부 모션/유료 자산 서비스가 필요해지면 영향·대안을 먼저 정리한다.

## 13. 확인 출처와 이번 완료 수준

- 디자인 원본: [v5 시안과 팔레트 기록](../design-concepts/concept-1-slate-greige-v5.md).
- 회사 운영 사실: [회사 제공 자료](../reference-assets/company-brief.md).
- 기존 상세·SEO: [18](18-kcp-page-prototype.md), [19](19-kcp-seo-content-and-service-area.md).
- 참고 동작: [Nomadium 사례/시연](https://nomadium.co.uk/lab/sales-page/), 브라우저에서 확인. 자동 텍스트 도구 접근 실패 후 실제 브라우저로 확인했다.
- 기술 근거: [Next.js 폰트](https://nextjs.org/docs/app/getting-started/fonts), [Tailwind theme](https://tailwindcss.com/docs/theme), [IntersectionObserver](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API), [reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion), [Google lazy-loaded 콘텐츠](https://developers.google.com/search/docs/crawling-indexing/javascript/lazy-loading). 2026-09-28 확인.

v1 이후 전역 토큰·폰트·사진·7단계 구현을 진행했고, 최종 정정에 맞춰 메인은 프로토타입으로 복원했다. KCP 상세의 사진형 Hero·전체 화면 공정·기존 SEO 본문을 적용했다. 최종 lint·타입·production build가 통과했으며, 실제 브라우저 결과·발견/수정한 오류·미수행 성능/기기 검사는 [검증 기록](../verification/2026-09-28-scroll-storytelling.md)에 구분했다.
