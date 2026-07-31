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
/* The kick CURVE in play. A named style resolves to its own block in CONFIG.ai; anything else
   (including a plain user swing) uses the main KICK block. ONE source of truth — updateRods
   drives the swing off it and collideRod reads the same power window / restitution from it, so a
   new style is a config block plus a line here, not a hunt through three files. */
function kickStyleCfg(r){
 return r.kickStyle==='trapShot'?AIC.trapShot:(r.kickStyle==='pass'?AIC.passShot:KICK);
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
 if(r.act==='trap')return AIC.trap;
 if(r.act==='dribble')return AIC.dribble;
 return null;
}
/* aimAt (optional) — a {x,z} world point the outgoing strike should be bent toward instead of the
   goal (see aimAssist). Used by the pass. It rides on the rod because contact happens later, inside
   collideRod, mid-swing; cleared here so an un-aimed kick can never inherit a stale target. */
function kickRod(r, style, aimAt){
 if(r.kickT>=0)return;
 r.raise=false;r.kickT=0;r.act=null;r.kickStyle=style||null;
 r.kickHit=false;                                  // debug tracer: set true by collideRod on real contact this swing
 r.evadeHold=0;r.evadeSpent=false;r.evadeDir=0;    // fresh post-kick held-evade budget + escape direction for this swing
 r.trapMan=-1;r.trapDir=0;                         // a swing ends any trap carry (the ball is being released)
 r.dribMan=-1;r.dribZ=0;r.dribZ0=0;                // …and any dribble carry, for the same reason
 r.laneDir=0;                                      // …and any lane-clear escape direction (r.act was just nulled)
 r.passTo=aimAt||null;                             // pass target for this swing only
 r.kickA0=r.angle/(r.kickDir||1);                  // rod-local angle the swing STARTS from (see updateRods)
 if(S.stats)S.stats.kicks[r.team]++;
}
function resetRodRotation(){
 for(const r of rods){
  r.angle=0;r.prevAngle=0;
   r.kickT=-1;r.kickStyle=null;r.raise=false;r.heldFwd=false;r.evadeHold=0;r.evadeSpent=false;r.evadeDir=0;r.kickA0=0;r.tcSpin=0;
  r.act=null;r.actT=0;r.trapMan=-1;r.trapDir=0;r.trapZ0=0;r.laneDir=0;r.laneCd=0;
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
     const holdF=(uf||(r.evadeHold>0&&!r.evadeSpent))&&T>=KS.hold;
     r.heldFwd=holdF;
     if(holdF){a=KS.strikeA;r.kickT=KS.hold;}
     else if(T<KS.windup)a=kA0+(KS.windupA-kA0)*(T/KS.windup);
     else if(T<KS.strike)a=rampA0+(KS.strikeA-rampA0)*((T-KS.windup)/(KS.strike-KS.windup));
     else if(T<KS.hold)a=KS.strikeA;
     else if(T<KS.drop)a=KS.strikeA*(1-(T-KS.hold)/(KS.drop-KS.hold));
     else{a=0;r.kickT=-1;r.kickStyle=null;r.passTo=null;if(dbgLogRod===r&&!r.kickHit)dbgRod(r,'WHIFF','no contact — swing completed');}
     r.angle=a*r.kickDir;
  }else if(r.act==='safeRaise'){r.heldFwd=false;r.angle=lerp(r.angle,AIC.safeRaise.angle*r.kickDir,Math.min(1,AIC.safeRaise.lerp*dt));}
  else if(r.act==='trap'){r.heldFwd=false;r.angle=lerp(r.angle,AIC.trap.angle*r.kickDir,Math.min(1,AIC.trap.lerp*dt));}
  // NOTE: r.act==='dribble' is deliberately absent from this chain. The dribble is NOT a trap — it
  // works the ball with the men DOWN AT REST, so it must fall through to the rest branch below and
  // leave the angle alone. It sets r.raise=false, so it lands on the final `else` (ease toward 0).
  else if(r.padAngleOn){                              // right-stick absolute angle: stick position IS the rod angle (1:1)
   // DIRECT control — snap the rod straight to the stick-mapped target so angVel = (angle-prevAngle)/dt
   // carries the stick's REAL speed into the strike (fast flick → big angVel → hard kick). Optional light
   // smoothing only if KICK.padAngleLerp>0; 0 (default) = fully direct, no lag, no capped swing speed.
   r.heldFwd=false;
   r.angle=KICK.padAngleLerp>0?lerp(r.angle,r.padAngleTarget,Math.min(1,KICK.padAngleLerp*dt)):r.padAngleTarget;
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
  r.slideV=(r.offset-prevOff)/dt;                     // keep slideV in sync across control handoff
  r.angVel=(r.angle-r.prevAngle)/dt;
  r.vz=(r.offset-r.prevOffset)/dt;
  r.prevAngle=r.angle;r.prevOffset=r.offset;
  r.cd=Math.max(0,r.cd-dt);
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
