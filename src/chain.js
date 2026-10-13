import { createPublicClient, createWalletClient, custom, http, parseAbi, parseAbiItem, defineChain, toHex } from 'viem';

/*
 * Chog World's link to Monad testnet: finding the wallet, signing in, and reading the testnet Chog
 * collection. Testnet only. Signing in is a message signature (free, no transaction). The one
 * transaction the app can ever ask for is a free claim of a testnet Chog, and only on chain 10143.
 */

export const MONAD_TESTNET = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' } },
  testnet: true,
});

export const CHOG_CONTRACT = '0x85a9ba85e5a3e87bab529c402140a87a72622b91';
export const EXPLORER_URL = 'https://testnet.monadexplorer.com';

const ABI = parseAbi([
  'function tokensOf(address who) view returns (uint256[])',
  'function ownerOf(uint256 id) view returns (address)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');

export const reader = createPublicClient({ chain: MONAD_TESTNET, transport: http() });

/**
 * Wallets in the browser. Each announces itself (EIP-6963); an older single injected wallet is used
 * if none do. Resolves to [{ name, icon, provider }].
 */
export function findWallets(waitMs = 350) {
  return new Promise((resolve) => {
    const found = new Map();
    const onAnnounce = (e) => {
      const { info, provider } = e.detail ?? {};
      if (info?.uuid && provider) found.set(info.uuid, { name: info.name, icon: info.icon, provider });
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      const list = [...found.values()];
      if (!list.length && window.ethereum) list.push({ name: 'Browser wallet', icon: null, provider: window.ethereum });
      resolve(list);
    }, waitMs);
  });
}

/** Connect a wallet and put it on Monad testnet, adding the network if the wallet doesn't know it. */
export async function connect(provider) {
  const wallet = createWalletClient({ chain: MONAD_TESTNET, transport: custom(provider) });
  const [address] = await wallet.requestAddresses();
  await toTestnet(wallet);
  return { wallet, address, provider };
}

async function toTestnet(wallet) {
  if ((await wallet.getChainId()) === MONAD_TESTNET.id) return;
  try {
    await wallet.switchChain({ id: MONAD_TESTNET.id });
  } catch (err) {
    // 4902: the wallet doesn't have this network yet.
    if (err?.code === 4902 || err?.cause?.code === 4902 || /4902|unrecognized|not been added|unknown chain/i.test(err?.message ?? '')) {
      await wallet.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: toHex(MONAD_TESTNET.id),
          chainName: MONAD_TESTNET.name,
          nativeCurrency: MONAD_TESTNET.nativeCurrency,
          rpcUrls: MONAD_TESTNET.rpcUrls.default.http,
          blockExplorerUrls: [EXPLORER_URL],
        }],
      });
      await wallet.switchChain({ id: MONAD_TESTNET.id });
    } else throw err;
  }
  if ((await wallet.getChainId()) !== MONAD_TESTNET.id) throw new Error('Your wallet is still on another network. Switch it to Monad Testnet and try again.');
}

/** A free signature to sign in: proves the wallet is yours, sends nothing. */
export async function signIn({ wallet, address }) {
  const nonce = crypto.getRandomValues(new Uint32Array(2)).join('');
  const message = [
    'Sign in to Chog World',
    '',
    `Wallet: ${address}`,
    `Network: ${MONAD_TESTNET.name} (${MONAD_TESTNET.id})`,
    `Nonce: ${nonce}`,
    `Issued: ${new Date().toISOString()}`,
    '',
    'This is a free signature. It does not send a transaction or move anything.',
  ].join('\n');
  const signature = await wallet.signMessage({ account: address, message });
  return { message, signature };
}

const read = (functionName, args) => reader.readContract({ address: CHOG_CONTRACT, abi: ABI, functionName, args });

/** The testnet Chog ids a wallet holds (one free read). */
export async function tokensOf(address) {
  return (await read('tokensOf', [address])).map(Number);
}

/** Whether the wallet still owns this Chog right now. */
export async function owns(address, id) {
  try {
    return (await read('ownerOf', [BigInt(id)])).toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Watch for Chogs leaving a wallet: every few seconds, look for Transfer(from = address) in the blocks
 * since the last look. onTransfer(id, to) runs for each one. Returns a function that stops watching.
 */
export function watchTransfersFrom(address, onTransfer, everyMs = 3000) {
  let from = null;
  let stopped = false;
  let timer = 0;
  const tick = async () => {
    try {
      const latest = await reader.getBlockNumber();
      if (from === null) from = latest + 1n;
      // If the tab slept, only look back a little: the ownership check covers anything older.
      if (latest - from > 400n) from = latest - 400n;
      if (latest >= from) {
        const logs = await reader.getLogs({ address: CHOG_CONTRACT, event: TRANSFER, args: { from: address }, fromBlock: from, toBlock: latest });
        from = latest + 1n;
        for (const log of logs) onTransfer(Number(log.args.tokenId), log.args.to);
      }
    } catch (err) {
      console.warn('Transfer watch:', err?.shortMessage ?? err?.message ?? err);
    }
    if (!stopped) timer = setTimeout(tick, everyMs);
  };
  timer = setTimeout(tick, 0);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
