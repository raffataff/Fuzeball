// harness for the FLYING SAUCER room: the shipped GLB and sky, the config entry, and the two things the room's look rests on. Run: node tools/saucer-harness.js
// must hold: the encoded GLB is KTX2-only, light-free, has exactly three blended materials (the window glass and the glow and paint decal sheets), opaque ones single-sided (backface culling) and every flat prop sharing one wear map, the bar's front panels face the room (arc_prism winding), and it is inside the triangle and mesh budget; all six sky faces ship; the giant in build_saucer_sky.py sits inside the low-sill window bay of build_saucer_room.py (azimuth and a little under the horizon); the room's authored lights fit the pool (spots, points, shadow budget); bakeGlbEnv hides textured-alpha glass (opacity 1) from the reflection bake, where it used to bake as a white blob
// asset and source files are read from the repo; bakeGlbEnv is string-sliced from js/world.js and rebuilt against stubs
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const rd=p=>fs.readFileSync(path.join(ROOT,p),'utf8').replace(/\r\n/g,'\n');
const WORLD=rd('js/world.js'), CONFIG=rd('js/config.js'), SKYPY=rd('tools/build_saucer_sky.py'), ROOMPY=rd('tools/build_saucer_room.py');

function fnAt(src,name){
 const start=src.indexOf('function '+name+'(');
 if(start<0)throw new Error('ANCHOR LOST: function '+name);
 let d=0;
 for(let j=src.indexOf('{',start);j<src.length;j++){const c=src[j];
  if(c==='{')d++;else if(c==='}'){d--;if(!d)return src.slice(start,j+1);}}
 throw new Error('unbalanced: '+name);
}
function glbData(file){
 const b=fs.readFileSync(path.join(ROOT,file));
 if(b.toString('utf8',0,4)!=='glTF')throw new Error('not a GLB: '+file);
 const jl=b.readUInt32LE(12),j=JSON.parse(b.slice(20,20+jl).toString());
 const bin=Buffer.from(b.slice(20+jl+8,20+jl+8+b.readUInt32LE(20+jl)));   // a copy, so a mutation can edit it
 return {j,bin};
}
function readAcc(j,bin,i){
 const a=j.accessors[i],v=j.bufferViews[a.bufferView],n={SCALAR:1,VEC3:3}[a.type],off=(v.byteOffset||0)+(a.byteOffset||0);
 const out=new Array(a.count*n),w={5126:4,5123:2,5125:4}[a.componentType],rd={5126:'readFloatLE',5123:'readUInt16LE',5125:'readUInt32LE'}[a.componentType];
 const stride=v.byteStride||w*n;
 for(let k=0;k<a.count;k++)for(let c=0;c<n;c++)out[k*n+c]=bin[rd](off+k*stride+c*w);
 return out;
}
// the triangles of one named mesh whose three corners all sit on the cylinder r +- tol and between two heights; swap=true flips their winding in the buffer (for the mutation)
function bandTris(j,bin,meshName,r,tol,y0,y1,swap){
 const node=j.nodes.find(n=>n.name===meshName);if(!node||node.mesh===undefined)return null;
 const out=[];
 for(const p of j.meshes[node.mesh].primitives){
  const P=readAcc(j,bin,p.attributes.POSITION),I=readAcc(j,bin,p.indices),iv=j.bufferViews[j.accessors[p.indices].bufferView],io=(iv.byteOffset||0)+(j.accessors[p.indices].byteOffset||0),w=j.accessors[p.indices].componentType===5123?2:4;
  for(let k=0;k<I.length;k+=3){
   const v=[0,1,2].map(q=>[P[I[k+q]*3],P[I[k+q]*3+1],P[I[k+q]*3+2]]);
   if(!v.every(a=>Math.abs(Math.hypot(a[0],a[2])-r)<tol&&a[1]>=y0&&a[1]<=y1))continue;
   if(swap){const wr=w===2?'writeUInt16LE':'writeUInt32LE';bin[wr](I[k+1],io+(k+2)*w);bin[wr](I[k+2],io+(k+1)*w);}
   const e1=v[1].map((x,c)=>x-v[0][c]),e2=v[2].map((x,c)=>x-v[0][c]);
   const n=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]];
   const cx=(v[0][0]+v[1][0]+v[2][0])/3,cz=(v[0][2]+v[1][2]+v[2][2])/3,L=Math.hypot(cx,cz);
   out.push((swap?-1:1)*-(n[0]*cx+n[2]*cz)/(L*Math.hypot(n[0],n[1],n[2])||1));   // + = faces the middle of the room
  }
 }
 return out;
}
const roomBlock=src=>{const a=src.indexOf('\n   saucer:{\n'),b=src.indexOf('\n      pub:{\n',a);if(a<0||b<0)throw new Error('ANCHOR LOST: saucer room block');return src.slice(a,b);};

/* ---- 1. the shipped files ----------------------------------------------- */
function assetSuite(cfgSrc,tweak){
 const r={pass:0,fail:0,fails:[]};
 const t=(c,m,x)=>{if(c)r.pass++;else{r.fail++;r.fails.push(m+(x===undefined?'':'  ['+x+']'));}};
 const blk=roomBlock(cfgSrc);
 const glbName=(blk.match(/glb:'([^']+)'/)||[])[1],folder=(blk.match(/folder:'([^']+)'/)||[])[1],skySrc=(blk.match(/sky:\{src:'([^']+)'/)||[])[1];
 t(!!glbName&&!!folder&&!!skySrc,'config names a glb, a folder and a sky',[glbName,folder,skySrc].join(' | '));
 const glbPath=folder+glbName;
 t(fs.existsSync(path.join(ROOT,glbPath)),'the room GLB exists',glbPath);
 if(fs.existsSync(path.join(ROOT,glbPath))){
  const {j,bin}=glbData(glbPath);
  if(tweak)tweak(j,bin);
  const ext=j.extensionsUsed||[];
  t(ext.includes('KHR_texture_basisu'),'textures are KTX2 (KHR_texture_basisu)',ext.join());
  t(!ext.includes('KHR_lights_punctual'),'no baked lights: the room is lit by the pooled lights in config');
  t((j.images||[]).every(i=>i.mimeType==='image/ktx2'),'every image is image/ktx2',(j.images||[]).map(i=>i.mimeType).join());
  const blend=(j.materials||[]).filter(m=>m.alphaMode==='BLEND');
  t(blend.length===3&&['glass','glow','paint'].every(k=>blend.some(m=>m.name==='saucer_'+k)),'exactly three transparent materials: the window glass and the glow and paint decal sheets',blend.map(m=>m.name).join());
  t((j.materials||[]).filter(m=>m.alphaMode!=='BLEND').every(m=>!m.doubleSided),'every opaque material is single-sided (backface culling halves the room\'s raster work)',(j.materials||[]).filter(m=>m.alphaMode!=='BLEND'&&m.doubleSided).map(m=>m.name).join());
  const flat=(j.materials||[]).filter(m=>m.alphaMode!=='BLEND'&&m.pbrMetallicRoughness&&m.pbrMetallicRoughness.baseColorTexture&&!m.pbrMetallicRoughness.metallicRoughnessTexture);
  const wearSrc=new Set(flat.map(m=>j.textures[m.pbrMetallicRoughness.baseColorTexture.index].source));
  t(flat.length>=12&&wearSrc.size===1,'every flat prop material wears the one shared wear map (one image, not one per material)',flat.length+' materials, '+wearSrc.size+' images');
  t((j.images||[]).length<=13,'image count (the textures are the real cost of a room)',(j.images||[]).length);
  t(j.meshes.length<=32,'mesh (draw call) budget',j.meshes.length);
  let tris=0;for(const m of j.meshes)for(const p of m.primitives)tris+=(p.indices!==undefined?j.accessors[p.indices].count:j.accessors[p.attributes.POSITION].count)/3;
  t(tris>20000&&tris<=78000,'triangle budget (20k..78k; the heaviest of the other rooms is 40k)',tris);
  const names=new Set(j.nodes.map(n=>n.name));
  for(const need of ['room_saucer_hull','room_saucer_deck','room_saucer_dais','room_saucer_glass','room_saucer_glow','room_saucer_paint'])t(names.has(need),'has '+need);
  // the bar's front panels: arc_prism once wound its faces inside-out, which double-sided materials hid; with culling the viewer saw each solid's far side
  const FY=+(ROOMPY.match(/^FY\s*=\s*(-?[\d.]+)/m)||[])[1],STEP=+(ROOMPY.match(/^STEP\s*=\s*([\d.]+)/m)||[])[1],BF=+(ROOMPY.match(/^BF\s*=\s*([\d.]+)/m)||[])[1];
  t(isFinite(FY)&&isFinite(STEP)&&isFinite(BF),'found FY, STEP and BF in build_saucer_room.py');
  const face=bandTris(j,bin,'room_saucer_teal',BF-0.9,0.05,FY-STEP+11,FY-STEP+90,false);
  t(face&&face.length>=12,'found the front panel triangles of the bar',face&&face.length);
  if(face&&face.length)t(face.filter(x=>x>0.5).length/face.length>0.95,'the front panels of the bar face the room',face.filter(x=>x>0.5).length+'/'+face.length);
 }
 for(const f of ['px','nx','py','ny','pz','nz']){
  const p=skySrc+'_'+f+'.ktx2';
  t(fs.existsSync(path.join(ROOT,p))&&fs.statSync(path.join(ROOT,p)).size>100000,'sky face ships: '+f,p);
 }
 // the pooled lights: the pub sets the per-type pool (3 spots, 1 point), the shadow budget is roomLightPool.shadow {point:1, spot:2}
 const lights=[...blk.matchAll(/\{type:'(spot|point|dir)'[^}]*\}/g)].map(m=>({type:m[1],shadow:/shadow:true/.test(m[0])}));
 const n=ty=>lights.filter(l=>l.type===ty).length,sh=ty=>lights.filter(l=>l.type===ty&&l.shadow).length;
 t(lights.length>=3,'authored lights present',lights.length);
 t(n('spot')<=3&&n('point')<=1&&n('dir')===0,'lights fit the pool (<=3 spots, <=1 point, no dir)',n('spot')+' spots '+n('point')+' points '+n('dir')+' dir');
 t(sh('spot')<=2&&sh('point')<=1,'shadow casters fit the shadow budget (2 spots, 1 point)',sh('spot')+' spots '+sh('point')+' points');
 t(/dir:\{[^}]*on:false/.test(blk),'the sun stays off (no scene light is added or removed per room)');
 return r;
}

/* ---- 2. the giant is in the bay ------------------------------------------ */
function bayAndSkySuite(skySrc,roomSrc){
 const r={pass:0,fail:0,fails:[]};
 const t=(c,m,x)=>{if(c)r.pass++;else{r.fail++;r.fails.push(m+(x===undefined?'':'  ['+x+']'));}};
 const g=skySrc.match(/^GIANT_DIR\s*=\s*K\.unit\(\(([^)]+)\)\)/m);
 const bay=roomSrc.match(/PANES\s*=\s*\[\(c,\s*SILL_LOW if (-?\d+)\s*<\s*c\s*<\s*(-?\d+) else/);
 const sl=roomSrc.match(/^SILL_LOW\s*=\s*(-?[\d.]+)/m);
 t(!!g&&!!bay&&!!sl,'found GIANT_DIR, the bay range and SILL_LOW');
 if(g&&bay&&sl){
  const [x,y,z]=g[1].split(',').map(Number),n=Math.hypot(x,y,z);
  const az=Math.atan2(z,x)*180/Math.PI,el=Math.asin(y/n)*180/Math.PI;
  const lo=+bay[1],hi=+bay[2];
  t(az>lo+6&&az<hi-6,'the giant\'s azimuth ('+az.toFixed(1)+') is inside the bay panes ('+lo+'..'+hi+') with a pane of margin');
  t(el<0&&el>-20,'the giant\'s centre sits a little under the horizon ('+el.toFixed(1)+' deg), where cameras looking down through the window see it');
  t(+sl[1]<-20,'the bay\'s sill is low enough for a camera above the table to see through ('+sl[1]+')');
 }
 return r;
}

/* ---- 3. bakeGlbEnv leaves the glass out of the bake ------------------------ */
function bakeSuite(worldSrc){
 const r={pass:0,fail:0,fails:[]};
 const t=(c,m,x)=>{if(c)r.pass++;else{r.fail++;r.fails.push(m+(x===undefined?'':'  ['+x+']'));}};
 const seen=[];                                     // visibility of each tagged mesh the moment the bake renders
 const mk=(tag,mat)=>({tag,visible:true,material:mat,traverse(fn){fn(this);}});
 const glassTex=mk('glassTex',{transparent:true,opacity:1});          // alpha comes from a texture: opacity stays 1
 const glassFlat=mk('glassFlat',{transparent:true,opacity:0.1});
 const sheet=mk('transmissive',{transmission:0.8,transparent:false,opacity:1});
 const wall=mk('wall',{transparent:false,opacity:1});
 const group={visible:false,parent:null,children:[1],traverse(fn){[glassTex,glassFlat,sheet,wall].forEach(fn);}};
 class Scene{constructor(){this.k=[];}add(o){this.k.push(o);}}
 const THREE={Scene,HemisphereLight:class{}};
 const f=new Function('THREE','renderer','scene','pmrem','envKeep',
  fnAt(worldSrc,'bakeGlbEnv')+'\nreturn bakeGlbEnv;');
 const env={};
 const bake=f(THREE,{},{add(){}},()=>({fromScene(){for(const m of [glassTex,glassFlat,sheet,wall])seen.push([m.tag,m.visible]);return {};}}),x=>x);
 bake(group);
 const vis=Object.fromEntries(seen);
 t(vis.wall===true,'an opaque mesh is in the bake');
 t(vis.glassFlat===false,'a flat translucent pane (opacity<1) is out of the bake');
 t(vis.glassTex===false,'a textured-alpha pane (opacity 1) is out of the bake',vis.glassTex);
 t(vis.transmissive===false,'a transmissive mesh is out of the bake');
 t([glassTex,glassFlat,sheet,wall].every(m=>m.visible===true),'every mesh is visible again once the bake is done');
 t(group.visible===false,'the group keeps its own visibility');
 return r;
}

const a=assetSuite(CONFIG),b=bayAndSkySuite(SKYPY,ROOMPY),c=bakeSuite(WORLD);
const pass=a.pass+b.pass+c.pass,fail=a.fail+b.fail+c.fail,fails=[...a.fails,...b.fails,...c.fails];

/* ---- mutations: each must break a suite -------------------------------------- */
function mutate(src,from,to){if(!src.includes(from))throw new Error('MUTATION ANCHOR LOST: '+from);
 const out=src.replace(from,to);if(out===src)throw new Error('no-op mutation: '+from);return out;}
const MUT=[
 ['bake only hides opacity<1 glass','world',"ms.some(m=>m&&(m.transmission>0||m.transparent))","ms.some(m=>m&&(m.transmission>0||(m.transparent&&m.opacity<1)))"],
 ['bake never hides transmissive meshes','world',"m.transmission>0||m.transparent","m.transparent"],
 ['the giant moves out of the bay','sky',"GIANT_DIR  = K.unit((0.30, -0.10, -1.0))","GIANT_DIR  = K.unit((-0.90, -0.10, -0.40))"],
 ['the giant climbs above the horizon','sky',"GIANT_DIR  = K.unit((0.30, -0.10, -1.0))","GIANT_DIR  = K.unit((0.30, 0.35, -1.0))"],
 ['the bay moves away from the giant','room',"SILL_LOW if -90 < c < -30 else","SILL_LOW if 10 < c < 70 else"],
 ['the bay sill rises above the camera line','room',"SILL_LOW = -28.0","SILL_LOW = 10.0"],
 ['config points at a sky that is not there','cfg',"sky:{src:'assets/rooms/saucer/sky/saucer'}","sky:{src:'assets/rooms/saucer/sky/nothing'}"],
 ['a third shadow-casting spot','cfg',"{type:'point', pos:[0,36,0], look:[0,0,0], color:0xeaf6ff, int:2.1, dist:90, decay:0.6, angle:0.68, penumbra:0.12, shadow:true}","{type:'spot', pos:[0,36,0], look:[0,0,0], color:0xeaf6ff, int:2.1, dist:90, decay:0.6, angle:0.68, penumbra:0.12, shadow:true}"],
 ['the sun is switched on','cfg',"dir:{color:0xffffff,int:1.27,pos:[45,100,35],on:false},\n      env:{shell:0x0a1a20","dir:{color:0xffffff,int:1.27,pos:[45,100,35],on:true},\n      env:{shell:0x0a1a20"],
 ['an opaque material goes double-sided again','glb',j=>{j.materials.find(m=>m.alphaMode!=='BLEND').doubleSided=true;}],
 ['a fourth transparent material','glb',j=>{j.materials.find(m=>m.alphaMode!=='BLEND').alphaMode='BLEND';}],
 ['the draw-call budget blows','glb',j=>{for(let i=0;i<8;i++)j.meshes.push(j.meshes[0]);}],
 ['a prop material gets its own wear image','glb',j=>{const ni=j.images.push({mimeType:'image/ktx2',bufferView:0})-1,nt=j.textures.push({source:ni})-1;j.materials.find(m=>m.alphaMode!=='BLEND'&&m.pbrMetallicRoughness.baseColorTexture&&!m.pbrMetallicRoughness.metallicRoughnessTexture).pbrMetallicRoughness.baseColorTexture.index=nt;}],
 ['the front panels of the bar are wound inside-out','glb',(j,bin)=>{const FY=+ROOMPY.match(/^FY\s*=\s*(-?[\d.]+)/m)[1],STEP=+ROOMPY.match(/^STEP\s*=\s*([\d.]+)/m)[1],BF=+ROOMPY.match(/^BF\s*=\s*([\d.]+)/m)[1];bandTris(j,bin,'room_saucer_teal',BF-0.9,0.05,FY-STEP+11,FY-STEP+90,true);}],
 ['the glow sheet goes missing','glb',j=>{j.nodes.forEach(n=>{if(n.name==='room_saucer_glow')n.name='x';});}]
];
let caught=0;const missed=[];
for(const [name,which,from,to] of MUT){
 let broke=false;
 try{
  let x;
  if(which==='world')x=bakeSuite(mutate(WORLD,from,to));
  else if(which==='sky')x=bayAndSkySuite(mutate(SKYPY,from,to),ROOMPY);
  else if(which==='room')x=bayAndSkySuite(SKYPY,mutate(ROOMPY,from,to));
  else if(which==='glb')x=assetSuite(CONFIG,from);
  else x=assetSuite(mutate(CONFIG,from,to));
  broke=x.fail>0;
 }catch(e){if(/ANCHOR LOST|no-op/.test(e.message))throw e;broke=true;}
 if(broke)caught++;else missed.push(name);
}

console.log(fails.length?fails.map(x=>'FAIL '+x).join('\n'):'');
console.log('saucer harness: '+pass+' passed, '+fail+' failed');
console.log('mutation guard: '+caught+' caught, '+missed.length+' MISSED'+(missed.length?'  -> '+missed.join('; '):''));
process.exit(fail||missed.length?1:0);
