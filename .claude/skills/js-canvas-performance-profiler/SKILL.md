---
name: js-canvas-performance-profiler
description: Finding and fixing frame-time problems in Chog World - shader first-draw stalls, GC spikes from allocation in the frame loop, long GPU jobs, draw calls and state changes - for the user's Intel HD 520 and phones. Use before pushing anything that renders, and whenever ?debug shows long frames.
---

# Performance in Chog World

The bar: no frame after the first over 500 ms (B12), usable at `?q=low` on an Intel HD 520, smooth on a phone.

## The four things that cost frames here, in order

1. **First-draw shader stalls** (the big one). On Intel/ANGLE the driver builds a program the first time it draws with it, for each new pair of program and vertex layout. A stall of 0.2 to 20 s.
   - Fix: draw every material behind the loader (`warmUp`, `drawOnce`, `prewarm`).
   - Check: the stall checker wraps `useProgram`, `bindVertexArray`, `vertexAttribPointer` and the `draw*` calls in an init script and reports new (program, layout, target) pairs per phase. Run it through every flow you touched (guest, demo, the casino, space). Target: 0 new pairs after the loader.
   - Lazily built sets (an NPC set the first time you come near) must warm a throwaway copy during the load (see the stage lights in `src/npcs.js`).
2. **Long GPU jobs.** One draw that takes seconds trips the Windows GPU watchdog. Split big bakes into scissored tiles over frames (`src/planet.js`, `src/cosmos.js`).
3. **Garbage in the frame loop.** No `new THREE.Vector3/Color/Matrix4` in `update()`; keep scratch objects at module or closure level and `copy()` into them. No array `map`/`filter` making new arrays per frame on hot paths. No string building per frame except when the text changed (compare first).
4. **Draw calls and overdraw.** Instance repeated things (`InstancedMesh` or `InstancedBufferGeometry`). Move motion into the vertex shader instead of updating matrices. Big transparent sheets (sky shells, glows) cost overdraw: keep them to the area they need.

## Habits

- **Dynamic buffers:** set `setUsage(THREE.DynamicDrawUsage)`, update only the used range, set `needsUpdate` once.
- **Shadows** are manual here (`renderer.shadowMap.autoUpdate = false`); never flip `castShadow` at runtime (it recompiles programs).
- **CSS:** `filter: blur()` on the canvas is a full-screen compositor pass. Keep it brief, smaller on `?q=low`. `backdrop-filter` likewise.
- **Measure, don't guess:** `?debug` (fps, draw calls, toggles), Chrome's Performance panel with 4x CPU throttle, `renderer.info.programs.length` before and after a feature.
- **Headless checks** run on SwiftShader (CPU): slow but deterministic. Hold `performance.now()` and step `frame()` yourself so timing is exact; the frame's `dt` is clamped to 0.05 s, so run a cutscene for `seconds / 0.05` steps.
