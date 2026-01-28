import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

chromium.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Env-driven browser configuration
const BROWSER_CHANNEL = process.env.BROWSER_CHANNEL || 'chromium'; // chromium | msedge | chrome
const BROWSER_HEADLESS = process.env.BROWSER_HEADLESS ? process.env.BROWSER_HEADLESS === 'true' : false;
const BROWSER_SLOWMO = process.env.BROWSER_SLOWMO ? parseInt(process.env.BROWSER_SLOWMO, 10) : 40;
const USER_DATA_BASE = process.env.USER_DATA_BASE || 'user_data_session';
const USER_DATA_DIR = path.join(__dirname, `${USER_DATA_BASE}_${BROWSER_CHANNEL}`);

async function setupAuth() {
    console.log('🚀 AI 서비스 통합 로그인을 시작합니다...');

    let context;
    try {
        const launchOptions = {
            headless: BROWSER_HEADLESS,
            viewport: null,
            ignoreDefaultArgs: ['--enable-automation'],
            args: [
                '--start-maximized',
                '--no-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ],
            slowMo: BROWSER_SLOWMO
        };

        if (BROWSER_CHANNEL !== 'chromium') launchOptions.channel = BROWSER_CHANNEL;

        console.log(`Launching browser for auth: channel=${BROWSER_CHANNEL}, headless=${BROWSER_HEADLESS}, userData=${USER_DATA_DIR}`);
        context = await chromium.launchPersistentContext(USER_DATA_DIR, launchOptions);

        const pagesToOpen = [
            { name: 'Perplexity', url: 'https://www.perplexity.ai/' },
            { name: 'ChatGPT', url: 'https://chatgpt.com/' },
            { name: 'Gemini', url: 'https://gemini.google.com/app' },
            { name: 'Claude', url: 'https://claude.ai/new' }
        ];

        // 탭 열기
        for (let i = 0; i < pagesToOpen.length; i++) {
            const site = pagesToOpen[i];
            try {
                const page = (i === 0 && context.pages().length > 0)
                    ? context.pages()[0]
                    : await context.newPage();

                console.log(`[${site.name}] 오픈 중...`);
                await page.goto(site.url).catch(() => { });
            } catch (err) {
                console.log(`[${site.name}] 건너뜀 (이미 열려있거나 오류)`);
            }
        }

        console.log('\n--- 로그인 안내 ---');
        console.log('1. 각 탭에서 로그인을 완료하세요.');
        console.log('2. 브라우저는 닫지 말고 이 터미널에서 Enter를 눌러 저장하세요.');

        const storageStatePath = path.join(USER_DATA_DIR, 'storageState.json');
        let storageSaved = false;
        let contextClosed = false;
        const saveStorageState = async (source = '') => {
            if (storageSaved) return;
            try {
                await context.storageState({ path: storageStatePath });
                storageSaved = true;
                const suffix = source ? ` (${source})` : '';
                console.log('OK: storageState saved to', storageStatePath + suffix);
            } catch (e) {
                console.error('Failed to save storageState:', e.message || e);
            }
        };
        context.on('close', async () => {
            contextClosed = true;
            await saveStorageState('on-close');
        });
        console.log('Note: do not close the browser window; press Enter here to save.');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        await new Promise((resolve) => {
            rl.question('\nPress Enter after completing all logins to save and close...\n', () => {
                rl.close();
                resolve();
            });
        });

        if (contextClosed) {
            if (storageSaved) {
                console.log('OK: storageState already saved on close.');
                return;
            }
            console.error('Browser was closed before saving. Please rerun and press Enter without closing the browser.');
            return;
        }
        await saveStorageState('manual');

        await context.close();
        console.log('OK: session saved and browser closed.');
        return;

        await new Promise((resolve) => {
            context.on('close', async () => {
                try {
                    await context.storageState({ path: storageStatePath });
                    console.log('✅ storageState saved to', storageStatePath);
                } catch (e) {
                    console.error('Failed to save storageState:', e.message || e);
                }
                resolve();
            });
        });

        console.log('✅ 세션 저장 완료!');

    } catch (error) {
        console.error('❌ 실행 에러:', error.message);
        console.log('팁: 수동으로 연 모든 Edge 브라우저를 닫고 다시 시도해 보세요.');
    }
}

setupAuth();
