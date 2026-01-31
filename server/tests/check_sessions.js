
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import { fileURLToPath } from 'url';

chromium.use(StealthPlugin());

const USER_DATA_DIR = path.join(process.cwd(), 'user_data');

async function checkSessions() {
    console.log('[SESSION_CHECK] Starting session check...');

    const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false,
        // No channel -> Bundled Chromium
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

    const services = [
        { id: 'chatgpt', url: 'https://chat.openai.com' },
        { id: 'claude', url: 'https://claude.ai/new' },
        { id: 'gemini', url: 'https://gemini.google.com/app' },
        { id: 'perplexity', url: 'https://www.perplexity.ai' }
    ];

    const results = {};

    await Promise.all(services.map(async (svc) => {
        const page = await browser.newPage();
        try {
            console.log(`[${svc.id}] Checking...`);
            await page.goto(svc.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(3000); // Wait for potential redirects

            let isSignedOut = false;
            const bodyText = await page.evaluate(() => document.body.innerText);

            if (svc.id === 'gemini') {
                isSignedOut = bodyText.includes('Sign in to Gemini') ||
                    bodyText.includes('Sign in Gemini') ||
                    bodyText.includes('Conversation with Gemini') ||
                    (bodyText.includes('Sign in') && bodyText.includes('Google'));
            } else if (svc.id === 'claude') {
                isSignedOut = bodyText.includes('Sign in to Claude') || bodyText.includes('Welcome back');
            } else if (svc.id === 'chatgpt') {
                isSignedOut = bodyText.includes('Get started') && bodyText.includes('Log in');
            } else if (svc.id === 'perplexity') {
                // Perplexity works without login usually, but check for sign up prompt
                isSignedOut = false; // Lenient
            }

            if (page.url().includes('auth') || page.url().includes('login') || page.url().includes('signin')) {
                isSignedOut = true;
            }

            results[svc.id] = isSignedOut ? 'LOGOUT ❌' : 'LOGIN OK ✅';
            console.log(`[${svc.id}] Result: ${results[svc.id]}`);

        } catch (e) {
            results[svc.id] = `ERROR: ${e.message}`;
        } finally {
            await page.close();
        }
    }));

    console.table(results);
    await browser.close();
}

checkSessions();
