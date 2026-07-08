'use strict';
/* ================= physics (the core — treat carefully) ================= */
function physics(dt){
 if(dt<=0||!S.balls.length)return;
 // adaptive substepping: keep per-step travel under ~subTravel so fast/heavy balls can't tunnel.
 // floor/air friction are applied per-substep as exp(k*h), so total exp(k*dt) is invariant to sub count.
 let vmax=0;for(const b of S.balls){const s=b.v.length();if(s>vmax)vmax=s;}
 const sub=clamp(Math.ceil(vmax*dt/PHY.subTravel),PHY.subMin,PHY.subMax),h=dt/sub;
 for(let s=0;s<sub;s++){
  for(let bi=S.balls.length-1;bi>=0;bi--)stepBall(S.balls[bi],h);
  for(let i=0;i<S.balls.length;i++)for(let j=i+1;j<S.balls.length;j++)ballBall(S.balls[i],S.balls[j]);
 }
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
   if(v.y<0){if(v.y<-PHY.floorHitSnd)Au.wall(Math.abs(v.y)*.5);v.y=-v.y*PHY.floorRest;if(v.y<PHY.floorRestCut)v.y=0;}
   const f=Math.exp(-PHY.floorFric*h);v.x*=f;v.z*=f;
  }else{const f=Math.exp(-PHY.airFric*h);v.x*=f;v.z*=f;}
  const zl=F.W/2-BALL_R;
  if(Math.abs(p.z)>zl&&p.y<F.wallH+BALL_R){
   if(p.z>zl&&v.z>0){p.z=zl;v.z=-v.z*PHY.wallRest;Au.wall(Math.abs(v.z));}
   else if(p.z<-zl&&v.z<0){p.z=-zl;v.z=-v.z*PHY.wallRest;Au.wall(Math.abs(v.z));}
  }
  if(!b.scored){
   const xl=F.L/2-BALL_R;
   if(p.x>xl){
    const gh=F.goalHalf*(S.eff[0].big>S.time?PHY.bigGoalMult:1);
    if(Math.abs(p.z)<gh&&p.y<F.goalH){if(p.x>F.L/2+1.2){onGoal(0,b);return;}}
    else if(p.y<F.wallH+BALL_R&&v.x>0){p.x=xl;v.x=-v.x*PHY.wallRest;Au.wall(Math.abs(v.x));}
   }else if(p.x<-xl){
    const gh=F.goalHalf*(S.eff[1].big>S.time?PHY.bigGoalMult:1);
    if(Math.abs(p.z)<gh&&p.y<F.goalH){if(p.x<-F.L/2-1.2){onGoal(1,b);return;}}
    else if(p.y<F.wallH+BALL_R&&v.x<0){p.x=-xl;v.x=-v.x*PHY.wallRest;Au.wall(Math.abs(v.x));}
   }
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
   const sd=(p.y<F.goalH)?arenaSD(p.x,p.z,gh0,gh1):sdRRect(p.x,p.z,F.L/2,F.W/2,ARENA.cornerR);
   const d=-sd;
   let contacted=false;
   if(d>=ARENA.creaseR){
    if(p.y<BALL_R){
     p.y=BALL_R;if(v.y<0){if(v.y<-PHY.floorHitSnd)Au.wall(Math.abs(v.y)*.5);v.y=-v.y*PHY.floorRest;if(v.y<PHY.floorRestCut)v.y=0;}
     const f=Math.exp(-PHY.floorFric*h);v.x*=f;v.z*=f;
    }else{const f=Math.exp(-PHY.airFric*h);v.x*=f;v.z*=f;}
    contacted=true;
   }else{
    const CR=ARENA.creaseR;
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
   }
   // goal detection unchanged from classic
   const xl=F.L/2-BALL_R;
   if(p.x>xl){
    if(Math.abs(p.z)<gh0&&p.y<F.goalH){if(p.x>F.L/2+1.2){onGoal(0,b);return;}}
   }else if(p.x<-xl){
    if(Math.abs(p.z)<gh1&&p.y<F.goalH){if(p.x<-F.L/2-1.2){onGoal(1,b);return;}}
   }
  }
 }
 for(const r of rods){
  if(Math.abs(p.x-r.x)>ARM+BALL_R+2)continue;
  collideRod(b,r);
 }
 if(!b.scored&&(p.y<-8||Math.abs(p.x)>F.L/2+F.goalDepth+8||Math.abs(p.z)>F.W/2+10)){outOfBounds(b);return;}
 const mv=b.t.maxV,sp2=v.x*v.x+v.y*v.y+v.z*v.z;
 if(sp2>mv*mv){const k=mv/Math.sqrt(sp2);v.multiplyScalar(k);}
}
function collideRod(b,r){
 const p=b.m.position;
/* ---- foot box (priority) ---- */
    const bx=FOOT_BOX.x,by=FOOT_BOX.y,bz=FOOT_BOX.z,offx=FOOT_BOX_OFF.x,offy=FOOT_BOX_OFF.y*r.kickDir;
    const reach=BALL_R*FOOT_BOX_REACH;
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
    const pow=r.kickT>=KICK.powFrom&&r.kickT<KICK.powTo;
    const rest=pow?KICK.restPower:KICK.rest;
    let jm=-(1+rest)*vn/b.t.mass;
    if(S.eff[r.team].boost>S.time)jm*=KICK.boostHitMult;
    jm*=stHit(r);
    b.v.x+=nx*jm;b.v.y+=ny*jm;b.v.z+=nz*jm;
    const g=stGrip(r);
    b.v.x=lerp(b.v.x,cvx,g);b.v.z=lerp(b.v.z,cvz,g);
    const tang=cvx*(-nz)+cvz*nx;
    b.spin=clamp(b.spin+tang*KICK.spinGain,-KICK.spinClamp,KICK.spinClamp);
    // tiny imperfection prevents pixel-perfect side-to-side oscillations
    const jit=Math.abs(jm)*FOOT_JITTER;
    b.v.x+=(Math.random()-.5)*jit;b.v.y+=(Math.random()-.5)*jit*.3;b.v.z+=(Math.random()-.5)*jit;
    if(pow)aimAssist(b,r);
    if(-vn>KICK.sndFrom){Au.kick(-vn);
     if(-vn>KICK.hardHit){S.shake=Math.min(1,S.shake+(-vn)/KICK.shakeDiv);}}
    S.lastTouch=r.team;S.still=0;
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
   const pow=r.kickT>=KICK.powFrom&&r.kickT<KICK.powTo;
   const rest=pow?KICK.restPower:KICK.rest;
   let jm=-(1+rest)*vn/b.t.mass;
   if(S.eff[r.team].boost>S.time)jm*=KICK.boostHitMult;
   jm*=stHit(r);
   b.v.x+=nx*jm;b.v.y+=ny*jm;b.v.z+=nz*jm;
   const g=stGrip(r);
   b.v.x=lerp(b.v.x,cvx,g);b.v.z=lerp(b.v.z,cvz,g);
   const tang=cvx*(-nz)+cvz*nx;
   b.spin=clamp(b.spin+tang*KICK.spinGain,-KICK.spinClamp,KICK.spinClamp);
   if(pow)aimAssist(b,r);
   if(-vn>KICK.sndFrom){Au.kick(-vn);
    if(-vn>KICK.hardHit){S.shake=Math.min(1,S.shake+(-vn)/KICK.shakeDiv);}}
   S.lastTouch=r.team;S.still=0;
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
 Au.wall((van-vbn)*2);
}
