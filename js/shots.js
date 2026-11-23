'use strict';
// ================= shots: the player's kick verbs =================
// kick is the pass (swings.pass), power + kick the shot (swings.shoot), which a wind-up powers; the axis (power - finesse, -1..+1) picks the forward pin and Total Control's tracking
// physics reads only r.shotOn / r.shotPow / r.shotCtl; CONFIG.shots.on:false = the pre-shots pad, with no wind-up, pin or pass aim
// core, not optional: not typeof-guarded

const SHOTC=CONFIG.shots;
function shotsOn(){return !!(SHOTC&&SHOTC.on);}

// --- the modifier axis ---
// one analog trigger rescaled past its deadzone (triggers rest noisy)
function shotTrigD(gp,i){
 const b=gp&&gp.buttons&&gp.buttons[i];if(!b)return 0;
 const v=(b.value!=null?b.value:(b.pressed?1:0)),d=SHOTC.mod.dead;
 return v>d?clamp((v-d)/(1-d),0,1):0;
}
function shotAxis(lt,rt){return clamp(rt-lt,-1,1);}
// the axis off a pad, handed to shotFire on a button press; 0 with shots off
function shotPadAxis(gp){return shotsOn()?shotAxis(shotTrigD(gp,6),shotTrigD(gp,7)):0;}
// both triggers down, the Total Control chord; tested on depth, not `pressed`
function shotChord(lt,rt){return lt>SHOTC.mod.dead&&rt>SHOTC.mod.dead;}

// --- power and tracking ---
function shotAxisTrack(m){const M=SHOTC.mod;return m<0?lerp(1,M.softTrack,-m):lerp(1,M.hardTrack,m);}
// a wind-up on the stick is struck by the stick, not a kick: the shot's trims only with power held (Total Control's chord cancels to none)
function shotStickMod(m){return m>=SHOTC.mod.powAt?SWINGS.shoot:null;}
// --- the HOLD (L2) ---
// the finesse trigger makes the boot sticky (CONFIG.shots.hold); written into the rod's own block, nothing may allocate (read per man per substep)
function shotHoldUpdate(r,lt){
 const H=SHOTC&&SHOTC.hold,h=r.hold;
 if(!h)return;
 // a live wind-up cancels the hold
 if(!(shotsOn()&&H&&H.on)||r.chg>=0||lt<=H.from){h.on=false;return;}
 const t=clamp((lt-H.from)/(1-H.from),0,1);
 h.on=true;
 h.holdRest=lerp(KICK.rest,H.rest,t);
 h.sideRest=KICK.sideRest*lerp(1,H.side!=null?H.side:0,t);   // a squeeze softens a side hit too, smoothly
 h.holdGrip=lerp(stGrip(r),H.grip,t);
 h.carryMult=lerp(1,H.carry,t);
}

// --- the PIN (finesse + raise = back pin, finesse + kick = forward pin) ---
// the input half (CONFIG.shots.pin): may this rod pin, and is it being posed; physics.js pinUpdate / pinBallStep do the catch, carry and releases
// r.pinA is sweep-capped like a wind-up and frozen while a ball is pinned; the forward pose is not (it lies over a ball, which the cap would hold off)
function shotPinInput(r,I,dt){
 const P=SHOTC.pin,H=P&&P.assist&&P.assist.hop,R=P&&P.assist&&P.assist.recv;
 r.fwdR=false;r.pinRl=false;                                   // shotFwdAngle / shotStickPin / shotBackAngle set them again while the pose or the stick receives / drops onto a rolling ball
 if(!P||!P.on){r.pinOn=false;r.pinPose=false;r.pinFwd=false;r.pinMag=null;r.sqA=null;r.pinKh=false;r.fwdStk=0;r.fwdRz=false;return;}
 // finesse held, not finesse's grip: the keyboard grip eases in, which dropped the pose on a chord
 const fin=(I.fin!=null)?I.fin:I.lt>SHOTC.hold.from;
 const rzUp=!!I.rz&&!r.rzWas;r.rzWas=!!I.rz;                   // a raise PRESS picks the back pin; held, it must not undo a forward pose asked for after it
 if(!I.kh)r.pinKh=false;                                       // the kick that posed the forward pin is up
 // kick held first (the swing frozen forward, a ball let under it), then finesse: the forward pin takes the leg over from the swing
 if(fin&&P.fwd.on&&r.kickT>=0&&r.heldFwd&&r.kickHold&&I.kh&&r.chg<0&&!r.pinB&&I.m<=SHOTC.mod.fwdAt){
  r.kickT=-1;r.kickStyle=null;r.passTo=null;r.heldFwd=false;shotDisarm(r);
  r.pinPose=true;r.pinFwd=true;r.pinKh=true;r.fwdKT=-1e9;r.fwdStk=0;   // a hold, never a tap
  if(S.asl)aslHit(r,'fwdTake');
 }
 r.pinOn=fin&&r.chg<0&&r.kickT<0;
 // finesse let go with kick still held: the forward leg stays up (r.fwdRz, rods.js) for a ball to roll under; the kick gives up the pose so finesse again re-poses it
 if(!r.pinOn&&P.fwd.raise&&I.kh&&r.chg<0&&r.kickT<0&&(r.fwdRz||(r.pinPose&&r.pinFwd))){r.fwdRz=true;r.pinKh=false;}else r.fwdRz=false;
 if(!r.pinOn){if(r.pinFwd)r.fwdOut=true;r.pinPose=false;r.pinFwd=false;r.fwdStk=0;}
 else if(I.rz){r.pinPose=true;if(rzUp&&!r.pinB){r.pinFwd=false;r.fwdStk=0;}}   // a ball held under the forward leg keeps its pose
 // kick held with no pose of its own (a rod just taken over, the AI's receiving pose with it, or kick held before finesse with no swing frozen), or a stroke's receive (I.rcv) on a rod with no forward pose: the forward pose, a hold
 else if(!r.pinB&&(I.kh?!r.pinKh:I.rcv&&!(r.pinPose&&r.pinFwd))&&R&&R.on&&R.take&&P.fwd.on&&I.m<=SHOTC.mod.fwdAt){r.pinPose=true;r.pinFwd=true;r.pinKh=!!I.kh;r.fwdKT=-1e9;r.fwdStk=0;if(S.asl)aslHit(r,'fwdTake');}
 const stk=r.fwdStk>S.time&&r.pinPose&&r.pinFwd&&!r.pinB;      // a tapped kick's stroke runs on through the ball
 // unlatched: the pose lasts while its button is held (the other one, still held, takes over), then the leg relaxes to the square, held where it is over a ball in a man's lane; a stroke's receive holds it like the kick
 if(r.pinOn&&r.pinPose&&!r.pinB&&!P.latch&&!stk){
  if(r.pinFwd&&!r.pinKh){
   if(I.rz)r.pinFwd=false;
   else if(H&&H.on&&S.time-(r.fwdKT||0)<H.tap&&(shotFwdAngle(r),r.fwdBlk)){r.fwdStk=S.time+H.stroke;r.fwdBlk=false;if(S.asl)aslHit(r,'kStroke');}   // tapped while the leg was held below a ball: the stroke, the pass
   else if(!I.rcv){r.fwdOut=true;r.pinPose=false;r.pinFwd=false;r.sqA=r.angle;}
  }
  else if(!r.pinFwd&&!I.rz){if(r.pinKh||I.rcv)r.pinFwd=true;else{r.pinPose=false;r.sqA=r.angle;}}
 }
 if(r.pinPose&&!r.pinB)r.pinA=r.pinFwd?(r.fwdStk>S.time?P.fwd.angle:shotFwdAngle(r))*r.kickDir:shotBackAngle(r);
 r.pinMag=(r.pinOn&&(!r.pinPose||(r.pinFwd&&!r.pinB)))?shotStickPin(r):null;   // a stick held over a forward pose: its receive, not the stick, has the leg
 if(!r.pinPose)r.pinFwd=r.pinOn&&(r.pinB?r.pinAt:(r.pinMag!=null?r.pinMag:0))*r.kickDir>0;   // a ball held forward off the stick: kick does not fire the pin shot from it
 r.sqA=(r.pinOn&&!r.pinPose&&r.pinMag==null&&!r.pinB&&!r.padAngleOn)?shotSquare(r):null;
 if(S.asl){if(r.pinRl)aslHit(r,'roll');if(r.sqA!=null)aslHit(r,'square');if(r.pinMag!=null&&r.padAngleOn){if((r.stkRT||0)>S.time)aslHit(r,'recvPose');else if(Math.abs(r.pinMag-r.padAngleTarget)>0.05)aslHit(r,'stick');}}   // the stick receives, or the leg is not where the stick asked
 shotSettle(r,dt||0);
 if(r.fwdOut&&r.angle*r.kickDir<=P.fwd.outA)r.fwdOut=false;
}
// the low ball rel0..rel1 ahead, slower than vmax to the table or to the rod, whose z is nearest a man's (i), within his clearance (or zw if wider), the men counted where the slide has them `lead` s on; null = none (scratch reused)
const _fwb={b:null,i:-1,rel:0,dz:0,fa0:null,fa:null,over:false};
function shotFwdBall(r,rel0,rel1,vmax,zw){
 const P=SHOTC.pin,FE=AIC.catch.fetch,cz=FOOT_BOX.z+BALL_R+AIC.clearMargin+FE.clearPad;
 const o1=clamp(r.offset+r.vz*P.fwd.lead,-r.maxOff,r.maxOff);
 _fwb.b=null;let best=Math.max(cz,zw||0);
 for(const b of S.balls){
  if(b.scored||b.pinR)continue;
  const p=b.m.position,rel=(p.x-r.x)*r.kickDir;
  if(rel<rel0||rel>rel1||p.y>BALL_R+P.yTol||Math.min(b.v.length(),Math.hypot(b.v.x,b.v.z-r.vz))>vmax)continue;
  for(let i=0;i<r.baseZ.length;i++){
   if(r.removedUntil[i]&&r.removedUntil[i]>S.time)continue;
   const dz=Math.min(Math.abs(p.z-(r.baseZ[i]+r.offset)),Math.abs(p.z-(r.baseZ[i]+o1)));
   if(dz<=best){best=dz;_fwb.b=b;_fwb.i=i;_fwb.rel=rel;_fwb.dz=dz;}
  }
 }
 return _fwb.b?_fwb:null;
}
// the forward leg's angle: the AI's receiving pose for a ball coming from behind (r.fwdR: shotSettle draws the man onto its line); up and clear beside a slow ball lying ahead, onto its top once over it and slow (the AI's fetch, from where the man stands); onto the top of a ball rolling along the row at a man; up for a ball rolling in under the toe; else the pose angle
// a rise that would sweep the ball is held where the leg is (r.fwdBlk: shotSettle steps the man off it), and so is a drop to the pose angle through a ball beside the man
function shotFwdAngle(r){
 const W=SHOTC.pin.fwd,A=SHOTC.pin.assist,on=!!(A&&A.on),hop=on&&!!(A.hop&&A.hop.on),L=!!S.asl;
 r.fwdBlk=false;r.fwdU=false;r.fwdR=false;
 if(!W.assist||typeof footAngle!=='function')return W.angle;
 if(on&&shotFwdRecv(r)){
  const to=AIC.catch.recv.angle,a=r.angle*r.kickDir;r.fwdR=true;if(L)aslHit(r,'recvPose');
  if(hop&&to>a&&shotFwdSweep(r,a,to,_fwr.b)){if(L)aslHit(r,'guard');return a;}
  return to;
 }
 const FE=AIC.catch.fetch,h=shotFwdBall(r,FE.near,SHOTC.pin.fwdFront,FE.bailV,on?shotFwdZ():0);
 let to;
 if(h){
  const fa=Math.abs(r.vz)<=(on?A.slideV:FE.slideV)?shotPinContact(h,on?shotFwdLead(r,h.b,h.rel):h.rel,true,on?A.align:FE.alignZ):null;
  to=fa==null?AIC.catch.recv.lift.angle:fa;
  if(L)aslHit(r,'fwdAim');
 }else{
  const fr=on?shotRollAngle(r,1):null;
  if(fr!=null&&r.angle*r.kickDir-fr>=-A.overTol){r.pinRl=true;return fr;}   // the leg is up over it: down onto its top (rods.js drops it at roll.lerp; the ledger reads r.pinRl)
  to=fr!=null?fr:on?shotFwdUnder(r):null;
  if(to==null){const a=r.angle*r.kickDir;if(hop&&a>W.angle&&shotFwdSweep(r,W.angle,a)){if(L)aslHit(r,'guard');return a;}return W.angle;}
  if(L)aslHit(r,fr!=null?'roll':'under');
 }
 if(hop){const a=r.angle*r.kickDir;if(to>a&&shotFwdSweep(r,a,to)){r.fwdBlk=!!h;if(L&&!h)aslHit(r,'guard');return a;}}   // with a ball beside him (fwdBlk) shotSettle's hop steps him off
 return to;
}
// a low ball coming at the rod from behind: the man whose slide reaches the line it arrives on at the foot (fwdBack), the soonest ball first; null = none (scratch reused)
const _fwr={r:null,b:null,i:-1,o:0,t:0};
function shotFwdRecv(r){
 const P=SHOTC.pin,R=P.assist.recv,zl=F.W/2-BALL_R;
 _fwr.b=null;_fwr.r=r;
 if(!R||!R.on)return null;
 let bt=1e9;
 for(const b of S.balls){
  if(b.scored||b.pinR)continue;
  const p=b.m.position,rel=(p.x-r.x)*r.kickDir,vf=b.v.x*r.kickDir;
  if(rel<-R.far||rel>=P.fwdBack||vf<R.minV||p.y>AIC.catch.recv.maxY)continue;
  const t=(P.fwdBack-rel)/vf;
  if(t>=bt)continue;
  const z=clamp(p.z+b.v.z*t,-zl,zl);
  let bi=-1,bo=0,bd=1e9;
  for(let i=0;i<r.baseZ.length;i++){
   if(!manLive(r,i))continue;
   const o=z-r.baseZ[i];
   if(o<-r.maxOff||o>r.maxOff||Math.abs(o-r.offset)>=bd)continue;
   bd=Math.abs(o-r.offset);bi=i;bo=o;
  }
  if(bi<0)continue;
  bt=t;_fwr.b=b;_fwr.i=bi;_fwr.o=bo;_fwr.t=t;
 }
 return _fwr.b?_fwr:null;
}
// where a rolling ball will be once the leg has caught up with it (the ease lag, 1/pin.lower s), either way along x, no nearer than the window
function shotFwdLead(r,b,rel){return Math.max(AIC.catch.fetch.near,rel+b.v.x*r.kickDir/SHOTC.pin.lower);}
// how far off a man's z the forward assist looks: as far as the slide settle draws him (0 = his clearance)
function shotFwdZ(){const T=SHOTC.pin.assist.settle;return T&&T.on?T.z:0;}
// would turning the leg forward from a0 to a1 (rod-local) touch a low ball (not skip), foot box or shin?
function shotFwdSweep(r,a0,a1,skip){
 const pad=SHOTC.pin.assist.hop.pad,reach=BALL_R*FOOT_BOX_REACH+pad,leg=BALL_R+PRAD+pad,yMax=BALL_R+SHOTC.pin.yTol,n=Math.max(1,Math.ceil((a1-a0)/0.04));
 for(const b of S.balls){
  if(b.scored||b.pinR||b===skip)continue;
  const p=b.m.position;
  if(p.y>yMax)continue;
  for(let i=0;i<r.baseZ.length;i++){
   if(!manLive(r,i))continue;
   const mz=r.baseZ[i]+r.offset,dz=p.z-mz;
   if(Math.abs(dz)>FOOT_BOX.z+reach)continue;
   for(let s=1;s<=n;s++){
    const a=(a0+(a1-a0)*s/n)*r.kickDir;
    if(footBoxDist(r,a,i,p.x,p.y,p.z)<=reach)return true;
    const dx=Math.sin(a)*ARM,dy=-Math.cos(a)*ARM,wx=p.x-r.x,wy=p.y-ROD_H,t=clamp((wx*dx+wy*dy)/(ARM*ARM),0,1);
    if(Math.hypot(wx-dx*t,wy-dy*t,dz)<=leg)return true;
   }
  }
 }
 return false;
}
// a ball rolling at a man from ahead, in his lane where it reaches the middle of the window: up so it rolls under the toe, then onto its top once inside (shotFwdLead) with him on its line; null = none
// off his line the toe stays down (it stops the ball, as without the assist) and r.fwdU: shotSettle draws him onto the z it arrives at (_fwu)
const _fwu={b:null,i:-1,rel:0,z:0,dz:0};
function shotFwdUnder(r){
 const P=SHOTC.pin,A=P.assist,U=A.under,FE=AIC.catch.fetch,up=AIC.catch.recv.lift.angle,mid=(FE.near+P.fwdFront)/2;
 _fwu.b=null;
 if(!U||!U.on)return null;
 let best=U.far;
 for(const b of S.balls){
  if(b.scored||b.pinR)continue;
  const p=b.m.position,rel=(p.x-r.x)*r.kickDir,vin=-b.v.x*r.kickDir;
  if(rel<FE.near||rel>best||p.y>BALL_R+P.yTol||vin<U.minV||Math.hypot(b.v.x,b.v.z-r.vz)>P.capV)continue;
  const z=p.z+b.v.z*Math.max(0,(rel-mid)/vin);
  let bd=Math.max(FOOT_BOX.z+BALL_R+AIC.clearMargin+FE.clearPad,shotFwdZ());
  for(let i=0;i<r.baseZ.length;i++){
   if(!manLive(r,i))continue;
   const dz=Math.abs(z-(r.baseZ[i]+r.offset));
   if(dz<=bd){bd=dz;best=rel;_fwu.b=b;_fwu.i=i;_fwu.rel=rel;_fwu.z=z;_fwu.dz=dz;}
  }
 }
 if(!_fwu.b)return null;
 r.fwdU=_fwu.dz>A.align;
 if(r.fwdU)return r.angle*r.kickDir>P.fwd.angle+0.1?up:null;   // a leg already up stays up: coming down now would land on the ball
 const rel=shotFwdLead(r,_fwu.b,_fwu.rel);
 if(rel>P.fwdFront||Math.abs(r.vz)>A.slideV)return up;
 const fa=footAngle(rel,true);
 return fa==null?up:fa;
}
// --- the pin assist (CONFIG.shots.pin.assist) ---
function shotPinContact(h,rel,fwd,align){
 const p=h.b.m.position;
 if(F.W/2-Math.abs(p.z)<=2*BALL_R&&h.dz<=pinSideReach(p))return footAngle(rel,fwd,h.dz,p.y);
 return h.dz<=align?footAngle(rel,fwd):null;
}

// the slow low ball a leg posed back (g -1) or forward (g +1) can come down on: fa0 the angle that puts the foot on its top, fa the same once the man is over it and slow (else null), over = the leg is up past fa0
function shotPinAim(r,g){
 const P=SHOTC.pin,A=P.assist,FE=AIC.catch.fetch;
 if(typeof footAngle!=='function')return null;
 const h=g<0?shotFwdBall(r,P.back,A.near,A.v):shotFwdBall(r,FE.near,P.fwdFront,FE.bailV,shotFwdZ());
 if(!h)return null;
 const pose=shotPinContact(h,h.rel,g>0,A.align);
 h.fa0=pose==null?footAngle(h.rel,g>0):pose;
 h.fa=Math.abs(r.vz)<=A.slideV?pose:null;
 h.over=h.fa0!=null&&(r.angle*r.kickDir-h.fa0)*g>=-A.overTol;
 return h;
}
// the back leg's angle: up and over beside a slow ball lying behind, onto its top once over it and slow; onto the top of a ball rolling along the row at a man; else the pose angle; never swept through a ball (shotPullCap)
function shotBackAngle(r){
 const P=SHOTC.pin,A=P.assist,h=(A&&A.on)?shotPinAim(r,-1):null,L=!!S.asl;
 let to;
 if(!h){
  const fa=(A&&A.on)?shotRollAngle(r,-1):null;
  if(fa!=null&&L)aslHit(r,'roll');
  if(fa!=null&&r.angle*r.kickDir-fa<=A.overTol){r.pinRl=true;return fa*r.kickDir;}   // the leg is up over it: down onto its top (rods.js drops it at roll.lerp)
  to=(fa==null?P.angle:fa)*r.kickDir;
 }else{
  if(L)aslHit(r,'backAim');
  if(h.fa!=null&&h.over)return h.fa*r.kickDir;
  to=A.up*r.kickDir;
 }
 const a=shotPullCap(r,r.angle,to);
 if(L&&Math.abs(a-to)>0.02)aslHit(r,'guard');   // held short of a ball the pose would sweep
 return a;
}
// a low ball rolling along the row behind the rod (g -1) or ahead of it under a forward leg (g +1) at a man, or under his foot now: the angle (rod-local) that puts the foot on its top where it reaches him, the soonest first; null = none
function shotRollAngle(r,g){
 const P=SHOTC.pin,W=P.assist.roll,f=g>0,r0=f?P.fwdBack:P.back,r1=f?P.fwdFront:P.assist.near;
 if(!W||!W.on||typeof footAngle!=='function')return null;
 let bt=W.tMax,fa=null;
 for(const b of S.balls){
  if(b.scored||b.pinR)continue;
  const p=b.m.position,rel=(p.x-r.x)*r.kickDir,vz=b.v.z-r.vz,sp=Math.abs(vz);
  if(rel<r0||rel>r1||p.y>BALL_R+P.yTol||Math.abs(b.v.x)>W.maxVX||Math.abs(b.v.z)<W.minV||sp<1e-3)continue;
  const sg=Math.sign(vz);
  for(let i=0;i<r.baseZ.length;i++){
   if(!manLive(r,i))continue;
   const d=(r.baseZ[i]+r.offset-p.z)*sg;                        // z still to roll to this man's centre
   if(d<-FOOT_BOX.z)continue;                                   // past his foot
   const t=Math.max(0,d-FOOT_BOX.z)/sp;
   if(t>bt)continue;
   const a=footAngle(clamp(rel+b.v.x*r.kickDir*t,r0,r1),f);
   if(a==null)continue;
   bt=t;fa=a;
  }
 }
 return fa;
}
// the right stick with finesse: a pinned ball is held at its angle until the stick goes past upright the other way; a raised leg the stick brings toward a ball's top settles on it; null = the stick has the leg
// pushed forward (assist.recv.stick) with a ball coming from behind it is the receive: the button receive's pose (r.fwdR: shotSettle draws the man onto the line), kept ai.catch.recv.rest once the ball stops so the pin can take it
function shotStickPin(r){
 const A=SHOTC.pin.assist,K=A&&A.stick,R=A&&A.recv;
 if(!A||!A.on||!K||!K.on)return null;
 if(r.pinB){const g=r.pinAt*r.kickDir>0?1:-1;return (!r.padAngleOn||r.padAngleTarget*r.kickDir*g>=-K.keep)?r.pinAt:null;}
 if(!r.padAngleOn)return null;
 const s=r.padAngleTarget*r.kickDir;
 if(R&&R.on&&R.stick>0&&s>=R.stick*KICK.stickA){
  const RV=AIC.catch.recv,to=RV.angle,a=r.angle*r.kickDir;
  if(shotFwdRecv(r)){r.fwdR=true;r.stkRT=S.time+RV.rest;return ((A.hop&&A.hop.on&&to>a&&shotFwdSweep(r,a,to,_fwr.b))?a:to)*r.kickDir;}
  if((r.stkRT||0)>S.time)return to*r.kickDir;
 }
 const g=s<0?-1:1,h=shotPinAim(r,g);
 return (h&&h.fa!=null&&h.over&&(s-h.fa)*g>=-K.win)?h.fa*r.kickDir:null;
}
// the slide settle: a posed leg up beside a ball or over it, the slide input still for `still` s, and the man is drawn onto the ball's z (a ball rolling in from ahead: the z it arrives at, r.fwdU)
// the hop: a forward leg held below a ball it would sweep (r.fwdBlk) steps the man off its z instead, until the leg can go up; the forward leg comes back over at the hop's speed until he is near
// the receive: a ball coming from behind (r.fwdR) draws the man onto its line on every frame the player leaves the slide alone, no wait
function shotSettle(r,dt){
 const A=SHOTC.pin.assist,T=A&&A.settle;
 if(!A||!A.on||!T||!T.on||!r.pinOn||r.pinB){r.stlT=0;r.stlW=null;return;}
 const mv=!(r.stlW!=null&&Math.abs(r.target-r.stlW)<1e-6);   // the target is ours until the player moves it
 r.stlT=mv?0:(r.stlT||0)+dt;
 r.stlW=r.target;
 const fwd=r.pinPose&&r.pinFwd;
 if(r.fwdR&&_fwr.b&&_fwr.r===r){
  if(S.asl&&!mv&&Math.abs(_fwr.o-r.target)>1e-3)aslHit(r,'recvDraw');
  if(mv)return;
  const R=A.recv;r.target+=clamp(_fwr.o-r.target,-R.v*dt,R.v*dt);r.stlW=r.target;
  return;
 }
 const g=r.pinPose?(r.pinFwd?1:-1):((r.padAngleOn&&A.stick.on)?(r.padAngleTarget*r.kickDir<0?-1:1):0);
 if(!g||r.stlT<T.still)return;
 const h=shotPinAim(r,g),hop=!!(A.hop&&A.hop.on);
 let o,v,id='settle';
 if(h&&h.over){
  if(h.dz>T.z)return;
  o=clamp(h.b.m.position.z-r.baseZ[h.i],-r.maxOff,r.maxOff);
  v=(fwd&&hop&&Math.abs(o-r.offset)>A.align+1)?Math.max(T.v,A.hop.v):T.v;
 }
 else if(h&&fwd&&r.fwdBlk&&hop&&S.time-(r.fwdKT||0)>=A.hop.tap){   // a held kick, not a tap (the stroke)
  const FE=AIC.catch.fetch;
  o=clearOffset(r,h.b.m.position.z,FOOT_BOX.z+BALL_R+AIC.clearMargin+FE.clearPad,0);
  if(o==null)return;
  v=A.hop.v;id='hop';
 }else if(!h&&fwd&&r.fwdU&&_fwu.b){o=clamp(_fwu.z-r.baseZ[_fwu.i],-r.maxOff,r.maxOff);v=T.v;id='under';}
 else return;
 if(S.asl&&Math.abs(o-r.target)>1e-3)aslHit(r,id);
 r.target+=clamp(o-r.target,-v*dt,v*dt);
 r.stlW=r.target;
}
// --- the square (CONFIG.shots.square) ---
// finesse held with the leg down: the foot box's face onto the nearest low ball beside a man (ai.js hitAngle); a ball in a man's lane holds the leg where it is; null = rest
function shotSquare(r){
 const Q=SHOTC.square;
 if(!Q||!Q.on||typeof hitAngle!=='function')return null;
 const lane=FOOT_BOX.z+BALL_R-0.1,yMax=BALL_R+SHOTC.pin.yTol,keep=r.sqA!=null?r.sqA:null;
 let best=Q.zMax,rel0=null;
 for(const b of S.balls){
  if(b.scored||b.pinR)continue;
  const p=b.m.position,rel=(p.x-r.x)*r.kickDir;
  if(p.y>yMax||rel<Q.back-2*BALL_R||rel>Q.front+2*BALL_R)continue;
  for(let i=0;i<r.baseZ.length;i++){
   if(r.removedUntil[i]&&r.removedUntil[i]>S.time)continue;
   const dz=Math.abs(p.z-(r.baseZ[i]+r.offset));
   if(dz<lane)return keep;                                     // in a man's lane: turning the foot would sweep it
   if(rel>=Q.back&&rel<=Q.front&&dz<=best){best=dz;rel0=rel;}
  }
 }
 if(rel0==null)return null;
 const a=hitAngle(rel0);
 if(a==null)return keep;
 const t=a*r.kickDir;
 return (keep!=null&&Math.abs(t-keep)<Q.dead)?keep:t;
}
// letting the forward pin go with a ball under the leg: up and forward off it (the AI's flift), not down through it (rods.js)
function shotFwdHold(r){const W=SHOTC.pin.fwd;return shotFwdBall(r,W.holdNear,W.holdFar,W.holdV)!==null;}
// finesse + kick poses the forward pin instead of swinging; true = the press was spent on it (same axis as the old pass: power cancels it, a half trigger is a soft touch)
function shotPinFwdPress(r,m){
 const P=SHOTC.pin,W=P&&P.fwd;
 if(!W||!W.on||!P.on||m>SHOTC.mod.fwdAt||r.chg>=0||r.kickT>=0)return false;
 r.pinPose=true;r.pinFwd=true;r.pinKh=true;r.fwdKT=S.time;r.fwdStk=0;r.pinA=shotFwdAngle(r)*r.kickDir;
 if(S.asl)aslHit(r,'kFwdPin');
 return true;
}
// finesse and kick held: this seat's team-mates stand ready for a ball coming up at them (ai.js recvPossess, assist.recv.mates)
function shotRecvAsk(I){const P=SHOTC.pin,R=P&&P.assist&&P.assist.recv;return !!(R&&R.on&&R.mates&&P.on&&P.fwd.on&&I.fin&&(I.kh||I.rcv)&&I.m<=SHOTC.mod.fwdAt);}
// a kick from the pin is the pin shot (swings.pinShot, trims and all: kickRod arms them); ignores the finesse axis, keeps carryOut of the slide
function shotPinFire(r){
 if(S.asl)aslHit(r,'kPinShot');
 r.pinPose=false;
 kickRod(r,'pinShot');
}
// a pass from the back pin (shots.pin.press): swings.pinPass, the AI's too, aimed where the slide sends it on the next rod ahead (kickRod arms it and readies an AI rod there, recvArm)
function shotPinPass(r){
 if(S.asl)aslHit(r,'kPinPass');
 r.ppS=S.time;                                   // ppS: shotSeatsUpdate arms the seat's receive off it (press.recv)
 r.pinPose=false;
 kickRod(r,'pinPass',shotPinPassAim(r));
}
// the seat on this rod holds power: its power binding, or its pad's RT past mod.powAt
function shotPowHeld(r){const s=seatOf(r);if(!s)return false;const P=s.shotPad;return (typeof bindHeld==='function'&&bindHeld('power',s))||!!(P&&P.live&&P.pw>=SHOTC.mod.powAt);}
// the pad's face buttons on a pinned ball (cfg.padPinBtns): one passes, the other shoots; true = a press was spent on it
function shotPinBtns(r,just){
 const c=cfg.padPinBtns||'sq';
 if(c==='off'||!shotsOn()||!r.pinB||r.kickT>=0)return false;
 const ps=just[c==='ci'?1:2],sh=just[c==='ci'?2:1];
 if(!ps&&!sh)return false;
 shotKickEdge(r,0,!!sh);
 return true;
}
// where the pin pass crosses the team's next rod ahead: the ball's line off the slide it is let go with (ai.js pinSteer, the AI pin pass's own), so the pass assist bends nothing the slide chose; null = no rod ahead
function shotPinPassAim(r){
 const b=r.pinB;if(!b)return null;
 let q=null,qd=1e9;
 for(const o of rods){const d=(o.x-r.x)*r.kickDir;if(o.team===r.team&&d>0&&d<qd){qd=d;q=o;}}
 if(!q)return null;
 const H=r.vzH,v=H?(H[0]+H[1]+H[2]+H[3])/4:r.vz;   // the same four steps pinRelease lets it go with
 const p=b.m.position,zl=F.W/2-BALL_R,th=typeof pinSteer==='function'?pinSteer(v):0;
 return {x:q.x,z:clamp(p.z+Math.tan(th)*(q.x-p.x)*r.kickDir,-zl,zl)};
}
// what the pin shows the player: the ring under the caught ball (fx.js pinMarkUpdate) and the kick plate (hud.js hudPinHint) both ask these
function shotPinBall(s){const r=s&&seatRod(s),b=r&&r.pinB;return b&&!b.scored?b:null;}
function shotPinSeat(){for(let i=0;i<S.seats.length;i++)if(shotPinBall(S.seats[i])&&!seatRod(S.seats[i]).pinFwd)return S.seats[i];return null;}   // the plate is for a ball one kick would shoot, so not one under the forward leg
function shotSnakeSeat(){if(!shotSnakeOn())return null;for(let i=0;i<S.seats.length;i++)if(shotPinBall(S.seats[i])&&seatRod(S.seats[i]).pinFwd)return S.seats[i];return null;}   // ...held under the forward leg, power + kick is the snake
function shotPinPassOn(r){const D=SHOTC.pin.press;return !!(r&&D&&D.on&&D.roles.indexOf(r.role)>=0);}   // ...on the back pin, a kick passes and power + kick shoots
// the plate is live play only, off for a player who switched it off, and off in the tutorial (its own prompt says it)
function shotPinHintOn(){const P=SHOTC.pin,H=P&&P.hint;return !!(shotsOn()&&P&&P.on&&H&&H.on&&cfg.pinHint!==false&&S.phase==='play'&&!S.tut);}
// the snake (swings.snake; shots.pin.fwd.snake switches it): the ball under the forward leg is let go with the slide it was carried at, and the man rolls over the top of the rod onto it from behind (rods.js)
function shotSnakeOn(){const W=SHOTC.pin.fwd;return !!(W&&W.on&&W.snake);}
function shotSnakeFire(r){
 const SN=SWINGS.snake;
 if(S.asl)aslHit(r,'kSnake');
 pinRelease(r,false,SN.carry);
 r.pinPose=false;r.pinFwd=false;r.fwdOut=false;r.fwdStk=0;r.sqA=null;r.pinMag=null;
 kickRod(r,'snake');
}

// --- what the charge is worth ---
// power rises to the sweet band, is flat across it, then falls; control does the same
function shotChgPow(k){
 const T=SWINGS.shoot.charge,s0=T.sweetFrom,s1=T.sweetTo;
 if(k<=s0)return lerp(T.powMin,T.powMax,s0>0?k/s0:1);
 if(k<=s1||s1>=1)return T.powMax;
 return lerp(T.powMax,T.overPow,(k-s1)/(1-s1));
}
function shotChgCtl(k){
 const T=SWINGS.shoot.charge,s0=T.sweetFrom,s1=T.sweetTo;
 if(k<=s0)return lerp(T.ctlMin,1,s0>0?k/s0:1);
 if(k<=s1||s1>=1)return 1;
 return lerp(1,T.overCtl,(k-s1)/(1-s1));
}
// 0 below the band, 1 inside it, 2 past it (fx.js tints from this)
function shotChgBand(k){const C=SWINGS.shoot.charge;return k<C.sweetFrom?0:(k<=C.sweetTo?1:2);}
function shotOver(k){const C=SWINGS.shoot.charge;return C.sweetTo>=1?0:clamp((k-C.sweetTo)/(1-C.sweetTo),0,1);}
// what the wind-up was worth, stamped when it ends: 0 too early, 1 clean, 2 overcooked, 3 no room (blocked outranks the band)
function shotVerdict(r,k){
 const C=SHOTC.charge;
 r.chgEndT=S.time;
 r.chgEndK=Math.max(0,k);
 r.chgEndBand=((r.chgBlock||0)>=C.blockAt)?3:(k<SWINGS.shoot.charge.minFire?0:shotChgBand(k));
}

// --- arming ---
// r.shotOn is all physics.js tests: armed while a charge is live and through a pass or shot (rods.js kickRod), consumed by the first contact (shotConsume)
// SW: the swing whose pow / ctl / exert it carries (null = none), k: the wind-up (-1 = none)
function shotArm(r,SW,k){
 r.shotOn=true;
 r.shotPow=(SW?SW.pow:1)*(k>=0?shotChgPow(k):1);
 r.shotCtl=clamp((SW?SW.ctl:1)*(k>=0?shotChgCtl(k):1),0,1);
 r.shotExert=SW?SW.exert:1;
 r.shotOver=k>=0?shotChgOver(k):0;
}
function shotDisarm(r){r.shotOn=false;r.shotPow=1;r.shotCtl=1;r.shotExert=1;r.shotOver=0;}
// what a charge is worth against the speed cap (physics.js capSpeed, CONFIG.kick.cap.charge): 0 none, 1 across the band, 0 overcooked
function shotChgOver(k){return clamp((shotChgPow(k)-1)/Math.max(1e-6,SWINGS.shoot.charge.powMax-1),0,1);}
// called by collideRod when a contact takes its power: one contact, one shot
// Total Control has no discrete fire (the chord drop only banks the worth), so spend the bank here; gated on r.chgRel, which only the stick path sets
function shotConsume(r){
 if(!r.shotOn)return;
 // Total Control's verdict belongs to the contact; stamped on r.chgRel (what the player released at)
 if(r.chgRel>0){shotVerdict(r,r.chgRel);r.chg=-1;r.chgRel=0;}
 shotDisarm(r);
}
// full teardown (charge, tremble, and the arming unless a swing is in flight); from resetRodRotation and whenever a seat lets go of a rod
function shotReset(r){
 if(!r)return;
 r.chg=-1;r.chgRel=0;r.chgGrace=0;r.chgSrc=null;r.chgA=null;r.chgHeld=0;r.chgSweet=false;r.trem=0;
 r.chgBlock=0;r.chgEndT=null;r.chgEndBand=-1;r.chgEndK=0;   // the blocked reading and the held verdict
 r.shotTrack=1;if(!(r.kickT>=0))shotDisarm(r);   // a swing in flight keeps its trims when the hand leaves the rod
 if(r.hold)r.hold.on=false;
 r.pinOn=false;r.pinPose=false;r.pinA=null;r.pinFwd=false;r.fwdOut=false;r.rzWas=false;r.pinKh=false;r.pinMag=null;r.sqA=null;r.stlT=0;r.stlW=null;
 r.fwdKT=0;r.fwdStk=0;r.fwdBlk=false;r.fwdU=false;r.fwdR=false;r.fwdRz=false;r.ppS=-1e9;r.stkRT=0;   // timestamps too: S.time restarts with the match
 if(r.pinB)pinRelease(r);                         // a pinned ball never outlives the hand holding it
}

// --- the wind-up angle (classic) ---
// the deepest pull-back toward aTo whose swept boot doesn't shove a ball goalward; guard off = the raw target
// the leg moves too (collideRod resolves against the capsule when the foot box misses, sweepClips only tests the box), so shotLegClips asks the same of the capsule
function shotLegClips(r,b,a){
 const SW=AIC.sweep,R=BALL_R+PRAD+SW.pad,p=b.m.position;
 const sa=Math.sin(a),ca=Math.cos(a),dx=sa*ARM,dy=-ca*ARM;
 for(let i=0;i<r.baseZ.length;i++){
  if(r.removedUntil[i]&&r.removedUntil[i]>S.time)continue;
  const pz=r.baseZ[i]+r.offset;
  if(Math.abs(p.z-pz)>R)continue;
  const wx=p.x-r.x,wy=p.y-ROD_H;
  const t=clamp((wx*dx+wy*dy)/(ARM*ARM),0,1);
  const cx=r.x+dx*t,cy=ROD_H+dy*t;
  const nx=p.x-cx,ny=p.y-cy,nz=p.z-pz,d=Math.sqrt(nx*nx+ny*ny+nz*nz);
  if(d>R||d<1e-6)continue;
  if((nx/d)*r.kickDir<-SW.pushDot)return true;      // the shin would drive it toward our own goal
 }
 return false;
}
// how much of the requested pull-back the guard allowed: 1 free, 0 refused (a module field, so it doesn't allocate)
let shotPullOk=1;
function shotPullCap(r,aFrom,aTo){
 const SW=AIC.sweep;
 if(!SW||!SW.on){shotPullOk=1;return aTo;}
 const n=Math.max(1,SW.clampSteps|0);
 let best=aFrom,ok=0;
 for(let s=1;s<=n;s++){
  const a=aFrom+(aTo-aFrom)*(s/n);
  let clip=false;
  for(const b of S.balls){if(b.scored)continue;
   if(sweepClips(r,b,aFrom,a)||shotLegClips(r,b,a)){clip=true;break;}}
  if(clip)break;
  best=a;ok=s/n;
 }
 shotPullOk=ok;
 return best;
}
// updateRods asks once per sim step; null = no authored wind-up
function shotPullAngle(r){return (shotsOn()&&r.chgSrc&&r.chgSrc!=='stick')?r.chgA:null;}
// tracking-rate multiplier for the right-stick angle path; 1 when nothing is held
function shotTrackMult(r){return shotsOn()?(r.shotTrack||1):1;}

// --- firing ---
// every kick without power is the pass
// shotPassPick: not passEval's answer; a human presses now and the assist only bends a pass ~9 degrees (CONFIG.swings.passAssist.bend), so score the same lanes by whether the bend is deliverable; null = the pass leaves unaimed
function shotPassPick(r,bx,bz){
 const P=AIC.pass,A=SWINGS.passAssist,dir=r.team===0?1:-1,maxBend=A.bend*A.pick;
 let best=null;
 for(const o of rods){
  if(o===r||o.team!==r.team)continue;
  const ahead=(o.x-r.x)*dir;
  if(ahead<P.minAhead||ahead>P.maxAhead)continue;
  const obs=laneObs(r.team,bx,o.x);
  for(let i=0;i<o.baseZ.length;i++){
   if(!manLive(o,i))continue;
   const tz=o.baseZ[i]+o.offset;
   const clr=lineClr(obs,bx,bz,o.x,tz);
   if(clr<P.minClear)continue;
   const bend=Math.abs(Math.atan2(tz-bz,Math.max(1e-3,(o.x-bx)*dir)));
   if(bend>maxBend)continue;                       // the assist cannot turn the ball this far
   const score=clr*P.wClear-bend*A.bendCost;
   if(!best||score>best.score)best={rod:o,man:i,x:o.x,z:tz,clr,bend,score};
  }
 }
 return best;
}
// who a pass off the ball nearest the rod is aimed at; null = nobody
function shotPassTarget(r){
 if(!SWINGS.passAssist.aim)return null;
 let best=null,bd=1e9;
 for(const b of S.balls){if(b.scored)continue;const d=Math.abs(b.m.position.x-r.x);if(d<bd){bd=d;best=b;}}
 if(!best)return null;
 return shotPassPick(r,best.m.position.x,best.m.position.z);
}
// one entry point for every button swing off the pin: swings.pass, or swings.shoot with power, charged (k) or not
// owns the flinch rule (a charge can be let go by the trigger or the kick button)
function shotFire(r,shoot,k){
 // a swing in flight can't be re-fired
 if(r.kickT>=0)return;
 const on=shotsOn(),fl=on&&k>=0&&k<SWINGS.shoot.charge.minFire;
 if(!on||fl)k=-1;                            // a flinch is the shot with no wind-up, not a feeble charged one
 kickRod(r,shoot?'shoot':'pass',on&&!shoot?shotPassTarget(r):null,k);
 r.swOver=r.shotOn?(r.shotOver||0):0;         // a charge beats the speed cap for the WHOLE swing (physics.js capSpeed)
 if(S.asl)aslHit(r,fl?'kFlinch':!shoot?'kPass':k>=0?'kCharge':'kShot');
}
// horizontal-only rotation of the outgoing velocity (no energy); own rng stream since it changes an outcome
function shotSpray(b,r){
 const a=SWINGS.spray*(1-clamp(r.shotCtl,0,1));
 if(a<=0)return;
 const th=(RNG.shot()*2-1)*a,cs=Math.cos(th),sn=Math.sin(th),vx=b.v.x,vz=b.v.z;
 b.v.x=vx*cs-vz*sn;b.v.z=vx*sn+vz*cs;
}

// --- what each device says ---
// every device writes a record (source, depth, its half of the axis, hold depth) and one step per seat per frame reads the merge
// a source already holding keeps it; sources: stick (Total Control chord + stick back), rt, kick (cfg.padChargeBtn), key (power binding)
const SHOT_SRCS=['stick','rt','kick','key'];
function shotInNew(){return {live:false,m:0,mt:0,lt:0,lw:0,pw:0,pwl:0,deep:false,TC:false,stick:0,rt:0,kick:false,key:0,rz:false,fin:false,kh:false,rcv:false};}   // m: the axis, LT counted full once latched at the pass depth (deep) · mt: the raw axis (Total Control's tracking) · lw: the last read's LT · pw: RT's raw depth (power held) · pwl: the last read's pw · rz: raise held (the pin pose) · fin: finesse DOWN (not its eased grip) · kh: kick held (the forward pose, unlatched) · rcv: a stroke's receive, finesse alone holding the forward pose
function shotSrcDepth(I,k){return k==='stick'?I.stick:k==='rt'?I.rt:k==='kick'?(I.kick?1:0):k==='key'?I.key:0;}
// one pad read into o; stickD = the right-stick value, -1 fully back .. +1
function shotPadRead(o,gp,TC,stickD){
 const lt=shotTrigD(gp,6),rt=shotTrigD(gp,7),K=SHOTC.mod;
 // LT squeezed to the pass depth counts as full until it is let back past the grip (mod.keep): a relaxing hand keeps its pass, forward pin and receive
 o.deep=!!K.keep&&(lt>=-K.fwdAt||(!!o.deep&&lt>SHOTC.hold.from));
 o.lw=o.lt||0;o.pwl=o.pw||0;
 o.live=true;o.mt=shotAxis(lt,rt);o.m=o.deep?shotAxis(1,rt):o.mt;o.lt=lt;o.pw=rt;o.TC=TC;o.stick=0;o.rt=0;o.kick=false;o.key=0;
 o.rz=gpDown(gp,2);                              // X: raise — with LT held, the pin pose (shotPinInput)
 o.kh=gpDown(gp,0);                              // A: kick held — the forward pose lasts while it is
 o.fin=lt>SHOTC.hold.from;                       // LT squeezed past where its grip starts
 if(TC){const back=Math.max(0,-stickD);if(shotChord(lt,rt)&&back>=SHOTC.charge.stickBack)o.stick=back;}
 else if(SHOTC.charge.needRaise){
  // RT is only the power: X held = classic wind-up ('rt'), stick pulled back = 'stick' wind-up; RT alone winds up nothing
  if(rt>0){
   const back=Math.max(0,-stickD);
   if(back>=SHOTC.charge.stickBack)o.stick=back;
   else if(o.rz)o.rt=rt;
  }
 }else{
  const cb=cfg.padChargeBtn||'rt';
  if(cb==='rt'||cb==='both')o.rt=rt;
  if(cb==='kick'||cb==='both')o.kick=gpDown(gp,0);
 }
 return o;
}
// a pad kick waits at most mod.chord s (w = s waited) for a trigger still on its way down: LT short of the pass depth (the forward pin), RT short of mod.powAt (the shot); false = fire now
function shotChordWait(o,w){
 const C=SHOTC.mod.chord;
 if(!o||!o.live||!(C>0)||w>=C)return false;
 return (o.pw>o.pwl&&o.pw<SHOTC.mod.powAt)||(!o.deep&&o.lt>0&&o.lt>o.lw&&o.m>SHOTC.mod.fwdAt);
}
// the keyboard/mouse half of the axis for a kick pressed now (power - finesse); 0 with shots off
function shotKbmAxis(s){
 if(!shotsOn()||!(SHOTC.kbm&&SHOTC.kbm.on)||typeof bindHeld!=='function')return 0;
 return shotAxis(bindHeld('finesse',s)?1:0,bindHeld('power',s)?1:0);
}
const SHOT_TMP=shotInNew(),SHOT_IN=shotInNew();
// every seat, once per frame after the pads are polled (main.js): merge the pad record with kbm modifiers and step; also drops the wind-up on a rod the seat let go of
function shotSeatsUpdate(dt){
 if(S.photo||!S.seats)return;                  // photo mode freezes everything, a held wind-up included
 const K=SHOTC&&SHOTC.kbm,kOn=!!(K&&K.on)&&typeof bindHeld==='function';
 for(const s of S.seats){
  const r=(!S.freeRoam&&(S.phase==='play'||S.phase==='count')&&!(S.show&&S.show.walk))?seatRod(s):null;   // nothing during the walkout (js/show.js)
  if(s.shotRod&&s.shotRod!==r){shotReset(s.shotRod);rodInputRelease(s.shotRod);}
  s.shotRod=r;s.rcvAsk=false;
  const P=s.shotPad;
  if(!r||!shotsOn()){if(r)shotReset(r);if(P)P.live=false;s.kbmFin=0;s.rzEdge=false;s.rcvT=0;continue;}
  const pw=kOn&&bindHeld('power',s),fn=kOn&&bindHeld('finesse',s),rz=kOn&&bindHeld('raise',s),kh=kOn&&bindHeld('kick',s);
  // a button has no squeeze, so the grip eases in over holdRamp
  s.kbmFin=fn?Math.min(1,(s.kbmFin||0)+dt/Math.max(1e-3,K.holdRamp)):0;
  const I=SHOT_IN,pl=!!(P&&P.live);
  I.live=true;
  I.m=clamp((pl?P.m:0)+shotAxis(fn?1:0,pw?1:0),-1,1);
  I.mt=clamp((pl?P.mt:0)+shotAxis(fn?1:0,pw?1:0),-1,1);
  I.lt=Math.max(pl?P.lt:0,s.kbmFin);
  I.TC=pl&&P.TC;
  // power winds up only with raise held (needRaise)
  I.stick=pl?P.stick:0;I.rt=pl?P.rt:0;I.kick=pl&&P.kick;
  I.key=(pw&&(!SHOTC.charge.needRaise||rz))?1:0;
  // raise from any device (with finesse, the pin pose); s.rzEdge latches a press so a sub-frame tap isn't missed
  I.rz=rz||(pl&&P.rz)||!!s.rzEdge;s.rzEdge=false;
  I.fin=fn||(pl&&P.fin);
  I.kh=kh||(pl&&P.kh);
  // a stroke is a pass: finesse alone keeps the receive on (recv.strokeT) until the ball is pinned or the other team touches it
  const RC=SHOTC.pin&&SHOTC.pin.assist&&SHOTC.pin.assist.recv;
  if(!I.fin||S.lastTouch!==s.team||r.pinB)s.rcvT=0;
  I.rcv=(s.rcvT||0)>S.time;
  s.rcvAsk=shotRecvAsk(I);
  if(S.asl){if(I.rcv&&!I.kh)aslHit(r,'rcvKeep');if(s.rcvAsk)aslHit(r,'mates');}
  shotStep(dt,r,I);
  if((r.fwdStk>S.time||(r.ppS===S.time&&SHOTC.pin.press.recv))&&RC&&RC.on&&RC.strokeT>0)s.rcvT=S.time+RC.strokeT;   // a stroke, or a pin pass sent this frame
  if(P)P.live=false;                             // a pad that stops reporting (unplugged) stops counting
 }
}
// a kick press from any device: the pass, with power held the shot, with a wind-up live its release; Total Control's stick charge is judged at contact
// m: the axis (deep finesse = the forward pin); pw: power held at the press (null = the seat's keys and pad, shotPowHeld)
function shotKickEdge(r,m,pw){
 const k=shotCharge(r),C=SHOTC.charge,p=pw!=null?!!pw:shotPowHeld(r);
 // a ball on the pin, whatever the axis says: on the back pin of a rod that passes (shots.pin.press) a kick passes and power + kick shoots, else the pin shot; under the forward leg power + kick is the snake
 if(r.pinB&&r.kickT<0){
  if(!r.pinFwd){if(!p&&shotPinPassOn(r))shotPinPass(r);else shotPinFire(r);}
  else if(p&&shotSnakeOn())shotSnakeFire(r);
  return;
 }
 if(k>=0&&r.chgSrc&&r.chgSrc!=='stick'&&r.kickT<0){
  shotVerdict(r,k);
  shotFire(r,true,k);
  if(C.tone.on)Au.chargeFire(k,shotChgBand(k)===1);
  return;
 }
 // ...or a wind-up let go a beat ago (fingers lift a frame apart)
 if(k<0&&r.chgGrace>0&&r.chgRel>0&&r.kickT<0){
  const kk=r.chgRel;
  r.chgGrace=0;r.chgRel=0;
  if(S.asl)aslHit(r,'kGrace');
  shotVerdict(r,kk);
  shotFire(r,true,kk);
  if(C.tone.on)Au.chargeFire(kk,shotChgBand(kk)===1);
  return;
 }
 // power outranks finesse; without it finesse + kick is the forward pin
 if(!p&&shotsOn()&&shotPinFwdPress(r,m))return;
 shotFire(r,p||k>=0,k);
}

// --- the per-frame state machine ---
// one pad stepped on its own (what tools/shots-harness.js drives; the game steps the merge in shotSeatsUpdate); frame time, not sim time; true when it fired
function shotPadUpdate(dt,gp,s,r,TC,stickD){
 if(!shotsOn()){shotReset(r);return false;}
 return shotStep(dt,r,shotPadRead(SHOT_TMP,gp,TC,stickD));
}
function shotStep(dt,r,I){
 const C=SHOTC.charge,lt=I.lt,m=I.m;
 r.shotTrack=I.TC?shotAxisTrack(I.mt!=null?I.mt:m):1;
 // the window a let-go wind-up can still be fired in (shotKickEdge)
 if(r.chgGrace>0){r.chgGrace-=dt;if(r.chgGrace<=0){r.chgGrace=0;if(r.chg<0)r.chgRel=0;}}

 // WHO IS HOLDING THE WIND-UP — see SHOT_SRCS above.
 let src=null,depth=0;
 if(C.on&&r.kickT<0&&!r.pinB){   // power on a pinned ball is the pin shot's, not a wind-up (it would drop the pin)
  const own=r.chgSrc?shotSrcDepth(I,r.chgSrc):0;
  if(own>0){src=r.chgSrc;depth=own;}
  else for(let i=0;i<SHOT_SRCS.length;i++){const d=shotSrcDepth(I,SHOT_SRCS[i]);if(d>0){src=SHOT_SRCS[i];depth=d;break;}}
 }

 // release: classic fires a swing; Total Control leaves the charge banked and decaying for the next contact
 let fired=false;
 if(r.chgSrc&&src!==r.chgSrc){
  const k=r.chg,was=r.chgSrc;
  r.chgSrc=null;r.chgA=null;
  if(was!=='stick'&&C.needRaise){
   // letting go is not a shot (needRaise): disarm at once, keep what it was worth for `grace` so a late kick still fires
   r.chgRel=k;r.chgGrace=C.grace;r.chg=-1;
   shotDisarm(r);
  }else if(was!=='stick'){
   const tap=(was==='kick'&&r.chgHeld<C.tapMax);
   // stamp the verdict here (a Total Control chord release isn't the shot); before shotFire, which clears the state
   shotVerdict(r,tap?-1:k);
   // a wind-up let go is the shot; a tap of the kick button that would have held one is the pass unless power is held
   shotFire(r,!tap||shotPowHeld(r),tap?-1:k);
   r.chg=-1;fired=true;
   if(C.tone.on)Au.chargeFire(k,shotChgBand(k)===1);
  }else{
   r.chgRel=k;                                  // Total Control: bank WHAT IT WAS WORTH at the release
   // ...and discharge there: letting the chord go is the release gesture, so the sound belongs here
   if(C.tone.on)Au.chargeFire(k,shotChgBand(k)===1);
  }
 }

 // WIND UP, or bleed off what is left of an abandoned one.
 if(src){
  if(r.chgSrc!==src){r.chgSrc=src;r.chg=Math.max(0,r.chg);r.chgRel=0;r.chgGrace=0;r.chgHeld=0;r.chgSweet=false;r.chgEndT=null;r.chgBlock=0;}
  r.chgHeld+=dt;
  r.chg=clamp(r.chg+C.rate*depth*dt,0,1);
  shotArm(r,src==='stick'?shotStickMod(m):SWINGS.shoot,r.chg);
  // the pull-back deepens with the charge and is fully back by the band's lower edge, so the band is a flat maximum; Total Control authors no angle
  if(src!=='stick'){
   const W=SWINGS.shoot.charge,full=W.pullA*r.kickDir,ask=clamp(W.sweetFrom>0?r.chg/W.sweetFrom:1,0,1);
   r.chgA=shotPullCap(r,r.angle,full*ask);
   // is the swing actually there? both tests: the angle alone reads blocked while the rod eases back, shotPullOk alone fires once it rests on the ball
   const got=Math.abs(full)>1e-4?clamp(r.angle/full,0,1):1;
   const deny=(shotPullOk>=1)?0:clamp(ask-got,0,1);
   r.chgBlock=lerp(r.chgBlock||0,deny,Math.min(1,C.blockLerp*dt));
  }else{r.chgA=null;r.chgBlock=0;}               // Total Control authors no angle: nothing to refuse
 }else if(r.chg>0&&!fired){
  // an abandoned wind-up only fades: the release banks the worth (chgRel) and fades toward an ordinary swing (re-deriving would restore full power on the way down)
  r.chg=Math.max(0,r.chg-C.decay*dt);
  if(r.chg<=0){r.chg=-1;r.chgRel=0;shotDisarm(r);}
  else{
   const f=r.chgRel>0?clamp(r.chg/r.chgRel,0,1):0;
   r.shotOn=true;
   const SW=shotStickMod(m);
   r.shotPow=(SW?SW.pow:1)*lerp(1,shotChgPow(r.chgRel),f);
   r.shotCtl=clamp((SW?SW.ctl:1)*lerp(1,shotChgCtl(r.chgRel),f),0,1);
   r.shotExert=SW?SW.exert:1;
   r.shotOver=shotChgOver(r.chgRel)*f;             // a fading bank beats the cap by less, down to nothing
  }
 }

 // readout: the audio teaches the band (a tick rate, one mark on the way in); tremble amplitude is the overcharge
 if(r.chg>=0){
  const band=shotChgBand(r.chg),blk=r.chgBlock||0,good=(band===1&&blk<C.blockAt);
  if(C.tone.on){
   // fed, not ticked (audio.js owns a held voice that fades itself); drained while the swing is refused so the tone stops with the rod
   Au.chargeFeed(r.chg*(1-blk),band);
   // a blocked wind-up must not earn the band mark; blocked mid-band plays the dull mark
   if(good!==r.chgSweet){r.chgSweet=good;if(good)Au.chargeMark(true);else if(band===2||blk>=C.blockAt)Au.chargeMark(false);}
  }
  const T=C.trem,ov=shotOver(r.chg);
  r.trem=ov>0?T.amp*ov*Math.sin(r.chgHeld*T.hz):0;
 }else r.trem=0;

 // LT also makes the boot sticky (CONFIG.shots.hold); last so it reads this frame's charge
 shotHoldUpdate(r,lt);
 // ...and finesse + raise poses the pin, after the hold for the same reason
 shotPinInput(r,I,dt);

 return fired;
}
// does the kick button still fire on press? false only where the charge was moved onto it (cfg.padChargeBtn)
function shotKickPress(TC){
 if(!shotsOn()||TC||!SHOTC.charge.on||SHOTC.charge.needRaise)return true;   // needRaise: kick is the release, never the hold
 const cb=cfg.padChargeBtn||'rt';
 return cb!=='kick'&&cb!=='both';
}
// live charge for the readouts (fx.js held-rod marker); -1 when nothing is winding up
function shotCharge(r){return (r&&shotsOn()&&r.chg>=0)?r.chg:-1;}
// band of the live charge: -1 none, 0 building, 1 sweet, 2 overcooked
function shotChargeBand(r){const k=shotCharge(r);return k<0?-1:shotChgBand(k);}
// how much of the wind-up the sweep guard is refusing, 0..1 smoothed
function shotChargeBlock(r){return (r&&shotsOn()&&r.chg>=0)?(r.chgBlock||0):0;}
