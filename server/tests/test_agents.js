import { PlaywrightHandler } from '../playwright_handler.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTest() {
    console.log('[TEST] Starting Multi-Agent Input Test...');
    const handler = new PlaywrightHandler(true); // Headless=true for test
    await handler.init();

    const prompt = "2026년 반도체 시장 전망 요약해줘";
    // Mock strategy
    const strategy = "Logic: Search reputable tech news sites. Creative: Summarize key trends.";

    // Test agents independently to isolate issues
    const agents = ['perplexity', 'chatgpt', 'gemini', 'claude'];

    // We can't easily isolate in the current handler structure without modifying it to accept a specific agent list
    // But the updated handler iterates through enabledAgents.
    // Let's rely on the logs printed by handler.

    // We will simulate a call that index.js usually makes
    // But PlaywrightHandler.run is designed for all active agents.

    // Check which ones are enabled in current config?
    // The handler defaults to all true unless specified.

    try {
        console.log(`[TEST] Sending prompt: "${prompt}"`);
        const results = await handler.run(prompt, strategy, (progress) => console.log(`[PROGRESS] ${progress.status} - ${progress.service}: ${progress.content ? progress.content.length : 0} chars`));

        console.log('\n[TEST] Results Received:');
        results.forEach(r => {
            console.log(`\n--- ${r.service.toUpperCase()} ---`);
            console.log(`Status: ${r.status}`);
            console.log(`Length: ${r.content ? r.content.length : 0}`);
            if (r.content && r.content.length < 100) {
                console.log(`Preview: ${r.content}`);
            } else {
                console.log(`Preview: ${r.content ? r.content.substring(0, 50) + '...' : 'N/A'}`);
            }
        });

    } catch (error) {
        console.error('[TEST] Error during execution:', error);
    } finally {
        await handler.close();
    }
}

runTest();
