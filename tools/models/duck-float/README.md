# The duck float on chog-66

Tripo's texture had the body's purple bleeding onto the float, and nothing showed where the float meets
the body. This cleans and shades the colour map, and swaps it into the GLB without touching anything else.

1. `blender --background --python bake.py`: finds the float's faces (its yellow faces, grown into stained
   neighbours on its top and underside), the band where it meets the body, and bakes ambient occlusion
   (`work/`). `blender --background --python viz.py` renders them red and blue to check.
2. `python texture.py`: paints the purple on the float with the float's own yellow round it, the yellow
   that spilled onto the body back to purple, and lays the baked occlusion on the join only
   (`work/basecolor_fixed.jpg`).
3. `python repack.py <in.glb> 1 work/basecolor_fixed.jpg <out.glb>`: puts it in as image 1 (the base colour).

Already applied to `public/models/npcs/chog-66.glb`; rerun only from the original export.
