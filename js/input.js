'use strict';
/* ================= input ================= */
const keys={};
function setCtrl(i){
 if(S.userTeam<0||!S.ctrlRods.length)return;
 S.ctrl=(i+S.ctrlRods.length)%S.ctrlRods.length;
 S.lastSwitch=S.time;
 updateChips();Au.ui();
}
addEventListener('keydown',e=>{
 if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();
 if(e.repeat)return;keys[e.code]=true;
 if(S.phase==='replay'){replaySkip();return;}   // any key skips the goal replay
 if(e.code==='Escape'){
  if(!$('options').classList.contains('hidden')){closeOptions();return;}
  if(!$('lgForfeit').classList.contains('hidden')){$('lgForfeit').classList.add('hidden');return;}
  if(!$('league').classList.contains('hidden')&&S.phase==='menu'){$('league').classList.add('hidden');$('menu').classList.remove('hidden');Au.ui();return;}
  togglePause();return;
 }
  if(e.code==='KeyV'&&S.phase!=='menu'){S.camMode=(S.camMode+1)%CAM.modes.length;Au.ui();}
 if(e.code==='KeyC'&&S.phase!=='menu'){toggleDebug();return;}
 if(e.code==='KeyL'&&S.phase!=='menu'&&dbgOn){cycleKickLog();return;}
 if(e.code==='KeyF'&&S.phase!=='menu'){toggleFreeRoam();return;}
 if(S.freeRoam)return;
 if(S.phase!=='play'&&S.phase!=='count')return;
 if(S.userTeam<0)return;
 if(e.code==='KeyB'){toggleSweetGuide();return;}   // toggle the sweet-spot guide (controller ○ mirrors this)
 if(e.code==='Space')kickRod(S.ctrlRods[S.ctrl]);
 if(e.code==='ShiftLeft'||e.code==='ShiftRight')S.ctrlRods[S.ctrl].raise=true;
 if(e.code==='ArrowLeft'||e.code==='KeyQ')setCtrl(S.ctrl-1);
 if(e.code==='ArrowRight'||e.code==='KeyE')setCtrl(S.ctrl+1);
 if(/^Digit[1-4]$/.test(e.code))setCtrl(+e.code[5]-1);
});
addEventListener('keyup',e=>{keys[e.code]=false;
 if(S.freeRoam)return;
 if((e.code==='ShiftLeft'||e.code==='ShiftRight')&&S.userTeam>=0&&S.ctrlRods.length)S.ctrlRods[S.ctrl].raise=false;});
const cvs=$('game');
cvs.addEventListener('mousemove',e=>{
 if(S.freeRoam||(S.phase!=='play'&&S.phase!=='count')||S.userTeam<0)return;
 const r=S.ctrlRods[S.ctrl];
 r.target=((e.clientY/innerHeight)-.5)*2*r.maxOff*CTRL.mouseSens*cfg.mouseSens;
});
cvs.addEventListener('mousedown',e=>{
 if(S.phase==='replay'){replaySkip();return;}   // click skips the goal replay
 if(S.freeRoam||(S.phase!=='play'&&S.phase!=='count')||S.userTeam<0)return;
 if(e.button===0)kickRod(S.ctrlRods[S.ctrl]);
 if(e.button===2)S.ctrlRods[S.ctrl].raise=true;
});
addEventListener('mouseup',e=>{if(!S.freeRoam&&e.button===2&&S.userTeam>=0&&S.ctrlRods.length)S.ctrlRods[S.ctrl].raise=false;});
cvs.addEventListener('contextmenu',e=>e.preventDefault());
addEventListener('wheel',e=>{if(!S.freeRoam&&S.phase==='play'&&S.userTeam>=0)setCtrl(S.ctrl+(e.deltaY>0?1:-1));});
function userControlUpdate(dt){
 if(S.freeRoam||S.userTeam<0||!S.ctrlRods.length)return;
 const r=S.ctrlRods[S.ctrl];
 let dz=0;
 if(keys.ArrowUp||keys.KeyW)dz-=1;
 if(keys.ArrowDown||keys.KeyS)dz+=1;
 if(dz)r.target=clamp(r.target+dz*CTRL.slideSpeed*cfg.kbdSens*dt,-r.maxOff,r.maxOff);
 if(cfg.auto&&S.phase==='play'&&S.time-S.lastSwitch>CTRL.autoDelay&&S.balls.length){
  const bp=S.balls[0].m.position;
  let bi=S.ctrl,bd=1e9;
  S.ctrlRods.forEach((rr,i)=>{const d=Math.abs(bp.x-rr.x);if(d<bd){bd=d;bi=i;}});
  if(bi!==S.ctrl){S.ctrl=bi;updateChips();}
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
const gpPrev={};let gpRaiseHeld=false;
function gpDown(gp,i){const b=gp.buttons[i];return!!b&&(b.pressed||b.value>0.5);}
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
 let gp=null;for(const p of pads){if(p){gp=p;break;}}
 if(!gp){S.tcMult=1;return;}
 // snapshot the rising edge (down now, up last poll) of every button we use, in one pass
 const just={};
 for(const i of [0,1,3,4,5,7,9,14,15]){const d=gpDown(gp,i);just[i]=d&&!gpPrev[i];gpPrev[i]=d;}
 if(S.phase==='replay'){if(just[0]||just[1]||just[9])replaySkip();S.tcMult=1;return;}   // A/B/Start skip the goal replay
 if(just[9]&&(S.phase==='play'||S.phase==='count'||S.phase==='pause'))togglePause();
 if(!(!S.freeRoam&&(S.phase==='play'||S.phase==='count')&&S.userTeam>=0&&S.ctrlRods.length)){
  if(gpRaiseHeld)gpRaiseHeld=false;S.tcMult=1;return;
 }
 const r=S.ctrlRods[S.ctrl],DZ=cfg.padDeadzone,TC=cfg.padControlMode==='total';
 // TC SPEED: the analog triggers scale how many units the SLIDE STEP covers per frame (slideMult).
 // LT squeezes toward padTCFine (precision — smaller steps), RT toward padTCFast (fast — bigger
 // steps), neither = padTCBase middle-ground; LT wins when both are held. This is a step-SIZE knob,
 // NOT a rod-speed throttle: S.tcMult feeds the rod's chase cap in rods.js but is floored at 1 so
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
  slideMult=m;S.tcMult=padLive?Math.max(1,m):1;
 }else S.tcMult=1;
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
 if(just[1])toggleSweetGuide();                      // ○ (B) — toggle the sweet-spot guide
 if(just[3])S.camMode=(S.camMode+1)%CAM.modes.length;// Y
 if(just[4]||just[14])setCtrl(S.ctrl-1);             // LB / d-pad ←
 if(just[5]||just[15])setCtrl(S.ctrl+1);             // RB / d-pad →
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
 if(!r.padAngleOn){if(raise){r.raise=true;gpRaiseHeld=true;}else if(gpRaiseHeld){r.raise=false;gpRaiseHeld=false;}}
}
function toggleFreeRoam(){
 S.freeRoam=!S.freeRoam;
 if(S.freeRoam){
  const e=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');
  S.camYaw=e.y;S.camPitch=e.x;
  banner('FREE ROAM','WASD move · Q/E up/down · Shift sprint · Esc exit',1.8);
 }else{
  document.exitPointerLock();
  banner('FREE ROAM','OFF',0.9);
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
