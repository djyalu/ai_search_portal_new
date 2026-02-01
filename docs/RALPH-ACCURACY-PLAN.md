# 정확도/할루시네이션 제거 목적의 RALPH 설계 제안서

작성일: 2026-02-01
대상: AI Search Portal (Multi‑GPT Analyzer)
목표: 정확도 강화 + 할루시네이션 최소화 + 수집 안정성 확보

---

## 1) 결론 요약
- 정확성과 할루시네이션 제거가 목적이라면 **RALPH 파이프라인은 유지가 필수**
- 단, **R(Reasoning)은 축소**, **L(Logic)은 강화**하여 정확도와 속도 균형 확보
- 최근 “에이전트별 검색 결과 수집 불가(send_failed)” 문제는 **검증 로직 누락 + UI 상태(스트리밍 중)**가 핵심 원인이며, 이미 수정 방향을 반영함

---

## 2) RALPH 운영 설계(정확도 우선 최적화)

### 2.1 R(Reasoning) – 최소화
- 목적: 과도한 지연 제거
- 전략:
  - Reasoning 결과 캐시 (TTL 적용)
  - 타임아웃 5~8초 제한
  - 실패 시 기본 전략으로 즉시 폴백

### 2.2 A(Agency) – 유지/강화
- 목적: 다중 시각 확보, 편향 최소화
- 전략:
  - 에이전트 수집 병렬 유지
  - 전송/수집 안정성 로직 강화

### 2.3 L(Logic) – 강화 (핵심)
- 목적: 할루시네이션 제거, 합의/불일치 검증
- 전략:
  - 합의 수준(High/Med/Low) 분류
  - 숫자/확률/비율은 원문 근거 없으면 “추정” 표기
  - Executive Summary는 High 합의만 허용

### 2.4 P(Polish) – 템플릿 고정
- 목적: 구조화 출력 + 재현성
- 전략:
  - 표준 ReportSchema 기반 출력
  - 고정 섹션: 커버/요약/인사이트/합의/시나리오/리스크/액션

---

## 3) 최근 “수집 실패(send_failed)” 문제 원인/해결

### 3.1 원인 요약
- **핵심 원인**: `checkGenerationStarted` 함수 누락 → 전송 검증이 항상 실패
- **보조 원인**: 기존 스트리밍(Stop 버튼) 상태에서 재전송 시도 → 전송 실패
- **UI 변경**: ChatGPT 도메인/입력 셀렉터 변경

### 3.2 적용된 해결 방안
- `checkGenerationStarted` 복구
- 전송 전 `waitForNotGenerating()` 추가
- ChatGPT URL `chatgpt.com`으로 갱신
- ChatGPT/Gemini 입력 셀렉터 보강

### 3.3 추가 개선(권장)
- send_failed 시 자동 스냅샷/HTML 저장 (이미 적용)
- Perplexity/Gemini `short_output` 기준 재조정

---

## 4) 남은 개선 과제

### 4.1 Perplexity `short_output` 개선
- 문제: 응답 길이가 짧아 정상 응답도 실패 처리
- 개선안:
  - Perplexity minLength 120 → 80~100으로 조정
  - 문장 종결/문단 기반 완료 조건 추가

### 4.2 Gemini `short_output` 개선
- 문제: 짧은 응답 케이스에서 불필요 재시도
- 개선안:
  - short_output 시 5~8초 추가 대기 후 1회 재시도

---

## 5) 코드 변경 요약 (핵심)

### 5.1 전송 검증 복구
- `checkGenerationStarted` 복원
- `waitForNotGenerating` 추가

### 5.2 URL/셀렉터 업데이트
- ChatGPT URL: `https://chatgpt.com`
- 입력 셀렉터: `#prompt-textarea`, `div[role="textbox"]`, `rich-textarea .ql-editor`

### 5.3 실패 디버깅 강화
- `debug_*_dispatch_failed_*.png/html` 자동 저장

---

## 6) 권장 실행 순서
1) RALPH 유지 + L(Logic) 강화 설계 확정
2) short_output 정책 조정 적용
3) verify_all.js 3회 연속 성공 확인

---

## 7) 검증 체크리스트
- [ ] send_failed 재발 없음
- [ ] Gemini/ChatGPT/Claude 수집 성공률 95% 이상
- [ ] Perplexity short_output 발생률 10% 이하
- [ ] Executive Summary에 Low 신뢰도 포함 없음

---

## 8) 다음 액션 제안
- L(Logic) 단계 복원 + 검증 룰 구현
- short_output 정책 조정 패치 적용
- 성능/정확도 균형 지표 대시보드 추가

