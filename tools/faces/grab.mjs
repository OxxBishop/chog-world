// Open a capture page, wait for window.__done, and save its picture, depth and projection. Usage: node grab.mjs <url> <out-prefix>
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
const [, , URL_, OUT] = process.argv;
const PORT = 9354; // a free debugging port for its own headless Chrome
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(process.cwd(), 'faces', 'chrome-profile')}`, 'about:blank']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.find((t) => t.type === 'page')) break; } catch {} await sleep(300); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errs = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description); });
const send = (method, params = {}) => new Promise((r) => { const mid = ++id; pending.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: URL_ });
let v;
for (let i = 0; i < 240; i++) { v = (await send('Runtime.evaluate', { expression: 'window.__done', returnByValue: true })).result?.result?.value; if (v) break; await sleep(500); }
if (v) { const j = JSON.parse(v); writeFileSync(OUT + '.png', Buffer.from(j.png, 'base64')); writeFileSync(OUT + '.depth', Buffer.from(j.depth, 'base64')); delete j.png; delete j.depth; writeFileSync(OUT + '.json', JSON.stringify(j)); console.log('saved', OUT, j.mesh, j.verts, j.cam.half.toFixed(3)); } else console.log('failed', errs);
ws.close(); chrome.kill(); process.exit(0);
