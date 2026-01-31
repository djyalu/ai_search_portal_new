import { runExhaustiveAnalysis } from './playwright_handler.js';
import dotenv from 'dotenv';
dotenv.config();

console.log("Starting Full Multi-Agent Verification Test...");

async function test() {
    try {
        const results = await runExhaustiveAnalysis(
            "반갑다. 현재 시스템 통합 테스트 중이야. 너의 이름과 현재 작동 중인 모델명을 1줄로 짧게 말해줘.",
            (progress) => {
                if (progress.status === 'streaming') return;
                console.log(`[PROGRESS] ${progress.status}: ${progress.message}`);
            },
            {
                enabledAgents: {
                    perplexity: true,
                    chatgpt: true,
                    gemini: true,
                    claude: true
                }
            }
        );

        console.log("\n--- FULL VERIFICATION COMPLETED ---");

        const summary = [];
        for (const [id, text] of Object.entries(results.results)) {
            const isError = !text || text.includes('에러') || text.includes('signed out') || text.length < 5 || text.includes('What can I help with');
            summary.push(`${id}: ${isError ? 'FAIL' : 'OK'} (${text ? text.substring(0, 30).replace(/\n/g, ' ') : 'EMPTY'}...)`);
        }

        console.log("Results Summary:\n" + summary.join('\n'));

        const anyFail = summary.some(s => s.includes('FAIL'));
        if (anyFail) {
            console.error("\nVerification finished with some FAILURES.");
            process.exit(1);
        } else {
            console.log("\nAll systems GO. Verification SUCCESS.");
            process.exit(0);
        }
    } catch (error) {
        console.error("Verification CRASHED:", error);
        process.exit(1);
    }
}

test();
