---
name: webgl-webgpu-shader-authoring
description: Writing GLSL for three.js r186 ShaderMaterial in Chog World (planets, atmospheres, nebulae, warp, glows, GPU noise). Use when adding or changing any custom shader, baking a procedural texture on the GPU, or when a shader looks wrong (seams, banding, NaNs, wrong colour space) or costs too much on the HD 520.
---

# Shader authoring for Chog World (three.js r186, WebGL2)

## The rules that keep a shader from breaking the build or the HD 520

1. **Every new material is drawn behind the loader** (B12). The Intel/ANGLE driver builds a shader on its *first draw*, which freezes the page. The material has to be in an object the load draws (`warmUp` / `drawOnce` in `src/main.js`, or a group passed to `prewarm`). Hidden parts are drawn too (`all: true`).
2. **Program count matters.** `defines` make a new program per value; uniforms don't. Use defines only for a choice made once (a style), uniforms for anything that changes.
3. **No heavy noise per pixel per frame.** Several `fbm` calls over the whole screen will drop the HD 520 below 30 fps. Bake it once into a texture (see below) and sample that.
4. **Colour space:** end every fragment shader with `#include <colorspace_fragment>`. Work in linear inside. Colours typed as sRGB hex go through `THREE.Color` (it converts), or `pow(c, vec3(2.2))` in GLSL.
5. **HDR for glow:** the bloom (src/post.js) picks up values over about 0.85. Signs and stars go over 1 on purpose; everything else stays under.
6. **`smoothstep(a, b, x)` needs `a < b`.** Reversed edges are undefined in GLSL. Write `1.0 - smoothstep(b, a, x)`.

## Patterns that work here

- **Bake on the GPU, in tiles.** A full-screen quad renders the procedural maps into a `WebGLRenderTarget` (equirect) or `WebGLCubeRenderTarget` (sky), a few scissored tiles a frame, so no single GPU job runs long. See `src/planet.js` `bake()` and `src/cosmos.js`. Set the scissor on the render target, `renderer.setRenderTarget(rt, face)`, render, restore the old target and `autoClear`.
- **Equirect seam:** sample with `textureGrad` and take the uv slope from whichever side of the seam is smooth (`tex()` in `src/planet.js`), or the mipmaps draw a line down the back.
- **Gradient noise** (quintic fade) for anything organic; value noise only where it's tiny or blurred. `ridged = (1 - |n|)^2` for crests. Domain-warp (`p + fbm(p) * k`) for coasts and nebula wisps.
- **Far-plane sky:** `gl_Position = p.xyww` (or `z = w`) puts a backdrop or a star behind everything with `depthWrite: false`; `renderOrder = -1`.
- **Atmosphere from outside** (cheap, reads as Rayleigh): a shell 5 to 7% bigger, `BackSide`, additive; brightness from how close the view ray passes the surface (closest-approach distance), colour from the sun angle at that point (day blue-violet, dusk magenta, night faint). Full Rayleigh/Mie ray-marching is too dear here; if ever needed, 8 view steps x 4 light steps at half resolution, never on the HD 520 path.
- **Instanced motion in the vertex shader:** per-instance attributes (orbit radius, angle, speed, tumble axis) and a time uniform move thousands of rocks or streaks with no CPU work (`src/cosmos.js` debris, `src/warp.js` streaks).
- **Faceted low-poly look:** `normalize(cross(dFdx(vWorld), dFdy(vWorld)))` in the fragment shader, flipped toward the view.
- **Camera-space effects** (warp streaks, the flash): `gl_Position = projectionMatrix * vec4(viewSpacePos, 1.0)` ignores where the mesh is; set `frustumCulled = false`.

## Checklist before pushing a shader

- Draw it once in the lab or the app and read the console (three prints the whole source on a compile error).
- Look at it at `?q=low` and on a phone-sized viewport.
- Run the stall checker (`firstdraws.mjs` pattern: wrap `useProgram`/`draw*` and report new program and vertex-layout pairs after the loader). Zero new pairs.
