import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

chromium.use(StealthPlugin());
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USER_DATA_DIR = path.join(__dirname, 'user_data_session_chromium');

async function debugGPT() {
    const browser = await chromium.launch({ headless: true });
    // Use the same storageState as the main app
    const storageStatePath = path.join(USER_DATA_DIR, 'storageState.json');
    const contextOptions = { viewport: { width: 1280, height: 800 } };
    if (fs.existsSync(storageStatePath)) {
        contextOptions.storageState = storageStatePath;
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    console.log("Navigating to ChatGPT...");
    await page.goto('https://chatgpt.com/', { waitUntil: 'networkidle' });

    await page.screenshot({ path: 'chatgpt_initial.png' });

    const inputSelector = '#prompt-textarea';
    try {
        console.log("Waiting for input selector...");
        await page.waitForSelector(inputSelector, { timeout: 10000 });
        console.log("Input found. Filling prompt...");
        await page.fill(inputSelector, "작동 테스트 중입니다. '확인'이라고 답해주세요.");
        await page.keyboard.press('Enter');

        console.log("Prompt sent. Waiting for response...");
        await page.waitForTimeout(5000);
        await page.screenshot({ path: 'chatgpt_after_send.png' });

        const response = await page.evaluate(() => {
            const el = document.querySelector('.markdown') || document.querySelector('article');
            return el ? el.innerText : 'NOT FOUND';
        });

        console.log("Scraped Response:", response);

        const bodyText = await page.evaluate(() => document.body.innerText);
        if (bodyText.includes('Sign in') || bodyText.includes('Log in')) {
            console.log("DETECTED: Signed out state.");
        }

    } catch (e) {
        console.error("Error during debug:", e.message);
        await page.screenshot({ path: 'chatgpt_error.png' });
    } finally {
        await browser.close();
    }
}

debugGPT();
