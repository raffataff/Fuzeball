"""Render both ends of the exported Pro League rod for visual review."""
import bpy, os
from mathutils import Vector
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out=os.path.join(root,'output','strike-rods');os.makedirs(out,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(root,'assets/rods/strike/fuzeball_rod_5man.glb'))
target=Vector((0,-51,0));bpy.ops.object.camera_add(location=target+Vector((10,-10,8)))
cam=bpy.context.object;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=15;bpy.context.scene.camera=cam
lights=[]
for offset,power,size in [((5,-5,13),2600,8),((-7,4,8),1800,7),((4,-12,3),1200,6)]:
 bpy.ops.object.light_add(type='AREA',location=target+Vector(offset));o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(target-o.location).to_track_quat('-Z','Y').to_euler();lights.append(o)
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=24;s.cycles.use_denoising=True;s.world.color=(.04,.04,.04);s.render.resolution_x=1300;s.render.resolution_y=850;s.render.resolution_percentage=100
s.render.image_settings.file_format='PNG';s.render.filepath=os.path.join(out,'handle.png');bpy.ops.render.render(write_still=True)
target2=Vector((0,48,0));shift=target2-target;cam.location=target2+Vector((8,10,8));cam.rotation_euler=(target2-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=7
for o in lights:o.location+=shift;o.rotation_euler=(target2-o.location).to_track_quat('-Z','Y').to_euler()
s.render.filepath=os.path.join(out,'collar.png');bpy.ops.render.render(write_still=True)
target3=Vector((0,-5,0));cam.location=target3+Vector((65,-55,65));cam.rotation_euler=(target3-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=125
for o in lights:o.location+=target3-target2;o.data.energy*=20;o.data.size*=5;o.rotation_euler=(target3-o.location).to_track_quat('-Z','Y').to_euler()
s.render.filepath=os.path.join(out,'rod-wide.png');bpy.ops.render.render(write_still=True)

