// Numbers for the walk in (no screenshots but a few): node walkdbg.mjs [port] [room] [shots]
import { createRequire } from 'module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const [,, port = '5173', roomId = 'casino', shots = ''] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const [W, Hh] = (process.env.VP || '960x540').split('x').map(Number);
const mob = W < 700;
const dir = process.env.DIR || 'shots/wd';
const page = await browser.newPage({ viewport: { width: W, height: Hh }, isMobile: mob, hasTouch: mob });
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
  window.__step = (n = 1, draw = true) => { for (let i = 0; i < n; i++) { now += 1000 / 30; for (const cb of q.splice(0)) cb(now); w.frame(); } };
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
const info = await page.evaluate((roomId) => {
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
  const r = w.island.hub.rooms.find((x) => x.id === roomId);
  const box = new T.Box3().setFromObject(s.chog.root).getSize(new T.Vector3());
  return { e: { x: e.x, sill: e.sill, top: e.top, z: e.z, zIn: e.zIn, half: e.half, fl: [e.floor(e.z - 0.8), e.floor((e.z + e.zIn) / 2), e.floor(e.zIn + 0.6)] }, chogSize: box.toArray().map((v) => +v.toFixed(2)), scale: s.chog.root.scale.x, fov: w.camera.fov };
}, roomId);
console.log(JSON.stringify(info));
await step(4);
await page.keyboard.down('w');
for (let i = 0; i < 40; i++) {
  await step(1);
  if (await page.evaluate(() => window.chogWorld.entry.active)) break;
}
await page.keyboard.up('w');
const toLocal = `const g=w.island.hub.group; const L=(v)=>g.worldToLocal(v.clone()).toArray().map(x=>+x.toFixed(2));`;
let f = 0;
const trace = async (tag) => {
  for (let i = 0; i < 260; i++) {
    const d = await page.evaluate(new Function(`const w=window.chogWorld; ${toLocal} const r=w.entry._dbg; if(!r) return null; const c=r.walker.chog.root.getWorldPosition(new w.THREE.Vector3()); return { s:+r.s.toFixed(2), stage:r.stage, t:+r.t.toFixed(2), cam:L(w.camera.position), look:L(r.look), chog:L(c), fov:+w.camera.fov.toFixed(1), sc:+r.walker.chog.root.scale.x.toFixed(2), total:+r.path.total.toFixed(2) };`));
    if (!d) break;
    if (i === 0) {
      const pts = await page.evaluate(new Function(`const w=window.chogWorld; ${toLocal} const r=w.entry._dbg; const out=[]; for(let s=0;s<=r.path.total;s+=1) out.push(L(r.path.at(s))); return out;`));
      console.log(tag, 'path', JSON.stringify(pts));
    }
    console.log(tag, JSON.stringify(d));
    if (shots && i % +shots === 0) await page.screenshot({ path: `${dir}/${tag}-${String(f++).padStart(3, '0')}.png`, timeout: 240000 });
    await step(3);
  }
  await step(6);
  if (shots) await page.screenshot({ path: `${dir}/${tag}-${String(f++).padStart(3, '0')}-end.png`, timeout: 240000 });
};
await trace('in');
console.log('after in', await page.evaluate(() => ({ room: !!window.chogWorld.rig.room, sc: window.chogWorld.travel.state.chog.root.scale.x })));
await step(20);
await page.evaluate(() => document.getElementById('btn-back').click());
await step(1);
await trace('out');
console.log('after out', await page.evaluate(() => ({ room: !!window.chogWorld.rig.room, travel: window.chogWorld.travel.active, sc: window.chogWorld.travel.state.chog.root.scale.x })));
console.log(logs.filter((l) => /error|warn/i.test(l) && !/503|preload|GPU stall|KHR|404/.test(l)).join('\n'));
await browser.close();
