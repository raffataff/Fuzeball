"""
build_arcade_sky.py  --  Fuzeball STARPORT ARCADE sky -> six cube faces (PNG masters)

    blender -b -P tools/build_arcade_sky.py -- [--res 2048] [--preview] [--verify] [--seed 11] [--samples 96]
    node tools/sky-encode.mjs tools/build/sky/arcade assets/rooms/arcade/sky/starport --size 1536

The arcade is a deck on an orbital starport. What the windows show (back wall = -z, right wall = +x):

    planet    a rust-and-teal world far below, lit by ONE sun, city lights on its night side
    pier      a lattice docking pier running across each window, floodlit
    ships     moored freighters, a container hauler, a liner with lit windows, a tug
    stars     numpy stars at the final size

Every game camera sits above the window band and looks DOWN through it, so what the windows
show is the band from about -25 to +5 degrees of elevation. Planet, piers and ships sit there.
The sun is behind the back wall: ships are back-lit and read by the light bounced off the planet
(Cycles does that for real). Shared cube / star / tone machinery: tools/skylib.py.
"""
import bpy, bmesh, os, sys, math
import numpy as np
from mathutils import Vector, Matrix
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
SAMPLES = int(arg('--samples', 96))
NAME    = 'starport'
FACES   = arg('--faces', 'px,nx,py,ny,pz,nz').split(',')

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT  = os.path.join(ROOT, 'tools', 'build', 'sky', 'arcade')
os.makedirs(OUT, exist_ok=True)

# ---- the look (game space: X long axis, Y up, Z width; the near-side camera sits at +Z) --------
PLANET_DIR = K.unit((0.25, -0.90, -0.35))   # toward the planet's centre: far wall, a little right, well below
PLANET_DEG = 64.0                           # angular RADIUS of the disc; the limb tops out about 5 deg under the back horizon
SUN_DIR    = K.unit((-0.55, 0.62, -0.30))   # toward the sun: behind the far wall and to the left, 20 deg up: the planet's cap is lit, its night side runs off to the right
LAND       = 0.54                           # continent noise above this is land
GAIN       = 0.85                           # planet brightness on screen (display-referred)
STARS      = 5200                           # at 2048
BLOOM      = 0.55
DIST       = 3000.0

sky = K.Sky(RES, SAMPLES, OUT, transparent=not VERIFY, clip_end=6000.0)
if VERIFY: sys.exit(0 if sky.verify() else 1)
sc = sky.scene
def bl(v): return Vector(K.game_to_bl(np.asarray(v, float)[None])[0])
ships_col = bpy.data.collections.new('ships'); sc.collection.children.link(ships_col)
planet_col = bpy.data.collections.new('planet'); sc.collection.children.link(planet_col)
decoy_col = bpy.data.collections.new('decoy'); sc.collection.children.link(decoy_col)

# ---- Cycles on the GPU -------------------------------------------------------------------------
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
sc.cycles.max_bounces = 4
sc.cycles.film_exposure = 1.0

# ---- materials ---------------------------------------------------------------------------------
def pbr(name, hexc, rough=0.6, metal=0.0, emit=None, es=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = K.hexlin(hexc); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if emit is not None:
        b.inputs['Emission Color'].default_value = K.hexlin(emit); b.inputs['Emission Strength'].default_value = es
    return m
def weathered(name, hexc, rough=0.62, rust=1.0, grime=0.55):
    """Container and hull paint: a coarse tone shift, fine grime, rust patches (`rust` scales them, `grime` is their size). Object space = world space here, so the noise tells ships and containers apart."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; L = nt.links; b = N['Principled BSDF']
    tcn = N.new('ShaderNodeTexCoord')
    def noise(scale, detail, off):
        mp = N.new('ShaderNodeMapping'); mp.inputs['Location'].default_value = off; L.new(tcn.outputs['Object'], mp.inputs['Vector'])
        n = N.new('ShaderNodeTexNoise'); n.noise_dimensions = '3D'; n.normalize = True
        n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = 0.6
        L.new(mp.outputs['Vector'], n.inputs['Vector']); return n.outputs['Fac']
    def rng_(fac, a, b_, lo, hi):
        r = N.new('ShaderNodeMapRange'); r.clamp = True; L.new(fac, r.inputs['Value'])
        r.inputs['From Min'].default_value = a; r.inputs['From Max'].default_value = b_; r.inputs['To Min'].default_value = lo; r.inputs['To Max'].default_value = hi
        return r.outputs['Result']
    def mix(fac, ca, cb):
        x = N.new('ShaderNodeMix'); x.data_type = 'RGBA'; L.new(fac, x.inputs['Factor'])
        ins = [i for i in x.inputs if i.type == 'RGBA']
        for sock, c in ((ins[0], ca), (ins[1], cb)):
            if isinstance(c, (tuple, list)): sock.default_value = c
            else: L.new(c, sock)
        return [o for o in x.outputs if o.type == 'RGBA'][0]
    base = K.hexlin(hexc)
    coarse = noise(0.045, 2, (3.0, 1.0, 7.0)); fine = noise(grime, 5, (9.0, 4.0, 2.0))
    dim = tuple(c * 0.68 for c in base[:3]) + (1.0,)
    lit = tuple(min(1.0, c * 1.15) for c in base[:3]) + (1.0,)
    col = mix(rng_(coarse, 0.35, 0.65, 0.0, 1.0), lit, base)
    col = mix(rng_(fine, 0.42, 0.72, 0.0, 0.7 * min(1.0, 0.4 + rust)), col, dim)
    rust = rng_(fine, 0.60, 0.74, 0.0, rust)
    col = mix(rust, col, K.hexlin(0x5a2f1c))
    L.new(col, b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = 0.15
    return m
CONT = {'rust': 0x8e3b2c, 'blue': 0x2f517e, 'ochre': 0xc08a2b, 'teal': 0x2f6b5a, 'pale': 0xd4d1c4, 'orange': 0xc5581f, 'slate': 0x4b5159, 'maroon': 0x6c2a2e}
MAT = {
    'cream':  pbr('cream', 0xcdc4ae, 0.62), 'rust':   pbr('rust', 0x9c4c2c, 0.7), 'teal': pbr('teal', 0x2f6068, 0.55),
    'ochre':  pbr('ochre', 0xc4953f, 0.6), 'grey':   pbr('grey', 0x7a8086, 0.45, 0.5), 'dark': pbr('dark', 0x202225, 0.7),
    'truss':  pbr('truss', 0x8a9298, 0.5, 0.7), 'blue': pbr('blue', 0x2c4f86, 0.55), 'red': pbr('red', 0xb02e22, 0.6),
    'white':  pbr('white', 0xe6e4dc, 0.55), 'mustard': pbr('mustard', 0xd0a22c, 0.55),
    'win':    pbr('win', 0x20180c, 0.4, 0.0, 0xffc880, 2.4),
    'flood':  pbr('flood', 0xfff0d0, 0.5, 0.0, 0xfff0d0, 90.0),
    'navr':   pbr('navr', 0xff2a1a, 0.5, 0.0, 0xff2a1a, 60.0),
    'navg':   pbr('navg', 0x30ff70, 0.5, 0.0, 0x30ff70, 45.0),
    'engine': pbr('engine', 0x101820, 0.5, 0.0, 0x8fc0ff, 14.0),
}
for _k, _h in CONT.items(): MAT['c_' + _k] = weathered('cont_' + _k, _h)
HULLS = {'w_liner': 0xb3bac0, 'w_white': 0xdcd9ce, 'w_cream': 0xcdbf9f, 'w_grey': 0x707880, 'w_red': 0x8e3b2c, 'w_ochre': 0xb8873a, 'w_teal': 0x2f6068, 'w_blue': 0x2c4a78,
         'tank_w': 0xdcd9ce, 'tank_c': 0xcdbf9f, 'tank_o': 0xb8873a}   # tank_* are smooth-shaded (the spheres)
for _k, _h in HULLS.items(): MAT[_k] = weathered('hull_' + _k, _h, 0.55, rust=0.22, grime=0.2)
MAT['wincool'] = pbr('wincool', 0x10181c, 0.4, 0.0, 0xcfe8ff, 3.0)
MAT['lwin'] = pbr('lwin', 0x20180c, 0.4, 0.0, 0xffc880, 1.25)
MAT['lwinc'] = pbr('lwinc', 0x10181c, 0.4, 0.0, 0xcfe8ff, 1.5)
MAT['heat'] = pbr('heat', 0x2a0e08, 0.5, 0.0, 0xff6a3a, 1.6)
MAT['yellow'] = pbr('yellow', 0xd2a21e, 0.55)

# ---- geometry: boxes, cylinders and spheres accumulated per material --------------------------
GEO = {}
def _acc(mat): return GEO.setdefault(mat, ([], []))
RIGS = []
class Rig:
    """A local frame in game space: origin, yaw about Y (degrees). Local +x runs along the rig."""
    def __init__(s, origin, yaw=0.0):
        s.o = np.array(origin, float); t = math.radians(yaw); s.c, s.s = math.cos(t), math.sin(t)
        s.kind = '?'; s.lo = np.full(3, 1e9); s.hi = np.full(3, -1e9); RIGS.append(s)
    def w(s, p):
        x, y, z = p; return s.o + np.array([x * s.c + z * s.s, y, -x * s.s + z * s.c])
    def _v(s, mat, pts, faces):
        V, F = _acc(mat); o = len(V)
        for p in pts:
            w = s.w(p); s.lo = np.minimum(s.lo, w); s.hi = np.maximum(s.hi, w)
        V.extend(tuple(K.game_to_bl(s.w(p)[None])[0]) for p in pts); F.extend(tuple(o + i for i in f) for f in faces)
    def box(s, mat, c, size, tilt=0.0, rx=0.0):
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        t = math.radians(tilt); ct, st = math.cos(t), math.sin(t)
        a = math.radians(rx); ca, sa = math.cos(a), math.sin(a)
        pts = []
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    x, y = sx * hx, sy * hy
                    y2 = x * st + y * ct; z2 = sz * hz
                    pts.append((c[0] + x * ct - y * st, c[1] + y2 * ca - z2 * sa, c[2] + y2 * sa + z2 * ca))
        F = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        s._v(mat, pts, F)
    def cyl(s, mat, a, b, r, seg=14, r2=None):
        a = np.array(a, float); b = np.array(b, float); d = b - a; L = np.linalg.norm(d); d /= L
        ref = np.array([0, 1, 0]) if abs(d[1]) < 0.9 else np.array([1, 0, 0])
        u = np.cross(d, ref); u /= np.linalg.norm(u); v = np.cross(d, u)
        r2 = r if r2 is None else r2
        pts = []
        for k in range(seg):
            ang = 2 * math.pi * k / seg; ring = u * math.cos(ang) + v * math.sin(ang)
            pts.append(tuple(a + ring * r))
        for k in range(seg):
            ang = 2 * math.pi * k / seg; ring = u * math.cos(ang) + v * math.sin(ang)
            pts.append(tuple(b + ring * r2))
        pts += [tuple(a), tuple(b)]
        F = []
        for k in range(seg):
            k2 = (k + 1) % seg
            F.append((k, k2, seg + k2, seg + k)); F.append((2 * seg, k2, k)); F.append((2 * seg + 1, seg + k, seg + k2))
        s._v(mat, pts, F)
    def panel(s, mat, x0, x1, y0, y1, z, period, amp, out=1):
        """A corrugated wall in the local plane z: ribs run up it, one zig-zag per `period`; out = +1 faces +z, -1 faces -z."""
        n = max(2, int(round((x1 - x0) / (period / 2.0))))
        pts, F = [], []
        for k in range(n + 1):
            x = x0 + (x1 - x0) * k / n; zz = z + out * amp * (k % 2)
            pts.append((x, y0, zz)); pts.append((x, y1, zz))
        for k in range(n):
            q = (2 * k, 2 * k + 2, 2 * k + 3, 2 * k + 1); F.append(q if out > 0 else q[::-1])
        s._v(mat, pts, F)
    def loft(s, mat, secs, ring):
        """A solid from cross-sections: secs = [(x, half_width_z, half_height_y, y_centre)], ring = a closed polygon of (z, y) in -1..1."""
        n = len(ring); pts, F = [], []
        for x, hz, hy, yc in secs:
            for rz, ry in ring: pts.append((x, yc + ry * hy, rz * hz))
        for i in range(len(secs) - 1):
            for k in range(n):
                k2 = (k + 1) % n; F.append((i * n + k, i * n + k2, (i + 1) * n + k2, (i + 1) * n + k))
        F.append(tuple(range(n))[::-1]); F.append(tuple(range((len(secs) - 1) * n, len(secs) * n)))
        s._v(mat, pts, F)
    def sph(s, mat, c, r, seg=10, rings=6):
        pts, F = [], []
        for i in range(rings + 1):
            th = math.pi * i / rings
            for k in range(seg):
                ph = 2 * math.pi * k / seg
                pts.append((c[0] + r * math.sin(th) * math.cos(ph), c[1] + r * math.cos(th), c[2] + r * math.sin(th) * math.sin(ph)))
        for i in range(rings):
            for k in range(seg):
                k2 = (k + 1) % seg; F.append((i * seg + k, i * seg + k2, (i + 1) * seg + k2, (i + 1) * seg + k))
        s._v(mat, pts, F)

rng = np.random.default_rng(SEED)
prng = np.random.default_rng(SEED + 5)     # the piers have their own stream, so a pier edit does not reshuffle a hauler
CONT_NAMES = ['rust', 'blue', 'ochre', 'teal', 'pale', 'orange', 'slate', 'maroon']

def gantry(R, x):
    """A portal crane over the pier deck: legs, a cross beam, a trolley and a hoist holding a container."""
    for sz in (-1, 1):
        R.box('w_ochre', (x, 10.0, sz * 11.6), (2.2, 17.0, 2.2)); R.box('w_red', (x, 2.2, sz * 11.6), (2.8, 1.6, 2.8))
        R.box('truss', (x + 2.4, 9.0, sz * 11.6), (0.35, 15.0, 0.35), tilt=0)
    R.box('w_ochre', (x, 19.0, 0), (3.0, 2.6, 27.0)); R.box('truss', (x, 20.7, 0), (3.2, 0.3, 27.4))
    R.box('w_red', (x, 17.2, 4.0), (4.6, 2.0, 4.4)); R.box('dark', (x, 16.0, 4.0), (1.2, 0.5, 1.2))
    for sx in (-1, 1): R.cyl('dark', (x + sx * 1.7, 15.5, 4.0), (x + sx * 1.7, 7.4, 4.0), 0.12, 5)
    R.box('dark', (x, 7.1, 4.0), (6.0, 0.5, 2.6))
    container(R, (x, 4.7, 4.0), 'c_' + CONT_NAMES[int(prng.integers(0, len(CONT_NAMES)))], 1 if prng.random() < 0.5 else -1, mark=True)
    R.sph('win', (x + 1.2, 20.2, 12.0), 0.7, 5, 4); R.sph('navr', (x, 21.4, 0), 0.8, 5, 4)

def hut(R, x):
    """A control hut on the deck: lit front windows with mullions, a roof unit and a mast with a beacon."""
    R.box('w_grey', (x, 5.5, 0), (20, 8, 14)); R.box('dark', (x, 9.8, 0), (21, 0.8, 15))
    for sz in (-1, 1):
        R.box('win', (x, 6.6, sz * 7.06), (15.0, 2.2, 0.12))
        for k in range(6): R.box('dark', (x - 7.0 + k * 2.8, 6.6, sz * 7.1), (0.4, 2.3, 0.14))
        R.box('dark', (x + 8.5, 4.2, sz * 7.06), (2.4, 4.4, 0.14))
    R.box('truss', (x - 5, 10.8, 3), (4.0, 1.4, 3.0)); R.box('truss', (x + 4, 10.7, -3), (3.0, 1.2, 2.5))
    R.cyl('truss', (x - 8, 10.2, -5), (x - 8, 17.0, -5), 0.3, 6); R.sph('navr', (x - 8, 17.3, -5), 0.7, 5, 4)

def pier(R, half=900.0, step=45.0):
    """A dock pier along local x: deck, hazard kerbs, cable runs, rails, posts with floodlights, a belly truss with braces,
    huts, bollards, gantry cranes and a few piles of containers."""
    R.kind = 'pier'
    R.box('truss', (0, 0, 0), (2 * half, 3.0, 26.0))
    for sz in (-1, 1):
        R.box('yellow', (0, 1.7, sz * 12.4), (2 * half, 0.5, 1.0))
        for xx in np.arange(-half + 3.0, half, 7.0): R.box('dark', (xx, 1.75, sz * 12.4), (2.8, 0.55, 1.05))
        R.box('truss', (0, 4.5, sz * 13), (2 * half, 2.2, 2.2))
        R.box('grey', (0, -13.0, sz * 6), (2 * half, 2.4, 2.4))
        R.cyl('dark', (-half, 2.0, sz * 9.0), (half, 2.0, sz * 9.0), 0.7, 6)
    n = int(2 * half / step)
    for i in range(n + 1):
        x = -half + i * step
        for sz in (-1, 1):
            R.box('grey', (x, 10.0, sz * 13), (1.6, 11.0, 1.6))
            if i % 2 == 0: R.sph('flood', (x, 16.5, sz * 13), 1.6, 6, 4)
        R.box('grey', (x, -6.5, 0), (1.4, 14.0, 13.0))
        if i < n:
            for sg in (-1, 1): R.box('truss', (x + step / 2, -6.5, sg * 6), (step * 1.1, 1.1, 1.1), tilt=sg * 17)
            for sz in (-1, 1):                                        # bollards between the posts
                R.cyl('w_ochre', (x + step / 2, 2.8, sz * 10.8), (x + step / 2, 4.6, sz * 10.8), 0.9, 8, r2=0.7)
                R.cyl('w_ochre', (x + step / 2, 4.6, sz * 10.8), (x + step / 2, 5.0, sz * 10.8), 1.3, 8)
    R.sph('navr', (-half, 8, 0), 2.6, 6, 4); R.sph('navr', (half, 8, 0), 2.6, 6, 4)
    for fx in (-0.5, 0.0, 0.5): hut(R, fx * half)
    for fx in (-0.78, -0.28, 0.28, 0.78): gantry(R, fx * half)
    for fx in (-0.4, 0.14, 0.62):
        for col_ in range(3):
            for row in range(2):
                for t in range(int(prng.integers(1, 4))):
                    container(R, (fx * half + col_ * 22.0, 1.5 + CH / 2 + t * (CH + 0.06), -5.0 + row * 5.2), 'c_' + CONT_NAMES[int(prng.integers(0, len(CONT_NAMES)))],
                              1 if prng.random() < 0.5 else -1, mark=prng.random() < 0.3)

HULL_RING = [(0.55, -1.0), (1.0, -0.45), (1.0, 0.55), (0.82, 1.0), (-0.82, 1.0), (-1.0, 0.55), (-1.0, -0.45), (-0.55, -1.0)]
def railing(R, x0, x1, y, z, step=5.0, h=1.7):
    """A rail along x at height y: posts every `step`, a top bar and a mid bar."""
    R.box('truss', ((x0 + x1) / 2, y + h, z), (x1 - x0, 0.2, 0.2)); R.box('truss', ((x0 + x1) / 2, y + h * 0.5, z), (x1 - x0, 0.15, 0.15))
    for k in range(int((x1 - x0) / step) + 1): R.box('truss', (x0 + k * step, y + h / 2, z), (0.22, h, 0.22))

def deckhouse(R, x, y0, wz, lx, tiers=4, fwd=1, hull='w_white'):
    """Stepped accommodation tiers on a plinth, lit window rows with mullions, a bridge with wings, a funnel, a mast and radar, boats.
    x, y0 = centre and deck level; wz, lx = width (z) and length (x) of the lowest tier; the fronts (fwd) line up, the aft end steps in."""
    th = 5.4
    R.box('w_grey', (x, y0 + 1.0, 0), (lx * 1.1, 2.0, wz * 1.06))
    yb = y0 + 2.0; tops = []
    for t in range(tiers):
        w = wz * (1 - 0.1 * t); l = lx * (1 - 0.16 * t); xc = x + fwd * (lx - l) / 2; yc = yb + th / 2
        R.box(hull, (xc, yc, 0), (l, th, w))
        R.box('w_grey', (xc, yb + 0.15, 0), (l * 1.03, 0.3, w * 1.03)); R.box('w_grey', (xc, yb + th - 0.12, 0), (l * 1.04, 0.24, w * 1.04))
        bridge = (t == tiers - 1)
        wm = 'wincool' if bridge else 'win'
        for sz in (-1, 1):
            R.box(wm, (xc, yc + 0.4, sz * (w / 2 + 0.04)), (l * 0.88, 1.8, 0.1))
            nm = max(2, int(l * 0.88 / 3.2))
            for k in range(nm + 1): R.box('dark', (xc - l * 0.44 + l * 0.88 * k / nm, yc + 0.4, sz * (w / 2 + 0.08)), (0.4, 1.9, 0.14))
            if t < 2:                                            # a door and a hatch on the lower tiers
                R.box('dark', (xc - fwd * l * 0.3, yc - 1.2, sz * (w / 2 + 0.05)), (1.5, 2.4, 0.12))
        R.box(wm, (xc + fwd * (l / 2 + 0.04), yc + 0.4, 0), (0.1, 1.8, w * 0.88))
        nm = max(2, int(w * 0.88 / 3.2))
        for k in range(nm + 1): R.box('dark', (xc + fwd * (l / 2 + 0.08), yc + 0.4, -w * 0.44 + w * 0.88 * k / nm), (0.14, 1.9, 0.4))
        yb += th + 0.15; tops.append((xc, l, w, yb))
    xc, l, w, ytop = tops[-1]
    # the bridge: a wing across the front, windows along its face, a visor
    R.box(hull, (xc + fwd * (l / 2 - 1.2), ytop - th - 0.15 + th * 0.35, 0), (3.0, 2.6, wz * 1.28))
    R.box('wincool', (xc + fwd * (l / 2 + 0.35), ytop - th - 0.15 + th * 0.45, 0), (0.1, 1.3, wz * 1.2))
    R.box('w_grey', (xc, ytop + 0.1, 0), (l * 1.1, 0.25, w * 1.1))
    for sz in (-1, 1): railing(R, xc - l / 2, xc + l / 2, ytop + 0.2, sz * (w / 2 - 0.1), 4.0, 1.4)
    # funnel: the aft end of the top tier, banded
    fx = xc - fwd * l * 0.25
    R.cyl('w_ochre', (fx, ytop, 0), (fx, ytop + 9.0, 0), 3.0, 14, r2=2.6)
    R.cyl('w_red', (fx, ytop + 6.2, 0), (fx, ytop + 7.8, 0), 3.05, 14, r2=3.05)
    R.cyl('dark', (fx, ytop + 9.0, 0), (fx, ytop + 9.5, 0), 2.7, 14)
    # mast with a crossbar, a radar arm and an aerial
    mx = xc + fwd * l * 0.18
    R.cyl('truss', (mx, ytop, 0), (mx, ytop + 14.0, 0), 0.5, 8, r2=0.35)
    R.box('truss', (mx, ytop + 10.0, 0), (0.5, 0.4, 8.0)); R.box('dark', (mx, ytop + 14.4, 0), (1.0, 0.6, 1.0))
    R.box('truss', (mx, ytop + 14.9, 0), (0.5, 0.35, 7.0)); R.box('truss', (mx, ytop + 15.2, 0), (3.4, 0.25, 0.9))
    R.cyl('truss', (mx, ytop + 14.0, 0), (mx, ytop + 21.0, 0), 0.14, 6)
    R.sph('navr', (mx, ytop + 21.2, 0), 0.7, 5, 4)
    for sz in (-1, 1):
        R.sph('win', (xc + fwd * (l / 2 - 0.5), ytop + 0.9, sz * (w / 2 - 0.8)), 0.7, 6, 4)
        R.cyl('w_ochre', (xc - l * 0.3, y0 + 2.0 + th + 0.5 + 0.2, sz * (wz / 2 + 1.5)), (xc + l * 0.1, y0 + 2.0 + th + 0.5 + 0.2, sz * (wz / 2 + 1.5)), 1.3, 10, r2=1.0)   # lifeboats
        R.box('dark', (xc - l * 0.1, y0 + 2.0 + th - 0.1, sz * (wz / 2 + 0.8)), (l * 0.5, 0.25, 1.4))

def freighter(R, L=300.0, hull='w_cream'):
    """A long-haul tanker on outriggers: a lofted spine hull, paired tanks with bands and clamps, a manifold, cranes, radiators,
    big engine bells aft (-x), and a deckhouse at the bow (+x)."""
    R.kind = 'freighter'
    secs = [(-L / 2, 9.5, 9.5, -2.0), (-L / 2 + 10, 11.0, 10.0, -2.0), (L * 0.20, 11.0, 10.0, -2.0), (L * 0.38, 9.6, 9.8, -1.8),
            (L / 2 - 20, 6.8, 9.3, -0.8), (L / 2, 3.6, 8.2, 0.8)]
    R.loft(hull, secs, HULL_RING)
    R.box('w_grey', (-L / 2 + 16, 4, 0), (32, 20, 21))                                   # the engine room, a block aft
    for sz in (-1, 1):
        for k in range(5): R.box('dark', (-L / 2 + 6 + k * 5.6, 8.0, sz * 10.7), (3.2, 7.0, 0.3))          # intake grilles
        R.box('w_red', (-L / 2 + 16, -3.0, sz * 10.65), (30, 1.4, 0.2)); R.box('w_white', (-L / 2 + 27, 12.5, sz * 10.7), (4.0, 2.4, 0.2))
    R.cyl('truss', (-L / 2 + 8, 14, 5), (-L / 2 + 8, 19, 5), 1.4, 8); R.cyl('truss', (-L / 2 + 8, 14, -5), (-L / 2 + 8, 19, -5), 1.4, 8)
    R.box('w_grey', (0, 0, 0), (L * 0.86, 5, 28))                                         # the beam the tanks hang from
    for sz in (-1, 1):
        R.box('w_red', (-L * 0.04, -5.2, sz * 11.12), (L * 0.78, 1.7, 0.3))               # the boot stripe
        for xx in np.arange(-L / 2 + 22, L * 0.34, 11.0): R.box('dark', (xx, 0.0, sz * 11.1), (0.3, 9.0, 0.3))   # plate seams
        R.box('w_white', (L * 0.30, 1.5, sz * 11.15), (14, 3.0, 0.2))                    # the hull number
    n = 6
    xs = [-L / 2 + 62 + i * (L - 150) / (n - 1) for i in range(n)]
    for i, cx in enumerate(xs):
        tm = 'tank_w' if i % 2 else {'w_cream': 'tank_c', 'w_ochre': 'tank_o'}.get(hull, 'tank_w')
        for sz in (-1, 1):
            cy, cz = 4.0, sz * 28.0
            R.sph(tm, (cx, cy, cz), 17, 32, 18)
            R.cyl('w_grey', (cx, cy, cz), (cx, cy + 1.3, cz), 17.15, 24)                 # the equator band
            for dy in (-8.5, 8.5): R.cyl('w_grey', (cx, cy + dy, cz), (cx, cy + dy + 0.8, cz), 14.8, 24)
            R.cyl('truss', (cx, cy + 16.5, cz), (cx, cy + 19.5, cz), 2.6, 12); R.cyl('dark', (cx, cy + 19.5, cz), (cx, cy + 20.2, cz), 3.1, 12)
            R.box('truss', (cx, cy - 6.0, sz * 15.5), (14.0, 3.0, 9.0)); R.box('dark', (cx, cy - 6.0, sz * 12.2), (15.0, 3.4, 1.2))   # the clamp
            R.box('truss', (cx + 8.5, cy - 2.0, sz * 14.2), (1.6, 12.0, 6.0)); R.box('truss', (cx - 8.5, cy - 2.0, sz * 14.2), (1.6, 12.0, 6.0))
            R.cyl('truss', (cx, 11.0, sz * 9.0), (cx, cy + 19.0, cz - sz * 4.0), 0.9, 8)  # a branch to the tank's valve
        R.box('w_grey', (cx, 9.4, 0), (4.0, 1.4, 6.0))                                    # a deck saddle under the manifold
    for sz in (-1, 1): R.cyl('truss', (xs[0] - 10, 11.0, sz * 9.0), (xs[-1] + 10, 11.0, sz * 9.0), 1.5, 10)   # the manifold
    # catwalk and rails down the middle, a pair of cranes
    R.box('w_grey', (-L * 0.04, 9.3, 0), (L * 0.66, 0.5, 4.0))
    for sz in (-1, 1): railing(R, -L * 0.37, L * 0.29, 9.5, sz * 2.0, 6.0, 1.7)
    for cx in (xs[1] + 22, xs[4] - 6):
        R.box('w_ochre', (cx, 15.0, 0), (3.4, 12.0, 3.4))
        R.cyl('w_ochre', (cx, 21.0, 0), (cx + 24, 31.0, 0), 0.9, 8); R.cyl('truss', (cx, 21.0, 0), (cx + 12, 33.0, 0), 0.25, 5)
        R.box('dark', (cx + 24, 30.5, 0), (1.2, 1.2, 1.2)); R.sph('win', (cx, 21.6, 0), 0.8, 6, 4)
    # radiators: two vertical wings aft, ribbed
    for sz in (-1, 1):
        R.box('dark', (-L / 2 + 52, 23.0, sz * 7.0), (46, 26.0, 0.5))
        for k in range(8):
            R.box('truss', (-L / 2 + 52, 11.5 + k * 3.2, sz * 7.0), (46.0, 0.4, 1.6))
            R.box('heat', (-L / 2 + 52, 13.1 + k * 3.2, sz * 7.0 + sz * 0.3), (44.0, 0.45, 0.2))
        for k in range(5): R.box('truss', (-L / 2 + 30 + k * 11.5, 23.0, sz * 7.0), (0.5, 26.0, 1.6))
        R.box('w_grey', (-L / 2 + 52, 36.2, sz * 7.0), (47, 0.8, 2.2))
    # engines: bells with a cowl ring and a throat glow, thruster pods at the corners
    for zz in (-8.5, 0.0, 8.5):
        R.cyl('w_grey', (-L / 2 - 1, 0, zz), (-L / 2 - 4, 0, zz), 8.2, 16)
        R.cyl('dark', (-L / 2 - 4, 0, zz), (-L / 2 - 30, 0, zz), 7.0, 16, r2=9.5)
        R.sph('engine', (-L / 2 - 8, 0, zz), 5.2, 10, 6)
    for sy in (-1, 1):
        for sz in (-1, 1): R.box('w_grey', (-L / 2 + 3, sy * 9.0, sz * 8.0), (6, 3.0, 3.4)); R.sph('engine', (-L / 2 - 0.2, sy * 9.0, sz * 8.0), 1.2, 6, 4)
    deckhouse(R, L / 2 - 30, 8.0, 34.0, 40.0, tiers=4, fwd=1, hull='w_white')
    R.sph('navr', (-L / 2 + 6, 22, -18), 1.2, 5, 4); R.sph('navg', (-L / 2 + 6, 22, 18), 1.2, 5, 4)

CL, CH, CW = 21.0, 4.7, 4.5            # a container on this ship: length, height, width (toy scale, like the table)
def container(R, c, mat, door=1, mark=False):
    """One shipping container: a core, corrugated sides, a frame of corner posts and rails, roof ribs, lock rods at the door end."""
    x, y, z = c
    R.box(mat, (x, y, z), (CL - 0.5, CH - 0.3, CW - 0.7))
    for sz in (-1, 1):
        R.panel(mat, x - CL / 2 + 0.45, x + CL / 2 - 0.45, y - CH / 2 + 0.22, y + CH / 2 - 0.22, z + sz * (CW / 2 - 0.5), 1.5, 0.3, sz)
    for sx in (-1, 1):
        for sz in (-1, 1): R.box('grey', (x + sx * (CL / 2 - 0.3), y, z + sz * (CW / 2 - 0.3)), (0.6, CH, 0.6))
    for sy in (-1, 1):
        for sz in (-1, 1): R.box('grey', (x, y + sy * (CH / 2 - 0.13), z + sz * (CW / 2 - 0.3)), (CL, 0.26, 0.5))
        for sx in (-1, 1): R.box('grey', (x + sx * (CL / 2 - 0.3), y + sy * (CH / 2 - 0.13), z), (0.5, 0.26, CW))
    for k in (-1, 0, 1): R.box(mat, (x, y + CH / 2 - 0.08, z + k * CW * 0.27), (CL - 1.4, 0.18, 0.32))
    xe = x + door * (CL / 2 + 0.04)
    for sz in (-1, 1): R.box('truss', (xe, y, z + sz * CW * 0.2), (0.12, CH - 0.7, 0.14))
    R.box('dark', (xe, y, z), (0.08, CH - 0.5, 0.1))
    if mark:
        sz = 1 if rng.random() < 0.5 else -1
        R.box('white', (x + rng.uniform(-CL * 0.18, CL * 0.18), y + CH * 0.16, z + sz * (CW / 2 - 0.12)), (CL * 0.26, CH * 0.17, 0.1))

CONT_W = [('rust', 3), ('blue', 2), ('ochre', 2), ('teal', 1.5), ('pale', 1.5), ('orange', 1), ('slate', 1), ('maroon', 1)]
def hauler(R, L=200.0):
    """A container carrier: a flat deck, bays of containers stacked three or four high with gaps, a bridge at the bow (+x)."""
    R.kind = 'hauler'
    R.box('grey', (0, 0, 0), (L, 8, 54))
    R.box('dark', (0, 5, 0), (L, 3, 58))
    names = [n for n, w in CONT_W]; wts = np.array([w for n, w in CONT_W], float); wts /= wts.sum()
    bays = int((L - 42.0) // (CL + 0.9)); rows = 9
    x0 = -L / 2 + 6.0 + (CL + 0.9) / 2
    for i in range(bays):
        x = x0 + i * (CL + 0.9)
        for r in range(rows):
            z = (r - (rows - 1) / 2.0) * (CW + 0.5)
            tiers = int(np.clip(round(2.4 + 1.3 * math.sin(i * 0.9 + r * 0.55) + rng.normal(0, 0.8)), 0, 5))
            if rng.random() < 0.08: tiers = 0
            dx = rng.uniform(-0.3, 0.3); door = 1 if rng.random() < 0.5 else -1
            for t in range(tiers):
                nm = names[rng.choice(len(names), p=wts)]
                container(R, (x + dx + rng.uniform(-0.1, 0.1), 4.0 + 0.05 + CH / 2 + t * (CH + 0.06), z), 'c_' + nm, door, mark=rng.random() < 0.35)
        for sz in (-1, 1): R.box('truss', (x + (CL + 0.9) / 2, 4.0 + 3 * (CH + 0.06) + 1.0, sz * 26.5), (0.5, 3 * (CH + 0.06) + 2.0, 0.5))
    deckhouse(R, L / 2 - 19, 6.5, 44.0, 30.0, tiers=4, fwd=1, hull='w_white')
    for zz in (-14, 14):
        R.cyl('dark', (-L / 2, 0, zz), (-L / 2 - 16, 0, zz), 7, 10, r2=5); R.sph('engine', (-L / 2 - 16, 0, zz), 4.4, 8, 5)
    R.sph('navr', (L / 2 - 4, 12, -22), 1.5, 5, 4); R.sph('navg', (L / 2 - 4, 12, 22), 1.5, 5, 4)

def liner(R, L=440.0, r=34.0):
    """A passenger liner: a lofted drum with banded paint and rows of lit windows (some dark), a habitat ring on spokes,
    an observation dome, a bridge bulb at the bow, aerials, boarding tubes to the pier, three engines aft (-x)."""
    R.kind = 'liner'
    rng_l = np.random.default_rng(SEED + 9)
    circ = [(math.cos(2 * math.pi * k / 24), math.sin(2 * math.pi * k / 24)) for k in range(24)]
    secs = [(-L / 2, 24, 24, 0.0), (-L / 2 + 22, 31, 31, 0.0), (-L / 2 + 55, 34, 34, 0.0), (-L * 0.20, 34, 34, 0.0), (-L * 0.165, 38.5, 38.5, 0.0),
            (L * 0.01, 38.5, 38.5, 0.0), (L * 0.045, 34, 34, 0.0), (L * 0.27, 34, 34, 0.0), (L * 0.39, 30.5, 30.5, 0.0),
            (L / 2 - 34, 23.5, 23.5, 0.0), (L / 2 - 10, 14, 14, 0.0), (L / 2, 6.5, 6.5, 0.0)]
    R.loft('w_liner', secs, circ)
    for x in np.arange(-L / 2 + 70, L * 0.26, 23.5):
        if -L * 0.20 < x < L * 0.05: continue
        R.cyl('w_grey', (x, 0, 0), (x + 0.7, 0, 0), r + 0.4, 24)                                  # seam rings
    def at(x, a, e=0.0, rr=None): return (x, ((r if rr is None else rr) + e) * math.sin(a), ((r if rr is None else rr) + e) * math.cos(a))
    # paint: a teal and a red boot stripe low on both sides
    for al in (math.radians(-40), math.radians(180 + 40)):
        R.box('w_teal', at(-L * 0.04, al, 0.12), (L * 0.78, 6.0, 0.4), rx=-math.degrees(al))
    for al in (math.radians(-52), math.radians(180 + 52)):
        R.box('w_red', at(-L * 0.04, al, 0.12), (L * 0.78, 1.6, 0.4), rx=-math.degrees(al))
    # windows: five rows, each an individual lit window or a dark one, warm with some cool
    for th in (38, 22, 6, -10, -26):
        for a0 in (math.radians(th), math.radians(180 - th)):
            for x in np.arange(-L * 0.40, L * 0.27, 3.3):
                if -L * 0.18 < x < L * 0.03: continue                      # the gallery has its own
                if rng_l.random() < 0.25: continue
                m = 'lwinc' if rng_l.random() < 0.22 else 'lwin'
                R.box(m, at(x + rng_l.uniform(-0.2, 0.2), a0, 0.18), (1.9, 1.4, 0.3), rx=-math.degrees(a0))
    # the gallery: a bulge with tall panes all the way round it
    xg0, xg1 = -L * 0.155, L * 0.0
    for th in (24, 4, -16):
        for a0 in (math.radians(th), math.radians(180 - th)):
            for x in np.arange(xg0, xg1, 5.2):
                m = 'lwinc' if rng_l.random() < 0.5 else 'lwin'
                R.box(m, at(x, a0, 0.2, 38.5), (3.8, 3.4, 0.3), rx=-math.degrees(a0))
    for a0 in (math.radians(-6), math.radians(186)):
        R.box('wincool', at(L * 0.33, a0, 0.2), (30.0, 2.2, 0.3), rx=-math.degrees(a0))
    # topside: an observation dome, aerials with dishes
    R.sph('wincool', (L * 0.22, r - 3.0, 0), 10.0, 14, 8)
    R.cyl('w_grey', (L * 0.22, r - 5, 0), (L * 0.22, r - 1.0, 0), 11.0, 16)
    for x, h in ((-L * 0.30, 18.0), (-L * 0.24, 13.0), (L * 0.08, 16.0)):
        R.cyl('truss', (x, r - 1, 0), (x, r + h, 0), 0.5, 6); R.box('truss', (x, r + h * 0.62, 0), (0.4, 0.3, 8.0))
        R.cyl('w_grey', (x + 0.8, r + h, 0), (x + 1.6, r + h, 0), 3.0, 14, r2=0.5)
        R.sph('navr', (x, r + h + 0.8, 0), 0.7, 5, 4)
    # the bow: a bridge band round the bulb and a docking port with a landing light
    for k in range(14):
        ph = 2 * math.pi * k / 14
        R.box('wincool', (L / 2 - 14, 13.0 * math.sin(ph), 13.0 * math.cos(ph)), (2.6, 1.5, 0.3), rx=-math.degrees(ph))
    R.cyl('w_grey', (L / 2, 0, 0), (L / 2 + 4, 0, 0), 5.0, 12, r2=3.6); R.sph('flood', (L / 2 + 4.5, 0, 0), 1.5, 6, 4)
    # boarding tubes to the pier (115 units off the near side): grey with thin dark bands, lit at the end
    for x in (-L * 0.30, L * 0.12, L * 0.28):
        a_, b_ = (x, -6.0, -r + 1.0), (x, -37.0, -109.0)
        R.cyl('w_grey', a_, b_, 3.2, 10)
        for k in range(1, 10):
            t = k / 10.0
            P0 = tuple(a_[i] + (b_[i] - a_[i]) * (t - 0.012) for i in range(3)); P1 = tuple(a_[i] + (b_[i] - a_[i]) * (t + 0.012) for i in range(3))
            R.cyl('dark', P0, P1, 3.45, 10)
        R.sph('lwin', b_, 1.4, 6, 4)
    # hatches low on the hull, a name plate aft
    for x in np.arange(-L * 0.35, L * 0.22, 36.0):
        for al in (math.radians(-28), math.radians(180 + 28)): R.box('dark', at(x, al, 0.1), (7.0, 3.4, 0.3), rx=-math.degrees(al))
    for zz in (-14, 0, 14):
        R.cyl('w_grey', (-L / 2, 0, zz), (-L / 2 - 6, 0, zz), 10.0, 14)
        R.cyl('dark', (-L / 2 - 6, 0, zz), (-L / 2 - 26, 0, zz), 8.2, 14, r2=11.0); R.sph('engine', (-L / 2 - 12, 0, zz), 6.0, 8, 5)

def tug(R):
    """A tug: a lofted hull with a rubber fender bow, a two-tier wheelhouse with lit windows, a stack, a mast and beacon,
    a towing winch, hazard stripes, and two thruster pods aft (-x)."""
    R.kind = 'tug'
    secs = [(-17.0, 8.5, 5.0, 0.0), (-12.0, 9.0, 5.5, 0.0), (8.0, 9.0, 5.5, 0.0), (15.0, 7.2, 5.0, 0.4), (17.5, 5.0, 4.4, 0.8)]
    R.loft('w_ochre', secs, HULL_RING)
    R.box('w_grey', (0, 5.6, 0), (30.0, 0.5, 16.5))                                        # the deck
    for sz in (-1, 1):
        R.box('w_red', (-1.0, -2.8, sz * 9.05), (33.0, 1.1, 0.25))                         # the boot stripe
        for xx in np.arange(-13.0, 14.0, 2.4): R.box('yellow' if int((xx + 13) / 2.4) % 2 == 0 else 'dark', (xx, 3.0, sz * 9.1), (1.2, 1.3, 0.2))   # the rubbing strake
    for zz in (-3.6, -1.2, 1.2, 3.6): R.cyl('dark', (17.4, -1.6, zz), (17.4, 3.6, zz), 1.15, 8)
    # the wheelhouse: two tiers, windows all round, a visor
    R.box('w_white', (4.5, 8.4, 0), (12.0, 5.0, 11.5)); R.box('w_grey', (4.5, 10.95, 0), (12.6, 0.4, 12.1))
    R.box('w_white', (3.5, 12.6, 0), (8.0, 4.0, 8.0)); R.box('w_grey', (3.5, 14.75, 0), (8.6, 0.4, 8.6))
    for sz in (-1, 1):
        R.box('win', (4.5, 8.7, sz * 5.78), (9.6, 1.6, 0.12)); R.box('wincool', (3.5, 12.9, sz * 4.04), (6.2, 1.6, 0.12))
        for k in range(5): R.box('dark', (0.2 + k * 2.4, 8.7, sz * 5.82), (0.3, 1.7, 0.14))
    R.box('wincool', (7.56, 12.9, 0), (0.12, 1.6, 6.2)); R.box('win', (10.56, 8.7, 0), (0.12, 1.6, 9.6))
    for k in range(4): R.box('dark', (10.6, 8.7, -3.6 + k * 2.4), (0.14, 1.7, 0.3))
    R.cyl('w_red', (-1.5, 11.0, 3.2), (-1.5, 17.0, 3.2), 1.3, 10, r2=1.1); R.cyl('dark', (-1.5, 17.0, 3.2), (-1.5, 17.4, 3.2), 1.2, 10)   # the stack
    R.cyl('truss', (2.5, 14.9, 0), (2.5, 22.0, 0), 0.3, 6); R.box('truss', (2.5, 20.0, 0), (0.3, 0.3, 4.4)); R.sph('navr', (2.5, 22.3, 0), 0.6, 5, 4)
    R.sph('win', (7.2, 15.1, 2.6), 0.55, 5, 4); R.sph('win', (7.2, 15.1, -2.6), 0.55, 5, 4)
    # the towing winch and bitts aft, a hook
    R.cyl('dark', (-10.5, 6.0, 0), (-10.5, 7.8, 0), 1.9, 10); R.box('w_red', (-10.5, 8.3, 0), (3.6, 0.9, 1.2))
    for sz in (-1, 1): R.cyl('truss', (-13.0, 5.8, sz * 3.0), (-13.0, 7.2, sz * 3.0), 0.7, 6)
    for sz in (-1, 1):                                                                     # thruster pods
        R.cyl('w_grey', (-17.0, -3.2, sz * 6.0), (-19.5, -3.2, sz * 6.0), 2.9, 12)
        R.cyl('dark', (-19.5, -3.2, sz * 6.0), (-24.5, -3.2, sz * 6.0), 2.4, 12, r2=3.4); R.sph('engine', (-20.5, -3.2, sz * 6.0), 1.9, 8, 5)
    R.sph('navr', (6.5, 7.0, -5.7), 0.4, 4, 3); R.sph('navg', (6.5, 7.0, 5.7), 0.4, 4, 3)

# back dock: a pier across the far window, ships on both sides of it
pier(Rig((0, -64, -340)))
freighter(Rig((-330, -40, -438), 0.0), 320.0, 'w_cream')
hauler(Rig((190, -42, -296), 0.0), 210.0)
tug(Rig((-40, -34, -282), 8.0))
freighter(Rig((620, -30, -470), 8.0), 260.0, 'w_ochre')
# right dock: a pier along the +x window (running in z), a liner and a clamp ship on it
pier(Rig((355, -66, 0), 90.0))
liner(Rig((470, -26, -60), 90.0), 470.0, 34.0)
hauler(Rig((310, -44, 250), 90.0), 190.0)
tug(Rig((300, -36, -250), -80.0))
# a little traffic in the open sky ahead
tug(Rig((130, -8, -600), 20.0)); tug(Rig((-520, 22, -700), -15.0))

if '--layout' in argv:                          # tools/window-view.js reads this: where every piece sits, no render
    import json
    json.dump([{'kind': r.kind, 'lo': [round(float(x), 1) for x in r.lo], 'hi': [round(float(x), 1) for x in r.hi]} for r in RIGS if r.lo[0] < 1e8],
              open(os.path.join(OUT, 'layout.json'), 'w'))
    sys.exit(0)

for mname, (V, F) in GEO.items():
    me = bpy.data.meshes.new('geo_' + mname); me.from_pydata(V, [], F); me.update()
    o = bpy.data.objects.new('geo_' + mname, me); ships_col.objects.link(o); o.data.materials.append(MAT[mname])
    for p in me.polygons: p.use_smooth = mname.startswith('tank_')

# ---- the planet: a unit sphere scaled up, procedural in object space --------------------------
R_P = DIST * math.sin(math.radians(PLANET_DEG))
bpy.ops.mesh.primitive_uv_sphere_add(segments=160, ring_count=80, radius=1.0, location=bl(PLANET_DIR) * DIST)
planet = bpy.context.active_object; planet.name = 'planet'; planet.scale = (R_P, R_P, R_P)
planet.rotation_euler = (math.radians(64), math.radians(8), math.radians(40))   # the pole leans away from the camera: no ice cap in the window
bpy.ops.object.shade_smooth()
pm = bpy.data.materials.new('planet'); pm.use_nodes = True; planet.data.materials.append(pm)
nt = pm.node_tree; N = nt.nodes; L = nt.links
for n in list(N): N.remove(n)
def nn(t, **kw):
    n = N.new(t)
    for k, v in kw.items():
        if k.startswith('in_'): n.inputs[k[3:].replace('_', ' ')].default_value = v
        else: setattr(n, k, v)
    return n
tc = nn('ShaderNodeTexCoord')
def noise3(scale, detail, rough, off=(0, 0, 0), stretch=(1, 1, 1), distort=0.0, ntype='FBM'):
    mp = nn('ShaderNodeMapping'); mp.inputs['Scale'].default_value = stretch; mp.inputs['Location'].default_value = off
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    n = nn('ShaderNodeTexNoise', noise_dimensions='3D', normalize=True)
    try: n.noise_type = ntype
    except Exception: pass
    n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough
    n.inputs['Distortion'].default_value = distort
    L.new(mp.outputs['Vector'], n.inputs['Vector'])
    return n.outputs['Fac']
def ramp(fac, stops):
    r = nn('ShaderNodeValToRGB'); el = r.color_ramp.elements
    while len(el) > 2: el.remove(el[-1])
    for i, (p, h) in enumerate(stops):
        e = el[i] if i < 2 else el.new(p)
        e.position = p; e.color = K.hexlin(h) if isinstance(h, int) else h
    L.new(fac, r.inputs['Fac']); return r.outputs['Color']
def mixc(fac, a, b):
    m = nn('ShaderNodeMix', data_type='RGBA', blend_type='MIX')
    L.new(fac, m.inputs['Factor'])
    ins = [i for i in m.inputs if i.type == 'RGBA']
    L.new(a, ins[0]); L.new(b, ins[1]); return [o for o in m.outputs if o.type == 'RGBA'][0]
def fmap(fac, a, b, lo=0.0, hi=1.0):
    m = nn('ShaderNodeMapRange', clamp=True); L.new(fac, m.inputs['Value'])
    m.inputs['From Min'].default_value = a; m.inputs['From Max'].default_value = b; m.inputs['To Min'].default_value = lo; m.inputs['To Max'].default_value = hi
    return m.outputs['Result']
def fadd(a, b):
    m = nn('ShaderNodeMath', operation='ADD', use_clamp=True); L.new(a, m.inputs[0]); L.new(b, m.inputs[1]); return m.outputs[0]
def shade(fac, col, k):
    """col darkened toward col * k by fac (a multiply mix)."""
    m = nn('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY'); L.new(fac, m.inputs['Factor'])
    ins = [i for i in m.inputs if i.type == 'RGBA']; L.new(col, ins[0]); ins[1].default_value = (k, k, k, 1.0)
    return [o for o in m.outputs if o.type == 'RGBA'][0]
def fmul(a, b):
    m = nn('ShaderNodeMath', operation='MULTIPLY'); L.new(a, m.inputs[0]); L.new(b, m.inputs[1]); return m.outputs[0]
def sep(vec_out, i): s = nn('ShaderNodeSeparateXYZ'); L.new(vec_out, s.inputs[0]); return s.outputs[i]

cont = noise3(2.0, 7, 0.55, (2.1, 7.7, 3.3), distort=0.6)                        # continents, warped so the coasts wander
cdet = noise3(12.0, 5, 0.6, (7.0, 1.0, 4.0))                                       # coast detail
dens = noise3(0.9, 3, 0.5, (9.1, 1.3, 4.4))                                        # which land is settled
contd = fadd(cont, fmap(cdet, 0.0, 1.0, -0.05, 0.05))
land = fmap(contd, LAND, LAND + 0.02)
tone = noise3(3.2, 6, 0.55, (4.4, 8.8, 1.2), distort=0.4)
tone2 = noise3(7.5, 5, 0.5, (2.0, 3.0, 9.0), distort=0.3)
ridge = noise3(5.0, 7, 0.55, (1.0, 6.0, 9.0), ntype='RIDGED_MULTIFRACTAL')         # mountain chains
land_c = ramp(tone, [(0.0, 0x5e3526), (0.30, 0x8f5a38), (0.58, 0xc19a6c), (0.82, 0xdcc79f), (1.0, 0x7d6b4f)])
veg = fmul(fmap(tone2, 0.50, 0.68), fmap(tone, 0.25, 0.55))                        # scrub and farmland in the lows
land_c = mixc(fmul(veg, fmap(contd, LAND + 0.02, LAND + 0.09, 0.9, 0.35)), land_c, ramp(tone2, [(0.0, 0x4a5530), (1.0, 0x6f7a46)]))
land_c = mixc(fmul(fmap(ridge, 0.5, 0.85), fmap(contd, LAND + 0.04, LAND + 0.14)), land_c, ramp(ridge, [(0.0, 0x3a2820), (1.0, 0xc2b296)]))
coast = fmap(contd, LAND - 0.14, LAND)
sea_c = ramp(coast, [(0.0, 0x03121a), (0.5, 0x0b3f4c), (0.85, 0x1d7a80), (1.0, 0x58b8a8)])
col = mixc(land, sea_c, land_c)
za = nn('ShaderNodeMath', operation='ABSOLUTE'); L.new(sep(tc.outputs['Object'], 2), za.inputs[0])
zn2 = nn('ShaderNodeMath', operation='MULTIPLY_ADD'); L.new(noise3(6.0, 3, 0.5, (1.0, 2.0, 3.0)), zn2.inputs[0]); zn2.inputs[1].default_value = 0.12; L.new(za.outputs[0], zn2.inputs[2])
ice = fmap(zn2.outputs[0], 0.84, 0.92)
col = mixc(ice, col, ramp(tone, [(0.0, 0xdfe6ea), (1.0, 0xf6f6f2)]))
# clouds: warped, thin cirrus over them, their shadows laid on the ground
cl = noise3(2.4, 8, 0.62, (7.0, 3.0, 5.0), (1.0, 1.0, 1.9), distort=0.9)
clm = fmul(fmap(cl, 0.50, 0.70), fmap(noise3(1.1, 2, 0.5, (3.0, 9.0, 2.0)), 0.2, 0.6, 0.5, 1.0))
cir = fmap(noise3(7.5, 6, 0.55, (2.0, 4.0, 6.0), distort=0.6), 0.55, 0.78, 0.0, 0.5)
cloud = fadd(clm, cir)
cl_sh = noise3(2.4, 8, 0.62, (7.025, 2.975, 5.04), (1.0, 1.0, 1.9), distort=0.9)
col = shade(fmul(fmap(cl_sh, 0.50, 0.70), fmap(cl, 0.0, 0.5, 1.0, 0.0)), col, 0.45)
col = mixc(cloud, col, ramp(cl, [(0.0, 0xe3e5e8), (1.0, 0xffffff)]))
bsdf = nn('ShaderNodeBsdfPrincipled'); L.new(col, bsdf.inputs['Base Color'])
L.new(fmap(land, 0.0, 1.0, 0.26, 0.92), bsdf.inputs['Roughness'])                 # a wet ocean, a dry land
bump = nn('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.8; bump.inputs['Distance'].default_value = 40.0
L.new(fadd(fmul(land, fmap(ridge, 0.3, 1.0)), fmap(cdet, 0.0, 1.0, 0.0, 0.25)), bump.inputs['Height'])
L.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
try: bsdf.inputs['Specular IOR Level'].default_value = 0.3
except KeyError: pass
# city lights: only on settled land, only on the night side (normal . sun < 0), under no cloud
geo = nn('ShaderNodeNewGeometry')
sd = nn('ShaderNodeVectorMath', operation='DOT_PRODUCT'); L.new(geo.outputs['Normal'], sd.inputs[0]); sd.inputs[1].default_value = tuple(bl(SUN_DIR))
night = fmap(sd.outputs['Value'], 0.10, -0.12)
town = fmul(fmap(noise3(26.0, 5, 0.6, (3.0, 3.0, 9.0)), 0.56, 0.68), fmap(dens, 0.45, 0.62))
lights = fmul(fmul(town, land), fmul(night, fmap(cloud, 0.0, 0.7, 1.0, 0.1)))
L.new(ramp(tone, [(0.0, 0xffa24a), (1.0, 0xffd89a)]), bsdf.inputs['Emission Color'])
bsdf.inputs['Emission Strength'].default_value = 0.0
L.new(fmul(lights, fmap(tone, 0, 1, 6.0, 6.0)), bsdf.inputs['Emission Strength'])
out = nn('ShaderNodeOutputMaterial'); L.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

# the atmosphere: a shell, a thin bright rim that fades toward the night side
bpy.ops.mesh.primitive_uv_sphere_add(segments=160, ring_count=80, radius=1.0, location=bl(PLANET_DIR) * DIST)
atm = bpy.context.active_object; atm.name = 'atmosphere'; atm.scale = (R_P * 1.014,) * 3
bpy.ops.object.shade_smooth(); atm.visible_shadow = False
am = bpy.data.materials.new('atmosphere'); am.use_nodes = True; atm.data.materials.append(am)
nt = am.node_tree; N = nt.nodes; L = nt.links
for n in list(N): N.remove(n)
lw = nn('ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = 0.78
inv = nn('ShaderNodeMath', operation='SUBTRACT'); inv.inputs[0].default_value = 1.0; L.new(lw.outputs['Facing'], inv.inputs[1])
rim2 = nn('ShaderNodeMath', operation='POWER', use_clamp=True); L.new(inv.outputs[0], rim2.inputs[0]); rim2.inputs[1].default_value = 7.0
geo = nn('ShaderNodeNewGeometry')
sd = nn('ShaderNodeVectorMath', operation='DOT_PRODUCT'); L.new(geo.outputs['Normal'], sd.inputs[0]); sd.inputs[1].default_value = tuple(bl(SUN_DIR))
lit = nn('ShaderNodeMapRange', clamp=True); L.new(sd.outputs['Value'], lit.inputs['Value'])
lit.inputs['From Min'].default_value = -0.35; lit.inputs['From Max'].default_value = 0.5; lit.inputs['To Min'].default_value = 0.08; lit.inputs['To Max'].default_value = 1.0
amt = nn('ShaderNodeMath', operation='MULTIPLY', use_clamp=True); L.new(rim2.outputs[0], amt.inputs[0]); L.new(lit.outputs['Result'], amt.inputs[1])
e = nn('ShaderNodeEmission'); e.inputs['Color'].default_value = K.hexlin(0x8cc6ef); e.inputs['Strength'].default_value = 1.5
tr = nn('ShaderNodeBsdfTransparent'); mx = nn('ShaderNodeMixShader')
L.new(amt.outputs[0], mx.inputs['Fac']); L.new(tr.outputs['BSDF'], mx.inputs[1]); L.new(e.outputs['Emission'], mx.inputs[2])
out = nn('ShaderNodeOutputMaterial'); L.new(mx.outputs['Shader'], out.inputs['Surface'])

for _o in (planet, atm):
    for _c in list(_o.users_collection): _c.objects.unlink(_o)
    planet_col.objects.link(_o)
# two suns, one direction: the ships' sun is blocked by everything (so a stack shades itself), the planet's sun by a decoy
# alone (so no ship shadow crawls across a world 3000 units below); the planet still bounces light back onto the ships
def make_sun(name, receivers, blockers, toward=None, energy=2.5, colour=0xfff1dc, size=0.5):
    d = bpy.data.lights.new(name, 'SUN'); d.energy = energy; d.angle = math.radians(size); d.color = K.hexlin(colour)[:3]
    o = bpy.data.objects.new(name, d); sc.collection.objects.link(o)
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = (-bl(SUN_DIR if toward is None else toward)).to_track_quat('-Z', 'Y')
    try:
        o.light_linking.receiver_collection = receivers
        if blockers is not None: o.light_linking.blocker_collection = blockers
    except Exception as e: print('sky: light linking unavailable', e)
    return o
_dm = bpy.data.meshes.new('decoy'); _dm.from_pydata([(0, 0, 0), (0.01, 0, 0), (0, 0.01, 0)], [], [(0, 1, 2)])
_do = bpy.data.objects.new('decoy', _dm); decoy_col.objects.link(_do); _do.location = (0, 0, -5000)
sun = make_sun('sun_ships', ships_col, None)
sun_planet = make_sun('sun_planet', planet_col, decoy_col)
# the dock's own floodlights, from the camera's side and above: without them the faces we see are all in shade
fill = make_sun('fill_ships', ships_col, None, K.unit((0.25, 0.55, 0.80)), 1.25, 0xffe2c0, 12.0)

# ---- the haze behind it all: a faint band, rendered on its own --------------------------------
node, link, math_, vmath, noise, mix_ = sky.node, sky.link, sky.math, sky.vmath, sky.noise, sky.mix
D, bg = sky.D, sky.bg
off = [tuple(rng.uniform(-50, 50, 3)) for _ in range(3)]
bn = K.unit((0.30, 0.80, 0.40))
x = math_('ADD', vmath('DOT_PRODUCT', D, tuple(bn)), math_('MULTIPLY', math_('SUBTRACT', noise(vmath('ADD', D, off[0]), 2.0, 4, 0.55).outputs['Fac'], 0.5), 0.25))
band = math_('EXPONENT', math_('MULTIPLY', math_('POWER', math_('DIVIDE', x, 0.30), 2.0), -1.0))
gas = noise(vmath('ADD', D, off[1]), 2.6, 7, 0.6)
dens_w = math_('MULTIPLY', math_('POWER', gas.outputs['Fac'], 2.4), band)
link(sky.ramp(dens_w, [(0.0, 0x020306), (0.4, 0x0a1220), (1.0, 0x3b4a60)]), bg.inputs['Color']); bg.inputs['Strength'].default_value = 0.35

def render_haze(f):
    for o in sc.objects:
        if o.type == 'MESH': o.hide_render = True
    sc.render.film_transparent = False; sc.render.engine = 'BLENDER_EEVEE'
    sc.eevee.taa_render_samples = 8
    return sky.render_face(f)
def render_scene(f):
    for o in sc.objects:
        if o.type == 'MESH': o.hide_render = False
    sc.render.film_transparent = True; sc.render.engine = 'CYCLES'
    bg.inputs['Strength'].default_value = 0.0
    r = sky.render_face(f, alpha=True)
    bg.inputs['Strength'].default_value = 0.35
    return r

# ---- numpy layers ------------------------------------------------------------------------------
def ang(dirs, v): return np.degrees(np.arccos(np.clip(dirs @ v, -1, 1)))
def sun_glow(dirs):
    a = ang(dirs, SUN_DIR)
    g = 0.55 * np.exp(-a / 1.1) + 0.08 * np.exp(-a / 6.0) + 0.012 * np.exp(-a / 22.0)
    g += 8.0 * (a < 0.42)
    return g[..., None] * np.array(K.hexlin(0xffeccf)[:3])
def gblur(a, s):
    """Gaussian blur by FFT, zero-padded: a light on a face seam loses the half of its halo that belongs to the next face."""
    pad = int(s * 3.5) + 1
    a = np.pad(a, ((pad, pad), (pad, pad), (0, 0)))
    H, W = a.shape[:2]
    fy = np.fft.fftfreq(H)[:, None]; fx = np.fft.rfftfreq(W)[None, :]
    k = np.exp(-2 * (np.pi * s) ** 2 * (fx * fx + fy * fy))
    r = np.stack([np.fft.irfft2(np.fft.rfft2(a[..., c]) * k, s=(H, W)) for c in range(a.shape[2])], -1)
    return r[pad:-pad, pad:-pad]

rng2 = np.random.default_rng(SEED + 1)
stars = K.star_list(rng2, int(STARS * (RES / 2048) ** 2), bn, 0.32, 0.4, mag=(0.07, 0.03))
done = {}
for f in K.FACES:
    if f not in FACES: continue
    dirs = K.face_dirs(f, RES)
    lin = render_haze(f)
    lin = lin + sun_glow(dirs)
    rgba = render_scene(f)
    a = np.clip(rgba[..., 3], 0, 1)
    K.splat_stars(lin, f, stars, RES, mask=a)
    lin = lin * (1 - a)[..., None] + rgba[..., :3] * GAIN
    s = RES / 2048.0
    bright = np.maximum(lin - 0.45, 0)
    lin = lin + BLOOM * (0.55 * gblur(bright, 3.0 * s) + 0.35 * gblur(bright, 11.0 * s) + 0.2 * gblur(bright, 38.0 * s))
    a8 = K.to_srgb8(lin, rng2)
    K.save_png(a8, os.path.join(OUT, '%s_%s.png' % (NAME, f))); done[f] = a8
    print('sky: wrote %s_%s.png' % (NAME, f))
if PREVIEW and len(done) == 6:
    K.save_png(K.cross(done, RES), os.path.join(OUT, '%s_cross.png' % NAME))
sky.cleanup()
print('sky: done')
