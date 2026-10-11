# AI 수량 추정·현장 확인 전 가견적 검증

2026-10-11 · Australia/Sydney · `codex/ai-quantity-estimates-20261011`

## 구현과 정책

사용자 결정에 따라 고객이 문·서랍 수량을 비워 두거나 AI 관찰값과 다르게 입력해도, 사진으로 합리적인 수량을 추정할 수 있으면 예상 도장 금액을 계산한다. 고객 입력값과 직접 관찰값은 덮어쓰지 않는다. `cabinet-photo-analysis-v2` / `cabinet-observations-v3` / `lk-sydney-cabinet-v2-20261011` 계약을 사용한다.

기준 전체 전면 사진과 같은 범위의 사진만 수량 근거로 사용하며 상충 사진을 더하지 않는다. 부분 범위는 `primary_view`로 표시한다. 최종 수량·상태·가격은 현장 확인 대상이고, 미산정 구조·심한 보수·미선택 표면을 0원이나 포함 금액으로 표시하지 않는다. 기존 v1 결과와 가격 대기 이력은 유지한다.

## 로컬 검증

- `npm run test:operations`: **524/524 통과**, 실패·생략 0.
- 격리된 production 소스에서 `npm run check`: lint·타입·Webpack 빌드 통과. 기존 로컬 3002 서버의 `.next`는 유지했다.
- 합성 문 12개·서랍 4개: A$2,200 + GST A$220 = A$2,420. 선택된 문/서랍의 중간 도막 보수는 한 번만 가산한다.
- 같은 사진의 패널·미분류 표면·미선택 서랍 손상은 A$250을 가산하지 않는다. SQL의 제외항목 고정 문구·표면/범위 enum·가격 변조 거절, 고객/EMS 공용 결과 및 v1/v2 동시 복원을 검증했다.
- 검토에서 발견한 SQL/서버 제외 문구 불일치와 선택되지 않은 표면 가산 조건을 수정했다. 두 수정의 읽기 전용 재검토에서 추가 문제는 발견하지 못했다.

## 회사 DB

회사 Chrome `Kang (L&K Group)`의 `xlqyafthsxallostcqfe` SQL Editor에서 신규 `20261011020822_live_quote_ai_quantity_pricing_v2.sql`을 적용했다. 화면의 `Success. No rows returned`와 서버 전용 helper 호출 성공·익명 42501을 확인했다. 두 사진 bucket은 비공개다.

적용 파일 SHA256: `0c8941fb3c0a006f281309a025bdecc91f569f91e3801d93693c03e1a9261c5f`.

기존 세 테스트 요청의 분석 3건은 적용 전 fingerprint를 저장해 일치 여부를 확인했다. 운영 DB migration 이력 도구와 Dashboard 실행은 구분한다.

## 운영 배포와 실제 사진 인수

회사 Vercel Production `dpl_FgjBEwxhuz17b5A4pUVWq4FAMUK7`가 **READY**이고 `https://lnkgroup.vercel.app` 별칭에 적용됐다. `gpt-6.1-sol` / medium으로 각 세트의 전체·상부·하부·측면·손상 5장, 총 15장을 다시 분석했다. Mac worker는 꺼 둔 상태로 Vercel `after()`가 처리했으며 별도 `/process` 호출은 없다.

| 세트 | AI 추정 문 | AI 추정 서랍 | 소계 (GST 별도) | GST | 예상 도장 금액 (GST 포함) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 14 | 6 | A$2,700 | A$270 | **A$2,970** |
| 2 | 21 | 6 | A$3,750 | A$375 | **A$4,125** |
| 3 | 12 | 4 | A$2,200 | A$220 | **A$2,420** |

세 요청의 고객 입력 수량은 계속 null이다. 모두 `provisional_estimate`, `primary_view`, `painting_only`, `siteConfirmationRequired: true`로 저장됐다. 다른 사진의 배치·마감이 기준 전면과 일치하지 않아 추가 수량과 손상비는 합산하지 않았다. 별도 손상과 미촬영 캐비넷은 `unverified_damage_scope` / `unseen_cabinetry` 미산정 항목으로 표시했다. 세 세트 모두 근거가 연결되지 않은 손상에 A$250을 붙이지 않았다.

- **세트 1:** `RQ-5AF76DCCF72D42DB93A55C24390AACC5`, job `5b515f2c-f299-49be-a73d-270ad35e1f3e`, revision 10. 회사 Chrome에서 저장된 5장 복원 → 분석 동의/실행 → 분석 중 새로고침 → 숫자 결과 → EMS의 같은 5장/수량/금액을 확인했다. 완료 후 새로고침도 같은 결과를 복원했다.
- **세트 2:** `RQ-B8D7AF1773614454B5223365F5593945`, job `b22b79a9-b15f-42f6-a2e5-dfc1a3e34268`, revision 6. 기존 자체 테스트 세션의 고객 API로 5장을 재분석하고, 회사 Chrome EMS에서 21문/6서랍/A$4,125를 확인했다.
- **세트 3:** `RQ-C7C4D66CE924479CA119C3A89F01B6AB`, job `4f4de66d-b6e1-4cff-abed-0e1fa0f266d5`, revision 6. 같은 고객 API 검증 후 회사 Chrome EMS에서 12문/4서랍/A$2,420를 확인했다.
- Supabase의 저장 analysis/pricing/usage와 고객 API 결과가 일치한다. 세 새 작업 모두 attempts=1, provider response ID 존재. 기존 v1 분석 3건의 fingerprint는 동일하다. 개인 브라우저에는 접근하지 않았다.
- 같은 idempotency key의 POST는 **최초 queued 응답을 재생**한다. 처음 하네스가 이 응답을 최종 succeeded 결과와 직접 비교해 실패했다. 기존 receipt 계약을 확인해 ‘같은 job ID → 후속 GET의 최종 결과 동일성 → 작업 수 증가 없음’으로 검증을 수정했고 통과했다. 앱 오류나 추가 유료 재분석은 아니었다.
- 독립적인 전면 사진 육안 대조 범위는 문 13–15/20–22/11–13, 서랍 6/6/4였다. AI 결과는 이 범위 안이지만 생성 예시의 모호한 경계·잘림 때문에 실측 정확도로 주장하지 않는다.
- 저장된 token 요율에 따른 호출 비용 추정은 각각 USD 0.0447276 / 0.0506900 / 0.0461716이다. 청구서 확정 금액이 아니라 기록된 사용량 기반 추정이다.

소스 브랜치는 `codex/ai-quantity-estimates-20261011`이다. 이번 main 병합·원격 push는 수행하지 않았으며 배포 상태와 Git main 상태를 구분한다. 테스트 입력 사진과 로컬 쿠키/영수증은 커밋·공개 배포 파일에서 제외했다.

## 남은 범위

실제 현장 확정 수량·회사 최종 견적 수정/버전 발행(RQ-04c), 고객 재동의, 일반 고객 이메일 확인·정식 약관/서명·예약은 후속이다. 이번 예상 금액을 계약·예약 확정으로 바꾸지 않는다. 생성 예시 사진의 숫자는 실측 정확도나 Sydney 시장 평균의 검증이 아니다.
