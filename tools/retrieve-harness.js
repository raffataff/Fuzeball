// retrieve harness. node tools/retrieve-harness.js
// slices the real retrieveStep / retrieveEnd / retrieveMan (ai.js) and helpers and steps them against live CONFIG with a bare-bones rod (slide and lift ease like updateRods, a pin takes when the leg is over the ball); the entry and bail tests live in aiUpdate and aren't covered
// covers the approach, pin geometry, both fallback lanes and the hand-over of an outfield pin to the catch's hold; every mutation must break an assertion
'use strict';
const fs=require('fs'),vm=require('vm');
const NL=String.fromCharCode(10);
const rd=f=>fs.readFileSync(f,'utf8').split(String.fromCharCode(13)+NL).join(NL);
const slice=(src,from,to)=>{const a=src.indexOf(from);if(a<0)throw new Error('slice miss: '+from);
 const b=to?src.indexOf(to,a):-1;return src.slice(a,b<0?src.length:b);};
const AI=rd('js/ai.js');
const parts={
 manLive:slice(AI,'function manLive(r,i){',NL+'function inFootRange('),
 foot:slice(AI,'const _fb={nx:0',NL+'function sweepClips('),
 guard:slice(AI,'const BGS={lift:0',NL+'function clearOffset('),   // the retrieve block sits at its end
 clearOffset:slice(AI,'function clearOffset(r,bz,cz,prefer){',NL+'function nearestFootZ('),
 lane:slice(AI,'function inLaneZ(r,lz,cz){',NL+'function laneMate('),
 pose:slice(AI,'const FA_R={',NL+'function sideAngle('),
 hand:slice(AI,'function retrieveHold(',NL+'function sidePick(')
};
const stubs=[
 "var S={balls:[],time:0}; var SEAT=null; function seatOf(){return SEAT;}",
 "var dbgLogRod=null; function dbgRod(){}",
 "var KICKS=[],STRIKE=true,RELEASED=0,SHUT=false; function laneShut(){return SHUT;}",
 "function pinRelease(r){r.pinB=null;RELEASED++;}",
 "function kickRod(r,style){r.kickT=0;r.act=null;KICKS.push(style);}",
 "function strikeOn(){return STRIKE;} function stCd(){return 1;} function aiR(r,a,b){return (a+b)/2;}",
 // the carry (catch-harness pins it) is stubbed to the plain rule: play it once settleT is up; pinFire asks the strike gate like the real one
 "var PLAY=null,SAWTAP=null,STARTS=0; function ttStart(r){r.catPh='hit';}",
 "function pinPlayStart(){STARTS++;} function pinPlay(r,best,t,dt,tap){SAWTAP=tap;if(t<AIC.retrieve.settleT)return 0;return PLAY!=null?PLAY:1;}",
 "function pinPassPlan(){return PASS;} var PASS=null;",
 // the drop's swing: the plain shot's plan (ai.js kickShotPlan) stubbed to a reachable, open shot unless a test says otherwise
 "var SHOTPLAN={launch:{slide:0},ev:{best:{clr:9}}}; function kickShotPlan(){return SHOTPLAN;} function laneMin(){return 0;} function plannedKick(r,style){kickRod(r,style);}",
 "function pinFire(r,best,D,v){if(r.kickT>=0)return 0;if(!strikeOn())return -1;kickRod(r,'pinShot');return 1;}",
 slice(rd('js/physics.js'),'function footBoxD(',NL+'function pinSurfaceY('),
 'const CAS={retHold:0,pin:0,enter:0,hit:0};',
 "var LOOSE=false,LOOSEN=0; function hitLoose(r,best,own){LOOSEN++;return LOOSE&&own===true;}",
 "function teamDiff(){return 'pro';}",
 slice(rd('js/rods.js'),'// --- hand (CONFIG.ai.hand)'),   // the hand arc's switch and helpers
].join(NL);

function boot(mut){
 const g=Object.assign({},parts);
 if(mut){const before=g[mut.part];g[mut.part]=before.split(mut.from).join(mut.to);
  if(g[mut.part]===before)throw new Error('mutation is a no-op (anchor drifted): '+mut.from);}
 const ctx={console,Math,JSON,Date,Object,Array,Set,Map,parseFloat,parseInt,isNaN,localStorage:{getItem:()=>null,setItem:()=>{}}};
 ctx.globalThis=ctx;
 vm.runInNewContext([rd('js/core.js'),rd('js/config.js'),stubs,g.manLive,g.foot,g.guard,g.clearOffset,g.lane,g.pose,g.hand,
  ';globalThis.X={S:S,AIC:AIC,KICK:KICK,SHOT:SHOT,SIM:SIM,BALL_R:BALL_R,FOOT_BOX:FOOT_BOX,footUnder:footUnder,retrieveStep:retrieveStep,retrieveMan:retrieveMan,'+
  'retrievePhase:retrievePhase,KICKS:KICKS,setStrike:function(v){STRIKE=v;},setShot:function(v){SHOTPLAN=v;},setShut:function(v){SHUT=v;},setPlay:function(v){PLAY=v;},starts:function(){return STARTS;},CAS:CAS,sawTap:function(){return SAWTAP;},released:function(){return RELEASED;},setLoose:function(v){LOOSE=v;},looseN:function(){return LOOSEN;}};'].join(NL),ctx);
 return ctx.X;
}

/* A red keeper rod with `baseZ` men, in the state aiUpdate leaves it on entry to the action. */
function mkRod(X,over){
 return Object.assign({x:-52.5,team:0,kickDir:1,role:'GK',aiIQ:true,baseZ:[0],maxOff:10,removedUntil:[],offset:0,target:0,slideV:0,
  angle:0,raise:false,behindFlag:false,aiMan:-1,kickT:-1,cd:0,pinB:null,pinOn:false,pinPose:false,pinA:null,
  act:'retrieve',retPh:'side',retT:0,retDir:0,retZ:null,retMan:-1,retHold:0,retCd:0},over||{});
}
function mkBall(X,rel,bz){const b={scored:false,m:{position:{x:-52.5+rel,y:X.BALL_R,z:bz}},v:{x:0,y:0,z:0}};X.S.balls=[b];return b;}
// run the action; returns {phase log, trace of {ph,raise,ang,off}}; the rod moves as updateRods moves it (slide capped at 40 u/s, exponential lift/drop/pin ease); `takePin:false` = a pin that never catches
function run(X,r,b,opt){
 opt=opt||{};const dt=1/X.SIM.hz,D={cd:1},tr=[],phases=[];
 const best={m:b.m,v:b.v,real:b,scored:false};
 for(let i=0;i<Math.round((opt.T||6)*X.SIM.hz)&&r.act==='retrieve';i++){
  X.retrieveStep(r,best,D);
  if(r.retPh&&r.retPh!==phases[phases.length-1])phases.push(r.retPh);   // retPh goes null when the action ends
  r.offset+=Math.max(-40*dt,Math.min(40*dt,r.target-r.offset));
  const tgt=(r.pinPose&&r.pinA!=null)?r.pinA:(r.raise?X.KICK.raiseA:0),rate=(r.pinPose&&r.pinA!=null)?X.AIC.retrieve.pinLead*0+14:(r.raise?X.KICK.raiseLerp:X.KICK.dropLerp);
  r.angle+=(tgt-r.angle)*Math.min(1,rate*dt);
  if(r.pinOn&&r.pinPose&&!r.pinB&&opt.takePin!==false&&r.retPh==='pin'&&Math.abs(r.angle-r.pinA)<X.SHOT.pin.capA&&X.footUnder(r,b.m.position,r.baseZ[r.retMan]+r.offset)){
   b.pinMan=r.retMan;r.pinB=b;
  }
  tr.push({ph:r.retPh,raise:r.raise,ang:r.angle,off:r.offset,pinA:r.pinA,pose:r.pinPose,pinB:!!r.pinB,act:r.act});
 }
 return {phases,tr};
}

function suite(X){
 const R=[],ok=(name,c,info)=>R.push({name,ok:!!c,info});
 const clearZ=X.FOOT_BOX.z+X.BALL_R+X.AIC.clearMargin;
 const order=(ph)=>{const want=['side','lift','over','pin','drop'];let k=-1;for(const p of ph){const j=want.indexOf(p);if(j<k)return false;k=j;}return true;};
 // ---- the sequence, ball beside a man ------------------------------------------------------------------
 {X.KICKS.length=0;const r=mkRod(X,{offset:0});const b=mkBall(X,-1.5,1.0);const o=run(X,r,b);
  ok('a man on the ball steps clear, lifts, slides over, pins, then plays the pin shot (phases in order)',o.phases.join('>')==='side>lift>over>pin','phases='+o.phases.join('>'));
  const firstLift=o.tr.findIndex(t=>t.raise);
  ok('the boot is never raised while a man still overlaps the ball lane',o.tr.slice(0,Math.max(0,firstLift)).every(t=>t.ph==='side'||!t.raise)&&firstLift>0&&
   Math.abs(o.tr[firstLift].off+r.baseZ[0]-b.m.position.z)>=clearZ,'first lift at dz='+(firstLift>0?Math.abs(o.tr[firstLift].off-b.m.position.z).toFixed(2):'-'));
  ok('the slide to the ball starts only after the boot is over it',(()=>{const i=o.tr.findIndex(t=>t.ph==='over');return i>=0&&o.tr[i].ang<-0.5;})());   // a ball 1.5 behind is passed at ~-0.75: the boot is then behind it and every contact faces forward
  ok('a pin takes and exactly one pin shot is played',X.KICKS.length===1&&X.KICKS[0]==='pinShot','kicks='+X.KICKS.join(','));
  ok('the action winds up clean: act cleared, pin flags down',r.act===null&&!r.pinOn&&!r.pinPose&&r.pinA===null&&r.retCd>0);}
 // ---- direction ----------------------------------------------------------------------------------------------
 {const r=mkRod(X,{offset:3});const b=mkBall(X,-1.5,1.0);X.retrieveStep(r,{m:b.m,v:b.v,real:b,scored:false},{cd:1});
  ok('the man on the ball (at +z of it) steps away to +z, not through it',r.retDir===1&&r.target>r.offset,'retDir='+r.retDir+' tgt='+r.target);}
 {const r=mkRod(X,{offset:-3});const b=mkBall(X,-1.5,-1.0);X.retrieveStep(r,{m:b.m,v:b.v,real:b,scored:false},{cd:1});
  ok('…and at -z of it, to -z',r.retDir===-1&&r.target<r.offset,'retDir='+r.retDir+' tgt='+r.target);}
 {const r=mkRod(X,{offset:9.9,baseZ:[0]});const b=mkBall(X,-1.5,8.0);X.retrieveStep(r,{m:b.m,v:b.v,real:b,scored:false},{cd:1});
  ok('pinned at his slide limit with the only way clear THROUGH a close ball: give up rather than push past it',r.act===null&&r.retCd>=X.AIC.retrieve.cd*2-1e-9,'act='+r.act);}
 {const r=mkRod(X,{offset:9.9,baseZ:[0]});const b=mkBall(X,-4.5,8.0);X.retrieveStep(r,{m:b.m,v:b.v,real:b,scored:false},{cd:1});
  ok('…but a ball beyond the reach of a passing boot may be crossed',r.act==='retrieve'&&r.retDir===-1,'act='+r.act+' retDir='+r.retDir);}
 // ---- the pin --------------------------------------------------------------------------------------------------
 {const r=mkRod(X,{offset:0});const b=mkBall(X,-3,0);const o=run(X,r,b);
  const pinning=o.tr.filter(t=>t.ph==='pin'&&t.pose&&!t.pinB);
  ok('the pin pose LEADS the boot by no more than pinLead on the way down (the catch stays armed)',pinning.length>3&&pinning.every(t=>Math.abs(t.pinA-t.ang)<=X.AIC.retrieve.pinLead+0.011),'max lead='+Math.max(...pinning.map(t=>Math.abs(t.pinA-t.ang))).toFixed(3));}
 {X.KICKS.length=0;const r=mkRod(X,{offset:0,role:'GK'});const b=mkBall(X,-3,0);const o=run(X,r,b);
  const held=o.tr.filter(t=>t.pinB).length;
  ok('a caught ball is held for settleT before the keeper plays it',held*(1/X.SIM.hz)>=X.AIC.retrieve.settleT-0.02,'held='+(held/X.SIM.hz).toFixed(2)+'s');}
 {X.KICKS.length=0;X.setStrike(false);const r=mkRod(X,{offset:0});const b=mkBall(X,-3,0);const o=run(X,r,b,{T:4});X.setStrike(true);
  ok('when the strike gate refuses the pin shot, the drop plays the shot swung from the lift',X.KICKS.join()==='shoot'&&o.phases.includes('drop'),'kicks='+X.KICKS.join()+' phases='+o.phases.join('>'));}
 {X.KICKS.length=0;const r=mkRod(X,{offset:0});const b=mkBall(X,-3,0);const o=run(X,r,b,{takePin:false,T:5});
  ok('a pin that never takes falls back to the drop (pinT), which swings the shot',o.phases.join('>').endsWith('pin>drop')&&X.KICKS.join()==='shoot','phases='+o.phases.join('>')+' kicks='+X.KICKS.join());
  const lastPose=o.tr.findLast(t=>t.ph==='pin');
  ok('the sole stops at the pin geometry while waiting for the ball to take',
     !!lastPose&&X.footUnder({...r,angle:lastPose.ang},b.m.position,r.baseZ[0]+lastPose.off));}
 {X.KICKS.length=0;const n0=X.starts(),h0=X.CAS.retHold;const r=mkRod(X,{offset:0,role:'MID',aiIQ:false});const b=mkBall(X,-3,0);const o=run(X,r,b);
  ok('an outfield rod pins even when its IQ roll fails, and hands the held ball to the catch\'s hold (no swing from retrieve)',o.tr.some(t=>t.pinB)&&r.act==='catch'&&r.catPh==='hold'&&r.pinB===b&&X.KICKS.length===0,'act='+r.act+' ph='+r.catPh+' kicks='+X.KICKS.join());
  ok('...the hold starts (pinPlayStart) and is counted, and retrieve is wound up with its lockout',X.starts()===n0+1&&X.CAS.retHold===h0+1&&r.retPh===null&&r.retMan===-1&&r.retCd===X.AIC.retrieve.cd&&r.catMan===0);}
 {X.KICKS.length=0;const r=mkRod(X,{offset:0,role:'ATT'});const b=mkBall(X,-3,0);run(X,r,b,{T:6});
  ok('an outfield retrieve never lets go of a pinned ball, lane shut or not: the catch holds it',r.act==='catch'&&r.pinB===b);}
 {const r=mkRod(X,{offset:0,role:'GK',aiIQ:false});const b=mkBall(X,-3,0);const o=run(X,r,b);
  ok('…except the keeper, who always tries to pin',o.phases.includes('pin'),'phases='+o.phases.join('>'));}
 {const r=mkRod(X,{offset:0,retPh:'over',angle:X.KICK.raiseA,slideV:X.AIC.retrieve.slideV+1});const b=mkBall(X,-3,0);
  const best={m:b.m,real:b,v:b.v};X.retrieveStep(r,best,{cd:1});
  ok('the boot stays up while the rod slides across the ball',r.retPh==='over'&&r.raise&&!r.pinOn);
  r.slideV=0;X.retrieveStep(r,best,{cd:1});
  ok('the rod starts the pin once it has settled over the ball',r.retPh==='pin'&&r.pinOn&&!r.raise);}
 {X.KICKS.length=0;const r=mkRod(X,{offset:0});const b=mkBall(X,X.SHOT.pin.back-0.1,0);const o=run(X,r,b);
  ok('beyond pin reach, the open lane still has the drop: the shot from the lift',!o.phases.includes('pin')&&X.KICKS.join()==='shoot','phases='+o.phases.join('>')+' kicks='+X.KICKS.join());}
 {X.KICKS.length=0;X.setShut(true);
  const r=mkRod(X,{offset:0});const b=mkBall(X,-3,0);const o=run(X,r,b,{takePin:false});
  X.setShut(false);
  const retreat=o.tr.filter(t=>t.ph==='clear');
  ok('a failed pin with the lane shut lifts and slides clear without a swing',
     retreat.length>0&&retreat.every(t=>t.raise&&!t.pinB)&&Math.abs(r.offset-b.m.position.z)>=clearZ&&r.act===null&&X.KICKS.length===0,'phases='+o.phases.join('>'));}
 {X.KICKS.length=0;X.setStrike(false);X.setShut(true);
  const r=mkRod(X,{offset:0});const b=mkBall(X,-3,0);const o=run(X,r,b,{T:3});
  X.setStrike(true);X.setShut(false);
  ok('a refused shot holds its pin when the straight lane is blocked',r.pinB===b&&!o.phases.includes('drop')&&X.KICKS.length===0,'phases='+o.phases.join('>'));}
 {X.KICKS.length=0;const sv={launch:{slide:0},ev:{best:{clr:9}}};X.setShot(null);
  const r=mkRod(X,{offset:0});const b=mkBall(X,-3,0);const o=run(X,r,b,{takePin:false,T:6});X.setShot(sv);
  const drop=o.tr.filter(t=>t.ph==='drop').slice(1);
  ok('a drop with no shot its swing reaches holds the lift (no leg lowered through the ball), then steps clear',
     drop.length>3&&drop.every(t=>t.raise)&&o.phases.join('>').endsWith('drop>clear')&&X.KICKS.length===0,'phases='+o.phases.join('>')+' kicks='+X.KICKS.join());}
 {X.KICKS.length=0;const sv={launch:{slide:0},ev:{best:{clr:9}}};X.setShot({launch:{slide:0},ev:{best:{clr:-1}}});
  const r=mkRod(X,{offset:0});const b=mkBall(X,-3,0);const o=run(X,r,b,{takePin:false,T:6});X.setShot(sv);
  ok('...and a shot the lane gate shuts is never swung',X.KICKS.length===0&&o.phases.includes('clear'),'phases='+o.phases.join('>')+' kicks='+X.KICKS.join());}
 // ---- housekeeping ----------------------------------------------------------------------------------------------
 {const r=mkRod(X,{offset:0,baseZ:[0]});const b=mkBall(X,-1.5,2);b.m.position.z=40;X.retrieveStep(r,{m:b.m,v:b.v,real:b,scored:false},{cd:1});
  ok('a ball no man can get to (out of slide reach) ends the action',r.act===null);}
 {const r=mkRod(X,{offset:0,pinB:{}});r.pinPose=true;r.pinOn=true;r.pinA=-0.5;const b=mkBall(X,-1.5,2);b.m.position.z=40;X.retrieveStep(r,{m:b.m,v:b.v,real:b,scored:false},{cd:1});
  ok('ending releases a held pin',r.pinB===null&&!r.pinOn&&!r.pinPose&&r.pinA===null);}
 // ---- an outfield pin is the catch's from the step it takes ----
 {X.KICKS.length=0;X.setPlay(1);const r=mkRod(X,{offset:0,role:'DEF',retPh:'pin',retMan:0,retHold:1});const b=mkBall(X,-3,0);r.pinB=b;b.pinMan=0;r.pinOn=true;r.pinPose=true;r.pinA=-1;
  X.retrieveStep(r,{m:b.m,v:b.v,real:b,scored:false},{cd:1});X.setPlay(null);
  ok('a held outfield ball is not played by retrieve even when a shot is there: the hold plays it',r.act==='catch'&&r.catPh==='hold'&&X.KICKS.length===0,'kicks '+X.KICKS.join(','));}
 {X.KICKS.length=0;X.setPlay(1);const r=mkRod(X,{offset:0,retPh:'pin',retMan:0,retHold:1});const b=mkBall(X,-3,0);r.pinB=b;r.pinOn=true;r.pinPose=true;r.pinA=-1;
  X.retrieveStep(r,{m:b.m,v:b.v,real:b,scored:false},{cd:1});X.setPlay(null);
  ok('the keeper still plays its pin from retrieve',X.KICKS.length===1&&X.KICKS[0]==='pinShot'&&r.act===null,'kicks '+X.KICKS.join(','));}
 // ---- no pin reaches it: the catch's loose tap / tic-tac before the drop's shot ----
 {const RT=X.AIC.retrieve,pin0=RT.pin;RT.pin=false;X.setLoose(true);
  {X.KICKS.length=0;const r=mkRod(X,{offset:0,role:'DEF'});const b=mkBall(X,-3,0);const o=run(X,r,b);
   ok('an outfield ball no pin reaches goes to the loose tap / tic-tac from over, the leg still up, no swing',o.phases.join('>')==='side>lift>over'&&r.act==='catch'&&r.catPh==='hit'&&r.retPh===null&&X.KICKS.length===0&&r.angle<-1,'phases='+o.phases.join('>')+' act='+r.act+' ph='+r.catPh+' ang='+r.angle.toFixed(2));}
  {X.KICKS.length=0;const r=mkRod(X,{offset:0});const b=mkBall(X,-3,0);const o=run(X,r,b);
   ok('…the keeper still drops and shoots',r.act!=='catch'&&X.KICKS.join()==='shoot','phases='+o.phases.join('>')+' kicks='+X.KICKS.join());}
  X.setLoose(false);
  {X.KICKS.length=0;const r=mkRod(X,{offset:0,role:'DEF'});const b=mkBall(X,-3,0);const o=run(X,r,b);
   ok('…and with no loose play there the drop shoots as before',r.act!=='catch'&&X.KICKS.join()==='shoot','phases='+o.phases.join('>')+' kicks='+X.KICKS.join());}
  RT.pin=pin0;}
 // ---- a re-seat from a forward pin (retFl): the leg stays up while the man steps clear ----
 {const up=X.AIC.catch.recv.lift.angle;
  {const r=mkRod(X,{offset:0,retFl:true});const b=mkBall(X,-0.8,1.0);X.retrieveStep(r,{m:b.m,v:b.v,real:b,scored:false},{cd:1});
   ok('a re-seat holds the leg up and forward while the man steps clear: pin pose on at the lift angle, no ball pinned',r.retPh==='side'&&r.pinOn===true&&r.pinPose===true&&Math.abs(r.pinA-up)<1e-9,'ph='+r.retPh+' pinA='+r.pinA);}
  {const r=mkRod(X,{offset:0});const b=mkBall(X,-0.8,1.0);X.retrieveStep(r,{m:b.m,v:b.v,real:b,scored:false},{cd:1});
   ok('…an ordinary retrieve does not',r.pinOn===false&&r.pinPose===false);}
  {const r=mkRod(X,{offset:9.9,baseZ:[0],retFl:true});const b=mkBall(X,-1.5,8.0);X.retrieveStep(r,{m:b.m,v:b.v,real:b,scored:false},{cd:1});
   ok('with the leg up the way clear through a close ball is free: it crosses, not gives up',r.act==='retrieve'&&r.retDir===-1,'act='+r.act+' retDir='+r.retDir);}
  {X.KICKS.length=0;const r=mkRod(X,{offset:0,role:'ATT',retFl:true});const b=mkBall(X,-1.5,1.0);const o=run(X,r,b);
   const lift=o.tr.find(t=>t.ph==='lift');
   ok('once clear the leg is let go (the lift is the back-lift again) and the sequence goes on to the pin, held by the catch',o.phases.join('>')==='side>lift>over>pin'&&lift&&lift.pose===false&&r.retFl===false&&r.act==='catch'&&X.KICKS.length===0,'phases='+o.phases.join('>')+' retFl='+r.retFl);}
  {const r=mkRod(X,{offset:0,retFl:true,retPh:'side'});r.pinOn=true;r.pinPose=true;r.pinA=up;const b=mkBall(X,-0.8,40);X.retrieveStep(r,{m:b.m,v:b.v,real:b,scored:false},{cd:1});
   ok('ending clears the flag',r.act===null&&r.retFl===false);}
  {const mk=(know)=>{const r=mkRod(X,{offset:0,retKnow:know});const b=mkBall(X,-0.8,1.0);const far={m:{position:{x:b.m.position.x,y:b.m.position.y,z:30}},v:b.v,real:b,scored:false};X.S.time=1;X.retrieveStep(r,far,{cd:1});return r;};
   ok('right after a re-seat the rod reads the real ball, not the delayed view (which still shows it where the carry left it)',mk(1.5).act==='retrieve');
   ok('…later it reads the view',mk(0.5).act===null);X.S.time=0;}}
 return R;
}

let bad=0,total=0;
const base=suite(boot());
for(const t of base){total++;if(!t.ok){bad++;console.log('  FAIL  '+t.name+(t.info?'   ['+t.info+']':''));}}
console.log('  '+(total-bad)+' passed, '+bad+' failed');

const MUT=[
 {n:'side no longer waits for the lane to clear (lifts on the ball)',part:'guard',from:'if(inLaneZ(r,bz,cz)){\n   if(!r.retDir)',to:'if(false&&inLaneZ(r,bz,cz)){\n   if(!r.retDir)'},
 {n:'the direction is the nearest clear offset again, not AWAY from the man',part:'guard',from:',away=(nm>=0&&r.baseZ[nm]+r.offset-bz<0)?-1:1;',to:',away=(nm>=0&&r.baseZ[nm]+r.offset-bz<0)?1:-1;'},
 {n:'a pinned-at-the-limit man crosses a close ball anyway',part:'guard',from:'else if(rel<RT.crossRel||up)r.retDir=-away;',to:'else if(true)r.retDir=-away;'},
 {n:'a far ball is never crossed',part:'guard',from:'else if(rel<RT.crossRel||up)r.retDir=-away;',to:'else if(up)r.retDir=-away;'},
 {n:'the slide-in starts before the boot is over the ball',part:'guard',from:'if(backHit(r,KICK.raiseA*dir,mn.o)===null)retrievePhase(r,\'over\');',to:'if(true)retrievePhase(r,\'over\');'},
 {n:'the pin pose is set at the final angle before the leg settles',part:'guard',from:'r.pinA+=clamp(pose*dir-r.angle,-RT.pinLead,RT.pinLead);',to:'r.pinA=pose*dir;'},
 {n:'the keeper plays a caught ball at once (no settle)',part:'guard',from:'if(r.retHold>=RT.settleT&&r.cd<=0){',to:'if(r.cd<=0){'},
 {n:'no pin: straight to the drop, never the loose play',part:'guard',from:"   if(!pin&&retrieveLoose(r,best))return;",to:''},
 {n:'the keeper hands its unpinnable ball to the loose play too',part:'hand',from:"if(!AIC.catch.on||!AIC.catch.roles.includes(r.role)||",to:"if(!AIC.catch.on||"},
 {n:'the hand-off forgets the ball is retrieve\'s (asks hitLoose as an ordinary loose ball)',part:'hand',from:"!hitLoose(r,best,true)",to:"!hitLoose(r,best)"},
 {n:'a refused pin shot can never use the open drop',part:'guard',from:"if(!laneShut(r,ball))retrievePhase(r,'drop');",to:'void 0;'},
 {n:'a refused pin shot always drops, including in a shut lane',part:'guard',from:"if(!laneShut(r,ball))retrievePhase(r,'drop');",to:"retrievePhase(r,'drop');"},
 {n:'a pin that never takes hangs on instead of dropping',part:'guard',from:'if(r.retT>RT.pinT)retrievePhase(r,\'drop\');',to:'void 0;'},
 {n:'the IQ roll is required for a pin',part:'guard',from:'const pin=RT.pin&&P.on',to:"const pin=(r.aiIQ||r.role==='GK')&&RT.pin&&P.on"},
 {n:'the rod lowers at full slide speed',part:'guard',from:'Math.abs(mn.o-r.offset)<=RT.alignZ&&Math.abs(r.slideV)<=RT.slideV',to:'Math.abs(mn.o-r.offset)<=RT.alignZ'},
 {n:'the retrieve estimates the angle from the arm alone',part:'guard',from:'const pose=footAngle(rel,false,dz,p.y);',to:'const pose=Math.asin(clamp(rel/ARM,-0.95,0.95));'},
 {n:'a shut lane still allows the drop',part:'guard',from:"if(laneShut(r,ball)){",to:'if(false){'},
 {n:'the drop lowers the leg through the ball again',part:'guard',from:'r.raise=true;r.target=mn.o;',to:'r.raise=false;r.target=mn.o;'},
 {n:'the drop never swings',part:'guard',from:"plannedKick(r,'shoot',null,shot.launch,shot.ev);",to:''},
 {n:'the drop shoots into a shut lane',part:'guard',from:'if(!shot||shot.ev.best.clr<laneMin(r)){',to:'if(!shot){'},
 {n:'an outfield pin stays in retrieve (the old loop)',part:'guard',from:'if(AIC.catch.on&&AIC.catch.roles.includes(r.role)){retrieveHold(r);return;}',to:''},
 {n:'the keeper hands its pin to the catch too',part:'guard',from:'if(AIC.catch.on&&AIC.catch.roles.includes(r.role)){retrieveHold(r);return;}',to:'if(AIC.catch.on){retrieveHold(r);return;}'},
 {n:'the hand-over leaves the rod in retrieve',part:'hand',from:"r.act='catch';r.actT=0;r.retPh=null;",to:'r.actT=0;r.retPh=null;'},
 {n:'the hand-over starts no hold',part:'hand',from:'CAS.pin++;\n pinPlayStart(r);',to:'CAS.pin++;'},
 {n:'the hand-over sets no retrieve lockout',part:'hand',from:'r.retZ=null;r.retCd=AIC.retrieve.cd;',to:'r.retZ=null;'},
 {n:'the hand-over is not counted',part:'hand',from:'BGS.retPin++;CAS.retHold++;',to:'BGS.retPin++;'},
 {n:'the hand-over is not a hold',part:'hand',from:"r.catPh='hold';r.catT=0;",to:"r.catPh='tap';r.catT=0;"},
 {n:'an unreachable ball no longer ends the action',part:'guard',from:'if(!mn){retrieveEnd(r,RT.cd);return;}',to:'if(!mn){return;}'},
 {n:'ending leaves the pin held',part:'guard',from:' if(r.pinB)pinRelease(r);\n r.pinOn=false;r.pinPose=false;r.pinA=null;r.pinFwd=false;\n r.act=null;',to:' r.pinOn=false;r.pinPose=false;r.pinA=null;r.pinFwd=false;\n r.act=null;'},
 {n:'ending leaves the pin flags up',part:'guard',from:' r.pinOn=false;r.pinPose=false;r.pinA=null;r.pinFwd=false;\n r.act=null;',to:' r.act=null;'},
 {n:'the re-seat does not hold the leg up',part:'guard',from:'if(up){r.pinOn=true;r.pinPose=true;r.pinA=AIC.catch.recv.lift.angle*dir;}',to:''},
 {n:'…it holds it at the wrong angle',part:'guard',from:'r.pinA=AIC.catch.recv.lift.angle*dir;}',to:'r.pinA=-AIC.catch.recv.lift.angle*dir;}'},
 {n:'every retrieve holds the leg up',part:'guard',from:'const up=r.retFl;',to:'const up=true;'},
 {n:'the leg is not let go once the man is clear',part:'guard',from:'r.retFl=false;r.pinOn=false;r.pinPose=false;r.pinA=null;\n  retrievePhase(r,\'lift\');',to:'retrievePhase(r,\'lift\');'},
 {n:'ending leaves the re-seat flag up',part:'guard',from:'r.retCd=cd||0;r.retFl=false;',to:'r.retCd=cd||0;'},
 {n:'the retrieve always reads the delayed view',part:'guard',from:'p=(live?ball:best).m.position',to:'p=best.m.position'},
 {n:'the retrieve always reads the real ball',part:'guard',from:'p=(live?ball:best).m.position',to:'p=ball.m.position'}
];
let missed=0;
for(const m of MUT){
 let caught=false,detail='';
 try{const res=suite(boot(m));caught=res.some(t=>!t.ok);if(caught)detail=res.filter(t=>!t.ok).length+' assertions';}
 catch(e){detail='THREW '+e.message;missed++;}
 if(!caught&&!detail.startsWith('THREW')){missed++;detail='NOT CAUGHT';}
 console.log('  '+(caught?'caught ':'MISSED ')+' ('+(detail||'-')+')  '+m.n);
}
console.log('  mutations caught: '+(MUT.length-missed)+'/'+MUT.length);
process.exit(bad||missed?1:0);
