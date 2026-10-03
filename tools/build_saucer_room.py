"""
build_saucer_room.py  --  Fuzeball FLYING SAUCER room -> GLB

    blender -b -P tools/build_saucer_room.py -- [--tex 2048] [--seed 8]
    node tools/ktx2-encode.mjs tools/build/saucer/fuzeball_room_saucer.raw.glb assets/rooms/saucer/fuzeball_room_saucer.glb

DIRECTION.md: rooms are venues people actually play in, small and a bit scruffy. This one is the bar
on the rim deck of a saucer, hanging over a ringed gas giant (build_saucer_sky.py). 1 game unit = 1 cm;
the table is 1.2 m, the room 4.2 m across.

LAYOUT (azimuth runs from +x toward +z, so the far wall the home camera looks at is -90)
    -157..-22   the bar: a curved counter, stools, a neon sign on its front, panoramic windows behind
    0           the entrance hatch (the +x end, seen from behind the red goal)
    180         a jukebox and, beside it, a trophy cabinet (the -x end)
    22..157     lockers, a bench, valves and portholes along the near wall
    centre      the table on a round dais, bolted down, with a stencilled Federation ring

WHAT IS IN IT (static, one mesh per material)
    hull       tiling wall texture (teal wainscot, cream upper, brass rail, rivets, chipped paint)
    deck       tiling tread plate for the outer floor, vertex-colour AO
    dais       one 2048 map for the round dais: plates, hazard edge, gold ring and stencil text
    glass      the window panes (alpha blend; the loader draws room glass first and never shadows it)
    props      flat PBR materials, emissive for lamps and neon (NO lights are exported)

Authored in GAME units (X long axis, Y up, Z width) and converted with g2b like the other room builders.
The room is lit by CONFIG.rooms.saucer.lights (pooled); the emissive parts only show up in the reflection bake.
"""
import bpy, bmesh, os, sys, math
import numpy as np
from mathutils import Vector, Matrix, noise

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(n, d): return type(d)(argv[argv.index(n) + 1]) if n in argv else d
TEX  = arg('--tex', 2048)
SEED = arg('--seed', 8)
ROOT  = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
BUILD = os.path.join(ROOT, 'tools', 'build', 'saucer')
os.makedirs(BUILD, exist_ok=True)
GLB = os.path.join(BUILD, 'fuzeball_room_saucer.raw.glb')
rng = np.random.default_rng(SEED)
TS = TEX / 2048.0

# ---- the numbers that matter (game units, 1 = 1 cm) --------------------------------------------
FY       = -44.0                  # dais top = the table's feet
STEP     = 8.0                    # dais step
FL       = FY - STEP              # outer floor
DAIS_R   = 104.0
WALL_R   = 208.0                  # wall inner face at the floor
LEAN     = 0.045                  # the wall leans in this much per unit of height
WALL_T   = 7.0
SILL, HEAD, SPRING, APEX = -6.0, 66.0, 118.0, 212.0
TILE_V   = SPRING - FL            # the hull texture covers the wall's whole height
HULL_TILES = 14
TILE_U   = 2 * math.pi * WALL_R / HULL_TILES
DECK_TILE = 64.0
LEGS     = [(sx * 58, sz * 32) for sx in (-1, 1) for sz in (-1, 1)]
PANE_CENTRES = [-157.5 + 15 * k for k in range(10)]     # window panes, 12 deg wide on a 15 deg pitch
SILL_LOW = -28.0                                         # the panoramic bay on the right of the far wall comes down to here
PANES = [(c, SILL_LOW if -90 < c < -30 else -6.0) for c in PANE_CENTRES]
PORTHOLES = [37.5, 67.5, 97.5, 142.5]
PH_Y, PH_R = 8.0, 22.0
def r_in(y): return WALL_R - LEAN * (y - FL)
def g2b(x, y, z): return Vector((x, -z, y))
R0 = r_in(SPRING)                 # the dome starts where the wall ends
def dome(t): a = t * math.pi / 2; return R0 * math.cos(a), SPRING + (APEX - SPRING) * math.sin(a)
def polar(r, th, y=0.0): t = math.radians(th); return (r * math.cos(t), y, r * math.sin(t))
def sstep(a, b, x): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
GLOW_W, GLOW_H = 1024, 384        # the glow atlas; regions are pixel boxes (x0, y0, x1, y1), y from the top
GA = {'sign': (0, 0, 1024, 256), 'warm': (0, 256, 128, 384), 'teal': (128, 256, 256, 384), 'strip': (256, 256, 768, 384), 'red': (768, 256, 896, 384)}
PAINT_W, PAINT_H = 1024, 512       # the paint atlas: worn markings and stains laid on the deck
PA = {'haz': (0, 0, 512, 192), 'stencil': (512, 0, 1024, 64), 'line': (512, 64, 1024, 96), 'stain': (0, 192, 256, 448), 'worn': (256, 192, 512, 448), 'spill': (512, 192, 768, 448)}
SIGN_X, SIGN_Y0, SIGN_Y1 = 85.3, 12.0, 54.7   # what the sign region covers: +-x cm along the arc, y cm above the deck

# ---- scene + materials -------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = bpy.data.collections.new('Saucer Room'); scene.collection.children.link(col)
def set_active(*objs):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[-1]
def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)
def hx(h): return np.array([((h >> s) & 255) / 255 for s in (16, 8, 0)])      # sRGB 0..1, for the image arrays
WEAR = {'img': None, 'mean': 1.0}      # the shared multiply map every non-emissive prop material wears (wear_texture)
def flat_mat(name, hexc, metal=0.0, rough=0.6, emit=None, emit_str=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    col = srgb(hexc)
    b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
    if emit is not None:
        b.inputs['Emission Color'].default_value = srgb(emit); b.inputs['Emission Strength'].default_value = emit_str
    if emit is None and WEAR['img'] is not None:                # colour x wear map; the colour is lifted by the map's mean so the material keeps its value
        a = nt.nodes.new('ShaderNodeTexImage'); a.image = WEAR['img']
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1.0
        ins = [i for i in mx.inputs if i.type == 'RGBA']
        nt.links.new(a.outputs['Color'], ins[0]); ins[1].default_value = tuple(min(1.0, c / WEAR['mean']) for c in col[:3]) + (1.0,)
        nt.links.new([o for o in mx.outputs if o.type == 'RGBA'][0], b.inputs['Base Color'])
    else:
        b.inputs['Base Color'].default_value = col
    m.diffuse_color = col; m.use_backface_culling = True
    return m
def new_img(name, w, h, data=False, alpha=False):
    im = bpy.data.images.new(name, w, h, alpha=alpha)
    im.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    return im
def np_img(im, arr, a=None):
    """arr row 0 = TOP of the picture (Blender's buffer starts at the bottom)."""
    h, w = arr.shape[:2]; rgba = np.ones((h, w, 4), np.float32); rgba[..., :3] = np.clip(arr, 0, 1)
    if a is not None: rgba[..., 3] = a
    im.pixels.foreach_set(rgba[::-1].ravel()); im.update()
    im.filepath_raw = os.path.join(BUILD, im.name + '.png'); im.file_format = 'PNG'; im.save()
def tex_mat(name, albedo, normal, orm, vcol=False, alpha_img=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']; m.use_backface_culling = alpha_img is None
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
    if normal is not None:
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = normal
        nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(n.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    if orm is not None:
        o = nt.nodes.new('ShaderNodeTexImage'); o.image = orm
        sp = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(o.outputs['Color'], sp.inputs['Color'])
        nt.links.new(sp.outputs['Green'], b.inputs['Roughness']); nt.links.new(sp.outputs['Blue'], b.inputs['Metallic'])
    if alpha_img:
        nt.links.new(a.outputs['Alpha'], b.inputs['Alpha'])
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
        try: m.blend_method = 'BLEND'
        except Exception: pass
    return m

def glow_mat(name, img):
    """Emits the atlas colour, blends by its alpha. Base colour is nearly black so the scene lights add almost nothing."""
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    a = nt.nodes.new('ShaderNodeTexImage'); a.image = img
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1.0
    ins = [i for i in mx.inputs if i.type == 'RGBA']; nt.links.new(a.outputs['Color'], ins[0]); ins[1].default_value = (0.04, 0.04, 0.04, 1.0)
    nt.links.new([o for o in mx.outputs if o.type == 'RGBA'][0], b.inputs['Base Color'])
    nt.links.new(a.outputs['Color'], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = 1.0
    nt.links.new(a.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = 1.0; b.inputs['Metallic'].default_value = 0.0
    try: m.surface_render_method = 'BLENDED'
    except Exception: pass
    try: m.blend_method = 'BLEND'
    except Exception: pass
    return m

def paint_mat(name, img):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    a = nt.nodes.new('ShaderNodeTexImage'); a.image = img
    nt.links.new(a.outputs['Color'], b.inputs['Base Color']); nt.links.new(a.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = 0.72; b.inputs['Metallic'].default_value = 0.0
    try: m.surface_render_method = 'BLENDED'
    except Exception: pass
    try: m.blend_method = 'BLEND'
    except Exception: pass
    return m

# ---- tileable noise + stroke drawing -----------------------------------------------------------
def tn(H, W, py, px, seed):
    g = np.random.default_rng(seed).random((py, px))
    ys = np.arange(H) / H * py; xs = np.arange(W) / W * px
    y0 = ys.astype(int); x0 = xs.astype(int); fy = ys - y0; fx = xs - x0
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx); y1 = (y0 + 1) % py; x1 = (x0 + 1) % px
    a = g[y0][:, x0] * (1 - fx)[None] + g[y0][:, x1] * fx[None]
    b = g[y1][:, x0] * (1 - fx)[None] + g[y1][:, x1] * fx[None]
    return a * (1 - fy)[:, None] + b * fy[:, None]
def tfbm(H, W, py, px, seed, octs=4, gain=0.5):
    out = np.zeros((H, W)); amp = 1.0; tot = 0.0
    for o in range(octs):
        out += amp * tn(H, W, py * 2 ** o, px * 2 ** o, seed + o * 31); tot += amp; amp *= gain
    return out / tot
def seg_aa(img, p0, p1, w, val=1.0):
    """Anti-aliased thick segment (pixel coords x,y) max-blended into img."""
    h, wd = img.shape
    x0, y0 = p0; x1, y1 = p1; pad = w + 2
    xa, xb = int(max(0, min(x0, x1) - pad)), int(min(wd, max(x0, x1) + pad + 1))
    ya, yb = int(max(0, min(y0, y1) - pad)), int(min(h, max(y0, y1) + pad + 1))
    if xb <= xa or yb <= ya: return
    X, Y = np.meshgrid(np.arange(xa, xb) + 0.5, np.arange(ya, yb) + 0.5)
    dx, dy = x1 - x0, y1 - y0; L2 = dx * dx + dy * dy + 1e-9
    t = np.clip(((X - x0) * dx + (Y - y0) * dy) / L2, 0, 1)
    d = np.hypot(X - (x0 + t * dx), Y - (y0 + t * dy))
    a = np.clip(w * 0.5 + 0.5 - d, 0, 1) * val
    img[ya:yb, xa:xb] = np.maximum(img[ya:yb, xa:xb], a)

# a stroke alphabet, angular like the logo: x 0..4, y 0..6, polylines. ADV = advance width
GLYPH = {
 'A': [[(0,0),(1.7,6),(2.3,6),(4,0)], [(0.9,2.3),(3.1,2.3)]],
 'B': [[(0,0),(0,6),(3,6),(4,5),(4,4),(3,3.2),(0,3.2)], [(3,3.2),(4,2.2),(4,1),(3,0),(0,0)]],
 'C': [[(4,5),(3,6),(1,6),(0,5),(0,1),(1,0),(3,0),(4,1)]],
 'D': [[(0,0),(0,6),(2.8,6),(4,4.8),(4,1.2),(2.8,0),(0,0)]],
 'E': [[(4,6),(0,6),(0,0),(4,0)], [(0,3.1),(3,3.1)]],
 'F': [[(4,6),(0,6),(0,0)], [(0,3.1),(3,3.1)]],
 'G': [[(4,5),(3,6),(1,6),(0,5),(0,1),(1,0),(3,0),(4,1),(4,3),(2.2,3)]],
 'H': [[(0,0),(0,6)], [(4,0),(4,6)], [(0,3.1),(4,3.1)]],
 'I': [[(0,0),(0,6)]],
 'K': [[(0,0),(0,6)], [(4,6),(0,2.8)], [(1.4,3.9),(4,0)]],
 'L': [[(0,6),(0,0),(4,0)]],
 'M': [[(0,0),(0,6),(2,3.6),(4,6),(4,0)]],
 'N': [[(0,0),(0,6),(4,0),(4,6)]],
 'O': [[(1,0),(0,1),(0,5),(1,6),(3,6),(4,5),(4,1),(3,0),(1,0)]],
 'P': [[(0,0),(0,6),(3,6),(4,5),(4,3.8),(3,2.8),(0,2.8)]],
 'R': [[(0,0),(0,6),(3,6),(4,5),(4,3.8),(3,2.9),(0,2.9)], [(2.2,2.9),(4,0)]],
 'S': [[(4,5),(3,6),(1,6),(0,5),(0,3.9),(1,3.1),(3,2.9),(4,2.1),(4,1),(3,0),(1,0),(0,1)]],
 'T': [[(0,6),(4,6)], [(2,6),(2,0)]],
 'U': [[(0,6),(0,1),(1,0),(3,0),(4,1),(4,6)]],
 'V': [[(0,6),(2,0),(4,6)]],
 'W': [[(0,6),(1,0),(2,3),(3,0),(4,6)]],
 'X': [[(0,6),(4,0)], [(4,6),(0,0)]],
 'Y': [[(0,6),(2,3.2),(4,6)], [(2,3.2),(2,0)]],
 'Z': [[(0,6),(4,6),(0,0),(4,0)]],
 '1': [[(0.5,4.8),(2,6),(2,0)]],
 '-': [[(0.5,3),(3.5,3)]],
 '.': [[(2,0),(2,0.5)]],
 '*': [[(2,2.2),(2,3.8)], [(1.2,2.6),(2.8,3.4)], [(1.2,3.4),(2.8,2.6)]],
}
ADV = {'I': 1.0, '.': 4.0, '1': 4.0, ' ': 3.0, '-': 4.0}
def glyph_adv(ch): return ADV.get(ch, 4.0)

def text_arc(alpha, text, R, centre_deg, height, track, sign, N, ext, stroke):
    """Stencil `text` on a ring of the dais map. sign +1: tops outward, reading with increasing azimuth;
    sign -1: tops inward, reading with decreasing azimuth. The text is centred on centre_deg."""
    s = height / 6.0
    adv = [(glyph_adv(c) + track) * s for c in text]
    total = sum(adv) - track * s
    pos = -total / 2
    for ch, a in zip(text, adv):
        if ch in GLYPH:
            gw = glyph_adv(ch) * s if ch != 'I' else 0.0
            tm = pos + gw / 2                                            # glyph centre along the arc
            th = math.radians(centre_deg) + sign * tm / R
            ur = np.array([math.cos(th), math.sin(th)]); ut = np.array([-math.sin(th), math.cos(th)])
            for pl in GLYPH[ch]:
                pts = []
                for gx, gy in pl:
                    lx = (gx - (2 if ch != 'I' else 0)) * s * sign       # along the reading direction
                    ly = (gy - 3) * s * sign                             # up the letter
                    c = ur * (R + ly) + ut * lx * 1.0
                    # glyph x follows +tangent for sign +1, -tangent for sign -1 (both fall out of lx's sign)
                    pts.append(((c[0] + ext) / (2 * ext) * N, (c[1] + ext) / (2 * ext) * N))
                for p0, p1 in zip(pts[:-1], pts[1:]): seg_aa(alpha, p0, p1, stroke)
        pos += a

# =============================================================================================
# TEXTURES
# =============================================================================================
def height_to_normal(Hf, px_x, px_y, k=1.0):
    gy, gx = np.gradient(Hf, px_y, px_x)
    n = np.stack([-gx * k, gy * k, np.ones_like(Hf)], -1)           # rows go DOWN the image, hence +gy
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5

def hull_textures(W, H):
    TW, TV = TILE_U, TILE_V
    xx = ((np.arange(W) + .5) / W * TW)[None, :] * np.ones((H, 1))
    yy = ((1 - (np.arange(H) + .5) / H) * TV)[:, None] * np.ones((1, W))
    PW = TW / 3.0
    Y = [0, 9, 46, 50, 84, 118, 144, 170]
    kind = np.zeros((H, W), int)
    for i in range(len(Y) - 1): kind[(yy >= Y[i]) & (yy < Y[i + 1])] = i
    off = np.where((kind == 4) | (kind == 6), PW / 2, 0.0)
    dv = np.abs(((xx - off + PW / 2) % PW) - PW / 2)
    dv = np.where(kind == 2, 99.0, dv)                                    # the rail is one strip
    dh = np.min(np.stack([np.abs(yy - y) for y in Y[1:-1]]), 0)
    dmin = np.minimum(dv, dh)
    panel = np.floor((xx - off) / PW).astype(int) * 7 + kind * 13
    ph = ((panel * 2654435761) % 1000) / 1000.0
    base = {0: hx(0x2b3034), 1: hx(0x357f8b), 2: hx(0xb98a35), 3: hx(0xcdbd98), 4: hx(0xc7b891), 5: hx(0x2d4d55), 6: hx(0x2d4d55)}
    alb = np.zeros((H, W, 3))
    for k, c in base.items(): alb[kind == k] = c
    alb *= (0.93 + 0.14 * ph)[..., None]
    mott = tfbm(H, W, 6, 4, SEED + 1, 5)
    alb *= (0.86 + 0.28 * mott)[..., None]
    # height: grooves at the seams, rivets beside them
    Hh = -0.5 * np.exp(-(dmin / 0.22) ** 2)
    Hh += 0.12 * np.exp(-((dmin - 0.7) / 0.3) ** 2)
    Hh += (tfbm(H, W, 12, 8, SEED + 2, 4) - 0.5) * 0.12
    pxu, pxv = TW / W, TV / H
    def rivet(cx, cy):
        rr = 0.7; ix, iy = int(cx / pxu), int((TV - cy) / pxv); wr = int(rr / pxu) + 2
        ya, yb, xa, xb = max(0, iy - wr), min(H, iy + wr + 1), max(0, ix - wr), min(W, ix + wr + 1)
        if yb <= ya or xb <= xa: return
        X = xx[ya:yb, xa:xb]; Yg = yy[ya:yb, xa:xb]; d2 = ((X - cx) ** 2 + (Yg - cy) ** 2) / (rr * rr)
        Hh[ya:yb, xa:xb] += 0.45 * np.sqrt(np.clip(1 - d2, 0, 1)); alb[ya:yb, xa:xb] *= (1 - 0.18 * np.clip(1 - d2 * 0.6, 0, 1))[..., None]
    for i in range(len(Y) - 1):
        if i == 2: continue
        y0, y1 = Y[i], Y[i + 1]
        o = PW / 2 if i in (4, 6) else 0.0
        for k in range(3):
            sx = k * PW + o
            for yv in np.arange(y0 + 3.5, y1 - 2, 7.0):
                for dx in (-1.5, 1.5): rivet((sx + dx) % TW, yv)
        for sy in (y0, y1):
            for xv in np.arange(3.0, TW, 6.2):
                for dy in (-1.5, 1.5):
                    if y0 <= sy + dy <= y1: rivet(xv, sy + dy)
    # wear: chips near seams and the floor, rust under the rivets, scuffs, grime
    chip_n = tfbm(H, W, 40, 24, SEED + 3, 5)
    score = chip_n + 0.26 * np.exp(-dmin / 1.4) + 0.2 * np.exp(-yy / 12.0) + 0.04 * (kind == 1) - 0.8
    chip = sstep(0.0, 0.05, score) * (kind != 2)
    prime = np.where((tfbm(H, W, 8, 5, SEED + 4, 3) > 0.5)[..., None], hx(0x7a4a36), hx(0x868a8c))
    alb = alb * (1 - chip[..., None]) + prime * chip[..., None]
    streak = tfbm(H, W, 3, 36, SEED + 5, 4, 0.6)
    rust = sstep(0.6, 0.78, streak) * np.clip(np.exp(-dv / 1.8) * 0.7 + np.exp(-dh / 2.0) * 0.35, 0, 1) * (kind != 2) * (1 - chip)
    alb = alb * (1 - 0.6 * rust[..., None]) + hx(0x7d3f1b) * 0.6 * rust[..., None]
    grime = tfbm(H, W, 5, 3, SEED + 6, 4)
    alb *= (0.8 + 0.3 * grime)[..., None]
    scr = np.zeros((H, W))
    for _ in range(int(260 * TS + 40)):
        x = rng.uniform(0, W); y = rng.uniform(0, H * (46.0 / TV) * 1.4); a = rng.uniform(0, math.pi); l = rng.uniform(6, 34) * TS * 2
        seg_aa(scr, (x, y), (x + l * math.cos(a), y + l * math.sin(a) * 0.5), 1.0, rng.uniform(0.2, 0.7))
    alb = alb * (1 - 0.35 * scr[..., None]) + 0.35 * scr[..., None] * 0.9
    rough = np.where(kind == 2, 0.34, 0.62) + 0.14 * (tfbm(H, W, 20, 12, SEED + 7, 3) - 0.5)
    rough = np.where(chip > 0.5, 0.42, rough)
    metal = np.where(kind == 2, 1.0, 0.0); metal = np.maximum(metal, chip * np.where(prime[..., 1] > 0.4, 1.0, 0.2))
    ao = 1 - 0.55 * np.exp(-(dmin / 0.5) ** 2) - 0.25 * np.exp(-((dmin - 1.5) / 1.2) ** 2) * 0
    orm = np.stack([np.clip(ao, 0, 1), np.clip(rough, 0, 1), np.clip(metal, 0, 1)], -1)
    return np.clip(alb, 0, 1), height_to_normal(Hh, pxu, pxv, 1.0), orm

def tread_textures(N):
    T = DECK_TILE
    xx = ((np.arange(N) + .5) / N * T)[None, :] * np.ones((N, 1))
    yy = ((np.arange(N) + .5) / N * T)[:, None] * np.ones((1, N))
    cell = T / 10.0
    ix = np.floor(xx / cell).astype(int); iy = np.floor(yy / cell).astype(int)
    lx = (xx % cell) - cell / 2; ly = (yy % cell) - cell / 2
    flip = ((ix + iy) % 2 == 0)
    c, s = math.cos(math.radians(45)), math.sin(math.radians(45))
    u = np.where(flip, lx * c + ly * s, lx * c - ly * s); v = np.where(flip, -lx * s + ly * c, lx * s + ly * c)
    lug = np.clip(1 - (u / 2.7) ** 2 - (v / 0.85) ** 2, 0, 1) ** 0.6
    Hh = 0.5 * lug + (tfbm(N, N, 10, 10, SEED + 11, 4) - 0.5) * 0.15
    wear = sstep(0.35, 0.8, tfbm(N, N, 6, 6, SEED + 12, 5))
    base = hx(0x363d42) * (0.85 + 0.3 * tfbm(N, N, 4, 4, SEED + 13, 4))[..., None]
    top = hx(0x7a858c)
    alb = base * (1 - (lug * (0.45 + 0.55 * wear))[..., None]) + top * (lug * (0.45 + 0.55 * wear))[..., None]
    alb *= (0.85 + 0.25 * tfbm(N, N, 3, 3, SEED + 14, 3))[..., None]
    grime = sstep(0.55, 0.8, tfbm(N, N, 14, 14, SEED + 15, 5)) * (1 - lug)
    alb = alb * (1 - 0.55 * grime[..., None])
    rust = sstep(0.68, 0.84, tfbm(N, N, 9, 9, SEED + 16, 5))
    alb = alb * (1 - 0.5 * rust[..., None]) + hx(0x6d3a1c) * 0.5 * rust[..., None]
    scr = np.zeros((N, N))
    for _ in range(int(220 * TS + 60)):
        x = rng.uniform(0, N); y = rng.uniform(0, N); a = rng.uniform(0, math.pi); l = rng.uniform(10, 60) * TS * 2
        seg_aa(scr, (x, y), (x + l * math.cos(a), y + l * math.sin(a)), 1.0, rng.uniform(0.15, 0.5))
    alb = alb * (1 - 0.3 * scr[..., None]) + 0.3 * scr[..., None] * 0.8
    rough = 0.62 - 0.28 * lug * wear + 0.12 * grime
    metal = 0.35 + 0.55 * lug * wear
    ao = 1 - 0.5 * (1 - lug) * 0.6
    orm = np.stack([np.clip(ao, 0, 1), np.clip(rough, 0, 1), np.clip(metal, 0, 1)], -1)
    return np.clip(alb, 0, 1), height_to_normal(Hh, T / N, T / N, 2.2), orm

def dais_textures(N):
    R = DAIS_R + 2; ext = R
    X = ((np.arange(N) + .5) / N * 2 - 1)[None, :] * ext * np.ones((N, 1))
    Z = ((np.arange(N) + .5) / N * 2 - 1)[:, None] * ext * np.ones((1, N))
    Rr = np.hypot(X, Z); Th = np.arctan2(Z, X)
    plate = tfbm(N, N, 8, 8, SEED + 21, 4)
    brushed = tfbm(N, N, 3, 220, SEED + 22, 3, 0.6)
    alb = hx(0x626d72)[None, None] * (0.88 + 0.16 * plate + 0.08 * (brushed - 0.5))[..., None]
    Hh = (brushed - 0.5) * 0.05 + (tfbm(N, N, 14, 14, SEED + 23, 4) - 0.5) * 0.05
    # deck plates: 52 x 52, a seam, four bolts a corner
    T = 52.0
    dx = np.abs(((X + T / 2) % T) - T / 2); dz = np.abs(((Z + T / 2) % T) - T / 2)
    seam = np.minimum(dx, dz)
    Hh += -0.35 * np.exp(-(seam / 0.28) ** 2)
    alb *= (1 - 0.45 * np.exp(-(seam / 0.45) ** 2))[..., None]
    pid = (np.floor((X + T / 2) / T) * 5 + np.floor((Z + T / 2) / T) * 11) % 7
    alb *= (0.94 + 0.012 * pid)[..., None]
    px = 2 * ext / N
    def bolt(cx, cz, r=0.9):
        ix, iz = int((cx + ext) / px), int((cz + ext) / px); wr = int(r / px) + 2
        ya, yb, xa, xb = max(0, iz - wr), min(N, iz + wr + 1), max(0, ix - wr), min(N, ix + wr + 1)
        if yb <= ya or xb <= xa: return
        d2 = ((X[ya:yb, xa:xb] - cx) ** 2 + (Z[ya:yb, xa:xb] - cz) ** 2) / (r * r)
        Hh[ya:yb, xa:xb] += 0.5 * np.sqrt(np.clip(1 - d2, 0, 1)); alb[ya:yb, xa:xb] *= (1 - 0.3 * np.clip(1 - d2 * 0.7, 0, 1))[..., None]
    for gx in np.arange(-T * 2, T * 2.1, T):
        for gz in np.arange(-T * 2, T * 2.1, T):
            for ox in (-1, 1):
                for oz in (-1, 1):
                    cx, cz = gx + ox * (T / 2 - 3.2), gz + oz * (T / 2 - 3.2)
                    if math.hypot(cx, cz) < DAIS_R - 7: bolt(cx, cz)
    # paint: hazard edge, white keyline, gold ring, thin inner ring
    inside = Rr < DAIS_R
    stripe = ((X + Z) * 0.5 / 3.4) % 2.0 < 1.0
    haz = (Rr >= DAIS_R - 4.2) & (Rr < DAIS_R)
    alb = np.where(haz[..., None], np.where(stripe[..., None], hx(0xe3a93a), hx(0x16191b)), alb)
    keyline = ((Rr >= DAIS_R - 6.4) & (Rr < DAIS_R - 5.2))
    gold = hx(0xe0a840)
    ring = (Rr >= 80.0) & (Rr < 81.4)
    ring2 = (Rr >= 77.6) & (Rr < 78.2)
    paint = np.zeros((N, N))
    for m in (keyline, ring, ring2): paint = np.maximum(paint, m * 1.0)
    # stencil text on the far half, the other way up on the near half
    tx = np.zeros((N, N)); SW = 1.05 * N / (2 * ext)
    text_arc(tx, 'FUZEBALL * FEDERATION * OFFICIAL VENUE', 91.0, -90.0, 6.4, 0.9, 1, N, ext, SW)
    text_arc(tx, 'SANCTIONED - NO DRINKS ON THE TABLE', 91.0, 90.0, 6.4, 0.9, -1, N, ext, SW)
    text_arc(tx, 'HOME', 91.0, 180.0, 6.4, 1.5, 1, N, ext, SW)
    text_arc(tx, 'AWAY', 91.0, 0.0, 6.4, 1.5, 1, N, ext, SW)
    paint = np.maximum(paint, tx)
    # the paint is worn: gone where boots go and flaked at random
    wearp = sstep(0.5, 0.85, tfbm(N, N, 22, 22, SEED + 24, 5)) * 0.8
    foot = np.exp(-(((np.abs(X) - 0) / 46.0) ** 2 + ((np.abs(Z) - 79) / 10.0) ** 2)) * 0.6
    paint *= (1 - np.clip(wearp + foot, 0, 0.95))
    alb = alb * (1 - paint[..., None] * 0.95) + (gold * (0.9 + 0.1 * plate[..., None])) * paint[..., None] * 0.95
    # a hazard edge and paint are matte, bare plate is shinier where boots polished it
    polish = np.exp(-(((np.abs(X)) / 52.0) ** 2 + ((np.abs(Z) - 79) / 14.0) ** 2))
    alb *= (1 - 0.1 * polish)[..., None]
    # scuffs, stains, a dried puddle
    scr = np.zeros((N, N))
    for _ in range(int(500 * TS + 120)):
        a0 = rng.uniform(0, 2 * math.pi); rr = rng.uniform(10, DAIS_R - 8)
        cx, cz = rr * math.cos(a0), rr * math.sin(a0); a = rng.uniform(0, math.pi); l = rng.uniform(1.5, 8)
        seg_aa(scr, ((cx + ext) / px, (cz + ext) / px), ((cx + l * math.cos(a) + ext) / px, (cz + l * math.sin(a) + ext) / px), 1.0, rng.uniform(0.1, 0.5))
    alb = alb * (1 - 0.25 * scr[..., None]) + 0.25 * scr[..., None] * 0.85
    stain = sstep(0.62, 0.78, tfbm(N, N, 10, 10, SEED + 25, 5)) * 0.4
    alb *= (1 - stain)[..., None]
    for (cx, cz, r) in ((-30, 62, 6.5), (74, -56, 4.5), (-82, -30, 5.5)):          # drink rings
        d = np.hypot(X - cx, Z - cz)
        alb *= (1 - 0.25 * np.exp(-((d - r) / 0.6) ** 2))[..., None]
    # contact shadow of the table and its feet; leg plates
    soft = lambda t, a, w: 1 - sstep(a - w, a + w, t)
    ao = 0.34 * soft(np.abs(X), 63, 16) * soft(np.abs(Z), 37, 16)
    for lx, lz in LEGS: ao += 0.35 * np.exp(-((X - lx) ** 2 + (Z - lz) ** 2) / (2 * 3.0 ** 2))
    ao += 0.30 * (Rr > DAIS_R - 1.5) * sstep(DAIS_R - 1.5, DAIS_R, Rr)
    alb *= (1 - np.clip(ao, 0, 0.75))[..., None]
    for lx, lz in LEGS:
        plate_m = (np.abs(X - lx) < 6) & (np.abs(Z - lz) < 6)
        alb = np.where(plate_m[..., None], hx(0x7f8a90) * (0.9 + 0.1 * plate[..., None]), alb)
        for bx in (-4.2, 4.2):
            for bz in (-4.2, 4.2): bolt(lx + bx, lz + bz, 0.8)
        Hh += 0.35 * plate_m
    rough = 0.52 + 0.18 * (1 - polish) - 0.14 * polish + 0.2 * stain
    rough = np.where(paint > 0.3, 0.62, rough)
    metal = np.where(paint > 0.3, 0.1, 0.8) - 0.25 * stain
    ao_t = 1 - np.clip(ao * 0.6, 0, 0.6)
    orm = np.stack([ao_t, np.clip(rough, 0, 1), np.clip(metal, 0, 1)], -1)
    alb = np.where(inside[..., None], alb, hx(0x16191b)[None, None])
    return np.clip(alb, 0, 1), height_to_normal(Hh, px, px, 1.6), orm

def glass_texture(W, H):
    xx = (np.arange(W) + .5) / W; yy = (np.arange(H) + .5) / H
    X, Y = np.meshgrid(xx, yy)
    edge = np.minimum(np.minimum(X, 1 - X) * 1.6, np.minimum(Y, 1 - Y) * 3.2)
    dirt = np.exp(-edge * 7.0) * (0.45 + 0.4 * tfbm(H, W, 6, 12, SEED + 31, 4))
    streak = np.zeros_like(X)
    for c, w, a in ((0.22, 0.035, 0.30), (0.30, 0.012, 0.18), (0.72, 0.05, 0.2)):
        d = (X + Y * 0.55) - (c + 0.55 * 0.5)
        streak = np.maximum(streak, a * np.exp(-(d / w) ** 2))
    smear = sstep(0.55, 0.8, tfbm(H, W, 3, 14, SEED + 32, 4)) * 0.18
    a = np.clip(0.06 + 0.30 * dirt + 0.26 * streak + smear * 0.6, 0, 0.6)
    rgb = np.stack([0.55 + 0.4 * streak, 0.68 + 0.3 * streak, 0.72 + 0.26 * streak], -1) * (1 - 0.7 * dirt[..., None])
    return np.clip(rgb, 0, 1), a

def gblur(a, s):
    fy = np.fft.fftfreq(a.shape[0])[:, None]; fx = np.fft.rfftfreq(a.shape[1])[None, :]
    return np.fft.irfft2(np.fft.rfft2(a) * np.exp(-2 * (math.pi * s) ** 2 * (fx * fx + fy * fy)), s=a.shape)
def glow_texture():
    """RGBA atlas of soft glows (regions in GA): the colour is the glow's own, the alpha is how much of it shows."""
    img = np.zeros((GLOW_H, GLOW_W, 4), np.float32)
    def fill(reg, rgb, a):
        x0, y0, x1, y1 = GA[reg]; img[y0:y1, x0:x1, :3] = rgb; img[y0:y1, x0:x1, 3] = a
    x0, y0, x1, y1 = GA['sign']; rw, rh = x1 - x0, y1 - y0; ppc = rw / (2 * SIGN_X)
    def px(xc, yc): return (xc + SIGN_X) * ppc, (SIGN_Y1 - yc) * ppc
    ink = np.zeros((rh, rw)); ink2 = np.zeros((rh, rw)); s = TH_ / 6.0; total = text_width(TXT, TH_, TRK); pos = 0.0
    for ch in TXT:
        c0 = 2 * s if ch != 'I' else 0.0
        if ch in GLYPH:
            xc = pos + c0 - total / 2
            for pl in GLYPH[ch]:
                pts = [px(xc - c0 + gx * s, 24.0 + gy * s) for gx, gy in pl]
                for p0, p1 in zip(pts[:-1], pts[1:]): seg_aa(ink, p0, p1, 6.0)
        pos += (glyph_adv(ch) + TRK) * s
    seg_aa(ink2, px(-47.8, 20.2), px(47.8, 20.2), 5.0)
    def halo(m, k): return 1 - np.exp(-(k[0] * gblur(m, 3.5) + k[1] * gblur(m, 11) + k[2] * gblur(m, 28)))
    aT = halo(ink, (2.2, 3.0, 4.2)) * 0.82; aU = halo(ink2, (2.0, 2.6, 3.6)) * 0.7
    aS = np.maximum(aT, aU); wT = aT / (aT + aU + 1e-6)
    cT = np.array([1.0, 0.56, 0.16]); cU = np.array([0.25, 0.95, 0.80])
    img[y0:y1, x0:x1, :3] = (cT[None, None] * wT[..., None] + cU[None, None] * (1 - wT[..., None])); img[y0:y1, x0:x1, 3] = aS
    for reg, rgb in (('warm', (1.0, 0.74, 0.42)), ('teal', (0.30, 1.0, 0.85)), ('red', (1.0, 0.30, 0.20))):
        a0, b0, a1, b1 = GA[reg]; n = a1 - a0; yy, xx = np.mgrid[0:n, 0:n]; d = np.hypot((xx + .5) / n - .5, (yy + .5) / n - .5) * 2
        fill(reg, rgb, (np.exp(-(d / 0.42) ** 2) * 0.75 + np.exp(-(d / 0.8) ** 2) * 0.28) * (1 - sstep(0.7, 1.0, d)))
    a0, b0, a1, b1 = GA['strip']; yy, xx = np.mgrid[0:b1 - b0, 0:a1 - a0]; u = (xx + .5) / (a1 - a0); v = 1 - (yy + .5) / (b1 - b0)
    fill('strip', (0.30, 0.92, 0.85), np.exp(-((v - 0.80) / 0.26) ** 2) * 0.26 * sstep(0, 0.1, u) * (1 - sstep(0.9, 1.0, u)))
    rgb = img[..., :3]; empty = img[..., 3] < 1e-3
    for c in range(3): rgb[..., c] = np.where(empty, 0.7, rgb[..., c])                       # no dark fringes when the sampler blends
    return np.clip(img, 0, 1)
def paint_texture():
    """RGBA atlas of floor paint: hazard stripes, a stencil, a lane line, oil and drink stains, a polished foot-path. Always worn through in patches."""
    img = np.zeros((PAINT_H, PAINT_W, 4), np.float32)
    def box(reg): x0, y0, x1, y1 = PA[reg]; return x0, y0, x1, y1
    def wear(h, w, seed, lo=0.50, hi=0.62): return 1 - 0.9 * sstep(lo, hi, tfbm(h, w, 7, 14, seed, 5))
    def put_rgba(reg, rgb, a):
        x0, y0, x1, y1 = box(reg); img[y0:y1, x0:x1, :3] = rgb; img[y0:y1, x0:x1, 3] = a
    x0, y0, x1, y1 = box('haz'); h, w = y1 - y0, x1 - x0; yy, xx = np.mgrid[0:h, 0:w]
    stripe = (((xx + yy) / 30.0) % 2.0) < 1.0
    inside = (xx > 5) & (xx < w - 5) & (yy > 5) & (yy < h - 5)
    rgb = np.where(stripe[..., None], np.array([0.86, 0.66, 0.13]), np.array([0.07, 0.08, 0.09]))
    put_rgba('haz', rgb, inside * wear(h, w, SEED + 61) * (0.9 + 0.1 * tfbm(h, w, 30, 30, SEED + 62, 2)))
    x0, y0, x1, y1 = box('stencil'); h, w = y1 - y0, x1 - x0; ink = np.zeros((h, w)); s_ = 36.0 / 6.0; tot = text_width('KEEP CLEAR', 36.0, 1.4); pos = (w - tot) / 2
    for ch in 'KEEP CLEAR':
        if ch in GLYPH:
            for pl in GLYPH[ch]:
                pts = [(pos + gx * s_, h - 10 - gy * s_) for gx, gy in pl]
                for p0, p1 in zip(pts[:-1], pts[1:]): seg_aa(ink, p0, p1, 5.0)
        pos += (glyph_adv(ch) + 1.4) * s_
    put_rgba('stencil', np.array([0.88, 0.72, 0.18]), ink * wear(h, w, SEED + 63, 0.46, 0.58))
    x0, y0, x1, y1 = box('line'); h, w = y1 - y0, x1 - x0; yy, xx = np.mgrid[0:h, 0:w]
    put_rgba('line', np.array([0.88, 0.70, 0.16]), ((yy > 6) & (yy < h - 6)) * wear(h, w, SEED + 64, 0.46, 0.58))
    for reg, seed, col, k in (('stain', SEED + 65, (0.035, 0.03, 0.028), 0.62), ('spill', SEED + 66, (0.22, 0.11, 0.04), 0.5)):
        x0, y0, x1, y1 = box(reg); h, w = y1 - y0, x1 - x0; yy, xx = np.mgrid[0:h, 0:w]; fld = np.zeros((h, w))
        g = np.random.default_rng(seed)
        for _ in range(4):
            cx, cy, r = g.uniform(0.25, 0.75) * w, g.uniform(0.25, 0.75) * h, g.uniform(0.12, 0.28) * w
            fld = np.maximum(fld, 1 - np.hypot(xx - cx, yy - cy) / r)
        fld += 0.35 * (tfbm(h, w, 6, 6, seed + 1, 4) - 0.5)
        edge = sstep(0.12, 0.30, fld)
        ring = np.exp(-((fld - 0.18) / 0.05) ** 2) * (0.4 if reg == 'spill' else 0.0)
        put_rgba(reg, np.array(col), np.clip(edge * k + ring, 0, 1) * 0.9)
    x0, y0, x1, y1 = box('worn'); h, w = y1 - y0, x1 - x0; yy, xx = np.mgrid[0:h, 0:w]; v = 1 - (yy + .5) / h
    put_rgba('worn', np.array([0.70, 0.74, 0.76]), np.exp(-((v - 0.5) / 0.22) ** 2) * 0.22 * (0.45 + 0.9 * tfbm(h, w, 5, 9, SEED + 67, 4)) * sstep(0, 0.12, xx / w) * (1 - sstep(0.88, 1.0, xx / w)))
    rgb_ = img[..., :3]; empty = img[..., 3] < 1e-3
    for c in range(3): rgb_[..., c] = np.where(empty, 0.3, rgb_[..., c])
    return np.clip(img, 0, 1)
WEAR_TILE = 26.0                                             # cm one repeat of the wear map covers on a prop
def seg_wrap(img, p0, p1, w, val):
    N = img.shape[0]
    for ox in (-N, 0, N):
        for oy in (-N, 0, N):
            if min(p0[0], p1[0]) + ox > N + 4 or max(p0[0], p1[0]) + ox < -4 or min(p0[1], p1[1]) + oy > N + 4 or max(p0[1], p1[1]) + oy < -4: continue
            seg_aa(img, (p0[0] + ox, p0[1] + oy), (p1[0] + ox, p1[1] + oy), w, val)
def wear_texture(N):
    """Linear-light multiply map for flat props: smudges, pitting, scuffs and a few bright scratches. Tiles seamlessly."""
    smudge = sstep(0.52, 0.80, tfbm(N, N, 5, 5, SEED + 41, 5))
    fine = tfbm(N, N, 60, 60, SEED + 42, 3)
    pits = sstep(0.62, 0.74, tfbm(N, N, 90, 90, SEED + 43, 2)) * 0.55
    streak = sstep(0.55, 0.85, tfbm(N, N, 2, 22, SEED + 44, 3, 0.55))
    dark = np.zeros((N, N)); light = np.zeros((N, N))
    for _ in range(int(210 * TS + 60)):
        x = rng.uniform(0, N); y = rng.uniform(0, N); a = rng.uniform(0, math.pi); l = rng.uniform(8, 70) * TS * 2
        seg_wrap(light if rng.random() < 0.6 else dark, (x, y), (x + l * math.cos(a), y + l * math.sin(a)), 1.0, rng.uniform(0.25, 0.8))
    W = 0.80 - 0.20 * smudge - 0.14 * streak * (0.4 + 0.6 * smudge) - 0.22 * pits + 0.06 * (fine - 0.5) * 2
    W = W + 0.20 * light - 0.22 * dark
    W = np.clip(W, 0.22, 1.0)
    tint = np.stack([W * (1 - 0.00 * smudge), W * (1 - 0.03 * smudge - 0.01), W * (1 - 0.10 * smudge)], -1)
    mean = float(W.mean())
    srgb_e = np.where(tint <= 0.0031308, tint * 12.92, 1.055 * np.power(np.clip(tint, 1e-6, 1), 1 / 2.4) - 0.055)
    return np.clip(srgb_e, 0, 1), mean

# =============================================================================================
# GEOMETRY ACCUMULATORS AND PRIMITIVES (local space: x = along the wall, y = out toward the wall, z = up)
# =============================================================================================
SECS = {}; _sec = ['setup', 0]
def acc_tris(): return sum(sum(len(f) - 2 for f in A.F) for A in ACC.values())
def sec(name):
    """Name the section about to be built; the build prints each section's triangles at the end."""
    t = acc_tris(); SECS[_sec[0]] = SECS.get(_sec[0], 0) + t - _sec[1]; _sec[0] = name; _sec[1] = t
class Acc:
    def __init__(s): s.V, s.F, s.S = [], [], []
    def add(s, M, parts):
        for V, F, sm in parts:
            o = len(s.V); s.V.extend((M @ v) for v in V); s.F.extend(tuple(o + i for i in f) for f in F); s.S.extend([sm] * len(F))
ACC = {}
def acc(name): return ACC.setdefault(name, Acc())
def put(name, M, parts): acc(name).add(M, parts)

def frame(x, y, z, yaw_deg, up=0.0):
    """Local (a = tangent, b = radial out, h = up) -> Blender. yaw = azimuth the b axis points along."""
    t = math.radians(yaw_deg)
    ta = Vector((-math.sin(t), 0, math.cos(t))); rb = Vector((math.cos(t), 0, math.sin(t)))
    cols = [g2b(*ta), g2b(*rb), g2b(0, 1, 0)]
    M = Matrix([[cols[0][i], cols[1][i], cols[2][i], 0] for i in range(3)] + [[0, 0, 0, 1]])
    M.translation = g2b(x, y, z)
    return M
def at_polar(th, r, y, yaw=None): x, yy, z = polar(r, th, y); return frame(x, yy, z, th if yaw is None else yaw)
def loc(a=0, b=0, h=0): return Matrix.Translation((a, b, h))
def rotz(deg): return Matrix.Rotation(math.radians(deg), 4, 'Z')
def rotx(deg): return Matrix.Rotation(math.radians(deg), 4, 'X')
def roty(deg): return Matrix.Rotation(math.radians(deg), 4, 'Y')

def p_box(sx, sy, sz, bevel=0.0, cz=0.0):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz + cz))
    if bevel > 0: bmesh.ops.bevel(bm, geom=bm.edges[:], offset=min(bevel, min(sx, sy, sz) * 0.45), segments=1, affect='EDGES')
    idx = {v: i for i, v in enumerate(bm.verts)}
    V = [v.co.copy() for v in bm.verts]; F = [tuple(idx[v] for v in f.verts) for f in bm.faces]; bm.free()
    return [(V, F, False)]
def p_lathe(profile, seg=16, smooth=True):
    """profile: list of polylines [(r, z), ...] swept about the z axis; each polyline has its own vertices (hard edges between them)."""
    parts = []
    for pl in profile:
        V, F = [], []; rows = []
        for r, z in pl:
            if r < 1e-6: rows.append([len(V)]); V.append(Vector((0, 0, z)))
            else:
                rows.append(list(range(len(V), len(V) + seg)))
                for k in range(seg): a = 2 * math.pi * k / seg; V.append(Vector((r * math.cos(a), r * math.sin(a), z)))
        for a, b in zip(rows[:-1], rows[1:]):
            for k in range(seg):
                k2 = (k + 1) % seg
                if len(a) == 1 and len(b) == 1: continue
                if len(a) == 1: F.append((a[0], b[k2], b[k]))
                elif len(b) == 1: F.append((a[k], a[k2], b[0]))
                else: F.append((a[k], a[k2], b[k2], b[k]))
        parts.append((V, F, smooth))
    return parts
def p_cyl(r, h, seg=16, r2=None, cz=0.0, caps=True):
    r2 = r if r2 is None else r2
    prof = [[(r, cz - h / 2), (r2, cz + h / 2)]]
    if caps: prof += [[(0, cz - h / 2), (r, cz - h / 2)], [(r2, cz + h / 2), (0, cz + h / 2)]]
    parts = p_lathe(prof, seg)
    parts = [(V, F, True) for V, F, _ in parts[:1]] + [(V, F, False) for V, F, _ in parts[1:]]
    return parts
def p_sphere(r, seg=14, rings=9, squash=1.0, cz=0.0):
    pl = [(r * math.sin(math.pi * i / rings), cz - r * squash * math.cos(math.pi * i / rings)) for i in range(rings + 1)]
    return p_lathe([pl], seg)
def p_torus(R, r, seg=24, rseg=8, cz=0.0):
    pl = [(R + r * math.cos(2 * math.pi * i / rseg), cz + r * math.sin(2 * math.pi * i / rseg)) for i in range(rseg + 1)]
    return p_lathe([pl], seg)
def catmull(pts, n=6):
    P = [np.array(p, float) for p in pts]; out = []
    P = [P[0]] + P + [P[-1]]
    for i in range(1, len(P) - 2):
        for k in range(n):
            t = k / n; t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * P[i]) + (-P[i - 1] + P[i + 1]) * t + (2 * P[i - 1] - 5 * P[i] + 4 * P[i + 1] - P[i + 2]) * t2 + (-P[i - 1] + 3 * P[i] - 3 * P[i + 1] + P[i + 2]) * t3))
    out.append(P[-2]); return [Vector(p) for p in out]
def p_tube(pts, r, seg=6, caps=True, smooth_pts=0):
    """A round tube along local points (Vector or tuple)."""
    pts = [Vector(p) for p in pts]
    if smooth_pts: pts = catmull(pts, smooth_pts)
    V, F = [], []; prev = None; rings = []
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if prev is None:
            ref = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0)); n1 = d.cross(ref).normalized()
        else:
            n1 = (prev - d * prev.dot(d)); n1 = n1.normalized() if n1.length > 1e-6 else d.orthogonal().normalized()
        n2 = d.cross(n1).normalized(); prev = n1
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg; ring.append(len(V)); V.append(p + (n1 * math.cos(a) + n2 * math.sin(a)) * r)
        rings.append(ring)
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(seg): k2 = (k + 1) % seg; F.append((a[k], a[k2], b[k2], b[k]))
    parts = [(V, F, True)]
    if caps:
        for ring, flip in ((rings[0], True), (rings[-1], False)):
            cv = [V[i] for i in ring]; c0 = len(cv)
            parts.append((cv + [sum(cv, Vector()) / len(cv)], [((k + 1) % seg, k, seg) if flip else (k, (k + 1) % seg, seg) for k in range(seg)], False))
    return parts
def p_rbox(sx, sy, sz, r, n=2, cz=0.0):
    """A box with rounded edges: the bands are smooth, each big flat face is its own quad so it shades flat."""
    h = (sx / 2, sy / 2, sz / 2); r = min(r, 0.9 * min(h)); i = [a - r for a in h]
    def grid(ia): return sorted(set([round(-(ia + r * k / n), 5) for k in range(n + 1)] + [round(ia + r * k / n, 5) for k in range(n + 1)]))
    def surf(c):
        q = Vector([max(-i[k], min(i[k], c[k])) for k in range(3)]); d = Vector(c) - q
        return q + d.normalized() * r if d.length > 1e-9 else Vector(c)
    Vb, Fb, idx = [], [], {}
    def vid(p):
        k = (round(p.x, 4), round(p.y, 4), round(p.z, 4))
        if k not in idx: idx[k] = len(Vb); Vb.append(Vector((p.x, p.y, p.z + cz)))
        return idx[k]
    Vf, Ff = [], []
    for ax in range(3):
        ua, va = [(1, 2), (2, 0), (0, 1)][ax]
        for sg in (1, -1):
            U = grid(i[ua]); W = grid(i[va])
            def P(u, v):
                c = [0.0, 0.0, 0.0]; c[ax] = sg * h[ax]; c[ua] = u; c[va] = v; return surf(c)
            for a in range(len(U) - 1):
                for b in range(len(W) - 1):
                    flat = U[a] >= -i[ua] - 1e-6 and U[a + 1] <= i[ua] + 1e-6 and W[b] >= -i[va] - 1e-6 and W[b + 1] <= i[va] + 1e-6
                    q = [P(U[a], W[b]), P(U[a + 1], W[b]), P(U[a + 1], W[b + 1]), P(U[a], W[b + 1])]
                    if sg < 0: q = q[::-1]
                    if flat: o = len(Vf); Vf.extend(Vector((p.x, p.y, p.z + cz)) for p in q); Ff.append((o, o + 1, o + 2, o + 3))
                    else: Fb.append(tuple(vid(p) for p in q))
    return [(Vb, Fb, True), (Vf, Ff, False)]
def p_extrude(pts, h, cz=0.0):
    """A polygon (counter-clockwise in x, y) extruded along z, flat shaded."""
    n = len(pts); z0, z1 = cz - h / 2, cz + h / 2
    V = [Vector((x, y, z0)) for x, y in pts] + [Vector((x, y, z1)) for x, y in pts]
    F = [tuple(range(n))[::-1], tuple(range(n, 2 * n))]
    for k in range(n): k2 = (k + 1) % n; F.append((k, k2, n + k2, n + k))
    return [(V, F, False)]
def arc_sweep(mat, th0, th1, prof, step=2.5, smooth=True, caps=False):
    """Sweep a profile [(r, y), ...] around the room axis from th0 to th1. Travel it counter-clockwise (r right, y up) around the solid, the way p_lathe wants, and the faces point out."""
    n = max(1, int(abs(th1 - th0) / step)); ths = [th0 + (th1 - th0) * k / n for k in range(n + 1)]; m = n + 1
    A = acc(mat)
    for (r0, y0), (r1, y1) in zip(prof[:-1], prof[1:]):
        o = len(A.V)
        A.V.extend(Vector(g2b(*polar(r0, t, y0))) for t in ths); A.V.extend(Vector(g2b(*polar(r1, t, y1))) for t in ths)
        for k in range(n): A.F.append((o + m + k, o + m + k + 1, o + k + 1, o + k)); A.S.append(smooth)
    if caps:                                           # a closed profile: flat ends, the far one wound as the profile is, the near one reversed
        pr = prof[:-1] if prof[0] == prof[-1] else prof
        for t, rev in ((th0, th1 < th0), (th1, th1 >= th0)):
            o = len(A.V); A.V.extend(Vector(g2b(*polar(r, t, y))) for r, y in pr); ix = tuple(range(o, o + len(pr)))
            A.F.append(ix if (t == th1) != (th1 < th0) else ix[::-1]); A.S.append(False)
def stroke_tubes(text, M, height, track, r, mat, seg=6):
    """Neon-style lettering: tubes along the stroke alphabet, laid out in M's x (reading) and z (up)."""
    s = height / 6.0; pos = 0.0
    for ch in text:
        if ch in GLYPH:
            for pl in GLYPH[ch]:
                pts = [Vector((pos + gx * s, 0, gy * s)) for gx, gy in pl]
                if len(pts) == 1: continue
                put(mat, M, p_tube(pts, r, seg))
        pos += (glyph_adv(ch) + track) * s
    return pos - track * s
def text_width(text, height, track): s = height / 6.0; return sum((glyph_adv(c) + track) * s for c in text) - track * s

def arc_prism(mat, th0, th1, r0, r1, y0, y1, step=3.0, ends=True, lean=0.0, smooth_faces=True):
    """A solid arc segment; each long face has its own vertices so smooth outer/inner and flat top/bottom do not blend."""
    n = max(2, int(abs(th1 - th0) / step)); ths = [th0 + (th1 - th0) * i / n for i in range(n + 1)]
    def P(r, th, y): return g2b(*polar(r, th, y))
    A = acc(mat)
    def strip(pts_a, pts_b, smooth, flip=False):
        o = len(A.V)
        A.V.extend(pts_a); A.V.extend(pts_b); m = len(pts_a)
        for i in range(m - 1):
            f = (o + i, o + i + 1, o + m + i + 1, o + m + i)
            A.F.append(f if flip else f[::-1]); A.S.append(smooth)
    strip([P(r1, t, y0) for t in ths], [P(r1, t, y1) for t in ths], smooth_faces)                 # outer
    strip([P(r0, t, y1) for t in ths], [P(r0, t, y0) for t in ths], smooth_faces)                 # inner (faces -r)
    strip([P(r0, t, y1) for t in ths], [P(r1, t, y1) for t in ths], False, True)                  # top
    strip([P(r0, t, y0) for t in ths], [P(r1, t, y0) for t in ths], False)                        # bottom
    if ends:
        for t, flip in ((th0, False), (th1, True)):
            o = len(A.V); A.V.extend([P(r0, t, y0), P(r1, t, y0), P(r1, t, y1), P(r0, t, y1)])
            A.F.append((o, o + 1, o + 2, o + 3) if flip else (o, o + 3, o + 2, o + 1)); A.S.append(False)
def arc_path(r, th0, th1, y, n=24, lift=None):
    return [Vector(g2b(*polar(r, th0 + (th1 - th0) * i / n, y if lift is None else y + lift(i / n)))) for i in range(n + 1)]
def tube_world(mat, pts_game, r, seg=6, smooth_pts=0, caps=True):
    put(mat, Matrix.Identity(4), p_tube([g2b(*p) for p in pts_game], r, seg, caps, smooth_pts))

# ---- vertex AO sources the props register; the floor and wall read them at build time -----------
AO_BLOBS = []        # (x, z, rx, rz, strength)  game xz
AO_ARCS = []         # (th0, th1, r0, r1, soft, strength)
def floor_ao(x, z):
    r = math.hypot(x, z); th = math.degrees(math.atan2(z, x)); a = 1.0
    a *= 1 - 0.55 * float(sstep(WALL_R - 22, WALL_R, r))
    a *= 1 - 0.50 * float(1 - sstep(DAIS_R, DAIS_R + 9, r))
    for bx, bz, rx, rz, s in AO_BLOBS:
        d = math.hypot((x - bx) / rx, (z - bz) / rz); a *= 1 - s * float(1 - sstep(0.5, 1.0, d))
    for t0, t1, r0, r1, soft, s in AO_ARCS:
        dr = max(r0 - r, 0, r - r1); dt = max(t0 - th, 0, th - t1) * math.pi / 180 * r
        d = math.hypot(dr, dt); a *= 1 - s * float(1 - sstep(0, soft, d))
    return a

# @@PROPS@@


# =============================================================================================
# PROPS
# =============================================================================================
lean_deg = math.degrees(math.atan(LEAN))
def at_wall(th, y, depth=0.0): return at_polar(th, r_in(y) - depth, y)       # local b points into the wall, -b into the room
def tube_arc(mat, r, th0, th1, y, rad, seg=8, n=None):
    n = n or max(4, int(abs(th1 - th0) / 3))
    tube_world(mat, [polar(r, th0 + (th1 - th0) * i / n, y) for i in range(n + 1)], rad, seg)

# ---- glow cards: soft emissive decals (one blended material, one atlas: glow_texture) ---------------
GLW = {'V': [], 'F': [], 'UV': []}
def glow_uv(reg, u, v):
    x0, y0, x1, y1 = GA[reg]; return ((x0 + (x1 - x0) * u) / GLOW_W, 1.0 - (y1 - (y1 - y0) * v) / GLOW_H)
def glow_quad(c, right, up, w, h, reg):
    """A glow card centred on c (game xyz). right x up is the way it faces."""
    o = len(GLW['V']); c = Vector(c); R = Vector(right).normalized() * (w / 2); U = Vector(up).normalized() * (h / 2)
    for sx, sy, u, v in ((-1, -1, 0, 0), (1, -1, 1, 0), (1, 1, 1, 1), (-1, 1, 0, 1)):
        p = c + R * sx + U * sy; GLW['V'].append(Vector(g2b(p.x, p.y, p.z))); GLW['UV'].append(glow_uv(reg, u, v))
    GLW['F'].append((o, o + 1, o + 2, o + 3))
def glow_wall(th, r, y, w, h, reg):
    """A card on the wall at azimuth th, facing the middle of the room."""
    t = math.radians(th); glow_quad(polar(r, th, y), (-math.sin(t), 0, math.cos(t)), (0, 1, 0), w, h, reg)
def glow_arc(th0, th1, r, y0, y1, reg, step=3.0):
    """A strip following the wall: u runs along the arc over the whole region, v up it."""
    n = max(1, int(abs(th1 - th0) / step)); o = len(GLW['V'])
    for k in range(n + 1):
        t = th0 + (th1 - th0) * k / n
        for y, v in ((y0, 0), (y1, 1)): GLW['V'].append(Vector(g2b(*polar(r, t, y)))); GLW['UV'].append(glow_uv(reg, k / n, v))
    for k in range(n): GLW['F'].append((o + 2 * k, o + 2 * k + 2, o + 2 * k + 3, o + 2 * k + 1))
def glow_floor(th0, th1, r0, r1, reg, y=None, step=3.0):
    """A strip lying on the deck: u along the arc, v from r0 to r1."""
    n = max(1, int(abs(th1 - th0) / step)); o = len(GLW['V']); y = FL + 0.3 if y is None else y
    for k in range(n + 1):
        t = th0 + (th1 - th0) * k / n
        for r, v in ((r0, 0), (r1, 1)): GLW['V'].append(Vector(g2b(*polar(r, t, y)))); GLW['UV'].append(glow_uv(reg, k / n, v))
    for k in range(n): GLW['F'].append((o + 2 * k, o + 2 * k + 1, o + 2 * k + 3, o + 2 * k + 2))

sec('piers')
# ---- window piers: chrome pilasters, a sconce on each -------------------------------------------
for k in range(11):
    th = -165 + 15 * k
    sl = min([sv for c, sv in PANES if abs(c - th) < 8] or [SILL]); ym = (sl + HEAD) / 2
    put('steel', at_wall(th, ym, 1.3) @ rotx(lean_deg), p_rbox(5.6, 3.0, HEAD - sl, 0.6, 1))
    for yv in (sl + 1.1, HEAD - 1.1): put('brass', at_wall(th, yv, 0.0) @ loc(0, 0.4, 0) @ rotx(lean_deg), p_box(7.2, 1.0, 2.2, 0))
    Ms = at_wall(th, 22, 2.6)
    put('brass', Ms @ loc(0, -0.2, 0) @ rotx(90), p_cyl(2.8, 1.2, 8))
    put('brass', Ms, p_tube([Vector((0, -1.0, -1.0)), Vector((0, -4.8, -1.8)), Vector((0, -8.4, 1.0)), Vector((0, -8.4, 3.0))], 0.55, 4, True, 3))
    put('brass', Ms @ loc(0, -8.4, 3.0), p_lathe([[(0.9, 0), (2.3, 1.4), (3.0, 2.8)]], 8))
    put('lamp', Ms @ loc(0, -8.4, 7.9), p_sphere(3.3, 8, 6, 1.12))
    put('brass', Ms @ loc(0, -8.4, 11.2), p_lathe([[(2.2, 0), (1.9, 0.9), (0.9, 1.6), (0.6, 1.9)]], 8))
    glow_wall(th, r_in(30) - 11.0, 30.0, 30, 30, 'warm')
arc_prism('teal', -165, -15, r_in(HEAD) - 5.0, r_in(HEAD + 4) + 1.0, HEAD, HEAD + 9.0, 3.0)
arc_prism('brass', -165, -15, r_in(HEAD) - 5.4, r_in(HEAD) - 4.9, HEAD - 1.4, HEAD + 0.1, 3.0)
for c, sl in PANES: arc_prism('brass', c - 7.5, c + 7.5, r_in(sl) - 4.2, r_in(sl) + 0.4, sl - 1.4, sl + 0.3, 3.0)

sec('portholes')
# ---- portholes: a liner, a flange, a ring of bolts ----------------------------------------------
for th in PORTHOLES:
    Mp = at_wall(th, PH_Y, 0.0) @ rotx(90)
    put('brass', Mp, p_lathe([[(PH_R - 0.6, 3.0), (PH_R - 0.6, -3.5)]], 28, True))
    put('brass', Mp, p_lathe([[(PH_R - 0.6, 3.0), (PH_R + 1.4, 3.8), (PH_R + 6.5, 3.0), (PH_R + 9.0, 1.6), (PH_R + 9.4, 0.0)]], 28, True))
    put('steel', Mp @ loc(0, 0, 3.8), p_torus(PH_R + 1.0, 1.1, 28, 6))
    for k in range(10):
        a = 2 * math.pi * k / 10; put('steel', Mp @ loc((PH_R + 5.6) * math.cos(a), (PH_R + 5.6) * math.sin(a), 2.6), p_sphere(1.15, 6, 4))

sec('hatch')
# ---- the entrance hatch (+x end): a bulkhead door in a hazard-striped frame ---------------------------
Mh = at_wall(0, FL, 1.5) @ rotx(lean_deg)
for sx_ in (-1, 1):
    put('steel', Mh @ loc(sx_ * 37.5, -2.5, 68), p_rbox(10, 7, 136, 1.3, 1))
    for k in range(13): put('caution', Mh @ loc(sx_ * 37.5, -6.1, 8.0 + k * 9.6) @ roty(sx_ * 35), p_box(9.0, 0.35, 3.4))
put('steel', Mh @ loc(0, -2.5, 131), p_rbox(85, 7, 10, 1.3, 1))
put('dark', Mh @ loc(0, -3.2, 1.5), p_rbox(90, 9, 3.4, 0.8, 1))
put('teal', Mh @ loc(0, 0.2, 62), p_rbox(66, 4.0, 118, 1.6, 2))
for hz, hh in ((30, 40), (88, 36)): put('teal', Mh @ loc(0, -2.0, hz), p_rbox(52, 1.2, hh, 0.6, 1)); put('steel', Mh @ loc(0, -2.7, hz + hh / 2 - 0.4), p_box(52, 0.4, 0.6, 0.1)); put('steel', Mh @ loc(0, -2.7, hz - hh / 2 + 0.4), p_box(52, 0.4, 0.6, 0.1))
Mw = Mh @ loc(0, -3.2, 52) @ rotx(90)
put('brass', Mw, p_torus(11.5, 1.3, 24, 6)); put('brass', Mw, p_cyl(3.6, 5.0, 12, cz=0.6))
for a in (0, 60, 120):
    put('brass', Mw @ rotz(a), p_box(23, 1.5, 1.5))
    for sg in (-1, 1): put('brass', Mw @ rotz(a) @ loc(sg * 11.7, 0, 0), p_sphere(1.5, 6, 4))
Mp = Mh @ loc(0, -2.7, 91) @ rotx(90)
put('brass', Mp, p_torus(9.0, 1.2, 20, 6)); put('dark', Mp @ loc(0, 0, 0.3), p_cyl(9.0, 0.8, 20)); put('tealglow', Mp @ loc(3.4, -0.2, 0.8), p_cyl(1.0, 0.3, 8))
for hz in (22, 56, 92):
    put('steel', Mh @ loc(-34.6, -4.6, hz), p_cyl(2.1, 10, 10)); put('steel', Mh @ loc(-30.0, -3.3, hz), p_box(9.5, 0.8, 8.0, 0.2))
    for dx in (-33, -27): put('steel', Mh @ loc(dx, -3.8, hz + 2.6), p_sphere(0.8, 6, 4)); put('steel', Mh @ loc(dx, -3.8, hz - 2.6), p_sphere(0.8, 6, 4))
for hz in (24, 54, 84, 110): put('steel', Mh @ loc(30.4, -4.2, hz) @ roty(90), p_cyl(1.3, 7.0, 8)); put('brass', Mh @ loc(34.4, -4.2, hz) @ roty(90), p_cyl(1.9, 1.0, 8))
Mq = Mh @ loc(20, -2.5, 118) @ rotx(0)
put('gold', Mq, p_box(17, 0.5, 5.6, 0.2)); stroke_tubes('H-1', Mq @ loc(-5.6, -0.6, -2.0), 3.6, 0.8, 0.28, 'dark', 4)
put('dark', Mh @ loc(0, -2.0, 142), p_rbox(30, 4.0, 9, 0.9, 1))
put('ledg', Mh @ loc(-7, -4.4, 142), p_box(6, 0.8, 4.2)); put('ledr', Mh @ loc(7, -4.4, 142), p_box(6, 0.8, 4.2))
for dz, reg in ((-7.0, 'teal'), (7.0, 'red')): glow_quad((r_in(142 + FL) - 7.0, 142 + FL, dz), (0, 0, 1), (0, 1, 0), 22, 22, reg)
AO_BLOBS.append((r_in(FL) - 10, 0, 18, 52, 0.4))

SRNG = np.random.default_rng(SEED + 77)
PNT = {'V': [], 'F': [], 'UV': []}
def paint_uv(reg, u, v):
    x0, y0, x1, y1 = PA[reg]; return ((x0 + (x1 - x0) * u) / PAINT_W, 1.0 - (y1 - (y1 - y0) * v) / PAINT_H)
def paint_quad(cx, cz, w, d, rot, reg, y=None):
    """A decal on the deck centred on (cx, cz): w along its own x, d along its own z, turned by rot degrees."""
    y = FL + 0.35 if y is None else y; t = math.radians(rot); R = Vector((math.cos(t), 0, math.sin(t))) * (w / 2); Fw = Vector((math.sin(t), 0, -math.cos(t))) * (d / 2)
    o = len(PNT['V'])
    for sx, sy, u, v in ((-1, -1, 0, 0), (1, -1, 1, 0), (1, 1, 1, 1), (-1, 1, 0, 1)):
        p = Vector((cx, y, cz)) + R * sx + Fw * sy; PNT['V'].append(Vector(g2b(p.x, p.y, p.z))); PNT['UV'].append(paint_uv(reg, u, v))
    PNT['F'].append((o, o + 1, o + 2, o + 3))
def paint_arc(th0, th1, r0, r1, reg, y=None, step=3.0):
    n = max(1, int(abs(th1 - th0) / step)); o = len(PNT['V']); y = FL + 0.3 if y is None else y
    for k in range(n + 1):
        t = th0 + (th1 - th0) * k / n
        for r, v in ((r0, 0), (r1, 1)): PNT['V'].append(Vector(g2b(*polar(r, t, y)))); PNT['UV'].append(paint_uv(reg, k / n, v))
    for k in range(n): PNT['F'].append((o + 2 * k, o + 2 * k + 1, o + 2 * k + 3, o + 2 * k + 2))
GLV, GLF = [], []                                                   # thin glass shells, joined to the window glass mesh
def tumbler(M, liquid=None):
    """A tapered tumbler: glass shell (the window material), the drink glowing inside."""
    for V_, F_, _ in p_lathe([[(0, 0), (2.0, 0), (2.9, 7.6), (2.65, 7.6), (2.1, 0.8), (0, 0.8)]], 12):
        o = len(GLV); GLV.extend(M @ v for v in V_); GLF.extend(tuple(o + i for i in f) for f in F_)
    if liquid: put(liquid, M, p_lathe([[(0, 0.9), (2.08, 0.9), (2.58, 5.8), (0, 5.8)]], 12))
def bottle(M, mat, h=22.0, r=2.6):
    put(mat, M, p_lathe([[(0, 0), (r, 0), (r + 0.12, 0.5), (r + 0.12, h * 0.55), (r * 0.78, h * 0.7), (r * 0.34, h * 0.82), (r * 0.34, h * 0.95), (r * 0.44, h), (0, h)]], 8))
    if mat != 'bottle': put('vinyl', M @ loc(0, 0, h * 0.3), p_cyl(r + 0.2, h * 0.24, 8)); put('brass', M @ loc(0, 0, h + 0.2), p_cyl(r * 0.5, 0.9, 8))

# ---- the bar --------------------------------------------------------------------------------------
sec('bar')
B0, B1 = -170.0, -100.0
BF = 146.0                            # the room-side face of the carcass
BT = FL + 96.0                        # counter top
arc_prism('dark', B0, B1, BF - 0.6, BF + 4.5, FL, FL + 9, 2.5)
arc_prism('dark', B0, B1, BF, BF + 4.5, FL + 9, BT - 4.4, 2.5)
arc_prism('dark', B0, B1, BF + 4.5, BF + 6.0, FL, BT - 4.4, 2.5)
NPAN = 6; GAP = 0.55; PW = (B1 - B0 - GAP * (NPAN + 1)) / NPAN
for k in range(NPAN):
    t0 = B0 + GAP + k * (PW + GAP); t1 = t0 + PW
    arc_prism('teal', t0, t1, BF - 0.9, BF + 0.2, FL + 11, BT - 6.4, 2.0)
    for ya, yb in ((FL + 14.2, FL + 15.2), (BT - 10.4, BT - 9.4)): arc_prism('steel', t0 + 0.9, t1 - 0.9, BF - 1.05, BF - 0.8, ya, yb, 2.0)
    for ta, tb in ((t0 + 0.9, t0 + 1.3), (t1 - 1.3, t1 - 0.9)): arc_prism('steel', ta, tb, BF - 1.05, BF - 0.8, FL + 14.2, BT - 9.4, 2.0)
arc_prism('brass', B0, B1, BF - 1.2, BF - 0.8, FL + 55.0, FL + 56.4, 2.5)
arc_prism('dark', B0, B1, BF - 1.0, BF + 0.2, BT - 6.4, BT - 4.4, 2.5)
CT0, CT1 = BF - 3.8, BF + 26.0
wood_top = [(CT0 + 2.0, BT - 4.5), (CT1, BT - 4.5), (CT1, BT), (CT0 + 2.0, BT), (CT0 + 0.75, BT - 0.35), (CT0 + 0.1, BT - 1.2), (CT0, BT - 2.2), (CT0, BT - 2.3), (CT0 + 0.1, BT - 3.3), (CT0 + 0.75, BT - 4.15), (CT0 + 2.0, BT - 4.5)]
arc_sweep('wood', B0 - 1.2, B1 + 1.2, wood_top, 2.5, caps=True)
arc_sweep('brass', B0 - 1.2, B1 + 1.2, [(CT0 - 0.35, BT - 3.1), (CT0, BT - 3.1), (CT0, BT - 1.5), (CT0 - 0.35, BT - 1.5), (CT0 - 0.35, BT - 3.1)], 2.5, False)
for rr in (BF + 5.5, BF + 12.5, BF + 19.5): arc_prism('dark', B0 - 1.1, B1 + 1.1, rr - 0.1, rr + 0.1, BT - 0.02, BT + 0.05, 2.5, ends=False)
tube_arc('tealglow', BF - 3.0, B0 + 3, B1 - 3, BT - 5.2, 0.4, 5)
tube_arc('brass', BF - 8.0, B0 + 2, B1 - 2, FL + 12, 1.5, 8)
for th in np.arange(B0 + 4, B1 - 3, 12.0):
    put('brass', at_polar(float(th), BF - 8.0, FL + 6), p_cyl(1.0, 12, 8))
    put('brass', at_polar(float(th), BF - 4.5, FL + 11), p_box(0.8, 7, 0.8))
AO_ARCS.append((B0 - 3, B1 + 3, BF - 14, BF + 40, 8.0, 0.55))
glow_floor(B0 + 1, B1 - 1, BF - 30, BF - 2, 'strip')

# the neon sign: a framed board, tubes just off it, a halo that spills onto the panels
sec('sign')
TXT = 'SAUCER BAR'; TH_ = 12.0; TRK = 0.9; sc_ = TH_ / 6.0
SG0, SG1, SY0, SY1 = -156.0, -114.0, FL + 16.0, FL + 44.0
arc_prism('dark', SG0, SG1, BF - 1.9, BF - 0.5, SY0, SY1, 2.5)
arc_prism('steel', SG0 - 0.7, SG1 + 0.7, BF - 2.3, BF - 0.5, SY0 - 0.9, SY0, 2.5)
arc_prism('steel', SG0 - 0.7, SG1 + 0.7, BF - 2.3, BF - 0.5, SY1, SY1 + 0.9, 2.5)
for ta, tb in ((SG0 - 0.7, SG0), (SG1, SG1 + 0.7)): arc_prism('steel', ta, tb, BF - 2.3, BF - 0.5, SY0, SY1, 2.5)
total = text_width(TXT, TH_, TRK); pos = 0.0
for ch in TXT:
    c0 = 2 * sc_ if ch != 'I' else 0.0
    if ch in GLYPH:
        thc = -135.0 + math.degrees((pos + c0 - total / 2) / (BF - 2.5))
        stroke_tubes(ch, at_polar(thc, BF - 2.5, FL + 24.0) @ loc(-c0, 0, 0), TH_, TRK, 0.62, 'neon', 6)
    pos += (glyph_adv(ch) + TRK) * sc_
tube_arc('tealglow', BF - 2.5, -154, -116, FL + 20.2, 0.5, 6)
for th in (SG0 + 1.4, SG1 - 1.4):
    for yv in (SY0 + 2.2, SY1 - 2.2): put('steel', at_polar(th, BF - 2.0, yv), p_cyl(0.8, 0.9, 6)); put('dark', at_polar(th, BF - 2.45, yv), p_cyl(0.35, 0.3, 6))
Mx = at_polar(SG1 + 3.6, BF - 2.3, SY0 - 6.0)                 # the transformer and its lead
put('dark', Mx, p_rbox(11, 4.6, 7.5, 0.7, 1)); put('brass', Mx @ loc(0, -2.4, 0), p_box(9, 0.3, 5.5, 0.1))
tube_world('rubber', [polar(BF - 2.3, SG1 + 3.6, SY0 - 9.5), polar(BF - 2.0, SG1 + 3.9, SY0 - 14), polar(BF - 1.2, SG1 + 4.0, FL + 11), polar(BF - 0.6, SG1 + 4.0, FL + 9.2)], 0.45, 5, 6)
SGH = math.degrees(SIGN_X / (BF - 2.5))
glow_arc(-135 - SGH, -135 + SGH, BF - 2.1, FL + SIGN_Y0, FL + SIGN_Y1, 'sign')

# on the counter: a tap tower, bottles, glasses on a tray and a till
sec('bar top')
def bar_at(th, off, yaw=None): return at_polar(th, BF + off, BT, th + 180 if yaw is None else yaw)
Mt = bar_at(-127, 12.0)
put('steel', Mt, p_rbox(32, 15, 1.4, 0.6, 1, cz=0.7)); put('dark', Mt @ loc(0, 0, 1.45), p_box(28, 11, 0.2, 0))
put('steel', Mt @ loc(0, 3.5, 0), p_cyl(3.2, 2.0, 12, cz=2.4)); put('steel', Mt @ loc(0, 3.5, 0), p_cyl(1.9, 17, 12, cz=11.5))
put('steel', Mt @ loc(0, 3.5, 0), p_rbox(20, 5.4, 4.4, 1.3, 1, cz=21.0))
for dx, hm in ((-6.5, 'red'), (0, 'seatteal'), (6.5, 'mustard')):
    put('steel', Mt @ loc(dx, 0.4, 0), p_tube([Vector((0, 0.7, 21.0)), Vector((0, -1.4, 19.6)), Vector((0, -1.6, 17.6))], 0.55, 6, True, 3))
    put(hm, Mt @ loc(dx, 3.5, 23.2) @ rotx(-10), p_cyl(0.85, 9.0, 8, cz=4.5)); put(hm, Mt @ loc(dx, 3.0, 32.6), p_sphere(1.5, 8, 5))
for th, off, mat, hh, rr in ((-123.5, 19.0, 'glassB', 23.0, 2.6), (-121.4, 21.5, 'glassB', 19.0, 2.4), (-119.5, 18.5, 'glassB', 26.0, 2.2), (-116.8, 21.0, 'drinkT', 20.0, 2.8), (-114.6, 18.0, 'glassB', 24.0, 2.3)):
    bottle(bar_at(th, off), mat, hh, rr)
Mg = bar_at(-152, 12.0)
put('steel', Mg, p_rbox(30, 18, 1.2, 0.5, 1, cz=0.6)); put('dark', Mg @ loc(0, 0, 1.25), p_box(26, 14, 0.2, 0))
for dx, dy in ((-9, -4), (-3, 4), (4, -3), (10, 3)): tumbler(Mg @ loc(dx, dy, 1.3) @ rotz(float(SRNG.uniform(0, 360))), 'drinkA' if (dx, dy) == (10, 3) else None)
tumbler(bar_at(-162, 9.0) @ loc(0, 0, 0.3), 'drinkT'); put('vinyl', bar_at(-162, 9.0) @ loc(0, 0, 0.15), p_cyl(4.1, 0.3, 14))
Mr = bar_at(-106, 13.0, -106 + 180 + 12)
put('dark', Mr, p_rbox(25, 20, 12, 1.2, 1, cz=6)); put('dark', Mr @ loc(0, -5.5, 14.5) @ rotx(-28), p_rbox(21, 3.2, 12, 0.9, 1))
put('tealglow', Mr @ loc(0, -7.1, 14.7) @ rotx(-28), p_box(14, 0.3, 7.2, 0)); put('vinyl', Mr @ loc(0, -7.4, 6.0) @ rotx(-6), p_box(17, 5.5, 0.7, 0.2))
for k in range(12): put('dark', Mr @ loc(-6.2 + (k % 6) * 2.5, -7.0 + (k // 6) * -1.6, 6.6), p_box(1.6, 1.2, 0.7, 0.1))
put('brass', Mr @ loc(10.5, -9.2, 3.5), p_box(3.5, 0.5, 2.5, 0.1))

# stools: no two alike. Each swivels to its own angle; some are patched, one sits a little crooked
sec('stools')
def stool(th, r, H=60.0, seat='mustard', yaw=None, lean=0.0, tape=False, tip=False):
    """A swivel stool: cast base, post with two collars, a footring on four struts, a piped cushion. H = height of the seat's crown."""
    yaw = th + 180 + float(SRNG.uniform(-80, 80)) if yaw is None else yaw
    M = at_polar(th, r, FL + 11.6, yaw) @ rotz(28) @ rotx(90) if tip else at_polar(th, r, FL, yaw) @ rotx(lean) @ roty(lean * 0.7)
    zr = 0.36 * H
    put('dark', M, p_lathe([[(11.6, 0.0), (12.0, 0.5), (12.0, 1.2), (10.4, 1.9), (7.0, 3.3), (4.2, 5.6), (3.2, 8.0)]], 16))
    for k in range(3):
        a = math.radians(120 * k + 15); put('steel', M @ loc(10.0 * math.cos(a), 10.0 * math.sin(a), 2.1), p_cyl(0.8, 0.8, 5, cz=0.2, caps=False)); put('steel', M @ loc(10.0 * math.cos(a), 10.0 * math.sin(a), 2.5), p_cyl(0.8, 0.1, 5, cz=0.0))
    put('steel', M, p_cyl(2.05, H - 12.0, 10, cz=6.0 + (H - 12.0) / 2))
    put('steel', M, p_cyl(3.1, 1.6, 10, cz=8.6)); put('steel', M, p_cyl(3.1, 2.2, 10, cz=zr))
    put('steel', M, p_torus(10.4, 0.85, 16, 5, cz=zr))
    for k in range(4):
        a = math.radians(90 * k + 45); put('steel', M, p_tube([Vector((2.6 * math.cos(a), 2.6 * math.sin(a), zr)), Vector((10.2 * math.cos(a), 10.2 * math.sin(a), zr))], 0.55, 6, False))
    put('dark', M, p_lathe([[(0, H - 3.9), (9.0, H - 3.9), (10.1, H - 3.4), (10.1, H - 2.8)]], 20))
    put('steel', M, p_cyl(5.4, 1.0, 10, cz=H - 4.6, caps=False))
    put(seat, M, p_lathe([[(9.9, H - 3.4), (10.3, H - 2.8), (10.6, H - 2.0), (10.6, H - 1.5), (10.1, H - 1.0), (9.0, H - 0.4), (6.0, H + 0.1), (0.0, H + 0.3)]], 22))
    if tape: put('dark', M @ rotz(float(SRNG.uniform(0, 180))) @ loc(1.2, 0, H + 0.12), p_box(15.5, 3.4, 0.5, 0.1))
    x, y, z = polar(r, th, 0)
    AO_BLOBS.append((x, z, 12.5 if not tip else 24, 12.5 if not tip else 24, 0.5))
for args in ((-166, 128.0, {}), (-113, 129.0, {'seat': 'seatteal'}), (-100, 127.0, {'tape': True, 'lean': 1.4}), (-14, 150.0, {'seat': 'leather'}), (-176, 150.0, {})):
    stool(args[0], args[1], **args[2])
stool(-121, 118.0, seat='leather', yaw=-121 + 180 + 78, tip=True)

sec('jukebox')
# ---- jukebox (-x end): an arched cabinet in cream and chrome, lit from inside ---------------------------
def arch_pts(w, h_rect, n=14):
    R = w / 2; return [(-R, 0.0), (R, 0.0)] + [(R * math.cos(math.radians(a)), h_rect + R * math.sin(math.radians(a))) for a in np.linspace(0, 180, n)]
def arch_ring(Ro, Ri, h_rect, n=10):
    return [(Ro * math.cos(math.radians(a)), h_rect + Ro * math.sin(math.radians(a))) for a in np.linspace(0, 180, n)] + [(Ri * math.cos(math.radians(a)), h_rect + Ri * math.sin(math.radians(a))) for a in np.linspace(180, 0, n)]
Mj = at_polar(180, 188, FL)
def jf(b, h=0.0): return Mj @ loc(0, b, h) @ rotx(90)               # a polygon in (a, h) extruded along the depth, front toward -b
put('steel', Mj @ loc(0, 0, 3), p_rbox(58, 34, 6, 0.9, 1))
put('vinyl', jf(0, 5), p_extrude(arch_pts(54, 50), 30))
put('steel', jf(-15.5, 5.5), p_extrude(arch_pts(49, 48), 1.4))
put('dark', jf(-16.1, 5.5), p_extrude(arch_pts(44.6, 46), 0.9))
for Ro, Ri, mat in ((22.0, 19.4, 'tealglow'), (19.4, 16.8, 'lamp'), (16.8, 14.2, 'neon')): put(mat, jf(-16.7, 5.5), p_extrude(arch_ring(Ro, Ri, 46), 0.7))
put('lamp', jf(-16.75, 5.5), p_extrude([(-14.2, 21.0), (14.2, 21.0), (14.2, 46.0)] + [(14.2 * math.cos(math.radians(a)), 46.0 + 14.2 * math.sin(math.radians(a))) for a in np.linspace(0, 180, 10)[1:-1]] + [(-14.2, 46.0)], 0.5))
for a, rr, lab in ((-5.0, 8.4, 'red'), (0.3, 9.6, 'seatteal'), (5.2, 7.8, 'gold')):
    put('rubber', Mj @ loc(a, -17.6 - abs(a) * 0.04, 5.5 + 32.0) @ rotx(90), p_cyl(rr, 0.5, 20)); put(lab, Mj @ loc(a, -17.95 - abs(a) * 0.04, 5.5 + 32.0) @ rotx(90), p_cyl(rr * 0.33, 0.3, 12))
put('steel', Mj @ loc(0, -18.4, 5.5 + 42.8) @ rotx(90), p_cyl(0.7, 1.6, 8))
put('steel', Mj @ loc(0, -16.6, 5.5 + 31.5), p_tube([Vector((12.5, -1.4, 10.0)), Vector((5.0, -1.8, 3.5)), Vector((0.5, -1.6, -0.5))], 0.35, 4, True, 3))
put('dark', Mj @ loc(0, -16.3, 5.5 + 10.8), p_box(35.4, 0.8, 15.4, 0.3))
for k in range(8): put('steel', Mj @ loc(0, -16.9, 5.5 + 4.6 + k * 1.75), p_box(33.4, 0.7, 0.8, 0.1))
put('steel', Mj @ loc(0, -16.5, 5.5 + 19.8), p_box(35.4, 1.0, 2.8, 0.3))
for k in range(8): put('ledr' if k % 3 == 0 else ('ledg' if k % 3 == 1 else 'vinyl'), Mj @ loc(-14.4 + k * 2.05, -17.2, 5.5 + 19.8), p_cyl(0.6, 0.5, 6, cz=0))
put('brass', Mj @ loc(12.5, -17.1, 5.5 + 19.8), p_box(4.4, 0.5, 2.0, 0.1))
tube_pts = [Vector((25.3, -16.2, 5.5 + 3.0)), Vector((25.3, -16.2, 5.5 + 46.0))] + [Vector((25.3 * math.cos(math.radians(a)), -16.2, 5.5 + 46.0 + 25.3 * math.sin(math.radians(a)))) for a in range(10, 171, 20)] + [Vector((-25.3, -16.2, 5.5 + 46.0)), Vector((-25.3, -16.2, 5.5 + 3.0))]
put('tealglow', Mj, p_tube(tube_pts, 0.75, 5))
for sx_ in (-1, 1): put('steel', Mj @ loc(sx_ * 28.2, -12.5, 31), p_cyl(1.7, 52, 10)); put('steel', Mj @ loc(sx_ * 28.2, -12.5, 57.6), p_sphere(1.9, 8, 5))
put('brass', Mj @ loc(0, 0, 83.8), p_sphere(2.4, 8, 6))
Mn_ = Mj @ loc(8.0, -17.8, 5.5 + 29.0) @ roty(7)
put('vinyl', Mn_, p_box(11.5, 0.3, 7.6, 0.1))
for sx_ in (-1, 1): put('rubber', Mn_ @ loc(sx_ * 5.4, -0.1, 3.6), p_box(2.2, 0.35, 1.2, 0.05))
stroke_tubes('OUT OF', Mn_ @ loc(-4.7, -0.3, 0.7), 1.7, 0.5, 0.1, 'dark', 4); stroke_tubes('ORDER', Mn_ @ loc(-4.0, -0.3, -2.0), 1.7, 0.5, 0.1, 'dark', 4)
glow_wall(180, r_in(FL + 50) - 0.7, FL + 52, 110, 135, 'teal')
glow_floor(168, 192, 150, 176, 'strip')
AO_BLOBS.append((-188, 0, 22, 34, 0.5))

sec('cabinet')
# ---- trophy cabinet -------------------------------------------------------------------------------
Mc = at_polar(157.5, 196, FL, 157.5)
put('dark', Mc @ loc(0, 6.4, 46), p_box(42, 1.6, 92, 0.4))
for sx_ in (-1, 1): put('wood', Mc @ loc(sx_ * 20.4, 0, 46), p_box(2.4, 15, 92, 0.5))
put('wood', Mc @ loc(0, 0, 94), p_box(44, 15, 3.4, 0.6)); put('wood', Mc @ loc(0, 0, 7), p_box(42, 15, 14, 0.5))
for hz in (34, 62): put('brass', Mc @ loc(0, -0.5, hz), p_box(38, 12, 1.0, 0.2))
put('lamp', Mc @ loc(0, -5.5, 90), p_box(34, 1.4, 1.2))
def trophy(M, s):
    outer = [(0, 0), (5.5, 0), (5.5, 1.4), (3.0, 2.4), (1.2, 3.6), (1.2, 7.5), (2.8, 8.6), (4.6, 10.5), (5.7, 14.5), (5.6, 18.0), (5.0, 18.2), (5.0, 17.4), (4.6, 14.4), (0, 10.8)]
    put('gold', M, p_lathe([[(r * s, z * s) for r, z in outer]], 14))
    for sx_ in (-1, 1):
        put('gold', M, p_tube([Vector((sx_ * 5.2 * s, 0, 15.0 * s)), Vector((sx_ * 8.4 * s, 0, 14.0 * s)), Vector((sx_ * 8.2 * s, 0, 11.0 * s)), Vector((sx_ * 4.6 * s, 0, 10.0 * s))], 0.55 * s, 6, True, 5))
trophy(Mc @ loc(-10, -1.0, 35), 1.0); trophy(Mc @ loc(9, -1.0, 35), 0.8)
trophy(Mc @ loc(0, -1.0, 63), 1.3)
put('gold', Mc @ loc(-12, -1.0, 63), p_cyl(3.4, 1.0, 16)); put('gold', Mc @ loc(12, -1.0, 63), p_cyl(3.4, 1.0, 16))
AO_BLOBS.append((196 * math.cos(math.radians(157.5)), 196 * math.sin(math.radians(157.5)), 24, 14, 0.45))

sec('lockers')
# ---- lockers ---------------------------------------------------------------------------------------
for i, th in enumerate((108.5, 116.5, 124.5, 132.5)):
    Ml = at_polar(th, 195, FL, th)
    put('dark', Ml @ loc(0, 1.0, 45), p_box(26, 17, 90, 0.5))
    put('teal', Ml @ loc(0, -7.8, 43), p_box(24.6, 1.6, 84, 0.6))
    for k in range(4): put('dark', Ml @ loc(0, -8.7, 68 + k * 3.2), p_box(14, 0.6, 1.0))
    put('steel', Ml @ loc(8.6, -9.4, 40), p_box(1.4, 1.6, 9, 0.3))
    put('brass', Ml @ loc(0, -8.8, 28), p_box(10, 0.5, 4, 0.2))
    put('steel', Ml @ loc(-8.4, -9.2, 36), p_cyl(1.3, 1.4, 10))
AO_ARCS.append((105, 136, 180, 210, 5.0, 0.5))

sec('bench')
# ---- the banquette on the near wall: a plinth, a piped seat and a buttoned back ---------------------------------
BQ0, BQ1 = 43.0, 62.0
arc_prism('dark', BQ0, BQ1, 167.0, 199.0, FL, FL + 23, 2.5)
BQS = (BQ1 - BQ0) / 2; BQB = (BQ1 - BQ0) / 3
for k in range(2): arc_sweep('leather', BQ0 + k * BQS + 0.3, BQ0 + (k + 1) * BQS - 0.3, [(166.0, FL + 23), (198.5, FL + 23), (198.5, FL + 36.5), (166.0, FL + 36.5), (164.9, FL + 36.0), (164.2, FL + 34.8), (164.2, FL + 25.2), (164.9, FL + 24.0), (166.0, FL + 23)], 2.0, caps=True)
for k in range(3): arc_sweep('leather', BQ0 + k * BQB + 0.3, BQ0 + (k + 1) * BQB - 0.3, [(195.0, FL + 36.5), (200.6, FL + 36.5), (200.6, FL + 63.5), (199.8, FL + 65.2), (198.0, FL + 66.0), (196.4, FL + 65.2), (195.4, FL + 62.5), (194.8, FL + 56), (194.8, FL + 44), (195.0, FL + 36.5)], 2.0, caps=True)
for th in (BQ0 + BQB / 2, BQ0 + BQB * 1.5, BQ0 + BQB * 2.5):
    for yv in (FL + 46.0, FL + 57.0): put('steel', at_polar(float(th), 194.7, yv, float(th) + 180), p_sphere(0.85, 6, 4, 0.7))
AO_ARCS.append((BQ0 - 2, BQ1 + 2, 160, 205, 7.0, 0.5))

sec('rack')
# ---- a hook rail by the hatch with somebody's helmet and a scarf on it -----------------------------------------
Mk2 = at_wall(25.0, FL + 88, 0.9) @ rotx(lean_deg)
put('brass', Mk2, p_rbox(22, 1.6, 3.0, 0.6, 1))
for hk in (-5.5, 5.5): put('brass', Mk2 @ loc(hk, -1.8, 0), p_tube([Vector((0, 0.6, 0)), Vector((0, -2.6, 0)), Vector((0, -4.4, 1.6))], 0.5, 4, True, 2)); put('brass', Mk2 @ loc(hk, -4.4, 1.9), p_sphere(0.8, 6, 4))
Mh_ = Mk2 @ loc(-5.5, -5.2, -9.8)
put('vinyl', Mh_, p_sphere(7.4, 14, 10, 1.0)); put('steel', Mh_ @ loc(0, 0, -6.2), p_torus(5.6, 1.0, 14, 5))
put('dark', Mh_ @ loc(0, -3.6, 0.8) @ rotx(8), p_sphere(5.6, 12, 8, 0.8)); put('red', Mh_ @ loc(0, -3.2, 6.7), p_cyl(1.6, 0.9, 8))
put('teal', Mk2 @ loc(5.5, -5.2, -7.5), p_box(3.4, 2.2, 15, 0.8)); put('mustard', Mk2 @ loc(5.5, -5.2, -13.5), p_box(3.4, 2.2, 3.0, 0.4))

sec('pipework')
# ---- pipework ---------------------------------------------------------------------------------------
PY = FL + 22
tube_arc('copper', r_in(PY) - 4.2, 12, 103, PY, 3.0, 8)
tube_arc('copper', r_in(PY) - 4.2, 138, 164, PY, 3.0, 8)
for th in np.arange(16, 102, 9.0):
    put('steel', at_polar(float(th), r_in(PY) - 2.0, PY), p_box(3.4, 3.0, 8.4, 0.4))
for th in (28, 74, 146): put('steel', at_polar(th, r_in(PY) - 4.2, PY) @ roty(90), p_cyl(4.6, 2.4, 14))
Mv = at_polar(60, r_in(PY) - 4.2, PY)
put('dark', Mv @ loc(0, 0, 5.5), p_cyl(1.2, 7, 8)); put('dark', Mv @ loc(0, 0, 10.5), p_torus(4.6, 0.6, 20, 6))
for a in (0, 90): put('dark', Mv @ loc(0, 0, 10.5) @ rotz(a), p_box(9.2, 0.8, 0.8))
put('dark', Mv @ loc(0, 0, 3.2), p_cyl(2.8, 3.4, 12))
Mg = at_polar(86, r_in(PY) - 4.2, PY + 9)
put('copper', at_polar(86, r_in(PY) - 4.2, PY + 3.5), p_cyl(0.9, 7, 8))
put('steel', Mg @ rotx(90) @ loc(0, 0, 1.5), p_cyl(4.6, 3.0, 20)); put('vinyl', Mg @ rotx(90) @ loc(0, 0, 3.2), p_cyl(3.9, 0.6, 20))
tube_world('copper', [polar(r_in(PY) - 4.2, 164, PY), polar(r_in(PY) - 4.4, 164.8, PY - 1.5), polar(r_in(PY) - 5.0, 165.4, FL + 4), polar(r_in(PY) - 5.0, 165.4, FL - 0.5)], 3.0, 12, 5)
put('steel', at_polar(165.4, r_in(PY) - 5.0, FL + 0.6), p_cyl(7.0, 1.2, 20))
# fire extinguisher
Me = at_polar(21, r_in(FL + 30) - 5.0, FL)
put('red', Me @ loc(0, 0, 21), p_cyl(4.4, 38, 16)); put('red', Me @ loc(0, 0, 42), p_sphere(4.4, 14, 8))
put('dark', Me @ loc(0, 0, 45.5), p_cyl(1.3, 3, 8)); put('dark', Me @ loc(0, -2.6, 48), p_box(1.2, 5.6, 1.2))
put('steel', Me @ loc(0, 3.6, 28), p_box(10, 1.0, 3.0, 0.3)); put('steel', Me @ loc(0, 3.6, 12), p_box(10, 1.0, 3.0, 0.3))
AO_BLOBS.append((Me.translation.x, -Me.translation.y, 6, 6, 0.4))

sec('scoreboard')
# ---- the scoreboard: a slate and tally marks -----------------------------------------------------------
Mb = at_wall(82.5, FL + 64, 1.0)
put('wood', Mb, p_box(46, 2.6, 30, 0.8)); put('dark', Mb @ loc(0, -1.0, 0), p_box(42, 2.0, 26, 0.4))
for row, n_ in ((9, 3), (-5, 5)):
    for g in range(n_):
        x0 = -17 + g * 8.0
        for t in range(4): put('vinyl', Mb @ loc(x0 + t * 1.5, -2.4, row), p_tube([Vector((0, 0, -3.2)), Vector((0, 0, 3.2))], 0.22, 4, False))
        put('vinyl', Mb @ loc(x0 + 2.25, -2.4, row), p_tube([Vector((-3.6, 0, -2.6)), Vector((3.6, 0, 2.6))], 0.22, 4, False))
put('steel', Mb @ loc(0, -1.6, -15.6), p_box(40, 2.0, 1.2, 0.3))

sec('table cable')
# ---- the table's cable and its floor box ---------------------------------------------------------------
tube_world('rubber', [(60.5, FY + 7.5, 30.0), (61.6, FY + 1.8, 34.0), (68, FY + 0.5, 40), (82, FY + 0.5, 36), (92, FY + 0.5, 22), (95.4, FY + 1.6, 15.5)], 0.55, 6, 6)
put('steel', at_polar(math.degrees(math.atan2(14, 97)), math.hypot(97, 14), FY + 0.9, 0), p_box(9, 9, 1.8, 0.4))
put('ledg', at_polar(math.degrees(math.atan2(14, 97)), math.hypot(97, 14), FY + 1.9, 0) @ loc(2.4, 2.4, 0), p_box(1.6, 1.6, 0.3))
for lx, lz in LEGS:
    put('steel', frame(lx, FY + 0.45, lz, 0), p_box(12, 12, 0.9, 0.3))
    for bx in (-4.2, 4.2):
        for bz in (-4.2, 4.2): put('dark', frame(lx + bx, FY + 1.1, lz + bz, 0), p_cyl(0.8, 0.8, 8))

sec('lounge')
# ---- the lounge under the window bay, and what a venue accumulates ------------------------------------------------
def ctable(th, r, top=74.0):
    """A high-top bistro table with a cast base, a worn wooden top in a brass band and what is left of two drinks."""
    M = at_polar(th, r, FL, th)
    put('steel', M, p_lathe([[(14.5, 0.0), (14.9, 0.6), (14.9, 1.3), (13.0, 2.2), (8.0, 3.8), (3.6, 7.4), (2.9, 10.5)]], 16))
    put('steel', M, p_cyl(2.3, top - 14.0, 12, cz=9.0 + (top - 14.0) / 2)); put('steel', M, p_cyl(3.2, 1.8, 14, cz=top * 0.45))
    put('steel', M, p_cyl(7.0, 1.0, 16, cz=top - 3.2))
    put('wood', M, p_lathe([[(0, top - 2.6), (18.9, top - 2.6), (20.0, top - 1.8), (20.2, top - 0.6), (19.6, top), (0, top)]], 24))
    put('brass', M, p_lathe([[(20.3, top - 1.9), (20.55, top - 1.7), (20.55, top - 0.5), (20.3, top - 0.3)]], 24))
    for dx, dy, liq in ((5.5, -4.0, 'drinkA'), (-7.0, 3.5, 'drinkT')):
        put('vinyl', M @ loc(dx, dy, top + 0.15), p_cyl(4.1, 0.3, 16)); tumbler(M @ loc(dx, dy, top + 0.3) @ rotz(float(SRNG.uniform(0, 360))), liq)
    for dx in (-1.2, 1.2): put('steel', M @ loc(dx, 9.5, top + 1.9), p_cyl(0.85, 3.8, 8)); put('dark', M @ loc(dx, 9.5, top + 3.9), p_cyl(0.9, 0.5, 8))
    x, y, z = polar(r, th, 0); AO_BLOBS.append((x, z, 20, 20, 0.5))
ctable(-72, 150.0)
for th, sm in ((-85, 'seatteal'), (-59, 'mustard')): stool(th, 132.0, H=48.0, seat=sm)
ctable(-36, 162.0)
for th, sm in ((-49, 'mustard'), (-23, 'leather')): stool(th, 146.0, H=48.0, seat=sm)
# a bin by the hatch, crates by the bay, a mat, a wet-floor sign
Mn = at_polar(13, 183.0, FL)
put('dark', Mn @ loc(0, 0, 13), p_cyl(8.2, 26, 18)); put('steel', Mn @ loc(0, 0, 26.6), p_cyl(8.8, 2.4, 18)); put('steel', Mn @ loc(0, 0, 29), p_torus(3.4, 0.7, 14, 5))
AO_BLOBS.append((183 * math.cos(math.radians(13)), 183 * math.sin(math.radians(13)), 13, 13, 0.5))
Mk = at_polar(-24, 188.0, FL, -24)
for (a, b, h, w, d, hh) in ((0, 0, 0, 24, 24, 22), (4, 0, 22, 20, 22, 20), (-18, 4, 0, 18, 18, 16)):
    put('wood', Mk @ loc(a, b, h + hh / 2), p_box(w, d, hh, 0.7))
    for z_ in (0.22, 0.78): put('dark', Mk @ loc(a, b, h + hh * z_), p_box(w + 0.6, d + 0.6, 1.8, 0.2))
AO_BLOBS.append((188 * math.cos(math.radians(-24)), 188 * math.sin(math.radians(-24)), 24, 18, 0.5))
Mw_ = at_polar(-93, 124.0, FL, -93 + 20)
for sx_ in (-1, 1):
    put('caution', Mw_ @ loc(0, sx_ * 4.6, 11.5) @ rotx(sx_ * 11), p_rbox(12, 1.1, 24, 0.45, 1))
    put('dark', Mw_ @ loc(0, sx_ * 4.6, 17.5) @ rotx(sx_ * 11), p_box(12.2, 1.3, 3.4, 0.1))
AO_BLOBS.append((120 * math.cos(math.radians(-93)), 120 * math.sin(math.radians(-93)), 12, 12, 0.4))
# framed sanctioning certificates either side of the hatch
for th in (-17, 17):
    Mf = at_wall(th, FL + 66, 0.8)
    put('gold', Mf, p_box(17, 1.4, 23, 0.5)); put('vinyl', Mf @ loc(0, -0.9, 0), p_box(14.2, 0.6, 20.2)); put('red', Mf @ loc(0, -1.4, -6.5) @ rotx(90), p_cyl(2.1, 0.7, 14))
    for yv in (4.5, 1.5, -1.5): put('dark', Mf @ loc(0, -1.4, yv), p_box(9.0 - 1.0 * (yv < 0), 0.3, 0.7))

sec('floor')
# ---- the deck: what a venue leaves on it -----------------------------------------------------------------------
FRNG = np.random.default_rng(SEED + 91)
paint_quad(r_in(FL) - 27.0, 0.0, 92.0, 34.0, 90.0, 'haz')
paint_quad(r_in(FL) - 52.0, 0.0, 62.0, 8.0, 90.0, 'stencil')
paint_arc(B0 + 2, B1 - 2, BF - 40, BF - 8, 'worn', FL + 0.22)
paint_arc(-86, -34, 138, 172, 'worn', FL + 0.22)
paint_arc(120, 168, 150, 190, 'worn', FL + 0.22)
for k in range(9):
    th = float(FRNG.uniform(-180, 180)); rr = float(FRNG.uniform(116, 192)); x, y_, z = polar(rr, th, 0)
    paint_quad(x, z, float(FRNG.uniform(16, 44)), float(FRNG.uniform(16, 44)), float(FRNG.uniform(0, 360)), 'stain' if k % 3 else 'spill', FL + 0.3)
for th, rr in ((-128, 122), (-92, 128), (-60, 140)): x, y_, z = polar(rr, th, 0); paint_quad(x, z, 26, 26, float(FRNG.uniform(0, 360)), 'spill', FL + 0.32)
Mdr = at_polar(24, 178.0, FL, 24)
put('steel', Mdr @ loc(0, 0, 0.35), p_rbox(24, 16, 0.7, 0.25, 1))
for k in range(7): put('rubber', Mdr @ loc(-9 + k * 3.0, 0, 0.72), p_box(1.4, 12.0, 0.2, 0))
for sx_ in (-1, 1):
    for sy_ in (-1, 1): put('dark', Mdr @ loc(sx_ * 10.5, sy_ * 6.5, 0.8), p_cyl(0.7, 0.4, 6))
Mpl = at_polar(-6, 112.0, FL, -6)
put('steel', Mpl @ loc(0, 0, 0.25), p_rbox(30, 22, 0.5, 0.2, 1))
for sx_ in (-1, 1):
    for sy_ in (-1, 1): put('dark', Mpl @ loc(sx_ * 12.5, sy_ * 8.5, 0.55), p_cyl(0.9, 0.4, 6))

sec('ceiling lamp')
# ---- the ceiling lamp: a ring of globes on arms from a hub --------------------------------------------------
put('dark', at_polar(0, 0, APEX - 6.5), p_cyl(46, 3.0, 40)); put('brass', at_polar(0, 0, APEX - 8.4), p_cyl(14, 1.2, 24))
tube_world('brass', [polar(44, 360.0 * i / 32, APEX - 42) for i in range(33)], 1.1, 5)
for k in range(8):
    th = 45 * k + 22.5
    tube_world('brass', [polar(14, th, APEX - 8), polar(30, th, APEX - 24), polar(44, th, APEX - 42)], 0.9, 5, 3)
    put('brass', at_polar(th, 44, APEX - 44.5), p_lathe([[(1.4, 3), (3.4, 0.5), (5.2, -2.5)]], 8))
    put('lamp', at_polar(th, 44, APEX - 51), p_sphere(6.2, 12, 8)); glow_quad(polar(44, th, APEX - 51), (1, 0, 0), (0, 0, 1), 38, 38, 'warm')
tube_world('brass', [polar(0, 0, APEX - 8), polar(0, 0, APEX - 30)], 1.0, 6)
put('lamp', at_polar(0, 0, APEX - 38), p_sphere(8.5, 14, 9)); glow_quad(polar(0, 0, APEX - 38), (1, 0, 0), (0, 0, 1), 52, 52, 'warm')
for k in range(24):
    th = 15 * k + 7.5; rr, yy = dome(0.16)
    put('lamp', at_polar(th, rr - 1.2, yy - 0.8, th + 90), p_box(9, 1.2, 1.2, 0.3))

# =============================================================================================
sec('shell')
# THE SHELL: floor, dais, wall (with real window and porthole openings), glass, ceiling
# =============================================================================================
print('saucer: textures')
HW, HH = max(64, int(1024 * TS) // 4 * 4), max(128, int(2048 * TS) // 4 * 4)
TN_ = max(64, int(1024 * TS) // 4 * 4); DN_ = max(128, int(2048 * TS) // 4 * 4)
ha, hn, ho = hull_textures(HW, HH)
im_ha = new_img('saucer_hull_albedo', HW, HH); np_img(im_ha, ha)
im_hn = new_img('saucer_hull_normal', HW, HH, True); np_img(im_hn, hn)
im_ho = new_img('saucer_hull_orm', HW // 2, HH // 2, True); np_img(im_ho, ho[::2, ::2])
ta, tnrm, to = tread_textures(TN_)
im_ta = new_img('saucer_deck_albedo', TN_, TN_); np_img(im_ta, ta)
im_tn = new_img('saucer_deck_normal', TN_, TN_, True); np_img(im_tn, tnrm)
im_to = new_img('saucer_deck_orm', TN_ // 2, TN_ // 2, True); np_img(im_to, to[::2, ::2])
da, dn, do = dais_textures(DN_)
im_da = new_img('saucer_dais_albedo', DN_, DN_); np_img(im_da, da)
im_dn = new_img('saucer_dais_normal', DN_, DN_, True); np_img(im_dn, dn)
im_do = new_img('saucer_dais_orm', DN_ // 2, DN_ // 2, True); np_img(im_do, do[::2, ::2])
gcol, galpha = glass_texture(max(64, int(512 * TS) // 4 * 4), max(32, int(256 * TS) // 4 * 4))
im_ga = new_img('saucer_glass', gcol.shape[1], gcol.shape[0], alpha=True); np_img(im_ga, gcol, galpha)
wv, wmean = wear_texture(max(128, int(512 * TS) // 4 * 4))
im_wv = new_img('saucer_wear', wv.shape[1], wv.shape[0]); np_img(im_wv, wv)
WEAR['img'] = im_wv; WEAR['mean'] = wmean
glw = glow_texture(); im_gl = new_img('saucer_glow', GLOW_W, GLOW_H, alpha=True); np_img(im_gl, glw[..., :3], glw[..., 3])
pnt = paint_texture(); im_pt = new_img('saucer_paint', PAINT_W, PAINT_H, alpha=True); np_img(im_pt, pnt[..., :3], pnt[..., 3])
IMGS = [im_ha, im_hn, im_ho, im_ta, im_tn, im_to, im_da, im_dn, im_do, im_ga, im_wv, im_gl, im_pt]

MATS = {
    'hull':  tex_mat('saucer_hull', im_ha, im_hn, im_ho, vcol=True),
    'deck':  tex_mat('saucer_deck', im_ta, im_tn, im_to, vcol=True),
    'dais':  tex_mat('saucer_dais', im_da, im_dn, im_do),
    'glass': tex_mat('saucer_glass', im_ga, None, None, alpha_img=True),
    'glow':  glow_mat('saucer_glow', im_gl),
    'paint': paint_mat('saucer_paint', im_pt),
}
MATS['glass'].node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.06
FLAT = {   # name: (hex, metal, rough, emissive hex, strength)
    'ceil':   (0x294a52, 0.35, 0.62, None, 1),
    'steel':  (0xc3ccd1, 1.0, 0.30, None, 1),
    'dark':   (0x2a3238, 0.7, 0.5, None, 1),
    'caution': (0xd8a51e, 0.0, 0.45, None, 1),
    'teal':   (0x2a6670, 0.25, 0.55, None, 1),
    'vinyl':  (0xd6c9a8, 0.0, 0.48, None, 1),
    'seatteal': (0x2c7a82, 0.0, 0.40, None, 1),
    'glassB': (0x7a4416, 0.0, 0.12, None, 1),
    'drinkA': (0x8a4a10, 0.0, 0.2, 0xff9a2a, 1.7),
    'drinkT': (0x15564e, 0.0, 0.2, 0x3ef0d0, 1.9),
    'brass':  (0xd9a24a, 1.0, 0.34, None, 1),
    'copper': (0xb8622a, 1.0, 0.40, None, 1),
    'rubber': (0x0d0e10, 0.0, 0.85, None, 1),
    'wood':   (0x54402e, 0.0, 0.42, None, 1),
    'lamp':   (0xffe0b0, 0.0, 0.5, 0xffb868, 2.3),
    'neon':   (0xffa24a, 0.0, 0.5, 0xff9a3c, 6.0),
    'tealglow': (0x7ff5dc, 0.0, 0.5, 0x4fe8cc, 7.0),
    'ledg':   (0x7dff9a, 0.0, 0.5, 0x4dff8a, 8.0),
    'ledr':   (0xff6a4a, 0.0, 0.5, 0xff4a2a, 8.0),
    'bottle': (0x7a4a14, 0.0, 0.2, 0xc9791f, 1.2),
    'gold':   (0xe8b24a, 1.0, 0.26, None, 1),
    'red':    (0xb3261e, 0.1, 0.42, None, 1),
    'mustard': (0xb07a2a, 0.0, 0.46, None, 1),
    'leather': (0x552a2e, 0.0, 0.36, None, 1),
}
for k, (h, m, r, e, es) in FLAT.items(): MATS[k] = flat_mat('saucer_' + k, h, m, r, e, es)

OBJS = []
def make_mesh(name, V, F, smooth, mat, uv=None, colors=None):
    me = bpy.data.meshes.new(name); me.from_pydata([tuple(v) for v in V], [], [tuple(f) for f in F]); me.update()
    me.polygons.foreach_set('use_smooth', [bool(x) for x in smooth])
    if uv is not None:
        lay = me.uv_layers.new(name='UVMap'); lay.data.foreach_set('uv', np.asarray(uv, np.float32).ravel())
    if colors is not None:
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER'); ca.data.foreach_set('color', np.asarray(colors, np.float32).ravel())
    o = bpy.data.objects.new(name, me); o.data.materials.append(mat); col.objects.link(o); OBJS.append(o)
    return o

# ---- outer floor: a polar grid, tread texture in world units, vertex AO ---------------------------
print('saucer: floor, dais')
NSEG, NRING = 128, 20
rs = DAIS_R - 0.2 + (WALL_R + 3 - DAIS_R + 0.2) * (np.arange(NRING + 1) / NRING)
V, F, UV, COL = [], [], [], []
for r in rs:
    for j in range(NSEG):
        t = 2 * math.pi * j / NSEG; V.append(g2b(r * math.cos(t), FL, r * math.sin(t)))
for i in range(NRING):
    for j in range(NSEG):
        j2 = (j + 1) % NSEG; a, b = i * NSEG + j, i * NSEG + j2
        F.append((a, b, b + NSEG, a + NSEG))
for f in F:
    for vi in f:
        v = V[vi]; x, z = v.x, -v.y
        UV.append((x / DECK_TILE, z / DECK_TILE)); c = floor_ao(x, z); COL.append((c, c * 0.99, c * 0.97, 1.0))
make_mesh('floor', V, F, [False] * len(F), MATS['deck'], UV, COL)

# ---- the dais: a disc (UV = the 2048 map) and a skirt ---------------------------------------------
EXT = DAIS_R + 2
V = [g2b(0, FY, 0)] + [g2b(DAIS_R * math.cos(2 * math.pi * k / 128), FY, DAIS_R * math.sin(2 * math.pi * k / 128)) for k in range(128)]
F = [(0, 1 + (k + 1) % 128, 1 + k) for k in range(128)]
UV = [((v.x + EXT) / (2 * EXT), (EXT + v.y) / (2 * EXT)) for f in F for v in (V[i] for i in f)]   # blender y = -z, so v = (ext - z)/(2 ext)
make_mesh('dais', V, F, [False] * len(F), MATS['dais'], UV)
arc_prism('dark', 0, 360, DAIS_R - 0.4, DAIS_R + 0.01, FL, FY, 3.0, ends=False)
arc_prism('steel', 0, 360, DAIS_R - 0.6, DAIS_R + 1.5, FY - 1.8, FY - 0.05, 3.0, ends=False)

# ---- the wall: a closed slab so the boolean can cut it, then only the room-facing side is kept -----
print('saucer: wall')
LEVELS = [FL, FL + 4, FL + 10, FL + 20, FL + 34, SILL, 24.0, 45.0, HEAD, 92.0, SPRING]
NTH = 240
bm = bmesh.new()
inner = [[bm.verts.new(g2b(r_in(y) * math.cos(math.radians(-180 + 360 * j / NTH)), y, r_in(y) * math.sin(math.radians(-180 + 360 * j / NTH)))) for j in range(NTH)] for y in LEVELS]
outer = [[bm.verts.new(g2b((r_in(y) + WALL_T) * math.cos(math.radians(-180 + 360 * j / NTH)), y, (r_in(y) + WALL_T) * math.sin(math.radians(-180 + 360 * j / NTH)))) for j in range(NTH)] for y in LEVELS]
for i in range(len(LEVELS) - 1):
    for j in range(NTH):
        j2 = (j + 1) % NTH
        bm.faces.new((inner[i][j], inner[i][j2], inner[i + 1][j2], inner[i + 1][j]))
        bm.faces.new((outer[i][j], outer[i + 1][j], outer[i + 1][j2], outer[i][j2]))
for j in range(NTH):
    j2 = (j + 1) % NTH
    bm.faces.new((inner[0][j], outer[0][j], outer[0][j2], inner[0][j2]))
    bm.faces.new((inner[-1][j], inner[-1][j2], outer[-1][j2], outer[-1][j]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
me = bpy.data.meshes.new('wall_slab'); bm.to_mesh(me); bm.free()
wall = bpy.data.objects.new('wall_slab', me); col.objects.link(wall)

cutcol = bpy.data.collections.new('cutters'); scene.collection.children.link(cutcol)
def cutter(parts, M):
    me = bpy.data.meshes.new('cut'); V, F, _ = parts[0]
    me.from_pydata([M @ v for v in V], [], F); me.update()
    o = bpy.data.objects.new('cut', me); cutcol.objects.link(o); return o
lean_deg = math.degrees(math.atan(LEAN))
PANE_W = 2 * r_in(30) * math.sin(math.radians(6.0))
for tc, sl in PANES:
    ym = (sl + HEAD) / 2
    cutter(p_box(PANE_W, WALL_T + 16, HEAD - sl), at_polar(tc, r_in(ym) + WALL_T / 2, ym) @ rotx(lean_deg))
for tc in PORTHOLES:
    cutter(p_cyl(PH_R, WALL_T + 16, 48, caps=True), at_polar(tc, r_in(PH_Y) + WALL_T / 2, PH_Y) @ rotx(90 + lean_deg))
set_active(wall)
mod = wall.modifiers.new('cut', 'BOOLEAN'); mod.operation = 'DIFFERENCE'; mod.operand_type = 'COLLECTION'; mod.collection = cutcol; mod.solver = 'EXACT'
bpy.ops.object.modifier_apply(modifier='cut')
for o in list(cutcol.objects): bpy.data.objects.remove(o, do_unlink=True)
bpy.data.collections.remove(cutcol)

# keep the room-facing faces and the cut reveals; compute UVs and AO colours from positions
me = wall.data
Vw = [v.co.copy() for v in me.vertices]; keepF = []
for p in me.polygons:
    c = p.center; x, z, y = c.x, -c.y, c.z
    if math.hypot(x, z) > r_in(y) + WALL_T - 0.35 and (y > FL + 0.1 and y < SPRING - 0.1): continue   # the outer skin
    if y <= FL + 0.1 or y >= SPRING - 0.1: continue                                                       # the slab's end caps
    keepF.append(tuple(p.vertices))
def wall_ao(x, y, z):
    h = y - FL; a = 0.55 + 0.45 * float(sstep(0, 34, h))
    a *= 1 - 0.30 * float(sstep(SPRING - 30, SPRING, y))
    n = noise.fractal(Vector((x / 55.0, y / 40.0, z / 55.0)) + Vector((3.1, 7.7, 1.3)), 0.7, 2.0, 3)
    a *= 0.86 + 0.28 * (n * 0.5 + 0.5)
    return max(0.3, min(1.0, a))
UV, COL = [], []
for f in keepF:
    ths = [math.atan2(-Vw[i].y, Vw[i].x) for i in f]
    us = [t * HULL_TILES / (2 * math.pi) for t in ths]
    if max(us) - min(us) > HULL_TILES / 2: us = [u + HULL_TILES if u < 0 else u for u in us]
    for i, u in zip(f, us):
        v = Vw[i]; UV.append((u, (v.z - FL) / TILE_V)); c = wall_ao(v.x, v.z, -v.y); COL.append((c, c * 0.985, c * 0.96, 1.0))
make_mesh('wall', Vw, keepF, [True] * len(keepF), MATS['hull'], UV, COL)
bpy.data.objects.remove(wall, do_unlink=True)

# ---- window glass and porthole glass ---------------------------------------------------------------
V, F, UVV = [], [], []
for pi_, (tc, sl) in enumerate(PANES):
    o = len(V)
    for yi, yy in enumerate((sl + 0.6, HEAD - 0.6)):
        for k in range(7):
            th = tc - 5.7 + 11.4 * k / 6; V.append(g2b(*polar(r_in(yy) + 3.0, th, yy)))
            UVV.append((k / 6 if pi_ % 2 == 0 else 1 - k / 6, float(yi)))
    for k in range(6): F.append((o + k, o + k + 1, o + 8 + k, o + 7 + k))
for tc in PORTHOLES:
    o = len(V); cx = polar(r_in(PH_Y) + 3.0, tc, PH_Y); M = frame(cx[0], cx[1], cx[2], tc)
    V.append(M @ Vector((0, 0, 0))); UVV.append((0.5, 0.5))
    for k in range(32):
        a = 2 * math.pi * k / 32; V.append(M @ Vector((math.cos(a) * (PH_R - 0.5), 0.0, math.sin(a) * (PH_R - 0.5))))
        UVV.append((0.5 + 0.5 * math.cos(a), 0.5 + 0.5 * math.sin(a)))
    for k in range(32): F.append((o, o + 1 + (k + 1) % 32, o + 1 + k))
o = len(V); V.extend(GLV); F.extend(tuple(o + i for i in f) for f in GLF); UVV.extend([(0.45, 0.5)] * len(GLV))
make_mesh('glass', V, F, [True] * len(F), MATS['glass'], [UVV[vi] for f in F for vi in f])
if PNT['F']: make_mesh('paint', PNT['V'], PNT['F'], [False] * len(PNT['F']), MATS['paint'], [PNT['UV'][vi] for f in PNT['F'] for vi in f])
if GLW['F']: make_mesh('glow', GLW['V'], GLW['F'], [False] * len(GLW['F']), MATS['glow'], [GLW['UV'][vi] for f in GLW['F'] for vi in f])

# ---- the ceiling: a dome out of the wall's top edge, ribs on every pier ---------------------------
print('saucer: ceiling')
NDOM, NSD = 10, 64
V, F = [], []
rowsd = []
for i in range(NDOM + 1):
    r, y = dome(i / NDOM)
    if r < 1e-6: rowsd.append([len(V)]); V.append(g2b(0, y, 0))
    else:
        rowsd.append(list(range(len(V), len(V) + NSD)))
        for k in range(NSD): a = 2 * math.pi * k / NSD; V.append(g2b(r * math.cos(a), y, r * math.sin(a)))
for a, b in zip(rowsd[:-1], rowsd[1:]):
    for k in range(NSD):
        k2 = (k + 1) % NSD
        if len(b) == 1: F.append((a[k], a[k2], b[0]))
        else: F.append((a[k], a[k2], b[k2], b[k]))
acc('ceil').V.extend(V); acc('ceil').F.extend(F); acc('ceil').S.extend([True] * len(F))
def rib_sweep(mat, pts, w, h):
    """pts: game-space points along a path hugging the ceiling; w across it, h down into the room."""
    A = acc(mat); rows = []
    for i, p in enumerate(pts):
        p = np.array(p); d = np.array(pts[min(i + 1, len(pts) - 1)]) - np.array(pts[max(i - 1, 0)]); d /= np.linalg.norm(d)
        n = np.array([p[0] / R0 ** 2, (p[1] - SPRING) / (APEX - SPRING) ** 2, p[2] / R0 ** 2]); n /= np.linalg.norm(n)
        side = np.cross(d, n); side /= np.linalg.norm(side); down = -n
        c = [p + side * w / 2, p - side * w / 2, p - side * w / 2 + down * h, p + side * w / 2 + down * h]
        rows.append(len(A.V)); A.V.extend(g2b(*q) for q in c)
    for a, b in zip(rows[:-1], rows[1:]):
        for k in range(4): k2 = (k + 1) % 4; A.F.append((a + k, a + k2, b + k2, b + k)); A.S.append(False)
sec('ribs')
for k in range(24):
    th = 15 * k
    pts = []
    for i in range(0, 8):
        r, y = dome(i / 7.0 * 0.98)
        pts.append(polar(r - 0.4, th, y - 0.4))
    rib_sweep('steel', pts, 4.2, 5.0)
for tt in (0.28, 0.62):
    r, y = dome(tt); pts = [polar(r - 0.4, 360.0 * i / 48, y - 0.4) for i in range(49)]
    rib_sweep('dark', pts, 4.0, 5.0)

# @@SCENE@@

# =============================================================================================
# ASSEMBLE + EXPORT
# =============================================================================================
sec('end')
PROC_SKIP = {n for n, v in FLAT.items() if v[3] is not None}                 # lamps and neon stay clean
def prop_attrs(A):
    """Per-corner UVs (the wear map, projected along each face's dominant axis) and baked colour: floor contact, undersides, a little dirt."""
    V, F, S = A.V, A.F, A.S
    vn = [Vector((0, 0, 0)) for _ in V]; fn = []
    for f, sm in zip(F, S):
        pts = [V[i] for i in f]; n = Vector((0, 0, 0))
        for k in range(len(pts)):
            a, b = pts[k], pts[(k + 1) % len(pts)]
            n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        L = n.length; n = n / L if L > 1e-9 else Vector((0, 0, 1)); fn.append(n)
        if sm:
            for i in f: vn[i] += n
    UVs, COL = [], []
    for f, sm, n0 in zip(F, S, fn):
        ax = max(range(3), key=lambda k: abs(n0[k]))
        for i in f:
            n = vn[i].normalized() if sm and vn[i].length > 1e-9 else n0
            p = V[i]; gx, gy, gz = p.x, p.z, -p.y
            UVs.append(((p.y, p.z), (p.x, p.z), (p.x, p.y))[ax]); UVs[-1] = (UVs[-1][0] / WEAR_TILE, UVs[-1][1] / WEAR_TILE)
            h = max(0.0, gy - (FY if math.hypot(gx, gz) < DAIS_R else FL))
            c = (1 - 0.50 * math.exp(-h / 3.2)) * (1 - 0.30 * max(0.0, -n.z))
            c *= 0.90 + 0.12 * (noise.fractal(Vector((gx, gy, gz)) / 38.0 + Vector((5.3, 1.9, 8.1)), 0.7, 2.0, 3) * 0.5 + 0.5)
            c *= 1 - 0.10 * max(0.0, noise.noise(Vector((gx / 4.0, gy / 70.0, gz / 4.0)) + Vector((2.2, 9.4, 3.3))))
            c *= 1 - 0.18 * float(sstep(WALL_R - 40, WALL_R, math.hypot(gx, gz)))
            COL.append((c, c * 0.985, c * 0.96, 1.0))
    return UVs, COL
for name, A in ACC.items():
    if not A.F: continue
    uv, cols = (None, None) if name in PROC_SKIP else prop_attrs(A)
    make_mesh('room_saucer_' + name, A.V, A.F, A.S, MATS[name], uv, cols)
print('saucer: %d meshes' % len(OBJS))
for k, v in sorted(SECS.items(), key=lambda kv: -kv[1]): print('   section %-22s %6d tris' % (k, v))
tris = 0
for o in OBJS:
    o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
    o.name = o.data.materials[0].name.replace('saucer_', 'room_saucer_')
print('saucer: %d tris' % tris)
for o in OBJS: print('   %-24s %6d tris' % (o.name, len(o.data.loop_triangles)))
for im in IMGS: im.pack()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BUILD, 'saucer_room.blend'))
set_active(*OBJS)
kw = dict(filepath=GLB, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
          export_lights=False, export_cameras=False)
try: bpy.ops.export_scene.gltf(export_vertex_color='ACTIVE', **kw)
except TypeError: bpy.ops.export_scene.gltf(**kw)
print('saucer: wrote', GLB, '%.1f MB' % (os.path.getsize(GLB) / 1048576))
