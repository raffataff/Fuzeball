'use strict';
/* ================= shots — the player's kick VERBS =================
   The player's whole move set was slide / kick / raise: ONE kick, the same every time, while
   ai.js has had `trapShot`, `passShot`, a dribble and an aimed pass since 2026-07-28. This file
   is the human half of that — a modifier AXIS that colours a kick, and a CHARGE that powers it.

   TWO THINGS MAKE IT CHEAP, and both are reuse rather than new machinery:

   · POWER ALREADY FALLS OUT OF THE ARC. kickRod captures r.kickA0 (the angle the swing STARTS
     from) and updateRods ramps kickA0 -> strikeA over a FIXED `strike` window. So a deeper
     pull-back is a bigger arc in the same time, i.e. a higher angVel, i.e. a bigger vn at contact
     and a harder hit. A charge is a pull-back. Nothing had to be invented for that.
   · THE WIND-UP HAZARD IS ALREADY SOLVED. Pulling a boot back over a ball at the feet drags it
     toward our own goal — that is exactly the trap knock-back of 2026-08-15, and sweepClips (ai.js)
     already answers "does rotating from a0 to a1 shove this ball backward". shotPullCap walks the
     same ladder trapAngle does, so a charge can NEVER wind up through the ball.

   THE AXIS IS ONE NUMBER: mod = RT depth - LT depth, in -1 (finesse) .. +1 (power). Holding both
   cancels toward 0, which is what a two-trigger chord ought to mean given each trigger's own
   meaning — so the chord needs no special case anywhere, and in Total Control the same two
   triggers already bend the SLIDE the same way round. One meaning per trigger, both modes.

   WHAT IS DIFFERENT BETWEEN THE MODES IS ONLY WHERE THE WIND-UP LIVES, and that follows from what
   the right stick is:
     · TOTAL CONTROL — the stick IS the rod, so the pull-back is something the player already does
       with their thumb. The two triggers held TOGETHER arm it: stick back + both triggers = the
       charge builds, and the player's own forward flick is the release. The triggers otherwise
       scale how fast the rod TRACKS the stick (heavy under LT, snappy under RT) rather than
       blending a curve, because in that mode there is no curve — the stick is the swing.
     · CLASSIC — there is no stick pull-back, so a trigger has to hold it. RT does
       (cfg.padChargeBtn), the kick button stays instant, and the axis blends the swing CURVE
       between CONFIG.shots.mod.soft and .hard.

   THE ONE THING THAT MUST NOT REGRESS: a tapped kick button with no trigger held is byte-identical
   to the kick that shipped — it fires on PRESS, on CONFIG.kick's own curve, with shotOn false. Any
   scheme that charges on the plain kick button has to defer the swing to RELEASE, which puts the
   tap's own duration (~60ms) in front of a contact that currently lands at ~17ms. That is offered
   as cfg.padChargeBtn 'kick'/'both' and is deliberately NOT the default.

   WHAT PHYSICS READS is three flat fields and nothing else: r.shotOn / r.shotPow / r.shotCtl —
   "what is this rod's NEXT contact worth". Flat because collideRod reads them per man per substep.
   That indirection is also what lets a Total Control stick swing carry a charge at all: there is no
   kickRod call in that path, so a swing-time style block could never have described it.

   TREMBLE IS DISPLAY ONLY (r.trem, added on the render pivot in main.js). The loss of control is
   already modelled — it is shotCtl, which scales the aim assist and opens shotSpray. Putting the
   shake in r.angle would feed angVel = (angle-prevAngle)/dt and a trembling boot would kick the
   ball it is resting against: an own-goal generator dressed as a readout.

   CONFIG.shots.on:false restores the pre-shots pad exactly — RT kicks, LT raises, no charge, no
   pass, no spray, shotOn never set. This file is INERT then, not merely quiet.

   THIS IS CORE, not an optional module. It loads between ai.js (whose sweepClips and passPick it
   reads) and input.js (whose whole pad path now runs through it), and it is deliberately NOT
   typeof-guarded the way S.trn / S.photo / S.redit are: those are features whose absence must not
   break a match, whereas a missing shots.js is a missing controller, and a guard would only move
   the failure one line later. physics.js is the exception and reads r.shotOn — a plain field that
   is simply undefined without this file — so a contact can never depend on it having loaded. */

const SHOTC=CONFIG.shots;
function shotsOn(){return !!(SHOTC&&SHOTC.on);}

/* ---- the modifier axis ------------------------------------------------------------------- */
// One analog trigger, rescaled past its deadzone. Triggers rest noisy, and an axis built from raw
// values would mean the rod never sits at a true neutral.
function shotTrigD(gp,i){
 const b=gp&&gp.buttons&&gp.buttons[i];if(!b)return 0;
 const v=(b.value!=null?b.value:(b.pressed?1:0)),d=SHOTC.mod.dead;
 return v>d?clamp((v-d)/(1-d),0,1):0;
}
function shotAxis(lt,rt){return clamp(rt-lt,-1,1);}
// The axis straight off a pad — what input.js hands shotFire on an ordinary button press so the
// triggers colour that swing too. 0 with shots off, i.e. the plain kick that always shipped.
function shotPadAxis(gp){return shotsOn()?shotAxis(shotTrigD(gp,6),shotTrigD(gp,7)):0;}
// Both triggers meaningfully down — the Total Control charge chord. Tested on DEPTH, not on
// `pressed`: a trigger reports pressed from a few percent of travel on some pads, which would arm
// a charge off a resting finger.
function shotChord(lt,rt){return lt>SHOTC.mod.dead&&rt>SHOTC.mod.dead;}

/* ---- what the axis is worth -------------------------------------------------------------- */
// Every one of these is EXACTLY 1 (or CONFIG.kick untouched) at m=0, which is what makes an
// unmodified kick indistinguishable from the one that shipped.
function shotAxisPow(m){const M=SHOTC.mod;return m<0?lerp(1,M.softPow,-m):lerp(1,M.hardPow,m);}
function shotAxisCtl(m){const M=SHOTC.mod;return m<0?lerp(1,M.softCtl,-m):lerp(1,M.hardCtl,m);}
function shotAxisTrack(m){const M=SHOTC.mod;return m<0?lerp(1,M.softTrack,-m):lerp(1,M.hardTrack,m);}
function shotAxisExert(m){const M=SHOTC.mod;return m>0?lerp(1,M.hardExert,m):1;}
/* ---- the HOLD (L2) ----------------------------------------------------------------------- */
/* The finesse trigger makes the boot sticky, which is the player's counterpart to holdCfg's
   trap/dribble blocks — see CONFIG.shots.hold for why there was no way to trap by hand at all.
   Written into the ROD'S OWN block rather than returning a config object: the values are blended
   by squeeze depth, two seats can be holding two rods at different depths in the same frame, and
   collideRod reads the result per man per substep, so nothing here may allocate.
   NEUTRAL BASE. At the engage threshold it is exactly kick.rest / stGrip / full slide speed, i.e.
   the same contact as no trigger at all, so the grip eases in rather than stepping. */
function shotHoldUpdate(r,lt){
 const H=SHOTC&&SHOTC.hold,h=r.hold;
 if(!h)return;
 // A live wind-up cancels it: you are charging to strike, not to dribble — and a sticky boot
 // would fight shotPullCap, which is busy deciding how far back the rod may legally pull.
 if(!(shotsOn()&&H&&H.on)||r.chg>=0||lt<=H.from){h.on=false;return;}
 const t=clamp((lt-H.from)/(1-H.from),0,1);
 h.on=true;
 h.holdRest=lerp(KICK.rest,H.rest,t);
 h.holdGrip=lerp(stGrip(r),H.grip,t);
 h.carryMult=lerp(1,H.carry,t);
}

/* The swing CURVE for a button kick at axis m. Blends CONFIG.kick toward mod.soft / mod.hard key by
   key, so only the keys those anchors name are touched and everything else (raiseA, grip, spin…)
   still comes from CONFIG.kick. Returns null at m~0 so kickStyleCfg falls back to the shared block
   and an unmodified swing allocates nothing. */
const SHOT_CURVE_KEYS=['windup','windupA','strike','strikeA','hold','drop','powFrom','powTo','rest','restPower'];
function shotBlend(m){
 if(Math.abs(m)<1e-3)return null;
 const M=SHOTC.mod,anc=m<0?M.soft:M.hard,t=Math.abs(m),out={};
 for(const k of SHOT_CURVE_KEYS){const base=KICK[k];out[k]=(anc[k]!=null)?lerp(base,anc[k],t):base;}
 // The ramp keyframes have to stay ordered or updateRods' if-chain skips a phase outright.
 out.strike=Math.max(out.windup+1e-3,out.strike);
 out.hold=Math.max(out.strike,out.hold);
 out.drop=Math.max(out.hold+1e-3,out.drop);
 return out;
}

/* ---- what the charge is worth ------------------------------------------------------------- */
/* Power RISES to the sweet band, sits flat across it, then FALLS — held too long is worse than a
   clean quick shot, which is what makes the band a target rather than a floor. Control does the
   same, so an overcooked shot is both weaker and wilder. */
function shotChgPow(k){
 const C=SHOTC.charge,s0=C.sweetFrom,s1=C.sweetTo;
 if(k<=s0)return lerp(C.powMin,C.powMax,s0>0?k/s0:1);
 if(k<=s1||s1>=1)return C.powMax;
 return lerp(C.powMax,C.overPow,(k-s1)/(1-s1));
}
function shotChgCtl(k){
 const C=SHOTC.charge,s0=C.sweetFrom,s1=C.sweetTo;
 if(k<=s0)return lerp(C.ctlMin,1,s0>0?k/s0:1);
 if(k<=s1||s1>=1)return 1;
 return lerp(1,C.overCtl,(k-s1)/(1-s1));
}
// 0 below the band, 1 inside it, 2 past it — what fx.js tints from and the tone edges off.
function shotChgBand(k){const C=SHOTC.charge;return k<C.sweetFrom?0:(k<=C.sweetTo?1:2);}
function shotOver(k){const C=SHOTC.charge;return C.sweetTo>=1?0:clamp((k-C.sweetTo)/(1-C.sweetTo),0,1);}

/* ---- arming ------------------------------------------------------------------------------- */
// r.shotOn is the ONLY thing physics.js tests. Armed while a charge is live and for as long as the
// swing it produced is in flight; consumed by the first contact (shotConsume), exactly like the
// one-attempt-per-swing latch matchstats already keeps.
function shotArm(r,m,k){
 r.shotOn=true;
 r.shotPow=shotAxisPow(m)*(k>=0?shotChgPow(k):1);
 r.shotCtl=clamp(shotAxisCtl(m)*(k>=0?shotChgCtl(k):1),0,1);
 r.shotExert=shotAxisExert(m);
}
function shotDisarm(r){r.shotOn=false;r.shotPow=1;r.shotCtl=1;r.shotExert=1;}
// Called by collideRod the moment a contact has taken its power. One contact, one shot — a swing
// that grazes and then strikes cleanly spends its charge on the graze, the same rule r.kickHit and
// msSw already run on, and the only rule that is well defined for a stick swing with no kickT.
function shotConsume(r){if(r.shotOn)shotDisarm(r);}
// Full teardown: charge, arming, tremble, blended curve. Called from resetRodRotation (every goal,
// dead ball and out) and whenever a seat lets go of a rod, so a charge can never outlive its owner.
function shotReset(r){
 if(!r)return;
 r.chg=-1;r.chgRel=0;r.chgMod=null;r.chgSrc=null;r.chgA=null;r.chgHeld=0;r.chgSweet=false;r.trem=0;
 r.shotTrack=1;r.kickCurve=null;shotDisarm(r);
 if(r.hold)r.hold.on=false;
}

/* ---- the wind-up angle (classic) ---------------------------------------------------------- */
/* The deepest pull-back on the way to `aTo` whose swept boot does not shove a ball toward our own
   goal. Same ladder trapAngle walks, minus its footHolds test — a trap must END on the ball, a
   wind-up must merely not maul it on the way back. With the guard off it returns the raw target,
   which is the honest "restore old behaviour" answer rather than a silent refusal. */
/* THE FOOT IS NOT THE ONLY THING THAT MOVES, and this cost a live measurement to find. collideRod
   resolves a ball against the rod CAPSULE — the leg — whenever the foot box misses it, and
   sweepClips only ever tests the foot box. A ball 2.6 behind a rod measures 2.26 from the boot
   (clear of its 1.9 reach) and sits well inside BALL_R+PRAD of the shin, so a wind-up the foot-box
   guard happily passes still drags the LEG through it: measured at ~8 u/s of backward drift over a
   third of a second, with footBoxDist reporting no contact the whole way. Same question as
   sweepClips asks, put to the other collider — and deliberately kept HERE rather than folded into
   sweepClips, which the trap shares and which is not what this change is for. */
function shotLegClips(r,b,a){
 const SW=AIC.trap.sweep,R=BALL_R+PRAD+SW.pad,p=b.m.position;
 const sa=Math.sin(a),ca=Math.cos(a),dx=sa*ARM,dy=-ca*ARM;
 for(let i=0;i<r.baseZ.length;i++){
  if(r.removedUntil[i]&&r.removedUntil[i]>S.time)continue;
  const pz=r.baseZ[i]+r.offset;
  if(Math.abs(p.z-pz)>R)continue;
  const wx=p.x-r.x,wy=p.y-ROD_H;
  const t=clamp((wx*dx+wy*dy)/(ARM*ARM),0,1);
  const cx=r.x+dx*t,cy=ROD_H+dy*t;
  const nx=p.x-cx,ny=p.y-cy,nz=p.z-pz,d=Math.sqrt(nx*nx+ny*ny+nz*nz);
  if(d>R||d<1e-6)continue;
  if((nx/d)*r.kickDir<-SW.pushDot)return true;      // the shin would drive it toward our own goal
 }
 return false;
}
function shotPullCap(r,aFrom,aTo){
 const SW=AIC.trap.sweep;
 if(!SW||!SW.on)return aTo;
 const n=Math.max(1,SW.clampSteps|0);
 let best=aFrom;
 for(let s=1;s<=n;s++){
  const a=aFrom+(aTo-aFrom)*(s/n);
  let clip=false;
  for(const b of S.balls){if(b.scored)continue;
   if(sweepClips(r,b,aFrom,a)||shotLegClips(r,b,a)){clip=true;break;}}
  if(clip)break;
  best=a;
 }
 return best;
}
// updateRods asks for this once per sim step. null = no authored wind-up (not charging, or the
// stick owns the angle in Total Control).
function shotPullAngle(r){return (shotsOn()&&r.chgSrc&&r.chgSrc!=='stick')?r.chgA:null;}
// Tracking-rate multiplier for the right-stick angle path. 1 when nothing is held, so the Total
// Control feel is untouched until a trigger is squeezed.
function shotTrackMult(r){return shotsOn()?(r.shotTrack||1):1;}

/* ---- firing ------------------------------------------------------------------------------- */
/* A deep finesse kick is not a soft kick, it is a PASS — aimed by the SAME passEval the AI has
   used since 2026-07-28, so the player finally plays through the two-hands rule instead of around
   it. passPick is cached per rod on its own cadence, so asking here costs nothing most frames. */
/* WHO THE PLAYER CAN ACTUALLY PASS TO — and this is NOT passEval's answer, which was the first cut.
   passEval picks the best receiver on the table and that is right for the AI, because the AI dribbles
   onto the line before it passes, so "best" is reachable by the time it swings. A human presses the
   button NOW, and the aim assist can only bend a pass by CONFIG.ai.dribble.pass.assist — 0.16 rad,
   about 9 degrees. Measured live: a receiver 28 units square of the ball needs 43 degrees, so the
   ball left with a PASS label on it, turned nine degrees, and ran straight out for a goal kick.
   So the player's chooser scores the SAME lanes (laneObs / lineClr, one definition of "is this lane
   clear") but by whether the bend is DELIVERABLE, and returns null when none is. LT+kick is then a
   plain soft touch — honest — instead of a pass to nobody. What it asks of the player is to line the
   rod up with a teammate first, which is what passing a foosball actually is. */
function shotPassPick(r,bx,bz){
 const P=AIC.dribble.pass,dir=r.team===0?1:-1,maxBend=P.assist*SHOTC.pass.bendMult;
 let best=null;
 for(const o of rods){
  if(o===r||o.team!==r.team)continue;
  const ahead=(o.x-r.x)*dir;
  if(ahead<P.minAhead||ahead>P.maxAhead)continue;
  const obs=laneObs(r.team,bx,o.x);
  for(let i=0;i<o.baseZ.length;i++){
   if(!manLive(o,i))continue;
   const tz=o.baseZ[i]+o.offset;
   const clr=lineClr(obs,bx,bz,o.x,tz);
   if(clr<P.minClear)continue;
   const bend=Math.abs(Math.atan2(tz-bz,Math.max(1e-3,(o.x-bx)*dir)));
   if(bend>maxBend)continue;                       // the assist cannot turn the ball this far
   const score=clr*P.wClear-bend*SHOTC.pass.bendCost;
   if(!best||score>best.score)best={rod:o,man:i,x:o.x,z:tz,clr,bend,score};
  }
 }
 return best;
}
function shotPassTarget(r,m){
 if(!SHOTC.pass.on||m>SHOTC.pass.modAt)return null;
 let best=null,bd=1e9;
 for(const b of S.balls){if(b.scored)continue;const d=Math.abs(b.m.position.x-r.x);if(d<bd){bd=d;best=b;}}
 if(!best)return null;
 return shotPassPick(r,best.m.position.x,best.m.position.z);
}
/* One entry point for every button swing the player takes, charged or not. m~0 with no charge
   resolves to kickRod(r) with a null curve and shotOn false — literally the old call.
   It OWNS the flinch rule, rather than the release path owning it, because there are two ways to
   let a classic charge go — the trigger, or the kick button — and a rule about what a charge is
   worth that lives on only one of them is a rule the other can contradict. */
function shotFire(r,m,k){
 if(!shotsOn()){kickRod(r);return;}
 // A swing already in flight cannot be re-fired, and arming for one that never starts would leave
 // the charge sitting on the rod for whatever contact happened to come next.
 if(r.kickT>=0)return;
 if(k>=0&&k<SHOTC.charge.minFire)k=-1;        // a flinch is an ordinary swing, not a feeble charged one
 const pt=shotPassTarget(r,m);
 if(k>=0)shotArm(r,m,k);else if(Math.abs(m)>=1e-3)shotArm(r,m,-1);else shotDisarm(r);
 // A PASS takes no blended curve: it swings on CONFIG.ai.passShot, the same block the AI passes
 // with, so a human pass and an AI pass are the same action rather than two things that look alike.
 kickRod(r,pt?'pass':(r.shotOn?'shot':null),pt||null,pt?null:shotBlend(m));
}
/* Horizontal-only rotation of the outgoing velocity, so it adds no energy — the same discipline
   the Magnus curve and aimAssist are written under. Seeded on its own stream (rng.js): it changes
   an OUTCOME, so it does not belong on Math.random. */
function shotSpray(b,r){
 const a=SHOTC.charge.spray*(1-clamp(r.shotCtl,0,1));
 if(a<=0)return;
 const th=(RNG.shot()*2-1)*a,cs=Math.cos(th),sn=Math.sin(th),vx=b.v.x,vz=b.v.z;
 b.v.x=vx*cs-vz*sn;b.v.z=vx*sn+vz*cs;
}

/* ---- the per-frame state machine ---------------------------------------------------------- */
/* Called once per frame per seat from padSeatUpdate, AFTER the slide/angle reads so it can see the
   stick value the angle path resolved (stickD: -1 fully pulled back .. +1 fully forward). Charge
   runs on FRAME time, not sim time — it is an input, and a dropped frame must not bank charge the
   player never held. Returns true when it fired a swing, so input.js can skip its own kick edge. */
function shotPadUpdate(dt,gp,s,r,TC,stickD){
 if(!shotsOn()){shotReset(r);return false;}
 const C=SHOTC.charge;
 const lt=shotTrigD(gp,6),rt=shotTrigD(gp,7),m=shotAxis(lt,rt);
 r.shotTrack=TC?shotAxisTrack(m):1;

 /* WHO IS HOLDING THE WIND-UP.
    · Total Control — both triggers past the deadzone AND the stick pulled back. The chord is what
      separates "I am winding up to hit it" from "I am lifting the men", which the stick alone
      cannot say.
    · Classic — cfg.padChargeBtn. RT by default, so the kick button keeps firing on press. */
 let src=null,depth=0;
 if(C.on&&r.kickT<0){
  if(TC){
   const back=Math.max(0,-stickD);
   if(shotChord(lt,rt)&&back>=C.stickBack){src='stick';depth=back;}
  }else{
   const cb=cfg.padChargeBtn||'rt',rtOk=(cb==='rt'||cb==='both'),kbOk=(cb==='kick'||cb==='both');
   const kb=gpDown(gp,0);
   // A source that is ALREADY holding keeps it, so under 'both' the other input going down
   // mid-wind-up cannot steal the charge — and stealing it would read as an unrequested shot,
   // since losing the source is exactly what fires one.
   if(r.chgSrc==='rt'&&rtOk&&rt>0){src='rt';depth=rt;}
   else if(r.chgSrc==='kick'&&kbOk&&kb){src='kick';depth=1;}
   else if(rtOk&&rt>0){src='rt';depth=rt;}
   else if(kbOk&&kb){src='kick';depth=1;}
  }
 }

 // RELEASE. Classic fires a swing; Total Control has no discrete fire — the player's own forward
 // flick is it — so the charge is left BANKED and decaying, and the next contact spends it.
 let fired=false;
 if(r.chgSrc&&src!==r.chgSrc){
  const k=r.chg,was=r.chgSrc;
  r.chgSrc=null;r.chgA=null;
  if(was!=='stick'){
   const tap=(was==='kick'&&r.chgHeld<C.tapMax);
   /* FIRE ON THE AXIS THE WIND-UP WAS HELD AT, not the one live on the release frame — and this is
      the whole reason r.chgMod exists. In classic the charge is held on RT, so at the instant of
      release RT is on its way UP: reading the axis then gives 0, and a charged shot came out on a
      neutral curve with none of the power trim, i.e. the power trigger did nothing to the shot it
      had just spent half a second charging. Found live, not by reading. */
   shotFire(r,(r.chgMod!=null?r.chgMod:m),tap?-1:k);
   r.chg=-1;fired=true;
   if(C.tone.on)Au.chargeFire(k,shotChgBand(k)===1);
  }else{
   r.chgRel=k;                                  // Total Control: bank WHAT IT WAS WORTH at the release
   // …and discharge THERE. The strike itself is the player's forward flick and may land later, but
   // letting the chord go IS the release gesture, so that is where the sound belongs.
   if(C.tone.on)Au.chargeFire(k,shotChgBand(k)===1);
  }
 }

 // WIND UP, or bleed off what is left of an abandoned one.
 if(src){
  if(r.chgSrc!==src){r.chgSrc=src;r.chg=Math.max(0,r.chg);r.chgRel=0;r.chgMod=null;r.chgHeld=0;r.chgSweet=false;}
  r.chgHeld+=dt;
  r.chg=clamp(r.chg+C.rate*depth*dt,0,1);
  r.chgMod=m;                                    // what the triggers said WHILE winding up (see the release)
  shotArm(r,m,r.chg);
  /* The pull-back DEEPENS with the charge and is fully back by the band's LOWER edge — sweetFrom,
     not sweetTo, and that one word is the difference between a band and a knife edge. The arc is
     the real power (see CONFIG.shots.mod), so saturating it at the TOP of the band means power
     keeps climbing ACROSS the band and peaks one frame before the overcook: measured live at 2.16x
     a plain tap mid-band against 2.73x fully overcooked, i.e. holding too long was the strongest
     shot in the game. Saturating at the lower edge makes the whole band a flat maximum, which is
     what a sweet spot is, and leaves the overcook paying only the penalty.
     Total Control authors no angle: the stick is already where the player put it. */
  if(src!=='stick'){
   const want=C.pullA*r.kickDir*clamp(C.sweetFrom>0?r.chg/C.sweetFrom:1,0,1);
   r.chgA=shotPullCap(r,r.angle,want);
  }else r.chgA=null;
 }else if(r.chg>0&&!fired){
  /* AN ABANDONED WIND-UP ONLY EVER FADES — and it has to be written this way rather than by
     re-deriving from the shrinking charge, which is what the first cut did. Power is FLAT across
     the sweet band and falls off ABOVE it, so a charge decaying down from an overcook passes back
     THROUGH the band: overcook deliberately, let go, wait a fifth of a second, and the shot came
     back to full power. That hands the player a way to skip the timing the band exists to test.
     So the release banks what the charge was worth (chgRel) and everything after is a fade from
     that toward an ordinary swing. Caught by the harness, not by eye. */
  r.chg=Math.max(0,r.chg-C.decay*dt);
  if(r.chg<=0){r.chg=-1;r.chgRel=0;r.chgMod=null;shotDisarm(r);}
  else{
   const f=r.chgRel>0?clamp(r.chg/r.chgRel,0,1):0;
   r.shotOn=true;
   r.shotPow=shotAxisPow(m)*lerp(1,shotChgPow(r.chgRel),f);
   r.shotCtl=clamp(shotAxisCtl(m)*lerp(1,shotChgCtl(r.chgRel),f),0,1);
   r.shotExert=shotAxisExert(m);
  }
 }

 // Readout. The audio is the half that actually teaches the band — a tick rate you can feel for,
 // and one distinct mark on the way in. Tremble amplitude is the overcharge, and nothing reads
 // r.trem but the render pivot.
 if(r.chg>=0){
  const band=shotChgBand(r.chg);
  if(C.tone.on){
   // FED, not ticked. audio.js owns a held voice that sweeps with this value and fades itself out
   // the moment we stop feeding it — so there is nothing to stop on release, on a quit, or on a
   // match that ends mid-wind-up, and the build-up is continuous instead of a train of blips.
   Au.chargeFeed(r.chg,band);
   const sw=(band===1);
   if(sw!==r.chgSweet){r.chgSweet=sw;if(sw)Au.chargeMark(true);else if(band===2)Au.chargeMark(false);}
  }
  const T=C.trem,ov=shotOver(r.chg);
  r.trem=ov>0?T.amp*ov*Math.sin(r.chgHeld*T.hz):0;
 }else r.trem=0;

 // LT also makes the boot STICKY (CONFIG.shots.hold). Last, so it reads THIS frame's charge: a
 // wind-up cancels the hold, and a swing that just fired frees it again on the same frame.
 shotHoldUpdate(r,lt);

 return fired;
}
/* Does the kick BUTTON still fire on press? Only false where the player has deliberately moved the
   charge onto it (cfg.padChargeBtn), because holding a wind-up and firing instantly are the same
   press and cannot both be honoured. Everywhere else — the default, Total Control, shots off — the
   button fires the frame it goes down, exactly as it always has. */
function shotKickPress(TC){
 if(!shotsOn()||TC||!SHOTC.charge.on)return true;
 const cb=cfg.padChargeBtn||'rt';
 return cb!=='kick'&&cb!=='both';
}
/* Live charge for the readouts (fx.js's held-rod marker, and anything added later). Returns -1 when
   nothing is winding up, so a caller tests one value rather than three fields. */
function shotCharge(r){return (r&&shotsOn()&&r.chg>=0)?r.chg:-1;}
/* Band of the live charge for a readout: -1 none, 0 building, 1 in the sweet band, 2 overcooked. */
function shotChargeBand(r){const k=shotCharge(r);return k<0?-1:shotChgBand(k);}
