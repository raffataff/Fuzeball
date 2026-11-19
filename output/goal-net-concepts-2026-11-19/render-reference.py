import bpy, os
from mathutils import Vector
root=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
out=os.path.dirname(__file__)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(root,'assets/tables/classic/fuzeball_table_classic_championship.glb'))
for ob in bpy.context.scene.objects:
    if ob.name.startswith('goal_net'):ob.hide_render=True
target=Vector((60,0,3))
bpy.ops.object.camera_add(location=(27,-39,37))
cam=bpy.context.object;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type='ORTHO';cam.data.ortho_scale=49;bpy.context.scene.camera=cam
for pos,power,size in [((35,-45,80),210000,60),((90,15,50),150000,45),((15,30,40),100000,45)]:
    bpy.ops.object.light_add(type='AREA',location=pos);ob=bpy.context.object
    ob.data.energy=power;ob.data.shape='DISK';ob.data.size=size
    ob.rotation_euler=(target-ob.location).to_track_quat('-Z','Y').to_euler()
sc=bpy.context.scene;sc.render.engine='CYCLES';sc.cycles.samples=12;sc.cycles.use_denoising=True
sc.world.color=(.18,.18,.18);sc.render.resolution_x=1280;sc.render.resolution_y=1024;sc.render.resolution_percentage=100
sc.render.image_settings.file_format='PNG';sc.render.filepath=os.path.join(out,'table-goal-geometry-reference.png')
bpy.ops.render.render(write_still=True)
