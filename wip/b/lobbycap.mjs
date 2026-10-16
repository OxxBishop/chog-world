// The lobby at a few hours: node lobbycap.mjs <out> [port] [w] [h] [extra query]
import { createRequire } from 'module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const [,, out = 'shots/lb', port = '5174', w = '960', h = '540', extra = ''] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = +w < 700;
const page = await browser.newPage({ viewport: { width: +w, height: +h }, isMobile: mobile, hasTouch: mobile });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:${port}/?hour=9&nointro${extra ? `&${extra}` : ''}`);
await page.waitForSelector('#loading.done', { timeout: 900000 });
await page.waitForTimeout(2000);
const progs0 = await page.evaluate(() => window.chogWorld.renderer.info.programs.length);
await page.evaluate(() => {
  const w = window.chogWorld;
  w.renderer.setAnimationLoop(null);
  let now = performance.now();
  performance.now = () => now;
  window.__step = (n = 1) => { for (let i = 0; i < n; i++) { now += 1000 / 30; w.frame(); } };
  w.rig.jump('lobby');
  window.__step(30);
});
for (const hr of [9, 16.8, 18.4, 22]) {
  await page.evaluate((hr) => { const w = window.chogWorld; w.time.live = false; w.time.hour = hr; window.__step(12); }, hr);
  await page.screenshot({ path: `${out}-${String(hr).replace('.', '_')}.png`, timeout: 240000 });
}
const progs1 = await page.evaluate(() => window.chogWorld.renderer.info.programs.length);
console.log('programs', progs0, '->', progs1);
console.log(logs.filter((l) => /error|warn/i.test(l) && !/503|preload|GPU stall|KHR|404/.test(l)).join('\n'));
await browser.close();
