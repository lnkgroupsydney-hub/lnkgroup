# KCP 사진형 Hero·7단계 공정 로컬 검증

2026-10-01 사용자 요청으로 확인용 스크린샷을 삭제했다. 아래 텍스트 검증 기록은 보존한다.

2026-09-28 · 브랜치: codex/scroll-storytelling-design · 최종 코드 기준, 문서 작성·실제 앱 검증을 구분한다.

## 결과와 범위

**기록한 로컬 검증 범위 통과.** 메인은 기존 b33cad6 프로토타입 구성과 본문을 유지한다. KCP 상세에 사진형 Hero, 전체 화면 7단계 공정, 공정 우선 목차를 적용했다. 공용 전역 토큰·로컬 Manrope·버튼·컨테이너·ServiceStory를 재사용한다.

- 프로덕션 미리보기: http://127.0.0.1:3002/services/cabinet-painting
- 홈 프로토타입: http://127.0.0.1:3002
- 기존 3001 서버는 변경하지 않았다. 커밋·push·공개 배포·외부 계정 연결을 수행하지 않았다.
- 계획/판정/QA는 Astra xhigh, 앱 코드 구현은 Sol xhigh로 분담했다.

## 코드 검사

최종 수정 후 npm run check를 실행해 ESLint(경고 0), Next typegen 및 tsc --noEmit, optimized Webpack production build가 통과했다. 홈과 KCP가 정적 prerender됐고 production 서버에서 양쪽 HTTP 200을 확인했다. git diff --check 통과.

독립 코드 감사에서 단일 H1·서버 HTML·앵커·정적 대체 경로·noindex·native disabled 견적 및 상태 보존 코드를 확인했고 추가 P1/P2 회귀를 찾지 못했다. 문구를 복제하는 테스트는 추가하지 않았다.

## 실제 브라우저 검증

Codex in-app browser에서 로컬 dev 검수 후 production 3002로 최종 확인했다.

| 항목 | 실제 결과 |
| --- | --- |
| 승인 시안 비교 | v5 원본과 최종 1492×1054 화면을 같은 비교 이미지로 확인. 전체 사진·greige veil·slate type·큰 2줄 제목·원형 로고·pill CTA 유지. KCP 전용 문구·Breadcrumb·실제 연락 링크로 변경 |
| 첫 화면 | 1492×1054에서 Hero 높이 1054px, H1 하나, Manrope computed family, 가로 overflow 없음 |
| 전체 화면 공정 | 1440×900, 1024×768에서 사진이 viewport를 채우고 도어/서랍 분리·재조립, 준비/언더코트/마감 reveal 표시 |
| 1차/2차 마감 | Finish 단계 progress 0.3805 → 0.7078에서 Finish 01 → Finish 02; 역스크롤 시 0.3805로 복귀 |
| 정적 보기 전환 | 실제 보이는 toggle을 pointer로 클릭. Finish 단계 top 31.8359 → 31.6484px로 유지 |
| 정적 보기 resize | 1024×768 → 768×900에서 Finish 단계 top 31.6484 → 31.875px 유지 |
| 하단 resize | Quote 영역에서 768 → 1440 전환 후 Quote 유지, story로 끌려가지 않음 |
| 모바일 | 390×844, 320×640에서 가로 overflow 없음, 제목·버튼·본문 표시. 768×900 정적 경로 확인 |
| 짧은 가로 화면 | 844×390에서 pin/motion 없이 7개 정적 figure와 본문 유지 |
| 메뉴 | 390px에서 열기, Escape 닫기, Open menu로 focus 복귀 확인 |
| 내부 이동 | Home → KCP → Home, View process, 단계 링크·직접 fragment 접근, Skip → Services 확인. Skip 후 Services에 focus |
| 목차/SEO | 기존 8개 목차 hash 대상 모두 존재, KCP H1 하나, 기존 소개·범위·서비스·지역·FAQ 유지, noindex/nofollow 확인 |
| FAQ | 가격 FAQ pointer 열기·Space 닫기 확인 |
| 견적·연락 | 모든 Free Quote native disabled. 기존 회사 전화/이메일 href 확인; 실제 발신·전송은 하지 않음 |
| JavaScript 차단 | 로컬 QA proxy 3003의 script-src none에서 7개 정적 figure·본문·H1·noindex 유지. 서버 HTML을 실제 브라우저로 읽음 |
| 이미지·폰트 실패 | QA proxy 3004에서 story 이미지와 WOFF 요청에 404를 반환. Visual unavailable, 본문·단계 이동·Skip 유지. 가로 overflow 없음 |
| 콘솔 | 새 production 탭의 모바일·데스크톱·재조립·홈 왕복 후 error/warn 기록 없음. 의도적 실패 proxy의 404/CSP 로그는 정상 앱 오류와 구분 |

개발 서버에는 숨겨진 다음 장면 preload 이미지의 fill/sizes=100vw 성능 권고가 기록됐다. 최종 production 탭에는 오류/경고가 없었다. 실제 장면을 viewport 크기로 표시하기 위한 동일 이미지 후보 사전 로딩이며, 정량 전송량 최적화 검증은 아래 대기다.

## 발견한 문제와 수정

1. Manrope 변수가 body에 있어 root 토큰이 Arial로 fallback되던 문제: 변수 클래스를 html에 연결하고 computed font 재확인.
2. 긴 Hero 본문으로 첫 화면 하단이 밀리던 문제: KCP 첫 화면에 짧은 소개 사용, 기존 SEO 전체 소개·범위는 바로 아래에 보존. 최종 Hero 1054px 확인.
3. 투명 부품 생성 결과가 고정 프레임을 포함하거나 좌표가 어긋남: 실행 자산에서 제외하고 원본 사진의 7개 도어/서랍 영역을 clip-path로 사용.
4. 다음 레이어 로딩 중 빈 무대: 준비된 해당 단계 poster를 유지하고 실패 시 대체 문구 표시.
5. 정적 전환·화면 폭 변경 시 읽던 위치 이동: overflow-anchor 제어와 마지막 단계 위치 캐시, story 밖 캐시 해제. 실측 재검증.
6. 본문과 고정 공정 표기의 겹침: cinematic copy를 viewport 상하 안전 영역에서 clip. 1024px 주석이 rail과 겹치던 위치도 조정.
7. 모바일 사진이 주로 통로를 보여 주던 crop: 오른쪽 cabinet을 중심으로 89% 위치 조정.

## 파일·스크린샷

중간 검수와 최종 검수의 결과는 위 실행 기록으로 구분한다.

## 미완료·미수행 항목

- 손잡이는 문짝 사진과 함께 움직인다. 손잡이·힌지의 독립 탈거/조립과 모든 실제 부품을 보여 주는 3D 설계 연출은 구현하지 않았다.
- 실제 기기의 OS reduced-motion 변경은 실행하지 않았다. 해당 media query와 정적 경로를 코드 감사했고 모바일/짧은 화면/수동 정적 모드는 실제 확인했다.
- 실제 iOS/Android·Firefox·Safari, 실제 touch/trackpad, 200% 브라우저 확대·보조공학 전체 감사는 미수행.
- 느린 네트워크 정량 측정, Lighthouse, LCP/CLS/INP·메모리·긴 작업·전체 전송량 측정은 미수행.
- 새 WebP 9개 합계 1,100,816 B와 폰트 24,576 B는 디스크 파일 합계이며 실제 브라우저 전송량이 아니다.
- 생성 사진은 실제 시공 전후 증거가 아니다. 정확한 공정/범위/가격/일정과 실제 프로젝트 사진은 회사 확인 대상으로 유지한다.
- 견적 제출·사진 업로드·AI·예약·결제·인보이스, 운영 도메인·공개 색인·클라우드 배포는 이번 범위에 없다.
