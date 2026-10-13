// vfx harness. node tools/vfx-harness.js
// js/vfx.js on live CONFIG with a THREE stub: pool writes and the ring cursor, the particle clock (slow-mo), visibility, light envelopes (pooled lights borrowed and returned),
// the camera spring (the offset goes on and comes off exactly), clear / rebase, the goal / pickup / finale spawns and the particles switch; then mutations that must each break it
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10),CR=String.fromCharCode(13);
const rd=f=>fs.readFileSync(f,'utf8').split(CR+NL).join(NL);

const STUB=`
var V3=function(x,y,z){this.x=x||0;this.y=y||0;this.z=z||0;};
V3.prototype.set=function(x,y,z){this.x=x;this.y=y;this.z=z;return this;};V3.prototype.copy=function(o){this.x=o.x;this.y=o.y;this.z=o.z;return this;};
V3.prototype.normalize=function(){const l=Math.hypot(this.x,this.y,this.z)||1;this.x/=l;this.y/=l;this.z/=l;return this;};
V3.prototype.applyQuaternion=function(){return this;};V3.prototype.addScaledVector=function(v,s){this.x+=v.x*s;this.y+=v.y*s;this.z+=v.z*s;return this;};
V3.prototype.length=function(){return Math.hypot(this.x,this.y,this.z);};V3.prototype.multiplyScalar=function(s){this.x*=s;this.y*=s;this.z*=s;return this;};
V3.prototype.fromArray=function(a){this.x=a[0];this.y=a[1];this.z=a[2];return this;};
var V2=function(x,y){this.x=x||0;this.y=y||0;};V2.prototype.copy=function(o){this.x=o.x;this.y=o.y;return this;};
var V4=function(){this.x=0;this.y=0;this.z=0;this.w=0;};V4.prototype.set=function(a,b,c,d){this.x=a;this.y=b;this.z=c;this.w=d;return this;};
var Col=function(){this.r=0;this.g=0;this.b=0;};
Col.prototype.set=function(h){if(typeof h==='number'){this.r=((h>>16)&255)/255;this.g=((h>>8)&255)/255;this.b=(h&255)/255;}else{const n=parseInt(String(h).replace('#',''),16);this.r=((n>>16)&255)/255;this.g=((n>>8)&255)/255;this.b=(n&255)/255;}return this;};
Col.prototype.convertSRGBToLinear=function(){this.r=Math.pow(this.r,2.2);this.g=Math.pow(this.g,2.2);this.b=Math.pow(this.b,2.2);return this;};
Col.prototype.setRGB=function(r,g,b){this.r=r;this.g=g;this.b=b;return this;};Col.prototype.copy=function(o){this.r=o.r;this.g=o.g;this.b=o.b;return this;};
Col.prototype.multiplyScalar=function(s){this.r*=s;this.g*=s;this.b*=s;return this;};
var Attr=function(a,n){this.array=a;this.itemSize=n;this.needsUpdate=false;};Attr.prototype.setUsage=function(){return this;};
var Geo=function(){this.attributes={};this.instanceCount=0;};Geo.prototype.setAttribute=function(k,a){this.attributes[k]=a;};Geo.prototype.setIndex=function(){};
var THREE={Color:Col,Vector2:V2,Vector3:V3,Vector4:V4,InstancedBufferGeometry:Geo,InstancedBufferAttribute:Attr,Float32BufferAttribute:function(a,n){return new Attr(new Float32Array(a),n);},
 ShaderMaterial:function(o){Object.assign(this,o);},Mesh:function(g,m){this.geometry=g;this.material=m;this.visible=true;},
 DataTexture:function(){this.needsUpdate=false;},RGBAFormat:1,RepeatWrapping:2,LinearFilter:3,AdditiveBlending:4,NoBlending:0,CustomBlending:5,AddEquation:6,OneFactor:7,OneMinusSrcAlphaFactor:8,DynamicDrawUsage:9};
var scene={add:function(){}};
var camera={position:new V3(0,60,50),quaternion:{},fov:55,aspect:1.6,updateMatrixWorld:function(){},updateProjectionMatrix:function(){this.proj=(this.proj||0)+1;}};
var renderer={getDrawingBufferSize:function(v){v.x=1280;v.y=720;}};
var S={phase:'play',timeScale:1,photo:null,freeRoam:false,score:[0,0],winT:0};
var renderDirtyN=0;function renderDirty(){renderDirtyN++;}
var goalLights=[{color:new Col(),intensity:0},{color:new Col(),intensity:0}];
var POOL=[{color:new Col(),intensity:0,free:true,position:new V3(),distance:0},{color:new Col(),intensity:0,free:true,position:new V3(),distance:0}];
var GOT=0,PUT=0;
function fxLightGet(c,d){for(const l of POOL){if(l.free){l.free=false;GOT++;l.intensity=0;l.distance=d;return l;}}return null;}
function fxLightPut(l){if(!l)return;l.intensity=0;l.free=true;PUT++;}
var netMats=[{userData:{},emissive:new Col()},{userData:{},emissive:new Col()}];
function addEventListener(){}
var innerWidth=1280,innerHeight=720,devicePixelRatio=1,performance={now:()=>0};function requestAnimationFrame(){}
`;
const EXPORT=`;globalThis.X={VF:VF,VFX:VFX,S:S,cfg:cfg,camera:camera,goalLights:goalLights,POOL:POOL,netMats:netMats,
 stats:function(){return {got:GOT,put:PUT,dirtyN:renderDirtyN};},reset:function(){GOT=0;PUT=0;renderDirtyN=0;for(const l of POOL){l.free=true;l.intensity=0;}},
 vfxBuild:vfxBuild,vfxSpk:vfxSpk,vfxConf:vfxConf,vfxBlast:vfxBlast,vfxUpdate:vfxUpdate,vfxClear:vfxClear,vfxRebase:vfxRebase,vfxLight:vfxLight,
 vfxPunch:vfxPunch,vfxCamPre:vfxCamPre,vfxCamPost:vfxCamPost,vfxGoal:vfxGoal,vfxPickup:vfxPickup,vfxCannon:vfxCannon,vfxFinale:vfxFinale,vfxFadeOut:vfxFadeOut,
 vfxLive:vfxLive,vfxNetHit:vfxNetHit,vfxNetPatch:vfxNetPatch,vfxWinTick:vfxWinTick,vfxImpact:vfxImpact,BALL_R:BALL_R};`;

function boot(vfxSrc){
 const EL={style:{},offsetWidth:0,classList:{add(){},remove(){}},getContext:function(){return new Proxy({},{get:()=>function(){},set:()=>true});}};
 const ctx={console,Math,JSON,Object,Array,Set,Map,isNaN,isFinite,RegExp,String,Float32Array,localStorage:{getItem:()=>null,setItem:()=>{}},
  document:{getElementById:()=>EL,createElement:()=>EL,body:{appendChild(){}},documentElement:{style:{setProperty(){}}}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),STUB,vfxSrc,EXPORT].join(NL),ctx);
 if(!ctx.X||!ctx.X.VFX)throw new Error('export line did not run');
 return ctx.X;
}

let pass=0,fail=0;const fails=[];
function ok(c,msg){if(c)pass++;else{fail++;fails.push(msg);}}
const near=(a,b,e)=>Math.abs(a-b)<=(e===undefined?1e-6:e);

function fresh(X){
 X.VF.on=true;X.cfg.particles=true;X.S.phase='play';X.S.timeScale=1;X.S.photo=null;X.S.freeRoam=false;X.S.winT=0;
 if(!X.VFX.sp)X.vfxBuild();
 X.vfxClear();X.VFX.t=0;X.VFX.si=0;X.VFX.ci=0;X.VFX.bi=0;X.reset();
 X.camera.position.set(0,60,50);X.camera.fov=55;X.camera.proj=0;
 for(const g of X.goalLights)g.intensity=0;
}
const col=[1,0.5,0.25];

function suite(X){
 /* 1. the pools */
 fresh(X);
 ok(X.VFX.sp&&X.VFX.cf&&X.VFX.bl,'three pools are built');
 ok(X.VFX.sp.n===X.VF.sparks&&X.VFX.cf.n===X.VF.confetti&&X.VFX.bl.n===X.VF.blasts,'pool sizes come from CONFIG.fx.vfx');
 ok(X.VFX.sp.A.aP.array[3]===-1e4&&X.VFX.sp.A.aP.array[(X.VF.sparks-1)*4+3]===-1e4,'every slot starts unborn (birth far in the past)');
 ok(X.VFX.sp.mesh.visible===false&&X.VFX.cf.mesh.visible===false&&X.VFX.bl.mesh.visible===false,'an empty pool draws nothing');

 /* 2. a spark spawn */
 X.VFX.t=2;
 X.vfxSpk(1,2,3,4,5,6,1.5,col,2,0.2,1.1,0.9,0.05,3,0.25);
 const P=X.VFX.sp.A,o=0;
 ok(near(P.aP.array[0],1)&&near(P.aP.array[1],2)&&near(P.aP.array[2],3),'a spark is written at its spawn point');
 ok(near(P.aP.array[3],2.25),'its birth is the clock plus the delay');
 ok(near(P.aV.array[0],4)&&near(P.aV.array[3],1.5),'velocity and life are written');
 ok(near(P.aC.array[0],2)&&near(P.aC.array[1],1)&&near(P.aC.array[2],0.5)&&near(P.aC.array[3],0.2),'colour is multiplied by power, size kept');
 ok(near(P.aM.array[0],1.1)&&near(P.aM.array[1],0.9)&&near(P.aM.array[2],0.05)&&P.aM.array[3]===3,'drag, gravity scale, tail and flags are written');
 ok(near(X.VFX.sp.live,3.75),'the pool knows when its last particle dies');
 ok(X.VFX.dirty===true,'a spawn marks the buffers for upload');
 ok(X.VFX.si===1,'the cursor moves on');

 /* 3. the ring cursor */
 fresh(X);
 for(let i=0;i<X.VF.sparks+3;i++)X.vfxSpk(i,0,0,0,0,0,1,col,1,0.1,1,1,0,0,0);
 ok(X.VFX.si===3,'the cursor wraps at the pool size');
 ok(X.VFX.sp.A.aP.array[0]===X.VF.sparks&&X.VFX.sp.A.aP.array[4]===X.VF.sparks+1,'a full pool recycles its oldest slots');
 for(let i=0;i<X.VF.confetti+2;i++)X.vfxConf(0,0,0,0,0,0,1,col,0.5,0);
 ok(X.VFX.ci===2,'the confetti cursor wraps too');
 for(let i=0;i<X.VF.blasts+1;i++)X.vfxBlast(0,0,0,0,0,0,0,1,1,2,col,1,col,0);
 ok(X.VFX.bi===1,'and the blast cursor');

 /* 4. confetti and blasts */
 fresh(X);
 X.vfxConf(5,6,7,1,2,3,3,col,0.8,0.5);
 const C=X.VFX.cf.A;
 ok(near(C.aP.array[0],5)&&near(C.aP.array[3],0.5)&&near(C.aV.array[3],3)&&near(C.aC.array[3],0.8),'a confetti piece is written');
 ok(C.aM.array[0]>0.5*X.VF.confDrag&&C.aM.array[0]<1.5*X.VF.confDrag,'its drag varies around CONFIG confDrag');
 X.vfxBlast(1,1,2,3,0,1,0,0.9,2,30,col,1.5,[0.2,0.3,0.4],0.1);
 const B=X.VFX.bl.A;
 ok(B.aN.array[3]===1&&B.aN.array[1]===1,'a blast keeps its kind and plane normal');
 ok(near(B.aQ.array[0],0.9)&&near(B.aQ.array[1],2)&&near(B.aQ.array[2],30),'life and the two sizes');
 ok(near(B.aH.array[3],1.5)&&near(B.aB.array[2],0.4),'power and body colour');

 /* 5. the clock follows the slow-mo, not past its floor */
 fresh(X);
 X.vfxUpdate(0.1);ok(near(X.VFX.t,0.1),'the clock runs at the real rate in play');
 X.S.phase='goal';X.S.timeScale=0.15;
 const t0=X.VFX.t;X.vfxUpdate(0.1);
 const k=(X.VFX.t-t0)/0.1;
 ok(k<0.8&&k>=X.VF.slowMin-1e-9,'a goal slows the particles, not below the floor ('+k.toFixed(2)+')');
 X.S.phase='win';X.S.timeScale=0.15;const t1=X.VFX.t;X.vfxUpdate(0.1);
 ok(near(X.VFX.t-t1,0.1),'only play and goal follow the game clock');
 X.S.timeScale=1;X.S.phase='play';

 /* 6. visibility and the idle render gate */
 fresh(X);
 X.vfxSpk(0,0,0,0,0,0,1,col,1,0.1,1,1,0,0,0);
 X.stats();X.reset();
 X.vfxUpdate(0.016);
 ok(X.VFX.sp.mesh.visible===true,'a live pool is drawn');
 ok(X.VFX.cf.mesh.visible===false,'an empty one is not');
 ok(X.stats().dirtyN>0,'a live effect keeps the menu render at full rate');
 ok(X.VFX.sp.A.aP.needsUpdate===true,'the buffers upload on the frame after a spawn');
 X.VFX.dirty=false;
 for(let i=0;i<80;i++)X.vfxUpdate(0.016);
 ok(X.VFX.sp.mesh.visible===false,'it is hidden again once everything has died');

 /* 7. light envelopes */
 fresh(X);
 X.vfxLight(null,true,1,2,3,0xffffff,50,4,0.05,5,0.1);
 X.vfxUpdate(0.05);
 ok(X.stats().got===0,'a pooled light is not borrowed before its pulse starts');
 X.vfxUpdate(0.1);
 ok(X.stats().got===1&&X.POOL[0].intensity>3,'it is borrowed when it starts, at its peak');
 ok(X.POOL[0].position.x===1&&X.POOL[0].position.z===3,'and put where it was asked');
 for(let i=0;i<120;i++)X.vfxUpdate(0.02);
 ok(X.stats().put===1&&X.POOL[0].free&&X.POOL[0].intensity===0,'a spent pulse hands its light back');
 ok(X.VFX.lights.length===0,'and leaves the list');
 fresh(X);
 X.POOL[0].free=false;X.POOL[1].free=false;
 X.vfxLight(null,true,0,0,0,0xffffff,50,4,0.05,5,0);
 X.vfxUpdate(0.02);
 ok(X.VFX.lights.length===0,'with the pool exhausted the pulse is dropped, not queued');
 fresh(X);
 X.vfxLight(X.goalLights[0],false,0,0,0,0,0,3,0.1,3,0);
 X.vfxUpdate(0.02);ok(near(X.goalLights[0].intensity,3,0.4),'a resident light is driven directly');
 for(let i=0;i<200;i++)X.vfxUpdate(0.02);
 ok(X.goalLights[0].intensity===0,'and left dark');

 /* 8. the camera spring */
 fresh(X);
 const base={x:X.camera.position.x,y:X.camera.position.y,z:X.camera.position.z,f:X.camera.fov};
 X.vfxPunch(-1,0,1);
 ok(X.VFX.cam.f<0,'a punch zooms in');
 let minFov=99,maxOff=0;
 for(let i=0;i<240;i++){
  X.vfxCamPre();                                  // what cameraUpdate does each frame: take the offset off, ease (nothing here), put it back
  X.vfxCamPost(1/60);
  minFov=Math.min(minFov,X.camera.fov);maxOff=Math.max(maxOff,Math.abs(X.camera.position.x-base.x));
 }
 X.vfxCamPre();
 ok(minFov<base.f-1,'the zoom shows ('+minFov.toFixed(2)+')');
 ok(maxOff>0.3,'the shove shows');
 ok(near(X.camera.position.x,base.x,1e-4)&&near(X.camera.position.z,base.z,1e-4)&&near(X.camera.fov,base.f,1e-3),'the camera comes home exactly');
 ok(X.camera.proj>0,'the projection is rebuilt while the zoom moves');
 fresh(X);X.S.photo={};X.vfxPunch(1,0,1);ok(X.VFX.cam.f===0,'photo mode takes no punch');
 X.S.photo=null;X.S.phase='replay';X.vfxPunch(1,0,1);ok(X.VFX.cam.f===0,'nor does a replay');X.S.phase='play';
 fresh(X);X.VF.camera.on=false;X.vfxPunch(1,0,1);X.vfxCamPre();X.vfxCamPost(1/60);
 ok(near(X.camera.fov,55)&&near(X.camera.position.x,0),'camera.on false leaves the camera alone');X.VF.camera.on=true;

 /* 9. clear and rebase */
 fresh(X);
 for(let i=0;i<30;i++)X.vfxSpk(i,0,0,0,0,0,5,col,1,0.1,1,1,0,0,0);
 X.vfxLight(null,true,0,0,0,0xffffff,50,4,0.5,1,0);X.vfxUpdate(0.02);
 X.vfxPunch(1,0,1);
 X.vfxClear();
 ok(X.VFX.sp.A.aP.array[3]===-1e4&&X.VFX.sp.live===0&&X.VFX.sp.mesh.visible===false,'clear unbirths everything');
 ok(X.VFX.lights.length===0&&X.POOL[0].free,'it hands the lights back');
 ok(X.VFX.cam.f===0&&X.VFX.cam.x===0,'and settles the camera');
 fresh(X);
 X.VFX.t=2000;X.vfxSpk(0,0,0,0,0,0,1,col,1,0.1,1,1,0,0,0,-2000);   // a particle born at clock 0 and long dead
 X.VFX.sp.live=0;
 X.vfxUpdate(0.016);
 ok(X.VFX.t<10,'an idle clock is rebased');
 ok(X.VFX.sp.A.aP.array[3]===-1e4,'a rebase unbirths the old slots, or they would come back');

 /* 10. the replay fade */
 fresh(X);
 X.vfxSpk(0,0,0,0,0,0,5,col,1,0.1,1,1,0,0,0);
 X.vfxFadeOut(0.3);
 ok(X.VFX.fadeD===0.3,'a fade is asked for when something is in the air');
 for(let i=0;i<30;i++)X.vfxUpdate(0.02);
 ok(X.VFX.sp.live===0&&X.VFX.fade===1,'it ends in a clear and the fade resets');
 fresh(X);X.vfxFadeOut(0.3);ok(X.VFX.fadeD===0,'nothing in the air, nothing to fade');

 /* 11. the goal */
 fresh(X);
 X.vfxGoal(0,{x:61,y:2,z:3});
 ok(X.VFX.si>100&&X.VFX.ci>50&&X.VFX.bi>=6,'a goal throws sparks, confetti and blasts ('+X.VFX.si+'/'+X.VFX.ci+'/'+X.VFX.bi+')');
 const ang=[];for(let i=0;i<X.VFX.si;i++)ang.push(X.VFX.sp.A.aV.array[i*4]);
 ok(ang.filter(v=>v<0).length>ang.length*0.5,'a goal into +x throws its sparks back toward the table (-x)');
 ok(X.VFX.lights.length>=2,'it pulses the goal light and a pooled one');
 ok(X.VFX.cam.f<0,'and punches the camera');
 ok(X.VFX.net[1].a===1,'the +x net is the one hit');
 fresh(X);
 X.vfxGoal(1,{x:-61,y:2,z:0});
 const vx2=[];for(let i=0;i<X.VFX.si;i++)vx2.push(X.VFX.sp.A.aV.array[i*4]);
 ok(X.VFX.net[0].a===1&&vx2.filter(v=>v>0).length>vx2.length*0.5,'team 1 scores into -x and throws toward +x');
 fresh(X);X.cfg.particles=false;
 X.vfxGoal(0,{x:61,y:2,z:0});
 ok(X.VFX.si===0&&X.VFX.ci===0&&X.VFX.bi===0,'particles off: nothing is spawned');
 ok(X.VFX.lights.length>=2&&X.VFX.cam.f<0&&X.VFX.net[1].a===1,'but the light, the net and the camera still answer the goal');
 X.cfg.particles=true;

 /* 12. cannon and pickup */
 fresh(X);
 X.vfxCannon({x:0,y:1.9,z:0});
 ok(X.VFX.si>100&&X.VFX.bi>=8,'a cannonball throws a fireball and sparks');
 fresh(X);
 X.vfxPickup({x:0,y:2,z:0},0x44ffaa);
 ok(X.VFX.si>=40&&X.VFX.bi>=2,'a pickup rings and sparkles');
 ok(X.VFX.lights.length===1,'with a short pulse of its colour');

 /* 13. the finale */
 fresh(X);
 const w=X.vfxFinale(0);
 ok(w===X.VF.finale.board&&w>0,'the finale holds the board back');
 ok(X.VFX.si>500&&X.VFX.ci>300&&X.VFX.bi>=10,'it throws a lot ('+X.VFX.si+'/'+X.VFX.ci+'/'+X.VFX.bi+')');
 ok(X.VFX.lights.length>=7,'with a light for every shell and both goals');
 fresh(X);X.cfg.particles=false;
 ok(X.vfxFinale(1)===0&&X.VFX.si===0,'particles off: no wait, no spawns');
 X.cfg.particles=true;
 fresh(X);X.VF.on=false;ok(X.vfxFinale(0)===0,'vfx off: the finale is not asked for');X.VF.on=true;

 /* 14. a hard hit on a wall */
 fresh(X);
 const hb={m:{position:{x:10,y:2,z:33}}};
 X.vfxImpact(hb,0,0,-1,X.VF.impact.min-5);
 ok(X.VFX.si===0,'a soft hit throws nothing');
 X.vfxImpact(hb,0,0,-1,X.VF.impact.min+1);
 const few=X.VFX.si;
 ok(few>=X.VF.impact.n[0]&&few<=X.VF.impact.n[0]+1,'a hit just over the threshold throws a few ('+few+')');
 fresh(X);X.vfxImpact(hb,0,0,-1,X.VF.impact.full+20);
 ok(X.VFX.si===X.VF.impact.n[1],'a full-speed hit throws the most');
 let off=0;for(let i=0;i<X.VFX.si;i++)if(X.VFX.sp.A.aV.array[i*4+2]<0)off++;
 ok(off>X.VFX.si*0.8,'the sparks come off the wall, into the table');
 ok(near(X.VFX.sp.A.aP.array[2],33+X.BALL_R-0.4,1e-3),'they start at the contact, not at the ball centre');
 fresh(X);X.cfg.particles=false;X.vfxImpact(hb,0,0,-1,90);
 ok(X.VFX.si===0,'particles off: no sparks');X.cfg.particles=true;
 fresh(X);X.VF.impact.on=false;X.vfxImpact(hb,0,0,-1,90);ok(X.VFX.si===0,'impact.on false: none');X.VF.impact.on=true;

 /* 15. the board wait */
 fresh(X);
 X.S.phase='win';X.S.winT=0.1;
 X.vfxWinTick(0.05);ok(X.S.winT>0&&X.S.winT<0.1,'the wait counts down');
 X.vfxWinTick(0.1);ok(X.S.winT===0,'and ends');
 X.S.phase='win';X.S.winT=5;X.S.phase='menu';X.vfxWinTick(0.01);ok(X.S.winT===0,'leaving before it ends cancels it');
}

function run(src){const X=boot(src);pass=0;fail=0;fails.length=0;suite(X);return {pass,fail,fails:fails.slice()};}

const SRC=rd('js/vfx.js');
const base=run(SRC);
console.log('vfx harness: '+base.pass+' assertions, '+base.fail+' failing');
for(const f of base.fails)console.log('  FAIL '+f);

/* mutations: each must break something */
function mutate(from,to,label){
 if(!SRC.includes(from)){console.log('  MUTATION ANCHOR DRIFTED: '+label);return {broke:false,drift:true};}
 let r;try{r=run(SRC.replace(from,to));}catch(e){return {broke:true};}
 return {broke:r.fail>base.fail};
}
const MUT=[
 ['VFX.si=(i+1)%P.n;','VFX.si=i+1;','the spark cursor does not wrap'],
 ['if(!I||!I.on||!VFX.sp||!cfg.particles||imp<I.min)return;','if(!I||!I.on||!VFX.sp||!cfg.particles)return;','a soft hit throws sparks'],
 ['const d=vfxDir(nx,ny+0.25,nz,0.85),sp=vfxRg(I.speed)*(0.6+0.7*k);','const d=vfxDir(-nx,ny+0.25,-nz,0.85),sp=vfxRg(I.speed)*(0.6+0.7*k);','a hit throws its sparks into the wall'],
 ['VFX.ci=(i+1)%P.n;','VFX.ci=i+1;','the confetti cursor does not wrap'],
 ['const P=VFX.sp,i=VFX.si,o=i*4,b=VFX.t+(delay||0);','const P=VFX.sp,i=VFX.si,o=i*4,b=VFX.t;','a delay is ignored'],
 ["k=lerp(1,clamp(S.timeScale,VF.slowMin,1),VF.slow);","k=1;",'the clock ignores slow-mo'],
 ["k=lerp(1,clamp(S.timeScale,VF.slowMin,1),VF.slow);","k=lerp(1,clamp(S.timeScale,0,1),1);",'the clock may stop'],
 ["if(P.mesh.visible!==on)P.mesh.visible=on;","P.mesh.visible=true;",'an empty pool is drawn'],
 ["if(any)renderDirty();","",'menus are not kept awake'],
 ["if(e.pooled)fxLightPut(e.l);else e.l.intensity=0;\n   VFX.lights.splice(i,1);","e.l.intensity=0;\n   VFX.lights.splice(i,1);",'a spent light is never returned'],
 ["if(age<0)continue;\n  if(e.pooled&&!e.l){","if(e.pooled&&!e.l){",'a pooled light is borrowed before it starts'],
 ["if(q.ax||q.az){camera.position.x-=q.ax;camera.position.z-=q.az;q.ax=q.az=0;}","",'the old offset is never taken back'],
 ["if(q.af){camera.fov-=q.af;q.af=0;camera.updateProjectionMatrix();}","",'the old zoom is never taken back'],
 ["const C=VF.camera;if(!C||!C.on||S.photo||S.phase==='replay')return;","const C=VF.camera;if(!C||!C.on)return;",'photo and replay take the punch'],
 ["const a=P.A.aP.array;for(let i=0;i<P.n;i++)a[i*4+3]=-1e4;P.A.aP.needsUpdate=true;P.live=0;}\n VFX.t=0;","P.live=0;}\n VFX.t=0;",'a rebase leaves the old births'],
 ["if(cfg.particles){\n  vfxBlast(2,ox,oy,oz,0,0,0,G.core.life","if(true){\n  vfxBlast(2,ox,oy,oz,0,0,0,G.core.life",'a goal ignores the particles switch'],
 ["return cfg.particles?Fi.board:0;","return Fi.board;",'the board waits with particles off'],
 ["const d=vfxDir(dir,0.32,0,S1.cone)","const d=vfxDir(-dir,0.32,0,S1.cone)",'a goal throws its sparks the wrong way'],
 ["if(S.phase!=='win'){S.winT=0;return;}","",'the wait outlives the board'],
 ["VFX.lights.length=0;\n for(const n of VFX.net)n.a=0;","for(const n of VFX.net)n.a=0;",'clear keeps the light envelopes'],
];
let survived=0;
for(const [a,b,label] of MUT){const m=mutate(a,b,label);if(!m.broke){survived++;console.log('  SURVIVED: '+label+(m.drift?' (anchor)':''));}}
console.log('mutations: '+(MUT.length-survived)+'/'+MUT.length+' caught');
process.exit(base.fail||survived?1:0);
