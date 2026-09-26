"""
build_moon_base.py  --  Fuzeball MOON BASE room -> GLB

    blender -b -P tools/build_moon_base.py -- [--tex 2048] [--seed 5]
    node tools/ktx2-encode.mjs assets/rooms/moon/fuzeball_room_moon.glb

The checklist brief: grey dust, Earth hanging in a black sky, one hard sun. DIRECTION.md: rooms are
venues people actually play in, small and scruffy -- so this is a cramped hab dome, 3.5 m across
(1 game unit = 1 cm; the table is 1.2 m), dropped into a small crater with the table bolted to its
floor, and a Federation flag planted outside because of course there is one.

WHAT IS IN IT (static, one mesh per material)
    terrain    a ring from the dome wall to a crater rim ~5 m out. Tiling regolith texture (UV0) times
               vertex colours for the large scale (crater floors darker, fresh ejecta lighter). The
               rim is tall enough to hide the horizon from every game camera, so the sky only has to
               be stars, Earth and the sun (build_moon_sky.py) and nothing has to line up with it.
    floor      tiled composite with tracked-in dust, a painted Federation-blue ring round the table
    dome       geodesic struts (opaque) + faint glass panes (alpha blend; the loader draws room glass
               first among transparent things and never lets it receive shadows)
    ring wall  low steel wall with a light strip; an airlock with a tunnel out through the glass
    props      leg brackets, a bench with two helmets, O2 tanks, the flag, boulders outside

NO LIGHTS ARE EXPORTED. The sun is CONFIG.rooms.moon.dir (casts the table's shadow); the table spots
are pooled rooms.moon.lights. SUN_DIR in build_moon_sky.py must match dir.pos.
"""
import bpy, bmesh, os, sys, math
import numpy as np
from mathutils import Vector, Matrix, noise

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(n, d): return type(d)(argv[argv.index(n) + 1]) if n in argv else d
TEX  = arg('--tex', 2048)
SEED = arg('--seed', 5)
ROOT  = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT   = os.path.join(ROOT, 'assets', 'rooms', 'moon')
BUILD = os.path.join(ROOT, 'tools', 'build', 'moon')
os.makedirs(OUT, exist_ok=True); os.makedirs(BUILD, exist_ok=True)
GLB = os.path.join(OUT, 'fuzeball_room_moon.glb')
rng = np.random.default_rng(SEED)

# ---- the numbers that matter (game units, 1 = 1 cm) --------------------------------------------
FY       = -44.0                     # floor = table feet
DOME_R   = 176.0                     # glass radius; every game camera sits inside it
WALL_R   = 172.0                     # ring wall inner face = floor edge
WALL_TOP = -26.0                     # the dome springs from here
TERR_R0, TERR_R1 = 165.0, 580.0      # terrain ring (inside the wall is hidden by the floor)
RIM_R, RIM_H = 505.0, 118.0          # crater rim radius and height above the floor
TILE     = 40.0                      # regolith texture repeat, units
LEGS     = [(sx * 58, sz * 32) for sx in (-1, 1) for sz in (-1, 1)]
AIRLOCK  = math.radians(-128)        # azimuth (from +x toward +z) of the airlock door
def g2b(x, y, z): return Vector((x, -z, y))

# ---- scene + helpers ---------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = bpy.data.collections.new('Moon Room'); scene.collection.children.link(col)
def link(o): col.objects.link(o); return o
def set_active(*objs):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[-1]
def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)
def flat_mat(name, hexc, metal=0.0, rough=0.6, emit=None, emit_str=1.0, alpha=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = srgb(hexc)
    b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
    if emit is not None:
        b.inputs['Emission Color'].default_value = srgb(emit); b.inputs['Emission Strength'].default_value = emit_str
    if alpha is not None:
        b.inputs['Alpha'].default_value = alpha
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
        try: m.blend_method = 'BLEND'
        except Exception: pass
    m.diffuse_color = srgb(hexc)
    return m
def new_img(name, size, data=False):
    im = bpy.data.images.new(name, size, size, alpha=False)
    im.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    return im
def np_img(im, arr):
    h, w = arr.shape[:2]; rgba = np.ones((h, w, 4), np.float32); rgba[..., :3] = arr
    im.pixels.foreach_set(rgba.ravel()); im.update()
    im.filepath_raw = os.path.join(BUILD, im.name + '.png'); im.file_format = 'PNG'; im.save()
def tex_mat(name, albedo, normal, orm=None, rough=0.9, vcol=False):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    a = nt.nodes.new('ShaderNodeTexImage'); a.image = albedo
    if vcol:                                                   # glTF: baseColor = texture x COLOR_0
        vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'
        mx.inputs['Factor'].default_value = 1.0
        ins = [i for i in mx.inputs if i.type == 'RGBA']
        nt.links.new(a.outputs['Color'], ins[0]); nt.links.new(vc.outputs['Color'], ins[1])
        nt.links.new([o for o in mx.outputs if o.type == 'RGBA'][0], b.inputs['Base Color'])
    else:
        nt.links.new(a.outputs['Color'], b.inputs['Base Color'])
    n = nt.nodes.new('ShaderNodeTexImage'); n.image = normal
    nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(n.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    if orm is not None:
        o = nt.nodes.new('ShaderNodeTexImage'); o.image = orm
        sp = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(o.outputs['Color'], sp.inputs['Color'])
        nt.links.new(sp.outputs['Green'], b.inputs['Roughness']); nt.links.new(sp.outputs['Blue'], b.inputs['Metallic'])
    else:
        b.inputs['Metallic'].default_value = 0.0; b.inputs['Roughness'].default_value = rough
    return m
def mesh_obj(name, bm, mat, smooth=False):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = smooth
    o = bpy.data.objects.new(name, me); o.data.materials.append(mat)
    return link(o)
def box(name, mat, cx, cy, cz, sx, sy, sz, yaw=0.0):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sz, sy), verts=bm.verts)
    if yaw: bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(-yaw, 3, 'Z'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=g2b(cx, cy, cz), verts=bm.verts)
    return mesh_obj(name, bm, mat)
def cyl(name, mat, a, b, r, seg=16, r2=None):
    A, B = g2b(*a), g2b(*b); d = B - A
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=d.length)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=d.normalized().to_track_quat('Z', 'Y').to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(A + B) / 2, verts=bm.verts)
    return mesh_obj(name, bm, mat, smooth=True)
def sphere(name, mat, c, r, sub=3, squash=(1, 1, 1)):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    bmesh.ops.scale(bm, vec=(squash[0], squash[2], squash[1]), verts=bm.verts)
    bmesh.ops.translate(bm, vec=g2b(*c), verts=bm.verts)
    return mesh_obj(name, bm, mat, smooth=True)
def sstep(a, b, x): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

# =============================================================================================
# 1. TERRAIN
# =============================================================================================
CRATERS = []
for _ in range(140):
    r = rng.uniform(190, RIM_R - 40); a = rng.uniform(0, 2 * math.pi)
    rad = float(np.clip(rng.pareto(1.6) * 6 + 5, 5, 48))
    CRATERS.append((r * math.cos(a), r * math.sin(a), rad, rng.uniform(0.5, 1.0)))   # x, z, radius, freshness
NOFF = Vector(rng.uniform(-60, 60, 3))

def height(x, z):
    """Terrain y at game (x,z), vectorised. Also returns (dark, bright) vertex-colour factors."""
    r = np.sqrt(x * x + z * z); a = np.arctan2(z, x)
    fine = np.array([noise.fractal(Vector((xx / 30, zz / 30, 0)) + NOFF, 0.8, 2.0, 5) for xx, zz in zip(x.ravel(), z.ravel())]).reshape(x.shape)
    big  = np.array([noise.fractal(Vector((xx / 180, zz / 180, 1)) + NOFF, 0.9, 2.0, 3) for xx, zz in zip(x.ravel(), z.ravel())]).reshape(x.shape)
    rimn = np.array([noise.fractal(Vector((math.cos(t) * 2.2, math.sin(t) * 2.2, 5)) + NOFF, 0.8, 2.0, 4) for t in a.ravel()]).reshape(x.shape)
    y = FY - 2.0 + 1.1 * fine + 5.0 * big * sstep(220, 320, r)
    rim = RIM_H * (0.9 + 0.35 * rimn)
    y += sstep(300, RIM_R, r) ** 1.6 * rim - sstep(RIM_R, TERR_R1, r) * rim * 0.28
    dark = np.zeros_like(x); bright = np.zeros_like(x)
    for cx, cz, cr, fr in CRATERS:
        d = np.sqrt((x - cx) ** 2 + (z - cz) ** 2) / cr
        bowl = np.where(d < 1, -(1 - d * d) * 0.28 * cr, 0)
        lip  = np.where((d >= 0.8) & (d < 1.6), 0.07 * cr * np.sin((d - 0.8) / 0.8 * math.pi), 0)
        y += (bowl + lip) * np.clip(1 - sstep(RIM_R - 60, RIM_R, r), 0, 1)
        dark = np.maximum(dark, (d < 1) * (1 - d) * 0.6)
        bright = np.maximum(bright, fr * np.exp(-np.maximum(d - 1, 0) / 0.9) * (d >= 0.85) * 0.8)
    return y, dark, bright, big

def build_terrain():
    NR, NS = 70, 208
    rs = TERR_R0 + (TERR_R1 - TERR_R0) * (np.arange(NR + 1) / NR) ** 1.25
    th = np.arange(NS) / NS * 2 * math.pi
    R, T = np.meshgrid(rs, th, indexing='ij')
    X = R * np.cos(T); Z = R * np.sin(T)
    Y, dark, bright, big = height(X, Z)
    v = 0.78 + 0.12 * big - 0.22 * dark + 0.22 * bright + 0.08 * sstep(RIM_R - 120, RIM_R, R)
    v = np.clip(v, 0.45, 1.0)
    bm = bmesh.new()
    verts = [[bm.verts.new(g2b(X[i, j], Y[i, j], Z[i, j])) for j in range(NS)] for i in range(NR + 1)]
    uvl = bm.loops.layers.uv.new('UVMap'); cl = bm.loops.layers.float_color.new('Col')
    for i in range(NR):
        for j in range(NS):
            jj = (j + 1) % NS
            f = bm.faces.new((verts[i][j], verts[i + 1][j], verts[i + 1][jj], verts[i][jj]))
            for lp, (ii, kk) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, jj), (i, jj))):
                co = lp.vert.co
                lp[uvl].uv = (co.x / TILE, co.y / TILE)
                c = float(v[ii, kk]); lp[cl] = (c, c * 0.985, c * 0.965, 1.0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def regolith_textures(n):
    """Tileable regolith: fine grain, pebbles and micro-craters. Returns albedo (sRGB), normal."""
    def tnoise(P, seed):
        g = np.random.default_rng(seed).random((P, P))
        t = np.arange(n) / n * P; i0 = t.astype(int); f = t - i0; f = f * f * (3 - 2 * f); i1 = (i0 + 1) % P
        a = g[i0][:, i0] * (1 - f)[None, :] + g[i0][:, i1] * f[None, :]
        b = g[i1][:, i0] * (1 - f)[None, :] + g[i1][:, i1] * f[None, :]
        return a * (1 - f)[:, None] + b * f[:, None]
    H = sum(tnoise(P, SEED + P) * w for P, w in ((4, 1.2), (8, 0.8), (16, 0.5), (32, 0.35), (64, 0.25), (128, 0.18), (256, 0.12)))
    H = (H - H.mean()) * 0.6
    yy, xx = np.mgrid[0:n, 0:n] / n * TILE
    r2 = np.random.default_rng(SEED + 99)
    for _ in range(420):                                   # pebbles (wrapped, so the tile repeats cleanly)
        cx, cy = r2.uniform(0, TILE, 2); rr = r2.uniform(0.15, 0.9)
        dx = (xx - cx + TILE / 2) % TILE - TILE / 2; dy = (yy - cy + TILE / 2) % TILE - TILE / 2
        H += np.clip(1 - (dx * dx + dy * dy) / (rr * rr), 0, 1) ** 0.6 * rr * 0.5
    for _ in range(26):                                    # micro craters
        cx, cy = r2.uniform(0, TILE, 2); rr = r2.uniform(0.6, 3.2)
        dx = (xx - cx + TILE / 2) % TILE - TILE / 2; dy = (yy - cy + TILE / 2) % TILE - TILE / 2
        d = np.sqrt(dx * dx + dy * dy) / rr
        H += np.where(d < 1, -(1 - d * d) * 0.3 * rr, 0) + np.where((d >= 0.85) & (d < 1.5), 0.06 * rr * np.sin((d - 0.85) / 0.65 * math.pi), 0)
    px = TILE / n
    gy, gx = np.gradient(H, px)
    nrm = np.stack([-gx, gy, np.ones_like(H)], -1)        # rows go DOWN the image = -v, hence +gy
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    tone = 0.62 + 0.08 * (tnoise(16, SEED + 7) - 0.5) + 0.05 * (tnoise(128, SEED + 8) - 0.5)
    lit = np.clip(0.9 + 0.8 * nrm[..., 0] * 0.3 - 0.25 * np.clip(-H, 0, 3) / 3, 0.6, 1.2)
    alb = np.clip((tone * lit)[..., None] * np.array([1.0, 0.985, 0.96]), 0, 1)
    return alb[::-1], (nrm * 0.5 + 0.5)[::-1]             # Blender pixels are bottom row first

print('moon: terrain')
ra, rn = regolith_textures(TEX // 2)
im_ra = new_img('moon_regolith_albedo', TEX // 2); np_img(im_ra, ra)
im_rn = new_img('moon_regolith_normal', TEX // 2, True); np_img(im_rn, rn)
m_terrain = tex_mat('moon_terrain', im_ra, im_rn, rough=0.97, vcol=True)
terrain = mesh_obj('terrain', build_terrain(), m_terrain, smooth=True)

# boulders outside, sat on the terrain
m_rock = flat_mat('moon_boulder', 0x5a5752, rough=0.95)
for i in range(26):
    r = rng.uniform(200, RIM_R - 20); a = rng.uniform(0, 2 * math.pi); s = float(np.clip(rng.pareto(2.0) * 3 + 2, 2, 14))
    x, z = r * math.cos(a), r * math.sin(a)
    y = float(height(np.array([[x]]), np.array([[z]]))[0][0, 0])
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    o = Vector(rng.uniform(-50, 50, 3)); sy = rng.uniform(0.5, 0.9)
    for v in bm.verts:
        k = s * (1 + 0.35 * noise.fractal(v.co * 1.4 + o, 0.9, 2.0, 3)); v.co = Vector((v.co.x * k, v.co.y * k, v.co.z * k * sy))
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rng.uniform(0, 6.28), 3, 'Z'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=g2b(x, y + s * sy * 0.35, z), verts=bm.verts)
    mesh_obj('boulder%d' % i, bm, m_rock)

# =============================================================================================
# 2. FLOOR (textures in world units: tiles, dust, the blue ring, a soft AO under the table)
# =============================================================================================
def floor_textures(n):
    u = (np.arange(n) + 0.5) / n
    X = (-WALL_R + 2 * WALL_R * u)[None, :].repeat(n, 0)
    BY = (-WALL_R + 2 * WALL_R * u)[:, None].repeat(n, 1); GZ = -BY
    R = np.sqrt(X * X + GZ * GZ)
    def vn(freq, seed, oct=4):
        out = np.zeros_like(X); amp = 1; tot = 0; g = np.random.default_rng(seed)
        for o in range(oct):
            f = freq * 2 ** o; m = int(2 * WALL_R * f) + 3; G = g.random((m, m))
            fx = (X + WALL_R) * f; fy = (BY + WALL_R) * f; ix, iy = fx.astype(int), fy.astype(int)
            tx, ty = fx - ix, fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty)
            a = G[iy, ix] * (1 - tx) + G[iy, ix + 1] * tx; b = G[iy + 1, ix] * (1 - tx) + G[iy + 1, ix + 1] * tx
            out += amp * (a * (1 - ty) + b * ty); tot += amp; amp *= 0.5
        return out / tot
    T = 28.0
    dx = np.abs(((X + T / 2) % T) - T / 2); dy = np.abs(((BY + T / 2) % T) - T / 2)
    gap = 1 - sstep(0.25, 0.55, np.minimum(dx, dy))
    H = -0.6 * gap
    tid = (np.floor(X / T) * 7 + np.floor(BY / T) * 13) % 5
    n1, n2, n3 = vn(0.03, SEED + 1), vn(0.25, SEED + 2), vn(1.2, SEED + 3, 3)
    base = np.array([0.42, 0.43, 0.435])[None, None] * (0.92 + 0.03 * tid[..., None] + 0.08 * n3[..., None])
    alb = base.copy(); rough = 0.55 + 0.1 * n2; metal = np.zeros_like(X)
    # tracked-in regolith: heaviest from the airlock to the table, and in the grooves
    ax, az = WALL_R * math.cos(AIRLOCK), WALL_R * math.sin(AIRLOCK)
    t = np.clip(((X - ax) * (-ax) + (GZ - az) * (-az)) / (ax * ax + az * az), 0, 1)
    dpath = np.sqrt((X - ax - t * -ax) ** 2 + (GZ - az - t * -az) ** 2)
    dust = np.clip(0.85 * np.exp(-dpath / 26) * (1 - t * 0.5) + 0.45 * gap + 0.45 * sstep(0.45, 0.75, n2) + 0.3 * sstep(110, 170, R), 0, 1)
    dust *= sstep(0.25, 0.6, n1 * 0.5 + n3 * 0.5 + 0.15)
    alb = alb * (1 - dust[..., None] * 0.75) + np.array([0.33, 0.32, 0.305])[None, None] * dust[..., None] * 0.75
    alb *= (0.9 + 0.1 * n1)[..., None]                    # scuffs and wear, so no two tiles match
    rough = rough * (1 - dust) + 0.92 * dust
    # the Federation-blue ring round the table, worn where feet go
    ring = sstep(95, 96, R) * (1 - sstep(99, 100, R)) * sstep(0.28, 0.5, n2 * 0.6 + n3 * 0.4)
    alb = alb * (1 - ring[..., None]) + np.array([0.07, 0.25, 0.37])[None, None] * ring[..., None]
    # soft ambient occlusion under the table and at each foot (the sun draws the real shadow)
    def soft(tt, a, w): return 1 - sstep(a - w, a + w, tt)
    ao = 0.25 * soft(np.abs(X), 63, 14) * soft(np.abs(GZ), 37, 14)
    for lx, lz in LEGS: ao += 0.4 * np.exp(-((X - lx) ** 2 + (GZ - lz) ** 2) / (2 * 2.5 ** 2))
    ao += 0.35 * sstep(WALL_R - 14, WALL_R, R)             # the wall base
    alb *= (1 - np.clip(ao, 0, 0.7))[..., None]
    gy_, gx_ = np.gradient(H, 2 * WALL_R / n)
    nrm = np.stack([-gx_, -gy_, np.ones_like(H)], -1); nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    orm = np.stack([np.ones_like(X), np.clip(rough, 0, 1), metal], -1)
    return np.clip(alb, 0, 1), nrm * 0.5 + 0.5, orm

print('moon: floor')
fa, fn, fo = floor_textures(TEX)
im_fa = new_img('moon_floor_albedo', TEX); np_img(im_fa, fa)
im_fn = new_img('moon_floor_normal', TEX, True); np_img(im_fn, fn)
im_fo = new_img('moon_floor_orm', TEX // 2, True); np_img(im_fo, fo[::2, ::2])
m_floor = tex_mat('moon_floor', im_fa, im_fn, im_fo)
bm = bmesh.new()
bmesh.ops.create_circle(bm, cap_ends=True, segments=96, radius=WALL_R + 2)
top = list(bm.faces)
bmesh.ops.translate(bm, vec=(0, 0, FY), verts=bm.verts)
uvl = bm.loops.layers.uv.new('UVMap')
for f in bm.faces:
    for lp in f.loops: lp[uvl].uv = ((lp.vert.co.x + WALL_R) / (2 * WALL_R), (lp.vert.co.y + WALL_R) / (2 * WALL_R))
mesh_obj('floor', bm, m_floor)

# =============================================================================================
# 3. WALL, DOME, AIRLOCK
# =============================================================================================
m_steel = flat_mat('moon_steel', 0x2b3036, metal=0.75, rough=0.42)
m_panel = flat_mat('moon_panel', 0x4a5057, metal=0.45, rough=0.5)
m_strip = flat_mat('moon_strip', 0xdfe8ff, rough=0.4, emit=0xdfe8ff, emit_str=4.0)
m_glass = flat_mat('moon_glass', 0x0b1520, metal=0.0, rough=0.04, alpha=0.1)
m_door  = flat_mat('moon_door', 0x1d4f73, metal=0.3, rough=0.5)   # Federation blue, so it reads as a door
m_amber = flat_mat('moon_status', 0xffb454, emit=0xffb454, emit_str=5.0)

def ring(name, mat, r0, r1, y0, y1, seg=96, gap=None):
    bm = bmesh.new(); vs = []
    for i in range(seg + 1):
        t = i / seg * 2 * math.pi
        vs.append([bm.verts.new(g2b(r * math.cos(t), y, r * math.sin(t))) for r, y in ((r0, y0), (r0, y1), (r1, y1), (r1, y0))])
    for i in range(seg):
        tm = (i + 0.5) / seg * 2 * math.pi
        if gap and abs((tm - gap[0] + math.pi) % (2 * math.pi) - math.pi) < gap[1]: continue
        a, b = vs[i], vs[i + 1]
        for k in range(4): bm.faces.new((a[k], b[k], b[(k + 1) % 4], a[(k + 1) % 4]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_obj(name, bm, mat)
DOOR_HALF = math.atan2(20, WALL_R)
ring('wall', m_panel, WALL_R, WALL_R + 5, FY - 4, WALL_TOP, gap=(AIRLOCK, DOOR_HALF))
ring('wallcap', m_steel, WALL_R - 0.6, WALL_R + 5.6, WALL_TOP, WALL_TOP + 1.6, gap=(AIRLOCK, DOOR_HALF))
ring('strip', m_strip, WALL_R - 0.9, WALL_R - 0.5, WALL_TOP - 3.2, WALL_TOP - 2.2, gap=(AIRLOCK, DOOR_HALF * 1.6))

def dome():
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=3, radius=DOME_R)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(9), 3, 'Z'), verts=bm.verts)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, 0), plane_no=(0, 0, 1), clear_inner=True)
    bmesh.ops.translate(bm, vec=(0, 0, WALL_TOP + 1.6), verts=bm.verts)
    return bm
glass = mesh_obj('glass', dome(), m_glass)
frame = mesh_obj('frame', dome(), m_steel)
wf = frame.modifiers.new('wf', 'WIREFRAME'); wf.thickness = 1.5; wf.use_even_offset = True; wf.use_boundary = True; wf.offset = 0
set_active(frame); bpy.ops.object.modifier_apply(modifier='wf')

# airlock: a door in the wall and a tunnel out through the glass
ca, sa = math.cos(AIRLOCK), math.sin(AIRLOCK); yaw = AIRLOCK
def at(r, y, side=0.0):   # game point at radius r along the airlock axis, `side` across it
    return (r * ca - side * sa, y, r * sa + side * ca)
box('doorframeL', m_steel, *at(WALL_R + 1, FY + 21, -20), 4, 42, 6, yaw=yaw + math.pi / 2)
box('doorframeR', m_steel, *at(WALL_R + 1, FY + 21, 20), 4, 42, 6, yaw=yaw + math.pi / 2)
box('doorframeT', m_steel, *at(WALL_R + 1, FY + 43, 0), 44, 4, 6, yaw=yaw + math.pi / 2)
box('door', m_door, *at(WALL_R + 2.5, FY + 20, 0), 36, 40, 1.5, yaw=yaw + math.pi / 2)
box('doorwindow', m_glass, *at(WALL_R + 1.6, FY + 30, 0), 10, 8, 0.4, yaw=yaw + math.pi / 2)
box('doorlight', m_amber, *at(WALL_R - 0.2, FY + 46.5, 0), 6, 1.4, 1.2, yaw=yaw + math.pi / 2)
box('tunnel', m_panel, *at(WALL_R + 38, FY + 22, 0), 48, 46, 72, yaw=yaw + math.pi / 2)
for k in (-1, 0, 1):
    box('tunnelrib%d' % k, m_steel, *at(WALL_R + 38 + k * 22, FY + 22, 0), 52, 50, 3, yaw=yaw + math.pi / 2)

# =============================================================================================
# 4. PROPS
# =============================================================================================
m_white = flat_mat('moon_suitwhite', 0xd6d8d3, rough=0.35)
m_visor = flat_mat('moon_visor', 0xb88a3a, metal=1.0, rough=0.12)
m_tank  = flat_mat('moon_tank', 0xb8621f, metal=0.3, rough=0.5)
m_flag  = flat_mat('moon_flag', 0x123f5e, rough=0.9)

for i, (lx, lz) in enumerate(LEGS):
    box('foot%d' % i, m_steel, lx, FY + 0.3, lz, 9, 0.6, 9)
    ox = 1 if lx > 0 else -1
    box('bracket%d' % i, m_steel, lx + ox * 2.35, FY + 3.2, lz, 0.7, 6, 5)

# bench along the wall beside the airlock, two helmets on it
bang = AIRLOCK + math.radians(24); bx, bz = (WALL_R - 12) * math.cos(bang), (WALL_R - 12) * math.sin(bang)
box('bench', m_steel, bx, FY + 9, bz, 44, 2, 12, yaw=bang + math.pi / 2)
for s in (-1, 1):
    box('benchleg%d' % s, m_steel, bx - s * 18 * math.sin(bang), FY + 4, bz + s * 18 * math.cos(bang), 2, 8, 10, yaw=bang + math.pi / 2)
for k, s in enumerate((-9, 8)):
    hx, hz = bx - s * math.sin(bang), bz + s * math.cos(bang)
    sphere('helmet%d' % k, m_white, (hx, FY + 16.2, hz), 5.2)
    cyl('collar%d' % k, m_steel, (hx, FY + 10, hz), (hx, FY + 12.2, hz), 4.4, 16)
    # the visor wraps the front half (a flattened sphere pushed forward), not a round "pupil"
    vx, vz = hx - 1.3 * math.cos(bang), hz - 1.3 * math.sin(bang)
    sphere('visor%d' % k, m_visor, (vx, FY + 16.8, vz), 4.6, squash=(0.9, 0.62, 0.9))
# O2 tanks in a rack on the other side of the door
tang = AIRLOCK - math.radians(22); tx, tz = (WALL_R - 8) * math.cos(tang), (WALL_R - 8) * math.sin(tang)
box('rack', m_steel, tx, FY + 14, tz, 26, 1.2, 5, yaw=tang + math.pi / 2)
for k in range(-1, 2):
    px_, pz_ = tx - k * 7 * math.sin(tang), tz + k * 7 * math.cos(tang)
    cyl('tank%d' % k, m_tank, (px_, FY, pz_), (px_, FY + 22, pz_), 2.6, 16)
    cyl('tankvalve%d' % k, m_steel, (px_, FY + 22, pz_), (px_, FY + 25, pz_), 1.0, 8)
# the Federation flag, planted outside where the home camera can see it
fr, fa_ = 245.0, math.radians(-112)
fx_, fz_ = fr * math.cos(fa_), fr * math.sin(fa_)
fy_ = float(height(np.array([[fx_]]), np.array([[fz_]]))[0][0, 0])
cyl('flagpole', m_steel, (fx_, fy_ - 3, fz_), (fx_, fy_ + 80, fz_), 1.5, 8)
cyl('flagbar', m_steel, (fx_, fy_ + 78, fz_), (fx_ + 32, fy_ + 78, fz_ + 5), 0.9, 8)
bm = bmesh.new()
cloth = [bm.verts.new(g2b(fx_ + 32 * t, fy_ + 78 - 20 * s, fz_ + 5 * t + 1.6 * math.sin(t * 7)))
         for s in (0, 1) for t in np.linspace(0, 1, 9)]
for i in range(8): bm.faces.new((cloth[i], cloth[i + 1], cloth[i + 10], cloth[i + 9]))
mesh_obj('flag', bm, m_flag)

# =============================================================================================
# 5. one mesh per material, export
# =============================================================================================
by_mat = {}
for o in list(col.objects):
    if o.type == 'MESH': by_mat.setdefault(o.data.materials[0].name, []).append(o)
for name, objs in by_mat.items():
    if len(objs) > 1: set_active(*objs); bpy.ops.object.join()
for o in col.objects: o.name = o.data.materials[0].name.replace('moon_', 'room_moon_')
tris = 0
for o in col.objects: o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
print('moon: %d meshes, %d tris' % (len(col.objects), tris))
for im in (im_ra, im_rn, im_fa, im_fn, im_fo): im.pack()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BUILD, 'moon_base.blend'))
set_active(*col.objects)
kw = dict(filepath=GLB, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
          export_lights=False, export_cameras=False)
try: bpy.ops.export_scene.gltf(export_vertex_color='ACTIVE', **kw)
except TypeError: bpy.ops.export_scene.gltf(**kw)
print('moon: wrote', GLB, '%.1f MB' % (os.path.getsize(GLB) / 1048576))
