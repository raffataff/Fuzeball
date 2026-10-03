'use strict';
// ================= moments =================
// saves, woodwork, and the classification that decides what the goal banner says; measured off state physics already computes (the classifier reads b.v at the goal test, the speed at the line)
// gate is momOn(): MOM.on plus a live 'play' phase; MOM.on:false restores the flat HYPE behaviour

// live? training is off by default (a time-pinch fights freeze/step)
// a trial counts as a match here on purpose: woodwork and saves are detected only here and stat objectives read them; momGoal still never fires in a trial
function momOn(){return MOM.on&&S.phase==='play'&&(!S.trn||MOM.inTraining||!!S.trial);}

// clear every per-ball record; from syncBall (any hard set of position), or a stale record credits the next goal to the last boot
function momReset(b){b.onT=null;b.savePend=null;b.tc=null;b.shot=null;b.wood=0;b.woodCd=0;b.saveCd=0;b.curl=0;}

// ---- on-target projection ----
// 'is this a shot at goal right now?': straight-line ballistic to the goal plane, spin not modelled; recomputed once per sim step (momStep), so a contact reads the pre-contact ball
// sx = which end (+1 = right goal, which team 1 defends)
function momOnTarget(b){
 const T=MOM.target,v=b.v,p=b.m.position;
 if(Math.abs(v.x)<T.minVX)return null;
 const sx=v.x>0?1:-1,t=(sx*F.L/2-p.x)/v.x;
 if(t<=0||t>T.maxT)return null;
 // big-goal power-up: S.eff[0].big widens the right goal (same indexing as stepBall)
 const gh=F.goalHalf*(S.eff[sx>0?0:1].big>S.time?PHY.bigGoalMult:1);
 // no 'y<0' rejection here and there must not be: a shot takes 0.4-1.0s to cross, so free-fall puts every ground shot below the pitch and a 'lands short' test would kill every save; only the crossbar rules a shot out
 const z=p.z+v.z*t,y=Math.max(BALL_R,p.y+v.y*t-.5*GRAV*t*t);
 if(Math.abs(z)>gh||y>F.goalH)return null;
 return{sx,z,y,t,vx:Math.abs(v.x)};
}
// per ball, once per sim step (physics.js, beside the topSpeed line): resolve a pending save against the post-contact velocity, then re-arm the projection
function momStep(b){
 if(!momOn()){b.onT=null;b.savePend=null;return;}
 const ot=momOnTarget(b),sp=b.savePend;
 if(sp){
  b.savePend=null;
  // the verdict is deferred one step: announcing at contact would shout SAVE over a fingertip touch still going in
  if(!ot||ot.sx!==sp.sx)momSave(sp);
 }
 b.onT=ot;
}
// ---- contact record ----
// written at the two S.lastTouch sites in collideRod; b.shot is the last swing, which 'from distance' is measured from
function momContact(b,r){
 if(!momOn())return;
 const p=b.m.position,sw=r.kickT>=0;
 momSaveTest(b,r,p);                      // reads b.tc — must run BEFORE it's overwritten
 const rec={team:r.team,role:r.role,swing:sw,x:p.x,z:p.z,t:S.time};
 // a swing starts a new shot, so the bend accumulator restarts; a passive touch doesn't reset it
 b.tc=rec;if(sw){b.shot=rec;b.curl=0;}
}
// GK only, by design: crediting the defence too would make the notice near-constant
function momSaveTest(b,r,p){
 const SV=MOM.save,ot=b.onT;
 if(!ot||r.role!=='GK')return;
 if(r.team!==(ot.sx>0?1:0))return;                 // not the end this keeper defends
 if(ot.vx<SV.minSpeed)return;                      // a roller arriving, not a shot
 if(b.tc&&b.tc.team===r.team&&b.tc.swing)return;   // our own backpass — collecting it isn't a save
 if(S.time-b.saveCd<SV.cd)return;                  // one save per shot, not one per substep contact
 b.saveCd=S.time;
 // a GK foot at full stretch reaches x~58.8 against a line at ±60, as close to a goal-line clearance as the geometry allows
 b.savePend={team:r.team,sx:ot.sx,near:Math.abs(p.x)>F.L/2-SV.lineDist};
}
function momSave(sp){
 const SV=MOM.save,n=sp.near;
 notice(n?'OFF THE LINE':'SAVE',n?SV.dur+.3:SV.dur,teamCol(sp.team));
 momPinch(n?SV.linePinch:SV.pinch);
 Au.react('ooh');
 if(S.stats)S.stats.saves[sp.team]++;
}
// ---- woodwork ----
// fires off the post/crossbar contacts goalFrameCollide already resolves; not gated on being on target; the impact threshold separates a ring from a nudge
function momWood(b,imp,bar){
 if(!momOn()||imp<MOM.wood.minImp||S.time-b.woodCd<MOM.wood.cd)return;
 // ...but only from in front: a lob rolling down the back of an upright is a dead ball, not a near miss (from postRad)
 if(Math.abs(b.m.position.x)>F.L/2+PHY.postRad)return;
 b.woodCd=b.wood=S.time;   // wood also arms the 'in off the post' goal line for MOM.wood.recall
 notice(bar?'OFF THE BAR':'OFF THE POST',MOM.wood.dur,'var(--gold)');
 momPinch(MOM.wood.pinch);
 Au.react('ooh');
 const t=b.tc?b.tc.team:S.lastTouch;
 if(S.stats&&t>=0)S.stats.woodwork[t]++;
}
// the time-pinch: a 0.2-0.3s dip on a near-miss (main.js ramps S.timeScale back at .9/s); min() so a shallow pinch can't undo a deeper one
function momPinch(v){S.timeScale=Math.min(S.timeScale,v);}

// ---- goal classification ----
// first match wins; curler outranks screamer (spin is rarer and more distinctive)
function momKind(team,b,sp,p){
 const G=MOM.goal,tc=b.tc,sh=b.shot;
 // own goal = the last contact was a swing by the conceding side; a passive deflection is the attacker's goal ('deflected')
 if(tc&&tc.swing&&tc.team===1-team)return'ownGoal';
 if(b.wood&&S.time-b.wood<MOM.wood.recall)return'woodwork';
 // curl is the path's total bend (b.curl, banked by the Magnus term in stepBall), not b.spin: a late graze leaves big spin on a straight ball
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
// seeded (js/rng.js) on its own 'line' stream so a recorded run reads back identically
function momPick(a){return rngPick(RNG.line,a);}
// builds the goal banner's sub chip and accent colour; call before removeBall (b.v is the velocity at the line); at most two segments (line, then pace), the golden ball's x2 takes the line slot
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
// ---- tuning readout (MOM.debug) ----
// every threshold in CONFIG.moments.goal is a guess until read against real play: one row per goal (measurement, threshold, whether the rule fired); console only
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
