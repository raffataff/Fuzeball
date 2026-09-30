"""Sidebar panels (View3D > N panel > Shardsmith)."""
import json

import bpy
from bpy.types import Panel

from . import innerds, physics, preview
from .operators import shards_of, source_object


def _flat(layout):
    layout.use_property_split = True
    layout.use_property_decorate = False
    return layout


def _report(s, obj):
    if not s.report or obj is None:
        return None
    try:
        r = json.loads(s.report)
    except Exception:
        return None
    return r if r.get("name") == obj.name else None


class _Sub(Panel):
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Shardsmith"
    bl_parent_id = "SHARDSMITH_PT_main"
    bl_options = {'DEFAULT_CLOSED'}


class SHARDSMITH_PT_main(Panel):
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Shardsmith"
    bl_label = "Shardsmith"

    def draw_header(self, context):
        self.layout.label(icon='MOD_EXPLODE')

    def draw(self, context):
        s = context.scene.shardsmith
        obj = source_object(context)
        lay = _flat(self.layout)
        box = lay.box()
        row = box.row()
        if obj is None:
            row.label(text="Select a mesh object", icon='INFO')
            box.operator("shardsmith.import_glb", icon='IMPORT')
        else:
            row.label(text=obj.name, icon='OBJECT_DATA')
            row.operator("shardsmith.analyze", text="", icon='VIEWZOOM')
            r = _report(s, obj)
            if r:
                col = box.column(align=True)
                mode = "Solid" if r["solid"] else "Shell (surface only)"
                col.label(text="%s  -  %d triangles" % (mode, r["tris"]), icon='MESH_DATA')
                bad = []
                if r["boundary_edges"]:
                    bad.append("%d open edges" % r["boundary_edges"])
                if r["nonmanifold_edges"]:
                    bad.append("%d non-manifold edges" % r["nonmanifold_edges"])
                if r["flipped"]:
                    bad.append("%d flipped faces" % r["flipped"])
                if r["duplicate"]:
                    bad.append("%d duplicate faces" % r["duplicate"])
                if r["degenerate"]:
                    bad.append("%d degenerate faces" % r["degenerate"])
                if r["shells"] > 1:
                    bad.append("%d separate shells" % r["shells"])
                if bad:
                    for line in bad:
                        col.label(text=line, icon='ERROR')
                    col.label(text="All handled automatically", icon='CHECKMARK')
                else:
                    col.label(text="Clean, watertight mesh", icon='CHECKMARK')
        if s.busy:
            lay.progress(factor=s.progress, type='BAR', text=s.progress_msg or "Working")
            lay.label(text="Esc to cancel")
            return
        col = lay.column(align=True)
        row = col.row(align=True)
        row.scale_y = 1.7
        op = row.operator("shardsmith.fracture", text="Shatter", icon='MOD_EXPLODE')
        op.explode = False
        op = row.operator("shardsmith.fracture", text="Shatter + Explode", icon='FORCE_FORCE')
        op.explode = True
        if obj is not None and obj.get("ss_shards"):
            _, shards = shards_of(obj)
            if shards:
                row = col.row(align=True)
                row.label(text="%d pieces" % len(shards), icon='OUTLINER_COLLECTION')
                row.operator("shardsmith.select_shards", text="", icon='RESTRICT_SELECT_OFF')
                row.operator("shardsmith.clear", text="", icon='TRASH')


class SHARDSMITH_PT_source(_Sub):
    bl_label = "Source & Repair"

    def draw(self, context):
        s = context.scene.shardsmith
        lay = _flat(self.layout)
        col = lay.column(align=True)
        col.prop(s, "use_modifiers")
        col.prop(s, "repair_normals")
        col.prop(s, "keep_cavities")
        col.prop(s, "remove_buried")
        lay.prop(s, "weld")
        lay.prop(s, "interior_mode")
        lay.operator("shardsmith.analyze", icon='VIEWZOOM')
        lay.operator("shardsmith.import_glb", icon='IMPORT')


class SHARDSMITH_PT_pattern(_Sub):
    bl_label = "Fracture Pattern"

    def draw(self, context):
        s = context.scene.shardsmith
        obj = source_object(context)
        lay = _flat(self.layout)
        lay.prop(s, "preset")
        lay.separator()
        col = lay.column(align=True)
        col.prop(s, "pattern", expand=True)
        lay.separator()
        lay.prop(s, "count")
        row = lay.row(align=True)
        row.prop(s, "seed")
        row.operator("shardsmith.randomize_seed", text="", icon='FILE_REFRESH')
        p = s.pattern
        if p in {'EVEN', 'IMPACT', 'CUSTOM'}:
            lay.prop(s, "regularity")
            lay.prop(s, "relax")
        if p in {'EVEN', 'RANDOM', 'IMPACT'}:
            lay.prop(s, "distribution")
            if s.distribution == 'MIXED':
                lay.prop(s, "surface_ratio")
            lay.prop(s, "size_variation")
        if p in {'IMPACT', 'RADIAL'}:
            box = lay.box()
            box.label(text="Impact", icon='FORCE_FORCE')
            _flat(box)
            box.prop(s, "origin_mode")
            if s.origin_mode == 'OBJECT':
                box.prop(s, "origin_object")
            box.operator("shardsmith.impact_marker", icon='EMPTY_AXIS')
            if p == 'IMPACT':
                box.prop(s, "impact_radius")
                box.prop(s, "impact_boost")
        if p in {'EVEN', 'IMPACT', 'RANDOM'} and obj is not None:
            lay.prop_search(s, "weight_group", obj, "vertex_groups", text="Density Group")
            if s.weight_group:
                lay.prop(s, "weight_influence")
        if p in {'RADIAL', 'SLICE'}:
            lay.prop(s, "axis", expand=True)
        if p == 'RADIAL':
            lay.prop(s, "radial_layers")
        if p in {'RADIAL', 'GRID', 'SLICE'}:
            lay.prop(s, "jitter")
        if p == 'CUSTOM':
            lay.prop(s, "custom_object")
        lay.separator()
        lay.operator("shardsmith.preview", text="Hide Pattern" if preview.active() else "Preview Pattern",
                     icon='HIDE_OFF' if not preview.active() else 'HIDE_ON', depress=preview.active())


class SHARDSMITH_PT_interior(_Sub):
    bl_label = "Inside Faces"

    def draw(self, context):
        s = context.scene.shardsmith
        lay = _flat(self.layout)
        lay.prop(s, "interior_material")
        lay.operator_menu_enum("shardsmith.create_innerds", "species", text="Innerds (gore) by species", icon='MATERIAL')
        ctl = innerds.controls(s.interior_material)
        if ctl:
            box = lay.box()
            box.label(text="Innerds", icon='MATERIAL')
            _flat(box)
            box.prop(ctl['colour'], "default_value", text="Species Colour")
            if 'wet' in ctl:
                box.prop(ctl['wet'], "default_value", text="Wetness")
            if 'bump' in ctl:
                box.prop(ctl['bump'], "default_value", text="Bumpiness")
        lay.separator()
        lay.prop(s, "rough")
        if s.rough > 0:
            lay.prop(s, "noise_scale")
            lay.prop(s, "detail")
        lay.prop(s, "smooth_interior")
        lay.separator()
        lay.prop(s, "uv_mode")
        if s.uv_mode == 'PLANAR':
            lay.prop(s, "uv_scale")
        else:
            lay.prop(s, "uv_point")
        lay.prop(s, "cap_color")


class SHARDSMITH_PT_pieces(_Sub):
    bl_label = "Pieces"

    def draw(self, context):
        s = context.scene.shardsmith
        lay = _flat(self.layout)
        lay.prop(s, "merge_small")
        sub = lay.column()
        sub.active = s.merge_small
        sub.prop(s, "min_size")
        lay.prop(s, "drop_dust")
        sub = lay.column()
        sub.active = s.drop_dust
        sub.prop(s, "dust_size")
        lay.prop(s, "split_islands")
        lay.separator()
        lay.prop(s, "hide_source")
        lay.prop(s, "replace_previous")


class SHARDSMITH_PT_blast(_Sub):
    bl_label = "Explosion"

    def draw(self, context):
        s = context.scene.shardsmith
        lay = _flat(self.layout)
        box = lay.box()
        box.label(text="Blast", icon='FORCE_FORCE')
        _flat(box)
        box.prop(s, "origin_mode")
        if s.origin_mode == 'OBJECT':
            box.prop(s, "origin_object")
        box.prop(s, "blast_speed")
        box.prop(s, "blast_falloff")
        if s.blast_falloff != 'NONE':
            box.prop(s, "blast_radius")
        box.prop(s, "blast_up")
        box.prop(s, "blast_spread")
        box.prop(s, "speed_variation")
        box.prop(s, "spin")
        box.prop(s, "mass_influence")
        box = lay.box()
        box.label(text="Timing", icon='TIME')
        _flat(box)
        box.prop(s, "start_frame")
        box.prop(s, "wave_speed")
        if s.wave_speed > 0:
            box.prop(s, "delay_jitter")
        box.prop(s, "separation")
        box.prop(s, "collision_delay")
        sub = box.column()
        sub.active = s.collision_delay > 0
        sub.prop(s, "guard_pops")
        box.prop(s, "duration")
        lay.separator()
        row = lay.row(align=True)
        row.scale_y = 1.4
        row.operator("shardsmith.explode", icon='PLAY')
        row.operator("shardsmith.reset_physics", icon='LOOP_BACK')


class SHARDSMITH_PT_physics(_Sub):
    bl_label = "Physics"

    def draw(self, context):
        s = context.scene.shardsmith
        lay = _flat(self.layout)
        lay.prop(s, "material")
        lay.prop(s, "real_height")
        lay.prop(s, "friction")
        lay.prop(s, "bounce")
        lay.prop(s, "linear_damping")
        lay.prop(s, "angular_damping")
        lay.prop(s, "collision_shape")
        if s.collision_shape in {'CONVEX_HULL', 'MESH'}:
            lay.prop(s, "collision_margin")
        lay.prop(s, "substeps")
        lay.prop(s, "solver_iters")
        lay.separator()
        lay.prop(s, "add_floor")
        if s.add_floor:
            lay.prop(s, "floor_mode")
            if s.floor_mode == 'MANUAL':
                lay.prop(s, "floor_z")
            lay.prop(s, "floor_friction")


class SHARDSMITH_PT_output(_Sub):
    bl_label = "Bake & Export"

    def draw(self, context):
        s = context.scene.shardsmith
        lay = _flat(self.layout)
        obj = source_object(context)
        shards = shards_of(obj)[1] if obj is not None and obj.get("ss_shards") else []
        state = physics.animation_state(shards) if shards else 'NONE'
        if state == 'BAKED':
            lay.label(text="Animation baked: %d-%d" % (context.scene.frame_start, context.scene.frame_end), icon='CHECKMARK')
        elif state == 'SIM':
            lay.label(text="Simulation not baked yet", icon='INFO')
        elif shards:
            lay.label(text="No explosion yet", icon='INFO')
        lay.prop(s, "bake_step")
        lay.prop(s, "settle")
        lay.operator("shardsmith.bake", icon='REC')
        lay.separator()
        lay.prop(s, "export_path")
        lay.prop(s, "export_name", placeholder="<object>_explosion")
        lay.prop(s, "export_ktx2")
        lay.operator("shardsmith.export_glb", icon='EXPORT')
        if state != 'BAKED' and shards:
            lay.label(text="Export bakes it for you")


CLASSES = (SHARDSMITH_PT_main, SHARDSMITH_PT_source, SHARDSMITH_PT_pattern, SHARDSMITH_PT_interior,
           SHARDSMITH_PT_pieces, SHARDSMITH_PT_blast, SHARDSMITH_PT_physics, SHARDSMITH_PT_output)


def register():
    for c in CLASSES:
        bpy.utils.register_class(c)


def unregister():
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)
