'use strict';
// ===== seats: who is holding which rod =====
// a seat is one human: a team, input devices and the rod they hold; S.seats is the source of truth (empty = AI showdown / spectate); a one-seat match plays as before (the default seat claims every device)
// devices are a set per seat: 'kbd', 'mouse', 'pad0'..'pad3', 'pad*' (any pad, the solo default); seatForDev(tok) resolves exact match then a 'pad*' holder; an unclaimed device does nothing
// setSeatCtrl skips rods another seat holds; a `lockRole` seat has a one-rod list and can't switch

// every device token a seat can claim, in the lobby's join order; pad tokens come from CONFIG.seats.maxPads (one keyboard and one mouse, so N players needs N-2 pads at best)
const SEAT_DEVS=['kbd','mouse'];
const SEAT_DEV_NAME={kbd:'Keyboard',mouse:'Mouse','pad*':'Controller'};
for(let i=0;i<CONFIG.seats.maxPads;i++){SEAT_DEVS.push('pad'+i);SEAT_DEV_NAME['pad'+i]='Controller '+(i+1);}

// make one seat; `rods` is filled by seatBindRods once the rods exist
function makeSeat(team,devs,lockRole){
 return{team:team,devs:devs.slice(),lockRole:lockRole||null,
  rods:[],ctrl:0,
  tcMult:1,        // live Total-Control slide multiplier for THIS seat's pad (was the global S.tcMult)
  padRaise:false,  // pad raise is a hold — per seat, or two pads would clobber each other's raise
  padAngleArm:true,// right-stick angle authority; a rod switch drops it until the stick re-centres (js/input.js)
  shotRod:null,    // rod this seat drove last frame, so js/shots.js can clear a wind-up left on a rod it let go of
  holdRod:null,    // rod the auto-switch is currently withholding mid-save (js/ai.js autoHoldRod)
  holdT:0,         // …and when that started, so handover.maxHold can expire it
  slideArm:0,      // slide input is ignored until this time (a hand-over must not inherit the swipe in progress)
  padPrev:{}};     // per-seat button edge state (was the global gpPrev)
}
// the default solo seat: one human, every device (keeps a plain quick match identical)
function soloSeat(team,lockRole){return makeSeat(team,['kbd','mouse','pad*'],lockRole);}

// give every seat its switchable rod list (its team's rods goal to goal; a lockRole seat gets one); after the rods exist
function seatBindRods(){
 const claimed=[];                            // rods already handed to an EARLIER lockRole seat
 S.seats.forEach(s=>{
  const mine=rods.filter(r=>r.team===s.team).sort((a,b)=>a.x-b.x);
  // a lockRole seat has one rod, so if a teammate already locked the same role drop the lock rather than weld two players to one handle (rosSetRole is the first guard)
  const lock=s.lockRole?mine.find(r=>r.role===s.lockRole):null;
  if(lock&&claimed.indexOf(lock)<0){s.rods=[lock];claimed.push(lock);}
  else s.rods=mine;
  s.ctrl=0;
 });
 // opening rod: MID if reachable, then push each seat off a rod already spoken for, by hand (setSeatCtrl would stamp S.lastSwitch and click)
 // a seat yields to an earlier seat or to any single-rod lockRole seat
 S.seats.forEach(s=>{const mi=s.rods.findIndex(r=>r.role==='MID');if(mi>=0)s.ctrl=mi;});
 S.seats.forEach((s,i)=>{
  const n=s.rods.length;if(n<2)return;
  for(let t=0;t<n;t++){
   const mine=s.rods[s.ctrl];
   if(!S.seats.some((o,j)=>o!==s&&(j<i||o.rods.length<2)&&seatRod(o)===mine))break;
   s.ctrl=(s.ctrl+1)%n;
  }
 });
}
// the rod a seat is holding, or null; self-heals a stale index
function seatRod(s){
 if(!s||!s.rods.length)return null;
 if(s.ctrl<0||s.ctrl>=s.rods.length)s.ctrl=0;
 return s.rods[s.ctrl]||null;
}
/* The seat holding rod r, or null. THE test the rest of the game asks. */
function seatOf(r){
 for(let i=0;i<S.seats.length;i++)if(seatRod(S.seats[i])===r)return S.seats[i];
 return null;
}
/* Is rod r held by a seat other than `not`? Drives the skip in setSeatCtrl. */
function rodTaken(r,not){
 for(let i=0;i<S.seats.length;i++){const s=S.seats[i];if(s!==not&&seatRod(s)===r)return true;}
 return false;
}
// resolve a device token to its seat: exact match first, then any 'pad*' holder
function seatForDev(tok){
 for(let i=0;i<S.seats.length;i++)if(S.seats[i].devs.indexOf(tok)>=0)return S.seats[i];
 if(/^pad\d+$/.test(tok))for(let i=0;i<S.seats.length;i++)if(S.seats[i].devs.indexOf('pad*')>=0)return S.seats[i];
 return null;
}
// clear AI-driven state from a rod when a player takes control (actions, hold-evade timers, man selection)
// the raise is kept as an inherited latch (r.raiseKeep): an auto switch fires when the ball arrives from behind, when the AI had it lifted; userControlUpdate drops it when the ball reaches the feet, any raise input or kick ends it
function clearRodAI(r){
 if(!r)return;
 r.raiseKeep=!!r.raise;                     // inherited raise — released by rodRaiseRelease / userControlUpdate
 if(!r.raiseKeep)r.behindFlag=false;
 r.act=null;r.heldFwd=false;
 // the rod holds its ground: r.target was left at the AI's destination and keyboard/pad add to it, so pin it to the live offset
 r.target=r.offset;r.slideV=0;
 rodInputRelease(r);                        // a stale stick angle or held kick from an earlier stint would pin this rod
 if(r.hold)r.hold.on=false;                 // …and any L2 grip: the AI drives this rod now
 r.evadeHold=0;r.evadeSpent=false;r.evadeDir=0;
 r.aiMan=-1;
 r.trapMan=-1;r.trapDir=0;
 r.dribMan=-1;r.dribZ=0;r.dribZ0=0;
 r.laneDir=0;
 r.passTo=null;r.aimEv=null;
}
// the player has taken the raise themselves (button, stick or kick): the inherited latch is done
function rodRaiseRelease(r){if(r)r.raiseKeep=false;}
// a rod a seat just let go of: drop every held input still on it (the release lands on the new rod)
//   padAngleOn/Target: the last stick angle (outranks the raise latch and rest-drop in updateRods); kickHold: a held kick that pins the swing
function rodInputRelease(r){if(r){r.padAngleOn=false;r.padAngleTarget=0;r.kickHold=false;}}
// the slide freeze: false = this seat's slide does nothing this frame; set briefly by an auto hand-over (CONFIG.control.handover.settle), since every slide device is relative and the swipe would carry onto the new rod
// kick, raise and angle are untouched; a manual switch is unchanged
function seatSlideOK(s){return !s||S.time>=(s.slideArm||0);}
// absolute rod select, skipping rods other seats hold; `dir` = which way to keep searching when taken; true if the held rod changed
function setSeatCtrl(s,i,dir){
 if(!s||!s.rods.length)return false;
 const n=s.rods.length,d=dir||1,was=s.ctrl;
 let k=((i%n)+n)%n;
 for(let t=0;t<n;t++){                       // at most one lap; if every other rod is taken we land back on our own
  if(!rodTaken(s.rods[k],s)){s.ctrl=k;break;}
  k=((k+d)%n+n)%n;
 }
 if(s.ctrl===was)return false;
 clearRodAI(s.rods[s.ctrl]);                 // handoff: wipe AI state from the newly claimed rod
 rodInputRelease(s.rods[was]);               // …and every held input off the one we just dropped
 s.padAngleArm=false;                        // a stick already held must re-centre before it drives the new rod
 S.lastSwitch=S.time;updateChips();Au.ui('rod');
 return true;
}
function seatStep(s,d){return setSeatCtrl(s,s.ctrl+d,d);}

// ---- seat colour ----
// the kit colour identifies the team, not the player, so each seat past the first on a team is offset in HSL (CONFIG.seats.tint); seatTintHex(team,i) lets the lobby colour cards from plain specs
const _seatCol=new THREE.Color();
function seatTintHex(team,i){
 const T=CONFIG.seats.tint,t=T[Math.min(i,T.length-1)];
 _seatCol.set(team===0?cfg.redColor:cfg.blueColor);
 if(t&&(t.h||t.s||t.l))_seatCol.offsetHSL(t.h,t.s,t.l);
 return'#'+_seatCol.getHexString();      // hex out, so nothing holds the shared Color instance
}
function seatIdxInTeam(s){
 let n=0;
 for(let i=0;i<S.seats.length;i++){if(S.seats[i]===s)return n;if(S.seats[i].team===s.team)n++;}
 return n;
}
function seatCol(s){return s?seatTintHex(s.team,seatIdxInTeam(s)):'#ffffff';}

// ---- compatibility shims ----
// userRod() = the primary seat's rod, right only where one holder is meant (training readout, debug tracer); per-player code uses seatOf/seatRod
function isUserRod(r){return!!seatOf(r);}
function userRod(){return seatRod(S.seats[0]);}
