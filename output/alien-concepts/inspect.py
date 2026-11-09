import bpy
bpy.ops.import_scene.gltf(filepath=r'C:\Users\Owner\Documents\Fuzeball\Fuzeball\output\alien-concepts\reference.glb')
for o in bpy.data.objects:
 if o.type=='MESH':
  print('MESH',o.name,'dims',tuple(round(x,2) for x in o.dimensions),'pos',tuple(round(x,2) for x in o.location),'mats',[m.name for m in o.data.materials], 'polys',len(o.data.polygons))
