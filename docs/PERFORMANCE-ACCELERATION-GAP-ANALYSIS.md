# 갭 원인분석 및 개선방안 (2026-02-01)

대상: AI Search Portal (Multi-GPT Analyzer)  
범위: 성능 가속 계획(Performance Acceleration Plan) 대비 구현 갭 + Perplexity/Gemini 지연 + Claude 정제 이슈

---

## 1) 핵심 갭: 원인분석 & 개선방안

### G1. 동시 분석 락 부재 (Multi-Client Race)
**원인**
- `globalContext` / `globalPagePool`가 전역 공유되어 동시 요청 시 탭 재사용이 섞일 수 있음.  
- 서버는 요청별 락(세션 큐) 없이 `start-analysis`를 즉시 실행.  
- 결과: 프롬프트/응답이 엇갈리거나 동일 탭에 중복 입력될 위험.

**개선방안**
- 서버 레벨 전역 락(1회 1분석) + 대기 큐/거절 정책 추가.  
- 최소 구현: `isAnalyzing` 플래그 + 요청 거절(429) 또는 대기 메시지.  
- 중기: 요청 단위로 `globalContext` 분리 혹은 탭 풀을 세션별로 분리.

---

### G2. `BROWSER_CHANNEL` 미반영
**원인**
- `chromium.launchPersistentContext()`에 `channel` 옵션이 전달되지 않음.  
- 환경 변수로 지정해도 실제 런치 브라우저가 기본 `chromium`일 가능성.

**개선방안**
- `launchPersistentContext` 옵션에 `channel: BROWSER_CHANNEL` 추가.  
- `chromium` 외 채널 지정 시 유효성 검사 및 실패 시 fallback 처리.

---

### G3. Reasoning 캐시 TTL 미구현
**원인**
- `REASONING_CACHE`는 용량 제한만 있고 시간 만료가 없음.  
- 오래된 전략이 누적/재사용될 수 있음.

**개선방안**
- 캐시 값에 `storedAt`을 저장하고 TTL(예: 15~60분) 적용.  
- TTL 만료 시 제거 + LRU 유지.

---

### G4. 재시도 조건이 제한적이지 않음
**원인**
- `collectResult`는 모든 에러에 대해 1회 재시도.  
- 로그인 만료/권한 문제도 동일하게 재시도 → 시간 낭비.

**개선방안**
- 재시도 조건을 `short_output`, `noisy_output`로 제한.  
- `signed out`/`send_failed`는 즉시 실패 처리하고 사용자에게 세션 점검 안내.

---

### G5. UX 한글 규칙 위반(영어 카피)
**원인**
- 입력 placeholder, 타이틀 등 일부 문자열이 영어.  
- 프로젝트 규칙: UX는 한국어 고정.

**개선방안**
- UI 텍스트 전수 점검 및 한국어화.  
- 문자열 상수화(한글 리소스 중앙화)로 재발 방지.

---

## 2) Perplexity/Gemini “응답수신 대기중” 장시간 지연 원인

### 공통 원인 후보
1. **응답 텍스트가 계속 `null`로 평가됨**  
   - `sanitize*` 이후 `looksLikeUiNoise`가 true가 되면 후보가 무효화됨.  
   - 후보가 무효화되면 `stableCount`가 누적되지 않아 루프가 끝까지 지속.

2. **UI 상태 감지가 불완전**  
   - `isGenerating`이 `Stop` 버튼 기반인데, 서비스별 UI 변경 시 인식 실패 가능.  
   - `Stop` 버튼이 사라져도 응답이 늦게 로딩되면 길게 대기.

3. **응답 길이 기준이 과도**  
   - Perplexity `minLength=90`으로 짧은 답변은 계속 실패.  
   - Gemini는 길이가 짧으면 계속 수집 대기 → 마지막에 `short_output`.

4. **사인아웃/세션 만료**  
   - Dispatch에서만 사인아웃 체크.  
   - 응답 단계에서 사인아웃 발생 시 빈 화면 → 장시간 대기.

---

### Perplexity 특이 원인
- **`.prose`/`[data-testid="answer"]`가 늦게 생성**되면 `containerSel` 대기 후에도 실제 텍스트는 늦게 나타남.  
- `sanitizePerplexityOutput`가 **출처/링크 라인을 과하게 제거**해 텍스트가 짧아질 수 있음.

**개선방안**
- `minLength`를 응답 유형에 따라 동적 조정(예: 질문 길이/agent 유형 기준).  
- Perplexity 응답 컨테이너 후보에 `main article` 외 추가 셀렉터 확장 검토.  
- `sanitizePerplexityOutput`에서 과잉 제거 조건 완화(도메인 제거 조건 완화).

---

### Gemini 특이 원인
- Shadow DOM 구조가 자주 변경되어 `getGeminiResponseText`가 빈 값을 반환할 수 있음.  
- `isGeminiStopped` 재전송 로직이 실패해도 계속 대기할 수 있음(응답 노드 생성 실패).

**개선방안**
- Gemini 전용 “Fail-Fast” 조건 추가:
  - `N`회(예: 5회) 연속 텍스트 null + Stop 버튼 없음 → 세션 재검증.  
- 응답 컨테이너 탐색 강화:
  - `model-response` 하위 DOM + `response-container` 다중 조합 탐색.  
- `minLength`를 상황별(질문 길이/요약 여부)로 가변화.

---

## 3) Claude Sanitization 필요 원인 & 개선방안

### 원인
- Claude UI/메뉴 텍스트가 응답 영역에 섞여 들어오는 케이스 존재.  
- 현재 `sanitizeClaudeOutput`는 일부 메뉴/레이블만 제거하며 최신 UI 변화 반영 부족.  
- `getClaudeResponseText`가 `.assistant-response, .markdown`까지 넓게 잡아 **UI 영역 텍스트를 끌고 올 위험**.

### 개선방안
1. **추가 제거 키워드 확장**  
   - “Artifacts”, “Projects”, “Search”, “Workspace”, “Upgrade”, “Usage”, “Manage plan” 등 UI 레이블 추가.  
2. **Claude 전용 컨테이너 제한 강화**  
   - `[data-testid="chat-message"]` 하위에서 assistant role만 선택하는 셀렉터로 제한.  
3. **컨텐츠 품질 가드**  
   - 짧은 라인 다수(<=20자 비율) + 메뉴 키워드 다중 포함 시 즉시 noisy 처리.  
4. **이중 정제 단계 분리**  
   - 수집 단계: 최소 정제(실제 답변 보존).  
   - 보고서 단계: 강한 정제(메뉴/광고 완전 제거).

---

## 4) 개선 우선순위 (권장)
1. 동시 분석 락 적용 (세션 충돌 방지)  
2. Perplexity/Gemini `Fail-Fast` 조건 + minLength 동적화  
3. Claude 컨테이너 제한 & 키워드 확장  
4. Reasoning 캐시 TTL 적용  
5. UX 한글화 전수 적용

---

## 5) 검증 체크리스트
- [ ] 동시 요청 2건 이상 시 충돌 없이 순차 처리되는가  
- [ ] Perplexity/Gemini “응답수신 대기중” 평균 대기 시간이 유의미하게 감소하는가  
- [ ] Claude 응답에 UI 잡음 라인이 포함되지 않는가  
- [ ] Reasoning 캐시가 TTL 만료 후 갱신되는가  
- [ ] UI 한국어화가 전면 적용되었는가

