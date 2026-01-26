import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

chromium.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Env-driven browser configuration (see README for spec)
const BROWSER_CHANNEL = process.env.BROWSER_CHANNEL || 'chromium'; // chromium | msedge | chrome
const BROWSER_HEADLESS = process.env.BROWSER_HEADLESS ? process.env.BROWSER_HEADLESS === 'true' : false;
const BROWSER_SLOWMO = process.env.BROWSER_SLOWMO ? parseInt(process.env.BROWSER_SLOWMO, 10) : 40;
const USER_DATA_BASE = process.env.USER_DATA_BASE || 'user_data_session';
const USER_DATA_DIR = path.join(__dirname, `${USER_DATA_BASE}_${BROWSER_CHANNEL}`);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function saveDebugArtifacts(page, name) {
    try {
        const stamp = Date.now();
        const imgPath = path.join(__dirname, `playwright-debug-${name}-${stamp}.png`);
        const htmlPath = path.join(__dirname, `playwright-debug-${name}-${stamp}.html`);
        await page.screenshot({ path: imgPath, fullPage: true }).catch(()=>{});
        const html = await page.content().catch(()=>null);
        if (html) fs.writeFileSync(htmlPath, html, 'utf8');
        // prune old debug artifacts to avoid disk filling
        try { pruneDebugArtifacts(); } catch(_) {}
        return { imgPath, htmlPath };
    } catch (err) {
        return { error: err.message };
    }
}

function pruneDebugArtifacts(options = {}) {
    const dir = __dirname;
    const maxFiles = options.maxFiles || 200;
    const maxAgeDays = options.maxAgeDays || 30;
    const files = fs.readdirSync(dir)
        .filter(f => f.startsWith('playwright-debug-') && (f.endsWith('.png') || f.endsWith('.html')))
        .map(f => ({ name: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => a.mtime - b.mtime);

    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    for (const file of files) {
        try {
            if (file.mtime < cutoff) fs.unlinkSync(file.path);
        } catch(_) {}
    }

    // reload list and enforce maxFiles
    const remaining = fs.readdirSync(dir)
        .filter(f => f.startsWith('playwright-debug-') && (f.endsWith('.png') || f.endsWith('.html')))
        .map(f => ({ name: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => a.mtime - b.mtime);

    if (remaining.length > maxFiles) {
        const toRemove = remaining.slice(0, remaining.length - maxFiles);
        for (const file of toRemove) {
            try { fs.unlinkSync(file.path); } catch(_) {}
        }
    }
}

/**
 * Robust Text Extraction with Polling
 */
async function getCleanText(page, selectors, options = {}) {
    const { allowFallback = true } = options;
    return await page.evaluate(({ sels, allowFallbackIn }) => {
        for (const sel of sels) {
            try {
                const elements = document.querySelectorAll(sel);
                if (elements.length > 0) {
                    let text = elements[elements.length - 1].innerText.trim();
                    if (text.length > 0) return text;
                }
            } catch (e) { /* ignore invalid selectors */ }
        }
        if (allowFallbackIn) {
            // fallback: try common containers
            try {
                const main = document.querySelector('main') || document.querySelector('[role="main"]');
                if (main && main.innerText && main.innerText.trim().length > 0) return main.innerText.trim();
            } catch (e) {}
            try {
                if (document.body && document.body.innerText && document.body.innerText.trim().length > 0) return document.body.innerText.trim();
            } catch (e) {}
        }
        return null;
    }, { sels: selectors, allowFallbackIn: allowFallback });
}

function sanitizeClaudeOutput(text) {
    if (!text) return text;
    const lines = text.split('\n');
    const filtered = lines.filter((line) => {
        const l = line.trim();
        if (!l) return true;
        const lower = l.toLowerCase();
        const stopLabels = new Set([
            'new chat', 'search', 'chats', 'projects', 'artifacts', 'code', 'recents', 'hide',
            'all chats', 'history', 'recent', 'share', 'free plan', 'upgrade', 'account', 'settings'
        ]);
        if (stopLabels.has(lower)) return false;
        if (lower.includes('search results')) return false;
        if (lower === 'sources' || lower.startsWith('source')) return false;
        if (lower.startsWith('http://') || lower.startsWith('https://')) return false;
        if (/(^|\s)([a-z0-9-]+\.)+(com|net|org|ai|io|co|kr|us|uk|edu|gov|jp|cn|de)(\b|\/)/i.test(l)) return false;
        return true;
    });
    const cleaned = filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return cleaned.length > 0 ? cleaned : text;
}

function sanitizePerplexityOutput(text) {
    if (!text) return text;
    const stopLabels = new Set([
        'history', 'recent', 'discover', 'spaces', 'finance', 'travel', 'academic', 'more',
        'account', 'upgrade', 'install', 'answer', 'links', 'images', 'ask a follow-up',
        'search', 'searching', 'reviewing sources', 'thinking', 'powered by'
    ]);
    const lines = text.split('\n');
    const filtered = lines.filter((line) => {
        const l = line.trim();
        if (!l) return true;
        const lower = l.toLowerCase();
        if (stopLabels.has(lower)) return false;
        if (lower.startsWith('searching')) return false;
        if (lower.startsWith('reviewing sources')) return false;
        if (lower.startsWith('sources')) return false;
        if (lower.startsWith('links')) return false;
        if (lower.startsWith('images')) return false;
        if (lower.startsWith('ask a follow-up')) return false;
        if (lower.startsWith('powered by')) return false;
        // strip pure domain lines / source list items
        if (/(^|\s)([a-z0-9-]+\.)+(com|net|org|ai|io|co|kr|us|uk|edu|gov|jp|cn|de)(\b|\/)/i.test(l)) return false;
        return true;
    });
    const cleaned = filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return cleaned.length > 0 ? cleaned : text;
}

function sanitizeGeminiOutput(text, promptText = '') {
    if (!text) return text;
    const promptLines = promptText
        ? promptText.split('\n').map(line => line.trim()).filter(Boolean)
        : [];
    const promptSet = new Set(promptLines);
    const lines = text.split('\n');
    const stopLabels = new Set([
        'gemini', 'conversation with gemini', 'fast', 'pro', 'your privacy', 'opens in a new window',
        'gemini can make mistakes', 'your privacy & gemini', 'feedback', 'report', 'share'
    ]);
    const stopExact = new Set(['한국어로 답변해줘.', '한국어로 답변해줘']);
    const filtered = lines.filter((line) => {
        const l = line.trim();
        if (!l) return true;
        const lower = l.toLowerCase();
        if (stopLabels.has(lower)) return false;
        if (promptSet.has(l)) return false;
        if (stopExact.has(l)) return false;
        if (lower.includes('gemini can make mistakes')) return false;
        if (lower.includes('opens in a new window')) return false;
        if (/(^|\s)([a-z0-9-]+\.)+(com|net|org|ai|io|co|kr|us|uk|edu|gov|jp|cn|de)(\b|\/)/i.test(l)) return false;
        return true;
    });
    const cleaned = filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return cleaned.length >= 20 ? cleaned : null;
}

async function getGeminiResponseText(page) {
    try {
        return await page.evaluate(() => {
            const readText = (node) => node && node.innerText ? node.innerText.trim() : '';
            const fromShadow = (host) => {
                if (!host) return '';
                if (host.shadowRoot) {
                    const inner = host.shadowRoot.querySelector(
                        '[data-testid="response-content"], [data-testid="assistant-response"], .markdown, .message-content, .assistant-response'
                    ) || host.shadowRoot;
                    return readText(inner);
                }
                return readText(host);
            };

            const responses = Array.from(document.querySelectorAll('model-response'));
            if (responses.length) {
                const texts = responses.map(fromShadow).filter(Boolean);
                if (texts.length) return texts[texts.length - 1];
            }

            const fallback = document.querySelectorAll('[data-testid="response-content"], [data-testid="assistant-response"]');
            if (fallback.length) return readText(fallback[fallback.length - 1]);
            return null;
        });
    } catch (_) {
        return null;
    }
}

async function isGeminiSignedOut(page) {
    try {
        return await page.evaluate(() => {
            const signInLink = document.querySelector('a[href*="/signin"], a[href*="/login"]');
            const signedOutDisclaimer = document.querySelector('[data-test-id="signed-out-disclaimer"]');
            const bodyText = document.body ? document.body.innerText || '' : '';
            return Boolean(signInLink || signedOutDisclaimer || bodyText.includes('Sign in'));
        });
    } catch (_) {
        return false;
    }
}

async function tryClickSend(page) {
    const sendSelectors = [
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]',
        'button[data-testid="send-button"]',
        'button[aria-label="Submit"]'
    ];
    for (const sendSel of sendSelectors) {
        const btn = await page.$(sendSel);
        if (btn && !(await btn.isDisabled().catch(() => false))) {
            await btn.click().catch(() => {});
            return true;
        }
    }
    return false;
}

/**
 * RALPH Based Multi-Agent Analysis
 * R: Reasoning (Plan)
 * A: Agency (Gather)
 * L: Logic (Validate)
 * P: Polish (Synthesize)
 * H: Hierarchy (Manage)
 */
export async function runExhaustiveAnalysis(prompt, onProgress, options = {}) {
    const enabledAgents = {
        perplexity: true,
        chatgpt: true,
        gemini: true,
        claude: true,
        ...(options?.enabledAgents || {})
    };
    const headlessAttempts = BROWSER_HEADLESS ? [true, false] : [false];
    let lastError;
    for (const attemptHeadless of headlessAttempts) {
        let browserContext;
        let browser = null;
        try {
        onProgress({ status: 'hierarchy_init', message: '[Hierarchy] RALPH 에이전시 파이프라인 가동...' });

        const launchOptions = {
            headless: attemptHeadless,
            args: ['--start-maximized', '--no-sandbox', '--disable-blink-features=AutomationControlled'],
            slowMo: BROWSER_SLOWMO
        };

        // Use Playwright bundled Chromium when channel is 'chromium' (omit channel option)
        if (BROWSER_CHANNEL !== 'chromium') launchOptions.channel = BROWSER_CHANNEL;

        // Always launch a browser instance and create an isolated context for this request.
        // If a storageState is available (created by setup_auth_playwright), use it to preserve login.
        const storageStatePath = path.join(USER_DATA_DIR, 'storageState.json');
        browser = await chromium.launch(launchOptions);
        if (fs.existsSync(storageStatePath)) {
            browserContext = await browser.newContext({ storageState: storageStatePath, viewport: null });
        } else {
            // ephemeral context avoids sharing USER_DATA_DIR across concurrent runs
            browserContext = await browser.newContext({ viewport: null });
        }

        // --- 1. Reasoning Phase (R) ---
        onProgress({ status: 'reasoning', message: '[Reasoning] 질의 의도 분석 및 에이전트 작업 설계 중...' });
        const planningPrompt = `질문: "${prompt}"\n이 질문을 가장 효과적으로 분석하기 위해 4개의 AI(Search, Reasoning, Creative, Logical)에게 각각 어떤 관점으로 질문하면 좋을지 전략을 간단히 요약해줘. 한국어로 작성해.`;

        let strategy = "Perplexity 비활성화로 계획 생략";
        if (!enabledAgents.perplexity) {
            strategy = "Perplexity 비활성화로 계획 생략";
        } else {
        const planningPage = await browserContext.newPage();
        strategy = "기본 분석 모드";
        try {
            await planningPage.goto('https://www.perplexity.ai/', { waitUntil: 'domcontentloaded', timeout: 60000 });
            try {
                // try multiple possible input selectors in order (include Perplexity-specific id)
                const planningInputs = ['#ask-input', '[data-lexical-editor="true"]', 'div[contenteditable="true"]', 'textarea', '#prompt-textarea'];
                let inputFound = false;
                for (const sel of planningInputs) {
                    try {
                        await planningPage.waitForSelector(sel, { timeout: 3000 });
                        // prefer fill, fallback to click+type
                        try { await planningPage.fill(sel, planningPrompt); } catch (_) {
                            await planningPage.click(sel).catch(()=>{});
                            await planningPage.keyboard.type(planningPrompt, { delay: 10 });
                        }
                        await planningPage.keyboard.press('Enter');
                        inputFound = true;
                        break;
                    } catch (_) { /* try next selector */ }
                }
                if (!inputFound) {
                    const dbg = await saveDebugArtifacts(planningPage, 'planning');
                    console.error('planning input selector not found', dbg);
                    throw new Error('planning input selector not found');
                }
            } catch (err) {
                await saveDebugArtifacts(planningPage, 'planning');
                throw err;
            }
            await delay(5000);
            strategy = await getCleanText(planningPage, ['.prose', '.result', '.message-content']) || "기본 전략 가동";
        } catch (err) {
            // keep going but log planning error
            strategy = `에러 발생: ${err.message}`;
        } finally { await planningPage.close(); }
        }

        // --- 2. Agency Phase (A) ---
        if (!Object.values(enabledAgents).some(Boolean)) {
            throw new Error('활성화된 에이전트가 없습니다.');
        }
        onProgress({ status: 'agency_gathering', message: `[Agency] 분석 전략 기반 데이터 수집 시작: ${strategy.substring(0, 50)}...` });

        const workers = [
            { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/', input: ['#ask-input', '[data-lexical-editor="true"]', 'div[contenteditable="true"]', 'textarea'], result: ['[data-testid="answer"]', '.prose', '.result', '.pplx-stream'] },
            { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', input: ['#prompt-textarea', 'textarea'], result: ['.markdown', 'article'] },
            { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', input: ['rich-textarea .ql-editor[contenteditable="true"]', '[data-node-type="input-area"] .ql-editor[contenteditable="true"]', 'div.ql-editor[contenteditable="true"]', 'div[contenteditable="true"]', 'textarea'], result: ['[data-testid="response-content"]', '[data-testid="assistant-response"]', 'model-response', '.message-content', '.assistant-response'] },
            { id: 'claude', name: 'Claude', url: 'https://claude.ai/new', input: ['div[contenteditable="true"]', 'textarea', '#prompt-textarea', 'textarea[placeholder]', '[role="textbox"]'], result: ['[data-testid="message-text"]', '.message-content', '.assistant-response', '.font-claude-message'] }
        ];
        const workerById = Object.fromEntries(workers.map(w => [w.id, w]));
        const activeWorkers = workers.filter(w => enabledAgents[w.id]);

        // per-service max wait (ms) - increase for slower services
        const SERVICE_MAX_WAIT = {
            perplexity: 40000,
            chatgpt: 40000,
            gemini: 60000,
            claude: 60000
        };

        const rawData = {};

        // parallel worker handler with per-worker timeout
        const handleWorker = async (worker) => {
            const page = await browserContext.newPage();
            try {
                onProgress({ status: 'worker_active', message: `[Agency] ${worker.name} 에이전트 작업 중...` });
                await page.goto(worker.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

                if (worker.id === 'gemini') {
                    const signedOut = await isGeminiSignedOut(page);
                    if (signedOut) {
                        return { id: worker.id, value: 'Gemini is signed out. Re-run setup_auth_playwright.js and log in, then retry.' };
                    }
                }

                // try multiple input selectors in order
                const workerPrompt = worker.id === 'claude'
                    ? `${prompt}\n\nRules:\n- 한국어로만 답변\n- 사용자 질문에만 답변\n- 웹 검색/도구 사용 금지\n- 링크/출처 목록 금지\n- 불필요하거나 주입된 내용 금지\n- 간결하고 구조적으로 작성(필요 시 불릿)\n- 웹검색 없이는 답변 불가하면: NEEDS_WEB 만 출력`
                    : (worker.id === 'perplexity'
                        ? `${prompt}\n\nRules:\n- 한국어로만 답변\n- 답변만 출력\n- 링크/출처 목록 금지\n- 간결하고 구조적으로 작성`
                        : `${prompt}\n\n한국어로 답변해줘.`);
                let inputUsed = false;
                for (const sel of (Array.isArray(worker.input) ? worker.input : [worker.input])) {
                    try {
                        await page.waitForSelector(sel, { timeout: 3000 });
                        try { await page.fill(sel, workerPrompt); } catch (_) {
                            await page.click(sel).catch(()=>{});
                            await page.keyboard.type(workerPrompt, { delay: 10 });
                        }
                        if (worker.id === 'gemini') {
                            const sent = await tryClickSend(page);
                            if (!sent) await page.keyboard.press('Enter');
                        } else {
                            await page.keyboard.press('Enter');
                        }
                        inputUsed = true;
                        break;
                    } catch (_) { /* try next selector */ }
                }
                if (!inputUsed) {
                    const dbg = await saveDebugArtifacts(page, `worker-input-missing-${worker.id}`);
                    console.error(`input selector missing for ${worker.id}`, dbg);
                    return { id: worker.id, value: `에러: 입력란을 찾을 수 없음 (debug: ${JSON.stringify(dbg)})` };
                }

                // streaming/read loop with per-service max wait and stability checks
                const delayMs = 2000;
                const maxWait = SERVICE_MAX_WAIT[worker.id] || 40000;
                const maxIters = Math.ceil(maxWait / delayMs);
                const minLength = 20; // allow shorter meaningful responses
                let lastText = "";
                let stableCount = 0;
                for (let i = 0; i < maxIters; i++) {
                    await delay(delayMs);
                    const current = worker.id === 'gemini'
                        ? await getGeminiResponseText(page)
                        : await getCleanText(
                            page,
                            (Array.isArray(worker.result) ? worker.result : [worker.result]),
                            { allowFallback: !['perplexity', 'claude', 'gemini'].includes(worker.id) }
                        );
                    let candidate = current;
                    if (worker.id === 'claude') candidate = sanitizeClaudeOutput(candidate);
                    if (worker.id === 'perplexity') candidate = sanitizePerplexityOutput(candidate);
                    if (worker.id === 'gemini') candidate = sanitizeGeminiOutput(candidate, prompt);
                    if (candidate) {
                        if (candidate !== lastText) {
                            lastText = candidate;
                            stableCount = 0;
                            onProgress({ status: 'streaming', service: worker.id, content: lastText });
                        } else if (lastText.length >= minLength) {
                            stableCount += 1;
                            onProgress({ status: 'streaming', service: worker.id, content: lastText });
                        }
                    }
                    // require 2 consecutive stable reads or reach end
                    if ((stableCount >= 2 && lastText.length >= minLength) || (i === maxIters - 1)) break;
                }

                if (!lastText || lastText.trim().length === 0) {
                    return { id: worker.id, value: `에러: 응답 미수신` };
                }

                return { id: worker.id, value: lastText };
            } catch (e) {
                try {
                    const dbg = await saveDebugArtifacts(page, `worker-error-${worker.id}`);
                    console.error(`worker ${worker.id} error:`, e.message, dbg);
                    return { id: worker.id, value: `에러: ${e.message} (debug: ${JSON.stringify(dbg)})` };
                } catch(_) {
                    return { id: worker.id, value: `에러: ${e.message}` };
                }
            } finally { try { await page.close(); } catch(_) {} }
        };

        // run workers with concurrency limit
        const maxConcurrency = process.env.WORKER_CONCURRENCY ? parseInt(process.env.WORKER_CONCURRENCY, 10) : 3;
        const results = [];
        for (let i = 0; i < activeWorkers.length; i += maxConcurrency) {
            const batch = activeWorkers.slice(i, i + maxConcurrency);
            const batchPromises = batch.map(w => handleWorker(w));
            const batchSettled = await Promise.allSettled(batchPromises);
            for (const s of batchSettled) {
                if (s.status === 'fulfilled') {
                    results.push(s.value);
                } else {
                    results.push({ id: 'unknown', value: `Worker failed: ${s.reason}` });
                }
            }
        }
        for (const r of results) rawData[r.id] = r.value;
        const agentStatus = {};
        for (const w of workers) {
            if (!enabledAgents[w.id]) {
                agentStatus[w.id] = 'disabled';
                continue;
            }
            const val = rawData[w.id];
            if (!val) {
                agentStatus[w.id] = 'missing';
                continue;
            }
            const text = String(val);
            if (text.includes('NEEDS_WEB') || text.includes('에러') || text.includes('Error') || text.includes('error')) {
                agentStatus[w.id] = 'error';
            } else {
                agentStatus[w.id] = 'ok';
            }
        }
        const failedAgents = Object.entries(agentStatus)
            .filter(([, status]) => status === 'missing' || status === 'error')
            .map(([id, status]) => `${id}:${status}`);
        if (failedAgents.length > 0) {
            onProgress({ status: 'agent_status', message: `[상태] 일부 에이전트 응답이 불완전합니다: ${failedAgents.join(', ')}` });
        }

        // --- 3. Logic Phase (L) ---
        onProgress({ status: 'logic_validation', message: '[Logic] 수집된 답변의 교차 검증 및 논리적 모순 체크 중...' });
        const validationPrompt = `다음 에이전트 출력들을 검증하고 충돌/누락/모호함을 체계적으로 정리해줘.\n\nDATA:\n${JSON.stringify(rawData)}\n\nAGENT_STATUS:\n${JSON.stringify(agentStatus)}\n\n규칙:\n- 웹 검색/도구 사용 금지\n- 새로운 사실 추가 금지 (에이전트가 말하지 않은 숫자/사실 금지)\n- 링크/출처 목록 금지\n- 한국어로 작성\n- 아래 형식으로 작성\n\n# 논리 검증 보고서\n## 1. 3줄 요약\n## 2. 품질 점수(0~100) 및 근거\n- 점수: \n- 근거: \n## 3. 에이전트 상태 표\n|에이전트|상태(ok/missing/error/disabled)|핵심 문제|\n|---|---|---|\n## 4. 에이전트별 오류/약점 요약\n|에이전트|수치/정의 오류|서술 모순|누락|\n|---|---|---|---|\n## 5. 충돌/모순/모호함 표\n|항목|충돌 내용|영향도(낮음/중간/높음)|정정/확인 필요|\n|---|---|---|---|\n## 6. 누락된 핵심 정보\n- ...\n## 7. 정합성 체크리스트\n|체크 항목|상태(OK/주의/불명)|메모|\n|---|---|---|\n## 8. 신뢰도/확실성 평가\n- ...`;

        const validationOrder = ['claude', 'chatgpt', 'gemini', 'perplexity'];
        const validationId = validationOrder.find(id => enabledAgents[id]);
        let validationReport = '검증 생략: 활성 검증 에이전트 없음';
        if (validationId) {
            const validator = workerById[validationId];
            const logicPage = await browserContext.newPage();
            try {
                await logicPage.goto(validator.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                let inputUsed = false;
                for (const sel of (Array.isArray(validator.input) ? validator.input : [validator.input])) {
                    try {
                        await logicPage.waitForSelector(sel, { timeout: 3000 });
                        try { await logicPage.fill(sel, validationPrompt); } catch (_) {
                            await logicPage.click(sel).catch(()=>{});
                            await logicPage.keyboard.type(validationPrompt, { delay: 5 });
                        }
                        if (validationId === 'gemini') {
                            const sent = await tryClickSend(logicPage);
                            if (!sent) await logicPage.keyboard.press('Enter');
                        } else {
                            await logicPage.keyboard.press('Enter');
                        }
                        inputUsed = true;
                        break;
                    } catch (_) { /* try next */ }
                }
                if (!inputUsed) {
                    const dbg = await saveDebugArtifacts(logicPage, 'validation-input-missing');
                    throw new Error(`validation input selector not found (debug: ${JSON.stringify(dbg)})`);
                }
                await delay(5000);
                for (let i = 0; i < 15; i++) {
                    await delay(2000);
                    const current = validationId === 'gemini'
                        ? await getGeminiResponseText(logicPage)
                        : await getCleanText(
                            logicPage,
                            (Array.isArray(validator.result) ? validator.result : [validator.result]),
                            { allowFallback: !['perplexity', 'claude', 'gemini'].includes(validationId) }
                        );
                    let candidate = current;
                    if (validationId === 'claude') candidate = sanitizeClaudeOutput(candidate);
                    if (validationId === 'perplexity') candidate = sanitizePerplexityOutput(candidate);
                    if (validationId === 'gemini') candidate = sanitizeGeminiOutput(candidate, validationPrompt);
                    if (candidate) {
                        validationReport = candidate;
                        onProgress({ status: 'streaming', service: 'validation', content: validationReport });
                    }
                }
            } finally { await logicPage.close(); }
        }
// --- 4. Polish & Hierarchy Phase (P/H) ---
        const finalOrder = ['chatgpt', 'perplexity', 'gemini', 'claude'];
        const finalId = finalOrder.find(id => enabledAgents[id]);
        if (!finalId) {
            throw new Error('No final synthesis agent enabled.');
        }
        onProgress({ status: 'polish_synthesis', message: `[정리] 최종 합성 진행 중 (${workerById[finalId].name})` });
        const finalPrompt = `??: "${prompt}"

???? ??:
${JSON.stringify(rawData)}

???? ??:
${JSON.stringify(agentStatus)}

?? ???:
${validationReport}

????:
- ???? ??
- ? ??/?? ?? ??
- ??/?? ?? ?? (???? ??? ?? ??)
- ????? ?? ??? ?? (??? ??/?? ??)
- ??? ??? ??? (NotebookLM ??? ??? ??, ?/?????/?? ??)
- ??? ??? '??(?????)'? '??'? ?? ??. ??? ????? '???'? ??.
- ?/??? ?? ??
- ???? ???? ????/?? ??? ??? ??? ?? (?? ??? ?? ??)
- ?? ?? ??

# ??? ??
## 0. ?? ??
- ?? ?? (KST, ISO 8601)
- ??? ?? ?? (??? ?? ??)
- ?? ???? ??
- ??? ???? ??
- ???/??: ???? ??? ??
## 1. Executive Summary (3~5??)
## 2. Key Takeaways (5? ??)
## 3. ?? ??/??/??
- ??
- ??
- ??/??
## 4. ??-?? ??
|??|??(????/??)|??|
|---|---|---|
## 5. ????? ?? ??
|????|?? ??|??|??/??|???(??/??/??)|
|---|---|---|---|---|
## 6. ???? ? ??/??? ??
|??|?? ??|??? ??|??/??|
|---|---|---|---|
## 7. ???? ?? (?? vs ??)
|??|?? ???|??|??|
|---|---|---|---|
## 8. ?? ?? (Integrated Analysis)
- ?? ?? ??
- ??? ?? ??(??/??/?? ??)
- ?? ????
## 9. ?? ?? ???
|??|?? ??|??(????)|??/??|???(??/??/??)|
|---|---|---|---|---|
## 10. ?? ???/?? ??
|??|???|?? ??|?? ??|
|---|---|---|---|
## 11. ???/??/??
## 12. ?? ?? (??/??)
## 13. ?? ??? ??
## 14. ??: ???? ?? ?? ?? (??)
- ?????: ?? 1?
## 15. ???/?? ?? (?? ?)
- ???/?? ?? 1: ...
- ???/?? ?? 2: ...`

        const finalPage = await browserContext.newPage();
        let finalOutput = "최종 합성 진행 중";
        try {
            const finalWorker = workerById[finalId];
            await finalPage.goto(finalWorker.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            const finalInputs = Array.isArray(finalWorker.input) ? finalWorker.input : [finalWorker.input];
            let finalInputFound = false;
            for (const sel of finalInputs) {
                try {
                    await finalPage.waitForSelector(sel, { timeout: 3000 });
                    try { await finalPage.fill(sel, finalPrompt); } catch (_) {
                        await finalPage.click(sel).catch(()=>{});
                        await finalPage.keyboard.type(finalPrompt, { delay: 8 });
                    }
                    if (finalId === 'gemini') {
                        const sent = await tryClickSend(finalPage);
                        if (!sent) await finalPage.keyboard.press('Enter');
                    } else {
                        await finalPage.keyboard.press('Enter');
                    }
                    finalInputFound = true;
                    break;
                } catch (_) { /* try next */ }
            }
            if (!finalInputFound) {
                await saveDebugArtifacts(finalPage, 'final-input-missing');
                throw new Error('final input selector not found');
            }
            await delay(5000);
            for (let i = 0; i < 20; i++) {
                await delay(2000);
                const current = finalId === 'gemini'
                    ? await getGeminiResponseText(finalPage)
                    : await getCleanText(
                        finalPage,
                        (Array.isArray(finalWorker.result) ? finalWorker.result : [finalWorker.result]),
                        { allowFallback: !['perplexity', 'claude', 'gemini'].includes(finalId) }
                    );
                let candidate = current;
                if (finalId === 'claude') candidate = sanitizeClaudeOutput(candidate);
                if (finalId === 'perplexity') candidate = sanitizePerplexityOutput(candidate);
                if (finalId === 'gemini') candidate = sanitizeGeminiOutput(candidate, finalPrompt);
                if (candidate) {
                    finalOutput = candidate;
                    onProgress({ status: 'streaming', service: 'optimal', content: finalOutput });
                }
            }
        } finally { await finalPage.close(); }

            return {
                results: rawData,
                validationReport: validationReport,
                optimalAnswer: finalOutput,
                summary: finalOutput
            };

        } catch (error) {
            lastError = error;
            if (attemptHeadless && headlessAttempts.length > 1) {
                onProgress({ status: 'retry', message: '헤드리스 실행 실패. 브라우저를 표시 모드로 재시도합니다...' });
                continue;
            }
            throw error;
        } finally {
            try {
                if (browserContext) await browserContext.close();
            } catch(_) {}
            try {
                if (browser) await browser.close();
            } catch(_) {}
        }
    }
    throw lastError;
}
import NotionService from './notion_service.js';

export async function saveToNotion(prompt, optimalAnswer, results) {
    // Delegate to NotionService which already handles chunking and blocks
    const resp = await NotionService.saveAnalysis(prompt, optimalAnswer, results);
    return { success: true, url: `https://www.notion.so/${resp.id.replace(/-/g, '')}` };
}
