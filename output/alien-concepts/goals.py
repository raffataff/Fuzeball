import bpy
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=r'C:\Users\Owner\Documents\Fuzeball\Fuzeball\output\alien-concepts\full.glb')
for o in bpy.data.objects:
 if o.type=='MESH' and o.name.startswith('goal_frame'):
  vs=[o.matrix_world @ v.co for v in o.data.vertices]; print('GOAL',o.name,[(round(min(v[i] for v in vs),2),round(max(v[i] for v in vs),2)) for i in range(3)])
