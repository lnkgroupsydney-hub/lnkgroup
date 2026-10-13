# KCP 랜딩페이지 UI·UX·콘텐츠 재구성 계획

2026-10-13 · 설계 완료 / 구현 전

사용자 요청: 캐비넷 랜딩페이지의 긴 글을 줄이고 문단·여백·글꼴·크기를 정돈한다. 지역·로컬 SEO 상세는 메인 `/`에 모으며 KCP에는 짧은 안내만 남긴다. 별도 캐비넷 색상 변경 섹션을 삭제하고 모든 전환을 자연스럽게 만든다. **이번 산출물은 구현 계획과 현재 화면 기록이다. 앱 코드는 변경하지 않았다.**

## 1. 방향과 적용 범위

**사진으로 이해하고, 짧은 글로 판단하고, 필요한 조건만 펼쳐 읽는 페이지**로 바꾼다. 기존 사진형 Hero와 입체 공정 스토리는 유지하되, 서비스·공정·견적의 정보 우선순위를 분명히 한다.

- KCP: Hero → 서비스 3개 작업 영역 → 공정 → 컨셉 전후 비교 → 짧은 범위 안내 → FAQ → 견적 CTA.
- 홈: About 안의 기존 지역 정보를 독립 `#service-area` 섹션으로 정리한다. 기존 메인 프로토타입 전체를 새로 디자인하지 않는다.
- 삭제: 별도 색상·광택 쇼룸, 반복 소개 띠, 중복 Quality·교체 비교·Examples의 독립 섹션.
- 통합: 기존 여섯 서비스의 의미, 표면 적합성, 포함/제외·철물·추가 수리 조건은 간결한 서비스 소개·범위 안내·FAQ에 보존한다.
- 유지: 실제 견적 경로, 고객 사진의 비공개 처리, AI 잠정 견적·고객 제출·회사 확정의 현행 흐름. 인증·예약·가격 계산·회사 DB를 변경하는 작업은 포함하지 않는다.

이 계획은 [19번](19-kcp-seo-content-and-service-area.md)의 KCP 지역 전체 표시와 [21번](21-global-design-system.md)·[24번](24-cinematic-kitchen-webgl.md)의 대형 본문/쇼룸 구성을 해당 범위에서 대체한다. 이전 문서의 비활성 견적·로컬 전용 설명은 역사적 상태다. 견적의 현행 기준은 [45번](45-simple-take-off-install-booking.md)이다.

## 2. 현재 화면에서 확인한 문제

[운영 KCP](https://www.lnkgroupsydney.com.au/services/cabinet-painting)와 [홈](https://www.lnkgroupsydney.com.au/)을 실제 브라우저에서 확인했다. 스타일 값은 운영 화면의 계산값이며 로컬 미커밋 변경과 구분한다.

| 측정 | 데스크톱 1280×720 | 모바일 390×844 |
| --- | --- | --- |
| 문서 전체 높이 | 약 23,048px | 약 25,880px |
| 서비스 섹션 높이 | 약 2,292px | 약 3,032px |
| 서비스 H2 | 67.84px / 700 / 행간 71.91px | 40px / 700 / 행간 42.4px |
| 서비스 H3 | 38.88px / 700 / 행간 44.71px | 24.64px / 700 / 행간 28.34px |
| 서비스 소개 | 24px / 행간 36px | 18px / 행간 27px |
| 서비스 본문 | 18px / 행간 29.7px, 폭 약 816px | 한 열로 긴 설명이 이어짐 |

데스크톱 공정은 약 8,096px, 지역 안내는 약 1,217px이다. 현재 공정은 **9개 공정 + 완성 reveal = 10개 chapter**이며, 과거 7단계 구현과 다르다. 현재 main DOM의 공백 기준 텍스트는 약 2,743개 단위·문단 101개다. 이는 FAQ 답변과 UI 라벨을 포함한 참고 측정으로 순수 기사 단어 수나 SEO 기준이 아니다.

| Before | After | Why |
| --- | --- | --- |
| Hero 뒤에 소개·범위·미리보기 고지가 다시 나옴 | Hero 1~2문장과 필요한 이미지 고지로 압축 | 서비스를 이해하기 전에 같은 설명을 반복해서 읽게 됨 |
| 모든 H2가 대형이고 제목 폭이 16ch로 제한됨 | Hero·섹션·카드 제목을 서로 다른 크기로 구분 | 중요한 정보의 계층을 회복하고 불필요한 줄바꿈을 줄임 |
| 서비스의 프로젝트 종류 3개와 작업 영역 3개를 동급 긴 행으로 설명 | 작업 영역 3개 카드와 공통 프로젝트 종류 1문장 | 고객이 무엇을 맡길 수 있는지 바로 파악 가능 |
| 공정·Quality·적합성·포함 범위·FAQ에서 같은 조건 반복 | 공정 설명은 짧게, 상세 조건은 범위/FAQ 한곳에 모음 | 글을 작게 만들어 해결하지 않고 실제 읽을 양을 줄임 |
| 거대한 지역 숫자와 전체 목록이 KCP·홈에 중복 | 홈 지역 상세 1회, KCP 요약과 내부 링크 | 서비스 페이지의 집중도를 높이고 지역 정보의 관리 위치를 통일 |
| 모바일 첫 화면에 긴 설명과 CTA 3개 | 짧은 설명, 주요 견적 CTA, 보조 공정 링크 | 사용자가 다음 행동을 쉽게 결정 가능 |
| 운영 화면에 사진 업로드·가격 계산·예약이 없다는 과거 안내 | 현재 기능과 일치하는 짧은 견적 안내 | 실제 기능과 설명이 다르면 신뢰를 떨어뜨림 |

현재 캡처:

- [데스크톱 Hero](../design-reviews/2026-10-13-kcp-landing/current-desktop-hero.jpg)
- [데스크톱 서비스](../design-reviews/2026-10-13-kcp-landing/current-desktop-services.jpg)
- [데스크톱 공정 마지막 부분](../design-reviews/2026-10-13-kcp-landing/current-desktop-process.jpg)
- [모바일 Hero](../design-reviews/2026-10-13-kcp-landing/current-mobile-hero.jpg)
- [모바일 서비스](../design-reviews/2026-10-13-kcp-landing/current-mobile-services.jpg)

화면 관찰·코드 분석을 수행했다. 전체 모션의 프레임 분석·실제 휴대폰·접근성 적합성 시험·성능 측정은 구현 후 검증 항목이다.

## 3. 새 페이지 구성

| 순서 | 구성 | 내용과 배치 |
| --- | --- | --- |
| 1 | 사진형 Hero | 같은 주방 사진을 넓게 유지. H1에 서비스명, 보조 문구와 1문장 소개. 주요 `Request a quote`, 보조 `See the process`. 생성 이미지 고지는 사진 가까이에 배치 |
| 2 | What we paint | 데스크톱 3열 / 태블릿 2열 / 모바일 1열. Doors & drawer fronts, Frames & visible panels, Preparation & repairs. 카드마다 설명 25~35단어 정도 |
| 3 | The painting process | 현재 9개 공정과 완성 장면 유지. 각 단계는 제목 + 짧은 1문장. 공정 설명과 사진·3D의 시점 일치. Static view와 Skip 유지 |
| 4 | A possible transformation | 기존 전후 비교 유지. 짧은 설명과 생성 컨셉 고지. 별도 긴 Examples 설명은 이곳으로 통합 |
| 5 | Scope, made clear | 짧은 2열 안내: 평가·합의할 표면 / 별도 확인할 작업. 모바일은 순서대로 표시. 신규 제작·설치 제외와 손상 별도 평가는 접힘 없이 보임 |
| 6 | Questions, answered | 5개 FAQ. 네이티브 details/summary로 기본 접힘, 각 답변 약 40~65단어. 핵심 조건을 작은 글자로 숨기지 않음 |
| 7 | 견적 CTA | 짧은 마무리·견적 버튼·보조 연락 링크. 아래에 지역 요약 1문장과 홈 지역 링크 |

목차는 **Services / Process / Transformation / FAQs** 4개로 줄인다. 기존 사용자의 큰 카테고리 글자 선호를 유지하여 18~20px/600, 최소 48px 클릭 높이를 사용한다. 모바일은 2×2 배치로 모든 항목을 볼 수 있게 한다.

Hero 첫 화면에서 서비스명·핵심 설명·견적 버튼을 볼 수 있게 한다. 화면 높이가 부족하면 자연스럽게 늘어나며 고정 높이로 내용을 자르지 않는다. 서비스는 긴 공정 앞에 놓아 사용자가 긴 스크롤을 거치기 전에 맡길 수 있는 일을 판단할 수 있게 한다.

신뢰를 위한 정보는 짧고 확인 가능하게 배치한다. 서비스 소개에 회사 제공 사실인 `Separate spray booth`와 `Dulux Aqua Enamel`을 한 줄로 표시할 수 있다. 기존 회사명·ABN·painting licence·실제 연락처는 유지한다. 생성 컨셉은 실제 실적으로 표현하지 않으며, 실제 회사 준비·분사 사진을 보려면 홈 갤러리로 이동할 수 있게 한다. 새 후기·평점·자격 배지를 만들거나 설명을 다시 장문으로 늘리지 않는다.

### 영문 카피 초안

**Hero**

- H1: `Kitchen Cabinet Painting`
- 보조 문구: `A fresh finish for the kitchen you have.`
- 소개: `Refresh suitable doors, drawer fronts and visible panels while keeping your existing kitchen layout.`
- 견적 보조 안내: `Upload photos for an AI-assisted estimate. Booking dates are confirmed by our team.`

**서비스 공통 소개**

`Full repainting, partial refreshes, touch-ups and colour changes — planned around your existing cabinets.`

이 한 문장과 세 작업 영역을 통해 기존 여섯 서비스의 의미를 보존한다. 색상 변경 시뮬레이터의 삭제는 실제 재도장 서비스의 colour change·Finish 공정 삭제를 뜻하지 않는다.

**지역 요약**

`Serving Ermington, Inner West Sydney and surrounding suburbs. View our service area.`

`View our service area` → `/#service-area`. KCP에서는 suburb 전체 목록·반경 상세·지도·경계 장문을 제거한다.

**FAQ 5개**

1. Can my existing cabinets be painted? — 목재·기존 도장·laminate/melamine의 조건부 평가, 부풀음·박리·구조 문제, 교체가 필요한 경우.
2. Which surfaces and hardware are included? — 문/서랍/프레임, 뒷면·모서리·내부·kickboard, 손잡이 교체·힌지·새 구멍의 별도 합의.
3. How is the price assessed? — 사진 기반 잠정 예상, 실제 수량·상태·추가 준비/수리·현장 확인, 원본 예상과 별도 변경 조건.
4. How long does the work take? — 회사 안내의 일반 3~7일과 재설치 후 7일 조심스러운 사용, 건조와 완전 경화의 차이, 프로젝트별 일정·주방 접근.
5. How do I request a quote and booking? — 사진/예상 → take-off 날짜·시간/서명/제출 → 회사가 작업 기간을 확인하고 확정. 제출만으로 확정되는 것으로 설명하지 않음.

위 문구는 편집 초안이다. 기존 회사 자료와 현행 견적 화면의 의미를 대조해 최종 반영한다. 새 가격·시공 보장·후기·보험·일정을 만들어 넣지 않는다.

### 콘텐츠 편집 기준

- 기본 노출 설명은 약 600~800 영단어, FAQ·UI 문구 포함 전체는 약 1,000~1,400 단어를 초기 편집 목표로 삼는다. 현재 분량의 약 절반으로 줄이되 정확한 조건이 우선이다.
- 단어 수는 읽기 부담을 관리하는 목표이며 검색 순위 기준이 아니다. Google은 선호하는 단어 수가 있다고 설명하지 않는다. [Google people-first 콘텐츠 가이드](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- 한 문단은 한 주제, 보통 1~2문장. 각 섹션 소개는 2~3줄 이내를 목표로 실제 폭에서 확인한다.
- 확인 조건을 모든 카드에 반복하지 않고 공통 범위/FAQ에 모은다. 잠정 견적·추가 작업·포함 범위의 중요한 조건은 유지한다.
- 생성 사진은 `Generated concept — not a completed L&K project.` 등 짧은 고지를 해당 미디어 가까이에 유지한다. 실제 회사 작업 사진의 출처는 별도로 표시한다.
- 확인되지 않은 내부 메모 `[Company to confirm: ...]`는 고객용 조건부 설명으로 바꾸고, 미결 항목은 내부 TODO에 유지한다. 미확정 내용을 확정 사실로 바꾸지 않는다.

## 4. 타이포그래피와 글로벌 재사용

서체는 기존 로컬 **Manrope**를 유지한다. 밝은 그레이지/아이보리 배경, 슬레이트 글자, 기존 주방 사진의 목재·황동을 사용한다. 새 폰트·장식 색·복잡한 그림자를 추가하지 않는다.

공통 원본은 `src/shared/styles/tokens.css`다. KCP의 과대한 독자 크기를 의미별 공용 토큰에 연결한다. 전역 값의 일괄 변경으로 견적·EMS 화면까지 바꾸지 않는다.

| 역할 | 모바일 | 데스크톱 | 굵기 / 행간 |
| --- | --- | --- | --- |
| H1 / page-title | 36~44px | 56~72px | 700 / 1.08~1.12 |
| H2 / section-title | 28~32px | 40~48px | 700 / 1.15 |
| 공정 제목 / scene-title | 24~28px | 32~40px | 700 / 1.15 |
| 카드 제목 / card-title | 20~22px | 22~24px | 600~700 / 1.25 |
| 소개 / lead | 18px | 18~20px | 400 / 1.5 |
| 본문 / body | 16px | 17~18px | 400 / 1.6~1.65 |
| FAQ 질문·버튼 | 16~18px | 18px | 600~700 / 1.3~1.4 |
| 이미지 고지·캡션 | 14px | 14px | 400~500 / 1.5 |

px는 기본 글자 16px 기준 설계 범위다. 실제 구현은 rem/clamp와 자연 줄바꿈으로 확대 설정을 허용한다. H1의 의미와 시각 크기를 분리하며 서비스명은 실제 HTML로 제공한다.

- 본문 최대 폭: 55~65ch. 사진 위 설명: 38~48ch. 카드 본문은 해당 열 폭을 따른다.
- H2 최대 폭: 약 22~28ch. 일괄 16ch 제한과 불필요한 강제 줄바꿈을 제거한다.
- 제목 자간: 약 -0.02~-0.035em. 본문은 normal. 800은 필요한 Hero 강조에만 제한한다.
- 기본 색은 기존 `--site-background: #F1EFE9`, `--site-surface: #FAF8F3`, `--site-foreground: #2E3A3F`, `--site-muted: #465156`을 우선한다. KCP의 사진용 veil은 실제 크롭과 대비를 보며 조절한다.
- 모바일도 주방이 보이도록 사진 초점과 텍스트 폭을 조절한다. 읽기 대비를 위해 사진 전체를 무조건 진하게 덮는 방식은 피한다.

| 간격 | 모바일 | 데스크톱 |
| --- | --- | --- |
| 일반 섹션 상하 | 56~64px | 80~96px |
| 페이지 좌우 | 20px | 48~64px |
| 제목 → 설명 | 12~16px | 16px |
| 설명 → 카드/사진 | 24px | 24~32px |
| 문단 사이 | 12~16px | 12~16px |
| 카드 간격 | 20~24px | 24~32px |
| 카드 안쪽 | 20~24px | 24~32px |

70rem 본문 컨테이너와 88rem 넓은 시각 컨테이너를 재사용한다. 실제 반복 사용처가 생기는 경우에만 section spacing·gutter·copy measure의 의미 토큰을 추가한다. 서비스 카드·MediaFigure·SectionHeading·CTA는 필요한 수준의 공용 UI로 조립하며 빈 미래 모듈이나 새로운 디자인 라이브러리를 만들지 않는다.

## 5. 지역 SEO를 메인으로 모으는 방식

홈의 `AboutSection`은 이미 `companyContent.serviceArea`의 **3개 그룹·21개 suburb**를 서버 렌더링한다. 따라서 새로운 지역 글을 추가로 복제하지 않고 기존 블록을 추출한다.

1. `ServiceAreaSection`을 만들고 홈 About 다음에 배치한다.
2. `id="service-area"`, H2 `Our Sydney service area`와 간결한 설명을 부여한다.
3. 중앙 회사 데이터의 세 그룹·21개 suburb·주소 확인 안내를 그대로 재사용한다.
4. KCP의 Google Maps 링크와 필요한 경계 설명을 이곳으로 모은다. 회사 기준은 **Ermington 10km + Inner West 및 별도 명시 지역**이다. 전체 목록이 반경 안에 있다고 바꾸지 않는다.
5. About 안의 원래 지역 블록을 제거해 홈에서도 상세 목록은 한 번만 표시한다.
6. KCP에는 지역 요약과 `/#service-area` 링크만 남긴다. 기존 `#cabinet-service-area`는 짧은 요약의 ID로 유지할 수 있다.

KCP는 **서비스·방법·표면·견적을 찾는 의도**, 홈은 **회사·지역·다른 서비스 안내**를 중심으로 구성한다. 이 역할 분리가 검색 성과를 보장하거나 순위를 그대로 옮기는 기능이라는 뜻은 아니다.

- KCP title 초안: `Kitchen Cabinet Painting | L&K Group`. 과도한 suburb 나열 없이 고유 제목을 유지한다.
- description은 문/서랍/보이는 표면·공정·사진 기반 잠정 견적을 한 번 요약한다. 지역 문맥은 짧게 남길 수 있다.
- 서비스명·고유 H1·H2/H3·본문·FAQ·지역 요약은 최초 서버 HTML에 존재한다. 내용을 canvas·이미지 속 글자·클릭 후 fetch로 대체하지 않는다.
- FAQ 접기는 고객 편의를 위한 동작이며 SEO용 숨김 문단을 별도로 만들지 않는다. Google의 가이드는 탭·펼침 안의 유용한 정보도 본문에 포함한다. [공식 본문 가이드](https://developers.google.com/search/docs/fundamentals/creating-helpful-content#main-content)
- 기존 `/services/cabinet-painting` URL과 홈→KCP 링크는 유지한다. 지역 전용 중복 URL·도메인·리다이렉트는 필요하지 않다.
- 운영 브라우저에서 홈·KCP 모두 `noindex, nofollow`이며 canonical은 확인되지 않았다. 이번 UI 변경으로 색인을 자동 활성화하지 않는다. 검색 공개·canonical·sitemap·구조화 데이터·Search Console 검증은 별도 공개 단계에 기록한다.

## 6. 자연스러운 애니메이션 명세

**현재 9개 공정 + 완성 장면을 유지한다.** 단계 수를 줄여 엔진 의미를 다시 매핑하기보다 설명 길이·읽는 거리·카메라 이동량을 같이 다듬는다.

| Before | After | Why |
| --- | --- | --- |
| chapter마다 최소 100svh와 큰 상하 패딩 | 80~85svh를 초기 조정값으로 검토, 내용이 크면 높이 우선 | 긴 빈 공간을 줄이되 압축 때문에 글과 내비게이션이 겹치지 않게 함 |
| 첫 근접 장면에 큰 카메라 전후 이동 | 확대 강도를 낮추고 진입·복귀 구간을 넓힘 | 작업면의 패치·도장에 집중하고 빠른 스크롤의 급한 확대를 완화 |
| 불투명 canvas 아래의 poster만 페이드 | 준비된 첫 3D 프레임과 poster/canvas의 실제 교차 전환 | 아래 이미지를 흐려도 위 canvas가 즉시 덮는 구조를 해결 |
| 클릭 앵커와 최초 hash가 서로 다른 위치 기준 | 본문·장면·현재 단계가 같은 기준점을 사용 | 직접 진입·새로고침·클릭의 장면 불일치를 줄임 |
| 독자 .3s/.35s ease | 기존 160/240/420ms 모션 토큰과 공용 easing 사용 | 같은 페이지의 전환 속도와 성격을 통일 |

- 네이티브 문서 스크롤을 유지한다. 새 smooth-scroll 라이브러리·휠 가로채기·강제 pin·자동 재생은 추가하지 않는다.
- 스크롤 연동 장면은 동일 progress의 함수로 계산한다. 순/역방향과 빠른 왕복에서도 같은 문·철물·카메라·도장 상태가 나온다.
- chapter 높이를 줄이면 같은 픽셀 이동의 progress 변화가 커지므로 timeline의 이동량·전환 구간을 함께 조정한다. 숫자를 줄였다는 이유만으로 자연스러워졌다고 판정하지 않는다.
- 문 탈거·재조립의 절제된 공간 이동과 순차 움직임은 우선 보존한다. 바운스·과한 회전·장식 파티클을 더하지 않는다.
- Prepare는 기존 캐비넷의 손상 부위에 패치·샌딩이 드러나는 장면을 유지한다. 표면 준비 단계에서 캐비넷을 파랗게 바꾸지 않는다.
- Primer → Finish 두 코트의 설명용 변화 → Cure → Reassembly 순서를 유지한다. 별도 쇼룸 삭제와 구분한다. 실제 제품/도장 횟수는 프로젝트별 확인 조건을 유지한다.
- UI 상태 전환은 주로 opacity/transform으로 처리한다. 큰 blur·배경 전체 흔들림·무한 움직임·본문 단어별 등장을 추가하지 않는다.
- 전후 비교 드래그와 키보드 range는 즉시 반응한다. 입력에 지연 모션을 넣지 않는다.
- 모바일·짧은 창·200% 확대·reduced-motion은 정적 공정 이미지와 본문을 읽게 한다. 기존 1024px/700px 향상 기준의 경계 동작을 검증한다.
- 정적 전환·화면 크기 변경·모션 감소 변경·WebGL 실패 시 현재 읽던 단계의 위치와 정보·포커스를 유지한다. JS 없는 서버 본문도 읽을 수 있어야 한다.
- 화면 밖에서는 렌더를 멈추고 observer/listener/RAF와 GPU 자원을 정리한다. 실제 프레임·번들 측정 전 60fps·용량 절감 수치를 주장하지 않는다.

공용 모션의 기준값은 `--motion-fast:160ms`, `--motion-standard:240ms`, `--motion-scene:420ms`, `--ease-standard:cubic-bezier(0.2,0.65,0.3,1)`이다. 스크롤 scrub에 시간 기반 지연을 무조건 추가하는 값으로 사용하지 않는다.

## 7. 색상 변경 섹션의 삭제 범위

- `CabinetColourShowroom` 렌더·목차 Colours·`#cabinet-colours` 내부 링크 제거.
- showroom 전용 colours/sheens·custom colour·상태·IntersectionObserver·matchMedia·dynamic import 제거.
- `.kcp-showroom*`, `.kcp-colour*`, `.kcp-sheen*`, 관련 모바일 규칙 제거.
- BeforeAfter·공정 3D·Finish·여러 곳에서 쓰는 완성 사진은 유지한다. 공정이 Three.js를 계속 사용하므로 의존성 자체를 삭제하지 않는다.
- 쇼룸이 생성하던 두 번째 scene이 더 이상 초기화되지 않는지 확인한다. 공유 엔진 API 정리나 구형 7단계 경로 삭제는 별도 리팩터링으로 확대하지 않는다.
- 삭제한 색상 앵커를 무관한 콘텐츠로 몰래 연결하지 않는다. 유지되는 예전 앵커는 해당 의미의 콘텐츠가 통합된 위치에 연결하고 중복 ID를 만들지 않는다.

## 8. 파일·구현 순서와 소유 범위

현재 `codex/quote-one-page-ux-20261013`에는 견적 UI·주소·layout·KCP 콘텐츠 등 진행 중인 미커밋 변경이 있다. 구현 시작 시 최신 diff를 다시 확인하고 보존한다. 이 계획을 작성하면서 기존 파일을 되돌리거나 브랜치를 바꾸지 않았다.

| 단계 | 대상 | 할 일 |
| --- | --- | --- |
| P1 콘텐츠 | `cabinet-painting-content.ts`, `cabinet-hero.tsx` | 소개·서비스 3영역·범위·FAQ·견적 안내 초안 반영. 현행 기능과 회사 조건 대조 |
| P2 홈 지역 | `about-section.tsx`, 새 `service-area-section.tsx`, 회사 모듈 `index.ts`, `src/app/page.tsx` | 기존 지역 추출·H2/앵커·중앙 데이터/지도·경계 설명 재사용, 중복 제거 |
| P3 KCP 조립 | `cabinet-painting-detail.tsx`, `cabinet-interactives.tsx` | 순서/목차·반복 섹션 통합, showroom 제거, 비교·링크 유지 |
| P4 레이아웃 | `cabinet-cinematic.css`, 필요한 `tokens.css` | 의미별 글자 크기·폭·간격·카드 반응형·색 토큰 연결 |
| P5 공정 모션 | `cabinet-cinematic-story.tsx`, `kitchen-scene/timeline.ts`, 필요한 `kitchen-engine.ts`와 CSS | progress 기준점·전환·카메라·fallback·현재 위치 복원 |
| P6 metadata/QA | 홈/KCP route metadata, 새 검증 기록, 관련 TODO | 고유 제목/설명·서버 콘텐츠·링크·UI/모션 검증 및 완료 표시 |

계획/QA는 analyst, 확정된 코드·필요 테스트는 implementer 역할로 진행한다. 홈 지역과 KCP는 파일 범위를 분리할 수 있다. `cabinet-cinematic.css`와 콘텐츠 파일을 여러 담당자가 동시에 편집하지 않는다. Next.js 코드를 쓰기 전 설치 버전의 `node_modules/next/dist/docs/` 관련 가이드를 읽는다.

구현 중 발견한 오류는 재현 → 원인 확인 → 수정 → 해당 동작 재검증 후 다음 단계로 넘어간다. 기존 통과 결과는 이번 UI 변경의 새 브라우저 인수를 대신하지 않는다.

## 9. 완료 조건과 TODO

### 이번 계획에서 완료

- [x] 운영 KCP·홈의 현재 구조와 정보 중복 확인.
- [x] 데스크톱·모바일 글자/행간/폭/섹션 높이 측정 및 화면 저장.
- [x] 9공정+reveal의 실제 경로와 쇼룸 제거 영향 확인.
- [x] 새 섹션 순서·카피 방향·지역 이전·디자인 토큰·모션 계약 작성.
- [x] 기존 미커밋 코드 보존.

### 2026-10-13 구현 및 로컬 검증

실행 근거는 [구현·검증 기록](../verification/2026-10-13-kcp-landing-ui-ux.md)과 [브라우저 결과](../verification/2026-10-13-kcp-landing/results.json)를 따른다. 구현 중 다른 대화의 견적·메인 작업이 같은 체크아웃에서 진행되므로 최신 전체 검사 상태를 따로 기록한다.

- [x] P1~P3 콘텐츠·홈 지역·KCP 구조 및 showroom 삭제 구현.
- [x] P4 글자·문단·여백·사진 크롭·반응형 구현. Manrope와 기존 글로벌 토큰 재사용.
- [x] P5 시작/경계/완성/순·역방향과 준비 전환의 모션 수정. 첫 컨트롤 잘림·반복 정적 전환·사전 WebGL 실패 이동 오류 수정.
- [x] 320/390/768/1280/1440px 및 1023/1024px·699/700px 경계의 가로 넘침·앵커·읽기 구조 확인.
- [x] 모바일 메뉴·목차·FAQ·CTA·전후 비교의 키보드/pointer와 포커스 복귀 확인. 200% 글자 확대 시뮬레이션 실행.
- [ ] 실제 브라우저 200% 확대와 물리 기기의 터치/Safari 인수. 시뮬레이션으로 완료 표시하지 않음.
- [x] 같은 1280×720에서 문서 23,048→약 11,516px(약 50% 축소), 서비스 2,292→약 780px 확인. 390×844에서도 문서 약 52% 축소.
- [x] 스크롤 시작→완성, 역방향·빠른 왕복·중간 hash·새로고침·정적 보기 두 번 왕복 검증.
- [x] reduced-motion의 실제 브라우저 최초/도중 변경, JS 비활성, WebGL 초기 실패/사전 실패/컨텍스트 상실의 정보·위치 보존 확인. 물리 기기 미실행 구분.
- [x] 홈 지역 상세 1회·21개 suburb/범위 조건 보존, KCP 짧은 안내·홈 링크 1회 확인.
- [x] Colours·광택 컨트롤·쇼룸 초기화 제거, 공정 3D·Finish·BeforeAfter 유지 확인.
- [x] H1 1개·제목 계층·초기 HTML 본문/FAQ·고유 title/description·앵커·이미지 고지 확인.
- [x] 기존 견적 시작 경로와 연락 링크 회귀 확인. 외부/API fixture를 사용해 실제 사용자 자료/예약을 만들지 않음.
- [x] 타임라인 경계 연속성·유한값·역방향 동일성·패치/두 코트 순서·완성 재조립 단위 검사 8/8 통과.
- [x] 최신 작업트리의 최종 lint·typecheck·build 및 최종 CSS 보정 화면 재확인. 동시 견적 입력 작업 담당자의 오류 수정 후 `npm run check` exit 0, 최종 모바일/글자 확대 재실행과 시각 검토 통과.
- [x] 실제 로컬 브라우저 16개 시나리오와 코드 검사를 나누어 기록. 초기 검증 코드 실패와 성공 재실행 증거 보존. 프레임 성능/물리 기기 결과를 주장하지 않음.

커밋·푸시·main 병합·운영 배포는 이번 요청에서 수행하지 않는다. 색인 활성화와 물리 기기/실제 확대·정량 성능 인수는 별도 단계다.

## 10. 2026-10-13 브라우저 주석 디자인 보정

[후속 디자인·검증 기록](../verification/2026-10-13-kcp-design-polish.md). 위 최초 타이포/간격 제안 중 아래 값은 사용자의 후속 요청으로 갱신했다.

- [x] Hero 문단 여백20/28/20/32px(모바일24px)·CTA 안내16px, 주요 버튼52px·16px/600로 통일. 실제 여백을 덮던 선택자 충돌 수정.
- [x] On this page 라벨/목차4개 Manrope18px/600·행간1.35, 모바일2열과 클릭 영역48px 적용.
- [x] Hero 이미지 고지를12px 흰색·배경 없음·우측 하단·작은 그림자로 정리. 생성 이미지 안내 유지.
- [x] 서비스 카드 모서리20px·패딩28px/모바일24px·간격24px/모바일20px 적용.
- [x] 화면의 제품명 Dulux Aquanamel 정정.
- [x] 공정 링크의 문자 화살표를SVG로 교체하고 텍스트에만 밑줄/아이콘6px 간격 적용.
- [x] 1176×828·390/320px 시각 확인, 최신 lint·타입·build, production 브라우저16개 시나리오 및 최종 QA 판정 완료.

3D 공정·SEO·지역/견적 조건을 보존했다. 별도 진행 중인 홈의 DOM 변경은 지역 데이터 계약을 유지하는 의미 검증으로 지원했으며, 서버 CSS 캐시 불일치는 재시작·동일 시나리오 재검증으로 해결했다. 실패 기록을 보존하고 실제 기기/확대·정량 성능의 미실행 구분을 유지한다.
