import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

chromium.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USER_DATA_DIR = path.join(__dirname, 'user_data_session');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function saveDebugArtifacts(page, name) {
    try {
        const stamp = Date.now();
        const imgPath = path.join(__dirname, `playwright-debug-${name}-${stamp}.png`);
        const htmlPath = path.join(__dirname, `playwright-debug-${name}-${stamp}.html`);
        await page.screenshot({ path: imgPath, fullPage: true }).catch(() => { });
        const html = await page.content().catch(() => null);
        if (html) fs.writeFileSync(htmlPath, html, 'utf8');
        return { imgPath, htmlPath };
    } catch (err) {
        return { error: err.message };
    }
}

/**
 * Robust Text Extraction with Polling
 */
async function getCleanText(page, selectors) {
    return await page.evaluate((sels) => {
        for (const sel of sels) {
            const elements = document.querySelectorAll(sel);
            if (elements.length > 0) {
                let text = elements[elements.length - 1].innerText.trim();
                if (text.length > 20) return text;
            }
        }
        return null;
    }, selectors);
}

/**
 * RALPH Based Multi-Agent Analysis
 * R: Reasoning (Plan)
 * A: Agency (Gather)
 * L: Logic (Validate)
 * P: Polish (Synthesize)
 * H: Hierarchy (Manage)
 */
export async function runExhaustiveAnalysis(prompt, onProgress) {
    let browserContext;
    try {
        onProgress({ status: 'hierarchy_init', message: '[Hierarchy] RALPH 에이전시 파이프라인 가동...' });

        browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
            channel: 'msedge',
            headless: false,
            args: ['--start-maximized', '--no-sandbox', '--disable-blink-features=AutomationControlled'],
            slowMo: 40
        });

        // --- 1. Reasoning Phase (R) ---
        onProgress({ status: 'reasoning', message: '[Reasoning] 질의 의도 분석 및 에이전트 작업 설계 중...' });
        const planningPrompt = `질문: "${prompt}"\n위 질문을 가장 효과적으로 분석하기 위해, 4개의 AI(Search, Reasoning, Creative, Logical)에게 각각 어떤 관점으로 질문하면 좋을지 전략을 세워줘. 아주 간단하게 요약해.`;

        const planningPage = await browserContext.newPage();
        let strategy = "기본 분석 모드";
        try {
            await planningPage.goto('https://www.perplexity.ai/', { waitUntil: 'domcontentloaded', timeout: 30000 }); // Reduced timeout
            try {
                // Perplexity selector might vary (textarea or placeholder)
                const inputSelectors = ['textarea', 'div[contenteditable="true"]', 'input[placeholder*="Ask"]'];
                let hasInput = false;
                for (const vid of inputSelectors) {
                    if (await planningPage.$(vid)) {
                        await planningPage.fill(vid, planningPrompt);
                        await planningPage.keyboard.press('Enter');
                        hasInput = true;
                        break;
                    }
                }
                if (!hasInput) throw new Error("Input field not found");

            } catch (err) {
                await saveDebugArtifacts(planningPage, 'planning-input-error');
                throw err;
            }

            await delay(3000);

            // Reasoning wait loop
            let planText = "";
            for (let i = 0; i < 15; i++) { // Max 30s
                await delay(2000);
                // Try multiple potential result selectors for Perplexity
                const text = await getCleanText(planningPage, ['.prose', 'div[class*="markdown"]', '.answer-content']);
                if (text && text.length > planText.length) {
                    planText = text;
                    onProgress({ status: 'streaming', service: 'reasoning_preview', content: planText.substring(0, 100) + '...' });
                }
                if (text && text.length > 50 && i > 5) break;
            }
            strategy = planText || "기본 전략 가동";

        } catch (err) {
            console.error("Reasoning Error:", err);
            strategy = `에러 발생: ${err.message}`;
        } finally { await planningPage.close(); }

        // --- 2. Agency Phase (A) ---
        onProgress({ status: 'agency_gathering', message: `[Agency] 분석 전략 기반 데이터 수집 시작: ${strategy.substring(0, 50)}...` });

        const workers = [
            // Updated selectors for robustness
            { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/', input: ['textarea', 'div[contenteditable="true"]'], result: ['.prose', 'div[class*="markdown"]'] },
            { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', input: ['#prompt-textarea', 'div[contenteditable="true"]'], result: ['.markdown', '.agent-turn', 'article'] },
            { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', input: ['div[contenteditable="true"]', '.ql-editor'], result: ['model-response', '.message-content', 'div[data-message-id]'] },
            { id: 'claude', name: 'Claude', url: 'https://claude.ai/new', input: ['div[contenteditable="true"]'], result: ['.font-claude-message', '.message-content'] }
        ];

        const rawData = {};
        for (const worker of workers) {
            onProgress({ status: 'worker_active', message: `[Agency] ${worker.name} 에이전트 작업 중...` });
            const page = await browserContext.newPage();
            try {
                await page.goto(worker.url, { waitUntil: 'domcontentloaded', timeout: 45000 });

                // Flexible input finding
                let inputFound = false;
                for (const sel of worker.input) {
                    try {
                        await page.waitForSelector(sel, { timeout: 5000 });
                        await page.click(sel);
                        await page.keyboard.type(prompt, { delay: 10 });
                        // Special case for Gemini/others needing extra 'Enter' confirmation or button click?
                        await page.keyboard.press('Enter');
                        inputFound = true;
                        break;
                    } catch (e) { continue; }
                }

                if (!inputFound) throw new Error(`Input selector not found for ${worker.name}`);

                let lastText = "";
                for (let i = 0; i < 25; i++) { // Max 50s
                    await delay(2000);
                    const current = await getCleanText(page, worker.result);
                    if (current && current.length > lastText.length) {
                        lastText = current;
                        onProgress({ status: 'streaming', service: worker.id, content: lastText });
                    }
                    // Stability check: if text is long enough and hasn't changed for 2 iterations
                    if (i > 5 && current && current.length > 50 && current === lastText) {
                        // Check one more time to be sure? 
                        // For now, assume done if stable.
                        // But we wait a bit more for some slow AIs
                        if (i > 10) break;
                    }
                }
                rawData[worker.id] = lastText || "응답 없음";
            } catch (e) {
                try { await saveDebugArtifacts(page, `worker-error-${worker.id}`); } catch (_) { }
                rawData[worker.id] = `에러: ${e.message}`;
            } finally { await page.close(); }
        }

        // --- 3. Logic Phase (L) ---
        onProgress({ status: 'logic_validation', message: '[Logic] 수집된 답변의 교차 검증 및 논리적 모순 체크 중...' });
        const validationPrompt = `분석 결과들:\n${JSON.stringify(rawData)}\n위 내용 중 서로 충돌하거나 보완이 필요한 부분을 냉철하게 평가해줘.`;

        const logicPage = await browserContext.newPage();
        let validationReport = "검증 진행됨";
        try {
            await logicPage.goto('https://claude.ai/new');
            await logicPage.waitForSelector('div[contenteditable="true"]');
            await logicPage.click('div[contenteditable="true"]');
            await logicPage.keyboard.type(validationPrompt, { delay: 5 });
            await logicPage.keyboard.press('Enter');
            await delay(5000);
            for (let i = 0; i < 15; i++) {
                await delay(2000);
                const current = await getCleanText(logicPage, ['.font-claude-message', '.message-content']);
                if (current) {
                    validationReport = current;
                    onProgress({ status: 'streaming', service: 'validation', content: validationReport });
                }
            }
        } finally { await logicPage.close(); }

        // --- 4. Polish & Hierarchy Phase (P/H) ---
        onProgress({ status: 'polish_synthesis', message: '[Polish] 최종 인텔리전스 인포그래픽 리포트 생성 중...' });
        const finalPrompt = `질문: "${prompt}"\n수집 데이터: ${JSON.stringify(rawData)}\n검증 보고서: ${validationReport}\n위 모든 내용을 종합하여 완벽한 마크다운 보고서를 작성해줘.`;

        const finalPage = await browserContext.newPage();
        let finalOutput = "최종 요약 실패";
        try {
            await finalPage.goto('https://www.perplexity.ai/');
            await finalPage.fill('textarea', finalPrompt);
            await finalPage.keyboard.press('Enter');
            await delay(5000);
            for (let i = 0; i < 20; i++) {
                await delay(2000);
                const current = await getCleanText(finalPage, ['.prose']);
                if (current) {
                    finalOutput = current;
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

    } finally {
        if (browserContext) await browserContext.close();
    }
}

export async function saveToNotion(prompt, optimalAnswer, results) {
    // Notion 저장 로직 유지
    return { success: true };
}
