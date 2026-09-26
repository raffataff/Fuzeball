"""
build_moon_sky.py  --  Fuzeball MOON BASE sky -> six cube faces (PNG masters)

    blender -b -P tools/build_moon_sky.py -- [--res 2048] [--preview] [--verify]
    node tools/sky-encode.mjs tools/build/sky/moon assets/rooms/moon/sky/moon

The checklist brief: grey dust, Earth hanging in a black sky, one hard sun.

    black       no gas, no glow. A sparse, faint starfield (the sun is up; you would see few)
    Earth       a real lit sphere rendered by EEVEE, so its PHASE comes from the same sun direction
                the game's shadows use. Oceans, land, ice, clouds; an atmosphere rim added in numpy
    sun         a small hot disc and a tight glow, added in numpy. No flare, no rays (DIRECTION.md)

SUN_DIR MUST MATCH CONFIG.rooms.moon.dir.pos (same direction, any length). tools/sky-harness.js
checks the two agree, because a sun in the sky that disagrees with the shadows on the floor is the
one mistake everybody sees.

The lower hemisphere is never seen: the crater rim in the room GLB (build_moon_base.py) covers the
horizon from every camera. It is filled with a dark regolith grey anyway, so a gap is not a hole.
Shared cube/star/tone machinery: tools/skylib.py.
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
SEED    = int(arg('--seed', 11))
SAMPLES = int(arg('--samples', 16))

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT  = os.path.join(ROOT, 'tools', 'build', 'sky', 'moon')

# ---- the look (game space: X long axis, Y up, Z width; the near-side camera sits at +Z) ---------
SUN_DIR    = K.unit((-0.8, 0.72, 0.35))   # toward the sun. ~40 deg up, behind-left of the home camera.
                                          # Lower reads more lunar but the near table wall shades the pitch
EARTH_DIR  = K.unit((0.25, 0.25, -1.0))   # toward Earth. ~14 deg up, over the far rim
EARTH_DEG  = 8.0                          # angular RADIUS (the real one is ~1; this is a poster)
EARTH_GAIN = 0.85                         # Earth brightness on screen (display-referred)
SUN_DEG    = 0.7                          # sun disc angular radius
STARS      = 5000                         # at 2048
GROUND     = 0.006                        # lower hemisphere fill, linear

sky = K.Sky(RES, SAMPLES, OUT, transparent=True, clip_end=1000.0)
if VERIFY: sys.exit(0 if sky.verify() else 1)
sky.bg.inputs['Color'].default_value = (0, 0, 0, 1); sky.bg.inputs['Strength'].default_value = 0.0

def bl(v): return Vector(K.game_to_bl(np.asarray(v, float)[None])[0])

# ---- Earth -------------------------------------------------------------------------------------
DIST = 400.0
bpy.ops.mesh.primitive_uv_sphere_add(segments=128, ring_count=64, radius=DIST * math.sin(math.radians(EARTH_DEG)),
                                     location=bl(EARTH_DIR) * DIST)
earth = bpy.context.active_object; earth.name = 'earth'
earth.rotation_euler = (math.radians(23), math.radians(-12), math.radians(140))   # tilt + which face we see
bpy.ops.object.shade_smooth()
m = bpy.data.materials.new('earth'); m.use_nodes = True; earth.data.materials.append(m)
nt = m.node_tree; N = nt.nodes; L = nt.links; b = N['Principled BSDF']
tc = N.new('ShaderNodeTexCoord')
def nz(scale, detail, rough=0.55, distort=0.0, off=(0, 0, 0)):
    mp = N.new('ShaderNodeMapping'); mp.inputs['Location'].default_value = off
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    n = N.new('ShaderNodeTexNoise'); L.new(mp.outputs['Vector'], n.inputs['Vector'])
    n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = rough; n.inputs['Distortion'].default_value = distort
    return n.outputs['Fac']
def mr(v, a, b_):
    r = N.new('ShaderNodeMapRange'); L.new(v, r.inputs['Value'])
    r.inputs['From Min'].default_value = a; r.inputs['From Max'].default_value = b_; return r.outputs['Result']
def ramp(fac, stops):
    r = N.new('ShaderNodeValToRGB'); el = r.color_ramp.elements
    el[0].position, el[0].color = stops[0][0], K.hexlin(stops[0][1]); el[1].position, el[1].color = stops[1][0], K.hexlin(stops[1][1])
    for p, h in stops[2:]: e = el.new(p); e.color = K.hexlin(h)
    L.new(fac, r.inputs['Fac']); return r.outputs['Color']
def mix(fac, a, b_):
    x = N.new('ShaderNodeMix'); x.data_type = 'RGBA'; L.new(fac, x.inputs['Factor'])
    ins = [i for i in x.inputs if i.type == 'RGBA']
    for s, v in zip(ins, (a, b_)):
        if isinstance(v, tuple): s.default_value = v
        else: L.new(v, s)
    return [o for o in x.outputs if o.type == 'RGBA'][0]
R = DIST * math.sin(math.radians(EARTH_DEG))
land   = mr(nz(1.6 / R, 9, 0.55, 0.3, (3, 1, 7)), 0.52, 0.555)
landc  = ramp(nz(4.0 / R, 6, 0.6, 0, (9, 2, 4)), [(0.3, 0x6a5a3a), (0.5, 0x3d4a29), (0.72, 0x8a7550)])
ocean  = ramp(nz(2.0 / R, 4, 0.5, 0, (1, 8, 2)), [(0.35, 0x04182f), (0.7, 0x0b3560)])
sep = N.new('ShaderNodeSeparateXYZ'); L.new(tc.outputs['Object'], sep.inputs['Vector'])
ab = N.new('ShaderNodeMath'); ab.operation = 'ABSOLUTE'; L.new(sep.outputs['Z'], ab.inputs[0])
ice    = mr(ab.outputs[0], R * 0.9, R * 0.96)
cloud  = mr(nz(2.6 / R, 12, 0.62, 1.6, (5, 5, 1)), 0.5, 0.68)
c = mix(land, ocean, landc)
c = mix(ice, c, (0.85, 0.88, 0.9, 1))
c = mix(cloud, c, (0.9, 0.93, 0.95, 1))
L.new(c, b.inputs['Base Color'])
rough = N.new('ShaderNodeMath'); rough.operation = 'MAXIMUM'; L.new(land, rough.inputs[0]); L.new(cloud, rough.inputs[1])
rr = mr(rough.outputs[0], 0, 1); rr.node.inputs['To Min'].default_value = 0.35; rr.node.inputs['To Max'].default_value = 0.95
L.new(rr, b.inputs['Roughness'])

sun_data = bpy.data.lights.new('sun', 'SUN'); sun_data.energy = 3.2; sun_data.angle = math.radians(0.5)
sun = bpy.data.objects.new('sun', sun_data); sky.scene.collection.objects.link(sun)
sun.rotation_mode = 'QUATERNION'; sun.rotation_quaternion = (-bl(SUN_DIR)).to_track_quat('-Z', 'Y')

# ---- numpy layers ------------------------------------------------------------------------------
def ang(dirs, v): return np.degrees(np.arccos(np.clip(dirs @ v, -1, 1)))
def sun_layer(dirs):
    a = ang(dirs, SUN_DIR)
    core = np.clip((SUN_DEG + 0.08 - a) / 0.16, 0, 1)                 # anti-aliased hard disc
    glow = 0.22 * np.exp(-np.maximum(a - SUN_DEG, 0) / 1.2) + 0.04 * np.exp(-a / 7.0)
    return (core * 1.0)[..., None] * np.array([1.0, 0.97, 0.92]) + glow[..., None] * np.array([1.0, 0.9, 0.75])
def atmosphere(dirs, alpha):
    a = ang(dirs, EARTH_DIR); r = EARTH_DEG
    perp = dirs - (dirs @ EARTH_DIR)[..., None] * EARTH_DIR[None, None]
    perp /= np.linalg.norm(perp, axis=-1, keepdims=True) + 1e-9
    sp = SUN_DIR - (SUN_DIR @ EARTH_DIR) * EARTH_DIR; sp /= np.linalg.norm(sp)
    lit = np.clip(0.15 + 0.85 * (perp @ sp), 0, 1)                     # the rim glows on the sunward side
    out = np.exp(-np.maximum(a - r, 0) / (0.035 * r)) * (a >= r * 0.985)
    inn = np.clip((a / r) ** 10, 0, 1) * (a < r)
    k = (0.35 * out + 0.18 * inn) * lit
    return k[..., None] * np.array(K.hexlin(0x6fa8ff)[:3])

rng = np.random.default_rng(SEED)
stars = K.star_list(rng, int(STARS * (RES / 2048) ** 2), mag=(0.06, 0.025))
done = {}
for f in K.FACES:
    rgba = sky.render_face(f, alpha=True)
    dirs = K.face_dirs(f, RES)
    a = rgba[..., 3]
    lin = rgba[..., :3] * EARTH_GAIN
    lin += (1 - a)[..., None] * (GROUND * np.clip(-dirs[..., 1] * 8, 0, 1))[..., None] * np.array([1, 0.97, 0.93])
    K.splat_stars(lin, f, stars, RES, mask=np.maximum(a, np.clip(-dirs[..., 1] * 40, 0, 1)))
    lin += atmosphere(dirs, a) + sun_layer(dirs) * (1 - a)[..., None]
    a8 = K.to_srgb8(lin, rng)
    K.save_png(a8, os.path.join(OUT, 'moon_%s.png' % f)); done[f] = a8
    print('sky: wrote moon_%s.png' % f)
if PREVIEW:
    K.save_png(K.cross(done, RES), os.path.join(OUT, 'moon_cross.png'))
sky.cleanup()
print('sky: done')
