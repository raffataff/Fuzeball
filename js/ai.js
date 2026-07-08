'use strict';
/* ================= AI ================= */
function teamRods(t){const a=[];for(const r of rods)if(r.team===t)a.push(r);return a;}
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
  if(S.pairCd[t]>0&&valid)continue;   // committed — leave the pair alone
  const fb=focusBall(t),bx=fb?fb.m.position.x:(t===0?F.L/2:-F.L/2);
  const ranked=tr.slice().sort((a,b)=>Math.abs(a.x-bx)-Math.abs(b.x-bx));
  const pick=[];if(forced)pick.push(forced);
  for(const r of ranked){if(pick.length>=n)break;if(pick.indexOf(r)<0)pick.push(r);}
  S.active[t]=pick;S.pairCd[t]=AIC.pairCommit;
 }
}
function isActiveRod(r){const a=S.active[r.team];return!a||!a.length||a.indexOf(r)>=0;}
 function aiUpdate(dt){
  pickActiveRods(dt);
  const Dred=DIFFS[teamDiff(0)];
  const Dblue=DIFFS[teamDiff(1)];
  for(const r of rods){
   if(isUserRod(r))continue;
   if(!isActiveRod(r)){r.raise=false;continue;}   // a resting hand: hold its lane, block passively
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
  if(r.aiErrT<=0){r.aiErrT=rand(AIC.errEvery[0],AIC.errEvery[1]);r.aiErrTarget=rand(-D.err,D.err)*stErr(r);r.aiGoalZ=rand(-1,1);}
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
   const gz=clamp((r.aiGoalZ||0)*(1-acc)*F.goalHalf*AIC.aimSpread,-F.goalHalf*AIC.aimGoalZ,F.goalHalf*AIC.aimGoalZ);
   pz+=clamp(-((gz-bp0.z)/dx)*AIC.aimGain,-AIC.aimMax,AIC.aimMax);
  }
  if(r.role==='GK')pz=clamp(pz,-F.goalHalf-AIC.gkPad,F.goalHalf+AIC.gkPad);
  const bp=best.m.position;
  const relReal=(bp.x-r.x)*dir;           // real ahead/behind for reach decisions
  const speed=best.v.length();
  const slow=speed<AIC.slowSpeed;
  // ---- alignment vs the man actually closest to the real ball z (not the predicted target).
  //      Computed up-front so the raise latch, drop check, and kick check all share it. ----
  let mz=r.baseZ[0]+r.offset;
  for(let i=1;i<r.baseZ.length;i++){const z=r.baseZ[i]+r.offset;if(Math.abs(bp.z-z)<Math.abs(bp.z-mz))mz=z;}
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
  // ---- man selection: always run so the rod is already positioned at the strike z
  //      when it drops into the kick (no last-second snap). ----
  let bi=0,bo=0,be=1e9;
  for(let i=0;i<r.baseZ.length;i++){
   const off=clamp(pz-r.baseZ[i],-r.maxOff,r.maxOff);
   const err=Math.abs(pz-(r.baseZ[i]+off));
   if(err<be){be=err;bi=i;bo=off;}
  }
  if(r.aiMan>=0&&r.aiMan<r.baseZ.length&&r.aiMan!==bi){
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
   let fz=1e9;for(let i=0;i<r.baseZ.length;i++)fz=Math.min(fz,Math.abs(bp.z-(r.baseZ[i]+r.offset)));
   if(fz<AIC.footTrapZ) r.raise=false;
  }
  // ---- drop the rod as soon as the ball is in reach AND a man is aligned, so the
  //      kick/pre-kick below can fire.  Gated by !behindFlag: while the latch is
  //      engaged (ball came from behind, hasn't reached the feet yet) we MUST NOT
  //      drop — otherwise the rod drops in the inFront window and kicks the ball
  //      backward.  The latch only releases on overFoot, at which point behindFlag
  //      is already false and this check fires normally. ----
  if(r.raise && !r.behindFlag && (overFoot||inFront) && aligned && bp.y<AIC.lowY && speed<AIC.repositionSpeed*1.4) r.raise=false;
  // Swing at anything we can actually hit — this is what makes the AI clear balls at its feet.
  if(r.kickT<0 && r.cd<=0 &&  (overFoot||inFront) && aligned && bp.y<AIC.lowY){
   kickRod(r);
   r.cd=D.cd*stCd(r)*(slow?rand(AIC.cdSlow[0],AIC.cdSlow[1]):rand(AIC.cdFast[0],AIC.cdFast[1])); // rea stat trims recovery
  }
 }
}
