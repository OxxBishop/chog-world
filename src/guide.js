import { SPRITE, PAL } from './pixelloader.js';
import { perksFor } from './casinoperks.js';
import { islandPerksFor } from './islandperks.js';

/*
 * The guide (the user, 10-23): the loading screen's pixel Chog, small, in a gold ring on the left, hopping
 * and waving. Tap it and it tells you everything in one place, in three tabs:
 *   Welcome  getting about, and what's on the islands
 *   Quests   the star hunt, the race, the cast's asks, the daily hello, testnet $CHOG, all as they stand
 *   Traits   your Chog's traits and what each one gives it (its edges at the tables, its $CHOG rate, its
 *            perks round the islands: src/islandperks.js)
 * Quests and Traits have buttons of their own under it. It opens by itself on your first visit.
 *
 * createGuide({ travel, session, purse, stars, quests }) -> { open(tab), welcome(info) }
 */

const KEY = 'chogworld.guide.v1';
const read = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
};
const write = (v) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {}
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// On a computer, every key the game listens to (the user, 10-23: so testers know what to do).
const key = (...k) => k.map((x) => `<kbd>${x}</kbd>`).join('');
const KEYS = `
      <h4>Keyboard</h4>
      <div class="pl-keys">
        <span>${key('W', 'S')}</span><em>walk forward and back (or the arrow keys)</em>
        <span>${key('A', 'D')}</span><em>steer</em>
        <span>${key('Shift')}</span><em>run</em>
        <span>${key('Q', 'E')}</span><em>turn the view (or drag with the mouse; scroll to zoom)</em>
        <span>${key('F')}</span><em>hop on or off a hoverboard</em>
        <span>${key('M')}</span><em>the map</em>
        <span>${key('Space', 'C')}</span><em>float up and down in Cosmo's dome</em>
        <span>${key('Esc')}</span><em>close a panel, or step back</em>
        <span>${key('Space')}</span><em>at the casino: spin</em>
        <span>${key('1', '5')}</span><em>at the casino: pick a chip</em>
      </div>`;
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const ICON = {
  quests: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h9l3 3V20.5H6z"/><path d="M15 3.5v3h3"/><path d="M9 11h6M9 14.5h6M9 18h3.5"/></svg>',
  traits: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 16.1l-5.1 2.8 1.1-5.7-4.3-4 5.8-.7z"/></svg>',
};

// The pixel Chog, drawn crisp onto a small canvas; and a little hand beside it, waving.
function drawChog(canvas, scale = 2) {
  const rows = SPRITE.trim().split('\n');
  const w = rows[0].length, h = rows.length;
  canvas.width = w * scale;
  canvas.height = h * scale;
  const g = canvas.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '.') return;
    g.fillStyle = PAL[c] ?? '#000';
    g.fillRect(x * scale, y * scale, scale, scale);
  }));
}

// Its hand, a little mitten in the same pixels.
const HAND = `
.o.o...
oLoLo..
oLLLLo.
oLLLLLo
oLLLLo.
.oLLo..
..oo...`;
function drawHand(canvas, scale = 2) {
  const rows = HAND.trim().split('\n');
  canvas.width = rows[0].length * scale;
  canvas.height = rows.length * scale;
  const g = canvas.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '.') return;
    g.fillStyle = PAL[c] ?? '#000';
    g.fillRect(x * scale, y * scale, scale, scale);
  }));
}

export function createGuide({ travel, session, purse, stars, quests }) {
  const saved = read();
  // ---------- the buttons on the left ----------
  const dock = document.createElement('div');
  dock.className = 'pl-dock';
  dock.innerHTML = `
    <button type="button" class="cel pl-guide-btn" aria-label="Guide"><span class="cel-well pl-guide-well"><canvas></canvas><canvas class="pl-hand"></canvas></span><span class="cel-lb">Guide</span></button>
    <button type="button" class="cel" data-tab="quests" aria-label="Quests"><span class="cel-well">${ICON.quests}</span><span class="cel-lb">Quests</span></button>
    <button type="button" class="cel" data-tab="traits" aria-label="Traits"><span class="cel-well">${ICON.traits}</span><span class="cel-lb">Traits</span></button>`;
  document.body.append(dock);
  drawChog(dock.querySelector('canvas'), 2);
  drawHand(dock.querySelector('.pl-hand'), 2);
  dock.addEventListener('pointerdown', (e) => e.stopPropagation());
  dock.querySelector('.pl-guide-btn').addEventListener('click', () => open('welcome'));
  dock.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => open(b.dataset.tab)));

  // ---------- the panel ----------
  const panel = document.createElement('div');
  panel.className = 'pl-guide';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="pl-guide-card" role="dialog" aria-label="Guide">
      <div class="pl-guide-head"><canvas></canvas><div><b>Chog World</b><span class="pl-guide-sub"></span></div><button type="button" class="pl-x" aria-label="Close">×</button></div>
      <div class="pl-tabs" role="tablist"><button data-tab="welcome">Welcome</button><button data-tab="quests">Quests</button><button data-tab="traits">Traits</button></div>
      <div class="pl-guide-body"></div>
    </div>`;
  document.body.append(panel);
  drawChog(panel.querySelector('canvas'), 3);
  const body = panel.querySelector('.pl-guide-body');
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  panel.addEventListener('click', (e) => e.target === panel && close());
  panel.querySelector('.pl-x').addEventListener('click', () => close());
  panel.querySelectorAll('.pl-tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  addEventListener('keydown', (e) => e.key === 'Escape' && !panel.hidden && close());

  const touch = matchMedia('(pointer: coarse)').matches;
  const mine = () => {
    const s = session()?.active;
    if (s?.info) return { name: s.info.name, id: s.info.id ?? s.id, traits: s.info.traits ?? {}, own: !s.demo, demo: !!s.demo };
    const v = travel.guest;
    if (v) return { name: v.name, id: v.id, traits: v.traits ?? {}, guest: true };
    const c = travel.chog;
    const id = Number(String(c?.name ?? '').match(/#(\d+)/)?.[1]) || 7;
    return { name: c?.name ?? 'your Chog', id, traits: c?.traits ?? {}, guest: true };
  };

  function welcome() {
    const m = mine();
    const who = m.guest
      ? `You're visiting as <b>${esc(m.name)}</b>, one of the collection. Sign in with your wallet (free, testnet) and your own Chog wakes up in its dome to walk with you.`
      : `This is <b>${esc(m.name)}</b>${m.demo ? ', the demo Chog' : ''}. It lives in its own glass dome: tap <b>Home</b> to visit, <b>Talk</b> to chat. It has a personality from its traits and remembers what you tell it.`;
    return `
      <p class="pl-lead">Hi! I'm the island's guide. Tap me any time.</p>
      <p>${who}</p>
      <h4>Getting about</h4>
      <ul>
        <li>${touch ? 'Walk with the stick at the bottom left; push it all the way to run. Drag anywhere else to look round, pinch to zoom.' : 'W and S walk, A and D steer, Shift runs. Drag to look round, scroll to zoom. Every key is listed below.'}</li>
        <li>Hop on a <b>hoverboard</b>: one waits by every dome's door, and goes twice as fast.</li>
        <li>Step onto a glowing <b>portal</b> to travel between islands.</li>
        <li>Tap the map for the whole archipelago. <b>Postcard</b> frames the moment.</li>
      </ul>
      ${touch ? '' : KEYS}
      <h4>On the islands</h4>
      <ul>
        <li><b>Chog Hub</b>: the lobby, the bar, and the Starlite Lounge casino on free testnet chips, where every trait is an edge.</li>
        <li>The cast each have a place: King Pom's throne by the fountain, Quackers' flower arch, the singer on her stage, Snooze under the giant tree, Petal's garden, Cosmo floating in his dome, Toasty's campfire, Dash on the bridge, Patrol on his chopper.</li>
        <li>Things to do, and testnet $CHOG to earn: see <b>Quests</b>. What your Chog's traits give it: see <b>Traits</b>.</li>
      </ul>`;
  }

  function questsTab() {
    const q = quests?.status?.() ?? [];
    const st = (x) => (x.state === 'done' ? '<em class="ok">Done today</em>' : x.state === 'active' ? `<em class="on">${x.got} of ${x.need}</em>` : '<em>Open</em>');
    const where = { firewood: 'Beacon island, at his campfire', can: 'the tree island, in her garden', flower: 'the plaza, on his throne' };
    let race = {};
    try {
      race = JSON.parse(localStorage.getItem('chogworld.race.v1') || '{}');
    } catch {}
    const p = purse?.today ?? { got: 0, cap: 150, rate: 1, hello: false };
    const found = stars?.found ?? 0, total = stars?.total ?? 12;
    return `
      <div class="pl-bal"><span>${(purse?.balance ?? 0).toLocaleString('en')}</span> testnet $CHOG <small>${p.got} of ${p.cap} earned today${p.rate > 1 ? `, at ${p.rate}x for your Chog's rarity` : ''}</small></div>
      <ul class="pl-qlist">
        <li><b>Star hunt</b><em class="${found === total ? 'ok' : 'on'}">${found} of ${total}</em><span>Twelve stars drift round the islands, each by its column of light${p.perks?.sense ? ' (your Chog senses the ones near you on the map)' : ''}. Get close and they dart away: run them down. ${10 + (p.perks?.star ?? 0)} $CHOG each, 50 more for all twelve, and a Chog lights up in the sky.</span></li>
        <li><b>Race Patrol</b><em>${race.best ? `Best ${fmt(race.best)}` : 'Not raced yet'}</em><span>On a hoverboard, ride into the arch where the first bridge meets the loop. Beat him for 25 $CHOG (once a day, 5 after).${p.perks?.head ? ` With your Chog's quick start he waits ${p.perks.head} s at Go.` : ''}</span></li>
        ${q.map((x) => `<li><b>${esc(x.title)}</b>${st(x)}<span>Find ${esc(x.giver)} on ${where[x.id] ?? 'the islands'}. ${x.reward + (p.perks?.quest ?? 0)} $CHOG.</span></li>`).join('')}
        <li><b>Daily hello</b><em class="${p.hello ? 'ok' : ''}">${p.hello ? 'Done today' : 'Come back tomorrow'}</em><span>Your Chog says gm the first time you're out each day. ${15 + (p.perks?.hello ?? 0)} $CHOG.</span></li>
      </ul>
      <h4>Spend it</h4>
      <ul>
        <li>A wish at the plaza's <b>fountain</b>: 5 $CHOG and a small surprise${p.perks?.wish ? ' (the first each day is free with your lucky charm)' : ''}.</li>
        <li>A <b>song request</b> for the singer: 10 $CHOG, her song from the top.</li>
        <li>Chips at the <b>casino</b>: cash in 10 $CHOG for 100 testnet chips, by your chips at the tables.</li>
      </ul>
      <p class="pl-fine">Testnet $CHOG lives in the game only, kept on this device. It never touches a chain.</p>`;
  }

  function traitsTab() {
    const m = mine();
    const t = m.traits ?? {};
    const p = perksFor(t, m.id);
    const rate = purse?.today?.rate ?? 1;
    const isle = islandPerksFor(t);
    const shown = ['Tier', 'Head', 'Eyes', 'Body', 'Mouth', 'Accessory', 'Aura', 'Background', 'Skin'].filter((k) => t[k] && t[k] !== 'None');
    return `
      <p>${m.guest ? `The traits of <b>${esc(m.name)}</b>, who you're visiting as. Signed in, it's your own Chog's.` : `<b>${esc(m.name)}</b>'s traits, and what they give it.`}</p>
      <div class="pl-traits">${shown.map((k) => `<span><small>${k}</small>${esc(t[k])}</span>`).join('') || '<span>No traits on record</span>'}</div>
      <h4>Edges at the tables</h4>
      <ul class="pl-edges">${p.list.map((e) => `<li><b>${esc(e.name)}</b> <small>${esc(e.trait)}</small><span>${esc(e.text)}</span></li>`).join('')}</ul>
      <h4>Round the islands</h4>
      <ul class="pl-edges">
        <li><b>Rarity</b> <small>${esc(t.Tier ?? 'Common')}</small><span>testnet $CHOG at ${rate}x (1x to 1.5x by tier, 2x for a 1:1)</span></li>
        ${isle.list.map((e) => `<li><b>${esc(e.name)}</b> <small>${esc(e.trait)}</small><span>${esc(e.text)}</span></li>`).join('')}
      </ul>
      <ul>
        <li>The cast notice its look, and light up when you share a trait with them.</li>
        <li>Its chat personality comes from its traits.</li>
      </ul>`;
  }

  let tab = 'welcome';
  function show(name) {
    tab = name;
    panel.querySelectorAll('.pl-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    body.innerHTML = name === 'quests' ? questsTab() : name === 'traits' ? traitsTab() : welcome();
    body.scrollTop = 0;
    const m = mine();
    panel.querySelector('.pl-guide-sub').textContent = name === 'traits' ? m.name : name === 'quests' ? 'Things to do' : 'Your guide';
  }
  function open(name = 'welcome') {
    show(name);
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add('on'));
  }
  function close() {
    panel.classList.remove('on');
    setTimeout(() => (panel.hidden = true), 220);
    if (!saved.seen) {
      saved.seen = true;
      write(saved);
    }
  }

  return {
    open,
    // Once you're out walking the first time: it says hello.
    welcome() {
      if (saved.seen) return;
      setTimeout(() => open('welcome'), 1200);
    },
  };
}
