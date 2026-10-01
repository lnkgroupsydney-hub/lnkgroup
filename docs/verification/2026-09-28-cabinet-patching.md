# Prepare 단계 퍼티 보수 장면 수정 검증

2026-10-01 사용자 요청으로 확인용 스크린샷을 삭제했다. 아래 텍스트 검증 기록은 보존한다.

2026-09-28 · 사용자 피드백: Prepare는 파란 도장으로 바뀌는 모습이 아니라 손상된 부분을 패치하는 장면이어야 한다.

**결과: 해당 수정 범위의 코드 검사·실제 브라우저 검증 통과.**

## 변경

- 기존 크림색 문짝·작업대·카메라 구도를 유지한 이미지 한 장을 내장 image_gen으로 편집했다. 깨진 모서리·표면에 밝은 국소 filler와 우측 손/퍼티 나이프가 보인다.
- `frontStoryPrepared` —1536×1024 WebP112,040 B. Step3 poster/reveal 및 Step4 시작 배경에 연결한다. 생성 컨셉 표시는 유지한다.
- Prepare 첫 문단을 국소 chips/dents filler 및 sanding, agreed scope/assessed material 조건으로 구체화했다. 서비스 보장·가격·새 운영조건을 추가하지 않았다.
- 최초 브라우저 검수에서 left→right reveal은 우측 작업을 너무 늦게 보여 줬다. 공용 `StoryVisual.revealFrom` 옵션을 추가하고 Prepare만 right/270deg로 설정했다. 기본 left/90deg인 Undercoat/Finish와 기존 controller는 유지한다.
- 다른 주방 장면, Hero와 메인 프로토타입은 변경하지 않았다.

[생성 출처](../design-assets/cabinet-story-patching/manifest.json) · [전체 프롬프트](../design-assets/cabinet-story-patching/prompt.txt) · [이미지](../design-assets/cabinet-story-patching/prepared-patched.png).

## 실제 검증

- 최종 `npm run check` exit0: ESLint 경고0, typegen/tsc, optimized Webpack build 및 홈/KCP static prerender. [로그](2026-09-28-cabinet-patching/check.log).
- production3002의 KCP와 새 WebP HTTP200, WebP112,040 B. 기존3000/3001 서버는 변경하지 않았다.
- Codex in-app browser 1175×828에서 Prepare 진입 progress0.38298에 우측 손/퍼티 작업이 본문과 함께 표시된다. computed mask270deg와 올바른 새 이미지 src/로드 완료 확인.
- 스크롤 progress0.38298→0.52791→0.38298로 정방향/역방향 복귀 확인.
- 키보드 Enter로 Undercoat 이동: 기본90deg/left 유지, 배경에 새 patched 이미지와 위에 기존 undercoat 이미지가 로드됨.
- 키보드 Space로 정적 보기: 새 patched figure/alt가 표시되고 7단계 본문 유지. 가로 overflow없음, H1하나, noindex/nofollow.
- 수행한 production 흐름의 console error/warn 기록 없음. 기존 회사 내용·견적 기능 범위 변경 없음.
- `git diff --check`와 수정 문서의 로컬 링크 확인 통과. 앱 코드 수정·Git commit/push·배포는 각각 구분하며 이번 커밋/배포는 수행하지 않았다.

## 검증 한계

이 변경은 국소 사진/콘텐츠/전환 방향 개정이다. 실제 기기·OS reduced-motion·전체 사이트 키보드/보조공학·정량 성능을 새로 검증했다고 보고하지 않는다. 해당 이전 검사와 남은 범위는 [앞선 공정 검증](2026-09-28-front-cabinet-depth.md)을 따른다. 도어 손상이 filler로 모두 수리 가능하다는 보장이 아니며 실제 재료/손상 범위는 별도 평가한다.
