#!/bin/bash
# [EDIT="..."] newcast.sh <id> [rig overrides] [bake arms out/fwd]: Tripo model -> facing +z, our rig, slim, the cast's clips,
# 2048 colour map as KTX2, renders. Output: public/models/_wip/new/chog-<id>.glb, r3/nc-<id>-*.png
set -e
ID=$1; OVR=${2:-}; ARMS=${3:-}
SCR=/c/Users/HP/AppData/Local/Temp/claude/C--Users-HP-Documents-chog-world/5e7f7d3f-caef-4d49-89c4-0138e5933dbf/scratchpad
REPO=/c/Users/HP/Documents/chog-world
BL=/c/Users/HP/Tools/blender-5.2.2/blender
SCRW=C:/Users/HP/AppData/Local/Temp/claude/C--Users-HP-Documents-chog-world/5e7f7d3f-caef-4d49-89c4-0138e5933dbf/scratchpad
STEP=${STEP:-1}
cd $SCR
if [ "$STEP" -le 1 ]; then
SRC=$(ls w3/tripo-$ID/tripo-out/*/model.glb | tail -1)
$BL -b --factory-startup -P decimate.py -- $SRC $REPO/public/models/_wip/t-$ID-d.glb 30000 -90 2>&1 | grep -E "^faces" || true
# EDIT="arms shoulder=0.37;k=0.6" or EDIT="tail k=0.6": proportions fixed in the mesh before the rig (limb_edit.py).
[ -n "$EDIT" ] && { $BL -b --factory-startup -P $REPO/tools/models/regen/limb_edit.py -- $REPO/public/models/_wip/t-$ID-d.glb $REPO/public/models/_wip/t-$ID-d.glb $EDIT 2>&1 | grep -E "^ARM|^TAIL|Traceback|Error" || true; }
$BL -b --factory-startup -P $REPO/tools/models/rig_chog.py -- $REPO/public/models/_wip/t-$ID-d.glb w3/rig/chog-$ID.glb "Idle,Walk,Run,Wave,Talk,Cheer" "$OVR" 2>&1 | grep -E "LANDMARKS|ARM RADIUS|head zone|Traceback|Error" || true
cd $REPO
node tools/models/slim_cast.mjs $SCR/w3/rig/chog-$ID.glb --out public/models/_wip/new 2>&1 | tail -1
cd $SCR
A=""; [ -n "$ARMS" ] && A="&arms=chog-$ID=$ARMS"
SPEC='Idle:ual:Idle_Loop,Talk:ual:Idle_Talking_Loop,WalkCartoon:ual:Walk_Loop:0.12:0.5:arms=1.6;legs=1.2;spine=1.8;bob=2.5,JogCartoon:ual:Jog_Fwd_Loop:0.12:0.5:arms=1.4;legs=1.1;spine=1.5;bob=2,Wave:robot:Wave:0.12:0.5:arms=2.6;spine=1.4;bob=1.5,Cheer:robot:Jump:0.12:0.5:arms=2;spine=1.4;bob=1.6'
timeout 280 node grab.mjs "http://127.0.0.1:5173/tools/models/bake.html?dir=_wip/new&m=chog-$ID&spec=$SPEC$A" w3/clips-$ID.json 2>&1 | grep -v Assert
cd $REPO
node tools/models/fix/addclips.mjs $SCR/w3/clips-$ID.json public/models/_wip/new chog-$ID
fi
cd $REPO
# The colour map at 2048 (slim_cast's is 1024), as KTX2 with the rest.
rm -rf $SCR/w3/dd-$ID && node tools/models/fix/dump.mjs public/models/_wip/t-$ID-d.glb $SCR/w3/dd-$ID >/dev/null
B=$(python -c "import json;i=json.load(open(r'$SCRW/w3/dd-$ID/model.json'));print(i['materials'][0]['base'])")
BF=$(cd $SCR/w3/dd-$ID && ls img$B.* | head -1)
python -c "from PIL import Image; Image.open(r'$SCRW/w3/dd-$ID/$BF').convert('RGB').save(r'$SCRW/w3/dd-$ID/base2048.png')"
cp public/models/_wip/new/chog-$ID.glb $SCR/w3/pre-ktx-$ID.glb
python $SCRW/orm_fix.py $SCRW/w3/dd-$ID $SCRW/w3/dd-$ID/orm1024.png
node tools/models/fix/ktx2.mjs $SCR/w3/pre-ktx-$ID.glb public/models/_wip/new/chog-$ID.glb --base $SCR/w3/dd-$ID/base2048.png --rmmap $SCR/w3/dd-$ID/orm1024.png 2>&1 | tail -1
[ -n "$NORENDER" ] && { echo DONE $ID; exit 0; }
cd $SCR
timeout 100 node shot.mjs "http://127.0.0.1:5173/tools/models/view.html?f=/models/_wip/new/chog-$ID.glb&v=front,threeq,side,back&size=400" r3/nc-$ID-view.png 1600 400 "window.__done" 2>&1 | grep -v Assert
for mv in walk run wave; do timeout 150 node shot.mjs "http://127.0.0.1:5173/tools/models/pose.html?m=../_wip/new/chog-$ID&move=$mv&t=0.6,0.75,0.9,1.05,1.2&v=front,threeq,side&size=260" r3/nc-$ID-$mv.png 1300 780 "window.__done" 2>&1 | grep -v Assert; done
echo DONE $ID
