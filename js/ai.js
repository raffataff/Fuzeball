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
/* This rod's SEEDED random stream (js/rng.js), keyed on r.idx so it is the ROD's own sequence:
   a trial that hides two rods, or a rod that never rolls, cannot shift another rod's numbers
   the way one shared stream would. Same shape as rand(), so the call sites read as they did. */
function aiR(r,a,b){return rngR(rngAi(r.idx),a,b);}
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
// ---- foot-box geometry, shared by the trap sweep guard ---------------------------------------
// Distance from a ball centre to man i's foot box with the rod at angle `a` — the EXACT transform
// collideRod's foot-box pass uses (physics.js), lifted into one place so the AI's prediction of a
// contact and the physics that actually resolves it cannot drift apart. The contact normal and the
// world-space closest point go into the _fb scratch instead of a returned object: this runs per
// man, per arc sample, per frame, and allocating there is pure GC churn on a hot path.
// `foff` (optional) overrides the rod's slide offset for this test — the strike gate below uses it to
// ask the question at a PREDICTED offset (where the men will have slid to mid-swing) rather than only
// at the one they occupy this frame. Omitted ⇒ r.offset, i.e. every existing caller is unchanged.
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
// ---- trap sweep guard --------------------------------------------------------------------------
// "Would rotating this rod from angle a0 to a1 drive a foot box INTO the ball and shove it toward
// our OWN goal?" This is the check the trap entry was missing, and the reason a catch sometimes
// read as a backward kick: entering a trap does not freeze the rod — rods.js eases r.angle to the
// trap target, and that rotation is a MOVING box. Anything standing in the arc is struck along the
// contact normal, with trap.holdGrip (0.55) lerping the boot's own velocity into the ball on top of
// the impulse. When that normal points at our net, the "trap" is an own-goal nudge.
//
// inFootRange/footStuck cannot answer this. It is a STATIC question — could a foot touch the ball
// from where everything sits right now — over a rectangle whose back depth (footRangeBack 7.0) is
// DEEPER than the entire catch window (trap.back −5.8). Gating entry on `!footStuck` therefore
// refuses 100% of traps, which is exactly why it was left out of this block to begin with.
//
// So: sample the arc, rebuild the real foot box at each sample, and refuse only when a sample is in
// contact AND the boot is driving INTO the ball along the normal AND that normal points goal-ward.
// Two contact classes stay legal, and they are the traps worth keeping:
//   • the boot is RETREATING from the ball along the normal (cv·n <= 0) — there is no shove;
//   • the impulse points UPFIELD or straight down (n·x̂·dir >= −pushDot) — the ball is ahead of the
//     boot, so the tilt closes a lip BEHIND it, which is the catch working as designed.
// Only the rotational term is tested. r.vz (the slide) is deliberately excluded: a z-knock is the
// evade/clearOffset problem, not this one, and man-selection's transient slide would otherwise flip
// the verdict frame to frame.
function sweepClips(r,b,a0,a1){
 const SW=AIC.trap.sweep;
 if(!SW||!SW.on||a0===a1)return false;
 const n=Math.max(2,SW.samples|0),dir=r.kickDir,reach=BALL_R*FOOT_BOX_REACH+SW.pad;
 const p0=b.m.position,step=SW.sweepT/(n-1);
 const w=(a1>a0)?1:-1;                                 // angular direction of the ease; only its SIGN is used
 for(let s=0;s<n;s++){
  const a=a0+(a1-a0)*(s/(n-1)),t=step*s;
  // Advance the BALL along the arc too, so one rolling into the swing is judged where it will
  // actually be when the boot arrives rather than where it sits at the instant of the test.
  const px=p0.x+b.v.x*t,py=p0.y+b.v.y*t,pz=p0.z+b.v.z*t;
  for(let i=0;i<r.baseZ.length;i++){
   if(!manLive(r,i))continue;
   if(Math.abs(pz-(r.baseZ[i]+r.offset))>FOOT_BOX.z+reach)continue;    // cheap z reject before the transform
   if(footBoxDist(r,a,i,px,py,pz)>reach)continue;                      // this sample never touches the ball
   if(_fb.nx*dir>=-SW.pushDot)continue;                                // impulse goes upfield / sideways / down — safe
   // Contact-point velocity for a unit angular rate about the rod pivot (r.x, ROD_H). The magnitude
   // is irrelevant: we only need to know whether the boot closes on the ball or backs off it.
   if((-(_fb.cwy-ROD_H)*w)*_fb.nx+((_fb.cwx-r.x)*w)*_fb.ny<=0)continue; // boot retreating — no shove
   return true;                                                        // this catch would knock the ball back
  }
 }
 return false;
}
// Is the ball actually within contact reach of a live foot at rod angle `a`? A sweep that clips
// nothing but also never touches the ball is an EMPTY trap: the action would latch, pin nothing,
// and time out into a trapShot at thin air. Pairs with trapAngle below.
function footHolds(r,b,a){
 const p=b.m.position,reach=BALL_R*FOOT_BOX_REACH;
 for(let i=0;i<r.baseZ.length;i++){
  if(!manLive(r,i))continue;
  if(Math.abs(p.z-(r.baseZ[i]+r.offset))>FOOT_BOX.z+reach)continue;
  if(footBoxDist(r,a,i,p.x,p.y,p.z)<=reach)return true;
 }
 return false;
}
/* ---- strike gate: contact-range check for AIMED swings ------------------------------------------
   "If I commit THIS kick style right now, will a live boot genuinely be on the ball while its power
   window is open?" Asked BEFORE kickRod, so an aimed action can be REFUSED instead of swung at air.

   Why the ordinary kick gate isn't enough for a pass. `(overFoot||inFront) && aligned` is a STATIC
   snapshot, taken on the rod's DELAYED perception (aiView), and it was tuned for the normal swing —
   whose boot is on the ball almost immediately. An aimed swing carries two lags that the snapshot
   knows nothing about, and they compound:
     • perception — DIFFS.reactDelay, up to ~0.25s once a poor rea stat and fatigue scale it, so `bp`
                    is where the ball WAS, not where it is;
     • the swing  — passShot contacts at powFrom..powTo = 0.08–0.20s AFTER the commit, roughly double
                    the normal curve, because a pass is deliberately soft and slow.
   ~0.45s of combined error is ~9 units of ball travel at midfield pace — comfortably more than the
   whole gap between two men. The rod was passing to where the ball had been; by contact it had rolled
   between the players. That is the whiff. When it did connect it was often a corner clip off the SIDE
   of a foot box, which collideRod still resolves as a contact and which then collected the pass
   aim-assist — a deflection dressed up as a pass.

   So: predict rather than snapshot. Replay the EXACT swing curve updateRods will run (swingAngleAt),
   advance the REAL ball to each sample time, advance the men's slide too, and ask footBoxDist — the
   same transform collideRod resolves against — whether a boot is actually there. Three conditions,
   all required:
     reach  — the closest sample must sit inside footBoxReach + pad of the ball;
     face   — the contact normal must point FORWARD (dir-relative). A z-side clip reads ~0 and one
              from behind reads negative: that is a deflection, not a pass;
     centre — the ball must be within zFrac of the boot's true z half-reach, not hanging off a corner.
   Only the styles listed in strikeGate.styles are gated. The plain kick is deliberately NOT among
   them, so ordinary clearing — the AI's most important reflex — is byte-identical to before, and
   strikeGate.on:false restores the whole pre-gate behaviour. ---------------------------------------- */
// The swing's rod-LOCAL angle T seconds into style block KS, ramping from a0 — the angle the swing
// STARTS from, which kickRod captures as r.kickA0. This is the chain in updateRods, lifted verbatim,
// so prediction and playback cannot drift apart: change the curve and both follow it.
function swingAngleAt(KS,a0,T){
 const rampA0=KS.windup>0?KS.windupA:a0;
 if(T<KS.windup) return a0+(KS.windupA-a0)*(T/KS.windup);
 if(T<KS.strike) return rampA0+(KS.strikeA-rampA0)*((T-KS.windup)/(KS.strike-KS.windup));
 if(T<KS.hold)   return KS.strikeA;
 if(T<KS.drop)   return KS.strikeA*(1-(T-KS.hold)/(KS.drop-KS.hold));
 return 0;
}
// Scratch result — this sits on the kick path, per rod, so it must not allocate. Fields: ok (all three
// conditions met), d (closest approach), face (dir-relative normal), dz (z offset from that boot), t
// (when in the swing), man (which figurine). Everything past `ok` exists for the kick-log trace.
const _sp={ok:false,d:1e9,face:0,dz:0,t:0,man:-1};
function strikeProbe(r,b,style){
 const SG=AIC.strikeGate,KS=styleCfg(style);
 const reach=BALL_R*FOOT_BOX_REACH,zReach=FOOT_BOX.z+reach;
 const n=Math.max(2,SG.samples|0),dir=r.kickDir;
 // Never sample before KS.windup: during the pull-back the boot is travelling AWAY from the ball, so
 // a "contact" there is the backswing brushing it — the opposite of a pass. lead can only widen the
 // window into the forward sweep, never into the windup.
 const t0=Math.max(KS.windup,KS.powFrom-SG.lead),t1=Math.max(t0,Math.min(KS.drop,KS.powTo+SG.lag));
 const a0=r.angle/(dir||1);                          // the swing starts from where the rod IS — kickRod's kickA0
 const p=b.m.position,v=b.v,room=r.target-r.offset;
 // Exponential friction, integrated exactly: ∫₀ᵗ e^(−k·s) ds. A rolling ball sheds real speed at
 // floorFric over a 0.2s pass window, and OVER-predicting its travel would refuse passes that would
 // actually have connected — the gate has to be honest in both directions.
 const fr=(p.y<=BALL_R+SG.groundY)?PHY.floorFric:PHY.airFric;
 _sp.ok=false;_sp.d=1e9;_sp.face=0;_sp.dz=0;_sp.t=0;_sp.man=-1;
 for(let s=0;s<n;s++){
  const t=t0+(t1-t0)*(n>1?s/(n-1):0);
  const k=fr>1e-6?(1-Math.exp(-fr*t))/fr:t;
  const px=p.x+v.x*k, pz=p.z+v.z*k;
  const py=Math.max(BALL_R,p.y+v.y*t-0.5*GRAV*t*t);  // ballistic in y, floored — a rolling ball can't sink
  const a=swingAngleAt(KS,a0,t)*dir;                 // rod-local → world, exactly as updateRods writes it
  // The men keep sliding while the swing runs. Lead the offset by the rod's CURRENT slide velocity,
  // clamped to the room still left to r.target so a decelerating rod is never predicted past it.
  const lead=SG.slideLead?clamp(r.slideV*t,Math.min(0,room),Math.max(0,room)):0;
  const foff=r.offset+lead;
  for(let i=0;i<r.baseZ.length;i++){
   if(!manLive(r,i))continue;
   const dz=pz-(r.baseZ[i]+foff);
   if(Math.abs(dz)>zReach+1)continue;                // cheap z reject before the transform
   const d=footBoxDist(r,a,i,px,py,pz,foff);
   const face=_fb.nx*dir;
   const ok=d<=reach+SG.pad && face>=SG.faceDot && Math.abs(dz)<=zReach*SG.zFrac;
   // A VALID contact always wins; among equally valid (or equally invalid) samples keep the CLOSEST,
   // so a refusal reports the near-miss that actually happened rather than an arbitrary man.
   if((ok&&!_sp.ok)||(ok===_sp.ok&&d<_sp.d)){_sp.ok=ok;_sp.d=d;_sp.face=face;_sp.dz=dz;_sp.t=t;_sp.man=i;}
  }
 }
 return _sp;
}
/* The gate itself. `bv` is the rod's PERCEIVED ball (the aiView proxy); the probe runs on bv.real by
   default, because "will the boot touch it" is a physics question rather than a perception one —
   reaction lag belongs in WHEN a rod decides, not in whether the decision is geometrically possible.
   Any style not listed in strikeGate.styles returns true, so the normal kick path is untouched. */
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
// ---- per-ball trap angle ------------------------------------------------------------------------
// The catch target is NOT the fixed trap.angle any more; it is the DEEPEST angle on the way there
// whose sweep is clean. This is what keeps the guard above from disabling the feature outright.
// The boot's box sits at rel ≈ +0.40 at rest and rel ≈ −2.36 at trap.angle −0.5, so committing to
// the full tilt means ~2.8u of backward travel EVERY time — and any ball already inside that path
// gets shoved goal-ward, which is precisely the knock-back. Walking the arc outward instead gives:
//   • ball at rel ≈ −2.5..−1.0 → target 0 (rest). It is already inside the resting box, so the boot
//     pins it flat and never travels. This is how the dribble has always held a ball (see the note
//     on the r.act==='dribble' branch in rods.js) — the hold is holdRest 0 / holdGrip 0.55 in
//     collideRod, not the angle, so a flat boot pins perfectly well.
//   • ball at rel ≈ −0.5..+0.5 → full trap.angle. The boot is already behind it, so the tilt closes
//     a lip rather than sweeping through, and the catch looks like a deliberate catch.
//   • deeper than ≈ −3 → null. Genuinely unreachable: no angle puts a boot on the ball without
//     travelling through it first. Entry is refused and the ball falls to the evade action, which
//     slides the rod off it exactly as before.
// Returns the world-space angle to hold, or null if no angle both clears the sweep and reaches.
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
// Is any live foot sitting within cz of the lane z lz? The z-slice half of inFootRange, split out
// because clearLane supplies its own (wider) corridor width and does its own x test.
function inLaneZ(r,lz,cz){
 for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;if(Math.abs(lz-(r.baseZ[i]+r.offset))<cz)return true;}
 return false;
}
// The teammate rod BEHIND this one (nearer our own goal) that is about to play ball b forward
// THROUGH us — i.e. the ball sits on our side of it and it's close enough in x to reach it. If one
// exists, anything we do in the ball's z-lane blocks our own clearance; clearLane acts on that.
// Nearest such mate wins (the one whose boot the ball is actually at). Null = play the ball normally.
// Three gates, in cost order:
//  • ROLE (clearLane.roles) — only a defence makes way. A MID/ATT stepping aside mid-pitch isn't
//    clearing a keeper's line, it's just opening the field for the opposition.
//  • GEOMETRY — behind us, on our side of the mate, within mateReach, and no OPPOSING rod nearer the
//    ball in x. That last test is possession, done geometrically rather than via S.lastTouch: only
//    rods near the ball in x can touch it at all, so it's both stricter and never stale (a redrop, a
//    deflection or the other ball in a multi-ball point can all leave lastTouch lying).
//  • Z-BAND — the ball must be inside the MATE's own z-slide range (for a DEF that mate is always
//    the keeper) + zPad. Out by a corner or against a side wall the keeper cannot slide onto the
//    ball, so there is no clearance to make way FOR and the row plays it as it normally would.
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
// x, recomputed on a commit timer so it can't flicker frame-to-frame.
// EVERY rod a human seat is holding on this team is forced into the pair — those are hands
// physically on the table, so they're live by definition. With two people on one team that
// fills both slots and the AI plays none, which is correct; the cap is raised to the forced
// count if a team ever has MORE seats than hands so nobody's rod goes dead.
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
// Every live opposing man sitting BETWEEN the ball at bx and a target x — the blockers for any
// straight line drawn between the two. Split out of shotEval so the pass scan can reuse it (its
// target is a teammate rod, not the goal) and so a multi-sample scan builds the list ONCE: the set
// depends only on the two x's, never on the target z, and rebuilding it per lane was the whole cost.
function laneObs(team,bx,tx){
 const dir=team===0?1:-1,GA=AIC.gapAim,obs=[];
 for(const r2 of rods){
  if(r2.team===team)continue;                                     // only opponents block
  if((r2.x-bx)*dir<=GA.minAhead||(r2.x-tx)*dir>0)continue;         // must sit between ball and target
  for(let i=0;i<r2.baseZ.length;i++){if(r2.removedUntil[i]&&r2.removedUntil[i]>S.time)continue;obs.push({x:r2.x,z:r2.baseZ[i]+r2.offset});}
 }
 return obs;
}
// How far the straight line (bx,bz)→(tx,tz) misses the nearest blocker in z, minus that man's block
// half-width. >0 = the ball gets through by that margin; <0 = it's covered.
function lineClr(obs,bx,bz,tx,tz){
 let clr=1e9;const denom=(tx-bx)||1e-3;
 for(const o of obs){const t=(o.x-bx)/denom,lz=bz+(tz-bz)*t,d=Math.abs(lz-o.z)-AIC.gapAim.blockR;if(d<clr)clr=d;}
 return clr;
}
// Gap-aware shot evaluation. From the ball at (bx,bz), sample target z's across the opponent
// goal mouth and score each lane by its clearance to the nearest BLOCKING opposing man — any
// live man on a rod between the ball and the goal (the keeper is just the last one). The widest-
// clearance lane is 'best' (ties break toward centre). Returns lanes[] + best + origin for the
// debug overlay. `obs` may be supplied by a caller scanning many z's from one ball position
// (dribTarget) — it's identical for every z, so passing it in avoids rebuilding it per sample.
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
// ---- dribble support -------------------------------------------------------------------------
// The z-gap past the opposing row DIRECTLY IN FRONT of the ball — "can I play forward from here at
// all". Only the nearest opposing rod ahead is considered, because it's the binding constraint: get
// past it and the next row is a different problem, one its own handler will face. Cheap by design
// (one rod, ≤5 men) so the sampled scan below can afford it.
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
// "How good is my way forward if the ball were at (bx,bz)?" — the ONE number the dribble is trying
// to maximise, and the reason a defender can use this action at all.
//   • ATT — the goal is the next thing in front, so the way forward IS a shooting lane: shotEval,
//     which already counts every opposing man between the ball and the mouth (their DEF, then the
//     keeper). Bounded by fwdClr too, so a man planted right in front still reads as blocked.
//   • everyone else — scoring from deep is not the question and shotEval would answer it with a
//     uniformly awful number for every candidate z (11 opposing men across 80 units), which is
//     noise, not a gradient. The real question for a DEF or MID is whether it can work the ball
//     PAST THE ROW IN FRONT to its own next line — exactly fwdClr.
function outletClr(r,bx,bz,obs){
 const fwd=fwdClr(r.team,bx,bz);
 if(r.role!=='ATT')return fwd;
 return Math.min(fwd,shotEval(r.team,bx,bz,obs).best.clr);
}
// WHERE the dribble should take the ball. Scores candidate ball-z positions across the dribbling
// man's own reachable range: the outlet from there, PLUS a bonus for being nearer the centre of the
// pitch, MINUS the distance travelled to get there. The centre term is what fixes the winger who
// blasts the end wall: out wide every angle is a narrow diagonal, so clearance alone can't tell a
// bad position from a slightly less bad one and the rod shuffles in place. From a decent central
// spot the outlet term dominates again and the target lands near where the ball already is (which
// is why entry also requires minGain — no point sliding it about for nothing).
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
// Is an opponent close enough to take the ball off us? Normalised box test (x by pressX, z by
// pressZ) so one number reads as "inside the pressure box". A carry without this walks into a
// tackle every time — the release IS the decision to beat the press.
function dribPressed(r,bx,bz){
 const DR=AIC.dribble;
 for(const o of rods){
  if(o.team===r.team)continue;
  const dx=Math.abs(o.x-bx);if(dx>DR.pressX)continue;
  for(let i=0;i<o.baseZ.length;i++){if(!manLive(o,i))continue;if(Math.abs(bz-(o.baseZ[i]+o.offset))<DR.pressZ)return true;}
 }
 return false;
}
// Best PASS available from the ball at (bx,bz): every live man of every teammate rod ahead of us,
// scored on whether the ball can even reach him (clear) plus how good HIS shot would be once it
// does (onward), minus a mild preference for the nearer option. Returns null when nothing beats
// pass.minClear. Deliberately geometric — it asks what the receiving row could DO, not who is
// "open" in the abstract, so a pass square into a covered man never scores.
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
// Cached wrapper — the scan above is the priciest thing the AI does (rods × men × a shotEval each),
// so it runs on a cadence (pass.every) and every reader in a frame shares the result.
function passPick(r,bx,bz){
 const P=AIC.dribble.pass;
 if(!P.on)return null;
 if((r.passEvT||0)>0)return r.passEv;
 r.passEvT=P.every;
 return r.passEv=passEval(r,bx,bz);
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
    // Lane-holding only means "don't aim/kick" — raise must stay LIVE even on the bench,
    // or a rod that hasn't entered the active pair yet (e.g. every rod right after a serve,
    // where resetRodRotation just wiped every latch) sits down in the ball's path and takes
    // a teammate's kick in the back. Mirrors the active-rod raise latch below, minus the
    // swing actions (trap/safeRaise), which only ever run for an active rod anyway.
    let bb=null,bd2=1e9;
    for(const b of S.balls){if(b.scored)continue;const d=Math.abs(b.m.position.x-r.x);if(d<bd2){bd2=d;bb=b;}}
    if(!bb){r.raise=false;r.behindFlag=false;continue;}
    const dir2=r.team===0?1:-1;
    const relReal2=(bb.m.position.x-r.x)*dir2;
    // A benched rod still must not stand in a teammate's kick lane. It holds its lane in z (that's
    // what benched MEANS — the hand isn't on it), so it gets the LIFT half of clearLane only: the
    // clearance passes under the feet instead of into them. Same back-swing guard as the action.
    if(AIC.clearLane.on&&AIC.clearLane.lift&&relReal2<AIC.clearLane.behind&&relReal2>-AIC.clearLane.nearBall
       &&bb.m.position.y<AIC.lowY&&!inFootRange(r,bb)&&laneMate(r,bb)){
     r.raise=true;r.behindFlag=false;continue;
    }
     if(inFootRange(r,bb,AIC.underFootBack)){
      r.raise=false;r.behindFlag=false;                 // ball right at the feet — never swing back through it
     }else{
      if(!r.behindFlag && relReal2<AIC.raiseBehind) r.behindFlag=true;
      if(r.behindFlag){
       r.raise=true;
       // Release when ball reaches feet OR has moved well past them (skipped the zone)
       if(relReal2>AIC.overFootOffset+AIC.overFoot) r.behindFlag=false;
      }else{
       r.raise=relReal2<AIC.raiseBehind;
      }
     }
    continue;
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
  if(r.aiErrT<=0){const R=rngAi(r.idx);r.aiErrT=rngR(R,AIC.errEvery[0],AIC.errEvery[1]);r.aiErrTarget=rngR(R,-D.err,D.err)*stErr(r);r.aiGoalZ=rngR(R,-1,1);r.aiIQ=R()<clamp((D.iq||0)*stIQ(r),0,1);}
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
  const approach=best.v.x*dir;            // >0 = ball closing on this rod's front face (read by clearLane/trap/evade)
  // x-distance from the ball to THIS rod's OWN goal line. Hoisted here (it used to sit with the trap
  // guards) because the dribble block guards on it too and is evaluated in the same pass.
  const ownGx=dir>0?-F.L/2:F.L/2;
  const goalDist=Math.abs(bp.x-ownGx);
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
     // Release when ball reaches feet OR has moved well past them (skipped the zone)
     if(overFoot || relReal>AIC.overFootOffset+AIC.overFoot) r.behindFlag=false;
    }else{
     r.raise=relReal<AIC.raiseBehind;
    }
   }
  // ---- lane-clear action (r.act='lane') — MAKE WAY for the rod behind us. A teammate nearer our
  //      own goal has the ball and is about to hit it forward through our row; whatever we do in
  //      that z-lane is a block on our own clearance. This is the keeper-smothered-by-its-own-
  //      defence case: the ball sits in the 15u GK↔DEF gap, man-selection slides the DEF onto the
  //      ball's z (it tracks the ball wherever it is, in front or behind), and then either the men
  //      lower into the strike, or safeRaise — whose band, rel −5.8..0.45, IS that gap — parks a
  //      half-lifted boot (angle −0.8 puts it ~4.5u back at y≈3.1, i.e. squarely in the kick path).
  //      So this runs BEFORE safeRaise/trap/evade and outranks all three: they each want to play a
  //      ball that isn't ours to play. It slides the men out of the corridor and lifts them once
  //      the back-swing can't clip the ball (footStuck) — a lift while the ball is in reach sweeps
  //      the foot BACKWARD through it into our own goal, so the slide has to clear z first, which
  //      un-gates the lift by itself.
  //      Handover — the thing that must not break: we only ever hold a ball BEHIND us, and release
  //      at CL.release (1.5u of hysteresis off the entry threshold, and early enough that the men
  //      are down again before a slow ball reaches the overFoot zone). A ball already STRUCK
  //      (approach > throughV) instead holds the lane open until it is CL.passed clear of us, so
  //      the row can't drop onto the very clearance it just made way for. ----
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
  //      • goalDist — x-distance from the ball to THIS rod's own goal line (declared up with
  //        relReal/approach now, since the dribble block guards on it too). Inside TR.ownGoalGuard
  //        no trap is entered, and a live trap ABORTS (the abort drops the rod, and the drop sweeps
  //        the foot FORWARD, which clears the ball upfield — the safe direction). ----
  // Directional own-goal guard: the catch tilts the foot BACKWARD, so a ball BEHIND the feet is
  // pushed toward our own goal by the contact (the keeper own-goal). Use the big margin when the
  // ball is behind, the small one when it's in front (where the catch tilts safely away from it).
  const ogGuard=relReal<TR.behindSafe?TR.ownGoalBehind:TR.ownGoalGuard;
  /* DEFER TO THE DRIBBLE. The trap block sits above the dribble block in this file but must lose to
     it, because their windows overlap (trap.back −5.8..front 1.4 vs dribble.back −2.2..front 3.0)
     and for a ball already settled at the feet the dribble is the better action: it works from the
     RESTING posture the ball is actually sitting at rather than rotating a pin angle over it, it
     scores a POSITION rather than only a lane, it reads the press, and it can pass. Without this an
     attacker's ball at the boot was always grabbed by the trap first, carried at most slideMax 7u
     hunting a lane, and scooped — which is most of why wingers still ended up firing across goal.
     Everything the test refuses (any defensive catch, a ball not yet settled, a rod on dribble
     cooldown, the GK) is trapped exactly as before.
     Note the (dribEvT<=0) term: it mirrors the dribble's own scan cadence, so the deferral lasts
     exactly as long as the dribble's FIRST REFUSAL. Scan, decline (good shot already on, or nothing
     to gain by carrying), and the very next frame dribFirst is false and the trap picks the ball up
     as it always did — no ball falls between the two actions. */
  const dribFirst=AIC.dribble.on&&AIC.dribble.roles.indexOf(r.role)>=0&&(r.dribCd||0)<=0&&(r.dribEvT||0)<=0
                  &&relReal>AIC.dribble.back&&relReal<AIC.dribble.front&&dz<AIC.dribble.alignZ
                  &&speed<AIC.dribble.maxSpeed&&goalDist>AIC.dribble.ownGoalGuard
                  &&approach>AIC.dribble.minApproach&&approach<AIC.dribble.maxApproach;
  if(r.act==='trap'){
   r.actT+=dt;
   // Exit once the ball escapes the catch band, speeds up, lifts, drifts too near our own goal, or
   // we've held too long. NOTE: deliberately NO footStuck abort here — a trap's whole JOB is to hold
   // a ball AT the feet, and since entry requires alignment (⇒ inFootRange ⇒ footStuck), a footStuck
   // abort killed the trap one frame after it began (why traps were never seen). The forward `front`
   // bound + the directional own-goal guard are the own-goal guards instead — the latter also aborts
   // a trap whose ball has DRIFTED behind the feet toward our net since it was caught.
   if(relReal<=TR.back||relReal>=TR.front||speed>TR.maxSpeed||bp.y>AIC.lowY||goalDist<ogGuard||r.actT>TR.abortT){r.act=null;r.trapMan=-1;r.trapDir=0;r.trapA=null;}
  }else if(TR.on&&r.aiIQ&&!r.act&&!dribFirst&&relReal>TR.back&&relReal<TR.front&&bp.y<AIC.lowY&&Math.abs(best.v.x)<TR.maxVX&&speed<TR.maxSpeed&&trapZ
           &&approach>TR.minApproach&&approach<TR.maxApproach&&goalDist>ogGuard){
   /* SWEEP GUARD — the last gate, and deliberately the most expensive one, so it only runs on the
      handful of frames where every cheap test has already passed. Everything above asks "is this
      ball trappable in principle"; this asks the one question that was missing — "does the rotation
      that STARTS the trap swing a boot through it on the way?" Entry does not freeze the rod:
      rods.js immediately eases r.angle to TR.angle, and a ball standing in that arc is struck along
      the contact normal and dragged by holdGrip. World angles both sides (r.angle is already
      ×kickDir; TR.angle is rod-local, so it needs the multiply) — sweepClips rebuilds collideRod's
      geometry verbatim and that pass uses r.angle raw. */
   const ta=trapAngle(r,best,r.angle,TR.angle*r.kickDir);
   if(ta===null){
    if(dbgLogRod===r)dbgRod(r,'TRAP-VETO','no clean catch angle: rel='+relReal.toFixed(1)+' dz='+dz.toFixed(2)+' a='+r.angle.toFixed(2)+'->'+(TR.angle*r.kickDir).toFixed(2));
   }else{
    // Entry commits to ONE man — the live man nearest the ball in z — and remembers where the ball
    // was caught. Holding the man fixed for the whole trap is what stops the man-index hysteresis
    // re-picking a neighbour mid-carry and dragging the boot off the ball it is dribbling.
    let tm=-1,td=1e9;
    for(let i=0;i<r.baseZ.length;i++){if(!manLive(r,i))continue;const d=Math.abs(bp.z-(r.baseZ[i]+r.offset));if(d<td){td=d;tm=i;}}
    r.act='trap';r.actT=0;r.trapMan=tm;r.trapZ0=bp.z;r.trapDir=0;r.trapA=ta;  // not gated on r.raise — a slow ball at an aligned foot is caught directly, latched or not
   }
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
     // strikeOn is the last word: tdz only says the ball is in the boot's z lane, not that the SCOOP
     // will land on it. A trapped ball that has crept out from under the boot (or is being nudged
     // along by the carry) falls through to the timeUp branch and is released instead of scooped at.
     if((open||timeUp)&&tdz<TR.alignZ&&r.kickT<0&&r.cd<=0&&strikeOn(r,best,'trapShot')){
      if(dbgLogRod===r)dbgRod(r,'TRAPSHOT',(open?'lane open':'hold expired')+' clr='+ev.best.clr.toFixed(1)+' rel='+relReal.toFixed(1)+' tdz='+tdz.toFixed(2)+' carried='+(bp.z-r.trapZ0).toFixed(1));
      kickRod(r,'trapShot');                // scoop shot with dedicated trap power window
      r.cd=D.cd*stCd(r)*aiR(r,AIC.cdSlow[0],AIC.cdSlow[1]);
      r.trapMan=-1;r.trapDir=0;r.trapA=null;shot=true;
     }else if(timeUp){                      // held long enough but never squared up — give the ball back
      r.act=null;r.trapMan=-1;r.trapDir=0;r.trapA=null;
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
  // ---- dribble action (r.act='dribble') — the ball is at the feet of a row that is DOWN AT REST
  //      and there's no way forward (or we're out wide, where every angle is a bad diagonal), so
  //      SLIDE THE BALL to a better line instead of hitting it into the row opposite.
  //      NOT A TRAP, and the distinction is load-bearing: this action touches nothing in updateRods,
  //      so the rod keeps the ordinary rest angle and the men stay down. That is both what the ball
  //      at a resting boot actually needs, and the one case the trap could never serve — its pin
  //      angle sits the foot box above a ball on the floor and shoves it away rather than settling
  //      it. All this does is override the CONTACT (holdGrip 0.30, a nudge with slip, vs the trap's
  //      0.55 weld) and own r.target/r.aiMan while it works. It `continue`s and canKick is
  //      !r.act-gated, so nothing below re-aims or hits the ball we're working.
  //      Released by the way forward opening, arriving at the committed target, being closed down,
  //      or time — and the release is an ORDINARY swing (the ball is sitting in the normal strike
  //      zone with the men down, so the normal kick is exactly right) or a PASS.
  //      DEF is in `roles`: for a non-attacker the outlet score IS "can I get the ball past the
  //      opposing attack row", so a defender works it sideways for a gap rather than belting it
  //      into them. ownGoalGuard keeps that out of our own box. It sits BELOW the trap in the file
  //      but ABOVE it in priority — see `dribFirst` in the trap's entry. ----
  const DR=AIC.dribble;
  if(r.act==='dribble'){
   r.actT+=dt;
   const dmC=(r.dribMan>=0&&r.dribMan<r.baseZ.length&&manLive(r,r.dribMan))?r.dribMan:-1;
   const ddzC=dmC<0?1e9:Math.abs(bp.z-(r.baseZ[dmC]+r.offset));
   // Contact lost / ball escaped the window / sped up / lifted / drifted too near our own goal /
   // out of time → hand straight back to the normal path with NO shot. Swinging at a ball that is
   // no longer at the boot is the phantom-trapshot bug (2026-07-22) wearing a new coat.
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
   // Men DOWN and no angle override anywhere: updateRods has no dribble branch, so clearing these
   // two drops the rod onto its ordinary rest ease. This IS the posture the action works from.
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
   // Release needs the ball genuinely strikeable — the NORMAL alignment test, not the looser
   // control tolerance the dribble runs on, so a sloppy touch can't produce a swing at nothing.
   // When we want to play it but aren't squared up yet, the branch below stops pushing and aims
   // straight at the ball, so alignment converges instead of the action timing out mid-push.
   if(want&&aligned&&ddz<DR.holdZ&&r.kickT<0&&r.cd<=0){
    /* RELEASE with an ORDINARY swing: the ball is at the feet with the men down, which is exactly
       what the normal kick curve is for (no scoop, no windup dragging the ball back). Or a PASS if
       a teammate has a better outlet — it must beat the shot by pass.bias, so this can't decay into
       a side that never shoots. */
    const pk=open?null:passPick(r,bp.x,bp.z);
    // …and only if the pass swing will genuinely CONNECT. The dribble releases on the control
    // tolerance (ddz<holdZ), which is looser than a strike needs, and passShot contacts ~0.2s after
    // the commit — plenty of time for a nudged ball to slide out from under the boot. Failing the
    // gate doesn't cancel the release; it just plays the ordinary swing instead of an aimed one.
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
    /* WORK IT: aim the man a short lead PAST the ball toward the target, capped by the cumulative
       travel budget from where control was taken. The lead must stay well under the boot's z reach
       or the man simply walks off the ball instead of pushing it. `want` with no alignment = SQUARE
       UP instead (lead 0, i.e. aim dead at the ball) so the strike can land next frame. */
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
  //      dribble.noPoke widens that to the inFront window for a dribbling role: a covered rod
  //      poking at full stretch is what fires the ball straight back into the row opposite, and the
  //      ball has to be ALLOWED to arrive at the feet before the dribble action can ever take it.
  let holdShot=false;
  const holdReach=overFoot||(DR.on&&DR.noPoke&&inFront&&DR.roles.indexOf(r.role)>=0);
  if(GA.gap&&r.aiIQ&&r.aimEv&&holdReach&&slow&&(r.role==='ATT'||r.role==='MID')&&r.aimEv.best.clr<GA.openMargin){
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
   /* A covered shot with a teammate ahead who has a better one becomes a PASS instead of a hopeful
      strike into the row opposite. This is the half of the passing idea that works WITHOUT a
      dribble — it fires on the ordinary swing, so build-up play still happens when there was never
      time (or room) to take the ball down. Wider role list than the dribble on purpose: a DEFENDER
      passing forward rather than hoofing it is exactly the behaviour we want; it's only CARRYING
      the ball in its own half it shouldn't do. */
   const PS=DR.pass;
   let aimAt=null,pk=null;
   if(PS.on&&PS.onKick&&r.aiIQ&&PS.roles.indexOf(r.role)>=0&&r.aimEv&&r.aimEv.best.clr<PS.onKickClr){
    pk=passPick(r,bp.x,bp.z);
    // The pass is only ON if a boot will actually be on the ball when the SOFT pass curve contacts
    // (~0.08–0.20s from here — see strikeOn). canKick's inFront window is over 4u wide and reads a
    // delayed ball, which is fine for the normal swing that fires immediately after it and hopeless
    // for one that lands a fifth of a second later. Refused ⇒ aimAt stays null and this becomes an
    // ordinary kick, which is exactly the behaviour that was already correct.
    if(pk&&pk.clr>=PS.minClear&&strikeOn(r,best,'pass'))aimAt={x:pk.x,z:pk.z};
   }
   if(aimAt&&dbgLogRod===r)dbgRod(r,'PASS','→ '+pk.rod.role+' z='+pk.z.toFixed(1)+' pc='+pk.clr.toFixed(1)+' on='+pk.onward.toFixed(1)+' shotClr='+r.aimEv.best.clr.toFixed(1));
   kickRod(r,aimAt?'pass':null,aimAt);
   r.cd=D.cd*stCd(r)*(slow?aiR(r,AIC.cdSlow[0],AIC.cdSlow[1]):aiR(r,AIC.cdFast[0],AIC.cdFast[1])); // rea stat trims recovery
  }
 }
}
