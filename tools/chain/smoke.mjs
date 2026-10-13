// End-to-end check of the deployed testnet contract, from the deployer key:
// claim a Chog, read it back, send it to a fresh throwaway address, confirm the Transfer event and
// that tokensOf moved. This is the exact flow the sale cutscene relies on.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPublicClient, createWalletClient, http, parseEventLogs } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { monadTestnet } from './chain.mjs';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const { abi } = JSON.parse(fs.readFileSync(path.join(here, 'build', 'ChogTestnet.json'), 'utf8'));
const { address } = JSON.parse(fs.readFileSync(path.join(here, 'build', 'deployment.json'), 'utf8'));
const account = privateKeyToAccount(fs.readFileSync(path.join(os.homedir(), '.chog_testnet_key'), 'utf8').trim());
const pub = createPublicClient({ chain: monadTestnet, transport: http(undefined, { timeout: 20000, retryCount: 3 }) });
const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(undefined, { timeout: 20000, retryCount: 3 }) });
const read = (fn, args = []) => pub.readContract({ address, abi, functionName: fn, args });
const write = async (fn, args = []) => {
  const hash = await wallet.writeContract({ address, abi, functionName: fn, args });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`${fn} reverted ${hash}`);
  return rc;
};

const id = BigInt(process.argv[2] || 1);
if ((await read('balanceOf', [account.address])) === 0n) {
  await write('claim', [id]);
  console.log('claimed #' + id);
}
const mine = await read('tokensOf', [account.address]);
console.log('deployer holds', mine.map(String), 'tokenURI', await read('tokenURI', [mine[0]]));
const other = privateKeyToAccount(generatePrivateKey()).address;
const rc = await write('transferFrom', [account.address, other, mine[0]]);
const ev = parseEventLogs({ abi, logs: rc.logs, eventName: 'Transfer' })[0];
console.log('Transfer event', String(ev.args.tokenId), ev.args.from, '->', ev.args.to);
console.log('owner now', await read('ownerOf', [mine[0]]), 'expected', other);
console.log('deployer holds', (await read('tokensOf', [account.address])).map(String));
