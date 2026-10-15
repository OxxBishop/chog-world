---
name: skybox-and-space-shot-generation
description: Space scenes for Chog World - the planet, its sky, starfields, nebulae, constellations, debris, and how a space shot is framed. Use when working on src/space.js, src/planet.js, src/cosmos.js or src/warp.js, the loading screen's planet, or any shot that leaves the islands.
---

# Space shots in Chog World

## How space is put together

- `src/space.js` runs the visits (warp out, orbit, dive in) and owns the camera while in space.
- `src/planet.js` is the planet (style `amethyst`, the user's pick): baked maps, ground, clouds, sky shell, rings, moons.
- `src/cosmos.js` is everything round it: a baked nebula cube map, stars, dwarf stars, constellations, the smiling-Chog easter egg, the debris belt.
- `src/warp.js` is warp speed: streaks, the tunnel, the flash.
- **The world is never drawn in space:** the camera sees render layer 1 only, which only space objects are on. They are on layer 0 too, so the load draws them (B12). `camera.layers.set(0)` again on the way back.

## Rules for the look (the user's)

- **Purple throughout.** The planet is Earth-shaped but purple: violet and lilac land, violet seas, pink lagoons, a violet sky rim, a magenta dusk. Space keeps the same hue: indigo night, violet band, rose and a little teal for contrast, never neutral grey or Earth blue.
- Variation, not a copy of Earth: rings, a moon, the debris belt, constellations, dwarf stars.
- The easter egg: about fifty stars now and then swim into a smiling Chog, front on: the spiky fur mane all round its head (a Chog isn't a Chog without it), happy closed eyes with lashes, blush, an open smile, the gold forehead mark. It's built from the user's reference render in `FACE` in `src/cosmos.js`. Changes to how it looks are the user's call.

## Starfields

- Thousands of points on a sphere of radius 500 that follows the camera; `z = w` puts them at infinity.
- Density: uniform, plus about half pulled toward the galaxy band, so the band reads without a texture.
- Brightness: mostly faint (size 1.4 to 2.5 px), about 10% brighter, about 1.5% bright enough to glow. Tints from white through blue, pink and lilac.
- Twinkle: a slow sine each, out of phase. Never fast; that reads as noise.
- Size scales with the pixel ratio (`uScale`).
- The few named stars (dwarf stars, constellation stars) get a core, a halo and four-point spikes (`BRIGHT_FRAG`).

## Nebulae

Bake them once into a cube map, a face tile a frame (`createCosmos().bake()`), then the backdrop is a single texture read.

- Layers: a domain-warped band, thin filaments (`pow(1 - |n|, 7)`), one or two named clouds placed where the shot looks, and dark dust lanes that multiply the bright parts down.
- Keep it dim: the planet has to pop. When in doubt, halve the nebula.

## Framing a planet shot

- Behind the connect screen, the planet sits low and the UI sits over its upper limb and the stars. On a wide screen it's about 2.3 radii out, aimed 0.78 R above the middle; on a tall screen further out.
- **Sun:** front-left (`[-0.55, 0.3, 0.78]` for the amethyst look), so most of the disc is lit and a sliver of night on the right shows the city lights. Light from behind makes a dark disc, which reads as a hole.
- **Never still:** the orbit sways a few degrees, the planet turns, the clouds a little faster, the moons go round, the debris tumbles.
- Constellations and named stars go where the shot looks: upper half, clear of the planet's limb and the title.

## Debris

- Instanced rocks (lumpy icosahedra), a few sizes, and violet glowing shards.
- Orbits and tumbles run in the vertex shader. Lilac dust points go through the belt.
- The belt sits between the planet and the camera's orbit, so the dive goes through it (parallax for free). With rings, it goes outside them, in their plane.
