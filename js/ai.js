'use strict';
/* ================= AI ================= */
// --- reaction latency ------------------------------------------------------
// The AI perceives the ball with a genuine reaction DELAY: each sim step every live ball's
// {x,y,z,vx,vy,vz} is pushed into a per-ball ring buffer, and a rod reads the sample from
// round(reactDelay*hz) steps back instead of the live value. So the rod responds to where the
// ball WAS a beat ago — fast balls can slip past before it swings, which reads as human rather
// than frame-perfect. The existing 'react' low-pass smoothing still rides on top as hand wobble.
// Buffer length covers CONFIG.ai.reactMax seconds; back-index is clamped to what's recorded.
const REACT_LEN=Math.max(1,Math.ceil(AIC.reactMax*SIM.hz)+1);
function ensureHist(b){
 let h=b.hist;
 if(!h){h=b.hist=new Array(REACT_LEN);for(let i=0;i<REACT_LEN;i++)h[i]={x:0,y:0,z:0,vx:0,vy:0,vz:0};b.histW=0;}
 return h;
}
// Push the ball's current authoritative sim state (called once per sim step, top of aiUpdate).
function ballRecord(b){const h=ensureHist(b),p=b.m.position,v=b.v,s=h[b.histW%REACT_LEN];
 s.x=p.x;s.y=p.y;s.z=p.z;s.vx=v.x;s.vy=v.y;s.vz=v.z;b.histW++;}
function recordBalls(){for(const b of S.balls)ballRecord(b);}
// Fill the whole ring with the current state — call after any teleport (serve/redrop/split/NaN)
// so the delayed view snaps to the new spot instead of streaking from the old one. syncBall does.
function primeBallHist(b){const h=ensureHist(b),p=b.m.position,v=b.v;
 for(let i=0;i<REACT_LEN;i++){const s=h[i];s.x=p.x;s.y=p.y;s.z=p.z;s.vx=v.x;s.vy=v.y;s.vz=v.z;}b.histW=REACT_LEN;}
// A reusable per-rod proxy that mimics {m:{position}, v} but holds the ball's DELAYED state, so
// all the reach/kick/aim reads below (bp, best.v, speed…) run off perception without touching the
// real ball. delay ≤0 or no history → passes the live state through. .real keeps the true ball.
function aiView(r,b,delay){
 const pv=r.pv||(r.pv={m:{position:new THREE.Vector3()},v:new THREE.Vector3(),real:null,scored:false});
 pv.real=b;pv.scored=b.scored;
 const h=b.hist,avail=Math.min(b.histW|0,REACT_LEN);
 if(delay>0&&h&&avail>0){
  const back=clamp(Math.round(delay*SIM.hz),0,avail-1),s=h[(b.histW-1-back)%REACT_LEN];
  pv.m.position.set(s.x,s.y,s.z);pv.v.set(s.vx,s.vy,s.vz);
 }else{pv.m.position.copy(b.m.position);pv.v.copy(b.v);}
 return pv;
}
function teamRods(t){const a=[];for(const r of rods)if(r.team===t)a.push(r);return a;}
// A man is "live" (usable for aiming/kicking) unless a cannonball removed it and the
// removal window hasn't elapsed — mirrors the removedUntil test in physics/rods/balls.
function manLive(r,i){return!(r.removedUntil[i]&&r.removedUntil[i]>S.time);}
// Rectangular "a live foot could touch this ball" test — ONE source of truth for the
// safe-raise / safe-lower reach questions. The box is dir-relative around each live foot on
// the rod: it reaches underFootFront ahead (a dropping/kicking swing) and `back` behind
// (a raising swing sweeps back), and footBox.z + BALL_R + clearMargin either side in z (a
// foot's z footprint). True ⇒ lowering/raising the rod right now would clip ball b.
// `back` defaults to the full footRangeBack (the raise-sweep depth); pass a smaller value
// (e.g. underFootBack) for a tighter "ball is right at the feet" test — used to drop the
// raise latch only when the ball is genuinely close, not the moment it enters the deep reach.
function inFootRange(r,b,back){
 back=(back===undefined)?AIC.footRangeBack:back;
 const dir=r.team===0?1:-1,rel=(b.m.position.x-r.x)*dir;
 if(rel>AIC.underFootFront||rel<-back)return false;
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
// The z-position of the live foot nearest ball-z bz (null if the rod has no men left). This — NOT
// r.offset — is where the ball is actually trapped, so it's what the escape direction must be
// measured against.
function nearestFootZ(r,bz){
 let fz=null;
 for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;const z=r.baseZ[i]+r.offset;if(fz===null||Math.abs(bz-z)<Math.abs(bz-fz))fz=z;}
 return fz;
}
// Pick the slide-away direction for an evade ONCE and COMMIT it (cached on r.evadeDir, cleared when
// the action ends / the post-kick latch rearms / on kickRod). Recomputing per frame let the sign
// flip as the ball drifted across the foot line, which is the dithering that reads as "the rod
// follows the ball then darts off". Two signals, in priority order:
//  • Real z-drift (|v.z| > vzGate) → step OPPOSITE it, so we don't slide into where it's heading.
//    Gate must be > 0: at 0 the sign comes from near-zero noise on a resting ball, i.e. a coin flip
//    every frame — which is exactly what heldFwd was doing.
//  • Otherwise geometry → the side of the MINIMUM-TRAVEL escape (clearOffset with prefer 0). That
//    escape is by construction the side the trapped foot is already closest to leaving, so it can
//    never sweep a foot ACROSS the ball. Fallback (already clear / no room) is the ball's side of
//    the nearest FOOT.
//    NOTE: the old test was (ball.z − r.offset) — the ball's side of the rod's CENTRE LINE. That's
//    only equivalent for the 1-man GK; on a 2/3/5-man rod the trapped foot sits at baseZ[i]+offset,
//    so the test regularly chose the direction that dragged the men THROUGH the ball and out to the
//    far side before clearing.
function evadeDir(r,b,cz,vzGate){
 if(r.evadeDir)return r.evadeDir;
 const bz=b.m.position.z;
 let d=0;
 if(Math.abs(b.v.z)>vzGate)d=b.v.z>0?-1:1;
 else{
  const o=clearOffset(r,bz,cz,0);
  if(o!=null&&Math.abs(o-r.offset)>1e-4)d=o>r.offset?1:-1;
  else{const fz=nearestFootZ(r,bz);d=(fz!==null&&bz>fz)?-1:1;}
 }
 return r.evadeDir=d||1;
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
  recordBalls();               // snapshot every ball's true state this step so rods can read it delayed
  pickActiveRods(dt);
  const Dred=DIFFS[teamDiff(0)];
  const Dblue=DIFFS[teamDiff(1)];
  const GA=AIC.gapAim;
  for(const r of rods){
   if(isUserRod(r))continue;
   // training sandbox: a hidden rod or a team with its AI toggled off holds dead still —
   // target pinned to the current offset, men down, no actions. (S.trn is null outside training.)
   if(S.trn&&(r.trnHidden||!S.trn.ai[r.team])){r.raise=false;r.behindFlag=false;r.act=null;r.aimEv=null;r.target=r.offset;continue;}
   r.aimEv=null;                          // cleared each frame; set only while gap-aiming (debug + hold read it)
   // how many of this rod's men are still on the pitch (cannonball can remove them). If
   // ALL are gone the rod can't touch the ball, so drop it out of the aim/kick logic.
   let liveN=0;for(let i=0;i<r.baseZ.length;i++)if(manLive(r,i))liveN++;
   if(!liveN){r.raise=false;r.behindFlag=false;r.act=null;continue;}
   // ---- post-kick hold-evade (CONFIG.ai.heldFwd): after a kick, if a SLOW ball is still in this
   //      rod's DROP-SWEEP x-window, keep the rod HELD FORWARD (updateRods pins the strike angle
   //      while r.evadeHold is live) and slide the men decisively AWAY (direction from evadeDir:
   //      opposite the ball's z-drift, else the minimum-travel escape past the trapped foot — chosen
   //      ONCE per latch) while SUPPRESSING re-aim + re-kick, until the ball leaves the x-window /
   //      speeds up / the safety timer expires.
   //      The persistent latch (r.evadeHold) is the fix for "follows the ball swinging": without it
   //      the rod cleared z for ONE frame, dropped, and man-selection dragged it straight back onto
   //      the slow ball to re-kick. It never lowers while the ball is in front, so the drop can't
   //      swipe it backward. Runs before the active-pair check: a benched rod mid-hold must still
   //      escape or it hangs forward for the rest of the point. ----
   const HF=AIC.heldFwd;
   if(HF.on&&(r.heldFwd||r.evadeHold>0)){
    let hb=null,hd=1e9;const hdir=r.team===0?1:-1;
    for(const b of S.balls){if(b.scored)continue;const rel=(b.m.position.x-r.x)*hdir;
     if(rel<-HF.xBack||rel>HF.xFront)continue;
     const ad=Math.abs(rel);if(ad<hd){hd=ad;hb=b;}}
    if(hb&&hb.v.length()<HF.maxSpeed){
     if(!r.evadeSpent){
      r.evadeHold=(r.evadeHold||0)+dt;                          // latch: persists past the swing's completion so re-aim can't re-grab the ball
      if(r.evadeHold<HF.abortT){                                // within the budget → slide AWAY + suppress re-aim/kick
       const cz=FOOT_BOX.z+BALL_R+HF.zMargin,bz=hb.m.position.z;
       const prefer=evadeDir(r,hb,cz,HF.vz);                    // committed once per latch — genuinely no dither
       let o=clearOffset(r,bz,cz,prefer);
       if(o==null)o=clearOffset(r,bz,cz,0);                     // no room that way — take the nearest clear either side
       if(o!=null)r.target=o;
       r.aiMan=-1;                                              // free man-index hysteresis for the post-release re-pick
       if(dbgLogRod===r)dbgRod(r,'HELD-ESC','rel='+((hb.m.position.x-r.x)*hdir).toFixed(1)+' tgt='+r.target.toFixed(1)+' t='+r.evadeHold.toFixed(1));
       continue;
      }
      r.evadeSpent=true;                                        // budget spent (couldn't clear — e.g. wall-jammed): stop pinning, drop when z-clear, let the dead-ball redrop relieve it
      if(dbgLogRod===r)dbgRod(r,'HELD-SPENT','evade budget spent — releasing to dead-ball');
     }
     // spent: fall through to the normal path. updateRods no longer evade-pins (uf still guards a
     // ball right at the feet), so the swing drops once z-clear and play resumes.
    }else{r.evadeHold=0;r.evadeSpent=false;r.evadeDir=0;}       // ball left the x-window / sped up → rearm (fresh direction next time)
   }
   if(!isActiveRod(r)){
    if(dbgLogRod===r)dbgRod(r,'BENCH');
    if(r.behindFlag)continue;
    r.raise=false;continue;
  }   // a resting hand: hold its lane, block passively
   const D=r.team===0?Dred:Dblue;
   let best=null,bd=1e9;
   for(const b of S.balls){if(b.scored)continue;
    const d=Math.abs(b.m.position.x-r.x);if(d<bd){bd=d;best=b;}}
   if(!best){r.target=0;r.raise=false;r.behindFlag=false;continue;}
   // Perceive the ball with a reaction LATENCY: from here down, 'best' is a delayed proxy (real
   // ball at .real). Nearest-ball selection above stays live — only the reach/aim/kick reads lag.
   best=aiView(r,best,(D.reactDelay||0)*stReact(r));
   const k=1-Math.exp(-dt/Math.max(.02,D.react*stReact(r)));   // rea stat + stamina fade
   const predL=D.pred*stPred(r);                               // iq stat scales trajectory anticipation
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
  if(tta>0&&tta<AIC.ttaMax)pz+=r.aiBVZ*tta*predL;
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
   const lead=(tta>0&&tta<AIC.ttaMax)?r.aiBVZ*tta*predL:0;
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
  // wall-hug rescue: a ball pinned against a side wall sits beyond the outermost man's
  // centrable range (that man is jammed at ±maxOff), so dz never falls under alignSlow —
  // yet the capsule still reaches it. When the nearest man is slid to its limit TOWARD such
  // a ball and it's within capsule reach in z, treat it as aligned so the rod swings and
  // knocks it loose instead of dead-balling beside it. Guarded to genuine wall-hugs.
  const wallHug=Math.abs(bp.z)>F.W/2-AIC.wallReach && Math.abs(r.offset)>r.maxOff-AIC.wallSlack
                && (bp.z-mz)*r.offset>0 && dz<AIC.wallReach;
  const aligned=dz<(slow?AIC.alignSlow:AIC.alignFast)||wallHug;
  // ---- raise decision with a sticky latch: once the ball crosses raiseBehind
  //      (going behind the rod) the rod raises and STAYS raised until the ball
  //      reaches the overFoot zone.  This stops the rod from dropping mid-approach
  //      and kicking the ball backward into its own goal — which is what happens
  //      when raiseBehind is tuned tight.  Released only by the ball arriving at
  //      the feet, so the normal drop + kick path takes over from there.
  //      EXCEPTION: a ball sitting in a live foot's reach must NOT swing back — the raising
  //      swing sweeps the foot backward THROUGH the ball into our own goal (esp. the GK).
  //      Purely LOCATION-based, no speed gate. TWO reaches, so the latch doesn't lower too early:
  //      • footStuck (full footRangeBack, 7.2u) — vetoes the back-swing ACTIONS (safeRaise/trap)
  //        below, whose swing genuinely sweeps that deep.
  //      • latchStuck (tighter underFootBack, 2.9u) — DROPS the raise latch only when the ball is
  //        genuinely at the feet. A ball approaching from deep keeps the rod raised (latched) all
  //        the way in instead of the men lowering the instant it enters the 7.2u back-reach.
  //      Either way the men then drop + the evade action slides the rod clear. ----
  const footStuck=inFootRange(r,best);
  const latchStuck=inFootRange(r,best,AIC.underFootBack);
  if(latchStuck){
   r.raise=false;r.behindFlag=false;       // ball right at the feet — drop, never swing back through it
  }else{
   if(!r.behindFlag && relReal<AIC.raiseBehind) r.behindFlag=true;
   if(r.behindFlag){
    r.raise=true;
    if(overFoot) r.behindFlag=false;       // ball reached the feet — release the latch
   }else{
    r.raise=relReal<AIC.raiseBehind;
   }
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
   // Good-hit override: if the ball has arrived at a strikeable, aligned, low position and we're
   // off cooldown, bail out of the lift THIS frame so the normal kick gate below fires instead of
   // holding the raise and letting the drop-nudge it. (safeRaise otherwise exits only on the ball
   // leaving the band / speeding up / lifting / timing out — none of which is "it's a good hit".)
   const srKick=(overFoot||inFront)&&aligned&&r.kickT<0&&r.cd<=0;
   // footStuck bail: if the ball has drifted into a foot's back-swing reach while we're lifted,
   // abort NOW so the men drop instead of the lift sweeping back through it (own-goal guard).
   if(srKick||footStuck||relReal<=SR.back||relReal>=SR.front||speed>SR.maxSpeed||Math.abs(best.v.x)>=SR.maxVX||bp.y>AIC.lowY||r.actT>SR.abortT){r.act=null;r.raise=false;r.behindFlag=false;}
   else{r.raise=false;r.behindFlag=false;}         // the action owns the angle while it holds
  }else if(SR.on&&r.aiIQ&&!r.act&&bp.y<AIC.lowY&&relReal>SR.back&&relReal<SR.front&&Math.abs(best.v.x)<SR.maxVX&&speed<SR.maxSpeed&&!footStuck){
   r.act='safeRaise';r.actT=0;r.raise=false;r.behindFlag=false;
  }
  // ---- trap action (r.act='trap'): a smart rod (iq roll) PINS a slow ball under the boot rather
  //      than swinging at it, then dribbles it sideways hunting a shooting lane before scooping it
  //      away. Three phases off r.actT: CATCH (kill the ball) → CARRY (slide for a line) → SHOOT.
  //      The action owns r.target and r.aiMan for its whole life and `continue`s, so nothing below
  //      re-aims it; canKick is !r.act-gated so the normal swing can't strike the ball we're holding.
  //      What makes the hold physical is in collideRod: while r.act==='trap' the contact switches to
  //      trap.holdRest (dead) + trap.holdGrip (sticky), so the ball stops and then travels with the
  //      foot. Exit on: ball left the window / sped up / got high / near our own goal / timed out.
  // trap z-gate: outfield rods need a man aligned within alignZ. The GK ALSO commits when the
  // ball sits up to gkReach BEYOND its z-slide band (overshoot past ±maxOff) — so the keeper
  // rotates into the trap posture early for a ball drifting back toward goal it can't slide onto.
  const trapZ=r.role==='GK'?Math.abs(bp.z-clamp(bp.z,r.baseZ[0]-r.maxOff,r.baseZ[0]+r.maxOff))<TR.gkReach:dz<TR.alignZ;
  // ---- entry guards.
  //      • approach — the ball's dir-relative x-speed toward this rod's front face, gated to
  //        [minApproach, maxApproach]. minApproach is NEGATIVE now: a still or gently goal-ward ball
  //        is precisely what we want to trap. (It was +6, i.e. only a briskly rolling ball qualified,
  //        which is why a slow ball sitting in range never triggered a trap — evade picked it up and
  //        slid away from it instead.) maxApproach refuses a ball arriving too fast to pin at all.
  //        The old own-goal rationale for minApproach applied to the −0.9 back-tilt, which shovelled
  //        a dead ball goal-ward; trap.angle is a shallow pin now, so it no longer holds.
  //      • goalDist — x-distance from the ball to THIS rod's own goal line. Inside TR.ownGoalGuard
  //        no trap is entered, and a live trap ABORTS (the abort drops the rod, and the drop sweeps
  //        the foot FORWARD, which clears the ball upfield — the safe direction). ----
  const ownGx=dir>0?-F.L/2:F.L/2;
  const goalDist=Math.abs(bp.x-ownGx);
  const approach=best.v.x*dir;              // >0 = ball closing on this rod's front face
  if(r.act==='trap'){
   r.actT+=dt;
   // Exit once the ball escapes the catch band, speeds up, lifts, drifts too near our own goal, or
   // we've held too long. NOTE: deliberately NO footStuck abort here — a trap's whole JOB is to hold
   // a ball AT the feet, and since entry requires alignment (⇒ inFootRange ⇒ footStuck), a footStuck
   // abort killed the trap one frame after it began (why traps were never seen). The forward `front`
   // bound + ownGoalGuard are the own-goal guards instead.
   if(relReal<=TR.back||relReal>=TR.front||speed>TR.maxSpeed||bp.y>AIC.lowY||goalDist<TR.ownGoalGuard||r.actT>TR.abortT){r.act=null;r.trapMan=-1;r.trapDir=0;}
  }else if(TR.on&&r.aiIQ&&!r.act&&relReal>TR.back&&relReal<TR.front&&bp.y<AIC.lowY&&Math.abs(best.v.x)<TR.maxVX&&speed<TR.maxSpeed&&trapZ
           &&approach>TR.minApproach&&approach<TR.maxApproach&&goalDist>TR.ownGoalGuard){
   // Entry commits to ONE man — the live man nearest the ball in z — and remembers where the ball
   // was caught. Holding the man fixed for the whole trap is what stops the man-index hysteresis
   // re-picking a neighbour mid-carry and dragging the boot off the ball it is dribbling.
   let tm=-1,td=1e9;
   for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;const d=Math.abs(bp.z-(r.baseZ[i]+r.offset));if(d<td){td=d;tm=i;}}
   r.act='trap';r.actT=0;r.trapMan=tm;r.trapZ0=bp.z;r.trapDir=0;   // not gated on r.raise — a slow ball at an aligned foot is caught directly, latched or not
  }
  if(r.act==='trap'){
   r.raise=false;r.behindFlag=false;       // trap owns the angle (updateRods) — latch released
   const tm=(r.trapMan>=0&&r.trapMan<r.baseZ.length&&manLive(r,r.trapMan))?r.trapMan:0;
   /* THE contact test for everything below: z-distance from the ball to the ONE man doing the
      trapping (not `dz`, which is the nearest man of any — on a 5-man rod those are different men
      and using dz let the rod "hold" a ball sitting at a neighbour's foot). The boot only touches
      the ball within footBox.z + BALL_R ≈ 3.25 in z, so past holdZ there is nothing being held. */
   const tdz=Math.abs(bp.z-(r.baseZ[tm]+r.offset));
   let shot=false;
   if(r.actT>TR.settleT){
    /* ---- CARRY. The ball is dead under the boot (collideRod runs trap.holdRest/holdGrip while
       r.act==='trap'), so sliding the rod now DRIBBLES it — but only while the boot is still
       TOUCHING. Lose contact (tdz>holdZ) and the trap is over: release and let the normal path
       take the ball, rather than swinging a trapShot at a ball we no longer have.
       Read the shooting lanes from where the ball actually is; if one is open by lineClear, scoop.
       Otherwise commit ONCE to the side whose lanes probe better (±slideMax·0.6) and push that way
       until a lane opens, we run out of slideMax, or holdT expires. Direction is committed, not
       re-derived per frame, for the same reason evadeDir is: a per-frame pick oscillates as the
       carried ball crosses the probe midpoint. ---- */
    if(tdz>TR.holdZ){                       // contact lost — not a trap any more
     if(dbgLogRod===r)dbgRod(r,'TRAP-LOST','tdz='+tdz.toFixed(2)+' > holdZ '+TR.holdZ);
     r.act=null;r.trapMan=-1;r.trapDir=0;
    }else{
     const ev=shotEval(r.team,bp.x,bp.z);r.aimEv=ev;     // also feeds the 'Shot Lanes' debug layer
     if(!r.trapDir){
      const pr=TR.slideMax*0.6;
      const cl=(z)=>shotEval(r.team,bp.x,clamp(z,-F.W/2+BALL_R,F.W/2-BALL_R)).best.clr;
      const up=cl(bp.z+pr),dn=cl(bp.z-pr);
      r.trapDir=(up>=dn?1:-1);
      if(Math.max(up,dn)<=ev.best.clr)r.trapDir=(bp.z>0?-1:1); // neither probe improves on standing still → drift toward centre, where lanes are widest
     }
     const timeUp=r.actT>TR.settleT+TR.holdT;
     const open=ev.best.clr>=TR.lineClear;
     if((open||timeUp)&&tdz<TR.alignZ&&r.kickT<0&&r.cd<=0){
      if(dbgLogRod===r)dbgRod(r,'TRAPSHOT',(open?'lane open':'hold expired')+' clr='+ev.best.clr.toFixed(1)+' rel='+relReal.toFixed(1)+' tdz='+tdz.toFixed(2)+' carried='+(bp.z-r.trapZ0).toFixed(1));
      kickRod(r,'trapShot');                // scoop shot with dedicated trap power window
      r.cd=D.cd*stCd(r)*rand(AIC.cdSlow[0],AIC.cdSlow[1]);
      r.trapMan=-1;r.trapDir=0;shot=true;
     }else if(timeUp){                      // held long enough but never squared up — give the ball back
      r.act=null;r.trapMan=-1;r.trapDir=0;
     }else{
      /* Dribble. The boot must STAY ON the ball to push it, so the man is aimed a short carryLead
         PAST the ball, not at the far end of the travel budget: targeting bp.z ± slideMax (7u) — as
         this did originally — slid the man straight off the ball and left it sitting between two
         players, which is exactly the "trapshot at nothing" that reads as a phantom trap. slideMax
         is the CUMULATIVE cap measured from where the ball was caught, applied here. */
      const cz=clamp(bp.z+r.trapDir*TR.carryLead,r.trapZ0-TR.slideMax,r.trapZ0+TR.slideMax);
      r.target=clamp(cz-r.baseZ[tm],-r.maxOff,r.maxOff);
     }
    }
   }else{
    r.target=clamp(bp.z-r.baseZ[tm],-r.maxOff,r.maxOff);  // CATCH: boot dead on the ball, no aim offset
   }
   if(r.act==='trap'&&!shot){
    r.aiMan=tm;
    if(dbgLogRod===r)dbgRod(r,'ACT:trap'+(r.actT>TR.settleT?'/carry':'/catch'),
     'rel='+relReal.toFixed(1)+' tdz='+tdz.toFixed(2)+' spd='+speed.toFixed(0)+' t='+r.actT.toFixed(2)+' dir='+r.trapDir+' clr='+(r.aimEv?r.aimEv.best.clr.toFixed(1):'-'));
    continue;                               // we own target + man for the whole trap — no re-aim, no kick gate
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
  //      `approach` (computed with the trap guards above) is the ball's dir-relative closing speed on
  //      this rod. Evade is for a ball PARKED against a foot: a ball rolling IN from behind is about to
  //      become strikeable, so sliding away from it both throws the block away and drags the man off
  //      the strike line while the swing is in flight. Hence maxApproach — the mirror of the trap's
  //      minApproach (trap wants a closing ball, evade wants a settled one).
  if(r.act==='evade'){
   r.actT+=dt;
   // Separate "we succeeded" from "give up": only the former earns the follow-through below.
   const evCleared=!inFootRange(r,best);
   const evBail=overFoot||inFront||r.behindFlag||speed>=EV.maxSpeed||approach>EV.maxApproach
                ||bp.y>AIC.lowY||r.actT>EV.abortT||relReal>-(EV.behindDead-0.5);
   if(evCleared||evBail){
    r.act=null;r.evadeDir=0;r.evadeCd=EV.cd;
    /* FOLLOW-THROUGH. Exiting a successful clear straight back into man-selection is what made the
       rod "evade for a frame then chase": the men slid off the ball, the action ended, aim dragged
       them right back onto it, inFootRange went true again and evade re-fired — 1-3 steps per cycle.
       On a clean clear we now LATCH THE RAISE instead. The lift swings the foot BEHIND the ball in x
       (raiseA -1.6 puts it ~6u back), so when it drops it sweeps FORWARD through the ball and knocks
       it upfield — which is the whole point of getting out of the way. r.evadeCd blocks a re-entry
       while that plays out (the latch alone isn't enough: latchStuck can clear it for a ball inside
       underFootBack, which is the narrow rel −2.9..−1.6 band). */
    if(evCleared&&!evBail&&EV.raiseAfter){r.raise=true;r.behindFlag=true;}
   }
  }else if(EV.on&&!r.act&&!r.behindFlag&&(r.evadeCd||0)<=0&&!overFoot&&!inFront&&bp.y<AIC.lowY&&speed<EV.maxSpeed&&approach<=EV.maxApproach&&inFootRange(r,best)&&relReal<-EV.behindDead){
   r.act='evade';r.actT=0;r.evadeDir=0;      // fresh direction, committed on the first frame below
  }
  // Named-action trace for the kick log (press C then L to pick a rod). dbgRod dedupes on the
  // kind string, so this prints ONE line per action CHANGE — i.e. it names whichever of
  // safeRaise / trap / evade / raise-latch is actually driving the rod when it misbehaves.
  if(dbgLogRod===r)dbgRod(r,'ACT:'+(r.act||(r.raise?'raise':'-')),
   'rel='+relReal.toFixed(1)+' dz='+dz.toFixed(2)+' spd='+speed.toFixed(0)+' ownGoalD='+goalDist.toFixed(1)+' appr='+approach.toFixed(1));
  if(r.act==='evade'){
   r.raise=false;r.behindFlag=false;
   const cz=FOOT_BOX.z+BALL_R+AIC.clearMargin,bz=bp.z;
   const prefer=evadeDir(r,best,cz,EV.vz);     // committed for the whole action — no per-frame flip
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
  // !r.act: a named action owns the rod. Matters now that the trap window reaches PAST the rod line
  // into overFoot — without this the normal swing fires at a ball we are deliberately holding and
  // kickRod clears r.act, so the trap dies the frame the ball arrives at the boot (and all you ever
  // see is the strike). safeRaise's own srKick override still works: it nulls r.act first.
  const canKick=r.kickT<0 && r.cd<=0 && !r.act && (overFoot||inFront) && aligned && bp.y<AIC.lowY && !wait && !holdShot;
  if(dbgLogRod===r)dbgKickGate(r,{fired:canKick,overFoot,inFront,aligned,low:bp.y<AIC.lowY,wait,holdShot,rel:relReal,dz,speed,act:r.act});
  if(canKick){
   kickRod(r);
   r.cd=D.cd*stCd(r)*(slow?rand(AIC.cdSlow[0],AIC.cdSlow[1]):rand(AIC.cdFast[0],AIC.cdFast[1])); // rea stat trims recovery
  }
 }
}
