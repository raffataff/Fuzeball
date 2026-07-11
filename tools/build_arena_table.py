"""
build_arena_table.py  --  Fuzeball ARENA table -> textureable .blend + GLB assets

Run inside Blender (needs `bpy`). Headless from the project root:

    blender -b -P tools/build_arena_table.py

...or open Blender, Scripting tab, load this file, Run Script. It rebuilds the
whole curved arena at the game's exact dimensions from the SAME math as
js/arena.js (SDF -> Newton-projected swept grid), so the model you texture is
vertex-identical to what physics collides with. It then:

    1. saves a .blend into assets/tables/arena/ for you to texture
       (if one already exists it saves *_rebuilt.blend instead -- your
       textured file is never clobbered)
    2. exports first-pass GLBs so the game picks the arena up immediately

After texturing, export with tools/export_arena_table.py (robust baked export).

Everything is authored in GAME coordinates (identical numbers to js/config.js):
    X = long axis (goal to goal, goals at x = +/-60)
    Y = up (field surface at y = 0)
    Z = width
placed into Blender via the same Y-up -> Z-up conversion as
build_fuzeball_models.py, so the exporter's default "+Y up" round-trips with no
extra rotation.

------------------------------------------------------------------------------
WHAT'S IN THE SCENE
------------------------------------------------------------------------------
Collection "Arena Table"   -- exported to fuzeball_table_arena.glb
    arena_bowl        the swept wall+crease surface. TWO material slots:
                      'arena_crease' (the floor fillet ramp) and 'arena_wall'
                      (the vertical wall) so you can texture the ramp
                      separately. UVs: U = distance around the perimeter,
                      V = up the profile (0 floor -> 1 wall top).
    field             flat interior floor (hidden in-game -- the game keeps its
                      themed pitch plane -- but needed for Blender renders).
    led_ring          emissive lip tube. The game repoints its LED-fx material
                      here (name contract: starts with 'led').
    goal_net_left/right   thin net boxes; the game clones + team-colours these
                      (name contract: starts with 'goal_net'; left=red).
    goal_frame_l/r    cylinder posts + crossbar.
    table_base, table_leg x4

Collection "Balls"         -- exported to fuzeball_ball.glb (each recentred!)
    classic / fire / cannon / split / golden -- one sphere per ball type,
    named EXACTLY like the game's ball keys (js loadBallModel maps mesh name ->
    material slot). Texture each one's material; in-game each ball type shows
    only its own mesh.

Collection "Reference"     -- NEVER exported (name prefix ref_)
    rod bars + peg men at every man's rest position, team-coloured, plus a
    translucent floor strip showing each rod's full slide range. Texture with
    these visible so you know where the players live.

Collection "Room"          -- exported to fuzeball_room_arena.glb
    neon arcade / esports den around the table: dark floor + walls + ceiling,
    LED edge strips, glowing posters (poster_1..3 each get their own material),
    two arcade cabinets, neon sign, rug, stools. Room floor sits at y=-44
    (the table's leg bottoms). Not yet loaded by the game -- kept as its own
    GLB so it can be wired in later without touching the table.
"""

import bpy, bmesh, math, os
from mathutils import Vector, Matrix

# --------------------------------------------------------------------------
# where to write everything
# --------------------------------------------------------------------------
OUT_DIR_OVERRIDE = r""   # set an absolute path to force a location
try:
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
except NameError:
    SCRIPT_DIR = os.path.dirname(bpy.data.filepath)
OUT_DIR = OUT_DIR_OVERRIDE or os.path.normpath(os.path.join(SCRIPT_DIR, "..", "assets", "tables", "arena"))

# --------------------------------------------------------------------------
# game constants (mirror js/config.js -- CONFIG.table + CONFIG.tables.arena)
# --------------------------------------------------------------------------
L, W       = 120.0, 68.0     # table length (x), width (z)
WALL_H     = 10.0            # F.wallH
GOAL_HALF  = 11.0
GOAL_H     = 9.5
GOAL_DEPTH = 9.0
BALL_R     = 1.8             # CONFIG.physics.ballR
ROD_H      = 7.50            # rod pivot height
ARM        = 6.30            # pivot -> foot

LENGTH     = 120.0           # ARENA.length   (outer bowl length along x = side-wall span).
                             # Default 120 = L, so the end wall sits on the goal line (x=+/-60)
                             # and the goal pockets stay open. Side wall is straight for
                             # x in +/-(LENGTH/2 - CORNER_R), then the corner arc curves to the
                             # end wall at x=+/-LENGTH/2. Goal mouth is fixed at +/-L/2 (below).
                             # See js/config.js CONFIG.tables.arena.length for the full note.
WIDTH      = 68.0            # ARENA.width    (outer bowl width along z = end-wall span).
                             # Default 68 = W. The bowl looks a touch narrower than classic
                             # because the crease fillet rises from ~CREASE_R inside the wall,
                             # not because of this number. See js/config.js note.
CORNER_R   = 12.0            # ARENA.cornerR  (plan-view corner radius)
CREASE_R   = 5.0             # ARENA.creaseR  (floor<->wall fillet radius)
POST_R     = 3.0             # ARENA.postR    (smooth union radius at the goal mouth)
MOUTH_IN   = 4.0             # ARENA.mouthIn  (cavity reach INTO the field)
SEG_LOOP   = 200             # ARENA.seg.loop    (samples around the perimeter)
SEG_PROFILE= 10              # ARENA.seg.profile (rows up the cross-section)

ROD_MARGIN = 7.5             # CONFIG.rods.margin
SPACING    = {2: 24.0, 3: 18.5}          # else 11.9
ROD_DEFS   = [               # (x, team, men, role, slideCap) -- CONFIG.rods.defs
    (-52.5, 0, 1, "GK", 15.0), (-37.5, 0, 2, "DEF", None), (-22.5, 1, 3, "ATT", None),
    (-7.5, 0, 5, "MID", None), (7.5, 1, 5, "MID", None), (22.5, 0, 3, "ATT", None),
    (37.5, 1, 2, "DEF", None), (52.5, 1, 1, "GK", 13.0),
]
TEAM_COL   = [(1.0, 0.30, 0.35, 1.0), (0.24, 0.55, 1.0, 1.0)]   # red / blue kits

BALL_TYPES = [               # (name, base colour, emissive or None, metallic)
    ("classic", (0.95, 0.93, 0.89, 1), None,               0.05),
    ("fire",    (1.00, 0.42, 0.12, 1), (1.0, 0.13, 0.0, 1), 0.05),
    ("cannon",  (0.02, 0.02, 0.02, 1), None,               0.30),
    ("split",   (0.64, 0.42, 1.00, 1), (0.29, 0.09, 0.72, 1), 0.05),
    ("golden",  (1.00, 0.79, 0.20, 1), None,               0.85),
]

ROOM_FLOOR_Y = -44.0         # table legs are 34 tall centred at y=-27 -> bottoms at -44

# --------------------------------------------------------------------------
# the arena SDF -- exact port of js/arena.js (corrected cavity boxes)
# --------------------------------------------------------------------------
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
    r = sd_rrect(x, z, LENGTH / 2, WIDTH / 2, CORNER_R)   # outer bowl length × width
    # cavities span x in [+/-(L/2-mouthIn), +/-(L/2+goalDepth)] -- mouthIn opens
    # the mouth blend into the field, goalDepth reaches out behind the line
    cx = L / 2 + (GOAL_DEPTH - MOUTH_IN) / 2
    hx = (MOUTH_IN + GOAL_DEPTH) / 2
    s0 = sd_box2(x, z, cx, 0, hx, GOAL_HALF)
    s1 = sd_box2(x, z, -cx, 0, hx, GOAL_HALF)
    return smin(smin(r, s0, POST_R), s1, POST_R)

GRAD_EPS = 0.02
def arena_grad(x, z):
    dx = arena_sd(x + GRAD_EPS, z) - arena_sd(x - GRAD_EPS, z)
    dz = arena_sd(x, z + GRAD_EPS) - arena_sd(x, z - GRAD_EPS)
    l = math.hypot(dx, dz) or 1e-9
    return (dx / l, dz / l)

def project(x, z, target_sd, iters=3):
    for _ in range(iters):
        sd = arena_sd(x, z); gx, gz = arena_grad(x, z)
        e = sd - target_sd
        x -= gx * e; z -= gz * e
    return (x, z)

# outline polyline matching the SDF (rounded rect + OUTWARD cavities); rough
# corners are fine, every sample is Newton-projected onto the exact contour.
def outline():
    hl, gl, hw, gh, gd = LENGTH / 2, L / 2, WIDTH / 2, GOAL_HALF, GOAL_DEPTH  # hl=outer corner, gl=goal line
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

# profile rows: quarter-circle fillet (0..fp) then vertical wall (fp..profile).
# CREASE_R <= 0 -> fp = 0 -> no fillet, a sharp 90 degree wall meeting the flat floor.
def profile_rows(profile):
    fp = max(1, int(profile * 0.55)) if CREASE_R > 0.01 else 0
    rows = []
    for j in range(profile + 1):
        if fp and j <= fp:
            th = (j / fp) * math.pi / 2
            rows.append((CREASE_R - CREASE_R * math.sin(th), CREASE_R - CREASE_R * math.cos(th)))
        else:
            t = (j - fp) / ((profile - fp) or 1)
            rows.append((0.0, CREASE_R + (WALL_H - CREASE_R) * t))
    return rows, fp

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
        try: m.blend_method = "BLEND"          # removed in newer EEVEE; harmless if absent
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
    bmesh.ops.create_cube(bm, size=1.0, calc_uvs=True)   # per-face 0-1 UVs (posters etc.)
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

# --------------------------------------------------------------------------
# scene / collection helpers
# --------------------------------------------------------------------------
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
# the bowl -- swept quad grid on the SDF contours (mirror of arenaGridGeo)
# --------------------------------------------------------------------------
def build_bowl():
    rows, fp = profile_rows(SEG_PROFILE)
    samples, perim_len = perimeter_samples(SEG_LOOP)
    bm = bmesh.new()
    grid = []                                        # grid[j][i] -> BMVert
    for j, (inset, y) in enumerate(rows):
        ring = []
        for i in range(SEG_LOOP):
            px, pz = project(samples[i][0], samples[i][1], -inset)
            ring.append(bm.verts.new(g2b(px, y, pz)))
        grid.append(ring)
    bm.verts.ensure_lookup_table()
    uv = bm.loops.layers.uv.new("UVMap")
    prof = SEG_PROFILE
    for j in range(prof):
        for i in range(SEG_LOOP):
            ni = (i + 1) % SEG_LOOP
            a, b = grid[j][i], grid[j][ni]
            c, d = grid[j + 1][ni], grid[j + 1][i]
            try:
                f = bm.faces.new((a, b, c, d))
            except ValueError:
                continue                              # degenerate quad at a tight blend -- skip
            f.material_index = 0 if j < fp else 1     # slot 0 crease, 1 wall
            f.smooth = True
            # per-loop UVs: U wraps 0..1 around the perimeter (no dup verts needed)
            us = {a: i / SEG_LOOP, b: (i + 1) / SEG_LOOP, c: (i + 1) / SEG_LOOP, d: i / SEG_LOOP}
            vs = {a: j / prof, b: j / prof, c: (j + 1) / prof, d: (j + 1) / prof}
            for lp in f.loops:
                lp[uv].uv = (us[lp.vert], vs[lp.vert])
    # orient every face toward the arena interior (up + inward) -- winding-proof
    bm.normal_update()
    for f in bm.faces:
        cen = f.calc_center_median()                  # blender coords: (x, -z, y)
        gx, gz = arena_grad(cen.x, -cen.y)
        inward = Vector((-gx, gz, 0.6)).normalized()  # -grad in blender space + a bit of up
        if f.normal.dot(inward) < 0:
            f.normal_flip()
    ob = _finish(bm, "arena_bowl")
    set_mats(ob,
             mat("arena_crease", (0.11, 0.13, 0.21, 1), metal=0.35, rough=0.55),
             mat("arena_wall",   (0.17, 0.20, 0.31, 1), metal=0.50, rough=0.40))
    print("  bowl: %d perim x %d profile, perimeter length %.1f units (for texel density)"
          % (SEG_LOOP, SEG_PROFILE, perim_len))
    return ob

# --------------------------------------------------------------------------
# flat interior floor -- fan fill of the fillet-base contour (sd = -CREASE_R)
# --------------------------------------------------------------------------
def build_field():
    samples, _ = perimeter_samples(SEG_LOOP)
    ring = [project(sx, sz, -CREASE_R) for sx, sz in samples]
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    cen = bm.verts.new(g2b(0, 0, 0))
    verts = [bm.verts.new(g2b(px, 0, pz)) for px, pz in ring]
    bm.verts.ensure_lookup_table()
    sx = L + 2 * GOAL_DEPTH                            # planar UV span
    for i in range(SEG_LOOP):
        a, b = verts[i], verts[(i + 1) % SEG_LOOP]
        try:
            f = bm.faces.new((cen, a, b))
        except ValueError:
            continue
        f.smooth = True
        for lp in f.loops:
            co = lp.vert.co                            # blender: (x, -z, y)
            lp[uv].uv = (co.x / sx + 0.5, co.y / W + 0.5)
    bm.normal_update()
    for f in bm.faces:                                 # floor faces up (+z blender)
        if f.normal.z < 0:
            f.normal_flip()
    ob = _finish(bm, "field")
    set_mats(ob, mat("field", (0.10, 0.12, 0.20, 1), metal=0.0, rough=0.85))
    return ob

# --------------------------------------------------------------------------
# LED lip ring -- tube along the sd=0 contour at the wall top
# --------------------------------------------------------------------------
def build_led_ring(r=0.35, sides=8):
    samples, _ = perimeter_samples(SEG_LOOP)
    pts = []
    for sx, sz in samples:
        px, pz = project(sx, sz, 0.0)
        pts.append(Vector(g2b(px, WALL_H + 0.15, pz)))
    n = len(pts)
    bm = bmesh.new()
    rings = []
    up = Vector((0, 0, 1))                             # blender up
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
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)  # closed tube -- safe to recalc
    ob = _finish(bm, "led_ring")
    set_mats(ob, mat("led", (0.13, 0.55, 0.63, 1), metal=0.2, rough=0.4,
                     emit=(0.13, 0.88, 1.0, 1), emit_str=1.1))
    return ob

# --------------------------------------------------------------------------
# goals, base, legs
# --------------------------------------------------------------------------
def build_goal_nets():
    net_m = mat("goal_net", (0.9, 0.2, 0.25, 1), metal=0.0, rough=0.9, alpha=0.45)
    out = []
    for name, sx in (("goal_net_left", -1), ("goal_net_right", 1)):
        out.append(set_mats(gbox(name, (GOAL_DEPTH - 1.0, GOAL_H - 0.8, GOAL_HALF * 2 - 1.2),
                                 (sx * (L / 2 + GOAL_DEPTH / 2), (GOAL_H - 0.8) / 2, 0)), net_m))
    return out

def build_goal_frames():
    frame_m = mat("goal_frame", (0.92, 0.94, 1.0, 1), metal=0.6, rough=0.25)
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

def build_base_legs():
    body_m = mat("table_base", (0.06, 0.07, 0.12, 1), metal=0.4, rough=0.5)
    out = [set_mats(gbox("table_base", (L + 10, 10, W + 10), (0, -5.2, 0)), body_m)]
    for sx in (-1, 1):
        for sz in (-1, 1):
            out.append(set_mats(gbox("table_leg", (4, 34, 4),
                                     (sx * (L / 2 - 2), -27, sz * (W / 2 - 2))), body_m))
    return out

# --------------------------------------------------------------------------
# balls -- one sphere per game ball type, named EXACTLY like the type key
# --------------------------------------------------------------------------
def build_balls():
    out = []
    for i, (name, col, emit, metal) in enumerate(BALL_TYPES):
        bm = bmesh.new()
        try:
            bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=BALL_R)
        except TypeError:                              # older bpy uses 'diameter'
            bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, diameter=BALL_R)
        uv = bm.loops.layers.uv.new("UVMap")
        for f in bm.faces:
            f.smooth = True
            us = {}
            for lp in f.loops:
                co = lp.vert.co
                us[lp] = 0.5 + math.atan2(co.y, co.x) / (2 * math.pi)
            if max(us.values()) - min(us.values()) > 0.5:      # seam wrap fix
                us = {lp: (u + 1.0 if u < 0.5 else u) for lp, u in us.items()}
            for lp in f.loops:
                co = lp.vert.co
                lp[uv].uv = (us[lp], 0.5 + math.asin(max(-1, min(1, co.z / BALL_R))) / math.pi)
        ob = _finish(bm, name, smooth=True)
        # scene layout only -- the export zeroes locations so the GLB has them at origin
        ob.location = g2b(-24 + i * 12, BALL_R, W / 2 + 16)
        rough = 0.25 if metal > 0.5 else 0.4
        set_mats(ob, mat("ball_" + name, col, metal=metal, rough=rough,
                         emit=emit, emit_str=0.9 if emit else 0.0))
        out.append(ob)
    return out

# --------------------------------------------------------------------------
# reference markers (ref_*) -- player positions + slide ranges, never exported
# --------------------------------------------------------------------------
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

# --------------------------------------------------------------------------
# the room -- neon arcade / esports den (room_*), exported separately
# --------------------------------------------------------------------------
def build_room():
    out = []
    RW, RD, RH = 380.0, 300.0, 148.0                  # room width (x), depth (z), height
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
    # LED edge strips: cyan along the floor, pink along the ceiling
    for name, gs, gl, m in (
        ("room_led_floor_b", (RW - 4, 0.8, 0.8), (0, fy + 0.6, -RD / 2 + 1), cyan),
        ("room_led_floor_f", (RW - 4, 0.8, 0.8), (0, fy + 0.6,  RD / 2 - 1), cyan),
        ("room_led_floor_l", (0.8, 0.8, RD - 4), (-RW / 2 + 1, fy + 0.6, 0), cyan),
        ("room_led_floor_r", (0.8, 0.8, RD - 4), ( RW / 2 - 1, fy + 0.6, 0), cyan),
        ("room_led_ceil_b",  (RW - 4, 0.8, 0.8), (0, fy + RH - 0.6, -RD / 2 + 1), pink),
        ("room_led_ceil_f",  (RW - 4, 0.8, 0.8), (0, fy + RH - 0.6,  RD / 2 - 1), pink)):
        out.append(set_mats(gbox(name, gs, gl), m))
    # posters on the back wall -- one material each so every print is its own texture
    for i, px in enumerate((-75, 0, 75)):
        pm = mat("poster_%d" % (i + 1), (0.08, 0.06, 0.14, 1), rough=0.5,
                 emit=(0.35, 0.18, 0.6, 1), emit_str=0.35)
        out.append(set_mats(gbox("room_poster_%d" % (i + 1), (26, 38, 0.6), (px, fy + 70, -RD / 2 + 0.7)), pm))
    # neon sign above the posters
    out.append(set_mats(gbox("room_sign", (90, 16, 1), (0, fy + 114, -RD / 2 + 0.8)), pink))
    # two arcade cabinets against the left wall
    cab = mat("room_cabinet", (0.07, 0.07, 0.11, 1), metal=0.2, rough=0.6)
    scr = mat("room_screen", (0.02, 0.05, 0.06, 1), rough=0.2, emit=(0.2, 0.9, 1.0, 1), emit_str=1.6)
    for i, cz in enumerate((-70, -25)):
        out.append(set_mats(gbox("room_cab%d_body" % (i + 1), (20, 58, 24), (-RW / 2 + 12, fy + 29, cz)), cab))
        out.append(set_mats(gbox("room_cab%d_screen" % (i + 1), (1, 15, 16), (-RW / 2 + 22.4, fy + 40, cz)), scr))
        out.append(set_mats(gbox("room_cab%d_marquee" % (i + 1), (2, 6, 20), (-RW / 2 + 21.5, fy + 55, cz)), pink if i else cyan))
    # rug + stools
    out.append(set_mats(gbox("room_rug", (200, 0.4, 140), (0, fy + 0.2, 0)),
                        mat("room_rug", (0.09, 0.05, 0.16, 1), rough=0.95)))
    seat = mat("room_stool", (0.12, 0.12, 0.16, 1), metal=0.5, rough=0.35)
    for i, (sx, sz) in enumerate(((105, 55), (-60, 78))):
        parts = [set_mats(gcyl("s", 6, 3, "y", (sx, fy + 22.5, sz), seg=16), seat),
                 set_mats(gcyl("l", 1.2, 21, "y", (sx, fy + 10.5, sz), seg=10), seat)]
        out.append(merge("room_stool_%d" % (i + 1), parts))
    return out

def add_lights(col):
    """Viewport/render lights only -- lights aren't meshes, exports skip them."""
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

# --------------------------------------------------------------------------
# first-pass GLB export (fresh objects -- no baking needed; texture + re-export
# later with tools/export_arena_table.py)
# --------------------------------------------------------------------------
def export_glb(objs, filename, zero_locations=False):
    saved = {}
    if zero_locations:
        for ob in objs:
            saved[ob] = ob.location.copy()
            ob.location = (0, 0, 0)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(OUT_DIR, filename)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True)
    for ob, loc in saved.items():
        ob.location = loc
    print("  wrote", path)

# --------------------------------------------------------------------------
def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print("Fuzeball ARENA build ->", OUT_DIR)

    # clear Blender's default startup objects (only these -- never user work)
    for nm in ("Cube", "Camera", "Light"):
        ob = bpy.data.objects.get(nm)
        if ob:
            bpy.data.objects.remove(ob, do_unlink=True)

    col_t = reset_collection("Arena Table")
    put(col_t, build_bowl(), build_field(), build_led_ring())
    put(col_t, *build_goal_nets())
    put(col_t, *build_goal_frames())
    put(col_t, *build_base_legs())

    col_b = reset_collection("Balls")
    balls = build_balls()
    put(col_b, *balls)

    col_r = reset_collection("Reference")
    put(col_r, *build_reference())

    col_m = reset_collection("Room")
    put(col_m, *build_room())
    add_lights(col_m)

    # save the .blend for texturing -- never clobber an existing (textured) one
    blend = os.path.join(OUT_DIR, "fuzeball_arena.blend")
    if os.path.exists(blend):
        blend = os.path.join(OUT_DIR, "fuzeball_arena_rebuilt.blend")
        print("  existing fuzeball_arena.blend kept -- saving fresh build as", os.path.basename(blend))
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print("  saved", blend)

    # first-pass GLBs so the game shows the arena right away
    table = [o for o in col_t.objects if o.type == "MESH"]
    export_glb(table, "fuzeball_table_arena.glb")
    export_glb(balls, "fuzeball_ball.glb", zero_locations=True)
    room = [o for o in col_m.objects if o.type == "MESH"]
    export_glb(room, "fuzeball_room_arena.glb")

    print("Done. Texture the .blend, then run tools/export_arena_table.py.")
    print("Name contract: 'field' hidden in-game, 'led*' -> LED fx material,")
    print("'goal_net_left/right' -> team colours, ball meshes = ball type keys.")

if __name__ == "__main__":
    main()
