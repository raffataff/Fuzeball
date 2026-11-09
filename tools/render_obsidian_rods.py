"""Render the exported Obsidian Volt rod hardware for inspection."""
import bpy, os
from mathutils import Vector

root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out=os.path.join(root,'output','imagegen','obsidian-volt-rods'); os.makedirs(out,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(root,'assets','rods','obsidian_volt','fuzeball_rod_5man.glb'))
target=Vector((0,-51,0)); bpy.ops.object.camera_add(location=target+Vector((10,-11,9)))
camera=bpy.context.object; camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO'; camera.data.ortho_scale=15; bpy.context.scene.camera=camera
lights=[]
for offset,power,size,color in [((5,-5,13),2600,8,(.8,.92,1)),((-7,4,8),1800,7,(.45,.75,1)),((4,-12,3),1200,6,(.5,1,1))]:
    bpy.ops.object.light_add(type='AREA',location=target+Vector(offset)); light=bpy.context.object
    light.data.energy=power; light.data.shape='DISK'; light.data.size=size; light.data.color=color
    light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler(); lights.append(light)
scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=24; scene.cycles.use_denoising=True
scene.world.color=(.04,.04,.04); scene.render.resolution_x=1300; scene.render.resolution_y=900; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.filepath=os.path.join(out,'handle.png'); bpy.ops.render.render(write_still=True)
target2=Vector((0,48,0)); shift=target2-target
camera.location=target2+Vector((8,10,8)); camera.rotation_euler=(target2-camera.location).to_track_quat('-Z','Y').to_euler(); camera.data.ortho_scale=8
for light in lights:
    light.location+=shift; light.rotation_euler=(target2-light.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=os.path.join(out,'collar.png'); bpy.ops.render.render(write_still=True)
