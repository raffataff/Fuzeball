"""Render the exported table and pitch, rather than the concept scene."""
import bpy, os
from mathutils import Vector
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out=os.path.join(root,'output','solar-forge')
os.makedirs(out,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for file in ('assets/tables/circuit/fuzeball_table_circuit_solar_forge.glb','assets/pitches/pitch_solar_forge.glb'):
    bpy.ops.import_scene.gltf(filepath=os.path.join(root,file))
for o in bpy.context.scene.objects:
    if o.name.startswith(('goal_net','field')): o.hide_render=True
bpy.ops.mesh.primitive_plane_add(size=2000,location=(0,0,-45.9))
floor=bpy.context.object; m=bpy.data.materials.new('studio'); m.diffuse_color=(.015,.022,.027,1); floor.data.materials.append(m)
target=Vector((0,0,-17.4)); bpy.ops.object.camera_add(location=target+Vector((160,-205,155)))
cam=bpy.context.object; cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler(); cam.data.type='ORTHO'; cam.data.ortho_scale=184; bpy.context.scene.camera=cam
def area(loc,power,size,color):
    bpy.ops.object.light_add(type='AREA',location=target+Vector(loc)); o=bpy.context.object; o.data.energy=power; o.data.shape='DISK'; o.data.size=size; o.data.color=color; o.rotation_euler=(target-o.location).to_track_quat('-Z','Y').to_euler()
area((0,-90,155),650000,130,(1,.91,.8)); area((100,80,115),500000,100,(.74,.86,1)); area((-120,-20,70),400000,100,(.85,.92,1))
area((0,-130,-4),260000,115,(1,.83,.65))
s=bpy.context.scene; s.render.engine='CYCLES'; s.cycles.samples=12; s.cycles.use_denoising=True; s.world.color=(.13,.13,.13)
s.render.resolution_x=1500; s.render.resolution_y=1120; s.render.resolution_percentage=100; s.render.image_settings.file_format='PNG'
s.render.filepath=os.path.join(out,'solar-forge-game-asset.png'); bpy.ops.render.render(write_still=True)

