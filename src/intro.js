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
 * The search's running Chog is the official art, pixelated here as it loads. The loading screen's is
 * drawn to the user's own design (src/pixelloader.js).
 */

import { ART, createLoaderArt } from './pixelloader.js';

const BASE = import.meta.env?.BASE_URL ?? '/';
// Faces for the search: a few Chogs whose art ships with the site.
const SEARCH_FACES = [43, 1, 130, 87, 892, 1517, 22, 35];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The art, pixelated to a round token `size` pixels across, with a dark rim.
function pixelFace(img, size = 24) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // The face sits a little below the middle of the portrait.
  const s = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
  ctx.drawImage(img, s * 0.1, s * 0.16, s * 0.8, s * 0.8, 0, 0, size, size);
  const d = ctx.getImageData(0, 0, size, size);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x + 0.5 - r, y + 0.5 - r);
      const i = (y * size + x) * 4;
      if (dist > r) d.data[i + 3] = 0;
      else if (dist > r - 1.15) {
        d.data[i] = 26;
        d.data[i + 1] = 12;
        d.data[i + 2] = 48;
        d.data[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/*
 * The pixel Chog running round a little track: hops, squashes as it lands, kicks up dust, and casts a
 * shadow. While searching it flickers to another Chog's face every lap; with `face` set it is yours.
 */
function createRunner(canvas, { ids = SEARCH_FACES, cycle = true } = {}) {
  const W = 64;
  canvas.width = canvas.height = W;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const faces = [];
  let faceIndex = 0;
  let mine = null;
  let glitch = 0;
  let lap = 0;
  let mode = 'run';
  let raf = 0;
  let t0 = performance.now();
  const dust = [];
  for (const id of ids) loadImage(`${BASE}art/${id}.webp`).then((img) => faces.push(pixelFace(img))).catch(() => {});

  function draw(now) {
    raf = requestAnimationFrame(draw);
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, W);
    const cx = W / 2, cy = W / 2 + 10, R = 19;
    // The track: a ring of dots in perspective.
    ctx.fillStyle = 'rgba(183, 156, 255, 0.35)';
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      ctx.fillRect(Math.round(cx + Math.cos(a) * (R + 1)), Math.round(cy + Math.sin(a) * (R + 1) * 0.42), 1, 1);
    }
    const face = mine ?? faces[faceIndex % Math.max(1, faces.length)];
    let a, x, y, scale = 1, flip = false;
    if (mode === 'run') {
      a = t * 3.2;
      const l = Math.floor(a / (Math.PI * 2));
      if (l !== lap) {
        lap = l;
        if (cycle && !mine && faces.length > 1) {
          faceIndex++;
          glitch = 4;
        }
      }
      x = cx + Math.cos(a) * R;
      y = cy + Math.sin(a) * R * 0.42;
      flip = -Math.sin(a) < 0;
      scale = 0.88 + 0.12 * (Math.sin(a) * 0.5 + 0.5);
    } else {
      // Found: it stops in the middle and bounces for joy.
      x = cx;
      y = cy;
      scale = 1.2;
    }
    const hopRate = mode === 'run' ? 14 : 8;
    const ph = (t * hopRate) % (Math.PI * 2);
    const hop = Math.abs(Math.sin(ph / 2)) * (mode === 'run' ? 5 : 8);
    const landing = Math.sin(ph / 2) ** 2 < 0.06;
    if (landing && mode === 'run' && Math.random() < 0.6) dust.push({ x: x + (flip ? 5 : -5), y: y + 1, life: 1 });
    // Shadow, smaller as it rises.
    ctx.fillStyle = 'rgba(8, 3, 20, 0.55)';
    const sw = Math.round((7 - hop * 0.5) * scale);
    ctx.fillRect(Math.round(x - sw), Math.round(y + 1), sw * 2, 2);
    for (let i = dust.length - 1; i >= 0; i--) {
      const p = dust[i];
      p.life -= 0.06;
      p.y -= 0.15;
      if (p.life <= 0) {
        dust.splice(i, 1);
        continue;
      }
      ctx.fillStyle = `rgba(214, 200, 255, ${p.life * 0.8})`;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    if (!face) return;
    const sq = landing ? 1.1 : 1, st = landing ? 0.9 : 1;
    const fw = Math.round(face.width * scale * sq), fh = Math.round(face.height * scale * st);
    const fx = Math.round(x - fw / 2), fy = Math.round(y - fh - hop);
    ctx.save();
    if (flip) {
      ctx.translate(fx + fw, fy);
      ctx.scale(-1, 1);
      ctx.drawImage(face, 0, 0, fw, fh);
    } else ctx.drawImage(face, fx, fy, fw, fh);
    ctx.restore();
    // A swap of faces comes with a flash of colour split.
    if (glitch > 0) {
      glitch--;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.6;
      ctx.drawImage(face, fx - 2, fy, fw, fh);
      ctx.drawImage(face, fx + 2, fy, fw, fh);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  return {
    start() {
      if (!raf) {
        t0 = performance.now();
        raf = requestAnimationFrame(draw);
      }
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
    async yours(image) {
      mode = 'found';
      try {
        mine = pixelFace(await loadImage(image));
        glitch = 6;
      } catch {
        // No art: it keeps whichever face it had.
      }
    },
    reset() {
      mode = 'run';
      mine = null;
    },
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
