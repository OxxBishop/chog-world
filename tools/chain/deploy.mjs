// Testnet deployer for ChogTestnet.
//
//   node deploy.mjs key       make the deployer key (saved to ~/.chog_testnet_key, never printed)
//   node deploy.mjs           deploy (needs testnet MON on the deployer address) and save build/deployment.json
//
// Monad testnet only: chain 10143. Nothing here touches mainnet.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { monadTestnet } from './chain.mjs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const KEY_FILE = path.join(os.homedir(), '.chog_testnet_key');
const BASE_URI = process.env.CHOG_BASE_URI || 'https://chog-world.vercel.app/meta/';


if (process.argv[2] === 'key') {
  if (fs.existsSync(KEY_FILE)) {
    console.log('key already exists; deployer address:', privateKeyToAccount(fs.readFileSync(KEY_FILE, 'utf8').trim()).address);
  } else {
    const k = generatePrivateKey();
    fs.writeFileSync(KEY_FILE, k, { mode: 0o600 });
    console.log('new testnet deployer address:', privateKeyToAccount(k).address);
  }
  process.exit(0);
}

const account = privateKeyToAccount(fs.readFileSync(KEY_FILE, 'utf8').trim());
const pub = createPublicClient({ chain: monadTestnet, transport: http(undefined, { timeout: 20000, retryCount: 3 }) });
const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(undefined, { timeout: 20000, retryCount: 3 }) });
const bal = await pub.getBalance({ address: account.address });
console.log('deployer', account.address, 'balance', formatEther(bal), 'MON (testnet)');
if (bal === 0n) {
  console.log('No testnet MON yet. Fund this address from the Monad testnet faucet, then run again.');
  process.exit(1);
}
const { abi, bytecode } = JSON.parse(fs.readFileSync(path.join(here, 'build', 'ChogTestnet.json'), 'utf8'));
const hash = await wallet.deployContract({ abi, bytecode, args: [BASE_URI] });
console.log('deploy tx', hash);
const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
console.log('status', rc.status, 'contract', rc.contractAddress, 'gas', rc.gasUsed.toString());
fs.writeFileSync(path.join(here, 'build', 'deployment.json'), JSON.stringify({
  chainId: 10143, address: rc.contractAddress, deployer: account.address, tx: hash, baseURI: BASE_URI,
  explorer: `https://testnet.monadexplorer.com/address/${rc.contractAddress}`,
}, null, 1));
console.log('saved build/deployment.json');
