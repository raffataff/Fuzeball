import bpy,os
from mathutils import Vector
root=os.getcwd();bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(root,'output','leg-preview-strike.glb'))
for o in list(bpy.context.scene.objects):
 if o.name.startswith('field'):bpy.data.objects.remove(o,do_unlink=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(root,'assets/pitches/pitch_strike.glb'))
bpy.ops.mesh.primitive_plane_add(size=2000,location=(0,0,-44.1));floor=bpy.context.object;m=bpy.data.materials.new('floor');m.diffuse_color=(.045,.05,.06,1);floor.data.materials.append(m)
target=Vector((0,0,-8));bpy.ops.object.camera_add(location=target+Vector((145,-185,165)));cam=bpy.context.object;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=166;bpy.context.scene.camera=cam
for loc,power,size in [((0,-100,140),600000,130),((100,80,100),400000,100),((-120,-20,50),400000,100)]:
 bpy.ops.object.light_add(type='AREA',location=target+Vector(loc));o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(target-o.location).to_track_quat('-Z','Y').to_euler()
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=24;s.cycles.use_denoising=True;s.world.color=(.15,.15,.15);s.render.resolution_x=1400;s.render.resolution_y=900;s.render.resolution_percentage=100;s.render.filepath=os.path.join(root,'output','strike-pitch-table.png');bpy.ops.render.render(write_still=True)
