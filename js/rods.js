'use strict';
/* ================= rods ================= */
// isUserRod/seatOf live in js/seats.js: a rod is 'the user's' when any seat holds it

// a figurine's meshes share materials across men, so fading one in on respawn needs its own instances; setManVisible is the hard show/hide, setManOpacity lazily clones on the first sub-1 write and restores the originals at opacity 1
function forEachManMesh(m,cb){m.traverse(c=>{if(c.isMesh)cb(c);});}
function restoreManMats(m){
  if(!m.userData.fadeMats)return;
  for(const {mesh,orig} of m.userData.fadeMats)mesh.material=orig;
  m.userData.fadeMats=null;
}
function setManVisible(m,v){
  if(m.visible===v)return;
  m.visible=v;
  if(!v&&m.userData.fadeMats)restoreManMats(m);   // going hidden mid-fade: drop the clones
}
function setManOpacity(m,k){
  if(k>=1){                                       // fully opaque: back to shared mats
    if(m.userData.fadeMats){
      forEachManMesh(m,mesh=>{mesh.material.transparent=false;mesh.material.opacity=1;});
      restoreManMats(m);
    }
    return;
  }
  if(!m.userData.fadeMats){                        // first sub-1 write: clone each mesh's material
    m.userData.fadeMats=[];
    forEachManMesh(m,mesh=>{const orig=mesh.material;const c=orig.clone();c.transparent=true;c.opacity=k;mesh.material=c;m.userData.fadeMats.push({mesh,orig});});
  }
  forEachManMesh(m,mesh=>{mesh.material.opacity=k;});
}
function rodSpeedMult(r){
  const e=S.eff[r.team];let m=stSpeed(r);   // spd stat + stamina fade (1 with no build)
  if(e.frozen>S.time)m*=KICK.freezeMult;
 return m;
}
// a swing by name: CONFIG.swings is the only source of a kick (player and AI); ai.js's forecasts read the same block
function styleCfg(name){return SWINGS[name||'pass'];}
// the swing in play; updateRods and collideRod both read it
function kickStyleCfg(r){return styleCfg(r.kickStyle);}
// was a contact a real front-face strike or a side/back graze? nx is the contact normal's world-x (dir-relative ~+1 in front, ~0 side, negative behind)
// it gates only r.passTo, so side clips aren't bent toward a receiver; shots, clears and human kicks are untouched
function passFaceOK(r,nx){
 const SG=AIC.strikeGate;
 if(!SG||!SG.on||!SG.faceOnContact)return true;
 return nx*r.kickDir>=SG.faceDot;
}
// ball control: while a hold is live (no swing in flight) collideRod reads holdRest/holdGrip/sideRest from the returned block and the slide scales by carryMult
function holdCfg(r){
 if(r.kickT>=0)return null;                        // a swing in flight is a release, never a hold
 // the player's hold (L2), blended by trigger depth per seat (buildRods, shotHoldUpdate); r.act is only written by ai.js, which skips user rods
 if(r.hold&&r.hold.on)return r.hold;
 if(r.act!=='retrieve'||r.retPh!=='pin')return null;
 // the AI's retrieve lowering onto the ball: the player's hold fully squeezed (shots.hold)
 const H=CONFIG.shots.hold,F=holdCfg.full||(holdCfg.full={});   // one block, rewritten in place (read per man per substep)
 F.holdRest=H.rest;F.sideRest=KICK.sideRest*(H.side!=null?H.side:0);F.holdGrip=H.grip;F.carryMult=H.carry;
 return F;
}
// name: a swing in CONFIG.swings (default 'pass'); a new kick is a new block there, fired by its name
// aimAt (optional): a {x,z} the strike bends toward instead of the goal (a pass), for this swing only; k (optional): the wind-up a shot carries
function kickRod(r, name, aimAt, k){
 if(r.kickT>=0)return;
 name=name||'pass';
 const SW=styleCfg(name);
 if(!SW||SW.strikeA==null){console.warn('kickRod: no swing "'+name+'" in CONFIG.swings');return;}
 if(SW.pow!=null)shotArm(r,SW,k??-1);              // the trims ride in the swing's own block, player and AI alike
 r.raise=false;r.raiseKeep=false;r.kickHold=false;r.kickT=0;r.act=null;r.kickStyle=name;   // a fresh swing is never born held: js/input.js sets kickHold right after, for a human press only
 r.chg=-1;r.chgSrc=null;r.chgA=null;r.trem=0;      // a swing IS the release: no wind-up survives it
 r.kickHit=false;                                  // debug tracer: set true by collideRod on real contact this swing
 r.evadeHold=0;r.evadeSpent=false;r.evadeDir=0;    // fresh post-kick held-evade budget + escape direction for this swing
 r.laneDir=0;                                      // …and any lane-clear escape direction (r.act was just nulled)
 r.passTo=aimAt||null;                             // pass target for this swing only
 if(typeof recvArm==='function'){if(aimAt)recvArm(r,aimAt);else recvRelease(r);}   // the rod a pass is aimed at gets ready; any other kick lets the mates ahead go back up (ai.js)
 r.swOver=0;r.swF=0;r.swMx=0;                     // overspeed this swing may carry past maxV (shots.js shotFire / physics.js capSpeed, for a charge)
 if(r.pinB)pinRelease(r);                          // a swing lets a pinned ball go, and this swing is what strikes it (physics.js)
 r.kickA0=r.angle/(r.kickDir||1);                  // rod-local angle the swing STARTS from (see updateRods)
 r.msSw=false;                                     // match-stats shot latch: one attempt per swing (matchstats.js msContact)
 stExertKick(r);                                   // stamina channel B: the swing costs THIS rod (stats.js)
 msKick(r);                                        // matchstats.js: team + per-rod kick count
}
function resetRodRotation(){
 for(const r of rods){
  r.angle=0;r.prevAngle=0;r.rvW=0;   // the other team's delayed look starts afresh (ai.js rodView)
   r.kickT=-1;r.kickStyle=null;r.raise=false;r.raiseKeep=false;r.heldFwd=false;r.evadeHold=0;r.evadeSpent=false;r.evadeDir=0;r.kickA0=0;r.tcSpin=0;
   r.padAngleOn=false;r.padAngleTarget=0;r.padCarry=false;r.kickHold=false;r.exStk=false;   // a stick angle, held kick or stick-swing latch left on a rod outranks the rest-drop; they die with the rally
  shotReset(r);                                    // charge/arming/tremble die with the rally (js/shots.js)
  r.act=null;r.actT=0;r.laneDir=0;r.laneCd=0;r.pkB=null;r.pkT=-1e9;
  if(r.hold)r.hold.on=false;
  r.passTo=null;r.passEv=null;r.passEvT=0;
  r.catPh=null;r.catMan=-1;r.catCd=0;r.catSw=false;r.catSv=0;r.catSl=0;r.catHold=0;r.rnPh=null;r.rnCd=0;r.rvUntil=0;r.rvReady=false;r.rvLaneT=0;r.rvCd=0;r.gkWaitT=0;r.gkClearT=0;r.retFl=false;r.retKnow=0;r.tapF=false;r.catFwd=false;r.ftCd=0;r.ftPh=null;r.ahPh=null;r.unPh=null;r.unT=-9;r.unCd=0;r.hPh=null;r.tapHit=false;r.htT=0;r.pinFwd=false;r.ttOn=false;r.ttPh=null;r.ttCd=0;r.ttRoll=null;r.ttPk=null;r.tgV=0;r.tgP=null;r.hd=null;r.ha=null;r.hdGV=0;r.hdW=null;r.puPh=null;r.puB=false;r.kwT0=0;r.kwS=-9;r.tgF=0;r.rnShot=false;r.tapCd=0;r.ttRlT=0;r.ttRlOk=false;
  if(r.behindFlag!=null)r.behindFlag=false;
  r.pivot.rotation.z=0;
 }
}
// the snake (shots.js shotSnakeFire): from the forward pin over the top of the rod, round and through the ball from behind
// r.angle stays within ±π, so the turn is one wrap: prevAngle moves with it (angVel and physics' substeps read it as continuous) and lerpAng draws across it
function snakeStep(r,dt){
 r.kickT+=dt;let a=snakeA(kickStyleCfg(r),r.kickT,r.kickA0||0);
 r.heldFwd=false;
 if(a==null){a=0;r.kickT=-1;r.kickStyle=null;shotDisarm(r);}
 if(a>Math.PI)a-=2*Math.PI;
 r.angle=a*r.kickDir;
 if((r.angle-r.prevAngle)*r.kickDir<-Math.PI)r.prevAngle-=2*Math.PI*r.kickDir;
}
// --- swing curves (rod-local angle T s into a swing; null = over): updateRods and the F4 pose lab ---
function snakeA(KS,T,a0){
 const a1=2*Math.PI+KS.strikeA,t1=KS.spin+KS.follow;
 if(T<KS.spin)return a0+(a1-a0)*Math.pow(T/KS.spin,KS.ease);
 if(T<t1)return a1;
 if(T<t1+KS.back)return a1+(2*Math.PI-a1)*((T-t1)/KS.back);   // unwrapped: past π
 return null;
}
// windup>0 pulls back from kA0 to windupA first; the strike ramps from there (else from kA0) to strikeA
function swingA(KS,T,kA0){
 if(T<KS.windup)return kA0+(KS.windupA-kA0)*(T/KS.windup);
 if(T<KS.strike){const a0=KS.windup>0?KS.windupA:kA0;return a0+(KS.strikeA-a0)*((T-KS.windup)/(KS.strike-KS.windup));}
 if(T<KS.hold)return KS.strikeA;
 if(T<KS.drop)return KS.strikeA*(1-(T-KS.hold)/(KS.drop-KS.hold));
 return null;
}
// --- AI slide (CONFIG.ai.slide) ---
// accel-capped; braking onto a target and following a moving one, a speed command (target = offset + v·dt) driven as given
function aiSlide(r,ms,cvS,dt){
 const SL=AIC.slide,aR=rodAcc(r)*cvS*(pushBurst(r)?AIC.catch.push.play.acc:1),acc=aR*dt;
 const SR=SL.strike,srel=(r.aiBX-r.x)*r.kickDir;
 const brk=(Array.isArray(SL.brake)?SL.brake[r.team]:SL.brake)&&SL.roles.indexOf(r.role)>=0&&SL.diffs.indexOf(teamDiff(r.team))>=0&&!(r.act!=='run'&&SR.roles.indexOf(r.role)>=0&&srel>SR.rel[0]&&srel<SR.rel[1]);   // a striker with the ball in reach keeps the old run: its overshoot is the shot's slide
 const d=r.target-r.offset,tgD=(r.target-(r.tgP==null?r.target:r.tgP))/dt;
 const cmd=brk&&Math.abs(d)<=ms*dt+1e-6&&Math.abs(tgD-r.slideV)<=SL.cmdTol;   // target = offset + v·dt (a run, a cushion, a stop): a slide speed asked for, not a place to stop at
 const tgM=Math.abs(tgD)>ms?0:tgD;   // a jump faster than the rod slides is a new target, not motion
 r.tgF=cmd?0:lerp(r.tgF||0,tgM,Math.min(1,dt*SL.ffLerp));
 const forwardCarry=r.pinB&&r.catPh==='hold'&&r.pcFwdDir&&r.pcTz!=null;
 const hitSetup=r.catPh==='hit'&&(r.hPh==='clear'||r.hPh==='aim');
 const oldB=(r.clOn&&AIC.calm.brake)||(r.act==='catch'&&(forwardCarry||hitSetup));
 const braking=brk?!(r.catSw&&r.kickT>=0)&&(!cmd||oldB):oldB;   // a planned strike slide is driven as given
 const tv=brk&&!cmd&&r.tgF*tgM>0?clamp(Math.sign(tgM)*Math.min(Math.abs(r.tgF),Math.abs(tgM)),-ms,ms):0;   // never faster than the target moves now: a spot gliding in (the reaction smoothing) slows while the read of it lags
 const want=clamp(braking?tv+Math.sign(d)*Math.min(Math.abs(d)/dt,Math.sqrt(2*aR*Math.abs(d))):d/dt,-ms,ms);
 r.slideV=clamp(want,r.slideV-acc,r.slideV+acc);
 r.offset=clamp(r.offset+r.slideV*dt,-r.maxOff,r.maxOff);
}
function updateRods(dt){
 if(dt<=0)return;
 const HF=AIC.heldFwd;                               // drop-sweep zone (its own tunable section)
 const clearZ=FOOT_BOX.z+BALL_R+HF.zMargin;          // z-depth of the drop-sweep (matches the held-evade escape)
 for(const r of rods){
   const legH=handOn(r,'leg')&&!(r.act==='catch'&&AIC.hand.leg.skip.indexOf(r.ttOn?'tictac':r.catPh)>=0);let hu=false;   // hu: the hand turned the leg this step
   if(r.kickT>=0&&r.kickStyle==='snake')snakeStep(r,dt);
   else if(r.kickT>=0){
     r.kickT+=dt;const T=r.kickT;let a;
     const KS=kickStyleCfg(r);
     const kA0=(r.kickA0!=null)?r.kickA0:0;          // from the angle at kick time, not windupA: a kick off a raised rod jumped ~1.5 rad in one step
     let uf=false,dir=r.team===0?1:-1;
     for(const b of S.balls){
      if(b.scored)continue;const rel=(b.m.position.x-r.x)*dir;
      if(rel<-HF.xBack||rel>HF.xFront)continue;
      for(let i=0;i<r.baseZ.length;i++)if(Math.abs(b.m.position.z-(r.baseZ[i]+r.offset))<clearZ){uf=true;break;}
      if(uf)break;
     }
     // keep the swing pinned at the strike angle while over a ball (uf) or while the held-evade latch is live (r.evadeHold)
     // r.kickHold = the player holding kick (js/input.js): a tap plays as before, only a button still down at the swing's own hold freezes it; a block, not a free power shot
     const holdF=(uf||r.kickHold||(r.evadeHold>0&&!r.evadeSpent))&&T>=KS.hold;
     r.heldFwd=holdF;
     if(holdF){a=KS.strikeA;r.kickT=KS.hold;if(S.asl&&uf&&!r.kickHold&&seatOf(r))aslHit(r,'heldOut');}   // a player's swing kept out over a ball they did not hold
     else if((a=swingA(KS,T,kA0))==null){a=0;r.kickT=-1;r.kickStyle=null;r.passTo=null;
      shotDisarm(r);                                   // an uncontacted swing spends its charge anyway — see shots.js
      if(dbgLogRod===r&&!r.kickHit)dbgRod(r,'WHIFF','no contact — swing completed');}
     r.angle=a*r.kickDir;
  }else if(r.act==='safeRaise'){const sl=srLerp(r);r.heldFwd=false;r.angle=rodEase(r,backLimit(r,(r.srA!=null)?r.srA:AIC.safeRaise.angle*r.kickDir,sl),sl,dt,hu=legH);}   // r.srA: ai.js picks the lift depth per ball; backLimit holds it short of a ball it would hit
  // CHARGE WIND-UP (js/shots.js, classic pad): below the right-stick branch and above r.raise; r.chgA is the sweepClips-capped target
  else if(shotPullAngle(r)!=null){r.heldFwd=false;r.angle=lerp(r.angle,r.chgA,Math.min(1,SWINGS.shoot.charge.pullLerp*dt));}
  // finesse + the right stick (shots.js shotStickPin): the leg settles on the ball's top, a pinned ball is held against a wobbling stick, a pushed one receives a ball from behind (at the receive's rate)
  else if(r.pinMag!=null){r.heldFwd=false;r.angle=lerp(r.angle,r.pinMag,Math.min(1,(r.fwdR?SHOT.pin.assist.recv.lerp:SHOT.pin.lerp)*dt));}
  else if(r.padAngleOn){                              // right-stick absolute angle: the stick position is the rod angle (1:1)
   // direct control: snap to the stick-mapped target so angVel carries the stick's real speed into the strike; optional smoothing only if KICK.padAngleLerp>0
   r.heldFwd=false;
   // the tracking rate is what the Total Control triggers bend (shotTrackMult): LT heavy, RT snappy
   const trk=shotTrackMult(r),rate=(KICK.padAngleLerp>0?KICK.padAngleLerp:SHOT.mod.directLerp)*trk;
   // an angle carried over a switch (input.js r.padCarry): held short of a ball a backward turn would sweep, and turned at most handover.stickW, so the switch itself is never a swing
   const to=r.padCarry?backLimit(r,r.padAngleTarget,rate,true):r.padAngleTarget;
   let a=(KICK.padAngleLerp>0||trk!==1)?lerp(r.angle,to,Math.min(1,rate*dt)):to;
   if(r.padCarry){const W=CTRL.handover.stickW*dt;a=r.angle+clamp(a-r.angle,-W,W);if(Math.abs(r.padAngleTarget-a)<0.02)r.padCarry=false;if(S.asl)aslHit(r,'stickCarry');}
   r.angle=a;
  }
  // THE PIN POSE (shots.js shotPinInput): finesse + raise, or finesse + kick for the forward pin; below the stick, above the raise; r.pinA is sweep-capped (not the forward one)
  else if(r.pinPose&&r.pinA!=null){
   let rate=SHOT.pin.lerp;
   if(r.ttOn&&r.act==='catch')rate=AIC.catch.tictac.lerp;
   else if(seatOf(r)){
    if(r.pinA*r.angle>0&&Math.abs(r.pinA)<Math.abs(r.angle))rate=r.pinRl?SHOT.pin.assist.roll.lerp:SHOT.pin.lower;
    else if(r.pinFwd)rate=r.fwdR?SHOT.pin.assist.recv.lerp:SHOT.pin.fwd.lerp;
   }else if(r.act==='catch'&&r.catPh==='side')rate=AIC.catch.byDiff[teamDiff(r.team)]?.sideLerp??rate;
   r.heldFwd=false;
   r.angle=rodEase(r,r.pinA,rate,dt,hu=legH);
  }
  // a human's forward pin let go with a ball under the leg: up and forward off it, down only once it is clear (shots.js shotFwdHold); with kick still held it stays up (r.fwdRz)
  else if(r.fwdRz||(r.fwdOut&&shotFwdHold(r))){r.heldFwd=false;r.angle=lerp(r.angle,AIC.catch.recv.lift.angle*r.kickDir,Math.min(1,SHOT.pin.fwd.lerp*dt));if(S.asl)aslHit(r,r.fwdRz?'fwdRaise':'liftOff');}
  // finesse held, leg down: the foot squared onto a ball beside a man (shots.js shotSquare)
  else if(r.sqA!=null){r.heldFwd=false;r.angle=lerp(r.angle,backLimit(r,r.sqA,SHOT.square.lerp,true),Math.min(1,SHOT.square.lerp*dt));}
  else if(r.raise){r.heldFwd=false;r.angle=rodEase(r,backLimit(r,KICK.raiseA*r.kickDir,KICK.raiseLerp,r.fwdOut),KICK.raiseLerp,dt,hu=legH);}
  else{r.heldFwd=false;r.angle=rodEase(r,backLimit(r,0,KICK.dropLerp,r.fwdOut),KICK.dropLerp,dt,hu=legH);}   // a forward pose coming back to rest is a back-lift: held short of a ball it would sweep (a human's too, from the forward pin: r.fwdOut)
   if(!hu)r.ha=null;
   const uSeat=seatOf(r);
   if(S.asl&&uSeat&&r.bgT===S.time)aslHit(r,'guard');   // backLimit held the player's leg short of a ball this step
   const cvS=coverSlide(r,uSeat);                     // a keeper / DEF covering the goal (ai.js)
   const ms=rodSlideMax(r,uSeat,cvS),slow=rodSlow;
  r.target=clamp(r.target,-r.maxOff,r.maxOff);
  const prevOff=r.offset;
  if(uSeat){                                          // human hand: instant/responsive, speed-capped only
   r.hd=null;r.offset+=clamp(r.target-r.offset,-ms*dt,ms*dt);
   if(slow&&SHOT.hold.lead!=null){const t0=r.target;r.target=clamp(t0,r.offset-ms*SHOT.hold.lead,r.offset+ms*SHOT.hold.lead);if(r.stlW===t0)r.stlW=r.target;if(S.asl&&Math.abs(r.target-t0)>1e-3)aslHit(r,'lead');}   // held or pinned, the slide is slower than the hand: the target must not run on ahead of the man (a settle's own target stays the settle's)
  }else if(!handSlide(r,ms,cvS,dt))aiSlide(r,ms,cvS,dt);   // AI hand: aimed moves (handSlide), else accel-capped
  if(!uSeat&&slideBlocked(r,prevOff,r.offset)){r.offset=prevOff;r.slideV=0;r.hd=null;}   // ai.js backGuard: never walk a boot into a ball that is behind it
  msSlide(r,Math.abs(r.offset-prevOff));              // matchstats.js: rod work done, in table units
  r.slideV=(r.offset-prevOff)/dt;                     // keep slideV in sync across control handoff
  r.angVel=(r.angle-r.prevAngle)/dt;
  r.vz=(r.offset-r.prevOffset)/dt;
  (r.vzH||(r.vzH=[0,0,0,0]))[r.vzI=((r.vzI|0)+1)&3]=r.vz;   // the last four steps' slide (physics.js pinRelease): a hand that moves once a frame (mouse, pad) moves the rod on one step in two
  r.tgV=lerp(r.tgV||0,(r.target-(r.tgP==null?r.target:r.tgP))/dt,Math.min(1,dt*8));r.tgP=r.target;   // where the rod is heading, smoothed (ai.js ttObs): its slide speed flips every few steps, its target holds
  Au.rodFeed(r);                             // audio.js: slide / spin loops and the end-stop bump, read before prevOffset moves on
  r.prevAngle=r.angle;r.prevOffset=r.offset;
  r.cd=Math.max(0,r.cd-dt);
  stExertTick(r,dt);stExertStick(r);         // stamina: swing exertion bleeds off (CONFIG.stats.kickFat.recover); a pad stick swing banks its own
  r.evadeCd=Math.max(0,(r.evadeCd||0)-dt);   // evade re-entry lockout (CONFIG.ai.evade.cd)
  r.lhT=Math.max(0,(r.lhT||0)-dt);           // back guard is holding this rod's lift (CONFIG.ai.backGuard.holdT); ai.js reads it
  r.laneCd=Math.max(0,(r.laneCd||0)-dt);     // lane-clear re-entry lockout (CONFIG.ai.clearLane.cd)
  r.retCd=Math.max(0,(r.retCd||0)-dt);       // retrieve re-entry lockout (CONFIG.ai.retrieve.cd)
  r.catCd=Math.max(0,(r.catCd||0)-dt);       // catch re-entry lockout (CONFIG.ai.catch.cd)
  r.passEvT=Math.max(0,(r.passEvT||0)-dt);   // pass-scan cache age (ai.pass.every); the scan is the AI's priciest call
  r.pivot.rotation.z=r.angle;
  r.pivot.position.z=r.offset;
  const fadeT=CONFIG.cannonball.respawnFade;
  for(let mi=0;mi<r.men.length;mi++){
    const alive=r.removedUntil[mi]?r.removedUntil[mi]<=S.time:true;
    const m=r.men[mi];
    if(!alive){                              // removed: hide hard (no fade-out — the explosion handles that)
      if(m.visible){setManVisible(m,false);m.userData.fade=null;}
      continue;
    }
    if(m.userData.fade===undefined)m.userData.fade=null;   // lazy-init
    if(!m.visible){                          // just respawned: start the fade-in from 0
      setManVisible(m,true);
      m.userData.fade=fadeT>0?0:null;        // 0 = opacity progress just begun
    }
    if(m.userData.fade!==null){              // easing in
      m.userData.fade=Math.min(fadeT,m.userData.fade+dt);
      const k=fadeT>0?m.userData.fade/fadeT:1;
      setManOpacity(m,k);
      if(m.userData.fade>=fadeT){            // fully back: restore shared materials, drop transparency
        setManOpacity(m,1);m.userData.fade=null;
      }
    }
  }
 }
}
// a rod's top slide speed (u/s): a seat's hand with its Total Control step, or the difficulty's; the stats and frost; slowed while it carries a ball (input.js slideBy scales a full key or stick to it)
// rodSlow: the slide is slowed by a carry (a pin, a grip under carry 1, a snake), set by every call (a module field, so it doesn't allocate)
let rodSlow=false;
function rodSlideMax(r,uSeat,cvS){
 let ms=uSeat?KICK.userSpeed*uSeat.tcMult*rodSpeedMult(r):rodTopV(r)*cvS;
 // a pinned ball is carried exactly (physics.js pinBallStep), so its limit is the pin's carry; holdCfg is null mid-swing
 // a player's forward pose receiving a ball from behind (shots.js r.fwdR) is not slowed by the grip: nothing is held yet
 const H=(r.fwdR&&!r.pinB)?null:holdCfg(r),snk=r.kickStyle==='snake'&&!r.kickHit,pb=uSeat?0:pushBurst(r);
 rodSlow=!!(r.pinB||snk||(H&&H.carryMult<1));
 if(pb)ms*=pb;                                     // the AI's push play bursts with the ball (ai.js)
 else if(r.pinB||snk)ms*=SHOT.pin.carry*(!uSeat&&r.act==='catch'&&r.catPh==='hold'&&r.angle*r.kickDir>AIC.catch.recv.fwdMin?AIC.catch.recv.carry:1);else if(H)ms*=H.carryMult;   // a snake slides as the pin did until it strikes, so the man stays with the ball it let go
 return ms;
}
// an AI hand's top slide speed (u/s): the difficulty's, the stats and frost; a cover's step and a carried ball come on top (rodSlideMax)
function rodTopV(r){return DIFFS[teamDiff(r.team)].speed*(S.userTeam>=0&&r.team===S.userTeam?KICK.aiOwnMult:1)*rodSpeedMult(r);}
// an AI hand's slide acceleration (u/s²): the difficulty's, the spd stat and stamina; every plan of a slide reads this
function rodAcc(r){return AIC.slideAccel*(DIFFS[teamDiff(r.team)].acc||1)*stAgil(r);}
// --- hand (CONFIG.ai.hand): an AI rod's slide and leg as aimed moves ---
// a move is a quintic from (p, v, a) to (p1, v1, 0) over T: speed rises, peaks, lands; re-aimed from where it is
function handOn(r,part){const H=AIC.hand,P=H&&H[part];return !!(H&&H.on&&P&&P.on&&!seatOf(r)&&H.diffs.indexOf(teamDiff(r.team))>=0);}
function handBy(v,r){return typeof v==='number'?v:v[teamDiff(r.team)];}
function handFit(h,p0,v0,a0,p1,v1,T){
 const D=p1-p0,TT=T*T;
 h.T=T;h.t=0;h.p1=p1;h.v1=v1;
 h.c0=p0;h.c1=v0*T;h.c2=a0*TT/2;
 h.c3=10*D-(6*v0+4*v1)*T-1.5*a0*TT;
 h.c4=-15*D+(8*v0+7*v1)*T+1.5*a0*TT;
 h.c5=6*D-3*(v0+v1)*T-0.5*a0*TT;
 return h;
}
// writes h.p / h.v / h.a at t s into the move; past T it carries on at v1
function handAt(h,t){
 if(t>=h.T){h.p=h.p1+h.v1*(t-h.T);h.v=h.v1;h.a=0;return h;}
 const s=t/h.T,T=h.T;
 h.p=h.c0+s*(h.c1+s*(h.c2+s*(h.c3+s*(h.c4+s*h.c5))));
 h.v=(h.c1+s*(2*h.c2+s*(3*h.c3+s*(4*h.c4+s*5*h.c5))))/T;
 h.a=(2*h.c2+s*(6*h.c3+s*(12*h.c4+s*20*h.c5)))/(T*T);
 return h;
}
// a slide move onto goal: its time from Fitts' law, the top speed and the planned acceleration; the landing misses by skill unless it follows a moving spot
function handPlan(r,old,gv,ms,aR,goal){
 const HS=AIC.hand.slide,p0=r.offset,v0=r.slideV||0;
 let a0=0;if(old&&old.t<old.T)a0=handAt(old,old.t).a;
 const D=goal-p0,ad=Math.abs(D),stop=v0*v0/(2*aR);
 let T=Math.max(handBy(HS.a,r)+handBy(HS.b,r)*Math.log2(1+ad/HS.w),1.875*ad/ms,Math.sqrt(5.77*ad/aR));
 if(v0*D<0||stop>ad)T=Math.max(T,Math.abs(v0)/aR+Math.sqrt(5.77*(ad+stop)/aR));   // turning round, or too fast to stop short of it
 else if(v0*D>0)T=Math.min(T,1.6*ad/Math.abs(v0));                               // already heading there: no slower than it goes
 T=Math.max(T,2/SIM.hz);
 let err=0;
 if(!gv){const R=rngFor('hand',r.idx);err=clamp((R()+R()+R()-1.5)*2*handBy(HS.err,r)*ad,-HS.errMax,HS.errMax);}
 let p1=goal+gv*T+err,v1=gv;
 if(Math.abs(p1)>=r.maxOff){p1=clamp(p1,-r.maxOff,r.maxOff);v1=0;}
 const h=handFit(old||{},p0,v0,a0,p1,v1,T);
 h.goal=goal;h.gv=gv;h.fw=0;
 return h;
}
// the AI slide as aimed moves; false = a speed command, a strike run, a push burst or a tap's run, which aiSlide drives
function handSlide(r,ms,cvS,dt){
 if(!handOn(r,'slide')){r.hd=null;return false;}
 const HS=AIC.hand.slide,SL=AIC.slide,SR=SL.strike,srel=(r.aiBX-r.x)*r.kickDir;
 const d=r.target-r.offset,tgD=(r.target-(r.tgP==null?r.target:r.tgP))/dt;
 r.hdGV=lerp(r.hdGV||0,Math.abs(tgD)>ms?0:tgD,Math.min(1,dt*HS.followLerp));
 r.hdW=r.hdW==null?r.target:lerp(r.hdW,r.target,Math.min(1,dt*HS.fixLerp));
 const cmd=Math.abs(d)<=ms*dt+1e-6&&Math.abs(tgD-r.slideV)<=SL.cmdTol&&(d===0?r.slideV!==0||tgD!==0:r.slideV!==0&&tgD!==0);   // target = offset + v·dt, moving with the rod: a slide speed (a stop, a run, a hit or tic-tac lunge from rest), not a spot; a still spot stays the hand's
 const strike=(!r.act||r.act==='safeRaise')&&SR.roles.indexOf(r.role)>=0&&srel>SR.rel[0]&&srel<SR.rel[1];   // the striker's run: its overshoot is the shot's slide
 const tapRun=r.act==='catch'&&r.catPh==='tap';   // a sprint to release speed (ai.js tapStep): a landing move never reaches it
 if(cmd||strike||tapRun||(r.catSw&&r.kickT>=0)||pushBurst(r)){r.hd=null;return false;}
 const aR=rodAcc(r)*cvS*HS.accK,gv=Math.abs(r.hdGV)>HS.follow?clamp(r.hdGV,-ms,ms):0;
 let h=r.hd;
 if(h)h.t+=dt;
 const ex=h?h.goal+h.gv*Math.min(h.t,h.T):0,cm=h?handBy(HS.commit,r):0;
 let fix=false,go=!h||h.o!==r.offset||(Math.abs(r.target-ex)>cm&&Math.abs(r.hdW-ex)>cm*HS.confirm);   // h.o: something else moved the rod; the smoothed spot confirms a re-aim (a jittery one is not chased)
 if(!go&&h.t>=h.T){
  if(h.gv)go=true;
  else if(Math.abs(r.hdW-r.offset)>handBy(HS.fix,r)){h.fw+=dt;fix=go=h.fw>=handBy(HS.fixT,r);}   // against the smoothed spot, aimed at it: its jitter is not a miss
  else h.fw=0;
 }
 if(go){
  const jump=!h||!(fix||Math.abs(r.target-r.hdW)<cm);   // near the smoothed spot = its jitter: aimed at the smoothed spot; a jump is aimed at as it is
  if(jump)r.hdW=r.target;
  h=r.hd=handPlan(r,h,gv,ms,aR,r.hdW);h.t=dt;
 }
 handAt(h,h.t);
 const dv=aR*HS.accCap*dt,v=clamp(clamp((h.p-r.offset)/dt,-ms,ms),r.slideV-dv,r.slideV+dv);
 r.slideV=v;r.offset=clamp(r.offset+v*dt,-r.maxOff,r.maxOff);h.o=r.offset;
 return true;
}
// the leg's turn to a pose as an aimed move; its time is the pose's ease rate's, never past the pose
function handAng(r,goal,rate,dt){
 const HL=AIC.hand.leg;let h=r.ha;
 if(h&&Math.abs(goal-h.goal)<=HL.replan)h.t+=dt;
 else{
  const a0=h&&h.t<h.T?handAt(h,h.t).a:0,D=Math.abs(goal-r.angle);
  const T=Math.max(2/SIM.hz,HL.k/rate*clamp(Math.sqrt(D/HL.dRef),HL.minK,HL.maxK));
  h=r.ha=handFit(h||{},r.angle,r.angVel||0,a0,goal,0,T);h.goal=goal;h.t=dt;
 }
 const a=handAt(h,h.t).p,s=Math.sign(goal-r.angle);
 return !s||(goal-a)*s<0?goal:a;   // never past the pose (a backLimit is a wall), held once on it
}
// a pose ease: the hand's turn on an AI leg, the old lerp otherwise
function rodEase(r,to,rate,dt,hand){return hand?handAng(r,to,rate,dt):lerp(r.angle,to,Math.min(1,rate*dt));}
