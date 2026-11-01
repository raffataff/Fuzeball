// pad harness. node tools/pad-harness.js
// the pad in a match: the left stick's slide against the rod's real speed (input.js slideBy, rods.js rodSlideMax), the right stick re-armed by a flick after a switch,
// LT latched at the pass depth and A waiting for a chord (shots.js shotPadRead / shotChordWait, input.js padSeatUpdate); slices them and runs them on live CONFIG
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 if(to==null)return src.slice(a);
 const b=src.indexOf(to,a+from.length);if(b<0)throw new Error('slice end miss: '+to);return src.slice(a,b);};

const stubs=[
"var S={time:0,phase:'play',freeRoam:false,userTeam:0,seats:[]};",
"var MULT=1;function rodSpeedMult(){return MULT;}function holdCfg(r){return r.H||null;}function teamDiff(){return 'pro';}",
"function seatRod(s){return s.rod;}function seatSlideOK(s){return S.time>=(s.slideArm||0);}",
"var KICKS=[];function shotKickEdge(r,m){KICKS.push({r:r,m:m});}",
"function toggleSweetGuide(){}function cycleCam(){}function seatStep(){}function rodRaiseRelease(){}function tcSwerveFromAxes(){return 0;}",
"function shotTrackMult(){return 1;}",
// the back guard: a backward turn is held at BL (null = clear); BLC = the `own` flag of every ask
"var BL=null,BLC=[];function backLimit(r,aT,rate,own){BLC.push(!!own);return (BL!=null&&(aT-r.angle)*r.kickDir<0)?Math.max(aT,BL):aT;}"
].join(NL);
// updateRods' human hand, one sim step
const sim="function simStep(r,s,dt){const ms=rodSlideMax(r,s,1),slow=rodSlow;r.target=clamp(r.target,-r.maxOff,r.maxOff);r.offset+=clamp(r.target-r.offset,-ms*dt,ms*dt);"+
 "if(slow&&SHOT.hold.lead!=null)r.target=clamp(r.target,r.offset-ms*SHOT.hold.lead,r.offset+ms*SHOT.hold.lead);}";

let pass=0,fail=0;const fails=[];
function ok(c,msg){if(c)pass++;else{fail++;fails.push(msg);}}

function boot(F){
 const real=[
  slice(F.sh,'const SHOTC=CONFIG.shots;','\n'),
  slice(F.sh,'function shotsOn(){','\n'),
  slice(F.sh,'function shotTrigD(gp,i){','// --- what the axis is worth ---'),
  slice(F.sh,'function shotInNew(){','\n'),
  slice(F.sh,'// one pad read into o;','function shotKbmAxis('),
  slice(F.sh,'function shotKickPress(TC){','// live charge for the readouts'),
  slice(F.in,'function slideBy(','function userControlUpdate('),
  slice(F.in,'function gpDown(gp,i){','\n'),
  slice(F.in,'function padSeatUpdate(','function toggleFreeRoam('),
  slice(F.ro,'let rodSlow=false;'),
  slice(F.se,'function seatStickSwitch(','\n'),
  // updateRods' right-stick branch, one sim step
  'function angStep(r,dt){if(false){}'+slice(F.ro,'else if(r.padAngleOn){','// THE PIN POSE')+'}'].join(NL);
 const ctx={console,Math,JSON,Object,Array,Set,Map,isNaN,isFinite,RegExp,String,Number,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,real,sim,
  ';globalThis.X={S:S,cfg:cfg,C:CONFIG,KICK:KICK,SHOT:SHOT,CTRL:CTRL,KICKS:KICKS,padSeatUpdate:padSeatUpdate,slideBy:slideBy,shotPadRead:shotPadRead,shotInNew:shotInNew,simStep:simStep,'+
  'angStep:angStep,seatStickSwitch:seatStickSwitch,mult:function(v){MULT=v;},guard:function(v){BL=v;BLC.length=0;},guardAsks:function(){return BLC.slice();}};'].join(NL),ctx);
 if(!ctx.X||!ctx.X.S)throw new Error('export line did not run');
 return ctx.X;
}

const FIX=1/120,FR=1/60;
const rod=o=>Object.assign({offset:0,target:0,maxOff:60,kickDir:1,angle:0,team:0,kickT:-1,kickStyle:null,kickHit:false,pinB:null,fwdR:false,act:null,
 padAngleOn:false,padAngleTarget:0,raise:false,chgSrc:null,tcSpin:0,H:null},o||{});
const seat=r=>({team:0,rod:r,tcMult:1,padAngleArm:true,padRs:0,kickW:-1,kickR:null,padRaise:false,shotPad:null,slideArm:0});
// a standard-layout pad: axes lx ly rx ry, LT 6 / RT 7 analog, btn = buttons held
function pad(o){o=o||{};const b=[];for(let i=0;i<18;i++)b.push({pressed:false,value:0});
 b[6]={pressed:(o.lt||0)>0.1,value:o.lt||0};b[7]={pressed:(o.rt||0)>0.1,value:o.rt||0};
 for(const i of o.btn||[])b[i]={pressed:true,value:1};
 return {axes:[o.lx||0,o.ly||0,o.rx||0,o.ry||0],buttons:b};}
// one rendered frame: the pad, then the fixed steps the accumulator owes (main.js)
function frame(X,s,gp,just,dt){
 dt=dt||FR;X.padSeatUpdate(dt,gp,s,just||{});if(s.shotPad)s.shotPad.live=false;
 s.acc=(s.acc||0)+dt;while(s.acc>=FIX-1e-9){const a0=s.rod.angle;X.simStep(s.rod,s,FIX);X.angStep(s.rod,FIX);s.maxStep=Math.max(s.maxStep||0,Math.abs(s.rod.angle-a0));X.S.time+=FIX;s.acc-=FIX;}
}
// a switch as setSeatCtrl makes it: the stick's turn (seatStickSwitch), every held input off both rods (rodInputRelease, clearRodAI)
function switchTo(X,s,r2){X.seatStickSwitch(s);for(const r of [s.rod,r2]){r.padAngleOn=false;r.padAngleTarget=0;r.padCarry=false;}s.rod=r2;s.maxStep=0;}
function speed(X,o){X.mult(o.mult||1);const r=rod(o.rod),s=seat(r);
 for(let i=0;i<4;i++)frame(X,s,pad(o.pad));const a=r.offset;for(let i=0;i<30;i++)frame(X,s,pad(o.pad));return Math.abs(r.offset-a)/(30*FR);}

function suite(X,quiet){
 pass=0;fail=0;fails.length=0;
 const cfg=X.cfg,KICK=X.KICK,DZ=cfg.padDeadzone,V=KICK.userSpeed,SH=X.SHOT,K=SH.pass;
 cfg.padSlideAxis='ly';cfg.padAngleAxis='ry';cfg.padSlideSens=1;cfg.padAngleSens=1;cfg.padSlideCurve=1;cfg.padSlideInvert=false;cfg.padAngleInvert=false;cfg.padControlMode='classic';
 const near=(a,b,t)=>Math.abs(a-b)<=t*Math.abs(b);
 /* 1. the slide: a full stick is the rod's own speed */
 {const v=speed(X,{pad:{ly:-1}});ok(near(v,V,0.01),'a full stick slides at the rod\'s top speed ('+v.toFixed(1)+' vs '+V+')');}
 {const v=speed(X,{pad:{ly:-1},mult:0.75});ok(near(v,V*0.75,0.01),'...and at a tired rod\'s, the whole throw still live ('+v.toFixed(1)+')');}
 {const ly=-(DZ+(1-DZ)*0.5),v=speed(X,{pad:{ly},mult:0.75});ok(near(v,V*0.75*0.5,0.02),'half the throw past the deadzone is half the rod\'s speed ('+v.toFixed(1)+' vs '+(V*0.375).toFixed(1)+')');}
 {const v=speed(X,{pad:{ly:-1},rod:{H:{carryMult:0.45}}});ok(near(v,V*0.45,0.02),'a full stick while carrying is the carry speed ('+v.toFixed(1)+')');}
 {const ly=-(DZ+(1-DZ)*0.5),v=speed(X,{pad:{ly},rod:{H:{carryMult:0.45}}});ok(near(v,V*0.45*0.5,0.03),'...and half the throw is half of it ('+v.toFixed(1)+')');}
 {const d=Math.SQRT1_2,v=speed(X,{pad:{lx:d,ly:-d}});ok(near(v,V*d,0.03),'a full push at 45 degrees slides at its share along the axis (radial deadzone: '+v.toFixed(1)+' vs '+(V*d).toFixed(1)+')');}
 {const v=speed(X,{pad:{lx:0.16,ly:-0.16}});ok(v<1e-6,'stick noise inside the deadzone on both axes slides nothing');}
 {const v=speed(X,{pad:{ly:-1,btn:[12]}});ok(near(v,V,0.01),'the d-pad with the stick is still the top speed');}
 /* 2. letting go stops the man */
 {X.mult(1);const r=rod(),s=seat(r);for(let i=0;i<30;i++)frame(X,s,pad({ly:-1}));const at=r.offset;for(let i=0;i<20;i++)frame(X,s,pad());
  ok(Math.abs(r.offset-at)<=V*X.CTRL.slideLead+1e-6,'letting go of a full stick stops the rod within slideLead of its travel ('+Math.abs(r.offset-at).toFixed(2)+')');}
 {X.mult(0.75);const r=rod(),s=seat(r);for(let i=0;i<30;i++){X.slideBy(r,s,-1,FR);frame(X,s,pad({ly:-1}));}const at=r.offset;for(let i=0;i<20;i++)frame(X,s,pad());
  ok(Math.abs(r.offset-at)<=V*0.75*X.CTRL.slideLead+1e-6,'two hands on one rod (keys and stick) still stop it where they let go ('+Math.abs(r.offset-at).toFixed(2)+')');}
 {X.mult(1);const r=rod(),s=seat(r);for(let i=0;i<72;i++)frame(X,s,pad({ly:-1}),null,1/144);const at=r.offset;for(let i=0;i<30;i++)frame(X,s,pad(),null,1/144);
  ok(Math.abs(r.offset-at)<=V*X.CTRL.slideLead+1e-6,'...at 144 Hz too, where some frames run no sim step ('+Math.abs(r.offset-at).toFixed(2)+')');}
 /* 3. the right stick after a switch: carried over (handover.stick), eased, guarded */
 const HO=X.CTRL.handover,cap=HO.stickW*FIX+1e-9;X.guard(null);
 {const s=seat(rod());for(let i=0;i<5;i++)frame(X,s,pad({ry:-1}));const r=rod();switchTo(X,s,r);for(let i=0;i<30;i++)frame(X,s,pad({ry:-1}));
  ok(Math.abs(r.angle-KICK.strikeA)<0.02,'a stick held forward through a switch holds the new rod\'s leg forward too ('+r.angle.toFixed(2)+')');
  ok(s.maxStep<=cap,'...turned onto it no faster than handover.stickW: the switch is not a swing ('+(s.maxStep/FIX).toFixed(1)+' rad/s)');
  ok(!r.padCarry,'...and the stick has it outright once the leg is there');}
 {const s=seat(rod());for(let i=0;i<5;i++)frame(X,s,pad({ry:1}));const r=rod();X.guard(-0.3);switchTo(X,s,r);for(let i=0;i<30;i++)frame(X,s,pad({ry:1}));const asks=X.guardAsks();X.guard(null);
  ok(Math.abs(r.angle+0.3)<1e-6&&asks.length&&asks.every(Boolean),'a stick held back through a switch is a lift the back guard holds short of a ball ('+r.angle.toFixed(2)+')');}
 {const s=seat(rod());for(let i=0;i<5;i++)frame(X,s,pad({ry:1}));const r=rod();switchTo(X,s,r);frame(X,s,pad({ry:-1}));
  ok(!r.padCarry&&s.maxStep>cap*2,'a flick on the first poll after a switch is the player\'s own swing, never eased');}
 {const s=seat(rod());for(let i=0;i<5;i++)frame(X,s,pad({ry:1}));const r=rod();switchTo(X,s,r);for(let i=0;i<3;i++)frame(X,s,pad({ry:1}));s.maxStep=0;frame(X,s,pad({ry:-1}));
  ok(!r.padCarry&&s.maxStep>cap*2,'...or a few frames later, while the carried lift is still easing in');}
 /* ...handover.stick off: the stick waits for the centre */
 HO.stick=false;
 {const s=seat(rod());frame(X,s,pad({ry:1}));const r=rod();switchTo(X,s,r);frame(X,s,pad({ry:1}));
  ok(!r.padAngleOn,'stick off: a stick held back at a switch does not drive the new rod');
  frame(X,s,pad({ry:-1}));
  ok(s.padAngleArm&&r.padAngleOn&&Math.abs(r.padAngleTarget-KICK.strikeA)<1e-9,'...flicked forward between two polls (no frame in the deadzone) it swings');}
 {const s=seat(rod());frame(X,s,pad({ry:-1}));const r=rod();switchTo(X,s,r);for(let i=0;i<10;i++)frame(X,s,pad({ry:-1}));
  ok(!r.padAngleOn,'...a stick held forward through a switch never snaps the new rod to the strike');
  frame(X,s,pad({ry:0}));frame(X,s,pad({ry:-1}));ok(r.padAngleOn,'...back to centre, it drives it again');}
 HO.stick=true;
 /* 4. LT latched at the pass depth (shotPadRead) */
 const raw=x=>SH.mod.dead+x*(1-SH.mod.dead);   // the trigger value whose rescaled depth is x
 {const o=X.shotInNew();X.shotPadRead(o,pad({lt:1}),false,0);X.shotPadRead(o,pad({lt:raw(0.35)}),false,0);
  ok(o.m<=K.modAt,'LT squeezed full then relaxed to 35% still reads as the pass ('+o.m.toFixed(2)+')');
  ok(Math.abs(o.mt+0.35)<1e-9,'...the raw axis is kept for Total Control\'s tracking');
  X.shotPadRead(o,pad({lt:raw(SH.hold.from*0.5)}),false,0);ok(o.m>K.modAt&&!o.deep,'...let back past the grip, it lets go');}
 {const o=X.shotInNew();X.shotPadRead(o,pad({lt:raw(0.35)}),false,0);ok(Math.abs(o.m+0.35)<1e-9,'a half squeeze that never went deep is still the soft swing');}
 {const o=X.shotInNew();X.shotPadRead(o,pad({lt:1}),false,0);X.shotPadRead(o,pad({lt:1,rt:1}),false,0);ok(o.m>K.modAt,'power still cancels a latched finesse');}
 {const k=K.keep;K.keep=false;const o=X.shotInNew();X.shotPadRead(o,pad({lt:1}),false,0);X.shotPadRead(o,pad({lt:raw(0.35)}),false,0);K.keep=k;
  ok(Math.abs(o.m+0.35)<1e-9,'pass.keep:false reads the raw depth');}
 /* 5. A and LT pressed together (the chord) */
 {X.KICKS.length=0;const r=rod(),s=seat(r);frame(X,s,pad());frame(X,s,pad({lt:raw(0.15),btn:[0]}),{0:true});
  ok(X.KICKS.length===0,'A pressed while LT is still on its way down waits');
  frame(X,s,pad({lt:1,btn:[0]}));
  ok(X.KICKS.length===1&&X.KICKS[0].m<=K.modAt,'...and fires as the pass once LT gets there');}
 {X.KICKS.length=0;const r=rod(),s=seat(r);frame(X,s,pad());frame(X,s,pad({btn:[0]}),{0:true});
  ok(X.KICKS.length===1&&X.KICKS[0].m===0,'A with LT at rest fires on the press');}
 {X.KICKS.length=0;const r=rod(),s=seat(r);frame(X,s,pad({lt:raw(0.35)}));frame(X,s,pad({lt:raw(0.35),btn:[0]}),{0:true});
  ok(X.KICKS.length===1&&Math.abs(X.KICKS[0].m+0.35)<1e-9,'A with LT held still at half fires at once, the soft swing');}
 {X.KICKS.length=0;const r=rod(),s=seat(r);frame(X,s,pad());let n=0;
  for(let i=0;i<20&&!X.KICKS.length;i++){frame(X,s,pad({lt:raw(0.02*(i+1)),btn:[0]}),i?{}:{0:true});n++;}
  ok(X.KICKS.length===1&&n<=Math.ceil(K.chord/FR)+1,'a slowly rising LT holds the press no longer than pass.chord ('+n+' frames)');}
 {X.KICKS.length=0;const r=rod(),s=seat(r);frame(X,s,pad({lt:1}));frame(X,s,pad({lt:raw(0.35)}));frame(X,s,pad({lt:raw(0.35),btn:[0]}),{0:true});
  ok(X.KICKS.length===1&&X.KICKS[0].m<=K.modAt,'A after LT went deep and relaxed is still the pass');}
 {X.KICKS.length=0;const r=rod(),s=seat(r);frame(X,s,pad());frame(X,s,pad({lt:raw(0.15),btn:[0]}),{0:true});s.rod=rod();frame(X,s,pad({lt:1,btn:[0]}));
  ok(X.KICKS.length===0,'a waiting press is dropped when the rod changes under it');}

 if(!quiet){console.log('assertions: '+pass+' passed, '+fail+' failed');for(const f of fails)console.log('  FAIL  '+f);}
 return fail;
}

const F={in:rd('js/input.js'),sh:rd('js/shots.js'),ro:rd('js/rods.js'),se:rd('js/seats.js')};
const base=suite(boot(F),false);

/* ---- mutations: each must break the suite ---- */
const muts=[
 ['in',' const v=rodSlideMax(r,s,1),',' const v=95,','the stick asks a fixed speed, not the rod\'s'],
 ['in','r.target=clamp(clamp(r.target+clamp(u,-1,1)*v*dt,r.offset-L,r.offset+L),-r.maxOff,r.maxOff);','r.target=clamp(r.target+clamp(u,-1,1)*v*dt,-r.maxOff,r.maxOff);','the target runs on ahead of the rod'],
 ['in','mag=Math.hypot(lx,ly);',"mag=Math.abs(cfg.padSlideAxis==='lx'?lx:ly);",'a per-axis deadzone'],
 ['in','if(!s.padAngleArm&&(Math.abs(rs)<=DZ||rs*(s.padRs||0)<0))s.padAngleArm=true;','if(!s.padAngleArm&&Math.abs(rs)<=DZ)s.padAngleArm=true;','a flick through centre does not re-arm the stick'],
 ['in','if(!s.padAngleArm&&(Math.abs(rs)<=DZ||rs*(s.padRs||0)<0))s.padAngleArm=true;','s.padAngleArm=true;','a stick held through a switch snaps the new rod'],
 ['in',' s.padRs=rs;\n','\n','the last poll is never kept'],
 ['in','  else if(shotChordWait(P,s.kickW))s.kickW+=dt;\n','\n','A never waits for LT'],
 ['in','  if(s.kickR!==r)s.kickW=-1;\n','\n','a waiting press lands on the next rod'],
 ['in','shotKickEdge(r,P?P.m:0);','shotKickEdge(r,shotPadAxis(gp));','the press reads the raw trigger, not the latch'],
 ['sh','o.m=o.deep?shotAxis(1,rt):o.mt;','o.m=o.mt;','LT is never latched'],
 ['sh','(!!o.deep&&lt>SHOTC.hold.from)','!!o.deep','the latch never lets go'],
 ['sh','&&o.lt>o.lw','','a still LT holds the press'],
 ['sh','&&w<C','','a rising LT holds the press for ever'],
 ['ro','else if(H)ms*=H.carryMult;','','the grip does not slow the rod'],
 ['se','if(H&&H.stick){s.padCarry=true;s.carryRs=s.padRs||0;}else s.padAngleArm=false;','s.padAngleArm=false;','a switch never carries the stick'],
 ['se','if(H&&H.stick){s.padCarry=true;s.carryRs=s.padRs||0;}else s.padAngleArm=false;','s.padCarry=true;s.carryRs=s.padRs||0;','handover.stick off still carries it'],
 ['ro','a=r.angle+clamp(a-r.angle,-W,W);','','a carried angle snaps on at the stick\'s own rate'],
 ['ro','const to=r.padCarry?backLimit(r,r.padAngleTarget,rate,true):r.padAngleTarget;','const to=r.padAngleTarget;','a carried lift is not guarded'],
 ['ro','if(Math.abs(r.padAngleTarget-a)<0.02)r.padCarry=false;','','the carry never hands the stick back'],
 ['in','r.padCarry=r.padAngleOn&&!mv;','r.padCarry=r.padAngleOn;','a flick at the switch is eased'],
 ['in',' else if(r.padCarry&&(!r.padAngleOn||mv))r.padCarry=false;\n','\n','a flick during the carry is eased']
];
let caught=0;
for(const [file,find,repl,name] of muts){
 const src=F[file];
 if(src.indexOf(find)<0){console.log('  BROKEN  '+name+' — anchor not found');continue;}
 const m=src.replace(find,repl);
 if(m===src){console.log('  BROKEN  '+name+' — no-op');continue;}
 let f;try{f=suite(boot(Object.assign({},F,{[file]:m})),true);}catch(e){f=1;}
 if(f>0){caught++;console.log('  caught  ('+f+' assertions)  '+name);}
 else console.log('  SURVIVED  '+name);
}
console.log('mutations caught: '+caught+'/'+muts.length);
process.exitCode=(base>0||caught<muts.length)?1:0;
