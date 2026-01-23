import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import { fileURLToPath } from 'url';

chromium.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USER_DATA_DIR = path.join(__dirname, 'user_data_session');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Robust Loop-based Wait Function for Playwright
 */
async function waitForResponseStability(page, selectors, minLength = 20, stabilityDuration = 3000, maxWait = 90000) {
    let stableCount = 6; // 6 * 500ms = 3s
    let lastLength = 0;
    const startTime = Date.now();
    const selectorArr = Array.isArray(selectors) ? selectors : [selectors];

    while (Date.now() - startTime < maxWait) {
        try {
            const payload = await page.evaluate((sels) => {
                let bestText = "";
                let maxLength = 0;
                for (const sel of sels) {
                    const els = document.querySelectorAll(sel);
                    if (els.length > 0) {
                        const text = els[els.length - 1].innerText.trim();
                        if (text.length > maxLength) {
                            maxLength = text.length;
                            bestText = text;
                        }
                    }
                }
                return { length: maxLength, text: bestText };
            }, selectorArr);

            if (payload.length > minLength) {
                if (payload.length === lastLength && payload.length > 0) {
                    stableCount--;
                } else {
                    stableCount = 6;
                    lastLength = payload.length;
                }
            }

            if (stableCount <= 0) return payload.text;
        } catch (e) {
            // Ignore temporary evaluation errors during navigation/re-rendering
        }
        await delay(500);
    }

    console.log(`[Playwright Wait] Stability timeout for: ${selectorArr.join(', ')}`);
    return "Response capture timeout or insufficient length.";
}

export async function runExhaustiveAnalysis(prompt, onProgress) {
    let browserContext;
    try {
        onProgress({ status: 'system_init', message: '브라우저 엔진 최적화 및 에이전시 세션 활성화 중...' });

        browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
            channel: 'msedge',
            headless: false,
            viewport: null,
            ignoreDefaultArgs: ['--enable-automation'],
            args: [
                '--start-maximized',
                '--no-sandbox',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled'
            ],
            slowMo: 30
        });

        // Step 1: Parallel Gathering
        onProgress({ status: 'step1_gathering', message: '4대 AI 에이전트에게 동시 질문을 전송했습니다 (병렬 모드)...' });

        const tasks = [
            { name: 'Perplexity', fn: runPerplexity },
            { name: 'ChatGPT', fn: runChatGPT },
            { name: 'Gemini', fn: runGemini },
            { name: 'Claude', fn: runClaude }
        ];

        const initialResultsRaw = await Promise.all(tasks.map(async (task) => {
            try {
                onProgress({ status: `${task.name.toLowerCase()}_start`, message: `${task.name} 에이전트가 분석을 시작했습니다.` });
                const text = await task.fn(browserContext, prompt);
                onProgress({ status: `${task.name.toLowerCase()}_done`, message: `${task.name} 답변 수집 완료!` });
                return { name: task.name, text };
            } catch (error) {
                onProgress({ status: `${task.name.toLowerCase()}_error`, message: `${task.name} 오류 발생: ${error.message}` });
                return { name: task.name, text: `Failed to fetch: ${error.message}` };
            }
        }));

        const resultsMap = {};
        initialResultsRaw.forEach(r => resultsMap[r.name.toLowerCase()] = r.text);

        // Step 2: Cross-Validation (Claude preferred for reasoning)
        onProgress({ status: 'step2_validation', message: '수집된 데이터를 바탕으로 상호 교차 검증을 시작합니다...' });

        const combinedInitial = initialResultsRaw.map(r => `[${r.name}]: ${r.text}`).join('\n\n');
        const validationPrompt = `
        당신은 전문 분석가입니다. 아래는 동일한 질문("${prompt}")에 대해 4개의 AI가 내놓은 답변들입니다.
        각 답변의 정확성, 논리성, 최신성을 객관적으로 평가하고 서로 보완해야 할 점을 분석해주세요.
        
        ${combinedInitial}
        `.substring(0, 15000);

        let validationReview = await runClaude(browserContext, validationPrompt).catch(() => null);

        if (!validationReview || validationReview.length < 100) {
            onProgress({ status: 'validating_fallback', message: '검증 리포트 보강 중 (Perplexity 에이전트 투입)...' });
            validationReview = await runPerplexity(browserContext, validationPrompt).catch(() => "상호 검증 리포트를 생성할 수 없습니다.");
        }

        // Step 3: Final Synthesis
        onProgress({ status: 'step3_synthesis', message: '최종 인텔리전스 리포트를 구성하고 있습니다...' });

        const synthesisPrompt = `
        질문: "${prompt}"
        당신은 4개의 AI의 답변을 분석하여 최고의 통찰을 제공하는 Senior AI Agent입니다.
        구조화된 마크다운으로 답변해주세요.
        
        초기 답변들:
        ${combinedInitial}
        
        상호 검증 내용:
        ${validationReview}
        `.substring(0, 15000);

        const optimalAnswer = await runPerplexity(browserContext, synthesisPrompt, 120000).catch(() => "최종 답변 도출 실패");

        return {
            results: resultsMap,
            validationReport: validationReview,
            optimalAnswer: optimalAnswer,
            heroImage: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&q=80&w=1000"
        };

    } finally {
        if (browserContext) {
            // Give a small delay before closing to ensure all packets are sent
            await delay(1000);
            await browserContext.close();
        }
    }
}

async function runPerplexity(context, prompt, maxWait = 90000) {
    const page = await context.newPage();
    try {
        await page.goto('https://www.perplexity.ai/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        const inputSelector = 'textarea, [contenteditable="true"]';
        await page.waitForSelector(inputSelector, { timeout: 20000 });
        await page.fill(inputSelector, prompt);
        await delay(300);
        await page.keyboard.press('Enter');
        return await waitForResponseStability(page, ['.prose', '[class*="prose"]', '.default-article'], 50, 3000, maxWait);
    } finally { await page.close(); }
}

async function runChatGPT(context, prompt) {
    const page = await context.newPage();
    try {
        await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        const inputSelector = '#prompt-textarea';
        await page.waitForSelector(inputSelector, { timeout: 20000 });
        await page.fill(inputSelector, prompt);
        await delay(300);
        await page.keyboard.press('Enter');
        return await waitForResponseStability(page, ['.markdown', 'article', '.prose'], 50);
    } finally { await page.close(); }
}

async function runGemini(context, prompt) {
    const page = await context.newPage();
    try {
        await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 60000 });
        const inputSelector = 'div[contenteditable="true"], [aria-label="채팅 입력"], [aria-label="Prompt"]';
        await page.waitForSelector(inputSelector, { timeout: 25000 });
        await page.click(inputSelector);
        await page.keyboard.type(prompt, { delay: 5 });
        await delay(300);
        await page.keyboard.press('Enter');
        await delay(3000); // Wait for Gemini to start thinking
        return await waitForResponseStability(page, ['model-response', '.message-content', '.chat-content', '.response-container-inner'], 50);
    } finally { await page.close(); }
}

async function runClaude(context, prompt) {
    const page = await context.newPage();
    try {
        await page.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
        const inputSelector = 'div[contenteditable="true"], [aria-label="Write user message"], .ProseMirror';
        await page.waitForSelector(inputSelector, { timeout: 25000 });
        await page.click(inputSelector);
        await page.keyboard.type(prompt, { delay: 5 });
        await delay(300);

        const sendBtn = await page.$('button[aria-label="Send Message"], button[aria-label="Send message"]');
        if (sendBtn && await sendBtn.isEnabled()) {
            await sendBtn.click();
        } else {
            await page.keyboard.press('Enter');
        }
        await delay(4000);
        return await waitForResponseStability(page, ['.font-claude-message', '[data-testid="message-content"]', '.message-content'], 50);
    } finally { await page.close(); }
}

export async function saveToNotion(prompt, optimalAnswer, results) {
    let browserContext;
    try {
        browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, { headless: false, channel: 'msedge' });
        const page = await browserContext.newPage();
        await page.goto("https://www.notion.so/", { waitUntil: 'networkidle' });
        await page.waitForSelector('.notion-sidebar-container', { timeout: 40000 });

        await page.keyboard.down('Control');
        await page.keyboard.press('n');
        await page.keyboard.up('Control');
        await delay(2500);

        await page.keyboard.type(`[AI분석] ${prompt.substring(0, 50)}...`);
        await page.keyboard.press('Enter');
        await delay(1500);

        let markdown = `# AI Search Agency Analysis Report\n\n`;
        markdown += `## 💡 Original Prompt\n> ${prompt}\n\n---\n\n`;
        markdown += `## 🏆 Integrated Intelligence Result\n\n${optimalAnswer}\n\n---\n\n`;
        markdown += `## 🔍 Individual AI Agent Data\n\n`;
        for (const [ai, text] of Object.entries(results)) {
            markdown += `### ${ai.toUpperCase()}\n${text}\n\n`;
        }

        await page.evaluate((text) => {
            const el = document.createElement('textarea');
            el.value = text;
            document.body.appendChild(el); el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
        }, markdown);

        await page.keyboard.down('Control');
        await page.keyboard.press('v');
        await page.keyboard.up('Control');

        await delay(4000);
        return { success: true, url: page.url() };
    } finally {
        if (browserContext) await browserContext.close();
    }
}
