'use strict';
/* ===== seats — who is holding which rod =====
   A SEAT is one human at the table: a team, a set of input devices, and the rod they're
   currently holding. Replaces the old singleton (`S.userTeam` + `S.ctrl` + `S.ctrlRods`),
   which could only ever describe ONE person and is why local co-op wasn't possible without
   this layer. Everything that used to ask "is this the player's rod?" now asks `seatOf(r)`.

   `S.seats` is the source of truth. Empty = nobody is playing (AI showdown / spectate).
   A one-seat match plays EXACTLY as it did before this existed — that's the design constraint,
   not a coincidence: the default seat claims every device (see `devs` below).

   DEVICES ARE A SET PER SEAT, NOT ONE PER SEAT. This is the subtle part. Solo play is one
   seat holding keyboard AND mouse AND any pad at once — take that away and a solo player
   slides with the mouse on one rod and the arrow keys on another. So a seat carries a `devs`
   list of tokens:
     'kbd'            the keyboard
     'mouse'          mouse move/click
     'pad0'…'pad3'    a SPECIFIC gamepad index — what the lobby hands out when several pads join
     'pad*'           ANY connected pad; the solo default, and exactly what the old code did
                      (it took the first non-null entry from navigator.getGamepads()).
   `seatForDev(tok)` resolves a device to its seat: exact match wins, then a 'pad*' holder.
   A device nobody claims does nothing — which is what makes a second pad inert until someone
   presses to join.

   ROD OWNERSHIP: seats switch rods as before (Q/E, LB/RB, wheel, 1-4), but `setSeatCtrl`
   SKIPS rods another seat is already holding, so two players on one team can't fight over a
   rod. A seat with `lockRole` set has a one-rod list and simply can't switch. */

/* Every device token a seat can claim. Order matters for the lobby's join order. The pad tokens
   are GENERATED from CONFIG.seats.maxPads rather than hand-listed: the pad count also bounds
   rosPads() and gamepadUpdate's poll loop, and three hand-written 4s is three places to forget.
   NOTE this is the hard ceiling on player count — there is exactly one keyboard and one mouse,
   so a match of N players needs N-2 pads at best. */
const SEAT_DEVS=['kbd','mouse'];
const SEAT_DEV_NAME={kbd:'Keyboard',mouse:'Mouse','pad*':'Controller'};
for(let i=0;i<CONFIG.seats.maxPads;i++){SEAT_DEVS.push('pad'+i);SEAT_DEV_NAME['pad'+i]='Controller '+(i+1);}

/* Make one seat. `rods` is filled by seatBindRods once the rods exist (a match can be started
   before boot() has built them — see startMatchNow's force-boot). */
function makeSeat(team,devs,lockRole){
 return{team:team,devs:devs.slice(),lockRole:lockRole||null,
  rods:[],ctrl:0,
  tcMult:1,        // live Total-Control slide multiplier for THIS seat's pad (was the global S.tcMult)
  padRaise:false,  // pad raise is a hold — per seat, or two pads would clobber each other's raise
  padPrev:{}};     // per-seat button edge state (was the global gpPrev)
}
/* The default solo seat: one human, every device. Keeps a plain quick match byte-identical. */
function soloSeat(team,lockRole){return makeSeat(team,['kbd','mouse','pad*'],lockRole);}

/* Give every seat its switchable rod list. A seat gets its team's rods ordered goal→goal; a
   lockRole seat gets exactly one. Called from startMatchNow AFTER the rods exist. */
function seatBindRods(){
 const claimed=[];                            // rods already handed to an EARLIER lockRole seat
 S.seats.forEach(s=>{
  const mine=rods.filter(r=>r.team===s.team).sort((a,b)=>a.x-b.x);
  // A lockRole seat gets exactly one rod and therefore cannot switch — so if a teammate already
  // locked the same role, honouring the lock would weld two players to one handle and both would
  // drive its target. The lobby refuses a duplicate lock (rosSetRole), so this is a backstop for
  // any other caller: drop the lock rather than the player, and let the push-off loop below place
  // them. At 4-a-side there are only 4 roles per side, so the collision is one mis-click away.
  const lock=s.lockRole?mine.find(r=>r.role===s.lockRole):null;
  if(lock&&claimed.indexOf(lock)<0){s.rods=[lock];claimed.push(lock);}
  else s.rods=mine;
  s.ctrl=0;
 });
 // Opening rod: MID if this seat can reach it (the old default), then push each seat off any rod
 // that's already spoken for so two players never start on the same handle. Done by hand rather
 // than via setSeatCtrl because that stamps S.lastSwitch, repaints the chips and plays a click —
 // none of which belong in match setup. With one seat neither loop does anything.
 // A seat YIELDS to an earlier seat (j<i, arbitrary but stable) OR to any single-rod lockRole
 // seat whatever its order — a locked seat physically cannot move, so it can't be the one to give
 // way. Without that second clause an unlocked P1 could take MID before a locked-to-MID P2 was
 // placed, and P2 (n<2) would return early on top of them.
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
/* The rod a seat is holding, or null (no rods bound yet / empty list). Self-heals a stale index. */
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
/* Resolve a device token to the seat that claimed it. Exact match first so a lobby-assigned
   'pad1' beats a solo seat's catch-all; then any 'pad*' holder for a pad token. */
function seatForDev(tok){
 for(let i=0;i<S.seats.length;i++)if(S.seats[i].devs.indexOf(tok)>=0)return S.seats[i];
 if(/^pad\d+$/.test(tok))for(let i=0;i<S.seats.length;i++)if(S.seats[i].devs.indexOf('pad*')>=0)return S.seats[i];
 return null;
}
/* Clear AI-driven state from a rod when a player takes control. The AI skips user rods each
   frame (ai.js:isUserRod), but any state it set before the switch persists — raise latch,
   behindFlag, active actions (trap/dribble/safeRaise/lane/evade), hold-evade timers, man
   selection, etc. Without clearing these the rod stays raised, continues AI angle overrides,
   or mid-action when the player expects a clean handoff. */
function clearRodAI(r){
 if(!r)return;
 r.raise=false;r.behindFlag=false;r.act=null;r.heldFwd=false;
 r.evadeHold=0;r.evadeSpent=false;r.evadeDir=0;
 r.aiMan=-1;
 r.trapMan=-1;r.trapDir=0;
 r.dribMan=-1;r.dribZ=0;r.dribZ0=0;
 r.laneDir=0;
 r.passTo=null;r.aimEv=null;
}
/* Absolute rod select, skipping rods other seats hold. `dir` is the direction to keep searching
   when the requested rod is taken (so a wheel/Q/E press lands on the next FREE rod rather than
   silently doing nothing). Returns true if the held rod actually changed. */
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
 S.lastSwitch=S.time;updateChips();Au.ui();
 return true;
}
function seatStep(s,d){return setSeatCtrl(s,s.ctrl+d,d);}

/* ---- seat colour --------------------------------------------------------------------------
   The kit colour identifies the TEAM; it cannot identify a PLAYER, and with two humans on one
   side that's the thing you actually need at a glance. So each seat past the first on a team is
   offset in HSL from its kit colour (CONFIG.seats.tint) — same family, obviously a different
   person. `seatTintHex(team,i)` is the raw form so the lobby can colour its cards from plain
   specs, before any live seat exists. */
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

/* ---- compatibility shims -----------------------------------------------------------------
   isUserRod is read all over physics/rods/ai; userRod() is "the primary seat's rod" and is only
   right where a SINGLE holder is meant (the training panel's readout, the debug tracer). Anything
   per-player must go through seatOf/seatRod instead — userRod is not a stand-in for them. */
function isUserRod(r){return!!seatOf(r);}
function userRod(){return seatRod(S.seats[0]);}
