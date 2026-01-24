import { runExhaustiveAnalysis } from './playwright_handler.js';
import dotenv from 'dotenv';
dotenv.config();

async function testRalph() {
    console.log('🧪 Starting RALPH Pipeline Full-Stack Test...');
    const testPrompt = "인공지능 검색 엔진의 2026년 미래 전망에 대해 분석해줘";

    try {
        const result = await runExhaustiveAnalysis(testPrompt, (step) => {
            console.log(`[PROGRESS] ${step.status}: ${step.message || (step.service + ' streaming...')}`);
        });

        console.log('\n✅ RALPH Analysis Completed Successfully!');
        console.log('--- FINAL OPTIMAL ANSWER ---');
        console.log(result.optimalAnswer.substring(0, 500) + '...');
        console.log('\n--- AGENT RESULTS SUMMARY ---');
        Object.keys(result.results).forEach(agent => {
            console.log(`- ${agent.toUpperCase()}: ${result.results[agent].substring(0, 100)}...`);
        });

    } catch (error) {
        console.error('❌ Test Failed:', error);
    }
}

testRalph();
