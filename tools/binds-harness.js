'use strict';
// ===== binds harness: node tools/binds-harness.js =====
// boots core + config + rng + js/shots.js + js/binds.js in one vm against shots-harness's stubs plus a keys map and seat table, and drives the keyboard/mouse half of the shot system through the real merged step (shotSeatsUpdate)
// pins, in order: the binding data (every action defaulted, no clash in a group, no reserved key bound, every default label drawable); rebinding (taking a key off the action that had it, within its group, refusing a reserved key, a list edited back to default following CONFIG); device ownership (a mouse button drives the mouse player's rod); the merge (an idle pad mustn't release the keyboard's wind-up, another source mustn't steal it); the keyboard verbs
// MUTATIONS at the bottom must each break the suite; mutate() refuses a no-op mutant

const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8').replace(/\r\n/g,'\n');

let pass=0,fail=0;const fails=[];
function ok(c,msg){if(c)pass++;else{fail++;fails.push(msg);}}

function build(srcShots,srcBinds){
 const rec={kicks:[],fire:[],fed:0};
 const ctx={console,Math,Date,JSON,Object,Array,String,Number,Boolean,Map,Set,isNaN,isFinite,
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  kickRod(r,style,aimAt,curve){
   if(r.kickT>=0)return;
   r.kickT=0;r.kickStyle=style||null;r.kickCurve=curve||null;r.passTo=aimAt||null;
   r.chg=-1;r.chgSrc=null;r.chgA=null;r.trem=0;
   rec.kicks.push({style:r.kickStyle,curve:r.kickCurve,pow:r.shotPow,on:r.shotOn});
  },
  gpDown(gp,i){const b=gp.buttons[i];return!!b&&(b.pressed||b.value>0.5);},
  sweepClips(){return false;},
  passPick(){return null;},laneObs(){return [];},lineClr(){return 9;},manLive(){return true;},
  sideAngle(rel,fwd){return fwd?0.97:-0.7;},   // ai.js: the angle that lays the leg over a ball (the forward pin assist reads it)
  stGrip(){return 0.08;},
  rods:[],
  Au:{chargeFeed(){rec.fed++;},chargeMark(){},chargeFire(k,s){rec.fire.push(k);},ui(){},beep(){}},
  keys:{},
  S:{balls:[{m:{position:{x:40,y:1.9,z:0}},v:{x:0,y:0,z:0},scored:false}],time:0,seats:[],phase:'play',freeRoam:false,photo:null},
  seatRod(s){return s.rods[s.ctrl]||null;},
  rodInputRelease(r){if(r){r.padAngleOn=false;r.kickHold=false;}},
  // seats.js's own rule: exact device first, then a 'pad*' holder for a pad token.
  seatForDev(tok){
   const ss=ctx.S.seats;
   for(const s of ss)if(s.devs.indexOf(tok)>=0)return s;
   if(/^pad\d+$/.test(tok))for(const s of ss)if(s.devs.indexOf('pad*')>=0)return s;
   return null;
  },
  __rec:rec};
 ctx.globalThis=ctx;ctx.window=ctx;
 vm.createContext(ctx);
 vm.runInContext(read('js/core.js'),ctx,{filename:'core.js'});
 vm.runInContext(read('js/config.js'),ctx,{filename:'config.js'});
 vm.runInContext(read('js/rng.js'),ctx,{filename:'rng.js'});
 vm.runInContext(srcShots,ctx,{filename:'shots.js'});
 vm.runInContext(srcBinds,ctx,{filename:'binds.js'});
 vm.runInContext('globalThis.__c={CONFIG,SHOT,KICK,cfg,rngSeed,shotsOn,shotBlend,shotReset,shotInNew,shotPadRead,'+
  'shotSeatsUpdate,shotKickEdge,shotKbmAxis,shotCharge,shotPadAxis,shotFwdAngle,shotFwdHold,shotPinSeat,AIC,bindList,bindDev,bindIs,bindActs,bindHeld,bindLabel,'+
  'bindCap,bindHint,bindAdd,bindRemove,bindReset,bindSet,bindReserved};',ctx,{filename:'export.js'});
 ctx.__c.rngSeed(777);
 return ctx;
}
function rod(over){
 const r={idx:0,x:22.5,team:0,role:'ATT',kickDir:1,angle:0,offset:0,maxOff:12,baseZ:[0],men:[{}],
  removedUntil:[],kickT:-1,kickStyle:null,kickCurve:null,passTo:null,kickHold:false,vz:0,pinOn:false,pinPose:false,pinFwd:false,pinA:null,pinB:null,fwdOut:false,
  raise:false,padAngleOn:false,padAngleTarget:0,
  chg:-1,chgRel:0,chgMod:null,chgA:null,chgSrc:null,chgHeld:0,chgSweet:false,trem:0,
  chgBlock:0,chgEndT:null,chgEndBand:-1,chgEndK:0,
  shotOn:false,shotPow:1,shotCtl:1,shotTrack:1,shotExert:1,
  hold:{on:false,holdRest:0,holdGrip:0,carryMult:1}};
 return Object.assign(r,over||{});
}
function pad(lt,rt,btn){
 const b=[];for(let i=0;i<17;i++)b.push({pressed:false,value:0});
 b[6]={pressed:lt>0.1,value:lt};b[7]={pressed:rt>0.1,value:rt};
 if(btn)for(const i of btn)b[i]={pressed:true,value:1};
 return {buttons:b,axes:[0,0,0,0]};
}
const HUDCAP=/\[[^\]]+\]/g;   // hud.js hudTok's keycap token

function run(srcShots,srcBinds){
 pass=0;fail=0;fails.length=0;
 const ctx=build(srcShots,srcBinds),C=ctx.__c,B=C.CONFIG.binds,CH=C.SHOT.charge,rec=ctx.__rec,S=ctx.S,keys=ctx.keys;
 const reset=()=>{for(const k in keys)delete keys[k];rec.kicks.length=0;rec.fire.length=0;C.cfg.keyBinds={};S.seats.length=0;S.phase='play';S.time=0;};
 const solo=(r)=>{const s={team:0,devs:['kbd','mouse','pad*'],rods:[r],ctrl:0,shotRod:null,shotPad:null,kbmFin:0};S.seats.push(s);return s;};
 const frames=(n,fn)=>{for(let i=0;i<n;i++){S.time+=1/60;if(fn)fn(i);C.shotSeatsUpdate(1/60);}};

 /* ===== 1. THE DATA ===== */
 const listed=new Set(B.list.map(b=>b.act));
 for(const a of Object.keys(B.def))ok(listed.has(a),'default "'+a+'" appears in the Options list');
 for(const b of B.list){
  ok(Array.isArray(B.def[b.act])&&B.def[b.act].length>0,'"'+b.act+'" has a default input');
  ok(b.grp==='play'||b.grp==='replay','"'+b.act+'" has a known group');
  ok(B.def[b.act].length<=B.max,'"'+b.act+'" defaults fit under binds.max');
  for(const c of B.def[b.act]){
   ok(!C.bindReserved(c),'"'+b.act+'" default '+c+' is not reserved');
   const lab=C.bindLabel(c);
   ok(!!lab&&lab.indexOf(']')<0,'label for '+c+' is drawable in a [keycap] ('+lab+')');
  }
 }
 const seen={};
 for(const b of B.list)for(const c of B.def[b.act]){const k=b.grp+'|'+c;ok(!seen[k],'default '+c+' does ONE thing in '+b.grp+' (also '+seen[k]+')');seen[k]=b.act;}
 // what the owner asked for, pinned so a tidy-up can't quietly undo it
 ok(B.def.power[0]==='ShiftRight','POWER defaults to Right Shift');
 ok(B.def.finesse[0]==='ControlRight','FINESSE defaults to Right Ctrl');
 ok(B.def.rodPrev.indexOf('KeyA')>=0&&B.def.rodNext.indexOf('KeyD')>=0,'A / D switch rods');
 ok(B.def.raise.indexOf('ShiftRight')<0,'Right Shift is no longer raise');
 ok(B.def.finesse.indexOf('AltRight')<0,'finesse is not on Right Alt (Alt+Space is the Windows window menu)');
 ok(C.cfg.keyBinds&&typeof C.cfg.keyBinds==='object','cfg.keyBinds exists');
 // hint markup: one keycap per shown input, and an unbound action drops its whole clause
 reset();
 ok((C.bindCap('kick',2).match(HUDCAP)||[]).length===2,'bindCap(kick,2) draws two keycaps');
 ok(C.bindCap('kick',2).indexOf('[LMB]')>=0,'the left mouse button draws as the mouse glyph');
 C.bindSet('guide',[]);
 ok(C.bindHint('guide','guide')==='','an unbound action gives no hint clause');
 reset();

 /* ===== 2. REBINDING ===== */
 let res=C.bindAdd('power','KeyQ');
 ok(res.ok&&C.bindIs('power','KeyQ'),'Q can be bound to power');
 ok(!C.bindIs('rodPrev','KeyQ'),'…and is TAKEN from previous-rod, which had it');
 ok(res.moved.indexOf('rodPrev')>=0,'…and the caller is told it moved from previous-rod');
 res=C.bindAdd('kick','KeyS');
 ok(!C.bindIs('slideDown','KeyS'),'S bound to kick leaves slide-down (same group)');
 ok(C.bindIs('saveClip','KeyS'),'…but stays save-clip in a replay (different group)');
 res=C.bindAdd('kick','Escape');
 ok(!res.ok&&res.why==='reserved'&&!C.bindIs('kick','Escape'),'Escape cannot be bound');
 reset();
 C.bindAdd('camera','KeyZ');C.bindRemove('camera','KeyZ');
 ok(C.cfg.keyBinds.camera===undefined,'a list edited back to its default stops being stored');
 for(const c of ['KeyG','KeyH','KeyJ','KeyK','KeyN'])C.bindAdd('guide',c);
 ok(C.bindList('guide').length===B.max&&C.bindIs('guide','KeyN'),'past binds.max the newest input still lands');
 C.bindReset();
 ok(C.bindList('guide').join()===B.def.guide.join(),'reset puts every default back');
 reset();

 /* ===== 3. DEVICE OWNERSHIP (co-op) ===== */
 {
  const rk=rod(),rm=rod({idx:1});
  const sk={team:0,devs:['kbd'],rods:[rk],ctrl:0},sm={team:1,devs:['mouse'],rods:[rm],ctrl:0};
  S.seats.push(sk,sm);
  keys.Mouse0=true;
  ok(C.bindHeld('kick',sm)&&!C.bindHeld('kick',sk),'a held mouse button is the MOUSE player\'s kick only');
  keys.Mouse0=false;keys.ShiftRight=true;
  ok(C.bindHeld('power',sk)&&!C.bindHeld('power',sm),'a held key is the KEYBOARD player\'s power only');
  ok(C.shotKbmAxis(sm)===0&&C.shotKbmAxis(sk)===1,'the axis follows the device too');
 }
 reset();

 // ===== 4. THE WIND-UP: POWER + A PULL-BACK, FIRED ONLY BY A KICK (charge.needRaise) =====
 // power alone isn't a charge and letting go isn't a shot (a one-key release charge was a keyboard advantage over a pad); every device obeys the same rule
 ok(CH.needRaise===true,'needRaise ships ON');
 const PW='ShiftRight',RS='ShiftLeft';
 const tBand=(CH.sweetFrom+CH.sweetTo)/2/CH.rate;
 {
  const r=rod(),s=solo(r);
  keys[PW]=true;frames(30);
  ok(r.chg===-1&&r.chgSrc===null&&!r.shotOn,'POWER alone winds nothing up');
  keys[PW]=false;frames(2);
  ok(rec.kicks.length===0,'…and letting it go fires nothing');
  keys[RS]=true;frames(30);
  ok(r.chg===-1&&r.chgSrc===null,'RAISE alone winds nothing up either');
 }
 reset();
 {
  const r=rod(),s=solo(r);
  keys[PW]=true;keys[RS]=true;
  frames(Math.round(tBand*60));
  ok(r.chgSrc==='key','POWER + RAISE winds up (src "key")');
  ok(r.chg>CH.sweetFrom&&r.chg<CH.sweetTo,'…at the pad\'s rate: mid-band after the same hold (chg '+r.chg.toFixed(3)+')');
  ok(r.chgA!=null&&r.chgA<0,'…and authors the pull-back angle');
  ok(r.shotOn&&r.shotPow>1,'…armed while held');
  ok(rec.kicks.length===0,'nothing fires while it is held');
  C.shotKickEdge(r,C.shotKbmAxis(s));
  ok(rec.kicks.length===1&&rec.kicks[0].on&&rec.kicks[0].style==='shot','KICK fires the charged shot');
  ok(rec.fire.length===1,'…with the discharge sound');
  ok(r.chgEndT!=null&&r.chgEndBand===1,'…and a CLEAN verdict on the marker');
  frames(3);
  ok(rec.kicks.length===1,'…and letting the keys go afterwards fires nothing more');
 }
 reset();
 {
  // letting go WITHOUT a kick cancels — and must disarm at once: the rod eases forward out of its
  // pull-back, and that drop must not carry a charge into the ball.
  const r=rod(),s=solo(r);
  keys[PW]=true;keys[RS]=true;frames(Math.round(tBand*60));
  keys[RS]=false;frames(1);
  ok(rec.kicks.length===0,'dropping RAISE mid-wind-up fires nothing');
  ok(r.chg===-1&&!r.shotOn,'…and disarms the rod on the spot');
  // …but a kick a beat later (keys lift a frame apart) still gets it
  C.shotKickEdge(r,C.shotKbmAxis(s));
  ok(rec.kicks.length===1&&rec.kicks[0].on,'a kick inside the grace still fires the wind-up');
  ok(r.chgEndBand===1,'…with its verdict');
 }
 reset();
 {
  const r=rod(),s=solo(r);
  keys[PW]=true;keys[RS]=true;frames(Math.round(tBand*60));
  keys[PW]=false;keys[RS]=false;frames(Math.ceil(CH.grace*60)+2);
  C.shotKickEdge(r,0);
  ok(rec.kicks.length===1&&!rec.kicks[0].on,'past the grace, a kick is the ordinary swing');
 }
 reset();
 /* THE MERGE: an idle pad beside the keyboard must not release — or here, cancel — its wind-up. */
 {
  const r=rod(),s=solo(r);s.shotPad=C.shotInNew();
  keys[PW]=true;keys[RS]=true;
  frames(20,()=>C.shotPadRead(s.shotPad,pad(0,0),false,0));
  ok(r.chgSrc==='key'&&r.chg>0.4,'an IDLE pad does not cancel a keyboard wind-up (chg '+r.chg.toFixed(3)+')');
  frames(5,()=>C.shotPadRead(s.shotPad,pad(0,1,[2]),false,0));
  ok(rec.kicks.length===0&&r.chgSrc==='key','RT + X going down mid-wind-up does not steal it');
  C.shotKickEdge(r,C.shotKbmAxis(s));
  ok(rec.kicks.length===1&&rec.kicks[0].on,'…and kick still fires it');
 }
 reset();
 /* THE PAD OBEYS THE SAME RULE: RT is only the power. */
 {
  const r=rod(),s=solo(r);s.shotPad=C.shotInNew();
  frames(30,()=>C.shotPadRead(s.shotPad,pad(0,1),false,0));
  ok(r.chg===-1&&r.chgSrc===null,'RT alone winds nothing up');
  frames(20,()=>C.shotPadRead(s.shotPad,pad(0,1,[2]),false,0));
  ok(r.chgSrc==='rt'&&r.chg>0.4,'RT + X winds up (src "rt")');
  frames(1,()=>C.shotPadRead(s.shotPad,pad(0,0),false,0));
  ok(rec.kicks.length===0&&r.chg===-1,'letting RT go fires nothing');
 }
 reset();
 {
  const r=rod(),s=solo(r);s.shotPad=C.shotInNew();
  frames(20,()=>C.shotPadRead(s.shotPad,pad(0,1),false,-1));
  ok(r.chgSrc==='stick'&&r.chg>0.4,'RT + the right stick pulled back winds up with the STICK as the pull-back');
  ok(r.chgA===null,'…authoring no angle: the stick is already where the player put it');
  frames(1,()=>C.shotPadRead(s.shotPad,pad(0,1),false,1));
  ok(rec.kicks.length===0&&r.shotOn&&r.chgRel>0,'the forward flick banks it for the strike the stick itself makes');
 }
 reset();
 {
  const r=rod(),s=solo(r);CH.needRaise=false;
  keys[PW]=true;frames(20);
  ok(r.chgSrc==='key','needRaise:false restores the old rule: power alone winds up');
  keys[PW]=false;frames(1);
  ok(rec.kicks.length===1&&rec.kicks[0].on,'…and letting it go fires');
  CH.needRaise=true;
 }
 reset();

 /* ===== 5. KICK, PASS, GRIP ===== */
 {
  const r=rod(),s=solo(r);
  C.shotKickEdge(r,C.shotKbmAxis(s));
  const k=rec.kicks[0];
  ok(k&&k.style===null&&k.curve===null&&!k.on,'a plain kick with nothing held is the old kick, byte for byte');
 }
 reset();
 {
  // POWER held alone colours a kick exactly as RT alone does: the hard curve, no charge.
  const r=rod(),s=solo(r);
  keys[PW]=true;frames(10);
  C.shotKickEdge(r,C.shotKbmAxis(s));
  const hard=C.shotBlend(1),k=rec.kicks[0];
  ok(k&&k.curve&&Math.abs(k.curve.strike-hard.strike)<1e-9,'POWER + kick is the hard swing, like RT + A');
  ok(k&&Math.abs(k.pow-C.SHOT.mod.hardPow)<1e-9,'…uncharged (pow '+(k&&k.pow)+')');
 }
 reset();
 {
  const r=rod(),s=solo(r);
  keys.ControlRight=true;
  ok(C.shotKbmAxis(s)===-1,'FINESSE is full finesse on the axis');
  C.SHOT.pin.fwd.on=false;   // with the forward pin off the chord is the old one: a pass, or with no lane the soft touch
  C.shotKickEdge(r,C.shotKbmAxis(s));
  C.SHOT.pin.fwd.on=true;
  const soft=C.shotBlend(-1);
  ok(rec.kicks.length===1&&rec.kicks[0].curve&&Math.abs(rec.kicks[0].curve.strike-soft.strike)<1e-9,'finesse + kick with no lane is the soft touch (forward pin off)');
  keys[PW]=true;
  ok(C.shotKbmAxis(s)===0,'power + finesse cancel, like both triggers');
 }
 reset();
 {
  const r=rod(),s=solo(r),H=C.SHOT.hold;
  keys.ControlRight=true;
  frames(2);
  const g1=r.hold.holdGrip;
  ok(r.hold.on&&g1<H.grip,'FINESSE eases the grip in rather than stepping (second frame '+g1.toFixed(3)+')');
  frames(Math.ceil(C.SHOT.kbm.holdRamp*60)+1);
  ok(r.hold.on&&Math.abs(r.hold.holdGrip-H.grip)<1e-9,'…and reaches the full hold');
  ok(Math.abs(r.hold.carryMult-H.carry)<1e-9,'…including the carry slow-down');
  keys.ControlRight=false;frames(1);
  ok(!r.hold.on,'letting go drops it the same frame');
  keys.ControlRight=true;keys[PW]=true;keys[RS]=true;frames(5);
  ok(!r.hold.on,'a live wind-up cancels the grip');
 }
 reset();

 /* ===== 6. HAND-OFF, PHASE, OFF SWITCH ===== */
 {
  const a=rod(),b=rod({idx:1}),s=solo(a);s.rods.push(b);
  keys[PW]=true;keys[RS]=true;frames(15);
  ok(a.chg>0,'(a charge is live on rod A)');
  s.ctrl=1;frames(1);
  ok(a.chg===-1&&a.chgSrc===null,'switching rods leaves no wind-up on the rod let go of');
  ok(rec.kicks.length===0,'…and does not fire it');
  ok(b.chgSrc==='key','…while the keys, still held, wind up the new rod');
 }
 reset();
 {
  const r=rod(),s=solo(r);keys[PW]=true;keys[RS]=true;frames(10);
  S.phase='pause';frames(1);
  ok(r.chg===-1&&rec.kicks.length===0,'pausing mid-wind-up clears it without a shot');
 }
 reset();
 {
  const r=rod(),s=solo(r);C.SHOT.on=false;
  keys[PW]=true;keys[RS]=true;keys.ControlRight=true;frames(20);
  ok(r.chg===-1&&!r.shotOn&&!r.hold.on,'shots off: the modifiers do nothing at all');
  ok(C.shotKbmAxis(s)===0,'…and the kick axis is 0, i.e. the plain kick');
  C.SHOT.on=true;
 }
 reset();

 // ===== 7. THE PIN CHORD (finesse + raise) =====
 // both were temperamental live: the pin waited on finesse's eased grip (a chord landed the raise too early), and a raise tapped between two frames was missed by the once-a-frame read
 {
  const r=rod(),s=solo(r);
  keys.ControlRight=true;keys[RS]=true;frames(1);
  ok(r.pinPose===true,'finesse + raise pressed on the SAME frame pose the pin at once');
  keys[RS]=false;frames(3);
  ok(r.pinPose===true,'…and the pose stays latched once the raise comes up');
  keys.ControlRight=false;frames(1);
  ok(!r.pinPose,'…until finesse lets go');
 }
 reset();
 {
  const r=rod(),s=solo(r);
  keys.ControlRight=true;frames(5);
  s.rzEdge=true;frames(1);   // input.js bindPress latches a raise PRESS here; the key is already back up
  ok(r.pinPose===true,'a raise tapped between two frames still poses the pin (the latched press)');
  ok(s.rzEdge===false,'…and the latch is spent by that one step');
 }
 reset();
 {
  const r=rod(),s=solo(r);
  keys.ControlRight=true;frames(8);
  ok(!r.pinPose,'finesse alone, no raise, no latch: no pose');
 }
 reset();

 // ===== 8. THE FORWARD PIN CHORD (finesse + kick) =====
 // the kick press with finesse down poses the men forward instead of swinging: the pin's other half, like finesse + raise (shots.js shotPinFwdPress / shotFwdAngle)
 {
  const W=C.SHOT.pin.fwd,r=rod(),s=solo(r);
  keys.ControlRight=true;frames(2);
  C.shotKickEdge(r,C.shotKbmAxis(s));
  ok(rec.kicks.length===0,'finesse + kick fires no swing');
  ok(r.pinPose===true&&r.pinFwd===true,'...it poses the forward pin');
  ok(r.pinA===W.angle*r.kickDir,'...at the forward angle when no ball is near');
  frames(4);
  ok(r.pinOn&&r.pinPose&&r.pinFwd,'the pose is LATCHED once the kick is up, like the raise');
  ok(r.pinA===W.angle*r.kickDir,'...and the target holds');
  r.angle=W.angle;   // the harness rod never turns: put the leg where the pose would have it
  keys.ControlRight=false;frames(1);
  ok(!r.pinPose&&!r.pinFwd&&r.pinOn===false,'letting finesse go ends the pin and the pose');
  ok(r.fwdOut===true,'...and marks the leg as coming back from the forward pin (the guard)');
  r.angle=W.outA*0.5;frames(1);
  ok(r.fwdOut===false,'...until it is back near rest');
 }
 reset();
 {
  const r=rod(),s=solo(r);
  C.shotKickEdge(r,C.shotKbmAxis(s));
  ok(rec.kicks.length===1&&rec.kicks[0].style===null&&!r.pinPose,'kick with no finesse is the plain swing, no pose');
 }
 reset();
 {
  const r=rod(),s=solo(r);
  keys.ControlRight=true;keys[PW]=true;
  C.shotKickEdge(r,C.shotKbmAxis(s));
  ok(rec.kicks.length===1&&!r.pinPose,'power + finesse cancel (axis 0): the plain kick, not the pose');
 }
 reset();
 {
  const r=rod(),s=solo(r);
  keys.ControlRight=true;
  C.SHOT.pin.fwd.on=false;
  C.shotKickEdge(r,C.shotKbmAxis(s));
  C.SHOT.pin.fwd.on=true;
  ok(rec.kicks.length===1&&!r.pinPose&&!r.pinFwd,'fwd.on false: finesse + kick is the swing again, nothing posed');
 }
 reset();
 {
  // a trigger squeezed half-way is a soft touch, not the pose (the old pass rule's axis); fully down is the pose
  const r=rod(),s=solo(r),half=pad(0.3,0),full=pad(1,0);
  C.shotKickEdge(r,C.shotPadAxis(half));
  ok(rec.kicks.length===1&&!r.pinPose,'LT half-squeezed + A is the soft swing');
  r.kickT=-1;rec.kicks.length=0;
  C.shotKickEdge(r,C.shotPadAxis(full));
  ok(rec.kicks.length===0&&r.pinPose&&r.pinFwd,'LT down + A poses the forward pin');
 }
 reset();
 {
  // a Total Control stick wind-up is live (no kickRod, no source of its own to release): the press is not the pose
  const r=rod(),s=solo(r);
  r.chg=0.4;r.chgSrc='stick';
  C.shotKickEdge(r,-1);
  ok(!r.pinPose&&!r.pinFwd,'a live wind-up is never posed over');
 }
 reset();
 {
  // a ball held: a back pin's kick is the pin shot, the forward pin's is nothing
  const r=rod({pinB:{scored:false},pinPose:true,pinFwd:false}),s=solo(r);
  keys.ControlRight=true;
  C.shotKickEdge(r,C.shotKbmAxis(s));
  ok(rec.kicks.length===1&&rec.kicks[0].style==='trapShot','a ball on the back pin: kick is the pin shot');
  rec.kicks.length=0;
  const f=rod({pinB:{scored:false},pinPose:true,pinFwd:true});
  C.shotKickEdge(f,C.shotKbmAxis(s));
  ok(rec.kicks.length===0,'a ball held under the forward leg: kick fires nothing');
  ok(f.pinB&&f.pinPose&&f.pinFwd,'...and the pin and its pose are untouched');
 }
 reset();
 {
  // the latest press picks the pin: raise after kick = back pin, kick after raise HELD = forward (a held raise must not undo it)
  const r=rod(),s=solo(r);
  keys.ControlRight=true;frames(2);
  C.shotKickEdge(r,C.shotKbmAxis(s));frames(2);
  ok(r.pinFwd,'(forward posed)');
  s.rzEdge=true;frames(1);
  ok(r.pinPose&&!r.pinFwd,'a raise press after it takes the pin back to the back pose');
  keys[RS]=true;frames(3);
  ok(r.pinPose&&!r.pinFwd,'(raise held: back pin)');
  C.shotKickEdge(r,C.shotKbmAxis(s));frames(3);
  ok(r.pinPose&&r.pinFwd,'a kick press with raise still HELD takes it forward, and the held raise does not undo it');
  keys[RS]=false;frames(2);
  ok(r.pinFwd,'...nor does letting the raise go');
 }
 reset();
 {
  // a ball held under the forward leg keeps its pose whatever the raise says
  const r=rod({pinB:{scored:false},pinPose:true,pinFwd:true,pinOn:true,pinA:0.9}),s=solo(r);
  keys.ControlRight=true;frames(2);
  s.rzEdge=true;frames(2);
  ok(r.pinFwd&&r.pinA===0.9,'raise while a ball is held under the forward leg changes nothing');
 }
 reset();
 {
  // the assist: up and clear beside a slow ball lying ahead, lowered onto the top once over it and slow, the pose angle with none
  const r=rod(),W=C.SHOT.pin.fwd,FE=C.AIC.catch.fetch,up=C.AIC.catch.recv.lift.angle,B=ctx.S.balls[0];
  B.v.length=function(){return Math.hypot(this.x,this.y,this.z);};
  const put=(rel,dz,v)=>{B.m.position.x=r.x+rel;B.m.position.z=dz;B.m.position.y=1.9;B.v.x=v||0;B.v.y=0;B.v.z=0;r.vz=0;};
  put(40,0);ok(C.shotFwdAngle(r)===W.angle,'no ball near: the pose angle');
  put(3.5,9);ok(C.shotFwdAngle(r)===W.angle,'a ball far off the man in z: the pose angle');
  put(3.5,2.5);ok(C.shotFwdAngle(r)===up,'beside a ball lying ahead: the leg is up and forward, clear of it');
  put(3.5,0.2);ok(C.shotFwdAngle(r)===0.97,'over it and slow: lowered onto the top (the AI sideAngle)');
  r.vz=FE.slideV+5;ok(C.shotFwdAngle(r)===up,'...not while the rod is still sliding fast');
  put(3.5,0.2,FE.bailV+3);ok(C.shotFwdAngle(r)===W.angle,'a ball rolling quicker than bailV is not lying there: the pose angle');
  put(FE.near-0.5,0.2);ok(C.shotFwdAngle(r)===W.angle,'a ball nearer than the fetch window: the pose angle');
  put(FE.far+0.5,0.2);ok(C.shotFwdAngle(r)===W.angle,'...and one beyond it');
  put(3.5,5.5);r.vz=40;ok(C.shotFwdAngle(r)===up,'a man the slide has on the ball in a moment counts: the leg is up before he arrives');
  r.vz=0;W.assist=false;put(3.5,0.2);ok(C.shotFwdAngle(r)===W.angle,'assist off: always the pose angle');
  W.assist=true;
  put(3.5,0.2);ok(C.shotFwdHold(r),'a ball under the leg holds it up when the pin is let go');
  put(3.5,9);ok(!C.shotFwdHold(r),'...and nothing under it does not');
  put(3.5,5.5);r.vz=40;ok(C.shotFwdHold(r),'...a man arriving counts as under it');
  put(6.6,2.2);ok(C.shotFwdHold(r),'a ball under the toe (out to holdFar) holds it too: the dropping boot presses it back toward the rod');
  put(C.SHOT.pin.fwd.holdFar+0.5,0.2);ok(!C.shotFwdHold(r),'...but not one beyond the boot');
  put(6.6,2.2);B.v.z=35;r.vz=35;ok(C.shotFwdHold(r),'a ball the leg stopped and carries along is at rest to it: held');
  put(6.6,2.2,45);ok(!C.shotFwdHold(r),'a ball running quickly through is not');
  r.vz=0;put(40,0);
 }
 reset();
 {
  // the kick plate is for a ball the kick would shoot
  const a=rod({pinB:{scored:false},pinPose:true,pinFwd:false}),s=solo(a);
  ok(C.shotPinSeat()===s,'a ball on the back pin shows the pin shot plate');
  a.pinFwd=true;
  ok(C.shotPinSeat()===null,'a ball under the forward leg does not');
 }
 reset();
 {
  const r=rod({pinFwd:true,pinPose:true,fwdOut:true,rzWas:true});
  C.shotReset(r);
  ok(!r.pinFwd&&!r.pinPose&&!r.fwdOut&&!r.rzWas,'shotReset clears the forward pin and its guard');
 }
 reset();
 return {pass,fail,fails:fails.slice()};
}

const SH=read('js/shots.js'),BI=read('js/binds.js');
const base=run(SH,BI);
console.log('\n=== binds harness ===');
console.log('assertions: '+base.pass+' passed, '+base.fail+' failed');
base.fails.forEach(f=>console.log('  FAIL  '+f));

/* ---- mutations ---- */
const muts=[];
function mutate(file,find,repl,name){muts.push({file,find,repl,name});}
mutate('shots','I.key=(pw&&(!SHOTC.charge.needRaise||rz))?1:0;','I.key=0;','the merge drops the keyboard\'s power source');
mutate('shots','I.key=(pw&&(!SHOTC.charge.needRaise||rz))?1:0;','I.key=pw?1:0;','POWER alone winds up on the keyboard');
mutate('shots','   else if(o.rz)o.rt=rt;','   else o.rt=rt;','RT alone winds up on the pad');
mutate('shots','  if(was!==\'stick\'&&C.needRaise){','  if(false){','letting go of a wind-up fires it');
mutate('shots','   r.chgRel=k;r.chgGrace=C.grace;r.chg=-1;\n   shotDisarm(r);','   r.chgRel=k;r.chgGrace=C.grace;r.chg=-1;','a cancelled wind-up stays armed for the next contact');
mutate('shots',' if(k<0&&r.chgGrace>0&&r.chgRel>0&&r.kickT<0){',' if(false){','a kick a frame late loses the wind-up');
mutate('shots','const own=r.chgSrc?shotSrcDepth(I,r.chgSrc):0;','const own=0;','another source can steal a live wind-up');
mutate('shots','s.kbmFin=fn?Math.min(1,(s.kbmFin||0)+dt/Math.max(1e-3,K.holdRamp)):0;','s.kbmFin=fn?1:0;','the keyboard grip steps straight to full');
mutate('shots','  shotVerdict(r,k);\n  shotFire(r,(r.chgMod!=null?r.chgMod:m),k);','  shotFire(r,(r.chgMod!=null?r.chgMod:m),k);','a kick-released charge leaves no verdict');
mutate('shots','if(s.shotRod&&s.shotRod!==r){shotReset(s.shotRod);rodInputRelease(s.shotRod);}','','a dropped rod keeps its wind-up');
mutate('shots','I.lt=Math.max(pl?P.lt:0,s.kbmFin);','I.lt=pl?P.lt:0;','finesse never grips');
mutate('binds','for(let i=0;i<l.length;i++)if(keys[l[i]]&&seatForDev(bindDev(l[i]))===s)return true;','for(let i=0;i<l.length;i++)if(keys[l[i]])return true;','a held input drives every seat, whoever owns the device');
mutate('binds','  if(l.indexOf(code)>=0){bindSet(b.act,l.filter(c=>c!==code));moved.push(b.act);}','','rebinding leaves the key on the action that had it');
mutate('binds',' if(bindReserved(code))return {ok:false,why:\'reserved\',moved:[]};','','Escape can be bound');
mutate('binds','  if(b.act===act||b.grp!==g)continue;','  if(b.act===act)continue;','a clash in one group steals across groups');
mutate('shots','  I.rz=rz||(pl&&P.rz)||!!s.rzEdge;s.rzEdge=false;','  I.rz=rz||(pl&&P.rz);s.rzEdge=false;','a raise tapped between frames is lost');
mutate('shots','  I.fin=fn||(pl&&P.fin);','  ','the pin waits on the eased grip, not the key');
mutate('shots',' if(!W||!W.on||!P.on||m>SHOTC.pass.modAt||r.chg>=0||r.kickT>=0)return false;',' return false;','finesse + kick never poses the forward pin');
mutate('shots',' if(!W||!W.on||!P.on||m>SHOTC.pass.modAt||r.chg>=0||r.kickT>=0)return false;',' if(!W||!W.on||!P.on||r.chg>=0||r.kickT>=0)return false;','a kick with no finesse poses the forward pin');
mutate('shots',' if(!W||!W.on||!P.on||m>SHOTC.pass.modAt||r.chg>=0||r.kickT>=0)return false;',' if(!W||!W.on||!P.on||m>SHOTC.pass.modAt||r.kickT>=0)return false;','a live wind-up is posed over');
mutate('shots',' else if(I.rz){r.pinPose=true;if(rzUp&&!r.pinB)r.pinFwd=false;}',' else if(I.rz){r.pinPose=true;if(!r.pinB)r.pinFwd=false;}','a held raise undoes the forward pose asked for after it');
mutate('shots',' else if(I.rz){r.pinPose=true;if(rzUp&&!r.pinB)r.pinFwd=false;}',' else if(I.rz){r.pinPose=true;if(rzUp)r.pinFwd=false;}','a raise press turns a held ball\'s forward pin into the back pin');
mutate('shots',' else if(I.rz){r.pinPose=true;if(rzUp&&!r.pinB)r.pinFwd=false;}',' else if(I.rz){r.pinPose=true;}','a raise press never takes the pin back');
mutate('shots',' if(r.pinB&&r.kickT<0){if(!r.pinFwd)shotPinFire(r);return;}',' if(r.pinB&&r.kickT<0){shotPinFire(r);return;}','kick fires a shot from under the forward leg');
mutate('shots',' if(r.pinPose&&!r.pinB)r.pinA=r.pinFwd?shotFwdAngle(r)*r.kickDir:shotPullCap(r,r.angle,P.angle*r.kickDir);',' if(r.pinPose&&!r.pinB)r.pinA=shotPullCap(r,r.angle,P.angle*r.kickDir);','the forward pose targets the back pin angle');
mutate('shots',' if(!r.pinOn){if(r.pinPose&&r.pinFwd)r.fwdOut=true;r.pinPose=false;r.pinFwd=false;}',' if(!r.pinOn){r.pinPose=false;r.pinFwd=false;}','letting go of the forward pin sets no guard');
mutate('shots',' if(!r.pinOn){if(r.pinPose&&r.pinFwd)r.fwdOut=true;r.pinPose=false;r.pinFwd=false;}',' if(!r.pinOn){if(r.pinPose&&r.pinFwd)r.fwdOut=true;r.pinPose=false;}','the forward flag outlives finesse');
mutate('shots',' if(r.fwdOut&&r.angle*r.kickDir<=P.fwd.outA)r.fwdOut=false;',' ','the guard never lets go');
mutate('shots',' return (h.dz<=FE.alignZ&&Math.abs(r.vz)<=FE.slideV)?sideAngle(h.rel,true):AIC.catch.recv.lift.angle;',' return AIC.catch.recv.lift.angle;','the leg never comes down onto the ball');
mutate('shots',' return (h.dz<=FE.alignZ&&Math.abs(r.vz)<=FE.slideV)?sideAngle(h.rel,true):AIC.catch.recv.lift.angle;',' return sideAngle(h.rel,true);','the leg is lowered beside the ball, not only over it');
mutate('shots',' return (h.dz<=FE.alignZ&&Math.abs(r.vz)<=FE.slideV)?sideAngle(h.rel,true):AIC.catch.recv.lift.angle;',' return (h.dz<=FE.alignZ)?sideAngle(h.rel,true):AIC.catch.recv.lift.angle;','the leg is lowered while the rod is still sliding fast');
mutate('shots',' const o1=clamp(r.offset+r.vz*P.fwd.lead,-r.maxOff,r.maxOff);',' const o1=r.offset;','the leg only counts where the men are now');
mutate('shots',' if(rel<rel0||rel>rel1||p.y>BALL_R+P.yTol||Math.min(b.v.length(),Math.hypot(b.v.x,b.v.z-r.vz))>vmax)continue;',' if(rel<rel0||rel>rel1||p.y>BALL_R+P.yTol)continue;','a rolling ball is treated as lying there');
mutate('shots',' if(rel<rel0||rel>rel1||p.y>BALL_R+P.yTol||Math.min(b.v.length(),Math.hypot(b.v.x,b.v.z-r.vz))>vmax)continue;',' if(rel<rel0||rel>rel1||p.y>BALL_R+P.yTol||b.v.length()>vmax)continue;','a ball carried along by the leg is not under it');
mutate('shots','function shotFwdHold(r){const W=SHOTC.pin.fwd;return shotFwdBall(r,W.holdNear,W.holdFar,W.holdV)!==null;}','function shotFwdHold(r){const W=SHOTC.pin.fwd;return shotFwdBall(r,W.holdNear,SHOTC.pin.fwdFront+1,W.holdV)!==null;}','the hold stops short of the toe');
mutate('shots',' if(!W.assist||typeof sideAngle!==\'function\')return W.angle;',' if(typeof sideAngle!==\'function\')return W.angle;','assist off is ignored');
mutate('shots','if(shotPinBall(S.seats[i])&&!seatRod(S.seats[i]).pinFwd)return S.seats[i];','if(shotPinBall(S.seats[i]))return S.seats[i];','the kick plate says pin shot over a forward-held ball');
mutate('shots',' r.pinOn=false;r.pinPose=false;r.pinA=null;r.pinFwd=false;r.fwdOut=false;r.rzWas=false;',' r.pinOn=false;r.pinPose=false;r.pinA=null;r.pinFwd=false;','a reset leaves the forward guard on the rod');
mutate('shots',' if(shotPinFwdPress(r,m))return;',' ','finesse + kick is the swing again');
let caught=0;
console.log('\n--- mutations (each must BREAK the suite) ---');
for(const m of muts){
 const src=m.file==='shots'?SH:BI;
 if(src.indexOf(m.find)<0){console.log('  BROKEN  '+m.name+' — anchor not found');continue;}
 const mut=src.replace(m.find,m.repl);
 if(mut===src){console.log('  BROKEN  '+m.name+' — mutant identical');continue;}
 let r;try{r=m.file==='shots'?run(mut,BI):run(SH,mut);}catch(e){r={fail:1,err:e.message};}
 if(r.fail>base.fail){caught++;console.log('  caught  ('+(r.err?'threw':(r.fail-base.fail)+' new assertions')+')  '+m.name);}   // beyond the baseline, or a mutant that only meets the failures already there reads as caught
 else console.log('  MISSED  '+m.name);
}

// ---- modSync (js/input.js): a modifier that lost its keyup ----
// sliced out of input.js: Windows can drop one Shift's keyup while the other is held, and a stuck one turned every raise into a wind-up; the event's modifier flags are the truth, keys[] is reconciled to them
function modRun(srcInput,quiet){
 const a=srcInput.indexOf('const MOD_KEYS='),e0=srcInput.indexOf('function modSync(e){'),b=srcInput.indexOf('\n}\n',e0)+3;
 if(a<0||e0<0||b<3)throw new Error('modSync slice miss');
 const rel=[],keys={};
 const f=new Function('keys','bindRelease',srcInput.slice(a,b)+';return modSync;')(keys,c=>rel.push(c));
 let n=0;const t=(c,m)=>{if(!c){n++;if(!quiet)console.log('  FAIL  '+m);}};
 keys.ShiftRight=true;f({code:'ShiftLeft',shiftKey:true});
 t(keys.ShiftRight&&!rel.length,'modSync: a Shift down with the flag down is left alone');
 f({code:'KeyA',shiftKey:false});
 t(!keys.ShiftRight&&rel[0]==='ShiftRight','modSync: a Shift the flag says is UP is released (through bindRelease)');
 keys.ShiftLeft=true;f({code:'ShiftLeft',shiftKey:false});
 t(keys.ShiftLeft,'modSync: the event\'s own key is never released by it');
 keys.ControlRight=true;f({code:'Space',shiftKey:true,ctrlKey:false});
 t(!keys.ControlRight,'modSync: Ctrl is reconciled the same way (finesse on R-Ctrl)');
 return n;
}
const IN_SRC=read('js/input.js');
const modFail=modRun(IN_SRC);
console.log('modSync: '+(modFail?modFail+' failed':'all passed'));
{const mut=IN_SRC.replace('  if(e[m[0]])continue;','  continue;');let f=0;try{f=modRun(mut,true);}catch(e){f=1;}
 if(mut!==IN_SRC&&f>0){caught++;console.log('  caught  modSync ignores the modifier flags');}else console.log('  MISSED  modSync ignores the modifier flags');
 muts.push({name:'modSync'});}
console.log('\nmutations caught: '+caught+'/'+muts.length);
process.exitCode=(base.fail||modFail||caught<muts.length)?1:0;
