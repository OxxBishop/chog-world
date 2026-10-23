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
export const FAUCET_URL = 'https://faucet.monad.xyz';
export const EXPLORER_URL = 'https://testnet.monadexplorer.com';

const ABI = parseAbi([
  'function tokensOf(address who) view returns (uint256[])',
  'function ownerOf(uint256 id) view returns (address)',
  'function claims(address who) view returns (uint256)',
  'function claimRandom() returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');

export const reader = createPublicClient({ chain: MONAD_TESTNET, transport: http() });

/**
 * Wallets in the browser. Each announces itself (EIP-6963); an older single injected wallet is used
 * if none do. Then WalletConnect, for a wallet app on a phone (a QR code on a laptop, a tap on a phone),
 * when the site has a WalletConnect project id. On a phone with no wallet in its browser, also a way to
 * open the site in MetaMask's own browser. Resolves to [{ name, icon, provider }].
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
      if (WC_PROJECT) list.push({ name: 'WalletConnect', icon: PHONE_ICON, provider: walletConnect() });
      if (!list.some((w) => w.provider !== wcProvider) && PHONE) list.push({ name: 'Open in MetaMask', icon: null, provider: openIn(`https://metamask.app.link/dapp/${location.host}${location.pathname}${location.search}`) });
      resolve(list);
    }, waitMs);
  });
}

// ---------- WalletConnect ----------
// The project id from dashboard.reown.com, set in Vercel as VITE_WALLETCONNECT_PROJECT_ID (it is public:
// it names the app to the relay, it unlocks nothing). Without it there's no WalletConnect option.
// (Trimmed of spaces and quotes, in case they came along when it was pasted in.)
const WC_PROJECT = String(import.meta.env?.VITE_WALLETCONNECT_PROJECT_ID ?? '').trim().replace(/^['"]+|['"]+$/g, '');
const PHONE = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
const PHONE_ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#c9b6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2.5" width="10" height="19" rx="2.5"/><path d="M9 18.5h2"/><path d="M18 8.5a5 5 0 0 1 0 7M20.5 6a8.5 8.5 0 0 1 0 12"/></svg>')}`;
let wcProvider = null;
/**
 * An EIP-1193 provider for WalletConnect that downloads the real one (large) only when it's first used:
 * asked for accounts it opens WalletConnect's own window (the QR code, or the wallet apps on a phone),
 * and asks for Monad testnet, which the wallet can add if it doesn't know it yet.
 */
function walletConnect() {
  if (wcProvider) return wcProvider;
  let real = null;
  const waiting = [];
  // Started once; if it fails it starts afresh on the next try (it kept the failure until a reload), and
  // if it hasn't reached WalletConnect's servers in 30 s it says so rather than wait for ever.
  const load = () =>
    (real ??= import('@walletconnect/ethereum-provider').then(async ({ EthereumProvider }) => {
      const init = EthereumProvider.init({
        projectId: WC_PROJECT,
        optionalChains: [MONAD_TESTNET.id],
        rpcMap: { [MONAD_TESTNET.id]: MONAD_TESTNET.rpcUrls.default.http[0] },
        showQrModal: true,
        metadata: { name: 'Chog World', description: 'Your Chog comes alive on Monad testnet.', url: location.origin, icons: [`${location.origin}/art/43.webp`] },
      });
      const p = await Promise.race([init, new Promise((_, no) => setTimeout(() => no(new Error('WalletConnect could not start: no answer from its relay in 30 s')), 30000))]);
      for (const [ev, fn] of waiting.splice(0)) p.on(ev, fn);
      return p;
    }).catch((err) => {
      real = null;
      throw err;
    }));
  wcProvider = {
    async request(args) {
      return (await load()).request(args);
    },
    on(ev, fn) {
      if (real) real.then((p) => p.on(ev, fn));
      else waiting.push([ev, fn]);
    },
    removeListener(ev, fn) {
      real?.then((p) => p.removeListener(ev, fn));
    },
    async disconnect() {
      if (real) await (await real).disconnect().catch(() => {});
    },
  };
  return wcProvider;
}

// A stand-in that opens the site in a wallet app's own browser (where the wallet is built in).
function openIn(url) {
  return {
    request() {
      location.href = url;
      return new Promise(() => {});
    },
  };
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

/** How many more Chogs this wallet may claim (three each). */
export async function claimsLeft(address) {
  return Math.max(0, 3 - Number(await read('claims', [address])));
}

/** Claim a random free testnet Chog. Needs a little testnet MON for gas. Resolves to its id. */
export async function claimRandom({ wallet, address }) {
  await toTestnet(wallet);
  const hash = await wallet.writeContract({ account: address, chain: MONAD_TESTNET, address: CHOG_CONTRACT, abi: ABI, functionName: 'claimRandom' });
  const receipt = await reader.waitForTransactionReceipt({ hash });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CHOG_CONTRACT) continue;
    // Transfer(from 0, to, id): the id is the third topic.
    if (log.topics.length === 4 && BigInt(log.topics[1]) === 0n) return Number(BigInt(log.topics[3]));
  }
  throw new Error('Claimed, but the new Chog could not be read from the receipt.');
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
