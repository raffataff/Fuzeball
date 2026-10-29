'use strict';
// ================= skill trials harness =================
// boots core + config + rng + state + trials.js in one vm against stubs for the sandbox (training.js, balls, audio, DOM) and asserts the objective evaluator and the trial data itself (an unwinnable trial fails as 'I couldn't do it', not an error)
// the drills (goal.kind 'drill') are driven here by setting the ball and the rod by hand; whether a person can do them is tools/trials-soak.js (a bot on the real sim)
// Run: node tools/trials-harness.js
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.join(__dirname,'..');
// CRLF is stripped at the read (js/trials.js is CRLF and a multi-line needle can never match one; see the rng-harness entry)
const rd=f=>fs.readFileSync(path.join(ROOT,f),'utf8').replace(/\r\n/g,'\n');

function boot(mutate){
 let trials=rd('js/trials.js');
 if(mutate)trials=mutate(trials);
 // state.js's freshStats reads MSTAT for terr's length — that alias comes from config.js, NOT from
 // matchstats.js, so this chain needs neither that module nor a stub for it.
 const src=rd('js/core.js')+'\n'+rd('js/config.js')+'\n'+rd('js/rng.js')
  +'\n'+rd('js/state.js')+'\n'+STUBS+'\n'+rd('js/binds.js')+'\n'+trials   // binds.js: the trial hint and the retry key read the bindings
  +'\n;globalThis.__api={CONFIG,F,PHY,TRL,TRLC,S,cfg,rods,TRN,SCREENS,'
  +'trialById,trialBest,trialMedal,trialStart,trialArm,trialReset,trialGoal,trialTick,trialFinish,'
  +'trialRestart,trialExit,trialVenueHeld,trialTableApply,trialTableRestore,renderTrials,trialOn,freshStats,trialCats,trialsIn,trialCatStat,trialCatDefault,trialCatSet,trialRowHtml,dailyBuild,dailyDate,dailyPrev,dailyStreak,dailyDone,dailyRecord,dailyOn,trialObjText,renderDaily,AIC,'
  +'trialDir,trialBetter,trialScoreText,trialServe,trialAttemptEnd,trialSpawnFor,trialServeDelay,RODRST,trialTouch,trialGo,trialHome,'
  +'DRC,SHOT,FOOT_BOX,BALL_R,drillProg,drillObjText,drillLose,drillLaneSpot,trialSets,trialSetOf,trialSetsIn,trialSetPick};';
 const sb={console:{log(){},warn(){}},Math,Date,JSON,Object,Array,String,Number,Map,Set,isFinite,
  localStorage:{getItem:()=>null,setItem(){}},addEventListener(){},setTimeout(){},
  navigator:{},
  // trialFinish reads performance.now() for WHEN the result card appears (TRL.showAt) — display
  // timing only; the medal clock is S.time and never touches this.
  performance:{now:()=>0}};
 sb.globalThis=sb;
 sb.document={getElementById:id=>EL(sb,id),createElement:()=>EL(sb,'_new'),body:{appendChild(){}}};
 vm.runInNewContext(src,sb,{filename:'trials-boot'});
 EL_SB=sb;
 return sb.__api;
}
// A DOM stub whose classList records state, so "is the result card up" is readable.
let EL_SB=null;
function globalThisEl(id){return EL(EL_SB,id);}
function EL(sb,id){
 const m=sb.__els||(sb.__els={});
 return m[id]||(m[id]={id,cls:new Set(),textContent:'',innerHTML:'',className:'',
  classList:{add(c){m[id].cls.add(c);},remove(c){m[id].cls.delete(c);},
   toggle(c,v){v?m[id].cls.add(c):m[id].cls.delete(c);},contains(c){return m[id].cls.has(c);}},
  querySelectorAll:()=>[],appendChild(){}});
}
/* Everything trials.js reaches for that lives in another module. Kept deliberately dumb — the
   point is to observe what trials.js DOES, not to re-implement the sandbox. */
const STUBS=`
var SAVES=0;
var RODDEF=[[0,'GK',-52.5,1],[0,'DEF',-37.5,2],[1,'ATT',-22.5,3],[0,'MID',-7.5,5],
            [1,'MID',7.5,5],[0,'ATT',22.5,3],[1,'DEF',37.5,2],[1,'GK',52.5,1]];
var rods=RODDEF.map(function(d,i){
 var sp=d[3]===2?CONFIG.rods.spacing.two:d[3]===3?CONFIG.rods.spacing.three:CONFIG.rods.spacing.other;
 var bz=[];for(var k=0;k<d[3];k++)bz.push((k-(d[3]-1)/2)*sp);
 var mo=(F.W-CONFIG.rods.margin-(d[3]-1)*sp)/2;if(d[1]==='GK')mo=Math.min(mo,CONFIG.rods.gkSlide);
 return{idx:i,team:d[0],role:d[1],x:d[2],men:d[3],baseZ:bz,trnHidden:false,pivot:{visible:true,position:{z:0}},
  kickDir:d[0]===0?1:-1,maxOff:mo,offset:0,target:0,kickT:-1,kickStyle:null,angle:0,pinB:null,pinFwd:false,vz:0,removedUntil:[]};});
var TRN={freeze:false,stepQ:0,ai:[false,false],score:false,deadball:false,ballType:'classic',lastSpot:null,placing:false,hidden:[]};
var LAST_BALL=null;
function trnSetRodShown(i,v){var r=rods[i];if(!r)return;r.trnHidden=!v;r.pivot.visible=v;TRN.hidden[i]=!v;}
function trnSetPlacing(v){TRN.placing=v;}
function trnSpawnBall(k,x,z){LAST_BALL={key:k,cur:{x:x,y:1.9,z:z},m:{position:{x:x,y:BALL_R,z:z}},v:{set:function(a,b,c){this.x=a;this.y=b;this.z=c;},x:0,y:0,z:0},pinR:null,mss:null};S.balls.push(LAST_BALL);TRN.lastSpot={x:x,z:z};return LAST_BALL;}
function clearBalls(){S.balls.length=0;}
var RODRST={resets:0};
function resetRodRotation(){RODRST.resets++;}
function syncBall(){}
function updateScoreUI(){}
function updateChips(){}
function hudHint(){}   // js/hud.js — the controls hint is canvas now, not a #hint node
function confetti(){}
function saveCfg(){SAVES++;}
var Au={init:function(){},ui:function(){},goal:function(){},whistle:function(){}};
var STARTED=null;
function startMatch(mode,lock){STARTED={mode:mode,lock:lock};}
var TABLE_APPLIES=0;
function applyTable(cb){TABLE_APPLIES++;if(cb)cb();}
var SCREENS={trials:{back:'training'}};
`;

/* ---- assertions ---- */
const best=(c,k)=>(c.trials&&c.trials[k])?c.trials[k].best:null;
const medal=(c,k)=>(c.trials&&c.trials[k])?c.trials[k].medal:null;
// same null-safety for the daily record: a mutant that fails to write it should FAIL named
// assertions, not throw — a throw hides which properties actually broke
const dly=(c,k)=>c.daily?c.daily[k]:null;
function Run(){this.pass=0;this.failed=[];}
Run.prototype.ok=function(c,n,d){c?this.pass++:this.failed.push(n+(d?'  ['+d+']':''));};
Run.prototype.eq=function(a,b,n){this.ok(a===b,n,'got '+JSON.stringify(a)+', want '+JSON.stringify(b));};

// distance from a ball at (bx,bz) to the nearest of a rod's resting foot boxes (mirrors collideRod's analytic box: at rest the along-leg axis points down, so footBoxOff.x lands in world Y); contact under BALL_R*footBoxReach
function footGap(r,bx,bz){
 const P=API.PHY,dir=r.team===0?1:-1;
 const footY=P.rodH-P.arm*P.footT;
 const cx=r.x+P.footBoxOff.y*dir, cy=footY-P.footBoxOff.x;
 const hx=P.footBox.y,hy=P.footBox.x,hz=P.footBox.z;
 let best=Infinity;
 for(const bzc of r.baseZ){
  const dx=Math.max(0,Math.abs(bx-cx)-hx);
  const dy=Math.max(0,Math.abs(P.ballR-cy)-hy);
  const dz=Math.max(0,Math.abs(bz-bzc)-hz);
  best=Math.min(best,Math.hypot(dx,dy,dz));
 }
 return best;
}
function footClear(r,bx,bz){return footGap(r,bx,bz)>=API.PHY.ballR*API.PHY.footBoxReach;}
// whose reach a spawn has to be inside: you (the locked rod, else every visible team-0 rod), except in a 'saveRun' where the ball is served to the opponent, so the shooting side is tested and the keeper is checked for covering the mouth
function strikers(A,d){
 const show=(d.rods&&d.rods.show)||[],t=(d.goal&&d.goal.kind==='saveRun')?1:0;
 return A.rods.filter(r=>r.team===t&&show.includes(t+'|'+r.role)&&(t===1||!d.hold||r.role===d.hold));
}
// every spawn a trial can serve: the saveRun's authored list, else its single ball
function trialSpawns(d){
 const sp=d.goal&&d.goal.kind==='saveRun'&&d.goal.spawns;
 return (sp&&sp.length)?sp:[d.ball];
}
// signed distance from the striking rod to the ball, in the direction that rod attacks
function relOf(A,d,s){
 s=s||d.ball;
 let best=Infinity;
 for(const r of strikers(A,d)){const rel=(s.x-r.x)*(r.team===0?1:-1);if(Math.abs(rel)<Math.abs(best))best=rel;}
 return best===Infinity?NaN:best;
}
function reachOK(A,d,s){
 s=s||d.ball;
 return strikers(A,d).some(r=>{
  const rel=(s.x-r.x)*(r.team===0?1:-1);
  return rel>0&&rel<=A.AIC.inFrontMax&&zReach(A,r,s.z);
 });
}
// a rod slides, so the ball's z is reachable if SOME man can be slid onto it
function zReach(A,r,bz){
 const C=A.CONFIG.rods,sp=r.men===2?C.spacing.two:r.men===3?C.spacing.three:C.spacing.other;
 let maxOff=(A.F.W-C.margin-(r.men-1)*sp)/2;
 if(r.role==='GK')maxOff=Math.min(maxOff,C.gkSlide);
 return r.baseZ.some(z=>Math.abs(bz-z)<=maxOff);
}
let API=null;

// move the MATCH rng somewhere arbitrary — the daily must not be able to notice
function rngSeedNoise(A){A.S.seed=987654321;}

// the solo seat startMatch hands a trial: every team-0 rod, opening on the MID (seats.js seatBindRods)
function soloSeat(A){const mine=A.rods.filter(r=>r.team===0).sort((a,b)=>a.x-b.x);return{team:0,rods:mine,ctrl:mine.findIndex(r=>r.role==='MID')};}
function heldRole(A){const s=A.S.seats[0],r=s&&s.rods[s.ctrl];return r?r.role:null;}
/* Put a live trial on the table without going through startMatch. */
function arm(A,id,seed){
 A.S.seats=[soloSeat(A)];
 A.TRL.pending=A.trialById(id);
 A.S.seed=(seed===undefined?A.trialById(id).seed:seed)>>>0;
 A.trialArm();
}
// play a 'saveRun' out, keeping every attempt out or conceding every one; the guard keeps a broken mutant a failed assertion rather than a hang
function drain(A,saved){
 let guard=0;
 while(!A.TRL.done&&guard++<400){
  if(A.TRL.serving){A.S.time=A.TRL.serveAt;A.trialTick();continue;}
  if(saved){A.S.stats.saves[0]++;A.trialTick();}
  else A.trialGoal(1,{mss:null});
 }
}

function suite(A){
 const R=new Run();
 const {CONFIG,F,PHY,TRLC,TRL,S,cfg,rods,TRN}=A;
 const ME={team:0},THEM={team:1};   // what physics.js hands trialTouch: the rod that touched the ball

 /* ================= A. the trial DATA ================= */
 const ids={};
 for(const d of TRLC.list){
  R.ok(!ids[d.id],'A-id "'+d.id+'" is unique');ids[d.id]=1;
  R.ok(typeof d.seed==='number'&&d.seed>0,'A-seed "'+d.id+'" declares a seed');
  R.ok(!!CONFIG.tables[d.table],'A-table "'+d.id+'" table exists','table='+d.table);
  R.ok(d.goal&&['goals','roleGoals','stat','saveRun','drill'].includes(d.goal.kind),'A-kind "'+d.id+'" objective kind is supported',
   'kind='+(d.goal&&d.goal.kind));
  // a 'stat' objective names a match ledger counter; check it against a real freshStats(), not a hand-kept list
  if(d.goal.kind==='stat'){
   const led=A.freshStats(),arr=led[d.goal.stat];
   R.ok(Array.isArray(arr)&&arr.length===2,'A-stat "'+d.id+'" "'+d.goal.stat+'" is a real per-team ledger counter');
   R.ok(d.goal.n>0,'A-stat "'+d.id+'" needs a positive target');
  }
  // a live opponent must pin its difficulty, or teamDiff falls through to cfg.diffRed/diffBlue and medal times aren't comparable
  if(d.ai&&d.ai.some(Boolean))
   R.ok(!!d.diff,'A-diff "'+d.id+'" pins a difficulty because it enables an AI');
  // medals are ordered in the trial's own direction (saveRun: higher is better); read through trialDir so check and runner agree
  const m=d.medals||{},up=A.trialDir(d)>0;
  R.ok(up?(m.gold>m.silver&&m.silver>m.bronze):(m.gold<m.silver&&m.silver<m.bronze),
   'A-medal "'+d.id+'" thresholds run in the trial\'s own scoring direction',JSON.stringify(m)+' up='+up);
  // a bronze you cannot reach inside the limit is an unwinnable medal
  if(d.limit>0)R.ok(m.bronze<=d.limit,'A-limit "'+d.id+'" bronze is inside the time limit',
   'bronze='+m.bronze+' limit='+d.limit);
  /* EVERY spawn, not just `ball`: a saveRun serves a different one per attempt, and one bad entry
     in the middle of that list is an attempt nobody can win with nothing on screen saying why. */
  const SPW=trialSpawns(d);
  for(const s of SPW)
   R.ok(Math.abs(s.x)<F.L/2&&Math.abs(s.z)<F.W/2,'A-ball "'+d.id+'" spawn '+s.x+'/'+s.z+' is inside the walls');
  // a trial must not spawn the ball inside a visible foot (the shipped SNAP SHOT did: collideRod fired on sim step one and started the old lastTouch clock); computed from live CONFIG so retuning fails here
  for(const s of SPW)for(const r of rods){
   if(!(d.rods&&d.rods.show||[]).includes(r.team+'|'+r.role))continue;   // hidden rods can't touch it
   R.ok(footClear(r,s.x,s.z),'A-spawn "'+d.id+'" spawn '+s.x+'/'+s.z+' is clear of the '+r.team+'|'+r.role+' foot box',
    'gap '+footGap(r,s.x,s.z).toFixed(2)+' < BALL_R '+PHY.ballR);
  }
  // ...and it must be within reach of a rod you control: too close is inside the boot, too far can't be reached; CONFIG.ai.inFrontMax is the config-derived stand-in for a human's reach
  if(d.goal.kind==='drill')drillData(A,R,d);
  else for(const s of SPW)
   R.ok(reachOK(A,d,s),'A-reach "'+d.id+'" spawn '+s.x+'/'+s.z+' is inside a striking rod\'s window',
    'rel='+relOf(A,d,s).toFixed(2)+' max='+A.AIC.inFrontMax);
  const show=d.rods&&d.rods.show;
  R.ok(!!show&&show.length>0,'A-rods "'+d.id+'" declares which rods are on the table');
  // a 'saveRun' is only playable if the keeper is on the table, something can shoot at it, and the run can end
  if(d.goal.kind==='saveRun'){
   R.ok(d.goal.n>0,'A-save "'+d.id+'" needs a positive attempt count');
   R.ok(d.goal.attemptT>0,'A-save "'+d.id+'" declares an attempt failsafe, or a stall hangs the run');
   R.ok(!d.limit,'A-save "'+d.id+'" carries no time limit — it ends on attempts, not on a clock');
   R.ok((d.medals||{}).gold<=d.goal.n,'A-save "'+d.id+'" gold is reachable inside n attempts',
    'gold='+(d.medals||{}).gold+' n='+d.goal.n);
   R.ok((show||[]).indexOf('0|GK')>=0,'A-save "'+d.id+'" your keeper is on the table');
   R.ok(!!(d.ai&&d.ai[1]),'A-save "'+d.id+'" the opponent AI is on, or nothing ever shoots');
   // ...and the keeper must be able to cover the mouth: gkSlide (11) vs goalHalf (11) reaches both posts exactly; fails loudly if either is retuned alone
   R.ok(CONFIG.rods.gkSlide+PHY.footBox.z+PHY.ballR>=F.goalHalf,
    'A-save "'+d.id+'" the keeper can reach both posts',
    'slide '+CONFIG.rods.gkSlide+' + foot '+(PHY.footBox.z+PHY.ballR).toFixed(2)+' vs goalHalf '+F.goalHalf);
  }
  // every rod key names a real rod
  for(const k of show)R.ok(rods.some(r=>r.team+'|'+r.role===k),'A-rodkey "'+d.id+'" "'+k+'" is a real rod');
  // a locked role must be a rod you can actually see
  if(d.hold)R.ok(show.indexOf('0|'+d.hold)>=0,'A-hold "'+d.id+'" locked role is on the table');
  // AN OBJECTIVE MUST BE PHYSICALLY POSSIBLE. Two things can make it not:
  if(d.goal.kind==='roleGoals')for(const role of d.goal.roles){
   R.ok(show.indexOf('0|'+role)>=0,'A-role "'+d.id+'" must-score role '+role+' is on the table');
   // ...and the rod must be able to reach the goal at all. Floor friction is exp(-floorFric*t),
   // so max roll is v0/floorFric; an ORDINARY (not sweet) contact is ~44 u/s.
   const rod=rods.find(r=>r.team===0&&r.role===role);
   const dist=(F.L/2)-rod.x,max=44/PHY.floorFric;
   R.ok(dist<=max,'A-reach "'+d.id+'" '+role+' can reach the goal','need '+dist.toFixed(1)+' max '+max.toFixed(1));
  }
 }
 R.ok(A.trialOn(),'A-on trials are enabled and the list is non-empty');
 R.eq(A.trialById('nope'),null,'A-lookup unknown id returns null');

 /* ================= B. medals ================= */
 const d0={medals:{gold:2,silver:3.5,bronze:6}};
 R.eq(A.trialMedal(d0,1.9),'gold','B1 under gold');
 R.eq(A.trialMedal(d0,2),'gold','B2 exactly gold counts');
 R.eq(A.trialMedal(d0,2.01),'silver','B3 just over gold');
 R.eq(A.trialMedal(d0,3.5),'silver','B4 exactly silver counts');
 R.eq(A.trialMedal(d0,6),'bronze','B5 exactly bronze counts');
 R.eq(A.trialMedal(d0,6.01),null,'B6 past bronze earns nothing');
 R.eq(A.trialMedal({},1),null,'B7 a trial with no medals block');
 /* THE SECOND SCORING DIRECTION. A saveRun's metric is SAVES and more is better, so the same
    block is read the other way up — one comparator flip carrying medals, bests, list and HUD. */
 const dS={goal:{kind:'saveRun',n:10},medals:{gold:8,silver:6,bronze:4}};
 R.eq(A.trialMedal(dS,9),'gold','B8 a saveRun reads its thresholds upward');
 R.eq(A.trialMedal(dS,8),'gold','B9 exactly gold counts');
 R.eq(A.trialMedal(dS,7),'silver','B10 just under gold');
 R.eq(A.trialMedal(dS,4),'bronze','B11 exactly bronze counts');
 R.eq(A.trialMedal(dS,3),null,'B12 under bronze earns nothing');
 R.eq(A.trialDir(dS),1,'B13 a saveRun is higher-is-better');
 R.eq(A.trialDir(d0),-1,'B14 every other kind is lower-is-better');
 R.eq(A.trialBetter(dS,9,8),true,'B15 more saves beats fewer');
 R.eq(A.trialBetter(dS,7,8),false,'B16 ...and fewer does not');
 R.eq(A.trialBetter(d0,1,2),true,'B17 fewer seconds beats more');
 R.eq(A.trialScoreText(dS,7),'7 / 10 saved','B18 a saveRun best reads as a count');
 R.eq(A.trialScoreText(d0,1.5),'1.50s','B19 ...and everything else as seconds');

 /* ================= C. setup application ================= */
 cfg.table='classic';
 arm(A,'snap');
 R.ok(!!S.trial,'C1 S.trial is the live gate');
 R.eq(TRN.ai[0],false,'C2 AI off, team 0');R.eq(TRN.ai[1],false,'C3 AI off, team 1');
 R.eq(TRN.freeze,false,'C4 sandbox freeze cleared on entry');
 const vis=rods.filter(r=>!r.trnHidden).map(r=>r.team+'|'+r.role);
 R.ok(vis.length===1&&vis[0]==='0|ATT','C5 only the declared rod is on the table','['+vis+']');
 R.eq(TRN.lastSpot.x,A.trialById('snap').ball.x,'C6 ball spawned at the trial spawn');
 R.eq(S.phase,'play','C7 phase is play');
 R.eq(S.lastTouch,-1,'C8 lastTouch cleared so the clock cannot pre-start');
 R.ok(!!S.stats,'C9 the ledger is fresh');
 // every attempt opens with the rod the ball lies in front of in hand, whatever the seat held before
 for(const [id,role] of [['snap','ATT'],['distro','GK'],['onetwo','MID'],['fullset','DEF'],['longball','DEF'],['lastline','GK'],['aTtLane','ATT'],['mPlace','MID'],['dBackPin','DEF']]){
  arm(A,id);R.eq(heldRole(A),role,'C10 "'+id+'" opens on the '+role);
 }
 arm(A,'snap');

 /* ================= D. the clock ================= */
 // one rule for every kind: your side's first TOUCH of the ball (physics.js calls trialTouch at a contact or a pin catch, whatever the device or the verb), stamped at that sim step; a saveRun starts on its first serve (SR7)
 S.time=100;A.trialTick();
 R.eq(TRL.run,false,'D1 clock does not run before you play the ball');
 R.eq(TRL.secs,0,'D2 elapsed stays 0');
 // the old rule polled the swing count, so a ball moved by a pin, a stroke, a side tap or the pad's stick finished at 0.00s
 S.stats.kicks[0]=1;S.lastTouch=0;A.trialTick();
 R.eq(TRL.run,false,'D3 a swing that never meets the ball does not start it');
 R.eq(TRL.secs,0,'D4 ...and banks no time');
 S.time=100.25;A.trialTouch(THEM);A.trialTick();
 R.eq(TRL.run,false,'D5 an opponent touch does not start your clock');
 S.time=100.5;A.trialTouch(ME);
 R.eq(TRL.run,true,'D6 your first touch starts it');
 R.eq(TRL.t0,100.5,'D7 ...stamped at the touch, not at the next frame');
 S.time=101;A.trialTouch(ME);
 R.eq(TRL.t0,100.5,'D8 a later touch does not restart it');
 S.time=104;A.trialTick();
 R.ok(Math.abs(TRL.secs-3.5)<1e-9,'D9 elapsed is SIM time since the touch','secs='+TRL.secs);
 // a touch and a goal inside one frame (no trialTick between them) still time the run
 cfg.trials=null;
 arm(A,'snap');S.time=0;A.trialTick();S.time=2;A.trialTouch(ME);S.time=2.4;A.trialGoal(0,{mss:null});
 R.ok(Math.abs(TRL.secs-0.4)<1e-9,'D10 a touch and a goal in one frame time the run','secs='+TRL.secs);
 R.eq(best(cfg,'snap'),0.4,'D11 ...and bank that time');
 S.time=5;A.trialTouch(ME);
 R.eq(TRL.t0,2,'D12 a touch after the result changes nothing');
 cfg.trials=null;
 // the hook sites: both contact passes of collideRod and the pin catch (physics.js)
 const phy=rd('js/physics.js'),pinFn=phy.slice(phy.indexOf('function pinUpdate('),phy.indexOf('function footBoxD('));
 R.eq((phy.match(/S\.lastTouch=r\.team;[^\n]*\n\s*if\(S\.trial\)trialTouch\(r\);/g)||[]).length,2,'D13 both contact passes of collideRod hand the touch to the clock');
 R.ok(/b\.pinR=r;[^]*if\(S\.trial\)trialTouch\(r\);[^]*break;/.test(pinFn),'D14 ...and so does the pin catch');
 // put SNAP SHOT back, running, for the goals series below
 arm(A,'snap');S.time=0;A.trialTouch(ME);A.trialTick();S.time=3.5;A.trialTick();

 /* ================= E. objective: goals ================= */
 R.eq(TRL.done,false,'E1 not done yet');
 A.trialGoal(1,{mss:null});                       // conceding
 R.eq(TRL.done,false,'E2 a goal at YOUR end never completes a trial');
 R.eq(TRL.goals,0,'E3 ...and does not count');
 A.trialGoal(0,{mss:null});
 R.eq(TRL.done,true,'E4 one goal completes a 1-goal trial');
 R.eq(TRL.ok,true,'E5 marked complete');
 R.eq(TRN.freeze,true,'E6 the world is held on the result');
 const at=TRL.secs;
 A.trialGoal(0,{mss:null});
 R.eq(TRL.secs,at,'E7 a goal after the result does not re-finish it');

 // multi-goal
 arm(A,'keeper');S.time=0;A.trialTouch(ME);A.trialTick();
 S.time=5;A.trialTick();A.trialGoal(0,{mss:null});
 R.eq(TRL.done,false,'E8 1 of 3 does not complete');
 A.trialGoal(0,{mss:null});A.trialGoal(0,{mss:null});
 R.eq(TRL.done,true,'E9 3 of 3 completes');

 /* ================= F. objective: roleGoals ================= */
 arm(A,'fullset');S.time=0;A.trialTouch(ME);A.trialTick();
 R.eq(TRL.roles.length,3,'F1 three roles outstanding');
 A.trialGoal(0,{mss:{role:'MID'}});
 R.eq(TRL.roles.length,2,'F2 a MID goal clears MID');
 A.trialGoal(0,{mss:{role:'MID'}});
 R.eq(TRL.roles.length,2,'F3 a SECOND MID goal clears nothing');
 R.eq(TRL.done,false,'F4 ...and does not complete the trial');
 A.trialGoal(0,{mss:{role:'GK'}});
 R.eq(TRL.roles.length,2,'F5 a role the trial did not ask for clears nothing');
 A.trialGoal(0,{mss:null});
 R.eq(TRL.roles.length,2,'F6 a goal with no swing record clears nothing');
 A.trialGoal(0,{mss:{role:'DEF'}});A.trialGoal(0,{mss:{role:'ATT'}});
 R.eq(TRL.done,true,'F7 all three roles completes');
 R.eq(TRL.ok,true,'F8 marked complete');

 /* ================= G. the time limit ================= */
 arm(A,'keeper');S.time=0;A.trialTouch(ME);A.trialTick();
 S.time=39.9;A.trialTick();
 R.eq(TRL.done,false,'G1 inside the limit');
 S.time=40.0;A.trialTick();
 R.eq(TRL.done,true,'G2 the limit fires');
 R.eq(TRL.ok,false,'G3 ...as a FAILURE');
 R.eq(TRL.secs,40,'G4 elapsed is clamped to the limit');
 R.eq(TRL.medal,null,'G5 a failure earns no medal');
 // a stopwatch trial has no failure state
 arm(A,'snap');S.time=0;A.trialTouch(ME);A.trialTick();S.time=9999;A.trialTick();
 R.eq(TRL.done,false,'G6 limit 0 never times out');

 /* ================= H. personal bests ================= */
 cfg.trials=null;
 arm(A,'snap');S.time=0;A.trialTouch(ME);A.trialTick();S.time=1.5;A.trialTick();
 A.trialGoal(0,{mss:null});
 R.ok(!!cfg.trials&&!!cfg.trials.snap,'H1 a completion writes a best');
 R.eq(best(cfg,'snap'),1.5,'H2 the best is the elapsed time');
 R.eq(medal(cfg,'snap'),'gold','H3 ...with its medal');
 R.eq(TRL.pb,true,'H4 flagged as a new best');
 // slower run must NOT overwrite
 arm(A,'snap');S.time=0;A.trialTouch(ME);A.trialTick();S.time=5;A.trialTick();
 A.trialGoal(0,{mss:null});
 R.eq(best(cfg,'snap'),1.5,'H5 a SLOWER run does not overwrite the best');
 R.eq(TRL.pb,false,'H6 ...and is not flagged as one');
 // faster run must
 arm(A,'snap');S.time=0;A.trialTouch(ME);A.trialTick();S.time=1.1;A.trialTick();
 A.trialGoal(0,{mss:null});
 R.eq(best(cfg,'snap'),1.1,'H7 a faster run does overwrite');
 // a run that completes before your side ever touched the ball (nothing in the game should allow it) is timed from the setup: never a 0.00s record nothing can beat
 const keepBest=cfg.trials;cfg.trials=null;
 S.time=10;arm(A,'snap');S.time=14;A.trialTick();
 R.eq(TRL.run,false,'H9 the clock never started');
 A.trialGoal(0,{mss:null});
 R.eq(TRL.done,true,'H10 it still completes');
 R.ok(Math.abs(TRL.secs-4)<1e-9,'H11 ...timed from the setup, not 0.00s','secs='+TRL.secs);
 R.eq(best(cfg,'snap'),4,'H12 ...and that is the record it banks');
 R.eq(TRL.medal,'bronze','H13 ...with the medal that time earns');
 cfg.trials=keepBest;
 // a FAILED run must never write one
 const before=JSON.stringify(cfg.trials);
 arm(A,'keeper');S.time=0;A.trialTouch(ME);A.trialTick();S.time=40;A.trialTick();
 R.eq(JSON.stringify(cfg.trials),before,'H8 a failed run writes no best');

 /* ================= O. the objective sentence ================= */
 // Shared by the daily panel and the trials list, so the two can never describe one trial
 // differently. Every SHIPPED trial must produce a non-empty line, or a row renders blank.
 R.eq(A.trialObjText({goal:{kind:'goals',n:3}}),'Score 3','O1 goals');
 R.eq(A.trialObjText({goal:{kind:'goals'}}),'Score 1','O2 goals defaults to 1');
 R.eq(A.trialObjText({goal:{kind:'roleGoals',roles:['DEF','MID']}}),'Score with DEF &middot; MID','O3 roleGoals');
 R.eq(A.trialObjText({goal:{kind:'stat',stat:'woodwork',n:3}}),'3 &times; WOODWORK','O4 stat, known label');
 R.eq(A.trialObjText({goal:{kind:'stat',stat:'onTarget',n:2}}),'2 &times; ON TARGET','O5 stat, multi-word label');
 R.eq(A.trialObjText({goal:{kind:'stat',stat:'zzz',n:1}}),'1 &times; ZZZ','O6 stat with no label falls back to the key');
 for(const d of TRLC.list)
  R.ok(!!A.trialObjText(d),'O7 "'+d.id+'" renders an objective line');
 R.ok(!!A.trialObjText(A.dailyBuild('2026-07-04')),'O8 a daily renders one too');

 // ================= Q. the discipline sections =================
 // #trials is browsed by discipline (CONFIG.trials.cats); a section is a filter, so the failure worth catching is a trial in no section (it just never appears); the coverage check runs both ways
 const CATS=A.trialCats();
 R.ok(CATS.length>0,'Q1 the discipline registry is populated');
 const cids={};
 for(const c of CATS){
  R.ok(!cids[c.id],'Q2 cat id "'+c.id+'" is unique');cids[c.id]=1;
  R.ok(!!c.name,'Q3 cat "'+c.id+'" has a section name');
  R.ok(!!c.sub,'Q4 cat "'+c.id+'" has a sub-line');
 }
 // EVERY TRIAL IS REACHABLE. A cat typo hides a trial from the whole game in silence.
 for(const d of TRLC.list)
  R.ok(!!cids[d.cat],'Q5 "'+d.id+'" is filed under a real discipline','cat='+d.cat);
 // ...and nothing is listed twice or lost: the sections must partition the list exactly.
 let tot=0;for(const c of CATS)tot+=A.trialsIn(c.id).length;
 R.eq(tot,TRLC.list.length,'Q6 the sections partition the list exactly');
 // section order follows LIST order, which is what makes a section's difficulty curve authorable
 const att=A.trialsIn('ATT').map(d=>d.id);
 R.eq(att.join(','),TRLC.list.filter(d=>d.cat==='ATT').map(d=>d.id).join(','),
  'Q7 a section keeps the list order');
 R.eq(A.trialsIn('nope').length,0,'Q8 an unknown discipline is empty, not everything');
 // the five the player was promised, named explicitly (a loop over `cats` couldn't notice one being deleted)
 for(const id of ['GK','DEF','MID','ATT','TEAM']){
  R.ok(!!cids[id],'Q9 "'+id+'" is one of the sections');
  R.ok(A.trialsIn(id).length>0,'Q10 "'+id+'" has at least one trial');
 }
 /* The tallies the tab strip and the section header both read. Driven off cfg.trials, so this
    also pins that a DAILY best (which lives in cfg.daily) can never leak into a section count. */
 cfg.trials={};cfg.daily={date:A.dailyDate(),best:1,medal:'gold',streak:3};
 let st=A.trialCatStat('ATT');
 R.eq(st.n,att.length,'Q11 an untouched section counts its trials');
 R.eq(st.done,0,'Q12 ...and nothing cleared');
 R.eq(st.gold,0,'Q13 ...and a daily gold is not a section gold');
 cfg.trials[att[0]]={best:1.5,medal:'gold'};
 cfg.trials[att[1]]={best:19,medal:'silver'};
 cfg.trials[att[2]]={best:99,medal:null};
 st=A.trialCatStat('ATT');
 R.eq(st.done,3,'Q14 a cleared trial counts as done whatever the medal');
 R.eq(st.gold,1,'Q15 gold tallied');
 R.eq(st.silver,1,'Q16 silver tallied');
 R.eq(st.bronze,0,'Q17 bronze tallied');
 cfg.trials={};cfg.daily=null;
 /* The tab that opens by default must never be an EMPTY section — a player landing on a blank
    panel reads it as the feature being broken rather than as one discipline being unwritten. */
 R.ok(A.trialsIn(A.trialCatDefault()).length>0,'Q18 the default tab has trials in it');
 // proved against a section that is empty, not the shipped catalogue (the first tab has trials, so shipped data alone would pass even if the skipping were deleted)
 TRLC.cats.unshift({id:'ZZZ',name:'UNWRITTEN',sub:'nothing here'});
 R.eq(A.trialCatDefault(),'GK','Q18b an empty leading section is skipped');
 R.eq(A.trialsIn('ZZZ').length,0,'Q18c ...because it really is empty');
 TRLC.cats.shift();
 /* Launching a trial parks its section, so quitting the run comes back to the tab it came from
    rather than to the top of the list. A DAILY has no cat and must leave that alone. */
 A.trialExit();TRL.pending=null;   // earlier sections leave a trial armed; trialStart no-ops on one
 TRL.cat='TEAM';A.trialStart('snap');
 R.eq(TRL.cat,'ATT','Q19 starting a trial remembers its section');
 A.trialExit();TRL.cat='MID';A.trialStart('daily');
 R.eq(TRL.cat,'MID','Q20 the daily leaves the open section alone');
 A.trialExit();TRL.pending=null;

 /* ================= P. the daily ================= */
 R.ok(A.dailyOn(),'P1 the daily is enabled with templates');
 // PURE: the same date must build the same challenge, on any machine, whatever the match rng
 // last did. This is what makes "same setup for everyone today" true at all.
 const p1=A.dailyBuild('2026-08-21'),p2=A.dailyBuild('2026-08-21');
 R.eq(JSON.stringify(p1),JSON.stringify(p2),'P2 the same date builds an identical spec');
 A.trialById('snap');rngSeedNoise(A);
 R.eq(JSON.stringify(A.dailyBuild('2026-08-21')),JSON.stringify(p1),
  'P3 ...and is unaffected by the match rng having moved');
 R.ok(!!p1&&p1.daily===true&&p1.id==='daily','P4 it is flagged as a daily');
 R.eq(p1.date,'2026-08-21','P5 it carries its date');
 R.ok(p1.seed>0,'P6 it carries a date-derived seed');
 // consecutive days must differ — both in which template and in the exact setup
 const days=[];for(let i=1;i<=28;i++)days.push(A.dailyBuild('2026-09-'+String(i).padStart(2,'0')));
 R.ok(days.every(Boolean),'P7 28 consecutive days all build');
 R.ok(new Set(days.map(d=>d.seed)).size===28,'P8 28 distinct seeds');
 R.ok(new Set(days.map(d=>d.from)).size>1,'P9 the template varies across days',
  'saw '+new Set(days.map(d=>d.from)).size);
 R.ok(new Set(days.map(d=>d.ball.x+'|'+d.ball.z)).size>20,'P10 the spawn varies across days');
 // AUTHORED DIFFICULTY IS NOT ROLLED — see the CONFIG comment. n/limit/medals must match the
 // trial the template names, or thresholds authored for one shape score another.
 for(const d of days){
  const src=A.trialById(d.from);
  R.eq(d.goal.n,src.goal.n,'P11 '+d.from+' target not rolled');
  R.eq(d.limit,src.limit,'P12 '+d.from+' limit not rolled');
  R.eq(JSON.stringify(d.medals),JSON.stringify(src.medals),'P13 '+d.from+' medals not rolled');
 }
 // every rollable spawn must be playable: the whole band is validated, not the corners (an unplayable daily is a day the player can't win)
 for(const t of TRLC.daily.templates){
  const src=A.trialById(t.from);
  R.ok(!!src,'P14 template "'+t.from+'" names a real trial');
  if(!src)continue;
  const xs=t.ball&&t.ball.x?t.ball.x:[src.ball.x,src.ball.x];
  const zs=t.ball&&t.ball.z?t.ball.z:[src.ball.z,src.ball.z];
  let clear=true,reach=true,worstGap=Infinity,worstRel=0;
  for(let i=0;i<=12;i++)for(let j=0;j<=12;j++){
   const bx=xs[0]+(xs[1]-xs[0])*i/12, bz=zs[0]+(zs[1]-zs[0])*j/12;
   const probe=Object.assign({},src,{ball:{x:bx,z:bz}});
   for(const r of A.rods){
    if(!((src.rods&&src.rods.show)||[]).includes(r.team+'|'+r.role))continue;
    const g=footGap(r,bx,bz);
    if(g<worstGap)worstGap=g;
    if(!footClear(r,bx,bz))clear=false;
   }
   if(!reachOK(A,probe)){reach=false;worstRel=relOf(A,probe);}
  }
  R.ok(clear,'P15 "'+t.from+'" every spawn in the band clears the feet','worst gap '+worstGap.toFixed(2));
  R.ok(reach,'P16 "'+t.from+'" every spawn in the band is reachable','worst rel '+worstRel.toFixed(2));
 }

 /* ---- streak ---- */
 R.eq(A.dailyPrev('2026-03-01'),'2026-02-28','P17 previous day across a month boundary');
 R.eq(A.dailyPrev('2026-01-01'),'2025-12-31','P18 ...and across a year boundary');
 cfg.daily=null;
 R.eq(A.dailyStreak('2026-05-10'),0,'P19 no history = no streak');
 A.dailyRecord(4.0,'gold','2026-05-10');
 R.eq(dly(cfg,'streak'),1,'P20 a first completion starts a streak at 1');
 R.eq(dly(cfg,'best'),4,'P21 ...and banks the time');
 R.eq(A.dailyDone('2026-05-10'),true,'P22 today reads as done');
 A.dailyRecord(9.0,'bronze','2026-05-10');
 R.eq(dly(cfg,'best'),4,'P23 a slower retry does not overwrite');
 R.eq(dly(cfg,'streak'),1,'P24 ...and does not bump the streak');
 A.dailyRecord(2.5,'gold','2026-05-10');
 R.eq(dly(cfg,'best'),2.5,'P25 a faster retry does overwrite');
 R.eq(dly(cfg,'streak'),1,'P26 ...but still does not bump the streak');
 A.dailyRecord(3.0,'gold','2026-05-11');
 R.eq(dly(cfg,'streak'),2,'P27 the NEXT day continues the streak');
 R.eq(dly(cfg,'best'),3,'P28 ...and the best resets to that day');
 A.dailyRecord(3.0,'gold','2026-05-14');   // a gap
 R.eq(dly(cfg,'streak'),1,'P29 a missed day resets the streak to 1');
 R.eq(A.dailyStreak('2026-05-14'),1,'P30 the streak reads live on the day itself');
 R.eq(A.dailyStreak('2026-05-15'),1,'P31 ...and the day after, so it can still be continued');
 R.eq(A.dailyStreak('2026-05-16'),0,'P32 ...but reads 0 once it can no longer be continued');
 R.eq(A.dailyDone('2026-05-16'),false,'P34 a new day is not done');
 // end to end: a daily completion must land in cfg.daily and not the per-trial best map; finished through trialFinish rather than the objective, since the rolled template isn't under test
 cfg.daily=null;cfg.trials=null;
 const dsp=A.dailyBuild('2026-06-01');
 TRL.pending=dsp;S.seed=dsp.seed;A.trialArm();
 S.time=0;A.trialTouch(ME);A.trialTick();S.time=2;A.trialTick();
 A.trialFinish(true);
 R.ok(!!cfg.daily&&cfg.daily.date==='2026-06-01','P35 a daily completion writes cfg.daily');
 R.ok(!cfg.trials||!cfg.trials.daily,'P36 ...and NOT the per-trial best map');
 R.eq(dly(cfg,'best'),2,'P37 ...with the elapsed sim time');
 R.eq(dly(cfg,'streak'),1,'P38 ...and starts the streak');
 A.trialExit();
 cfg.daily=null;cfg.trials=null;

 /* ================= M. the 'stat' objective ================= */
 arm(A,'frame');S.time=0;A.trialTouch(ME);A.trialTick();
 R.eq(TRL.statKey,'woodwork','M1 the stat key is taken from the spec');
 R.eq(TRL.done,false,'M2 not done at zero');
 S.stats.woodwork[0]=2;S.time=5;A.trialTick();
 R.eq(TRL.done,false,'M3 2 of 3 does not complete');
 R.eq(TRL.statN,2,'M4 progress tracks the ledger counter');
 // scoring must not complete a stat trial (a goal is just how you get the ball back); enough goals to reach the target if wrongly counted, so it fails against a broken build
 A.trialGoal(0,{mss:{role:'ATT'}});A.trialGoal(0,{mss:{role:'ATT'}});A.trialGoal(0,{mss:{role:'ATT'}});
 R.eq(TRL.goals,3,'M5 the goals were counted');
 R.eq(TRL.done,false,'M6 goals do not complete a stat trial, however many');
 S.stats.woodwork[0]=3;S.time=9;A.trialTick();
 R.eq(TRL.done,true,'M7 reaching the target completes it');
 R.eq(TRL.ok,true,'M8 ...as a success');
 R.ok(Math.abs(TRL.secs-9)<1e-9,'M9 timed off sim seconds like any other kind','secs='+TRL.secs);
 // the OPPONENT's counter must not count for you
 arm(A,'frame');S.time=0;A.trialTouch(ME);A.trialTick();
 S.stats.woodwork[1]=9;S.time=4;A.trialTick();
 R.eq(TRL.done,false,'M10 the opponent hitting the woodwork does not complete your trial');
 // a stat trial still fails on its limit
 S.time=75;A.trialTick();
 R.eq(TRL.done,true,'M11 the limit still applies');
 R.eq(TRL.ok,false,'M12 ...as a failure');

 // ================= SR. the 'saveRun' objective (the GK kind) =================
 // in order: the beat before the first ball, the spawn list walking forward, a save settling the attempt, a rebound not banking a second, a concede settling it for nothing, the attemptT failsafe, the run ending on attempts, then the record (a save count, beaten by a bigger number)
 const SRG=A.trialById('lastline').goal;
 S.time=0;cfg.trials={};
 arm(A,'lastline');
 R.eq(TRL.saveRun,SRG,'SR1 the goal block is the live saveRun');
 R.eq(TRL.att,0,'SR2 the reset serves no ball');
 R.eq(TRL.serving,true,'SR3 ...it arms the first serve instead');
 R.eq(TRL.serveAt,SRG.serveDelay,'SR4 ...after the same beat every other attempt gets');
 A.trialTick();
 R.eq(TRL.att,0,'SR5 nothing is served before the beat');
 R.eq(TRL.run,false,'SR5b ...and the clock waits for it');
 const rstWas=A.RODRST.resets;
 S.time=SRG.serveDelay;A.trialTick();
 R.eq(TRL.att,1,'SR6 the first attempt lands after it');
 R.eq(TRL.run,true,'SR7 the clock starts on the SERVE — the attackers touch the ball first');
 R.eq(TRL.t0,SRG.serveDelay,'SR7b ...at the serve');
 R.eq(A.RODRST.resets>rstWas,true,'SR8 every attempt opens from rest');
 R.eq(TRN.lastSpot.x,SRG.spawns[0].x,'SR9 attempt 1 uses the first authored spawn');
 R.eq(TRL.spawn.x,SRG.spawns[0].x,'SR10 ...and redropBall is pointed at it');
 // a SAVE settles the attempt and arms the next
 S.stats.saves[0]=1;A.trialTick();
 R.eq(TRL.saves,1,'SR11 a save is banked');
 R.eq(TRL.res,true,'SR12 ...settling the attempt');
 R.eq(TRL.att,1,'SR13 ...without serving the next one in the same frame');
 S.time+=SRG.serveDelay;A.trialTick();
 R.eq(TRL.att,2,'SR14 the next attempt lands after the beat');
 R.eq(TRN.lastSpot.z,SRG.spawns[1].z,'SR15 ...from the NEXT authored spawn');
 /* THE INVARIANT THE WHOLE SCORE RESTS ON: a rebound cannot bank a second save off one attempt,
    so "7 / 10" can never read as more saves than attempts. */
 S.stats.saves[0]=2;A.trialTick();          // settles attempt 2
 S.stats.saves[0]=3;A.trialTick();          // a second save on an already-settled attempt
 R.eq(TRL.saves,2,'SR16 a save on a settled attempt banks nothing');
 // a CONCEDED goal settles it with nothing banked
 S.time+=SRG.serveDelay;A.trialTick();
 R.eq(TRL.att,3,'SR17 attempt 3 served');
 A.trialGoal(1,{mss:null});
 R.eq(TRL.res,true,'SR18 a conceded goal settles the attempt');
 R.eq(TRL.saves,2,'SR19 ...and banks no save');
 // a goal YOU somehow put in at the far end is no part of the objective
 const attWas=TRL.att,svWas=TRL.saves;
 A.trialGoal(0,{mss:null});
 R.eq(TRL.att===attWas&&TRL.saves===svWas,true,'SR20 a goal at the far end changes nothing');
 // the attemptT FAILSAFE — a stalled attempt must not hang the run
 S.time+=SRG.serveDelay;A.trialTick();
 const t4=TRL.attT0;
 S.time=t4+SRG.attemptT-0.01;A.trialTick();
 R.eq(TRL.res,false,'SR21 inside the attempt failsafe');
 S.time=t4+SRG.attemptT;A.trialTick();
 R.eq(TRL.res,true,'SR22 the failsafe settles a stalled attempt');
 R.eq(TRL.saves,2,'SR23 ...as a miss');
 drain(A,false);
 R.eq(TRL.done,true,'SR24 the run ends when the attempts run out');
 R.eq(TRL.ok,true,'SR25 ...as a COMPLETION whatever the score');
 R.eq(TRL.att,SRG.n,'SR26 exactly n attempts were served');
 R.ok(TRL.saves<=TRL.att,'SR27 saves never outrun attempts','saves '+TRL.saves+' of '+TRL.att);
 R.eq(TRL.medal,null,'SR28 two saves earns no medal');
 R.eq(best(cfg,'lastline'),2,'SR29 the record is the SAVE COUNT, not the elapsed time');
 // a full run, and the record direction
 S.time=0;arm(A,'lastline');drain(A,true);
 R.eq(TRL.saves,SRG.n,'SR30 every attempt saved');
 R.eq(TRL.medal,'gold','SR31 ...earns gold');
 R.eq(best(cfg,'lastline'),SRG.n,'SR32 a HIGHER score overwrites the best');
 R.eq(TRL.pb,true,'SR33 ...and is flagged as one');
 S.time=0;arm(A,'lastline');drain(A,false);
 R.eq(best(cfg,'lastline'),SRG.n,'SR34 a WORSE score does not overwrite it');
 R.eq(TRL.pb,false,'SR35 ...and is not flagged');
 // a 0-save run is an honest record (a saveRun completes only by playing out its attempts)
 cfg.trials={};
 S.time=0;arm(A,'lastline');drain(A,false);
 R.eq(TRL.saves,0,'SR36 standing still saves nothing');
 R.eq(best(cfg,'lastline'),0,'SR37 ...and that 0 is banked as a beatable record');
 R.eq(TRL.medal,null,'SR38 ...with no medal');

 /* ================= N. AI from the spec ================= */
 arm(A,'snap');
 R.eq(JSON.stringify(TRN.ai),'[false,false]','N1 no ai block = both teams idle');
 arm(A,'wall');
 R.eq(JSON.stringify(TRN.ai),'[false,true]','N2 the spec turns the opponent AI on');
 R.eq(A.trialById('wall').diff,'pro','N3 ...and pins its difficulty');
 arm(A,'snap');
 R.eq(JSON.stringify(TRN.ai),'[false,false]','N4 the next trial does not inherit it');

 /* ================= I. the table pin ================= */
 A.trialExit();TRL.tbl=null;cfg.table='arena';
 R.eq(A.trialVenueHeld(),null,'I1 nothing parked before a pin');
 A.trialTableApply('classic',()=>{});
 R.eq(cfg.table,'classic','I2 the trial table is applied');
 R.eq(A.trialVenueHeld().table,'arena','I3 the player table is PARKED for saveCfg');
 // stash ONCE — three trials in a row must still restore the original
 A.trialTableApply('circuit',()=>{});
 A.trialTableApply('classic',()=>{});
 R.eq(A.trialVenueHeld().table,'arena','I4 the stash is taken once, not re-taken');
 A.trialTableRestore();
 R.eq(cfg.table,'arena','I5 restore returns the ORIGINAL table');
 R.eq(A.trialVenueHeld(),null,'I6 nothing parked after the restore');
 // already on the trial's table = no stash, no churn
 cfg.table='classic';A.trialTableApply('classic',()=>{});
 R.eq(A.trialVenueHeld(),null,'I7 same table = no stash');
 // unknown table is refused rather than applied
 A.trialTableApply('nosuch',()=>{});
 R.eq(cfg.table,'classic','I8 an unknown table id is ignored');
 // the off switch
 TRLC.pinTable=false;cfg.table='arena';A.trialTableApply('classic',()=>{});
 R.eq(cfg.table,'arena','I9 pinTable:false leaves the player table alone');
 TRLC.pinTable=true;A.trialTableRestore();cfg.table='classic';

 /* ================= J. teardown ================= */
 arm(A,'snap');
 R.ok(!!S.trial,'J1 gate up');
 A.trialExit();
 R.eq(S.trial,null,'J2 trialExit drops the cross-module gate');
 R.eq(TRN.freeze,false,'J3 ...and releases the sandbox freeze');
 R.eq(TRL.def,null,'J4 ...and forgets the trial');
 A.trialTick();A.trialGoal(0,{mss:null});
 R.ok(true,'J5 tick/goal after exit are inert (no throw)');
 // trnSetRodShown writes TRN.hidden[], the SANDBOX's persisted hide list — the rods a trial hid
 // would otherwise still be missing next time the player opened the sandbox.
 TRN.hidden=[true,false,false,false,false,false,false,false];
 arm(A,'snap');
 R.ok(TRN.hidden.filter(Boolean).length>1,'J6 a trial does hide rods through TRN.hidden');
 A.trialExit();
 R.eq(JSON.stringify(TRN.hidden),JSON.stringify([true,false,false,false,false,false,false,false]),
  'J7 the sandbox hide list is restored on exit');

 /* ================= K. retry replays, it does not re-roll ================= */
 arm(A,'snap');
 const seedWas=A.S.seed;
 S.time=0;A.trialTouch(ME);A.trialTick();S.time=3;A.trialTick();
 A.trialRestart();
 R.eq(TRL.run,false,'K1 retry resets the clock');
 R.eq(TRL.secs,0,'K2 elapsed cleared');
 R.eq(TRL.done,false,'K3 result cleared');
 R.eq(A.S.seed,seedWas,'K4 retry keeps the SAME seed — a retry must replay, not re-roll');
 R.eq(S.lastTouch,-1,'K5 lastTouch cleared');
 R.eq(S.stats.kicks[0],0,'K6 the ledger is reset');
 // a retry opens on the same table as the first attempt: rods home and at rest, fresh legs, the same rod in hand
 arm(A,'fullset');
 for(const r of rods){r.offset=5;r.target=6;r.slideV=40;r.exert=3;r.pivot.position.z=5;}
 S.matchTime=150;S.seats[0].ctrl=S.seats[0].rods.findIndex(r=>r.role==='ATT');
 const rstK=A.RODRST.resets;
 A.trialRestart();
 R.ok(rods.every(r=>r.offset===0&&r.target===0&&r.slideV===0&&r.pivot.position.z===0),'K7 a retry puts every rod back in the middle of its slide');
 R.ok(rods.every(r=>r.exert===0),'K8 ...with fresh legs');
 R.eq(A.RODRST.resets>rstK,true,'K9 ...and at rest');
 R.eq(S.matchTime,0,'K10 the stamina ramp starts again');
 R.eq(heldRole(A),'DEF','K11 ...and the rod the ball lies in front of is in hand again');
 S.matchTime=200;A.trialTick();
 R.eq(S.matchTime,0,'K12 the stamina ramp never runs in a trial');
 A.trialExit();
 drillSuite(A,R);
 setSuite(A,R);
 return R;
}
/* ---- the drills' DATA: a drill can only be what its move needs ---- */
const MOVES={tictac:['n','per','lane'],pin:['n','pin','serve'],place:['n','hold','lane'],walk:[],roll:['n'],pinShot:['n','serve'],rollShot:['n'],ttShot:['n','rally']};
function drillData(A,R,d){
 const {CONFIG,F,PHY,rods}=A,g=d.goal,id=d.id,r=rods.find(q=>q.team===0&&q.role===d.hold),P=A.SHOT.pin,DC=A.DRC;
 R.ok(!!MOVES[g.move],'DA-move "'+id+'" is a known move','move='+g.move);
 if(!MOVES[g.move]||!r){R.ok(!!r,'DA-hold "'+id+'" holds a rod');return;}
 for(const k of MOVES[g.move])R.ok(g[k]!=null,'DA-field "'+id+'" declares goal.'+k);
 if(g.move!=='walk')R.ok(g.n>0,'DA-n "'+id+'" needs a positive count');
 const zl=F.W/2-PHY.ballR,men=r.baseZ,face=A.FOOT_BOX.z+A.BALL_R,clear=face+A.CONFIG.ai.clearMargin+A.CONFIG.ai.catch.fetch.clearPad;
 const reach=z=>men.some(b=>Math.abs(z-b)<=r.maxOff);
 // the placed ball: on the row between two men for a tic-tac; lying behind, where a back foot can come down on it and beside every man (a leg cannot go up through a ball in its own lane), for the rest
 const b=d.ball,rel=(b.x-r.x)*r.kickDir;
 if(!g.serve){
  if(g.move==='tictac'||g.move==='ttShot'){
   R.ok(Math.abs(rel)<=DC.rowBand,'DA-row "'+id+'" its ball starts on the rod\'s row','rel='+rel);
   R.ok(men.some((m,i)=>i+1<men.length&&b.z>m+face&&b.z<men[i+1]-face),'DA-gap "'+id+'" ...between two men, clear of both');
  }else{
   R.ok(rel>=P.back&&rel<=P.assist.near,'DA-behind "'+id+'" its ball lies behind the rod where a back foot comes down on it','rel='+rel);
   R.ok(men.every(m=>Math.abs(b.z-m)>=clear),'DA-beside "'+id+'" ...beside every man, not in his lane','z='+b.z);
   R.ok(reach(b.z),'DA-reach "'+id+'" ...within a man\'s slide');
  }
 }
 // every serve: inside the walls, its line reachable by a man; a ball lying ahead inside the forward pin's reach; a rolled one coming at the rod
 for(const sv of g.serve||[]){
  R.ok(sv.z&&sv.z[0]>=-zl&&sv.z[1]<=zl,'DA-serve "'+id+'" z range is inside the walls',JSON.stringify(sv.z));
  for(const z of sv.z)R.ok(reach(z),'DA-serve "'+id+'" a ball at z '+z+' is within a man\'s slide');
  const v=sv.v?sv.v[0]:0;
  if(v>0)R.ok(sv.rel[0]>DC.rowBand&&sv.rel[0]>0,'DA-roll "'+id+'" a rolled ball starts ahead of the row','rel='+sv.rel);
  else R.ok(sv.rel[0]>=A.CONFIG.ai.catch.fetch.near&&sv.rel[1]<=A.CONFIG.ai.catch.fetch.far,'DA-lie "'+id+'" a ball lying ahead is inside the forward pin\'s reach','rel='+sv.rel);
 }
 // lanes: inside the walls, a range the min can be drawn in, and every centre reachable (a pair's gap for a tic-tac, a man for a placement)
 if(g.lane){
  const L=g.lane;
  R.ok(L.w>0&&L.z[0]-L.w/2>=-zl&&L.z[1]+L.w/2<=zl,'DA-lane "'+id+'" its lanes lie inside the walls');
  R.ok(L.min>0&&L.min<L.z[1]-L.z[0]&&(!L.max||L.max>=L.min),'DA-lane "'+id+'" min..max can be drawn in the range',JSON.stringify(L));
  let ok=true,worst=null;
  for(let i=0;i<=40;i++){
   const c=L.z[0]+(L.z[1]-L.z[0])*i/40;
   const can=g.move==='tictac'?men.some((m,j)=>j+1<men.length&&Math.abs(c-(m+men[j+1])/2)<=r.maxOff+L.w/2-(men[j+1]-m-2*face)/2):men.some(m=>Math.abs(c-m)<=r.maxOff+L.w/2);
   if(!can){ok=false;worst=c;}
  }
  R.ok(ok,'DA-lane "'+id+'" every lane can be reached','worst c='+worst);
 }
}
// the drills, driven by hand: the ball and the rod are set, trialTick reads them
function drillSuite(A,R){
 const {CONFIG,PHY,TRL,S,cfg,rods,TRN,DRC}=A,trialById=A.trialById;
 const att=rods.find(r=>r.team===0&&r.role==='ATT');
 const ball=()=>S.balls[0];
 const put=(b,x,z,vx,vz)=>{b.m.position.x=x;b.m.position.y=PHY.ballR;b.m.position.z=z;b.v.x=vx||0;b.v.y=0;b.v.z=vz||0;};
 const tick=dt=>{S.time+=dt;A.trialTick();};
 const clean=()=>{att.pinB=null;att.pinFwd=false;att.kickT=-1;att.kickStyle=null;att.offset=0;};
 cfg.trials={};

 /* ---- tictac: touches in a lane ---- */
 clean();S.time=0;arm(A,'aTtLane');
 let D=TRL.dr;
 R.ok(!!D&&D.mv==='tictac','DR1 a drill trial arms its drill state');
 R.eq(D&&D.r,att,'DR2 ...on the rod it holds');
 R.ok(!!(D&&D.lane)&&D.lane.w===trialById('aTtLane').goal.lane.w,'DR3 ...and draws its first lane');
 const L0=D.lane.c;
 R.ok(L0>=-16&&L0<=16,'DR4 the lane centre is inside lane.z','c='+L0);
 R.eq(S.balls.length,1,'DR5 a placed drill has its ball down at once');
 R.eq(TRL.serving,false,'DR6 ...and is not waiting to serve');
 R.eq(TRL.run,false,'DR7 ...and its clock waits for your first touch');
 A.trialRestart();
 R.eq(TRL.dr.lane.c,L0,'DR8 a retry draws the same lane');
 D=TRL.dr;D.lane={c:9.25,w:14};
 let b=ball();
 put(b,21,4.5,0,10);tick(0.05);
 R.eq(D.ch,1,'DR9 a ball sent along the row is a touch');
 R.eq(D.lk,1,'DR10 ...inside the lane it counts toward it');
 put(b,21,14,0,-10);tick(0.05);
 R.eq(D.ch,2,'DR11 the other man sending it back is the next touch');
 R.eq(D.lk,2,'DR12 ...and counts');
 put(b,21,14.2,0,10);tick(0.05);
 R.eq(D.lk,1,'DR13 the same man touching it twice starts the lane\'s count again');
 R.eq(D.ch,1,'DR13b ...and the rally');
 put(b,21,4.5,0,-10);tick(0.05);put(b,21,14,0,10);tick(0.05);put(b,21,4.5,0,-10);tick(0.05);
 R.eq(D.li,1,'DR14 `per` touches in a row clear the lane');
 R.eq(D.lk,0,'DR14b ...and the next lane starts at none');
 const dj=Math.abs(D.lane.c-9.25),LG=trialById('aTtLane').goal.lane;
 R.ok(dj>=LG.min&&dj<=LG.max,'DR15 the next lane is min..max from the last','moved '+dj.toFixed(2));
 D.lane={c:20,w:6};D.lk=2;D.man=-1;D.dir=0;D.ch=0;
 put(b,21,4.5,0,10);tick(0.05);
 R.eq(D.lk,0,'DR16 a touch outside the lane starts it again');
 R.eq(D.fl,-1,'DR16b ...and the lane flashes the miss');
 D.lane={c:9.25,w:14};D.lk=2;D.ch=2;D.dir=0;
 put(b,21,9,0,0);tick(DRC.breakT+0.1);
 R.eq(D.ch,0,'DR17 a ball stopped breakT after the last touch breaks the rally');
 R.eq(D.lk,0,'DR17b ...and the lane\'s count');
 D.lk=2;D.ch=2;D.tT=S.time;
 put(b,att.x+DRC.rowBand+1,9,0,10);tick(0.05);
 R.eq(D.ch,0,'DR18 a ball off the row breaks it');
 D.man=-1;D.dir=0;D.ch=0;
 put(b,21,9,10,6);tick(0.05);
 R.eq(D.ch,0,'DR19 a ball heading up the table is not a touch along the row');
 const G=trialById('aTtLane').goal;
 D.lane={c:9.25,w:14};D.li=G.n-1;D.lk=G.per-1;D.man=1;D.dir=1;D.ch=3;D.tT=S.time;
 put(b,21,14,0,-10);tick(0.05);
 R.eq(TRL.done,true,'DR20 the last lane completes the trial');
 R.eq(TRL.ok,true,'DR20b ...as a success');

 /* ---- pin: served balls ---- */
 clean();cfg.trials={};S.time=0;arm(A,'aBackPin');
 D=TRL.dr;
 R.eq(TRL.serving,true,'DR21 a served drill waits to serve');
 R.eq(S.balls.length,0,'DR22 ...with nothing on the table');
 tick(DRC.first+0.01);
 R.eq(S.balls.length,1,'DR23 the first ball is served after the beat');
 R.eq(TRL.run,true,'DR24 ...and starts the clock');
 b=ball();
 const s0={x:b.m.position.x,z:b.m.position.z,vx:b.v.x},SV=trialById('aBackPin').goal.serve[0],rel0=s0.x-att.x;
 R.ok(rel0>=SV.rel[0]&&rel0<=SV.rel[1],'DR25 it is served from the spec\'s range ahead of the rod','rel='+rel0);
 R.ok(-s0.vx>=SV.v[0]&&-s0.vx<=SV.v[1],'DR26 ...rolling at the rod at the spec\'s speed','vx='+s0.vx);
 A.trialRestart();tick(DRC.first+0.01);
 b=ball();
 R.ok(b.m.position.z===s0.z&&b.v.x===s0.vx,'DR27 a retry serves the same ball');
 D=TRL.dr;
 att.pinB=b;tick(0.05);
 R.eq(D.n,0,'DR28 a pin is not counted before it has held pinHold');
 tick(DRC.pinHold+0.01);
 R.eq(D.n,1,'DR29 ...and is once it has');
 R.eq(TRL.serving,true,'DR30 then the next ball is served');
 R.eq(D.si,1,'DR31 ...the next one');
 att.pinB=null;tick(DRC.gap+0.01);
 b=ball();const s1={x:b.m.position.x,z:b.m.position.z};
 att.pinB=b;att.pinFwd=true;tick(0.05);tick(DRC.pinHold+0.05);
 R.eq(D.n,1,'DR32 a forward pin in a back-pin drill is not counted');
 att.pinB=null;att.pinFwd=false;tick(0.02);
 put(b,att.x-12,0,0,0);tick(0.05);tick(DRC.lostT+0.05);
 R.eq(TRL.serving,true,'DR33 a ball dead out of reach is lost');
 R.eq(D.si,1,'DR34 ...and the same ball comes again');
 tick(DRC.gap+0.01);
 R.ok(ball().m.position.z===s1.z&&ball().m.position.x===s1.x,'DR35 ...from the same spot');
 put(ball(),att.x+30,0,40,0);for(let i=0;i<10&&!TRL.serving;i++)tick(DRC.awayT/8);
 R.eq(TRL.serving,true,'DR36 a ball out of reach too long is lost however fast it goes');

 /* ---- place: a pinned ball held in a lane ---- */
 clean();S.time=0;arm(A,'aPlace');
 D=TRL.dr;D.lane={c:0,w:6};b=ball();
 put(b,att.x-3.6,1,0,0);att.pinB=b;tick(0.05);tick(0.6);
 R.eq(D.li,0,'DR37 a placement needs the whole hold');
 put(b,att.x-3.6,5,0,0);tick(0.05);
 R.eq(D.lh,0,'DR38 out of the lane the hold starts again');
 put(b,att.x-3.6,-1,0,0);tick(0.05);tick(trialById('aPlace').goal.hold);
 R.eq(D.li,1,'DR39 held `hold` s in the lane clears it');
 R.ok(D.lane.c!==0,'DR40 ...and the lane moves');
 att.pinB=null;tick(0.05);D.lane={c:-1,w:6};tick(1.5);
 R.eq(D.li,1,'DR41 a ball lying in the lane but not pinned is not held');

 /* ---- walk: every man in turn ---- */
 clean();S.time=0;arm(A,'aWalk');
 D=TRL.dr;b=ball();
 R.eq(JSON.stringify(D.seq),'[0,1,2,1,0]','DR42 the walk is every man, there and back, from the end its ball starts at');
 const pinAt=z=>{att.pinB=null;tick(0.02);put(b,att.x-3.6,z,0,0);att.pinB=b;tick(0.02);tick(DRC.pinHold+0.02);};
 pinAt(-18.5);R.eq(D.n,1,'DR43 the first man pins it');
 pinAt(18.5);R.eq(D.n,1,'DR44 a man out of turn does not count');
 pinAt(0);R.eq(D.n,2,'DR45 the next man does');
 pinAt(18.5);pinAt(0);pinAt(-18.5);
 R.eq(TRL.done,true,'DR46 ...and back again completes it');
 clean();

 /* ---- roll: let go, rolled along the row, pinned by another man ---- */
 S.time=0;arm(A,'aRoll');
 D=TRL.dr;b=ball();
 put(b,att.x-3.6,-16,0,0);att.pinB=b;tick(0.02);tick(DRC.pinHold+0.01);
 R.eq(D.n,0,'DR47 a pin no roll reached is not one');
 att.pinB=null;tick(0.02);
 put(b,att.x-3.6,-10,0,12);tick(0.02);
 put(b,att.x-3.6,-1,0,10);att.pinB=b;tick(0.02);tick(DRC.pinHold+0.01);
 R.eq(D.n,1,'DR48 let go by one man, rolled along the row, pinned by the next: a roll');
 att.pinB=null;tick(0.02);put(b,att.x-3.6,3,0,8);tick(0.02);put(b,att.x-3.6,6,0,8);att.offset=6;att.pinB=b;tick(0.02);tick(DRC.pinHold+0.01);
 R.eq(D.n,1,'DR49 a ball rolled away and caught again by the man who let it go is not a roll');
 att.offset=0;
 put(b,att.x-3.6,0.5,0,0);att.pinB=null;tick(0.02);tick(0.02);
 att.offset=0.5-18.5;att.pinB=b;tick(0.02);tick(DRC.pinHold+0.01);
 R.eq(D.n,1,'DR50 the next man brought over a still ball is a walk, not a roll');
 att.pinB=null;att.offset=0;tick(0.02);put(b,att.x-3.6,-16,0,0);att.pinB=b;tick(0.02);
 att.pinB=null;tick(0.02);put(b,att.x-3.6,-10,0,12);att.kickT=0;tick(0.02);att.kickT=-1;
 put(b,att.x-3.6,-1,0,10);att.pinB=b;tick(0.02);tick(DRC.pinHold+0.01);
 R.eq(D.n,1,'DR51 a ball swung at on the way is not a roll');
 clean();

 /* ---- the shots out of a move ---- */
 S.time=0;arm(A,'aPinShot');
 D=TRL.dr;tick(DRC.first+0.01);b=ball();
 att.pinB=b;tick(0.02);
 att.pinB=null;att.kickT=0;att.kickStyle='trapShot';tick(0.02);att.kickT=-1;
 A.trialGoal(0,{mss:{rod:att,t:S.time}});
 R.eq(D.n,1,'DR52 a goal struck from the back pin counts');
 R.eq(TRL.serving,true,'DR53 ...and brings the next ball');
 R.eq(D.si,1,'DR54 ...the next one');
 tick(DRC.gap+0.01);
 att.kickT=0;att.kickStyle=null;tick(0.02);att.kickT=-1;
 A.trialGoal(0,{mss:{rod:att,t:S.time}});
 R.eq(D.n,1,'DR55 a goal that did not come from the pin does not');
 R.eq(D.si,1,'DR56 ...and the same ball comes again');
 tick(DRC.gap+0.01);b=ball();
 att.pinB=b;tick(0.02);att.pinB=null;att.kickT=0;att.kickStyle='trapShot';tick(0.02);att.kickT=-1;
 const old=S.time;tick(DRC.swingT+0.1);
 A.trialGoal(0,{mss:{rod:att,t:S.time}});
 R.eq(D.n,1,'DR57 a goal from a later touch is not the pin shot\'s');
 tick(DRC.gap+0.01);b=ball();
 att.pinB=b;tick(0.02);att.pinB=null;att.kickT=0;att.kickStyle='trapShot';tick(0.02);att.kickT=-1;
 A.trialGoal(1,{mss:{rod:att,t:S.time}});
 R.eq(D.n,1,'DR58 a goal at your own end is not one');
 R.eq(TRL.serving,true,'DR58b ...but it does bring the ball back');
 const other=rods.find(r=>r.team===0&&r.role==='MID');
 tick(DRC.gap+0.01);b=ball();
 att.pinB=b;tick(0.02);att.pinB=null;att.kickT=0;att.kickStyle='trapShot';tick(0.02);att.kickT=-1;
 A.trialGoal(0,{mss:{rod:other,t:S.time}});
 R.eq(D.n,1,'DR59 a goal another rod struck is not one');
 clean();
 S.time=0;arm(A,'aTtShot');
 D=TRL.dr;const RL=trialById('aTtShot').goal.rally;
 D.ch=RL;D.tT=S.time;att.kickT=0;tick(0.02);att.kickT=-1;
 A.trialGoal(0,{mss:{rod:att,t:S.time}});
 R.eq(D.n,1,'DR60 a goal struck with the rally at `rally` touches counts');
 tick(DRC.gap+0.01);
 D.ch=RL-1;D.tT=S.time;att.kickT=0;tick(0.02);att.kickT=-1;
 A.trialGoal(0,{mss:{rod:att,t:S.time}});
 R.eq(D.n,1,'DR61 ...one touch short does not');
 clean();
 S.time=0;arm(A,'aRollShot');
 D=TRL.dr;b=ball();
 put(b,att.x-3.6,-16,0,0);att.pinB=b;tick(0.02);att.kickT=0;att.kickStyle='trapShot';att.pinB=null;tick(0.02);att.kickT=-1;
 A.trialGoal(0,{mss:{rod:att,t:S.time}});
 R.eq(D.n,0,'DR62 a pin shot no roll led to is not one');
 tick(DRC.gap+0.01);b=ball();
 put(b,att.x-3.6,-16,0,0);att.pinB=b;tick(0.02);att.pinB=null;tick(0.02);
 put(b,att.x-3.6,-10,0,12);tick(0.02);put(b,att.x-3.6,-1,0,10);att.pinB=b;tick(0.02);
 att.pinB=null;att.kickT=0;att.kickStyle='trapShot';tick(0.02);att.kickT=-1;
 A.trialGoal(0,{mss:{rod:att,t:S.time}});
 R.eq(D.n,1,'DR63 a pin shot from the pin a roll reached is');
 clean();

 /* ---- a lost ball comes back where it belongs ---- */
 S.time=0;arm(A,'aWalk');
 att.offset=5;A.drillLose(TRL.dr);tick(DRC.gap+0.01);
 R.eq(ball().m.position.z,trialById('aWalk').ball.z+5,'DR64 a placed ball comes back by the same men wherever the rod has slid');
 clean();
 S.time=0;arm(A,'aTtLane');
 D=TRL.dr;D.lane={c:0,w:14};A.drillLose(D);tick(DRC.gap+0.01);
 const lz=ball().m.position.z,lc=A.FOOT_BOX.z+A.BALL_R+DRC.clear;
 R.ok(Math.abs(lz)<=7&&att.baseZ.every(m=>Math.abs(lz-m)>=lc),'DR65 a lost tic-tac ball comes back inside the lane, clear of every foot','z='+lz);

 /* ---- the words ---- */
 R.ok(/LANE/.test(A.drillProg())&&/TOUCHES/.test(A.drillProg()),'DR66 a tic-tac shows its lane and touches');
 for(const d of CONFIG.trials.list)if(d.goal.kind==='drill')
  R.ok(!!A.drillObjText(d.goal),'DR67 "'+d.id+'" has an objective line');
 A.trialExit();
 R.eq(TRL.dr,null,'DR68 leaving the trial drops the drill');
 clean();cfg.trials=null;
}
// the sets inside a discipline
function setSuite(A,R){
 const {CONFIG,TRL,TRLC}=A,ids=TRLC.sets.map(x=>x.id);
 for(const d of TRLC.list)R.ok(ids.includes(A.trialSetOf(d)),'S1 "'+d.id+'" is in a declared set','set='+A.trialSetOf(d));
 R.eq(A.trialSetOf({}),ids[0],'S2 a trial with no set is in the first');
 R.eq(A.trialSetsIn('ATT').map(x=>x.id).join(','),'match,tictac,pin,walk','S3 a discipline shows the sets it has trials in, in order');
 R.eq(A.trialSetsIn('GK').length,1,'S4 ...the keeper has one');
 TRL.cat='ATT';TRL.set='pin';A.renderTrials();
 const h=globalThisEl('trialsPanel').innerHTML;
 R.ok(/data-trial="aBackPin"/.test(h)&&!/data-trial="snap"/.test(h),'S5 the list shows the set picked, not the whole discipline');
 R.ok(/data-set="pin"/.test(h)&&/trlSets/.test(h),'S6 ...under a strip of the discipline\'s sets');
 TRL.cat='GK';TRL.set='pin';A.renderTrials();
 R.eq(TRL.set,'match','S7 a set the discipline does not have falls back to its first');
 R.ok(!/trlSets/.test(globalThisEl('trialsPanel').innerHTML),'S8 a discipline with one set shows no strip');
 TRL.cat='ATT';TRL.set='match';A.trialExit();TRL.pending=null;A.trialStart('aRoll');
 R.eq(TRL.set,'walk','S9 starting a trial remembers its set, so quitting comes back to it');
 A.trialExit();TRL.pending=null;
}
/* ---- main ---- */
const A=boot();API=A;
// self-test on the geometry above: the shipped spawn (x=25, dead in front of the ATT rod's middle man) must read as in contact and its replacement as clear
{
 const att=A.rods.find(r=>r.team===0&&r.role==='ATT');
 const bad=footGap(att,25,0),good=footGap(att,26.5,0),lim=A.PHY.ballR*A.PHY.footBoxReach;
 console.log('foot-gap self-test:  x=25 -> '+bad.toFixed(2)+' (limit '+lim+', must be UNDER)'
  +'   x=26.5 -> '+good.toFixed(2)+' (must be OVER)');
 if(!(bad<lim&&good>=lim)){console.log('  SELF-TEST FAILED — the spawn check has no teeth');process.exit(1);}
}
const R=suite(A);
console.log('trials-harness: '+R.pass+' passed, '+R.failed.length+' failed');
R.failed.forEach(f=>console.log('  FAIL  '+f));

const MUTANTS=[
 // the section is a filter: a section that ignores `cat` shows the whole catalogue under every tab
 ['every discipline lists every trial',
  s=>s.replace("for(const d of TRLC.list)if(d.cat===cat)out.push(d);","for(const d of TRLC.list)out.push(d);")],
 // ...and the mirror: a filter that matches nothing empties every section instead.
 ['a discipline lists nothing at all',
  s=>s.replace("for(const d of TRLC.list)if(d.cat===cat)out.push(d);","for(const d of TRLC.list)if(false)out.push(d);")],
 // The default tab must skip empty sections, or GK opening blank on a fresh install reads as a
 // broken feature rather than as one discipline still being written.
 ['the default tab is simply the first one',
  s=>s.replace("for(const c of cs)if(trialsIn(c.id).length)return c.id;","")],
 ['a conceded goal counts toward the objective',
  s=>s.replace('if(TRL.saveRun){if(team!==0)trialAttemptEnd(false);trialHudSync();return;}\n if(team!==0)return;',
               'if(TRL.saveRun){if(team!==0)trialAttemptEnd(false);trialHudSync();return;}')],
 ['the table stash is re-taken on every apply',
  s=>s.replace('if(!TRL.tbl)TRL.tbl=cfg.table;','TRL.tbl=cfg.table;')],
 ['a best is written whatever the score',
  s=>s.replace('if(!prev||trialBetter(d,val,prev.best)){','if(true){')],
 ['a repeated role clears another slot',
  s=>s.replace('if(i>=0)TRL.roles.splice(i,1);','TRL.roles.pop();')],
 // THE most important property in the file: the clock must be SIM time, so a dropped frame can
 // neither cost the player a medal nor hand them one.
 ['the clock runs on wall time instead of sim time',
  s=>s.replace('TRL.secs=S.time-TRL.t0;','TRL.secs=(Date.now()/1000)-TRL.t0;')],
 ['the clock starts on entry rather than on your first touch',
  s=>s.replace('TRL.run=false;TRL.t0=0;TRL.r0=S.time;','TRL.run=true;TRL.t0=S.time;TRL.r0=S.time;')],
 // the shipped bug (2026-10-21): only a counted swing started the clock, so a pin, a stroke, a side tap or the pad's stick finished at 0.00s
 ['a touch never starts the clock',
  s=>s.replace('function trialTouch(r){if(r&&r.team===0)trialGo();}','function trialTouch(r){}')],
 ['the clock still starts on a swing that never meets the ball',
  s=>s.replace(" S.matchTime=0;   // a trial is base stats",' if(S.stats&&S.stats.kicks[0]>0)trialGo();\n S.matchTime=0;   // a trial is base stats')],
 ['an opponent touch starts your clock',
  s=>s.replace('function trialTouch(r){if(r&&r.team===0)trialGo();}','function trialTouch(r){if(r)trialGo();}')],
 ['the clock is started on the next frame, not at the touch',
  s=>s.replace('function trialTouch(r){if(r&&r.team===0)trialGo();}','function trialTouch(r){if(r&&r.team===0)TRL.pend=1;}')
      .replace(" S.matchTime=0;   // a trial is base stats",' if(TRL.pend){TRL.pend=0;trialGo();}\n S.matchTime=0;   // a trial is base stats')],
 // the same table for every attempt
 ['a retry keeps the table the last attempt left',
  s=>s.replace(' trialHome(trialSpawnFor(0).x);\n','\n')],
 ['the stamina ramp runs through a trial',
  s=>s.replace(" S.matchTime=0;   // a trial is base stats",' //')],
 ['a retry opens on whatever rod the seat last held',
  s=>s.replace('s.ctrl=k;s.holdRod=null;','s.holdRod=null;')],
 ['the sandbox hide list is not restored on exit',
  s=>s.replace('if(TRL.hidWas){TRN.hidden=TRL.hidWas;TRL.hidWas=null;}','')],
 ['a stat trial completes on goals instead of its counter',
  s=>s.replace('if(TRL.statKey){/* trialTick owns completion for this kind */}','if(false){}')],
 ['the AI block is ignored and every trial runs opponents idle',
  s=>s.replace('TRN.ai=(d.ai&&d.ai.slice())||[false,false];','TRN.ai=[false,false];')],
 ['a stat objective reads the opponent column',
  s=>s.replace('TRL.statN=(arr&&arr.length)?arr[0]:0;','TRL.statN=(arr&&arr.length)?arr[1]:0;')],
 ['the daily rolls the authored difficulty too',
  s=>s.replace("d.id='daily';d.daily=true;","d.id='daily';d.daily=true;d.goal=Object.assign({},d.goal,{n:(d.goal.n||1)+2});")],
 ['the daily seed does not vary by date',
  s=>s.replace("d.seed=(rngHash('dailySeed|'+date,0)>>>0)||1;","d.seed=12345;")],
 ['a repeat completion on the same day bumps the streak',
  s=>s.replace('if(c.date!==date){','if(true){')],
 ['a missed day still continues the streak',
  s=>s.replace("c.streak=(c.date&&dailyPrev(date)===c.date)?(c.streak||0)+1:1;","c.streak=(c.streak||0)+1;")],
 ['a daily writes into the per-trial best map',
  s=>s.replace('if(d.daily)TRL.pb=dailyRecord(val,TRL.medal,d.date,trialDir(d)>0);','if(false){}')],
 ['an untouched run banks a 0.00s record',
  s=>s.replace('if(!TRL.run){TRL.run=true;TRL.t0=TRL.r0;}','if(!TRL.run){TRL.run=true;TRL.t0=S.time;}')],

 /* ---- the 'saveRun' (GK) kind ---- */
 // THE invariant the score rests on: settle on the FIRST outcome, or a rebound banks a second
 // save off one attempt and "7 / 10" stops meaning anything.
 ['a rebound banks a second save off one attempt',
  s=>s.replace('if(!TRL.saveRun||TRL.res||TRL.done)return;','if(!TRL.saveRun||TRL.done)return;')],
 ['a conceded goal in a saveRun costs the keeper nothing',
  s=>s.replace('if(TRL.saveRun){if(team!==0)trialAttemptEnd(false);trialHudSync();return;}',
               'if(TRL.saveRun){trialHudSync();return;}')],
 ['a saveRun is scored on the clock like every other kind',
  s=>s.replace('const d=TRL.def,sr=!!TRL.saveRun,val=sr?TRL.saves:TRL.secs;',
               'const d=TRL.def,sr=false,val=TRL.secs;')],
 // one direction for every kind is the state this file was in before the GK work; it makes a
 // saveRun's thresholds read backwards and hands gold to the worst run.
 ['medal thresholds are read in one direction only',
  s=>s.replace("function trialDir(d){return (d&&d.goal&&d.goal.kind==='saveRun')?1:-1;}",
               'function trialDir(d){return -1;}')],
 ['every attempt is served from the same spawn',
  s=>s.replace('return (sp&&sp.length)?sp[i%sp.length]:TRL.def.ball;','return TRL.def.ball;')],
 ['a stalled attempt never settles',
  s=>s.replace('else if(TRL.att>0&&g.attemptT>0&&S.time-TRL.attT0>=g.attemptT)trialAttemptEnd(false);','')],
 // the attackers touch the ball first, so the serve is what starts a saveRun's clock
 ['the clock never starts on a saveRun serve',
  s=>s.replace('trialGo();\n trialHudSync();\n}','trialHudSync();\n}')],
 ['the next ball is served the instant the attempt settles',
  s=>s.replace('TRL.serving=true;TRL.serveAt=S.time+trialServeDelay();\n trialHudSync();',
               'TRL.serving=true;TRL.serveAt=S.time;\n trialHudSync();')],
 /* ---- the drills ---- */
 ['a touch by the same man counts as the next',
  s=>s.replace('if(m===D.man){D.ch=1;return 2;}','')],
 ['a touch outside the lane keeps its count',
  s=>s.replace('if(t<0||!drillInLane(D,b.m.position.z)){','if(t<0){')],
 ['a lane is drawn anywhere',
  s=>s.replace('if(d>=L.min&&!(L.max&&d>L.max))break;','break;')],
 ['a retry draws different lanes',
  s=>s.replace("'|'+tag+'|'+i,S.seed));}","'|'+tag+'|'+i,(Math.random()*1e9)|0));}")],
 ['a rally never breaks',
  s=>s.replace('(Math.abs(vz)<1&&S.time-D.tT>DRC.breakT)','false')],
 ['a pin counts the moment it catches',
  s=>s.replace('S.time-P.t<DRC.pinHold','false')],
 ['a back-pin drill takes any pin',
  s=>s.replace("(g.pin==='fwd'?P.fwd:g.pin==='back'?!P.fwd:true)",'true')],
 ['the walk takes any man',
  s=>s.replace('P.man===D.seq[D.n]','true')],
 ['a roll is any pin after a let-go',
  s=>s.replace('roll:!!(L&&L.on&&L.man!==m&&Math.abs(p.z-L.z)>=DRC.rollDz&&L.v>=DRC.rollV)','roll:!!L')],
 ['a roll back to the same man counts',
  s=>s.replace('L.man!==m&&','')],
 ['a swing on the way does not break a roll',
  s=>s.replace('||r.kickT>=0)L.on=false;',')L.on=false;')],
 ['a placement counts a ball held outside the lane',
  s=>s.replace('&&drillInLane(D,b.m.position.z));',');')],
 ['any goal counts in a shot drill',
  s=>s.replace("(sw.pin&&(D.mv!=='rollShot'||sw.roll))",'true')],
 ['a tic-tac strike needs no rally',
  s=>s.replace('sw.ch>=g.rally&&','')],
 ['a goal is credited to an old swing',
  s=>s.replace('&&rec.t-sw.t<=DRC.swingT','')],
 ['the swing reads the pin after this frame let it go',
  s=>s.replace(' drillPins(D,r,b);\n const mv=D.mv;',' const mv=D.mv;').replace(' // the swing first: it reads the pin as it stood before this frame let go of it\n const k=r.kickT>=0;',' drillPins(D,r,b);\n const k=r.kickT>=0;')],
 ['a missed ball moves on to the next serve',
  s=>s.replace('D.lk=0;D.lh=0;D.deadT=0;D.awayT=0;D.lost=true;','D.lk=0;D.lh=0;D.deadT=0;D.awayT=0;D.lost=true;D.si++;')],
 ['a pinned ball brings the same serve again',
  s=>s.replace("if(D.mv==='pin'){D.si++;","if(D.mv==='pin'){")],
 ['a served drill does not start the clock',
  s=>s.replace(' if(sv)trialGo();\n','\n')],
 ['a re-placed ball ignores where the rod is',
  s=>s.replace('z=d.ball.z+r.offset','z=d.ball.z')],
 ['a lost tic-tac ball comes back where it started',
  s=>s.replace("else if(D.mv==='tictac'&&D.lane&&D.lost){const lz=drillLaneSpot(D);if(lz!=null)z=lz;}",'')],
 ['a lost ball is never put back',
  s=>s.replace('if(D.deadT>=DRC.lostT||D.awayT>=(row?DRC.lostT:DRC.awayT))drillLose(D);','')],
 ['the drill outlives the trial',
  s=>s.replace('TRL.def=null;TRL.pending=null;TRL.dr=null;drillDraw();','TRL.def=null;TRL.pending=null;drillDraw();')],
 /* ---- the sets ---- */
 ['the list shows the whole discipline whatever the set',
  s=>s.replace('list=sets.length>1?all.filter(d=>trialSetOf(d)===TRL.set):all','list=all')],
 ['starting a trial forgets its set',
  s=>s.replace('if(d.cat){TRL.cat=d.cat;TRL.set=trialSetOf(d);}','if(d.cat)TRL.cat=d.cat;')],
 ['a set the discipline lacks is kept',
  s=>s.replace('if(sets.length&&!sets.some(x=>x.id===TRL.set))TRL.set=sets[0].id;','')],
 // not mutated: trialFinish's own `if(TRL.done)return;` (both callers gate on TRL.done, so it's unreachable and a mutation changes nothing observable)
];
console.log('\nmutation checks (each must FAIL something):');
let teeth=0;
for(const [name,mut] of MUTANTS){
 const src=rd('js/trials.js');
 if(mut(src)===src){console.log('  ??  '+name+' — MUTATION DID NOT APPLY (harness is stale)');continue;}
 let m;
 try{
  m=suite(boot(mut));
 }catch(e){console.log('  ok  '+name+' -> threw: '+e.message);teeth++;continue;}
 if(m.failed.length){console.log('  ok  '+name+' -> breaks '+m.failed.length+': '+m.failed.map(f=>f.split(' ')[0]).join(' '));teeth++;}
 else console.log('  NO TEETH  '+name+' -> suite still passed');
}
console.log('\n'+teeth+'/'+MUTANTS.length+' mutations caught');
process.exit(R.failed.length||teeth<MUTANTS.length?1:0);
