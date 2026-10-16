// Standing on a portal pad: beam down, walk off and back on, take the gate trip. node padtest.mjs <out> [port]
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const [,, out = 'shots/pad', port = '5173'] = process.argv;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:${port}/?hour=15&nointro`);
await page.waitForSelector('#loading.done', { timeout: 900000 });
await page.waitForTimeout(2000);
await page.evaluate(() => {
  const w = window.chogWorld;
  w.renderer.setAnimationLoop(null);
  let now = performance.now();
  performance.now = () => now;
  const q = [];
  window.requestAnimationFrame = (cb) => (q.push(cb), q.length);
  window.__step = (n = 1) => { for (let i = 0; i < n; i++) { now += 1000 / 30; for (const cb of q.splice(0)) cb(now); w.frame(); } };
  window.__step(3);
});
const step = (n) => page.evaluate((n) => window.__step(n), n);
const where = (tag) => page.evaluate((tag) => {
  const w = window.chogWorld, s = w.travel.state;
  const r = s.chog.root.getWorldPosition(new w.THREE.Vector3());
  return `${tag}: chog y ${r.y.toFixed(3)} pos y ${s.pos.y.toFixed(3)} at ${r.x.toFixed(1)},${r.z.toFixed(1)} busy ${s.busy} onPortal ${s.onPortal}`;
}, tag);
let f = 0;
const shoot = (tag) => page.screenshot({ path: `${out}/${String(f++).padStart(2, '0')}-${tag}.png`, timeout: 240000 });
page.evaluate(() => window.chogWorld.travel.pickGuest());
await page.waitForSelector('.tv-pick', { timeout: 60000 });
await step(1);
await page.waitForSelector('.tv-pick.on', { timeout: 60000 });
await page.click('.tv-pick button[data-id="1151"]', { timeout: 180000 });
await page.waitForFunction(() => !document.querySelector('.tv-pick'), null, { timeout: 300000 });
await step(120);
console.log(await where('landed'));
await shoot('landed');
// Off the pad (walk away from it), then back on.
await page.keyboard.down('s');
for (let i = 0; i < 40; i++) await step(1);
await page.keyboard.up('s');
await step(10);
console.log(await where('off'));
await shoot('off');
await page.keyboard.down('w');
for (let i = 0; i < 34; i++) await step(1);
await page.keyboard.up('w');
await step(10);
console.log(await where('back on'));
await shoot('backon');
page.evaluate(() => window.chogWorld.travel.travelTo(1));
for (let i = 0; i < 8; i++) {
  await step(25);
  console.log(await where(`trip ${i}`));
  await shoot(`trip${i}`);
}
console.log(logs.filter((l) => /error|warn/i.test(l) && !/503|preload|GPU stall|KHR|404/.test(l)).join('\n'));
await browser.close();
