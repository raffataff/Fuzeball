// fire harness. node tools/fire-harness.js
// js/fire.js on live CONFIG with the real three.min.js: the flame trails a moving ball and rises off a still one (never down into the pitch), swings round smoothly, grows with speed up to its cap;
// a hard speed change flares it (never a fresh ball's first frames); only burning types are drawn and lose the sprite trail; the clock runs on sim seconds, holds in a pause and in a photo freeze;
// a pause keeps the last frame, an empty frame hides it; the noise texture is the periodic one the shaders assume; the core splices into r128's own physical shader and the heat system leaves it alone;
// embers follow speed and the particles switch; the light rides above the ball; then mutations that must each break it
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const rd=p=>fs.readFileSync(path.join(ROOT,p),'utf8').replace(/\r\n/g,'\n');
const THREE_SRC=fs.readFileSync(path.join(ROOT,'vendor/three.min.js'),'utf8');
function fnAt(src,name){
 const s=src.indexOf('function '+name+'(');if(s<0)throw new Error('ANCHOR LOST: function '+name);
 for(let d=0,j=src.indexOf('{',s);j<src.length;j++){const c=src[j];if(c==='{')d++;else if(c==='}'&&--d===0)return src.slice(s,j+1);}
 throw new Error('unbalanced '+name);
}
const BALLS=rd('js/balls.js'),FX=rd('js/fx.js');
const STUB=`
var SP=[],BL=[],FXON=true,scene=new THREE.Scene(),ballMatMap={},sprites=[{visible:false,position:{copy(){}},userData:{},material:{color:{set(){},lerp(){}}},scale:{set(){}}}];
var S={phase:'play',photo:null,time:0};cfg.particles=true;cfg.trails=true;
function ballKey(o){return o.name;}
function vfxLive(){return FXON;}
function vfxRg(a){return a[0]+(a[1]-a[0])*Math.random();}
function vfxSphere(){return [0,1,0];}
function vfxDir(x,y,z){return [x,y,z];}
function vfxSpk(){SP.push([].slice.call(arguments));}
function vfxBlast(){BL.push([].slice.call(arguments));}
function ballHeatColor(){return new THREE.Color(0xff0000);}
`;
const EXPORT=`;globalThis.X={THREE,CONFIG,FIC,FIRE,S,cfg,SP,BL,scene,ballMatMap,BALL_R,sprites,
 get FXON(){return FXON;},set FXON(v){FXON=v;},
 fireFeed,fireUpdate,fireBuild,fireSkin,fireOwns,fireCoreMat,fireNoiseTex,ballHeatSet,spawnTrail};`;
function boot(src){
 const EL={style:{},classList:{add(){},remove(){}}};
 const ctx={console:{log(){},warn(){},error(){}},Math,Float32Array,Array,Object,JSON,String,Number,Set,Map,WeakMap,WeakSet,Uint8Array,Uint16Array,Uint32Array,Int32Array,Float64Array,Int8Array,Int16Array,Uint8ClampedArray,
  ArrayBuffer,DataView,Symbol,Promise,Error,TypeError,RangeError,Date,isFinite,isNaN,parseFloat,parseInt,RegExp,Proxy,
  localStorage:{getItem:()=>null,setItem:()=>{}},document:{getElementById:()=>EL,createElement:()=>EL,body:{appendChild(){}},documentElement:{style:{setProperty(){}}}}};
 ctx.self=ctx;ctx.window=ctx;ctx.globalThis=ctx;
 vm.createContext(ctx);
 vm.runInContext(THREE_SRC,ctx);
 vm.runInContext([rd('js/core.js'),rd('js/config.js'),STUB,src,fnAt(BALLS,'ballHeatSet'),fnAt(FX,'spawnTrail'),EXPORT].join('\n'),ctx);
 return ctx.X;
}

let pass=0,fail=0;const fails=[];
function ok(c,msg){if(c)pass++;else{fail++;fails.push(msg);}}
const near=(a,b,e)=>Math.abs(a-b)<=(e===undefined?1e-6:e);

function suite(X){
 const T=X.THREE,F=X.FIC,R=X.BALL_R,P=new T.Vector3(0,R,0);
 const ball=()=>({key:'fire',hot:0});
 const inst=i=>{const A=X.FIRE.A;return {a:A.aA.array.slice(i*4,i*4+4),b:A.aB.array.slice(i*4,i*4+4),c:A.aC.array.slice(i*4,i*4+4),d:A.aD.array.slice(i*4,i*4+4)};};
 const step=(b,v,n,dt)=>{for(let i=0;i<n;i++){X.fireFeed('fire',P,v,dt||1/60,b,null);X.fireUpdate(dt||1/60);}};

 // --- build ---
 X.fireBuild();
 const M=X.FIRE.mesh;
 ok(M&&X.scene.children.indexOf(M)>=0,'the flame is in the scene');
 ok(M&&M.visible===false,'it is hidden until a ball burns');
 ok(M&&M.geometry.attributes.aA.count===F.max,'one instance slot per burning ball allowed');
 ok(M&&M.material.extensions.fragDepth===true,'the flame writes its own depth');
 ok(M&&M.material.fragmentShader.indexOf('#define FI_STEPS '+(F.steps|0))===0,'the march length comes from CONFIG');
 const nt=X.fireNoiseTex(),d=nt.image.data;let shift=true;
 for(let y=0;y<256&&shift;y+=7)for(let x=0;x<256;x+=5){if(d[(y*256+x)*4+1]!==d[(((y+17)&255)*256+((x+37)&255))*4]){shift=false;break;}}
 ok(shift,'the noise texture G is R one z slice up (37,17): the 3D noise is periodic, so the flow offset wraps');
 ok(nt.generateMipmaps===false&&nt.wrapS===T.RepeatWrapping,'the noise tiles and is read at full detail');

 // --- the core ---
 const root=new T.Group(),mf=new T.Mesh(new T.SphereGeometry(1),new T.MeshStandardMaterial()),mc=new T.Mesh(new T.SphereGeometry(1),new T.MeshStandardMaterial());
 mf.name='fire';mc.name='classic';root.add(mf);root.add(mc);const cm0=mc.material;
 X.fireSkin(root);
 ok(mf.material===X.FIRE.core&&X.ballMatMap.fire===X.FIRE.core,'the fire slot takes the molten core, and makeBallModel finds it');
 ok(mc.material===cm0&&!X.ballMatMap.classic,'other slots are left alone');
 const sh={uniforms:{},vertexShader:T.ShaderLib.physical.vertexShader,fragmentShader:T.ShaderLib.physical.fragmentShader};
 X.FIRE.core.onBeforeCompile(sh);
 ok(sh.vertexShader.indexOf('vFiP=position;')>0,'the core reads the ball\'s own space (it rolls with the ball)');
 ok(sh.fragmentShader.indexOf('float fiS=')>0&&sh.fragmentShader.indexOf('roughnessFactor=mix(roughnessFactor')>0&&sh.fragmentShader.indexOf('normal=normalize(abs(det)')>0&&sh.fragmentShader.indexOf('totalEmissiveRadiance+=fiRamp')>0,
  'all four splices land in r128\'s physical shader');
 ok(sh.uniforms.uT===X.FIRE.u.uT&&sh.uniforms.uNz===X.FIRE.u.uNz,'the core shares the flame\'s clock and noise');
 const cm=X.FIRE.core;cm.emissive.setHex(0x112233);
 X.ballHeatSet({traverse:f=>f({isMesh:true,material:cm})},1);
 ok(cm.emissive.getHex()===0x112233,'the heat system leaves the core alone');

 // --- a still ball ---
 X.S.phase='play';
 const b=ball();
 step(b,new T.Vector3(0,0,0),1);
 let I=inst(0);
 ok(near(I.b[1],1,1e-4),'a still ball\'s flame rises straight up');
 ok(near(I.b[3],R*F.flame.rest,1e-4),'at its resting length');
 ok(near(I.a[0],0)&&near(I.a[1],R)&&near(I.a[3],R),'centred on the ball, at its radius');
 ok(I.c[0]<0.1,'a new ball has not caught yet');
 ok(X.fireOwns(b),'a burning ball owns its trail');
 step(b,new T.Vector3(0,0,0),Math.ceil(F.flame.ign*60)+2);
 ok(near(inst(0).c[0],F.flame.power,1e-3),'it catches within flame.ign seconds');

 // --- moving ---
 const b2=ball(),v=new T.Vector3(100,0,0);
 step(b2,v,1);I=inst(0);
 ok(I.b[0]<-0.5,'a moving ball\'s flame trails it');
 const bl2=ball();step(bl2,new T.Vector3(250,0,0),1);
 ok(inst(0).b[1]>=F.flame.lift-1e-4,'a fast ball\'s flame never dips below its lift');
 const bl3=ball();step(bl3,new T.Vector3(40,80,0),1);
 ok(inst(0).b[1]>=F.flame.lift-1e-4,'nor a rising ball\'s');
 ok(I.b[3]>R*F.flame.rest&&I.b[3]<=F.flame.maxLen+1e-4,'longer with speed, never past maxLen');
 step(b2,new T.Vector3(1000,0,0),1);
 ok(inst(0).b[3]<=F.flame.maxLen+1e-4,'a very fast ball still stops at maxLen');
 const b3=ball();step(b3,new T.Vector3(200,0,0),1);
 const b3v=new T.Vector3(-200,0,0);
 X.FIRE.n=0;X.fireFeed('fire',P,b3v,1/60,b3,null);I=inst(0);X.fireUpdate(1/60);
 ok(I.b[0]<-0.2,'a reversal swings the flame round, not in one frame');
 step(b3,b3v,40);
 ok(inst(0).b[0]>0.5,'but it does swing round');

 // --- flare ---
 const b4=ball();X.SP.length=0;
 step(b4,new T.Vector3(0,0,0),1);step(b4,new T.Vector3(200,0,0),1);
 ok(b4.fs.fl===0&&X.SP.length<5,'a fresh ball does not flare off its first speed');
 step(b4,new T.Vector3(200,0,0),4);X.SP.length=0;
 step(b4,new T.Vector3(-150,0,0),1);
 ok(b4.fs.fl>0.4,'a hard hit flares the flame');
 ok(X.SP.length>=F.flare.sparks[0],'and throws sparks');
 const fl=b4.fs.fl;step(b4,new T.Vector3(-150,0,0),30);
 ok(b4.fs.fl<fl,'the flare settles');
 const b5=ball();step(b5,new T.Vector3(50,0,0),5);
 step(b5,new T.Vector3(50+F.flare.dv*0.5,0,0),1);
 ok(b5.fs.fl===0,'a small change does not flare');

 // --- types ---
 const c=ball();X.FIRE.n=0;
 X.fireFeed('classic',P,new T.Vector3(),1/60,c,null);
 ok(X.FIRE.n===0&&!X.fireOwns(c),'a classic ball draws no flame and keeps its trail');
 step(b,new T.Vector3(),1);
 X.fireFeed('classic',P,new T.Vector3(),1/60,b,null);
 ok(!X.fireOwns(b),'a slot that stops burning gives its trail back');
 const sb={m:{position:P},t:{trail:'#fff'},fs:{on:true}};X.sprites[0].visible=false;
 X.spawnTrail(sb);
 ok(X.sprites[0].visible===false,'spawnTrail skips a burning ball');
 sb.fs.on=false;X.spawnTrail(sb);
 ok(X.sprites[0].visible===true,'and trails any other');

 // --- the clock, the pause, an empty frame ---
 const b6=ball(),u=X.FIRE.u.uT;let t0=u.value;
 X.fireFeed('fire',P,new T.Vector3(),0.004,b6,null);X.fireUpdate(1/60);
 ok(near(u.value,t0+0.004),'the clock runs on the sim seconds fed, not the frame');
 ok(M.visible&&M.geometry.instanceCount===1,'a fed frame is drawn');
 X.S.phase='pause';t0=u.value;X.fireUpdate(1/60);
 ok(M.visible&&M.geometry.instanceCount===1&&u.value===t0,'a pause holds the last frame and the clock');
 X.S.phase='play';X.fireUpdate(1/60);
 ok(!M.visible,'an empty frame hides it');
 X.S.photo={freeze:true,freezeFx:true};t0=u.value;
 X.fireFeed('fire',P,new T.Vector3(),1/60,b6,null);X.fireUpdate(1/60);
 ok(u.value===t0,'a photo freeze holds the clock');
 X.S.photo=null;

 // --- replay ghosts ---
 X.S.phase='replay';
 const g=ball();step(g,new T.Vector3(80,0,0),1);
 ok(near(inst(0).c[0],F.flame.power,1e-3),'a replay ghost is already burning');
 X.FIRE.n=0;X.fireFeed('fire',P,null,0,g,null);
 ok(g.fs.v.x===80&&inst(0).b[0]<-0.5,'a frame with no footage step keeps the last speed');
 X.fireUpdate(0);X.S.phase='play';

 // --- the offset wraps ---
 const b7=ball();step(b7,new T.Vector3(150,0,0),1);b7.fs.off.set(-255.9,255.9,0);step(b7,new T.Vector3(150,0,0),3);
 ok(Math.abs(b7.fs.off.x)<256&&Math.abs(b7.fs.off.y)<256,'the flow offset stays inside one period');

 // --- embers ---
 const cnt=(sp,n)=>{const e=ball();step(e,new T.Vector3(sp,0,0),20);X.SP.length=0;step(e,new T.Vector3(sp,0,0),n);return X.SP.length;};
 const slow=cnt(0,60),fast=cnt(F.embers.ref,60);
 ok(slow>0&&fast>slow*2,'a fast ball sheds more embers ('+slow+' still, '+fast+' fast)');
 X.cfg.particles=false;ok(cnt(F.embers.ref,60)===0,'particles off sheds none');X.cfg.particles=true;
 X.FXON=false;ok(cnt(F.embers.ref,60)===0,'the vfx pools off sheds none');X.FXON=true;

 // --- the light ---
 const l=new T.PointLight(),bl=ball();
 X.fireFeed('fire',P,new T.Vector3(),1/60,bl,l);X.fireUpdate(1/60);
 ok(near(l.position.y,R+F.light.up)&&l.intensity<F.light.base*0.2,'the light rides above the ball and catches with it');
 for(let i=0;i<60;i++){X.fireFeed('fire',P,new T.Vector3(),1/60,bl,l);X.fireUpdate(1/60);}
 ok(l.intensity>F.light.base*(1-F.light.flicker)-1e-6&&l.intensity<F.light.base*(1+F.light.flicker)+1e-6,'then flickers round its base');

 // --- off ---
 F.on=false;const bo=ball();X.FIRE.n=0;
 X.fireFeed('fire',P,new T.Vector3(),1/60,bo,null);X.fireUpdate(1/60);
 ok(X.FIRE.n===0&&!M.visible&&!X.fireOwns(bo),'fire.on false draws nothing and keeps the trail');
 F.on=true;
}

function run(src){const X=boot(src);pass=0;fail=0;fails.length=0;try{suite(X);}catch(e){fail++;fails.push('threw: '+e.message);}return {pass,fail,fails:fails.slice()};}
const SRC=rd('js/fire.js');
const base=run(SRC);
console.log('fire harness: '+base.pass+' assertions, '+base.fail+' failing');
for(const f of base.fails)console.log('  FAIL '+f);

function mutate(from,to,label){
 if(!SRC.includes(from)||from===to){console.log('  MUTATION ANCHOR DRIFTED: '+label);return {broke:false,drift:true};}
 let r;try{r=run(SRC.replace(from,to));}catch(e){return {broke:true};}
 return {broke:r.fail>base.fail};
}
const MUT=[
 ['if(_fiV.y<F.lift)','if(false)','the flame dips into the pitch'],
 ['_fiV.set(-vx*F.drag,-vy*F.drag+F.rise,-vz*F.drag)','_fiV.set(vx*F.drag,-vy*F.drag+F.rise,vz*F.drag)','the flame leads the ball'],
 ['const k=fresh?1:1-Math.exp(-d*F.turn);','const k=1;','the flame snaps round'],
 ['const k=fresh?1:1-Math.exp(-d*F.turn);','const k=fresh?1:0;','the flame never swings'],
 ['s.L+=(Math.min(BALL_R*(F.rest+sp*F.len),F.maxLen)-s.L)*k;','s.L+=(BALL_R*(F.rest+sp*F.len)-s.L)*k;','no length cap'],
 ['if(d>0&&s.nf>2&&dv>FIC.flare.dv)','if(d>0&&dv>FIC.flare.dv)','a fresh ball flares'],
 ['if(d>0&&s.nf>2&&dv>FIC.flare.dv)','if(d>0&&s.nf>2&&dv>0)','any change flares'],
 ['s.fl=Math.max(0,s.fl-d*FIC.flare.decay);','','the flare never settles'],
 ['if(!FIC.on||!FIRE.mesh||FIC.types.indexOf(key)<0)','if(!FIC.on||!FIRE.mesh)','every ball burns'],
 ['if(S.phase===\'pause\'&&!n){FIRE.dt=0;return;}','','a pause hides the flame'],
 ['FIRE.u.uT.value=(FIRE.u.uT.value+FIRE.dt)%1000;','FIRE.u.uT.value=(FIRE.u.uT.value+rdt)%1000;','the clock runs on the frame'],
 ['M.visible=n>0;','M.visible=true;','an empty frame still draws'],
 ['s.ign=S.phase===\'replay\'?1:0;','s.ign=0;','a replay ghost catches from cold'],
 ['s.off.set(s.off.x%256,s.off.y%256,s.off.z%256);','','the offset runs away'],
 ['function fireOwns(b){return !!(b&&b.fs&&b.fs.on&&FIRE.mesh);}','function fireOwns(b){return false;}','a fireball keeps the sprite trail'],
 ['if(l)fireLight(s,p,l);','','the light is never driven'],
 ['l.position.set(p.x,p.y+L.up,p.z);','l.position.set(p.x,p.y,p.z);','the light sits inside the ball'],
 ['s.em+=lerp(E.rate[0],E.rate[1],clamp(sp/E.ref,0,1))*d*s.ign;','s.em+=E.rate[0]*d*s.ign;','embers ignore speed'],
 ['if(!cfg.particles||typeof vfxLive!==\'function\'||!vfxLive())return;\n const E=','if(typeof vfxLive!==\'function\'||!vfxLive())return;\n const E=','particles off still sheds'],
 ['d[o+1]=R[((y+17)&255)*N+((x+37)&255)];','d[o+1]=R[((y+16)&255)*N+((x+37)&255)];','the noise is not periodic'],
 ['m.userData.fireCore=true;','','the heat system rewrites the core'],
 ['d=(S.photo&&S.photo.freeze&&S.photo.freezeFx)?0:Math.max(0,dt||0);','d=Math.max(0,dt||0);','a photo freeze runs the clock'],
 ['if(v){\n  const dv=_fiW.subVectors(v,s.v).length();\n  s.v.copy(v);','if(true){\n  const dv=_fiW.subVectors(v||_fiW.set(0,0,0),s.v).length();\n  s.v.copy(v||_fiW);','a ghost with no footage step stops'],
 ['ballMatMap[k]=m;','','makeBallModel still finds the old material'],
 ['.replace(\'#include <emissivemap_fragment>\',\'#include <emissivemap_fragment>\\n\'+FIRE_CORE_EM)','','the core never glows'],
 ['extensions:{fragDepth:true}','extensions:{}','the flame cannot write depth'],
 ['c[i4]=F.power*s.ign*(1+G.pow*s.fl);','c[i4]=F.power*(1+G.pow*s.fl);','a new ball is already alight'],
];
let survived=0;
for(const [a,b,label] of MUT){const m=mutate(a,b,label);if(!m.broke){survived++;console.log('  SURVIVED: '+label+(m.drift?' (anchor)':''));}}
console.log('mutations: '+(MUT.length-survived)+'/'+MUT.length+' caught');
process.exit(base.fail||survived?1:0);
