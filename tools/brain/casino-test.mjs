// Tests for the casino board, run locally: node tools/brain/casino-test.mjs
// Uses the in-memory store (no Redis). Signs with the testnet deployer key in ~/.chog_testnet_key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { createPublicClient, http, parseAbi } from 'viem';

for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k];
const { default: casino, MAX_CHIPS } = await import('../../api/casino.js');
{
  const res = { statusCode: 0, setHeader() {}, end() {} };
  await casino({ method: 'GET', url: '/api/casino', headers: {}, socket: {} }, res);
  console.log(`${res.statusCode === 503 ? 'PASS' : 'FAIL'}  without Redis the board says it is down (503)`);
  if (res.statusCode !== 503) process.exitCode = 1;
}
process.env.CASINO_MEMORY = '1';

const account = privateKeyToAccount(fs.readFileSync(path.join(os.homedir(), '.chog_testnet_key'), 'utf8').trim());
const reader = createPublicClient({ transport: http('https://testnet-rpc.monad.xyz') });
const ids = (await reader.readContract({ address: '0x85a9ba85e5a3e87bab529c402140a87a72622b91', abi: parseAbi(['function tokensOf(address) view returns (uint256[])']), functionName: 'tokensOf', args: [account.address] })).map(Number);
const [A, B] = ids;
console.log('keeper', account.address, 'holds', ids);

async function signIn(acct = account) {
  const message = ['Sign in to Chog World', '', `Wallet: ${acct.address}`, 'Network: Monad Testnet (10143)', 'Nonce: 123456', `Issued: ${new Date().toISOString()}`, '', 'This is a free signature. It does not send a transaction or move anything.'].join('\n');
  return { address: acct.address, message, signature: await acct.signMessage({ message }) };
}
function call(method, { body, url = '/api/casino', query, ip = '10.0.0.1' } = {}) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { resolve({ status: this.statusCode, body: JSON.parse(s) }); } };
    casino({ method, body, url, query, headers: { 'x-forwarded-for': ip }, socket: {} }, res);
  });
}
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + JSON.stringify(extra) : ''}`);
};

const session = await signIn();
let r = await call('GET', { url: '/api/casino?top=8' });
check('empty board', r.status === 200 && Array.isArray(r.body.top) && r.body.top.length === 0, r.body);

r = await call('POST', { body: { id: A, chips: 740, session } });
check('a keeper posts their Chog', r.status === 200 && r.body.chips === 740, r.body);
r = await call('POST', { body: { id: A, chips: 300, session } });
check('a lower score keeps the best', r.status === 200 && r.body.chips === 740, r.body);
r = await call('POST', { body: { id: A, chips: 1250.7, session } });
check('a higher score raises it (whole chips)', r.body.chips === 1250, r.body);
if (B) {
  r = await call('POST', { body: { id: B, chips: 5e9, session } });
  check('chips are capped', r.body.chips === MAX_CHIPS, r.body);
}
r = await call('GET', { url: '/api/casino?top=8' });
const lead = B ?? A;
check('board is most chips first, names from the id', r.body.top[0]?.id === lead && r.body.top[0].name === `Chog #${lead}` && r.body.top.every((x, i, a) => !i || a[i - 1].chips >= x.chips), r.body);
r = await call('GET', { query: { top: '1' } });
check('top=n (Vercel query)', r.body.top.length === 1, r.body);

const notMine = [1, 5, 7, 9].find((x) => !ids.includes(x));
r = await call('POST', { body: { id: notMine, chips: 999, session } });
check('refuses a Chog the wallet does not hold', r.status === 403, r.body);
r = await call('POST', { body: { id: A, chips: 999, session: { ...session, signature: session.signature.slice(0, -4) + 'abcd' } } });
check('refuses a bad signature', r.status === 401, r.body);
r = await call('POST', { body: { id: 43, chips: 999, session: { demo: true, demoKey: 'abcdefghijklmnop' } } });
check('refuses the demo Chog', r.status === 403, r.body);
r = await call('POST', { body: { id: A, chips: 999 } });
check('refuses no sign-in', r.status === 401, r.body);
r = await call('POST', { body: { id: 99999, chips: 1, session } });
check('refuses an unknown Chog', r.status === 400, r.body);
r = await call('POST', { body: { id: A, chips: -5, session } });
check('refuses negative chips', r.status === 400, r.body);
r = await call('POST', { body: { id: A, chips: 'lots', session } });
check('refuses junk chips', r.status === 400, r.body);
r = await call('POST', { body: { id: A, chips: null, session } });
check('refuses missing chips', r.status === 400, r.body);
r = await call('PUT', {});
check('other methods 405', r.status === 405, r.body);
const stranger = await signIn(privateKeyToAccount(generatePrivateKey()));
r = await call('POST', { body: { id: A, chips: 1e6, session: stranger } });
check("a stranger cannot post someone else's Chog", r.status === 403, r.body);
r = await call('GET', { url: '/api/casino?top=8' });
check('board unchanged by refused posts', r.body.top.find((x) => x.id === A)?.chips === 1250, r.body);
let last;
for (let i = 0; i < 11; i++) last = await call('POST', { body: { id: A, chips: 1, session }, ip: '10.0.0.9' });
check('rate limited per keeper', last.status === 429, last.body);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
