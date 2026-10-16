// The loading screen's Chog, drawn off the main thread (src/pixelloader.js): it keeps going while the
// world loads. Messages: { canvas, k, calm } to start, { run: true | false } to play or pause.
import { createLoaderArt } from './pixelloader.js';

const raf = self.requestAnimationFrame?.bind(self) ?? ((f) => setTimeout(() => f(performance.now()), 1000 / 60));
const caf = self.cancelAnimationFrame?.bind(self) ?? clearTimeout;
let art = null;
let id = 0;
let on = false;
const tick = (now) => {
  id = raf(tick);
  art.draw(now / 1000);
};
self.onmessage = ({ data }) => {
  if (data.canvas) art = createLoaderArt(data.canvas, data.k, { calm: data.calm });
  if ('run' in data) on = data.run;
  if (on && art && !id) id = raf(tick);
  if (!on && id) {
    caf(id);
    id = 0;
  }
};
