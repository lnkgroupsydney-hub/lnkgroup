# KCP 상세 프로토타입 검증 기록

2026-10-01 사용자 요청으로 확인용 스크린샷을 삭제했다. 아래 텍스트 검증 기록은 보존한다.

2026-09-27 · 브랜치 `codex/kcp-page-prototype` · 로컬 production `http://127.0.0.1:3001/services/cabinet-painting`.

**요청한 프로토타입 범위 구현·검증 완료.** 최종 디자인 승인·운영 공개·견적 업무 기능 완료를 뜻하지 않는다. 작업 전부터 있던 문서·산출물·`product.png` 변경을 보존했으며 커밋·push는 하지 않았다. 기존 3000 포트 서버도 유지했다.

## 구현과 코드 검사

`gpt-6-sol / xhigh` 서브에이전트를 명시해 브랜치 생성과 구현을 수행했다. 메인 채팅 모델을 자동 전환했다고 주장하지 않는다. 메인에서 코드 구조·실제 브라우저·HTTP 응답을 별도 확인했다.

| 항목 | 결과 |
| --- | --- |
| 라우트 | `/services/cabinet-painting`, app은 메타데이터·공개 모듈 조립 |
| 메인 연결 | Kitchen Cabinet Painting 제목·Explore CTA 모두 상세 이동, 다른 서비스는 기존 연락 영역 유지 |
| 콘텐츠 | 사용자 선택을 합친 6개 카테고리, 설명·범위 메모·표면 확인 안내·FAQ 3개 |
| Free Quote | 2개 모두 native disabled, 준비 중 설명을 aria-describedby로 연결, 수집 폼·업로드 없음 |
| 이미지 | 기존 주방 컨셉 재사용, 내장 image_gen으로 마감 상세 1장 생성, 중앙 src·alt·크기 관리 |
| lint | 구현 에이전트의 `npm run check` 내 lint 통과, 경고 0 |
| 타입 | 같은 실행의 `next typegen && tsc --noEmit` 통과 |
| 빌드 | 같은 실행의 Webpack production build 통과, KCP 정적 라우트 생성 |
| diff | `git diff --check` 통과 |

새 의존성·테스트 프레임워크는 추가하지 않았다. 문구를 그대로 복제하는 테스트를 만들지 않고 실제 브라우저에서 동작을 확인했다. Git ref 쓰기·로컬 서버 실행/HTTP 접근은 초기 sandbox 권한 오류 후 승인된 재시도로 완료했다. Xcode 라이선스 대리 동의 없이 `/Library/Developer/CommandLineTools/usr/bin/git`을 사용했다.

## 실제 브라우저·HTTP

Codex in-app browser에서 로컬 production 빌드를 검사했다.

| 확인 항목 | 결과·근거 |
| --- | --- |
| 데스크톱 1440×1000 | 좌우 hero, 카테고리 3열×2행. document clientWidth=scrollWidth=1425px |
| 태블릿 768×1024 | 쌓인 hero, 카테고리 2열. clientWidth=scrollWidth=753px |
| 모바일 390×844 | 카테고리 1열, 본문·버튼·이미지 가로 넘침 없음. clientWidth=scrollWidth=375px |
| 작은 모바일 320×740 | 1열, 버튼 줄바꿈, 카드 265px. clientWidth=scrollWidth=305px |
| 메인→상세 | 제목 링크와 Explore CTA를 각각 실제 클릭해 KCP URL·H1 확인 |
| 상세→메인 | 데스크톱 About과 모바일 키보드 About으로 `/#about` 이동·해당 섹션 도착 확인 |
| 공통 메뉴 회귀 | 메인의 모바일 Services 선택 시 `#services`로 포커스·해시 이동하고 메뉴 닫힘 |
| 모바일 키보드 | Enter 열기, Tab으로 Home→About 이동, Enter 선택 정상 |
| Escape | 메뉴 닫힘, aria-expanded=false, Open menu 트리거로 포커스 복원 |
| Skip link | Enter로 `#main-content` 해시·포커스 이동 |
| 서비스 앵커 | View services 클릭으로 `#cabinet-services` 해시·포커스 이동, 상단 여백 24px |
| 상단 이동 | Back to top 클릭으로 현재 KCP의 `#home`, header top=0 확인 |
| FAQ | 첫 질문 클릭으로 답변 표시, Enter로 닫힘, summary 포커스 유지 |
| 링크 구조 | 메인·상세의 존재하지 않는 same-page fragment 0, 상세 메뉴는 `/#...`로 홈 섹션 지정 |
| 이미지 | 로고·hero 로드, 아래로 이동 후 lazy 마감 이미지 포함 3개 모두 naturalWidth>0 |
| HTML/SEO | 브라우저와 직접 HTTP에서 H1 1개·article 6개·서버 본문 6개 설명 확인 |
| 메타데이터 | KCP 전용 title·description, en-AU, robots noindex/nofollow, canonical 없음 |
| HTTP | 200, X-Robots-Tag: noindex, nofollow |
| 미구현 기능 | Free Quote 2개 disabled, form/file input 0, 가격·접수 성공·예약/결제 화면 없음 |
| 콘솔 | 검증 기간 수집된 error·warn 0건 |

폭은 viewport 설정값이며 DOM clientWidth는 세로 스크롤바 15px를 제외한 값이다. 실물 iPhone·Android 검사가 아닌 브라우저 반응형 검사다. 검증 후 임시 viewport override를 해제하고 KCP 탭을 결과물로 열어 두었다.

증거: 데스크톱, 전체 페이지, 모바일.

## 이번에 검증하지 않은 범위

Lighthouse 정량 성능·실사용자 Core Web Vitals·스크린리더 전체 감사·axe·원격 CI는 실행하지 않았다. 전체 접근성 인증이나 검색 순위를 주장하지 않는다.

사진 업로드·AI 손상 분석·정찰제/추가금·예약 날짜 점유·회사 calendar·작업 기간 확정·인보이스·결제는 설계 방향만 기록한 미구현 기능이다. DB·클라우드·외부 서비스·실고객 개인정보를 연결하지 않았다. 최종 디자인, 실제 제공 범위·회사 자료·도메인·공개 승인은 후속 단계다.
