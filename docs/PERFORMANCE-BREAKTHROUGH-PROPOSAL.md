# 처리 성능 획기적 개선 제안

## 0. 목적
현 구조에서 **체감 성능을 크게 개선**하기 위해 구조적 최적화 방안을 정리한다.  
단일 튜닝보다 “병렬화 + 재사용 + 조기 종료 + 실패 비용 감소”의 결합이 핵심이다.

## 1. 성능 병목 가설
1) 에이전트별 순차 수집으로 총 시간이 합산됨
2) 매 요청마다 `newPage()`/`goto()`로 초기화 비용이 반복됨
3) 스트리밍 종료 판단이 늦어 수집 루프가 과도하게 길어짐
4) 실패 재시도 비용이 크고, 원인 파악이 느림

## 2. 획기적 개선안 (우선순위)

### 2.1 병렬 수집 + 동시성 풀 (가장 큰 효과)
- 에이전트 수집을 **병렬**로 전환
- 사이트별 rate limit을 고려한 **동시성 풀(2~3)** 적용
- 기대 효과: 총 처리 시간 ≈ 최장 에이전트 시간에 근접

### 2.2 탭/컨텍스트 재사용 (대폭 단축)
- 에이전트별 탭을 풀링해 재사용
- 매 요청마다 `newPage()`/`goto()` 비용 제거
- 로그인 세션 유지로 재인증 비용 최소화

### 2.3 수집 조기 종료 룰 (체감 개선)
- “길이 증가율 + 2회 동일 텍스트” 기준으로 즉시 종료
- 불필요한 수집 루프 제거

### 2.4 리소스 차단 + 도메인 화이트리스트
- 이미지/폰트/미디어 차단 → 로딩 시간 단축
- 핵심 도메인만 통과 → 네트워크 비용 절감

### 2.5 분석 단계 단순화
- Logic/Polish 단계 **단일 에이전트 고정**
- 반복 프롬프트 캐싱으로 처리 시간 절감

### 2.6 실패 비용 절감
- 입력 성공 검증 후 1~2회 재시도
- 실패 스냅샷 자동 저장으로 원인 분석 시간 단축

## 3. 적용 순서 (추천)
1) 병렬 수집 + 동시성 풀
2) 탭/컨텍스트 재사용
3) 수집 조기 종료 룰
4) 리소스 차단 + 도메인 화이트리스트
5) 분석 단계 단순화
6) 실패 스냅샷 자동 저장

## 4. 성공 지표 (KPI)
- 평균 처리 시간 40~60% 단축
- 에이전트별 수집 실패율 50% 이상 감소
- 재시도 횟수 1회 이하 유지

## 5. 기대 효과
- 체감 속도 개선 (보고서 생성 시간 단축)
- 불필요한 대기/재시도 감소
- 안정성 향상으로 운영 비용 절감

## 6. 코드 플랜 (구현 단계별)
아래 플랜은 `server/playwright_handler.js` 중심으로 단계별 적용을 전제로 한다.

### 6.1 병렬 수집 + 동시성 풀
**변경 포인트**
- `collectResult()` 호출을 순차 → 병렬로 전환
- 풀 크기(2~3)로 동시성 제한

**적용 개념 코드**
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

### 6.2 탭 재사용 (에이전트별 페이지 풀)
**변경 포인트**
- `newPage()` 대신 재사용
- `goto()` 반복 최소화

**적용 개념 코드**
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
**변경 포인트**
- “길이 증가율 + 2회 동일 텍스트” 조건으로 수집 종료
- 불필요 루프 감소

**적용 개념 코드**
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

### 6.4 리소스 차단 + 도메인 화이트리스트
**변경 포인트**
- 이미지/폰트/미디어 차단
- 핵심 도메인만 통과

**적용 개념 코드**
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

### 6.5 분석 단계 단순화
**변경 포인트**
- Logic/Polish 단계에서 **OK 상태의 단일 에이전트** 고정
- 중복 검증 제거

**적용 개념 코드**
```js
const pickBest = (order) => order.find(id => enabledAgents[id] && agentStatus[id] === 'ok') || order.find(id => enabledAgents[id]);
const validationId = pickBest(['claude','chatgpt','gemini','perplexity']);
const finalId = pickBest(['chatgpt','perplexity','gemini','claude']);
```

### 6.6 실패 비용 절감 (스냅샷 + reason code)
**변경 포인트**
- 입력/전송/수집 실패 시 자동 스냅샷
- `agent_status`에 실패 사유 기록

**적용 개념 코드**
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
5) 분석 단계 단순화
6) 실패 스냅샷 자동 저장
