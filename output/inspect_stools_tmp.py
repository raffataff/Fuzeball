import bpy
bpy.ops.import_scene.gltf(filepath=r'C:\Users\Owner\Documents\Fuzeball\Fuzeball\tools\build\saucer\fuzeball_room_saucer.raw.glb')
for o in bpy.context.scene.objects:
 if o.type=='MESH': print(o.name, len(o.data.polygons), tuple(round(v,1) for v in o.location))
