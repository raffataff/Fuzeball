bl_info = {
    "name": "Swirl Particles for Web",
    "author": "AI Assistant",
    "version": (1, 2),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar > Swirl Particles",
    "description": "Procedural mathematical swirl particle generator optimized for glTF/WebGL export with advanced timing and vertical spacing controls",
    "category": "Object",
}

import bpy
import bmesh
import math
import random
import os
from bpy.props import IntProperty, FloatProperty, BoolProperty, EnumProperty, StringProperty, PointerProperty
from bpy.types import Panel, Operator, PropertyGroup

# --- Properties ---
class SwirlParticleProperties(PropertyGroup):
    particle_count: IntProperty(
        name="Particle Count",
        description="Total number of particles to generate",
        default=60,
        min=5,
        max=300
    )
    
    max_height: FloatProperty(
        name="Max Height",
        description="The target vertical height of the swirl",
        default=4.0,
        min=0.1
    )
    
    swirl_cycles: FloatProperty(
        name="Swirl Rotations",
        description="How many times the particles rotate as they climb",
        default=2.5,
        min=0.1
    )
    
    radius_start: FloatProperty(
        name="Base Radius (Bottom)",
        description="The helix radius at the bottom start frame",
        default=1.5,
        min=0.0
    )
    
    radius_end: FloatProperty(
        name="Peak Radius (Top)",
        description="The helix radius at the top peak height",
        default=0.5,
        min=0.0
    )
    
    swarm_dispersion: FloatProperty(
        name="Swarm Dispersion",
        description="How scattered/thick the particle stream is relative to the core path",
        default=0.3,
        min=0.0
    )
    
    turbulence: FloatProperty(
        name="Turbulence / Noise",
        description="Adds soft organic fluctuations to the rise path",
        default=0.15,
        min=0.0
    )
    
    floor_z: FloatProperty(
        name="Floor Z Height",
        description="The vertical start level of the particles",
        default=0.0
    )
    
    # Timing and Spacing Dynamics
    start_frame: IntProperty(
        name="Start Frame",
        description="The timeline frame where the first particle spawns",
        default=1,
        min=1
    )
    
    spawn_duration: IntProperty(
        name="Spawn Window (Frames)",
        description="The total timeframe over which all particles are emitted from the base",
        default=120,
        min=1
    )
    
    particle_lifetime: IntProperty(
        name="Particle Flight Duration",
        description="How many frames an individual particle takes to climb to the top",
        default=60,
        min=5
    )
    
    rise_exponent: FloatProperty(
        name="Rise Acceleration (Power)",
        description="1.0 = Constant speed. >1.0 = Starts slow (packed) and accelerates (spreads out). <1.0 = Starts fast, slows near top",
        default=1.0,
        min=0.1,
        max=4.0
    )
    
    # Particle shape properties
    particle_shape: EnumProperty(
        name="Shape",
        items=[
            ('CUBE', 'Cube', 'Box particles'),
            ('UV_SPHERE', 'Sphere', 'Spherical particles'),
            ('CONE', 'Cone', 'Cone particles pointing up')
        ],
        default='CUBE'
    )
    
    particle_scale: FloatProperty(
        name="Particle Size",
        description="The base scale of each particle",
        default=0.1,
        min=0.01,
        max=2.0
    )
    
    # Export properties
    export_folder: StringProperty(
        name="Export Folder",
        description="Where to save the GLB relative to the blend folder ('//' refers to the current .blend folder)",
        default="//assets/animations/",
        subtype='DIR_PATH'
    )
    
    export_filename: StringProperty(
        name="Filename",
        description="Filename of the exported .glb file",
        default="swirl_particles"
    )

# --- Helper Functions ---
def set_action_interpolation_to_linear(obj):
    """Sets all F-Curves for the object to Linear for smooth constant-speed animations."""
    if not (obj.animation_data and obj.animation_data.action):
        return
    action = obj.animation_data.action
    fcurves = []
    
    # Blender 4.4+ and 5.x Slotted Actions API
    if hasattr(action, "layers"):
        try:
            from bpy_extras import anim_utils
            slot = obj.animation_data.action_slot
            if slot:
                channelbag = anim_utils.action_get_channelbag_for_slot(action, slot)
                if channelbag:
                    fcurves = channelbag.fcurves
        except Exception:
            pass
    else:
        # Legacy fallback
        if hasattr(action, "fcurves"):
            fcurves = action.fcurves
            
    for fcurve in fcurves:
        for kp in fcurve.keyframe_points:
            kp.interpolation = 'LINEAR'

def clean_existing_swirl():
    """Removes previously generated Swirl collection, template, and meshes to keep Outliner tidy."""
    col_name = "Swirl_Particles_Collection"
    col = bpy.data.collections.get(col_name)
    if col:
        for obj in list(col.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.collections.remove(col)
        
    template_name = "Swirl_Particle_Template"
    template_obj = bpy.data.objects.get(template_name)
    if template_obj:
        bpy.data.objects.remove(template_obj, do_unlink=True)
        
    for mesh in list(bpy.data.meshes):
        if mesh.name.startswith("Swirl_Particle"):
            bpy.data.meshes.remove(mesh)

# --- Operator: Generate Particles ---
class OBJECT_OT_generate_swirl_particles(Operator):
    bl_idname = "object.generate_swirl_particles"
    bl_label = "Generate Swirl"
    bl_description = "Mathematically bakes instanced swirl particle transforms with standard keyframes"
    bl_options = {'REGISTER', 'UNDO'}
    
    def execute(self, context):
        props = context.scene.swirl_particle_props
        
        # 1. Purge old objects
        clean_existing_swirl()
        
        # 2. Spawn a hidden mesh source to share (instancing)
        shape = props.particle_shape
        if shape == 'CUBE':
            bpy.ops.mesh.primitive_cube_add(size=1.0)
        elif shape == 'CONE':
            bpy.ops.mesh.primitive_cone_add(radius1=0.5, depth=1.0)
        else: # UV_SPHERE
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5)
            
        template_obj = context.active_object
        template_obj.name = "Swirl_Particle_Template"
        template_mesh = template_obj.data
        template_mesh.name = "Swirl_Particle_Mesh"
        
        # Hide template from scene
        template_obj.hide_viewport = True
        template_obj.hide_render = True
        for col in list(template_obj.users_collection):
            col.objects.unlink(template_obj)
            
        # 3. Create Particle Collection
        col_name = "Swirl_Particles_Collection"
        swirl_col = bpy.data.collections.new(col_name)
        context.scene.collection.children.link(swirl_col)
        
        # 4. Apply a basic emission shader for glowing WebGL look
        mat_name = "Swirl_Particle_Material"
        mat = bpy.data.materials.get(mat_name)
        if not mat:
            mat = bpy.data.materials.new(mat_name)
            mat.use_nodes = True
            nodes = mat.node_tree.nodes
            principled = nodes.get("Principled BSDF")
            if principled:
                principled.inputs['Emission Color'].default_value = (0.0, 0.8, 1.0, 1.0)
                principled.inputs['Emission Strength'].default_value = 2.0
                principled.inputs['Base Color'].default_value = (0.0, 0.8, 1.0, 1.0)
        template_mesh.materials.append(mat)
        
        # 5. Build and Animate
        start_frame = props.start_frame
        spawn_duration = props.spawn_duration
        duration = props.particle_lifetime
        count = props.particle_count
        
        # Distribute float-based start times to prevent clamping and clumping
        stagger = spawn_duration / (count - 1) if count > 1 else 1.0
        max_anim_frame = start_frame
        
        for i in range(count):
            # Create an optimized instance object sharing the template mesh data
            p_obj = bpy.data.objects.new(f"Swirl_Particle_{i:03d}", template_mesh)
            swirl_col.objects.link(p_obj)
            
            t_start_float = start_frame + (i * stagger)
            t_end_float = t_start_float + duration
            
            t_start = int(round(t_start_float))
            t_end = int(round(t_end_float))
            
            if t_end > max_anim_frame:
                max_anim_frame = t_end
                
            # Randomize variations per particle
            phase_offset = random.uniform(0.0, 2 * math.pi)
            r_offset = random.uniform(-props.swarm_dispersion, props.swarm_dispersion)
            turb_speed = random.uniform(8.0, 15.0)
            
            # Keyframe static hide states
            p_obj.scale = (0.0, 0.0, 0.0)
            p_obj.keyframe_insert(data_path="scale", frame=t_start - 1)
            p_obj.keyframe_insert(data_path="scale", frame=t_start)
            
            step = 2
            for f in range(t_start, t_end, step):
                # Progress fraction p (0.0 to 1.0) based on float timeline bounds
                p = (f - t_start_float) / duration
                p = max(0.0, min(1.0, p))
                
                # Apply rise acceleration power exponent
                p_height = math.pow(p, props.rise_exponent)
                
                # Spiral angle
                angle = phase_offset + (p * props.swirl_cycles * 2 * math.pi)
                
                # Interpolate the core path radius based on height progression
                core_radius = props.radius_start + p * (props.radius_end - props.radius_start)
                current_radius = max(0.01, core_radius + r_offset)
                
                # Coordinates
                x = current_radius * math.cos(angle) + math.sin(p * turb_speed) * props.turbulence
                y = current_radius * math.sin(angle) + math.cos(p * turb_speed) * props.turbulence
                z = props.floor_z + (p_height * props.max_height)
                
                p_obj.location = (x, y, z)
                p_obj.keyframe_insert(data_path="location", frame=f)
                
                # Scale easing: scale up, hold, scale down
                if p <= 0.15:
                    s_fac = p / 0.15
                elif p >= 0.85:
                    s_fac = (1.0 - p) / 0.15
                else:
                    s_fac = 1.0
                    
                p_scale = props.particle_scale * s_fac
                p_obj.scale = (p_scale, p_scale, p_scale)
                p_obj.keyframe_insert(data_path="scale", frame=f)
                
            # Clean exit framing on exactly t_end
            last_frame = t_end
            p = 1.0
            angle = phase_offset + (p * props.swirl_cycles * 2 * math.pi)
            core_radius = props.radius_end
            current_radius = max(0.01, core_radius + r_offset)
            
            x = current_radius * math.cos(angle) + math.sin(p * turb_speed) * props.turbulence
            y = current_radius * math.sin(angle) + math.cos(p * turb_speed) * props.turbulence
            z = props.floor_z + props.max_height
            
            p_obj.location = (x, y, z)
            p_obj.keyframe_insert(data_path="location", frame=last_frame)
            
            p_obj.scale = (0.0, 0.0, 0.0)
            p_obj.keyframe_insert(data_path="scale", frame=last_frame)
            p_obj.keyframe_insert(data_path="scale", frame=last_frame + 1)
            
            set_action_interpolation_to_linear(p_obj)
            
        # Match Blender viewport timeline playback limits
        context.scene.frame_start = start_frame
        context.scene.frame_end = max_anim_frame + 10
        context.scene.frame_current = start_frame
        
        self.report({'INFO'}, f"Generated {count} swirling particles.")
        return {'FINISHED'}

# --- Operator: Clean Swirl ---
class OBJECT_OT_clean_swirl_particles(Operator):
    bl_idname = "object.clean_swirl_particles"
    bl_label = "Clear Swirl"
    bl_description = "Deletes all generated particles and template structures"
    bl_options = {'REGISTER', 'UNDO'}
    
    def execute(self, context):
        clean_existing_swirl()
        self.report({'INFO'}, "Cleared swirl particle system data.")
        return {'FINISHED'}

# --- Operator: Export to GLB ---
class OBJECT_OT_export_swirl_glb(Operator):
    bl_idname = "object.export_swirl_glb"
    bl_label = "Export to GLB"
    bl_description = "Exports only the generated particles to a web-ready GLB"
    bl_options = {'REGISTER', 'UNDO'}
    
    def execute(self, context):
        props = context.scene.swirl_particle_props
        
        if props.export_folder.startswith("//") and not bpy.data.is_saved:
            self.report({'ERROR'}, "Please save your .blend file first to use relative path '//', or select an absolute path.")
            return {'CANCELLED'}
            
        col_name = "Swirl_Particles_Collection"
        col = bpy.data.collections.get(col_name)
        if not col or not col.objects:
            self.report({'ERROR'}, f"No particles found under collection '{col_name}'! Generate them first.")
            return {'CANCELLED'}
            
        # Isolate Selection to particles
        bpy.ops.object.select_all(action='DESELECT')
        for obj in col.objects:
            obj.select_set(True)
            
        # Handle Output Dir
        base_dir = bpy.path.abspath(props.export_folder)
        if not os.path.isdir(base_dir):
            try:
                os.makedirs(base_dir, exist_ok=True)
            except Exception as e:
                self.report({'ERROR'}, f"Failed to create target directories: {str(e)}")
                return {'CANCELLED'}
                
        filename = props.export_filename.strip()
        if not filename:
            filename = "swirl_particles"
        if not filename.lower().endswith(".glb"):
            filename += ".glb"
            
        filepath = os.path.join(base_dir, filename)
        
        # glTF Exporter Options
        try:
            bpy.ops.export_scene.gltf(
                filepath=filepath,
                export_format='GLB',
                use_selection=True,
                export_animations=True,
                export_current_frame=False,
                export_apply=True
            )
            self.report({'INFO'}, f"WebGL Animation saved: {filename}")
        except Exception as e:
            self.report({'ERROR'}, f"glTF Export failed: {str(e)}")
            return {'CANCELLED'}
            
        return {'FINISHED'}

# --- UI Panel Layout ---
class VIEW3D_PT_swirl_particles(Panel):
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'Swirl Particles'
    bl_label = 'Swirl Particles Setup'
    
    def draw(self, context):
        layout = self.layout
        props = context.scene.swirl_particle_props
        
        box = layout.box()
        box.label(text="1. Particle Style", icon='SURFACE_DATA')
        box.prop(props, "particle_shape")
        box.prop(props, "particle_scale")
        box.prop(props, "particle_count")
        
        box = layout.box()
        box.label(text="2. Swirl Path Behavior", icon='FORCE_VORTEX')
        box.prop(props, "radius_start")
        box.prop(props, "radius_end")
        box.prop(props, "swarm_dispersion")
        box.prop(props, "max_height")
        box.prop(props, "swirl_cycles")
        box.prop(props, "turbulence")
        box.prop(props, "floor_z")
        
        box = layout.box()
        box.label(text="3. Timing & Spacing", icon='TIME')
        box.prop(props, "start_frame")
        box.prop(props, "spawn_duration")
        box.prop(props, "particle_lifetime")
        box.prop(props, "rise_exponent")
        
        box = layout.box()
        box.label(text="4. Web GLB Export", icon='EXPORT')
        box.prop(props, "export_folder")
        box.prop(props, "export_filename")
        box.operator("object.export_swirl_glb", icon='EXPORT')
        
        layout.separator()
        row = layout.row(align=True)
        row.scale_y = 1.3
        row.operator("object.generate_swirl_particles", text="Generate Swirl", icon='PLAY')
        row.operator("object.clean_swirl_particles", text="Clear", icon='TRASH')

# --- Registration ---
classes = (
    SwirlParticleProperties,
    OBJECT_OT_generate_swirl_particles,
    OBJECT_OT_clean_swirl_particles,
    OBJECT_OT_export_swirl_glb,
    VIEW3D_PT_swirl_particles,
)

def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.Scene.swirl_particle_props = PointerProperty(type=SwirlParticleProperties)

def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
    del bpy.types.Scene.swirl_particle_props

if __name__ == "__main__":
    register()