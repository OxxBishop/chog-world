import * as THREE from 'three';

/*
 * The two moments a Chog has with its owner: waking in its home when you sign in, and going grey when
 * it leaves your wallet. Both are hooks the session calls; they can grow here (sound, the rigged
 * animations) without the session changing.
 */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function caption(text, sub = '') {
  const el = document.getElementById('story');
  el.querySelector('.story-title').textContent = text;
  el.querySelector('.story-sub').textContent = sub;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('on'));
}

function hideCaption() {
  const el = document.getElementById('story');
  el.classList.remove('on');
  setTimeout(() => (el.hidden = true), 400);
}

// Where a Chog sleeps and stands in its home room (room space, metres).
export const BED = new THREE.Vector3(-2.7, 0.5, 0.2);
export const SPOT = new THREE.Vector3(0.3, 0, -0.8);

/**
 * Wake: the Chog is asleep on its bed when the view fades in, sits up, hops down and waves.
 * Resolves when it's standing and idle.
 */
export async function playWake({ chog, name }) {
  chog.root.position.copy(BED);
  chog.root.rotation.y = Math.PI / 2;
  chog.play('sleep');
  caption(`${name} is waking up`);
  await wait(1200);
  chog.play('wake');
  await wait(2400);
  // Down off the bed, turning to face you.
  const from = chog.root.position.clone();
  const t0 = performance.now();
  chog.play('walk');
  await new Promise((resolve) => {
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 900);
      chog.root.position.lerpVectors(from, SPOT, k);
      chog.root.rotation.y = Math.PI / 2 * (1 - k) + 0.5 * k;
      if (k < 1) requestAnimationFrame(step);
      else resolve();
    };
    step();
  });
  chog.play('wave');
  caption(`${name} is home`, 'Your Chog lives here now. It stays as long as it stays in your wallet.');
  await wait(2200);
  chog.play('idle');
  hideCaption();
}
