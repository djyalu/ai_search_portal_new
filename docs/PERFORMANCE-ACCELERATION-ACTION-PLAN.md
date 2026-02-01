# 개선 실행 계획 (2026-02-01)

요청 범위:
- 동시 분석 락 추가(서버)
- Perplexity/Gemini Fail-Fast + minLength 동적화
- Claude 컨테이너 제한 및 키워드 확장
- Reasoning 캐시 TTL 적용
- UX 한글화 일괄 정리

---

## 1) 동시 분석 락 추가(서버)

### 목표
동시 요청 충돌 방지 및 전역 탭 풀 안정성 확보.

### 변경 방향
- 서버 전역 `isAnalyzing` 플래그 도입 (1회 1분석).
- 중복 요청은 즉시 거절(429) 또는 대기 큐 처리.
- 클라이언트에 "분석 중" 상태 명확히 전달.

### 설계 옵션
1. **Simple Lock (권장: 빠른 적용)**
   - `index.js`에서 실행 중이면 `analysis-error`로 "현재 분석 중" 반환.
2. **Queue Mode (차기)**
   - FIFO 큐로 대기열 관리, 완료 후 다음 요청 자동 시작.

### 검증
- 동일 시각 2건 요청 시 1건만 진행되는지.
- 중복 요청이 UI에 명확히 표시되는지.

---

## 2) Perplexity/Gemini Fail-Fast + minLength 동적화

### 문제 요약
응답 텍스트가 null/잡음으로 반복 판정될 때 수집 루프가 과도하게 지속됨.

### 개선안
**Fail-Fast 조건**
- N회(예: 5회) 연속 `candidate === null` + `Stop` 없음 → 중단.
- `signed out` 감지 시 즉시 종료(재시도 금지).

**minLength 동적화**
- 질문 길이 기반 스케일링:
  - 짧은 질문 → minLength 낮춤
  - 긴 질문 → minLength 높임
- Gemini/Perplexity 별로 최소/최대 범위 설정.

### 검증
- "응답수신 대기중" 평균 시간 감소.
- 정상 답변의 짤림 없이 안정적으로 완료되는지.

---

## 3) Claude 컨테이너 제한 및 키워드 확장

### 문제 요약
Claude UI 레이블/메뉴 텍스트가 응답으로 섞임.

### 개선안
- 추출 컨테이너를 assistant role 전용으로 제한.  
- `sanitizeClaudeOutput` 키워드 확대(Artifacts/Projects/Workspace/Usage 등).
- short-line 비율 + UI 키워드 복합 판정으로 noisy 처리 강화.

### 검증
- Claude 응답에 UI 잡음 포함률 감소.
- 실제 답변 삭제(과잉 필터) 발생 여부 확인.

---

## 4) Reasoning 캐시 TTL 적용

### 문제 요약
캐시가 만료되지 않아 오래된 전략이 재사용됨.

### 개선안
- 캐시 entry 구조:
  - `{ value, storedAt }`
- TTL 적용:
  - 예: 30분 또는 1시간
- 만료된 entry는 즉시 제거.

### 검증
- TTL 만료 후 동일 질문 재요청 시 전략 재생성 확인.

---

## 5) UX 한글화 일괄 정리

### 문제 요약
영어 placeholder/문구가 남아 규칙 위반.

### 개선안
- 텍스트 문자열 전수 점검 및 한국어화.
- UI 텍스트 상수화(한글 리소스 파일로 분리).

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

## 완료 기준
- 동시 요청 충돌 0건
- Perplexity/Gemini 평균 대기 시간 유의미 감소
- Claude UI 잡음 라인 제거율 향상
- Reasoning 캐시가 TTL 준수
- UI 한국어 100% 유지

