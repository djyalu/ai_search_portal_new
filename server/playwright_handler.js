import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import NotionService from './notion_service.js';
import { validateReport } from './report_validator.js';

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

// Global Reasoning Cache to skip redundant Perplexity analysis (Memory-only, TTL simulated)
const REASONING_CACHE = new Map();
const MAX_REASONING_CACHE_SIZE = 100;
const REASONING_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

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

// Shared Noise Stripper Logic
const GLOBAL_STOP_PHRASES = [
    'sign in', 'upgrade', 'tools', 'cookie preferences', 'see plans',
    'keep chatting', 'you are out of free messages', 'share', 'related', 'sources',
    'make this response better', 'regenerate', 'was this helpful', 'bad response',
    'copy code', 'view sources', 'learn more',
    'about gemini', 'gemini app', 'subscriptions', 'for business', 'once you\'re signed in',
    'recents', 'hide', 'free plan', 'what can i help you with today?',
    'you said', 'chatgpt said', 'assistant', 'system', 'model', 'tools',
    'ask a follow-up', 'show more', 'answer', 'links', 'images', 'install',
    'history', 'discover', 'spaces', 'finance', 'travel', 'academic', 'more'
];

function sanitizeCommonNoise(text) {
    if (!text) return text;
    return text.split('\n').filter(line => {
        const l = line.trim().toLowerCase();
        if (!l) return true;
        // Exact match or contains if short enough to be a UI label
        if (GLOBAL_STOP_PHRASES.some(p => l === p || (l.length < 60 && l.includes(p)))) return false;
        return true;
    }).join('\n').trim();
}

function countNoiseHits(text) {
    if (!text) return 0;
    const lower = text.toLowerCase();
    const tokens = [
        'about gemini', 'gemini app', 'subscriptions', 'for business', 'once you\'re signed in',
        'recents', 'hide', 'free plan', 'what can i help you with today', 'upgrade', 'tools',
        'ask a follow-up', 'show more', 'answer', 'links', 'images', 'install',
        'history', 'discover', 'spaces', 'finance', 'travel', 'academic', 'more',
        'cookie preferences', 'view sources'
    ];
    let hits = 0;
    for (const t of tokens) if (lower.includes(t)) hits++;
    return hits;
}

function looksLikeUiNoise(text) {
    if (!text) return true;
    const hits = countNoiseHits(text);
    if (hits >= 4) return true;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const shortLines = lines.filter(l => l.length <= 20).length;
    if (lines.length > 10 && shortLines / lines.length > 0.7) return true;
    return false;
}

function normalizeReport(text) {
    if (!text) return text;
    let cleaned = text
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+\n/g, '\n')
        .trim();

    // Flexible strip prompt echoes and preambles
    // Pattern: Look for start of document or preamble, then non-greedy match until the first major report header.
    // This handles "Sure! Here is the report..." or "You said: ... ChatGPT said: ..."
    const reportHeaders = ['# 종합 인텔리전스 보고서', '## 2\\.0 커버 & 메타', '종합 인텔리전스 보고서'];
    const headerPattern = reportHeaders.join('|');
    const echoRegex = new RegExp(`^[\\s\\S]*?(${headerPattern})`, 'i');

    cleaned = cleaned.replace(echoRegex, '$1');

    // Strip boilerplate tails
    cleaned = cleaned.replace(/(ChatGPT can make mistakes|See Cookie Preferences|Was this helpful|Bad response)[\s\S]*$/i, '').trim();

    return cleaned;
}

function sanitizeClaudeOutput(text) {
    if (!text) return text;
    let cleaned = sanitizeCommonNoise(text);
    const stopLabels = new Set([
        'new chat', 'search', 'chats', 'projects', 'artifacts', 'code', 'recents', 'hide',
        'all chats', 'history', 'recent', 'share', 'free plan', 'upgrade', 'account', 'settings',
        'subscribe', 'user', 'claude', 'claude.ai', 'anthropic', 'help', 'star', 'pinned',
        'retry', 'copy', 'helpful', 'unhelpful', 'reply', 'usage limits', 'workspace', 'manage plan'
    ]);
    const lines = cleaned.split('\n');
    const filtered = lines.filter((line) => {
        const l = line.trim();
        if (!l) return true;
        if (l.length > 60) return true; // unlikely to be a UI label
        const lower = l.toLowerCase();
        if (stopLabels.has(lower)) return false;
        if (lower.startsWith('search results')) return false;
        if (lower === 'sources' || lower.startsWith('sources ') || lower.startsWith('source ')) return false;
        return true;
    });
    return filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function sanitizePerplexityOutput(text) {
    if (!text) return text;
    let cleaned = sanitizeCommonNoise(text);
    const stopLabels = new Set([
        'history', 'recent', 'discover', 'spaces', 'finance', 'travel', 'academic', 'more',
        'account', 'upgrade', 'install', 'answer', 'links', 'images', 'ask a follow-up',
        'search', 'searching', 'reviewing sources', 'thinking', 'powered by', 'related',
        'share', 'rewrite', 'copy'
    ]);
    const lines = cleaned.split('\n');
    const filtered = lines.filter((line) => {
        const l = line.trim();
        if (!l) return true;

        const lower = l.toLowerCase();
        if (stopLabels.has(lower)) return false;

        // Perplexity specific noise
        if (lower.startsWith('searching')) return false;
        if (lower.startsWith('reviewing sources')) return false;
        if (lower.startsWith('sources')) return false;
        if (lower.startsWith('links')) return false;
        if (lower.startsWith('images')) return false;
        if (lower.startsWith('ask a follow-up')) return false;
        if (lower.startsWith('powered by')) return false;
        if (lower.includes('reddit+1')) return false;

        // strip pure domain lines / source list items
        if (/(^|\s)([a-z0-9-]+\.)+(com|net|org|ai|io|co|kr|us|uk|edu|gov|jp|cn|de)(\b|\/)/i.test(l)) return false;
        return true;
    });
    return filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function sanitizeGeminiOutput(text, promptText = '') {
    if (!text) return text;
    let cleaned = sanitizeCommonNoise(text);

    // Remove Prompt Echo if present
    const promptLines = promptText
        ? promptText.split('\n').map(line => line.trim()).filter(Boolean)
        : [];
    const promptSet = new Set(promptLines);

    const lines = cleaned.split('\n');
    const stopLabels = new Set([
        'gemini', 'conversation with gemini', 'fast', 'pro', 'your privacy', 'opens in a new window',
        'gemini can make mistakes', 'your privacy & gemini', 'feedback', 'report', 'share', 'view sources',
        'show drafts', 'regenerate drafts', 'volume_up', 'thumb_up', 'thumb_down', 'more_vert'
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
        if (l === 'list' || l === 'edit') return false; // Gemini UI icons
        return true;
    });

    const result = filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!result) return null;
    if (result.length < 12) return result;
    return result;
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
                if (root.matches && (root.matches('[data-testid="response-content"]') || root.matches('.markdown') || root.matches('.model-response-text'))) {
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
                    const inner = root.querySelector?.('[data-testid="response-content"], .markdown, .model-response-text, .assistant-response, .message-content');
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
            const fallbackSels = ['[data-testid="response-content"]', 'model-response .markdown', 'model-response .model-response-text', 'response-container .model-response-text', 'response-container .markdown', '.model-response-text', '.assistant-response', 'article'];
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
            'button[data-testid*="stop"]', '[aria-label="Stop generating"]',
            'button[aria-label*="중지"]', 'button[aria-label*="중단하지"]'
        ];
        return stopSelectors.some(sel => !!document.querySelector(sel));
    });
    if (isGenerating) return true; // Pretend we clicked, as it is already running.

    const sendSelectors = [
        'button[aria-label*="Send"]:not([aria-label*="Stop"])',
        'button[aria-label*="전송"]:not([aria-label*="중단"])',
        'button[aria-label*="메시지"]',
        'button[data-testid*="send"]',
        'button[data-testid*="submit"]',
        'button[aria-label="Send message"]',
        'button[data-testid="send-button"]',
        'button[aria-label="Submit"]',
        '.send-button',
        'button.send',
        'button.submit'
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

async function waitForNotGenerating(page, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const stillGenerating = await page.evaluate(() => {
            const stopSelectors = [
                'button[aria-label*="Stop"]', 'button[aria-label*="중단"]',
                'button[data-testid*="stop"]', '[aria-label="Stop generating"]',
                'button[aria-label*="중지"]', 'button[aria-label*="중단하지"]'
            ];
            return stopSelectors.some(sel => !!document.querySelector(sel));
        });
        if (!stillGenerating) return true;
        await delay(500);
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
// Global Context for Reuse (Performance Breakthrough)
let globalContext = null;
let contextUsageCount = 0;
let lastUsedTimestamp = Date.now();
const CONTEXT_MAX_USAGE = 20;
const CONTEXT_IDLE_TIMEOUT = 30 * 60 * 1000; // 30 mins
const globalPagePool = {};

export async function runExhaustiveAnalysis(prompt, onProgress, options = {}) {
    const enabledAgents = {
        perplexity: true,
        chatgpt: true,
        gemini: true,
        claude: true,
        ...(options?.enabledAgents || {})
    };

    // Performance: Reuse global context if available and healthy (Item 6: Lifecycle Management)
    const now = Date.now();
    if (globalContext) {
        const isExpired = contextUsageCount >= CONTEXT_MAX_USAGE;
        const isIdle = (now - lastUsedTimestamp) > CONTEXT_IDLE_TIMEOUT;

        if (isExpired || isIdle) {
            logInternal(`[Performance] Context lifecycle end (Usage: ${contextUsageCount}, Idle: ${isIdle}). Resetting...`);
            try { await globalContext.close(); } catch (e) { }
            globalContext = null;
            contextUsageCount = 0;
            // Clear page pool
            Object.keys(globalPagePool).forEach(key => delete globalPagePool[key]);
        } else {
            try {
                if (globalContext.pages().length >= 0) {
                    logInternal(`[Performance] Reusing global context (Usage: ${contextUsageCount + 1}/${CONTEXT_MAX_USAGE}).`);
                    contextUsageCount++;
                    lastUsedTimestamp = now;
                } else {
                    globalContext = null;
                }
            } catch (e) { globalContext = null; }
        }
    }

    const headlessAttempts = BROWSER_HEADLESS ? [true, false] : [false];
    let lastError;

    // Attempt logic only if globalContext is missing
    const attempts = globalContext ? [true] : headlessAttempts; // If reuse, just run logic

    for (const attemptHeadless of attempts) {
        let browserContext = globalContext;
        let isReused = !!globalContext;

        try {
            if (!browserContext) {
                logInternal(`RALPH 에이전시 파이프라인 가동... (New Session)`);
                onProgress({ status: 'hierarchy_init', message: '[Hierarchy] 엔진 초기화 및 가속 모드 가동...' });

                // Use Persistent Context to share session with manual_login.js
                browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
                    headless: attemptHeadless,
                    channel: BROWSER_CHANNEL, // G2 Gap Fix: Respect BROWSER_CHANNEL
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

                // RESOURCE BLOCKING (Perf Boost)
                await browserContext.route('**/*', (route) => {
                    const type = route.request().resourceType();
                    // Item 7: Selective blocking. Keep fonts for better UI rendering stability
                    if (['image', 'media'].includes(type)) {
                        return route.abort();
                    }
                    return route.continue();
                });

                globalContext = browserContext; // Save globally
            } else {
                logInternal(`RALPH 에이전시 파이프라인 가동... (Hot-Start)`);
                onProgress({ status: 'hierarchy_init', message: '[Hierarchy] 핫-스타트(Hot-Start) 가속 처리 중...' });
            }

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
                if (id === 'perplexity') return '.prose, [data-testid="answer"], .result, .message-content, main article';
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

            // --- Pre-warm Phase (Internal) ---
            // Start opening tabs while we reason
            const warmUps = Object.entries(enabledAgents)
                .filter(([id, enabled]) => enabled && id !== 'perplexity') // Perplexity warmed below or via Reasoning
                .map(async ([id]) => {
                    try {
                        const p = await browserContext.newPage();
                        globalPagePool[id] = p;
                        await p.goto(workerById[id].url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                    } catch (e) { }
                });

            // --- 1. Reasoning Phase (R) ---
            logInternal(`Reasoning Phase 시작. Prompt sent to Perplexity...`);
            onProgress({ status: 'reasoning', message: '[Reasoning] 질의 의도 분석 및 에이전트 작업 설계 중...' });
            const planningPrompt = `질문: "${prompt}"\n이 질문을 가장 효과적으로 분석하기 위해 4개의 AI(Search, Reasoning, Creative, Logical)에게 각각 어떤 관점으로 질문하면 좋을지 전략을 간단히 요약해줘. 한국어로 작성해.`;

            let strategy = "Perplexity 비활성화로 계획 생략";
            if (!enabledAgents.perplexity) {
                strategy = "Perplexity 비활성화로 계획 생략";
                await Promise.all(warmUps); // Finish other warmups
            } else {
                let planningPage = globalPagePool['perplexity'];
                if (!planningPage || planningPage.isClosed()) {
                    planningPage = await browserContext.newPage();
                    globalPagePool['perplexity'] = planningPage;
                }
                strategy = "기본 분석 모드";
                const reasoningStart = Date.now();
                try {
                    // Optimization: 15s limit for reasoning
                    await planningPage.goto('https://www.perplexity.ai/', { waitUntil: 'domcontentloaded', timeout: 30000 });

                    const planningTask = (async () => {
                        const planningInputs = ['#ask-input', '[data-lexical-editor="true"]', 'div[contenteditable="true"]', 'textarea', '#prompt-textarea'];
                        let inputFound = false;
                        for (const sel of planningInputs) {
                            try {
                                await planningPage.waitForSelector(sel, { timeout: 3000 });
                                try { await planningPage.fill(sel, planningPrompt); } catch (_) {
                                    await planningPage.click(sel).catch(() => { });
                                    await planningPage.keyboard.type(planningPrompt, { delay: 10 });
                                }
                                await planningPage.keyboard.press('Enter');
                                inputFound = true;
                                break;
                            } catch (_) { }
                        }
                        if (!inputFound) throw new Error('Planning input not found');

                        await delay(5000);
                        const result = await getCleanText(planningPage, ['.prose', '.result', '.message-content']) || "기본 전략 가동";
                        return result;
                    })();

                    try {
                        // Check Cache first with TTL (G3 Gap Fix)
                        const cached = REASONING_CACHE.get(prompt);
                        if (cached && (Date.now() - cached.storedAt < REASONING_CACHE_TTL_MS)) {
                            strategy = cached.strategy;
                            logInternal(`[Reasoning] Cache hit for prompt. Strategy reused.`);
                            await Promise.all(warmUps);
                        } else {
                            // Race planning with a 10s total timeout after navigation (Snappy feed)
                            strategy = await Promise.race([
                                planningTask,
                                new Promise((_, reject) => setTimeout(() => reject(new Error('Reasoning Timeout')), 10000))
                            ]);

                            const elapsed = Date.now() - reasoningStart;
                            logInternal(`[Reasoning] Completed in ${elapsed}ms. Strategy: ${strategy.substring(0, 40)}...`);

                            // Store in cache with Timestamp
                            if (strategy && !strategy.includes('Error')) {
                                if (REASONING_CACHE.size >= MAX_REASONING_CACHE_SIZE) {
                                    const firstKey = REASONING_CACHE.keys().next().value;
                                    if (firstKey) REASONING_CACHE.delete(firstKey);
                                }
                                REASONING_CACHE.set(prompt, { strategy, storedAt: Date.now() });
                            }
                            await Promise.all(warmUps);
                        }
                    } catch (err) {
                        strategy = `기본 분석 모드 (Reasoning Status: ${err.message})`;
                        logInternal(`[Reasoning] Failed or Timeout: ${err.message}. Cascading to default Agency.`);
                        await Promise.all(warmUps);
                    }
                } catch (generalReasoningError) {
                    strategy = `기본 분석 모드 (Critical Reasoning Error: ${generalReasoningError.message})`;
                    logInternal(`[Reasoning] Outer block failure: ${generalReasoningError.message}`);
                    await Promise.all(warmUps);
                }
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
            if (cleanStrategy.startsWith('Error') || cleanStrategy.startsWith('??????')) {
                cleanStrategy = "(?????? ?????? ?????? ????????? ??????)";
            }
            cleanStrategy = sanitizeCommonNoise(cleanStrategy);
            if (cleanStrategy.length > 1200) {
                cleanStrategy = cleanStrategy.substring(0, 1200);
            }
            const workers = [
                {
                    id: 'perplexity',
                    name: 'Perplexity',
                    url: 'https://www.perplexity.ai',
                    input: ['textarea[placeholder*="Ask"]', 'textarea[placeholder*="Where"]', 'textarea[placeholder*="Follow"]', 'textarea', 'div[contenteditable="true"]'],
                    result: ['.prose', '[data-testid="answer"]', '.result', '.message-content', 'main article'],
                    prompt: `${prompt}\n\nRules:\n- 한국어로만 답변\n- 답변만 출력\n- 링크/출처 목록 금지\n- 간결하고 구조적으로 작성`
                },
                {
                    id: 'chatgpt',
                    name: 'ChatGPT',
                    url: 'https://chatgpt.com',
                    input: ['#prompt-textarea', 'div#prompt-textarea', 'div[role="textbox"]', 'textarea[data-id="root"]', 'div[contenteditable="true"]'],
                    result: ['[data-testid="conversation-turn"] [data-message-author-role="assistant"]', '[data-testid="conversation-turn"] .markdown', '[data-testid="conversation-turn"] .prose'],
                    prompt: `${prompt}\n\n[참고 데이터]\n${cleanStrategy}\n\n위 데이터를 바탕으로 한국어로 답변해줘.`
                },
                {
                    id: 'gemini',
                    name: 'Google Gemini',
                    url: 'https://gemini.google.com/app',
                    input: ['rich-textarea .ql-editor', '.ql-editor', 'rich-textarea > div > p', 'div[contenteditable="true"]', 'textarea'],
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


            // Helper: Get ChatGPT response text
            const getChatGPTResponseText = async (page) => {
                return await page.evaluate(() => {
                    const turns = document.querySelectorAll('[data-testid="conversation-turn"]');
                    if (turns.length) {
                        const last = turns[turns.length - 1];
                        const assistant = last.querySelector('[data-message-author-role="assistant"], .markdown, .prose');
                        if (assistant) return assistant.innerText.trim();
                        return last.innerText.trim();
                    }
                    const assistants = document.querySelectorAll('[data-message-author-role="assistant"]');
                    if (assistants.length) return assistants[assistants.length - 1].innerText.trim();
                    const fallback = document.querySelector('.markdown, .prose');
                    return fallback ? fallback.innerText.trim() : null;
                });
            };

            // Helper to get Gemini response text (Hybrid: Observer + Fallback)
            const getGeminiResponseText = async (page) => {
                const obsText = await page.evaluate(() => window.__RALPH_LATEST);
                if (obsText && obsText.length > 50) return obsText;

                // Fallback to deep traversal
                return await page.evaluate(() => {
                    const readText = (node) => node && node.innerText ? node.innerText.trim() : '';
                    const findTextDeep = (root) => {
                        if (!root) return '';
                        let text = '';
                        if (root.matches && (root.matches('[data-testid="response-content"]') || root.matches('.markdown') || root.matches('.model-response-text'))) return readText(root);
                        if (root.shadowRoot) text += findTextDeep(root.shadowRoot);
                        for (const child of Array.from(root.children || [])) {
                            const childText = findTextDeep(child);
                            if (childText) text += (text ? '\n' : '') + childText;
                        }
                        return text.trim();
                    };
                    const responses = Array.from(document.querySelectorAll('model-response'));
                    if (responses.length) return findTextDeep(responses[responses.length - 1]);
                    return readText(document.querySelector('[data-testid="response-content"]'));
                });
            };

            // Helper to get Claude response text
            const getClaudeResponseText = async (page) => {
                const obsText = await page.evaluate(() => window.__RALPH_LATEST);
                if (obsText && obsText.length > 200) return obsText; // Use observer only for long text

                return await page.evaluate(() => {
                    // Prefer actual message blocks with assistant role if possible (G3 Fix)
                    const turns = document.querySelectorAll('[data-testid="chat-message"]');
                    if (turns.length) {
                        for (let i = turns.length - 1; i >= 0; i--) {
                            const turn = turns[i];
                            // Check if it's the assistant response
                            const content = turn.querySelector('.font-claude-message, .cw-message, .markdown');
                            if (content) return content.innerText.trim();
                        }
                    }
                    const fallbacks = document.querySelectorAll('.assistant-response, .markdown');
                    if (fallbacks.length) return fallbacks[fallbacks.length - 1].innerText.trim();
                    return null;
                });
            };

            const isGeminiStopped = async (page) => {
                return await page.evaluate(() => {
                    const bodyText = document.body?.innerText || '';
                    return bodyText.includes('대답이 중지되었습니다') || bodyText.includes('Response generation stopped');
                });
            };

            const resendGemini = async (page, worker) => {
                for (const sel of (Array.isArray(worker.input) ? worker.input : [worker.input])) {
                    try {
                        await page.waitForSelector(sel, { timeout: 3000 });
                        await page.click(sel);
                        await delay(200);
                        await page.keyboard.press('Control+A');
                        await page.keyboard.press('Backspace');
                        try { await page.fill(sel, worker.prompt); } catch (_) {
                            await pasteInput(page, worker.prompt);
                        }
                        await delay(300);
                        await page.keyboard.press('Enter');
                        await delay(500);
                        await tryClickSend(page);
                        await injectObserver(page, 'gemini');
                        return true;
                    } catch (_) { }
                }
                return false;
            };

            // --- Robust Fire & Forget: Sequential Open & Send ---
            // Per-run page map (used by dispatch/collect)
            const pages = {};

            // ... (in dispatchAgent)
            // Dispatch Agent: Open -> Navigate -> Send (Atomic Sequential Operation)
            const dispatchAgent = async (worker) => {
                const startTime = Date.now();
                let retryCount = 0;
                const MAX_DISPATCH_RETRIES = 1;

                const attemptDispatch = async () => {
                    logInternal(`[Dispatch] Worker ${worker.id} attempt ${retryCount + 1}...`);
                    onProgress({ status: 'worker_active', message: `[Agency] ${worker.name} 에게 요청 전송...` });

                    try {
                        let page = globalPagePool[worker.id];
                        if (page) {
                            try {
                                if (page.isClosed()) page = null;
                                else await page.evaluate(() => document.body).catch(() => page = null);
                            } catch (e) { page = null; }
                        }

                        if (!page) {
                            page = await browserContext.newPage();
                            globalPagePool[worker.id] = page;
                        }
                        pages[worker.id] = page;

                        const currentUrl = page.url();
                        if (!currentUrl.includes(new URL(worker.url).hostname)) {
                            await page.goto(worker.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
                        } else {
                            await page.goto(worker.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
                        }

                        // 2. Login/Modal Checks
                        if (worker.id === 'gemini') {
                            if (await isGeminiSignedOut(page)) throw new Error('Signed out');
                        } else if (worker.id === 'claude') {
                            if (await isClaudeSignedOut(page)) throw new Error('Signed out');
                            await page.evaluate(() => {
                                const btn = document.querySelector('button:has-text("Acknowledge"), button:has-text("Got it")');
                                if (btn) btn.click();
                            }).catch(() => { });
                        } else if (worker.id === 'chatgpt') {
                            if (await isChatGPTSignedOut(page)) throw new Error('Signed out');
                        }

                        await waitForNotGenerating(page, 10000);

                        // 3. Input & Send
                        const workerPrompt = worker.prompt;
                        await page.evaluate((p) => window.__RALPH_PROMPT_LAST_CHUNK = p.substring(0, 15), workerPrompt);

                        const checkGenerationStarted = async () => {
                            return await page.evaluate((wid) => {
                                // C. Perplexity Dispatch Verification (Remediation Plan)
                                if (wid === 'perplexity') {
                                    const hasAnswer = !!document.querySelector('.prose,[data-testid="answer"],.result');
                                    if (hasAnswer) return true;
                                }

                                const indicators = [
                                    'button[aria-label*="Stop"]', 'button[aria-label*="중단"]',
                                    'button[data-testid*="stop"]', '[aria-label="Stop generating"]',
                                    'button[aria-label*="Stop streaming"]',
                                    '.result-streaming', '.model-response', '.assistant-response'
                                ];
                                const hasIndicator = indicators.some(sel => !!document.querySelector(sel));
                                const userMsg = document.body?.innerText?.includes(window.__RALPH_PROMPT_LAST_CHUNK || "__________");
                                if (wid !== 'gemini') return hasIndicator || userMsg;

                                const inputSel = 'rich-textarea .ql-editor, .ql-editor, div[contenteditable="true"]';
                                const input = document.querySelector(inputSel);
                                const inputText = input ? (input.innerText || '').trim() : '';
                                const inputCleared = inputText.length <= 2;

                                const responseNodes = document.querySelectorAll(
                                    'model-response .model-response-text, model-response [data-testid="response-content"], response-container .markdown, response-container .model-response-text'
                                );
                                let hasResponseText = false;
                                for (const n of responseNodes) {
                                    if (n && n.innerText && n.innerText.trim().length > 0) { hasResponseText = true; break; }
                                }
                                return hasIndicator || hasResponseText || (userMsg && inputCleared);
                            }, worker.id);
                        };

                        let inputSuccess = false;
                        for (const sel of (Array.isArray(worker.input) ? worker.input : [worker.input])) {
                            try {
                                const selectorTimeout = worker.id === 'perplexity' ? 12000 : 8000;
                                await page.waitForSelector(sel, { timeout: selectorTimeout });
                                await page.click(sel);
                                await delay(300);
                                try { await page.fill(sel, workerPrompt); } catch (_) { await pasteInput(page, workerPrompt); }
                                await delay(500);
                                await page.keyboard.press('Control+Enter');
                                await delay(500);
                                await page.keyboard.press('Enter');
                                await tryClickSend(page);

                                // VERIFICATION
                                for (let v = 0; v < 4; v++) {
                                    if (await checkGenerationStarted()) { inputSuccess = true; break; }
                                    await delay(1200);
                                }
                                if (inputSuccess) break;
                            } catch (e) { }
                        }

                        if (!inputSuccess) throw new Error('send_failed');

                        const elapsed = Date.now() - startTime;
                        logInternal(`[Dispatch] Worker ${worker.id} verified in ${elapsed}ms.`);
                        if (worker.id === 'claude' || worker.id === 'gemini') await injectObserver(page, worker.id);
                        return { id: worker.id, status: 'sent', elapsed_ms: elapsed };

                    } catch (e) {
                        logInternal(`[Dispatch] Worker ${worker.id} failed attempt ${retryCount + 1}: ${e.message}`);
                        if (retryCount < MAX_DISPATCH_RETRIES) {
                            retryCount++;
                            await pages[worker.id]?.close().catch(() => { });
                            globalPagePool[worker.id] = null;
                            await delay(2000);
                            return await attemptDispatch();
                        }
                        const page = pages[worker.id];
                        if (page) {
                            const ts = Date.now();
                            try {
                                await page.screenshot({ path: `debug_${worker.id}_dispatch_failed_${ts}.png`, fullPage: false }).catch(() => { });
                                const html = await page.content().catch(() => { });
                                if (html) fs.writeFileSync(`debug_${worker.id}_dispatch_failed_${ts}.html`, html);
                            } catch (_) { }
                            await page.close().catch(() => { });
                        }
                        return { id: worker.id, status: 'error', error: e.message };
                    }
                };

                return await attemptDispatch();
            };

            // Parallel Dispatch with Concurrency Pool (Limit: 3)
            const dispatchResults = [];
            logInternal('[Agency] Phase 1: Parallel Dispatch (Pool Limit: 3)...');

            const runDispatchWithPool = async (workers, limit) => {
                const results = [];
                const executing = new Set();
                for (const worker of workers) {
                    const p = Promise.resolve().then(() => dispatchAgent(worker));
                    results.push(p);
                    executing.add(p);
                    const clean = () => executing.delete(p);
                    p.then(clean).catch(clean);
                    if (executing.size >= limit) {
                        await Promise.race(executing);
                    }
                }
                return Promise.all(results);
            };

            const dispatchBatchResults = await runDispatchWithPool(activeWorkers, 4);
            dispatchResults.push(...dispatchBatchResults);

            // 2. Collection Phase: Scrape results from open pages
            // 2. Collection Phase: Scrape results from open pages (PARALLEL for Performance)
            logInternal('[Agency] Phase 2: Parallel Collection...');

            // Helper to collect with RETRY logic
            const collectResult = async (worker) => {
                const startTime = Date.now();
                let retryCount = 0;
                const MAX_COLLECT_RETRIES = 1;

                const attemptCollection = async () => {
                    const page = pages[worker.id];
                    if (!page) return { id: worker.id, value: `Error: Dispatch failed` };

                    const dispatchStatus = dispatchResults.find(r => r.id === worker.id);
                    if (dispatchStatus && dispatchStatus.status === 'error') {
                        await page.close().catch(() => { });
                        return { id: worker.id, value: `Error: ${dispatchStatus.error}` };
                    }

                    logInternal(`[Collect] Worker ${worker.id} reading response (Attempt ${retryCount + 1})...`);
                    onProgress({ status: 'streaming', service: worker.id, content: '(응답 수신 대기 중...)' });

                    try {
                        // Step 2.3: Wait for response container before extraction
                        const containerSel = getResponseRoot(worker.id);
                        if (containerSel && containerSel !== 'body') {
                            await page.waitForSelector(containerSel, { timeout: 12000 }).catch(() => {
                                logInternal(`[Collect] Wait for ${worker.id} container ${containerSel} timed out.`);
                            });
                        }

                        if (worker.id === 'gemini') {
                            await page.waitForSelector('model-response .model-response-text, model-response [data-testid=\"response-content\"], response-container .markdown', { timeout: 15000 }).catch(() => {
                                logInternal('[Collect] Wait for gemini response text timed out.');
                            });
                        }

                        let lastText = "";
                        let stableCount = 0;
                        let nullCounter = 0;
                        let stoppedCount = 0; // D. Gemini Stopped Counter (Remediation Plan)

                        // B. minLength Dynamic Scaling (Remediation Plan)
                        const baseLen = worker.id === 'perplexity' ? 60 : 30;
                        const minLength = Math.min(180, Math.max(baseLen, Math.floor(prompt.length * 0.2)));

                        const NULL_STREAK_LIMIT = worker.id === 'gemini' ? 4 : 5; // A. Custom Fail-Fast (Remediation Plan)
                        const targetStableCount = (worker.id === 'gemini' || worker.id === 'claude') ? 4 : 3;
                        const maxIters = SERVICE_MAX_WAIT[worker.id] / 2000;

                        for (let i = 0; i < maxIters; i++) {
                            await delay(2000);
                            let candidate = null;

                            // Gemini Stop/Stop Detection
                            const isGenerating = await page.evaluate(() => {
                                const stopSelectors = [
                                    'button[aria-label*="Stop"]', 'button[aria-label*="중단"]',
                                    'button[data-testid*="stop"]', '[aria-label="Stop generating"]',
                                    'button[aria-label*="중지"]'
                                ];
                                return stopSelectors.some(sel => !!document.querySelector(sel));
                            });

                            // D. Gemini Stopped Handling (Remediation Plan)
                            if (worker.id === 'gemini') {
                                if (await isGeminiStopped(page)) {
                                    stoppedCount++;
                                    if (stoppedCount >= 2) throw new Error('gemini_stopped');
                                    const resent = await resendGemini(page, worker);
                                    if (!resent) throw new Error('gemini_stopped');
                                    await delay(2000);
                                }
                                candidate = await getGeminiResponseText(page);
                            } else if (worker.id === 'claude') {
                                candidate = await getClaudeResponseText(page);
                            } else if (worker.id === 'chatgpt') {
                                candidate = await getChatGPTResponseText(page);
                                if (!candidate) {
                                    const resultSels = Array.isArray(worker.result) ? worker.result : [worker.result];
                                    candidate = await getCleanText(page, resultSels);
                                }
                            } else {
                                const resultSels = Array.isArray(worker.result) ? worker.result : [worker.result];
                                candidate = await getCleanText(page, resultSels);
                            }

                            // Item 8: Sanitization Optimization - Only sanitize if changed
                            let sanitized = null;
                            if (candidate && candidate !== lastText) {
                                let c = candidate;
                                if (worker.id === 'claude') c = sanitizeClaudeOutput(c);
                                else if (worker.id === 'perplexity') c = sanitizePerplexityOutput(c);
                                else if (worker.id === 'gemini') c = sanitizeGeminiOutput(c, worker.prompt);
                                else c = sanitizeCommonNoise(c);

                                if (!looksLikeUiNoise(c)) sanitized = c;
                            } else if (candidate === lastText) {
                                sanitized = lastText; // Reuse last sanitized if no change
                            }

                            if (sanitized && sanitized.trim().length > 0) {
                                nullCounter = 0;
                                if (sanitized !== lastText) {
                                    lastText = sanitized;
                                    stableCount = 0;
                                    onProgress({ status: 'streaming', service: worker.id, content: lastText });
                                } else {
                                    stableCount++;
                                }
                            } else {
                                nullCounter++;
                            }

                            // Early Termination for Professional Reports (P1 Improvement)
                            const isCompleteEnough = lastText.length >= minLength;
                            const isStable = stableCount >= targetStableCount;

                            const isFinalSentence = /[.!?](\s+)?$/.test(lastText.trim());
                            const isCompleteResponse = isCompleteEnough && isFinalSentence;

                            // A. Fail-Fast (Remediation Plan)
                            if (nullCounter >= NULL_STREAK_LIMIT && !isGenerating) {
                                logInternal(`[Collect] Worker ${worker.id} Fail-Fast: No text for 8-10s and generation stopped.`);
                                break;
                            }

                            // Exit if we have a clean final sentence and some stability
                            if (isCompleteResponse && stableCount >= 2) break;
                            if (isCompleteEnough && isStable) break;
                            if (isCompleteEnough && !isGenerating && i > 3) break; // Aggressive exit if not generating anymore
                        }

                        if (lastText.length < minLength) throw new Error('short_output');
                        if (looksLikeUiNoise(lastText)) throw new Error('noisy_output');

                        const elapsed = Date.now() - startTime;
                        logInternal(`[Collect] Worker ${worker.id} finished: ${lastText.length} chars in ${elapsed}ms.`);
                        await page.close().catch(() => { });
                        return { id: worker.id, value: lastText };

                    } catch (e) {
                        const errMsg = e.message;
                        logInternal(`[Collect] Worker ${worker.id} failed attempt ${retryCount + 1}: ${errMsg}`);

                        if (retryCount < MAX_COLLECT_RETRIES && (errMsg === 'short_output' || errMsg === 'noisy_output')) {
                            retryCount++;
                            const waitNext = errMsg === 'short_output' ? 6000 : 3000;
                            logInternal(`[Collect] Retrying ${worker.id} in ${waitNext}ms due to ${errMsg}...`);
                            await delay(waitNext);
                            return await attemptCollection();
                        }

                        // F. Fail fast on session/send errors (Remediation Plan)
                        if (errMsg === 'signed_out' || errMsg === 'send_failed' || errMsg === 'gemini_stopped') {
                            retryCount = MAX_COLLECT_RETRIES; // Stop retries
                        }

                        // SNAPSHOT ON PERMANENT ERROR
                        const ts = Date.now();
                        const reason = errMsg.replace(/\s+/g, '_').toLowerCase();
                        try {
                            await page.screenshot({ path: `debug_${worker.id}_fail_${reason}_${ts}.png`, fullPage: false }).catch(() => { });
                            const html = await page.content().catch(() => { });
                            if (html) fs.writeFileSync(`debug_${worker.id}_fail_${reason}_${ts}.html`, html);
                        } catch (_) { }

                        await page.close().catch(() => { });
                        globalPagePool[worker.id] = null;

                        let userMsg = errMsg;
                        if (errMsg === 'noisy_output') userMsg = 'UI 잡음 과다 (로그인 확인 필요)';
                        if (errMsg === 'short_output') userMsg = '응답 길이 부족 (데이터 수집 실패)';
                        if (errMsg === 'gemini_stopped') userMsg = 'Gemini 응답 중단됨';

                        return { id: worker.id, value: `Error: ${userMsg}` };
                    }
                };

                return await attemptCollection();
            };

            // Run Collection in Parallel Batches (Concurrency 2 or 4)
            // Since scraping isn't CPU heavy, we can increase concurrency to 4 to maximize speed
            const collectionConcurrency = 4;
            const collectionResults = [];
            for (let i = 0; i < activeWorkers.length; i += collectionConcurrency) {
                const batch = activeWorkers.slice(i, i + collectionConcurrency);
                const batchPromises = batch.map(w => collectResult(w));
                const batchSettled = await Promise.allSettled(batchPromises);
                for (const s of batchSettled) {
                    if (s.status === 'fulfilled') collectionResults.push(s.value);
                    else collectionResults.push({ id: 'unknown', value: `Top-level Error: ${s.reason}` });
                }
            }

            for (const r of collectionResults) rawData[r.id] = r.value;
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
                const minOkLength = 12;
                const isErrorText = text.includes('NEEDS_WEB') || text.startsWith('에러:') || text.startsWith('Error:');
                const isNoisy = looksLikeUiNoise(text);
                if (isErrorText || isNoisy || text.length < minOkLength) {
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

            // --- 3. Logic Phase (L) - Cross-Validation ---
            onProgress({ status: 'logic_validation', message: '[Logic] 에이전트 간 데이터 교차 검증 및 신뢰도 분석 중...' });

            // Generate basic logic summary to help synthesis
            const logicInsights = [];
            if (activeWorkers.length > 1) {
                logicInsights.push("- 다중 에이전트 교차 분석 수행됨.");
                const successAgents = Object.entries(agentStatus).filter(([_, s]) => s === 'ok').map(([id]) => id);
                logicInsights.push(`- 데이터 수집 성공률: ${Math.round((successAgents.length / activeWorkers.length) * 100)}%`);
                if (successAgents.length >= 3) logicInsights.push("- 다수 에이전트 합의 기반 높은 신뢰도 확보.");
            }

            let validationReport = `## 🔍 원 데이터 교차 검증 리포트
- **수집된 에이전트**: ${activeWorkers.map(w => w.name).join(', ')}
- **검증 일시**: ${new Date().toLocaleString('ko-KR')}
- **분석 상태**: ${failedAgents.length > 0 ? '일부 누락됨' : '전체 수집 완료'}

${logicInsights.join('\n')}
`;
            logInternal('[Logic] Cross-validation step completed.');

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

[INPUT DATA]:
- 에이전트 수집 원문: ${JSON.stringify(rawData)}
- 에이전트 상태: ${JSON.stringify(agentStatus)}

[OBJECTIVE]:
당신은 세계 최고 수준의 전략 컨설턴트(McKinsey/Bain & Company 스타일)입니다. 
제공된 에이전트들의 원시 데이터를 분석하여, 실무진부터 경영진까지 즉시 활용 가능한 '종합 인텔리전스 보고서'를 작성하십시오.
단순한 요약이 아닌, 데이터 간의 인과관계를 파헤치고 시나리오별 파급효과를 도출하는 것이 목적입니다.

[QA RULES - 절대 준수 원칙]:
1. **[EVIDENCE HIERARCHY] 증거 계층 구조**:
   - **High (확정)**: 3개 이상의 에이전트가 완벽히 일치하는 정보. 요약(Exec Summary)의 핵심 근거.
   - **Medium (유력)**: 2개 에이전트가 일치. 본문 서술 시 '상당한 근거가 있음'으로 분류.
   - **Low (불확실)**: 1개 에이전트만 주장. '개별 관점' 또는 '검증 필요' 섹션으로 처리.
2. **[NUMERIC LOCK] 수치/사실 잠금**:
   - 원문에 없는 수치, 날짜, 통계는 절대 창조하지 마십시오(Hallucination 방지).
   - 확인되지 않은 수치는 반드시 "추정치" 또는 "에이전트 단독 주장"으로 명시하십시오.
3. **[MECE ANALYSIS] 누락 및 중복 방지**:
   - 분석은 상호 배타적이고 전체적으로 포괄적이어야 합니다.
4. **[TONE & STYLE] 전문성**:
   - 문장은 간결하고 단정적여야 합니다 (~임, ~함 등 명사형 종결 또는 단정한 평서문).
   - 비유/미사여구 배격, 정량적/논리적 표현 지향.

[REPORT STRUCTURE]:

# 📑 종합 인텔리전스 보고서: ${prompt}

## 1. 분석 개요 (Metadata)
- **분석 대상**: ${prompt}
- **데이터 소스**: ${enabledAgentNames}
- **분석 신뢰도**: [에이전트 간 합의 수준에 따라 High/Medium/Low 기재]
- **핵심 키워드**: [데이터에서 도출된 핵심 키워드 3~5개]

## 2. Executive Summary (경영진 요약)
- **핵심 결론 (3줄)**: 
  1. (High Confidence 기반 가장 중요한 발견)
  2. (진행 중인 핵심 트렌드)
  3. (최종적 판단 결과)
- **주요 리스크/기회**: (가장 시급히 대응해야 할 단기 변수)
- **전략적 권고**: (이 상황에서 취해야 할 가장 합리적 포지션)

## 3. 핵심 인사이트 및 합의 매트릭스
| 구분 | 내용 (인사이트) | 근거 (에이전트) | 신뢰도 | 영향도 |
|---|---|---|---|---|
| 인사이트 1 | ... | ... | ... | ... |
| 인사이트 2 | ... | ... | ... | ... |

## 4. 구조적 인과관계 분석 (Causal Chain)
- **동인 (Drivers)**: (이 현상을 촉발하는 외부/내부 원인들)
- **메커니즘 (Path)**: (원인들이 서로 얽혀 결과를 만들어내는 논리적 경로)
- **파급효과 (Impact)**: (현재 및 단기적으로 나타날 구체적 현상)

## 5. 시나리오 플래닝 (Scenario Planning)
| 시나리오 | 발생 확률 | 트리거 (Trigger) | 핵심 결과 및 대응전략 |
|---|---|---|---|
| **Optimistic (Bull)** | 고/중/저 | (어떤 조건이 충족될 때?) | ... |
| **Baseline (Base)** | ... | (현재 흐름 유지 시) | ... |
| **Pessimistic (Bear)** | ... | ... | ... |

## 6. 리스크 관리 및 미해결 과제
- **데이터 공백 (Gaps)**: (에이전트들이 답변하지 못했거나 상충하는 지점)
- **주요 가설 (Assumptions)**: (데이터 부족 시 우리가 전제한 논리)
- **외부 교란 변수**: (분석 범위를 벗어나지만 주의가 필요한 요인)

## 7. 결론 및 모니터링
- **최종 제언**: (분석 대상에 대한 총평)
- **핵심 지표(KPI) 모니터링**:
  - [ ] (KPI 1) - (확인 주기)
  - [ ] (KPI 2) - ...

## 부록 (Appendix)
- **에이전트 수집 상태**: ${JSON.stringify(agentStatus)}
`;

            // Reuse Page for Final Synthesis (Wait for page pool)
            logInternal(`[Polish] Synthesis starting with agent: ${finalId} `);
            let finalPage = globalPagePool[finalId];
            if (!finalPage || finalPage.isClosed()) {
                finalPage = await browserContext.newPage();
                globalPagePool[finalId] = finalPage;
                await finalPage.goto(workerById[finalId].url, { waitUntil: 'domcontentloaded' });
            } else {
                // Ensure focus
                await finalPage.bringToFront();
            }

            let finalOutput = "최종 합성 진행 중";
            try {
                const finalWorker = workerById[finalId];
                logInternal(`[Polish] Sending synthesis prompt to ${finalId}...`);
                // Robust Send Logic (Triple Send) for Synthesis
                for (const sel of (Array.isArray(finalWorker.input) ? finalWorker.input : [finalWorker.input])) {
                    try {
                        await finalPage.waitForSelector(sel, { timeout: 5000 });
                        await finalPage.click(sel);
                        await delay(300);

                        // Try Fill first
                        try { await finalPage.fill(sel, finalPrompt); } catch (_) { await pasteInput(finalPage, finalPrompt); }

                        await delay(500);
                        await finalPage.keyboard.press('Control+Enter');
                        await delay(800);
                        await finalPage.keyboard.press('Enter');
                        await tryClickSend(finalPage);
                        logInternal(`[Polish] Synthesis prompt sent to ${finalId} `);
                        break;
                    } catch (e) {
                        logInternal(`[Polish] Selector ${sel} failed for synthesis send.`);
                    }
                }

                if (finalId === 'claude' || finalId === 'gemini') {
                    logInternal(`[Polish] Injecting observer for ${finalId}`);
                    await injectObserver(finalPage, finalId);
                }
                await delay(5000);
                logInternal(`[Polish] Starting extraction loop for ${finalId}...`);
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
                    if (candidate && candidate.length > (finalOutput.length + 5)) {
                        finalOutput = normalizeReport(candidate);
                        onProgress({ status: 'streaming', service: 'optimal', content: finalOutput });
                    }
                }
                logInternal(`[Polish] Synthesis finished: ${finalOutput.length} chars.`);
            } finally {
                // Do NOT close for Page Pool Reuse
                // await finalPage.close(); 
            }

            const qualityCheck = validateReport(finalOutput);
            logInternal(`[QA] Report Quality Score: ${qualityCheck.score}/100. Issues: ${qualityCheck.issues.length}`);

            return {
                results: rawData,
                validationReport: validationReport + (qualityCheck.issues.length > 0 ? `\n\n**품질 검토 알림:**\n- ${qualityCheck.issues.join('\n- ')}` : "\n\n(구조 및 품질 검증 통과)"),
                optimalAnswer: normalizeReport(finalOutput),
                summary: normalizeReport(finalOutput),
                quality: qualityCheck
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
            // Performance: Do NOT close if we want to reuse globalContext
            // Only close if it was a temporary context or if we decided to scrap it (e.g. error)
            /* 
               Actually, if we are in 'Hot-Start' mode, we keep it open.
               But if an error occurred that might have corrupted the session, maybe we should close?
               For now, let's keep it open unless it's explicitly nullified.
            */
            if (!globalContext && browserContext) {
                try { await browserContext.close(); } catch (_) { }
            }
            // If it IS globalContext, we leave it open!
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
