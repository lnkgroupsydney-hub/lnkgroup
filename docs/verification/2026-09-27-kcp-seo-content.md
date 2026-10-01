# KCP SEO 콘텐츠 개정 검증

2026-10-01 사용자 요청으로 확인용 스크린샷을 삭제했다. 아래 텍스트 검증 기록은 보존한다.

2026-09-27 · 브랜치 `codex/kcp-page-prototype` · [명세](../plans/19-kcp-seo-content-and-service-area.md)

## 구현·문서 범위

- 지역을 반영한 고유 title/description, H1 1개, H2/H3 본문 구조.
- 6개 서비스, 3개 재질/상태 안내, 포함·제외 범위, 5개 작업 단계, 21개 주변 suburb의 3개 지역 묶음, 컨셉 사례, 8개 FAQ.
- 상단 초안 안내와 9개 섹션의 `Draft — company confirmation required`, 구체적 `[Company to confirm: …]` 교체 항목.
- 기존 컨셉 이미지 2개 재사용. 실적·후기·가격·연락처를 조작하지 않음. 신규 제조·설치 제외 명시.
- 견적 버튼 2개는 native disabled. 폼·업로드·AI·예약·결제 기능 없음.

## 코드 검사

구현 담당 Sol xhigh 에이전트가 변경 후 `npm run check`를 실행했다. ESLint 경고 0개, Next typegen/TypeScript, production Webpack build 통과. 메인 담당은 실제 브라우저와 HTTP 응답을 별도로 확인했다. 이후 코드 수정 없이 문서·지도 조사 기록만 마무리했다. Git diff 공백 검사도 통과했다.

로컬 production preview: `http://127.0.0.1:3001/services/cabinet-painting`. 이번 작업 소유의 3001 서버만 재시작했으며 기존 3000 프로세스는 유지했다.

## 실제 브라우저 검증

Codex in-app browser에서 변경 후 서버를 다시 불러와 검사했다. 초기 숨겨진 탭에서 일부 포인터/뷰포트 적용이 즉시 반영되지 않아 해당 측정은 폐기하고 로컬 미리보기 탭을 활성화한 뒤 다시 확인했다.

| 검사 | 관찰 결과 |
| --- | --- |
| 1440px | 서비스 3열, 영역 배치·이미지·본문 정상, 가로 넘침 없음 |
| 768px | 서비스 2열, 본문 줄바꿈 정상, 가로 넘침 없음 |
| 390px | 서비스 1열, 모바일 헤더·초안 안내·H1 정상, 가로 넘침 없음 |
| 320px | 서비스 1열, 좁은 화면의 서비스·지역 본문 확인, 가로 넘침 없음 |
| 페이지 내 이동 | 8개 링크를 Enter로 실행, 각 hash와 대상 섹션 포커스 일치. Service area 포인터 클릭도 확인 |
| FAQ | 8개 모두 Enter 열기·Space 닫기로 native details 상태 변경 확인 |
| 모바일 메뉴 | 포인터 열기/닫기, Escape 닫기, `aria-expanded=false`와 토글 포커스 복귀 확인 |
| 홈 왕복 | 모바일 Services → 홈 `/#services` 및 포커스 이동 → Kitchen Cabinet Painting 제목 링크 → 상세 진입 |
| 접근성 | Skip to content → `main-content` 포커스, Back to top → 상단 이동 확인 |
| 이미지 | 두 컨셉 이미지 모두 로드, 대체텍스트·크기·컨셉 고지 확인 |
| 콘솔 | 검사 탭에서 수집된 error/warn 없음 |

검사 종료 시 임시 뷰포트를 해제하고 KCP 페이지 상단을 사용자 미리보기로 유지했다.

## HTTP·SEO 확인

별도 Node fetch로 3001의 production 응답을 확인했다.

- HTTP 200, `X-Robots-Tag: noindex, nofollow`.
- HTML meta robots도 `noindex, nofollow`.
- title `Kitchen Cabinet Painting in Ermington | L&K Group — Preview`.
- 서버 HTML에 H1·지역 본문·임시 확인 문구와 native details 8개 존재.
- 브라우저에서 meta description, H1 1개, 초안 라벨 9개, disabled quote 2개, form 0개, 본문에 이전 15km 값이 없음을 확인.
- canonical·sitemap·구조화 데이터·색인 활성화·검색 순위 측정은 이번 결과에 포함하지 않음.

## 지도 조사와 미확정 사항

Google Maps 실제 검색 결과와 사용자 `working area.png`를 함께 검토했다. 최종 대표 기준점은 Ermington suburb 검색 결과이며 회사 주소가 아니다. 초기 우편번호 대표점과 혼동하지 않도록 [조사 JSON](../research/2026-09-27-kcp-service-area.json)에 구분하고 거리값을 다시 계산했다. 지점 간 직선거리 계산은 행정구역 전체 또는 개별 주소의 서비스 가능 여부를 검증한 것이 아니다.

사용자가 정한 10km 반경으로 콘텐츠를 구성했으며 정확한 회사 기준점·경계 주소·실제 운영 가능 여부는 확인 대기다. Drummoyne와 Lane Cove는 개별 주소 확인 안내로 분리했다. Ashfield·Chatswood·Sydney CBD·North Sydney는 주 서비스 지역 목록에 넣지 않았다.

회사 확정 자료 교체, 실제 작업 사진, 최종 디자인, 공개 도메인·회사 계정 연결 및 문의/예약 기능은 미완료 의존성으로 유지한다. Search Console, 실제 색인·검색 노출, 지도 API 또는 주소 제한 동작을 시험했다고 주장하지 않는다.

## 후속 피드백: 섹션 이동 글자 확대

같은 날짜 사용자 화면 피드백으로 `On this page` 항목을 18px/20px semibold, 최소 48px 높이와 넓은 간격으로 변경했다. 구현 담당이 변경 후 `npm run check`와 `git diff --check`를 통과하고 로컬 3001 production preview를 갱신했다.

메인 담당 실제 브라우저 확인: 기본 1696px에서 20px 글자·8개 항목 한 줄, 320px에서 18px 글자·두 항목씩 줄바꿈, 모두 가로 넘침 없음. Included scope 포인터 클릭과 FAQs Enter 실행 시 해당 hash·섹션 포커스 이동 확인. 콘솔 error/warn 없음. 임시 뷰포트는 해제했다.
