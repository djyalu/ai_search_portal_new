import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import { fileURLToPath } from 'url';

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USER_DATA_DIR = path.join(__dirname, 'user_data');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Robust Loop-based Wait Function
 * Monitors the text content of candidate selectors. 
 * If the length of the longest response remains constant for `stabilityDuration`,
 * it assumes the response is complete.
 */
async function waitForResponseStability(page, selectors, minLength = 20, stabilityDuration = 3000, maxWait = 90000) {
    let stableCount = 6; // Check count (6 * 500ms = 3 sec)
    let lastLength = 0;
    const startTime = Date.now();
    const selectorArr = Array.isArray(selectors) ? selectors : [selectors];

    while (Date.now() - startTime < maxWait) {
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
            if (payload.length === lastLength) {
                stableCount--;
            } else {
                stableCount = 6;
                lastLength = payload.length;
            }
        }

        if (stableCount <= 0) return payload.text;
        await delay(500);
    }

    console.log(`[Wait] Stability timeout for: ${selectorArr.join(', ')}`);
    return await page.evaluate((sels) => {
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
        return bestText || "No response captured - Timeout";
    }, selectorArr);
}

export async function runExhaustiveAnalysis(prompt, onProgress) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: false,
            userDataDir: USER_DATA_DIR,
            executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
            defaultViewport: null,
            ignoreDefaultArgs: ['--enable-automation'],
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--start-maximized',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--disable-features=IsolateOrigins,site-per-process' // Added for stability
            ]
        });

        // Step 1: Initial Gathering
        onProgress({ status: 'step1_gathering', message: '각 AI로부터 초기 답변을 수집하고 있습니다...' });

        const initialResults = [];

        // Parallel Execution is possible but risky for anti-bot. Sequential is safer for reliability.
        initialResults.push({ name: 'Perplexity', text: await runPerplexity(browser, prompt).catch(e => `Error: ${e.message}`) });
        onProgress({ status: 'perplexity_done', message: 'Perplexity 답변 수집 완료' });

        initialResults.push({ name: 'ChatGPT', text: await runChatGPT(browser, prompt).catch(e => `Error: ${e.message}`) });
        onProgress({ status: 'chatgpt_done', message: 'ChatGPT 답변 수집 완료' });

        initialResults.push({ name: 'Gemini', text: await runGemini(browser, prompt).catch(e => `Error: ${e.message}`) });
        onProgress({ status: 'gemini_done', message: 'Gemini 답변 수집 완료' });

        initialResults.push({ name: 'Claude', text: await runClaude(browser, prompt).catch(e => `Error: ${e.message}`) });
        onProgress({ status: 'claude_done', message: 'Claude 답변 수집 완료' });

        // Step 2: Cross-Validation (Mutual Review)
        onProgress({ status: 'step2_validation', message: 'AI 에이전시 기반 상호 검증을 시작합니다...' });

        const combinedInitial = initialResults.map(r => `[${r.name}]: ${r.text}`).join('\n\n');
        const validationPrompt = `
        당신은 전문 분석가입니다. 아래는 동일한 질문("${prompt}")에 대해 4개의 AI가 내놓은 답변들입니다.
        각 답변의 정확성, 논리성, 최신성을 객관적으로 평가하고 서로 보완해야 할 점을 분석해주세요.
        
        ${combinedInitial}
        `.substring(0, 15000);

        onProgress({ status: 'validating', message: '답변들의 논리적 모순과 누락된 정보를 비교 분석 중...' });

        // Try Claude first for validation
        let validationReview = await runClaude(browser, validationPrompt).catch(() => null);

        if (!validationReview || validationReview.includes("Error") || validationReview.length < 50) {
            onProgress({ status: 'validating_fallback', message: 'Claude 검증 실패, Perplexity로 상호 검증을 시도합니다...' });
            validationReview = await runPerplexity(browser, validationPrompt).catch(() => "상호 검증 리포트를 생성할 수 없습니다.");
        }

        // Step 3: Final Synthesis (Optimal Answer)
        onProgress({ status: 'step3_synthesis', message: '검증 결과를 바탕으로 최적의 최종 답변과 분석 리포트를 도출하고 있습니다...' });

        const synthesisPrompt = `
        질문: "${prompt}"
        
        당신은 4개의 AI(Perplexity, ChatGPT, Gemini, Claude)의 답변을 분석하여 최고의 통찰을 제공하는 Senior AI Agent입니다.
        
        다음 구조로 마크다운 답변을 작성해주세요:
        1. 🤖 **최종 결론 요약**: 가장 정확하고 검증된 답변의 핵심 정보.
        2. 📊 **서비스별 비교 테이블**: [정확도, 응답속도, 정보의 풍부함, 논리적 추론] 항목을 포함한 마크다운 표.
        3. 🔍 **심층 차이점 분석**: 각 AI가 강조한 지점이나 서로 상반된 주장에 대한 분석.
        4. 💡 **종합 통찰 및 제언**: 사용자를 위한 추가적인 인사이트.
        
        초기 답변들:
        ${combinedInitial}
        
        상호 검증 분석 내용:
        ${validationReview}
        `.substring(0, 15000);

        const optimalAnswer = await runPerplexity(browser, synthesisPrompt, 120000).catch(() => "최종 답변 도출 실패");

        return {
            results: {
                perplexity: initialResults[0].text,
                chatgpt: initialResults[1].text,
                gemini: initialResults[2].text,
                claude: initialResults[3].text
            },
            validationReport: validationReview,
            optimalAnswer: optimalAnswer,
            heroImage: "https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&q=80&w=1000"
        };

    } catch (error) {
        console.error("Global Puppeteer Error:", error);
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}

async function runPerplexity(browser, prompt, maxWait = 90000) {
    const page = await browser.newPage();
    try {
        await page.goto('https://www.perplexity.ai/', { waitUntil: 'networkidle2', timeout: 60000 });
        const inputSelector = 'textarea, [contenteditable="true"]';

        // More robust input handling
        try {
            await page.waitForSelector(inputSelector, { timeout: 15000 });
            await page.focus(inputSelector);
            await page.evaluate((p) => {
                const el = document.querySelector('textarea, [contenteditable="true"]');
                if (el.tagName === 'TEXTAREA') el.value = p;
                else el.innerText = p;
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }, prompt);
            await delay(1000);
            await page.keyboard.press('Enter');
        } catch (e) {
            console.error("Perplexity Input Error", e);
            return "Input Failed";
        }

        // Perplexity often uses .prose or just a specific structure
        return await waitForResponseStability(page, ['.prose', '[class*="prose"]', '.default-article'], 50, 3000, maxWait);

    } finally { await page.close(); }
}

async function runChatGPT(browser, prompt) {
    const page = await browser.newPage();
    try {
        await page.goto('https://chatgpt.com/', { waitUntil: 'load', timeout: 60000 });
        const inputSelector = '#prompt-textarea';

        try {
            await page.waitForSelector(inputSelector, { timeout: 15000 });
            await page.focus(inputSelector);
            await page.keyboard.type(prompt.substring(0, 2000)); // Limit length for speed
            if (prompt.length > 2000) {
                await page.evaluate((p) => {
                    const el = document.querySelector('#prompt-textarea');
                    el.innerText += p.substring(2000);
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                }, prompt);
            }
            await delay(500);
            await page.keyboard.press('Enter');
        } catch (e) {
            console.error("ChatGPT Input Error", e);
            return "Input Failed";
        }

        return await waitForResponseStability(page, ['.markdown', 'article', '.prose'], 50);

    } finally { await page.close(); }
}

async function runGemini(browser, prompt) {
    const page = await browser.newPage();
    try {
        await page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2', timeout: 60000 });

        // Gemini often has 'Get started' splash or simple input
        const inputSelector = 'div[contenteditable="true"], .input-area textarea';

        try {
            await page.waitForSelector(inputSelector, { timeout: 15000 });
            await page.focus(inputSelector);
            // Used clipboard or direct type? Direct type is safer for complex RichText editors
            await page.keyboard.type(prompt);
            await delay(1000);
            await page.keyboard.press('Enter');
        } catch (e) {
            console.error("Gemini Input Error", e);
            return "Input Failed";
        }

        // Gemini uses model-response or message-content
        return await waitForResponseStability(page, ['model-response', '.message-content', '.chat-content'], 50);

    } finally { await page.close(); }
}

async function runClaude(browser, prompt) {
    const page = await browser.newPage();
    try {
        await page.goto('https://claude.ai/new', { waitUntil: 'networkidle2', timeout: 60000 });
        const inputSelector = 'div[contenteditable="true"]';

        try {
            await page.waitForSelector(inputSelector, { timeout: 20000 });
            await page.focus(inputSelector);
            await page.keyboard.type(prompt);
            await delay(1000);

            // Check if send button is explicitly needed
            const sent = await page.evaluate(() => {
                const btn = document.querySelector('button[aria-label="Send Message"]');
                if (btn && !btn.disabled) {
                    btn.click();
                    return true;
                }
                return false;
            });
            if (!sent) await page.keyboard.press('Enter');

        } catch (e) {
            console.error("Claude Input Error", e);
            return "Input Failed";
        }

        return await waitForResponseStability(page, ['.font-claude-message', '[data-testid="message-content"]', '.grid-cols-1'], 50);

    } finally { await page.close(); }
}

/**
 * Browser-based Notion Automation
 * Saves the analysis result to Notion by simulating UI interactions.
 */
import NotionService from './notion_service.js';

export async function saveToNotion(prompt, optimalAnswer, results) {
    const resp = await NotionService.saveAnalysis(prompt, optimalAnswer, results);
    return { success: true, url: `https://www.notion.so/${resp.id.replace(/-/g, '')}` };
}
