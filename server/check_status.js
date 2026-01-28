import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import { fileURLToPath } from 'url';

chromium.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USER_DATA_DIR = path.join(__dirname, 'user_data_session');

async function checkSite(url, name) {
    console.log(`Checking ${name}: ${url}`);
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        channel: 'msedge',
        headless: true, // Use headless for checking status
        args: ['--no-sandbox']
    });
    const page = await context.newPage();
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 5000));
        await page.screenshot({ path: `check-${name}.png`, fullPage: true });
        const html = await page.content();
        console.log(`Page title: ${await page.title()}`);
        console.log(`HTML length: ${html.length}`);
    } catch (err) {
        console.error(`Error checking ${name}: ${err.message}`);
    } finally {
        await context.close();
    }
}

async function run() {
    await checkSite('https://www.perplexity.ai/', 'perplexity');
    await checkSite('https://chatgpt.com/', 'chatgpt');
}

run();
