# 회사 제공 자산과 프로토타입 이미지 기록

## 2026-09-29 Cinematic WebGL 개정 자산

9단계 공정의 모바일/정적 대체 장면을 위해 내장 **image_gen**으로 기존 사진 2개를 편집했다. 새 WebP는 원본 생성 결과를 Pillow로 포맷만 변환했다(quality84, method6). 생성 컨셉이며 실제 시공 증거가 아니다.

| 실행 자산 | 크기 | 용량 | 용도 |
| --- | --- | --- | --- |
| `public/images/story/cinematic-v3/cleaning.webp` | 1536×1024 | 126,476 B | 크림색 문짝을 천으로 닦는 세척 단계. 기존 모서리 손상 유지 |
| `public/images/story/cinematic-v3/masking.webp` | 1536×1024 | 107,600 B | 같은 정면 주방의 작업대·바닥 보호 및 테이핑 |

[원본·입력/생성 경로 기록](design-assets/cabinet-cinematic-v3/manifest.json), [세척 프롬프트](design-assets/cabinet-cinematic-v3/cleaning-prompt.txt), [마스킹 프롬프트](design-assets/cabinet-cinematic-v3/masking-prompt.txt). 실행 파일은 `siteAssets`에서 교체한다. 이전 Hero/전후/퍼티·언더코트·마감 사진은 재사용한다.

WebGL 주방은 별도 CAD/GLB 구매물이 아닌 로컬 파라메트릭 기하로 구현하는 건축 컨셉이다. 생성 사진과 실측으로 일치하는 모델이라고 주장하지 않는다. 라이브러리 렌더링·재질 변경과 생성 사진의 구분은 [개정 계획](plans/24-cinematic-kitchen-webgl.md)에 기록했다.

## 2026-09-28 Prepare 단계 국소 패치 수정

사용자 피드백에 따라 Prepare에서 문 전체가 청회색으로 바뀌던 사진을 교체했다. 기존 크림색 문짝을 유지하며 손상된 모서리·표면에 밝은 퍼티가 국소적으로 채워지고 오른쪽 손/퍼티 나이프가 보수하는 장면이다. 실제 L&K 시공 증거가 아닌 생성 컨셉이다.

- 실행: `public/images/story/front-v2/prepared-patched.webp` — 1536×1024, 112,040 B.
- 원본: [prepared-patched.png](design-assets/cabinet-story-patching/prepared-patched.png).
- 제작: 내장 **image_gen**으로 기존 `workshop-existing.webp`를 편집한 뒤 WebP로 포맷 변환. [전체 프롬프트](design-assets/cabinet-story-patching/prompt.txt) · [출처/생성 경로](design-assets/cabinet-story-patching/manifest.json).
- 중앙 설정 `frontStoryPrepared`로 Step3 poster/reveal 및 Step4 시작 배경을 함께 교체한다. 모바일·정적 보기에도 같은 사진을 사용한다. Prepare만 오른쪽부터 reveal하여 퍼티 작업을 먼저 보여 준다.
- 아래 이전 기록의 `prepared.webp`는 공정에서 더 이상 사용하지 않는다. 보관 자산은 삭제하지 않았다. 최신 front-v2 7개 파일 합계는887,238 B이며 실제 전송량 측정은 아니다.

## 2026-09-28 Concept 2 정면 캐비넷 공정 개정

루트 `concept 2.png`의 주방 구도를 기준으로 내장 **image_gen**으로 글자 없는 master와 공정 상태를 생성했다. KCP 7단계 공정만 새 사진을 사용하고, 승인된 KCP Hero 사진과 메인 프로토타입은 유지한다. 모두 `generated-concept`이며 실제 시공 사례가 아니다.

| 새 실행 자산 — `public/images/story/front-v2/` | 크기 | 파일 용량 | 용도 |
| --- | --- | --- | --- |
| `kitchen-finished.webp` | 1536×1024 | 155,776 B | 완성·재조립 원본 |
| `kitchen-existing.webp` | 1536×1024 | 150,130 B | 기존 크림색 도장·분리 원본 |
| `kitchen-removed.webp` | 1536×1024 | 136,500 B | 탈거 정적 장면·열린 내부 |
| `assemble-background.webp` | 1536×1024 | 134,944 B | 재조립 시 열린 내부 |
| `coat-1.webp` | 1536×1024 | 95,224 B | 세이지색 1차 마감 |
| `coat-2.webp` | 1536×1024 | 102,624 B | 세이지색 2차 마감 |

새 WebP 6개 합계 **775,198 B**는 디스크 용량이다. 실제 전송량 측정은 아니다. PNG master·전체 생성 프롬프트·워크숍 입력/결과 경로는 [제작 폴더](design-assets/cabinet-story-front-v2/)와 [manifest](design-assets/cabinet-story-front-v2/manifest.json), [작업장 생성 기록](design-assets/cabinet-story-front-v2/workshop-finish-generation.json)에 보관했다. 생성 후 Pillow로 WebP 포맷을 변환했다.

기존 `workshop-existing.webp`, `prepared.webp`, `undercoat.webp`는 같은 셰이커 도어 작업장 구도를 재사용한다. 사진의 **6개 전면**을 같은 좌표에서 움직이고, 배경은 원본 master를 유지하며 열린 내부만 해당 마스크 안에서 합성한다. 펜던트 뒤에 가려진 후드 오른쪽 문은 고정한다. 손잡이는 도어에 포함되고 독립 힌지 모델은 없다. 이는 사진 기반 3D transform 연출이며 완전한 3D 모델이 아니다.

교체는 `src/shared/config/assets.ts`의 `frontStory*` 경로·크기·alt·출처와 `cabinet-story-content.ts`의 영역 좌표를 함께 수정한다. 다른 서비스는 공용 `RegisteredLayer`의 깊이·축별 회전·stagger와 `registeredBase`를 재사용할 수 있다. 이전 파일은 Hero 및 제작 이력 때문에 보존했다.

## 2026-09-28 사진형 Hero·7단계 공정 — 이전 제작 이력

승인한 Slate / Greige 시안에서 UI 없는 주방 사진을 만들고, 내장 `image_gen`으로 같은 구도의 기존/탈거/완성 상태와 작업장 도어 상태를 제작했다. KCP 상세의 사진형 첫 화면과 공정에 사용한다. 메인은 기존 프로토타입 구성으로 유지하며 실제 회사 사진은 About·Gallery에 유지한다. 새 사진은 `generated-concept`이며 실제 전후 시공 사례로 표시하지 않는다.

| 웹 파일 (`public/images/story/`) | 크기 | 파일 크기 | 용도 |
| --- | --- | --- | --- |
| `kitchen-finished.webp` | 1490×1055 | 156,966 B | KCP Hero·공정 완성·사진 마스크 원본 |
| `kitchen-existing.webp` | 1490×1055 | 161,866 B | 기존 크림색 도장·탈거 마스크 원본 |
| `kitchen-removed.webp` | 1490×1055 | 167,658 B | 탈거 후 배경·정적 poster |
| `assemble-background.webp` | 1490×1055 | 132,370 B | 재조립 배경 |
| `workshop-existing.webp` | 1536×1024 | 94,564 B | 작업장 준비 전 도어 |
| `prepared.webp` | 1536×1024 | 119,200 B | 샌딩·부분 보수 상태 |
| `undercoat.webp` | 1536×1024 | 85,814 B | 언더코트 상태 |
| `coat-1.webp` | 1536×1024 | 90,294 B | 1차 마감 상태 |
| `coat-2.webp` | 1536×1024 | 92,084 B | 2차 마감·정적 poster |

웹 원본 합계는 **1,100,816 B**다. 이는 파일 합계이며 브라우저 전송량·LCP 측정값이 아니다. `next/image`가 실제 표시 크기별 파생 이미지를 제공한다. 원본 PNG·프롬프트·생성 기록은 [design-assets/cabinet-story](design-assets/cabinet-story/)에 보존한다. WebP는 품질 82–86으로 변환했고, 1491px로 나온 주방 배경은 웹 변환 시 공통 1490×1055로 정규화했다.

투명 도어/철물 생성은 프레임 포함·좌표 변형 때문에 검수에서 제외했다. public이나 자산 레지스트리에 넣지 않았다. 실행 중에는 원본 사진의 7개 도어/서랍 영역을 동일 좌표에서 clip-path로 제한해 이동한다. 손잡이는 도어에 포함돼 함께 움직이고, 가려진 힌지는 별도로 그리지 않는다. [좌표 기록](design-assets/cabinet-story/mask-coordinates.json)은 제작 근거이며 실제 소비되는 마스크는 `cabinet-story-content.ts`에서 관리한다.

새 실제 현장 자료로 교체할 때는 `src/shared/config/assets.ts`의 경로·크기·alt·출처와 스토리 콘텐츠의 마스크·주석 위치를 함께 바꾼다. 사진만 바꾸고 이전 좌표를 그대로 사용하지 않는다. 실제 시공 자료가 아닌 동안 컨셉 표시를 유지한다.

Manrope는 공식 Google Fonts의 Latin variable WOFF2 **24,576 B**를 로컬로 보관한다. 출처·SHA-256·SIL OFL 1.1 라이선스는 `src/shared/assets/fonts/README.md`와 `OFL.txt`에 기록했다. 런타임 외부 폰트 요청은 필요하지 않다.

## 2026-09-27 회사 자산 반영

원본은 중복 정리 후 각 자산의 대표 저장 위치에 보존한다. 웹에 사용하지 않는 참고 자료는 [reference-assets](reference-assets/)에(로고 PDF는 2026-11-19 삭제), 그대로 복사한 홍보·작업 사진 3개는 아래 `public/images/` 파일에 원본 바이트를 보존한다. [회사 제공 자료](reference-assets/company-brief.md)에 수령 파일명·출처·현재 저장 위치와 미확정 설명을 기록했다. 메인은 아래 실제 회사 제공 자산을 사용하며 사용 중인 생성 이미지는 Cabinet 컨셉으로만 남는다. 웹용 로고는 PDF를 그대로 렌더링했으며 새로운 로고를 생성하거나 도형을 수정하지 않았다.

| 원본 | 웹 파일 | 크기·적용 |
| --- | --- | --- |
| `LK_Group_Logo.pdf` (2026-11-19 저장소에서 삭제, git 기록에서 복원 가능) | `public/images/lk-group-logo-circle-transparent.png` | 1254×1254 투명 PNG, 공통 헤더·favicon |
| `L&K main page photo.png` | `public/images/lk-group-promotional-artwork.png` | 1254×1254, 기존 About 영역, 전체 비율 보존 |
| `cabinet progress 2.jpg` | `public/images/cabinet-surface-preparation.jpg` | 1080×2340, 메인 갤러리 표면 보수 |
| `cabinet working 1.jpg` | `public/images/cabinet-door-spray-painting.jpg` | 1080×2340, 메인 갤러리 분사 도장 |

세 사진/홍보 이미지는 원본과 SHA-256이 같은 웹 파일을 유지하고 `reference-assets`의 중복 사본을 삭제했다. 작업 사진은 CSS 4:5 표시 영역을 사용하며 `next/image`가 화면별 크기로 제공한다. 자산 경로·원본 크기·alt·출처는 `src/shared/config/assets.ts`에서 관리한다. 메인 홍보 이미지는 회사 제공 디자인 자료로, 작업 사진은 작업 과정으로 설명하며 완료 현장·지역·날짜·전후 짝을 만들지 않는다. 가격 안내물은 브랜드·세금·현행 적용 조건 확인 전 공개 이미지로 복사하지 않았다.

2026-09-27 사용자 요청으로 중복 4개와 미사용 생성 이미지 2개를 정리했다. 루트 `main page.png`도 SHA-256이 같은 [메인 시안](reference-assets/main-page.png)을 남기고 삭제했다. 삭제한 6개 파일의 합계는 8,382,029바이트이며 사용 중인 웹 이미지·다른 참고 사진·시안·QA 화면은 보존했다.

## 기존 생성 자산 — 최초 프로토타입 기록

2026-09-27 · 내장 `image_gen` 도구로 생성. 최종 브랜드·실제 시공 실적이 아닌 임시 자료다. 현재 사용 중인 두 Cabinet 이미지는 프로젝트 `public/images/`에 보관하며 실제 자료가 오면 콘텐츠의 자산 경로·크기·alt를 함께 교체한다. 회사 자산으로 대체된 워드마크·거실 이미지 파일은 사용자 요청으로 삭제했고 아래 과거 생성 기록과 프롬프트는 보존한다. 사진은 `next/image`로 화면 크기에 맞춰 제공한다.

| 파일 | 크기 | 용도 | 표시 기준 |
| --- | --- | --- | --- |
| `public/images/lk-group-wordmark-concept.png` | 2172×724, 투명 PNG | 과거 헤더 | 회사 로고로 교체, 미사용 확인 후 파일 삭제 완료 |
| `public/images/kitchen-cabinet-concept.png` | 1536×1024 | 캐비넷 컨셉 사진 | 생성된 공간 예시, 실제 프로젝트가 아님 |
| `public/images/living-room-concept.png` | 1536×1024 | 과거 메인 갤러리 | 회사 작업 사진으로 교체, 미사용 확인 후 파일 삭제 완료 |
| `public/images/cabinet-finish-detail-concept.png` | 1536×1024 | KCP 상세의 도장 마감·표면 안내 사진 | 내장 image_gen으로 생성한 컨셉, 실제 시공 실적 아님 |

실제 사진으로 교체할 때 사용 권한·고객 동의와 개인정보 노출 여부를 확인한다. 실제 작업 증거가 확인된 이미지에만 프로젝트 설명을 붙인다. 생성 이미지의 전후 비교를 실제 시공 효과처럼 표시하지 않는다.

## 생성 프롬프트 원문

### 워드마크 — transparent_background=true

Use case: logo-brand. Create a temporary logo asset for a local prototype of an Australian home maintenance and painting company named exactly 'L&K Group'. Minimal confident typographic wordmark, black/charcoal only, contemporary clean bold sans serif, optically spaced, wide horizontal composition about 3:1 with modest clear space. The exact text is 'L&K Group' with uppercase L and K, ampersand, and capital G lowercase roup. No tagline, no invented credentials or dates, no roof clip art, no mockup or scene, no decorative gradients, no small fine detail. Plain vector-like bitmap wordmark on genuinely transparent background, clean sharp lettering, suitable for a website header. This is a provisional brand asset, not a finished identity.

### 주방 — transparent_background=false

Use case: photorealistic-natural. Asset type: provisional website gallery photograph for an Australian home maintenance company, kitchen cabinet painting service. A believable modest Sydney suburban kitchen after a careful repaint of existing shaker cabinet doors, softly warm off-white painted cabinetry, subtle visible painted wood texture, simple light stone-look bench, restrained brushed metal handles, a small window with soft eucalyptus foliage out of focus outside, warm daylight, practical tidy lived-in residential setting, understated quality craftsmanship rather than luxury construction. Wide landscape editorial architectural photography, eye-level three-quarter view, natural lens perspective, sharp cabinet door edges and clean uniform paint finish, neutral warm white and muted timber tones. No people, text, logos, labels, watermark, price, before/after split, tools, false project signage, or lavish mansion features. This is a fictional concept scene, not documentary evidence of a real company's completed work. Compose for a horizontal 3:2 website photo with cabinet fronts clearly visible.

### 거실 — transparent_background=false

Use case: photorealistic-natural. Asset type: temporary concept gallery photograph for an Australian residential painting and home maintenance website. A modest well-maintained Sydney suburban living room with freshly painted warm off-white walls, crisp simple timber skirting, natural oak flooring, a small neutral linen sofa partially visible, simple wood door frame and a large ordinary window looking toward an Australian garden with eucalyptus leaves. Emphasise careful clean interior wall paint finish, no extravagant architecture. Authentic daylight editorial architectural photograph, three-quarter eye-level view with natural straight lines, wide 3:2 horizontal composition, restrained neutral palette consistent with warm white residential kitchen photography. Quiet practical comfortable room, no people, no tools, no text or logos, no watermark, no before-after split. Fictional interior for design exploration, not an actual company's project.

### 캐비넷 마감 상세 — transparent_background=false

2026-09-27 내장 `image_gen` 생성 후 시각 확인. 원본 생성 파일을 위 프로젝트 경로로 복사했으며 기존 주방 이미지는 유지했다. 중앙 설정 `siteAssets.cabinetFinish`의 src·alt·크기를 함께 바꾸면 후속 사진으로 교체할 수 있다.

Use case: photorealistic-natural. Asset type: supporting photograph for a local Kitchen Cabinet Painting website prototype. Primary request: a believable close editorial view of existing cream painted shaker kitchen cabinet doors and a matching drawer, showing the subtle satin painted finish, neat recessed panel edges, and a simple brushed nickel handle. Scene: a modest Australian suburban kitchen with a light stone-look benchtop edge, a small portion of off-white splashback, softly out-of-focus timber floor. Style: natural architectural photography, warm window daylight, calm practical lived-in home; visually consistent with warm off-white shaker cabinetry and restrained timber tones. Composition: horizontal 3:2, aim 1536x1024, focus on two cabinet door panels and drawer with enough surrounding context, natural straight perspective, detailed surface texture. No people, text, logos, labels, watermark, tools, paint brand, before/after split, or luxury construction. Fictional concept illustration, not evidence of a real company's completed work.

## 2026-09-27 이미지 정리 검증

중복 4쌍의 SHA-256을 삭제 직전에 재확인하고 지정한 6개 파일만 삭제했다. 남은 이미지 34개의 바이트는 정리 전과 모두 같으며, 중앙 설정의 웹 이미지 6개와 수정한 문서 링크가 실제 파일을 가리키는지 확인했다. `npm run check`의 lint·타입·production build 및 `git diff --check`를 통과했다.

기존 3001번 production 서버는 시작 시 읽은 public 파일 목록이 갱신되지 않아 새 회사 이미지 4개에 404를 반환했다. 해당 프로젝트 서버만 최신 빌드로 재시작한 뒤 `/`, `/services/cabinet-painting`, 웹 이미지 6개 모두 HTTP 200을 확인했고 이미지 응답의 SHA-256도 보존한 원본 파일과 일치했다. 3000번 서버는 변경하지 않았다. 이는 HTTP·파일 검증이며 새로운 실제 브라우저 QA를 수행했다는 뜻은 아니다.
