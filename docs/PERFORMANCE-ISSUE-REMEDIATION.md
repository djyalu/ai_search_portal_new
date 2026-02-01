# 성능 이슈 개선 제안서 (코드 구현방안 포함)

작성일: 2026-02-01  
대상: AI Search Portal (Multi-GPT Analyzer)

---

## 1) 현상 요약 (로그 기반)
- Perplexity dispatch 검증 시간이 50초 이상 반복 발생.
- Perplexity short_output 재시도 루프 반복.
- Gemini `gemini_stopped` 반복.
- 응답 컨테이너 타임아웃 빈발.

결론: 단순 대기가 아니라 **실패/지연 루프**가 존재하며, 개선 여지가 큼.

---

## 2) 개선 목표
1. Perplexity/Gemini 대기 시간 30~50% 단축  
2. short_output, gemini_stopped 반복 감소  
3. 컨테이너 타임아웃 감소  
4. 실패 시 빠른 탈출(시간 낭비 최소화)

---

## 3) 개선안 + 코드 구현방안

### A. Fail-Fast 조건 (Perplexity/Gemini 우선 적용)
**의도**: `candidate === null`이 반복되면 즉시 종료.

**구현 위치**: `server/playwright_handler.js` → `collectResult` 루프

**코드 스케치**
```js
let nullStreak = 0;
const NULL_STREAK_LIMIT = worker.id === 'gemini' ? 4 : 5;

if (!candidate || !candidate.trim()) {
  nullStreak++;
} else {
  nullStreak = 0;
}

const isFailFast = nullStreak >= NULL_STREAK_LIMIT && !isGenerating;
if (isFailFast) throw new Error('no_response');
```

**효과**: 불필요한 최대 대기 시간 제거.

---

### B. minLength 동적화
**의도**: 짧은 질문/답변을 정상으로 인정.

**구현 위치**: `collectResult` 내 `minLength` 산출부

**코드 스케치**
```js
const promptLen = worker.prompt?.length || 0;
const base = worker.id === 'perplexity' ? 60 : 30;
const scaled = Math.min(180, Math.max(base, Math.floor(promptLen * 0.2)));
const minLength = scaled;
```

**효과**: Perplexity `short_output` 반복 감소.

---

### C. Perplexity Dispatch 검증 완화
**의도**: 검증 지연을 줄이고 빠르게 수집 단계로 전환.

**구현 위치**: `dispatchAgent` → `checkGenerationStarted`

**개선 방향**
- Perplexity는 Stop 버튼 대신 **응답 컨테이너 존재** 기준으로 빠르게 성공 처리.

**코드 스케치**
```js
if (wid === 'perplexity') {
  const hasAnswer = !!document.querySelector('.prose,[data-testid="answer"],.result');
  if (hasAnswer) return true;
}
```

---

### D. Gemini `gemini_stopped` 반복 처리 개선
**의도**: stopped 반복 시 즉시 종료/재로그인 유도.

**구현 위치**: `collectResult` → gemini 처리 분기

**코드 스케치**
```js
let stoppedCount = 0;

if (await isGeminiStopped(page)) {
  stoppedCount++;
  if (stoppedCount >= 2) throw new Error('gemini_stopped');
  const resent = await resendGemini(page, worker);
  if (!resent) throw new Error('gemini_stopped');
}
```

---

### E. 컨테이너 대기 타임아웃 완화 + 대체 셀렉터 강화
**의도**: 응답 컨테이너 탐지 실패를 줄임.

**구현 위치**: `getResponseRoot`, `collectResult`의 waitForSelector

**개선 방향**
- Perplexity, Claude, ChatGPT 대체 셀렉터 추가
- 타임아웃을 고정값 대신 agent별로 차등 적용

---

### F. 에러 분류 개선 (재시도 제한)
**의도**: 로그인 만료/권한 오류는 즉시 종료.

**구현 위치**: `collectResult` 에러 처리

**코드 스케치**
```js
if (errMsg === 'signed_out' || errMsg === 'send_failed') {
  retryCount = MAX_COLLECT_RETRIES; // 즉시 종료
}
```

---

## 4) 적용 순서(권장)
1. Fail-Fast + minLength 동적화  
2. Perplexity dispatch 검증 완화  
3. Gemini stopped 처리 개선  
4. 컨테이너 셀렉터 강화  
5. 재시도 정책 세분화  

---

## 5) 검증 체크리스트
- [ ] Perplexity 평균 dispatch 시간이 20초 이하로 감소  
- [ ] Perplexity short_output 반복률 감소  
- [ ] Gemini gemini_stopped 반복 횟수 감소  
- [ ] 응답 대기 전체 시간 30% 이상 단축  

