// feel harness. node tools/feel-harness.js
// js/feel.js on live CONFIG with real three: which contacts are a hit and how strong (touch floor, AI share, sweet, one a swing, stale stamps), the hitstop (length, the sim's share
// of a frame, cooldown), the camera shake (applied after lookAt, taken back out exactly, decay, the shove along the shot, the cinematic share, the old S.shake as trauma), the held goal
// (lands after the freeze at the line speed, never after a reset), the blast spin (whole turns, away from the goal, falling off), the follow-through (one hump forward, only on a
// strike's stop), the approach slow-mo, every switch; then the hooks in physics / main / fx / flow / audio, and mutations that must each break it
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10),CR=String.fromCharCode(13);
const rd=f=>fs.readFileSync(f,'utf8').split(CR+NL).join(NL);

const STUB=`
var S={time:100,phase:'play',balls:[],trn:null,timeScale:1,shake:0};
var rods=[],USER=new Set();
function isUserRod(r){return USER.has(r);}
var AU=[],BL=[],SP=[];
var Au={kickBody:function(k,src,hu){AU.push({id:'body',k:k,hu:hu});},goalBoom:function(src){AU.push({id:'boom'});}};
var VF={gold:0xffd27a,spark:0xfff0c0},FXON=true;
function vfxLive(){return FXON;}
function vfxLin(h){return [((h>>16)&255)/255,((h>>8)&255)/255,(h&255)/255];}
function vfxRg(a){return a[0]+(a[1]-a[0])*Math.random();}
function vfxDir(dx,dy,dz,sp){var l=Math.hypot(dx,dy,dz)||1;return [dx/l,dy/l,dz/l];}
function vfxBlast(kind,x,y,z,nx,ny,nz,life,s0,s1,hot,pw,body,delay){BL.push({kind:kind,x:x,y:y,z:z,life:life,s1:s1});}
function vfxSpk(px,py,pz,vx,vy,vz,life){SP.push({x:px,y:py,z:pz,vx:vx,vy:vy,vz:vz,life:life});}
var camera=new THREE.PerspectiveCamera(55,16/9,1,700);camera.position.set(0,68,47);camera.lookAt(0,25,21);
`;
const EXPORT=`;globalThis.X={CONFIG:CONFIG,FEEL:FEEL,FLS:FLS,S:S,cfg:cfg,F:F,MATCH:MATCH,camera:camera,THREE:THREE,USER:USER,BALL_R:BALL_R,
 get rods(){return rods;},set rods(v){rods=v;},get FXON(){return FXON;},set FXON(v){FXON=v;},log:{au:AU,bl:BL,sp:SP},
 feelHit:feelHit,feelFrame:feelFrame,feelHeld:feelHeld,feelGoal:feelGoal,feelGoalFx:feelGoalFx,feelGoalScale:feelGoalScale,feelPose:feelPose,
 feelCamPre:feelCamPre,feelCamPost:feelCamPost,feelReset:feelReset,feelShakeOn:feelShakeOn,feelTrauma:feelTrauma,feelSpin:feelSpin};`;

const THREE_SRC=rd('vendor/three.bundle.js');
function boot(src){
 const ctx={console,Math,JSON,Object,Array,Set,Map,WeakMap,Float32Array,Float64Array,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Uint8ClampedArray,
  ArrayBuffer,DataView,Symbol,Promise,Error,TypeError,RangeError,Number,String,Boolean,Date,RegExp,Proxy,Reflect,setTimeout,clearTimeout,performance,TextDecoder,isNaN,isFinite,
  localStorage:{getItem:()=>null,setItem:()=>{}},document:{getElementById:()=>null,createElement:()=>({style:{}}),documentElement:{style:{setProperty(){}}}}};
 ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;
 vm.runInNewContext(THREE_SRC,ctx);
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),'CONFIG.fx.goalFx.on=true;',STUB,src,EXPORT].join(NL),ctx);
 if(!ctx.X||!ctx.X.FLS)throw new Error('export line did not run');
 return ctx.X;
}

let pass=0,fail=0;const fails=[];
function ok(c,msg){if(c)pass++;else{fail++;fails.push(msg);}}
const near=(a,b,e)=>Math.abs(a-b)<=(e===undefined?1e-6:e);

const ball=(vx,vy,vz,x,y,z)=>({m:{position:{x:x||10,y:y||1.6,z:z||0}},v:{x:vx,y:vy||0,z:vz||0},scored:false});
const rod=(o)=>Object.assign({team:0,x:22.5,kickDir:1,role:'ATT'},o||{});
let FC=null;   // pristine CONFIG.feel, restored before each block
// restored in place: a test holds CONFIG.feel's sub-objects (G = F.goal) across resets
function put(dst,src){for(const k in src){const v=src[k];if(v&&typeof v==='object'&&!Array.isArray(v)&&dst[k]&&typeof dst[k]==='object')put(dst[k],v);else dst[k]=Array.isArray(v)?v.slice():v;}}
function reset(X){
 put(X.FEEL,FC);
 X.S.time=100;X.S.phase='play';X.S.balls=[];X.S.trn=null;X.S.timeScale=1;X.S.shake=0;
 X.cfg.particles=true;X.FXON=true;X.USER.clear();X.rods=[];
 for(const k in X.log)X.log[k].length=0;
 X.feelReset();
}
const clearLog=X=>{for(const k in X.log)X.log[k].length=0;};
const kOf=(X,dv,ai,sw)=>{const F=X.FEEL;let k=Math.min(1,Math.max(0,(dv-F.from)/(F.full-F.from)));if(sw)k=Math.min(1,k+F.sweet);return ai?k*F.ai:k;};
const hsOf=(X,k)=>{const H=X.FEEL.hitstop;return k<H.min?0:(H.ms[0]+(H.ms[1]-H.ms[0])*(k-H.min)/(1-H.min))/1000;};

function hitSuite(X){
 const F=X.FEEL,FLS=X.FLS;
 /* 1. which contacts are a hit, how strong */
 reset(X);let r=rod(),b=ball(100);X.USER.add(r);
 X.feelHit(b,r,F.from-1,false,1,0,0);
 ok(FLS.hs===0&&FLS.tr===0&&X.log.au.length===0&&X.log.sp.length===0,'a touch under `from` does nothing');
 X.feelHit(b,r,F.full,false,1,0,0);
 ok(near(FLS.hs,F.hitstop.ms[1]/1000),'a full player hit freezes for ms[1] ('+FLS.hs+')');
 ok(near(FLS.tr,F.shake.hit),'...adds the full hit trauma');
 ok(X.log.au.length===1&&X.log.au[0].id==='body'&&near(X.log.au[0].k,1)&&X.log.au[0].hu===true,'...plays the body at full strength as the player\'s');
 ok(X.log.sp.length===F.spark.n[1]&&X.log.bl.length===1,'...throws the most sparks and one flash ('+X.log.sp.length+')');
 ok(near(X.log.bl[0].x,b.m.position.x-X.BALL_R),'the flash sits at the contact, not the ball centre');
 reset(X);r=rod();b=ball(100);
 X.feelHit(b,r,F.full,false,1,0,0);
 const kai=kOf(X,F.full,true);
 ok(near(FLS.hs,hsOf(X,kai)),'an AI hit freezes for its share ('+FLS.hs+')');
 ok(near(FLS.tr,F.shake.hit*kai)&&X.log.au[0].hu===false&&near(X.log.au[0].k,kai),'...and shakes and sounds at its share, as the AI\'s');
 ok((X.log.sp.length>0)===(kai>=F.spark.min),'...sparks only from spark.min ('+X.log.sp.length+')');
 reset(X);r=rod();b=ball(100);X.USER.add(r);
 const dvm=(F.from+F.full)/2;X.feelHit(b,r,dvm,true,1,0,0);
 ok(near(X.log.au[0].k,kOf(X,dvm,false,true)),'a sweet strike adds `sweet`');
 /* 2. one a swing; a new match's stamps */
 reset(X);r=rod();X.USER.add(r);const r2=rod({x:-7.5});X.USER.add(r2);b=ball(100);
 X.feelHit(b,r,F.full,false,1,0,0);clearLog(X);
 X.S.time+=F.gap*0.5;X.feelHit(b,r,F.full,false,1,0,0);
 ok(X.log.au.length===0,'the same rod inside `gap` is the same swing');
 X.feelHit(b,r2,F.full,false,1,0,0);
 ok(X.log.au.length===1,'another rod counts');
 clearLog(X);X.S.time+=F.gap;X.feelHit(b,r,F.full,false,1,0,0);
 ok(X.log.au.length===1,'the same rod after `gap` counts');
 clearLog(X);X.S.time=0;X.feelHit(b,r,F.full,false,1,0,0);
 ok(X.log.au.length===1,'a stamp from the last match does not block the next');
 /* 3. gates */
 reset(X);r=rod();X.USER.add(r);b=ball(100);X.S.phase='goal';X.feelHit(b,r,F.full,false,1,0,0);
 ok(X.log.au.length===0&&FLS.hs===0,'nothing outside play');
 reset(X);F.on=false;r=rod();X.USER.add(r);b=ball(100);X.feelHit(b,r,F.full,false,1,0,0);
 ok(X.log.au.length===0&&FLS.hs===0&&FLS.tr===0,'feel.on false: nothing');
 reset(X);F.hitstop.on=false;r=rod();X.USER.add(r);b=ball(100);X.feelHit(b,r,F.full,false,1,0,0);
 ok(FLS.hs===0&&FLS.tr>0&&X.log.au.length===1,'hitstop off: no freeze, the rest still lands');
 reset(X);F.shake.on=false;r=rod();X.USER.add(r);b=ball(100);X.feelHit(b,r,F.full,false,1,0,0);
 ok(FLS.tr===0&&FLS.pvx===0&&FLS.hs>0,'shake off: no trauma, no shove');
 reset(X);F.spark.on=false;r=rod();X.USER.add(r);b=ball(100);X.feelHit(b,r,F.full,false,1,0,0);
 ok(X.log.sp.length===0&&X.log.bl.length===0,'spark off: none');
 reset(X);X.cfg.particles=false;r=rod();X.USER.add(r);b=ball(100);X.feelHit(b,r,F.full,false,1,0,0);
 ok(X.log.sp.length===0&&X.log.bl.length===0,'particles off: none');
 reset(X);X.FXON=false;r=rod();X.USER.add(r);b=ball(100);X.feelHit(b,r,F.full,false,1,0,0);
 ok(X.log.sp.length===0,'vfx off: none');
 reset(X);F.sound.on=false;r=rod();X.USER.add(r);b=ball(100);X.feelHit(b,r,F.full,false,1,0,0);
 ok(X.log.au.length===0,'sound off: no body');
 const dvAt=k=>F.from+k*(F.full-F.from);
 reset(X);r=rod();X.USER.add(r);b=ball(100);X.feelHit(b,r,dvAt(F.spark.min-0.05),false,1,0,0);
 ok(X.log.sp.length===0&&X.log.bl.length===0&&X.log.au.length===1,'a player hit under spark.min throws none');
 reset(X);r=rod();X.USER.add(r);b=ball(100);X.feelHit(b,r,dvAt((F.spark.min+1)/2),false,1,0,0);
 ok(X.log.sp.length===Math.round((F.spark.n[0]+F.spark.n[1])/2),'half way up the spark range throws half way up the count ('+X.log.sp.length+')');
 /* 4. the hitstop's share of a frame, cooldown */
 reset(X);r=rod();X.USER.add(r);b=ball(100);X.feelHit(b,r,F.full,false,1,0,0);
 const hs=FLS.hs,dt=1/60;let used=0,n=0;
 ok(X.feelHeld(),'held while frozen');
 while(X.feelHeld()&&n<50){used+=X.feelFrame(dt);n++;}
 ok(n===Math.ceil(hs/dt-1e-9)&&near(used,n*dt-hs,1e-9),'the sim gets the frames less the freeze ('+used.toFixed(4)+' of '+(n*dt).toFixed(4)+')');
 ok(near(X.feelFrame(dt),dt),'then the whole frame');
 X.S.time+=1;const r3=rod({x:-37.5});X.USER.add(r3);X.feelHit(b,r3,F.full,false,1,0,0);
 ok(FLS.hs===0,'no freeze inside the cooldown');
 for(let i=0;i<Math.ceil(F.hitstop.gap/dt)+1;i++)X.feelFrame(dt);
 X.S.time+=1;X.feelHit(b,r,F.full,false,1,0,0);
 ok(FLS.hs>0,'a freeze again after it');
 const hs1=FLS.hs;X.feelHit(b,rod({x:52.5}),F.full,false,1,0,0);
 ok(FLS.hs===hs1,'a hit during a freeze does not stretch it');
}

function goalSuite(X){
 const F=X.FEEL,FLS=X.FLS,G=F.goal,dt=1/60;
 /* 5. the held goal */
 reset(X);let b=ball(120,0,0,X.F.L/2+2);X.S.balls=[b];let gone=0;
 ok(X.feelGoal(0,b,()=>gone++)===true&&near(FLS.hs,G.freeze),'a goal holds the frame for `freeze`');
 b.v.x=10;   // the rest of the step ran it on into the net
 let k=0;while(X.feelHeld()&&k<60){X.feelFrame(dt);ok(gone===0||!X.feelHeld(),'not landed while frozen');k++;}
 ok(gone===1,'lands once the freeze ends');
 ok(near(b.v.x,120),'...at the speed it crossed the line');
 X.feelFrame(dt);ok(gone===1,'and only once');
 reset(X);b=ball(120,0,0,X.F.L/2+2);X.S.balls=[b];gone=0;
 X.feelGoal(0,b,()=>gone++);X.feelReset();for(let i=0;i<30;i++)X.feelFrame(dt);
 ok(gone===0,'a reset (new match) drops a held goal');
 ok(X.feelGoal(0,b,()=>0)===true,'...and the next goal holds again');
 reset(X);b=ball(120,0,0,X.F.L/2+2);X.S.balls=[b];gone=0;
 X.feelGoal(0,b,()=>gone++);X.S.balls=[];for(let i=0;i<30;i++)X.feelFrame(dt);
 ok(gone===0,'a held goal whose ball is gone never lands');
 reset(X);b=ball(120,0,0,X.F.L/2+2);X.S.balls=[b];gone=0;
 X.feelGoal(0,b,()=>gone++);const b2=ball(120,0,0,-X.F.L/2-2);
 ok(X.feelGoal(1,b2,()=>gone++)===false,'a second goal during the hold lands at once');
 reset(X);G.on=false;b=ball(120);ok(X.feelGoal(0,b,()=>0)===false,'goal off: lands at once');
 reset(X);G.freeze=0;b=ball(120);ok(X.feelGoal(0,b,()=>0)===false,'freeze 0: lands at once');
 /* 6. the celebration's time-scale */
 reset(X);ok(near(X.feelGoalScale(),G.after),'the celebration runs at `after`');
 G.after=null;ok(near(X.feelGoalScale(),X.MATCH.goalSlowmo),'after null: the match\'s slow-mo');
 reset(X);G.on=false;ok(near(X.feelGoalScale(),X.MATCH.goalSlowmo),'goal off: the match\'s slow-mo');
 /* 7. the blast: trauma, boom, spin */
 reset(X);
 const R=[-52.5,-37.5,-22.5,-7.5,7.5,22.5,37.5,52.5].map(x=>rod({x:x,kickDir:x<0?1:-1,role:Math.abs(x)===52.5?'GK':'X'}));X.rods=R;
 X.feelGoalFx(0,ball(0));
 ok(near(FLS.tr,G.shake),'the blast adds its trauma');
 ok(X.log.au.some(e=>e.id==='boom'),'the sub drop plays');
 const sp=FLS.spin;
 ok(!!sp&&sp.m.get(R[7])&&sp.m.get(R[7]).n<=-1,'the keeper beside the goal turns, feet away from it (team 0 scores at +x)');
 ok(!sp.m.get(R[0]),'the far keeper stands still');
 ok(Math.abs(sp.m.get(R[7]).n)>=Math.abs((sp.m.get(R[4])||{n:0}).n),'it falls off with distance');
 ok(sp.m.get(R[7]).dl<(sp.m.get(R[5])||{dl:9}).dl,'the wave reaches the near rods first');
 X.S.phase='goal';
 ok(near(X.feelPose(R[7],0,0),0,1e-9),'no turn before the wave arrives (t 0)');
 sp.t=sp.T*0.5+sp.m.get(R[7]).dl;const mid=X.feelPose(R[7],0,0);
 ok(mid<0&&mid>sp.m.get(R[7]).n*6.2832,'part way round half way through');
 sp.t=99;const end=X.feelPose(R[7],0,0);
 ok(near(end,sp.m.get(R[7]).n*6.2832,1e-6)&&near(((end%6.2832)+6.2832)%6.2832%6.2832,0,1e-3)||near(Math.abs(end%6.2832),6.2832,1e-3),'it ends on whole turns, men upright');
 X.S.phase='count';ok(near(X.feelPose(R[7],0,0),0,1e-9)&&FLS.spin===null,'the count clears it');
 reset(X);X.rods=R;X.feelGoalFx(1,ball(0));ok(FLS.spin.m.get(R[0])&&FLS.spin.m.get(R[0]).n>=1,'team 1 scores at -x: that keeper turns the other way');
 reset(X);X.rods=R;G.spin.on=false;X.feelGoalFx(0,ball(0));ok(FLS.spin===null&&FLS.tr>0,'spin off: no turn, still the trauma');
 reset(X);X.rods=R;G.boom.on=false;X.feelGoalFx(0,ball(0));ok(!X.log.au.some(e=>e.id==='boom'),'boom off: silent');
 reset(X);X.rods=R;G.on=false;X.feelGoalFx(0,ball(0));ok(FLS.spin===null&&FLS.tr===0&&X.log.au.length===0,'goal off: no blast extras');
 // the same spin for another phase (the walkout's flourish in the count, js/show.js)
 reset(X);X.rods=R;X.feelSpin(new Map([[R[2],{n:1,dl:0.2}]]),0.5,'count');X.S.phase='count';
 FLS.spin.t=0.45;const wk=X.feelPose(R[2],0,0);
 ok(wk>0&&wk<6.2832&&FLS.spin!==null,'a count spin turns its rod during the count');
 X.S.phase='play';X.feelPose(R[2],0,0);ok(FLS.spin===null,'...and ends with the count');
 X.feelSpin(new Map([[R[2],{n:1,dl:0}]]),0.5,'count');X.feelSpin(null);ok(FLS.spin===null,'feelSpin(null) stops a spin');
 /* 8. the approach slow-mo */
 const gkx=52.5,A=G.approach,L2=X.F.L/2;
 const appr=(o)=>{reset(X);X.rods=R;X.S.timeScale=1;const p=o.p||[gkx+A.past+1,2,0],v=o.v||[110,0,0],bb=ball(v[0],v[1],v[2],p[0],p[1],p[2]);Object.assign(bb,o.b||{});X.S.balls=[bb];if(o.phase)X.S.phase=o.phase;if(o.pre)o.pre();X.feelFrame(1/60);return X.S.timeScale;};
 ok(near(appr({}),A.scale),'a ball past the keeper going in slows to `scale`');
 ok(appr({p:[gkx+A.past+1,2,8],v:[110,0,60]})===1,'one going wide does not');
 ok(appr({p:[gkx+A.past-1,2,0]})===1,'one not yet clear of the keeper does not');
 ok(appr({p:[L2-0.5,2,0],v:[A.minV-1,0,0]})===1,'a slow one does not');
 ok(appr({p:[gkx+A.past+1,X.F.goalH,0]})===1,'one over the bar does not');
 ok(appr({p:[gkx+A.past+1,2,0],v:[(L2+X.BALL_R-gkx-A.past-1)/(A.lead*1.5),0,0]})===1||(L2+X.BALL_R-gkx-A.past-1)/(A.lead*1.5)<A.minV,'one further than `lead` from the line does not');
 ok(appr({b:{noGoal:1}})===1,'a ball that cannot score there does not');
 ok(appr({phase:'goal'})===1,'nothing outside play');
 ok(appr({pre:()=>{X.S.trn={};}})===1,'nothing in training');
 ok(near(appr({p:[-(gkx+A.past+1),2,0],v:[-110,0,0]}),A.scale),'the other end too');
 ok(appr({pre:()=>{G.approach.on=false;}})===1,'approach off: none');
}

function poseSuite(X){
 const F=X.FEEL,FLS=X.FLS,W=F.swing,dt=1/60;
 /* 9. follow-through: one hump forward on a strike's stop */
 const run=(r,angs)=>{const out=[];for(const a of angs)out.push(X.feelPose(r,a,dt));return out;};
 reset(X);let r=rod();
 let o=run(r,[0,0,0,0.85].concat(Array(40).fill(0.85)));
 const pk=Math.max.apply(null,o),mn=Math.min.apply(null,o);
 ok(pk>W.over*0.6&&pk<=W.max+1e-9,'a strike stopping dead runs the drawn leg on ('+pk.toFixed(3)+' rad)');
 ok(mn>=0,'never behind the real leg');
 ok(o[o.length-1]===0,'back on the real leg within a few hundred ms');
 ok(o[3]===0,'nothing on the frame the leg is still moving');
 reset(X);r=rod({kickDir:-1});o=run(r,[0,0,0,-0.85].concat(Array(20).fill(-0.85)));
 ok(Math.min.apply(null,o)<-W.over*0.6&&Math.max.apply(null,o)<=0,'a rod kicking toward -x runs on toward -x');
 reset(X);r=rod();let a=0,ea=[];for(let i=0;i<40;i++){a+=(0.85-a)*(1-Math.exp(-6*dt));ea.push(a);}
 o=run(r,[0].concat(ea));ok(Math.max.apply(null,o)===0,'an eased pose (a pin settling) does not overshoot');
 reset(X);r=rod();o=run(r,[0,0,-1.3].concat(Array(20).fill(-1.3)));
 ok(Math.max.apply(null,o)===0&&Math.min.apply(null,o)===0,'a raise stopping does not');
 reset(X);r=rod();run(r,[0,0,0.85,0.85]);const h0=X.feelPose(r,0.85,dt);
 FLS.hs=0.05;const h1=X.feelPose(r,0.85,dt),h2=X.feelPose(r,0.85,dt);
 ok(near(h1,h2)&&h1>0,'a freeze holds the drawn leg where it is');
 reset(X);W.on=false;r=rod();o=run(r,[0,0,0.85,0.85,0.85]);ok(Math.max.apply(null,o)===0,'swing off: none');
 reset(X);F.on=false;r=rod();o=run(r,[0,0,0.85,0.85,0.85]);ok(Math.max.apply(null,o)===0,'feel off: none');
 reset(X);r=rod();o=run(r,[3.0,3.0,-2.6].concat(Array(20).fill(-2.6)));   // the snake's wrap: +3.0 to -2.6 is 0.68 forward, not 5.6 back
 ok(Math.max.apply(null,o)>W.over*0.3&&Math.min.apply(null,o)>=0,'a strike through the angle wrap runs on like any other');
}

function camSuite(X){
 const F=X.FEEL,FLS=X.FLS,K=F.shake,cam=X.camera,dt=1/60;
 const P0=cam.position.clone(),Q0=cam.quaternion.clone();
 const restore=()=>{cam.position.copy(P0);cam.quaternion.copy(Q0);};
 const ang=()=>2*Math.acos(Math.min(1,Math.abs(cam.quaternion.dot(Q0))));
 /* 10. on after lookAt, out again exactly */
 reset(X);restore();X.feelTrauma(1);X.feelCamPost(dt,false);
 const moved=cam.position.distanceTo(P0),turned=ang();
 ok(moved>1e-4&&turned>1e-4,'a full trauma moves and turns the camera');
 ok(turned<=Math.hypot(K.rot[0],K.rot[1],K.rot[2])*Math.PI/180*1.05,'...no more than rot');
 X.feelCamPre();
 ok(cam.position.distanceTo(P0)<1e-9&&ang()<1e-7,'pre takes it back out exactly');
 X.feelCamPost(dt,false);cam.position.x+=5;let P1=cam.position.clone(),Q1=cam.quaternion.clone();X.feelCamPre();
 ok(cam.position.distanceTo(P1)<1e-12&&cam.quaternion.equals(Q1),'a camera someone else moved (a replay) is left alone');
 reset(X);restore();K.move=0;X.feelTrauma(1);X.feelCamPost(dt,false);X.feelCamPre();X.feelCamPre();
 ok(cam.position.distanceTo(P0)<1e-9&&ang()<1e-7,'pre takes a turn out once, not twice');
 K.move=FC.shake.move;
 /* 11. decay, pow, cine */
 reset(X);restore();X.feelTrauma(1);for(let i=0;i<Math.ceil(60/K.decay)+2;i++){X.feelCamPre();X.feelCamPost(dt,false);}
 X.feelCamPre();ok(FLS.tr===0&&cam.position.distanceTo(P0)<1e-9,'trauma runs out');
 const amp=(tr,cine)=>{reset(X);restore();X.feelTrauma(tr);let m=0;for(let i=0;i<20;i++){X.FLS.tr=tr;X.feelCamPost(dt,cine);m=Math.max(m,ang());X.feelCamPre();}return m;};
 const a1=amp(1,false),aH=amp(0.5,false),aC=amp(1,true);
 ok(aH<a1*Math.pow(0.5,K.pow)*1.3&&aH>a1*Math.pow(0.5,K.pow)*0.7,'shake goes as trauma^pow ('+(aH/a1).toFixed(3)+')');
 ok(aC<a1*K.cine*1.3&&aC>a1*K.cine*0.7,'the cinematic camera takes its share');
 /* 12. the old S.shake becomes trauma */
 reset(X);restore();X.S.shake=1;X.feelCamPost(0,false);
 ok(X.S.shake===0&&near(FLS.tr,K.legacy),'S.shake is read as trauma and spent');
 reset(X);restore();K.on=false;X.feelTrauma(1);X.S.shake=1;X.feelCamPost(dt,false);
 ok(cam.position.distanceTo(P0)<1e-9&&cam.quaternion.equals(Q0)&&X.S.shake===1&&FLS.tr===0,'shake off: camera untouched, S.shake left to the old shake, no trauma kept');
 ok(X.feelShakeOn()===false,'...and feelShakeOn says so');
 /* 13. the shove along the shot */
 reset(X);restore();K.rot=[0,0,0];K.move=0;const r=rod();X.USER.add(r);
 X.feelHit(ball(100,0,0),r,F.full,false,1,0,0);
 let mx=0,mz=0;for(let i=0;i<60;i++){X.feelCamPost(dt,false);mx=Math.max(mx,cam.position.x-P0.x);mz=Math.max(mz,Math.abs(cam.position.z-P0.z));X.feelCamPre();}
 ok(mx>K.push*0.75&&mx<K.push*1.15,'the camera is shoved along the shot by about `push` ('+mx.toFixed(3)+')');
 ok(mz<1e-6,'...and only along it');
 X.feelCamPost(dt,false);ok(Math.abs(cam.position.x-P0.x)<0.02,'...and settles back');
}

function hookSuite(){
 const P=rd('js/physics.js'),M=rd('js/main.js'),FX=rd('js/fx.js'),FL=rd('js/flow.js'),AU=rd('js/audio.js'),H=rd('index.html');
 ok(P.split('if(aim&&typeof feelHit===\'function\')feelHit(b,r,Math.hypot(b.v.x-V0.x,b.v.y-V0.y,b.v.z-V0.z),').length===3,'both contact passes report hits, first touches only');
 ok(P.includes('if(sweet){if(!fsh)S.shake=')&&P.includes('if(-vn>KICK.hardHit&&!fsh)')&&P.includes('if(-vn>KICK.hardHit&&!(typeof feelShakeOn===\'function\'&&feelShakeOn()))'),'the old kick shake stands down when feel owns the shake');
 ok(M.includes('feelFrame(rdt)')&&M.includes('S.matchTime+=sdt')&&M.includes('physAcc+=sdt*S.timeScale'),'the frame: the sim and match clock take the freeze');
 ok(M.includes('!(fh&&feelHeld())'),'a freeze starting mid-frame stops the steps');
 ok(M.includes('feelPose(r,a,rdt)'),'the drawn rods take feelPose');
 ok(FX.includes('if(fl)feelCamPre();')&&FX.includes('if(fl)feelCamPost(rdt,false);')&&FX.includes('if(fl)feelCamPost(rdt,true);vfxCamPost(rdt);'),'the camera: pre and post round both paths, inside the punch');
 ok(FX.includes('if(S.shake>0&&!(fl&&feelShakeOn()))'),'the old camera shake stands down');
 ok(FL.includes('feelGoal(team,b,()=>goalLand(team,b))')&&FL.includes('if(typeof feelGoalFx===\'function\')feelGoalFx(team,b);'),'the goal is held, then lands with the blast extras');
 ok(FL.split('S.timeScale=gs;').length===3,'both goal phases take feelGoalScale');
 ok(FL.includes('if(typeof feelReset===\'function\')feelReset();'),'a match start resets');
 ok(AU.includes('l.g.gain.setTargetAtTime(P.lvl*P.w[i]*l.v*this.vol*dm,t,gl)')&&AU.includes("vol:(a||1)*(1-this.dkLvl())"),'loops and bumps duck');
 ok(H.includes("'js/boost.js','js/feel.js',"),'index.html loads js/feel.js');
}

function run(src){const X=boot(src);if(!FC)FC=JSON.parse(JSON.stringify(X.FEEL));pass=0;fail=0;fails.length=0;hitSuite(X);goalSuite(X);poseSuite(X);camSuite(X);hookSuite();return {pass,fail,fails:fails.slice()};}

const SRC=rd('js/feel.js');
const base=run(SRC);
console.log('feel harness: '+base.pass+' assertions, '+base.fail+' failing');
for(const f of base.fails)console.log('  FAIL '+f);

function mutate(from,to,label){
 if(!SRC.includes(from)){console.log('  MUTATION ANCHOR DRIFTED: '+label);return {broke:false,drift:true};}
 let r;try{r=run(SRC.replace(from,to));}catch(e){return {broke:true};}
 return {broke:r.fail>base.fail};
}
const MUT=[
 ["if(!FEEL.on||S.phase!=='play'||!(dv>=FEEL.from))return;","if(!FEEL.on||S.phase!=='play')return;",'a touch is a hit'],
 ["if(!FEEL.on||S.phase!=='play'||!(dv>=FEEL.from))return;","if(!FEEL.on||!(dv>=FEEL.from))return;",'hits outside play'],
 ['if(t0!=null&&S.time>=t0&&S.time-t0<FEEL.gap)return;','','every contact of a swing is a hit'],
 ['if(t0!=null&&S.time>=t0&&S.time-t0<FEEL.gap)return;','if(t0!=null&&S.time-t0<FEEL.gap)return;','a stale stamp blocks the next match'],
 ['if(!hu)k*=FEEL.ai;','','an AI hit lands as hard as the player\'s'],
 ['if(sweet)k=Math.min(1,k+FEEL.sweet);','','a sweet strike adds nothing'],
 ['if(H&&k>=H.min&&FLS.hsCd<=0&&!(FLS.hs>0))','if(H&&k>=H.min&&!(FLS.hs>0))','no hitstop cooldown'],
 ['if(H&&k>=H.min&&FLS.hsCd<=0&&!(FLS.hs>0))','if(H&&k>=H.min&&FLS.hsCd<=0)','a hit stretches a freeze'],
 ['FLS.hs=lerp(H.ms[0],H.ms[1],(k-H.min)/Math.max(1e-6,1-H.min))/1000;','FLS.hs=H.ms[1]/1000;','the freeze ignores the strength'],
 ['if(K){feelTrauma(K.hit*k);','if(K){feelTrauma(K.hit);','the shake ignores the strength'],
 ['const i=K.push*k*K.pushHz*6.2832*Math.E/h;','const i=K.push*k*K.pushHz*6.2832/h;','the shove is short of push'],
 ['if(P&&k>=P.min&&cfg.particles&&','if(P&&cfg.particles&&','any hit throws sparks'],
 ['if(P&&k>=P.min&&cfg.particles&&','if(P&&k>=P.min&&','particles off still sparks'],
 ['n=Math.round(lerp(P.n[0],P.n[1],u));','n=P.n[1];','sparks ignore the strength'],
 ['x=p.x-nx*BALL_R,','x=p.x,','the flash sits at the ball centre'],
 ["if(feelPart('sound'))Au.kickBody(k,b,hu);",'','no body sound'],
 ["if(feelPart('sound'))Au.kickBody(k,b,hu);","if(feelPart('sound'))Au.kickBody(k,b,true);",'every hit sounds as the player\'s'],
 ['const u=Math.min(FLS.hs,rdt);FLS.hs-=u;','const u=0;FLS.hs-=rdt;','the freeze takes nothing from the sim'],
 ['return rdt-u;','return 0;','a freeze ending mid-frame drops the rest of the frame'],
 ['FLS.hsCd=FEEL.hitstop?FEEL.hitstop.gap:0;','','no cooldown after a freeze'],
 ['if(FLS.goal)feelGoalGo();}','}','a held goal never lands'],
 ["if(!G||!(G.freeze>0)||FLS.goal)return false;","if(!G||!(G.freeze>0))return false;",'a second goal waits on the first'],
 ["if(!G||!(G.freeze>0)||FLS.goal)return false;","if(!G||FLS.goal)return false;",'freeze 0 still holds'],
 ["if(!g||S.phase!=='play'||S.balls.indexOf(g.b)<0)return;","if(!g)return;",'a held goal lands after its ball is gone'],
 ['g.b.v.x=g.v.x;g.b.v.y=g.v.y;g.b.v.z=g.v.z;','','the goal lands at the net\'s speed'],
 ['FLS.hs=FLS.hsCd=FLS.tr=0;FLS.goal=FLS.spin=null;','FLS.hs=FLS.hsCd=FLS.tr=0;FLS.spin=null;','a reset keeps a held goal'],
 ['return G&&G.after!=null?G.after:MATCH.goalSlowmo;','return MATCH.goalSlowmo;','`after` is ignored'],
 ['feelTrauma(G.shake);','','the blast does not shake'],
 ['if(G.boom&&G.boom.on)Au.goalBoom(b);','','no sub drop'],
 ['if(G.boom&&G.boom.on)Au.goalBoom(b);','Au.goalBoom(b);','boom off still booms'],
 ['sg=-Math.sign(gx)','sg=Math.sign(gx)','the men turn toward the blast'],
 ['n=Math.round(W.turns*Math.exp(-d/W.fall))','n=Math.round(W.turns)','the spin does not fall off'],
 ['m.set(r,{n:n*sg,dl:d/W.speed});','m.set(r,{n:n*sg,dl:0});','the wave arrives everywhere at once'],
 ['o=e.n*6.2832*(1-Math.pow(1-u,3));','o=e.n*6.2832*u*0.9;','the spin does not end on whole turns'],
 ["if(P&&S.phase!==P.ph)FLS.spin=null;","if(false)FLS.spin=null;",'the spin outlives its phase'],
 ["FLS.spin=m?{t:0,T,m,ph}:null;","FLS.spin=m?{t:0,T,m,ph:'goal'}:null;",'every spin belongs to the goal phase'],
 ["else if(P){",'else if(P&&false){','no spin at all'],
 ['lost=s.w-Math.max(w,0),','lost=Math.abs(s.w-w),','a backward stop overshoots'],
 ['if(lost>W.decel)s.v+=','if(lost>0)s.v+=','an eased pose overshoots'],
 ['if(s.o<0){s.o=0;s.v=0;}','','the drawn leg rings behind the real one'],
 ['if(FLS.hs>0||!(rdt>0))return o+s.o*r.kickDir;','if(!(rdt>0))return o+s.o*r.kickDir;','the follow-through runs through a freeze'],
 ['d-=6.2832*Math.round(d/6.2832);','','an angle wrap reads as a full turn back'],
 ['return o+s.o*r.kickDir;\n}','return o+s.o;\n}','a -x rod overshoots backward'],
 ['p.x-=C.dx;p.y-=C.dy;p.z-=C.dz;camera.quaternion.multiply(C.qi);','p.x-=C.dx;p.y-=C.dy;p.z-=C.dz;','the turn is never taken back out'],
 ['if(Math.abs(p.x-C.x)+Math.abs(p.y-C.y)+Math.abs(p.z-C.z)>1e-6)return;','','a moved camera is undone anyway'],
 ['const C=FLS.cam;if(!C.on)return;C.on=false;','const C=FLS.cam;if(!C.on)return;','pre undoes twice'],
 ["if(S.shake>0){feelTrauma(S.shake*K.legacy);S.shake=0;}",'','the old S.shake is lost'],
 ['FLS.tr=Math.max(0,FLS.tr-rdt*K.decay);','','trauma never runs out'],
 ['const s=Math.pow(FLS.tr,K.pow)*(cine?K.cine:1)','const s=FLS.tr*(cine?K.cine:1)','shake is linear in trauma'],
 ['const s=Math.pow(FLS.tr,K.pow)*(cine?K.cine:1)','const s=Math.pow(FLS.tr,K.pow)','the cinematic camera shakes in full'],
 ["if(!K){FLS.tr=0;return;}","if(!K)return;",'shake off still holds trauma'],
 ['C.dz=FLS.pz*sh;','C.dz=FLS.pvx*0.01;','the shove leaks across the shot'],
 ["S.timeScale=Math.min(S.timeScale,A.scale);",'','no approach slow-mo'],
 ['p.x*sg<Math.abs(gk.x)+A.past','p.x*sg<Math.abs(gk.x)-30','slow-mo before the keeper'],
 ['Math.abs(p.z+v.z*t)>F.goalHalf-BALL_R','false','slow-mo for a ball going wide'],
 ['if(vx<A.minV||b.overBar===sg||b.noGoal===sg)continue;','if(b.overBar===sg||b.noGoal===sg)continue;','slow-mo for a crawling ball'],
 ['if(vx<A.minV||b.overBar===sg||b.noGoal===sg)continue;','if(vx<A.minV)continue;','slow-mo for a ball that cannot score'],
 ["if(!A||!A.on||S.phase!=='play'||S.trn||FLS.hs>0)return;","if(!A||!A.on||S.phase!=='play'||FLS.hs>0)return;",'slow-mo in training'],
 ['p.y+Math.max(0,v.y)*t>F.goalH-BALL_R||','','slow-mo for a ball over the bar'],
];
let survived=0;
for(const [a,b,label] of MUT){const m=mutate(a,b,label);if(!m.broke){survived++;console.log('  SURVIVED: '+label+(m.drift?' (anchor)':''));}}
console.log('mutations: '+(MUT.length-survived)+'/'+MUT.length+' caught');
process.exit(base.fail||survived?1:0);
