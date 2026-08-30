'use strict';
/* ================= rods ================= */
/* isUserRod/seatOf now live in js/seats.js — a rod is "the user's" when ANY seat is holding it,
   not just when it matches one global index. */

/* A figurine's meshes share materials across all men (teamMat / playerTeamMats).
   To fade a single man in on respawn we must give it its OWN material instances,
   then hand the shared ones back once it's fully opaque (so we don't bloat the
   scene with cloned materials for every live figurine). setManVisible handles the
   hard show/hide; setManOpacity lazily clones (on first sub-1 write) and toggles
   `transparent`+`opacity`, restoring the originals at opacity 1. */
function forEachManMesh(m,cb){m.traverse(c=>{if(c.isMesh)cb(c);});}
function restoreManMats(m){
  if(!m.userData.fadeMats)return;
  for(const {mesh,orig} of m.userData.fadeMats)mesh.material=orig;
  m.userData.fadeMats=null;
}
function setManVisible(m,v){
  if(m.visible===v)return;
  m.visible=v;
  if(!v&&m.userData.fadeMats)restoreManMats(m);   // going hidden mid-fade: drop the clones
}
function setManOpacity(m,k){
  if(k>=1){                                       // fully opaque: back to shared mats
    if(m.userData.fadeMats){
      forEachManMesh(m,mesh=>{mesh.material.transparent=false;mesh.material.opacity=1;});
      restoreManMats(m);
    }
    return;
  }
  if(!m.userData.fadeMats){                        // first sub-1 write: clone each mesh's material
    m.userData.fadeMats=[];
    forEachManMesh(m,mesh=>{const orig=mesh.material;const c=orig.clone();c.transparent=true;c.opacity=k;mesh.material=c;m.userData.fadeMats.push({mesh,orig});});
  }
  forEachManMesh(m,mesh=>{mesh.material.opacity=k;});
}
function rodSpeedMult(r){
  const e=S.eff[r.team];let m=stSpeed(r);   // spd stat + stamina fade (1 with no build)
  if(e.frozen>S.time)m*=KICK.freezeMult;
 return m;
}
/* The kick CURVE for a style NAME. Split out of kickStyleCfg so a decision taken BEFORE the swing
   exists — ai.js' strike gate, which asks "if I swing a pass right now, will a boot actually be on
   the ball?" — reads the SAME timings the swing will really run on, instead of guessing at them. */
function styleCfg(style){
 return style==='trapShot'?AIC.trapShot:(style==='pass'?AIC.passShot:KICK);
}
/* The kick CURVE in play. A named style resolves to its own block in CONFIG.ai; anything else
   (including a plain user swing) uses the main KICK block. ONE source of truth — updateRods
   drives the swing off it and collideRod reads the same power window / restitution from it, so a
   new style is a config block plus a line here, not a hunt through three files. */
function kickStyleCfg(r){
 // r.kickCurve is a per-swing BLEND (js/shots.js) between CONFIG.kick and one of the shot anchors —
 // the player's trigger axis, resolved once at kickRod time. It outranks the named style because a
 // human swing has no fixed block to point at: its curve is the modifier they were holding. null
 // for every AI swing and every unmodified human one, so those resolve exactly as they did.
 return r.kickCurve||styleCfg(r.kickStyle);
}
/* Was a contact a real FRONT-face strike, or a graze off the side / back of the boot? nx is the
   contact normal's world-x component, which collideRod already computes in both its foot-box and
   capsule passes; dir-relative it reads ~+1 for a ball sitting square in front of the boot, ~0 for a
   z-side clip, and negative for one behind. A PASS is a deliberate, aimed action, so bending a side
   clip toward the receiver with the pass aim-assist is exactly what made stray deflections read as
   intentional passes ("it registered as a hit — it caught the side of the player"). This gates
   NOTHING but r.passTo: shots, clears and every human kick resolve exactly as before. */
function passFaceOK(r,nx){
 const SG=AIC.strikeGate;
 if(!SG||!SG.on||!SG.faceOnContact)return true;
 return nx*r.kickDir>=SG.faceDot;
}
/* The BALL-CONTROL actions. While one is live (and no swing is in flight) the boot stops being a
   passive surface: collideRod reads holdRest/holdGrip from the returned block instead of the normal
   rest/grip, and the slide is scaled by its carryMult. The two differ in kind, not just in tuning:
     • trap    — CATCHES a loose ball behind the men, on a tilted pin angle, grip 0.55 (held).
     • dribble — works a ball already at the feet of a RESTING row, no angle change, grip 0.30
                 (nudged along with slip). It appears here only for the contact + slide speed;
                 it deliberately does NOT appear in updateRods' angle chain.
   One accessor rather than each of them spraying r.act tests through two files. */
function holdCfg(r){
 if(r.kickT>=0)return null;                        // a swing in flight is a release, never a hold
 /* THE PLAYER'S HOLD (L2) comes first, and the two can never collide: r.act is only ever written
    by ai.js, which skips user rods outright, and r.hold is only ever written by a seat's pad. It
    is the rod's OWN block (built in buildRods, refreshed per poll by shots.js shotHoldUpdate)
    rather than a shared config object, because the values are blended by trigger depth and two
    seats can be holding two rods at different depths in the same frame. */
 if(r.hold&&r.hold.on)return r.hold;
 if(r.act==='trap')return AIC.trap;
 if(r.act==='dribble')return AIC.dribble;
 return null;
}
/* aimAt (optional) — a {x,z} world point the outgoing strike should be bent toward instead of the
   goal (see aimAssist). Used by the pass. It rides on the rod because contact happens later, inside
   collideRod, mid-swing; cleared here so an un-aimed kick can never inherit a stale target. */
function kickRod(r, style, aimAt, curve){
 if(r.kickT>=0)return;
 r.raise=false;r.raiseKeep=false;r.kickHold=false;r.kickT=0;r.act=null;r.kickStyle=style||null;   // a fresh swing is never born held — js/input.js sets kickHold right after, for a human press only
 r.kickCurve=curve||null;                          // per-swing blended curve (js/shots.js); null = use the style's block
 r.chg=-1;r.chgSrc=null;r.chgA=null;r.trem=0;      // a swing IS the release: no wind-up survives it
 r.kickHit=false;                                  // debug tracer: set true by collideRod on real contact this swing
 r.evadeHold=0;r.evadeSpent=false;r.evadeDir=0;    // fresh post-kick held-evade budget + escape direction for this swing
 r.trapMan=-1;r.trapDir=0;r.trapA=null;            // a swing ends any trap carry (the ball is being released)
 r.dribMan=-1;r.dribZ=0;r.dribZ0=0;                // …and any dribble carry, for the same reason
 r.laneDir=0;                                      // …and any lane-clear escape direction (r.act was just nulled)
 r.passTo=aimAt||null;                             // pass target for this swing only
 r.kickA0=r.angle/(r.kickDir||1);                  // rod-local angle the swing STARTS from (see updateRods)
 r.msSw=false;                                     // match-stats shot latch: ONE attempt per swing, not one per contact (matchstats.js msContact)
 stExertKick(r);                                   // stamina channel B: the swing costs THIS rod (stats.js)
 msKick(r);                                        // matchstats.js: team + per-rod kick count
}
function resetRodRotation(){
 for(const r of rods){
  r.angle=0;r.prevAngle=0;
   r.kickT=-1;r.kickStyle=null;r.raise=false;r.raiseKeep=false;r.heldFwd=false;r.evadeHold=0;r.evadeSpent=false;r.evadeDir=0;r.kickA0=0;r.tcSpin=0;
   r.padAngleOn=false;r.padAngleTarget=0;r.kickHold=false;   // a stick angle or held kick left on a rod outranks the rest-drop — they die with the rally
  shotReset(r);                                    // charge/arming/tremble die with the rally (js/shots.js)
  r.act=null;r.actT=0;r.trapMan=-1;r.trapDir=0;r.trapZ0=0;r.trapA=null;r.laneDir=0;r.laneCd=0;
  if(r.hold)r.hold.on=false;
  r.dribMan=-1;r.dribZ=0;r.dribZ0=0;r.dribCd=0;r.dribEvT=0;r.passTo=null;r.passEv=null;r.passEvT=0;
  if(r.behindFlag!=null)r.behindFlag=false;
  r.pivot.rotation.z=0;
 }
}
function updateRods(dt){
 if(dt<=0)return;
 const HF=AIC.heldFwd;                               // drop-sweep zone (its own tunable section)
 const clearZ=FOOT_BOX.z+BALL_R+HF.zMargin;          // z-depth of the drop-sweep (matches the held-evade escape)
 for(const r of rods){
   if(r.kickT>=0){
     r.kickT+=dt;const T=r.kickT;let a;
     const KS=kickStyleCfg(r);                       // trapShot / passShot / normal — one source of truth
     /* The swing ramps from the rod's angle AT KICK TIME (r.kickA0, captured in kickRod) instead of
        from the fixed windupA. Starting from a constant meant a kick launched off a RAISED rod
        (angle raiseA −1.6) crossed ~1.5 rad in ONE step: angVel spiked to ~85 rad/s against the
        swing's normal ~22, the foot teleported ~9u (straight past the ball — the tunnelling and the
        sideways 'glitch'), and the impulse came out 4x too big. Kick-log evidence 2026-07-22.
        With windup>0 the pull-back ALSO sweeps from kickA0 rather than snapping, so there is no
        discontinuity anywhere in the curve. windup==0 → ramp runs kickA0 → strikeA directly, which
        is what makes windupA:0 actually mean "no back-pull". */
     const kA0=(r.kickA0!=null)?r.kickA0:0;
     const rampA0=KS.windup>0?KS.windupA:kA0;
     let uf=false,dir=r.team===0?1:-1;
     for(const b of S.balls){
      if(b.scored)continue;const rel=(b.m.position.x-r.x)*dir;
      if(rel<-HF.xBack||rel>HF.xFront)continue;
      for(let i=0;i<r.baseZ.length;i++)if(Math.abs(b.m.position.z-(r.baseZ[i]+r.offset))<clearZ){uf=true;break;}
      if(uf)break;
     }
     // Keep the swing pinned at the strike angle while it's over a ball (uf) OR while ai.js has the
     // held-evade latch live (r.evadeHold) — so the rod holds forward the WHOLE slide-away instead of
     // dropping the instant it clears z. The swing only completes once the ball has left the zone.
     /* r.kickHold is the PLAYER holding the kick button (mouse/keyboard, js/input.js), and it
        joins the same pin the AI's two cases already use. Note what T>=KS.hold means for feel: the
        windup and the strike always run at full speed, so the hit is untouched, and the rod already
        sat at full stretch until KICK.hold (0.25s) anyway. A tap is gone long before that, so
        tapping plays exactly as it always did — only a button still down at 0.25s freezes the
        swing there, and it resumes and drops the moment you let go. It is a BLOCK, not a free
        power shot: the power window (CONFIG.kick.powFrom/powTo, 0.03-0.2) has closed by
        then, so a ball meeting the held boot gets ordinary restitution off a still rod. */
     const holdF=(uf||r.kickHold||(r.evadeHold>0&&!r.evadeSpent))&&T>=KS.hold;
     r.heldFwd=holdF;
     if(holdF){a=KS.strikeA;r.kickT=KS.hold;}
     else if(T<KS.windup)a=kA0+(KS.windupA-kA0)*(T/KS.windup);
     else if(T<KS.strike)a=rampA0+(KS.strikeA-rampA0)*((T-KS.windup)/(KS.strike-KS.windup));
     else if(T<KS.hold)a=KS.strikeA;
     else if(T<KS.drop)a=KS.strikeA*(1-(T-KS.hold)/(KS.drop-KS.hold));
     else{a=0;r.kickT=-1;r.kickStyle=null;r.kickCurve=null;r.passTo=null;
      shotDisarm(r);                                   // an uncontacted swing spends its charge anyway — see shots.js
      if(dbgLogRod===r&&!r.kickHit)dbgRod(r,'WHIFF','no contact — swing completed');}
     r.angle=a*r.kickDir;
  }else if(r.act==='safeRaise'){r.heldFwd=false;r.angle=lerp(r.angle,AIC.safeRaise.angle*r.kickDir,Math.min(1,AIC.safeRaise.lerp*dt));}
  /* The trap eases to r.trapA — the per-ball angle ai.js picked at entry (trapAngle), NOT the raw
     AIC.trap.angle. That target is the deepest tilt whose swept boot does not shove the ball toward
     our own goal, so for a ball already sitting inside the resting box it is 0: the men pin it flat
     and the rod never rotates at all. Falling back to the config angle keeps this correct if a trap
     is ever set without a computed target (guard disabled, or a save from before r.trapA existed). */
  else if(r.act==='trap'){r.heldFwd=false;r.angle=lerp(r.angle,(r.trapA!=null)?r.trapA:AIC.trap.angle*r.kickDir,Math.min(1,AIC.trap.lerp*dt));}
  // NOTE: r.act==='dribble' is deliberately absent from this chain. The dribble is NOT a trap — it
  // works the ball with the men DOWN AT REST, so it must fall through to the rest branch below and
  // leave the angle alone. It sets r.raise=false, so it lands on the final `else` (ease toward 0).
  /* CHARGE WIND-UP (js/shots.js, classic pad only). Sits BELOW the right-stick branch on purpose:
     if the player is driving the angle by hand the stick wins, because that is already a wind-up
     and two authors of one angle is a fight. Above r.raise, because a charge is the more specific
     intent. r.chgA is the sweepClips-capped target — it can never pull back through the ball. */
  else if(shotPullAngle(r)!=null){r.heldFwd=false;r.angle=lerp(r.angle,r.chgA,Math.min(1,SHOT.charge.pullLerp*dt));}
  else if(r.padAngleOn){                              // right-stick absolute angle: stick position IS the rod angle (1:1)
   // DIRECT control — snap the rod straight to the stick-mapped target so angVel = (angle-prevAngle)/dt
   // carries the stick's REAL speed into the strike (fast flick → big angVel → hard kick). Optional light
   // smoothing only if KICK.padAngleLerp>0; 0 (default) = fully direct, no lag, no capped swing speed.
   r.heldFwd=false;
   /* The TRACKING RATE is what the Total Control triggers bend (shotTrackMult): LT makes the rod
      heavy so a fast flick cannot become a hard hit, RT makes it snap so your flick arrives intact.
      1 when no trigger is held, and the padAngleLerp>0 / ==0 split is preserved either way, so the
      stick feel is untouched until a trigger is actually squeezed. */
   const trk=shotTrackMult(r);
   if(KICK.padAngleLerp>0||trk!==1){const rate=(KICK.padAngleLerp>0?KICK.padAngleLerp:SHOT.mod.directLerp)*trk;r.angle=lerp(r.angle,r.padAngleTarget,Math.min(1,rate*dt));}
   else r.angle=r.padAngleTarget;
  }else if(r.raise){r.heldFwd=false;r.angle=lerp(r.angle,KICK.raiseA*r.kickDir,Math.min(1,KICK.raiseLerp*dt));}
  else{r.heldFwd=false;r.angle=lerp(r.angle,0,Math.min(1,KICK.dropLerp*dt));}
   // Total Control's slide multiplier is per SEAT now (each pad has its own triggers), so it's
   // read off whichever seat holds this rod rather than from one global.
   const uSeat=seatOf(r);
   let ms=(uSeat?KICK.userSpeed*uSeat.tcMult:DIFFS[teamDiff(r.team)].speed*(S.userTeam>=0&&r.team===S.userTeam?KICK.aiOwnMult:1))*rodSpeedMult(r);
   // Carrying a held ball (trap or dribble) is a deliberate shuffle, not a slide: the boot can only
   // drag the ball as fast as the block's holdGrip transfers velocity to it, so a full-speed slide
   // just sheds it. holdCfg returns null mid-swing, so a release always slides at full speed.
   {const H=holdCfg(r);if(H)ms*=H.carryMult;}
  r.target=clamp(r.target,-r.maxOff,r.maxOff);
  const prevOff=r.offset;
  if(uSeat){                                          // human hand: instant/responsive, speed-capped only
   r.offset+=clamp(r.target-r.offset,-ms*dt,ms*dt);
  }else{                                              // AI hand: accel-capped so it can't reverse instantly
   const want=clamp((r.target-r.offset)/dt,-ms,ms);   // velocity that reaches target this frame, speed-capped
   const acc=AIC.slideAccel*stAgil(r)*dt;             // spd stat scales direction-change agility (+ stamina fade)
   r.slideV=clamp(want,r.slideV-acc,r.slideV+acc);
   r.offset+=r.slideV*dt;
  }
  msSlide(r,Math.abs(r.offset-prevOff));              // matchstats.js: rod work done, in table units
  r.slideV=(r.offset-prevOff)/dt;                     // keep slideV in sync across control handoff
  r.angVel=(r.angle-r.prevAngle)/dt;
  r.vz=(r.offset-r.prevOffset)/dt;
  r.prevAngle=r.angle;r.prevOffset=r.offset;
  r.cd=Math.max(0,r.cd-dt);
  stExertTick(r,dt);                         // stamina: swing exertion bleeds off (CONFIG.stats.kickFat.recover)
  r.evadeCd=Math.max(0,(r.evadeCd||0)-dt);   // evade re-entry lockout (CONFIG.ai.evade.cd)
  r.laneCd=Math.max(0,(r.laneCd||0)-dt);     // lane-clear re-entry lockout (CONFIG.ai.clearLane.cd)
  r.dribCd=Math.max(0,(r.dribCd||0)-dt);     // dribble re-entry lockout (CONFIG.ai.dribble.cd)
  r.dribEvT=Math.max(0,(r.dribEvT||0)-dt);   // next dribble target evaluation (dribble.reEval) — also gates entry scans
  r.passEvT=Math.max(0,(r.passEvT||0)-dt);   // pass-scan cache age (dribble.pass.every); the scan is the AI's priciest call
  r.pivot.rotation.z=r.angle;
  r.pivot.position.z=r.offset;
  const fadeT=CONFIG.cannonball.respawnFade;
  for(let mi=0;mi<r.men.length;mi++){
    const alive=r.removedUntil[mi]?r.removedUntil[mi]<=S.time:true;
    const m=r.men[mi];
    if(!alive){                              // removed: hide hard (no fade-out — the explosion handles that)
      if(m.visible){setManVisible(m,false);m.userData.fade=null;}
      continue;
    }
    if(m.userData.fade===undefined)m.userData.fade=null;   // lazy-init
    if(!m.visible){                          // just respawned: start the fade-in from 0
      setManVisible(m,true);
      m.userData.fade=fadeT>0?0:null;        // 0 = opacity progress just begun
    }
    if(m.userData.fade!==null){              // easing in
      m.userData.fade=Math.min(fadeT,m.userData.fade+dt);
      const k=fadeT>0?m.userData.fade/fadeT:1;
      setManOpacity(m,k);
      if(m.userData.fade>=fadeT){            // fully back: restore shared materials, drop transparency
        setManOpacity(m,1);m.userData.fade=null;
      }
    }
  }
 }
}
