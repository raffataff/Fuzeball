# trailer-edit: assembles the trailer from tools/build/trailer/edl.json in Blender's sequencer and renders it
#   blender -b --factory-startup --python tools/trailer-edit.py -- <edl.json> <out.mp4 | out_dir/> [--draft] [--mix=<wav>] [--range=a:b] [--quality=high|perc_lossless]
# an out path ending in / renders JPEG frames (for contact sheets) instead of a movie
# strips alternate channels 1/2; cards (PNG with alpha) sit on 4+, flashes and the fade from black above them, the mix on its own channel
import bpy, sys, os, json

argv = sys.argv[sys.argv.index('--') + 1:]
edl_path, out = argv[0], argv[1]
opt = {a.split('=')[0][2:]: (a.split('=', 1)[1] if '=' in a else True) for a in argv[2:] if a.startswith('--')}
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
E = json.load(open(edl_path))
draft = bool(opt.get('draft'))
W, H = (960, 540) if draft else (E['w'], E['h'])

sc = bpy.context.scene
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
sc.render.fps, sc.render.fps_base = E['fps'], 1
sc.frame_start, sc.frame_end = 1, E['len']
if opt.get('range'):
    a, b = opt['range'].split(':'); sc.frame_start, sc.frame_end = int(a) + 1, int(b)
sc.view_settings.view_transform = 'Standard'
sc.view_settings.look = 'None'
sc.view_settings.exposure, sc.view_settings.gamma = 0, 1
sc.sequencer_colorspace_settings.name = 'sRGB'
ed = sc.sequence_editor_create()
S = ed.strips

def seq(name, d, first, n, ch, start, ext='.jpg'):
    d = os.path.join(ROOT, d)
    files = ['frame_%05d%s' % (first + i, ext) for i in range(n)]
    have = [f for f in files if os.path.exists(os.path.join(d, f))]
    if len(have) < n:
        print('MISSING', name, d, '%d of %d' % (len(have), n))
        if not have: return None
    st = S.new_image(name=name, filepath=os.path.join(d, have[0]), channel=ch, frame_start=start + 1, fit_method='FIT')
    for f in files[1:]:
        st.elements.append(f if f in have else have[-1])
    st.colorspace_settings.name = 'sRGB'
    return st

# --- the footage ---
for i, s in enumerate(E['strips']):
    d = s['dir'] + ('_d' if draft else '')
    st = seq(s['id'], d, s['first'], s['len'], 1 + (i % 2), s['start'])

# --- cards: PNG sequences with alpha over the footage ---
for i, c in enumerate(E.get('cards', [])):
    st = seq('card_' + c['name'], os.path.join('tools', 'build', 'trailer', 'cards', c['name']), 1 + c.get('skip', 0), c['len'], 4 + (i % 3), c['start'], '.png')
    if st: st.blend_type = 'ALPHA_OVER'

def color(name, rgb, ch, start, n, blend, keys):
    st = S.new_effect(name=name, type='COLOR', channel=ch, frame_start=start + 1, length=n)
    st.color = rgb; st.blend_type = blend
    for f, a in keys:
        st.blend_alpha = a; st.keyframe_insert('blend_alpha', frame=start + 1 + f)
    return st

# --- flashes (additive white pops on hits) and the fade from black ---
for i, f in enumerate(E.get('flashes', [])):
    n = f.get('len', 6)
    color('flash%d' % i, tuple(f.get('rgb', (1, 1, 1))), 8, f['start'], n, f.get('blend', 'ADD'), [(0, f.get('a', 0.8)), (n - 1, 0.0)])
for i, f in enumerate(E.get('fades', [])):
    color('fade%d' % i, (0, 0, 0), 9, f['start'], f['len'], 'ALPHA_OVER', [(0, f['a0']), (f['len'] - 1, f['a1'])])

# --- sound ---
mix = opt.get('mix')
if mix and os.path.exists(mix):
    snd = S.new_sound(name='mix', filepath=os.path.abspath(mix), channel=12, frame_start=1)

# --- render ---
ims = sc.render.image_settings
sc.render.use_sequencer = True
if out.endswith('/') or out.endswith('\\'):
    os.makedirs(out, exist_ok=True)
    if hasattr(ims, 'media_type'): ims.media_type = 'IMAGE'
    ims.file_format = 'JPEG'; ims.quality = 90
    sc.render.filepath = os.path.join(os.path.abspath(out), 'f_')
else:
    if hasattr(ims, 'media_type'): ims.media_type = 'VIDEO'
    ims.file_format = 'FFMPEG'
    ff = sc.render.ffmpeg
    ff.format, ff.codec = 'MPEG4', 'H264'
    ff.constant_rate_factor = opt.get('quality', 'perc_lossless').upper()
    ff.ffmpeg_preset = 'BEST'
    ff.gopsize = E['fps'] // 2
    ff.use_max_b_frames = True; ff.max_b_frames = 2
    if mix:
        ff.audio_codec = 'AAC'; ff.audio_bitrate = 320; ff.audio_mixrate = 48000; ff.audio_channels = 'STEREO'
    else:
        ff.audio_codec = 'NONE'
    sc.render.filepath = os.path.abspath(out)
bpy.ops.render.render(animation=True)
print('rendered', out, sc.frame_start, sc.frame_end)
sys.stdout.flush()
