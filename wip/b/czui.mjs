// The casino's controls in each look, at the roulette and the slots: node czui.mjs <out> <w> <h> <dpr> [port]
import { createRequire } from 'module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const [,, out = 'shots/ui', w = '1366', h = '768', dpr = '1', port = '5173'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = +w < 700;
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr, isMobile: mobile, hasTouch: mobile });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:${port}/?hour=21&nointro&view=casino`);
await page.waitForSelector('#loading.done', { timeout: 900000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  localStorage.clear();
  const w = window.chogWorld;
  const traits = { Tier: 'Legendary', Eyes: 'Purple laser', Body: 'Kings Robe', Head: 'Wizard Hat', Mouth: 'Gold Tooth', Accessory: 'Fwog', Aura: 'Purple', Skin: 'Red' };
  Object.defineProperty(w.session, 'active', { configurable: true, get: () => ({ id: 1517, info: { id: 1517, name: 'Chog #1517', traits, image: '/art/1517.webp' } }) });
  w.casino.play('roulette');
});
await page.waitForTimeout(20000);
const tap = (k) => page.click(`.cz-q[data-k="${k}"]`, { timeout: 60000, force: true });
await tap('red'); await tap('red'); await tap('d2');
const looks = ['', 'pixel', 'lounge', 'neon'];
const setLook = (ui) => page.evaluate((ui) => {
  for (const el of document.querySelectorAll('.casino-panel, .cz-edgecard')) {
    el.classList.remove('ui-pixel', 'ui-lounge', 'ui-neon');
    if (ui) el.classList.add(`ui-${ui}`);
  }
}, ui);
for (const ui of looks) {
  await setLook(ui);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}-roulette-${ui || 'default'}.png`, timeout: 240000 });
}
console.log(await page.evaluate(() => ({ card: !document.querySelector('.cz-edgecard')?.hidden, items: document.querySelectorAll('.cz-edgecard li').length, cardBox: document.querySelector('.cz-edgecard')?.getBoundingClientRect().toJSON(), panelBox: document.querySelector('.casino-panel')?.getBoundingClientRect().toJSON() })));
await page.evaluate(() => window.chogWorld.casino.play('slots'));
await page.waitForTimeout(8000);
for (const ui of looks) {
  await setLook(ui);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}-slots-${ui || 'default'}.png`, timeout: 240000 });
}
console.log(logs.filter((l) => /error|warn/i.test(l) && !/503|preload|GPU stall|KHR|404/.test(l)).join('\n'));
await browser.close();
