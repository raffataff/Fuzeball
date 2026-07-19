'use strict';
/* ================= rods ================= */
function isUserRod(r){return S.userTeam>=0&&S.ctrlRods.length>0&&S.ctrlRods[S.ctrl]===r;}

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
function kickRod(r, style){
 if(r.kickT>=0)return;
 r.raise=false;r.kickT=0;r.act=null;r.kickStyle=style||null;
 r.kickHit=false;                       // debug tracer: set true by collideRod on real contact this swing
 r.evadeHold=0;r.evadeSpent=false;      // fresh post-kick held-evade budget for this swing
 if(S.stats)S.stats.kicks[r.team]++;
}
function resetRodRotation(){
 for(const r of rods){
  r.angle=0;r.prevAngle=0;
   r.kickT=-1;r.kickStyle=null;r.raise=false;r.heldFwd=false;r.evadeHold=0;r.evadeSpent=false;r.tcSpin=0;
  r.act=null;r.actT=0;
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
     const KS=r.kickStyle==='trapShot'?AIC.trapShot:KICK;
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
     else if(T<KS.windup)a=KS.windupA*(T/KS.windup);
     else if(T<KS.strike)a=KS.windupA+(KS.strikeA-KS.windupA)*((T-KS.windup)/(KS.strike-KS.windup));
     else if(T<KS.hold)a=KS.strikeA;
     else if(T<KS.drop)a=KS.strikeA*(1-(T-KS.hold)/(KS.drop-KS.hold));
     else{a=0;r.kickT=-1;r.kickStyle=null;if(dbgLogRod===r&&!r.kickHit)dbgRod(r,'WHIFF','no contact — swing completed');}
     r.angle=a*r.kickDir;
  }else if(r.act==='safeRaise'){r.heldFwd=false;r.angle=lerp(r.angle,AIC.safeRaise.angle*r.kickDir,Math.min(1,AIC.safeRaise.lerp*dt));}
  else if(r.act==='trap'){r.heldFwd=false;r.angle=lerp(r.angle,AIC.trap.angle*r.kickDir,Math.min(1,AIC.trap.lerp*dt));}
  else if(r.padAngleOn){                              // right-stick absolute angle: stick position IS the rod angle (1:1)
   // DIRECT control — snap the rod straight to the stick-mapped target so angVel = (angle-prevAngle)/dt
   // carries the stick's REAL speed into the strike (fast flick → big angVel → hard kick). Optional light
   // smoothing only if KICK.padAngleLerp>0; 0 (default) = fully direct, no lag, no capped swing speed.
   r.heldFwd=false;
   r.angle=KICK.padAngleLerp>0?lerp(r.angle,r.padAngleTarget,Math.min(1,KICK.padAngleLerp*dt)):r.padAngleTarget;
  }else if(r.raise){r.heldFwd=false;r.angle=lerp(r.angle,KICK.raiseA*r.kickDir,Math.min(1,KICK.raiseLerp*dt));}
  else{r.heldFwd=false;r.angle=lerp(r.angle,0,Math.min(1,KICK.dropLerp*dt));}
   const ms=(isUserRod(r)?KICK.userSpeed*S.tcMult:DIFFS[teamDiff(r.team)].speed*(S.userTeam>=0&&r.team===S.userTeam?KICK.aiOwnMult:1))*rodSpeedMult(r);
  r.target=clamp(r.target,-r.maxOff,r.maxOff);
  const prevOff=r.offset;
  if(isUserRod(r)){                                   // human hand: instant/responsive, speed-capped only
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
