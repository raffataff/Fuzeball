'use strict';
/* ================= AI ================= */
// --- reaction latency ---
// the AI sees the ball a beat late, from a ring buffer of recent states
const REACT_LEN=Math.max(1,Math.ceil(AIC.reactMax*SIM.hz)+1);
// this rod's own seeded random stream
function aiR(r,a,b){return rngR(rngAi(r.idx),a,b);}
function ensureHist(b){
 let h=b.hist;
 if(!h){h=b.hist=new Array(REACT_LEN);for(let i=0;i<REACT_LEN;i++)h[i]={x:0,y:0,z:0,vx:0,vy:0,vz:0};b.histW=0;}
 return h;
}
// record the ball's state, once per sim step
function ballRecord(b){const h=ensureHist(b),p=b.m.position,v=b.v,s=h[b.histW%REACT_LEN];
 s.x=p.x;s.y=p.y;s.z=p.z;s.vx=v.x;s.vy=v.y;s.vz=v.z;b.histW++;}
function recordBalls(){for(const b of S.balls)ballRecord(b);}
// refill the history after a teleport so the delayed view snaps to the new spot
function primeBallHist(b){const h=ensureHist(b),p=b.m.position,v=b.v;
 for(let i=0;i<REACT_LEN;i++){const s=h[i];s.x=p.x;s.y=p.y;s.z=p.z;s.vx=v.x;s.vy=v.y;s.vz=v.z;}b.histW=REACT_LEN;}
// proxy holding the ball's delayed state; .real is the true ball
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
// a man is live unless a cannonball removed him
function manLive(r,i){return!(r.removedUntil[i]&&r.removedUntil[i]>S.time);}
// could a live foot touch this ball? back = raise-sweep depth
function inFootRange(r,b,back){
 back=(back===undefined)?AIC.footRangeBack:back;
 const dir=r.team===0?1:-1,rel=(b.m.position.x-r.x)*dir;
 if(rel>AIC.underFootFront||rel<-back)return false;
 const hz=FOOT_BOX.z+BALL_R+AIC.clearMargin,bz=b.m.position.z;
 for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;if(Math.abs(bz-(r.baseZ[i]+r.offset))<hz)return true;}
 return false;
}
// --- foot-box geometry ---
// distance from a ball to man i's foot box at angle a, same transform as collideRod
const _fb={nx:0,ny:0,cwx:0,cwy:0};
function footBoxDist(r,a,i,px,py,pz,foff){
 const dir=r.kickDir,sa=Math.sin(a),ca=Math.cos(a);
 const offx=FOOT_BOX_OFF.x,offy=FOOT_BOX_OFF.y*dir;
 const fx=r.x+sa*ARM*FOOT_T,fy=ROD_H-ca*ARM*FOOT_T;
 const bcx=fx+offx*sa+offy*ca,bcy=fy-offx*ca+offy*sa,fz=r.baseZ[i]+(foff===undefined?r.offset:foff);
 const dxw=px-bcx,dyw=py-bcy,dzw=pz-fz;
 const lx=dxw*sa-dyw*ca,ly=dxw*ca+dyw*sa,lz=dzw;                       // world → box-local
 const clx=clamp(lx,-FOOT_BOX.x,FOOT_BOX.x),cly=clamp(ly,-FOOT_BOX.y,FOOT_BOX.y),clz=clamp(lz,-FOOT_BOX.z,FOOT_BOX.z);
 const cdx=lx-clx,cdy=ly-cly,cdz=lz-clz;
 const d=Math.sqrt(cdx*cdx+cdy*cdy+cdz*cdz);
 if(d<1e-4){_fb.nx=dir;_fb.ny=0;}else{_fb.nx=(cdx*sa+cdy*ca)/d;_fb.ny=(-cdx*ca+cdy*sa)/d;}
 _fb.cwx=bcx+clx*sa+cly*ca;_fb.cwy=bcy-clx*ca+cly*sa;
 return d;
}
// --- trap sweep guard ---
// would rotating from a0 to a1 shove the ball toward our own goal?
function sweepClips(r,b,a0,a1){
 const SW=AIC.trap.sweep;
 if(!SW||!SW.on||a0===a1)return false;
 const n=Math.max(2,SW.samples|0),dir=r.kickDir,reach=BALL_R*FOOT_BOX_REACH+SW.pad;
 const p0=b.m.position,step=SW.sweepT/(n-1);
 const w=(a1>a0)?1:-1;                                 // angular direction of the ease; only its SIGN is used
 for(let s=0;s<n;s++){
  const a=a0+(a1-a0)*(s/(n-1)),t=step*s;
  // move the ball along the arc too
  const px=p0.x+b.v.x*t,py=p0.y+b.v.y*t,pz=p0.z+b.v.z*t;
  for(let i=0;i<r.baseZ.length;i++){
   if(!manLive(r,i))continue;
   if(Math.abs(pz-(r.baseZ[i]+r.offset))>FOOT_BOX.z+reach)continue;    // cheap z reject before the transform
   if(footBoxDist(r,a,i,px,py,pz)>reach)continue;                      // this sample never touches the ball
   if(_fb.nx*dir>=-SW.pushDot)continue;                                // impulse goes upfield / sideways / down — safe
   // boot velocity for a unit rotation; only its sign matters
   if((-(_fb.cwy-ROD_H)*w)*_fb.nx+((_fb.cwx-r.x)*w)*_fb.ny<=0)continue; // boot retreating — no shove
   return true;                                                        // this catch would knock the ball back
  }
 }
 return false;
}
// is the ball in reach of a live foot at angle a? (else the trap grabs thin air)
function footHolds(r,b,a){
 const p=b.m.position,reach=BALL_R*FOOT_BOX_REACH;
 for(let i=0;i<r.baseZ.length;i++){
  if(!manLive(r,i))continue;
  if(Math.abs(p.z-(r.baseZ[i]+r.offset))>FOOT_BOX.z+reach)continue;
  if(footBoxDist(r,a,i,p.x,p.y,p.z)<=reach)return true;
 }
 return false;
}
// --- strike gate ---
// predicts whether a boot is on the ball while an aimed swing's power window is open (reach, face, centre); only strikeGate.styles are gated
// rod-local angle T seconds into swing KS; mirrors updateRods
function swingAngleAt(KS,a0,T){
 const rampA0=KS.windup>0?KS.windupA:a0;
 if(T<KS.windup) return a0+(KS.windupA-a0)*(T/KS.windup);
 if(T<KS.strike) return rampA0+(KS.strikeA-rampA0)*((T-KS.windup)/(KS.strike-KS.windup));
 if(T<KS.hold)   return KS.strikeA;
 if(T<KS.drop)   return KS.strikeA*(1-(T-KS.hold)/(KS.drop-KS.hold));
 return 0;
}
// scratch result, no allocation on the kick path
const _sp={ok:false,d:1e9,face:0,dz:0,t:0,man:-1};
function strikeProbe(r,b,style,ks){
 const SG=AIC.strikeGate,KS=ks||styleCfg(style);
 const reach=BALL_R*FOOT_BOX_REACH,zReach=FOOT_BOX.z+reach;
 const n=Math.max(2,SG.samples|0),dir=r.kickDir;
 // skip the windup, the boot moves away from the ball there
 const t0=Math.max(KS.windup,KS.powFrom-SG.lead),t1=Math.max(t0,Math.min(KS.drop,KS.powTo+SG.lag));
 const a0=r.angle/(dir||1);                          // the swing starts from where the rod IS — kickRod's kickA0
 const p=b.m.position,v=b.v,room=r.target-r.offset;
 // exact integral of the exponential friction
 const fr=(p.y<=BALL_R+SG.groundY)?PHY.floorFric:PHY.airFric;
 _sp.ok=false;_sp.d=1e9;_sp.face=0;_sp.dz=0;_sp.t=0;_sp.man=-1;
 for(let s=0;s<n;s++){
  const t=t0+(t1-t0)*(n>1?s/(n-1):0);
  const k=fr>1e-6?(1-Math.exp(-fr*t))/fr:t;
  const px=p.x+v.x*k, pz=p.z+v.z*k;
  const py=Math.max(BALL_R,p.y+v.y*t-0.5*GRAV*t*t);  // ballistic in y, floored — a rolling ball can't sink
  const a=swingAngleAt(KS,a0,t)*dir;                 // rod-local → world, exactly as updateRods writes it
  // lead the slide by the rod's velocity, clamped to the room left to r.target
  const lead=SG.slideLead?clamp(r.slideV*t,Math.min(0,room),Math.max(0,room)):0;
  const foff=r.offset+lead;
  for(let i=0;i<r.baseZ.length;i++){
   if(!manLive(r,i))continue;
   const dz=pz-(r.baseZ[i]+foff);
   if(Math.abs(dz)>zReach+1)continue;                // cheap z reject before the transform
   const d=footBoxDist(r,a,i,px,py,pz,foff);
   const face=_fb.nx*dir;
   const ok=d<=reach+SG.pad && face>=SG.faceDot && Math.abs(dz)<=zReach*SG.zFrac;
   // keep a valid contact, else the closest sample
   if((ok&&!_sp.ok)||(ok===_sp.ok&&d<_sp.d)){_sp.ok=ok;_sp.d=d;_sp.face=face;_sp.dz=dz;_sp.t=t;_sp.man=i;}
  }
 }
 return _sp;
}
// the gate; probes the real ball since reach is physics, not perception; unlisted styles pass
function strikeOn(r,bv,style,ks){
 const SG=AIC.strikeGate;
 if(!SG||!SG.on)return true;
 if(SG.styles.indexOf(style||'kick')<0)return true;
 const b=(SG.useReal&&bv&&bv.real)?bv.real:bv;
 if(!b||b.scored)return false;
 if(b.v.length()>SG.maxBallSpeed){                    // too quick to be PLACED by a soft, aimed swing
  if(dbgLogRod===r)dbgRod(r,'GATE:'+(style||'kick').toUpperCase(),'refused — ball at '+b.v.length().toFixed(0)+'u/s > maxBallSpeed '+SG.maxBallSpeed);
  return false;
 }
 const c=strikeProbe(r,b,style,ks);
 if(!c.ok&&dbgLogRod===r)dbgRod(r,'GATE:'+(style||'kick').toUpperCase(),
  'refused — d='+c.d.toFixed(2)+'/'+(BALL_R*FOOT_BOX_REACH+SG.pad).toFixed(2)
  +' face='+c.face.toFixed(2)+'/'+SG.faceDot+' dz='+c.dz.toFixed(2)
  +'/'+((FOOT_BOX.z+BALL_R*FOOT_BOX_REACH)*SG.zFrac).toFixed(2)+' at t='+c.t.toFixed(3)+' man='+c.man);
 return c.ok;
}
// --- per-ball trap angle ---
// deepest tilt whose sweep is clean, null if the ball is out of reach
function trapAngle(r,b,a0,aT){
 const SW=AIC.trap.sweep,n=Math.max(1,SW.clampSteps|0);
 if(!SW.on)return footHolds(r,b,aT)?aT:null;           // guard off = old fixed-target behaviour
 let best=null;
 for(let s=0;s<=n;s++){
  const a=a0+(aT-a0)*(s/n);
  if(sweepClips(r,b,a0,a))break;                       // first clipping depth ends the walk
  best=a;
 }
 if(best===null)return null;
 if(Math.abs(best-a0)>1e-6&&Math.abs(best-aT)>1e-6&&SW.floor>0&&Math.abs(best-a0)<SW.floor)best=a0;
 return footHolds(r,b,best)?best:null;
}
// --- back guard (CONFIG.ai.backGuard) ---
// last word on an AI rod's back-lift and slide; BGS tallies feed tools/backswing-soak.js
const BGS={lift:0,slide:0,lane:0,retEnter:0,retPin:0,retShot:0,retDrop:0,retEnd:0};   // ret*: the retrieve action's own tallies
// walk the back-swing to aT at offset off against every ball, now and at arrival; null = clear, else the last safe angle
function backHit(r,aT,off,rate){
 const G=AIC.backGuard,a0=r.angle,dir=r.kickDir,k=rate||KICK.raiseLerp;
 const reach=BALL_R*FOOT_BOX_REACH+G.pad,zr=FOOT_BOX.z+reach,ms2=G.maxSpeed*G.maxSpeed;
 const n=clamp(Math.ceil(Math.abs(aT-a0)/G.arcStep),2,G.maxSamples),fMax=G.easeTo;   // the ease never quite arrives: stop at fMax of the way
 let hit=n+1;                                          // first sample index that touches a ball; n+1 = none
 for(const b of S.balls){
  if(b.scored)continue;
  const p=b.m.position,v=b.v;
  if(p.y>G.maxY||v.x*v.x+v.y*v.y+v.z*v.z>ms2)continue;
  let near=false;                                      // cheap reject: no man within reach of this ball's z lane at all
  for(let i=0;i<r.baseZ.length&&!near;i++)if(manLive(r,i)&&Math.abs(p.z-(r.baseZ[i]+off))<=zr+Math.abs(v.z)*G.sweepT)near=true;
  if(!near)continue;
  for(let s=0;s<hit;s++){
   const f=fMax*s/n,a=a0+(aT-a0)*f,t=-Math.log(1-f)/k;
   const px=p.x+v.x*t,py=Math.max(BALL_R,p.y+v.y*t),pz=p.z+v.z*t;
   let touch=false;
   for(let i=0;i<r.baseZ.length&&!touch;i++){
    if(!manLive(r,i))continue;
    const fz=r.baseZ[i]+off;
    let d=1e9;
    if(Math.abs(pz-fz)<=zr){d=footBoxDist(r,a,i,px,py,pz,off);if(d<=reach&&(d<G.deepD||_fb.nx*dir<G.backDot))touch=true;}
    if(!touch&&t>0&&Math.abs(p.z-fz)<=zr){d=footBoxDist(r,a,i,p.x,p.y,p.z,off);if(d<=reach&&(d<G.deepD||_fb.nx*dir<G.backDot))touch=true;}   // …and where it is now
   }
   if(touch){hit=s;break;}
  }
 }
 if(hit>n)return null;
 return hit===0?a0:a0+(aT-a0)*(fMax*(hit-1)/n);
}
// ease rate of the safe-raise lift: the keeper's own, the others' shared one
function srLerp(r){const SR=AIC.safeRaise;return r.role==='GK'&&SR.gkLerp?SR.gkLerp:SR.lerp;}
// a keeper never lifts out of the way of a ball in front of it that is going in
function srGoingIn(r,b){
 const G=AIC.safeRaise.gkIn,dir=r.team===0?1:-1,p=b.m.position,v=-b.v.x*dir;
 if(!G.on||r.role!=='GK'||(p.x-r.x)*dir<=G.rel||v<=G.v)return false;
 return Math.abs(p.z+b.v.z*Math.abs(p.x-(dir>0?-F.L/2:F.L/2))/v)<F.goalHalf+BALL_R;
}
// angle updateRods may ease toward instead of aT; stamps r.lhT when it holds a lift
function backLimit(r,aT,rate,own){
 const G=AIC.backGuard;
 if(!G||!G.on||!G.lift||r.kickT>=0||(seatOf(r)&&!own)||(aT-r.angle)*r.kickDir>=0)return aT;   // own: a human's leg coming back from the forward pin (r.fwdOut) is held clear too
 const h=backHit(r,aT,r.offset,rate);
 if(h===null)return aT;
 BGS.lift++;r.lhT=G.holdT;r.bgT=S.time;
 return h;
}
// would sliding o0 to o1 shove a ball behind the boot? (contact, or the lane while lifted)
function slideBlocked(r,o0,o1){
 const G=AIC.backGuard;
 if(!G||!G.on||!G.slide||o1===o0||r.kickT>=0||r.pinB||r.act==='catch'||r.act==='trap'||r.act==='dribble'||(r.act==='retrieve'&&r.retPh==='pin')||(r.force&&r.role!=='GK')||seatOf(r))return false;
 const dir=r.kickDir,reach=BALL_R*FOOT_BOX_REACH+G.pad,zr=FOOT_BOX.z+reach;
 for(const b of S.balls){
  if(b.scored)continue;
  const p=b.m.position;
  if(p.y>G.maxY||(p.x-r.x)*dir>G.behindRel)continue;
  for(let i=0;i<r.baseZ.length;i++){
   if(!manLive(r,i))continue;
   if(Math.abs(p.z-(r.baseZ[i]+o1))>zr)continue;
   const d1=footBoxDist(r,r.angle,i,p.x,p.y,p.z,o1);
   if(d1>reach||(d1>=G.deepD&&_fb.nx*dir>=G.backDot))continue;
   if(d1<footBoxDist(r,r.angle,i,p.x,p.y,p.z,o0)-1e-4){BGS.slide++;r.bgT=S.time;return true;}
  }
 }
 if(G.lane&&(r.raise||r.act==='safeRaise'||r.angle*dir<-0.05)){
  const aT=KICK.raiseA*dir;
  if(backHit(r,aT,o1)!==null&&backHit(r,aT,o0)===null){BGS.lane++;r.bgT=S.time;return true;}
 }
 return false;
}
// --- retrieve action (CONFIG.ai.retrieve) ---
// slow ball behind the heel: side, lift, over, pin (or drop); retrieveEnd winds it up
function retrieveEnd(r,cd){
 BGS.retEnd++;
 if(r.pinB)pinRelease(r);
 r.pinOn=false;r.pinPose=false;r.pinA=null;r.pinFwd=false;
 r.act=null;r.retPh=null;r.retMan=-1;r.retDir=0;r.retZ=null;r.retCd=cd||0;r.retFl=false;
 r.aiMan=-1;                                           // free the man-index hysteresis for the ordinary re-pick
}
// man nearest the ball's z and the offset that reaches it; null if none can
function retrieveMan(r,bz){
 let bi=-1,bo=0,be=1e9;
 for(let i=0;i<r.baseZ.length;i++){
  if(!manLive(r,i))continue;
  const o=clamp(bz-r.baseZ[i],-r.maxOff,r.maxOff),e=Math.abs(bz-(r.baseZ[i]+o));
  if(e<be){be=e;bi=i;bo=o;}
 }
 return(bi<0||be>AIC.retrieve.reach)?null:{i:bi,o:bo};
}
function retrievePhase(r,ph){
 if(ph==='drop')BGS.retDrop++;
 r.retPh=ph;r.retT=0;
 if(dbgLogRod===r)dbgRod(r,'RETRIEVE','-> '+ph);
}
// one frame of a live retrieve
function retrieveStep(r,best,D){
 const RT=AIC.retrieve,dir=r.kickDir,dt=1/SIM.hz,p=(S.time<(r.retKnow||0)?(best.real||best):best).m.position,bz=p.z,rel=(p.x-r.x)*dir;   // right after a re-seat the rod knows where the ball is
 r.raise=false;r.behindFlag=false;r.aiMan=-1;
 r.retT+=dt;
 const cz=FOOT_BOX.z+BALL_R+AIC.clearMargin+RT.sideMargin;
 const mn=retrieveMan(r,bz);
 if(!mn){retrieveEnd(r,RT.cd);return;}                  // slid out of reach (the ball rolled to a wall)
 if(r.retPh==='side'){
  const up=r.retFl;                                     // a re-seat from a forward pin: the leg stays up and forward while the man steps clear, so either way is free
  if(up){r.pinOn=true;r.pinPose=true;r.pinA=AIC.catch.recv.lift.angle*dir;}
  if(inLaneZ(r,bz,cz)){
   if(!r.retDir){
    // committed once, away from the man on the ball (the near side crosses the lane)
    let nm=-1,nd=1e9;
    for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;const d=Math.abs(bz-(r.baseZ[i]+r.offset));if(d<nd){nd=d;nm=i;}}
    const away=(nm>=0&&r.baseZ[nm]+r.offset-bz<0)?-1:1;
    if(clearOffset(r,bz,cz,away)!=null)r.retDir=away;
    else if(rel<RT.crossRel||up)r.retDir=-away;        // the ball is beyond the reach of a boot sliding past it, or the leg is up: the other way is free
    else{retrieveEnd(r,RT.cd*2);return;}                // otherwise the way clear runs through the ball: give up
   }
   let o=clearOffset(r,bz,cz,r.retDir);
   if(o==null)o=clearOffset(r,bz,cz,0);
   if(o==null){retrieveEnd(r,RT.cd);return;}           // nowhere to stand clear of it
   r.retZ=o;r.target=o;
   if(r.retT>RT.liftT){retrieveEnd(r,RT.cd);}
   return;
  }
  if(r.retZ==null)r.retZ=r.offset;
  r.retFl=false;r.pinOn=false;r.pinPose=false;r.pinA=null;
  retrievePhase(r,'lift');
 }
 if(r.retPh==='lift'){
  // ball rolled back into the lane before the boot was up: start over
  if(r.angle*dir>-0.3&&inLaneZ(r,bz,cz-RT.sideMargin)){retrievePhase(r,'side');r.retDir=0;return;}
  r.raise=true;r.target=(r.retZ!=null)?r.retZ:r.offset;
  if(backHit(r,KICK.raiseA*dir,mn.o)===null)retrievePhase(r,'over');   // the boot is over the ball at the spot we want to stand
  else if(r.retT>RT.liftT){retrieveEnd(r,RT.cd);return;}
  else return;
 }
 if(r.retPh==='over'){
  r.raise=true;r.target=mn.o;
  const err=Math.abs(bz-(r.baseZ[mn.i]+r.offset));
  if(err<RT.alignZ){
   const pin=RT.pin&&rel>SHOT.pin.back+0.2&&(r.aiIQ||r.role==='GK'||!RT.pinIQ||S.time<(r.catUntil||0));
   r.retMan=mn.i;r.retHold=0;retrievePhase(r,pin?'pin':'drop');
  }else if(r.retT>RT.overT){retrieveEnd(r,RT.cd);return;}
  else return;
 }
 if(r.retPh==='pin'){
  r.raise=false;r.retMan=mn.i;
  // foot lands over the ball: a = asin(rel/ARM); the pose leads the boot by pinLead so the catch arms
  const fin=Math.asin(clamp(rel/ARM,-0.95,0.95))*dir;
  r.pinOn=true;r.pinPose=true;r.pinA=r.pinB?r.angle:r.angle+clamp(fin-r.angle,-RT.pinLead,RT.pinLead);
  if(!r.pinB){
   r.target=mn.o;                                       // stay on the ball's z while the leg comes down
   if(r.retT>RT.pinT)retrievePhase(r,'drop');           // it never took: sweep through it instead
   return;
  }
  const carry=AIC.catch.on&&r.role!=='GK';
  if(!r.retHold){BGS.retPin++;if(carry)pinPlayStart(r);}
  r.retHold+=dt;                                        // caught: the pin carries the ball with the rod
  let v=0;
  if(carry)v=pinPlay(r,best,r.retHold,dt,true);         // carried to a way forward, then played (or tapped along the row)
  else{r.target=r.offset;r.pcWhy='keeper';v=(r.retHold>=RT.settleT&&r.cd<=0)?1:0;}   // the keeper plays it where it sits
  if(v===3){retrieveTap(r);return;}
  if(v){
   const f=pinFire(r,best,D,v);                         // the pin shot: releases the pin, pulls back, strikes through
   if(f>0){BGS.retShot++;retrieveEnd(r,RT.cd);}
   else if(f<0)retrievePhase(r,'drop');
  }
  return;
 }
 if(r.retPh==='drop'){
  if(r.pinB)pinRelease(r);
  r.pinOn=false;r.pinPose=false;r.pinA=null;
  r.raise=false;r.target=mn.o;                          // hold the man on the ball while the boot swings forward through it
  if(r.angle*dir>-0.12||r.retT>RT.dropT)retrieveEnd(r,RT.cd);
 }
}
// nearest slide offset where no live foot is within cz of bz; prefer (-1/0/+1) limits the side
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
// z of the live foot nearest bz (where the ball is actually trapped)
function nearestFootZ(r,bz){
 let fz=null;
 for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;const z=r.baseZ[i]+r.offset;if(fz===null||Math.abs(bz-z)<Math.abs(bz-fz))fz=z;}
 return fz;
}
// is any live foot within cz of lane z lz?
function inLaneZ(r,lz,cz){
 for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;if(Math.abs(lz-(r.baseZ[i]+r.offset))<cz)return true;}
 return false;
}
// the teammate behind us about to play ball b forward through us, or null (defences only, behind us and in reach, inside the mate's slide range)
function laneMate(r,b){
 const CL=AIC.clearLane,dir=r.team===0?1:-1,bx=b.m.position.x;
 if(CL.roles&&CL.roles.indexOf(r.role)<0)return null;
 let m=null,md=1e9;
 for(const o of rods){
  if(o===r||o.team!==r.team)continue;
  if((r.x-o.x)*dir<CL.mateBack)continue;                 // must sit behind us, not level or ahead
  if((bx-o.x)*dir<-AIC.footRangeBack)continue;           // ball must be on OUR side of it (within its own back-reach)
  const d=Math.abs(bx-o.x);
  if(d>CL.mateReach)continue;
  if(d<md){md=d;m=o;}
 }
 if(!m)return null;
 for(const o of rods){if(o.team===r.team)continue;if(Math.abs(bx-o.x)<md)return null;}   // an opponent is closer — not ours to clear for
 const bz=b.m.position.z;                                 // …and the mate can actually slide onto it
 if(bz<m.baseZ[0]-m.maxOff-CL.zPad||bz>m.baseZ[m.baseZ.length-1]+m.maxOff+CL.zPad)return null;
 return m;
}
// pick the evade slide direction once and commit it (r.evadeDir) so it can't dither
// real z-drift: step opposite it; otherwise take the minimum-travel escape (clearOffset, prefer 0)
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
// the live threat: the ball nearest this team's own goal
function focusBall(t){
 const gx=t===0?-F.L/2:F.L/2;let fb=null,bd=1e9;
 for(const b of S.balls){if(b.scored)continue;const d=Math.abs(b.m.position.x-gx);if(d<bd){bd=d;fb=b;}}
 return fb;
}
// only AIC.hands rods per team move; the rest hold their lane
// the active pair is nearest the threat in x, on a commit timer; human-held rods are always forced in
function pickActiveRods(dt){
  for(let t=0;t<2;t++){
   S.pairCd[t]-=dt;
   const tr=teamRods(t);
   const forced=[];
   for(let i=0;i<S.seats.length;i++){
    const s=S.seats[i];if(s.team!==t)continue;
    const hr=seatRod(s);if(hr&&tr.indexOf(hr)>=0&&forced.indexOf(hr)<0)forced.push(hr);
   }
   const n=Math.min(Math.max(AIC.hands,forced.length),tr.length);
   const cur=S.active[t]||[];
   const valid=cur.length===n&&cur.every(r=>tr.indexOf(r)>=0)&&forced.every(r=>cur.indexOf(r)>=0);
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
   const pick=forced.slice();
   for(const r of ranked){if(pick.length>=n)break;if(pick.indexOf(r)<0)pick.push(r);}
   S.active[t]=pick;S.pairCd[t]=AIC.pairCommit;
  }
 }
function isActiveRod(r){const a=S.active[r.team];return!a||!a.length||a.indexOf(r)>=0;}
// live opposing men between the ball at bx and target x tx; built once per scan
function laneObs(team,bx,tx,v0){
 const dir=team===0?1:-1,GA=AIC.gapAim,obs=[];
 for(const r2 of rods){
  if(r2.team===team&&r2.act!=='recv')continue;                    // opponents block, and so do the rods of its own team standing ready (the men are down in the lane)
  if((r2.x-bx)*dir<=GA.minAhead||(r2.x-tx)*dir>=0)continue;        // must sit between ball and target (the target's own rod is not in its way)
  const dz=v0?r2.vz*(r2.x-bx)*dir/v0:0;                           // v0: a ball at this speed, so each row is where it is sliding to by the time the ball gets there
  for(let i=0;i<r2.baseZ.length;i++){if(r2.removedUntil[i]&&r2.removedUntil[i]>S.time)continue;obs.push({x:r2.x,z:r2.baseZ[i]+r2.offset+dz});}
 }
 return obs;
}
// how far the line (bx,bz)-(tx,tz) misses the nearest blocker in z; >0 gets through, <0 is covered
function lineClr(obs,bx,bz,tx,tz){
 let clr=1e9;const denom=(tx-bx)||1e-3;
 for(const o of obs){const t=(o.x-bx)/denom,lz=bz+(tz-bz)*t,d=Math.abs(lz-o.z)-AIC.gapAim.blockR;if(d<clr)clr=d;}
 return clr;
}
// the heading (rad) a swing from rod r can place a ball on, off straight ahead; 0 = no limit
function aimCone(r,pass){
 const K=AIC.aimCone;
 if(!K||!K.on)return 0;
 if(pass)return K.pass;
 return K.shot==null?0:assistAng(r,false)+K.shot;
}
// --- pass steer (CONFIG.ai.catch.steer) ---
// the heading (rad) the soft pass swing leaves a ball on for a slide of v u/s (linear between the measured points); the sign follows v
function steerHeading(v){
 const T=AIC.catch.steer.slide,a=Math.abs(v);
 let h=T[T.length-1][1];
 for(let i=1;i<T.length;i++)if(a<=T[i][0]){h=T[i-1][1]+(T[i][1]-T[i-1][1])*(a-T[i-1][0])/(T[i][0]-T[i-1][0]);break;}
 return v<0?-h:h;
}
// the slide (u/s, unsigned) that leaves on heading h; null when the table stops short of it
function steerSlide(h){
 const T=AIC.catch.steer.slide,a=Math.abs(h);
 if(a>T[T.length-1][1]+1e-6)return null;
 for(let i=1;i<T.length;i++)if(a<=T[i][1])return T[i-1][0]+(T[i][0]-T[i-1][0])*(a-T[i-1][1])/(T[i][1]-T[i-1][1]);
 return T[T.length-1][0];
}
// the slide a pass from rod r can hold toward side s (+1 / -1): its top speed, steer.vMax, and what the room left to its end lets it hold for steer.hold
function steerV(r,s){
 const ST=AIC.catch.steer,room=s>0?r.maxOff-r.offset:r.offset+r.maxOff;
 return Math.max(0,Math.min(ST.vMax,DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r),room/ST.hold));
}
// how far off straight (rad) a pass from a pin can leave toward side s
function steerReach(r,s){const ST=AIC.catch.steer;return Math.max(ST.standing,steerHeading(steerV(r,s)));}
// --- run-up for a free pass (CONFIG.ai.catch.steer.free) ---
// a ball a free pass can run at: slow, ahead of the rod by more than the foot's side reaches
function freeBall(r,best){
 const ST=AIC.catch.steer,FR=ST.free;
 if(!ST.on||!FR.on)return false;
 const b=best.real||best,p=b.m.position,rel=(p.x-r.x)*r.kickDir;
 return rel>=FR.relMin&&rel<=FR.relMax&&b.v.length()<=FR.maxBall&&p.y<AIC.lowY;
}
// the fastest slide man mi can run toward side s at a ball resting at bz and still have the room: back off, run up to speed, meet the ball, carry on for the hold and brake; 0 = none
function runV(r,mi,bz,s){
 const ST=AIC.catch.steer,FR=ST.free,a=AIC.slideAccel*stAgil(r),oc=bz-r.baseZ[mi];
 for(let v=Math.min(ST.vMax,DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r));v>=FR.vMin;v-=FR.vStep){
  const os=oc-s*(v*FR.lead+v*v/(2*a)+FR.back),oe=oc+s*(v*(ST.hold-FR.lead)+v*v/(2*a));
  if(Math.abs(os)<=r.maxOff&&Math.abs(oe)<=r.maxOff)return v;
 }
 return 0;
}
// how far off straight (rad) a free pass from rod r can leave toward side s: the best any of its men can run at a ball resting at bz
function freeReach(r,bz,s){
 const FR=AIC.catch.steer.free;let v=0;
 for(let i=0;i<r.baseZ.length;i++)if(manLive(r,i))v=Math.max(v,runV(r,i,bz,s));
 return Math.max(FR.standing,steerHeading(v));
}
// which man runs, and at what slide, to leave on heading th off a ball resting at bz; null when none can
function runPlan(r,bz,th){
 const ST=AIC.catch.steer,FR=ST.free,s=th<0?-1:1,a=AIC.slideAccel*stAgil(r);
 let best=null;
 for(let i=0;i<r.baseZ.length;i++){
  if(!manLive(r,i))continue;
  const vm=runV(r,i,bz,s);if(vm<=0)continue;
  const v=steerSlide(Math.min(Math.abs(th),steerHeading(vm)));if(!v||v<FR.vMin)continue;
  const R=v*FR.lead+v*v/(2*a)+FR.back,os=bz-r.baseZ[i]-s*R,cost=Math.abs(os-r.offset);
  if(!best||cost<best.cost)best={mi:i,s,v,R,os,cost};
 }
 return best;
}
// gap-aware shot evaluation: score target z's across the goal mouth by clearance to the nearest blocker; `obs` can be passed in when scanning many z's
// cone: only the lanes within that heading of straight ahead are scanned, and a lane that misses the mouth is covered
function shotEval(team,bx,bz,obs,cone){
 const dir=team===0?1:-1,goalX=dir>0?F.L/2:-F.L/2,GA=AIC.gapAim;
 const span=F.goalHalf*AIC.aimGoalZ;
 if(!obs)obs=laneObs(team,bx,goalX);
 const n=GA.samples,lanes=[],w=cone?Math.abs(goalX-bx)*Math.tan(Math.min(cone,1.4)):0;
 const lo=cone?bz-w:-span,hi=cone?bz+w:span;
 for(let s=0;s<n;s++){
  const tz=n>1?lo+(hi-lo)*(s/(n-1)):(lo+hi)/2;
  let clr=lineClr(obs,bx,bz,goalX,tz);
  if(cone)clr=Math.min(clr,span-Math.abs(tz));
  lanes.push({tz,clr});
 }
 let best=lanes[0];
 for(const l of lanes){if(l.clr>best.clr+1e-3||(Math.abs(l.clr-best.clr)<=1e-3&&Math.abs(l.tz)<Math.abs(best.tz)))best=l;}
 return {lanes,best,goalX,ox:bx,oz:bz};
}
// --- dribble support ---
// z-gap past the opposing row directly in front of the ball
function fwdClr(team,bx,bz,sl,v0){
 const dir=team===0?1:-1,GA=AIC.gapAim;
 let row=null,rd=1e9;
 for(const o of rods){
  if(o.team===team)continue;
  const ahead=(o.x-bx)*dir;
  if(ahead<=GA.minAhead)continue;
  if(ahead<rd){rd=ahead;row=o;}
 }
 if(!row)return 1e3;                                   // nothing between us and the goal
 let d=1e9;
 const lz=bz+(sl||0)*rd,dz=v0?row.vz*rd/v0:0;                // where a ball leaving at slope sl (z per unit of x) crosses that row, and where the row has slid to by then (ball at speed v0)
 for(let i=0;i<row.baseZ.length;i++){if(!manLive(row,i))continue;d=Math.min(d,Math.abs(lz-(row.baseZ[i]+row.offset+dz)));}
 return (d===1e9?1e3:d)-GA.blockR;
}
// how good is the way forward from (bx,bz)? ATT: the shooting lane; everyone else: the gap past the row in front
function outletClr(r,bx,bz,obs){
 const fwd=fwdClr(r.team,bx,bz);
 if(r.role!=='ATT')return fwd;
 return Math.min(fwd,shotEval(r.team,bx,bz,obs,aimCone(r)).best.clr);
}
// where the dribble takes the ball: outlet from there + centre bonus - distance travelled
// the centre term stops a winger shuffling in place by the end wall
function dribTarget(r,bx,bz,obs){
 const DR=AIC.dribble;
 const mi=(r.dribMan>=0&&r.dribMan<r.baseZ.length&&manLive(r,r.dribMan))?r.dribMan:0;
 const lo=Math.max(-F.W/2+BALL_R+1,r.baseZ[mi]-r.maxOff,bz-DR.range);
 const hi=Math.min(F.W/2-BALL_R-1,r.baseZ[mi]+r.maxOff,bz+DR.range);
 if(hi<=lo)return bz;
 const n=Math.max(2,DR.samples|0);
 let bestZ=bz,bestS=-1e9;
 for(let i=0;i<n;i++){
  const z=lo+(hi-lo)*(i/(n-1));
  const s=outletClr(r,bx,z,obs)+DR.centrePull*(Math.abs(bz)-Math.abs(z))-DR.travelCost*Math.abs(z-bz);
  if(s>bestS){bestS=s;bestZ=z;}
 }
 return bestZ;
}
// is an opponent close enough to take the ball? normalised box test (pressX, pressZ)
function dribPressed(r,bx,bz){
 const DR=AIC.dribble;
 for(const o of rods){
  if(o.team===r.team)continue;
  const dx=Math.abs(o.x-bx);if(dx>DR.pressX)continue;
  for(let i=0;i<o.baseZ.length;i++){if(!manLive(o,i))continue;if(Math.abs(bz-(o.baseZ[i]+o.offset))<DR.pressZ)return true;}
 }
 return false;
}
// best pass from (bx,bz): each live man ahead scored on clear + onward shot, minus a nearness preference; null if nothing beats pass.minClear
function passEval(r,bx,bz,mode){
 const P=AIC.dribble.pass,dir=r.team===0?1:-1,cone=aimCone(r,true),steer=!!mode&&AIC.catch.steer.on,gk=r.role==='GK'&&P.gk&&P.gk.on?P.gk:null;
 let best=null;const per=[];
 for(let ri=0;ri<rods.length;ri++){
  const o=rods[ri];
  if(o===r||o.team!==r.team)continue;
  const ahead=(o.x-r.x)*dir;
  if(ahead<P.minAhead||ahead>P.maxAhead)continue;
  const obs=laneObs(r.team,bx,o.x),run=Math.max(1,(o.x-bx)*dir);
  for(let i=0;i<o.baseZ.length;i++){
   if(!manLive(o,i))continue;
   const tz=o.baseZ[i]+o.offset;
   const th=Math.atan2(tz-bz,run);
   if(gk){if(Math.abs(th)>gk.maxTh)continue;}                     // the keeper does not run at the ball: the man nearest straight ahead
   else if(steer){if(Math.abs(th)>(mode==='pin'?steerReach(r,th<0?-1:1):freeReach(r,bz,th<0?-1:1)))continue;}   // a pass from a pin slides to reach it, a free one runs at the ball
   else if(cone&&Math.abs(th)>cone)continue;                      // beyond what the swing can bend the ball
   const clr=lineClr(obs,bx,bz,o.x,tz);
   if(clr<P.minClear)continue;
   const onward=gk?0:shotEval(r.team,o.x,tz,undefined,aimCone(o)).best.clr;
   const score=gk?Math.min(clr,gk.clrCap)*P.wClear-Math.abs(th)*gk.wTh:clr*P.wClear+onward*P.wOnward-ahead*P.wDist;
   if(!best||score>best.score)best={rod:o,man:i,x:o.x,z:tz,clr,onward,score,th};
   if(!per[ri]||score>per[ri].score)per[ri]={rod:o,man:i,x:o.x,z:tz,score};
  }
 }
 if(best)best.cands=per.filter(Boolean);                       // the best man of every rod with a lane: the ones to get ready
 return best;
}
// cached wrapper, the scan above is the priciest thing the AI does; runs on a cadence (pass.every)
function passPick(r,bx,bz,mode){
 const P=AIC.dribble.pass;
 if(!P.on)return null;
 if((r.passEvT||0)>0&&r.passEvMode===mode)return r.passEv;
 r.passEvT=P.every;r.passEvMode=mode;
 return r.passEv=passEval(r,bx,bz,mode);
}
// --- catch (CONFIG.ai.catch) ---
const CAS={snake:0,enter:0,front:0,behind:0,side:0,meet:0,meetOk:0,tap:0,tapOk:0,tapFail:0,retTap:0,back:0,pin:0,hand:0,shot:0,pass:0,steer:0,run:0,runFire:0,recv:0,recvPin:0,reseat:0,fwdCarry:0,fwdTap:0,carryFirst:0,tapFirst:0,stoppedFetch:0,fetch:0,fetchOk:0,ahead:0,hit:0,hitLoose:0,hitHit:0,hitSent:0,hitOk:0,fwdBrake:0,fwdLift:0,thru:0,thruOk:0,behindOk:0,take:0,rdyWait:0,rdyPass:0,lost:0,flip:0,tt:0,ttGo:0,ttTouch:0,ttLook:0,ttCommit:0,ttStraight:0,ttCut:0,ttShot:0,ttCatch:0,ttGate:0,ttLat:0,ttGoLat:0,ttLoose:0,ttRoll:0,ttBack:0,ttThru:0,ttFwd:0};   // soak tallies (tools/catch-soak.js)
// the way forward from a ball at (bx,bz) leaving at slope sl (z gained per unit of x, 0 = dead ahead): ATT the line to goal and the mouth, everyone else the gap past the row in front
function pinOutlet(r,bx,bz,obs,goalX,sl){
 sl=sl||0;
 if(r.role!=='ATT')return fwdClr(r.team,bx,bz,sl,AIC.catch.shotV);
 const tz=bz+Math.abs(goalX-bx)*sl;
 return Math.min(lineClr(obs,bx,bz,goalX,tz),F.goalHalf*AIC.aimGoalZ-Math.abs(tz));
}
// slide speed a carry reaches
function pinCarryV(r){return DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r)*SHOT.pin.carry;}
// slope a push leaves on when the rod slides at sv: none below minV, or when there is no slide left to keep going through the swing
function pushSlope(r,sv){
 const P=AIC.catch.push,OP=AIC.catch.open&&AIC.catch.open[r.role];
 if(!P.on||(OP&&OP.push===false)||Math.abs(sv)<P.minV)return 0;
 return (sv>0?r.maxOff-r.offset:r.offset+r.maxOff)>=P.room?P.k*sv:0;
}
// the way forward for a push at slide sv from (bx,bz): it leaves from `drift` of slide ahead, on the slope pushSlope gives; -1e9 = no push at this speed
// a hold the snake will shoot (r.pcSn) leaves on the snake's own drift and slope, at any slide
function pushOutlet(r,bx,bz,sv,obs,goalX){
 if(r.pcSn){const SN=AIC.catch.snake;return pinOutlet(r,bx,bz+SN.drift*sv,obs,goalX,SN.k*sv);}
 const sl=pushSlope(r,sv);
 return sl?pinOutlet(r,bx,bz+AIC.catch.push.drift*sv,obs,goalX,sl):-1e9;
}
// a ball held under a forward leg is shot with the snake (CONFIG.ai.catch.snake): the role, the depth it is held at, and a draw once a hold
function snakeHold(r,b){
 const SN=AIC.catch.snake;
 if(!SN||!SN.on||!SHOT.snake||!SHOT.snake.on||SN.roles.indexOf(r.role)<0||b.pinDx<SN.relMin||b.pinDx>SN.relMax)return false;
 if(r.pcSnD==null){const u=SN.use[teamDiff(r.team)];r.pcSnD=u==null||u>=1||rngAi(r.idx)()<u;}
 return r.pcSnD;
}
// ball z the carry heads for, from either side: each z in reach scores its way forward from there (standing, or pushed the way it would be carried: a push leaves at an angle),
// a small pull to the middle and a cost per unit travelled; the z it already heads for gets flipGain, so it only turns round for something clearly better; r.pcOut = the way forward at the winner
function pinTarget(r,b,obs,goalX){
 const CA=AIC.catch,p=b.m.position,mi=b.pinMan,cv=pinCarryV(r);
 const lo=Math.max(-F.W/2+BALL_R+1,r.baseZ[mi]-r.maxOff+b.pinDz,r.pcZ0-CA.slideMax,p.z-CA.range);
 const hi=Math.min(F.W/2-BALL_R-1,r.baseZ[mi]+r.maxOff+b.pinDz,r.pcZ0+CA.slideMax,p.z+CA.range);
 const n=Math.max(2,CA.samples|0);
 let bz=p.z,bs=-1e9;
 r.pcOut=-1e9;
 if(hi<=lo)return bz;
 for(let i=0;i<=n;i++){
  const z=i<n?lo+(hi-lo)*(i/(n-1)):r.pcTz;                        // the last candidate is the one it is already heading for
  if(z==null||z<lo||z>hi)continue;
  const o=pinOutlet(r,p.x,z,obs,goalX,0),op=Math.abs(z-p.z)<CA.arrive?-1e9:pushOutlet(r,p.x,z,z>p.z?cv:-cv,obs,goalX),oo=Math.max(o,op);   // a z it would hold at has no push to judge
  const s=oo+CA.centrePull*(Math.abs(p.z)-Math.abs(z))-CA.travelCost*Math.abs(z-p.z)+(i===n?CA.flipGain:0);
  if(s>bs){bs=s;bz=z;r.pcOut=oo;}
 }
 return bz;
}
function pinPlayStart(r){const p=r.pinB.m.position;r.pcZ0=p.z;r.pcTz=null;r.pcEv=0;r.pcOut=-1e9;r.pcDir=0;r.pcRdy=0;r.pcFwdN=0;r.pcBrk=0;r.pcSgn=0;r.pcTurnT=0;r.ttRoll=null;r.pcSn=false;r.pcSnD=null;}
// the carry's and the tap's look at the lanes, on its own clock (pinPlay and the forward pin's preference both ask)
// fwdTap: under a forward leg the tap is looked at whatever the carry finds (it lands as a back pin, which the carry cannot)
function pinCarryEval(r,b,obs,goalX,tap,fwdTap){
 const CA=AIC.catch,p=b.m.position;
 if(r.pcEv>0)return;
 r.pcEv=CA.reEval;
 const tz=pinTarget(r,b,obs,goalX);
 let nz=Math.abs(tz-p.z)<CA.arrive?null:tz;                        // nowhere better than here: hold, look again next time
 if(nz!=null){
  const sg=Math.sign(nz-p.z);
  if(r.pcTz!=null&&r.pcSgn&&sg!==r.pcSgn&&S.time<r.pcTurnT)nz=r.pcTz;   // it turns round only after it has been going this way a while
  else if(sg!==r.pcSgn){r.pcSgn=sg;r.pcTurnT=S.time+CA.turnT;}
 }
 r.pcTz=nz;
 r.tapPk=(tap&&(r.tapN|0)<CA.tap.maxChain&&(fwdTap||r.pcOut<CA.lineClear))?tapEval(r,b,obs,goalX):null;   // nothing this man can carry it to opens a lane: a neighbouring man may have one
}
// a pinned ball, t seconds held: 0 = keep holding (r.target is set), 1 = shoot it, 2 = pass it (to r.catPk), 3 = tap it along the row to a neighbouring man (r.tapPk; only when `tap` is passed), 4 = start a tic-tac with one (r.ttPk; the same)
// a shot is still (rod slower than fireV, straight on) or a push (rod sliding at minV or more: it leaves at an angle, aimed at the lane it was judged on); r.catSv = the slide speed to keep through the swing
// from under a forward leg a shot is the snake when snakeHold says so (r.pcSn): any slide is carried through it
// lane open: shoot, or pass (CONFIG.ai.catch.open: the keeper and the defence would rather pass). Else carry, either way, to a z whose lane opens, else tap it to a neighbour whose lane is open, else pass to a better-placed mate, else wait for the lanes to move until holdT, then play it
function pinPlay(r,best,t,dt,tap){
 const CA=AIC.catch,PS=AIC.dribble.pass,RV=CA.recv,b=r.pinB,p=b.m.position,goalX=r.kickDir>0?F.L/2:-F.L/2,sv=r.slideV;
 const fwd=r.angle*r.kickDir>RV.fwdMin,fwdTap=fwd&&RV.tap.on&&RV.lift.on&&RV.tap.first;   // under a forward leg a swing play is a re-seat, or a snake; a tap to a neighbour whose lane is open lands as a back pin instead
 const sn=r.pcSn=fwd&&snakeHold(r,b),SN=CA.snake;
 r.pcEv-=dt;r.target=r.offset;r.catSv=0;r.catSl=0;r.catHold=0;
 if(t<CA.settleT)return 0;
 const mull=fwd&&t<RV.settleT&&!r.force;                            // a forward pin is carried a while before anything is played: the AI is looking for a lane
 const obs=laneObs(r.team,p.x,goalX,sn?SN.shotV:CA.shotV),still=Math.abs(sv)<=CA.fireV,sl=sn?SN.k*sv:still?0:pushSlope(r,sv);
 const now=(still&&!sn)?pinOutlet(r,p.x,p.z,obs,goalX,0):pushOutlet(r,p.x,p.z,sv,obs,goalX),open=now>=(sn?SN.clear:CA.lineClear),late=t>=CA.holdT||r.force;   // mid-speed: no heading to judge
 const OP=open&&CA.open?CA.open[r.role]:null;
 if(tap&&!open&&CA.tictac.first&&ttWant(r,b,t,obs,goalX))return 4;   // no shot open: the ball is worked between two men before anything else is tried (a forward pin too: the leg turns up to let it go)
 const pk=((open&&!OP)||mull)?null:passPick(r,p.x,p.z,'pin');
 let v=0;
 if(mull){}
 else if(open){
  if(pk&&OP&&PS.on&&PS.roles.indexOf(r.role)>=0&&pk.score>now*OP.k+OP.b&&strikeOn(r,best,'pass',pinSwing(true))){v=2;r.pcWhy='open-pass';}
  else{v=1;r.pcWhy=sl?'push':'open';}
 }
 else if(pk&&PS.on&&PS.roles.indexOf(r.role)>=0&&(late||pk.score>now*PS.shotBias+PS.bias)&&strikeOn(r,best,'pass',pinSwing(true))){v=2;r.pcWhy=late?'late-pass':'pass';}
 else if(late){v=1;r.pcWhy=r.force?'force':'late';}
 if(pk&&(!open||v===2))recvReady(r,pk.cands);                       // the mates it could pass to get their pose up and a man on the lane
 if(v&&fwd&&(!sn||SN.brake)&&!still&&!late&&RV.fwdBrake){v=0;if(!r.pcBrk){r.pcBrk=1;CAS.fwdBrake++;}}   // a swing play from under a forward leg lets the ball go: not while it is carried at speed (it would roll away); the carry arrives first. The snake keeps its slide
 if(v&&fwdTap&&!late&&(v===2||RV.tap.open)){
  pinCarryEval(r,b,obs,goalX,tap,true);
  if(r.tapPk){if(!r.pcFwdN){r.pcFwdN=1;CAS.fwdTap++;}return 3;}
 }
 if(v===2&&!late){
  // a pass with the lane shut comes after the carry and the tap (a forward leg has to re-seat the ball for a swing play as well)
  if(!open&&(CA.carryFirst||fwd)){
   pinCarryEval(r,b,obs,goalX,tap);
   if(r.tapPk||r.pcTz!=null){v=0;if(!r.pcFwdN){r.pcFwdN=1;CAS[fwd?(r.tapPk?'fwdTap':'fwdCarry'):(r.tapPk?'tapFirst':'carryFirst')]++;}}
  }
  // and a pass waits a moment for its receiver to be ready, holding still (a carry would start the slide that reads as a push lane)
  if(v===2&&!recvReadyNow(pk)){
   if((r.pcRdy=(r.pcRdy||0)+dt)<CA.recv.ready.wait){if(r.pcRdy<=dt*1.5)CAS.rdyWait++;return 0;}
  }else if(v===2)CAS.rdyPass++;
 }
 if(v){
  if(v===2){
   const ST=CA.steer;
   if(ST.on){                                                       // slide through the swing at the speed that leaves on the line to him
    const s=pk.th<0?-1:1,sd=steerSlide(Math.min(Math.abs(pk.th),steerHeading(steerV(r,s))));
    r.catSv=s*(sd||0);r.catHold=ST.hold;CAS.steer++;
   }else if(!still)return 0;                                        // a pass is made standing: let the slide die first
   r.catPk=pk;return 2;
  }
  if(sn){r.catSv=sv;r.catSl=sl;r.catHold=SHOT.snake.spin+SHOT.snake.follow;}   // the snake carries the slide until it strikes, then the rod brakes
  else if(sl){r.catSv=sv;r.catSl=sl;}
  return 1;
 }
 pinCarryEval(r,b,obs,goalX,mull?false:tap,fwdTap&&!mull);
 if(r.tapPk){if(fwdTap&&!r.pcFwdN){r.pcFwdN=1;CAS.fwdTap++;}return 3;}
 if(tap&&!fwd&&!mull&&r.pcTz==null&&r.pcOut<CA.lineClear&&ttWant(r,b,t,obs,goalX))return 4;   // nothing opens a lane by carrying or tapping: work the ball between two men until one does
 if(r.pcTz!=null){
  const mi=b.pinMan,cz=clamp(r.pcTz,r.pcZ0-CA.slideMax,r.pcZ0+CA.slideMax);
  r.target=clamp(cz-b.pinDz-r.baseZ[mi],-r.maxOff,r.maxOff);
  const dn=Math.sign(r.target-r.offset);
  if(dn&&r.pcDir&&dn!==r.pcDir)CAS.flip++;                          // turned round mid-carry
  if(dn)r.pcDir=dn;
 }
 return 0;
}
// the goal lanes with the aim point on the line the shot leaves on: aimAssist bends toward it, so it never pulls a judged lane back toward the middle
function pinAim(r,b,sl){
 sl=sl||0;
 const p=b.m.position,ev=shotEval(r.team,p.x,p.z),dr=r.pcSn?AIC.catch.snake.drift:AIC.catch.push.drift;
 ev.best={tz:p.z+(sl?dr*r.catSv:0)+Math.abs(ev.goalX-p.x)*sl,clr:ev.best.clr};
 return ev;
}
// play a pinned ball: 1 = swing started, 0 = not yet (mid-swing), -1 = the strike gate says the boot would miss
function pinFire(r,best,D,v){
 if(r.kickT>=0)return 0;
 if(v===2)kickRod(r,'pass',{x:r.catPk.x,z:r.catPk.z},pinSwing(true));
 else if(r.pcSn)snakeFire(r);
 else{
  if(r.catSv)r.target=r.offset+r.catSv*AIC.catch.push.lead;       // the strike gate has to see the slide carrying on through the swing
  if(!strikeOn(r,best,'trapShot',pinSwing()))return -1;
  r.catAim=pinAim(r,r.pinB,r.catSl||0);
  r.aimEv=r.catAim;
  kickRod(r,'trapShot',null,pinSwing());
 }
 if(v===2)CAS.pass++;else if(r.pcSn)CAS.snake++;else CAS.shot++;
 CAW['fire:'+r.pcWhy]=(CAW['fire:'+r.pcWhy]||0)+1;
 r.catSw=true;                                                    // the rod keeps its slide speed through the swing, or stands still (aiUpdate)
 r.cd=D.cd*stCd(r)*aiR(r,AIC.cdSlow[0],AIC.cdSlow[1]);
 return 1;
}
// the snake from under a forward leg (shots.js shotSnakeFire, rods.js snakeStep): the ball let go with its slide, the man rolls over the top of the rod onto it from behind; it costs the player's stamina
function snakeFire(r){
 const K=SHOT.snake;
 r.catAim=pinAim(r,r.pinB,r.catSl||0);r.aimEv=r.catAim;
 pinRelease(r,false,K.carry);
 r.shotExert=K.exert;kickRod(r,'snake',null,K);r.shotExert=1;
}
const CAW={};   // why a catch ended
// the run-up for a free pass (r.act='run'): back off to the far side of the ball, slide at it at the speed that leaves on the line to the mate, fire when the man is predicted to be on the ball by the time the boot arrives
// phases: back (to the start, settled) -> run (slide, fire); r.rnS side, r.rnV slide, r.rnMan the man, r.rnTh the heading planned; the swing then holds the slide like a pin pass (catSw)
function runStart(r,best,pk){
 const FR=AIC.catch.steer.free;
 if(!freeBall(r,best)||r.force||(r.rnCd||0)>S.time||Math.abs(pk.th)<=FR.standing)return false;
 const p=(best.real||best).m.position;
 if(Math.abs(p.x-(r.kickDir>0?-F.L/2:F.L/2))<AIC.dribble.ownGoalGuard)return false;
 const pl=runPlan(r,p.z,pk.th);
 if(!pl)return false;
 r.act='run';r.actT=0;r.rnPh='back';r.rnMan=pl.mi;r.rnS=pl.s;r.rnV=pl.v;r.rnTh=pk.th;r.rnPk=pk;CAS.run++;
 recvReady(r,pk.cands);
 return true;
}
// the mate to pass to when the run arrives: the one planned for, where he stands now, else the best pick now; either must still be on the heading the slide leaves on and have a clear lane
function runMate(r,p){
 const FR=AIC.catch.steer.free,PS=AIC.dribble.pass,dir=r.kickDir,pl=r.rnPk,list=[];
 if(pl&&manLive(pl.rod,pl.man))list.push({rod:pl.rod,man:pl.man,x:pl.rod.x,z:pl.rod.baseZ[pl.man]+pl.rod.offset});
 const q=passPick(r,p.x,p.z,'free');if(q)list.push(q);
 for(const m of list){
  const th=Math.atan2(m.z-p.z,Math.max(1,(m.x-p.x)*dir));
  if(Math.abs(th-r.rnTh)>FR.thTol)continue;
  if(lineClr(laneObs(r.team,p.x,m.x),p.x,p.z,m.x,m.z)<PS.minClear)continue;
  return m;
 }
 return null;
}
function runEnd(r,why){
 const FR=AIC.catch.steer.free;
 CAW['run:'+why]=(CAW['run:'+why]||0)+1;
 r.act=null;r.rnPh=null;r.rnCd=S.time+FR.cd;r.target=r.offset;r.aiMan=-1;
}
// one step; 1 = the pass swing started
function runStep(r,best,D,dt){
 const ST=AIC.catch.steer,FR=ST.free,b=best.real||best,p=b.m.position,dir=r.kickDir,rel=(p.x-r.x)*dir;
 r.actT+=dt;r.raise=false;r.behindFlag=false;
 if(r.rnPk&&r.rnPk.rod)recvReady(r,[{rod:r.rnPk.rod,man:r.rnPk.man,z:r.rnPk.rod.baseZ[r.rnPk.man]+r.rnPk.rod.offset}]);   // the mate stays ready through the run
 if(r.actT>FR.abortT||rel<FR.relMin-0.5||rel>FR.relMax+1||b.v.length()>FR.maxBall*2||p.y>AIC.lowY||!manLive(r,r.rnMan)||Math.abs(p.x-(dir>0?-F.L/2:F.L/2))<AIC.dribble.ownGoalGuard){runEnd(r,'gone');return 0;}
 const s=r.rnS,v=r.rnV,mi=r.rnMan,a=AIC.slideAccel*stAgil(r);
 const os=p.z-r.baseZ[mi]-s*(v*FR.lead+v*v/(2*a)+FR.back);
 r.aiMan=mi;
 if(r.rnPh==='back'){
  if(Math.abs(os)>r.maxOff){runEnd(r,'room');return 0;}
  r.target=os;
  if(Math.abs(r.offset-os)<FR.settle&&Math.abs(r.slideV)<FR.settleV)r.rnPh='run';
  else return 0;
 }
 r.target=r.offset+s*v*dt;
 const pred=s*((r.baseZ[mi]+r.offset+r.slideV*FR.lead)-(p.z+b.v.z*FR.lead));
 if(pred>FR.fireMax){runEnd(r,'late');return 0;}
 if(pred<0||s*r.slideV<FR.vTol*v)return 0;
 const pk=runMate(r,p);
 if(!pk){runEnd(r,'mate');return 0;}
 kickRod(r,'pass',{x:pk.x,z:pk.z});
 r.catSw=true;r.catSv=s*v;r.catHold=ST.hold;
 r.cd=D.cd*stCd(r)*aiR(r,AIC.cdSlow[0],AIC.cdSlow[1]);
 CAS.runFire++;
 return 1;
}
// receiving a pass (CONFIG.ai.catch.recv, r.act='recv'): the rod a pass is aimed at holds a forward pin pose while it is in flight, with the man on the ball's line, so the ball is pinned under the leg where the front pin holds it (rel -0.8)
// and the catch plays it; armed by kickRod for every pass (recvArm), over when it is pinned, taken, through, or the flight is over
function recvArm(from,aim){
 const RV=AIC.catch.recv;
 if(!RV||!RV.on)return;
 let rx=null;
 for(const q of rods)if(q.team===from.team&&q!==from&&Math.abs(q.x-aim.x)<0.5){rx=q;break;}
 if(rx){rx.rvT0=S.time;rx.rvFl=Math.abs(rx.x-from.x)/RV.speed;rx.rvUntil=S.time+rx.rvFl+RV.pad+RV.grace;rx.rvZ=aim.z;rx.rvReady=false;rx.rvRestT=0;}
}
// a holder looking at passing gets the mates it could pass to ready, on the lane it is looking at: the pose up and a man on it, held while it keeps looking (RV.ready.hold)
function recvReady(from,cands){
 const RV=AIC.catch.recv,RD=RV.ready;
 if(!RV.on||!RD.on||!cands)return;
 for(const c of cands){
  const q=c.rod;
  if(!q||q===from||q.team!==from.team||RV.roles.indexOf(q.role)<0||isUserRod(q))continue;
  if(((q.rvUntil||0)>S.time&&!q.rvReady)||(q.rvCd||0)>S.time)continue;   // a pass is already on its way to him, or he could not get onto a lane a moment ago
  q.rvReady=true;q.rvUntil=S.time+RD.hold;q.rvZ=c.z;q.rvFl=RD.wait;q.rvLaneT=S.time;
 }
}
// the ball lies in reach of another rod of the team (its foot or its heel): the team has it to play, whoever touched it last
function recvOwn(r,p){
 const RD=AIC.catch.recv.ready;
 if(!RD.feet)return false;
 for(const h of rods){
  if(h.team!==r.team)continue;
  const rel=(p.x-h.x)*h.kickDir;
  if(rel>=RD.ownBack&&rel<=RD.ownFront)return true;
 }
 return false;
}
// the team has the ball behind this rod: the rod stands ready for it, the pose up and a man on the ball's lane, instead of being left raised; at any speed, a pass is pinged fast
// a lane a holder is looking at (recvReady) keeps its say; a human on the team holding finesse and kick (recvAsk) gets it ready for any ball coming up at it, whoever touched it last, straight after a kick that let it go
function recvPossess(r,best){
 const RV=AIC.catch.recv,RD=RV.ready,PS=AIC.dribble.pass;
 if(!RV.on||!RD.on||RV.roles.indexOf(r.role)<0||r.force||((r.rvUntil||0)>S.time&&!r.rvReady))return;
 const b=best.real||best,p=b.m.position,ahead=(r.x-p.x)*r.kickDir;
 const ask=recvAsk(r.team)&&b.v.x*r.kickDir>=RD.trackV;
 if(!ask&&(!RD.possession||(r.rvCd||0)>S.time))return;
 if(ahead<PS.minAhead||ahead>RD.reach||p.y>(ask?RV.maxY:AIC.lowY))return;
 if(!ask&&(b.v.x*r.kickDir<-RD.awayV||(RD.maxBall>0&&b.v.length()>RD.maxBall)||(S.lastTouch!==r.team&&!recvOwn(r,p))))return;
 if(S.time-(r.rvLaneT||-9)>=RD.hold)r.rvZ=p.z;
 r.rvReady=true;r.rvUntil=S.time+RD.hold;r.rvFl=RD.wait;
}
// a human seat of this team holds finesse and kick (shots.js shotRecvAsk): its mates take a ball coming up at them
function recvAsk(t){
 const ss=S.seats;if(!ss)return false;
 for(let i=0;i<ss.length;i++)if(ss[i].team===t&&ss[i].rcvAsk)return true;
 return false;
}
// is the mate a pin pass is for ready: his pose up and a man on the lane (or nothing the holder could wait for: a rod a human holds, one busy with something else)
function recvReadyNow(pk){
 const RV=AIC.catch.recv,RD=RV.ready;
 if(!RV.on||!RD.on||!pk)return true;
 const q=pk.rod;
 if(RV.roles.indexOf(q.role)<0||isUserRod(q)||(q.act&&q.act!=='recv'))return true;
 return q.act==='recv'&&!!q.rvReady&&Math.abs(q.angle*q.kickDir-RV.angle)<RD.tol&&Math.abs(q.baseZ[pk.man]+q.offset-pk.z)<RD.zTol;
}
// a kick that is not a pass (a clearance, a shot): the mates ahead are not receiving it, they let go of the pose and go back up so it can go through; none is readied again for RD.release
function recvRelease(from){
 const RV=AIC.catch.recv,RD=RV.ready,GK=AIC.dribble.pass.gk;
 if(!RV.on||!RD.on)return;
 for(const q of rods){
  if(q.team!==from.team||q===from||!q.rvReady)continue;
  if(from.role==='GK'&&GK&&GK.on){const fb=recvBall(q);if(fb&&fb.v.x*q.kickDir>=RD.trackV&&fb.m.position.y<=RV.maxY)continue;}   // a ball is already running at it from the keeper: it takes it, a lift now would be across its path
  q.rvUntil=0;q.rvCd=S.time+RD.release;
 }
}
// the keeper has no pass and is about to kick plain: a mate standing ready ahead is given gk.readyT to get a man onto the lane (the pass is looked for again every step), then it is let go and the kick waits, at most gk.clearT more, for the mates in the lane to lift out of it
function gkHold(r,bp,speed,dt){
 const GK=AIC.dribble.pass.gk;
 let blocked=false,ready=false;
 if(GK&&GK.on&&r.role==='GK'&&!r.force&&speed<=GK.maxBall){
  for(const q of rods){
   const ahead=(q.x-r.x)*r.kickDir;
   if(q.team!==r.team||ahead<=0||ahead>GK.reach||isUserRod(q))continue;
   if(q.act==='recv'&&q.rvReady)ready=true;
   if(q.angle*q.kickDir>GK.clearA&&inLaneZ(q,bp.z,GK.laneZ))blocked=true;
  }
 }
 if(!blocked&&!ready){r.gkWaitT=0;r.gkClearT=0;return false;}
 if(ready&&(r.gkWaitT=(r.gkWaitT||0)+dt)<GK.readyT){r.passEvT=0;return true;}
 if(!blocked)return false;
 recvRelease(r);
 return(r.gkClearT=(r.gkClearT||0)+dt)<GK.clearT;
}
function recvEnd(r,why){
 CAW['recv:'+why]=(CAW['recv:'+why]||0)+1;
 if(!r.pinB){r.pinOn=false;r.pinPose=false;r.pinA=null;}
 r.act=null;r.rvUntil=0;r.rvReady=false;r.rvRestT=0;r.aiMan=-1;
 if(why==='reach')r.rvCd=S.time+AIC.catch.recv.ready.cd;
}
// the ball a pass in flight toward this rod: the one coming at it fastest from behind
function recvBall(r){
 let bb=null,bv=1;const to=AIC.catch.recv.angle>0?SHOT.pin.fwdFront:0;   // a forward pose takes the ball once it has rolled under the man to the foot
 for(const b of S.balls){if(b.scored)continue;const vf=b.v.x*r.kickDir,rel=(b.m.position.x-r.x)*r.kickDir;if(rel<to&&vf>bv){bv=vf;bb=b;}}
 return bb;
}
function recvStart(r){
 const RV=AIC.catch.recv;
 if(!RV||!RV.on||RV.roles.indexOf(r.role)<0||r.force||(r.rvUntil||0)<=S.time)return false;
 r.act='recv';r.actT=0;r.rvMan=-1;CAS.recv++;
 return true;
}
// a ball the leg has just stopped dead (the front touch kills a pass in one step): slow and against the leg, inside the pin's window, so the pin takes it on the next physics step
function recvRest(r){
 const P=SHOT.pin,fwd=AIC.catch.recv.angle>0;
 for(const b of S.balls){
  if(b.scored||b.pinR)continue;
  const p=b.m.position,rel=(p.x-r.x)*r.kickDir;
  if((fwd?rel>P.fwdBack&&rel<P.fwdFront:rel>P.back&&rel<P.front)&&p.y<=BALL_R+P.yTol&&Math.hypot(b.v.x,b.v.z-r.vz)<=P.capV)return true;
 }
 return false;
}
// one frame; the pose and the man are the action's; a pinned ball goes to the catch's hold. Until the pass has been struck (grace) the man waits where the pass was aimed
function recvStep(r,best,D,dt){
 const RV=AIC.catch.recv,dir=r.kickDir,zl=F.W/2-BALL_R,since=S.time-r.rvT0;
 r.actT+=dt;r.raise=false;r.behindFlag=false;
 if(r.force){recvEnd(r,'force');return;}                              // the whistle is close: the dead-ball push plays it
 if(r.pinB){CAS.recvPin++;r.act='catch';r.catPh='front';r.catT=0;r.rvUntil=0;r.rvReady=false;return;}
 const b=recvBall(r),late=!!b&&-(b.m.position.x-r.x)*dir<=b.v.x*dir*RV.liftT;   // late: the ball is closer than a lift takes, so the pose stays until it has arrived
 if(r.rvReady&&b&&b.v.x*dir>=RV.ready.trackV&&b.m.position.y<=RV.maxY)r.rvUntil=Math.max(r.rvUntil||0,S.time+RV.ready.arrive);
 if((r.rvUntil||0)<=S.time){recvEnd(r,r.rvReady?'idle':'time');return;}
 if(r.rvReady){                                                       // no pass yet: pose up, the man on the lane the holder is looking at, or on the line of a ball already coming at it
  let za=r.rvZ,tAr=RV.ready.reachT;
  if(b&&b.v.x*dir>=RV.ready.trackV&&b.m.position.y<=RV.maxY){tAr=Math.max(0,-(b.m.position.x-r.x)*dir/Math.max(b.v.x*dir,5));za=b.m.position.z+b.v.z*tAr;}
  const m=catchMan(r,clamp(za,-zl,zl),tAr);
  if(m){r.rvMan=m.i;r.rvO=m.o;}
  if(r.rvMan<0){recvEnd(r,'reach');return;}
  r.aiMan=r.rvMan;r.target=clamp(r.rvO,-r.maxOff,r.maxOff);
  r.pinOn=true;r.pinPose=true;r.pinA=RV.angle*dir;
  return;
 }
 let za=r.rvZ,tAr=r.rvFl||0.3;
 if(b){
  const p=b.m.position,rel=(p.x-r.x)*dir,vf=b.v.x*dir;
  if(since>=RV.grace&&S.lastTouch!==r.team){recvEnd(r,'taken');return;}
  if(p.y>RV.maxY&&!late){recvEnd(r,'through');return;}
  tAr=Math.max(0,-rel/Math.max(vf,5));za=p.z+b.v.z*tAr;
 }else if(since>=RV.grace){
  if(!recvRest(r)||S.time-(r.rvRestT||(r.rvRestT=S.time))>=RV.rest){recvEnd(r,'through');return;}
  r.target=r.offset;r.pinOn=true;r.pinPose=true;r.pinA=RV.angle*dir;   // stopped against the leg: held for the pin
  return;
 }
 const m=catchMan(r,clamp(za,-zl,zl),tAr);
 if(m){r.rvMan=m.i;r.rvO=m.o;}
 if(r.rvMan<0){recvEnd(r,'reach');return;}
 r.aiMan=r.rvMan;r.target=clamp(r.rvO,-r.maxOff,r.maxOff);
 r.pinOn=true;r.pinPose=true;r.pinA=RV.angle*dir;
}
// a ball held under a FORWARD leg (the receiving pose) is behind the foot: a swing would sweep the boot back through it, or miss it. It is carried and tapped as it is; to play it with a swing it is let go and retrieve re-pins it from behind
function reseat(r){
 CAS.reseat++;
 if(r.pinB&&AIC.catch.fetch.on&&r.pinB.pinDx>AIC.catch.fetch.aheadMin){aheadStart(r);return;}   // held ahead of the rod, not under it: the man slides away, lowers and comes back to it
 if(AIC.catch.recv.lift.on){fliftStart(r,'retrieve');return;}
 reseatGo(r);
}
function reseatGo(r){
 const RV=AIC.catch.recv;
 catchEnd(r,0,'reseat');
 r.act='retrieve';r.actT=0;r.retDir=0;r.retZ=null;r.retMan=-1;r.catUntil=S.time+AIC.catch.behind.keepIQ;BGS.retEnter++;
 r.retFl=RV.lift.on&&r.angle*r.kickDir>RV.fwdMin;r.retKnow=S.time+RV.lift.know;   // the leg stays up while the man steps clear; the rod just held the ball, so it reads the real one
 retrievePhase(r,'side');
}
// leaving a forward pin (catPh 'flift', recv.lift): the leg turns up and forward and the pin lets go by itself; the ball stays put after a re-seat (braked first) or leaves at carryOut of a tap's slide
function fliftStart(r,next){
 r.catPh='flift';r.catT=0;r.flNext=next;r.flMan=r.aiMan;CAS.fwdLift++;
}
function fliftStep(r){
 const CA=AIC.catch,FL=CA.recv.lift,dir=r.kickDir,tap=r.flNext==='tap';
 r.pinOn=true;r.pinPose=true;r.aiMan=r.flMan;
 if(r.pinB){
  if(r.catT>FL.abortT){pinRelease(r);}                              // it never let go: the old way
  else{
   r.target=tap?clamp(r.offset+r.tapS*CA.tap.run,-r.maxOff,r.maxOff):r.offset;
   if(!tap&&Math.abs(r.slideV)>FL.restV)r.pinA=r.angle;             // still sliding: hold the pose until it has stopped
   else r.pinA=FL.angle*dir;
   return;
  }
 }
 r.target=r.offset;r.pinA=FL.angle*dir;
 if(r.angle*dir<FL.done&&r.catT<=FL.abortT)return;
 if(tap)tapSide(r,false);else if(r.flNext==='hit')hitGo(r);else reseatGo(r);
}
function catchEnd(r,cd,why){
 if(why)CAW[why]=(CAW[why]||0)+1;
 if(r.tapPend){CAS.tapFail++;r.tapPend=false;}                    // a tap that never ended in a pin
 if(r.ttOn){r.ttOn=false;r.ttPh=null;r.ttCd=S.time+AIC.catch.tictac.cd;}
 if(r.pinB)pinRelease(r);
 r.pinOn=false;r.pinPose=false;r.pinA=null;r.pinFwd=false;r.ftPh=null;
 r.act=null;r.catPh=null;r.catMan=-1;r.catCd=cd||0;
 r.tapN=0;r.tapPk=null;r.catCush=false;r.catDeep=false;r.tapF=false;r.catFwd=false;r.rvRestT=0;r.hPh=null;r.tapHit=false;
 r.aiMan=-1;                                                      // free the man-index hysteresis for the ordinary re-pick
}
// the man that can stand under a ball arriving at za in tAr s, and the slide offset that does it; null if none can
const _cm={i:-1,o:0};
function catchMan(r,za,tAr){
 const CA=AIC.catch,sp=DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r)*CA.slideUse;
 let be=1e9;_cm.i=-1;
 for(let i=0;i<r.baseZ.length;i++){
  if(!manLive(r,i))continue;
  const o=clamp(za-r.baseZ[i],-r.maxOff,r.maxOff),e=Math.abs(za-(r.baseZ[i]+o));
  if(e>CA.zTol||Math.abs(o-r.offset)>sp*tAr+CA.zTol)continue;
  if(e<be){be=e;_cm.i=i;_cm.o=o;}
 }
 return _cm.i<0?null:_cm;
}
// tap: a neighbouring man the held ball could be sent to, and the way forward from where it will end up (the receiving man drifts along with it): {j,s,out} or null
function tapEval(r,b,obs,goalX){
 const CA=AIC.catch,TP=CA.tap,p=b.m.position,mi=b.pinMan,zl=F.W/2-BALL_R-1;
 const fb=r.angle*r.kickDir>CA.recv.fwdMin?TP.fwd:null;              // a forward leg holds the ball further back and nearer the pivot
 if(!TP||!TP.on||TP.roles.indexOf(r.role)<0||(fb?(b.pinDx<fb.min||b.pinDx>fb.max):((b.pinDx<TP.relMin||b.pinDx>TP.relMax)&&!(TP.deep&&TP.deep.on&&b.pinDx>=TP.deep.min&&b.pinDx<=TP.deep.max))))return null;
 let best=null;
 for(let s=-1;s<=1;s+=2){
  const j=mi+s;
  if(j<0||j>=r.baseZ.length||!manLive(r,j))continue;
  const zB=r.baseZ[j]+r.offset,d=(zB-p.z)*s;
  if(d<TP.minD||d>TP.maxD||(s>0?r.maxOff-r.offset:r.offset+r.maxOff)<TP.room)continue;
  const out=pinOutlet(r,p.x,clamp(zB+s*TP.drift,-zl,zl),obs,goalX,0);
  if(out>=CA.lineClear&&(!best||out>best.out))best={j:j,s:s,out:out};
 }
 return best;
}
function tapStart(r){
 const pk=r.tapPk,RV=AIC.catch.recv,b=r.pinB;r.tapPk=null;
 r.catT=0;r.tapS=pk.s;r.tapJ=pk.j;
 if(b&&hitOk(r,b)){hitStart(r,b);return;}                            // the man's side knocks it along the row
 r.catPh='tap';
 r.tapF=!!(RV.lift.on&&b&&r.angle*r.kickDir>RV.fwdMin);             // under a forward leg: it lets go by turning up
}
// the ball is away: the rod brakes and the receiving man takes it as a side catch
function tapSide(r,deep){
 r.pinOn=false;r.tapF=false;r.catFwd=!!r.tapAhead;r.tapAhead=false;   // the receiver pins it as usual (shot-ready), or under a forward leg when it rolls ahead of the rod; the pose is let go by the side phase's next frame: dropping it now would swing the boot forward through the ball
 r.target=r.offset;
 r.catPh='side';r.catMan=r.tapJ;r.catSg=r.tapS;r.catCush=false;r.catT=0;r.tapN=(r.tapN|0)+1;r.tapPend=true;CAS.tap++;r.tbEv=0;r.catDeep=deep;
}
// one frame of the tap: the rod runs along the row with the ball still pinned, lets go at speed (it leaves at carryOut of the slide), brakes, and the receiving man takes it as a side catch
function tapStep(r,best){
 const CA=AIC.catch,TP=CA.tap,b=r.pinB,s=r.tapS;
 if(!b||r.force||r.catT>TP.abortT){catchEnd(r,CA.cd,!b?'tap:lost':r.force?'tap:force':'tap:time');return;}
 r.pinOn=true;r.pinPose=true;r.pinA=r.angle;r.aiMan=b.pinMan;
 r.target=clamp(r.offset+s*TP.run,-r.maxOff,r.maxOff);
 if(r.slideV*s<TP.releaseV*pinCarryV(r))return;
 const ahead=b.pinDx>CA.side.aheadMin;                                 // held ahead of the rod (a fetch): the leg is already clear of it, so it lets go as it is and the next man takes it under a forward leg
 if(r.tapF&&!ahead){fliftStart(r,'tap');return;}                    // the leg turns up and the pin lets go while the rod runs on
 const deep=b.pinDx<CA.side.back;
 r.tapAhead=ahead;
 pinRelease(r);
 tapSide(r,deep);
}
// hit: the tap proper (CONFIG.ai.catch.hit). The man's SIDE knocks a ball along the row to a neighbour, from whatever depth the foot reaches it: the leg turns, forward or back, to the angle that puts the foot box's face on the ball
// the angle (rod-local) that centres the foot box's face on a ball rel ahead of the rod, null if it cannot be squared within `fit` of the face
function hitAngle(rel){
 let best=0,bs=1e9;
 for(let a=-1.3;a<=1.3;a+=0.02){
  const sa=Math.sin(a),ca=Math.cos(a),fx=sa*ARM*FOOT_T,fy=ROD_H-ca*ARM*FOOT_T,bcx=fx+FOOT_BOX_OFF.x*sa+FOOT_BOX_OFF.y*ca,bcy=fy-FOOT_BOX_OFF.x*ca+FOOT_BOX_OFF.y*sa;
  const dx=rel-bcx,dy=BALL_R-bcy,sc=Math.max(Math.abs(dx*sa-dy*ca)/FOOT_BOX.x,Math.abs(dx*ca+dy*sa)/FOOT_BOX.y);
  if(sc<bs){bs=sc;best=a;}
 }
 return bs<=AIC.catch.hit.fit?best:null;
}
// z the man stands at to run at a ball bz (the neighbour is on the s side): off it by the foot's reach and the run-up
function hitStand(r,mi,bz,s){
 const HT=AIC.catch.hit;
 return bz-s*(FOOT_BOX.z+BALL_R+AIC.clearMargin+HT.pad+HT.runUp)-r.baseZ[mi];
}
// room to step off the ball and run at it, with the neighbour still clear of it where the man stands (the rod carries him toward it)
function hitFits(r,mi,j,s,bz){
 const HT=AIC.catch.hit,cz=FOOT_BOX.z+BALL_R+AIC.clearMargin+HT.pad,o0=hitStand(r,mi,bz,s),o1=bz-s*(FOOT_BOX.z+BALL_R)-r.baseZ[mi]+s*HT.brakeD;
 return Math.abs(o0)<=r.maxOff&&Math.abs(o1)<=r.maxOff&&(r.baseZ[j]+o0-bz)*s>=cz+HT.jGap;
}
// is this held ball one to knock along the row with the side: at a depth the neighbour can take it and the foot reaches, room to step off and run at it; then by chance
function hitOk(r,b){
 const CA=AIC.catch,HT=CA.hit;
 if(!HT||!HT.on||HT.roles.indexOf(r.role)<0)return false;
 const p=b.m.position,rel=b.pinDx,s=r.tapS,mi=b.pinMan;
 if(r.angle*r.kickDir>CA.recv.fwdMin&&rel<CA.side.aheadMin&&!CA.recv.lift.on)return false;   // flush under a forward leg it can only be let go by turning up
 let ok=false;
 for(const bd of HT.bands)if(rel>=bd[0]&&rel<=bd[1])ok=true;
 if(!ok||hitAngle(rel)==null||!hitFits(r,mi,r.tapJ,s,p.z))return false;
 return rngAi(r.idx)()<HT.share;
}
function hitStart(r,b){
 const CA=AIC.catch;
 r.hMan=b.pinMan;r.hA=null;r.hDeep=b.pinDx<CA.side.back;r.hAhead=b.pinDx>CA.side.aheadMin;r.tapHit=true;CAS.hit++;
 if(r.angle*r.kickDir>CA.recv.fwdMin&&!r.hAhead){fliftStart(r,'hit');return;}   // flush under a forward leg: it lets go by turning up
 r.catPh='hit';r.hPh='rest';r.hT=0;
}
// the leg is up and the ball let go at rest: the man steps off it
function hitGo(r){r.catPh='hit';r.hPh='clear';r.hT=0;}
// a loose ball lying at rest between two men, within the foot's side reach and with no shot open, is knocked to the neighbour whose lane is open: the AI making space for itself instead of kicking it
// (the man steps off, squares the foot onto it, slides into it); the decision is made once a LS.every, not every frame
function hitLoose(r,best){
 const CA=AIC.catch,HT=CA.hit,LS=HT.loose,rb=best.real||best,p=rb.m.position,dir=r.kickDir,rel=(p.x-r.x)*dir,gx=dir>0?F.L/2:-F.L/2,cz=FOOT_BOX.z+BALL_R+AIC.clearMargin+HT.pad,zl=F.W/2-BALL_R-1;
 if(!HT.on||!LS||!LS.on||HT.roles.indexOf(r.role)<0||(r.htT||0)>S.time||p.y>=AIC.lowY||rb.v.length()>LS.maxV)return false;
 let ok=false;
 for(const bd of HT.bands)if(rel>=bd[0]&&rel<=bd[1])ok=true;
 if(!ok||hitAngle(rel)==null)return false;
 let lo=-1;
 for(let i=0;i<r.baseZ.length;i++){
  if(!manLive(r,i))return false;                                    // a man gone: the row is not what the lanes assume
  const z=r.baseZ[i]+r.offset;
  if(Math.abs(p.z-z)<cz)return false;                               // a man is on it: that is the fetch's and the retrieve's
  if(z<p.z)lo=i;
 }
 if(lo<0||lo>=r.baseZ.length-1)return false;                         // it lies outside the men: nobody to send it to
 const obs=laneObs(r.team,p.x,gx,CA.shotV);
 if(pinOutlet(r,p.x,p.z,obs,gx,0)>=CA.lineClear)return false;       // a shot is open where it lies: that is the kick's
 let bs=null;
 for(let s=-1;s<=1;s+=2){
  const mi=s>0?lo:lo+1,j=mi+s;
  if(!hitFits(r,mi,j,s,p.z))continue;
  const out=pinOutlet(r,p.x,clamp(r.baseZ[j]+hitStand(r,mi,p.z,s)+s*CA.tap.drift,-zl,zl),obs,gx,0);
  if(out>=CA.lineClear&&(!bs||out>bs.out))bs={mi,j,s,out};
 }
 const tp=ttLoose(r)?ttPick(r,p,rel,[[lo,1],[lo+1,-1]],obs,gx):null;   // the pair it lies between, worked as a tic-tac
 if(!bs&&!tp)return false;
 r.htT=S.time+LS.every;
 if(rngAi(r.idx)()>=LS.share)return false;
 const tt=!!tp&&(!bs||rngAi(r.idx)()<AIC.catch.tictac.share);
 r.tapN=0;r.pinA=r.angle;r.catFwd=false;
 if(tt){r.ttPk=tp;ttStart(r,true);return true;}
 r.tapS=bs.s;r.tapJ=bs.j;r.hMan=bs.mi;r.hA=null;r.hDeep=rel<CA.side.back;r.hAhead=rel>CA.side.aheadMin;r.tapHit=true;r.hPh='clear';r.hT=0;
 CAS.hitLoose++;
 return true;
}
// one frame of a hit; phases (r.hPh): rest (the slide stops and the ball is let go at rest) -> clear (the man steps off it, away from the neighbour) -> aim (the leg turns to square the foot onto it) -> run (he slides into it)
// -> out (the rod brakes while the ball leaves; once it is clear the neighbour takes it as a side catch)
function hitStep(r,best){
 const CA=AIC.catch,HT=CA.hit,dir=r.kickDir,dt=1/SIM.hz,rb=best.real||best,p=rb.m.position,s=r.tapS,mi=r.hMan,rel=(p.x-r.x)*dir,cz=FOOT_BOX.z+BALL_R+AIC.clearMargin+HT.pad;
 const gap=(p.z-(r.baseZ[mi]+r.offset))*s,sp=Math.hypot(rb.v.x,rb.v.z),oc=clamp(hitStand(r,mi,p.z,s),-r.maxOff,r.maxOff),lo=HT.bands[0][0]-1,hi=HT.bands[HT.bands.length-1][1]+1;
 let why=null;
 r.hT+=dt;
 if(rb.scored)why='scored';else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(r.catT>HT.abortT)why='time';
 else if(r.hPh==='rest'&&!r.pinB)why='lost';
 else if((r.hPh==='clear'||r.hPh==='aim')&&(sp>HT.bailV||rel<lo||rel>hi))why='moved';
 else if((r.hPh==='clear'||r.hPh==='aim')&&Math.abs(hitStand(r,mi,p.z,s))>r.maxOff)why='room';
 if(why){catchEnd(r,CA.cd,'hit:'+why);return;}
 r.aiMan=mi;r.pinFwd=false;
 if(r.hPh==='rest'){                                               // still pinned: the slide stops, then it is let go at rest
  r.pinOn=true;r.pinPose=true;r.pinA=r.angle;r.target=r.offset;
  if(Math.abs(r.slideV)>HT.restV&&r.hT<HT.restT)return;
  pinRelease(r);r.hPh='clear';r.hT=0;
 }
 r.pinOn=false;r.pinPose=true;                                     // the leg holds where it is until it is turned
 if(r.hPh==='clear'){
  r.target=oc;
  if(gap<cz)return;
  r.hA=hitAngle(rel);
  if(r.hA==null){catchEnd(r,CA.cd,'hit:reach');return;}
  r.hPh='aim';r.hT=0;
 }
 if(r.hPh==='aim'){
  r.pinA=r.hA*dir;r.target=oc;
  if((Math.abs(r.angle-r.pinA)>HT.tolA||Math.abs(r.angVel)>HT.tolW||Math.abs(r.offset-oc)>HT.tolZ||Math.abs(r.slideV)>HT.restV)&&r.hT<HT.aimT)return;
  r.hPh='run';r.hT=0;
 }
 if(r.hPh==='run'){
  r.pinA=r.hA*dir;r.target=clamp(r.offset+s*HT.runV*dt,-r.maxOff,r.maxOff);
  if(gap<=FOOT_BOX.z+BALL_R+HT.contact&&rb.v.z*s>HT.hitV){r.hPh='out';r.hT=0;CAS.hitHit++;}
  else{if(r.hT>HT.runT)catchEnd(r,CA.cd,'hit:miss');return;}
 }
 r.pinA=r.hA*dir;r.target=r.offset;                                // out: the rod brakes and the ball leaves
 if(gap>=cz+HT.clearOut||r.hT>HT.outT){
  if(rb.v.z*s<HT.hitV*0.5){catchEnd(r,CA.cd,'hit:stuck');return;}
  if(r.ttOn){ttGo(r,rb);return;}                                    // the first touch of a tic-tac: the neighbour bounces it back, not catches it
  r.tapAhead=r.hAhead;CAS.hitSent++;tapSide(r,r.hDeep);
 }
}
// a ball retrieve pinned that has nowhere to go: the tap takes the rod over as the catch action, the pin still on (the run is the carry)
function retrieveTap(r){
 BGS.retEnd++;CAS.retTap++;
 r.act='catch';r.actT=0;r.retPh=null;r.retMan=-1;r.retDir=0;r.retZ=null;r.retCd=AIC.retrieve.cd;
 tapStart(r);
}
// side: the first man a ball rolling along the row runs into, if it is one to receive (CONFIG.ai.catch.side); r.catMan is that man, r.catSg the way it rolls
function sidePick(r,best){
 const SD=AIC.catch.side,p=best.m.position,v=best.v,rel=(p.x-r.x)*r.kickDir,sp=Math.abs(v.z);
 const ahead=rel>0;                                                    // ahead of the rod it is a forward foot that comes down on it, behind a back one
 if(!SD||!SD.on||rel<SHOT.pin.back||rel>SD.fwdFront||Math.abs(v.x)>SD.maxVX||sp<SD.minV||sp>SD.maxV||(sp>SD.pinV&&!SD.through)||footAngle(rel,ahead)==null)return false;
 const sg=Math.sign(v.z);
 let bi=-1,bd=1e9;
 for(let i=0;i<r.baseZ.length;i++){
  if(!manLive(r,i))continue;
  const d=(r.baseZ[i]+r.offset-p.z)*sg;                           // z still to roll before it reaches this man
  if(d>=SD.near&&d<=SD.far&&d<bd){bd=d;bi=i;}
 }
 if(bi<0||bd/sp<SD.tMin||bd/sp>SD.tMax)return false;
 r.catMan=bi;r.catSg=sg;r.catCush=false;r.catFwd=ahead;
 return true;
}
// is this ball taken under a forward leg (held, carried, tapped: the AI keeping it under control) or pinned as usual, ready to shoot? Not when a shot is open where it will be; the rest by chance
function takeFwd(r,bx,bz){
 const CA=AIC.catch,TK=CA.recv.take,gx=r.kickDir>0?F.L/2:-F.L/2;
 if(!TK||!TK.on||!CA.recv.on||!CA.recv.lift.on||TK.roles.indexOf(r.role)<0)return false;
 if(pinOutlet(r,bx,bz,laneObs(r.team,bx,gx,CA.shotV),gx,0)>=CA.lineClear)return false;
 CAS.take++;
 return rngAi(r.idx)()<TK.share;
}
// the pose angle (rod-local) at which a man's foot comes down onto a ball lying rel ahead of the rod (fwd: a forward leg, else a back one), side.topGap above it: what the pin holds (physics.js footUnder)
// null = no pose puts the foot on top of it (under the rod the shin meets it first)
const FA_R={x:0,kickDir:1,angle:0},FA_P={x:0,y:0,z:0},FA_D=[0,0];
function footAngle(rel,fwd){
 const s=fwd?1:-1,R=BALL_R*FOOT_BOX_REACH+AIC.catch.side.topGap,st=0.03;
 FA_P.x=rel;FA_P.y=BALL_R;
 const gap=a=>{FA_R.angle=a;return footBoxD(FA_R,FA_P,0,FA_D)-R;};
 let m=s*1.45;                                                  // from high up, the leg is lowered until the foot reaches the ball
 while(s*m>0.25&&gap(m)>0)m-=s*st;
 if(gap(m)>0)return null;
 let lo=m+s*st,hi=m;
 for(let k=0;k<12;k++){const c=(lo+hi)/2;if(gap(c)>0)lo=c;else hi=c;}
 gap(lo);
 return FA_D[0]>=SHOT.pin.down?lo:null;
}
// the pose angle (rod-local, negative = back; fwd: tilted forward) that holds the leg legD from a ball rel ahead of the rod: clear of it (the leg hits at BALL_R + PRAD) but inside the pin's reach,
// so the catch is the same width across the man whatever the ball's depth, and a leg that is already down never blocks it
function sideAngle(rel,fwd){
 const SD=AIC.catch.side,wy=BALL_R-ROD_H,top=fwd&&rel>=SD.aheadMin,D=top?BALL_R+PRAD+SD.topGap:SD.legD;
 const dist=m=>{const dx=Math.sin(m)*ARM,dy=-Math.cos(m)*ARM,t=clamp((rel*dx+wy*dy)/(ARM*ARM),0,1);return Math.hypot(rel-dx*t,BALL_R-(ROD_H+dy*t));};
 let lo=fwd?1.4:-1.4,hi=fwd?0.1:-0.2;                           // lo is tilted far from the ball, hi nearly upright (close)
 if(top){                                                       // a ball lying ahead: the leg is lowered from above until it touches the top of it, the foot sitting on it; out of its reach it stays up
  const up=AIC.catch.recv.lift.angle;
  let m=up;
  while(m>0.2&&dist(m)>D)m-=0.03;
  if(dist(m)>D)return up;
  lo=Math.min(m+0.03,up);hi=m;
 }
 for(let k=0;k<(top?8:14);k++){
  const m=(lo+hi)/2;
  if(dist(m)>D)lo=m;else hi=m;
 }
 return (lo+hi)/2;
}
// one frame of a side catch: the men up while it rolls in, the pin pose just before it arrives; once pinned, catchStep carries on from there
// it reads the real ball, not the delayed view: this is a reflex, and after a tap the view still shows the ball held. The pin judges the ball's speed against the rod's, so a quick ball (a tap) is cushioned: the rod runs along with it so it arrives slowly
function sideStep(r,best){
 const SD=AIC.catch.side,CA=AIC.catch,TB=CA.tap.back,dir=r.kickDir,dt=1/SIM.hz,rb=best.real||best,p=rb.m.position,v=rb.v,rel=(p.x-r.x)*dir,sp=Math.abs(v.z),sg=r.catSg,deep=r.catDeep;
 const ahead=(r.baseZ[r.catMan]+r.offset-p.z)*sg;                // z left to roll before the man (negative = rolled past)
 const bv=v.z*sg,cl=bv-r.slideV*sg;                              // the ball's speed along the roll, and how fast it closes on the man
 let why=null;
 if(rb.scored)why='scored';else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(r.catT>SD.abortT)why='time';
 else if(rel<(deep?CA.tap.deep.back:SHOT.pin.back)-1||rel>(r.catFwd?SD.fwdFront:SD.front)+1||Math.abs(v.x)>SD.maxVX*2)why='off';
 else if(sp<SD.minV*0.5)why='slow';else if(ahead<-SD.passed)why='past';
 if(why){catchEnd(r,why==='past'||why==='slow'?0:CA.cd,'side:'+why);return;}   // rolled on or died: the next man (or retrieve) can have it at once
 r.aiMan=r.catMan;
 const tA=ahead/Math.max(cl,1);
 if(r.tapPend&&TB&&TB.on&&!deep&&!r.catFwd&&!r.catCush&&(r.tapN|0)<CA.tap.maxChain&&ahead-TB.contact>=TB.tMin*bv&&(r.tbEv=(r.tbEv||0)-dt)<=0){   // a tap on its way, still far enough off for the men to go down: has the receiving man's lane shut?
  r.tbEv=TB.every;
  const goalX=dir>0?F.L/2:-F.L/2;
  if(backEval(r,p,laneObs(r.team,p.x,goalX,CA.shotV),goalX)){r.catPh='back';r.catT=0;r.tapN++;r.bkRev=false;CAS.back++;backStep(r,best);return;}
 }
 const quick=SD.cushion&&cl>SD.pinV&&bv<=SD.cushionV&&bv<=DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r)+SD.pinV+SD.cushionSlack&&(sg>0?r.maxOff-r.offset:r.offset+r.maxOff)>=SD.cushionRoom;   // too quick to pin as it is, but the rod can run along with it
 if(!r.catCush&&quick&&ahead<=Math.min(SD.cushionT*Math.max(cl,1),SD.cushionD))r.catCush=true;
 r.target=r.catCush?clamp(r.offset+sg*Math.max(0,bv-SD.cushionW)*dt,-r.maxOff,r.maxOff):r.offset;   // cushioned: run along with it; else it rolls to the man
 const fa=footAngle(rel,r.catFwd);
 if(fa!=null&&(r.catCush||cl<=SD.pinV)&&tA<=SD.dropT){r.pinOn=true;r.pinPose=true;r.pinFwd=r.catFwd;r.pinA=fa*dir;}
 else catchUp(r);
}
// the men up while the ball is on its way: back and over for a pin as usual, forward and up for a forward leg (nothing of it is near a ball that rolls under the rod)
function catchUp(r){
 const fw=r.catFwd;
 r.pinOn=false;r.pinPose=!!fw;r.pinFwd=false;r.pinA=fw?AIC.catch.recv.lift.angle*r.kickDir:null;r.raise=!fw;
}
// tap back: the ball rolling to man j has lost his lane, and the man it came from has one open where it would come back to (the rod runs along with it on the way)
function backEval(r,p,obs,goalX){
 const CA=AIC.catch,TP=CA.tap,j=r.catMan,s=r.catSg,i=j-s,zl=F.W/2-BALL_R-1;
 if(i<0||i>=r.baseZ.length||!manLive(r,i)||(p.z-(r.baseZ[i]+r.offset))*s<TP.back.clear)return false;   // nobody to go back to, or the ball is still on top of him
 if((s>0?r.offset+r.maxOff:r.maxOff-r.offset)<TP.room)return false;                                     // no slide left to run that way
 if(pinOutlet(r,p.x,clamp(r.baseZ[j]+r.offset+s*TP.drift,-zl,zl),obs,goalX,0)>=CA.lineClear)return false;
 return pinOutlet(r,p.x,clamp(r.baseZ[i]+r.offset-s*TP.drift,-zl,zl),obs,goalX,0)>=CA.lineClear;
}
// one frame of a tap back: the men go down once the ball is clear of the man it left, the man it is rolling to slides into it as it arrives (a down man bounces it), and once it is away and clear of him
// the man it came from takes it as a side catch
function backStep(r,best){
 const CA=AIC.catch,TB=CA.tap.back,SD=CA.side,dir=r.kickDir,dt=1/SIM.hz,rb=best.real||best,p=rb.m.position,v=rb.v,rel=(p.x-r.x)*dir,j=r.catMan,s=r.catSg,i=j-s;
 const ahead=(r.baseZ[j]+r.offset-p.z)*s,clearI=(p.z-(r.baseZ[i]+r.offset))*s>=TB.clear;
 let why=null;
 if(rb.scored)why='scored';else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(r.catT>TB.abortT)why='time';
 else if(rel<SD.back-1||rel>SD.front+1)why='off';else if(ahead<-TB.passed)why='through';
 if(why){catchEnd(r,CA.cd,'back:'+why);return;}
 r.aiMan=j;r.pinOn=false;
 r.raise=!clearI;                                                 // down only once the ball is clear of the man it left
 r.pinPose=clearI;r.pinA=clearI?Math.asin(clamp((rel-FOOT_BOX_OFF.y)/(ARM+FOOT_BOX_OFF.x),-0.95,0.95))*dir:null;   // ...with the boot square onto it (its box centred on the ball's depth): the corner of an upright boot knocks it backward
 if(v.z*s<-1)r.bkRev=true;
 if(r.bkRev&&ahead>=TB.clear){r.catPh='side';r.catMan=i;r.catSg=-s;r.catCush=false;r.catT=0;return;}
 r.target=(!r.bkRev&&clearI&&ahead<=TB.runD)?clamp(r.offset-s*TB.runV*dt,-r.maxOff,r.maxOff):r.offset;
}
// meet: a slow ball no man will roll into (CONFIG.ai.catch.meet): the nearest man ahead of it in its roll that can stand on its z, with no man already on it; r.catMan is that man, r.catSg the way he goes (toward the ball)
function meetPick(r,best){
 const MT=AIC.catch.meet,SD=AIC.catch.side,p=best.m.position,v=best.v,rel=(p.x-r.x)*r.kickDir,sp=Math.abs(v.z),sg=Math.sign(v.z);
 if(!MT||!MT.on||rel<SHOT.pin.back||rel>SD.fwdFront||Math.abs(v.x)>SD.maxVX||sp<MT.minV||sp>MT.maxV||footAngle(rel,rel>0)==null)return false;
 let bi=-1,bd=1e9;
 for(let i=0;i<r.baseZ.length;i++){
  if(!manLive(r,i))continue;
  const ahead=(r.baseZ[i]+r.offset-p.z)*sg;
  if(Math.abs(ahead)<MT.clear)return false;                       // a man is on it: the lift would clip it
  const o=clamp(p.z-r.baseZ[i],-r.maxOff,r.maxOff),d=Math.abs(o-r.offset);
  if(ahead>0&&Math.abs(p.z-(r.baseZ[i]+o))<=MT.zTol&&d<=MT.far&&d<bd){bd=d;bi=i;}   // a man behind it would have to chase it, and pushes it
 }
 if(bi<0)return false;
 r.catMan=bi;r.catSg=-sg;r.catCush=false;r.catFwd=rel>0;
 return true;
}
// one frame of a meet: the men up and the man slides to the ball, fast while far and closing at closeV when near (the planned braking), the pin pose just before he is there; once pinned, catchStep carries on
function meetStep(r,best){
 const MT=AIC.catch.meet,SD=AIC.catch.side,CA=AIC.catch,dir=r.kickDir,dt=1/SIM.hz,rb=best.real||best,p=rb.m.position,v=rb.v,rel=(p.x-r.x)*dir,m=r.catMan;
 const d=p.z-(r.baseZ[m]+r.offset),e=d<0?-1:1,dist=Math.abs(d),o=clamp(p.z-r.baseZ[m],-r.maxOff,r.maxOff);
 let why=null;
 if(rb.scored)why='scored';else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(r.catT>MT.abortT)why='time';
 else if(rel<SHOT.pin.back-1||rel>SD.fwdFront+1||Math.abs(v.x)>SD.maxVX*2)why='off';
 else if(Math.abs(p.z-(r.baseZ[m]+o))>MT.zTol+1)why='range';else if(d*r.catSg<-MT.passed)why='miss';
 if(why){catchEnd(r,CA.cd,'meet:'+why);return;}
 r.aiMan=m;
 const bu=v.z*e,u=Math.max(0,MT.closeV+bu),mu=Math.min(DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r)*MT.use,Math.sqrt(u*u+2*MT.brake*Math.max(0,dist-MT.slow)));
 r.target=clamp(r.offset+e*mu*dt,-r.maxOff,r.maxOff);
 const tA=Math.max(0,dist-FOOT_BOX.z)/Math.max(r.slideV*e-bu,1);
 const fa=footAngle(rel,r.catFwd);
 if(fa!=null&&tA<=MT.dropT){r.pinOn=true;r.pinPose=true;r.pinFwd=r.catFwd;r.pinA=fa*dir;r.raise=false;}
 else catchUp(r);
}
// is this ball one to catch: 'side' (rolling along the row), 'meet' (a slow one along the row no man will roll into), 'front' (running at the rod from upfield), 'thru' (the same, let through under a forward leg), 'behind' (coming up from the rod behind: pinned at the heel for retrieve, or held in the receiving pose, r.catFwd) or null; r.catMan / r.catO are the man and offset for it
function catchPick(r,best){
 const CA=AIC.catch,dir=r.kickDir,p=best.m.position,v=best.v,rel=(p.x-r.x)*dir,vf=v.x*dir,zl=F.W/2-BALL_R,smart=!CA.iqGate||r.aiIQ;
 let ph,A,c,tAr;
 if(hitLoose(r,best))return 'hit';                                  // a ball lying between two men is knocked to the one with the lane
 if(!smart)return fetchPick(r,best)?'fetch':null;                   // the iq roll gates the rest; taking a loose ball is for every rod
 if(sidePick(r,best))return 'side';
 if(meetPick(r,best))return 'meet';
 if(ttRoll(r,best))return 'tictac';
 if(rel>0){
  A=CA.front;c=-vf;
  if(rel<A.near||rel>A.far||c<A.minClose||c>A.maxClose)return fetchPick(r,best)?'fetch':null;
  tAr=rel/c;ph='front';
 }else{
  A=CA.behind;c=vf;
  if(-rel<A.near||-rel>A.far||c<A.minClose||c>A.maxClose)return null;
  tAr=(-rel-A.stop)/c;ph='behind';
 }
 if(tAr>A.tMax||tAr<0.05)return null;
 const m=catchMan(r,clamp(p.z+v.z*tAr,-zl,zl),tAr);
 if(!m)return null;
 const TH=CA.recv.take.thru,rb=best.real||best,cr=-rb.v.x*dir;     // the real ball: the leg has to land on it, not on where the view thinks it is
 if(ph==='front'&&TH&&TH.on&&cr>=TH.minV&&cr<=TH.maxV&&Math.abs(rb.v.z)<=TH.maxVZ&&rb.m.position.y<AIC.lowY&&rel>=TH.near&&rel<=TH.far&&takeFwd(r,p.x,r.baseZ[m.i]+m.o)){r.catMan=m.i;r.catO=m.o;r.catFwd=true;return 'thru';}
 const TB=CA.recv.take.behind,fb=ph==='behind'&&TB&&TB.on&&takeFwd(r,r.x+dir*TB.stop,r.baseZ[m.i]+m.o);   // a ball from behind held in the receiving pose, as a pass is
 if(sweepClips(r,best,r.angle,(fb?CA.recv.angle:A.angle)*dir))return null;   // the pose itself must not shove the ball
 r.catMan=m.i;r.catO=m.o;r.catFwd=fb;
 return ph;
}
// one frame of a ball let through: the leg is up and forward while it rolls under the rod and comes down onto it as it passes under the pivot (the real ball: the leg has to land when it is there)
function thruStep(r,best){
 const CA=AIC.catch,RV=CA.recv,TH=RV.take.thru,dir=r.kickDir,rb=best.real||best,p=rb.m.position,v=rb.v,rel=(p.x-r.x)*dir,vf=v.x*dir,zl=F.W/2-BALL_R;
 let why=null;
 if(rb.scored)why='scored';else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(r.catT>TH.abortT)why='time';
 else if(rel<TH.catchRel-TH.past)why='past';else if(vf>1&&rel>CA.front.near)why='away';else if(v.length()<CA.restV&&rel>SHOT.pin.front+0.3)why='stopped';
 if(why){catchEnd(r,CA.cd,'thru:'+why);return;}
 const c=Math.max(2,-vf),tAr=Math.max(0,(rel-TH.catchRel)/c);
 const m=catchMan(r,clamp(p.z+v.z*tAr,-zl,zl),tAr);
 if(m){r.catMan=m.i;r.catO=m.o;}                                   // re-aim as the ball's line firms up; no man can make it = stay on the last
 r.aiMan=r.catMan;
 r.target=clamp(r.catO,-r.maxOff,r.maxOff);
 if(tAr<=TH.dropT){r.pinOn=true;r.pinPose=true;r.pinA=RV.angle*dir;}
 else catchUp(r);
}
// fetch (CONFIG.ai.catch.fetch): a loose ball lying ahead of the rod that no shot is open to is taken from above under a forward leg
// phases (r.ftPh): clear (the man slides off the ball's z, the leg down so nothing sweeps it) -> up (the leg goes up and forward over it) -> over (the man slides onto its z) -> down (the leg comes down onto it and the pin catches it)
function fetchPick(r,best){
 const CA=AIC.catch,FE=CA.fetch,rb=best.real||best,p=rb.m.position,rel=(p.x-r.x)*r.kickDir,gx=r.kickDir>0?F.L/2:-F.L/2;
 if(!FE||!FE.on||FE.roles.indexOf(r.role)<0||(r.ftCd||0)>S.time||rel<FE.near||rel>FE.far||p.y>=AIC.lowY||rb.v.length()>FE.maxV)return false;
 if(pinOutlet(r,p.x,p.z,laneObs(r.team,p.x,gx,CA.shotV),gx,0)>=CA.lineClear)return false;   // a shot is open where it lies: that is the kick's
 if(!retrieveMan(r,p.z))return false;
 r.catFwd=false;r.ftPh=null;
 return true;
}
function fetchStep(r,best){
 const CA=AIC.catch,FE=CA.fetch,RV=CA.recv,dir=r.kickDir,rb=best.real||best,p=rb.m.position,bz=p.z,rel=(p.x-r.x)*dir,cz=FOOT_BOX.z+BALL_R+AIC.clearMargin+FE.clearPad;
 let why=null;
 if(rb.scored)why='scored';else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(rb.v.length()>FE.bailV)why='moved';
 else if(rel<FE.near-1||rel>FE.far+1)why='off';else if(r.catT>FE.abortT)why='time';
 const mn=why?null:retrieveMan(r,bz);
 if(!why&&!mn)why='reach';
 if(why){catchEnd(r,CA.cd,'fetch:'+why);return;}
 if(!r.ftPh){r.ftPh='clear';r.ftT=0;}
 r.ftT+=1/SIM.hz;
 if(r.ftPh==='clear'){
  r.pinOn=false;r.pinPose=false;r.pinFwd=false;r.pinA=null;
  if(inLaneZ(r,bz,cz)){
   const o=clearOffset(r,bz,cz,0);
   if(o==null){catchEnd(r,CA.cd,'fetch:room');return;}
   r.target=o;r.aiMan=-1;return;
  }
  r.ftPh='up';r.ftT=0;
 }
 if(r.ftPh==='up'){
  r.pinOn=true;r.pinPose=true;r.pinFwd=true;r.pinA=RV.lift.angle*dir;r.target=r.offset;r.aiMan=-1;
  if(inLaneZ(r,bz,cz-0.2)){r.ftPh='clear';return;}                  // it rolled into the lane before the leg was up
  if(r.angle*dir<RV.lift.angle-FE.upTol&&r.ftT<FE.downT)return;
  r.ftPh='over';r.ftT=0;
 }
 if(r.ftPh==='over'){
  r.pinOn=true;r.pinPose=true;r.pinFwd=true;r.pinA=RV.lift.angle*dir;r.target=mn.o;r.aiMan=mn.i;
  if(Math.abs(bz-(r.baseZ[mn.i]+r.offset))>FE.alignZ||Math.abs(r.slideV)>FE.slideV)return;
  r.ftPh='down';r.ftT=0;
 }
 const fa=footAngle(rel,true);
 r.pinOn=true;r.pinPose=true;r.pinFwd=true;r.pinA=(fa==null?RV.lift.angle:fa)*dir;r.target=mn.o;r.aiMan=mn.i;
 if(r.ftT>FE.downT||fa==null)catchEnd(r,CA.cd,'fetch:nopin');
}
// ahead (catPh 'ahead'): a ball held under a forward leg AHEAD of the rod is played with a swing: the rod stops, the ball is let go at rest, the man slides off its z with the leg up, the leg comes down at rest, and the man slides back onto it: the boot is behind it
// phases (r.ahPh): rest -> side -> down -> back; the ordinary swing takes it from there (the kick path, nothing here fires)
function aheadStart(r){
 r.catPh='ahead';r.ahPh='rest';r.ahT=0;r.catT=0;CAS.ahead++;
}
function aheadStep(r,best){
 const CA=AIC.catch,FE=CA.fetch,RV=CA.recv,dir=r.kickDir,rb=best.real||best,p=rb.m.position,bz=p.z,rel=(p.x-r.x)*dir,cz=FOOT_BOX.z+BALL_R+AIC.clearMargin+FE.clearPad;
 r.ahT+=1/SIM.hz;
 let why=null;
 if(rb.scored)why='scored';else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';else if(r.ahT>FE.aheadT)why='time';
 else if(r.ahPh!=='rest'&&(rb.v.length()>FE.bailV||rel<FE.near-1||rel>FE.far+1))why='moved';
 const mn=why?null:retrieveMan(r,bz);
 if(!why&&!mn)why='reach';
 if(why){catchEnd(r,CA.cd,'ahead:'+why);return;}
 if(r.ahPh==='rest'){                                              // still pinned: stop, then let it go at rest
  r.pinOn=true;r.pinPose=true;r.pinA=r.angle;r.target=r.offset;r.aiMan=r.pinB?r.pinB.pinMan:-1;
  if(r.pinB&&Math.abs(r.slideV)>RV.lift.restV&&r.ahT<RV.lift.abortT)return;
  if(r.pinB)pinRelease(r);
  r.ahPh='side';r.ahT=0;
 }
 if(r.ahPh==='side'){                                              // off its z, the leg up and forward so nothing of it is near the ball
  r.pinOn=false;r.pinPose=true;r.pinFwd=false;r.pinA=RV.lift.angle*dir;r.aiMan=-1;
  if(inLaneZ(r,bz,cz)){
   const o=clearOffset(r,bz,cz,0);
   if(o==null){catchEnd(r,CA.cd,'ahead:room');return;}
   r.target=o;return;
  }
  r.target=r.offset;r.ahPh='down';r.ahT=0;
 }
 if(r.ahPh==='down'){                                              // the leg comes down at rest, clear of the ball
  r.pinOn=false;r.pinPose=false;r.pinA=null;r.target=r.offset;r.aiMan=-1;
  if(r.angle*dir>FE.downA&&r.ahT<FE.downWait)return;
  r.ahPh='back';r.ahT=0;
 }
 r.pinOn=false;r.pinPose=false;r.pinA=null;r.target=mn.o;r.aiMan=mn.i;                 // back: onto the ball's z with the boot down, behind it
 if(Math.abs(bz-(r.baseZ[mn.i]+r.offset))<=FE.alignZ){r.ftCd=S.time+FE.cd;catchEnd(r,CA.cd,'ahead:done');}
}
// --- tic-tac (CONFIG.ai.catch.tictac) ---
// a setting for this rod: its own (byRole) or the common one
function ttVal(r,k){
 const B=AIC.catch.tictac.byRole[r.role];
 return B&&B[k]!=null?B[k]:AIC.catch.tictac[k];
}
// two neighbouring men with room between their faces for the ball
function ttRoom(r,lo){
 return lo>=0&&lo+1<r.baseZ.length&&manLive(r,lo)&&manLive(r,lo+1)&&r.baseZ[lo+1]-r.baseZ[lo]-2*(FOOT_BOX.z+BALL_R)>=ttVal(r,'room');
}
// slides (u/s, signed) a strike can be made at, up to the rod's top speed
function ttSlides(r){
 const top=DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r)*0.97,a=[];
 for(const w of AIC.catch.tictac.strike.w){if(w>top)continue;a.push(w);if(w)a.push(-w);}
 return a;
}
// the pair a ball at p (depth rel) is worked between, from each [man, side] that could knock it first: the one with the better lanes at the middle of the gap, null if none fits
function ttPick(r,p,rel,cs,obs,goalX){
 const T=AIC.catch.tictac,ws=ttSlides(r);
 if(rel<T.relMin||rel>T.relMax||hitAngle(rel)==null)return null;
 let best=null;
 for(const c of cs){
  const mi=c[0],s=c[1],j=mi+s;
  if(!ttRoom(r,Math.min(mi,j))||!hitFits(r,mi,j,s,p.z))continue;
  const zm=(r.baseZ[mi]+r.baseZ[j])/2+r.offset;
  let v=-1e9;
  for(const w of ws)v=Math.max(v,pinOutlet(r,p.x,zm,obs,goalX,T.strike.k*w));
  v-=0.01*Math.abs(zm);                                             // level lanes: toward the middle
  if(!best||v>best.v)best={s,j,mi,v};
 }
 return best;
}
// a stuck pin may start a tic-tac, once per hold by chance
function ttWant(r,b,t,obs,goalX){
 const T=AIC.catch.tictac;
 if(!T||!T.on||T.roles.indexOf(r.role)<0||t<T.minHold||r.force||(r.ttCd||0)>S.time)return false;
 if(r.ttRoll==null)r.ttRoll=rngAi(r.idx)()<T.share;
 if(!r.ttRoll)return false;
 return !!(r.ttPk=ttPick(r,b.m.position,b.pinDx,[[b.pinMan,-1],[b.pinMan,1]],obs,goalX));
}
// a ball lying between two men is one to start from: the rod is free, and the cooldown is over
function ttLoose(r){
 const T=AIC.catch.tictac;
 return !!(T&&T.on&&T.loose&&T.roles.indexOf(r.role)>=0&&!r.force&&(r.ttCd||0)<=S.time);
}
// a ball rolling along the row under the rod, where no foot can come down on it, is worked from where it is: the man it rolls to squares his foot onto it and slides into it, the man it came from takes it back
function ttRoll(r,best){
 const T=AIC.catch.tictac,RL=T.roll,rb=best.real||best,p=rb.m.position,v=rb.v,rel=(p.x-r.x)*r.kickDir,sp=Math.abs(v.z),sg=v.z>0?1:-1,fz=FOOT_BOX.z+BALL_R+T.margin;
 if(!T.on||!RL||!RL.on||T.roles.indexOf(r.role)<0||r.force||(r.ttCd||0)>S.time||p.y>=AIC.lowY)return false;
 if(Math.abs(v.x)>AIC.catch.side.maxVX||sp<RL.minV||sp>RL.maxV||rel<T.relMin||rel>T.relMax||(RL.under&&footAngle(rel,rel>0)!=null))return false;   // under: only a ball no foot can come down on (else any the side catch left)
 const a=hitAngle(rel);
 if(a==null)return false;
 let lo=-1;
 for(let i=0;i<r.baseZ.length;i++)if(r.baseZ[i]+r.offset<p.z)lo=i;
 if(!ttRoom(r,lo))return false;                                     // between two live men with room to work it
 const zl=r.baseZ[lo]+r.offset+fz,zh=r.baseZ[lo+1]+r.offset-fz;
 if(p.z<zl||p.z>zh||(sg>0?zh-p.z:p.z-zl)/sp<RL.tMin)return false;   // on a man's foot, or too near the face it rolls to for the foot to square up
 r.catMan=sg>0?lo+1:lo;r.ttLo=lo;r.ttSg=sg;r.tapS=sg;r.ttA=a;r.ttRel=rel;r.ttPh='bounce';r.ttOn=true;
 r.ttN=0;r.ttT=0;r.ttEv=0;r.ttDead=0;r.ttGo=false;r.ttLock=0;r.ttSq=0;r.ttDec=-1;r.hPh=null;r.pinOn=false;
 CAS.tt++;CAS.ttRoll++;
 return true;
}
// the first touch is a hit; ttGo takes over once the ball is away
function ttStart(r,loose){
 const pk=r.ttPk;r.ttPk=null;
 r.tapS=pk.s;r.tapJ=pk.j;r.catT=0;
 r.hMan=pk.mi;r.hA=null;r.hDeep=false;r.hAhead=!loose&&!!r.pinB&&r.pinB.pinDx>AIC.catch.side.aheadMin;r.tapHit=false;
 r.ttOn=true;r.ttLo=Math.min(pk.mi,pk.j);r.ttN=0;r.ttT=0;r.ttSg=pk.s;r.ttEv=0;r.ttDead=0;r.ttGo=false;r.ttLock=0;r.ttSq=0;r.ttDec=-1;
 CAS.tt++;
 if(loose)CAS.ttLoose++;
 if(!loose&&r.pinB&&!r.hAhead&&r.angle*r.kickDir>AIC.catch.recv.fwdMin){CAS.ttFwd++;fliftStart(r,'hit');return;}   // under a forward leg: it lets go by turning up, then the man steps off
 r.catPh='hit';r.hPh=loose?'clear':'rest';r.hT=0;
}
function ttGo(r,rb){
 r.catPh='tictac';r.ttPh='bounce';r.ttN=1;r.ttT=0;r.catT=0;r.ttSg=r.tapS;r.ttEv=0;r.hPh=null;r.pinOn=false;CAS.ttGo++;
 r.ttA=r.hA;r.ttRel=(rb.m.position.x-r.x)*r.kickDir;               // squared on the depth it was hit at; ttStep follows the ball's depth between touches
}
// end it as a side catch for the man the ball is rolling to
function ttCatch(r,f,sg,why){
 const T=AIC.catch.tictac;
 CAW['tt:'+why]=(CAW['tt:'+why]||0)+1;CAS.ttCatch++;
 r.ttOn=false;r.ttPh=null;r.ttCd=S.time+(why==='time'||why==='touches'?T.cdTime:T.cd);
 r.catPh='side';r.catMan=f;r.catSg=sg;r.catCush=false;r.catFwd=(r.ttRelNow||0)>=AIC.catch.side.aheadMin;r.catDeep=false;r.catT=0;r.tapPend=false;r.tbEv=0;   // a rally in front of the pivot is taken under a forward leg
}
// the opposing men a ball struck in t s will meet: each row where its target is heading, as far as it can slide by then (laneObs uses the slide speed, which flips every few steps)
function ttObs(team,bx,tx,t){
 const dir=team===0?1:-1,GA=AIC.gapAim,obs=[];
 for(const r2 of rods){
  if(r2.team===team&&r2.act!=='recv')continue;
  if((r2.x-bx)*dir<=GA.minAhead||(r2.x-tx)*dir>=0)continue;
  const tt=t+(r2.x-bx)*dir/AIC.catch.shotV,m=DIFFS[teamDiff(r2.team)].speed*rodSpeedMult(r2)*tt,dz=clamp(r2.target+(r2.tgV||0)*AIC.catch.tictac.strike.tgtLead*tt-r2.offset,-m,m);
  for(let i=0;i<r2.baseZ.length;i++){if(r2.removedUntil[i]&&r2.removedUntil[i]>S.time)continue;obs.push({x:r2.x,z:r2.baseZ[i]+r2.offset+dz,own:r2.team===team});}
 }
 return obs;
}
// the way forward for a strike leaving (bx,bz) at slope sl, the rows read by ttObs: ATT the line to goal and the mouth, the rest the gap past the opposing row in front
function ttOutlet(r,bx,bz,obs,gx,sl){
 if(r.role==='ATT')return pinOutlet(r,bx,bz,obs,gx,sl);
 let rx=1e9,d=1e9;
 for(const o of obs)if(!o.own)rx=Math.min(rx,(o.x-bx)*r.kickDir);
 if(rx===1e9)return 1e3;
 for(const o of obs)if(!o.own&&(o.x-bx)*r.kickDir-rx<0.01)d=Math.min(d,Math.abs(bz+sl*rx-o.z));
 return d-AIC.gapAim.blockR;
}
// man f brakes, waits d, ramps to slide w and is at speed when the ball (cz, ST.gap short of his centre) gets there at t; d < 0 = too late
const _tp={zc:0,t:0,cz:0,d:0,z0:0};
function ttPlan(r,f,p,v,w){
 const ST=AIC.catch.tictac.strike,A=AIC.slideAccel*stAgil(r),v0=r.slideV,sg=v.z>0?1:-1;
 const z0=r.baseZ[f]+r.offset+v0*Math.abs(v0)/(2*A),zc=z0+w*Math.abs(w)/(2*A)+w*ST.settle;
 _tp.z0=z0;_tp.zc=zc;_tp.cz=zc-sg*ST.gap;_tp.t=(_tp.cz-p.z)/v.z;_tp.d=_tp.t-(Math.abs(v0)+Math.abs(w))/A-ST.settle;
 return _tp;
}
// every strike the man the ball is rolling to can make, each with the lane it leaves on; live = the leg is already back
function ttOpts(r,rb,live){
 const CA=AIC.catch,T=CA.tictac,ST=T.strike,p=rb.m.position,v=rb.v,sg=v.z>0?1:-1,f=sg>0?r.ttLo+1:r.ttLo,gx=r.kickDir>0?F.L/2:-F.L/2,sp=Math.abs(v.z),c=FOOT_BOX.z+BALL_R+T.margin-ST.gap,a=[];
 for(const w of ttSlides(r)){
  if(w*sg>0&&Math.abs(w)>sp*ST.pushMax)continue;                    // a slide with the ball: it has to overtake the man
  const q=ttPlan(r,f,p,v,w),oc=q.zc-r.baseZ[f];
  if(!(q.d>=0))continue;                                             // too late, or the ball is not coming
  if(!live){const ts=((q.z0-sg*ST.gap-p.z)*sg-c)/Math.max(sp,1),tt=ts<=q.d?ts:q.t-c/Math.max(sp-w*sg,1);if(!(tt>=ST.tilt)||tt>ST.tilt+ST.late)continue;}   // the leg is back before the ball reaches his face (he stands where he is until he starts his slide), and decided as late as that allows
  if(Math.abs(oc)>r.maxOff-0.3||Math.abs(oc+w*ST.hold)>r.maxOff)continue;   // room for the slide to go on through the swing
  const clr=ttOutlet(r,p.x,q.cz,ttObs(r.team,p.x,gx,q.t),gx,ST.k*w);
  a.push({w,f,t:q.t,d:q.d,cz:q.cz,clr,tz:q.cz+Math.abs(gx-p.x)*ST.k*w});
 }
 return a;
}
function ttBest(a){let b=null;for(const o of a)if(!b||o.clr>b.clr)b=o;return b;}
// a committed strike: the leg is back and the man waits; straight or a cut either way is decided at the last moment he can get going, from the rows then
function ttStrike(r,rb,best,D,sp,sg){
 const CA=AIC.catch,T=CA.tictac,ST=T.strike,dir=r.kickDir,dt=1/SIM.hz,p=rb.m.position,v=rb.v,rel=(p.x-r.x)*dir,f=r.ttMan,gx=dir>0?F.L/2:-F.L/2;
 const zm=r.baseZ[f]+r.offset,gap=(zm-p.z)*sg,sa=sideAngle(rel,false)*dir;
 let w=r.ttW,cz,tc;
 r.ttSt+=dt;
 r.pinPose=true;r.pinA=sa;r.aiMan=f;
 if(r.ttSt>ST.abortT){ttCatch(r,f,sg,'slow');return;}
 if(!r.ttGo){
  const a=ttOpts(r,rb,true),b=ttBest(a),tf=(gap-(FOOT_BOX.z+BALL_R+T.margin))/Math.max(sp,1);   // tf: s until the ball reaches his face
  let cur=null;for(const o of a)if(o.w===w)cur=o;
  if(b&&(!cur||b.clr>cur.clr+ST.stick)){cur=b;w=r.ttW=b.w;}
  const ez=ttEase(r);
  if(tf>ST.untilt&&(!cur||cur.clr<ST.back-ez)){ttRevert(r);return;}  // the lane shut with time to spare: the leg squares up again and the ball is bounced
  if(!cur){ttCatch(r,f,sg,'plan');return;}
  r.ttClr=cur.clr;r.ttTz=cur.tz;cz=cur.cz;tc=cur.t;
  if(cur.d<=dt*1.5){                                                 // the last moment to get going
   if(cur.clr<ST.go-ez){ttCatch(r,f,sg,'shut');return;}
   r.ttGo=true;r.ttGoT=S.time;
  }
 }
 r.target=r.ttGo?clamp(r.offset+w*dt,-r.maxOff,r.maxOff):r.offset;
 const cs=sp-r.slideV*sg;                                            // how fast the ball closes on the man
 if(r.ttGo&&(r.ttEv-=dt)<=0){                                        // on his way: given up only if the lane shuts
  r.ttEv=ST.look;tc=Math.max(0,gap-ST.gap)/Math.max(sp-w*sg,1);cz=p.z+v.z*tc;
  const clr=ttOutlet(r,p.x,cz,ttObs(r.team,p.x,gx,tc),gx,ST.k*w);
  if(clr<ST.drop){ttCatch(r,f,sg,'shut');return;}
  r.ttClr=clr;r.ttTz=cz+Math.abs(gx-p.x)*ST.k*w;
 }
 if(!r.ttGo||gap-cs*ST.lag>ST.gap)return;                            // not yet
 if(Math.abs(r.angle-sa)>ST.tolA){ttCatch(r,f,sg,'pose');return;}
 r.target=clamp(r.offset+w*CA.push.lead,-r.maxOff,r.maxOff);          // the gate has to see the slide go on
 if(!strikeOn(r,best,'trapShot')){r.target=clamp(r.offset+w*dt,-r.maxOff,r.maxOff);CAS.ttGate++;return;}
 r.catSv=w;r.catHold=ST.hold;
 r.catAim={best:{tz:r.ttTz,clr:r.ttClr},lanes:[],goalX:gx,ox:p.x,oz:p.z};r.aimEv=r.catAim;
 kickRod(r,'trapShot');
 r.catSw=true;r.cd=D.cd*stCd(r)*aiR(r,AIC.cdSlow[0],AIC.cdSlow[1]);
 CAS.ttShot++;CAS.ttLat+=S.time-r.ttFound;CAS.ttGoLat+=S.time-r.ttGoT;
 catchEnd(r,CA.cd,w?'tt:cut':'tt:straight');
}
// how much less clearance a rally this old settles for: none while it is young, ST.ease at maxT
function ttEase(r){
 const T=AIC.catch.tictac,ST=T.strike;
 return ST.ease*clamp((r.ttT-ST.patient)/Math.max(0.1,T.maxT-ST.patient),0,1);
}
// a strike given up with the ball still on its way: the leg squares up again (the bounce sets the pose every frame) and the rows are not read for a strike again for a moment
function ttRevert(r){
 r.ttPh='bounce';r.ttGo=false;r.ttEv=0;r.ttLock=S.time+AIC.catch.tictac.strike.relock;CAS.ttBack++;
}
// one frame of a tic-tac; phases (r.ttPh): bounce (the ball worked between men ttLo and ttLo+1, the lanes read each way) -> strike, or thru (let past the man it is rolling to, which makes the pair him and the next man)
function ttStep(r,best,D){
 const CA=AIC.catch,T=CA.tictac,ST=T.strike,SQ=T.square,TH=T.thru,dir=r.kickDir,dt=1/SIM.hz,rb=best.real||best,p=rb.m.position,v=rb.v,rel=(p.x-r.x)*dir,lo=r.ttLo,hi=lo+1,sp=Math.abs(v.z),sg=v.z>0?1:-1,fz=FOOT_BOX.z+BALL_R+T.margin;
 let why=null;
 r.ttT+=dt;r.ttRelNow=rel;
 if(rb.scored)why='scored';else if(p.y>AIC.lowY)why='lifted';else if(r.force)why='force';
 else if(!manLive(r,lo)||!manLive(r,hi))why='man';
 else if(rel<T.offMin||rel>T.offMax||Math.abs(v.x)>T.maxVX)why='off';
 else if(r.ttPh!=='thru'&&(p.z<r.baseZ[lo]+r.offset-ST.past||p.z>r.baseZ[hi]+r.offset+ST.past))why='through';
 if(why){catchEnd(r,CA.cd,'tt:'+why);return;}
 r.aiMan=lo;r.pinOn=false;
 if(sp<T.deadV){if((r.ttDead+=dt)>T.deadT){catchEnd(r,0,'tt:dead');return;}}else r.ttDead=0;
 if(sp>T.minV&&sg!==r.ttSg){
  if(r.ttPh!=='bounce'){ttCatch(r,sg>0?hi:lo,sg,'flip');return;}
  r.ttSg=sg;r.ttN++;r.ttEv=0;CAS.ttTouch++;
  if(r.ttN>T.maxTouch){ttCatch(r,sg>0?hi:lo,sg,'touches');return;}
 }
 if(r.ttPh==='bounce'&&r.ttT>T.maxT){ttCatch(r,sg>0?hi:lo,sg,'time');return;}
 if(r.ttPh==='bounce'&&SQ&&SQ.on){                                  // the foot follows the ball's depth while it is between the faces, so a creeping ball does not end the rally
  if((r.ttSq=(r.ttSq||0)-dt)<=0&&sp>T.minV){
   r.ttSq=SQ.every;
   const near=Math.min(p.z-(r.baseZ[lo]+r.offset+fz),r.baseZ[hi]+r.offset-fz-p.z),a=hitAngle(rel);
   if(a==null){ttCatch(r,sg>0?hi:lo,sg,'drift');return;}
   if(near>=SQ.farT*sp)r.ttA+=clamp(a-r.ttA,-SQ.step,SQ.step);
  }
 }else if(r.ttPh==='bounce'&&Math.abs(rel-r.ttRel)>T.drift){ttCatch(r,sg>0?hi:lo,sg,'drift');return;}
 if(r.ttPh==='bounce'&&ST.on&&sp>T.minV&&r.ttN>=ST.warm&&S.time>=(r.ttLock||0)&&(r.ttEv-=dt)<=0){
  r.ttEv=ST.look;CAS.ttLook++;
  const o=ttBest(ttOpts(r,rb,false));
  if(o&&o.clr>=ST.prep-ttEase(r)){
   r.ttPh='strike';r.ttMan=o.f;r.ttW=o.w;r.ttGo=false;r.ttFound=S.time;r.ttSt=0;r.ttEv=0;
   CAS.ttCommit++;CAS[o.w?'ttCut':'ttStraight']++;
  }
 }
 if(r.ttPh==='bounce'&&TH&&TH.on&&TH.roles.indexOf(r.role)>=0&&sp>Math.max(T.minV,TH.minV||0)&&r.ttDec!==r.ttN){   // once a trip to a man with another beyond him: let it through?
  const f=sg>0?hi:lo,n=f+sg,ts=((r.baseZ[f]+r.offset-p.z)*sg-fz)/Math.max(sp,1);
  if(ts<=TH.lead){
   r.ttDec=r.ttN;
   if(ts>=TH.min&&n>=0&&n<r.baseZ.length&&manLive(r,n)&&((r.baseZ[n]-r.baseZ[f])*sg-2*fz)/Math.max(sp,1)>=TH.run&&hitAngle(rel)!=null&&rngAi(r.idx)()<TH.share){
    r.ttPh='thru';r.ttThruF=f;r.ttThruN=n;CAS.ttThru++;
   }
  }
 }
 if(r.ttPh==='strike'){ttStrike(r,rb,best,D,sp,sg);return;}
 if(r.ttPh==='thru'){                                                 // the leg is back and the man stands: the ball rolls under him, and once it is clear the foot squares up for the next man
  const f=r.ttThruF;
  r.aiMan=f;r.pinPose=true;r.pinA=sideAngle(rel,false)*dir;r.target=r.offset;
  if((p.z-(r.baseZ[f]+r.offset))*sg>=TH.past){r.ttLo=Math.min(f,r.ttThruN);r.ttPh='bounce';r.ttEv=0;}
  return;
 }
 r.pinPose=true;r.pinA=r.ttA*dir;
 const hv=T.homeV,hm=clamp(-(r.baseZ[lo]+r.baseZ[hi])/2,-r.maxOff+T.lungeRoom,r.maxOff-T.lungeRoom),stay=hv&&r.ttN>0?clamp(hm-r.offset,-hv*dt,hv*dt):0;   // waiting, the rod drifts to where the pair is centred on the goal (from the first touch: before it, a slow ball rolling the same way would never reach the face)
 if(sp<T.minV){r.target=r.offset;return;}
 const f=sg>0?hi:lo,zf=r.baseZ[f]+r.offset,dist=(zf-sg*fz-p.z)*sg,tw=-sg;   // dist: the ball's run left before it meets his face
 const vm=DIFFS[teamDiff(r.team)].speed*rodSpeedMult(r)*ttVal(r,'pace'),A=AIC.slideAccel*stAgil(r),cur=r.slideV*tw;
 const ramp=Math.max(0,vm-cur)/A,tc=dist/(sp+Math.max(0,cur)),lunge=dist<0.2||tc<=ramp+T.lunge;
 if(lunge&&(tw>0?r.maxOff-r.offset:r.offset+r.maxOff)<T.lungeRoom*0.25){ttCatch(r,f,sg,'room');return;}   // no slide left to go into it: a stationary face would stop it dead
 const MT=T.meet,far=!lunge&&MT&&sp<MT.v&&dist>0&&dist/Math.max(sp,0.1)>MT.t;   // a slow ball far off is gone to: the face slides toward it so it closes at meet.v
 r.target=lunge?clamp(r.offset+tw*vm*dt,-r.maxOff,r.maxOff):far?clamp(r.offset+tw*clamp(MT.v-sp,0,vm)*dt,-r.maxOff,r.maxOff):r.offset+stay;   // slide into it, toward where it came from
}
// one frame of a live catch: pose and slide ahead of the ball, then (caught) carry and play it, or (behind) hand the stopped ball to retrieve; a side catch is sideStep until it pins, a meet is meetStep, a tap is tapStep until it lets go, a tap back is backStep, a fetch is fetchStep
// flift is the leg turning up and forward to let a ball go from a forward pin
function catchStep(r,best,D){
 const CA=AIC.catch,dir=r.kickDir,dt=1/SIM.hz,p=best.m.position,rel=(p.x-r.x)*dir,vf=best.v.x*dir,sp=best.v.length(),zl=F.W/2-BALL_R;
 r.catT+=dt;r.raise=false;r.behindFlag=false;
 if(r.catPh==='tictac'){ttStep(r,best,D);return;}
 if(r.catPh==='tap'){tapStep(r,best);return;}
 if(r.catPh==='flift'){fliftStep(r);return;}
 if(r.catPh==='ahead'){aheadStep(r,best);return;}
 if(r.catPh==='hit'){hitStep(r,best);return;}
 if(r.pinB){
  if(r.catPh==='behind'&&!r.catFwd){CAS.hand++;r.catUntil=S.time+CA.behind.keepIQ;catchEnd(r,0,'handed');return;}
  if(r.catPh!=='hold'){if(r.catPh==='meet')CAS.meetOk++;if(r.catPh==='thru')CAS.thruOk++;if(r.catPh==='behind')CAS.behindOk++;if(r.catPh==='fetch')CAS.fetchOk++;r.catPh='hold';r.catT=0;CAS.pin++;pinPlayStart(r);if(r.tapPend){CAS.tapOk++;r.tapPend=false;if(r.tapHit){CAS.hitOk++;r.tapHit=false;}}}
  r.pinOn=true;r.pinPose=true;r.pinA=r.angle;                     // frozen where it caught
  r.aiMan=r.pinB.pinMan;
  const v=pinPlay(r,best,r.catT,dt,true);
  if(v===3){tapStart(r);return;}
  if(v===4){ttStart(r);return;}
  if((v===1||v===2)&&r.angle*dir>CA.recv.fwdMin&&!(v===1&&r.pcSn)){reseat(r);return;}   // a shot from under a forward leg is the snake, anything else re-seats
  if(v){const f=pinFire(r,best,D,v);if(f){if(f<0)CAS.lost++;catchEnd(r,CA.cd,f<0?'gate':v===2?'passed':r.pcSn?'snake':'shot');}}
  return;
 }
 if(r.catPh==='hold'){CAS.lost++;catchEnd(r,CA.cd,'knocked');return;}
 if(r.catPh==='side'){sideStep(r,best);return;}
 if(r.catPh==='meet'){meetStep(r,best);return;}
 if(r.catPh==='back'){backStep(r,best);return;}
 if(r.catPh==='thru'){thruStep(r,best);return;}
 if(r.catPh==='fetch'){fetchStep(r,best);return;}
 const front=r.catPh==='front',A=front?CA.front:CA.behind;
 // the ball is gone: scored, high, stopped short, running off, past us, or too long
 let why=null;
 if(best.scored)why='scored';else if(p.y>CA.liftY)why='lifted';else if(r.force)why='force';else if(r.catT>CA.abortT)why='time';
 else if(front){if(rel<SHOT.pin.back-1)why='past';else if(vf>1&&rel>A.near)why='away';else if(sp<CA.restV&&rel>SHOT.pin.front+0.3)why='stopped';}
 else{if(rel>(r.catFwd?SHOT.pin.fwdFront:-0.5))why='past';else if(sp<CA.restV&&!(r.catFwd&&recvRest(r)&&S.time-(r.rvRestT||(r.rvRestT=S.time))<CA.recv.rest))why='slow';else if(vf<-1)why='away';}
 if(why==='stopped'&&fetchPick(r,best)){r.catPh='fetch';r.catT=0;r.ftPh=null;CAS.fetch++;CAS.stoppedFetch++;fetchStep(r,best);return;}   // it died short of the leg and lies ahead: take it from above
 if(why){catchEnd(r,CA.cd,why);return;}
 const c=Math.max(2,front?-vf:vf),tAr=Math.max(0,((front?rel:-rel)-(front?0:r.catFwd?CA.recv.take.behind.stop:A.stop))/c);   // a ball from behind that has rolled under the rod to the forward foot has arrived
 const m=catchMan(r,clamp(p.z+best.v.z*tAr,-zl,zl),tAr);
 if(m){r.catMan=m.i;r.catO=m.o;}                                   // re-aim as the ball's line firms up; no man can make it = stay on the last
 r.aiMan=r.catMan;
 r.target=clamp(r.catO,-r.maxOff,r.maxOff);
 if(tAr<=CA.poseT){r.pinOn=true;r.pinPose=true;r.pinFwd=!!r.catFwd&&CA.recv.angle>0;r.pinA=(r.catFwd?CA.recv.angle:A.angle)*dir;}else{r.pinOn=false;r.pinPose=false;r.pinFwd=false;r.pinA=null;}
}
// the passive raise: one rod, one frame, no hand on it; shared by benched rods, AI-off rods in training/trials, and a rod just switched onto
// only decides the angle (never r.target); returns the raise state it settled on
function rodHoldRaise(r){
 let bb=null,bd=1e9;
 for(const b of S.balls){if(b.scored)continue;const d=Math.abs(b.m.position.x-r.x);if(d<bd){bd=d;bb=b;}}
 if(!bb){r.raise=false;r.behindFlag=false;return false;}
 const dir=r.team===0?1:-1,rel=(bb.m.position.x-r.x)*dir,RB=AIC.raiseBack;
 // a resting rod must not stand in a teammate's kick lane: lift only, with the same back-swing guard
 if(RB&&AIC.clearLane.on&&AIC.clearLane.lift&&rel<AIC.clearLane.behind&&rel>-AIC.clearLane.nearBall
    &&bb.m.position.y<AIC.lowY&&!inFootRange(r,bb)&&laneMate(r,bb)){
  r.raise=true;r.behindFlag=false;return true;
 }
 if(inFootRange(r,bb,AIC.underFootBack)||(r.lhT>0&&inFootRange(r,bb))){
  r.raise=false;r.behindFlag=false;                 // ball right at the feet (or the back guard is holding the lift) — never swing back through it
 }else{
  if(!r.behindFlag && RB && rel<AIC.raiseBehind) r.behindFlag=true;
  if(r.behindFlag){
   r.raise=true;
   // release when the ball reaches the feet or has moved well past
   if(rel>AIC.overFootOffset+AIC.overFoot) r.behindFlag=false;
  }else{
   r.raise=RB && rel<AIC.raiseBehind;
  }
 }
 return r.raise;
}
// auto-switch hand-over gate: true = don't give this seat this rod yet (it only withholds)
// releases when stopped, rebounding, out wide, already past or at the feet; maxHold caps it; off in training when the team's AI is off
function autoHoldRod(s,r,b){
 const H=CTRL.handover;
 if(!H||!H.on||!s||!r||!b)return false;
 if(H.roles.indexOf(r.role)<0)return false;                 // not a protected rod
 let hold=false;
 if(seatRod(s)!==r&&!(S.trn&&(r.trnHidden||!S.trn.ai[r.team]))){
  const dir=r.team===0?1:-1,bp=b.m.position;
  const closing=-b.v.x*dir;                                 // >0 = ball running at OUR own goal
  const rel=(bp.x-r.x)*dir;                                 // ball in front of (+) / behind (−) this rod
  // rear limit is -H.behind, not 0: a hard shot can step past the boot between two ticks
  const wide=Math.abs(bp.z-clamp(bp.z,r.baseZ[0]-r.maxOff,r.baseZ[0]+r.maxOff)); // z distance outside its slide range
  // only once the switch would hand this rod over (its zone, else the nearest in x), so the maxHold clock starts when you'd have got it
  const zi=zonePick(s,b);let wins=zi>=0&&s.rods[zi]===r;
  if(zi<0){const d0=Math.abs(bp.x-r.x);wins=true;for(let i=0;i<s.rods.length&&wins;i++)if(s.rods[i]!==r&&Math.abs(bp.x-s.rods[i].x)<d0)wins=false;}
  hold=wins&&closing>H.closing&&rel>-H.behind&&wide<=H.reach;
 }
 if(!hold){if(s.holdRod===r){s.holdRod=null;s.holdT=0;}return false;}  // save over (or never on) — release, and re-arm on the next attack
 if(s.holdRod!==r){s.holdRod=r;s.holdT=S.time;}             // gate just armed — start the clock
 return S.time-s.holdT<H.maxHold;                           // …and never withhold past the cap
}
// --- goal cover (CONFIG.ai.cover) ---
// the keeper and the defender share the mouth: a man's shadow is the stretch of goal line his body hides from the shot point
const CVB=new Float64Array(6),CVS=new Float64Array(6);
function coverMate(r){const want=r.role==='GK'?'DEF':'GK';for(const o of rods)if(o.team===r.team&&o.role===want)return o;return null;}
// writes each live man's shadow into CVB from slot k, returns the next free slot
function coverMen(r,o,ox,oz,gx,k){
 const t0=(r.x-ox)/(gx-ox||1e-3);
 if(t0<=0)return k;                             // behind the shot point: hides nothing
 const t=Math.max(t0,AIC.cover.tMin),h=AIC.gapAim.blockR/t;
 for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;const c=oz+(r.baseZ[i]+o-oz)/t;CVB[k*2]=c-h;CVB[k*2+1]=c+h;k++;}
 return k;
}
// sum of squared open gaps across the mouth [-m,m] (even gaps and more cover both score lower), plus a little for shadows that overlap
function coverGap(k,m){
 for(let a=0;a<k;a++){const l=CVB[a*2],h=CVB[a*2+1];let b=a-1;while(b>=0&&CVS[b*2]>l){CVS[b*2+2]=CVS[b*2];CVS[b*2+3]=CVS[b*2+1];b--;}CVS[b*2+2]=l;CVS[b*2+3]=h;}
 let x=-m,s=0,ov=0;
 for(let a=0;a<k&&x<m;a++){
  const l=CVS[a*2],h=CVS[a*2+1];
  if(l>x){const g=Math.min(l,m)-x;s+=g*g;}else if(x>-m)ov+=Math.max(0,Math.min(x,h,m)-Math.max(l,-m));
  if(h>x)x=h;
 }
 return (x<m?s+(m-x)*(m-x):s)+AIC.cover.overlap*ov;
}
// best slide offsets for `mine` (one or both of keeper/DEF) with `hold`'s men fixed at offset ho; the result array is reused
function coverFit(ox,oz,gx,mine,hold,ho){
 const CV=AIC.cover,m=F.goalHalf*CV.mouth,n=mine.length,o=[0,0],bo=[0,0];
 const cost=()=>{
  let k=hold?coverMen(hold,ho,ox,oz,gx,0):0;
  for(let j=0;j<n;j++)k=coverMen(mine[j],o[j],ox,oz,gx,k);
  let c=coverGap(k,m);
  for(let j=0;j<n;j++)c+=CV.travel*Math.abs(o[j]-mine[j].target);
  return c;
 };
 const m0=mine[0].maxOff,m1=n>1?mine[1].maxOff:0,st=CV.grid,p=[0,0];
 let best=1e9;
 for(let a=-m0;a<=m0+1e-6;a+=st){o[0]=a;
  for(let b=-m1;b<=m1+1e-6;b+=st){o[1]=b;const c=cost();if(c<best){best=c;bo[0]=a;bo[1]=b;}}
 }
 // the grid is too coarse to see the cost valley the pair already sits in, so polish from the current slots too and keep the better
 const polish=(a0,b0)=>{
  p[0]=a0;p[1]=b0;o[0]=a0;o[1]=b0;let pc=cost();
  for(let s=st/2;s>=CV.refine;s/=2)for(let rep=0;rep<2;rep++)for(let j=0;j<n;j++)for(let sg=-1;sg<=1;sg+=2){
   o[0]=p[0];o[1]=p[1];o[j]=clamp(p[j]+sg*s,-mine[j].maxOff,mine[j].maxOff);
   const c=cost();if(c<pc){pc=c;p[j]=o[j];}
  }
  if(pc<best){best=pc;bo[0]=p[0];bo[1]=p[1];}
 };
 polish(bo[0],bo[1]);
 polish(clamp(mine[0].target,-m0,m0),n>1?clamp(mine[1].target,-m1,m1):0);
 return bo;
}
// the live man whose shadow sits nearest the middle of the mouth
function coverMan(r,o,ox,oz,gx){
 const t=Math.max((r.x-ox)/(gx-ox||1e-3),AIC.cover.tMin);let bi=-1,bd=1e9;
 for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;const d=Math.abs(oz+(r.baseZ[i]+o-oz)/t);if(d<bd){bd=d;bi=i;}}
 return bi;
}
// how far from the ball-to-goal line this rod can afford to stand: the slide it can still make before the ball gets to its boot
function coverReach(r,relFront){
 const CV=AIC.cover,E=AIC.defend.engage;
 if(relFront<=E)return CV.reachMax;
 const T=(relFront-E)/Math.max(Math.hypot(r.aiBVX,r.aiBVZ),CV.vFloor);   // a ball at rest still gets there, slowly
 return Math.min(CV.reachMax,DIFFS[teamDiff(r.team)].speed*CV.speedMul*Math.max(0,T-CV.slack));
}
// z this keeper/DEF man takes to share the goal with its mate; NaN when this rod is the one playing the ball (or has no mate to share with)
// the DEF only covers while the ball is out in front of it: a ball at or behind it is its to play, so it stays on the ball's z
function coverZ(r,bzp,relFront,dt){
 const CV=AIC.cover,E=AIC.defend.engage,dir=r.team===0?1:-1,gk=r.role==='GK',mate=coverMate(r);
 if(!mate||mate.trnHidden){r.cvM=0;return NaN;}
 const g=gk?r:mate,d=gk?mate:r,bx=r.aiBX,gx=dir>0?-F.L/2:F.L/2;
 const relD=(bx-d.x)*dir,dEng=relD>E,gEng=(bx-g.x)*dir>E;
 const wide=r.cvW=gk&&Math.abs(r.aiBZ-clamp(r.aiBZ,g.baseZ[0]-g.maxOff,g.baseZ[0]+g.maxOff))>CV.gkWide;   // out beyond the keeper's slide: the DEF takes it, the keeper holds the goal
 if(gk?!gEng&&!wide:!dEng){r.cvM=0;return NaN;}
 const close=-r.aiBVX*dir,shot=clamp((close-CV.shotV[0])/(CV.shotV[1]-CV.shotV[0]),0,1),s=Math.max(clamp((relD-E)/CV.blend,0,1),shot),ox=lerp(d.x+dir*CV.nomAhead,bx,s),oz=bzp*lerp(CV.nomZ,1,s);   // real ball once it is out in front or flying at goal, else an assumed shot point
 const pair=dEng&&gEng&&!isUserRod(mate)&&!mate.act&&!mate.force&&isActiveRod(mate),mode=pair?2:1;
 if(r.cvM!==mode||(r.cvT-=dt)<=0){
  r.cvM=mode;r.cvT=CV.every;
  if(pair){const o=coverFit(ox,oz,gx,[g,d]);g.cvO=o[0];d.cvO=o[1];mate.cvM=2;mate.cvT=CV.every;}
  else r.cvO=coverFit(ox,oz,gx,[r],mate,isUserRod(mate)?mate.offset:mate.target)[0];
 }
 let z;
 if(gk)z=r.baseZ[0]+r.cvO;
 else{
  const mi=coverMan(r,r.cvO,ox,oz,gx);
  r.aiMan=mi;                                   // man selection keeps this man, so the rod lands on the fitted offset
  z=r.baseZ[mi]+r.cvO;
 }
 const iz=bzp*(1-clamp((r.x-bx)/((gx-bx)||1e-3),0,1)),Rb=coverReach(r,relFront),R=gk&&!dEng?(wide?lerp(CV.reachMax,Rb,shot):Math.min(Rb,CV.playReach)):Rb;   // a wide ball is no reason to stay on its line, unless it is flying at the goal
 const cz=iz+clamp((z-iz)*CV.mix,-R,R);
 if(!gk||!(shot>0)||!CV.gkFollow)return cz;
 const k=r.aiBVZ/r.aiBVX*DIFFS[teamDiff(r.team)].pred*stPred(r),zc=r.aiBZ+k*(r.x-bx),zg=r.aiBZ+k*(gx-bx);   // its read of the shot along the heading it sees: where it crosses this rod, and the goal line
 return lerp(cz,zc,shot*CV.gkFollow*clamp((F.goalHalf+BALL_R+CV.gkPost-Math.abs(zg))/CV.gkPost,0,1));   // a shot going in: the keeper goes for it
}
 function aiUpdate(dt){
  recordBalls();               // snapshot every ball's true state this step so rods can read it delayed
  pickActiveRods(dt);
  const Dred=DIFFS[teamDiff(0)];
  const Dblue=DIFFS[teamDiff(1)];
  const GA=AIC.gapAim,FC=AIC.force;
  for(const r of rods){
   if(isUserRod(r))continue;
   r.raiseKeep=false;                     // an inherited raise (js/seats.js) dies the moment the AI has the rod back
   r.force=false;                         // set below once the rod has its ball; slideBlocked reads it
   // training: a hidden rod or an AI-off team never chases or swings
   // TRN.lift[team] picks flat obstacle (false) or the passive raise (true)
   if(S.trn&&(r.trnHidden||!S.trn.ai[r.team])){
    if(r.act==='retrieve')retrieveEnd(r,0);
    else if(r.act==='catch')catchEnd(r,0);
    r.act=null;r.aimEv=null;r.target=r.offset;
    if(!r.trnHidden&&S.trn.lift&&S.trn.lift[r.team])rodHoldRaise(r);
    else{r.raise=false;r.behindFlag=false;}
    continue;
   }
   r.aimEv=null;                          // cleared each frame; set only while gap-aiming (debug + hold read it)
   // how many men are still on the pitch (a cannonball can remove them); none = out of the aim/kick logic
   let liveN=0;for(let i=0;i<r.baseZ.length;i++)if(manLive(r,i))liveN++;
   if(!liveN){if(r.act==='retrieve')retrieveEnd(r,0);else if(r.act==='catch')catchEnd(r,0);r.raise=false;r.behindFlag=false;r.act=null;continue;}
   // --- post-kick hold-evade (CONFIG.ai.heldFwd) ---
   // after a kick a slow ball in the drop-sweep window keeps the rod forward and slides the men away; re-aim and re-kick are suppressed until it leaves
   const HF=AIC.heldFwd;
   if(HF.on&&(r.heldFwd||r.evadeHold>0)){
    let hb=null,hd=1e9;const hdir=r.team===0?1:-1;
    for(const b of S.balls){if(b.scored)continue;const rel=(b.m.position.x-r.x)*hdir;
     if(rel<-HF.xBack||rel>HF.xFront)continue;
     const ad=Math.abs(rel);if(ad<hd){hd=ad;hb=b;}}
    if(hb&&hb.v.length()<HF.maxSpeed){
     const cz=FOOT_BOX.z+BALL_R+HF.zMargin,bz=hb.m.position.z;
     const fh=FC.on&&deadzoneMult(hb.cur)===1&&deadLeft(hb)<FC.left,push=fh&&inLaneZ(r,bz,cz);   // forced: keep sliding away while still over the ball, whatever the budget says
     if(!r.evadeSpent||push){
      r.evadeHold=(r.evadeHold||0)+dt;                          // latch: persists past the swing's completion so re-aim can't re-grab the ball
      if(r.evadeHold<HF.abortT||push){                          // within the budget → slide AWAY + suppress re-aim/kick
       const prefer=evadeDir(r,hb,cz,HF.vz);                    // committed once per latch — genuinely no dither
       let o=clearOffset(r,bz,cz,prefer);
       if(o==null)o=clearOffset(r,bz,cz,0);                     // no room that way — take the nearest clear either side
       if(o!=null)r.target=o;
       r.aiMan=-1;                                              // free man-index hysteresis for the post-release re-pick
       if(dbgLogRod===r)dbgRod(r,'HELD-ESC','rel='+((hb.m.position.x-r.x)*hdir).toFixed(1)+' tgt='+r.target.toFixed(1)+' t='+r.evadeHold.toFixed(1));
       continue;
      }
      r.evadeSpent=true;                                        // budget spent: stop pinning, drop when z-clear, let the dead-ball redrop relieve it
      if(dbgLogRod===r)dbgRod(r,'HELD-SPENT','evade budget spent — releasing to dead-ball');
     }else if(fh&&r.kickT>=0)continue;                          // forced and clear of the ball: let the swing drop before going back to it
     // spent: fall through to the normal path
    }else{r.evadeHold=0;r.evadeSpent=false;r.evadeDir=0;}       // ball left the x-window / sped up → rearm (fresh direction next time)
   }
   if(!isActiveRod(r)){
    if(dbgLogRod===r)dbgRod(r,'BENCH');
    if(r.act==='retrieve')retrieveEnd(r,0);          // benched mid-retrieve: let go of the pin and the lift
    else if(r.act==='catch')catchEnd(r,0);
    else if(r.act==='run')runEnd(r,'benched');
    else if(r.act==='recv')recvEnd(r,'benched');
    // lane-holding means don't aim/kick; raise stays live on the bench or a rod fresh off a serve sits in the ball's path
    rodHoldRaise(r);
    continue;
  }   // a resting hand: hold its lane, block passively
   const D=r.team===0?Dred:Dblue;
   let best=null,bd=1e9;
   for(const b of S.balls){if(b.scored)continue;
    const d=Math.abs(b.m.position.x-r.x);if(d<bd){bd=d;best=b;}}
   if(!best){r.target=0;r.raise=false;r.behindFlag=false;continue;}
   // from here 'best' is a delayed proxy (real ball at .real); nearest-ball selection above stays live
   best=aiView(r,best,(D.reactDelay||0)*stReact(r));
   const k=1-Math.exp(-dt/Math.max(.02,D.react*stReact(r)));   // rea stat + stamina fade
   const predL=D.pred*stPred(r);                               // iq stat scales trajectory anticipation
  r.aiBX=lerp(r.aiBX,best.m.position.x,k);
  r.aiBZ=lerp(r.aiBZ,best.m.position.z,k);
  r.aiBVX=lerp(r.aiBVX,best.v.x,k);
  r.aiBVZ=lerp(r.aiBVZ,best.v.z,k);
  // aim error drifts toward a fresh target instead of snapping
  r.aiErrT-=dt;
  if(r.aiErrT<=0){const R=rngAi(r.idx);r.aiErrT=rngR(R,AIC.errEvery[0],AIC.errEvery[1]);r.aiErrTarget=rngR(R,-D.err,D.err)*stErr(r);r.aiGoalZ=rngR(R,-1,1);r.aiIQ=R()<clamp((D.iq||0)*stIQ(r),0,1);}
  r.aiErr=lerp(r.aiErr,r.aiErrTarget,Math.min(1,AIC.errLerp*dt));
  const dir=r.team===0?1:-1;
  let pz=r.aiBZ;
  const tta=r.aiBVX!==0?(r.x-r.aiBX)/r.aiBVX:-1;
  if(tta>0&&tta<AIC.ttaMax)pz+=r.aiBVZ*tta*predL;
  pz+=r.aiErr;
  // goal targeting: aim at a spot in the mouth (tight when accurate, sprayed when not) and shift the man to the side that sends it there; clamped small so the foot connects
  const bp0=best.m.position;
  const relFront=(bp0.x-r.x)*dir;               // ball ahead(+)/behind(−) this rod, dir-relative
  const force=r.force=FC.on&&relFront>-DEAD.live.back&&relFront<DEAD.live.ahead&&deadzoneMult(best.real.cur)===1&&deadLeft(best.real)<FC.left;   // the whistle is close and the ball is in this rod's reach (not a dead zone): stop deliberating and play it
  const DEF=AIC.defend,CV=AIC.cover;
  const cvz=(CV.on&&!force&&(r.role==='GK'||r.role==='DEF')&&bp0.y<AIC.lowY)?coverZ(r,r.aiBZ+((tta>0&&tta<AIC.ttaMax)?r.aiBVZ*tta*predL:0),relFront,dt):NaN;
  if(cvz===cvz){
   pz=lerp(pz,cvz,r.aiIQ||r.cvW?1:CV.dumbBias);   // cover: split the mouth with the other of keeper/DEF (a keeper never half-chases a ball it can't reach)
  }else if(DEF.on && (r.role==='GK'||r.role==='DEF') && bp0.y<AIC.lowY && relFront>DEF.engage){
   // --- defending an incoming ball ---
   // sit on the ball-to-own-goal line so GK and DEF cover the shot at two depths
   const ogx=dir>0?-F.L/2:F.L/2;                 // this rod's OWN goal x
   const lead=(tta>0&&tta<AIC.ttaMax)?r.aiBVZ*tta*predL:0;
   const bzp=r.aiBZ+lead;                        // predicted ball z (smoothed)
   const t=clamp((r.x-r.aiBX)/((ogx-r.aiBX)||1e-3),0,1); // fraction ball→goal at this rod's x
   const iz=bzp*(1-t);                           // z where the ball→goal-centre line crosses this rod
   pz=lerp(pz,iz,DEF.lineBias*(r.aiIQ?1:DEF.dumbBias)); // smart rods commit; dumb rods only lean in
  }else if(bp0.y<AIC.lowY){
   // --- attacking / clearing: angle the strike toward the opponent goal ---
   const goalX=dir>0?F.L/2:-F.L/2, dx=Math.max(8,Math.abs(goalX-bp0.x)), acc=stAim(r,D.aim!=null?D.aim:0.6);
   const spray=(r.aiGoalZ||0)*(1-acc)*F.goalHalf*AIC.aimSpread;
   let gz;
   if(GA.gap&&r.aiIQ&&acc>=GA.minAcc){
    // smart + accurate: steer at the widest open lane, with reduced spray on top
    const ev=shotEval(r.team,bp0.x,bp0.z,undefined,aimCone(r));r.aimEv=ev;
    gz=clamp(ev.best.tz+spray*GA.sprayMix,-F.goalHalf*AIC.aimGoalZ,F.goalHalf*AIC.aimGoalZ);
   }else{
    gz=clamp(spray,-F.goalHalf*AIC.aimGoalZ,F.goalHalf*AIC.aimGoalZ); // old centre + full spray
   }
   pz+=clamp(-((gz-bp0.z)/dx)*AIC.aimGain,-AIC.aimMax,AIC.aimMax);
  }
  if(force)pz=bp0.z;                            // square up on the ball, no aim bend or drifting error
  if(r.role==='GK')pz=clamp(pz,-F.goalHalf-AIC.gkPad,F.goalHalf+AIC.gkPad);
  const bp=best.m.position;
  const relReal=(bp.x-r.x)*dir;           // real ahead/behind for reach decisions
  const speed=best.v.length();
  const approach=best.v.x*dir;            // >0 = ball closing on this rod's front face (read by clearLane/trap/evade)
  // x-distance from the ball to this rod's own goal line
  const ownGx=dir>0?-F.L/2:F.L/2;
  const goalDist=Math.abs(bp.x-ownGx);
  const slow=speed<AIC.slowSpeed;
  // --- alignment against the man closest to the real ball z (skips removed men) ---
  let mz=null;
  for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;const z=r.baseZ[i]+r.offset;if(mz===null||Math.abs(bp.z-z)<Math.abs(bp.z-mz))mz=z;}
  const dz=Math.abs(bp.z-mz);
  const overFoot=relReal>(AIC.overFootOffset-AIC.overFoot) && relReal<(AIC.overFootOffset+AIC.overFoot); // ball in the forward-offset feet zone (mostly in front of the men, not behind)
  const inFront=relReal>AIC.inFrontMin&&relReal<AIC.inFrontMax;// ball ahead within a forward swing
  // wall-hug rescue: a wall ball beyond the outermost man's range is still in capsule reach, so count it aligned and swing it loose
  const wallHug=Math.abs(bp.z)>F.W/2-AIC.wallReach && Math.abs(r.offset)>r.maxOff-AIC.wallSlack
                && (bp.z-mz)*r.offset>0 && dz<AIC.wallReach;
  const aligned=dz<(slow?AIC.alignSlow:AIC.alignFast)||wallHug||(force&&dz<FC.align);
  // --- raise latch ---
  // once the ball goes behind the rod it stays raised until the ball reaches the feet (no mid-approach drop)
  // footStuck (full back-reach) vetoes back-swing actions; latchStuck (tight under-foot reach) drops the latch
  const footStuck=inFootRange(r,best);
  // ...or the back guard is holding this rod's lift with a ball in reach
  const latchStuck=inFootRange(r,best,AIC.underFootBack)||(r.lhT>0&&footStuck);
   if(latchStuck){
    r.raise=false;r.behindFlag=false;       // ball right at the feet — drop, never swing back through it
   }else{
    if(!r.behindFlag && AIC.raiseBack && relReal<AIC.raiseBehind) r.behindFlag=true;
    if(r.behindFlag){
     r.raise=true;
     // release when the ball reaches the feet or has moved well past
     if(overFoot || relReal>AIC.overFootOffset+AIC.overFoot) r.behindFlag=false;
    }else{
     r.raise=AIC.raiseBack && relReal<AIC.raiseBehind;
    }
   }
  // --- lane-clear action (r.act='lane') ---
  // make way for a teammate behind us about to hit the ball forward through our row; runs before safeRaise/trap/evade
  // slides out of the corridor, then lifts once the back-swing can't clip; releases at CL.release, a struck ball holds it open until CL.passed
  const CL=AIC.clearLane;
  if(r.act==='lane'){
   r.actT+=dt;
   const struck=approach>CL.throughV;
   if(relReal>(struck?CL.passed:CL.release)||bp.y>AIC.lowY||r.actT>CL.abortT||(!struck&&!laneMate(r,best))){
    r.act=null;r.laneDir=0;r.laneCd=CL.cd;
   }
  }else if(CL.on&&!r.act&&(r.laneCd||0)<=0&&bp.y<AIC.lowY&&relReal<CL.behind&&relReal>-CL.nearBall&&laneMate(r,best)){
   r.act='lane';r.actT=0;r.laneDir=0;
  }
  if(r.act==='lane'){
   const cz=FOOT_BOX.z+BALL_R+CL.laneMargin,blocked=inLaneZ(r,bp.z,cz);
   r.raise=AIC.raiseBack&&CL.lift&&!footStuck;   // lift only when the back-swing can't clip the ball; the slide clears z, then this opens
   r.behindFlag=false;                     // the action owns the angle — no latch to release
   if(blocked){
    if(!r.laneDir){const o0=clearOffset(r,bp.z,cz,0);r.laneDir=(o0!=null&&o0>=r.offset)?1:-1;} // committed once, like evadeDir
    let o=clearOffset(r,bp.z,cz,r.laneDir);
    if(o==null)o=clearOffset(r,bp.z,cz,0);  // no room that way — nearest clear either side
    if(o!=null)r.target=o;
   }else r.target=r.offset;                 // already out of the corridor: hold, don't drift off our spot
   r.aiMan=-1;                              // free the man-index hysteresis for the re-pick on handover
   if(dbgLogRod===r)dbgRod(r,'ACT:lane','rel='+relReal.toFixed(1)+' appr='+approach.toFixed(1)+' tgt='+r.target.toFixed(1)+' blk='+(blocked?1:0)+' lift='+(r.raise?1:0));
   continue;                                // we own target + man: no re-aim, no kick
  }
  // --- catch (CONFIG.ai.catch) ---
  // a ball running at the rod from upfield or from the rod behind: pin it, carry it to a way forward, play it; owns r.target, the pose and the man
  const CA=AIC.catch;
  if(r.catSw){if(r.kickT>=0){r.target=r.offset+(r.catHold&&r.kickT>=r.catHold?0:(r.catSv||0))*dt;r.aimEv=r.catAim;continue;}r.catSw=false;r.catSv=0;r.catHold=0;}   // a pin shot's swing: the slide it left on (a push) or none, no re-aim
  if(r.act==='run'){runStep(r,best,D,dt);if(r.act==='run'||r.kickT>=0)continue;}   // the run-up for a free pass owns target + man
  if(!r.act&&r.kickT<0&&!r.pinB)recvPossess(r,best);                  // the ball is the team's and behind it: stand ready for it
  if(r.act==='recv'||(!r.act&&r.kickT<0&&!r.pinB&&(r.rvUntil||0)>S.time&&recvStart(r))){recvStep(r,best,D,dt);if(r.act==='recv')continue;}   // a pass is coming at this rod: the pin pose, the man on its line
  if(r.act==='catch')catchStep(r,best,D);
  else if(CA.on&&!r.act&&!force&&r.kickT<0&&!r.pinB&&bp.y<AIC.lowY&&goalDist>CA.ownGoalGuard&&CA.roles.indexOf(r.role)>=0){
   const ph=(r.catCd||0)<=0?catchPick(r,best):(ttRoll(r,best)?'tictac':null);   // a ball rolling along the row is worked even straight after a catch ended (the rally has its own cooldown)
   if(ph){r.act='catch';r.actT=0;r.catPh=ph;r.catT=0;CAS.enter++;CAS[ph]++;catchStep(r,best,D);}
  }
  if(r.act==='catch'){
   if(dbgLogRod===r)dbgRod(r,'ACT:catch/'+r.catPh,'rel='+relReal.toFixed(1)+' spd='+speed.toFixed(0)+' t='+r.catT.toFixed(2)+' pin='+(r.pinB?1:0)+' tgt='+r.target.toFixed(1));
   continue;                                // we own target + man + pose: no re-aim, no kick
  }
  // --- retrieve (CONFIG.ai.retrieve) ---
  // slow ball behind the heel; runs before safeRaise/evade and owns r.target, r.raise and the man
  const RT=AIC.retrieve;
  let retRan=false;
  if(r.act==='retrieve'){
   r.actT+=dt;
   // hand back once the ball speeds up, lifts, enters the kick zone, slips out of reach, or it runs too long
   const rSpeed=S.time<(r.retKnow||0)?(best.real||best).v.length():speed;   // right after a re-seat the delayed view still shows the ball carried
   if(!RT.on||bp.y>AIC.lowY||(rSpeed>=RT.bailSpeed&&!r.pinB)||approach>RT.bailApproach||relReal>RT.exitRel||relReal<-RT.backMax-1.2||r.actT>RT.abortT)retrieveEnd(r,RT.cd);
   else{retrieveStep(r,best,D);retRan=true;}
  }else if(RT.on&&!force&&!r.act&&(r.retCd||0)<=0&&r.kickT<0&&bp.y<AIC.lowY&&speed<RT.maxSpeed&&approach<=RT.maxApproach
           &&relReal<RT.enterRel&&relReal>-RT.backMax&&retrieveMan(r,bp.z)){
   r.act='retrieve';r.actT=0;r.retDir=0;r.retZ=null;r.retMan=-1;r.retFl=false;BGS.retEnter++;retrievePhase(r,'side');
   retrieveStep(r,best,D);retRan=true;
  }
  if(retRan)continue;
  const TR=AIC.trap, SR=AIC.safeRaise;
  // keeper gets a longer safe-raise window in front: the ball loiters further out for a keeper
  const srFront=SR.front+(r.role==='GK'?(SR.gkFront||0):0);
  const srIn=srGoingIn(r,best);
  // --- safe-raise action (r.act='safeRaise') ---
  // a slow sideways ball behind the rod, not far enough back for the raise latch: ease to SR.angle while a man slides in behind it
  if(r.act==='safeRaise'){
   r.actT+=dt;
   // good-hit override: bail out of the lift this frame so the normal kick gate fires
   const srKick=(overFoot||inFront)&&aligned&&r.kickT<0&&r.cd<=0;
   // footStuck bail: the ball drifted into the back-swing reach, so drop instead of sweeping through it
   if(srKick||footStuck||srIn||relReal<=SR.back||relReal>=srFront||speed>SR.maxSpeed||Math.abs(best.v.x)>=SR.maxVX||bp.y>AIC.lowY||r.actT>SR.abortT){r.act=null;r.raise=false;r.behindFlag=false;}
   else{r.raise=false;r.behindFlag=false;}         // the action owns the angle while it holds
  }else if(SR.on&&(r.aiIQ||(SR.gkAlways&&r.role==='GK'))&&!r.act&&!srIn&&bp.y<AIC.lowY&&relReal>SR.back&&relReal<srFront&&Math.abs(best.v.x)<SR.maxVX&&speed<SR.maxSpeed&&!footStuck){
   r.act='safeRaise';r.actT=0;r.raise=false;r.behindFlag=false;
  }
  // lift depth follows the ball (deep behind, shallow in front); backLimit holds it short of a hit
  if(r.act==='safeRaise')r.srA=(relReal<SR.behindRel?SR.angleBehind:SR.angle)*r.kickDir;
  // --- trap action (r.act='trap') ---
  // a smart rod pins a slow ball, carries it sideways hunting a shooting lane, then scoops it (catch, carry, shoot off r.actT)
  // owns r.target and r.aiMan; collideRod switches to the sticky hold contact; exits when the ball leaves, speeds up, lifts, nears our goal or times out
  // z-gate: outfield needs an aligned man; the GK also commits up to gkReach beyond its slide band
  const trapZ=r.role==='GK'?Math.abs(bp.z-clamp(bp.z,r.baseZ[0]-r.maxOff,r.baseZ[0]+r.maxOff))<TR.gkReach:dz<TR.alignZ;
  // --- entry guards ---
  // approach gated to [minApproach, maxApproach] (negative min so a still ball qualifies); no trap inside TR.ownGoalGuard, and a live trap aborts
  // the catch tilts the foot back, so a ball behind the feet gets the big margin
  const ogGuard=relReal<TR.behindSafe?TR.ownGoalBehind:TR.ownGoalGuard;
  // defer to the dribble: the windows overlap and a settled ball is better served by it
  // (dribEvT<=0 mirrors the dribble's scan cadence, so the deferral lasts one refusal)
  const dribFirst=AIC.dribble.on&&AIC.dribble.roles.indexOf(r.role)>=0&&(r.dribCd||0)<=0&&(r.dribEvT||0)<=0
                  &&relReal>AIC.dribble.back&&relReal<AIC.dribble.front&&dz<AIC.dribble.alignZ
                  &&speed<AIC.dribble.maxSpeed&&goalDist>AIC.dribble.ownGoalGuard
                  &&approach>AIC.dribble.minApproach&&approach<AIC.dribble.maxApproach;
  if(r.act==='trap'){
   r.actT+=dt;
   // exit once the ball escapes the band, speeds up, lifts, nears our goal, or we held too long
   // no footStuck abort here: entry already implies it and it killed every trap a frame in
   if(relReal<=TR.back||relReal>=TR.front||speed>TR.maxSpeed||bp.y>AIC.lowY||goalDist<ogGuard||r.actT>TR.abortT){r.act=null;r.trapMan=-1;r.trapDir=0;r.trapA=null;}
  }else if(TR.on&&r.aiIQ&&!r.act&&!dribFirst&&relReal>TR.back&&relReal<TR.front&&bp.y<AIC.lowY&&Math.abs(best.v.x)<TR.maxVX&&speed<TR.maxSpeed&&trapZ
           &&approach>TR.minApproach&&approach<TR.maxApproach&&goalDist>ogGuard){
   // sweep guard: the costliest gate, so it runs last
   // would the rotation that starts the trap swing a boot through the ball? (world angles both sides)
   const ta=trapAngle(r,best,r.angle,TR.angle*r.kickDir);
   if(ta===null){
    if(dbgLogRod===r)dbgRod(r,'TRAP-VETO','no clean catch angle: rel='+relReal.toFixed(1)+' dz='+dz.toFixed(2)+' a='+r.angle.toFixed(2)+'->'+(TR.angle*r.kickDir).toFixed(2));
   }else{
    // commit to the live man nearest the ball in z and remember where it was caught
    let tm=-1,td=1e9;
    for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;const d=Math.abs(bp.z-(r.baseZ[i]+r.offset));if(d<td){td=d;tm=i;}}
    r.act='trap';r.actT=0;r.trapMan=tm;r.trapZ0=bp.z;r.trapDir=0;r.trapA=ta;  // not gated on r.raise — a slow ball at an aligned foot is caught directly, latched or not
   }
  }
  if(r.act==='trap'){
   r.raise=false;r.behindFlag=false;       // trap owns the angle (updateRods) — latch released
   const tm=(r.trapMan>=0&&r.trapMan<r.baseZ.length&&manLive(r,r.trapMan))?r.trapMan:0;
   // z-distance to the one man trapping (not dz, the nearest of any); past holdZ nothing is held
   const tdz=Math.abs(bp.z-(r.baseZ[tm]+r.offset));
   let shot=false;
   if(r.actT>TR.settleT){
    // --- carry ---
    // sliding the rod dribbles the held ball while the boot touches it; contact lost ends the trap
    // scoop if a lane is open, else commit to the side whose lanes probe better until one opens, slideMax runs out or holdT expires
    if(tdz>TR.holdZ){                       // contact lost — not a trap any more
     if(dbgLogRod===r)dbgRod(r,'TRAP-LOST','tdz='+tdz.toFixed(2)+' > holdZ '+TR.holdZ);
     r.act=null;r.trapMan=-1;r.trapDir=0;r.trapA=null;
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
     // strikeOn has the last word: tdz only says the ball is in the boot's lane, not that the scoop will land
     if((open||timeUp)&&tdz<TR.alignZ&&r.kickT<0&&r.cd<=0&&strikeOn(r,best,'trapShot')){
      if(dbgLogRod===r)dbgRod(r,'TRAPSHOT',(open?'lane open':'hold expired')+' clr='+ev.best.clr.toFixed(1)+' rel='+relReal.toFixed(1)+' tdz='+tdz.toFixed(2)+' carried='+(bp.z-r.trapZ0).toFixed(1));
      kickRod(r,'trapShot');                // scoop shot with dedicated trap power window
      r.cd=D.cd*stCd(r)*aiR(r,AIC.cdSlow[0],AIC.cdSlow[1]);
      r.trapMan=-1;r.trapDir=0;r.trapA=null;shot=true;
     }else if(timeUp){                      // held long enough but never squared up — give the ball back
      r.act=null;r.trapMan=-1;r.trapDir=0;r.trapA=null;
     }else{
      // aim a short carryLead past the ball, not the far end of the budget (slideMax is cumulative from the catch)
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
  // --- dribble action (r.act='dribble') ---
  // ball at the feet of a resting row with no way forward: slide it to a better line; updateRods is untouched (men stay down), only the contact and r.target/r.aiMan change
  // released by the way forward opening, arriving, pressure or time, as an ordinary swing or a pass; outranks the trap (see dribFirst)
  const DR=AIC.dribble;
  if(r.act==='dribble'){
   r.actT+=dt;
   const dmC=(r.dribMan>=0&&r.dribMan<r.baseZ.length&&manLive(r,r.dribMan))?r.dribMan:-1;
   const ddzC=dmC<0?1e9:Math.abs(bp.z-(r.baseZ[dmC]+r.offset));
   // contact lost, ball escaped, sped up, lifted, near our goal, or timed out: hand back with no shot
   if(dmC<0||ddzC>DR.holdZ||relReal<=DR.back||relReal>=DR.front||speed>DR.maxSpeed||bp.y>AIC.lowY
      ||goalDist<DR.ownGoalGuard||r.actT>DR.abortT){
    if(dbgLogRod===r)dbgRod(r,'DRIB-END','ddz='+(dmC<0?'-':ddzC.toFixed(2))+' rel='+relReal.toFixed(1)+' spd='+speed.toFixed(0)+' t='+r.actT.toFixed(2));
    r.act=null;r.dribMan=-1;r.dribCd=DR.cd;
   }
  }else if(DR.on&&(!DR.iqGate||r.aiIQ)&&!r.act&&(r.dribCd||0)<=0&&r.kickT<0&&DR.roles.indexOf(r.role)>=0
           &&bp.y<AIC.lowY&&relReal>DR.back&&relReal<DR.front&&dz<DR.alignZ&&speed<DR.maxSpeed
           &&approach>DR.minApproach&&approach<DR.maxApproach&&goalDist>DR.ownGoalGuard&&(r.dribEvT||0)<=0){
   r.dribEvT=DR.reEval;                     // cadence gate: the sampled scan below is the pricey part
   const obs=laneObs(r.team,bp.x,dir>0?F.L/2:-F.L/2);
   if(outletClr(r,bp.x,bp.z,obs)<DR.coveredClr||Math.abs(bp.z)>DR.wideZ){   // no way forward, or out wide
    let dmi=-1,dd=1e9;
    for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;const d2=Math.abs(bp.z-(r.baseZ[i]+r.offset));if(d2<dd){dd=d2;dmi=i;}}
    if(dmi>=0){
     r.dribMan=dmi;                          // set BEFORE dribTarget — it scans that man's own reach
     const tz=dribTarget(r,bp.x,bp.z,obs);
     if(Math.abs(tz-bp.z)>DR.minGain){r.act='dribble';r.actT=0;r.dribZ0=bp.z;r.dribZ=tz;}
     else r.dribMan=-1;                      // nothing to gain by moving it — let the normal path play it
    }
   }
  }
  if(r.act==='dribble'){
   // men down, no angle override: updateRods drops the rod to its rest ease
   r.raise=false;r.behindFlag=false;
   const dm=(r.dribMan>=0&&r.dribMan<r.baseZ.length&&manLive(r,r.dribMan))?r.dribMan:0;
   const ddz=Math.abs(bp.z-(r.baseZ[dm]+r.offset));
   const dev=shotEval(r.team,bp.x,bp.z,undefined,aimCone(r));r.aimEv=dev;   // live goal lanes — feeds the release aim + debug
   const outNow=outletClr(r,bp.x,bp.z);                // …and the way-forward score this action tracks
   if((r.dribEvT||0)<=0){                              // re-aim as the opposing row shifts
    r.dribEvT=DR.reEval;
    const tz=dribTarget(r,bp.x,bp.z);
    if(Math.abs(tz-r.dribZ)>DR.retargetDead)r.dribZ=tz;
   }
   const open=outNow>=DR.lineClear, arrived=Math.abs(bp.z-r.dribZ)<DR.arrive;
   const timeUp=r.actT>DR.holdT, pressed=dribPressed(r,bp.x,bp.z);
   const want=open||arrived||timeUp||pressed;      // …we'd like to play it now
   let dshot=false;
   // release needs the normal alignment test (not the looser dribble tolerance); wanting to play but not squared up stops pushing and aims at the ball
   if(want&&aligned&&ddz<DR.holdZ&&r.kickT<0&&r.cd<=0){
    // release with an ordinary swing, or a pass if a teammate's outlet beats the shot by pass.bias
    const pk=open?null:passPick(r,bp.x,bp.z);
    // ...and only if the pass swing will connect; failing the gate plays the ordinary swing instead
    const wantPass=!!pk&&DR.pass.on&&DR.pass.roles.indexOf(r.role)>=0
                   &&pk.score>dev.best.clr*DR.pass.shotBias+DR.pass.bias
                   &&strikeOn(r,best,'pass');
    if(dbgLogRod===r)dbgRod(r,wantPass?'DRIB-PASS':'DRIB-HIT',
     (open?'way forward open':arrived?'arrived':pressed?'closed down':'time up')
     +' out='+outNow.toFixed(1)+' moved='+(bp.z-r.dribZ0).toFixed(1)
     +(wantPass?' → '+pk.rod.role+' z='+pk.z.toFixed(1)+' pc='+pk.clr.toFixed(1)+' on='+pk.onward.toFixed(1):''));
    if(wantPass)kickRod(r,'pass',{x:pk.x,z:pk.z});
    else kickRod(r);
    r.cd=D.cd*stCd(r)*aiR(r,AIC.cdSlow[0],AIC.cdSlow[1]);
    r.dribMan=-1;r.dribCd=DR.cd;dshot=true;
   }else{
    // work it: aim a short lead past the ball toward the target, capped by the travel budget
    // want without alignment squares up (lead 0)
    const step=want?0:clamp(r.dribZ-bp.z,-DR.carryLead,DR.carryLead);
    const cz=clamp(bp.z+step,r.dribZ0-DR.slideMax,r.dribZ0+DR.slideMax);
    r.target=clamp(cz-r.baseZ[dm],-r.maxOff,r.maxOff);
   }
   if(!dshot){
    r.aiMan=dm;
    if(dbgLogRod===r)dbgRod(r,'ACT:dribble','rel='+relReal.toFixed(1)+' ddz='+ddz.toFixed(2)+' tgt='+r.dribZ.toFixed(1)+' out='+outNow.toFixed(1)+' t='+r.actT.toFixed(2));
    continue;                                // we own target + man while we work — no re-aim, no kick
   }
  }
  // --- evade action (r.act='evade') ---
  // a slow ball stuck behind a man (not trapping or lifting): slide the men away until it's out of foot range
  // direction opposite the ball's z-drift, else its side; skips man-selection and kick
  const EV=AIC.evade;
  // maxApproach is the mirror of the trap's minApproach: evade wants a settled ball, not one rolling in
  if(r.act==='evade'){
   r.actT+=dt;
   // separate success from giving up: only success earns the follow-through
   const evCleared=!inFootRange(r,best);
   const evBail=overFoot||inFront||r.behindFlag||speed>=EV.maxSpeed||approach>EV.maxApproach
                ||bp.y>AIC.lowY||r.actT>EV.abortT||relReal>-(EV.behindDead-0.5);
   if(evCleared||evBail){
    r.act=null;r.evadeDir=0;r.evadeCd=EV.cd;
    // follow-through: on a clean clear, latch the raise so the drop sweeps forward through the ball
    // r.evadeCd blocks a re-entry while that plays out
    if(evCleared&&!evBail&&EV.raiseAfter){r.raise=true;r.behindFlag=true;}
   }
  }else if(EV.on&&!r.act&&!r.behindFlag&&(r.evadeCd||0)<=0&&!overFoot&&!inFront&&bp.y<AIC.lowY&&speed<EV.maxSpeed&&approach<=EV.maxApproach&&inFootRange(r,best)&&relReal<-EV.behindDead){
   r.act='evade';r.actT=0;r.evadeDir=0;      // fresh direction, committed on the first frame below
  }
  // kick-log trace (C then L): one line per action change
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
  // --- man selection ---
  // always runs so the rod is already at the strike z; removed men are skipped
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
  // --- foot-trap break ---
  // drop a raised rod when a slow ball is pinned at a foot; the raise latch takes priority
  if(r.raise && !r.behindFlag && bp.y<AIC.lowY && speed<AIC.footTrapSlow){
   let fz=1e9;for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;fz=Math.min(fz,Math.abs(bp.z-(r.baseZ[i]+r.offset)));}
   if(fz<AIC.footTrapZ) r.raise=false;
  }
  // --- drop the rod once the ball is in reach and a man is aligned ---
  // not while the latch is engaged, or the rod kicks the ball backward
  if(r.raise && !r.behindFlag && (overFoot||inFront) && aligned && bp.y<AIC.lowY && speed<AIC.repositionSpeed*1.4) r.raise=false;
  // --- sweet-spot wait ---
  // a smart rod with the ball inbound through the inFront window holds its swing until the overFoot arrival
  const wait=r.aiIQ&&!overFoot&&inFront&&tta>0&&tta<AIC.waitTta&&Math.abs(r.aiBVX)>AIC.waitMinVX;
  // --- hold for a better shot ---
  // a smart ATT/MID with no open lane keeps the ball up to gapAim.holdMax, then fires; defenders never hold; dribble.noPoke widens it to inFront
  let holdShot=false;
  const holdReach=overFoot||(DR.on&&DR.noPoke&&inFront&&DR.roles.indexOf(r.role)>=0);
  if(GA.gap&&r.aiIQ&&r.aimEv&&holdReach&&slow&&(r.role==='ATT'||r.role==='MID')&&r.aimEv.best.clr<GA.openMargin){
   r.shotHoldT=(r.shotHoldT||0)+dt;holdShot=r.shotHoldT<GA.holdMax;
  }else r.shotHoldT=0;
  // swing at anything we can hit; !r.act since a named action owns the rod
  const canKick=r.kickT<0 && (r.cd<=0||force) && !r.act && (overFoot||inFront||force) && aligned && bp.y<AIC.lowY && (force||(!wait&&!holdShot));
  if(dbgLogRod===r)dbgKickGate(r,{fired:canKick,overFoot,inFront,aligned,low:bp.y<AIC.lowY,wait,holdShot,rel:relReal,dz,speed,act:r.act});
  if(canKick){
   // a covered shot with a teammate ahead who has a better one becomes a pass (wider role list than the dribble); the keeper passes to the DEF whenever a man is in reach
   const PS=DR.pass,gkp=r.role==='GK'&&PS.gk&&PS.gk.on&&speed<=PS.gk.maxBall;
   let aimAt=null,pk=null;
   if(PS.on&&PS.onKick&&PS.roles.indexOf(r.role)>=0&&(gkp||(r.aiIQ&&r.aimEv&&r.aimEv.best.clr<PS.onKickClr))){
    const fm=freeBall(r,best);
    pk=passPick(r,bp.x,bp.z,fm?'free':undefined);
    if(pk&&pk.clr>=PS.minClear){
     // a pass well off straight, off a slow ball: run at it first (false = the run owns this pass); with no run possible it is an ordinary kick, not a pass it cannot deliver
     if(fm&&!gkp&&Math.abs(pk.th)>AIC.catch.steer.free.standing){if(runStart(r,best,pk))aimAt=false;}
     // a pass is only on if a boot will be on the ball when the soft curve contacts (strikeOn); refused = ordinary kick
     else if(strikeOn(r,best,'pass'))aimAt={x:pk.x,z:pk.z};
    }
   }
   if(aimAt&&dbgLogRod===r)dbgRod(r,'PASS','→ '+pk.rod.role+' z='+pk.z.toFixed(1)+' pc='+pk.clr.toFixed(1)+' on='+pk.onward.toFixed(1)+' shotClr='+(r.aimEv?r.aimEv.best.clr.toFixed(1):'-'));
   if(aimAt!==false&&!(aimAt===null&&gkHold(r,bp,speed,dt))){
    kickRod(r,aimAt?'pass':null,aimAt);
    r.gkWaitT=0;r.gkClearT=0;
    r.cd=D.cd*stCd(r)*(slow?aiR(r,AIC.cdSlow[0],AIC.cdSlow[1]):aiR(r,AIC.cdFast[0],AIC.cdFast[1])); // rea stat trims recovery
   }
  }
 }
}
