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
function strikeProbe(r,b,style){
 const SG=AIC.strikeGate,KS=styleCfg(style);
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
function strikeOn(r,bv,style){
 const SG=AIC.strikeGate;
 if(!SG||!SG.on)return true;
 if(SG.styles.indexOf(style||'kick')<0)return true;
 const b=(SG.useReal&&bv&&bv.real)?bv.real:bv;
 if(!b||b.scored)return false;
 if(b.v.length()>SG.maxBallSpeed){                    // too quick to be PLACED by a soft, aimed swing
  if(dbgLogRod===r)dbgRod(r,'GATE:'+(style||'kick').toUpperCase(),'refused — ball at '+b.v.length().toFixed(0)+'u/s > maxBallSpeed '+SG.maxBallSpeed);
  return false;
 }
 const c=strikeProbe(r,b,style);
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
// angle updateRods may ease toward instead of aT; stamps r.lhT when it holds a lift
function backLimit(r,aT,rate){
 const G=AIC.backGuard;
 if(!G||!G.on||!G.lift||r.kickT>=0||seatOf(r)||(aT-r.angle)*r.kickDir>=0)return aT;
 const h=backHit(r,aT,r.offset,rate);
 if(h===null)return aT;
 BGS.lift++;r.lhT=G.holdT;r.bgT=S.time;
 return h;
}
// would sliding o0 to o1 shove a ball behind the boot? (contact, or the lane while lifted)
function slideBlocked(r,o0,o1){
 const G=AIC.backGuard;
 if(!G||!G.on||!G.slide||o1===o0||r.kickT>=0||r.pinB||r.act==='trap'||r.act==='dribble'||(r.act==='retrieve'&&r.retPh==='pin')||(r.force&&r.role!=='GK')||seatOf(r))return false;
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
 r.pinOn=false;r.pinPose=false;r.pinA=null;
 r.act=null;r.retPh=null;r.retMan=-1;r.retDir=0;r.retZ=null;r.retCd=cd||0;
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
 const RT=AIC.retrieve,dir=r.kickDir,dt=1/SIM.hz,p=best.m.position,bz=p.z,rel=(p.x-r.x)*dir;
 r.raise=false;r.behindFlag=false;r.aiMan=-1;
 r.retT+=dt;
 const cz=FOOT_BOX.z+BALL_R+AIC.clearMargin+RT.sideMargin;
 const mn=retrieveMan(r,bz);
 if(!mn){retrieveEnd(r,RT.cd);return;}                  // slid out of reach (the ball rolled to a wall)
 if(r.retPh==='side'){
  if(inLaneZ(r,bz,cz)){
   if(!r.retDir){
    // committed once, away from the man on the ball (the near side crosses the lane)
    let nm=-1,nd=1e9;
    for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;const d=Math.abs(bz-(r.baseZ[i]+r.offset));if(d<nd){nd=d;nm=i;}}
    const away=(nm>=0&&r.baseZ[nm]+r.offset-bz<0)?-1:1;
    if(clearOffset(r,bz,cz,away)!=null)r.retDir=away;
    else if(rel<RT.crossRel)r.retDir=-away;            // the ball is beyond the reach of a boot sliding past it: the other way is free
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
   const pin=RT.pin&&rel>SHOT.pin.back+0.2&&(r.aiIQ||r.role==='GK'||!RT.pinIQ);
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
  if(!r.retHold)BGS.retPin++;
  r.target=r.offset;r.retHold+=dt;                      // caught: the pin carries the ball with the rod
  if(r.retHold>=RT.settleT&&r.kickT<0&&r.cd<=0){
   if(strikeOn(r,best,'trapShot')){
    BGS.retShot++;
    kickRod(r,'trapShot');                              // the pin shot: releases the pin, pulls back, strikes through
    r.cd=D.cd*stCd(r)*aiR(r,AIC.cdSlow[0],AIC.cdSlow[1]);
    retrieveEnd(r,RT.cd);
   }else retrievePhase(r,'drop');
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
function laneObs(team,bx,tx){
 const dir=team===0?1:-1,GA=AIC.gapAim,obs=[];
 for(const r2 of rods){
  if(r2.team===team)continue;                                     // only opponents block
  if((r2.x-bx)*dir<=GA.minAhead||(r2.x-tx)*dir>0)continue;         // must sit between ball and target
  for(let i=0;i<r2.baseZ.length;i++){if(r2.removedUntil[i]&&r2.removedUntil[i]>S.time)continue;obs.push({x:r2.x,z:r2.baseZ[i]+r2.offset});}
 }
 return obs;
}
// how far the line (bx,bz)-(tx,tz) misses the nearest blocker in z; >0 gets through, <0 is covered
function lineClr(obs,bx,bz,tx,tz){
 let clr=1e9;const denom=(tx-bx)||1e-3;
 for(const o of obs){const t=(o.x-bx)/denom,lz=bz+(tz-bz)*t,d=Math.abs(lz-o.z)-AIC.gapAim.blockR;if(d<clr)clr=d;}
 return clr;
}
// gap-aware shot evaluation: score target z's across the goal mouth by clearance to the nearest blocker; `obs` can be passed in when scanning many z's
function shotEval(team,bx,bz,obs){
 const dir=team===0?1:-1,goalX=dir>0?F.L/2:-F.L/2,GA=AIC.gapAim;
 const span=F.goalHalf*AIC.aimGoalZ;
 if(!obs)obs=laneObs(team,bx,goalX);
 const n=GA.samples,lanes=[];
 for(let s=0;s<n;s++){
  const tz=n>1?-span+2*span*(s/(n-1)):0;
  lanes.push({tz,clr:lineClr(obs,bx,bz,goalX,tz)});
 }
 let best=lanes[0];
 for(const l of lanes){if(l.clr>best.clr+1e-3||(Math.abs(l.clr-best.clr)<=1e-3&&Math.abs(l.tz)<Math.abs(best.tz)))best=l;}
 return {lanes,best,goalX,ox:bx,oz:bz};
}
// --- dribble support ---
// z-gap past the opposing row directly in front of the ball
function fwdClr(team,bx,bz){
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
 for(let i=0;i<row.baseZ.length;i++){if(!manLive(row,i))continue;d=Math.min(d,Math.abs(bz-(row.baseZ[i]+row.offset)));}
 return (d===1e9?1e3:d)-GA.blockR;
}
// how good is the way forward from (bx,bz)? ATT: the shooting lane; everyone else: the gap past the row in front
function outletClr(r,bx,bz,obs){
 const fwd=fwdClr(r.team,bx,bz);
 if(r.role!=='ATT')return fwd;
 return Math.min(fwd,shotEval(r.team,bx,bz,obs).best.clr);
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
function passEval(r,bx,bz){
 const P=AIC.dribble.pass,dir=r.team===0?1:-1;
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
   const onward=shotEval(r.team,o.x,tz).best.clr;
   const score=clr*P.wClear+onward*P.wOnward-ahead*P.wDist;
   if(!best||score>best.score)best={rod:o,man:i,x:o.x,z:tz,clr,onward,score};
  }
 }
 return best;
}
// cached wrapper, the scan above is the priciest thing the AI does; runs on a cadence (pass.every)
function passPick(r,bx,bz){
 const P=AIC.dribble.pass;
 if(!P.on)return null;
 if((r.passEvT||0)>0)return r.passEv;
 r.passEvT=P.every;
 return r.passEv=passEval(r,bx,bz);
}
// the passive raise: one rod, one frame, no hand on it; shared by benched rods, AI-off rods in training/trials, and a rod just switched onto
// only decides the angle (never r.target); returns the raise state it settled on
function rodHoldRaise(r){
 let bb=null,bd=1e9;
 for(const b of S.balls){if(b.scored)continue;const d=Math.abs(b.m.position.x-r.x);if(d<bd){bd=d;bb=b;}}
 if(!bb){r.raise=false;r.behindFlag=false;return false;}
 const dir=r.team===0?1:-1,rel=(bb.m.position.x-r.x)*dir;
 // a resting rod must not stand in a teammate's kick lane: lift only, with the same back-swing guard
 if(AIC.clearLane.on&&AIC.clearLane.lift&&rel<AIC.clearLane.behind&&rel>-AIC.clearLane.nearBall
    &&bb.m.position.y<AIC.lowY&&!inFootRange(r,bb)&&laneMate(r,bb)){
  r.raise=true;r.behindFlag=false;return true;
 }
 if(inFootRange(r,bb,AIC.underFootBack)||(r.lhT>0&&inFootRange(r,bb))){
  r.raise=false;r.behindFlag=false;                 // ball right at the feet (or the back guard is holding the lift) — never swing back through it
 }else{
  if(!r.behindFlag && rel<AIC.raiseBehind) r.behindFlag=true;
  if(r.behindFlag){
   r.raise=true;
   // release when the ball reaches the feet or has moved well past
   if(rel>AIC.overFootOffset+AIC.overFoot) r.behindFlag=false;
  }else{
   r.raise=rel<AIC.raiseBehind;
  }
 }
 return r.raise;
}
// auto-switch hand-over gate: true = don't give this seat this rod yet (it only withholds)
// releases when stopped, rebounding, out wide, already past or at the feet; maxHold caps it; off in training when the team's AI is off
function autoHoldRod(s,r,b){
 const H=CTRL.handover;
 if(!H||!H.on||!s||!r||!b)return false;
 if(H.roles.indexOf(r.role)<0)return false;                 // not a protected rod — nearest-rod exactly as before
 let hold=false;
 if(seatRod(s)!==r&&!(S.trn&&(r.trnHidden||!S.trn.ai[r.team]))){
  const dir=r.team===0?1:-1,bp=b.m.position;
  const closing=-b.v.x*dir;                                 // >0 = ball running at OUR own goal
  const rel=(bp.x-r.x)*dir;                                 // ball in front of (+) / behind (−) this rod
  // rear limit is -H.behind, not 0: a hard shot can step past the boot between two ticks
  const wide=Math.abs(bp.z-clamp(bp.z,r.baseZ[0]-r.maxOff,r.baseZ[0]+r.maxOff)); // z distance outside its slide range
  // ...and only once this rod would win the nearest-rod scan, so the maxHold clock starts when you'd have got it
  const d0=Math.abs(bp.x-r.x);let nearest=true;
  for(let i=0;i<s.rods.length&&nearest;i++)if(s.rods[i]!==r&&Math.abs(bp.x-s.rods[i].x)<d0)nearest=false;
  hold=nearest&&closing>H.closing&&rel>-H.behind&&wide<=H.reach;
 }
 if(!hold){if(s.holdRod===r){s.holdRod=null;s.holdT=0;}return false;}  // save over (or never on) — release, and re-arm on the next attack
 if(s.holdRod!==r){s.holdRod=r;s.holdT=S.time;}             // gate just armed — start the clock
 return S.time-s.holdT<H.maxHold;                           // …and never withhold past the cap
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
    r.act=null;r.aimEv=null;r.target=r.offset;
    if(!r.trnHidden&&S.trn.lift&&S.trn.lift[r.team])rodHoldRaise(r);
    else{r.raise=false;r.behindFlag=false;}
    continue;
   }
   r.aimEv=null;                          // cleared each frame; set only while gap-aiming (debug + hold read it)
   // how many men are still on the pitch (a cannonball can remove them); none = out of the aim/kick logic
   let liveN=0;for(let i=0;i<r.baseZ.length;i++)if(manLive(r,i))liveN++;
   if(!liveN){if(r.act==='retrieve')retrieveEnd(r,0);r.raise=false;r.behindFlag=false;r.act=null;continue;}
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
  const DEF=AIC.defend;
  if(DEF.on && (r.role==='GK'||r.role==='DEF') && bp0.y<AIC.lowY && relFront>DEF.engage){
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
    const ev=shotEval(r.team,bp0.x,bp0.z);r.aimEv=ev;
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
    if(!r.behindFlag && relReal<AIC.raiseBehind) r.behindFlag=true;
    if(r.behindFlag){
     r.raise=true;
     // release when the ball reaches the feet or has moved well past
     if(overFoot || relReal>AIC.overFootOffset+AIC.overFoot) r.behindFlag=false;
    }else{
     r.raise=relReal<AIC.raiseBehind;
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
   r.raise=CL.lift&&!footStuck;            // lift only when the back-swing can't clip the ball; the slide clears z, then this opens
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
  // --- retrieve (CONFIG.ai.retrieve) ---
  // slow ball behind the heel; runs before safeRaise/evade and owns r.target, r.raise and the man
  const RT=AIC.retrieve;
  let retRan=false;
  if(r.act==='retrieve'){
   r.actT+=dt;
   // hand back once the ball speeds up, lifts, enters the kick zone, slips out of reach, or it runs too long
   if(!RT.on||bp.y>AIC.lowY||speed>=RT.bailSpeed||approach>RT.bailApproach||relReal>RT.exitRel||relReal<-RT.backMax-1.2||r.actT>RT.abortT)retrieveEnd(r,RT.cd);
   else{retrieveStep(r,best,D);retRan=true;}
  }else if(RT.on&&!force&&!r.act&&(r.retCd||0)<=0&&r.kickT<0&&bp.y<AIC.lowY&&speed<RT.maxSpeed&&approach<=RT.maxApproach
           &&relReal<RT.enterRel&&relReal>-RT.backMax&&retrieveMan(r,bp.z)){
   r.act='retrieve';r.actT=0;r.retDir=0;r.retZ=null;r.retMan=-1;BGS.retEnter++;retrievePhase(r,'side');
   retrieveStep(r,best,D);retRan=true;
  }
  if(retRan)continue;
  const TR=AIC.trap, SR=AIC.safeRaise;
  // keeper gets a longer safe-raise window in front: the ball loiters further out for a keeper
  const srFront=SR.front+(r.role==='GK'?(SR.gkFront||0):0);
  // --- safe-raise action (r.act='safeRaise') ---
  // a slow sideways ball behind the rod, not far enough back for the raise latch: ease to SR.angle while a man slides in behind it
  if(r.act==='safeRaise'){
   r.actT+=dt;
   // good-hit override: bail out of the lift this frame so the normal kick gate fires
   const srKick=(overFoot||inFront)&&aligned&&r.kickT<0&&r.cd<=0;
   // footStuck bail: the ball drifted into the back-swing reach, so drop instead of sweeping through it
   if(srKick||footStuck||relReal<=SR.back||relReal>=srFront||speed>SR.maxSpeed||Math.abs(best.v.x)>=SR.maxVX||bp.y>AIC.lowY||r.actT>SR.abortT){r.act=null;r.raise=false;r.behindFlag=false;}
   else{r.raise=false;r.behindFlag=false;}         // the action owns the angle while it holds
  }else if(SR.on&&(r.aiIQ||(SR.gkAlways&&r.role==='GK'))&&!r.act&&bp.y<AIC.lowY&&relReal>SR.back&&relReal<srFront&&Math.abs(best.v.x)<SR.maxVX&&speed<SR.maxSpeed&&!footStuck){
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
   const dev=shotEval(r.team,bp.x,bp.z);r.aimEv=dev;   // live goal lanes — feeds the release aim + debug
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
   // a covered shot with a teammate ahead who has a better one becomes a pass (wider role list than the dribble)
   const PS=DR.pass;
   let aimAt=null,pk=null;
   if(PS.on&&PS.onKick&&r.aiIQ&&PS.roles.indexOf(r.role)>=0&&r.aimEv&&r.aimEv.best.clr<PS.onKickClr){
    pk=passPick(r,bp.x,bp.z);
    // a pass is only on if a boot will be on the ball when the soft curve contacts (strikeOn); refused = ordinary kick
    if(pk&&pk.clr>=PS.minClear&&strikeOn(r,best,'pass'))aimAt={x:pk.x,z:pk.z};
   }
   if(aimAt&&dbgLogRod===r)dbgRod(r,'PASS','→ '+pk.rod.role+' z='+pk.z.toFixed(1)+' pc='+pk.clr.toFixed(1)+' on='+pk.onward.toFixed(1)+' shotClr='+r.aimEv.best.clr.toFixed(1));
   kickRod(r,aimAt?'pass':null,aimAt);
   r.cd=D.cd*stCd(r)*(slow?aiR(r,AIC.cdSlow[0],AIC.cdSlow[1]):aiR(r,AIC.cdFast[0],AIC.cdFast[1])); // rea stat trims recovery
  }
 }
}
