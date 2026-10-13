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

/**
 * The sale: the Chog has left the wallet (sold or sent). It turns to you, its colour drains from the
 * feet up, and it walks out of its home grey. The view is carried out to the world seen from space,
 * the world fades, and it's gone: "Your Chog has moved on." Resolves at the end,
 * on a dark screen; the session signs out and the world comes back from there.
 *
 * world: { enterSpace({ from, duration }) (B7: carries the view out to the world seen from space,
 * resolves when it settles), blackout(text, sub) (fades to dark with a caption, resolves after it
 * has been read) }.
 */
export async function playGreyOut({ chog, name, room, world }) {
  chog.play('idle');
  caption(`${name} left your wallet`);
  await wait(1100);
  // Colour drains from the feet up.
  await tween(2600, (k) => chog.setGrey(THREE.MathUtils.smoothstep(k, 0, 1)));
  chog.play('sad');
  await wait(700);
  // It walks out of the door, grey.
  const door = new THREE.Vector3(0, 0, room.room.d / 2 - 0.6);
  const from = chog.root.position.clone();
  chog.root.rotation.y = Math.atan2(door.x - from.x, door.z - from.z);
  chog.play('walk');
  hideCaption();
  // It fades as it goes, since the door is on the camera's side of the room.
  await tween(2600, (k) => {
    chog.root.position.lerpVectors(from, door, k * 0.7);
    chog.setFade(1 - THREE.MathUtils.smoothstep(k, 0.25, 0.8));
  });
  chog.root.visible = false;
  await world.enterSpace({ from: room, duration: 5 });
  await world.blackout('Your Chog has moved on.', 'It goes grey and wanders off when it leaves your wallet. Its next owner can wake it again.');
}

// Run fn(k) for k from 0 to 1 over ms, one step a frame.
function tween(ms, fn) {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      fn(k);
      if (k < 1) requestAnimationFrame(step);
      else resolve();
    };
    step();
  });
}
