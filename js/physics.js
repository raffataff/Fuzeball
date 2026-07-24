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
 }
 if(S.stats&&S.lastTouch>=0&&S.phase==='play')S.stats.poss[S.lastTouch]+=dt;
}
function stepBall(b,h){
 const p=b.m.position,v=b.v;
 // safety: if physics ever produces a non-finite state, re-drop this ball instead of poisoning the sim.
 if(!isFinite(p.x)||!isFinite(p.y)||!isFinite(p.z)||!isFinite(v.x)||!isFinite(v.y)||!isFinite(v.z)){
  p.set(rand(-5,5),PHY.redropY,rand(-8,8));v.set(0,0,0);b.spin=0;syncBall(b);return;}
 // knuckleball: erratic flutter — periodically re-kick the side-spin to a fresh random value so the
 // flight path weaves unpredictably. Energy-safe: spin only rotates the horizontal velocity below.
 if(b.t.knuckle){
  b.knuckT-=h;
  if(b.knuckT<=0){const K=b.t.knuckle;b.knuckT=rand(K.every[0],K.every[1]);
   b.spin=clamp(b.spin+rand(-K.kick,K.kick),-K.max,K.max);}
 }
 // spin/Magnus curve: rotate the horizontal velocity by a small angle (pure rotation = no energy added = stable).
 if(b.spin){
  const a=clamp(b.spin*PHY.spinTurn*h,-PHY.spinMax,PHY.spinMax),cs=Math.cos(a),sn=Math.sin(a),vx=v.x,vz=v.z;
  v.x=vx*cs-vz*sn;v.z=vx*sn+vz*cs;
  b.spin*=Math.exp(-PHY.spinDecay*h);
  if(Math.abs(b.spin)<PHY.spinCut)b.spin=0;
 }
 v.y-=GRAV*h;
 p.x+=v.x*h;p.y+=v.y*h;p.z+=v.z*h;
 if(!ARENA_ON){
  if(p.y<BALL_R){
   p.y=BALL_R;
   if(v.y<0){if(v.y<-PHY.floorHitSnd)Au.wall(Math.abs(v.y)*.5,b.t.audio?.wall);v.y=-v.y*PHY.floorRest;if(v.y<PHY.floorRestCut)v.y=0;}
   const f=Math.exp(-PHY.floorFric*h);v.x*=f;v.z*=f;
  }else{const f=Math.exp(-PHY.airFric*h);v.x*=f;v.z*=f;}
  const zl=F.W/2-BALL_R;
  if(Math.abs(p.z)>zl&&p.y<F.wallH+BALL_R){
   if(p.z>zl&&v.z>0){p.z=zl;v.z=-v.z*PHY.wallRest;Au.wall(Math.abs(v.z),b.t.audio?.wall);}
   else if(p.z<-zl&&v.z<0){p.z=-zl;v.z=-v.z*PHY.wallRest;Au.wall(Math.abs(v.z),b.t.audio?.wall);}
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
    else if(p.y<ew+BALL_R&&v.x>0){p.x=xl;v.x=-v.x*PHY.wallRest;Au.wall(Math.abs(v.x),b.t.audio?.wall);}
   }else if(p.x<-xl){
    const gh=F.goalHalf*(S.eff[1].big>S.time?PHY.bigGoalMult:1);
    if(Math.abs(p.z)<gh&&(p.y<F.goalH||!ENDWALL_H)){
     if(p.x<-F.L/2&&p.y>=F.goalH)b.overBar=-1;
     else if(b.overBar!==-1&&p.y<F.goalH&&p.x<-F.L/2-BALL_R){onGoal(1,b);return;}}
    else if(p.y<ew+BALL_R&&v.x<0){p.x=-xl;v.x=-v.x*PHY.wallRest;Au.wall(Math.abs(v.x),b.t.audio?.wall);}
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
   let contacted=false;
   if(CR>0&&d<CR){
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
    if(p.y<BALL_R){
     p.y=BALL_R;if(v.y<0){if(v.y<-PHY.floorHitSnd)Au.wall(Math.abs(v.y)*.5,b.t.audio?.wall);v.y=-v.y*PHY.floorRest;if(v.y<PHY.floorRestCut)v.y=0;}
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
 if(!b.scored&&(p.y<-8||Math.abs(p.x)>F.L/2+F.goalDepth+8||Math.abs(p.z)>F.W/2+10)){outOfBounds(b);return;}
 const mv=b.t.maxV,sp2=v.x*v.x+v.y*v.y+v.z*v.z;
 if(sp2>mv*mv){const k=mv/Math.sqrt(sp2);v.multiplyScalar(k);}
}
/* solid round goal posts (vertical) + crossbar (horizontal) + a SOLID net roof, both goals,
   both tables. Posts/bar sit at the effective goal-mouth edge (scales with the 'big goal'
   power-up) and deflect with a metallic clang. A ball lobbed over the bar lands on the net
   roof instead of dropping in — so it can never score over the top; it settles and re-drops. */
function goalFrameCollide(b,h){
 const p=b.m.position,v=b.v,pr=PHY.postRad+BALL_R,e=1+PHY.postRest,GH=F.goalH,GD=F.goalDepth;
 for(let sx=-1;sx<=1;sx+=2){
  const gh=F.goalHalf*(S.eff[sx>0?0:1].big>S.time?PHY.bigGoalMult:1),gx=sx*F.L/2;
  // uprights: vertical cylinders at (gx, ±gh), y∈[0,goalH]
  if(p.y<GH+pr)for(let sz=-1;sz<=1;sz+=2){
   const dx=p.x-gx,dz=p.z-sz*gh,dd=Math.hypot(dx,dz);
   if(dd<pr&&dd>1e-4){const nx=dx/dd,nz=dz/dd;p.x+=nx*(pr-dd);p.z+=nz*(pr-dd);
    const vn=v.x*nx+v.z*nz;if(vn<0){v.x-=e*vn*nx;v.z-=e*vn*nz;Au.post(-vn,b.t.audio?.post);}}
  }
  // crossbar: horizontal cylinder along z at (gx, goalH), z∈[-gh,gh]
  if(Math.abs(p.z)<gh+pr){
   const dx=p.x-gx,dy=p.y-GH,dd=Math.hypot(dx,dy);
   if(dd<pr&&dd>1e-4){const nx=dx/dd,ny=dy/dd;p.x+=nx*(pr-dd);p.y+=ny*(pr-dd);
    const vn=v.x*nx+v.y*ny;if(vn<0){v.x-=e*vn*nx;v.y-=e*vn*ny;Au.post(-vn,b.t.audio?.post);}}
  }
  // net roof: solid top over the goal box (behind the line). A ball flagged as an over-the-bar lob
  // (b.overBar for this end) is caught at ANY depth below the roofline so a fast drop can't tunnel
  // through it into the net; an unflagged ball keeps the thin catch band as before.
  const xin=sx>0?(p.x>gx&&p.x<gx+GD):(p.x<gx&&p.x>gx-GD);
  const roofSolid=sx>0?b.overBar===1:b.overBar===-1;
   if(xin&&Math.abs(p.z)<gh&&v.y<0&&(roofSolid?p.y<GH+BALL_R:(p.y>=GH&&p.y<GH+BALL_R))){
   p.y=GH+BALL_R;if(v.y<-PHY.floorHitSnd)Au.wall(Math.abs(v.y)*.4,b.t.audio?.wall);
   v.y=-v.y*PHY.floorRest;if(v.y<PHY.floorRestCut)v.y=0;
   const f=Math.exp(-PHY.floorFric*h);v.x*=f;v.z*=f;
  }
 }
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
   const vn=(b.v.x-cvx)*nx+(b.v.y-cvy)*ny+(b.v.z-cvz)*nz;
   if(vn<0){
     // tracer only: the ball's OWN normal speed before the impulse rewrites b.v. vn is exactly
     // (ball·n − foot·n), so logging both halves shows whether a contact was driven by the swing
     // or by the ball's own arrival speed. Zero cost when the tracer is off (dbgLogRod is null).
     const dbgBN=(dbgLogRod===r)?(b.v.x*nx+b.v.y*ny+b.v.z*nz):0;
     const ks=r.kickStyle==='trapShot'?AIC.trapShot:KICK;
     const pow=r.kickT>=ks.powFrom&&r.kickT<ks.powTo;
     /* TRAP CONTACT. While ai.js holds r.act==='trap' the boot is a dead, sticky surface instead of
        the normal passive touch (kick.rest 0.01 / kick.grip 0.08). rest→0 kills the ball's speed
        relative to the foot; the big grip is the CARRY — b.v is lerped hard toward the contact
        point's own velocity, whose z component is the rod's slide (r.vz), so the ball travels with
        the man being dribbled sideways. Without this a "trap" is just a soft bounce: the ball parks
        near the boot and the rod slides out from under it. No sweet-spot bonus and no aim-assist on
        a trap contact either — both exist to make a STRIKE better, and applying them here would
        re-launch the ball we are trying to hold. */
     const trapping=r.act==='trap'&&r.kickT<0;
     const TRP=AIC.trap;
     const rest=trapping?TRP.holdRest:(pow?ks.restPower:ks.rest);
    // sweet spot: ball struck in the narrow z-centre of the foot AND a tight forward x band
    //   (dir-relative off the rod, same reference the AI's overFoot zone uses). lz is the ball's
    //   z offset from the foot; relR is how far ahead of the rod it contacts.
    const relR=(p.x-r.x)*r.kickDir;
    const sweet=!trapping&&SW.on&&Math.abs(lz)<bz*SW.zFrac&&relR>SW.xMin&&relR<SW.xMax;
    let jm=-(1+rest)*vn/b.t.mass;
    if(S.eff[r.team].boost>S.time)jm*=KICK.boostHitMult;
    jm*=stHit(r);
    if(sweet){let sb=SW.strBase+SW.strAcc*stAccFrac(r);if(r.aiIQ)sb+=SW.iqBonus;jm*=1+sb;}
    b.v.x+=nx*jm;b.v.y+=ny*jm;b.v.z+=nz*jm;
    const g=trapping?clamp(TRP.holdGrip,0,1):stGrip(r);
    b.v.x=lerp(b.v.x,cvx,g);b.v.z=lerp(b.v.z,cvz,g);
    const tang=cvx*(-nz)+cvz*nx;
    b.spin=clamp(b.spin+tang*KICK.spinGain,-KICK.spinClamp,KICK.spinClamp);
    // Total Control mode: the user rod's right-stick swerve line (r.tcSpin) bends the shot on contact
    if(r.tcSpin&&cfg.padControlMode==='total'&&isUserRod(r))
     b.spin=clamp(b.spin+r.tcSpin*KICK.tcSpinGain,-KICK.spinClamp,KICK.spinClamp);
    // tiny imperfection prevents pixel-perfect side-to-side oscillations
    const jit=Math.abs(jm)*FOOT_JITTER;
    b.v.x+=(Math.random()-.5)*jit;b.v.y+=(Math.random()-.5)*jit*.3;b.v.z+=(Math.random()-.5)*jit;
    // aim-assist bends a shot goalward: for the HUMAN only on a clean strike (power window or sweet
    // hit — a skill reward), but for AI rods on EVERY contact so they reliably aim in all modes.
    // aimAssist itself only acts on shots already moving goalward within its cone, so a defensive
    // touch (moving away) is untouched — this can't turn stray clears into shots.
    if(!trapping&&(pow||(sweet&&SW.forceAssist)||!isUserRod(r)))aimAssist(b,r);
     if(sweet){S.shake=Math.min(1,S.shake+SW.shake);r.aimSweet=i;}   // juice: a clean strike thumps
    if(-vn>KICK.sndFrom){Au.kick(-vn,b.t.audio?.kick);
     if(-vn>KICK.hardHit){S.shake=Math.min(1,S.shake+(-vn)/KICK.shakeDiv);}}
    S.lastTouch=r.team;
    if(r.kickT>=0&&!r.kickHit){r.kickHit=true;if(dbgLogRod===r)dbgHit(r,i,true,pow,sweet,-vn,b,
     {bn:dbgBN,fn:cvx*nx+cvy*ny+cvz*nz,sw:Math.hypot(cvx,cvy),sl:cvz,w:r.angVel,jm:jm,kt:r.kickT,rest:rest});}  // debug: mark first contact of this swing
    if(b.t.splits&&!b.didSplit&&-vn>KICK.splitVel&&S.balls.length<KICK.splitMax){
     b.didSplit=true;
     const nb=makeBall('split');nb.didSplit=true;
     nb.m.position.copy(p);nb.m.position.z+=(p.z>0?-KICK.splitSep:KICK.splitSep);syncBall(nb);
     const vx=b.v.x,vz=b.v.z,cs=Math.cos(KICK.splitAng),sn=Math.sin(KICK.splitAng);
     nb.v.set(vx*cs-vz*sn,b.v.y,vx*sn+vz*cs);
     b.v.set(vx*cs+vz*sn,b.v.y,-vx*sn+vz*cs);
     banner('👯 SPLIT!','TWO BALLS IN PLAY',1.4);Au.power();
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
  const rvx=b.v.x-cvx,rvy=b.v.y-cvy,rvz=b.v.z-cvz;
  const vn=rvx*nx+rvy*ny+rvz*nz;
  p.x+=nx*(R-d);p.y+=ny*(R-d);p.z+=nz*(R-d);
  if(vn<0){
    const dbgBN=(dbgLogRod===r)?(b.v.x*nx+b.v.y*ny+b.v.z*nz):0;   // tracer only — see the foot-box pass
    const ks=r.kickStyle==='trapShot'?AIC.trapShot:KICK;
    const pow=r.kickT>=ks.powFrom&&r.kickT<ks.powTo;
    const trapping=r.act==='trap'&&r.kickT<0;   // dead + sticky while holding — see the foot-box pass
    const TRP=AIC.trap;
    const rest=trapping?TRP.holdRest:(pow?ks.restPower:ks.rest);
    let jm=-(1+rest)*vn/b.t.mass;
    if(S.eff[r.team].boost>S.time)jm*=KICK.boostHitMult;
    jm*=stHit(r);
    b.v.x+=nx*jm;b.v.y+=ny*jm;b.v.z+=nz*jm;
    const g=trapping?clamp(TRP.holdGrip,0,1):stGrip(r);
    b.v.x=lerp(b.v.x,cvx,g);b.v.z=lerp(b.v.z,cvz,g);
    const tang=cvx*(-nz)+cvz*nx;
    b.spin=clamp(b.spin+tang*KICK.spinGain,-KICK.spinClamp,KICK.spinClamp);
    // Total Control mode: the user rod's right-stick swerve line (r.tcSpin) bends the shot on contact
    if(r.tcSpin&&cfg.padControlMode==='total'&&isUserRod(r))
     b.spin=clamp(b.spin+r.tcSpin*KICK.tcSpinGain,-KICK.spinClamp,KICK.spinClamp);
    if(!trapping&&(pow||!isUserRod(r)))aimAssist(b,r);   // human: power window only; AI: every contact (goalward-only, see foot-box note)
   if(-vn>KICK.sndFrom){Au.kick(-vn,b.t.audio?.kick);
    if(-vn>KICK.hardHit){S.shake=Math.min(1,S.shake+(-vn)/KICK.shakeDiv);}}
   S.lastTouch=r.team;
   if(r.kickT>=0&&!r.kickHit){r.kickHit=true;if(dbgLogRod===r)dbgHit(r,i,false,pow,false,-vn,b,
    {bn:dbgBN,fn:cvx*nx+cvy*ny+cvz*nz,sw:Math.hypot(cvx,cvy),sl:cvz,w:r.angVel,jm:jm,kt:r.kickT,rest:rest});}  // debug: mark first contact (capsule graze) of this swing — capsule can't be a sweet hit
   if(b.t.splits&&!b.didSplit&&-vn>KICK.splitVel&&S.balls.length<KICK.splitMax){
    b.didSplit=true;
    const nb=makeBall('split');nb.didSplit=true;
    nb.m.position.copy(p);nb.m.position.z+=(p.z>0?-KICK.splitSep:KICK.splitSep);syncBall(nb);
    const vx=b.v.x,vz=b.v.z,cs=Math.cos(KICK.splitAng),sn=Math.sin(KICK.splitAng);
    nb.v.set(vx*cs-vz*sn,b.v.y,vx*sn+vz*cs);
    b.v.set(vx*cs+vz*sn,b.v.y,-vx*sn+vz*cs);
    banner('👯 SPLIT!','TWO BALLS IN PLAY',1.4);Au.power();
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
 Au.wall((van-vbn)*2,(ma>=mb?a:b).t.audio?.wall);
}
