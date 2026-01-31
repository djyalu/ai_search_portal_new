# Gemini/Claude 분석 실패 원인 및 개선 방안

## 1) 상황 요약
- 다수의 주가/정책 관련 질문이 연속 입력됨
- 프롬프트 내에 **“웹 검색/도구 사용 금지”** 같은 제약이 포함됨
- Gemini/Claude가 “제대로 분석 못한다”는 체감 발생

## 2) 코드 기반 원인 가설 (우선순위)
### P0. 로그인/세션 만료
- Playwright 경로에서 Gemini는 `isGeminiSignedOut` 검사에 걸리면 즉시 실패 처리됨.
- Claude도 storageState 미사용/만료 시 로그인 화면 노출로 입력이 무시될 수 있음.

### P0. 입력/전송 셀렉터 미스매치
- Gemini/Claude UI가 변경되면 입력 셀렉터가 전부 실패할 수 있음.
- `tryClickSend`는 범용 셀렉터 위주라 Gemini/Claude 전용 버튼을 못 찾을 수 있음.
- **증상**: 입력 성공 로그 없이 “입력란을 찾을 수 없음” 혹은 응답 미수신.

### P1. 응답 셀렉터 미스매치 / Shadow DOM 변경
- Gemini는 `model-response` 및 shadowRoot 기반 추출을 사용함.
- Claude는 `.font-claude-message`, `[data-testid="message-content"]` 등 특정 구조 의존.
- UI 업데이트 시 응답을 못 읽고 빈 스트림으로 남을 수 있음.

### P1. 과도한 정제(sanitize)로 실제 답변 누락
- `sanitizeGeminiOutput`가 UI 문구 제거 과정에서 실제 본문까지 제거될 수 있음.
- prompt 라인과 일치하는 문장은 전부 제거됨 → 짧은 답변이 빈 문자열이 될 수 있음.

### P1. 프롬프트 길이/형식 문제
- 입력 텍스트에 **중복 질문 + 규칙 블록**이 반복되어 길이가 과도해짐.
- Claude는 긴 규칙/중복 텍스트에 취약하며, 답변 지연/회피가 발생할 수 있음.

### P2. 안정성 루프/최소 길이 조건
- `minLength`와 `stableCount` 조건이 Gemini/Claude 특성에 맞지 않으면 짧은 답변을 버릴 수 있음.

### P2. 반자동 UI 정책/봇 감지
- Stealth 플러그인 사용 중이나, 특정 UI 변화/보안 정책에 따라 응답이 제한될 수 있음.

## 3) 개선 방안 (실행 가능한 조치)
### A. 세션 안정화
- `setup_auth_playwright.js`를 주기적으로 재실행하여 storageState 갱신
- Gemini/Claude 전용 storageState 분리 검토

### B. 입력/전송 셀렉터 보강
- Gemini: 최신 입력 영역/버튼 셀렉터 추가
- Claude: 전용 전송 버튼 셀렉터 보강

### C. 응답 추출 보강
- Gemini/Claude 응답 셀렉터를 확대하고, 필요 시 `main`/`article` fallback 허용
- Shadow DOM 탐색 실패 시 일반 DOM fallback 수행

### D. sanitize 완화
- Gemini 정제 규칙에서 prompt 완전 일치 제거만 수행
- 길이 기준 완화(예: 12~15자 이상은 허용)

### E. 프롬프트 정리
- 중복 질문 제거 (동일 질문 1회만 전달)
- 규칙 블록은 1회만 삽입하고 길이 제한 적용
- 주가 질문은 **티커/기간/기준 시점**을 최소 형태로 축약

## 4) 운영 가이드 (실사용 기준)
- 동일 질문 반복 입력은 피하고, 핵심 질문 1개 + 짧은 규칙만 전달
- “도구 금지” 규칙은 시스템 단에서만 적용하고 프롬프트에는 최소화
- 응답 실패 시 **로그인 상태/DOM 셀렉터**를 우선 확인

- **Date**: 2026-01-23
- **Action**: Implementing improvements based on `docs/AGENT-FAILURE-ANALYSIS.md`.

## 5) 최신 장애 사례 및 조치 결과 (2026-01-29)

### 🚨 사례: ONDS 티커 오인식 (Claude Hallucination)
- **현상**: Claude가 ONDS를 'Oncorus, Inc.'로 잘못 인식하여 분석함 (ONDS는 실제 Ondas Holdings임).
- **원인**: Claude의 내부 지식(2025년 1월 이전 데이터)이 제공된 검색 데이터보다 우선 작동함.
- **조치**: 
  - `playwright_handler.js` 내 Claude 프롬프트에 `[CRITICAL RULES]` 추가. 
  - "제공된 실시간 데이터를 내부 지능보다 우선 신뢰할 것" 및 "티커 자의적 해석 금지" 명시.
  - 논리 검증(Logic Phase) 프롬프트에 '할루시네이션/오동작 감지' 섹션 필수화.

### 🚨 사례: Gemini 분석 불가 (로그인 이슈 의혹)
- **현상**: Gemini가 응답을 주지 않거나 타임아웃 발생.
- **원인**: Gemini UI의 로그인 버튼 구조가 변경되어 시스템이 '로그아웃 상태'를 제대로 감지하지 못하고 분석을 시도함.
- **조치**: 
  - `isGeminiSignedOut` 로직 강화 (XPath '로그인/Sign in' 문구 직접 검사 추가).
  - 다국어 UI(한국어/영어) 대응 및 최신 로그인 섹션 셀렉터 보강.
  - 사용자가 즉시 인지할 수 있도록 명확한 "Gemini is signed out..." 경고 메시지 반환 유도.

---
*마지막 업데이트: 2026-01-29 (Phase 23 연계)*
