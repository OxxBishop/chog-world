/*
 * The postcard camera (B19; reworked by A, 10-21, the user: "the post card is just a screenshot, there's no
 * share to X button"). The view as it is, framed as a postcard: cream card stock, the picture with rounded
 * corners, your Chog's own art as the stamp with a postmark over it, "Greetings from <place>" and who and
 * when underneath. Then a sheet to send it on:
 *   a phone: Share (the system's sheet, the picture attached: X, WhatsApp, Messages...) and Save;
 *   a computer: Post on X (the picture is copied first, and the post opens with its words and the link:
 *   paste the picture in), Copy and Save.
 * The world is drawn once more and copied in the same moment, so the canvas needs no preserved buffer.
 *
 * postcard({ frame, canvas, name, place, art }) -> Promise (the sheet is open).
 */
const SITE = 'https://chog-world.vercel.app';
const isTouch = () => matchMedia('(pointer: coarse)').matches;

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// The game's own type (src/celestial.css), loaded before the card is drawn so the canvas uses it.
const DISPLAY = "Cinzel, 'Times New Roman', serif";
const LABEL = "'Josefin Sans', system-ui, sans-serif";
const fontsReady = () =>
  Promise.race([
    Promise.all(['800 64px Cinzel', '600 32px Cinzel', '600 24px "Josefin Sans"', '700 24px "Josefin Sans"'].map((f) => document.fonts.load(f))),
    new Promise((r) => setTimeout(r, 1500)),
  ]).catch(() => {});

// Text with letter spacing where the browser can (older Safari draws it plain).
function spaced(g, text, x, y, em) {
  if ('letterSpacing' in g) {
    g.letterSpacing = `${em}em`;
    g.fillText(text, x, y);
    g.letterSpacing = '0px';
  } else g.fillText(text, x, y);
}

// The card, as a canvas (the user, 10-23: "it still just looks like a screenshot"). A printed photo on
// cream card stock: a white border, a warm grade and a soft vignette on the picture, "Greetings from"
// over it in big gold letters like an old holiday card, the stamp and postmark, and a written line under.
async function draw({ canvas, name, place, art }) {
  await fontsReady();
  // At most 1600 px across, whatever the screen.
  const k = Math.min(1, 1600 / canvas.width);
  const w = Math.round(canvas.width * k), h = Math.round(canvas.height * k);
  const u = Math.min(w, h) / 100;
  const pad = Math.round(u * 4.6), foot = Math.round(u * 14), edge = Math.round(u * 1.1);
  const out = document.createElement('canvas');
  out.width = w + pad * 2;
  out.height = h + pad + foot;
  const g = out.getContext('2d');
  // Card stock: warm cream with a faint grain and a darker rim, like old paper.
  g.fillStyle = '#f5ecd8';
  g.fillRect(0, 0, out.width, out.height);
  const rim = g.createRadialGradient(out.width / 2, out.height / 2, Math.min(out.width, out.height) * 0.45, out.width / 2, out.height / 2, Math.hypot(out.width, out.height) * 0.6);
  rim.addColorStop(0, 'rgba(160, 120, 70, 0)');
  rim.addColorStop(1, 'rgba(160, 120, 70, 0.22)');
  g.fillStyle = rim;
  g.fillRect(0, 0, out.width, out.height);
  const grain = g.createImageData(out.width, out.height);
  for (let i = 0; i < grain.data.length; i += 4) {
    grain.data[i] = grain.data[i + 1] = grain.data[i + 2] = 110;
    grain.data[i + 3] = Math.random() * 20;
  }
  const tmp = document.createElement('canvas');
  tmp.width = out.width;
  tmp.height = out.height;
  tmp.getContext('2d').putImageData(grain, 0, 0);
  g.globalAlpha = 0.4;
  g.drawImage(tmp, 0, 0);
  g.globalAlpha = 1;
  // The print: a white border round the picture, lifted off the card by a soft shadow.
  g.save();
  g.shadowColor = 'rgba(60, 35, 20, 0.28)';
  g.shadowBlur = u * 1.4;
  g.shadowOffsetY = u * 0.35;
  g.fillStyle = '#fffdf7';
  g.fillRect(pad - edge, pad - edge, w + edge * 2, h + edge * 2);
  g.restore();
  // The picture, graded: a touch warmer, the corners softly darker.
  g.drawImage(canvas, pad, pad, w, h);
  g.save();
  g.beginPath();
  g.rect(pad, pad, w, h);
  g.clip();
  g.globalCompositeOperation = 'soft-light';
  g.fillStyle = 'rgba(255, 196, 130, 0.35)';
  g.fillRect(pad, pad, w, h);
  g.globalCompositeOperation = 'source-over';
  const vig = g.createRadialGradient(pad + w / 2, pad + h * 0.45, Math.min(w, h) * 0.35, pad + w / 2, pad + h / 2, Math.hypot(w, h) * 0.58);
  vig.addColorStop(0, 'rgba(25, 12, 40, 0)');
  vig.addColorStop(1, 'rgba(25, 12, 40, 0.42)');
  g.fillStyle = vig;
  g.fillRect(pad, pad, w, h);
  // Under the title, a little shade so the letters read on any sky.
  const shade = g.createLinearGradient(0, pad + h * 0.55, 0, pad + h);
  shade.addColorStop(0, 'rgba(20, 10, 36, 0)');
  shade.addColorStop(1, 'rgba(20, 10, 36, 0.5)');
  g.fillStyle = shade;
  g.fillRect(pad, pad + h * 0.55, w, h * 0.45);
  g.restore();
  // "Greetings from" and the place, big and gold over the lower left of the picture.
  const tx = pad + u * 4.5;
  let size = u * 11;
  g.font = `800 ${size}px ${DISPLAY}`;
  const title = place.toUpperCase();
  const room = w * 0.62;
  if (g.measureText(title).width > room) size *= room / g.measureText(title).width;
  const ty = pad + h - u * 4.8;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff6e0';
  g.shadowColor = 'rgba(15, 6, 30, 0.7)';
  g.shadowBlur = u * 0.8;
  g.font = `700 ${Math.round(u * 3.1)}px ${LABEL}`;
  spaced(g, 'GREETINGS FROM', tx + u * 0.3, ty - size * 0.92, 0.28);
  g.font = `800 ${Math.round(size)}px ${DISPLAY}`;
  g.shadowBlur = u * 1.6;
  g.shadowOffsetY = u * 0.5;
  g.lineJoin = 'round';
  g.lineWidth = Math.max(2, size * 0.09);
  g.strokeStyle = '#2a1846';
  g.strokeText(title, tx, ty);
  g.shadowColor = 'transparent';
  const gold = g.createLinearGradient(0, ty - size * 0.8, 0, ty);
  gold.addColorStop(0, '#fff1b8');
  gold.addColorStop(0.5, '#f2c95c');
  gold.addColorStop(1, '#c98a2b');
  g.fillStyle = gold;
  g.fillText(title, tx, ty);
  g.shadowOffsetY = 0;
  // Under the print: who wrote it and when, and the address.
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const cy = h + pad + foot * 0.5;
  g.textBaseline = 'middle';
  g.fillStyle = '#3a2c63';
  g.font = `600 ${Math.round(u * 3.6)}px ${DISPLAY}`;
  g.fillText(`With love, ${name}`, pad, cy - u * 1.6);
  g.fillStyle = '#7a6a96';
  g.font = `600 ${Math.round(u * 2.2)}px ${LABEL}`;
  spaced(g, `${date.toUpperCase()}   ·   CHOG-WORLD.VERCEL.APP`, pad, cy + u * 2.6, 0.14);
  g.textAlign = 'right';
  g.fillStyle = 'rgba(58, 44, 99, 0.55)';
  g.font = `600 ${Math.round(u * 2.4)}px ${DISPLAY}`;
  spaced(g, 'POST CARD', w + pad, cy - u * 1.6, 0.3);
  g.font = `600 ${Math.round(u * 1.8)}px ${LABEL}`;
  spaced(g, 'MONAD TESTNET', w + pad, cy + u * 2.6, 0.22);
  g.textAlign = 'left';
  // The stamp: your Chog's art in a perforated frame, top right over the picture, a postmark over its corner.
  const img = await loadImage(art);
  const sw = u * 19, sh = u * 22, sx = w + pad - sw - u * 2.4, sy = pad + u * 2.4;
  g.save();
  g.translate(sx + sw / 2, sy + sh / 2);
  g.rotate(0.06);
  g.translate(-sw / 2, -sh / 2);
  g.shadowColor = 'rgba(30, 15, 60, 0.35)';
  g.shadowBlur = u * 1.2;
  g.shadowOffsetY = u * 0.4;
  g.fillStyle = '#fffaf0';
  g.fillRect(0, 0, sw, sh);
  g.shadowColor = 'transparent';
  // The perforations: bites out of every edge.
  g.globalCompositeOperation = 'destination-out';
  const bite = u * 0.55, step = u * 1.6;
  for (let x = step / 2; x < sw; x += step) for (const y of [0, sh]) g.beginPath(), g.arc(x, y, bite, 0, Math.PI * 2), g.fill();
  for (let y = step / 2; y < sh; y += step) for (const x of [0, sw]) g.beginPath(), g.arc(x, y, bite, 0, Math.PI * 2), g.fill();
  g.globalCompositeOperation = 'source-over';
  const m = u * 1.3, iw = sw - m * 2, ih = sh - m * 2 - u * 3.6;
  if (img) g.drawImage(img, m, m, iw, ih);
  else {
    g.fillStyle = '#8a63ff';
    g.fillRect(m, m, iw, ih);
  }
  g.fillStyle = '#5b3fd6';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `800 ${Math.round(u * 1.8)}px ${DISPLAY}`;
  g.fillText('CHOG WORLD', sw / 2, sh - m - u * 1.3);
  g.restore();
  // The postmark: a ring with the place and wavy cancel lines, over the stamp's lower left corner.
  g.save();
  g.translate(sx - u * 1.5, sy + sh - u * 2);
  g.rotate(-0.18);
  g.strokeStyle = 'rgba(91, 63, 214, 0.55)';
  g.fillStyle = 'rgba(91, 63, 214, 0.55)';
  g.lineWidth = u * 0.35;
  const R = u * 5.4;
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(0, 0, R * 0.78, 0, Math.PI * 2);
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${Math.round(u * 1.5)}px ${LABEL}`;
  g.fillText(place.toUpperCase().slice(0, 16), 0, -u * 0.6);
  g.fillText(date.toUpperCase(), 0, u * 1.6);
  for (let i = -1; i <= 1; i++) {
    g.beginPath();
    for (let x = R * 1.05; x < R * 4.2; x += u * 0.4) {
      const y = i * u * 1.6 + Math.sin(x / (u * 1.2)) * u * 0.5;
      x === R * 1.05 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  }
  g.restore();
  return out;
}

const blobOf = (c) => new Promise((r) => c.toBlob(r, 'image/png'));

export async function postcard({ frame, canvas, name = 'Chog World', place = 'Chog World', art = null }) {
  frame();
  // The shutter: a quick white flash over the view.
  const flash = document.createElement('div');
  flash.className = 'pc-flash';
  document.body.append(flash);
  setTimeout(() => flash.remove(), 600);
  const card = await draw({ canvas, name, place, art });
  const blob = await blobOf(card);
  const file = new File([blob], `chog-world-${Date.now()}.png`, { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const text = `Greetings from ${place} in Chog World, with ${name}. Come say hi: ${SITE} #Chogathon @monad`;
  const canShareFile = !!navigator.canShare?.({ files: [file] });

  const sheet = document.createElement('div');
  sheet.className = 'pc-sheet';
  sheet.innerHTML = `
    <div class="pc-card" role="dialog" aria-label="Your postcard">
      <img class="pc-preview" alt="Your Chog World postcard">
      <div class="pc-actions"></div>
      <p class="pc-note" hidden></p>
      <button class="pc-close" aria-label="Close">×</button>
    </div>`;
  sheet.querySelector('.pc-preview').src = url;
  const actions = sheet.querySelector('.pc-actions');
  const note = sheet.querySelector('.pc-note');
  const say = (t) => ((note.textContent = t), (note.hidden = false));
  const button = (label, cls, fn) => {
    const b = document.createElement('button');
    b.className = cls;
    b.innerHTML = label;
    b.addEventListener('click', fn);
    actions.append(b);
    return b;
  };
  const X_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z"/></svg>';
  const save = () => {
    const a = document.createElement('a');
    a.download = file.name;
    a.href = url;
    a.click();
    say('Saved.');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch {
      return false;
    }
  };
  if (isTouch() && canShareFile) {
    const SHARE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l4.5 4.5-1.4 1.4L13 6.8V15h-2V6.8L8.9 8.9 7.5 7.5 12 3zM5 13h2v6h10v-6h2v8H5v-8z"/></svg>';
    button(`${SHARE_ICON}<span>Share</span>`, 'pc-primary', async () => {
      try {
        await navigator.share({ files: [file], text });
      } catch {}
    });
    button('Save', 'pc-secondary', save);
  } else {
    button(`${X_ICON}<span>Post on X</span>`, 'pc-primary', async () => {
      const copied = await copy();
      window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      say(copied ? 'Picture copied: paste it into your post (Ctrl+V).' : 'Save the picture, then add it to your post.');
    });
    button('Copy', 'pc-secondary', async () => say((await copy()) ? 'Copied.' : 'Your browser would not copy it: use Save.'));
    button('Save', 'pc-secondary', save);
  }
  const close = () => {
    sheet.classList.add('out');
    setTimeout(() => (sheet.remove(), URL.revokeObjectURL(url)), 220);
    removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  addEventListener('keydown', onKey);
  sheet.querySelector('.pc-close').addEventListener('click', close);
  sheet.addEventListener('click', (e) => e.target === sheet && close());
  document.body.append(sheet);
}
