"""
export_fuzeball_models.py  --  export your edited Fuzeball arena to game GLBs.

Run inside Blender with your table.blend open:
    Scripting tab -> open this file -> Run Script
    (or headless:  blender -b "table.blend" -P tools/export_fuzeball_models.py)

Writes into ASSETS_DIR:
    fuzeball_table.glb      -- every static part, kept at its world position
    fuzeball_rod_1man.glb   -- goalie rod, recentred onto its pivot
    fuzeball_rod_2man.glb / _3man / _5man

Robustness: the glTF exporter trips over negative object scale (from mirroring
parts to the far side) and some modifiers, throwing an IndexError. So this
doesn't export your objects directly -- for each one it bakes the world
transform into a fresh throwaway mesh (modifiers applied, scale/rotation
flattened, winding fixed if the object was mirrored), exports those clean
copies, then deletes them. Your scene is never modified.

Rods: each rod GLB is recentred on its PIVOT = the bar's axis at the men's
centre (world Y = 0), so it drops straight onto the game's rotating/sliding rod
even if you trimmed a bar unevenly. One instance per man-count is exported (the
non-".001" one); the game mirrors it for the other side, so keep the exported
rod's handle on +Z.
"""
import bpy, bmesh, os
from mathutils import Vector, Matrix

ASSETS_DIR_OVERRIDE = r"E:\bobby\Documents\Fuzeball\assets"   # game assets folder (your .blend lives elsewhere)
try:
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
except NameError:
    SCRIPT_DIR = os.path.dirname(bpy.data.filepath)
ASSETS_DIR = ASSETS_DIR_OVERRIDE or os.path.normpath(os.path.join(SCRIPT_DIR, "..", "assets"))

# a static part = any object whose name (minus Blender's .001 suffix) starts with one of these
STATIC_PREFIXES = ("field", "wall_side", "wall_end", "wall", "led_strip",
                   "table_base", "table_leg", "goal_post", "goal_crossbar", "goal_net")
ROD_PARTS = ("bar", "collar", "handle", "knob")   # pieces that make up one rod

def base_name(name):
    return name.split(".")[0]                      # "goal_net.001" -> "goal_net"

def world_bbox_center(ob):
    cs = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    return sum(cs, Vector((0, 0, 0))) / 8.0

def baked_copy(src, translate=None):
    """Fresh object at identity with src's world geometry baked in (modifiers
    applied, scale/rotation flattened). Optional extra world-space translate."""
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(src.evaluated_get(deps))  # applies modifiers, keeps materials
    mw = src.matrix_world.copy()
    if translate is not None:
        mw = Matrix.Translation(translate) @ mw
    me.transform(mw)                               # bake world transform into the verts
    if mw.determinant() < 0:                       # mirrored -> fix inside-out winding
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(me); bm.free()
    return bpy.data.objects.new(src.name, me)

def export_objects(sources, filename, translate=None):
    if not sources:
        print("  nothing to export for", filename); return
    tmp = bpy.data.collections.new("__fz_export_tmp")
    bpy.context.scene.collection.children.link(tmp)
    copies = [baked_copy(s, translate) for s in sources]
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
    for c in copies:                               # tidy up the throwaways
        m = c.data
        bpy.data.objects.remove(c, do_unlink=True)
        bpy.data.meshes.remove(m, do_unlink=True)
    bpy.data.collections.remove(tmp)

def main():
    os.makedirs(ASSETS_DIR, exist_ok=True)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]

    # ---- static table: everything at its world position ----
    static = [o for o in meshes if base_name(o.name).startswith(STATIC_PREFIXES)]
    export_objects(static, "fuzeball_table.glb")
    if not static:
        print("  (no static parts matched STATIC_PREFIXES -- check your names)")

    # ---- rods: one GLB per man-count, recentred on the pivot ----
    for n in (1, 2, 3, 5):
        bar = bpy.data.objects.get("rod%d_bar" % n)
        if not bar:
            print("  skip rod%d (no 'rod%d_bar')" % (n, n)); continue
        pieces = [bpy.data.objects.get("rod%d_%s" % (n, p)) for p in ROD_PARTS]
        pieces = [p for p in pieces if p]
        piv_e = bpy.data.objects.get("rod%d_pivot" % n)   # from show_slide_ranges.py, if present
        if piv_e:
            pivot = piv_e.matrix_world.translation.copy()  # exact, user-visible pivot
        else:
            c = world_bbox_center(bar)
            pivot = Vector((c.x, 0.0, c.z))                # fall back to bar axis at men centre (Y=0)
        export_objects(pieces, "fuzeball_rod_%dman.glb" % n, translate=-pivot)

    print("Done ->", ASSETS_DIR)

if __name__ == "__main__":
    bpy.app.timers.register(main, first_interval=0.01)
