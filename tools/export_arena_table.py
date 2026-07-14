"""
export_arena_table.py  --  export your textured Fuzeball ARENA to game GLBs.

Run inside Blender with your arena .blend open:
    Scripting tab -> open this file -> Run Script
    (or headless:  blender -b "fuzeball_arena.blend" -P tools/export_arena_table.py)

Writes into ASSETS_DIR (assets/tables/arena/ -- each table owns its folder):
    fuzeball_table_arena.glb  -- bowl, field, LED ring, nets, frames, base, legs
                                 (everything kept at its world position)
    fuzeball_ball.glb         -- the five ball-type spheres, EACH recentred to
                                 the origin (the game overlays them and shows
                                 only the active type's mesh)
    fuzeball_room_arena.glb   -- everything named room_* at world position

ref_* objects (player-position markers, slide guides) are never exported --
they exist purely so you can see where the players live while texturing.

Robustness: same trick as export_fuzeball_models.py -- the glTF exporter trips
over negative scale and some modifiers, so nothing is exported directly. Each
object is baked into a fresh throwaway copy (modifiers applied, transform
flattened, winding fixed if mirrored), the copies are exported, then deleted.
Your scene is never modified.
"""
import bpy, bmesh, os
from mathutils import Vector, Matrix

ASSETS_DIR_OVERRIDE = r"E:\bobby\Documents\Fuzeball\assets\tables\arena"   # game folder (your .blend may live elsewhere)
try:
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
except NameError:
    SCRIPT_DIR = os.path.dirname(bpy.data.filepath)
ASSETS_DIR = ASSETS_DIR_OVERRIDE or os.path.normpath(os.path.join(SCRIPT_DIR, "..", "assets", "tables", "arena"))

# name (minus Blender's .001 suffix) -> which GLB it lands in
TABLE_PREFIXES = ("arena_bowl", "field", "led", "goal_net", "goal_frame",
                  "table_base", "table_leg")
BALL_NAMES     = ("classic", "fire", "cannon", "split", "golden")
ROOM_PREFIX    = "room_"
SKIP_PREFIX    = "ref_"

def base_name(name):
    return name.split(".")[0]                      # "goal_net_left.001" -> "goal_net_left"

def world_bbox_center(ob):
    cs = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    return sum(cs, Vector((0, 0, 0))) / 8.0

def baked_copy(src, translate=None):
    """Fresh object at identity with src's world geometry baked in (modifiers
    applied, transform flattened). Optional extra world-space translate."""
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(src.evaluated_get(deps))  # applies modifiers, keeps materials
    mw = src.matrix_world.copy()
    if translate is not None:
        mw = Matrix.Translation(translate) @ mw
    me.transform(mw)
    if mw.determinant() < 0:                       # mirrored -> fix inside-out winding
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(me); bm.free()
    return bpy.data.objects.new(src.name, me)

def export_objects(sources, filename, translate_map=None):
    """sources = list of objects; translate_map = {object: world-space Vector}"""
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
        pass  # restricted context (Blender 4.x headless)
    path = os.path.join(ASSETS_DIR, filename)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB",
                              use_selection=True, export_yup=True, export_apply=False)
    print("  wrote %s  (%d objects)" % (path, len(copies)))
    for c in copies:
        m = c.data
        bpy.data.objects.remove(c, do_unlink=True)
        bpy.data.meshes.remove(m, do_unlink=True)
    bpy.data.collections.remove(tmp)

def main():
    os.makedirs(ASSETS_DIR, exist_ok=True)
    meshes = [o for o in bpy.data.objects
              if o.type == "MESH" and not base_name(o.name).startswith(SKIP_PREFIX)]

    # ---- the table: world positions ----
    table = [o for o in meshes if base_name(o.name).startswith(TABLE_PREFIXES)]
    export_objects(table, "fuzeball_table_arena.glb")
    if not table:
        print("  (no table parts matched TABLE_PREFIXES -- check your names)")

    # ---- balls: one GLB, every ball recentred onto the origin ----
    balls = [o for o in meshes if base_name(o.name) in BALL_NAMES]
    export_objects(balls, "fuzeball_ball.glb",
                   translate_map={b: -world_bbox_center(b) for b in balls})
    if not balls:
        print("  (no ball meshes named classic/fire/cannon/split/golden)")

    # ---- the room: world positions ----
    room = [o for o in meshes if base_name(o.name).startswith(ROOM_PREFIX)]
    export_objects(room, "fuzeball_room_arena.glb")

    print("Done ->", ASSETS_DIR)

if __name__ == "__main__":
    # Two ways this script gets run, each needs a different launch:
    #   * From the Text Editor's "Run Script" button, Blender is mid-draw, so
    #     calling bpy.ops.export_scene.gltf right now throws "can't modify blend
    #     data in this state (drawing/rendering)". Defer it one tick via a timer
    #     so it fires AFTER the draw finishes -- this is the fix for the crash.
    #   * Headless (blender -b file.blend -P this.py) there's no draw context and
    #     no event loop to service timers, so we just call main() straight away.
    if bpy.app.background:
        main()
    else:
        bpy.app.timers.register(main, first_interval=0.01)
