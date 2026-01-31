import { runExhaustiveAnalysis } from './playwright_handler.js';
import dotenv from 'dotenv';
dotenv.config();

console.log("Starting ChatGPT-only Verification Test...");

async function test() {
    try {
        const results = await runExhaustiveAnalysis(
            "반갑다. 현재 작동 테스트 중이야. 1줄로 답변만 간단히 해줘.",
            (progress) => {
                if (progress.status === 'streaming') return;
                console.log(`[PROGRESS] ${progress.status}: ${progress.message}`);
            },
            {
                enabledAgents: {
                    perplexity: false,
                    chatgpt: true,
                    gemini: false,
                    claude: false
                }
            }
        );

        console.log("\n--- CHATGPT VERIFICATION COMPLETED ---");
        console.log("ChatGPT Response:", results.results.chatgpt);

        if (results.results.chatgpt && results.results.chatgpt.includes('에러')) {
            console.error("Verification FAILED: ChatGPT returned an error.");
            process.exit(1);
        } else if (!results.results.chatgpt) {
            console.error("Verification FAILED: ChatGPT returned no result.");
            process.exit(1);
        } else {
            console.log("Verification SUCCESS: ChatGPT is working.");
            process.exit(0);
        }
    } catch (error) {
        console.error("Verification CRASHED:", error);
        process.exit(1);
    }
}

test();
