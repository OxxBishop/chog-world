// Tests for the Chog brain, run locally: node tools/brain/test.mjs
//
// Without ANTHROPIC_API_KEY it runs in mock mode (no Claude calls) and checks the plumbing: sign-in
// proof, live ownership on Monad testnet, memories, the wipe on a new keeper, demo limits, Chog-to-Chog
// caching and rate limits. With a key (and BRAIN_LIVE=1) it also has a real conversation.
// Signs with the testnet deployer key in ~/.chog_testnet_key, which holds testnet Chogs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { createPublicClient, http, parseAbi } from 'viem';

const LIVE = process.env.BRAIN_LIVE === '1' && process.env.ANTHROPIC_API_KEY;
if (!LIVE) process.env.BRAIN_MOCK = '1';
const { default: chat } = await import('../../api/chat.js');
const { default: chogchat } = await import('../../api/chogchat.js');
const memory = await import('../../api/_lib/memory.js');

const account = privateKeyToAccount(fs.readFileSync(path.join(os.homedir(), '.chog_testnet_key'), 'utf8').trim());
const reader = createPublicClient({ transport: http('https://testnet-rpc.monad.xyz') });
const ids = (await reader.readContract({ address: '0x85a9ba85e5a3e87bab529c402140a87a72622b91', abi: parseAbi(['function tokensOf(address) view returns (uint256[])']), functionName: 'tokensOf', args: [account.address] })).map(Number);
const MINE = ids[0];
console.log(LIVE ? 'LIVE mode' : 'mock mode', '| keeper', account.address, 'holds', ids);

async function signIn(acct = account, issued = new Date()) {
  const message = ['Sign in to Chog World', '', `Wallet: ${acct.address}`, 'Network: Monad Testnet (10143)', 'Nonce: 123456', `Issued: ${issued.toISOString()}`, '', 'This is a free signature. It does not send a transaction or move anything.'].join('\n');
  return { address: acct.address, message, signature: await acct.signMessage({ message }) };
}
function call(handler, body, ip = '10.0.0.1') {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { resolve({ status: this.statusCode, body: JSON.parse(s) }); } };
    handler({ method: 'POST', body, headers: { 'x-forwarded-for': ip }, socket: {} }, res);
  });
}
let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) pass++; else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
}

const session = await signIn();
let r = await call(chat, { id: MINE, session, text: 'hi! my name is Bishop, I surf and I say "no cap" a lot', place: 'the plaza', hour: 18 });
check('keeper chat works', r.status === 200 && r.body.reply, JSON.stringify(r.body));
if (LIVE) console.log('   reply:', r.body.reply, '| mood', r.body.mood, '| learned', r.body.learned);

r = await call(chat, { id: MINE, session, text: 'what do you remember about me?' });
check('second message works', r.status === 200, r.body.reply);
if (LIVE) console.log('   reply:', r.body.reply);

const notMine = ids.includes(1) ? 2 : 1;
r = await call(chat, { id: notMine, session, text: 'hello' });
check('refuses a Chog the wallet does not hold', r.status === 403, r.body.error);

r = await call(chat, { id: MINE, session: { ...session, signature: session.signature.slice(0, -4) + 'abcd' }, text: 'hello' });
check('refuses a bad signature', r.status === 401, r.body.error);

r = await call(chat, { id: MINE, session: await signIn(account, new Date(Date.now() - 8 * 86400000)), text: 'hello' });
check('refuses an old sign-in', r.status === 401, r.body.error);

const stranger = privateKeyToAccount(generatePrivateKey());
r = await call(chat, { id: MINE, session: await signIn(stranger), text: 'hello' });
check('refuses a stranger claiming the Chog', r.status === 403, r.body.error);

r = await call(chat, { id: 43, session: { demo: true, demoKey: 'abcdef1234567890' }, text: 'hi im a judge' });
check('demo Chog talks to guests', r.status === 200, r.body.reply);
r = await call(chat, { id: MINE, session: { demo: true, demoKey: 'abcdef1234567890' }, text: 'hi' });
check('guests only get the demo Chog', r.status === 403, r.body.error);

r = await call(chat, { id: MINE, session, text: '   ' });
check('empty message refused', r.status === 400, r.body.error);

// Memory: the keeper's notes exist, then a new keeper wipes them but world memory stays.
let m = await memory.recall(MINE, account.address.toLowerCase());
check('keeper memories saved', m.notes.length > 0 && m.log.length >= 2, `${m.notes.length} notes, ${m.log.length} log lines`);
await memory.addWorld(MINE, ['visited the lighthouse']);
const next = stranger.address.toLowerCase();
m = await memory.recall(MINE, next);
check('new keeper starts fresh', m.newKeeper && m.notes.length === 0 && m.log.length === 0);
check('world memory survives the sale', m.world.some((w) => /lighthouse/.test(w.note)) && m.world.some((w) => /new keeper/.test(w.note)));
m = await memory.recall(MINE, account.address.toLowerCase());
check('old keeper memories really gone', m.notes.length === 0, 'old keeper returning finds nothing');

// Chog-to-Chog
r = await call(chogchat, { a: 7, b: 9, place: 'the bar' }, '10.0.0.2');
check('Chog-to-Chog scene', r.status === 200 && r.body.lines.length >= 2, JSON.stringify(r.body.lines?.[0]));
if (LIVE) for (const l of r.body.lines) console.log(`   ${l.who}: ${l.text} (${l.mood})`);
const first = r.body.lines;
r = await call(chogchat, { a: 9, b: 7, place: 'the bar' }, '10.0.0.2');
check('scene cached and flipped for the swapped pair', r.body.cached && r.body.lines[0].who !== first[0].who);
r = await call(chogchat, { a: 7, b: 7 }, '10.0.0.2');
check('a Chog cannot chat with itself', r.status === 400);

// Rate limit: 15 a minute per keeper.
let limited = false;
for (let i = 0; i < 16 && !limited; i++) limited = (await call(chat, { id: 43, session: { demo: true, demoKey: 'ratelimit1234567' }, text: 'spam ' + i }, '10.0.0.9')).status === 429;
check('rate limit kicks in', limited);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
