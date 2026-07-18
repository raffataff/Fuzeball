"""
export_table.py  --  export your textured Fuzeball table to game GLBs (any table).

Run inside Blender with your table .blend open:
    Scripting tab -> open this file -> set TABLE_ID / SKIN_ID -> Run Script
    (or headless:  blender -b "fuzeball_classic_glass.blend" -P tools/export_table.py -- classic glass)

ONE exporter for every table. It writes into assets/tables/<folder>/ (each table
owns its folder), producing:
    <glb>                 -- the table: EVERY mesh that isn't a ball / room_* / ref_*
                             (kept at world position). Naming is up to you; the game
                             routes by prefix (field*/led*/goal_net*/goal_frame*/wall_end*).
    fuzeball_ball.glb     -- the five ball-type spheres, EACH recentred to the origin
                             (the game overlays them and shows only the active type).
    fuzeball_room_<id>.glb -- everything named room_* (only if the table has a room).

ref_* objects (player-position markers, slide guides) are NEVER exported.

Robustness (same as export_arena_table.py): the glTF exporter trips over negative
scale and some modifiers, so nothing is exported directly. Each object is baked into
a fresh throwaway copy (modifiers applied, transform flattened, winding fixed if
mirrored), the copies are exported, then deleted. Your scene is never modified.

Legacy single-table exporter kept as a backup: tools/export_arena_table.py.
"""
import bpy, bmesh, os, sys
from mathutils import Vector, Matrix

# --------------------------------------------------------------------------
# Your Fuzeball project folder. Leave "" to auto-detect (works headless AND from
# the Text Editor). Set an absolute path if auto-detect ever guesses wrong.
# --------------------------------------------------------------------------
PROJECT_DIR_OVERRIDE = r"E:\bobby\Documents\Fuzeball"

# --------------------------------------------------------------------------
# WHICH TABLE + SKIN  (edit here, or pass `-- <table> [skin]` headless). Mirrors
# the folder / skins / room fields of js/config.js CONFIG.tables + build_table.py.
# SKIN_ID = "" means the table's default skin.
# --------------------------------------------------------------------------
TABLE_ID = "classic"
SKIN_ID  = "glass"

# Balls + pitches live in their own scenes, so this exporter ignores them. Flip
# INCLUDE_BALLS to True only if you want it to also write fuzeball_ball.glb.
INCLUDE_BALLS = False

TABLES = {
    "classic": {"folder": "classic", "room": False, "defSkin": "alienShip",
                "skins": {"alienShip": "fuzeball_table_classic.glb",           # re-export your hand-made classic here
                          "glass": "fuzeball_table_classic_glass.glb"}},
    "arena":   {"folder": "arena",   "room": True,  "defSkin": "standard",
                "skins": {"standard": "fuzeball_table_arena.glb"}},
    "circuit": {"folder": "circuit", "room": False, "defSkin": "standard",
                "skins": {"standard": "fuzeball_table_circuit.glb"}},
}

BALL_NAMES  = ("classic", "fire", "cannon", "split", "golden")
ROOM_PREFIX = "room_"
SKIP_PREFIX = "ref_"

def resolve_id():
    argv = sys.argv
    if "--" in argv:
        extra = argv[argv.index("--") + 1:]
        if extra and extra[0] in TABLES:
            return extra[0]
    return TABLE_ID

def resolve_skin(d):
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

def assets_dir(folder):
    return os.path.normpath(os.path.join(project_root(), "assets", "tables", folder))

def base_name(name):
    return name.split(".")[0]                      # "goal_net_left.001" -> "goal_net_left"

def world_bbox_center(ob):
    cs = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    return sum(cs, Vector((0, 0, 0))) / 8.0

def baked_copy(src, translate=None):
    """Fresh object at identity with src's world geometry baked in (modifiers
    applied, transform flattened). Optional extra world-space translate."""
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(src.evaluated_get(deps))
    mw = src.matrix_world.copy()
    if translate is not None:
        mw = Matrix.Translation(translate) @ mw
    me.transform(mw)
    if mw.determinant() < 0:                       # mirrored -> fix inside-out winding
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(me); bm.free()
    return bpy.data.objects.new(src.name, me)

def export_objects(sources, out_dir, filename, translate_map=None):
    if not sources:
        print("  nothing to export for", filename); return
    tmp = bpy.data.collections.new("__fz_export_tmp")
    bpy.context.scene.collection.children.link(tmp)
    copies = [baked_copy(s, (translate_map or {}).get(s)) for s in sources]
    for c in copies:
        tmp.objects.link(c)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for c in copies:
        c.select_set(True)
    try:
        bpy.context.view_layer.objects.active = copies[0]
    except Exception:
        pass
    path = os.path.join(out_dir, filename)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB",
                              use_selection=True, export_yup=True, export_apply=False)
    print("  wrote %s  (%d objects)" % (path, len(copies)))
    for c in copies:
        m = c.data
        bpy.data.objects.remove(c, do_unlink=True)
        bpy.data.meshes.remove(m, do_unlink=True)
    bpy.data.collections.remove(tmp)

def main():
    tid = resolve_id()
    d = TABLES[tid]
    skin = resolve_skin(d)
    table_glb = d["skins"][skin]
    out_dir = assets_dir(d["folder"])
    os.makedirs(out_dir, exist_ok=True)
    print("Fuzeball table export: '%s' skin '%s' ->" % (tid, skin), out_dir)

    meshes = [o for o in bpy.data.objects
              if o.type == "MESH" and not base_name(o.name).startswith(SKIP_PREFIX)]

    balls = [o for o in meshes if base_name(o.name) in BALL_NAMES]
    room  = [o for o in meshes if base_name(o.name).startswith(ROOM_PREFIX)]
    ballset, roomset = set(balls), set(room)
    # the table = everything else (any mesh the artist added; the game routes by name prefix)
    table = [o for o in meshes if o not in ballset and o not in roomset]

    export_objects(table, out_dir, table_glb)
    if not table:
        print("  (no table meshes found -- check you have the .blend open)")

    # balls are excluded from the table GLB above; only export them if you ask (default: no,
    # you keep balls in a separate scene)
    if INCLUDE_BALLS:
        export_objects(balls, out_dir, "fuzeball_ball.glb",
                       translate_map={b: -world_bbox_center(b) for b in balls})
        if not balls:
            print("  (no ball meshes named classic/fire/cannon/split/golden)")

    if d.get("room"):
        export_objects(room, out_dir, "fuzeball_room_%s.glb" % tid)
    elif room:
        print("  (%d room_* meshes found but table '%s' has room=False -- skipped)" % (len(room), tid))

    print("Done ->", out_dir)

if __name__ == "__main__":
    # Text Editor "Run Script" is mid-draw -> defer one tick so export doesn't throw
    # "can't modify blend data in this state". Headless has no event loop -> call now.
    if bpy.app.background:
        main()
    else:
        bpy.app.timers.register(main, first_interval=0.01)
