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

            // Relaxed Sign-In Check to avoid False Positives
            const signInLinks = Array.from(document.querySelectorAll('a[href*="accounts.google.com"], a[href*="ServiceLogin"]'));
            // Only consider it a sign-out if the link is prominent (e.g. in the main area or a big button)
            const visibleSignIn = signInLinks.find(l => {
                const rect = l.getBoundingClientRect();
                return rect.width > 50 && rect.height > 20 && l.innerText.includes('Sign in');
            });
            if (visibleSignIn) return `LINK: ${visibleSignIn.innerText}`;

            const bodyText = document.body ? document.body.innerText || '' : '';
            // Only trigger if we see "Sign in to Gemini" exactly, or the specific login page title
            if (bodyText.includes('Sign in to Gemini')) return 'TEXT: Sign in to Gemini';
            if (bodyText.includes('Sign in') && bodyText.includes('Google') && bodyText.includes('Continue')) return 'TEXT: Google Sign in Form';

            return false;
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
    // Safety Check: If generation is already happening (Stop button visible), DO NOT click anything.
    const isGenerating = await page.evaluate(() => {
        const stopSelectors = [
            'button[aria-label*="Stop"]', 'button[aria-label*="중단"]',
            'button[data-testid*="stop"]', '[aria-label="Stop generating"]'
        ];
        return stopSelectors.some(sel => !!document.querySelector(sel));
    });
    if (isGenerating) return true; // Pretend we clicked, as it is already running.

    const sendSelectors = [
        'button[aria-label*="Send"]:not([aria-label*="Stop"])',
        'button[aria-label*="전송"]:not([aria-label*="중단"])',
        'button[data-testid*="send"]',
        'button[data-testid*="submit"]',
        'button[aria-label="Send message"]',
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

            // Use Persistent Context to share session with manual_login.js
            browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
                headless: attemptHeadless,
                // Ensure same args as manual login to match session fingerprint
                args: [
                    '--no-sandbox',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-infobars',
                    '--window-size=1920,1080',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                ],
                slowMo: BROWSER_SLOWMO,
                permissions: ['clipboard-read', 'clipboard-write'],
                viewport: { width: 1920, height: 1080 }
            });
            // browser object is bound to context in persistent mode
            browser = browserContext;

            // New Helper: Paste Input to bypass React State issues
            const pasteInput = async (page, text) => {
                await page.evaluate((t) => navigator.clipboard.writeText(t), text);
                await page.keyboard.press('Control+V');
            };

            // Helper: Get Response Root Selector
            const getResponseRoot = (id) => {
                if (id === 'chatgpt') return '[data-testid="conversation-turn"]'; // Will target last one logic inside
                if (id === 'claude') return '[data-testid="chat-message"], .assistant-response';
                if (id === 'gemini') return 'model-response, [data-testid="response-content"]';
                return 'body';
            };

            // New Helper: MutationObserver for Robust Extraction (Scoped)
            const injectObserver = async (page, id) => {
                const rootSel = getResponseRoot(id);
                try {
                    await page.evaluate((selSelector) => {
                        const getTarget = () => {
                            const els = document.querySelectorAll(selSelector);
                            if (els.length > 0) return els[els.length - 1]; // Agent specific logic often needs last
                            return document.body;
                        };
                        const root = getTarget();

                        window.__RALPH_LATEST = "";
                        window.__RALPH_LAST_LEN = 0;

                        const observer = new MutationObserver((mutations) => {
                            // Re-query root if needed (e.g. streaming adds new chunks)
                            const currentRoot = (selSelector && selSelector !== 'body') ? getTarget() : root;
                            const text = currentRoot.innerText || "";

                            // Simple update if longer
                            // We rely on backend 'stableCount' for stability
                            if (text.length >= window.__RALPH_LAST_LEN) {
                                window.__RALPH_LATEST = text;
                                window.__RALPH_LAST_LEN = text.length;
                            }
                        });

                        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
                    }, rootSel);
                } catch (e) { /* Check specific error */ }
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


            // per-service max wait (ms) - increase for slower services
            const SERVICE_MAX_WAIT = {
                perplexity: 40000,
                chatgpt: 40000,
                gemini: 80000,
                claude: 80000
            };

            const rawData = {};

            // Sanitize strategy to prevent poisoning other agents
            let cleanStrategy = strategy || "";
            if (cleanStrategy.startsWith('Error') || cleanStrategy.startsWith('에러')) {
                cleanStrategy = "(이전 단계 분석 데이터 없음)";
            }

            const workers = [
                {
                    id: 'perplexity',
                    name: 'Perplexity',
                    url: 'https://www.perplexity.ai',
                    input: ['textarea[placeholder*="Ask"]', 'textarea[placeholder*="Where"]', 'textarea[placeholder*="Follow"]', 'textarea', 'div[contenteditable="true"]'],
                    prompt: `${prompt}\n\nRules:\n- 한국어로만 답변\n- 답변만 출력\n- 링크/출처 목록 금지\n- 간결하고 구조적으로 작성`
                },
                {
                    id: 'chatgpt',
                    name: 'ChatGPT',
                    url: 'https://chat.openai.com',
                    input: ['#prompt-textarea', 'textarea[data-id="root"]', 'div[contenteditable="true"]'],
                    prompt: `${prompt}\n\n[참고 데이터]\n${cleanStrategy}\n\n위 데이터를 바탕으로 한국어로 답변해줘.`
                },
                {
                    id: 'gemini',
                    name: 'Google Gemini',
                    url: 'https://gemini.google.com/app',
                    input: ['rich-textarea > div > p', 'div[contenteditable="true"]', 'textarea'],
                    prompt: `${prompt}\n\n[참고 데이터]\n${cleanStrategy}\n\n위 데이터를 바탕으로 한국어로 답변해줘.`
                },
                {
                    id: 'claude',
                    name: 'Claude',
                    url: 'https://claude.ai/new',
                    input: ['div[contenteditable="true"]', 'textarea[placeholder*="Reply"]'],
                    result: '.font-claude-message, .cw-message',
                    prompt: `${prompt}\n\n[CONTEXT FROM SEARCH AGENT]\n${cleanStrategy}\n\n[CRITICAL RULES]\n- 위 [CONTEXT]에 기재된 기업명/티커 정보를 최우선으로 신뢰하십시오. (예: ONDS=Ondas Holdings)\n- 한국어로만 답변\n- 답변에 불필요한 서술이나 인사말 금지\n- 웹 검색/도구 사용 금지\n- 링크/출처 목록 금지\n- 간결하고 구조적으로 작성\n- 불확실하면 추정임을 명시`
                }
            ];

            const workerById = Object.fromEntries(workers.map(w => [w.id, w]));
            const activeWorkers = workers.filter(w => enabledAgents[w.id]);


            // Helper to get Gemini response text using the observer
            const getGeminiResponseText = async (page) => {
                return await page.evaluate(() => window.__RALPH_LATEST || document.body.innerText);
            };

            // Helper to get Claude response text using the observer
            const getClaudeResponseText = async (page) => {
                return await page.evaluate(() => window.__RALPH_LATEST || document.body.innerText);
            };

            // --- Robust Fire & Forget: Sequential Open & Send ---
            const pages = {};

            // Dispatch Agent: Open -> Navigate -> Send (Atomic Sequential Operation)
            const dispatchAgent = async (worker) => {
                logInternal(`[Dispatch] Worker ${worker.id} starting...`);
                onProgress({ status: 'worker_active', message: `[Agency] ${worker.name} 에게 요청 전송...` });

                try {
                    const page = await browserContext.newPage();
                    pages[worker.id] = page;

                    // 1. Navigation
                    await page.goto(worker.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

                    // 2. Login/Modal Checks
                    if (worker.id === 'gemini') {
                        const signedOut = await isGeminiSignedOut(page);
                        if (signedOut) {
                            await delay(3000);
                            if (await isGeminiSignedOut(page)) throw new Error('Signed out');
                        }
                    } else if (worker.id === 'claude') {
                        if (await isClaudeSignedOut(page)) throw new Error('Signed out');
                        await page.evaluate(() => {
                            const btn = document.querySelector('button:has-text("Acknowledge"), button:has-text("Got it")');
                            if (btn) btn.click();
                        }).catch(() => { });
                    } else if (worker.id === 'chatgpt') {
                        if (await isChatGPTSignedOut(page)) throw new Error('Signed out');
                    }

                    // 3. Input & Send with Verification (Hybrid & Retry)
                    await delay(500);
                    const workerPrompt = worker.prompt;
                    let inputSuccess = false;

                    // Helper: Check if generation started
                    const checkGenerationStarted = async () => {
                        return await page.evaluate(() => {
                            const indicators = [
                                'button[aria-label*="Stop"]', 'button[aria-label*="중단"]', 'button[data-testid*="stop"]',
                                '[aria-label="Stop generating"]', '.result-streaming', '.model-response', '.assistant-response'
                            ];
                            // Also check if user message appeared (simpler check)
                            const userMsg = document.body.innerText.includes(window.__RALPH_PROMPT_LAST_CHUNK || "__________");
                            return indicators.some(sel => !!document.querySelector(sel)) || userMsg;
                        });
                    };

                    // Store prompt chunk for verification
                    await page.evaluate((p) => window.__RALPH_PROMPT_LAST_CHUNK = p.substring(0, 15), workerPrompt);

                    for (let attempt = 0; attempt < 2; attempt++) {
                        if (inputSuccess) break;
                        logInternal(`[Dispatch] Worker ${worker.id} attempt ${attempt + 1}...`);

                        for (const sel of (Array.isArray(worker.input) ? worker.input : [worker.input])) {
                            try {
                                const timeout = worker.id === 'perplexity' ? 10000 : 5000;
                                await page.waitForSelector(sel, { timeout });

                                // HYBRID INPUT: Click -> Clear -> Fill -> Paste -> Type (Ensures text is there)
                                await page.click(sel);
                                await delay(300);

                                // Try Fill first
                                try { await page.fill(sel, workerPrompt); } catch (_) { await pasteInput(page, workerPrompt); }

                                // Triple Send Trigger
                                await delay(500);
                                await page.keyboard.press('Control+Enter');
                                await delay(800);

                                // Safety Enter
                                const activeElement = await page.evaluate(() => document.activeElement.tagName);
                                if (activeElement === 'BODY') {
                                    try { await page.click(sel); } catch (_) { }
                                }
                                await page.keyboard.press('Enter');

                                // Smart Click
                                await tryClickSend(page);

                                // VERIFICATION
                                await delay(2000); // Wait for UI update
                                if (await checkGenerationStarted()) {
                                    inputSuccess = true;
                                    logInternal(`[Dispatch] Worker ${worker.id} sent verified.`);
                                    if (worker.id === 'claude' || worker.id === 'gemini') await injectObserver(page);
                                    break; // Selector worked, send verified
                                } else {
                                    logInternal(`[Dispatch] Worker ${worker.id} verification failed.`);
                                }
                            } catch (e) { /* Selector failed, try next */ }
                        }
                    }

                    if (!inputSuccess) throw new Error('Input/Send verification failed after retries');
                    return { id: worker.id, status: 'sent' };

                } catch (e) {
                    logInternal(`[Dispatch] Worker ${worker.id} failed: ${e.message}`);
                    if (pages[worker.id]) await pages[worker.id].close().catch(() => { });
                    return { id: worker.id, status: 'error', error: e.message };
                }
            };

            // Execute Dispatch Sequentially
            const dispatchResults = [];
            logInternal('[Agency] Phase 1: Sequential Dispatch...');
            for (const worker of activeWorkers) {
                dispatchResults.push(await dispatchAgent(worker));
                await delay(1000); // Buffer
            }

            // 2. Collection Phase: Scrape results from open pages
            // 2. Collection Phase: Scrape results from open pages (PARALLEL for Performance)
            logInternal('[Agency] Phase 2: Parallel Collection...');

            // Helper to collect
            const collectResult = async (worker) => {
                const page = pages[worker.id];
                if (!page) return { id: worker.id, value: `Error: Dispatch failed` };

                const dispatchStatus = dispatchResults.find(r => r.id === worker.id);
                if (dispatchStatus && dispatchStatus.status === 'error') {
                    await page.close().catch(() => { });
                    return { id: worker.id, value: `Error: ${dispatchStatus.error}` };
                }

                logInternal(`[Collect] Worker ${worker.id} reading response...`);
                onProgress({ status: 'streaming', service: worker.id, content: '(응답 수신 대기 중...)' });

                try {
                    let lastText = "";
                    let stableCount = 0;
                    const minLength = worker.id === 'perplexity' ? 50 : 15;
                    const maxIters = SERVICE_MAX_WAIT[worker.id] / 2000;

                    for (let i = 0; i < maxIters; i++) {
                        await delay(2000);
                        let candidate = null;

                        // Extraction Logic
                        if (worker.id === 'gemini') {
                            candidate = await getGeminiResponseText(page);
                        } else if (worker.id === 'claude') {
                            candidate = await getClaudeResponseText(page);
                        } else {
                            const resultSels = Array.isArray(worker.result) ? worker.result : [worker.result];
                            candidate = await getCleanText(page, resultSels);
                        }

                        // Sanitization
                        if (worker.id === 'claude') candidate = sanitizeClaudeOutput(candidate);
                        if (worker.id === 'perplexity') candidate = sanitizePerplexityOutput(candidate);
                        if (worker.id === 'gemini') candidate = sanitizeGeminiOutput(candidate, worker.prompt);

                        const isThinking = (!candidate || candidate.length < minLength);

                        // Streaming Update
                        if (candidate && candidate.trim().length > 0) {
                            if (candidate !== lastText) {
                                lastText = candidate;
                                stableCount = 0;
                                onProgress({ status: 'streaming', service: worker.id, content: lastText });
                            } else {
                                stableCount++;
                            }
                        }

                        // Completion Condition: Stable for 3 ticks (6s) AND sufficient length
                        if (stableCount >= 3 && lastText.length >= minLength) break;
                    }
                    logInternal(`[Collect] Worker ${worker.id} finished: ${lastText.length} chars.`);
                    await page.close();
                    return { id: worker.id, value: lastText };
                } catch (e) {
                    await page.close().catch(() => { });
                    return { id: worker.id, value: `Error: ${e.message}` };
                }
            };

            // Run Collection in Parallel Batches (Concurrency 2 or 4)
            // Since scraping isn't CPU heavy, we can increase concurrency to 4 to maximize speed
            const collectionConcurrency = 4;
            const results = [];
            for (let i = 0; i < activeWorkers.length; i += collectionConcurrency) {
                const batch = activeWorkers.slice(i, i + collectionConcurrency);
                const batchPromises = batch.map(w => collectResult(w));
                const batchSettled = await Promise.allSettled(batchPromises);
                for (const s of batchSettled) {
                    if (s.status === 'fulfilled') results.push(s.value);
                    else results.push({ id: 'unknown', value: `Top-level Error: ${s.reason}` });
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
- 한국어 작성, 최상급 컨설팅 리포트 톤 (McKinsey/Bain 스타일)
- 문장은 간결하고 단정적 ("~임", "~함" 대신 완결된 문장 사용 권장)
- "불확실성"과 "확정 사실"을 엄격히 구분
- 감성적 수식어 제거, 구조적 인과관계 중심 서술
- 새로운 사실/수치 창작 금지 (원문 기반)

# 종합 인텔리전스 보고서: ${prompt}

## 2.0 커버 & 메타
- 분석 대상: (질문 키워드)
- 데이터 출처: (활성 에이전트 목록)
- 분석 신뢰도: (데이터 충실도에 따른 High/Med/Low)

## 2.1 Executive Summary
- 핵심 결론(3줄 요약): (가장 중요한 발견 통찰)
- 주요 리스크: (핵심 불확실성 1가지)
- 권고 액션: (가장 시급한 다음 단계)

## 2.2 핵심 인사이트 Top 5
| 인사이트 | 근거 요약 | 영향도(H/M/L) | 신뢰도(★) |
|---|---|---|---|
| (인사이트1) | ... | ... | ... |
| (인사이트2) | ... | ... | ... |
...

## 2.3 합의 vs 불일치 매트릭스
(에이전트 간 관점 차이 분석)
| 관점 | 합의 내용 (공통 의견) | 불일치/충돌 (관점 차이) |
|---|---|---|
| ... | ... | ... |

## 2.4 구조적 원인-경로-결과
- **원인(Drivers)**: (결과를 만들어낸 핵심 동인)
- **전개 메커니즘(Path)**: (원인이 결과로 이어지는 논리적 경로)
- **최종 결과(Impact)**: (현재 관측되는 현상)

## 2.5 시나리오 플래닝
| 시나리오 | 가능성 | 핵심 조건(Trigger) | 예상 파급효과 |
|---|---|---|---|
| 베이스(Base) | (Up/Down) | ... | ... |
| 상승(Bull) | ... | ... | ... |
| 하락(Bear) | ... | ... | ... |

## 2.6 리스크 & 불확실성
- **데이터 공백**: (확인되지 않은 정보)
- **논리적 충돌**: (해석이 갈리는 부분)
- **외부 변수**: (통제 불가능한 요인)

## 2.7 전략 옵션 & 권고 액션
- **옵션 A (적극/공격)**: (기대효과 vs 리스크)
- **옵션 B (중립/방어)**: ...
- **권장 방향**: (결론적 제언)

## 2.8 모니터링 체크리스트
- [ ] (KPI 또는 관찰해야 할 지표 1) - (확인 주기)
- [ ] (KPI 또는 관찰해야 할 지표 2) ...

## 2.9 부록
- 사용 에이전트 상세 상태: ${JSON.stringify(agentStatus)}
`;

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
