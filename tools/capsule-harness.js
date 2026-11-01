// leg-capsule harness. node tools/capsule-harness.js
// slices the real collideRod (physics.js), holdCfg / kickStyleCfg (rods.js), stHit / stGrip (stats.js) and runs them on live CONFIG
// question: does a ball that meets the leg above the foot box (CONFIG.kick.capRest / capGrip) bounce and keep its speed, while the foot box, a posed rod's leg (capDeadPosed), a power-window swing and a trap hold stay as they were; each mutation must break an assertion
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const PH=rd('js/physics.js');
const parts={
 col:slice(PH,'function collideRod(b,r){','function ballBall('),
 cap:slice(PH,'function capSpeed(b,r,sweet,in2){',NL+'function collideRod('),
 style:slice(rd('js/rods.js'),'function styleCfg(',NL+'function kickStyleCfg'),
 kstyle:slice(rd('js/rods.js'),'function kickStyleCfg(r){',NL+'function passFaceOK('),
 hold:slice(rd('js/rods.js'),'function holdCfg(r){',NL+'function kickRod('),
 hit:slice(rd('js/stats.js'),'function stHit(r){',NL),
 grip:slice(rd('js/stats.js'),'function stGrip(r){',NL),
 frac:slice(rd('js/stats.js'),'function stCapFrac(r){',NL)
};
const stubs=[
"var S={time:0,eff:[{boost:-1,frozen:-1,big:-1},{boost:-1,frozen:-1,big:-1}],balls:[],lastTouch:-1,teamStats:null,shake:0};",
"var dbgLogRod=null;","var RNG={jit:function(){return 0.5;}};","var Au={kick:function(){}};",
"function aimAssist(){} function wallAssist(){} function passFaceOK(){return true;} function shotSpray(){}",
"function shotConsume(r){if(r.shotOn){r.shotOn=false;r.shotPow=1;r.shotCtl=1;}}",
"function momContact(){} function msContact(){} function dbgHit(){} function isUserRod(){return true;}",
"function makeBall(){return null;} function syncBall(){} function notice(){}",
"var SHOTC=CONFIG.shots;","var STC=CONFIG.stats;","function ST(r,k){return STC.base;}",
"function stFat(){return 1;} function stAccFrac(){return 0;}"
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.col,g.cap,g.style,g.kstyle,g.hold,g.hit,g.grip,g.frac,
  ';globalThis.X={CONFIG:CONFIG,KICK:KICK,AIC:AIC,BALL_TYPES:BALL_TYPES,S:S,collideRod:collideRod,stGrip:stGrip};'].join(NL),ctx);
 return ctx.X;
}

const mkRod=o=>Object.assign({idx:0,x:0,team:0,role:'MID',baseZ:[0],removedUntil:[0],offset:0,maxOff:20,trnHidden:false,
 angle:0,angVel:0,vz:0,kickT:-1,kickStyle:null,kickCurve:null,kickDir:1,cd:0,aiIQ:false,aimSweet:-1,kickHit:false,
 msSw:false,tcSpin:0,chg:-1,shotOn:false,shotPow:1,shotCtl:1,passTo:null,act:null,pinOn:false,pinPose:false,
 hold:{on:false,holdRest:0.01,holdGrip:0.6,carryMult:1},stats:null},o||{});

// a ball let go from the front at height y, speed v, z off the man's centre line; the velocity it leaves with
function leg(X,y,v,o){
 o=o||{};const r=mkRod(o.rod);
 const b={m:{position:{x:6,y:y,z:o.dz||0}},v:{x:-v,y:0,z:0},t:X.BALL_TYPES.classic,spin:0,didSplit:false,scored:false};
 const dt=1/960;let touched=false;
 for(let i=0;i<4000;i++){
  const bx=b.v.x,bz=b.v.z;
  X.collideRod(b,r);
  if(b.v.x!==bx||b.v.z!==bz)touched=true;
  b.m.position.x+=b.v.x*dt;b.m.position.z+=b.v.z*dt;
  if(touched&&b.v.x>=0&&b.m.position.x>5)break;
 }
 return {vx:b.v.x,vz:b.v.z,sp:Math.hypot(b.v.x,b.v.z)};
}
// a swinging leg (inside the power window) runs into a ball resting against the shin: one contact
function swingInto(X,o){
 const P=X.CONFIG.physics,r=mkRod(Object.assign({angle:0.05,angVel:20,kickT:0.02},o||{}));
 const b={m:{position:{x:P.ballR+P.prad-0.15,y:P.rodH-1,z:0}},v:{x:0,y:0,z:0},t:X.BALL_TYPES.classic,spin:0,didSplit:false,scored:false};
 X.collideRod(b,r);return Math.hypot(b.v.x,b.v.y,b.v.z);
}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const K=X.KICK,P=X.CONFIG.physics,was={cr:K.capRest,cg:K.capGrip,cd:K.capDeadPosed};
 const TOPC=(P.rodH-P.arm)-P.footBoxOff.x+P.footBox.x,LEGY=TOPC+P.ballR*P.footBoxReach+0.5;   // world y of the box's top face at rod angle 0; a ball centred at LEGY is out of the box's reach
 const near=(a,b,t)=>Math.abs(a-b)<=t;
 const back=()=>{K.capRest=was.cr;K.capGrip=was.cg;K.capDeadPosed=was.cd;};
 ok('the three keys exist: capRest, capGrip numbers, capDeadPosed a flag',typeof K.capRest==='number'&&typeof K.capGrip==='number'&&typeof K.capDeadPosed==='boolean');
 K.capRest=0.6;K.capGrip=0.1;K.capDeadPosed=true;
 // ---- the leg above the foot box bounces ---------------------------------------------------------------
 for(const v of [20,60]){
  const o=leg(X,LEGY,v),want=v*0.6*(1-0.1);
  ok('a '+v+' u/s ball square on the shin leaves at capRest x (1 - capGrip) of its speed',near(o.vx,want,want*0.05),'got '+o.vx.toFixed(2)+' want '+want.toFixed(2));
 }
 {const o=leg(X,LEGY,40,{dz:2.0});ok('a glancing 40 u/s touch keeps over 60% of its speed',o.sp>24,'left at '+o.sp.toFixed(1));}
 {const o=leg(X,LEGY,40);ok('and it comes back toward the front: the leg is a surface, not a sink',o.vx>10,'vx '+o.vx.toFixed(1));}
 // ---- the foot box is as it was ---------------------------------------------------------------------------
 for(const v of [20,60]){const o=leg(X,1.9,v);ok('the foot box still stops a '+v+' u/s ball dead',o.sp<1,'left at '+o.sp.toFixed(2));}
 {const o=leg(X,TOPC-0.5,60);ok('...up the shin to its top face (ball centre half a unit under it)',o.sp<1,'left at '+o.sp.toFixed(2));}
 {const o=leg(X,TOPC+P.ballR+0.1,60);ok('...and the leg takes over just past the reach of that top face',o.sp>20,'left at '+o.sp.toFixed(2));}
 {const o=leg(X,1.9,60),want=60*K.rest*(1-K.grip);ok("the foot box keeps the foot's own grip, not the leg's",near(o.sp,want,0.02),'left at '+o.sp.toFixed(3)+' want '+want.toFixed(3));}
 // ---- a rod posed to receive or pin keeps its dead leg ---------------------------------------------------------
 {const o=leg(X,LEGY,60,{rod:{pinPose:true}});ok('pinPose: the leg stops the ball as before',o.sp<1,'left at '+o.sp.toFixed(2));}
 {const o=leg(X,LEGY,60,{rod:{pinOn:true}});ok('pinOn alone (the hold is live, the pose not latched) is the same',o.sp<1,'left at '+o.sp.toFixed(2));}
 K.capDeadPosed=false;
 {const o=leg(X,LEGY,60,{rod:{pinPose:true}});ok('capDeadPosed off: a posed rod bounces it like any other leg',o.vx>20,'vx '+o.vx.toFixed(1));}
 K.capDeadPosed=true;
 // ---- the old behaviour is one setting away --------------------------------------------------------------------
 {const old=leg(X,LEGY,60,{rod:{pinPose:true}});K.capRest=K.rest;K.capGrip=K.grip;const o=leg(X,LEGY,60);
  ok('capRest = rest and capGrip = grip give back the old dead leg exactly',near(o.vx,old.vx,1e-9)&&near(o.vz,old.vz,1e-9),'old '+old.vx.toFixed(3)+' now '+o.vx.toFixed(3));
  K.capRest=0.6;K.capGrip=0.1;}
 // ---- what the leg does not own --------------------------------------------------------------------------------
 {K.capRest=0;const a=swingInto(X);K.capRest=0.6;const b2=swingInto(X);
  ok('a swing inside the power window is untouched by capRest',near(a,b2,1e-9)&&a>1,'0: '+a.toFixed(2)+'  0.6: '+b2.toFixed(2));}
 {const trap={act:'trap'};K.capRest=0;const a=leg(X,LEGY,60,{rod:trap}).vx;K.capRest=0.6;const b2=leg(X,LEGY,60,{rod:trap}).vx;
  ok("the AI's trap hold (holdRest / holdGrip) outranks capRest",near(a,b2,1e-9),'0: '+a.toFixed(3)+'  0.6: '+b2.toFixed(3));}
 back();
 // ---- boost powers strikes, not touches ----------------------------------------------------------------------------
 {const E=X.S.eff[0],was=E.boost,on=()=>{E.boost=X.S.time+10;},off=()=>{E.boost=-1;};
  const kick={angVel:20,kickT:0.02},tc=(y,v,rod)=>{off();const a=leg(X,y,v,{rod}).sp;on();const b2=leg(X,y,v,{rod}).sp;off();return [a,b2];};
  let [a,b2]=tc(1.9,60);ok('boost: a ball run into a still foot stops as it does unboosted',near(a,b2,1e-9)&&b2<1,'off '+a.toFixed(3)+' on '+b2.toFixed(3));
  [a,b2]=tc(LEGY,60);ok('boost: ...and bounces off a still shin as it does unboosted',near(a,b2,1e-9),'off '+a.toFixed(2)+' on '+b2.toFixed(2));
  [a,b2]=tc(1.9,40,{pinPose:true,angVel:15});ok('boost: a pin pose lowering onto a ball is not a strike',near(a,b2,1e-9),'off '+a.toFixed(2)+' on '+b2.toFixed(2));
  [a,b2]=tc(1.9,40,{kickT:0.2});ok('boost: a kick held forward that a ball runs into is not a strike',near(a,b2,1e-9),'off '+a.toFixed(2)+' on '+b2.toFixed(2));
  [a,b2]=tc(1.9,20,kick);ok('boost: a kick swinging into a ball off the foot leaves faster',b2>a+5,'off '+a.toFixed(1)+' on '+b2.toFixed(1));
  [a,b2]=tc(1.9,5,{angVel:4,kickT:0.02});ok('boost: a soft swing under the ceiling gets the stronger impulse itself',b2>a*1.5,'off '+a.toFixed(1)+' on '+b2.toFixed(1));
  [a,b2]=tc(1.9,20,{angVel:20,padAngleOn:true,pinMag:null});ok('boost: ...and so does a pad stick swing',b2>a+5,'off '+a.toFixed(1)+' on '+b2.toFixed(1));
  off();a=swingInto(X);on();b2=swingInto(X);off();ok('boost: a kick swinging into a ball off the shin leaves faster',b2>a*1.2,'off '+a.toFixed(1)+' on '+b2.toFixed(1));
  on();a=swingInto(X,{kickT:-1});off();b2=swingInto(X,{kickT:-1});ok('boost: the same leg turning with no kick or stick is not powered',near(a,b2,1e-9),'on '+a.toFixed(2)+' off '+b2.toFixed(2));
  E.boost=was;}
 return R;
}

let bad=0,total=0;
const base=suite(boot());
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info?'   ['+t.info+']':''));}else console.log('  ok    '+t.name+(t.info?'   ['+t.info+']':''));}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

/* Mutations: each edits the REAL source and must fail at least one assertion above. */
const MUTS=[
 {n:'capsule rest ignores capRest',part:'col',from:'(dead?ks.rest:KICK.capRest)',to:'ks.rest'},
 {n:'capsule grip ignores capGrip',part:'col',from:'(dead?stGrip(r):KICK.capGrip)',to:'stGrip(r)'},
 {n:'a posed rod is never dead',part:'col',from:'const dead=KICK.capDeadPosed&&(r.pinPose||r.pinOn);',to:'const dead=false;'},
 {n:'every rod is dead (the old behaviour)',part:'col',from:'const dead=KICK.capDeadPosed&&(r.pinPose||r.pinOn);',to:'const dead=true;'},
 {n:'the capDeadPosed switch is ignored',part:'col',from:'KICK.capDeadPosed&&(r.pinPose||r.pinOn)',to:'(r.pinPose||r.pinOn)'},
 {n:'the pose flag alone decides',part:'col',from:'(r.pinPose||r.pinOn)',to:'r.pinPose'},
 {n:'the live pin alone decides',part:'col',from:'(r.pinPose||r.pinOn)',to:'r.pinOn'},
 {n:'the power window takes capRest',part:'col',from:'(pow?ks.restPower:(dead?ks.rest:KICK.capRest))',to:'(pow?KICK.capRest:(dead?ks.rest:KICK.capRest))'},
 {n:'a trap hold no longer outranks capRest',part:'col',from:'const rest=trapping?HLD.holdRest:(pow?ks.restPower:(dead?ks.rest:KICK.capRest));',to:'const rest=(pow?ks.restPower:(dead?ks.rest:KICK.capRest));'},
 {n:'the foot box takes capRest',part:'col',from:'(pow?ks.restPower:ks.rest);',to:'(pow?ks.restPower:KICK.capRest);'},
 {n:'the foot box takes capGrip',part:'col',from:'const g=trapping?clamp(HLD.holdGrip,0,1):stGrip(r);',to:'const g=trapping?clamp(HLD.holdGrip,0,1):KICK.capGrip;'},
 {n:'boost powers every touch of the foot',part:'col',from:'if(S.eff[r.team].boost>S.time&&boostSwing(r))jm*=KICK.boostHitMult;'+NL+'    jm*=stHit(r);'+NL+'    // player shot',to:'if(S.eff[r.team].boost>S.time)jm*=KICK.boostHitMult;'+NL+'    jm*=stHit(r);'+NL+'    // player shot'},
 {n:'boost powers every touch of the leg',part:'col',from:'if(S.eff[r.team].boost>S.time&&boostSwing(r))jm*=KICK.boostHitMult;'+NL+'    jm*=stHit(r);'+NL+'    if(r.shotOn)jm*=r.shotPow;'+NL+'    b.v.x+=',to:'if(S.eff[r.team].boost>S.time)jm*=KICK.boostHitMult;'+NL+'    jm*=stHit(r);'+NL+'    if(r.shotOn)jm*=r.shotPow;'+NL+'    b.v.x+='},
 {n:'boost powers no swing of the foot',part:'col',from:'if(S.eff[r.team].boost>S.time&&boostSwing(r))jm*=KICK.boostHitMult;'+NL+'    jm*=stHit(r);'+NL+'    // player shot',to:'jm*=stHit(r);'+NL+'    // player shot'},
 {n:'boost lifts the ceiling of every touch',part:'cap',from:'if(S.eff[r.team].boost>S.time&&boostSwing(r))f+=C.boost;',to:'if(S.eff[r.team].boost>S.time)f+=C.boost;'},
 {n:'boost reads a swing at any speed or way',part:'cap',from:'const w=r.angVel*r.kickDir;',to:'const w=1;'}
];
let missed=0;
for(const m of MUTS){
 let broke;
 try{broke=suite(boot(m)).filter(t=>!t.ok).map(t=>t.name);}catch(e){console.log('  MUTATION ERROR '+m.n+': '+e.message);missed++;continue;}
 if(broke.length)console.log('  caught  '+m.n+'   ['+broke.length+' fail]');
 else{missed++;console.log('  MISSED  '+m.n);}
}
console.log('  '+(MUTS.length-missed)+' of '+MUTS.length+' mutations caught');
process.exit(bad||missed?1:0);
