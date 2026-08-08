'use strict';
/* ================= rod stats ================= */
// Lookup is lazy so nothing needs wiring at build time:
//   r.stats (per rod) → S.teamStats[team][role or ALL] → CONFIG.stats.base.
// League mode fills S.teamStats per match; console test:
//   S.teamStats=[{ALL:{spd:9,str:9,acc:9,ctl:9,rea:9,sta:9}},null]
const STC=CONFIG.stats;
function ST(r,k){const t=S.teamStats&&S.teamStats[r.team],s=r.stats||(t&&(t[r.role]||t.ALL)),v=s&&s[k];return v==null?STC.base:v;}
/* ---- stamina -------------------------------------------------------------------------------
   TWO channels, sharing ONE budget (STC.fatMax), blended by STC.kickFat.weight:
     A · the CLOCK   — a uniform ramp over the matchTime window (0 until fatStart, full at fatEnd).
     B · EXERTION    — this rod's own accumulated swinging (r.exert), so the rods that do the work
                       are the ones that are spent by the whistle instead of everyone fading alike.
   `stFat` is the ≤1 multiplier both produce, scaled by how far sta sits below max — sta=10 never
   fades at all (which is what makes sta the SINGLE stamina knob, and why neither channel scales
   itself by it again). It feeds every tiring channel: slide speed (stSpeed), agility (stAgil),
   reaction (stReact), AI aim (stErr/stAim) and AI decisions (stIQ/stPred). Deliberately left OUT
   of shared execution (stHit/stGrip/stAccFrac/aimAssist) so a tired team plays sluggish + sloppy +
   dozy, but the HUMAN's kick feel never degrades. */
// 0..1 — how spent this rod is from SWINGING alone, independent of the clock. r.exert is banked by
// stExertKick (one unit a swing) and bled off by stExertTick; both are called from rods.js.
function stExert(r){const K=STC.kickFat;return (K.on&&K.full>0)?clamp((r.exert||0)/K.full,0,1):0;}
// Bank one swing's exertion. Called from kickRod — the ONE place every swing in the game passes
// through, human or AI, shot or pass. NOT charged per kick style on purpose: a pass is as much of a
// swing as a strike. seatOf(r) is the "a human is holding this right now" test; see
// CONFIG.stats.kickFat.userDrain for why a held rod is exempt by default.
function stExertKick(r){
 const K=STC.kickFat;
 if(!K.on)return;
 if(!K.userDrain&&typeof seatOf==='function'&&seatOf(r))return;
 r.exert=Math.min(K.full*K.cap,(r.exert||0)+K.per);
}
// Recovery. Ticked once per sim step from updateRods, alongside the rod's other cooldowns — the
// same set of phases in which a swing can happen, so both halves of the channel run on one clock.
function stExertTick(r,dt){if(r.exert>0)r.exert=Math.max(0,r.exert-STC.kickFat.recover*dt);}
function stFat(r){
 const K=STC.kickFat,w=K.on?clamp(K.weight,0,1):0;
 const clockR=clamp((S.matchTime-STC.fatStart)/(STC.fatEnd-STC.fatStart),0,1);
 const ramp=w?clockR*(1-w)+stExert(r)*w:clockR;   // w=0 → byte-identical to the old clock-only ramp
 return 1-STC.fatMax*(1-ST(r,'sta')/STC.max)*ramp;
}
function stSpeed(r){return Math.max(.2,(1+(ST(r,'spd')-STC.base)*STC.spd)*stFat(r));}
// AI slide AGILITY: scales the accel cap on an AI rod's direction changes (see updateRods). Keyed
// on spd too — a 'fast' rod both tops out higher AND reverses quicker — with its own coefficient so
// snappiness tunes apart from top speed. Fatigue folds in (tired = sluggish to change direction).
// AI-only: the user rod stays instant. Base 5 = ×1.
function stAgil(r){return Math.max(.2,(1+(ST(r,'spd')-STC.base)*STC.agil)*stFat(r));}
function stHit(r){return Math.max(.2,1+(ST(r,'str')-STC.base)*STC.str);}
function stGrip(r){return clamp(KICK.grip*(1+(ST(r,'ctl')-STC.base)*STC.ctl),0,.6);}
function stReact(r){return Math.max(.2,1-(ST(r,'rea')-STC.base)*STC.rea)/stFat(r);}
function stCd(r){return Math.max(.25,1-(ST(r,'rea')-STC.base)*STC.cd);}
function stErr(r){return Math.max(.15,(1-(ST(r,'acc')-STC.base)*STC.accErr)/stFat(r));}   // wander error GROWS when tired (÷stFat, like stReact)
function stAim(r,a){return clamp((a+(ST(r,'acc')-STC.base)*STC.accAim)*stFat(r),0,1);}    // goal-aim precision fades when tired
// 0..1 fraction of a rod's acc stat ABOVE base — how far toward max accuracy it is.
// Used to scale the sweet-spot power bonus (see collideRod): base 5 → 0, max 10 → 1.
function stAccFrac(r){return clamp((ST(r,'acc')-STC.base)/(STC.max-STC.base),0,1);}
// Decision intelligence multiplier on the difficulty's base iq roll (see ai.js). Base 5 = 1
// (unchanged); higher = more likely to trap/wait for the sweet spot, lower = greedier. Fatigue
// folds in — a tired team makes fewer clever plays.
function stIQ(r){return Math.max(0,(1+(ST(r,'iq')-STC.base)*STC.iq)*stFat(r));}
// Ball-trajectory anticipation: scales the AI's prediction LEAD (D.pred) — how far ahead of a
// moving ball a rod positions. Homed on iq (reading the play is cognition, not execution), kept
// gentle and FLOORED so a low-iq team predicts a bit worse, not helplessly. Fatigue fades it too
// (tired = reads the play late), but never below predFloor. Base 5 = ×1.
function stPred(r){return Math.max(STC.predFloor,(1+(ST(r,'iq')-STC.base)*STC.predIq)*stFat(r));}
// Kick aim-assist: bend the outgoing shot's heading toward the goal-mouth centre.
// Pure horizontal rotation (Magnus-style) — adds no energy, so it's stable. Only
// acts above base accuracy, only on goalward shots already near the target cone,
// and the bend is clamped small — it sweetens good strikes, it can't rescue bad ones.
function aimAssist(b,r){
 // Decoupled from a hard accuracy gate: every rod gets a BASELINE bend (assistBase) so aiming
 // happens even with no build, and accuracy scales it up toward assistMax (and fades it toward 0
 // below base). Accuracy still matters — it just no longer switches aiming fully off at base.
 // A PASS (r.passTo, set by kickRod for that one swing) retargets the whole thing: the aim point
 // is a teammate rather than the goal mouth, and it gets its own — larger — bend, cone and speed
 // gate from CONFIG.ai.dribble.pass. A pass is a deliberate, aimed action and travels slower than
 // a shot, so the shot's assistMinVX (20) would skip it entirely.
 const PS=CONFIG.ai.dribble.pass,pass=r.passTo||null;
 const accFrac=(ST(r,'acc')-STC.base)/(STC.max-STC.base);        // −1 at acc 0, 0 at base, +1 at max
 let a=clamp(STC.assistBase+accFrac*(STC.assistMax-STC.assistBase),0,STC.assistMax);
 if(pass)a=Math.max(a,PS.assist);
 if(a<=0)return;
 const dir=r.team===0?1:-1,v=b.v,p=b.m.position;
 if(v.x*dir<(pass?PS.assistMinVX:STC.assistMinVX))return;
 // aim at the receiver on a pass; else the rod's chosen gap when gap-aiming this frame, else the
 // goal-mouth centre (z=0). tx is the goal line in the non-pass case, exactly as before.
 const tx=pass?pass.x:dir*F.L/2;
 const tz=pass?pass.z:((r.aimEv&&CONFIG.ai.gapAim.gap)?r.aimEv.best.tz:0);
 const cur=Math.atan2(v.z,v.x*dir),want=Math.atan2(tz-p.z,(tx-p.x)*dir);
 let da=want-cur;if(da>Math.PI)da-=2*Math.PI;else if(da<-Math.PI)da+=2*Math.PI;
 if(Math.abs(da)>(pass?PS.assistCone:STC.assistCone))return;
 const th=clamp(da,-a,a)*dir,cs=Math.cos(th),sn=Math.sin(th),vx=v.x,vz=v.z;
 v.x=vx*cs-vz*sn;v.z=vx*sn+vz*cs;
}
