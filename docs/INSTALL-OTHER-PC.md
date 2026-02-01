# 다른 PC 설치 가이드

대상: AI Search Portal (Multi-GPT Analyzer)

---

## 0) 전제 조건
- Node.js LTS 설치
- Chrome 또는 Microsoft Edge 설치 (Playwright 채널용)
- Git 설치

---

## 1) 소스코드 가져오기
```bash
git clone <REPO_URL>
cd "AI Search Portal (new)"
```

---

## 2) 의존성 설치
각 폴더에서 설치 필요
```bash
cd server
npm install

cd ../client
npm install
```

---

## 3) 환경변수 설정
`server/.env` 파일 생성 후 항목 채우기
```env
PORT=3000
CLIENT_ORIGIN=http://localhost:5173
NOTION_TOKEN=your_notion_token
NOTION_DATABASE_ID=your_database_id
BROWSER_CHANNEL=msedge
BROWSER_HEADLESS=false
BROWSER_SLOWMO=40
```

---

## 4) Playwright 로그인 세션 생성
서버 폴더에서 실행
```bash
cd server
node setup_auth_playwright.js
```
- ChatGPT / Gemini / Claude / Perplexity 각각 로그인
- 로그인 후 브라우저를 닫으면 세션 저장됨

---

## 5) 실행
서버와 클라이언트 각각 실행
```bash
# server
cd server
npm run dev

# client
cd ../client
npm run dev
```

---

## 6) 접속
- 브라우저에서 `http://localhost:5173` 접속

---

## 7) 주의사항
- `user_data/`, `history.db` 는 PC마다 별도 생성됨  
- 기존 PC의 세션 데이터를 복사하지 않으면 로그인 재인증 필요  
- `BROWSER_CHANNEL`에 맞는 브라우저가 설치되어 있어야 함  

