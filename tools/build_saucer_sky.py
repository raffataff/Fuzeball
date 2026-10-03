"""
build_saucer_sky.py  --  Fuzeball FLYING SAUCER sky -> six cube faces (PNG masters)

    blender -b -P tools/build_saucer_sky.py -- [--res 2048] [--preview] [--verify] [--seed 4] [--samples 96]
    node tools/sky-encode.mjs tools/build/sky/saucer assets/rooms/saucer/sky/saucer --size 1536

The saucer bar hangs over a ringed gas giant. What the windows show:

    nebula    a faint violet-teal haze and a dust-starved star field (numpy stars at the final size)
    giant     banded gas giant: an equirect texture generated in numpy (jets, belts, a storm), lit by
              ONE sun lamp and rendered by Cycles so the ring shadow on the planet and the planet's
              shadow on the ring are real
    rings     an annulus with a radial opacity profile (gaps, ringlets), diffuse + translucent
    moon      a small grey moon on the lit side
    limb      a thin blue atmosphere rim, added in numpy

THE GIANT IS BELOW THE HORIZON ON PURPOSE. Every game camera sits above the window band and looks
down through it, so the planet is a few degrees under the horizon, to the far side of the table
(-z) and a little right of centre from the near camera. build_saucer_room.py puts the window
there. Shared cube/star/tone machinery: tools/skylib.py.
"""
import bpy, os, sys, math
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skylib as K

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None, flag=False):
    if name not in argv: return default
    if flag: return True
    return argv[argv.index(name) + 1]
RES     = int(arg('--res', 2048))
VERIFY  = arg('--verify', flag=True)
PREVIEW = arg('--preview', flag=True)
SEED    = int(arg('--seed', 4))
SAMPLES = int(arg('--samples', 96))
TEXW    = int(arg('--tex', 4096))

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT  = os.path.join(ROOT, 'tools', 'build', 'sky', 'saucer')

# ---- the look (game space: X long axis, Y up, Z width; the near-side camera sits at +Z) --------
GIANT_DIR  = K.unit((0.30, -0.10, -1.0))   # toward the giant: far wall, right of centre, just under the horizon
GIANT_DEG  = 21.0                          # angular RADIUS of the disc
SUN_DIR    = K.unit((-0.62, 0.30, 0.45))   # toward the sun: upper left and behind the near wall, so the giant is mostly lit
TILT_DEG   = 24.0                          # how far the spin axis leans (rings follow)
RING_IN, RING_OUT = 1.26, 2.05             # ring edges in planet radii
GAIN       = 0.92                          # giant brightness on screen (display-referred)
STARS      = 6500                          # at 2048
MOON_DEG   = 1.9
MOON_DIR   = K.unit((-0.30, 0.02, -1.0))
HAZE       = 0.20                          # nebula brightness

sky = K.Sky(RES, SAMPLES, OUT, transparent=not VERIFY, clip_end=6000.0)
if VERIFY: sys.exit(0 if sky.verify() else 1)
sc = sky.scene

def bl(v): return Vector(K.game_to_bl(np.asarray(v, float)[None])[0])

# ---- numpy noise (periodic in x) ---------------------------------------------------------------
def vnoise(H, W, px, py, seed):
    """Smooth value noise, px x py lattice cells, wraps in x. Returns (H, W) in 0..1."""
    g = np.random.default_rng(seed).random((py + 1, px))
    xs = np.arange(W) / W * px; ys = np.arange(H) / H * py
    x0 = xs.astype(int); fx = xs - x0; fx = fx * fx * (3 - 2 * fx); x1 = (x0 + 1) % px
    y0 = ys.astype(int); fy = ys - y0; fy = fy * fy * (3 - 2 * fy); y1 = y0 + 1
    a = g[y0][:, x0] * (1 - fx)[None] + g[y0][:, x1] * fx[None]
    b = g[y1][:, x0] * (1 - fx)[None] + g[y1][:, x1] * fx[None]
    return a * (1 - fy)[:, None] + b * fy[:, None]
def fbm(H, W, px, py, seed, octs=5, gain=0.5):
    out = np.zeros((H, W)); amp = 1.0; tot = 0.0
    for o in range(octs):
        out += amp * vnoise(H, W, px * 2 ** o, py * 2 ** o, seed + o * 17); tot += amp; amp *= gain
    return out / tot

# ---- the giant's texture: equirect, row 0 = north ----------------------------------------------
def giant_texture(W):
    H = W // 2
    lat = np.linspace(1, -1, H)[:, None] * np.ones((1, W))          # sin(latitude), +1 north
    lon = (np.arange(W) / W)[None, :] * np.ones((H, 1))              # 0..1 around
    pal = [0xf1e3c4, 0xe4c795, 0xcf9d5a, 0xb97a3c, 0x8e5a2e, 0x6a4026, 0xd8b99a, 0xf7ecd6]   # cream, ochre, copper, umber
    pal = np.array([K.hexlin(c)[:3] for c in pal])
    rng = np.random.default_rng(SEED + 3)
    # belts and zones: random-width bands, soft edges, each with its own tone
    edges = np.sort(rng.uniform(-1, 1, 26)); edges = np.concatenate([[-1.0], edges, [1.0]])
    tone = rng.uniform(0, 1, len(edges) - 1)
    for i in range(1, len(tone)):                                    # neighbours differ, or the band is invisible
        if abs(tone[i] - tone[i - 1]) < 0.28: tone[i] = (tone[i - 1] + 0.45) % 1.0
    # turbulence: jets shear the longitude, the edge wanders
    jet = fbm(H, W, 6, 14, SEED + 20, 4)
    wob = (fbm(H, W, 9, 26, SEED + 30, 5) - 0.5) * 0.05 + (jet - 0.5) * 0.035
    # the great storm, and two small ones: a swirl of the lookup coords around each centre
    storms = [(0.62, -0.30, 0.031, 0.105, 5.5), (0.20, 0.34, 0.015, 0.05, -4.0), (0.84, 0.18, 0.012, 0.04, 3.0)]
    L = lat + wob
    for cx, cy, rx, ry, spin in storms:
        dx = ((lon - cx + 0.5) % 1.0 - 0.5) / rx; dy = (lat - cy) / ry
        r2 = dx * dx + dy * dy; a = spin * np.exp(-r2 * 0.9)
        ca, sa = np.cos(a), np.sin(a)
        L = L + ((dx * sa + dy * ca) * ry - dy * ry) * np.exp(-r2 * 0.35)
    idx = np.clip(np.searchsorted(edges, L) - 1, 0, len(tone) - 1)
    t = tone[idx]
    # soften each edge by blending with the neighbour across it
    de = np.minimum(np.abs(L - edges[idx]), np.abs(L - edges[np.clip(idx + 1, 0, len(edges) - 1)]))
    nb = np.where(np.abs(L - edges[idx]) < np.abs(L - edges[np.clip(idx + 1, 0, len(edges) - 1)]), tone[np.clip(idx - 1, 0, len(tone) - 1)], tone[np.clip(idx + 1, 0, len(tone) - 1)])
    k = 0.5 * np.exp(-de / 0.012)
    t = t * (1 - k) + nb * k
    # fine streaks (stretched noise) and billows along the edges
    streak = fbm(H, W, 3, 120, SEED + 40, 4, 0.55)
    billow = fbm(H, W, 22, 44, SEED + 50, 5)
    t = np.clip(t + (streak - 0.5) * 0.30 + (billow - 0.5) * 0.18 * np.exp(-de / 0.05), 0, 1)
    f = t * (len(pal) - 1.001); i0 = f.astype(int); fr = (f - i0)[..., None]
    col = pal[i0] * (1 - fr) + pal[i0 + 1] * fr
    # storm tint: the great storm runs copper-red
    dx = ((lon - storms[0][0] + 0.5) % 1.0 - 0.5) / storms[0][2]; dy = (lat - storms[0][1]) / storms[0][3]
    sm = np.exp(-(dx * dx + dy * dy) * 0.8)[..., None]
    col = col * (1 - sm * 0.55) + np.array(K.hexlin(0xa24a22)[:3]) * sm * 0.55
    # poles run duller and bluer, like a real giant's haze
    pole = np.clip((np.abs(lat) - 0.72) / 0.28, 0, 1)[..., None] ** 1.5
    col = col * (1 - pole * 0.55) + np.array(K.hexlin(0x5d7d8c)[:3]) * pole * 0.55
    return np.clip(col, 0, 1)

def ring_texture(W):
    """(W radial) x 8 RGBA. Radial opacity profile: bands, gaps, a Cassini-style division."""
    r = np.linspace(0, 1, W)                                         # 0 = inner edge
    rng = np.random.default_rng(SEED + 5)
    n = 0.0
    for p, a in ((9, 0.5), (23, 0.35), (61, 0.28), (160, 0.22), (420, 0.16)):
        g = rng.random(p + 2); xs = r * p; i0 = xs.astype(int); fr = xs - i0; fr = fr * fr * (3 - 2 * fr)
        n = n + a * (g[i0] * (1 - fr) + g[i0 + 1] * fr)
    n = (n - n.min()) / (n.max() - n.min())
    dens = 0.15 + 0.8 * n ** 1.3
    dens *= np.clip(r / 0.04, 0, 1) * np.clip((1 - r) / 0.03, 0, 1)    # soft edges
    gap = lambda c, w: np.exp(-((r - c) / w) ** 2)
    dens *= 1 - 0.97 * gap(0.58, 0.022) - 0.7 * gap(0.31, 0.01) - 0.6 * gap(0.86, 0.008)
    dens *= np.where(r < 0.12, 0.35 + r / 0.12 * 0.65, 1.0)           # the faint inner D ring
    tone = np.clip(0.55 + 0.35 * n + 0.1 * np.sin(r * 40), 0, 1)
    c0, c1 = np.array(K.hexlin(0x9c8a72)[:3]), np.array(K.hexlin(0xe9dcc2)[:3])
    col = c0[None] * (1 - tone[:, None]) + c1[None] * tone[:, None]
    out = np.zeros((8, W, 4), np.float32)
    out[..., :3] = col[None]; out[..., 3] = np.clip(dens, 0, 1)[None]
    return out

def to_img(name, arr, alpha=False, colorspace='sRGB'):
    h, w = arr.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=alpha, float_buffer=False)
    im.colorspace_settings.name = colorspace
    rgba = np.ones((h, w, 4), np.float32)
    # arr is LINEAR; an sRGB image wants encoded values in its buffer
    enc = arr[..., :3]
    if colorspace == 'sRGB': enc = np.where(enc <= 0.0031308, enc * 12.92, 1.055 * np.power(np.maximum(enc, 1e-6), 1 / 2.4) - 0.055)
    rgba[..., :3] = enc
    if arr.shape[2] == 4: rgba[..., 3] = arr[..., 3]
    im.pixels.foreach_set(rgba[::-1].ravel()); im.update()
    return im

# ---- scene: giant, rings, moon, one sun --------------------------------------------------------
sc.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for dt in ('OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI'):
        try:
            prefs.compute_device_type = dt; prefs.get_devices()
            if any(d.type == dt for d in prefs.devices):
                for d in prefs.devices: d.use = (d.type == dt)
                sc.cycles.device = 'GPU'; print('sky: rendering on', dt); break
        except TypeError: pass
except Exception as e: print('sky: GPU setup failed, CPU', e)
sc.cycles.samples = SAMPLES
try: sc.cycles.use_denoising = True; sc.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception: pass
sc.cycles.film_exposure = 1.0

DIST = 3000.0
R = DIST * math.sin(math.radians(GIANT_DEG))
print('sky: giant texture')
gt = giant_texture(TEXW)
im_giant = to_img('saucer_giant', gt)
bpy.ops.mesh.primitive_uv_sphere_add(segments=192, ring_count=96, radius=R, location=bl(GIANT_DIR) * DIST)
giant = bpy.context.active_object; giant.name = 'giant'
bpy.ops.object.shade_smooth()
tilt = math.radians(TILT_DEG)
giant.rotation_euler = (tilt, 0, math.radians(-18))
m = bpy.data.materials.new('giant'); m.use_nodes = True; giant.data.materials.append(m)
b = m.node_tree.nodes['Principled BSDF']; t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = im_giant
m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
b.inputs['Roughness'].default_value = 1.0
try: b.inputs['Specular IOR Level'].default_value = 0.0
except KeyError: pass

# rings: an annulus in the equatorial plane, radial UVs
print('sky: rings')
rt = ring_texture(2048)
im_ring = to_img('saucer_ring', rt, alpha=True)
SEG, RAD = 256, 24
verts, faces, uvs = [], [], []
for j in range(RAD + 1):
    u = j / RAD; rr = R * (RING_IN + (RING_OUT - RING_IN) * u)
    for i in range(SEG):
        a = i / SEG * 2 * math.pi
        verts.append((rr * math.cos(a), rr * math.sin(a), 0.0)); uvs.append((u, (i / SEG) % 1.0))
for j in range(RAD):
    for i in range(SEG):
        a, bb = j * SEG + i, j * SEG + (i + 1) % SEG
        faces.append((a, bb, bb + SEG, a + SEG))
me = bpy.data.meshes.new('ring'); me.from_pydata(verts, [], faces); me.update()
uvl = me.uv_layers.new(name='UVMap')
for p in me.polygons:
    for li, vi in zip(p.loop_indices, p.vertices): uvl.data[li].uv = uvs[vi]
ring = bpy.data.objects.new('ring', me); sc.collection.objects.link(ring)
ring.location = giant.location; ring.rotation_euler = giant.rotation_euler
for p in me.polygons: p.use_smooth = True
rm = bpy.data.materials.new('ring'); rm.use_nodes = True; ring.data.materials.append(rm)
nt = rm.node_tree; N = nt.nodes; L = nt.links
for n in list(N): N.remove(n)
tex = N.new('ShaderNodeTexImage'); tex.image = im_ring; tex.interpolation = 'Linear'; tex.extension = 'EXTEND'
dif = N.new('ShaderNodeBsdfDiffuse'); trn = N.new('ShaderNodeBsdfTranslucent')
mixs = N.new('ShaderNodeMixShader'); mixs.inputs['Fac'].default_value = 0.42
tr = N.new('ShaderNodeBsdfTransparent'); mixa = N.new('ShaderNodeMixShader'); out = N.new('ShaderNodeOutputMaterial')
L.new(tex.outputs['Color'], dif.inputs['Color']); L.new(tex.outputs['Color'], trn.inputs['Color'])
L.new(dif.outputs['BSDF'], mixs.inputs[1]); L.new(trn.outputs['BSDF'], mixs.inputs[2])
L.new(tex.outputs['Alpha'], mixa.inputs['Fac']); L.new(tr.outputs['BSDF'], mixa.inputs[1]); L.new(mixs.outputs['Shader'], mixa.inputs[2])
L.new(mixa.outputs['Shader'], out.inputs['Surface'])
ring.visible_shadow = True

# the moon: a grey pebble with a few craters, lit by the same sun
mr = DIST * math.sin(math.radians(MOON_DEG))
bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=mr, location=bl(MOON_DIR) * DIST * 0.9)
moon = bpy.context.active_object; moon.name = 'moon'; bpy.ops.object.shade_smooth()
mm = bpy.data.materials.new('moon'); mm.use_nodes = True; moon.data.materials.append(mm)
mb = mm.node_tree.nodes['Principled BSDF']; tc = mm.node_tree.nodes.new('ShaderNodeTexCoord')
mn = mm.node_tree.nodes.new('ShaderNodeTexNoise'); mn.inputs['Scale'].default_value = 3.2 / mr; mn.inputs['Detail'].default_value = 10
mm.node_tree.links.new(tc.outputs['Object'], mn.inputs['Vector'])
mr_ = mm.node_tree.nodes.new('ShaderNodeValToRGB'); mr_.color_ramp.elements[0].color = K.hexlin(0x3a3d42); mr_.color_ramp.elements[1].color = K.hexlin(0x9aa0a6)
mm.node_tree.links.new(mn.outputs['Fac'], mr_.inputs['Fac']); mm.node_tree.links.new(mr_.outputs['Color'], mb.inputs['Base Color'])
mb.inputs['Roughness'].default_value = 1.0

sun_data = bpy.data.lights.new('sun', 'SUN'); sun_data.energy = 3.4; sun_data.angle = math.radians(0.5)
sun = bpy.data.objects.new('sun', sun_data); sc.collection.objects.link(sun)
sun.rotation_mode = 'QUATERNION'; sun.rotation_quaternion = (-bl(SUN_DIR)).to_track_quat('-Z', 'Y')

# ---- nebula: a world shader, rendered on its own (EEVEE, objects hidden) -----------------------
node, link, math_, vmath, noise, ramp, mix = sky.node, sky.link, sky.math, sky.vmath, sky.noise, sky.ramp, sky.mix
D, bg = sky.D, sky.bg
rng = np.random.default_rng(SEED)
off = [tuple(rng.uniform(-50, 50, 3)) for _ in range(5)]
tl, yw = math.radians(-32), math.radians(160)
bn = (math.sin(tl) * math.cos(yw), math.sin(tl) * math.sin(yw), math.cos(tl))
Dw = vmath('ADD', D, vmath('SCALE', vmath('SUBTRACT', noise(vmath('ADD', D, off[0]), 1.0, 3, 0.5).outputs['Color'], (0.5, 0.5, 0.5)), scale=0.5))
x = math_('ADD', vmath('DOT_PRODUCT', Dw, bn), math_('MULTIPLY', math_('SUBTRACT', noise(vmath('ADD', D, off[1]), 2.0, 4, 0.55).outputs['Fac'], 0.5), 0.3))
band = math_('EXPONENT', math_('MULTIPLY', math_('POWER', math_('DIVIDE', x, 0.34), 2.0), -1.0))
gas = noise(vmath('ADD', Dw, off[2]), 2.3, 8, 0.6, distort=0.2)
dens = math_('MULTIPLY', math_('POWER', gas.outputs['Fac'], 2.2), band)
cool = ramp(dens, [(0.0, 0x02050a), (0.25, 0x0a1b2e), (0.6, 0x1d3f5e), (1.0, 0x6b8fa8)])
warm = ramp(dens, [(0.0, 0x05040a), (0.3, 0x1e1220), (0.7, 0x4c2a3a), (1.0, 0x9c6a6a)])
reg = noise(vmath('ADD', D, off[3]), 0.9, 2, 0.5)
wm = node('ShaderNodeMapRange'); link(reg.outputs['Fac'], wm.inputs['Value'])
wm.inputs['From Min'].default_value = 0.5; wm.inputs['From Max'].default_value = 0.7
link(mix(wm.outputs['Result'], cool, warm), bg.inputs['Color']); bg.inputs['Strength'].default_value = HAZE

def render_nebula(f):
    for o in (giant, ring, moon): o.hide_render = True
    sc.render.film_transparent = False; sc.render.engine = 'BLENDER_EEVEE'
    sc.eevee.taa_render_samples = 16
    return sky.render_face(f)
def render_giant(f):
    for o in (giant, ring, moon): o.hide_render = False
    sc.render.film_transparent = True; sc.render.engine = 'CYCLES'
    bg.inputs['Strength'].default_value = 0.0
    r = sky.render_face(f, alpha=True)
    bg.inputs['Strength'].default_value = HAZE
    return r

# ---- numpy layers ------------------------------------------------------------------------------
def ang(dirs, v): return np.degrees(np.arccos(np.clip(dirs @ v, -1, 1)))
def limb(dirs, a):
    """Thin atmosphere rim: just outside the disc and just inside it, brighter toward the sun."""
    ang_g = ang(dirs, GIANT_DIR); r = GIANT_DEG
    perp = dirs - (dirs @ GIANT_DIR)[..., None] * GIANT_DIR[None, None]
    perp /= np.linalg.norm(perp, axis=-1, keepdims=True) + 1e-9
    sp = SUN_DIR - (SUN_DIR @ GIANT_DIR) * GIANT_DIR; sp /= np.linalg.norm(sp)
    lit = np.clip(0.12 + 0.88 * (perp @ sp), 0, 1)
    out = np.exp(-np.maximum(ang_g - r, 0) / (0.022 * r)) * (ang_g >= r * 0.99) * (1 - a)
    inn = np.clip((ang_g / r) ** 14, 0, 1) * (ang_g < r) * a
    return ((0.30 * out + 0.16 * inn) * lit)[..., None] * np.array(K.hexlin(0x8fc4e8)[:3])

rng = np.random.default_rng(SEED + 1)
bn_game = K.bl_to_game(np.array(bn)[None])[0]
stars = K.star_list(rng, int(STARS * (RES / 2048) ** 2), bn_game, 0.34, 0.45, mag=(0.07, 0.03))
done = {}
for f in K.FACES:
    dirs = K.face_dirs(f, RES)
    lin = render_nebula(f)
    rgba = render_giant(f)
    a = np.clip(rgba[..., 3], 0, 1)
    lin = lin * (1 - a)[..., None] + rgba[..., :3] * GAIN
    K.splat_stars(lin, f, stars, RES, mask=a)
    lin += limb(dirs, a)
    a8 = K.to_srgb8(lin, rng)
    K.save_png(a8, os.path.join(OUT, 'saucer_%s.png' % f)); done[f] = a8
    print('sky: wrote saucer_%s.png' % f)
if PREVIEW:
    K.save_png(K.cross(done, RES), os.path.join(OUT, 'saucer_cross.png'))
sky.cleanup()
print('sky: done')
