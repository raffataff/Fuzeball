'use strict';
/* ================= moments =================================================
   The game reacting to what just happened. Three things live here: keeper SAVES,
   WOODWORK, and the classification that decides what the goal banner SAYS.

   Everything is measured off state physics already computes — no new bookkeeping
   in the hot path beyond a per-ball contact record. In particular the goal
   classifier reads b.v at the instant the goal test passes, which IS the speed at
   the line: onGoal is called from inside stepBall, before anything can touch the
   ball again.

   Cross-module gate is momOn() — MOM.on plus a live 'play' phase. MOM.on:false
   restores the old flat-HYPE behaviour exactly, including the banner colour.
   ========================================================================== */

/* Live? Training is OFF by default: a time-pinch fights freeze/step, and the
   sandbox is for tuning a swing, not for being told about it. */
/* A TRIAL COUNTS AS A MATCH HERE, and that is deliberate rather than an oversight in the training
   gate. MOM.inTraining is off because a time-pinch fights the sandbox's freeze/step — but a trial
   disables both of those, and it NEEDS this tier: woodwork and saves are detected here and nowhere
   else, and S.stats.woodwork/saves are what a stat objective reads. Without this clause a woodwork
   trial is silently unwinnable. momGoal still never fires in a trial (onGoal returns early for
   training), so the goal banner stays the trial HUD's job. */
function momOn(){return MOM.on&&S.phase==='play'&&(!S.trn||MOM.inTraining||!!S.trial);}

/* Clear every per-ball record. Called from syncBall, i.e. after ANY hard set of
   the position (serve, re-drop, split, NaN recovery) — a shot record that
   survived a teleport would credit the next rally's goal to the last one's boot. */
function momReset(b){b.onT=null;b.savePend=null;b.tc=null;b.shot=null;b.wood=0;b.woodCd=0;b.saveCd=0;b.curl=0;}

/* ---- on-target projection ------------------------------------------------
   "Is this a shot at goal right now?" — straight-line ballistic to the goal
   plane. The spin curve is DELIBERATELY not modelled: this gates a save, it
   isn't a physics oracle, and a curler that bends in off a projection that said
   'wide' is a better save, not a bug. Recomputed once per SIM STEP (momStep),
   never per substep — so every contact inside a step reads the state from BEFORE
   that step, which is exactly the pre-contact ball a save has to be judged on.
   sx = which end: +1 the right goal (team 0 scores there, so TEAM 1 defends it). */
function momOnTarget(b){
 const T=MOM.target,v=b.v,p=b.m.position;
 if(Math.abs(v.x)<T.minVX)return null;
 const sx=v.x>0?1:-1,t=(sx*F.L/2-p.x)/v.x;
 if(t<=0||t>T.maxT)return null;
 // big-goal power-up: S.eff[0].big widens the RIGHT goal — same indexing as stepBall's own test
 const gh=F.goalHalf*(S.eff[sx>0?0:1].big>S.time?PHY.bigGoalMult:1);
 // THERE IS NO 'y<0' REJECTION HERE AND THERE MUST NOT BE. The obvious form of this test —
 // "reject if the projection lands short or long" — kills the whole feature: a shot spends
 // 0.4-1.0s crossing the table and free-fall over that is 20-125 units, so a ballistic
 // projection puts every GROUND shot struck more than ~16u out well below the pitch. That
 // rejects the ordinary rolling shot, which is most of them, and the keeper never saves
 // anything. Only the crossbar can rule a shot out; a ball that would 'land' short is on the
 // deck, and a ball on the deck bounces (floorRest) and keeps coming.
 // The floor clamp changes no verdict — it makes the reported y honest for anything that
 // later wants it (and stops a -120 turning up in a debug readout).
 const z=p.z+v.z*t,y=Math.max(BALL_R,p.y+v.y*t-.5*GRAV*t*t);
 if(Math.abs(z)>gh||y>F.goalH)return null;
 return{sx,z,y,t,vx:Math.abs(v.x)};
}
/* Per-ball, once per sim step (physics.js, beside the topSpeed line).
   Resolves a pending save against the POST-contact velocity, then re-arms the
   projection for the next step. */
function momStep(b){
 if(!momOn()){b.onT=null;b.savePend=null;return;}
 const ot=momOnTarget(b),sp=b.savePend;
 if(sp){
  b.savePend=null;
  // Verdict is deferred exactly one step ON PURPOSE. Announcing at contact time
  // would shout SAVE over a shot the keeper only got a fingertip to and which is
  // still going in — the notice would land a beat before the goal banner. Still
  // on target for the SAME end = a touch, not a save.
  if(!ot||ot.sx!==sp.sx)momSave(sp);
 }
 b.onT=ot;
}
/* ---- contact record ------------------------------------------------------
   Written at the two S.lastTouch sites in collideRod. One record answers own
   goal, deflection and shot distance; b.shot is the last SWING specifically,
   which is the thing "from distance" has to be measured from — a ball that
   trickles 40u after a deflection wasn't struck from 40u out. */
function momContact(b,r){
 if(!momOn())return;
 const p=b.m.position,sw=r.kickT>=0;
 momSaveTest(b,r,p);                      // reads b.tc — must run BEFORE it's overwritten
 const rec={team:r.team,role:r.role,swing:sw,x:p.x,z:p.z,t:S.time};
 // a SWING starts a new shot, so the bend accumulator restarts with it: the question the
 // classifier asks is 'did THIS shot bend', not 'how far has this ball turned since kick-off'.
 // Deliberately NOT reset by a passive touch — a deflection doesn't add to b.curl anyway (only
 // the Magnus term does), and the shot it came off is still the thing being described.
 b.tc=rec;if(sw){b.shot=rec;b.curl=0;}
}
/* GK ONLY, and that is a design line rather than an oversight: the keeper is the
   one rod whose entire job this is. Crediting the defence too makes the notice
   near-constant — an event that fires every rally stops being an event. */
function momSaveTest(b,r,p){
 const SV=MOM.save,ot=b.onT;
 if(!ot||r.role!=='GK')return;
 if(r.team!==(ot.sx>0?1:0))return;                 // not the end this keeper defends
 if(ot.vx<SV.minSpeed)return;                      // a roller arriving, not a shot
 if(b.tc&&b.tc.team===r.team&&b.tc.swing)return;   // our own backpass — collecting it isn't a save
 if(S.time-b.saveCd<SV.cd)return;                  // one save per shot, not one per substep contact
 b.saveCd=S.time;
 // A GK foot at full stretch reaches x~58.8 against a line at +/-60, so this is as
 // close to a goal-line clearance as the geometry allows — no other rod can be
 // near the line at all, which is why it's a MODIFIER here and not its own detector.
 b.savePend={team:r.team,sx:ot.sx,near:Math.abs(p.x)>F.L/2-SV.lineDist};
}
function momSave(sp){
 const SV=MOM.save,n=sp.near;
 notice(n?'OFF THE LINE':'SAVE',n?SV.dur+.3:SV.dur,teamCol(sp.team));
 momPinch(n?SV.linePinch:SV.pinch);
 Au.react('ooh');
 if(S.stats)S.stats.saves[sp.team]++;
}
/* ---- woodwork ------------------------------------------------------------
   Fires off the post/crossbar contacts goalFrameCollide ALREADY resolves — the
   gasp was the one thing that hit was missing. Not gated on being on target: a
   post rung from a wild angle is still woodwork, and the impact threshold is
   what separates a ring from a nudge. */
function momWood(b,imp,bar){
 if(!momOn()||imp<MOM.wood.minImp||S.time-b.woodCd<MOM.wood.cd)return;
 // ...but only from IN FRONT. goalFrameCollide also resolves the posts for a ball loose in the
 // goal box — an over-the-bar lob that landed on the net roof and rolled down the back of an
 // upright rings exactly the same collider, and that is a dead ball being fiddled with, not a
 // near miss. Woodwork is drama because it ALMOST went in. Derived from postRad rather than a
 // knob: a contact from the front or the side sits at or inside the line, one from behind can't.
 if(Math.abs(b.m.position.x)>F.L/2+PHY.postRad)return;
 b.woodCd=b.wood=S.time;   // wood also arms the 'in off the post' goal line for MOM.wood.recall
 notice(bar?'OFF THE BAR':'OFF THE POST',MOM.wood.dur,'var(--gold)');
 momPinch(MOM.wood.pinch);
 Au.react('ooh');
 const t=b.tc?b.tc.team:S.lastTouch;
 if(S.stats&&t>=0)S.stats.woodwork[t]++;
}
/* The time-pinch, and it is the whole point of the tier: a 0.2-0.3s dip on a
   near-miss is the strongest hand-made signal available for one assignment.
   No new machinery — main.js already ramps S.timeScale back at .9/s. min() so a
   shallower pinch can't undo a deeper one that's still recovering. */
function momPinch(v){S.timeScale=Math.min(S.timeScale,v);}

/* ---- goal classification -------------------------------------------------
   FIRST MATCH WINS, in the order below. Curler outranks screamer deliberately:
   spin is the rarer and more distinctive event, and a rocket that also bent is
   better described as a curler than as one more screamer. */
function momKind(team,b,sp,p){
 const G=MOM.goal,tc=b.tc,sh=b.shot;
 // own goal = the LAST contact was a swing by the conceding side. A passive
 // deflection off a defender is NOT one — that's the attacker's goal, and it
 // falls through to 'deflected' below, which is the fair call.
 if(tc&&tc.swing&&tc.team===1-team)return'ownGoal';
 if(b.wood&&S.time-b.wood<MOM.wood.recall)return'woodwork';
 // CURL IS MEASURED AS THE PATH'S TOTAL BEND, NOT AS b.spin. Raw spin at the line is the wrong
 // signal in both directions: a late graze in front of goal leaves big spin on a ball that flew
 // dead straight, and a hard early curler has mostly DECAYED by the time it crosses. The Magnus
 // term in stepBall banks the real heading change into b.curl, so this reads what the eye saw.
 if(Math.abs(b.curl)*57.2958>G.curlDeg)return'curler';
 if(sp>G.spFast)return'screamer';
 const gh=F.goalHalf*(S.eff[team].big>S.time?PHY.bigGoalMult:1);   // scoring team's target end
 if(p.y>F.goalH*G.topY&&Math.abs(p.z)>gh*G.topZ)return'topBins';
 const src=sh||tc;
 if(src&&Math.hypot((team===0?F.L/2:-F.L/2)-src.x,src.z)>G.longDist)return'longRange';
 if(tc&&sh&&tc.t>sh.t)return'deflected';
 if(sp<G.spSlow)return'scrappy';
 return'default';
}
// Seeded (js/rng.js) on its own 'line' stream. Cosmetic - but a RECORDED run should read back
// identically, and it costs nothing to keep the banner text in the reproducible set.
function momPick(a){return rngPick(RNG.line,a);}
/* Builds the goal banner's sub chip and accent colour. MUST be called before
   removeBall — b.v is the velocity at the line and the mesh is freed a line later.
   Chip is always at most two segments: <line> then the pace. The golden ball's x2
   is information rather than flavour, so it takes the line slot outright. */
function momGoal(team,b){
 const val=b.t.value||1,gold=val>1?'GOLDEN BALL · ×2':null;
 if(!MOM.on)return{sub:gold||momPick(HYPE),col:teamCol(team),kind:''};
 const G=MOM.goal,sp=b.v.length(),kind=momKind(team,b,sp,b.m.position);
 if(MOM.debug)momLog(team,b,sp,kind);
 const line=gold||momPick(MOM.lines[kind]||HYPE);
 if(kind==='ownGoal')Au.react('groan');
 return{sub:G.showSpeed?line+' · '+Math.round(sp*G.kmh)+' KM/H':line,
        col:kind==='ownGoal'?MOM.ogCol:teamCol(team),kind};
}
/* ---- tuning readout (MOM.debug) ------------------------------------------
   Every threshold in CONFIG.moments.goal is a guess until it has been read against real play,
   and none of what a goal is judged on is visible from the pitch — which is how the curler test
   spent a session firing on shots that flew straight. One row per goal: the measurement, the
   threshold it was tested against, and whether that rule fired. Set MOM.debug and play a match;
   the column that is wrong will be obvious, and the knob is named in the row.
   Console only, deliberately — this is dev chatter and must never land on screen. */
function momLog(team,b,sp,kind){
 const G=MOM.goal,p=b.m.position,src=b.shot||b.tc,
  deg=Math.abs(b.curl)*57.2958,
  dist=src?Math.hypot((team===0?F.L/2:-F.L/2)-src.x,src.z):0,
  gh=F.goalHalf*(S.eff[team].big>S.time?PHY.bigGoalMult:1),
  row=(rule,got,knob,lim,hit)=>({rule,measured:Math.round(got*10)/10,knob,threshold:lim,fired:hit});
 console.log('%c'+teamName(team)+' goal -> '+kind.toUpperCase(),'color:#ffcf4d;font-weight:bold');
 console.table([
  row('screamer',sp,'goal.spFast',G.spFast,sp>G.spFast),
  row('scrappy',sp,'goal.spSlow',G.spSlow,sp<G.spSlow),
  row('curler',deg,'goal.curlDeg (deg bent)',G.curlDeg,deg>G.curlDeg),
  row('longRange',dist,'goal.longDist',G.longDist,dist>G.longDist),
  row('topBins y',p.y,'goal.topY x goalH',Math.round(F.goalH*G.topY*10)/10,p.y>F.goalH*G.topY),
  row('topBins |z|',Math.abs(p.z),'goal.topZ x goalHalf',Math.round(gh*G.topZ*10)/10,Math.abs(p.z)>gh*G.topZ)
 ]);
 console.log(' spin at line '+(Math.round(b.spin*100)/100)+'  ·  struck by team '+(src?src.team:'-')+
  ' at x='+(src?Math.round(src.x):'-')+'  ·  last touch '+(b.tc?b.tc.team+(b.tc.swing?' (swing)':' (passive)'):'none')+
  '  ·  woodwork '+(b.wood&&S.time-b.wood<MOM.wood.recall?'yes':'no'));
}
