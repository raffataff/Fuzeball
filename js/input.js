'use strict';
/* ================= input ================= */
const keys={};
/* Every input site resolves DEVICE → SEAT → ROD (js/seats.js) rather than reading one global
   held rod. `devRod(tok)` is that whole chain: the rod being driven by whoever claimed this
   device, or null when nobody has (spectate, an unclaimed second pad, or a match started
   before boot() built the rods — which is what used to throw on the first mouse move). */
function devSeat(tok){return seatForDev(tok);}
function devRod(tok){const s=seatForDev(tok);return s?seatRod(s):null;}
addEventListener('keydown',e=>{
 // typing in a form control (training panel, team names…) must never kick/slide/preventDefault
 if(e.target&&/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))return;
 if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();
 if(e.repeat)return;keys[e.code]=true;
 // PHOTO MODE (F1) takes the keyboard. Deliberately placed AFTER the keys[] write — photo.js reads
 // that same map for its held WASD/arrow camera moves, so the bookkeeping has to happen either way;
 // it's only the rod ACTIONS below that must not fire while a shot is being framed. photo.js binds
 // its own listener (F1/Esc and the rest), and this file never has to know what any of them do.
 if(S.photo)return;
 // The save key is tested FIRST because every OTHER key skips the replay — without this it
 // would be swallowed by the skip and the clip would end where you asked to keep it.
 if(S.phase==='replay'){if(e.code===REPLAY.save.key)replaySaveClip();else replaySkip();return;}
 if(e.code==='Escape'){
  /* Chrome never delivers this press while the pointer is locked — it releases the lock and eats
     the key, which is why the release itself is read as the pause (pointerlockchange, below).
     Some browsers deliver BOTH, and two pauses in one press is a pause that never happened. */
  if(mlEsc>0&&performance.now()-mlEsc<300){mlEsc=0;return;}
  if(!$('options').classList.contains('hidden')){closeOptions();return;}
  if(!$('lgForfeit').classList.contains('hidden')){$('lgForfeit').classList.add('hidden');return;}
  // out of a match, Esc walks one step back up the screen tree (js/screens.js). backScreen()
  // returns false at a top-level screen, so Esc on the menu still falls through to togglePause.
  if(S.phase==='menu'&&backScreen()){Au.ui();return;}
  togglePause();return;
 }
  if(e.code==='KeyV'&&S.phase!=='menu'){cycleCam(1);}
 if(e.code==='KeyC'&&S.phase!=='menu'){toggleDebug();return;}
 if(e.code==='KeyL'&&S.phase!=='menu'&&dbgOn){cycleKickLog();return;}
 if(e.code==='KeyF'&&S.phase!=='menu'){toggleFreeRoam();return;}
 if(e.code==='KeyM'){togglePerf();return;}   // frame profiler overlay (js/perf.js) — works on the menu too, so a menu-side sag is measurable
 if(S.freeRoam)return;
 if(S.phase!=='play'&&S.phase!=='count')return;
 if(!S.seats.length)return;                       // nobody playing (AI showdown / spectate)
 mouseLockRequest();                              // any in-match key is a gesture too — so the lock catches within a beat of play starting
 const ks=devSeat('kbd'),ur=ks?seatRod(ks):null;
 if(e.code==='KeyB'){toggleSweetGuide(ks);return;}  // sweet-spot guide follows whoever asked (controller ○ mirrors this)
 if(!ur)return;
 if(e.code==='Space'){kickRod(ur);ur.kickHold=true;}   // held = the boot stays out at full stretch (js/rods.js)
 if(e.code==='ShiftLeft'||e.code==='ShiftRight'){ur.raise=true;rodRaiseRelease(ur);}   // your hand on it ends any inherited raise
 if(e.code==='ArrowLeft'||e.code==='KeyQ')seatStep(ks,-1);
 if(e.code==='ArrowRight'||e.code==='KeyE')seatStep(ks,1);
 if(/^Digit[1-4]$/.test(e.code))setSeatCtrl(ks,+e.code[5]-1,1);
});
addEventListener('keyup',e=>{keys[e.code]=false;
 if(S.freeRoam)return;
 if(e.code==='Space'){const ur=devRod('kbd');if(ur)ur.kickHold=false;}   // the swing resumes from its held pose and drops
 if(e.code==='ShiftLeft'||e.code==='ShiftRight'){const ur=devRod('kbd');if(ur){ur.raise=false;rodRaiseRelease(ur);}}});
/* FOCUS LOST WITH A BUTTON DOWN. Alt-tab, or the pointer lock releasing into a pause, means the
   keyup / mouseup for a held key never arrives — and updateRods does not run while paused, so a rod
   would come back still held forward or still raised with no key left to let it go. Nothing here is
   a control: it is only the RELEASE half of every hold, plus the stick re-arm, since a pad left
   deflected while away would otherwise drive the rod on the first poll back. */
addEventListener('blur',()=>{
 for(const k in keys)keys[k]=false;
 if(!S.seats)return;
 S.seats.forEach(s=>{
  const r=seatRod(s);
  if(r){r.kickHold=false;r.raise=false;rodRaiseRelease(r);}
  s.padRaise=false;s.padAngleArm=false;
 });
});
const cvs=$('game');
// Every mouse path below is gated on S.photo for the same reason as the keyboard: in photo mode the
// canvas is a viewfinder, and drag/click/wheel belong to the camera rig (photo.js), not to a rod.
cvs.addEventListener('mousemove',e=>{
 if(S.photo||S.freeRoam||(S.phase!=='play'&&S.phase!=='count'))return;
 const r=devRod('mouse');if(!r)return;
 /* THE MOUSE SLIDE IS RELATIVE, and used to be ABSOLUTE (screen Y mapped straight onto r.target).
    Absolute meant the cursor's position WAS the rod's position, so the first twitch after taking
    over a rod yanked it to wherever the cursor happened to be sitting — almost always the middle
    of the screen. A rod parked by a wall snapped away from that wall before you could move it.
    The rate is unchanged: a full screen-height of travel still covers the full rod, so the feel at
    a given sensitivity is identical. movementY works locked or unlocked, so this needs no pointer
    lock — but with the lock on it also stops costing you travel at the edges of the screen. */
 const dy=e.movementY||0;
 if(dy)r.target=clamp(r.target+(dy/innerHeight)*2*r.maxOff*CTRL.mouseSens*cfg.mouseSens,-r.maxOff,r.maxOff);
});
cvs.addEventListener('mousedown',e=>{
 if(S.photo)return;
 if(S.phase==='replay'){replaySkip();return;}   // click skips the goal replay
 if(S.freeRoam||(S.phase!=='play'&&S.phase!=='count'))return;
 const r=devRod('mouse');if(!r)return;
 mouseLockRequest();                            // a click is a user gesture, which is what the lock needs
 if(e.button===0){kickRod(r);r.kickHold=true;}   // held = the boot stays out at full stretch (js/rods.js)
 if(e.button===2){r.raise=true;rodRaiseRelease(r);}
});
addEventListener('mouseup',e=>{
 if(S.photo||S.freeRoam)return;
 const ur=devRod('mouse');if(!ur)return;
 if(e.button===0)ur.kickHold=false;                                  // the swing resumes from its held pose and drops
 if(e.button===2){ur.raise=false;rodRaiseRelease(ur);}
});
cvs.addEventListener('contextmenu',e=>e.preventDefault());
addEventListener('wheel',e=>{if(!S.photo&&!S.freeRoam&&S.phase==='play'){const ms=devSeat('mouse');if(ms)seatStep(ms,e.deltaY>0?1:-1);}});
function userControlUpdate(dt){
 if(S.photo||S.freeRoam)return;
 const r=devRod('kbd');
 if(r){
  let dz=0;
  if(keys.ArrowUp||keys.KeyW)dz-=1;
  if(keys.ArrowDown||keys.KeyS)dz+=1;
  if(dz)r.target=clamp(r.target+dz*CTRL.slideSpeed*cfg.kbdSens*dt,-r.maxOff,r.maxOff);
 }
 // Auto rod-switch runs PER SEAT, and skips rods another seat is holding — otherwise two
 // players on one team would both be dragged onto whichever rod is nearest the ball. Silent
 // by design (no Au.ui, no S.lastSwitch stamp), so it keeps re-evaluating every frame.
  if(cfg.auto&&S.phase==='play'&&S.time-S.lastSwitch>CTRL.autoDelay&&S.balls.length){
   const bp=S.balls[0].m.position;
   S.seats.forEach(s=>{
    if(s.rods.length<2)return;
    let bi=s.ctrl,bd=1e9;
    s.rods.forEach((rr,i)=>{if(rodTaken(rr,s))return;const d=Math.abs(bp.x-rr.x);if(d<bd){bd=d;bi=i;}});
    if(bi!==s.ctrl){rodInputRelease(s.rods[s.ctrl]);clearRodAI(s.rods[bi]);s.ctrl=bi;s.padAngleArm=false;updateChips();}
   });
  }
 /* INHERITED RAISE. A rod handed over mid-point keeps whatever lift the AI had on it (clearRodAI),
    and this is what lets it go again: the SAME rule a benched rod runs, so the men drop on the
    frame the ball reaches the feet rather than the frame you grabbed the handle. It can only ever
    RELEASE — the latch is set at handoff and never re-armed here — so this can't start raising a rod
    behind the player's back. One check per held rod, and only while a latch is live. */
 S.seats.forEach(s=>{const r=seatRod(s);if(r&&r.raiseKeep&&!rodHoldRaise(r))r.raiseKeep=false;});
}
/* ---- gamepad (Steam controller) ----------------------------------------
   Standard-layout pad mapped onto the SAME rod controls as mouse+keyboard,
   polled once per rendered frame from the main loop. Buttons are edge-detected
   via gpPrev so a held button fires once. Menus still use the mouse; this
   drives in-match play + pause/resume, which is the controller baseline a
   Steam build needs. Layout: left-stick Y / d-pad ↕ = slide · A(0) = kick ·
   X(2) = raise (hold) · LB(4)/RB(5) or d-pad ↔ = switch rod · B(1) = sweet-spot
   guide · Y(3) = camera · Start(9) = pause.
   THE TRIGGERS ARE MODIFIERS, NOT DUPLICATE BUTTONS (js/shots.js). LT(6) and RT(7)
   used to be a second raise and a second kick — duplicates of X and A. They are now
   one analog AXIS, RT depth − LT depth: finesse ← 0 → power, colouring the swing and,
   in classic, holding the charge (cfg.padChargeBtn). With CONFIG.shots.on false they
   go back to being the duplicate kick/raise they were, which is what makes that flag
   a true off switch.
   TOTAL CONTROL mode (cfg.padControlMode='total'): the same two triggers ALSO scale the
   slide step — LT eases toward cfg.padTCFine (precision), RT toward cfg.padTCFast, neither
   = cfg.padTCBase — so each trigger means one thing across both jobs. The right stick angles
   the rod on its bound axis (and its pull-back is the wind-up, armed by holding both triggers);
   the OTHER right axis is the swerve line — its deflection is stored on the rod (r.tcSpin) and
   physics.js bends the ball with it on contact. */
const gpFree={};   // button edge state for pads NO seat has claimed — they can still hit Start/skip
function gpDown(gp,i){const b=gp.buttons[i];return!!b&&(b.pressed||b.value>0.5);}
/* Which seat drives pad #idx. A seat given an explicit 'pad2' owns that pad wherever it sits in
   the array; a solo seat's catch-all 'pad*' only answers to the FIRST connected pad, which is
   exactly what the old single-pad code did (it took getGamepads()'s first non-null entry). Without
   that restriction a second pad plugged in mid-match would start driving the first player's rod. */
function padSeat(idx,first){
 const s=seatForDev('pad'+idx);
 if(!s)return null;
 if(s.devs.indexOf('pad'+idx)<0&&idx!==first)return null;
 return s;
}
// Shared TC swerve read: raw right-stick axes → signed swerve in ±1 (deadzone-rescaled,
// sens-scaled, invert applied). gamepadUpdate stores it on the rod; the options live
// tester previews the same value, so what you see there is what the strike applies.
function tcSwerveFromAxes(gp){
 let sx=(cfg.padAngleAxis==='rx'?gp.axes[3]:gp.axes[2])||0;
 if(Math.abs(sx)>cfg.padDeadzone)sx=(Math.abs(sx)-cfg.padDeadzone)/(1-cfg.padDeadzone)*Math.sign(sx);else sx=0;
 return clamp(sx*cfg.padTCSwerve,-1,1)*(cfg.padTCSpinInvert?-1:1);
}
addEventListener('gamepadconnected',e=>{console.log('gamepad connected:',e.gamepad.id);});
function gamepadUpdate(dt){
 if(S.photo)return;                                    // photo mode: a resting stick must not creep a rod out of shot
 if(!$('options').classList.contains('hidden'))return; // options screen owns the pad (live tester)
 const pads=navigator.getGamepads?navigator.getGamepads():[];
 // reset every frame; a seat with a live pad rewrites both below (shots.js shotHoldUpdate).
 // The hold has to be reset HERE rather than in updateRods: this polls once per rendered frame
 // and updateRods runs up to sim.maxSteps times inside one, so a reset there would drop the grip
 // after the first sim step. Above the no-pads bail, so unplugging a pad releases the boot.
 S.seats.forEach(s=>{s.tcMult=1;const hr=seatRod(s);if(hr&&hr.hold)hr.hold.on=false;});
 let first=-1;for(let i=0;i<pads.length;i++)if(pads[i]){first=i;break;}
 if(first<0)return;
 // Global actions (pause / replay skip) fire from ANY pad but only ONCE per frame — two players
 // pressing Start in the same frame must not toggle pause twice and land back where they started.
 let didPause=false,didSkip=false;
 for(let idx=0;idx<pads.length&&idx<CONFIG.seats.maxPads;idx++){
  const gp=pads[idx];if(!gp)continue;
  const seat=padSeat(idx,first);
  // edge state lives on the SEAT so two pads can't share one gpPrev (a held button on pad 1
  // would swallow pad 2's press). Unclaimed pads get a scratch slot so Start still works.
  const prev=seat?seat.padPrev:(gpFree[idx]||(gpFree[idx]={}));
  const just={};
  for(const i of [0,1,3,4,5,7,9,14,15]){const d=gpDown(gp,i);just[i]=d&&!prev[i];prev[i]=d;}
  // Y saves the clip (same reasoning as the keyboard branch — it must beat the skip buttons);
  // A/B/Start still skip. Save is deliberately NOT didSkip-guarded: replaySaveClip is idempotent.
  if(S.phase==='replay'){if(just[REPLAY.save.pad])replaySaveClip();
   else if(!didSkip&&(just[0]||just[1]||just[9])){didSkip=true;replaySkip();}continue;}
  if(just[9]&&!didPause&&(S.phase==='play'||S.phase==='count'||S.phase==='pause')){didPause=true;togglePause();}
  if(!seat)continue;
  padSeatUpdate(dt,gp,seat,just);
 }
}
/* One seat's pad, for one frame. The rod, the raise-hold latch and the Total-Control slide
   multiplier come off the SEAT rather than off module globals, so N pads drive N rods independently.

   ORDER MATTERS HERE and it is not the order this function used to run in. The right-stick ANGLE is
   read BEFORE the kick button now, because js/shots.js needs that stick value: in Total Control the
   stick's pull-back IS the wind-up, and the charge state it produces decides whether the kick button
   press this frame is a swing or the release of one. Slide, then angle, then shots, then buttons. */
function padSeatUpdate(dt,gp,s,just){
 const r=(!S.freeRoam&&(S.phase==='play'||S.phase==='count'))?seatRod(s):null;
 // A rod this seat has let go of (switched away, match over) must not keep a live wind-up: the
 // charge would sit armed on a rod the AI is now driving and turn up on its next contact.
 if(s.shotRod&&s.shotRod!==r){shotReset(s.shotRod);rodInputRelease(s.shotRod);}
 s.shotRod=r;
 if(!r){s.padRaise=false;return;}
 const DZ=cfg.padDeadzone,TC=cfg.padControlMode==='total';
 // TC SPEED: the analog triggers scale how many units the SLIDE STEP covers per frame (slideMult).
 // LT squeezes toward padTCFine (precision — smaller steps), RT toward padTCFast (fast — bigger
 // steps), neither = padTCBase middle-ground; LT wins when both are held. This is a step-SIZE knob,
 // NOT a rod-speed throttle: the seat's tcMult feeds its rod's chase cap in rods.js but is floored at 1 so
 // the rod always tracks its target at full user speed. Fine mode must not make the rod feel like
 // syrup — it just moves the target in finer increments; the rod still snaps to it crisply. RT's
 // boost (>1) still raises the cap so big fast steps aren't clipped. Untouched pad → tcMult 1.
 // LT WINNING THE TIE IS ALSO WHAT MAKES THE CHARGE CHORD USABLE: both triggers held is the Total
 // Control wind-up, and it lands on the FINE step size, which is exactly what you want while lining
 // a charged shot up. No special case — it falls out of the order these two lerps were already in.
 let slideMult=1;
 if(TC){
  const trig=i=>{const b=gp.buttons[i];return b?(b.value||(b.pressed?1:0)):0;};
  const lt=trig(6),rt=trig(7);
  let m=cfg.padTCBase;
  if(rt>0)m=lerp(m,cfg.padTCFast,rt);
  if(lt>0)m=lerp(m,cfg.padTCFine,lt);
  const padLive=gp.buttons.some(b=>b.pressed||b.value>0.02)||gp.axes.some(a=>Math.abs(a)>DZ);
  slideMult=m;s.tcMult=padLive?Math.max(1,m):1;
 }else s.tcMult=1;
 // SLIDE: which analog axis drives the men is configurable — 'ly' = left-stick up/down (axis 1),
 // 'lx' = left-stick left/right (axis 0). Deflection PAST the deadzone is rescaled to 0..1 (so speed
 // eases up from zero instead of snapping to DZ-worth of speed at the edge — that hard step is what
 // made a small touch lurch the rod) then shaped by an exponent curve (padSlideCurve>1 = finer control
 // near centre, full speed still reached at full push). Optionally inverted, scaled by cfg.padSlideSens.
 let ax=(cfg.padSlideAxis==='lx'?gp.axes[0]:gp.axes[1])||0,ay=0;
 if(Math.abs(ax)>DZ){
  const n=(Math.abs(ax)-DZ)/(1-DZ);                  // 0 at deadzone edge → 1 at full deflection
  ay=Math.pow(n,cfg.padSlideCurve)*Math.sign(ax);
  if(cfg.padSlideInvert)ay=-ay;
 }
 if(gpDown(gp,12))ay-=1;if(gpDown(gp,13))ay+=1;      // d-pad ↕ always slides (digital)
 if(ay)r.target=clamp(r.target+ay*CTRL.slideSpeed*cfg.padSlideSens*slideMult*dt,-r.maxOff,r.maxOff);
 // ANGLE: ABSOLUTE rod tilt — the stick's *position* maps straight to a target angle, so a partial
 // push holds a partial angle (rate control snapped to the extremes). Axis is configurable — 'ry' =
 // right-stick up/down (axis 3), 'rx' = right-stick left/right (axis 2). Deflection past the deadzone
 // is rescaled to 0..1 (no jump off centre), inverted + sens-scaled, then split about rest: one side
 // eases toward the forward strike angle, the other toward the raised-back angle. Centre = feet down.
 // sd is that same signed value hoisted out for shots.js: −1 fully pulled back … +1 fully forward.
 let rs=(cfg.padAngleAxis==='rx'?gp.axes[2]:gp.axes[3])||0,sd=0;
 /* RE-CENTRE GATE. The stick maps to angle ABSOLUTELY and, at the default padAngleLerp of 0, with
    no smoothing at all — so a stick already pushed forward at the moment you switch rods would
    snap the newly claimed rod from the raised angle to the strike angle in ONE frame. That is the
    ~85 rad/s angVel spike behind the tunnelling and the sideways glitch (see the kickA0 note in
    js/rods.js), arriving unasked-for on a rod you had only just picked up. So a switch disarms the
    stick (seats.js padAngleArm) and it takes authority back only after passing through the
    deadzone. Until then sd stays 0, so a held stick can't arm a wind-up on the new rod either, and
    the inherited raise holds the men up untouched. */
 if(!s.padAngleArm&&Math.abs(rs)<=DZ)s.padAngleArm=true;
 if(s.padAngleArm&&Math.abs(rs)>DZ){
  if(cfg.padAngleInvert)rs=-rs;
  let d=(Math.abs(rs)-DZ)/(1-DZ)*Math.sign(rs);      // 0 at deadzone edge → ±1 at full deflection
  d=clamp(-d*cfg.padAngleSens,-1,1);                 // sens scales reach; sign keeps the old push direction
  sd=d;
  r.padAngleTarget=(d>=0?d*KICK.strikeA:-d*KICK.raiseA)*r.kickDir; // +push→forward, −push→raised; ×kickDir per team
  r.padAngleOn=true;
  rodRaiseRelease(r);                                // the stick is driving the angle now — inherited raise done
 }else{r.padAngleTarget=0;r.padAngleOn=false;}
 // TC SWERVE: the right-stick axis NOT bound to angle is the swerve line. Sampled via the
 // shared tcSwerveFromAxes (also what the options tester previews) and stored on the rod;
 // physics.js adds it to the ball's side-spin on contact — so the line the stick takes
 // through the strike bends the shot. Angle control above is untouched: one stick, both effects.
 if(TC){r.tcSpin=tcSwerveFromAxes(gp);}
 else if(r.tcSpin)r.tcSpin=0;
 /* SHOTS (js/shots.js): the trigger axis, the charge, and the swing a charge release fires. Returns
    true when it fired one this frame, so the kick edge below cannot fire a second. */
 const fired=shotPadUpdate(dt,gp,s,r,TC,sd);
 // A: kick. RT is the alternate kick ONLY while shots are off — with them on it is the power side of
 // the modifier axis (and, in classic, the input that holds the wind-up), and a trigger that both
 // colours a swing and fires one cannot do either legibly.
 // shotCharge(r) is -1 unless a wind-up is live, so a plain tap is the plain swing — but with one
 // held it makes the kick button a SECOND release for it. Two ways to let a classic charge go (the
 // trigger, or this) is the ergonomics you reach for without being told, and without it the press
 // fired an uncharged swing out of the wound-back angle and threw the charge away.
 if((just[0]&&!fired&&shotKickPress(TC))||(!TC&&just[7]&&!shotsOn()))shotFire(r,shotPadAxis(gp),shotCharge(r));
 if(just[1])toggleSweetGuide(s);                     // ○ (B) — sweet-spot guide, on THIS seat's rod
 if(just[3])cycleCam(1);                             // Y
 if(just[4]||just[14])seatStep(s,-1);                // LB / d-pad ← (skips rods another seat holds)
 if(just[5]||just[15])seatStep(s,1);                 // RB / d-pad →
 // raise is a HOLD; only write r.raise from the pad while its button is down or we just released
 // it, so a connected-but-idle pad never clobbers keyboard/mouse raise. If the right stick is
 // actively driving the angle, or a wind-up is being held, skip the binary raise so it doesn't fight.
 // LT is the alternate raise only while shots are off — with them on it is the finesse trigger.
 const raise=gpDown(gp,2)||(!TC&&gpDown(gp,6)&&!shotsOn());
 if(!r.padAngleOn&&!r.chgSrc){if(raise){r.raise=true;s.padRaise=true;rodRaiseRelease(r);}else if(s.padRaise){r.raise=false;s.padRaise=false;rodRaiseRelease(r);}}
}
function toggleFreeRoam(){
 S.freeRoam=!S.freeRoam;
 if(S.freeRoam){
  const e=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');
  S.camYaw=e.y;S.camPitch=e.x;
  toast('FREE ROAM','WASD move · Q/E up/down · Shift sprint · Esc exit',1.8);
 }else{
  document.exitPointerLock();
  toast('FREE ROAM','off',0.9);
 }
 Au.ui();
}
cvs.addEventListener('click',()=>{if(S.freeRoam&&S.phase!=='menu')cvs.requestPointerLock();});
/* ---- POINTER LOCK IN A MATCH (cfg.mouseLock) ----------------------------------------------
   With the slide relative, the cursor no longer means anything during play — it is just an object
   that runs out of screen, pops the taskbar at the bottom edge, and stops feeding movement once it
   is pinned. Locking it hides it and makes the movement stream endless.

   THE STATE IS RE-ASSERTED EVERY FRAME (mouseLockTick, from the main loop) rather than toggled at
   each transition, for the same reason hud.js hides the match clock that way: there is no exit path
   — pause, goal, replay, menu, photo, the sandbox panel — that can strand a match with the cursor
   trapped. But a lock can only be REQUESTED from a user gesture, so the request side hangs off a
   click or a keypress and simply gives up if the browser says no; the next input tries again.

   ESC IS THE ONE THAT NEEDS EXPLAINING. The browser owns Esc while locked: it releases the pointer
   and swallows the keydown, so input.js never sees it and the pause menu never opened. Reading the
   RELEASE as the pause press instead puts that back to one key, one pause. mlSelf marks the
   releases we asked for ourselves so they don't read as an Esc. */
let mlSelf=false,mlEsc=0;   // mlEsc: when a lock release stood in for an Escape press (see the keydown grace above)
function mouseLockWant(){
 if(!cfg.mouseLock)return false;
 if(S.freeRoam||S.photo)return false;                     // both drive the cursor themselves
 if(S.phase!=='play'&&S.phase!=='count')return false;
 if(!devSeat('mouse'))return false;                       // nobody is steering with the mouse
 if(S.trial&&S.trial.done)return false;                   // the result card takes clicks (plain data — safe with no trials.js)
 const p=$('trnPanel');
 if(p&&!p.classList.contains('hidden'))return false;      // sandbox tools are clicks
 return true;
}
function mouseLockRequest(){
 if(!mouseLockWant()||document.pointerLockElement)return;
 const p=cvs.requestPointerLock();
 if(p&&p.catch)p.catch(()=>{});   // no gesture yet, or Chrome's cooldown after an Esc release — the next input retries
}
function mouseLockTick(){
 if(document.pointerLockElement===cvs&&!mouseLockWant()){mlSelf=true;document.exitPointerLock();}
}
document.addEventListener('pointerlockchange',()=>{
 if(document.pointerLockElement)return;
 if(mlSelf){mlSelf=false;return;}                         // we let it go on purpose
 if(S.freeRoam){S.freeRoam=false;return;}
 if(mouseLockWant()){mlEsc=performance.now();togglePause();}   // Esc, or focus lost — read the release as the pause press
});
document.addEventListener('mousemove',e=>{
 if(!S.freeRoam||!document.pointerLockElement)return;
 S.camYaw-=e.movementX*CAM.freeRoamSens*.001;
 S.camPitch-=e.movementY*CAM.freeRoamSens*.001;
 S.camPitch=clamp(S.camPitch,-Math.PI/2+.01,Math.PI/2-.01);
});
