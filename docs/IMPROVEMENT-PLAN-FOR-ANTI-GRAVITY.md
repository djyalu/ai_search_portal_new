# 개선안 제시 (문서 전용)

대상: anti gravity 코드 구현용 가이드  
목표: 4개 서비스 동시 수집 안정화 + 대기 시간 단축 + 오류 최소화

---

## 1) 핵심 병목 요약
가장 큰 문제는 **Dispatch(전송) 불안정**이다.  
`send_failed` 반복과 전송 검증 지연(Perplexity 50초+)이 전체 지연의 주 원인.

---

## 2) 우선순위 개선안

### 2-1. Dispatch 안정화 (최우선)
**목표**: send_failed 제거, 전송 성공률 상승

**개선 아이디어**
- 전송 검증 기준 최소화:
  - Perplexity는 Stop 버튼 대신 **응답 컨테이너 등장** 기준으로 즉시 성공 처리
  - ChatGPT/Gemini/Claude도 “입력 메시지 반영” 또는 “응답 노드 생성”만 확인
- 전송 체인 통일:
  - Click → Paste → Ctrl+Enter → Enter → Send 버튼 순서
- 입력 확인:
  - 입력 영역 텍스트 변화 여부 체크로 “입력 실패” 즉시 감지

---

### 2-2. Fail‑Fast 조건 도입
**목표**: 의미 없는 대기 시간 제거

**개선 아이디어**
- 후보 텍스트가 연속 N회 null이면 즉시 종료  
- `signed out` / `send_failed`는 재시도 없이 즉시 실패 처리

---

### 2-3. minLength 동적화
**목표**: short_output 반복 감소

**개선 아이디어**
- 프롬프트 길이 기반 동적 minLength
- Perplexity/Gemini별 최소/최대 범위 설정

---

### 2-4. Gemini stopped 처리 개선
**목표**: gemini_stopped 반복 제거

**개선 아이디어**
- stopped 2회 이상 연속 시 즉시 실패 처리
- 세션 재검증 안내(로그인 문제 감지)

---

### 2-5. Claude 정제 강화
**목표**: UI 잡음 혼입 제거

**개선 아이디어**
- 컨테이너를 assistant role로 제한
- UI 키워드 필터 확장(Artifacts, Projects, Workspace, Usage 등)
- 정제 단계 분리:
  - 수집 단계: 최소 정제
  - 보고서 단계: 강한 정제

---

## 3) 적용 순서(권장)
1. Dispatch 안정화  
2. Fail‑Fast 조건 도입  
3. minLength 동적화  
4. Gemini stopped 처리 개선  
5. Claude 정제 강화  

---

## 4) 완료 기준
- send_failed 반복 발생 0회  
- Perplexity dispatch 검증 시간 20초 이하  
- Gemini stopped 반복 발생 0회  
- 전체 응답 대기 시간 30% 이상 단축  

