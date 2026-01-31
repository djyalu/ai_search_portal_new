# RALPH Agent Structural Improvement Plan: ChatGPT & Claude

## 1. reasoning (문제 분석)
현재 ChatGPT와 Claude 에이전트 작업이 "데이터 스트리밍 중" 상태에서 멈추는 주된 원인은 다음과 같습니다:
- **전송 실패 (Send Failure)**: 입력창에 텍스트가 입력되었으나, 전송 버튼이 활성화되지 않거나 클릭이 씹히는 현상.
- **상태 오판 (Thinking Detection)**: AI가 응답을 시작했음에도 불구하고 시스템이 여전히 "생균 중"인 상태로 오인하거나, 반대로 아직 생성 중인데 멈춘 것으로 판단하여 빈 값을 반환함.
- **셀렉터 변화 (DOM Instability)**: 서비스 업데이트로 인해 기존 CSS 셀렉터가 무효화되어 텍스트를 추출하지 못함.
- **세션 미로그인 (Auth Issue)**: 세션이 만료되었거나 모달창이 입력 프로세스를 가로막고 있음.

## 2. agency (개선 도구 및 전략)
- **Shadow DOM 무시 추출**: 더 강력한 DOM 트래버스 로직을 통해 텍스트를 안정적으로 수집함.
- **입력-전송 동기화 가속**: `insertText`와 `keyboard.press('Enter')`의 타이밍을 최적화하고, 실패 시 `Control+Enter` 등 대안을 시도함.
- **적응형 완료 감지**: 단순 타이머가 아닌 텍스트 길이 변화 + 버튼 상태 변화를 동시 모니터링함.

## 3. logic (구조적 개선안)
### A. 시퀀스 최적화 (React Input Fix)
1. **Hybrid Typing**: `insertText`만으로는 React State가 업데이트되지 않는 문제를 해결하기 위해, **Focus -> KeyA -> Backspace -> Type** 시퀀스를 적용하여 사람의 입력을 완벽하게 모사함.
2. **Robust Sending**: 버튼 클릭 실패 시 `Control+Enter` -> `Enter` 순으로 폴백(Fallback) 전송을 시도함.

### B. 셀렉터 고도화
- **ChatGPT**: `[data-testid*="conversation-result"]` 뿐만 아니라 가장 최근의 `.markdown` 객체를 타겟팅함.
- **Claude**: `.font-claude-message`가 실패할 경우 `[data-testid="message-text"]` 형식을 우선 탐색함.

### C. 세션 진단 강화
- `isClaudeSignedOut`, `isChatGPTSignedOut` (신규) 함수를 통해 상태를 즉시 UI에 피드백함.

## 4. polish (가독성 및 피드백)
- "데이터 스트리밍 중" 대신 "입력 중", "전송 중", "응답 대기 중" 등으로 세분화하여 로그 출력.

## 5. hierarchy (실행 계획)
1. `server/playwright_handler.js` 내 에이전트별 특수 처리 로직 재작성.
2. `isChatGPTSignedOut` 로직 추가.
3. 전송 버튼 클릭 실패 시 재시도 로직 강화.
