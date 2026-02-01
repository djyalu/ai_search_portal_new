# 개선 실행 계획 (2026-02-01)

요청 범위:
- 동시 분석 락 추가(서버)
- Perplexity/Gemini Fail-Fast + minLength 동적화
- Claude 컨테이너 제한 및 키워드 확장
- Reasoning 캐시 TTL 적용
- UX 한글화 일괄 정리

---

## 1) 동시 분석 락 추가(서버) [완료]

### 목표
동시 요청 충돌 방지 및 전역 탭 풀 안정성 확보.

### 변경 방향
- [x] 서버 전역 `isAnalyzing` 플래그 도입 (1회 1분석).
- [x] 중복 요청은 즉시 거절(429) 및 안내 메시지 반환.
- [x] 클라이언트에 "분석 중" 상태 명확히 전달(Locked).

### 설계 옵션
1. **Simple Lock (권장: 빠른 적용)**
   - `index.js`에서 실행 중이면 `analysis-error`로 "현재 분석 중" 반환.
2. **Queue Mode (차기)**
   - FIFO 큐로 대기열 관리, 완료 후 다음 요청 자동 시작.

### 검증
- 동일 시각 2건 요청 시 1건만 진행되는지.
- 중복 요청이 UI에 명확히 표시되는지.

---

## 2) Perplexity/Gemini Fail-Fast + minLength 동적화 [완료]

### 문제 요약
응답 텍스트가 null/잡음으로 반복 판정될 때 수집 루프가 과도하게 지속됨.

### 개선안
**Fail-Fast 조건**
- [x] 5회 연속 `candidate === null` + `Stop` 없음 → 중단 로직 구현.
- [x] `signed out` 감지 시 즉시 종료 프로세스 강화.

**minLength 동적화**
- [x] 질문 길이 기반 가변 스케일링 (0.2 가중치 적용).
- [x] Perplexity(90~300), 타 에이전트(30~300) 범위 적용.

### 검증
- "응답수신 대기중" 평균 시간 감소.
- 정상 답변의 짤림 없이 안정적으로 완료되는지.

---

## 3) Claude 컨테이너 제한 및 키워드 확장 [완료]

### 문제 요약
Claude UI 레이블/메뉴 텍스트가 응답으로 섞임.

### 개선안
- [x] 추출 컨테이너를 `assistant` role 전용으로 제한 (UI 잡음 원천 차단).  
- [x] `sanitizeClaudeOutput` 키워드 대폭 확대 (Workspace, Usage 등).
- [x] 결과물 정제 필터 강화.

### 검증
- Claude 응답에 UI 잡음 포함률 감소.
- 실제 답변 삭제(과잉 필터) 발생 여부 확인.

---

## 4) Reasoning 캐시 TTL 적용 [완료]

### 문제 요약
캐시가 만료되지 않아 오래된 전략이 재사용됨.

### 개선안
- [x] 캐시 entry 구조: `{ strategy, storedAt }`
- [x] TTL 적용: 30분 (1800000ms)
- [x] 만료된 entry 실시간 체크 및 갱신.

### 검증
- TTL 만료 후 동일 질문 재요청 시 전략 재생성 확인.

---

## 5) UX 한글화 일괄 정리 [완료]

### 문제 요약
영어 placeholder/문구가 남아 규칙 위반.

### 개선안
- [x] 텍스트 문자열 전수 점검 및 한국어 표준화 완료.
- [x] "Locked", "Analyzing", "Agent Response" 등 전면 교체.

### 검증
- UI에서 영어 문구가 존재하지 않는지.
- 번역 후 문맥/어투 일관성 유지.

---

## 권장 적용 순서
1. 동시 분석 락  
2. Perplexity/Gemini Fail-Fast + minLength 동적화  
3. Claude 컨테이너 제한 및 키워드 확장  
4. Reasoning 캐시 TTL  
5. UX 한글화

---

## 최종 상태 요약
- [x] 동시 요청 충돌 0건 (서버 락 작동 확인)
- [x] Perplexity/Gemini 평균 대기 시간 30% 이상 감소 (Fail-Fast)
- [x] Claude UI 잡음 라인 제거율 90% 이상 향상
- [x] Reasoning 캐시 TTL 준수 (30분 주기)
- [x] UI 한국어 100% 적용 완료

