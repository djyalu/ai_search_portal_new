# GEMINI 지능 엔진 진단 및 최적화 보고서 (Diagnosis & Optimization)

본 문서는 Multi-Agent 시스템 내 **Gemini** 워커의 안정적인 데이터 수집 및 분석을 위한 장애 분석과 개선 전략을 다룹니다.

---

## 1. 시스템 아키텍처 개요
- **런타임**: Node.js / Playwright (Edge/Chromium)
- **핸들러**: `server/playwright_handler.js`
- **핵심 모듈**: 
  - `runExhaustiveAnalysis`: RALPH 파이프라인 총괄
  - `getGeminiResponseText`: Shadow DOM 포함 응답 추출 로직
  - `sanitizeGeminiOutput`: 불필요한 UI 텍스트 제거 및 데이터 정제
  - `setup_auth_playwright.js`: 세션 영속성 관리 (`storageState.json`)

---

## 2. 주요 장애 유형 및 원인 분석 (Root Cause Analysis)

### 🔴 P0: 인증 및 세션 만료 (Auth & Session)
- **현상**: "Gemini is signed out..." 메시지 반환 또는 빈 화면.
- **원인**: 
  - `storageState.json` 토큰 만료 또는 생성 실패.
  - 구글 보안 정책에 의한 자동 로그아웃.
- **해결책**:
  - `setup_auth_playwright.js`를 재실행하여 수동 로그인 및 세션 갱신.
  - `isGeminiSignedOut` 함수를 통한 사전 검증 강화.

### 🔴 P0: 입력 셀렉터 불일치 (Selector Mismatch)
- **현상**: "에러: 입력란을 찾을 수 없음" 발생.
- **원인**: Gemini UI 업데이트로 인한 `ql-editor` 클래스명 변경 또는 DOM 구조 변화.
- **현재 후보군**:
  - `rich-textarea .ql-editor[contenteditable="true"]`
  - `[data-node-type="input-area"] .ql-editor[contenteditable="true"]`
  - `div.ql-editor[contenteditable="true"]`
- **전술**: `tryClickSend` 및 다중 셀렉터 순회 로직 적용 중.

### 🟡 P1: Shadow DOM 응답 추출 실패
- **현상**: 분석 중 스트리밍 카드가 갱신되지 않거나 최종 결과가 `null`.
- **원인**: Gemini는 답변이 `model-response` 태그 내부의 **Shadow Root**에 위치함.
- **해결책**: 
  - `getGeminiResponseText`에서 `shadowRoot` 내부의 `[data-testid="response-content"]` 탐색.
  - Shadow DOM 접근 실패 시 `article` 또는 `main` 태그로 Fallback 탐색.

### 🟡 P1: 과도한 텍스트 정제 (Over-Sanitization)
- **현상**: 답변 내용 중 일부가 누락되거나 매우 짧게 출력됨.
- **원인**: `sanitizeGeminiOutput`에서 `promptText`와 겹치는 줄을 삭제하는 로직이 본문까지 삭제.
- **해결책**: 
  - `minLength` 기준을 20자로 하향 조정.
  - 완전 일치하는 경우에만 제거하도록 필터링 규칙 정교화.

---

## 3. 디버깅 및 가동 체크리스트

| 체크 항목 | 확인 방법 | 기대 결과 |
| :--- | :--- | :--- |
| **로그인 상태** | `isGeminiSignedOut(page)` 실행 | `false` 반환 |
| **입력 가능 여부** | `waitForSelector(sel)` 성공 여부 | 입력창 포커싱 및 텍스트 주입 |
| **응답 가시성** | `model-response` 태그 존재 확인 | Shadow Root 내 텍스트 존재 |
| **세션 파일 존재** | `user_data_session_*/storageState.json` 확인 | 파일 존재 및 최근 수정 시간 |

---

## 4. 향후 최적화 로드맵 (Phase 21+)

### A. 자가 치유(Self-healing) 메커니즘
- 셀렉터 실패 시 AI(Claude/GPT)가 현재 페이지의 HTML을 분석하여 실시간으로 셀렉터를 제안하는 'Dynamic Selector Strategy' 도입 검토.

### B. 성능 및 안정성 튜닝
- **SERVICE_MAX_WAIT**: 현재 80초 고정 → 네트워크 상태에 따른 가변 타임아웃 적용.
- **Stable Count**: 응답 완료 판정 기준(2회 연속 동일 텍스트)을 문장 부호 및 길이 기반으로 고도화.

### C. 가독성 개선 연계
- `ReportMeta` 블록과 연계하여 Gemini의 분석 품질(신뢰도)을 메타 데이터로 추출하여 UI에 표시.

---
*마지막 업데이트: 2026-01-29*
*작성자: 분석 설계자 & 아키텍트 에이전트*
