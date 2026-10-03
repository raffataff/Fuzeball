'use strict';
/* ================= rods ================= */
// isUserRod/seatOf live in js/seats.js: a rod is 'the user's' when any seat holds it

// a figurine's meshes share materials across men, so fading one in on respawn needs its own instances; setManVisible is the hard show/hide, setManOpacity lazily clones on the first sub-1 write and restores the originals at opacity 1
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
// the kick curve for a style NAME, split out so ai.js's strike gate reads the timings the swing will run on
function styleCfg(style){
 return style==='trapShot'?AIC.trapShot:(style==='pass'?AIC.passShot:KICK);
}
// the kick curve in play: a named style resolves to its CONFIG.ai block, anything else uses KICK; updateRods and collideRod both read it
function kickStyleCfg(r){
 // r.kickCurve is a per-swing blend (js/shots.js) of CONFIG.kick and a shot anchor from the player's trigger axis; it outranks the named style; null for AI and unmodified human swings
 return r.kickCurve||styleCfg(r.kickStyle);
}
// was a contact a real front-face strike or a side/back graze? nx is the contact normal's world-x (dir-relative ~+1 in front, ~0 side, negative behind)
// it gates only r.passTo, so side clips aren't bent toward a receiver; shots, clears and human kicks are untouched
function passFaceOK(r,nx){
 const SG=AIC.strikeGate;
 if(!SG||!SG.on||!SG.faceOnContact)return true;
 return nx*r.kickDir>=SG.faceDot;
}
// ball-control actions: while one is live (no swing in flight) collideRod reads holdRest/holdGrip from the returned block and the slide scales by carryMult
//   trap: catches a loose ball behind the men on a tilted pin angle (grip 0.55)
//   dribble: works a ball at the feet of a resting row, no angle change (grip 0.30); only the contact and slide speed, not updateRods' angle chain
function holdCfg(r){
 if(r.kickT>=0)return null;                        // a swing in flight is a release, never a hold
 // the player's hold (L2) comes first and can't collide: r.act is only written by ai.js (which skips user rods), r.hold only by a seat's pad
 // it's the rod's own block (buildRods; refreshed by shots.js shotHoldUpdate) since values blend by trigger depth per seat
 if(r.hold&&r.hold.on)return r.hold;
 if(r.act==='trap'||(r.act==='retrieve'&&r.retPh==='pin'))return AIC.trap;   // retrieve's pin: the leg lands on the ball as a dead sticky surface until the pin takes it
 if(r.act==='dribble')return AIC.dribble;
 return null;
}
// aimAt (optional): a {x,z} point the strike bends toward instead of the goal (the pass); rides on the rod since contact is mid-swing, cleared here so a kick can't inherit it
function kickRod(r, style, aimAt, curve){
 if(r.kickT>=0)return;
 r.raise=false;r.raiseKeep=false;r.kickHold=false;r.kickT=0;r.act=null;r.kickStyle=style||null;   // a fresh swing is never born held: js/input.js sets kickHold right after, for a human press only
 r.kickCurve=curve||null;                          // per-swing blended curve (js/shots.js); null = use the style's block
 r.chg=-1;r.chgSrc=null;r.chgA=null;r.trem=0;      // a swing IS the release: no wind-up survives it
 r.kickHit=false;                                  // debug tracer: set true by collideRod on real contact this swing
 r.evadeHold=0;r.evadeSpent=false;r.evadeDir=0;    // fresh post-kick held-evade budget + escape direction for this swing
 r.trapMan=-1;r.trapDir=0;r.trapA=null;            // a swing ends any trap carry (the ball is being released)
 r.dribMan=-1;r.dribZ=0;r.dribZ0=0;                // …and any dribble carry, for the same reason
 r.laneDir=0;                                      // …and any lane-clear escape direction (r.act was just nulled)
 r.passTo=aimAt||null;                             // pass target for this swing only
 r.swOver=0;r.swF=0;r.swMx=0;                     // overspeed this swing may carry past maxV (shots.js shotFire / physics.js capSpeed, for a charge)
 if(r.pinB)pinRelease(r);                          // a swing lets a pinned ball go, and this swing is what strikes it (physics.js)
 r.kickA0=r.angle/(r.kickDir||1);                  // rod-local angle the swing STARTS from (see updateRods)
 r.msSw=false;                                     // match-stats shot latch: one attempt per swing (matchstats.js msContact)
 stExertKick(r);                                   // stamina channel B: the swing costs THIS rod (stats.js)
 msKick(r);                                        // matchstats.js: team + per-rod kick count
}
function resetRodRotation(){
 for(const r of rods){
  r.angle=0;r.prevAngle=0;
   r.kickT=-1;r.kickStyle=null;r.raise=false;r.raiseKeep=false;r.heldFwd=false;r.evadeHold=0;r.evadeSpent=false;r.evadeDir=0;r.kickA0=0;r.tcSpin=0;
   r.padAngleOn=false;r.padAngleTarget=0;r.kickHold=false;   // a stick angle or held kick left on a rod outranks the rest-drop; they die with the rally
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
     // the swing ramps from the rod's angle at kick time (r.kickA0), not the fixed windupA: a kick off a raised rod crossed ~1.5 rad in one step (angVel ~85 vs ~22), teleporting the foot past the ball
     // with windup>0 the pull-back also sweeps from kickA0; windup==0 ramps kickA0 to strikeA
     const kA0=(r.kickA0!=null)?r.kickA0:0;
     const rampA0=KS.windup>0?KS.windupA:kA0;
     let uf=false,dir=r.team===0?1:-1;
     for(const b of S.balls){
      if(b.scored)continue;const rel=(b.m.position.x-r.x)*dir;
      if(rel<-HF.xBack||rel>HF.xFront)continue;
      for(let i=0;i<r.baseZ.length;i++)if(Math.abs(b.m.position.z-(r.baseZ[i]+r.offset))<clearZ){uf=true;break;}
      if(uf)break;
     }
     // keep the swing pinned at the strike angle while over a ball (uf) or while the held-evade latch is live (r.evadeHold)
     // r.kickHold = the player holding kick (js/input.js): a tap plays as before, only a button still down at KICK.hold (0.25s) freezes the swing; a block, not a free power shot
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
  }else if(r.act==='safeRaise'){const sl=srLerp(r);r.heldFwd=false;r.angle=lerp(r.angle,backLimit(r,(r.srA!=null)?r.srA:AIC.safeRaise.angle*r.kickDir,sl),Math.min(1,sl*dt));}   // r.srA: ai.js picks the lift depth per ball; backLimit holds it short of a ball it would hit
  // the trap eases to r.trapA, the per-ball angle ai.js picked at entry (trapAngle): the deepest tilt that doesn't shove the ball goalward (0 for a ball in the resting box); falls back to the config angle
  else if(r.act==='trap'){r.heldFwd=false;r.angle=lerp(r.angle,(r.trapA!=null)?r.trapA:AIC.trap.angle*r.kickDir,Math.min(1,AIC.trap.lerp*dt));}
  // r.act==='dribble' is absent on purpose: it works the ball with the men down and lands on the final `else` (ease toward 0)
  // CHARGE WIND-UP (js/shots.js, classic pad): below the right-stick branch and above r.raise; r.chgA is the sweepClips-capped target
  else if(shotPullAngle(r)!=null){r.heldFwd=false;r.angle=lerp(r.angle,r.chgA,Math.min(1,SHOT.charge.pullLerp*dt));}
  else if(r.padAngleOn){                              // right-stick absolute angle: the stick position is the rod angle (1:1)
   // direct control: snap to the stick-mapped target so angVel carries the stick's real speed into the strike; optional smoothing only if KICK.padAngleLerp>0
   r.heldFwd=false;
   // the tracking rate is what the Total Control triggers bend (shotTrackMult): LT heavy, RT snappy
   const trk=shotTrackMult(r);
   if(KICK.padAngleLerp>0||trk!==1){const rate=(KICK.padAngleLerp>0?KICK.padAngleLerp:SHOT.mod.directLerp)*trk;r.angle=lerp(r.angle,r.padAngleTarget,Math.min(1,rate*dt));}
   else r.angle=r.padAngleTarget;
  }
  // THE PIN POSE (shots.js shotPinInput): finesse + raise; below the stick, above the raise; r.pinA is sweep-capped
  else if(r.pinPose&&r.pinA!=null){r.heldFwd=false;r.angle=lerp(r.angle,r.pinA,Math.min(1,SHOT.pin.lerp*dt));}
  else if(r.raise){r.heldFwd=false;r.angle=lerp(r.angle,backLimit(r,KICK.raiseA*r.kickDir,KICK.raiseLerp),Math.min(1,KICK.raiseLerp*dt));}
  else{r.heldFwd=false;r.angle=lerp(r.angle,0,Math.min(1,KICK.dropLerp*dt));}
   // Total Control's slide multiplier is per seat (each pad has its own triggers)
   const uSeat=seatOf(r);
   let ms=(uSeat?KICK.userSpeed*uSeat.tcMult:DIFFS[teamDiff(r.team)].speed*(S.userTeam>=0&&r.team===S.userTeam?KICK.aiOwnMult:1))*rodSpeedMult(r);
   // carrying a held ball is a shuffle, not a slide (the boot only drags the ball as fast as holdGrip transfers velocity); holdCfg is null mid-swing
   // a pinned ball is carried exactly (physics.js pinBallStep), so its limit is the pin's carry
   {const H=holdCfg(r);if(r.pinB)ms*=SHOT.pin.carry;else if(H)ms*=H.carryMult;}
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
  if(!uSeat&&slideBlocked(r,prevOff,r.offset)){r.offset=prevOff;r.slideV=0;}   // ai.js backGuard: never walk a boot into a ball that is behind it
  msSlide(r,Math.abs(r.offset-prevOff));              // matchstats.js: rod work done, in table units
  r.slideV=(r.offset-prevOff)/dt;                     // keep slideV in sync across control handoff
  r.angVel=(r.angle-r.prevAngle)/dt;
  r.vz=(r.offset-r.prevOffset)/dt;
  r.prevAngle=r.angle;r.prevOffset=r.offset;
  r.cd=Math.max(0,r.cd-dt);
  stExertTick(r,dt);                         // stamina: swing exertion bleeds off (CONFIG.stats.kickFat.recover)
  r.evadeCd=Math.max(0,(r.evadeCd||0)-dt);   // evade re-entry lockout (CONFIG.ai.evade.cd)
  r.lhT=Math.max(0,(r.lhT||0)-dt);           // back guard is holding this rod's lift (CONFIG.ai.backGuard.holdT); ai.js reads it
  r.laneCd=Math.max(0,(r.laneCd||0)-dt);     // lane-clear re-entry lockout (CONFIG.ai.clearLane.cd)
  r.retCd=Math.max(0,(r.retCd||0)-dt);       // retrieve re-entry lockout (CONFIG.ai.retrieve.cd)
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
