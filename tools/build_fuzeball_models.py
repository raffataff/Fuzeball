"""
build_fuzeball_models.py  --  Fuzeball table geometry -> GLB assets

Run inside Blender (it needs `bpy`). Headless from the project root:

    blender -b -P tools/build_fuzeball_models.py

...or open Blender, Scripting tab, load this file, Run Script. It builds the
whole table at the game's exact dimensions (so you can eyeball it), then writes
one .glb per part into ../assets/ for you to texture and re-export.

Everything is authored in GAME coordinates (identical numbers to js/config.js):
    X = long axis (goal to goal, goals at x = +/-60)
    Y = up (field surface at y = 0)
    Z = width (side walls at z = +/-35.5)

They are placed into Blender with Y-up -> Z-up conversion, so the table looks
correct in the Blender viewport AND, with the exporter's default "+Y up", the
GLBs come out in the game's coordinate frame with no extra rotation needed.

------------------------------------------------------------------------------
THE ROD-LENGTH FIX (the "handle through the wall" bug)
------------------------------------------------------------------------------
The game builds every rod with one length (F.W+30) and one handle stick-out
(handleOut=11). But each rod slides a different amount:

    men  spacing  maxOff(slide)
     1    ---       30.5     <- goalie slides the most
     2    24.0      18.5
     3    18.5      12.0
     5    11.9       6.7

maxOff = (W - margin - (men-1)*spacing) / 2   with W=68, margin=7

With stick-out of only 11, the goalie's handle (at z=45) gets dragged to
z = 45 - 30.5 = 14.5 at full inward slide -- well inside the near wall (outer
face z=37). That's the handle punching through the wall.

Fix: size each rod to its own slide range. The handle collar sits at
    collar = WALL_OUT + CLEAR + maxOff
so that at full inward slide (offset = -maxOff) the collar is still
`CLEAR` units outside the wall. The bar is symmetric (-collar..+collar) so the
far end likewise always clears the far wall. Result: one rod .glb per man count.
"""

import bpy, bmesh, math, os
from mathutils import Matrix

# --------------------------------------------------------------------------
# where to write the .glb files
# --------------------------------------------------------------------------
ASSETS_DIR_OVERRIDE = r""   # set an absolute path here to force a location
try:
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
except NameError:
    SCRIPT_DIR = os.path.dirname(bpy.data.filepath)
ASSETS_DIR = ASSETS_DIR_OVERRIDE or os.path.normpath(os.path.join(SCRIPT_DIR, "..", "assets"))

# --------------------------------------------------------------------------
# game constants (mirror js/config.js -- keep in sync if you retune there)
# --------------------------------------------------------------------------
L, W          = 120.0, 68.0        # table length (x), width (z)
WALL_H        = 10.0               # F.wallH
GOAL_HALF     = 11.0               # half goal-mouth width
GOAL_H        = 9.5
GOAL_DEPTH    = 9.0
ROD_R         = 0.55              # rod bar radius (world.js)
ROD_MARGIN    = 7.0               # CONFIG.rods.margin
SPACING       = {2: 24.0, 3: 18.5}  # else 11.9
ROD_DEFS      = [                  # (x, team, men, role) -- CONFIG.rods.defs
    (-52.5, 0, 1, "GK"), (-37.5, 0, 2, "DEF"), (-22.5, 1, 3, "ATT"),
    (-7.5, 0, 5, "MID"), (7.5, 1, 5, "MID"), (22.5, 0, 3, "ATT"),
    (37.5, 1, 2, "DEF"), (52.5, 1, 1, "GK"),
]

# rod / handle sizing knobs (the fix)
WALL_OUT   = W / 2 + 1.5 + 1.5     # outer face of the side wall = 37.0
CLEAR      = 2.5                   # min stick-out past the wall at worst slide
HANDLE_LEN = 8.0
HANDLE_R   = 1.4
KNOB_LEN   = 2.4
KNOB_R     = 1.7
COLLAR_LEN = 2.4                  # far-end stopper/bumper width (opposite the handle)
COLLAR_R   = 1.1
CAP_OUT    = 3.0                  # constant amount the bar tip pokes past the collar

GK_SLIDE = 13.0                   # goalie slide cap (CONFIG.rods.gkSlide) — keeper stays in its area

def spacing_for(men):
    return SPACING.get(men, 11.9)

def max_off(men):
    mo = (W - ROD_MARGIN - (men - 1) * spacing_for(men)) / 2.0
    return min(mo, GK_SLIDE) if men == 1 else mo   # 1-man rod is the goalie

def collar_for(men):
    return WALL_OUT + CLEAR + max_off(men)   # handle-collar z at rest

# --------------------------------------------------------------------------
# coordinate conversion: GAME (Y-up) -> BLENDER (Z-up)
#   game (x, y, z) -> blender (x, -z, y)     [ = Rot(+90 deg, X) ]
# On glTF export with "+Y up" this maps straight back to game coords.
# --------------------------------------------------------------------------
def g2b_loc(x, y, z):
    return (x, -z, y)

# game length-axis 'x'/'y'/'z' -> blender axis for a cylinder's long axis
_G2B_AXIS = {"x": "X", "y": "Z", "z": "Y"}

# --------------------------------------------------------------------------
# low-level mesh builders (bmesh, clean normals, no bpy.ops geometry)
# --------------------------------------------------------------------------
def _finish(bm, name):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    return bpy.data.objects.new(name, me)

def gbox(name, gsize, gloc):
    """Axis-aligned box. gsize/gloc are GAME-space (sx,sy,sz)/(x,y,z)."""
    sx, sy, sz = gsize
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    # cube is 1x1x1 in blender; scale to blender dims (sx, sz, sy)
    bmesh.ops.scale(bm, vec=(sx, sz, sy), verts=bm.verts)
    ob = _finish(bm, name)
    ob.location = g2b_loc(*gloc)
    return ob

def gcyl(name, radius, length, gaxis, gloc, seg=24):
    """Cylinder of given radius/length running along GAME axis gaxis."""
    baxis = _G2B_AXIS[gaxis]
    bm = bmesh.new()
    hz = length / 2.0
    bottom, top = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        x, y = math.cos(a) * radius, math.sin(a) * radius
        bottom.append(bm.verts.new((x, y, -hz)))
        top.append(bm.verts.new((x, y, hz)))
    bm.verts.ensure_lookup_table()
    for i in range(seg):
        j = (i + 1) % seg
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
    bm.faces.new(tuple(reversed(bottom)))
    bm.faces.new(tuple(top))
    if baxis == "X":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), verts=bm.verts, matrix=Matrix.Rotation(math.radians(90), 3, "Y"))
    elif baxis == "Y":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), verts=bm.verts, matrix=Matrix.Rotation(math.radians(90), 3, "X"))
    ob = _finish(bm, name)
    ob.location = g2b_loc(*gloc)
    return ob

# --------------------------------------------------------------------------
# materials -- one slot per part, named so you (and the game) can find them.
# 'team' / 'team_glow' are the two the game tints per side.
# --------------------------------------------------------------------------
_MATS = {}
def mat(name, rgba, metal=0.1, rough=0.6, emit=None):
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Metallic"].default_value = metal
        bsdf.inputs["Roughness"].default_value = rough
        if emit is not None:
            # emission socket name differs across Blender versions
            for key in ("Emission Color", "Emission"):
                if key in bsdf.inputs:
                    bsdf.inputs[key].default_value = emit
                    break
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = 1.0
    m.diffuse_color = rgba
    _MATS[name] = m
    return m

def set_mat(ob, m):
    ob.data.materials.append(m)
    return ob

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

def export_glb(objs, filename):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(ASSETS_DIR, filename)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True,
        export_yup=True, export_apply=True,
    )
    print("  wrote", path)

# --------------------------------------------------------------------------
# part factories (return list of objects, built at the given world x for rods
# or at true world positions for static parts)
# --------------------------------------------------------------------------
def build_rod(men, gx=0.0):
    collar = collar_for(men)
    # bar reaches collar + bumper + cap on each end; the grip hides the near tip.
    bar = set_mat(gcyl(f"rod{men}_bar", ROD_R, 2 * (collar + COLLAR_LEN + CAP_OUT), "z", (gx, 0, 0)),
                  mat("rod_metal", (0.78, 0.81, 0.86, 1), metal=0.9, rough=0.25))
    grip = set_mat(gcyl(f"rod{men}_handle", HANDLE_R, HANDLE_LEN, "z",
                        (gx, 0, collar + HANDLE_LEN / 2)),
                   mat("team", (0.90, 0.22, 0.28, 1), metal=0.15, rough=0.45))
    knob = set_mat(gcyl(f"rod{men}_knob", KNOB_R, KNOB_LEN, "z",
                        (gx, 0, collar + HANDLE_LEN + KNOB_LEN / 2)),
                   mat("team_glow", (1.0, 0.28, 0.34, 1), metal=0.3, rough=0.35,
                       emit=(1.0, 0.15, 0.2, 1)))
    # collar: the stopper opposite the handle; bar tip pokes CAP_OUT past it.
    coll = set_mat(gcyl(f"rod{men}_collar", COLLAR_R, COLLAR_LEN, "z",
                        (gx, 0, -(collar + COLLAR_LEN / 2))),
                   mat("collar", (0.08, 0.09, 0.12, 1), metal=0.2, rough=0.7))
    return [bar, grip, knob, coll]

def build_side_wall(sz):
    return [set_mat(gbox(f"wall_side_{'p' if sz>0 else 'n'}", (L + 10, WALL_H + 2, 3),
                         (0, (WALL_H + 2) / 2 - 1, sz * (W / 2 + 1.5))),
                    mat("wall", (0.48, 0.29, 0.13, 1), metal=0.1, rough=0.6))]

def build_end_wall(sx, sz):
    seg_w = (W - 2 * GOAL_HALF) / 2                     # = 23
    return [set_mat(gbox("wall_end", (3, WALL_H + 2, seg_w),
                         (sx * (L / 2 + 1.5), (WALL_H + 2) / 2 - 1, sz * (GOAL_HALF + seg_w / 2))),
                    mat("wall", (0.48, 0.29, 0.13, 1), metal=0.1, rough=0.6))]

def build_led(sz):
    return [set_mat(gbox("led_strip", (L + 10, 0.7, 0.7), (0, WALL_H + 1.15, sz * (W / 2 + 1.5))),
                    mat("led", (0.22, 0.88, 1.0, 1), metal=0.2, rough=0.4, emit=(0.22, 0.88, 1.0, 1)))]

def build_table_body():
    return [set_mat(gbox("table_base", (L + 10, 10, W + 10), (0, -5.2, 0)),
                    mat("table_base", (0.09, 0.10, 0.14, 1), metal=0.2, rough=0.7))]

def build_leg(sx, sz):
    return [set_mat(gbox("table_leg", (4, 34, 4), (sx * (L / 2 - 2), -27, sz * (W / 2 - 2))),
                    mat("table_leg", (0.13, 0.15, 0.2, 1), metal=0.3, rough=0.6))]

def build_field():
    return [set_mat(gbox("field", (L, 0.2, W), (0, -0.1, 0)),
                    mat("field", (0.12, 0.49, 0.24, 1), metal=0.0, rough=0.85))]

def build_goal(gx, netdir):
    """One goal at world x=gx. netdir (+1/-1) = outward direction the net extends."""
    frame = mat("goal_frame", (0.95, 0.95, 0.95, 1), metal=0.5, rough=0.3)
    net_m = mat("goal_net", (0.9, 0.2, 0.25, 0.4), metal=0.0, rough=0.9)
    objs = []
    for sz in (-1, 1):                                  # two posts
        objs.append(set_mat(gbox("goal_post", (1.2, GOAL_H + 1, 1.2),
                                 (gx, (GOAL_H + 1) / 2, sz * GOAL_HALF)), frame))
    objs.append(set_mat(gbox("goal_crossbar", (1.2, 1.2, GOAL_HALF * 2 + 1.2),
                             (gx, GOAL_H + 0.5, 0)), frame))
    objs.append(set_mat(gbox("goal_net", (GOAL_DEPTH, GOAL_H, GOAL_HALF * 2),
                             (gx + netdir * (GOAL_DEPTH / 2 + 1.6), GOAL_H / 2, 0)), net_m))
    return objs

# --------------------------------------------------------------------------
# 1) build the assembled arena (for visual verification in Blender)
# --------------------------------------------------------------------------
def build_arena():
    col = reset_collection("Fuzeball Arena")
    put(col, *build_field())
    put(col, *build_table_body())
    for sx in (-1, 1):
        for sz in (-1, 1):
            put(col, *build_leg(sx, sz))
    for sz in (-1, 1):
        put(col, *build_side_wall(sz))
        put(col, *build_led(sz))
    for sx in (-1, 1):
        for sz in (-1, 1):
            put(col, *build_end_wall(sx, sz))
    build_goal_arena(col)
    for (gx, team, men, role) in ROD_DEFS:
        put(col, *build_rod(men, gx))
    return col

def build_goal_arena(col):
    put(col, *build_goal(-L / 2, -1))   # left goal, net points -x
    put(col, *build_goal(L / 2, 1))     # right goal, net points +x

# --------------------------------------------------------------------------
# 2) build each unique part at local origin, export, then discard
# --------------------------------------------------------------------------
def export_all_parts():
    tmp = reset_collection("Fuzeball Export Temp")

    def one(objs, fname):
        for o in objs:
            tmp.objects.link(o)
        export_glb(objs, fname)
        for o in list(objs):
            bpy.data.objects.remove(o, do_unlink=True)

    # rods -- one per man count, origin at bar center, handle on +z
    for men in (1, 2, 3, 5):
        one(build_rod(men, 0.0), f"fuzeball_rod_{men}man.glb")
    # static parts, centered / at a clean local origin
    one(build_side_wall(1), "fuzeball_wall_side.glb")
    one(build_end_wall(1, 1), "fuzeball_wall_end.glb")
    one(build_led(1), "fuzeball_led_strip.glb")
    one(build_table_body(), "fuzeball_table_base.glb")
    one(build_leg(1, 1), "fuzeball_table_leg.glb")
    one(build_field(), "fuzeball_field.glb")
    one(build_goal(0.0, 1), "fuzeball_goal.glb")   # generic: net points +x, mirror for other end

    bpy.data.collections.remove(tmp)

# --------------------------------------------------------------------------
def main():
    os.makedirs(ASSETS_DIR, exist_ok=True)
    print("Fuzeball model build -> ", ASSETS_DIR)
    print("Rod sizing (men: maxOff -> collar -> total bar length):")
    for men in (1, 2, 3, 5):
        c = collar_for(men)
        print(f"  {men}-man: maxOff={max_off(men):.1f}  collar={c:.1f}  bar_len={2*c:.1f}")
    build_arena()          # leaves the assembled table in the scene
    export_all_parts()     # writes the .glb files
    bpy.ops.object.select_all(action="DESELECT")
    print("Done.")

if __name__ == "__main__":
    main()
