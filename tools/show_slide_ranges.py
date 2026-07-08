"""
show_slide_ranges.py  --  visualise each rod's slide range in the Blender scene.

Run in the Scripting tab (Run Script). It (re)builds a "Slide Ranges" collection
containing, for every rod:

  * rodN_pivot        -- a plain-axes empty at the rod's PIVOT (the rotation/slide
                         axis, at the men's centre = Blender Y 0). Your rod should
                         be centred on this; the slide runs along Blender Y.
  * rodN_coverage     -- a flat wire box on the pitch showing how far the players
                         sweep (outermost man + maxOff each way).
  * rodN_handle_slide+/-  and  rodN_collar_slide+/-
                      -- wireframe ghosts of the handle and collar at the two ends
                         of the slide. If a ghost pokes into a wall, that part is
                         too short / too far in — shrink the slide or push the part
                         further out until the ghost clears the wall at BOTH ends.

It also prints, per rod, the minimum distance the handle's inner face must reach
from the pivot so it never crosses the outer wall (37) at full slide.

Delete or hide the "Slide Ranges" collection when you're done; re-run any time.
Nothing here is exported (the export script only picks up the real rod parts).
"""
import bpy
from mathutils import Vector

W = 68.0            # table width (game)
ROD_MARGIN = 7.0    # CONFIG.rods.margin
GK_SLIDE = 13.0     # CONFIG.rods.gkSlide (goalie cap)
WALL_OUT = 37.0     # outer side-wall face (W/2 + 3)
SPACING = {2: 24.0, 3: 18.5}

def spacing_for(n): return SPACING.get(n, 11.9)

def max_off(n):
    mo = (W - ROD_MARGIN - (n - 1) * spacing_for(n)) / 2.0
    return min(mo, GK_SLIDE) if n == 1 else mo   # 1-man = goalie, capped

def bbox_center(o):
    cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return sum(cs, Vector((0, 0, 0))) / 8.0

def reset_collection(name):
    c = bpy.data.collections.get(name)
    if c:
        for o in list(c.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(c)
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c

def wire_ghost(src, name, dy, col):
    o = bpy.data.objects.new(name, src.data.copy())
    o.matrix_world = src.matrix_world.copy()
    o.location = src.location.copy(); o.location.y += dy   # slide runs along Blender Y
    o.display_type = 'WIRE'; o.hide_select = True
    col.objects.link(o); return o

def add_empty(name, loc, dtype, size, col, scale=(1, 1, 1)):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = dtype; e.empty_display_size = size
    e.location = loc; e.scale = scale; e.hide_select = True
    col.objects.link(e); return e

def main():
    ranges = reset_collection("Slide Ranges")
    for n in (1, 2, 3, 5):
        mo = max_off(n)
        outer = (n - 1) / 2.0 * spacing_for(n)      # outermost man's rest offset
        reach = outer + mo                          # furthest a player reaches from centre
        print("rod%d: maxOff=%.1f  ->  handle inner face must reach >= %.1f from pivot (else it clips the wall)"
              % (n, mo, WALL_OUT + mo))
        for suf in ("", ".001"):
            get = lambda part: bpy.data.objects.get("rod%d_%s%s" % (n, part, suf))
            bar = get("bar")
            if not bar:
                continue
            piv = bbox_center(bar); piv.y = 0.0     # pivot: bar axis at the men centre
            add_empty("rod%d_pivot%s" % (n, suf), (piv.x, 0.0, piv.z), 'PLAIN_AXES', 6, ranges)
            add_empty("rod%d_coverage%s" % (n, suf), (piv.x, 0.0, 0.3), 'CUBE', 1,
                      ranges, scale=(1.5, reach, 0.2))
            for part in ("handle", "collar"):
                src = get(part)
                if not src:
                    continue
                wire_ghost(src, "rod%d_%s_slide+%s" % (n, part, suf),  mo, ranges)
                wire_ghost(src, "rod%d_%s_slide-%s" % (n, part, suf), -mo, ranges)
    print("Slide Ranges built. Hide/delete the 'Slide Ranges' collection when done.")

main()
