// Roulette bets on a phone: tap, undo, hold to take off; and the table holds still. node czbet.mjs <out> [port]
import { createRequire } from 'module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const [,, out = 'shots/cb', port = '5173'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:${port}/?hour=21&nointro&view=casino`);
await page.waitForSelector('#loading.done', { timeout: 900000 });
await page.waitForTimeout(1500);
// Real time from here: the camera's idle turn would show over a few seconds.
await page.evaluate(() => {
  localStorage.clear();
  const w = window.chogWorld;
  const traits = { Tier: 'Legendary', Eyes: 'Purple laser', Body: 'Kings Robe', Head: 'Wizard Hat', Mouth: 'Gold Tooth', Accessory: 'Fwog', Aura: 'Purple', Skin: 'Red' };
  Object.defineProperty(w.session, 'active', { configurable: true, get: () => ({ id: 1517, info: { id: 1517, name: 'Chog #1517', traits, image: '/art/1517.webp' } }) });
  w.casino.play('roulette');
});
await page.waitForTimeout(25000);
await page.screenshot({ path: `${out}-start.png`, timeout: 240000 });
console.log(await page.evaluate(() => ({ cls: document.querySelector('.casino-panel')?.className, q: document.querySelectorAll('.cz-q').length, hidden: document.querySelector('.casino-panel')?.hidden })));
const felt = () => page.evaluate(() => document.querySelector('.cz-on b')?.textContent);
const cam = () => page.evaluate(() => { const c = window.chogWorld.camera; return [c.position.x, c.position.z].map((v) => +v.toFixed(3)); });
const c0 = await cam();
const tap = (k) => page.tap(`.cz-q[data-k="${k}"]`, { timeout: 60000, force: true });
await tap('red'); await tap('red'); await tap('d2');
const a = await felt();
await page.tap('.cz-undo');
const b = await felt();
// Hold "red" to take a chip off it.
const box = await page.locator('.cz-q[data-k="red"]').boundingBox();
await page.touchscreen.tap(box.x + 5, box.y + 5); // a tap first (adds one)
const c = await felt();
const hb = await page.locator('.cz-q[data-k="red"]').boundingBox();
const cdp = await page.context().newCDPSession(page);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }] });
await page.waitForTimeout(800);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(300);
const d = await felt();
await page.waitForTimeout(6000);
const c1 = await cam();
await page.screenshot({ path: `${out}-panel.png`, timeout: 240000 });
console.log(JSON.stringify({ afterThree: a, afterUndo: b, afterTap: c, afterHold: d, camMoved: Math.hypot(c1[0] - c0[0], c1[1] - c0[1]).toFixed(3), c0, c1 }));
console.log(logs.filter((l) => /error|warn/i.test(l) && !/503|preload|GPU stall|KHR|404/.test(l)).join('\n'));
await browser.close();
