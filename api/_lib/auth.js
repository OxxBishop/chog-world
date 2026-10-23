/*
 * Who is talking. A signed-in keeper sends the sign-in message and signature from src/chain.js
 * signIn(); the signature is checked here, the wallet named in the message must be the signer, the
 * message must be recent, and the wallet must own the Chog on Monad testnet right now. A guest talks
 * to the demo Chog with a random per-browser key and gets memories that expire after a day.
 */
import { createPublicClient, http, verifyMessage, parseAbi, getAddress } from 'viem';
import { parseSiweMessage } from 'viem/siwe';

const MONAD_TESTNET = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
};
export const CHOG_CONTRACT = '0x85a9ba85e5a3e87bab529c402140a87a72622b91';
export const DEMO_CHOG = 43;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

const reader = createPublicClient({ chain: MONAD_TESTNET, transport: http(undefined, { timeout: 10000, retryCount: 2 }) });
const ABI = parseAbi(['function ownerOf(uint256 id) view returns (address)']);

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function ownerOf(id) {
  try {
    return (await reader.readContract({ address: CHOG_CONTRACT, abi: ABI, functionName: 'ownerOf', args: [BigInt(id)] })).toLowerCase();
  } catch {
    return null;
  }
}

// The sites a sign-in may name: the live one, its Vercel previews, and a local dev server. SIGNIN_HOSTS (comma
// separated) adds others, such as a domain of its own.
const CHAIN_ID = 10143;
const HOSTS = ['chog-world.vercel.app', ...String(process.env.SIGNIN_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)];
function siteOk(domain) {
  const host = String(domain ?? '').toLowerCase();
  const name = host.replace(/:\d+$/, '');
  return HOSTS.includes(host) || HOSTS.includes(name) || /^chog-world[a-z0-9-]*\.vercel\.app$/.test(name) || name === 'localhost' || name === '127.0.0.1';
}

/**
 * Resolves to { keeper, demo } where keeper is the lowercase wallet (or "demo:<key>").
 * Throws AuthError when the proof doesn't hold.
 */
export async function whoIsTalking({ id, session }) {
  if (!session || typeof session !== 'object') throw new AuthError('Sign in first.');
  if (session.demo) {
    if (Number(id) !== DEMO_CHOG) throw new AuthError('Guests can only talk to the demo Chog.', 403);
    const key = String(session.demoKey || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
    if (key.length < 12) throw new AuthError('Missing demo key.', 400);
    return { keeper: `demo:${key}`, demo: true };
  }
  const { address, message, signature } = session;
  if (typeof message !== 'string' || typeof signature !== 'string' || typeof address !== 'string') throw new AuthError('Sign in first.');
  let wallet;
  try {
    wallet = getAddress(address);
  } catch {
    throw new AuthError('Bad wallet address.', 400);
  }
  // The standard sign-in (src/chain.js signIn): this site, Monad testnet, our statement. (The old message
  // of our own is still taken, for a sign-in from before the change.)
  let named, issued;
  if (/wants you to sign in with your Ethereum account/.test(message)) {
    const m = parseSiweMessage(message);
    if (m.chainId !== CHAIN_ID || !String(m.statement ?? '').startsWith('Sign in to Chog World') || !siteOk(m.domain)) throw new AuthError('That is not a Chog World sign-in.');
    named = m.address;
    issued = m.issuedAt instanceof Date ? m.issuedAt.getTime() : NaN;
  } else {
    if (!message.startsWith('Sign in to Chog World')) throw new AuthError('That is not a Chog World sign-in.');
    named = /^Wallet: (0x[0-9a-fA-F]{40})$/m.exec(message)?.[1];
    issued = Date.parse(/^Issued: (.+)$/m.exec(message)?.[1] ?? '');
  }
  if (!named || named.toLowerCase() !== wallet.toLowerCase()) throw new AuthError('That is not a Chog World sign-in.');
  if (!(issued > Date.now() - MAX_AGE_MS && issued < Date.now() + 5 * 60 * 1000)) throw new AuthError('Your sign-in has expired. Sign in again.');
  let ok = false;
  try {
    ok = await verifyMessage({ address: wallet, message, signature });
  } catch {
    ok = false;
  }
  if (!ok) throw new AuthError('The signature does not match the wallet.');
  const owner = await ownerOf(id);
  if (owner !== wallet.toLowerCase()) throw new AuthError('This wallet does not hold that Chog any more.', 403);
  return { keeper: wallet.toLowerCase(), demo: false };
}
