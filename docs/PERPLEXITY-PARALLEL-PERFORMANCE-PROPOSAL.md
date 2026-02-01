# Perplexity 전송 지연 개선 + 병렬 요청 최적화 제안

## 0. 목적
Perplexity 전송 지연을 줄이고, 4개 GPT 서비스에 대한 **병렬 요청**으로 전체 처리 시간을 단축한다.

## 1. 문제 요약
- Perplexity는 초기 로딩과 입력창 렌더링이 늦어 **전송 단계가 병목**이 됨.
- 현재 `dispatch` 단계가 순차로 동작해 전체 처리 시간이 누적됨.

## 2. 개선안 (3번 패키지)

### 2.1 프리웜(Pre-warm) 단계 추가
목표: 분석 시작 전 Perplexity 탭을 미리 열어 초기 로딩 시간을 숨김

**핵심 아이디어**
- 분석 시작 시점에 `perplexity.ai` 탭을 미리 열고 DOM 로딩 완료 상태로 대기
- 실제 전송 시에는 이미 로드된 탭을 재사용

### 2.2 병렬 전송 (동시성 풀 적용)
목표: 4개 에이전트 전송을 병렬화하되, 안정성을 위해 동시성 제한

**핵심 아이디어**
- `dispatchAgent()`를 `Promise.all` 대신 **동시성 풀(2~3)**로 실행
- 사이트별 rate limit/안정성 고려

### 2.3 전송 검증 최적화 (Perplexity 특화)
목표: 전송 확인 대기 시간을 단축

**핵심 아이디어**
- Perplexity만 전송 검증 타임아웃 축소
- 첫 번째 검증 실패 시 바로 재시도

### 2.4 리소스 차단 (체감 속도 개선)
목표: Perplexity 초기 로딩 리소스 최소화

**핵심 아이디어**
- 이미지/폰트/미디어 요청 차단
- CSS는 유지해 셀렉터 안정성 확보

## 3. 코드 플랜 (요약)
대상: `server/playwright_handler.js`

### 3.1 프리웜 구현
```js
// 분석 시작 시 pre-warm
await warmUpPage('perplexity', 'https://www.perplexity.ai');
```

### 3.2 병렬 전송 (동시성 풀)
```js
const poolLimit = 3;
const tasks = activeWorkers.map(w => () => dispatchAgent(w));
const results = await Promise.all(tasks.map(t => runWithPool(t, poolLimit)));
```

### 3.3 Perplexity 전송 검증 최적화
```js
const verifyTimeout = worker.id === 'perplexity' ? 4000 : 8000;
```

### 3.4 리소스 차단
```js
if (['image','font','media'].includes(type)) return route.abort();
```

## 4. 기대 효과
- Perplexity 전송 지연 30~50% 감소
- 4개 에이전트 병렬 전송으로 전체 처리 시간 단축
- 체감 속도 개선 및 안정성 유지

## 5. 적용 순서
1) 프리웜 단계 추가
2) 병렬 전송 (동시성 풀)
3) Perplexity 전송 검증 최적화
4) 리소스 차단
