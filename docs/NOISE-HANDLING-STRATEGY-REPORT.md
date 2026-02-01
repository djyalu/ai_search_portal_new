# 노이즈 제거 전략 재설계 제안 (수집 vs 보고서 단계 분리)

## 0. 문제 요약
현재 종합 인텔리전스 보고서에 **UI 라벨/로그인 문구/메뉴 항목**이 섞이고,  
**줄바꿈/섹션 구조가 붕괴**되는 문제가 반복된다.

핵심 원인:
- 수집 단계에서 오염된 텍스트가 그대로 합성 프롬프트에 전달됨
- 합성 단계에서 “원문 잠금” 규칙 때문에 오염 데이터를 제거할 여지가 없음

## 1. 결론 (권장 전략)
**수집 단계는 최소 정제**, **보고서 단계는 강한 정제**가 최적이다.

### 이유
- 수집 단계에서 최소한의 노이즈를 제거하지 않으면 합성 결과가 오염됨
- 반대로 수집 단계에서 과도한 필터링은 “정상 응답까지 제거”하는 역효과 발생

## 2. 개선안 (2단계 정제 구조)

### 2.1 수집 단계: “최소 정제 + 유효성 판정”
목표: UI 라벨만 걷어내고, 정상 응답은 최대 보존

**필수 룰**
- 로그인 문구/업그레이드 안내/메뉴 라벨 제거
- “응답 컨테이너가 존재하는지” 확인
- **응답이 없으면 실패 처리** (noisy_output)

**권장 방식**
- `sanitizeCommonNoise()`는 최소 항목만 유지
- UI 라벨 과다 시 `looksLikeUiNoise()`로 실패 처리

### 2.2 보고서 단계: “강한 정제 + 포맷 정규화”
목표: 프롬프트 에코/꼬리 문구 제거 + 마크다운 구조 유지

**필수 룰**
- `You said:`, `ChatGPT said:` 제거
- “Cookie Preferences” 같은 꼬리 문구 제거
- 줄바꿈 2줄 기준 정규화

## 3. 코드 변경안 (권장)

### 3.1 수집 단계 최소 정제 유지
대상: `server/playwright_handler.js`

```js
// 최소 필터 유지 (로그인/업그레이드/메뉴 라벨 위주)
const GLOBAL_STOP_PHRASES = [
  'sign in', 'upgrade', 'tools', 'cookie preferences', 'see plans',
  'about gemini', 'subscriptions', 'for business', 'recents', 'free plan'
];
```

### 3.2 응답 유효성 판정
```js
if (looksLikeUiNoise(candidate)) candidate = null;
if (looksLikeUiNoise(lastText)) throw new Error('noisy_output');
```

### 3.3 보고서 단계 정규화 강화
```js
finalOutput = normalizeReport(finalOutput);
```

## 4. 기대 효과
- 수집 단계 오염 방지 (합성 프롬프트 보호)
- 정상 응답 보존율 증가
- 보고서 포맷 안정화 (섹션/테이블 유지)

## 5. 적용 순서
1) 수집 단계 최소 정제 + 유효성 판정
2) 보고서 단계 강한 정제 + 포맷 정규화
3) 결과 비교 테스트 (이전/이후)
