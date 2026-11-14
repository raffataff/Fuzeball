import bpy, bmesh, math, sys
from mathutils import Vector
from pathlib import Path
root=Path(r'C:\Users\Owner\Documents\Fuzeball\Fuzeball')
kind=sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
if kind=='saucer':
 bpy.ops.import_scene.gltf(filepath=str(root/'tools/build/saucer/fuzeball_room_saucer.raw.glb'))
 cx=128*math.cos(math.radians(-166)); cy=-128*math.sin(math.radians(-166))
 for o in list(bpy.context.scene.objects):
  if o.type!='MESH' or o.name not in ['room_saucer_brass','room_saucer_dark','room_saucer_steel','room_saucer_mustard']:
   bpy.data.objects.remove(o,do_unlink=True); continue
  bm=bmesh.new(); bm.from_mesh(o.data)
  bmesh.ops.delete(bm,geom=[v for v in bm.verts if (v.co.x-cx)**2+(v.co.y-cy)**2>12.4**2 or v.co.z < -52.1 or v.co.z > 9],context='VERTS')
  seen=set(); remove=[]
  for v in bm.verts:
   if v in seen: continue
   stack=[v]; seen.add(v); component=[]
   while stack:
    q=stack.pop(); component.append(q)
    for edge in q.link_edges:
     n=edge.other_vert(q)
     if n not in seen: seen.add(n); stack.append(n)
   mx=sum(v.co.x for v in component)/len(component); my=sum(v.co.y for v in component)/len(component)
   zspan=max(v.co.z for v in component)-min(v.co.z for v in component)
   if (mx-cx)**2+(my-cy)**2>6**2 and (zspan>4 or -48 < sum(v.co.z for v in component)/len(component) < -32): remove.extend(component)
  if remove: bmesh.ops.delete(bm,geom=remove,context='VERTS')
  bm.to_mesh(o.data); bm.free()
  o.location=(-cx,-cy,52)
else:
 bpy.ops.import_scene.gltf(filepath=str(root/'output/arcade-stool-decoded-tmp.glb'))
objs=[o for o in bpy.context.scene.objects if o.type=='MESH' and len(o.data.vertices)]
bpy.context.view_layer.update()
pts=[o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
lo=Vector(tuple(min(p[i] for p in pts) for i in range(3))); hi=Vector(tuple(max(p[i] for p in pts) for i in range(3)))
print('BOUNDS',kind,lo[:],hi[:])
center=(lo+hi)/2; h=hi.z-lo.z
# Floor
bpy.ops.mesh.primitive_plane_add(size=h*200, location=(center.x,center.y,lo.z-0.05))
floor=bpy.context.object; floor.name='Studio floor'; mat=bpy.data.materials.new('Studio'); mat.diffuse_color=(0.12,0.14,0.17,1); floor.data.materials.append(mat)
world=bpy.context.scene.world or bpy.data.worlds.new('Studio'); bpy.context.scene.world=world; world.color=(0.22,0.22,0.22)
def area(name, offset, power, size):
 bpy.ops.object.light_add(type='AREA', location=center+Vector(offset)*h); o=bpy.context.object; o.name=name; o.data.energy=power*h*h; o.data.shape='DISK'; o.data.size=size*h; o.rotation_euler=(center-o.location).to_track_quat('-Z','Y').to_euler()
area('Key', (2,-3,4), 15, 3); area('Fill', (-3,-1,2), 8, 3); area('Rim', (0,3,3), 20, 2)
bpy.ops.object.camera_add(location=center+Vector((2.7,-4.5,2.15))*h); cam=bpy.context.object; cam.rotation_euler=(center+Vector((0,0,0.03*h))-cam.location).to_track_quat('-Z','Y').to_euler(); cam.data.type='ORTHO'; cam.data.ortho_scale=h*1.45; bpy.context.scene.camera=cam
sc=bpy.context.scene; sc.render.engine='CYCLES'; sc.cycles.samples=48; sc.cycles.use_denoising=True; sc.render.resolution_x=1000; sc.render.resolution_y=1000; sc.render.resolution_percentage=100
sc.view_settings.view_transform='AgX'; sc.render.image_settings.file_format='PNG'; sc.render.filepath=str(root/'output'/('render-'+kind+'-stool.png')); bpy.ops.render.render(write_still=True)


