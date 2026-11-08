"""Build the Silver Circuit skin from the shipped Circuit GLB.

Run from the project root with Blender: blender -b --factory-startup -P tools/build_circuit_silver.py
The source GLB is read-only; maps and the new GLB are written alongside it.
"""
import bpy
import os
import tempfile
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'tables', 'circuit', 'silver_circuit')
os.makedirs(OUT, exist_ok=True)
tempfile.tempdir = os.path.join(ROOT, 'tools', 'build', 'silver-circuit-temp')
os.makedirs(tempfile.tempdir, exist_ok=True)
def save_image(name, rgb, colorspace):
    h,w=rgb.shape[:2]
    rgba = np.ones((h,w,4),dtype=np.float32); rgba[:,:,:3] = rgb
    img = bpy.data.images.new(name, width=w, height=h, alpha=True)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(rgba.ravel()); img.filepath_raw = os.path.join(OUT,name+'.png')
    img.file_format='PNG'; img.save()
    return img

# Composed angular engravings with dedicated PBR maps.
def maps(name,base,ink,metal,rough):
 h,w=512,2048
 y,x=np.mgrid[0:h,0:w]; u=x/(w-1); v=y/(h-1); mask=np.zeros((h,w),dtype=np.float32)
 def segment(x1,y1,x2,y2):
  nonlocal mask
  dx=x2-x1; dy=y2-y1; t=np.clip(((u-x1)*dx+(v-y1)*dy)/(dx*dx+dy*dy),0,1)
  d=np.sqrt(((u-x1-t*dx)*2.8)**2+(v-y1-t*dy)**2); mask=np.maximum(mask,np.clip((.004-d)/.002,0,1))
 if name == 'panel':
  # Projected from the reference's long white fascia: the left kink, central
  # descending step, long run and upward return are each composed once.
  for off in (0,.086,.172):
   points=[(.016,.790-off),(.057,.823-off),(.114,.526-off),(.329,.532-off),
           (.377,.567-off),(.453,.190-off),(.892,.188-off),(.944,.515-off)]
   for a,b in zip(points,points[1:]): segment(*a,*b)
 elif name=='end_panel':
  # Short goal ends have their own small angular tracery, not a compressed
  # copy of the long fascia.
  for off in (0,.025,.05):
   for a,b in [((.02,.32+off),(.18,.58+off)),((.18,.58+off),(.31,.58+off)),
               ((.69,.18+off),(.82,.72+off)),((.82,.72+off),(.98,.88+off))]: segment(*a,*b)
 elif name=='under':
  # Balanced, mirrored three-line routes terminate just short of the center.
  for flip in (False,True):
   def point(p): return (p[0],1-p[1]) if flip else p
   for mirror in (False,True):
    def mirrored(p): return point((1-p[0],p[1]) if mirror else p)
    for off in (0,.012,.024):
     points=[(.105,.060+off),(.205,.125+off),(.380,.120+off),(.460,.145+off)]
     for a,b in zip(points,points[1:]): segment(*mirrored(a),*mirrored(b))
     tx,ty=mirrored(points[-1]); d=np.sqrt(((u-tx)*2.8)**2+(v-ty)**2)
     mask=np.maximum(mask,np.clip((.006-d)/.002,0,1))
 elif name=='foot':
  # A deliberate inlaid double-chevron: two nested paths and a central rail.
  # The diagonal tracks cross the pale surround and dark insert as one design.
  for off in (0,.022,.044):
   points=[(.075,.205+off),(.300,.290+off),(.605,.390+off),(.865,.390+off)]
   for a,b in zip(points,points[1:]): segment(*a,*b)
   d=np.sqrt(((u-.865)*2.8)**2+(v-(.390+off))**2)
   mask=np.maximum(mask,np.clip((.006-d)/.002,0,1))
  for a,b in [((.34,.27),(.50,.205)),((.50,.205),(.66,.27)),
              ((.66,.27),(.50,.335)),((.50,.335),(.34,.27))]: segment(*a,*b)
 elif name=='inside':
  # Low, restrained bands sit below the rod collars on the inner long walls.
  for off in (0,.035,.070):
   points=[(.06,.23+off),(.30,.23+off),(.34,.13+off),(.66,.13+off),(.70,.23+off),(.94,.23+off)]
   for a,b in zip(points,points[1:]): segment(*a,*b)
 elif name=='end_inside':
  # Mirror the same ordered bracket around each side of the goal aperture.
  for mirror in (False,True):
   def point(p): return (1-p[0],p[1]) if mirror else p
   for off in (0,.045,.090):
    points=[(.035,.17+off),(.105,.17+off),(.235,.67+off),(.315,.67+off)]
    for a,b in zip(points,points[1:]): segment(*point(a),*point(b))
 rng=np.random.default_rng(12); grain=rng.random((h,w),dtype=np.float32); color=np.empty((h,w,3),dtype=np.float32)
 streak=np.repeat(rng.random((h,1),dtype=np.float32),w,axis=1)
 for c in range(3):
  shade=(.95+.10*streak+.012*grain) if name=='rail' else (.985+.03*grain)
  color[:,:,c]=np.clip(base[c]*shade*(1-mask)+ink[c]*mask,0,1)
 if name=='foot':
  # A white painted surround, with a dark tapered inset on the outward end face.
  inset=(v>.15)&(v<.70)&(u>(.12+.21*v))&(u<(.88-.13*v))
  for c in range(3):
   surround=(.72,.76,.79)[c]*(.985+.03*grain)*(1-mask)+(.30,.35,.38)[c]*mask
   color[:,:,c]=np.where(inset,color[:,:,c],surround)
 scalar=lambda value: np.repeat(np.full((h,w,1),value,dtype=np.float32),3,axis=2)
 normal=np.empty((h,w,3),dtype=np.float32); normal[:]=(.5,.5,1)
 rough_map=scalar(rough)
 metal_map=scalar(metal)
 if name in ('panel','end_panel','foot','under','inside','end_inside'):
  # Very shallow engraved strokes: the linework changes the surface response
  # as well as its color, without looking like raised neon strips.
  dy,dx=np.gradient(mask)
  normal[:,:,0]=np.clip(.5-dx*.10,.4,.6)
  normal[:,:,1]=np.clip(.5-dy*.10,.4,.6)
  rough_map[:]=np.repeat(np.clip(rough+.08*mask,0,1)[:,:,None],3,axis=2)
 if name=='foot':
  rough_map[:]=np.repeat(np.where(inset,.34,.41)[:,:,None],3,axis=2)
  metal_map[:]=np.repeat(np.where(inset,.35,.12)[:,:,None],3,axis=2)
 if name=='rail':
  normal[:,:,1]=np.clip(.5+np.gradient(streak,axis=0)*.08,.42,.58)
  rough_map[:]=np.repeat((rough+.045*(streak-.5))[:,:,None],3,axis=2)
 return (save_image(name+'_basecolor',color,'sRGB'),save_image(name+'_roughness',rough_map,'Non-Color'),save_image(name+'_metallic',metal_map,'Non-Color'),save_image(name+'_normal',normal,'Non-Color'))
panel_maps=maps('panel',(.82,.84,.86),(.25,.31,.35),.12,.34)
end_panel_maps=maps('end_panel',(.82,.84,.86),(.25,.31,.35),.12,.34)
foot_maps=maps('foot',(.09,.15,.21),(.78,.81,.84),.2,.34)
under_maps=maps('under',(.10,.17,.24),(.78,.81,.84),.15,.35)
inside_maps=maps('inside',(.025,.047,.07),(.38,.46,.50),.3,.35)
end_inside_maps=maps('end_inside',(.025,.047,.07),(.52,.62,.69),.3,.35)
rail_maps=maps('rail',(.72,.74,.76),(.48,.52,.55),.9,.27)

bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets','tables','circuit','fuzeball_table_circuit.glb'))

def textured_material(name, maps):
    albedo,rough_img,metal_img,normal_img=maps
    mat=bpy.data.materials.new(name); mat.use_nodes=True
    nodes=mat.node_tree.nodes; links=mat.node_tree.links
    bs=nodes.get('Principled BSDF')
    def tex(img,label):
        n=nodes.new('ShaderNodeTexImage'); n.image=img; n.label=label; n.interpolation='Linear'; return n
    links.new(tex(albedo,'Base color').outputs['Color'],bs.inputs['Base Color'])
    links.new(tex(rough_img,'Roughness').outputs['Color'],bs.inputs['Roughness'])
    links.new(tex(metal_img,'Metallic').outputs['Color'],bs.inputs['Metallic'])
    nm=nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value=0.55
    links.new(tex(normal_img,'Normal').outputs['Color'],nm.inputs['Color']); links.new(nm.outputs['Normal'],bs.inputs['Normal'])
    return mat

def solid(name,color,metal,rough,emission=None):
    m=bpy.data.materials.new(name); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough
    if emission:
        p.inputs['Emission Color'].default_value=(*emission,1); p.inputs['Emission Strength'].default_value=3
    return m

side_panel=textured_material('Silver Circuit | composed side panel',panel_maps)
end_panel=textured_material('Silver Circuit | goal end panel',end_panel_maps)
foot_panel=textured_material('Silver Circuit | stand end panel',foot_maps)
under_panel=textured_material('Silver Circuit | navy underbody',under_maps)
frame=solid('Silver Circuit | cyan goal frame',(0.025,0.20,0.23),0.5,0.26,(0.025,0.65,0.78))
metalmat=solid('Silver Circuit | rod collars',(0.16,0.22,0.25),0.85,0.26)
railmat=textured_material('Silver Circuit | brushed silver rail',rail_maps)
pedestal=solid('Silver Circuit | silver stand',(0.54,0.59,0.62),0.72,0.29)
goal_floor=solid('Silver Circuit | dark goal cavity',(.012,.025,.04),.85,.75)
inner=textured_material('Silver Circuit | inner wall circuitry',inside_maps)
end_inner=textured_material('Silver Circuit | goal wall engraving',end_inside_maps)

for ob in list(bpy.context.scene.objects):
    if ob.type!='MESH': continue
    if ob.name.startswith('table_base'):
        for i in range(len(ob.data.materials)): ob.data.materials[i]=pedestal
        ob.data.materials.append(foot_panel); foot_index=len(ob.data.materials)-1
        ob.data.materials.append(under_panel); under_index=len(ob.data.materials)-1
        ob.data.materials.append(goal_floor); goal_floor_index=len(ob.data.materials)-1
        uv=ob.data.uv_layers.active or ob.data.uv_layers.new(name='UVMap')
        for poly in ob.data.polygons:
            pts=[ob.matrix_world @ ob.data.vertices[ob.data.loops[li].vertex_index].co for li in poly.loop_indices]
            center=sum(pts,Vector())/len(pts)
            if center.z > -0.8 and abs(center.x)>58 and poly.normal.z>.9:
                # The stock stand's upper cap extends through the goal mouth.
                # Its silver finish reads as a bright bar inside the dark goal.
                poly.material_index=goal_floor_index
            elif center.z < -12 and abs(center.x)>39 and abs(poly.normal.x)>.6 and center.x*poly.normal.x>0:
                poly.material_index=foot_index
            elif center.z < -2 and abs(center.x)<59 and poly.normal.z>.75:
                poly.material_index=under_index
            for li,p in zip(poly.loop_indices,pts):
                uv.data[li].uv=((p.x+65)/130,(p.y+35)/70) if poly.material_index==under_index else ((p.y+28)/56,(p.z+43)/33)
    elif ob.name.startswith(('wall_','goal_frame_header')):
        uv=ob.data.uv_layers.active or ob.data.uv_layers.new(name='UVMap')
        for poly in ob.data.polygons:
            n=poly.normal; axis=max(range(3),key=lambda i:abs(n[i]))
            top=n.z>0.8 and all((ob.matrix_world @ ob.data.vertices[ob.data.loops[li].vertex_index].co).z > 15.45 for li in poly.loop_indices)
            for li in poly.loop_indices:
                p=ob.matrix_world @ ob.data.vertices[ob.data.loops[li].vertex_index].co
                if top and ob.name.startswith('wall_side'):
                    uv.data[li].uv=((p.x+68.5)/137,(abs(p.y)-34)/3)
                elif top:
                    uv.data[li].uv=((p.y+34)/68,(abs(p.x)-60)/8.5)
                elif ob.name.startswith('wall_side'):
                    uv.data[li].uv=((p.x+68.5)/137,(p.z+0.6)/16.2)
                else:
                    uv.data[li].uv=((p.y+34)/68,(p.z+0.6)/16.2)
        for i in range(len(ob.data.materials)): ob.data.materials[i]=inner
        ob.data.materials.append(railmat); rail_index=len(ob.data.materials)-1
        ob.data.materials.append(side_panel); panel_index=len(ob.data.materials)-1
        ob.data.materials.append(end_inner); end_inner_index=len(ob.data.materials)-1
        ob.data.materials.append(end_panel); end_panel_index=len(ob.data.materials)-1
        for poly in ob.data.polygons:
            verts=[ob.matrix_world @ ob.data.vertices[ob.data.loops[li].vertex_index].co for li in poly.loop_indices]
            if ob.name.startswith('wall_side') and (abs(poly.normal.x)>.7 or sum(abs(p.y) for p in verts)/len(verts)>35.5):
                poly.material_index=panel_index
            elif not ob.name.startswith('wall_side') and abs(poly.normal.x)>0.7 and sum(abs(p.x) for p in verts)/len(verts)>64.3:
                poly.material_index=end_panel_index
            elif not ob.name.startswith('wall_side') and abs(poly.normal.x)>0.7:
                poly.material_index=end_inner_index
            if poly.normal.z > 0.8 and all((ob.matrix_world @ ob.data.vertices[ob.data.loops[li].vertex_index].co).z > 15.45 for li in poly.loop_indices):
                poly.material_index=rail_index
    elif ob.name.startswith('goal_frame_'):
        for i in range(len(ob.data.materials)): ob.data.materials[i]=frame
    elif ob.name.startswith('rod_hole'):
        for i in range(len(ob.data.materials)): ob.data.materials[i]=metalmat

# Fine rounded metal lips catch the light along both edges of the brushed rim.
# They follow the stock collision boundary and do not change the playing area.
rim_lip=solid('Silver Circuit | polished rim lip',(.62,.66,.69),.92,.22)
for label,hx,hy in (('outer',68.45,36.98),('inner',60.03,34.03)):
    curve=bpy.data.curves.new('silver rim '+label,'CURVE'); curve.dimensions='3D'
    curve.bevel_depth=.09; curve.bevel_resolution=3
    spline=curve.splines.new('POLY'); spline.points.add(3); spline.use_cyclic_u=True
    for p,co in zip(spline.points,[(-hx,-hy,15.58),(hx,-hy,15.58),(hx,hy,15.58),(-hx,hy,15.58)]): p.co=(*co,1)
    ob=bpy.data.objects.new('silver_rim_lip_'+label,curve); bpy.context.collection.objects.link(ob); ob.data.materials.append(rim_lip)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active=ob; bpy.ops.object.convert(target='MESH')

# The concept lights the outside of the goal as well as the playing-side frame.
for side in (-1,1):
    curve=bpy.data.curves.new('silver outer goal','CURVE'); curve.dimensions='3D'; curve.bevel_depth=0.20; curve.bevel_resolution=3
    r=1.15; half=10.9; top=8.75; x=side*68.58
    coords=[(x,-half,0.2),(x,-half,top-r)]
    coords += [(x,-half+r+r*np.cos(t),top-r+r*np.sin(t)) for t in np.linspace(np.pi,np.pi/2,9)[1:]]
    coords += [(x,half-r,top)]
    coords += [(x,half-r+r*np.cos(t),top-r+r*np.sin(t)) for t in np.linspace(np.pi/2,0,9)[1:]]
    coords += [(x,half,0.2)]
    spline=curve.splines.new('POLY'); spline.points.add(len(coords)-1)
    for p,co in zip(spline.points,coords): p.co=(*co,1)
    ob=bpy.data.objects.new('goal_frame_silver_outer_'+('l' if side<0 else 'r'),curve); bpy.context.collection.objects.link(ob); ob.data.materials.append(frame)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active=ob; bpy.ops.object.convert(target='MESH')

# A translucent halo follows the real goal opening.  It gives the light a soft
# falloff in the game's forward renderer, which has no post-process bloom.
gh,gw=512,1024
gy,gx=np.mgrid[0:gh,0:gw]
yy=-14+28*gx/(gw-1); zz=-1+14*gy/(gh-1)
side_dist=np.hypot(np.abs(yy)-10.9,zz-np.clip(zz,.2,8.0))
top_dist=np.hypot(yy-np.clip(yy,-9.75,9.75),zz-8.75)
dist=np.minimum(side_dist,top_dist)
alpha=.15*np.exp(-np.square(dist/.75))+.055*np.exp(-np.square(dist/1.9))
edge=np.minimum.reduce((gx/50,(gw-1-gx)/50,gy/40,(gh-1-gy)/40,np.ones_like(gx)))
rgba=np.empty((gh,gw,4),dtype=np.float32); rgba[:,:,:3]=(0.08,.62,.9); rgba[:,:,3]=alpha*np.clip(edge,0,1)
halo_img=bpy.data.images.new('silver_goal_halo',width=gw,height=gh,alpha=True)
halo_img.colorspace_settings.name='sRGB'; halo_img.pixels.foreach_set(rgba.ravel())
halo_img.filepath_raw=os.path.join(OUT,'goal_halo.png'); halo_img.file_format='PNG'; halo_img.save()
halo_mat=bpy.data.materials.new('Silver Circuit | goal light halo'); halo_mat.use_nodes=True
try: halo_mat.surface_render_method='BLENDED'
except (AttributeError,TypeError):
    try: halo_mat.blend_method='BLEND'
    except (AttributeError,TypeError): pass
halo_mat.use_backface_culling=False
nodes=halo_mat.node_tree.nodes; links=halo_mat.node_tree.links; bs=nodes.get('Principled BSDF')
tex=nodes.new('ShaderNodeTexImage'); tex.image=halo_img
links.new(tex.outputs['Color'],bs.inputs['Base Color']); links.new(tex.outputs['Color'],bs.inputs['Emission Color'])
links.new(tex.outputs['Alpha'],bs.inputs['Alpha']); bs.inputs['Roughness'].default_value=1
bs.inputs['Emission Strength'].default_value=1
for side in (-1,1):
    for label,x in (('inner',side*59.28),('outer',side*68.75)):
        mesh=bpy.data.meshes.new('silver goal halo')
        mesh.from_pydata([(x,-14,-1),(x,14,-1),(x,14,13),(x,-14,13)],[],[(0,1,2,3)])
        mesh.update(); uv=mesh.uv_layers.new(name='UVMap')
        for loop,coord in zip(mesh.polygons[0].loop_indices,[(0,0),(1,0),(1,1),(0,1)]): uv.data[loop].uv=coord
        ob=bpy.data.objects.new('goal_frame_silver_halo_'+label+'_'+('l' if side<0 else 'r'),mesh)
        bpy.context.collection.objects.link(ob); mesh.materials.append(halo_mat)

target=os.path.join(ROOT,'assets','tables','circuit','fuzeball_table_circuit_silver.glb')
bpy.ops.export_scene.gltf(filepath=target,export_format='GLB',export_yup=True,export_apply=True)
print('Wrote',target)
