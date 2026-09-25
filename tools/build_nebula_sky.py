"""
build_nebula_sky.py  --  Fuzeball VOID room sky -> six cube faces (PNG masters)

Run headless from the project root:

    blender -b -P tools/build_nebula_sky.py -- [--res 2048] [--verify] [--preview] [--seed 7]

then encode the masters for the game:

    node tools/sky-encode.mjs tools/build/sky/void assets/rooms/void/sky/nebula

WHAT IT MAKES
    tools/build/sky/void/nebula_{px,nx,py,ny,pz,nz}.png   8-bit sRGB masters, --res square
    tools/build/sky/void/nebula_cross.png                 (--preview) a small cross for eyeballing

HOW
    1. The GAS is a world shader (layered noise in the Federation palette), rendered by EEVEE through
       six 90-degree cameras, straight to float EXR. No geometry, so it is a few seconds per face.
    2. The STARS are splatted afterwards in numpy, at the final resolution, so they stay crisp points
       instead of being resampled blobs. Denser along the gas band, like a galactic plane.
    3. The result is pre-compensated for the game's tone mapping (CONFIG.render: reinhard x1.08, which
       r128 also runs on scene.background), dithered, and written as 8-bit PNG.

THE CUBE CONVENTION IS THREE.JS r128's, NOT BLENDER'S. Faces are written so that
`new THREE.CubeTexture(faces)` (which samples with x flipped, `_needsFlipEnvMap`) shows the sky the
right way round, with game axes: X = long axis, Y = up, Z = width. The face bases below are the
OpenGL cube-map spec with image row 0 at the top (three uploads cube faces with flipY=false).
--verify renders a direction-coloured world instead and checks every face against the analytic
directions the stars use, so the two halves can never disagree.

PALETTE (DIRECTION.md section 3): deep space #07111C, Federation blue #123F5E, steel #6BAABC,
ice #BCDCED, copper #B8621F, gold #F0B24A (small, hot cores only). Deliberately NOT magenta/cyan.
"""
import bpy, os, sys, math
import numpy as np
from mathutils import Matrix, Vector

# ---- args --------------------------------------------------------------------------------------
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None, flag=False):
    if name not in argv: return default
    if flag: return True
    return argv[argv.index(name) + 1]
RES     = int(arg('--res', 2048))
VERIFY  = arg('--verify', flag=True)
PREVIEW = arg('--preview', flag=True)
SEED    = int(arg('--seed', 7))
SAMPLES = int(arg('--samples', 16))

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT  = os.path.join(ROOT, 'tools', 'build', 'sky', 'void')   # masters stay out of assets/ (gitignored, never shipped)
TMP  = os.path.join(OUT, '_tmp')
os.makedirs(TMP, exist_ok=True)

# ---- the look (tune here) ----------------------------------------------------------------------
TONEMAP_EXPOSURE = 1.08          # CONFIG.render.exposure, reinhard
BAND_TILT_DEG    = 24            # how far the gas band leans off the horizon (game up = Blender Z)
BAND_YAW_DEG     = 35
BAND_WIDTH       = 0.30          # in dot(dir, bandNormal) units, ~17 degrees
GAS_GAIN         = 1.15          # overall nebula brightness (display-referred, pre tone map)
STARS            = 16000         # at 2048; scaled with the face area
STAR_BAND_BIAS   = 0.55          # fraction of stars drawn from the band rather than uniformly

def hexlin(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]

# ---- cube faces: three.js r128 convention -----------------------------------------------------
# GL direction for pixel (u right, v down, both -1..1): center + u*right + v*down
FACES = {
    'px': ((1, 0, 0), (0, 0, -1), (0, -1, 0)),
    'nx': ((-1, 0, 0), (0, 0, 1), (0, -1, 0)),
    'py': ((0, 1, 0), (1, 0, 0), (0, 0, 1)),
    'ny': ((0, -1, 0), (1, 0, 0), (0, 0, -1)),
    'pz': ((0, 0, 1), (1, 0, 0), (0, -1, 0)),
    'nz': ((0, 0, -1), (-1, 0, 0), (0, -1, 0)),
}
def gl_to_game(g):   return np.stack([-g[..., 0], g[..., 1], g[..., 2]], -1)        # three's flipEnvMap
def game_to_bl(w):   return np.stack([w[..., 0], -w[..., 2], w[..., 1]], -1)        # glTF: game Y up = Blender Z
def bl_to_game(b):   return np.stack([b[..., 0], b[..., 2], -b[..., 1]], -1)
def game_to_gl(w):   return np.stack([-w[..., 0], w[..., 1], w[..., 2]], -1)

def face_dirs(face, n):
    """Unit GAME-space direction of every pixel centre, row 0 = top. Shape (n, n, 3)."""
    c, r, d = (np.array(x, float) for x in FACES[face])
    t = (np.arange(n) + 0.5) / n * 2 - 1
    u, v = np.meshgrid(t, t)                       # u across columns, v down rows
    g = c + u[..., None] * r + v[..., None] * d
    w = gl_to_game(g)
    return w / np.linalg.norm(w, axis=-1, keepdims=True)

# ---- scene -------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'CYCLES'):
    try: scene.render.engine = eng; break
    except TypeError: pass
print('sky: render engine', scene.render.engine)
if scene.render.engine.startswith('BLENDER_EEVEE'): scene.eevee.taa_render_samples = SAMPLES
else: scene.cycles.samples = SAMPLES
scene.render.resolution_x = scene.render.resolution_y = RES
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.view_settings.view_transform = 'Standard'
scene.render.image_settings.file_format = 'OPEN_EXR'
scene.render.image_settings.color_depth = '32'

cam_data = bpy.data.cameras.new('skycam')
cam_data.type = 'PERSP'; cam_data.sensor_fit = 'HORIZONTAL'; cam_data.angle = math.pi / 2
cam_data.clip_start = 0.01; cam_data.clip_end = 10
cam = bpy.data.objects.new('skycam', cam_data)
scene.collection.objects.link(cam); scene.camera = cam

world = bpy.data.worlds.new('sky'); scene.world = world
world.use_nodes = True
nt = world.node_tree; N = nt.nodes; L = nt.links
for x in list(N): N.remove(x)

def node(t, **kw):
    n = N.new(t)
    for k, v in kw.items():
        if k.startswith('in_'):  n.inputs[k[3:].replace('_', ' ')].default_value = v
        else: setattr(n, k, v)
    return n
def link(a, b): L.new(a, b)
def math_(op, a=None, b=None, clamp=False):
    m = node('ShaderNodeMath', operation=op, use_clamp=clamp)
    for i, x in enumerate((a, b)):
        if x is None: continue
        if isinstance(x, (int, float)): m.inputs[i].default_value = x
        else: link(x, m.inputs[i])
    return m.outputs[0]
def vmath(op, a, b=None, scale=None):
    m = node('ShaderNodeVectorMath', operation=op)
    for i, x in enumerate((a, b)):
        if x is None: continue
        if isinstance(x, (tuple, list)): m.inputs[i].default_value = x
        else: link(x, m.inputs[i])
    if scale is not None: m.inputs['Scale'].default_value = scale
    return m.outputs['Value'] if op in ('DOT_PRODUCT', 'LENGTH', 'DISTANCE') else m.outputs['Vector']
def noise(vec, scale, detail, rough, distort=0.0, ntype='FBM', lac=2.0, w=None):
    n = node('ShaderNodeTexNoise')
    n.noise_dimensions = '4D' if w is not None else '3D'
    try: n.noise_type = ntype
    except Exception: pass
    n.normalize = True
    link(vec, n.inputs['Vector'])
    n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = rough; n.inputs['Lacunarity'].default_value = lac
    n.inputs['Distortion'].default_value = distort
    if w is not None: n.inputs['W'].default_value = w
    return n
def ramp(fac, stops):
    r = node('ShaderNodeValToRGB')
    el = r.color_ramp.elements
    while len(el) > 2: el.remove(el[-1])
    for i, (p, h) in enumerate(stops):
        e = el[i] if i < 2 else el.new(p)
        e.position = p; e.color = hexlin(h) if isinstance(h, int) else h
    link(fac, r.inputs['Fac'])
    return r.outputs['Color']
def mix(fac, a, b, blend='MIX'):
    m = node('ShaderNodeMix', data_type='RGBA', blend_type=blend)
    if isinstance(fac, (int, float)): m.inputs['Factor'].default_value = fac
    else: link(fac, m.inputs['Factor'])
    for sock, x in (('A', a), ('B', b)):
        s = [i for i in m.inputs if i.name == sock and i.type == 'RGBA'][0]
        if isinstance(x, (tuple, list)): s.default_value = x
        else: link(x, s)
    return [o for o in m.outputs if o.type == 'RGBA'][0]

tc  = node('ShaderNodeTexCoord')
bg  = node('ShaderNodeBackground')
out = node('ShaderNodeOutputWorld')
link(bg.outputs[0], out.inputs['Surface'])
D = vmath('NORMALIZE', tc.outputs['Generated'])

if VERIFY:
    # colour = direction * 0.5 + 0.5, in BLENDER space; checked against face_dirs below
    mad = node('ShaderNodeVectorMath', operation='MULTIPLY_ADD')
    link(D, mad.inputs[0]); mad.inputs[1].default_value = (0.5, 0.5, 0.5); mad.inputs[2].default_value = (0.5, 0.5, 0.5)
    link(mad.outputs['Vector'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0
else:
    rng = np.random.default_rng(SEED)
    off = [tuple(rng.uniform(-50, 50, 3)) for _ in range(6)]
    tilt, yaw = math.radians(BAND_TILT_DEG), math.radians(BAND_YAW_DEG)
    bn = (math.sin(tilt) * math.cos(yaw), math.sin(tilt) * math.sin(yaw), math.cos(tilt))

    # domain warp: the whole gas field is pushed around by a slow noise, so no layer reads as "noise"
    Dw0 = vmath('ADD', D, off[0])
    warp = noise(Dw0, 1.1, 3, 0.5)
    wv = vmath('SUBTRACT', warp.outputs['Color'], (0.5, 0.5, 0.5))
    Dw = vmath('ADD', D, vmath('SCALE', wv, scale=0.55))

    # band: a wobbling great circle, not a stripe
    edge = noise(vmath('ADD', D, off[1]), 2.4, 4, 0.55)
    x = math_('ADD', vmath('DOT_PRODUCT', Dw, bn), math_('MULTIPLY', math_('SUBTRACT', edge.outputs['Fac'], 0.5), 0.34))
    band = math_('EXPONENT', math_('MULTIPLY', math_('POWER', math_('DIVIDE', x, BAND_WIDTH), 2.0), -1.0))
    halo = math_('EXPONENT', math_('MULTIPLY', math_('POWER', math_('DIVIDE', x, BAND_WIDTH * 2.6), 2.0), -1.0))

    # gas body + fine filaments
    gas  = noise(vmath('ADD', Dw, off[2]), 2.6, 9, 0.6, distort=0.25)
    fil  = noise(vmath('ADD', Dw, off[3]), 5.5, 7, 0.55, ntype='RIDGED_MULTIFRACTAL', lac=2.2)
    gasf = math_('POWER', gas.outputs['Fac'], 1.9)
    filf = math_('POWER', fil.outputs['Fac'], 3.0)
    dens = math_('ADD', math_('MULTIPLY', gasf, band), math_('MULTIPLY', math_('MULTIPLY', filf, 0.55), halo))
    dens = math_('ADD', dens, math_('MULTIPLY', math_('POWER', gas.outputs['Fac'], 3.0), math_('MULTIPLY', halo, 0.18)))

    # dust lanes: dark, ridged, only in the band's core
    dust = noise(vmath('ADD', Dw, off[4]), 7.0, 6, 0.6, ntype='RIDGED_MULTIFRACTAL', lac=2.3)
    dustm = math_('MULTIPLY', math_('POWER', dust.outputs['Fac'], 4.0), band)
    keep = math_('SUBTRACT', 1.0, math_('MULTIPLY', dustm, 0.9), clamp=True)

    # colour: cool steel body, a copper region where a slow noise says so, gold only in hot cores
    cool = ramp(dens, [(0.0, 0x03070c), (0.18, 0x0b2438), (0.45, 0x1f5873), (0.8, 0x6baabc), (1.0, 0xbcdced)])
    warm = ramp(dens, [(0.0, 0x05050a), (0.2, 0x2a1208), (0.5, 0x8a4516), (0.85, 0xd08a3a), (1.0, 0xf6ddb0)])
    region = noise(vmath('ADD', D, off[5]), 0.9, 2, 0.5)
    wm = node('ShaderNodeMapRange'); link(region.outputs['Fac'], wm.inputs['Value'])
    wm.inputs['From Min'].default_value = 0.52; wm.inputs['From Max'].default_value = 0.68
    col = mix(wm.outputs['Result'], cool, warm)
    col = mix(keep, (0, 0, 0, 1), col)
    link(col, bg.inputs['Color'])
    bg.inputs['Strength'].default_value = GAS_GAIN

# ---- render ------------------------------------------------------------------------------------
def render_face(face):
    """Render one face to float, return (RES, RES, 3) linear, row 0 = top, in the three.js layout."""
    c, r, d = (np.array(x, float) for x in FACES[face])
    F = game_to_bl(gl_to_game(c)); R = game_to_bl(gl_to_game(r)); U = -game_to_bl(gl_to_game(d))
    flip = np.linalg.det(np.stack([R, U, -F], 1)) < 0          # the x-flip makes some faces mirror images
    if flip: R = -R
    M = Matrix([list(R), list(U), list(-F)]).transposed()
    cam.matrix_world = M.to_4x4()
    path = os.path.join(TMP, face + '.exr')
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path, check_existing=False)
    a = np.empty(RES * RES * 4, np.float32); img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    a = a.reshape(RES, RES, 4)[::-1, :, :3]                     # Blender stores bottom row first
    if flip: a = a[:, ::-1]
    return a

def verify():
    worst = 0
    for f in FACES:
        a = render_face(f)
        got = a * 2 - 1
        got /= np.linalg.norm(got, axis=-1, keepdims=True)
        want = game_to_bl(face_dirs(f, RES))
        err = np.degrees(np.arccos(np.clip((got * want).sum(-1), -1, 1)))
        print('sky verify %s: max %.3f deg, mean %.4f deg' % (f, err.max(), err.mean()))
        worst = max(worst, err.max())
    ok = worst < 1.0
    print('sky verify: %s (worst %.3f deg)' % ('PASS' if ok else 'FAIL', worst))
    return ok

# ---- stars -------------------------------------------------------------------------------------
def star_list(rng):
    n = int(STARS * (RES / 2048) ** 2 * 1.0)
    tilt, yaw = math.radians(BAND_TILT_DEG), math.radians(BAND_YAW_DEG)
    bn_bl = np.array([math.sin(tilt) * math.cos(yaw), math.sin(tilt) * math.sin(yaw), math.cos(tilt)])
    bn = bl_to_game(bn_bl[None])[0]
    v = rng.normal(size=(n * 3, 3)); v /= np.linalg.norm(v, axis=1, keepdims=True)
    inband = np.exp(-(v @ bn / (BAND_WIDTH * 1.3)) ** 2)
    keep = rng.random(len(v)) < (1 - STAR_BAND_BIAS) + STAR_BAND_BIAS * inband
    v = v[keep][:n]
    # magnitudes: a steep power law, so a handful are bright and most are dust
    m = rng.pareto(2.0, len(v)) * 0.09 + 0.05
    m = np.clip(m, 0, 2.0)
    temp = rng.random(len(v))                       # 0 = warm gold-white, 1 = ice blue-white
    colw = np.array(hexlin(0xf6ddb0)[:3]); colc = np.array(hexlin(0xdcecff)[:3])
    col = colw[None] * (1 - temp[:, None]) + colc[None] * temp[:, None]
    return v, m, col

def splat_stars(img, face, stars):
    v, m, col = stars
    c, r, d = (np.array(x, float) for x in FACES[face])
    g = game_to_gl(v)
    depth = g @ c
    sel = depth > 0.5
    g, m, col = g[sel], m[sel], col[sel]; depth = depth[sel]
    u = (g @ r) / depth; w = (g @ d) / depth
    px = (u + 1) / 2 * RES - 0.5; py = (w + 1) / 2 * RES - 0.5
    ok = (px > -3) & (px < RES + 2) & (py > -3) & (py < RES + 2)
    px, py, m, col = px[ok], py[ok], m[ok], col[ok]
    scale = RES / 2048
    for x0, y0, mm, cc in zip(px, py, m, col):
        sig = (0.55 + 0.9 * min(mm, 1.0)) * scale
        rad = int(math.ceil(sig * 3.2 + (4 * scale if mm > 0.6 else 0)))
        xs = np.arange(int(x0) - rad, int(x0) + rad + 2); ys = np.arange(int(y0) - rad, int(y0) + rad + 2)
        xs = xs[(xs >= 0) & (xs < RES)]; ys = ys[(ys >= 0) & (ys < RES)]
        if not len(xs) or not len(ys): continue
        dx = xs[None, :] - x0; dy = ys[:, None] - y0; r2 = dx * dx + dy * dy
        k = np.exp(-r2 / (2 * sig * sig)) * mm
        if mm > 0.6: k += np.exp(-np.sqrt(r2) / (2.2 * scale)) * (mm - 0.6) * 0.08   # soft glow, no spikes
        img[ys[:, None], xs[None, :]] += k[..., None] * cc[None, None, :]

# ---- tone compensation + dither + write -------------------------------------------------------
def to_srgb8(lin, rng):
    """lin = the linear colour we want ON SCREEN. Undo reinhard*exposure so the game shows it."""
    x = np.clip(lin, 0, 0.5)                                      # reinhard cannot show more than 0.5 of a stored 1.0
    stored = x / (TONEMAP_EXPOSURE * (1 - x))
    stored = np.clip(stored, 0, 1)
    s = np.where(stored <= 0.0031308, stored * 12.92, 1.055 * np.power(stored, 1 / 2.4) - 0.055)
    s = s * 255 + (rng.random(s.shape) - rng.random(s.shape))    # triangular dither, +-1 LSB
    return np.clip(np.round(s), 0, 255).astype(np.uint8)

def save_png(a8, path):
    h, w = a8.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((h, w, 4), np.float32); rgba[..., :3] = a8 / 255.0
    img.pixels.foreach_set(rgba[::-1].ravel())
    img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    bpy.data.images.remove(img)

def cross(faces, n=256):
    """Horizontal cross, three.js layout: ny below and py above pz... for eyeballing only."""
    step = RES // n
    sm = {f: faces[f][::step, ::step][:n, :n] for f in faces}
    C = np.zeros((n * 3, n * 4, 3), np.uint8)
    place = {'py': (0, 1), 'nx': (1, 0), 'pz': (1, 1), 'px': (1, 2), 'nz': (1, 3), 'ny': (2, 1)}
    for f, (ry, rx) in place.items(): C[ry * n:(ry + 1) * n, rx * n:(rx + 1) * n] = sm[f]
    return C

if VERIFY:
    ok = verify()
    sys.exit(0 if ok else 1)

rng = np.random.default_rng(SEED + 1)
stars = star_list(rng)
done = {}
for f in FACES:
    lin = render_face(f)
    splat_stars(lin, f, stars)
    a8 = to_srgb8(lin, rng)
    save_png(a8, os.path.join(OUT, 'nebula_%s.png' % f))
    done[f] = a8
    print('sky: wrote nebula_%s.png' % f)
if PREVIEW:
    save_png(cross(done), os.path.join(OUT, 'nebula_cross.png'))
    print('sky: wrote nebula_cross.png')
for f in os.listdir(TMP): os.remove(os.path.join(TMP, f))
os.rmdir(TMP)
print('sky: done')
