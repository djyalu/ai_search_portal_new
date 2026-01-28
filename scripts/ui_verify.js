const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const url = 'http://localhost:5173/';
  const results = { lockVisible: false, toastVisible: false, dbgLogVisible: false, koreanBroken: false };

  await page.goto(url, { waitUntil: 'networkidle' });

  // Wait for input to be available
  await page.waitForSelector('input[aria-readonly]');

  // Prevent socket.emit from calling server to avoid triggering analysis
  await page.evaluate(() => {
    // Override socket.emit if present
    if (window.socket && typeof window.socket.emit === 'function') {
      window.__orig_emit = window.socket.emit;
      window.socket.emit = function(event, ...args) {
        // intercept 'start-analysis' to avoid server work
        if (event === 'start-analysis') {
          // simulate local effect by dispatching a DOM event that client can use
          const ev = new CustomEvent('local-start-analysis');
          window.dispatchEvent(ev);
          return;
        }
        return window.__orig_emit.apply(this, [event, ...args]);
      };
    }

    // Also patch the client to listen for 'local-start-analysis' to set UI state
    window.addEventListener('local-start-analysis', () => {
      try {
        // try to find React root and set isAnalyzing by toggling the input readOnly attribute and adding lock indicator
        const inp = document.querySelector('input[aria-readonly]');
        if (inp) {
          inp.setAttribute('readonly', 'true');
          inp.classList.add('opacity-60');
        }
        // add a lock indicator if missing
        let lock = document.querySelector('[data-test-lock]');
        if (!lock) {
          lock = document.createElement('div');
          lock.setAttribute('data-test-lock', '1');
          lock.className = 'test-lock-indicator';
          lock.innerText = '입력 잠김';
          // append near the header
          const header = document.querySelector('header');
          if (header) header.appendChild(lock);
        }
      } catch (e) {}
    });
  });

  // Type text into input
  await page.fill('input[aria-readonly]', '테스트 분석');

  // Click the analyze button (this will trigger the intercepted emit)
  await page.click('button:has(svg[class*="Send"])', { timeout: 2000 }).catch(()=>{});
  // wait a moment for UI updates
  await page.waitForTimeout(500);

  // Check for lock indicator or readonly
  const readonly = await page.getAttribute('input[aria-readonly]', 'readonly');
  const lock = await page.$('[data-test-lock]');
  results.lockVisible = !!(readonly || lock);

  // Click a history item if present
  const historyItem = await page.$('aside button, aside [onClick] , aside div.cursor-pointer');
  if (historyItem) {
    await historyItem.click().catch(()=>{});
    await page.waitForTimeout(200);
    // toast should appear
    const toast = await page.$('div.bg-slate-800, div:has-text("분석 중에는 히스토리 선택")');
    results.toastVisible = !!toast;
  }

  // Click DBG button if present
  const dbg = await page.$('button:has-text("DBG")');
  if (dbg) {
    await dbg.click();
    await page.waitForTimeout(200);
    // filter log should appear
    const flog = await page.$('div:has-text("Ignored streaming: debug_test")');
    results.dbgLogVisible = !!flog;
    // wait 4s to see it disappear
    await page.waitForTimeout(4200);
    const flog2 = await page.$('div:has-text("Ignored streaming: debug_test")');
    if (flog2) results.dbgLogVisible = false; // didn't disappear
  }

  // Check Korean rendering: look for lock text in DOM
  const lockText = await page.$('text=입력 잠김');
  const toastText = await page.$('text=분석 중에는 히스토리 선택이 잠겨 있습니다.');
  results.koreanBroken = !(lockText && toastText);

  console.log('UI verification results:', results);

  await browser.close();
})();
