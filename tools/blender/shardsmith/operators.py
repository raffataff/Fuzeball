"""Operators."""
import json
import os
import random

import bpy
import numpy as np
from bpy.props import BoolProperty, EnumProperty
from bpy.types import Operator
from mathutils import Vector
from mathutils.kdtree import KDTree

from . import importer, innerds, objects, physics, preview
from .core import engine, meshdata


# ---------------------------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------------------------
def source_object(context):
    ob = context.active_object
    if ob is None:
        return None
    name = ob.get("ss_source")
    if name:
        src = bpy.data.objects.get(name)
        if src is not None:
            return src
    return ob if ob.type == 'MESH' else None


def shards_of(src_obj):
    name = src_obj.get("ss_shards") if src_obj else None
    col = bpy.data.collections.get(name) if name else None
    if col is None:
        return None, []
    return col, sorted((o for o in col.objects if o.type == 'MESH' and o.get("ss_volume") is not None), key=lambda o: o.name)


def object_bounds(ob):
    pts = np.array([list(ob.matrix_world @ Vector(c)) for c in ob.bound_box])
    return pts.min(axis=0), pts.max(axis=0)


def impact_point(context, s, ob):
    lo, hi = object_bounds(ob)
    c = 0.5 * (lo + hi)
    if s.origin_mode == 'BASE':
        return Vector((c[0], c[1], lo[2]))
    if s.origin_mode == 'CURSOR':
        return context.scene.cursor.location.copy()
    if s.origin_mode == 'OBJECT' and s.origin_object is not None:
        return s.origin_object.matrix_world.translation.copy()
    return Vector(c)


def weight_function(ob, group):
    vg = ob.vertex_groups.get(group) if group else None
    if vg is None:
        return None
    me = ob.data
    mw = ob.matrix_world
    kd = KDTree(len(me.vertices))
    w = np.zeros(len(me.vertices))
    for v in me.vertices:
        kd.insert(mw @ v.co, v.index)
        for g in v.groups:
            if g.group == vg.index:
                w[v.index] = g.weight
    kd.balance()

    def fn(P):
        out = np.empty(len(P))
        for i, p in enumerate(P):
            out[i] = w[kd.find(Vector(p.tolist()))[1]]
        return out
    return fn


def custom_points(ob):
    if ob is None:
        return None
    if ob.type == 'MESH':
        mw = ob.matrix_world
        pts = [list(mw @ v.co) for v in ob.data.vertices]
    else:
        pts = [list(ob.matrix_world.translation)] + [list(c.matrix_world.translation) for c in ob.children_recursive]
    return np.array(pts, dtype=np.float64) if len(pts) >= 2 else None


def build_params(context, s, obj, src):
    size = float(np.max(src.bmax - src.bmin))
    c = impact_point(context, s, obj)
    mats = list(src.mats)
    mat = s.interior_material
    slot = mats.index(mat) if (mat is not None and mat in mats) else len(mats)
    return engine.Params(
        pattern=s.pattern, count=s.count, seed=s.seed, regularity=s.regularity, relax=s.relax,
        distribution=s.distribution, surface_ratio=s.surface_ratio,
        impact_center=(c.x, c.y, c.z), impact_radius=s.impact_radius * size, impact_boost=s.impact_boost,
        size_variation=s.size_variation, weight_influence=s.weight_influence if s.weight_group else 0.0,
        axis=s.axis, radial_layers=s.radial_layers, jitter=s.jitter, custom_points=custom_points(s.custom_object),
        interior=s.interior_mode, interior_slot=slot, rough=s.rough, noise_scale=s.noise_scale, detail=s.detail,
        smooth_interior=s.smooth_interior, uv_mode=s.uv_mode, uv_scale=s.uv_scale, uv_point=tuple(s.uv_point),
        cap_color=tuple(s.cap_color), weld=s.weld, fix_normals=s.repair_normals, keep_cavities=s.keep_cavities,
        remove_buried=s.remove_buried, merge_small=s.merge_small, min_size=s.min_size, drop_dust=s.drop_dust,
        dust_size=s.dust_size, split_islands=s.split_islands)


def prepare_source(context, s, obj):
    src = meshdata.extract(context, obj, s.use_modifiers)
    meshdata.prepare(src, weld_rel=s.weld, fix_normals=s.repair_normals, keep_cavities=s.keep_cavities, interior=s.interior_mode)
    return src


def remove_previous(context, obj):
    col, shards = shards_of(obj)
    if col is None:
        return
    physics.clear_physics(context, shards)
    for o in list(col.objects):
        me = o.data if o.type == 'MESH' else None
        bpy.data.objects.remove(o, do_unlink=True)
        if me is not None and me.users == 0:
            bpy.data.meshes.remove(me)
    bpy.data.collections.remove(col)
    obj.pop("ss_shards", None)


def _redraw(context):
    if context.area:
        context.area.tag_redraw()
    for w in context.window_manager.windows:
        for a in w.screen.areas:
            if a.type == 'VIEW_3D':
                a.tag_redraw()


# ---------------------------------------------------------------------------------------------------------
class SHARDSMITH_OT_analyze(Operator):
    bl_idname = "shardsmith.analyze"
    bl_label = "Analyze Mesh"
    bl_description = "Check the active mesh for holes, non-manifold edges, flipped faces and duplicates, and see how it will be treated"

    @classmethod
    def poll(cls, context):
        return source_object(context) is not None

    def execute(self, context):
        s = context.scene.shardsmith
        obj = source_object(context)
        try:
            src = prepare_source(context, s, obj)
        except Exception as e:
            self.report({'ERROR'}, str(e))
            return {'CANCELLED'}
        rep = dict(src.report)
        rep.update(solid=bool(src.solid), volume_fixed=float(src.volume), tris_after=int(src.T), name=obj.name)
        s.report = json.dumps(rep)
        _redraw(context)
        return {'FINISHED'}


class SHARDSMITH_OT_preview(Operator):
    bl_idname = "shardsmith.preview"
    bl_label = "Preview Pattern"
    bl_description = "Show the fracture seeds and the cell walls that cut through the object"

    @classmethod
    def poll(cls, context):
        return source_object(context) is not None

    def execute(self, context):
        s = context.scene.shardsmith
        if preview.active():
            preview.disable()
            s.show_preview = False
            return {'FINISHED'}
        obj = source_object(context)
        try:
            src = prepare_source(context, s, obj)
            p = build_params(context, s, obj, src)
            sites, lines = preview.compute(src, p, weight_function(obj, s.weight_group))
        except Exception as e:
            self.report({'ERROR'}, str(e))
            return {'CANCELLED'}
        preview.set_data(sites, lines)
        preview.enable()
        s.show_preview = True
        self.report({'INFO'}, "%d seeds" % len(sites))
        return {'FINISHED'}


class SHARDSMITH_OT_randomize(Operator):
    bl_idname = "shardsmith.randomize_seed"
    bl_label = "Randomize Seed"
    bl_description = "Roll a new random seed"

    def execute(self, context):
        context.scene.shardsmith.seed = random.randint(0, 999999)
        if preview.active():
            bpy.ops.shardsmith.preview()
            bpy.ops.shardsmith.preview()
        return {'FINISHED'}


class SHARDSMITH_OT_fracture(Operator):
    bl_idname = "shardsmith.fracture"
    bl_label = "Shatter"
    bl_description = "Break the active object into pieces"
    bl_options = {'REGISTER', 'UNDO'}

    explode: BoolProperty(name="Explode", default=False, description="Set up the explosion physics right after fracturing")

    @classmethod
    def poll(cls, context):
        return source_object(context) is not None and not context.scene.shardsmith.busy

    # -- shared setup ---------------------------------------------------------------------------------------
    def _setup(self, context):
        s = context.scene.shardsmith
        self.obj = source_object(context)
        if context.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        self.src = prepare_source(context, s, self.obj)
        self.params = build_params(context, s, self.obj, self.src)
        self.cap_mat = s.interior_material or objects.interior_material()
        return engine.fracture(self.src, self.params, weight_function(self.obj, s.weight_group))

    def execute(self, context):
        try:
            gen = self._setup(context)
            while True:
                try:
                    next(gen)
                except StopIteration as e:
                    res = e.value
                    break
        except Exception as e:
            self.report({'ERROR'}, str(e))
            return {'CANCELLED'}
        return self._finish(context, res)

    def invoke(self, context, event):
        s = context.scene.shardsmith
        try:
            self._gen = self._setup(context)
        except Exception as e:
            self.report({'ERROR'}, str(e))
            return {'CANCELLED'}
        wm = context.window_manager
        self._timer = wm.event_timer_add(0.01, window=context.window)
        wm.progress_begin(0, 1000)
        s.busy = True
        s.progress = 0.0
        s.progress_msg = "Starting"
        wm.modal_handler_add(self)
        return {'RUNNING_MODAL'}

    def modal(self, context, event):
        s = context.scene.shardsmith
        if event.type == 'ESC':
            self._end(context)
            self.report({'WARNING'}, "Shatter cancelled")
            return {'CANCELLED'}
        if event.type != 'TIMER':
            return {'PASS_THROUGH'}
        try:
            frac, msg = next(self._gen)
        except StopIteration as e:
            self._end(context)
            return self._finish(context, e.value)
        except Exception as e:
            self._end(context)
            self.report({'ERROR'}, str(e))
            return {'CANCELLED'}
        s.progress = frac
        s.progress_msg = msg
        context.window_manager.progress_update(int(frac * 1000))
        if context.workspace:
            context.workspace.status_text_set("Shardsmith: %s  (Esc to cancel)" % msg)
        _redraw(context)
        return {'RUNNING_MODAL'}

    def _end(self, context):
        s = context.scene.shardsmith
        wm = context.window_manager
        wm.event_timer_remove(self._timer)
        wm.progress_end()
        if context.workspace:
            context.workspace.status_text_set(None)
        s.busy = False
        _redraw(context)

    def _finish(self, context, res):
        s = context.scene.shardsmith
        if not res.pieces:
            self.report({'ERROR'}, "The fracture produced no pieces")
            return {'CANCELLED'}
        if s.replace_previous:
            remove_previous(context, self.obj)
        objs, col = objects.build_objects(context, self.obj, self.src, res, self.params, cap_material=self.cap_mat)
        self.obj["ss_shards"] = col.name
        if s.hide_source:
            self.obj.hide_set(True)
            self.obj.hide_render = True
        for o in context.view_layer.objects:
            o.select_set(False)
        for o in objs:
            o.select_set(True)
        context.view_layer.objects.active = objs[0]
        cov = res.volume_out / res.volume_in if res.volume_in else 1.0
        msg = "%d pieces in %.1fs" % (len(objs), res.seconds)
        if res.solid and res.volume_in > 0:
            msg += ", volume kept %.2f%%" % (cov * 100.0)
        if not res.solid:
            msg += " (surface only)"
        if res.buried:
            msg += ", %d buried faces removed" % res.buried
        if res.open_pieces:
            msg += ", %d pieces inherit holes from the source mesh" % res.open_pieces
        if res.warnings:
            msg += ", %d cells skipped" % len(res.warnings)
        self.report({'INFO'} if not res.warnings else {'WARNING'}, msg)
        if self.explode:
            info = physics.setup_explosion(context, objs, s, col)
            self.report({'INFO'}, "Explosion ready: last release frame %d, ends frame %d" % (info['last_release'], info['frame_end']))
        _redraw(context)
        return {'FINISHED'}


class _ShardOp(Operator):
    @classmethod
    def poll(cls, context):
        obj = source_object(context)
        return obj is not None and obj.get("ss_shards") is not None and not context.scene.shardsmith.busy

    def shards(self, context):
        obj = source_object(context)
        col, shards = shards_of(obj)
        if not shards:
            self.report({'ERROR'}, "There is no shattered result to work on. Shatter the object first")
        return obj, col, shards


class SHARDSMITH_OT_explode(_ShardOp):
    bl_idname = "shardsmith.explode"
    bl_label = "Set Up Explosion"
    bl_description = "Give the pieces rigid-body physics and launch them from the impact point"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        s = context.scene.shardsmith
        obj, col, shards = self.shards(context)
        if not shards:
            return {'CANCELLED'}
        info = physics.setup_explosion(context, shards, s, col)
        self.report({'INFO'}, "Blast keyed: %d pieces, %.1f-%.1f units/s, last release frame %d, ends frame %d" % (
            len(shards), info['speed_min'], info['speed_max'], info['last_release'], info['frame_end']))
        return {'FINISHED'}


def _bake_report(info):
    """(level, text) for a finished bake."""
    txt = "Baked frames %d-%d" % (info['first'], info['last'])
    if info['extended']:
        txt += " (ran %d frames past the Duration to let the pieces settle)" % info['extended']
    if not info['settled']:
        return {'WARNING'}, txt + ". Some pieces are still moving at the end. Raise Duration or Damping"
    return {'INFO'}, txt


class SHARDSMITH_OT_bake(_ShardOp):
    bl_idname = "shardsmith.bake"
    bl_label = "Bake Animation"
    bl_description = "Bake the simulation into keyframes and remove the rigid bodies"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        s = context.scene.shardsmith
        obj, col, shards = self.shards(context)
        if not shards:
            return {'CANCELLED'}
        state = physics.animation_state(shards)
        if state == 'NONE':
            self.report({'ERROR'}, "Set up the explosion first")
            return {'CANCELLED'}
        if state == 'BAKED':
            self.report({'INFO'}, "Already baked. Set Up Explosion simulates it again")
            return {'CANCELLED'}
        self.report(*_bake_report(physics.bake(context, shards, s)))
        return {'FINISHED'}


class SHARDSMITH_OT_reset_physics(_ShardOp):
    bl_idname = "shardsmith.reset_physics"
    bl_label = "Reset Pieces"
    bl_description = "Remove the physics and animation and put every piece back together"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        obj, col, shards = self.shards(context)
        if not shards:
            return {'CANCELLED'}
        physics.clear_physics(context, shards)
        return {'FINISHED'}


class SHARDSMITH_OT_clear(_ShardOp):
    bl_idname = "shardsmith.clear"
    bl_label = "Delete Result"
    bl_description = "Delete the pieces and show the original object again"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        obj = source_object(context)
        remove_previous(context, obj)
        obj.hide_set(False)
        obj.hide_render = False
        for o in context.view_layer.objects:
            o.select_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj
        return {'FINISHED'}


class SHARDSMITH_OT_select(_ShardOp):
    bl_idname = "shardsmith.select_shards"
    bl_label = "Select Pieces"
    bl_description = "Select every piece of the current result"

    def execute(self, context):
        obj, col, shards = self.shards(context)
        if not shards:
            return {'CANCELLED'}
        for o in context.view_layer.objects:
            o.select_set(False)
        for o in shards:
            o.select_set(True)
        context.view_layer.objects.active = shards[0]
        return {'FINISHED'}


class SHARDSMITH_OT_marker(Operator):
    bl_idname = "shardsmith.impact_marker"
    bl_label = "Add Impact Marker"
    bl_description = "Create an Empty at the impact point that you can move, and use it as the impact point"
    bl_options = {'REGISTER', 'UNDO'}

    @classmethod
    def poll(cls, context):
        return source_object(context) is not None

    def execute(self, context):
        s = context.scene.shardsmith
        obj = source_object(context)
        p = impact_point(context, s, obj)
        lo, hi = object_bounds(obj)
        size = float(np.max(hi - lo))
        e = bpy.data.objects.new("Shardsmith Impact", None)
        e.empty_display_type = 'SPHERE'
        e.empty_display_size = max(s.impact_radius * size, 1e-4)
        e.location = p
        context.scene.collection.objects.link(e)
        s.origin_mode = 'OBJECT'
        s.origin_object = e
        return {'FINISHED'}


class SHARDSMITH_OT_export(_ShardOp):
    bl_idname = "shardsmith.export_glb"
    bl_label = "Export GLB"
    bl_description = ("Export the pieces and their animation as one GLB. Bakes the simulation first if that has not been done "
                      "(and sets up an explosion if there is none), so the file always holds the complete animation")
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        s = context.scene.shardsmith
        obj, col, shards = self.shards(context)
        if not shards:
            return {'CANCELLED'}
        if s.export_path.startswith("//") and not bpy.data.is_saved:
            self.report({'ERROR'}, "Save the .blend first, or choose a full folder path")
            return {'CANCELLED'}
        folder = bpy.path.abspath(s.export_path)
        os.makedirs(folder, exist_ok=True)
        name = s.export_name.strip() or "%s_explosion" % obj.name
        if not name.lower().endswith(".glb"):
            name += ".glb"
        path = os.path.join(folder, name)
        # A GLB written from a scene that is not baked holds only the few keyframes of the launch, so the pieces
        # would stop dead in mid-air in the game; one written from a scene with no explosion holds no animation at all.
        did = []
        state = physics.animation_state(shards)
        if state == 'NONE':
            physics.setup_explosion(context, shards, s, col)
            did.append("set up an explosion with the current settings")
            state = 'SIM'
        if state == 'SIM':
            info = physics.bake(context, shards, s)
            did.append("baked frames %d-%d" % (info['first'], info['last']))
            if not info['settled']:
                self.report({'WARNING'}, "Some pieces are still moving when the animation ends. Raise Duration or Damping")
        try:
            physics.export_glb(context, shards, path)
            rep = physics.glb_report(path)
        except Exception as e:
            self.report({'ERROR'}, "glTF export failed: %s" % e)
            return {'CANCELLED'}
        if rep['clips'] == 0 or rep['seconds'] <= 0.0:
            self.report({'ERROR'}, "The exported file has no animation. Set Up Explosion, then export again")
            return {'CANCELLED'}
        msg = "Exported %s: %d pieces, %.1f s of animation" % (path, len(shards), rep['seconds'])
        if did:
            msg += " (first " + " and ".join(did) + ")"
        if s.export_ktx2:
            try:
                saved = importer.compress_ktx2(path, importer.get_prefs(context))
                msg += ". Textures compressed to KTX2" + (": " + saved if saved else "")
            except RuntimeError as e:
                self.report({'WARNING'}, "Left the textures as PNG: %s" % e)
        self.report({'INFO'}, msg)
        return {'FINISHED'}


class SHARDSMITH_OT_create_innerds(Operator):
    bl_idname = "shardsmith.create_innerds"
    bl_label = "Innerds Material"
    bl_description = ("Make the wet, slightly gory Innerds material in this file, or recolour the one it already has, "
                      "and use it for the inside faces")
    bl_options = {'REGISTER', 'UNDO'}

    species: EnumProperty(name="Species", items=innerds.SPECIES, default='HUMAN',
                          description="Base colour preset. Fine-tune it afterwards in the panel or on the material's Species Colour node")
    size: EnumProperty(name="Texture Size", default='512', items=[('256', "256", ""), ('512', "512", ""), ('1024', "1024", "")],
                       description="Resolution of the generated maps (they are packed into the .blend and exported with the GLB)")

    def execute(self, context):
        s = context.scene.shardsmith
        colour = innerds.COLOURS[self.species]
        mat, created = innerds.ensure(int(self.size), s.seed + 7, colour)
        if not created:
            innerds.set_colour(mat, colour)
        s.interior_material = mat
        self.report({'INFO'}, "%s %s (%s)" % ("Created" if created else "Recoloured", mat.name, self.species.replace('_', ' ').title()))
        return {'FINISHED'}


CLASSES = (SHARDSMITH_OT_analyze, SHARDSMITH_OT_preview, SHARDSMITH_OT_randomize, SHARDSMITH_OT_fracture,
           SHARDSMITH_OT_create_innerds,
           SHARDSMITH_OT_explode, SHARDSMITH_OT_bake, SHARDSMITH_OT_reset_physics, SHARDSMITH_OT_clear,
           SHARDSMITH_OT_select, SHARDSMITH_OT_marker, SHARDSMITH_OT_export)


def register():
    for c in CLASSES:
        bpy.utils.register_class(c)


def unregister():
    preview.clear()
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)
