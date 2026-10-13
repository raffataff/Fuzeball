// harness for the STARPORT ARCADE room: the shipped GLB and sky, the config entry, and the two things the room's look rests on. Run: node tools/arcade-harness.js
// must hold: the encoded GLB is KTX2-only and light-free, has exactly two blended materials (the window glass and the glow sheet), opaque ones single-sided, every flat prop sharing one wear map, the floor faces up and every wall faces the room, it is inside the triangle and mesh budget; all six sky faces ship; the planet in build_arcade_sky.py sits a little under the horizon and the bays in build_arcade_room.py straddle the horizon, so a camera above the table sees it; the room's authored lights fit the pool
// asset and source files are read from the repo
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const rd=p=>fs.readFileSync(path.join(ROOT,p),'utf8').replace(/\r\n/g,'\n');
const CONFIG=rd('js/config.js'), SKYPY=rd('tools/build_arcade_sky.py'), ROOMPY=rd('tools/build_arcade_room.py');

function glbData(file){
 const b=fs.readFileSync(path.join(ROOT,file));
 if(b.toString('utf8',0,4)!=='glTF')throw new Error('not a GLB: '+file);
 const jl=b.readUInt32LE(12),j=JSON.parse(b.slice(20,20+jl).toString());
 const bin=Buffer.from(b.slice(20+jl+8,20+jl+8+b.readUInt32LE(20+jl)));
 return {j,bin};
}
function readAcc(j,bin,i){
 const a=j.accessors[i],v=j.bufferViews[a.bufferView],n={SCALAR:1,VEC3:3}[a.type],off=(v.byteOffset||0)+(a.byteOffset||0);
 const out=new Array(a.count*n),w={5126:4,5123:2,5125:4}[a.componentType],f={5126:'readFloatLE',5123:'readUInt16LE',5125:'readUInt32LE'}[a.componentType];
 const stride=v.byteStride||w*n;
 for(let k=0;k<a.count;k++)for(let c=0;c<n;c++)out[k*n+c]=bin[f](off+k*stride+c*w);
 return out;
}
// the unit normals of every triangle of one named mesh, with the triangle's centre; swap = true flips the winding in the buffer first (for the mutation)
function meshTris(j,bin,name,swap){
 const node=j.nodes.find(n=>n.name===name);if(!node||node.mesh===undefined)return null;
 const out=[];
 for(const p of j.meshes[node.mesh].primitives){
  const P=readAcc(j,bin,p.attributes.POSITION),I=readAcc(j,bin,p.indices);
  const acc=j.accessors[p.indices],iv=j.bufferViews[acc.bufferView],io=(iv.byteOffset||0)+(acc.byteOffset||0),w=acc.componentType===5123?2:4;
  for(let k=0;k<I.length;k+=3){
   if(swap){const wr=w===2?'writeUInt16LE':'writeUInt32LE';bin[wr](I[k+1],io+(k+2)*w);bin[wr](I[k+2],io+(k+1)*w);}
   const v=[0,1,2].map(q=>[P[I[k+q]*3],P[I[k+q]*3+1],P[I[k+q]*3+2]]);
   const e1=v[1].map((x,c)=>x-v[0][c]),e2=v[2].map((x,c)=>x-v[0][c]);
   let n=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]];
   const L=Math.hypot(n[0],n[1],n[2])||1;n=n.map(x=>x/L);if(swap)n=n.map(x=>-x);
   out.push({n,c:[0,1,2].map(c=>(v[0][c]+v[1][c]+v[2][c])/3)});
  }
 }
 return out;
}
const roomBlock=src=>{const a=src.indexOf('\n   arcade:{\n'),b=src.indexOf('\n   moon:{\n',a);if(a<0||b<0)throw new Error('ANCHOR LOST: arcade room block');return src.slice(a,b);};

/* ---- 1. the shipped files ----------------------------------------------- */
function assetSuite(cfgSrc,tweak){
 const r={pass:0,fail:0,fails:[]};
 const t=(c,m,x)=>{if(c)r.pass++;else{r.fail++;r.fails.push(m+(x===undefined?'':'  ['+x+']'));}};
 const blk=roomBlock(cfgSrc);
 const glbName=(blk.match(/glb:'([^']+)'/)||[])[1],folder=(blk.match(/folder:'([^']+)'/)||[])[1],skySrc=(blk.match(/sky:\{src:'([^']+)'/)||[])[1];
 t(/name:'Starport Arcade'/.test(blk),'the room is called Starport Arcade');
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
  t(blend.length===2&&['glass','glow'].every(k=>blend.some(m=>m.name==='arcade_'+k)),'exactly two transparent materials: the window glass and the glow sheet',blend.map(m=>m.name).join());
  t((j.materials||[]).filter(m=>m.alphaMode!=='BLEND').every(m=>!m.doubleSided),'every opaque material is single-sided',(j.materials||[]).filter(m=>m.alphaMode!=='BLEND'&&m.doubleSided).map(m=>m.name).join());
  const flat=(j.materials||[]).filter(m=>/^arcade_(gun|steel|brass|rubber|cream|blue|red|yellow|wood|crate|door|ceil|plant)$/.test(m.name)&&m.pbrMetallicRoughness&&m.pbrMetallicRoughness.baseColorTexture);
  const wearSrc=new Set(flat.map(m=>j.textures[m.pbrMetallicRoughness.baseColorTexture.index].source));
  t(flat.length>=10&&wearSrc.size===1,'every flat prop material wears the one shared wear map (one image, not one per material)',flat.length+' materials, '+wearSrc.size+' images');
  t((j.images||[]).length<=20,'image count (the textures are the real cost of a room)',(j.images||[]).length);
  t(j.meshes.length<=32,'mesh (draw call) budget',j.meshes.length);
  let tris=0;for(const m of j.meshes)for(const p of m.primitives)tris+=(p.indices!==undefined?j.accessors[p.indices].count:j.accessors[p.attributes.POSITION].count)/3;
  t(tris>10000&&tris<=40000,'triangle budget (10k..40k; the Saucer is 70k, the pub 5k)',tris);
  const names=new Set(j.nodes.map(n=>n.name));
  for(const need of ['room_arcade_floor','room_arcade_wall','room_arcade_glass','room_arcade_glow','room_arcade_cabinets','room_arcade_logo','room_arcade_poster'])t(names.has(need),'has '+need);
  const fl=meshTris(j,bin,'room_arcade_floor');
  t(fl&&fl.length>0&&fl.every(x=>x.n[1]>0.99),'the floor faces up',fl&&fl.filter(x=>x.n[1]<=0.99).length+' of '+fl.length+' do not');
  const wl=meshTris(j,bin,'room_arcade_wall');
  // faces the room: the normal points toward the room's axis (x and z), the walls being the room's four sides
  t(wl&&wl.length>50&&wl.every(x=>-(x.n[0]*x.c[0]+x.n[2]*x.c[2])>0),'every wall triangle faces the room',wl&&wl.filter(x=>-(x.n[0]*x.c[0]+x.n[2]*x.c[2])<=0).length+' of '+wl.length+' face away');
 }
 for(const f of ['px','nx','py','ny','pz','nz']){
  const p=skySrc+'_'+f+'.ktx2';
  t(fs.existsSync(path.join(ROOT,p))&&fs.statSync(path.join(ROOT,p)).size>100000,'sky face ships: '+f,p);
 }
 // the pooled lights: the pub and the Void set the per-type pool (3 spots, 1 point), the shadow budget is roomLightPool.shadow {point:1, spot:2}
 const lights=[...blk.matchAll(/\{type:'(spot|point|dir)'[^}]*\}/g)].map(m=>({type:m[1],shadow:/shadow:true/.test(m[0])}));
 const n=ty=>lights.filter(l=>l.type===ty).length,sh=ty=>lights.filter(l=>l.type===ty&&l.shadow).length;
 t(lights.length>=3,'authored lights present',lights.length);
 t(n('spot')<=3&&n('point')<=1&&n('dir')===0,'lights fit the pool (<=3 spots, <=1 point, no dir)',n('spot')+' spots '+n('point')+' points '+n('dir')+' dir');
 t(sh('spot')<=2&&sh('point')<=1,'shadow casters fit the shadow budget (2 spots, 1 point)',sh('spot')+' spots '+sh('point')+' points');
 const bg=+(blk.match(/bg:(0x[0-9a-f]+)/i)||[])[1];
 t(isFinite(bg)&&((bg>>16&255)+(bg>>8&255)+(bg&255))<150,'bg (= the fog colour) stays dark: a grey one hazes the whole room',bg&&bg.toString(16));
 return r;
}

/* ---- 2. the planet is under the horizon the bays look over ----------------- */
function bayAndSkySuite(skySrc,roomSrc){
 const r={pass:0,fail:0,fails:[]};
 const t=(c,m,x)=>{if(c)r.pass++;else{r.fail++;r.fails.push(m+(x===undefined?'':'  ['+x+']'));}};
 const p=skySrc.match(/^PLANET_DIR\s*=\s*K\.unit\(\(([^)]+)\)\)/m),d=skySrc.match(/^PLANET_DEG\s*=\s*([\d.]+)/m);
 const sill=roomSrc.match(/^SILL, HEAD\s*=\s*(-?[\d.]+),\s*(-?[\d.]+)/m);
 t(!!p&&!!d&&!!sill,'found PLANET_DIR, PLANET_DEG and SILL, HEAD');
 if(p&&d&&sill){
  const [x,y,z]=p[1].split(',').map(Number),L=Math.hypot(x,y,z),C=[x/L,y/L,z/L],rad=+d[1];
  // the highest elevation the disc reaches straight down the far wall (-z)
  let top=-90;
  for(let e=-89;e<=89;e+=0.5){
   const er=e*Math.PI/180,D=[0,Math.sin(er),-Math.cos(er)];
   const a=Math.acos(Math.max(-1,Math.min(1,D[0]*C[0]+D[1]*C[1]+D[2]*C[2])))*180/Math.PI;
   if(a<=rad)top=e;
  }
  t(top<0&&top>-15,'the planet\'s limb straight ahead sits a little under the horizon ('+top+' deg), where a camera looking down through the bay sees it');
  t(C[1]<-0.5,'the planet is mostly below: its centre is steeply down',C[1].toFixed(2));
  t(+sill[1]<-10&&+sill[2]>0,'the bays straddle the horizon: the sill is low and the head above it ('+sill[1]+'..'+sill[2]+')');
 }
 return r;
}

const a=assetSuite(CONFIG),b=bayAndSkySuite(SKYPY,ROOMPY);
const pass=a.pass+b.pass,fail=a.fail+b.fail,fails=[...a.fails,...b.fails];

/* ---- mutations: each must break a suite -------------------------------------- */
function mutate(src,from,to){if(!src.includes(from))throw new Error('MUTATION ANCHOR LOST: '+from);
 const out=src.replace(from,to);if(out===src)throw new Error('no-op mutation: '+from);return out;}
const MUT=[
 ['the planet climbs above the horizon','sky',"PLANET_DIR = K.unit((0.25, -0.90, -0.35))","PLANET_DIR = K.unit((0.25, -0.20, -0.95))"],
 ['the planet sinks out of sight','sky',"PLANET_DEG = 64.0","PLANET_DEG = 30.0"],
 ['the bays rise above the camera line','room',"SILL, HEAD = -22.0, 58.0","SILL, HEAD = 12.0, 58.0"],
 ['config points at a sky that is not there','cfg',"sky:{src:'assets/rooms/arcade/sky/starport'}","sky:{src:'assets/rooms/arcade/sky/nothing'}"],
 ['the room is the Neon Arcade again','cfg',"name:'Starport Arcade'","name:'Neon Arcade'"],
 ['a second point light','cfg',"{type:'spot', pos:[0,10,-197]","{type:'point', pos:[0,10,-197]"],
 ['the fog is grey again','cfg',"bg:0x16110f","bg:0x5c5d60"],
 ['an opaque material goes double-sided','glb',j=>{j.materials.find(m=>m.alphaMode!=='BLEND').doubleSided=true;}],
 ['a third transparent material','glb',j=>{j.materials.find(m=>m.alphaMode!=='BLEND'&&/^arcade_gun$/.test(m.name)).alphaMode='BLEND';}],
 ['the draw-call budget blows','glb',j=>{for(let i=0;i<10;i++)j.meshes.push(j.meshes[0]);}],
 ['a prop material gets its own wear image','glb',j=>{const ni=j.images.push({mimeType:'image/ktx2',bufferView:0})-1,nt=j.textures.push({source:ni})-1;j.materials.find(m=>m.name==='arcade_gun').pbrMetallicRoughness.baseColorTexture.index=nt;}],
 ['the floor is wound face down','glb',(j,bin)=>{meshTris(j,bin,'room_arcade_floor',true);}],
 ['the walls are wound inside-out','glb',(j,bin)=>{meshTris(j,bin,'room_arcade_wall',true);}],
 ['the glow sheet goes missing','glb',j=>{j.nodes.forEach(n=>{if(n.name==='room_arcade_glow')n.name='x';});}]
];
let caught=0;const missed=[];
for(const [name,which,from,to] of MUT){
 let broke=false;
 try{
  let x;
  if(which==='sky')x=bayAndSkySuite(mutate(SKYPY,from,to),ROOMPY);
  else if(which==='room')x=bayAndSkySuite(SKYPY,mutate(ROOMPY,from,to));
  else if(which==='glb')x=assetSuite(CONFIG,from);
  else x=assetSuite(mutate(CONFIG,from,to));
  broke=x.fail>0;
 }catch(e){if(/ANCHOR LOST|no-op/.test(e.message))throw e;broke=true;}
 if(broke)caught++;else missed.push(name);
}

console.log(fails.length?fails.map(x=>'FAIL '+x).join('\n'):'');
console.log('arcade harness: '+pass+' passed, '+fail+' failed');
console.log('mutation guard: '+caught+' caught, '+missed.length+' MISSED'+(missed.length?'  -> '+missed.join('; '):''));
process.exit(fail||missed.length?1:0);
