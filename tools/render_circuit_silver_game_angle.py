"""Render the exported Silver Circuit table and matching pitch for review."""
import bpy
import os
from mathutils import Vector

root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out=os.path.join(root,'output','imagegen','silver-circuit')
os.makedirs(out,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(root,'assets','tables','circuit','fuzeball_table_circuit_silver.glb'))
for ob in bpy.context.scene.objects:
    if ob.name.startswith(('field','goal_net')): ob.hide_render=True
bpy.ops.import_scene.gltf(filepath=os.path.join(root,'assets','pitches','pitch_silver_circuit.glb'))

bpy.ops.mesh.primitive_plane_add(size=1000,location=(0,0,-42.9))
floor=bpy.context.object; floor.name='preview studio floor'
mat=bpy.data.materials.new('preview dark floor'); mat.use_nodes=True
bs=mat.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(0.016,0.023,0.031,1); bs.inputs['Roughness'].default_value=.36; bs.inputs['Metallic'].default_value=.25
floor.data.materials.append(mat)

target=Vector((0,-2,0)); bpy.ops.object.camera_add(location=(0,-86,92))
camera=bpy.context.object; camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='PERSP'; camera.data.sensor_fit='VERTICAL'; camera.data.angle_y=0.9599310886; bpy.context.scene.camera=camera
def area(location,power,size,color=(1,1,1)):
    bpy.ops.object.light_add(type='AREA',location=location); light=bpy.context.object
    light.data.energy=power; light.data.shape='DISK'; light.data.size=size; light.data.color=color
    light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
area((0,-95,185),650000,150,(0.78,0.88,1))
area((120,100,145),450000,110,(0.72,0.86,1))
area((-110,40,100),400000,95,(0.6,0.85,1))
area((20,-100,0),95000,90,(0.15,0.75,1))
scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=24; scene.cycles.use_denoising=True
scene.world.color=(0.055,0.055,0.055)
scene.render.resolution_x=1600; scene.render.resolution_y=1100; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.filepath=os.path.join(out,'game-angle-preview.png')
bpy.ops.render.render(write_still=True)
