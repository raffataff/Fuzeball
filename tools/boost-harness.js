// boost harness. node tools/boost-harness.js
// js/boost.js on live CONFIG with a stub table: which contacts are a power hit (boosted, a swing, fast enough, one a swing), what one throws (flash, ring, sparks scaled by speed, sound, a rate-limited
// camera punch, a pooled light), the ball's comet (set, ended by anyone else's touch, glints, decay, the trail sprite), stale stamps from a last match, the particles switch; then mutations that must each break it
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10),CR=String.fromCharCode(13);
const rd=f=>fs.readFileSync(f,'utf8').split(CR+NL).join(NL);

const STUB=`
var Col=function(){this.r=0;this.g=0;this.b=0;};
Col.prototype.set=function(h){this.r=((h>>16)&255)/255;this.g=((h>>8)&255)/255;this.b=(h&255)/255;return this;};
Col.prototype.lerp=function(o,t){this.r+=(o.r-this.r)*t;this.g+=(o.g-this.g)*t;this.b+=(o.b-this.b)*t;return this;};
Col.prototype.copy=function(o){this.r=o.r;this.g=o.g;this.b=o.b;return this;};
Col.prototype.clone=function(){return new Col().copy(this);};
Col.prototype.multiplyScalar=function(k){this.r*=k;this.g*=k;this.b*=k;return this;};
var BGeo=function(){this.attributes={};this.drawRange=null;};BGeo.prototype.setAttribute=function(k,a){this.attributes[k]=a;};BGeo.prototype.setDrawRange=function(a,b){this.drawRange=[a,b];};
var BAttr=function(a,n){this.array=a;this.itemSize=n;this.needsUpdate=false;};
var THREE={Color:Col,BufferGeometry:BGeo,BufferAttribute:BAttr,AdditiveBlending:2,Points:function(g,m){this.geometry=g;this.material=m;this.visible=true;this.renderOrder=0;},PointsMaterial:function(o){Object.assign(this,o);}};
function kitLin(h){return new Col().set(h);}
function mkMat(h){return {color:new Col().set(h),emissive:new Col().set(h),emissiveIntensity:0.55};}
var teamGlow=[mkMat(0xcc2222),mkMat(0x2244cc)],rodCustomMats=[];
var SCENE=[],scene={add:function(o){SCENE.push(o);}},spriteTex={},camera={position:{x:0,y:60,z:40}};
var S={time:0,phase:'play',balls:[],eff:[{boost:0,frozen:0,big:0},{boost:0,frozen:0,big:0}]};
var rods=[];
var AU=[];var Au={play:function(id,o){AU.push({id:id,o:o});return false;}};
var FXON=true,BL=[],SP=[],PU=[],LI=[],BU=[];
function vfxLive(){return FXON;}
function vfxLin(h){var c=new Col().set(h);return [c.r,c.g,c.b];}
function vfxRg(a){return a[0]+(a[1]-a[0])*Math.random();}
function vfxDir(dx,dy,dz,sp){var x=dx+(Math.random()*2-1)*sp,y=dy+(Math.random()*2-1)*sp,z=dz+(Math.random()*2-1)*sp,l=Math.hypot(x,y,z)||1;return [x/l,y/l,z/l];}
function vfxBlast(kind,x,y,z,nx,ny,nz,life,s0,s1,hot,pw,body,delay){BL.push({kind:kind,x:x,y:y,z:z,life:life,s0:s0,s1:s1,pw:pw,delay:delay||0});}
function vfxSpk(px,py,pz,vx,vy,vz,life,c,pw,size,drag,grav,tail,flags,delay){SP.push({x:px,y:py,z:pz,vx:vx,vy:vy,vz:vz,life:life,pw:pw,size:size,flags:flags,delay:delay||0});}
function vfxPunch(dx,dz,k){PU.push({dx:dx,dz:dz,k:k});}
function vfxLight(l,pooled,x,y,z,col,dist,peak,hold,decay,delay){LI.push({x:x,y:y,z:z,col:col,peak:peak,pooled:pooled});}
function burst(p,c1,c2,n,sp){BU.push({n:n,x:p.x});}
`;
const EXPORT=`;globalThis.X={CONFIG:CONFIG,BO:BO,BOS:BOS,BOG:BOG,S:S,cfg:cfg,THREE:THREE,SCENE:SCENE,teamGlow:teamGlow,PLAYER_H:PLAYER_H,ROD_H:ROD_H,F:F,
 set rodCustomMats(v){rodCustomMats=v;},get rodCustomMats(){return rodCustomMats;},mkMat:mkMat,
 get rods(){return rods;},set rods(v){rods=v;},
 get FXON(){return FXON;},set FXON(v){FXON=v;},
 log:{au:AU,bl:BL,sp:SP,pu:PU,li:LI,bu:BU},
 boostTouch:boostTouch,boostHit:boostHit,boostUpdate:boostUpdate,boostTrail:boostTrail,boostClear:boostClear,boostBuild:boostBuild,boostBoot:boostBoot,boostRing:boostRing};`;

function boot(src){
 const EL={style:{},offsetWidth:0,classList:{add(){},remove(){}},getContext:function(){return new Proxy({},{get:()=>function(){},set:()=>true});}};
 const ctx={console,Math,JSON,Object,Array,Set,Map,isNaN,isFinite,RegExp,String,Float32Array,Proxy,localStorage:{getItem:()=>null,setItem:()=>{}},
  document:{getElementById:()=>EL,createElement:()=>EL,body:{appendChild(){}},documentElement:{style:{setProperty(){}}}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),STUB,src,EXPORT].join(NL),ctx);
 if(!ctx.X||!ctx.X.BO)throw new Error('export line did not run');
 return ctx.X;
}

let pass=0,fail=0;const fails=[];
function ok(c,msg){if(c)pass++;else{fail++;fails.push(msg);}}
const near=(a,b,e)=>Math.abs(a-b)<=(e===undefined?1e-6:e);

const ball=(vx,vy,vz)=>({m:{position:{x:10,y:1.9,z:4}},v:{x:vx,y:vy||0,z:vz||0},pw:0});
const rod=(team,o)=>Object.assign({team:team,kickT:0.05,shotOn:false,angVel:0,pwAt:0},o||{});
function reset(X){
 X.S.time=100;X.S.phase='play';X.S.eff[0].boost=X.S.time+10;X.S.eff[1].boost=0;X.S.balls=[];
 X.cfg.particles=true;X.FXON=true;X.BO.on=true;
 for(const k in X.log)X.log[k].length=0;
 X.BOS.pn[0]=X.BOS.pn[1]=-9;
 X.rods=[];X.boostClear();   // the comet tests have no table: the state layer has no boots to light
}
const clearLog=X=>{for(const k in X.log)X.log[k].length=0;};

function suite(X){
 const BO=X.BO,T=BO.trail;
 /* 1. which contacts count */
 reset(X);
 let b=ball(90,0,0),r=rod(0);
 X.boostTouch(b,r,false);
 ok(X.log.au.length===1&&X.log.au[0].id==='power_hit'&&near(X.log.au[0].o.p,90),'a boosted strike leaving at 90 plays the power hit at that speed');
 ok(X.log.bl.length===2&&X.log.bl.some(e=>e.kind===2)&&X.log.bl.some(e=>e.kind===1),'a flash and a ring');
 ok(X.log.sp.length>=BO.sparks.n[0]&&X.log.sp.length<=BO.sparks.n[1],'a fan of sparks ('+X.log.sp.length+')');
 ok(b.pw>=T.life*0.7-1e-9&&b.pw<=T.life*1.2+1e-9&&b.pwRod===r,'the ball carries a comet');
 ok(near(r.pwAt,X.S.time+BO.gap),'the rod is stamped for one a swing');
 ok(X.log.pu.length===1&&X.log.li.length===1&&X.log.li[0].pooled===true,'a camera punch and a pooled light');
 ok(X.log.bl.every(e=>e.x===10&&e.z===4)&&X.log.bl.find(e=>e.kind===1).y===0.3,'at the ball, the ring on the pitch');

 reset(X);X.S.eff[0].boost=0;b=ball(90);X.boostTouch(b,rod(0),false);
 ok(X.log.au.length===0&&X.log.bl.length===0&&b.pw===0,'an unboosted team gets nothing');
 reset(X);X.S.eff[0].boost=X.S.time-0.01;b=ball(90);X.boostTouch(b,rod(0),false);
 ok(X.log.au.length===0,'a boost that has just run out gets nothing');
 reset(X);b=ball(90);X.boostTouch(b,rod(1),false);
 ok(X.log.au.length===0,'boost is the other team\'s');
 reset(X);b=ball(BO.min-5);X.boostTouch(b,rod(0),false);
 ok(X.log.au.length===0&&b.pw===0,'a soft touch (under min) is not a power hit');
 reset(X);b=ball(BO.min+1);X.boostTouch(b,rod(0),false);
 ok(X.log.au.length===1,'just over min is');
 reset(X);b=ball(90);X.boostTouch(b,rod(0,{kickT:-1}),false);
 ok(X.log.au.length===0,'a slide or a shove (no swing) is not');
 reset(X);b=ball(90);X.boostTouch(b,rod(0,{kickT:-1,shotOn:true}),false);
 ok(X.log.au.length===1,'a charged stick swing (no kick timer) is');
 reset(X);b=ball(90);X.boostTouch(b,rod(0,{kickT:-1,angVel:BO.swingW+4}),false);
 ok(X.log.au.length===1,'a rod turning fast is');
 reset(X);b=ball(90);X.boostTouch(b,rod(0,{kickT:-1,angVel:BO.swingW-2}),false);
 ok(X.log.au.length===0,'one turning slowly is not');
 reset(X);b=ball(90);X.boostTouch(b,rod(0),true);
 ok(X.log.au.length===0&&b.pw===0,'a held ball (trap, dribble, the player\'s hold) is not');
 reset(X);BO.on=false;b=ball(90);X.boostTouch(b,rod(0),false);BO.on=true;
 ok(X.log.au.length===0,'on:false shows nothing');

 /* 2. one a swing */
 reset(X);r=rod(0);b=ball(90);
 X.boostTouch(b,r,false);clearLog(X);
 b.v.x=100;X.boostTouch(b,r,false);
 ok(X.log.au.length===0&&X.log.bl.length===0,'later contacts of the same swing throw nothing more');
 ok(b.pw>0,'and do not end the comet');
 X.S.time+=BO.gap+0.01;r.kickT=0.05;X.boostTouch(b,r,false);
 ok(X.log.au.length===1,'the next swing fires again');

 /* 3. the effect scales with the exit speed */
 reset(X);b=ball(BO.min);X.boostTouch(b,rod(0),false);
 const nLo=X.log.sp.length,fLo=X.log.bl.find(e=>e.kind===2).s1,pLo=X.log.pu[0].k,rLo=X.log.bl.find(e=>e.kind===1).s1;
 reset(X);b=ball(BO.full+60);X.boostTouch(b,rod(0),false);
 const nHi=X.log.sp.length,fHi=X.log.bl.find(e=>e.kind===2).s1,pHi=X.log.pu[0].k,rHi=X.log.bl.find(e=>e.kind===1).s1;
 ok(nLo===BO.sparks.n[0]&&nHi===BO.sparks.n[1],'sparks go from '+BO.sparks.n[0]+' at min to '+BO.sparks.n[1]+' at full and beyond ('+nLo+' / '+nHi+')');
 ok(near(fLo,BO.flash.size[0])&&near(fHi,BO.flash.size[1]),'the flash grows with it');
 ok(near(rLo,BO.ring.size[0])&&near(rHi,BO.ring.size[1]),'and the ring');
 ok(near(pLo,0)&&near(pHi,BO.punch.k),'the camera punch is a fraction of a goal\'s and scales with it');

 /* 4. sparks fly the way the ball goes */
 reset(X);b=ball(0,0,-100);X.boostTouch(b,rod(0),false);
 let dot=0;for(const s of X.log.sp)dot+=s.vz/Math.hypot(s.vx,s.vy,s.vz);
 ok(dot/X.log.sp.length<-0.5,'the fan goes along the ball\'s heading (mean z '+(dot/X.log.sp.length).toFixed(2)+')');
 ok(near(X.log.pu[0].dz,-1)&&near(X.log.pu[0].dx,0),'and the camera is shoved along it');

 /* 5. the punch is rate-limited per team */
 reset(X);X.S.eff[1].boost=X.S.time+10;
 X.boostTouch(ball(90),rod(0),false);X.boostTouch(ball(90),rod(0),false);
 ok(X.log.pu.length===1,'two rods in a swing: one punch');
 X.boostTouch(ball(90),rod(1),false);
 ok(X.log.pu.length===2,'the other team has its own');
 X.S.time+=BO.punch.gap+0.01;X.boostTouch(ball(90),rod(0),false);
 ok(X.log.pu.length===3,'and it is back after the gap');

 /* 6. the switches */
 reset(X);X.cfg.particles=false;b=ball(90);X.boostTouch(b,rod(0),false);
 ok(X.log.bl.length===0&&X.log.sp.length===0&&X.log.bu.length===0,'particles off: no flash, ring or sparks');
 ok(X.log.au.length===1&&b.pw>0&&X.log.pu.length===1&&X.log.li.length===1,'but the sound, the comet, the punch and the light still answer');
 reset(X);X.FXON=false;b=ball(90);X.boostTouch(b,rod(0),false);
 ok(X.log.bl.length===0&&X.log.sp.length===0&&X.log.pu.length===0&&X.log.li.length===0,'vfx off: none of the new effects');
 ok(X.log.bu.length===1&&X.log.au.length===1&&b.pw>0,'the old burst stands in, the sound and comet stay');
 reset(X);X.FXON=false;X.cfg.particles=false;X.boostTouch(ball(90),rod(0),false);
 ok(X.log.bu.length===0,'and not with particles off');

 /* 7. stamps left by a last match */
 reset(X);r=rod(0,{pwAt:X.S.time+500});X.BOS.pn[0]=X.S.time+500;
 X.boostTouch(ball(90),r,false);
 ok(X.log.au.length===1&&X.log.pu.length===1,'a stamp far in the future does not block a new match');
 X.rods=[r];X.boostClear();
 ok(r.pwAt===0&&X.BOS.pn[0]===-9&&X.BOS.pn[1]===-9,'a clear takes the rod and team stamps');
 reset(X);b=ball(90);b.pw=1;X.S.balls=[b];X.rods=[rod(0)];X.boostClear();
 ok(b.pw===0&&b.pwRod===null,'and the comets');

 /* 8. the comet ends when anything else touches the ball */
 reset(X);X.S.eff[1].boost=0;r=rod(0);b=ball(90);X.boostTouch(b,r,false);
 ok(b.pw>0,'a comet is up');
 X.boostTouch(b,rod(1),false);
 ok(b.pw===0,'the other team\'s touch ends it');
 reset(X);r=rod(0);b=ball(90);X.boostTouch(b,r,false);
 const r2=rod(0);X.boostTouch(b,r2,false);
 ok(b.pwRod===r2&&X.log.au.length===2&&b.pw>0,'a second boosted rod that strikes it throws a power hit of its own, and the comet is its');
 reset(X);r=rod(0);b=ball(90);X.boostTouch(b,r,false);X.boostTouch(b,rod(0,{kickT:-1}),false);
 ok(b.pw===0,'a mate\'s soft touch ends it');
 reset(X);r=rod(0);b=ball(90);X.boostTouch(b,r,false);
 X.S.time+=BO.gap+0.1;b.v.x=10;X.boostTouch(b,r,false);
 ok(b.pw===0,'the same rod touching it again slowly, after the swing, ends it too');

 /* 9. the comet in flight */
 reset(X);b=ball(90);b.pw=1.0;b.pwRod=rod(0);X.S.balls=[b];
 X.boostUpdate(0.1);
 ok(near(b.pw,0.9,1e-9),'the comet counts down in real time');
 ok(X.log.sp.length===T.streaks+T.glints&&X.log.sp.filter(s=>s.flags===2).length===T.glints&&X.log.sp.filter(s=>s.flags===0).length===T.streaks,'a quick ball sheds '+T.streaks+' dashes and '+T.glints+' twinkles a frame');
 ok(X.log.sp.every(s=>Math.abs(s.x-10)<1&&Math.abs(s.z-4)<1),'at the ball');
 ok(X.log.sp.filter(s=>s.flags===0).every(s=>s.vx>0.3*90&&s.vx<0.6*90),'the dashes go along the flight, slower than the ball');
 clearLog(X);b.v.x=T.min-5;X.boostUpdate(0.1);
 ok(X.log.sp.length===0&&b.pw<0.9,'a slowed ball sheds none, the comet still runs out');
 clearLog(X);b.v.x=90;X.boostUpdate(0);
 ok(X.log.sp.length===0&&near(b.pw,0.8,1e-9),'a frozen frame (rdt 0) does nothing');
 b.pw=0.05;X.boostUpdate(0.1);
 ok(b.pw===0,'it ends at zero');clearLog(X);X.boostUpdate(0.1);
 ok(X.log.sp.length===0,'and then sheds nothing');
 reset(X);X.cfg.particles=false;b=ball(90);b.pw=1;X.S.balls=[b];X.boostUpdate(0.1);
 ok(X.log.sp.length===0&&near(b.pw,0.9,1e-9),'particles off: no glints, the comet still counts down');
 reset(X);b=ball(90);b.pw=T.fade*0.5;X.S.balls=[b];X.boostUpdate(0.01);
 const fadeP=X.log.sp[0].pw;
 reset(X);b=ball(90);b.pw=T.fade*3;X.S.balls=[b];X.boostUpdate(0.01);
 ok(fadeP<X.log.sp[0].pw*0.7,'the glints dim over the last '+T.fade+' s');

 /* 10. the trail sprite */
 const spr=()=>({material:{color:new X.THREE.Color().set(0x3355ff)},scale:{x:3.2,y:3.2,set(a,c){this.x=a;this.y=c;}}});
 let s=spr();b=ball(90);b.pw=T.fade*2;X.boostTrail(s,b);
 const gold=new X.THREE.Color().set(BO.col);
 ok(s.material.color.r>0.8&&s.material.color.g>0.8,'the sprite goes gold ('+s.material.color.r.toFixed(2)+', '+s.material.color.g.toFixed(2)+')');
 ok(near(s.scale.x,3.2*T.scale,1e-9),'and bigger');
 s=spr();b.pw=0.0001;X.boostTrail(s,b);
 ok(near(s.scale.x,3.2,0.01)&&s.material.color.r<0.25,'at the end of the comet it is the ball\'s own again');
}

/* ---- the state: boots, handles, the wave, the sputter ---- */
function table(X){
 const defs=[[-52.5,0,1,'GK'],[-37.5,0,2,'DEF'],[-22.5,1,3,'ATT'],[-7.5,0,5,'MID'],[7.5,1,5,'MID'],[22.5,0,3,'ATT'],[37.5,1,2,'DEF'],[52.5,1,1,'GK']],sp={2:24,3:18.5,5:11.9},out=[];
 defs.forEach((d,idx)=>{
  const n=d[2],baseZ=[],men=[];
  for(let i=0;i<n;i++){baseZ.push(n===1?0:(i-(n-1)/2)*sp[n]);men.push({visible:true});}
  out.push({idx,x:d[0],team:d[1],role:d[3],men,baseZ,pivot:{position:{z:0},rotation:{z:0}},kickDir:d[1]===0?1:-1,removedUntil:[],kickT:-1,angVel:0});
 });
 return out;
}
function sreset(X){
 X.S.time=50;X.S.phase='play';X.S.eff[0].boost=0;X.S.eff[1].boost=0;X.S.balls=[];
 X.cfg.particles=true;X.FXON=true;X.BO.on=true;
 for(const k in X.log)X.log[k].length=0;
 X.boostClear();
 X.rods=table(X);
 X.teamGlow[0]=X.mkMat(0xcc2222);X.teamGlow[1]=X.mkMat(0x2244cc);X.rodCustomMats=[];
}
const cols=(X,t)=>X.BOG.pts[t].geometry.attributes.color.array;
const lit=(X,t)=>{const c=cols(X,t),n=X.BOG.pts[t].geometry.drawRange[1];let m=0;for(let i=0;i<n;i++)if(c[i*3]+c[i*3+1]+c[i*3+2]>1e-6)m++;return m;};

function stateSuite(X){
 const BO=X.BO,G=BO.glow,W=BO.wave,E=BO.end,MEN=11;
 /* 1. built hidden */
 sreset(X);X.boostUpdate(0.016);
 ok(X.BOG.built&&X.SCENE.length===2&&X.BOG.pts.every(p=>p.visible===false&&p.frustumCulled===false),'one hidden Points a team, in the scene before any boost');
 ok(X.BOG.pts[0].material.blending===2&&X.BOG.pts[0].material.depthWrite===false&&X.BOG.pts[0].material.vertexColors===true,'additive, no depth write, a colour a boot');
 X.boostUpdate(0.016);ok(X.SCENE.length===2,'built once');

 /* 2. pickup */
 sreset(X);X.boostUpdate(0.016);
 const base=X.teamGlow[0].emissive.clone(),bi=X.teamGlow[0].emissiveIntensity;
 X.S.eff[0].boost=X.S.time+10;X.log.au.length=0;X.log.bl.length=0;X.log.sp.length=0;
 X.boostUpdate(0.016);
 const P0=X.BOG.pts[0];
 ok(P0.visible===true&&P0.geometry.drawRange[1]===MEN&&X.BOG.pts[1].visible===false,'the boosted team gets its 11 boots lit, the other none');
 ok(X.log.au.filter(a=>a.id==='boost_on').length===1,'one pickup sound');
 const handle=X.log.bl.filter(b=>b.kind===2&&Math.abs(b.z-(X.F.W/2+6))<1e-6);
 ok(handle.length===4,'a flash at the handle end of each of the four rods ('+handle.length+')');
 const pops=X.log.bl.filter(b=>b.kind===2&&Math.abs(b.s0-W.pop[0])<1e-9);
 ok(pops.length===MEN,'and a pop at each boot as the wave passes ('+pops.length+')');
 ok(X.log.sp.length===4*W.steps+MEN*4,'a pulse of '+W.steps+' glints down each rod and four sparks off each boot ('+X.log.sp.length+')');
 const hd=handle.map(h=>h.delay).sort((a,b)=>a-b);
 ok(near(hd[0],0)&&near(hd[1],W.stagger)&&near(hd[3],3*W.stagger),'rods one after another, '+W.stagger+' s apart');
 // from the keeper out: red's rods ascend in x
 const byX=handle.slice().sort((a,b)=>a.x-b.x);
 ok(byX.every((h,i)=>near(h.delay,i*W.stagger)),'red\'s wave starts at its keeper and works out (x ascending)');
 const mid=X.rods.find(r=>r.team===0&&r.role==='MID'),popsMid=pops.filter(p=>Math.abs(p.x-mid.x)<2);
 const popZ=popsMid.slice().sort((a,b)=>b.z-a.z);
 ok(popZ.length===5&&popZ.every((p,i)=>i===0||p.delay>popZ[i-1].delay),'down a rod the wave passes the men from the handle side first');
 const first=X.log.sp.filter(q=>q.flags===2&&near(q.x,-52.5));
 ok(first.length===W.steps&&near(first[0].delay,0)&&near(first[first.length-1].delay,W.travel),'a pulse takes '+W.travel+' s end to end');

 /* 3. the boots light as the wave reaches them */
 let c=cols(X,0);
 const idxOf=(rodRef,mi)=>{let n=0;const T=X.BOG.tm[0];for(let i=0;i<T.men.length;i++)if(T.men[i].r===rodRef&&T.men[i].mi===mi)return i;return -1;};
 const lateRod=X.rods.find(r=>r.team===0&&r.role==='ATT'),li=idxOf(lateRod,0),early=idxOf(X.rods.find(r=>r.team===0&&r.role==='GK'),0);
 ok(c[li*3]===0||c[li*3]<c[early*3],'a boot the wave has not reached is not lit as the first is');
 for(let i=0;i<60;i++)X.boostUpdate(0.016);
 c=cols(X,0);
 ok(lit(X,0)===MEN,'after a second every boot is lit');
 const T=X.BOG.tm[0],pmax=G.power*(1+G.breath)+1e-6,pmin=G.power*(1-G.breath)-1e-6;
 let inRange=true;for(let i=0;i<MEN;i++){const v=c[i*3]/X.BOS.rgb[0];if(v>pmax||v<pmin)inRange=false;}
 ok(inRange,'steady, each boot breathes within '+Math.round(G.breath*100)+'% of its power');
 let distinct=new Set();for(let i=0;i<MEN;i++)distinct.add(c[i*3].toFixed(3));
 ok(distinct.size>3,'out of phase between men');

 /* 4. the glow rides the displayed pose */
 const r=X.rods.find(q=>q.team===0&&q.role==='ATT');r.pivot.rotation.z=0.5;r.pivot.position.z=4;
 X.boostUpdate(0.016);
 const pos=X.BOG.pts[0].geometry.attributes.position.array,j=idxOf(r,1),o=[0,0,0];
 X.boostBoot(r,1,o);
 {const dx=pos[j*3]-o[0],dy=pos[j*3+1]-o[1],dz=pos[j*3+2]-o[2],cx=0-o[0],cy=60-o[1],cz=40-o[2],cl=Math.hypot(cx,cy,cz);
  ok(near(Math.hypot(dx,dy,dz),G.lift,1e-6)&&near(dx*cx+dy*cy+dz*cz,G.lift*cl,1e-4),'the glow sits '+G.lift+' toward the camera, so the boot does not hide it');
  ok(near(o[2],r.baseZ[1]+4,1e-9),'and the boot is at its man, slid');}
 const lx=G.fwd*r.kickDir,ly=X.PLAYER_H+G.up,a=0.5;
 ok(near(o[0],r.x+lx*Math.cos(a)-ly*Math.sin(a),1e-9)&&near(o[1],X.ROD_H+lx*Math.sin(a)+ly*Math.cos(a),1e-9),'on the foot: ahead of and above the foot base, rotated about the rod');
 r.pivot.rotation.z=0;r.pivot.position.z=0;

 /* 5. the handles */
 ok(X.teamGlow[0].emissive.g>base.g&&X.teamGlow[0].emissiveIntensity>bi,'the knobs go toward gold and brighter');
 ok(X.teamGlow[1].emissive.b===new X.THREE.Color().set(0x2244cc).b,'the other team\'s are untouched');

 /* 6. the end */
 sreset(X);X.boostUpdate(0.016);
 X.rodCustomMats=[{mat:X.mkMat(0x00ff00),team:0,isGlow:true},{mat:X.mkMat(0x00ff00),team:0,isGlow:false}];
 const cg=X.rodCustomMats[0].mat.emissive.clone(),cn=X.rodCustomMats[1].mat.emissive.clone();
 X.S.eff[0].boost=X.S.time+5;X.boostUpdate(0.016);for(let i=0;i<60;i++)X.boostUpdate(0.016);
 ok(X.rodCustomMats[0].mat.emissive.r>cg.r&&X.rodCustomMats[1].mat.emissive.r===cn.r,'a rod GLB\'s own glow clone goes gold, its body does not');
 X.log.bl.length=0;X.log.sp.length=0;X.log.au.length=0;
 X.S.time=X.S.eff[0].boost+0.01;X.boostUpdate(0.016);
 ok(X.BOG.pts[0].visible===false&&X.BOG.tm[0].live===false,'the glow goes');
 const bp=X.log.bl.filter(b=>b.kind===2);
 ok(bp.length===MEN&&bp.every(b=>b.delay===0&&b.life<0.2),'a pop at each of the 11 boots ('+bp.length+')');
 ok(X.log.sp.length===MEN*E.sparks,'with its sparks');
 ok(X.log.au.filter(a=>a.id==='boost_off').length===1,'one end sound');
 ok(X.teamGlow[0].emissive.r===base.r&&X.teamGlow[0].emissiveIntensity===bi&&X.rodCustomMats[0].mat.emissive.r===cg.r,'the knobs are exactly as they were');
 X.log.bl.length=0;X.boostUpdate(0.016);ok(X.log.bl.length===0,'it ends once');

 /* 7. the sputter */
 sreset(X);X.boostUpdate(0.016);X.S.eff[0].boost=X.S.time+10;
 for(let i=0;i<40;i++)X.boostUpdate(0.016);
 let darkEarly=0,darkLate=0,minEarly=9,spit=0;
 const until=X.S.eff[0].boost;
 for(let k=0;k<200;k++){X.S.time=until-E.warn-1+k*0.005;X.boostUpdate(0.016);if(lit(X,0)<MEN)darkEarly++;}
 ok(darkEarly===0,'before the last '+E.warn+' s nothing drops out');
 X.log.sp.length=0;
 const darkAt=[];
 for(let k=0;k<=40;k++){
  X.S.time=until-E.warn+k*(E.warn-0.1)/40;X.boostUpdate(0.016);
  const c2=cols(X,0);let off=0;for(let i=0;i<MEN;i++)if(c2[i*3]<X.BOS.rgb[0]*G.power*E.floor*(1+G.breath)+1e-6)off++;
  darkAt.push(off);
 }
 const e1=darkAt.slice(0,13).reduce((a,b)=>a+b,0),e2=darkAt.slice(-13).reduce((a,b)=>a+b,0);
 ok(e2>e1&&e2>0,'in the last seconds the boots drop out, more of them the nearer the end ('+e1+' -> '+e2+')');
 ok(X.log.sp.filter(q=>q.size===0.2).length>0,'and spit a few sparks as they catch');
 const cF=cols(X,0);let minV=9;for(let i=0;i<MEN;i++){minV=Math.min(minV,cF[i*3]);}
 ok(minV>=0,'never negative');

 /* 8. a match start / the menu just lets go */
 sreset(X);X.boostUpdate(0.016);X.S.eff[0].boost=X.S.time+10;for(let i=0;i<30;i++)X.boostUpdate(0.016);
 X.log.bl.length=0;X.log.au.length=0;X.S.eff[0].boost=0;X.boostClear();X.boostUpdate(0.016);
 ok(X.BOG.pts[0].visible===false&&X.log.bl.length===0&&X.log.au.length===0&&X.teamGlow[0].emissiveIntensity===0.55,'a clear: gone, no pop, no sound, knobs back');
 sreset(X);X.boostUpdate(0.016);X.S.eff[0].boost=X.S.time+10;for(let i=0;i<30;i++)X.boostUpdate(0.016);
 X.log.bl.length=0;X.log.au.length=0;X.S.phase='menu';X.boostUpdate(0.016);
 ok(X.BOG.pts[0].visible===false&&X.log.bl.length===0&&X.log.au.length===0&&X.teamGlow[0].emissiveIntensity===0.55,'the menu: gone, silent, knobs back');

 /* 9. a replay hides it, then it is back */
 sreset(X);X.boostUpdate(0.016);X.S.eff[0].boost=X.S.time+10;for(let i=0;i<30;i++)X.boostUpdate(0.016);
 X.log.bl.length=0;X.log.au.length=0;X.log.sp.length=0;
 X.S.phase='replay';X.boostUpdate(0.016);
 ok(X.BOG.pts[0].visible===false&&X.log.bl.length===0,'a replay hides the glow and does not pop it');
 X.S.phase='play';X.boostUpdate(0.016);
 ok(X.BOG.pts[0].visible===true&&X.log.au.length===0&&X.log.bl.length===0,'it comes back with no second wave');

 /* 10. a cannonball takes a man */
 sreset(X);X.boostUpdate(0.016);X.S.eff[0].boost=X.S.time+10;for(let i=0;i<60;i++)X.boostUpdate(0.016);
 const mr=X.rods.find(q=>q.team===0&&q.role==='MID');
 mr.removedUntil[2]=X.S.time+5;mr.men[2].visible=false;X.boostUpdate(0.016);
 const mi=idxOf(mr,2),c3=cols(X,0);
 ok(c3[mi*3]===0&&lit(X,0)===MEN-1,'the man who was hit goes dark, the rest stay lit');
 X.log.bl.length=0;X.S.time=X.S.eff[0].boost+0.01;X.boostUpdate(0.016);
 ok(X.log.bl.filter(b=>b.kind===2).length===MEN-1,'and he gets no pop at the end');

 /* 11. a second pickup while it holds */
 sreset(X);X.boostUpdate(0.016);X.S.eff[0].boost=X.S.time+10;for(let i=0;i<60;i++)X.boostUpdate(0.016);
 X.log.bl.length=0;X.log.au.length=0;
 X.S.eff[0].boost=X.S.time+12;X.boostUpdate(0.016);
 ok(X.log.au.filter(a=>a.id==='boost_on').length===1&&X.log.bl.length===4+MEN,'another wave runs');
 ok(X.BOG.pts[0].geometry.drawRange[1]===MEN,'and no boot is counted twice');
 X.S.time=X.S.eff[0].boost+0.01;X.boostUpdate(0.016);
 ok(X.teamGlow[0].emissiveIntensity===0.55,'the knobs still come back exactly');

 /* 12. a moving boot leaves a glow behind it */
 sreset(X);X.boostUpdate(0.016);X.S.eff[0].boost=X.S.time+10;for(let i=0;i<60;i++)X.boostUpdate(0.016);
 X.log.sp.length=0;X.boostUpdate(0.016);
 ok(X.log.sp.filter(q=>q.flags===4).length===0,'a still boot leaves nothing');
 const sr=X.rods.find(q=>q.team===0&&q.role==='ATT');
 sr.pivot.position.z+=3;X.boostUpdate(0.016);
 ok(X.log.sp.filter(q=>q.flags===4).length===3,'the three boots of a rod that slid leave a soft glow each ('+X.log.sp.filter(q=>q.flags===4).length+')');

 /* 13. particles off: the glow and the handles stay, the sparks go */
 sreset(X);X.cfg.particles=false;X.boostUpdate(0.016);X.S.eff[0].boost=X.S.time+10;
 X.boostUpdate(0.016);for(let i=0;i<60;i++)X.boostUpdate(0.016);
 const sr2=X.rods.find(q=>q.team===0&&q.role==='ATT');sr2.pivot.position.z+=3;X.boostUpdate(0.016);
 ok(X.BOG.pts[0].visible&&X.teamGlow[0].emissiveIntensity>0.55,'the boots and the knobs still show');
 ok(X.log.bl.length===0&&X.log.sp.length===0,'no wave, no smear');
 X.S.time=X.S.eff[0].boost+0.01;X.boostUpdate(0.016);
 ok(X.log.bl.length===0&&X.log.sp.length===0&&X.log.au.some(a=>a.id==='boost_off'),'no end pop, but the sound');

 /* 14. both teams */
 sreset(X);X.boostUpdate(0.016);X.S.eff[0].boost=X.S.time+3;X.S.eff[1].boost=X.S.time+9;
 for(let i=0;i<60;i++)X.boostUpdate(0.016);
 ok(X.BOG.pts[0].visible&&X.BOG.pts[1].visible,'both can be lit at once');
 const blueX=X.rods.filter(q=>q.team===1).map(q=>q.x);
 const blOrder=X.log.bl.filter(b=>b.kind===2&&Math.abs(b.z-(X.F.W/2+6))<1e-6&&blueX.indexOf(b.x)>=0).sort((a,b)=>a.delay-b.delay);
 ok(blOrder.length===4&&blOrder.every((h,i)=>i===0||h.x<blOrder[i-1].x),'blue works out from its own keeper (x descending)');
 X.S.time=X.S.eff[0].boost+0.01;X.log.bl.length=0;X.boostUpdate(0.016);
 ok(X.BOG.pts[0].visible===false&&X.BOG.pts[1].visible===true&&X.log.bl.filter(b=>b.kind===2).length===MEN,'one ends while the other holds');
}

/* ---- the stamina rings ---- */
function ringSuite(X){
 const BO=X.BO,Gq=BO.gauge,MEN=11,W=BO.wave;
 const tint=r=>{const g=new X.THREE.Color().set(0x3cb82a);X.boostRing(r,g);return g;};   // an idle green ring, as rodHolesUpdate has just written it
 const base=tint({}).r;
 const red=()=>X.rods.filter(q=>q.team===0).sort((a,b)=>a.x-b.x);   // keeper first
 const blue=()=>X.rods.filter(q=>q.team===1);

 sreset(X);X.boostUpdate(0.016);
 ok(near(tint(red()[0]).r,base)&&near(tint(red()[0]).g,tint({}).g),'an unboosted ring is left exactly as it is');
 X.S.eff[0].boost=X.S.time+10;X.boostUpdate(0.016);
 ok(red().every(q=>(q.boFl||0)===0),'no flash before the wave reaches a rod');
 const firstAt=red().map(()=>-1);
 for(let i=0;i<60;i++){X.boostUpdate(0.016);red().forEach((q,k)=>{if(firstAt[k]<0&&q.boFl>0)firstAt[k]=i;});}
 ok(firstAt.every(v=>v>=0)&&firstAt.every((v,k)=>k===0||v>firstAt[k-1]),'each rod\'s ring flashes as the wave enters it, the keeper\'s first ('+firstAt.join(',')+')');
 ok(blue().every(q=>(q.boFl||0)===0&&(q.boHold||0)===0),'the other team\'s rings are not touched');

 // a flash is bright and fades
 sreset(X);X.boostUpdate(0.016);X.S.eff[0].boost=X.S.time+10;
 for(let i=0;i<6;i++)X.boostUpdate(0.016);
 const gk=red()[0];
 ok(gk.boFl>0.6&&tint(gk).r>base+1.5,'at its peak the ring is gold and several times brighter ('+tint(gk).r.toFixed(2)+')');
 for(let i=0;i<80;i++)X.boostUpdate(0.016);
 ok(near(gk.boFl,0),'it fades in '+Gq.decay+' s');
 const held=tint(gk).r;
 ok(held>base&&held<base+0.35*(Gq.glow-base)+1e-9,'and leaves only a faint tint while the boost holds ('+held.toFixed(2)+' against '+base.toFixed(2)+')');
 const hold2=gk.boHold;
 ok(hold2>0&&hold2<=Gq.hold*1.0001,'(hold is '+Gq.hold+' at most)');

 // the sputter flashes it on every catch
 const until=X.S.eff[0].boost;
 let early=0;
 for(let k=0;k<100;k++){X.S.time=until-E_warn(X)-1+k*0.005;X.boostUpdate(0.016);red().forEach(q=>{if(q.boFl>0)early++;});}
 ok(early===0,'nothing flashes in the steady part');
 let catches=0,prev=red().map(q=>q.boFl||0);
 for(let k=0;k<=80;k++){
  X.S.time=until-E_warn(X)+k*(E_warn(X)-0.05)/80;X.boostUpdate(0.016);
  red().forEach((q,i)=>{if((q.boFl||0)>prev[i]+0.5)catches++;prev[i]=q.boFl||0;});
 }
 ok(catches>=3,'every catch of the sputter flashes the ring ('+catches+')');

 // the end
 sreset(X);X.boostUpdate(0.016);X.S.eff[0].boost=X.S.time+5;for(let i=0;i<120;i++)X.boostUpdate(0.016);
 ok(red().every(q=>(q.boFl||0)===0),'quiet before the end');
 X.S.time=X.S.eff[0].boost+0.01;X.boostUpdate(0.016);
 ok(red().every(q=>q.boFl>0.9&&q.boHold===0),'every ring of the team flashes with the pop, the tint gone');
 for(let i=0;i<40;i++)X.boostUpdate(0.016);
 ok(red().every(q=>q.boFl===0),'and settles back to the stamina reading');
 ok(near(tint(red()[1]).r,base),'exactly');

 // a clear and the menu let go with no flash
 sreset(X);X.boostUpdate(0.016);X.S.eff[0].boost=X.S.time+10;for(let i=0;i<10;i++)X.boostUpdate(0.016);
 X.S.eff[0].boost=0;X.boostClear();
 ok(red().every(q=>q.boFl===0&&q.boHold===0)&&near(tint(red()[0]).r,base),'a match start clears the flash and the tint');
 sreset(X);X.boostUpdate(0.016);X.S.eff[0].boost=X.S.time+10;for(let i=0;i<10;i++)X.boostUpdate(0.016);
 X.S.phase='menu';X.boostUpdate(0.016);
 ok(red().every(q=>q.boFl===0&&q.boHold===0),'the menu: none');

 // it is not a particle
 sreset(X);X.cfg.particles=false;X.boostUpdate(0.016);X.S.eff[0].boost=X.S.time+10;
 for(let i=0;i<8;i++)X.boostUpdate(0.016);
 ok(red()[0].boFl>0.5,'particles off still flashes the rings');
 X.S.time=X.S.eff[0].boost+0.01;X.boostUpdate(0.016);
 ok(red().every(q=>q.boFl>0.9),'and pops them');

 // a rod with no state at all
 ok(near(tint({boFl:undefined,boHold:undefined}).r,base),'a ring with no boost state is left alone');
}
function E_warn(X){return X.BO.end.warn;}

function run(src){const X=boot(src);pass=0;fail=0;fails.length=0;suite(X);stateSuite(X);ringSuite(X);return {pass,fail,fails:fails.slice()};}

const SRC=rd('js/boost.js');
const base=run(SRC);
console.log('boost harness: '+base.pass+' assertions, '+base.fail+' failing');
for(const f of base.fails)console.log('  FAIL '+f);

function mutate(from,to,label){
 if(!SRC.includes(from)){console.log('  MUTATION ANCHOR DRIFTED: '+label);return {broke:false,drift:true};}
 let r;try{r=run(SRC.replace(from,to));}catch(e){return {broke:true};}
 return {broke:r.fail>base.fail};
}
const MUT=[
 ['if(!BO.on||hold||!(S.eff[r.team].boost>S.time))return;','if(!BO.on||hold)return;','an unboosted team fires'],
 ['if(!BO.on||hold||!(S.eff[r.team].boost>S.time))return;','if(!BO.on||!(S.eff[r.team].boost>S.time))return;','a held ball fires'],
 ['if(!(r.kickT>=0||r.shotOn||Math.abs(r.angVel)>BO.swingW))return;','','a slide fires'],
 ['if(!(r.kickT>=0||r.shotOn||Math.abs(r.angVel)>BO.swingW))return;','if(!(r.kickT>=0))return;','a stick swing is not a strike'],
 ['if(w>0&&w<=BO.gap)return;','','every contact of a swing fires'],
 ['if(w>0&&w<=BO.gap)return;','if(w>0)return;','a stale stamp blocks the next match'],
 ['r.pwAt=S.time+BO.gap;','','the rod is never stamped'],
 ['if(sp<BO.min)return;','','a soft touch fires'],
 ['b.pw>0&&(b.pwRod!==r||(r.pwAt||0)<=S.time)','false','a touch never ends the comet'],
 ['b.pw>0&&(b.pwRod!==r||(r.pwAt||0)<=S.time)','b.pw>0','the swing\'s own later contacts end its comet'],
 ['if(!(w>0&&w<=BO.punch.gap)){','if(true){','the punch is not rate-limited'],
 ['hx/=hl;hz/=hl;','','the heading is not normalised'],
 ['if(fx&&cfg.particles){','if(fx){','particles off still spawns'],
 ['}else if(cfg.particles&&typeof burst===\'function\')burst(','}else if(false)burst(','no stand-in burst'],
 ['const n=Math.round(lerp(SK.n[0],SK.n[1],k));','const n=SK.n[1];','sparks ignore the speed'],
 ['const FL=BO.flash,RG=BO.ring,SK=BO.sparks,c=BOS.col,hot=BOS.hot,fs=lerp(FL.size[0],FL.size[1],k);','const FL=BO.flash,RG=BO.ring,SK=BO.sparks,c=BOS.col,hot=BOS.hot,fs=FL.size[1];','the flash ignores the speed'],
 ['b.pw=Math.max(0,b.pw-rdt);','','the comet never runs out'],
 ['if(sp<T.min)continue;','','a crawling ball sheds glints'],
 ['s.material.color.lerp(_boC.set(BO.col),0.9*f);','','the trail stays the ball\'s colour'],
 ['{r.pwAt=0;r.boFl=0;r.boHold=0;r.boAt=null;}','{r.boFl=0;r.boHold=0;r.boAt=null;}','a clear leaves the rod stamps'],
 ['{r.pwAt=0;r.boFl=0;r.boHold=0;r.boAt=null;}','{r.pwAt=0;}','a clear leaves the ring flash'],
 ['r.boAt=T.age+d0+BO.gauge.delay;','','no ring flash at pickup'],
 ['if(up&&!m.on)r.boFl=1;','','no ring flash on a catch'],
 ['m.r.boFl=fx?1:0;','m.r.boFl=0;','no ring flash at the end'],
 ['for(const r of rods)if(r.boFl>0)r.boFl=Math.max(0,r.boFl-d);','','a ring flash never fades'],
 ['g.lerp(_boG.copy(BOS.gold).multiplyScalar(BO.gauge.glow),Math.min(1,f));','','the ring is never touched'],
 ['for(const m of T.men)m.r.boHold=BO.gauge.hold*clamp(m.r.boK,0,1);','','no tint while boosted'],
 ['m.r.boHold=0;m.r.boAt=null;','m.r.boAt=null;','the tint outlives the boost'],
 ["Au.play('power_hit',{p:sp});",'','no sound'],
 ['if(BO.light>0)vfxLight(','if(false)vfxLight(','no light'],
 [' if(fx){\n  const w=BOS.pn[r.team]-S.time;',' if(true){\n  const w=BOS.pn[r.team]-S.time;','vfx off still punches'],
 ['if(!BO.on||!(rdt>0)||typeof S===\'undefined\'||typeof rods===\'undefined\')return;','if(!BO.on||typeof S===\'undefined\'||typeof rods===\'undefined\')return;','a frozen frame sheds glints'],
 ['else if(!on&&T.live)boostEnd(t,T,live);','else if(!on&&T.live)boostEnd(t,T,false);','the end has no pop'],
 ['if(on&&(!T.live||until>T.until+0.5))boostOnset(t,T,until,!T.live);','if(on&&!T.live)boostOnset(t,T,until,!T.live);','a second pickup runs no wave'],
 [' for(const k of T.kn){k.m.color.copy(k.c);k.m.emissive.copy(k.e);k.m.emissiveIntensity=k.i;}\n',' ','the knobs are never given back'],
 ['if(!up)k*=E.floor;','','the glow never drops out'],
 ['P.visible=n>0&&!hide;','P.visible=n>0;','a replay shows the glow'],
 ['let k=alive?boSm((T.age-m.t0)/G.rise):0;','let k=boSm((T.age-m.t0)/G.rise);','a hit man keeps his glow'],
 ['.sort((a,b)=>a.x*dir-b.x*dir);','.sort((a,b)=>0);','the wave does not start at the keeper'],
 ['dl=d0+u*W.travel;','dl=d0;','the wave arrives everywhere at once'],
 ['if(sp>SM.v)vfxSpk(','if(false)vfxSpk(','a moving boot leaves nothing'],
 ['if(up&&!m.on&&fxp&&E.spit)','if(false)','no spit'],
 ['const kh=clamp(teamK,0,1.2);','const kh=0;','the knobs never glow'],
 ['boostKnobsRestore(T);\n  T.live=false;T.age=0;T.men=[];','T.live=false;T.age=0;T.men=[];','a clear leaves the knobs gold'],
 ["Au.play('boost_on');",'','no pickup sound'],
 ["Au.play('boost_off');",'','no end sound'],
 ['o[0]=r.x+lx*ca-ly*sa;','o[0]=r.x+lx*ca+ly*sa;','the boot is not where the foot is'],
 ['k*=1+G.breath*Math.sin(T.age*G.hz*6.2832+m.ph);','','the glow does not breathe'],
 ['let m=first?null:T.men.find(q=>q.r===r&&q.mi===mi);','let m=null;','a second pickup counts the boots twice'],
 ['   if(fx){\n    boostBoot(r,mi,_boP);','   if(true){\n    boostBoot(r,mi,_boP);','particles off still pops the wave'],
];
let survived=0;
for(const [a,b,label] of MUT){const m=mutate(a,b,label);if(!m.broke){survived++;console.log('  SURVIVED: '+label+(m.drift?' (anchor)':''));}}
console.log('mutations: '+(MUT.length-survived)+'/'+MUT.length+' caught');
process.exit(base.fail||survived?1:0);
