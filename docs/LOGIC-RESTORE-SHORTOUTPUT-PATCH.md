# 추가 제안: L(Logic) 단계 복원 + short_output 정책 조정

작성일: 2026-02-01
대상: AI Search Portal (Multi‑GPT Analyzer)
목표: 정확도 강화(할루시네이션 제거) + 수집 안정성 개선

---

## 1) 배경
- 현재 정확도 우선 목표에 맞춰 **L(Logic) 단계 복원** 필요
- 수집 안정성 저하 요인 중 하나가 **short_output 과도 판정**

---

## 2) L(Logic) 단계 복원 설계

### 2.1 목적
- 다중 에이전트 간 **합의/불일치** 구조화
- 수치/비율 검증으로 **할루시네이션 제거**
- Executive Summary는 High 합의만 사용

### 2.2 처리 흐름
1) A(Agency) 결과 수집
2) L(Logic) 검증 보고서 생성
3) P(Polish) 합성 시 검증 보고서를 반영

### 2.3 출력 규격 (요약)
- 합의/불일치 매트릭스
- 수치 검증 결과
- High/Med/Low 등급화

---

## 3) short_output 정책 조정

### 3.1 문제
- Perplexity/Gemini에서 정상 응답도 `short_output`으로 실패 처리
- 재시도로 인해 처리 시간이 증가

### 3.2 개선 방향
- 에이전트별 최소 길이 기준 조정
- **문장 종결 + 길이 조합**으로 “완성도” 판정
- Gemini는 `short_output` 발생 시 **추가 대기 후 1회 재시도**

---

## 4) 코드 패치 범위 (요약)

### 4.1 L(Logic) 복원
- 대상: `server/playwright_handler.js`
- 변경점:
  - Logic 단계 재활성화
  - Logic 전용 프롬프트/응답 처리 복원
  - Logic 결과를 최종 합성에 반영

### 4.2 short_output 정책 조정
- 대상: `server/playwright_handler.js`
- 변경점:
  - Perplexity `minLength` 120 → 80~100
  - Gemini `short_output` 시 5~8초 추가 대기 + 1회 재시도
  - “문장 종결 + 길이 조건”으로 완료 판정

---

## 5) 코드 패치 계획 (실행 단계)

### Step 1: L(Logic) 단계 복원
- 기존 `validationPrompt` 및 `validationReport` 로직 복구
- `validationId` 선택 로직 재활성화
- `finalPrompt`에 validation 결과 포함

### Step 2: short_output 정책 개선
- `minLength` 조정
- `isCompleteResponse()` 추가
- Gemini 전용 `short_output` 처리 분기 추가

### Step 3: 검증
- `verify_all.js` 3회 연속 성공
- `short_output` 발생률 감소 확인

---

## 6) 기대 효과
- 합의 기반 요약으로 정확도 향상
- 할루시네이션 제거율 상승
- 불필요 재시도 감소로 속도 개선

---

## 7) 적용 체크리스트
- [ ] Logic 단계 복원 완료
- [ ] short_output 정책 반영
- [ ] 3회 연속 검증 통과
- [ ] 에이전트별 수집 안정성 개선 확인

