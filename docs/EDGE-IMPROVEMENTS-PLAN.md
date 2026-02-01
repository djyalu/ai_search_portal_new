# 개선 제안서: Edge 전환 이후 안정화/성능/품질 고도화

작성일: 2026-02-01
대상: AI Search Portal (Multi-GPT Analyzer)
범위: 수집 안정화, 성능, 품질, 운영 안정성

## 1) 현상 요약
- Edge 채널 전환 후 Gemini/ChatGPT/Claude 수집 안정화 확인.
- Perplexity 응답 길이가 짧게 수집되는 케이스 존재(정상 판정은 됨).
- 최종 합성(Polish) 단계는 안정 동작.

## 2) 개선 목표
1. 모든 에이전트 응답 품질의 하한선 확보(짧은 응답/노이즈 최소화)
2. 수집 속도 개선(초기 전송 지연 및 수집 대기 시간 단축)
3. 장애/타임아웃 시 자동 복구 및 재시도 강건화
4. 운영 관측성 개선(원인 추적 가능 수준)

## 3) 개선 아이디어 (우선순위 포함)

### A. Perplexity 응답 길이 안정화 (P1)
- 증상: 최종 수집 문자열이 30~50자 수준으로 짧게 종료되는 경우 발생
- 원인 가설: 응답 루트 선택 불일치 + 스트리밍 종료 판정이 과도하게 빠름
- 개선안:
  1) Perplexity 전용 응답 셀렉터 우선순위 재정렬
  2) 최소 수집 길이 하한(예: 120자) 적용
  3) 최종 확정 조건에 “문장 종결부(마침표/줄바꿈)” 검증 추가

### B. Gemini 응답 캡처 안정화 고도화 (P1)
- 증상: 특정 UI 상태에서 응답 텍스트가 모델 컨테이너에 렌더링되기 전 수집 종료
- 개선안:
  1) `model-response-text` 필수 대기(이미 추가됨) + Stable Count 4~5로 상향
  2) Gemini 전용 “모델 응답 완료” 판단: STOP 버튼 사라짐 + 응답 노드 존재
  3) Gemini 전용 “짧은 응답 재질의” 1회 자동 재전송

### C. 공통 수집 안정화: 단계별 재시도 룰 (P1)
- 개선안:
  1) dispatch 실패 → 동일 탭 재시도 1회
  2) collect 실패 → 동일 탭 재시도 1회
  3) 최종 실패 시만 `Error`로 확정

### D. 성능 개선: 초기 전송 지연 단축 (P2)
- 개선안:
  1) warm-up 탭 선로딩(이미 도입됨) + 사전 로그인 상태 검증
  2) 퍼플렉시티 계획 단계는 timeout 15초 상한 적용
  3) Perplexity 계획 단계 실패 시 즉시 Agency 시작

### E. 관측성/디버깅 개선 (P2)
- 개선안:
  1) 각 에이전트별 `dispatch_time`, `collect_time` 로그 추가
  2) 실패 사유 표준화: `timeout`, `noisy`, `short`, `selector_missing`
  3) 실패 시 HTML/스크린샷 저장 + 파일명에 이유 포함

## 4) 코드 구현 방안 (주요 변경점)

### 4.1 Perplexity 전용 수집 강화
- 대상: `server/playwright_handler.js`
- 변경 내용:
  - Perplexity용 응답 셀렉터 우선순위 재정의
  - `minLength` 기준 상향
  - “완성도 체크” 룰 추가

예시 패치 (요약)
- `getResponseRoot('perplexity')`에서 `.prose` 우선
- `minLength`를 Perplexity만 120으로 조정
- `isCompleteResponse()` 함수 추가

### 4.2 Gemini 전용 완료 조건 추가
- 대상: `server/playwright_handler.js`
- 변경 내용:
  - Gemini 완료 조건에 `Stop 버튼 없음` + `model-response-text 존재` 추가
  - 응답 길이가 30자 미만이면 1회 자동 재전송

### 4.3 공통 재시도 룰
- 대상: `collectResult` 로직
- 변경 내용:
  - `noisy_output` / `short_output` 발생 시 1회 재시도
  - 재시도 후 실패 시 `Error` 확정

### 4.4 로그 필드 구조화
- 대상: `server/playwright_handler.js`
- 변경 내용:
  - `logInternal` 호출에 `phase`, `agent`, `elapsed_ms` 추가
  - 실패 시 JSON 형태 로그 기록

## 5) 구현 우선순위 및 일정

- 1차 (P1): A, B, C 반영
- 2차 (P2): D, E 반영

## 6) 기대 효과
- Perplexity 응답 길이 안정화
- Gemini/ChatGPT/Claude 안정성 유지 + 재시도 성공률 향상
- 운영 장애 원인 파악 시간 단축

## 7) 적용 후 검증 체크리스트
- [ ] `verify_all.js` 3회 연속 성공
- [ ] Perplexity 평균 응답 길이 120자 이상
- [ ] Gemini 응답 0 chars 재발 없음
- [ ] 실패 로그에 원인 코드 포함

---

## 부록: 코드 변경 체크리스트
- [ ] `server/playwright_handler.js` 수정
- [ ] `server.log` 확인 후 시간/에이전트별 분포 검토
- [ ] `verify_all.js` 재실행
