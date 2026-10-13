// ice harness. node tools/ice-harness.js
// js/ice.js on live CONFIG with a THREE stub: the block fitted to a figurine (a synthetic man and every shipped figurine's real vertices: enclosed, snug where the ball reaches, closed and wound outward),
// then the module on a stub table: form / flicker / shatter / clear / menu / replay / a cannonball kill / particles off / both teams / refit / re-freeze, and mutations that must each break it
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10),CR=String.fromCharCode(13);
const rd=f=>fs.readFileSync(f,'utf8').split(CR+NL).join(NL);

const STUB=`
var V3=function(x,y,z){this.x=x||0;this.y=y||0;this.z=z||0;};
V3.prototype.set=function(x,y,z){this.x=x;this.y=y;this.z=z;return this;};V3.prototype.copy=function(o){this.x=o.x;this.y=o.y;this.z=o.z;return this;};
V3.prototype.fromBufferAttribute=function(a,i){this.x=a.array[i*3];this.y=a.array[i*3+1];this.z=a.array[i*3+2];return this;};
V3.prototype.applyMatrix4=function(m){this.x=this.x*m.cx+m.tx;this.y=this.y*m.cy+m.ty;this.z=this.z*m.cz+m.tz;return this;};
var Col=function(){this.r=0;this.g=0;this.b=0;};
Col.prototype.set=function(h){this.r=((h>>16)&255)/255;this.g=((h>>8)&255)/255;this.b=(h&255)/255;return this;};
var ID={cx:1,cy:1,cz:1,tx:0,ty:0,tz:0};
var ADDS=[];
var G=function(){this.position=new V3();this.rotation={x:0,y:0,z:0};this.scale=new V3(1,1,1);this.visible=true;this.children=[];this.parent=null;this.matrixWorld=ID;};
G.prototype.add=function(c){c.parent=this;this.children.push(c);ADDS.push([this,c]);return this;};
G.prototype.updateWorldMatrix=function(up){
 if(up&&this.parent)this.parent.updateWorldMatrix(true,false);
 const P=this.parent?this.parent.matrixWorld:ID,fx=Math.abs(this.rotation.y)>1?-1:1;
 this.matrixWorld={cx:this.scale.x*fx*P.cx,cy:this.scale.y*P.cy,cz:this.scale.z*fx*P.cz,
  tx:this.position.x*P.cx+P.tx,ty:this.position.y*P.cy+P.ty,tz:this.position.z*P.cz+P.tz};
};
var BG=function(){this.attributes={};this.disposed=false;};
BG.prototype.setAttribute=function(k,a){this.attributes[k]=a;};
BG.prototype.computeBoundingBox=function(){const a=this.attributes.position.array,mn={x:1e9,y:1e9,z:1e9},mx={x:-1e9,y:-1e9,z:-1e9};
 for(let i=0;i<a.length;i+=3){mn.x=Math.min(mn.x,a[i]);mx.x=Math.max(mx.x,a[i]);mn.y=Math.min(mn.y,a[i+1]);mx.y=Math.max(mx.y,a[i+1]);mn.z=Math.min(mn.z,a[i+2]);mx.z=Math.max(mx.z,a[i+2]);}
 this.boundingBox={min:mn,max:mx};};
BG.prototype.computeBoundingSphere=function(){};BG.prototype.dispose=function(){this.disposed=true;};
var Mesh=function(g,m){G.call(this);this.isMesh=true;this.geometry=g;this.material=m;this.renderOrder=0;this.castShadow=true;this.receiveShadow=true;};
Mesh.prototype=Object.create(G.prototype);
var THREE={Vector3:V3,Color:Col,Group:G,Mesh:Mesh,InstancedMesh:function(g,m,n){Mesh.call(this,g,m);this.instanceMatrix={array:new Float32Array(n*16),needsUpdate:false};this.count=n;},DoubleSide:2,BufferGeometry:BG,BufferAttribute:function(a,n){this.array=a;this.itemSize=n;this.count=a.length/n;},
 MeshStandardMaterial:function(o){Object.assign(this,o);},CanvasTexture:function(){},FrontSide:0,BackSide:1,RepeatWrapping:2};
function kitLin(h){return new Col().set(h);}
var rods=[],SCENELOG=[],scene={add:function(o){SCENEADDS++;SCENELOG.push(o);}},SCENEADDS=0;
var S={phase:'play',time:0,eff:[{boost:0,frozen:0,big:0},{boost:0,frozen:0,big:0}]};
var playerModel=[null,null];
var AUCALLS=[];var Au={play:function(id){AUCALLS.push(id);return false;}};
var FXON=true,CF=[],SP=[],BL=[],BU=[];
function vfxLive(){return FXON;}
function vfxLin(h){const c=new Col().set(h);return [c.r,c.g,c.b];}
function vfxRg(a){return a[0]+(a[1]-a[0])*Math.random();}
function vfxDir(x,y,z,s){return [x,y,z];}
function vfxSphere(){const z=Math.random()*2-1,a=Math.random()*6.28,s=Math.sqrt(1-z*z);return [Math.cos(a)*s,z,Math.sin(a)*s];}
function vfxConf(px,py,pz,vx,vy,vz,life,c,size,delay,drag,sway){CF.push({x:px,y:py,z:pz,vx,vy,vz,life,size,drag,sway});}
function vfxSpk(px,py,pz,vx,vy,vz,life,c,pw,size,drag,grav,tail,flags,delay){SP.push({x:px,y:py,z:pz,flags});}
function vfxBlast(kind,x,y,z){BL.push({kind,x,y,z});}
function burst(p,c1,c2,n,sp){BU.push({x:p.x,y:p.y,z:p.z,n});}
`;
const EXPORT=`;globalThis.X={CONFIG:CONFIG,IC:IC,ICE:ICE,S:S,cfg:cfg,THREE:THREE,ID:ID,
 get rods(){return rods;},set rods(v){rods=v;},playerModel:playerModel,
 get FXON(){return FXON;},set FXON(v){FXON=v;},
 get SCENEADDS(){return SCENEADDS;},set SCENEADDS(v){SCENEADDS=v;},
 log:{au:AUCALLS,cf:CF,sp:SP,bl:BL,bu:BU,adds:ADDS,scene:SCENELOG},F:F,
 iceScan:iceScan,iceBands:iceBands,iceDefault:iceDefault,iceFoot:iceFoot,iceRings:iceRings,iceRing:iceRing,iceTris:iceTris,iceMake:iceMake,
 iceFitTeam:iceFitTeam,iceChunkSpawn:iceChunkSpawn,iceBuild:iceBuild,iceUpdate:iceUpdate,iceClear:iceClear,
 ROD_H:ROD_H,PLAYER_H:PLAYER_H,FOOT_BOX:FOOT_BOX,FOOT_BOX_OFF:FOOT_BOX_OFF,ARM:ARM,FOOT_T:FOOT_T,activeModel:activeModel,tmScale:tmScale};`;

function boot(src){
 const EL={style:{},offsetWidth:0,classList:{add(){},remove(){}},getContext:function(){return new Proxy({},{get:()=>function(){},set:()=>true});}};
 const ctx={console,Math,JSON,Object,Array,Set,Map,isNaN,isFinite,RegExp,String,Float32Array,Proxy,localStorage:{getItem:()=>null,setItem:()=>{}},
  document:{getElementById:()=>EL,createElement:()=>EL,body:{appendChild(){}},documentElement:{style:{setProperty(){}}}}};
 ctx.globalThis=ctx;
 // the stub's own `document` (canvas) is declared after core/config, which only need the context's
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),STUB,src,EXPORT].join(NL),ctx);
 if(!ctx.X||!ctx.X.ICE)throw new Error('export line did not run');
 return ctx.X;
}

let pass=0,fail=0;const fails=[];
function ok(c,msg){if(c)pass++;else{fail++;fails.push(msg);}}
const near=(a,b,e)=>Math.abs(a-b)<=(e===undefined?1e-6:e);

// --- real figurine vertices from the shipped GLBs ---
const GLB=new Map();
function glbPoints(file,s){
 const b=fs.readFileSync(file),jl=b.readUInt32LE(12),j=JSON.parse(b.slice(20,20+jl).toString()),bin=20+jl+8,dv=new DataView(b.buffer,b.byteOffset,b.byteLength),out=[];
 const rot=(q,v)=>{const x=q[0],y=q[1],z=q[2],w=q[3],tx=2*(y*v[2]-z*v[1]),ty=2*(z*v[0]-x*v[2]),tz=2*(x*v[1]-y*v[0]);return [v[0]+w*tx+(y*tz-z*ty),v[1]+w*ty+(z*tx-x*tz),v[2]+w*tz+(x*ty-y*tx)];};
 const walk=(i,par)=>{
  const n=j.nodes[i],t=n.translation||[0,0,0],sc=n.scale||[1,1,1],q=n.rotation||[0,0,0,1];
  const xf=v=>{let p=rot(q,[v[0]*sc[0],v[1]*sc[1],v[2]*sc[2]]);p=[p[0]+t[0],p[1]+t[1],p[2]+t[2]];return par?par(p):p;};
  if(n.mesh!=null)for(const pr of j.meshes[n.mesh].primitives){
   const a=j.accessors[pr.attributes.POSITION],bv=j.bufferViews[a.bufferView],st=bv.byteStride||12,off=bin+(bv.byteOffset||0)+(a.byteOffset||0);
   if(a.componentType!==5126)throw new Error('quantised positions');
   for(let k=0;k<a.count;k++){const p=xf([dv.getFloat32(off+k*st,true),dv.getFloat32(off+k*st+4,true),dv.getFloat32(off+k*st+8,true)]);out.push(p[0]*s,p[1]*s,p[2]*s);}
  }
  (n.children||[]).forEach(c=>walk(c,xf));
 };
 for(const r of j.scenes[j.scene||0].nodes)walk(r,null);
 return out;
}
// a made-up man (box surfaces, sampled; z is across the rod): narrow legs, a wide hip block that stops dead at 4.4, a thin waist, a broad torso, a small head
const FM=wz=>[[-0.6,1.0,0.1,3,0.7],[-1.0,1.4,3,4.4,1.6],[-0.4,0.6,4.4,6,0.6],[-1,1.5,6,8,wz],[-0.9,0.9,8,10.5,0.9]];
function fakeMan(wz){
 const pts=[];
 for(const b of FM(wz))for(let i=0;i<=4;i++)for(let j=0;j<=4;j++)for(let k=0;k<=4;k++)
  pts.push(b[0]+(b[1]-b[0])*i/4,b[2]+(b[3]-b[2])*j/4,-b[4]+2*b[4]*k/4);
 return pts;
}
// is (x,y,z) inside the loft of these rings (same wobble seeds as iceTris)?
const _loft=new Map();
function inLoft(X,rings,seed,x,y,z){
 let R=_loft.get(rings);
 if(!R||R.seed!==seed){R=rings.map((r,j)=>X.iceRing(r,seed+j*13.7));R.seed=seed;_loft.set(rings,R);}
 for(let j=0;j+1<rings.length;j++){
  const y0=rings[j].y,y1=rings[j+1].y;
  if(y<y0||y>y1)continue;
  const t=y1>y0?(y-y0)/(y1-y0):0,poly=R[j].map((p,i)=>[p[0]+(R[j+1][i][0]-p[0])*t,p[2]+(R[j+1][i][2]-p[2])*t]);
  let c=false;
  for(let i=0,k=poly.length-1;i<poly.length;k=i++){
   const a=poly[i],b=poly[k];
   if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])c=!c;
  }
  return c;
 }
 return false;
}
function volume(T){let v=0;for(let i=0;i<T.length;i+=9){
 const ax=T[i],ay=T[i+1],az=T[i+2],bx=T[i+3],by=T[i+4],bz=T[i+5],cx=T[i+6],cy=T[i+7],cz=T[i+8];
 v+=(ax*(by*cz-bz*cy)-ay*(bx*cz-bz*cx)+az*(bx*cy-by*cx))/6;}return v;}

// --- a stub table: 8 rods, 1-2-5-3 a side, interleaved ---
function table(X){
 const defs=[[-52.5,0,1],[-37.5,0,2],[-22.5,1,3],[-7.5,0,5],[7.5,1,5],[22.5,0,3],[37.5,1,2],[52.5,1,1]],sp={2:24,3:18.5,5:11.9},out=[];
 defs.forEach((d,idx)=>{
  const n=d[2],pivot=new X.THREE.Group(),baseZ=[],men=[];
  pivot.position.set(d[0],X.ROD_H,0);
  for(let i=0;i<n;i++){baseZ.push(n===1?0:(i-(n-1)/2)*sp[n]);men.push({visible:true});}
  out.push({idx,x:d[0],team:d[1],men,baseZ,pivot,offset:0,removedUntil:[]});
 });
 return out;
}
function figure(X,pts,s){
 const sc=s||1;
 return {updateMatrixWorld(){},traverse(cb){cb({isMesh:true,geometry:{attributes:{position:{count:pts.length/3,array:Float32Array.from(pts)}}},matrixWorld:X.ID});},_s:sc};
}

function reset(X){
 X.S.phase='play';X.S.time=0;X.S.eff[0].frozen=0;X.S.eff[1].frozen=0;X.cfg.particles=true;X.FXON=true;
 X.log.au.length=0;X.log.cf.length=0;X.log.sp.length=0;X.log.bl.length=0;X.log.bu.length=0;
 X.iceClear();
}
const shown=(X,t)=>{let n=0;for(const r of X.rods)if(r.team===t)for(const it of r.ice)if(it.g.visible)n++;return n;};
const MEN=11;

function suite(X){
 const P=X.IC.fit,Fb=X.iceFoot();
 /* 1. the fit: a synthetic man */
 const man=fakeMan(1.5),F=X.iceBands(man,P.bands),rings=X.iceRings(F,P);
 ok(near(F.top,10.5)&&F.b.length===P.bands,'the figure is sliced into bands up to its height');
 ok(F.b.every(q=>q.x0<=q.x1&&q.z0<=q.z1),'no band is empty after the fill');
 ok(rings.length===P.bands+2,'a ring per band edge plus the wall above the head');
 ok(rings.every((r,j)=>j===0||r.y>rings[j-1].y),'the rings climb');
 const pitchY=-(X.ROD_H+X.PLAYER_H);
 ok(near(rings[0].y,pitchY+P.gap)&&rings[0].y>pitchY,'the base floats just off the pitch, never under it');
 ok(near(rings[rings.length-1].y,F.top+P.top),'the wall goes up past the head');
 for(const sd of [1,32,8]){
  let miss=0;
  for(let i=0;i<man.length;i+=3)if(!inLoft(X,rings,sd,man[i],man[i+1],man[i+2]))miss++;
  ok(miss===0,'every point of the figure is inside the block (seed '+sd+', '+miss+' outside)');
 }
 // the physical foot box at rest
 let fmiss=0;
 for(const x of [Fb.x0,Fb.x1])for(const y of [Fb.y0+0.05,Fb.y1-0.05])for(const z of [-Fb.z,Fb.z])if(!inLoft(X,rings,1,x,Math.max(y,rings[0].y+0.01),z))fmiss++;
 ok(fmiss===0,'the physical foot box is inside the block ('+fmiss+' corners out)');
 // snug where the ball reaches: each ring is the wider of the two bands it joins (and the foot box) plus exactly the low padding
 const dyb=F.top/P.bands;let snugN=0,snugBad=0;
 rings.forEach((r,j)=>{
  if(r.y>=P.zone||j>P.bands)return;
  let zh=0;for(const k of [Math.max(0,j-1),Math.min(P.bands-1,j)]){
   zh=Math.max(zh,Math.abs(F.b[k].z0),Math.abs(F.b[k].z1));
   if((k+1)*dyb>Fb.y0&&k*dyb<Fb.y1)zh=Math.max(zh,Fb.z);
  }
  snugN++;if(!near(r.z1,zh+P.pad[0],1e-9))snugBad++;
 });
 ok(snugN>=4,'there are rings in the ball zone ('+snugN+')');
 ok(snugBad===0,'in the ball zone the block is the figure plus the low padding, no looser ('+snugBad+' rings off)');
 const hip=rings.find(r=>r.y>4.3&&r.y<4.5);
 ok(hip&&near(hip.z1,1.6+P.pad[0],1e-9),'the hip block gets only the snug padding');
 const body=rings.find(r=>r.y>=8&&r.y<9);
 ok(body&&body.z1>=1.5+P.pad[1]-1e-9,'up in the body it clears the torso by the high padding');
 ok(rings.every(r=>r.z1<=P.maxHalfZ+1e-9),'never wider across the rod than maxHalfZ');
 const wide=X.iceRings(X.iceBands(fakeMan(4.9),P.bands),P);
 ok(wide.every(r=>r.z1<=P.maxHalfZ+1e-9)&&wide.some(r=>near(r.z1,P.maxHalfZ)),'a figure wider than the cap is held to it');
 ok(rings.every(r=>r.c>=P.chamfer[0]-1e-9&&r.c<=P.chamfer[1]+1e-9),'chamfers stay in their range');

 /* 2. the mesh */
 const T0=X.iceTris(rings,1,P),T1=X.iceTris(rings,8,P);
 ok(T0.length%9===0&&T0.length/9>100&&T0.length/9<400,'a block is a few hundred triangles ('+T0.length/9+')');
 ok(volume(T0)>0&&volume(T1)>0,'the shell is wound outward (positive volume)');
 let figV=0;for(const b of FM(1.5))figV+=(b[1]-b[0])*(b[3]-b[2])*2*b[4];
 ok(volume(T0)>figV,'the block holds more than the figure ('+volume(T0).toFixed(0)+' > '+figV.toFixed(0)+')');
 let degen=0;for(let i=0;i<T0.length;i+=9){
  const e1=[T0[i+3]-T0[i],T0[i+4]-T0[i+1],T0[i+5]-T0[i+2]],e2=[T0[i+6]-T0[i],T0[i+7]-T0[i+1],T0[i+8]-T0[i+2]];
  const n=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]];
  if(Math.hypot(n[0],n[1],n[2])<1e-9)degen++;}
 ok(degen===0,'no zero-area triangles ('+degen+')');
 ok(T0.length===T1.length&&T0.some((v,i)=>Math.abs(v-T1[i])>1e-6),'two seeds: the same size, a different shape');
 const g=X.iceMake(T0);
 ok(g.attributes.position.count===T0.length/3&&g.attributes.normal.count===g.attributes.position.count&&g.attributes.uv.count===g.attributes.position.count,'position, normal and uv line up');
 ok(g.boundingBox&&g.boundingBox.max.y>F.top+P.top,'the box reaches the crystals on the roof');
 let nbad=0;for(let i=0;i<g.attributes.normal.array.length;i+=3)if(!near(Math.hypot(g.attributes.normal.array[i],g.attributes.normal.array[i+1],g.attributes.normal.array[i+2]),1,1e-4))nbad++;
 ok(nbad===0,'every normal is a unit vector');

 /* 3. every shipped figurine, from its real vertices */
 const models=X.CONFIG.playerModel.models;let seen=0,tooWide=[],out=[],tall=[],footOut=[];
 for(const m of models){
  const f='assets/'+m.src.split('/').pop();
  if(!fs.existsSync(f))continue;
  let pts=GLB.get(f);
  if(!pts){try{const all=glbPoints(f,m.scale),k=Math.max(1,Math.floor(all.length/3/2500));pts=[];for(let i=0;i<all.length;i+=3*k)pts.push(all[i],all[i+1],all[i+2]);}catch(e){continue;}GLB.set(f,pts);}
  seen++;
  const FF=X.iceBands(pts,P.bands),rr=X.iceRings(FF,P);
  let zmax=0;for(let i=2;i<pts.length;i+=3)zmax=Math.max(zmax,Math.abs(pts[i]));
  if(zmax+P.pad[0]>P.maxHalfZ)tooWide.push(m.id+' '+zmax.toFixed(2));
  let miss=0;for(let i=0;i<pts.length;i+=3)if(!inLoft(X,rr,1,pts[i],Math.max(pts[i+1],rr[0].y+1e-4),pts[i+2]))miss++;
  if(miss)out.push(m.id+' '+miss);
  if(FF.top+P.top+P.roof+P.spike[1]>16)tall.push(m.id);
  let fm=0;for(const x of [Fb.x0,Fb.x1])for(const y of [Fb.y0+0.05,Fb.y1-0.05])for(const z of [-Fb.z,Fb.z])if(!inLoft(X,rr,1,x,Math.max(y,rr[0].y+0.01),z))fm++;
  if(fm)footOut.push(m.id);
 }
 ok(seen>=20,'the shipped figurine files were read ('+seen+')');
 ok(tooWide.length===0,'no figurine is wider than the cap allows: '+tooWide.join(', '));
 ok(out.length===0,'every vertex of every figurine is inside its block: '+out.join(', '));
 ok(tall.length===0,'no block rises past 16 units: '+tall.join(', '));
 ok(footOut.length===0,'the foot box is inside every figurine\'s block: '+footOut.join(', '));

 /* 4. the module on a stub table */
 const mk=()=>{
  X.rods=table(X);X.playerModel[0]=figure(X,fakeMan(1.5));X.playerModel[1]=figure(X,fakeMan(1.5));
  X.ICE.built=false;X.ICE.key=['',''];X.ICE.geo=[[],[]];X.SCENEADDS=0;X.log.adds.length=0;
  X.iceUpdate(0.016);reset(X);
 };
 mk();
 ok(X.ICE.built&&X.rods.every(r=>r.ice&&r.ice.length===r.men.length),'every man has a block');
 ok(X.rods.reduce((n,r)=>n+r.ice.length,0)===22,'22 men, 22 blocks');
 ok(X.rods.every(r=>r.ice.every((it,mi)=>it.g.parent===r.pivot&&near(it.g.position.y,X.PLAYER_H)&&near(it.g.position.z,r.baseZ[mi]))),'each block hangs on its rod\'s pivot at its man\'s place');
 ok(X.rods.every(r=>r.ice.every(it=>it.g.visible===false)),'all of them are hidden until frost lands');
 ok(X.rods.every(r=>r.ice.every(it=>it.g.rotation.y===(r.team===1?Math.PI:0))),'the team facing is the figurine\'s');
 ok(X.SCENEADDS===1&&X.log.scene[0]===X.ICE.sh.mesh,'the one thing added to the scene is the chunk mesh (no light, no block)');
 ok(X.ICE.sh.mesh.visible===false&&X.ICE.sh.mesh.castShadow===false&&X.ICE.sh.mesh.instanceMatrix.array.length===16*X.IC.shards.max,'hidden and out of the shadow pass until something breaks');
 ok(X.rods.every(r=>r.ice.every(it=>it.front.castShadow===false&&it.back.castShadow===false&&it.front.receiveShadow===false)),'ice never enters the shadow pass');
 ok(X.rods.every(r=>r.ice.every(it=>it.front.geometry===it.back.geometry)),'front and back draw one geometry');
 ok(X.ICE.geo[0].length===P.variants&&X.rods.some(r=>r.ice.some(it=>it.v!==r.ice[0].v)),'the men take different shapes');
 {const A=X.ICE.geo[0][0].attributes.position.array,B=X.ICE.geo[0][1].attributes.position.array;
  ok(A.length===B.length&&A.some((v,i)=>Math.abs(v-B[i])>1e-6),'and the variants really are different blocks');}
 ok(X.ICE.mat[0]!==X.ICE.mat[1]&&X.ICE.mat[0].f.side===0&&X.ICE.mat[0].b.side===1,'a front and a back material per team');
 ok(X.ICE.mat[0].f.transparent===true&&X.ICE.mat[0].f.depthWrite===false,'the ice is transparent and does not write depth');
 X.iceUpdate(0.016);
 ok(X.rods.every(r=>r.ice.every(it=>it.g.visible===false))&&X.log.au.length===0,'an idle frame shows nothing and plays nothing');

 /* 5. frost lands on team 1 */
 reset(X);
 X.S.eff[1].frozen=X.S.time+8;
 X.iceUpdate(0.016);
 ok(shown(X,1)===MEN&&shown(X,0)===0,'frost on team 1 blocks its 11 men and nobody else');
 ok(X.log.au.join()==='ice_form','the form sound plays once');
 const it0=X.rods.find(r=>r.team===1).ice[0];
 ok(it0.g.scale.y<1&&it0.g.scale.y>0,'a block starts small and grows');
 for(let i=0;i<30;i++)X.iceUpdate(0.016);
 ok(near(it0.g.scale.y,1,1e-6)&&near(it0.g.scale.x,1,1e-6),'and is full size after the grow time');
 ok(X.log.au.length===1,'no second form sound while it holds');
 ok(X.log.bl.length===MEN,'a puff of mist at every man as it forms ('+X.log.bl.length+')');
 ok(near(X.ICE.mat[1].f.opacity,X.IC.opacity)&&near(X.ICE.mat[1].b.opacity,X.IC.back),'the opacity holds at its value while the frost is fresh');
 const sp0=X.log.sp.length;for(let i=0;i<120;i++)X.iceUpdate(0.016);
 ok(X.log.sp.length>sp0+4,'glints twinkle on it over a couple of seconds');
 ok(X.log.sp.slice(sp0).every(p=>p.flags===2),'a glint is a still twinkle');

 /* 6. the last seconds */
 reset(X);X.S.eff[1].frozen=3;X.S.time=0;
 X.iceUpdate(0.016);
 let lo=9,hi=0,em=0;
 for(let k=0;k<60;k++){X.S.time=1.5+k*0.01;X.iceUpdate(0.016);const o=X.ICE.mat[1].f.opacity;lo=Math.min(lo,o);hi=Math.max(hi,o);em=Math.max(em,X.ICE.mat[1].f.emissiveIntensity);}
 ok(lo<X.IC.opacity-0.02&&lo>=X.IC.opacity*0.6-1e-9,'inside the warning it flickers, but never below 60% of its opacity ('+lo.toFixed(3)+')');
 ok(hi<=X.IC.opacity+1e-9,'and never above it');
 ok(em>X.IC.glowK*1.05,'it glows hotter in the warning');

 /* 7. the frost runs out */
 reset(X);X.S.eff[1].frozen=5;
 X.iceUpdate(0.016);for(let i=0;i<20;i++)X.iceUpdate(0.016);
 X.log.cf.length=0;X.log.au.length=0;X.ICE.sh.list.forEach(c=>c.on=false);
 X.S.time=5.001;X.iceUpdate(0.016);
 ok(shown(X,1)===0,'every block is gone');
 const H=X.ICE.sh,alive=()=>H.list.filter(c=>c.on);
 ok(alive().length===MEN*X.IC.shatter.pieces,'each block throws its chunks ('+alive().length+')');
 ok(H.mesh.visible===true,'and the chunk mesh wakes');
 ok(X.log.cf.length===0,'no paper confetti');
 ok(X.log.au.join()==='ice_break','one break sound for the team');
 const near1=c=>X.rods.some(r=>r.team===1&&r.baseZ.some(bz=>Math.hypot(c.x-r.x,c.z-(r.offset+bz))<7));
 ok(alive().every(near1),'every chunk starts at one of the frozen team men');
 ok(alive().every(c=>c.y>0.5),'chunks start up in the block, not on the floor');
 ok(alive().every(c=>c.vy>0&&Math.hypot(c.vx,c.vz)>0),'and are thrown up and out');
 ok(X.log.bl.some(b=>b.kind===2)&&X.log.bl.some(b=>b.kind===0)&&!X.log.bl.some(b=>b.kind===1),'a flash and mist go with it, and no ring on the pitch');
 ok(X.log.sp.length>=MEN*X.IC.shatter.glints,'with glints');
 {
  let minY=9,maxX=0,maxZ=0,bad=0,rested=0,t=0;
  for(let i=0;i<260;i++){
   X.iceUpdate(0.016);t+=0.016;
   for(const c of H.list)if(c.on){minY=Math.min(minY,c.y);maxX=Math.max(maxX,Math.abs(c.x));maxZ=Math.max(maxZ,Math.abs(c.z));if(!isFinite(c.x+c.y+c.z))bad++;}
   if(Math.abs(t-1.2)<0.009)rested=alive().filter(c=>c.y<1.2).length;
  }
  const A=H.mesh.instanceMatrix.array;let nan=0;for(let i=0;i<A.length;i++)if(!isFinite(A[i]))nan++;
  ok(minY>=0.1&&bad===0&&nan===0,'chunks never go through the pitch or turn to NaN (lowest '+minY.toFixed(2)+')');
  ok(maxX<=X.F.L/2&&maxZ<=X.F.W/2,'and stay on the table');
  ok(rested>=MEN*X.IC.shatter.pieces*0.4,'by 1.2 s many of them lie on the pitch ('+rested+')');
  ok(alive().length===0&&H.mesh.visible===false,'after a few seconds they are gone and the mesh sleeps');
 }
 X.iceUpdate(0.016);ok(X.log.cf.length===0&&alive().length===0,'it shatters once');

 /* 8. let go without a shatter */
 reset(X);X.S.eff[1].frozen=9;X.iceUpdate(0.016);X.iceUpdate(0.016);
 X.log.cf.length=0;X.log.au.length=0;X.S.eff[1].frozen=0;X.iceClear();X.iceUpdate(0.016);
 ok(shown(X,1)===0&&X.log.cf.length===0&&X.log.au.length===0,'a match start (frost reset, then a clear) hides it with no shatter and no sound');
 X.iceUpdate(0.016);ok(X.log.cf.length===0,'and nothing shatters late');
 reset(X);X.S.eff[1].frozen=9;X.iceUpdate(0.016);X.iceUpdate(0.016);X.log.cf.length=0;X.log.au.length=0;
 X.S.phase='menu';X.iceUpdate(0.016);
 ok(shown(X,1)===0&&X.log.cf.length===0&&X.log.au.length===0,'back at the menu: gone with no shatter');
 X.S.phase='play';X.S.eff[1].frozen=0;X.iceUpdate(0.016);ok(X.log.cf.length===0,'and none later');
 reset(X);X.S.eff[1].frozen=3;X.iceUpdate(0.016);X.S.time=3.01;X.iceUpdate(0.016);
 ok(X.ICE.sh.list.some(c=>c.on)&&X.ICE.sh.mesh.visible,'chunks in the air...');
 X.S.eff[1].frozen=0;X.iceClear();
 ok(!X.ICE.sh.list.some(c=>c.on)&&X.ICE.sh.mesh.visible===false,'...are taken by a match start');

 /* 9. a replay */
 reset(X);X.S.eff[1].frozen=9;X.iceUpdate(0.016);X.iceUpdate(0.016);
 X.log.cf.length=0;X.log.au.length=0;X.log.bl.length=0;
 X.S.phase='replay';X.iceUpdate(0.016);
 ok(shown(X,1)===0&&X.log.cf.length===0,'a replay hides the blocks and does not shatter them');
 X.S.phase='play';X.iceUpdate(0.016);
 ok(shown(X,1)===MEN&&X.log.au.length===0&&X.log.bl.length===0,'they come back after it with no second form sound or burst');

 /* 10. a cannonball takes a man */
 reset(X);X.S.eff[1].frozen=9;X.iceUpdate(0.016);for(let i=0;i<30;i++)X.iceUpdate(0.016);
 X.log.cf.length=0;
 const rm=X.rods.find(r=>r.team===1&&r.men.length===5);
 rm.removedUntil[2]=X.S.time+5;rm.men[2].visible=false;
 X.iceUpdate(0.016);
 ok(rm.ice[2].g.visible===false&&shown(X,1)===MEN-1,'the man who was hit loses his block, the rest keep theirs');
 ok(X.ICE.sh.list.filter(c=>c.on).length===X.IC.shatter.pieces,'and only his shatters ('+X.ICE.sh.list.filter(c=>c.on).length+')');
 X.iceUpdate(0.016);ok(rm.ice[2].g.visible===false,'it stays off while he is gone');
 rm.removedUntil[2]=0;rm.men[2].visible=true;X.iceUpdate(0.016);
 ok(rm.ice[2].g.visible===true&&rm.ice[2].g.scale.y<1,'it forms again when he is back and the frost still holds');

 /* 11. particles off */
 reset(X);X.cfg.particles=false;X.FXON=true;X.S.eff[1].frozen=5;
 X.iceUpdate(0.016);for(let i=0;i<10;i++)X.iceUpdate(0.016);
 ok(shown(X,1)===MEN,'the block shows with particles off');
 X.log.cf.length=0;X.log.sp.length=0;X.log.bl.length=0;X.S.time=5.01;X.iceUpdate(0.016);
 ok(X.ICE.sh.list.every(c=>!c.on)&&X.log.sp.length===0&&X.log.bl.length===0,'but no chunks, glints or mist are spawned');
 ok(X.log.bu.length===MEN,'the old square-point burst stands in ('+X.log.bu.length+')');
 reset(X);X.FXON=false;X.S.eff[1].frozen=5;X.iceUpdate(0.016);X.iceUpdate(0.016);X.log.bu.length=0;X.S.time=5.01;X.iceUpdate(0.016);
 ok(X.log.cf.length===0&&X.log.bu.length===MEN,'vfx off behaves the same');

 /* 12. both teams at once */
 reset(X);X.S.eff[0].frozen=3;X.S.eff[1].frozen=10;X.iceUpdate(0.016);
 ok(shown(X,0)===MEN&&shown(X,1)===MEN,'both teams can wear it at once');
 X.S.time=1.5;X.iceUpdate(0.016);
 ok(X.ICE.mat[0].f.opacity<=X.IC.opacity&&X.ICE.mat[1].f.opacity===X.IC.opacity,'team 0\'s flicker does not touch team 1');
 X.log.cf.length=0;X.S.time=3.01;X.iceUpdate(0.016);
 ok(shown(X,0)===0&&shown(X,1)===MEN&&X.ICE.sh.list.filter(c=>c.on).length===MEN*X.IC.shatter.pieces,'team 0 shatters while team 1 holds');

 /* 13. frost picked up again while frozen */
 reset(X);X.S.eff[1].frozen=4;X.iceUpdate(0.016);for(let i=0;i<60;i++)X.iceUpdate(0.016);
 const k0=X.ICE.mat[1].u.uIceK.value;
 X.log.au.length=0;X.S.eff[1].frozen=12;X.iceUpdate(0.016);
 ok(X.ICE.mat[1].u.uIceK.value>k0+0.5,'a second pickup pulses the edge light');
 ok(X.log.au.length===0&&shown(X,1)===MEN,'without a second form');

 /* 14. a different figurine, a different scale */
 reset(X);
 const old=X.ICE.geo[1].slice(),oldTop=X.ICE.fit[1].top;
 X.playerModel[1]=figure(X,fakeMan(2.4));X.cfg.blueScale=1.25;
 X.iceUpdate(0.016);
 ok(X.ICE.geo[1].every((g,i)=>g!==old[i])&&old.every(g=>g.disposed),'a new scale refits team 1 and frees the old shapes');
 ok(X.ICE.fit[1].top>oldTop*1.2,'the block is as tall as the bigger figurine ('+X.ICE.fit[1].top.toFixed(2)+' vs '+oldTop.toFixed(2)+')');
 ok(X.rods.filter(r=>r.team===1).every(r=>r.ice.every(it=>it.front.geometry===X.ICE.geo[1][it.v]&&it.back.geometry===it.front.geometry)),'every man of team 1 hangs the new shape');
 ok(X.rods.filter(r=>r.team===0).every(r=>r.ice.every(it=>X.ICE.geo[0].indexOf(it.front.geometry)>=0)),'team 0 is left alone');
 X.cfg.blueScale=1;

 /* 15. chunks thrown at the walls */
 reset(X);
 X.iceChunkSpawn(X.F.L/2-3,3,0,70,6,0);X.iceChunkSpawn(-(X.F.L/2-3),3,0,-70,6,0);
 X.iceChunkSpawn(0,3,X.F.W/2-3,0,6,70);X.iceChunkSpawn(0,3,-(X.F.W/2-3),0,6,-70);
 {
  let mx=0,mz=0;
  for(let i=0;i<90;i++){X.iceUpdate(0.016);for(const c of X.ICE.sh.list)if(c.on){mx=Math.max(mx,Math.abs(c.x));mz=Math.max(mz,Math.abs(c.z));}}
  ok(mx<=X.F.L/2&&mx>X.F.L/2-3,'a chunk thrown at an end wall is held on the table and does reach it ('+mx.toFixed(1)+')');
  ok(mz<=X.F.W/2&&mz>X.F.W/2-3,'and at a side wall ('+mz.toFixed(1)+')');
 }

 /* 16. rods rebuilt */
 const keep=X.rods;X.rods=table(X);X.iceUpdate(0.016);
 ok(X.ICE.built===false,'new rods are noticed');
 X.iceUpdate(0.016);
 ok(X.ICE.built&&X.rods.every(r=>r.ice&&r.ice.length===r.men.length),'and dressed on the next frame');
 X.rods=keep;
}

function run(src){const X=boot(src);pass=0;fail=0;fails.length=0;suite(X);return {pass,fail,fails:fails.slice()};}

const SRC=rd('js/ice.js');
const base=run(SRC);
console.log('ice harness: '+base.pass+' assertions, '+base.fail+' failing');
for(const f of base.fails)console.log('  FAIL '+f);

/* mutations: each must break something */
function mutate(from,to,label){
 if(!SRC.includes(from)){console.log('  MUTATION ANCHOR DRIFTED: '+label);return {broke:false,drift:true};}
 let r;try{r=run(SRC.replace(from,to));}catch(e){return {broke:true};}
 return {broke:r.fail>base.fail};
}
const MUT=[
 ['if(fb&&y1>fb.y0&&y0<fb.y1)','if(false&&fb&&y1>fb.y0&&y0<fb.y1)','the foot box is ignored'],
 ['const a=e[clamp(j-1,0,nb-1)],b=e[clamp(j,0,nb-1)]','const a=e[clamp(j,0,nb-1)],b=e[clamp(j,0,nb-1)]','a ring only covers the band above it'],
 ['pad=lerp(P.pad[0],P.pad[1],u)','pad=0','no padding'],
 ['pad=lerp(P.pad[0],P.pad[1],u)','pad=P.pad[1]','the block is as loose at the feet as at the head'],
 ['const quad=(a,b,c,d)=>{tri(a,d,c);tri(a,c,b);};','const quad=(a,b,c,d)=>{tri(a,c,d);tri(a,b,c);};','the walls are wound inward'],
 ['zh=Math.min(lerp(zh,Math.max(zh,wz),k)+pad,P.maxHalfZ);','zh=lerp(zh,Math.max(zh,wz),k)+pad;','no width cap'],
 ['gy=-(ROD_H+PLAYER_H)+P.gap','gy=-(ROD_H+PLAYER_H)-1','the base sinks into the pitch'],
 ['iceStop(t,T,live);','iceStop(t,T,false);','expiry does not shatter'],
 ['T.live=false;T.age=0;T.pulse=0;}','T.age=0;T.pulse=0;}','a clear leaves the team marked live'],
 ['it.g.visible=!hide;','it.g.visible=true;','a replay shows the blocks'],
 ['alive=(!ru||ru<=S.time)&&r.men[mi].visible;','alive=true;','a removed man keeps his block'],
 ["const hide=S.phase==='replay',live=S.phase!=='menu';","const hide=S.phase==='replay',live=true;",'the menu keeps the frost'],
 ['it.g.scale.set(lerp(0.72,1,k),lerp(0.2,1,k),lerp(0.72,1,k));','it.g.scale.set(1,1,1);','blocks pop in'],
 ['m.f.opacity=IC.opacity*(1-0.4*w*f);','m.f.opacity=IC.opacity;','no flicker in the last seconds'],
 ["Au.play('ice_form');",'','no form sound'],
 ["if(fx)Au.play('ice_break');",'','no break sound'],
 ['iceMake(iceTris(rings,t*31+v*7+1,P))','iceMake(iceTris(rings,t*31+1,P))','every shape is the same'],
 ["s.toFixed(3)+'|'","'x|'",'a rescale is not noticed'],
 ['if(e.frozen>T.until+0.5)T.pulse=1;','','a second pickup is silent'],
 ['return typeof vfxLive===\'function\'&&vfxLive()&&cfg.particles;','return typeof vfxLive===\'function\'&&vfxLive();','particles off still spawns'],
 ['if(T.glint<=0){T.glint=IC.glint.every*rand(0.6,1.5);iceGlint(t);}','','no glints'],
 ['.applyMatrix4(mw);\n  let dx=_icV.x-cx','\n  let dx=_icV.x-cx','shards start at the origin'],
 ['if(s.y<fl){','if(false){','chunks fall through the pitch'],
 ['if(s.x>xm){s.x=xm;s.vx=-Math.abs(s.vx)*0.5;}else if(s.x<-xm){s.x=-xm;s.vx=Math.abs(s.vx)*0.5;}','','chunks leave the table'],
 ['H.mesh.visible=live>0;','H.mesh.visible=true;','the chunk mesh never sleeps'],
 ['H.live++;H.mesh.visible=true;','','a spawn does not wake the mesh'],
 ['iceChunksClear();\n for(let t=0;t<2;t++)','for(let t=0;t<2;t++)','a clear leaves chunks in the air'],
 ['else if(!alive&&it.vis)iceShatter(r,mi,it,true);','else if(!alive&&it.vis){it.vis=false;it.g.visible=false;}','a hit man\'s block just vanishes'],
 ['back.castShadow=back.receiveShadow=front.castShadow=front.receiveShadow=false;','','ice casts shadows'],
 ['const u=iceSm((y-P.zone)/P.ramp)','const u=1','the block is loose in the ball zone'],
];
let survived=0;
for(const [a,b,label] of MUT){
 const m=mutate(a,b,label);if(!m.broke){survived++;console.log('  SURVIVED: '+label+(m.drift?' (anchor)':''));}
}
const N=MUT.length;
console.log('mutations: '+(N-survived)+'/'+N+' caught');
process.exit(base.fail||survived?1:0);
