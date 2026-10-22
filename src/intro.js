/*
 * The intro: the first screen. A glitchy pixel screen that says welcome over the real load, then asks
 * you to connect a wallet (or explore as a guest), shows a pixel Chog running in circles while your
 * wallet is searched, and greets your Chog by name before the flight down to its home.
 *
 * Sign-in itself is A's (src/session.js); it drives this screen through state(name, data):
 *   'connect'   { wallets: [{ name, icon, pick() }], guest() }   the call to connect, a button per wallet
 *   'step'      { title, text }                                 a step that waits on the wallet
 *   'searching' { text }                                        the running Chog, until tokensOf answers
 *   'found'     { name, image }                                 "Welcome to Chog World", your Chog waiting
 *   'pick'      { chogs: [{ id, name, image }], pick(id), guest() }  a card per Chog in the wallet
 *   'none'      { claim(), demo(), guest(), text }              no Chog in this wallet
 *   'error'     { text, retry(), guest() }                      something failed
 * flyHome(room) (from src/arrival.js) tears the screen away and flies down to that home, once the
 * welcome has been up long enough to read (held()); close() just tears it away (a guest, say).
 * current says which state is up.
 *
 * The search and the welcome show the loading screen's pixel Chog (src/pixelloader.js, the user's own
 * design) in mint.
 */

import { ART, createLoaderArt, MINT } from './pixelloader.js';

const BASE = import.meta.env?.BASE_URL ?? '/';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function createRunner(canvas) {
  // The loading screen's pixel Chog, in mint, hopping round its ring (in place of the Chog's own art:
  // the user, 10-22). Same pixel grid as the loader, a little bigger.
  const dpr = window.devicePixelRatio || 1;
  const k = Math.max(1, Math.round((112 * dpr) / ART));
  Object.assign(canvas.style, { width: `${(ART * k) / dpr}px`, height: `${(ART * k) / dpr}px`, margin: '0' });
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const art = createLoaderArt(canvas, k, { calm, ...MINT });
  let raf = 0;
  const draw = (now) => {
    raf = requestAnimationFrame(draw);
    art.draw(now / 1000);
  };
  return {
    start() {
      if (!raf) raf = requestAnimationFrame(draw);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
    yours() {},
    reset() {},
  };
}

/*
 * The loading screen's Chog on its canvas, a whole number of device pixels to each of its pixels and
 * about 88 CSS pixels across. Drawn in a worker where the browser allows (it keeps going while the
 * load holds up the main thread), else here. Returns run(on) to play or pause it.
 */
function startLoader(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const k = Math.max(1, Math.round((88 * dpr) / ART));
  canvas.style.width = canvas.style.height = `${(ART * k) / dpr}px`;
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (canvas.transferControlToOffscreen && typeof Worker !== 'undefined') {
    try {
      const worker = new Worker(new URL('./pixelloader.worker.js', import.meta.url), { type: 'module' });
      const off = canvas.transferControlToOffscreen();
      worker.postMessage({ canvas: off, k, calm, run: true }, [off]);
      return (on) => worker.postMessage({ run: on });
    } catch {
      // Drawn here instead.
    }
  }
  const art = createLoaderArt(canvas, k, { calm });
  let id = 0;
  const tick = (now) => {
    id = requestAnimationFrame(tick);
    art.draw(now / 1000);
  };
  const run = (on) => {
    if (on && !id) id = requestAnimationFrame(tick);
    if (!on && id) {
      cancelAnimationFrame(id);
      id = 0;
    }
  };
  run(true);
  return run;
}

export function createIntro(el) {
  el.classList.add('intro');
  // index.html carries the same markup, so the screen is there from the first paint.
  if (!el.querySelector('.glitch')) el.innerHTML = `
    <div class="intro-still" aria-hidden="true"></div>
    <div class="intro-band" aria-hidden="true"></div>
    <div class="kicker">WELCOME TO</div>
    <div class="glitch" data-text="CHOG WORLD">CHOG WORLD</div>
    <canvas class="load-runner" aria-hidden="true"></canvas>
    <div class="sub" aria-live="polite">Waking the island...</div>
    <div class="stage" hidden></div>`;
  const kicker = el.querySelector('.kicker');
  const title = el.querySelector('.glitch');
  // While the world loads, the user's pixel Chog hops round its ring of dots (src/pixelloader.js).
  const loader = el.querySelector('.load-runner');
  const loaderRun = startLoader(loader);
  const sub = el.querySelector('.sub');
  const stage = el.querySelector('.stage');
  const runnerCanvas = document.createElement('canvas');
  runnerCanvas.className = 'runner';
  const runner = createRunner(runnerCanvas);
  let current = 'loading';
  // When the glitch welcome went up: it gets its moment before the screen tears away.
  let welcomeAt = 0;
  const WELCOME_MIN = 1800;

  const burst = () => {
    el.classList.remove('burst');
    void el.offsetWidth;
    el.classList.add('burst');
  };
  const setTitle = (k, text) => {
    if (title.dataset.text === text && kicker.textContent === k) return;
    kicker.textContent = k;
    title.textContent = text;
    title.dataset.text = text;
    burst();
  };
  const show = (html, { run = false } = {}) => {
    loader.hidden = true;
    loaderRun(false);
    sub.hidden = true;
    stage.hidden = false;
    stage.innerHTML = html;
    if (run) {
      stage.prepend(runnerCanvas);
      runner.start();
    } else runner.stop();
    burst();
    return stage;
  };
  const on = (sel, fn) => stage.querySelectorAll(sel).forEach((b, i) => b.addEventListener('click', () => fn(i)));

  const api = {
    el,
    get current() {
      return current;
    },
    // The load is done: the world shows through, dimmed.
    ready() {
      el.classList.add('ready');
      document.body.classList.add('intro-open');
    },
    // The planet itself is drawn behind the screen now: the still of it fades away.
    live() {
      el.classList.add('live');
    },
    // The loading screen again, its bar at f (0 to 1) under label, the world hidden: for the demo's
    // arrival shot (B13), which opens on it.
    loading(f, label) {
      current = 'loading';
      el.classList.remove('done', 'leaving', 'ready', 'live');
      document.body.classList.add('intro-open');
      runner.stop();
      stage.hidden = true;
      loader.hidden = false;
      loaderRun(true);
      sub.hidden = false;
      setTitle('WELCOME TO', 'CHOG WORLD');
      sub.textContent = `${label}... ${Math.round(f * 100)}%`;
    },
    state(name, data = {}) {
      current = name;
      el.classList.remove('done', 'leaving');
      // Opened again later (from the Sign in button, say): the world's controls step aside again.
      if (el.classList.contains('ready')) document.body.classList.add('intro-open');
      if (name === 'connect') {
        setTitle('WELCOME TO', 'CHOG WORLD');
        const wallets = data.wallets ?? [];
        // A wallet's button in the bright style; the demo Chog's beside them in the quieter one.
        const buttons = wallets.length
          ? wallets.map((w) => `<button class="px wallet${/demo/i.test(w.name) ? ' alt' : ''}">${w.icon ? `<img src="${esc(w.icon)}" alt="">` : ''}${esc(w.name.toUpperCase())}</button>`).join('')
          : `<button class="px wallet">CONNECT WALLET</button>`;
        show(`
          <div class="prompt">CONNECT WALLET TO BEGIN<span class="cursor"></span></div>
          ${data.text ? `<p class="note warn">${esc(data.text)}</p>` : ''}
          <div class="buttons">${buttons}</div>
          <button class="link guest">Explore as a guest</button>`);
        on('.wallet', (i) => (wallets[i]?.pick ?? data.connect)?.());
        on('.guest', () => data.guest?.());
        stage.querySelector('.px')?.focus({ preventScroll: true });
      } else if (name === 'step') {
        show(`<div class="prompt">${esc((data.title ?? '').toUpperCase())}<span class="cursor"></span></div>${data.text ? `<p class="note">${esc(data.text)}</p>` : ''}`);
      } else if (name === 'searching') {
        setTitle('WELCOME TO', 'CHOG WORLD');
        runner.reset();
        show(`<div class="prompt">SEARCHING YOUR WALLET<span class="cursor"></span></div>${data.text ? `<p class="note">${esc(data.text)}</p>` : ''}`, { run: true });
      } else if (name === 'pick') {
        setTitle('WELCOME TO', 'CHOG WORLD');
        const chogs = data.chogs ?? [];
        show(`
          <div class="prompt">PICK YOUR CHOG</div>
          <div class="chogs">${chogs.map((c) => `<button class="chog"><img src="${esc(c.image)}" alt=""><span>${esc(String(c.name).toUpperCase())}</span></button>`).join('')}</div>
          <button class="link guest">Explore as a guest</button>`);
        on('.chog', (i) => data.pick?.(chogs[i].id));
        on('.guest', () => data.guest?.());
      } else if (name === 'found') {
        // Welcome to Chog World, and then the warp down to it (src/space.js, src/arrival.js).
        welcomeAt = performance.now();
        setTitle('WELCOME TO', 'CHOG WORLD');
        show(`<div class="prompt">${esc((data.name ?? 'YOUR CHOG').toUpperCase())} IS WAITING FOR YOU<span class="cursor"></span></div>`, { run: true });
        if (data.image) runner.yours(data.image);
      } else if (name === 'none') {
        setTitle('WELCOME TO', 'CHOG WORLD');
        show(`
          <div class="prompt">NO CHOGS IN THIS WALLET</div>
          ${data.text ? `<p class="note">${esc(data.text)}</p>` : ''}
          <div class="buttons">${data.claim ? '<button class="px claim">CLAIM A FREE CHOG</button>' : ''}${data.demo ? '<button class="px alt demo">TRY A DEMO CHOG</button>' : ''}</div>
          <button class="link guest">Explore as a guest</button>`);
        on('.claim', () => data.claim?.());
        on('.demo', () => data.demo?.());
        on('.guest', () => data.guest?.());
      } else if (name === 'error') {
        setTitle('WELCOME TO', 'CHOG WORLD');
        show(`
          <div class="prompt">THAT DIDN'T WORK</div>
          ${data.text ? `<p class="note warn">${esc(data.text)}</p>` : ''}
          <div class="buttons"><button class="px retry">TRY AGAIN</button></div>
          <button class="link guest">Explore as a guest</button>`);
        on('.retry', () => data.retry?.());
        on('.guest', () => data.guest?.());
      }
    },
    // Resolves once the welcome has been up long enough to read.
    held() {
      const left = welcomeAt + WELCOME_MIN - performance.now();
      return new Promise((resolve) => setTimeout(resolve, Math.max(0, left)));
    },
    // Tears the screen away. Resolves once it is gone. keepHud leaves the world's controls hidden
    // (through the arrival flight, until revealHud()).
    close({ keepHud = false } = {}) {
      current = 'closed';
      runner.stop();
      // Nothing left on it as it goes: the running Chog and the words are gone at once.
      stage.hidden = true;
      sub.hidden = true;
      loader.hidden = true;
      loaderRun(false);
      el.classList.add('leaving');
      return new Promise((resolve) =>
        setTimeout(() => {
          el.classList.add('done');
          el.classList.remove('leaving');
          if (!keepHud) document.body.classList.remove('intro-open');
          resolve();
        }, 560),
      );
    },
    // The world's controls fade back in.
    revealHud() {
      const body = document.body;
      if (current !== 'closed' || !body.classList.contains('intro-open')) return;
      body.classList.add('intro-reveal');
      body.classList.remove('intro-open');
      setTimeout(() => body.classList.remove('intro-reveal'), 900);
    },
  };
  return api;
}
