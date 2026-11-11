import bpy, os
from mathutils import Vector
root=os.getcwd(); out=os.path.join(root,'assets','rooms','arcade','art');os.makedirs(out,exist_ok=True)
for name in ['manLeo','alienDrako','womanSasha','mechaman','womanSandy']:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.gltf(filepath=os.path.join(root,'tools','build','arcade',name+'.glb'))
 meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
 pts=[o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
 mn=Vector([min(p[i] for p in pts) for i in range(3)]);mx=Vector([max(p[i] for p in pts) for i in range(3)]);center=(mn+mx)/2; size=max(mx-mn)
 print('FIGURE',name,tuple(mn),tuple(mx),flush=True)
 bpy.ops.object.camera_add(location=center+Vector((size*1.8,-size*3,size*.8)))
 cam=bpy.context.object;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=size*1.4;bpy.context.scene.camera=cam
 for offset,power in [((1,-2,3),900),((-2,-1,1),600),((0,2,2),1000)]:
  bpy.ops.object.light_add(type='AREA',location=center+Vector(offset)*size); l=bpy.context.object;l.data.energy=power*size*size;l.data.shape='DISK';l.data.size=size*2;l.rotation_euler=(center-l.location).to_track_quat('-Z','Y').to_euler()
 s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=24;s.cycles.use_denoising=True;s.render.film_transparent=True;s.render.resolution_x=600;s.render.resolution_y=800;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.render.filepath=os.path.join(out,name+'.png');bpy.ops.render.render(write_still=True)

