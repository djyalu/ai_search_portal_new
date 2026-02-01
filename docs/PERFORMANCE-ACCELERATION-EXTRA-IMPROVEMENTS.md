# 추가 개선안 제안서 (2026-02-01)

목적: 현재 구현 이후 발견된 추가 개선 포인트 정리

---

## 1) 동시 분석 락/큐
**현황 문제**  
서버가 동시 요청을 바로 실행하여 `globalContext`/`globalPagePool` 충돌 위험 존재.

**개선안**  
- 전역 `isAnalyzing` 플래그 + 429 응답.  
- 또는 FIFO 큐 도입(선택).

---

## 2) Fail‑Fast 조건 강화
**현황 문제**  
Perplexity/Gemini에서 `candidate null` 반복 시 수집 루프가 최대 대기 시간까지 지속.

**개선안**  
- N회 연속 null + Stop 없음 → 즉시 종료.  
- `signed out`는 재시도 없이 즉시 실패 처리.

---

## 3) 동적 minLength
**현황 문제**  
고정 minLength가 짧은 답변에 불리하여 재시도와 대기 증가.

**개선안**  
- 프롬프트 길이 기반 동적 minLength.  
- Perplexity/Gemini 별 최소/최대 범위 설정.

---

## 4) Claude 컨테이너 제한 + 키워드 확장
**현황 문제**  
Claude UI 텍스트 혼입 가능성.

**개선안**  
- `[data-testid="chat-message"]` 내 assistant role 제한.  
- UI 키워드 확장(Artifacts/Projects/Workspace/Usage 등).  

---

## 5) Reasoning 캐시 TTL
**현황 문제**  
캐시 만료가 없어 오래된 전략 재사용 가능.

**개선안**  
- `{ value, storedAt }` 구조로 TTL 적용(예: 30분).

---

## 6) 글로벌 컨텍스트 재활성화 정책
**현황 문제**  
`globalContext`가 무기한 유지되어 장기 실행 시 메모리/세션 누적 위험.

**개선안**  
- N회 실행 후 컨텍스트 재생성.  
- idle 시간 초과 시 자동 폐기.

---

## 7) 리소스 블로킹 정책 세분화
**현황 문제**  
글로벌 차단이 UI 안정성에 영향을 줄 수 있음.

**개선안**  
- 사이트별로 폰트 차단 예외.  
- 초기 로드 후 차단 적용 전략 검토.

---

## 8) 정제 단계 비용 절감
**현황 문제**  
polling 루프마다 sanitize/normalize 반복 수행.

**개선안**  
- candidate가 변경될 때만 정제 수행.  
- 길이 임계치 이후에만 normalize 실행.

---

## 권장 적용 순서
1) 동시 분석 락/큐  
2) Fail‑Fast + minLength 동적화  
3) Claude 정제 강화  
4) Reasoning 캐시 TTL  
5) 글로벌 컨텍스트 재활성화 정책  
6) 리소스 블로킹 세분화  
7) 정제 비용 절감

