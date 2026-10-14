/*
 * The intro: the first screen. A glitchy pixel screen that says welcome over the real load, then asks
 * you to connect a wallet (or explore as a guest), shows a pixel Chog running in circles while your
 * wallet is searched, and greets your Chog by name before the flight down to its home.
 *
 * main.js opens it on 'start' (Connect wallet, Try a demo Chog, Explore as a guest). Sign-in itself is
 * A's (src/session.js): Connect and the demo call into it, and it drives the screen from there through
 * state(name, data), with the names and data of A's API (HANDOFF, A10 and A11):
 *   'wallets' { wallets: [{ name, icon }], pick(i) }   'nowallet' {}   'connect' { wallet }   'sign' {}
 *   'searching' { address }   'pick' { chogs: [{ id, name, image }], pick(id) }
 *   'welcome' { id, name, image }   'none' { address, claimsLeft, faucetUrl, claim(), demo() }
 *   'claiming' {}   'error' { message, retry() }
 * Every screen where you could be stuck keeps the way out as a guest. flyHome (main.js, src/arrival.js)
 * tears the screen away and flies home; done() tidies up once the hello has landed.
 *
 * The running Chog is the official art, pixelated here as it loads: no sprite is drawn by hand.
 */

const BASE = import.meta.env?.BASE_URL ?? '/';
// Faces for the search: a few Chogs whose art ships with the site.
const SEARCH_FACES = [43, 1, 130, 87, 892, 1517, 22, 35];

const short = (a) => `${a.slice(0, 6)}...${a.slice(-4)}`;
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
function createRunner(canvas) {
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
  for (const id of SEARCH_FACES) loadImage(`${BASE}art/${id}.webp`).then((img) => faces.push(pixelFace(img))).catch(() => {});

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
        if (!mine && faces.length > 1) {
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

export function createIntro(el) {
  el.classList.add('intro');
  // index.html carries the same markup, so the screen is there from the first paint.
  if (!el.querySelector('.glitch')) el.innerHTML = `
    <div class="kicker">WELCOME TO</div>
    <div class="glitch" data-text="CHOG WORLD">CHOG WORLD</div>
    <div class="load-bar" aria-hidden="true"><i></i></div>
    <div class="sub" aria-live="polite">Waking the island...</div>
    <div class="stage" hidden></div>`;
  const kicker = el.querySelector('.kicker');
  const title = el.querySelector('.glitch');
  const bar = el.querySelector('.load-bar');
  const sub = el.querySelector('.sub');
  const stage = el.querySelector('.stage');
  const runnerCanvas = document.createElement('canvas');
  runnerCanvas.className = 'runner';
  const runner = createRunner(runnerCanvas);
  let current = 'loading';
  // The start screen's handlers (connect, demo, guest), kept for every screen after it.
  let handlers = {};
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
    bar.hidden = true;
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
    get state() {
      return current;
    },
    // The load is done: the world shows through, dimmed.
    ready() {
      el.classList.add('ready');
      document.body.classList.add('intro-open');
    },
    state(name, data = {}) {
      current = name;
      el.classList.remove('done', 'leaving');
      // Opened again later (from the Sign in button, say): the world's controls step aside again.
      if (el.classList.contains('ready')) document.body.classList.add('intro-open');
      if (name === 'start') handlers = data;
      const guest = `<button class="link guest">Explore as a guest</button>`;
      const demo = `<button class="px alt demo">TRY A DEMO CHOG</button>`;
      const home = name === 'welcome';
      if (!home) setTitle('WELCOME TO', 'CHOG WORLD');
      if (name === 'start') {
        show(`
          <div class="prompt">CONNECT WALLET TO BEGIN<span class="cursor"></span></div>
          <div class="buttons"><button class="px wallet">CONNECT WALLET</button>${demo}</div>
          ${guest}`);
        on('.wallet', () => handlers.connect?.());
        stage.querySelector('.px')?.focus({ preventScroll: true });
      } else if (name === 'wallets') {
        const wallets = data.wallets ?? [];
        show(`
          <div class="prompt">PICK A WALLET</div>
          <div class="buttons">${wallets.map((w) => `<button class="px wallet">${w.icon ? `<img src="${esc(w.icon)}" alt="">` : ''}${esc(String(w.name).toUpperCase())}</button>`).join('')}</div>
          ${guest}`);
        on('.wallet', (i) => data.pick?.(i));
      } else if (name === 'nowallet') {
        show(`
          <div class="prompt">NO WALLET IN THIS BROWSER</div>
          <p class="note">Add a wallet such as MetaMask or Phantom to bring your own Chog, or meet one now.</p>
          <div class="buttons">${demo}</div>
          ${guest}`);
      } else if (name === 'connect') {
        show(`
          <div class="prompt">CONNECTING${data.wallet ? ` TO ${esc(String(data.wallet).toUpperCase())}` : ''}<span class="cursor"></span></div>
          <p class="note">Approve the connection, and the switch to Monad Testnet if it asks.</p>`);
      } else if (name === 'sign') {
        show(`
          <div class="prompt">SIGN THE MESSAGE<span class="cursor"></span></div>
          <p class="note">It is free and sends nothing.</p>`);
      } else if (name === 'searching') {
        runner.reset();
        show(`
          <div class="prompt">SEARCHING YOUR WALLET<span class="cursor"></span></div>
          ${data.address ? `<p class="note">${esc(short(data.address))}</p>` : ''}`, { run: true });
      } else if (name === 'pick') {
        const chogs = data.chogs ?? [];
        show(`
          <div class="prompt">PICK YOUR CHOG</div>
          <div class="chogs">${chogs.map((c) => `<button class="chog"><img src="${esc(c.image)}" alt=""><span>${esc(String(c.name).toUpperCase())}</span></button>`).join('')}</div>`);
        on('.chog', (i) => data.pick?.(chogs[i].id));
      } else if (name === 'welcome') {
        welcomeAt = performance.now();
        setTitle('WELCOME,', String(data.name ?? 'CHOG').toUpperCase());
        show(`<div class="prompt">TAKING YOU HOME<span class="cursor"></span></div>`, { run: true });
        if (data.image) runner.yours(data.image);
      } else if (name === 'none') {
        const canClaim = (data.claimsLeft ?? 1) > 0;
        show(`
          <div class="prompt">NO CHOGS IN THIS WALLET</div>
          <p class="note">${canClaim ? 'Claim one free on Monad testnet. It needs a little testnet MON for gas' : 'This wallet has claimed all the Chogs it can'}${canClaim && data.faucetUrl ? `: <a href="${esc(data.faucetUrl)}" target="_blank" rel="noopener">get some from the faucet</a>.` : '.'}</p>
          <div class="buttons">${canClaim ? '<button class="px claim">CLAIM A FREE CHOG</button>' : ''}${demo}</div>
          ${guest}`);
        on('.claim', () => data.claim?.());
      } else if (name === 'claiming') {
        runner.reset();
        show(`
          <div class="prompt">CLAIMING YOUR CHOG<span class="cursor"></span></div>
          <p class="note">Confirm the claim in your wallet. Gas is paid in testnet MON.</p>`, { run: true });
      } else if (name === 'error') {
        show(`
          <div class="prompt">THAT DIDN'T WORK</div>
          ${data.message ? `<p class="note warn">${esc(data.message)}</p>` : ''}
          <div class="buttons"><button class="px retry">TRY AGAIN</button>${demo}</div>
          ${guest}`);
        on('.retry', () => data.retry?.());
      }
      // The same demo and guest everywhere: the start screen's, or a state's own.
      on('.demo', () => (data.demo ?? handlers.demo)?.());
      on('.guest', () => handlers.guest?.());
    },
    // Resolves once the welcome has been up long enough to read.
    held() {
      const left = welcomeAt + WELCOME_MIN - performance.now();
      return new Promise((resolve) => setTimeout(resolve, Math.max(0, left)));
    },
    // Once the hello has landed (A11): make sure the screen is gone, and bring the world's controls in.
    done() {
      if (current !== 'closed') return api.close();
      const body = document.body;
      if (body.classList.contains('intro-open')) {
        body.classList.add('intro-reveal');
        body.classList.remove('intro-open');
        setTimeout(() => body.classList.remove('intro-reveal'), 900);
      }
      return Promise.resolve();
    },
    // Tears the screen away. Resolves once it is gone. keepHud leaves the world's controls hidden (for
    // the arrival, until done()).
    close({ keepHud = false } = {}) {
      current = 'closed';
      runner.stop();
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
  };
  return api;
}
