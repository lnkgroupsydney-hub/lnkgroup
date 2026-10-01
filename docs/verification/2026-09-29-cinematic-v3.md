# Cinematic KCP v3 — 로컬 검증

2026-09-29 · 사용자 제공 24개 항목 디자인 프롬프트 적용. 범위는 KCP 상세이며 메인은 서비스 소개 프로토타입이다. [구현 계획](../plans/24-cinematic-kitchen-webgl.md).

## 구현

- 사진 Hero와 새 제목, 따뜻한 neutral/sage 텍스트 토큰, 큰 섹션 링크.
- 실제 Three.js WebGL 모델: 검사·분해·세척·국소 패치/샌딩·마스킹·프라이머·두 마감 코트·건조/경화·재조립. 같은 기하의 절대 progress로 순방향/역방향을 계산한다.
- 모델은 사진을 참고한 파라메트릭 건축 컨셉이다. 실측 CAD/GLB, 실사 사진과 정확히 일치하는 재구성, 실제 시공 기록은 아니다.
- 전후 비교는 생성 사진 2개와 range/포인터 드래그. 색상 쇼룸은 6색 + 사용자 색상, 3광택을 로컬 모델에 반영한다.
- 기존 6개 서비스·적합성·포함/제외·지역·FAQ·회사 연락 정보 유지. Free Quote/업로드 비활성, 저장/전송/AI/예약/결제 없음.

## 코드 및 소스 검토

최종 source 수정 뒤 `npm run check`의 lint → Next typegen/TypeScript → Webpack production build가 모두 exit 0으로 통과했다([최종 로그](2026-09-29-cinematic-v3/check.log)). 해당 빌드를 포트 3002에서 실행해 마지막 수정도 확인했다. 에이전트 독립 소스 검토에서는 가역 timeline, 렌더러 초기화/실패 처리, 자원 해제, 로딩/상태 전환, 비교 입력을 검토했다.

순수 timeline 검증: 잘못된/범위 밖 입력 제한, 시작의 미도장·조립 상태, 끝의 도장·재조립·마스킹 해제, 같은 progress 입력의 결정성을 확인했다. 이는 브라우저 렌더링 성능 검사와 다르다.

## 실제 브라우저 확인

Codex 내장 Chromium에서 로컬 production URL을 확인했다. viewport는 1280×720, 390×844, 320×740을 사용했다.

- Hero H1 1개, noindex/nofollow, 첫 화면의 주 CTA 보임. 가로 넘침 없음.
- 9개 공정 링크를 키보드로 이동: 각 hash·단계 표시 일치, WebGL canvas 렌더 및 사진 대체 해제 확인. 보수와 마감 장면 확대 확인.
- 전후 비교 이미지 드래그: 50→78%; 키보드 Home/End: 0/100%.
- Deep Green / Semi-gloss 선택 후 모델·선택 라벨 확인. 사용자 색 `#806e58` 입력 후 Custom Colour 라벨 확인.
- 모바일: 공정 9단계 + 완료 사진/본문, canvas 없음, 메뉴 열기/Escape 닫기, FAQ Enter 열기, 18px 섹션 내비게이션.
- 320px에서 가로 넘침/오른쪽 화면 밖 요소 없음. 모든 `#` 내부 링크 대상 존재.
- Contact Lisa로 메인 `/#contact` 이동, 회사 제공 전화/이메일 링크 존재. 메인 H1·프로토타입 레이아웃 보존 확인. 실제 전화/메일 발송은 하지 않았다.
- 포트3003 로컬 CSP fixture에서 JavaScript 차단: 정적 10개 장면/H1/마스킹 사진 로드 확인.
- 포트3004 로컬 fixture에서 WebGL context 생성을 실패시킴: 초기 사진에서 `3D unavailable` 정적 10개 장면으로 전환, canvas 0개, Prepare 위치 유지(top 60.7px), console error/warn 없음. 첫 fixture의 잘못된 개행 삽입은 수정 후 재확인했으며 실패한 초기 실행을 통과로 계산하지 않았다. 검증 후 임시 프록시 종료.
- 최종 빌드의 직접 `#cabinet-process-prepare` 진입과 Static view → Return to 3D story: 04 Prepare, 해당 장면 top -0.4px 및 focus 유지. 아래로 1.1 화면 스크롤 시 05 Protect, 역스크롤 시 04 Prepare 복귀.
- FAQ에서 1280→768px 전환 시 공정으로 강제 이동하지 않으며 FAQ/견적 영역에 머묾. 태블릿 정적 공정·가로 넘침 없음 확인. 브라우저 크기 설정은 검증 후 원복했다.
- 최종 확인한 production 흐름의 console error/warn 없음.

## 발견 후 수정

- Hero 제목 과대 크기로 CTA가 화면 밖에 위치 → 제목/보조 구절 크기와 여백 조정.
- 3D 과노출·뒤집힌 펜던트·노출된 배경판 경계 → 조명/재질·기하·공간 크기 수정.
- Next/Three 최신 버전의 PCFSoftShadowMap 경고 → 지원하는 PCFShadowMap 사용.
- 셰이커 문짝을 실제 recessed panel/rails로 변경, 내부 선반·퍼티 위치·완료 재질 보완.
- native 이미지 drag가 비교 컨트롤 방해 → 이미지 기본 drag 비활성 및 포인터 끝 위치 반영.
- 사용자 색 input 이벤트 미반영 → input/change 이벤트 모두 지원.
- WebGL mount/해제 때 준비 상태, 수동 정적 전환·직접 hash의 레이아웃 변경 위치 복원을 보완.
- 작은 sage 텍스트 대비 → 전용 `#52614e` 사용. 단색 대비 paper5.75:1/cream6.22:1; 전체 사진 합성 대비의 계측 결과는 아니다.

## 최종 판정

**통과 — 명시한 로컬 구현·브라우저 검증 범위.** 발견한 기능·표시 오류를 수정하고 해당 흐름을 다시 확인했다. TODO의 이번 디자인·상호작용·로컬 검증 항목을 완료 처리했다.

실제 모바일 기기·OS 모션 감소 설정·Lighthouse/LCP/CLS/INP·60fps/메모리 정량 측정은 하지 않았다. 태블릿/모바일에는 사진 중심 경량 구성을 사용하며, 색상/광택은 시각 예시로 실제 견본을 대신하지 않는다. 공개 배포·운영 도메인·구조화 데이터/색인 활성화는 별도 대기다.

검증 스크린샷은 2026-10-01 사용자 요청으로 삭제했고 텍스트·빌드 로그를 보존한다. [생성 자산/프롬프트 기록](../design-assets/cabinet-cinematic-v3/manifest.json).
