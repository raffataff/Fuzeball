'use strict';
// ================= shots: the player's kick verbs =================
// a modifier axis (power - finesse, -1..+1) colours a kick, and a charge (a pull-back) powers it
// physics reads only r.shotOn / r.shotPow / r.shotCtl; a tapped kick with no trigger must stay the original kick; CONFIG.shots.on:false restores the pre-shots pad
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

// --- what the axis is worth ---
// everything here is exactly 1 (or CONFIG.kick untouched) at m=0
function shotAxisPow(m){const M=SHOTC.mod;return m<0?lerp(1,M.softPow,-m):lerp(1,M.hardPow,m);}
function shotAxisCtl(m){const M=SHOTC.mod;return m<0?lerp(1,M.softCtl,-m):lerp(1,M.hardCtl,m);}
function shotAxisTrack(m){const M=SHOTC.mod;return m<0?lerp(1,M.softTrack,-m):lerp(1,M.hardTrack,m);}
function shotAxisExert(m){const M=SHOTC.mod;return m>0?lerp(1,M.hardExert,m):1;}
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
 h.holdGrip=lerp(stGrip(r),H.grip,t);
 h.carryMult=lerp(1,H.carry,t);
}

// --- the PIN (finesse + raise) ---
// the input half (CONFIG.shots.pin): may this rod pin, and is it being posed; physics.js pinUpdate / pinBallStep do the catch, carry and releases
// r.pinA is sweep-capped like a wind-up and frozen while a ball is pinned
function shotPinInput(r,I){
 const P=SHOTC.pin;
 if(!P||!P.on){r.pinOn=false;r.pinPose=false;return;}
 // finesse held, not finesse's grip: the keyboard grip eases in, which dropped the pose on a chord
 const fin=(I.fin!=null)?I.fin:I.lt>SHOTC.hold.from;
 r.pinOn=fin&&r.chg<0&&r.kickT<0;
 if(!r.pinOn)r.pinPose=false;
 else if(I.rz)r.pinPose=true;
 if(r.pinPose&&!r.pinB)r.pinA=shotPullCap(r,r.angle,P.angle*r.kickDir);
}
// a kick from the pin is the pin shot: the AI's trapShot curve, no spray, ignores the finesse axis; kickRod keeps carryOut of the slide
function shotPinFire(r){
 const P=SHOTC.pin;
 r.shotOn=true;r.shotPow=P.pow;r.shotCtl=P.ctl;r.shotExert=1;r.shotOver=0;   // clean, not charged: no overspeed
 r.pinPose=false;
 kickRod(r,'trapShot');
}
// what the pin shows the player: the ring under the caught ball (fx.js pinMarkUpdate) and the kick plate (hud.js hudPinHint) both ask these
function shotPinBall(s){const r=s&&seatRod(s),b=r&&r.pinB;return b&&!b.scored?b:null;}
function shotPinSeat(){for(let i=0;i<S.seats.length;i++)if(shotPinBall(S.seats[i]))return S.seats[i];return null;}
// the plate is live play only, off for a player who switched it off, and off in the tutorial (its own prompt says it)
function shotPinHintOn(){const P=SHOTC.pin,H=P&&P.hint;return !!(shotsOn()&&P&&P.on&&H&&H.on&&cfg.pinHint!==false&&S.phase==='play'&&!S.tut);}

// swing curve for a button kick at axis m: blends CONFIG.kick toward mod.soft / mod.hard key by key; null at m~0
const SHOT_CURVE_KEYS=['windup','windupA','strike','strikeA','hold','drop','powFrom','powTo','rest','restPower'];
function shotBlend(m){
 if(Math.abs(m)<1e-3)return null;
 const M=SHOTC.mod,anc=m<0?M.soft:M.hard,t=Math.abs(m),out={};
 for(const k of SHOT_CURVE_KEYS){const base=KICK[k];out[k]=(anc[k]!=null)?lerp(base,anc[k],t):base;}
 // keep the ramp keyframes ordered or updateRods' if-chain skips a phase
 out.strike=Math.max(out.windup+1e-3,out.strike);
 out.hold=Math.max(out.strike,out.hold);
 out.drop=Math.max(out.hold+1e-3,out.drop);
 return out;
}

// --- what the charge is worth ---
// power rises to the sweet band, is flat across it, then falls; control does the same
function shotChgPow(k){
 const C=SHOTC.charge,s0=C.sweetFrom,s1=C.sweetTo;
 if(k<=s0)return lerp(C.powMin,C.powMax,s0>0?k/s0:1);
 if(k<=s1||s1>=1)return C.powMax;
 return lerp(C.powMax,C.overPow,(k-s1)/(1-s1));
}
function shotChgCtl(k){
 const C=SHOTC.charge,s0=C.sweetFrom,s1=C.sweetTo;
 if(k<=s0)return lerp(C.ctlMin,1,s0>0?k/s0:1);
 if(k<=s1||s1>=1)return 1;
 return lerp(1,C.overCtl,(k-s1)/(1-s1));
}
// 0 below the band, 1 inside it, 2 past it (fx.js tints from this)
function shotChgBand(k){const C=SHOTC.charge;return k<C.sweetFrom?0:(k<=C.sweetTo?1:2);}
function shotOver(k){const C=SHOTC.charge;return C.sweetTo>=1?0:clamp((k-C.sweetTo)/(1-C.sweetTo),0,1);}
// what the wind-up was worth, stamped when it ends: 0 too early, 1 clean, 2 overcooked, 3 no room (blocked outranks the band)
function shotVerdict(r,k){
 const C=SHOTC.charge;
 r.chgEndT=S.time;
 r.chgEndK=Math.max(0,k);
 r.chgEndBand=((r.chgBlock||0)>=C.blockAt)?3:(k<C.minFire?0:shotChgBand(k));
}

// --- arming ---
// r.shotOn is all physics.js tests: armed while a charge is live and its swing in flight, consumed by the first contact (shotConsume)
function shotArm(r,m,k){
 r.shotOn=true;
 r.shotPow=shotAxisPow(m)*(k>=0?shotChgPow(k):1);
 r.shotCtl=clamp(shotAxisCtl(m)*(k>=0?shotChgCtl(k):1),0,1);
 r.shotExert=shotAxisExert(m);
 r.shotOver=k>=0?shotChgOver(k):0;
}
function shotDisarm(r){r.shotOn=false;r.shotPow=1;r.shotCtl=1;r.shotExert=1;r.shotOver=0;}
// what a charge is worth against the speed cap (physics.js capSpeed, CONFIG.kick.cap.charge): 0 none, 1 across the band, 0 overcooked
function shotChgOver(k){const C=SHOTC.charge;return clamp((shotChgPow(k)-1)/Math.max(1e-6,C.powMax-1),0,1);}
// called by collideRod when a contact takes its power: one contact, one shot
// Total Control has no discrete fire (the chord drop only banks the worth), so spend the bank here; gated on r.chgRel, which only the stick path sets
function shotConsume(r){
 if(!r.shotOn)return;
 // Total Control's verdict belongs to the contact; stamped on r.chgRel (what the player released at)
 if(r.chgRel>0){shotVerdict(r,r.chgRel);r.chg=-1;r.chgRel=0;r.chgMod=null;}
 shotDisarm(r);
}
// full teardown (charge, arming, tremble, blended curve); from resetRodRotation and whenever a seat lets go of a rod
function shotReset(r){
 if(!r)return;
 r.chg=-1;r.chgRel=0;r.chgGrace=0;r.chgMod=null;r.chgSrc=null;r.chgA=null;r.chgHeld=0;r.chgSweet=false;r.trem=0;
 r.chgBlock=0;r.chgEndT=null;r.chgEndBand=-1;r.chgEndK=0;   // the blocked reading and the held verdict
 r.shotTrack=1;r.kickCurve=null;shotDisarm(r);
 if(r.hold)r.hold.on=false;
 r.pinOn=false;r.pinPose=false;r.pinA=null;
 if(r.pinB)pinRelease(r);                         // a pinned ball never outlives the hand holding it
}

// --- the wind-up angle (classic) ---
// the deepest pull-back toward aTo whose swept boot doesn't shove a ball goalward (trapAngle's ladder minus footHolds); guard off = the raw target
// the leg moves too (collideRod resolves against the capsule when the foot box misses, sweepClips only tests the box), so shotLegClips asks the same of the capsule
function shotLegClips(r,b,a){
 const SW=AIC.trap.sweep,R=BALL_R+PRAD+SW.pad,p=b.m.position;
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
 const SW=AIC.trap.sweep;
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
// a deep finesse kick is a pass, aimed by the AI's passEval (cached per rod)
// shotPassPick: not passEval's answer; a human presses now and the assist only bends a pass ~9 degrees (CONFIG.ai.dribble.pass.assist), so score the same lanes by whether the bend is deliverable; null = LT+kick is a plain soft touch
function shotPassPick(r,bx,bz){
 const P=AIC.dribble.pass,dir=r.team===0?1:-1,maxBend=P.assist*SHOTC.pass.bendMult;
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
   const score=clr*P.wClear-bend*SHOTC.pass.bendCost;
   if(!best||score>best.score)best={rod:o,man:i,x:o.x,z:tz,clr,bend,score};
  }
 }
 return best;
}
function shotPassTarget(r,m){
 if(!SHOTC.pass.on||m>SHOTC.pass.modAt)return null;
 let best=null,bd=1e9;
 for(const b of S.balls){if(b.scored)continue;const d=Math.abs(b.m.position.x-r.x);if(d<bd){bd=d;best=b;}}
 if(!best)return null;
 return shotPassPick(r,best.m.position.x,best.m.position.z);
}
// one entry point for every button swing, charged or not; m~0 with no charge is literally the old kickRod(r)
// owns the flinch rule (a charge can be let go by the trigger or the kick button)
function shotFire(r,m,k){
 if(!shotsOn()){kickRod(r);return;}
 // a swing in flight can't be re-fired
 if(r.kickT>=0)return;
 if(k>=0&&k<SHOTC.charge.minFire)k=-1;        // a flinch is an ordinary swing, not a feeble charged one
 const pt=shotPassTarget(r,m);
 if(k>=0)shotArm(r,m,k);else if(Math.abs(m)>=1e-3)shotArm(r,m,-1);else shotDisarm(r);
 // a pass takes no blended curve: it swings on CONFIG.ai.passShot like the AI's
 kickRod(r,pt?'pass':(r.shotOn?'shot':null),pt||null,pt?null:shotBlend(m));
 r.swOver=r.shotOn?(r.shotOver||0):0;         // a charge beats the speed cap for the WHOLE swing (physics.js capSpeed)
}
// horizontal-only rotation of the outgoing velocity (no energy); own rng stream since it changes an outcome
function shotSpray(b,r){
 const a=SHOTC.charge.spray*(1-clamp(r.shotCtl,0,1));
 if(a<=0)return;
 const th=(RNG.shot()*2-1)*a,cs=Math.cos(th),sn=Math.sin(th),vx=b.v.x,vz=b.v.z;
 b.v.x=vx*cs-vz*sn;b.v.z=vx*sn+vz*cs;
}

// --- what each device says ---
// every device writes a record (source, depth, its half of the axis, hold depth) and one step per seat per frame reads the merge
// a source already holding keeps it; sources: stick (Total Control chord + stick back), rt, kick (cfg.padChargeBtn), key (power binding)
const SHOT_SRCS=['stick','rt','kick','key'];
function shotInNew(){return {live:false,m:0,lt:0,TC:false,stick:0,rt:0,kick:false,key:0,rz:false,fin:false};}   // rz: raise held (the pin pose) · fin: finesse DOWN (not its eased grip)
function shotSrcDepth(I,k){return k==='stick'?I.stick:k==='rt'?I.rt:k==='kick'?(I.kick?1:0):k==='key'?I.key:0;}
// one pad read into o; stickD = the right-stick value, -1 fully back .. +1
function shotPadRead(o,gp,TC,stickD){
 const lt=shotTrigD(gp,6),rt=shotTrigD(gp,7);
 o.live=true;o.m=shotAxis(lt,rt);o.lt=lt;o.TC=TC;o.stick=0;o.rt=0;o.kick=false;o.key=0;
 o.rz=gpDown(gp,2);                              // X: raise — with LT held, the pin pose (shotPinInput)
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
  const r=(!S.freeRoam&&(S.phase==='play'||S.phase==='count'))?seatRod(s):null;
  if(s.shotRod&&s.shotRod!==r){shotReset(s.shotRod);rodInputRelease(s.shotRod);}
  s.shotRod=r;
  const P=s.shotPad;
  if(!r||!shotsOn()){if(r)shotReset(r);if(P)P.live=false;s.kbmFin=0;s.rzEdge=false;continue;}
  const pw=kOn&&bindHeld('power',s),fn=kOn&&bindHeld('finesse',s),rz=kOn&&bindHeld('raise',s);
  // a button has no squeeze, so the grip eases in over holdRamp
  s.kbmFin=fn?Math.min(1,(s.kbmFin||0)+dt/Math.max(1e-3,K.holdRamp)):0;
  const I=SHOT_IN,pl=!!(P&&P.live);
  I.live=true;
  I.m=clamp((pl?P.m:0)+shotAxis(fn?1:0,pw?1:0),-1,1);
  I.lt=Math.max(pl?P.lt:0,s.kbmFin);
  I.TC=pl&&P.TC;
  // power winds up only with raise held (needRaise)
  I.stick=pl?P.stick:0;I.rt=pl?P.rt:0;I.kick=pl&&P.kick;
  I.key=(pw&&(!SHOTC.charge.needRaise||rz))?1:0;
  // raise from any device (with finesse, the pin pose); s.rzEdge latches a press so a sub-frame tap isn't missed
  I.rz=rz||(pl&&P.rz)||!!s.rzEdge;s.rzEdge=false;
  I.fin=fn||(pl&&P.fin);
  shotStep(dt,r,I);
  if(P)P.live=false;                             // a pad that stops reporting (unplugged) stops counting
 }
}
// a kick press from any device: plain = shotFire on the live axis, with a wind-up live it releases it; Total Control's stick charge is judged at contact
function shotKickEdge(r,m){
 const k=shotCharge(r),C=SHOTC.charge;
 // a ball on the pin: the kick is the pin shot whatever the axis says
 if(r.pinB&&r.kickT<0){shotPinFire(r);return;}
 if(k>=0&&r.chgSrc&&r.chgSrc!=='stick'&&r.kickT<0){
  shotVerdict(r,k);
  shotFire(r,(r.chgMod!=null?r.chgMod:m),k);
  if(C.tone.on)Au.chargeFire(k,shotChgBand(k)===1);
  return;
 }
 // ...or a wind-up let go a beat ago (fingers lift a frame apart)
 if(k<0&&r.chgGrace>0&&r.chgRel>0&&r.kickT<0){
  const kk=r.chgRel,mm=(r.chgMod!=null?r.chgMod:m);
  r.chgGrace=0;r.chgRel=0;r.chgMod=null;
  shotVerdict(r,kk);
  shotFire(r,mm,kk);
  if(C.tone.on)Au.chargeFire(kk,shotChgBand(kk)===1);
  return;
 }
 shotFire(r,m,k);
}

// --- the per-frame state machine ---
// one pad stepped on its own (what tools/shots-harness.js drives; the game steps the merge in shotSeatsUpdate); frame time, not sim time; true when it fired
function shotPadUpdate(dt,gp,s,r,TC,stickD){
 if(!shotsOn()){shotReset(r);return false;}
 return shotStep(dt,r,shotPadRead(SHOT_TMP,gp,TC,stickD));
}
function shotStep(dt,r,I){
 const C=SHOTC.charge,lt=I.lt,m=I.m;
 r.shotTrack=I.TC?shotAxisTrack(m):1;
 // the window a let-go wind-up can still be fired in (shotKickEdge)
 if(r.chgGrace>0){r.chgGrace-=dt;if(r.chgGrace<=0){r.chgGrace=0;if(r.chg<0){r.chgRel=0;r.chgMod=null;}}}

 // WHO IS HOLDING THE WIND-UP — see SHOT_SRCS above.
 let src=null,depth=0;
 if(C.on&&r.kickT<0){
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
   // fire on the axis the wind-up was held at (r.chgMod), not the live one (RT is on its way up at release)
   shotFire(r,(r.chgMod!=null?r.chgMod:m),tap?-1:k);
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
  if(r.chgSrc!==src){r.chgSrc=src;r.chg=Math.max(0,r.chg);r.chgRel=0;r.chgGrace=0;r.chgMod=null;r.chgHeld=0;r.chgSweet=false;r.chgEndT=null;r.chgBlock=0;}
  r.chgHeld+=dt;
  r.chg=clamp(r.chg+C.rate*depth*dt,0,1);
  r.chgMod=m;                                    // what the triggers said WHILE winding up (see the release)
  shotArm(r,m,r.chg);
  // the pull-back deepens with the charge and is fully back by the band's lower edge, so the band is a flat maximum; Total Control authors no angle
  if(src!=='stick'){
   const full=C.pullA*r.kickDir,ask=clamp(C.sweetFrom>0?r.chg/C.sweetFrom:1,0,1);
   r.chgA=shotPullCap(r,r.angle,full*ask);
   // is the swing actually there? both tests: the angle alone reads blocked while the rod eases back, shotPullOk alone fires once it rests on the ball
   const got=Math.abs(full)>1e-4?clamp(r.angle/full,0,1):1;
   const deny=(shotPullOk>=1)?0:clamp(ask-got,0,1);
   r.chgBlock=lerp(r.chgBlock||0,deny,Math.min(1,C.blockLerp*dt));
  }else{r.chgA=null;r.chgBlock=0;}               // Total Control authors no angle: nothing to refuse
 }else if(r.chg>0&&!fired){
  // an abandoned wind-up only fades: the release banks the worth (chgRel) and fades toward an ordinary swing (re-deriving would restore full power on the way down)
  r.chg=Math.max(0,r.chg-C.decay*dt);
  if(r.chg<=0){r.chg=-1;r.chgRel=0;r.chgMod=null;shotDisarm(r);}
  else{
   const f=r.chgRel>0?clamp(r.chg/r.chgRel,0,1):0;
   r.shotOn=true;
   r.shotPow=shotAxisPow(m)*lerp(1,shotChgPow(r.chgRel),f);
   r.shotCtl=clamp(shotAxisCtl(m)*lerp(1,shotChgCtl(r.chgRel),f),0,1);
   r.shotExert=shotAxisExert(m);
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
 shotPinInput(r,I);

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
