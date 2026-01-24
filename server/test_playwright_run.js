import { runExhaustiveAnalysis } from './playwright_handler.js';

(async () => {
  try {
    console.log('Starting Playwright test run...');
    const res = await runExhaustiveAnalysis('테스트: 서울 날씨 요약해줘', (p) => {
      console.log('PROGRESS>', p);
    });
    console.log('Playwright run completed. Result:');
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error('Playwright run failed:', err);
  }
})();
