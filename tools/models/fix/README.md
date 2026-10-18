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
`anim.html` (a retargeted clip on a checkered floor, with its natural ground speed), `clipspeed.html`
(each model's walk and run speeds, both measures).

Since 10-16 (A13, A14):
- **Walks:** the user's picks, `WalkCartoon` and `JogCartoon`, are baked into every walking Chog:
  `bake.html?m=<models>&spec=WalkCartoon:ual:Walk_Loop:0.12:0.5:arms=1.6;legs=1.2;spine=1.8;bob=2.5,JogCartoon:ual:Jog_Fwd_Loop:0.12:0.5:arms=1.4;legs=1.1;spine=1.5;bob=2`,
  then `addclips.mjs`. The world plays them at 1.7x and 1.3x (`CLIP_RATE` in `src/traitmap.js`).
- **Hands out of robes** (the user: King Pom's "hands keep entering their cloak"): `handcheck.html` measures how
  much of each hand ends up inside the body in each clip. Three needed their arms held wider for Idle, Talk,
  WalkCartoon and JogCartoon: `bake.html?...&arms=chog-409=0.6/0.45;chog-66=0.45/0.25;chog-68=0.45/0.25`
  (out/forward, radians; `armsFwd` in `retarget.js`). The rest measure 0 at the default.
- **King Pom's mane** (the user: "the bottom one is overextended"): `mane.py` takes the mane off his arm
  bones and puts it back where Tripo had it (the longer arms had pushed the lowest spike out), then
  `patch.mjs` writes it into the shipped file in its own vertex order.
- **2048 colour maps:** `upres.py` rebuilds each model's colour map at 2048 in its current layout from the
  originals in git (`git show 6f5f217^:public/models/npcs/<name>.glb`, dumped with `dump.mjs` to
  `<work>/o2k-<name>`), keeping the colour fixes. `ktx2.mjs <in> <out> --base <name>.png` writes it in
  with every texture as KTX2 (needs KTX-Software's toktx). The shipped files hold KTX2: run any step
  that edits images (`apply.mjs`, `patch.mjs --base`, `dump.mjs` images) on a JPEG copy, then `ktx2.mjs`
  last. Face sheets: `public/faces/<name>.ktx2`, the PNG flipped top to bottom, ETC1S.
- **Wave and cheer** (A13): from RobotExpressive (Quaternius, CC0; put it at `public/models/_wip/src/robot.glb`
  from https://github.com/mrdoob/three.js/tree/r170/examples/models/gltf/RobotExpressive). It rests with its
  arms down, so `bake.html` measures it from straightened arms (`srcTPose` in `retarget.js`):
  `spec=Wave:robot:Wave:0.12:0.5:arms=2.6;spine=1.4;bob=1.5,Cheer:robot:Jump:0.12:0.5:arms=2;spine=1.4;bob=1.6`,
  with the same `&arms=` as the hands fix.
- **The singer's layout** (A14): `relayout.py` (Blender: weld, re-unwrap at `unwrap=80`, the head 2.5x and the
  stage 0.12x the area, pack; 27% of the atlas used before, 57% after), then `relayout_tex.py` (the shipped
  colours resampled into it; `detail=0`, since the singer's own 2048 original carries Tripo's junk patterns),
  then `apply.mjs --corners` and `ktx2.mjs`. Texel density 52 to 178 texels/m on the body, 84 to 303 on the head.
- **The singer, rebuilt on the plain Chog's body** (the user, 10-16): `singer_rebuild.mjs <plain.glb> <old singer,
  JPEG> <out> 0.06,0,0,25,0,0` keeps the old file's stage disc (the triangles only its Root holds, with its texture),
  lifts the plain body onto it (the Root joint up 0.258) and puts a new mic in the right hand (tilted 25 degrees
  toward the mouth). Sing comes from the old singer (`public/models/_wip/src/singer-tripo.glb`, the file before
  10-16 in git) through `bake.html`, measured from straightened arms, with extra lift for the shorter arm:
  `spec=Sing:singer:Sing:0:0.5:::UpperArmR@x@-44;ForeArmR@x@-42;UpperArmR@y@35`. Then `ktx2.mjs`. Its face sheet
  is the plain Chog's (`faces.json` "singer").
- **The user's notes of 10-17** (`cleanup.py`): `node dump.mjs <shipped.glb> <work>/<name>`, then
  `ktx extract --transcode rgba8 <work>/<name>/img<base>.jpg <work>/<name>/base.png` (the colour map out of
  its KTX2), then `python cleanup.py <work>/<name> <work>/<name>/base.png <out> <tasks>`: `hands` (the pink
  over the whole hand: plain, singer, chog-1151, chog-66), `back` and `cords` (chog-52: its shirt's back
  cleaned; its hat cords cut where they met the sleeve, the stick on the head). For cords, `patch.mjs <glb>
  <tmp> --joints <out>/joints.f32 --weights <out>/weights.f32 --index <out>/index.u32` first. Last,
  `ktx2.mjs <glb> <shipped.glb> --base <out>/base.png` (the body's colour map only; a stage keeps its own).
  Checks: `tools/models/pose.html` (the world's own Chogs in a move, from any side) and `headturn.html`.
- **10-18** (`cleanup.py`, same steps): `head sides hips` on every cast model, plus `duck` (chog-66) and
  `spill blush` (chog-56); `back` on chog-52 now lays the shirt and hem in straight bands. Run each from the
  shipped file of 10-17 (the tasks are not meant to be run twice on the same weights).
- **10-18, later** (`cleanup.py`, from the shipped files of 10-17 again): `head sides hips` on every cast model
  (`head` reworked: each head held wholly down to its neck), `duck` on chog-66 as before (chog-52 and chog-56
  keep the colour maps painted earlier that day), and King Pom `head sides hips robe shoulders sleeves`.
  `sleeves` reads `<out>/stretch.bin`: build once without it, open
  `tools/models/stretchmoves.html?m=chog-409&poses=idle:0.5,run:0.6,...` under vite, save `window.__out`
  (base64 Float32, one value per triangle) there, then build again.
- **Picker portraits**: `tools/models/portraits.html` renders each Chog's loop (one clip length at 20 fps) as
  JPEG frames; pack them with Pillow into animated WebP (`save_all`, `duration=50`, `loop=0`, `quality=65`,
  `method=6`), 320 px, into `public/faces/portraits/<id>.webp`.
