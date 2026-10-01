# 회사 자료·메인 SEO 반영 검증

2026-10-01 사용자 요청으로 확인용 스크린샷을 삭제했다. 아래 텍스트 검증 기록은 보존한다.

2026-09-27 · [회사 자료](../reference-assets/company-brief.md) · 로컬 production preview `http://127.0.0.1:3002/`

## 반영 내용

- 메인 슬로건·회사 소개·네 서비스·경력·별도 부스 공정·21개 suburb와 Inner West 지역 안내.
- Lisa 전화·이메일·영업시간·답변 안내·Instagram, 공개 locality·사업자명·ABN·licence.
- 실제 회사 로고 PDF에서 렌더링한 헤더·favicon, 회사 홍보 이미지, 표면 보수·분사 도장 사진 2장. 원본 보존, 출처는 [자산 기록](../prototype-assets.md).
- 메인 고유 title/description, H1 1개, 본문 구조와 내부 링크, 페이지별 OG/Twitter 텍스트 메타정보.
- Cabinet의 이전 연락·지역·제품·공정/기간 문구 정합성 수정. 연락 영역 링크 추가, 온라인 Free Quote는 계속 비활성.
- README·결정표·TODO·관련 설계와 자료 수령 상태 갱신. 현재 공개 가격표로 확정되지 않은 홍보물은 참조 폴더에만 보관.

## 코드 검사

Sol xhigh 구현 담당이 회사 자료 반영 후 `npm run check`를 통과했다. 이후 작업 중 추가된 실제 로고·사진까지 반영하고 **최종 소스 기준 `npm run check`를 다시 통과**했다: ESLint, Next typegen/TypeScript, Webpack production build. 메인 담당이 소스 차이와 실제 브라우저를 별도로 검토했다.

메인 담당의 추가 정적 점검: 변경 문서 9개의 로컬 링크 누락 0개, `git diff --check` 통과. 최종 빌드의 메인·Cabinet HTML 두 파일을 직접 파싱해 H1 각각 1개, 고유 OG title, noindex와 사업자/지역 본문의 서버 HTML 포함을 확인했다. 앱 동작 검증과 문서 링크 검증은 별개다.

샌드박스 내 로컬 포트 실행은 EPERM으로 실패했고, 허용된 로컬 실행으로 3002 서버를 시작했다. 최신 이미지 반영 빌드 후 이 작업 소유의 서버만 재시작했다. 다른 3000·3001 서버는 조작하지 않았다. shell의 localhost HTTP 조회도 샌드박스에서 제한됐으며 그 실패를 성공으로 기록하지 않는다. 실제 화면·DOM 검증은 앱 브라우저에서 수행했다.

## 실제 브라우저 확인

| 확인 항목 | 결과 |
| --- | --- |
| 1440px 메인 | 네 카드, 로고 128px, 회사 소개 이미지, 지역 묶음, 갤러리 표시 확인; 가로 넘침 없음 |
| 768px 메인 | 두 열 카드, 로고 104px; 가로 넘침 없음 |
| 390·320px 메인 | 한 열 카드, 로고 96px; 긴 제목·이메일·사진·지역 포함 전체 문서 가로 넘침 없음 |
| 회사 이미지 | 최종 메인 이미지 4개 모두 로딩 확인. About은 전체 비율, 갤러리는 4:5 표시 영역, 실제 원본에 없는 보정 없음 |
| 모바일 메뉴 | 열기·닫기, Escape 후 메뉴 버튼 포커스, Contact Enter 후 메뉴 닫힘·연락 섹션 포커스 확인. 실제 로고 교체 후에도 메뉴/연락 이동 재확인 |
| 연락 | 전화 `tel:+61404603966`, 이메일 `mailto:Lnkpaintingau@gmail.com`, Instagram 주소 일치. Tab으로 전화 링크 포커스 확인 |
| 내부 이동 | 메인 About/Gallery/Contact 앵커, Cabinet 상세 링크와 Contact Lisa → 메인 연락 영역 왕복 확인; 대상 없는 앵커 없음 |
| Cabinet | 320px 가로 넘침 없음, FAQ Enter 열림, H1 1개, 온라인 견적 버튼 2개 비활성, 폼 없음 |
| SEO DOM | `en-AU`, 고유 title/description, 각 페이지 H1 1개, 서로 다른 OG title, `noindex, nofollow`, 운영 canonical 없음 |
| 콘솔 | 확인한 브라우저 세션의 warn/error 없음 |

전화 발신·메일 전송·실제 고객 문의 접수는 시험하지 않았다. 이미지 추가 전 통과한 Escape·FAQ 등의 동작과 변경된 로고/갤러리의 재검증을 구분했다. 브라우저의 native FAQ는 `summary` 요소로 확인한 뒤 Enter 동작을 검사했다.

## 아직 완료가 아닌 항목

- 운영 배포·도메인·회사 계정 연결, 공개 승인과 색인 활성화.
- canonical·sitemap·사업체 구조화 데이터, Search Console 등록·노출/클릭/색인 측정.
- Lighthouse·실사용자 Core Web Vitals 정량 측정, 검색 순위 효과 검증.
- 사진별 현장 설명·전후 짝·후기, 현행 공개 가격표·보증 상세.
- 온라인 견적·업로드·AI·예약·인보이스·결제.
