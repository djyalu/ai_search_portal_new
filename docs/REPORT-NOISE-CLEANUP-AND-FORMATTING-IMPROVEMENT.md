# UI 라벨/잡음 제거 & 보고서 포맷 개선안

## 0. 문제 요약
현재 종합 인텔리전스 보고서 결과물에서 **UI 라벨/잡음이 대량 유입**되고,  
**줄바꿈/섹션 구조가 깨져** 읽기 어려운 상태가 발생한다.

## 1. 원인 분석
1) **수집 단계 잡음 미정제**
   - 로그인/업그레이드 안내, 메뉴 라벨(Recents, Hide 등)이 그대로 수집됨.
2) **프롬프트 내부 원문 오염**
   - 에이전트 원문에 UI 텍스트가 섞여 있어 최종 합성에 그대로 반영됨.
3) **출력 후처리 미흡**
   - 줄바꿈/테이블/섹션 구분이 유지되지 않아 한 줄로 붙어 출력됨.

## 2. 개선 목표
- UI 라벨/잡음 90% 이상 제거
- 섹션별 구조(헤더/표/리스트) 보존
- 보고서 가독성 향상 (요약 → 근거 → 리스크 → 액션 순)

## 3. 개선안 (우선순위)

### 3.1 수집 단계 잡음 필터 강화 (최우선)
**목표:** UI 라벨을 원문에서 제거

추가 대상 (예시):
- Gemini: `About Gemini`, `Subscriptions`, `Once you're signed in`
- Claude: `Recents`, `Hide`, `Free plan`, `Upgrade`, `What can I help you with today?`
- 공통: `Cookie Preferences`, `Share`, `Show more`, `Sources`

### 3.2 원문/프롬프트 분리
**목표:** “원문 데이터”와 “시스템 프롬프트”가 섞이지 않게 분리

- 원문 JSON은 **오직 에이전트 결과만 포함**
- 시스템 규칙/QA 스펙은 **별도 섹션**으로 분리 전달

### 3.3 출력 후처리 적용
**목표:** 최종 결과의 줄바꿈 및 섹션 구조 유지

- Markdown 섹션 헤더 강제 삽입
- 테이블은 반드시 `|` 구조 유지
- 연속 공백/줄바꿈 정규화

## 4. 코드 변경안 (구체)

### 4.1 잡음 필터 강화
대상: `server/playwright_handler.js`

```js
// 확장형 공통 잡음 목록
const GLOBAL_STOP_PHRASES = [
  'sign in', 'upgrade', 'tools', 'cookie preferences', 'see plans',
  'keep chatting', 'you are out of free messages', 'share', 'related', 'sources',
  'about gemini', 'subscriptions', 'for business', 'once you\'re signed in',
  'recents', 'hide', 'free plan', 'what can i help you with today?'
];
```

```js
// sanitizeCommonNoise 호출을 모든 에이전트 결과에 강제 적용
function sanitizeCommonNoise(text) {
  if (!text) return text;
  return text.split('\n').filter(line => {
    const l = line.trim().toLowerCase();
    if (!l) return true;
    if (GLOBAL_STOP_PHRASES.some(p => l === p || l.includes(p))) return false;
    return true;
  }).join('\n').trim();
}
```

### 4.2 출력 후처리 (줄바꿈/섹션 유지)
대상: `server/playwright_handler.js` 합성 결과 반환 직전

```js
const normalizeReport = (text) => {
  if (!text) return text;
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
};
```

적용 위치:
```js
finalOutput = normalizeReport(finalOutput);
```

### 4.3 원문 데이터 vs 규칙 분리
대상: Final Synthesis 프롬프트

```text
[DATA ONLY]
{rawData}

[QA RULES]
... (규칙 별도 섹션)
```

## 5. 기대 효과
- UI 라벨/잡음 제거로 데이터 신뢰도 상승
- 보고서 구조 정상화 (섹션/표 유지)
- 최종 가독성 및 품질 개선

## 6. 적용 순서
1) 잡음 필터 확장
2) 합성 결과 후처리(줄바꿈/정규화)
3) 프롬프트 입력 구조 분리
