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
 * Robust Loop-based Wait Function for Playwright with Real-time Chunking
 */
async function waitForResponseStability(page, selectors, onChunk, minLength = 20, maxWait = 90000) {
    let stableCount = 6;
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

            if (payload.length > 0 && payload.length !== lastLength) {
                onChunk(payload.text);
                lastLength = payload.length;
                stableCount = 6;
            } else if (payload.length > minLength && payload.length === lastLength) {
                stableCount--;
            }

            if (stableCount <= 0 && payload.length > minLength) return payload.text;
        } catch (e) {
            // Ignore eval errors
        }
        await delay(500);
    }
    return "Response capture timeout.";
}

export async function runExhaustiveAnalysis(prompt, onProgress) {
    let browserContext;
    try {
        onProgress({ status: 'system_init', message: '에이전시 병렬 프로세스 최적화 중...' });

        browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
            channel: 'msedge',
            headless: false,
            viewport: null,
            ignoreDefaultArgs: ['--enable-automation'],
            args: ['--start-maximized', '--no-sandbox', '--disable-blink-features=AutomationControlled'],
            slowMo: 20
        });

        const tasks = [
            { name: 'Perplexity', fn: runPerplexity },
            { name: 'ChatGPT', fn: runChatGPT },
            { name: 'Gemini', fn: runGemini },
            { name: 'Claude', fn: runClaude }
        ];

        onProgress({ status: 'step1_gathering', message: '4개 AI 에이전트 동시 분석 시작...' });

        const initialResultsRaw = await Promise.all(tasks.map(async (task) => {
            try {
                const text = await task.fn(browserContext, prompt, (chunk) => {
                    onProgress({
                        status: 'streaming',
                        service: task.name.toLowerCase(),
                        content: chunk
                    });
                });
                onProgress({ status: `${task.name.toLowerCase()}_done`, message: `${task.name} 완료` });
                return { name: task.name, text };
            } catch (error) {
                return { name: task.name, text: `Error: ${error.message}` };
            }
        }));

        const resultsMap = {};
        initialResultsRaw.forEach(r => resultsMap[r.name.toLowerCase()] = r.text);

        onProgress({ status: 'step2_validation', message: '상호 교차 검증 생성 중...' });
        const combinedInitial = initialResultsRaw.map(r => `[${r.name}]: ${r.text}`).join('\n\n');

        let validationReview = await runClaude(browserContext, `분석해줘:\n${combinedInitial}`, (chunk) => {
            onProgress({ status: 'streaming', service: 'validation', content: chunk });
        }).catch(() => "Claude 검증 실패");

        onProgress({ status: 'step3_synthesis', message: '최종 인텔리전스 도출 중...' });
        const optimalAnswer = await runPerplexity(browserContext, `요약해줘:\n${combinedInitial}\n\n보고서:\n${validationReview}`, (chunk) => {
            onProgress({ status: 'streaming', service: 'optimal', content: chunk });
        }).catch(() => "최종 요약 실패");

        return {
            results: resultsMap,
            validationReport: validationReview,
            optimalAnswer: optimalAnswer,
            summary: optimalAnswer
        };

    } finally {
        if (browserContext) {
            await delay(2000);
            await browserContext.close();
        }
    }
}

async function runPerplexity(context, prompt, onChunk) {
    const page = await context.newPage();
    try {
        await page.goto('https://www.perplexity.ai/', { waitUntil: 'domcontentloaded' });
        const inputSelector = 'textarea';
        await page.waitForSelector(inputSelector);
        await page.fill(inputSelector, prompt);
        await page.keyboard.press('Enter');
        return await waitForResponseStability(page, ['.prose'], onChunk);
    } finally { await page.close(); }
}

async function runChatGPT(context, prompt, onChunk) {
    const page = await context.newPage();
    try {
        await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
        const inputSelector = '#prompt-textarea';
        await page.waitForSelector(inputSelector);
        await page.fill(inputSelector, prompt);
        await page.keyboard.press('Enter');
        return await waitForResponseStability(page, ['.markdown', 'article'], onChunk);
    } finally { await page.close(); }
}

async function runGemini(context, prompt, onChunk) {
    const page = await context.newPage();
    try {
        await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
        const inputSelector = 'div[contenteditable="true"]';
        await page.waitForSelector(inputSelector);
        await page.click(inputSelector);
        await page.keyboard.type(prompt);
        await page.keyboard.press('Enter');
        await delay(2000);
        return await waitForResponseStability(page, ['model-response'], onChunk);
    } finally { await page.close(); }
}

async function runClaude(context, prompt, onChunk) {
    const page = await context.newPage();
    try {
        await page.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded' });
        const inputSelector = 'div[contenteditable="true"]';
        await page.waitForSelector(inputSelector);
        await page.click(inputSelector);
        await page.keyboard.type(prompt);
        await page.keyboard.press('Enter');
        await delay(2000);
        return await waitForResponseStability(page, ['.font-claude-message'], onChunk);
    } finally { await page.close(); }
}

export async function saveToNotion(prompt, optimalAnswer, results) {
    // Legacy support or Browser-based Notion Save (User's preferred method from Phase 11)
    let browserContext;
    try {
        browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, { headless: false, channel: 'msedge' });
        const page = await browserContext.newPage();
        await page.goto("https://www.notion.so/", { waitUntil: 'networkidle' });
        await page.keyboard.down('Control'); await page.keyboard.press('n'); await page.keyboard.up('Control');
        await delay(2000);
        await page.keyboard.type(`[AI분석] ${prompt.substring(0, 30)}`);
        await page.keyboard.press('Enter');
        let md = `## Result\n\n${optimalAnswer}`;
        await page.evaluate((t) => {
            const el = document.createElement('textarea'); el.value = t; document.body.appendChild(el);
            el.select(); document.execCommand('copy'); document.body.removeChild(el);
        }, md);
        await page.keyboard.down('Control'); await page.keyboard.press('v'); await page.keyboard.up('Control');
        await delay(3000);
        return { success: true, url: page.url() };
    } finally { if (browserContext) await browserContext.close(); }
}
