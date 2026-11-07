// harness for the MOON BASE room: the shipped GLB, its config entry and the build script's hold on the owner's hand edits. Run: node tools/moon-harness.js
// must hold: the encoded GLB is KTX2-only and light-free, one blended material (the dome glass), opaque ones single-sided but the flag (cloth, seen from both sides), every prop material wearing a surface set (normal + metallic-roughness maps, three sets shared) and the floor and wall their own, the light bake on the floor, wall, props and terrain (COLOR_0), the floor and terrain face up and the wall ring faces out of its solid, no runaway vertex (the frame's even offset threw two ~8 km out), it is inside the texture, triangle and mesh budget; the owner's edits survive: the flag wears the logo render, the steel stays near-mirror, the steel kick ring runs round the wall base; the build reads its shapes from the hand-edited .blend and never saves over it; all six sky faces ship; the room's authored lights fit the pool
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const rd=p=>fs.readFileSync(path.join(ROOT,p),'utf8').replace(/\r\n/g,'\n');
const CONFIG=rd('js/config.js'), ROOMPY=rd('tools/build_moon_base.py');

function glbData(file){
 const b=fs.readFileSync(path.join(ROOT,file));
 if(b.toString('utf8',0,4)!=='glTF')throw new Error('not a GLB: '+file);
 const jl=b.readUInt32LE(12),j=JSON.parse(b.slice(20,20+jl).toString());
 const bin=Buffer.from(b.slice(20+jl+8,20+jl+8+b.readUInt32LE(20+jl)));
 return {j,bin};
}
function accInfo(j,i){const a=j.accessors[i],v=j.bufferViews[a.bufferView],n={SCALAR:1,VEC3:3}[a.type],w={5126:4,5123:2,5125:4}[a.componentType];
 return {a,n,w,off:(v.byteOffset||0)+(a.byteOffset||0),stride:v.byteStride||w*n,f:{5126:'readFloatLE',5123:'readUInt16LE',5125:'readUInt32LE'}[a.componentType]};}
function readAcc(j,bin,i){
 const {a,n,w,off,stride,f}=accInfo(j,i),out=new Array(a.count*n);
 for(let k=0;k<a.count;k++)for(let c=0;c<n;c++)out[k*n+c]=bin[f](off+k*stride+c*w);
 return out;
}
const prims=(j,name)=>{const node=j.nodes.find(n=>n.name===name);return node&&node.mesh!==undefined?j.meshes[node.mesh].primitives:null;};
// every triangle of one named mesh: unit normal and centre; swap = flip the winding in the buffer first (for the mutations)
function meshTris(j,bin,name,swap){
 const ps=prims(j,name);if(!ps)return null;
 const out=[];
 for(const p of ps){
  const P=readAcc(j,bin,p.attributes.POSITION),I=readAcc(j,bin,p.indices),ai=accInfo(j,p.indices);
  for(let k=0;k<I.length;k+=3){
   if(swap){const wr=ai.w===2?'writeUInt16LE':'writeUInt32LE';bin[wr](I[k+1],ai.off+(k+2)*ai.w);bin[wr](I[k+2],ai.off+(k+1)*ai.w);}
   const v=[0,1,2].map(q=>[P[I[k+q]*3],P[I[k+q]*3+1],P[I[k+q]*3+2]]);
   const e1=v[1].map((x,c)=>x-v[0][c]),e2=v[2].map((x,c)=>x-v[0][c]);
   let n=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]];
   const L=Math.hypot(n[0],n[1],n[2])||1;n=n.map(x=>x/L);if(swap)n=n.map(x=>-x);
   out.push({n,c:[0,1,2].map(c=>(v[0][c]+v[1][c]+v[2][c])/3)});
  }
 }
 return out;
}
// move every vertex of a named mesh that pass() accepts by fn (for the mutations)
function editVerts(j,bin,name,pass,fn){
 for(const p of prims(j,name)){const {a,w,off,stride}=accInfo(j,p.attributes.POSITION);
  for(let k=0;k<a.count;k++){const o=off+k*stride,v=[0,1,2].map(c=>bin.readFloatLE(o+c*w));if(pass(v)){const nv=fn(v);nv.forEach((x,c)=>bin.writeFloatLE(x,o+c*w));}}}
}
const roomBlock=src=>{const a=src.indexOf('\n   moon:{\n'),b=src.indexOf('\n  },',a);if(a<0||b<0)throw new Error('ANCHOR LOST: moon room block');return src.slice(a,b);};
const PROPS=/^moon_(steel|visor|panel|door|tank|suitwhite)$/;
const BAKED=['floor','wall','steel','panel','door','tank','suitwhite','visor','terrain'];

/* ---- 1. the shipped files ----------------------------------------------- */
function assetSuite(cfgSrc,tweak){
 const r={pass:0,fail:0,fails:[]};
 const t=(c,m,x)=>{if(c)r.pass++;else{r.fail++;r.fails.push(m+(x===undefined?'':'  ['+x+']'));}};
 const blk=roomBlock(cfgSrc);
 const glbName=(blk.match(/glb:'([^']+)'/)||[])[1],folder=(blk.match(/folder:'([^']+)'/)||[])[1],skySrc=(blk.match(/sky:\{src:'([^']+)'/)||[])[1];
 t(/name:'Moon Base'/.test(blk),'the room is called Moon Base');
 t(!!glbName&&!!folder&&!!skySrc,'config names a glb, a folder and a sky',[glbName,folder,skySrc].join(' | '));
 const glbPath=folder+glbName;
 t(fs.existsSync(path.join(ROOT,glbPath)),'the room GLB exists',glbPath);
 if(fs.existsSync(path.join(ROOT,glbPath))){
  const {j,bin}=glbData(glbPath);
  if(tweak)tweak(j,bin);
  const M=n=>(j.materials||[]).find(m=>m.name==='moon_'+n);
  const ext=j.extensionsUsed||[];
  t(ext.includes('KHR_texture_basisu'),'textures are KTX2 (KHR_texture_basisu)',ext.join());
  t(!ext.includes('KHR_lights_punctual'),'no baked lights: the sun is CONFIG.rooms.moon.dir and the table spots are pooled');
  t((j.images||[]).every(i=>i.mimeType==='image/ktx2'),'every image is image/ktx2',(j.images||[]).map(i=>i.mimeType).join());
  const blend=(j.materials||[]).filter(m=>m.alphaMode==='BLEND');
  t(blend.length===1&&blend[0].name==='moon_glass','exactly one transparent material: the dome glass',blend.map(m=>m.name).join());
  const two=(j.materials||[]).filter(m=>m.alphaMode!=='BLEND'&&m.doubleSided).map(m=>m.name);
  t(two.length===1&&two[0]==='moon_flag','every opaque material is single-sided but the flag (cloth, seen from both sides)',two.join());
  const props=(j.materials||[]).filter(m=>PROPS.test(m.name)),bare=props.filter(m=>!m.normalTexture||!(m.pbrMetallicRoughness||{}).metallicRoughnessTexture);
  t(props.length===6&&!bare.length,'every prop material wears a surface set (normal + metallic-roughness maps, not flat roughness)',props.length+' materials; bare: '+bare.map(m=>m.name).join());
  const srcOf=ti=>{const T=j.textures[ti];return T.source!==undefined?T.source:((T.extensions||{}).KHR_texture_basisu||{}).source;};
  const nSrc=new Set(props.filter(m=>m.normalTexture).map(m=>srcOf(m.normalTexture.index)));
  t(nSrc.size===3,'the props share three surface sets (steel, paint, plastic)',nSrc.size+' normal maps');
  t(['floor','wall'].every(k=>M(k)&&M(k).normalTexture&&(M(k).pbrMetallicRoughness||{}).metallicRoughnessTexture),'the floor and the wall carry their own normal and metallic-roughness maps');
  t(!!(M('terrain')&&M('terrain').normalTexture),'the regolith has a normal map');
  const unbaked=BAKED.filter(k=>{const ps=prims(j,'room_moon_'+k);return !ps||!ps.every(p=>p.attributes.COLOR_0!==undefined);});
  t(!unbaked.length,'the light bake reaches the floor, wall, props and terrain (COLOR_0 on every primitive)',unbaked.join());
  // the owner's hand edits
  t(!!(M('flag')&&(M('flag').pbrMetallicRoughness||{}).baseColorTexture),'the flag wears the owner\'s logo render');
  const st=(M('steel')||{}).pbrMetallicRoughness||{},bc=st.baseColorFactor||[1,1,1];
  t(st.metallicFactor>=0.95&&st.roughnessFactor>=1&&st.roughnessFactor<=1.4&&Math.max(bc[0],bc[1],bc[2])<0.08,'the steel keeps the owner\'s near-mirror tuning (metal 0.99, dark, rough x1.2 on the set)',[st.metallicFactor,st.roughnessFactor,bc.map(x=>x.toFixed(3))].join(' '));
  const sk=meshTris(j,bin,'room_moon_steel')||[];
  const ring=sk.filter(x=>{const r=Math.hypot(x.c[0],x.c[2]);return r>171.5&&r<172.1&&x.c[1]>-46.2&&x.c[1]<-39.2;});
  const az=new Set(ring.map(x=>Math.round(Math.atan2(x.c[2],x.c[0])*8)));
  t(ring.length>=100&&az.size>=40,'the owner\'s steel kick ring runs round the wall base',ring.length+' triangles over '+az.size+' sectors');
  let far=0;for(const m of j.meshes)for(const p of m.primitives){const P=readAcc(j,bin,p.attributes.POSITION);for(let k=0;k<P.length;k+=3)if(Math.hypot(P[k],P[k+1],P[k+2])>1000)far++;}
  t(far===0,'no runaway vertex (nothing past 10 m from the table)',far);
  let texels=0;for(const im of j.images||[]){const v=j.bufferViews[im.bufferView];if(v&&im.mimeType==='image/ktx2'){const o=v.byteOffset||0;texels+=bin.readUInt32LE(o+20)*bin.readUInt32LE(o+24);}}
  t((j.images||[]).length<=28&&texels<=16e6,'texture budget: <=28 images, <=16M texels at the top level',(j.images||[]).length+' images, '+(texels/1e6).toFixed(1)+'M texels');
  t(j.meshes.length<=16,'mesh (draw call) budget',j.meshes.length);
  let tris=0;for(const m of j.meshes)for(const p of m.primitives)tris+=(p.indices!==undefined?j.accessors[p.indices].count:j.accessors[p.attributes.POSITION].count)/3;
  t(tris>30000&&tris<=60000,'triangle budget (30k..60k; the terrain is 31k)',tris);
  const names=new Set(j.nodes.map(n=>n.name));
  for(const need of ['floor','wall','glass','steel','terrain','flag','strip'])t(names.has('room_moon_'+need),'has room_moon_'+need);
  const fl=meshTris(j,bin,'room_moon_floor');
  t(fl&&fl.length>1000&&fl.every(x=>x.n[1]>0.99),'the floor faces up (and is cut fine enough for the bake)',fl&&fl.filter(x=>x.n[1]<=0.99).length+' of '+fl.length+' do not');
  const te=meshTris(j,bin,'room_moon_terrain');
  t(te&&te.filter(x=>x.n[1]>0).length>=te.length*0.95,'the terrain faces up (the boulders, joined into it, have undersides)',te&&te.filter(x=>x.n[1]<=0).length+' of '+te.length+' face down');
  const wl=meshTris(j,bin,'room_moon_wall');
  const wrong=(wl||[]).filter(x=>{const r=Math.hypot(x.c[0],x.c[2]),rd=(x.n[0]*x.c[0]+x.n[2]*x.c[2])/(r||1);
   if(Math.abs(x.n[1])>0.9)return x.n[1]*(x.c[1]-(-37))<0;                 // top up, bottom down
   return r<174.5?rd>=0:rd<=0;});                                            // inner face toward the centre, outer face away
  t(wl&&wl.length>500&&!wrong.length,'the wall ring faces out of its solid (its inner face toward the table)',wl&&wrong.length+' of '+wl.length+' face in');
 }
 for(const f of ['px','nx','py','ny','pz','nz']){
  const p=skySrc+'_'+f+'.ktx2';
  t(fs.existsSync(path.join(ROOT,p))&&fs.statSync(path.join(ROOT,p)).size>100000,'sky face ships: '+f,p);
 }
 const lights=[...blk.matchAll(/\{type:'(spot|point|dir)'[^}]*\}/g)].map(m=>({type:m[1],shadow:/shadow:true/.test(m[0])}));
 const n=ty=>lights.filter(l=>l.type===ty).length;
 t(lights.length>=3&&n('spot')<=3&&n('point')<=1&&n('dir')===0,'lights fit the pool (<=3 spots, <=1 point, no dir)',n('spot')+' spots '+n('point')+' points');
 return r;
}

/* ---- 2. the build keeps the owner's .blend ------------------------------------ */
function scriptSuite(src){
 const r={pass:0,fail:0,fails:[]};
 const t=(c,m,x)=>{if(c)r.pass++;else{r.fail++;r.fails.push(m+(x===undefined?'':'  ['+x+']'));}};
 const geo=(src.match(/^GEO_SRC = os\.path\.join\(BUILD, '([^']+)'\)/m)||[])[1];
 const saves=[...src.matchAll(/save_as_mainfile\(filepath=os\.path\.join\(BUILD, '([^']+)'\)\)/g)].map(m=>m[1]);
 t(!!geo&&/libraries\.load\(GEO_SRC/.test(src),'the shapes come from the owner\'s hand-edited .blend (GEO_SRC)',geo);
 t(saves.length>0&&saves.every(s=>s!==geo),'the build never saves over the hand-edited .blend',saves.join());
 t(/^FLAG_SRC = /m.test(src)&&/'steel':\s*\(0x2b3036, 0\.99, 1\.2,/.test(src),'the flag render and the owner\'s steel tuning are in the script');
 return r;
}

const a=assetSuite(CONFIG),b=scriptSuite(ROOMPY);
const pass=a.pass+b.pass,fail=a.fail+b.fail,fails=[...a.fails,...b.fails];

/* ---- mutations: each must break a suite -------------------------------------- */
function mutate(src,from,to){if(!src.includes(from))throw new Error('MUTATION ANCHOR LOST: '+from);
 const out=src.replace(from,to);if(out===src)throw new Error('no-op mutation: '+from);return out;}
const MUT=[
 ['config points at a sky that is not there','cfg',"sky:{src:'assets/rooms/moon/sky/moon'}","sky:{src:'assets/rooms/moon/sky/nothing'}"],
 ['a dir light in the pool (the sun is rooms.moon.dir)','cfg',"{type:'spot', pos:[0,36,0], look:[0,0,0], color:0xeef3ff","{type:'dir', pos:[0,36,0], look:[0,0,0], color:0xeef3ff"],
 ['the build saves over the owner\'s .blend','py',"save_as_mainfile(filepath=os.path.join(BUILD, 'moon_room.blend'))","save_as_mainfile(filepath=os.path.join(BUILD, 'moon_base.blend'))"],
 ['the build regenerates the shapes itself','py',"with bpy.data.libraries.load(GEO_SRC, link=False)","with bpy.data.libraries.load(OTHER, link=False)"],
 ['the steel goes back to the script\'s first tuning','py',"'steel':     (0x2b3036, 0.99, 1.2,","'steel':     (0x2b3036, 0.75, 0.42,"],
 ['an opaque material goes double-sided','glb',j=>{j.materials.find(m=>m.name==='moon_floor').doubleSided=true;}],
 ['a second transparent material','glb',j=>{j.materials.find(m=>m.name==='moon_steel').alphaMode='BLEND';}],
 ['the draw-call budget blows','glb',j=>{for(let i=0;i<10;i++)j.meshes.push(j.meshes[0]);}],
 ['a prop material goes back to flat roughness','glb',j=>{const m=j.materials.find(m=>m.name==='moon_tank');delete m.normalTexture;delete m.pbrMetallicRoughness.metallicRoughnessTexture;}],
 ['every prop material gets a set of its own','glb',j=>{j.materials.filter(m=>m.normalTexture&&PROPS.test(m.name)).forEach(m=>{const ni=j.images.push({mimeType:'image/ktx2',bufferView:j.images[0].bufferView})-1;m.normalTexture={index:j.textures.push({source:ni})-1};});}],
 ['the wall loses its ORM','glb',j=>{delete j.materials.find(m=>m.name==='moon_wall').pbrMetallicRoughness.metallicRoughnessTexture;}],
 ['the floor misses the bake','glb',j=>{prims(j,'room_moon_floor').forEach(p=>delete p.attributes.COLOR_0);}],
 ['the flag loses the render','glb',j=>{delete j.materials.find(m=>m.name==='moon_flag').pbrMetallicRoughness.baseColorTexture;}],
 ['the steel goes back to metal 0.75','glb',j=>{j.materials.find(m=>m.name==='moon_steel').pbrMetallicRoughness.metallicFactor=0.75;}],
 ['the kick ring is lost','glb',(j,bin)=>{editVerts(j,bin,'room_moon_steel',v=>{const r=Math.hypot(v[0],v[2]);return r>171.5&&r<172.1&&v[1]<-38;},v=>[v[0],v[1]+30,v[2]]);}],
 ['a runaway vertex','glb',(j,bin)=>{editVerts(j,bin,'room_moon_steel',(()=>{let once=true;return()=>{const o=once;once=false;return o;};})(),v=>[v[0],v[1],v[2]+800000]);}],
 ['the floor is wound face down','glb',(j,bin)=>{meshTris(j,bin,'room_moon_floor',true);}],
 ['the terrain is wound face down','glb',(j,bin)=>{meshTris(j,bin,'room_moon_terrain',true);}],
 ['the wall ring is wound inside-out','glb',(j,bin)=>{meshTris(j,bin,'room_moon_wall',true);}],
 ['the glass goes missing','glb',j=>{j.nodes.forEach(n=>{if(n.name==='room_moon_glass')n.name='x';});}]
];
let caught=0;const missed=[];
for(const [name,which,from,to] of MUT){
 let broke=false;
 try{
  let x;
  if(which==='py')x=scriptSuite(mutate(ROOMPY,from,to));
  else if(which==='glb')x=assetSuite(CONFIG,from);
  else x=assetSuite(mutate(CONFIG,from,to));
  broke=x.fail>0;
 }catch(e){if(/ANCHOR LOST|no-op/.test(e.message))throw e;broke=true;}
 if(broke)caught++;else missed.push(name);
}

console.log(fails.length?fails.map(x=>'FAIL '+x).join('\n'):'');
console.log('moon harness: '+pass+' passed, '+fail+' failed');
console.log('mutation guard: '+caught+' caught, '+missed.length+' MISSED'+(missed.length?'  -> '+missed.join('; '):''));
process.exit(fail||missed.length?1:0);
