'use strict';
/* ===== binds harness — node tools/binds-harness.js =====
   Boots core + config + rng + js/shots.js + js/binds.js in ONE vm context against the same stubs
   shots-harness uses (kickRod, gpDown, sweepClips, a recording Au), plus a keys map and a seat
   table, and drives the KEYBOARD/MOUSE half of the shot system through the REAL merged step
   (shotSeatsUpdate) rather than a restatement of it.

   What it pins, in the order it matters:
     · the binding DATA — every action listed and defaulted, no default clash inside a group, no
       reserved key bound, every default label drawable as a HUD keycap;
     · REBINDING — taking a key off the action that had it, only within its own group, refusing a
       reserved key, a list edited back to default following CONFIG again;
     · DEVICE OWNERSHIP — in co-op a mouse button drives the mouse player's rod, never the
       keyboard player's;
     · THE MERGE — the whole reason shotSeatsUpdate exists: an IDLE pad beside the keyboard must
       not release the keyboard's wind-up, and another source going down mid-wind-up must not
       steal it;
     · the keyboard verbs themselves — charge + release, a tap, kick as a second release, the
       pass axis, the eased grip, the hand-off, and the off switch.
   MUTATIONS at the bottom each rewrite one of those decisions and the suite must fail for every
   one; mutate() refuses a mutant identical to its source so a drifted anchor reports itself. */

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
  'shotSeatsUpdate,shotKickEdge,shotKbmAxis,shotCharge,bindList,bindDev,bindIs,bindActs,bindHeld,bindLabel,'+
  'bindCap,bindHint,bindAdd,bindRemove,bindReset,bindSet,bindReserved};',ctx,{filename:'export.js'});
 ctx.__c.rngSeed(777);
 return ctx;
}
function rod(over){
 const r={idx:0,x:22.5,team:0,role:'ATT',kickDir:1,angle:0,offset:0,maxOff:12,baseZ:[0],men:[{}],
  removedUntil:[],kickT:-1,kickStyle:null,kickCurve:null,passTo:null,kickHold:false,
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

 /* ===== 4. THE WIND-UP: POWER + A PULL-BACK, FIRED ONLY BY A KICK (charge.needRaise) =====
    Power alone is not a charge, and letting go is not a shot — a one-key charge that fired on
    release was an advantage the keyboard had over a pad. Every device obeys the same three-part rule. */
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
  C.shotKickEdge(r,C.shotKbmAxis(s));
  const soft=C.shotBlend(-1);
  ok(rec.kicks.length===1&&rec.kicks[0].curve&&Math.abs(rec.kicks[0].curve.strike-soft.strike)<1e-9,'finesse + kick with no lane is the soft touch');
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
mutate('shots','I.key=(pw&&(!SHOTC.charge.needRaise||bindHeld(\'raise\',s)))?1:0;','I.key=0;','the merge drops the keyboard\'s power source');
mutate('shots','I.key=(pw&&(!SHOTC.charge.needRaise||bindHeld(\'raise\',s)))?1:0;','I.key=pw?1:0;','POWER alone winds up on the keyboard');
mutate('shots','   else if(gpDown(gp,2))o.rt=rt;','   else o.rt=rt;','RT alone winds up on the pad');
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
let caught=0;
console.log('\n--- mutations (each must BREAK the suite) ---');
for(const m of muts){
 const src=m.file==='shots'?SH:BI;
 if(src.indexOf(m.find)<0){console.log('  BROKEN  '+m.name+' — anchor not found');continue;}
 const mut=src.replace(m.find,m.repl);
 if(mut===src){console.log('  BROKEN  '+m.name+' — mutant identical');continue;}
 let r;try{r=m.file==='shots'?run(mut,BI):run(SH,mut);}catch(e){r={fail:1,err:e.message};}
 if(r.fail>0){caught++;console.log('  caught  ('+(r.err?'threw':r.fail+' assertions')+')  '+m.name);}
 else console.log('  MISSED  '+m.name);
}
console.log('\nmutations caught: '+caught+'/'+muts.length);
process.exitCode=(base.fail||caught<muts.length)?1:0;
