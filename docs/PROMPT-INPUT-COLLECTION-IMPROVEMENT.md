# GPT 프롬프트 입력/수집 불안정 개선 방안

## 0. 목적
현재 GPT 프롬프트 입력 및 수집 과정에서 간헐적 실패가 발생하고 있음. 본 문서는 **입력 실패(전송 누락/오입력)** 및 **수집 실패(응답 미수집/오염)**를 줄이기 위한 개선 방향과 구현 우선순위를 정리한다.

## 1. 증상 요약 (관찰 기반)
- 입력 단계: 입력창 탐지 실패, 텍스트가 삽입되었으나 전송되지 않음, 전송 버튼 클릭 시 “Stop” 상태로 오인되어 동작 중단.
- 수집 단계: 스트리밍 중 텍스트 누락, UI 라벨이 섞여 출력되거나 응답이 너무 짧아 실패로 판정됨.
- 로그인 상태: 세션 만료/로그아웃이 입력 실패로 이어짐.

## 2. 원인 가설 (현 코드 흐름 기준)
1) **셀렉터 불안정**
   - 사이트별 입력창/버튼 구조가 잦게 변경됨.
   - `contenteditable`, `textarea`, shadow DOM 등 입력 영역이 다양함.

2) **React/SPA 상태 동기화 문제**
   - `keyboard.type`만으로는 내부 상태가 갱신되지 않는 경우 발생.
   - 클립보드 붙여넣기 이후에도 입력 이벤트(`input`, `change`)가 누락될 수 있음.

3) **전송 성공 여부 검증 부재**
   - Enter/Click을 수행했으나 실제 전송되지 않는 경우를 감지하지 못함.

4) **수집 로직의 신뢰도 한계**
   - `MutationObserver`가 `document.body` 기반일 때 UI 라벨이 섞임.
   - 최소 길이(또는 안정성 판단) 기준이 과도하여 유효 응답을 실패로 판정.

5) **세션 상태 탐지의 불완전성**
   - 로그인 페이지 전환을 늦게 감지하여 입력/수집이 모두 실패로 귀결.

## 3. 개선 목표 (KPI)
- 입력 성공률: 95% 이상
- 수집 성공률: 95% 이상
- 실패 시 “원인 분류” 로그 100% 확보

## 4. 개선 전략 (핵심)

### 4.1 입력 파이프라인 안정화
**목표:** 입력창에 확실히 텍스트가 삽입되고 전송되는지 검증

개선 항목:
1) **입력창 탐지 로직 정교화**
   - `role="textbox"`, `aria-label`, `data-testid` 기반 탐색 강화
   - shadow DOM 포함 탐색 함수 공통화
   - 사이트별 입력 셀렉터 설정을 JSON으로 분리 (핫픽스 용이)

2) **입력 방식 다중화 (하이브리드)**
   - 1차: `page.fill` / `insertText`
   - 2차: 클립보드 붙여넣기 (`Ctrl+V`)
   - 3차: `evaluate`로 값 주입 + `input` 이벤트 디스패치

3) **전송 성공 검증 단계 추가**
   - 전송 직후 다음 중 하나가 발생해야 성공 판정:
     - “Stop” 버튼 노출
     - 사용자 메시지 블록이 DOM에 추가됨
     - 응답 컨테이너에 토큰이 1개 이상 생성됨
   - 실패 시 자동 재전송(최대 2회) 수행

### 4.2 수집 파이프라인 정밀화
**목표:** UI 라벨 오염을 제거하고 최신 응답만 안정적으로 수집

개선 항목:
1) **에이전트별 응답 컨테이너 우선순위 강화**
   - Gemini: `model-response` / `[data-testid="response-content"]`
   - ChatGPT: `[data-testid="conversation-turn"]` 최신 블록
   - Claude: `.assistant-response`, `[data-testid="chat-message"]`

2) **Observer 범위 제한**
   - `document.body` 전체 대신 “응답 컨테이너 루트”에 Observer 부착
   - UI 라벨/버튼 텍스트는 필터링 대상 확대

3) **유효성 판정 기준 개선**
   - 최소 길이 기준을 고정값 대신 “이전 길이 대비 증가율”로 판단
   - 2~3회 연속 동일 텍스트일 때 안정 판정

### 4.3 세션 상태 탐지 강화
**목표:** 로그아웃을 조기에 감지하여 실패 원인 명확화

개선 항목:
1) 로그인 감지 로직의 공통 모듈화
2) “입력 실패”와 “로그인 필요”를 명확히 분리
3) 로그인 필요 시 UI에 즉시 노출 (사용자 조치 유도)

## 5. 구현 우선순위 (추천)
1) 입력 성공 검증 단계 추가
2) 입력 하이브리드 로직 강화 (`fill` + `paste` + `event dispatch`)
3) 응답 컨테이너 기반 수집 전환
4) 실패 로그(스크린샷 + HTML) 자동 저장
5) 로그인 감지 강화

## 6. 로그/디버깅 개선
- 입력 실패 시 `debug_input_failed_[agent].html/png` 저장
- 수집 실패 시 `debug_collect_failed_[agent].html/png` 저장
- 모든 실패는 `agent_status`에 “reason code”로 기록
  - 예: `input_missing`, `send_not_confirmed`, `response_empty`, `signed_out`

## 7. 기대 효과
- 입력/전송 실패 원인이 명확히 분리되어 재현성이 상승
- UI 구조 변경에 대한 대응력 강화
- 수집 정확도가 높아져 최종 보고서 품질 안정화

## 8. 에이전트 수집/분석 성능 최적화 제안
**목표:** 전체 처리 시간을 단축하고, 실패 재시도 비용을 줄이며, 리소스 사용을 안정화

### 8.1 수집 단계 성능
- **동시성 제어 최적화**: 에이전트 수를 고정 병렬로 실행하되, 사이트별 rate limit에 맞춰 동시성 풀(예: 2~3) 적용
- **탭 재사용**: 각 에이전트별 페이지를 재활용하여 `newPage()` 비용 절감
- **헤드리스/슬로우모 튜닝**: 성공률이 높은 환경만 고정(예: headless=false, slowMo=20~40)
- **응답 안정성 판단 단축**: “길이 증가율 + 2회 안정” 조건으로 수집 루프 횟수 축소
- **선제 종료 조건**: 입력 성공/응답 시작 감지 시 불필요한 대기 제거

### 8.2 분석 단계 성능
- **분석 모델 최소화**: Logic/Polish 단계에서 1개 모델 고정 선택(상태 ok 우선)
- **요약 프롬프트 캐싱**: 동일 입력 반복 시 전략/검증 프롬프트 재사용
- **결과 비교 로직 경량화**: JSON 파싱/정렬 단계를 단일 패스로 통합

### 8.3 리소스/안정성
- **브라우저 컨텍스트 풀링**: 세션/쿠키 유지로 로그인 재시도 최소화
- **네트워크 인터셉트**: 불필요한 리소스(이미지/폰트/광고) 차단
- **타임아웃 정책 분리**: 입력/전송/수집을 다른 타임아웃으로 분리
- **장애 리트라이 전략**: 입력 실패는 1~2회 재시도, 수집 실패는 1회 스냅샷 후 종료

## 9. 다음 단계 제안
- 위 8.1~8.2 중 “동시성 풀 + 탭 재사용 + 응답 안정성 단축”을 1차 적용
- 성능 로그(단계별 소요시간, 재시도 횟수) 추가 후 KPI 측정

## 10. Playwright 효율 극대화 개선 제안
**목표:** 실행 시간 단축 + 안정성 증가 + 디버깅 비용 최소화

### 10.1 브라우저/컨텍스트 운영
- **Persistent Context 고정**: 로그인 유지 + 세션 재사용, `launchPersistentContext` 단일 사용
- **Context 풀링**: 에이전트별 컨텍스트를 재사용하고 불필요한 `newPage()` 최소화
- **디바이스/뷰포트 고정**: viewport, userAgent, locale를 고정해 셀렉터 안정성 확보

### 10.2 네트워크 최적화
- **리소스 차단**: 이미지/폰트/미디어/광고 스크립트 차단으로 초기 로딩 시간 단축
- **도메인 화이트리스트**: 핵심 도메인만 통과, 나머지는 abort
- **네트워크 타임아웃 분리**: 페이지 로드, 입력, 수집을 각각 다른 타임아웃으로 운영

### 10.3 입력/전송 안정화
- **Locator 우선 전략**: `page.locator` + `hasText`, `getByRole`를 적극 사용
- **입력 하이브리드**: `fill` + `insertText` + `clipboard paste` 단계화
- **전송 확인 조건**: Stop 버튼, 메시지 버블 생성, 응답 토큰 생성 여부로 확정

### 10.4 수집 안정화
- **Locator 기반 최신 응답 추적**: 최신 응답 DOM 블록만 추적
- **MutationObserver 범위 축소**: 응답 루트 한정 관찰
- **응답 안정성 룰 단순화**: 2회 동일 텍스트 + 길이 증가율로 종료

### 10.5 장애 대응/디버깅 효율
- **자동 스냅샷**: 실패 유형별 `html/png` 저장 규칙화
- **Tracing 조건부 활성화**: 실패 시에만 tracing 켜서 비용 최소화
- **콘솔/네트워크 로그 요약**: 핵심 오류만 로그에 남기도록 필터링

### 10.6 테스트 자동화
- **핵심 플로우 스모크 테스트**: 입력/전송/수집의 최소 시나리오를 CI로 고정
- **Selector 검증 스크립트**: 주기적 셀렉터 유효성 테스트

## 11. 다음 단계 제안 (입력/수집 안정화)
- 위 우선순위 1~3 항목을 1차 스프린트로 수행
- 실패 로그 기준으로 KPI 측정 및 반복 개선

## 12. 코드 변경안 (구체)
아래는 실제 적용을 위한 **파일/함수 단위 변경안**이다. (코드 식별자는 영어, UX 텍스트는 한국어 유지)

### 12.1 리소스 차단 + 도메인 화이트리스트
대상: `server/playwright_handler.js`

핵심: 이미지/폰트/미디어/광고 차단, 핵심 도메인만 통과

```js
// add near runExhaustiveAnalysis() start, after context creation
const allowDomains = [
  'openai.com', 'chatgpt.com',
  'anthropic.com', 'claude.ai',
  'perplexity.ai',
  'gemini.google.com', 'google.com'
];

const shouldAllow = (url) => {
  try {
    const { hostname } = new URL(url);
    return allowDomains.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return false;
  }
};

await browserContext.route('**/*', (route) => {
  const req = route.request();
  const type = req.resourceType();
  const url = req.url();

  if (['image', 'font', 'media'].includes(type)) return route.abort();
  if (!shouldAllow(url) && type !== 'document') return route.abort();
  return route.continue();
});
```

### 12.2 탭 재사용 + 에이전트별 페이지 캐시
대상: `server/playwright_handler.js`

핵심: 에이전트별 `newPage()` 반복 생성 제거

```js
// add near runExhaustiveAnalysis() start
const pagePool = new Map();
const getPage = async (id, url) => {
  if (pagePool.has(id)) return pagePool.get(id);
  const p = await browserContext.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  pagePool.set(id, p);
  return p;
};
```

사용부 예시 (collect 단계):
```js
const page = await getPage(worker.id, worker.url);
```

### 12.3 전송 성공 검증 함수 추가
대상: `server/playwright_handler.js`

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

적용 위치:
- 입력 후 `Enter`/`Click` 직후 `await waitForSendConfirmed(page)` 호출
- 실패 시 1~2회 재전송

### 12.4 입력 하이브리드: 이벤트 디스패치 보강
대상: `server/playwright_handler.js`

```js
const injectTextWithEvents = async (page, selector, text) => {
  await page.evaluate(({ sel, t }) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.focus();
    if ('value' in el) el.value = t;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { sel: selector, t: text });
};
```

적용 순서:
1) `fill` 또는 `insertText`
2) 실패 시 `pasteInput`
3) 실패 시 `injectTextWithEvents`

### 12.5 응답 컨테이너 기반 수집 + Observer 범위 축소
대상: `server/playwright_handler.js`

```js
// example: Gemini container root
const getResponseRoot = (id) => {
  if (id === 'gemini') return 'model-response, [data-testid="response-content"]';
  if (id === 'chatgpt') return '[data-testid="conversation-turn"]';
  if (id === 'claude') return '.assistant-response, [data-testid="chat-message"]';
  return 'main';
};

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

### 12.6 실패 스냅샷 저장 규칙화
대상: `server/playwright_handler.js`

```js
const saveDebugSnapshot = async (page, tag) => {
  const ts = Date.now();
  await page.screenshot({ path: `debug_${tag}_${ts}.png`, fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => '');
  if (html) fs.writeFileSync(`debug_${tag}_${ts}.html`, html);
};
```

적용 위치:
- 입력 실패: `input_missing`
- 전송 실패: `send_not_confirmed`
- 수집 실패: `response_empty`

### 12.7 단계별 타임아웃 분리
대상: `server/playwright_handler.js`

```js
const TIMEOUT = {
  nav: 60000,
  input: 8000,
  sendConfirm: 8000,
  collectTick: 2000,
  collectMaxRounds: 12
};
```

적용 위치:
- `goto`/`waitForSelector`/수집 루프 등에 분리 적용

### 12.8 간단 성능 로그
대상: `server/playwright_handler.js`

```js
const t0 = Date.now();
// ...
logInternal(`[Perf] ${worker.id} collect=${Date.now()-t0}ms`);
```
