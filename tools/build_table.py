"""
build_table.py  --  Fuzeball PARAMETRIC table builder (multi-table pipeline)

Run inside Blender (needs `bpy`). Headless from the project root:

    blender -b -P tools/build_table.py -- classic glass
    blender -b -P tools/build_table.py -- classic          (default skin)
    blender -b -P tools/build_table.py -- arena

...or open Blender, Scripting tab, load this file, set TABLE_ID / SKIN_ID below, Run
Script. (The trailing `-- <table> [skin]` args override them when running headless.)

A table = a SHAPE plus one or more SKINS (paint jobs on that shape). You build ONE
skin at a time; each writes its own GLB (e.g. fuzeball_table_classic_glass.glb). The
game lists the skins in a Skin dropdown (see js/config.js CONFIG.tables[*].skins).

ONE script builds ANY table in the TABLE_DEFS registry at the bottom. Each def
picks a `shape` ('flat' = classic box walls, 'bowl' = the curved arena SDF) and a
`style` (colours/emissive). Every table is authored at the game's exact dimensions
and honours the mesh-NAME CONTRACT the game's loader (js/models.js) routes on:

    field*        -> hidden in-game (the themed pitch plane shows instead)
    led*          -> the LED-fx material is repointed here
    goal_net*     -> hidden (game keeps its diamond net); left = red goal
    goal_frame*   -> kept visible; the primitive front frame is hidden for you
    wall_end*     -> registered for the big-goal widen (the mouth-flanking walls)
    (anything else just renders: side walls, base, legs, decor)

So adding a table is: add a TABLE_DEFS entry here + a CONFIG.tables entry in
js/config.js. A 'flat' table reuses the classic collision (physics.js) unchanged;
a genuinely new SHAPE needs a new shape-builder here AND a collision branch in
js/physics.js (see 'bowl'/arena.js for the worked example).

Legacy single-table scripts are kept as backups:
    tools/build_arena_table.py / tools/export_arena_table.py

Coordinates: GAME (Y-up) -> BLENDER (Z-up) via (x,y,z)->(x,-z,y), same as
build_fuzeball_models.py, so the exporter's "+Y up" round-trips with no rotation.
    X = long axis (goals at x = +/-60)   Y = up (field at y=0)   Z = width
"""

import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

# --------------------------------------------------------------------------
# Your Fuzeball project folder. Leave "" to auto-detect (works headless AND from
# the Text Editor). Set an absolute path if auto-detect ever guesses wrong.
# --------------------------------------------------------------------------
PROJECT_DIR_OVERRIDE = r"E:\bobby\Documents\Fuzeball"

# --------------------------------------------------------------------------
# WHICH TABLE + SKIN TO BUILD  (edit here, or pass `-- <table> [skin]` headless)
# SKIN_ID = "" means the table's default skin.
# --------------------------------------------------------------------------
TABLE_ID = "classic"
SKIN_ID  = "glass"

# Balls + pitches are managed in their own Blender scenes, so this table pipeline
# leaves them alone. Flip INCLUDE_BALLS to True only if you want this script to also
# build/export fuzeball_ball.glb. (Pitches are never touched by this script.)
INCLUDE_BALLS = False

# --------------------------------------------------------------------------
# game constants (mirror js/config.js -- CONFIG.table)
# --------------------------------------------------------------------------
L, W       = 120.0, 68.0     # table length (x), width (z)
WALL_H     = 10.0            # F.wallH
GOAL_HALF  = 11.0
GOAL_H     = 9.5
GOAL_DEPTH = 9.0
BALL_R     = 1.8             # CONFIG.physics.ballR
ROD_H      = 7.50            # rod pivot height
ARM        = 6.30            # pivot -> foot

ROD_MARGIN = 7.5
SPACING    = {2: 24.0, 3: 18.5}          # else 11.9
ROD_DEFS   = [               # (x, team, men, role, slideCap) -- CONFIG.rods.defs
    (-52.5, 0, 1, "GK", 15.0), (-37.5, 0, 2, "DEF", None), (-22.5, 1, 3, "ATT", None),
    (-7.5, 0, 5, "MID", None), (7.5, 1, 5, "MID", None), (22.5, 0, 3, "ATT", None),
    (37.5, 1, 2, "DEF", None), (52.5, 1, 1, "GK", 13.0),
]
TEAM_COL   = [(1.0, 0.30, 0.35, 1.0), (0.24, 0.55, 1.0, 1.0)]   # red / blue kits

BALL_TYPES = [               # (name, base colour, emissive or None, metallic)
    ("classic", (0.95, 0.93, 0.89, 1), None,                0.05),
    ("fire",    (1.00, 0.42, 0.12, 1), (1.0, 0.13, 0.0, 1),  0.05),
    ("cannon",  (0.02, 0.02, 0.02, 1), None,                0.30),
    ("split",   (0.64, 0.42, 1.00, 1), (0.29, 0.09, 0.72, 1),0.05),
    ("golden",  (1.00, 0.79, 0.20, 1), None,                0.85),
]

ROOM_FLOOR_Y = -44.0         # table legs are 34 tall centred at y=-27 -> bottoms at -44

# P holds the selected table's shape params (bowl fields default to the arena's;
# ignored for 'flat' tables). Set in main() from the chosen TABLE_DEFS entry.
P = {}

# ==========================================================================
# coordinate conversion + materials + low-level mesh builders (shared)
# ==========================================================================
def g2b(x, y, z):
    return (x, -z, y)

_G2B_AXIS = {"x": "X", "y": "Z", "z": "Y"}

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
    bmesh.ops.create_cube(bm, size=1.0, calc_uvs=True)
    bmesh.ops.scale(bm, vec=(sx, sz, sy), verts=bm.verts)          # blender dims (x, z->y, y->z)
    bmesh.ops.translate(bm, vec=g2b(*gloc), verts=bm.verts)
    return _finish(bm, name)

def gcyl(name, radius, length, gaxis, gloc, seg=24):
    """Cylinder along GAME axis gaxis, centred at GAME gloc."""
    bm = bmesh.new()
    hz = length / 2.0
    bot, top = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        x, y = math.cos(a) * radius, math.sin(a) * radius
        bot.append(bm.verts.new((x, y, -hz)))
        top.append(bm.verts.new((x, y, hz)))
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

# ==========================================================================
# SHAPE: 'bowl'  (curved arena SDF -- exact port of js/arena.js, parameterised by P)
# ==========================================================================
def sd_rrect(x, z, hx, hz, r):
    qx = abs(x) - hx + r; qz = abs(z) - hz + r
    return math.hypot(max(qx, 0), max(qz, 0)) + min(max(qx, qz), 0) - r

def sd_box2(x, z, cx, cz, hx, hz):
    qx = abs(x - cx) - hx; qz = abs(z - cz) - hz
    return math.hypot(max(qx, 0), max(qz, 0)) + min(max(qx, qz), 0)

def smin(a, b, k):
    h = max(0.0, min(1.0, 0.5 + 0.5 * (b - a) / k))
    return b + (a - b) * h - k * h * (1 - h)

def arena_sd(x, z):
    r = sd_rrect(x, z, P["length"] / 2, P["width"] / 2, P["cornerR"])
    cx = L / 2 + (GOAL_DEPTH - P["mouthIn"]) / 2
    hx = (P["mouthIn"] + GOAL_DEPTH) / 2
    s0 = sd_box2(x, z, cx, 0, hx, GOAL_HALF)
    s1 = sd_box2(x, z, -cx, 0, hx, GOAL_HALF)
    return smin(smin(r, s0, P["postR"]), s1, P["postR"])

def arena_grad(x, z):
    e = 0.02
    dx = arena_sd(x + e, z) - arena_sd(x - e, z)
    dz = arena_sd(x, z + e) - arena_sd(x, z - e)
    l = math.hypot(dx, dz) or 1e-9
    return (dx / l, dz / l)

def project(x, z, target_sd, iters=3):
    for _ in range(iters):
        sd = arena_sd(x, z); gx, gz = arena_grad(x, z)
        e = sd - target_sd
        x -= gx * e; z -= gz * e
    return (x, z)

def outline():
    hl, gl, hw, gh, gd = P["length"] / 2, L / 2, P["width"] / 2, GOAL_HALF, GOAL_DEPTH
    return [(-gl, -gh), (-gl - gd, -gh), (-gl - gd, gh), (-gl, gh), (-hl, hw), (hl, hw),
            (gl, gh), (gl + gd, gh), (gl + gd, -gh), (gl, -gh), (hl, -hw), (-hl, -hw)]

def perimeter_samples(perim):
    pts = outline(); n = len(pts); dist = [0.0]
    for i in range(1, n + 1):
        a, b = pts[i - 1], pts[i % n]
        dist.append(dist[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    total = dist[n]; out = []; ci = 0
    for i in range(perim):
        want = i / perim * total
        while dist[ci + 1] < want:
            ci += 1
        t = (want - dist[ci]) / ((dist[ci + 1] - dist[ci]) or 1)
        a, b = pts[ci], pts[(ci + 1) % n]
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out, total

def profile_rows(profile):
    cr = P["creaseR"]
    fp = max(1, int(profile * 0.55)) if cr > 0.01 else 0
    rows = []
    for j in range(profile + 1):
        if fp and j <= fp:
            th = (j / fp) * math.pi / 2
            rows.append((cr - cr * math.sin(th), cr - cr * math.cos(th)))
        else:
            t = (j - fp) / ((profile - fp) or 1)
            rows.append((0.0, cr + (WALL_H - cr) * t))
    return rows, fp

def build_bowl(style):
    loop, prof = P["seg"]["loop"], P["seg"]["profile"]
    rows, fp = profile_rows(prof)
    samples, perim_len = perimeter_samples(loop)
    bm = bmesh.new()
    grid = []
    for j, (inset, y) in enumerate(rows):
        ring = []
        for i in range(loop):
            px, pz = project(samples[i][0], samples[i][1], -inset)
            ring.append(bm.verts.new(g2b(px, y, pz)))
        grid.append(ring)
    bm.verts.ensure_lookup_table()
    uv = bm.loops.layers.uv.new("UVMap")
    for j in range(prof):
        for i in range(loop):
            ni = (i + 1) % loop
            a, b = grid[j][i], grid[j][ni]
            c, d = grid[j + 1][ni], grid[j + 1][i]
            try:
                f = bm.faces.new((a, b, c, d))
            except ValueError:
                continue
            f.material_index = 0 if j < fp else 1
            f.smooth = True
            us = {a: i / loop, b: (i + 1) / loop, c: (i + 1) / loop, d: i / loop}
            vs = {a: j / prof, b: j / prof, c: (j + 1) / prof, d: (j + 1) / prof}
            for lp in f.loops:
                lp[uv].uv = (us[lp.vert], vs[lp.vert])
    bm.normal_update()
    for f in bm.faces:
        cen = f.calc_center_median()
        gx, gz = arena_grad(cen.x, -cen.y)
        inward = Vector((-gx, gz, 0.6)).normalized()
        if f.normal.dot(inward) < 0:
            f.normal_flip()
    ob = _finish(bm, "arena_bowl")
    set_mats(ob,
             mat("shell_crease", style["crease"], metal=0.35, rough=0.55),
             mat("shell_wall",   style["wall"],   metal=0.50, rough=0.40,
                 emit=style.get("wallEmit"), emit_str=style.get("wallEmitStr", 0.0)))
    print("  bowl: %d perim x %d profile, perimeter %.1f units" % (loop, prof, perim_len))
    return ob

def build_bowl_field(style):
    loop = P["seg"]["loop"]
    samples, _ = perimeter_samples(loop)
    ring = [project(sx, sz, -P["creaseR"]) for sx, sz in samples]
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    cen = bm.verts.new(g2b(0, 0, 0))
    verts = [bm.verts.new(g2b(px, 0, pz)) for px, pz in ring]
    bm.verts.ensure_lookup_table()
    sx = L + 2 * GOAL_DEPTH
    for i in range(loop):
        a, b = verts[i], verts[(i + 1) % loop]
        try:
            f = bm.faces.new((cen, a, b))
        except ValueError:
            continue
        f.smooth = True
        for lp in f.loops:
            co = lp.vert.co
            lp[uv].uv = (co.x / sx + 0.5, co.y / W + 0.5)
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    ob = _finish(bm, "field")
    set_mats(ob, mat("field", style["field"], metal=0.0, rough=0.85))
    return ob

def build_bowl_led(style, r=0.35, sides=8):
    loop = P["seg"]["loop"]
    samples, _ = perimeter_samples(loop)
    pts = []
    for sx, sz in samples:
        px, pz = project(sx, sz, 0.0)
        pts.append(Vector(g2b(px, WALL_H + 0.15, pz)))
    n = len(pts)
    bm = bmesh.new()
    rings = []
    up = Vector((0, 0, 1))
    for k in range(n):
        t = (pts[(k + 1) % n] - pts[k - 1]).normalized()
        side = up.cross(t).normalized()
        up2 = t.cross(side).normalized()
        ring = []
        for s in range(sides):
            a = 2 * math.pi * s / sides
            ring.append(bm.verts.new(pts[k] + side * (math.cos(a) * r) + up2 * (math.sin(a) * r)))
        rings.append(ring)
    bm.verts.ensure_lookup_table()
    for k in range(n):
        nk = (k + 1) % n
        for s in range(sides):
            ns = (s + 1) % sides
            try:
                f = bm.faces.new((rings[k][s], rings[k][ns], rings[nk][ns], rings[nk][s]))
                f.smooth = True
            except ValueError:
                continue
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _finish(bm, "led_ring")
    set_mats(ob, mat("led", style["led"], metal=0.2, rough=0.4,
                     emit=style["ledEmit"], emit_str=1.1))
    return ob

# ==========================================================================
# SHAPE: 'flat'  (classic box walls -- mirrors js/world.js buildTable geometry)
# ==========================================================================
def build_flat_shell(style, end_wall_h=None):
    """Side walls + end walls. End-wall pieces honour the game's name contract:
      wall_end_*          -> registerBigGoalMeshes slides their INNER edge with the big-goal widen
      goal_frame_header_* -> glbGoalGrow z-scales it about z=0, so it widens in step with the mouth
    Classic (end_wall_h None): four short mouth-flanking segments, open above the bar.
    Walled  (end_wall_h set, e.g. circuit): each end is ONE solid wall of that height with the
    goal INSET into it — full-height flanks + a header panel from the crossbar up. The flanks'
    inner edges and the header's width stay flush through the Big Goal widen because the game
    drives both off the same goalHalf*mult. Physics side: CONFIG.tables[*].endWall.h makes
    over-the-bar shots bounce off this face (js/physics.js) — keep the two heights matched."""
    out = []
    wall_m = mat("shell_wall", style["wall"], metal=style.get("wallMetal", 0.15),
                 rough=style.get("wallRough", 0.55),
                 emit=style.get("wallEmit"), emit_str=style.get("wallEmitStr", 0.0),
                 alpha=style.get("wallAlpha", 1.0))
    wh = WALL_H + 2
    wy = wh / 2 - 1
    # long side walls (near = +z camera side, far = -z) — always classic height
    for name, sz in (("wall_side_near", 1), ("wall_side_far", -1)):
        out.append(set_mats(gbox(name, (L + 10, wh, 3), (0, wy, sz * (W / 2 + 1.5))), wall_m))
    seg_w = (W - 2 * GOAL_HALF) / 2
    if end_wall_h is None:
        # classic: two short segments per goal, flanking the mouth (segW each side of the opening)
        for lr, sx in (("l", -1), ("r", 1)):
            for nf, sz in (("near", 1), ("far", -1)):
                out.append(set_mats(
                    gbox("wall_end_%s_%s" % (lr, nf), (3, wh, seg_w),
                         (sx * (L / 2 + 1.5), wy, sz * (GOAL_HALF + seg_w / 2))), wall_m))
    else:
        # walled: one visually-continuous wall per end (flanks + header share the wall material
        # and the same x/thickness, so the seams vanish), goal mouth inset GOAL_HALF*2 x GOAL_H
        ewh = end_wall_h + 1                  # runs from y=-1 (buried lip) up to end_wall_h
        ey = (end_wall_h - 1) / 2.0
        hh = end_wall_h - GOAL_H              # header: crossbar top -> wall top
        for lr, sx in (("l", -1), ("r", 1)):
            for nf, sz in (("near", 1), ("far", -1)):
                out.append(set_mats(
                    gbox("wall_end_%s_%s" % (lr, nf), (3, ewh, seg_w),
                         (sx * (L / 2 + 1.5), ey, sz * (GOAL_HALF + seg_w / 2))), wall_m))
            out.append(set_mats(
                gbox("goal_frame_header_%s" % lr, (3, hh, GOAL_HALF * 2),
                     (sx * (L / 2 + 1.5), GOAL_H + hh / 2.0, 0)), wall_m))
    return out

def build_flat_field(style):
    ob = gbox("field", (L, 0.1, W), (0, -0.05, 0))
    return set_mats(ob, mat("field", style["field"], metal=0.0, rough=0.85))

def build_flat_led(style):
    led_m = mat("led", style["led"], metal=0.2, rough=0.4, emit=style["ledEmit"], emit_str=1.1)
    out = []
    for name, sz in (("led_strip_near", 1), ("led_strip_far", -1)):
        out.append(set_mats(gbox(name, (L + 10, 0.7, 0.7),
                                 (0, WALL_H + 1.15, sz * (W / 2 + 1.5))), led_m))
    return out

# ==========================================================================
# shared parts: goals, base, legs, balls, reference markers, room
# ==========================================================================
def build_goal_nets(style):
    net_m = mat("goal_net", style.get("net", (0.9, 0.2, 0.25, 1)), metal=0.0, rough=0.9, alpha=0.45)
    out = []
    for name, sx in (("goal_net_left", -1), ("goal_net_right", 1)):
        out.append(set_mats(gbox(name, (GOAL_DEPTH - 1.0, GOAL_H - 0.8, GOAL_HALF * 2 - 1.2),
                                 (sx * (L / 2 + GOAL_DEPTH / 2), (GOAL_H - 0.8) / 2, 0)), net_m))
    return out

def build_goal_frames(style):
    frame_m = mat("goal_frame", style.get("frame", (0.92, 0.94, 1.0, 1)),
                  metal=0.6, rough=0.25,
                  emit=style.get("frameEmit"), emit_str=style.get("frameEmitStr", 0.0))
    out = []
    for name, sx in (("goal_frame_l", -1), ("goal_frame_r", 1)):
        parts = []
        for sz in (-1, 1):
            parts.append(set_mats(gcyl("p", 0.6, GOAL_H + 1, "y",
                                       (sx * L / 2, (GOAL_H + 1) / 2, sz * GOAL_HALF)), frame_m))
        parts.append(set_mats(gcyl("b", 0.6, GOAL_HALF * 2 + 1.2, "z",
                                   (sx * L / 2, GOAL_H + 0.5, 0)), frame_m))
        out.append(merge(name, parts))
    return out

def build_base_legs(style):
    body_m = mat("table_base", style.get("body", (0.06, 0.07, 0.12, 1)), metal=0.4, rough=0.5)
    out = [set_mats(gbox("table_base", (L + 10, 10, W + 10), (0, -5.2, 0)), body_m)]
    for sx in (-1, 1):
        for sz in (-1, 1):
            out.append(set_mats(gbox("table_leg", (4, 34, 4),
                                     (sx * (L / 2 - 2), -27, sz * (W / 2 - 2))), body_m))
    return out

def build_balls():
    out = []
    for i, (name, col, emit, metal) in enumerate(BALL_TYPES):
        bm = bmesh.new()
        try:
            bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=BALL_R)
        except TypeError:
            bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, diameter=BALL_R)
        uv = bm.loops.layers.uv.new("UVMap")
        for f in bm.faces:
            f.smooth = True
            us = {}
            for lp in f.loops:
                co = lp.vert.co
                us[lp] = 0.5 + math.atan2(co.y, co.x) / (2 * math.pi)
            if max(us.values()) - min(us.values()) > 0.5:
                us = {lp: (u + 1.0 if u < 0.5 else u) for lp, u in us.items()}
            for lp in f.loops:
                co = lp.vert.co
                lp[uv].uv = (us[lp], 0.5 + math.asin(max(-1, min(1, co.z / BALL_R))) / math.pi)
        ob = _finish(bm, name, smooth=True)
        ob.location = g2b(-24 + i * 12, BALL_R, W / 2 + 16)
        rough = 0.25 if metal > 0.5 else 0.4
        set_mats(ob, mat("ball_" + name, col, metal=metal, rough=rough,
                         emit=emit, emit_str=0.9 if emit else 0.0))
        out.append(ob)
    return out

def spacing_for(men):
    return SPACING.get(men, 11.9)

def max_off(men, cap):
    mo = (W - ROD_MARGIN - (men - 1) * spacing_for(men)) / 2.0
    return min(mo, cap) if cap else mo

def build_reference():
    out = []
    kit = [mat("ref_red", TEAM_COL[0], metal=0.15, rough=0.45),
           mat("ref_blue", TEAM_COL[1], metal=0.15, rough=0.45)]
    guide = [mat("ref_slide_red", TEAM_COL[0], rough=0.9, alpha=0.22),
             mat("ref_slide_blue", TEAM_COL[1], rough=0.9, alpha=0.22)]
    for idx, (gx, team, men, role, cap) in enumerate(ROD_DEFS):
        sp = spacing_for(men); mo = max_off(men, cap)
        parts = [set_mats(gcyl("bar", 0.55, W + 16, "z", (gx, ROD_H, 0), seg=12), kit[team])]
        for i in range(men):
            bz = (i - (men - 1) / 2.0) * sp
            parts.append(set_mats(gcyl("man", 1.0, ARM, "y", (gx, ROD_H - ARM / 2, bz), seg=10), kit[team]))
        out.append(merge("ref_rod_%d_%s" % (idx + 1, role.lower()), parts))
        span = (men - 1) * sp + 2 * mo
        out.append(set_mats(gbox("ref_slide_%d" % (idx + 1), (2.2, 0.12, span), (gx, 0.06, 0)),
                            guide[team]))
    return out

def build_room():
    """Neon arcade / esports den (room_*). Shared by any table whose def sets room=True."""
    out = []
    RW, RD, RH = 380.0, 300.0, 148.0
    fy = ROOM_FLOOR_Y
    conc = mat("room_floor", (0.035, 0.035, 0.05, 1), metal=0.1, rough=0.7)
    wall = mat("room_wall", (0.05, 0.05, 0.09, 1), metal=0.0, rough=0.9)
    cyan = mat("room_led_cyan", (0.05, 0.3, 0.35, 1), rough=0.4, emit=(0.16, 0.96, 1.0, 1), emit_str=2.2)
    pink = mat("room_led_pink", (0.35, 0.05, 0.28, 1), rough=0.4, emit=(1.0, 0.17, 0.84, 1), emit_str=2.2)
    out.append(set_mats(gbox("room_floor", (RW, 1, RD), (0, fy - 0.5, 0)), conc))
    out.append(set_mats(gbox("room_ceiling", (RW, 2, RD), (0, fy + RH + 1, 0)), wall))
    for name, gs, gl in (
        ("room_wall_back",  (RW, RH, 2), (0, fy + RH / 2, -RD / 2 - 1)),
        ("room_wall_front", (RW, RH, 2), (0, fy + RH / 2,  RD / 2 + 1)),
        ("room_wall_left",  (2, RH, RD), (-RW / 2 - 1, fy + RH / 2, 0)),
        ("room_wall_right", (2, RH, RD), ( RW / 2 + 1, fy + RH / 2, 0))):
        out.append(set_mats(gbox(name, gs, gl), wall))
    for name, gs, gl, m in (
        ("room_led_floor_b", (RW - 4, 0.8, 0.8), (0, fy + 0.6, -RD / 2 + 1), cyan),
        ("room_led_floor_f", (RW - 4, 0.8, 0.8), (0, fy + 0.6,  RD / 2 - 1), cyan),
        ("room_led_floor_l", (0.8, 0.8, RD - 4), (-RW / 2 + 1, fy + 0.6, 0), cyan),
        ("room_led_floor_r", (0.8, 0.8, RD - 4), ( RW / 2 - 1, fy + 0.6, 0), cyan),
        ("room_led_ceil_b",  (RW - 4, 0.8, 0.8), (0, fy + RH - 0.6, -RD / 2 + 1), pink),
        ("room_led_ceil_f",  (RW - 4, 0.8, 0.8), (0, fy + RH - 0.6,  RD / 2 - 1), pink)):
        out.append(set_mats(gbox(name, gs, gl), m))
    for i, px in enumerate((-75, 0, 75)):
        pm = mat("poster_%d" % (i + 1), (0.08, 0.06, 0.14, 1), rough=0.5,
                 emit=(0.35, 0.18, 0.6, 1), emit_str=0.35)
        out.append(set_mats(gbox("room_poster_%d" % (i + 1), (26, 38, 0.6), (px, fy + 70, -RD / 2 + 0.7)), pm))
    out.append(set_mats(gbox("room_sign", (90, 16, 1), (0, fy + 114, -RD / 2 + 0.8)), pink))
    cab = mat("room_cabinet", (0.07, 0.07, 0.11, 1), metal=0.2, rough=0.6)
    scr = mat("room_screen", (0.02, 0.05, 0.06, 1), rough=0.2, emit=(0.2, 0.9, 1.0, 1), emit_str=1.6)
    for i, cz in enumerate((-70, -25)):
        out.append(set_mats(gbox("room_cab%d_body" % (i + 1), (20, 58, 24), (-RW / 2 + 12, fy + 29, cz)), cab))
        out.append(set_mats(gbox("room_cab%d_screen" % (i + 1), (1, 15, 16), (-RW / 2 + 22.4, fy + 40, cz)), scr))
        out.append(set_mats(gbox("room_cab%d_marquee" % (i + 1), (2, 6, 20), (-RW / 2 + 21.5, fy + 55, cz)), pink if i else cyan))
    out.append(set_mats(gbox("room_rug", (200, 0.4, 140), (0, fy + 0.2, 0)),
                        mat("room_rug", (0.09, 0.05, 0.16, 1), rough=0.95)))
    seat = mat("room_stool", (0.12, 0.12, 0.16, 1), metal=0.5, rough=0.35)
    for i, (sx, sz) in enumerate(((105, 55), (-60, 78))):
        parts = [set_mats(gcyl("s", 6, 3, "y", (sx, fy + 22.5, sz), seg=16), seat),
                 set_mats(gcyl("l", 1.2, 21, "y", (sx, fy + 10.5, sz), seg=10), seat)]
        out.append(merge("room_stool_%d" % (i + 1), parts))
    return out

def add_lights(col):
    def area(name, loc, energy, size, color=(1, 1, 1)):
        li = bpy.data.lights.new(name, "AREA")
        li.energy = energy; li.size = size; li.color = color
        ob = bpy.data.objects.new(name, li)
        ob.location = g2b(*loc)
        col.objects.link(ob)
        return ob
    area("room_light_table", (0, 80, 0), 24000, 90)
    area("room_light_back", (0, 40, -110), 9000, 60, (0.8, 0.5, 1.0))
    area("room_light_front", (60, 50, 110), 7000, 60, (0.5, 0.9, 1.0))
    w = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.004, 0.004, 0.008, 1)
        bg.inputs[1].default_value = 1.0

# ==========================================================================
# first-pass GLB export (fresh objects -- texture + re-export with export_table.py)
# ==========================================================================
def export_glb(objs, out_dir, filename, zero_locations=False):
    if not objs:
        print("  nothing to export for", filename); return
    saved = {}
    if zero_locations:
        for ob in objs:
            saved[ob] = ob.location.copy()
            ob.location = (0, 0, 0)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(out_dir, filename)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True)
    for ob, loc in saved.items():
        ob.location = loc
    print("  wrote", path)

# ==========================================================================
# TABLE REGISTRY -- mirrors js/config.js CONFIG.tables (add an entry to add a table)
# A table = a SHAPE (flat/bowl) + one or more SKINS (paint jobs on that shape). Each skin
# has its own output `glb` filename + `style` (colours/emissive). Build ONE skin at a time:
#   blender -b -P tools/build_table.py -- <table> <skin>     e.g.  -- classic glass
# ==========================================================================
TABLE_DEFS = {
    # --- classic: flat box table. Skins keyed to match js/config.js CONFIG.tables.classic.skins.
    #     NOTE: 'alienShip' (the game's DEFAULT classic look) is a hand-authored asset
    #     (assets/fuzeball_table.glb). Building it here generates only a plain PLACEHOLDER and
    #     would overwrite fuzeball_table_classic.glb — so build 'glass' (or new skins), not this. ---
    "classic": {
        "name": "Classic", "folder": "classic", "room": False, "shape": "flat",
        "defSkin": "glass",
        "skins": {
            "alienShip": {"glb": "fuzeball_table_classic.glb", "style": {   # placeholder only — see note above
                "wall": (0.48, 0.30, 0.14, 1), "wallMetal": 0.1, "wallRough": 0.6,
                "field": (0.12, 0.49, 0.24, 1),
                "led": (0.22, 0.88, 1.0, 1), "ledEmit": (0.22, 0.88, 1.0, 1),
                "frame": (0.95, 0.96, 1.0, 1), "net": (0.9, 0.2, 0.25, 1),
                "body": (0.09, 0.06, 0.04, 1)}},
            "glass": {"glb": "fuzeball_table_classic_glass.glb", "style": {
                "wall": (0.55, 0.75, 0.85, 1), "wallMetal": 0.1, "wallRough": 0.08, "wallAlpha": 0.35,
                "field": (0.12, 0.49, 0.24, 1),
                "led": (0.6, 0.95, 1.0, 1), "ledEmit": (0.6, 0.95, 1.0, 1),
                "frame": (0.85, 0.95, 1.0, 1), "net": (0.9, 0.2, 0.25, 1),
                "body": (0.05, 0.07, 0.09, 1)}},
        },
    },
    # --- arena: curved SDF bowl + neon arcade room. One skin. ---
    "arena": {
        "name": "Arena", "folder": "arena", "room": True, "shape": "bowl",
        "params": {"length": 120.0, "width": 68.0, "cornerR": 12.0, "creaseR": 5.0,
                   "postR": 3.0, "mouthIn": 4.0, "seg": {"loop": 200, "profile": 10}},
        "defSkin": "standard",
        "skins": {"standard": {"glb": "fuzeball_table_arena.glb", "style": {
            "crease": (0.11, 0.13, 0.21, 1), "wall": (0.17, 0.20, 0.31, 1),
            "field": (0.10, 0.12, 0.20, 1),
            "led": (0.13, 0.55, 0.63, 1), "ledEmit": (0.13, 0.88, 1.0, 1),
            "frame": (0.92, 0.94, 1.0, 1), "net": (0.9, 0.2, 0.25, 1),
            "body": (0.06, 0.07, 0.12, 1)}}},
    },
    # --- circuit: flat table with a WALLED goal end (glowing-circuit look). endWallH turns each
    #     end into ONE solid wall the goal is inset into -- over-the-bar shots bounce back in.
    #     MUST match CONFIG.tables.circuit.endWall.h in js/config.js (the physics height). ---
    "circuit": {
        "name": "Circuit", "folder": "circuit", "room": False, "shape": "flat",
        "endWallH": 26.0,
        "defSkin": "standard",
        "skins": {"standard": {"glb": "fuzeball_table_circuit.glb", "style": {
            "wall": (0.04, 0.06, 0.10, 1), "wallMetal": 0.55, "wallRough": 0.3,
            "wallEmit": (0.10, 0.85, 0.95, 1), "wallEmitStr": 0.55,
            "field": (0.03, 0.05, 0.09, 1),
            "led": (0.10, 0.95, 0.85, 1), "ledEmit": (0.10, 0.95, 0.85, 1),
            "frame": (0.6, 0.95, 1.0, 1), "frameEmit": (0.10, 0.85, 0.95, 1), "frameEmitStr": 0.6,
            "net": (0.2, 0.9, 0.85, 1),
            "body": (0.02, 0.03, 0.06, 1)}}},
    },
}

def resolve_table_id():
    # headless override:  blender -b -P tools/build_table.py -- <table> [skin]
    argv = sys.argv
    if "--" in argv:
        extra = argv[argv.index("--") + 1:]
        if extra and extra[0] in TABLE_DEFS:
            return extra[0]
    return TABLE_ID

def resolve_skin_id(d):
    # headless override:  ...-- <table> <skin>   (2nd arg after --)
    argv = sys.argv
    if "--" in argv:
        extra = argv[argv.index("--") + 1:]
        if len(extra) >= 2 and extra[1] in d["skins"]:
            return extra[1]
    if SKIN_ID and SKIN_ID in d["skins"]:
        return SKIN_ID
    return d.get("defSkin") or next(iter(d["skins"]))

def project_root():
    """Find the Fuzeball folder robustly. Text-Editor runs don't set __file__, so we
    try (1) the override, (2) walking up from the script or the open .blend until we
    hit a folder that has both assets/ and tools/, (3) a last-resort relative guess."""
    if PROJECT_DIR_OVERRIDE:
        return PROJECT_DIR_OVERRIDE
    starts = []
    try:
        starts.append(os.path.dirname(os.path.abspath(__file__)))
    except NameError:
        pass
    if bpy.data.filepath:
        starts.append(os.path.dirname(bpy.data.filepath))
    for start in starts:
        d = start
        for _ in range(8):
            if os.path.isdir(os.path.join(d, "assets")) and os.path.isdir(os.path.join(d, "tools")):
                return d
            nd = os.path.dirname(d)
            if nd == d:
                break
            d = nd
    try:
        return os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    except NameError:
        return os.getcwd()

def out_dir_for(folder):
    return os.path.normpath(os.path.join(project_root(), "assets", "tables", folder))

# ==========================================================================
def main():
    global P
    tid = resolve_table_id()
    if tid not in TABLE_DEFS:
        print("Unknown TABLE_ID '%s'. Known: %s" % (tid, ", ".join(TABLE_DEFS)))
        return
    d = TABLE_DEFS[tid]
    skin = resolve_skin_id(d)
    sk = d["skins"][skin]
    P = d.get("params", {})
    style = sk["style"]
    glb = sk["glb"]
    out_dir = out_dir_for(d["folder"])
    os.makedirs(out_dir, exist_ok=True)
    print("Fuzeball table build: '%s' skin '%s' (%s shape) ->" % (tid, skin, d["shape"]), out_dir)

    for nm in ("Cube", "Camera", "Light"):
        ob = bpy.data.objects.get(nm)
        if ob:
            bpy.data.objects.remove(ob, do_unlink=True)

    col_t = reset_collection("%s Table" % d["name"])
    if d["shape"] == "bowl":
        put(col_t, build_bowl(style), build_bowl_field(style), build_bowl_led(style))
    else:  # 'flat' (optional endWallH -> walled goal ends, see build_flat_shell)
        put(col_t, build_flat_field(style), *build_flat_shell(style, d.get("endWallH")))
        put(col_t, *build_flat_led(style))
    put(col_t, *build_goal_nets(style))
    put(col_t, *build_goal_frames(style))
    put(col_t, *build_base_legs(style))

    balls = []
    if INCLUDE_BALLS:
        col_b = reset_collection("Balls")
        balls = build_balls()
        put(col_b, *balls)

    col_ref = reset_collection("Reference")
    put(col_ref, *build_reference())

    col_room = None
    if d.get("room"):
        col_room = reset_collection("Room")
        put(col_room, *build_room())
        add_lights(col_room)

    # save the .blend for texturing -- one per skin, never clobber an existing (textured) one
    blend = os.path.join(out_dir, "fuzeball_%s_%s.blend" % (tid, skin))
    if os.path.exists(blend):
        blend = os.path.join(out_dir, "fuzeball_%s_%s_rebuilt.blend" % (tid, skin))
        print("  existing .blend kept -- saving fresh build as", os.path.basename(blend))
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print("  saved", blend)

    # first-pass GLBs so the game shows the skin right away
    table = [o for o in col_t.objects if o.type == "MESH"]
    export_glb(table, out_dir, glb)
    if INCLUDE_BALLS and balls:
        export_glb(balls, out_dir, "fuzeball_ball.glb", zero_locations=True)
    if col_room:
        room = [o for o in col_room.objects if o.type == "MESH"]
        export_glb(room, out_dir, "fuzeball_room_%s.glb" % tid)

    print("Done. Texture the .blend, then run tools/export_table.py -- %s %s." % (tid, skin))
    print("Name contract: field* hidden, led* -> LED fx, goal_net* -> team colours,")
    print("goal_frame* kept, wall_end* -> big-goal widen, ball meshes = ball keys.")

if __name__ == "__main__":
    main()
