"""
build_moon_base.py  --  Fuzeball MOON BASE room -> GLB

    blender -b -P tools/build_moon_base.py -- [--tex 2048] [--seed 5]
    node tools/ktx2-encode.mjs tools/build/moon/fuzeball_room_moon.raw.glb assets/rooms/moon/fuzeball_room_moon.glb

The checklist brief: grey dust, Earth hanging in a black sky, one hard sun. DIRECTION.md: rooms are venues people actually play in,
small and scruffy, so this is a cramped hab dome 3.5 m across (1 unit = 1 cm) in a small crater, the table bolted to its floor,
a Federation flag planted outside.

GEOMETRY comes from the owner's hand-edited tools/build/moon/moon_base.blend (GEO_SRC; the generator that first made it is in git,
02f8b43): the terrain flattened to 0.6 of its height, remodelled O2 tanks, a taller door, a steel kick ring round the wall base.
Edit shapes there; this script owns the materials, UVs and the bake, and replaces two meshes with the same surface cut finer:
the floor disc (a polar grid) and the wall ring (rows, and a UV round it). Its own result is saved as moon_room.blend.

    terrain   tiling regolith (albedo + normal) x baked colour; the boulders wear it too
    floor     one map + normal + ORM: deck panels with recessed fasteners, the blue ring, a tread-plate apron at the airlock, regolith
              tracked in on boots (prints, trails, seams, the wall base)
    wall      one tiling map + normal + ORM round the ring: painted panels, a blue band, fasteners, chips, dust low down
    glass     a dust film, thickest low down where the regolith settles, a few gloved wipes
    props     surface sets (tools/roomlib.py: steel, paint, plastic), projected in each loose part's own frame (struts and rings along their length)
    bake      ambient occlusion + the light strip and the door lamp ray-traced per corner into the baked colour; no lights are exported

The steel keeps the owner's tuning (metal 0.99, rough 0.30); the flag wears the owner's logo render (FLAG_SRC).
NO LIGHTS ARE EXPORTED. The sun is CONFIG.rooms.moon.dir (casts the table's shadow); SUN_DIR in build_moon_sky.py must match dir.pos.
"""
import bpy, bmesh, os, sys, math
import numpy as np
from mathutils import Vector, Matrix, noise, kdtree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roomlib as R
from roomlib import sstep, hx, tfbm, seg_aa, height_to_normal

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(n, d): return type(d)(argv[argv.index(n) + 1]) if n in argv else d
TEX  = arg('--tex', 2048)
SEED = arg('--seed', 5)
ROOT  = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
BUILD = os.path.join(ROOT, 'tools', 'build', 'moon')
GEO_SRC = os.path.join(BUILD, 'moon_base.blend')
GLB = os.path.join(BUILD, 'fuzeball_room_moon.raw.glb')
FLAG_SRC = [os.path.join(BUILD, 'moon_flag_render.png'), os.path.join(ROOT, '..', '..', 'Fuzeball files', 'blender files', 'renders', 'fuzeball_render_tc_cycles.png')]
urng = np.random.default_rng(SEED + 500)
TS = TEX / 2048.0

# ---- the numbers that matter (game units, 1 = 1 cm) --------------------------------------------
FY       = -44.0                     # floor = table feet
DOME_R   = 176.0                     # glass radius; every game camera sits inside it
WALL_R   = 172.0                     # ring wall inner face = floor edge
WALL_TOP = -26.0                     # the dome springs from here
WALL_Y0  = FY - 4.0
TILE     = 96.0                      # regolith texture repeat, units
LEGS     = [(sx * 58, sz * 32) for sx in (-1, 1) for sz in (-1, 1)]
AIRLOCK  = math.radians(-128)        # azimuth (from +x toward +z) of the airlock door
DOOR_HALF = math.atan2(20, WALL_R)
WALL_REP = 12                        # wall texture repeats round the ring
TILE_U   = 2 * math.pi * WALL_R / WALL_REP
GLASS_REP = 8                        # glass dust film repeats round the dome
GLASS_GLOW = 0.35                    # the dust film's own light (emissive x its colour); 0 = it shows only where the scene lights it
DOME_C   = Vector((0, 0, WALL_TOP + 1.6))
NOFF     = Vector((11.3, -4.2, 7.9))
def g2b(x, y, z): return Vector((x, -z, y))
ca, sa = math.cos(AIRLOCK), math.sin(AIRLOCK)
def at(r, y, side=0.0):   # game point at radius r along the airlock axis, `side` across it
    return (r * ca - side * sa, y, r * sa + side * ca)

# ---- scene, the owner's geometry, materials -----------------------------------------------------
if not os.path.exists(GEO_SRC): raise SystemExit('moon: the geometry source is missing: ' + GEO_SRC)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = bpy.data.collections.new('Moon Room'); scene.collection.children.link(col)
def link(o): col.objects.link(o); return o
with bpy.data.libraries.load(GEO_SRC, link=False) as (src, dst): dst.objects = list(src.objects)
for m in list(bpy.data.materials): m.name = 'src_' + m.name
for im in list(bpy.data.images): im.name = 'src_' + im.name
SRC = {}       # the owner's material name -> its objects
for o in dst.objects:
    if o is None or o.type != 'MESH': continue
    link(o); o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)
    SRC.setdefault(o.data.materials[0].name[4:], []).append(o)
print('moon: geometry from', GEO_SRC, sorted((k, len(v)) for k, v in SRC.items()))

def set_active(*objs):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[-1]
def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)
SURF = {}      # kind -> {'alb', 'mean', 'n', 'orm', 'albs': {material: own albedo}}
FACT = {}      # material -> (roughness, metallic) factors written into the GLB after export
KIND = {}      # material -> surface kind (its UVs are projected at that set's tile)
IMGS = []
def link_orm(nt, b, img):
    o = nt.nodes.new('ShaderNodeTexImage'); o.image = img
    sp = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(o.outputs['Color'], sp.inputs['Color'])
    nt.links.new(sp.outputs['Green'], b.inputs['Roughness']); nt.links.new(sp.outputs['Blue'], b.inputs['Metallic'])
def link_nrm(nt, b, img):
    n = nt.nodes.new('ShaderNodeTexImage'); n.image = img
    nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
def mix_vcol(nt, src, b):
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1.0
    ins = [i for i in mx.inputs if i.type == 'RGBA']
    nt.links.new(src, ins[0]); nt.links.new(vc.outputs['Color'], ins[1])
    nt.links.new([o for o in mx.outputs if o.type == 'RGBA'][0], b.inputs['Base Color'])
def flat_mat(name, hexc, metal=0.0, rough=0.6, emit=None, emit_str=1.0, kind=None):
    """A prop material. With a surface kind it wears that set and metal / rough become the factors on its ORM; emissive ones stay plain."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']; c = srgb(hexc)
    b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
    if emit is not None:
        b.inputs['Emission Color'].default_value = srgb(emit); b.inputs['Emission Strength'].default_value = emit_str
    S = SURF.get(kind) if emit is None else None
    if S:
        own = S['albs'].get(name); a = nt.nodes.new('ShaderNodeTexImage'); a.image = own or S['alb']
        if own is None:                                       # neutral map x colour, lifted by the map's mean so the material keeps its value
            mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1.0
            ins = [i for i in mx.inputs if i.type == 'RGBA']
            nt.links.new(a.outputs['Color'], ins[0]); ins[1].default_value = tuple(min(1.0, x / S['mean']) for x in c[:3]) + (1.0,)
            nt.links.new([o for o in mx.outputs if o.type == 'RGBA'][0], b.inputs['Base Color'])
        else:
            nt.links.new(a.outputs['Color'], b.inputs['Base Color'])
        link_nrm(nt, b, S['n']); link_orm(nt, b, S['orm']); FACT[name] = (rough, metal); KIND[name] = kind
    else:
        b.inputs['Base Color'].default_value = c
    m.diffuse_color = c; m.use_backface_culling = True
    return m
def new_img(name, w, h, data=False, alpha=False):
    im = bpy.data.images.new(name, w, h, alpha=alpha)
    im.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    return im
def np_img(im, arr, a=None):
    """Row 0 of arr = the top of the image."""
    h, w = arr.shape[:2]; rgba = np.ones((h, w, 4), np.float32); rgba[..., :3] = np.clip(arr, 0, 1)
    if a is not None: rgba[..., 3] = a
    im.pixels.foreach_set(rgba[::-1].ravel()); im.update()
    im.filepath_raw = os.path.join(BUILD, im.name + '.png'); im.file_format = 'PNG'; im.save(); IMGS.append(im)
def tex_mat(name, albedo, normal=None, vcol=False, alpha=False, rough=0.7, metal=0.0, orm=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']; m.use_backface_culling = not alpha
    a = nt.nodes.new('ShaderNodeTexImage'); a.image = albedo
    if vcol: mix_vcol(nt, a.outputs['Color'], b)
    else: nt.links.new(a.outputs['Color'], b.inputs['Base Color'])
    if normal is not None: link_nrm(nt, b, normal)
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if orm is not None: link_orm(nt, b, orm)
    if alpha:
        nt.links.new(a.outputs['Alpha'], b.inputs['Alpha'])
        for k, v in (('surface_render_method', 'BLENDED'), ('blend_method', 'BLEND')):
            try: setattr(m, k, v)
            except Exception: pass
    return m

# =============================================================================================
# TEXTURES
# =============================================================================================
def stamp(img, cx, cy, rad, fn, wrap=True, mode='add'):
    """Apply fn(dx, dy) (pixel offsets from the centre) into img within rad pixels of (cx, cy); wraps on a tiling map."""
    H, W = img.shape; r = int(rad) + 2
    ys = np.arange(int(cy) - r, int(cy) + r + 1); xs = np.arange(int(cx) - r, int(cx) + r + 1)
    if wrap: yi, xi = ys % H, xs % W
    else:
        ys = ys[(ys >= 0) & (ys < H)]; xs = xs[(xs >= 0) & (xs < W)]
        if not len(ys) or not len(xs): return
        yi, xi = ys, xs
    dx = (xs + 0.5 - cx)[None, :]; dy = (ys + 0.5 - cy)[:, None]
    v = fn(dx, dy); sub = img[np.ix_(yi, xi)]
    img[np.ix_(yi, xi)] = sub + v if mode == 'add' else (np.maximum(sub, v) if mode == 'max' else sub * v)

def regolith_textures(n):
    """Tiling regolith, TILE cm a repeat: fine grain, pebbles, small craters, no feature big enough to show the repeat. -> albedo, normal"""
    px = TILE / n
    H = sum(R.tn(n, n, P, P, SEED + P) * w for P, w in ((8, 0.7), (16, 0.6), (32, 0.45), (64, 0.32), (128, 0.24), (256, 0.16), (512, 0.1)))
    H = (H - H.mean()) * 0.55
    rocks = np.zeros((n, n), np.float32); pits = np.zeros((n, n), np.float32)
    for _ in range(int(2600 * (TILE / 96.0) ** 2)):                  # pebbles, wrapped
        cx, cy = urng.uniform(0, n, 2); rr = float(urng.uniform(0.12, 0.75) ** 1.3 + 0.08) / px; ht = rr * px * 0.5
        sx, sy = urng.uniform(0.7, 1.3, 2); tone = float(urng.uniform(-0.6, 1.0))
        peb = lambda dx, dy: np.clip(1 - (dx * sx) ** 2 / rr ** 2 - (dy * sy) ** 2 / rr ** 2, 0, 1)
        stamp(H, cx, cy, rr * 1.4, lambda dx, dy: peb(dx, dy) ** 0.6 * ht)
        stamp(rocks, cx, cy, rr * 1.4, lambda dx, dy: peb(dx, dy) * tone)
    for _ in range(int(110 * (TILE / 96.0) ** 2)):                    # small craters, none over ~2 cm across
        cx, cy = urng.uniform(0, n, 2); rr = float(urng.uniform(0.35, 1.1)) / px
        def crater(dx, dy):
            d = np.hypot(dx, dy) / rr
            return np.where(d < 1, -(1 - d * d) * 0.3 * rr * px, 0) + np.where((d >= 0.85) & (d < 1.5), 0.07 * rr * px * np.sin((d - 0.85) / 0.65 * math.pi), 0)
        stamp(H, cx, cy, rr * 1.6, crater)
        stamp(pits, cx, cy, rr * 1.2, lambda dx, dy: np.clip(1 - np.hypot(dx, dy) / rr, 0, 1), mode='max')
    nrm = height_to_normal(H, px, px, 1.0, True, True)
    tone = 0.6 + 0.05 * (R.tfbm(n, n, 16, 16, SEED + 7, 4) - 0.5) + 0.06 * (R.tn(n, n, 160, 160, SEED + 8) - 0.5)
    cav = np.clip(-(H - R.gblur(H, 3.0)) / 0.35, 0, 1)                # grain shadowed in its own hollows (no light direction baked in)
    lum = tone * (1 - 0.22 * cav) * (1 - 0.12 * pits) + 0.06 * np.clip(rocks, -1, 1)
    alb = np.clip(lum[..., None] * np.array([1.0, 0.985, 0.955]), 0, 1)
    return alb, nrm

FR = WALL_R                          # the floor map covers -FR..FR on x and z
TRAILS = [   # boot trails from the airlock (game x, z), dust load at the door
    ([(-104.0, -133.0), (-82.0, -100.0), (-48.0, -72.0), (-6.0, -66.0), (42.0, -70.0)], 1.0),
    ([(-104.0, -133.0), (-62.0, -150.0), (-40.0, -146.0)], 0.9),
    ([(-104.0, -133.0), (-128.0, -96.0), (-138.0, -84.0)], 0.8),
    ([(-104.0, -133.0), (-112.0, -74.0), (-100.0, -10.0), (-82.0, 52.0), (-30.0, 74.0), (36.0, 78.0)], 0.75),
]
def trail_steps(pts, stride=64.0):
    """Footfalls along a polyline: (x, z, heading, side, index)."""
    out = []; carry = 6.0; k = 0
    for (x0, z0), (x1, z1) in zip(pts[:-1], pts[1:]):
        L = math.hypot(x1 - x0, z1 - z0); a = math.atan2(z1 - z0, x1 - x0); t = carry
        while t < L:
            side = 1 if k % 2 == 0 else -1
            out.append((x0 + (x1 - x0) * t / L - math.sin(a) * side * 9.0, z0 + (z1 - z0) * t / L + math.cos(a) * side * 9.0, a, side, k))
            t += stride * 0.5; k += 1
        carry = t - L
    return out

def floor_texture(n):
    """One map over the floor disc, row 0 = game z -FR. Deck panels (each laid a little out of true, so the sheen changes panel to panel)
    with four recessed fasteners, the Federation-blue ring, a tread-plate apron in a hazard border at the airlock, regolith tracked in on
    boots (prints fading along each trail, the trails, the seams, the wall base), heel scuffs where players stand. -> albedo, normal, ORM"""
    px = 2 * FR / n
    c = (-FR + (np.arange(n) + .5) * px).astype(np.float32)
    X = np.tile(c[None, :], (n, 1)); Z = np.tile(c[:, None], (1, n)); Rr = np.hypot(X, Z)
    P = 48.0
    ix = np.floor(X / P); iz = np.floor(Z / P)
    lx = X - (ix + .5) * P; lz = Z - (iz + .5) * P
    edge = P / 2 - np.maximum(np.abs(lx), np.abs(lz))
    seam = 1 - sstep(0.15, 0.6, edge)
    hsh = ((ix.astype(np.int64) * 73856093) ^ (iz.astype(np.int64) * 19349663)) & 0xffffff
    ph = (hsh % 1000) / 1000.0; tx = ((hsh // 7) % 997) / 997.0 - 0.5; tz = ((hsh // 13) % 991) / 991.0 - 0.5
    mott = tfbm(n, n, 9, 9, SEED + 1, 5); fine = R.tn(n, n, 300, 300, SEED + 2)
    alb = hx(0x6f757a)[None, None] * (0.86 + 0.2 * ph)[..., None] * (0.9 + 0.2 * mott)[..., None] * (0.97 + 0.06 * fine)[..., None]
    alb = alb * (1 - 0.55 * seam)[..., None] * (1 - 0.14 * np.exp(-np.maximum(edge, 0) / 3.0))[..., None]     # grime gathers toward the seams
    Hh = -0.55 * seam + 0.04 * (tx * lx + tz * lz) * (1 - seam) + 0.04 * (fine - 0.5)
    rough = 0.4 + 0.1 * (ph - 0.5) + 0.1 * (tfbm(n, n, 12, 12, SEED + 3, 4) - 0.5); rough = rough * (1 - seam) + 0.85 * seam
    metal = np.zeros((n, n), np.float32)
    # fasteners: a countersunk screw in each corner of every panel, its slot at the panel's own angle
    q = P / 2 - 3.4; bx = np.abs(lx) - q; bz = np.abs(lz) - q; db = np.hypot(bx, bz)
    head = 1 - sstep(0.7, 0.9, db); rim = np.exp(-((db - 1.0) / 0.16) ** 2)
    sl = ph * math.pi; slot = head * (np.abs(bx * np.sin(sl) - bz * np.cos(sl)) < 0.12)
    alb = alb * (1 - 0.35 * rim[..., None]) * (1 - head[..., None]) + hx(0x8a8e91) * (head * (1 - 0.6 * slot))[..., None]
    Hh += -0.3 * rim - 0.2 * slot; rough = np.where(head > 0.5, 0.36, rough + 0.2 * rim); metal = np.maximum(metal, head * (1 - slot))
    # the Federation-blue ring round the table, worn where feet cross it
    ringm = sstep(95, 96, Rr) * (1 - sstep(99, 100, Rr)) * sstep(0.26, 0.5, tfbm(n, n, 30, 30, SEED + 4, 4) * 0.6 + mott * 0.4)
    alb = alb * (1 - ringm[..., None]) + hx(0x1d4f73) * (0.9 + 0.2 * fine)[..., None] * ringm[..., None]
    rough = rough * (1 - ringm) + 0.48 * ringm; Hh += 0.06 * ringm
    # the airlock apron: diamond tread plate in a worn hazard border
    Aa = X * ca + Z * sa; Ss = -X * sa + Z * ca
    apron = (Aa > 132) & (Aa < 178) & (np.abs(Ss) < 24)
    inner = (Aa > 135.5) & (Aa < 178) & (np.abs(Ss) < 20.5)
    border = apron & ~inner
    hzw = 1 - 0.7 * sstep(0.5, 0.75, tfbm(n, n, 24, 24, SEED + 5, 5))
    stripe = ((Aa + Ss) / 4.2 % 2.0) < 1.0
    hcol = np.where(stripe[..., None], hx(0xd2a21e), hx(0x18191b))
    alb = np.where(border[..., None], hcol * (0.72 + 0.28 * hzw[..., None]) + alb * (0.28 * (1 - hzw[..., None])), alb)
    rough = np.where(border, 0.5 * hzw + rough * (1 - hzw), rough); Hh = Hh + 0.06 * border * hzw
    Pd = 3.0; ci = np.floor(Aa / Pd); cj = np.floor(Ss / Pd)
    u = (Aa % Pd) / Pd - 0.5; v = (Ss % Pd) / Pd - 0.5; sg = np.where((ci + cj) % 2 == 0, 1.0, -1.0)
    a_ = (u + sg * v) * 0.7071; b_ = (v - sg * u) * 0.7071
    lug = np.clip(1 - (a_ / 0.36) ** 2 - (b_ / 0.085) ** 2, 0, 1) ** 0.5
    pgr = sstep(0.45, 0.8, tfbm(n, n, 10, 10, SEED + 6, 4))
    steel = hx(0x8d9398)[None, None] * (0.78 + 0.22 * tfbm(n, n, 40, 40, SEED + 7, 3))[..., None]
    steel = steel * (1 - 0.45 * (1 - lug) * (0.4 + 0.6 * pgr))[..., None] * (1 + 0.12 * lug)[..., None]
    alb = np.where(inner[..., None], steel, alb)
    Hh = np.where(inner, 0.22 * lug, Hh); rough = np.where(inner, 0.3 + 0.18 * (1 - lug) + 0.22 * pgr, rough)
    metal = np.where(inner, 1.0 - 0.25 * pgr * (1 - lug), metal)
    # regolith: down the trails, packed into the seams and the tread, drifted against the wall
    trail = np.zeros((n, n), np.float32)
    for pts, load in TRAILS:
        run = 0.0
        for (x0, z0), (x1, z1) in zip(pts[:-1], pts[1:]):
            L = math.hypot(x1 - x0, z1 - z0)
            t = np.clip(((X - x0) * (x1 - x0) + (Z - z0) * (z1 - z0)) / (L * L), 0, 1)
            d = np.hypot(X - (x0 + t * (x1 - x0)), Z - (z0 + t * (z1 - z0)))
            trail = np.maximum(trail, np.exp(-(d / 15.0) ** 2) * load * np.exp(-(run + t * L) / 150.0)); run += L
    patchy = sstep(0.3, 0.7, tfbm(n, n, 14, 14, SEED + 8, 5) * 0.6 + fine * 0.4)
    film = 0.1 + 0.22 * sstep(0.45, 0.8, tfbm(n, n, 5, 5, SEED + 9, 5)) + 0.1 * sstep(0.5, 0.8, fine)
    dust = trail * (0.4 + 0.6 * patchy) * 0.9 + 0.7 * seam * sstep(0.3, 0.6, mott) + 0.7 * sstep(140, 171, Rr) * (0.4 + 0.6 * patchy)
    dust = dust + 0.6 * inner * (1 - lug) * (0.5 + 0.5 * pgr) + film * (1 - inner)
    # boot prints: a sole with a heel and a chevron lug tread, the dust each carries thinning step by step
    prints = np.zeros((n, n), np.float32)
    for pts, load in TRAILS:
        for x, z, a, side, k in trail_steps(pts):
            amt = load * 0.8 ** k
            if amt < 0.08: break
            a += float(urng.normal(0, 0.12)); x += float(urng.normal(0, 1.5)); z += float(urng.normal(0, 1.5))
            def sole(dx, dy, cA=math.cos(a), sA=math.sin(a), side=side, amt=amt):
                ux = dx * px; wz = dy * px
                u_ = ux * cA + wz * sA; w_ = (-ux * sA + wz * cA) * side
                dF = np.hypot((u_ - 5.0) / 9.5, (w_ + 0.6) / 5.6); dH = np.hypot((u_ + 9.0) / 5.6, w_ / 4.6)
                dW = np.maximum(np.abs(u_ + 2.0) / 6.5, np.abs(w_ - 0.8) / 3.6)
                m = 1 - sstep(0.9, 1.0, np.minimum(np.minimum(dF, dH), dW))
                lugs = sstep(-0.1, 0.4, np.cos(2 * math.pi * (u_ + 0.55 * np.abs(w_)) / 2.6))
                return m * (0.35 + 0.65 * lugs) * amt
            stamp(prints, (x + FR) / px, (z + FR) / px, 17.0 / px, sole, wrap=False, mode='max')
    prints *= 0.8 + 0.2 * patchy
    dust = np.clip(np.maximum(dust, prints * 1.15), 0, 1)
    dcol = hx(0x4c4a46)[None, None] * (0.85 + 0.3 * fine)[..., None]
    alb = alb * (1 - 0.85 * dust[..., None]) + dcol * (0.85 * dust[..., None])
    rough = rough * (1 - dust) + 0.93 * dust; metal = metal * (1 - dust); Hh = Hh + 0.08 * prints + 0.05 * dust
    # rubber heel marks where players stand (short soft smudges), polished where they shuffle
    stand = sstep(60, 72, np.abs(Z)) * (1 - sstep(96, 120, np.abs(Z))) * (np.abs(X) < 82)
    scr = np.zeros((n, n), np.float32)
    for _ in range(int(260 * TS + 60)):
        x = urng.uniform(-80, 80); z = urng.choice((-1, 1)) * urng.uniform(62, 110); a = urng.uniform(0, math.pi); l = urng.uniform(1.5, 5)
        seg_aa(scr, ((x + FR) / px, (z + FR) / px), ((x + l * math.cos(a) + FR) / px, (z + l * math.sin(a) + FR) / px), 0.9 / px, urng.uniform(0.15, 0.4))
    scr = R.gblur(scr, 1.2, False)
    alb = alb * (1 - 0.45 * scr[..., None]); rough = rough + 0.1 * scr - 0.12 * stand * (1 - dust)
    # soft occlusion under the table and at each foot (the sun draws the table's real shadow; the bake does the walls and props)
    def soft(tt, a, w): return 1 - sstep(a - w, a + w, tt)
    ao = 0.25 * soft(np.abs(X), 63, 14) * soft(np.abs(Z), 37, 14)
    for lx_, lz_ in LEGS: ao += 0.4 * np.exp(-((X - lx_) ** 2 + (Z - lz_) ** 2) / (2 * 2.5 ** 2))
    alb *= (1 - np.clip(ao, 0, 0.7))[..., None]
    orm = np.stack([np.ones((n, n)), np.clip(rough, 0.06, 1), np.clip(metal, 0, 1)], -1)
    return np.clip(alb, 0, 1), height_to_normal(Hh, px, px, 1.2), orm

def wall_texture(W, H):
    """One repeat of the ring's inner face: U = TILE_U, V = WALL_Y0..WALL_TOP, row 0 = the top. Painted panels with screwed seams and a
    groove, a Federation-blue band, chips to primer and steel near the seams and low down, boot scuffs, regolith dust settled low. -> albedo, normal, ORM"""
    WH = WALL_TOP - WALL_Y0
    xx = ((np.arange(W) + .5) / W * TILE_U)[None, :] * np.ones((H, 1))
    yy = (WALL_TOP - (np.arange(H) + .5) / H * WH)[:, None] * np.ones((1, W))
    pxu, pxv = TILE_U / W, WH / H
    PW = TILE_U / 2.0; JT = -36.0
    dv = np.abs(((xx + PW / 2) % PW) - PW / 2); dh = np.abs(yy - JT)
    dmin = np.minimum(dv, dh)
    pid = np.floor(xx / PW).astype(int) * 7 + (yy > JT) * 3
    ph = ((pid * 2654435761) % 1000) / 1000.0
    mott = tfbm(H, W, 3, 12, SEED + 21, 5)
    alb = hx(0x5c646d)[None, None] * (0.94 + 0.1 * ph)[..., None] * (0.9 + 0.2 * mott)[..., None]
    band = (yy > -34.6) & (yy < -32.4)
    alb = np.where(band[..., None], hx(0x1d4f73)[None, None] * (0.9 + 0.2 * mott)[..., None], alb)
    seam = np.exp(-(dmin / 0.22) ** 2)
    Hh = -0.5 * seam + 0.9 * (tfbm(H, W, 3, 12, SEED + 22, 3) - 0.5) * sstep(0.4, 3.0, dmin) + 0.05 * band
    alb *= (1 - 0.5 * seam)[..., None]
    def screw(cx, cy, rr=0.55):
        ix, iy = int(cx / pxu), int((WALL_TOP - cy) / pxv); wr = int(rr / pxu) + 2
        ya, yb, xa, xb = max(0, iy - wr), min(H, iy + wr + 1), max(0, ix - wr), min(W, ix + wr + 1)
        if yb <= ya or xb <= xa: return
        d2 = ((xx[ya:yb, xa:xb] - cx) ** 2 + (yy[ya:yb, xa:xb] - cy) ** 2) / (rr * rr)
        Hh[ya:yb, xa:xb] += 0.35 * np.sqrt(np.clip(1 - d2, 0, 1)); alb[ya:yb, xa:xb] *= (1 - 0.25 * np.clip(1 - d2 * 0.5, 0, 1))[..., None]
    for k in range(2):
        for sx in (k * PW + 1.6, k * PW + PW - 1.6):
            for yv in (-45.0, -40.0, JT - 1.6, JT + 1.6, -31.0, -27.4): screw(sx % TILE_U, yv)
    score = tfbm(H, W, 6, 30, SEED + 23, 5) + 0.24 * np.exp(-dmin / 1.0) + 0.22 * np.exp(-np.maximum(yy - FY, 0) / 4.0) - 0.88
    chip = sstep(0.0, 0.04, score); prim = sstep(-0.03, 0.0, score) * (1 - chip)
    alb = alb * (1 - prim[..., None] * 0.4) + hx(0x4e4a46) * (0.4 * prim[..., None])
    alb = alb * (1 - chip[..., None]) + hx(0x6a6f74) * chip[..., None]; Hh -= 0.3 * chip
    scr = np.zeros((H, W))
    for _ in range(int(160 * TS + 40)):
        x = urng.uniform(0, W); y = H - urng.uniform(0, H * 0.45); a = urng.normal(0, 0.3); l = urng.uniform(6, 30) / pxu * 0.3
        seg_aa(scr, (x, y), (x + l * math.cos(a), y + l * math.sin(a)), 1.0, urng.uniform(0.2, 0.6))
    alb = alb * (1 - 0.35 * scr[..., None])
    dust = np.clip(np.exp(-np.maximum(yy - FY, 0) / 5.0) * (0.5 + 0.5 * sstep(0.3, 0.7, tfbm(H, W, 4, 16, SEED + 24, 4))) + 0.5 * seam * np.exp(-np.maximum(yy - FY, 0) / 9.0), 0, 0.85)
    alb = alb * (1 - dust[..., None]) + hx(0x5a5853) * dust[..., None]
    grime = tfbm(H, W, 4, 10, SEED + 25, 4)
    alb *= (0.86 + 0.24 * grime)[..., None]
    rough = 0.42 + 0.08 * (tfbm(H, W, 10, 40, SEED + 26, 3) - 0.5) + 0.2 * sstep(0.55, 0.85, grime) + 0.15 * scr + 0.25 * prim + 0.25 * seam
    rough = np.where(band, rough - 0.06, rough); rough = rough * (1 - dust) + 0.92 * dust; rough = np.where(chip > 0.5, 0.38, rough)
    metal = chip * (1 - dust)
    orm = np.stack([np.ones((H, W)), np.clip(rough, 0.06, 1), np.clip(metal, 0, 1)], -1)
    return np.clip(alb, 0, 1), height_to_normal(Hh, pxu, pxv, 1.0, wrap_x=True), orm

def glass_texture(W, H):
    """One repeat of the dome's dust film: U = 1/GLASS_REP of the way round, V = the dome's height (row 0 = the apex). Regolith settles
    thickest low down, runs and smears above it, a few gloved wipes at arm's height. -> rgb, alpha"""
    GW = 2 * math.pi * DOME_R / GLASS_REP
    u = (np.arange(W) + .5) / W; v = 1 - (np.arange(H) + .5) / H
    U, V = np.meshgrid(u, v); h = V * DOME_R; xc = U * GW
    film = np.exp(-h / 26.0) * (0.55 + 0.45 * tfbm(H, W, 6, 10, SEED + 31, 5)) + 0.3 * np.exp(-h / 90.0) * tfbm(H, W, 4, 6, SEED + 32, 4)
    runs = sstep(0.62, 0.85, tfbm(H, W, 2, 40, SEED + 33, 4, 0.6)) * np.exp(-h / 70.0) * 0.35
    smear = sstep(0.5, 0.8, tfbm(H, W, 3, 5, SEED + 34, 4)) * (0.18 + 0.12 * tfbm(H, W, 12, 20, SEED + 36, 3))     # dust smeared over the panes at every height
    wipe = np.zeros((H, W))
    g = np.random.default_rng(SEED + 35)
    for _ in range(4):                                                  # a glove's sweep: an arc under the elbow, a hand wide
        wx, wh, rr = g.uniform(0.15, 0.85) * GW, g.uniform(30, 60), g.uniform(18, 30)
        d = np.hypot(xc - wx, h - wh); ang = np.arctan2(h - wh, xc - wx)
        wipe = np.maximum(wipe, ((ang > -2.4) & (ang < -0.7)) * np.exp(-((d - rr) / 5.0) ** 2))
    dust = np.clip(film + runs + smear, 0, 1) * (1 - 0.7 * wipe)
    a = np.clip(0.07 + 0.42 * dust, 0, 0.6)
    tint = np.array([0.045, 0.075, 0.11])
    rgb = tint[None, None] * (1 - dust[..., None]) + np.array([0.56, 0.55, 0.52])[None, None] * dust[..., None]
    return np.clip(rgb, 0, 1), a

# =============================================================================================
# IMAGES AND MATERIALS
# =============================================================================================
print('moon: textures')
RN = max(256, int(1024 * TS))       # ~11 px a cm; the nearest regolith is ~1.8 m from any camera
ra, rn = regolith_textures(RN)
im_ra = new_img('moon_regolith_albedo', RN, RN); np_img(im_ra, ra)
im_rn = new_img('moon_regolith_normal', RN, RN, True); np_img(im_rn, rn)
FN = max(256, int(2048 * TS))
fa, fn_, fo = floor_texture(FN)
im_fa = new_img('moon_floor_albedo', FN, FN); np_img(im_fa, fa)
im_fn = new_img('moon_floor_normal', FN, FN, True); np_img(im_fn, fn_)
im_fo = new_img('moon_floor_orm', FN // 2, FN // 2, True); np_img(im_fo, fo[::2, ::2])
del fa, fn_, fo
WW, WH_ = max(128, int(1024 * TS)), max(64, int(256 * TS))
wa, wn, wo = wall_texture(WW, WH_)
im_wa = new_img('moon_wall_albedo', WW, WH_); np_img(im_wa, wa)
im_wn = new_img('moon_wall_normal', WW, WH_, True); np_img(im_wn, wn)
im_wo = new_img('moon_wall_orm', WW // 2, WH_ // 2, True); np_img(im_wo, wo[::2, ::2])
gcol, galpha = glass_texture(max(128, int(512 * TS)), max(128, int(512 * TS)))
im_gl = new_img('moon_glass', gcol.shape[1], gcol.shape[0], alpha=True); np_img(im_gl, gcol, galpha)

print('moon: surface sets')
SN = max(128, int(512 * TS) // 4 * 4)
def surf_imgs(kind, nrm, orm, alb=None, mean=1.0, albs=None):
    S = {'mean': mean, 'albs': {}, 'alb': None}
    S['n'] = new_img('moon_%s_normal' % kind, nrm.shape[1], nrm.shape[0], True); np_img(S['n'], nrm)
    S['orm'] = new_img('moon_%s_orm' % kind, orm.shape[1], orm.shape[0], True); np_img(S['orm'], orm)
    if alb is not None: S['alb'] = new_img('moon_%s_albedo' % kind, alb.shape[1], alb.shape[0]); np_img(S['alb'], alb)
    for mat, a in (albs or {}).items():
        im = new_img(mat + '_albedo', a.shape[1], a.shape[0]); np_img(im, a); S['albs'][mat] = im
    SURF[kind] = S
for kind, fn in (('steel', R.steel_set), ('plastic', R.plastic_set)):
    a_, m_, n_, o_ = fn(SN, SEED); surf_imgs(kind, n_, o_, a_, m_)
pn_, po_, PM = R.paint_set(SN, SEED)
PAINTED = {'panel': 0x4a5057, 'door': 0x1d4f73, 'tank': 0xb8621f}
surf_imgs('paint', pn_, po_, albs={'moon_' + k: R.paint_albedo(PM, h) for k, h in PAINTED.items()})

MATS = {
    'terrain': tex_mat('moon_terrain', im_ra, im_rn, vcol=True, rough=0.97),
    'floor':   tex_mat('moon_floor', im_fa, im_fn, vcol=True, orm=im_fo),
    'wall':    tex_mat('moon_wall', im_wa, im_wn, vcol=True, orm=im_wo),
    'glass':   tex_mat('moon_glass', im_gl, None, alpha=True, rough=0.06),
}
gb = MATS['glass'].node_tree.nodes['Principled BSDF']                 # the film catches the sun from behind: a little light of its own
MATS['glass'].node_tree.links.new(next(n for n in MATS['glass'].node_tree.nodes if n.type == 'TEX_IMAGE').outputs['Color'], gb.inputs['Emission Color'])
gb.inputs['Emission Strength'].default_value = GLASS_GLOW
FLAT = {   # name: (hex, metal, rough, emissive hex, strength, surface kind); with a kind, metal and rough scale the set's ORM
    'steel':     (0x2b3036, 0.99, 1.2, None, 1, 'steel'),      # the owner's near-mirror steel (metal 0.99, rough 0.30)
    'visor':     (0xb88a3a, 1.0, 0.5, None, 1, 'steel'),
    'panel':     (0x4a5057, 1.0, 1.0, None, 1, 'paint'),
    'door':      (0x1d4f73, 1.0, 0.9, None, 1, 'paint'),
    'tank':      (0xb8621f, 1.0, 0.9, None, 1, 'paint'),
    'suitwhite': (0xd6d8d3, 0.0, 0.55, None, 1, 'plastic'),
    'strip':     (0xdfe8ff, 0.0, 0.4, 0xdfe8ff, 4.0, None),
    'status':    (0xffb454, 0.0, 0.6, 0xffb454, 5.0, None),
}
for k, (h, m, r, e, es, kd) in FLAT.items(): MATS[k] = flat_mat('moon_' + k, h, m, r, e, es, kd)
def flag_mat():
    """The owner's logo render, clamped at its edges; a plain blue flag if the render is gone."""
    m = bpy.data.materials.new('moon_flag'); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.9; b.inputs['Metallic'].default_value = 0.0; m.use_backface_culling = False
    src = next((p for p in FLAG_SRC if os.path.exists(p)), None)
    if src is None:
        print('moon: flag render not found, plain flag'); b.inputs['Base Color'].default_value = srgb(0x123f5e); return m
    im = bpy.data.images.load(src); im.name = 'moon_flag'
    if im.size[0] > 1024:
        im.scale(1024, int(round(1024 * im.size[1] / im.size[0] / 4)) * 4)
        im.filepath_raw = os.path.join(BUILD, 'moon_flag.png'); im.file_format = 'PNG'; im.save()
    tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = im; tx.extension = 'EXTEND'
    nt.links.new(tx.outputs['Color'], b.inputs['Base Color']); IMGS.append(im)
    return m
MATS['flag'] = flag_mat()

# =============================================================================================
# GEOMETRY: re-dress the owner's meshes, cut the floor and wall finer
# =============================================================================================
def newell(pts):
    n = Vector((0, 0, 0))
    for k in range(len(pts)):
        a, b = pts[k], pts[(k + 1) % len(pts)]
        n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
    return n
def make_mesh(name, V, F, mat, uv=None, colors=None):
    """V in Blender coords, F faces; uv / colors per corner in face order."""
    me = bpy.data.meshes.new(name); me.from_pydata([tuple(v) for v in V], [], [tuple(f) for f in F]); me.update()
    me.polygons.foreach_set('use_smooth', [False] * len(F))
    if uv is not None:
        lay = me.uv_layers.new(name='UVMap'); lay.data.foreach_set('uv', np.asarray(uv, np.float32).ravel())
    if colors is not None:
        ca_ = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER'); ca_.data.foreach_set('color', np.asarray(colors, np.float32).ravel())
    o = bpy.data.objects.new(name, me); o.data.materials.append(mat)
    return link(o)
def components(me):
    """Loose parts as lists of polygon indices."""
    par = list(range(len(me.vertices)))
    def find(a):
        while par[a] != a: par[a] = par[par[a]]; a = par[a]
        return a
    for p in me.polygons:
        r0 = find(p.vertices[0])
        for v in p.vertices[1:]:
            r = find(v)
            if r != r0: par[r] = r0
    out = {}
    for p in me.polygons: out.setdefault(find(p.vertices[0]), []).append(p.index)
    return list(out.values())
def part_frame(me, polys):
    """A loose part's centre, radius and frame: upright, turned to square up with its side faces (a box's yaw; a cylinder any)."""
    pts = [me.vertices[v].co for i in polys for v in me.polygons[i].vertices]
    c = sum(pts, Vector()) / len(pts); rad = max((p - c).length for p in pts)
    s4 = c4 = 0.0
    for i in polys:
        p = me.polygons[i]
        if abs(p.normal.z) < 0.5: ph = math.atan2(p.normal.y, p.normal.x); s4 += p.area * math.sin(4 * ph); c4 += p.area * math.cos(4 * ph)
    return c, rad, Matrix.Translation(c) @ Matrix.Rotation(0.25 * math.atan2(s4, c4), 4, 'Z')
def set_layers(me, uv, cols=None):
    if not me.uv_layers.get('UVMap'): me.uv_layers.new(name='UVMap')
    me.uv_layers.active = me.uv_layers['UVMap']; me.uv_layers['UVMap'].data.foreach_set('uv', np.asarray(uv, np.float32).ravel())
    if cols is not None:
        for a in list(me.color_attributes): me.color_attributes.remove(a)
        me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER').data.foreach_set('color', np.asarray(cols, np.float32).ravel())
def drop_faces(o, keep):
    """Delete the faces keep() rejects and any vertex left with no face."""
    bm = bmesh.new(); bm.from_mesh(o.data); bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep(f)], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(o.data); bm.free()
def prop_attrs(o, tile):
    """Surface-set UVs per loose part: struts and rings along their length, everything else along the dominant axis in the part's own
    frame, offset per part; a baked colour for floor contact and undersides."""
    me = o.data; uv = np.zeros((len(me.loops), 2), np.float32); cols = np.ones((len(me.loops), 4), np.float32)
    for polys in components(me):
        c, rad, fr = part_frame(me, polys); inv = fr.inverted(); R3 = inv.to_3x3(); off = urng.uniform(0, 64, 2)
        for i in polys:
            p = me.polygons[i]
            if rad > 60:
                es = [(me.vertices[p.vertices[k]].co, me.vertices[p.vertices[(k + 1) % len(p.vertices)]].co) for k in range(len(p.vertices))]
                a, b = max(es, key=lambda e: (e[1] - e[0]).length); e = (b - a).normalized(); bv = p.normal.cross(e)
            else: ax = max(range(3), key=lambda k: abs((R3 @ p.normal)[k]))
            for li, vi in zip(p.loop_indices, p.vertices):
                co = me.vertices[vi].co
                if rad > 60: u, v = co.dot(e), co.dot(bv)
                else: q = inv @ co; u, v = ((q.z, q.y), (q.z, q.x), (q.x, q.y))[ax]
                uv[li] = ((u + off[0]) / tile, (v + off[1]) / tile)
                h = max(0.0, co.z - FY); k = (1 - 0.35 * math.exp(-h / 3.0)) * (1 - 0.25 * max(0.0, -p.normal.z))
                cols[li, :3] = (k, k * 0.985, k * 0.96)
    set_layers(me, uv, cols)

print('moon: re-dressing the owner\'s meshes')
for o in SRC.get('moon_floor', []): bpy.data.objects.remove(o, do_unlink=True)
for o in SRC.get('moon_panel', []):                   # the wall ring is rebuilt below; the airlock tunnel stays
    me = o.data; ring = {i for polys in components(me) if part_frame(me, polys)[1] > 150 for i in polys}
    drop_faces(o, lambda f: f.index not in ring)
for o in SRC.get('moon_steel', []):                   # even offset threw two frame vertices ~8 km out at the bisected rim's sharpest corners
    bad = [v.index for v in o.data.vertices if (v.co - DOME_C).length > 5000]
    if bad: print('moon: %d runaway vertices dropped from %s' % (len(bad), o.name)); drop_faces(o, lambda f: not any(v.index in bad for v in f.verts))
for o in SRC.get('moon_strip', []): drop_faces(o, lambda f: True)
ROLE = {'moon_steel': 'steel', 'moon_visor': 'visor', 'moon_panel': 'panel', 'moon_door': 'door', 'moon_tank': 'tank', 'moon_suitwhite': 'suitwhite',
        'moon_strip': 'strip', 'moon_status': 'status', 'moon_flag': 'flag', 'moon_glass': 'glass', 'moon_terrain': 'terrain', 'moon_boulder': 'terrain'}
for src_name, objs in SRC.items():
    if src_name not in ROLE: continue
    for o in objs:
        o.data.materials.clear(); o.data.materials.append(MATS[ROLE[src_name]])
        mn = 'moon_' + ROLE[src_name]
        if mn in KIND: prop_attrs(o, R.SURF_TILE[KIND[mn]])

# terrain: the regolith's own repeat, tone at ~25 and ~70 cm so it never lines up
for o in SRC.get('moon_terrain', []):
    me = o.data
    if sum(p.normal.z * p.area for p in me.polygons) < 0: me.flip_normals(); me.update(); print('moon: terrain turned face up')
    uv = np.zeros((len(me.loops), 2), np.float32); cols = np.zeros(len(me.loops) * 4, np.float32)
    me.color_attributes['Col'].data.foreach_get('color', cols); cols = cols.reshape(-1, 4)
    for p in me.polygons:
        for li, vi in zip(p.loop_indices, p.vertices):
            co = me.vertices[vi].co; uv[li] = (co.x / TILE, co.y / TILE)
            k = 1 + 0.1 * (0.6 * noise.fractal(Vector((co.x / 26, co.y / 26, 3)) + NOFF, 0.7, 2.0, 3) + 0.4 * noise.fractal(Vector((co.x / 70, co.y / 70, 4)) + NOFF, 0.7, 2.0, 2))
            cols[li, :3] = np.clip(cols[li, :3] * k, 0, 1)
    set_layers(me, uv, cols)
TKD = kdtree.KDTree(sum(len(o.data.vertices) for o in SRC.get('moon_terrain', [])))
for o in SRC.get('moon_terrain', []):
    for v in o.data.vertices: TKD.insert(Vector((v.co.x, v.co.y, 0)), 0)
TKD.balance(); TZ = {}
for o in SRC.get('moon_terrain', []):
    for v in o.data.vertices: TZ[(round(v.co.x, 2), round(v.co.y, 2))] = v.co.z
# boulders: the regolith, darker, at a smaller repeat; one tone a rock
float_n = 0
for o in SRC.get('moon_boulder', []):
    me = o.data; uv = np.zeros((len(me.loops), 2), np.float32); cols = np.ones((len(me.loops), 4), np.float32)
    for polys in components(me):
        tone = float(urng.uniform(0.5, 0.66)); low = min(me.vertices[v].co.z for i in polys for v in me.polygons[i].vertices)
        c = part_frame(me, polys)[0]; nv = TKD.find(Vector((c.x, c.y, 0)))[0]
        if low - TZ.get((round(nv.x, 2), round(nv.y, 2)), low) > 1.5: float_n += 1
        for i in polys:
            p = me.polygons[i]; ax = max(range(3), key=lambda k: abs(p.normal[k]))
            for li, vi in zip(p.loop_indices, p.vertices):
                co = me.vertices[vi].co; q = ((co.y, co.z), (co.x, co.z), (co.x, co.y))[ax]
                uv[li] = (q[0] / (TILE * 0.4), q[1] / (TILE * 0.4)); k = tone * (0.8 + 0.2 * max(0.0, p.normal.z)); cols[li, :3] = (k, k * 0.98, k * 0.95)
    set_layers(me, uv, cols)
if float_n: print('moon: %d boulders sit over 1.5 cm above the flattened terrain' % float_n)
# glass: the dust film round the dome and up it; the door's little window takes a dusty corner of it
for o in SRC.get('moon_glass', []):
    me = o.data; uv = np.zeros((len(me.loops), 2), np.float32)
    for polys in components(me):
        big = part_frame(me, polys)[1] > 100
        for i in polys:
            p = me.polygons[i]; c = p.center; ac = math.atan2(c.y, c.x)
            for li, vi in zip(p.loop_indices, p.vertices):
                co = me.vertices[vi].co; a = math.atan2(co.y, co.x); a = ac + (a - ac + math.pi) % (2 * math.pi) - math.pi
                uv[li] = (a / (2 * math.pi) * GLASS_REP, (co.z - DOME_C.z) / DOME_R) if big else (0.3, 0.12)
    set_layers(me, uv)
for o in SRC.get('moon_flag', []):
    if not o.data.uv_layers.get('UVMap'): print('moon: the flag has no UVMap')

# floor: a polar grid over the same disc
FLOOR_R = WALL_R + 2
NRING, NSEG = 24, 96
V = [g2b(0, FY, 0)]; F = []
for k in range(1, NRING + 1):
    rr = FLOOR_R * k / NRING
    V.extend(g2b(rr * math.cos(2 * math.pi * j / NSEG), FY, rr * math.sin(2 * math.pi * j / NSEG)) for j in range(NSEG))
def fv(k, j): return 0 if k == 0 else 1 + (k - 1) * NSEG + j % NSEG
for j in range(NSEG): F.append((0, fv(1, j), fv(1, j + 1)))
for k in range(1, NRING):
    for j in range(NSEG): F.append((fv(k, j), fv(k + 1, j), fv(k + 1, j + 1), fv(k, j + 1)))
F = [f if newell([V[i] for i in f]).z > 0 else f[::-1] for f in F]
UV = [((V[i].x + FR) / (2 * FR), (V[i].y + FR) / (2 * FR)) for f in F for i in f]
make_mesh('room_moon_floor', V, F, MATS['floor'], UV, [(1, 1, 1, 1)] * len(UV))

# wall: the same ring, its inner face in rows for the bake, the map wrapped WALL_REP times round it
def wall_ring(r0, r1, y0, y1, seg=96, gap=(AIRLOCK, DOOR_HALF), rows=(FY, -39.3, -35.0, -30.0)):
    ys = [y0] + [y for y in rows if y0 < y < y1] + [y1]; V, F, UV = [], [], []
    def quad(ps, uvs, want):
        o = len(V); V.extend(g2b(*p) for p in ps); f = list(range(o, o + 4)); u = list(uvs)
        if newell([V[i] for i in f]).dot(g2b(*want)) < 0: f = f[::-1]; u = u[::-1]
        F.append(tuple(f)); UV.extend(u)
    th = (r1 - r0) / TILE_U
    for i in range(seg):
        ta, tb = i / seg * 2 * math.pi, (i + 1) / seg * 2 * math.pi; tm = (ta + tb) / 2
        if abs((tm - gap[0] + math.pi) % (2 * math.pi) - math.pi) < gap[1]: continue
        A = lambda r, y: (r * math.cos(ta), y, r * math.sin(ta)); B = lambda r, y: (r * math.cos(tb), y, r * math.sin(tb))
        ua, ub = i / seg * WALL_REP, (i + 1) / seg * WALL_REP; sv = lambda y: (y - y0) / (y1 - y0)
        for ya, yb in zip(ys[:-1], ys[1:]):
            quad([A(r0, ya), B(r0, ya), B(r0, yb), A(r0, yb)], [(ua, sv(ya)), (ub, sv(ya)), (ub, sv(yb)), (ua, sv(yb))], (-math.cos(tm), 0, -math.sin(tm)))
        quad([A(r0, y1), B(r0, y1), B(r1, y1), A(r1, y1)], [(ua, 0), (ub, 0), (ub, th), (ua, th)], (0, 1, 0))
        quad([A(r1, y0), B(r1, y0), B(r1, y1), A(r1, y1)], [(ua, 0), (ub, 0), (ub, 0.05), (ua, 0.05)], (math.cos(tm), 0, math.sin(tm)))
        quad([A(r0, y0), B(r0, y0), B(r1, y0), A(r1, y0)], [(ua, 0), (ub, 0), (ub, th), (ua, th)], (0, -1, 0))
    return make_mesh('room_moon_wall', V, F, MATS['wall'], UV, [(1, 1, 1, 1)] * len(UV))
wall_ring(WALL_R, WALL_R + 5, WALL_Y0, WALL_TOP)

# =============================================================================================
# THE LIGHT BAKE, one mesh per material, export
# =============================================================================================
LAMPS = []     # (game xyz, colour hex, strength): the room's own lamps for the bake (strength = brightness x cm^2 at the lamp)
for i in range(72):                                    # the light strip round the wall
    t = (i + 0.5) / 72 * 2 * math.pi
    if abs((t - AIRLOCK + math.pi) % (2 * math.pi) - math.pi) < DOOR_HALF * 1.6: continue
    LAMPS.append((((WALL_R - 1.6) * math.cos(t), WALL_TOP - 2.7, (WALL_R - 1.6) * math.sin(t)), 0xdfe8ff, 55))
LAMPS.append((at(WALL_R - 3.0, FY + 46.5, 0), 0xffb454, 260))     # the airlock's status lamp

print('moon: light bake')
BAKE = dict(rays=24, reach=26.0, ao=0.7, amb=0.8, soft=14.0)     # AO rays and reach (cm), how dark full occlusion gets, light far from every lamp, lamp core (cm)
bpy.context.view_layer.update()
mat_of = lambda o: o.data.materials[0].name
opaque = [o for o in col.objects if mat_of(o) not in {'moon_strip', 'moon_status', 'moon_glass', 'moon_flag'}]
R.bake_light(opaque, [o for o in opaque if mat_of(o) != 'moon_terrain'], [(g2b(*p), R.lamp_tint(h), s) for p, h, s in LAMPS], seed=SEED, tag='moon', **BAKE)
R.bake_light(opaque, [o for o in opaque if mat_of(o) == 'moon_terrain'], [], seed=SEED, tag='moon terrain', rays=16, reach=40.0, ao=0.45, amb=1.0)
print('moon: %d lamps' % len(LAMPS))

by_mat = {}
for o in list(col.objects): by_mat.setdefault(mat_of(o), []).append(o)
for name, objs in by_mat.items():
    if len(objs) > 1: set_active(*objs); bpy.ops.object.join()
for o in col.objects: o.name = mat_of(o).replace('moon_', 'room_moon_')
for o in list(bpy.data.objects):
    if o.name not in col.objects: bpy.data.objects.remove(o, do_unlink=True)
bpy.data.orphans_purge(do_recursive=True)
tris = 0
for o in col.objects:
    o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles); print('   %-24s %6d tris' % (o.name, len(o.data.loop_triangles)))
print('moon: %d meshes, %d tris' % (len(col.objects), tris))
for im in IMGS: im.pack()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BUILD, 'moon_room.blend'))
set_active(*col.objects)
kw = dict(filepath=GLB, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_lights=False, export_cameras=False)
try: bpy.ops.export_scene.gltf(export_vertex_color='ACTIVE', **kw)
except TypeError: bpy.ops.export_scene.gltf(**kw)
R.glb_factors(GLB, FACT)
print('moon: wrote', GLB, '%.1f MB' % (os.path.getsize(GLB) / 1048576))
