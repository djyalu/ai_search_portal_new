# 지능형 분석 엔진 고도화 제안서 (Analysis Engine v2.5)

## 1. 개요
최근 ONDS(티커) 사례 및 Gemini 로그인 이슈를 통해 확인된 분석 엔진의 한계를 극복하고, 지식의 정확도와 수집 안정성을 세계 최고 수준으로 끌어올리기 위한 기술 개선안입니다.

## 2. 핵심 로직 개선 과제

### 과제 A: 지식 동기화 브릿지 (Knowledge Bridge)
- **문제**: 에이전트 간 지식 불일치 (Hallucination)
- **해결**: Perplexity 검색 데이터를 XML 태그(` <SEARCH_CONTEXT>`)로 구조화하여 Claude/Gemini 프롬프트에 동적 주입.
- **기대효과**: 최신 정보(Ondas Holdings)를 낡은 지식(Oncorus)보다 우선 사용하도록 강제.

### 과제 B: 적응형 응답 안정성 (Adaptive Stability)
- **문제**: AI의 사고 지연 시 조기 수집 종료
- **해결**: fixed polling(2s)에서 loading-aware polling으로 전환. AI의 타이핑 상태 아이콘 감지 로직 추가.
- **기대효과**: 긴 보고서의 끊김 없는 수집 보장.

### 과제 C: 중첩 Shadow DOM 추출 엔진
- **문제**: Gemini 등 복잡한 UI에서의 데이터 누락
- **해결**: Recursive Shadow-Root Traversal 알고리즘 적용. CSS 선택자를 넘어선 텍스트 노드 직접 추출.
- **기대효과**: 수집 성공률 99% 달성.

### 과제 D: 상호 검증(Cross-Check) 엄격 모드
- **문제**: 에이전트 간 오류 방관
- **해결**: 논리 검증 단계에 '티커/수치 불일치 전용 체크리스트' 도입. 불일치 발견 시 즉시 'High Alert' 등급 부여.

## 3. 구현 로드맵
- **Phase 1**: Context Injection 로직 적용 (완료)
- **Phase 2**: Shadow DOM 탐색 엔진 고도화 (진행중)
- **Phase 3**: 자가 치유(Self-Healing) 세션 관리 도입 (계획)

---
*작성일: 2026-01-29*
*승인: 아키텍트 & 분석 설계자 에이전트*
