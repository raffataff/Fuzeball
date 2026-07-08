'use strict';
/* ================= rods ================= */
function isUserRod(r){return S.userTeam>=0&&S.ctrlRods.length>0&&S.ctrlRods[S.ctrl]===r;}
function rodSpeedMult(r){
  const e=S.eff[r.team];let m=stSpeed(r);   // spd stat + stamina fade (1 with no build)
  if(e.frozen>S.time)m*=KICK.freezeMult;
 return m;
}
function kickRod(r){
 if(r.kickT>=0)return;
 r.raise=false;r.kickT=0;
 if(S.stats)S.stats.kicks[r.team]++;
}
function resetRodRotation(){
 for(const r of rods){
  r.angle=0;r.prevAngle=0;
  r.kickT=-1;r.raise=false;
  if(r.behindFlag!=null)r.behindFlag=false;
  r.pivot.rotation.z=0;
 }
}
function updateRods(dt){
 if(dt<=0)return;
 for(const r of rods){
   if(r.kickT>=0){
    r.kickT+=dt;const T=r.kickT;let a;
     let uf=false,dir=r.team===0?1:-1;for(const b of S.balls){const rel=(b.m.position.x-r.x)*dir;if(!b.scored&&rel>=-AIC.underFootBack&&rel<=AIC.underFootFront){uf=true;break;}}
    if(uf&&T>=KICK.hold){a=KICK.strikeA;r.kickT=KICK.hold;}
    else if(T<KICK.windup)a=KICK.windupA*(T/KICK.windup);
    else if(T<KICK.strike)a=KICK.windupA+(KICK.strikeA-KICK.windupA)*((T-KICK.windup)/(KICK.strike-KICK.windup));
    else if(T<KICK.hold)a=KICK.strikeA;
    else if(T<KICK.drop)a=KICK.strikeA*(1-(T-KICK.hold)/(KICK.drop-KICK.hold));
    else{a=0;r.kickT=-1;}
    r.angle=a*r.kickDir;
  }else if(r.raise){r.angle=lerp(r.angle,KICK.raiseA*r.kickDir,Math.min(1,KICK.raiseLerp*dt));}
  else{r.angle=lerp(r.angle,0,Math.min(1,KICK.dropLerp*dt));}
  const ms=(isUserRod(r)?KICK.userSpeed:DIFFS[teamDiff(r.team)].speed*(S.userTeam>=0&&r.team===S.userTeam?KICK.aiOwnMult:1))*rodSpeedMult(r);
  r.target=clamp(r.target,-r.maxOff,r.maxOff);
  const prevOff=r.offset;
  if(isUserRod(r)){                                   // human hand: instant/responsive, speed-capped only
   r.offset+=clamp(r.target-r.offset,-ms*dt,ms*dt);
  }else{                                              // AI hand: accel-capped so it can't reverse instantly
   const want=clamp((r.target-r.offset)/dt,-ms,ms);   // velocity that reaches target this frame, speed-capped
   const acc=AIC.slideAccel*dt;
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
  for(let mi=0;mi<r.men.length;mi++){
   const v=r.removedUntil[mi]?r.removedUntil[mi]<=S.time:true;
   if(r.men[mi].visible!==v)r.men[mi].visible=v;
  }
 }
}
