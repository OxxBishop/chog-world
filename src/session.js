import { chogInfo, loadChogs, DEMO_CHOG, homeFor } from './chogdata.js';
import { makeChog } from './chog.js';
import { playWake } from './cutscenes.js';

/*
 * Signing in and waking your Chog. Connect a wallet on Monad testnet, sign a free message, pick one of
 * your Chogs, and it wakes in its home. While you're in, the world watches the chain: if that Chog
 * leaves your wallet, it goes grey and you're signed out. Guests can claim a testnet Chog (free, with
 * a little testnet MON for gas) or try a demo Chog with a button that acts out a sale.
 *
 * The chain code (viem) loads only when someone connects, so it costs nothing at start-up.
 */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = (a) => `${a.slice(0, 6)}...${a.slice(-4)}`;
const chain = () => import('./chain.js');

export function initSession(world) {
  const panel = $('signin');
  const body = panel.querySelector('.signin-body');
  let session = null; // { address, wallet, provider, demo, id, chog, room, stopWatch }
  let busy = false;

  const open = () => {
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add('on'));
  };
  const close = () => {
    panel.classList.remove('on');
    setTimeout(() => (panel.hidden = true), 250);
  };
  panel.querySelector('.signin-close').addEventListener('click', () => !busy && close());
  panel.addEventListener('click', (e) => e.target === panel && !busy && close());

  const view = (html) => {
    body.innerHTML = html;
    return body;
  };
  const step = (text, sub = '') => view(`<div class="signin-step"><span class="spinner" aria-hidden="true"></span><p>${esc(text)}</p>${sub ? `<p class="muted">${esc(sub)}</p>` : ''}</div>`);
  const problem = (err) => {
    const msg = err?.shortMessage ?? err?.message ?? String(err);
    if (/reject|denied|cancel/i.test(msg)) return 'You cancelled in your wallet.';
    if (/insufficient|funds|gas/i.test(msg)) return 'Not enough testnet MON for gas. Get some from the faucet, then try again.';
    if (/ClaimLimit/i.test(msg)) return 'This wallet has claimed its three Chogs already.';
    return msg.split('\n')[0].slice(0, 160);
  };

  // ---------- the first screen ----------
  async function start(note = '') {
    const { findWallets } = await chain();
    const wallets = await findWallets();
    const list = wallets.length
      ? wallets.map((w, i) => `<button class="wallet" data-i="${i}">${w.icon ? `<img src="${esc(w.icon)}" alt="">` : ''}<span>${esc(w.name)}</span></button>`).join('')
      : '<p class="muted">No wallet found in this browser.</p>';
    const el = view(`
      <h2>Bring your Chog home</h2>
      <p>Connect a wallet on Monad testnet to wake the Chogs you hold. Signing in is free and never sends a transaction.</p>
      ${note ? `<p class="note">${esc(note)}</p>` : ''}
      <div class="wallets">${list}</div>`);
    el.querySelectorAll('.wallet').forEach((b) => b.addEventListener('click', () => signIn(wallets[Number(b.dataset.i)].provider)));
  }

  // ---------- signing in ----------
  async function signIn(provider) {
    busy = true;
    try {
      const c = await chain();
      step('Opening your wallet', 'Approve the connection, and the switch to Monad Testnet if it asks.');
      const conn = await c.connect(provider);
      step('Sign the message in your wallet', 'It is free and does not send anything.');
      const signed = await c.signIn(conn);
      step('Finding your Chogs');
      const [ids] = await Promise.all([c.tokensOf(conn.address), loadChogs()]);
      session = { ...conn, ...signed, demo: false };
      provider.on?.('accountsChanged', onAccountsChanged);
      busy = false;
      await picker(ids);
    } catch (err) {
      busy = false;
      await start(problem(err));
    }
  }

  function onAccountsChanged(accounts) {
    if (session && !session.demo && accounts?.[0]?.toLowerCase() !== session.address.toLowerCase()) signOut('You switched wallets, so you were signed out.');
  }

  // ---------- picking a Chog ----------
  async function picker(ids) {
    if (!ids.length) {
      view(`<h2>No Chogs here yet</h2><p>${esc(short(session.address))} doesn't hold a testnet Chog.</p>`);
      return;
    }
    const infos = await Promise.all(ids.map(chogInfo));
    const cards = infos
      .map(
        (c) => `<li class="chog-card">
          <img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy">
          <div><strong>${esc(c.name)}</strong><span class="tier">${esc(c.traits.Tier ?? '')}</span></div>
          <p class="muted small">${esc([c.traits.Head, c.traits.Body, c.traits.Aura].filter(Boolean).join(' · '))}</p>
          <button class="primary wake" data-id="${c.id}">Wake</button>
        </li>`,
      )
      .join('');
    const el = view(`
      <h2>Your Chogs</h2>
      <p class="muted">${esc(short(session.address))} on Monad Testnet. Pick one to wake in its home.</p>
      <ul class="chog-cards">${cards}</ul>`);
    el.querySelectorAll('.wake').forEach((b) => b.addEventListener('click', () => wake(Number(b.dataset.id))));
  }

  // ---------- waking ----------
  async function wake(id) {
    busy = true;
    try {
      if (!session.demo) {
        step(`Checking Chog #${id} is still yours`);
        const c = await chain();
        if (!(await c.owns(session.address, id))) {
          busy = false;
          await picker(await c.tokensOf(session.address));
          body.insertAdjacentHTML('afterbegin', `<p class="note">Chog #${id} isn't in this wallet any more.</p>`);
          return;
        }
      }
      const info = await chogInfo(id);
      const chog = await makeChog(info);
      const home = homeFor(id, world.homes.length);
      const room = world.homes[home];
      room.room.group.add(chog.root);
      session.id = id;
      session.info = info;
      session.chog = chog;
      session.room = room;
      busy = false;
      close();
      showChip();
      world.enterRoom(room);
      await playWake({ chog, name: info.name });
    } catch (err) {
      busy = false;
      await start(problem(err));
    }
  }

  // ---------- signed in ----------
  function showChip() {
    const chip = $('chog-chip');
    const s = session;
    chip.innerHTML = `
      ${s.info.image ? `<img src="${esc(s.info.image)}" alt="">` : ''}
      <div><strong>${esc(s.info.name)}</strong><span class="muted small">${esc(short(s.address))}</span></div>
      <button class="home">Home</button>
      <button class="out">Sign out</button>`;
    chip.hidden = false;
    $('btn-signin').hidden = true;
    chip.querySelector('.home').addEventListener('click', () => world.enterRoom(s.room));
    chip.querySelector('.out').addEventListener('click', () => signOut());
  }

  function signOut(note) {
    const s = session;
    session = null;
    if (s) {
      s.stopWatch?.();
      clearInterval(s.ownerCheck);
      s.provider?.removeListener?.('accountsChanged', onAccountsChanged);
      if (s.chog) {
        s.chog.root.removeFromParent();
        s.chog.dispose();
      }
      if (s.room && world.currentRoom() === s.room) world.leaveToOverview();
    }
    $('chog-chip').hidden = true;
    $('btn-signin').hidden = false;
    if (note) {
      open();
      start(note);
    }
  }

  $('btn-signin').addEventListener('click', () => {
    open();
    start();
  });

  return {
    update(dt) {
      if (session?.chog && session.room.room.group.visible) session.chog.update(dt, world.camera);
    },
    get active() {
      return session;
    },
    // Hooks for tests and for the lobby's wallet wall.
    open: () => {
      open();
      start();
    },
  };
}
