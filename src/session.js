import { chogInfo, loadChogs, DEMO_CHOG, homeFor, artFallbacks, workingArt } from './chogdata.js';
import { makeChog } from './chog.js';
import { modelFor } from './traitmap.js';
import { prepareWake, playWake, playGreyOut, playLogoff, playWalkIn, playWalkOut, playArrival, SPOT } from './cutscenes.js';
import { talk } from './brain.js';
import { createChat } from './chat.js';
import { createBarChat } from './barchat.js';
import * as THREE from 'three';

/*
 * Signing in and waking your Chog. Connect a wallet on Monad testnet, sign a free message, pick one of
 * your Chogs, and it wakes in its home. While you're in, the world watches the chain: if that Chog
 * leaves your wallet, it goes grey and you're signed out. Guests can claim a testnet Chog (free, with
 * a little testnet MON for gas) or try a demo Chog with a button that acts out a sale.
 *
 * The chain code (viem) loads only when someone connects, so it costs nothing at start-up.
 *
 * Two ways in. With the first screen (B11's src/intro.js), startIntro() drives it through sign-in:
 * connect, the wallet's steps, the search, "Welcome, <name>", then world.intro.flyHome(room) and your
 * Chog steps out of its pod and says hello. Sign in later brings that screen back over space. Without
 * it (?nointro, a view link), the Sign in button opens the panel here and the Chog wakes on its bed.
 */

// Hellos for when the brain isn't up (or is slow): it says one of these instead.
const HELLOS = [
  'Hey, you made it! I kept the place warm.',
  'Oh hi! I was just watching the clouds roll by.',
  'There you are! Welcome home.',
  'You\'re here! I was starting to count the clouds.',
];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = (a) => `${a.slice(0, 6)}...${a.slice(-4)}`;
const chain = () => import('./chain.js');

export function initSession(world) {
  const panel = $('signin');
  const body = panel.querySelector('.signin-body');
  let session = null; // { address, wallet, provider, demo, id, chog, room, stopWatch }
  let busy = false;
  // Where the Chog is, for the brain to know what it's looking at.
  const placeName = () => {
    const here = world.currentRoom();
    if (here && here === session?.room) return 'at home in its dome';
    if (here) return `in the ${here.name}`;
    return 'out on the islands of Chog World';
  };
  const chat = createChat({ camera: world.camera, getSession: () => session, placeName });
  // Your Chog comes along to the bar and chats with the regulars there.
  const bar = createBarChat({ world, getMine: () => (session?.chog ? session : null), sendHome: (s) => sendHome(s) });
  const ray = new THREE.Raycaster();

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
      : '<p class="muted">No wallet found in this browser. You can still try a demo Chog.</p>';
    const el = view(`
      <h2>Bring your Chog home</h2>
      <p>Connect a wallet on Monad testnet to wake the Chogs you hold. Signing in is free and never sends a transaction.</p>
      ${note ? `<p class="note">${esc(note)}</p>` : ''}
      <div class="wallets">${list}</div>
      <button class="ghost demo">Try a demo Chog</button>`);
    el.querySelectorAll('.wallet').forEach((b) => b.addEventListener('click', () => signIn(wallets[Number(b.dataset.i)].provider)));
    el.querySelector('.demo').addEventListener('click', () => demo());
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
  async function picker(ids, onPick = wake) {
    const { FAUCET_URL } = await chain();
    if (!ids.length) {
      const el = view(`
        <h2>No Chogs here yet</h2>
        <p>${esc(short(session.address))} doesn't hold a testnet Chog. Claim one free, or try the demo.</p>
        <button class="primary claim">Claim a Chog</button>
        <p class="muted small">Claiming is a testnet transaction, so it needs a little testnet MON for gas. <a href="${FAUCET_URL}" target="_blank" rel="noopener">Get MON from the faucet</a>.</p>
        <button class="ghost demo">Try a demo Chog</button>`);
      el.querySelector('.claim').addEventListener('click', claim);
      el.querySelector('.demo').addEventListener('click', () => demo());
      return;
    }
    const infos = await Promise.all(ids.map(chogInfo));
    const cards = infos
      .map(
        (c) => `<li class="chog-card">
          <img src="${esc(c.image)}" data-alt="${esc(c.images.slice(1).join(' '))}" alt="${esc(c.name)}" loading="lazy">
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
    artFallbacks(el);
    el.querySelectorAll('.wake').forEach((b) => b.addEventListener('click', () => onPick(Number(b.dataset.id))));
  }

  async function claim() {
    busy = true;
    try {
      const c = await chain();
      step('Confirm the claim in your wallet', 'A free testnet Chog. Gas is paid in testnet MON.');
      const id = await c.claimRandom(session);
      step(`Chog #${id} is yours`, 'Loading your Chogs');
      busy = false;
      await picker(await c.tokensOf(session.address));
    } catch (err) {
      busy = false;
      const { FAUCET_URL } = await chain();
      const el = view(`<h2>Couldn't claim</h2><p class="note">${esc(problem(err))}</p>
        <p class="muted small"><a href="${FAUCET_URL}" target="_blank" rel="noopener">Get testnet MON from the faucet</a></p>
        <button class="primary claim">Try again</button><button class="ghost demo">Try a demo Chog</button>`);
      el.querySelector('.claim').addEventListener('click', claim);
      el.querySelector('.demo').addEventListener('click', () => demo());
    }
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
      step(`Waking ${info.name}`);
      await settle(info);
      const { chog, room } = session;
      busy = false;
      close();
      showChip();
      world.enterRoom(room);
      await playWake({ chog, name: info.name });
      if (!session.demo) watch();
    } catch (err) {
      busy = false;
      await start(problem(err));
    }
  }

  // Make the Chog and put it in its home, ready to be shown (it stays out of sight until then).
  async function settle(info) {
    const s = session;
    // Your Chog in the world is its rigged model at full detail (its own, or the plain body in its skin's
    // shade); the art stays in the panel and the chip.
    const chog = await makeChog({ ...info, ...modelFor(info.id, info.traits) });
    // Its art first if it comes quickly; otherwise it shows its name and the art follows.
    await Promise.race([chog.ready, new Promise((r) => setTimeout(r, 8000))]);
    const room = world.homes[homeFor(info.id, world.homes.length)];
    room.room.group.add(chog.root);
    prepareWake(chog);
    await world.prewarm?.(room.room.group);
    Object.assign(s, { id: info.id, info, chog, room });
  }

  // ---------- the first screen's way in (A11) ----------
  let screen = null;
  const tell = (name, data = {}) => screen?.state(name, data);
  const step2 = (title, text) => tell('step', { title, text });
  // A guest: the screen goes, and the view flies down from space to the world.
  const guest = () => screen?.close().then(() => world.leaveSpace?.({ duration: 2.5 }));

  /**
   * The first screen's call to connect (src/main.js hands it over once the world has loaded; Sign in
   * brings it back). A button per wallet in the browser, and one for the demo Chog, so anyone without a
   * testnet Chog still gets the whole visit.
   */
  async function startIntro(s = screen, note = '') {
    screen = s;
    if (!screen) return;
    const { findWallets } = await chain();
    const wallets = await findWallets();
    tell('connect', {
      wallets: [...wallets.map((w) => ({ name: w.name, icon: w.icon, pick: () => arriveWith(w) })), { name: 'Try a demo Chog', icon: null, pick: () => demoArrival() }],
      guest,
      text: note || (wallets.length ? '' : 'No wallet in this browser. Try the demo Chog, or explore as a guest.'),
    });
  }

  async function arriveWith(w) {
    try {
      const c = await chain();
      step2('Approve in your wallet', 'Connect, and switch to Monad Testnet if it asks.');
      const conn = await c.connect(w.provider);
      step2('Sign the message', 'It is free and does not send anything.');
      const signed = await c.signIn(conn);
      session = { ...conn, ...signed, demo: false };
      w.provider.on?.('accountsChanged', onAccountsChanged);
      await search();
    } catch (err) {
      tell('error', { text: problem(err), retry: () => startIntro(), guest });
    }
  }

  // The running pixel Chog, until the wallet's Chogs are in.
  async function search() {
    const s = session;
    const c = await chain();
    tell('searching', { text: short(s.address) });
    const [ids] = await Promise.all([c.tokensOf(s.address), loadChogs()]);
    if (session !== s) return;
    if (!ids.length) {
      return tell('none', {
        text: `${short(s.address)} holds no testnet Chog yet. Claim one free: it takes a little testnet MON for gas, from faucet.monad.xyz.`,
        claim: () => claimThenSearch(),
        demo: () => demoArrival(),
        guest,
      });
    }
    if (ids.length === 1) return arrive(ids[0]);
    // Several: a card for each on the screen, to pick from.
    const infos = await Promise.all(ids.map(async (id) => {
      const info = await chogInfo(id);
      return { ...info, image: await workingArt(info.images) };
    }));
    if (session !== s) return;
    tell('pick', { chogs: infos.map(({ id, name, image }) => ({ id, name, image })), pick: (id) => arrive(id), guest });
  }

  async function claimThenSearch() {
    try {
      const c = await chain();
      step2('Confirm the claim', 'A free testnet Chog. Gas is paid in testnet MON.');
      await c.claimRandom(session);
      await search();
    } catch (err) {
      tell('error', { text: problem(err), retry: () => search(), guest });
    }
  }

  /** Try a demo Chog: #43 gets the same welcome, flight home and hello. */
  async function demoArrival() {
    session = { address: null, demo: true };
    await loadChogs();
    await arrive(DEMO_CHOG);
  }

  // "Welcome, <name>", the flight home, and your Chog steps out of its pod and says hello.
  async function arrive(id) {
    const s = session;
    try {
      const info = await chogInfo(id);
      tell('found', { name: info.name, image: await workingArt(info.images) });
      if (!s.demo && !(await (await chain()).owns(s.address, id))) {
        return tell('error', { text: `${info.name} isn't in this wallet any more.`, retry: () => search(), guest });
      }
      await settle(info);
      if (session !== s) return;
      const landed = await world.intro.flyHome(s.room);
      if (session !== s) return;
      showChip();
      await playArrival({ chog: s.chog, door: landed.door, camera: world.camera, hello: () => hello(s), say: (text, mood) => chat.greet(text, mood) });
      if (session === s && !s.demo) watch();
    } catch (err) {
      console.warn('Arrival:', err);
      tell('error', { text: problem(err), retry: () => (s.demo ? demoArrival() : search()), guest });
    }
  }

  // Its first words when you arrive: the brain's answer to your hello, or a line of its own if the
  // brain isn't up or takes too long.
  async function hello(s) {
    try {
      const out = await Promise.race([
        talk({ id: s.id, session: s.demo ? { demo: true } : { address: s.address, message: s.message, signature: s.signature }, text: 'Hi, I\'m here!', place: 'at home in its dome' }),
        new Promise((r) => setTimeout(r, 4000)),
      ]);
      if (out?.reply) return out;
    } catch {
      // Not up yet: its own line below.
    }
    return { reply: HELLOS[Math.floor(Math.random() * HELLOS.length)], mood: 'happy' };
  }

  // ---------- the sale watch ----------
  function watch() {
    const s = session;
    chain().then((c) => {
      if (session !== s) return;
      s.stopWatch = c.watchTransfersFrom(s.address, (id) => {
        if (session === s && id === s.id) sold();
      });
      // In case a transfer slipped past the log watch (a sleeping tab), check ownership now and then.
      s.ownerCheck = setInterval(async () => {
        if (session === s && s.id && !(await c.owns(s.address, s.id))) sold();
      }, 30000);
    });
  }

  async function sold() {
    const s = session;
    if (!s?.chog || s.leaving) return;
    s.leaving = true;
    chat.close();
    chat.hush();
    s.stopWatch?.();
    clearInterval(s.ownerCheck);
    if (world.currentRoom() !== s.room) {
      world.enterRoom(s.room);
      await new Promise((r) => setTimeout(r, 700));
    }
    // Out somewhere with you (in front of its pod, in a room): it's home for this.
    sendHome(s);
    $('chog-chip').hidden = true;
    await playGreyOut({ chog: s.chog, name: s.info.name, room: s.room, world });
    signOut(null, { toOverview: !screen, inSpace: !!screen });
    if (screen) {
      $('fade').classList.remove('on');
      startIntro();
    }
  }

  // ---------- guests ----------
  async function demo() {
    session = { address: null, demo: true };
    await wake(DEMO_CHOG);
  }

  // ---------- signed in ----------
  function showChip() {
    const chip = $('chog-chip');
    const s = session;
    chip.innerHTML = `
      ${s.info.image ? `<img src="${esc(s.info.image)}" data-alt="${esc(s.info.images.slice(1).join(' '))}" alt="">` : ''}
      <div><strong>${esc(s.info.name)}</strong><span class="muted small">${s.demo ? 'Demo Chog' : esc(short(s.address))}</span></div>
      <button class="talk">Talk</button>
      <button class="home">Home</button>
      ${s.demo ? '<button class="sale">Simulate sale</button>' : ''}
      <button class="out">Sign out</button>`;
    artFallbacks(chip);
    chip.hidden = false;
    $('btn-signin').hidden = true;
    chip.querySelector('.talk').addEventListener('click', () => (chat.isOpen ? chat.close() : chat.open()));
    chip.querySelector('.home').addEventListener('click', () => world.enterRoom(s.room));
    chip.querySelector('.out').addEventListener('click', () => logOff());
    chip.querySelector('.sale')?.addEventListener('click', () => sold());
  }

  // ---------- walking into rooms with you (A10) ----------
  // Back to its spot at home, from wherever it went with you.
  function sendHome(s) {
    if (session !== s || !s.chog) return;
    s.room.room.group.add(s.chog.root);
    s.chog.root.position.copy(SPOT);
    s.chog.root.rotation.y = 0.5;
    s.chog.root.scale.setScalar(1);
    s.chog.setFade(1);
    s.chog.play('idle');
  }

  // The doorway, in the room's space: the door entry.js gives ({ position, inward }, world), a world
  // point, or just inside the front door.
  const doorIn = (room, door) => {
    const p = door?.position ?? door;
    return p?.isVector3 ? room.room.group.worldToLocal(p.clone()).setY(0) : new THREE.Vector3(0, 0, room.room.d / 2 - 0.6);
  };

  // Where it stands in a room it walked into: out on the floor in the middle of the room's own view,
  // nearly three quarters of the way from the camera to what it looks at.
  function spotIn(room) {
    const g = room.room.group;
    const eye = g.worldToLocal(room.view.pos.clone());
    const look = g.worldToLocal(room.view.target.clone());
    return eye.lerp(look, 0.72).setY(0);
  }

  /**
   * Your Chog walks into a room with you (src/entry.js calls it as the view turns to the door).
   * Resolves once it stands in its spot facing you; skip() puts it there now, and chog is what the
   * camera follows. Null for a guest, so the view settles on the room's people instead (focusIn).
   */
  function walkIn(room, door, { delay = 0 } = {}) {
    const s = session;
    if (!s?.chog || s.leaving || !room || room === s.room) return null;
    const group = room.room.group;
    const from = doorIn(room, door);
    const to = room === world.bar ? bar.spotFor(s) : spotIn(room);
    group.add(s.chog.root);
    s.chog.root.scale.setScalar(1);
    const walk = playWalkIn({ chog: s.chog, group, from, to, camera: world.camera, delay });
    if (room === world.bar) bar.expect(walk.done);
    // In the bar the camera eases over to the pair as it arrives, so the view ends with both of them.
    const chog = room === world.bar ? bar.follow(s.chog.root, to) : s.chog.root;
    return Object.assign(walk.done, { skip: walk.skip, chog });
  }

  /** Where a guest's view settles in a room (src/entry.js): the bar's regulars, say (world). */
  function focusIn(room) {
    return room === world.bar ? bar.focusPoint() : null;
  }

  /** It walks back out of the room ahead of you. Resolves once it's out of the door. */
  async function walkOut(room, door) {
    const s = session;
    if (!s?.chog || !room || s.chog.root.parent !== room.room.group) return;
    if (room === world.bar) bar.release();
    await playWalkOut({ chog: s.chog, to: doorIn(room, door) });
    sendHome(s);
  }

  // Sign out with a goodbye: home if you're elsewhere, a wave, then out to the world from space.
  async function logOff() {
    const s = session;
    if (!s?.chog || s.leaving) return signOut();
    s.leaving = true;
    chat.close();
    chat.hush();
    $('chog-chip').hidden = true;
    if (world.currentRoom() !== s.room) {
      world.enterRoom(s.room);
      await new Promise((r) => setTimeout(r, 700));
    }
    sendHome(s);
    await playLogoff({ chog: s.chog, name: s.info.name, room: s.room, world });
    signOut(null, { toOverview: !screen, inSpace: !!screen });
    if (screen) startIntro();
  }

  function signOut(note, { toOverview = false, inSpace = false } = {}) {
    const s = session;
    session = null;
    chat.reset();
    if (s) {
      s.stopWatch?.();
      clearInterval(s.ownerCheck);
      s.provider?.removeListener?.('accountsChanged', onAccountsChanged);
      if (s.chog) {
        s.chog.root.removeFromParent();
        s.chog.dispose();
      }
      if (!inSpace && (toOverview || (s.room && world.currentRoom() === s.room))) world.leaveToOverview();
    }
    $('chog-chip').hidden = true;
    $('btn-signin').hidden = false;
    if (note) {
      open();
      start(note);
    }
  }

  $('btn-signin').addEventListener('click', () => {
    // With the first screen, signing in goes the way it did the first time: out to space, and connect.
    if (screen) {
      world.enterSpace?.({ duration: 1.6 });
      startIntro();
      return;
    }
    open();
    start();
  });

  // Your Chog's shaders, built for each kind of place it can stand (outside, the bar, the lobby, the
  // casino, a home) while the first screen is up, so walking in anywhere never stalls on them: the lights
  // inside each kind of room are part of its shaders. The plain body stands in for every Chog's (they all
  // share these shaders), with the sparkle, aura ring and mood badge.
  async function warmStandees() {
    if (!world.prewarm || !world.rooms) return;
    const t = await makeChog({ traits: { Aura: 'Purple' }, name: 'Chog', ...modelFor(0) });
    prepareWake(t);
    t.setMood('happy');
    const kinds = [null, world.bar, ...['lobby', 'casino'].map((id) => world.rooms.find((r) => r.id === id)), world.homes[0]];
    for (const r of kinds) {
      if (r === undefined) continue;
      const g = r?.room.group;
      const was = g?.visible;
      if (g) g.visible = true;
      const ready = world.prewarm(t.root);
      if (g) g.visible = was;
      await ready;
    }
    t.dispose();
  }
  // Resolves once they're warm: the loader waits for it (B12).
  const warmed = new Promise((r) => setTimeout(r, 300)).then(() => warmStandees()).catch((err) => console.warn('Standee warm-up:', err));

  return {
    update(dt) {
      bar.update(dt);
      const s = session;
      const parent = s?.chog?.root.parent;
      // Out in a room you've left, or out front of its pod when you go in: it goes home.
      if (parent && parent !== s.room.room.group && !s.leaving && (!parent.visible || world.currentRoom() === s.room)) sendHome(s);
      // The Chog moves wherever it is: at home, or out in a room with you.
      if (s?.chog?.root.parent?.visible) s.chog.update(dt, world.camera);
      chat.update(dt);
    },
    walkIn,
    walkOut,
    focusIn,
    warmed,
    startIntro,
    demo: demoArrival,
    // A tap on your Chog opens the chat. True if the tap was on it.
    tapChog(x, y) {
      const root = session?.chog?.root;
      if (!root || !root.visible || !root.parent?.visible) return false;
      ray.setFromCamera(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1), world.camera);
      if (!ray.intersectObject(root, true).length) return false;
      chat.open();
      return true;
    },
    chat,
    bar,
    get active() {
      return session;
    },
    // Hooks for tests and for the lobby's wallet wall.
    open: () => {
      open();
      start();
    },
    simulateSale: () => sold(),
  };
}
