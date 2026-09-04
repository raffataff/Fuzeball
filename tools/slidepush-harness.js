/* Slide-push + player-hold harness.   node tools/slidepush-harness.js
   Slices the REAL collideRod (physics.js), holdCfg (rods.js) and shotHoldUpdate (shots.js) out of
   their files and runs them against live CONFIG, so a retune shows up HERE rather than in play.
   The question it exists to answer: what does a rod SLIDING into a ball hand that ball, at each
   input depth, with and without the L2 hold — and can a swing still hit at full power. */
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};

/* ---- the real functions, lifted verbatim ---- */
const real=[
 slice(rd('js/physics.js'),'function collideRod(b,r){','function ballBall('),
 slice(rd('js/rods.js'),'function styleCfg(',NL+'function kickStyleCfg'),
 slice(rd('js/rods.js'),'function kickStyleCfg(r){',NL+'/* Was a contact'),
 slice(rd('js/rods.js'),'function holdCfg(r){',NL+'/* aimAt'),
 slice(rd('js/shots.js'),'function shotsOn(){',NL+NL+'/* ---- the modifier axis'),
 slice(rd('js/shots.js'),'function shotHoldUpdate(r,lt){',NL+NL+'/* The swing CURVE'),
 slice(rd('js/stats.js'),'function stHit(r){',NL),
 slice(rd('js/stats.js'),'function stGrip(r){',NL),
 slice(rd('js/stats.js'),'function stCapFrac(r){',NL),
 slice(rd('js/physics.js'),'function capSpeed(b,r,sweet,in2){',NL+'function collideRod(')
].join(NL);

/* ---- stubs: everything collideRod touches that is not the contact algebra ----
   cfg and FOOT_JITTER are deliberately NOT stubbed — they are config.js top-level names and a
   second declaration in the same scope is a SyntaxError, the shared-scope trap this repo already
   documents. RNG.jit returns 0.5, so the jitter term is exactly 0 and cannot smear a reading. */
const stubs=[
"var S={time:0,eff:[{boost:-1,frozen:-1,big:-1},{boost:-1,frozen:-1,big:-1}],balls:[],lastTouch:-1,teamStats:null,shake:0};",
"var dbgLogRod=null;",
"var RNG={jit:function(){return 0.5;}};",
"var Au={kick:function(){}};",
"function aimAssist(){} function passFaceOK(){return true;} function shotSpray(){}",
"function shotConsume(r){if(r.shotOn){r.shotOn=false;r.shotPow=1;r.shotCtl=1;}}",
"function momContact(){} function msContact(){} function dbgHit(){} function isUserRod(){return true;}",
"function makeBall(){return null;} function syncBall(){} function notice(){}",
"var SHOTC=CONFIG.shots;",                         // shots.js alias; sliced below it
"var STC=CONFIG.stats;",                          // stats.js alias; not loaded here
"function ST(r,k){return STC.base;}",              // base 5 = every stat multiplier is exactly 1
"function stFat(){return 1;} function stAccFrac(){return 0;}"
].join(NL);

/* ONE run, and the values come out through an EXPLICIT export: config.js's aliases are top-level
   `const`, which are lexical and never become properties of the vm context. Read them off ctx and
   every threshold silently reads back undefined — which looks exactly like a passing test. */
const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,
 localStorage:{getItem:()=>null,setItem:()=>{}}};
ctx.globalThis=ctx;
vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,real,
 ';globalThis.X={CONFIG:CONFIG,KICK:KICK,AIC:AIC,SHOT:SHOT,BALL_TYPES:BALL_TYPES,'+
 'collideRod:collideRod,holdCfg:holdCfg,shotHoldUpdate:shotHoldUpdate,stGrip:stGrip};'
].join(NL),ctx);
const X=ctx.X;
if(!X||!X.CONFIG)throw new Error('export line did not run');

const P=X.CONFIG.physics,K=X.KICK,H=X.SHOT.hold,HZ=X.CONFIG.sim.hz;
const REACH=P.ballR*P.footBoxReach;

function mkRod(over){                                   // one man at z=0, red, at rest
 const r={idx:0,x:0,team:0,role:'MID',baseZ:[0],removedUntil:[0],offset:0,maxOff:20,trnHidden:false,
  angle:0,angVel:0,vz:0,kickT:-1,kickStyle:null,kickCurve:null,kickDir:1,cd:0,aiIQ:false,aimSweet:-1,
  kickHit:false,msSw:false,tcSpin:0,chg:-1,shotOn:false,shotPow:1,shotCtl:1,passTo:null,act:null,
  hold:{on:false,holdRest:K.rest,holdGrip:K.grip,carryMult:1},stats:null};
 return Object.assign(r,over||{});
}
function mkBall(z,vz,type){                             // ball resting on the floor
 return {m:{position:{x:0,y:P.ballR,z:z}},v:{x:0,y:0,z:vz||0},t:X.BALL_TYPES[type||'classic'],
  spin:0,didSplit:false,scored:false};
}
/* Drive a sideways slide into a resting ball and report the speed the ball leaves with. The boot
   starts clear in z and is stepped in at vz until it has passed through — the same sequence the
   sim runs, so depenetration and repeat contacts are included rather than assumed away. */
function slideInto(vz,opt){
 opt=opt||{};
 const r=mkRod(opt.rod);
 const b=mkBall(0,0,opt.type);
 if(opt.hold!=null)X.shotHoldUpdate(r,opt.hold);
 // rods.js applies the hold's carryMult to the rod's own speed cap; mirror that here or the L2
 // rows compare a 36 u/s carry against an 80 u/s swipe and pretend they were the same gesture.
 r.vz=vz*(opt.carry===false?1:(r.hold.on?r.hold.carryMult:1));
 r.offset=-(P.footBox.z+REACH+1.2);
 for(let i=0;i<600;i++){
  r.offset+=r.vz/HZ; if(r.offset-b.m.position.z>P.footBox.z+REACH+2.5)break;
  if(opt.hold!=null)X.shotHoldUpdate(r,opt.hold);
  X.collideRod(b,r);
  b.m.position.z+=b.v.z/HZ;                        // the ball runs away as it is pushed
 }
 return {ball:Math.hypot(b.v.x,b.v.z),boot:r.vz,ratio:Math.hypot(b.v.x,b.v.z)/r.vz};
}
/* A ball arriving at a STATIONARY boot. Reported as the residual after ONE contact and the number
   of sim steps until it is dead: the passive boot is already an absorber given enough substeps, so
   the final speed measures nothing — what the grip buys is killing it in fewer, shallower touches,
   which is the difference between trapping a ball and wrestling it. */
function arriveAt(bv,opt){
 opt=opt||{};const r=mkRod();
 const b=mkBall(P.footBox.z+REACH-0.02,-bv);
 if(opt.hold!=null)X.shotHoldUpdate(r,opt.hold);
 X.collideRod(b,r);
 const first=Math.abs(b.v.z);
 let steps=1;
 for(;steps<200;steps++){
  b.m.position.z+=b.v.z/HZ;
  if(opt.hold!=null)X.shotHoldUpdate(r,opt.hold);
  X.collideRod(b,r);
  if(Math.abs(b.v.z)<0.5)break;
 }
 return {first:first,frac:first/bv,steps:steps};
}
/* A rotating boot driving into a ball just ahead of it — the KICK, which must not change. */
function swing(){
 const r=mkRod({angle:0.05,angVel:20,kickT:0.02});
 const b=mkBall(0);b.m.position.x=P.footBoxOff.y+0.9;
 X.collideRod(b,r);return Math.hypot(b.v.x,b.v.y,b.v.z);
}

let pass=0,fail=0;
const ok=(n,c,d)=>{c?pass++:fail++;console.log((c?'  ok   ':'  FAIL ')+n+(d?'   ['+d+']':''));};
const near=(a,b,t)=>Math.abs(a-b)<=t;

console.log(NL+'=== 1. a sideways slide, no trigger ===');
const rows=[10,20,40,60,80].map(v=>slideInto(v));
rows.forEach(x=>console.log('   boot '+String(x.boot).padStart(3)+' u/s  ->  ball '+
 x.ball.toFixed(1).padStart(5)+' u/s   ('+(x.ratio*100).toFixed(0)+'% of the boot)'));
ok('a gentle slide is gentle (20 u/s boot under 12)',rows[1].ball<12,'ball '+rows[1].ball.toFixed(1));
ok('a full swipe is a pass, not a shot (80 u/s boot under 35)',rows[4].ball<35,'ball '+rows[4].ball.toFixed(1));
ok('...but still moves the ball usefully (over 20)',rows[4].ball>20,'ball '+rows[4].ball.toFixed(1));
ok('the response is monotonic in boot speed',rows.every((x,i)=>i===0||x.ball>rows[i-1].ball));
ok('and proportional — no knee in the curve',near(rows[3].ball/rows[1].ball,3,0.4),
 '60/20 = '+(rows[3].ball/rows[1].ball).toFixed(2)+'x');

console.log(NL+'=== 2. slidePush is the knob, and 1 is the old behaviour ===');
const was=K.slidePush,capOn=K.cap&&K.cap.on;
/* The 'as it shipped' figures are measured with the per-contact SPEED CEILING OFF, because it
   did not exist then - this section is about what slidePush alone did, and leaving the ceiling
   in would quietly fold a later, separate mechanism into a historical number. */
const capOff=()=>{if(K.cap)K.cap.on=false;},capBack=()=>{if(K.cap)K.cap.on=capOn;};
K.slidePush=1;capOff();const old80=slideInto(80).ball;capBack();
K.slidePush=was;const now80=slideInto(80).ball;
console.log('   slidePush 1 (as it shipped): '+old80.toFixed(1)+' u/s      slidePush '+was+': '+now80.toFixed(1)+' u/s');
ok('slidePush 1 = the ball leaves at the boot speed (the ping)',near(old80/80,1,0.02),
 (old80/80*100).toFixed(0)+'% of an 80 u/s boot');
ok('and the shipped value is well under half of that',now80<old80*0.55,
 (now80/80*100).toFixed(0)+'% of the boot');

console.log(NL+'=== 3. the SWING is untouched — this must not soften a kick ===');
const sw=swing();K.slidePush=1;const swOld=swing();K.slidePush=was;
console.log('   swing at 20 rad/s  ->  ball '+sw.toFixed(1)+' u/s   (at slidePush 1: '+swOld.toFixed(1)+')');
ok('a kick is bit-identical either way (rotation is not scaled)',near(sw,swOld,1e-9),
 'delta '+Math.abs(sw-swOld).toExponential(1));
ok('and a kick still outruns a full-speed slide',sw>rows[4].ball,sw.toFixed(1)+' > '+rows[4].ball.toFixed(1));

console.log(NL+'=== 4. the L2 hold blends with squeeze depth ===');
console.log('   boot 80 u/s:  L2 off '+slideInto(80).ball.toFixed(1)+
 '   L2 half '+slideInto(80,{hold:(H.from+1)/2}).ball.toFixed(1)+
 '   L2 full '+slideInto(80,{hold:1}).ball.toFixed(1)+
 ' u/s     (carryMult applied, as rods.js does: L2 also slows the rod)');
ok('below the engage threshold the hold is off',
 (()=>{const r=mkRod();X.shotHoldUpdate(r,H.from);return !r.hold.on;})());
ok('at the threshold it is EXACTLY a normal contact',(()=>{const r=mkRod();X.shotHoldUpdate(r,H.from+1e-9);
 return near(r.hold.holdRest,K.rest,1e-6)&&near(r.hold.holdGrip,X.stGrip(r),1e-6)&&near(r.hold.carryMult,1,1e-6);})());
ok('at full squeeze it is the configured hold',(()=>{const r=mkRod();X.shotHoldUpdate(r,1);
 return near(r.hold.holdRest,H.rest,1e-9)&&near(r.hold.holdGrip,H.grip,1e-9)&&near(r.hold.carryMult,H.carry,1e-9);})());
ok('and half depth sits between the two',(()=>{const r=mkRod();X.shotHoldUpdate(r,(H.from+1)/2);
 return r.hold.holdGrip>K.grip&&r.hold.holdGrip<H.grip&&r.hold.carryMult<1&&r.hold.carryMult>H.carry;})());

console.log(NL+'=== 5. the hold TRAPS an arriving ball ===');
for(const v of [30,60,90]){
 const off=arriveAt(v),on=arriveAt(v,{hold:1});
 console.log('   ball in at '+String(v).padStart(2)+' u/s  ->  no L2: '+off.first.toFixed(1)+
  ' u/s left after first touch, dead in '+off.steps+' steps   |   L2: '+on.first.toFixed(1)+
  ' u/s, dead in '+on.steps);
 ok('L2 takes more off a '+v+' u/s ball on first touch',on.first<off.first*0.75,
  on.first.toFixed(1)+' vs '+off.first.toFixed(1));
 ok('...and kills it in no more touches',on.steps<=off.steps,on.steps+' vs '+off.steps);
}
ok('a passive boot was ALREADY an absorber given enough substeps — the grip buys the first touch',
 arriveAt(60).frac>0.15&&arriveAt(60,{hold:1}).frac<0.12,
 'passive keeps '+(arriveAt(60).frac*100).toFixed(0)+'%, L2 keeps '+(arriveAt(60,{hold:1}).frac*100).toFixed(0)+'%');

console.log(NL+'=== 6. the hold yields to a swing and to a wind-up ===');
ok('holdCfg is null mid-swing, so L2+kick releases at full strength',
 (()=>{const r=mkRod({kickT:0.02});X.shotHoldUpdate(r,1);return X.holdCfg(r)===null;})());
ok('a live wind-up cancels the hold',
 (()=>{const r=mkRod({chg:0.4});X.shotHoldUpdate(r,1);return !r.hold.on&&X.holdCfg(r)===null;})());
ok('holdCfg hands back the ROD-owned block, so two seats cannot share one',
 (()=>{const a=mkRod(),c=mkRod();X.shotHoldUpdate(a,1);X.shotHoldUpdate(c,(H.from+1)/2);
  return X.holdCfg(a)===a.hold&&X.holdCfg(c)===c.hold&&a.hold.holdGrip!==c.hold.holdGrip;})());
ok('shots off = no hold at all',(()=>{const s=X.CONFIG.shots.on;X.CONFIG.shots.on=false;
 const r=mkRod();X.shotHoldUpdate(r,1);X.CONFIG.shots.on=s;return !r.hold.on;})());
ok('hold.on:false = no hold at all',(()=>{const s=H.on;H.on=false;
 const r=mkRod();X.shotHoldUpdate(r,1);H.on=s;return !r.hold.on;})());
ok('the AI trap/dribble blocks still resolve through holdCfg',
 X.holdCfg(mkRod({act:'trap'}))===X.AIC.trap&&X.holdCfg(mkRod({act:'dribble'}))===X.AIC.dribble);

console.log(NL+'=== 7. ball type no longer swings the feel as wildly ===');
const types=['classic','fire','cannon','golden'];
types.forEach(k=>console.log('   '+k.padEnd(8)+' mass '+String(X.BALL_TYPES[k].mass).padStart(4)+
 '  ->  '+slideInto(80,{type:k}).ball.toFixed(1)+' u/s'));
ok('no ball leaves a slide faster than the boot that pushed it',
 types.every(k=>slideInto(80,{type:k}).ball<=80),
 'worst '+Math.max.apply(null,types.map(k=>slideInto(80,{type:k}).ball)).toFixed(1));
K.slidePush=1;capOff();
const oldWorst=Math.max.apply(null,types.map(k=>slideInto(80,{type:k}).ball));
K.slidePush=was;capBack();
ok('...which was NOT true before (a light ball outran its own boot)',oldWorst>80,
 'was '+oldWorst.toFixed(1));

console.log(NL+pass+' passed, '+fail+' failed'+NL);
process.exit(fail?1:0);
