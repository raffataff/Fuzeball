// rear-carry harness. node tools/rear-harness.js
// slices the real collideRod (physics.js), holdCfg / kickStyleCfg (rods.js), shotHoldUpdate (shots.js), stHit / stGrip (stats.js) and runs them on live CONFIG
// question: does a ball touching the BACK of a sliding man stay behind (kick.rearCarry 0), while a side-face push, a front touch, a posed rod (the pin's cushion) and rearCarry 1 behave as they did; each mutation must break an assertion
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
 shots:slice(rd('js/shots.js'),'function shotsOn(){',NL+'function shotTrigD('),
 upd:slice(rd('js/shots.js'),'function shotHoldUpdate(r,lt){',NL+'const SHOT_CURVE_KEYS'),
 hit:slice(rd('js/stats.js'),'function stHit(r){',NL),
 grip:slice(rd('js/stats.js'),'function stGrip(r){',NL),
 frac:slice(rd('js/stats.js'),'function stCapFrac(r){',NL)
};
const stubs=[
"var S={time:0,eff:[{boost:-1,frozen:-1,big:-1},{boost:-1,frozen:-1,big:-1}],balls:[],lastTouch:-1,teamStats:null,shake:0};",
"var dbgLogRod=null;","var RNG={jit:function(){return 0.5;}};","var Au={kick:function(){}};",
"function aimAssist(){} function wallAssist(){} function passFaceOK(){return true;} function shotSpray(){}",
"function shotConsume(r){}","function momContact(){} function msContact(){} function dbgHit(){} function isUserRod(){return true;}",
"function makeBall(){return null;} function syncBall(){} function notice(){}",
"var SHOTC=CONFIG.shots;","var STC=CONFIG.stats;","function ST(r,k){return STC.base;}",
"function stFat(){return 1;} function stAccFrac(){return 0;}"
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=mut.first?before.replace(mut.from,mut.to):before.split(mut.from).join(mut.to);   // first: a RegExp, the first match only (the foot-box pass comes before the leg's)
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.col,g.cap,g.style,g.kstyle,g.hold,g.shots,g.upd,g.hit,g.grip,g.frac,
  ';globalThis.X={CONFIG:CONFIG,KICK:KICK,AIC:AIC,BALL_TYPES:BALL_TYPES,collideRod:collideRod,shotHoldUpdate:shotHoldUpdate};'].join(NL),ctx);
 return ctx.X;
}

const mkRod=o=>Object.assign({idx:0,x:0,team:0,role:'MID',baseZ:[0],removedUntil:[0],offset:0,maxOff:60,trnHidden:false,
 angle:0,angVel:0,vz:0,kickT:-1,kickStyle:null,kickCurve:null,kickDir:1,cd:0,aiIQ:false,aimSweet:-1,kickHit:false,
 msSw:false,tcSpin:0,chg:-1,shotOn:false,shotPow:1,shotCtl:1,passTo:null,act:null,pinOn:false,pinPose:false,retPh:null,
 hold:{on:false,holdRest:0.01,holdGrip:0.6,carryMult:1},stats:null},o||{});

// the rod slides at v for T s past a ball resting at (rel, y, dz); how far the ball is taken along, as a share of the rod's travel
function slide(X,o){
 const P=X.CONFIG.physics,r=mkRod(o.rod),dt=1/960,T=o.T||0.8,v=o.v||30;
 const b={m:{position:{x:o.rel,y:o.y==null?P.ballR:o.y,z:o.dz}},v:{x:0,y:0,z:0},t:X.BALL_TYPES.classic,spin:0,didSplit:false,scored:false};
 if(o.holdDepth!=null)X.shotHoldUpdate(r,o.holdDepth);
 r.vz=v*(r.hold.on?r.hold.carryMult:1);
 for(let i=0;i<T/dt;i++){
  if(o.holdDepth!=null)X.shotHoldUpdate(r,o.holdDepth);
  r.offset+=r.vz*dt;
  X.collideRod(b,r);
  b.m.position.x+=b.v.x*dt;b.m.position.z+=b.v.z*dt;
 }
 return (b.m.position.z-o.dz)/r.offset;
}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const K=X.KICK,was={d:K.rearDot,c:K.rearCarry};
 const back=()=>{K.rearDot=was.d;K.rearCarry=was.c;};
 const pc=f=>(f*100).toFixed(0)+'%';
 ok('the keys exist: rearDot, rearCarry numbers; dribble.back is not behind the pivot',typeof K.rearDot==='number'&&typeof K.rearCarry==='number'&&X.AIC.dribble.back>=0);
 K.rearDot=0.3;K.rearCarry=0;
 // ---- the back of a man does not carry a ball ------------------------------------------------------------------
 for(const rel of [-2.45,-2.2,-1.5]){const f=slide(X,{rel,dz:2.4});ok('a ball '+(-rel)+' behind the pivot, at the back corner of a sliding man, is left behind',f<0.1,'taken along '+pc(f));}
 {const f=slide(X,{rel:-2.2,dz:2.4,holdDepth:1});ok("...the player's hold is no different",f<0.15,'taken along '+pc(f));}
 {const f=slide(X,{rel:-2.2,dz:2.4,rod:{act:'dribble',hold:{on:false}}});ok("...nor is the AI's dribble block",f<0.1,'taken along '+pc(f));}
 {const f=slide(X,{rel:-2.2,dz:1.0,y:6.5});ok('...and the leg above the foot box behaves the same',f<0.15,'taken along '+pc(f));}
 // ---- what is not the back of a man ----------------------------------------------------------------------------
 {const f=slide(X,{rel:-0.5,dz:2.4});ok("the SIDE of the foot still pushes a ball along: that is the tap",f>0.9,'taken along '+pc(f));}
 {const f=slide(X,{rel:2.5,dz:2.4});ok('the front corner still carries what it touches (the dribble in front of the man)',f>0.4,'taken along '+pc(f));}
 {const f=slide(X,{rel:-2.2,dz:2.4,rod:{pinPose:true}});ok('a posed rod keeps the grip: the pin cushions a ball by matching its sideways speed',f>0.4,'taken along '+pc(f));}
 // ---- the switch -----------------------------------------------------------------------------------------------
 K.rearCarry=1;
 {const f=slide(X,{rel:-2.2,dz:2.4});ok('rearCarry 1 is the old behaviour: carried along',f>0.4,'taken along '+pc(f));}
 K.rearCarry=0.5;
 {const f=slide(X,{rel:-2.2,dz:2.4}),h=(()=>{K.rearCarry=1;const a=slide(X,{rel:-2.2,dz:2.4});K.rearCarry=0.5;return a;})();ok('...and half is between',f>0.1&&f<h,'half '+pc(f)+' of full '+pc(h));}
 K.rearCarry=0;K.rearDot=2;
 {const f=slide(X,{rel:-2.2,dz:2.4});ok('rearDot beyond 1 turns it off: no contact normal is that far back',f>0.4,'taken along '+pc(f));}
 back();
 return R;
}

let bad=0,total=0;
const base=suite(boot());
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info?'   ['+t.info+']':''));}else console.log('  ok    '+t.name+(t.info?'   ['+t.info+']':''));}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

/* Mutations: each edits the REAL source and must fail at least one assertion above. */
const G='(nx*r.kickDir<-KICK.rearDot&&!r.pinPose)?cvz*KICK.rearCarry:cvz';
const MUTS=[
 {n:'the foot box carries the back again',part:'col',first:true,from:/b\.v\.z=lerp\(b\.v\.z,\(nx\*r\.kickDir<-KICK\.rearDot&&!r\.pinPose\)\?cvz\*KICK\.rearCarry:cvz,g\);/,to:'b.v.z=lerp(b.v.z,cvz,g);'},
 {n:'the leg carries the back again',part:'col',from:'b.v.x=lerp(b.v.x,cvx,g);b.v.z=lerp(b.v.z,'+G+',g);\n    if(!trapping)capSpeed(b,r,false,in2);',to:'b.v.x=lerp(b.v.x,cvx,g);b.v.z=lerp(b.v.z,cvz,g);\n    if(!trapping)capSpeed(b,r,false,in2);'},
 {n:'the front is the one that does not carry',part:'col',from:'nx*r.kickDir<-KICK.rearDot',to:'nx*r.kickDir>KICK.rearDot'},
 {n:'a posed rod loses its grip too',part:'col',from:'&&!r.pinPose)?cvz*KICK.rearCarry:cvz',to:')?cvz*KICK.rearCarry:cvz'},
 {n:'rearCarry is ignored (always none)',part:'col',from:'?cvz*KICK.rearCarry:cvz',to:'?0:cvz'},
 {n:'rearDot is ignored (any contact is the back)',part:'col',from:'nx*r.kickDir<-KICK.rearDot&&',to:'true&&'},
 {n:'the side face counts as the back',part:'col',from:'nx*r.kickDir<-KICK.rearDot&&',to:'nx*r.kickDir<=0&&'}
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
