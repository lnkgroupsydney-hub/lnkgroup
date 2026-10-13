# 메인 UI·UX 계획과 투명 로고 — 실행 기록

> 후속 변경: 로고는 후속 사용자 태그에 따라 검정 원을 복원하고 바깥 흰색만 제거한 공통 자산으로 교체했다. 현재 화면은 [최신 주석 반영 기록](2026-10-13-lk-home-revision.md)을 따른다. 아래 내용은 최초 실행 당시 기록이다.

2026-10-13 · Australia/Sydney · 브랜치 `codex/lk-group-home-ui-ux-20261013`.

## 범위와 보존

- [48번 계획](../plans/48-lk-group-home-ui-ux-plan.md)을 먼저 작성했다. 메인 화면 개편은 계획 검토 후 H-01~05에서 구현한다. 이번 기록은 새 UI 인수 결과가 아니다.
- 사용자가 `Coming soon`을 확정했다. 판매·일반 도장·핸디맨에 새 상세/구매 링크를 만들지 않는 명세다.
- 시작 시점은 `codex/quote-one-page-ux-20261013`, HEAD `756eb4d`와 기존 미커밋 변경이다. 새 브랜치 생성 시 해당 변경을 그대로 보존했다. 기존 작업을 이 요청의 신규 구현으로 계산하지 않는다.
- 커밋·푸시·클라우드 설정·회사 DB·메일·운영 배포·색인 설정은 변경하지 않았다.

## 로고 파일과 출처

| 항목 | 결과 |
| --- | --- |
| 원본 | 회사 제공 `lk-group-logo.png`, 900×900, alpha 없음, 385,386 bytes |
| 원본 보존 | `docs/reference-assets/lk-group-logo-original-with-background.png`; 기존 회사 PDF도 유지 |
| 편집 방식 | 내장 `image_gen`, `background-extraction`, 실제 투명 배경 요청 |
| 선택된 결과 | `public/images/lk-group-logo-transparent.png`, 1254×1254, alpha 있음, 875,253 bytes |
| 이전 파일명 | `public/images/lk-group-logo.png`도 같은 투명본으로 교체. 실제 앱은 새 파일명을 사용 |
| 중앙 설정 | `src/shared/config/assets.ts`의 wordmark 경로·실제 크기 갱신 |
| 적용 화면 | 홈 헤더·KCP 사진 위 헤더·견적 헤더·favicon. 향후 로고 추가도 같은 중앙 자산 사용 |

원본 SHA-256: `47cb7567e447969f4b334765374c41043c6f4baa777e0b85ebb082851fb09f4d`.

선택본 SHA-256: `f011012408fa2d6238e512cc929f7c353d3bf765b2d2e4048b51da23aba4289f`.

선택 결과는 내장 도구 출력 `exec-1b67bbb8-7188-4744-b209-1eac95a6f86e.png`에서 프로젝트로 복사했다. 두 번째 정리 시안도 비교했지만 원본의 금색 하이라이트와 구성이 더 가까운 첫 결과를 선택했다. 밝은 그레이지·어두운 슬레이트 바탕에서 실제 브라우저로 합성해 280/128/56/40px을 확인했다. 투명 픽셀의 RGB 값만 보이는 도구 원본 표시와 실제 alpha 합성 화면을 구분했다.

사용한 선택본 프롬프트:

> Use case: background-extraction. Asset type: existing L&K Group company logo for website headers and site branding. Input image 1 is the exact edit target. Remove BOTH the white outside-square background and the black circular background, making ALL non-gold background areas genuinely transparent, including holes inside and between letter strokes and inside the gold circular border. Preserve every gold element from the source: the outer gold ring, overlapping L and K, ampersand, angular architectural line motif, GROUP lettering and horizontal rules, gold gradients and tiny gold highlights. Text must remain exactly L&K and GROUP. Keep the original composition, proportions, shapes and typography exactly; this is background removal only, no redesign, redraw, new lettering, extra shadows, extra outlines or background replacement. Preserve crisp antialiased gold edges. Output a PNG with real alpha transparency.

## 발견한 문제와 수정

첫 적용은 기존 파일명 교체 방식이었다. PNG 원본과 일반 HTTP 응답에 alpha가 있어도 실제 Chrome 화면은 이전 흰/검정 배경 로고를 표시했다. **브라우저가 선택한 최적화 이미지 형식의 캐시가 남아 있었다.** alpha 채널 존재만으로 배경 제거를 판정하면 충분하지 않다는 점을 화면으로 확인했다.

새 `lk-group-logo-transparent.png` 경로를 사용해 최적화 URL을 바꾸고 전 화면의 중앙 로고 참조를 갱신했다. 로컬 QA fixture 다섯 파일의 경로도 함께 바꿨으며 엄격한 URL·쿼리 허용 조건은 그대로 유지했다. 기존 fixture reset 관련 변경은 보존했다. 수정 후 브라우저가 실제 요청하는 형식의 픽셀 투명도와 화면을 다시 확인했고, 흰 사각형과 검은 원형 배경이 제거된 것을 확인했다.

48px 최적화본에서는 리샘플링으로 alpha 1~8의 가장자리 픽셀이 생겨 완전히 투명한 픽셀 비율이 49.2%였다. 최초의 일률적인 50% 기준은 이 표시 크기에서 실패했다. 원본은 완전 투명 픽셀 70% 이상, 최적화본은 alpha 8 이하 픽셀 60% 이상과 모서리 alpha 8 이하로 구분해 검사했다. 최종 실제 브라우저 응답 48~256px의 낮은 alpha 비율은 65.7~80.3%이며 모든 모서리는 alpha 0이었다. 과거 불투명 로고는 이 검사에서 통과할 수 없다.

## 검증

- 파일 검사: 원본 alpha 없음 / 선택본 alpha 있음. 선택본의 약 74.5% 픽셀이 완전히 투명하며 중앙 빈 공간 alpha는 0이다.
- 최종 `npm run check`: 새 경로·fixture 수정 후 lint·타입·Production build 통과.
- 관련 fixture 테스트: 두 파일의 **3개 검사 통과**, 실패 0. 새 이미지 경로 허용과 기존 API/불필요한 쿼리 접근 제한 확인.
- 실제 브라우저: 시스템 Chrome의 별도 Playwright 세션. 로컬 Production 서버에서 홈·KCP·견적, 1440/393px의 **6개 조합 모두 통과**. API는 읽기 전용 가상 응답으로 처리하며 저장·제출·외부 요청을 차단했다.
- 이미지 decode·실제 alpha 픽셀·공통 favicon·가로 넘침 없음·브라우저 실행 오류 없음 확인. 최종 헤더 스크린샷을 저장하고 실제 화면에서 로고 배경 제거를 확인했다. 최초 캐시 문제가 있던 증거는 최종 재검증 결과로 교체했다.
- 계획의 로컬 참조 링크와 `git diff --check` 통과. 관련 브라우저 서버는 검증 뒤 종료했다.

최종 결과·헤더 이미지는 [증거 폴더](2026-10-13-home-plan-logo/)의 `results.json`과 화면별 PNG에 기록한다. 새로운 메인 UI·새 metadata·다섯 카드·Coming soon의 실제 동작 인수는 아직 실행하지 않았다. 연락 수단의 실제 전화 발신·메일 전송·실물 휴대폰 터치·운영 배포·검색 색인도 이번 검사에 포함하지 않는다.
