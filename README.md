# Multi-GPT Analyzer (AI Search Portal)

여러 AI 서비스(Perplexity, ChatGPT, Gemini, Claude)에 동시에 프롬프트를 전송하고 응답을 비교 분석하는 멀티 에이전트 기반 분석 플랫폼입니다.

## 🚀 주요 기능
- **통합 프롬프트 전송**: 한 번의 입력으로 4개의 AI 서비스에 동시 질문
- **실시간 타임라인**: 각 AI의 응답 진행 상태를 실시간으로 확인 (Socket.io)
- **에이전트 기반 검증**: AI들 간의 상호 교차 검증 및 종합 요약 기능
- **브라우저 자동화**: Puppeteer를 이용한 실제 브라우저 기반 데이터 추출
- **인증 유지**: 세션 저장을 통해 매번 로그인할 필요 없이 서비스 이용 가능

## 🛠 기술 스택
- **Frontend**: React (Vite), TailwindCSS, Lucide-React
- **Backend**: Node.js, Express, Puppeteer, Socket.io
- **Automation**: Puppeteer-extra-plugin-stealth

## 📋 시작하기 (Installation)

다른 PC에서 이 프로젝트를 클론한 후 아래 순서대로 환경을 설정하세요.

### 1. 레포지토리 클론
```bash
git clone https://github.com/djyalu/ai-search-portal.git
cd ai-search-portal
```

### 2. 의존성 패키지 설치
클라이언트와 서버 각각 설치가 필요합니다.

**Client:**
```bash
cd client
npm install
```

**Server:**
```bash
cd ../server
npm install
```

### 3. AI 서비스 인증 설정 (중요)
브라우저 자동화를 위해 각 서비스의 로그인이 필요합니다. 아래 명령어를 실행하여 열리는 브라우저에서 4개 서비스(Perplexity, ChatGPT, Gemini, Claude)에 로그인을 완료하세요.

```bash
# server 폴더 내에서 실행
node setup_auth.js
```
*로그인이 완료되면 브라우저를 닫아주세요. 인증 정보는 `server/user_data` 폴더에 안전하게 저장됩니다.*

## 🏃 실행 방법 (Running)

프로젝트를 실행하려면 클라이언트와 서버를 각각 실행해야 합니다.

**Server 실행:**
```bash
cd server
npm run dev
```

**Client 실행:**
```bash
cd client
npm run dev
```

기본적으로 클라이언트는 `http://localhost:5173`, 서버는 `http://localhost:3000`에서 작동합니다.

## ⚠️ 주의사항
- `server/user_data` 폴더는 개인의 인증 세션을 포함하므로 절대 공유하거나 공용 PC에서 방치하지 마세요. (이미 `.gitignore`에 포함되어 있습니다.)
- AI 서비스의 사이트 구조가 변경될 경우 `server/puppeteer_handler.js`의 Selector를 업데이트해야 할 수 있습니다.

---
**Developed by Antigravity (Multi-Agent AI Assistant)**
