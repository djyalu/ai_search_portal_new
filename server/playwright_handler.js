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
            } catch (e) { }
            try {
                if (document.body && document.body.innerText && document.body.innerText.trim().length > 0) return document.body.innerText.trim();
            } catch (e) { }
        }
        return null;
    }, { sels: selectors, allowFallbackIn: allowFallback });
}

function sanitizeClaudeOutput(text) {
    if (!text) return text;
    const lines = text.split('\n');
    const stopLabels = new Set([
        'new chat', 'search', 'chats', 'projects', 'artifacts', 'code', 'recents', 'hide',
        'all chats', 'history', 'recent', 'share', 'free plan', 'upgrade', 'account', 'settings',
        'subscribe', 'user', 'claude', 'claude.ai', 'anthropic', 'help', 'star', 'pinned'
    ]);
    const filtered = lines.filter((line) => {
        const l = line.trim();
        if (!l) return true;
        const lower = l.toLowerCase();
        if (stopLabels.has(lower)) return false;
        if (lower.includes('search results')) return false;
        if (lower === 'sources' || lower.startsWith('sources ') || lower.startsWith('source ')) return false;
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
        'gemini can make mistakes', 'your privacy & gemini', 'feedback', 'report', 'share', 'view sources'
    ]);
    const stopExact = new Set(['한국어로 답변해줘.', '한국어로 답변해줘']);
    const filtered = lines.filter((line) => {
        const l = line.trim();
        if (!l) return true;
        const lower = l.toLowerCase();
        if (stopLabels.has(lower)) return false;
        // Only strip if exactly matching a prompt line to avoid stripping partial matches in content
        if (promptSet.has(l)) return false;
        if (stopExact.has(l)) return false;
        if (lower.includes('gemini can make mistakes')) return false;
        if (lower.includes('opens in a new window')) return false;
        return true;
    });
    const cleaned = filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!cleaned) return null;
    // Lower minLength to 12 as per analysis to allow short but valid responses
    if (cleaned.length < 12) return cleaned;
    return cleaned;
}

async function getGeminiResponseText(page) {
    try {
        return await page.evaluate(() => {
            const readText = (node) => node && node.innerText ? node.innerText.trim() : '';

            // Recursive Shadow DOM Traversal
            const findTextDeep = (root) => {
                if (!root) return '';
                let text = '';

                // 1. Check current node (if it's a known response container)
                if (root.matches && (root.matches('[data-testid="response-content"]') || root.matches('.markdown'))) {
                    return readText(root);
                }

                // 2. Traversed through Shadow Root
                if (root.shadowRoot) {
                    text += findTextDeep(root.shadowRoot);
                }

                // 3. Traverse through Children
                const children = Array.from(root.children || []);
                for (const child of children) {
                    const childText = findTextDeep(child);
                    if (childText) text += (text ? '\n' : '') + childText;
                }

                // 4. Fallback search for specific selectors if no text yet
                if (!text) {
                    const inner = root.querySelector?.('[data-testid="response-content"], .markdown, .assistant-response, .message-content');
                    if (inner) text = readText(inner);
                }

                return text.trim();
            };

            const responses = Array.from(document.querySelectorAll('model-response'));
            if (responses.length) {
                // Get the latest response from the last model-response tag
                const lastResponse = responses[responses.length - 1];
                const deepText = findTextDeep(lastResponse);
                if (deepText) return deepText;
            }

            // Global Fallback
            const fallbackSels = ['[data-testid="response-content"]', 'model-response .markdown', '.assistant-response', 'article'];
            for (const sel of fallbackSels) {
                const els = document.querySelectorAll(sel);
                if (els.length) {
                    const txt = readText(els[els.length - 1]);
                    if (txt) return txt;
                }
            }
            return null;
        });
    } catch (_) {
        return null;
    }
}

async function isGeminiSignedOut(page) {
    try {
        return await page.evaluate(() => {
            const hasSelectorDeep = (root, selector) => {
                if (!root) return false;
                if (root.querySelector && root.querySelector(selector)) return true;
                if (root.shadowRoot && hasSelectorDeep(root.shadowRoot, selector)) return true;
                for (const child of Array.from(root.children || [])) {
                    if (hasSelectorDeep(child, selector)) return true;
                }
                return false;
            };

            // Heuristic: If we can see the input field, we ignore the 'Sign in' button for now
            const inputSelectors = ['rich-textarea', '.ql-editor', 'div[contenteditable="true"]', 'textarea'];
            const hasInput = inputSelectors.some(sel => hasSelectorDeep(document.body, sel));
            if (hasInput) return false;

            const signInBtn = document.querySelector('a[href*="/signin"], a[href*="/login"], [aria-label*="Sign in"], button.sign-in');
            const bodyText = document.body ? document.body.innerText || '' : '';
            return !!(signInBtn || bodyText.includes('Sign in') || bodyText.includes('로그인하세요'));
        });
    } catch (_) {
        return false;
    }
}

async function tryClickSend(page) {
    const sendSelectors = [
        'button[aria-label*="Send"]',
        'button[aria-label*="전송"]',
        'button[data-testid*="send"]',
        'button[data-testid*="submit"]',
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]',
        'button[data-testid="send-button"]',
        'button[aria-label="Submit"]',
        '.send-button',
        'button.send'
    ];
    for (const sendSel of sendSelectors) {
        const btn = await page.$(sendSel);
        if (btn && !(await btn.isDisabled().catch(() => false))) {
            await btn.click().catch(() => { });
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
                                    await planningPage.click(sel).catch(() => { });
                                    await planningPage.keyboard.type(planningPrompt, { delay: 10 });
                                }
                                await planningPage.keyboard.press('Enter');
                                inputFound = true;
                                break;
                            } catch (_) { /* try next selector */ }
                        }
                        if (!inputFound) {
                            console.error('planning input selector not found');
                            throw new Error('planning input selector not found');
                        }
                    } catch (err) {
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
                { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/', input: ['textarea[placeholder*="Ask"]', '#ask-input', '[data-lexical-editor="true"]', 'div[contenteditable="true"]', 'textarea'], result: ['[data-testid="answer"]', '.prose', '.result', '.pplx-stream'] },
                { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', input: ['#prompt-textarea', 'textarea[placeholder*="ChatGPT"]', 'textarea'], result: ['.markdown', 'article'] },
                { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', input: ['rich-textarea .ql-editor[contenteditable="true"]', 'div.input-area ql-editor', '[data-node-type="input-area"] .ql-editor[contenteditable="true"]', 'div.ql-editor[contenteditable="true"]', 'div[contenteditable="true"]', 'textarea'], result: ['[data-testid="response-content"]', '[data-testid="assistant-response"]', 'model-response', '.message-content', '.assistant-response', 'article'] },
                { id: 'claude', name: 'Claude', url: 'https://claude.ai/new', input: ['div[contenteditable="true"][aria-label*="Claude"]', '[data-testid="chat-input"]', '[data-testid="message-input"]', 'div[contenteditable="true"][data-testid]', 'div[contenteditable="true"]', 'textarea[aria-label]', 'textarea', '#prompt-textarea', 'textarea[placeholder]', '[role="textbox"]'], result: ['[data-testid="assistant-message"]', '[data-testid="chat-message"]', '[data-testid="message-text"]', '.message-content', '.assistant-response', '.font-claude-message', 'article'] }
            ];
            const workerById = Object.fromEntries(workers.map(w => [w.id, w]));
            const activeWorkers = workers.filter(w => enabledAgents[w.id]);

            // per-service max wait (ms) - increase for slower services
            const SERVICE_MAX_WAIT = {
                perplexity: 40000,
                chatgpt: 40000,
                gemini: 80000,
                claude: 80000
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
                            // If signed out, we try to proceed anyway for a few seconds to see if UI changes
                            await delay(3000);
                            const stillSignedOut = await isGeminiSignedOut(page);
                            if (stillSignedOut) {
                                return { id: worker.id, value: 'Gemini is signed out. Please run setup_auth_playwright.js to refresh session.' };
                            }
                        }
                    }

                    // try multiple input selectors in order
                    // Inject reasoning strategy/context into agent prompts to align knowledge
                    const workerPrompt = worker.id === 'claude'
                        ? `${prompt}\n\n[CONTEXT FROM SEARCH AGENT]\n${strategy}\n\n[CRITICAL RULES]\n- 위 [CONTEXT]에 기재된 기업명/티커 정보를 최우선으로 신뢰하십시오. (예: ONDS=Ondas Holdings)\n- 한국어로만 답변\n- 답변에 불필요한 서술이나 인사말 금지\n- 웹 검색/도구 사용 금지\n- 링크/출처 목록 금지\n- 간결하고 구조적으로 작성\n- 불확실하면 추정임을 명시`
                        : (worker.id === 'perplexity'
                            ? `${prompt}\n\nRules:\n- 한국어로만 답변\n- 답변만 출력\n- 링크/출처 목록 금지\n- 간결하고 구조적으로 작성`
                            : `${prompt}\n\n[참고 데이터]\n${strategy}\n\n위 데이터를 바탕으로 한국어로 답변해줘.`);
                    let inputUsed = false;
                    for (const sel of (Array.isArray(worker.input) ? worker.input : [worker.input])) {
                        try {
                            await page.waitForSelector(sel, { timeout: 8000 });
                            if (worker.id === 'gemini' || worker.id === 'claude') {
                                // For rich editors, click and insertText is more reliable
                                await page.click(sel);
                                await page.keyboard.insertText(workerPrompt);
                                const sent = await tryClickSend(page);
                                if (!sent) await page.keyboard.press('Enter');
                            } else {
                                await page.fill(sel, workerPrompt);
                                await page.keyboard.press('Enter');
                            }
                            inputUsed = true;
                            // Wait a bit for the UI to transition and the result element to start appearing
                            const resultSels = Array.isArray(worker.result) ? worker.result : [worker.result];
                            await Promise.race([
                                page.waitForSelector(resultSels[0], { timeout: 15000 }).catch(() => { }),
                                delay(5000)
                            ]);
                            break;
                        } catch (e) { /* continue */ }
                    }
                    if (!inputUsed) {
                        console.error(`input selector missing for ${worker.id}`);
                        return { id: worker.id, value: `에러: 입력란을 찾을 수 없음` };
                    }

                    // streaming/read loop with adaptive polling and stability checks
                    const delayMs = 2000;
                    const maxWait = SERVICE_MAX_WAIT[worker.id] || 40000;
                    const maxIters = Math.ceil(maxWait / delayMs);
                    const minLength = 12;
                    let lastText = "";
                    let stableCount = 0;

                    for (let i = 0; i < maxIters; i++) {
                        try {
                            await delay(delayMs);

                            // Check for 'Still Typing' or 'Thinking' states to hold collection
                            const isThinking = await page.evaluate(() => {
                                const indicators = [
                                    '.streaming', '.typing', '.thinking', '[data-testid="loading-indicator"]',
                                    'svg.animate-spin', '.dot-flashing', '.progress-bar'
                                ];
                                return indicators.some(sel => !!document.querySelector(sel));
                            }).catch(() => false);

                            const current = worker.id === 'gemini'
                                ? await getGeminiResponseText(page)
                                : await getCleanText(
                                    page,
                                    (Array.isArray(worker.result) ? worker.result : [worker.result]),
                                    { allowFallback: !['perplexity', 'gemini', 'chatgpt', 'claude'].includes(worker.id) }
                                );

                            let candidate = current;
                            if (worker.id === 'claude') candidate = sanitizeClaudeOutput(candidate);
                            if (worker.id === 'perplexity') candidate = sanitizePerplexityOutput(candidate);
                            if (worker.id === 'gemini') candidate = sanitizeGeminiOutput(candidate, workerPrompt);

                            if (candidate) {
                                if (candidate !== lastText) {
                                    lastText = candidate;
                                    stableCount = 0;
                                    onProgress({ status: 'streaming', service: worker.id, content: lastText });
                                } else if (lastText.length >= minLength && !isThinking) {
                                    // Only increment stableCount if NOT thinking
                                    stableCount += 1;
                                    onProgress({ status: 'streaming', service: worker.id, content: lastText });
                                }
                            }

                            // Exit conditions: 
                            // 1. Stable for 2 iterations + no thinking active
                            // 2. Final iteration reached
                            if ((stableCount >= 2 && lastText.length >= minLength && !isThinking) || (i === maxIters - 1)) break;
                        } catch (loopErr) {
                            console.warn(`Loop iteration error for ${worker.id}: ${loopErr.message}`);
                            // If context was destroyed, we just try again next iteration (it will likely recover on new page state)
                            if (loopErr.message.includes('destroyed') || loopErr.message.includes('navigation')) {
                                continue;
                            } else {
                                break;
                            }
                        }
                    }

                    if (!lastText || lastText.trim().length === 0) {
                        return { id: worker.id, value: `에러: 응답 미수신` };
                    }

                    return { id: worker.id, value: lastText };
                } catch (e) {
                    console.error(`worker ${worker.id} error:`, e.message);
                    return { id: worker.id, value: `에러: ${e.message}` };
                } finally { try { await page.close(); } catch (_) { } }
            };

            // run workers with concurrency limit
            const maxConcurrency = process.env.WORKER_CONCURRENCY ? parseInt(process.env.WORKER_CONCURRENCY, 10) : 4;
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
            const validationPrompt = `다음 에이전트 출력들을 "논리 검증 보고서" 형식으로 정돈해줘.\n\nDATA:\n${JSON.stringify(rawData)}\n\nAGENT_STATUS:\n${JSON.stringify(agentStatus)}\n\n[CRITICAL RULES]\n- 제공된 원자료(DATA)에만 근거할 것. 특히 티커(Ticker) 매칭 오류가 없는지 엄격히 검증할 것 (예: ONDS=Ondas Holdings)\n- 에이전트 간의 정보 충돌(할루시네이션)을 최우선으로 리포트할 것\n- 웹 검색/도구 사용 금지\n- 새로운 사실/수치 추가 금지\n- 한국어로 작성\n- 마크다운 형식 사용\n\n# 논리 검증 보고서\n## 0. 메타\n- 기준 시점: (알 수 없으면 정보 부족)\n- 검증 범위: (질문 요약)\n- 입력 상태 요약: (에이전트 상태 요약)\n\n## 1. 3줄 요약\n- ...\n\n## 2. 할루시네이션/오류 감지 (필수)\n- ...\n\n## 3. 합의 vs 불일치 요약\n|주제|합의 내용|불일치 내용|조정 결과|\n|---|---|---|---|\n\n## 4. 충돌/모순/모호함 표\n|항목|충돌 내용|영향도|정정 필요|\n|---|---|---|---|\n\n## 5. 정합성 점수(0~100) 및 근거\n- 점수: \n- 근거: \n\n## 6. 개선 항목\n- ...`;

            const validationOrder = ['claude', 'chatgpt', 'gemini', 'perplexity'];
            // Priority: Enabled AND OK status > Enabled but Error status
            let validationId = validationOrder.find(id => enabledAgents[id] && agentStatus[id] === 'ok');
            if (!validationId) validationId = validationOrder.find(id => enabledAgents[id]);

            let validationReport = validationId
                ? `검증 대기 중 (${workerById[validationId].name})`
                : '검증 생략: 활성화된 에이전트가 없습니다.';

            if (validationId) {
                const validator = workerById[validationId];
                const logicPage = await browserContext.newPage();
                try {
                    await logicPage.goto(validator.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                    let inputUsed = false;
                    for (const sel of (Array.isArray(validator.input) ? validator.input : [validator.input])) {
                        try {
                            await logicPage.waitForSelector(sel, { timeout: 8000 });
                            await logicPage.click(sel);
                            await logicPage.keyboard.insertText(validationPrompt);

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
                        validationReport = `검증 실패: ${validator.name}의 입력창을 찾을 수 없습니다. (로그인 필요 가능성)`;
                        throw new Error(`validation input selector not found`);
                    }
                    await delay(5000);
                    let lastValidText = "";
                    let stableTicks = 0;
                    for (let i = 0; i < 20; i++) {
                        await delay(2000);
                        const current = validationId === 'gemini'
                            ? await getGeminiResponseText(logicPage)
                            : await getCleanText(
                                logicPage,
                                (Array.isArray(validator.result) ? validator.result : [validator.result]),
                                { allowFallback: true } // Validation is critical, allow fallback
                            );
                        let candidate = current;
                        if (validationId === 'claude') candidate = sanitizeClaudeOutput(candidate);
                        if (validationId === 'perplexity') candidate = sanitizePerplexityOutput(candidate);
                        if (validationId === 'gemini') candidate = sanitizeGeminiOutput(candidate, validationPrompt);

                        if (candidate && candidate.length > 20) {
                            if (candidate === lastValidText) {
                                stableTicks++;
                            } else {
                                lastValidText = candidate;
                                stableTicks = 0;
                                validationReport = lastValidText;
                                onProgress({ status: 'streaming', service: 'validation', content: validationReport });
                            }
                        }

                        // Early exit if stable for 3 ticks (6 seconds)
                        if (stableTicks >= 3 && lastValidText.length > 100) break;
                    }
                    if (lastValidText) validationReport = lastValidText;
                    if (validationReport.startsWith('검증 대기 중')) {
                        validationReport = `검증 실패: ${validator.name}로부터 응답을 받지 못했습니다.`;
                    }
                } catch (e) {
                    validationReport = `검증 실패: ${validator.name} 작업 중 오류 발생 (${e.message})`;
                } finally { await logicPage.close(); }
            }
            // --- 4. Polish & Hierarchy Phase (P/H) ---
            const finalOrder = ['chatgpt', 'perplexity', 'gemini', 'claude'];
            // Priority: Enabled AND OK status > Enabled but Error status
            let finalId = finalOrder.find(id => enabledAgents[id] && agentStatus[id] === 'ok');
            if (!finalId) finalId = finalOrder.find(id => enabledAgents[id]);

            if (!finalId) {
                throw new Error('No final synthesis agent enabled.');
            }
            onProgress({ status: 'polish_synthesis', message: `[정리] 최종 합성 진행 중 (${workerById[finalId].name})` });
            const finalPrompt = `질문: "${prompt}"

원자료(에이전트 원문):
${JSON.stringify(rawData)}

에이전트 상태:
${JSON.stringify(agentStatus)}

논리 검증 요약:
${validationReport}

작성 규칙:
- 한국어로 작성, 보고서 톤(컨설팅/리서치 스타일)
- 새로운 사실/수치 추가 금지 (원문 범위 내)
- 수치/확률이 없으면 "정보 부족"으로 표기
- 단정 표현 지양, 불확실성 명시
- 링크/출처 목록 금지
- Markdown 사용, 제목/표 적극 활용

# 통합 분석 보고서: ${prompt}
## 0. 메타
- 기준 시점: (알 수 없으면 정보 부족)
- 분석 범위: (질문 요약)
- 활성 에이전트: (agent_status 기준)
- 데이터 상태 요약: (missing/error 포함)

## 1. Executive Summary (3~5줄)
- ...

## 2. Key Takeaways (5)
- ...

## 3. 핵심 쟁점 구조
- 원인:
- 구조(경로):
- 핵심 트리거:

## 4. 비교/분석
### 4.1 합의 vs 불일치
|주제|합의|불일치|정리|
|---|---|---|---|
### 4.2 근거 매핑
|핵심 주장|근거(에이전트)|비고|
|---|---|---|

## 5. 확률/시나리오 정렬
|시나리오|가능성/범위|근거|조건/트리거|
|---|---|---|---|

## 6. 영향 분석 (검색 내용에 따라)
|영역|영향 방향|강도|근거|
|---|---|---|---|
- 해당 내용이 없으면 "정보 부족"으로 명시

## 7. 과거 사례/유사 패턴 (있는 경우만)
- ...

## 8. 불확실성 & 가정
- ...

## 9. 전망 및 모니터링 체크리스트
|항목|확인 포인트|시그널|
|---|---|---|

## 10. 결론
- 3~4줄

## 11. 에이전트 스냅샷
|에이전트|요약(1~2줄)|상태|메모|
|---|---|---|---|`;

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
                            await finalPage.click(sel).catch(() => { });
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
            } catch (_) { }
            try {
                if (browser) await browser.close();
            } catch (_) { }
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
