# 처리 속도 획기적 개선 제안 v2

## 0. 목적
현재 체감 속도가 느린 문제를 **구조적 최적화**로 개선한다.  
단일 튜닝이 아닌 **병렬화 + 재사용 + 네트워크 최적화 + 단계 축소** 조합을 목표로 한다.

## 1. 병목 재정의 (현상 기준)
1) 에이전트별 수집이 순차 처리되어 총 시간이 누적됨  
2) 매 요청마다 페이지 생성/초기화 비용이 반복됨  
3) 스트리밍 종료 판단이 늦어 수집 루프가 길어짐  
4) 실패 재시도로 인한 비용이 큼  

## 2. 획기적 개선안 (우선순위)

### 2.1 병렬 수집 + 동시성 풀 (최우선)
- 4개 에이전트를 **완전 병렬**로 전환  
- 사이트별 안정성을 고려한 **동시성 제한(2~3)** 적용  
- 기대 효과: 전체 처리 시간 ≈ 최장 에이전트 시간으로 수렴

### 2.2 탭/컨텍스트 재사용 (대폭 단축)
- 에이전트별 페이지 풀링 → `newPage()` 제거  
- `goto()` 반복 최소화 → 로딩 비용 절감  
- 로그인 세션 유지로 인증 재시도 감소

### 2.3 수집 조기 종료 룰 (체감 개선)
- “길이 증가율 + 2회 동일 텍스트” 기준으로 즉시 종료  
- 불필요한 수집 루프 최소화

### 2.4 네트워크 리소스 차단 (체감 큼)
- 이미지/폰트/미디어 차단  
- 핵심 도메인 화이트리스트만 통과  
- 초기 렌더링 시간 단축

### 2.5 단계 축소 (Logic/Polish 단일화)
- 검증/합성 단계를 **1개 에이전트로 고정**  
- 중복 검증 제거 → 합성 시간 단축

### 2.6 실패 비용 절감 (재시도 최소화)
- 입력 성공 검증 후 1~2회 재시도  
- 실패 원인 자동 분류 + 스냅샷 저장  
- 불필요한 재실행 방지

## 3. 적용 순서 (추천)
1) 병렬 수집 + 동시성 풀  
2) 탭/컨텍스트 재사용  
3) 수집 조기 종료 룰  
4) 리소스 차단  
5) 단계 축소  
6) 실패 스냅샷 자동 저장

## 4. KPI 제안
- 평균 처리 시간 40~60% 단축  
- 수집 실패율 50% 이상 감소  
- 재시도 횟수 1회 이하

## 5. 기대 효과
- 체감 속도 개선 (보고서 생성 시간 단축)  
- 실패 재시도 비용 감소  
- 안정성 향상으로 운영 부담 완화

## 6. 코드 플랜 (구현 단계별)
대상: `server/playwright_handler.js` 중심

### 6.1 병렬 수집 + 동시성 풀
```js
const poolLimit = 3;
const running = new Set();

const runWithPool = async (task) => {
  while (running.size >= poolLimit) await Promise.race(running);
  const p = task().finally(() => running.delete(p));
  running.add(p);
  return p;
};

const tasks = activeWorkers.map(w => () => collectResult(w));
const results = await Promise.all(tasks.map(t => runWithPool(t)));
```

### 6.2 탭/컨텍스트 재사용
```js
const pagePool = new Map();
const getPage = async (id, url) => {
  if (pagePool.has(id)) return pagePool.get(id);
  const p = await browserContext.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  pagePool.set(id, p);
  return p;
};
```

### 6.3 수집 조기 종료 룰
```js
let stableCount = 0;
let lastText = "";
for (let i = 0; i < TIMEOUT.collectMaxRounds; i++) {
  const current = await readLatestText();
  if (current && current === lastText) stableCount++;
  else { lastText = current; stableCount = 0; }
  if (stableCount >= 2 && lastText.length >= 12) break;
  await delay(TIMEOUT.collectTick);
}
```

### 6.4 네트워크 리소스 차단
```js
const allowDomains = ['openai.com', 'chatgpt.com', 'anthropic.com', 'claude.ai', 'perplexity.ai', 'gemini.google.com', 'google.com'];
const shouldAllow = (url) => {
  try { const { hostname } = new URL(url); return allowDomains.some(d => hostname === d || hostname.endsWith('.' + d)); }
  catch { return false; }
};
await browserContext.route('**/*', (route) => {
  const req = route.request();
  const type = req.resourceType();
  if (['image', 'font', 'media'].includes(type)) return route.abort();
  if (!shouldAllow(req.url()) && type !== 'document') return route.abort();
  return route.continue();
});
```

### 6.5 단계 축소 (Logic/Polish 단일화)
```js
const pickBest = (order) => order.find(id => enabledAgents[id] && agentStatus[id] === 'ok') || order.find(id => enabledAgents[id]);
const validationId = pickBest(['claude','chatgpt','gemini','perplexity']);
const finalId = pickBest(['chatgpt','perplexity','gemini','claude']);
```

### 6.6 실패 비용 절감 (스냅샷)
```js
const saveDebugSnapshot = async (page, tag) => {
  const ts = Date.now();
  await page.screenshot({ path: `debug_${tag}_${ts}.png`, fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => '');
  if (html) fs.writeFileSync(`debug_${tag}_${ts}.html`, html);
};
```

## 7. 적용 순서 요약
1) 병렬 수집 + 동시성 풀  
2) 탭 재사용  
3) 수집 조기 종료 룰  
4) 리소스 차단  
5) 단계 축소  
6) 실패 스냅샷 자동 저장
