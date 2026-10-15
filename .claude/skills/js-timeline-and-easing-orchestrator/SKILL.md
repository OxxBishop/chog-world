---
name: js-timeline-and-easing-orchestrator
description: Building code-driven camera and object timelines in Chog World (cutscenes, warp, wake-up, casino shows) with beats, eases, springs and promises. Use when choreographing anything that moves over time, when a move feels stiff or mistimed, or when a cutscene must hand over to another one.
---

# Timelines and easing in Chog World

## The shape of a timeline

Write a cutscene as **beats on one clock**, not chained `setTimeout`s. One `run = { t, ... }` object advanced in an `update(dt)` the frame loop calls. Every property is a pure function of `t`:

```js
const s = (a, b) => THREE.MathUtils.smoothstep(t, a, b);   // 0 to 1 over [a, b]
const bump = (a, b, c) => (t < b ? s(a, b) : 1 - s(b, c)); // up then down
fov = fov0 - 4 * bump(0, 0.55, 0.8) + 34 * s(0.7, 1.3);   // anticipation, then the kick
```

- Write the beat sheet in a comment above the code ("0 to 0.7 s: tilt up. 0.7 to 1.3: launch..."); keep the numbers in the code in step with it.
- **Resolve promises at beats.** A cutscene's promise resolves when the next one can start (the wake resolves at 4.6 s so A's hello starts while the last of the sway dies away). Overlap is what makes hand-overs feel continuous.
- **Clamp `dt`** (`Math.min(dt, 1/20)`) so a long frame skips time instead of teleporting the camera.
- **Which clock:** visuals that the demo recorder holds use `performance.now()` or the frame's `dt` (src/democlock.js virtualises both). Never `Date.now()`.
- **Reduced motion:** `matchMedia('(prefers-reduced-motion: reduce)')` swaps a move for a fade (`dip()`), never just speeds it up.

## Eases that read well here

| Use | Ease |
|---|---|
| Most moves (camera dollies, reels landing) | ease-in-out cubic, or `smootherstep` |
| Arriving, settling | ease-out cubic `1 - (1 - x)^3` |
| Launching, falling | ease-in power (`x^2` to `x^4`) |
| Overshoot and settle (a FOV snap, a nudge) | damped spring `exp(-k t) sin(w t)` added to the target |
| A breath before a big move | `bump`: a small move the *other* way first (anticipation) |
| Swaying, dazed, idle life | sums of slow sines at unrelated rates, amplitude fading out |

- **Distance in log space for big zooms** (`dolly()` in the old src/space.js): equal zoom per second reads as one steady move.
- **Look before you go:** turn the gaze over 0.6 to 0.9 s before the body moves.
- **Never linear for camera position** except during a constant-speed cruise (the warp tunnel).

## Hand-overs

- Between owners of the camera (the rig, travel, space, arrival, entry, the casino's show): exactly one writes the camera each frame. The others step aside (`travel` checks `rig.room`, `entryActive`, `spaceActive`).
- Swap what is behind a cover: a flash, a fade, a tunnel, a blank. The cover must be fully opaque for at least one frame when the swap happens.
- After a hand-over, the new owner starts from the camera as it is (read `camera.position` and direction), never from where it thinks it was.
