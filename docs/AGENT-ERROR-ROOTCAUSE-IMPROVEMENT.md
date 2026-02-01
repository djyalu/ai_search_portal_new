# 에이전트 오류 원인 분석 & 개선안

## 0. 요약
상태 메시지 `chatgpt:error, gemini:error`의 직접 원인은 다음 두 가지이다.

1) **ChatGPT**: 응답 추출 셀렉터 부재 → 결과 0 chars  
2) **Gemini**: 응답 미생성/중단 상태 → 결과 0 chars

## 1. 근거 (로그/스냅샷 기반)
- 로그에서 `chatgpt finished: 0 chars`, `gemini finished: 0 chars` 확인
- Gemini 스냅샷에서 “대답이 중지되었습니다” 문구 확인
- ChatGPT 스냅샷은 정상 로그인/대화 구조지만 응답 텍스트가 추출되지 않음

## 2. 개선안 (우선순위)

### 2.1 ChatGPT 응답 셀렉터 추가 (최우선)
목표: 실제 assistant 응답 블록만 추출

**권장 셀렉터**
- `[data-testid="conversation-turn"]` 내 최신 assistant 블록

**예시 접근**
```js
// ChatGPT 전용 추출 로직 추가
const getChatGPTResponseText = async (page) => {
  return await page.evaluate(() => {
    const turns = document.querySelectorAll('[data-testid="conversation-turn"]');
    if (!turns.length) return null;
    const last = turns[turns.length - 1];
    const assistant = last.querySelector('[data-message-author-role="assistant"], .markdown, .prose');
    return assistant ? assistant.innerText.trim() : last.innerText.trim();
  });
};
```

### 2.2 Gemini 전송 검증 강화
목표: 응답 생성 실패 시 즉시 재전송

**개선 포인트**
- “대답이 중지되었습니다” 문구 감지 시 실패 처리
- `Stop` 버튼 또는 `model-response` 생성 확인 후 수집 시작

**예시 접근**
```js
const isGeminiStopped = async (page) => {
  return await page.evaluate(() => {
    const txt = document.body?.innerText || '';
    return txt.includes('대답이 중지되었습니다');
  });
};
```

### 2.3 수집 시작 전 응답 컨테이너 확인
목표: 응답 DOM이 생성된 이후에만 수집

```js
await page.waitForSelector('model-response, [data-testid="response-content"]', { timeout: 8000 });
```

## 3. 기대 효과
- ChatGPT 수집 실패율 감소
- Gemini 응답 중단 시 재시도 처리로 성공률 증가
- 0 chars 결과 비율 감소

## 4. 적용 순서
1) ChatGPT 응답 셀렉터 추가  
2) Gemini 전송 검증 강화  
3) 수집 시작 전 응답 컨테이너 확인  
