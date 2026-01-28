# Agent Instructions (AI Search Portal)

## Project snapshot
- Name: AI Search Portal (Multi-GPT Analyzer)
- Stack: React (Vite) + Tailwind (client), Node.js + Express + Playwright (server)
- Language: Korean for UX copy, English for code

## Repo layout
- `client/`: React UI
- `server/`: API + automation
- `docs/`: documentation and specs

## Common commands
- Install: `npm install` (run in `client/` and `server/`)
- Auth setup: `node setup_auth_playwright.js` (run in `server/`)
- Dev: `npm run dev` (run in `server/` and `client/`)

## Working rules
- Prefer `rg` for search.
- Avoid touching `user_data/` and `history.db` unless explicitly requested.
- Keep UX copy in Korean; keep code identifiers in English.
- Place proposals/specs in `docs/` unless told otherwise.
