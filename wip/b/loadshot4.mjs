// The pixel loader on the loading screen: node loadshot4.mjs <out> <w> <h> <dpr> [port]
import { createRequire } from 'module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const [,, out = 'shots/lp', w = '390', h = '844', dpr = '3', port = '5173'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = +w < 700;
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr, isMobile: mobile, hasTouch: mobile });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('worker', (wk) => logs.push(`[worker] ${wk.url()}`));
await page.goto(`http://localhost:${port}/?hour=15`);
await page.waitForFunction(() => document.querySelector('.load-runner')?.style.width, null, { timeout: 60000 });
await page.waitForTimeout(2500);
const box = await page.evaluate(() => { const r = document.querySelector('.load-runner').getBoundingClientRect(); return [r.x, r.y, r.width, r.height, document.querySelector('.load-runner').style.width]; });
console.log('box', JSON.stringify(box));
await page.screenshot({ path: `${out}-full.png`, timeout: 120000 });
const [x, y, bw, bh] = box;
for (let i = 0; i < 3; i++) {
  await page.screenshot({ path: `${out}-c${i}.png`, clip: { x: x - 40, y: y - 60, width: bw + 80, height: bh + 100 }, timeout: 120000 });
  await page.waitForTimeout(250);
}
console.log(logs.filter((l) => /error|warn|worker/i.test(l) && !/503|preload|GPU stall|KHR|404/.test(l)).join('\n'));
await browser.close();
