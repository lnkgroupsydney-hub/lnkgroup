# 결정 기록과 근거 자료

## 확정과 제안 구분

| ID | 항목 | 현재 기준 | 상태·결정자·확정 시점 |
| --- | --- | --- | --- |
| D01 | 사업 구성 | 핸디맨·페인팅·캐비넷 페인팅·터치업 키트·김치 | 사용자 확정 2026-09-25 |
| D02 | 작업 지역 | 회사 제공 기준은 Ermington 10km **+ Inner West Sydney**, 명시된 21개 suburb. 전부가 10km 내에 있다는 뜻은 아님. 실제 중심점·주소별 가능 여부 확인 필요; 식품 배송에 자동 적용하지 않음 | 2026-09-27 [회사 답변](../reference-assets/company-brief.md)이 이전 지도 후보/경계 추정보다 우선 |
| D03 | ESN 의미 | ERP·CRM 주문·재고·견적·고객 중심 | 사용자 답변 확정 2026-09-25 |
| D04 | 기술 | Next.js·Supabase Cloud·Vercel로 시작, Docker는 로컬 DB 실행·검증이 필요할 때 선택 사용 | 기본 기술 사용자 확정; Docker 선택 사용은 사용자 확정 2026-09-27 |
| D05 | 김치 운영 | 제조 주체·장소·승인·배치·기한·배송 지역 | 미정 / 식품 책임자·C 구현 전 |
| D06 | 판매 사업자·ABN·GST·계좌·자격·보험 | 회사 제공: LNKPAINTING, ABN 67607948542, Painting licence 354520C. 외부 조회·증빙 검증은 미수행. 홍보물에 보험 문구와 서로 다른 GST 가격 표기가 있으나 현행 적용·증빙·계좌는 미확인 | 2026-09-27 자료 접수; 서비스 청구 전 나머지 항목 확인 |
| D07 | 초기 제작 순서 | 메인 → Cabinet Painting → 회사 관리 웹, 이후 나머지 사업 확장 | 사용자 지정 2026-09-27; 세부 범위는 실행 TODO 제안 |
| D08 | 정찰제 | 포함 범위·단위·시간·원가·추가금 표 | 미정. KCP는 사용자 요청으로 가격 자료 수령 후 진행(D47) / 대표·운영·P5 착수 전 |
| D09 | AI 권한 | 승인 가격표 매핑, 초기 사람 검토, 평가 후 제한 자동화 | 제안 / 대표·QA·C 활성화 전 |
| D10 | 예약금·취소·유효기간 | 계약유형별 예약금, 견적 14일 기본안 | 제안·법적 조건 확인 / 대표·회계 |
| D11 | 키트 SKU | 시안 4종 후보, 30·50병 등 구성 미확정 | 미정 / 상품 담당·B 전 |
| D12 | 결제·청구 | Stripe, 앱 인보이스 기본안, 회계 연동 원본 결정 | 제안 / 회계·A 결제 구현 전 |
| D13 | 영어·한국어 | 영어 우선, C에서 핵심 한국어 | 제안 / 대표·콘텐츠 |
| D14 | 혼합 장바구니 | 키트와 김치 별도 결제, 고객 계정 통합 | 제안 / 대표·B 설계 전 |
| D15 | 도메인·브랜드 | 브랜드 L&K Group, 슬로건 All the Services You Need. 운영 도메인 미제공 | 브랜드는 회사 제공 2026-09-27; 도메인 소유·공개 승인 대기 |
| D16 | 일정·예산 | 메인 3일·Cabinet 소개/문의 약 1주는 기존 목표. 2026-09-30 KCP 전체 흐름은 P0~P8로 진행하고 재사용·자료·승인 확인 후 단계별 산정. 전체 확장 18~24주·850~1,270h는 기존 추정 | 초기 목표 사용자 지정 2026-09-27; KCP 범위 갱신 2026-09-30, 새 납기·예산 미확정 |
| D17 | 복구 목표 | RPO 1시간·RTO 4시간, 옵션·시험 필요 | 제안 / 대표·기술·A 출시 전 |
| D18 | 모델 운영 | 사용자가 모델·effort를 선택하며 업무별 고정 없음. Sol 모델 명시 시 `gpt-6.1-sol` 사용 | 사용자 선택 정책 2026-10-01, Sol 표기 갱신 2026-10-02; 설정 저장과 실제 실행 구분, [13번](13-ai-development-workflow.md) |
| D19 | 회사 관리 웹 재사용 | Coatly에 만든 기능을 대부분 재사용하는 방향 | 사용자 지정 2026-09-27; 실제 재사용 가능 범위·수정량은 구현 전 확인 |
| D20 | 개발자 매출배분 제안 | 웹 유입으로 인정되는 매출의 5%; 그룹 전체 매출 적용 설명은 최종 정정으로 대체 | 사용자 최종 설명 2026-09-27; 계약 체결 확인 아님 |
| D21 | 배분 산정 GST 기준 | 환불 없이 GST 포함 A$1,100 결제 시 배분금 A$55 | 사용자 확인 2026-09-27; 환불·할인·수수료 자체 GST 처리는 미정 |
| D22 | 현재 매출 | 월 약 A$3,000, 웹 유입 인정액 미확인 | 사용자 설명; 기간·회계자료 미검증, AUD 가정 |
| D23 | 개발·운영 비용 부담 | 개발 AI는 개발자, 도메인·서버·운영 AI API 등 회사 비용은 회사에 청구 | 사용자 방침 2026-09-27; 서면 합의·한도·광고비 미정 |
| D24 | 개발·관리·마케팅 보수 | 최소 보수·단계별 개발비·관리비·계약 기간·종료 정산 | 미정; 별도 보수와 투자 상한은 분석상 협상 제안 |
| D25 | 웹 유입 귀속·정산 | 전화·계좌이체·재주문·기존 고객·출처 누락·종료 후 입금·확인 권리 | 미정 / 계약 당사자·회계·CRM 설계 전 |
| D26 | 코드와 인수 권리 | Coatly·공통 모듈·회사 전용 결과물의 소유·사용권·양도·재사용 조건 | 미정; 회사 운영 계정 소유와 코드 IP 양도를 구분 |
| D27 | 최초 착수 | Day 2 메인 화면 우선, 필요한 Day 1 로컬 설정만 선행. 현재 KCP 착수는 D37 참조 | 사용자 지정 2026-09-27, 당시 순서 기록 |
| D28 | 계정 연결 | Google Calendar·외부 연동 회사 계정은 Lnkgroupsydney@gmail.com. 고객 문의 이메일 Lnkpaintingau@gmail.com은 별도 | 사용자 후속 지정 2026-09-30으로 연동 계정 갱신. 실제 접근·연결 검증 미수행, P0 범위·비용/공개 승인 구분 |
| D29 | 개발 구조 | Next.js + TypeScript, 업무별 DDD 모듈, 공개 진입점을 통한 재사용·조립 | 사용자 지정 2026-09-27 |
| D30 | 이번 순서 | 지침 → 프로젝트 생성 → 메인 프로토타입 → 디자인 계획·검토 → 적용 | 사용자 지정 2026-09-27 |
| D31 | 이미지·로고 | 임시 생성 자산을 사용하고 실제 자료가 오면 교체, 실제 실적과 구분 | 생성·교체는 사용자 요청; 표시 기준은 진실성 원칙 |
| D32 | 메인 서비스명 | Kitchen Cabinet Painting | 사용자 정정 2026-09-27; 기존 캐비넷 도장 |
| D33 | 디자인 방향 | 따뜻한 화이트·차콜·유칼립투스 그린, 호주 주거 공간·마감 중심 | 제안; 프로토타입 검토 후 사용자 확인 |
| D34 | 서브에이전트 모델 | 사용자 별도 지정이 없으면 현재 채팅의 모델·effort 상속. Sol 모델 명시 시 `gpt-6.1-sol` 사용 | 사용자 선택 정책 2026-10-01, Sol 표기 갱신 2026-10-02; 기존 업무별 고정 규칙 대체 |
| D35 | 회사 콘텐츠 접수 | [회사 제공 자료](../reference-assets/company-brief.md): 소개·서비스·Lisa 연락처·매일 7am–9pm·24시간 답변·도장 경력 10년 이상·별도 부스 작업. 로고 PDF·메인 홍보 이미지·작업 사진 4장·가격 안내물 3장 수령. 가격/보험 문구의 현행 적용 조건은 확인 필요 | 사용자 제공 2026-09-27; 메인 반영 요청 |
| D36 | Cabinet 공정·보증 | 문/서랍/프레임 도장·손잡이 교체·표면 보수 가능, Dulux Aqua Enamel·색상 선택, 작업/건조 3~7일·재설치 후 7일 주의 사용. 5년 워런티는 상세 조건 미제공 | 회사 제공 내용; 가격·기본 포함 범위·보증 조건 별도 확인 |
| D37 | KCP 견적 기능 목표 | [18번](18-kcp-page-prototype.md)의 서비스·사진 → AI 분석 → 범위·정찰제 가격 → 날짜 요청 → 회사 duration·일정 확정 → 인보이스·결제 전체 흐름 | 사용자 선택 2026-09-30. 이번 요청의 산출물은 순차 계획·TODO이며 구현 완료/외부 연결 승인이 아님 |
| D38 | KCP 실행 순서 | [25번](25-kcp-quote-to-booking-implementation.md) P0 명세/재사용 → P1 로컬 → P2 저장/권한 → P3 최소 관리자/알림 → P4 AI → P5 견적 → P6 일정 → P7 청구/결제 → P8 QA/공개 | 2026-09-30 작성한 구현 계획. 화면 경로·필수값·상태 계약은 P0에서 구체화 |
| D39 | KCP 확정 정책 | 희망일 요청과 확정 예약 구분. 회사가 전체 기간/자원을 검토하고 고객은 최종 견적 조건을 수락. 예약금 필요 시 입금 후 확정, 불필요 시 기간 확보 후 확정·청구 | 상태 구분은 설계 기준. 예약금 여부/액수·점유 만료·취소/재예약·팀 용량의 운영값은 미정 / 회사·회계·P6~P7 활성화 전 |
| D40 | KCP AI·입력 정책 | 고객에게 관찰 손상·강도·설명을 제공하는 것이 목표. 사진/연락처 필수값·보관/처리·제공자/예산·평가/노출 기준을 정하고 가격은 승인 규칙으로 계산 | 전체 AI 흐름은 D37, 세부 처리·비용·노출 정책은 미정 / 회사·개발·P2/P4 실제 처리 전 |
| D41 | Google Calendar 범위 | 예약 날짜·시간·기간·업무 일정과 인보이스 발행 예정/실제 발행·납기·입금 날짜를 자동 표시·갱신 | 사용자 추가 요청 2026-09-30. 기존 ‘외부 Calendar 별도 범위’ 대체. 실제 계정 연결 승인은 별도 |
| D42 | Google 수정 방향 | 양방향 연동, 검증 후 확정. Google 수정은 앱 변경 요청으로 수집하고 충돌·권한·견적·고객 동의 확인 후 반영 | 사용자 선택 답변 2026-09-30. 금액·수락·입금 사실을 Calendar 편집으로 변경하지 않는 상세 계약은 [27](27-kcp-google-calendar-sync.md) |
| D43 | 이번 실행 경계 | P0만 수행: Coatly 코드/migration/테스트 정적 검토·입력/상태/데이터/API·Calendar 명세 | 사용자 지정 2026-09-30. [26](26-kcp-p0-contracts-and-reuse.md) 작성, P1 이후 구현/실행 테스트·실제 연결 미착수 |
| D44 | 자동 날짜 설정의 남은 운영값 | 대상 Calendar ID/공유·자원·근무시간/duration·buffer, 청구 알림·연체 판정 시각 | 근무시간·기간 규칙은 사용자 보류 2026-09-30. 관련 단계 활성화 전 확인, 문의 가능 시간·안내용 3~7일을 자동 산식으로 사용하지 않음 |
| D45 | KCP 최종 인보이스 발행 | 프로젝트 마지막 작업 후 사용자가 앱의 Complete 버튼을 누르면 발행. 개별 공정 완료·일정 종료·Calendar 편집은 발행 조건이 아님 | 사용자 지정 2026-09-30. 권한·청구 조건·중복 방지는 [27](27-kcp-google-calendar-sync.md), 실제 구현 P7 |
| D46 | KCP 최종 인보이스 납기 | 실제 발행일로부터 3일 후. Sydney 날짜 기준 달력일 +3으로 명세하며 주말·공휴일 포함 | 3일은 사용자 지정 2026-09-30; 달력일 해석 명시. 발행 재시도 시 실제 발행일 기준, 알림 시각은 미정 |
| D47 | 정찰제 착수 | Cabinet 가격 자료를 받은 후 정찰제 가격표·계산 진행 | 사용자 보류 2026-09-30. P5 실제 가격·금액 산정은 자료 수령·승인 전 진행하지 않음 |
| D48 | 후속 구현 우선순위 | 디자인 상세는 나중에, 기능 구현과 오류 수정 우선. 이메일→Calendar에 필요한 P1·로컬 저장·관리자·연동부터 연결 | 사용자 후속 요청 2026-09-30. P0만 수행하던 실행 경계를 확대. AI·Resend API는 이후 단계, [28번](28-gmail-enquiry-calendar-implementation.md) |
| D49 | 이메일 연동 의미 | Lnkgroupsydney@gmail.com으로 받은 문의 메일도 자동 수집 | 사용자 선택 2026-09-30. 선택 Gmail 라벨→비공개 문의함→담당자 날짜 검토→미확정 Calendar 제안으로 구현. 자동 답장/발송은 제외 |
| D50 | Google OAuth 준비 | 회사용 클라이언트는 아직 없음, 설정 안내 필요 | 사용자 답변 2026-09-30. 코드·로컬 검증과 실제 계정 OAuth/메일/Calendar 검증은 구분 |

| D52 | 고객 앱 진행 | 고객 정보 선저장 → 서비스·사진 → AI·가격 → approve → 시작일 → 최종 확인·서명·제출 → 최종 견적·서명 계약 이메일 → 회사 Calendar | 사용자 지정 2026-10-02, [32번](32-client-quote-signature-submission.md). approve는 제출/서명/예약 확정과 구분 |
| D53 | 예약 최종 확정 | 서명·제출 후에도 회사가 기간·전체 충돌을 확인한 뒤 확정. 변경 조건은 필요한 고객 재동의 | 사용자 선택 2026-10-02. 근무시간·기간 산식은 보류 유지 |
| D54 | 예약일 선택 차단 | 이미 예약된 날짜는 고객이 선택 불가. 최신 서버 검사, 조회 실패·만료 시 차단, 고객에게 타인 일정 개인정보 미노출 | 사용자 추가 요청 2026-10-02. 실제 날짜 UI는 AI·가격 approve와 가용성 정책 준비 후 연결 |

현재 실행 체크리스트는 [KCP 전체 흐름 P0~P8 TODO](15-home-cabinet-admin-todo.md)다. 기존 문의 접수 중심 제안은 D37의 전체 흐름 목표로 확대됐다. 문의 접수는 중간 단계이며 AI·가격·일정·인보이스·결제를 포함해야 전체 목표가 완료된다. 회사 계정·운영값·공개 승인은 여전히 별도 의존성이다.

상업 조건의 내부 분석은 [웹 유입 매출 5% 계약 검토](16-revenue-share-contract-review.md)에 기록한다. 사용자 설명상의 제안, 사용자 비용 방침, 분석자의 권고를 상대방과 합의된 계약으로 표시하지 않는다.

계획 작성은 위 미정 사항을 제안과 조건으로 표시한 상태에서 완료한다. 결제·가격·식품 등 의존 기능의 실제 출시 전에는 해당 결정이 필요하다. 이후 결정 변경은 날짜·이유·영향 문서·추가 공수와 함께 기록한다.

## 공식 기술 자료

S01~S30은 2026년 9월 25일 조사 기준이며, 계약 검토에 추가한 S31~S32는 2026년 9월 27일 확인했다. 게시 내용과 가격은 구현·가입·출시 시 다시 확인한다. 과거 대화에 있는 AI 답변이나 이미지 시안은 현재 공급자 기능의 공식 근거로 사용하지 않는다.

| ID | 출처 | 계획에서 사용하는 근거 |
| --- | --- | --- |
| S01 | [Next.js 배포](https://nextjs.org/docs/app/getting-started/deploying) | 관리형·자체 배포 방법 |
| S02 | [Supabase 변경 기록](https://supabase.com/changelog.md) | 현재 변경 검토; logs.all 이전 등 구현 시 주의 |
| S03 | [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) | DB 권한·GRANT·행 접근 보호 |
| S04 | [Supabase 백업](https://supabase.com/docs/guides/platform/backups) | DB와 Storage 객체 복구 구분 |
| S05 | [Vercel Docker 배포](https://vercel.com/kb/guide/does-vercel-support-docker-deployments) | OCI 이미지 지원, 함수 실행 모델 |
| S06 | [Vercel Docker Compose](https://vercel.com/i/can-you-run-docker-compose-on-vercel) | 로컬 Compose와 운영 배포 구분 |
| S07 | [Stripe Webhook](https://docs.stripe.com/webhooks) | 서명·중복·역순 이벤트 처리 |
| S08 | [Google Geocoding 정책](https://developers.google.com/maps/documentation/geocoding/policies) | 주소 결과의 저장·표시 조건 |
| S09 | [Google Routes 정책](https://developers.google.com/maps/documentation/routes/policies) | 도로거리 결과의 이용 조건 |
| S10 | [Supabase 가격](https://supabase.com/pricing) | Pro·추가 프로젝트·PITR 비용 확인 |
| S11 | [Vercel 가격](https://vercel.com/pricing) | Pro·좌석·사용량 비용 |
| S12 | [Stripe AU 가격](https://stripe.com/au/pricing) | 결제 수수료와 예정 요금 변경 주석 |
| S13 | [Codex 설정 참조](https://learn.chatgpt.com/docs/config-file/config-reference) | model·model_reasoning_effort |
| S14 | [Codex 고급 설정](https://learn.chatgpt.com/docs/config-file/config-advanced) | 현재 프로필 파일 방식 |

## 호주 사업과 마케팅 자료

| ID | 출처 | 반영 항목 |
| --- | --- | --- |
| S15 | [NSW Painting work](https://www.nsw.gov.au/business-and-economy/licences-and-credentials/building-and-trade-licences-and-registrations/painting-work) | 페인팅 자격 검토 |
| S16 | [NSW 주거공사 계약](https://www.nsw.gov.au/housing-and-construction/building-or-renovating-a-home/preparing/contracts) | 계약·예약금·작업 조건 |
| S17 | [NSW 식품 사업 시작](https://www.foodauthority.nsw.gov.au/industry/starting-a-food-business) | 제조·판매 형태별 절차 |
| S18 | [가정 기반 식품 사업](https://www.foodauthority.nsw.gov.au/retail/home-based-mixed-businesses) | council·Food Authority 및 식품 표시 |
| S19 | [FSANZ 식품 표시](https://www.foodstandards.gov.au/business/labelling) | 라벨·설명·표시 검토 |
| S20 | [FSANZ 알레르겐](https://www.foodstandards.gov.au/consumer/labelling/allergen-labelling) | 알레르겐 명시 |
| S21 | [ATO GST 회계](https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/accounting-for-gst-in-your-business) | GST·회계 연결 검토 |
| S22 | [ATO Tax invoices 자료](https://www.ato.gov.au/api/public/content/0-1e92db95-a75c-4f4e-a3d4-39f43b1a3b25) | 인보이스 필수 정보 |
| S23 | [OAIC 소규모 사업](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/small-business) | 개인정보법 적용 범위 검토 |
| S24 | [ACMA 스팸 방지](https://www.acma.gov.au/avoid-sending-spam) | 수신동의·철회·발신자 표시 |
| S25 | [ACCC 가격 표시](https://www.accc.gov.au/business/pricing/price-displays) | 소비자 총가격·추가 비용 |
| S26 | [ACCC 소비자 보장](https://www.accc.gov.au/consumers/buying-products-and-services/consumer-rights-and-guarantees) | 반품·결함·서비스 보장 |
| S27 | [Google Business Profile 지침](https://support.google.com/business/answer/3038177?hl=en) | 실제 사업과 서비스 지역의 프로필 |
| S28 | [Google 검색 스팸 정책](https://developers.google.com/search/docs/essentials/spam-policies) | 지역명 복제 페이지·허위 콘텐츠 방지 |
| S29 | [Jim's Handyman Sydney](https://jimshandyman.com.au/locations/new-south-wales/sydney-handyman/) | 서비스 랜딩 참고, 성과 추정 없음 |
| S30 | [Kimchi Club 배송](https://kimchiclub.com.au/shipping-information/) | 제한된 식품 배송 안내 참고 |
| S31 | [호주 정부 계약 작성 안내](https://business.gov.au/people/contractors/prepare-a-contract) | 업무·지급·비용·IP·변경·종료 조항, 2026-09-27 확인 |
| S32 | [호주 정부 계약 협상 안내](https://business.gov.au/people/contractors/negotiate-a-contract) | 상업 조건의 명확화와 문서화, 2026-09-27 확인 |

## 구현 시 다시 확인할 변경 사항

Supabase 변경 기록에서 관리 API logs.all 제거, 자체 호스팅 게이트웨이 변경, realtime 스키마 수정 제한 등을 확인했다. 이번에는 API 호출이나 자체 호스팅을 구현하지 않으므로 해당 변경을 적용했다고 기록하지 않는다. 실제 구현에서는 사용하는 기능의 최신 문서를 다시 확인한다.

외부 데이터 출처의 가격·법적 조건과 이 문서의 자체 공수·마케팅 가설을 섞지 않는다. 견적 산식 예제, A$100~140 시간당 가정, 전환율·광고 예산은 프로젝트 계획자가 산정한 예시다.
