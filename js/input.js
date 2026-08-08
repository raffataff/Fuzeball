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
 // The save key is tested FIRST because every OTHER key skips the replay — without this it
 // would be swallowed by the skip and the clip would end where you asked to keep it.
 if(S.phase==='replay'){if(e.code===REPLAY.save.key)replaySaveClip();else replaySkip();return;}
 if(e.code==='Escape'){
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
 const ks=devSeat('kbd'),ur=ks?seatRod(ks):null;
 if(e.code==='KeyB'){toggleSweetGuide(ks);return;}  // sweet-spot guide follows whoever asked (controller ○ mirrors this)
 if(!ur)return;
 if(e.code==='Space')kickRod(ur);
 if(e.code==='ShiftLeft'||e.code==='ShiftRight')ur.raise=true;
 if(e.code==='ArrowLeft'||e.code==='KeyQ')seatStep(ks,-1);
 if(e.code==='ArrowRight'||e.code==='KeyE')seatStep(ks,1);
 if(/^Digit[1-4]$/.test(e.code))setSeatCtrl(ks,+e.code[5]-1,1);
});
addEventListener('keyup',e=>{keys[e.code]=false;
 if(S.freeRoam)return;
 if(e.code==='ShiftLeft'||e.code==='ShiftRight'){const ur=devRod('kbd');if(ur)ur.raise=false;}});
const cvs=$('game');
cvs.addEventListener('mousemove',e=>{
 if(S.freeRoam||(S.phase!=='play'&&S.phase!=='count'))return;
 const r=devRod('mouse');if(!r)return;
 r.target=((e.clientY/innerHeight)-.5)*2*r.maxOff*CTRL.mouseSens*cfg.mouseSens;
});
cvs.addEventListener('mousedown',e=>{
 if(S.phase==='replay'){replaySkip();return;}   // click skips the goal replay
 if(S.freeRoam||(S.phase!=='play'&&S.phase!=='count'))return;
 const r=devRod('mouse');if(!r)return;
 if(e.button===0)kickRod(r);
 if(e.button===2)r.raise=true;
});
addEventListener('mouseup',e=>{if(!S.freeRoam&&e.button===2){const ur=devRod('mouse');if(ur)ur.raise=false;}});
cvs.addEventListener('contextmenu',e=>e.preventDefault());
addEventListener('wheel',e=>{if(!S.freeRoam&&S.phase==='play'){const ms=devSeat('mouse');if(ms)seatStep(ms,e.deltaY>0?1:-1);}});
function userControlUpdate(dt){
 if(S.freeRoam)return;
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
   if(bi!==s.ctrl){s.ctrl=bi;updateChips();}
  });
 }
}
/* ---- gamepad (Steam controller) ----------------------------------------
   Standard-layout pad mapped onto the SAME rod controls as mouse+keyboard,
   polled once per rendered frame from the main loop. Buttons are edge-detected
   via gpPrev so a held button fires once. Menus still use the mouse; this
   drives in-match play + pause/resume, which is the controller baseline a
   Steam build needs. Layout: left-stick Y / d-pad ↕ = slide · A(0) or RT(7) =
   kick · X(2) or LT(6) = raise (hold) · LB(4)/RB(5) or d-pad ↔ = switch rod ·
   Y(3) = camera · Start(9) = pause.
   TOTAL CONTROL mode (cfg.padControlMode='total'): the triggers stop being
   raise/kick and become an analog slide-speed modifier — LT eases toward
   cfg.padTCFine (precision steps), RT toward cfg.padTCFast (fast moves),
   neither = cfg.padTCBase middle-ground. Kick = A only, raise = X only. The
   right stick still angles the rod on its bound axis; the OTHER right axis is
   the swerve line — its deflection is stored on the rod (r.tcSpin) and
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
 if(!$('options').classList.contains('hidden'))return; // options screen owns the pad (live tester)
 const pads=navigator.getGamepads?navigator.getGamepads():[];
 S.seats.forEach(s=>{s.tcMult=1;});                    // reset every frame; a seat with a live pad rewrites it below
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
/* One seat's pad, for one frame. Everything below was the body of gamepadUpdate; the only change
   is that the rod, the raise-hold latch and the Total-Control multiplier come off the SEAT rather
   than off module globals, so N pads drive N rods independently. */
function padSeatUpdate(dt,gp,s,just){
 const r=(!S.freeRoam&&(S.phase==='play'||S.phase==='count'))?seatRod(s):null;
 if(!r){s.padRaise=false;return;}
 const DZ=cfg.padDeadzone,TC=cfg.padControlMode==='total';
 // TC SPEED: the analog triggers scale how many units the SLIDE STEP covers per frame (slideMult).
 // LT squeezes toward padTCFine (precision — smaller steps), RT toward padTCFast (fast — bigger
 // steps), neither = padTCBase middle-ground; LT wins when both are held. This is a step-SIZE knob,
 // NOT a rod-speed throttle: the seat's tcMult feeds its rod's chase cap in rods.js but is floored at 1 so
 // the rod always tracks its target at full user speed. Fine mode must not make the rod feel like
 // syrup — it just moves the target in finer increments; the rod still snaps to it crisply. RT's
 // boost (>1) still raises the cap so big fast steps aren't clipped. Untouched pad → tcMult 1.
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
 if(just[0]||(!TC&&just[7]))kickRod(r);              // A / RT (RT only in classic — in TC it's the speed trigger)
 if(just[1])toggleSweetGuide(s);                     // ○ (B) — sweet-spot guide, on THIS seat's rod
 if(just[3])cycleCam(1);                             // Y
 if(just[4]||just[14])seatStep(s,-1);                // LB / d-pad ← (skips rods another seat holds)
 if(just[5]||just[15])seatStep(s,1);                 // RB / d-pad →
 // ANGLE: ABSOLUTE rod tilt — the stick's *position* maps straight to a target angle, so a partial
 // push holds a partial angle (rate control snapped to the extremes). Axis is configurable — 'ry' =
 // right-stick up/down (axis 3), 'rx' = right-stick left/right (axis 2). Deflection past the deadzone
 // is rescaled to 0..1 (no jump off centre), inverted + sens-scaled, then split about rest: one side
 // eases toward the forward strike angle, the other toward the raised-back angle. Centre = feet down.
 let rs=(cfg.padAngleAxis==='rx'?gp.axes[2]:gp.axes[3])||0;
 if(Math.abs(rs)>DZ){
  if(cfg.padAngleInvert)rs=-rs;
  let d=(Math.abs(rs)-DZ)/(1-DZ)*Math.sign(rs);      // 0 at deadzone edge → ±1 at full deflection
  d=clamp(-d*cfg.padAngleSens,-1,1);                 // sens scales reach; sign keeps the old push direction
  r.padAngleTarget=(d>=0?d*KICK.strikeA:-d*KICK.raiseA)*r.kickDir; // +push→forward, −push→raised; ×kickDir per team
  r.padAngleOn=true;
 }else{r.padAngleTarget=0;r.padAngleOn=false;}
 // TC SWERVE: the right-stick axis NOT bound to angle is the swerve line. Sampled via the
 // shared tcSwerveFromAxes (also what the options tester previews) and stored on the rod;
 // physics.js adds it to the ball's side-spin on contact — so the line the stick takes
 // through the strike bends the shot. Angle control above is untouched: one stick, both effects.
 if(TC){r.tcSpin=tcSwerveFromAxes(gp);}
 else if(r.tcSpin)r.tcSpin=0;
 // raise is a HOLD; only write r.raise from the pad while its button is down or we just released
 // it, so a connected-but-idle pad never clobbers keyboard/mouse raise. If the right stick is
 // actively driving the angle, skip the binary raise so it doesn't fight.
 const raise=gpDown(gp,2)||(!TC&&gpDown(gp,6));      // X / LT (LT only in classic — in TC it's the precision trigger)
 if(!r.padAngleOn){if(raise){r.raise=true;s.padRaise=true;}else if(s.padRaise){r.raise=false;s.padRaise=false;}}
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
document.addEventListener('pointerlockchange',()=>{
 if(!document.pointerLockElement&&S.freeRoam)S.freeRoam=false;
});
document.addEventListener('mousemove',e=>{
 if(!S.freeRoam||!document.pointerLockElement)return;
 S.camYaw-=e.movementX*CAM.freeRoamSens*.001;
 S.camPitch-=e.movementY*CAM.freeRoamSens*.001;
 S.camPitch=clamp(S.camPitch,-Math.PI/2+.01,Math.PI/2-.01);
});
