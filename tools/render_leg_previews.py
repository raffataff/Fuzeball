import bpy, os, sys
from mathutils import Vector
root=os.getcwd(); skin=sys.argv[-1]
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(root,'output','leg-preview-'+skin+'.glb'))
bpy.ops.mesh.primitive_plane_add(size=2000,location=(0,0,-44.1))
floor=bpy.context.object; m=bpy.data.materials.new('studio floor');m.diffuse_color=(.055,.065,.075,1);floor.data.materials.append(m)
target=Vector((0,0,-20));bpy.ops.object.camera_add(location=target+Vector((145,-200,78)))
cam=bpy.context.object;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=165;bpy.context.scene.camera=cam
def area(loc,power,size):
 bpy.ops.object.light_add(type='AREA',location=target+Vector(loc));o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(target-o.location).to_track_quat('-Z','Y').to_euler()
area((0,-100,140),600000,130);area((100,80,100),400000,100);area((-120,-20,50),400000,100);area((0,-120,-10),200000,100)
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=16;s.cycles.use_denoising=True;s.world.color=(.15,.15,.15);s.render.resolution_x=1200;s.render.resolution_y=760;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.render.filepath=os.path.join(root,'output','leg-preview-'+skin+'.png');bpy.ops.render.render(write_still=True)
