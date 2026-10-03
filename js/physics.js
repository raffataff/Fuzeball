'use strict';
// ================= physics (the core, treat carefully) =================
function physics(dt){
 if(dt<=0||!S.balls.length)return;
 pinUpdate();   // catch / release pinned balls before the substeps so a release this step is simulated this step
 // adaptive substepping keeps per-step travel under ~subTravel; friction is exp(k*h) per substep; the foot counts as a fast mover (~2.3u a step)
 let vmax=0;for(const b of S.balls){const s=b.v.length();if(s>vmax)vmax=s;}
 for(const r of rods){const fs=Math.abs(r.angVel)*ARM+Math.abs(r.vz);if(fs>vmax)vmax=fs;}
 const sub=clamp(Math.ceil(vmax*dt/PHY.subTravel),PHY.subMin,PHY.subMax),h=dt/sub;
 perfSub(sub);   // profiler (perf.js): substeps actually run
 // rod pose at the start of this step: angle - angVel*dt (angVel/vz stay the step average the impulse wants)
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
// ================= THE PIN (CONFIG.shots.pin) =================
// a ball pressed under a tilted man is carried with the rod: a constraint, not a contact (stepBall hands it to pinBallStep, skipping the solver)
// the input half is shots.js shotPinInput; one ball per rod (r.pinB <-> b.pinR); nothing here allocates
function pinUpdate(){
 const P=SHOT.pin;if(!P||!P.on)return;
 for(const r of rods){
  const pb=r.pinB;
  if(pb){
   // let go when the hand does, a swing starts, the ball leaves play, or the rod turns off the pin
   if(!r.pinOn||r.kickT>=0||pb.scored||S.balls.indexOf(pb)<0||Math.abs(r.angle-r.pinAt)>P.releaseA)pinRelease(r);
   continue;
  }
  if(!r.pinOn||r.kickT>=0)continue;
  const la=r.angle*r.kickDir;
  const posed=(r.pinPose&&r.pinA!=null)?Math.abs(r.angle-r.pinA)<P.capA:(la>=P.band[0]&&la<=P.band[1]);
  if(!posed)continue;
  const sa=Math.sin(r.angle),ca=Math.cos(r.angle),dx=sa*ARM,dy=-ca*ARM,reach=BALL_R+PRAD+P.touch;
  for(const b of S.balls){
   if(b.scored||b.pinR)continue;
   const p=b.m.position,rel=(p.x-r.x)*r.kickDir;
   if(rel<P.back||rel>P.front||p.y>BALL_R+P.yTol)continue;
   if(Math.hypot(b.v.x,b.v.z-r.vz)>P.capV)continue;             // too quick to hold: the finesse grip slows it first
   for(let i=0;i<r.baseZ.length;i++){
    if(r.removedUntil[i]&&r.removedUntil[i]>S.time)continue;
    const mz=r.baseZ[i]+r.offset;
    if(Math.abs(p.z-mz)>P.zCatch)continue;
    // touching the leg (capsule pivot to foot), same measure as shots.js shotLegClips
    const wx=p.x-r.x,wy=p.y-ROD_H,t=clamp((wx*dx+wy*dy)/(ARM*ARM),0,1);
    const nx=p.x-(r.x+dx*t),ny=p.y-(ROD_H+dy*t),nz=p.z-mz;
    if(nx*nx+ny*ny+nz*nz>reach*reach)continue;
    r.pinB=b;r.pinAt=(r.pinPose&&r.pinA!=null)?r.pinA:r.angle;
    b.pinR=r;b.pinMan=i;b.pinDx=rel;b.pinDz=clamp(p.z-mz,-P.zHold,P.zHold);
    b.v.set(0,0,r.vz);b.spin=0;b.pinVx=0;b.pinVz=r.vz;b.pinPx=p.x;b.pinPz=p.z;
    break;
   }
   if(r.pinB)break;
  }
 }
}
// one substep of a pinned ball; false = let go (it's stepped normally this substep)
// breaks on an outside velocity change (another ball) or position change (re-drop, syncBall), measured against what this wrote
function pinBallStep(b,h){
 const r=b.pinR,P=SHOT.pin,p=b.m.position,v=b.v;
 if(Math.abs(v.x-b.pinVx)+Math.abs(v.z-b.pinVz)+Math.abs(v.y)>P.breakV){pinRelease(r,true);return false;}
 if(Math.abs(p.x-b.pinPx)+Math.abs(p.z-b.pinPz)>1){pinRelease(r,true);return false;}
 const tz=r.baseZ[b.pinMan]+r.offset+b.pinDz,zl=F.W/2-BALL_R,cz=clamp(tz,-zl,zl);
 if(Math.abs(cz-tz)>P.zSlip){pinRelease(r);return false;}      // squeezed into a side wall: it slips out
 const tx=r.x+r.kickDir*b.pinDx;
 v.set((tx-p.x)/h,0,(cz-p.z)/h);p.set(tx,BALL_R,cz);b.spin=0;
 b.pinVx=v.x;b.pinVz=v.z;b.pinPx=p.x;b.pinPz=p.z;
 return true;
}
// let go: ext = something else already moved it (keep that velocity), else it keeps carryOut of the slide
function pinRelease(r,ext){
 const b=r.pinB;r.pinB=null;
 if(!b)return;
 b.pinR=null;
 if(!ext){b.v.x=0;b.v.y=0;b.v.z*=SHOT.pin.carryOut;}
}

// ================= contact AUDIO gating =================
// an impact is an event, a roll is a state (js/audio.js); hitFresh is the event half: the surface must have been clear for PHY.contactHold and the hit hard enough
// timestamps, not countdowns (S.time only advances between sim steps); k indexes b.cT: 0 floor/net roof, 1 wall, 2 ball-vs-ball
function hitFresh(b,k,imp,min){
 // -1e9, not 0: 'never touched' must read as long ago or the first contact is swallowed
 const t=b.cT||(b.cT=[-1e9,-1e9,-1e9]);   // lazy init covers a ball built before balls.js gained the field
 const fresh=S.time-t[k]>PHY.contactHold;
 t[k]=S.time;                    // stamp on EVERY contact, fired or not — that is what holds the gate shut
 return fresh&&imp>min;
}
// rollProbe is the state half: position-only, runs once per frame on the settled state, never writes p or v
// Au.rollFeed takes a max; the bowl's curved walls feed from arenaContact (arena.js)
function rollProbe(b){
 if(b.scored)return;
 const p=b.m.position,v=b.v,eps=PHY.contactEps,aC=b.t.audio;
 if(p.y<BALL_R+eps)Au.rollFeed(0,Math.hypot(v.x,v.z),aC);             // floor — both tables
 if(ARENA_ON||p.y>=F.wallH+BALL_R)return;
 const zl=F.W/2-BALL_R,xl=F.L/2-BALL_R;
 if(Math.abs(p.z)>zl-eps)Au.rollFeed(1,Math.hypot(v.x,v.y),aC);       // side wall: travel is x/y
 else if(Math.abs(p.x)>xl-eps)Au.rollFeed(1,Math.hypot(v.z,v.y),aC);  // end wall: travel is z/y
}
// is the ball past the line somewhere other than the mouth? (wide of a post, over the bar, under the pitch, behind the net)
// the caller latches it (b.noGoal, cleared once back in front of the line); kept apart from b.overBar, which drives the net roof
function notMouth(p,gh){
 return Math.abs(p.z)>=gh||p.y>=F.goalH||p.y<=-BALL_R||Math.abs(p.x)>F.L/2+F.goalDepth;
}
// has this ball left the cabinet? a lofted ball outside a wall would re-enter its height band and be clamped back onto the pitch
// latch the crossing: walls and floor stop reaching for it and physStep whistles; cleared when back inside both planes; PHY.wallEscape false restores the old behaviour
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
 // safety: a non-finite state re-drops the ball instead of poisoning the sim
 if(!isFinite(p.x)||!isFinite(p.y)||!isFinite(p.z)||!isFinite(v.x)||!isFinite(v.y)||!isFinite(v.z)){
  if(b.pinR)pinRelease(b.pinR,true);
  p.set(rngR(RNG.nan,-5,5),PHY.redropY,rngR(RNG.nan,-8,8));v.set(0,0,0);b.spin=0;syncBall(b);return;}
 if(b.pinR&&pinBallStep(b,h))return;   // pinned: carried by its rod, outside the contact solver (see THE PIN)
 // knuckleball: periodically re-kick the side-spin to a random value (energy-safe)
 if(b.t.knuckle){
  b.knuckT-=h;
  if(b.knuckT<=0){const K=b.t.knuckle,KR=RNG.knuck;b.knuckT=rngR(KR,K.every[0],K.every[1]);
   b.spin=clamp(b.spin+rngR(KR,-K.kick,K.kick),-K.max,K.max);}
 }
 // spin/Magnus: rotate the horizontal velocity by a small angle (no energy added)
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
   if(v.y<0){if(hitFresh(b,0,-v.y,PHY.floorHitSnd))Au.wall(Math.abs(v.y)*.5,b.t.audio?.wall,b,1);v.y=-v.y*PHY.floorRest;if(v.y<PHY.floorRestCut)v.y=0;}
   const f=Math.exp(-PHY.floorFric*h);v.x*=f;v.z*=f;
  }else{const f=Math.exp(-PHY.airFric*h);v.x*=f;v.z*=f;}
  const zl=F.W/2-BALL_R;
  // the clamp is positional, only the bounce is gated on arrival (a boot pressing a ball into the wall leaves it never 'arriving', see staticClamp)
  if(Math.abs(p.z)>zl&&p.y<F.wallH+BALL_R&&!b.outWall){
   const sz=p.z>0?1:-1;
   // gated on a fresh contact + PHY.wallHitSnd; a ball riding the wall is a roll (rollProbe)
   if(v.z*sz>0){const im=Math.abs(v.z);v.z=-v.z*PHY.wallRest;if(hitFresh(b,1,im,PHY.wallHitSnd)){Au.wall(im,b.t.audio?.wall,b,0);spawnMark(b,0,0,-sz,im);}}   // the tap AND the scuff ride the same fresh-contact gate
   p.z=sz*zl;
  }
  if(!b.scored){
   // ENDWALL_H>0 (walled tables, e.g. circuit): each end is one solid wall with the mouth inset; 0 = classic, the wall only flanks the mouth
   const xl=F.L/2-BALL_R,ew=ENDWALL_H||F.wallH;
   if(p.x>xl){
    const gh=F.goalHalf*(S.eff[0].big>S.time?PHY.bigGoalMult:1);
    if(p.x>F.L/2&&notMouth(p,gh))b.noGoal=1;                                                    // past the line but not in the opening: no goal (see notMouth)
    if(Math.abs(p.z)<gh&&(p.y<F.goalH||!ENDWALL_H)){
     if(p.x>F.L/2&&p.y>=F.goalH)b.overBar=1;                                                    // sailed OVER the bar → a lob, never a goal (net roof below catches it)
     else if(b.overBar!==1&&b.noGoal!==1&&p.y<F.goalH&&p.x>F.L/2+BALL_R){onGoal(0,b);return;}}   // goal ONLY under the bar, whole ball over the line, in through the mouth
    else if(p.y<ew+BALL_R&&!b.outWall){if(v.x>0){const im=Math.abs(v.x);v.x=-v.x*PHY.wallRest;if(hitFresh(b,1,im,PHY.wallHitSnd)){Au.wall(im,b.t.audio?.wall,b,0);spawnMark(b,-1,0,0,im);}}p.x=xl;}   // clamp always, bounce on arrival — same reason as the side walls above
   }else if(p.x<-xl){
    const gh=F.goalHalf*(S.eff[1].big>S.time?PHY.bigGoalMult:1);
    if(p.x<-F.L/2&&notMouth(p,gh))b.noGoal=-1;
    if(Math.abs(p.z)<gh&&(p.y<F.goalH||!ENDWALL_H)){
     if(p.x<-F.L/2&&p.y>=F.goalH)b.overBar=-1;
     else if(b.overBar!==-1&&b.noGoal!==-1&&p.y<F.goalH&&p.x<-F.L/2-BALL_R){onGoal(1,b);return;}}
    else if(p.y<ew+BALL_R&&!b.outWall){if(v.x<0){const im=Math.abs(v.x);v.x=-v.x*PHY.wallRest;if(hitFresh(b,1,im,PHY.wallHitSnd)){Au.wall(im,b.t.audio?.wall,b,0);spawnMark(b,1,0,0,im);}}p.x=-xl;}
   }
   if(b.overBar===1&&p.x<F.L/2)b.overBar=0; else if(b.overBar===-1&&p.x>-F.L/2)b.overBar=0;      // rolled back in FRONT of the line → live again
   if(b.noGoal===1&&p.x<F.L/2)b.noGoal=0; else if(b.noGoal===-1&&p.x>-F.L/2)b.noGoal=0;         // same for the mouth latch
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
   // the bowl has the same hole and throws a far-outside ball back hard; same latch
   if(!PHY.wallEscape||d>=0)b.outWall=0; else if(!b.outWall&&p.y>=F.wallH+BALL_R)b.outWall=1;
   let contacted=!!b.outWall;   // outside and over the rim — nothing below reaches for it
   if(!b.outWall&&CR>0&&d<CR){
    // ---- curved crease (fillet) zone: quarter-torus wall to floor blend ----
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
    // ---- flat interior; CR=0 adds a sharp 90° wall ----
    if(CR<=0&&p.y<F.wallH+BALL_R&&d<BALL_R){
     const g=arenaGrad(p.x,p.z,gh0,gh1),nx=-g.x,ny=0,nz=-g.z,pen=BALL_R-d;
     arenaContact(b,pen,nx,ny,nz);contacted=true;
    }
    if(p.y<BALL_R&&!b.outWall){
     p.y=BALL_R;if(v.y<0){if(hitFresh(b,0,-v.y,PHY.floorHitSnd))Au.wall(Math.abs(v.y)*.5,b.t.audio?.wall,b,1);v.y=-v.y*PHY.floorRest;if(v.y<PHY.floorRestCut)v.y=0;}
     const f=Math.exp(-PHY.floorFric*h);v.x*=f;v.z*=f;
    }else if(!contacted){const f=Math.exp(-PHY.airFric*h);v.x*=f;v.z*=f;}
   }
   // goal detection: the mouth latch does the work (see notMouth)
   if(p.x>F.L/2){
    if(notMouth(p,gh0))b.noGoal=1;
    else if(b.noGoal!==1&&b.overBar!==1&&p.x>F.L/2+BALL_R){onGoal(0,b);return;}
    if(p.y>=F.goalH&&Math.abs(p.z)<gh0)b.overBar=1;                                             // lob over the bar — the net roof reads this flag
   }else if(p.x<-F.L/2){
    if(notMouth(p,gh1))b.noGoal=-1;
    else if(b.noGoal!==-1&&b.overBar!==-1&&p.x<-F.L/2-BALL_R){onGoal(1,b);return;}
    if(p.y>=F.goalH&&Math.abs(p.z)<gh1)b.overBar=-1;
   }
   if(b.overBar===1&&p.x<F.L/2)b.overBar=0; else if(b.overBar===-1&&p.x>-F.L/2)b.overBar=0;
   if(b.noGoal===1&&p.x<F.L/2)b.noGoal=0; else if(b.noGoal===-1&&p.x>-F.L/2)b.noGoal=0;
  }
 }
 if(!b.scored)goalFrameCollide(b,h);
 for(const r of rods){
  if(Math.abs(p.x-r.x)>ARM+BALL_R+2)continue;
  collideRod(b,r);
 }
 if(!b.scored)staticClamp(b);   // static geometry gets the last word — must run BEFORE the out-of-bounds test below
 if(!b.scored&&(p.y<-8||Math.abs(p.x)>F.L/2+F.goalDepth+8||Math.abs(p.z)>F.W/2+10)){outOfBounds(b);return;}
 // hard clamp at maxV, except a ball a charged shot sent past it (capSpeed sets b.over); it only ratchets down
 const mv=b.t.maxV,sp2=v.x*v.x+v.y*v.y+v.z*v.z;
 let lim=mv;
 if(b.over>mv){const sp=Math.sqrt(sp2);b.over=Math.min(b.over,Math.max(sp,mv));if(b.over>mv)lim=b.over;else b.over=0;}
 if(sp2>lim*lim){const k=lim/Math.sqrt(sp2);v.multiplyScalar(k);}
}
// static geometry gets the last word: collideRod writes p after the wall tests, so a squeeze could shove the ball through the wall
// re-assert the bounds here (position only, kill the into-surface velocity); the arena and scored balls are exempt
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
  // mouth test mirrors stepBall's: a ball in the opening is on its way in
  if(p.x>xl){const gh=F.goalHalf*(S.eff[0].big>S.time?PHY.bigGoalMult:1);
   if(!(Math.abs(p.z)<gh&&(p.y<F.goalH||!ENDWALL_H))){p.x=xl;if(v.x>0)v.x=0;}}
  else if(p.x<-xl){const gh=F.goalHalf*(S.eff[1].big>S.time?PHY.bigGoalMult:1);
   if(!(Math.abs(p.z)<gh&&(p.y<F.goalH||!ENDWALL_H))){p.x=-xl;if(v.x<0)v.x=0;}}
 }
}
// solid round posts and crossbar plus a solid net roof, both goals; a ball lobbed over the bar lands on the roof and re-drops
function goalFrameCollide(b,h){
 const p=b.m.position,v=b.v,pr=PHY.postRad+BALL_R,e=1+PHY.postRest,GH=F.goalH,GD=F.goalDepth;
 // early-out: nothing here can touch a ball more than a post-radius inside either line (pure cost cut)
 if(Math.abs(p.x)<F.L/2-pr)return;
 for(let sx=-1;sx<=1;sx+=2){
  const gh=F.goalHalf*(S.eff[sx>0?0:1].big>S.time?PHY.bigGoalMult:1),gx=sx*F.L/2;
  // uprights: vertical cylinders at (gx, ±gh), y∈[0,goalH]
  if(p.y<GH+pr)for(let sz=-1;sz<=1;sz+=2){
   const dx=p.x-gx,dz=p.z-sz*gh,dd=Math.hypot(dx,dz);
   if(dd<pr&&dd>1e-4){const nx=dx/dd,nz=dz/dd;p.x+=nx*(pr-dd);p.z+=nz*(pr-dd);
    const vn=v.x*nx+v.z*nz;if(vn<0){v.x-=e*vn*nx;v.z-=e*vn*nz;Au.post(-vn,b.t.audio?.post,b);momWood(b,-vn,0);}}
  }
  // crossbar: horizontal cylinder along z at (gx, goalH), z∈[-gh,gh]
  if(Math.abs(p.z)<gh+pr){
   const dx=p.x-gx,dy=p.y-GH,dd=Math.hypot(dx,dy);
   if(dd<pr&&dd>1e-4){const nx=dx/dd,ny=dy/dd;p.x+=nx*(pr-dd);p.y+=ny*(pr-dd);
    const vn=v.x*nx+v.y*ny;if(vn<0){v.x-=e*vn*nx;v.y-=e*vn*ny;Au.post(-vn,b.t.audio?.post,b);momWood(b,-vn,1);}}
  }
  // net roof: an over-the-bar lob (b.overBar) is caught at any depth below the roofline, others keep the thin band
  const xin=sx>0?(p.x>gx&&p.x<gx+GD):(p.x<gx&&p.x>gx-GD);
  const roofSolid=sx>0?(b.overBar===1||b.noGoal===1):(b.overBar===-1||b.noGoal===-1);
   if(xin&&Math.abs(p.z)<gh&&v.y<0&&(roofSolid?p.y<GH+BALL_R:(p.y>=GH&&p.y<GH+BALL_R))){
   p.y=GH+BALL_R;if(hitFresh(b,0,-v.y,PHY.floorHitSnd))Au.wall(Math.abs(v.y)*.4,b.t.audio?.wall,b,1);
   v.y=-v.y*PHY.floorRest;if(v.y<PHY.floorRestCut)v.y=0;
   const f=Math.exp(-PHY.floorFric*h);v.x*=f;v.z*=f;
  }
 }
}
// PER-CONTACT SPEED CEILING (CONFIG.kick.cap)
// the impulse bounce exceeds maxV and stepBall's clamp flattened every strike to one speed; so each contact has its own ceiling (stronger rods aim higher) with a knee easing into it
// it only bounds what a boot adds, never slows a faster ball; stepBall's maxV clamp stays the last word (cap.max > 1 so the best strikes reach maxV)
function capSpeed(b,r,sweet,in2){
 const C=KICK.cap;
 if(!C.on)return;
 const v=b.v,sp2=v.x*v.x+v.y*v.y+v.z*v.z,lo=b.t.maxV*C.min*C.knee;
 if(sp2<=lo*lo)return;              // under the lowest knee any contact could have: skips the stat reads on passive touches
 let f=C.base+C.str*stCapFrac(r),mx=C.max;
 if(sweet)f+=C.sweet;
 if(r.shotOn)f+=C.shot*(r.shotPow-1);   // the shot's own power trim: a finesse touch lowers the ceiling, a timed charge raises it
 if(r.kickStyle==='trapShot')f+=C.pin||0;   // the pin / trap shot: every contact of the swing, not just the first (which spends the trim)
 // a charge beats the cap: raises the ceiling and the most any ceiling may be
 const w=(r.shotOn&&r.shotOver>0)?r.shotOver:0;
 if(w>0){f+=(C.charge||0)*w;mx+=(C.chargeTop||0)*w;}
 if(S.eff[r.team].boost>S.time)f+=C.boost;
 // ...and for the whole swing: later contacts of the swing keep the charged ceiling (r.swF / r.swMx, cleared by kickRod)
 if(w>0){r.swF=f;r.swMx=mx;}
 else if(r.kickT>=0&&r.swOver>0&&r.swF>0){if(r.swF>f)f=r.swF;if(r.swMx>mx)mx=r.swMx;}
 const cap=b.t.maxV*clamp(f,C.min,mx),knee=cap*C.knee;
 if(cap>b.t.maxV&&(w>0||(r.kickT>=0&&r.swOver>0)))b.over=Math.max(b.over||0,cap);   // stepBall's maxV clamp lets this ball keep it (and ratchets it down)
 if(sp2<=knee*knee)return;
 const sp=Math.sqrt(sp2),span=cap-knee;
 let out=knee+span*(1-Math.exp(-(sp-knee)/span));
 const inSp=Math.sqrt(in2);
 if(out<inSp)out=Math.min(sp,inSp);     // the cap limits what this contact ADDED, never the speed it arrived with
 const k=out/sp;v.x*=k;v.y*=k;v.z*=k;   // components, not multiplyScalar: collideRod writes b.v by hand and the harnesses stub it as a plain object
}
function collideRod(b,r){
 if(r.trnHidden)return;                   // training sandbox: hidden rods are ghosts — no contact
 const p=b.m.position;
// ---- foot box (priority) ----
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
   // cvz is scaled and cvx/cvy aren't: the swing transfers in full, the slide only pushes (CONFIG.kick.slidePush)
   const vn=(b.v.x-cvx)*nx+(b.v.y-cvy)*ny+(b.v.z-cvz*KICK.slidePush)*nz;
   if(vn<0){
     // tracer only: the ball's own normal speed before the impulse; free when the tracer is off
     const dbgBN=(dbgLogRod===r)?(b.v.x*nx+b.v.y*ny+b.v.z*nz):0;
     const ks=kickStyleCfg(r);
     const pow=r.kickT>=ks.powFrom&&r.kickT<ks.powTo;
     // hold contact: while ai.js has a trap or dribble live, the boot is a dead sticky surface (rest 0, big grip so b.v follows the contact point); no sweet bonus or aim-assist; holdCfg (rods.js) returns the block or null
     const HLD=holdCfg(r),trapping=!!HLD;
     const rest=trapping?HLD.holdRest:(pow?ks.restPower:ks.rest);
    // sweet spot: struck in the foot's narrow z-centre and a tight forward x band (dir-relative); lz = z offset from the foot, relR = how far ahead of the rod
    const relR=(p.x-r.x)*r.kickDir;
    const sweet=!trapping&&SW.on&&Math.abs(lz)<bz*SW.zFrac&&relR>SW.xMin&&relR<SW.xMax;
    const in2=b.v.x*b.v.x+b.v.y*b.v.y+b.v.z*b.v.z;   // speed ARRIVING, for the ceiling's floor (capSpeed)
    let jm=-(1+rest)*vn/b.t.mass;
    if(S.eff[r.team].boost>S.time)jm*=KICK.boostHitMult;
    jm*=stHit(r);
    // player shot (js/shots.js): r.shotOn is the whole contract (the only way a Total Control stick swing carries a charge, it never calls kickRod)
    if(r.shotOn)jm*=r.shotPow;
    if(sweet){let sb=SW.strBase+SW.strAcc*stAccFrac(r);if(r.aiIQ)sb+=SW.iqBonus;jm*=1+sb;}
    b.v.x+=nx*jm;b.v.y+=ny*jm;b.v.z+=nz*jm;
    const g=trapping?clamp(HLD.holdGrip,0,1):stGrip(r);
    b.v.x=lerp(b.v.x,cvx,g);b.v.z=lerp(b.v.z,cvz,g);
    if(!trapping)capSpeed(b,r,sweet,in2);   // per-contact speed ceiling (see the banner above); a held contact is exempt
    const tang=cvx*(-nz)+cvz*nx;
    b.spin=clamp(b.spin+tang*KICK.spinGain,-KICK.spinClamp,KICK.spinClamp);
    // Total Control: the user rod's swerve line (r.tcSpin) bends the shot on contact
    if(r.tcSpin&&cfg.padControlMode==='total'&&isUserRod(r))
     b.spin=clamp(b.spin+r.tcSpin*KICK.tcSpinGain,-KICK.spinClamp,KICK.spinClamp);
    // tiny imperfection prevents pixel-perfect side-to-side oscillations
    const jit=Math.abs(jm)*FOOT_JITTER;
    // seeded on its own stream: it draws per man per substep, so sharing would tie other consumers to the contact count
    const JR=RNG.jit;
    b.v.x+=(JR()-.5)*jit;b.v.y+=(JR()-.5)*jit*.3;b.v.z+=(JR()-.5)*jit;
    // aim-assist bends a shot goalward: humans on a clean strike, AI rods on every contact, only shots already moving goalward
    // passFaceOK (rods.js): a side/back clip is a deflection, so the pass assist skips it; r.shotOn joins the gate (a Total Control swing has kickT<0); one contact spends the shot
    if(!trapping&&(pow||(sweet&&SW.forceAssist)||r.shotOn||!isUserRod(r)))aimAssist(b,r,!passFaceOK(r,nx));
    if(!trapping)wallAssist(b,r,!passFaceOK(r,nx));   // a wall ball leaves infield: after the aim, before the spray (stats.js)
    if(r.shotOn){shotSpray(b,r);shotConsume(r);}
     if(sweet){S.shake=Math.min(1,S.shake+SW.shake);r.aimSweet=i;}   // juice: a clean strike thumps
    if(-vn>KICK.sndFrom){Au.kick(-vn,b.t.audio?.kick,b);
     if(-vn>KICK.hardHit){S.shake=Math.min(1,S.shake+(-vn)/KICK.shakeDiv);}}
    momContact(b,r);msContact(b,r);S.lastTouch=r.team;   // moments.js contact record (reads the previous one, so first); matchstats keeps its own
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
 // ---- rod capsule (fallback) ----
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
    if(!trapping)capSpeed(b,r,false,in2);   // per-contact speed ceiling; a leg graze is no more entitled to a top-speed ball than a boot
    const tang=cvx*(-nz)+cvz*nx;
    b.spin=clamp(b.spin+tang*KICK.spinGain,-KICK.spinClamp,KICK.spinClamp);
    // Total Control: the user rod's swerve line (r.tcSpin) bends the shot on contact
    if(r.tcSpin&&cfg.padControlMode==='total'&&isUserRod(r))
     b.spin=clamp(b.spin+r.tcSpin*KICK.tcSpinGain,-KICK.spinClamp,KICK.spinClamp);
    // human: power window only; AI: every contact; the pass assist is always suppressed (the capsule is the leg, not a pass)
    if(!trapping&&(pow||r.shotOn||!isUserRod(r)))aimAssist(b,r,true);
    if(!trapping)wallAssist(b,r,true);                 // …and off the leg too — see the foot-box pass
    if(r.shotOn){shotSpray(b,r);shotConsume(r);}
   if(-vn>KICK.sndFrom){Au.kick(-vn,b.t.audio?.kick,b);
    if(-vn>KICK.hardHit){S.shake=Math.min(1,S.shake+(-vn)/KICK.shakeDiv);}}
   momContact(b,r);msContact(b,r);S.lastTouch=r.team;
   if(r.kickT>=0&&!r.kickHit){r.kickHit=true;if(dbgLogRod===r)dbgHit(r,i,false,pow,false,-vn,b,
    {bn:dbgBN,fn:cvx*nx+cvy*ny+cvz*nz,sw:Math.hypot(cvx,cvy),sl:cvz,w:r.angVel,jm:jm,kt:r.kickT,rest:rest});}  // debug: first contact (capsule graze) of this swing; a capsule can't be a sweet hit
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
 // both balls must be fresh and both timers are stamped either way (a pile would machine-gun); the heavier ball owns the timbre
 const cl=van-vbn,fa=hitFresh(a,2,cl,PHY.ballHitSnd),fb=hitFresh(b,2,cl,PHY.ballHitSnd);
 if(fa&&fb)Au.wall(cl*2,(ma>=mb?a:b).t.audio?.wall,ma>=mb?a:b,2);
}
