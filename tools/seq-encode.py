# seq-encode: a frame sequence (frame_00001.jpg ...) to an H.264 MP4 through Blender's sequencer (no ffmpeg on the machine)
#   blender -b --factory-startup --python tools/seq-encode.py -- <frames dir> <fps> <out.mp4> [quality: high|perc_lossless|lossless]
# colour passes through untouched: Standard view transform, sRGB strips
import bpy, sys, os

args = sys.argv[sys.argv.index('--') + 1:]
src, fps, out = os.path.abspath(args[0]), int(args[1]), os.path.abspath(args[2])
qual = (args[3] if len(args) > 3 else 'perc_lossless').upper()
files = sorted(f for f in os.listdir(src) if f.startswith('frame_') and f.lower().endswith(('.jpg', '.png')))
if not files:
    sys.exit('no frames in ' + src)

sc = bpy.context.scene
img = bpy.data.images.load(os.path.join(src, files[0]))
w, h = img.size
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
sc.render.fps, sc.render.fps_base = fps, 1
sc.frame_start, sc.frame_end = 1, len(files)
sc.view_settings.view_transform = 'Standard'
sc.view_settings.look = 'None'
sc.view_settings.exposure, sc.view_settings.gamma = 0, 1
sc.sequencer_colorspace_settings.name = 'sRGB'

ed = sc.sequence_editor_create()
coll = ed.strips if hasattr(ed, 'strips') else ed.sequences
st = coll.new_image(name='seq', filepath=os.path.join(src, files[0]), channel=1, frame_start=1)
for f in files[1:]:
    st.elements.append(f)
st.colorspace_settings.name = 'sRGB'

ims = sc.render.image_settings
if hasattr(ims, 'media_type'):
    ims.media_type = 'VIDEO'
ims.file_format = 'FFMPEG'
ff = sc.render.ffmpeg
ff.format, ff.codec = 'MPEG4', 'H264'
ff.constant_rate_factor = qual
ff.ffmpeg_preset = 'GOOD'
ff.gopsize = fps // 2
ff.audio_codec = 'NONE'
sc.render.use_sequencer = True
sc.render.filepath = out
bpy.ops.render.render(animation=True)
print('wrote', out, len(files), 'frames', w, 'x', h, '@', fps)
sys.stdout.flush()
