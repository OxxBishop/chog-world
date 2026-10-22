import { animate, stagger, createSpring } from 'animejs';

/*
 * The interface's motion (Celestial, the user's pick 10-21, with Anime.js): a press springs the control
 * in and a gold ring spreads off it; the walking HUD rises into place when it comes up; bubbles and
 * panels pop open. Nothing here changes what a control does.
 */
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const spring = createSpring({ stiffness: 260, damping: 13 });
const PRESSABLE = 'button.cel, .tv-zoom, .tv-ride, .cz-spin, .cz-act, .cz-key, .focus-bar button, .signin-btn, .tv-portal-go button, .pc-actions button, .tv-map';

addEventListener('pointerdown', (e) => {
  const b = e.target.closest?.(PRESSABLE);
  if (!b || still()) return;
  // (Only a well springs: the other controls are placed by their own transforms.)
  const inner = b.querySelector(':scope > .cel-well');
  if (inner) animate(inner, { scale: [1, 0.88, 1], duration: 480, ease: spring });
  const well = inner ?? b;
  const ring = document.createElement('span');
  ring.className = 'cel-ring';
  const size = Math.max(well.offsetWidth, well.offsetHeight) + 6;
  Object.assign(ring.style, { width: `${size}px`, height: `${size}px`, margin: `${-size / 2}px 0 0 ${-size / 2}px`, borderRadius: getComputedStyle(well).borderRadius });
  well.append(ring);
  animate(ring, { scale: [0.85, 1.6], opacity: [0.9, 0], duration: 620, ease: 'outCubic', onComplete: () => ring.remove() });
}, { capture: true, passive: true });

// The walking HUD comes up (body.travel): its pieces rise in, one after another.
const HUD = ['.tv-map', '.tv-zoom', '.chog-chip > *', '.signin-btn', '.hud.bottom > *', '.tv-stick', '.tv-ride'];
let was = false;
new MutationObserver(() => {
  const on = document.body.classList.contains('travel') && !document.body.classList.contains('intro-open');
  if (on && !was && !still()) {
    const els = HUD.flatMap((s) => [...document.querySelectorAll(s)]).filter((el) => el.offsetParent);
    // Fade only: several of these are placed by transforms of their own.
    // (The inline opacity goes again after: these are also hidden by classes that set opacity.)
    animate(els, { opacity: [0, 1], duration: 700, delay: stagger(45, { start: 150 }), ease: 'outQuad', onComplete: () => els.forEach((el) => (el.style.opacity = '')) });
  }
  was = on;
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

// Speech and panels fade open (opacity only: bubbles are placed over heads by transforms).
const POP = '.chog-bubble, .chat, .tv-portal, .pc-card, .tv-full-card, .tv-pick-card';
const seen = new WeakSet();
new MutationObserver((list) => {
  if (still()) return;
  for (const m of list) {
    const el = m.target;
    if (!(el instanceof HTMLElement) || !el.matches?.(POP)) continue;
    const shown = !el.hidden && el.offsetParent !== null;
    if (shown && !seen.has(el)) {
      seen.add(el);
      animate(el, { opacity: [0, 1], duration: 320, ease: 'outQuad', onComplete: () => (el.style.opacity = '') });
    } else if (!shown) seen.delete(el);
  }
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
