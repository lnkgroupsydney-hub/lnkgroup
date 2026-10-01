# 메인 프로토타입 검증 기록

2026-10-01 사용자 요청으로 확인용 스크린샷을 삭제했다. 아래 텍스트 검증 기록은 보존한다.

2026-09-27 · 로컬 작업 · 클라우드 배포·DB 검증과 구분한다. 현재 문서는 작업 진행에 따라 갱신한다.

## 단계 2 — 프로젝트 생성

구현: `gpt-6-sol / xhigh` 서브에이전트를 명시해 실행. 메인 채팅 모델을 자동 변경했다고 주장하지 않는다. 기존 문서·산출물 변경은 보존했으며 커밋·push는 하지 않았다.

| 항목 | 결과·근거 |
| --- | --- |
| 환경 | Node v24.14.1, npm 11.11.0 |
| 주요 버전 | Next·eslint-config-next 16.3.6, React 19.3.0, Tailwind 4.3.3, TypeScript 6.0.3, ESLint 9.39.5 |
| 설치 | lockfile 저장, 설치 시 npm audit 취약점 0건 — 일반 보안 감사 완료를 뜻하지 않음 |
| lint | `npm run lint` 통과 — 구현 에이전트 실행 결과 |
| 타입 | `npm run typecheck` 통과 — 구현 에이전트 실행 결과 |
| 빌드 | `npm run build -- --webpack` production build 통과, 이후 기본 build·dev에 Webpack 옵션 반영 |
| HTTP | 로컬 production `/` 200, header `X-Robots-Tag: noindex, nofollow` 확인 |
| 실제 브라우저 | 메인 에이전트가 Codex 브라우저에서 기본 앱 제목·본문 렌더링 확인 |
| 브라우저 SEO | `en-AU`, H1 1개, robots `noindex, nofollow`, canonical 없음 확인 |
| 브라우저 콘솔 | 수집된 error·warn 0건 |
| CI | 파일 생성·공식 action 릴리스 확인, GitHub 원격 실행은 미수행 |

초기 Turbopack production 빌드는 CSS PostCSS worker의 포트 바인딩 권한 오류로 실패했다. 권한 승인 재시도에서도 동일했으며 Next.js의 공식 Webpack 빌드 경로로 해결했다. 테스트를 삭제하거나 실패를 무시한 것이 아니다. Turbopack 자체의 해당 환경 호환은 미해결이며 현재 프로젝트는 통과한 Webpack 경로를 사용한다.

ESLint 최신 major는 Next 공식 preset의 포함 플러그인 peer 범위와 맞지 않았다. peer 조건을 우회하지 않고 호환되는 ESLint 9·TypeScript 6.0을 고정했다. ESLint 9의 upstream 지원 종료 경고는 남아 있으므로 공개 전 preset 호환·지원 상태를 재검토한다. 현재 lint 오류나 확인된 npm 취약점으로 보고하지 않는다.

공식 근거: [Next.js 설치·빌드 옵션](https://nextjs.org/docs/app/getting-started/installation), [checkout 릴리스](https://github.com/actions/checkout/releases), [setup-node 릴리스](https://github.com/actions/setup-node/releases).

## 단계 3 — 화면 제작·검증

**프로토타입 범위 통과.** Sol xhigh 구현 후 `npm run check`의 lint·타입·production build가 모두 통과했다. `lucide-react` 1.48.0을 추가했고 설치 audit은 취약점 0건이었다. 메인 에이전트는 갱신한 production 서버를 실제 Codex 브라우저에서 별도로 점검했다.

| 확인 항목 | 실제 결과 |
| --- | --- |
| 1440×1000 | 서비스 카드 4열, 카드 높이 모두 430px, 가로 넘침 없음 |
| 768×1024 | 카드 2열, 가로 넘침 없음 |
| 390×844·320×740 | 카드 1열, 헤더·버튼·본문·갤러리 가로 넘침 없음 |
| 메뉴·CTA | Home·About·Services·Gallery·Contact 및 서비스 버튼 4개의 목적지 일치 |
| 모바일 메뉴 | 펼침·닫힘·aria-expanded 정상, Escape로 닫힌 뒤 트리거 포커스 복원 |
| 키보드 | 메뉴 Enter 열기 → Tab으로 Home·About 이동 → Enter 선택 시 About으로 포커스·해시 이동, 메뉴 닫힘 |
| Skip link | Enter 활성화 시 main-content로 해시·포커스 이동 |
| 링크 | 존재하지 않는 fragment 대상 0개, Back to top 정상 |
| 이미지 | 워드마크·주방·거실 모두 로드 완료, 컨셉 이미지 안내 확인 |
| SEO | H1 1개, `en-AU`, noindex 유지, 허위 canonical 없음 |
| 연락 상태 | 미확정 tel·mailto 0개, 문의 접수 불가 안내 확인 |
| 브라우저 콘솔 | 테스트 기간에 수집한 error·warn 0건 |
| 구조 검토 | app의 공개 모듈 조합, 순수 TS 서비스 도메인, 로컬 콘텐츠 분리, UI·자산 설정 분리 확인 |

화면 폭은 브라우저 viewport 설정값이다. 실제 DOM clientWidth는 세로 스크롤바 15px를 제외한 1425·753·375·305px이며 각각 scrollWidth와 동일했다. 기기 에뮬레이션 폭 검사이며 실제 iPhone·Android 기기 검증은 아니다.

증거: 데스크톱, 모바일, 전체 페이지. 첫 데스크톱 캡처에서 로고 최적화 응답을 기다리는 상태가 보였으나 로드 완료 후 정상 표시를 확인하고 최종 증거를 저장했다.

정량 Lighthouse·axe 자동 검사, 스크린리더 전체 감사, 실사용자 Core Web Vitals, 원격 GitHub CI는 실행하지 않았다. 따라서 전체 접근성 인증·운영 성능·CI 성공을 주장하지 않는다. 최종 디자인 적용은 아직 하지 않았으며 색상·서체·레이아웃 변경 후 관련 항목을 다시 확인한다.

## 외부 의존성

Vercel·Supabase 회사 계정 승인, 실제 전화·이메일, 운영 도메인, 실제 시공 사진은 대기다. 문의 저장·이메일 발송·전화 연결·DB 권한·운영 배포·검색 순위·실사용자 성능은 검증하지 않았다.
