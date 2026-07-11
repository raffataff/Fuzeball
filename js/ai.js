'use strict';
/* ================= AI ================= */
function teamRods(t){const a=[];for(const r of rods)if(r.team===t)a.push(r);return a;}
// A man is "live" (usable for aiming/kicking) unless a cannonball removed it and the
// removal window hasn't elapsed — mirrors the removedUntil test in physics/rods/balls.
function manLive(r,i){return!(r.removedUntil[i]&&r.removedUntil[i]>S.time);}
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
     const cz=FOOT_BOX.z+BALL_R+AIC.clearMargin,bz=hb.m.position.z;
     let bo=null,bod=1e9;
     const cand=[r.maxOff,-r.maxOff];
     for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;cand.push(bz-r.baseZ[i]+cz,bz-r.baseZ[i]-cz);}
     for(const o of cand){
      if(o<-r.maxOff||o>r.maxOff)continue;
      let ok=true;for(let j=0;j<r.baseZ.length;j++){if(!manLive(r,j))continue;if(Math.abs(bz-(r.baseZ[j]+o))<cz-.01){ok=false;break;}}
      if(ok){const d=Math.abs(o-r.offset);if(d<bod){bod=d;bo=o;}}
     }
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
  if(bp0.y<AIC.lowY){
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
  const TR=AIC.trap;
  // ---- pre-trap safe-raise: the ball is loitering in the trap x-band (moving sideways —
  //      low |v.x|, slow) but not far enough back to have tripped the raiseBehind latch, so
  //      the rod is sitting DOWN behind it. If the ball is in a z-GAP — no live man's footbox
  //      (z half-extent + raiseBuf) is lined up with it — then raising can't clip it: raise
  //      FULLY and latch (behindFlag) so man-selection below slides a man in behind the ball;
  //      the trap/kick logic then decides to trap or clear. If a foot IS aligned in z, raising
  //      would sweep into the ball, so leave it to the normal path. ----
  if(TR.on&&TR.safeRaise&&r.aiIQ&&r.act!=='trap'&&bp.y<AIC.lowY&&relReal>TR.back&&relReal<TR.front&&Math.abs(best.v.x)<TR.maxVX&&speed<TR.maxSpeed){
   let clip=false;const rz=FOOT_BOX.z+TR.raiseBuf;
   for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;if(Math.abs(bp.z-(r.baseZ[i]+r.offset))<rz){clip=true;break;}}
   if(!clip){r.raise=true;r.behindFlag=true;}   // raise & latch; reposition happens via man-selection below
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
    kickRod(r);                            // scoop shot: the swing from trapA carries the ball forward
    r.cd=D.cd*stCd(r)*rand(AIC.cdSlow[0],AIC.cdSlow[1]);
   }
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
