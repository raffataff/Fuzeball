import bpy
o=next(o for o in bpy.context.scene.objects if o.type=='MESH' and o.name.startswith('arena_bowl'))
for i,m in enumerate(o.data.materials):
 verts=[o.data.vertices[o.data.loops[li].vertex_index].co for p in o.data.polygons if p.material_index==i for li in p.loop_indices]
 if verts: print('BOUNDS',m.name,tuple(round(min(v[k] for v in verts),2) for k in range(3)),tuple(round(max(v[k] for v in verts),2) for k in range(3)))
print('UVS',[(l.name,l.active_render) for l in o.data.uv_layers]);print('MATERIALS',[(i,m.name) for i,m in enumerate(o.data.materials)])
for layer in o.data.uv_layers:
 for idx,mat in enumerate(o.data.materials):
  vals=[layer.data[li].uv[:] for p in o.data.polygons if p.material_index==idx for li in p.loop_indices]
  if vals: print('RANGE',layer.name,mat.name, tuple(round(min(v[i] for v in vals),3) for i in (0,1)),tuple(round(max(v[i] for v in vals),3) for i in (0,1)))
