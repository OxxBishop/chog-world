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
  `<work>/o2k-<name>`), keeping the colour fixes. `patch.mjs --base` writes it in.
