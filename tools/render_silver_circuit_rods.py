import bpy,os
from mathutils import Vector
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.makedirs(os.path.join(root,'output','silver-circuit-rods'),exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(root,'assets/rods/silver_circuit/fuzeball_rod_5man.glb'))
target=Vector((0,-50,0)); bpy.ops.object.camera_add(location=target+Vector((13,-12,11)))
cam=bpy.context.object; cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler(); cam.data.type='ORTHO';cam.data.ortho_scale=14;bpy.context.scene.camera=cam
for loc,energy,size,color in [((5,-48,14),2500,9,(1,1,1)),((-7,-52,8),1800,8,(.70,.82,1)),((4,-62,3),1100,7,(1,.9,.75))]:
 bpy.ops.object.light_add(type='AREA',location=loc); o=bpy.context.object; o.data.energy=energy;o.data.shape='DISK';o.data.size=size;o.data.color=color;o.rotation_euler=(target-o.location).to_track_quat('-Z','Y').to_euler()
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=32;s.cycles.use_denoising=True;s.world.color=(.05,.05,.05);s.render.resolution_x=1300;s.render.resolution_y=850;s.render.resolution_percentage=100
s.render.image_settings.file_format='PNG';s.render.filepath=os.path.join(root,'output','silver-circuit-rods','handle-preview.png');bpy.ops.render.render(write_still=True)
target2=Vector((0,48,0)); delta=target2-target
cam.location+=delta;cam.rotation_euler=(target2-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=7
for o in s.objects:
 if o.type=='LIGHT':o.location+=delta
s.render.filepath=os.path.join(root,'output','silver-circuit-rods','collar-preview.png');bpy.ops.render.render(write_still=True)
