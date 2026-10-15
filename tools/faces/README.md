# Faces

Each cast model's expression sheet (`public/faces/<name>.png`, 6 eye states over 6 mouth states) and
`faces.json` (how the model's own vertices map onto its sheet). `src/chog.js` lays the current eye and
mouth state over the painted face in its shader.

Rebuild, with `npx vite` running on port 5174:

1. `node grab.mjs "http://localhost:5174/tools/faces/capture.html?m=<name>" faces/<name>` for each model
   (a front, unlit, orthographic capture of the head and the projection that made it).
2. `python detect.py` finds each face's skin, eyes and mouth (`faces/detect.json`); check `faces/*_det.jpg`.
3. `python build.py [names]` paints the old features out and builds every state from the cast's own art
   (`faces/out/<name>.png`, previews in `faces/out/<name>_preview.jpg`). Per-model settings are `CFG`.
4. `python export.py` copies them into `public/faces/`.

Needs numpy, scipy and Pillow. The sniffer faces sideways and has no sheet yet.
