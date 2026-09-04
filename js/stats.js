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
   STAMINA SCALES THE RATE, NOT THE DEPTH. `sta` multiplies BOTH channels through stTire, so a fit
   rod banks less from each swing AND crawls up the match clock more slowly — it takes longer to GET
   tired rather than shrugging tiredness off once tired. That is what the stat's name promises, and
   it is the only reading that makes the rod-hole ring (js/fx.js) mean anything: the gauge drains
   slowly on a fit rod and fast on a spent one, which is a thing a player can act on.

   THE ALGEBRA IS THE SAME AS THE OLD MODEL, which is why this was safe to change. It used to read
   `1 - fatMax*(1-sta/max)*ramp` — the stat scaling the PENALTY. Multiplication is associative, so
   moving that factor onto the ramp leaves `stFat` byte-identical at every stat value (asserted
   across sta 0..10 in tools/rodholes-harness.js). Only two things actually differ: what the ring
   shows, and `tireFloor` — which, above 0, is the one real balance change, because a sta=10 rod's
   old factor was exactly 0 and it therefore never tired at all.

   `stFat` is the ≤1 multiplier all of this produces. It feeds every tiring channel: slide speed (stSpeed), agility (stAgil),
   reaction (stReact), AI aim (stErr/stAim) and AI decisions (stIQ/stPred). Deliberately left OUT
   of shared execution (stHit/stGrip/stAccFrac/aimAssist) so a tired team plays sluggish + sloppy +
   dozy, but the HUMAN's kick feel never degrades. */
/* HOW FAST THIS ROD TIRES, as a multiplier on BOTH channels — 1 at sta 0, falling to `tireFloor`
   at sta max. Applied on the READ rather than where exertion is banked, so `r.exert` stays a plain
   count of swings for the debug (js/debug.js) and training (js/training.js) readouts that print
   it raw. */
function stTire(r){return Math.max(STC.tireFloor,1-ST(r,'sta')/STC.max);}
// 0..1 — how spent this rod is from SWINGING alone, independent of the clock. r.exert is banked by
// stExertKick (one unit a swing) and bled off by stExertTick; both are called from rods.js.
// Scaled by stTire, so the same twenty swings cost a fit rod less than a poor one.
function stExert(r){const K=STC.kickFat;return (K.on&&K.full>0)?clamp((r.exert||0)/K.full,0,1)*stTire(r):0;}
// Bank one swing's exertion. Called from kickRod — the ONE place every swing in the game passes
// through, human or AI, shot or pass. NOT charged per kick style on purpose: a pass is as much of a
// swing as a strike. seatOf(r) is the "a human is holding this right now" test; see
// CONFIG.stats.kickFat.userDrain for why a held rod is exempt by default.
function stExertKick(r){
 const K=STC.kickFat;
 if(!K.on)return;
 /* A held rod is exempt by default (userDrain) because a human swing is not cooldown-gated and a
    player mashing kick would nerf their own rod within seconds. A POWER swing is the exception: the
    trigger has to cost something or it is strictly better than not holding it, and control alone is
    a cost you only feel on the shots you miss. So a held rod still banks the EXTRA above an ordinary
    swing — mashing stays free, leaning on RT does not. */
 const ex=r.shotExert||1;
 if(!K.userDrain&&typeof seatOf==='function'&&seatOf(r)){
  if(ex<=1)return;
  r.exert=Math.min(K.full*K.cap,(r.exert||0)+K.per*(ex-1));return;
 }
 r.exert=Math.min(K.full*K.cap,(r.exert||0)+K.per*ex);
}
// Recovery. Ticked once per sim step from updateRods, alongside the rod's other cooldowns — the
// same set of phases in which a swing can happen, so both halves of the channel run on one clock.
function stExertTick(r,dt){if(r.exert>0)r.exert=Math.max(0,r.exert-STC.kickFat.recover*dt);}
/* HOW TIRED THIS ROD IS, 0..1 — the blend of the two channels, both already scaled by stTire, so
   this IS the per-rod answer rather than a stat-free one. It is what the rod-hole ring shows as a
   level (js/fx.js rodHoleFill), and it has to stay the number stFat is built from or the gauge and
   the slow-down it represents can drift apart.
   Each channel is clamped to 0..1 BEFORE stTire scales it, not after — and that order is the
   whole reason `stFat` stays byte-identical to the old model. stExertKick banks up to full*cap
   (1.25x full), so t*clamp(x) and clamp(t*x) differ exactly when x>1: scaling first would let a fit
   rod spend headroom that a poor rod has already had clipped away, quietly making high stamina
   better than the old maths ever made it. */
function stFatRamp(r){
 const K=STC.kickFat,w=K.on?clamp(K.weight,0,1):0;
 const clockR=clamp((S.matchTime-STC.fatStart)/(STC.fatEnd-STC.fatStart),0,1)*stTire(r);
 return clamp(w?clockR*(1-w)+stExert(r)*w:clockR,0,1);   // w=0 → the clock-only ramp, stat-scaled
}
function stFat(r){return 1-STC.fatMax*stFatRamp(r);}
function stSpeed(r){return Math.max(.2,(1+(ST(r,'spd')-STC.base)*STC.spd)*stFat(r));}
// AI slide AGILITY: scales the accel cap on an AI rod's direction changes (see updateRods). Keyed
// on spd too — a 'fast' rod both tops out higher AND reverses quicker — with its own coefficient so
// snappiness tunes apart from top speed. Fatigue folds in (tired = sluggish to change direction).
// AI-only: the user rod stays instant. Base 5 = ×1.
function stAgil(r){return Math.max(.2,(1+(ST(r,'spd')-STC.base)*STC.agil)*stFat(r));}
function stHit(r){return Math.max(.2,1+(ST(r,'str')-STC.base)*STC.str);}
// -1 at str 0, 0 at base, +1 at max: how far this rod's strength sits from neutral, signed. Scales
// the per-contact SPEED CEILING (js/physics.js capSpeed); stHit above is the impulse half of the
// same stat. Left out of the fatigue channels with the rest of shared execution - see the banner.
function stCapFrac(r){return clamp((ST(r,'str')-STC.base)/(STC.max-STC.base),-1,1);}
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
/* noPass — collideRod sets this when the contact that produced this call was NOT a clean front-face
   boot strike: a clip off the side or back of the foot box (passFaceOK, rods.js), or ANY contact that
   fell through to the rod capsule, which is the leg rather than the boot. Such a touch still deserves
   the ordinary goal-ward assist, but it must not be treated as a PASS — bending a stray deflection at
   the intended receiver is what made phantom passes look deliberate. It suppresses the pass TARGET
   only; r.passTo itself is left alone, so a later, cleaner contact in the same swing still passes. */
function aimAssist(b,r,noPass){
 // Decoupled from a hard accuracy gate: every rod gets a BASELINE bend (assistBase) so aiming
 // happens even with no build, and accuracy scales it up toward assistMax (and fades it toward 0
 // below base). Accuracy still matters — it just no longer switches aiming fully off at base.
 // A PASS (r.passTo, set by kickRod for that one swing) retargets the whole thing: the aim point
 // is a teammate rather than the goal mouth, and it gets its own — larger — bend, cone and speed
 // gate from CONFIG.ai.dribble.pass. A pass is a deliberate, aimed action and travels slower than
 // a shot, so the shot's assistMinVX (20) would skip it entirely.
 const PS=CONFIG.ai.dribble.pass,pass=(!noPass&&r.passTo)||null;
 const accFrac=(ST(r,'acc')-STC.base)/(STC.max-STC.base);        // −1 at acc 0, 0 at base, +1 at max
 let a=clamp(STC.assistBase+accFrac*(STC.assistMax-STC.assistBase),0,STC.assistMax);
 if(pass)a=Math.max(a,PS.assist);
 /* A deliberate player shot carries a CONTROL figure (js/shots.js): 1 inside the charge's sweet
    band, falling away either side of it and under the power trigger. It scales the bend, so a wild
    swing is aimed LESS as well as sprayed more — one number driving both halves of "less control",
    rather than a spray that an undiminished assist would keep quietly correcting. 1 for every AI
    contact and every unmodified human one. */
 if(r.shotOn)a*=clamp(r.shotCtl,0,1);
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
