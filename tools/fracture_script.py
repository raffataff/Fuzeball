bl_info = {
    "name": "Shatter & Fall Workflow",
    "author": "AI Assistant",
    "version": (1, 5),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar > Shatter & Fall",
    "description": "Automated shatter workflow with rough interior displacement, explosions, physics, and glTF baking/export",
    "category": "Object",
}

import bpy
import random
import addon_utils
import os
from bpy.props import IntProperty, FloatProperty, PointerProperty, StringProperty
from bpy.types import Panel, Operator, PropertyGroup

# --- Properties ---
class ShatterFallProperties(PropertyGroup):
    shard_count: IntProperty(
        name="Shard Count",
        description="Target number of shattered pieces",
        default=30,
        min=2,
        max=500
    )
    
    inner_roughness: FloatProperty(
        name="Inner Roughness",
        description="Displacement strength on inside shattered faces (creates organic interior patterns)",
        default=0.03,
        min=0.0,
        max=0.5
    )
    
    inner_material: PointerProperty(
        name="Inner Material",
        type=bpy.types.Material,
        description="Material assigned to the inside faces of the shards (leaves stone-grey fallback if empty)"
    )
    
    outward_force: FloatProperty(
        name="Outward Force",
        description="Explosive force pushing pieces outward on the fracture frame",
        default=1000.0,
        min=0.0,
        max=100000.0
    )
    
    start_frame: IntProperty(
        name="Start Frame",
        description="The timeline frame when the object begins to shatter/fall",
        default=20,
        min=1
    )
    
    random_trigger_delay: IntProperty(
        name="Random Delay",
        description="Max random delay (in frames) per piece before it falls (creates a progressive crumbling effect)",
        default=5,
        min=0,
        max=100
    )
    
    floor_z: FloatProperty(
        name="Floor Z Depth",
        description="The exact global height of the top of the ground collision slab",
        default=0.0
    )
    
    bounciness: FloatProperty(
        name="Bounciness",
        description="Elasticity of the shattered pieces and floor during collision",
        default=0.1,
        min=0.0,
        max=1.0
    )
    
    friction: FloatProperty(
        name="Friction",
        description="Resistance of pieces sliding across each other and the floor",
        default=0.6,
        min=0.0,
        max=1.0
    )
    
    # --- New Export Properties ---
    export_path: StringProperty(
        name="Export Folder",
        description="Folder where the exported .glb file will be saved ('//' refers to the .blend folder)",
        default="//",
        subtype='DIR_PATH'
    )
    
    export_filename: StringProperty(
        name="Filename",
        description="Name of the exported .glb file (leaves default if empty)",
        default=""
    )

# --- Helper Functions ---
def set_constant_interpolation(obj, data_path):
    """Forces keyframe interpolation to Constant to ensure instantaneous release on physics triggers."""
    if obj.animation_data and obj.animation_data.action:
        for fcurve in obj.animation_data.action.fcurves:
            if fcurve.data_path == data_path:
                for kp in fcurve.keyframe_points:
                    kp.interpolation = 'CONSTANT'

def link_to_rigidbody_world(context, obj):
    """Ensures an object is explicitly linked to the simulation's collection so it registers collisions."""
    rb_world = context.scene.rigidbody_world
    if not rb_world:
        bpy.ops.rigidbody.world_add()
        rb_world = context.scene.rigidbody_world
    
    rb_col = rb_world.collection
    if not rb_col:
        rb_col = bpy.data.collections.get("RigidBodyWorld")
        if not rb_col:
            rb_col = bpy.data.collections.new("RigidBodyWorld")
            context.scene.collection.children.link(rb_col)
        rb_world.collection = rb_col
        
    if obj.name not in rb_col.objects:
        rb_col.objects.link(obj)

# --- Operator: Shatter & Fall ---
class OBJECT_OT_shatter_and_fall(Operator):
    bl_idname = "object.shatter_and_fall"
    bl_label = "Shatter & Fall!"
    bl_options = {'REGISTER', 'UNDO'}
    
    def execute(self, context):
        props = context.scene.shatter_fall_props
        active_obj = context.active_object
        
        if not active_obj or active_obj.type != 'MESH':
            self.report({'ERROR'}, "Please select a Mesh object to fracture!")
            return {'CANCELLED'}
            
        orig_name = active_obj.name
        orig_location = active_obj.location.copy()
        
        # 1. Attempt to enable the Cell Fracture add-on/extension
        for name in ["object_fracture_cell", "blender_org.cell_fracture"]:
            try:
                addon_utils.enable(name)
            except Exception:
                pass
                
        # 2. Safety Check: Verify if the operator is actually registered and available
        if not hasattr(bpy.ops.object, "add_fracture_cell_objects"):
            self.report(
                {'ERROR'}, 
                "The 'Cell Fracture' extension is not installed! Go to Edit > Preferences > Get Extensions, search 'Cell Fracture', and click Install."
            )
            return {'CANCELLED'}
            
        # 3. Setup Materials (Exterior in Slot 0, Interior in Slot 1)
        target_inner_mat = props.inner_material
        if not target_inner_mat:
            target_inner_mat = bpy.data.materials.get("Shatter_Fallback_Inner")
            if not target_inner_mat:
                target_inner_mat = bpy.data.materials.new("Shatter_Fallback_Inner")
                target_inner_mat.use_nodes = True
                nodes = target_inner_mat.node_tree.nodes
                principled = nodes.get("Principled BSDF")
                if principled:
                    principled.inputs[0].default_value = (0.22, 0.22, 0.22, 1.0) # Grey stone color
        
        if len(active_obj.data.materials) == 0:
            active_obj.data.materials.append(None)
        if len(active_obj.data.materials) < 2:
            active_obj.data.materials.append(target_inner_mat)
        else:
            active_obj.data.materials[1] = target_inner_mat
            
        # 4. Setup Temporary Particles as fracture seed coordinates
        part_mod = active_obj.modifiers.new(name="ShatterTempParticles", type='PARTICLE_SYSTEM')
        psystem = part_mod.particle_system
        psystem.settings.count = props.shard_count
        psystem.settings.frame_start = 1
        psystem.settings.frame_end = 1
        psystem.settings.lifetime = 1
        psystem.settings.emit_from = 'VOLUME'
        psystem.settings.distribution = 'RAND'
        
        context.view_layer.update()
        
        # Create a clean target collection for the shards
        shards_collection = bpy.data.collections.new(name=f"Shattered_{orig_name}")
        context.scene.collection.children.link(shards_collection)
        
        # Record pre-execution object list to identify newly generated shards
        old_objects = set(bpy.data.objects)
        
        # 5. Call native Cell Fracture with material_index=1
        bpy.ops.object.add_fracture_cell_objects(
            source={'PARTICLE_OWN'},
            source_limit=props.shard_count,
            use_interior_vgroup=True,
            use_recenter=True,
            use_remove_original=False,
            margin=0.0,
            use_island_split=True,
            material_index=1
        )
        
        shards = list(set(bpy.data.objects) - old_objects)
        
        # Clean up temporary particle system
        active_obj.modifiers.remove(part_mod)
        
        if not shards:
            self.report({'ERROR'}, "Fracture operation failed. Check if original mesh is manifold/closed.")
            return {'CANCELLED'}
            
        # Hide original mesh
        active_obj.hide_viewport = True
        active_obj.hide_render = True
        
        # Organize shards into dedicated collection
        orig_col = active_obj.users_collection[0] if active_obj.users_collection else context.scene.collection
        for shard in shards:
            if orig_col and shard.name in orig_col.objects:
                orig_col.objects.unlink(shard)
            shards_collection.objects.link(shard)
            
        # 6. Generate Procedural Noise Displacement on Internal Faces
        displace_tex = bpy.data.textures.get("ShatterInnerNoise")
        if not displace_tex:
            displace_tex = bpy.data.textures.new("ShatterInnerNoise", type='CLOUDS')
            displace_tex.noise_scale = 0.12
            displace_tex.noise_depth = 3
            
        if props.inner_roughness > 0.0:
            for shard in shards:
                if "Inside" in shard.vertex_groups:
                    disp_mod = shard.modifiers.new(name="InnerRoughness", type='DISPLACE')
                    disp_mod.texture = displace_tex
                    disp_mod.direction = 'NORMAL'
                    disp_mod.vertex_group = "Inside"
                    disp_mod.strength = props.inner_roughness
                    
        # 7. Physics Setup: Rigid Body World
        if not context.scene.rigidbody_world:
            bpy.ops.rigidbody.world_add()
            
        rb_world = context.scene.rigidbody_world
        
        # Improve simulation accuracy to prevent ground clipping
        rb_world.substeps_per_frame = 20
        rb_world.solver_iterations = 20
        
        # Create solid static floor slab at the defined Z Depth
        floor_name = "Shatter_Floor_Plane"
        floor_obj = bpy.data.objects.get(floor_name)
        if not floor_obj:
            # Create a 1-unit thick box with top face at props.floor_z
            bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, props.floor_z - 0.5))
            floor_obj = context.active_object
            floor_obj.name = floor_name
            # Scale floor out horizontally, keep 1 unit thickness
            floor_obj.scale = (100.0, 100.0, 1.0)
            bpy.ops.object.transform_apply(scale=True, location=False, rotation=False)
            
            bpy.ops.rigidbody.object_add(type='PASSIVE')
            floor_obj.rigid_body.collision_shape = 'BOX'
            floor_obj.rigid_body.friction = props.friction
            floor_obj.rigid_body.restitution = props.bounciness
            
            # Organize floor outside of shards collection
            for col in list(floor_obj.users_collection):
                col.objects.unlink(floor_obj)
            context.scene.collection.objects.link(floor_obj)
        else:
            # Update existing floor location (top surface at props.floor_z)
            floor_obj.location.z = props.floor_z - 0.5
            if floor_obj.rigid_body:
                floor_obj.rigid_body.friction = props.friction
                floor_obj.rigid_body.restitution = props.bounciness
                
        # Link floor to physics simulation collection
        link_to_rigidbody_world(context, floor_obj)
                
        # 8. Setup Active Physics and Keyframed Triggers on Shards
        bpy.ops.object.select_all(action='DESELECT')
        for shard in shards:
            shard.select_set(True)
        context.view_layer.objects.active = shards[0]
        
        bpy.ops.rigidbody.objects_add(type='ACTIVE')
        
        # Estimate mass values using Concrete material density profiles
        try:
            bpy.ops.rigidbody.mass_calculate(material='DEFAULT', density=2.4)
        except Exception:
            pass
            
        for shard in shards:
            rb = shard.rigid_body
            if rb:
                rb.collision_shape = 'CONVEX_HULL'
                rb.collision_margin = 0.0
                rb.friction = props.friction
                rb.restitution = props.bounciness
                
                # Randomized start delay per shard for organic progressive breaking
                delay = random.randint(0, props.random_trigger_delay) if props.random_trigger_delay > 0 else 0
                target_trigger_frame = props.start_frame + delay
                
                # Active rigid bodies with 'kinematic = True' remain frozen in place
                rb.kinematic = True
                shard.keyframe_insert(data_path="rigid_body.kinematic", frame=target_trigger_frame)
                
                # Set 'kinematic = False' to release shard into active gravity simulation
                rb.kinematic = False
                shard.keyframe_insert(data_path="rigid_body.kinematic", frame=target_trigger_frame + 1)
                
                # Clean interpolation curves
                set_constant_interpolation(shard, "rigid_body.kinematic")
                
            # Explicitly link shard to physics simulation collection
            link_to_rigidbody_world(context, shard)
                
        # 9. Create Keyframed Explosion Blast (Force Field)
        if props.outward_force > 0.0:
            bpy.ops.object.effector_add(type='FORCE', location=orig_location)
            force_field = context.active_object
            force_field.name = f"Shatter_Explosion_{orig_name}"
            
            # Constant uniform force distribution across blast radius
            force_field.field.falloff_power = 0.0
            force_field.field.use_max_distance = True
            force_field.field.distance_max = 25.0  # Corrected API attribute
            
            # Keyframe strength spike precisely on trigger frame
            force_field.field.strength = 0.0
            force_field.keyframe_insert(data_path="field.strength", frame=props.start_frame - 1)
            
            force_field.field.strength = props.outward_force
            force_field.keyframe_insert(data_path="field.strength", frame=props.start_frame)
            force_field.field.strength = props.outward_force
            force_field.keyframe_insert(data_path="field.strength", frame=props.start_frame + 1)
            
            # Deactivate field immediately on next frames
            force_field.field.strength = 0.0
            force_field.keyframe_insert(data_path="field.strength", frame=props.start_frame + 2)
            
            # Force constant transition to act as a clean impulse
            set_constant_interpolation(force_field, "field.strength")
            
            # Link force field to the shards collection for easy reset/cleanup
            for col in list(force_field.users_collection):
                col.objects.unlink(force_field)
            shards_collection.objects.link(force_field)
                
        # 10. Reset timeline and clear caching data
        context.scene.frame_set(1)
        if context.scene.rigidbody_world:
            context.scene.rigidbody_world.enabled = False
            context.scene.rigidbody_world.enabled = True
                
        # Return selections back to generated shards
        bpy.ops.object.select_all(action='DESELECT')
        for shard in shards:
            shard.select_set(True)
        context.view_layer.objects.active = shards[0]
        
        self.report({'INFO'}, f"Successfully generated {len(shards)} shards.")
        return {'FINISHED'}

# --- Operator: Reset & Clean Up ---
class OBJECT_OT_shatter_cleanup(Operator):
    bl_idname = "object.shatter_cleanup"
    bl_label = "Reset & Clean Up"
    bl_options = {'REGISTER', 'UNDO'}
    
    def execute(self, context):
        # Restore hidden viewport/render states on mesh objects
        for obj in bpy.data.objects:
            if obj.type == 'MESH':
                if obj.hide_viewport or obj.hide_render:
                    obj.hide_viewport = False
                    obj.hide_render = False
                    
        # Remove floor geometry
        floor_obj = bpy.data.objects.get("Shatter_Floor_Plane")
        if floor_obj:
            bpy.data.objects.remove(floor_obj, do_unlink=True)
            
        # Clean up generated collections and contained geometry (including the force field)
        shattered_cols = [col for col in bpy.data.collections if col.name.startswith("Shattered_")]
        for col in shattered_cols:
            for obj in list(col.objects):
                bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.collections.remove(col)
            
        # Reset physics state
        if context.scene.rigidbody_world:
            bpy.ops.rigidbody.world_remove()
            
        # Reset timeline to frame 1
        context.scene.frame_set(1)
            
        self.report({'INFO'}, "Cleaned up simulation data and restored original objects.")
        return {'FINISHED'}

# --- New Operator: Bake and Export GLB ---
class OBJECT_OT_shatter_bake_export(Operator):
    bl_idname = "object.shatter_bake_export"
    bl_label = "Bake & Export GLB"
    bl_options = {'REGISTER', 'UNDO'}
    
    def execute(self, context):
        props = context.scene.shatter_fall_props
        
        # 1. Validation Checks
        if props.export_path.startswith("//") and not bpy.data.is_saved:
            self.report({'ERROR'}, "Please save your .blend file first to export to folder '//', or choose a custom export folder.")
            return {'CANCELLED'}
            
        shattered_collections = [col for col in bpy.data.collections if col.name.startswith("Shattered_")]
        if not shattered_collections:
            self.report({'ERROR'}, "No Shattered collection found! Please run 'Shatter & Fall!' first.")
            return {'CANCELLED'}
            
        # Target the most recently generated shattered collection
        target_col = shattered_collections[-1]
        
        # 2. Select ONLY the shards (Mesh objects) inside the collection
        bpy.ops.object.select_all(action='DESELECT')
        shards = []
        for obj in target_col.objects:
            if obj.type == 'MESH':
                obj.select_set(True)
                shards.append(obj)
                
        if not shards:
            self.report({'ERROR'}, f"No mesh shards found inside {target_col.name}!")
            return {'CANCELLED'}
            
        context.view_layer.objects.active = shards[0]
        
        # 3. Bake Physics to hard keyframes
        start_f = context.scene.frame_start
        end_f = context.scene.frame_end
        
        self.report({'INFO'}, f"Baking rigid body simulation to keyframes (Frames {start_f} to {end_f})...")
        bpy.ops.rigidbody.bake_to_keyframes(frame_start=start_f, frame_end=end_f, step=1)
        
        # 4. Resolve absolute File Path
        base_dir = bpy.path.abspath(props.export_path)
        if not os.path.isdir(base_dir):
            try:
                os.makedirs(base_dir, exist_ok=True)
            except Exception:
                self.report({'ERROR'}, "Invalid export path! Select a valid folder.")
                return {'CANCELLED'}
                
        # Determine output filename
        name_clean = target_col.name.replace("Shattered_", "")
        file_name = props.export_filename.strip()
        if not file_name:
            file_name = f"{name_clean}_explosion"
            
        if not file_name.lower().endswith(".glb"):
            file_name += ".glb"
            
        export_filepath = os.path.join(base_dir, file_name)
        
        # 5. Export to GLB format
        self.report({'INFO'}, f"Exporting selection to {export_filepath}...")
        
        # Reselect only the baked shards to make absolutely sure floor/force-fields are omitted
        bpy.ops.object.select_all(action='DESELECT')
        for shard in shards:
            shard.select_set(True)
        context.view_layer.objects.active = shards[0]
        
        try:
            bpy.ops.export_scene.gltf(
                filepath=export_filepath,
                export_format='GLB',
                use_selection=True,
                export_animations=True
            )
            self.report({'INFO'}, f"Bake & Export completed successfully! Saved: {file_name}")
        except Exception as e:
            self.report({'ERROR'}, f"glTF Export failed: {str(e)}")
            return {'CANCELLED'}
            
        return {'FINISHED'}

# --- UI Panel ---
class VIEW3D_PT_shatter_fall(Panel):
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'Shatter & Fall'
    bl_label = 'Shatter & Fall Controls'
    
    def draw(self, context):
        layout = self.layout
        scene = context.scene
        props = scene.shatter_fall_props
        
        box = layout.box()
        box.label(text="1. Fracture Style", icon='MOD_EXPLODE')
        box.prop(props, "shard_count")
        box.prop(props, "inner_roughness")
        box.prop(props, "inner_material")
        box.prop(props, "outward_force")
        
        box = layout.box()
        box.label(text="2. Animation & Physics", icon='PHYSICS')
        box.prop(props, "start_frame")
        box.prop(props, "random_trigger_delay")
        box.prop(props, "floor_z")
        box.prop(props, "bounciness")
        box.prop(props, "friction")
        
        box = layout.box()
        box.label(text="3. Web Export (Three.js / GLTF)", icon='EXPORT')
        box.prop(props, "export_path")
        box.prop(props, "export_filename", placeholder="player_explosion")
        box.operator("object.shatter_bake_export", text="Bake & Export GLB", icon='EXPORT')
        
        layout.separator()
        layout.operator("object.shatter_and_fall", text="Shatter & Fall!", icon='PLAY')
        layout.operator("object.shatter_cleanup", text="Reset & Clean Up", icon='TRASH')

# --- Registration ---
classes = (
    ShatterFallProperties,
    OBJECT_OT_shatter_and_fall,
    OBJECT_OT_shatter_cleanup,
    OBJECT_OT_shatter_bake_export,
    VIEW3D_PT_shatter_fall,
)

def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.Scene.shatter_fall_props = PointerProperty(type=ShatterFallProperties)

def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
    del bpy.types.Scene.shatter_fall_props

if __name__ == "__main__":
    register()