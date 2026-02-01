# 레포팅 기능 고도화 제안서

작성일: 2026-02-01
대상: AI Search Portal (Multi-GPT Analyzer)
목표: 고품질 종합 인텔리전스 보고서 생성(NotebookLM 이상 퀄리티)

---

## 1) 방향성 요약
- **의사결정 중심**: 1페이지 내 핵심 결론·리스크·액션이 보이도록 구성
- **증거-주장 연결**: 모든 인사이트에 근거/신뢰도 매핑
- **가독성 중심 레이아웃**: 표/도식/요약을 우선 배치
- **일관된 품질 규칙**: QA 규칙 기반 자동 검증

---

## 2) 레포트 레이아웃 구성 (권장 기본 템플릿)

### 2.1 Cover
- 제목, 생성일, 분석 대상, 사용 에이전트, 분석 신뢰도

### 2.2 Executive Summary (1페이지)
- 핵심 결론 3줄
- 주요 리스크 1~2개
- 권고 액션 1개

### 2.3 핵심 인사이트 Top 5 (테이블)
| 인사이트 | 근거 요약 | 영향도(H/M/L) | 신뢰도(High/Med/Low) |
|---|---|---|---|
| ... | ... | ... | ... |

### 2.4 합의 vs 불일치 매트릭스
| 관점 | 합의 내용 | 불일치/충돌 |
|---|---|---|
| ... | ... | ... |

### 2.5 구조적 원인-경로-결과
- 원인(Drivers)
- 전개 메커니즘(Path)
- 최종 결과(Impact)

### 2.6 시나리오 플래닝
| 시나리오 | 가능성 | 핵심 조건(Trigger) | 예상 파급효과 |
|---|---|---|---|
| Base | ... | ... | ... |
| Bull | ... | ... | ... |
| Bear | ... | ... | ... |

### 2.7 리스크 & 불확실성
- 데이터 공백
- 추정 및 가설
- 외부 변수

### 2.8 전략 옵션 & 권고 액션
- 옵션 A (공격)
- 옵션 B (방어)
- 권장 방향

### 2.9 모니터링 체크리스트
- KPI / 확인 주기

### 2.10 부록
- 에이전트 상태
- 원자료 스냅샷 (요약)

---

## 3) 시각화/레이아웃 설계 원칙

### 3.1 레이아웃 그리드
- **12 컬럼 기반**
- Executive Summary는 2단 구성 (좌: 결론 / 우: 리스크·액션)

### 3.2 컬러/타이포
- 색상 의미 체계: 리스크=red, 기회=green, 중립=gray
- 가독성 중심 폰트 (예: IBM Plex Sans)
- 제목 24~28px / 본문 12~14px 기준

### 3.3 차트/도식 구성
- Insight Summary: Impact x Confidence 매트릭스
- Risk: Heatmap
- Scenario: 3열 테이블 + 요약 박스
- Drivers: Flow 다이어그램

---

## 4) 코드 구현 방안

### 4.1 보고서 스키마 정의
- `server/report_schema.js`
```js
export const ReportSchema = {
  meta: { title: '', date: '', agents: [], confidence: '' },
  executive_summary: { conclusions: [], risks: [], actions: [] },
  insights: [],
  consensus_matrix: [],
  causal_chain: { drivers: [], path: [], impact: [] },
  scenarios: [],
  risks: { gaps: [], assumptions: [], externals: [] },
  actions: { options: [], recommendation: '' },
  monitoring: [],
  appendix: { agent_status: {}, raw_snapshot: '' }
};
```

### 4.2 템플릿 렌더링
- `server/report_renderer.js`
- Markdown 출력 형식 고정
- 섹션 헤더 + 테이블 자동 생성

### 4.3 QA 검증 모듈
- `server/report_validator.js`
- 규칙
  - Executive Summary에는 High 신뢰도만 사용
  - 숫자/비율 등장 시 출처 없으면 "추정" 표기
  - Low 신뢰도 인사이트는 본문만 포함

### 4.4 레이아웃 UI 템플릿 (클라이언트)
- `client/src/components/report/`
  - `ReportLayout.tsx`
  - `ExecutiveSummary.tsx`
  - `InsightTable.tsx`
  - `ScenarioTable.tsx`
  - `RiskHeatmap.tsx`
- Tailwind 기반 카드/그리드 구성

---

## 5) 구현 단계 로드맵

### Phase 1 (품질 규칙 고정)
- ReportSchema + Validator 도입
- Executive Summary 규칙화

### Phase 2 (레이아웃/시각화)
- UI 템플릿 구성
- 시각화 컴포넌트 적용

### Phase 3 (고급 기능)
- PDF/Docx 내보내기
- 자동 목차/그림 번호

---

## 6) 적용 후 검증 체크리스트
- [ ] Executive Summary 3줄 내로 유지
- [ ] 모든 인사이트에 근거/신뢰도 표기
- [ ] Low 신뢰도는 요약 제외
- [ ] 출력 레이아웃 일관성 유지
- [ ] PDF 내보내기 정상 동작

---

## 7) 바로 적용 가능한 다음 작업
1) `ReportSchema` + `report_validator.js` 추가
2) Markdown 템플릿 렌더러 적용
3) UI 컴포넌트 스켈레톤 생성

