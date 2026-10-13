# 메인페이지 브라우저 주석 반영·이미지 생성

2026-10-13 · `codex/lk-group-home-ui-ux-20261013` · 로컬 미리보기 `http://127.0.0.1:3026/`.

## 반영 결과

| 사용자 태그 | 변경 |
| --- | --- |
| 10km 직접 언급 제거 | Hero·지역 본문·반경 배지에서 숫자 언급 제거. 공용 지역 표시도 Ermington·인근 지역·Inner West Sydney로 정리 |
| 캐비넷 중심 사진 구역 변경 | `#gallery`를 다섯 서비스·상품의 생성 이미지와 짧은 제공 내용으로 변경. 데스크톱 서비스 3개·상품 2개, 태블릿 2열, 모바일 1열 |
| 그룹에 맞는 배경 | 생활 공간·주방·다이닝을 함께 담은 생성 배경. 모든 화면 폭에서 표시하며 그라데이션으로 본문 대비 확보 |
| 로고 바깥 흰색만 제거 | 검정 원과 금색 요소를 유지한 PNG 사용. 헤더·푸터·KCP·견적·favicon이 중앙 자산을 참조 |
| 이메일 | 표시와 mailto를 `lnkgroupsydney@gmail.com`으로 수정 |
| 연락 가능 시간 | `7 days a week · 7:00am–5:00pm (Sydney time)` |
| Group 브랜딩 | 메인·공용 푸터 표시를 `L&K Group`으로 통일. 기존 ABN·licence 값과 내부 사업자 원본 필드는 보존 |

상단 빠른 서비스 요약과 아래 이미지 설명 구역 모두 준비 중 네 항목에 링크·버튼·클릭/키보드 핸들러를 추가하지 않았다. 기존 Cabinet 상세 링크는 상단 요약 카드에 유지한다. 업무 ServiceId·가격·고객/견적 저장·운영 인증·색인 정책은 변경하지 않았다.

## 생성 자산

내장 `image_gen`으로 생성/편집했다. 서비스별 이미지는 같은 자연광·아이보리/목재/세이지 색감으로 맞췄다. 배경 초기 시안의 공구·페인트 소품은 후속 이미지 편집으로 제거해 식사 공간을 자연스럽게 정리했다. PNG 출력을 내용 편집·리사이즈 없이 WebP quality 84로 인코딩했다.

| 최종 파일 | 크기 | bytes |
| --- | --- | --- |
| `public/images/home/group-home-hero.webp` | 1672×941 | 118,752 |
| `public/images/home/residential-painting.webp` | 1536×1024 | 190,712 |
| `public/images/home/cabinet-painting.webp` | 1536×1024 | 116,352 |
| `public/images/home/handyman.webp` | 1536×1024 | 87,324 |
| `public/images/home/touch-up-kits.webp` | 1536×1024 | 109,794 |
| `public/images/home/kimchi.webp` | 1536×1024 | 167,786 |
| `public/images/lk-group-logo-circle-transparent.png` | 1254×1254 | PNG 원본 alpha 유지 |

최종 프롬프트 세트·생성 원본 경로·선택 여부·프로젝트 파일 매핑은 [image-generation.json](2026-10-13-lk-home-revision/image-generation.json)에 저장했다. 사진 교체 시 중앙 `src/shared/config/assets.ts`의 경로·alt·실제 크기·출처를 함께 갱신한다. 이전 회사 제공 사진과 원본 로고는 보존했다. 새 로고 경로로 기존 최적화 이미지 캐시를 피했으며 기존 두 로고 파일명도 새 결과로 교체했다. 관련 fixture 허용 경로 다섯 파일도 갱신했다.

Hero의 `Illustrative concept`와 이미지 구역의 한 줄 안내로 생성 이미지를 실제 시공 사례나 실제 판매 SKU 사진으로 표현하지 않는다. 김치 제조·원산지·인증·배송 조건 및 키트의 실제 구성·가격은 확정하지 않았다.

## 검증

- 최종 `npm run check`: lint·Next typegen/TypeScript·Production build 통과.
- 관련 fixture 테스트: `node --test scripts/verify-live-quote-fixture.test.mjs scripts/verify-ems-shell-fixture.test.mjs` **3/3 통과**. 새 로고 경로와 기존 접근 제한 유지.
- `node scripts/verify-lk-home-ui.mjs --base=http://127.0.0.1:3026`: **12/12 통과**. 320/393/768/855/1024/1440px, 서버 HTML·JS 없음, 데스크톱 키보드·모바일 메뉴/Escape, reduced-motion와 200% 글자 확대, Cabinet→가상 빈 견적 진입.
- 새 이메일/시간/브랜드·거리 직접 언급 없음, 두 구역 각각 다섯 항목과 네 준비 상태의 비상호작용, 여섯 이미지 decode·설명/컨셉 표시, 단일 H1·metadata·noindex 확인. 콘솔·페이지·실패 로컬 리소스·실제 쓰기 요청 모두 0.
- 원본 alpha: 바깥 모서리 4곳 모두 0, 원 안 검정 표본 `[0,0,0,254]`, 거의 불투명한 검정 픽셀 57.9%. [logo-source.json](2026-10-13-lk-home-revision/logo-source.json).
- 홈·KCP·견적 × 1440/393px **6/6**: 실제 최적화 응답에서도 바깥 모서리 투명/원 안 검정 확인. [logo-browser.json](2026-10-13-lk-home-revision/logo-browser.json).
- 사용자 인앱 브라우저의 기존 홈 탭을 갱신해 새 H1·서비스 이미지·이메일/시간·그룹 푸터가 표시되는 것을 확인하고 탭을 유지했다.
- 저장 화면의 시각 검토: Hero 대비·배경 크롭·그룹 로고·서비스 이미지 의미·반응형 구성 확인. 수치 대비 인증이나 실물 기기 검증과 구분.

브라우저 검사는 새 세션에서 외부 요청과 실제 쓰기를 차단했다. 견적의 자동 session handshake 및 빈 GET 데이터는 브라우저 내 가상 응답이며 실제 저장/제출·메일·Google·AI 처리가 아니다.

긴 gallery 요소 캡처에는 화면 밖의 fixed skip link가 합성되는 촬영 artifact가 나타났다. 제품 CSS를 변경하지 않고 정상 숨김 상태인 `.skip-link:not(:focus)`만 screenshot style에서 숨겼다. 독립 키보드 검사는 focus 시 표시·본문 이동을 그대로 검사한다. 별도 로고 확인의 첫 시도는 견적의 장식용 이미지 `alt=""`를 비어 있지 않은 alt로 찾는 검사 오류로 중단됐으며, 실제 중앙 자산 경로를 기준으로 수정해 6개 조합을 재검증했다.

200% 검사는 root font-size 16→32px인 **글자 확대**다. 실물 휴대폰/Safari·네이티브 브라우저 확대·정량 성능·운영 배포·검색 성과는 이번 인수 범위에 포함하지 않았다. 커밋·푸시·운영 배포는 수행하지 않았다.

## 화면

- [메인 첫 화면](2026-10-13-lk-home-revision/desktop-1440-viewport.png)
- [다섯 서비스 이미지](2026-10-13-lk-home-revision/desktop-1440-gallery.png)
- [855px 배경](2026-10-13-lk-home-revision/tablet-855-hero.png) · [855px 서비스](2026-10-13-lk-home-revision/tablet-855-gallery.png)
- [모바일 첫 화면](2026-10-13-lk-home-revision/mobile-393-viewport.png)
- [전체 검사 결과](2026-10-13-lk-home-revision/results.json)
