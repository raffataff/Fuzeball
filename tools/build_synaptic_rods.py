"""Build Synaptic Relic rod hardware. Run in Blender from the project root."""
import bpy, os, math, tempfile, numpy as np
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'assets','rods','synaptic_relic'); os.makedirs(OUT,exist_ok=True)
tempfile.tempdir=os.path.join(ROOT,'tools','build','synaptic-rod-temp'); os.makedirs(tempfile.tempdir,exist_ok=True)
MAPS=os.path.join(ROOT,'assets','tables','circuit','synaptic_relic','handle'); os.makedirs(MAPS,exist_ok=True)

def save(name,arr,space):
 h,w=arr.shape[:2]; rgba=np.ones((h,w,4),np.float32); rgba[:,:,:3]=np.clip(arr,0,1)
 img=bpy.data.images.new(name,width=w,height=h,alpha=True); img.colorspace_settings.name=space
 img.pixels.foreach_set(rgba.ravel()); img.filepath_raw=os.path.join(MAPS,name+'.png'); img.file_format='PNG'; img.save(); return img

# A square portion of the cabinet artwork preserves the physical proportions
# around the grip. Blend the circumference seam before deriving the PBR maps.
src=bpy.data.images.load(os.path.join(ROOT,'assets','tables','circuit','synaptic_relic','foot_art_v3.png'),check_existing=False)
src.scale(1024,1024); p=np.empty(1024*1024*4,np.float32); src.pixels.foreach_get(p); color=p.reshape(1024,1024,4)[:,:,:3].copy()
for x in range(96):
 t=(1-x/96)*.5; avg=(color[:,x,:]+color[:,-1-x,:])*.5
 color[:,x,:]=color[:,x,:]*(1-2*t)+avg*2*t
 color[:,-1-x,:]=color[:,-1-x,:]*(1-2*t)+avg*2*t
r,g,b=color[:,:,0],color[:,:,1],color[:,:,2]; lum=.2126*r+.7152*g+.0722*b
gold=np.clip((r-b*1.1-.018)*7,0,1)*np.clip((r-g*.8)*8,0,1); hot=np.clip((r-.30)*2,0,1)*np.clip((r-b)*3,0,1)
crystal=np.clip((b-r*.45)*4,0,1)*(1-gold)
rng=np.random.default_rng(212); noise=rng.random(lum.shape,dtype=np.float32); fine=(noise+np.roll(noise,1,0)+np.roll(noise,1,1)) / 3
rough=np.clip(.42+(fine-.5)*.16-crystal*.10-gold*.14,.20,.60); metal=gold*.96
height=lum*.15-gold*.025+(fine-.5)*.07
dy,dx=np.gradient(height); normal=np.stack((-dx*2,-dy*2,np.ones_like(dx)),axis=-1); normal=normal/np.linalg.norm(normal,axis=-1,keepdims=True)*.5+.5
em=np.stack((hot*.75,hot*.23,hot*.018),axis=-1)
images=[save('grip_basecolor',color,'sRGB'),save('grip_roughness',np.repeat(rough[:,:,None],3,2),'Non-Color'),save('grip_metallic',np.repeat(metal[:,:,None],3,2),'Non-Color'),save('grip_normal',normal,'Non-Color'),save('grip_emissive',em,'sRGB')]
def textured():
 mat=bpy.data.materials.new('Relic | amethyst obsidian grip'); mat.use_nodes=True; n=mat.node_tree.nodes; l=mat.node_tree.links; bs=n.get('Principled BSDF')
 def tex(im): node=n.new('ShaderNodeTexImage'); node.image=im; return node
 for im,inp in zip(images[:3],['Base Color','Roughness','Metallic']): l.new(tex(im).outputs['Color'],bs.inputs[inp])
 nm=n.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value=.8; l.new(tex(images[3]).outputs['Color'],nm.inputs['Color']); l.new(nm.outputs['Normal'],bs.inputs['Normal'])
 l.new(tex(images[4]).outputs['Color'],bs.inputs['Emission Color']); bs.inputs['Emission Strength'].default_value=.65
 return mat
def solid(name,color,metal,rough,emit=None):
 m=bpy.data.materials.new(name); m.use_nodes=True; p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1); p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough
 if emit: p.inputs['Emission Color'].default_value=(*emit,1); p.inputs['Emission Strength'].default_value=1
 return m

def grip_mesh(name,y0,y1,material):
 # Lathed grip along the original rod's Blender Y axis. Its continuous UV is
 # (circumference, length); a tapered profile gives a comfortable handhold.
 profile=[(0,1.13),(.035,1.29),(.10,1.37),(.22,1.45),(.5,1.49),(.78,1.45),(.90,1.37),(.965,1.29),(1,1.13)]
 sides=64; verts=[]; faces=[]
 for v,rad in profile:
  for j in range(sides):
   a=2*math.pi*j/sides; verts.append((rad*math.cos(a),y0+(y1-y0)*v,rad*math.sin(a)))
 for k in range(len(profile)-1):
  for j in range(sides): faces.append((k*sides+j,(k+1)*sides+j,(k+1)*sides+(j+1)%sides,k*sides+(j+1)%sides))
 mesh=bpy.data.meshes.new(name); mesh.from_pydata(verts,[],faces); mesh.update(); ob=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(ob); mesh.materials.append(material)
 uv=mesh.uv_layers.new(name='RelicGripUV')
 for poly in mesh.polygons:
  k=poly.index//sides; j=poly.index%sides; vals=[(j/sides,profile[k][0]),(j/sides,profile[k+1][0]),((j+1)/sides,profile[k+1][0]),((j+1)/sides,profile[k][0])]
  for li,coord in zip(poly.loop_indices,vals): uv.data[li].uv=coord
  poly.use_smooth=True
 return ob

def band(name,y,major,minor,mat):
 # Blender torus starts on Z axis; rotate into the rod axis.
 bpy.ops.mesh.primitive_torus_add(major_segments=48,minor_segments=10,location=(0,y,0),major_radius=major,minor_radius=minor,rotation=(math.pi/2,0,0))
 o=bpy.context.object; o.name=name; o.data.materials.append(mat)
 for f in o.data.polygons:f.use_smooth=True

for count in (1,2,3,5):
 bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
 bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets','tables','classic','rods',f'fuzeball_rod_{count}man.glb'))
 old=next(o for o in bpy.context.scene.objects if o.type=='MESH' and 'handle' in o.name.lower())
 pts=[old.matrix_world@Vector(p) for p in old.bound_box]; y0=min(p.y for p in pts); y1=max(p.y for p in pts)
 bpy.data.objects.remove(old,do_unlink=True)
 grip=textured(); brass=solid('Relic | aged gold',(.38,.17,.035),.85,.27); light=solid('Relic | amber inlay',(.42,.14,.015),.45,.25,(.8,.22,.015))
 grip_mesh(f'rod{count}_handle_relic',y0,y1,grip)
 # A small medallion caps the original team-coloured knob. The team surface
 # remains exposed around the rim and keeps the existing colour/boost behaviour.
 knob=next(o for o in bpy.context.scene.objects if o.type=='MESH' and 'knob' in o.name.lower())
 kp=[knob.matrix_world@Vector(p) for p in knob.bound_box]; tip=min(p.y for p in kp)
 obsidian=solid('Relic | endcap obsidian',(.018,.012,.028),.45,.25)
 bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=1.30,depth=.09,location=(0,tip-.035,0),rotation=(math.pi/2,0,0))
 cap=bpy.context.object; cap.name=f'rod{count}_handle_medallion'; cap.data.materials.append(obsidian)
 band(f'rod{count}_handle_tip_bezel',tip-.085,1.24,.055,brass)
 bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,radius=1,location=(0,tip-.09,0))
 gem=bpy.context.object; gem.name=f'rod{count}_handle_amber'; gem.scale=(.30,.09,.30); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); gem.data.materials.append(light)
 for face in gem.data.polygons: face.use_smooth=True
 # Dark satin sleeve covers the broad centre, leaving team colour at its edges.
 bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=1.705,depth=(y0-tip)*.48,location=(0,(tip+y0)*.5,0),rotation=(math.pi/2,0,0))
 sleeve=bpy.context.object; sleeve.name=f'rod{count}_handle_knob_sleeve'; sleeve.data.materials.append(obsidian)
 for face in sleeve.data.polygons: face.use_smooth=(len(face.vertices)==4)
 # Layered bezels around the outer knob retain a narrow team-coloured band.
 # Thin concentric rings and radial studs make the face read as an instrument.
 for i,frac in enumerate((.08,.16,.76,.86,.96)):
  band(f'rod{count}_handle_knob_rim_{i}',tip+(y0-tip)*frac,1.68,.045 if i%2 else .065,brass)
 for i,rad in enumerate((.48,.80,1.02)):
  band(f'rod{count}_handle_cap_engraving_{i}',tip-.087,rad,.018,brass)
 for i in range(8):
  ang=2*math.pi*i/8
  bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=.045,location=(.91*math.cos(ang),tip-.11,.91*math.sin(ang)))
  stud=bpy.context.object; stud.name=f'rod{count}_handle_cap_stud_{i}'; stud.data.materials.append(light)
 # Opposite-end collar: an inset dark cuff, paired gold rims and a luminous
 # seam frame the stock team-glow bumper without replacing its material.
 collar=next(o for o in bpy.context.scene.objects if o.type=='MESH' and 'collar' in o.name.lower())
 cp=[collar.matrix_world@Vector(p) for p in collar.bound_box]; c0=min(p.y for p in cp); c1=max(p.y for p in cp)
 bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=1.105,depth=(c1-c0)*.48,location=(0,(c0+c1)*.5,0),rotation=(math.pi/2,0,0))
 cuff=bpy.context.object; cuff.name=f'rod{count}_collar_relic_cuff'; cuff.data.materials.append(obsidian)
 for face in cuff.data.polygons: face.use_smooth=(len(face.vertices)==4)
 for i,frac in enumerate((.06,.15,.85,.94)):
  band(f'rod{count}_collar_relic_rim_{i}',c0+(c1-c0)*frac,1.10,.055,brass)
 for i,frac in enumerate((.10,.90)):
  band(f'rod{count}_collar_relic_inlay_{i}',c0+(c1-c0)*frac,1.14,.022,light)
 # Faceplate only; the cylindrical team material remains visible from the side.
 bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=1.04,depth=.08,location=(0,c1+.035,0),rotation=(math.pi/2,0,0))
 plate=bpy.context.object; plate.name=f'rod{count}_collar_relic_face'; plate.data.materials.append(obsidian)
 for i,rad in enumerate((.45,.76,.97)):
  band(f'rod{count}_collar_relic_face_ring_{i}',c1+.08,rad,.025,brass)
 bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=1,location=(0,c1+.085,0))
 jewel=bpy.context.object; jewel.name=f'rod{count}_collar_relic_amber'; jewel.scale=(.22,.07,.22); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); jewel.data.materials.append(light)
 for face in jewel.data.polygons: face.use_smooth=True
 for i,t in enumerate((.055,.095,.905,.945)):
  band(f'rod{count}_handle_bezel_{i}',y0+(y1-y0)*t,1.32,.055,brass)
 for i,t in enumerate((.075,.925)):
  band(f'rod{count}_handle_inlay_{i}',y0+(y1-y0)*t,1.335,.025,light)
 out=os.path.join(OUT,f'fuzeball_rod_{count}man.glb'); bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',export_yup=True,export_apply=True)
 print('Wrote',out)
