# ChatGPT/Claude 스트리밍 표시만 뜨고 수집 실패 문제 개선안

## 0. 문제 요약
현재 4개 GPT 서비스 중 **ChatGPT/Claude에서 “스트리밍 중” 표시는 나오지만 결과 수집이 되지 않는 현상**이 발생하고 있음.  
이 현상은 순수 성능 문제보다는 **응답 컨테이너 셀렉터 불일치 / 수집 안정성 판단 로직 문제**일 가능성이 높다.

## 1. 원인 가설 (우선순위)
1) **응답 DOM 셀렉터 불일치**
   - ChatGPT/Claude UI 구조 변경으로 기존 셀렉터가 최신 응답을 못 잡음
2) **Observer 범위 과다**
   - `document.body` 전체 감시 → UI 라벨/버튼 텍스트 오염, 응답 추출 실패
3) **수집 종료 조건 부정확**
   - “Stop 버튼 표시”를 수집 종료로 오해
4) **유효성 판단 기준 과도**
   - 최소 길이 제한으로 짧은 응답을 실패로 판정
5) **세션 만료 감지 지연**
   - 로그인 필요 상태를 늦게 감지해 입력/수집 실패로 귀결

## 2. 개선안 (우선순위)
1) **응답 컨테이너 셀렉터 최신화**
   - ChatGPT: `[data-testid="conversation-turn"]` + 최신 assistant 블록
   - Claude: `[data-testid="chat-message"]` 또는 `.assistant-response` 최신 노드
2) **Observer 범위 축소**
   - `document.body` → 응답 루트 컨테이너로 한정
3) **수집 안정성 판정 완화**
   - “길이 증가율 + 2회 동일 텍스트” 기준
   - `minLength` 하향 (짧은 응답 허용)
4) **전송 성공 vs 수집 종료 분리**
   - Stop 버튼은 “전송 성공 확인” 용도로만 사용
5) **실패 스냅샷 자동 저장**
   - `debug_chatgpt_failed.html/png`, `debug_claude_failed.html/png`

## 3. 코드 변경안 (구체)
대상: `server/playwright_handler.js`

### 3.1 응답 루트 셀렉터 강화
```js
const getResponseRoot = (id) => {
  if (id === 'chatgpt') return '[data-testid="conversation-turn"]';
  if (id === 'claude') return '[data-testid="chat-message"], .assistant-response';
  if (id === 'gemini') return 'model-response, [data-testid="response-content"]';
  return 'main';
};
```

### 3.2 Observer 범위 축소
```js
const injectObserverScoped = async (page, id) => {
  const rootSel = getResponseRoot(id);
  await page.evaluate((sel) => {
    const root = document.querySelector(sel) || document.body;
    window.__RALPH_LATEST = "";
    window.__RALPH_LAST_LEN = 0;
    const observer = new MutationObserver(() => {
      const text = root.innerText || "";
      if (text.length > window.__RALPH_LAST_LEN) {
        window.__RALPH_LATEST = text;
        window.__RALPH_LAST_LEN = text.length;
      }
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }, rootSel);
};
```

### 3.3 수집 안정성 판정 완화
```js
const isStable = (last, current, stableCount) => {
  if (!current) return false;
  if (current === last) return stableCount >= 1; // 2회 동일 시 종료
  return false;
};

const isValid = (text) => text && text.trim().length >= 12; // 기존 50 -> 12
```

### 3.4 전송 성공 확인 분리
```js
const waitForSendConfirmed = async (page) => {
  const ok = await page.waitForFunction(() => {
    const stop = document.querySelector('button[aria-label*="Stop"], [data-testid*="stop"]');
    const turn = document.querySelector('[data-testid="conversation-turn"], .assistant-response, model-response');
    return !!stop || !!turn;
  }, { timeout: 8000 }).then(() => true).catch(() => false);
  return ok;
};
```

### 3.5 실패 스냅샷 저장
```js
const saveDebugSnapshot = async (page, tag) => {
  const ts = Date.now();
  await page.screenshot({ path: `debug_${tag}_${ts}.png`, fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => '');
  if (html) fs.writeFileSync(`debug_${tag}_${ts}.html`, html);
};
```

## 4. 기대 효과
- 스트리밍 표시만 뜨는 문제의 **핵심 원인(셀렉터/관측 범위)** 해결
- 수집 실패율 감소 및 디버깅 재현성 향상
- 짧은 응답도 정상 수집 가능

## 5. 적용 순서 (추천)
1) 응답 루트 셀렉터 강화
2) Observer 범위 축소
3) 안정성 판정 완화
4) 전송 성공/수집 종료 분리
5) 실패 스냅샷 자동 저장
