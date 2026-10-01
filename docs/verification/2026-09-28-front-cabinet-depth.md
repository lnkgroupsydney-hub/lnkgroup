# Concept 2 정면 캐비넷 · 입체 스크롤 검증

2026-10-01 사용자 요청으로 확인용 스크린샷을 삭제했다. 아래 텍스트 검증 기록은 보존한다.

2026-09-28 · `codex/scroll-storytelling-design` · 설계/판정/QA Astra xhigh, 앱 코드 Sol xhigh.

**최종 결과: 기록한 로컬 검증 범위 통과.**

## 범위

사용자 요청에 따라 KCP **공정** 사진을 `concept 2.png`의 정면 세이지/올리브 그레이지 주방으로 교체했다. KCP Hero와 메인 프로토타입은 유지한다. 기존 7단계/8개 목차/SEO 본문/회사 사실/noindex/비활성 Free Quote를 유지한다. 견적·AI·예약·결제·외부 계정·배포·Git 커밋은 수행하지 않았다.

## 구현·자산

- 글자 없는 동일 주방 master와 기존 크림색 도장, 선택 도어 탈거, 재조립 내부, 세이지 마감 두 상태. 새 WebP 6개 775,198 B. 이는 디스크 파일 용량이고 네트워크 전송량 측정은 아니다.
- 6개 실제 사진 도어 영역과 공통 perspective1500px, 작은 XYZ 회전, 깊이58–86px, 순차 easing 및 깊이에 비례하는 그림자.
- 고정 실내는 원본 사진으로 유지하고 열린 내부만 동일 영역에 합성한다. 생성 편집의 배경 위치 차이가 실내 전체에 나타나지 않는다.
- 펜던트에 가린 후드 오른쪽 도어는 고정. 손잡이는 문짝 사진에 포함. 완전한 3D 모델이나 독립 힌지/철물 애니메이션은 아니다.
- 격자·큰 유령 번호·떠 있는 주석 제거. 원근 연출, 작은 단계 이동, 전체 사진 veil과 본문만 유지한다. 마감 경계는 부드러운 mask로 전환한다.
- 공용 RegisteredLayer의 깊이/축 회전/stagger, StoryVisual의 registeredBase를 다른 서비스에서 재사용한다.
- [설계 명세](../plans/23-front-cabinet-depth-story.md) · [자산/프롬프트](../design-assets/cabinet-story-front-v2/manifest.json).

## 실제 개발 브라우저 확인

| 조건 | 관찰 |
| --- | --- |
| 1440×900 분리 | 문짝 6개, 진행률0.3854→0.7127에서 각 layer0.331/0.291/0.248/0.203/0.157/0.111→0.800/0.783/0.764/0.742/0.718/0.690. 깊이 matrix3d와 그림자 증가 확인 |
| 역스크롤 | 같은 양의 역스크롤 후 이전6개 layer 값으로 복귀, 원본 고정 배경 유지 |
| 재조립 | 단계 바로 이동 후 분리 도어 표시, 아래로 스크롤하며 원래 좌표·회전·깊이0에 순차 안착 |
| 마감 | 새 세이지색 Finish01→Finish02, 부드러운 경계 및 동일 작업장 도어 확인. 직접 단계 접근의 cold 이미지 로딩 안내 뒤 정상 표시 |
| 1024×768 | 사진 채움·본문·rail·하단 조작 겹침 및 가로 overflow 없음 |
| 정적 보기→모바일 | 실제 화면의 모션 끄기 버튼 클릭 후 Remove 단계 top32.0469px. 390×844 resize 후32.1719px로 같은 단계 유지 |
| 모바일/낮은 화면 | 390×844,320×740,1024×600에서 정적7단계와 새 사진/alt 확인, 가로 overflow 없음 |

## 수정 후 재확인

1. 본문 주변의 별도 사각 gradient가 사진 위에 띠처럼 보임 → 제거하고 전체 veil 유지. 재촬영에서 경계 제거 확인.
2. Finish02 absolute label 줄바꿈 → nowrap으로 수정.
3. 밝은 목재 위 흰 Finish label 대비 부족 → 기존 전역 slate 색상으로 수정.

## 독립 코드 점검

Astra의 읽기 전용 감사에서 6개 마스크의 실제 전면 대응, 조명/의자 제외, 0/1/역방향 복원, 원본/내부/도어/그림자 순서, SSR/정적/reduced-motion/실패 경로를 확인했다. 추가 P1/P2를 발견하지 못했다. 이것은 실제 기기 성능 검증이 아니다.

## 최종 프로덕션 검증

최종 CSS 대비 수정까지 반영한 `npm run check` exit0: ESLint 경고0, Next typegen/tsc, Webpack optimized build, 홈/KCP static prerender 통과. [실행 로그](2026-09-28-front-cabinet-depth/check.log). `git diff --check` 통과.

실행 주소: [KCP 공정](http://127.0.0.1:3002/services/cabinet-painting#cabinet-process). 새 production 탭에서 완성·분리·재조립·Finish02·모바일을 확인했다. Finish01/02는 한 줄(각18px 높이), slate rgb(46,58,63)로 표시된다. Skip은 Services로 이동하고 해당 섹션에 focus된다. H1 하나, 기존8개 목차 대상 모두 존재, Free Quote3개 native disabled, noindex/nofollow, 가로 overflow 없음. 최종 production 탭의 수행 흐름에서 console error/warn 배열은 비어 있었다.

홈은 기존 “Painting, cabinet refreshes & handyman services in Sydney” 제목과 프로토타입을 유지하고 공정 스토리가 없다. 기존 Hero의 blue-grey 사진도 유지했다. 모바일 메뉴/FAQ 키보드의 이전 QA는 [기존 검증](2026-09-28-scroll-storytelling.md)에 있으며 이번 사진 개정에서 전부 반복 검사한 것으로 보고하지 않는다.

로컬 QA proxy3003의 script-src none에서 서버 본문·7개 정적 figure·H1·noindex가 남는다. proxy3004의 새 story 사진/폰트404에서 Visual unavailable와7개 단계 본문이 표시되고 Skip으로 Services에 focus 이동된다. 의도한404/CSP와 정상 앱 오류는 구분한다. QA proxy는 확인 후 종료하고 production3002는 유지했다.

빌드 전환 중 기존 dev 탭 한 번은 서버 중지 구간에 새로고침돼 연결 오류 페이지에 머물렀다. 서버 HTTP200 확인 후 새 production 탭에서 정상 검증했다. 이는 앱 렌더 오류와 구분한다.

## 시각 비교·증거

같은 비교 이미지에 **concept2 원본 / 글자 없는 master / 실제 완성 장면**을 함께 놓고 확인했다. 캐비넷 방향·형상·세이지색, 황동 펜던트2개, 아일랜드·라탄 의자·왼쪽 창·오른쪽 아치가 일치한다. 원본의 웹사이트 제목/메뉴 디자인을 복사하는 범위가 아니다. 실제 스크롤 화면에는 기존 전역 타이포와 읽기용 veil을 적용했다. 수행한 시각 검수에서 미해결 P0/P1/P2는 없다.

## 남은 검증 범위

실제 OS reduced-motion 설정 변경·실제 iOS/Android·다른 브라우저 엔진·보조공학 전체 감사·화면200% 확대·느린 네트워크·Lighthouse/LCP/CLS/INP/메모리 측정은 수행하지 않았다. reduced-motion 경로는 코드 검토이며, 수동 정적·모바일·낮은 화면 경로는 위 실제 브라우저 관찰과 구분한다.
