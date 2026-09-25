"""
build_void_asteroid.py  --  Fuzeball VOID room: the table bolted to a rock in open space -> GLB

Run headless from the project root (needs a GPU for the bakes, falls back to CPU):

    blender -b -P tools/build_void_asteroid.py -- [--tex 2048] [--seed 3] [--samples 64]

then compress the textures (sRGB colour -> ETC1S, normal/ORM -> UASTC):

    node tools/ktx2-encode.mjs assets/rooms/void/fuzeball_room_void.glb

WHAT IT MAKES
    assets/rooms/void/fuzeball_room_void.glb     the room (CONFIG.rooms.open)
    tools/build/void/void_asteroid.blend         the scene, for hand edits (gitignored)
    tools/build/void/*.png                       the baked / generated texture masters

THE STORY (DIRECTION.md section 2: small scruffy venues, the Federation plays anywhere)
    Somebody quarried the top off a rock, laid a steel deck on it, bolted the table down so it
    can't drift, clamped two work lamps to the deck and ran them off a generator. The deck is
    painted: a Federation-blue border and a white box marking where the table goes.

WHAT IS IN IT (every piece is static; one mesh per material, 8 draw calls)
    rock      high-poly displaced rock baked down to ~7k tris: albedo(+AO) and normal maps
    deck      steel tread plate, 200 x 132, top at y=-44 (the table's feet). Textures are generated
              in numpy in WORLD units: tread, plate seams, bolts, paint, wear, rust, and a soft
              CONTACT SHADOW under the table and its legs (no light in Void casts one)
    props     leg brackets, two lamp posts (emissive lenses, NO lights), generator, cables, crates
    debris    a few far chunks for parallax and scale

NO LIGHTS ARE EXPORTED. The room is lit by CONFIG.rooms.open.lights (pooled), so entering Void
never changes the scene's light count (r128 would recompile every shader).

COORDINATES: authored in GAME units (X long axis, Y up, Z width) and converted with g2b, the same
Y-up -> Z-up mapping as the other builders, so the exporter's +Y up round-trips.
"""
import bpy, bmesh, os, sys, math
import numpy as np
from mathutils import Vector, Matrix, noise

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(n, d):
    return type(d)(argv[argv.index(n) + 1]) if n in argv else d
TEX     = arg('--tex', 2048)
SEED    = arg('--seed', 3)
SAMPLES = arg('--samples', 64)

ROOT  = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT   = os.path.join(ROOT, 'assets', 'rooms', 'void')
BUILD = os.path.join(ROOT, 'tools', 'build', 'void')
os.makedirs(OUT, exist_ok=True); os.makedirs(BUILD, exist_ok=True)
GLB = os.path.join(OUT, 'fuzeball_room_void.glb')
rng = np.random.default_rng(SEED)

# ---- the numbers that matter (game units) ------------------------------------------------------
FY      = -44.0                 # table feet = deck top
DECK_X, DECK_Z, DECK_T = 100.0, 66.0, 8.0          # deck half-extents, thickness
LEGS    = [(sx * 58, sz * 32) for sx in (-1, 1) for sz in (-1, 1)]
TABLE_X, TABLE_Z = 63.0, 37.0                      # the table body, for the contact shadow
ROCK_C  = -105.0                # rock centre height
ROCK_R  = (200.0, 90.0, 145.0)  # ellipsoid radii x, y(up), z before displacement
ROCK_TRIS = 7000

def g2b(x, y, z): return Vector((x, -z, y))

# ---- scene -------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for dt in ('OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI'):
        try:
            prefs.compute_device_type = dt; prefs.get_devices()
            if any(d.type == dt for d in prefs.devices):
                for d in prefs.devices: d.use = (d.type == dt)
                scene.cycles.device = 'GPU'; print('void: baking on', dt); break
        except TypeError: pass
except Exception as e: print('void: GPU setup failed, CPU bake', e)
scene.cycles.samples = SAMPLES
col = bpy.data.collections.new('Void Room'); scene.collection.children.link(col)
work = bpy.data.collections.new('work (not exported)'); scene.collection.children.link(work)

def link(obj, c=None): (c or col).objects.link(obj); return obj
def set_active(*objs):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[-1]

# ---- materials ---------------------------------------------------------------------------------
def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)
def flat_mat(name, hexc, metal=0.0, rough=0.6, emit=None, emit_str=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = srgb(hexc)
    b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
    if emit is not None:
        b.inputs['Emission Color'].default_value = srgb(emit); b.inputs['Emission Strength'].default_value = emit_str
    m.diffuse_color = srgb(hexc)
    return m
def tex_mat(name, albedo, normal, orm=None, metal=0.0, rough=0.9):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    a = nt.nodes.new('ShaderNodeTexImage'); a.image = albedo; nt.links.new(a.outputs['Color'], b.inputs['Base Color'])
    n = nt.nodes.new('ShaderNodeTexImage'); n.image = normal
    nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(n.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    if orm is not None:
        o = nt.nodes.new('ShaderNodeTexImage'); o.image = orm
        sp = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(o.outputs['Color'], sp.inputs['Color'])
        nt.links.new(sp.outputs['Green'], b.inputs['Roughness']); nt.links.new(sp.outputs['Blue'], b.inputs['Metallic'])
    else:
        b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
    return m, a, n

def new_img(name, size, data=False):
    im = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    im.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    return im
def img_np(im):
    a = np.empty(im.size[0] * im.size[1] * 4, np.float32); im.pixels.foreach_get(a)
    return a.reshape(im.size[1], im.size[0], 4)          # row 0 = bottom (v = 0)
def np_img(im, arr):
    h, w = arr.shape[:2]; rgba = np.ones((h, w, 4), np.float32); rgba[..., :arr.shape[2]] = arr
    im.pixels.foreach_set(rgba.ravel()); im.update()
def save(im):
    im.filepath_raw = os.path.join(BUILD, im.name + '.png'); im.file_format = 'PNG'; im.save()

# ---- mesh helpers ------------------------------------------------------------------------------
def mesh_obj(name, bm, mat, c=None, smooth=False):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = smooth
    o = bpy.data.objects.new(name, me); o.data.materials.append(mat)
    return link(o, c)
def box(name, mat, cx, cy, cz, sx, sy, sz, rot=None):
    """A game-space box: centre (cx,cy,cz), full sizes (sx,sy,sz), optional yaw in radians."""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sz, sy), verts=bm.verts)
    if rot: bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot, 3, 'Z'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=g2b(cx, cy, cz), verts=bm.verts)
    return mesh_obj(name, bm, mat)
def cyl(name, mat, a, b, r, seg=12):
    """Cylinder between two GAME points."""
    A, B = g2b(*a), g2b(*b); d = B - A
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length)
    q = d.normalized().to_track_quat('Z', 'Y')
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=q.to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(A + B) / 2, verts=bm.verts)
    return mesh_obj(name, bm, mat, smooth=True)
def cable(name, mat, pts, r=0.35):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = r; cu.bevel_resolution = 2
    sp = cu.splines.new('BEZIER'); sp.bezier_points.add(len(pts) - 1)
    for p, g in zip(sp.bezier_points, pts):
        p.co = g2b(*g); p.handle_left_type = p.handle_right_type = 'AUTO'
    o = link(bpy.data.objects.new(name, cu)); o.data.materials.append(mat)
    set_active(o); bpy.ops.object.convert(target='MESH')
    return bpy.context.view_layer.objects.active

# =============================================================================================
# 1. ROCK
# =============================================================================================
def rock_highpoly():
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=7, radius=1.0)
    V = np.array([v.co[:] for v in bm.verts])                 # Blender space unit sphere
    d = V / np.linalg.norm(V, axis=1, keepdims=True)
    gx, gy, gz = d[:, 0], d[:, 2], -d[:, 1]                   # to game axes
    off = Vector(rng.uniform(-40, 40, 3))
    big  = np.array([noise.fractal(Vector(p) * 1.4 + off, 0.9, 2.0, 5) for p in d])
    fine = np.array([noise.fractal(Vector(p) * 6.0 + off * 2, 0.7, 2.1, 4) for p in d])
    ridg = np.array([noise.ridged_multi_fractal(Vector(p) * 3.2 - off, 0.9, 2.0, 5, 1.0, 2.0) for p in d])
    r = 1 + 0.16 * big + 0.035 * fine - 0.025 * ridg
    # craters: a handful of dents with raised rims, on the sides and underneath
    for _ in range(28):
        c = rng.normal(size=3); c /= np.linalg.norm(c)
        if c[2] > 0.55: continue                               # not on top: the deck lives there
        rad = rng.uniform(0.08, 0.28); depth = rng.uniform(0.03, 0.09)
        ang = np.arccos(np.clip(d @ c, -1, 1)) / rad
        r += np.where(ang < 1, -depth * (1 - ang ** 2), 0) + np.where((ang >= 1) & (ang < 1.6), depth * 0.35 * np.sin((ang - 1) / 0.6 * math.pi), 0)
    x = gx * ROCK_R[0] * r; z = gz * ROCK_R[2] * r
    y = gy * ROCK_R[1] * r
    below = y < 0                                              # a keel: narrower and deeper underneath
    k = np.clip(-y / ROCK_R[1], 0, 1)
    x = np.where(below, x * (1 - 0.38 * k), x); z = np.where(below, z * (1 - 0.30 * k), z)
    y = np.where(below, y * 1.45, y) + ROCK_C
    # the quarried top: flat under the deck, falling away gently outside it
    ox = np.maximum(np.abs(x) - DECK_X, 0); oz = np.maximum(np.abs(z) - DECK_Z, 0)
    dout = np.sqrt(ox ** 2 + oz ** 2)
    top = FY - DECK_T * 0.45 - 0.14 * dout - 1.4 * (fine * 0.5 + 0.5)
    y = np.minimum(y, top)
    for v, p in zip(bm.verts, np.stack([x, -z, y], 1)): v.co = p
    return bm

rock_mat_hi = bpy.data.materials.new('rock_hi'); rock_mat_hi.use_nodes = True
def build_rock_shader(m):
    nt = m.node_tree; N = nt.nodes; L = nt.links; b = N['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.92
    tc = N.new('ShaderNodeTexCoord'); geo = N.new('ShaderNodeNewGeometry')
    def noise_t(scale, detail, rough=0.55, distort=0.0):
        n = N.new('ShaderNodeTexNoise'); L.new(tc.outputs['Object'], n.inputs['Vector'])
        n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough; n.inputs['Distortion'].default_value = distort
        return n.outputs['Fac']
    def ramp(fac, stops):
        r = N.new('ShaderNodeValToRGB'); el = r.color_ramp.elements
        el[0].position, el[0].color = stops[0][0], srgb(stops[0][1])
        el[1].position, el[1].color = stops[1][0], srgb(stops[1][1])
        for p, h in stops[2:]:
            e = el.new(p); e.color = srgb(h)
        L.new(fac, r.inputs['Fac']); return r.outputs['Color']
    def mixc(fac, a, b_):
        mx = N.new('ShaderNodeMix'); mx.data_type = 'RGBA'
        L.new(fac, mx.inputs['Factor'])
        ins = [i for i in mx.inputs if i.type == 'RGBA']; L.new(a, ins[0]); L.new(b_, ins[1])
        return [o for o in mx.outputs if o.type == 'RGBA'][0]
    def mapr(v, a, b_):
        mr = N.new('ShaderNodeMapRange'); L.new(v, mr.inputs['Value'])
        mr.inputs['From Min'].default_value = a; mr.inputs['From Max'].default_value = b_
        return mr.outputs['Result']
    base = ramp(noise_t(0.018, 6), [(0.3, 0x24221f), (0.5, 0x3a3733), (0.7, 0x4c4843)])
    grain = ramp(noise_t(0.6, 3), [(0.35, 0x2e2b28), (0.65, 0x55514b)])
    c = mixc(mapr(noise_t(0.6, 3), 0.0, 3.0), base, grain)
    streak = mapr(noise_t(0.05, 8, 0.6, 3.5), 0.62, 0.7)
    c = mixc(streak, c, ramp(noise_t(0.3, 2), [(0.3, 0x3d2a1c), (0.7, 0x5e3b22)]))   # copper mineral veins
    sep = N.new('ShaderNodeSeparateXYZ'); L.new(geo.outputs['Normal'], sep.inputs['Vector'])
    c = mixc(mapr(sep.outputs['Z'], 0.55, 0.95), c, ramp(noise_t(0.2, 4), [(0.3, 0x5a5650), (0.7, 0x77726a)]))  # dust on up-facing
    c = mixc(mapr(geo.outputs['Pointiness'], 0.5, 0.56), c, ramp(noise_t(0.4, 2), [(0.3, 0x4f4b45), (0.7, 0x6a655d)]))  # worn edges
    L.new(c, b.inputs['Base Color'])
build_rock_shader(rock_mat_hi)

print('void: rock high-poly'); hi = mesh_obj('rock_hi', rock_highpoly(), rock_mat_hi, work, smooth=True)
lo = hi.copy(); lo.data = hi.data.copy(); lo.name = 'rock'; link(lo)
dec = lo.modifiers.new('dec', 'DECIMATE'); dec.ratio = ROCK_TRIS / len(hi.data.polygons)
set_active(lo); bpy.ops.object.modifier_apply(modifier='dec')
print('void: rock low-poly', len(lo.data.polygons), 'tris')
def rock_uv(obj):
    """Cube-sphere projection from the rock's centre: six contiguous islands in a 3 x 2 grid, seams
    only along the cube's edges. Smart UV on a decimated rock shatters into hundreds of slivers."""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    uvl = bm.loops.layers.uv.verify()
    def dirn(co):                                              # Blender co -> ellipsoid-normalised game dir
        return np.array([co.x / ROCK_R[0], (co.z - ROCK_C) / ROCK_R[1], -co.y / ROCK_R[2]])
    TILE = {(0, 1): 0, (0, -1): 1, (1, 1): 2, (1, -1): 3, (2, 1): 4, (2, -1): 5}
    for f in bm.faces:
        c = dirn(f.calc_center_median()); ax = int(np.argmax(np.abs(c))); sg = 1 if c[ax] > 0 else -1
        t = TILE[ax, sg]; ox, oy = (t % 3) / 3, (t // 3) / 2
        o1, o2 = [i for i in range(3) if i != ax]
        for lp in f.loops:
            d = dirn(lp.vert.co); m = abs(d[ax]) or 1e-6
            u, v = d[o1] / m * sg, d[o2] / m
            lp[uvl].uv = (ox + (0.5 + 0.46 * np.clip(u, -1.08, 1.08)) / 3, oy + (0.5 + 0.46 * np.clip(v, -1.08, 1.08)) / 2)
    bm.to_mesh(obj.data); bm.free()
rock_uv(lo)

rock_alb = new_img('void_rock_albedo', TEX); rock_nrm = new_img('void_rock_normal', TEX, data=True)
rock_ao  = new_img('void_rock_ao', TEX // 2, data=True)
rock_mat, rock_an, rock_nn = tex_mat('void_rock', rock_alb, rock_nrm, rough=0.93)
lo.data.materials.clear(); lo.data.materials.append(rock_mat)
ao_node = rock_mat.node_tree.nodes.new('ShaderNodeTexImage'); ao_node.image = rock_ao

bk = scene.render.bake
bk.use_selected_to_active = True; bk.cage_extrusion = 3.0; bk.max_ray_distance = 8.0; bk.margin = 8
def bake(kind, node, **kw):
    rock_mat.node_tree.nodes.active = node
    set_active(hi, lo); bpy.ops.object.bake(type=kind, **kw)
print('void: baking rock normal'); bake('NORMAL', rock_nn, normal_space='TANGENT')
print('void: baking rock colour'); bake('DIFFUSE', rock_an, pass_filter={'COLOR'})
print('void: baking rock AO');     bake('AO', ao_node)
rock_mat.node_tree.nodes.remove(ao_node)
ao = img_np(rock_ao)[..., :1]
ao = np.repeat(np.repeat(ao, TEX // ao.shape[0], 0), TEX // ao.shape[1], 1)
alb = img_np(rock_alb)[..., :3] * (0.35 + 0.65 * ao)                # AO into the colour: no light in Void shades cavities
np_img(rock_alb, alb); save(rock_alb); save(rock_nrm)
set_active(lo); bpy.ops.object.shade_smooth()

# =============================================================================================
# 2. DECK: steel tread plate, textures generated in world units
# =============================================================================================
DT = TEX
SIDE_V = 0.12                   # bottom strip of the atlas = the deck's sides; the rest = its top
def deck_textures():
    H = W = DT
    rows = int(H * (1 - SIDE_V))
    u = (np.arange(W) + 0.5) / W
    v = (np.arange(rows) + 0.5) / rows
    X = (-DECK_X + 2 * DECK_X * u)[None, :].repeat(rows, 0)       # Blender x = game x
    BY = (-DECK_Z + 2 * DECK_Z * v)[:, None].repeat(W, 1)         # Blender y = -game z
    GZ = -BY
    px = 2 * DECK_X / W                                            # world units per texel (x)
    def vnoise(freq, seed, oct=4):
        out = np.zeros_like(X); amp = 1; tot = 0; r = np.random.default_rng(seed)
        for o in range(oct):
            f = freq * 2 ** o
            nx, ny = int(2 * DECK_X * f) + 3, int(2 * DECK_Z * f) + 3
            G = r.random((ny, nx))
            fx = (X + DECK_X) * f; fy = (BY + DECK_Z) * f
            ix, iy = fx.astype(int), fy.astype(int); tx, ty = fx - ix, fy - iy
            tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty)
            a = G[iy, ix] * (1 - tx) + G[iy, ix + 1] * tx
            b = G[iy + 1, ix] * (1 - tx) + G[iy + 1, ix + 1] * tx
            out += amp * (a * (1 - ty) + b * ty); tot += amp; amp *= 0.5
        return out / tot
    def sstep(a, b, x): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

    Hh = np.zeros_like(X)
    # tread: lozenges on a 2.8-unit lattice, alternating +-45 degrees
    P = 2.8; ci, cj = np.floor(X / P), np.floor(BY / P)
    lx, ly = (X / P - ci - 0.5) * P, (BY / P - cj - 0.5) * P
    sg = np.where((ci + cj) % 2 == 0, 1.0, -1.0); c45 = math.sqrt(0.5)
    ru, rv = c45 * (lx + sg * ly), c45 * (-sg * lx + ly)
    e = (ru / 1.05) ** 2 + (rv / 0.3) ** 2
    Hh += 0.35 * sstep(0, 1, 1 - e)
    # plate seams (4 x 3 plates) and the bolts along them and round the edge
    seamsx = [-50.0, 0.0, 50.0]; seamsz = [-22.0, 22.0]
    dseam = np.full_like(X, 99.0)
    for sx in seamsx: dseam = np.minimum(dseam, np.abs(X - sx))
    for sz in seamsz: dseam = np.minimum(dseam, np.abs(BY - sz))
    groove = 1 - sstep(0.15, 0.4, dseam)
    Hh = Hh * sstep(0.4, 1.2, dseam) - 0.5 * groove
    edge = np.minimum(DECK_X - np.abs(X), DECK_Z - np.abs(BY))
    Hh *= sstep(1.2, 2.2, edge)                                  # a smooth rolled rim, no tread on it
    bolt = np.zeros_like(X)
    def bolts_line(dist_to_line, along, off):
        a = along - np.round(along / 5.0) * 5.0
        rr = np.sqrt((dist_to_line - off) ** 2 + a ** 2)
        return np.clip(1 - (rr / 0.55) ** 2, 0, 1) ** 0.5
    for sx in seamsx:
        for o in (-1.6, 1.6): bolt = np.maximum(bolt, bolts_line(X - sx, BY, o))
    for sz in seamsz:
        for o in (-1.6, 1.6): bolt = np.maximum(bolt, bolts_line(BY - sz, X, o))
    bolt = np.maximum(bolt, bolts_line(edge, np.where(np.abs(X) / DECK_X > np.abs(BY) / DECK_Z, BY, X), 1.7))
    Hh = np.maximum(Hh, 0.6 * bolt)

    # colour, sRGB 0..1
    def c(h): return np.array([((h >> k) & 255) / 255 for k in (16, 8, 0)])
    n1, n2, n3 = vnoise(0.05, SEED + 1), vnoise(0.4, SEED + 2), vnoise(1.5, SEED + 3, 3)
    steel = c(0x3c4044)[None, None] * (0.8 + 0.4 * n1[..., None]) * (0.92 + 0.16 * n3[..., None])
    alb = steel.copy()
    rough = 0.5 + 0.15 * n2; metal = np.full_like(X, 0.85)
    # scuffs where people stand (the long sides, near the handles) and on the tread tops
    walk = sstep(40, 48, np.abs(GZ)) * (1 - sstep(62, 66, np.abs(GZ))) * (1 - sstep(70, 80, np.abs(X)))
    scuff = np.clip(walk * sstep(0.35, 0.7, n2) + 0.5 * (Hh > 0.2) * sstep(0.5, 0.8, n3), 0, 1)
    alb = alb * (1 - scuff[..., None] * 0.45) + c(0x7c8084)[None, None] * scuff[..., None] * 0.45
    rough -= 0.12 * scuff
    # paint: a Federation-blue border band, and a white box round the table
    band = sstep(3, 3.5, edge) * (1 - sstep(9.5, 10, edge))
    boxx = (np.abs(np.abs(X) - 71) < 0.7) & (np.abs(GZ) < 45.7)
    boxz = (np.abs(np.abs(GZ) - 45) < 0.7) & (np.abs(X) < 71.7)
    wear = sstep(0.3, 0.55, vnoise(0.25, SEED + 4) * 0.6 + n3 * 0.4)
    pb = band * wear; pw = (boxx | boxz) * sstep(0.35, 0.6, vnoise(0.3, SEED + 5) * 0.5 + n3 * 0.5)
    for m_, col_ in ((pb, 0x1b4a6b), (pw, 0xc8cbc4)):
        alb = alb * (1 - m_[..., None]) + c(col_)[None, None] * (0.85 + 0.15 * n2[..., None]) * m_[..., None]
        rough = rough * (1 - m_) + 0.68 * m_; metal = metal * (1 - m_)
    # rust and grime: bleeding out of the seams and bolts, copper-brown
    rust = np.clip((groove * 0.8 + bolt * 0.9) * sstep(0.4, 0.75, vnoise(0.6, SEED + 6)) + 0.25 * sstep(0.62, 0.8, n1), 0, 1)
    alb = alb * (1 - 0.7 * rust[..., None]) + c(0x5e3419)[None, None] * 0.7 * rust[..., None]
    rough = rough * (1 - rust) + 0.85 * rust; metal = metal * (1 - 0.8 * rust)
    # contact shadow: the table body is ~35 units up, so it is a wide soft box; the feet are tight
    def soft(t, a, w): return 1 - sstep(a - w, a + w, t)
    sh = 0.38 * soft(np.abs(X), TABLE_X, 16) * soft(np.abs(GZ), TABLE_Z, 16)
    for lx_, lz_ in LEGS:
        rr2 = (X - lx_) ** 2 + (GZ - lz_) ** 2
        sh += 0.55 * np.exp(-rr2 / (2 * 2.6 ** 2)) + 0.25 * np.exp(-rr2 / (2 * 7 ** 2))
    alb *= (1 - np.clip(sh, 0, 0.8))[..., None]
    alb *= (1 - 0.35 * groove)[..., None]

    # height -> normal (Blender UV space: +x = +u, +y = +v)
    dx = np.gradient(Hh, axis=1) / px; dy = np.gradient(Hh, axis=0) / (2 * DECK_Z / rows)
    nrm = np.stack([-dx, -dy, np.ones_like(Hh)], -1); nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)

    A = np.zeros((H, W, 3)); Nn = np.zeros((H, W, 3)); O = np.zeros((H, W, 3))
    A[H - rows:] = np.clip(alb, 0, 1); Nn[H - rows:] = nrm * 0.5 + 0.5
    O[H - rows:, :, 0] = 1; O[H - rows:, :, 1] = np.clip(rough, 0.05, 1); O[H - rows:, :, 2] = np.clip(metal, 0, 1)
    # the side strip: plain worn steel with a few vertical seams
    sr = H - rows; su = np.arange(W)[None, :] / W
    side = np.broadcast_to(c(0x33373a)[None, None], (sr, W, 3)) * (1 - 0.5 * ((su * 30 % 1) < 0.01))[..., None]
    A[:sr] = side; Nn[:sr] = (0.5, 0.5, 1.0)
    O[:sr, :, 0] = 1; O[:sr, :, 1] = 0.55; O[:sr, :, 2] = 0.8
    return A, Nn, O

print('void: deck textures')
dA, dN, dO = deck_textures()
deck_alb = new_img('void_deck_albedo', DT); np_img(deck_alb, dA); save(deck_alb)
deck_nrm = new_img('void_deck_normal', DT, data=True); np_img(deck_nrm, dN); save(deck_nrm)
deck_orm = new_img('void_deck_orm', DT // 2, data=True)
np_img(deck_orm, dO[::2, ::2]); save(deck_orm)
deck_mat, _, _ = tex_mat('void_deck', deck_alb, deck_nrm, deck_orm)

def build_deck():
    bm = bmesh.new()
    x0, x1, z0, z1, y0, y1 = -DECK_X, DECK_X, -DECK_Z, DECK_Z, FY - DECK_T, FY
    P = {}
    for xi, x in enumerate((x0, x1)):
        for yi, y in enumerate((y0, y1)):
            for zi, z in enumerate((z0, z1)):
                P[xi, yi, zi] = bm.verts.new(g2b(x, y, z))
    faces = {
        'top':   [P[0,1,0], P[0,1,1], P[1,1,1], P[1,1,0]],
        'bot':   [P[0,0,0], P[1,0,0], P[1,0,1], P[0,0,1]],
        'zneg':  [P[0,0,0], P[0,1,0], P[1,1,0], P[1,0,0]],
        'zpos':  [P[1,0,1], P[1,1,1], P[0,1,1], P[0,0,1]],
        'xneg':  [P[0,0,1], P[0,1,1], P[0,1,0], P[0,0,0]],
        'xpos':  [P[1,0,0], P[1,1,0], P[1,1,1], P[1,0,1]],
    }
    uvl = bm.loops.layers.uv.new('UVMap')
    per = 4 * (DECK_X + DECK_Z); acc = {'zneg': 0, 'xpos': 2 * DECK_X, 'zpos': 2 * DECK_X + 2 * DECK_Z, 'xneg': 4 * DECK_X + 2 * DECK_Z}
    for k, vs in faces.items():
        f = bm.faces.new(vs)
        for lp in f.loops:
            co = lp.vert.co; gx, gy, gz = co.x, co.z, -co.y
            if k in ('top', 'bot'):
                lp[uvl].uv = ((gx + DECK_X) / (2 * DECK_X), SIDE_V + (1 - SIDE_V) * (co.y + DECK_Z) / (2 * DECK_Z))
            else:
                along = {'zneg': gx + DECK_X, 'xpos': gz + DECK_Z, 'zpos': DECK_X - gx, 'xneg': DECK_Z - gz}[k] + acc[k]
                lp[uvl].uv = (along / per, 0.01 + (SIDE_V - 0.02) * (gy - y0) / DECK_T)
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_obj('deck', bm, deck_mat)
build_deck()

# =============================================================================================
# 3. PROPS (plain PBR colours, no textures)
# =============================================================================================
m_steel = flat_mat('void_steel', 0x2c2f33, metal=0.85, rough=0.42)
m_paint = flat_mat('void_paint', 0x123f5e, metal=0.1, rough=0.55)
m_lens  = flat_mat('void_lens', 0xfff1d6, rough=0.3, emit=0xffe2b0, emit_str=6.0)
m_rub   = flat_mat('void_rubber', 0x111214, rough=0.85)
m_crate = flat_mat('void_crate', 0x8a4a1c, metal=0.2, rough=0.7)
m_far   = flat_mat('void_debris', 0x34322f, rough=0.95)

# leg feet: a plate under each leg and an L-bracket on its outer face, because nothing stays put in space
for i, (lx, lz) in enumerate(LEGS):
    box('foot%d' % i, m_steel, lx, FY + 0.3, lz, 9, 0.6, 9)
    ox = 1 if lx > 0 else -1
    box('bracket%d' % i, m_steel, lx + ox * 2.35, FY + 3.2, lz, 0.7, 6, 5)
    for dz in (-3.4, 3.4):
        cyl('bolt%d_%d' % (i, dz > 0), m_steel, (lx + ox * 3.4, FY + 0.6, lz + dz), (lx + ox * 3.4, FY + 1.3, lz + dz), 0.6, 6)

# two work lamps behind the far side, aimed in at the table
for s in (-1, 1):
    bx, bz = s * 84, -54
    box('lampbase%d' % s, m_steel, bx, FY + 0.5, bz, 9, 1, 9)
    cyl('lamppole%d' % s, m_paint, (bx, FY + 1, bz), (bx, 38, bz), 1.1)
    cyl('lampcollar%d' % s, m_steel, (bx, FY + 1, bz), (bx, FY + 6, bz), 1.6)
    hx, hy, hz = bx - s * 6, 40, bz + 6
    cyl('lamparm%d' % s, m_steel, (bx, 38, bz), (hx, hy, hz), 0.55, 8)
    aim = (g2b(s * 34, 0, 0) - g2b(hx, hy, hz)).normalized()
    q = aim.to_track_quat('-Z', 'Y')
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); bmesh.ops.scale(bm, vec=(7, 4.5, 5), verts=bm.verts)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=q.to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=g2b(hx, hy, hz), verts=bm.verts); mesh_obj('lamphead%d' % s, bm, m_paint)
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); bmesh.ops.scale(bm, vec=(6, 3.6, 0.4), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, -2.6), verts=bm.verts)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=q.to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=g2b(hx, hy, hz), verts=bm.verts); mesh_obj('lamplens%d' % s, bm, m_lens)

# the generator, its cables, and a couple of crates
gx, gz = -92, -30
box('gen', m_paint, gx, FY + 4.5, gz, 11, 9, 14)
box('gengrille', m_steel, gx + 5.6, FY + 4.5, gz, 0.4, 6, 10)
cyl('genexhaust', m_steel, (gx - 2, FY + 9, gz - 4), (gx - 2, FY + 13, gz - 4), 0.8, 8)
cable('cableL', m_rub, [(gx + 3, FY + 3, gz - 7), (gx + 4, FY + 0.4, gz - 14), (-84, FY + 0.4, -50), (-84, FY + 4, -54)])
cable('cableR', m_rub, [(gx + 3, FY + 3, gz - 7), (-40, FY + 0.4, -60), (40, FY + 0.4, -61), (84, FY + 0.4, -50), (84, FY + 4, -54)])
box('crate1', m_crate, 92, FY + 4, -34, 9, 8, 9, rot=0.1)
box('crate2', m_crate, 91, FY + 11, -35, 6, 6, 6, rot=0.45)
box('crate3', m_crate, 90, FY + 3, -18, 7, 6, 6, rot=-0.2)

# distant debris: parallax and scale, faceted on purpose
for i in range(7):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    o = Vector(rng.uniform(-50, 50, 3)); sc = rng.uniform(6, 18); sy = rng.uniform(0.6, 1)
    for v in bm.verts:
        k = sc * (1 + 0.35 * noise.fractal(v.co * 1.3 + o, 0.9, 2.0, 3))
        v.co = Vector((v.co.x * k, v.co.y * k * sy, v.co.z * k * 0.8))
    ang = rng.uniform(0, 2 * math.pi); dist = rng.uniform(210, 330); h = rng.uniform(-170, 70)
    if 0.9 < ang < 2.2: ang += 1.4                            # keep the near side (the match camera) clear
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rng.uniform(0, 6), 3, Vector(rng.normal(size=3)).normalized()), verts=bm.verts)
    bmesh.ops.translate(bm, vec=g2b(math.cos(ang) * dist, h, math.sin(ang) * dist), verts=bm.verts)
    mesh_obj('debris%d' % i, bm, m_far)

# =============================================================================================
# 4. one mesh per material, save, export
# =============================================================================================
by_mat = {}
for o in list(col.objects):
    if o.type == 'MESH': by_mat.setdefault(o.data.materials[0].name, []).append(o)
for name, objs in by_mat.items():
    if len(objs) > 1:
        set_active(*objs); bpy.ops.object.join()
    bpy.context.view_layer.objects.active.name = 'void_' + name if not name.startswith('void_') else name
for o in col.objects:
    if o.type == 'MESH': o.name = o.data.materials[0].name.replace('void_', 'room_void_')
tris = 0
for o in col.objects:
    o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
print('void: %d meshes, %d tris' % (len(col.objects), tris))

for im in (rock_alb, rock_nrm, deck_alb, deck_nrm, deck_orm): im.pack()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BUILD, 'void_asteroid.blend'))
set_active(*col.objects)
kw = dict(filepath=GLB, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
          export_lights=False, export_cameras=False)
bpy.ops.export_scene.gltf(**kw)
print('void: wrote', GLB, '%.1f MB' % (os.path.getsize(GLB) / 1048576))
