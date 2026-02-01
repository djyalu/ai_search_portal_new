# 인텔리전스 보고서 결과물 품질 분석 & 개선안

## 0. 대상 결과물 요약
사용자 입력: “미국주식 하루 50만원 수익 내는 방법 알려줘”  
에이전트 원문: Perplexity/ChatGPT/Gemini/Claude 출력 포함  
최종 합성(예시): ChatGPT가 생성한 종합 인텔리전스 보고서

## 1. 문제 진단 (핵심 결함)
### 1.1 데이터 오염/잡음 유입
- Claude/Gemini 원문에 **로그인/업그레이드/툴 안내 문구**가 다수 섞여 있음.
- Perplexity 원문에 “Share”, “Show more”, “reddit+1” 등 UI 라벨이 포함됨.
- 결과적으로 최종 보고서의 근거 데이터 신뢰도가 저하됨.

### 1.2 근거 불명확/과잉 일반화
- “90% 이상 손실”, “초보 성공 확률 10% 미만” 등의 수치가 **출처 없이 인용**됨.
- 합성 단계에서 정량 근거가 약한 문장을 “확정적 결론”으로 표현함.

### 1.3 합의/불일치 섹션의 형식적 구성
- 실제로는 공통 합의와 충돌 근거가 명확히 분리되지 않고 **형식상 채워짐**.
- 에이전트별 주장의 **근거-출처 분리**가 부족.

### 1.4 “불확실성/가정”의 명시 부족
- 리스크 섹션은 있으나, **가정/정보 부족/추정치**가 구분되지 않음.
- Low 신뢰도 항목이 요약 본문에 섞임.

### 1.5 컨설팅 톤 일관성 부족
- 문장 길이가 길고, 일부 구어체/설명체 혼재.
- “가능은 하다/극소수 가능” 같은 표현이 **정밀한 판단 근거 없이 반복**됨.

## 2. 원인 분석 (파이프라인 관점)
1) **수집 단계 오염**
   - UI 라벨/툴 안내가 원문 데이터에 포함 → 합성 품질 직접 하락
2) **정량 검증 룰 부재**
   - “수치가 출처 없이 등장해도 통과” → 환각 가능성 상승
3) **합의/충돌 정규화 부족**
   - 주장 매칭 로직이 형식적, 실제로는 근거 충돌이 구분되지 않음
4) **신뢰도 등급화 미적용**
   - 보고서 구조는 있으나 High/Medium/Low 규칙 미집행

## 3. 개선안 (우선순위)

### 3.1 데이터 정제(최우선)
- **UI 라벨/로그인 문구 자동 제거 룰 강화**
  - Claude/Gemini: “Sign in”, “Upgrade”, “Tools” 제거
  - Perplexity: “Share/Show more/reddit+1/Related” 제거
- 정제 실패 시 해당 에이전트는 “data_noisy”로 분류

### 3.2 근거 검증 규칙 도입
- 수치/확률/비율이 등장하면 **“근거 출처 존재 여부” 체크**
- 출처 불명 수치는 “추정/가설” 섹션으로만 이동

### 3.3 합의/불일치 매트릭스 정밀화
- 합의: 3개 이상 에이전트 동일 주장
- 불일치: 2:2 분할 or 상반 주장
- 단일 주장: “가설”로 분리

### 3.4 신뢰도 등급 강제
- High: 3개 이상 합의
- Medium: 2개 합의
- Low: 1개 주장
- Executive Summary는 High/Medium만 포함

### 3.5 톤/형식 개선
- 결론형 문장(“…이다.”)으로 통일
- 추정/불확실성 문장은 반드시 “~일 가능성”으로 표기

## 4. 코드/프롬프트 개선안 (구체)

### 4.1 정제 필터 강화 (수집 단계)
대상: `server/playwright_handler.js`

```js
// 추가 정제 룰 예시
const globalStopPhrases = [
  'sign in', 'upgrade', 'tools', 'cookie preferences', 'see plans',
  'keep chatting', 'you are out of free messages'
];
const stripNoise = (text) => {
  if (!text) return text;
  return text.split('\n').filter(line => {
    const l = line.trim().toLowerCase();
    if (!l) return true;
    if (globalStopPhrases.some(p => l.includes(p))) return false;
    if (l === 'share' || l === 'show more' || l.startsWith('related')) return false;
    return true;
  }).join('\n').trim();
};
```

### 4.2 합의/충돌 판정 규칙 추가
대상: `server/playwright_handler.js` 최종 합성 프롬프트

```text
[CONSENSUS RULES]
- 동일 사실이 3개 이상 에이전트에 존재하면 "합의"
- 2:2 분할 또는 상반 주장 시 "불일치"
- 단일 주장 시 "가설"
- Executive Summary는 합의/중간 합의만 반영
```

### 4.3 정량 근거 검증 룰
대상: `Final Synthesis` 프롬프트

```text
[NUMERIC VALIDATION]
- 수치/확률/비율이 등장하면 출처 여부를 확인
- 출처가 없으면 "추정"으로 표기하고 요약 본문에서 제외
```

### 4.4 신뢰도 표시 강제
대상: `Final Synthesis` 출력 규칙

```text
[CONFIDENCE]
- High: 3개 이상 합의
- Medium: 2개 합의
- Low: 단일 주장
- Executive Summary는 High/Medium만 사용
```

## 5. 기대 효과
- UI 잡음 제거로 **원문 신뢰도 상승**
- 수치 환각 감소 → “정량적 신뢰성” 강화
- 합의/불일치가 실제 근거 기반으로 정리됨
- NotebookLM 대비 **의사결정 활용도 상승**

## 6. 다음 단계 제안
1) 정제 필터 강화부터 적용
2) Final Synthesis 프롬프트에 합의/신뢰도 규칙 삽입
3) “정량 근거 검증”을 고정 룰로 반영
