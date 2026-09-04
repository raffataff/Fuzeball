'use strict';
/* ================= physics (the core — treat carefully) ================= */
function physics(dt){
 if(dt<=0||!S.balls.length)return;
 // adaptive substepping: keep per-step travel under ~subTravel so fast/heavy balls can't tunnel.
 // floor/air friction are applied per-substep as exp(k*h), so total exp(k*dt) is invariant to sub count.
 // The FOOT counts as a fast mover too: updateRods advances r.angle a whole sim step at once, and at
 // the swing's ~22 rad/s that is ~2.3u of foot travel per step — more than a ball radius — so the ball
 // was finely substepped while the foot teleported straight past it. Feeding foot speed into vmax
 // raises the substep count for a fast swing; the interpolation below then poses the rod at each
 // substep so contacts resolve where the foot actually was.
 let vmax=0;for(const b of S.balls){const s=b.v.length();if(s>vmax)vmax=s;}
 for(const r of rods){const fs=Math.abs(r.angVel)*ARM+Math.abs(r.vz);if(fs>vmax)vmax=fs;}
 const sub=clamp(Math.ceil(vmax*dt/PHY.subTravel),PHY.subMin,PHY.subMax),h=dt/sub;
 perfSub(sub);   // frame profiler (perf.js): substeps actually run — pinned at subMax means fast play, not a leak
 // Rod pose at the START of this sim step, reconstructed exactly: updateRods set
 // angVel=(angle-prevAngle)/dt, so angle-angVel*dt IS the previous angle. angVel/vz themselves are
 // left alone — they're the average rate over the step, which is what the contact impulse wants.
 for(const r of rods){r.sA0=r.angle-r.angVel*dt;r.sO0=r.offset-r.vz*dt;r.sA1=r.angle;r.sO1=r.offset;}
 for(let s=0;s<sub;s++){
  const f=(s+1)/sub;
  for(const r of rods){r.angle=lerp(r.sA0,r.sA1,f);r.offset=lerp(r.sO0,r.sO1,f);}
  for(let bi=S.balls.length-1;bi>=0;bi--)stepBall(S.balls[bi],h);
  for(let i=0;i<S.balls.length;i++)for(let j=i+1;j<S.balls.length;j++)ballBall(S.balls[i],S.balls[j]);
 }
 for(const r of rods){r.angle=r.sA1;r.offset=r.sO1;}   // restore the exact end-of-step pose for render/AI
 for(const b of S.balls){
  const sp=b.v.length();
  if(S.stats&&sp>S.stats.topSpeed)S.stats.topSpeed=sp;
  b.m.rotation.z-=b.v.x*dt/BALL_R;
  b.m.rotation.x+=b.v.z*dt/BALL_R;
  if(b.light)b.light.position.copy(b.m.position);
  b.trailT-=dt;
  if(b.trailT<=0&&sp>CONFIG.fx.trailSpeed){b.trailT=.022;spawnTrail(b);}
  rollProbe(b);   // sustained-contact audio (see below) — position-only, reads the settled state
  momStep(b);     // moments.js: re-arm the on-target projection off the settled velocity, and
                  // resolve a save the keeper made during this step now the outcome is known
 }
 if(S.stats&&S.lastTouch>=0&&S.phase==='play')S.stats.poss[S.lastTouch]+=dt;
 msTick(dt);   // matchstats.js: territory (ball position by third) + the rally clock
}
/* ================= contact AUDIO gating =================================
   An impact is an EVENT, a roll is a STATE — the same split every shipped physics game draws
   (Unity spells it OnCollisionEnter vs OnCollisionStay). Full rationale in js/audio.js.

   hitFresh is the EVENT half. A contact earns a one-shot only if it is genuinely NEW — that
   surface must have been clear for PHY.contactHold — AND hard enough to clear the surface's
   threshold. Before this, the side/end wall bounce had no threshold at all and re-fired on
   every substep, so a ball hugging a wall produced 3-7 noise bursts per rendered frame
   (~420/s): the buzzsaw. Sustained contact is the roll layer's job now, not the tap's.

   Timestamps, not countdowns: S.time only advances BETWEEN fixed sim steps, so every substep
   inside one step reads the same clock and only the first contact of that step can be fresh —
   exactly the wanted behaviour, with no per-frame bookkeeping to keep in sync.
   k indexes b.cT: 0 = floor/net roof, 1 = wall, 2 = ball-vs-ball. */
function hitFresh(b,k,imp,min){
 // -1e9, not 0: S.time starts at 0 and (0-0 > contactHold) is FALSE, which would swallow the
 // very first contact of the session. "Never touched" has to read as "touched infinitely long ago".
 const t=b.cT||(b.cT=[-1e9,-1e9,-1e9]);   // lazy init covers a ball built before balls.js gained the field
 const fresh=S.time-t[k]>PHY.contactHold;
 t[k]=S.time;                    // stamp on EVERY contact, fired or not — that is what holds the gate shut
 return fresh&&imp>min;
}
/* rollProbe is the STATE half. Position-only: it reads the ball AFTER every collision response
   this frame has applied and asks "is it resting on / against anything, and how fast is it
   travelling ALONG that surface". It never writes p or v, which is why it is safe to run on the
   settled state once per frame instead of per substep. Au.rollFeed takes a MAX, so reporting the
   same contact twice is harmless and the fastest contact in play owns the timbre.
   The arena bowl's curved walls feed themselves from arenaContact's inelastic branch (arena.js) —
   that branch IS the rolling case — so only the floor test is shared with it here. */
function rollProbe(b){
 if(b.scored)return;
 const p=b.m.position,v=b.v,eps=PHY.contactEps,aC=b.t.audio;
 if(p.y<BALL_R+eps)Au.rollFeed(0,Math.hypot(v.x,v.z),aC);             // floor — both tables
 if(ARENA_ON||p.y>=F.wallH+BALL_R)return;
 const zl=F.W/2-BALL_R,xl=F.L/2-BALL_R;
 if(Math.abs(p.z)>zl-eps)Au.rollFeed(1,Math.hypot(v.x,v.y),aC);       // side wall: travel is x/y
 else if(Math.abs(p.x)>xl-eps)Au.rollFeed(1,Math.hypot(v.z,v.y),aC);  // end wall: travel is z/y
}
/* HAS THIS BALL LEFT THE CABINET?
   Every wall has a top, so a lofted ball can genuinely end up OUTSIDE one — and the wall tests
   below have no memory, they only ask "is the ball past the plane and low enough". A ball that
   cleared a rail on the way up therefore re-enters their height band on the way DOWN, outside the
   table, and is clamped straight back onto the pitch. Measured before this: a ball 17 units past
   the goal line — well beyond the end of the table — teleported back to the wall and fired down
   the pitch. Roughly half of all lofted shots that cleared the goal line came back like that,
   which is why it looked random.

   So latch it, the same way overBar latches a lob over the crossbar: what decides the ball's fate
   is the CROSSING, not where it happens to be a few frames later. Once out, every wall and the
   pitch floor stop reaching for it, it falls away, and the out-of-play test in physStep gives it
   the whistle. Cleared the moment it is back inside both planes, so a ball that merely grazes a
   rail and drops back in behaves exactly as before.

   The goal mouth is deliberately NOT latched: a lob into the mouth is the overBar / net-roof case
   and has its own machinery. Set PHY.wallEscape false to restore the old behaviour outright. */
function wallLatch(b){
 if(b.scored||!PHY.wallEscape){b.outWall=0;return;}
 const p=b.m.position,zl=F.W/2-BALL_R,xl=F.L/2-BALL_R,ew=ENDWALL_H||F.wallH;
 if(Math.abs(p.z)<=zl&&Math.abs(p.x)<=xl){b.outWall=0;return;}   // back inside — walls live again
 if(b.outWall)return;
 if(Math.abs(p.z)>zl){if(p.y>=F.wallH+BALL_R)b.outWall=1;return;}          // over a side rail
 const gh=F.goalHalf*(S.eff[p.x>0?0:1].big>S.time?PHY.bigGoalMult:1);
 if(Math.abs(p.z)>=gh&&p.y>=ew+BALL_R)b.outWall=1;                        // over an end wall
}
function stepBall(b,h){
 const p=b.m.position,v=b.v;
 // safety: if physics ever produces a non-finite state, re-drop this ball instead of poisoning the sim.
 if(!isFinite(p.x)||!isFinite(p.y)||!isFinite(p.z)||!isFinite(v.x)||!isFinite(v.y)||!isFinite(v.z)){
  p.set(rngR(RNG.nan,-5,5),PHY.redropY,rngR(RNG.nan,-8,8));v.set(0,0,0);b.spin=0;syncBall(b);return;}
 // knuckleball: erratic flutter — periodically re-kick the side-spin to a fresh random value so the
 // flight path weaves unpredictably. Energy-safe: spin only rotates the horizontal velocity below.
 if(b.t.knuckle){
  b.knuckT-=h;
  if(b.knuckT<=0){const K=b.t.knuckle,KR=RNG.knuck;b.knuckT=rngR(KR,K.every[0],K.every[1]);
   b.spin=clamp(b.spin+rngR(KR,-K.kick,K.kick),-K.max,K.max);}
 }
 // spin/Magnus curve: rotate the horizontal velocity by a small angle (pure rotation = no energy added = stable).
 if(b.spin){
  const a=clamp(b.spin*PHY.spinTurn*h,-PHY.spinMax,PHY.spinMax),cs=Math.cos(a),sn=Math.sin(a),vx=v.x,vz=v.z;
  v.x=vx*cs-vz*sn;v.z=vx*sn+vz*cs;
  b.curl+=a;   // moments.js: total heading change since the last swing — this IS how much the ball
               // visibly bent, which raw b.spin is not (see the curlDeg note in CONFIG.moments.goal)
  b.spin*=Math.exp(-PHY.spinDecay*h);
  if(Math.abs(b.spin)<PHY.spinCut)b.spin=0;
 }
 v.y-=GRAV*h;
 p.x+=v.x*h;p.y+=v.y*h;p.z+=v.z*h;
 if(!ARENA_ON){
  wallLatch(b);              // decide, once, whether this ball is still inside the cabinet
  if(p.y<BALL_R&&!b.outWall){
   p.y=BALL_R;
   if(v.y<0){if(hitFresh(b,0,-v.y,PHY.floorHitSnd))Au.wall(Math.abs(v.y)*.5,b.t.audio?.wall);v.y=-v.y*PHY.floorRest;if(v.y<PHY.floorRestCut)v.y=0;}
   const f=Math.exp(-PHY.floorFric*h);v.x*=f;v.z*=f;
  }else{const f=Math.exp(-PHY.airFric*h);v.x*=f;v.z*=f;}
  const zl=F.W/2-BALL_R;
  // The CLAMP is positional; only the BOUNCE is gated on arrival. The old form gated p.z on the ball
  // moving outward, so a ball already past the line with inward or zero v.z was never pushed back —
  // which is exactly what a boot pressing it into the wall produces: collideRod resolves by writing p
  // directly, and its grip lerp then drags v.z toward the foot's own velocity, so the ball is never
  // "arriving" again. That is the ball-buried-in-the-wall case. See staticClamp for the other half.
  if(Math.abs(p.z)>zl&&p.y<F.wallH+BALL_R&&!b.outWall){
   const sz=p.z>0?1:-1;
   // gated on FRESH contact + PHY.wallHitSnd: a ball riding the wall re-enters this branch every
   // substep, and firing a tap each time is what made the buzzsaw. The ride is a roll (rollProbe).
   if(v.z*sz>0){const im=Math.abs(v.z);v.z=-v.z*PHY.wallRest;if(hitFresh(b,1,im,PHY.wallHitSnd)){Au.wall(im,b.t.audio?.wall);spawnMark(b,0,0,-sz,im);}}   // the tap AND the scuff ride the same fresh-contact gate
   p.z=sz*zl;
  }
  if(!b.scored){
   // ENDWALL_H>0 (walled tables, e.g. circuit): each end is ONE solid wall up to that height with
   // the goal mouth INSET into it — an over-the-bar shot slaps the wall face and bounces back in.
   // 0 (classic): wall only flanks the mouth to wallH; over the bar sails through as before.
   // The mouth opening itself still tracks goalHalf*bigGoalMult, so Big Goal widens the inset.
   const xl=F.L/2-BALL_R,ew=ENDWALL_H||F.wallH;
   if(p.x>xl){
    const gh=F.goalHalf*(S.eff[0].big>S.time?PHY.bigGoalMult:1);
    if(Math.abs(p.z)<gh&&(p.y<F.goalH||!ENDWALL_H)){
     if(p.x>F.L/2&&p.y>=F.goalH)b.overBar=1;                                                    // sailed OVER the bar → a lob, never a goal (net roof below catches it)
     else if(b.overBar!==1&&p.y<F.goalH&&p.x>F.L/2+BALL_R){onGoal(0,b);return;}}                // goal ONLY under the bar, whole ball over the line, and NOT dropping in from over the top
    else if(p.y<ew+BALL_R&&!b.outWall){if(v.x>0){const im=Math.abs(v.x);v.x=-v.x*PHY.wallRest;if(hitFresh(b,1,im,PHY.wallHitSnd)){Au.wall(im,b.t.audio?.wall);spawnMark(b,-1,0,0,im);}}p.x=xl;}   // clamp always, bounce on arrival — same reason as the side walls above
   }else if(p.x<-xl){
    const gh=F.goalHalf*(S.eff[1].big>S.time?PHY.bigGoalMult:1);
    if(Math.abs(p.z)<gh&&(p.y<F.goalH||!ENDWALL_H)){
     if(p.x<-F.L/2&&p.y>=F.goalH)b.overBar=-1;
     else if(b.overBar!==-1&&p.y<F.goalH&&p.x<-F.L/2-BALL_R){onGoal(1,b);return;}}
    else if(p.y<ew+BALL_R&&!b.outWall){if(v.x<0){const im=Math.abs(v.x);v.x=-v.x*PHY.wallRest;if(hitFresh(b,1,im,PHY.wallHitSnd)){Au.wall(im,b.t.audio?.wall);spawnMark(b,1,0,0,im);}}p.x=-xl;}
   }
   if(b.overBar===1&&p.x<F.L/2)b.overBar=0; else if(b.overBar===-1&&p.x>-F.L/2)b.overBar=0;      // rolled back in FRONT of the line → live again
  }else{
   const bx=F.L/2+F.goalDepth-BALL_R;
   if(p.x>bx&&v.x>0){p.x=bx;v.x*=-PHY.behindDamp;}
   if(p.x<-bx&&v.x<0){p.x=-bx;v.x*=-PHY.behindDamp;}
   const zn=F.goalHalf*PHY.behindZ;
   if(p.z>zn&&v.z>0){p.z=zn;v.z*=-PHY.behindDamp;}
   if(p.z<-zn&&v.z<0){p.z=-zn;v.z*=-PHY.behindDamp;}
  }
 }else{
  const gh0=F.goalHalf*(S.eff[0].big>S.time?PHY.bigGoalMult:1);
  const gh1=F.goalHalf*(S.eff[1].big>S.time?PHY.bigGoalMult:1);
  hStep=h;
  if(b.scored){
   const bx=F.L/2+F.goalDepth-BALL_R;
   if(p.x>bx&&v.x>0){p.x=bx;v.x*=-PHY.behindDamp;}
   if(p.x<-bx&&v.x<0){p.x=-bx;v.x*=-PHY.behindDamp;}
   const zn=F.goalHalf*PHY.behindZ;
   if(p.z>zn&&v.z>0){p.z=zn;v.z*=-PHY.behindDamp;}
   if(p.z<-zn&&v.z<0){p.z=-zn;v.z*=-PHY.behindDamp;}
  }else{
   const sd=arenaSD(p.x,p.z,gh0,gh1); // pocket is open at all heights → lob over the bar can drop in
   const d=-sd,CR=ARENA.creaseR;
   // the bowl has the same hole as the flat walls, and worse: its contact pushes the ball out by
   // the FULL penetration, so a ball caught far outside is thrown back in hard. Same latch.
   if(!PHY.wallEscape||d>=0)b.outWall=0; else if(!b.outWall&&p.y>=F.wallH+BALL_R)b.outWall=1;
   let contacted=!!b.outWall;   // outside and over the rim — nothing below reaches for it
   if(!b.outWall&&CR>0&&d<CR){
    // ---- curved crease (fillet) zone: quarter-torus wall→floor blend ----
    const g=arenaGrad(p.x,p.z,gh0,gh1);
    if(p.y<CR){
     const u=CR-d,w=CR-p.y,r=Math.hypot(u,w);
     if(r>CR-BALL_R){
      const nx=-g.x*(u/r),ny=w/r,nz=-g.z*(u/r),pen=r-(CR-BALL_R);
      arenaContact(b,pen,nx,ny,nz);
      contacted=true;
     }
    }
    if(!contacted&&p.y>=CR&&p.y<F.wallH+BALL_R&&d<BALL_R){
     const nx=-g.x,ny=0,nz=-g.z,pen=BALL_R-d;
     arenaContact(b,pen,nx,ny,nz);
     contacted=true;
    }
    if(!contacted){const f=Math.exp(-PHY.airFric*h);v.x*=f;v.z*=f;}
   }else{
    // ---- flat interior; CR=0 adds a SHARP 90° vertical wall (no fillet) ----
    if(CR<=0&&p.y<F.wallH+BALL_R&&d<BALL_R){
     const g=arenaGrad(p.x,p.z,gh0,gh1),nx=-g.x,ny=0,nz=-g.z,pen=BALL_R-d;
     arenaContact(b,pen,nx,ny,nz);contacted=true;
    }
    if(p.y<BALL_R&&!b.outWall){
     p.y=BALL_R;if(v.y<0){if(hitFresh(b,0,-v.y,PHY.floorHitSnd))Au.wall(Math.abs(v.y)*.5,b.t.audio?.wall);v.y=-v.y*PHY.floorRest;if(v.y<PHY.floorRestCut)v.y=0;}
     const f=Math.exp(-PHY.floorFric*h);v.x*=f;v.z*=f;
    }else if(!contacted){const f=Math.exp(-PHY.airFric*h);v.x*=f;v.z*=f;}
   }
   // goal detection — same over-the-bar guard as classic (the arena pocket is open at all heights, so lobs must be gated too)
   const xl=F.L/2-BALL_R;
   if(p.x>xl){
    if(Math.abs(p.z)<gh0){
     if(p.x>F.L/2&&p.y>=F.goalH)b.overBar=1;
     else if(b.overBar!==1&&p.y<F.goalH&&p.x>F.L/2+BALL_R){onGoal(0,b);return;}}
   }else if(p.x<-xl){
    if(Math.abs(p.z)<gh1){
     if(p.x<-F.L/2&&p.y>=F.goalH)b.overBar=-1;
     else if(b.overBar!==-1&&p.y<F.goalH&&p.x<-F.L/2-BALL_R){onGoal(1,b);return;}}
   }
   if(b.overBar===1&&p.x<F.L/2)b.overBar=0; else if(b.overBar===-1&&p.x>-F.L/2)b.overBar=0;
  }
 }
 if(!b.scored)goalFrameCollide(b,h);
 for(const r of rods){
  if(Math.abs(p.x-r.x)>ARM+BALL_R+2)continue;
  collideRod(b,r);
 }
 if(!b.scored)staticClamp(b);   // static geometry gets the last word — must run BEFORE the out-of-bounds test below
 if(!b.scored&&(p.y<-8||Math.abs(p.x)>F.L/2+F.goalDepth+8||Math.abs(p.z)>F.W/2+10)){outOfBounds(b);return;}
 const mv=b.t.maxV,sp2=v.x*v.x+v.y*v.y+v.z*v.z;
 if(sp2>mv*mv){const k=mv/Math.sqrt(sp2);v.multiplyScalar(k);}
}
/* STATIC GEOMETRY GETS THE LAST WORD — the second half of the wall-wedge fix.
   collideRod resolves a contact by writing the ball's position DIRECTLY, and it runs AFTER stepBall's
   wall tests, so on a ball squeezed between a boot and a wall the foot's depenetration is the last
   thing to touch p in that substep and can shove it clean through the wall plane. Re-asserting the
   bounds afterwards makes the wall win the squeeze, so the ball pops ALONG it instead of into it.
   Position-only, and only the INTO-surface velocity component is killed: the bounce belongs to the
   arrival tests in stepBall, which have already run this substep, and re-bouncing here would let a
   held ball churn against the boot. Arena is exempt — arenaContact is distance-based with no velocity
   gate, so a bowl wall already re-resolves a pushed-in ball on the next substep by itself.
   Scored balls are exempt too: they live behind the line under their own in-net clamps. */
function staticClamp(b){
 if(ARENA_ON||b.outWall)return;   // a ball that has cleared a wall is outside; do not drag it back
 const p=b.m.position,v=b.v;
 if(p.y<BALL_R){p.y=BALL_R;if(v.y<0)v.y=0;}
 const zl=F.W/2-BALL_R;
 if(p.y<F.wallH+BALL_R){
  if(p.z>zl){p.z=zl;if(v.z>0)v.z=0;}
  else if(p.z<-zl){p.z=-zl;if(v.z<0)v.z=0;}
 }
 const xl=F.L/2-BALL_R,ew=ENDWALL_H||F.wallH;
 if(p.y<ew+BALL_R){
  // mouth test mirrors stepBall's exactly — a ball in the opening is on its way in, not against a wall
  if(p.x>xl){const gh=F.goalHalf*(S.eff[0].big>S.time?PHY.bigGoalMult:1);
   if(!(Math.abs(p.z)<gh&&(p.y<F.goalH||!ENDWALL_H))){p.x=xl;if(v.x>0)v.x=0;}}
  else if(p.x<-xl){const gh=F.goalHalf*(S.eff[1].big>S.time?PHY.bigGoalMult:1);
   if(!(Math.abs(p.z)<gh&&(p.y<F.goalH||!ENDWALL_H))){p.x=-xl;if(v.x<0)v.x=0;}}
 }
}
/* solid round goal posts (vertical) + crossbar (horizontal) + a SOLID net roof, both goals,
   both tables. Posts/bar sit at the effective goal-mouth edge (scales with the 'big goal'
   power-up) and deflect with a metallic clang. A ball lobbed over the bar lands on the net
   roof instead of dropping in — so it can never score over the top; it settles and re-drops. */
function goalFrameCollide(b,h){
 const p=b.m.position,v=b.v,pr=PHY.postRad+BALL_R,e=1+PHY.postRest,GH=F.goalH,GD=F.goalDepth;
 // Early-out: posts/crossbar sit at x=±L/2 and the net roof only reaches back to ±(L/2+GD), so a ball
 // more than a post-radius inside either line can't touch any of it. Skips the whole per-substep loop
 // for midfield play — pure cost cut, no behaviour change (the guard band ≫ one substep of travel).
 if(Math.abs(p.x)<F.L/2-pr)return;
 for(let sx=-1;sx<=1;sx+=2){
  const gh=F.goalHalf*(S.eff[sx>0?0:1].big>S.time?PHY.bigGoalMult:1),gx=sx*F.L/2;
  // uprights: vertical cylinders at (gx, ±gh), y∈[0,goalH]
  if(p.y<GH+pr)for(let sz=-1;sz<=1;sz+=2){
   const dx=p.x-gx,dz=p.z-sz*gh,dd=Math.hypot(dx,dz);
   if(dd<pr&&dd>1e-4){const nx=dx/dd,nz=dz/dd;p.x+=nx*(pr-dd);p.z+=nz*(pr-dd);
    const vn=v.x*nx+v.z*nz;if(vn<0){v.x-=e*vn*nx;v.z-=e*vn*nz;Au.post(-vn,b.t.audio?.post);momWood(b,-vn,0);}}
  }
  // crossbar: horizontal cylinder along z at (gx, goalH), z∈[-gh,gh]
  if(Math.abs(p.z)<gh+pr){
   const dx=p.x-gx,dy=p.y-GH,dd=Math.hypot(dx,dy);
   if(dd<pr&&dd>1e-4){const nx=dx/dd,ny=dy/dd;p.x+=nx*(pr-dd);p.y+=ny*(pr-dd);
    const vn=v.x*nx+v.y*ny;if(vn<0){v.x-=e*vn*nx;v.y-=e*vn*ny;Au.post(-vn,b.t.audio?.post);momWood(b,-vn,1);}}
  }
  // net roof: solid top over the goal box (behind the line). A ball flagged as an over-the-bar lob
  // (b.overBar for this end) is caught at ANY depth below the roofline so a fast drop can't tunnel
  // through it into the net; an unflagged ball keeps the thin catch band as before.
  const xin=sx>0?(p.x>gx&&p.x<gx+GD):(p.x<gx&&p.x>gx-GD);
  const roofSolid=sx>0?b.overBar===1:b.overBar===-1;
   if(xin&&Math.abs(p.z)<gh&&v.y<0&&(roofSolid?p.y<GH+BALL_R:(p.y>=GH&&p.y<GH+BALL_R))){
   p.y=GH+BALL_R;if(hitFresh(b,0,-v.y,PHY.floorHitSnd))Au.wall(Math.abs(v.y)*.4,b.t.audio?.wall);
   v.y=-v.y*PHY.floorRest;if(v.y<PHY.floorRestCut)v.y=0;
   const f=Math.exp(-PHY.floorFric*h);v.x*=f;v.z*=f;
  }
 }
}
/* PER-CONTACT SPEED CEILING (CONFIG.kick.cap).
   The impulse below is a restitution bounce off CLOSING speed, so an ordinary strike routinely
   produces more than the ball type's maxV: measured on a classic ball against a ball arriving at
   40, a base-str power swing at mid-boot leaves at ~127 and a str-10 sweet hit at ~245, against a
   maxV of 150. The hard clamp at the end of stepBall then flattened every one of those onto the
   SAME 150 - which is why str stopped paying above about 7, the sweet-spot bonus above about 4,
   and a charge or a POWER HITS boost never showed at all. It is also what the heat glow was
   reporting: most touches were sitting on the clip, not near a top speed anyone had earned.
   TWO HALVES, AND BOTH ARE NEEDED. The CEILING is per contact, so a weak rod and a strong one aim
   at different numbers - that is what makes only a strong, clean or charged strike able to reach
   the top. The KNEE eases the outgoing speed into that ceiling instead of clipping it: under the
   knee nothing changes at all (the curve's slope is 1 there, so there is no step to feel), over it
   the excess compresses and only ever APPROACHES the ceiling, so speeds spread out along the top
   of the range instead of piling on one line.
   THE FLOOR AT THE ARRIVING SPEED is what keeps it honest: this bounds what a boot may ADD, it
   never slows a ball that was already travelling faster. Without it a weak defender grazing a
   screamer would kill it, which is not what any of this is for. A head-on deflection still sheds
   speed exactly as it always did - that is the impulse doing it, not this.
   NOTHING HERE TOUCHES stepBall's OWN maxV CLAMP, which stays as the last word. cap.max sits
   deliberately over 1 so the best strikes ask for a ceiling past maxV and that clamp is what
   finishes them: the ease is asymptotic, so a ceiling of exactly maxV could never be reached and
   the heat glow would never fill. */
function capSpeed(b,r,sweet,in2){
 const C=KICK.cap;
 if(!C.on)return;
 const v=b.v,sp2=v.x*v.x+v.y*v.y+v.z*v.z,lo=b.t.maxV*C.min*C.knee;
 if(sp2<=lo*lo)return;              // under the LOWEST knee any contact could have - skips the stat reads on every passive touch and every slide substep
 let f=C.base+C.str*stCapFrac(r);
 if(sweet)f+=C.sweet;
 if(r.shotOn)f+=C.shot*(r.shotPow-1);   // the shot's OWN power trim: a finesse touch lowers its ceiling, a well-timed charge raises it
 if(S.eff[r.team].boost>S.time)f+=C.boost;
 const cap=b.t.maxV*clamp(f,C.min,C.max),knee=cap*C.knee;
 if(sp2<=knee*knee)return;
 const sp=Math.sqrt(sp2),span=cap-knee;
 let out=knee+span*(1-Math.exp(-(sp-knee)/span));
 const inSp=Math.sqrt(in2);
 if(out<inSp)out=Math.min(sp,inSp);     // the cap limits what this contact ADDED, never the speed it arrived with
 const k=out/sp;v.x*=k;v.y*=k;v.z*=k;   // components, not multiplyScalar: collideRod writes b.v by hand everywhere and the harnesses stub it as a plain object
}
function collideRod(b,r){
 if(r.trnHidden)return;                   // training sandbox: hidden rods are ghosts — no contact
 const p=b.m.position;
/* ---- foot box (priority) ---- */
    const bx=FOOT_BOX.x,by=FOOT_BOX.y,bz=FOOT_BOX.z,offx=FOOT_BOX_OFF.x,offy=FOOT_BOX_OFF.y*r.kickDir;
    const reach=BALL_R*FOOT_BOX_REACH;
    const SW=KICK.sweetSpot;
   const footHit=new Set();
   for(let i=0;i<r.baseZ.length;i++){
    if(r.removedUntil[i]&&r.removedUntil[i]>S.time)continue;
    const fz=r.baseZ[i]+r.offset;
    if(Math.abs(p.z-fz)>(bz+reach)+1)continue;
    const sa=Math.sin(r.angle),ca=Math.cos(r.angle);
     const fx=r.x+sa*ARM*FOOT_T,fy=ROD_H-ca*ARM*FOOT_T;
    const bcx=fx+offx*sa+offy*ca,bcy=fy-offx*ca+offy*sa;
   // world → box-local
   const dxw=p.x-bcx,dyw=p.y-bcy,dzw=p.z-fz;
   let lx=dxw*sa-dyw*ca,ly=dxw*ca+dyw*sa,lz=dzw;
   // clamp to box extents
   const clx=clamp(lx,-bx,bx),cly=clamp(ly,-by,by),clz=clamp(lz,-bz,bz);
   const cdx=lx-clx,cdy=ly-cly,cdz=lz-clz;
   const d=Math.sqrt(cdx*cdx+cdy*cdy+cdz*cdz);
    if(d>reach)continue;
    footHit.add(i);
    // world-space normal & closest point
    let nx,ny,nz;
    if(d<1e-4){nx=r.kickDir;ny=0;nz=0;}else{nx=(cdx*sa+cdy*ca)/d;ny=(-cdx*ca+cdy*sa)/d;nz=cdz/d;}
    p.x+=nx*(reach-d);p.y+=ny*(reach-d);p.z+=nz*(reach-d);
   const cwx=bcx+clx*sa+cly*ca,cwy=bcy-clx*ca+cly*sa,cwz=fz+clz;
   const cvx=-(cwy-ROD_H)*r.angVel,cvy=(cwx-r.x)*r.angVel,cvz=r.vz;
   // cvz is scaled and cvx/cvy are not: the SWING transfers in full, the SLIDE only pushes.
   // See CONFIG.kick.slidePush — slidePush 1 is the old expression exactly.
   const vn=(b.v.x-cvx)*nx+(b.v.y-cvy)*ny+(b.v.z-cvz*KICK.slidePush)*nz;
   if(vn<0){
     // tracer only: the ball's OWN normal speed before the impulse rewrites b.v. vn is exactly
     // (ball·n − foot·n), so logging both halves shows whether a contact was driven by the swing
     // or by the ball's own arrival speed. Zero cost when the tracer is off (dbgLogRod is null).
     const dbgBN=(dbgLogRod===r)?(b.v.x*nx+b.v.y*ny+b.v.z*nz):0;
     const ks=kickStyleCfg(r);
     const pow=r.kickT>=ks.powFrom&&r.kickT<ks.powTo;
     /* HOLD CONTACT. While ai.js has a ball-holding action live (trap = catch a loose ball,
        dribble = carry one that's already at the feet) the boot is a dead, sticky surface instead
        of the normal passive touch (kick.rest 0.01 / kick.grip 0.08). rest→0 kills the ball's speed
        relative to the foot; the big grip is the CARRY — b.v is lerped hard toward the contact
        point's own velocity, whose z component is the rod's slide (r.vz), so the ball travels with
        the man being dribbled sideways. Without this a "trap" is just a soft bounce: the ball parks
        near the boot and the rod slides out from under it. No sweet-spot bonus and no aim-assist on
        a held contact either — both exist to make a STRIKE better, and applying them here would
        re-launch the ball we are trying to hold. holdCfg (rods.js) returns the live action's block,
        or null when there isn't one / a swing is in flight. */
     const HLD=holdCfg(r),trapping=!!HLD;
     const rest=trapping?HLD.holdRest:(pow?ks.restPower:ks.rest);
    // sweet spot: ball struck in the narrow z-centre of the foot AND a tight forward x band
    //   (dir-relative off the rod, same reference the AI's overFoot zone uses). lz is the ball's
    //   z offset from the foot; relR is how far ahead of the rod it contacts.
    const relR=(p.x-r.x)*r.kickDir;
    const sweet=!trapping&&SW.on&&Math.abs(lz)<bz*SW.zFrac&&relR>SW.xMin&&relR<SW.xMax;
    const in2=b.v.x*b.v.x+b.v.y*b.v.y+b.v.z*b.v.z;   // speed ARRIVING, for the ceiling's floor (capSpeed)
    let jm=-(1+rest)*vn/b.t.mass;
    if(S.eff[r.team].boost>S.time)jm*=KICK.boostHitMult;
    jm*=stHit(r);
    /* PLAYER SHOT (js/shots.js). r.shotOn is the whole cross-module contract — undefined without
       that file, so a missing shots.js cannot change a single contact. It is what a charged or
       trigger-modified swing is worth ON TOP of the deeper arc the wind-up already produced, and it
       is the only way a Total Control STICK swing can carry a charge at all: that path never calls
       kickRod, so there is no style block for it to have been written into. */
    if(r.shotOn)jm*=r.shotPow;
    if(sweet){let sb=SW.strBase+SW.strAcc*stAccFrac(r);if(r.aiIQ)sb+=SW.iqBonus;jm*=1+sb;}
    b.v.x+=nx*jm;b.v.y+=ny*jm;b.v.z+=nz*jm;
    const g=trapping?clamp(HLD.holdGrip,0,1):stGrip(r);
    b.v.x=lerp(b.v.x,cvx,g);b.v.z=lerp(b.v.z,cvz,g);
    if(!trapping)capSpeed(b,r,sweet,in2);   // per-contact speed ceiling - see the banner above collideRod. A HELD contact is exempt for the same reason it takes no sweet bonus and no aim-assist: those improve a STRIKE, and this bounds one
    const tang=cvx*(-nz)+cvz*nx;
    b.spin=clamp(b.spin+tang*KICK.spinGain,-KICK.spinClamp,KICK.spinClamp);
    // Total Control mode: the user rod's right-stick swerve line (r.tcSpin) bends the shot on contact
    if(r.tcSpin&&cfg.padControlMode==='total'&&isUserRod(r))
     b.spin=clamp(b.spin+r.tcSpin*KICK.tcSpinGain,-KICK.spinClamp,KICK.spinClamp);
    // tiny imperfection prevents pixel-perfect side-to-side oscillations
    const jit=Math.abs(jm)*FOOT_JITTER;
    // seeded (js/rng.js) on its OWN stream: this draws per man per substep, so sharing one with
    // anything slower would make that consumer's numbers depend on the contact count.
    const JR=RNG.jit;
    b.v.x+=(JR()-.5)*jit;b.v.y+=(JR()-.5)*jit*.3;b.v.z+=(JR()-.5)*jit;
    // aim-assist bends a shot goalward: for the HUMAN only on a clean strike (power window or sweet
    // hit — a skill reward), but for AI rods on EVERY contact so they reliably aim in all modes.
    // aimAssist itself only acts on shots already moving goalward within its cone, so a defensive
    // touch (moving away) is untouched — this can't turn stray clears into shots.
    // passFaceOK (rods.js) is the CONTACT-TIME half of the strike gate: a pass swing that clips the
    // SIDE or BACK of a boot (normal not pointing forward) still resolves as a hit here, but it is a
    // deflection, not a pass, so the pass aim-assist must not bend it at the receiver. The ordinary
    // goal-ward assist still runs — only r.passTo is suppressed for this contact.
    // r.shotOn joins the gate because a deliberate shot must be AIMED whatever its timing: a Total
    // Control stick swing has kickT<0, so `pow` is false for the whole of it. shotSpray then bends
    // it back by however much control was lost — after the assist, so a wild shot is not first
    // sprayed and then quietly corrected. One contact spends the shot (shotConsume).
    if(!trapping&&(pow||(sweet&&SW.forceAssist)||r.shotOn||!isUserRod(r)))aimAssist(b,r,!passFaceOK(r,nx));
    if(r.shotOn){shotSpray(b,r);shotConsume(r);}
     if(sweet){S.shake=Math.min(1,S.shake+SW.shake);r.aimSweet=i;}   // juice: a clean strike thumps
    if(-vn>KICK.sndFrom){Au.kick(-vn,b.t.audio?.kick);
     if(-vn>KICK.hardHit){S.shake=Math.min(1,S.shake+(-vn)/KICK.shakeDiv);}}
    momContact(b,r);msContact(b,r);S.lastTouch=r.team;   // moments.js: per-ball contact record (reads the PREVIOUS one, so it goes first) · matchstats.js keeps its OWN record, so the order of the two is free
    if(r.kickT>=0&&!r.kickHit){r.kickHit=true;if(dbgLogRod===r)dbgHit(r,i,true,pow,sweet,-vn,b,
     {bn:dbgBN,fn:cvx*nx+cvy*ny+cvz*nz,sw:Math.hypot(cvx,cvy),sl:cvz,w:r.angVel,jm:jm,kt:r.kickT,rest:rest});}  // debug: mark first contact of this swing
    if(b.t.splits&&!b.didSplit&&-vn>KICK.splitVel&&S.balls.length<KICK.splitMax){
     b.didSplit=true;
     const nb=makeBall('split');nb.didSplit=true;
     nb.m.position.copy(p);nb.m.position.z+=(p.z>0?-KICK.splitSep:KICK.splitSep);syncBall(nb);
     const vx=b.v.x,vz=b.v.z,cs=Math.cos(KICK.splitAng),sn=Math.sin(KICK.splitAng);
     nb.v.set(vx*cs-vz*sn,b.v.y,vx*sn+vz*cs);
     b.v.set(vx*cs+vz*sn,b.v.y,-vx*sn+vz*cs);
     notice('SPLIT',1.2,BALL_TYPES.split.trail);Au.power();
    }
   }
  }
 /* ---- rod capsule (fallback) ---- */
 const R=BALL_R+PRAD;
 for(let i=0;i<r.baseZ.length;i++){
  if(footHit.has(i))continue;
  if(r.removedUntil[i]&&r.removedUntil[i]>S.time)continue;
  const pz=r.baseZ[i]+r.offset;
  if(Math.abs(p.z-pz)>R+1)continue;
  const sa=Math.sin(r.angle),ca=Math.cos(r.angle);
  const ax=r.x,ay=ROD_H;
  const dx=sa*ARM,dy=-ca*ARM;
  const wx=p.x-ax,wy=p.y-ay;
  let t=clamp((wx*dx+wy*dy)/(ARM*ARM),0,1);
  const cx=ax+dx*t,cy=ay+dy*t,cz=pz;
  let nx=p.x-cx,ny=p.y-cy,nz=p.z-cz;
  let d=Math.sqrt(nx*nx+ny*ny+nz*nz);
  if(d>R)continue;
  if(d<1e-4){nx=r.kickDir;ny=0;nz=0;d=1;}else{nx/=d;ny/=d;nz/=d;}
  const cvx=-(cy-ay)*r.angVel,cvy=(cx-ax)*r.angVel,cvz=r.vz;
  const rvx=b.v.x-cvx,rvy=b.v.y-cvy,rvz=b.v.z-cvz*KICK.slidePush;   // slide damped, swing not — see the foot-box pass
  const vn=rvx*nx+rvy*ny+rvz*nz;
  p.x+=nx*(R-d);p.y+=ny*(R-d);p.z+=nz*(R-d);
  if(vn<0){
    const dbgBN=(dbgLogRod===r)?(b.v.x*nx+b.v.y*ny+b.v.z*nz):0;   // tracer only — see the foot-box pass
    const ks=kickStyleCfg(r);
    const pow=r.kickT>=ks.powFrom&&r.kickT<ks.powTo;
    const HLD=holdCfg(r),trapping=!!HLD;        // dead + sticky while trapping/dribbling — see the foot-box pass
    const rest=trapping?HLD.holdRest:(pow?ks.restPower:ks.rest);
    const in2=b.v.x*b.v.x+b.v.y*b.v.y+b.v.z*b.v.z;   // speed ARRIVING, for the ceiling's floor (capSpeed)
    let jm=-(1+rest)*vn/b.t.mass;
    if(S.eff[r.team].boost>S.time)jm*=KICK.boostHitMult;
    jm*=stHit(r);
    if(r.shotOn)jm*=r.shotPow;                  // player shot — see the foot-box pass
    b.v.x+=nx*jm;b.v.y+=ny*jm;b.v.z+=nz*jm;
    const g=trapping?clamp(HLD.holdGrip,0,1):stGrip(r);
    b.v.x=lerp(b.v.x,cvx,g);b.v.z=lerp(b.v.z,cvz,g);
    if(!trapping)capSpeed(b,r,false,in2);   // per-contact speed ceiling - a leg graze is no more entitled to a top-speed ball than a boot
    const tang=cvx*(-nz)+cvz*nx;
    b.spin=clamp(b.spin+tang*KICK.spinGain,-KICK.spinClamp,KICK.spinClamp);
    // Total Control mode: the user rod's right-stick swerve line (r.tcSpin) bends the shot on contact
    if(r.tcSpin&&cfg.padControlMode==='total'&&isUserRod(r))
     b.spin=clamp(b.spin+r.tcSpin*KICK.tcSpinGain,-KICK.spinClamp,KICK.spinClamp);
    // human: power window only; AI: every contact (goalward-only, see foot-box note). The pass assist
    // is ALWAYS suppressed here: this is the rod capsule — the leg — not the boot. A ball that reaches
    // the capsule fallback has slipped past the foot box entirely, so it is a graze off the side of
    // the player by definition, and bending it toward a receiver is precisely the phantom pass.
    if(!trapping&&(pow||r.shotOn||!isUserRod(r)))aimAssist(b,r,true);
    if(r.shotOn){shotSpray(b,r);shotConsume(r);}
   if(-vn>KICK.sndFrom){Au.kick(-vn,b.t.audio?.kick);
    if(-vn>KICK.hardHit){S.shake=Math.min(1,S.shake+(-vn)/KICK.shakeDiv);}}
   momContact(b,r);msContact(b,r);S.lastTouch=r.team;
   if(r.kickT>=0&&!r.kickHit){r.kickHit=true;if(dbgLogRod===r)dbgHit(r,i,false,pow,false,-vn,b,
    {bn:dbgBN,fn:cvx*nx+cvy*ny+cvz*nz,sw:Math.hypot(cvx,cvy),sl:cvz,w:r.angVel,jm:jm,kt:r.kickT,rest:rest});}  // debug: mark first contact (capsule graze) of this swing — capsule can't be a sweet hit
   if(b.t.splits&&!b.didSplit&&-vn>KICK.splitVel&&S.balls.length<KICK.splitMax){
    b.didSplit=true;
    const nb=makeBall('split');nb.didSplit=true;
    nb.m.position.copy(p);nb.m.position.z+=(p.z>0?-KICK.splitSep:KICK.splitSep);syncBall(nb);
    const vx=b.v.x,vz=b.v.z,cs=Math.cos(KICK.splitAng),sn=Math.sin(KICK.splitAng);
    nb.v.set(vx*cs-vz*sn,b.v.y,vx*sn+vz*cs);
    b.v.set(vx*cs+vz*sn,b.v.y,-vx*sn+vz*cs);
    notice('SPLIT',1.2,BALL_TYPES.split.trail);Au.power();
   }
  }
 }
}
function ballBall(a,b){
 const pa=a.m.position,pb=b.m.position;
 let dx=pb.x-pa.x,dy=pb.y-pa.y,dz=pb.z-pa.z;
 const R=BALL_R*2,d2=dx*dx+dy*dy+dz*dz;
 if(d2>R*R||d2<1e-6)return;
 const d=Math.sqrt(d2);dx/=d;dy/=d;dz/=d;
 const push=(R-d)/2;
 pa.x-=dx*push;pa.y-=dy*push;pa.z-=dz*push;
 pb.x+=dx*push;pb.y+=dy*push;pb.z+=dz*push;
 const ma=a.t.mass,mb=b.t.mass,e=PHY.ballRest;
 const van=a.v.x*dx+a.v.y*dy+a.v.z*dz,vbn=b.v.x*dx+b.v.y*dy+b.v.z*dz;
 if(van-vbn<=0)return;
 const van2=((ma-e*mb)*van+(1+e)*mb*vbn)/(ma+mb);
 const vbn2=((mb-e*ma)*vbn+(1+e)*ma*van)/(ma+mb);
 a.v.x+=(van2-van)*dx;a.v.y+=(van2-van)*dy;a.v.z+=(van2-van)*dz;
 b.v.x+=(vbn2-vbn)*dx;b.v.y+=(vbn2-vbn)*dy;b.v.z+=(vbn2-vbn)*dz;
 // BOTH balls must be fresh, and both timers are stamped either way — two balls jostling in a
 // pile resolve every substep, and the old ungated call turned that into the same machine-gun
 // the walls had. The heavier ball owns the timbre, as before.
 const cl=van-vbn,fa=hitFresh(a,2,cl,PHY.ballHitSnd),fb=hitFresh(b,2,cl,PHY.ballHitSnd);
 if(fa&&fb)Au.wall(cl*2,(ma>=mb?a:b).t.audio?.wall);
}
