import bpy, bmesh
from mathutils import Vector
o=next(o for o in bpy.context.scene.objects if o.type=='MESH' and o.name.startswith('table_leg_'))
b=bmesh.new(); b.from_mesh(o.data); seen=set(); groups=[]
for v in b.verts:
 if v.index in seen: continue
 stack=[v]; seen.add(v.index); vs=[]
 while stack:
  a=stack.pop();vs.append(a)
  for e in a.link_edges:
   w=e.other_vert(a)
   if w.index not in seen: seen.add(w.index);stack.append(w)
 if len(vs)>3:
  lo=[min(v.co[i] for v in vs) for i in range(3)]; hi=[max(v.co[i] for v in vs) for i in range(3)]
  groups.append((len(vs),tuple(round(x,2) for x in lo),tuple(round(x,2) for x in hi)))
print('STAND',o.name,tuple(o.location),tuple(o.scale),[(m.name if m else None) for m in o.data.materials]);print('PARTS',groups)
for p in o.data.polygons:
 if abs(p.center.x)<1 and abs(p.center.y)>20 and p.center.z < -20:
  print('MID',tuple(round(v,2) for v in p.center),tuple(round(v,2) for v in p.normal),p.material_index)
 pts=[o.data.vertices[i].co for i in p.vertices]
 if max(v.x for v in pts)-min(v.x for v in pts)>30:
  print('BEAM',tuple(round(v,2) for v in p.center),tuple(round(v,2) for v in p.normal),p.material_index)
