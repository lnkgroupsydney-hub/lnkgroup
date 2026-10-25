# R3b 검증 증거 — integrator fix1-final round a (2026-10-22)

최상위 파일은 **integrator round 1 지적 수정 후** 조정자가 샌드박스 밖에서 실행한 최종 결과다. 수정 전 P3 최종 round 2와 구분한다.

- 저장소 lint·typecheck: 종료 0. test:operations: **984/984**, 실패·skip 0 (최종 repo-a2 로그).
- 격리 check(빌드 포함)·준비 검사: 종료 0.
- Chrome **R3b 6/6·R3a 11/11·R1 13/13·R2 20/20**, 실패·skip 0.
- [R3b 결과](results.json) · [게이트 상태](status.json) · [조정자 handshake](handshake-fix1-final.json).
- [관리자 회사본 1440](admin-company-1440.png): 원본 subtotal/GST/total, 회사본 No GST, 적용 중 금액.
- [고객 수락 320](customer-accepted-320.png): 실제 /quote/start의 수락 상태. GST 비교 셀은 펼친 내용에서 별도 단언했으며 이 이미지는 상단 수락 요약을 담는다.
- [예약 확정 차단](confirmation-blocked.png).

JSON·이미지는 `fix1-final/gates-rounda/`의 실제 바이트를 그대로 복사했다. 원본과 SHA-256이 같다. native modal dialog contract(lead 결정 B)와 기존 단언을 유지했고 미시도 notice의 cancelled/revision_withdrawn·발송 기록 0도 검사했다.

아래는 **과거 이력이며 현재 최종 결과가 아니다**.

- [history-p3-round2](history-p3-round2/): 수정 전 P3 최종 969/969·R3b 6/6, 2026-10-22 재부팅 후 재실행 증거. 당시 필수 화면·게이트·두 handshake JSON을 보존했다.
- `coordinator-run2/`: 재부팅 전 초기 fixture/runner 실패.
- `history-run3/`: 재부팅 전 5/6 JSON.
- `followup2-round1/`: P3 첫 라운드 5/6의 노출 버튼 좌표 검사 실패.
- `gate-attempt.json`: 최초 Codex listen EPERM.

남은 경미 항목: 회사본이 없으면 Amount in effect는 Booking 탭을 안내하며, 원본 GST 0 분기는 코드·단위 시험만 있고 screenshot은 없다. 실제 회사 DB·메일·OTP 고객 수락·운영 배포 증거는 아니다. [검증 범위·수정·판정](../2026-10-21-ems-r3b.md)을 따른다.
