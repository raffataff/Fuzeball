'use strict';
/* ================= skill trials harness =================
   Boots core + config + rng + state + trials.js in ONE vm context against stubs for the sandbox
   functions trials.js drives (training.js, balls, audio, DOM), then asserts both halves of the
   feature: the OBJECTIVE EVALUATOR, and the trial DATA itself.

   The data assertions matter as much as the code ones. A trial whose bronze threshold sits past
   its own time limit, or that asks you to score with a rod it has hidden, is unwinnable — and
   nothing in the game would tell you, because it fails as "I couldn't do it" rather than as an
   error. Those are config bugs a harness can catch and a playtest can only suspect.

   Run: node tools/trials-harness.js                                                            */
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.join(__dirname,'..');
const rd=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

function boot(mutate){
 let trials=rd('js/trials.js');
 if(mutate)trials=mutate(trials);
 // state.js's freshStats reads MSTAT for terr's length — that alias comes from config.js, NOT from
 // matchstats.js, so this chain needs neither that module nor a stub for it.
 const src=rd('js/core.js')+'\n'+rd('js/config.js')+'\n'+rd('js/rng.js')
  +'\n'+rd('js/state.js')+'\n'+STUBS+'\n'+trials
  +'\n;globalThis.__api={CONFIG,F,PHY,TRL,TRLC,S,cfg,rods,TRN,SCREENS,'
  +'trialById,trialBest,trialMedal,trialStart,trialArm,trialReset,trialGoal,trialTick,trialFinish,'
  +'trialRestart,trialExit,trialVenueHeld,trialTableApply,trialTableRestore,renderTrials,trialOn,freshStats,dailyBuild,dailyDate,dailyPrev,dailyStreak,dailyDone,dailyRecord,dailyOn,trialObjText,renderDaily,AIC};';
 const sb={console:{log(){},warn(){}},Math,Date,JSON,Object,Array,String,Number,Map,Set,isFinite,
  localStorage:{getItem:()=>null,setItem(){}},addEventListener(){},setTimeout(){},
  navigator:{}};
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
function syncBall(){}
function updateScoreUI(){}
function updateChips(){}
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

/* Distance from a ball at (bx,bz) to the nearest of a rod's resting foot boxes. Mirrors the
   analytic box collideRod builds: at rest (angle 0) the along-leg axis points DOWN, so the
   rod-local footBoxOff.x lands in world Y and footBoxOff.y in world X (team-relative), and the
   box half-extents swap with it. Contact when the gap is under BALL_R*footBoxReach. */
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
/* The rods the player could be holding: the locked one, else every visible rod of team 0. */
function ownRods(A,d){
 const show=(d.rods&&d.rods.show)||[];
 return A.rods.filter(r=>r.team===0&&show.includes('0|'+r.role)&&(!d.hold||r.role===d.hold));
}
// signed distance from the rod to the ball, in the direction that rod attacks
function relOf(A,d){
 let best=Infinity;
 for(const r of ownRods(A,d)){const rel=(d.ball.x-r.x)*(r.team===0?1:-1);if(Math.abs(rel)<Math.abs(best))best=rel;}
 return best===Infinity?NaN:best;
}
function reachOK(A,d){
 return ownRods(A,d).some(r=>{
  const rel=(d.ball.x-r.x)*(r.team===0?1:-1);
  return rel>0&&rel<=A.AIC.inFrontMax&&zReach(A,r,d.ball.z);
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

function suite(A){
 const R=new Run();
 const {CONFIG,F,PHY,TRLC,TRL,S,cfg,rods,TRN}=A;

 /* ================= A. the trial DATA ================= */
 const ids={};
 for(const d of TRLC.list){
  R.ok(!ids[d.id],'A-id "'+d.id+'" is unique');ids[d.id]=1;
  R.ok(typeof d.seed==='number'&&d.seed>0,'A-seed "'+d.id+'" declares a seed');
  R.ok(!!CONFIG.tables[d.table],'A-table "'+d.id+'" table exists','table='+d.table);
  R.ok(d.goal&&['goals','roleGoals','stat'].includes(d.goal.kind),'A-kind "'+d.id+'" objective kind is supported',
   'kind='+(d.goal&&d.goal.kind));
  /* A 'stat' objective names a MATCH LEDGER counter. A typo there would silently never complete —
     the trial would just be impossible, with nothing on screen saying why — so the key is checked
     against a real freshStats() rather than against a hand-kept list that could drift from it. */
  if(d.goal.kind==='stat'){
   const led=A.freshStats(),arr=led[d.goal.stat];
   R.ok(Array.isArray(arr)&&arr.length===2,'A-stat "'+d.id+'" "'+d.goal.stat+'" is a real per-team ledger counter');
   R.ok(d.goal.n>0,'A-stat "'+d.id+'" needs a positive target');
  }
  /* A LIVE OPPONENT MUST PIN ITS DIFFICULTY. Without diff, teamDiff falls through to cfg.diffRed/
     diffBlue — so the trial would play at whatever the player last chose in Kick Off and two
     players' medal times would not be comparable. */
  if(d.ai&&d.ai.some(Boolean))
   R.ok(!!d.diff,'A-diff "'+d.id+'" pins a difficulty because it enables an AI');
  const m=d.medals||{};
  R.ok(m.gold<m.silver&&m.silver<m.bronze,'A-medal "'+d.id+'" thresholds ascend',JSON.stringify(m));
  // a bronze you cannot reach inside the limit is an unwinnable medal
  if(d.limit>0)R.ok(m.bronze<=d.limit,'A-limit "'+d.id+'" bronze is inside the time limit',
   'bronze='+m.bronze+' limit='+d.limit);
  R.ok(Math.abs(d.ball.x)<F.L/2&&Math.abs(d.ball.z)<F.W/2,'A-ball "'+d.id+'" spawns inside the walls');
  /* A TRIAL MUST NOT SPAWN THE BALL INSIDE A VISIBLE FOOT. This is the check the shipped SNAP
     SHOT failed: at x=25 the ball sat 0.8u inside the resting ATT foot box, so collideRod fired
     on sim step one — which nudged the ball and (with the old lastTouch clock) started the timer
     before the player had done anything. Nothing on screen says "your ball is inside a boot";
     it just reads as the trial being broken. Computed from the live CONFIG so retuning footBox
     or the rod geometry fails HERE rather than in play. */
  for(const r of rods){
   if(!(d.rods&&d.rods.show||[]).includes(r.team+'|'+r.role))continue;   // hidden rods can't touch it
   R.ok(footClear(r,d.ball.x,d.ball.z),'A-spawn "'+d.id+'" ball is clear of the '+r.team+'|'+r.role+' foot box',
    'gap '+footGap(r,d.ball.x,d.ball.z).toFixed(2)+' < BALL_R '+PHY.ballR);
  }
  /* AND IT MUST BE WITHIN REACH OF A ROD YOU CONTROL. The band that makes a spawn playable is
     bounded at BOTH ends: too close and it is inside the boot (above), too far and the player
     simply cannot get a foot to it. CONFIG.ai.inFrontMax (the AI's own forward swing window) is
     the conservative, config-derived stand-in for a human's reach — so retuning it re-checks
     every trial rather than leaving a stale literal here. */
  R.ok(reachOK(A,d),'A-reach "'+d.id+'" the ball is inside a controlled rod\'s strike window',
   'rel='+relOf(A,d).toFixed(2)+' max='+A.AIC.inFrontMax);
  const show=d.rods&&d.rods.show;
  R.ok(!!show&&show.length>0,'A-rods "'+d.id+'" declares which rods are on the table');
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

 /* ================= C. setup application ================= */
 cfg.table='classic';
 arm(A,'snap');
 R.ok(!!S.trial,'C1 S.trial is the live gate');
 R.eq(TRN.ai[0],false,'C2 AI off, team 0');R.eq(TRN.ai[1],false,'C3 AI off, team 1');
 R.eq(TRN.freeze,false,'C4 sandbox freeze cleared on entry');
 const vis=rods.filter(r=>!r.trnHidden).map(r=>r.team+'|'+r.role);
 R.ok(vis.length===1&&vis[0]==='0|ATT','C5 only the declared rod is on the table','['+vis+']');
 R.eq(TRN.lastSpot.x,TRLC.list[0].ball.x,'C6 ball spawned at the trial spawn');
 R.eq(S.phase,'play','C7 phase is play');
 R.eq(S.lastTouch,-1,'C8 lastTouch cleared so the clock cannot pre-start');
 R.ok(!!S.stats,'C9 the ledger is fresh');

 /* ================= D. the clock ================= */
 S.time=100;A.trialTick();
 R.eq(TRL.run,false,'D1 clock does not run before you play the ball');
 R.eq(TRL.secs,0,'D2 elapsed stays 0');
 /* D3/D4 ARE THE REGRESSION THIS BUG WAS. A trial spawns the ball at the feet, which puts it
    INSIDE the resting foot's contact radius — so collideRod fires on sim step ONE and sets
    S.lastTouch. A clock keyed off that starts the moment the trial loads, and the player is
    scored on however long they spent getting their bearings. It has to key off a SWING
    (S.stats.kicks, incremented by msKick from kickRod), which a ball merely resting against a
    boot can never produce. */
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
 /* EVERY ROLLABLE SPAWN MUST BE PLAYABLE. Sampling the corners is not enough — the band is
    validated across its whole area, because a daily that lands on an unplayable spot is a day
    the player simply cannot win, with nothing on screen saying why. */
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
 /* END TO END, because P20-P33 exercise dailyRecord directly and would pass even if the runner
    never called it: a daily completion has to land in cfg.daily and NOT in the per-trial best
    map, whose 'daily' key would otherwise be one "best" overwritten by whichever day was easiest.
    Finished through trialFinish rather than by satisfying the objective, because which template
    a given date rolls (goals / roleGoals / stat) is not the thing under test here. */
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
 // SCORING MUST NOT COMPLETE A STAT TRIAL — in a woodwork trial a goal is just how you get the
 // ball back for another attempt.
 // enough goals to reach the target IF the code wrongly counted them — otherwise this passes
 // against a broken build and the assertion is decoration
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
/* SELF-TEST on the geometry above, because a check that cannot fail is worse than no check: the
   spawn that shipped (x=25, dead in front of the ATT rod's middle man) MUST read as in contact,
   and the one that replaced it MUST read as clear. */
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
 ['a conceded goal counts toward the objective',
  s=>s.replace('if(!TRL.def||TRL.done||team!==0)return;','if(!TRL.def||TRL.done)return;')],
 ['the table stash is re-taken on every apply',
  s=>s.replace('if(!TRL.tbl)TRL.tbl=cfg.table;','TRL.tbl=cfg.table;')],
 ['a best is written whatever the time',
  s=>s.replace('if(!prev||TRL.secs<prev.best){','if(true){')],
 ['a repeated role clears another slot',
  s=>s.replace('if(i>=0)TRL.roles.splice(i,1);','TRL.roles.pop();')],
 // THE most important property in the file: the clock must be SIM time, so a dropped frame can
 // neither cost the player a medal nor hand them one.
 ['the clock runs on wall time instead of sim time',
  s=>s.replace('TRL.secs=S.time-TRL.t0;','TRL.secs=(Date.now()/1000)-TRL.t0;')],
 ['the clock starts on entry rather than on your first swing',
  s=>s.replace('if(!TRL.run&&S.stats&&S.stats.kicks[0]>0)','if(!TRL.run)')],
 // the SHIPPED bug, kept as a mutation: a trial spawns the ball touching a boot, so any-contact
 // is indistinguishable from "the player has started"
 ['the clock keys off any contact instead of a swing',
  s=>s.replace('if(!TRL.run&&S.stats&&S.stats.kicks[0]>0)','if(!TRL.run&&S.lastTouch>=0)')],
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
  s=>s.replace('if(d.daily)TRL.pb=dailyRecord(TRL.secs,TRL.medal,d.date);','if(false){}')],
 ['an untimed run banks a 0.00s record',
  s=>s.replace(/TRL\.medal=TRL\.run\?trialMedal\(d,TRL\.secs\):null;(\s*\n\s*)if\(TRL\.run\)\{/,
                 'TRL.medal=trialMedal(d,TRL.secs);$1if(true){')]
 // NOT mutated, deliberately: trialFinish's own `if(TRL.done)return;`. Both callers already gate
 // on TRL.done, so that guard is defence-in-depth and unreachable — a mutation of it changes
 // nothing observable, which would look like a harness gap rather than the no-op it is.
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
