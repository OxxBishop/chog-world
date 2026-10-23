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
  // A film fully over the screen: the world needn't be drawn under it (src/main.js), so the video has
  // the machine to itself (the user, 10-23: the sign-out's film lagged and froze).
  let covering = false;
  // An upright screen (a phone) gets the tall cuts.
  const tall = matchMedia('(orientation: portrait)').matches;
  // Each film fetched whole into memory (a phone won't preload a video, and one streamed from the network
  // stalls on its first frame), then handed to its video; ready once it is all here. The dive in
  // comes first, at once (the user, 10-23: it sometimes wasn't in yet and the old warp played instead).
  const pending = {};
  const fetchClip = (name) =>
    (pending[name] ??= fetch(`${BASE}video/${name}${tall ? '-tall' : ''}.mp4`)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status))))
      .then(
        (blob) =>
          new Promise((resolve) => {
            const v = document.createElement('video');
            v.preload = 'auto';
            v.playsInline = true;
            v.setAttribute('playsinline', '');
            v.className = 'clip';
            v.addEventListener('error', () => resolve((ok[name] = false)), { once: true });
            v.src = URL.createObjectURL(blob);
            v.load();
            vids[name] = v;
            // Ready as soon as the whole file is here: an iPhone won't decode a video it isn't playing, so
            // waiting for its first frame waited for nothing, and the old dive stood in.
            ok[name] = true;
            resolve(true);
          }),
      )
      .catch(() => (ok[name] = false)));
  // The rest (the sale's goodbye, 1.3 MB) well after, so it never shares the line with your Chog's own
  // files as you sign in (the user, 10-23: the demo button felt slow to take).
  fetchClip('arrival').then(() => setTimeout(() => NAMES.forEach(fetchClip), 45000));

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
    get covering() {
      return covering;
    },
    ready: (name) => !!ok[ALIAS[name] ?? name] && !matchMedia('(prefers-reduced-motion: reduce)').matches,
    // Resolves once it's ready, or after ms at most (whichever first): a little grace before falling back.
    whenReady(name, ms = 3500) {
      name = ALIAS[name] ?? name;
      if (ok[name] !== undefined) return Promise.resolve(!!ok[name]);
      return Promise.race([fetchClip(name).then(() => !!ok[name]), new Promise((r) => setTimeout(() => r(false), ms))]);
    },
    // under: it starts beneath the welcome screen (src/intro.js), which goes once it's showing (onShow).
    async play(name, { intro = null, onShow = null, under = false } = {}) {
      name = ALIAS[name] ?? name;
      const v = vids[name];
      if (!v) return onShow?.();
      let white = null;
      if (intro === 'white') {
        white = cover('#f6f0ff');
        white.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1600, fill: 'forwards', easing: 'ease-in-out' });
        // (Slow: a sale's goodbye, not a cut. The user, 10-22: "too abrupt".)
        await new Promise((r) => setTimeout(r, 1700));
      }
      v.currentTime = 0;
      v.muted = false;
      // Shown once it's actually moving (no frozen first frame, no black).
      v.style.opacity = '0';
      v.style.transition = 'opacity 0.3s ease-out';
      v.style.zIndex = under ? '9' : '';
      document.body.append(v);
      const shown = () => {
        if (v.currentTime <= 0.02) return requestAnimationFrame(shown);
        v.style.opacity = '1';
        // (Once it has faded all the way in.)
        setTimeout(() => !v.paused && !v.ended && (covering = true), 350);
        onShow?.();
        // (Back on top once the welcome has torn away.)
        if (under) setTimeout(() => (v.style.zIndex = ''), 800);
      };
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
          onShow?.();
          return;
        }
      }
      requestAnimationFrame(shown);
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
      covering = false;
      // The world takes over under it, then it goes.
      requestAnimationFrame(() => frames(2).then(() => v.remove()));
    },
  };
}
