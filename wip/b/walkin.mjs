// A guest walks into the casino and out again, frame by frame: node walkin.mjs <outdir> [port] [w] [h] [every] [room]
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const [,, out = 'shots/wi', port = '5173', w = '960', h = '540', every = '3', roomId = 'casino'] = process.argv;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = +w < 700;
const page = await browser.newPage({ viewport: { width: +w, height: +h }, isMobile: mobile, hasTouch: mobile });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:${port}/?hour=15&nointro`);
await page.waitForSelector('#loading.done', { timeout: 900000 });
await page.waitForTimeout(3000);
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
page.evaluate(() => window.chogWorld.travel.pickGuest());
await page.waitForSelector('.tv-pick', { timeout: 60000 });
await step(1);
await page.waitForSelector('.tv-pick.on', { timeout: 60000 });
await page.click('.tv-pick button[data-id="1151"]', { timeout: 180000 });
await page.waitForFunction(() => !document.querySelector('.tv-pick'), null, { timeout: 300000 });
await step(70);
// Just outside the door, facing it, the camera behind.
await page.evaluate((roomId) => {
  const w = window.chogWorld, T = w.THREE, s = w.travel.state;
  const h = w.island.hub.rooms.find((x) => x.id === roomId), e = h.entrance, g = w.island.hub.group;
  const at = g.localToWorld(new T.Vector3(e.x, 0, e.z + 0.6));
  const outv = g.localToWorld(new T.Vector3(e.x, 0, e.z + 2)).sub(g.localToWorld(new T.Vector3(e.x, 0, e.z))).setY(0).normalize();
  const p = at.clone().addScaledVector(outv, 4.5);
  const gr = w.travel.groundAt(p.x, p.z, p.y + 3);
  s.pos.set(p.x, gr ? gr.y : p.y, p.z);
  s.yaw = Math.atan2(-outv.x, -outv.z);
  s.camYaw = Math.atan2(outv.x, outv.z);
  s.vel.set(0, 0, 0);
}, roomId);
await step(4);
let f = 0;
const shoot = () => page.screenshot({ path: `${out}/f-${String(f++).padStart(4, '0')}.png`, timeout: 240000 });
await shoot();
await page.keyboard.down('w');
for (let i = 0; i < 40; i++) {
  await step(1);
  if (await page.evaluate(() => window.chogWorld.entry.active)) break;
}
await page.keyboard.up('w');
console.log('entered', await page.evaluate(() => window.chogWorld.entry.active));
for (let i = 0; i < 120; i++) {
  await step(+every);
  await shoot();
  if (!(await page.evaluate(() => window.chogWorld.entry.active))) break;
}
await step(10);
await shoot();
console.log('in room', await page.evaluate(() => ({ room: window.chogWorld.rig.room?.constructor?.name, travel: window.chogWorld.travel.active })));
// And out again.
await page.evaluate(() => document.getElementById('btn-back').click());
for (let i = 0; i < 120; i++) {
  await step(+every);
  await shoot();
  if (!(await page.evaluate(() => window.chogWorld.entry.active))) break;
}
await step(8);
await shoot();
console.log('out', await page.evaluate(() => ({ travel: window.chogWorld.travel.active, room: !!window.chogWorld.rig.room })));
console.log(logs.filter((l) => /error|warn/i.test(l) && !/503|preload|GPU stall|KHR|404/.test(l)).join('\n'));
await browser.close();
