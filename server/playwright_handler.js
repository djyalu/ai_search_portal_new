import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import NotionService from './notion_service.js';

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

const LOG_PATH = path.join(process.cwd(), 'server.log');
function logInternal(...args) {
    const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    fs.appendFile(LOG_PATH, `${new Date().toISOString()} [HANDLER] ` + line + '\n', (err) => { if (err) {/* ignore */ } });
    console.log('[HANDLER]', ...args);
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
        'subscribe', 'user', 'claude', 'claude.ai', 'anthropic', 'help', 'star', 'pinned',
        'retry', 'copy', 'helpful', 'unhelpful'
    ]);
    const filtered = lines.filter((line) => {
        const l = line.trim();
        if (!l) return true;
        if (l.length > 50) return true; // unlikely to be a UI label
        const lower = l.toLowerCase();
        if (stopLabels.has(lower)) return false;
        if (lower.includes('search results')) return false;
        if (lower === 'sources' || lower.startsWith('sources ') || lower.startsWith('source ')) return false;
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
    } catch (err) {
        logInternal('getGeminiResponseText error:', err.message);
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

            // Strict Sign-In Check
            const signInLinks = Array.from(document.querySelectorAll('a[href*="accounts.google.com"], a[href*="ServiceLogin"]'));
            if (signInLinks.some(l => l.innerText.includes('Sign in') || l.innerText.includes('로그인'))) return true;

            const bodyText = document.body ? document.body.innerText || '' : '';
            // Updated signatures based on debugging
            return !!(
                bodyText.includes('Sign in to Gemini') ||
                bodyText.includes('Sign in Gemini') ||
                bodyText.includes('Conversation with Gemini') && bodyText.includes('Sign in') ||
                (bodyText.includes('Sign in') && bodyText.includes('Google'))
            );
        });
    } catch (_) {
        return false;
    }
}

async function isClaudeSignedOut(page) {
    try {
        return await page.evaluate(() => {
            const bodyText = document.body ? document.body.innerText || '' : '';
            return !!(
                document.querySelector('a[href*="/login"], a[href*="/register"]') ||
                bodyText.includes('Sign in to Claude') ||
                bodyText.includes('Welcome back') && bodyText.includes('Email')
            );
        });
    } catch (_) {
        return false;
    }
}

async function isChatGPTSignedOut(page) {
    try {
        return await page.evaluate(() => {
            const bodyText = document.body ? document.body.innerText || '' : '';
            return !!(
                document.querySelector('button[data-testid="login-button"]') ||
                document.querySelector('a[href="/login"]') ||
                bodyText.includes('Get started') && bodyText.includes('Log in')
            );
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
            logInternal(`RALPH 에이전시 파이프라인 가동... Prompt: ${prompt.substring(0, 30)}`);
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
            const contextOptions = {
                viewport: null,
                permissions: ['clipboard-read', 'clipboard-write']
            };
            if (fs.existsSync(storageStatePath)) {
                contextOptions.storageState = storageStatePath;
            }
            browserContext = await browser.newContext(contextOptions);

            // New Helper: Paste Input to bypass React State issues
            const pasteInput = async (page, text) => {
                await page.evaluate((t) => navigator.clipboard.writeText(t), text);
                await page.keyboard.press('Control+V');
            };

            // New Helper: MutationObserver for Robust Extraction
            const injectObserver = async (page) => {
                await page.evaluate(() => {
                    window.__RALPH_LATEST = "";
                    window.__RALPH_LAST_LEN = 0;
                    const observer = new MutationObserver((mutations) => {
                        let text = "";
                        let source = "body";
                        // Gemini Specific: Target 'model-response'
                        const geminiResponses = document.querySelectorAll('model-response, .model-response, [data-testid="response-content"]');
                        if (geminiResponses.length > 0) {
                            // Get the last one
                            const last = geminiResponses[geminiResponses.length - 1];
                            const specificText = last.innerText || "";
                            // Smart Fallback: If specific container is empty/too short, ignore it
                            if (specificText.length > 20) {
                                text = specificText;
                                source = "model-response";
                            }
                        }

                        if (!text) {
                            // Fallback to body text logic
                            text = document.body.innerText || "";
                            source = "body";
                        }

                        if (text.length > window.__RALPH_LAST_LEN) {
                            window.__RALPH_LATEST = text;
                            window.__RALPH_LAST_LEN = text.length;
                            window.__RALPH_DEBUG = `Source: ${source}, Len: ${text.length}`;
                        }
                    });
                    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
                });
            };

            // --- 1. Reasoning Phase (R) ---
            logInternal(`Reasoning Phase 시작. Prompt sent to Perplexity...`);
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
                    logInternal(`Reasoning 완료. Strategy: ${strategy.substring(0, 50)}...`);
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
                { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', input: ['#prompt-textarea', 'textarea[placeholder*="ChatGPT"]', 'textarea'], result: ['[data-message-author-role="assistant"] .markdown', '.markdown', 'div.markdown', 'div[class*="markdown"]', 'article'] },
                { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', input: ['rich-textarea .ql-editor[contenteditable="true"]', 'div.input-area ql-editor', '[data-node-type="input-area"] .ql-editor[contenteditable="true"]', 'div.ql-editor[contenteditable="true"]', 'div[contenteditable="true"]', 'textarea'], result: ['[data-testid="response-content"]', '[data-testid="assistant-response"]', 'model-response', '.message-content', '.assistant-response', 'article'] },
                { id: 'claude', name: 'Claude', url: 'https://claude.ai/new', input: ['div[contenteditable="true"][aria-label*="Claude"]', '[data-testid="chat-input"]', '[data-testid="message-input"]', 'div[contenteditable="true"][data-testid]', 'div[contenteditable="true"]', 'textarea[aria-label]', 'textarea', '#prompt-textarea', 'textarea[placeholder]', '[role="textbox"]'], result: ['[data-testid="assistant-message"]', '.font-claude-message', '.font-user-message', 'div[class*="font-claude"]', 'div[class*="message"]', '.prose', '.message-content'] }
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
                    logInternal(`Worker ${worker.id} 시작...`);
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

                    if (worker.id === 'claude') {
                        const signedOut = await isClaudeSignedOut(page);
                        if (signedOut) {
                            logInternal('Claude is signed out. Waiting 3s for possible redirect/session recovery...');
                            await delay(3000);
                            if (await isClaudeSignedOut(page)) {
                                return { id: worker.id, value: 'Claude is signed out. Please refresh session.' };
                            }
                        }
                        // Clear potential modals
                        await page.evaluate(() => {
                            const modalButtons = [
                                'button:has-text("Acknowledge")', 'button:has-text("I agree")',
                                'button:has-text("Got it")', 'button[aria-label="Close"]',
                                '.modal button', '[role="dialog"] button'
                            ];
                            modalButtons.forEach(sel => {
                                const btn = document.querySelector(sel);
                                if (btn && btn.offsetParent !== null) btn.click();
                            });
                        }).catch(() => { });
                    }

                    if (worker.id === 'chatgpt') {
                        const signedOut = await isChatGPTSignedOut(page);
                        if (signedOut) {
                            return { id: worker.id, value: 'ChatGPT session expired. Please refresh login.' };
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
                            if (worker.id === 'claude' || worker.id === 'gemini') {
                                // NEW STRATEGY: Click -> Paste -> Triple Send Trigger
                                await page.click(sel);
                                await delay(500);
                                await pasteInput(page, workerPrompt);
                                await delay(800);
                                logInternal(`Worker ${worker.id} inputs pasted.`);

                                // Helper to check if processing started
                                const checkStarted = async () => {
                                    return await page.evaluate(() => {
                                        const indicators = [
                                            '.streaming', '.typing', '.thinking', '[data-testid="loading-indicator"]',
                                            'svg.animate-spin', '.dot-flashing', '.progress-bar',
                                            'button[aria-label*="Stop"]', 'button[aria-label*="중단"]', 'button[data-testid*="stop"]',
                                            'model-response', '.result-streaming'
                                        ];
                                        return indicators.some(sel => !!document.querySelector(sel));
                                    });
                                };

                                // 1. Control + Enter
                                await page.keyboard.press('Control+Enter');
                                await delay(1000);
                                if (await checkStarted()) {
                                    logInternal(`Worker ${worker.id} started via Control+Enter.`);
                                } else {
                                    // 2. Enter (Fallback)
                                    const activeElement = await page.evaluate(() => document.activeElement.tagName);
                                    if (activeElement === 'BODY') await page.click(sel);
                                    await page.keyboard.press('Enter');
                                    await delay(1000);

                                    if (await checkStarted()) {
                                        logInternal(`Worker ${worker.id} started via Enter.`);
                                    } else {
                                        // 3. Click Send Button (Ultimate Fallback)
                                        await tryClickSend(page);
                                        logInternal(`Worker ${worker.id} tried Click Send.`);
                                    }
                                }
                            } else {
                                // Legacy Logic (ChatGPT / Perplexity)
                                if (['chatgpt'].includes(worker.id)) {
                                    await page.click(sel);
                                    await delay(300);
                                    await page.keyboard.type(workerPrompt, { delay: 1 }); // Type is safer for ChatGPT than insertText due to validation
                                    await delay(800);

                                    const sent = await tryClickSend(page);
                                    if (!sent) {
                                        await page.keyboard.press('Enter'); // ChatGPT prefers simple Enter
                                    }
                                } else {
                                    // Perplexity
                                    await page.fill(sel, workerPrompt);
                                    await page.keyboard.press('Enter');
                                }
                            }
                            inputUsed = true;

                            // Initialize Observer for extraction (Gemini/Claude)
                            if (worker.id === 'claude' || worker.id === 'gemini') {
                                await injectObserver(page);
                            }

                            const resultSels = Array.isArray(worker.result) ? worker.result : [worker.result];
                            // Wait for result container or timeout
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
                    const maxWait = SERVICE_MAX_WAIT[worker.id] || 60000;
                    const maxIters = Math.ceil(maxWait / delayMs);
                    const minLength = 1;
                    let lastText = "";
                    let stableCount = 0;
                    let lastChangeTick = 0;

                    for (let i = 0; i < maxIters; i++) {
                        try {
                            await delay(delayMs);

                            // Check for 'Still Typing' or 'Thinking' states to hold collection
                            const isThinking = await page.evaluate(() => {
                                const indicators = [
                                    '.streaming', '.typing', '.thinking', '[data-testid="loading-indicator"]',
                                    'svg.animate-spin', '.dot-flashing', '.progress-bar',
                                    'button[aria-label*="Stop"]', 'button[aria-label*="중단"]', 'button[data-testid*="stop"]',
                                    'button[aria-label="Cancel"]', 'button[aria-label*="Stop generating"]',
                                    '.result-streaming', '.anticon-loading'
                                ];
                                return indicators.some(sel => !!document.querySelector(sel));
                            }).catch(() => false);

                            let candidate = "";
                            if (worker.id === 'claude' || worker.id === 'gemini') {
                                // Retrieve from observer
                                const fullText = await page.evaluate(() => window.__RALPH_LATEST || document.body.innerText);
                                candidate = fullText;
                            } else {
                                candidate = await getCleanText(
                                    page,
                                    (Array.isArray(worker.result) ? worker.result : [worker.result]),
                                    { allowFallback: true }
                                );
                            }
                            if (candidate && candidate.length > 0) {
                                // Fail-fast for known login prompts (check start of text)
                                const startText = candidate.substring(0, 200);
                                if (startText.includes('Sign in') || startText.includes('Log in') || startText.includes('로그인') || startText.includes('Conversation with Gemini')) {
                                    logInternal(`[Loop ${worker.id}] Detected sign-in prompt. Aborting.`);
                                    return { id: worker.id, value: `Error: Session Expired` };
                                }

                                if (candidate.length < 100) {
                                    logInternal(`[Loop ${worker.id}] Short content: "${candidate.replace(/\n/g, ' ')}"`);
                                }
                                if (i < 3) logInternal(`Worker ${worker.id} candidate length: ${candidate.length}`);
                            }
                            if (worker.id === 'claude') candidate = sanitizeClaudeOutput(candidate);
                            if (worker.id === 'perplexity') candidate = sanitizePerplexityOutput(candidate);
                            if (worker.id === 'gemini') candidate = sanitizeGeminiOutput(candidate, workerPrompt);

                            // DEBUG: Verbose logging every 2 seconds
                            if (i % 1 === 0) { // Log every tick for now
                                logInternal(`[Loop ${worker.id}] Iter: ${i}, Thinking: ${isThinking}, Len: ${candidate ? candidate.length : 0}, Stable: ${stableCount}`);
                            }

                            if (candidate && candidate.trim().length > 0) {
                                if (candidate !== lastText) {
                                    lastText = candidate;
                                    stableCount = 0;
                                    lastChangeTick = i;
                                    onProgress({ status: 'streaming', service: worker.id, content: lastText });
                                } else {
                                    stableCount += 1;
                                }
                            } else if (i === 5 && (!candidate || candidate.length === 0)) {
                                // If 10 seconds passed and still no text, dump debug
                                logInternal(`[Loop ${worker.id}] NO TEXT after 10s. Dumping HTML.`);
                                try {
                                    const html = await page.content();
                                    const debugPath = path.join(process.cwd(), `debug_${worker.id}_loop_empty.html`);
                                    fs.writeFileSync(debugPath, html);
                                } catch (e) { console.error(e); }
                            }

                            // Robust Exit: 
                            // 1. Stable for 1 tick AND not thinking, OR
                            // 2. STALLED: No changes for 10 seconds (5 ticks) even if "thinking" seems active
                            const isStalled = i - lastChangeTick >= 5 && lastText.length > minLength;

                            if ((stableCount >= 1 && lastText.length >= minLength && !isThinking) || isStalled || (i === maxIters - 1)) {
                                if (isStalled) logInternal(`Worker ${worker.id} stalled for 10s. Breaking loop.`);
                                break;
                            }
                        } catch (loopErr) {
                            logInternal(`Worker ${worker.id} loop error: ${loopErr.message}`);
                            if (loopErr.message.includes('destroyed')) break;
                            continue;
                        }
                    }

                    if (!lastText || lastText.trim().length === 0) {
                        logInternal(`Worker ${worker.id} 완료: 텍스트 없음.`);
                        // DEBUG: Save HTML to inspect why
                        try {
                            const html = await page.content();
                            const debugPath = path.join(process.cwd(), `debug_${worker.id}_failed.html`);
                            fs.writeFileSync(debugPath, html);
                            logInternal(`Saved debug HTML to ${debugPath}`);
                            // Also screenshot
                            await page.screenshot({ path: path.join(process.cwd(), `debug_${worker.id}_failed.png`) });
                        } catch (err) { console.error('Debug save failed:', err); }

                        return { id: worker.id, value: `에러: 응답 미수신 (Debug saved)` };
                    }

                    logInternal(`Worker ${worker.id} 완료: ${lastText.length} 자 수집.`);
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
                if (text.includes('NEEDS_WEB') || text.startsWith('에러:') || text.startsWith('Error:') || text.length < 50) {
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
                            // Robust Input Strategy (Logic Phase)
                            if (validationId === 'claude' || validationId === 'gemini') {
                                await logicPage.click(sel);
                                await delay(500);
                                await pasteInput(logicPage, validationPrompt);
                                await delay(800);

                                // 1. Control + Enter
                                await logicPage.keyboard.press('Control+Enter');
                                await delay(1000);

                                // 2. Enter (Fallback)
                                const activeElement = await logicPage.evaluate(() => document.activeElement.tagName);
                                if (activeElement === 'BODY') await logicPage.click(sel);
                                await logicPage.keyboard.press('Enter');
                                await delay(1000);

                                // 3. Click Send Button (Ultimate Fallback)
                                await tryClickSend(logicPage);
                            } else {
                                // Legacy for others
                                await logicPage.click(sel);
                                await logicPage.keyboard.insertText(validationPrompt);
                                await logicPage.keyboard.press('Enter');
                                if (validationId === 'chatgpt') {
                                    await delay(800);
                                    await tryClickSend(logicPage);
                                }
                            }

                            inputUsed = true;
                            // Initialize Observer for extraction (Logic Phase)
                            if (validationId === 'claude' || validationId === 'gemini') {
                                await injectObserver(logicPage);
                            }
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
                        let candidate = "";
                        if (validationId === 'claude' || validationId === 'gemini') {
                            const fullText = await logicPage.evaluate(() => window.__RALPH_LATEST || document.body.innerText);
                            candidate = fullText;
                        } else {
                            candidate = await getCleanText(
                                logicPage,
                                (Array.isArray(validator.result) ? validator.result : [validator.result]),
                                { allowFallback: true }
                            );
                        }
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
                // continue to next iteration
            } else {
                throw error;
            }
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

export async function saveToNotion(prompt, optimalAnswer, results) {
    const resp = await NotionService.saveAnalysis(prompt, optimalAnswer, results);
    return { success: true, url: `https://www.notion.so/${resp.id.replace(/-/g, '')}` };
}

export class PlaywrightHandler {
    constructor(headless = BROWSER_HEADLESS) {
        this.browser = null;
        this.headless = headless;
    }

    async init() {
    }

    async run(prompt, strategy, onProgress, options) {
        return await runExhaustiveAnalysis(prompt, onProgress, options);
    }

    async close() {
        if (this.browser) await this.browser.close();
    }
}
