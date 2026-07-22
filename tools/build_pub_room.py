"""
build_pub_room.py  --  Fuzeball BRITISH PUB room -> textureable .blend + GLB

Run inside Blender (needs `bpy`). Headless from the project root:

    blender -b -P tools/build_pub_room.py

...or open Blender, Scripting tab, load this file, Run Script. Builds a snug
British pub around the table (floor at y=-44, same as the arena room) out of
PLACEHOLDER primitives -- every distinct surface gets its own room_* material
so you can retexture piecemeal -- then:

    1. saves assets/rooms/pub/fuzeball_pub.blend for texturing
       (an existing .blend is never clobbered -- saves *_rebuilt.blend instead)
    2. exports fuzeball_room_pub.glb INCLUDING the punctual lights, so the
       game picks the pub up immediately

Unlike the arena room's viewport-only area lights, the pub's lights are POINT/
SPOT (KHR_lights_punctual) and DO export: the game normalises them on load
(ensureRoom in js/models.js, scaled by CONFIG.rooms.pub.lightScale). The
overhanging pendant above the table is a SPOT pointing straight down through a
visible shade + cable + bulb mesh.

After texturing, re-export by setting EXPORT_ONLY = True below and re-running
with your textured .blend open (tools/export_table.py skips lights, so don't
use it for this room).

Everything is authored in GAME coordinates (identical numbers to js/config.js):
    X = long axis (goal to goal, goals at x = +/-60)
    Y = up (field surface at y = 0)
    Z = width (camera sits at +z)
placed into Blender via the same Y-up -> Z-up conversion as the other builders,
so the exporter's default "+Y up" round-trips with no extra rotation.

------------------------------------------------------------------------------
WHAT'S IN THE SCENE  (Collection "Pub Room" -- everything exports)
------------------------------------------------------------------------------
Shell       room_floor / room_ceiling / room_wall_back|front|left|right,
            room_wainscot_* dado panelling, room_beam_1..5 oak ceiling beams,
            room_rug under the table.
Bar         room_bar_body / room_bar_top / room_bar_rail (brass foot rail),
            room_pump_1..3 beer engines on the counter, room_backbar shelving,
            room_mirror, room_bottles, room_sign (the pub sign board above).
Corners     room_fireplace (chimney breast + surround + mantel + black firebox
            + emissive room_embers), room_dartboard (+ surround) on the right
            wall, room_window_1..2 frosted glow panes on the front wall,
            room_picture_1..3 framed prints (one material each -- retexture
            these first, cheap wins), room_table_1..2 round pub tables,
            room_stool_1..4, room_bench along the front wall.
Pendant     room_pendant -- cable + green-metal shade + emissive bulb hanging
            over the table centre.
Lights      room_light_pendant (SPOT, the table wash) · room_light_sconce_1..3
            (POINT, wall lamps -- each has a matching room_sconce_* fixture) ·
            room_light_fire (POINT, ember glow). Wattages are chosen so the
            in-game result lands right after CONFIG lightScale -- tune mood
            there, not here.
"""

import bpy, bmesh, math, os
from mathutils import Matrix

EXPORT_ONLY = False   # True = just re-export the open .blend's "Pub Room" collection

# --------------------------------------------------------------------------
# where to write everything
# --------------------------------------------------------------------------
OUT_DIR_OVERRIDE = r"E:\bobby\Documents\Fuzeball files\blender files\rooms"   # set an absolute path to force a location
try:
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
except NameError:
    SCRIPT_DIR = os.path.dirname(bpy.data.filepath)
OUT_DIR = os.path.normpath(OUT_DIR_OVERRIDE) if OUT_DIR_OVERRIDE else os.path.normpath(os.path.join(SCRIPT_DIR, "..", "assets", "rooms", "pub"))

GLB_NAME = "fuzeball_room_pub.glb"

# --------------------------------------------------------------------------
# room dimensions (game units; the table is 120 x 68 with legs down to y=-44)
# --------------------------------------------------------------------------
FY = -44.0    # pub floor (table leg bottoms)
RW = 380.0    # room span along x
RD = 280.0    # room span along z
RH = 150.0    # floor -> ceiling
BZ = -RD / 2  # back wall z (the bar lives here)

# --------------------------------------------------------------------------
# coordinate conversion: GAME (Y-up) -> BLENDER (Z-up):  (x,y,z) -> (x,-z,y)
# --------------------------------------------------------------------------
def g2b(x, y, z):
    return (x, -z, y)

_G2B_AXIS = {"x": "X", "y": "Z", "z": "Y"}

# --------------------------------------------------------------------------
# materials -- version-safe emission (4.x 'Emission Color' vs 3.x 'Emission')
# --------------------------------------------------------------------------
_MATS = {}
def mat(name, rgba, metal=0.1, rough=0.6, emit=None, emit_str=1.0, alpha=1.0):
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Metallic"].default_value = metal
        bsdf.inputs["Roughness"].default_value = rough
        if alpha < 1.0 and "Alpha" in bsdf.inputs:
            bsdf.inputs["Alpha"].default_value = alpha
        if emit is not None:
            for key in ("Emission Color", "Emission"):
                if key in bsdf.inputs:
                    bsdf.inputs[key].default_value = emit
                    break
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = emit_str
    m.diffuse_color = rgba
    if alpha < 1.0:
        try: m.blend_method = "BLEND"
        except Exception: pass
    _MATS[name] = m
    return m

def set_mats(ob, *mats):
    for m in mats:
        ob.data.materials.append(m)
    return ob

# --------------------------------------------------------------------------
# low-level mesh builders (bmesh; verts baked in world coords, object at origin)
# --------------------------------------------------------------------------
def _finish(bm, name, smooth=False):
    if smooth:
        for f in bm.faces:
            f.smooth = True
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    return bpy.data.objects.new(name, me)

def gbox(name, gsize, gloc):
    """Axis-aligned box; gsize/gloc are GAME-space (sx,sy,sz)/(x,y,z)."""
    sx, sy, sz = gsize
    bm = bmesh.new()
    bm.loops.layers.uv.verify()
    bmesh.ops.create_cube(bm, size=1.0, calc_uvs=True)   # per-face 0-1 UVs
    bmesh.ops.scale(bm, vec=(sx, sz, sy), verts=bm.verts)
    bmesh.ops.translate(bm, vec=g2b(*gloc), verts=bm.verts)
    return _finish(bm, name)

def gcyl(name, radius, length, gaxis, gloc, seg=24, r2=None):
    """Cylinder (or frustum when r2 is set: radius at -half, r2 at +half)
    along GAME axis gaxis, centred at GAME gloc."""
    bm = bmesh.new()
    hz = length / 2.0
    rb, rt = radius, (radius if r2 is None else r2)
    bot, top = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        bot.append(bm.verts.new((math.cos(a) * rb, math.sin(a) * rb, -hz)))
        top.append(bm.verts.new((math.cos(a) * rt, math.sin(a) * rt, hz)))
    bm.verts.ensure_lookup_table()
    for i in range(seg):
        j = (i + 1) % seg
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    bm.faces.new(tuple(reversed(bot)))
    bm.faces.new(tuple(top))
    baxis = _G2B_AXIS[gaxis]
    if baxis == "X":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), verts=bm.verts, matrix=Matrix.Rotation(math.radians(90), 3, "Y"))
    elif baxis == "Y":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), verts=bm.verts, matrix=Matrix.Rotation(math.radians(90), 3, "X"))
    bmesh.ops.translate(bm, vec=g2b(*gloc), verts=bm.verts)
    for f in bm.faces:
        f.smooth = len(f.verts) == 4
    return _finish(bm, name)

def merge(name, obs):
    """Join several fresh objects into one mesh (keeps material assignments)."""
    bm = bmesh.new()
    mats = []
    for ob in obs:
        for m in ob.data.materials:
            if m not in mats:
                mats.append(m)
    for ob in obs:
        remap = {i: mats.index(m) for i, m in enumerate(ob.data.materials)}
        tmp = ob.data.copy()
        for p in tmp.polygons:
            p.material_index = remap.get(p.material_index, 0)
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
        me = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.meshes.remove(me, do_unlink=True)
    out = _finish(bm, name)
    for m in mats:
        out.data.materials.append(m)
    return out

def reset_collection(name):
    col = bpy.data.collections.get(name)
    if col:
        for ob in list(col.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.collections.remove(col)
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col

def put(col, *objs):
    for ob in objs:
        col.objects.link(ob)
    return objs

# --------------------------------------------------------------------------
# the pub
# --------------------------------------------------------------------------
def build_shell():
    out = []
    oak    = mat("room_floorboards", (0.16, 0.09, 0.05, 1), rough=0.55)
    plas   = mat("room_plaster", (0.62, 0.53, 0.40, 1), rough=0.9)
    ceilm  = mat("room_ceiling", (0.55, 0.48, 0.38, 1), rough=0.95)
    beam   = mat("room_oak_beam", (0.10, 0.06, 0.035, 1), rough=0.7)
    dado   = mat("room_wainscot", (0.13, 0.075, 0.045, 1), rough=0.5)
    rug    = mat("room_rug", (0.28, 0.06, 0.07, 1), rough=0.95)
    out.append(set_mats(gbox("room_floor", (RW, 1, RD), (0, FY - 0.5, 0)), oak))
    out.append(set_mats(gbox("room_ceiling", (RW, 2, RD), (0, FY + RH + 1, 0)), ceilm))
    for nm, sz, lc in (
        ("room_wall_back",  (RW, RH, 2), (0, FY + RH / 2, BZ - 1)),
        ("room_wall_front", (RW, RH, 2), (0, FY + RH / 2, -BZ + 1)),
        ("room_wall_left",  (2, RH, RD), (-RW / 2 - 1, FY + RH / 2, 0)),
        ("room_wall_right", (2, RH, RD), ( RW / 2 + 1, FY + RH / 2, 0))):
        out.append(set_mats(gbox(nm, sz, lc), plas))
    # dado-height dark panelling strips inside each wall
    dh = 30.0
    for nm, sz, lc in (
        ("room_wainscot_b", (RW, dh, 1.4), (0, FY + dh / 2, BZ + 0.7)),
        ("room_wainscot_f", (RW, dh, 1.4), (0, FY + dh / 2, -BZ - 0.7)),
        ("room_wainscot_l", (1.4, dh, RD), (-RW / 2 + 0.7, FY + dh / 2, 0)),
        ("room_wainscot_r", (1.4, dh, RD), ( RW / 2 - 0.7, FY + dh / 2, 0))):
        out.append(set_mats(gbox(nm, sz, lc), dado))
    for i, bx in enumerate((-152, -76, 0, 76, 152)):
        out.append(set_mats(gbox("room_beam_%d" % (i + 1), (7, 6, RD), (bx, FY + RH - 3, 0)), beam))
    out.append(set_mats(gbox("room_rug", (210, 0.4, 150), (0, FY + 0.2, 0)), rug))
    return out

def build_bar():
    out = []
    wood  = mat("room_bar_wood", (0.14, 0.07, 0.04, 1), rough=0.45)
    top   = mat("room_bar_top", (0.09, 0.045, 0.03, 1), rough=0.25)
    brass = mat("room_brass", (0.85, 0.65, 0.25, 1), metal=0.9, rough=0.3)
    shelf = mat("room_backbar", (0.11, 0.055, 0.035, 1), rough=0.5)
    mirr  = mat("room_mirror", (0.75, 0.78, 0.8, 1), metal=1.0, rough=0.05)
    glass = mat("room_bottles", (0.25, 0.4, 0.2, 1), rough=0.15, alpha=0.7)
    pump  = mat("room_pump", (0.06, 0.04, 0.03, 1), rough=0.4)
    signm = mat("room_sign", (0.05, 0.12, 0.07, 1), rough=0.6, emit=(0.9, 0.75, 0.4, 1), emit_str=0.5)
    by = FY  # bar floor
    out.append(set_mats(gbox("room_bar_body", (170, 40, 18), (0, by + 20, BZ + 32)), wood))
    out.append(set_mats(gbox("room_bar_top", (178, 3, 24), (0, by + 41.5, BZ + 32)), top))
    out.append(set_mats(gcyl("room_bar_rail", 1.4, 170, "x", (0, by + 7, BZ + 44), seg=12), brass))
    for i, px in enumerate((-40, 0, 40)):   # beer engines: base + swan handle
        parts = [set_mats(gcyl("b", 2.2, 5, "y", (px, by + 45.5, BZ + 30), seg=12), brass),
                 set_mats(gcyl("h", 1.4, 16, "y", (px, by + 56, BZ + 30), seg=10), pump)]
        out.append(merge("room_pump_%d" % (i + 1), parts))
    # back bar: shelving unit + mirror + two bottle rows
    out.append(set_mats(gbox("room_backbar", (170, 78, 10), (0, by + 39, BZ + 6)), shelf))
    out.append(set_mats(gbox("room_mirror", (150, 44, 1), (0, by + 52, BZ + 11.6)), mirr))
    bots = []
    for row_y, rz in ((by + 36, BZ + 13), (by + 62, BZ + 13)):
        for k in range(12):
            bx = -66 + k * 12
            bots.append(set_mats(gcyl("bt", 2.0, 9, "y", (bx, row_y + 4.5, rz), seg=8), glass))
    out.append(merge("room_bottles", bots))
    out.append(set_mats(gbox("room_sign", (120, 20, 2), (0, by + 106, BZ + 2.5)), signm))
    return out

def build_fireplace():
    out = []
    brick = mat("room_brick", (0.35, 0.16, 0.11, 1), rough=0.85)
    stone = mat("room_hearth", (0.30, 0.28, 0.25, 1), rough=0.8)
    dark  = mat("room_firebox", (0.02, 0.02, 0.02, 1), rough=0.9)
    ember = mat("room_embers", (0.25, 0.06, 0.01, 1), rough=0.6, emit=(1.0, 0.35, 0.05, 1), emit_str=3.0)
    fx, fz = -RW / 2, 70.0
    out.append(set_mats(gbox("room_chimney", (16, RH, 56), (fx + 8, FY + RH / 2, fz)), brick))
    out.append(set_mats(gbox("room_fireplace", (6, 8, 52), (fx + 19, FY + 48, fz)), stone))   # mantel
    out.append(set_mats(gbox("room_firebox", (6, 34, 34), (fx + 16.5, FY + 17, fz)), dark))
    out.append(set_mats(gbox("room_embers", (4, 5, 26), (fx + 18, FY + 3.5, fz)), ember))
    out.append(set_mats(gbox("room_hearth", (18, 1.5, 60), (fx + 22, FY + 0.75, fz)), stone))
    return out

def build_walls_decor():
    out = []
    cork  = mat("room_dartboard", (0.08, 0.07, 0.06, 1), rough=0.8)
    ring  = mat("room_dart_ring", (0.03, 0.03, 0.03, 1), rough=0.5)
    winf  = mat("room_window_frame", (0.10, 0.06, 0.04, 1), rough=0.55)
    wing  = mat("room_window_glass", (0.55, 0.5, 0.4, 1), rough=0.3,
                emit=(1.0, 0.85, 0.55, 1), emit_str=1.2, alpha=0.9)   # street-lamp glow
    # dartboard on the right wall
    dx, dy, dz = RW / 2 - 1, FY + 78, 40.0
    out.append(merge("room_dartboard", [
        set_mats(gcyl("s", 13, 3, "x", (dx - 1.5, dy, dz), seg=24), ring),
        set_mats(gcyl("b", 9.5, 2, "x", (dx - 3.5, dy, dz), seg=24), cork)]))
    for i in range(1, 4):   # framed prints: one material each = quick retexture wins
        pm = mat("room_picture_%d" % i, (0.55 - i * 0.1, 0.45, 0.35, 1), rough=0.7,
                 emit=(0.7, 0.62, 0.5, 1), emit_str=0.25)
        fr = mat("room_frame", (0.09, 0.055, 0.03, 1), rough=0.45)
        px = -120 + (i - 1) * 120
        out.append(merge("room_picture_%d" % i, [
            set_mats(gbox("f", (34, 44, 1.5), (px, FY + 88, -BZ - 1.2)), fr),
            set_mats(gbox("p", (28, 38, 1.8), (px, FY + 88, -BZ - 1.3)), pm)]))
    for i, wx in enumerate((-70, 70)):   # frosted windows, front wall
        out.append(merge("room_window_%d" % (i + 1), [
            set_mats(gbox("f", (56, 66, 2.5), (wx, FY + 82, -BZ - 0.8)), winf),
            set_mats(gbox("g", (48, 58, 1.5), (wx, FY + 82, -BZ - 1.0)), wing),
            set_mats(gbox("m", (56, 3, 3), (wx, FY + 82, -BZ - 2.2)), winf)]))
    return out

def build_furniture():
    out = []
    wood = mat("room_table_wood", (0.15, 0.085, 0.05, 1), rough=0.4)
    seat = mat("room_seat", (0.30, 0.08, 0.09, 1), rough=0.9)   # worn red leather
    legm = mat("room_stool_leg", (0.07, 0.045, 0.03, 1), rough=0.6)
    for i, (tx, tz) in enumerate(((-135, 95), (150, 105))):
        out.append(merge("room_table_%d" % (i + 1), [
            set_mats(gcyl("t", 16, 2.5, "y", (tx, FY + 27, tz), seg=20), wood),
            set_mats(gcyl("c", 2.2, 25, "y", (tx, FY + 13, tz), seg=10), legm),
            set_mats(gcyl("b", 9, 2, "y", (tx, FY + 1, tz), seg=16), legm)]))
    for i, (sx, sz) in enumerate(((-160, 78), (-112, 112), (128, 84), (172, 122))):
        out.append(merge("room_stool_%d" % (i + 1), [
            set_mats(gcyl("s", 6.5, 3, "y", (sx, FY + 17, sz), seg=14), seat),
            set_mats(gcyl("l", 1.2, 15, "y", (sx, FY + 7.5, sz), seg=8), legm)]))
    out.append(merge("room_bench", [   # settle along the front wall
        set_mats(gbox("s", (120, 4, 16), (0, FY + 15, -BZ - 12)), seat),
        set_mats(gbox("b", (120, 26, 4), (0, FY + 28, -BZ - 5)), wood),
        set_mats(gbox("l1", (4, 15, 14), (-56, FY + 7, -BZ - 12)), legm),
        set_mats(gbox("l2", (4, 15, 14), (56, FY + 7, -BZ - 12)), legm)]))
    return out

def build_pendant():
    """The overhanging light above the table: cable + shade + bulb (mesh only --
    the actual SPOT is added in add_lights)."""
    shade = mat("room_pendant_shade", (0.04, 0.14, 0.09, 1), metal=0.7, rough=0.35)  # green enamel
    bulb  = mat("room_pendant_bulb", (1.0, 0.9, 0.6, 1), rough=0.3,
                emit=(1.0, 0.82, 0.45, 1), emit_str=6.0)
    cable = mat("room_pendant_cable", (0.03, 0.03, 0.03, 1), rough=0.6)
    top_y = FY + RH          # ceiling
    sh_y  = 58.0             # shade centre height above the pitch
    return [merge("room_pendant", [
        set_mats(gcyl("c", 0.5, top_y - (sh_y + 4), "y", (0, (top_y + sh_y + 4) / 2, 0), seg=8), cable),
        set_mats(gcyl("s", 11.0, 9, "y", (0, sh_y, 0), seg=24, r2=3.0), shade),  # frustum, wide end DOWN
        set_mats(gcyl("b", 2.2, 4, "y", (0, sh_y - 4, 0), seg=12), bulb)])]

def build_sconces():
    """Wall lamp fixtures; each gets a POINT light beside it in add_lights."""
    out = []
    brass = mat("room_brass", (0.85, 0.65, 0.25, 1), metal=0.9, rough=0.3)
    shade = mat("room_sconce_shade", (0.95, 0.82, 0.55, 1), rough=0.7,
                emit=(1.0, 0.8, 0.45, 1), emit_str=2.2)
    for i, (gx, gy, gz, ax) in enumerate(SCONCES):
        arm = gcyl("a", 0.8, 8, ax, (gx, gy - 4, gz), seg=8)
        out.append(merge("room_sconce_%d" % (i + 1), [
            set_mats(arm, brass),
            set_mats(gcyl("s", 5.0, 6, "y", (gx, gy, gz), seg=14, r2=3.2), shade)]))
    return out

# sconce positions (game coords) + the axis their bracket arm runs along
SCONCES = [(-RW / 2 + 8, FY + 80, -40, "x"),
           ( RW / 2 - 8, FY + 80, -60, "x"),
           (110, FY + 80, BZ + 8, "z")]

def add_lights(col):
    """Punctual lights -- these EXPORT into the GLB and light the game scene.
    Wattages are pre-tuned for CONFIG.rooms.pub.lightScale (~4e-4)."""
    def light(name, kind, loc, watts, color=(1, 1, 1), spot_deg=None):
        li = bpy.data.lights.new(name, kind)
        li.energy = watts; li.color = color
        if kind == "SPOT" and spot_deg:
            li.spot_size = math.radians(spot_deg); li.spot_blend = 0.35
        ob = bpy.data.objects.new(name, li)
        ob.location = g2b(*loc)   # identity rotation = pointing straight down
        col.objects.link(ob)
        return ob
    light("room_light_pendant", "SPOT", (0, 52, 0), 140, (1.0, 0.85, 0.6), spot_deg=80)
    for i, (gx, gy, gz, _ax) in enumerate(SCONCES):
        light("room_light_sconce_%d" % (i + 1), "POINT", (gx * 0.94, gy, gz * 0.94), 22, (1.0, 0.78, 0.5))
    light("room_light_fire", "POINT", (-RW / 2 + 22, FY + 12, 70), 32, (1.0, 0.45, 0.12))
    w = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.006, 0.004, 0.002, 1)
        bg.inputs[1].default_value = 1.0

# --------------------------------------------------------------------------
# export -- meshes AND lights (version-safe: the punctual-lights kwarg moved names)
# --------------------------------------------------------------------------
def export_room(col):
    objs = [o for o in col.objects if o.type in ("MESH", "LIGHT")]
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = next(o for o in objs if o.type == "MESH")
    path = os.path.join(OUT_DIR, GLB_NAME)
    kw = dict(filepath=path, export_format="GLB", use_selection=True,
              export_yup=True, export_apply=True)
    try:                                   # 2.83+ punctual-lights switch
        bpy.ops.export_scene.gltf(export_lights=True, **kw)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
        print("  WARNING: exporter rejected export_lights -- GLB has meshes only")
    n_l = sum(1 for o in objs if o.type == "LIGHT")
    print("  wrote %s  (%d meshes, %d lights)" % (path, len(objs) - n_l, n_l))

# --------------------------------------------------------------------------
def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    if EXPORT_ONLY:
        col = bpy.data.collections.get("Pub Room")
        if not col:
            print("EXPORT_ONLY: no 'Pub Room' collection in this .blend"); return
        print("Fuzeball PUB re-export ->", OUT_DIR)
        export_room(col)
        return

    print("Fuzeball PUB build ->", OUT_DIR)
    for nm in ("Cube", "Camera", "Light"):   # clear default startup objects only
        ob = bpy.data.objects.get(nm)
        if ob:
            bpy.data.objects.remove(ob, do_unlink=True)

    col = reset_collection("Pub Room")
    put(col, *build_shell())
    put(col, *build_bar())
    put(col, *build_fireplace())
    put(col, *build_walls_decor())
    put(col, *build_furniture())
    put(col, *build_pendant())
    put(col, *build_sconces())
    add_lights(col)

    blend = os.path.join(OUT_DIR, "fuzeball_pub.blend")
    if os.path.exists(blend):
        blend = os.path.join(OUT_DIR, "fuzeball_pub_rebuilt.blend")
        print("  existing fuzeball_pub.blend kept -- saving fresh build as", os.path.basename(blend))
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print("  saved", blend)

    export_room(col)
    print("Done. Texture the .blend (every room_* material is a placeholder),")
    print("then set EXPORT_ONLY=True and re-run to refresh the GLB (keeps lights).")

if __name__ == "__main__":
    main()
