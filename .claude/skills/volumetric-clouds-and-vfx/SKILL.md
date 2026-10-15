---
name: volumetric-clouds-and-vfx
description: Particle effects, glows, light shafts, dust, confetti, coin fountains and fog in Chog World, and how they meet the volumetric cloud pass. Use for the B24 effects (casino, lobby, stage, portal trip), for win effects, and whenever an effect must look rich but stay cheap on the HD 520.
---

# Effects in Chog World

## Building blocks already in the code (reuse them)

- **Chip and coin bursts:** one `InstancedMesh`, CPU physics with gravity, a bounce and rest on the floor (`throwChips` in `src/casino.js`). Things that land must land on the surface under them, never sink into it (the user's rule). Check each particle against the floor or the table top it is over.
- **Sparkles:** `THREE.Points` with a star texture, additive, vertex colours as brightness (`sparkleSlots` and `sparkleAt` in `src/casino.js`). Keep one dark point drawn so the load builds the shader.
- **Glints:** an additive streak texture on the glass whose `offset.x` sweeps across (`sweep()` in `src/casino.js`).
- **Pools of light:** an additive radial texture on the floor (`pool()` in `src/casinolooks.js`).
- **Warp streaks and tunnel, flash:** camera-space instanced quads (`src/warp.js`).
- **Sparkle bursts on a Chog:** `makeSparkle` in `src/cutscenes.js` (A's).

## Recipes

- **Light shafts (god rays) in the lobby:**
  - A few long thin cones or planes, additive, with a texture that fades along and across. Scroll the dust noise in them slowly.
  - Faded where the camera is close (`smoothstep` on view distance), so they never fill the lens.
  - Not post-process god rays: too dear here.
- **Dust motes:** a few hundred `Points` drifting in a box, moved in the vertex shader (`p = base + sin(t * rate + phase) * amp`). Brightness only where they cross a shaft.
- **Confetti:** instanced small quads.
  - Per instance: a start, a velocity, a spin axis and a colour.
  - Moved in the vertex shader on a launch time uniform, with gravity and a flutter: rotate the quad and modulate fall speed with the spin.
  - Reset by moving the launch time; no CPU per particle.
- **LED floor:** one plane with a shader. A grid of cells, each lit by a pattern function of time and the song's beat (`songTime`), in palette colours. Cheap and readable from afar.
- **Portal swirl:** a disc with a polar-coordinate shader (`atan` angle plus time, `length` radius into spiral bands). A ring of particles spiralling in. The Chog stays solid: use its `setBeam` cut, never squash it flat (the user rejected the flat-Chog look).

## The cloud pass

- The volumetric clouds (`src/volclouds.js`, B4 era) are a post pass that reads scene depth. Transparent effects that write no depth get painted over unless drawn after the clouds: put them in `post.overlay` (the `OverlayPass` in `src/post.js`), like the waterfalls.
- Indoors the clouds fade out (`setIndoor`); in space they go away (`setAway`). Effects in rooms never need the cloud pass.

## Cheap and rich

- Additive, HDR colour (over 1) on small things only, so the bloom gives glow for free. Big additive sheets wash out the frame.
- One instanced draw per effect type. Motion in the shader where possible.
- **Budgets on the HD 520:** under 2,000 particles visible, under 4 extra draw calls per effect, no full-screen passes.
- Every effect has an idle state that's still drawn (count 1, or zero opacity), so the load builds it (B12).
