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
// ai.js's real foot-box distance and step-off offset: the forward pin's sweep guard and hop measure the actual foot
const AI_SRC=read('js/ai.js'),aiCut=a=>{const i=AI_SRC.indexOf(a),j=AI_SRC.indexOf('\n}\n',i);if(i<0||j<0)throw new Error('ai.js slice miss: '+a);return AI_SRC.slice(i,j+3);};
const AI_GEO=aiCut('const _fb={')+aiCut('function clearOffset(r,bz,cz,prefer){');

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
  footAngle(rel,fwd){return fwd?0.97:-0.7;},   // ai.js: the angle that brings the foot down onto a ball (the forward pin assist reads it)
  hitAngle(rel){return Math.abs(rel)>9?null:(rel<0?-0.4:0.3);},   // ai.js: the angle that squares the foot's face onto a ball (shotSquare)
  pinSwing(){return null;},                    // physics.js: the pin shot's curve (the kick record keeps whatever it is given)
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
 vm.runInContext(AI_GEO,ctx,{filename:'ai.js'});
 vm.runInContext(srcShots,ctx,{filename:'shots.js'});
 vm.runInContext(srcBinds,ctx,{filename:'binds.js'});
 vm.runInContext('globalThis.__c={CONFIG,SHOT,KICK,cfg,rngSeed,shotsOn,shotBlend,shotReset,shotInNew,shotPadRead,'+
  'shotSeatsUpdate,shotKickEdge,shotKbmAxis,shotCharge,shotPadAxis,shotFwdAngle,shotFwdHold,shotFwdLead,shotPinSeat,AIC,bindList,bindDev,bindIs,bindActs,bindHeld,bindLabel,'+
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
  frames(3);
  ok(r.pinPose===true,'…and the pose holds while the raise is held');
  keys[RS]=false;frames(1);
  ok(!r.pinPose&&r.pinOn,'…and ends once the raise comes up, finesse still held (pin.latch false)');
  C.SHOT.pin.latch=true;keys[RS]=true;frames(1);keys[RS]=false;frames(3);
  ok(r.pinPose===true,'latch on: the pose stays once the raise comes up');
  keys.ControlRight=false;frames(1);
  ok(!r.pinPose,'…until finesse lets go');
  C.SHOT.pin.latch=false;
 }
 reset();
 {
  // a ball pinned keeps its pose whatever the raise does: finesse is what keeps it
  const r=rod(),s=solo(r);
  keys.ControlRight=true;keys[RS]=true;frames(2);
  r.pinB={scored:false};r.pinAt=r.pinA;keys[RS]=false;frames(3);
  ok(r.pinPose&&r.pinB,'a ball pinned: letting the raise go keeps the pose and the ball');
  r.pinB=null;frames(1);
  ok(!r.pinPose&&r.pinOn,'…and once it is gone the pose ends');
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
  keys.Space=true;C.shotKickEdge(r,C.shotKbmAxis(s));
  ok(rec.kicks.length===0,'finesse + kick fires no swing');
  ok(r.pinPose===true&&r.pinFwd===true,'...it poses the forward pin');
  ok(r.pinA===W.angle*r.kickDir,'...at the forward angle when no ball is near');
  frames(4);
  ok(r.pinOn&&r.pinPose&&r.pinFwd,'the pose holds while the kick is held');
  ok(r.pinA===W.angle*r.kickDir,'...and the target holds');
  r.angle=W.angle;   // the harness rod never turns: put the leg where the pose would have it
  keys.Space=false;frames(1);
  ok(r.pinOn&&!r.pinPose&&!r.pinFwd,'the kick up, finesse still held: the pose ends (pin.latch false)');
  ok(r.fwdOut===true,'...and marks the leg as coming back from the forward pin (the guard)');
  r.angle=W.outA*0.5;frames(1);
  ok(r.fwdOut===false,'...until it is back near rest');
 }
 reset();
 {
  const W=C.SHOT.pin.fwd,r=rod(),s=solo(r);C.SHOT.pin.latch=true;
  keys.ControlRight=true;frames(2);
  C.shotKickEdge(r,C.shotKbmAxis(s));frames(4);
  ok(r.pinOn&&r.pinPose&&r.pinFwd,'latch on: the forward pose stays once the kick is up');
  r.angle=W.angle;keys.ControlRight=false;frames(1);
  ok(!r.pinPose&&!r.pinFwd&&r.pinOn===false,'...letting finesse go ends the pin and the pose');
  ok(r.fwdOut===true,'...and marks the guard');
  C.SHOT.pin.latch=false;
 }
 reset();
 {
  // a pad: LT + A held keeps the forward pose, A let go ends it
  const r=rod(),s=solo(r);s.shotPad=C.shotInNew();
  frames(2,()=>C.shotPadRead(s.shotPad,pad(1,0),false,0));
  C.shotKickEdge(r,C.shotPadAxis(pad(1,0,[0])));
  frames(3,()=>C.shotPadRead(s.shotPad,pad(1,0,[0]),false,0));
  ok(rec.kicks.length===0&&r.pinPose&&r.pinFwd,'a pad: LT + A held keeps the forward pose');
  frames(1,()=>C.shotPadRead(s.shotPad,pad(1,0),false,0));
  ok(r.pinOn&&!r.pinPose&&!r.pinFwd,'...A let go ends it, LT still down');
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
  keys.Space=true;C.shotKickEdge(r,C.shotKbmAxis(s));frames(2);
  ok(r.pinFwd,'(forward posed)');
  s.rzEdge=true;frames(1);
  ok(r.pinPose&&!r.pinFwd,'a raise press after it takes the pin back to the back pose');
  keys[RS]=true;frames(3);
  ok(r.pinPose&&!r.pinFwd,'(raise held: back pin)');
  C.shotKickEdge(r,C.shotKbmAxis(s));frames(3);
  ok(r.pinPose&&r.pinFwd,'a kick press with raise still HELD takes it forward, and the held raise does not undo it');
  keys.Space=false;frames(1);
  ok(r.pinPose&&!r.pinFwd,'that kick let go with the raise still held: the back pin (the button still held takes over)');
  keys.Space=true;C.shotKickEdge(r,C.shotKbmAxis(s));frames(1);
  keys[RS]=false;frames(2);
  ok(r.pinFwd,'...nor does letting the raise go');
  keys[RS]=true;frames(1);
  ok(r.pinPose&&!r.pinFwd,'(raise pressed again: back pin)');
  keys[RS]=false;frames(1);
  ok(r.pinPose&&r.pinFwd,'that raise let go with the kick still held: the forward pin again');
  keys.Space=false;frames(1);
  ok(r.pinOn&&!r.pinPose,'both up, finesse held: no pose');
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
  put(3.5,3.6);ok(C.shotFwdAngle(r)===up&&!r.fwdBlk,'beside a ball lying ahead, the foot clear of it: the leg is up and forward');
  put(3.5,2.5);ok(C.shotFwdAngle(r)===0&&r.fwdBlk,'beside it with the foot in its path: the leg is held down and the man is to step off (the rise would sweep it)');
  r.angle=up;put(3.5,0.2);ok(C.shotFwdAngle(r)===0.97&&!r.fwdBlk,'over it with the leg up, slow: lowered onto the top (the AI footAngle)');
  r.angle=0;ok(C.shotFwdAngle(r)===0&&r.fwdBlk,'the man on it with the leg DOWN: held, not swung up through it');
  r.angle=up;r.vz=FE.slideV+5;ok(C.shotFwdAngle(r)===up,'...not lowered while the rod is still sliding fast');
  r.angle=0;
  put(3.5,0.2,FE.bailV+3);ok(C.shotFwdAngle(r)===W.angle,'a ball rolling away quicker than bailV is not lying there: the pose angle');
  put(FE.near-0.5,0.2);ok(C.shotFwdAngle(r)===W.angle,'a ball nearer than the fetch window: the pose angle');
  put(FE.far+0.5,0.2);ok(C.shotFwdAngle(r)===W.angle,'...and one at rest beyond it');
  put(3.5,5.5);r.vz=40;ok(C.shotFwdAngle(r)===up,'a man the slide has on the ball in a moment counts: the leg is up before he arrives');
  r.vz=0;put(3.5,4.6);ok(C.shotFwdAngle(r)===up,'a ball past his clearance but inside settle.z is seen (the settle draws him on)');
  W.assist=false;put(3.5,0.2);ok(C.shotFwdAngle(r)===W.angle,'assist off: always the pose angle');
  W.assist=true;
  C.SHOT.pin.assist.hop.on=false;put(3.5,0.2);ok(C.shotFwdAngle(r)===0.97&&!r.fwdBlk,'hop off: the leg goes straight for the top, through the ball (the old stroke)');
  C.SHOT.pin.assist.hop.on=true;
  // a ball rolling at the man from ahead: under the toe, then the foot onto it
  put(9,0.3,-6);ok(C.shotFwdAngle(r)===up,'a ball rolling at him from ahead on his line: the leg goes up so it rolls under the toe');
  r.angle=up;put(5,0.3,-10);ok(C.shotFwdAngle(r)===0.97,'...and comes down onto it inside the window');
  r.angle=0;put(9,2.5,-6);ok(C.shotFwdAngle(r)===W.angle&&r.fwdU,'off his line: the toe stays down (it stops the ball) and he is to be drawn onto it');
  r.angle=up;ok(C.shotFwdAngle(r)===up,'...but a leg already up stays up (coming down now would land on the ball)');
  r.angle=0;put(9,0.3,-1);ok(C.shotFwdAngle(r)===W.angle,'a ball creeping in slower than under.minV: the pose angle');
  put(9,0.3,-20);ok(C.shotFwdAngle(r)===W.angle,'...or one quicker than the pin can hold');
  C.SHOT.pin.assist.under.on=false;put(9,0.3,-6);ok(C.shotFwdAngle(r)===W.angle,'under off: the pose angle');C.SHOT.pin.assist.under.on=true;
  r.angle=up;put(6,0.3,-8);ok(C.shotFwdAngle(r)===0.97,'a ball just past the window rolling in: aimed where the leg will catch it, inside, so it comes down');
  ok(Math.abs(C.shotFwdLead(r,B,6)-(6-8/C.SHOT.pin.lower))<1e-9,'the lead is the leg\'s own lag, 1/pin.lower s');
  B.v.x=8;ok(Math.abs(C.shotFwdLead(r,B,4)-(4+8/C.SHOT.pin.lower))<1e-9,'...a ball rolling away is aimed further out');B.v.x=-8;
  ok(C.shotFwdLead(r,B,FE.near+0.1)===FE.near,'...never nearer than the window');
  {const fa0=ctx.footAngle;let seen=null;ctx.footAngle=(rel,fwd)=>{seen=rel;return fa0(rel,fwd);};
   put(4.5,0.3,-4);C.shotFwdAngle(r);ctx.footAngle=fa0;
   ok(seen!=null&&Math.abs(seen-(4.5-4/C.SHOT.pin.lower))<1e-9,'a slow ball rolling in under the leg: the foot is aimed where it will be, not where it is ('+seen+')');}
  r.angle=0;
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
  // the hop and the tap: kick held with the man on a slow ball steps him off it once the tap window is past; a tap strokes it (the pass)
  const W=C.SHOT.pin.fwd,A=C.SHOT.pin.assist,H=A.hop,T=A.settle,B=ctx.S.balls[0],tapN=Math.floor(H.tap*60);
  B.v.length=function(){return Math.hypot(this.x,this.y,this.z);};
  let r,s;
  const put=(rel,dz,vx)=>{B.m.position.x=r.x+rel;B.m.position.z=dz;B.m.position.y=1.9;B.v.x=vx||0;B.v.y=0;B.v.z=0;};
  const go=()=>{reset();r=rod({target:0});s=solo(r);keys.ControlRight=true;frames(20);keys.Space=true;C.shotKickEdge(r,C.shotKbmAxis(s));};   // well into the match: the tap window is timed from the press, not from 0
  go();put(3.5,0.2);frames(tapN-2);
  ok(r.pinPose&&r.pinFwd&&r.fwdBlk&&r.target===0,'kick held with the man on the ball: the leg is held and he waits out the tap window');
  frames(4);const t1=r.target;frames(1);
  ok(r.target<0&&Math.abs((t1-r.target)-H.v/60)<1e-9,'held past it: he steps off the ball at hop.v ('+t1.toFixed(3)+' -> '+r.target.toFixed(3)+')');
  frames(30);
  {const PH=C.CONFIG.physics,CZ=PH.footBox.z+PH.ballR+C.AIC.clearMargin+C.AIC.catch.fetch.clearPad;
   ok(Math.abs(r.target-(0.2-CZ))<1e-6,'...to just clear of it (the fetch clearance), the nearer side, and no further ('+r.target.toFixed(3)+')');}
  go();put(3.5,0.2);frames(3);keys.Space=false;frames(1);
  ok(r.pinPose&&r.pinFwd&&r.fwdStk>S.time&&r.pinA===W.angle,'a tap: the forward pose runs on at the pose angle, through the ball (the stroke, the pass)');
  ok(r.target===0,'...and nothing stepped');
  frames(Math.round((H.stroke-0.08)*60));
  ok(r.pinPose&&r.pinFwd,'...the stroke outlives the tap window');
  frames(8);
  ok(!r.pinPose&&!r.pinFwd,'...then it is let go like any forward pose');
  go();put(3.5,0.2);frames(tapN+2);keys.Space=false;frames(1);
  ok(!r.pinPose&&!(r.fwdStk>S.time),'a held kick let go: no stroke, the pose ends');
  go();put(40,0);frames(3);keys.Space=false;frames(1);
  ok(!r.pinPose&&!(r.fwdStk>S.time),'a tap with no ball held below the leg: the pose just ends');
  // the way back over: at the hop's speed while well off, the settle's near the ball
  go();put(3.5,3.0);r.angle=1.3;frames(2);
  {const t0=r.target;frames(1);ok(Math.abs((r.target-t0)-H.v/60)<1e-9,'over the ball and well off it: drawn back at hop.v');}
  r.offset=2.6;r.target=2.6;r.stlW=2.6;frames(1);
  ok(Math.abs((r.target-2.6)-T.v/60)<1e-9,'...and at settle.v once near ('+(r.target-2.6).toFixed(4)+')');
  // a ball rolling in off his line: he is drawn onto the z it arrives at
  go();put(9,2.5,-6);frames(8);
  ok(r.target>0.3&&r.fwdU,'a ball rolling in off his line, the slide still: he is drawn onto the z it arrives at ('+r.target.toFixed(2)+')');
  keys.Space=false;keys.ControlRight=false;frames(1);put(40,0);r.angle=0;
  // kick held FIRST (the swing frozen forward, the ball let under it), then finesse: the forward pin takes the leg over
  const held=()=>{reset();r=rod({target:0,kickT:0.3,heldFwd:true,kickHold:true,kickStyle:null,angle:1.1});s=solo(r);keys.Space=true;};
  held();put(4,0.2);frames(2);
  ok(r.kickT===0.3&&!r.pinPose,'(kick held alone: the frozen swing is left as it is)');
  keys.ControlRight=true;frames(1);
  ok(r.kickT<0&&!r.heldFwd&&r.pinOn&&r.pinPose&&r.pinFwd&&r.pinKh,'finesse pressed on a kick-held leg: the swing ends and the forward pin is posed');
  ok(r.pinA===0.97,'...the leg, already over the ball, comes down onto it ('+r.pinA+')');
  ok(!r.fwdStk,'...and it is a hold, not a tap: no stroke');
  keys.Space=false;frames(1);
  ok(!r.pinPose&&!(r.fwdStk>S.time),'...let go of kick, the pose ends (no stroke)');
  held();r.heldFwd=false;put(4,0.2);keys.ControlRight=true;frames(1);
  ok(r.kickT===0.3&&!r.pinPose,'finesse during the swing itself (not yet held forward) leaves the swing alone');
  held();r.kickHold=false;put(4,0.2);keys.ControlRight=true;frames(1);
  ok(r.kickT===0.3&&!r.pinPose,'...and a swing frozen over a ball with kick up is not the player\'s hold');
  held();put(4,0.2);keys.ControlRight=true;keys[PW]=true;frames(1);
  ok(r.kickT===0.3&&!r.pinPose,'...nor with power cancelling finesse');
  keys.Space=false;keys.ControlRight=false;keys[PW]=false;frames(1);put(40,0);r.angle=0;
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
  const r=rod({pinFwd:true,pinPose:true,fwdOut:true,rzWas:true,pinKh:true,fwdKT:3,fwdStk:4,fwdBlk:true,fwdU:true});
  C.shotReset(r);
  ok(!r.pinFwd&&!r.pinPose&&!r.fwdOut&&!r.rzWas&&!r.pinKh,'shotReset clears the forward pin, its held kick and its guard');
  ok(!r.fwdKT&&!r.fwdStk&&!r.fwdBlk&&!r.fwdU,'...and the hop, the stroke and their stamps (S.time restarts with the match)');
 }
 reset();

 // ===== 9. THE PIN ASSIST, THE STICK SETTLE, THE SLIDE SETTLE, THE SQUARE =====
 // the stubs: footAngle is -0.7 back / 0.97 forward, hitAngle -0.4 behind the rod / 0.3 ahead
 {
  const P=C.SHOT.pin,A=P.assist,K=A.stick,T=A.settle,Q=C.SHOT.square,FA=-0.7,BL=S.balls[0];
  BL.v.length=function(){return Math.hypot(this.x,this.y,this.z);};
  const put=(r,rel,dz,v)=>{BL.m.position.x=r.x+rel*r.kickDir;BL.m.position.z=dz;BL.m.position.y=1.9;BL.v.x=v||0;BL.v.y=0;BL.v.z=0;r.vz=0;};
  const away=()=>{BL.m.position.x=200;BL.m.position.z=0;};
  // back pin: finesse + raise
  let r=rod({target:0}),s=solo(r);
  keys.ControlRight=true;keys[RS]=true;
  put(r,40,0);frames(2);
  ok(r.pinPose&&!r.pinFwd&&r.pinA===P.angle,'back pin, no ball near: the pose angle');
  put(r,-3,3.3);frames(1);
  ok(r.pinA===A.up,'a slow ball beside the man behind the rod: the leg goes up and over ('+r.pinA+')');
  put(r,-3,0.2);r.angle=A.up;frames(1);
  ok(r.pinA===FA,'over it with the leg up: lowered onto its top (footAngle)');
  r.angle=FA-A.overTol*0.5;frames(1);
  ok(r.pinA===FA,'...and held there as it arrives');
  r.angle=0;frames(1);
  ok(r.pinA!==FA,'the man on the ball with the leg DOWN is not lowered onto it: the foot would come through it ('+r.pinA+')');
  r.angle=A.up;r.vz=A.slideV+4;C.shotSeatsUpdate(1/60);
  ok(r.pinA!==FA,'...nor while the rod slides fast');
  put(r,-3,0.2,A.v+3);r.angle=A.up;frames(1);
  ok(r.pinA===P.angle,'a ball rolling quicker than assist.v: the pose angle');
  put(r,A.near+0.5,0.2);frames(1);
  ok(r.pinA===P.angle,'a ball nearer than assist.near (no pose comes down on it): the pose angle');
  put(r,P.back-0.5,0.2);frames(1);
  ok(r.pinA===P.angle,'...and one beyond the back window');
  A.on=false;put(r,-3,0.2);r.angle=A.up;frames(1);A.on=true;
  ok(r.pinA===P.angle,'assist off: the fixed pose angle');
  keys[RS]=false;keys.ControlRight=false;frames(1);reset();

  // the stick with finesse
  r=rod({target:0});s=solo(r);keys.ControlRight=true;
  put(r,-3,0.2);r.angle=A.up;r.padAngleOn=true;r.padAngleTarget=-1.3;frames(1);
  ok(r.pinMag===FA,'stick back, leg over the ball: it settles onto the top ('+r.pinMag+')');
  r.padAngleTarget=FA+K.win-0.02;frames(1);
  ok(r.pinMag===FA,'...with the stick short of the catch angle by less than win');
  r.padAngleTarget=FA+K.win+0.05;frames(1);
  ok(r.pinMag===null,'...and not past win: the stick has the leg');
  r.padAngleTarget=-1.3;r.angle=0;frames(1);
  ok(r.pinMag===null,'the leg below the ball\'s top is not pulled down through it');
  r.angle=A.up;r.vz=A.slideV+4;C.shotSeatsUpdate(1/60);
  ok(r.pinMag===null,'...nor while sliding fast');
  K.on=false;r.vz=0;frames(1);K.on=true;
  ok(r.pinMag===null,'stick.on false: nothing settles');
  frames(1);ok(r.pinMag===FA,'(settles again)');
  r.pinB=BL;r.pinAt=FA;r.padAngleOn=false;frames(1);
  ok(r.pinMag===FA,'pinned: the stick let go to centre keeps it');
  r.padAngleOn=true;r.padAngleTarget=0.1;frames(1);
  ok(r.pinMag===FA,'...so does a stick a little past upright');
  r.padAngleTarget=K.keep+0.1;frames(1);
  ok(r.pinMag===null,'...the stick pushed past keep the other way lets it go');
  r.pinAt=0.97;r.padAngleTarget=-K.keep-0.1;frames(1);
  ok(r.pinMag===null&&r.pinFwd,'a forward pin: the stick pulled back past keep lets it go, and it reads forward');
  r.padAngleTarget=0.5;frames(1);
  ok(r.pinMag===0.97&&r.pinFwd,'...held forward it is kept, and the kick is not the pin shot from it');
  r.angle=0.97;keys.ControlRight=false;frames(1);
  ok(r.pinMag===null&&!r.pinOn&&r.fwdOut,'finesse let go: nothing kept, and a forward hold marks the guard');
  r.pinB=null;r.fwdOut=false;reset();

  // the slide settle
  r=rod({target:0});s=solo(r);keys.ControlRight=true;keys[RS]=true;
  put(r,-3,1.8);r.angle=A.up;frames(1);
  frames(12);
  ok(r.target>0.5&&r.target<=1.8,'posed up beside a ball, the slide still: the man is drawn onto its z ('+r.target.toFixed(2)+')');
  r.target=0;frames(12,()=>{r.target-=0.01;});
  ok(r.target<0,'a player sliding is never pulled');
  {const z0=T.z;T.z=2.5;r.target=0;frames(2);r.target=0;put(r,-3,3.0);frames(12);T.z=z0;
   ok(r.target===0,'a ball further than settle.z is left alone (settle.z under the back window\'s clearance)');}
  put(r,-3,1.8);r.angle=0;frames(12);
  ok(Math.abs(r.target)<1e-9,'the leg not up over it: no pull (the man would be put on a ball the leg cannot get over)');
  T.on=false;r.angle=A.up;frames(12);T.on=true;
  ok(Math.abs(r.target)<1e-9,'settle off: no pull');
  keys[RS]=false;keys.ControlRight=false;frames(1);reset();

  // the square: finesse alone, leg down
  r=rod({target:0});s=solo(r);keys.ControlRight=true;
  put(r,-2,6);frames(1);
  ok(r.sqA===-0.4,'finesse with a ball beside the man behind the rod: the foot is squared onto it ('+r.sqA+')');
  put(r,2,-6);frames(1);
  ok(r.sqA===0.3,'...ahead of it too');
  put(r,2,1);frames(1);
  ok(r.sqA===0.3,'a ball in his lane holds the leg where it was');
  frames(1);r.sqA=null;frames(1);
  ok(r.sqA===null,'...and a leg that was not squared stays down');
  put(r,2,Q.zMax+1);frames(1);
  ok(r.sqA===null,'a ball further than zMax: rest');
  put(r,Q.front+0.5,5);frames(1);
  ok(r.sqA===null,'...or outside the foot\'s depth');
  put(r,-2,6);r.padAngleOn=true;frames(1);
  ok(r.sqA===null,'the stick has the leg: no square');
  r.padAngleOn=false;keys[RS]=true;frames(1);
  ok(r.sqA===null&&r.pinPose,'a posed pin: no square');
  keys[RS]=false;keys.ControlRight=false;frames(1);
  ok(r.sqA===null,'finesse let go: rest');
  keys.ControlRight=true;Q.on=false;frames(1);Q.on=true;
  ok(r.sqA===null,'square off: rest');
  // the pose let go with finesse held: the leg relaxes to the square, held where it is over a ball in a man's lane
  keys[RS]=true;put(r,40,0);frames(2);
  r.angle=-1.1;put(r,-3,1);keys[RS]=false;frames(1);
  ok(!r.pinPose&&r.sqA===-1.1,'the raise let go over a ball in a man\'s lane: the leg is held where it was ('+r.sqA+')');
  put(r,-2,6);frames(1);
  ok(r.sqA===-0.4,'...and squared once the ball is beside him');
  keys.Space=true;C.shotKickEdge(r,C.shotKbmAxis(s));frames(1);
  r.angle=0.9;put(r,2,1);keys.Space=false;frames(1);
  ok(!r.pinPose&&r.sqA===0.9&&r.fwdOut,'the kick let go over a ball in a man\'s lane: held where it was, the guard on');
  r.fwdOut=false;keys.ControlRight=false;away();reset();
 }
 {
  const r=rod({pinMag:-0.7,sqA:0.2,stlT:1,stlW:3});
  C.shotReset(r);
  ok(r.pinMag===null&&r.sqA===null&&!r.stlT&&r.stlW===null,'shotReset clears the stick settle, the square and the slide settle');
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
mutate('shots',' else if(I.rz){r.pinPose=true;if(rzUp&&!r.pinB){r.pinFwd=false;r.fwdStk=0;}}',' else if(I.rz){r.pinPose=true;if(!r.pinB){r.pinFwd=false;r.fwdStk=0;}}','a held raise undoes the forward pose asked for after it');
mutate('shots',' else if(I.rz){r.pinPose=true;if(rzUp&&!r.pinB){r.pinFwd=false;r.fwdStk=0;}}',' else if(I.rz){r.pinPose=true;if(rzUp){r.pinFwd=false;r.fwdStk=0;}}','a raise press turns a held ball\'s forward pin into the back pin');
mutate('shots',' else if(I.rz){r.pinPose=true;if(rzUp&&!r.pinB){r.pinFwd=false;r.fwdStk=0;}}',' else if(I.rz){r.pinPose=true;}','a raise press never takes the pin back');
mutate('shots',' if(r.pinB&&r.kickT<0){if(!r.pinFwd)shotPinFire(r);return;}',' if(r.pinB&&r.kickT<0){shotPinFire(r);return;}','kick fires a shot from under the forward leg');
mutate('shots',' if(r.pinPose&&!r.pinB)r.pinA=r.pinFwd?(r.fwdStk>S.time?P.fwd.angle:shotFwdAngle(r))*r.kickDir:shotBackAngle(r);',' if(r.pinPose&&!r.pinB)r.pinA=shotBackAngle(r);','the forward pose targets the back pin angle');
mutate('shots',' if(!r.pinOn){if(r.pinFwd)r.fwdOut=true;r.pinPose=false;r.pinFwd=false;r.fwdStk=0;}',' if(!r.pinOn){r.pinPose=false;r.pinFwd=false;r.fwdStk=0;}','letting go of the forward pin sets no guard');
mutate('shots',' if(!r.pinOn){if(r.pinFwd)r.fwdOut=true;r.pinPose=false;r.pinFwd=false;r.fwdStk=0;}',' if(!r.pinOn){if(r.pinFwd)r.fwdOut=true;r.pinFwd=false;r.fwdStk=0;}','the pose outlives finesse');
mutate('shots',' if(!r.pinPose)r.pinFwd=r.pinOn&&(r.pinB?r.pinAt:(r.pinMag!=null?r.pinMag:0))*r.kickDir>0;',' ','a ball held forward off the stick reads as a back pin');
mutate('shots',' if(r.fwdOut&&r.angle*r.kickDir<=P.fwd.outA)r.fwdOut=false;',' ','the guard never lets go');
mutate('shots',' const fa=(h.dz<=(on?A.align:FE.alignZ)&&Math.abs(r.vz)<=(on?A.slideV:FE.slideV))?footAngle(on?shotFwdLead(r,h.b,h.rel):h.rel,true):null;',' const fa=null;','the leg never comes down onto the ball');
mutate('shots',' const fa=(h.dz<=(on?A.align:FE.alignZ)&&Math.abs(r.vz)<=(on?A.slideV:FE.slideV))?footAngle(on?shotFwdLead(r,h.b,h.rel):h.rel,true):null;',' const fa=footAngle(h.rel,true);','the leg is lowered beside the ball, not only over it');
mutate('shots',' const fa=(h.dz<=(on?A.align:FE.alignZ)&&Math.abs(r.vz)<=(on?A.slideV:FE.slideV))?footAngle(on?shotFwdLead(r,h.b,h.rel):h.rel,true):null;',' const fa=(h.dz<=(on?A.align:FE.alignZ))?footAngle(h.rel,true):null;','the leg is lowered while the rod is still sliding fast');
mutate('shots','footAngle(on?shotFwdLead(r,h.b,h.rel):h.rel,true)','footAngle(h.rel,true)','a rolling ball is aimed where it is, not where the leg will catch it');
mutate('shots',' if(on&&A.hop&&A.hop.on){const a=r.angle*r.kickDir;if(to>a&&shotFwdSweep(r,a,to)){r.fwdBlk=!!h;return a;}}',' ','the leg swings up through a ball in its path');
mutate('shots',' if(on&&A.hop&&A.hop.on){',' if(on&&A.hop){','hop.on false is ignored');
mutate('shots','r.fwdBlk=!!h;return a;','return a;','the held leg never asks the man to step off');
mutate('shots','function shotFwdSweep(r,a0,a1){','function shotFwdSweep(r,a0,a1){return false;','the sweep never sees the ball');
mutate('shots','&&S.time-(r.fwdKT||0)>=A.hop.tap){','){','the man steps off inside the tap window');
mutate('shots','  o=clearOffset(r,h.b.m.position.z,FOOT_BOX.z+BALL_R+AIC.clearMargin+FE.clearPad,0);','  o=clearOffset(r,h.b.m.position.z,FOOT_BOX.z+BALL_R+AIC.clearMargin+FE.clearPad+3,0);','the step off goes further than the clearance');
mutate('shots','   else if(H&&H.on&&S.time-(r.fwdKT||0)<H.tap&&(shotFwdAngle(r),r.fwdBlk)){r.fwdStk=S.time+H.stroke;r.fwdBlk=false;}','   else if(false){}','a tap does not stroke');
mutate('shots','&&(shotFwdAngle(r),r.fwdBlk)){r.fwdStk','){r.fwdStk','any tap strokes, a ball in the way or not');
mutate('shots','&&S.time-(r.fwdKT||0)<H.tap&&','&&','a held kick strokes when it is let go');
mutate('shots','(r.fwdStk>S.time?P.fwd.angle:shotFwdAngle(r))','shotFwdAngle(r)','the stroke is held by the guard like the pin');
mutate('shots',' const stk=r.fwdStk>S.time&&r.pinPose&&r.pinFwd&&!r.pinB;',' const stk=false;','the stroke ends with the tap window');
mutate('shots',' r.pinPose=true;r.pinFwd=true;r.pinKh=true;r.fwdKT=S.time;r.fwdStk=0;',' r.pinPose=true;r.pinFwd=true;r.pinKh=true;r.fwdStk=0;','the press time is never stamped');
mutate('shots',' if(r.fwdU)return r.angle*r.kickDir>P.fwd.angle+0.1?up:null;',' if(r.fwdU)return up;','an off-line ball rolling in raises the leg (it rolls under, unpinned)');
mutate('shots',' if(r.fwdU)return r.angle*r.kickDir>P.fwd.angle+0.1?up:null;',' if(r.fwdU)return null;','a raised leg drops onto an off-line ball');
mutate('shots',' const rel=shotFwdLead(r,_fwu.b,_fwu.rel);',' const rel=_fwu.rel;','a ball rolling in is aimed where it is');
mutate('shots',' _fwu.b=null;\n if(!U||!U.on)return null;',' _fwu.b=null;\n if(!U)return null;','under.on false is ignored');
mutate('shots',' }else if(!h&&fwd&&r.fwdU&&_fwu.b){o=clamp(_fwu.z-r.baseZ[_fwu.i],-r.maxOff,r.maxOff);v=T.v;}',' }else if(false){}','a ball rolling in off his line never draws the man');
mutate('shots','  v=(fwd&&hop&&Math.abs(o-r.offset)>A.align+1)?Math.max(T.v,A.hop.v):T.v;','  v=T.v;','the way back over is at the settle speed all the way');
mutate('shots','  v=(fwd&&hop&&Math.abs(o-r.offset)>A.align+1)?Math.max(T.v,A.hop.v):T.v;','  v=Math.max(T.v,A.hop.v);','the man arrives over the ball at the hop speed');
mutate('shots','function shotFwdZ(){const T=SHOTC.pin.assist.settle;return T&&T.on?T.z:0;}','function shotFwdZ(){return 0;}','the forward assist looks only as far as the clearance');
mutate('shots',' r.fwdKT=0;r.fwdStk=0;r.fwdBlk=false;r.fwdU=false;',' ','a reset leaves the hop and stroke stamps on the rod');
mutate('shots',' if(fin&&P.fwd.on&&r.kickT>=0&&r.heldFwd&&r.kickHold&&I.kh&&r.chg<0&&!r.pinB&&I.m<=SHOTC.pass.modAt){',' if(false){','finesse on a kick-held leg does nothing (the swing keeps it)');
mutate('shots','r.kickT>=0&&r.heldFwd&&r.kickHold&&I.kh','r.kickT>=0&&r.kickHold&&I.kh','finesse cuts a swing short before it is held forward');
mutate('shots','r.kickT>=0&&r.heldFwd&&r.kickHold&&I.kh','r.kickT>=0&&r.heldFwd&&I.kh','a swing frozen over a ball is taken for the player\'s hold');
mutate('shots','&&!r.pinB&&I.m<=SHOTC.pass.modAt){','&&!r.pinB){','power cancelling finesse still takes the held leg');
mutate('shots','  r.pinPose=true;r.pinFwd=true;r.pinKh=true;r.fwdKT=-1e9;r.fwdStk=0;','  r.pinPose=true;r.pinFwd=true;r.fwdKT=-1e9;r.fwdStk=0;','the handed-over pose forgets the kick is held');
mutate('shots','rel+b.v.x*r.kickDir/SHOTC.pin.lower','rel-Math.max(0,-b.v.x*r.kickDir)/SHOTC.pin.lower','a ball rolling away is aimed where it is');
mutate('shots',' const o1=clamp(r.offset+r.vz*P.fwd.lead,-r.maxOff,r.maxOff);',' const o1=r.offset;','the leg only counts where the men are now');
mutate('shots',' if(rel<rel0||rel>rel1||p.y>BALL_R+P.yTol||Math.min(b.v.length(),Math.hypot(b.v.x,b.v.z-r.vz))>vmax)continue;',' if(rel<rel0||rel>rel1||p.y>BALL_R+P.yTol)continue;','a rolling ball is treated as lying there');
mutate('shots',' if(rel<rel0||rel>rel1||p.y>BALL_R+P.yTol||Math.min(b.v.length(),Math.hypot(b.v.x,b.v.z-r.vz))>vmax)continue;',' if(rel<rel0||rel>rel1||p.y>BALL_R+P.yTol||b.v.length()>vmax)continue;','a ball carried along by the leg is not under it');
mutate('shots','function shotFwdHold(r){const W=SHOTC.pin.fwd;return shotFwdBall(r,W.holdNear,W.holdFar,W.holdV)!==null;}','function shotFwdHold(r){const W=SHOTC.pin.fwd;return shotFwdBall(r,W.holdNear,SHOTC.pin.fwdFront+1,W.holdV)!==null;}','the hold stops short of the toe');
mutate('shots',' if(!W.assist||typeof footAngle!==\'function\')return W.angle;',' if(typeof footAngle!==\'function\')return W.angle;','assist off is ignored');
mutate('shots','if(shotPinBall(S.seats[i])&&!seatRod(S.seats[i]).pinFwd)return S.seats[i];','if(shotPinBall(S.seats[i]))return S.seats[i];','the kick plate says pin shot over a forward-held ball');
mutate('shots',' r.pinOn=false;r.pinPose=false;r.pinA=null;r.pinFwd=false;r.fwdOut=false;r.rzWas=false;r.pinKh=false;r.pinMag=null;r.sqA=null;r.stlT=0;r.stlW=null;',' r.pinOn=false;r.pinPose=false;r.pinA=null;r.pinFwd=false;r.pinKh=false;r.pinMag=null;r.sqA=null;r.stlT=0;r.stlW=null;','a reset leaves the forward guard on the rod');
mutate('shots',' r.pinOn=false;r.pinPose=false;r.pinA=null;r.pinFwd=false;r.fwdOut=false;r.rzWas=false;r.pinKh=false;r.pinMag=null;r.sqA=null;r.stlT=0;r.stlW=null;',' r.pinOn=false;r.pinPose=false;r.pinA=null;r.pinFwd=false;r.fwdOut=false;r.rzWas=false;r.pinKh=false;','a reset leaves the stick settle and the square on the rod');
mutate('shots',' r.pinOn=false;r.pinPose=false;r.pinA=null;r.pinFwd=false;r.fwdOut=false;r.rzWas=false;r.pinKh=false;r.pinMag=null;r.sqA=null;r.stlT=0;r.stlW=null;',' r.pinOn=false;r.pinPose=false;r.pinA=null;r.pinFwd=false;r.fwdOut=false;r.rzWas=false;r.pinMag=null;r.sqA=null;r.stlT=0;r.stlW=null;','a reset leaves the held kick on the rod');
mutate('shots'," if(h.fa!=null&&h.over)return h.fa*r.kickDir;"," ","the back leg is never lowered onto the ball");
mutate('shots'," if(h.fa!=null&&h.over)return h.fa*r.kickDir;"," if(h.fa!=null)return h.fa*r.kickDir;","the back leg is lowered through a ball it is not over");
mutate('shots'," return shotPullCap(r,r.angle,A.up*r.kickDir);"," return shotPullCap(r,r.angle,P.angle*r.kickDir);","beside a ball the back leg stays at the pose angle, not up over it");
mutate('shots'," const P=SHOTC.pin,A=P.assist,h=(A&&A.on)?shotPinAim(r,-1):null;"," const P=SHOTC.pin,A=P.assist,h=shotPinAim(r,-1);","assist off is ignored on the back pin");
mutate('shots'," h.fa=(h.fa0!=null&&h.dz<=A.align&&Math.abs(r.vz)<=A.slideV)?h.fa0:null;"," h.fa=(h.fa0!=null&&h.dz<=A.align)?h.fa0:null;","the leg is lowered while the rod slides fast");
mutate('shots'," h.fa=(h.fa0!=null&&h.dz<=A.align&&Math.abs(r.vz)<=A.slideV)?h.fa0:null;"," h.fa=h.fa0;","the leg is lowered beside the ball, not over it");
mutate('shots'," h.over=h.fa0!=null&&(r.angle*r.kickDir-h.fa0)*g>=-A.overTol;"," h.over=h.fa0!=null;","a leg below the ball's top counts as over it");
mutate('shots'," const h=g<0?shotFwdBall(r,P.back,A.near,A.v):shotFwdBall(r,FE.near,FE.far,FE.bailV,shotFwdZ());"," const h=g<0?shotFwdBall(r,P.back,A.near,99):shotFwdBall(r,FE.near,FE.far,FE.bailV,shotFwdZ());","a rolling ball is treated as lying behind");
mutate('shots'," const h=g<0?shotFwdBall(r,P.back,A.near,A.v):shotFwdBall(r,FE.near,FE.far,FE.bailV,shotFwdZ());"," const h=g<0?shotFwdBall(r,P.back-3,0,A.v):shotFwdBall(r,FE.near,FE.far,FE.bailV,shotFwdZ());","the back window is ignored");
mutate('shots'," r.pinMag=(r.pinOn&&!r.pinPose)?shotStickPin(r):null;"," r.pinMag=null;","the stick never settles a pin");
mutate('shots'," r.pinMag=(r.pinOn&&!r.pinPose)?shotStickPin(r):null;"," r.pinMag=shotStickPin(r);","the stick settle outlives finesse");
mutate('shots'," return (h&&h.fa!=null&&h.over&&(s-h.fa)*g>=-K.win)?h.fa*r.kickDir:null;"," return (h&&h.fa!=null&&h.over)?h.fa*r.kickDir:null;","a stick pushed well past the catch is still held at it");
mutate('shots'," return (h&&h.fa!=null&&h.over&&(s-h.fa)*g>=-K.win)?h.fa*r.kickDir:null;"," return (h&&h.fa!=null&&(s-h.fa)*g>=-K.win)?h.fa*r.kickDir:null;","the stick pulls a low leg down through the ball");
mutate('shots'," if(r.pinB){const g=r.pinAt*r.kickDir>0?1:-1;return (!r.padAngleOn||r.padAngleTarget*r.kickDir*g>=-K.keep)?r.pinAt:null;}"," if(r.pinB)return null;","a pinned ball is not kept against the stick");
mutate('shots'," if(r.pinB){const g=r.pinAt*r.kickDir>0?1:-1;return (!r.padAngleOn||r.padAngleTarget*r.kickDir*g>=-K.keep)?r.pinAt:null;}"," if(r.pinB)return r.pinAt;","the stick can never let a pinned ball go");
mutate('shots'," if(!A||!A.on||!K||!K.on)return null;"," if(!A||!A.on)return null;","stick.on false is ignored");
mutate('shots'," r.target+=clamp(o-r.target,-v*dt,v*dt);"," ","the man is never drawn onto the ball");
mutate('shots'," r.stlT=(r.stlW!=null&&Math.abs(r.target-r.stlW)<1e-6)?(r.stlT||0)+dt:0;"," r.stlT=(r.stlT||0)+dt;","the settle pulls a man the player is sliding");
mutate('shots'," if(h&&h.over){"," if(h){","the settle puts a man on a ball his leg is not over");
mutate('shots',"  if(h.dz>T.z)return;","  ","the settle reaches past settle.z");
mutate('shots'," if(!A||!A.on||!T||!T.on||!r.pinOn||r.pinB){r.stlT=0;r.stlW=null;return;}"," if(!A||!A.on||!r.pinOn||r.pinB){r.stlT=0;r.stlW=null;return;}","settle.on false is ignored");
mutate('shots'," r.sqA=(r.pinOn&&!r.pinPose&&r.pinMag==null&&!r.pinB&&!r.padAngleOn)?shotSquare(r):null;"," r.sqA=null;","finesse never squares the foot");
mutate('shots'," r.sqA=(r.pinOn&&!r.pinPose&&r.pinMag==null&&!r.pinB&&!r.padAngleOn)?shotSquare(r):null;"," r.sqA=(r.pinOn&&!r.pinPose&&r.pinMag==null&&!r.pinB)?shotSquare(r):null;","the square fights the stick");
mutate('shots'," r.sqA=(r.pinOn&&!r.pinPose&&r.pinMag==null&&!r.pinB&&!r.padAngleOn)?shotSquare(r):null;"," r.sqA=(r.pinOn&&r.pinMag==null&&!r.pinB&&!r.padAngleOn)?shotSquare(r):null;","the square fights the pin pose");
mutate('shots',"   if(dz<lane)return keep;","   if(dz<lane)continue;","a ball in a man's lane is swept by the square");
mutate('shots',"   if(rel>=Q.back&&rel<=Q.front&&dz<=best){best=dz;rel0=rel;}","   if(dz<=best){best=dz;rel0=rel;}","the square reaches a ball the foot cannot");
mutate('shots'," let best=Q.zMax,rel0=null;"," let best=1e9,rel0=null;","the square turns for a ball anywhere along the row");
mutate('shots'," if(!Q||!Q.on||typeof hitAngle!=='function')return null;"," if(typeof hitAngle!=='function')return null;","square.on false is ignored");
mutate('shots',' if(shotPinFwdPress(r,m))return;',' ','finesse + kick is the swing again');
mutate('shots',' if(r.pinOn&&r.pinPose&&!r.pinB&&!P.latch&&!stk){',' if(false){','the pose is latched again (the old rule)');
mutate('shots',' if(r.pinOn&&r.pinPose&&!r.pinB&&!P.latch&&!stk){',' if(r.pinOn&&r.pinPose&&!P.latch&&!stk){','letting the raise go drops a pinned ball\'s pose');
mutate('shots',' if(r.pinOn&&r.pinPose&&!r.pinB&&!P.latch&&!stk){',' if(r.pinOn&&r.pinPose&&!r.pinB&&!stk){','pin.latch true is ignored');
mutate('shots','   if(I.rz)r.pinFwd=false;\n   else if(H','   if(false){}\n   else if(H','the kick let go drops the pose with the raise still held');
mutate('shots','  else if(!r.pinFwd&&!I.rz){if(r.pinKh)r.pinFwd=true;else{','  else if(!r.pinFwd&&!I.rz){{','the raise let go drops the pose with the kick still held');
mutate('shots','   else{r.fwdOut=true;r.pinPose=false;r.pinFwd=false;r.sqA=r.angle;}','   else{r.pinPose=false;r.pinFwd=false;r.sqA=r.angle;}','the forward pose let go sets no guard');
mutate('shots','   else{r.fwdOut=true;r.pinPose=false;r.pinFwd=false;r.sqA=r.angle;}','   else{r.fwdOut=true;r.pinPose=false;r.pinFwd=false;}','the forward pose let go drops the leg through a ball in a man\'s lane');
mutate('shots','if(r.pinKh)r.pinFwd=true;else{r.pinPose=false;r.sqA=r.angle;}}','if(r.pinKh)r.pinFwd=true;else{r.pinPose=false;}}','the back pose let go drops the leg through a ball in a man\'s lane');
mutate('shots',' if(!I.kh)r.pinKh=false;',' ','the forward pose outlives the kick');
mutate('shots',' r.pinPose=true;r.pinFwd=true;r.pinKh=true;',' r.pinPose=true;r.pinFwd=true;','the forward pose ends the frame it is asked for');
mutate('shots','  I.kh=kh||(pl&&P.kh);','  I.kh=pl&&P.kh;','a held kick key does not hold the forward pose');
mutate('shots',' o.kh=gpDown(gp,0);',' o.kh=false;','a held A does not hold the forward pose');
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
