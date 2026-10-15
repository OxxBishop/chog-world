# Cast model fixes (A, the user's notes of 2026-10-15)

Rebuilds every cast model from its original Tripo file. Work folder: anywhere outside the repo, holding
`orig/<name>.glb` (the originals), `<name>/` (`node dump.mjs orig/<name>.glb <name>`), `k-<name>/` (`reskin.py`).

1. `blender --background --python reskin.py -- orig/<name>.glb k-<name> <name>/bones.json [keep.u8]`: Blender
   heat weights on a welded copy (Tripo's tear at the shoulders).
2. `python run.py <work> <names...>`: per model (CONFIG in run.py): the skin blended (heat weights round the
   shoulders and inside each arm's own volume, Tripo's everywhere else, so arms never drag a head, chest or
   robe), the atlas repacked with gutters (`repack.py`: islands moved pixel for pixel, no resampling, so
   colours stop bleeding between islands from a distance), the colour fixes (`edits.py`: the light pink on
   hands and feet only, the duck float, the astronaut's suit, the singer's face and mouth), the King's longer
   arms, written over `public/models/npcs/<name>.glb` (`apply.mjs`).
   The singer is re-unwrapped instead (`atlas.py ... smart=1 body=3`: it came in thousands of tiny islands).
3. Clips: `tools/models/bake.html` retargets Quaternius Universal Animation Library clips (CC0) onto the
   Chog rig (`tools/models/retarget.js`), `addclips.mjs` writes them in. Run it after step 2 (which starts
   from the originals): today Idle (Idle_Loop) and Talk (Idle_Talking_Loop).

Checks: `tools/models/review.html` (the world's shader and faces), `stretch.html` (skin tearing),
`anim.html` (a retargeted clip on a checkered floor, with its natural ground speed).
