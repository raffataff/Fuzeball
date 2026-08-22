'use strict';
/* ===== shots harness — node tools/shots-harness.js =====
   Boots core + config + rng and then js/shots.js in ONE vm context against stubs for the four
   things it reaches out to (kickRod, gpDown, sweepClips, passPick) plus a recording Au. No three.js,
   no DOM, no browser.

   IT ASSERTS THE DATA AS WELL AS THE CODE, which is the half worth copying. A charge whose bronze
   is unreachable, an anchor curve naming a key CONFIG.kick does not have, a pass threshold no
   trigger position can reach, a wind-up deeper than the rod's own raise — every one of those fails
   as "the control feels wrong" rather than as an error, so they are checked from LIVE CONFIG here.

   It also has teeth: MUTATIONS at the bottom rewrite one decision each in the real source and the
   suite must FAIL for every one of them. mutate() refuses a mutant identical to its source, so a
   drifted anchor reports itself instead of quietly scoring a point (the roomlights lesson). */

const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8').replace(/\r\n/g,'\n');

let pass=0,fail=0;const fails=[];
function ok(c,msg){if(c)pass++;else{fail++;fails.push(msg);}}
function eq(a,b,msg,eps){const e=eps==null?1e-9:eps;ok(typeof a==='number'&&Math.abs(a-b)<=e,msg+' (got '+a+', want '+b+')');}

/* ---- the sandbox ------------------------------------------------------------------------- */
function build(srcShots){
 const rec={kicks:[],tick:0,mark:[],fire:[],fed:-1,draws:0};
 const ctx={console,Math,Date,JSON,Object,Array,String,Number,Boolean,Map,Set,isNaN,isFinite,
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  // --- the four things shots.js talks to, all recording ---
  kickRod(r,style,aimAt,curve){
   if(r.kickT>=0)return;
   r.kickT=0;r.kickStyle=style||null;r.kickCurve=curve||null;r.passTo=aimAt||null;
   r.kickA0=r.angle/(r.kickDir||1);
   r.chg=-1;r.chgSrc=null;r.chgA=null;r.trem=0;
   rec.kicks.push({style:r.kickStyle,curve:r.kickCurve,pass:r.passTo,pow:r.shotPow,ctl:r.shotCtl,on:r.shotOn,a0:r.kickA0});
  },
  gpDown(gp,i){const b=gp.buttons[i];return!!b&&(b.pressed||b.value>0.5);},
  sweepClips(){return ctx.__clip;},          // flipped per test
  // shotPassPick walks the real rods with ai.js's lane primitives, so the harness supplies those
  // plus a tiny rod table. __pass forces a receiver where a test only cares that a pass HAPPENED.
  passPick(){return ctx.__pass;},
  laneObs(){return ctx.__obs||[];},
  lineClr(){return ctx.__clr==null?9:ctx.__clr;},
  manLive(){return true;},
  rods:[],
  // The charge voice is FED per frame (audio.js owns a held voice that fades itself), so what the
  // suite counts is feeds, not one-shots. chargeFire is the release discharge and carries the band.
  Au:{chargeFeed(k,b){rec.tick++;rec.fed=k;},chargeMark(g){rec.mark.push(!!g);},
      chargeFire(k,sweet){rec.fire.push({k:k,sweet:!!sweet});},ui(){},beep(){}},
  // A live ball is NOT optional furniture here: shotPullCap and shotPassTarget both iterate
  // S.balls, so an empty table makes the wind-up guard and the pass silently no-op and the suite
  // scores them as passes. The first cut of this harness did exactly that.
  S:{balls:[{m:{position:{x:24,y:1.9,z:0}},v:{x:0,y:0,z:0},scored:false}],time:0},
  __clip:false,__pass:null,__rec:rec};
 ctx.globalThis=ctx;ctx.window=ctx;
 vm.createContext(ctx);
 vm.runInContext(read('js/core.js'),ctx,{filename:'core.js'});
 vm.runInContext(read('js/config.js'),ctx,{filename:'config.js'});
 vm.runInContext(read('js/rng.js'),ctx,{filename:'rng.js'});
 vm.runInContext(srcShots,ctx,{filename:'shots.js'});
 // Top-level const/let are LEXICAL, not context properties — ctx.SHOT reads back undefined and
 // every threshold silently becomes NaN, which looks exactly like passing tests. Hand them out.
 vm.runInContext('globalThis.__c={SHOT,KICK,AIC,cfg,PHY,RNG,rngSeed,'+
  'shotsOn,shotTrigD,shotAxis,shotPadAxis,shotChord,shotAxisPow,shotAxisCtl,shotAxisTrack,shotAxisExert,'+
  'shotBlend,SHOT_CURVE_KEYS,shotChgPow,shotChgCtl,shotChgBand,shotOver,shotArm,shotDisarm,shotConsume,'+
  'shotReset,shotPullCap,shotPullAngle,shotTrackMult,shotPassTarget,shotFire,shotSpray,shotPadUpdate,'+
  'shotKickPress,shotCharge,shotChargeBand};',ctx,{filename:'export.js'});
 ctx.__c.rngSeed(12345);
 return ctx;
}

// A rod with every field shots.js touches, in the state buildRods leaves it.
function rod(over){
 const r={idx:0,x:22.5,team:0,role:'ATT',kickDir:1,angle:0,offset:0,maxOff:12,baseZ:[0],men:[{}],
  removedUntil:[],kickT:-1,kickStyle:null,kickCurve:null,passTo:null,passEv:null,passEvT:0,
  raise:false,padAngleOn:false,padAngleTarget:0,kickA0:0,
  chg:-1,chgRel:0,chgMod:null,chgA:null,chgSrc:null,chgHeld:0,chgSweet:false,trem:0,
  shotOn:false,shotPow:1,shotCtl:1,shotTrack:1,shotExert:1};
 return Object.assign(r,over||{});
}
// A gamepad whose two triggers sit at given depths. lt/rt are RAW travel (0..1).
function pad(lt,rt,a){
 const b=[];for(let i=0;i<17;i++)b.push({pressed:false,value:0});
 b[6]={pressed:lt>0.1,value:lt};b[7]={pressed:rt>0.1,value:rt};
 if(a)for(const i of a)b[i]={pressed:true,value:1};
 return {buttons:b,axes:[0,0,0,0]};
}
const seat=()=>({team:0,devs:['pad*'],rods:[],ctrl:0,tcMult:1,padRaise:false,shotRod:null,padPrev:{}});

/* ---- the suite ---------------------------------------------------------------------------- */
function run(src,label){
 pass=0;fail=0;fails.length=0;
 const ctx=build(src),C=ctx.__c,SH=C.SHOT,CH=SH.charge,MD=SH.mod,K=C.KICK;
 const rec=ctx.__rec;

 /* ===== 1. THE DATA — an unplayable control scheme fails HERE, not in play ===== */
 ok(SH.on===true||SH.on===false,'shots.on is a boolean');
 for(const anc of ['soft','hard']){
  const A=MD[anc];
  // The EFFECTIVE curve, not the raw anchor — an anchor names only the keys it overrides, so
  // reading A.windup straight off it is undefined and every comparison against it is silently false.
  const E=C.shotBlend(anc==='soft'?-1:1);
  for(const k of Object.keys(A))ok(K[k]!==undefined,'mod.'+anc+' key "'+k+'" exists in CONFIG.kick');
  ok(E.strike>E.windup,'mod.'+anc+': strike after windup');
  ok(E.hold>=E.strike,'mod.'+anc+': hold at or after strike');
  ok(E.drop>E.hold,'mod.'+anc+': drop after hold');
  /* THE ANCHORS MUST NOT TOUCH RESTITUTION OR THE POWER WINDOW, and this is the load-bearing
     assertion of the whole block. The power is the ARC: kickA0 -> strikeA over a fixed strike
     window, so a deeper wind-up in a shorter window is a genuinely faster foot. Opening the power
     window as well would swap rest 0.01 for restPower — another ~1.9x on the impulse — and the axis
     and charge multipliers would be a third helping of the same thing. Three channels stacked is
     how a charged shot ends up ten times a normal one and every number becomes untunable. */
  for(const k of ['rest','restPower','powFrom','powTo']){
   ok(A[k]===undefined,'mod.'+anc+' leaves "'+k+'" alone — the arc is the power, not the restitution');
   eq(E[k],K[k],'mod.'+anc+' blended: '+k+' still comes from CONFIG.kick');
  }
 }
 ok(MD.soft.strikeA<K.strikeA,'soft anchor swings shallower than a normal kick');
 ok(MD.hard.strikeA>K.strikeA,'hard anchor swings deeper than a normal kick');
 // RATE, not just angle — the thing that actually sets the hit. (strikeA-0)/(strike-windup).
 const rate=a=>a.strikeA/(a.strike-a.windup);
 ok(rate(C.shotBlend(-1))<rate(K),'soft anchor is a SLOWER swing than normal');
 ok(rate(C.shotBlend(1))>rate(K),'hard anchor is a FASTER swing than normal');
 ok(rate(C.shotBlend(1))/rate(K)<3,'…but not so fast the substep budget cannot follow it');
 ok(MD.dead>0&&MD.dead<0.5,'trigger deadzone is sane');
 ok(MD.softPow<1&&MD.hardPow>1,'axis power straddles 1');
 ok(MD.softCtl<=1&&MD.hardCtl<MD.softCtl,'power costs control');
 ok(MD.softTrack<1&&MD.hardTrack>1,'axis stick-tracking straddles 1');
 ok(MD.directLerp>0,'directLerp is a usable rate for padAngleLerp 0');
 ok(MD.hardExert>=1,'a power swing never costs LESS stamina than a normal one');
 // The pass threshold has to be REACHABLE by a real trigger position and must not fire on a
 // neutral kick — LT alone bottoms the axis at exactly -1, so modAt must lie in [-1, 0).
 ok(SH.pass.modAt>=-1&&SH.pass.modAt<0,'pass threshold is reachable and never neutral');
 /* THE PASS HAS TO BE DELIVERABLE. The aim assist can bend a pass by CONFIG.ai.dribble.pass.assist
    and no further, so a chooser that picks the best receiver on the table rather than a reachable
    one hands the player a PASS label on a ball that sails past everybody — measured live at 43
    degrees needed against 9 delivered. bendMult is that budget as a multiple of the assist. */
 ok(SH.pass.bendMult>0&&SH.pass.bendMult<3,'pass bend budget is a lining-up requirement, not a guided missile');
 {const P=C.AIC.dribble.pass,deg=P.assist*SH.pass.bendMult*180/Math.PI;
  ok(deg>5&&deg<25,'…which is '+deg.toFixed(0)+' degrees off-line — enough to offer, tight enough to aim');
  const lat=Math.tan(P.assist*SH.pass.bendMult)*30;
  ok(lat>3&&lat<12,'…about '+lat.toFixed(1)+' units of lateral slack over a 30-unit MID to ATT ball');}
 ok(CH.sweetFrom>0&&CH.sweetFrom<CH.sweetTo&&CH.sweetTo<=1,'sweet band is ordered and inside 0..1');
 ok(CH.minFire<CH.sweetFrom,'a charge can reach the sweet band before minFire would fire it early');
 ok(CH.powMin<=CH.powMax&&CH.overPow<CH.powMax,'charge power rises then falls');
 ok(CH.ctlMin<1&&CH.overCtl<1,'control peaks inside the band');
 ok(CH.rate>0&&CH.decay>0,'charge builds and bleeds');
 // Time to reach the band at full depth has to be a HUMAN interval — instant is not a mechanic and
 // two seconds is not a shot.
 const tIn=CH.sweetFrom/CH.rate,tOut=CH.sweetTo/CH.rate;
 ok(tIn>0.15&&tIn<1.2,'sweet band opens at a human time ('+tIn.toFixed(2)+'s)');
 ok(tOut-tIn>0.12,'sweet band is wide enough to hit ('+(tOut-tIn).toFixed(2)+'s)');
 /* THE EASE HAS TO SETTLE BEFORE THE BAND OPENS. updateRods eases the rod toward the wind-up angle
    rather than snapping to it, so the arc actually delivered is a function of HOW LONG you have
    held as well as of the charge — and if it is still settling inside the band, a full overcook
    ends up the strongest shot on the table however the trims are tuned. Settling is
    e^(-pullLerp x t), so 95% by the time the band opens wants pullLerp >= 3/(sweetFrom/rate). */
 {const T=CH.sweetFrom/CH.rate,settled=1-Math.exp(-CH.pullLerp*T);
  ok(settled>0.95,'the wind-up is '+(settled*100).toFixed(1)+'% settled by the time the sweet band opens');}
 ok(CH.pullA<0,'the wind-up is a BACK angle');
 ok(Math.abs(CH.pullA)<=Math.abs(K.raiseA),'the wind-up is never deeper than the rod raise');
 ok(CH.stickBack>0&&CH.stickBack<1,'Total Control pull-back threshold is inside stick travel');
 ok(CH.spray>=0&&CH.spray<0.6,'spray is a nudge, not a coin toss');
 ok(CH.trem.amp>0&&CH.trem.amp<0.2,'tremble is visible but not a swing');
 ok(CH.tapMax>0&&CH.tapMax<0.3,'tap grace is a tap');
 /* THE SOUND CARRIES A DIRECTION, and it is the whole reason the build-up and the release do not
    sound like the same event twice. Tension SWEEPS UP as it gathers; a discharge SWEEPS DOWN as it
    lets go. Invert either and the charge reads as a release and the release reads as a wind-up. */
 {const T=CH.tone;
  ok(T.f1>T.f0,'the build-up tone sweeps UP with the charge');
  ok(T.nf1>T.nf0,'…and its air bed opens as it gathers');
  ok(T.bodyF1<T.bodyF0,'the release body sweeps DOWN — a discharge, not another wind-up');
  ok(T.airF1<T.airF0,'…and so does its air');
  ok(T.snapF>T.airF0,'the sweet-band snap sits above the discharge, so it reads as a separate ping');
  ok(T.markA>=0.02,'the band marker has a soft attack — a fast one is the blip this pass removed');
  ok(T.attack<T.release,'the voice appears faster than it fades, so a wind-up is prompt and its tail is not');
  ok(T.release<0.2,'…but the tail is short enough to be under the strike, not smeared past it');
  ok(T.fireMin>0&&T.fireMin<CH.sweetFrom,'a flinch makes no discharge, a real charge always does');
  ok(T.wobDepth>0&&T.wobDepth<1,'the overcook wobble is unsteadiness, not a gate');
  for(const k of ['vol','fifthVol','noiseVol','markVol','bodyVol','airVol','snapVol'])
   ok(T[k]>0&&T[k]<0.4,'tone.'+k+' is a mix level, not a peak');}

 /* ===== 2. THE AXIS ===== */
 eq(C.shotAxis(0,0),0,'axis: nothing held is neutral');
 eq(C.shotAxis(1,0),-1,'axis: LT alone is full finesse');
 eq(C.shotAxis(0,1),1,'axis: RT alone is full power');
 eq(C.shotAxis(1,1),0,'axis: BOTH held cancels to neutral');
 eq(C.shotAxis(0.5,1),0.5,'axis: partial LT eats half the power');
 eq(C.shotTrigD(pad(0,0),6),0,'trigger: rest reads 0');
 eq(C.shotTrigD(pad(MD.dead,0),6),0,'trigger: exactly at the deadzone reads 0');
 eq(C.shotTrigD(pad(1,0),6),1,'trigger: full travel reads 1');
 ok(C.shotTrigD(pad(MD.dead+(1-MD.dead)/2,0),6)>0.49&&C.shotTrigD(pad(MD.dead+(1-MD.dead)/2,0),6)<0.51,
  'trigger: travel past the deadzone is RESCALED to 0..1, not offset');
 ok(C.shotChord(1,1)&&!C.shotChord(1,0)&&!C.shotChord(0,1),'chord needs both triggers');
 ok(!C.shotChord(MD.dead,MD.dead),'chord ignores a resting trigger at the deadzone');
 eq(C.shotPadAxis(pad(0,1)),1,'shotPadAxis reads a pad');

 /* ===== 3. THE CURVE BLEND ===== */
 ok(C.shotBlend(0)===null,'blend: neutral allocates nothing and falls back to CONFIG.kick');
 ok(C.shotBlend(0.0005)===null,'blend: a resting trigger is still neutral');
 const bs=C.shotBlend(-1),bh=C.shotBlend(1);
 for(const k of C.SHOT_CURVE_KEYS){
  if(MD.soft[k]!=null)eq(bs[k],MD.soft[k],'blend -1 lands on the soft anchor: '+k);
  if(MD.hard[k]!=null)eq(bh[k],MD.hard[k],'blend +1 lands on the hard anchor: '+k);
  if(MD.soft[k]==null)eq(bs[k],K[k],'blend -1 keeps CONFIG.kick for an unlisted key: '+k);
 }
 const bm=C.shotBlend(-0.5);
 ok(bm.strikeA<K.strikeA&&bm.strikeA>MD.soft.strikeA,'blend: half finesse lands BETWEEN kick and the anchor');
 eq(bm.strikeA,(K.strikeA+MD.soft.strikeA)/2,'blend: the midpoint is the midpoint',1e-9);
 let ordered=true;
 for(let i=-20;i<=20;i++){const b=C.shotBlend(i/20);if(!b)continue;
  if(!(b.strike>b.windup&&b.hold>=b.strike&&b.drop>b.hold))ordered=false;}
 ok(ordered,'blend: keyframes stay ordered across the whole axis (an out-of-order ramp skips a swing phase)');
 const kSnap=JSON.stringify(K);C.shotBlend(1);C.shotBlend(-1);
 ok(JSON.stringify(K)===kSnap,'blend never mutates CONFIG.kick');

 /* ===== 4. THE CHARGE CURVES ===== */
 eq(C.shotChgPow(0),CH.powMin,'charge power starts at powMin');
 eq(C.shotChgPow(CH.sweetFrom),CH.powMax,'charge power peaks entering the band');
 eq(C.shotChgPow(CH.sweetTo),CH.powMax,'charge power holds across the band');
 eq(C.shotChgPow(1),CH.overPow,'charge power falls to overPow at full hold');
 eq(C.shotChgCtl(CH.sweetFrom),1,'control is full entering the band');
 eq(C.shotChgCtl(CH.sweetTo),1,'control is full leaving the band');
 eq(C.shotChgCtl(0),CH.ctlMin,'a snatched shot is at ctlMin');
 eq(C.shotChgCtl(1),CH.overCtl,'an overcooked shot is at overCtl');
 ok(C.shotChgPow(1)<C.shotChgPow(CH.sweetFrom*0.5),
  'HOLDING TOO LONG IS WORSE THAN A HALF CHARGE — the band is a target, not a floor');
 let up=true,down=true;
 for(let i=1;i<=20;i++){const a=(i-1)/20*CH.sweetFrom,b=i/20*CH.sweetFrom;
  if(C.shotChgPow(b)<C.shotChgPow(a)-1e-9)up=false;}
 for(let i=1;i<=20;i++){const a=CH.sweetTo+(i-1)/20*(1-CH.sweetTo),b=CH.sweetTo+i/20*(1-CH.sweetTo);
  if(C.shotChgPow(b)>C.shotChgPow(a)+1e-9)down=false;}
 ok(up,'charge power is monotone up to the band');ok(down,'charge power is monotone down after it');
 eq(C.shotChgBand(CH.sweetFrom-1e-6),0,'band: just short reads BUILDING');
 eq(C.shotChgBand(CH.sweetFrom),1,'band: the lower edge is IN');
 eq(C.shotChgBand(CH.sweetTo),1,'band: the upper edge is IN');
 eq(C.shotChgBand(CH.sweetTo+1e-6),2,'band: just past reads OVER');
 eq(C.shotOver(CH.sweetTo),0,'overcharge is 0 at the top of the band');
 eq(C.shotOver(1),1,'overcharge is 1 at a full hold');

 /* ===== 5. ARMING ===== */
 {const r=rod();
  C.shotArm(r,0,-1);
  ok(r.shotOn&&r.shotPow===1&&r.shotCtl===1&&r.shotExert===1,'arm: a neutral swing is IDENTITY (pow/ctl/exert all 1)');
  C.shotArm(r,1,CH.sweetFrom);
  eq(r.shotPow,MD.hardPow*CH.powMax,'arm: axis and charge MULTIPLY');
  eq(r.shotCtl,MD.hardCtl*1,'arm: control multiplies too');
  eq(r.shotExert,MD.hardExert,'arm: a full power swing books full exertion');
  C.shotArm(r,-1,-1);
  eq(r.shotExert,1,'arm: a finesse swing costs no extra stamina');
  C.shotDisarm(r);
  ok(!r.shotOn&&r.shotPow===1&&r.shotCtl===1,'disarm clears everything physics reads');
  C.shotArm(r,1,0.6);C.shotConsume(r);
  ok(!r.shotOn,'ONE CONTACT SPENDS THE SHOT — a charge cannot apply twice');
  r.chg=0.5;r.chgRel=0.9;r.chgSrc='rt';r.chgA=-1;r.trem=0.04;r.kickCurve={};r.shotTrack=2.6;C.shotArm(r,1,0.5);
  C.shotReset(r);
  ok(r.chg===-1&&!r.chgSrc&&r.chgA===null&&r.trem===0&&!r.shotOn&&r.kickCurve===null&&r.shotTrack===1,
   'reset clears charge, arming, tremble, curve and tracking');
  // chgRel is unreachable-if-stale TODAY (a new wind-up zeroes it on entry), which is exactly why it
  // is pinned: shotReset claims to be a full teardown, and the next reader of that field will assume it.
  eq(r.chgRel,0,'reset clears the BANKED charge too — the teardown is complete, not nearly complete');
 }

 /* ===== 6. FIRING ===== */
 {const r=rod();rec.kicks.length=0;ctx.__pass=null;
  C.shotFire(r,0,-1);
  const k=rec.kicks[0];
  ok(k&&k.style===null&&k.curve===null&&k.on===false,
   'A PLAIN KICK IS THE OLD KICK — no style, no curve, shotOn false');
  r.kickT=-1;rec.kicks.length=0;
  C.shotFire(r,1,-1);
  ok(rec.kicks[0].style==='shot'&&rec.kicks[0].curve&&rec.kicks[0].on,'RT + kick fires a styled, armed swing');
  eq(rec.kicks[0].curve.strikeA,MD.hard.strikeA,'…on the hard curve');
  /* A real teammate 25 ahead, so shotPassPick walks live geometry rather than a canned answer —
     the whole point of that function is WHICH receiver it refuses. */
  const mate=rod({idx:1,x:r.x+25,role:'ATT',baseZ:[0]});
  ctx.rods.length=0;ctx.rods.push(r,mate);
  r.kickT=-1;rec.kicks.length=0;
  C.shotFire(r,-1,-1);
  ok(rec.kicks[0].style==='pass'&&rec.kicks[0].pass&&rec.kicks[0].pass.x===mate.x,
   'DEEP FINESSE IS A PASS, at a teammate the ball can actually be turned toward');
  ok(rec.kicks[0].curve===null,
   'a pass carries NO blended curve — it swings on CONFIG.ai.passShot, the block the AI passes with');
  r.kickT=-1;rec.kicks.length=0;
  C.shotFire(r,SH.pass.modAt+0.01,-1);
  ok(rec.kicks[0].style!=='pass','just short of the pass threshold is a soft kick, not a pass');
  /* THE REFUSAL. Slide that same teammate square of the ball and the bend needed passes what the
     aim assist can deliver, so the pass must not be offered at all — it is a plain soft touch. This
     is the case that was measured shipping a PASS label on a ball that ran out for a goal kick. */
  const P=C.AIC.dribble.pass,far=Math.tan(P.assist*SH.pass.bendMult)*25+4;
  mate.offset=far;
  r.kickT=-1;rec.kicks.length=0;
  C.shotFire(r,-1,-1);
  ok(rec.kicks[0].style!=='pass',
   'a receiver too far off-line is REFUSED — the assist could never turn the ball that far ('+far.toFixed(1)+'u square)');
  mate.offset=0;
  // and one just inside the budget is still offered
  mate.offset=Math.tan(P.assist*SH.pass.bendMult)*25-1;
  r.kickT=-1;rec.kicks.length=0;
  C.shotFire(r,-1,-1);
  ok(rec.kicks[0].style==='pass','…while one just inside the budget still is');
  mate.offset=0;
  r.kickT=-1;rec.kicks.length=0;ctx.__clr=0;      // every lane blocked
  C.shotFire(r,-1,-1);
  ok(rec.kicks[0].style!=='pass','no clear lane → a finesse kick, never a pass at nothing');
  ctx.__clr=null;ctx.rods.length=0;
 }

 /* ===== 7. THE CLASSIC CHARGE ===== */
 ok(C.shotKickPress(false)===true,'classic, default cfg: the kick button still fires on PRESS');
 ok(C.shotKickPress(true)===true,'Total Control: the kick button always fires on press');
 {const old=C.cfg.padChargeBtn;
  C.cfg.padChargeBtn='kick';
  ok(C.shotKickPress(false)===false,'cfg padChargeBtn=kick moves the charge onto the kick button');
  C.cfg.padChargeBtn='both';
  ok(C.shotKickPress(false)===false,'…and so does "both"');
  C.cfg.padChargeBtn=old;}
 {const r=rod(),s=seat();rec.kicks.length=0;C.cfg.padControlMode='classic';C.cfg.padChargeBtn='rt';
  // hold RT for long enough to reach the middle of the band
  const hold=(CH.sweetFrom+CH.sweetTo)/2/CH.rate;
  let t=0;while(t<hold){C.shotPadUpdate(1/60,pad(0,1),s,r,false,0);t+=1/60;}
  ok(r.chgSrc==='rt','RT holds the wind-up');
  ok(r.chg>CH.sweetFrom&&r.chg<=CH.sweetTo,'…and the charge lands in the band after the expected time');
  ok(r.shotOn&&r.shotPow>1,'a live wind-up is already armed, so a contact mid-charge is worth something');
  ok(r.chgA!==null&&r.chgA<0,'the rod is authored BACK while winding up');
  const deep=r.chgA,atRelease=r.chg;
  ok(rec.kicks.length===0,'holding never fires');
  rec.fire.length=0;
  C.shotPadUpdate(1/60,pad(0,0),s,r,false,0);          // release
  ok(rec.fire.length===1,'releasing the wind-up fires the DISCHARGE exactly once');
  eq(rec.fire[0].k,atRelease,'…scaled by the charge that actually went off, so a flinch is nearly silent');
  ok(rec.fire[0].sweet===true,'…and tells the mix it went off inside the band, which is what earns the snap');
  ok(rec.kicks.length===1,'releasing RT fires exactly one swing');
  ok(rec.kicks[0].on&&rec.kicks[0].pow>1,'…and it carries the charge');
  /* THE AXIS IS THE ONE IT WAS HELD AT, not the one live on the release frame. In classic the charge
     is held on RT, so at the instant of release RT is on its way UP — read the axis there and a
     charged shot comes out on a NEUTRAL curve with none of the power trim, which is the power
     trigger doing nothing to the shot it just spent half a second charging. Found live. */
  ok(rec.kicks[0].curve&&Math.abs(rec.kicks[0].curve.strikeA-MD.hard.strikeA)<1e-9,
   'a charge held on RT fires on the HARD curve, not the neutral one the release frame would read');
  ok(rec.kicks[0].pow>C.shotChgPow(CH.sweetFrom)*1.0001,'…and carries the RT power trim as well as the charge');
  ok(r.chg===-1&&!r.chgSrc,'the wind-up is over');
  ok(deep<0,'wind-up angle stayed negative');
 }
 {const r=rod(),s=seat();rec.kicks.length=0;C.cfg.padChargeBtn='rt';
  // a FLINCH: released below minFire must fire the ordinary swing, not a feeble charged one
  C.shotPadUpdate(1/60,pad(0,1),s,r,false,0);
  C.shotPadUpdate(1/60,pad(0,0),s,r,false,0);
  ok(rec.kicks.length===1,'a flinch still fires a swing');
  // "Ordinary" means NO CHARGE, not no modifier: RT was held, so the power trim still applies —
  // that trigger means one thing whether or not you also charged with it.
  eq(rec.kicks[0].pow,C.shotAxisPow(1),'…the ORDINARY one — a sub-minFire release is not a weak charge');
 }
 {const r=rod(),s=seat();rec.kicks.length=0;C.cfg.padChargeBtn='rt';
  // THE KICK BUTTON IS A SECOND RELEASE for a classic wind-up. Without it, pressing it mid-charge
  // swung out of the wound-back angle with none of the charge applied and threw the wind-up away.
  let t=0;while(t<(CH.sweetFrom+CH.sweetTo)/2/CH.rate){C.shotPadUpdate(1/60,pad(0,1),s,r,false,0);t+=1/60;}
  const k=r.chg;
  C.shotFire(r,C.shotPadAxis(pad(0,1)),C.shotCharge(r));
  ok(rec.kicks.length===1&&rec.kicks[0].on,'pressing the kick button mid-wind-up fires it');
  eq(rec.kicks[0].pow,C.shotAxisPow(1)*C.shotChgPow(k),'…carrying the charge it had built');
  ok(r.chg===-1&&!r.chgSrc,'…and the wind-up is spent, not left running');
  rec.kicks.length=0;C.shotConsume(r);          // pretend that swing has taken its contact
  C.shotFire(r,1,0.6);
  ok(rec.kicks.length===0,'a swing already in flight cannot be re-fired');
  ok(!r.shotOn,'…NOR RE-ARMED — arming for a swing that never starts leaves the charge on the rod '+
   'for whatever contact happens to come next');
 }
 {const r=rod({kickT:0.02}),s=seat();
  C.shotPadUpdate(1/60,pad(0,1),s,r,false,0);
  ok(!r.chgSrc,'NO CHARGE WHILE A SWING IS IN FLIGHT — a wind-up during the follow-through is nonsense');
 }
 {const r=rod(),s=seat();rec.kicks.length=0;C.cfg.padChargeBtn='both';
  // 'both': the source already holding must not be stolen — a steal reads as an unrequested shot,
  // because losing the source is exactly what fires one.
  let t=0;while(t<0.3){C.shotPadUpdate(1/60,pad(0,1),s,r,false,0);t+=1/60;}
  ok(r.chgSrc==='rt','RT took the wind-up first');
  C.shotPadUpdate(1/60,pad(0,1,[0]),s,r,false,0);      // kick button ALSO goes down
  ok(r.chgSrc==='rt','…and keeps it when the kick button joins');
  ok(rec.kicks.length===0,'no swing was fired by the second input going down');
  C.cfg.padChargeBtn='rt';
 }
 {const r=rod(),s=seat();rec.kicks.length=0;C.cfg.padChargeBtn='kick';
  C.shotPadUpdate(1/60,pad(0,0,[0]),s,r,false,0);
  ok(r.chgSrc==='kick','padChargeBtn=kick: the kick button holds the wind-up');
  C.shotPadUpdate(1/60,pad(0,0),s,r,false,0);
  ok(rec.kicks.length===1&&rec.kicks[0].on===false,
   'a press shorter than tapMax fires the ORDINARY swing, so a tap is still a tap');
  C.cfg.padChargeBtn='rt';
 }

 /* ===== 8. THE TOTAL CONTROL CHARGE ===== */
 {const r=rod(),s=seat();rec.kicks.length=0;rec.fire.length=0;C.cfg.padControlMode='total';
  C.shotPadUpdate(1/60,pad(0,1),s,r,true,-1);
  ok(!r.chgSrc,'TC: ONE trigger with the stick back does not charge — the chord is the arm');
  C.shotPadUpdate(1/60,pad(1,1),s,r,true,0.9);
  ok(!r.chgSrc,'TC: the chord with the stick FORWARD does not charge');
  C.shotPadUpdate(1/60,pad(1,1),s,r,true,-(CH.stickBack/2));
  ok(!r.chgSrc,'TC: a shallow pull-back is below the wind-up threshold');
  let t=0;while(t<0.5){C.shotPadUpdate(1/60,pad(1,1),s,r,true,-1);t+=1/60;}
  ok(r.chgSrc==='stick','TC: chord + full pull-back charges');
  ok(r.chgA===null,'TC AUTHORS NO ANGLE — the stick is already where the player put it');
  ok(r.shotOn&&r.shotPow>1,'the charge is banked on the rod, which is the only way a stick swing can carry one');
  const held=r.shotPow;
  C.shotPadUpdate(1/60,pad(0,0),s,r,true,-1);
  ok(rec.kicks.length===0,'TC NEVER CALLS kickRod — the flick forward is the swing');
  // …but letting the chord go IS the release gesture, so the discharge belongs there even though
  // the strike itself may land later.
  ok(rec.fire.length===1,'…and letting the chord go still discharges');
  ok(r.shotOn,'…and the charge survives the release so the flick can spend it');
  /* AN ABANDONED WIND-UP MUST ONLY EVER FADE. Power is flat across the band and falls off above it,
     so a charge decaying down from an overcook passes back THROUGH the band — overcook on purpose,
     let go, wait, and the shot is worth full power again, which skips the timing the band tests.
     This walks the WHOLE fade and refuses any frame that is worth more than the release was. */
  let g=0,peak=-1,mono=true;
  while(r.shotOn&&g<900){C.shotPadUpdate(1/60,pad(0,0),s,r,true,-1);
   if(r.shotOn){if(r.shotPow>held+1e-9)mono=false;if(peak>=0&&r.shotPow>peak+1e-9)mono=false;peak=r.shotPow;}g++;}
  ok(mono,'A LET-GO CHARGE NEVER REGAINS POWER — no overcook-then-wait way round the sweet band');
  ok(g<900,'…and it lets go in finite time');
  ok(!r.shotOn,'an abandoned wind-up disarms itself completely');
  ok(r.chg===-1&&r.chgRel===0,'…and leaves nothing banked behind it');
  C.cfg.padControlMode='classic';
 }
 {const r=rod(),s=seat();C.cfg.padControlMode='total';
  eq(C.shotTrackMult(rod()),1,'stick tracking is 1 with no trigger held');
  C.shotPadUpdate(1/60,pad(1,0),s,r,true,0);
  eq(r.shotTrack,MD.softTrack,'LT makes the rod HEAVY, so a flick cannot become a hard hit');
  C.shotPadUpdate(1/60,pad(0,1),s,r,true,0);
  eq(r.shotTrack,MD.hardTrack,'RT makes it SNAP, so your flick speed arrives intact');
  C.shotPadUpdate(1/60,pad(1,1),s,r,true,0);
  eq(r.shotTrack,1,'both held tracks normally — a charge release must be honest');
  C.cfg.padControlMode='classic';
  C.shotPadUpdate(1/60,pad(1,0),s,r,false,0);
  eq(r.shotTrack,1,'classic never bends the stick tracking (there is no stick swing to bend)');
 }

 /* ===== 9. THE WIND-UP GUARD — the trap knock-back, in a new costume ===== */
 {const r=rod(),s=seat();C.cfg.padChargeBtn='rt';ctx.__clip=true;
  let t=0;while(t<0.5){C.shotPadUpdate(1/60,pad(0,1),s,r,false,0);t+=1/60;}
  eq(r.chgA,r.angle,'A BALL IN THE SWEEP PINS THE WIND-UP AT THE CURRENT ANGLE — it can never pull back through the ball');
  ctx.__clip=false;
  const r2=rod(),s2=seat();t=0;while(t<0.5){C.shotPadUpdate(1/60,pad(0,1),s2,r2,false,0);t+=1/60;}
  ok(r2.chgA<r.chgA-1e-6,'…and with the sweep clear it really does pull back');
 }
 {const r=rod();
  ok(C.shotPullCap(r,0,-1.2)===-1.2||Math.abs(C.shotPullCap(r,0,-1.2)+1.2)<1e-9,'clear sweep returns the full target');
  ctx.__clip=true;eq(C.shotPullCap(r,0,-1.2),0,'clipped sweep returns the start angle');ctx.__clip=false;
 }
 {const r=rod(),s=seat();C.cfg.padChargeBtn='rt';
  // the pull-back deepens WITH the charge and saturates at the top of the band, so the rocking men
  // are the meter and holding past the band adds tremble rather than depth
  const A=[];let t=0;
  while(t<CH.sweetTo/CH.rate+0.4){C.shotPadUpdate(1/60,pad(0,1),s,r,false,0);A.push({k:r.chg,a:r.chgA});t+=1/60;}
  let deepens=true;for(let i=1;i<A.length;i++)if(A[i].a>A[i-1].a+1e-6)deepens=false;
  ok(deepens,'the wind-up only ever deepens while the charge builds');
  const atBand=A.find(x=>x.k>=CH.sweetFrom);
  ok(atBand&&Math.abs(A[A.length-1].a-atBand.a)<1e-6,
   'the wind-up saturates at the band LOWER edge, so the arc is already full everywhere inside it');
  /* THE PEAK OF THE WHOLE SHOT MUST BE INSIDE THE BAND. The arc is the real power, so saturating it
     at the band's TOP would leave power still climbing across the band and peaking one frame before
     the overcook — measured live at 2.16x a plain tap mid-band against 2.73x fully overcooked, i.e.
     holding too long was the strongest shot in the game. This walks the product of the two channels
     and refuses any charge outside the band that beats every charge inside it. */
  const worth=k=>Math.min(1,Math.max(0,k/CH.sweetFrom))*C.shotChgPow(k);
  let bestK=0,bestW=-1;
  for(let i=0;i<=200;i++){const k=i/200,w=worth(k);if(w>bestW+1e-9){bestW=w;bestK=k;}}
  ok(bestK>=CH.sweetFrom-1e-6&&bestK<=CH.sweetTo+1e-6,
   'the strongest charge is INSIDE the sweet band (peaks at '+bestK.toFixed(2)+')');
  ok(worth(1)<bestW-1e-9,'…and a full overcook is strictly weaker than it');
  ok(worth(CH.sweetFrom)>worth(CH.sweetFrom*0.5)+1e-9,'…and stronger than a half charge');
 }

 /* ===== 10. TREMBLE AND TONE — the readouts ===== */
 {const r=rod(),s=seat();C.cfg.padChargeBtn='rt';rec.tick=0;rec.mark.length=0;
  let t=0,tremInBand=0;
  while(t<CH.sweetTo/CH.rate){C.shotPadUpdate(1/60,pad(0,1),s,r,false,0);
   if(C.shotChgBand(r.chg)<=1)tremInBand=Math.max(tremInBand,Math.abs(r.trem));t+=1/60;}
  eq(tremInBand,0,'NO TREMBLE up to and inside the band — the shake means "you have held it too long"');
  ok(rec.tick>0,'the charge voice is FED while the wind-up builds');
  eq(rec.fed,r.chg,'…with the live charge, so the voice sweeps with it');
  ok(rec.mark.length>=1&&rec.mark[0]===true,'entering the band plays the bright mark');
  let over=0;t=0;
  while(t<1.5){C.shotPadUpdate(1/60,pad(0,1),s,r,false,0);over=Math.max(over,Math.abs(r.trem));t+=1/60;}
  ok(over>0,'past the band the rod trembles');
  ok(over<=CH.trem.amp+1e-9,'…and never past the configured amplitude');
  ok(rec.mark.length>=2&&rec.mark[1]===false,'falling out of the band plays the dull mark');
 }

 /* ===== 11. SPRAY ===== */
 {const r=rod();r.shotOn=true;r.shotCtl=1;
  const b={v:{x:40,y:2,z:5}};const before=JSON.stringify(b.v);
  C.shotSpray(b,r);
  ok(JSON.stringify(b.v)===before,'full control sprays nothing at all');
  r.shotCtl=0;
  let maxDev=0,speedOK=true;
  for(let i=0;i<400;i++){
   const bb={v:{x:40,y:2,z:5}};const s0=Math.hypot(bb.v.x,bb.v.z),h0=Math.atan2(bb.v.z,bb.v.x);
   C.shotSpray(bb,r);
   const s1=Math.hypot(bb.v.x,bb.v.z);
   if(Math.abs(s1-s0)>1e-9)speedOK=false;
   let d=Math.atan2(bb.v.z,bb.v.x)-h0;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;
   maxDev=Math.max(maxDev,Math.abs(d));
   if(Math.abs(bb.v.y-2)>1e-12)speedOK=false;
  }
  ok(speedOK,'SPRAY IS A PURE HORIZONTAL ROTATION — it adds no energy and never touches v.y');
  ok(maxDev<=CH.spray+1e-9,'spray stays inside its configured bound');
  ok(maxDev>CH.spray*0.7,'…and actually reaches most of it over 400 draws');
  // reproducibility: the same seed must give the same spray, or a recorded run cannot be replayed
  C.rngSeed(999);const a1={v:{x:40,y:0,z:0}};C.shotSpray(a1,r);
  C.rngSeed(999);const a2={v:{x:40,y:0,z:0}};C.shotSpray(a2,r);
  ok(a1.v.z===a2.v.z,'spray is SEEDED — the same seed sprays the same way');
  C.rngSeed(12345);
 }

 /* ===== 12. THE OFF SWITCH ===== */
 {const wasOn=SH.on;SH.on=false;
  const r=rod({chg:0.5,chgSrc:'rt',shotOn:true,shotPow:2,trem:0.05}),s=seat();
  const fired=C.shotPadUpdate(1/60,pad(0,1),s,r,false,-1);
  ok(fired===false&&!r.shotOn&&r.chg===-1&&r.trem===0,'shots off: the pad update RESETS and does nothing');
  eq(C.shotPadAxis(pad(0,1)),0,'shots off: the axis is flat');
  eq(C.shotTrackMult(rod({shotTrack:2.6})),1,'shots off: stick tracking is untouched');
  ok(C.shotKickPress(false)===true,'shots off: the kick button fires on press whatever cfg says');
  rec.kicks.length=0;const r2=rod();C.shotFire(r2,1,0.8);
  ok(rec.kicks[0].style===null&&rec.kicks[0].curve===null&&!r2.shotOn,
   'shots off: shotFire is the plain kickRod(r) it replaced');
  SH.on=wasOn;}

 return {pass,fail,fails:fails.slice()};
}

/* ---- mutations: one decision each, and the suite must NOTICE ---- */
const SRC=read('js/shots.js');
function mutate(find,repl,name){
 if(SRC.indexOf(find)<0)return{name,err:'anchor not found — the mutation has drifted off the source'};
 const m=SRC.split(find).join(repl);
 // A mutant identical to its source scores a free point forever. Refuse it.
 if(m===SRC)return{name,err:'mutant is identical to the source'};
 return{name,src:m};
}
const MUTS=[
 mutate('function shotAxis(lt,rt){return clamp(rt-lt,-1,1);}',
        'function shotAxis(lt,rt){return clamp(rt+lt,-1,1);}','the chord does not cancel'),
 mutate('for(const k of SHOT_CURVE_KEYS){const base=KICK[k];out[k]=(anc[k]!=null)?lerp(base,anc[k],t):base;}',
        'for(const k of SHOT_CURVE_KEYS){const base=KICK[k];out[k]=(anc[k]!=null)?anc[k]:base;}',
        'the curve snaps to the anchor instead of blending'),
 mutate(' if(k<=s1||s1>=1)return C.powMax;\n return lerp(C.powMax,C.overPow,(k-s1)/(1-s1));',
        ' return C.powMax;','holding too long is free (no power falloff)'),
 mutate('  if(clip)break;\n  best=a;','  best=a;','the wind-up ignores sweepClips'),
 mutate(' if(C.on&&r.kickT<0){',' if(C.on){','a charge builds during the swing'),
 mutate('function shotConsume(r){if(r.shotOn)shotDisarm(r);}',
        'function shotConsume(r){}','a charge applies to every contact, not one'),
 mutate(' const a=SHOTC.charge.spray*(1-clamp(r.shotCtl,0,1));',
        ' const a=SHOTC.charge.spray*clamp(r.shotCtl,0,1);','spray scales with control instead of against it'),
 mutate('   if(shotChord(lt,rt)&&back>=C.stickBack){src=\'stick\';depth=back;}',
        '   if((lt>0||rt>0)&&back>=C.stickBack){src=\'stick\';depth=back;}',
        'one trigger arms the Total Control charge'),
 mutate(' r.shotPow=shotAxisPow(m)*(k>=0?shotChgPow(k):1);',
        ' r.shotPow=shotAxisPow(m);','arming ignores the charge'),
 mutate(' if(k>=0&&k<SHOTC.charge.minFire)k=-1;','','a flinch fires a weak charged shot instead of a normal swing'),
 mutate('   if(bend>maxBend)continue;','   if(false)continue;',
        'the player passes at a receiver the assist could never turn the ball toward'),
 mutate('   const want=C.pullA*r.kickDir*clamp(C.sweetFrom>0?r.chg/C.sweetFrom:1,0,1);',
        '   const want=C.pullA*r.kickDir*clamp(C.sweetTo>0?r.chg/C.sweetTo:1,0,1);',
        'the wind-up saturates at the band TOP, so power peaks past the band'),
 mutate('   shotFire(r,(r.chgMod!=null?r.chgMod:m),tap?-1:k);',
        '   shotFire(r,m,tap?-1:k);','the release reads the axis at the release frame, not the one it was held at'),
 mutate(' if(r.kickT>=0)return;\n if(k>=0','\n if(k>=0','a swing already in flight can be re-armed'),
 mutate('  const T=C.trem,ov=shotOver(r.chg);\n  r.trem=ov>0?T.amp*ov*Math.sin(r.chgHeld*T.hz):0;',
        '  const T=C.trem;\n  r.trem=T.amp*Math.sin(r.chgHeld*T.hz);','the rod trembles for the whole charge'),
 mutate('   r.shotPow=shotAxisPow(m)*lerp(1,shotChgPow(r.chgRel),f);',
        '   r.shotPow=shotAxisPow(m)*shotChgPow(r.chg);',
        'a let-go overcharge decays back through the band and regains power'),
 mutate(' r.chg=-1;r.chgRel=0;r.chgMod=null;r.chgSrc=null;',
        ' r.chg=-1;r.chgMod=null;r.chgSrc=null;','shotReset leaves the banked charge behind'),
 mutate(' if(!shotsOn()||TC||!SHOTC.charge.on)return true;',
        ' return true;','the kick button always fires on press, so its charge can never release')
];

/* ---- go ---- */
const base=run(SRC,'live');
console.log('\n=== shots harness ===');
console.log('assertions: '+base.pass+' passed, '+base.fail+' failed');
if(base.fail){for(const f of base.fails)console.log('  FAIL  '+f);}
console.log('\n--- mutations (each must BREAK the suite) ---');
let mOK=0;
for(const m of MUTS){
 if(m.err){console.log('  BROKEN  '+m.name+' — '+m.err);continue;}
 let r;
 try{r=run(m.src,m.name);}catch(e){r={fail:99,pass:0};}
 if(r.fail>0){mOK++;console.log('  caught  ('+r.fail+' assertions)  '+m.name);}
 else console.log('  MISSED  '+m.name+' — the suite cannot tell');
}
console.log('\nmutations caught: '+mOK+'/'+MUTS.length);
process.exit(base.fail===0&&mOK===MUTS.length?0:1);
