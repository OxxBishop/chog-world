// A portal trip, frame by frame on a held clock: node portalcap.mjs <kind> <outdir> [w] [h] [port] [every] [guest id] [to]
// The guest beams down on the plaza (arrives), then travels to portal <to> (departs, arrives).
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const [,, kind = 'gate', out = 'shots/pt', w = '960', h = '540', port = '5174', every = '1', guest = '1151', to = '1'] = process.argv;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = +w < 700;
const page = await browser.newPage({ viewport: { width: +w, height: +h }, isMobile: mobile, hasTouch: mobile });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:${port}/?hour=15&nointro${kind !== 'none' ? `&portal=${kind}` : ''}`);
await page.waitForSelector('#loading.done', { timeout: 900000 });
await page.waitForTimeout(3000);
const progs0 = await page.evaluate(() => window.chogWorld.renderer.info.programs.length);
await page.evaluate(() => {
  const w = window.chogWorld;
  w.renderer.setAnimationLoop(null);
  let now = performance.now();
  performance.now = () => now;
  const q = [];
  window.requestAnimationFrame = (cb) => (q.push(cb), q.length);
  window.__step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += 1000 / 30;
      for (const cb of q.splice(0)) cb(now);
      w.frame();
    }
  };
  window.__step(3);
});
let f = 0;
const shoot = async () => {
  await page.screenshot({ path: `${out}/f-${String(f++).padStart(4, '0')}.png`, timeout: 180000 });
};
const step = (n) => page.evaluate((n) => window.__step(n), n);
// The guest picks a Chog and beams down.
page.evaluate(() => window.chogWorld.travel.pickGuest());
await page.waitForSelector('.tv-pick', { timeout: 60000 });
await step(1);
await page.waitForSelector('.tv-pick.on', { timeout: 60000 });
await page.click(`.tv-pick button[data-id="${guest}"]`, { timeout: 180000 });
await page.waitForFunction(() => !document.querySelector('.tv-pick'), null, { timeout: 300000 });
const shots = async (n) => {
  for (let i = 0; i < n; i++) {
    await step(+every);
    await shoot();
  }
};
await shots(Math.round(85 / +every));
// Then a trip.
const t0 = Date.now();
page.evaluate((k) => window.chogWorld.travel.travelTo(k), +to);
await shots(Math.round(200 / +every));
const progs1 = await page.evaluate(() => window.chogWorld.renderer.info.programs.length);
console.log(kind, 'frames', f, 'programs', progs0, '->', progs1, 'state', JSON.stringify(await page.evaluate(() => ({ busy: window.chogWorld.travel.state.busy, on: window.chogWorld.travel.state.onPortal }))));
console.log(logs.filter((l) => /error|warn/i.test(l) && !/503|preload|GPU stall|KHR|404/.test(l)).join('\n'));
await browser.close();
