/* Wall-play harness.   node tools/wallplay-harness.js
   Slices the REAL wallAssist (stats.js) out of its file — and, for the integration half, the real
   collideRod + aimAssist + passFaceOK it is called from — and runs them against live CONFIG.
   The question it answers: does a strike on a ball pinned against a side wall now leave INFIELD, for
   both teams and both walls, without adding energy; and is everything that is NOT a forward strike on
   a wall ball left exactly alone. The live repro (two MID rows trading a wall ball for 25s on 8 of 12
   seeds) is in CLAUDE.md; this pins the rule so a retune can't quietly bring the loop back. */
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const STATS=rd('js/stats.js'),PHYS=rd('js/physics.js'),RODS=rd('js/rods.js');
const WALL=slice(STATS,'function wallAssist(b,r,noPass){',NL+'}')+NL+'}';
const HEAVY=[
 slice(PHYS,'function collideRod(b,r){','function ballBall('),
 slice(PHYS,'function capSpeed(b,r,sweet,in2){',NL+'function collideRod('),
 slice(RODS,'function styleCfg(',NL+'function kickStyleCfg'),
 slice(RODS,'function kickStyleCfg(r){',NL+'/* Was a contact'),
 slice(RODS,'function passFaceOK(r,nx){',NL+'/* The BALL-CONTROL'),
 slice(RODS,'function holdCfg(r){',NL+'/* aimAt'),
 slice(rd('js/shots.js'),'function shotsOn(){',NL+NL+'/* ---- the modifier axis'),
 slice(STATS,'function stHit(r){',NL),
 slice(STATS,'function stGrip(r){',NL),
 slice(STATS,'function stCapFrac(r){',NL),
 slice(STATS,'function aimAssist(b,r,noPass){',NL+'/* WALL PLAY')
].join(NL);

/* cfg / FOOT_JITTER / SHOT are config.js top-level names and are NOT restubbed (a second declaration
   in one scope is a SyntaxError). RNG.jit returns 0.5 so the contact jitter is exactly 0. */
const stubs=[
"var USER=false;function isUserRod(){return USER;}",
"var dbgLogRod=null;function dbgRod(){}",
"var S={time:0,eff:[{boost:-1,frozen:-1,big:-1},{boost:-1,frozen:-1,big:-1}],balls:[],lastTouch:-1,teamStats:null,shake:0};",
"var RNG={jit:function(){return 0.5;}};",
"var Au={kick:function(){}};",
"function shotSpray(){} function shotConsume(){} function momContact(){} function msContact(){} function dbgHit(){}",
"function makeBall(){return null;} function syncBall(){} function notice(){}",
"var SHOTC=CONFIG.shots;",
"var STC=CONFIG.stats;function ST(r,k){return STC.base;} function stFat(){return 1;} function stAccFrac(){return 0;}"
].join(NL);

/* Values come out through an EXPLICIT export: config.js's aliases are top-level const, which never
   become properties of the vm context — read them off ctx and every threshold is silently undefined. */
function boot(real){
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,
  localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,real,
  ';globalThis.X={CONFIG:CONFIG,AIC:AIC,F:F,BALL_R:BALL_R,KICK:KICK,BALL_TYPES:BALL_TYPES,'+
  'RODDEFS:(typeof RODDEFS!=="undefined"?RODDEFS:null),wallAssist:wallAssist,'+
  'collideRod:(typeof collideRod==="function"?collideRod:null),setUser:function(v){USER=v;}};'
 ].join(NL),ctx);
 if(!ctx.X||!ctx.X.CONFIG||!ctx.X.AIC.wallPlay)throw new Error('export line did not run');
 return ctx.X;
}

/* ---- the rule itself ---- */
function units(X,quiet){
 let pass=0,fail=0;
 const ok=(n,c,d)=>{c?pass++:fail++;if(!quiet)console.log((c?'  ok   ':'  FAIL ')+n+(d?'   ['+d+']':''));};
 const hdr=t=>{if(!quiet)console.log(t);};
 const W=X.AIC.wallPlay,F=X.F,R=X.BALL_R,WZ=F.W/2-R,base=Object.assign({},W);
 const reset=()=>{Object.assign(W,base);X.setUser(false);};
 const rod=(team,o)=>Object.assign({team,kickDir:team?-1:1,x:team?7.5:-7.5,angVel:17.3*(team?-1:1),passTo:null,aimEv:null},o||{});
 const ball=(x,z,vx,vz)=>({m:{position:{x,y:R,z}},v:{x:vx,y:0.7,z:vz}});
 const head=(b,r)=>Math.atan2(b.v.z*(b.m.position.z>0?-1:1),b.v.x*r.kickDir);
 const goalAng=(x,dir)=>Math.atan2(WZ,(dir*F.L/2-x)*dir);
 const deg=a=>(a*57.29578).toFixed(1)+'°';
 reset();

 hdr('-- the logged case, both teams, both walls (rel 3.2 in front of a MID, pinned)');
 for(const [team,side] of [[0,1],[0,-1],[1,1],[1,-1]]){
  const r=rod(team),dir=r.kickDir,bx=r.x+dir*3.2,b=ball(bx,side*WZ,dir*80,0);
  X.wallAssist(b,r,false);
  const want=Math.min(W.maxAng,Math.max(W.minAng,goalAng(bx,dir)));
  const nm=(team?'blue':'red')+' '+(side>0?'+z':'-z')+' wall';
  ok(nm+': leaves infield',b.v.z*side<0,'v.z '+b.v.z.toFixed(2));
  ok(nm+': still forward',b.v.x*dir>0);
  ok(nm+': aimed at goal centre',Math.abs(head(b,r)-want)<1e-9,deg(head(b,r))+' vs '+deg(want));
  ok(nm+': no energy added',Math.abs(Math.hypot(b.v.x,b.v.y,b.v.z)-Math.hypot(80,0.7))<1e-9);
  ok(nm+': v.y untouched',b.v.y===0.7);
 }

 hdr('-- converges, and never makes a good heading worse');
 {const r=rod(0),b=ball(-4.3,WZ,80,0);X.wallAssist(b,r,false);const vx=b.v.x,vz=b.v.z;X.wallAssist(b,r,false);
  ok('a second contact in the same swing changes nothing',Math.abs(b.v.x-vx)<1e-9&&Math.abs(b.v.z-vz)<1e-9);}
 {const r=rod(0),b=ball(-4.3,WZ,70,25);X.wallAssist(b,r,false);
  ok('a strike driven INTO the wall is turned all the way to the target',Math.abs(head(b,r)-goalAng(-4.3,1))<1e-9,deg(head(b,r)));}
 {const b=ball(-4.3,WZ,60,-50);X.wallAssist(b,rod(0),false);
  ok('a ball already leaving further infield is left alone',b.v.x===60&&b.v.z===-50);}

 hdr('-- gates: only a forward STRIKE on a WALL ball by an AI rod');
 {const r=rod(0),out=ball(-4.3,WZ-W.gap-0.01,80,0),inn=ball(-4.3,WZ-W.gap+0.01,80,0);
  X.wallAssist(out,r,false);X.wallAssist(inn,r,false);
  ok('a ball just outside gap is not a wall ball',out.v.z===0);
  ok('…and just inside it is',inn.v.z<0);}
 {const b1=ball(-4.3,WZ,80,0),b2=ball(-4.3,WZ,80,0);
  X.wallAssist(b1,rod(0,{angVel:W.minW*0.9}),false);X.wallAssist(b2,rod(0,{angVel:-17.3}),false);
  ok('a boot barely moving is a block, not a strike',b1.v.z===0);
  ok('a boot swinging BACKWARD never bends it',b2.v.z===0);}
 {const b1=ball(-4.3,WZ,W.minVX*0.9,0),b2=ball(-4.3,WZ,-60,0);
  X.wallAssist(b1,rod(0),false);X.wallAssist(b2,rod(0),false);
  ok('a ball leaving slower than minVX is left alone',b1.v.z===0);
  ok('a ball leaving backward is left alone',b2.v.x===-60&&b2.v.z===0);}
 {const b=ball(-4.3,WZ,80,0);X.wallAssist(b,rod(1,{x:-22.5}),false);
  ok('blue\'s forward is -x: a +x ball off a blue boot is not its strike',b.v.x===80&&b.v.z===0);}
 {X.setUser(true);const b=ball(-4.3,WZ,80,0);X.wallAssist(b,rod(0),false);
  ok('a player-held rod is untouched by default (human:false)',b.v.z===0);
  W.human=true;const b2=ball(-4.3,WZ,80,0);X.wallAssist(b2,rod(0),false);
  ok('…and bent when human:true',b2.v.z<0);reset();}
 {W.on=false;const b=ball(-4.3,WZ,80,0);X.wallAssist(b,rod(0),false);
  ok('on:false is a true off switch',b.v.x===80&&b.v.z===0);reset();}

 hdr('-- what it aims at');
 {const r=rod(0,{aimEv:{best:{tz:9}}}),b=ball(-4.3,WZ,80,0);X.wallAssist(b,r,false);
  const want=X.AIC.gapAim.gap?Math.atan2(WZ-9,64.3):goalAng(-4.3,1);
  ok('the rod\'s gap lane when it has one',Math.abs(head(b,r)-want)<1e-9,deg(head(b,r))+' vs '+deg(want));}
 {const P={x:22.5,z:18.5},r=rod(0,{passTo:P}),b=ball(-4.3,WZ,80,0);X.wallAssist(b,r,false);
  const want=Math.atan2(WZ-P.z,P.x+4.3);
  ok('the receiver on a pass',Math.abs(head(b,r)-want)<1e-9,deg(head(b,r))+' vs '+deg(want));
  const b2=ball(-4.3,WZ,80,0);X.wallAssist(b2,r,true);
  ok('…but not on a graze (noPass): goal centre instead',Math.abs(head(b2,r)-goalAng(-4.3,1))<1e-9);}
 {const r=rod(0,{x:22.5}),b=ball(26,WZ,80,0);X.wallAssist(b,r,false);
  ok('an ATT beside the box is capped at maxAng, never a square ball',Math.abs(head(b,r)-W.maxAng)<1e-9,deg(head(b,r)));}
 {const r=rod(0,{passTo:{x:22.5,z:WZ+0.5}}),b=ball(-4.3,WZ,80,0);X.wallAssist(b,r,false);
  ok('a target on the wall side still leaves at least minAng infield',Math.abs(head(b,r)-W.minAng)<1e-9,deg(head(b,r)));}

 hdr('-- gap covers the strip no rod can get outside (from live rod geometry)');
 {const C=X.CONFIG,SP=C.rods.spacing;let worst=-1e9,wn='';
  const defs=X.RODDEFS||[{men:2,role:'DEF'},{men:3,role:'ATT'},{men:5,role:'MID'}];
  for(const d of defs){if(d.role==='GK')continue;                        // a keeper never reaches the wall
   const sp=d.men===2?SP.two:d.men===3?SP.three:SP.other;
   let mo=(F.W-C.rods.margin-(d.men-1)*sp)/2;if(d.slideCap!=null)mo=Math.min(mo,d.slideCap);
   const strip=WZ-((d.men-1)/2*sp+mo);if(strip>worst){worst=strip;wn=d.role+' '+d.men+'-man';}}
  ok('every outfield rod\'s out-of-reach wall strip is inside gap',worst<=W.gap,'widest '+worst.toFixed(2)+' ('+wn+') vs gap '+W.gap);}
 return {pass,fail};
}

/* ---- through the REAL collideRod: a MID boot at its slide limit swinging into a pinned wall ball.
   Walks the ball IN from out of reach until the boot's leading face first touches it — a swing
   arriving at a ball in front, as in the kick log (rel ~3.2, dz 2.1) — then compares on and off. ---- */
function strikes(X){
 let pass=0,fail=0;
 const ok=(n,c,d)=>{c?pass++:fail++;console.log((c?'  ok   ':'  FAIL ')+n+(d?'   ['+d+']':''));};
 const W=X.AIC.wallPlay,F=X.F,R=X.BALL_R,C=X.CONFIG,sp=C.rods.spacing.other;
 const mo=(F.W-C.rods.margin-4*sp)/2,baseZ=[-2*sp,-sp,0,sp,2*sp];
 const rodFor=(team,side)=>{const dir=team?-1:1;
  return {idx:0,x:team?7.5:-7.5,team,role:'MID',baseZ,removedUntil:[0,0,0,0,0],offset:side*mo,maxOff:mo,trnHidden:false,
   angle:0.05*dir,angVel:17.3*dir,vz:0,kickT:0.008,kickStyle:null,kickCurve:null,kickDir:dir,cd:0,aiIQ:false,aimSweet:-1,
   kickHit:false,msSw:false,tcSpin:0,chg:-1,shotOn:false,shotPow:1,shotCtl:1,passTo:null,aimEv:null,act:null,
   hold:{on:false,holdRest:X.KICK.rest,holdGrip:X.KICK.grip,carryMult:1},stats:null};};
 const strike=(team,side)=>{
  for(let rel=6;rel>0.5;rel-=0.05){
   const r=rodFor(team,side),dir=r.kickDir;
   const b={m:{position:{x:r.x+dir*rel,y:R,z:side*(F.W/2-R)}},v:{x:0,y:0,z:0},t:X.BALL_TYPES.classic,spin:0,didSplit:false,scored:false};
   X.collideRod(b,r);
   const s=Math.hypot(b.v.x,b.v.y,b.v.z);
   if(s>1)return {rel,head:Math.atan2(b.v.z*(-side),b.v.x*dir),speed:s};
  }
  return null;
 };
 const deg=a=>(a*57.29578).toFixed(1)+'°';
 for(const [team,side] of [[0,1],[0,-1],[1,1],[1,-1]]){
  const nm=(team?'blue':'red')+' '+(side>0?'+z':'-z');
  W.on=false;const s0=strike(team,side);W.on=true;const s1=strike(team,side);
  ok(nm+': the boot reaches the wall ball',!!(s0&&s1),s0?'first contact at rel '+s0.rel.toFixed(2):'');
  if(!s0||!s1)continue;
  ok(nm+': OFF, the strike runs down the wall (the loop)',s0.head<W.minAng,deg(s0.head)+' infield');
  ok(nm+': ON, it leaves infield by at least minAng',s1.head>=W.minAng-1e-9,deg(s1.head)+' infield');
  ok(nm+': same speed either way — a rotation, not a kick',Math.abs(s1.speed-s0.speed)<1e-6,s1.speed.toFixed(2)+' u/s');
 }
 const CR=slice(PHYS,'function collideRod(b,r){','function ballBall(');
 const at=re=>[...CR.matchAll(re)].map(m=>m.index);
 const aims=at(/aimAssist\(b,r/g),walls=at(/wallAssist\(b,r/g),sprays=at(/shotSpray\(b,r\)/g);
 ok('both collideRod passes (boot and leg) call wallAssist',walls.length===2&&aims.length===2);
 ok('…each after its aimAssist and before its shotSpray',walls.length===2&&walls.every((w,i)=>w>aims[i]&&w<sprays[i]));
 return {pass,fail};
}

console.log('== wall play: the rule');
const u=units(boot(WALL),false);
console.log('== wall play: through collideRod');
const s=strikes(boot(HEAVY+NL+WALL));

/* ---- teeth: each mutant of wallAssist must break at least one rule assertion ---- */
const MUT=[
 ['infield sign flipped','const sz=p.z>0?-1:1','const sz=p.z>0?1:-1'],
 ['team direction ignored','const u=v.x*dir;','const u=v.x;'],
 ['target not clamped','clamp(Math.atan2((tz-p.z)*sz,(tx-p.x)*dir),W.minAng,W.maxAng)','Math.atan2((tz-p.z)*sz,(tx-p.x)*dir)'],
 ['un-bends a ball already infield','if(th<=0)return;',''],
 ['wall gate dropped','if(F.W/2-Math.abs(p.z)-BALL_R>W.gap)return;',''],
 ['strike gate dropped','if(r.angVel*dir<W.minW)return;',''],
 ['human gate dropped','(!W.human&&isUserRod(r))','false'],
 ['an additive nudge instead of a rotation','v.x=(u*cs-w*sn)*dir;v.z=(u*sn+w*cs)*sz;','v.z+=u*sn*sz;']
];
console.log('== mutations');
let caught=0;
for(const [name,from,to] of MUT){
 if(WALL.indexOf(from)<0){console.log('  STALE '+name+' — needle no longer in wallAssist');continue;}
 let r;try{r=units(boot(WALL.split(from).join(to)),true);}catch(e){r={fail:1,err:e.message};}
 const hit=r.fail>0;if(hit)caught++;
 console.log((hit?'  caught ':'  MISSED ')+name+(r.err?'   [threw: '+r.err+']':'   ['+r.fail+' assertions broke]'));
}
const P=u.pass+s.pass,Fl=u.fail+s.fail;
console.log(NL+P+' passed, '+Fl+' failed · mutations caught '+caught+'/'+MUT.length);
process.exitCode=(Fl||caught<MUT.length)?1:0;
