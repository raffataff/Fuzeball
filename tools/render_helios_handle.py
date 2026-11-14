import bpy,os
from mathutils import Vector
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(root,'assets/rods/helios_runners/fuzeball_rod_1man.glb'))
g=next(o for o in bpy.context.scene.objects if o.type=='MESH' and 'handle_helios_grip' in o.name); pts=[g.matrix_world@Vector(p) for p in g.bound_box];target=sum(pts,Vector())/8
bpy.ops.object.camera_add(location=target+Vector((12,-12,10)));cam=bpy.context.object;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=10;bpy.context.scene.camera=cam
for loc,power,size in [((4,-4,8),1800,7),((-6,-2,4),1200,6),((0,8,5),1500,5)]:
 bpy.ops.object.light_add(type='AREA',location=target+Vector(loc));o=bpy.context.object;o.data.energy=power;o.data.size=size;o.rotation_euler=(target-o.location).to_track_quat('-Z','Y').to_euler()
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=32;s.cycles.use_denoising=True;s.world.color=(.12,.12,.12);s.render.resolution_x=1100;s.render.resolution_y=700;s.render.resolution_percentage=100;s.render.filepath=os.path.join(root,'output/helios-handle-preview.png');bpy.ops.render.render(write_still=True)
