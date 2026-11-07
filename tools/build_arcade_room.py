"""
build_arcade_room.py  --  Fuzeball STARPORT ARCADE room -> GLB

    node tools/ktx2-decode.mjs assets/rooms/arcade/fuzeball_room_arcade.glb tools/build/arcade/arcade_old_png.glb --max-size 2048   (once; the cabinets come from it)
    blender -b -P tools/build_arcade_room.py -- [--tex 2048] [--seed 12]
    node tools/ktx2-encode.mjs tools/build/arcade/fuzeball_room_arcade.raw.glb assets/rooms/arcade/fuzeball_room_arcade.glb
    blender -b -P tools/build_arcade_sky.py -- --preview ; node tools/sky-encode.mjs tools/build/sky/arcade assets/rooms/arcade/sky/starport --size 1536

DIRECTION.md: rooms are venues people actually play in, cramped and a bit grubby. This is the arcade
on a deck of an orbital starport. The table sits on a rubber court in a worn concourse; two low-sill
bays on the far (-z) and right (+x) walls look out over the docks (build_arcade_sky.py). 1 unit = 1 cm.

KEPT from the old room (decoded from its GLB): the five cabinets and the vending machine on the left
wall, the Fuzeball logo plaque and the poster. Everything else is built here.

    floor     one 2048 map + normal + ORM: tiles, a rubber court with a gold tape line, hazard aprons, a tread plate at the dock door, scuffs, stains
    wall      one tiling map + normal + ORM: blue enamel panels, a brass dado rail, cream panels above
    glass     the two bays (alpha blend; the loader draws room glass first and never shadows it)
    glow      one blended atlas: lamp halos, the sign, the window light laid on the floor, screen spill
    props     surface sets (tools/roomlib.py: steel, brass, paint, plastic, raw wood), box-projected in each piece's own frame
    bake      ambient occlusion + the room's own lamps (LAMPS) ray-traced per corner into the baked colour, the cabinets included; no lights are exported

Authored in GAME units (X long axis, Y up, Z width) and converted with g2b.
"""
import bpy, bmesh, os, sys, math
import numpy as np
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roomlib as R
from roomlib import sstep, hx, tn, tfbm, seg_aa, gblur, height_to_normal

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(n, d): return type(d)(argv[argv.index(n) + 1]) if n in argv else d
TEX  = arg('--tex', 2048)
SEED = arg('--seed', 12)
ROOT  = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
BUILD = os.path.join(ROOT, 'tools', 'build', 'arcade')
os.makedirs(BUILD, exist_ok=True)
OLD = os.path.join(BUILD, 'arcade_old_png.glb')
GLB = os.path.join(BUILD, 'fuzeball_room_arcade.raw.glb')
rng = np.random.default_rng(SEED)
TS = TEX / 2048.0

# ---- the numbers that matter (game units) -------------------------------------------------------
FL, CEIL = -44.0, 104.0
X0, X1, Z0, Z1 = -259.0, 259.0, -205.0, 205.0
W_ROOM, D_ROOM = X1 - X0, Z1 - Z0
SILL, HEAD = -22.0, 58.0                 # both bays
BX, RZ = 172.0, 132.0                    # half widths: back bay (along x), right bay (along z)
WT = 14.0                                # wall thickness: the bay's reveal depth
GLASS_IN = 8.5                           # the glass sits this far into the wall
NPANE = 7
TILE_U, WALL_H = 96.0, CEIL - FL
COURT = (-190.0, 190.0, -150.0, 150.0)   # the rubber court: x0, x1, z0, z1
DX = 218.0                               # the dock door's centre on the far wall
PLATE = (DX - 28.0, DX + 28.0, Z0 + 18.0, Z0 + 54.0)   # the tread plate inside the door's box
def g2b(x, y, z): return Vector((x, -z, y))

# ---- scene + materials --------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = bpy.data.collections.new('Arcade Room'); scene.collection.children.link(col)
def set_active(*objs):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[-1]
def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)
SURF = {}      # kind -> {'alb', 'mean', 'n', 'orm', 'albs': {material: own albedo}}
FACT = {}      # material -> (roughness, metallic) factors written into the GLB after export: glTF scales the ORM texture by them
def link_orm(nt, b, img):
    o = nt.nodes.new('ShaderNodeTexImage'); o.image = img
    sp = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(o.outputs['Color'], sp.inputs['Color'])
    nt.links.new(sp.outputs['Green'], b.inputs['Roughness']); nt.links.new(sp.outputs['Blue'], b.inputs['Metallic'])
def link_nrm(nt, b, img):
    n = nt.nodes.new('ShaderNodeTexImage'); n.image = img
    nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
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
        link_nrm(nt, b, S['n']); link_orm(nt, b, S['orm']); FACT[name] = (rough, metal)
    else:
        b.inputs['Base Color'].default_value = c
    m.diffuse_color = c; m.use_backface_culling = True
    return m
def new_img(name, w, h, data=False, alpha=False):
    im = bpy.data.images.new(name, w, h, alpha=alpha)
    im.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    return im
def np_img(im, arr, a=None):
    h, w = arr.shape[:2]; rgba = np.ones((h, w, 4), np.float32); rgba[..., :3] = np.clip(arr, 0, 1)
    if a is not None: rgba[..., 3] = a
    im.pixels.foreach_set(rgba[::-1].ravel()); im.update()
    im.filepath_raw = os.path.join(BUILD, im.name + '.png'); im.file_format = 'PNG'; im.save()
def tex_mat(name, albedo, normal=None, vcol=False, alpha_img=None, rough=0.7, metal=0.0, orm=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']; m.use_backface_culling = alpha_img is None
    a = nt.nodes.new('ShaderNodeTexImage'); a.image = albedo
    if vcol:                                                   # glTF: baseColor = texture x COLOR_0
        vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1.0
        ins = [i for i in mx.inputs if i.type == 'RGBA']
        nt.links.new(a.outputs['Color'], ins[0]); nt.links.new(vc.outputs['Color'], ins[1])
        nt.links.new([o for o in mx.outputs if o.type == 'RGBA'][0], b.inputs['Base Color'])
    else:
        nt.links.new(a.outputs['Color'], b.inputs['Base Color'])
    if normal is not None: link_nrm(nt, b, normal)
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if orm is not None: link_orm(nt, b, orm)
    if alpha_img:
        nt.links.new(a.outputs['Alpha'], b.inputs['Alpha'])
        for k, v in (('surface_render_method', 'BLENDED'), ('blend_method', 'BLEND')):
            try: setattr(m, k, v)
            except Exception: pass
    return m
def glow_mat(name, img):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    a = nt.nodes.new('ShaderNodeTexImage'); a.image = img
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1.0
    ins = [i for i in mx.inputs if i.type == 'RGBA']; nt.links.new(a.outputs['Color'], ins[0]); ins[1].default_value = (0.04, 0.04, 0.04, 1.0)
    nt.links.new([o for o in mx.outputs if o.type == 'RGBA'][0], b.inputs['Base Color'])
    nt.links.new(a.outputs['Color'], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = 1.0
    nt.links.new(a.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = 1.0; b.inputs['Metallic'].default_value = 0.0
    for k, v in (('surface_render_method', 'BLENDED'), ('blend_method', 'BLEND')):
        try: setattr(m, k, v)
        except Exception: pass
    return m

# ---- the sign's alphabet (noise, strokes and blur come from roomlib) --------------------------------
GLYPH = {
 'A': [[(0,0),(1.7,6),(2.3,6),(4,0)], [(0.9,2.3),(3.1,2.3)]],
 'C': [[(4,5),(3,6),(1,6),(0,5),(0,1),(1,0),(3,0),(4,1)]],
 'D': [[(0,0),(0,6),(2.8,6),(4,4.8),(4,1.2),(2.8,0),(0,0)]],
 'E': [[(4,6),(0,6),(0,0),(4,0)], [(0,3.1),(3,3.1)]],
 'I': [[(0,0),(0,6)]],
 'N': [[(0,0),(0,6),(4,0),(4,6)]],
 'O': [[(1,0),(0,1),(0,5),(1,6),(3,6),(4,5),(4,1),(3,0),(1,0)]],
 'P': [[(0,0),(0,6),(3,6),(4,5),(4,3.8),(3,2.8),(0,2.8)]],
 'R': [[(0,0),(0,6),(3,6),(4,5),(4,3.8),(3,2.9),(0,2.9)], [(2.2,2.9),(4,0)]],
 'S': [[(4,5),(3,6),(1,6),(0,5),(0,3.9),(1,3.1),(3,2.9),(4,2.1),(4,1),(3,0),(1,0),(0,1)]],
 'T': [[(0,6),(4,6)], [(2,6),(2,0)]],
 'H': [[(0,0),(0,6)], [(4,0),(4,6)], [(0,3.1),(4,3.1)]],
 'U': [[(0,6),(0,1),(1,0),(3,0),(4,1),(4,6)]],
 'K': [[(0,0),(0,6)], [(4,6),(0,2.8)], [(1.4,3.9),(4,0)]],
 'G': [[(4,5),(3,6),(1,6),(0,5),(0,1),(1,0),(3,0),(4,1),(4,3),(2.2,3)]],
 'M': [[(0,0),(0,6),(2,3.6),(4,6),(4,0)]],
 'L': [[(0,6),(0,0),(4,0)]],
 'F': [[(4,6),(0,6),(0,0)], [(0,3.1),(3,3.1)]],
 'V': [[(0,6),(2,0),(4,6)]],
 'Y': [[(0,6),(2,3.2),(4,6)], [(2,3.2),(2,0)]],
 'B': [[(0,0),(0,6),(3,6),(4,5),(4,4),(3,3.2),(0,3.2)], [(3,3.2),(4,2.2),(4,1),(3,0),(0,0)]],
 '-': [[(0.5,3),(3.5,3)]], '1': [[(0.5,4.8),(2,6),(2,0)]],
}
ADV = {'I': 1.0, '1': 4.0, ' ': 3.0, '-': 4.0}
def glyph_adv(ch): return ADV.get(ch, 4.0)
def text_width(text, height, track): s = height / 6.0; return sum((glyph_adv(c) + track) * s for c in text) - track * s
def draw_text(img, text, cx, cy, height, track, stroke):
    """Stroke lettering centred on pixel (cx, cy); height in pixels."""
    s = height / 6.0; pos = cx - text_width(text, height, track) / 2
    for ch in text:
        if ch in GLYPH:
            for pl in GLYPH[ch]:
                pts = [(pos + gx * s, cy + (3 - gy) * s) for gx, gy in pl]
                for p0, p1 in zip(pts[:-1], pts[1:]): seg_aa(img, p0, p1, stroke)
        pos += (glyph_adv(ch) + track) * s

# =============================================================================================
# TEXTURES
# =============================================================================================
def floor_texture(W, H):
    """One map over the whole floor. Row 0 = z Z0. Returns albedo, normal, ORM: sealed tiles with a sheen (each laid a little out of true),
    rough grout and rubber, a path polished by feet, glossy drink rings, a steel tread plate in the dock door's box."""
    px = W / W_ROOM
    X = (X0 + (np.arange(W) + .5) / W * W_ROOM)[None, :] * np.ones((H, 1))
    Z = (Z0 + (np.arange(H) + .5) / H * D_ROOM)[:, None] * np.ones((1, W))
    TILE = 40.0
    ix = np.floor((X - X0) / TILE).astype(int); iz = np.floor((Z - Z0) / TILE).astype(int)
    lx = ((X - X0) % TILE) - TILE / 2; lz = ((Z - Z0) % TILE) - TILE / 2
    edge = TILE / 2 - np.maximum(np.abs(lx), np.abs(lz))       # distance to the nearest seam
    hsh = (ix * 73856093) ^ (iz * 19349663)
    ph = (hsh % 1000) / 1000.0; tx = ((hsh // 7) % 997) / 997.0 - 0.5; tz = ((hsh // 13) % 991) / 991.0 - 0.5
    base = hx(0x474f52)[None, None] * (0.86 + 0.26 * ph)[..., None]
    base = base * (0.88 + 0.24 * tfbm(H, W, 7, 9, SEED + 1, 5))[..., None]
    grout = sstep(0.9, 0.3, edge)                              # 1 on the seam
    alb = base * (1 - 0.55 * grout[..., None]) + hx(0x1d2022)[None, None] * (0.55 * grout[..., None])
    Hh = -0.5 * grout + (tfbm(H, W, 40, 50, SEED + 2, 3) - 0.5) * 0.08 + 0.05 * (tx * lx + tz * lz) * (1 - grout)
    rough = 0.34 + 0.10 * (ph - 0.5) + 0.12 * (tfbm(H, W, 12, 15, SEED + 9, 4) - 0.5)
    rough = rough * (1 - grout) + 0.86 * grout
    metal = np.zeros((H, W))
    # the rubber court: no seams, a fine pebble, a gold tape line round it
    cx0, cx1, cz0, cz1 = COURT
    inside = (X >= cx0) & (X <= cx1) & (Z >= cz0) & (Z <= cz1)
    peb = tfbm(H, W, 200, 260, SEED + 3, 2)
    rub = hx(0x25292b)[None, None] * (0.8 + 0.4 * peb)[..., None] * (0.9 + 0.2 * tfbm(H, W, 4, 5, SEED + 4, 3))[..., None]
    alb = np.where(inside[..., None], rub, alb); Hh = np.where(inside, (peb - 0.5) * 0.18, Hh)
    rough = np.where(inside, 0.8 + 0.12 * (peb - 0.5), rough)
    tape = (np.abs(np.maximum(np.abs(X - (cx0 + cx1) / 2) - (cx1 - cx0) / 2, np.abs(Z - (cz0 + cz1) / 2) - (cz1 - cz0) / 2)) < 1.3)
    tw = (1 - 0.7 * sstep(0.55, 0.8, tfbm(H, W, 18, 24, SEED + 5, 5)))                     # worn through in patches
    alb = np.where(tape[..., None], alb * (1 - 0.92 * tw[..., None]) + hx(0xc9993a) * (0.92 * tw[..., None]), alb)
    rough = np.where(tape, rough * (1 - tw) + 0.5 * tw, rough); Hh = Hh + 0.08 * tape * tw
    # centre line, the faintest echo of a pitch
    cl = (np.abs(X) < 0.55) & (np.abs(Z) < cz1 - 1.5)
    alb = np.where(cl[..., None], alb * 0.78 + hx(0x8b8f90) * 0.22, alb)
    # hazard aprons under both bays: paint worn back to the tile where feet go
    stripe = (((X + Z) / 5.6) % 2.0) < 1.0
    hb = (np.abs(X) < BX + 14) & (Z < Z0 + 15) & (Z > Z0 + 1)
    hr = (np.abs(Z) < RZ + 14) & (X > X1 - 15) & (X < X1 - 1)
    haz = (hb | hr)
    hzw = 1 - 0.75 * sstep(0.5, 0.75, tfbm(H, W, 10, 40, SEED + 6, 5))
    hcol = np.where(stripe[..., None], hx(0xc99a2a), hx(0x16181a))
    alb = np.where(haz[..., None], hcol * (0.75 + 0.25 * hzw[..., None]) + hx(0x45494b) * (0.25 * (1 - hzw[..., None])), alb)
    rough = np.where(haz, 0.48 * hzw + rough * (1 - hzw), rough); Hh = Hh + 0.06 * haz * hzw
    # the dock door's box (yellow) round a diamond tread plate
    px0, px1, pz0, pz1 = PLATE
    box = (X > px0) & (X < px1) & (Z > pz0) & (Z < pz1)
    inner = (X > px0 + 2.4) & (X < px1 - 2.4) & (Z > pz0 + 2.4) & (Z < pz1 - 2.4)
    boxe = box & ~inner
    alb = np.where(boxe[..., None], hx(0xc99a2a) * (0.6 + 0.4 * hzw[..., None]), alb); rough = np.where(boxe, 0.5, rough)
    P = 3.2; ci = np.floor((X - px0) / P).astype(int); cj = np.floor((Z - pz0) / P).astype(int)
    u = ((X - px0) % P) / P - 0.5; v = ((Z - pz0) % P) / P - 0.5; sg = np.where((ci + cj) % 2 == 0, 1.0, -1.0)
    a_ = (u + sg * v) * 0.7071; b_ = (v - sg * u) * 0.7071
    lug = np.clip(1 - (a_ / 0.36) ** 2 - (b_ / 0.085) ** 2, 0, 1) ** 0.5                  # the raised lozenges, alternating
    pgr = sstep(0.45, 0.8, tfbm(H, W, 5, 7, SEED + 10, 4))
    steel = hx(0x8d9398)[None, None] * (0.78 + 0.22 * tfbm(H, W, 20, 20, SEED + 11, 3))[..., None]
    steel = steel * (1 - 0.45 * (1 - lug) * (0.4 + 0.6 * pgr))[..., None] * (1 + 0.12 * lug)[..., None]
    pedge = np.minimum.reduce([X - px0 - 2.4, px1 - 2.4 - X, Z - pz0 - 2.4, pz1 - 2.4 - Z])
    alb = np.where(inner[..., None], steel, alb)
    Hh = np.where(inner, 0.22 * lug + 0.25 * sstep(0.0, 0.6, pedge), Hh)
    rough = np.where(inner, 0.3 + 0.18 * (1 - lug) + 0.22 * pgr, rough); metal = np.where(inner, 1.0 - 0.25 * pgr * (1 - lug), metal)
    # the polished path: from the door across the court corner to the cabinets
    def pth(x0, z0, x1, z1, w):
        t = np.clip(((X - x0) * (x1 - x0) + (Z - z0) * (z1 - z0)) / ((x1 - x0) ** 2 + (z1 - z0) ** 2), 0, 1)
        return np.exp(-(np.hypot(X - (x0 + t * (x1 - x0)), Z - (z0 + t * (z1 - z0))) / w) ** 2)
    path = np.maximum(pth(218, Z0 + 30, -200, -40, 16), pth(-200, -40, -200, 130, 22)) * (0.4 + 0.6 * tfbm(H, W, 6, 12, SEED + 7, 4))
    off = (~inside) & (~inner)
    alb = alb + (hx(0x7c8688)[None, None] - alb) * (0.20 * path * off)[..., None]
    rough = rough - 0.16 * path * off
    # scuffs: short curved strokes, darker rubber marks and lighter scratches, both duller than the seal
    scr = np.zeros((H, W)); lit = np.zeros((H, W))
    for _ in range(int(900 * TS + 200)):
        x = rng.uniform(0, W); y = rng.uniform(0, H); a = rng.uniform(0, math.pi); l = rng.uniform(5, 26) * px / 2
        seg_aa(lit if rng.random() < 0.4 else scr, (x, y), (x + l * math.cos(a), y + l * math.sin(a)), 1.0, rng.uniform(0.15, 0.55))
    alb = alb * (1 - 0.35 * scr[..., None]) + 0.30 * lit[..., None] * 0.7
    rough = rough + 0.14 * scr + 0.16 * lit; Hh = Hh - 0.05 * lit
    # grime, drink rings (dried glossy), gum
    stain = sstep(0.62, 0.82, tfbm(H, W, 6, 8, SEED + 8, 5)) * 0.45
    alb *= (1 - stain)[..., None]; rough = rough + 0.3 * stain
    for (sx, sz, r) in ((-60, 112, 4.5), (96, -88, 3.2), (150, 100, 5.0), (-150, -60, 3.8), (30, 135, 4.0), (-205, 20, 4.4)):
        d = np.hypot(X - sx, Z - sz); ring = np.exp(-((d - r) / 0.55) ** 2); pool = np.exp(-(d / (r * 0.8)) ** 2)
        alb *= (1 - 0.30 * ring)[..., None] * (1 - 0.12 * pool)[..., None]
        rough = rough - 0.22 * np.maximum(ring, pool) * (1 - grout)
    for _ in range(40):
        gx, gz = rng.uniform(X0 + 20, X1 - 20), rng.uniform(Z0 + 20, Z1 - 20)
        gm = np.exp(-(np.hypot(X - gx, Z - gz) / 0.8) ** 2)
        alb *= (1 - 0.35 * gm)[..., None]; rough = rough + 0.3 * gm; Hh = Hh + 0.25 * gm
    # cable runs: from the left wall to each cabinet and the vending machine
    for z in (-155, -112, -52, 4, 150):
        cab = (X < X0 + 30) & (np.abs(Z - z) < 0.9)
        alb = np.where(cab[..., None], hx(0x0c0d0e), alb); rough = np.where(cab, 0.7, rough)
        Hh = Hh + 0.35 * np.sqrt(np.clip(1 - ((Z - z) / 0.9) ** 2, 0, 1)) * (X < X0 + 30)
    # contact shadow: walls and cabinets a little (the bake adds its own), the table (not in the bake)
    ao = np.ones((H, W))
    ao *= 1 - 0.35 * np.exp(-np.minimum.reduce([X - X0, X1 - X, Z - Z0, Z1 - Z]) / 9.0)
    cabs = ((-253, -197, -183, -140), (-245, -196, -133, -84), (-256, -193, -77, -29), (-257, -193, -24, 32), (-242, -190, 119, 185))
    for xa, xb, za, zb in cabs:
        dxx = np.maximum(np.maximum(xa - X, X - xb), 0); dzz = np.maximum(np.maximum(za - Z, Z - zb), 0)
        ao *= 1 - 0.35 * np.exp(-np.hypot(dxx, dzz) / 8.0)
    dxx = np.maximum(np.abs(X) - 66, 0); dzz = np.maximum(np.abs(Z) - 38, 0)
    ao *= 1 - 0.5 * np.exp(-np.hypot(dxx, dzz) / 14.0)
    alb *= ao[..., None]
    orm = np.stack([np.ones((H, W)), np.clip(rough, 0.06, 1), np.clip(metal, 0, 1)], -1)
    return np.clip(alb, 0, 1), height_to_normal(Hh, 1 / px, 1 / px, 1.3), orm

def wall_texture(W, H):
    """One repeat of the wall: U = TILE_U units, V = the wall's full height. Row 0 = the ceiling. Returns albedo, normal, ORM.
    A rubber kick plate; blue enamel panels that bow between their seams, worn to primer and steel at the edges and low down, glossier where
    people lean; a brass dado rail; matte cream panels above, yellowed by smoke toward the ceiling, a few water runs from the top joint."""
    xx = ((np.arange(W) + .5) / W * TILE_U)[None, :] * np.ones((H, 1))
    yy = ((1 - (np.arange(H) + .5) / H) * WALL_H)[:, None] * np.ones((1, W))
    PW = TILE_U / 2.0; JT = 100.0                             # panel width, the upper panels' joint height
    pxu, pxv = TILE_U / W, WALL_H / H
    kick = yy < 9.0; low = (yy >= 9.0) & (yy < 47.0); rail = (yy >= 47.0) & (yy < 50.5); up = yy >= 50.5
    dv = np.abs(((xx + PW / 2) % PW) - PW / 2)
    dh = np.min(np.stack([np.abs(yy - 9.0), np.abs(yy - 47.0), np.abs(yy - 50.5), np.abs(yy - JT)]), 0)
    dmin = np.where(rail, 99.0, np.minimum(dv, dh))
    pid = np.floor(xx / PW).astype(int) * 7 + (yy >= JT) * 3 + low * 5
    ph = ((pid * 2654435761) % 1000) / 1000.0
    mott = tfbm(H, W, 6, 4, SEED + 21, 5)
    alb = np.zeros((H, W, 3))
    alb[kick] = hx(0x1d2124); alb[low] = hx(0x2c4b5f); alb[up] = hx(0xc9bea4)
    alb *= (0.93 + 0.12 * ph)[..., None] * (0.88 + 0.24 * mott)[..., None]
    tarn = sstep(0.4, 0.75, tfbm(H, W, 3, 8, SEED + 33, 4))
    alb = np.where(rail[..., None], hx(0xb9893a)[None, None] * (0.85 + 0.3 * sstep(47, 50.5, yy))[..., None] * (1 - 0.25 * tarn)[..., None], alb)
    # height: grooves at the seams, the rail's half-round, panels bowing between seams (a reflection wobbles across each)
    seam = np.exp(-(dmin / 0.24) ** 2)
    Hh = -0.5 * seam + 0.12 * np.exp(-((dmin - 0.7) / 0.3) ** 2) * (~up) + (tfbm(H, W, 20, 14, SEED + 22, 3) - 0.5) * 0.1
    Hh += 1.0 * (tfbm(H, W, 9, 6, SEED + 34, 3) - 0.5) * sstep(0.4, 3.0, dmin) * (low + 0.4 * up)
    Hh += np.where(rail, 0.9 * np.sqrt(np.clip(1 - ((yy - 48.75) / 1.75) ** 2, 0, 1)), 0.0) + 0.25 * kick
    alb *= (1 - 0.45 * seam * (~up) - 0.12 * seam * up)[..., None]
    def rivet(cx, cy, rr=0.65):
        ix, iy = int(cx / pxu), int((WALL_H - cy) / pxv); wr = int(rr / pxu) + 2
        ya, yb, xa, xb = max(0, iy - wr), min(H, iy + wr + 1), max(0, ix - wr), min(W, ix + wr + 1)
        if yb <= ya or xb <= xa: return
        d2 = ((xx[ya:yb, xa:xb] - cx) ** 2 + (yy[ya:yb, xa:xb] - cy) ** 2) / (rr * rr)
        Hh[ya:yb, xa:xb] += 0.45 * np.sqrt(np.clip(1 - d2, 0, 1)); alb[ya:yb, xa:xb] *= (1 - 0.18 * np.clip(1 - d2 * 0.6, 0, 1))[..., None]
    for k in range(2):
        for sx in (k * PW + 2.4, k * PW + PW - 2.4):
            for yv in np.arange(11.0, 45.0, 6.5): rivet(sx % TILE_U, yv)
        for xv in np.arange(k * PW + 6.0, (k + 1) * PW - 3, 6.0): rivet(xv, 44.6); rivet(xv, 11.4)
    # wear: chips (sunk to the primer or steel) near the seams and the floor, rust under the rivets, scuffs low down, grime
    score = tfbm(H, W, 40, 24, SEED + 23, 5) + 0.26 * np.exp(-dmin / 1.4) + 0.2 * np.exp(-(yy - 9) / 10.0) - 0.82
    chip = sstep(0.0, 0.05, score) * low; prim = sstep(-0.03, 0.0, score) * low * (1 - chip)
    prime = np.where((tfbm(H, W, 8, 5, SEED + 35, 3) > 0.5)[..., None], hx(0x6e4a3a), hx(0x868a8c))
    alb = alb * (1 - prim[..., None] * 0.5) + hx(0x5a4a42) * (0.5 * prim[..., None])
    alb = alb * (1 - chip[..., None]) + prime * chip[..., None]; Hh -= 0.3 * chip
    rust = sstep(0.7, 0.86, tfbm(H, W, 3, 36, SEED + 24, 4, 0.6)) * np.clip(np.exp(-dv / 1.5) * 0.6 + np.exp(-(yy - 9) / 8.0) * 0.3, 0, 1) * low * (1 - chip)
    alb = alb * (1 - 0.35 * rust[..., None]) + hx(0x5e3624) * (0.35 * rust[..., None])
    scr = np.zeros((H, W))
    for _ in range(int(240 * TS + 60)):
        x = rng.uniform(0, W); y = H - rng.uniform(0, H * (44.0 / WALL_H)); a = rng.uniform(0, math.pi); l = rng.uniform(5, 30) * TS * 2
        seg_aa(scr, (x, y), (x + l * math.cos(a), y + l * math.sin(a) * 0.5), 1.0, rng.uniform(0.15, 0.55))
    alb = alb * (1 - 0.3 * scr[..., None]) + 0.25 * scr[..., None] * 0.8
    # the upper panels: smoke toward the ceiling, a few water runs off the top joint and the ceiling, grime
    smoke = sstep(WALL_H - 36, WALL_H, yy) * up
    alb *= (1 - 0.36 * smoke)[..., None] * (np.array([1.0, 0.96, 0.88])[None, None] ** smoke[..., None])
    rub = np.exp(-(yy - 50.5) / 7.0) * up * sstep(0.4, 0.7, tfbm(H, W, 2, 5, SEED + 38, 4))           # shoulders and chair backs above the rail
    alb *= (1 - 0.18 * rub)[..., None] * (1 + 0.06 * (ph - 0.5) * up)[..., None]
    col = sstep(0.62, 0.8, tfbm(1, W, 1, 9, SEED + 36, 3))[0][None, :]
    runs = sstep(0.55, 0.85, tfbm(H, W, 3, 60, SEED + 25, 3, 0.6)) * col * up * (np.exp(-(WALL_H - yy) / 26.0) + 0.7 * np.exp(-np.abs(yy - JT) / 14.0) * (yy < JT))
    alb *= (1 - 0.22 * runs)[..., None]
    grime = tfbm(H, W, 5, 3, SEED + 26, 4)
    alb *= (0.84 + 0.28 * grime)[..., None]
    # roughness: enamel, glossier where people lean, matte under grime; matte paint above; a tarnished rail; steel at the chips
    hands = np.exp(-((yy - 36.0) / 9.0) ** 2) * sstep(0.45, 0.75, tfbm(H, W, 3, 2, SEED + 37, 4)) * low
    rough = np.select([kick, low, up], [0.72, 0.36, 0.74], 0.3) + 0.08 * (tfbm(H, W, 20, 12, SEED + 27, 3) - 0.5)
    rough = rough + 0.22 * sstep(0.5, 0.85, grime) + 0.2 * rust + 0.2 * scr - 0.16 * hands + 0.12 * runs + 0.1 * smoke + 0.3 * prim + 0.2 * seam - 0.18 * rub
    rough = np.where(rail, 0.22 + 0.3 * tarn, rough); rough = np.where(chip > 0.5, 0.4, rough)
    metal = np.where(rail, 1.0 - 0.2 * tarn, chip * np.where(prime[..., 1] > 0.4, 1.0, 0.2))
    orm = np.stack([np.ones((H, W)), np.clip(rough, 0.06, 1), np.clip(metal, 0, 1)], -1)
    return np.clip(alb, 0, 1), height_to_normal(Hh, pxu, pxv, 1.0, wrap_x=True), orm

def glass_texture(W, H):
    X, Y = np.meshgrid((np.arange(W) + .5) / W, (np.arange(H) + .5) / H)
    edge = np.minimum(np.minimum(X, 1 - X) * 1.8, np.minimum(Y, 1 - Y) * 2.4)
    dirt = np.exp(-edge * 6.0) * (0.4 + 0.5 * tfbm(H, W, 6, 5, SEED + 31, 4))
    streak = np.zeros_like(X)
    for c, w, a in ((0.25, 0.04, 0.26), (0.34, 0.012, 0.16), (0.74, 0.05, 0.18)):
        streak = np.maximum(streak, a * np.exp(-(((X + Y * 0.6) - (c + 0.3)) / w) ** 2))
    smear = sstep(0.55, 0.8, tfbm(H, W, 4, 5, SEED + 32, 4)) * 0.14
    a = np.clip(0.04 + 0.26 * dirt + 0.22 * streak + smear * 0.6, 0, 0.55)
    rgb = np.stack([0.60 + 0.35 * streak, 0.70 + 0.28 * streak, 0.74 + 0.24 * streak], -1) * (1 - 0.6 * dirt[..., None])
    return np.clip(rgb, 0, 1), a

GLOW_W, GLOW_H = 1024, 512
GA = {'sign': (0, 0, 1024, 192), 'warm': (0, 192, 128, 320), 'cool': (128, 192, 256, 320), 'cone': (256, 192, 384, 320),
      'scrA': (384, 192, 512, 320), 'scrB': (512, 192, 640, 320), 'scrC': (640, 192, 768, 320), 'door': (768, 192, 896, 320),
      'win': (0, 320, 512, 512), 'strip': (512, 320, 1024, 512)}
def glow_texture():
    img = np.zeros((GLOW_H, GLOW_W, 4), np.float32)
    def region(reg): x0, y0, x1, y1 = GA[reg]; return x0, y0, x1, y1, y1 - y0, x1 - x0
    def fill(reg, rgb, a):
        x0, y0, x1, y1, h, w = region(reg); img[y0:y1, x0:x1, :3] = rgb; img[y0:y1, x0:x1, 3] = a
    x0, y0, x1, y1, h, w = region('sign')
    ink = np.zeros((h, w)); draw_text(ink, 'STARPORT ARCADE', w / 2, h / 2 - 4, 82.0, 1.0, 9.0)
    rule = np.zeros((h, w)); seg_aa(rule, (w * 0.17, h - 15), (w * 0.83, h - 15), 4.0)
    halo = 1 - np.exp(-(1.8 * gblur(ink, 4.0, False) + 2.4 * gblur(ink, 12.0, False) + 3.0 * gblur(ink, 30.0, False)))
    a = np.clip(np.maximum(halo * 0.78, np.maximum(ink, rule * 0.8)), 0, 1)
    solid = np.clip(np.maximum(ink, rule * 0.85), 0, 1)
    gold = np.array([1.0, 0.72, 0.30]); warm = np.array([1.0, 0.55, 0.18])
    rgb = gold[None, None] * solid[..., None] + warm[None, None] * (1 - solid[..., None])
    img[y0:y1, x0:x1, :3] = rgb; img[y0:y1, x0:x1, 3] = a
    for reg, rgbc in (('warm', (1.0, 0.76, 0.46)), ('cool', (0.68, 0.82, 1.0)), ('door', (1.0, 0.45, 0.22))):
        x0, y0, x1, y1, h, w = region(reg); yy, xx = np.mgrid[0:h, 0:w]; d = np.hypot((xx + .5) / w - .5, (yy + .5) / h - .5) * 2
        fill(reg, rgbc, (np.exp(-(d / 0.4) ** 2) * 0.75 + np.exp(-(d / 0.8) ** 2) * 0.3) * (1 - sstep(0.7, 1.0, d)))
    x0, y0, x1, y1, h, w = region('cone'); yy, xx = np.mgrid[0:h, 0:w]; u = (xx + .5) / w - .5; v = (yy + .5) / h
    fill('cone', (1.0, 0.72, 0.4), np.exp(-(u / (0.04 + 0.5 * v)) ** 2) * (1 - v) ** 1.6 * 0.5)       # a lamp's cone down a wall: v = 0 at the lamp
    for reg, rgbc in (('scrA', (0.40, 0.85, 0.78)), ('scrB', (1.0, 0.68, 0.30)), ('scrC', (0.52, 0.64, 1.0))):
        x0, y0, x1, y1, h, w = region(reg); yy, xx = np.mgrid[0:h, 0:w]; d = np.hypot((xx + .5) / w - .5, (yy + .5) / h - .5) * 2
        fill(reg, rgbc, np.exp(-(d / 0.62) ** 2) * 0.42 * (1 - sstep(0.75, 1.0, d)))
    x0, y0, x1, y1, h, w = region('win'); yy, xx = np.mgrid[0:h, 0:w]; u = (xx + .5) / w; v = 1 - (yy + .5) / h
    pane = (u * NPANE) % 1.0
    bar = sstep(0.0, 0.07, pane) * sstep(0.0, 0.07, 1 - pane)                         # the mullion shadows between panes
    reach = np.exp(-(v / 0.55) ** 2) * (1 - sstep(0.6, 1.0, v))
    fill('win', (0.80, 0.90, 1.0), bar * reach * 0.36 * sstep(0.0, 0.04, v))
    x0, y0, x1, y1, h, w = region('strip'); yy, xx = np.mgrid[0:h, 0:w]; u = (xx + .5) / w; v = (yy + .5) / h
    fill('strip', (0.95, 0.97, 1.0), np.exp(-((v - 0.5) / 0.28) ** 2) * 0.34 * sstep(0, 0.08, u) * (1 - sstep(0.92, 1, u)))
    rgb = img[..., :3]; empty = img[..., 3] < 1e-3
    for c in range(3): rgb[..., c] = np.where(empty, 0.7, rgb[..., c])
    return np.clip(img, 0, 1)

def attract_screen(N, kind):
    """A 4:3 attract-mode picture from the stroke font and a few blocks: the cabinets that had a dead screen."""
    a = np.zeros((N, N)); b = np.zeros((N, N))
    g = np.random.default_rng(SEED + 70 + kind)
    for r in range(3):                                           # a block formation
        for c in range(8):
            if g.random() < 0.9:
                x, y = N * (0.18 + c * 0.085), N * (0.20 + r * 0.075)
                a[int(y):int(y + N * 0.04), int(x):int(x + N * 0.055)] = 1.0
    seg_aa(b, (N * 0.1, N * 0.84), (N * 0.9, N * 0.84), 3.0)
    ink = np.zeros((N, N)); draw_text(ink, 'INSERT COIN' if kind == 0 else 'PRESS START', N * 0.5, N * 0.62, N * 0.085, 1.0, max(2.0, N * 0.014))
    top = np.zeros((N, N)); draw_text(top, 'HI-SCORE', N * 0.5, N * 0.08, N * 0.055, 1.0, max(1.5, N * 0.009))
    ys = np.arange(N)[:, None] * np.ones((1, N)); scan = 0.88 + 0.12 * ((ys % 4) < 2)
    cols = ((0.30, 0.78, 0.70), (0.95, 0.62, 0.26)) if kind == 0 else ((0.95, 0.62, 0.26), (0.5, 0.7, 1.0))
    bgc = np.array((0.02, 0.05, 0.09)) if kind == 0 else np.array((0.07, 0.04, 0.02))
    vv = np.linspace(0, 1, N)[:, None] * np.ones((1, N))
    img = bgc[None, None] * (1 + 1.5 * vv[..., None]) + np.array(cols[0])[None, None] * (a * 0.55)[..., None]
    img = img + np.array(cols[1])[None, None] * np.clip(ink + b * 0.6, 0, 1)[..., None] + np.array(cols[0])[None, None] * top[..., None] * 0.8
    return np.clip(img * scan[..., None], 0, 1)

# =============================================================================================
# GEOMETRY
# =============================================================================================
class Acc:
    """V world (game) corners, L the same in the piece's own frame and O a per-piece UV offset (the surface set is projected in the piece's frame)."""
    def __init__(s): s.V, s.L, s.O, s.F, s.S = [], [], [], [], []
    def add(s, M, parts):
        off = (float(rng.uniform(0, 64)), float(rng.uniform(0, 64)))
        for V, F, sm in parts:
            o = len(s.V); s.V.extend((M @ v) for v in V); s.L.extend(Vector(v) for v in V); s.O.extend([off] * len(V))
            s.F.extend(tuple(o + i for i in f) for f in F); s.S.extend([sm] * len(F))
ACC = {}
def put(name, M, parts): ACC.setdefault(name, Acc()).add(M, parts)
LAMPS = []     # (game xyz, colour hex, strength): the room's own lamps for the bake (strength = brightness x cm^2 at the lamp)
def grid(mat, p0, eu, ev, nu, nv, nrm):
    """A flat rectangle p0 + eu*s + ev*t split nu x nv, facing nrm, into a prop material (so the bake has corners to shade)."""
    p0, eu, ev = Vector(p0), Vector(eu), Vector(ev)
    if eu.cross(ev).dot(Vector(nrm)) < 0: eu, ev, nu, nv = ev, eu, nv, nu
    V = [p0 + eu * (i / nu) + ev * (j / nv) for j in range(nv + 1) for i in range(nu + 1)]
    F = [(j * (nu + 1) + i, j * (nu + 1) + i + 1, (j + 1) * (nu + 1) + i + 1, (j + 1) * (nu + 1) + i) for j in range(nv) for i in range(nu)]
    put(mat, Matrix.Identity(4), [(V, F, False)])
def loc(x, y, z): return Matrix.Translation((x, y, z))
def rot_y(deg): return Matrix.Rotation(math.radians(deg), 4, 'Y')
def rot_z(deg): return Matrix.Rotation(math.radians(deg), 4, 'Z')
def rot_x(deg): return Matrix.Rotation(math.radians(deg), 4, 'X')
def outward(V, F, centre=None):
    """Wind each face of a convex piece so its normal points away from the piece's centre."""
    c = centre if centre is not None else sum(V, Vector()) / len(V); out = []
    for f in F:
        pts = [V[i] for i in f]; n = Vector()
        for k in range(len(pts)):
            a, b = pts[k], pts[(k + 1) % len(pts)]
            n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        out.append(tuple(f) if n.dot(sum(pts, Vector()) / len(pts) - c) >= 0 else tuple(f)[::-1])
    return out
def p_box(sx, sy, sz):
    h = (sx / 2, sy / 2, sz / 2)
    V = [Vector((a * h[0], b * h[1], c * h[2])) for a in (-1, 1) for b in (-1, 1) for c in (-1, 1)]
    F = [(0, 1, 3, 2), (4, 5, 7, 6), (0, 1, 5, 4), (2, 3, 7, 6), (0, 2, 6, 4), (1, 3, 7, 5)]
    return [(V, outward(V, F, Vector()), False)]
def p_cyl(r, h, seg=14, r2=None):
    r2 = r if r2 is None else r2
    V = [Vector((r * math.cos(2 * math.pi * k / seg), -h / 2, r * math.sin(2 * math.pi * k / seg))) for k in range(seg)]
    V += [Vector((r2 * math.cos(2 * math.pi * k / seg), h / 2, r2 * math.sin(2 * math.pi * k / seg))) for k in range(seg)]
    side = [(k, (k + 1) % seg, seg + (k + 1) % seg, seg + k) for k in range(seg)]
    return [(V, outward(V, side, Vector()), True), (V, outward(V, [tuple(range(seg))], Vector((0, -h, 0))), False), (V, outward(V, [tuple(range(seg, 2 * seg))], Vector((0, h, 0))), False)]
def box(mat, c, s, yaw=0.0, tilt=0.0): put(mat, loc(*c) @ rot_y(yaw) @ rot_z(tilt), p_box(*s))
def cyl(mat, c, r, h, seg=14, r2=None, axis='y', yaw=0.0):
    M = loc(*c) @ rot_y(yaw)
    if axis == 'x': M = M @ rot_z(90)
    elif axis == 'z': M = M @ rot_x(90)
    put(mat, M, p_cyl(r, h, seg, r2))

# textured pieces: per material {V, F, UV, COL}
TEXM = {}
def tmesh(mat): return TEXM.setdefault(mat, {'V': [], 'F': [], 'UV': [], 'COL': []})
def tquad(mat, p0, eu, ev, nrm, nu=1, nv=1, uv=None, ao=None):
    """A rectangle p0 + eu*s + ev*t (game coords), nu x nv cells, facing nrm. uv(p) -> (u, v); ao(p) -> shade 0..1."""
    A = tmesh(mat); p0 = np.array(p0, float); eu = np.array(eu, float); ev = np.array(ev, float)
    if np.dot(np.cross(eu, ev), nrm) < 0: eu, ev, nu, nv = ev, eu, nv, nu
    o = len(A['V'])
    for j in range(nv + 1):
        for i in range(nu + 1):
            p = p0 + eu * (i / nu) + ev * (j / nv)
            A['V'].append(g2b(*p)); A['UV'].append(uv(p) if uv else (i / nu, j / nv))
            c = ao(p) if ao else 1.0; A['COL'].append((c, c * 0.985, c * 0.96, 1.0))
    for j in range(nv):
        for i in range(nu):
            a = o + j * (nu + 1) + i; A['F'].append((a, a + 1, a + nu + 2, a + nu + 1))

# ---- the glow cards (one blended material, one atlas) -----------------------------------------------
GLW = {'V': [], 'F': [], 'UV': []}
def glow_uv(reg, u, v):
    x0, y0, x1, y1 = GA[reg]; return ((x0 + (x1 - x0) * u) / GLOW_W, 1.0 - (y1 - (y1 - y0) * v) / GLOW_H)
def glow_quad(c, right, up, w, h, reg, flip_v=False):
    o = len(GLW['V']); c = np.array(c, float); R = np.array(right, float); R = R / np.linalg.norm(R) * (w / 2)
    U = np.array(up, float); U = U / np.linalg.norm(U) * (h / 2)
    for sx, sy, u, v in ((-1, -1, 0, 0), (1, -1, 1, 0), (1, 1, 1, 1), (-1, 1, 0, 1)):
        p = c + R * sx + U * sy; GLW['V'].append(g2b(*p)); GLW['UV'].append(glow_uv(reg, u, 1 - v if flip_v else v))
    GLW['F'].append((o, o + 1, o + 2, o + 3))
def glow_floor(x0, x1, z0, z1, reg, vfrom='z0', y=None):
    """A card lying on the floor; v runs from the z0 (or x0) edge away. A card on the floor faces +y."""
    y = FL + 0.35 if y is None else y; o = len(GLW['V'])
    corners = [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
    for (x, z) in corners:
        if vfrom == 'z0': u, v = (x - x0) / (x1 - x0), (z - z0) / (z1 - z0)
        elif vfrom == 'z1': u, v = (x - x0) / (x1 - x0), 1 - (z - z0) / (z1 - z0)
        elif vfrom == 'x1': u, v = (z - z0) / (z1 - z0), 1 - (x - x0) / (x1 - x0)
        else: u, v = (z - z0) / (z1 - z0), (x - x0) / (x1 - x0)
        GLW['V'].append(g2b(x, y, z)); GLW['UV'].append(glow_uv(reg, u, v))
    GLW['F'].append((o, o + 3, o + 2, o + 1))


# =============================================================================================
# IMAGES AND MATERIALS
# =============================================================================================
print('arcade: textures')
FW = max(256, int(2048 * TS) // 4 * 4); FH = int(FW * D_ROOM / W_ROOM) // 4 * 4
fa, fn, fo = floor_texture(FW, FH)
im_fa = new_img('arcade_floor_albedo', FW, FH); np_img(im_fa, fa)
im_fn = new_img('arcade_floor_normal', FW // 2, FH // 2, True); np_img(im_fn, fn[::2, ::2])
im_fo = new_img('arcade_floor_orm', FW // 2, FH // 2, True); np_img(im_fo, fo[::2, ::2])
WW, WH_ = max(128, int(1024 * TS) // 4 * 4), max(192, int(1536 * TS) // 4 * 4)
wa, wn, wo = wall_texture(WW, WH_)
im_wa = new_img('arcade_wall_albedo', WW, WH_); np_img(im_wa, wa)
im_wn = new_img('arcade_wall_normal', WW, WH_, True); np_img(im_wn, wn)
im_wo = new_img('arcade_wall_orm', WW // 2, WH_ // 2, True); np_img(im_wo, wo[::2, ::2])
gcol, galpha = glass_texture(max(64, int(512 * TS) // 4 * 4), max(64, int(512 * TS) // 4 * 4))
im_gl = new_img('arcade_glass', gcol.shape[1], gcol.shape[0], alpha=True); np_img(im_gl, gcol, galpha)
glw = glow_texture(); im_gw = new_img('arcade_glow', GLOW_W, GLOW_H, alpha=True); np_img(im_gw, glw[..., :3], glw[..., 3])
AN = max(128, int(256 * TS) // 4 * 4)
im_sa = new_img('arcade_screen_a', AN, AN); np_img(im_sa, attract_screen(AN, 0))
im_sb = new_img('arcade_screen_b', AN, AN); np_img(im_sb, attract_screen(AN, 1))
IMGS = [im_fa, im_fn, im_fo, im_wa, im_wn, im_wo, im_gl, im_gw, im_sa, im_sb]

print('arcade: surface sets')
SN = max(128, int(512 * TS) // 4 * 4)
def surf_imgs(kind, nrm, orm, alb=None, mean=1.0, albs=None):
    S = {'mean': mean, 'albs': {}, 'alb': None}
    S['n'] = new_img('arcade_%s_normal' % kind, nrm.shape[1], nrm.shape[0], True); np_img(S['n'], nrm)
    S['orm'] = new_img('arcade_%s_orm' % kind, orm.shape[1], orm.shape[0], True); np_img(S['orm'], orm)
    IMGS.extend([S['n'], S['orm']])
    if alb is not None: S['alb'] = new_img('arcade_%s_albedo' % kind, alb.shape[1], alb.shape[0]); np_img(S['alb'], alb); IMGS.append(S['alb'])
    for mat, a in (albs or {}).items():
        im = new_img(mat + '_albedo', a.shape[1], a.shape[0]); np_img(im, a); S['albs'][mat] = im; IMGS.append(im)
    SURF[kind] = S
for kind, fn_ in (('steel', R.steel_set), ('brass', R.brass_set), ('plastic', R.plastic_set)):
    a_, m_, n_, o_ = fn_(SN, SEED); surf_imgs(kind, n_, o_, a_, m_)
pn_, po_, PM = R.paint_set(SN, SEED)
PAINTED = {'gun': 0x2e353a, 'ceil': 0x24262a, 'red': 0xa5322a, 'yellow': 0xd2a21e, 'door': 0x3b474e}
surf_imgs('paint', pn_, po_, albs={'arcade_' + k: R.paint_albedo(PM, h) for k, h in PAINTED.items()})
wn_, wo_, WM = R.wood_set(SN, SEED, raw=True)
surf_imgs('wood', wn_, wo_, albs={'arcade_crate': R.wood_albedo(WM, 0xb48a58, 0x7a5532), 'arcade_wood': R.wood_albedo(WM, 0x8a7860, 0x4e4234)})

MATS = {
    'floor': tex_mat('arcade_floor', im_fa, im_fn, vcol=True, orm=im_fo),
    'wall':  tex_mat('arcade_wall', im_wa, im_wn, vcol=True, orm=im_wo),
    'glass': tex_mat('arcade_glass', im_gl, None, alpha_img=True, rough=0.06),
    'glow':  glow_mat('arcade_glow', im_gw),
}
FLAT = {   # name: (hex, metal, rough, emissive hex, strength, surface kind); with a kind, metal and rough scale the set's ORM (painted and wood ones carry their own colour)
    'ceil':   (0x24262a, 1.0, 1.0, None, 1, 'paint'),
    'gun':    (0x2e353a, 1.0, 0.85, None, 1, 'paint'),
    'steel':  (0x9aa3a8, 1.0, 1.0, None, 1, 'steel'),
    'brass':  (0xc9973f, 1.0, 1.0, None, 1, 'brass'),
    'rubber': (0x121315, 1.0, 0.95, None, 1, 'plastic'),
    'cream':  (0xcfc5ac, 1.0, 0.9, None, 1, 'plastic'),
    'blue':   (0x2c4b5f, 1.0, 0.9, None, 1, 'plastic'),
    'cork':   (0x8f6a46, 1.0, 1.0, None, 1, 'plastic'),
    'red':    (0xa5322a, 1.0, 0.8, None, 1, 'paint'),
    'yellow': (0xd2a21e, 1.0, 0.9, None, 1, 'paint'),
    'wood':   (0x5a4331, 1.0, 1.0, None, 1, 'wood'),
    'crate':  (0x7d5c38, 1.0, 1.0, None, 1, 'wood'),
    'door':   (0x3b474e, 1.0, 0.8, None, 1, 'paint'),
    'lamp':   (0xffe0b0, 0.0, 0.5, 0xffb868, 2.2, None),
    'tube':   (0xf2f0e6, 0.0, 0.5, 0xdfe8f0, 2.4, None),
    'screen': (0x103030, 0.0, 0.3, 0x6fe0c0, 1.5, None),
    'doorlt': (0x301008, 0.0, 0.4, 0xff6a3a, 2.0, None),
    'plant':  (0x3f6a3a, 1.0, 0.75, None, 1, 'plastic'),
}
for k, (h, m, r, e, es, kd) in FLAT.items(): MATS[k] = flat_mat('arcade_' + k, h, m, r, e, es, kd)

# =============================================================================================
# THE SHELL: floor, walls, the two bays, ceiling
# =============================================================================================
print('arcade: shell')
from mathutils import noise as mnoise
def wall_ao(p):
    x, y, z = p; h = y - FL
    a = 0.62 + 0.38 * float(sstep(0, 26, h)); a *= 1 - 0.30 * float(sstep(CEIL - 22, CEIL, y))
    d = max(min(x - X0, X1 - x), min(z - Z0, Z1 - z)); a *= 1 - 0.30 * math.exp(-d / 9.0)
    n = mnoise.fractal(Vector((x / 60.0, y / 40.0, z / 60.0)) + Vector((3.1, 7.7, 1.3)), 0.7, 2.0, 3)
    return max(0.35, min(1.0, a * (0.88 + 0.26 * (n * 0.5 + 0.5))))
def wall_piece(axis, a0, a1, y0, y1):
    """A room-facing wall rectangle. axis: 'z0' back (z=Z0), 'z1' front, 'x0' left, 'x1' right; a = x for the z walls, z for the x walls."""
    nu = max(1, int(math.ceil(abs(a1 - a0) / 12.0))); nv = max(1, int(math.ceil((y1 - y0) / 12.0)))     # cells the bake shades
    if axis in ('z0', 'z1'):
        zz = Z0 if axis == 'z0' else Z1; nrm = (0, 0, 1) if axis == 'z0' else (0, 0, -1)
        p0 = (a0, y0, zz); eu = (a1 - a0, 0, 0); uvf = lambda p: ((p[0] - X0) / TILE_U, (p[1] - FL) / WALL_H)
    else:
        xx = X0 if axis == 'x0' else X1; nrm = (1, 0, 0) if axis == 'x0' else (-1, 0, 0)
        p0 = (xx, y0, a0); eu = (0, 0, a1 - a0); uvf = lambda p: ((p[2] - Z0) / TILE_U, (p[1] - FL) / WALL_H)
    tquad('wall', p0, eu, (0, y1 - y0, 0), nrm, nu, nv, uvf, wall_ao)

tquad('floor', (X0, FL, Z0), (W_ROOM, 0, 0), (0, 0, D_ROOM), (0, 1, 0), 52, 41, lambda p: ((p[0] - X0) / W_ROOM, 1 - (p[2] - Z0) / D_ROOM))
wall_piece('z0', X0, -BX, FL, CEIL); wall_piece('z0', BX, X1, FL, CEIL)
wall_piece('z0', -BX, BX, FL, SILL); wall_piece('z0', -BX, BX, HEAD, CEIL)
wall_piece('x1', Z0, -RZ, FL, CEIL); wall_piece('x1', RZ, Z1, FL, CEIL)
wall_piece('x1', -RZ, RZ, FL, SILL); wall_piece('x1', -RZ, RZ, HEAD, CEIL)
wall_piece('x0', Z0, Z1, FL, CEIL); wall_piece('z1', X0, X1, FL, CEIL)
grid('ceil', (X0, CEIL, Z0), (W_ROOM, 0, 0), (0, 0, D_ROOM), 43, 34, (0, -1, 0))

# ---- the bays: frame slabs inside the opening, a sill shelf, mullions, glass --------------------
def bay(axis, half):
    """axis 'z0' = the back wall (runs along x), 'x1' = the right wall (runs along z)."""
    def at(a, y, depth):                    # a along the wall, depth into the wall (negative = out into the room)
        return (a, y, Z0 - depth) if axis == 'z0' else (X1 + depth, y, a)
    def slab(a, y, wa_, hy, dp, mat):
        c = at(a, y, dp / 2)
        box(mat, c, (wa_, hy, dp) if axis == 'z0' else (dp, hy, wa_))
    ym = (SILL + HEAD) / 2
    slab(0, SILL + 1.5, 2 * half, 3.0, WT, 'gun'); slab(0, HEAD - 1.5, 2 * half, 3.0, WT, 'gun')
    for sg in (-1, 1): slab(sg * (half - 1.5), ym, 3.0, HEAD - SILL, WT, 'gun')
    c = at(0, SILL + 1.5, -4.0); box('steel', c, (2 * half + 8, 3.0, 8.0) if axis == 'z0' else (8.0, 3.0, 2 * half + 8))
    c = at(0, SILL + 3.2, -7.6); box('brass', c, (2 * half + 8, 0.9, 1.0) if axis == 'z0' else (1.0, 0.9, 2 * half + 8))
    n = NPANE; span = 2 * (half - 3.0); y0, y1 = SILL + 3.0, HEAD - 3.0
    for k in range(1, n):
        a = -(half - 3.0) + span * k / n
        box('gun', at(a, ym, GLASS_IN), (2.6, y1 - y0, 4.5) if axis == 'z0' else (4.5, y1 - y0, 2.6))
    A = tmesh('glass'); nrm = (0, 0, 1) if axis == 'z0' else (-1, 0, 0)
    for k in range(n):
        a0 = -(half - 3.0) + span * k / n + 1.3 * (k > 0); a1 = -(half - 3.0) + span * (k + 1) / n - 1.3 * (k < n - 1)
        p0 = np.array(at(a0, y0, GLASS_IN), float); p1 = np.array(at(a1, y0, GLASS_IN), float); up = np.array((0.0, y1 - y0, 0.0))
        quad = [p0, p1, p1 + up, p0 + up]
        if np.dot(np.cross(p1 - p0, up), nrm) < 0: quad = [p1, p0, p0 + up, p1 + up]
        uvs = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)] if k % 2 == 0 else [(1.0, 0.0), (0.0, 0.0), (0.0, 1.0), (1.0, 1.0)]
        o = len(A['V'])
        for q, uv in zip(quad, uvs): A['V'].append(g2b(*q)); A['UV'].append(uv); A['COL'].append((1, 1, 1, 1))
        A['F'].append((o, o + 1, o + 2, o + 3))
bay('z0', BX); bay('x1', RZ)
for x in np.arange(-150.0, 151.0, 50.0): LAMPS.append(((float(x), 20.0, Z0 - 3.0), 0x9cc2ff, 450))      # the docks' light through the bays
for z in np.arange(-110.0, 111.0, 44.0): LAMPS.append(((X1 + 3.0, 20.0, float(z)), 0x9cc2ff, 360))

# ---- ceiling furniture: beams, pipes, long tubes ------------------------------------------------
for x in (-175.0, -58.0, 58.0, 175.0): box('gun', (x, CEIL - 5.0, 0), (9.0, 10.0, D_ROOM))
for z in (-120.0, 120.0): box('gun', (0, CEIL - 3.5, z), (W_ROOM, 7.0, 6.0))
cyl('steel', (0, CEIL - 9.0, Z0 + 7.0), 3.0, W_ROOM, 12, axis='x'); cyl('steel', (0, CEIL - 16.0, Z0 + 7.0), 2.0, W_ROOM, 10, axis='x')
cyl('steel', (X1 - 7.0, CEIL - 9.0, 0), 3.0, D_ROOM, 12, axis='z')
for sx, sz in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
    box('tube', (sx * 118.0, CEIL - 1.8, sz * 70.0), (70.0, 1.6, 7.0))
    box('gun', (sx * 118.0, CEIL - 0.9, sz * 70.0), (74.0, 0.8, 9.0))
    for dx in (-24.0, 0.0, 24.0): LAMPS.append(((sx * 118.0 + dx, CEIL - 4.0, sz * 70.0), 0xdfe8f0, 1200))

# =============================================================================================
# PROPS, LIGHT CARDS, THE SIGN
# =============================================================================================
print('arcade: props')
# the sign over the far bay: a plate, lettering and its halo are the glow atlas's 'sign' region
box('gun', (0, 76, Z0 + 2.0), (154, 34, 3.0))
glow_quad((0, 76, Z0 + 3.9), (1, 0, 0), (0, 1, 0), 146, 27.4, 'sign')
for sx in (-1, 1): box('brass', (sx * 79, 76, Z0 + 2.0), (2.5, 34, 3.4))
for x in (-50.0, 0.0, 50.0): LAMPS.append(((x, 76.0, Z0 + 9.0), 0xffb848, 450))

# the dock door in the far wall's right pier
for sx in (-1, 1): box('gun', (DX + sx * 29.0, (FL + 40) / 2, Z0 + 3.0), (6, 84, 6))
box('gun', (DX, 38, Z0 + 3.0), (64, 6, 6))
box('door', (DX, (FL + 35) / 2, Z0 + 1.5), (52, 79, 3))
for yy in (FL + 3, 33.0): box('yellow', (DX, yy, Z0 + 3.2), (52, 3, 0.6))
box('steel', (DX + 17, -4, Z0 + 4.5), (3, 22, 3))
cyl('steel', (DX, 14, Z0 + 3.4), 8.8, 1.8, 20, axis='z'); cyl('doorlt', (DX, 14, Z0 + 4.4), 6.4, 0.8, 20, axis='z')
glow_quad((DX, 14, Z0 + 5.0), (1, 0, 0), (0, 1, 0), 30, 30, 'door')
LAMPS.append(((DX, 14.0, Z0 + 8.0), 0xff6a3a, 200))

# wall lamps on the far wall's piers and either side of the notice board: bracket, bulb, halo, the cone they throw down the wall
for sx, zw, sg in ((-236.0, Z0, 1), (-196.0, Z0, 1), (194.0, Z0, 1), (242.0, Z0, 1), (-14.0, Z1, -1), (134.0, Z1, -1)):
    box('brass', (sx, 58, zw + sg * 2.2), (4, 11, 4.4))
    cyl('lamp', (sx, 60, zw + sg * 5.6), 3.0, 7.0, 12)
    glow_quad((sx, 60, zw + sg * 7.2), (sg, 0, 0), (0, 1, 0), 30, 30, 'warm')
    glow_quad((sx, 38, zw + sg * 0.7), (sg, 0, 0), (0, 1, 0), 34, 46, 'cone')
    LAMPS.append(((sx, 60.0, zw + sg * 9.0), 0xffb868, 1100))

# a cable tray along the left wall, conduit, and the cabinets' sockets
box('gun', (X0 + 3, 88, 0), (6, 3.0, D_ROOM - 6))
cyl('steel', (X0 + 2.5, 82, 0), 1.6, D_ROOM - 6, 8, axis='z')
for z in (-155, -112, -52, 4, 150): box('rubber', (X0 + 2, FL + 14, z), (3, 8, 5))

# change machine and a bin between the cabinets
CZ = 66.0
box('gun', (-248, FL + 34, CZ), (22, 68, 32)); box('steel', (-236.5, FL + 40, CZ), (1.0, 40, 26))
box('screen', (-236.0, FL + 52, CZ), (1.0, 7, 13)); box('brass', (-236.0, FL + 40, CZ - 8), (1.2, 8, 1.4)); box('rubber', (-236.0, FL + 22, CZ), (1.6, 5, 11))
box('red', (-236.0, FL + 61, CZ), (0.8, 3, 24))
glow_floor(-236, -190, CZ - 24, CZ + 24, 'scrA')
LAMPS.append(((-231.0, FL + 52.0, CZ), 0x6fe0c0, 120))
cyl('steel', (-246, FL + 10, 104), 6.5, 20, 14); cyl('rubber', (-246, FL + 20.5, 104), 7.0, 2.0, 14)

# a corner of crates (front right), a pallet under them
box('wood', (222, FL + 2, 176), (36, 4, 36)); box('crate', (222, FL + 14, 176), (30, 20, 30), yaw=8)
box('crate', (196, FL + 10, 186), (22, 16, 22), yaw=-14); box('crate', (221, FL + 33, 177), (20, 18, 20), yaw=26)
box('cream', (196, FL + 20.5, 186), (23, 1.2, 23), yaw=-14)

# the front wall: a cork notice board in a wooden frame, an extinguisher, a hazard strip
box('cork', (60, 12, Z1 - 1.2), (114, 58, 2.4))
for (fx, fy, fw, fh) in ((60, 42, 120, 2.5), (60, -18, 120, 2.5), (1.25, 12, 2.5, 58), (118.75, 12, 2.5, 58)):
    box('wood', (fx, fy, Z1 - 1.5), (fw, fh, 3.0))
for (px_, py_, c_) in ((30, 28, 'cream'), (52, 20, 'yellow'), (78, 30, 'cream'), (96, 14, 'blue'), (44, 2, 'cream'), (70, 4, 'red'), (92, 36, 'cream')):
    box(c_, (px_, py_, Z1 - 2.7), (11, 14, 0.5), yaw=0)
box('red', (-60, FL + 18, Z1 - 4.5), (8.5, 28, 8.5)); box('gun', (-60, FL + 34, Z1 - 4.5), (3, 6, 3)); box('rubber', (-60, FL + 30, Z1 - 2.0), (2, 6, 2))
box('yellow', (0, FL + 2, Z1 - 0.4), (W_ROOM - 40, 4, 0.8))

# things left on the sills
box('cream', (-60, SILL + 3 + 2.4, Z0 + 3.5), (4.2, 4.8, 4.2)); cyl('cream', (-24, SILL + 3 + 2.4, Z0 + 3.0), 2.4, 4.8, 10)
cyl('red', (104, SILL + 3 + 3.2, Z0 + 4.0), 4.0, 6.4, 12); cyl('plant', (104, SILL + 3 + 9.6, Z0 + 4.0), 5.5, 7.0, 10, r2=1.5)
cyl('cream', (X1 - 3.5, SILL + 3 + 2.4, 48), 2.4, 4.8, 10)

# ---- light cards: the window light laid on the floor, screen spill, the fluorescent halos -------
glow_floor(-BX, BX, Z0 + 1.0, Z0 + 104.0, 'win', 'z0')
glow_floor(X1 - 104.0, X1 - 1.0, -RZ, RZ, 'win', 'x1')
for zc, reg in ((-161, 'scrA'), (-108, 'scrC'), (-53, 'scrB'), (4, 'scrA'), (152, 'cool')):
    glow_floor(-206, -134, zc - 32, zc + 32, reg)
for sx, sz in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
    glow_quad((sx * 118.0, CEIL - 3.0, sz * 70.0), (1, 0, 0), (0, 0, 1), 96, 40, 'strip')

# =============================================================================================
# THE CABINETS, THE LOGO, THE POSTER: kept from the old room
# =============================================================================================
print('arcade: importing the old room')
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=OLD)
imported = [o for o in bpy.data.objects if o not in before]
KEEP = {}
for o in imported:
    if o.name.startswith('room_cab2_body'): KEEP['cab'] = o
    elif o.name.startswith('room_sign'): KEEP['logo'] = o
    elif o.name.startswith('room_poster'): KEEP['poster'] = o
    else: bpy.data.objects.remove(o, do_unlink=True)
cab = KEEP['cab']; cab.name = 'room_arcade_cabinets'
def old_bounds(o):
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return Vector([min(v[i] for v in bb) for i in range(3)]), Vector([max(v[i] for v in bb) for i in range(3)])
def place(o, centre_game, scale=1.0):
    """Move an imported object so its bounding-box centre lands on centre_game (game coords) and scale it about that centre."""
    mn, mx = old_bounds(o); c = (mn + mx) / 2
    o.scale = (scale, scale, scale)
    o.location = g2b(*centre_game) - c * scale
place(KEEP['logo'], (-215.0, 90.0, Z0 + 1.2), 0.8)
place(KEEP['poster'], (DX, 70.0, Z0 + 0.8), 1.0)
KEEP['logo'].name = 'room_arcade_logo'; KEEP['poster'].name = 'room_arcade_poster'
for o in KEEP.values():
    for c in list(o.users_collection): c.objects.unlink(o)
    col.objects.link(o)

def emit_from_image(m, strength=1.0):
    nt = m.node_tree; b = nt.nodes.get('Principled BSDF')
    if b is None: return
    src = next((n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image), None)
    if src is None: return
    nt.links.new(src.outputs['Color'], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = strength
def retexture(m, img, strength=1.0):
    nt = m.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    b = nt.nodes.new('ShaderNodeBsdfPrincipled'); o = nt.nodes.new('ShaderNodeOutputMaterial'); t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
    nt.links.new(b.outputs['BSDF'], o.inputs['Surface']); nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(t.outputs['Color'], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = strength
    b.inputs['Roughness'].default_value = 0.2
def planar_uv(obj, mat_index):
    me = obj.data; uvl = me.uv_layers.active.data
    ps = [p for p in me.polygons if p.material_index == mat_index]
    if not ps: return
    pts = [obj.matrix_world @ me.vertices[i].co for p in ps for i in p.vertices]
    n = Vector((0, 0, 0))
    for p in ps: n += p.normal
    n.normalize(); c = sum(pts, Vector()) / len(pts)
    right = Vector((0, 0, 1)).cross(n).normalized(); up = n.cross(right).normalized()
    us = [(p - c).dot(right) for p in pts]; vs = [(p - c).dot(up) for p in pts]
    u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    for p in ps:
        for li, vi in zip(p.loop_indices, p.vertices):
            q = obj.matrix_world @ me.vertices[vi].co - c
            uvl[li].uv = ((q.dot(right) - u0) / (u1 - u0 + 1e-6), (q.dot(up) - v0) / (v1 - v0 + 1e-6))
for o in KEEP.values():
    for m in o.data.materials: m.use_backface_culling = True       # the old room left every one double-sided
rename = {'tripo_mat_8a4cea02-fbfb-49a4-9c87-73fef90524f6.001': 'arcade_guardians'}
for m in cab.data.materials:
    if m.name in rename: m.name = rename[m.name]
idx = {m.name: i for i, m in enumerate(cab.data.materials)}
for nm in ('arcade_avenger.screen', 'arcade_RP.001', 'arcade_OFF.banner'):
    if nm in idx: emit_from_image(cab.data.materials[idx[nm]], 1.0)
if 'blank_screen' in idx: planar_uv(cab, idx['blank_screen']); retexture(cab.data.materials[idx['blank_screen']], im_sa, 1.0)
if 'arcade_OFF.001' in idx: planar_uv(cab, idx['arcade_OFF.001']); retexture(cab.data.materials[idx['arcade_OFF.001']], im_sb, 1.0)
if 'vender_front' in idx:
    b = cab.data.materials[idx['vender_front']].node_tree.nodes['Principled BSDF']
    b.inputs['Emission Color'].default_value = srgb(0x7ac8e8); b.inputs['Emission Strength'].default_value = 0.8
for nm in ('arcade_guardians', 'arcade_OFF', 'arcade_RP'):                      # vinyl side art over laminate: a little sheen, not chalk
    if nm in idx: cab.data.materials[idx[nm]].node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.6
# a lamp in front of every lit screen, at the area-weighted centre of its faces
bpy.context.view_layer.update()
def b2g(v): return (v.x, v.z, -v.y)
Mw = cab.matrix_world; R3 = Mw.to_3x3()
for nm, h, st in (('arcade_avenger.screen', 0x7f9cff, 260), ('arcade_RP.001', 0x9fe0a0, 260), ('blank_screen', 0x6fd0c0, 260),
                  ('arcade_OFF.001', 0xffb060, 260), ('vender_front', 0x7ac8e8, 320)):
    ps = [p for p in cab.data.polygons if nm in idx and p.material_index == idx[nm]]
    if not ps: print('arcade: no faces for screen', nm); continue
    ar = sum(p.area for p in ps); c = sum(((Mw @ p.center) * p.area for p in ps), Vector()) / ar
    n = sum(((R3 @ p.normal) * p.area for p in ps), Vector()).normalized()
    LAMPS.append((b2g(c + n * 8.0), h, st))

# =============================================================================================
# ASSEMBLE + EXPORT
# =============================================================================================
PROC_SKIP = {n for n, v in FLAT.items() if v[3] is not None}                 # lamps and screens stay clean
def newell(pts):
    n = Vector((0, 0, 0))
    for k in range(len(pts)):
        a, b = pts[k], pts[(k + 1) % len(pts)]
        n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
    return n / n.length if n.length > 1e-9 else Vector((0, 1, 0))
def prop_attrs(A, tile):
    """Per-corner UVs (the surface set projected along each face's dominant axis in the piece's own frame, tile cm a repeat, offset per piece)
    and baked colour: floor contact, undersides, a little dirt, near the walls."""
    V, L, O, F, S = A.V, A.L, A.O, A.F, A.S
    vn = [Vector((0, 0, 0)) for _ in V]; fn = []; ln = []
    for f, sm in zip(F, S):
        n = newell([V[i] for i in f]); fn.append(n); ln.append(newell([L[i] for i in f]))
        if sm:
            for i in f: vn[i] += n
    UVs, COL = [], []
    for f, sm, n0, l0 in zip(F, S, fn, ln):
        ax = max(range(3), key=lambda k: abs(l0[k]))
        for i in f:
            n = vn[i].normalized() if sm and vn[i].length > 1e-9 else n0
            p = V[i]; q = L[i]; o = O[i]
            uv = ((q.z, q.y), (q.x, q.z), (q.x, q.y))[ax]
            UVs.append(((uv[0] + o[0]) / tile, (uv[1] + o[1]) / tile))
            h = max(0.0, p.y - FL)
            c = (1 - 0.50 * math.exp(-h / 3.2)) * (1 - 0.30 * max(0.0, -n.y))
            c *= 0.90 + 0.12 * (mnoise.fractal(Vector((p.x, p.y, p.z)) / 38.0 + Vector((5.3, 1.9, 8.1)), 0.7, 2.0, 3) * 0.5 + 0.5)
            d = max(min(p.x - X0, X1 - p.x), min(p.z - Z0, Z1 - p.z)); c *= 1 - 0.20 * math.exp(-d / 12.0)
            COL.append((c, c * 0.985, c * 0.96, 1.0))
    return UVs, COL
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
for name, A in TEXM.items():
    if not A['F']: continue
    uv = [A['UV'][vi] for f in A['F'] for vi in f]; cl = [A['COL'][vi] for f in A['F'] for vi in f]
    make_mesh('room_arcade_' + name, A['V'], A['F'], [False] * len(A['F']), MATS[name], uv, cl)
if GLW['F']:
    make_mesh('room_arcade_glow', GLW['V'], GLW['F'], [False] * len(GLW['F']), MATS['glow'], [GLW['UV'][vi] for f in GLW['F'] for vi in f])
for name, A in ACC.items():
    if not A.F: continue
    uv, cols = (None, None) if name in PROC_SKIP else prop_attrs(A, R.SURF_TILE[FLAT[name][5]])
    Vb = [g2b(v.x, v.y, v.z) for v in A.V]
    make_mesh('room_arcade_' + name, Vb, A.F, A.S, MATS[name], uv, cols)

# ---- the light bake: ambient occlusion and the room's own lamps, ray-traced per corner into the baked colour (glTF COLOR_0) ----------
BAKE = dict(rays=24, reach=26.0, ao=0.7, amb=0.46, soft=14.0)    # AO rays and reach (cm), how dark full occlusion gets, light far from every lamp, lamp core (cm)
bpy.context.view_layer.update()
skip = {'arcade_glass', 'arcade_glow'} | {'arcade_' + n for n in PROC_SKIP}
occ = [o for o in OBJS if o.data.materials[0].name not in skip] + list(KEEP.values())
R.bake_light(occ, occ, [(g2b(*p), R.lamp_tint(h), s) for p, h, s in LAMPS], seed=SEED, tag='arcade', **BAKE)
print('arcade: %d lamps' % len(LAMPS))
tris = 0
for o in OBJS:
    o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
cab.data.calc_loop_triangles()
print('arcade: %d meshes, %d tris new, %d in the cabinets' % (len(OBJS), tris, len(cab.data.loop_triangles)))
for o in OBJS: print('   %-30s %6d tris' % (o.name, len(o.data.loop_triangles)))
for im in IMGS: im.pack()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BUILD, 'arcade_room.blend'))
set_active(*(OBJS + list(KEEP.values())))
kw = dict(filepath=GLB, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_lights=False, export_cameras=False)
try: bpy.ops.export_scene.gltf(export_vertex_color='ACTIVE', **kw)
except TypeError: bpy.ops.export_scene.gltf(**kw)
R.glb_factors(GLB, FACT)
print('arcade: wrote', GLB, '%.1f MB' % (os.path.getsize(GLB) / 1048576))

