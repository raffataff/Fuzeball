/* Behavioural harness for js/props.js — the scatter + instancing math.
   No three.js and no browser: the pure functions are string-sliced out and rebuilt
   with new Function, and the build path runs against minimal Matrix4/InstancedMesh
   stand-ins that record what was asked of them.
   Run: node tools/props-harness.js                                              */
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const SRC=fs.readFileSync(path.join(ROOT,'js/props.js'),'utf8');

function slice(name){
 const s=SRC.indexOf('function '+name+'(');
 if(s<0)throw new Error('not found: '+name);
 let d=0;
 for(let j=SRC.indexOf('{',s);j<SRC.length;j++){const c=SRC[j];
  if(c==='{')d++;else if(c==='}'){d--;if(!d)return SRC.slice(s,j+1);}}
 throw new Error('unbalanced: '+name);
}
const S_RNG=slice('propRng'), S_PLACE=slice('propPlacements'),
      S_BUILD=slice('propBuildSpec'), S_FLAT=slice('propFlatten');

/* ---- 4x4 stand-in, column-major like three.js ---------------------------- */
function M4(){this.e=[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];}
M4.prototype.set=function(a){this.e=a.slice();return this;};
M4.prototype.clone=function(){return new M4().set(this.e);};
M4.prototype.makeScale=function(x,y,z){return this.set([x,0,0,0, 0,y,0,0, 0,0,z,0, 0,0,0,1]);};
M4.prototype.makeTranslation=function(x,y,z){return this.set([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]);};
M4.prototype.makeRotationY=function(a){const c=Math.cos(a),s=Math.sin(a);
 return this.set([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);};
M4.prototype.multiplyMatrices=function(A,B){const a=A.e,b=B.e,r=new Array(16);
 for(let c=0;c<4;c++)for(let rw=0;rw<4;rw++){let v=0;
  for(let k=0;k<4;k++)v+=a[k*4+rw]*b[c*4+k];r[c*4+rw]=v;}
 this.e=r;return this;};
M4.prototype.premultiply=function(A){return this.multiplyMatrices(A,this.clone());};
M4.prototype.compose=function(p,q,s){
 // quaternion -> rotation, then scale columns, then translation
 const{x,y,z,w}=q,x2=x+x,y2=y+y,z2=z+z;
 const xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2,wx=w*x2,wy=w*y2,wz=w*z2;
 this.e=[(1-(yy+zz))*s.x,(xy+wz)*s.x,(xz-wy)*s.x,0,
         (xy-wz)*s.y,(1-(xx+zz))*s.y,(yz+wx)*s.y,0,
         (xz+wy)*s.z,(yz-wx)*s.z,(1-(xx+yy))*s.z,0,
         p.x,p.y,p.z,1];
 return this;};
const mpos=m=>({x:m.e[12],y:m.e[13],z:m.e[14]});
const mscale=m=>Math.hypot(m.e[0],m.e[1],m.e[2]);

function V3(x,y,z){this.x=x||0;this.y=y||0;this.z=z||0;}
V3.prototype.set=function(x,y,z){this.x=x;this.y=y;this.z=z;return this;};
function Quat(){this.x=0;this.y=0;this.z=0;this.w=1;}
Quat.prototype.setFromEuler=function(e){const c=Math.cos(e._y/2),s=Math.sin(e._y/2);
 this.x=0;this.y=s;this.z=0;this.w=c;return this;};      // yaw-only is all the build path uses
function Eul(){this._x=0;this._y=0;this._z=0;}
Eul.prototype.set=function(x,y,z){this._x=x;this._y=y;this._z=z;return this;};
function Col(){this.hex=null;}
Col.prototype.set=function(h){this.hex=h;return this;};

const INSTANCED=[];
function InstancedMesh(geo,mat,count){
 this.geometry=geo;this.material=mat;this.count=count;this.mats=new Array(count);
 this.cols=new Array(count);this.userData={};this.visible=true;
 this.instanceMatrix={needsUpdate:false};this.instanceColor=null;
 INSTANCED.push(this);
}
InstancedMesh.prototype.setMatrixAt=function(i,m){this.mats[i]=m.clone();};
InstancedMesh.prototype.setColorAt=function(i,c){this.cols[i]=c.hex;
 if(!this.instanceColor)this.instanceColor={needsUpdate:false};};
InstancedMesh.prototype.dispose=function(){this.disposed=true;};
function Group(){this.children=[];this.userData={};this.visible=true;
 this.add=function(o){this.children.push(o);};this.clear=function(){this.children.length=0;};}
function Box3(){this.min=new V3(0,0,0);this.max=new V3(1,1,1);}
Box3.prototype.setFromObject=function(o){if(o.__box){this.min=new V3(...o.__box[0]);this.max=new V3(...o.__box[1]);}return this;};
Box3.prototype.getSize=function(v){v.set(this.max.x-this.min.x,this.max.y-this.min.y,this.max.z-this.min.z);return v;};

const THREE={Matrix4:M4,Vector3:V3,Quaternion:Quat,Euler:Eul,Color:Col,
 InstancedMesh,Group,Box3};

let pass=0,fail=0;const fails=[];
function ok(c,m,x){if(c)pass++;else{fail++;fails.push(m+(x!==undefined?'  ['+x+']':''));}}
const near=(a,b,t)=>Math.abs(a-b)<=(t===undefined?1e-9:t);

function build(CONFIG,tpls){
 const ctx={CONFIG,THREE,console:{log(){},warn(){}},propTemplates:tpls||{},renderer:null,scene:null,camera:null};
 const f=new Function('CONFIG','THREE','console','propTemplates',
  S_RNG+'\n'+S_PLACE+'\n'+S_BUILD+'\n'+S_FLAT+
  '\nreturn {propRng,propPlacements,propBuildSpec,propFlatten};');
 return f(ctx.CONFIG,THREE,ctx.console,ctx.propTemplates);
}
const CFG=o=>Object.assign({props:{on:true,maxInstances:2048}},o||{});

/* === 1. seeded rng is deterministic and well-spread ======================= */
{
 const A=build(CFG());
 const a=A.propRng(7),b=A.propRng(7),c=A.propRng(8);
 const sa=[a(),a(),a()],sb=[b(),b(),b()],sc=[c(),c(),c()];
 ok(sa.every((v,i)=>v===sb[i]),'RNG: same seed -> identical stream');
 ok(!sa.every((v,i)=>v===sc[i]),'RNG: different seed -> different stream');
 ok(sa.every(v=>v>=0&&v<1),'RNG: stays in [0,1)');
 const r=A.propRng(3);let s=0,n=20000;for(let i=0;i<n;i++)s+=r();
 ok(Math.abs(s/n-0.5)<0.02,'RNG: mean ~0.5 over 20k',(s/n).toFixed(4));
}

/* === 2. explicit placement ================================================ */
{
 const A=build(CFG());
 const p=A.propPlacements({prop:'x',at:[[1,2,3,0.5,2],[-4,0,5]]},1);
 ok(p.length===2,'AT: one placement per entry');
 ok(p[0].p[0]===1&&p[0].p[1]===2&&p[0].p[2]===3,'AT: position copied');
 ok(p[0].ry===0.5&&p[0].s===2,'AT: yaw + scale copied');
 ok(p[1].ry===0&&p[1].s===1,'AT: omitted yaw/scale default to 0/1');
}

/* === 3. scatter shapes ==================================================== */
{
 const A=build(CFG());
 const ring=A.propPlacements({prop:'x',scatter:{kind:'ring',n:12,r:100,at:[0,5,0]}},1);
 ok(ring.length===12,'RING: n instances');
 ok(ring.every(q=>near(Math.hypot(q.p[0],q.p[2]),100,1e-9)),'RING: every instance on the radius');
 ok(ring.every(q=>q.p[1]===5),'RING: y taken from the centre');
 // face:'in' must point each instance at the centre
 const fin=A.propPlacements({prop:'x',scatter:{kind:'ring',n:8,r:50,face:'in'}},1);
 const bad=fin.filter(q=>{const want=Math.atan2(-q.p[0],-q.p[2]);
  return Math.abs(Math.atan2(Math.sin(q.ry-want),Math.cos(q.ry-want)))>1e-9;});
 ok(bad.length===0,'RING: face:in aims every instance at the centre',bad.length);
 const fout=A.propPlacements({prop:'x',scatter:{kind:'ring',n:4,r:50,face:'out'}},1);
 ok(fout.every((q,i)=>Math.abs(Math.abs(Math.atan2(Math.sin(q.ry-fin[i*2].ry),Math.cos(q.ry-fin[i*2].ry)))-Math.PI)<1e-9),
    'RING: face:out is exactly opposite face:in');
 // rows build a terrace
 const rows=A.propPlacements({prop:'x',scatter:{kind:'ring',n:12,rows:3,r:120,rInner:60,rowRise:10}},1);
 const ys=[...new Set(rows.map(q=>q.p[1]))].sort((a,b)=>a-b);
 ok(ys.length===3&&near(ys[0],0)&&near(ys[1],10)&&near(ys[2],20),'RING: rows terrace upward by rowRise',ys.join(','));
 const rr=[...new Set(rows.map(q=>+Math.hypot(q.p[0],q.p[2]).toFixed(6)))].sort((a,b)=>a-b);
 ok(rr.length===3&&near(rr[0],60,1e-6)&&near(rr[2],120,1e-6),'RING: rows span rInner..r',rr.join(','));
}
{
 const A=build(CFG());
 const g=A.propPlacements({prop:'x',scatter:{kind:'grid',nx:4,nz:3,w:90,d:60}},1);
 ok(g.length===12,'GRID: nx*nz instances');
 ok(Math.min(...g.map(q=>q.p[0]))===-45&&Math.max(...g.map(q=>q.p[0]))===45,'GRID: spans w');
 ok(Math.min(...g.map(q=>q.p[2]))===-30&&Math.max(...g.map(q=>q.p[2]))===30,'GRID: spans d');
 const one=A.propPlacements({prop:'x',scatter:{kind:'grid',nx:1,nz:1,w:90,d:60}},1);
 ok(one.length===1&&one[0].p[0]===0&&one[0].p[2]===0,'GRID: 1x1 sits at the centre, no divide-by-zero');
 const b=A.propPlacements({prop:'x',scatter:{kind:'box',n:200,w:100,d:40,at:[10,0,-5]}},1);
 ok(b.length===200,'BOX: n instances');
 ok(b.every(q=>Math.abs(q.p[0]-10)<=50&&Math.abs(q.p[2]+5)<=20),'BOX: all inside the box');
 const ln=A.propPlacements({prop:'x',scatter:{kind:'line',n:5,a:[0,0,0],b:[40,0,0]}},1);
 ok(ln.length===5&&ln[0].p[0]===0&&ln[4].p[0]===40&&ln[2].p[0]===20,'LINE: evenly spaced end to end');
 ok(A.propPlacements({prop:'x',scatter:{kind:'ring',n:0,r:10}},1).length===0,'SCATTER: n:0 is empty, not a throw');
 ok(A.propPlacements({prop:'x',scatter:{kind:'nonsense',n:5}},1).length===0,'SCATTER: unknown kind yields nothing');
 ok(A.propPlacements({prop:'x'},1).length===0,'SCATTER: no at and no scatter is empty');
}

/* === 4. determinism is the whole point of the seed ======================== */
{
 const A=build(CFG());
 const spec={prop:'x',scatter:{kind:'box',n:60,w:200,d:200},jitter:{x:3,z:3,ry:0.4},scaleVar:0.2,tint:[1,2,3]};
 const a=A.propPlacements(spec,11),b=A.propPlacements(spec,11),c=A.propPlacements(spec,12);
 ok(JSON.stringify(a)===JSON.stringify(b),'SEED: same seed reproduces the layout EXACTLY');
 ok(JSON.stringify(a)!==JSON.stringify(c),'SEED: a different seed rerolls it');
 const d=A.propPlacements(Object.assign({seed:99},spec),11),
       e=A.propPlacements(Object.assign({seed:99},spec),777);
 ok(JSON.stringify(d)===JSON.stringify(e),'SEED: a per-spec seed overrides the room seed');
 ok(a.some(q=>q.tint!==null),'TINT: instances draw from the palette');
 ok(a.every(q=>q.tint===null||[1,2,3].indexOf(q.tint)>=0),'TINT: only palette values are used');
 ok(a.every(q=>Math.abs(q.s-1)<=0.2+1e-12),'SCALEVAR: stays inside the stated variance');
 ok(A.propPlacements({prop:'x',scatter:{kind:'box',n:20,w:10,d:10}},1).every(q=>q.tint===null),
    'TINT: no palette -> null, so instanceColor is never allocated');
}

/* === 5. jitter actually moves things, and only by the stated amount ======= */
{
 const A=build(CFG());
 const base={prop:'x',scatter:{kind:'grid',nx:5,nz:5,w:100,d:100}};
 const flat=A.propPlacements(base,5);
 const jit=A.propPlacements(Object.assign({jitter:{x:2,z:2}},base),5);
 ok(jit.some((q,i)=>q.p[0]!==flat[i].p[0]),'JITTER: displaces instances');
 ok(jit.every((q,i)=>Math.abs(q.p[0]-flat[i].p[0])<=2+1e-12&&Math.abs(q.p[2]-flat[i].p[2])<=2+1e-12),
    'JITTER: never exceeds the stated radius');
 ok(jit.every((q,i)=>q.p[1]===flat[i].p[1]),'JITTER: an axis not named is untouched');
}

/* === 6. build: one InstancedMesh per PART, matrices = place x partLocal === */
{
 const partA=new M4().makeTranslation(0,10,0);          // a mesh sitting 10 up inside the prop
 const partB=new M4().makeTranslation(3,0,0);
 const tpl={chair:{parts:[{geo:'gA',mat:'mA',m:partA},{geo:'gB',mat:'mB',m:partB}]}};
 INSTANCED.length=0;
 const A=build(CFG(),tpl);
 const g=new Group();
 const made=A.propBuildSpec(g,{prop:'chair',at:[[100,0,0,0,1],[0,0,50,0,2]]},1);
 ok(made===2,'BUILD: one InstancedMesh per part',made);
 ok(g.children.length===2,'BUILD: both added to the room group');
 ok(g.children.every(im=>im.count===2),'BUILD: instance count == placement count');
 ok(INSTANCED.length===2,'BUILD: exactly 2 InstancedMesh allocations for 2 parts x 2 places');
 const im0=g.children[0];
 const p0=mpos(im0.mats[0]);
 ok(near(p0.x,100)&&near(p0.y,10)&&near(p0.z,0),
    'BUILD: instance matrix = place x partLocal (part offset survives)',JSON.stringify(p0));
 const p1=mpos(im0.mats[1]);
 ok(near(p1.y,20),'BUILD: a scaled placement scales the part offset too (10 x 2)',p1.y);
 ok(near(mscale(im0.mats[1]),2),'BUILD: placement scale lands on the instance matrix');
 const im1=g.children[1];
 ok(near(mpos(im1.mats[0]).x,103),'BUILD: second part keeps its own local offset');
 ok(im0.instanceMatrix.needsUpdate===true,'BUILD: instanceMatrix flagged for upload');
 ok(im0.userData.propId==='chair','BUILD: instances stamped with their prop id (needed by disposeProp)');
 ok(im0.frustumCulled===false,'BUILD: culling off — one bounds for a whole scatter would cull the edges');
 ok(im0.instanceColor===null,'BUILD: no tint -> no instanceColor buffer allocated');
}
{ // yaw must rotate the part offset, not just the origin
 const tpl={x:{parts:[{geo:'g',mat:'m',m:new M4().makeTranslation(0,0,10)}]}};
 INSTANCED.length=0;
 const A=build(CFG(),tpl);const g=new Group();
 A.propBuildSpec(g,{prop:'x',at:[[0,0,0,Math.PI/2,1]]},1);
 const p=mpos(g.children[0].mats[0]);
 ok(near(p.x,10,1e-9)&&near(p.z,0,1e-9),'BUILD: placement yaw rotates the part offset',JSON.stringify(p));
}
{ // tint path allocates instanceColor and records the palette entry
 const tpl={x:{parts:[{geo:'g',mat:'m',m:new M4()}]}};
 INSTANCED.length=0;
 const A=build(CFG(),tpl);const g=new Group();
 A.propBuildSpec(g,{prop:'x',scatter:{kind:'box',n:30,w:10,d:10},tint:[0xff0000,0x00ff00]},1);
 const im=g.children[0];
 ok(im.instanceColor&&im.instanceColor.needsUpdate===true,'TINT: instanceColor allocated + flagged');
 ok(im.cols.every(c=>c===0xff0000||c===0x00ff00),'TINT: every instance got a palette colour');
}

/* === 7. caps and missing templates ======================================== */
{
 const tpl={x:{parts:[{geo:'g',mat:'m',m:new M4()}]}};
 const A=build(CFG({props:{on:true,maxInstances:100}}),tpl);
 const g=new Group();
 A.propBuildSpec(g,{prop:'x',scatter:{kind:'box',n:5000,w:10,d:10}},1);
 ok(g.children[0].count===100,'CAP: maxInstances clamps a runaway n',g.children[0].count);
 const g2=new Group();
 ok(A.propBuildSpec(g2,{prop:'missing',at:[[0,0,0]]},1)===0,'CAP: an unknown prop builds nothing');
 ok(g2.children.length===0,'CAP: ...and adds nothing to the group');
 const g3=new Group();
 ok(A.propBuildSpec(g3,{prop:'x',at:[]},1)===0,'CAP: zero placements builds nothing');
}

/* === 8. propFlatten: fit / ground normalisation =========================== */
{
 const A=build(CFG());
 // a "chair" authored 0.5 units tall with its origin at its centre
 const mesh={isMesh:true,geometry:{},material:{},matrixWorld:new M4()};
 const root={__box:[[-0.2,-0.25,-0.2],[0.2,0.25,0.2]],
  updateMatrixWorld(){},traverse(f){f(this);f(mesh);}};
 const t=A.propFlatten(root,{id:'chair',fit:10,ground:true});
 ok(near(t.scale,20),'FLATTEN: fit is a target HEIGHT (0.5 authored -> 10 = x20)',t.scale);
 ok(t.parts.length===1,'FLATTEN: one part per mesh/material pair');
 const p=mpos(t.parts[0].m);
 ok(near(p.y,5),'FLATTEN: ground:true lifts the base to y=0 (half of 10)',p.y);
 const t2=A.propFlatten({__box:[[-0.2,-0.25,-0.2],[0.2,0.25,0.2]],
   updateMatrixWorld(){},traverse(f){f(mesh);}},{id:'c',fit:10,ground:false});
 ok(near(mpos(t2.parts[0].m).y,0),'FLATTEN: ground:false leaves the origin alone');
 const t3=A.propFlatten({__box:[[0,0,0],[1,1,1]],updateMatrixWorld(){},traverse(f){f(mesh);}},
   {id:'c',scale:3});
 ok(near(t3.scale,3),'FLATTEN: fit omitted -> scale is the authored multiplier');
 const t4=A.propFlatten({__box:[[0,0,0],[1,0,1]],updateMatrixWorld(){},traverse(f){f(mesh);}},
   {id:'flat',fit:10});
 ok(isFinite(t4.scale)&&t4.scale>0,'FLATTEN: a zero-height prop cannot divide by zero',t4.scale);
}
{ // lights baked into a prop must be stripped, never carried into the scene
 const A=build(CFG());
 const removed=[];
 const lamp={isLight:true,parent:{remove(o){removed.push(o);}}};
 const mesh={isMesh:true,geometry:{},material:{},matrixWorld:new M4()};
 const root={__box:[[0,0,0],[1,1,1]],updateMatrixWorld(){},traverse(f){f(lamp);f(mesh);}};
 const t=A.propFlatten(root,{id:'lamp'});
 ok(removed.length===1&&removed[0]===lamp,'FLATTEN: a baked light is STRIPPED (light count must not change)');
 ok(t.parts.length===1,'FLATTEN: the mesh still survives the strip');
}
{ // multi-material mesh -> one part per material group
 const A=build(CFG());
 const mesh={isMesh:true,matrixWorld:new M4(),
  geometry:{groups:[{materialIndex:0},{materialIndex:1}]},material:['m0','m1']};
 const t=A.propFlatten({__box:[[0,0,0],[1,1,1]],updateMatrixWorld(){},traverse(f){f(mesh);}},{id:'mm'});
 ok(t.parts.length===2,'FLATTEN: a 2-material mesh becomes 2 parts',t.parts.length);
 ok(t.parts[0].mat==='m0'&&t.parts[1].mat==='m1','FLATTEN: each part keeps its own material');
}

/* === 9. TEETH ============================================================= */
function mutate(label,src,probe){
 let broke=false,note='';
 try{
  const f=new Function('CONFIG','THREE','console','propTemplates',
   src.rng+'\n'+src.place+'\n'+src.build+'\n'+src.flat+
   '\nreturn {propRng,propPlacements,propBuildSpec,propFlatten};');
  broke=probe(f(CFG(),THREE,{log(){},warn(){}},src.tpl||{}));
 }catch(e){broke=true;note=' (threw: '+e.message.slice(0,40)+')';}
 ok(broke,'TEETH: '+label+' must fail an assertion'+note);
}
const BASE={rng:S_RNG,place:S_PLACE,build:S_BUILD,flat:S_FLAT};
const TPL1={x:{parts:[{geo:'g',mat:'m',m:new M4().makeTranslation(0,10,0)}]}};

mutate('an unseeded (Math.random) scatter',
 Object.assign({},BASE,{rng:'function propRng(seed){return Math.random;}'}),
 A=>{const s={prop:'x',scatter:{kind:'box',n:30,w:50,d:50}};
     return JSON.stringify(A.propPlacements(s,1))!==JSON.stringify(A.propPlacements(s,1));});

mutate('instance matrix ignoring the part transform',
 Object.assign({},BASE,{tpl:TPL1,build:S_BUILD.replace('mI.multiplyMatrices(mP,part.m);','mI.copy?mI.copy(mP):(mI.e=mP.e.slice());')}),
 A=>{const g=new Group();A.propBuildSpec(g,{prop:'x',at:[[0,0,0,0,1]]},1);
     return !near(mpos(g.children[0].mats[0]).y,10);});

mutate('dropping the maxInstances cap',
 Object.assign({},BASE,{tpl:TPL1,build:S_BUILD.replace('if(places.length>cap){','if(false){')}),
 A=>{const g=new Group();A.propBuildSpec(g,{prop:'x',scatter:{kind:'box',n:99999,w:10,d:10}},1);
     return g.children[0].count>2048;});

mutate('fit treated as a radius instead of a height',
 Object.assign({},BASE,{flat:S_FLAT.replace('if(d.fit>0&&size.y>1e-6)s*=d.fit/size.y;',
   'if(d.fit>0)s*=d.fit/Math.hypot(size.x,size.y,size.z);')}),
 A=>{const mesh={isMesh:true,geometry:{},material:{},matrixWorld:new M4()};
     const t=A.propFlatten({__box:[[-0.2,-0.25,-0.2],[0.2,0.25,0.2]],
       updateMatrixWorld(){},traverse(f){f(mesh);}},{id:'c',fit:10});
     return !near(t.scale,20,1e-6);});

mutate('not stripping baked lights',
 Object.assign({},BASE,{flat:S_FLAT.replace('strip.forEach(l=>{if(l.parent)l.parent.remove(l);});','')}),
 A=>{const removed=[];const lamp={isLight:true,parent:{remove(o){removed.push(o);}}};
     const mesh={isMesh:true,geometry:{},material:{},matrixWorld:new M4()};
     A.propFlatten({__box:[[0,0,0],[1,1,1]],updateMatrixWorld(){},traverse(f){f(lamp);f(mesh);}},{id:'l'});
     return removed.length===0;});

console.log('\nprops harness: '+pass+' passed, '+fail+' failed');
if(fail){console.log('\nFAILURES:');fails.forEach(f=>console.log('  x '+f));process.exit(1);}
console.log('all assertions passed (incl. 5 mutation checks)');
