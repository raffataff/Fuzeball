import bpy
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=r'C:\Users\Owner\Documents\Fuzeball\Fuzeball\output\alien-concepts\candidate.glb')
for o in bpy.data.objects:
 if o.type=='MESH' and o.name.startswith('alien_decor'):
  inside=[]
  for v in o.data.vertices:
   p=o.matrix_world @ v.co
   if abs(p.x)<60 and abs(p.y)<34 and -8.5<p.z<11.1: inside.append(tuple(round(a,3) for a in p))
  print('CLEARANCE',o.name,'interior vertices',len(inside),inside[:3])
