/*
 * The fly-in and the sale, filmed (A, 10-22: the user wanted these flights redone as video). Each clip is
 * played full screen over the world:
 *   arrival   the planet, a dive through the clouds, white  (signing in; the dome wake-up follows)
 *   sale      a dome at dusk going dark, up through the clouds, out to the planet  (a sale)
 * Both made with Seedance (ElevenLabs) from the game's frames (video/frames). On a screen held upright
 * the tall cut plays (<name>-tall.mp4: the middle of the film, 9:16, a tenth of the download), and the
 * picture is cropped to fill the screen. The files load quietly once the world is up; a clip that isn't
 * ready (or fails) is skipped and the game's own warp plays instead, so nothing ever waits on a video.
 *
 * clips.ready(name) -> bool; clips.play(name, { intro }) -> Promise (resolves on its last frame, with the
 * video still up for two more frames so the world behind is drawn before it goes). intro 'white': the view
 * fades to white first, then out of the white into the film.
 */
const BASE = import.meta.env?.BASE_URL ?? '/';
const NAMES = ['arrival', 'sale'];
// Signing out flies out by the sale's film for now (its dome going dark at dusk and up to the planet
// suits a goodnight too); a film of its own can take over here.
const ALIAS = { signout: 'sale' };
// Stretches to leave out, as [from, to] seconds: the sale's island came out as a lone cut-off chunk
// (the user, 10-22), so it blinks white from the dome straight into the clouds.
const SKIP = { sale: [1.55, 3.45] };

export function createClips() {
  const vids = {};
  const ok = {};
  // An upright screen (a phone) gets the tall cuts.
  const tall = matchMedia('(orientation: portrait)').matches;
  const load = () => {
    for (const name of NAMES) {
      const v = document.createElement('video');
      v.src = `${BASE}video/${name}${tall ? '-tall' : ''}.mp4`;
      v.preload = 'auto';
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.className = 'clip';
      v.addEventListener('canplaythrough', () => (ok[name] = true), { once: true });
      v.addEventListener('error', () => (ok[name] = false), { once: true });
      v.load();
      vids[name] = v;
    }
  };
  // Once the page has settled (they're a few MB each, and the world comes first).
  const later = () => (window.requestIdleCallback ? requestIdleCallback(load, { timeout: 6000 }) : setTimeout(load, 3000));
  if (document.readyState === 'complete') later();
  else addEventListener('load', later, { once: true });

  const cover = (color) => {
    const el = document.createElement('div');
    el.className = 'clip-cover';
    el.style.background = color;
    // (Over the film: it fades in and out over it.)
    el.style.zIndex = '61';
    document.body.append(el);
    return el;
  };
  const frames = (n) => new Promise((r) => {
    const step = () => (n-- <= 0 ? r() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

  return {
    ready: (name) => !!ok[ALIAS[name] ?? name] && !matchMedia('(prefers-reduced-motion: reduce)').matches,
    async play(name, { intro = null } = {}) {
      name = ALIAS[name] ?? name;
      const v = vids[name];
      if (!v) return;
      let white = null;
      if (intro === 'white') {
        white = cover('#f6f0ff');
        white.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1600, fill: 'forwards', easing: 'ease-in-out' });
        // (Slow: a sale's goodbye, not a cut. The user, 10-22: "too abrupt".)
        await new Promise((r) => setTimeout(r, 1700));
      }
      v.currentTime = 0;
      v.muted = false;
      document.body.append(v);
      try {
        await v.play();
      } catch {
        // No sound allowed here: play it silent.
        v.muted = true;
        try {
          await v.play();
        } catch {
          v.remove();
          white?.remove();
          return;
        }
      }
      // Out of the white into the film.
      if (white) white.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1200, fill: 'forwards', easing: 'ease-out' }).onfinish = () => white.remove();
      const skip = SKIP[name];
      if (skip) {
        const blink = cover('#f2eef8');
        const watch = () => {
          if (v.currentTime >= skip[0] - 0.2 && !blink.dataset.on) {
            blink.dataset.on = '1';
            blink.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'forwards' }).onfinish = () => {
              v.currentTime = skip[1];
              blink.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, fill: 'forwards' }).onfinish = () => blink.remove();
            };
          } else if (!v.ended) requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
      }
      await new Promise((r) => {
        v.onended = r;
        // Never hold the game on a stalled video.
        setTimeout(r, (v.duration || 8) * 1000 + 2500);
      });
      v.pause();
      // The world takes over under it, then it goes.
      requestAnimationFrame(() => frames(2).then(() => v.remove()));
    },
  };
}
