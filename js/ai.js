'use strict';
/* ================= AI ================= */
function teamRods(t){const a=[];for(const r of rods)if(r.team===t)a.push(r);return a;}
// A man is "live" (usable for aiming/kicking) unless a cannonball removed it and the
// removal window hasn't elapsed — mirrors the removedUntil test in physics/rods/balls.
function manLive(r,i){return!(r.removedUntil[i]&&r.removedUntil[i]>S.time);}
// Rectangular "a live foot could touch this ball" test — ONE source of truth for the
// safe-raise / safe-lower reach questions. The box is dir-relative around each live foot on
// the rod: it reaches underFootFront ahead (a dropping/kicking swing) and footRangeBack behind
// (a raising swing sweeps back), and footBox.z + BALL_R + clearMargin either side in z (a
// foot's z footprint). True ⇒ lowering/raising the rod right now would clip ball b.
function inFootRange(r,b){
 const dir=r.team===0?1:-1,rel=(b.m.position.x-r.x)*dir;
 if(rel>AIC.underFootFront||rel<-AIC.footRangeBack)return false;
 const hz=FOOT_BOX.z+BALL_R+AIC.clearMargin,bz=b.m.position.z;
 for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;if(Math.abs(bz-(r.baseZ[i]+r.offset))<hz)return true;}
 return false;
}
// Nearest slide offset where NO live foot is within cz of the ball z bz — i.e. the rod is z-clear
// of the ball. `prefer` (−1/0/+1) restricts the search to one side of the current offset (used by
// evade to step AWAY from the ball rather than through it). Candidates are each foot's ±cz edge
// plus the two slide limits; returns null if none clears on the requested side. Shared by the
// post-kick side-step and the evade action.
function clearOffset(r,bz,cz,prefer){
 let best=null,bd=1e9;
 const cand=[r.maxOff,-r.maxOff];
 for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;cand.push(bz-r.baseZ[i]+cz,bz-r.baseZ[i]-cz);}
 for(const o of cand){
  if(o<-r.maxOff||o>r.maxOff)continue;
  if(prefer&&(o-r.offset)*prefer<=0)continue;                 // wrong side of the ball
  let ok=true;
  for(let j=0;j<r.baseZ.length;j++){if(!manLive(r,j))continue;if(Math.abs(bz-(r.baseZ[j]+o))<cz-.01){ok=false;break;}}
  if(ok){const d=Math.abs(o-r.offset);if(d<bd){bd=d;best=o;}}
 }
 return best;
}
// The live threat for a team = the ball nearest that team's OWN goal. As it travels
// up-pitch the nearest rods shift from keeper/def to mid/att on their own, so the pair
// picked below reads like a defence unit when pinned and an attack unit when pushing.
function focusBall(t){
 const gx=t===0?-F.L/2:F.L/2;let fb=null,bd=1e9;
 for(const b of S.balls){if(b.scored)continue;const d=Math.abs(b.m.position.x-gx);if(d<bd){bd=d;fb=b;}}
 return fb;
}
// Only AIC.hands rods per team may actively move at once (two 'hands'). The rest hold
// their lane and block passively. The active pair = the rods nearest the live threat in
// x, recomputed on a commit timer so it can't flicker frame-to-frame. The user's own
// controlled rod is always forced into their team's pair (that's the hand they're using).
function pickActiveRods(dt){
  const H=AIC.hands;
  for(let t=0;t<2;t++){
   S.pairCd[t]-=dt;
   const tr=teamRods(t),n=Math.min(H,tr.length);
   const forced=(S.userTeam===t&&S.ctrlRods.length)?S.ctrlRods[S.ctrl]:null;
   const cur=S.active[t]||[];
   const valid=cur.length===n&&cur.every(r=>tr.indexOf(r)>=0)&&(!forced||cur.indexOf(forced)>=0);
   if(S.pairCd[t]>0&&valid)continue;
   const fb=focusBall(t),bx=fb?fb.m.position.x:(t===0?F.L/2:-F.L/2);
   const dir=t===0?1:-1;
   const ranked=tr.slice().sort((a,b)=>{
    const behindA=Math.max(0,(a.x-bx)*dir);
    const behindB=Math.max(0,(b.x-bx)*dir);
    const penaltyA=behindA>10?behindA*10:0;
    const penaltyB=behindB>10?behindB*10:0;
    return (Math.abs(a.x-bx)+penaltyA)-(Math.abs(b.x-bx)+penaltyB);
   });
   const pick=[];if(forced)pick.push(forced);
   for(const r of ranked){if(pick.length>=n)break;if(pick.indexOf(r)<0)pick.push(r);}
   S.active[t]=pick;S.pairCd[t]=AIC.pairCommit;
  }
 }
function isActiveRod(r){const a=S.active[r.team];return!a||!a.length||a.indexOf(r)>=0;}
// Gap-aware shot evaluation. From the ball at (bx,bz), sample target z's across the opponent
// goal mouth and score each lane by its clearance to the nearest BLOCKING opposing man — any
// live man on a rod between the ball and the goal (the keeper is just the last one). clr =
// z-distance from the straight ball→(goalX,tz) line to that man, minus blockR (his block
// half-width): >0 means the shot misses everyone by that margin. The widest-clearance lane is
// 'best' (ties break toward centre). Returns lanes[] + best + origin for the debug overlay.
function shotEval(team,bx,bz){
 const dir=team===0?1:-1,goalX=dir>0?F.L/2:-F.L/2,GA=AIC.gapAim;
 const span=F.goalHalf*AIC.aimGoalZ;
 const obs=[];
 for(const r2 of rods){
  if(r2.team===team)continue;                                     // only opponents block
  if((r2.x-bx)*dir<=GA.minAhead||(r2.x-goalX)*dir>0)continue;      // must sit between ball and goal
  for(let i=0;i<r2.baseZ.length;i++){if(r2.removedUntil[i]&&r2.removedUntil[i]>S.time)continue;obs.push({x:r2.x,z:r2.baseZ[i]+r2.offset});}
 }
 const n=GA.samples,lanes=[],denom=(goalX-bx)||1e-3;
 for(let s=0;s<n;s++){
  const tz=n>1?-span+2*span*(s/(n-1)):0;
  let clr=1e9;
  for(const o of obs){const t=(o.x-bx)/denom,lz=bz+(tz-bz)*t,d=Math.abs(lz-o.z)-GA.blockR;if(d<clr)clr=d;}
  lanes.push({tz,clr});
 }
 let best=lanes[0];
 for(const l of lanes){if(l.clr>best.clr+1e-3||(Math.abs(l.clr-best.clr)<=1e-3&&Math.abs(l.tz)<Math.abs(best.tz)))best=l;}
 return {lanes,best,goalX,ox:bx,oz:bz};
}
 function aiUpdate(dt){
  pickActiveRods(dt);
  const Dred=DIFFS[teamDiff(0)];
  const Dblue=DIFFS[teamDiff(1)];
  const GA=AIC.gapAim;
  for(const r of rods){
   if(isUserRod(r))continue;
   r.aimEv=null;                          // cleared each frame; set only while gap-aiming (debug + hold read it)
   // how many of this rod's men are still on the pitch (cannonball can remove them). If
   // ALL are gone the rod can't touch the ball, so drop it out of the aim/kick logic.
   let liveN=0;for(let i=0;i<r.baseZ.length;i++)if(manLive(r,i))liveN++;
   if(!liveN){r.raise=false;r.behindFlag=false;r.act=null;continue;}
   // ---- safe-lower side-step: this rod kicked, missed, and is HELD forward by a ball
   //      still in its drop-sweep zone (updateRods pins kickT at KICK.hold and sets
   //      heldFwd). Do NOT keep aligning onto the ball — that was the hover-forever
   //      deadlock. Instead slide to the NEAREST offset where every foot is at least
   //      clearZ from the ball in z; the hold then releases and the swing drops itself.
   //      Runs before the active-pair check on purpose: a rod benched mid-hold must
   //      still escape or it hangs forward for the rest of the point. ----
   if(r.heldFwd){
    let hb=null,hd=1e9;const hdir=r.team===0?1:-1;
    for(const b of S.balls){if(b.scored)continue;const rel=(b.m.position.x-r.x)*hdir;
     if(rel<-AIC.underFootBack||rel>AIC.underFootFront)continue;
     const ad=Math.abs(rel);if(ad<hd){hd=ad;hb=b;}}
    if(hb&&hb.v.length()<AIC.repositionSpeed){
     const cz=FOOT_BOX.z+BALL_R+AIC.clearMargin;
     const bo=clearOffset(r,hb.m.position.z,cz,0);              // nearest z-clear offset, either side
     if(bo!=null)r.target=bo;
    }
    continue;
   }
   if(!isActiveRod(r)){
    if(r.behindFlag)continue;
    r.raise=false;continue;
  }   // a resting hand: hold its lane, block passively
   const D=r.team===0?Dred:Dblue;
   let best=null,bd=1e9;
   for(const b of S.balls){if(b.scored)continue;
    const d=Math.abs(b.m.position.x-r.x);if(d<bd){bd=d;best=b;}}
   if(!best){r.target=0;r.raise=false;r.behindFlag=false;continue;}
   const k=1-Math.exp(-dt/Math.max(.02,D.react*stReact(r)));   // rea stat + stamina fade
  r.aiBX=lerp(r.aiBX,best.m.position.x,k);
  r.aiBZ=lerp(r.aiBZ,best.m.position.z,k);
  r.aiBVX=lerp(r.aiBVX,best.v.x,k);
  r.aiBVZ=lerp(r.aiBVZ,best.v.z,k);
  // Wandering aim error DRIFTS toward a fresh target instead of snapping — smooth motion.
  r.aiErrT-=dt;
  if(r.aiErrT<=0){r.aiErrT=rand(AIC.errEvery[0],AIC.errEvery[1]);r.aiErrTarget=rand(-D.err,D.err)*stErr(r);r.aiGoalZ=rand(-1,1);r.aiIQ=Math.random()<clamp((D.iq||0)*stIQ(r),0,1);}
  r.aiErr=lerp(r.aiErr,r.aiErrTarget,Math.min(1,AIC.errLerp*dt));
  const dir=r.team===0?1:-1;
  let pz=r.aiBZ;
  const tta=r.aiBVX!==0?(r.x-r.aiBX)/r.aiBVX:-1;
  if(tta>0&&tta<AIC.ttaMax)pz+=r.aiBVZ*tta*D.pred;
  pz+=r.aiErr;
  // Goal targeting: bias the aim so an off-centre strike sends the ball toward the opponent
  // goal mouth. We pick a spot in the mouth (tight to centre when accurate, sprayed across/past
  // the posts when not — DIFFS.aim shifted by the rod's acc stat), work out the lateral vz/vx
  // needed to reach it, and shift the man to that side of the ball. Offset is clamped small
  // so the foot still makes contact.
  const bp0=best.m.position;
  const relFront=(bp0.x-r.x)*dir;               // ball ahead(+)/behind(−) this rod, dir-relative
  const DEF=AIC.defend;
  if(DEF.on && (r.role==='GK'||r.role==='DEF') && bp0.y<AIC.lowY && relFront>DEF.engage){
   // ---- defending an INCOMING ball: sit on the ball→own-goal-centre line so GK+DEF funnel the
   //      shot at two depths (a triangle) instead of both chasing the ball's z. Each rod's x gives
   //      a different intercept, so the DEF ends up out near the ball and the keeper back at centre. ----
   const ogx=dir>0?-F.L/2:F.L/2;                 // this rod's OWN goal x
   const lead=(tta>0&&tta<AIC.ttaMax)?r.aiBVZ*tta*D.pred:0;
   const bzp=r.aiBZ+lead;                        // predicted ball z (smoothed)
   const t=clamp((r.x-r.aiBX)/((ogx-r.aiBX)||1e-3),0,1); // fraction ball→goal at this rod's x
   const iz=bzp*(1-t);                           // z where the ball→goal-centre line crosses this rod
   pz=lerp(pz,iz,DEF.lineBias*(r.aiIQ?1:DEF.dumbBias)); // smart rods commit; dumb rods only lean in
  }else if(bp0.y<AIC.lowY){
   // ---- attacking / clearing: shift the man to angle the strike toward the OPPONENT goal (gap-aware) ----
   const goalX=dir>0?F.L/2:-F.L/2, dx=Math.max(8,Math.abs(goalX-bp0.x)), acc=stAim(r,D.aim!=null?D.aim:0.6);
   const spray=(r.aiGoalZ||0)*(1-acc)*F.goalHalf*AIC.aimSpread;
   let gz;
   if(GA.gap&&r.aiIQ&&acc>=GA.minAcc){
    // smart + accurate: steer at the widest OPEN lane, with reduced spray still riding on top
    const ev=shotEval(r.team,bp0.x,bp0.z);r.aimEv=ev;
    gz=clamp(ev.best.tz+spray*GA.sprayMix,-F.goalHalf*AIC.aimGoalZ,F.goalHalf*AIC.aimGoalZ);
   }else{
    gz=clamp(spray,-F.goalHalf*AIC.aimGoalZ,F.goalHalf*AIC.aimGoalZ); // old centre + full spray
   }
   pz+=clamp(-((gz-bp0.z)/dx)*AIC.aimGain,-AIC.aimMax,AIC.aimMax);
  }
  if(r.role==='GK')pz=clamp(pz,-F.goalHalf-AIC.gkPad,F.goalHalf+AIC.gkPad);
  const bp=best.m.position;
  const relReal=(bp.x-r.x)*dir;           // real ahead/behind for reach decisions
  const speed=best.v.length();
  const slow=speed<AIC.slowSpeed;
  // ---- alignment vs the man actually closest to the real ball z (not the predicted target).
  //      Computed up-front so the raise latch, drop check, and kick check all share it.
  //      Removed men are skipped — aligning to a destroyed player is a phantom touch. ----
  let mz=null;
  for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;const z=r.baseZ[i]+r.offset;if(mz===null||Math.abs(bp.z-z)<Math.abs(bp.z-mz))mz=z;}
  const dz=Math.abs(bp.z-mz);
  const overFoot=relReal>(AIC.overFootOffset-AIC.overFoot) && relReal<(AIC.overFootOffset+AIC.overFoot); // ball in the forward-offset feet zone (mostly in front of the men, not behind)
  const inFront=relReal>AIC.inFrontMin&&relReal<AIC.inFrontMax;// ball ahead within a forward swing
  const aligned=dz<(slow?AIC.alignSlow:AIC.alignFast);
  // ---- raise decision with a sticky latch: once the ball crosses raiseBehind
  //      (going behind the rod) the rod raises and STAYS raised until the ball
  //      reaches the overFoot zone.  This stops the rod from dropping mid-approach
  //      and kicking the ball backward into its own goal — which is what happens
  //      when raiseBehind is tuned tight.  Released only by the ball arriving at
  //      the feet, so the normal drop + kick path takes over from there. ----
  if(!r.behindFlag && relReal<AIC.raiseBehind) r.behindFlag=true;
  if(r.behindFlag){
   r.raise=true;
   if(overFoot) r.behindFlag=false;        // ball reached the feet — release the latch
  }else{
   r.raise=relReal<AIC.raiseBehind;
  }
  const TR=AIC.trap, SR=AIC.safeRaise;
  // ---- safe-raise action (r.act='safeRaise') — DECOUPLED from the trap action, its OWN
  //      thresholds. A slow, sideways ball loiters in the safe-raise x-band behind the rod but
  //      isn't far enough back to trip the raiseBehind latch, so the rod would otherwise sit
  //      DOWN behind it. If raising won't clip the ball (NOT inFootRange — it sits in a z-gap
  //      between feet) the rod eases to SR.angle (a defined lift, driven in updateRods) while
  //      man-selection slides a man in behind it; when the ball rolls forward to the rod line,
  //      speeds up, or lifts, the action exits and the normal drop+kick clears it with the man
  //      already positioned. Safety gate = inFootRange + the SR band + |v.x|. ----
  if(r.act==='safeRaise'){
   r.actT+=dt;
   if(relReal<=SR.back||relReal>=SR.front||speed>SR.maxSpeed||Math.abs(best.v.x)>=SR.maxVX||bp.y>AIC.lowY||r.actT>SR.abortT)r.act=null;
   else{r.raise=false;r.behindFlag=false;}         // the action owns the angle while it holds
  }else if(SR.on&&r.aiIQ&&!r.act&&bp.y<AIC.lowY&&relReal>SR.back&&relReal<SR.front&&Math.abs(best.v.x)<SR.maxVX&&speed<SR.maxSpeed&&!inFootRange(r,best)){
   r.act='safeRaise';r.actT=0;r.raise=false;r.behindFlag=false;
  }
  // ---- trap action (r.act='trap'): a smart rod (iq roll) catches a slow ball arriving
  //      from behind on a partial back angle instead of full-raising over it, holds it a
  //      beat, then scoops a shot forward. Exit on: ball left the window / sped up / got
  //      high / took too long — the raise latch takes back over. While trapping, man
  //      selection below keeps the trap foot on the ball; the footTrap/drop/kick paths
  //      are all raise- or front-gated so they naturally no-op. ----
  // trap z-gate: outfield rods need a man aligned within alignZ. The GK ALSO commits when the
  // ball sits up to gkReach BEYOND its z-slide band (overshoot past ±maxOff) — so the keeper
  // rotates into the trap posture early for a ball drifting back toward goal it can't slide onto
  // (the scoop below still needs true alignment via dz, so it only holds until then).
  const trapZ=r.role==='GK'?Math.abs(bp.z-clamp(bp.z,r.baseZ[0]-r.maxOff,r.baseZ[0]+r.maxOff))<TR.gkReach:dz<TR.alignZ;
  if(r.act==='trap'){
   r.actT+=dt;
   if(relReal<=TR.back||relReal>=TR.front||speed>TR.maxSpeed||bp.y>AIC.lowY||r.actT>TR.abortT)r.act=null;
  }else if(TR.on&&r.aiIQ&&r.raise&&relReal>TR.back&&relReal<TR.front&&bp.y<AIC.lowY&&Math.abs(best.v.x)<TR.maxVX&&speed<TR.maxSpeed&&trapZ){
   r.act='trap';r.actT=0;
  }
  if(r.act==='trap'){
   r.raise=false;r.behindFlag=false;       // trap owns the angle (updateRods) — latch released
    if(r.actT>TR.settleT&&relReal>TR.shootFrom&&dz<TR.alignZ&&r.kickT<0&&r.cd<=0){
     kickRod(r,'trapShot');                 // scoop shot with dedicated trap power window
     r.cd=D.cd*stCd(r)*rand(AIC.cdSlow[0],AIC.cdSlow[1]);
    }
  }
  // ---- evade action (r.act='evade'): a slow ball is stuck directly BEHIND a man (inFootRange)
  //      and we're neither trapping nor lifting it (no gap for safe-raise, not past the raise
  //      latch). Instead of shadowing it in z — which just walls it in place — slide the men
  //      AWAY until it's no longer inFootRange, un-sticking it. Direction: opposite the ball's
  //      z-drift when it has momentum, else opposite the side it sits on (commits, no dither).
  //      Skips man-selection + kick while active (the rod just slides clear); exits the instant
  //      the ball clears / speeds up / comes to the front / goes deep-behind (latch takes it). ----
  const EV=AIC.evade;
  if(r.act==='evade'){
   r.actT+=dt;
   if(overFoot||inFront||r.behindFlag||speed>=EV.maxSpeed||bp.y>AIC.lowY||!inFootRange(r,best)||r.actT>EV.abortT)r.act=null;
  }else if(EV.on&&!r.act&&!r.behindFlag&&!overFoot&&!inFront&&bp.y<AIC.lowY&&speed<EV.maxSpeed&&inFootRange(r,best)){
   r.act='evade';r.actT=0;
  }
  if(r.act==='evade'){
   r.raise=false;r.behindFlag=false;
   const cz=FOOT_BOX.z+BALL_R+AIC.clearMargin,bz=bp.z;
   const prefer=Math.abs(best.v.z)>EV.vz?(best.v.z>0?-1:1):((bz-r.offset)>0?-1:1);
   let o=clearOffset(r,bz,cz,prefer);
   if(o==null)o=clearOffset(r,bz,cz,0);       // no room on the chosen side — take the nearest clear either way
   if(o!=null)r.target=o;
   r.aiMan=-1;                                 // free the man-index hysteresis for the next re-pick
   continue;                                   // don't re-align onto the ball or kick this frame
  }
  // ---- man selection: always run so the rod is already positioned at the strike z
  //      when it drops into the kick (no last-second snap). Removed men are skipped so
  //      the rod aims with a player that's actually there (liveN>0 guaranteed above). ----
  let bi=-1,bo=0,be=1e9;
  for(let i=0;i<r.baseZ.length;i++){
   if(!manLive(r,i))continue;
   const off=clamp(pz-r.baseZ[i],-r.maxOff,r.maxOff);
   const err=Math.abs(pz-(r.baseZ[i]+off));
   if(err<be){be=err;bi=i;bo=off;}
  }
  if(r.aiMan>=0&&r.aiMan<r.baseZ.length&&r.aiMan!==bi&&manLive(r,r.aiMan)){
   const po=clamp(pz-r.baseZ[r.aiMan],-r.maxOff,r.maxOff);
   const pe=Math.abs(pz-(r.baseZ[r.aiMan]+po));
   if(pe-be<AIC.manHyst){bi=r.aiMan;bo=po;}
  }
  r.aiMan=bi;
  if(Math.abs(bo-r.target)>AIC.retargetDead)r.target=bo;
  // ---- foot-trap break: drop a raised rod when a slow ball is pinned right at a foot
  //      (previously dead code — AIC.footTrapSlow / footTrapZ were undefined).
  //      Gated by !behindFlag so the latch takes priority — the ball must reach the
  //      feet (overFoot) before any drop path releases the rod. ----
  if(r.raise && !r.behindFlag && bp.y<AIC.lowY && speed<AIC.footTrapSlow){
   let fz=1e9;for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;fz=Math.min(fz,Math.abs(bp.z-(r.baseZ[i]+r.offset)));}
   if(fz<AIC.footTrapZ) r.raise=false;
  }
  // ---- drop the rod as soon as the ball is in reach AND a man is aligned, so the
  //      kick/pre-kick below can fire.  Gated by !behindFlag: while the latch is
  //      engaged (ball came from behind, hasn't reached the feet yet) we MUST NOT
  //      drop — otherwise the rod drops in the inFront window and kicks the ball
  //      backward.  The latch only releases on overFoot, at which point behindFlag
  //      is already false and this check fires normally. ----
  if(r.raise && !r.behindFlag && (overFoot||inFront) && aligned && bp.y<AIC.lowY && speed<AIC.repositionSpeed*1.4) r.raise=false;
  // ---- sweet-spot wait: a smart rod (iq roll) with the ball inbound through the inFront
  //      window holds its swing until the overFoot arrival instead of poking at full
  //      stretch — meatier, better-aimed strike. Only when the ball genuinely arrives
  //      soon (tta) and is carrying real x-speed; a stalling ball gets kicked now. ----
  const wait=r.aiIQ&&!overFoot&&inFront&&tta>0&&tta<AIC.waitTta&&Math.abs(r.aiBVX)>AIC.waitMinVX;
  // ---- hold for a better shot: a smart ATT/MID with the ball under control at its feet and
  //      NO open lane (best clearance below openMargin) keeps possession instead of blasting
  //      into traffic, up to gapAim.holdMax, then fires anyway. Defenders/keepers never hold —
  //      they clear. Resets the moment a lane opens, the ball speeds up, or it leaves the feet. ----
  let holdShot=false;
  if(GA.gap&&r.aiIQ&&r.aimEv&&overFoot&&slow&&(r.role==='ATT'||r.role==='MID')&&r.aimEv.best.clr<GA.openMargin){
   r.shotHoldT=(r.shotHoldT||0)+dt;holdShot=r.shotHoldT<GA.holdMax;
  }else r.shotHoldT=0;
  // Swing at anything we can actually hit — this is what makes the AI clear balls at its feet.
  if(r.kickT<0 && r.cd<=0 &&  (overFoot||inFront) && aligned && bp.y<AIC.lowY && !wait && !holdShot){
   kickRod(r);
   r.cd=D.cd*stCd(r)*(slow?rand(AIC.cdSlow[0],AIC.cdSlow[1]):rand(AIC.cdFast[0],AIC.cdFast[1])); // rea stat trims recovery
  }
 }
}
