// The singer's stage through a song and its cheer, on a held clock: node stagecap.mjs <out> [hour] [port] [w] [h]
import { createRequire } from 'module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const [,, out = 'shots/st', hour = '15', port = '5175', w = '960', h = '540'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:${port}/?hour=${hour}&nointro`);
await page.waitForSelector('#loading.done', { timeout: 900000 });
await page.waitForTimeout(2000);
const progs0 = await page.evaluate(() => window.chogWorld.renderer.info.programs.length);
await page.evaluate(() => {
  const w = window.chogWorld;
  w.renderer.setAnimationLoop(null);
  let now = performance.now();
  performance.now = () => now;
  const q = [];
  window.requestAnimationFrame = (cb) => (q.push(cb), q.length);
  w.rig.update = () => {};
  const THREE = w.THREE;
  // Near the stage first, so its set is built.
  const sq = w.island.plaza.children.find((o) => Math.abs(o.position.x - 27) < 0.01 && Math.abs(o.position.z - 30) < 0.01);
  window.__sq = sq;
  const f = Math.atan2(10 - 27, 55 - 30);
  window.__aim = (dist, up, side = 0) => {
    const c = sq.localToWorld(new THREE.Vector3(0, 1.0, 0));
    const p = sq.localToWorld(new THREE.Vector3(Math.sin(f + side) * dist, up, Math.cos(f + side) * dist));
    w.camera.position.copy(p);
    w.camera.lookAt(c);
    w.camera.updateMatrixWorld();
  };
  window.__aim(8, 3.2);
  window.__step = (n = 1, ms = 1000 / 30) => {
    for (let i = 0; i < n; i++) {
      now += ms;
      for (const cb of q.splice(0)) cb(now);
      w.frame();
    }
  };
});
const step = (n, ms) => page.evaluate(([n, ms]) => window.__step(n, ms), [n, ms]);
// Until the set is up (its models load in real time).
for (let i = 0; i < 120; i++) {
  await step(1);
  if (await page.evaluate(() => !!window.chogWorld.scene.getObjectByName('stage-fx'))) break;
  await page.waitForTimeout(500);
}
await step(4);
const shot = async (tag) => page.screenshot({ path: `${out}-${tag}.png`, timeout: 240000 });
// Through the song: a shot a beat or so into each pattern (two bars each), then the cheer.
let t = 0;
const to = async (s, ms = 50) => {
  const n = Math.round(((s - t) * 1000) / ms);
  if (n > 0) await step(n, ms);
  t = s;
};
for (const [s, tag] of [[0.4, 'a-ripple'], [1.0, 'a-ripple2'], [5.3, 'b-sweep'], [10.1, 'c-checker'], [10.4, 'c-checker2'], [14.9, 'd-sparkle']]) {
  await to(s);
  await shot(tag);
}
await page.evaluate(() => window.__aim(10.5, 4.2, 0.35));
for (const [s, tag] of [[19.35, 'e-cheer0'], [19.7, 'e-cheer1'], [20.2, 'e-cheer2'], [21.0, 'e-cheer3'], [22.0, 'e-cheer4'], [23.6, 'f-idle-confetti'], [25.0, 'f-idle2']]) {
  await to(s, 1000 / 30);
  await shot(tag);
}
// Close on the floor and the confetti lying on it.
await page.evaluate(() => window.__aim(3.6, 1.6, 0.2));
await step(2);
await shot('g-close');
const progs1 = await page.evaluate(() => window.chogWorld.renderer.info.programs.length);
console.log('programs', progs0, '->', progs1);
console.log(logs.filter((l) => /error|warn/i.test(l) && !/503|preload|GPU stall|KHR|404/.test(l)).join('\n'));
await browser.close();
