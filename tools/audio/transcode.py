"""
Re-encode a track for the web in headless Blender (its FFmpeg; there is no ffmpeg on this machine):
  blender -b --factory-startup -P tools/audio/transcode.py -- <in> <out.mp3> [kbps] [fade seconds]
MP3 for every browser (Safari included). fade fades the head and tail in and out (0 keeps them).
"""
import sys, bpy
args = sys.argv[sys.argv.index('--') + 1:]
src, out = args[0], args[1]
kbps = int(args[2]) if len(args) > 2 else 96
fade = float(args[3]) if len(args) > 3 else 0.0
scene = bpy.context.scene
scene.render.fps = 100
se = scene.sequence_editor_create()
strips = se.strips if hasattr(se, 'strips') else se.sequences
strip = strips.new_sound('track', src, 1, 1)
end = strip.frame_final_end
scene.frame_start, scene.frame_end = 1, end - 1
if fade > 0:
    f = int(fade * scene.render.fps)
    strip.volume = 0.0
    strip.keyframe_insert('volume', frame=1)
    strip.volume = 1.0
    strip.keyframe_insert('volume', frame=1 + f)
    strip.keyframe_insert('volume', frame=end - 1 - f)
    strip.volume = 0.0
    strip.keyframe_insert('volume', frame=end - 1)
bpy.ops.sound.mixdown(filepath=out, check_existing=False, container='MP3', codec='MP3', format='S16', bitrate=kbps, mixrate=44100, accuracy=1024)
print('MIXED', out, (end - 1) / scene.render.fps, 's')
