/* moments-harness.js — headless behaviour tests for js/moments.js.
   Run:  node tools/moments-harness.js

   Boots core.js + config.js + moments.js in one vm context (so MOM/F/PHY/GRAV are the REAL
   tuning values, not a copy that can drift) against a stubbed S / notice / Au / teamCol, then
   exercises the projection, the save gate, the deferred verdict and the goal classifier.

   Inputs are picked to EXPOSE bugs, not to pass: the projection is tested from real shooting
   distances (where an unfloored ballistic drop reads as "fallen through the pitch"), the
   classifier is tested on combinations where two rules both match so the priority order is
   pinned, and the save gate is tested with a DEF whose state is otherwise identical to the GK's. */
'use strict';
const fs=require('fs'),vm=require('vm');

/* ---- context ------------------------------------------------------------ */
const log=[];
const ctx={console,Math,Date,JSON,Object,Array,isFinite,isNaN,
 S:null,notice:null,teamCol:null,Au:null,HYPE:['H1','H2']};
ctx.globalThis=ctx;vm.createContext(ctx);
for(const f of ['js/core.js','js/config.js','js/moments.js'])
 new vm.Script(fs.readFileSync(f,'utf8'),{filename:f}).runInContext(ctx);

/* Stubs. notice/Au record into `log` so a fired moment is observable. */
const fired=[];
ctx.notice=(m,d,c)=>fired.push({ch:'notice',m,d,c});
ctx.teamCol=t=>t===0?'#red':'#blue';
ctx.Au={react:k=>fired.push({ch:'react',m:k})};

/* config.js's aliases are top-level CONSTs, which are LEXICAL — they are not properties of the
   vm context, so ctx.MOM reads back undefined and every threshold silently becomes NaN. Function
   DECLARATIONS do land on the global object, which is why ctx.momOnTarget works without this.
   Hand them out explicitly. (Same trap CLAUDE.md flags under Verifying changes.) */
new vm.Script('globalThis.__c={MOM,F,PHY,BALL_R,GRAV,ARM};').runInContext(ctx);
const {MOM,F,BALL_R}=ctx.__c;
if(!MOM||!F||!BALL_R)throw new Error('alias export failed');
function resetS(o){
 ctx.S={phase:'play',time:100,trn:null,timeScale:1,lastTouch:-1,
  eff:[{boost:0,frozen:0,big:0},{boost:0,frozen:0,big:0}],
  stats:{kicks:[0,0],poss:[0,0],topSpeed:0,saves:[0,0],woodwork:[0,0]}};
 Object.assign(ctx.S,o||{});fired.length=0;
 return ctx.S;
}
/* A ball shaped like the real one: m.position + a v with .length(). */
function ball(x,y,z,vx,vy,vz,extra){
 const b={m:{position:{x,y,z}},v:{x:vx,y:vy,z:vz,length(){return Math.hypot(this.x,this.y,this.z);}},
  spin:0,curl:0,t:{value:1},onT:null,savePend:null,tc:null,shot:null,wood:0,woodCd:0,saveCd:0};
 return Object.assign(b,extra||{});
}
const rod=(team,role,kickT)=>({team,role,kickT:kickT===undefined?-1:kickT});

/* ---- assertions --------------------------------------------------------- */
let pass=0,fail=0;
function ok(name,cond,extra){
 if(cond){pass++;return;}
 fail++;console.log('  FAIL  '+name+(extra!==undefined?'   ('+JSON.stringify(extra)+')':''));
}
const eq=(name,a,b)=>ok(name,a===b,{got:a,want:b});
function group(n){console.log('\n'+n);}

/* =========================================================================
   1. momOnTarget — the projection
   ========================================================================= */
group('momOnTarget — projection');
resetS();
{
 // A FLAT GROUND SHOT from the halfway line. This is the case that caught the missing floor
 // clamp: t=1.0s, and an unfloored ballistic drop is -123 units, i.e. below the pitch.
 const b=ball(0,BALL_R,0,60,0,0);
 const r=ctx.momOnTarget(b);
 ok('ground shot from x=0 is on target',!!r,r);
 if(r){eq(' ...aimed at the +x goal',r.sx,1);eq(' ...predicted z',Math.round(r.z),0);
  ok(' ...y floored at the ball radius',r.y===BALL_R,r.y);
  eq(' ...closing speed carried',r.vx,60);}
}
{ // same shot from the DEF row (22.5 out) — the distance a real clearance is struck from
 ok('ground shot from the DEF row is on target',!!ctx.momOnTarget(ball(-37.5,BALL_R,0,70,0,0)));
}
{ // a genuine lob OVER the bar. Derived from F.goalH rather than written as a number: the
  // crossbar has moved before (8.5 -> 10.2) and a hardcoded fixture would quietly stop testing
  // the thing it is named after. vy solves y(t) = goalH +/- 2 at the plane.
 const x=50,vx=50,t=(F.L/2-x)/vx,y0=2;
 const vyFor=y=>(y-y0+.5*ctx.__c.GRAV*t*t)/t;
 eq('over the bar is NOT on target',ctx.momOnTarget(ball(x,y0,0,vx,vyFor(F.goalH+2),0)),null);
 ok('under the bar is on target',!!ctx.momOnTarget(ball(x,y0,0,vx,vyFor(F.goalH-2),0)));
}
eq('wide is not on target',ctx.momOnTarget(ball(0,BALL_R,0,60,0,40)),null);
eq('below minVX is not a shot',ctx.momOnTarget(ball(0,BALL_R,0,MOM.target.minVX-1,0,0)),null);
eq('beyond maxT is not a shot',ctx.momOnTarget(ball(-55,BALL_R,0,MOM.target.minVX+1,0,0)),null);
eq('already behind the line is not a shot',ctx.momOnTarget(ball(F.L/2+1,BALL_R,0,60,0,0)),null);
ok('...but a ball a whisker in FRONT of it still is',!!ctx.momOnTarget(ball(F.L/2-1,BALL_R,0,60,0,0)));
{
 const r=ctx.momOnTarget(ball(0,BALL_R,0,-60,0,0));
 ok('a shot the other way targets the -x goal',r&&r.sx===-1,r);
}
{ // big goal widens the end team 0 SCORES in (the right one), keyed off S.eff[0]
 const wide=F.goalHalf+1;
 resetS();
 eq('just outside the stock mouth is wide',ctx.momOnTarget(ball(0,BALL_R,0,60,0,wide)),null);
 resetS({eff:[{boost:0,frozen:0,big:1e9},{boost:0,frozen:0,big:0}]});
 ok('...and inside it once BIG GOAL widens the right goal',!!ctx.momOnTarget(ball(0,BALL_R,0,60,0,wide)));
 resetS({eff:[{boost:0,frozen:0,big:0},{boost:0,frozen:0,big:1e9}]});
 eq('...but the LEFT goal being big does not widen the right one',
    ctx.momOnTarget(ball(0,BALL_R,0,60,0,wide)),null);
}
resetS();
{ // gate: nothing is on target outside a live 'play' phase
 resetS({phase:'goal'});
 const b=ball(0,BALL_R,0,60,0,0);b.onT={sx:1};b.savePend={team:1,sx:1};
 ctx.momStep(b);
 ok('momStep clears state when the phase is not play',b.onT===null&&b.savePend===null);
 eq(' ...and fires nothing',fired.length,0);
}

/* =========================================================================
   2. momSaveTest — GK only, correct end, real shot
   ========================================================================= */
group('momSaveTest — the save gate');
function armed(){                      // a ball on target for the +x goal, hard
 resetS();
 const b=ball(40,BALL_R,0,80,0,0);
 b.onT=ctx.momOnTarget(b);
 ok('  (fixture is on target)',!!b.onT);
 return b;
}
{ const b=armed();ctx.momSaveTest(b,rod(1,'GK'),b.m.position);
  ok('defending GK arms a save',!!b.savePend,b.savePend); }
{ // THE constraint: a DEF in the identical state must fire nothing
  const b=armed();ctx.momSaveTest(b,rod(1,'DEF'),b.m.position);
  eq('defending DEF does NOT arm a save',b.savePend,null); }
{ const b=armed();ctx.momSaveTest(b,rod(1,'MID'),b.m.position);
  eq('MID does not arm a save',b.savePend,null); }
{ // the OTHER keeper touching a ball travelling away from its own goal
  const b=armed();ctx.momSaveTest(b,rod(0,'GK'),b.m.position);
  eq('the wrong end GK does not arm a save',b.savePend,null); }
{ const b=armed();b.onT.vx=MOM.save.minSpeed-1;ctx.momSaveTest(b,rod(1,'GK'),b.m.position);
  eq('a slow roller is not a save',b.savePend,null); }
{ const b=armed();b.onT=null;ctx.momSaveTest(b,rod(1,'GK'),b.m.position);
  eq('an off-target ball is not a save',b.savePend,null); }
{ const b=armed();b.tc={team:1,role:'DEF',swing:true,t:99};
  ctx.momSaveTest(b,rod(1,'GK'),b.m.position);
  eq('a backpass the keeper collects is not a save',b.savePend,null); }
{ // ...but a ball that came off our OWN defender passively still is
  const b=armed();b.tc={team:1,role:'DEF',swing:false,t:99};
  ctx.momSaveTest(b,rod(1,'GK'),b.m.position);
  ok('a deflection off our own defender still saves',!!b.savePend); }
{ const b=armed();b.saveCd=ctx.S.time-MOM.save.cd*.5;
  ctx.momSaveTest(b,rod(1,'GK'),b.m.position);
  eq('within the cooldown, no second save',b.savePend,null); }
{ const b=armed();b.saveCd=ctx.S.time-MOM.save.cd*1.5;
  ctx.momSaveTest(b,rod(1,'GK'),b.m.position);
  ok('past the cooldown, a save again',!!b.savePend); }
{ // near/far the line — the OFF THE LINE modifier
  const b=armed();b.m.position.x=F.L/2-MOM.save.lineDist*.5;
  ctx.momSaveTest(b,rod(1,'GK'),b.m.position);
  ok('a stop at the line is flagged near',b.savePend&&b.savePend.near===true,b.savePend);
  const c=armed();c.m.position.x=F.L/2-MOM.save.lineDist*2;
  ctx.momSaveTest(c,rod(1,'GK'),c.m.position);
  ok('a stop further out is not',c.savePend&&c.savePend.near===false,c.savePend); }

/* =========================================================================
   3. momStep — the deferred verdict
   ========================================================================= */
group('momStep — deferred save verdict');
{ // keeper knocked it away: no longer on target -> the save is confirmed
  resetS();
  const b=ball(50,BALL_R,0,-40,0,0);b.savePend={team:1,sx:1,near:false};
  ctx.momStep(b);
  ok('cleared away -> SAVE fires',fired.some(f=>f.m==='SAVE'),fired);
  eq(' ...credited to the keeper\'s team',ctx.S.stats.saves[1],1);
  eq(' ...and pinches time',ctx.S.timeScale,MOM.save.pinch);
  eq(' ...pending cleared',b.savePend,null); }
{ // keeper got a fingertip to it and it is STILL going in: say nothing
  resetS();
  const b=ball(50,BALL_R,0,60,0,0);b.savePend={team:1,sx:1,near:false};
  ctx.momStep(b);
  eq('a fingertip that is still going in fires nothing',fired.length,0);
  eq(' ...and no save is banked',ctx.S.stats.saves[1],0);
  ok(' ...but the projection is re-armed',!!b.onT); }
{ // thumped it back up the other end — different goal, so it was a save
  resetS();
  const b=ball(50,BALL_R,0,-80,0,0);b.savePend={team:1,sx:1,near:false};
  ctx.momStep(b);
  ok('cleared upfield -> SAVE fires',fired.some(f=>f.m==='SAVE')); }
{ resetS();
  const b=ball(50,BALL_R,0,-40,0,0);b.savePend={team:1,sx:1,near:true};
  ctx.momStep(b);
  ok('a stop on the line reads OFF THE LINE',fired.some(f=>f.m==='OFF THE LINE'),fired);
  eq(' ...with the deeper pinch',ctx.S.timeScale,MOM.save.linePinch); }

/* =========================================================================
   4. momWood
   ========================================================================= */
group('momWood — woodwork');
{ resetS();
  const b=ball(59,BALL_R,10,-30,0,0);b.tc={team:0,role:'ATT',swing:true,t:99};
  ctx.momWood(b,MOM.wood.minImp+5,0);
  ok('a rung post fires',fired.some(f=>f.m==='OFF THE POST'),fired);
  eq(' ...credited to whoever hit it',ctx.S.stats.woodwork[0],1);
  eq(' ...and arms the in-off-the-post line',b.wood,ctx.S.time);
  const n=fired.length;
  ctx.momWood(b,MOM.wood.minImp+5,1);
  eq('a rattle inside the cooldown is ONE moment',fired.length,n);
  ctx.S.time+=MOM.wood.cd*1.2;
  ctx.momWood(b,MOM.wood.minImp+5,1);
  ok('past the cooldown the bar fires on its own',fired.some(f=>f.m==='OFF THE BAR')); }
{ resetS();
  const b=ball(59,BALL_R,10,-1,0,0);
  ctx.momWood(b,MOM.wood.minImp-1,0);
  eq('a nudge below the threshold fires nothing',fired.length,0); }
{ // a ball loose in the goal box rings the same collider from BEHIND — not a near miss
  resetS();
  const deep=ball(F.L/2+ctx.__c.PHY.postRad+1,BALL_R,10,-30,0,0);
  ctx.momWood(deep,MOM.wood.minImp+20,0);
  eq('a post rung from behind the line fires nothing',fired.length,0);
  const front=ball(F.L/2-1,BALL_R,10,30,0,0);
  ctx.momWood(front,MOM.wood.minImp+20,0);
  ok('...but one rung from in front does',fired.some(f=>f.m==='OFF THE POST')); }

/* =========================================================================
   5. momKind — classification, and the PRIORITY between rules
   ========================================================================= */
group('momKind — goal classification');
const G=MOM.goal;
// helper: goal for team 0 (the +x end). p is the ball at the line.
function kind(team,o,sp,p){
 resetS();
 const b=ball(0,0,0,0,0,0);Object.assign(b,o||{});
 return ctx.momKind(team,b,sp,p||{x:F.L/2,y:BALL_R,z:0});
}
const swing=(team,x,z,t)=>({team,role:'ATT',swing:true,x,z,t:t===undefined?100:t});
const touch=(team,x,z,t)=>({team,role:'DEF',swing:false,x,z,t:t===undefined?100:t});
const near=swing(0,30,0);   // struck 30u from the +x line — inside longDist, so it can't leak in

eq('a plain goal falls through to the default pool',kind(0,{tc:near,shot:near},40),'default');
eq('fast -> screamer',kind(0,{tc:near,shot:near},G.spFast+1),'screamer');
eq('...at the threshold it is not',kind(0,{tc:near,shot:near},G.spFast),'default');
eq('slow -> scrappy',kind(0,{tc:near,shot:near},G.spSlow-1),'scrappy');
{ // CURL IS DEGREES OF PATH BENT, not spin. deg -> radians for the fixture.
 const rad=d=>d/57.2958;
 eq('a bent path -> curler',kind(0,{tc:near,shot:near,curl:rad(G.curlDeg+3)},40),'curler');
 eq('...bending the other way counts the same',kind(0,{tc:near,shot:near,curl:-rad(G.curlDeg+3)},40),'curler');
 eq('a path that barely bent is NOT a curler',kind(0,{tc:near,shot:near,curl:rad(G.curlDeg-3)},40),'default');
 eq('a curling ROCKET reads as a curler, not a screamer',
    kind(0,{tc:near,shot:near,curl:rad(G.curlDeg+3)},G.spFast+40),'curler');
 // THE REGRESSION THIS REPLACED: raw spin at the line said 'curler' for a shot that flew
 // straight. Spin is now irrelevant to the call — only the accumulated bend counts.
 eq('big spin on a straight path is NOT a curler',
    kind(0,{tc:near,shot:near,spin:2,curl:0},40),'default');
 eq('...and no spin left on a path that bent still IS one',
    kind(0,{tc:near,shot:near,spin:0,curl:rad(G.curlDeg+3)},40),'curler'); }
eq('high and wide in the mouth -> top bins',
   kind(0,{tc:near,shot:near},40,{x:F.L/2,y:F.goalH*G.topY+.5,z:F.goalHalf*G.topZ+.5}),'topBins');
eq('high but CENTRAL is not top bins',
   kind(0,{tc:near,shot:near},40,{x:F.L/2,y:F.goalH*G.topY+.5,z:0}),'default');
{ const far=swing(0,F.L/2-G.longDist-5,0);
  eq('struck from distance -> long range',kind(0,{tc:far,shot:far},40),'longRange'); }
{ // measured from where it was STRUCK, not from the last touch: a deflection 5u out after a
  // shot from the halfway line is a long-range goal, not a tap-in
  const far=swing(0,0,0,100),defl=touch(0,55,0,101);
  eq('distance is measured from the swing',kind(0,{tc:defl,shot:far},40),'longRange'); }
{ const defl=touch(1,50,0,101);
  eq('a passive touch after the shot -> deflected',
     kind(0,{tc:defl,shot:swing(0,30,0,100)},40),'deflected'); }
{ // OWN GOAL beats every other rule, including a post-and-in that also matches woodwork
  resetS();
  const og=swing(1,50,0);
  eq('a conceder\'s swing -> own goal',kind(0,{tc:og,shot:og},40),'ownGoal');
  eq('...even off the post',kind(0,{tc:og,shot:og,wood:ctx.S.time},40),'ownGoal');
  eq('...even at screamer pace',kind(0,{tc:og,shot:og},G.spFast+40),'ownGoal');
  eq('a conceder\'s PASSIVE deflection is not an own goal',
     kind(0,{tc:touch(1,50,0,101),shot:swing(0,30,0,100)},40),'deflected'); }
{ resetS();
  eq('a recent post -> in off the woodwork',kind(0,{tc:near,shot:near,wood:ctx.S.time-MOM.wood.recall*.5},40),'woodwork');
  eq('...and it beats a curler',kind(0,{tc:near,shot:near,wood:ctx.S.time-.1,spin:2},40),'woodwork');
  eq('a stale post does not',kind(0,{tc:near,shot:near,wood:ctx.S.time-MOM.wood.recall*2},40),'default'); }
{ // scoring at the OTHER end: an own goal is now team 0's swing, not team 1's
  const og=swing(0,-50,0);
  eq('own goal detection follows the conceding side',kind(1,{tc:og,shot:og},40),'ownGoal');
  const fine=swing(1,-30,0);
  eq('...and a normal goal there is normal',kind(1,{tc:fine,shot:fine},40),'default'); }

/* =========================================================================
   6. momGoal — the sub chip
   ========================================================================= */
group('momGoal — banner chip');
function goalChip(team,o,vx){
 resetS();
 const b=ball(F.L/2,BALL_R,0,vx,0,0);Object.assign(b,o||{});
 return ctx.momGoal(team,b);
}
{ const M=goalChip(0,{tc:near,shot:near},40);
 ok('the chip carries the pace in km/h',/ · \d+ KM\/H$/.test(M.sub),M.sub);
 eq(' ...converted with the same factor the win screen uses',
    M.sub.replace(/^.* · /,''),Math.round(40*G.kmh)+' KM/H');
 eq(' ...and takes the scoring team\'s colour',M.col,'#red'); }
{ const M=goalChip(0,{tc:near,shot:near},G.spFast+10);
 eq('a screamer picks from the screamer pool',MOM.lines.screamer.indexOf(M.sub.split(' · ')[0])>=0,true,M.sub);
 eq(' ...and reports it',M.kind,'screamer'); }
{ const og=swing(1,50,0),M=goalChip(0,{tc:og,shot:og},40);
 eq('an own goal reports its kind',M.kind,'ownGoal');
 eq(' ...takes the neutral accent, not the beneficiary\'s',M.col,MOM.ogCol);
 ok(' ...and groans',fired.some(f=>f.ch==='react'&&f.m==='groan'),fired); }
{ const M=goalChip(0,{tc:near,shot:near,t:{value:2}},40);
 ok('a golden ball keeps its x2 in the line slot',M.sub.indexOf('GOLDEN BALL')===0,M.sub);
 ok(' ...and still reports the pace',/KM\/H$/.test(M.sub),M.sub); }
{ // the off switch has to be exact: default pool, team colour, no speed
 resetS();MOM.on=false;
 const b=ball(F.L/2,BALL_R,0,90,0,0);b.tc=near;b.shot=near;
 const M=ctx.momGoal(0,b);
 ok('MOM.on:false falls back to HYPE',ctx.HYPE.indexOf(M.sub)>=0,M.sub);
 eq(' ...with the scoring team\'s colour',M.col,'#red');
 const gb=ball(F.L/2,BALL_R,0,90,0,0);gb.t={value:2};
 ok(' ...and the untouched golden string',ctx.momGoal(0,gb).sub.indexOf('GOLDEN BALL')===0);
 MOM.on=true; }
{ // showSpeed off drops the segment and nothing else
 MOM.goal.showSpeed=false;
 const M=goalChip(0,{tc:near,shot:near},40);
 ok('showSpeed:false drops the pace',M.sub.indexOf('KM/H')<0,M.sub);
 MOM.goal.showSpeed=true; }

/* =========================================================================
   7. momContact / momReset plumbing
   ========================================================================= */
group('momContact / momReset');
{ resetS();
 const b=ball(20,BALL_R,3,60,0,0);b.curl=1.2;
 ctx.momContact(b,rod(0,'ATT',0.05));
 eq('a swing restarts the bend accumulator',b.curl,0);
 ok('a swing writes both the contact and the shot record',b.tc&&b.shot&&b.tc===b.shot,b.tc);
 eq(' ...with the strike position',b.shot.x,20);
 ctx.S.time+=1;
 b.curl=0.7;
 ctx.momContact(b,rod(1,'DEF',-1));
 ok('a passive touch updates tc only',b.tc.team===1&&b.shot.team===0,{tc:b.tc,shot:b.shot});
 eq(' ...and leaves the bend alone',b.curl,0.7);
 ok(' ...and is later than the shot',b.tc.t>b.shot.t); }
{ resetS();
 const b=ball(20,BALL_R,3,60,0,0);
 b.onT={sx:1};b.savePend={};b.tc={};b.shot={};b.wood=5;b.woodCd=5;b.saveCd=5;b.curl=1;
 ctx.momReset(b);
 ok('momReset clears every record',
  b.onT===null&&b.savePend===null&&b.tc===null&&b.shot===null&&!b.wood&&!b.woodCd&&!b.saveCd&&!b.curl,b); }
{ resetS({trn:{}});
 const b=ball(20,BALL_R,3,60,0,0);
 ctx.momContact(b,rod(0,'ATT',0.05));
 eq('training fires nothing by default',b.tc,null);
 ctx.momWood(b,999,0);
 eq(' ...not even woodwork',fired.length,0);
 MOM.inTraining=true;
 ctx.momContact(b,rod(0,'ATT',0.05));
 ok(' ...unless inTraining is set',!!b.tc);
 MOM.inTraining=false; }

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
