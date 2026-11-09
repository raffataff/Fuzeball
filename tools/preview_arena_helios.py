import bpy,os
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for o in list(bpy.context.scene.objects):
 if o.type=='MESH' and o.name.startswith(('arena_bowl','goal_frame','goal_net','off_led_ring','table_leg_')):bpy.data.objects.remove(o,do_unlink=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(root,'assets/tables/arena/fuzeball_table_arena_helios.glb'))
s=bpy.context.scene;s.render.resolution_percentage=60;s.render.filepath=os.path.join(root,'output/arena-skins-2026-11-08/helios-preview.png');s.render.image_settings.file_format='PNG';bpy.ops.render.render(write_still=True)
