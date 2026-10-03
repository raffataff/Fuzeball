'use strict';
/* ================= rod stats ================= */
// lookup is lazy: r.stats (per rod), S.teamStats[team][role or ALL], CONFIG.stats.base
// league mode fills S.teamStats per match; console test: S.teamStats=[{ALL:{spd:9,str:9,acc:9,ctl:9,rea:9,sta:9}},null]
const STC=CONFIG.stats;
function ST(r,k){const t=S.teamStats&&S.teamStats[r.team],s=r.stats||(t&&(t[r.role]||t.ALL)),v=s&&s[k];return v==null?STC.base:v;}
// ---- stamina ----
// two channels on one budget (STC.fatMax), blended by STC.kickFat.weight: A the clock (a ramp over matchTime, 0 until fatStart, full at fatEnd), B exertion (this rod's own swinging, r.exert)
// `sta` scales the rate, not the depth: it multiplies both channels through stTire, so a fit rod takes longer to tire (what the rod-hole ring in js/fx.js shows)
// `stFat` (<=1) feeds slide speed, agility, reaction, AI aim and AI decisions; shared execution (stHit/stGrip/stAccFrac/aimAssist) is left out so a tired team plays sluggish but the human's kick never degrades
// how fast this rod tires: 1 at sta 0 falling to `tireFloor` at sta max; applied on the read so r.exert stays a plain swing count
function stTire(r){return Math.max(STC.tireFloor,1-ST(r,'sta')/STC.max);}
// 0..1: how spent this rod is from swinging; r.exert is banked by stExertKick and bled by stExertTick (from rods.js); scaled by stTire
function stExert(r){const K=STC.kickFat;return (K.on&&K.full>0)?clamp((r.exert||0)/K.full,0,1)*stTire(r):0;}
// bank one swing's exertion, from kickRod (every swing passes there); not charged per style; see CONFIG.stats.kickFat.userDrain
function stExertKick(r){
 const K=STC.kickFat;
 if(!K.on)return;
 // a held rod is exempt by default (a human can mash kick), but a power swing still banks the extra, so leaning on RT costs something
 const ex=r.shotExert||1;
 if(!K.userDrain&&typeof seatOf==='function'&&seatOf(r)){
  if(ex<=1)return;
  r.exert=Math.min(K.full*K.cap,(r.exert||0)+K.per*(ex-1));return;
 }
 r.exert=Math.min(K.full*K.cap,(r.exert||0)+K.per*ex);
}
// recovery: ticked once per sim step from updateRods alongside the rod's other cooldowns
function stExertTick(r,dt){if(r.exert>0)r.exert=Math.max(0,r.exert-STC.kickFat.recover*dt);}
// how tired this rod is, 0..1: the blend of both channels (already scaled by stTire); the rod-hole ring shows it and stFat is built from it
// each channel is clamped before stTire scales it, or a fit rod would spend headroom a poor rod has had clipped
function stFatRamp(r){
 const K=STC.kickFat,w=K.on?clamp(K.weight,0,1):0;
 const clockR=clamp((S.matchTime-STC.fatStart)/(STC.fatEnd-STC.fatStart),0,1)*stTire(r);
 return clamp(w?clockR*(1-w)+stExert(r)*w:clockR,0,1);   // w=0 → the clock-only ramp, stat-scaled
}
function stFat(r){return 1-STC.fatMax*stFatRamp(r);}
function stSpeed(r){return Math.max(.2,(1+(ST(r,'spd')-STC.base)*STC.spd)*stFat(r));}
// AI slide agility: scales the accel cap on direction changes (updateRods); keyed on spd with its own coefficient; fatigue folds in; AI-only; base 5 = x1
function stAgil(r){return Math.max(.2,(1+(ST(r,'spd')-STC.base)*STC.agil)*stFat(r));}
function stHit(r){return Math.max(.2,1+(ST(r,'str')-STC.base)*STC.str);}
// -1 at str 0, 0 at base, +1 at max: scales the per-contact speed ceiling (physics.js capSpeed); stHit is the impulse half of the same stat
function stCapFrac(r){return clamp((ST(r,'str')-STC.base)/(STC.max-STC.base),-1,1);}
function stGrip(r){return clamp(KICK.grip*(1+(ST(r,'ctl')-STC.base)*STC.ctl),0,.6);}
function stReact(r){return Math.max(.2,1-(ST(r,'rea')-STC.base)*STC.rea)/stFat(r);}
function stCd(r){return Math.max(.25,1-(ST(r,'rea')-STC.base)*STC.cd);}
function stErr(r){return Math.max(.15,(1-(ST(r,'acc')-STC.base)*STC.accErr)/stFat(r));}   // wander error GROWS when tired (÷stFat, like stReact)
function stAim(r,a){return clamp((a+(ST(r,'acc')-STC.base)*STC.accAim)*stFat(r),0,1);}    // goal-aim precision fades when tired
// 0..1 fraction of a rod's acc stat above base, scaling the sweet-spot power bonus (see collideRod)
function stAccFrac(r){return clamp((ST(r,'acc')-STC.base)/(STC.max-STC.base),0,1);}
// decision intelligence multiplier on the difficulty's iq roll (ai.js); base 5 = 1; fatigue folds in
function stIQ(r){return Math.max(0,(1+(ST(r,'iq')-STC.base)*STC.iq)*stFat(r));}
// anticipation: scales the AI's prediction lead (D.pred); homed on iq, floored; fatigue fades it but never below predFloor
function stPred(r){return Math.max(STC.predFloor,(1+(ST(r,'iq')-STC.base)*STC.predIq)*stFat(r));}
// kick aim-assist: bend the outgoing shot's heading toward the goal-mouth centre; a pure horizontal rotation (no energy), only above base accuracy, on goalward shots near the target cone, clamped small
// noPass: collideRod sets it for a contact that wasn't a clean front-face boot strike (passFaceOK in rods.js, or the capsule): the ordinary assist applies but the pass target is suppressed
function aimAssist(b,r,noPass){
 // every rod gets a baseline bend (assistBase), accuracy scales it toward assistMax
 // a pass (r.passTo, set by kickRod) retargets to a teammate with its own larger bend, cone and speed gate (CONFIG.ai.dribble.pass)
 const PS=CONFIG.ai.dribble.pass,pass=(!noPass&&r.passTo)||null;
 const accFrac=(ST(r,'acc')-STC.base)/(STC.max-STC.base);        // −1 at acc 0, 0 at base, +1 at max
 let a=clamp(STC.assistBase+accFrac*(STC.assistMax-STC.assistBase),0,STC.assistMax);
 if(pass)a=Math.max(a,PS.assist);
 // a player shot's control figure (js/shots.js): 1 in the sweet band, falling either side and under the power trigger; a wild swing is aimed less as well as sprayed more
 if(r.shotOn)a*=clamp(r.shotCtl,0,1);
 if(a<=0)return;
 const dir=r.team===0?1:-1,v=b.v,p=b.m.position;
 if(v.x*dir<(pass?PS.assistMinVX:STC.assistMinVX))return;
 // aim at the receiver on a pass, else the rod's gap when gap-aiming, else the goal-mouth centre (z=0)
 const tx=pass?pass.x:dir*F.L/2;
 const tz=pass?pass.z:((r.aimEv&&CONFIG.ai.gapAim.gap)?r.aimEv.best.tz:0);
 const cur=Math.atan2(v.z,v.x*dir),want=Math.atan2(tz-p.z,(tx-p.x)*dir);
 let da=want-cur;if(da>Math.PI)da-=2*Math.PI;else if(da<-Math.PI)da+=2*Math.PI;
 if(Math.abs(da)>(pass?PS.assistCone:STC.assistCone))return;
 const th=clamp(da,-a,a)*dir,cs=Math.cos(th),sn=Math.sin(th),vx=v.x,vz=v.z;
 v.x=vx*cs-vz*sn;v.z=vx*sn+vz*cs;
}
// WALL PLAY: the side-of-the-boot strike (CONFIG.ai.wallPlay)
// an end man stops two units short of a wall ball, so a strike on one only runs down the wall; a forward strike on a wall ball now leaves infield, aimed like aimAssist but clamped into [minAng,maxAng]
// a pure heading rotation (no energy); worked in (forward, infield) coordinates so one expression serves both teams and walls
function wallAssist(b,r,noPass){
 const W=AIC.wallPlay;
 if(!W||!W.on||(!W.human&&isUserRod(r)))return;
 const p=b.m.position,v=b.v;
 if(F.W/2-Math.abs(p.z)-BALL_R>W.gap)return;             // not on the wall
 const dir=r.kickDir;
 if(r.angVel*dir<W.minW)return;                             // a block, not a strike
 const u=v.x*dir;if(u<W.minVX)return;                       // only a ball leaving forward
 const sz=p.z>0?-1:1,w=v.z*sz;                              // +w = heading away from the wall
 const pass=(!noPass&&r.passTo)||null;
 const tx=pass?pass.x:dir*F.L/2,tz=pass?pass.z:((r.aimEv&&AIC.gapAim.gap)?r.aimEv.best.tz:0);
 const want=clamp(Math.atan2((tz-p.z)*sz,(tx-p.x)*dir),W.minAng,W.maxAng);
 const th=want-Math.atan2(w,u);
 if(th<=0)return;                                           // already leaving at least that far infield
 const cs=Math.cos(th),sn=Math.sin(th);
 v.x=(u*cs-w*sn)*dir;v.z=(u*sn+w*cs)*sz;
 if(dbgLogRod===r)dbgRod(r,'WALL','off the wall +'+(th*57.3).toFixed(0)+'° → '+(want*57.3).toFixed(0)+'° infield');
}
