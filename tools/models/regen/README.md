# The cast regenerated from the NFT art (A, 10-21)

The user's call (10-21): every Chog in the world remade from its own NFT art, closer to it than the first
Tripo round. Steps per Chog:

1. **Picture (Nano Banana, in Gemini):** the NFT art + the #43 result as the style reference + a spikes
   reference, with a prompt that names every trait (see `prompts.md`), asking for a straight front T-pose on
   white. Gemini refused #422 ("third-party content"); #471 took its place.
2. **3D model (Tripo CLI, `tripo`):** `tripo make nbt-<id>.png --json --yes --no-open -p face_limit=30000 -o <dir>`
   (image to model, v3.1, 30 credits). No Tripo rig: we rig ourselves.
3. **`newcast.sh <id> [rig overrides]`** (written for A's work folder; read it for the steps):
   `decimate.py` (Blender: under 30k triangles, turned to face +z), `../rig_chog.py` (our rigger: bones from
   the mesh, heat weights, the head held, the torso core off the limbs, and since 10-21 the shoulder tops off
   the arms, a tail on the hips, weights smoothed round hips and shoulders), `../slim_cast.mjs`, the cast's
   clips through `../bake.html` + `../fix/addclips.mjs`, the 2048 colour map and `orm_fix.py` (no metal:
   Tripo marked whole suits metallic and they rendered dark) through `../fix/ktx2.mjs`.
4. **Per model:** King Pom `shoulder=0.40` (his fur collar fooled the shoulder finder); Quackers re-baked with
   `&arms=chog-66=0.7/0.5` (hands clear of the float) and `float_fix.py` (the float rides the hips, rigid).
   Cosmo is built without his glass helmet (Tripo made it an opaque shell); `src/chog.js` `bubbleHelmet`
   draws the glass.
5. **Faces:** `tools/faces` (README there): `capture.html?m=chog-<id>&f=<file>`, `detect.py`, `build.py`
   (CFG per model, new: `keep_blue` keeps drool over every mouth, `mk` scales the drawn mouths),
   `export.py <names>` (merges into faces.json, writes the KTX2).
6. **Checks:** `../view.html`, `../pose.html` (walk, run, wave), `../stretchmoves.html` (triangles that
   stretch; the ones hidden under a big head count too, so look as well), `../handcheck.html`.
