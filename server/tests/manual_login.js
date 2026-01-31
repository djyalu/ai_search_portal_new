
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';

chromium.use(StealthPlugin());

const USER_DATA_DIR = path.join(process.cwd(), 'user_data');

(async () => {
    console.log('[MANUAL_LOGIN] Opening browser for manual login...');
    console.log('Please log in to Gemini and then close the browser window when done.');

    const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false,
        // No channel -> Use Bundled Chromium
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--window-size=1920,1080',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        ],
        viewport: { width: 1920, height: 1080 }
    });

    const page = await browser.newPage();
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });

    // Keep open until user closes it
    browser.on('close', () => {
        console.log('[MANUAL_LOGIN] Browser closed. Session saved.');
        process.exit(0);
    });
})();
