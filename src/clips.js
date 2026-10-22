/*
 * The fly-in and fly-out, filmed (A, 10-22: made in Google Flow from the game's own frames; the user wanted
 * the sign-in, sign-out and sale flights redone in Flow). Each clip is played full screen over the world:
 *   arrival     the planet, a dive through the clouds, white   (signing in; the dome wake-up follows)
 *   departure   white, up through the clouds, out to the planet (signing out, a sale)
 * A phone held upright gets the tall cut. The files load quietly once the world is up; a clip that isn't
 * ready (or fails) is skipped and the game's own warp plays instead, so nothing ever waits on a video.
 *
 * clips.ready(name) -> bool; clips.play(name, { intro }) -> Promise (resolves on its last frame, with the
 * video still up for two more frames so the world behind is drawn before it goes). intro 'white': the view
 * fades to white first (the departure starts on white).
 */
const BASE = import.meta.env?.BASE_URL ?? '/';
const NAMES = ['arrival', 'departure'];

export function createClips() {
  const tall = () => innerHeight > innerWidth;
  const vids = {};
  const ok = {};
  const load = () => {
    for (const name of NAMES) {
      const v = document.createElement('video');
      v.src = `${BASE}video/${name}${tall() ? '-tall' : ''}.mp4`;
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
    document.body.append(el);
    return el;
  };
  const frames = (n) => new Promise((r) => {
    const step = () => (n-- <= 0 ? r() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

  return {
    ready: (name) => !!ok[name] && !matchMedia('(prefers-reduced-motion: reduce)').matches,
    async play(name, { intro = null } = {}) {
      const v = vids[name];
      if (!v) return;
      let white = null;
      if (intro === 'white') {
        white = cover('#f6f0ff');
        white.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, fill: 'forwards', easing: 'ease-in' });
        await new Promise((r) => setTimeout(r, 620));
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
      white?.remove();
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
