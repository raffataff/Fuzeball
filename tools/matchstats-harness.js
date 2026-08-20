/* ===========================================================================
   tools/matchstats-harness.js   —   node tools/matchstats-harness.js
   Headless exercise of js/matchstats.js (FEATURE-IDEAS 1.4). No three.js, no DOM
   beyond a recording stub, no browser.

   Boots core + config + state + moments + matchstats in ONE vm context, so the
   real CONFIG.matchStats thresholds and the real momOnTarget projection are the
   ones under test — the alternative (re-declaring the numbers here) tests the
   harness, not the game.

   NOTE THE ALIAS HAND-OUT at the bottom of the source we build: MSTAT / F /
   BALL_R are top-level `const`s and are therefore LEXICAL, not properties of the
   context — ctx.MSTAT reads back `undefined` and every threshold silently becomes
   NaN, which looks exactly like passing tests. Same trap the moments harness hit.
   =========================================================================== */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,'js',f),'utf8');

/* ---- recording DOM stub -------------------------------------------------- */
const EL={};
function mkEl(id){
 return EL[id]={id,html:'',cls:'',classes:new Set(),vars:{},
  set innerHTML(v){this.html=v;},get innerHTML(){return this.html;},
  set className(v){this.cls=v;this.classes=new Set(v.split(/\s+/).filter(Boolean));},
  get className(){return this.cls;},
  style:{setProperty(k,v){EL[id].vars[k]=v;}},
  classList:{add(c){EL[id].classes.add(c);EL[id].cls=[...EL[id].classes].join(' ');},
             remove(c){EL[id].classes.delete(c);EL[id].cls=[...EL[id].classes].join(' ');},
             toggle(c,on){on?this.add(c):this.remove(c);},
             contains(c){return EL[id].classes.has(c);}}};
}
['winStats','winRods','winTabs','winTabMatch','winTabRods'].forEach(mkEl);

/* ---- context ------------------------------------------------------------- */
const ctx={console,Math,Date,JSON,Object,Array,String,Number,Boolean,isNaN,parseFloat,parseInt,
 localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
 document:{getElementById:id=>EL[id]||null,createElement:()=>mkEl('_tmp'),documentElement:{style:{setProperty(){}}}},
 navigator:{userAgent:'node'},
 // teamName/teamCol live in league.js, notice/Au elsewhere — stubbed, not loaded.
 teamName:t=>t?'BLUE':'RED', teamCol:t=>t?'#3d8bff':'#ff4d5a',
 notice(){}, Au:{react(){}}, globalThis:null};
ctx.globalThis=ctx;

let src=read('core.js')+read('config.js')+read('state.js')+read('moments.js')+read('matchstats.js');
// lexical top-level consts are NOT context properties — hand them out explicitly
src+=`\n;globalThis.__c={MSTAT,MOM,F,BALL_R,GRAV,PHY,S,freshStats,clamp,
 msReset,msRod,msRodOf,msKick,msContact,msShot,msSlide,msTick,msRallyReset,msRallyEnd,msGoal,
 msWinRender,msWinTab,msRow,msNum,msClock,momOnTarget,MS_ZERO,MS_ROLES};`;
vm.runInNewContext(src,ctx,{filename:'matchstats-harness-bundle.js'});
const C=ctx.__c;
const {MSTAT,F,S,freshStats,msReset,msRod,msRodOf,msKick,msContact,msSlide,msTick,
       msRallyReset,msRallyEnd,msGoal,msWinRender,msWinTab,MS_ZERO}=C;

/* ---- assertions ---------------------------------------------------------- */
let pass=0,fail=0;
function ok(cond,label,extra){
 if(cond){pass++;return;}
 fail++;console.log('  FAIL  '+label+(extra!==undefined?'   ['+extra+']':''));
}
const eq=(a,b,label)=>ok(a===b,label,'got '+JSON.stringify(a)+' want '+JSON.stringify(b));
const near=(a,b,tol,label)=>ok(Math.abs(a-b)<=tol,label,'got '+a+' want ~'+b);
function head(t){console.log('\n'+t);}

/* ---- fixtures ------------------------------------------------------------ */
function V(x,y,z){return{x,y,z,length(){return Math.hypot(this.x,this.y,this.z);}};}
function ball(x,y,z,vx,vy,vz){
 const b={m:{position:{x,y,z}},v:V(vx,vy,vz),cur:{x,y,z}};
 msReset(b);return b;
}
// role -> the rod x from CONFIG.rods.defs, so the fixtures sit where the real rods do
function rod(team,role,kicking){
 const d=ctx.__c.MSTAT&&null;
 const xs={0:{GK:-52.5,DEF:-37.5,MID:-7.5,ATT:22.5},1:{GK:52.5,DEF:37.5,MID:7.5,ATT:-22.5}};
 return{team,role,x:xs[team][role],kickT:kicking?0.02:-1,msSw:false};
}
function match(){
 S.stats=freshStats();S.phase='play';S.time=10;S.matchTime=0;S.balls=[];
 S.eff=[{boost:0,frozen:0,big:0},{boost:0,frozen:0,big:0}];
 return S.stats;
}
// a fresh swing: what kickRod does to the latch
const swing=r=>{r.kickT=0.02;r.msSw=false;return r;};

/* =========================================================================
   1. wiring — the CUP trap: an alias that resolves to undefined is silent
   ========================================================================= */
head('1. config + shape');
ok(MSTAT&&typeof MSTAT==='object','MSTAT alias resolves (CONFIG.matchStats is nested where the alias reads)');
eq(MSTAT.on,true,'matchStats.on defaults true');
ok(MSTAT.shotVX>0&&MSTAT.shotWide>0&&MSTAT.passT>0,'thresholds are live numbers, not undefined');
near(MSTAT.m*(1/MSTAT.kmh)*3.6,1,1e-5,'m per unit is DERIVED from kmh (m/s = kmh/3.6), not guessed');
const st0=freshStats();
['kicks','poss','saves','woodwork','shots','onTarget','passes','hardest','dist'].forEach(k=>
 ok(Array.isArray(st0[k])&&st0[k].length===2&&st0[k][0]===0,'freshStats.'+k+' is a zeroed [t0,t1]'));
eq(st0.terr.length,MSTAT.thirds,'freshStats.terr is sized from CONFIG.matchStats.thirds');
eq(st0.scorers.length,0,'freshStats.scorers empty');
eq(Object.keys(st0.rods).length,0,'freshStats.rods empty (buckets are lazy)');
ok(freshStats()!==st0&&freshStats().kicks!==st0.kicks,'freshStats hands out a NEW object each match (the msRod cache leans on this)');

/* =========================================================================
   2. SHOTS — attempt vs on target
   ========================================================================= */
head('2. shots / on target');
let st=match();
// red (team 0) attacks +x. Struck hard, dead straight at the right goal from the halfway line.
let r=rod(0,'ATT',true), b=ball(0,C.BALL_R,0, 60,0,0);
msContact(b,r);
eq(st.shots[0],1,'a hard goalward swing is a shot');
eq(st.onTarget[0],1,'...and dead straight down the middle is on target');
eq(st.shots[1],0,'nothing credited to the other side');
near(st.hardest[0],60,.01,'hardest hit banked from the swing');

// same swing, second contact in the same swing (the ball rattling along the boot)
st=match();r=rod(0,'ATT',true);b=ball(0,C.BALL_R,0,60,0,0);
msContact(b,r);msContact(b,r);msContact(b,r);
eq(st.shots[0],1,'ONE attempt per swing, not one per contact (the r.msSw latch)');
swing(r);msContact(b,r);
eq(st.shots[0],2,'...and a NEW swing counts again');

// too slow to be an attempt
st=match();r=rod(0,'ATT',true);b=ball(0,C.BALL_R,0,MSTAT.shotVX-1,0,0);
msContact(b,r);
eq(st.shots[0],0,'under shotVX is a touch, not an attempt');

// sprayed miles wide -> not even an attempt
st=match();r=rod(0,'MID',true);b=ball(0,C.BALL_R,0, 40,0,40);   // 45 deg across a 67.5u run
msContact(b,r);
eq(st.shots[0],0,'a ball sent way outside shotWide goal-widths is a clearance/switch, not a shot');

// on target vs off target, same speed
st=match();r=rod(0,'ATT',true);b=ball(30,C.BALL_R,0, 60,0,0);
msContact(b,r);
eq(st.onTarget[0],1,'straight at goal from 30u: on target');
st=match();r=rod(0,'ATT',true);b=ball(30,C.BALL_R,0, 60,0,26);  // 13u of drift over 30u => z=26 > goalHalf 11
msContact(b,r);
eq(st.shots[0],1,'wide of the post but inside shotWide: still an attempt');
eq(st.onTarget[0],0,'...and NOT on target');

// the trap the moments work documented: a GROUND shot from distance must not be
// rejected by free-fall. This is the assertion that catches a re-introduced y<0 test.
st=match();r=rod(0,'DEF',true);b=ball(-37.5,C.BALL_R,0, 70,0,0);
msContact(b,r);
eq(st.onTarget[0],1,'a rolling shot from the DEFENSIVE third is on target (no ballistic short-landing rejection)');

// wrong way: red swinging back toward its own goal is not a red shot
st=match();r=rod(0,'DEF',true);b=ball(-20,C.BALL_R,0, -60,0,0);
msContact(b,r);
eq(st.shots[0],0,'a ball driven toward our OWN goal is not a shot for us');

// blue mirrors exactly
st=match();r=rod(1,'ATT',true);b=ball(0,C.BALL_R,0, -60,0,0);
msContact(b,r);
eq(st.shots[1],1,'blue attacks -x: mirrored attempt');
eq(st.onTarget[1],1,'...mirrored on target');

// a lob that LANDS SHORT is still on target — the ball is on the deck and it bounces and
// keeps coming. Only the crossbar rules a shot out. This pins the design note in moments.js.
st=match();r=rod(0,'ATT',true);b=ball(30,C.BALL_R,0, 60,60,0);
msContact(b,r);
eq(st.shots[0],1,'a lob is an attempt');
eq(st.onTarget[0],1,'a lob whose ballistic arc lands SHORT is still on target — it bounces and keeps coming');
// genuinely over the crossbar (y at the goal plane above F.goalH) is not
st=match();r=rod(0,'ATT',true);b=ball(50,C.BALL_R,0, 50,80,0);
msContact(b,r);
eq(st.shots[0],1,'a ballooned shot is still an attempt');
eq(st.onTarget[0],0,'...but clearing the crossbar is NOT on target');

// a passive touch (not mid-swing) is never a shot
st=match();r=rod(0,'ATT',false);b=ball(0,C.BALL_R,0, 60,0,0);
msContact(b,r);
eq(st.shots[0],0,'a passive deflection is not a shot');
eq(st.hardest[0],0,'...and does not set hardest hit');

/* =========================================================================
   3. PASSES
   ========================================================================= */
head('3. passes completed');
st=match();
let a=rod(0,'DEF',true), c=rod(0,'MID',false), opp=rod(1,'MID',false);
b=ball(-37.5,C.BALL_R,0, 40,0,0);
msContact(b,a);                 // struck by red DEF
S.time+=0.5;
msContact(b,c);                 // received by red MID
eq(st.passes[0],1,'DEF swing -> MID receives = one completed pass');
eq(msRodOf(0,'DEF').passes,1,'...credited to the rod that PLAYED it, not the receiver');
eq(st.passes[1],0,'nothing for the other side');

st=match();b=ball(-37.5,C.BALL_R,0,40,0,0);
a=rod(0,'DEF',true);msContact(b,a);
S.time+=MSTAT.passT+0.1;
msContact(b,rod(0,'MID',false));
eq(st.passes[0],0,'past passT the ball WANDERED there — not a pass');

st=match();b=ball(-37.5,C.BALL_R,0,40,0,0);
a=rod(0,'DEF',true);msContact(b,a);S.time+=0.2;
msContact(b,opp);S.time+=0.2;
msContact(b,rod(0,'MID',false));
eq(st.passes[0],0,'an opponent touch in between breaks the chain');

st=match();b=ball(-37.5,C.BALL_R,0,40,0,0);
a=rod(0,'DEF',true);msContact(b,a);S.time+=0.2;
msContact(b,a);
eq(st.passes[0],0,'the SAME rod touching it again is not a pass to itself');

st=match();b=ball(-37.5,C.BALL_R,0,40,0,0);
a=rod(0,'DEF',false);msContact(b,a);S.time+=0.2;   // passive deflection off DEF
msContact(b,rod(0,'MID',false));
eq(st.passes[0],0,'a ball that deflected off a teammate was not PLAYED there');

st=match();b=ball(-37.5,C.BALL_R,0,40,0,0);
a=rod(0,'DEF',true);msContact(b,a);S.time+=0.3;
msContact(b,rod(0,'MID',false));                    // trapped, not swung at
eq(st.passes[0],1,'the RECEIVING touch need not be a swing — trapping it is receiving it');

st=match();b=ball(-37.5,C.BALL_R,0,40,0,0);
a=rod(0,'DEF',true);msContact(b,a);
msReset(b);                                          // a re-drop / split teleports the ball
S.time+=0.2;msContact(b,rod(0,'MID',false));
eq(st.passes[0],0,'msReset (syncBall) breaks the chain — a record must not survive a teleport');

/* =========================================================================
   4. GOALS — scorer credit, own goals, deflections
   ========================================================================= */
head('4. goals');
st=match();S.matchTime=84;
b=ball(59,C.BALL_R,0, 60,0,0);
msContact(b,swing(rod(0,'ATT',true)));
msGoal(0,b);
eq(st.scorers.length,1,'one scorer logged');
eq(st.scorers[0].team,0,'credited to the scoring team');
eq(st.scorers[0].role,'ATT','...to the rod that struck it');
eq(st.scorers[0].own,false,'not an own goal');
eq(st.scorers[0].t,84,'stamped with the match clock');
eq(msRodOf(0,'ATT').goals,1,'per-rod goal banked');

// own goal: the CONCEDING side's swing was the last contact
st=match();
b=ball(-59,C.BALL_R,0,-60,0,0);
msContact(b,swing(rod(1,'DEF',true)));    // blue defender belts it into his own net (left goal = red scores)
msGoal(0,b);
eq(st.scorers[0].own,true,'last contact a SWING by the conceding side = own goal');
eq(st.scorers[0].team,0,'listed under the team that BENEFITED');
eq(st.scorers[0].role,'DEF','...naming the conceding rod');
eq(msRodOf(1,'DEF').og,1,'own goal banked against that rod');
eq(msRodOf(1,'DEF').goals,0,'...and NOT as a goal for it');

// deflection: attacker strikes, defender passively touches it in
st=match();
b=ball(40,C.BALL_R,0,60,0,0);
msContact(b,swing(rod(0,'ATT',true)));    // red strikes
S.time+=0.2;
msContact(b,rod(1,'DEF',false));          // passive touch off the blue defender
msGoal(0,b);
eq(st.scorers[0].own,false,'a PASSIVE deflection off a defender is not an own goal');
eq(st.scorers[0].role,'ATT','...it stays the striker’s goal (credit reads the last SWING)');
eq(msRodOf(0,'ATT').goals,1,'striker credited through the deflection');

// no contact record at all (a served ball rolling in) must not throw
st=match();b=ball(59,C.BALL_R,0,60,0,0);
msGoal(0,b);
eq(st.scorers.length,1,'a goal with no contact record still logs');
eq(st.scorers[0].role,'','...with an empty role rather than a crash');

/* =========================================================================
   5. TERRITORY + RALLY
   ========================================================================= */
head('5. territory + rally clock');
st=match();
S.balls=[{cur:{x:-50}}];msTick(1);            // red's third
S.balls=[{cur:{x:0}}];msTick(1);              // middle
S.balls=[{cur:{x:50}}];msTick(2);             // blue's third
near(st.terr[0],1,1e-9,'terr[0] is the third team 0 DEFENDS (world -x)');
near(st.terr[1],1,1e-9,'middle third');
near(st.terr[2],2,1e-9,'terr[last] is team 1’s third');
near(st.rally,4,1e-9,'rally clock runs with play');
S.balls=[{cur:{x:-59.9}}];msTick(1);
S.balls=[{cur:{x:59.9}}];msTick(1);
near(st.terr[0],2,1e-9,'a ball on the goal line clamps into the end bucket, not out of range');
near(st.terr[2],3,1e-9,'...both ends');

st=match();
S.balls=[{cur:{x:-50}},{cur:{x:50}}];msTick(1);
near(st.terr[0],0.5,1e-9,'multi-ball splits dt between LIVE balls rather than reading balls[0]');
near(st.terr[2],0.5,1e-9,'...evenly');
near(st.rally,1,1e-9,'the rally clock is not multiplied by the ball count');

st=match();S.balls=[{cur:{x:0}}];
S.phase='goal';msTick(1);
near(st.rally,0,1e-9,'nothing accrues outside the play phase');
S.phase='play';S.balls=[];msTick(1);
near(st.rally,0,1e-9,'...or with no ball on the table');

st=match();S.balls=[{cur:{x:0}}];
msTick(5);msRallyEnd();
msTick(9);msRallyEnd();
msTick(3);msRallyEnd();
near(st.longRally,9,1e-9,'longest rally is the MAX, not the last');
near(st.rally,0,1e-9,'...and the clock restarts each time');
msTick(2);msRallyReset();
near(st.rally,0,1e-9,'a serve resets the running clock');
msTick(1);msRallyEnd();
near(st.longRally,9,1e-9,'a reset rally cannot beat a longer completed one');

/* =========================================================================
   6. ROD WORK + the bucket cache
   ========================================================================= */
head('6. rod distance + bucket cache');
st=match();
const rr=rod(0,'MID',false);
msSlide(rr,3);msSlide(rr,4);
near(st.dist[0],7,1e-9,'slide distance accumulates for the team');
near(msRodOf(0,'MID').dist,7,1e-9,'...and for the rod');
S.phase='goal';msSlide(rr,100);
near(st.dist[0],7,1e-9,'shuffling back into shape during a goal celebration is not billed');
S.phase='play';msSlide(rr,-5);msSlide(rr,0);
near(st.dist[0],7,1e-9,'a negative or zero delta is ignored');

// THE CACHE SAFETY PROPERTY: a new match must not be written into the old bucket.
const oldBucket=msRod(rr);
const st2=match();
msSlide(rr,10);
near(oldBucket.dist,7,1e-9,'last match’s bucket is untouched by this match');
near(msRodOf(0,'MID').dist,10,1e-9,'...the new stats object got the work');
ok(msRod(rr)!==oldBucket,'the rod-side cache re-resolved against the NEW stats identity');
eq(MS_ZERO.dist,0,'MS_ZERO still zero (it is handed out, so it is frozen)');
try{MS_ZERO.dist=99;}catch(e){}
eq(MS_ZERO.dist,0,'...and a stray write cannot poison every empty rod');

/* =========================================================================
   7. KICKS — the counter that predates this file
   ========================================================================= */
head('7. kicks');
st=match();
const k=rod(0,'ATT',true);
msKick(k);msKick(k);msKick(rod(1,'GK',true));
eq(st.kicks[0],2,'team kick count');
eq(st.kicks[1],1,'...per team');
eq(msRodOf(0,'ATT').kicks,2,'per-rod kick count');
MSTAT.on=false;st=match();msKick(k);
eq(st.kicks[0],1,'MSTAT.on:false still counts TEAM kicks — the legacy panel prints them');
eq(Object.keys(st.rods).length,0,'...but banks no per-rod bucket');
MSTAT.on=true;

/* =========================================================================
   8. THE SHEET
   ========================================================================= */
head('8. post-match sheet');
st=match();
st.poss=[62,38];st.shots=[9,4];st.onTarget=[5,1];st.passes=[12,7];
st.saves=[1,4];st.woodwork=[2,0];st.kicks=[88,71];st.hardest=[120,96];st.dist=[1000,2000];
st.terr=[20,50,30];st.topSpeed=110;st.longRally=13.42;
st.scorers=[{team:0,role:'MID',own:false,t:35},{team:1,role:'ATT',own:false,t:70},{team:0,role:'DEF',own:true,t:95}];
msRod(rod(0,'ATT',false)).goals=2;
msWinRender();
const H=EL.winStats.html, R=EL.winRods.html;
eq(EL.winStats.className,'msSheet','sheet class applied');
eq(EL.winStats.vars['--t0'],'#ff4d5a','--t0 comes from teamCol(), not --c0 (a custom kit must paint the bars)');
eq(EL.winStats.vars['--t1'],'#3d8bff','--t1 likewise');
['Possession','Shots','On target','Passes','Saves','Woodwork','Kicks','Hardest hit','Rod distance']
 .forEach(l=>ok(H.indexOf('>'+l+'<')>=0,'row present: '+l));
ok(H.indexOf('>62%<')>=0&&H.indexOf('>38%<')>=0,'possession printed as a percentage');
ok(H.indexOf('width:69.23%')>=0,'shots bar split 9:4 = 69.23% / 30.77%',H.match(/width:[\d.]+%/g));
ok(H.indexOf('width:30.77%')>=0,'...the other half');
ok(H.indexOf('42 km/h')>=0,'hardest hit converted to km/h (120 x .35)');
ok(H.indexOf('97 m')>=0&&H.indexOf('194 m')>=0,'rod distance converted to metres (1000u = 97m)');
ok(H.indexOf('>39 km/h top ball speed')<0&&H.indexOf('39</em> km/h top ball speed')>=0,'footer: top ball speed in km/h');
ok(H.indexOf('13.4</em> s longest rally')>=0,'footer: longest rally to one decimal');
// territory
ok(H.indexOf('class="a" style="width:20.00%"')>=0,'territory segment a = 20%');
ok(H.indexOf('class="m" style="width:50.00%"')>=0,'territory segment m = 50%');
ok(H.indexOf('class="b" style="width:30.00%"')>=0,'territory segment b = 30%');
ok(H.indexOf('RED third')>=0&&H.indexOf('Midfield')>=0&&H.indexOf('BLUE third')>=0,'territory key names both ends and the middle');
// scorers
ok(H.indexOf('MID<em>0:35</em>')>=0,'scorer chip: role + clock');
ok(H.indexOf('DEF (OG)<em>1:35</em>')>=0,'own goal marked (OG) and listed under the beneficiary');
ok(H.indexOf('msG og')>=0,'own-goal chip takes the gold class');
const l0=H.indexOf('msScCol l'),l1=H.indexOf('msScCol r');
ok(l0<H.indexOf('MID<em>')&&H.indexOf('ATT<em>')>l1,'each team’s goals land in its own column');
// zero v zero must NOT split 50/50
st=match();msWinRender();
ok(EL.winStats.html.indexOf('width:0.00%')>=0,'0 v 0 leaves the track EMPTY — a half-and-half bar would read as "even"');
ok(EL.winStats.html.indexOf('width:50.00%')<0,'...and specifically does not split down the middle');
// rods tab
ok(R.indexOf('msRods')>=0,'rods tab built');
['GK','DEF','MID','ATT'].forEach(role=>ok(R.split('>'+role+'<').length>=3,'rods tab lists '+role+' for BOTH teams'));
ok(R.indexOf('RED')>=0&&R.indexOf('BLUE')>=0,'rods tab names both teams');

/* tabs */
head('9. tabs');
st=match();msWinRender();
ok(!EL.winStats.classList.contains('hidden'),'render opens on MATCH');
ok(EL.winRods.classList.contains('hidden'),'...with RODS hidden');
ok(EL.winTabMatch.classList.contains('on')&&!EL.winTabRods.classList.contains('on'),'MATCH tab button lit');
msWinTab('rods');
ok(EL.winStats.classList.contains('hidden')&&!EL.winRods.classList.contains('hidden'),'switch to RODS');
ok(EL.winTabRods.classList.contains('on')&&!EL.winTabMatch.classList.contains('on'),'...button state follows');
msWinRender();
ok(!EL.winStats.classList.contains('hidden'),'a re-render (rematch) reopens on MATCH rather than inheriting the last tab');
ok(!EL.winTabs.classList.contains('hidden'),'tab bar shown');

/* off switch */
head('10. MSTAT.on:false is a true revert');
MSTAT.on=false;
st=match();st.poss=[60,40];st.kicks=[10,20];st.topSpeed=100;
msWinRender();
eq(EL.winStats.className,'msLegacy','falls back to the ORIGINAL three-number panel');
ok(EL.winStats.html.indexOf('Possession')>=0&&EL.winStats.html.indexOf('Kicks')>=0,'...with its two rows');
ok(EL.winStats.html.indexOf('Top ball speed: 35 km/h')>=0,'...and the top-speed line');
ok(EL.winStats.html.indexOf('msBar')<0,'no comparison bars');
ok(EL.winTabs.classList.contains('hidden'),'tab bar dropped entirely');
ok(EL.winRods.classList.contains('hidden'),'rods tab dropped');
st=match();
const rOff=rod(0,'ATT',true),bOff=ball(0,C.BALL_R,0,60,0,0);
msContact(bOff,rOff);msSlide(rOff,5);S.balls=[{cur:{x:0}}];msTick(1);msGoal(0,bOff);
eq(st.shots[0],0,'no shots counted');eq(st.dist[0],0,'no distance counted');
near(st.terr[1],0,1e-9,'no territory counted');eq(st.scorers.length,0,'no scorers logged');
MSTAT.on=true;

/* =========================================================================
   summary
   ========================================================================= */
console.log('\n'+(fail?'FAILED':'PASSED')+'  '+pass+' assertions, '+fail+' failures');
process.exit(fail?1:0);
