"""
The demo video's edit, in headless Blender's sequencer (there is no ffmpeg here; Blender carries its own):
  blender -b --factory-startup -P tools/demo/edit.py -- <frames root> <music.mp3> <out.mp4> [test]
Shots are frame folders (24 fps, 1280x720) captured from the live app (?demo=<shot>&capture); titles are
PNG cards laid over them; the island theme underneath, faded in and out.
"""
import sys, os, bpy
args = sys.argv[sys.argv.index('--') + 1:]
root, music, out = args[0], args[1], args[2]
test = len(args) > 3
FPS, XF = 24, 20  # crossfade frames

# (shot folder, title png or None, frames to use)
EDIT = [
    ('arrival', None, None),
    ('overview', 'title-world', None),
    ('sky', 'title-sky', None),
    ('singer', 'title-singer', None),
    ('bar', 'title-hub', None),
    ('jackpot', 'title-casino', None),
    ('sale', 'title-sale', None),
    ('end', None, None),
]
scene = bpy.context.scene
scene.render.fps = FPS
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1280, 720, 100
se = scene.sequence_editor_create()
strips = se.strips if hasattr(se, 'strips') else se.sequences
frame, prev, ch = 1, None, 1
for shot, title, use in EDIT:
    d = os.path.join(root, shot)
    files = sorted(f for f in os.listdir(d) if f.endswith(('.jpg', '.png')))
    if test: files = files[:24]
    if use: files = files[:use]
    s = strips.new_image(shot, os.path.join(d, files[0]), ch, frame if prev is None else frame - XF)
    for f in files[1:]: s.elements.append(f)
    # (The end card is one still, held four seconds.)
    s.frame_final_duration = 4 * FPS if shot == 'end' else len(files)
    if prev is not None:
        # A crossfade from the last shot into this one.
        ch = 2 if ch == 1 else 1
        s.channel = ch
        fx = strips.new_effect(name=f'x-{shot}', type='CROSS', channel=3, frame_start=s.frame_final_start, length=prev.frame_final_end - s.frame_final_start, input1=prev, input2=s)
    if title:
        t = strips.new_image(title, os.path.join(root, 'titles', title + '.png'), 5, s.frame_final_start + 6)
        t.frame_final_duration = min(len(files) - 24, 4 * FPS)
        t.blend_type = 'ALPHA_OVER'
        # Titles fade in and out slowly, in the manner of a Zelda trailer.
        a0, a1 = t.frame_final_start, t.frame_final_end
        for k, v in [(a0, 0.0), (a0 + 18, 1.0), (a1 - 18, 1.0), (a1, 0.0)]:
            t.blend_alpha = v
            t.keyframe_insert('blend_alpha', frame=k)
    frame = s.frame_final_end
    prev = s
scene.frame_start, scene.frame_end = 1, frame - 1
a = strips.new_sound('music', music, 6, 1)
a.volume = 0.8
end = scene.frame_end
for k, v in [(1, 0.0), (24, 0.8), (end - 48, 0.8), (end, 0.0)]:
    a.volume = v
    a.keyframe_insert('volume', frame=k)
r = scene.render
if hasattr(r.image_settings, 'media_type'): r.image_settings.media_type = 'VIDEO'
r.image_settings.file_format = 'FFMPEG'
r.ffmpeg.format = 'MPEG4'
r.ffmpeg.codec = 'H264'
r.ffmpeg.constant_rate_factor = 'HIGH'
r.ffmpeg.ffmpeg_preset = 'GOOD'
r.ffmpeg.audio_codec = 'AAC'
r.ffmpeg.audio_bitrate = 192
r.filepath = out
bpy.ops.render.render(animation=True)
print('RENDERED', out, scene.frame_end, 'frames')
