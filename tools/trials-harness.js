'use strict';
// ================= skill trials harness =================
// boots core + config + rng + state + trials.js in one vm against stubs for the sandbox (training.js, balls, audio, DOM) and asserts the objective evaluator and the trial data itself (an unwinnable trial fails as 'I couldn't do it', not an error)
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
  +'trialDir,trialBetter,trialScoreText,trialServe,trialAttemptEnd,trialSpawnFor,trialServeDelay,RODRST};';
 const sb={console:{log(){},warn(){}},Math,Date,JSON,Object,Array,String,Number,Map,Set,isFinite,
  localStorage:{getItem:()=>null,setItem(){}},addEventListener(){},setTimeout(){},
  navigator:{},
  // trialFinish reads performance.now() for WHEN the result card appears (TRL.showAt) — display
  // timing only; the medal clock is S.time and never touches this.
  performance:{now:()=>0}};
 sb.globalThis=sb;
 sb.document={getElementById:id=>EL(sb,id),createElement:()=>EL(sb,'_new'),body:{appendChild(){}}};
 vm.runInNewContext(src,sb,{filename:'trials-boot'});
 return sb.__api;
}
// A DOM stub whose classList records state, so "is the result card up" is readable.
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
 return{idx:i,team:d[0],role:d[1],x:d[2],men:d[3],baseZ:bz,trnHidden:false,pivot:{visible:true}};});
var TRN={freeze:false,stepQ:0,ai:[false,false],score:false,deadball:false,ballType:'classic',lastSpot:null,placing:false,hidden:[]};
var LAST_BALL=null;
function trnSetRodShown(i,v){var r=rods[i];if(!r)return;r.trnHidden=!v;r.pivot.visible=v;TRN.hidden[i]=!v;}
function trnSetPlacing(v){TRN.placing=v;}
function trnSpawnBall(k,x,z){LAST_BALL={key:k,cur:{x:x,y:1.9,z:z},v:{set:function(a,b,c){this.x=a;this.y=b;this.z=c;},x:0,y:0,z:0},mss:null};TRN.lastSpot={x:x,z:z};return LAST_BALL;}
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

/* Put a live trial on the table without going through startMatch. */
function arm(A,id,seed){
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

 /* ================= A. the trial DATA ================= */
 const ids={};
 for(const d of TRLC.list){
  R.ok(!ids[d.id],'A-id "'+d.id+'" is unique');ids[d.id]=1;
  R.ok(typeof d.seed==='number'&&d.seed>0,'A-seed "'+d.id+'" declares a seed');
  R.ok(!!CONFIG.tables[d.table],'A-table "'+d.id+'" table exists','table='+d.table);
  R.ok(d.goal&&['goals','roleGoals','stat','saveRun'].includes(d.goal.kind),'A-kind "'+d.id+'" objective kind is supported',
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
  for(const s of SPW)
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

 /* ================= D. the clock ================= */
 S.time=100;A.trialTick();
 R.eq(TRL.run,false,'D1 clock does not run before you play the ball');
 R.eq(TRL.secs,0,'D2 elapsed stays 0');
 // D3/D4 are the regression for the clock: a trial spawns the ball at the feet, inside the resting foot's contact radius, so S.lastTouch fires on step one; the clock must key off a swing (S.stats.kicks, via msKick)
 S.lastTouch=0;A.trialTick();
 R.eq(TRL.run,false,'D3 a PASSIVE contact does not start the clock');
 R.eq(TRL.secs,0,'D4 ...and banks no time');
 S.stats.kicks[0]=1;A.trialTick();
 R.eq(TRL.run,true,'D5 your first SWING starts it');
 S.time=103.5;A.trialTick();
 R.ok(Math.abs(TRL.secs-3.5)<1e-9,'D6 elapsed is SIM time since the swing','secs='+TRL.secs);
 // an OPPONENT swing must not start your clock either
 arm(A,'keeper');S.time=0;A.trialTick();S.stats.kicks[1]=3;S.time=9;A.trialTick();
 R.eq(TRL.run,false,'D7 an opponent swing does not start your clock');
 // D7 left KEEPER'S NIGHTMARE armed — put SNAP SHOT back, running, for the goals series below.
 arm(A,'snap');S.stats.kicks[0]=1;S.time=0;A.trialTick();S.time=3.5;A.trialTick();

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
 arm(A,'keeper');S.stats.kicks[0]=1;S.time=0;A.trialTick();
 S.time=5;A.trialTick();A.trialGoal(0,{mss:null});
 R.eq(TRL.done,false,'E8 1 of 3 does not complete');
 A.trialGoal(0,{mss:null});A.trialGoal(0,{mss:null});
 R.eq(TRL.done,true,'E9 3 of 3 completes');

 /* ================= F. objective: roleGoals ================= */
 arm(A,'fullset');S.stats.kicks[0]=1;S.time=0;A.trialTick();
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
 arm(A,'keeper');S.stats.kicks[0]=1;S.time=0;A.trialTick();
 S.time=39.9;A.trialTick();
 R.eq(TRL.done,false,'G1 inside the limit');
 S.time=40.0;A.trialTick();
 R.eq(TRL.done,true,'G2 the limit fires');
 R.eq(TRL.ok,false,'G3 ...as a FAILURE');
 R.eq(TRL.secs,40,'G4 elapsed is clamped to the limit');
 R.eq(TRL.medal,null,'G5 a failure earns no medal');
 // a stopwatch trial has no failure state
 arm(A,'snap');S.stats.kicks[0]=1;S.time=0;A.trialTick();S.time=9999;A.trialTick();
 R.eq(TRL.done,false,'G6 limit 0 never times out');

 /* ================= H. personal bests ================= */
 cfg.trials=null;
 arm(A,'snap');S.stats.kicks[0]=1;S.time=0;A.trialTick();S.time=1.5;A.trialTick();
 A.trialGoal(0,{mss:null});
 R.ok(!!cfg.trials&&!!cfg.trials.snap,'H1 a completion writes a best');
 R.eq(best(cfg,'snap'),1.5,'H2 the best is the elapsed time');
 R.eq(medal(cfg,'snap'),'gold','H3 ...with its medal');
 R.eq(TRL.pb,true,'H4 flagged as a new best');
 // slower run must NOT overwrite
 arm(A,'snap');S.stats.kicks[0]=1;S.time=0;A.trialTick();S.time=5;A.trialTick();
 A.trialGoal(0,{mss:null});
 R.eq(best(cfg,'snap'),1.5,'H5 a SLOWER run does not overwrite the best');
 R.eq(TRL.pb,false,'H6 ...and is not flagged as one');
 // faster run must
 arm(A,'snap');S.stats.kicks[0]=1;S.time=0;A.trialTick();S.time=1.1;A.trialTick();
 A.trialGoal(0,{mss:null});
 R.eq(best(cfg,'snap'),1.1,'H7 a faster run does overwrite');
 // an UNTIMED run (completed without ever swinging) must never write one either — otherwise it
 // banks a 0.00s gold that nothing can beat
 const beforeUntimed=JSON.stringify(cfg.trials);
 arm(A,'snap');S.time=0;A.trialTick();S.time=4;A.trialTick();   // no swing, so the clock never ran
 R.eq(TRL.run,false,'H9 the clock never started');
 A.trialGoal(0,{mss:null});
 R.eq(TRL.done,true,'H10 it still completes');
 R.eq(TRL.medal,null,'H11 ...but an untimed run earns no medal');
 R.eq(TRL.pb,false,'H12 ...and is not a personal best');
 R.eq(JSON.stringify(cfg.trials),beforeUntimed,'H13 ...and writes nothing');
 // a FAILED run must never write one
 const before=JSON.stringify(cfg.trials);
 arm(A,'keeper');S.stats.kicks[0]=1;S.time=0;A.trialTick();S.time=40;A.trialTick();
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
 S.stats.kicks[0]=1;S.time=0;A.trialTick();S.time=2;A.trialTick();
 A.trialFinish(true);
 R.ok(!!cfg.daily&&cfg.daily.date==='2026-06-01','P35 a daily completion writes cfg.daily');
 R.ok(!cfg.trials||!cfg.trials.daily,'P36 ...and NOT the per-trial best map');
 R.eq(dly(cfg,'best'),2,'P37 ...with the elapsed sim time');
 R.eq(dly(cfg,'streak'),1,'P38 ...and starts the streak');
 A.trialExit();
 cfg.daily=null;cfg.trials=null;

 /* ================= M. the 'stat' objective ================= */
 arm(A,'frame');S.stats.kicks[0]=1;S.time=0;A.trialTick();
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
 arm(A,'frame');S.stats.kicks[0]=1;S.time=0;A.trialTick();
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
 S.time=SRG.serveDelay;A.trialTick();
 R.eq(TRL.att,1,'SR6 the first attempt lands after it');
 R.eq(TRL.run,true,'SR7 the clock starts on the SERVE — a keeper never swings');
 R.eq(A.RODRST.resets>0,true,'SR8 every attempt opens from rest');
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
 // a 0-save run is an honest record, not the untimed-run hole (a saveRun completes only by playing out its attempts)
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
 S.stats.kicks[0]=1;S.time=0;A.trialTick();S.time=3;A.trialTick();
 A.trialRestart();
 R.eq(TRL.run,false,'K1 retry resets the clock');
 R.eq(TRL.secs,0,'K2 elapsed cleared');
 R.eq(TRL.done,false,'K3 result cleared');
 R.eq(A.S.seed,seedWas,'K4 retry keeps the SAME seed — a retry must replay, not re-roll');
 R.eq(S.lastTouch,-1,'K5 lastTouch cleared');
 R.eq(S.stats.kicks[0],0,'K6 the swing count is reset, so the clock genuinely re-arms');
 A.trialExit();

 return R;
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
 ['the clock starts on entry rather than on your first swing',
  s=>s.replace('if(!TRL.run&&S.stats&&(S.stats.kicks[0]>0||S.stats.saves[0]>0))','if(!TRL.run)')],
 // the SHIPPED bug, kept as a mutation: a trial spawns the ball touching a boot, so any-contact
 // is indistinguishable from "the player has started"
 ['the clock keys off any contact instead of a swing',
  s=>s.replace('if(!TRL.run&&S.stats&&(S.stats.kicks[0]>0||S.stats.saves[0]>0))','if(!TRL.run&&S.lastTouch>=0)')],
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
 ['an untimed run banks a 0.00s record',
  s=>s.replace('const sr=!!TRL.saveRun,val=sr?TRL.saves:TRL.secs,keep=sr||TRL.run;',
               'const sr=!!TRL.saveRun,val=sr?TRL.saves:TRL.secs,keep=true;')],

 /* ---- the 'saveRun' (GK) kind ---- */
 // THE invariant the score rests on: settle on the FIRST outcome, or a rebound banks a second
 // save off one attempt and "7 / 10" stops meaning anything.
 ['a rebound banks a second save off one attempt',
  s=>s.replace('if(!TRL.saveRun||TRL.res||TRL.done)return;','if(!TRL.saveRun||TRL.done)return;')],
 ['a conceded goal in a saveRun costs the keeper nothing',
  s=>s.replace('if(TRL.saveRun){if(team!==0)trialAttemptEnd(false);trialHudSync();return;}',
               'if(TRL.saveRun){trialHudSync();return;}')],
 ['a saveRun is scored on the clock like every other kind',
  s=>s.replace('const sr=!!TRL.saveRun,val=sr?TRL.saves:TRL.secs,keep=sr||TRL.run;',
               'const sr=false,val=TRL.secs,keep=TRL.run;')],
 // one direction for every kind is the state this file was in before the GK work; it makes a
 // saveRun's thresholds read backwards and hands gold to the worst run.
 ['medal thresholds are read in one direction only',
  s=>s.replace("function trialDir(d){return (d&&d.goal&&d.goal.kind==='saveRun')?1:-1;}",
               'function trialDir(d){return -1;}')],
 ['every attempt is served from the same spawn',
  s=>s.replace('return (sp&&sp.length)?sp[i%sp.length]:TRL.def.ball;','return TRL.def.ball;')],
 ['a stalled attempt never settles',
  s=>s.replace('else if(TRL.att>0&&g.attemptT>0&&S.time-TRL.attT0>=g.attemptT)trialAttemptEnd(false);','')],
 // the gap this whole kind exists to close: a keeper never swings, so a clock keyed on kicks
 // alone leaves the run untimed and banking nothing.
 ['the clock never starts for a keeper who does not swing',
  s=>s.replace('if(!TRL.run){TRL.run=true;TRL.t0=S.time;}','')],
 ['the next ball is served the instant the attempt settles',
  s=>s.replace('TRL.serving=true;TRL.serveAt=S.time+trialServeDelay();\n trialHudSync();',
               'TRL.serving=true;TRL.serveAt=S.time;\n trialHudSync();')]
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
